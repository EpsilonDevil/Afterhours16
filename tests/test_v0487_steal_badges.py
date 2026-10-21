"""v0.4.8.7 quick patch 6: Pick Pocket and Interceptor need 30% fewer steals at every tier (rounded half up, as the earlier
badge cuts were). A build whose steals already meet a lowered mark moves up as its profile loads (sync_badges)."""
import unittest

from server import builds, progression

OLD = {"pick_pocket": (15, 50, 120, 250), "interceptor": (20, 60, 150, 300)}


class StealBadges(unittest.TestCase):
    def test_thirty_percent_fewer_steals(self):
        for bid, old in OLD.items():
            self.assertEqual(progression.BADGES[bid]["tiers"], tuple(int(t * 0.7 + 0.5) for t in old), bid)
        self.assertEqual(progression.BADGES["pick_pocket"]["tiers"], (11, 35, 84, 175))
        self.assertEqual(progression.BADGES["interceptor"]["tiers"], (14, 42, 105, 210))

    def test_progress_already_made_counts_on_load(self):
        b = builds.spec({"position": "SG", "archetype": "lockdown", "height": 77, "weight": 200, "wingspan": 80})
        ch = {**b, "id": "c1", "attributes": builds.starting_attributes(b), "progression": {"games": 50, "wins": 0, "rep": 0},
              "badges": {"pick_pocket": {"progress": 90, "tier": 2}, "interceptor": {"progress": 45, "tier": 1}}, "badges_v0485": True}
        builds.hof_init(ch)
        out = progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["pick_pocket"]["tier"], 3, "90 steals: Gold now (84)")
        self.assertEqual(ch["badges"]["interceptor"]["tier"], 2, "45: Silver now (42)")
        self.assertLessEqual({"interceptor", "pick_pocket"}, {u["id"] for u in out["upgraded"]})  # (Handles for Days counts the 50 games too)


if __name__ == "__main__":
    unittest.main()
