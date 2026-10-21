"""v0.4.7.5 qp3: playing online with friends.

The game service can be hosted for a few friends (host.cmd, or `python -m server.app --online`): it listens on every
network interface, new accounts need the host's join code, and the local dev account stays local-only. Everyone plays
in their own browser against this one service, so the accounts, the store, the progression and the rewards are the
same ones the single-player game uses.

What this module adds:

* Friends between real players (people with an account on this service): requests by username, accepted or declined,
  stored in `online_friends` (one row per direction: friends / requested / incoming).
* A WebSocket (`/api/ws`, implemented here on the standard library: RFC 6455 framing, text frames only). Games from
  this service sign in with their cookie; a friend's own copy of the game signs in on the socket (Hub.sign_in).
* The base game with real people in it (v0.4.7.5 qp3, part 2): everyone at the same park (or Crew HQ) sees the others
  walk around; squads of up to five friends go everywhere together; Got Next claims, the kings holding a court and the
  courts in use are shared by everyone at a park; games are started by whoever decides for that court (or a squad
  leader, for Pro-Am and crew runs) and run in lockstep on every player's screen (client/js/game/session.js): every
  client simulates the same game from the same seed and rosters, each one sends its own player's input for a tick a
  few ticks ahead, and the service only relays them, in order, to the other players and to everyone watching from the
  same place. A player who leaves mid-game is handed to the AI at the same tick on every screen.
* Online crews: a crew's founder brings friends into it (`online_crews`, `online_crew_members`); members' games add
  crew XP that the founder's own game collects into his save.

The service never runs or checks the game: the results each client reports go through the same /api/matches
validation as a single-player game.
"""
import base64
import hashlib
import json
import secrets
import socket
import struct
import threading
import time

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 512 * 1024      # a game setup carries every roster entry (builds and looks): a few tens of kB
MAX_SQUAD = 5          # you and four friends
MAX_CREW = 40
MAX_FRIENDS = 100
MAX_AI_SQUAD = 4       # (a player's own AI squad: four friends from his game's world)
MAX_BATCH = 64        # (ticks of input in one message: a frame after a hitch can send several)
WATCH_EVERY = 0.1     # watchers get a game's inputs in bundles, ten times a second (they play a moment behind)


class WSClosed(Exception):
    pass


class AuthError(Exception):
    """A sign-in on the socket that didn't work: code (version / token / auth / rate) and the words for the player."""

    def __init__(self, code, text):
        super().__init__(text)
        self.code, self.text = code, text


def accept_key(key):
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


def frame(data, opcode=0x1):
    """A whole (unmasked, server-to-client) WebSocket frame around data (bytes)."""
    n = len(data)
    return bytes([0x80 | opcode]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack("!H", n) if n < 65536 else bytes([127]) + struct.pack("!Q", n)) + data


def encode(obj):
    """A message as a ready-to-send text frame: encoded once, however many sockets it goes to."""
    return frame(json.dumps(obj, separators=(",", ":")).encode())


