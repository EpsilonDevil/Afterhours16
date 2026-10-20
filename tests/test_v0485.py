"""v0.4.8.5 server side: the badge requirement changes (Dimer, Chase-Down Artist, Rim Protector, Rebound Chaser, Acrobat,
Contact Finisher), Brick Wall counting successful screens, badges catching up with lowered marks without waiting for a
game (Handles for Days counting the games already played), the home park until Pro 1, and 1-minute Pro Run quarters.

Run from the project root:  python3 -m unittest tests.test_v0485 -v
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

from server import app as server_app, builds, progression

OLD = {"dimer": (25, 80, 200, 420), "chasedown": (15, 50, 120, 250), "rim_protector": (10, 35, 90, 200), "rebound_chaser": (40, 140, 350, 700),
       "acrobat": (45, 130, 300, 600), "contact_finisher": (30, 100, 250, 500)}


def jsround(x):
    return int(x + 0.5)


def char_for(arch="playmaker", height=74, games=0, badges=None):
    pos = "C" if height >= 82 else "PF" if height >= 80 else "PG"
    b = builds.spec({"position": pos, "archetype": arch, "height": height, "weight": 250 if height >= 80 else 190, "wingspan": height + 2})
    ch = {**b, "id": "c1", "attributes": builds.starting_attributes(b), "badges": badges or {}, "progression": {"games": games, "wins": 0, "rep": 0}}
    builds.hof_init(ch)
    return ch


class BadgeTableTests(unittest.TestCase):
    def test_the_new_requirements(self):
        T = {k: v["tiers"] for k, v in progression.BADGES.items()}
        # every tier: Dimer and Chase-Down halved, Rim Protector 35% lower, Rebound Chaser 60% lower (rounded half up)
        # (qp9: Dimer 30% lower again, from 13/40/100/210, and Brick Wall 30% lower: tests the qp9 table below)
        for bid, k in (("dimer", 0.35), ("chasedown", 0.5), ("rim_protector", 0.65), ("rebound_chaser", 0.4)):
            self.assertEqual(T[bid], tuple(jsround(t * k) for t in OLD[bid]), bid)
        # Acrobat and Contact Finisher: Gold and Hall of Fame 40% lower, Bronze and Silver as they were
        for bid in ("acrobat", "contact_finisher"):
            o = OLD[bid]
            self.assertEqual(T[bid], (o[0], o[1], jsround(o[2] * 0.6), jsround(o[3] * 0.6)), bid)
            self.assertTrue(T[bid][1] < T[bid][2] < T[bid][3])
        self.assertEqual((T["dimer"], T["chasedown"], T["rim_protector"], T["rebound_chaser"]), ((9, 28, 70, 147), (8, 25, 60, 125), (7, 23, 59, 130), (16, 56, 140, 280)))
        # Brick Wall: successful screens, not games
        bw = progression.BADGES["brick_wall"]
        self.assertEqual((bw["stat"], bw["tiers"]), ("screens", (18, 63, 154, 173)))  # (v0.4.8.6 qp: Hall of Fame 45% lower, was 315)
        self.assertIn("screens", progression.STAT_KEYS)
        for b in progression.BADGES.values():
            self.assertEqual(list(b["tiers"]), sorted(b["tiers"]))

    def test_a_game_pays_brick_wall_for_its_screens(self):
        ticket = {"mode": "park", "meta": {"target": 21, "streak": 0}}
        s = {k: 0 for k in progression.STAT_KEYS}
        s.update({"pts": 21, "fgm": 9, "fga": 15, "tpm": 3, "tpa": 5, "screens": 6})
        summ = progression.validate_summary({"mode": "park", "score": [21, 15], "winner": 0, "duration": 600, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}, ticket)
        self.assertEqual(summ["stats"]["screens"], 6)
        rw = progression.rewards(summ, ticket, char_for())
        self.assertEqual((rw["badges"]["brick_wall"], rw["badges"]["handles_for_days"]), (6, 1))
        # a count past the cap is held at the cap (the result isn't thrown out)
        s["screens"] = 999
        summ = progression.validate_summary({"mode": "park", "score": [21, 15], "winner": 0, "duration": 600, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}, ticket)
        self.assertEqual(summ["stats"]["screens"], progression.STAT_CAPS["screens"])

    def test_brick_wall_progress_carries_over_at_the_same_share(self):
        old, new = progression.BRICK_WALL_GAMES_TIERS, progression.BADGES["brick_wall"]["tiers"]
        for o, n in zip(old, new):
            self.assertEqual(progression.convert_progress(o, old, new), n)  # a tier's mark is the new tier's mark
        self.assertEqual(progression.convert_progress(0, old, new), 0)
        self.assertEqual(progression.convert_progress(5, old, new), 9)  # half way to Bronze (qp9: Bronze is 18 screens, was 25)
        self.assertEqual(progression.convert_progress(170, old, new), 170)  # 80/90 of the way from Gold to Hall of Fame (qp9: was 424, then 297; v0.4.8.6 qp: Hall of Fame is 173 screens)
        vals = [progression.convert_progress(p, old, new) for p in range(0, 400)]
        self.assertEqual(vals, sorted(vals))


class SyncTests(unittest.TestCase):
    def test_handles_for_days_counts_the_games_already_played_and_goes_up_now(self):
        ch = char_for(games=120, badges={"handles_for_days": {"progress": 96, "tier": 3}})
        self.assertEqual(builds.badge_caps(ch)["handles_for_days"], 4)
        out = progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["handles_for_days"], {"progress": 120, "tier": 4})
        self.assertEqual([u["id"] for u in out["upgraded"]], ["handles_for_days"])
        self.assertEqual(out["cap_breakers_awarded"], builds.CAP_BREAKERS_PER_HOF)
        self.assertEqual(progression.sync_badges(ch), {})  # nothing more to do

    def test_a_lowered_mark_counts_right_away(self):
        ch = char_for("glass_cleaner", height=84, games=10, badges={"rebound_chaser": {"progress": 300, "tier": 2}, "dimer": {"progress": 105, "tier": 2}})
        out = progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["rebound_chaser"]["tier"], 4)  # 300 >= 280
        self.assertEqual(ch["badges"]["dimer"]["tier"], min(3, builds.badge_caps(ch)["dimer"]))  # 105 >= 100 (Gold)
        self.assertIn("rebound_chaser", [u["id"] for u in out["upgraded"]])

    def test_caps_and_the_hall_of_fame_limit_still_hold(self):
        # a 7'1" playmaker: Handles for Days tops out at Silver for him
        giant = char_for(height=85, games=200, badges={"handles_for_days": {"progress": 10, "tier": 1}})
        self.assertEqual(builds.badge_caps(giant)["handles_for_days"], 2)
        progression.sync_badges(giant)
        self.assertEqual(giant["badges"]["handles_for_days"]["tier"], 2)
        # seven Hall of Fame badges already: v0.4.8.7, the eighth goes to Hall of Fame too (there's no limit any more:
        # a 6'8" lockdown can take eight badges to Hall of Fame, and ICON status needs all eight)
        full = {b: {"progress": 9999, "tier": 4} for b in ("catch_shoot", "corner_specialist", "pick_pocket", "interceptor", "rim_protector", "chasedown", "brick_wall")}
        ch = char_for("lockdown", height=80, games=200, badges={**full, "handles_for_days": {"progress": 150, "tier": 3}})
        ch["badges_v0485"] = True
        self.assertEqual(builds.hof_capacity(ch), 8)
        self.assertEqual(builds.hof_count(ch), 7)
        progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["handles_for_days"]["tier"], 4)
        self.assertEqual(builds.hof_count(ch), 8)

    def test_brick_wall_moves_to_screens_once_and_keeps_its_tier(self):
        ch = char_for("lockdown", height=78, games=170, badges={"brick_wall": {"progress": 170, "tier": 3}})
        progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["brick_wall"], {"progress": 170, "tier": 3})  # (qp9: the lower tiers, was 424; v0.4.8.6 qp: 297 before Hall of Fame came down to 173)
        self.assertTrue(ch["badges_v0485"])
        progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["brick_wall"]["progress"], 170)  # (once)
        # a tier is never taken away, even if the converted progress is short of it
        ch2 = char_for("lockdown", height=78, badges={"brick_wall": {"progress": 3, "tier": 2}})
        progression.sync_badges(ch2)
        self.assertEqual(ch2["badges"]["brick_wall"]["tier"], 2)

    def test_a_game_doesnt_count_a_game_twice_for_handles_for_days(self):
        ch = char_for(games=50, badges={"handles_for_days": {"progress": 50, "tier": 2}})
        ticket = {"mode": "park", "meta": {"target": 21, "streak": 0}}
        s = {k: 0 for k in progression.STAT_KEYS}
        s.update({"pts": 21, "fgm": 9, "fga": 15, "tpm": 3, "tpa": 5})
        summ = progression.validate_summary({"mode": "park", "score": [21, 15], "winner": 0, "duration": 600, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}, ticket)
        rw = progression.rewards(summ, ticket, ch)
        progression.apply_progress(ch, summ, rw)
        self.assertEqual((ch["progression"]["games"], ch["badges"]["handles_for_days"]["progress"]), (51, 51))

    def test_a_catch_up_shows_in_the_next_game_result_too(self):
        ch = char_for(games=114, badges={"handles_for_days": {"progress": 100, "tier": 3}})
        ch["badges_v0485"] = True
        ticket = {"mode": "park", "meta": {"target": 21, "streak": 0}}
        s = {k: 0 for k in progression.STAT_KEYS}
        s.update({"pts": 21, "fgm": 9, "fga": 15, "tpm": 3, "tpa": 5})
        summ = progression.validate_summary({"mode": "park", "score": [21, 15], "winner": 0, "duration": 600, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}, ticket)
        prog = progression.apply_progress(ch, summ, progression.rewards(summ, ticket, ch))
        self.assertIn("handles_for_days", [u["id"] for u in prog["badges_upgraded"]])
        self.assertEqual(ch["badges"]["handles_for_days"], {"progress": 115, "tier": 4})


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "v0485.sqlite3")
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        cls.call(cls, "/api/dev-account", {})
        build = {"name": "Home Court", "position": "PG", "archetype": "playmaker", "height": 74, "weight": 185, "wingspan": 77}
        cls.cid = cls.call(cls, "/api/characters", {"key": uuid.uuid4().hex, "build": build})["character"]["id"]
        cls.call(cls, f"/api/characters/{cls.cid}/affiliation", {"key": uuid.uuid4().hex, "affiliation": "harbor"})

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

    def edit(self, f):
        with self.service.db.transaction() as c:
            c.execute("UPDATE matches SET status='cancelled' WHERE status='running'")
            char = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (self.cid,)).fetchone()[0])
            f(char)
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(char), self.cid))

    def saved(self):
        return json.loads(self.service.db.query("SELECT data FROM characters WHERE id=?", (self.cid,))[0][0])

    def test_badges_catch_up_as_the_profile_loads_and_say_so_once(self):
        def setup(ch):
            ch["progression"]["games"] = 130
            ch["badges"] = {"handles_for_days": {"progress": 90, "tier": 3}}
        self.edit(setup)
        me = self.call("/api/me")
        ups = [u for u in me["badge_updates"] if u["character_id"] == self.cid]
        self.assertEqual([b["id"] for u in ups for b in u["upgraded"]], ["handles_for_days"])
        mine = next(c for c in me["characters"] if c["id"] == self.cid)
        self.assertEqual(mine["badges"]["handles_for_days"], {"progress": 130, "tier": 4})
        self.assertEqual(self.saved()["badges"]["handles_for_days"]["tier"], 4)  # saved, not just shown
        self.assertEqual(self.call("/api/me")["badge_updates"], [])  # said once

    def test_home_park_until_pro_1(self):
        def rep(points):
            return lambda ch: ch["progression"].__setitem__("rep", points)
        start = lambda venue, expect: self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "park", "venue": venue, "format": 3, "target": 21}, expect)
        self.edit(rep(0))
        start("harbor", 200)
        err = start("brick", 400)
        self.assertIn("Pro 1", json.dumps(err))
        start("foundry", 400)
        self.edit(rep(progression.REP_THRESHOLDS[progression.TRAVEL_REP_LEVEL] - 1))
        start("brick", 400)
        self.edit(rep(progression.REP_THRESHOLDS[progression.TRAVEL_REP_LEVEL]))
        self.assertEqual(progression.rep_label(progression.rep_level(self.saved()["progression"]["rep"])), "Pro 1")
        start("brick", 200)
        start("foundry", 200)
        # (Pro-Am and the Pro Run aren't parks: open from the start)
        self.edit(rep(0))
        self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "prorun", "venue": "arena", "format": 5, "quarter_len": 300})

    def test_one_minute_pro_run_quarters(self):
        t = self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "prorun", "venue": "arena", "format": 5, "quarter_len": 60})
        self.assertEqual(t["meta"]["quarter_len"], 60)
        self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "prorun", "venue": "arena", "format": 5, "quarter_len": 59}, 400)
        # a 4-minute game's result is taken (the clock check scales with it)
        s = {k: 0 for k in progression.STAT_KEYS}
        s.update({"pts": 6, "fgm": 3, "fga": 5, "screens": 2})
        summ = progression.validate_summary({"mode": "prorun", "score": [14, 10], "winner": 0, "duration": 260, "quarter": 4, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False},
                                            {"mode": "prorun", "meta": {"quarter_len": 60, "quarters": 4}})
        self.assertEqual(summ["stats"]["screens"], 2)


if __name__ == "__main__":
    unittest.main()
