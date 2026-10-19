"""v0.4.8.7: the Favelas take over from the Monster Mash at 2026-10-20 00:00 UTC (8 PM ET Oct 19), then the park
shuffle plays all five event parks, every park once per round, never the same park twice in a row."""
import unittest

from server import cup

HANDOVER, SHUFFLE = 1792454400, 1792627200
PARKS = {"kingtut", "jungle", "beat", "monster", "favela"}


class ParkShuffle(unittest.TestCase):
    def test_the_favelas_take_over_from_the_mash_on_time(self):
        self.assertEqual(cup.active_event(HANDOVER - 1)["id"], "monster")
        self.assertEqual(cup.active_event(HANDOVER)["id"], "favela")
        self.assertEqual(cup.active_event(SHUFFLE - 1)["id"], "favela")
        self.assertEqual(cup.window_bounds(cup.window_at(HANDOVER)), (HANDOVER, SHUFFLE))
        self.assertEqual(cup.event_for_window(cup.window_at(HANDOVER))["id"], "favela")
        self.assertEqual(cup.event_for_window(cup.window_at(HANDOVER) - 1)["id"], "monster")

    def test_every_park_plays_once_per_round_never_twice_in_a_row(self):
        seq = ["favela"] + [cup.active_event(SHUFFLE + k * cup.WINDOW + 1)["id"] for k in range(199)]
        for i in range(0, 200, 5):
            self.assertEqual(set(seq[i:i + 5]), PARKS, (i, seq[i:i + 5]))
        for a, b in zip(seq, seq[1:]):
            self.assertNotEqual(a, b)
        # the first round finishes the Favelas' round: the other four, then a fresh round
        self.assertNotIn("favela", seq[1:5])

    def test_each_window_is_one_park_and_the_order_is_fixed(self):
        for k in range(12):
            a = SHUFFLE + k * cup.WINDOW
            self.assertEqual(cup.active_event(a + 1)["id"], cup.active_event(a + cup.WINDOW - 1)["id"])
            self.assertEqual(cup.event_for_window(cup.window_at(a))["id"], cup.active_event(a + 1)["id"])
        self.assertEqual(cup.shuffle_bag(cup.SCHEDULE[-1], 3), cup.shuffle_bag(cup.SCHEDULE[-1], 3))

    def test_the_client_gets_plain_windows(self):
        rows = cup.public_schedule(now=HANDOVER - 3600)
        favela = [r for r in rows if r["from"] == HANDOVER]
        self.assertEqual(favela, [{"event": "favela", "venue": "favela", "from": HANDOVER, "until": SHUFFLE}])
        ahead = [r for r in rows if (r["from"] or 0) >= SHUFFLE]
        self.assertGreaterEqual(len(ahead), 25)
        for a, b in zip(ahead, ahead[1:]):
            self.assertEqual(a["until"], b["from"])
            self.assertNotEqual(a["event"], b["event"])
        for r in ahead:
            self.assertEqual(r["event"], cup.active_event(r["from"] + 1)["id"])
        # a month later it still reaches well ahead
        later = cup.public_schedule(now=SHUFFLE + 30 * 86400)
        self.assertGreater(max(r["until"] for r in later if r["until"]), SHUFFLE + 60 * 86400)


if __name__ == "__main__":
    unittest.main()
