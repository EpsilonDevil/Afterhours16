"""v0.4.8.7 quick patch 4: everyone at a park sees the real players' games while they're on.

* A hosted game's inputs are kept for the whole game (each seat's as one run, a byte or two a tick), so someone arriving
  at the park while it's on gets all of it (watch), then who has left it, then the rest as it's played. It used to be the
  first minute only: anyone arriving later saw an empty court until the game was over.
* A player's own game (alone at the park when it began) goes out to everyone else there as he plays it: its setup
  (lwatch), every tick's input change (lin, every tick once and in order), its end (lstop: also when he leaves the park),
  and the whole of it for whoever arrives while it's on. Nothing in it counts for anything on the server.
* rewatch: the park just loaded on a screen, the games on there are offered again.

Run from the project root:  python3 -m unittest tests.test_qp4_watch -v
"""
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app

try:
    from tests.test_online import Client
except ImportError:
    from test_online import Client


class WatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "qp4.sqlite3", dev_accounts=False)
        cls.service.hosting, cls.service.join_code = True, "hoops42"
        cls.service.rate_limit = lambda ip, category: None
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    def join(self, name, park):
        c = Client(self.base)
        st, body = c.call("/api/register", {"username": name, "password": "password123", "join_code": "hoops42"})
        self.assertEqual(st, 200, body)
        self.assertEqual(c.connect(), 101)
        c.id = c.until("hello")["you"]["id"]
        c.send({"t": "entry", "entry": {"name": name, "build": {"overall": 70, "equipment": {}}}})
        c.send({"t": "where", "name": name, "park": park, "status": "park"})
        c.here = c.until("here")
        return c

    def upto_pong(self, c):
        """Everything c gets up to the answer to a ping (the messages before it, in order)."""
        c.send({"t": "ping", "c": 1})
        out = []
        for _ in range(500):
            m = c.recv()
            if m.get("t") == "pong":
                return out
            out.append(m)
        raise AssertionError("no pong")

    def test_a_hosted_game_whole_for_late_watchers(self):
        a, b = self.join("hw_ann", "foundry"), self.join("hw_ben", "foundry")
        a.send({"t": "start", "setup": {"slots": {a.id: 0, b.id: 1}, "where": "foundry", "court": 1, "rosters": [[], []]}})
        g = a.until("start")["setup"]["game"]
        b.until("start")
        for k in range(1, 200, 10):  # (inputs from both seats, minutes' worth in the real thing)
            a.send({"t": "in", "g": g, "k": k, "b": [0] * 9 + [{"mx": 0.5}]})
            b.send({"t": "in", "g": g, "k": k, "b": [{"mx": -0.5}] + [0] * 9})
        b.send({"t": "quit"})
        time.sleep(0.2)
        c = self.join("hw_cal", "foundry")
        got = self.upto_pong(c)
        w = [m for m in got if m.get("t") == "watch"]
        self.assertEqual(len(w), 1)
        log = {s: (k, bl) for s, k, bl in w[0]["log"]}
        self.assertEqual(set(log), {0, 1})
        self.assertEqual((log[0][0], len(log[0][1])), (1, 200), "every tick from the first, as one run")
        self.assertEqual(log[1][1][0], {"mx": -0.5})
        left = [m for m in got if m.get("t") == "left"]
        self.assertEqual([(m["slot"], m["g"]) for m in left], [(1, g)], "who left it, after the game so far")
        # (the park just loaded on his screen: the games again)
        c.send({"t": "rewatch"})
        self.assertEqual(c.until("watch")["setup"]["game"], g)
        # and a watcher who was there gets the live inputs as before
        a.send({"t": "in", "g": g, "k": 201, "b": [0, 0]})
        self.assertEqual(c.until("inw")["m"][-1][1], 201)
        for x in (a, b, c):
            x.close()

    def test_a_players_own_game_out_to_the_park(self):
        a, b = self.join("lw_ann", "brick"), self.join("lw_ben", "brick")
        x = self.join("lw_xen", "harbor")
        setup = {"court": 2, "full": True, "seed": 7, "rosters": [[{"name": "A", "human": True}], [{"name": "K"}]], "teams": [{}, {}], "target": 11}
        a.send({"t": "lstart", "setup": setup})
        m = b.until("lwatch")
        self.assertEqual((m["from"], m["setup"]["seed"], m["k"], m["b"]), (a.id, 7, 1, []))
        a.send({"t": "lin", "k": 1, "b": [{"mx": 0.25}, 0, 0]})
        a.send({"t": "lin", "k": 9, "b": [0]})                      # (a gap: not taken)
        a.send({"t": "lin", "k": 4, "b": [0, "nonsense"]})          # (not an input change: not taken)
        a.send({"t": "lin", "k": 4, "b": [{"_a": 1}, 0]})
        self.upto_pong(a)  # (all his are in)
        got = [m for m in self.upto_pong(b) if m.get("t") == "lin"]
        self.assertEqual([(m["from"], m["k"], len(m["b"])) for m in got], [(a.id, 1, 3), (a.id, 4, 2)])
        # someone arriving while it's on: all of it so far
        c = self.join("lw_cal", "brick")
        w = [m for m in self.upto_pong(c) if m.get("t") == "lwatch"]
        self.assertEqual(len(w), 1)
        self.assertEqual((w[0]["k"], w[0]["b"]), (1, [{"mx": 0.25}, 0, 0, {"_a": 1}, 0]))
        # nobody at another park hears of it; he doesn't get his own back
        self.assertFalse([m for m in self.upto_pong(x) if m.get("t", "").startswith("l")])
        self.assertFalse([m for m in self.upto_pong(a) if m.get("t") in ("lin", "lwatch")])
        # its end: on stopping, or when he leaves the park
        a.send({"t": "lstop"})
        self.assertEqual(b.until("lstop")["from"], a.id)
        a.send({"t": "lstart", "setup": setup})
        b.until("lwatch")
        a.send({"t": "where", "name": "A", "park": "harbor", "status": "park"})
        self.assertEqual(b.until("lstop")["from"], a.id)
        self.assertNotIn(a.id, self.service.hub.lgames)
        for y in (a, b, c, x):
            y.close()


if __name__ == "__main__":
    unittest.main()
