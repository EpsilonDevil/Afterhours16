"""v0.4.8.8 The Pro-Am Overhaul, the server's meta layer (server/proam.py, docs/PROAM-OVERHAUL.md): seasons, divisions and
RP (every rule in §2, the 0-RP demotion included), series, teams (real and AI), matchmaking and its AI fallback, the draft
and its refreshes, and the rank boosts (one tier's, never stacked) in every mode.

Run from the project root:  python3 -m unittest tests.test_v0488_proam -v
"""
import calendar
import datetime
import http.cookiejar
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, proam as P, progression, cup


def utc(y, m, d, h=0, mi=0):
    return calendar.timegm(datetime.datetime(y, m, d, h, mi).timetuple())


def stats(**kw):
    s = {k: 0 for k in progression.STAT_KEYS}
    s.update(kw)
    return s


PAR = stats(pts=14, fgm=6, fga=12, reb=5, ast=4)  # (a decent game: about par)


class Divisions(unittest.TestCase):
    def test_the_ladder(self):
        self.assertEqual([n for _, _, n in P.TIERS], [3, 5, 7, 7, 7, 7, 7])
        self.assertEqual(len(P.DIVS), 43)
        self.assertEqual([P.div_info(i)["label"] for i in (0, 2, 3, 7, 8, 14, 15, 21)],
                         ["Bronze 1", "Bronze 3", "Silver 1", "Silver 5", "Gold 1", "Gold 7", "Platinum 1", "Platinum 7"])
        self.assertEqual(P.div_index(2, 1), 8)
        self.assertEqual(P.PLAYABLE_TOP, 21)
        # down: a tier's first division to the one before's last; Bronze 1 is the floor
        self.assertEqual(P.div_info(P.demote(P.div_index(1, 1)))["label"], "Bronze 3")
        self.assertEqual(P.div_info(P.demote(P.div_index(2, 1)))["label"], "Silver 5")
        self.assertEqual(P.demote(0), 0)
        self.assertEqual(P.div_info(P.promote(P.div_index(0, 3)))["label"], "Silver 1")
        self.assertEqual(P.promote(P.TOP), P.TOP)


