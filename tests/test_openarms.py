"""v0.4.8.5 Open Arms (the Stretch Big Icon badge), server side: the Rebound Package catalog item, the new "rebound" equip
slot, the build that holds Open Arms alone can wear it (anyone else is told why), it comes with the badge (at the unlock,
and once on the next profile load for a build that already held it) and it is never sold.

Run from the project root:  python3 -m unittest tests.test_openarms -v
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

PKG = "reb_openarms"
SNAGS = ["chin_check", "cuff_holster", "pterodactyl", "rip_360", "tomahawk_yank", "hammer_down"]


class OpenArmsCatalogTests(unittest.TestCase):
    def test_the_rebound_package_item(self):
        it = server_app.CATALOG[PKG]
        self.assertEqual(it["slot"], "rebound")
        self.assertEqual(it["category"], "animation")
        self.assertEqual((it["exclusive"], it["icon"], it["secret"], it["price"]), ("icon", "open_arms", True, 0))
        self.assertIs(it["original_2k_asset"], False)
        self.assertEqual((it["min_overall"], it["rep_required"], it["min_attr"]), (0, 0, {}))
        self.assertEqual(it["styles"], SNAGS)
        self.assertEqual(it["signature"], SNAGS[0])
        self.assertTrue(it.get("v0485"))
        self.assertIn("Open Arms Icon badge", it["description"])
        # the only item in the slot, and the only Open Arms item
        self.assertEqual([i["id"] for i in server_app.CATALOG.values() if i.get("slot") == "rebound"], [PKG])
        self.assertEqual([i["id"] for i in server_app.CATALOG.values() if i.get("icon") == "open_arms"], [PKG])
        # Open Arms belongs to the Stretch Big, and says what it unlocks
        self.assertEqual(builds.ICON_FOR_ARCH["stretch_big"], "open_arms")
        self.assertIn("rebound snags", progression.ICON_BADGES["open_arms"]["desc"])

    def test_the_rebound_slot(self):
        self.assertIn("rebound", builds.EQUIP_SLOTS)
        self.assertNotIn("rebound", builds.DEFAULT_EQUIPMENT, "empty unless the holder puts the package on")
        self.assertIn("rebound", builds.OPTIONAL_SLOTS)
        # never a starter item, never on the wheel or in the store's free pile
        self.assertNotIn(PKG, [i for i in server_app.CATALOG if server_app.CATALOG[i]["price"] == 0 and not server_app.CATALOG[i].get("exclusive")])

    def test_eligibility_reads_well(self):
        it = server_app.CATALOG[PKG]
        base = {"attributes": {}, "position": "C"}
        for icon in (None, "big_brother", "sharp_eye"):
            why = server_app.Service.eligible(None, {**base, "icon_badge": icon}, it)
            self.assertEqual(why, "Requires the Open Arms Icon badge: only a Stretch Big who has unlocked it can equip this.")
        self.assertIsNone(server_app.Service.eligible(server_app.Service, {**base, "icon_badge": "open_arms", "attributes": {"three_point": 60}, "progression": {"rep": 0}}, it))


class OpenArmsApiTests(unittest.TestCase):
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
        return self.call("/api/register", {"username": "oa_" + uuid.uuid4().hex[:8], "password": "longpassword1"})

    def make(self, name, pos, arch, height):
        build = {"name": name, "position": pos, "archetype": arch, "height": height, "weight": 240 if height >= 80 else 195, "wingspan": height + 3}
        return self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]

    def set_icon(self, cid, icon):
        with self.service.db.transaction() as c:
            char = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            char["icon_badge"] = icon
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(char), cid))

    def equip(self, cid, item_id, expect=200):
        return self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "rebound", "item_id": item_id}, expect=expect)

    def test_a_stretch_big_with_open_arms_gets_it_on_profile_load_and_can_wear_it(self):
        prof = self.register()
        self.assertNotIn(PKG, prof["inventory"])
        cid = self.make("Stretch", "C", "stretch_big", 83)
        # can't buy it, and can't wear it before the badge
        self.call("/api/store/purchase", {"key": self.key(), "item_id": PKG, "character_id": cid}, expect=400)
        err = self.equip(cid, PKG, expect=400)
        self.assertIn("Open Arms Icon badge", err["error"])
        # he earns Open Arms (as the 7th Hall of Fame badge would): the next profile load brings the package and puts it on once
        self.set_icon(cid, "open_arms")
        prof = self.call("/api/me")
        self.assertIn(PKG, prof["inventory"])
        ch = next(x for x in prof["characters"] if x["id"] == cid)
        self.assertEqual(ch["icon_badge"], "open_arms")
        self.assertEqual(ch["equipment"].get("rebound"), PKG, "put on once")
        # he can take it off (back to the badge's basic snag) and it stays off; and put it back on
        ch = self.equip(cid, None)["character"]
        self.assertNotIn("rebound", ch["equipment"])
        ch = next(x for x in self.call("/api/me")["characters"] if x["id"] == cid)
        self.assertNotIn("rebound", ch["equipment"], "not put back on by the next profile load")
        self.assertEqual(self.equip(cid, PKG)["character"]["equipment"]["rebound"], PKG)
        # the slot takes nothing else
        self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "rebound", "item_id": "block_basic"}, expect=400)

    def test_nobody_else_can_equip_it(self):
        self.register()
        holder = self.make("Stretch", "C", "stretch_big", 83)
        self.set_icon(holder, "open_arms")
        self.call("/api/me")  # (the account owns it now)
        # another build of the same account without the badge, and one with a different Icon badge: refused, and told why
        plain = self.make("Wing", "SF", "two_way", 79)
        bigbro = self.make("Glass", "C", "glass_cleaner", 84)
        self.set_icon(bigbro, "big_brother")
        for cid in (plain, bigbro):
            err = self.equip(cid, PKG, expect=400)
            self.assertEqual(err["error"], "Requires the Open Arms Icon badge: only a Stretch Big who has unlocked it can equip this.")
        # an account that doesn't own it at all hears the same thing first
        self.register()
        other = self.make("Other", "PF", "stretch_big", 81)
        self.assertEqual(self.equip(other, PKG, expect=400)["error"], "Requires the Open Arms Icon badge: only a Stretch Big who has unlocked it can equip this.")

    def test_the_unlock_grants_and_equips_it(self):
        aid = "oa_grant_" + uuid.uuid4().hex[:6]
        with self.service.db.transaction() as c:
            c.execute("INSERT INTO accounts VALUES(?,?,?,?,?)", (aid, aid, "salt", "hash", 0))
            char = {"equipment": {"dunk": "dunk_basic"}}
            self.assertEqual(self.service.grant_icon_items(c, aid, "open_arms", char, equip=True), [PKG])
            self.assertEqual(char["equipment"]["rebound"], PKG)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM inventory WHERE account_id=? AND item_id=?", (aid, PKG)).fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
