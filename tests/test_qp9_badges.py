"""v0.4.8.5 quick patch 9: Dimer and Brick Wall need 30% less for every tier (rounded half up). Progress a build has
already made counts: a badge whose progress meets a lowered requirement moves up as the profile loads
(progression.sync_badges), not a game later. The client reads the tiers from the server (/api/config badges).

Run from the project root:  python3 -m unittest tests.test_qp9_badges -v
"""
import unittest

from server import builds, progression

BEFORE = {"dimer": (13, 40, 100, 210), "brick_wall": (25, 90, 220, 450)}


def jsround(x):
    return int(x + 0.5)


def char_for(arch, height, badges):
    pos = "C" if height >= 82 else "PF" if height >= 80 else "PG"
    b = builds.spec({"position": pos, "archetype": arch, "height": height, "weight": 250 if height >= 80 else 190, "wingspan": height + 2})
    ch = {**b, "id": "c1", "attributes": builds.starting_attributes(b), "badges": badges, "progression": {"games": 10, "wins": 0, "rep": 0},
          "badges_v0485": True}
    builds.hof_init(ch)
    return ch


class Qp9Badges(unittest.TestCase):
    def test_every_tier_30_percent_lower(self):
        for bid, old in BEFORE.items():
            new = progression.BADGES[bid]["tiers"]
            self.assertEqual(new, tuple(jsround(t * 0.7) for t in old), bid)
            self.assertEqual(list(new), sorted(set(new)), bid)
        self.assertEqual(progression.BADGES["dimer"]["tiers"], (9, 28, 70, 147))
        self.assertEqual(progression.BADGES["brick_wall"]["tiers"], (18, 63, 154, 315))
        # nothing else moved
        self.assertEqual(progression.BADGES["chasedown"]["tiers"], (8, 25, 60, 125))
        self.assertEqual(progression.BADGES["rebound_chaser"]["tiers"], (16, 56, 140, 280))

    def test_progress_already_made_catches_up_on_load(self):
        # Dimer 75 assists at Silver: Gold now needs 70. Brick Wall 160 screens at Silver: Gold now needs 154
        ch = char_for("playmaker", 74, {"dimer": {"progress": 75, "tier": 2}})
        out = progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["dimer"]["tier"], min(3, builds.badge_caps(ch)["dimer"]))
        self.assertTrue(any(u.get("id") == "dimer" or u.get("badge") == "dimer" or "dimer" in str(u) for u in out.get("upgraded", [])))
        ch = char_for("glass_cleaner", 84, {"brick_wall": {"progress": 160, "tier": 2}})
        progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["brick_wall"]["tier"], min(3, builds.badge_caps(ch)["brick_wall"]))
        # and short of the new mark it stays put
        ch = char_for("playmaker", 74, {"dimer": {"progress": 60, "tier": 2}})
        progression.sync_badges(ch)
        self.assertEqual(ch["badges"]["dimer"]["tier"], 2)


if __name__ == "__main__":
    unittest.main()