class Seasons(unittest.TestCase):
    def test_45_days_ending_at_midnight_eastern(self):
        # starts Oct 22 2026 at 3:12 PM Eastern (19:12 UTC): ends Dec 6 2026 12:00 AM EST (05:00 UTC)
        start = utc(2026, 10, 22, 19, 12)
        self.assertEqual(P.season_end(start), utc(2026, 12, 6, 5))
        # in summer (EDT, UTC-4): midnight Eastern is 04:00 UTC
        self.assertEqual(P.season_end(utc(2027, 5, 1, 12)), utc(2027, 6, 15, 4))
        # a start just after midnight UTC is still the evening before in Eastern: counted from that day
        self.assertEqual(P.season_end(utc(2026, 10, 23, 2)), utc(2026, 12, 6, 5))
        # the DST changes (2nd Sunday of March, 1st of November)
        self.assertEqual(P.et_offset(utc(2026, 3, 8, 6, 59)), -5)
        self.assertEqual(P.et_offset(utc(2026, 3, 8, 7)), -4)
        self.assertEqual(P.et_offset(utc(2026, 11, 1, 5, 59)), -4)
        self.assertEqual(P.et_offset(utc(2026, 11, 1, 6)), -5)

    def test_season_1_from_the_first_boot_then_back_to_back(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            db = server_app.Database(Path(tmp.name) / "s.sqlite3")
            t0 = utc(2026, 10, 22, 19)
            with db.transaction() as c:
                s1 = P.current_season(c, t0)
                self.assertEqual((s1["n"], s1["start"], s1["end"]), (1, t0, P.season_end(t0)))
                self.assertEqual(P.current_season(c, t0 + 86400)["n"], 1, "stored once")
                s2 = P.current_season(c, s1["end"])
                self.assertEqual((s2["n"], s2["start"]), (2, s1["end"]), "the next starts the moment it ends")
                s4 = P.current_season(c, s1["end"] + 100 * 86400)
                self.assertEqual(s4["n"], 4)
                self.assertEqual(c.execute("SELECT count(*) FROM pa_seasons").fetchone()[0], 4)
        finally:
            db.conn.close()
            tmp.cleanup()

    def test_a_new_season_starts_the_build_again_with_the_old_one_kept_and_rewarded(self):
        char = {"id": "c", "progression": {"proam": {"rp": 900, "best_rp": 1000, "games": 30, "wins": 20}}}
        pa, closed = P.player_state(char, 1)
        self.assertEqual((pa["div"], pa["rp"], closed), (0, 0, []), "Season 1: Bronze 1, 0 RP")
        self.assertEqual(char["progression"]["pa_history"]["rank"], "Gold", "the old rank kept as history")
        self.assertEqual(char["progression"]["proam"]["rp"], 900, "and the old RP left as it was")
        pa.update(div=P.div_index(2, 4), rp=60, high=P.div_index(2, 5), sw=4, sl=2, gw=17, gl=9)
        pa2, closed = P.player_state(char, 2)
        self.assertEqual((pa2["season"], pa2["div"], pa2["rp"]), (2, 0, 0))
        self.assertEqual(closed[0]["high_label"], "Gold 5")
        self.assertEqual((closed[0]["sw"], closed[0]["sl"], closed[0]["gw"], closed[0]["gl"]), (4, 2, 17, 9))
        self.assertEqual(char["progression"]["pa_seasons"], closed)
        self.assertEqual(P.season_items(1, P.tier_of(closed[0]["high"])), ["pa_banner_s1_gold", "pa_chain_gold_s1"])
        self.assertEqual(P.season_items(1, 1), ["pa_banner_s1_silver"])
        self.assertEqual(P.player_state(char, 2)[1], [], "once")


class RP(unittest.TestCase):
    def test_a_typical_win_is_about_12_to_25(self):
        same = P.game_rp(5, 50, 5, True, PAR, 720)
        self.assertTrue(12 <= same["total"] <= 25, same)
        self.assertGreater(P.game_rp(5, 50, 9, True, PAR, 720)["total"], same["total"], "beating a better team pays more")
        self.assertLess(P.game_rp(5, 50, 5, False, PAR, 720)["total"], 0)
        self.assertGreaterEqual(P.game_rp(5, 50, 0, True, stats(), 720)["total"], 3, "a win always pays something")
        g = P.game_rp(5, 50, 5, True, PAR, 720)
        self.assertEqual(g["result"] + g["competition"] + g["performance"] + g["adjust"], g["total"])

    def test_100_promotes_at_once_and_carries_over(self):
        pa = P.blank_state(1)
        pa["rp"] = 90
        r = P.apply_game(pa, 25, True)
        self.assertEqual((pa["div"], pa["rp"], r["promoted"]), (1, 15, True))
        # from a tier's top division to the next tier's first
        pa = {**P.blank_state(1), "div": P.div_index(0, 3), "rp": 99}
        P.apply_game(pa, 5, True)
        self.assertEqual((P.div_info(pa["div"])["label"], pa["rp"]), ("Silver 1", 4))
        self.assertEqual(pa["high"], pa["div"])

    def test_games_never_go_below_0_or_demote(self):
        pa = {**P.blank_state(1), "div": 5, "rp": 10}
        P.apply_game(pa, -30, False)
        self.assertEqual((pa["div"], pa["rp"], pa["gl"]), (5, 0, 1))
        P.apply_game(pa, -30, False)
        self.assertEqual((pa["div"], pa["rp"]), (5, 0), "a game alone never demotes")

    def test_a_series_loss_zeroes_rp_and_demotes_who_was_at_0(self):
        a = {**P.blank_state(1), "div": 8, "rp": 40}
        P.series_lost_player(a)
        self.assertEqual((a["div"], a["rp"], a["sl"]), (8, 0, 1))
        P.series_lost_player(a)  # (at 0 RP already: down a division, Gold 1 -> Silver 5)
        self.assertEqual(P.div_info(a["div"])["label"], "Silver 5")
        b = {**P.blank_state(1), "div": 0, "rp": 0}
        P.series_lost_player(b)
        self.assertEqual(b["div"], 0, "Bronze 1 is the floor")

    def test_a_series_win_moves_everyone_up_from_the_teams_division(self):
        lo, at, hi = ({**P.blank_state(1), "div": d, "rp": 30} for d in (1, 4, 9))
        for pa in (lo, at, hi):
            P.series_won_player(pa, 4)
        self.assertEqual((lo["div"], at["div"], hi["div"]), (5, 5, 9), "up to the team's next; one above it stays")
        self.assertEqual(at["rp"], 30)
        self.assertEqual(at["sw"], 1)


class Series(unittest.TestCase):
    def test_shape_bonus_and_when_it_ends(self):
        self.assertEqual([P.series_shape(i) for i in (0, 3, 8, 15)], [(3, 2), (5, 3), (7, 5), (7, 5)])
        self.assertEqual([P.series_bonus(i) for i in (2, 7, 8, 21)], [1500, 3000, 5000, 5000])
        s = {"length": 7, "need": 5, "wins": 4, "losses": 2}
        self.assertIsNone(P.series_outcome(s))
        self.assertEqual(P.series_outcome({**s, "wins": 5}), "won")
        self.assertEqual(P.series_outcome({**s, "losses": 3}), "lost", "7 games, 5 to win: the third loss ends it")
        self.assertEqual(P.series_outcome({"length": 3, "need": 2, "wins": 0, "losses": 2}), "lost")
        self.assertEqual(P.series_outcome({"length": 5, "need": 3, "wins": 3, "losses": 0}), "won")

    def test_home_and_away_by_turns_from_home_and_the_venue(self):
        team = {"id": "t1", "name": "A", "abbr": "A", "div": 0, "data": {"court": "rooftop"}}
        opp = {"id": "ai_x", "name": "B", "abbr": "B", "div": 0, "data": {"court": "cage"}}
        s = P.new_series(team, 1, 0)
        gs = [P.add_game(s, team, opp, "ai", 0) for _ in range(4)]
        self.assertEqual([g["home"] for g in gs], [True, False, True, False])
        self.assertEqual([g["venue"] for g in gs[:2]], ["proam_rooftop", "proam_cage"])
        none = {**team, "data": {}}
        v = P.venue_for(True, none, opp, 1)
        self.assertTrue(v.startswith("proam_") and v[6:] in P.PARKS, "no home court: one of the 12")


class Matchmaking(unittest.TestCase):
    def test_real_teams_within_2_divisions_first_then_the_ai_after_45_s(self):
        mm = P.Matchmaker()
        self.assertIsNone(mm.join("a", 4, now=0))
        self.assertIsNone(mm.join("far", 8, now=1), "4 divisions apart: not paired")
        m = mm.join("b", 6, now=2)
        self.assertEqual((m["kind"], m["opponent"]), ("team", "a"))
        self.assertEqual(mm.poll("a", now=3)["opponent"], "b", "the other side hears it")
        w = mm.poll("far", now=30)
        self.assertEqual(w["kind"], "waiting")
        self.assertEqual(mm.poll("far", now=1 + P.QUEUE_WAIT)["kind"], "ai")
        self.assertNotIn("far", mm.queue)

    def test_the_nearest_ai_team(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            db = server_app.Database(Path(tmp.name) / "m.sqlite3")
            with db.transaction() as c:
                P.ensure_ai_teams(c, 12345, 1, 0)
                for d in (0, 7, 15, 21):
                    t = P.nearest_ai(c, d, 1)
                    self.assertLessEqual(abs(t["div"] - d), 1, (d, t["div"]))
                first = P.nearest_ai(c, 7, 1)
                self.assertNotEqual(P.nearest_ai(c, 7, 1, avoid=first["id"])["id"], first["id"], "not the same one twice in a row")
        finally:
            db.conn.close()
            tmp.cleanup()


class AITeams(unittest.TestCase):
    def test_at_least_24_spread_over_the_ladder_rostered_from_the_world(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            db = server_app.Database(Path(tmp.name) / "a.sqlite3")
            with db.transaction() as c:
                P.ensure_ai_teams(c, 777, 1, 0)
                rows = [P._team_row(r) for r in c.execute("SELECT * FROM pa_teams WHERE ai=1")]
                self.assertGreaterEqual(len(rows), 24)
                self.assertEqual({P.tier_of(t["div"]) for t in rows}, {0, 1, 2, 3}, "every playable tier")
                ids = [i for t in rows for i in t["data"]["roster"]]
                self.assertEqual(len(ids), len(set(ids)), "nobody on two AI teams")
                for t in rows:
                    self.assertEqual(len(t["data"]["roster"]), 7)
                    self.assertTrue(all(cup.tier_of(777, i) in P.tiers_for_div(t["div"]) for i in t["data"]["roster"]), t["name"])
                    self.assertIn(t["data"]["league"], {x[0] for x in P.LEAGUE})
                self.assertEqual(P.ensure_ai_teams(c, 777, 1, 0), 0, "made once")
                # between them, now and then: deterministic rounds that move them
                before = {t["id"]: t["div"] for t in rows}
                P.ai_simulate(c, 1, 0)
                self.assertEqual(P.ai_simulate(c, 1, 3 * P.AI_SIM_EVERY), 3)
                after = {r[0]: r[1] for r in c.execute("SELECT id, div FROM pa_teams WHERE ai=1")}
                self.assertNotEqual(before, after)
                self.assertTrue(all(0 <= d <= P.PLAYABLE_TOP for d in after.values()))
        finally:
            db.conn.close()
            tmp.cleanup()


class Draft(unittest.TestCase):
    def test_5_on_offer_3_refreshes_a_series_and_the_ready_check_fills_in_order(self):
        team = {"id": "t", "name": "T", "abbr": "T", "div": 8, "data": {}}
        s = P.new_series(team, 1, 0)
        taken = {"ai-1", "ai-2"}
        st = P.draft_state(9, s, taken)
        self.assertEqual(len(st["list"]), 5)
        self.assertEqual(len(st["pool"]), P.DRAFT_POOL)
        self.assertTrue(set(st["pool"]).isdisjoint(taken), "none from an AI team's five")
        self.assertTrue(all(cup.tier_of(9, i) in P.tiers_for_div(8) for i in st["pool"]), "near the team's division")
        self.assertEqual(st["refreshes_left"], 3)
        # the captain's game picks 5 of the pool (a spread of positions): checked
        P.draft_set_list(9, s, taken, st["pool"][5:10])
        self.assertEqual(P.draft_state(9, s, taken)["list"], st["pool"][5:10])
        with self.assertRaises(P.Invalid):
            P.draft_set_list(9, s, taken, ["ai-999"] * 5)
        P.draft_pick(9, s, taken, st["pool"][6], open_spots=3)
        self.assertEqual(P.lineup(9, s, taken, humans=2), [st["pool"][6], st["pool"][5], st["pool"][7]], "the pick, then the list in order")
        for _ in range(3):
            P.draft_refresh(s)
        self.assertNotEqual(P.draft_state(9, s, taken)["pool"], st["pool"])
        with self.assertRaises(P.Invalid):
            P.draft_refresh(s)
        # the next series starts with its 3 again
        s2 = P.new_series(team, 1, 0)
        self.assertEqual(P.draft_state(9, s2, taken)["refreshes_left"], 3)


class Boosts(unittest.TestCase):
    def test_one_tiers_boost_in_every_mode_never_stacked(self):
        def char(div):
            return {"progression": {"pa": {**P.blank_state(1), "div": div}}}
        self.assertEqual([progression.rank_boost(char(P.div_index(t, 1))) for t in range(4)], [0, 0.02, 0.04, 0.05])
        self.assertEqual(progression.rank_boost({}), 0, "no season rank yet: none")
        self.assertEqual(progression.rank_boost(char(P.div_index(3, 7))), 0.05, "Platinum's alone, not Silver's + Gold's + Platinum's")
        s = {"mode": "park", "score": [21, 15], "winner": 0, "team": 0, "duration": 600, "quarter": 1, "forfeit": False, "stats": stats(pts=12, ast=3, reb=4)}
        ticket = {"mode": "park", "meta": {"streak": 0}}
        base = progression.rewards(s, ticket, char(0))
        gold = progression.rewards(s, ticket, char(P.div_index(2, 3)))
        self.assertEqual((base["rank_boost"], gold["rank_boost"]), (0, 0.04))
        self.assertEqual(gold["vc"], int(base["vc"] * 1.04))
        self.assertEqual(gold["rep"], int(base["rep"] * 1.04))
        for mode in ("proam", "prorun"):
            s2 = {**s, "mode": mode}
            t2 = {"mode": mode, "meta": {}}
            self.assertEqual(progression.rewards(s2, t2, char(P.div_index(1, 2)))["vc"], int(progression.rewards(s2, t2, char(0))["vc"] * 1.02), mode)
        # an ante's pot isn't boosted: only what the game pays
        cupt = {"mode": "park", "meta": {"streak": 0, "ante": 1000, "venue": "brick"}}
        a, b = progression.rewards(s, cupt, char(0)), progression.rewards(s, cupt, char(P.div_index(2, 1)))
        self.assertEqual(b["vc"] - a["vc"], int(base["vc"] * 1.04) - base["vc"])


class ProAmApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "pa.sqlite3", dev_accounts=False)
        cls.service.rate_limit = lambda ip, category: None
        cls.slack = server_app.TIME_SLACK
        server_app.TIME_SLACK = 100_000
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        server_app.TIME_SLACK = cls.slack
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    def player(self, name="pl"):
        p = type("P", (), {})()
        p.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        p.name = name + "_" + uuid.uuid4().hex[:5]
        p.id = self.call(p, "/api/register", {"username": p.name, "password": "longpassword1"})["account"]["id"]
        build = {"name": name.title(), "position": "PG", "archetype": "playmaker", "height": 75, "weight": 190, "wingspan": 78}
        p.cid = self.call(p, "/api/characters", {"key": uuid.uuid4().hex, "build": build})["character"]["id"]
        return p

    def call(self, p, path, body=None, expect=200):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST", data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with p.opener.open(req, timeout=30) as r:
                status, out = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, out = e.code, json.loads(e.read() or b"null")
        self.assertEqual(status, expect, f"{path}: {out}")
        return out

    def team(self, p, name=None, **kw):
        name = name or ("T" + uuid.uuid4().hex[:8])
        return self.call(p, "/api/proam/create", {"team": {"name": name, "abbr": name[:3].upper(), "primary": "#123456", "secondary": "#abcdef", "logo": "bolt", **kw}})["team"]

    def summary(self, won=True, forfeit=False):
        s = {"pts": 12, "fgm": 5, "fga": 10, "tpm": 1, "tpa": 3, "ftm": 1, "fta": 2, "reb": 4, "ast": 5, "stl": 1, "blk": 0, "tov": 2}
        return {"mode": "proam", "score": [60, 50] if won else [50, 60], "winner": 0 if won else 1, "duration": 700, "quarter": 4, "players": [], "me": {"team": 0, "stats": s}, "forfeit": forfeit}

    def play(self, p, series_game, won=True):
        t = self.call(p, "/api/matches", {"key": uuid.uuid4().hex, "character_id": p.cid, "mode": "proam", "venue": "arena", "format": 5, "quarter_len": 180, "pa_game": series_game})
        self.assertEqual(t["meta"]["pa_game"]["series"], series_game["series"])
        return self.call(p, f"/api/matches/{t['id']}/complete", {"key": uuid.uuid4().hex, "summary": self.summary(won)})

    def queue_ai(self, p, tid):
        q = self.call(p, "/api/proam/queue", {"action": "join"})
        if q["state"] == "waiting":
            self.service.proam.mm.queue[tid]["since"] -= P.QUEUE_WAIT + 1  # (45 s on, nobody: the AI)
            q = self.call(p, "/api/proam/queue", {"action": "poll"})
        self.assertEqual(q["state"], "matched")
        return q

    def test_the_first_visit_a_team_and_the_search(self):
        a = self.player("ann")
        st = self.call(a, "/api/proam")
        self.assertIsNone(st["team"])
        self.assertEqual(st["season"]["n"], 1)
        self.assertEqual(st["builds"][0]["pa"]["label"], "Bronze 1")
        t = self.team(a, "Night Shift Five", court="rooftop")
        self.assertEqual((t["division"]["label"], t["size"], len(t["members"]), t["open"], t["court"]), ("Bronze 1", 1, 1, True, "rooftop"))
        self.call(a, "/api/proam/create", {"team": {"name": "Another One", "abbr": "ANO"}}, expect=400)  # (one team an account)
        b = self.player("ben")
        self.call(b, "/api/proam/create", {"team": {"name": "night shift five", "abbr": "NSF"}}, expect=400)  # (taken)
        found = self.call(b, "/api/proam/search?q=night")["teams"]
        self.assertEqual(found[0]["name"], "Night Shift Five")
        ai = self.call(b, "/api/proam/search?q=Gulls")["teams"]
        self.assertTrue(ai and ai[0]["ai"])
        self.assertTrue(self.call(b, "/api/proam/search?q=HBV")["teams"])

    def test_joining_open_and_invite_only_founder_and_leaving(self):
        a, b, c_ = self.player("fo"), self.player("jo"), self.player("re")
        t = self.team(a)
        self.assertEqual(self.call(b, "/api/proam/join", {"team_id": t["id"]})["result"], "joined")
        self.call(a, "/api/proam/update", {"team": {"open": False}})
        self.assertEqual(self.call(c_, "/api/proam/join", {"team_id": t["id"]})["result"], "requested")
        self.call(b, "/api/proam/update", {"team": {"open": True}}, expect=400)  # (the founder's alone)
        view = self.call(a, "/api/proam")["team"]
        self.assertEqual([r["account_id"] for r in view["requests"]], [c_.id])
        self.assertEqual(self.call(a, "/api/proam/answer", {"account_id": c_.id, "accept": True})["result"], "joined")
        self.assertEqual(len(self.call(a, "/api/proam")["team"]["members"]), 3)
        self.call(a, "/api/proam/kick", {"account_id": c_.id})
        self.call(a, "/api/proam/handon", {"account_id": b.id})
        self.assertEqual(self.call(b, "/api/proam")["team"]["founder"], b.id)
        self.call(b, "/api/proam/leave", {})
        self.assertEqual(self.call(a, "/api/proam")["team"]["founder"], a.id, "the founder who leaves hands it on")

    def test_ten_at_most(self):
        a = self.player("cap")
        t = self.team(a)
        for i in range(9):
            self.call(self.player(f"m{i}"), "/api/proam/join", {"team_id": t["id"]})
        self.call(self.player("eleventh"), "/api/proam/join", {"team_id": t["id"]}, expect=400)

    def test_a_series_against_the_ai_won_and_what_it_does(self):
        a = self.player("sw")
        t = self.team(a)
        before = self.call(a, "/api/me")["balance"]
        q = self.queue_ai(a, t["id"])
        g = q["game"]
        self.assertEqual((g["n"], g["home"], g["opponent"]["kind"]), (1, True, "ai"))
        self.assertTrue(g["venue"].startswith("proam_"))
        self.assertEqual((q["series"]["length"], q["series"]["need"]), (3, 2), "Bronze: first to 2 of 3")
        r1 = self.play(a, {"series": q["series"]["id"], "n": 1})
        self.assertGreater(r1["pa"]["delta"], 0)
        self.assertEqual(r1["pa"]["series"]["wins"], 1)
        # the same game is there till it's played; the next is matched on its own, away
        q2 = self.queue_ai(a, t["id"])
        self.assertEqual((q2["game"]["n"], q2["game"]["home"]), (2, False))
        r2 = self.play(a, {"series": q2["series"]["id"], "n": 2})
        s = r2["pa"]["series"]
        self.assertEqual((s["status"], s["bonus"]), ("won", 1500))
        me = self.call(a, "/api/proam")
        self.assertEqual(me["team"]["division"]["label"], "Bronze 2", "the team up a division")
        self.assertEqual(me["builds"][0]["pa"]["label"], "Bronze 2", "and the player who played in it")
        self.assertEqual(me["builds"][0]["pa"]["series"], [1, 0])
        self.assertEqual(self.call(a, "/api/me")["balance"], before + r1["vc"] + r2["vc"] + 1500)
        self.assertIsNone(me["team"]["current"], "no series on till the next queue")
        # a game of a series that's over can't be played
        self.call(a, "/api/matches", {"key": uuid.uuid4().hex, "character_id": a.cid, "mode": "proam", "venue": "arena", "format": 5, "quarter_len": 180, "pa_game": {"series": s["id"], "n": 2}}, expect=400)

    def test_a_series_lost_zeroes_and_a_forfeit_is_a_loss(self):
        a = self.player("sl")
        t = self.team(a)
        q = self.queue_ai(a, t["id"])
        r = self.play(a, {"series": q["series"]["id"], "n": 1}, won=False)
        self.assertEqual(r["pa"]["series"]["losses"], 1)
        # forfeiting the next: -20, and the series' second loss (Bronze: over)
        q2 = self.queue_ai(a, t["id"])
        tk = self.call(a, "/api/matches", {"key": uuid.uuid4().hex, "character_id": a.cid, "mode": "proam", "venue": "arena", "format": 5, "quarter_len": 180, "pa_game": {"series": q2["series"]["id"], "n": 2}})
        self.call(a, f"/api/matches/{tk['id']}/cancel", {"forfeit": True})
        me = self.call(a, "/api/proam")
        self.assertEqual(me["builds"][0]["pa"]["rp"], 0)
        self.assertEqual(me["builds"][0]["pa"]["series"], [0, 1])
        self.assertEqual(me["team"]["current"], None)
        with self.service.db.transaction() as c:
            sr = json.loads(c.execute("SELECT data FROM pa_series WHERE id=?", (q2["series"]["id"],)).fetchone()[0])
        self.assertEqual((sr["status"], sr["losses"]), ("lost", 2))

    def test_two_real_teams_are_paired(self):
        a, b = self.player("ra"), self.player("rb")
        ta, tb = self.team(a), self.team(b)
        self.assertEqual(self.call(a, "/api/proam/queue", {"action": "join"})["state"], "waiting")
        qb = self.call(b, "/api/proam/queue", {"action": "join"})
        self.assertEqual((qb["state"], qb["game"]["opponent"]["kind"], qb["game"]["opponent"]["id"]), ("matched", "team", ta["id"]))
        qa = self.call(a, "/api/proam/queue", {"action": "poll"})
        self.assertEqual(qa["game"]["opponent"]["id"], tb["id"])
        self.assertNotEqual(qa["game"]["home"], qb["game"]["home"], "one at home, one away")
        self.assertEqual(qa["game"]["venue"], qb["game"]["venue"], "at the same court")

    def test_the_draft_through_the_service(self):
        a = self.player("dr")
        self.team(a)
        d = self.call(a, "/api/proam/draft", {"action": "view"})["draft"]
        self.assertEqual((len(d["list"]), d["refreshes_left"]), (5, 3))
        d2 = self.call(a, "/api/proam/draft", {"action": "refresh"})["draft"]
        self.assertEqual(d2["refreshes_left"], 2)
        self.call(a, "/api/proam/draft", {"action": "pick", "ai_id": d2["list"][0], "humans": 1})
        self.assertEqual(self.call(a, "/api/proam/lineup", {"humans": 1})["ai"][0], d2["list"][0])
        self.assertEqual(len(self.call(a, "/api/proam/lineup", {"humans": 2})["ai"]), 3)

    def test_old_saves_keep_loading_and_their_rp_is_history(self):
        a = self.player("old")
        with self.service.db.transaction() as c:
            ch = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (a.cid,)).fetchone()[0])
            ch["progression"]["proam"] = {"games": 40, "wins": 30, "rp": 1300, "best_rp": 1400}
            ch["progression"].pop("pa", None); ch["progression"].pop("pa_history", None)
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), a.cid))
        me = self.call(a, "/api/me")
        ch = next(x for x in me["characters"] if x["id"] == a.cid)
        self.assertEqual((ch["pa"]["label"], ch["pa_history"]["rank"], ch["pa_history"]["rp"]), ("Bronze 1", "Platinum", 1300))
        self.assertEqual(ch["proam_rank"]["name"], "Platinum", "the old field is still there")

    def set_pa(self, p, **pa):
        self.call(p, "/api/me")  # (the build in this season first: its pa)
        with self.service.db.transaction() as c:
            ch = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (p.cid,)).fetchone()[0])
            ch["progression"].setdefault("pa", {}).update(pa)
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), p.cid))

    def test_rank_items_are_won_not_bought_and_kept_after_a_demotion(self):
        # (§4: the Gold chain and canvas low-tops, the Platinum watch and headband: free, exclusive, never in the store)
        for i in ("pa_chain_gold", "pa_shoes_gold_canvas", "pa_watch_platinum", "pa_headband_platinum"):
            it = server_app.CATALOG[i]
            self.assertEqual((it["price"], it["exclusive"]), (0, "proam"), i)
        self.assertEqual(server_app.CATALOG["pa_chain_gold"]["letters"], "PRO-AM")
        a = self.player("rk")
        me = self.call(a, "/api/me")
        self.assertFalse([i for i in me["inventory"] if i.startswith("pa_")], "Bronze: nothing yet")
        r = self.call(a, "/api/store/purchase", {"key": uuid.uuid4().hex, "item_id": "pa_chain_gold", "character_id": a.cid}, expect=400)
        self.assertIn("Pro-Am exclusive", r["error"])
        self.set_pa(a, div=P.div_index(P.PLATINUM, 1), high=P.div_index(P.PLATINUM, 1))
        me = self.call(a, "/api/me")
        self.assertTrue({"pa_chain_gold", "pa_shoes_gold_canvas", "pa_watch_platinum", "pa_headband_platinum"} <= set(me["inventory"]), "Platinum: both tiers' items")
        ch = next(x for x in me["characters"] if x["id"] == a.cid)
        self.assertEqual((ch["pa"]["tier"], ch["pa"]["best"], ch["pa"]["boost"]), (3, 3, 0.05))
        for slot, i in (("wristband", "pa_watch_platinum"), ("headband", "pa_headband_platinum"), ("chain", "pa_chain_gold"), ("shoes", "pa_shoes_gold_canvas")):
            self.call(a, f"/api/characters/{a.cid}/equip", {"key": uuid.uuid4().hex, "slot": slot, "item_id": i})
        # demoted to Gold: the items stay his and on him, the best tier reached stays Platinum, the boost follows the tier now
        self.set_pa(a, div=P.div_index(P.GOLD, 7))
        me = self.call(a, "/api/me")
        ch = next(x for x in me["characters"] if x["id"] == a.cid)
        self.assertEqual((ch["pa"]["tier"], ch["pa"]["best"], ch["pa"]["boost"]), (2, 3, 0.04))
        self.assertEqual(ch["equipment"]["wristband"], "pa_watch_platinum")
        self.assertIn("pa_headband_platinum", me["inventory"])

    def test_season_banners_go_in_their_own_slot_and_the_season_chain_looks_like_the_chain(self):
        from server import builds
        self.assertIn("banner", builds.EQUIP_SLOTS)
        self.assertIn("banner", builds.OPTIONAL_SLOTS)
        items = {i["id"]: i for i in P.season_catalog(1)}
        chain = items["pa_chain_gold_s1"]
        self.assertEqual((chain["pendant"], chain["letters"], chain["stamp"], chain["link"]), ("plate", "PRO-AM", "S1", server_app.CATALOG["pa_chain_gold"]["link"]))
        a = self.player("bn")
        with self.service.db.transaction() as c:
            c.execute("INSERT INTO inventory VALUES(?,?,?)", (a.id, "pa_banner_s1_gold", time.time()))
        self.call(a, "/api/me")  # (the season's items are in the catalog once a profile loads)
        out = self.call(a, f"/api/characters/{a.cid}/equip", {"key": uuid.uuid4().hex, "slot": "banner", "item_id": "pa_banner_s1_gold"})
        self.assertEqual(out["character"]["equipment"]["banner"], "pa_banner_s1_gold")
        self.call(a, f"/api/characters/{a.cid}/equip", {"key": uuid.uuid4().hex, "slot": "chain", "item_id": "pa_banner_s1_gold"}, expect=400)
        out = self.call(a, f"/api/characters/{a.cid}/equip", {"key": uuid.uuid4().hex, "slot": "banner", "item_id": None})
        self.assertNotIn("banner", out["character"]["equipment"], "a banner comes off")
        self.call(a, "/api/store/purchase", {"key": uuid.uuid4().hex, "item_id": "pa_banner_s1_platinum", "character_id": a.cid}, expect=400)

    def test_the_results_say_the_rank_boost(self):
        a = self.player("rb")
        self.set_pa(a, div=P.div_index(P.GOLD, 1), high=P.div_index(P.GOLD, 1))
        t = self.call(a, "/api/matches", {"key": uuid.uuid4().hex, "character_id": a.cid, "mode": "park", "venue": "brick", "format": 3, "target": 21})
        s = self.summary()
        s["mode"] = "park"; s["score"] = [21, 15]
        r = self.call(a, f"/api/matches/{t['id']}/complete", {"key": uuid.uuid4().hex, "summary": s})
        self.assertEqual(r["rank_boost"], 0.04)

    def set_team_div(self, tid, div):
        with self.service.db.transaction() as c:
            c.execute("UPDATE pa_teams SET div=? WHERE id=?", (div, tid))

    def park_summary(self, won=True):
        s = self.summary(won)
        s["mode"] = "park"; s["score"] = [11, 6] if won else [6, 11]; s["duration"] = 300
        s["me"]["stats"].update({"pts": 6, "fgm": 3, "fga": 7, "tpm": 0, "tpa": 1, "ftm": 0, "fta": 0})
        return s

    def test_home_court_3s_pay_a_quarter_and_touch_nothing_else(self):
        a = self.player("hc")
        t = self.team(a, court="rooftop")
        home = {"character_id": a.cid, "mode": "park", "venue": "proam_rooftop", "format": 3, "target": 11, "difficulty": 0.6, "pa_home": True}
        r = self.call(a, "/api/matches", {"key": uuid.uuid4().hex, **home}, expect=400)
        self.assertIn("Gold", r["error"], "Bronze: not yet")
        self.set_team_div(t["id"], P.div_index(P.GOLD, 1))
        self.call(a, "/api/matches", {"key": uuid.uuid4().hex, **home, "venue": "proam_cage"}, expect=400)  # (not his court)
        self.call(a, "/api/matches", {"key": uuid.uuid4().hex, **home, "pa_home": 1}, expect=400)
        self.call(a, "/api/matches", {"key": uuid.uuid4().hex, **home, "ante": 1000}, expect=400)
        self.call(a, "/api/matches", {"key": uuid.uuid4().hex, **home, "mode": "proam"}, expect=400)
        outsider = self.player("hx")
        self.call(outsider, "/api/matches", {"key": uuid.uuid4().hex, **home, "character_id": outsider.cid}, expect=400)  # (no team)
        # a park streak to keep, and the build's own win streak
        with self.service.db.transaction() as c:
            ch = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (a.cid,)).fetchone()[0])
            ch["progression"].setdefault("park", {}).update({"streak": 5, "games": 9, "wins": 7}); ch["progression"]["win_streak"] = 5
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), a.cid))
        before = self.call(a, "/api/me")
        ch0 = next(x for x in before["characters"] if x["id"] == a.cid)
        tk = self.call(a, "/api/matches", {"key": uuid.uuid4().hex, **home})
        self.assertTrue(tk["meta"]["pa_home"]); self.assertEqual(tk["meta"]["streak"], 0)
        r = self.call(a, f"/api/matches/{tk['id']}/complete", {"key": uuid.uuid4().hex, "summary": self.park_summary()})
        # the same game as a plain park game with no streak (his own rank's boost: Bronze, none): a quarter of that
        meta = {"format": 3, "target": 11, "streak": 0, "venue": "proam_rooftop"}
        plain = progression.rewards(progression.validate_summary(self.park_summary(), {"mode": "park", "meta": meta}), {"mode": "park", "meta": meta},
                                    {"progression": {"pa": {"div": 0}}})
        self.assertEqual(r["vc"], int(plain["vc"] * progression.PA_HOME_VC))
        self.assertGreater(plain["vc"], r["vc"])
        self.assertEqual((r["rep"], r.get("bounty", 0), r["cup"], r["crew"], r["pa_home"]), (0, 0, None, None, True))
        self.assertTrue(r["badge_progress"], "badge progress as usual")
        self.assertNotIn("pa", r)
        after = self.call(a, "/api/me")
        ch1 = next(x for x in after["characters"] if x["id"] == a.cid)
        self.assertEqual(after["balance"], before["balance"] + r["vc"])
        p0, p1 = ch0["progression"], ch1["progression"]
        self.assertEqual((p1["park"]["streak"], p1["park"]["games"], p1["park"]["wins"], p1["win_streak"]), (5, 9, 7, 5), "no streak, no park record")
        self.assertEqual(p1.get("rep", 0), p0.get("rep", 0), "no Rep")
        self.assertEqual((ch1["pa"]["rp"], ch1["pa"]["record"]), (ch0["pa"]["rp"], ch0["pa"]["record"]), "no Pro-Am RP")
        # leaving one half-way undoes nothing
        tk2 = self.call(a, "/api/matches", {"key": uuid.uuid4().hex, **home})
        self.call(a, f"/api/matches/{tk2['id']}/cancel", {})
        ch2 = next(x for x in self.call(a, "/api/me")["characters"] if x["id"] == a.cid)
        self.assertEqual((ch2["progression"]["park"]["streak"], ch2["progression"]["win_streak"]), (5, 5))

    def test_gold_clubhouse_custom_look(self):
        a = self.player("cu")
        t = self.team(a)
        custom = {"floor": "ebony", "walls": "team", "logo": "wolf", "colors": ["#112233", "#ddeeff"]}
        r = self.call(a, "/api/proam/update", {"team": {"custom": custom}}, expect=400)
        self.assertIn("Gold", r["error"])
        self.set_team_div(t["id"], P.div_index(P.GOLD, 2))
        self.call(a, "/api/proam/update", {"team": {"custom": custom}})
        view = self.call(a, "/api/proam")["team"]
        self.assertEqual(view["custom"], custom)
        self.assertEqual(self.call(a, "/api/proam/search?q=" + t["name"])["teams"][0]["custom"], custom, "the brief carries it")
        for bad in ({**custom, "floor": "marble"}, {**custom, "walls": "glass"}, {**custom, "logo": "dragon"}, {**custom, "colors": ["red", "#ffffff"]},
                    {**custom, "colors": ["#ffffff"]}, {**custom, "extra": 1}, "ebony"):
            self.call(a, "/api/proam/update", {"team": {"custom": bad}}, expect=400)
        b = self.player("cv")
        self.call(b, "/api/proam/join", {"team_id": t["id"]})
        self.call(b, "/api/proam/update", {"team": {"custom": custom}}, expect=400)  # (the founder's alone)
        self.assertEqual(set(P.CUSTOM_FLOORS), {"natural", "honey", "ebony", "whitewash", "slate"})
        self.assertEqual(set(P.CUSTOM_WALLS), {"brick", "block", "panel", "concrete", "team"})

    def test_real_vs_real_meet_as_one_game(self):
        # (the pairing: both teams' games share a match id; each Captain says who's playing, each sees the other's)
        a, b = self.player("va"), self.player("vb")
        ta, tb = self.team(a), self.team(b)
        self.call(a, "/api/proam/queue", {"action": "join"})
        gb = self.call(b, "/api/proam/queue", {"action": "join"})["game"]
        ga = self.call(a, "/api/proam/queue", {"action": "poll"})["game"]
        self.assertTrue(ga["match"] and ga["match"] == gb["match"])
        self.assertNotEqual(ga["home"], gb["home"])
        r = self.call(a, "/api/proam/queue", {"action": "side", "match": ga["match"], "side": {"online": True, "humans": [{"id": a.id, "username": a.name}], "lineup": ["x1", 5]}})
        self.assertIsNone(r["other"])
        self.assertEqual(r["mine"]["lineup"], ["x1"], "only ids")
        r = self.call(b, "/api/proam/queue", {"action": "side", "match": gb["match"], "side": {"online": True, "humans": [{"id": b.id, "username": b.name}], "lineup": []}})
        self.assertEqual((r["other"]["humans"][0]["id"], r["other"]["team"]["id"], r["other"]["online"]), (a.id, ta["id"], True))
        seen = self.call(a, "/api/proam/queue", {"action": "side", "match": ga["match"]})["other"]
        self.assertEqual((seen["team"]["id"], seen["series"], seen["n"], seen["home"]), (tb["id"], self.call(b, "/api/proam")["team"]["current"]["id"], 1, gb["home"]))
        self.call(a, "/api/proam/queue", {"action": "side", "match": "nope"}, expect=400)
        # each plays for his own team's series: the home Captain's setup carries both (pa by team)
        r1 = self.play(a, {"series": self.call(a, "/api/proam")["team"]["current"]["id"], "n": 1}, won=True)
        r2 = self.play(b, {"series": seen["series"], "n": 1}, won=False)
        self.assertEqual((r1["pa"]["series"]["wins"], r2["pa"]["series"]["losses"]), (1, 1))
        self.assertNotIn("proam_rank", {k: v for k, v in r1.items() if v}, "a series game leaves the old RP alone")

    def test_the_names_the_hub_reads(self):
        a = self.player("hn")
        t = self.team(a, court="cage")
        q = self.queue_ai(a, t["id"])
        st = self.call(a, "/api/proam")
        self.assertTrue({"team", "season"} <= set(st))
        tv = st["team"]
        for k in ("id", "name", "abbr", "primary", "secondary", "logo", "court", "founder", "members", "division", "record", "series", "current", "custom"):
            self.assertIn(k, tv, k)
        self.assertTrue({"account_id", "username"} <= set(tv["members"][0]))
        self.assertTrue({"tier", "label"} <= set(tv["division"]))
        cur = tv["current"]
        for k in ("wins", "losses", "need", "length", "games", "picks"):
            self.assertIn(k, cur, k)
        g = cur["games"][0]
        self.assertTrue({"home", "result", "score", "venue"} <= set(g) and {"name", "kind"} <= set(g["opponent"]))
        self.assertEqual(g["opponent"]["kind"], "ai")
        self.assertEqual(q["series"]["id"], cur["id"])


if __name__ == "__main__":
    unittest.main()
