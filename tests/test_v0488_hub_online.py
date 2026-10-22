"""v0.4.8.8 The Pro-Am Overhaul: what the online service does for the Pro-Am HUB and the real-vs-real series games.

* A Crew HQ or a team's Pro-Am HUB (hq:...) still has a host picked here with the park director on (the director runs the
  parks alone): 'here' and 'host' name him, and his reports (pop) go out.
* pa-entries: the home Captain of a real-vs-real game gets the players' entries (Pro-Am team members only, connected).

Run from the project root:  python3 -m unittest tests.test_v0488_hub_online -v
"""
import json
import tempfile
import threading
import time
import unittest
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app

try:
    from tests.test_online import Client
except ImportError:
    from test_online import Client


class HubOnlineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "hub.sqlite3", dev_accounts=False)
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

    def join(self, name, place, team=None):
        c = Client(self.base)
        st, body = c.call("/api/register", {"username": name, "password": "password123", "join_code": "hoops42"})
        self.assertEqual(st, 200, body)
        if team is not None:
            st, body = c.call("/api/characters", {"key": uuid.uuid4().hex, "build": {"name": name.title(), "position": "PG", "archetype": "playmaker", "height": 75, "weight": 190, "wingspan": 78}})
            self.assertEqual(st, 200, body)
            st, body = c.call("/api/proam/create", {"team": {"name": team, "abbr": team[:3].upper()}})
            self.assertEqual(st, 200, body)
        self.assertEqual(c.connect(), 101)
        c.id = c.until("hello")["you"]["id"]
        c.send({"t": "entry", "entry": {"name": name, "build": {"overall": 70, "equipment": {}}}})
        c.send({"t": "where", "name": name, "park": place, "status": "park"})
        c.here = c.until("here")
        return c

    def test_a_hub_has_a_host_with_the_park_director_on(self):
        self.assertIsNotNone(self.service.hub.parks, "the director is on")
        place = "hq:pa:team-" + uuid.uuid4().hex[:6]
        a = self.join("hb_ann", place)
        self.assertEqual(a.here["host"], a.id)
        b = self.join("hb_ben", place)
        self.assertEqual(b.here["host"], a.id, "the one there longest")
        a.send({"t": "pop", "place": place, "courts": [], "walkers": []})
        self.assertEqual(b.until("pop")["from"], a.id)
        a.send({"t": "where", "name": "A", "park": "harbor", "status": "park"})
        self.assertEqual(b.until("host")["id"], b.id, "the host goes: the next one takes over")
        # (a park itself is still the director's: no host there)
        c = self.join("hb_cal", "brick")
        self.assertIsNone(c.here["host"])
        for x in (a, b, c):
            x.close()

    def test_pa_entries_for_a_real_vs_real_setup(self):
        a = self.join("pe_ann", "brick", team="Entry Alpha")
        b = self.join("pe_ben", "harbor", team="Entry Bravo")
        x = self.join("pe_out", "harbor")  # (no team)
        time.sleep(0.2)
        a.send({"t": "pa-entries", "ids": [b.id, x.id, "nobody"], "req": "r1"})
        m = a.until("pa-entries")
        self.assertEqual(m["req"], "r1")
        self.assertEqual(set(m["people"]), {b.id}, "only Pro-Am team members")
        self.assertEqual(m["people"][b.id]["entry"]["name"], "pe_ben")
        x.send({"t": "pa-entries", "ids": [a.id], "req": "r2"})  # (not on a team: no answer)
        time.sleep(0.3)
        for c in (a, b, x):
            c.close()


if __name__ == "__main__":
    unittest.main()