def unmask(payload, mask):
    """A client frame's payload, unmasked (RFC 6455 5.3) a whole number at a time instead of a byte at a time."""
    n = len(payload)
    if not n:
        return b""
    m = int.from_bytes((mask * (n // 4 + 1))[:n], "little")
    return (int.from_bytes(payload, "little") ^ m).to_bytes(n, "little")


# v0.4.7.5 qp3 perf: nothing the hub does waits on one player's connection. Every socket has its own queue and a writer
# thread that sends whatever has piled up in one go; a socket that stops taking data (a phone that lost its Wi-Fi, a
# frozen tab) is cut off once it's this far behind, and its player is handed to the AI like anyone who leaves.
MAX_BACKLOG = 8 * 1024 * 1024   # bytes queued for one socket
MAX_STALL = 10.0                # seconds one write may hang
# v0.4.8: an input goes out on the thread that has it, straight away, when nothing is queued or being written for that
# socket: a send that never waits (what the connection can't take right now is queued for its writer thread, as
# before). That saves the hop to the writer thread, a few ms with a busy hub, on nearly every input. Where the system
# has no such send (Windows), the writer thread sends everything, as before.
DIRECT_SEND = hasattr(socket, "MSG_DONTWAIT")


class WSConn:
    """One browser's socket. Reads happen on the handler thread; sends can come from any thread: they're queued and
    written by the socket's own writer thread, so a slow connection never holds up the hub (or anyone else)."""

    def __init__(self, rfile, wfile, sock, aid, username):
        self.rfile, self.wfile, self.sock = rfile, wfile, sock
        self.aid, self.username = aid, username
        self.cv = threading.Condition(threading.Lock())
        self.out, self.out_bytes = [], 0
        self.writing_since = None   # (monotonic time a write started, while one is under way)
        self.stopping = False       # (write what's queued, then stop)
        self.down = False
        self.alive = True
        self.info = {"name": username, "park": None, "status": "menu", "char": None}
        self.squad = None     # squad id
        self.game = None      # the game he's playing (id)
        self.entry = None     # his player as he plays (for the others where he is)
        self.aisquad = []     # the AI from his own game who run in his squad: [{"id", "name", "entry"}] (they're in his online squad too)
        self.ip = None
        self.connected_at = time.time()
        self.stats = {"sent": 0, "frames": 0, "writes": 0, "direct": 0}
        self.direct = DIRECT_SEND
        threading.Thread(target=self._writer, name="ws-writer", daemon=True).start()

    # ---- sending: queued, written by the writer thread ----
    def send(self, obj):
        return self.send_frame(encode(obj))

    def send_frame(self, fr):
        """Queue a ready frame (see encode). False when the socket is gone (or was just cut off for falling behind)."""
        if not self.alive:
            return False
        with self.cv:
            if self.stopping:
                return False
            ws = self.writing_since
            if self.out_bytes + len(fr) > MAX_BACKLOG or (ws is not None and time.monotonic() - ws > MAX_STALL):
                self.out.clear()
                self.out_bytes = 0
                self.alive = False
                cut = True
            else:
                cut = False
                if self.direct and not self.out and ws is None:
                    # (nothing ahead of it: out now, as much as the connection takes without waiting)
                    try:
                        n = self.sock.send(fr, socket.MSG_DONTWAIT)
                    except (BlockingIOError, InterruptedError):
                        n = 0
                    except (OSError, ValueError, AttributeError):
                        n = 0  # (gone: the writer's write finds out and closes it)
                    if n:
                        self.stats["sent"] += n
                        self.stats["direct"] += 1
                    if n == len(fr):
                        self.stats["frames"] += 1
                        self.stats["writes"] += 1
                        return True
                    fr = fr[n:]
                self.out.append(fr)
                self.out_bytes += len(fr)
                self.cv.notify()
        if cut:
            self._shutdown()  # (the reader stops too, and the hub sees him leave)
        return not cut

    def _writer(self):
        while True:
            with self.cv:
                while not self.out and not self.stopping:
                    self.cv.wait()
                if not self.out:
                    self.cv.notify_all()
                    break
                chunks, self.out, self.out_bytes = self.out, [], 0
                self.writing_since = time.monotonic()
            data = chunks[0] if len(chunks) == 1 else b"".join(chunks)
            try:
                self.wfile.write(data)
                self.wfile.flush()
                self.stats["sent"] += len(data)
                self.stats["frames"] += len(chunks)
                self.stats["writes"] += 1
            except (OSError, ValueError, AttributeError):
                with self.cv:
                    self.alive = False
                    self.stopping = True
                    self.out, self.out_bytes, self.writing_since = [], 0, None
                    self.cv.notify_all()
                break
            with self.cv:
                self.writing_since = None
                if not self.out:
                    self.cv.notify_all()  # (anyone waiting for the queue to empty)
        if self.stopping and not self.alive:
            self._shutdown()

    def drain(self, timeout=2.0):
        """Wait (a while at most) until everything queued has been written."""
        end = time.monotonic() + timeout
        with self.cv:
            while (self.out or self.writing_since is not None) and not self.down:
                left = end - time.monotonic()
                if left <= 0:
                    return False
                self.cv.wait(left)
        return True

    def stop(self):
        """No more sends: the writer finishes what's queued and ends."""
        with self.cv:
            self.stopping = True
            self.cv.notify_all()

    def _shutdown(self):
        if self.down:
            return
        self.down = True
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _control(self, opcode, payload=b""):
        self.send_frame(frame(payload, opcode))

    def _read(self, n):
        buf = self.rfile.read(n)
        if buf is None or len(buf) < n:
            raise WSClosed()
        return buf

    def recv(self):
        """The next text message (str), or raises WSClosed. Pings are answered, binary frames ignored."""
        parts, total = [], 0
        while True:
            b0, b1 = self._read(2)
            fin, opcode, masked, n = b0 & 0x80, b0 & 0x0F, b1 & 0x80, b1 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read(8))[0]
            if n > MAX_MESSAGE or total + n > MAX_MESSAGE:
                self.close(1009)
                raise WSClosed()
            if not masked:
                self.close(1002)  # clients must mask (RFC 6455 5.1)
                raise WSClosed()
            mask = self._read(4)
            payload = unmask(self._read(n), mask)
            if opcode == 0x8:
                self.close(1000)
                raise WSClosed()
            if opcode == 0x9:
                self._control(0xA, bytes(payload[:125]))
                continue
            if opcode == 0xA:
                continue
            if opcode in (0x1, 0x0, 0x2):
                parts.append(bytes(payload))
                total += n
                if fin:
                    data = b"".join(parts)
                    parts, total = [], 0
                    if opcode == 0x2:
                        continue
                    return data.decode("utf-8", "replace")

    def close(self, code=1000):
        if self.alive:
            self._control(0x8, struct.pack("!H", code))
        self.alive = False
        self.stop()
        # (the writer sends the close, and whatever was queued before it, then shuts the socket; one that isn't taking
        # data is shut a moment later anyway)
        t = threading.Timer(2.0, self._shutdown)
        t.daemon = True
        t.start()


# ---------------- friends (database) ----------------
def friends_rows(db, aid):
    return db.query("SELECT f.friend_id, f.status, a.username FROM online_friends f JOIN accounts a ON a.id = f.friend_id WHERE f.account_id=? ORDER BY a.username", (aid,))


def are_friends(db, a, b):
    return bool(db.query("SELECT 1 FROM online_friends WHERE account_id=? AND friend_id=? AND status='friends'", (a, b)))


def friend_action(db, aid, username, action):
    """add (a request, or accepting theirs), accept, decline, remove. Returns a short message."""
    rows = db.query("SELECT id, username FROM accounts WHERE username=?", ((username or "").lower(),))
    if not rows:
        raise ValueError("No player with that username on this server.")
    other = rows[0]["id"]
    if other == aid:
        raise ValueError("That's you.")
    now = time.time()
    with db.transaction() as c:
        mine = c.execute("SELECT status FROM online_friends WHERE account_id=? AND friend_id=?", (aid, other)).fetchone()
        mine = mine[0] if mine else None
        if action == "add":
            if mine == "friends":
                return f"{rows[0]['username']} is already your friend."
            if mine == "incoming":
                action = "accept"
            else:
                n = c.execute("SELECT COUNT(*) FROM online_friends WHERE account_id=?", (aid,)).fetchone()[0]
                if n >= MAX_FRIENDS:
                    raise ValueError("Friends list is full.")
                c.execute("INSERT OR REPLACE INTO online_friends VALUES(?,?,?,?)", (aid, other, "requested", now))
                c.execute("INSERT OR REPLACE INTO online_friends VALUES(?,?,?,?)", (other, aid, "incoming", now))
                return f"Friend request sent to {rows[0]['username']}."
        if action == "accept":
            if mine != "incoming":
                raise ValueError("No request from that player.")
            c.execute("UPDATE online_friends SET status='friends' WHERE account_id=? AND friend_id=?", (aid, other))
            c.execute("UPDATE online_friends SET status='friends' WHERE account_id=? AND friend_id=?", (other, aid))
            return f"You and {rows[0]['username']} are friends."
        if action in ("decline", "remove"):
            c.execute("DELETE FROM online_friends WHERE (account_id=? AND friend_id=?) OR (account_id=? AND friend_id=?)", (aid, other, other, aid))
            return "Removed." if action == "remove" else "Declined."
    raise ValueError("Unknown action.")


# ---------------- online crews (database) ----------------
def crew_of(db, aid):
    rows = db.query("SELECT crew_id FROM online_crew_members WHERE account_id=?", (aid,))
    return rows[0][0] if rows else None


def crew_row(db, cid):
    rows = db.query("SELECT * FROM online_crews WHERE id=?", (cid,))
    return dict(rows[0]) if rows else None


# ---------------- the hub ----------------
# Where someone is: a park ("harbor"), a Crew HQ ("hq:<crew id>"), or nowhere in particular (menus, the arena). People
# at the same place see each other walk around (pos), each other's Got Next claims and kings (courts) and the games
# played there (watch). Squads go everywhere together; games are started by a squad leader (or whoever decides for a
# court) and relayed in lockstep to their players and to everyone watching from the same place.
class Hub:
    def __init__(self, db, authenticator=None, world=None, catalog=None):
        self.db = db
        self.authenticator = authenticator  # (qp3: sign-ins from your friends' own copies: Service.online_auth)
        self.world = world  # (v0.4.8.7: the service's one AI world, Service.shared_world_payload: in every hello, and on asking)
        # v0.4.8.7 qp7: the catalog (celebration items → their animation: emotes are checked and named here), each park's
        # host (the one real player who runs its people for everyone, picked here: host_of) and his latest report (pop)
        self.catalog = catalog or {}
        self.hosts = {}      # place -> account id
        self.pops = {}       # place -> (monotonic time, the host's last pop message)
        self.arrivals = 0
        self.lock = threading.RLock()
        self.conns = {}      # account id -> WSConn
        self.squads = {}     # squad id -> {"id", "leader", "members": [aids, leader first]}
        self.invites = {}    # invitee -> {leader: time} (squad invites)
        self.challenges = {} # challenged -> {challenger: time} (Pro-Am)
        self.crew_invites = {}  # invitee -> {crew id: time}
        self.courts = {}     # place -> {court index: {"lines": [claim|None, claim|None], "kings": claim|None, "busy": dict|None}}
        self.games = {}      # game id -> game dict
        self.game_seq = 0

    # ---- small helpers ----
    def world_payload(self):
        """v0.4.8.7: {"world": the shared AI world} for a message, or nothing (a hub made without one: the tests)."""
        if not self.world:
            return {}
        try:
            return {"world": self.world()}
        except Exception as e:  # (never let it hold up a sign-in)
            print(f"Shared world unavailable: {e}", flush=True)
            return {}

    def live(self, aid):
        c = self.conns.get(aid)
        return c if c and c.alive else None

    def at(self, place, skip=None):
        return [c for c in list(self.conns.values()) if c.alive and place and c.info.get("park") == place and c.aid != skip]

    def send_to(self, aids, msg, skip=None):
        fr = None  # (encoded once, for everyone)
        for a in aids:
            if a == skip:
                continue
            c = self.live(a)
            if c:
                if fr is None:
                    fr = encode(msg)
                c.send_frame(fr)

    def name_of(self, aid):
        c = self.conns.get(aid)
        return (c.info.get("name") or c.username) if c else "?"

    def squad_of(self, aid):
        c = self.conns.get(aid)
        return self.squads.get(c.squad) if c and c.squad else None

    def leader_of(self, aid):
        sq = self.squad_of(aid)
        return sq["leader"] if sq else aid

    def party(self, aid):
        """He and his squad: [leader, members...] (just him when he has none)."""
        sq = self.squad_of(aid)
        return list(sq["members"]) if sq else [aid]

    # ---- presence ----
    def presence_of(self, aid):
        c = self.live(aid)
        if not c:
            return {"online": False}
        sq = self.squads.get(c.squad) if c.squad else None
        return {"online": True, **c.info, "playing": bool(c.game), "squad": {"leader": sq["leader"], "size": len(sq["members"])} if sq else None}

    def friends_payload(self, aid):
        out = []
        for r in friends_rows(self.db, aid):
            fid = r["friend_id"]
            out.append({"id": fid, "username": r["username"], "status": r["status"], **({"presence": self.presence_of(fid)} if r["status"] == "friends" else {})})
        return out

    def push_presence(self, aid):
        """Tell aid's online friends (and aid) the new state of things; his squad and crew see it too."""
        with self.lock:
            targets = [aid] + [r["friend_id"] for r in friends_rows(self.db, aid) if r["status"] in ("friends", "incoming", "requested")]
            for t in targets:
                c = self.live(t)
                if c:
                    c.send({"t": "friends", "friends": self.friends_payload(t)})
            sq = self.squad_of(aid)
            if sq:
                self.push_squad(sq)
            cid = crew_of(self.db, aid)
            if cid:
                self.push_crew(cid)

    def connect(self, conn):
        with self.lock:
            old = self.conns.get(conn.aid)
            if old and old is not conn:
                old.send({"t": "replaced"})
                self.drop(old, reason="replaced")
                old.close(4000)
            self.conns[conn.aid] = conn
        conn.send({"t": "hello", "you": {"id": conn.aid, "username": conn.username}, "friends": self.friends_payload(conn.aid), **self.world_payload()})
        self.push_presence(conn.aid)
        cid = crew_of(self.db, conn.aid)
        if cid:
            self.push_crew(cid)
            if cid == conn.aid:
                self.offer_crew_xp(cid)

    def disconnect(self, conn):
        with self.lock:
            self.drop(conn, reason="disconnected")
            if self.conns.get(conn.aid) is conn:
                del self.conns[conn.aid]
        self.push_presence(conn.aid)

    def drop(self, conn, reason="left"):
        """He's gone (or replaced): out of his game, his squad and his place."""
        self.quit_game(conn, reason)
        self.leave_squad(conn)
        self.move(conn, None)

    # ---- places: who's where, walking around ----
    def move(self, conn, place):
        old = conn.info.get("park")
        if old == place:
            return
        conn.info["park"] = place
        self.arrivals += 1
        conn.info["arrived"] = self.arrivals
        if old:
            self.send_to([c.aid for c in self.at(old)], {"t": "gone", "id": conn.aid, "place": old})
            self.release_place(conn.aid, old)
            self.pick_host(old)
        if place:
            self.pick_host(place, quiet=conn.aid)
            others = self.at(place, skip=conn.aid)
            pop = self.pops.get(place)
            conn.send({"t": "here", "place": place, "players": [self.person(c) for c in others],
                       "courts": self.courts_payload(place), "games": self.place_games(place), "host": self.hosts.get(place),
                       # (v0.4.8.7 qp7: the park as its host had it a moment ago: the newcomer's screen matches at once)
                       **({"pop": pop[1]} if pop and time.monotonic() - pop[0] < 5 and pop[1].get("from") != conn.aid else {})})
            if conn.entry:
                self.send_to([c.aid for c in others], {"t": "pentry", **self.person(conn)})
            self.offer_watch(conn, place)

    # ---- v0.4.8.7 qp7: each park's host, picked here (one answer for everyone): whoever has been there longest ----
    def host_of(self, place):
        there = self.at(place)
        return min(there, key=lambda c: (c.info.get("arrived", 0), str(c.aid))).aid if there else None

    def pick_host(self, place, quiet=None):
        """The park's host after someone came or went: told to everyone there when it changes (quiet: the one just arriving,
        who hears it in his 'here'). The last report goes with the old host."""
        h = self.host_of(place)
        if h == self.hosts.get(place):
            return h
        if h is None:
            self.hosts.pop(place, None)
        else:
            self.hosts[place] = h
        self.pops.pop(place, None)
        if h is not None:
            self.send_to([c.aid for c in self.at(place)], {"t": "host", "place": place, "id": h}, skip=quiet)
        return h

    # ---- v0.4.8.7 qp7: emotes (a celebration in the park, or the Crew HQ) ----
    DEFAULT_EMOTES = ("flex", "chest", "point")
    EMOTE_GAP = 0.6

    def emote(self, conn, msg):
        """Checked and named here: the celebration item he has on (his entry, what everyone sees him in) gives the
        animation, or one of the default three with nothing on; at most one every EMOTE_GAP seconds. Everyone else where
        he is gets it at once."""
        place = conn.info.get("park")
        now = time.monotonic()
        if not place or now - conn.info.get("emote_at", 0) < self.EMOTE_GAP:
            return
        item = msg.get("item") if isinstance(msg.get("item"), str) else None
        worn = (((conn.entry or {}).get("build") or {}).get("equipment") or {}).get("celebration")
        kind = None
        if item:
            it = self.catalog.get(item) or {}
            if item == worn and it.get("slot") == "celebration" and isinstance(it.get("anim"), str):
                kind = it["anim"]
        elif msg.get("kind") in self.DEFAULT_EMOTES:
            kind = msg["kind"]
        if not kind:
            return
        dur = msg.get("dur")
        dur = max(0.5, min(3.0, float(dur))) if isinstance(dur, (int, float)) and not isinstance(dur, bool) else 1.6
        conn.info["emote_at"] = now
        self.send_to([c.aid for c in self.at(place, skip=conn.aid)], {"t": "emote", "from": conn.aid, "kind": kind, "item": item, "dur": dur})

    def person(self, c):
        return {"id": c.aid, "username": c.username, "name": c.info.get("name") or c.username, "entry": c.entry, "rtt": c.info.get("rtt"), "ai": c.aisquad}

    def release_place(self, aid, place):
        """Leaving a park: his claims there go, and so does a court he held as king."""
        changed = False
        for ci, ct in self.courts.get(place, {}).items():
            for r, l in enumerate(ct["lines"]):
                if l and l["leader"] == aid:
                    ct["lines"][r] = None
                    changed = True
            if ct["kings"] and ct["kings"]["leader"] == aid:
                ct["kings"] = None
                changed = True
            if ct["busy"] and ct["busy"].get("kind") == "local" and ct["busy"]["leader"] == aid:
                ct["busy"] = None
                changed = True
        if changed:
            self.push_courts(place)

    # ---- squads ----
    def squad_payload(self, sq):
        return {"id": sq["id"], "leader": sq["leader"], "members": [
            {"id": m, "username": self.conns[m].username if m in self.conns else "?", "name": self.name_of(m),
             "park": (self.conns[m].info.get("park") if m in self.conns else None), "status": (self.conns[m].info.get("status") if m in self.conns else None),
             "char": (self.conns[m].info.get("char") if m in self.conns else None), "inGame": bool(self.conns[m].game) if m in self.conns else False,
             "rtt": (self.conns[m].info.get("rtt") if m in self.conns else None),
             "ai": [{"id": a["id"], "name": a["name"], "ovr": (a["entry"].get("build") or {}).get("overall"), "pos": (a["entry"].get("build") or {}).get("position")}
                    for a in (self.conns[m].aisquad if m in self.conns else [])]}
            for m in sq["members"]]}

    def push_squad(self, sq):
        self.send_to(sq["members"], {"t": "squad", "squad": self.squad_payload(sq)})

    def push_squad_entries(self, sq):
        ents = {m: self.conns[m].entry for m in sq["members"] if m in self.conns and self.conns[m].entry}
        ai = {m: self.conns[m].aisquad for m in sq["members"] if m in self.conns and self.conns[m].aisquad}
        self.send_to(sq["members"], {"t": "squad-entries", "entries": ents, "ai": ai})

    def leave_squad(self, conn):
        sq = self.squads.get(conn.squad) if conn.squad else None
        conn.squad = None
        if not sq or conn.aid not in sq["members"]:
            return
        sq["members"].remove(conn.aid)
        conn.send({"t": "squad", "squad": None})
        place = conn.info.get("park")
        if sq["leader"] == conn.aid and place:
            self.release_place(conn.aid, place)  # (the claim was his to make)
        if len(sq["members"]) <= 1:
            for m in sq["members"]:
                c = self.conns.get(m)
                if c:
                    c.squad = None
                    c.send({"t": "squad", "squad": None})
                    c.send({"t": "note", "text": "Your squad broke up."})
            del self.squads[sq["id"]]
        else:
            if sq["leader"] == conn.aid:
                sq["leader"] = sq["members"][0]
                self.send_to(sq["members"], {"t": "note", "text": f"{self.name_of(sq['leader'])} leads the squad now."})
            self.push_squad(sq)
        self.refresh_claims()

    def refresh_claims(self):
        """Claims list their squad as it is now (who's at the park and not in a game)."""
        for place, cts in self.courts.items():
            changed = False
            for ct in cts.values():
                for l in ct["lines"]:
                    if l:
                        mem = self.claim_members(l["leader"], place)
                        if mem != l["members"]:
                            l["members"], l["names"] = mem, [self.name_of(m) for m in mem]
                            changed = True
            if changed:
                self.push_courts(place)

    def claim_members(self, leader, place):
        out = []
        for m in self.party(leader):
            c = self.live(m)
            if c and c.info.get("park") == place and not c.game:
                out.append(m)
        if leader not in out:
            out.insert(0, leader)
        return out

    # ---- courts: Got Next claims, kings, a court in use ----
    def court(self, place, ci):
        return self.courts.setdefault(place, {}).setdefault(ci, {"lines": [None, None], "kings": None, "busy": None})

    def courts_payload(self, place):
        return {str(ci): ct for ci, ct in self.courts.get(place, {}).items()}

    def push_courts(self, place):
        self.send_to([c.aid for c in self.at(place)], {"t": "courts", "place": place, "courts": self.courts_payload(place)})

    def claim(self, conn, msg):
        place, ci, r = conn.info.get("park"), msg.get("court"), msg.get("spot")
        if not place or place.startswith("hq:") or not isinstance(ci, int) or not 0 <= ci < 16 or r not in (0, 1):
            return conn.send({"t": "error", "text": "You can only call next at a park."})
        if self.leader_of(conn.aid) != conn.aid:
            return conn.send({"t": "claimed", "ok": False, "court": ci, "spot": r, "text": "Your squad leader calls next for the squad."})
        ct = self.court(place, ci)
        if ct["lines"][r] and ct["lines"][r]["leader"] != conn.aid:
            return conn.send({"t": "claimed", "ok": False, "court": ci, "spot": r, "text": "Somebody already has that spot."})
        for cts in self.courts.get(place, {}).values():  # (one claim at a time)
            for i, l in enumerate(cts["lines"]):
                if l and l["leader"] == conn.aid:
                    cts["lines"][i] = None
        mem = self.claim_members(conn.aid, place)
        ct["lines"][r] = {"leader": conn.aid, "members": mem, "names": [self.name_of(m) for m in mem], "at": time.time()}
        conn.send({"t": "claimed", "ok": True, "court": ci, "spot": r})
        self.push_courts(place)

    def unclaim(self, conn):
        place = conn.info.get("park")
        changed = False
        for ct in self.courts.get(place, {}).values():
            for i, l in enumerate(ct["lines"]):
                if l and l["leader"] == conn.aid:
                    ct["lines"][i] = None
                    changed = True
        if changed:
            self.push_courts(place)

    def court_state(self, conn, msg):
        """A local game on a court (a solo player against the AI), its score, and who holds the court after it."""
        place, ci = conn.info.get("park"), msg.get("court")
        if not place or not isinstance(ci, int) or not 0 <= ci < 16:
            return
        ct = self.court(place, ci)
        if msg.get("busy"):
            for i, l in enumerate(ct["lines"]):
                if l and l["leader"] == conn.aid:
                    ct["lines"][i] = None
            ct["busy"] = {"kind": "local", "leader": conn.aid, "names": [self.name_of(conn.aid)], "score": msg.get("score") if isinstance(msg.get("score"), list) else None}
        elif ct["busy"] and ct["busy"].get("kind") == "local" and ct["busy"]["leader"] == conn.aid:
            ct["busy"] = None
        if "kings" in msg:
            if msg["kings"]:
                prev = ct["kings"]
                ct["kings"] = {"leader": conn.aid, "members": [conn.aid], "names": [self.name_of(conn.aid)], "at": time.time(),
                               "streak": (prev["streak"] + 1) if prev and prev["leader"] == conn.aid else 1}
            elif ct["kings"] and ct["kings"]["leader"] == conn.aid:
                ct["kings"] = None
        self.push_courts(place)

    def release_court(self, conn, msg):
        place, ci = conn.info.get("park"), msg.get("court")
        ct = self.courts.get(place, {}).get(ci)
        if ct and ct["kings"] and conn.aid in ct["kings"]["members"]:
            ct["kings"]["members"] = [m for m in ct["kings"]["members"] if m != conn.aid]
            if ct["kings"]["leader"] == conn.aid or not ct["kings"]["members"]:
                ct["kings"] = None
            self.push_courts(place)

    # ---- games ----
    def start(self, conn, msg):
        setup = msg.get("setup")
        if not isinstance(setup, dict) or not isinstance(setup.get("slots"), dict) or not setup["slots"]:
            return conn.send({"t": "error", "text": "Bad game setup."})
        slots = {a: s for a, s in setup["slots"].items() if isinstance(s, int) and not isinstance(s, bool)}
        if conn.aid not in slots:
            return conn.send({"t": "error", "text": "You start games you play in."})
        busy = [a for a in slots if not self.live(a) or self.conns[a].game]
        if busy:
            return conn.send({"t": "error", "text": f"{', '.join(self.name_of(a) for a in busy)} can't play right now."})
        place = setup.get("where") if isinstance(setup.get("where"), str) else None
        ci = setup.get("court")
        self.game_seq += 1
        gid = self.game_seq
        setup["game"] = gid
        g = {"id": gid, "where": place, "court": ci, "slots": slots, "players": set(slots), "last": {}, "setup": setup, "started": time.time(),
             "log": [], "wbuf": [], "wsent": 0.0, "score": None, "names": [self.name_of(a) for a in slots],
             "teams": setup.get("sideIds") if isinstance(setup.get("sideIds"), list) else None}
        self.games[gid] = g
        for a in slots:
            self.conns[a].game = gid
        if place and ci is not None:
            ct = self.court(place, ci)
            for i, l in enumerate(ct["lines"]):
                if l and (l["leader"] in slots or any(m in slots for m in l["members"])):
                    ct["lines"][i] = None
            ct["busy"] = {"kind": "game", "game": gid, "leader": conn.aid, "names": g["names"], "score": [0, 0]}
            self.push_courts(place)
        self.refresh_claims()  # (anyone in it is off the other claims he was on)
        self.send_to(slots, {"t": "start", "setup": setup})
        if place:
            self.send_to([w.aid for w in self.at(place) if w.aid not in slots], {"t": "watch", "setup": setup})
        for a in slots:
            self.push_presence(a)

    def place_games(self, place):
        return [{"game": g["id"], "court": g["court"], "names": g["names"], "score": g["score"]} for g in self.games.values() if g["where"] == place]

    def offer_watch(self, conn, place):
        """Arriving where a game is on: the game so far (its first minute is kept for this), or just its score."""
        for g in self.games.values():
            if g["where"] == place and conn.aid not in g["players"] and g["log"] is not None:
                conn.send({"t": "watch", "setup": g["setup"], "log": g["log"]})

    def relay(self, conn, msg):
        """A player's inputs: b holds one entry per tick from tick k on (each one the change from the tick before it,
        0 for no change: session.js). They go straight to the other players, encoded once; the people watching from
        the same place get them in bundles (WATCH_EVERY)."""
        g = self.games.get(conn.game)
        if not g or msg.get("g") != g["id"] or conn.aid not in g["slots"]:
            return
        k, b = msg.get("k"), msg.get("b")
        if not isinstance(k, int) or isinstance(k, bool) or not isinstance(b, list) or not 0 < len(b) <= MAX_BATCH:
            return
        if k != g["last"].get(conn.aid, 0) + 1:
            return  # (every tick once, in order: each entry builds on the one before)
        g["last"][conn.aid] = k + len(b) - 1
        s = g["slots"][conn.aid]
        fr = encode({"t": "in", "s": s, "k": k, "b": b, "g": g["id"]})
        for a in g["players"]:
            if a != conn.aid:
                c = self.conns.get(a)
                if c:
                    c.send_frame(fr)
        rec = [s, k, b]
        if g["log"] is not None:
            if time.time() - g["started"] < 60:
                g["log"].append(rec)
            else:
                g["log"] = None  # (past a minute in, late arrivals see the score instead of the game)
        if g["where"]:
            g["wbuf"].append(rec)
            now = time.monotonic()
            if now - g["wsent"] >= WATCH_EVERY:
                self.flush_watch(g, now)

    def flush_watch(self, g, now=None):
        """The inputs a game's watchers haven't had yet, in one message: {"t": "inw", "g", "m": [[slot, k, b]...]}."""
        if not g.get("wbuf"):
            return
        msg, g["wbuf"], g["wsent"] = {"t": "inw", "g": g["id"], "m": g["wbuf"]}, [], now or time.monotonic()
        fr = None
        for c in self.at(g["where"]):
            if c.aid not in g["players"]:
                if fr is None:
                    fr = encode(msg)
                c.send_frame(fr)

    def quit_game(self, conn, reason="left"):
        g = self.games.get(conn.game)
        conn.game = None
        if not g or conn.aid not in g["slots"]:
            return
        self.flush_watch(g)  # (the watchers have his last inputs before they hear he's gone)
        slot = g["slots"].pop(conn.aid)
        g["players"].discard(conn.aid)
        msg = {"t": "left", "slot": slot, "last": g["last"].get(conn.aid, 0), "id": conn.aid, "reason": reason, "g": g["id"]}
        self.send_to(set(g["players"]) | ({c.aid for c in self.at(g["where"])} if g["where"] else set()), msg, skip=conn.aid)
        if not g["players"]:
            self.finish(g, [])

    def end_game(self, conn, msg):
        g = self.games.get(msg.get("g"))
        if not g or conn.aid not in g["players"]:
            return
        winners = [a for a in (msg.get("winners") or []) if isinstance(a, str) and a in g["slots"]]
        self.finish(g, winners)

    def finish(self, g, winners):
        if g.get("over"):
            return
        g["over"] = True
        self.flush_watch(g)
        for a in list(g["players"]):
            c = self.conns.get(a)
            if c and c.game == g["id"]:
                c.game = None
        place, ci = g["where"], g["court"]
        if place and ci is not None:
            ct = self.court(place, ci)
            if ct["busy"] and ct["busy"].get("game") == g["id"]:
                ct["busy"] = None
            # whoever won holds the court (people, not the AI): their squad leader, if he played, leads them
            live_w = [a for a in winners if self.live(a)]
            if live_w:
                leaders = [a for a in live_w if self.leader_of(a) == a]
                lead = leaders[0] if leaders else live_w[0]
                prev = ct["kings"]
                ct["kings"] = {"leader": lead, "members": live_w, "names": [self.name_of(a) for a in live_w], "at": time.time(),
                               "streak": (prev["streak"] + 1) if prev and set(prev["members"]) & set(live_w) else 1}
            else:
                ct["kings"] = None
            self.push_courts(place)
            self.send_to([c.aid for c in self.at(place)], {"t": "watchend", "g": g["id"]})
        self.games.pop(g["id"], None)
        self.refresh_claims()  # (the players are free again: back on their squad's claims)
        for a in g["slots"]:
            self.push_presence(a)

    def score(self, conn, msg):
        g = self.games.get(conn.game)
        sc = msg.get("score")
        if not g or not isinstance(sc, list) or len(sc) != 2:
            return
        g["score"] = sc
        if g["where"] and g["court"] is not None:
            ct = self.court(g["where"], g["court"])
            if ct["busy"] and ct["busy"].get("game") == g["id"]:
                ct["busy"]["score"] = sc
            self.send_to([c.aid for c in self.at(g["where"]) if c.aid not in g["players"]], {"t": "courtscore", "court": g["court"], "score": sc, "names": g["names"]})

    # ---- invites: squads, Pro-Am challenges ----
    def sq_invite(self, conn, msg):
        target = msg.get("to")
        if not isinstance(target, str) or not are_friends(self.db, conn.aid, target):
            return conn.send({"t": "error", "text": "You can only invite your friends."})
        c = self.live(target)
        if not c:
            return conn.send({"t": "error", "text": "That friend isn't online."})
        if self.leader_of(conn.aid) != conn.aid:
            return conn.send({"t": "error", "text": "Your squad leader invites people."})
        if target in self.party(conn.aid):
            return conn.send({"t": "error", "text": "He's in your squad already."})
        if len(self.party(conn.aid)) >= MAX_SQUAD:
            return conn.send({"t": "error", "text": f"A squad is {MAX_SQUAD} at the most."})
        self.invites.setdefault(target, {})[conn.aid] = time.time()
        c.send({"t": "sqinvite", "from": conn.aid, "name": self.name_of(conn.aid), "username": conn.username, "park": conn.info.get("park"), "size": len(self.party(conn.aid))})
        conn.send({"t": "note", "text": f"Squad invite sent to {self.name_of(target)}."})

    def sq_accept(self, conn, msg):
        lead = msg.get("from")
        inv = self.invites.get(conn.aid, {})
        if lead not in inv or time.time() - inv[lead] > 600:
            return conn.send({"t": "error", "text": "That invite has run out."})
        del inv[lead]
        lc = self.live(lead)
        if not lc:
            return conn.send({"t": "error", "text": "He's gone offline."})
        if conn.game:
            return conn.send({"t": "error", "text": "Finish your game first."})
        if len(self.party(lead)) >= MAX_SQUAD:
            return conn.send({"t": "error", "text": "That squad is full."})
        self.leave_squad(conn)
        sq = self.squads.get(lc.squad) if lc.squad else None
        if not sq:
            sq = {"id": secrets.token_urlsafe(6), "leader": lead, "members": [lead]}
            self.squads[sq["id"]] = sq
            lc.squad = sq["id"]
        if sq["leader"] != lead:
            return conn.send({"t": "error", "text": "He isn't leading that squad any more."})
        sq["members"].append(conn.aid)
        conn.squad = sq["id"]
        self.push_squad(sq)
        self.push_squad_entries(sq)
        self.send_to(sq["members"], {"t": "note", "text": f"{self.name_of(conn.aid)} joined the squad."}, skip=conn.aid)
        self.refresh_claims()
        for m in sq["members"]:
            self.push_presence(m)

    def sq_kick(self, conn, msg):
        sq = self.squad_of(conn.aid)
        target = msg.get("id")
        if not sq or sq["leader"] != conn.aid or target not in sq["members"] or target == conn.aid:
            return
        c = self.conns.get(target)
        if c:
            self.leave_squad(c)
            c.send({"t": "note", "text": "You're out of the squad."})

    def challenge(self, conn, msg):
        target = msg.get("to")
        if not isinstance(target, str) or not are_friends(self.db, conn.aid, target):
            return conn.send({"t": "error", "text": "You can only challenge your friends."})
        c = self.live(target)
        if not c or c.game:
            return conn.send({"t": "error", "text": "He can't play right now."})
        if self.leader_of(conn.aid) != conn.aid:
            return conn.send({"t": "error", "text": "Your squad leader sets up games."})
        if target in self.party(conn.aid):
            return conn.send({"t": "error", "text": "He's in your squad: play together."})
        lead = self.leader_of(target)
        self.challenges.setdefault(lead, {})[conn.aid] = time.time()
        self.send_to([lead], {"t": "challenge", "from": conn.aid, "name": self.name_of(conn.aid), "username": conn.username, "size": len(self.party(conn.aid))})
        conn.send({"t": "note", "text": f"Pro-Am challenge sent to {self.name_of(lead)}{' (his squad leader)' if lead != target else ''}."})

    def challenge_reply(self, conn, msg):
        frm = msg.get("from")
        ch = self.challenges.get(conn.aid, {})
        if frm not in ch:
            return
        del ch[frm]
        fc = self.live(frm)
        if not fc:
            return conn.send({"t": "error", "text": "He's gone offline."})
        if not msg.get("ok"):
            return fc.send({"t": "note", "text": f"{self.name_of(conn.aid)} passed on the Pro-Am challenge."})
        team = [m for m in self.party(conn.aid) if self.live(m) and not self.conns[m].game]
        fc.send({"t": "challenge-go", "opp": {"leader": conn.aid, "members": team, "entries": {m: self.conns[m].entry for m in team if self.conns[m].entry},
                                               "usernames": {m: self.conns[m].username for m in team}, "rtts": {m: self.conns[m].info.get("rtt") for m in team},
                                               "ai": {m: self.conns[m].aisquad for m in team if self.conns[m].aisquad}}})
        conn.send({"t": "note", "text": f"{self.name_of(frm)} is setting up the Pro-Am game."})

    # ---- online crews: a crew's founder brings friends into it; his save keeps the crew and its XP ----
    def crew_payload(self, cid):
        cr = crew_row(self.db, cid)
        if not cr:
            return None
        mem = [r[0] for r in self.db.query("SELECT account_id FROM online_crew_members WHERE crew_id=? ORDER BY since", (cid,))]
        names = {r[0]: r[1] for r in self.db.query(f"SELECT id, username FROM accounts WHERE id IN ({','.join('?' * len(mem)) or 'NULL'})", mem)} if mem else {}
        return {"id": cid, "founder": cid, "name": cr["name"], "tag": cr["tag"], "color": cr["color"], "level": cr["level"], "xp": cr["xp"],
                "members": [{"id": m, "username": names.get(m, "?"), **self.presence_of(m)} for m in mem]}

    def push_crew(self, cid):
        pl = self.crew_payload(cid)
        if pl:
            self.send_to([m["id"] for m in pl["members"]], {"t": "crew", "crew": pl})

    def crew_sync(self, conn, msg):
        cr = msg.get("crew")
        if not isinstance(cr, dict):
            return
        mine = crew_of(self.db, conn.aid)
        if mine and mine != conn.aid:
            return conn.send({"t": "crew-error", "text": "You're in a friend's crew online: leave it to bring your own crew online."})
        name, tag, color = str(cr.get("name") or "")[:24], str(cr.get("tag") or "")[:4], str(cr.get("color") or "#888888")[:7]
        level = cr.get("level") if isinstance(cr.get("level"), int) else 1
        xp = cr.get("xp") if isinstance(cr.get("xp"), int) else 0
        if not name or not tag:
            return
        now = time.time()
        with self.db.transaction() as c:
            c.execute("INSERT INTO online_crews(id,name,tag,color,level,xp,pending_xp,updated_at) VALUES(?,?,?,?,?,?,0,?) "
                      "ON CONFLICT(id) DO UPDATE SET name=excluded.name, tag=excluded.tag, color=excluded.color, level=excluded.level, xp=excluded.xp, updated_at=excluded.updated_at",
                      (conn.aid, name, tag, color, max(1, min(40, level)), max(0, xp), now))
            c.execute("INSERT OR IGNORE INTO online_crew_members VALUES(?,?,?)", (conn.aid, conn.aid, now))
        self.push_crew(conn.aid)
        self.offer_crew_xp(conn.aid)

    def crew_invite(self, conn, msg):
        target = msg.get("to")
        if crew_of(self.db, conn.aid) != conn.aid:
            return conn.send({"t": "error", "text": "Only the crew's founder brings people in."})
        if not isinstance(target, str) or not are_friends(self.db, conn.aid, target):
            return conn.send({"t": "error", "text": "You can only add your friends."})
        if crew_of(self.db, target):
            return conn.send({"t": "error", "text": "He's in a crew online already."})
        if not self.live(target):
            return conn.send({"t": "error", "text": "That friend isn't online."})
        self.crew_invites.setdefault(target, {})[conn.aid] = time.time()
        cr = crew_row(self.db, conn.aid)
        self.send_to([target], {"t": "crewinvite", "crew": {"id": conn.aid, "name": cr["name"], "tag": cr["tag"], "color": cr["color"], "level": cr["level"]}, "from": self.name_of(conn.aid)})
        conn.send({"t": "note", "text": f"Crew invite sent to {self.name_of(target)}."})

    def crew_accept(self, conn, msg):
        cid = msg.get("crew")
        inv = self.crew_invites.get(conn.aid, {})
        if cid not in inv:
            return conn.send({"t": "error", "text": "That invite has run out."})
        del inv[cid]
        if crew_of(self.db, conn.aid):
            return conn.send({"t": "error", "text": "Leave your crew first."})
        if not crew_row(self.db, cid):
            return conn.send({"t": "error", "text": "That crew is gone."})
        n = self.db.query("SELECT COUNT(*) FROM online_crew_members WHERE crew_id=?", (cid,))[0][0]
        if n >= MAX_CREW:
            return conn.send({"t": "error", "text": "That crew is full."})
        with self.db.transaction() as c:
            c.execute("INSERT INTO online_crew_members VALUES(?,?,?)", (conn.aid, cid, time.time()))
        self.push_crew(cid)
        self.send_to([cid], {"t": "note", "text": f"{self.name_of(conn.aid)} joined the crew."})

    def crew_leave(self, conn, target=None):
        cid = crew_of(self.db, conn.aid)
        if not cid:
            return
        who = target or conn.aid
        if target and cid != conn.aid:
            return  # (only the founder removes people)
        if who == cid:  # the founder takes the crew offline: everyone's out
            mem = [r[0] for r in self.db.query("SELECT account_id FROM online_crew_members WHERE crew_id=?", (cid,))]
            with self.db.transaction() as c:
                c.execute("DELETE FROM online_crew_members WHERE crew_id=?", (cid,))
                c.execute("DELETE FROM online_crews WHERE id=?", (cid,))
            self.send_to(mem, {"t": "crew", "crew": None})
            return
        with self.db.transaction() as c:
            c.execute("DELETE FROM online_crew_members WHERE account_id=? AND crew_id=?", (who, cid))
        self.send_to([who], {"t": "crew", "crew": None})
        self.push_crew(cid)

    def crew_xp(self, conn, msg):
        """A member's game paid crew XP: it waits on the hub until the founder's game collects it into his save."""
        xp = msg.get("xp")
        cid = crew_of(self.db, conn.aid)
        if not cid or cid == conn.aid or not isinstance(xp, int) or isinstance(xp, bool) or not 0 < xp <= 5000:
            return
        with self.db.transaction() as c:
            c.execute("UPDATE online_crews SET pending_xp = pending_xp + ? WHERE id=?", (xp, cid))
        self.offer_crew_xp(cid)

    def offer_crew_xp(self, cid):
        cr = crew_row(self.db, cid)
        if cr and cr["pending_xp"] > 0:
            self.send_to([cid], {"t": "crew-pending", "xp": cr["pending_xp"]})

    def crew_ack(self, conn, msg):
        xp = msg.get("xp")
        if crew_of(self.db, conn.aid) == conn.aid and isinstance(xp, int) and xp > 0:
            with self.db.transaction() as c:
                c.execute("UPDATE online_crews SET pending_xp = MAX(0, pending_xp - ?) WHERE id=?", (xp, conn.aid))

    # ---- messages ----
    def handle(self, conn, msg):
        t = msg.get("t")
        if t == "in":  # the hot path: a player's input for a tick, passed on to the others in the game and its watchers
            with self.lock:
                self.relay(conn, msg)
            return
        if t == "pos":  # where he's walking (the others at the same place show him there), ~5 times a second
            place = conn.info.get("park")
            if place:
                fr = None
                for c in self.at(place, skip=conn.aid):
                    if fr is None:
                        fr = encode({"t": "pos", "from": conn.aid, **{k: msg.get(k) for k in ("x", "z", "f", "m") if isinstance(msg.get(k), (int, float)) and not isinstance(msg.get(k), bool)}})
                    c.send_frame(fr)
            return
        with self.lock:
            if t == "where":
                upd = {k: msg.get(k) for k in ("name", "status", "char") if k in msg and (msg.get(k) is None or isinstance(msg.get(k), str))}
                changed = any(conn.info.get(k) != v for k, v in upd.items())
                conn.info.update(upd)
                if isinstance(msg.get("rtt"), (int, float)) and not isinstance(msg.get("rtt"), bool):
                    rtt = max(0, min(2000, int(msg["rtt"])))  # (his round trip here: games pick their input delay from it)
                    if rtt != conn.info.get("rtt"):
                        conn.info["rtt"] = rtt
                        # (just the number, to the people who set up games with him: no presence round for it)
                        place = conn.info.get("park")
                        self.send_to({c.aid for c in self.at(place, skip=conn.aid)} | set(self.party(conn.aid)), {"t": "rtt", "id": conn.aid, "rtt": rtt}, skip=conn.aid)
                moved = False
                if "park" in msg and (msg["park"] is None or isinstance(msg["park"], str)):
                    place = (msg["park"] or None) if not msg["park"] or len(msg["park"]) <= 64 else None
                    moved = place != conn.info.get("park")
                    self.move(conn, place)
                if changed or moved:  # (friends' lists, his squad and his crew hear about it: a few database reads)
                    self.push_presence(conn.aid)
                if moved:
                    self.refresh_claims()
            elif t == "aisquad":  # the AI squad mates from his own game: they walk with him and run in his online squad
                ms = msg.get("members")
                if isinstance(ms, list) and len(ms) <= MAX_AI_SQUAD and len(json.dumps(ms)) < 200_000 and all(
                        isinstance(a, dict) and isinstance(a.get("id"), str) and 0 < len(a["id"]) <= 64 and isinstance(a.get("name"), str)
                        and isinstance(a.get("entry"), dict) and isinstance(a["entry"].get("build"), dict) for a in ms):
                    conn.aisquad = [{"id": a["id"], "name": a["name"][:40], "entry": a["entry"]} for a in ms]
                    place = conn.info.get("park")
                    if place:
                        self.send_to([c.aid for c in self.at(place, skip=conn.aid)], {"t": "pentry", **self.person(conn)})
                    sq = self.squad_of(conn.aid)
                    if sq:
                        self.push_squad(sq)
                        self.push_squad_entries(sq)
            elif t == "entry":  # his player as he plays (build, look, badges): the others where he is see him with it
                if isinstance(msg.get("entry"), dict) and len(json.dumps(msg["entry"])) < 200_000:
                    conn.entry = msg["entry"]
                    place = conn.info.get("park")
                    if place:
                        self.send_to([c.aid for c in self.at(place, skip=conn.aid)], {"t": "pentry", **self.person(conn)})
                    sq = self.squad_of(conn.aid)
                    if sq:
                        self.push_squad_entries(sq)
            elif t == "ping":
                conn.send({"t": "pong", "c": msg.get("c"), "s": time.time() * 1000})  # (v0.4.8.7: and the service's clock)
            elif t == "world":  # (v0.4.8.7: the shared AI world again: an event window closed, its prizes are in)
                conn.send({"t": "world", **self.world_payload()})
            elif t == "pop":  # (v0.4.8.7: the park's people as the park's host sees them, to everyone else there)
                # (qp7: only from the host picked here, and kept a moment for whoever arrives next)
                place = conn.info.get("park")
                if place and msg.get("place") == place and self.hosts.get(place, self.host_of(place)) == conn.aid:
                    out = {**msg, "from": conn.aid}
                    self.pops[place] = (time.monotonic(), out)
                    self.send_to([c.aid for c in self.at(place, skip=conn.aid)], out)
            elif t == "emote":
                self.emote(conn, msg)
            elif t == "friend":  # (qp3: friend requests on the socket: a game from your own copy has no cookie here)
                try:
                    if msg.get("action") not in ("add", "accept", "decline", "remove"):
                        raise ValueError("Unknown action.")
                    text = friend_action(self.db, conn.aid, msg.get("username") if isinstance(msg.get("username"), str) else "", msg["action"])
                except ValueError as e:
                    conn.send({"t": "error", "text": str(e)})
                else:
                    conn.send({"t": "note", "text": text})
                    other = self.db.query("SELECT id FROM accounts WHERE username=?", ((msg.get("username") or "").lower(),))
                    self.push_presence(conn.aid)
                    if other:
                        self.push_presence(other[0][0])
            elif t == "sq-invite":
                self.sq_invite(conn, msg)
            elif t == "sq-accept":
                self.sq_accept(conn, msg)
            elif t == "sq-decline":
                inv = self.invites.get(conn.aid, {})
                if msg.get("from") in inv:
                    del inv[msg["from"]]
                    self.send_to([msg["from"]], {"t": "note", "text": f"{self.name_of(conn.aid)} passed on the squad invite."})
            elif t == "sq-leave":
                self.leave_squad(conn)
                self.push_presence(conn.aid)
            elif t == "sq-kick":
                self.sq_kick(conn, msg)
            elif t == "claim":
                self.claim(conn, msg)
            elif t == "unclaim":
                self.unclaim(conn)
            elif t == "court":
                self.court_state(conn, msg)
            elif t == "release":
                self.release_court(conn, msg)
            elif t == "start":
                self.start(conn, msg)
            elif t == "end":  # (whoever finishes first: every client ends the game on the same tick)
                self.end_game(conn, msg)
            elif t == "quit":
                self.quit_game(conn, "left")
                self.push_presence(conn.aid)
            elif t == "score":
                self.score(conn, msg)
            elif t == "hash":
                g = self.games.get(conn.game)
                if g:
                    # (w: how long his screen waited on each seat's inputs since the last check: session.js lateReport)
                    w = msg.get("w") if isinstance(msg.get("w"), dict) and len(msg["w"]) <= 10 else None
                    w = {str(s)[:3]: v for s, v in w.items() if isinstance(v, (int, float)) and not isinstance(v, bool)} if w else None
                    self.send_to(g["players"], {"t": "hash", "k": msg.get("k"), "h": msg.get("h"), "w": w, "from": conn.aid, "name": conn.info.get("name")}, skip=conn.aid)
            elif t == "challenge":
                self.challenge(conn, msg)
            elif t == "challenge-reply":
                self.challenge_reply(conn, msg)
            elif t == "crew-sync":
                self.crew_sync(conn, msg)
            elif t == "crew-invite":
                self.crew_invite(conn, msg)
            elif t == "crew-accept":
                self.crew_accept(conn, msg)
            elif t == "crew-leave":
                self.crew_leave(conn)
            elif t == "crew-kick":
                if isinstance(msg.get("id"), str):
                    self.crew_leave(conn, msg["id"])
            elif t == "crewxp":
                self.crew_xp(conn, msg)
            elif t == "crew-ack":
                self.crew_ack(conn, msg)

    # ---- the socket loop (runs on the request's handler thread) ----
    def sign_in(self, conn):
        """qp3: a game from another origin (a friend's own copy) signs in on the socket first: a token from before, or
        his online account here (sign in / make one with the join code). A few tries, then the socket is closed."""
        tries, until = 0, time.monotonic() + 1800  # (half an hour on the sign-in form; six wrong tries)
        while tries < 6 and time.monotonic() < until:
            try:
                msg = json.loads(conn.recv())
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("t") == "ping":
                conn.send({"t": "pong", "c": msg.get("c"), "s": time.time() * 1000})
                continue
            if msg.get("t") == "hi" and self.authenticator:  # (the version check on its own, as soon as the socket opens)
                try:
                    self.authenticator({"t": "hi", "build": msg.get("build")}, conn.ip)
                    conn.send({"t": "hubinfo"})
                except AuthError as e:
                    conn.send({"t": "autherror", "code": e.code, "text": e.text})
                    if e.code == "version":
                        return False
                continue
            if msg.get("t") not in ("auth", "login", "register"):
                continue  # (nothing else counts until he's signed in)
            tries += 1
            try:
                if not self.authenticator:
                    raise AuthError("auth", "This game isn't hosting online play.")
                aid, username, token = self.authenticator(msg, conn.ip)
            except AuthError as e:
                conn.send({"t": "autherror", "code": e.code, "text": e.text})
                if e.code == "version":
                    return False
                continue
            conn.aid, conn.username, conn.info["name"] = aid, username, username
            conn.send({"t": "authed", "token": token, "you": {"id": aid, "username": username}})
            return True
        return False

    def serve(self, conn):
        try:
            if conn.aid is None and not self.sign_in(conn):
                conn.close(4001)
                conn.drain(2.0)  # (he gets the reason before the socket closes)
                return
        except (WSClosed, OSError, ValueError):
            conn.alive = False
            conn.stop()
            return
        self.connect(conn)
        try:
            while conn.alive:
                raw = conn.recv()
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(msg, dict):
                    self.handle(conn, msg)
        except (WSClosed, OSError, ValueError):
            pass
        finally:
            conn.alive = False
            self.disconnect(conn)
            conn.stop()
