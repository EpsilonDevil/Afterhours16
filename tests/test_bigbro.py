"""v0.4.8.5 Big Brother (the Glass Cleaner Icon badge), server side: the Icon's own Block Package (block_big_brother, slot
"block"): the build that holds Big Brother alone can wear it (anyone else is told why), it comes with the badge (at the
unlock, and put on once on the next profile load for a build that already held it, over the Block Package it wore; it
can change it back) and it is never sold.

Run from the project root:  python3 -m unittest tests.test_bigbro -v
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

PKG = "block_big_brother"
STYLES = ["bb_tomahawk", "bb_volley_spike", "bb_glass_pin", "bb_spin_swat", "bb_chase_cannon", "bb_sledgehammer", "bb_backhand"]
WHY = "Requires the Big Brother Icon badge: only a Glass Cleaner who has unlocked it can equip this."


class BigBrotherCatalogTests(unittest.TestCase):
    def test_the_block_package_item(self):
        it = server_app.CATALOG[PKG]
        self.assertEqual((it["slot"], it["category"]), ("block", "animation"))
        self.assertEqual((it["exclusive"], it["icon"], it["secret"], it["price"]), ("icon", "big_brother", True, 0))
        self.assertIs(it["original_2k_asset"], False)
        self.assertEqual((it["min_overall"], it["rep_required"], it["min_attr"]), (0, 0, {}))
        self.assertEqual(it["styles"], STYLES)
        self.assertEqual(it["signature"], STYLES[0])
        self.assertIn("Big Brother Icon badge", it["description"])
        # the only Big Brother item; a Block Package beside the five tier ones
        self.assertEqual([i["id"] for i in server_app.CATALOG.values() if i.get("icon") == "big_brother"], [PKG])
        self.assertIn(PKG, [i["id"] for i in server_app.CATALOG.values() if i.get("slot") == "block"])
        self.assertEqual(builds.ICON_FOR_ARCH["glass_cleaner"], "big_brother")
        self.assertIn("block animations", progression.ICON_BADGES["big_brother"]["desc"])
        # put on once for a build that already held the badge, with a flag of its own
        self.assertIn(PKG, server_app.ICON_EQUIP_ONCE)
        self.assertEqual(len(set(server_app.ICON_EQUIP_ONCE.values())), len(server_app.ICON_EQUIP_ONCE))

    def test_never_a_starter_item_nor_in_the_free_pile(self):
        self.assertNotIn(PKG, [i for i in server_app.CATALOG if server_app.CATALOG[i]["price"] == 0 and not server_app.CATALOG[i].get("exclusive")])
        self.assertEqual(builds.DEFAULT_EQUIPMENT["block"], "block_basic")

    def test_eligibility_reads_well(self):
        it = server_app.CATALOG[PKG]
        base = {"attributes": {}, "position": "C"}
        for icon in (None, "open_arms", "the_clamp", "sharp_eye"):
            self.assertEqual(server_app.Service.eligible(None, {**base, "icon_badge": icon}, it), WHY)
        self.assertIsNone(server_app.Service.eligible(server_app.Service, {**base, "icon_badge": "big_brother", "height": 84, "progression": {"rep": 0}}, it))


class BigBrotherApiTests(unittest.TestCase):
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
        return self.call("/api/register", {"username": "bb_" + uuid.uuid4().hex[:8], "password": "longpassword1"})

    def make(self, name, pos, arch, height):
        build = {"name": name, "position": pos, "archetype": arch, "height": height, "weight": 250 if height >= 80 else 195, "wingspan": height + 3}
        return self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]

    def set_icon(self, cid, icon, block=None):
        with self.service.db.transaction() as c:
            char = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            char["icon_badge"] = icon
            if block:
                char.setdefault("equipment", {})["block"] = block
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(char), cid))

    def equip(self, cid, item_id, expect=200):
        return self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "block", "item_id": item_id}, expect=expect)

    def test_a_holder_gets_it_on_the_profile_load_put_on_once_and_can_change_it(self):
        prof = self.register()
        self.assertNotIn(PKG, prof["inventory"])
        cid = self.make("Glass", "C", "glass_cleaner", 84)
        # can't buy it, can't wear it before the badge
        err = self.call("/api/store/purchase", {"key": self.key(), "item_id": PKG, "character_id": cid}, expect=400)
        self.assertIn("Icon badge exclusive", err["error"])
        self.assertEqual(self.equip(cid, PKG, expect=400)["error"], WHY)
        # he already held Big Brother (from before the package existed), wearing a Block Package of his own: the next
        # profile load brings the package and puts it on, over that one
        self.set_icon(cid, "big_brother", block="block_basic")
        prof = self.call("/api/me")
        self.assertIn(PKG, prof["inventory"])
        ch = next(x for x in prof["characters"] if x["id"] == cid)
        self.assertEqual(ch["equipment"]["block"], PKG, "put on once")
        # he can change it back, and the next load leaves it that way
        self.assertEqual(self.equip(cid, "block_basic")["character"]["equipment"]["block"], "block_basic")
        ch = next(x for x in self.call("/api/me")["characters"] if x["id"] == cid)
        self.assertEqual(ch["equipment"]["block"], "block_basic", "not put back on by the next profile load")
        self.assertEqual(self.equip(cid, PKG)["character"]["equipment"]["block"], PKG)
        # in his inventory, and shown by the store's listing as an Icon secret (never for sale)
        cfg = self.call("/api/config")
        it = next(i for i in cfg["catalog"] if i["id"] == PKG)
        self.assertTrue(it["secret"])

    def test_nobody_else_can_equip_it(self):
        self.register()
        holder = self.make("Glass", "C", "glass_cleaner", 84)
        self.set_icon(holder, "big_brother")
        self.call("/api/me")  # (the account owns it now)
        plain = self.make("Wing", "SF", "two_way", 79)
        arms = self.make("Stretch", "PF", "stretch_big", 83)
        self.set_icon(arms, "open_arms")
        for cid in (plain, arms):
            self.assertEqual(self.equip(cid, PKG, expect=400)["error"], WHY)
        # a build of another account hears the same
        self.register()
        other = self.make("Other", "C", "glass_cleaner", 84)
        self.assertEqual(self.equip(other, PKG, expect=400)["error"], WHY)

    def test_the_unlock_grants_and_equips_it(self):
        aid = "bb_grant_" + uuid.uuid4().hex[:6]
        with self.service.db.transaction() as c:
            c.execute("INSERT INTO accounts VALUES(?,?,?,?,?)", (aid, aid, "salt", "hash", 0))
            char = {"equipment": {"dunk": "dunk_basic", "block": "block_hammer"}}
            self.assertEqual(self.service.grant_icon_items(c, aid, "big_brother", char, equip=True), [PKG])
            self.assertEqual(char["equipment"]["block"], PKG)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM inventory WHERE account_id=? AND item_id=?", (aid, PKG)).fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
