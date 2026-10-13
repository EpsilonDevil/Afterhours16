"""v0.4.8.5 Pro-Am ranks: Bronze to Grandmaster by RP, per build. The RP a game pays or costs (win or loss, how strong
the other team was, personal performance), forfeits, the lazy seed for older builds, and the API around them.

Run from the project root:  python3 -m unittest tests.test_proam_rank -v
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

# 10 pts on 4/9, 2/2 FT, 4 reb (1 off), 3 ast, 1 stl, 2 tov, 2 pf: game score 7.2, 12.0 per 20 minutes in a 12-minute game
LINE = {"pts": 10, "fgm": 4, "fga": 9, "tpm": 0, "tpa": 2, "ftm": 2, "fta": 2, "reb": 4, "oreb": 1, "ast": 3, "stl": 1, "blk": 0, "tov": 2, "pf": 2}
GAME = 720  # 4 x 3-minute quarters


def stats(**over):
    s = {k: 0 for k in progression.STAT_KEYS}
    s.update(LINE)
    s.update(over)
    return s


class RankMathTests(unittest.TestCase):
    def test_tier_boundaries(self):
        names = [r[1] for r in progression.PROAM_RANKS]
        self.assertEqual(names, ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Grandmaster"])
        for rp, tier in ((0, 0), (399, 0), (400, 1), (799, 1), (800, 2), (1199, 2), (1200, 3), (1599, 3), (1600, 4),
                         (1999, 4), (2000, 5), (2399, 5), (2400, 6), (9999, 6), (-50, 0)):
            self.assertEqual(progression.proam_rank(rp)["tier"], tier, rp)
        r = progression.proam_rank(950)
        self.assertEqual((r["name"], r["floor"], r["next"], r["rp"]), ("Gold", 800, 1200, 950))
        self.assertIsNone(progression.proam_rank(3000)["next"])  # no cap: Grandmaster is open-ended

    def test_competition_direction(self):
        ch = lambda opp, won: progression.proam_rp_change(1000, opp, won, stats(), GAME)
        # beating a stronger team pays more; losing to a weaker one costs more
        self.assertGreater(ch(1600, True)["total"], ch(1000, True)["total"])
        self.assertGreater(ch(1000, True)["total"], ch(400, True)["total"])
        self.assertLess(ch(400, False)["total"], ch(1000, False)["total"])
        self.assertLess(ch(1000, False)["total"], ch(1600, False)["total"])
        # an even game: E = 0.5, competition +-15
        even = ch(1000, True)
        self.assertEqual((even["result"], even["competition"], even["expected"]), (10, 15, 0.5))
        self.assertEqual(ch(1000, False)["competition"], -15)
        # the rating is clamped to 0..3200
        self.assertEqual(ch(99999, True)["opp_rating"], 3200)
        self.assertEqual(ch(-5, True)["opp_rating"], 0)

    def test_performance_is_game_score_per_20_minutes(self):
        s = stats()
        self.assertAlmostEqual(progression.game_score(s), 7.2)
        self.assertEqual(progression.proam_performance(s, GAME), 3)  # (12 - 8) x 0.8 = 3.2
        self.assertEqual(progression.proam_performance(s, 1200), -1)  # the same line over 20 minutes: 7.2 -> -0.64
        big = stats(pts=40, fgm=16, fga=22, ast=10, reb=12, stl=4, blk=3, tov=0)
        bad = stats(pts=0, fgm=0, fga=14, ftm=0, fta=6, ast=0, reb=0, oreb=0, stl=0, tov=8, pf=6)
        self.assertEqual(progression.proam_performance(big, GAME), 12)
        self.assertEqual(progression.proam_performance(bad, GAME), -8)
        for gs in (big, bad, s):
            for secs in (480, 720, 1200, 1680):
                self.assertTrue(-8 <= progression.proam_performance(gs, secs) <= 12)

    def test_a_win_always_pays_at_least_5(self):
        bad = stats(pts=0, fgm=0, fga=14, ftm=0, fta=6, ast=0, reb=0, oreb=0, stl=0, tov=8, pf=6)
        w = progression.proam_rp_change(2800, 0, True, bad, GAME)  # a sure win, played badly
        self.assertEqual(w["total"], 5)
        self.assertEqual(w["result"] + w["competition"] + w["performance"] + w["adjust"], 5)
        self.assertGreater(w["adjust"], 0)

    def test_a_loss_costs_2_to_40(self):
        big = stats(pts=40, fgm=16, fga=22, ast=10, reb=12, stl=4, blk=3, tov=0)
        bad = stats(pts=0, fgm=0, fga=14, ftm=0, fta=6, ast=0, reb=0, oreb=0, stl=0, tov=8, pf=6)
        best = progression.proam_rp_change(500, 3200, False, big, GAME)    # lost to a far stronger team, played great
        worst = progression.proam_rp_change(3000, 0, False, bad, GAME)     # lost to a far weaker team, played badly
        self.assertEqual(best["total"], -2)
        self.assertEqual(worst["total"], -40)
        for ch in (best, worst):
            self.assertEqual(ch["result"] + ch["competition"] + ch["performance"] + ch["adjust"], ch["total"])
        for rp in range(0, 3200, 150):
            for opp in range(0, 3201, 400):
                t = progression.proam_rp_change(rp, opp, False, stats(), GAME)["total"]
                self.assertTrue(-40 <= t <= (0 if rp < 2 else -2), (rp, opp, t))
                self.assertGreaterEqual(progression.proam_rp_change(rp, opp, True, stats(), GAME)["total"], 5)

    def test_rp_never_go_below_zero(self):
        ch = progression.proam_rp_change(7, 0, False, stats(), GAME)
        self.assertEqual(ch["total"], -7)
        char = {"progression": {"proam": {"games": 3, "wins": 0, "rp": 7}}}
        out = progression.proam_apply(char, ch)
        self.assertEqual((out["rp_after"], out["delta"]), (0, -7))
        self.assertEqual(progression.proam_forfeit(char)["rp_after"], 0)
        self.assertEqual(char["progression"]["proam"]["rp"], 0)

    def test_lazy_seed_from_an_older_builds_record(self):
        self.assertEqual(progression.proam_seed(0, 0), 0)
        self.assertEqual(progression.proam_seed(30, 20), 25 * 20 - 15 * 10)
        self.assertEqual(progression.proam_seed(10, 0), 0)            # floor 0
        self.assertEqual(progression.proam_seed(200, 180), 1199)      # a vet starts no higher than Gold
        self.assertEqual(progression.proam_seed(5, 9), 125)           # (wins can't pass games)
        char = {"progression": {"proam": {"games": 30, "wins": 20}}}
        pa = progression.proam_state(char)
        self.assertEqual((pa["rp"], pa["best_rp"]), (350, 350))
        pa["games"], pa["wins"] = 31, 21  # the seed happens once: more games don't re-seed it
        self.assertEqual(progression.proam_state(char)["rp"], 350)
        self.assertEqual(progression.proam_state({})["rp"], 0)

    def test_promotion_and_demotion(self):
        char = {"progression": {"proam": {"games": 0, "wins": 0, "rp": 790}}}
        up = progression.proam_apply(char, progression.proam_rp_change(790, 790, True, stats(), GAME))
        self.assertTrue(up["promoted"])
        self.assertFalse(up["demoted"])
        self.assertEqual((up["rank_before"]["name"], up["rank_after"]["name"]), ("Silver", "Gold"))
        self.assertEqual(char["progression"]["proam"]["last"]["delta"], up["delta"])
        char["progression"]["proam"]["rp"] = 805
        down = progression.proam_forfeit(char)
        self.assertTrue(down["demoted"])
        self.assertEqual((down["rp_after"], down["rank_after"]["name"], down["parts"]), (785, "Silver", {"forfeit": -20}))
        self.assertEqual(char["progression"]["proam"]["best_rp"], up["rp_after"])  # (the best stays)


class RankApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "rank.sqlite3")
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        cls.old_slack = server_app.TIME_SLACK
        server_app.TIME_SLACK = 10_000  # (results of games that "took" 12 minutes, right away)
        cls.call(cls, "/api/dev-account", {})
        build = {"name": "Rank Climber", "position": "PG", "archetype": "playmaker", "height": 74, "weight": 185, "wingspan": 77}
        cls.cid = cls.call(cls, "/api/characters", {"key": uuid.uuid4().hex, "build": build})["character"]["id"]
        cls.call(cls, "/api/proam/team", {"key": uuid.uuid4().hex, "team": {"name": "Late Shift", "abbr": "LS", "primary": "#2457c5", "secondary": "#f2c14e", "logo": "bolt", "wood": "natural", "roster_seed": 5}})

    @classmethod
    def tearDownClass(cls):
        server_app.TIME_SLACK = cls.old_slack
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

    def set_build(self, **proam):
        """The build's saved Pro-Am record as given (no games running): rp left out = a build from before ranks."""
        with self.service.db.transaction() as c:
            c.execute("UPDATE matches SET status='cancelled' WHERE status='running'")
            char = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (self.cid,)).fetchone()[0])
            char["progression"]["proam"] = {"games": 0, "wins": 0, **proam}
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(char), self.cid))

    def saved(self):
        return json.loads(self.service.db.query("SELECT data FROM characters WHERE id=?", (self.cid,))[0][0])["progression"]["proam"]

    def start(self, expect=200, **extra):
        return self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "proam", "venue": "arena", "format": 5, "quarter_len": 180, **extra}, expect)

    def finish(self, ticket, won=True, key=None, **over):
        line = stats(**over)
        summary = {"mode": "proam", "score": [60, 50] if won else [50, 60], "winner": 0 if won else 1, "duration": GAME, "quarter": 4,
                   "players": [], "me": {"team": 0, "stats": line}, "forfeit": False}
        return self.call(f"/api/matches/{ticket['id']}/complete", {"key": key or uuid.uuid4().hex, "summary": summary})

    def test_result_payload_shape_and_the_rp_it_pays(self):
        self.set_build(rp=500)
        t, k = self.start(opp_rating=660), uuid.uuid4().hex
        res = self.finish(t, won=True, key=k)
        pr = res["proam_rank"]
        self.assertEqual(set(pr), {"rp_before", "rp_after", "delta", "parts", "rank_before", "rank_after", "promoted", "demoted", "kind", "opp_rating"})
        self.assertEqual(set(pr["parts"]), {"result", "competition", "performance", "adjust"})
        want = progression.proam_rp_change(500, 660, True, stats(), GAME)
        self.assertEqual(pr["delta"], want["total"])
        self.assertEqual((pr["rp_before"], pr["rp_after"], pr["opp_rating"]), (500, 500 + want["total"], 660))
        self.assertEqual(sum(pr["parts"].values()), pr["delta"])
        self.assertEqual((pr["parts"]["result"], pr["parts"]["performance"]), (10, 3))
        self.assertEqual((pr["rank_before"]["name"], pr["rank_after"]["name"], pr["promoted"], pr["demoted"]), ("Silver", "Silver", False, False))
        # the character comes back with it, and the profile has it
        self.assertEqual(res["character"]["progression"]["proam"]["rp"], pr["rp_after"])
        self.assertEqual(res["character"]["proam_rank"]["name"], "Silver")
        self.assertEqual(res["character"]["progression"]["proam"]["last"]["delta"], pr["delta"])
        me = next(ch for ch in self.call("/api/me")["characters"] if ch["id"] == self.cid)
        self.assertEqual((me["progression"]["proam"]["rp"], me["progression"]["proam"]["games"]), (pr["rp_after"], 1))
        self.assertEqual(me["proam_rank"]["tier"], 1)
        # a replay gets the stored result, without paying again
        self.assertEqual(self.finish(t, won=True, key=k)["proam_rank"], pr)
        self.assertEqual(self.finish(t, won=True)["proam_rank"], pr)
        self.assertEqual(self.saved()["rp"], pr["rp_after"])

    def test_beating_a_stronger_team_pays_more_and_losing_to_a_weaker_costs_more(self):
        self.set_build(rp=1000)
        strong = self.finish(self.start(opp_rating=1800), won=True)["proam_rank"]["delta"]
        self.set_build(rp=1000)
        weak = self.finish(self.start(opp_rating=300), won=True)["proam_rank"]["delta"]
        self.assertGreater(strong, weak)
        self.assertGreaterEqual(weak, 5)
        self.set_build(rp=1000)
        lose_weak = self.finish(self.start(opp_rating=300), won=False)["proam_rank"]["delta"]
        self.set_build(rp=1000)
        lose_strong = self.finish(self.start(opp_rating=1800), won=False)["proam_rank"]["delta"]
        self.assertLess(lose_weak, lose_strong)
        self.assertTrue(-40 <= lose_weak <= -2 and -40 <= lose_strong <= -2)

    def test_promotion_shows_in_the_result(self):
        self.set_build(rp=795)
        pr = self.finish(self.start(opp_rating=795), won=True)["proam_rank"]
        self.assertTrue(pr["promoted"])
        self.assertEqual(pr["rank_after"]["name"], "Gold")

    def test_forfeit_and_leave_costs_20(self):
        self.set_build(rp=300, games=4, wins=2)
        t = self.start()
        res = self.call(f"/api/matches/{t['id']}/cancel", {"forfeit": True})
        self.assertEqual(res["status"], "cancelled")
        self.assertEqual((res["proam_rank"]["delta"], res["proam_rank"]["rp_after"]), (-20, 280))
        self.assertEqual(res["character"]["progression"]["proam"]["rp"], 280)
        self.assertEqual(self.saved()["rp"], 280)
        self.assertEqual(self.saved()["last"]["kind"], "forfeit")
        # cancelling it again changes nothing
        again = self.call(f"/api/matches/{t['id']}/cancel", {"forfeit": True})
        self.assertEqual(again["status"], "cancelled")
        self.assertEqual(self.saved()["rp"], 280)
        # never below 0
        self.set_build(rp=12)
        self.assertEqual(self.call(f"/api/matches/{self.start()['id']}/cancel", {"forfeit": True})["proam_rank"]["rp_after"], 0)
        self.assertEqual(self.saved()["rp"], 0)

    def test_a_lost_connection_costs_nothing(self):
        self.set_build(rp=300)
        res = self.call(f"/api/matches/{self.start()['id']}/cancel", {})
        self.assertEqual(res, {"status": "cancelled", "reward": 0})
        self.assertEqual(self.saved()["rp"], 300)
        res = self.call(f"/api/matches/{self.start()['id']}/cancel", {"forfeit": False})
        self.assertEqual(self.saved()["rp"], 300)
        t = self.start()
        self.call(f"/api/matches/{t['id']}/cancel", {"forfeit": "yes"}, expect=400)
        self.call(f"/api/matches/{t['id']}/cancel", {"forfeit": True, "rp": 5000}, expect=400)
        self.call(f"/api/matches/{t['id']}/cancel", {})
        # a park game's forfeit flag costs no RP
        park = self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "park", "venue": "brick", "format": 3, "target": 21})
        self.call(f"/api/matches/{park['id']}/cancel", {"forfeit": True})
        self.assertEqual(self.saved()["rp"], 300)

    def test_a_pro_am_game_left_running_costs_20_when_the_next_starts(self):
        self.set_build(rp=500)
        self.start()
        b = self.start()  # the first is abandoned
        self.assertEqual(self.saved()["rp"], 480)
        self.assertEqual(self.saved()["last"]["kind"], "abandoned")
        # a park game started next abandons it too
        self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "park", "venue": "brick", "format": 3, "target": 21})
        self.assertEqual(self.saved()["rp"], 460)
        # an abandoned park game costs no RP
        self.start()
        self.assertEqual(self.saved()["rp"], 460)
        row = self.service.db.query("SELECT status, result FROM matches WHERE id=?", (b["id"],))[0]
        self.assertEqual((row["status"], json.loads(row["result"])["reason"], json.loads(row["result"])["proam_rank"]["delta"]), ("cancelled", "abandoned", -20))

    def test_a_forfeited_result_costs_what_forfeit_and_leave_does(self):
        self.set_build(rp=300)
        t = self.start()
        summary = {"mode": "proam", "score": [10, 30], "winner": 1, "duration": 200, "quarter": 2, "players": [], "me": {"team": 0, "stats": stats()}, "forfeit": True}
        pr = self.call(f"/api/matches/{t['id']}/complete", {"key": uuid.uuid4().hex, "summary": summary})["proam_rank"]
        self.assertEqual((pr["delta"], pr["parts"]), (-20, {"forfeit": -20}))

    def test_opponent_rating_is_validated(self):
        self.set_build(rp=900)
        for bad in ("1500", 1.5, True, -1, 3201, [1000], {"rp": 1}):
            self.start(expect=400, opp_rating=bad)
        self.assertEqual(self.start(opp_rating=3200)["meta"]["opp_rating"], 3200)
        self.assertEqual(self.start(opp_rating=0)["meta"]["opp_rating"], 0)
        self.assertEqual(self.start()["meta"]["opp_rating"], 880)  # none given: as strong as you (900, less the game just left)
        # only Pro-Am games take one
        self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "park", "venue": "brick", "format": 3, "target": 21, "opp_rating": 500}, 400)
        # the client never sends RP: a result with extra fields is refused
        t = self.start(opp_rating=500)
        summary = {"mode": "proam", "score": [60, 50], "winner": 0, "duration": GAME, "quarter": 4, "players": [], "me": {"team": 0, "stats": stats()}, "forfeit": False}
        self.call(f"/api/matches/{t['id']}/complete", {"key": uuid.uuid4().hex, "summary": summary, "rp": 9999}, 400)
        self.call(f"/api/matches/{t['id']}/complete", {"key": uuid.uuid4().hex, "summary": {**summary, "rp": 9999}}, 400)

    def test_older_builds_are_seeded_once_from_their_record(self):
        self.set_build(games=30, wins=20)  # no rp: a build from before ranks
        self.assertNotIn("rp", self.saved())
        me = next(ch for ch in self.call("/api/me")["characters"] if ch["id"] == self.cid)
        self.assertEqual(me["progression"]["proam"]["rp"], 350)
        self.assertEqual(me["proam_rank"]["name"], "Bronze")
        # the next game counts from the seed (and doesn't seed again from the record it adds to)
        pr = self.finish(self.start(opp_rating=350), won=True)["proam_rank"]
        self.assertEqual(pr["rp_before"], 350)
        self.assertEqual((self.saved()["rp"], self.saved()["games"], self.saved()["wins"]), (350 + pr["delta"], 31, 21))
        # a vet starts no higher than Gold
        self.set_build(games=300, wins=290)
        self.assertEqual(next(ch for ch in self.call("/api/me")["characters"] if ch["id"] == self.cid)["progression"]["proam"]["rp"], 1199)

    def test_new_builds_start_at_zero_and_park_games_pay_no_rp(self):
        build = {"name": "Fresh Legs", "position": "C", "archetype": "glass_cleaner", "height": 83, "weight": 250, "wingspan": 88}
        ch = self.call("/api/characters", {"key": uuid.uuid4().hex, "build": build})["character"]
        self.assertEqual((ch["progression"]["proam"]["rp"], ch["proam_rank"]["name"]), (0, "Bronze"))
        t = self.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": ch["id"], "mode": "park", "venue": "brick", "format": 3, "target": 21})
        s = {"pts": 11, "fgm": 4, "fga": 9, "tpm": 3, "tpa": 5, "ftm": 0, "fta": 0}
        res = self.call(f"/api/matches/{t['id']}/complete", {"key": uuid.uuid4().hex, "summary": {"mode": "park", "score": [21, 15], "winner": 0, "duration": 600, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}})
        self.assertIsNone(res["proam_rank"])
        self.assertEqual(res["character"]["progression"]["proam"]["rp"], 0)


if __name__ == "__main__":
    unittest.main()
