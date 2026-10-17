"""v0.4.8.5 quick patch 5, server side: two Icon badges' own items. Sexy Red's Post Move Package (post_sexy_red, slot
"post") and The General's Salute (cel_general_salute, slot "celebration"): catalog entries, never sold, the build
holding that badge alone can wear them (anyone else is told why), they come with the badge (put on at the unlock, and
once on the next profile load for a build that already held it: one flag each, so changing it back sticks).

Run from the project root:  python3 -m unittest tests.test_sexyred_general -v
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

RED = "post_sexy_red"
GEN = "cel_general_salute"
BACKDOWNS = ["red_grind", "red_seal", "red_twostep", "red_peek", "red_feint"]


class CatalogTests(unittest.TestCase):
    def test_the_post_package(self):
        it = server_app.CATALOG[RED]
        self.assertEqual((it["slot"], it["category"], it["body"]), ("post", "animation", "red"))
        self.assertEqual((it["exclusive"], it["icon"], it["secret"], it["price"]), ("icon", "sexy_red", True, 0))
        self.assertIs(it["original_2k_asset"], False)
        self.assertEqual((it["min_overall"], it["rep_required"], it["min_attr"]), (0, 0, {}))
        self.assertEqual(it["backdowns"], BACKDOWNS)
        self.assertEqual(it["emph"], max(i["emph"] for i in server_app.CATALOG.values() if i.get("slot") == "post" and not i.get("icon")))
        self.assertIn("Sexy Red Icon badge", it["description"])
        self.assertEqual([i["id"] for i in server_app.CATALOG.values() if i.get("icon") == "sexy_red"], [RED])
        self.assertEqual(builds.ICON_FOR_ARCH["post_scorer"], "sexy_red")
        self.assertIn("back-down", progression.ICON_BADGES["sexy_red"]["desc"])

    def test_the_salute(self):
        it = server_app.CATALOG[GEN]
        self.assertEqual((it["slot"], it["category"], it["anim"]), ("celebration", "animation", "general"))
        self.assertEqual((it["exclusive"], it["icon"], it["secret"], it["price"]), ("icon", "the_general", True, 0))
        self.assertIs(it["original_2k_asset"], False)
        self.assertEqual((it["min_overall"], it["rep_required"], it["min_attr"]), (0, 0, {}))
        self.assertIn("The General Icon badge", it["description"])
        self.assertEqual([i["id"] for i in server_app.CATALOG.values() if i.get("icon") == "the_general"], [GEN])
        self.assertEqual(builds.ICON_FOR_ARCH["two_way"], "the_general")
        self.assertIn("salute", progression.ICON_BADGES["the_general"]["desc"])
        # the store's own Salute is untouched and still for sale
        self.assertEqual((server_app.CATALOG["celly_salute"]["anim"], server_app.CATALOG["celly_salute"]["price"]), ("salute", 1170))

    def test_never_starters_one_flag_each(self):
        starters = server_app.Handler.starter_items(None)
        self.assertNotIn(RED, starters)
        self.assertNotIn(GEN, starters)
        self.assertEqual(server_app.ICON_EQUIP_ONCE[RED], "icon_pkg_v0485qp5_sr")
        self.assertEqual(server_app.ICON_EQUIP_ONCE[GEN], "icon_pkg_v0485qp5_gen")
        flags = list(server_app.ICON_EQUIP_ONCE.values())
        self.assertEqual(len(flags), len(set(flags)), "one flag per item (other Icons' packages share the table)")

    def test_eligibility_reads_well(self):
        base = {"attributes": {}, "position": "C"}
        for icon in (None, "the_general", "open_arms"):
            why = server_app.Service.eligible(None, {**base, "icon_badge": icon}, server_app.CATALOG[RED])
            self.assertEqual(why, "Requires the Sexy Red Icon badge: only a Post Scorer who has unlocked it can equip this.")
        for icon in (None, "sexy_red", "clamp"):
            why = server_app.Service.eligible(None, {**base, "icon_badge": icon}, server_app.CATALOG[GEN])
            self.assertEqual(why, "Requires The General Icon badge: only a Two-Way who has unlocked it can equip this.")  # (never "the The General")
        ok = {**base, "attributes": {"post_control": 40}, "progression": {"rep": 0}}
        self.assertIsNone(server_app.Service.eligible(server_app.Service, {**ok, "icon_badge": "sexy_red"}, server_app.CATALOG[RED]))
        self.assertIsNone(server_app.Service.eligible(server_app.Service, {**ok, "icon_badge": "the_general"}, server_app.CATALOG[GEN]))


class ApiTests(unittest.TestCase):
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
        return self.call("/api/register", {"username": "sr_" + uuid.uuid4().hex[:8], "password": "longpassword1"})

    def make(self, name, pos, arch, height):
        build = {"name": name, "position": pos, "archetype": arch, "height": height, "weight": 250 if height >= 80 else 200, "wingspan": height + 3}
        return self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]

    def set_icon(self, cid, icon):
        with self.service.db.transaction() as c:
            char = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            char["icon_badge"] = icon
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(char), cid))

    def raw(self, cid):
        with self.service.db.transaction() as c:
            return json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])

    def equip(self, cid, slot, item_id, expect=200):
        return self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": slot, "item_id": item_id}, expect=expect)

    def me(self, cid):
        prof = self.call("/api/me")
        return prof, next(x for x in prof["characters"] if x["id"] == cid)

    def test_a_post_scorer_who_already_held_sexy_red_gets_it_put_on_once(self):
        prof = self.register()
        self.assertNotIn(RED, prof["inventory"])
        cid = self.make("Red", "C", "post_scorer", 82)
        # never sold, and not his before the badge
        self.call("/api/store/purchase", {"key": self.key(), "item_id": RED, "character_id": cid}, expect=400)
        self.assertEqual(self.equip(cid, "post", RED, expect=400)["error"], "Requires the Sexy Red Icon badge: only a Post Scorer who has unlocked it can equip this.")
        # he wears a store package; then he turns out to hold Sexy Red: the next profile load puts the Icon's own on, over it
        self.call("/api/store/purchase", {"key": self.key(), "item_id": "post_bully", "character_id": cid})
        self.equip(cid, "post", "post_bully")
        self.set_icon(cid, "sexy_red")
        prof, ch = self.me(cid)
        self.assertIn(RED, prof["inventory"])
        self.assertEqual(ch["equipment"]["post"], RED, "put on once")
        self.assertTrue(self.raw(cid).get("icon_pkg_v0485qp5_sr"))
        self.assertFalse(self.raw(cid).get("icon_pkg_v0485qp5_gen"), "the other Icon's flag is its own")
        # he changes back to the Bully Ball: it stays changed; and he can put the Icon's back on
        self.assertEqual(self.equip(cid, "post", "post_bully")["character"]["equipment"]["post"], "post_bully")
        for _ in range(2):
            self.assertEqual(self.me(cid)[1]["equipment"]["post"], "post_bully", "not put back on by later profile loads")
        self.assertEqual(self.equip(cid, "post", RED)["character"]["equipment"]["post"], RED)
        # the slot takes nothing from another slot
        self.equip(cid, "post", GEN, expect=400)

    def test_a_two_way_who_already_held_the_general_gets_the_salute_put_on_once(self):
        self.register()
        cid = self.make("Gen", "SF", "two_way", 79)
        self.call("/api/store/purchase", {"key": self.key(), "item_id": GEN, "character_id": cid}, expect=400)
        err = self.equip(cid, "celebration", GEN, expect=400)["error"]
        self.assertIn("The General Icon badge", err)
        self.call("/api/store/purchase", {"key": self.key(), "item_id": "celly_flex", "character_id": cid})
        self.equip(cid, "celebration", "celly_flex")
        self.set_icon(cid, "the_general")
        prof, ch = self.me(cid)
        self.assertIn(GEN, prof["inventory"])
        self.assertEqual(ch["equipment"]["celebration"], GEN, "put on once, over the Flex")
        self.assertTrue(self.raw(cid).get("icon_pkg_v0485qp5_gen"))
        # back to the Flex, or nothing at all: it stays that way
        self.equip(cid, "celebration", "celly_flex")
        self.assertEqual(self.me(cid)[1]["equipment"]["celebration"], "celly_flex")
        self.equip(cid, "celebration", None)
        self.assertNotIn("celebration", self.me(cid)[1]["equipment"])
        self.assertEqual(self.equip(cid, "celebration", GEN)["character"]["equipment"]["celebration"], GEN)

    def test_nobody_else_can_equip_them(self):
        self.register()
        red = self.make("Red", "C", "post_scorer", 82)
        gen = self.make("Gen", "SF", "two_way", 79)
        self.set_icon(red, "sexy_red")
        self.set_icon(gen, "the_general")
        self.call("/api/me")  # (the account owns both now)
        plain = self.make("Plain", "PF", "post_scorer", 81)
        self.assertEqual(self.equip(plain, "post", RED, expect=400)["error"], "Requires the Sexy Red Icon badge: only a Post Scorer who has unlocked it can equip this.")
        self.assertEqual(self.equip(gen, "post", RED, expect=400)["error"], "Requires the Sexy Red Icon badge: only a Post Scorer who has unlocked it can equip this.")
        for cid in (plain, red):
            self.assertIn("The General Icon badge", self.equip(cid, "celebration", GEN, expect=400)["error"])
        # an account that doesn't own them hears the same first
        self.register()
        other = self.make("Other", "C", "post_scorer", 83)
        self.assertEqual(self.equip(other, "post", RED, expect=400)["error"], "Requires the Sexy Red Icon badge: only a Post Scorer who has unlocked it can equip this.")

    def test_the_unlock_grants_and_equips_them_and_the_catch_up_leaves_them_be(self):
        aid = "sr_grant_" + uuid.uuid4().hex[:6]
        with self.service.db.transaction() as c:
            c.execute("INSERT INTO accounts VALUES(?,?,?,?,?)", (aid, aid, "salt", "hash", 0))
            for icon, item, slot, flag in (("sexy_red", RED, "post", "icon_pkg_v0485qp5_sr"), ("the_general", GEN, "celebration", "icon_pkg_v0485qp5_gen")):
                char = {"equipment": {"post": "post_basic", "celebration": "celly_flex"}}
                self.assertEqual(self.service.grant_icon_items(c, aid, icon, char, equip=True), [item])
                self.assertEqual(char["equipment"][slot], item)
                self.assertTrue(char.get(flag), "the one-time catch-up won't run again over a later change")
                self.assertEqual(c.execute("SELECT COUNT(*) FROM inventory WHERE account_id=? AND item_id=?", (aid, item)).fetchone()[0], 1)
            # without equip (a profile load's top-up): into the locker only
            char = {"equipment": {"post": "post_basic"}}
            self.service.grant_icon_items(c, aid, "sexy_red", char)
            self.assertEqual(char["equipment"]["post"], "post_basic")
            self.assertFalse(char.get("icon_pkg_v0485qp5_sr"))

    def test_an_unlock_then_a_change_survives_the_next_profile_load(self):
        self.register()
        cid = self.make("Red", "C", "post_scorer", 82)
        # the match that unlocks it: granted and put on, flag set with it
        with self.service.db.transaction() as c:
            char = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            aid = c.execute("SELECT account_id FROM characters WHERE id=?", (cid,)).fetchone()[0]
            char["icon_badge"] = "sexy_red"
            self.service.grant_icon_items(c, aid, "sexy_red", char, equip=True)
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(char), cid))
        self.equip(cid, "post", "post_basic")
        self.assertEqual(self.me(cid)[1]["equipment"]["post"], "post_basic")


if __name__ == "__main__":
    unittest.main()
