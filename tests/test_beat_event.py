"""v0.4.8.5 quick patch: And The Beat Goes On, the park event after The Jungle Ballers. The schedule hands over at the
end of the Jungle's window (2026-10-14 00:00 UTC), the Jungle's park closes (nothing of it is deleted), the Beat takes
the ante-ups and pays its own prizes, and the Jungle's last window still pays the Jungle's.

Run from the project root:  python3 -m unittest tests.test_beat_event -v
"""
import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, cup, crew

HANDOVER = 1791936000  # 2026-10-14 00:00 UTC
ROOT = Path(__file__).resolve().parents[1]


class ScheduleTests(unittest.TestCase):
    def test_the_beat_follows_the_jungle_tonight(self):
        sched = cup.load_schedule()
        self.assertEqual([r["event"] for r in sched], ["kingtut", "jungle", "beat", "monster"])  # (then the Monster Mash: test_monster_event.py)
        self.assertEqual((sched[1]["until"], sched[2]["from"], sched[2]["until"]), (HANDOVER, HANDOVER, HANDOVER + cup.WINDOW))
        self.assertEqual((HANDOVER - cup.EPOCH) % cup.WINDOW, 0)  # the end of a window, not the middle of one
        self.assertEqual(cup.window_bounds(cup.window_at(HANDOVER - 1))[1], HANDOVER)  # (the Jungle's window ends right there)
        self.assertEqual(cup.active_event(HANDOVER - 1, sched)["id"], "jungle")
        self.assertEqual(cup.active_event(HANDOVER, sched)["id"], "beat")
        self.assertEqual(cup.active_event(HANDOVER + cup.WINDOW - 1, sched)["id"], "beat")  # one 48-hour window
        w = cup.window_at(HANDOVER)
        self.assertEqual(cup.event_for_window(w - 1, sched)["id"], "jungle")  # its last window pays the Jungle's prizes
        self.assertEqual(cup.event_for_window(w, sched)["id"], "beat")
        self.assertEqual(cup.event_for_window(w - 2, sched)["id"], "kingtut")
        # the Jungle (like the King Tut Cup) is kept whole: still an event, still a venue, just off the schedule
        self.assertIn("jungle", cup.EVENTS)
        self.assertIn("kingtut", cup.EVENTS)
        venues = {v["id"]: v for v in server_app.VENUES}
        for v in ("jungle", "kingtut", "beat", "monster"):
            self.assertTrue(venues[v].get("event"), v)
        self.assertEqual(cup.EVENT_VENUES, {"kingtut", "jungle", "beat", "monster"})

    def test_the_beat_prizes(self):
        beat, jungle, tut = cup.EVENTS["beat"], cup.EVENTS["jungle"], cup.EVENTS["kingtut"]
        self.assertEqual((beat["name"], beat["venue"], beat["exclusive"], beat["played"]), ("And The Beat Goes On", "beat", "beat", "Played the Beat"))
        # the same tiers and VC as every event before it
        self.assertEqual([p[:3] for p in beat["prizes"]], [(1, "King of the Beat", 150000), (3, "Top 3", 60000), (10, "Top 10", 25000), (25, "Top 25", 10000)])
        self.assertEqual([p[0] for p in beat["prizes"]], [p[0] for p in jungle["prizes"]])
        self.assertEqual([p[2] for p in beat["prizes"]], [p[2] for p in jungle["prizes"]])
        # the same placements: the slots each tier gets match the Jungle's tier for tier
        slots = lambda ev: [sorted(server_app.CATALOG[i]["slot"] for i in p[3]) for p in ev["prizes"]]
        self.assertEqual(slots(beat), slots(jungle))
        items = {i for p in beat["prizes"] for i in p[3]}
        self.assertEqual(len(items), 7)
        self.assertEqual(items & {i for ev in (jungle, tut) for p in ev["prizes"] for i in p[3]}, set())  # all brand new
        for i in items:
            it = server_app.CATALOG[i]
            self.assertEqual((it.get("exclusive"), it.get("price")), ("beat", 0), i)
        self.assertEqual({server_app.CATALOG[i]["slot"] for i in items}, {"top", "bottom", "shoes", "celebration", "headband", "greenfx", "greensound"})
        self.assertIn("bg_tracksuit_top", cup.prize_for(1, 200, beat)["items"])
        self.assertIn("bg_tracksuit_pants", cup.prize_for(1, 200, beat)["items"])
        self.assertNotIn("bg_tracksuit_top", cup.prize_for(2, 200, beat)["items"])
        self.assertIn("bg_gfx_discoball", cup.prize_for(3, 200, beat)["items"])
        self.assertNotIn("bg_gfx_discoball", cup.prize_for(4, 200, beat)["items"])
        self.assertIn("bg_gsnd_808", cup.prize_for(10, 200, beat)["items"])
        self.assertEqual(cup.prize_for(25, 200, beat)["items"], ["bg_band_terry"])
        self.assertEqual(cup.prize_for(150, 200, beat)["label"], "Played the Beat")


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "beat.sqlite3")
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

    def call(self, path, body=None, expect=200):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=20) as r:
                status, payload = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, payload = e.code, json.loads(e.read() or b"null")
        if expect is not None and status != expect:
            raise AssertionError(f"{path}: {status} {payload}")
        return payload

    def key(self):
        return uuid.uuid4().hex

    def summary(self, **stats):
        s = {"pts": 0, "fgm": 0, "fga": 0, "tpm": 0, "tpa": 0, "ftm": 0, "fta": 0}
        s.update(stats)
        return {"mode": "park", "score": [21, 15], "winner": 0, "duration": 420, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}

    def test_the_beat_replaces_the_jungle(self):
        # the handover as it happens tonight, moved to the start of this window so the test runs any day
        w = cup.window_at()
        cut = cup.window_bounds(w)[0]
        old_sched, cup.SCHEDULE = cup.SCHEDULE, [{"event": "kingtut", "from": None, "until": cut - cup.WINDOW},
                                                 {"event": "jungle", "from": cut - cup.WINDOW, "until": cut}, {"event": "beat", "from": cut, "until": None}]
        try:
            self.call("/api/register", {"username": "bg_" + uuid.uuid4().hex[:6], "password": "longpassword1"})
            self.call("/api/ai-world", {"key": self.key(), "world": {"seed": 4343, "friends": [], "squad": [], "met": {}}})
            build = {"name": "Beat Guy", "position": "SG", "archetype": "sharpshooter", "height": 77, "weight": 195, "wingspan": 80}
            cid = self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]
            cfg = self.call("/api/config")
            self.assertEqual((cfg["event"]["id"], cfg["event"]["venue"], cfg["event"]["name"]), ("beat", "beat", "And The Beat Goes On"))
            self.assertEqual(sorted(cfg["event_venues"]), ["beat", "jungle", "kingtut", "monster"])
            st = self.call("/api/cup")
            self.assertEqual(st["event"]["id"], "beat")
            self.assertEqual(st["prizes"][0]["label"], "King of the Beat")
            self.assertIn("bg_tracksuit_top", st["prizes"][0]["items"])
            self.assertEqual(st["prizes"][-1]["label"], "Played the Beat")
            # the Jungle's park is closed now (deactivated, not deleted); the Beat's takes the ante-ups
            jg = {"character_id": cid, "mode": "park", "venue": "jungle", "format": 3, "target": 21, "ante": 500}
            r = self.call("/api/matches", {"key": self.key(), **jg}, expect=400)
            self.assertIn("isn't running", r["error"])
            base = {"character_id": cid, "mode": "park", "venue": "beat", "format": 3, "target": 21}
            self.call("/api/matches", {"key": self.key(), **base}, expect=400)  # (no ante)
            self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "proam", "venue": "beat", "format": 5}, expect=400)
            bal0 = self.call("/api/me")["balance"]
            t = self.call("/api/matches", {"key": self.key(), **base, "ante": 1000})
            self.assertEqual(t["meta"]["event"], "beat")
            self.assertEqual(self.call("/api/me")["balance"], bal0 - 1000)
            old_slack = server_app.TIME_SLACK
            server_app.TIME_SLACK = 10_000
            try:
                res = self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": self.summary(pts=11, fgm=4, fga=9, tpm=3, tpa=5, ast=2, reb=3)})
                self.assertTrue(res["won"])
                self.assertEqual((res["cup"]["event"], res["cup"]["pot"]), ("beat", 2000))
            finally:
                server_app.TIME_SLACK = old_slack
            st = self.call("/api/cup")
            self.assertEqual((st["me"]["games"], st["me"]["event"]), (1, "beat"))
            # the Jungle's last window (before the handover) still pays the Jungle's prizes
            aid = self.service.db.query("SELECT id FROM accounts WHERE username LIKE 'bg_%'")[0][0]
            with self.service.db.transaction() as c:
                c.execute("UPDATE cup_entries SET window=window-1 WHERE account_id=?", (aid,))
            st = self.call("/api/cup")
            self.assertEqual(st["previous"]["event"]["id"], "jungle")
            self.assertTrue(all(i.startswith("jb_") for i in st["previous"]["prize"]["items"]))
            # the Beat's rewards can't be bought
            for item in ("bg_tracksuit_top", "bg_gfx_discoball", "bg_gsnd_808"):
                r = self.call("/api/store/purchase", {"key": self.key(), "item_id": item, "character_id": cid}, expect=400)
                self.assertIn("And The Beat Goes On exclusive", r["error"])
            self.assertEqual(crew.game_xp(200, "park", "beat"), 90)  # park events weigh 1.5x for crew XP, this one too
        finally:
            cup.SCHEDULE = old_sched


class SoundtrackFileTests(unittest.TestCase):
    def test_the_event_soundtrack_is_its_own(self):
        beat = json.loads((ROOT / "client/audio/beat/tracks.json").read_text())["tracks"]
        main = json.loads((ROOT / "client/audio/music/tracks.json").read_text())["tracks"]
        self.assertEqual(len(beat), 28)
        main_files = {t["file"] for t in main} | {p for t in main for p in t.get("parts", [])}
        for t in beat:
            self.assertTrue((ROOT / "client/audio/beat" / t["file"]).is_file(), t["file"])
            self.assertNotIn(t["file"], main_files)
            self.assertTrue(60 <= t["duration"] <= 300, t)
        self.assertFalse(any((ROOT / "client/audio/music" / t["file"]).exists() for t in beat))
        # the cuts cover the whole mix, in order, with no gaps
        self.assertEqual(beat[0]["from"], 0)
        for a, b in zip(beat, beat[1:]):
            self.assertAlmostEqual(a["from"] + a["duration"], b["from"], delta=1.0)
        self.assertAlmostEqual(beat[-1]["from"] + beat[-1]["duration"], 4429.5, delta=2)


if __name__ == "__main__":
    unittest.main()
