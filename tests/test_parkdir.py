"""v0.4.8.7: the online server runs the park (server/parkdir.py): the epoch, the events in one order, the watermark, the
players' pacts checked, the clients' hashes compared, the snapshot kept, the park handed back after a restart.
Run: python3 -m unittest discover -s tests -p 'test_*.py'"""
import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server import parkdir  # noqa: E402


class Conn:
    def __init__(self, aid, n):
        self.aid, self.alive, self.sent = aid, True, []
        self.info = {"park": None, "arrived": n}


class Hub:
    def __init__(self):
        self.conns, self.courts, self.games, self.lock = {}, {}, {}, threading.RLock()

    def at(self, place, skip=None):
        return [c for c in self.conns.values() if c.alive and c.info.get("park") == place and c.aid != skip]

    def send_to(self, aids, msg, skip=None):
        for a in aids:
            if a != skip and a in self.conns:
                self.conns[a].sent.append(msg)


class Clock:
    def __init__(self):
        self.t, self.m = 1_790_000_000.0, 100.0

    def wall(self):
        return self.t

    def mono(self):
        return self.m

    def go(self, s):
        self.t += s
        self.m += s


def court(place_courts, ci, lines=None, busy=None, kings=None):
    place_courts[ci] = {"lines": lines or [None, None], "busy": busy, "kings": kings}


