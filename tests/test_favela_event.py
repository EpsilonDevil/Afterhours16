"""v0.4.8.7: The Favelas, the park event after The Monster Mash. The schedule hands over at the end of the Mash's second
window (2026-10-20 00:00 UTC, 8 pm Oct 19 Eastern; the schedule itself is events.json), the Mash's park closes (kept
whole), the Favelas take the ante-ups and pay their own seven prizes (the Morro Kit, Ladeira hi-tops, the Passinho, the
Hillside Bandana, the Pipa green release and the Cuica), and the Mash's last window still pays the Mash's.

Run from the project root:  python3 -m unittest tests.test_favela_event -v
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

HANDOVER = 1792454400  # 2026-10-20 00:00 UTC (8 pm Oct 19 Eastern): the end of the Mash's second window
MASH_FROM = 1792108800
ROOT = Path(__file__).resolve().parents[1]
IDS = {"fv_morro_top", "fv_morro_shorts", "fv_shoes_ladeira", "fv_celly_passinho", "fv_band_bandana", "fv_gfx_pipa", "fv_gsnd_cuica"}
SHIPPED = [r.get("event", "shuffle") for r in cup.load_schedule()]


class ScheduleTests(unittest.TestCase):
    def test_the_handover_is_on_a_window_boundary(self):
        self.assertEqual((HANDOVER - cup.EPOCH) % cup.WINDOW, 0)
        self.assertEqual(HANDOVER - MASH_FROM, 2 * cup.WINDOW)  # the Mash gets two full windows
        self.assertEqual(cup.window_bounds(cup.window_at(HANDOVER - 1))[1], HANDOVER)

    @unittest.skipUnless("favela" in SHIPPED, "the Favelas aren't on the shipped schedule yet (events.json is the lead's)")
    def test_the_favelas_follow_the_mash(self):
        sched = cup.load_schedule()
        self.assertEqual([r.get("event", "shuffle") for r in sched], ["kingtut", "jungle", "beat", "monster", "favela", "shuffle"])
        self.assertEqual((sched[3]["until"], sched[4]["from"]), (HANDOVER, HANDOVER))
        self.assertEqual(cup.active_event(HANDOVER - 1, sched)["id"], "monster")
        self.assertEqual(cup.active_event(HANDOVER, sched)["id"], "favela")
        w = cup.window_at(HANDOVER)
        self.assertEqual(cup.event_for_window(w - 1, sched)["id"], "monster")  # its last window pays the Mash's prizes
        self.assertEqual(cup.event_for_window(w, sched)["id"], "favela")
        self.assertIn({"event": "favela", "venue": "favela", "from": HANDOVER, "until": sched[4].get("until")}, cup.public_schedule(sched, now=HANDOVER))

    def test_the_favelas_are_an_event_and_a_venue(self):
        ev = cup.EVENTS["favela"]
        self.assertEqual((ev["id"], ev["venue"], ev["name"], ev["short"], ev["exclusive"], ev["played"]),
                         ("favela", "favela", "The Favelas", "The Favelas", "favela", "Played the Favelas"))
        self.assertEqual(ev["blurb"], "Ante-ups on the hillside: stacked houses, narrow alleys, dirtbikes in the streets.")
        self.assertIn("favela", cup.EVENT_VENUES)
        self.assertIs(cup.EVENT_BY_VENUE["favela"], ev)
        venues = {v["id"]: v for v in server_app.VENUES}
        self.assertTrue(venues["favela"].get("event"))
        self.assertEqual((venues["favela"]["kind"], venues["favela"]["name"]), ("park", "The Favelas"))
        # every event before it is kept whole
        for e in ("kingtut", "jungle", "beat", "monster"):
            self.assertIn(e, cup.EVENTS)
        pe = cup.public_event(ev)
        self.assertEqual((pe["id"], pe["venue"], pe["name"], pe["exclusive"]), ("favela", "favela", "The Favelas", "favela"))
        self.assertEqual(crew.game_xp(200, "park", "favela"), 90)  # park events weigh 1.5x for crew XP, this one too


class PrizeTests(unittest.TestCase):
    def test_the_favelas_prizes(self):
        fv, mash = cup.EVENTS["favela"], cup.EVENTS["monster"]
        self.assertEqual([p[:3] for p in fv["prizes"]], [(1, "King of the Favelas", 150000), (3, "Top 3", 60000), (10, "Top 10", 25000), (25, "Top 25", 10000)])
        # the same tiers, VC and item spread as the Mash, slot for slot
        self.assertEqual([p[0] for p in fv["prizes"]], [p[0] for p in mash["prizes"]])
        self.assertEqual([p[2] for p in fv["prizes"]], [p[2] for p in mash["prizes"]])
        slots = lambda ev: [sorted(server_app.CATALOG[i]["slot"] for i in p[3]) for p in ev["prizes"]]
        self.assertEqual(slots(fv), slots(mash))
        items = {i for p in fv["prizes"] for i in p[3]}
        self.assertEqual(items, IDS)
        self.assertEqual(set(fv["prizes"][0][3]), IDS)  # the winner gets all seven
        others = {i for e in cup.EVENTS.values() if e is not fv for p in e["prizes"] for i in p[3]}
        self.assertEqual(items & others, set())  # all brand new
        for i in items:
            it = server_app.CATALOG[i]
            self.assertEqual((it.get("exclusive"), it.get("price"), it.get("min_overall"), it.get("rep_required")), ("favela", 0, 0, 0), i)
            self.assertFalse(it.get("original_2k_asset"))
            self.assertNotRegex(it["name"] + it["description"], r"(?i)\b(2k|nba|vc store|myplayer|mypark)\b")
        # every exclusive the catalog marks 'favela' is a prize (nothing orphaned, nothing for sale)
        self.assertEqual({i for i, it in server_app.CATALOG.items() if it.get("exclusive") == "favela"}, IDS)
        p = lambda rank: cup.prize_for(rank, 200, fv)
        self.assertEqual(p(1)["label"], "King of the Favelas")
        self.assertTrue({"fv_morro_top", "fv_morro_shorts"} <= set(p(1)["items"]))
        self.assertNotIn("fv_morro_top", p(2)["items"])
        self.assertTrue({"fv_shoes_ladeira", "fv_gfx_pipa"} <= set(p(3)["items"]))
        self.assertNotIn("fv_gfx_pipa", p(4)["items"])
        self.assertTrue({"fv_celly_passinho", "fv_gsnd_cuica"} <= set(p(10)["items"]))
        self.assertNotIn("fv_celly_passinho", p(11)["items"])
        self.assertEqual(p(25)["items"], ["fv_band_bandana"])
        self.assertEqual((p(26)["label"], p(26)["vc"], p(26)["items"]), ("Top half", cup.TOP_HALF_VC, []))
        self.assertEqual((p(150)["label"], p(150)["vc"]), ("Played the Favelas", cup.PLAYED_VC))
        self.assertEqual(cup.prize_table(fv)[-1]["label"], "Played the Favelas")

    def test_the_ai_world_wins_them_too(self):
        # an AI hooper who finishes a Favelas window in the top 25 is handed that rank's items (cup.ai_prizes, qp7)
        w = cup.window_at()
        cut = cup.window_bounds(w)[0]
        old, cup.SCHEDULE = cup.SCHEDULE, [{"event": "monster", "from": None, "until": cut - cup.WINDOW}, {"event": "favela", "from": cut - cup.WINDOW, "until": None}]
        try:
            won = cup.ai_prizes(777, cut - cup.WINDOW + 60, now=cut + 60)
            got = {i for v in won.values() for i in v}
            self.assertEqual(got, IDS)  # (the closed window was the Favelas': every one of its prizes, nothing else)
            self.assertEqual(sum("fv_morro_top" in v for v in won.values()), 1)  # one winner
            self.assertEqual(sum("fv_band_bandana" in v for v in won.values()), 25)
        finally:
            cup.SCHEDULE = old


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "favela.sqlite3")
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

    def setUp(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.service.attempts.clear()

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

    def schedule(self, cut):
        return [{"event": "kingtut", "from": None, "until": cut - 3 * cup.WINDOW}, {"event": "jungle", "from": cut - 3 * cup.WINDOW, "until": cut - 2 * cup.WINDOW},
                {"event": "beat", "from": cut - 2 * cup.WINDOW, "until": cut - cup.WINDOW}, {"event": "monster", "from": cut - cup.WINDOW, "until": cut},
                {"event": "favela", "from": cut, "until": None}]

    def player(self, tag, seed):
        self.call("/api/register", {"username": tag + uuid.uuid4().hex[:6], "password": "longpassword1"})
        self.call("/api/ai-world", {"key": self.key(), "world": {"seed": seed, "friends": [], "squad": [], "met": {}}})
        build = {"name": "Hill Guy", "position": "SG", "archetype": "slasher", "height": 77, "weight": 200, "wingspan": 81}
        return self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]

    def test_the_favelas_replace_the_mash(self):
        # the handover as it happens on Oct 20, moved to the start of this window so the test runs any day
        cut = cup.window_bounds(cup.window_at())[0]
        old_sched, cup.SCHEDULE = cup.SCHEDULE, self.schedule(cut)
        try:
            cid = self.player("fv_", 5151)
            cfg = self.call("/api/config")
            self.assertEqual((cfg["event"]["id"], cfg["event"]["venue"], cfg["event"]["name"], cfg["event"]["exclusive"]), ("favela", "favela", "The Favelas", "favela"))
            self.assertIn("favela", cfg["event_venues"])
            st = self.call("/api/cup")
            self.assertEqual(st["event"]["id"], "favela")
            self.assertEqual(st["prizes"][0]["label"], "King of the Favelas")
            self.assertEqual(set(st["prizes"][0]["items"]), IDS)
            self.assertEqual(st["prizes"][-1]["label"], "Played the Favelas")
            # the Mash's park is closed now (deactivated, not deleted), and so are the older ones; the Favelas take the ante-ups
            for old in ("monster", "beat", "jungle", "kingtut"):
                r = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "park", "venue": old, "format": 3, "target": 21, "ante": 500}, expect=400)
                self.assertIn("isn't running", r["error"])
            base = {"character_id": cid, "mode": "park", "venue": "favela", "format": 3, "target": 21}
            self.call("/api/matches", {"key": self.key(), **base}, expect=400)  # (no ante)
            bal0 = self.call("/api/me")["balance"]
            t = self.call("/api/matches", {"key": self.key(), **base, "ante": 1000})
            self.assertEqual(t["meta"]["event"], "favela")
            self.assertEqual(self.call("/api/me")["balance"], bal0 - 1000)
            old_slack, server_app.TIME_SLACK = server_app.TIME_SLACK, 10_000
            try:
                res = self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": self.summary(pts=12, fgm=5, fga=9, tpm=2, tpa=4, ast=3, reb=2)})
                self.assertTrue(res["won"])
                self.assertEqual((res["cup"]["event"], res["cup"]["pot"]), ("favela", 2000))
            finally:
                server_app.TIME_SLACK = old_slack
            st = self.call("/api/cup")
            self.assertEqual((st["me"]["games"], st["me"]["event"]), (1, "favela"))
            # the rewards can't be bought, whatever the slot
            for item in sorted(IDS):
                r = self.call("/api/store/purchase", {"key": self.key(), "item_id": item, "character_id": cid}, expect=400)
                self.assertIn("The Favelas exclusive", r["error"])
            # (and the Mash's still can't either, now that it's off the schedule)
            r = self.call("/api/store/purchase", {"key": self.key(), "item_id": "mm_bones_top", "character_id": cid}, expect=400)
            self.assertIn("Monster Mash exclusive", r["error"])
            # the Mash's last window (before the handover) still pays the Mash's prizes
            aid = self.service.db.query("SELECT id FROM accounts WHERE username LIKE 'fv_%'")[0][0]
            with self.service.db.transaction() as c:
                c.execute("UPDATE cup_entries SET window=window-1 WHERE account_id=?", (aid,))
            st = self.call("/api/cup")
            self.assertEqual(st["previous"]["event"]["id"], "monster")
            self.assertTrue(all(i.startswith("mm_") for i in st["previous"]["prize"]["items"]))
        finally:
            cup.SCHEDULE = old_sched

    def test_the_winner_is_granted_all_seven(self):
        # the window that just closed was the Favelas': its winner claims the Morro Kit and the rest, once, into the inventory
        cut = cup.window_bounds(cup.window_at())[0]
        old_sched, cup.SCHEDULE = cup.SCHEDULE, self.schedule(cut - cup.WINDOW)
        try:
            cid = self.player("fw_", 5252)
            t = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "park", "venue": "favela", "format": 3, "target": 21, "ante": 1000})
            old_slack, server_app.TIME_SLACK = server_app.TIME_SLACK, 10_000
            try:
                self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": self.summary(pts=14, fgm=6, fga=10, tpm=2, tpa=3)})
            finally:
                server_app.TIME_SLACK = old_slack
            aid = self.service.db.query("SELECT id FROM accounts WHERE username LIKE 'fw_%'")[0][0]
            w = cup.window_at()
            with self.service.db.transaction() as c:
                c.execute("UPDATE cup_entries SET window=window-1 WHERE account_id=?", (aid,))
                e = self.service.cup_entry(c, aid, w - 1)
                e.update(net=10 ** 8, wins=99)  # (far ahead of the whole AI field: 1st)
                self.service.save_cup_entry(c, aid, w - 1, e)
            st = self.call("/api/cup")
            self.assertEqual(st["previous"]["event"]["id"], "favela")
            self.assertEqual(st["previous"]["prize"]["label"], "King of the Favelas")
            bal = self.call("/api/me")["balance"]
            got = self.call("/api/cup/claim", {"key": self.key(), "window": w - 1})
            self.assertEqual((got["rank"], set(got["items"]), got["prize"]["vc"]), (1, IDS, 150000))
            self.assertEqual(got["balance"], bal + 150000)
            owned = {r[0] for r in self.service.db.query("SELECT item_id FROM inventory WHERE account_id=?", (aid,))}
            self.assertTrue(IDS <= owned)
            self.call("/api/cup/claim", {"key": self.key(), "window": w - 1}, expect=400)  # once
            # and he can wear them: the kit, the shoes, the band, the celebration and the green release all equip
            eq = {"top": "fv_morro_top", "bottom": "fv_morro_shorts", "shoes": "fv_shoes_ladeira", "headband": "fv_band_bandana",
                  "celebration": "fv_celly_passinho", "greenfx": "fv_gfx_pipa", "greensound": "fv_gsnd_cuica"}
            for slot, item in eq.items():
                r = self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "item_id": item, "slot": slot})
                self.assertEqual(r["character"]["equipment"][slot], item)
        finally:
            cup.SCHEDULE = old_sched


if __name__ == "__main__":
    unittest.main()
