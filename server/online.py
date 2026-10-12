"""v0.4.7.5 qp3: playing online with friends.

The game service can be hosted for a few friends (host.cmd, or `python -m server.app --online`): it listens on every
network interface, new accounts need the host's join code, and the local dev account stays local-only. Everyone plays
in their own browser against this one service, so the accounts, the store, the progression and the rewards are the
same ones the single-player game uses.

What this module adds:

* Friends between real players (people with an account on this service): requests by username, accepted or declined,
  stored in `online_friends` (one row per direction: friends / requested / incoming).
* A WebSocket (`/api/ws`, implemented here on the standard library: RFC 6455 framing, text frames only) that carries
  presence (who of your friends is on, at which park, in a game or not), invites, rooms and the games themselves.
* Rooms: a host and up to five friends who play together. The host sets the run up (mode, court, sides) and starts it;
  the clients run the game in lockstep (client/js/game/session.js): every client simulates the same game from the same
  seed and rosters, and each one sends its own player's input for a tick a few ticks ahead; the service only relays
  them, in order, to the rest of the room. A member who leaves mid-game is handed to the AI at the same tick on every
  client (the last tick the service relayed for him).

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
MAX_ROOM = 6
MAX_FRIENDS = 100
INPUT_KEYS = ("t", "k", "i")


class WSClosed(Exception):
    pass


class AuthError(Exception):
    """A sign-in on the socket that didn't work: code (version / token / auth / rate) and the words for the player."""

    def __init__(self, code, text):
        super().__init__(text)
        self.code, self.text = code, text


def accept_key(key):
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


class WSConn:
    """One browser's socket. Reads happen on the handler thread; sends can come from any thread (the lock)."""

    def __init__(self, rfile, wfile, sock, aid, username):
        self.rfile, self.wfile, self.sock = rfile, wfile, sock
        self.aid, self.username = aid, username
        self.lock = threading.Lock()
        self.alive = True
        self.info = {"name": username, "park": None, "status": "menu", "char": None}
        self.room = None
        self.ip = None
        self.connected_at = time.time()

    # ---- framing ----
    def send(self, obj):
        if not self.alive:
            return False
        data = json.dumps(obj, separators=(",", ":")).encode()
        n = len(data)
        head = bytes([0x81]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack("!H", n) if n < 65536 else bytes([127]) + struct.pack("!Q", n))
        try:
            with self.lock:
                self.wfile.write(head + data)
                self.wfile.flush()
            return True
        except (OSError, ValueError):
            self.alive = False
            return False

    def _control(self, opcode, payload=b""):
        try:
            with self.lock:
                self.wfile.write(bytes([0x80 | opcode, len(payload)]) + payload)
                self.wfile.flush()
        except (OSError, ValueError):
            self.alive = False

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
            payload = bytearray(self._read(n))
            for i in range(n):
                payload[i] ^= mask[i & 3]
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
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


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


