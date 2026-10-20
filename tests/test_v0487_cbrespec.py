"""v0.4.8.7: cap breaker respec. Only a build that has reached ICON status can take back its cap breakers and place them
again; the first respec is free, every one after costs 250,000 VC."""
import copy
import unittest

from server import builds
from tests.test_icon_slots import SlotsApi, make_icon


def placed_icon():
    """An ICON whose attributes are at their caps with 25 cap breakers placed on five of them (no Legend floor)."""
    c = {"archetype": "stretch_big", "position": "PF", "height": 83, "weight": 235, "wingspan": 87, "progression": {"prorun_completed": 30},
         "cap_breakers": {"earned": 25, "available": 25, "applied": {}}, "badges": {}}
    c["attributes"] = dict(builds.caps(c))
    for a in sorted(c["attributes"], key=lambda k: c["attributes"][k])[:5]:
        builds.apply_cap_breakers(c, a, 5)
    c["icon_slot"] = True
    return c


class RespecRules(unittest.TestCase):
    def test_takes_every_breaker_back_and_the_attributes_back_to_their_caps(self):
        c = placed_icon()
        before, applied = copy.deepcopy(c["attributes"]), dict(c["cap_breakers"]["applied"])
        self.assertEqual(sum(applied.values()), 25)
        self.assertEqual(builds.cb_respec_info(c), {"eligible": True, "used": 0, "free": True, "cost": 0, "placed": 25})
        self.assertEqual(builds.respec_cap_breakers(c), 0, "the first one is free")
        self.assertEqual(c["cap_breakers"]["applied"], {})
        self.assertEqual(c["cap_breakers"]["available"], 25)
        for a, n in applied.items():
            self.assertEqual(c["attributes"][a], before[a] - n)
        self.assertEqual(c["attributes"], builds.caps(c))
        # placed again somewhere else, the next respec costs 250,000 VC
        builds.apply_cap_breakers(c, sorted(c["attributes"], key=lambda k: -c["attributes"][k])[-1], 3)
        self.assertEqual(builds.cb_respec_info(c)["cost"], builds.CB_RESPEC_VC)
        self.assertEqual(builds.respec_cap_breakers(c), 250000)
        self.assertEqual(c["cap_breakers"]["respecs"], 2)

    def test_only_after_icon_status(self):
        c = placed_icon()
        del c["icon_slot"]
        self.assertFalse(builds.icon_status(c))
        self.assertFalse(builds.cb_respec_info(c)["eligible"])
        with self.assertRaises(builds.Invalid):
            builds.respec_cap_breakers(c)

    def test_nothing_placed_nothing_to_respec(self):
        c = placed_icon()
        builds.respec_cap_breakers(c)
        with self.assertRaises(builds.Invalid):
            builds.respec_cap_breakers(c)


class RespecApi(SlotsApi):
    def test_free_then_250k_then_not_enough_vc(self):
        cid = self.create()[0]["character"]["id"]
        r = self.call(f"/api/characters/{cid}/cbrespec", {"key": self.key()}, expect=400)
        self.patch(cid, make_icon)
        self.patch(cid, lambda ch: ch["cap_breakers"].update({"applied": {"three_point": 5}, "available": 20}))
        bal = self.call("/api/wallet")["balance"]
        r = self.call(f"/api/characters/{cid}/cbrespec", {"key": self.key()})
        self.assertEqual(r["cost"], 0)
        self.assertEqual(r["character"]["cb_respec"]["used"], 1)
        self.assertEqual(self.stored(cid)["cap_breakers"]["available"], 25)
        self.assertEqual(self.call("/api/wallet")["balance"], bal)
        self.patch(cid, lambda ch: ch["cap_breakers"].update({"applied": {"three_point": 5}, "available": 20}))
        self.patch_balance(250000)
        r = self.call(f"/api/characters/{cid}/cbrespec", {"key": self.key()})
        self.assertEqual((r["cost"], r["balance"]), (250000, 0))
        self.patch(cid, lambda ch: ch["cap_breakers"].update({"applied": {"three_point": 5}, "available": 20}))
        r = self.call(f"/api/characters/{cid}/cbrespec", {"key": self.key()}, expect=400)
        self.assertIn("VC", r.get("error", ""))
        self.assertEqual(self.stored(cid)["cap_breakers"]["applied"], {"three_point": 5}, "nothing changes when it can't be paid")

    def patch_balance(self, vc):
        aid = self.call("/api/online")["you"]["id"]
        with self.service.db.transaction() as c:
            c.execute("UPDATE wallets SET balance=? WHERE account_id=?", (vc, aid))


del SlotsApi

if __name__ == "__main__":
    unittest.main()