class ParkDirTest(unittest.TestCase):
    def setUp(self):
        self.hub, self.clk = Hub(), Clock()
        self.pd = parkdir.ParkDirector(self.hub, clock=self.clk.wall, mono=self.clk.mono)

    def join(self, aid, place="harbor"):
        c = self.hub.conns.get(aid) or Conn(aid, len(self.hub.conns) + 1)
        self.hub.conns[aid] = c
        c.info["park"] = place
        self.pd.arrive(c, place)
        return c

    def msgs(self, c, t):
        return [m for m in c.sent if m.get("t") == t]

    def started(self):
        a = self.join("a")
        self.assertEqual(self.msgs(a, "pstate"), [], "a new park waits a moment for a client handing an old one back")
        self.clk.go(parkdir.GRACE + 0.1)
        self.pd.pulse()
        st = self.msgs(a, "pstate")
        self.assertEqual(len(st), 1)
        return a, st[0]

    def test_flag(self):
        keep = os.environ.pop("RIMRIFT_PARK_DIRECTOR", None)
        try:
            self.assertTrue(parkdir.enabled(), "on by default")
            for v in ("0", "false", "off", "no"):
                os.environ["RIMRIFT_PARK_DIRECTOR"] = v
                self.assertFalse(parkdir.enabled(), v)
            os.environ["RIMRIFT_PARK_DIRECTOR"] = "1"
            self.assertTrue(parkdir.enabled())
        finally:
            os.environ.pop("RIMRIFT_PARK_DIRECTOR", None)
            if keep is not None:
                os.environ["RIMRIFT_PARK_DIRECTOR"] = keep
        self.assertTrue(parkdir.enabled("1"))
        self.assertTrue(parkdir.enabled("on"))
        for v in ("0", "false", "off", "no", ""):
            self.assertFalse(parkdir.enabled(v))

    def test_epoch_events_watermark(self):
        a, st = self.started()
        self.assertEqual(st["pd"], 1)
        self.assertEqual(st["t0"], int(self.clk.t * 1000))
        self.assertIsNone(st["snap"])
        b = self.join("b")
        self.assertEqual(self.msgs(b, "pstate")[0]["epoch"], st["epoch"], "a newcomer gets the park at once, same epoch")
        # the courts' real side, as events in one order for the next tick
        self.clk.go(2.4)
        self.pd.pulse()
        self.assertEqual(self.msgs(a, "pt")[-1]["k"], 2)
        cts = self.hub.courts.setdefault("harbor", {})
        court(cts, 0, lines=[{"leader": "b", "members": ["b"]}, None])
        self.pd.courts_changed("harbor")
        court(cts, 0, busy={"kind": "local", "leader": "b"})
        self.pd.courts_changed("harbor")
        evs = self.msgs(a, "pev")
        self.assertEqual([m["ev"] for m in evs], [{"e": "claim", "c": 0, "r": 0, "aid": "b"}, {"e": "claim", "c": 0, "r": 0, "aid": None}, {"e": "court", "c": 0, "real": 1}])
        self.assertEqual([m["n"] for m in evs], [1, 2, 3])
        self.assertTrue(all(m["k"] == 3 for m in evs), "past the watermark: the next tick")
        self.assertTrue(all(m["sid"] == st["sid"] for m in evs))
        self.assertEqual(evs, self.msgs(b, "pev"))
        # leaving: gone, and the park lingers a minute empty, then goes
        self.hub.conns["a"].info["park"] = None
        self.pd.leave("a", "harbor")
        self.assertEqual(self.msgs(b, "pev")[-1]["ev"], {"e": "gone", "from": "a"})
        self.hub.conns["b"].info["park"] = None
        self.pd.leave("b", "harbor")
        self.clk.go(parkdir.LINGER + 1)
        self.pd.pulse()
        self.assertNotIn("harbor", self.pd.sessions)

    def test_epoch_start_knows_held_courts(self):
        cts = self.hub.courts.setdefault("harbor", {})
        court(cts, 2, busy={"kind": "game", "game": 7, "leader": "z"})
        a, st = self.started()
        self.assertIn({"e": "court", "c": 2, "real": 1}, [x["ev"] for x in st["log"]])

    def test_pacts_checked(self):
        a, st = self.started()
        ep = st["epoch"]
        pact = lambda who, **m: self.pd.handle(who, {"t": "pact", "place": "harbor", "epoch": ep, **m})
        cts = self.hub.courts.setdefault("harbor", {})
        court(cts, 1)
        n0 = len(self.msgs(a, "pev"))
        pact(a, a="lend", c=1, ids=["ai-3"])                       # (nothing to do with court 1)
        pact(a, a="lend", c=1, r=0, ids=["ai-3"])                  # (not his spot)
        pact(a, a="ready", c=1)
        pact(a, a="free", c=1, ids=["ai-3"])                       # (not his to hand back)
        self.pd.handle(a, {"t": "pact", "place": "harbor", "epoch": ep + 1, "a": "squad", "ids": ["ai-1"]})  # (old epoch)
        self.pd.handle(a, {"t": "pact", "place": "brick", "epoch": ep, "a": "squad", "ids": ["ai-1"]})       # (not where he is)
        pact(a, a="zap", c=1, ids=["ai-3"])
        self.assertEqual(len(self.msgs(a, "pev")), n0, "nothing got through")
        court(cts, 1, lines=[{"leader": "a", "members": ["a"]}, None])
        self.pd.courts_changed("harbor")
        pact(a, a="lend", c=1, r=0, ids=["ai-3", "x", 5, "ai-4; drop"])
        pact(a, a="ready", c=1)
        pact(a, a="lend", c=1, ids=["ai-7", "ai-8", "ai-9"])
        pact(a, a="free", c=1, ids=["ai-7", "ai-8", "ai-9", "ai-55"], kings=1, ks=250)
        pact(a, a="squad", ids=["ai-1", "ai-1", "ai-2", "nope", "ai-3", "ai-4", "ai-5"])
        evs = [m["ev"] for m in self.msgs(a, "pev")][n0:]
        self.assertEqual(evs, [{"e": "claim", "c": 1, "r": 0, "aid": "a"},
                               {"e": "lend", "from": "a", "c": 1, "r": 0, "ids": ["ai-3"]},
                               {"e": "ready", "from": "a", "c": 1},
                               {"e": "lend", "from": "a", "c": 1, "ids": ["ai-7", "ai-8", "ai-9"]},
                               {"e": "free", "from": "a", "c": 1, "ids": ["ai-7", "ai-8", "ai-9"], "kings": 1, "ks": 99},
                               {"e": "squad", "from": "a", "ids": ["ai-1", "ai-2", "ai-3", "ai-4"]}])
        # a flood is cut off
        for _ in range(100):
            pact(a, a="squad", ids=["ai-1"])
        self.assertLessEqual(len(self.msgs(a, "pev")) - n0 - len(evs), parkdir.PACT_RATE[0])

    def test_hashes_compared_snapshot_kept(self):
        a, st = self.started()
        b, c = self.join("b"), self.join("c")
        ep = st["epoch"]
        self.clk.go(61)
        self.pd.pulse()
        cts = self.hub.courts.setdefault("harbor", {})
        court(cts, 0, busy={"kind": "local", "leader": "a"})
        self.pd.courts_changed("harbor")  # (an event before the snapshot: cut from the log once it's agreed)
        state = lambda h: {"v": 1, "k": 60, "epoch": ep, "courts": [], "walkers": [], "h": h}
        chk = lambda cn, h: self.pd.handle(cn, {"t": "pcheck", "place": "harbor", "epoch": ep, "k": 60, "h": h, "s": state(h)})
        chk(a, 111)
        chk(b, 222)
        self.assertEqual(self.msgs(c, "presync"), [], "undecided until everyone's in (or a while)")
        chk(c, 111)
        self.assertEqual(len(self.msgs(b, "presync")), 1, "the odd one out gets the park again")
        self.assertEqual(self.msgs(a, "presync"), [])
        self.assertEqual(self.pd.sessions["harbor"].snap["h"], 111)
        d = self.join("d")
        ps = self.msgs(d, "pstate")[0]
        self.assertEqual(ps["snap"]["k"], 60)
        self.assertEqual(ps["snap"]["s"]["h"], 111)
        self.assertTrue(all(x["k"] > 60 for x in ps["log"]), "the log starts after the snapshot")
        # bad checks are ignored
        self.pd.handle(a, {"t": "pcheck", "place": "harbor", "epoch": ep, "k": 65, "h": 1})
        self.pd.handle(a, {"t": "pcheck", "place": "harbor", "epoch": ep, "k": 9990, "h": 1})
        self.assertNotIn(65, self.pd.sessions["harbor"].checks)
        self.assertNotIn(9990, self.pd.sessions["harbor"].checks)

    def test_handed_back_after_a_restart(self):
        a, st = self.started()
        ep, t0 = st["epoch"], st["t0"]
        self.clk.go(130)
        # (the server restarts: a new director, nobody's park; the client still has its own)
        self.pd = parkdir.ParkDirector(self.hub, clock=self.clk.wall, mono=self.clk.mono)
        cts = self.hub.courts.setdefault("harbor", {})
        court(cts, 1, kings={"leader": "a", "members": ["a"]})
        a2 = self.join("a")
        snap = {"v": 1, "k": 120, "epoch": ep, "courts": [{"real": 0, "claim": [None, None]}, {"real": 0, "claim": [None, None]}]}
        self.pd.handle(a2, {"t": "presume", "place": "harbor", "epoch": ep, "t0": t0, "seed": st["seed"], "k": 120, "h": 5, "s": snap})
        ps = self.msgs(a2, "pstate")[-1]
        self.assertEqual((ps["epoch"], ps["t0"], ps["seed"], ps["snap"]["k"]), (ep, t0, st["seed"], 120))
        self.assertIn({"e": "court", "c": 1, "real": 1}, [x["ev"] for x in ps["log"]], "what changed while it was down comes in as events")
        self.assertNotEqual(ps["sid"], st["sid"], "a new series of events: clients count them afresh")
        self.assertEqual(ps["n"], len(ps["log"]))
        # once it's running, nobody can hand it another
        self.pd.handle(a2, {"t": "presume", "place": "harbor", "epoch": 9, "t0": t0, "seed": 1, "k": 1, "h": 5, "s": {"k": 1, "epoch": 9}})
        self.assertEqual(self.pd.sessions["harbor"].epoch, ep)
        # a nonsense hand-back is refused (a start in the future)
        pd2 = parkdir.ParkDirector(self.hub, clock=self.clk.wall, mono=self.clk.mono)
        pd2.arrive(a2, "harbor")
        pd2.handle(a2, {"t": "presume", "place": "harbor", "epoch": 3, "t0": int(self.clk.t * 1000) + 10 ** 7, "seed": 1, "k": 1, "h": 5, "s": {"k": 1, "epoch": 3}})
        self.assertIsNotNone(pd2.sessions["harbor"].pending)

    def test_no_park_at_the_crew_hq(self):
        c = self.join("a", "hq:a")
        self.clk.go(10)
        self.pd.pulse()
        self.assertEqual(self.pd.sessions, {})
        self.assertEqual(self.msgs(c, "pstate"), [])


if __name__ == "__main__":
    unittest.main()
