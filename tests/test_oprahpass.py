"""v0.4.8.7 qp7 Icon items, server side: Oprah (the Playmaker Icon badge) gets its own Pass Package (pass_oprah) in a
new optional "pass" equip slot, like The Clamp's Steal Package and the Open Arms Rebound Package: the build that holds
Oprah alone can wear it (anyone else is told why), it comes with the badge (put on at the unlock, and once on the next
profile load for a build that already held it) and it is never sold. And for every Icon badge's own item (David: "make
sure that applies to all other badges with exclusive animations"): an Icon secret that is never sold, never a free
starter item, and equippable only by the build that has unlocked that Icon badge.

Run from the project root:  python3 -m unittest tests.test_oprahpass -v
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

PKG = "pass_oprah"
STYLES = ["btb", "nolook", "wrap", "btl", "shoulder", "elbow", "spin", "bullet", "overhead"]
WHY = "Requires the Oprah Icon badge: only a Playmaker who has unlocked it can equip this."
ICON_ITEMS = {i["id"]: i for i in server_app.CATALOG.values() if i.get("icon")}


class IconItemCatalogTests(unittest.TestCase):
    def test_the_pass_package_item(self):
        it = server_app.CATALOG[PKG]
        self.assertEqual((it["slot"], it["category"], it["name"]), ("pass", "animation", "Pass Package: Oprah"))
        self.assertEqual((it["exclusive"], it["icon"], it["secret"], it["price"]), ("icon", "oprah", True, 0))
        self.assertIs(it["original_2k_asset"], False)
        self.assertEqual((it["min_overall"], it["rep_required"], it["min_attr"]), (0, 0, {}))
        self.assertEqual(it["styles"], STYLES, "the nine passes of client/js/sim/oprah.js")
        self.assertIs(it.get("v0487qp7"), True)
        self.assertNotIn("v0485", it)
        self.assertNotIn("v048", it)
        for name in ("Behind the Back", "No-Look", "Wraparound", "Between the Legs", "Over the Shoulder", "Elbow Pass", "Spin Dish", "Dribble Bullet", "Behind the Head"):
            self.assertIn(name, it["description"])
        self.assertIn("Oprah Icon badge", it["description"])
        self.assertIn("cannot be bought", it["description"])
        self.assertEqual([i["id"] for i in server_app.CATALOG.values() if i.get("slot") == "pass"], [PKG])
        self.assertEqual([i["id"] for i in ICON_ITEMS.values() if i["icon"] == "oprah"], [PKG])
        self.assertEqual(builds.ICON_FOR_ARCH["playmaker"], "oprah")
        self.assertEqual(server_app.ICON_EQUIP_ONCE[PKG], "icon_pkg_v0487qp7_oprah")
        self.assertEqual(len(set(server_app.ICON_EQUIP_ONCE.values())), len(server_app.ICON_EQUIP_ONCE))

    def test_the_pass_slot(self):
        self.assertIn("pass", builds.EQUIP_SLOTS)
        self.assertEqual(builds.EQUIP_SLOTS[-2:], ("post", "block"), "the post and block slots stay last")
        self.assertNotIn("pass", builds.DEFAULT_EQUIPMENT)
        self.assertIn("pass", builds.OPTIONAL_SLOTS)
        self.assertNotIn("pass", builds.normalize({"name": "X", "position": "PG", "archetype": "playmaker", "height": 74, "weight": 185, "wingspan": 77})["equipment"])

    def test_every_icon_badge_has_its_items_and_every_icon_item_is_its_holders_alone(self):
        # every Icon badge brings at least one item now (Oprah was the last without one)
        self.assertEqual(sorted({i["icon"] for i in ICON_ITEMS.values()}), sorted(progression.ICON_BADGES))
        free = [i for i in server_app.CATALOG if server_app.CATALOG[i]["price"] == 0 and not server_app.CATALOG[i].get("exclusive")]
        for iid, it in ICON_ITEMS.items():
            # an Icon secret (the Hash-Slinging dunk package used to be missing the mark), never sold, never a starter item
            self.assertEqual((it["exclusive"], it.get("secret"), it["price"]), ("icon", True, 0), iid)
            self.assertIn(it["slot"], builds.EQUIP_SLOTS, iid)
            self.assertNotIn(iid, free, iid)
            # only the build that holds that Icon badge may wear it; every other build is told whose it is
            base = {"attributes": {}, "position": "SG", "height": 76, "progression": {"rep": 0}}
            for other in [None, *[b for b in progression.ICON_BADGES if b != it["icon"]]]:
                why = server_app.Service.eligible(None, {**base, "icon_badge": other}, it)
                self.assertTrue(why and why.startswith("Requires") and "Icon badge" in why, f"{iid} on {other}: {why}")
            self.assertIsNone(server_app.Service.eligible(server_app.Service, {**base, "icon_badge": it["icon"], "attributes": {k: 99 for k in builds.ATTRIBUTES}}, it), iid)


class OprahPassApiTests(unittest.TestCase):
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
        return self.call("/api/register", {"username": "op_" + uuid.uuid4().hex[:8], "password": "longpassword1"})

    def make(self, name, pos, arch, height):
        build = {"name": name, "position": pos, "archetype": arch, "height": height, "weight": 240 if height >= 80 else 190, "wingspan": height + 3}
        return self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]

    def set_icon(self, cid, icon):
        with self.service.db.transaction() as c:
            char = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            char["icon_badge"] = icon
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(char), cid))

    def equip(self, cid, item_id, slot="pass", expect=200):
        return self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": slot, "item_id": item_id}, expect=expect)

    def test_a_playmaker_with_oprah_gets_it_on_profile_load_put_on_once(self):
        prof = self.register()
        self.assertNotIn(PKG, prof["inventory"])
        cid = self.make("Dimes", "PG", "playmaker", 74)
        err = self.call("/api/store/purchase", {"key": self.key(), "item_id": PKG, "character_id": cid}, expect=400)
        self.assertIn("Icon badge exclusive", err["error"])
        self.assertEqual(self.equip(cid, PKG, expect=400)["error"], WHY)
        # he already held Oprah (from before the package existed): the next profile load brings it and puts it on once
        self.set_icon(cid, "oprah")
        prof = self.call("/api/me")
        self.assertIn(PKG, prof["inventory"])
        ch = next(x for x in prof["characters"] if x["id"] == cid)
        self.assertEqual(ch["equipment"].get("pass"), PKG, "put on once")
        # the slot takes nothing else
        self.equip(cid, "steal_the_clamp", expect=400)
        self.equip(cid, "dunk_basic", expect=400)
        it = next(i for i in self.call("/api/config")["catalog"] if i["id"] == PKG)
        self.assertTrue(it["secret"])

    def test_the_account_keeps_it_and_no_other_build_can_wear_any_icon_item(self):
        self.register()
        holder = self.make("Dimes", "PG", "playmaker", 74)
        self.set_icon(holder, "oprah")
        self.call("/api/me")
        # a Playmaker of the same account without the badge, another archetype, another Icon's holder
        pm = self.make("Dimes2", "PG", "playmaker", 75)
        wing = self.make("Wing", "SF", "two_way", 79)
        clamp = self.make("Lock", "SG", "lockdown", 76)
        self.set_icon(clamp, "the_clamp")
        prof = self.call("/api/me")
        self.assertIn(PKG, prof["inventory"], "the locker is the account's: it stays")
        self.assertIn("steal_the_clamp", prof["inventory"])
        for cid in (pm, wing, clamp):
            self.assertEqual(self.equip(cid, PKG, expect=400)["error"], WHY)
        for ch in prof["characters"]:
            if ch["id"] != holder:
                self.assertNotIn("pass", ch["equipment"], ch["name"])
        # and the other way round: Oprah's holder can't wear The Clamp's, though the account owns it
        err = self.equip(holder, "steal_the_clamp", slot="steal", expect=400)["error"]
        self.assertIn("The Clamp Icon badge", err)
        # the holder still has his on
        self.assertEqual(next(x for x in self.call("/api/me")["characters"] if x["id"] == holder)["equipment"]["pass"], PKG)

    def test_the_unlock_grants_and_equips_it(self):
        aid = "op_grant_" + uuid.uuid4().hex[:6]
        with self.service.db.transaction() as c:
            c.execute("INSERT INTO accounts VALUES(?,?,?,?,?)", (aid, aid, "salt", "hash", 0))
            char = {"equipment": {"dunk": "dunk_basic"}}
            self.assertEqual(self.service.grant_icon_items(c, aid, "oprah", char, equip=True), [PKG])
            self.assertEqual(char["equipment"]["pass"], PKG)
            self.assertIs(char.get("icon_pkg_v0487qp7_oprah"), True, "the one-time catch-up is done")


if __name__ == "__main__":
    unittest.main()
