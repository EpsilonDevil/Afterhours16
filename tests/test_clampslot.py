"""v0.4.8.5 qp6 The Clamp (the Lockdown Icon badge), server side: the Icon's own Steal Package (steal_the_clamp) in the new
optional "steal" equip slot, like the Open Arms Rebound Package: the build that holds The Clamp alone can wear it (anyone
else is told why), it comes with the badge (put on at the unlock, and once on the next profile load for a build that
already held it; taking it off sticks) and it is never sold.

Run from the project root:  python3 -m unittest tests.test_clampslot -v
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

PKG = "steal_the_clamp"
STYLES = ["vise", "hip_rip", "dig", "slap_down", "swipe_spin", "double_tap", "lane_dive", "tip_self", "pick_go", "chest_rip"]
WHY = "Requires The Clamp Icon badge: only a Lockdown who has unlocked it can equip this."


class ClampCatalogTests(unittest.TestCase):
    def test_the_steal_package_item(self):
        it = server_app.CATALOG[PKG]
        self.assertEqual((it["slot"], it["category"], it["name"]), ("steal", "animation", "Steal Package: The Clamp"))
        self.assertEqual((it["exclusive"], it["icon"], it["secret"], it["price"]), ("icon", "the_clamp", True, 0))
        self.assertIs(it["original_2k_asset"], False)
        self.assertEqual((it["min_overall"], it["rep_required"], it["min_attr"]), (0, 0, {}))
        self.assertEqual(it["styles"], STYLES)
        self.assertEqual(it["signature"], STYLES[0])
        # its own flag, not v0485's (that one's profile catch-up only fills an empty slot, once, for every v0485 Icon item)
        self.assertIs(it.get("v0485qp6"), True)
        self.assertNotIn("v0485", it)
        for name in ("The Vise", "Hip Rip", "Dig", "Slap-Down", "Swipe & Spin", "Double Tap", "Lane Dive", "Tip to Himself", "Pick & Go", "Chest-Up Strip"):
            self.assertIn(name, it["description"])
        self.assertIn("The Clamp Icon badge", it["description"])
        self.assertIn("cannot be bought", it["description"])
        # the only item in the slot, and the only Clamp item
        self.assertEqual([i["id"] for i in server_app.CATALOG.values() if i.get("slot") == "steal"], [PKG])
        self.assertEqual([i["id"] for i in server_app.CATALOG.values() if i.get("icon") == "the_clamp"], [PKG])
        self.assertEqual(builds.ICON_FOR_ARCH["lockdown"], "the_clamp")
        self.assertIn("steal animations", progression.ICON_BADGES["the_clamp"]["desc"])
        # put on once for a build that already held the badge, with a flag of its own
        self.assertEqual(server_app.ICON_EQUIP_ONCE[PKG], "icon_pkg_v0485qp6_clamp")
        self.assertEqual(len(set(server_app.ICON_EQUIP_ONCE.values())), len(server_app.ICON_EQUIP_ONCE))

    def test_the_steal_slot(self):
        self.assertIn("steal", builds.EQUIP_SLOTS)
        self.assertEqual(builds.EQUIP_SLOTS.index("steal"), builds.EQUIP_SLOTS.index("rebound") + 1, "right after the Rebounds")
        self.assertNotIn("steal", builds.DEFAULT_EQUIPMENT, "empty unless the holder puts the package on")
        self.assertIn("steal", builds.OPTIONAL_SLOTS)
        # never a starter item, never on the wheel or in the store's free pile
        self.assertNotIn(PKG, [i for i in server_app.CATALOG if server_app.CATALOG[i]["price"] == 0 and not server_app.CATALOG[i].get("exclusive")])
        # a new build starts with it empty
        self.assertNotIn("steal", builds.normalize({"name": "X", "position": "SG", "archetype": "lockdown", "height": 76, "weight": 195, "wingspan": 79})["equipment"])

    def test_eligibility_reads_well(self):
        it = server_app.CATALOG[PKG]
        base = {"attributes": {}, "position": "SG"}
        for icon in (None, "open_arms", "big_brother", "sharp_eye", "sexy_red"):
            self.assertEqual(server_app.Service.eligible(None, {**base, "icon_badge": icon}, it), WHY)
        self.assertIsNone(server_app.Service.eligible(server_app.Service, {**base, "icon_badge": "the_clamp", "height": 76, "progression": {"rep": 0}}, it))


class ClampSlotApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "api.sqlite3")
        cls.service.bug_root = Path(cls.tmp.name)
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    def setUp(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, body=None, expect=200):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=20) as r:
                status, payload = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, payload = e.code, json.loads(e.read() or b"null")
        self.assertEqual(status, expect, f"{path}: {payload}")
        return payload

    @staticmethod
    def key():
        return uuid.uuid4().hex

    def register(self):
        return self.call("/api/register", {"username": "cl_" + uuid.uuid4().hex[:8], "password": "longpassword1"})

    def make(self, name, pos, arch, height):
        build = {"name": name, "position": pos, "archetype": arch, "height": height, "weight": 240 if height >= 80 else 195, "wingspan": height + 3}
        return self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]

    def set_icon(self, cid, icon):
        with self.service.db.transaction() as c:
            char = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            char["icon_badge"] = icon
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(char), cid))

    def equip(self, cid, item_id, expect=200):
        return self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "steal", "item_id": item_id}, expect=expect)

    def test_a_lockdown_with_the_clamp_gets_it_on_profile_load_put_on_once_and_can_take_it_off(self):
        prof = self.register()
        self.assertNotIn(PKG, prof["inventory"])
        cid = self.make("Lock", "SG", "lockdown", 76)
        # can't buy it, and can't wear it before the badge
        err = self.call("/api/store/purchase", {"key": self.key(), "item_id": PKG, "character_id": cid}, expect=400)
        self.assertIn("Icon badge exclusive", err["error"])
        self.assertEqual(self.equip(cid, PKG, expect=400)["error"], WHY)
        # he already held The Clamp (from before the package existed): the next profile load brings the package and puts
        # it on once
        self.set_icon(cid, "the_clamp")
        prof = self.call("/api/me")
        self.assertIn(PKG, prof["inventory"])
        ch = next(x for x in prof["characters"] if x["id"] == cid)
        self.assertEqual(ch["icon_badge"], "the_clamp")
        self.assertEqual(ch["equipment"].get("steal"), PKG, "put on once")
        # he can take it off (back to the badge's basic Vise) and it stays off; and put it back on
        ch = self.equip(cid, None)["character"]
        self.assertNotIn("steal", ch["equipment"])
        for _ in range(2):
            ch = next(x for x in self.call("/api/me")["characters"] if x["id"] == cid)
            self.assertNotIn("steal", ch["equipment"], "not put back on by the next profile load")
        self.assertEqual(self.equip(cid, PKG)["character"]["equipment"]["steal"], PKG)
        # the slot takes nothing else
        self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "steal", "item_id": "block_basic"}, expect=400)
        self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "steal", "item_id": "reb_openarms"}, expect=400)
        # still never sold: owned, a purchase is a no-op that costs nothing; the config lists it as an Icon secret
        bal = self.call("/api/me")["balance"]
        out = self.call("/api/store/purchase", {"key": self.key(), "item_id": PKG, "character_id": cid})
        self.assertEqual((out["already_owned"], out["cost"], out["balance"]), (True, 0, bal))
        it = next(i for i in self.call("/api/config")["catalog"] if i["id"] == PKG)
        self.assertTrue(it["secret"])
        self.assertEqual(it["exclusive"], "icon")

    def test_nobody_else_can_equip_it(self):
        self.register()
        holder = self.make("Lock", "SG", "lockdown", 76)
        self.set_icon(holder, "the_clamp")
        self.call("/api/me")  # (the account owns it now)
        # another Lockdown of the same account without the badge, another archetype, and another Icon's holder: refused,
        # and told why
        lock = self.make("Lock2", "SF", "lockdown", 78)
        plain = self.make("Wing", "SF", "two_way", 79)
        arms = self.make("Stretch", "PF", "stretch_big", 83)
        self.set_icon(arms, "open_arms")
        for cid in (lock, plain, arms):
            self.assertEqual(self.equip(cid, PKG, expect=400)["error"], WHY)
        # and the profile load never puts it on them
        for ch in self.call("/api/me")["characters"]:
            if ch["id"] != holder:
                self.assertNotIn("steal", ch["equipment"], ch["name"])
        # a build of another account hears the same
        self.register()
        other = self.make("Other", "SG", "lockdown", 76)
        self.assertEqual(self.equip(other, PKG, expect=400)["error"], WHY)

    def test_the_unlock_grants_and_equips_it_and_the_profile_load_leaves_it_alone(self):
        aid = "cl_grant_" + uuid.uuid4().hex[:6]
        with self.service.db.transaction() as c:
            c.execute("INSERT INTO accounts VALUES(?,?,?,?,?)", (aid, aid, "salt", "hash", 0))
            char = {"equipment": {"dunk": "dunk_basic"}}
            self.assertEqual(self.service.grant_icon_items(c, aid, "the_clamp", char, equip=True), [PKG])
            self.assertEqual(char["equipment"]["steal"], PKG)
            self.assertIs(char.get("icon_pkg_v0485qp6_clamp"), True, "the one-time catch-up is done")
            self.assertEqual(c.execute("SELECT COUNT(*) FROM inventory WHERE account_id=? AND item_id=?", (aid, PKG)).fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
