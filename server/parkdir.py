"""v0.4.8.7: the online server runs the park (the park director, behind RIMRIFT_PARK_DIRECTOR).

Every client at a park plays the same deterministic park (client/js/game/parkdirector.js): a tick a second of this
server's clock from the park's epoch start t0, seeded per epoch. This module is the part that has to be in one place:

* the epoch: made when the first player arrives (a few seconds' grace first, for clients still running the park from
  before a restart to hand it back: presume), dropped a minute after the last one leaves;
* the events, in one order (pev: {k, n, ev}): the real players' claims and the courts they hold, read off the hub's
  court state whenever it changes (court, claim), a player gone (gone), and their own moves as pacts (squad, lend,
  free, ready), checked here first: the place and epoch, the court and spot, the ids, the rate;
* a watermark a tick (pt: every event for ticks up to k has been sent: a client plays a tick only after it);
* the agreed state: each client's hash every 10 ticks (pcheck), the state with it every 60. The hash most clients have
  (ties: whoever has been there longest) is the park's: a client with another one gets the park again (presync); the
  state behind an agreed hash every 60 ticks becomes the snapshot newcomers start from, and the log is cut there.

The server never runs the park itself: it orders, checks, keeps and compares.
"""
import json
import os
import re
import secrets
import threading
import time

AI_ID = re.compile(r"^ai-\d{1,4}$")
PACTS = ("squad", "lend", "free", "ready")
CHECK_EVERY, SNAP_EVERY = 10, 60
GRACE = 3.0          # (s: a new epoch waits this long for a client handing the old one back)
LINGER = 60.0        # (s: an empty park keeps its epoch this long)
PACT_RATE = (30, 10.0)  # (at most 30 pacts in 10 s from one client)
MAX_STATE = 256 * 1024
MAX_LOG = 20000
DECIDE_AFTER = 6.0   # (s: a check is decided once everyone there has sent theirs, or this long after the first)


def enabled(value=None):
    """RIMRIFT_PARK_DIRECTOR: on unless set to 0 / false / off / no."""
    v = os.environ.get("RIMRIFT_PARK_DIRECTOR", "1") if value is None else value
    return str(v).strip().lower() not in ("0", "false", "off", "no", "")


def is_park(place):
    return isinstance(place, str) and bool(place) and not place.startswith("hq:")


def ints(v):
    return isinstance(v, int) and not isinstance(v, bool)


class Session:
    def __init__(self, place, now_ms, epoch=None, t0=None, seed=None):
        self.place = place
        self.epoch = epoch if epoch is not None else secrets.randbelow(2 ** 31 - 1) + 1
        self.t0 = int(t0 if t0 is not None else now_ms)
        self.seed = seed if seed is not None else secrets.randbelow(2 ** 31 - 1) + 1
        self.n = 0
        self.sid = secrets.randbelow(2 ** 31 - 1) + 1  # (this server's series of events: n counts from 1 in it)
        self.log = []          # [(k, n, ev)]
        self.snap = None       # {"k", "s", "h"}
        self.w = -1            # the watermark sent
        self.checks = {}       # k -> {"at": monotonic, "h": {aid: hash}}
        self.real = {}         # court index -> 0/1 (real people hold it)
        self.claims = {}       # court index -> [leader|None, leader|None]
        self.lent = {}         # ai id -> (aid, court): what each player lent (only he hands it back)
        self.pending = None    # monotonic deadline while waiting for a presume
        self.waiting = set()   # (aids to send the state to when the grace is over)
        self.empty = None      # monotonic time the last player left


