"""v0.4.8.5 quick patch 2: The Monster Mash, the park event after And The Beat Goes On. The schedule hands over at the
end of the Beat's window (2026-10-16 00:00 UTC), the Beat's park closes (nothing of it is deleted: its park, rewards and
soundtrack all stay), the Mash takes the ante-ups and pays its own prizes, and the Beat's last window still pays the
Beat's.

Run from the project root:  python3 -m unittest tests.test_monster_event -v
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

HANDOVER = 1792108800  # 2026-10-16 00:00 UTC (8 pm Oct 15 Eastern)
BEAT_FROM = 1791936000
FAVELA_FROM = 1792454400  # 2026-10-20 00:00 UTC: The Favelas (v0.4.8.7)
ROOT = Path(__file__).resolve().parents[1]


class ScheduleTests(unittest.TestCase):
    def test_the_mash_follows_the_beat(self):
        sched = cup.load_schedule()
        # (v0.4.8.7: then The Favelas from the end of the Mash's second window, test_favela_event.py)
        self.assertEqual([r.get("event", "shuffle") for r in sched][:4], ["kingtut", "jungle", "beat", "monster"])
        self.assertEqual((sched[2]["from"], sched[2]["until"], sched[3]["from"]), (BEAT_FROM, HANDOVER, HANDOVER))
        self.assertIn(sched[3]["until"], (None, FAVELA_FROM))
        self.assertEqual(HANDOVER - BEAT_FROM, cup.WINDOW)  # the Beat gets its full 48 hours
        self.assertEqual((HANDOVER - cup.EPOCH) % cup.WINDOW, 0)  # the end of a window, not the middle of one
        self.assertEqual(cup.window_bounds(cup.window_at(HANDOVER - 1))[1], HANDOVER)  # (the Beat's window ends right there)
        # nothing changes before the handover: the Beat runs to the last second of its window
        self.assertEqual(cup.active_event(BEAT_FROM, sched)["id"], "beat")
        self.assertEqual(cup.active_event(HANDOVER - 1, sched)["id"], "beat")
        self.assertEqual(cup.active_event(HANDOVER, sched)["id"], "monster")
        self.assertEqual(cup.active_event(FAVELA_FROM - 1, sched)["id"], "monster")  # (two full windows, to the Favelas)
        w = cup.window_at(HANDOVER)
        self.assertEqual(cup.event_for_window(w - 1, sched)["id"], "beat")  # its last window pays the Beat's prizes
        self.assertEqual(cup.event_for_window(w, sched)["id"], "monster")
        self.assertEqual(cup.event_for_window(w - 2, sched)["id"], "jungle")
        # the Beat (like the Jungle and the King Tut Cup) is kept whole: still an event, still a venue, just off the schedule
        for e in ("kingtut", "jungle", "beat", "monster"):
            self.assertIn(e, cup.EVENTS)
        venues = {v["id"]: v for v in server_app.VENUES}
        for v in ("jungle", "kingtut", "beat", "monster"):
            self.assertTrue(venues[v].get("event"), v)
            self.assertEqual(venues[v]["kind"], "park")
        self.assertEqual(venues["monster"]["name"], "The Monster Mash")
        self.assertEqual(cup.EVENT_VENUES, {"kingtut", "jungle", "beat", "monster", "favela"})  # (v0.4.8.7: and The Favelas)

    def test_the_mash_prizes(self):
        mash, beat, jungle, tut = (cup.EVENTS[e] for e in ("monster", "beat", "jungle", "kingtut"))
        self.assertEqual((mash["name"], mash["venue"], mash["exclusive"], mash["played"]), ("The Monster Mash", "monster", "monster", "Played the Mash"))
        # the same tiers and VC as every event before it
        self.assertEqual([p[:3] for p in mash["prizes"]], [(1, "King of the Mash", 150000), (3, "Top 3", 60000), (10, "Top 10", 25000), (25, "Top 25", 10000)])
        self.assertEqual([p[0] for p in mash["prizes"]], [p[0] for p in beat["prizes"]])
        self.assertEqual([p[2] for p in mash["prizes"]], [p[2] for p in beat["prizes"]])
        # the same placements: the slots each tier gets match the Beat's (and the Jungle's) tier for tier
        slots = lambda ev: [sorted(server_app.CATALOG[i]["slot"] for i in p[3]) for p in ev["prizes"]]
        self.assertEqual(slots(mash), slots(beat))
        self.assertEqual(slots(mash), slots(jungle))
        items = {i for p in mash["prizes"] for i in p[3]}
        self.assertEqual(len(items), 7)
        self.assertEqual(items & {i for ev in (beat, jungle, tut) for p in ev["prizes"] for i in p[3]}, set())  # all brand new
        for i in items:
            it = server_app.CATALOG[i]
            self.assertEqual((it.get("exclusive"), it.get("price")), ("monster", 0), i)
            self.assertTrue(i.startswith("mm_"), i)
        self.assertEqual({server_app.CATALOG[i]["slot"] for i in items}, {"top", "bottom", "shoes", "celebration", "headband", "greenfx", "greensound"})
        # every exclusive the catalog marks 'monster' is a prize (nothing orphaned, nothing for sale)
        self.assertEqual({i for i, it in server_app.CATALOG.items() if it.get("exclusive") == "monster"}, items)
        self.assertIn("mm_bones_top", cup.prize_for(1, 200, mash)["items"])
        self.assertIn("mm_bones_tights", cup.prize_for(1, 200, mash)["items"])
        self.assertNotIn("mm_bones_top", cup.prize_for(2, 200, mash)["items"])
        self.assertIn("mm_gfx_lantern", cup.prize_for(3, 200, mash)["items"])
        self.assertIn("mm_shoes_coffin", cup.prize_for(3, 200, mash)["items"])
        self.assertNotIn("mm_gfx_lantern", cup.prize_for(4, 200, mash)["items"])
        self.assertIn("mm_gsnd_organ", cup.prize_for(10, 200, mash)["items"])
        self.assertIn("mm_celly_zombie", cup.prize_for(10, 200, mash)["items"])
        self.assertNotIn("mm_celly_zombie", cup.prize_for(11, 200, mash)["items"])
        self.assertEqual(cup.prize_for(25, 200, mash)["items"], ["mm_band_pumpkin"])
        self.assertEqual(cup.prize_for(150, 200, mash)["label"], "Played the Mash")
        self.assertEqual(cup.prize_table(mash)[-1]["label"], "Played the Mash")

    def test_the_beat_is_kept_whole(self):
        # off the schedule after its window, but its park, its rewards and its soundtrack are all still there
        for f in ("client/js/world/retro.js", "client/audio/beat/tracks.json"):
            self.assertTrue((ROOT / f).is_file(), f)
        beat_items = {i for p in cup.EVENTS["beat"]["prizes"] for i in p[3]}
        self.assertEqual(len(beat_items), 7)
        for i in beat_items:
            self.assertEqual(server_app.CATALOG[i].get("exclusive"), "beat", i)
        tracks = json.loads((ROOT / "client/audio/beat/tracks.json").read_text())["tracks"]
        self.assertEqual(len(tracks), 28)
        self.assertTrue(all((ROOT / "client/audio/beat" / t["file"]).is_file() for t in tracks))


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "monster.sqlite3")
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

    def test_the_mash_replaces_the_beat(self):
        # the handover as it happens on Oct 16, moved to the start of this window so the test runs any day
        w = cup.window_at()
        cut = cup.window_bounds(w)[0]
        old_sched, cup.SCHEDULE = cup.SCHEDULE, [{"event": "kingtut", "from": None, "until": cut - 2 * cup.WINDOW},
                                                 {"event": "jungle", "from": cut - 2 * cup.WINDOW, "until": cut - cup.WINDOW},
                                                 {"event": "beat", "from": cut - cup.WINDOW, "until": cut},
                                                 {"event": "monster", "from": cut, "until": None}]
        try:
            self.call("/api/register", {"username": "mm_" + uuid.uuid4().hex[:6], "password": "longpassword1"})
            self.call("/api/ai-world", {"key": self.key(), "world": {"seed": 4545, "friends": [], "squad": [], "met": {}}})
            build = {"name": "Mash Guy", "position": "SF", "archetype": "slasher", "height": 79, "weight": 210, "wingspan": 83}
            cid = self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]
            cfg = self.call("/api/config")
            self.assertEqual((cfg["event"]["id"], cfg["event"]["venue"], cfg["event"]["name"]), ("monster", "monster", "The Monster Mash"))
            self.assertEqual(sorted(cfg["event_venues"]), ["beat", "favela", "jungle", "kingtut", "monster"])
            st = self.call("/api/cup")
            self.assertEqual(st["event"]["id"], "monster")
            self.assertEqual(st["prizes"][0]["label"], "King of the Mash")
            self.assertIn("mm_bones_top", st["prizes"][0]["items"])
            self.assertEqual(st["prizes"][-1]["label"], "Played the Mash")
            # the Beat's park is closed now (deactivated, not deleted), and so are the older ones; the Mash takes the ante-ups
            for old in ("beat", "jungle", "kingtut"):
                r = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "park", "venue": old, "format": 3, "target": 21, "ante": 500}, expect=400)
                self.assertIn("isn't running", r["error"])
            base = {"character_id": cid, "mode": "park", "venue": "monster", "format": 3, "target": 21}
            self.call("/api/matches", {"key": self.key(), **base}, expect=400)  # (no ante)
            self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "proam", "venue": "monster", "format": 5}, expect=400)
            bal0 = self.call("/api/me")["balance"]
            t = self.call("/api/matches", {"key": self.key(), **base, "ante": 1000})
            self.assertEqual(t["meta"]["event"], "monster")
            self.assertEqual(self.call("/api/me")["balance"], bal0 - 1000)
            old_slack = server_app.TIME_SLACK
            server_app.TIME_SLACK = 10_000
            try:
                res = self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": self.summary(pts=13, fgm=6, fga=10, tpm=1, tpa=3, ast=3, reb=4)})
                self.assertTrue(res["won"])
                self.assertEqual((res["cup"]["event"], res["cup"]["pot"]), ("monster", 2000))
            finally:
                server_app.TIME_SLACK = old_slack
            st = self.call("/api/cup")
            self.assertEqual((st["me"]["games"], st["me"]["event"]), (1, "monster"))
            # the Beat's last window (before the handover) still pays the Beat's prizes
            aid = self.service.db.query("SELECT id FROM accounts WHERE username LIKE 'mm_%'")[0][0]
            with self.service.db.transaction() as c:
                c.execute("UPDATE cup_entries SET window=window-1 WHERE account_id=?", (aid,))
            st = self.call("/api/cup")
            self.assertEqual(st["previous"]["event"]["id"], "beat")
            self.assertTrue(all(i.startswith("bg_") for i in st["previous"]["prize"]["items"]))
            # the Mash's rewards can't be bought
            for item in ("mm_bones_top", "mm_shoes_coffin", "mm_gfx_lantern", "mm_gsnd_organ", "mm_band_pumpkin"):
                r = self.call("/api/store/purchase", {"key": self.key(), "item_id": item, "character_id": cid}, expect=400)
                self.assertIn("Monster Mash exclusive", r["error"])
            # (and the Beat's still can't either, now that it's off the schedule)
            r = self.call("/api/store/purchase", {"key": self.key(), "item_id": "bg_tracksuit_top", "character_id": cid}, expect=400)
            self.assertIn("And The Beat Goes On exclusive", r["error"])
            self.assertEqual(crew.game_xp(200, "park", "monster"), 90)  # park events weigh 1.5x for crew XP, this one too
        finally:
            cup.SCHEDULE = old_sched

    def test_before_the_handover_nothing_changes(self):
        # the schedule as shipped, read at a moment in the Beat's window: the Beat runs, the Mash's park is still closed
        w = cup.window_at()
        cut = cup.window_bounds(w)[1]  # (the Mash starts at the end of this window)
        old_sched, cup.SCHEDULE = cup.SCHEDULE, [{"event": "kingtut", "from": None, "until": cut - 2 * cup.WINDOW},
                                                 {"event": "jungle", "from": cut - 2 * cup.WINDOW, "until": cut - cup.WINDOW},
                                                 {"event": "beat", "from": cut - cup.WINDOW, "until": cut},
                                                 {"event": "monster", "from": cut, "until": None}]
        try:
            self.call("/api/register", {"username": "mb_" + uuid.uuid4().hex[:6], "password": "longpassword1"})
            self.call("/api/ai-world", {"key": self.key(), "world": {"seed": 4646, "friends": [], "squad": [], "met": {}}})
            build = {"name": "Early Guy", "position": "PG", "archetype": "playmaker", "height": 74, "weight": 185, "wingspan": 77}
            cid = self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]
            cfg = self.call("/api/config")
            self.assertEqual(cfg["event"]["id"], "beat")
            self.assertEqual(self.call("/api/cup")["prizes"][0]["label"], "King of the Beat")
            r = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "park", "venue": "monster", "format": 3, "target": 21, "ante": 500}, expect=400)
            self.assertIn("isn't running", r["error"])
            t = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "park", "venue": "beat", "format": 3, "target": 21, "ante": 500})
            self.assertEqual(t["meta"]["event"], "beat")
        finally:
            cup.SCHEDULE = old_sched


if __name__ == "__main__":
    unittest.main()
