"""v0.4.8.6 quick patch: Brick Wall's Hall of Fame needs 45% fewer successful screens (315 -> 173) and Posterizer's
Hall of Fame 30% fewer dunks (180 -> 126), rounded half up; Bronze, Silver and Gold as they were. Progress already made
counts: a badge whose progress meets the new mark moves up as the profile loads (progression.sync_badges), within the
build's badge caps and Hall of Fame slots. The client reads the tiers from the server (/api/config badges).

Run from the project root:  python3 -m unittest tests.test_v0486_badges -v
"""
import unittest

from server import builds, progression

BEFORE = {"brick_wall": (18, 63, 154, 315), "posterizer": (8, 30, 80, 180)}
CUT = {"brick_wall": 0.55, "posterizer": 0.7}


def jsround(x):
    return int(x + 0.5)


def char_for(arch, height, badges):
    pos = "C" if height >= 82 else "PF" if height >= 80 else "SF" if height >= 78 else "PG"
    b = builds.spec({"position": pos, "archetype": arch, "height": height, "weight": 250 if height >= 80 else 200, "wingspan": height + 3})
    ch = {**b, "id": "c1", "attributes": builds.starting_attributes(b), "badges": badges, "progression": {"games": 10, "wins": 0, "rep": 0},
          "badges_v0485": True}
    builds.hof_init(ch)
    return ch


class V0486Badges(unittest.TestCase):
    def test_hall_of_fame_lower_the_rest_as_it_was(self):
        for bid, old in BEFORE.items():
            new = progression.BADGES[bid]["tiers"]
            self.assertEqual(new, old[:3] + (jsround(old[3] * CUT[bid]),), bid)
            self.assertEqual(list(new), sorted(set(new)), bid)  # (still above Gold)
        self.assertEqual(progression.BADGES["brick_wall"]["tiers"], (18, 63, 154, 173))
        self.assertEqual(progression.BADGES["posterizer"]["tiers"], (8, 30, 80, 126))
        self.assertEqual((progression.BADGES["brick_wall"]["stat"], progression.BADGES["posterizer"]["stat"]), ("screens", "dunks"))
        # nothing else moved
        self.assertEqual(progression.BADGES["dimer"]["tiers"], (9, 28, 70, 147))
        self.assertEqual(progression.BADGES["chasedown"]["tiers"], (8, 25, 60, 125))

    def test_progress_already_made_reaches_hall_of_fame_on_load(self):
        for bid, arch, h, prog in (("brick_wall", "glass_cleaner", 84, 180), ("posterizer", "slasher", 79, 130)):
            ch = char_for(arch, h, {bid: {"progress": prog, "tier": 3}})
            cap = builds.badge_caps(ch)[bid]
            progression.sync_badges(ch)
            self.assertEqual(ch["badges"][bid]["tier"], min(4, cap), (bid, cap))
            # short of the new mark it stays at Gold
            ch = char_for(arch, h, {bid: {"progress": progression.BADGES[bid]["tiers"][3] - 1, "tier": 3}})
            progression.sync_badges(ch)
            self.assertEqual(ch["badges"][bid]["tier"], 3, bid)


if __name__ == "__main__":
    unittest.main()