class ParkDirector:
    """The hub's park sessions (online.Hub.parks). Called with the hub's lock held."""

    def __init__(self, hub, clock=time.time, mono=time.monotonic, grace=GRACE, linger=LINGER, auto=False):
        self.hub, self.clock, self.mono, self.grace, self.linger, self.auto = hub, clock, mono, grace, linger, auto
        self.sessions = {}
        self.rate = {}         # aid -> [monotonic times of recent pacts]
        self.wanted = {}       # aid -> monotonic time of the last pwant answered
        self.stopped = False

    # ---- time ----
    def now_ms(self):
        return int(self.clock() * 1000)

    def tick_of(self, s):
        return (self.now_ms() - s.t0) // 1000

    # ---- who's there ----
    def there(self, place):
        return [c.aid for c in self.hub.at(place)]

    def state_msg(self, s, t="pstate"):
        return {"t": t, "place": s.place, "pd": 1, "epoch": s.epoch, "t0": s.t0, "seed": s.seed, "k": self.tick_of(s), "w": s.w, "n": s.n, "sid": s.sid,
                "snap": {"k": s.snap["k"], "s": s.snap["s"]} if s.snap else None,
                "log": [{"k": k, "n": n, "ev": ev} for k, n, ev in s.log if not s.snap or k > s.snap["k"]]}

    def send_state(self, s, aids, t="pstate"):
        if aids:
            self.hub.send_to(list(aids), self.state_msg(s, t))

    # ---- arriving, leaving ----
    def arrive(self, conn, place):
        if self.stopped or not is_park(place):
            return
        if not getattr(self, "thread", None) and self.auto:
            self.thread = self.start()  # (the tick's pulse: from the first park arrival on)
        s = self.sessions.get(place)
        if s is None:
            s = self.sessions[place] = Session(place, self.now_ms())
            s.pending = self.mono() + self.grace
        s.empty = None
        if s.pending is not None:
            s.waiting.add(conn.aid)
        else:
            self.send_state(s, [conn.aid])

    def leave(self, aid, place):
        s = self.sessions.get(place)
        if not s:
            return
        s.waiting.discard(aid)
        if s.pending is None:
            self.stamp(s, {"e": "gone", "from": aid})
        for id_ in [i for i, (a, _) in s.lent.items() if a == aid]:
            del s.lent[id_]
        if not self.there(place):
            s.empty = self.mono()

    # ---- the order of things ----
    def stamp(self, s, ev):
        """An event for the next tick nobody has been told is complete, in one order for everyone there."""
        k = max(self.tick_of(s) + 1, s.w + 1)
        s.n += 1
        s.log.append((k, s.n, ev))
        if len(s.log) > MAX_LOG:
            del s.log[: len(s.log) - MAX_LOG]
        self.hub.send_to(self.there(s.place), {"t": "pev", "place": s.place, "epoch": s.epoch, "sid": s.sid, "k": k, "n": s.n, "ev": ev})
        return k

    def read_courts(self, s, quiet=False):
        """The real players' side of the courts, from the hub's court state: a court they hold (a game on it, or kings), and
        whose Got Next claim is on each spot. Changes become events."""
        cts = self.hub.courts.get(s.place, {})
        for ci in sorted(set(cts) | set(s.real) | set(s.claims)):
            ct = cts.get(ci) or {"lines": [None, None], "kings": None, "busy": None}
            real = 1 if (ct.get("busy") or ct.get("kings")) else 0
            claims = [(l or {}).get("leader") for l in (ct.get("lines") or [None, None])][:2]
            claims += [None] * (2 - len(claims))
            was = s.claims.get(ci, [None, None])
            for r in (0, 1):
                if claims[r] != was[r] and not quiet:
                    self.stamp(s, {"e": "claim", "c": ci, "r": r, "aid": claims[r]})
            if real != s.real.get(ci, 0) and not quiet:
                self.stamp(s, {"e": "court", "c": ci, "real": real})
            s.real[ci], s.claims[ci] = real, claims

    def courts_changed(self, place):
        s = self.sessions.get(place)
        if s and s.pending is None:
            self.read_courts(s)

    # ---- the players' pacts, checked ----
    def holds(self, aid, place, ci):
        """Does he have something to do with court ci: his claim on it, his game on it, him among its kings?"""
        ct = self.hub.courts.get(place, {}).get(ci)
        if not ct:
            return False
        if any(l and (l.get("leader") == aid or aid in (l.get("members") or [])) for l in ct.get("lines") or []):
            return True
        b, kg = ct.get("busy"), ct.get("kings")
        if b and (b.get("leader") == aid or (b.get("kind") == "game" and aid in (self.hub.games.get(b.get("game")) or {}).get("players", ()))):
            return True
        return bool(kg and aid in (kg.get("members") or []))

    def pact(self, conn, msg):
        place = conn.info.get("park")
        s = self.sessions.get(place)
        a = msg.get("a")
        if not s or s.pending is not None or msg.get("place") != place or msg.get("epoch") != s.epoch or a not in PACTS:
            return
        now = self.mono()
        times = [t for t in self.rate.get(conn.aid, []) if now - t < PACT_RATE[1]]
        if len(times) >= PACT_RATE[0]:
            self.rate[conn.aid] = times
            return
        times.append(now)
        self.rate[conn.aid] = times
        ids = msg.get("ids")
        ids = [i for i in ids if isinstance(i, str) and AI_ID.match(i)][:10] if isinstance(ids, list) else []
        ci = msg.get("c")
        if a == "squad":
            return self.stamp(s, {"e": "squad", "from": conn.aid, "ids": list(dict.fromkeys(ids))[:4]})
        if not ints(ci) or not 0 <= ci < 16:
            return
        ct = self.hub.courts.get(place, {}).get(ci)
        if a == "ready":
            if ct and any(l and l.get("leader") == conn.aid for l in ct["lines"]):
                return self.stamp(s, {"e": "ready", "from": conn.aid, "c": ci})
            return
        if not ids:
            return
        if a == "lend":
            r = msg.get("r")
            if r is not None:  # (onto his Got Next spot: his claim, that spot)
                if r not in (0, 1) or not ct or not ct["lines"][r] or ct["lines"][r].get("leader") != conn.aid:
                    return
            elif not self.holds(conn.aid, place, ci):
                return
            for i in ids:
                s.lent[i] = (conn.aid, ci)
            return self.stamp(s, {"e": "lend", "from": conn.aid, "c": ci, **({"r": r} if r is not None else {}), "ids": ids})
        if a == "free":  # (only what he lent)
            ids = [i for i in ids if s.lent.get(i, (None,))[0] == conn.aid]
            if not ids:
                return
            for i in ids:
                del s.lent[i]
            ks = msg.get("ks")
            kings = 1 if msg.get("kings") and ints(ks) else 0
            return self.stamp(s, {"e": "free", "from": conn.aid, "c": ci, "ids": ids, **({"kings": 1, "ks": max(0, min(99, ks))} if kings else {})})

    # ---- agreeing on the park ----
    def check(self, conn, msg):
        place = conn.info.get("park")
        s = self.sessions.get(place)
        k, h = msg.get("k"), msg.get("h")
        if not s or s.pending is not None or msg.get("place") != place or msg.get("epoch") != s.epoch or not ints(k) or not ints(h) or k % CHECK_EVERY or not 0 <= k <= self.tick_of(s) + 2:
            return
        c = s.checks.setdefault(k, {"at": self.mono(), "h": {}, "s": {}})
        c["h"][conn.aid] = h
        st = msg.get("s")
        if k % SNAP_EVERY == 0 and isinstance(st, dict) and st.get("k") == k and len(json.dumps(st)) <= MAX_STATE:
            c["s"].setdefault(h, st)
        self.decide(s)

    def decide(self, s, force=False):
        there = self.there(s.place)
        order = {a: (c.info.get("arrived", 0), str(a)) for a in there for c in [self.hub.conns.get(a)] if c}
        for k in sorted(s.checks):
            c = s.checks[k]
            got = {a: h for a, h in c["h"].items() if a in order}
            if not got:
                if self.mono() - c["at"] > DECIDE_AFTER:
                    del s.checks[k]
                continue
            if not (force or all(a in got for a in there) or self.mono() - c["at"] > DECIDE_AFTER):
                break
            del s.checks[k]
            votes = {}
            for a, h in got.items():
                votes.setdefault(h, []).append(a)
            best = min(votes, key=lambda h: (-len(votes[h]), min(order[a] for a in votes[h])))
            if best in c["s"] and (not s.snap or k > s.snap["k"]):
                s.snap = {"k": k, "s": c["s"][best], "h": best}
                s.log = [x for x in s.log if x[0] > k]
            off = [a for h, aids in votes.items() if h != best for a in aids]
            if off:
                self.send_state(s, off, "presync")

    def want(self, conn, msg):
        place = conn.info.get("park")
        s = self.sessions.get(place)
        now = self.mono()
        if not s or s.pending is not None or msg.get("place") != place or now - self.wanted.get(conn.aid, -99) < 3:
            return
        self.wanted[conn.aid] = now
        self.send_state(s, [conn.aid])

    def resume(self, conn, msg):
        """After a restart: a client still running the park hands it back, while its new epoch waits (or it has none)."""
        place = conn.info.get("park")
        s = self.sessions.get(place)
        if not is_park(place) or msg.get("place") != place or (s and s.pending is None):
            return
        ep, t0, seed, k, st, h = (msg.get(x) for x in ("epoch", "t0", "seed", "k", "s", "h"))
        now = self.now_ms()
        if not (ints(ep) and ints(t0) and ints(seed) and ints(k) and ints(h) and isinstance(st, dict) and st.get("k") == k and st.get("epoch") == ep):
            return
        if not (now - 7 * 86400000 <= t0 <= now and 0 <= k <= (now - t0) // 1000 + 2 and len(json.dumps(st)) <= MAX_STATE):
            return
        waiting = (s.waiting if s else set()) | {conn.aid}
        n = Session(place, now, epoch=ep, t0=t0, seed=seed)
        n.snap = {"k": k, "s": st, "h": h}
        n.w = k
        # (the courts as that park had them; what changed while the server was down comes in as events)
        for ci, c in enumerate(st.get("courts") or []):
            if isinstance(c, dict):
                n.real[ci] = 1 if c.get("real") else 0
                cl = c.get("claim") if isinstance(c.get("claim"), list) else [None, None]
                n.claims[ci] = [x if isinstance(x, str) else None for x in (cl + [None, None])[:2]]
        self.sessions[place] = n
        self.read_courts(n)
        self.send_state(n, [a for a in waiting if a in self.there(place)] or self.there(place))

    def handle(self, conn, msg):
        t = msg.get("t")
        if self.stopped:
            return
        if t == "pact":
            self.pact(conn, msg)
        elif t == "pcheck":
            self.check(conn, msg)
        elif t == "pwant":
            self.want(conn, msg)
        elif t == "presume":
            self.resume(conn, msg)

    # ---- once a quarter second ----
    def pulse(self):
        now = self.mono()
        for place, s in list(self.sessions.items()):
            if s.empty is not None and now - s.empty > self.linger and not self.there(place):
                del self.sessions[place]
                continue
            if s.pending is not None:
                if now < s.pending:
                    continue
                s.pending = None
                s.t0 = self.now_ms()  # (nobody handed one back: a fresh park from now)
                self.read_courts(s)  # (the courts real people hold already: the first tick's events)
                self.send_state(s, [a for a in s.waiting if a in self.there(place)])
                s.waiting = set()
            k = self.tick_of(s)
            if k > s.w:
                s.w = k
                self.hub.send_to(self.there(place), {"t": "pt", "place": place, "epoch": s.epoch, "k": k})
            if s.checks:
                self.decide(s)

    def start(self, every=0.25):
        def run():
            while not self.stopped:
                time.sleep(every)
                try:
                    with self.hub.lock:
                        self.pulse()
                except Exception as e:  # (never let it stop: the parks would freeze)
                    print(f"Park director: {e}", flush=True)
        th = threading.Thread(target=run, name="park-director", daemon=True)
        th.start()
        return th