# ---------------- the hub: presence, invites, rooms, relay ----------------
class Hub:
    def __init__(self, db, authenticator=None):
        self.db = db
        self.authenticator = authenticator  # (qp3: sign-ins from your friends' own copies: Service.online_auth)
        self.lock = threading.RLock()
        self.conns = {}   # account id -> WSConn
        self.rooms = {}   # room id -> room dict

    # ---- presence ----
    def presence_of(self, aid):
        c = self.conns.get(aid)
        if not c or not c.alive:
            return {"online": False}
        r = self.rooms.get(c.room) if c.room else None
        return {"online": True, **c.info, "room": c.room, "host": bool(r and r["host"] == aid), "playing": bool(r and r["status"] == "playing")}

    def friends_payload(self, aid):
        out = []
        for r in friends_rows(self.db, aid):
            fid = r["friend_id"]
            out.append({"id": fid, "username": r["username"], "status": r["status"], **({"presence": self.presence_of(fid)} if r["status"] == "friends" else {})})
        return out

    def push_presence(self, aid):
        """Tell aid's online friends (and aid) the new state of things."""
        with self.lock:
            targets = [aid] + [r["friend_id"] for r in friends_rows(self.db, aid) if r["status"] in ("friends", "incoming", "requested")]
            for t in targets:
                c = self.conns.get(t)
                if c and c.alive:
                    c.send({"t": "friends", "friends": self.friends_payload(t)})

    def connect(self, conn):
        with self.lock:
            old = self.conns.get(conn.aid)
            if old and old is not conn:
                old.send({"t": "replaced"})
                self.leave_room(old, reason="replaced")
                old.close(4000)
            self.conns[conn.aid] = conn
        conn.send({"t": "hello", "you": {"id": conn.aid, "username": conn.username}, "friends": self.friends_payload(conn.aid)})
        self.push_presence(conn.aid)

    def disconnect(self, conn):
        with self.lock:
            self.leave_room(conn, reason="disconnected")
            if self.conns.get(conn.aid) is conn:
                del self.conns[conn.aid]
        self.push_presence(conn.aid)

    # ---- rooms ----
    def room_state(self, r):
        return {"id": r["id"], "host": r["host"], "status": r["status"], "config": r["config"], "park": r["park"],
                "game": r["game"], "members": [self.member_state(r, m) for m in r["members"]]}

    def member_state(self, r, m):
        c = self.conns.get(m)
        info = c.info if c else {}
        return {"id": m, "username": c.username if c else "?", "name": info.get("name") or "?", "char": info.get("char"), "park": info.get("park"),
                "status": info.get("status"), "ready": m in r["entries"], "rtt": r["rtt"].get(m)}

    def broadcast(self, r, msg, skip=None):
        for m in list(r["members"]):
            if m == skip:
                continue
            c = self.conns.get(m)
            if c and c.alive:
                c.send(msg)

    def send_entries(self, r):
        """Everyone's player (the host sets the game up with them; the others see their friends walk the park)."""
        self.broadcast(r, {"t": "entries", "room": r["id"], "entries": {m: e for m, e in r["entries"].items() if m in r["members"]}})

    def push_room(self, r):
        self.broadcast(r, {"t": "room", "room": self.room_state(r)})

    def make_room(self, conn):
        rid = secrets.token_urlsafe(6)
        r = {"id": rid, "host": conn.aid, "members": [conn.aid], "status": "lobby", "config": {}, "park": conn.info.get("park"),
             "invited": set(), "entries": {}, "slots": {}, "last": {}, "rtt": {}, "game": 0}
        self.rooms[rid] = r
        conn.room = rid
        return r

    def leave_room(self, conn, reason="left"):
        rid = conn.room
        conn.room = None
        r = self.rooms.get(rid)
        if not r or conn.aid not in r["members"]:
            return
        r["members"].remove(conn.aid)
        r["entries"].pop(conn.aid, None)
        if r["status"] == "playing" and conn.aid in r["slots"]:
            # everyone hands his player to the AI after the last input the service passed on for him
            self.broadcast(r, {"t": "left", "slot": r["slots"][conn.aid], "last": r["last"].get(conn.aid, 0), "id": conn.aid, "reason": reason})
            r["slots"].pop(conn.aid, None)
        if not r["members"]:
            del self.rooms[rid]
            return
        if r["host"] == conn.aid:
            r["host"] = r["members"][0]
            self.broadcast(r, {"t": "note", "text": "The host left: the room is yours now." if len(r["members"]) == 1 else "The host left; a new host takes over."})
            self.send_entries(r)
        self.push_room(r)
        for m in r["members"]:
            self.push_presence(m)

    # ---- messages ----
    def handle(self, conn, msg):
        t = msg.get("t")
        if t == "in":  # the hot path: a player's input for a tick, passed on to the rest of the room
            r = self.rooms.get(conn.room)
            if not r or r["status"] != "playing" or conn.aid not in r["slots"]:
                return
            k, slot = msg.get("k"), r["slots"].get(conn.aid)
            if not isinstance(k, int) or isinstance(k, bool) or slot is None or k <= r["last"].get(conn.aid, 0) or msg.get("g") != r["game"]:
                return
            r["last"][conn.aid] = k
            out = {"t": "in", "s": slot, "k": k, "i": msg.get("i"), "g": r["game"]}
            for m in r["members"]:
                if m != conn.aid:
                    c = self.conns.get(m)
                    if c:
                        c.send(out)
            return
        if t == "pos":  # where a room member is walking in the park (the others show him there), ~5 times a second
            r = self.rooms.get(conn.room)
            if r and r["status"] != "playing":
                out = {"t": "pos", "from": conn.aid, **{k: msg.get(k) for k in ("x", "z", "f", "m", "park") if isinstance(msg.get(k), (int, float, str))}}
                for m in list(r["members"]):
                    if m != conn.aid:
                        c = self.conns.get(m)
                        if c:
                            c.send(out)
            return
        with self.lock:
            if t == "where":
                conn.info.update({k: msg.get(k) for k in ("name", "park", "status", "char") if k in msg and (msg.get(k) is None or isinstance(msg.get(k), str))})
                self.push_presence(conn.aid)
                r = self.rooms.get(conn.room)
                if r:
                    self.push_room(r)
            elif t == "ping":
                conn.send({"t": "pong", "c": msg.get("c")})
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
            elif t == "rtt":
                r = self.rooms.get(conn.room)
                if r and isinstance(msg.get("ms"), (int, float)):
                    r["rtt"][conn.aid] = round(float(msg["ms"]), 1)
            elif t == "invite":
                self.invite(conn, msg)
            elif t == "join":
                self.join(conn, msg.get("room"))
            elif t == "leave":
                self.leave_room(conn)
                conn.send({"t": "room", "room": None})
                self.push_presence(conn.aid)
            elif t == "create":
                if conn.room:
                    self.leave_room(conn)
                r = self.make_room(conn)
                self.push_room(r)
                self.push_presence(conn.aid)
            elif t == "entry":  # a member's player as he'll play (build, look, badges): for the host's setup
                r = self.rooms.get(conn.room)
                if r and isinstance(msg.get("entry"), dict):
                    r["entries"][conn.aid] = msg["entry"]
                    self.send_entries(r)
                    self.push_room(r)
            elif t == "config":
                r = self.rooms.get(conn.room)
                if r and r["host"] == conn.aid and isinstance(msg.get("config"), dict):
                    r["config"] = msg["config"]
                    if msg.get("park"):
                        r["park"] = msg["park"]
                    self.push_room(r)
            elif t == "entries":  # the host asks for everyone's player entries (anyone missing is asked for his)
                r = self.rooms.get(conn.room)
                if r and r["host"] == conn.aid:
                    self.send_entries(r)
                    for m in r["members"]:
                        if m not in r["entries"] and m in self.conns:
                            self.conns[m].send({"t": "need-entry"})
            elif t == "start":
                self.start(conn, msg)
            elif t == "end":  # (whoever finishes first: every client ends the game on the same tick)
                r = self.rooms.get(conn.room)
                if r and r["status"] == "playing" and msg.get("g") == r["game"]:
                    r["status"] = "lobby"
                    r["slots"], r["last"] = {}, {}
                    self.push_room(r)
                    for m in r["members"]:
                        self.push_presence(m)
            elif t in ("hash", "chat", "go"):
                r = self.rooms.get(conn.room)
                if r:
                    out = {**{k: v for k, v in msg.items() if k in ("t", "k", "h", "text", "where")}, "from": conn.aid, "name": conn.info.get("name")}
                    self.broadcast(r, out, skip=conn.aid if t == "hash" else None)

    def invite(self, conn, msg):
        target = msg.get("to")
        if not isinstance(target, str) or not are_friends(self.db, conn.aid, target):
            conn.send({"t": "error", "text": "You can only invite your friends."})
            return
        c = self.conns.get(target)
        if not c or not c.alive:
            conn.send({"t": "error", "text": "That friend isn't online."})
            return
        r = self.rooms.get(conn.room) or self.make_room(conn)
        if len(r["members"]) >= MAX_ROOM:
            conn.send({"t": "error", "text": f"A room holds {MAX_ROOM} players."})
            return
        if r["status"] == "playing":
            conn.send({"t": "error", "text": "Finish this game first."})
            return
        r["invited"].add(target)
        c.send({"t": "invite", "room": r["id"], "from": conn.aid, "name": conn.info.get("name"), "username": conn.username, "park": r.get("park") or conn.info.get("park")})
        conn.send({"t": "note", "text": f"Invite sent to {c.info.get('name') or c.username}."})
        self.push_room(r)
        self.push_presence(conn.aid)

    def join(self, conn, rid):
        r = self.rooms.get(rid)
        if not r:
            conn.send({"t": "error", "text": "That room is gone."})
            return
        if conn.aid not in r["invited"] and not are_friends(self.db, conn.aid, r["host"]):
            conn.send({"t": "error", "text": "You need an invite to that room."})
            return
        if r["status"] == "playing":
            conn.send({"t": "error", "text": "They're in a game. Join after it."})
            return
        if len(r["members"]) >= MAX_ROOM and conn.aid not in r["members"]:
            conn.send({"t": "error", "text": "That room is full."})
            return
        if conn.room and conn.room != rid:
            self.leave_room(conn)
        if conn.aid not in r["members"]:
            r["members"].append(conn.aid)
        conn.room = rid
        r["invited"].discard(conn.aid)
        self.push_room(r)
        for m in r["members"]:
            self.push_presence(m)

    def start(self, conn, msg):
        r = self.rooms.get(conn.room)
        if not r or r["host"] != conn.aid:
            conn.send({"t": "error", "text": "Only the host starts the game."})
            return
        setup = msg.get("setup")
        if not isinstance(setup, dict) or not isinstance(setup.get("slots"), dict):
            conn.send({"t": "error", "text": "Bad game setup."})
            return
        slots = {aid: s for aid, s in setup["slots"].items() if aid in r["members"] and isinstance(s, int)}
        r["status"], r["slots"], r["last"] = "playing", slots, {}
        r["game"] += 1
        setup["game"] = r["game"]
        self.broadcast(r, {"t": "start", "setup": setup})
        for m in r["members"]:
            self.push_presence(m)

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
                conn.send({"t": "pong", "c": msg.get("c")})
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
                return
        except (WSClosed, OSError, ValueError):
            conn.alive = False
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
