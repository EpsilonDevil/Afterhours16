"""v0.4.8.5 quick patch 4: the client gets the whole event schedule (with each event's park) and the server's clock, in
/api/config and again with every /api/cup, so a game left running across a handover sends the AI world's entrants to
the new event park the moment it opens (they used to keep going to the closed one, and the new park stood empty).

Run from the project root:  python3 -m unittest tests.test_event_schedule -v
"""
import http.cookiejar
import json
import tempfile
import threading
import time
import unittest
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, cup

ROOT = Path(__file__).resolve().parents[1]


class PublicSchedule(unittest.TestCase):
    def test_it_mirrors_events_json_with_the_parks(self):
        rows = json.loads((ROOT / "server/events.json").read_text())["schedule"]
        pub = cup.public_schedule()
        fixed = [r for r in rows if "shuffle" not in r]  # (v0.4.8.7: the shuffle row goes out as plain windows, test_park_shuffle.py)
        self.assertEqual([(r["event"], r["from"], r["until"]) for r in pub][:len(fixed)], [(r["event"], r.get("from"), r.get("until")) for r in fixed])
        self.assertEqual([r["venue"] for r in pub][:len(fixed)], [cup.EVENTS[r["event"]]["venue"] for r in fixed])
        # an unknown event in an edited schedule is left out, not sent half-made
        self.assertEqual(cup.public_schedule([{"event": "nope", "from": 1, "until": 2}, {"event": "beat", "from": 2, "until": None}]),
                         [{"event": "beat", "venue": "beat", "from": 2, "until": None}])
        # it follows the live schedule (tests and an edited file swap cup.SCHEDULE)
        old, cup.SCHEDULE = cup.SCHEDULE, [{"event": "jungle", "from": None, "until": None}]
        try:
            self.assertEqual(cup.public_schedule(), [{"event": "jungle", "venue": "jungle", "from": None, "until": None}])
        finally:
            cup.SCHEDULE = old


class ScheduleApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "sched.sqlite3")
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    def call(self, path, body=None):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        with self.opener.open(req, timeout=20) as r:
            return json.loads(r.read() or b"null")

    def test_config_and_cup_carry_it(self):
        cfg = self.call("/api/config")
        self.assertEqual(cfg["event_schedule"], cup.public_schedule())
        self.assertLess(abs(cfg["server_time"] - time.time()), 5)
        self.call("/api/register", {"username": "sc_" + uuid.uuid4().hex[:6], "password": "longpassword1"})
        st = self.call("/api/cup")
        self.assertEqual(st["event_schedule"], cup.public_schedule())
        self.assertIn("now", st)
        # the event the server says is on is the one the schedule gives for its clock
        on = next((r["venue"] for r in st["event_schedule"] if (r["from"] is None or st["now"] >= r["from"]) and (r["until"] is None or st["now"] < r["until"])), None)
        self.assertEqual(on, st["event"]["venue"] if st["event"] else None)


if __name__ == "__main__":
    unittest.main()
