"""v0.4.8.7: no Hall of Fame limit. The 7 Hall of Fame badges are what the Icon badge needs, not a cap: every badge a
build can take to Hall of Fame can get there (ICON status needs every badge at its cap), and a build already past a
badge's requirements gets it the next time it's loaded or plays."""
import unittest

from server import builds, progression
from tests.test_v0485 import char_for

# (v0.4.8.7: a 6'2" Sharpshooter; the Lockdown it used to be lost its Hall of Fame shooting badges)
FULL = ("deadeye", "catch_shoot", "corner_specialist", "limitless", "green_machine", "clutch", "pick_pocket")


class HallOfFame(unittest.TestCase):
    def lockdown(self, hfd):
        ch = char_for("sharpshooter", height=72, games=200, badges={**{b: {"progress": 9999, "tier": 4} for b in FULL}, "handles_for_days": hfd})
        ch["badges_v0485"] = True
        return ch

    def test_an_eighth_hall_of_fame_already_earned_is_given(self):
        ch = self.lockdown({"progress": 150, "tier": 3})  # (its progress has been past Hall of Fame all along, held at Gold)
        self.assertEqual((builds.hof_capacity(ch), builds.hof_count(ch)), (8, 7))
        res = progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["handles_for_days"]["tier"], 4)
        self.assertEqual(builds.hof_count(ch), 8)
        self.assertEqual([u["id"] for u in res["upgraded"]], ["handles_for_days"])
        self.assertEqual(progression.sync_badges(ch), {}, "once")

    def test_and_one_earned_in_a_game_past_the_seventh(self):
        ch = self.lockdown({"progress": 0, "tier": 3})
        upgraded, cb, icon = progression._raise_badges(ch, {"handles_for_days": 9999})
        self.assertEqual(ch["badges"]["handles_for_days"]["tier"], 4)
        self.assertEqual(cb, 0, "cap breakers still only come with the first five")

    def test_caps_still_hold_and_the_icon_still_needs_seven(self):
        self.assertEqual(builds.HOF_LIMIT, 7)
        ch = self.lockdown({"progress": 9999, "tier": 3})
        progression.sync_badges(ch)
        for k, b in ch["badges"].items():
            self.assertLessEqual(b["tier"], builds.badge_caps(ch)[k])
        self.assertEqual(builds.icon_need(ch), 7)

    def test_icon_status_needs_every_hall_of_fame(self):
        ch = self.lockdown({"progress": 150, "tier": 3})
        caps = builds.badge_caps(ch)
        for k in builds.BADGE_IDS:
            ch["badges"].setdefault(k, {"progress": 0, "tier": 0})
            if k != "handles_for_days":
                ch["badges"][k]["tier"] = caps[k]
        info = builds.icon_status_info(ch)
        self.assertFalse(info["badges"])
        self.assertEqual(info["badges_left"], 1, "the eighth Hall of Fame is still to do")
        progression.sync_badges(ch)
        self.assertTrue(builds.icon_status_info(ch)["badges"])


if __name__ == "__main__":
    unittest.main()
