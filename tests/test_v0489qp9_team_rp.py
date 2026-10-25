"""v0.4.8.9 qp9: a player team's RP (server/proam.py). It never promotes the team (only a series win does); it keeps
counting past 100 while the series plays out; on the promotion the division's 100 is spent and only the excess starts the
next division (David's rule: 130 -> 30, 60 -> 0). qp10, a lost series: a team banked past 100 drops to 100 (a second loss
from there resets to 0); a team at 0 is demoted; anyone else goes to 0.

Run from the project root:  python3 -m unittest tests.test_v0489qp9_team_rp -v
"""
import json
import tempfile
import unittest
from pathlib import Path

from server import app as server_app, proam as P
from tests import test_v0488_proam as base


class TeamRP(base.ProAmApi):
    def team_row(self, tid):
        with self.service.db.transaction() as c:
            return P.load_team(c, tid)

    def set_team_rp(self, tid, rp):
        with self.service.db.transaction() as c:
            t = P.load_team(c, tid)
            t["rp"] = rp
            P.save_team(c, t)

    def test_rp_past_100_is_banked_and_never_promotes_by_itself(self):
        a = self.player("bank")
        t = self.team(a)
        self.set_team_rp(t["id"], 95)
        q = self.queue_ai(a, t["id"])
        r = self.play(a, {"series": q["series"]["id"], "n": 1})
        self.assertGreater(r["pa"]["delta"], 5)
        row = self.team_row(t["id"])
        self.assertGreater(row["rp"], 100, "the RP over 100 is kept, not capped")
        self.assertEqual(row["div"], 0, "RP alone never promotes the team: Bronze 1 till the series is won")

    def test_a_series_win_spends_100_and_carries_the_excess(self):
        a = self.player("carry")
        t = self.team(a)
        q = self.queue_ai(a, t["id"])
        self.play(a, {"series": q["series"]["id"], "n": 1})
        self.set_team_rp(t["id"], 120)
        q2 = self.queue_ai(a, t["id"])
        r2 = self.play(a, {"series": q2["series"]["id"], "n": 2})
        self.assertEqual(r2["pa"]["series"]["status"], "won")
        row = self.team_row(t["id"])
        self.assertEqual(row["div"], 1, "Bronze 2")
        self.assertEqual(row["rp"], 120 + r2["pa"]["delta"] - 100, "the excess over 100 starts the next division")

    def test_a_series_win_below_100_starts_the_next_division_at_0(self):
        a = self.player("low")
        t = self.team(a)
        q = self.queue_ai(a, t["id"])
        self.play(a, {"series": q["series"]["id"], "n": 1})
        self.set_team_rp(t["id"], 10)
        q2 = self.queue_ai(a, t["id"])
        self.play(a, {"series": q2["series"]["id"], "n": 2})
        row = self.team_row(t["id"])
        self.assertEqual((row["div"], row["rp"]), (1, 0))

    def lose_series(self, a, tid, rp_before_last=None):
        q = self.queue_ai(a, tid)
        self.play(a, {"series": q["series"]["id"], "n": q["game"]["n"]}, won=False)
        if rp_before_last is not None:
            self.set_team_rp(tid, rp_before_last)
        q2 = self.queue_ai(a, tid)
        r = self.play(a, {"series": q2["series"]["id"], "n": q2["game"]["n"]}, won=False)
        self.assertEqual(r["pa"]["series"]["status"], "lost")
        return self.team_row(tid)

    def set_team_div(self, tid, div):
        with self.service.db.transaction() as c:
            t = P.load_team(c, tid)
            t["div"] = div
            P.save_team(c, t)

    def test_qp10_a_lost_series_with_rp_banked_drops_to_100_then_a_second_one_to_0(self):
        a = self.player("bank_loss")
        t = self.team(a)
        self.set_team_div(t["id"], 1)
        row = self.lose_series(a, t["id"], rp_before_last=180)
        self.assertEqual((row["div"], row["rp"]), (1, 100), "banked past 100: down to the division's max, no demotion")
        row = self.lose_series(a, t["id"], rp_before_last=100)
        self.assertEqual((row["div"], row["rp"]), (1, 0), "lost again at the max: reset to 0 as ever")

    def test_qp10_a_lost_series_at_0_still_demotes_and_otherwise_zeroes(self):
        a = self.player("zero_loss")
        t = self.team(a)
        self.set_team_div(t["id"], 1)
        row = self.lose_series(a, t["id"], rp_before_last=60)
        self.assertEqual((row["div"], row["rp"]), (1, 0), "lost with 60: to 0, no demotion")
        row = self.lose_series(a, t["id"], rp_before_last=0)
        self.assertEqual((row["div"], row["rp"]), (0, 0), "lost already at 0: down a division")


class AITeamsSameRules(unittest.TestCase):
    """qp11: AI teams climb only by winning series, by the very same rules as player teams."""

    def test_the_series_rules_are_one_function_for_everyone(self):
        t = {"div": 1, "rp": 130}
        P.team_series_won(t, 1)
        self.assertEqual((t["div"], t["rp"]), (2, 30))
        t = {"div": 1, "rp": 60}
        P.team_series_won(t, 1)
        self.assertEqual((t["div"], t["rp"]), (2, 0))
        t = {"div": 3, "rp": 150}
        P.team_series_lost(t)
        self.assertEqual((t["div"], t["rp"]), (3, 100))
        P.team_series_lost(t)
        self.assertEqual((t["div"], t["rp"]), (3, 0))
        P.team_series_lost(t)
        self.assertEqual((t["div"], t["rp"]), (2, 0))
        src = Path(P.__file__).read_text()
        # (qp12: and the series a club's AI members finish in their spare time: club_simulate)
        self.assertEqual(src.count("team_series_won("), 4, "the definition, a player team's series, the AI rounds and the club's AI members")
        self.assertEqual(src.count("team_series_lost("), 4)

    def test_an_ai_teams_game_never_moves_its_division(self):
        tmp = tempfile.TemporaryDirectory()
        svc = server_app.Service(Path(tmp.name) / "a.sqlite3", dev_accounts=False)
        try:
            with svc.db.transaction() as c:
                P.ensure_ai_teams(c, 777, 1, 0)
                a = P._team_row(c.execute("SELECT * FROM pa_teams WHERE ai=1 ORDER BY id LIMIT 1").fetchone())
                a["rp"], div = 95, a["div"]
                P.save_team(c, a)
                svc.proam.ai_result(c, a["id"], True, 0)
                b = P.load_team(c, a["id"])
                self.assertEqual((b["div"], b["rp"]), (div, 110), "a win past 100: banked, no promotion")
                b["rp"] = 0
                P.save_team(c, b)
                svc.proam.ai_result(c, a["id"], False, 0)
                b = P.load_team(c, a["id"])
                self.assertEqual((b["div"], b["rp"]), (div, 0), "a loss at 0: no demotion from one game")
        finally:
            svc.close()
            tmp.cleanup()


# (only this file's tests here: the Pro-Am API suite's own run in tests.test_v0488_proam)
for _k in [k for k in dir(base.ProAmApi) if k.startswith("test_")]:
    setattr(TeamRP, _k, None)

if __name__ == "__main__":
    unittest.main()
