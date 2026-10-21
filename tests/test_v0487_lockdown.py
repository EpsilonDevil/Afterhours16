"""v0.4.8.7: the Lockdown's Hall of Fame badges are defensive. Its shooting badges stop at Silver; Rebound Chaser reaches
Hall of Fame, and its defensive badges get past the height limits (Chasedown and Brick Wall at every height, Rim
Protector from 6'3", Pick Pocket at 7'1"+). A Lockdown already above the new caps is lowered to them as the profile
loads (progress kept), and a replacement Hall of Fame badge never pays its cap breakers twice."""
import unittest

from server import builds, progression

SHOOTING = ("deadeye", "catch_shoot", "corner_specialist", "limitless", "green_machine")
DEFENSE = ("pick_pocket", "interceptor", "rim_protector", "chasedown", "brick_wall", "rebound_chaser")


def lockdown(height, **kw):
    return {"archetype": "lockdown", "height": height, "badges": {}, **kw}


class LockdownCaps(unittest.TestCase):
    def test_shooting_silver_at_best_every_height(self):
        for h in range(67, 88):
            caps = builds.badge_caps(lockdown(h))
            for b in SHOOTING:
                self.assertLessEqual(caps[b], 2, (h, b))

    def test_hall_of_fame_badges_are_defensive(self):
        want = {72: 5, 77: 7, 80: 7, 83: 6, 86: 6}
        for h, n in want.items():
            caps = builds.badge_caps(lockdown(h))
            hof = [k for k, v in caps.items() if v >= 4]
            self.assertEqual(len(hof), n, (h, hof))
            self.assertTrue(all(k in DEFENSE or k == "handles_for_days" for k in hof), (h, hof))
            self.assertGreaterEqual(min(builds.CAP_BREAKER_HOF_LIMIT, len(hof)), 5, "every height still earns all 25 cap breakers")
        self.assertEqual(builds.badge_caps(lockdown(72))["chasedown"], 4)
        self.assertEqual(builds.badge_caps(lockdown(72))["brick_wall"], 4)
        self.assertEqual(builds.badge_caps(lockdown(72))["rim_protector"], 2, "a 6'2\" Lockdown still doesn't anchor the paint")
        self.assertEqual(builds.badge_caps(lockdown(77))["rim_protector"], 4)
        self.assertEqual(builds.badge_caps(lockdown(86))["pick_pocket"], 4)

    def test_other_archetypes_unchanged(self):
        self.assertEqual(builds.badge_caps({"archetype": "two_way", "height": 72})["chasedown"], 3)
        self.assertEqual(builds.badge_caps({"archetype": "sharpshooter", "height": 77})["catch_shoot"], 4)


class LockdownExisting(unittest.TestCase):
    def test_lowered_on_load_progress_kept(self):
        ch = lockdown(77)
        hof = progression.BADGES["catch_shoot"]["tiers"][-1]
        ch["badges"] = {"catch_shoot": {"progress": hof + 50, "tier": 4}, "deadeye": {"progress": 0, "tier": 3}, "interceptor": {"progress": 5, "tier": 1}}
        out = progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["catch_shoot"], {"progress": hof + 50, "tier": 2})
        self.assertEqual(ch["badges"]["deadeye"]["tier"], 2)
        self.assertEqual(sorted(b["id"] for b in out["lowered"]), ["catch_shoot", "deadeye"])
        self.assertEqual(progression.sync_badges(ch), {}, "said once")

    def test_no_double_cap_breakers(self):
        # a 6'2" Lockdown had 5 Hall of Fame badges (Catch & Shoot and Corner Specialist among them): 25 earned
        ch = lockdown(72)
        top = lambda b: progression.BADGES[b]["tiers"][-1]
        for b in ("catch_shoot", "corner_specialist", "handles_for_days", "pick_pocket", "interceptor"):
            ch["badges"][b] = {"progress": top(b), "tier": 4}
        ch["cap_breakers"] = {"earned": 25, "available": 25, "applied": {}}
        progression.sync_badges(ch)
        self.assertEqual(builds.hof_count(ch), 3)
        # two defensive badges take their place: no new cap breakers (25 is the most a build earns)
        ch["badges"]["chasedown"] = {"progress": 0, "tier": 3}
        ch["badges"]["brick_wall"] = {"progress": 0, "tier": 3}
        up, cb, _ = progression._raise_badges(ch, {"chasedown": top("chasedown"), "brick_wall": top("brick_wall")})
        self.assertEqual(builds.hof_count(ch), 5)
        self.assertEqual(cb, 0)
        self.assertEqual(ch["cap_breakers"], {"earned": 25, "available": 25, "applied": {}})

    def test_a_new_build_still_earns_its_cap_breakers(self):
        ch = lockdown(77)
        hof_init = builds.hof_init
        hof_init(ch)
        top = lambda b: progression.BADGES[b]["tiers"][-1]
        _, cb, _ = progression._raise_badges(ch, {b: top(b) for b in DEFENSE})
        self.assertEqual(cb, 25)
        self.assertEqual(ch["cap_breakers"]["earned"], 25)


if __name__ == "__main__":
    unittest.main()
