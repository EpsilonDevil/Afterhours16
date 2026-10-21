"""v0.4.8.7: one AI world per online server. The service issues the world everybody connected to it plays in (its seed and
birth, kept in shared_world), with its clock and time zone, the prizes the AI field has won (standings with nobody's own
entries) and the event schedule: GET /api/ai-world/canonical, and in the hub's hello / world messages; the hub's pongs
carry its clock; a new world after a season reset; the account's save keeps the shared flag and its own world from
before (prev); the park's host's people go to everyone at the same park (pop) and nowhere else.

Run from the project root:  python3 -m unittest tests.test_shared_world -v
"""
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, progression

try:
    from tests.test_online import Client
except ImportError:  # (unittest discover -s tests imports the tests as top-level modules)
    from test_online import Client


class SharedWorldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "shared.sqlite3", dev_accounts=False)
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

    def player(self, name):
        c = Client(self.base)
        st, body = c.call("/api/register", {"username": name, "password": "password123", "join_code": "hoops42"})
        self.assertEqual(st, 200, body)
        return c

    def test_the_canonical_world_endpoint(self):
        anon = Client(self.base)
        st, w = anon.call("/api/ai-world/canonical")
        self.assertEqual(st, 200, w)
        self.assertIsInstance(w["seed"], int)
        self.assertTrue(1 <= w["seed"] < 2 ** 31)
        self.assertTrue(0 < w["born"] <= time.time() * 1000 + 1)
        self.assertLess(abs(w["now"] - time.time() * 1000), 5000)
        self.assertIsInstance(w["tz"], int)
        self.assertTrue(-14 * 60 <= w["tz"] <= 14 * 60)
        self.assertEqual(set(w["unlocks"]), {"prizes", "through"})
        self.assertIsInstance(w["schedule"], list)
        # the same world every time, for everyone (signed in or not)
        a = self.player("sw_ann")
        st, again = a.call("/api/ai-world/canonical")
        self.assertEqual((again["seed"], again["born"]), (w["seed"], w["born"]))
        self.assertEqual(again["unlocks"], w["unlocks"])

    def test_the_hub_hands_it_out_with_its_clock(self):
        a, b = self.player("sw_hub_a"), self.player("sw_hub_b")
        st, w = a.call("/api/ai-world/canonical")
        for c in (a, b):
            self.assertEqual(c.connect(), 101)
            hello = c.until("hello")
            self.assertEqual((hello["world"]["seed"], hello["world"]["born"]), (w["seed"], w["born"]))
            self.assertEqual(hello["world"]["tz"], w["tz"])
        # asked again (an event window closed): the same world, its prizes
        a.send({"t": "world"})
        again = a.until("world")["world"]
        self.assertEqual((again["seed"], again["born"], again["unlocks"]), (w["seed"], w["born"], w["unlocks"]))
        # the pongs carry the service's clock
        a.send({"t": "ping", "c": 12.5})
        pong = a.until("pong")
        self.assertEqual(pong["c"], 12.5)
        self.assertLess(abs(pong["s"] - time.time() * 1000), 5000)
        for c in (a, b):
            c.close()

    def test_the_park_hosts_people_go_to_everyone_there_and_nowhere_else(self):
        # (v0.4.8.7: the qp7 host mode, with the park director off: RIMRIFT_PARK_DIRECTOR=0; on, nobody hosts the park)
        hub = self.service.hub
        keep, hub.parks = hub.parks, None
        self.addCleanup(setattr, hub, "parks", keep)
        a, b, x = self.player("sw_pop_a"), self.player("sw_pop_b"), self.player("sw_pop_x")
        for c, park in ((a, "harbor"), (b, "harbor"), (x, "brick")):
            self.assertEqual(c.connect(), 101)
            me = c.until("hello")["you"]["id"]
            c.id = me
            c.send({"t": "entry", "entry": {"name": c.id, "build": {"overall": 70}}})
            c.send({"t": "where", "name": "P", "park": park, "status": "park"})
            c.until("here")
        a.send({"t": "pop", "place": "harbor", "courts": [None], "walkers": [["ai-3", 1.5, 2, 0, 0.4, 0, None, 0, None, 0]], "lines": [], "extra": []})
        got = b.until("pop")
        self.assertEqual(got["from"], a.id)
        self.assertEqual(got["walkers"][0][0], "ai-3")
        # (somebody at another park never gets it; a pop for a park he isn't at goes nowhere)
        a.send({"t": "pop", "place": "brick", "courts": [], "walkers": []})
        time.sleep(0.2)
        x.send({"t": "ping", "c": 1})
        seen = []
        for _ in range(30):
            m = x.recv()
            seen.append(m.get("t"))
            if m.get("t") == "pong":
                break
        self.assertIn("pong", seen)
        self.assertNotIn("pop", seen)
        for c in (a, b, x):
            c.close()

    def test_a_new_world_after_the_season_reset(self):
        s = self.service
        old = s.shared_world()
        with s.db.transaction() as c:
            c.execute("UPDATE shared_world SET born=? WHERE id=1", ((time.time() - 90 * 86400) * 1000,))
        keep = (s.season, s.reset_done)
        try:
            s.season, s.reset_done = {"id": "test-reset", "at": time.time() - 3600 * 5, "vc": 0}, True
            new = s.shared_world()
            self.assertNotEqual((new["seed"], new["born"]), (old["seed"], old["born"]))
            self.assertGreaterEqual(new["born"], (time.time() - 60) * 1000)
            self.assertEqual(s.shared_world(), new, "kept from then on")
        finally:
            s.season, s.reset_done = keep

    def test_the_save_keeps_the_shared_flag_and_the_world_from_before(self):
        w = progression.ai_world({"seed": 99, "born": 1.7e12, "shared": True, "friends": ["ai-1"], "squad": ["ai-1"], "met": {}, "prog": {},
                                  "prev": {"seed": 4242, "born": 1.6e12, "friends": ["ai-7", "nope"], "squad": ["ai-7"], "prog": {"ai-7": {"g": 3, "w": 1}},
                                           "prev": {"seed": 5, "born": 1.0e12}, "shared": True}})
        self.assertTrue(w["shared"])
        self.assertEqual(w["prev"]["seed"], 4242)
        self.assertEqual(w["prev"]["friends"], ["ai-7"])
        self.assertEqual(w["prev"]["squad"], [])
        self.assertNotIn("prev", w["prev"])
        self.assertNotIn("shared", w["prev"])
        plain = progression.ai_world({"seed": 99, "born": 1.7e12, "shared": "yes", "prev": "junk"})
        self.assertNotIn("shared", plain)
        self.assertNotIn("prev", plain)


if __name__ == "__main__":
    unittest.main()
