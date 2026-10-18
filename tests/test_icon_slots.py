"""v0.4.8.5 quick patch 7: ICON build slots. An account has 4 build slots, and every ICON build on it opens one more, up to
8. The slot is the account's for good: the first time a build is seen as an ICON it's marked (icon_slot) and counts from
then on, even if a later patch takes it out of ICON status for a while. The game says so when a slot opens: on the profile
load, the character action or the game result that did it (build_slot_unlocked).

Run from the project root:  python3 -m unittest tests.test_icon_slots -v
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
from tests.test_icon_status import icon_build

ROOT = Path(__file__).resolve().parents[1]
BUILD = {"name": "Slot Guy", "position": "PF", "archetype": "stretch_big", "height": 83, "weight": 235, "wingspan": 87}
FULL4 = "All 4 build slots are in use. Every ICON build on your account opens one more, up to 8."
FULL8 = "All 8 build slots are in use (the most an account can have)."


def make_icon(ch, ovr99=True):
    """What tests/test_icon_status.py icon_build() builds, put on a saved build (its own size and archetype): every cap
    breaker, every badge at its cap with the Hall of Fame slots full, 99 OVR (ovr99=False: every attribute at 89, 98 OVR,
    one max upgrade short; the Legend floor keeps every cap at 99)."""
    ch["attributes"] = {a: 99 if ovr99 else 89 for a in builds.ATTRIBUTES}
    ch.setdefault("progression", {})["prorun_completed"] = 30
    ch["cap_breakers"] = {"earned": 25, "available": 0, "applied": {}}
    ch["legend"] = {"games": 0, "upgrades": 0, "floor": {a: 99 for a in builds.ATTRIBUTES}}
    caps, hof, ch["badges"] = builds.badge_caps(ch), 0, {}
    for k in builds.BADGE_IDS:
        if caps[k] >= 4 and hof < builds.HOF_LIMIT:
            t, hof = 4, hof + 1
        else:
            t = min(caps[k], 3)
        ch["badges"][k] = {"tier": t, "progress": 0}
    return ch


def gold_short(ch):
    """An ICON but for one Gold badge left at Silver, with the progress for Gold already there (the next game's badge
    catch-up raises it)."""
    make_icon(ch)
    caps = builds.badge_caps(ch)
    k = next(k for k in builds.BADGE_IDS if caps[k] == 3 and progression.BADGES[k]["stat"] != "games")
    ch["badges"][k] = {"tier": 2, "progress": progression.BADGES[k]["tiers"][2]}
    return ch


class SlotRules(unittest.TestCase):
    def test_four_base_one_an_icon_up_to_eight(self):
        plain = {"archetype": "stretch_big", "position": "PF", "height": 83, "weight": 235, "wingspan": 87, "attributes": {a: 60 for a in builds.ATTRIBUTES}}
        self.assertEqual(builds.build_slots([]), {"unlocked": 4, "base": 4, "max": 8, "icons": 0, "kept": 0, "used": 0})
        self.assertEqual(builds.build_slots([plain] * 4)["unlocked"], 4)
        self.assertEqual(builds.build_slots([icon_build()] + [plain] * 3), {"unlocked": 5, "base": 4, "max": 8, "icons": 1, "kept": 0, "used": 4})
        self.assertEqual(builds.build_slots([icon_build()] * 4)["unlocked"], 8)
        self.assertEqual(builds.build_slots([icon_build()] * 7), {"unlocked": 8, "base": 4, "max": 8, "icons": 7, "kept": 0, "used": 7})
        # the mark keeps the slot after the build stops qualifying (a badge taken back below its cap); without it, gone
        c = icon_build()
        self.assertTrue(builds.mark_icon_slot(c))
        self.assertFalse(builds.mark_icon_slot(c), "marked once")
        gold = next(k for k, b in c["badges"].items() if b["tier"] == 3)
        c["badges"][gold]["tier"] = 2
        self.assertFalse(builds.icon_status(c))
        self.assertTrue(builds.holds_icon_slot(c))
        self.assertEqual(builds.build_slots([c])["unlocked"], 5)
        self.assertEqual(builds.build_slots([{**c, "icon_slot": False}])["unlocked"], 4)
        self.assertFalse(builds.mark_icon_slot(plain))
        self.assertNotIn("icon_slot", plain)

    def test_what_opens_and_the_rule(self):
        self.assertEqual(builds.slot_opened(0, 1), {"slot": 5, "max": 8, "opened": 1})
        self.assertEqual(builds.slot_opened(3, 1), {"slot": 8, "max": 8, "opened": 1})
        self.assertEqual(builds.slot_opened(1, 2), {"slot": 7, "max": 8, "opened": 2})
        self.assertIsNone(builds.slot_opened(4, 1), "nothing opens past 8")
        self.assertIsNone(builds.slot_opened(2, 0))
        self.assertEqual(builds.slot_opened(3, 3), {"slot": 8, "max": 8, "opened": 1})
        self.assertEqual(builds.build_slot_rule({"unlocked": 4}), FULL4)
        self.assertEqual(builds.build_slot_rule({"unlocked": 6}), "All 6 build slots are in use. Every ICON build on your account opens one more, up to 8.")
        self.assertEqual(builds.build_slot_rule({"unlocked": 8}), FULL8)

    def test_the_client_mirror_matches(self):
        src = (ROOT / "client/js/sim/builds.js").read_text()
        self.assertIn("export const BASE_BUILD_SLOTS = 4, MAX_BUILD_SLOTS = 8;", src)
        self.assertEqual((builds.BASE_BUILD_SLOTS, builds.MAX_BUILD_SLOTS), (4, 8))
        # the builder says the server's rule in the same words (both templates)
        self.assertIn("build slots are in use (the most an account can have).", src)
        self.assertIn("build slots are in use. Every ICON build on your account opens one more, up to ${max}.", src)
        # "four players" is gone from the create endpoint and the Players tab
        self.assertNotIn("four players", (ROOT / "server/app.py").read_text())
        self.assertNotIn("four players", (ROOT / "client/js/ui/myplayer.js").read_text())


class SlotsApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "slots.sqlite3")
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
        # a new account for every test (its own cookie jar)
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.call("/api/register", {"username": "sl_" + uuid.uuid4().hex[:8], "password": "longpassword1"})

    def call(self, path, body=None, expect=200):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=20) as r:
                status, payload = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, payload = e.code, json.loads(e.read() or b"null")
        if expect is not None and status != expect:
            raise AssertionError(f"{path}: {status} {payload}")
        return payload

    @staticmethod
    def key():
        return uuid.uuid4().hex

    def create(self, n=1, expect=200):
        return [self.call("/api/characters", {"key": self.key(), "build": {**BUILD, "name": f"Slot {uuid.uuid4().hex[:4]}"}}, expect) for _ in range(n)]

    def patch(self, cid, fn):
        """Change a build's saved data straight in the test database (as an ICON's grind would leave it)."""
        with self.service.db.transaction() as c:
            ch = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            fn(ch)
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), cid))

    def stored(self, cid):
        return json.loads(self.service.db.query("SELECT data FROM characters WHERE id=?", (cid,))[0][0])

    def test_four_then_icons_open_slots_up_to_eight(self):
        ids = [r["character"]["id"] for r in self.create(4)]
        me = self.call("/api/me")
        self.assertEqual(me["build_slots"], {"unlocked": 4, "base": 4, "max": 8, "icons": 0, "kept": 0, "used": 4})
        self.assertIsNone(me["build_slot_unlocked"])
        self.assertEqual(self.create(1, 400)[0]["error"], FULL4)
        # one ICON: the profile load marks it and opens slot 5 (said once)
        self.patch(ids[0], make_icon)
        me = self.call("/api/me")
        self.assertEqual(me["build_slots"], {"unlocked": 5, "base": 4, "max": 8, "icons": 1, "kept": 0, "used": 4})
        self.assertEqual(me["build_slot_unlocked"], {"slot": 5, "max": 8, "opened": 1})
        self.assertIs(next(c for c in me["characters"] if c["id"] == ids[0])["icon_slot"], True)
        self.assertIs(self.stored(ids[0]).get("icon_slot"), True)
        self.assertIsNone(self.call("/api/me")["build_slot_unlocked"])
        fifth = self.create(1)[0]
        self.assertEqual(fifth["build_slots"], {"unlocked": 5, "base": 4, "max": 8, "icons": 1, "kept": 0, "used": 5})
        ids.append(fifth["character"]["id"])
        self.assertEqual(self.create(1, 400)[0]["error"], "All 5 build slots are in use. Every ICON build on your account opens one more, up to 8.")
        # the build stops qualifying (a later patch's new bar): it keeps the slot, and the account isn't over its cap
        def drop(ch):
            gold = next(k for k, b in ch["badges"].items() if b["tier"] == 3)
            ch["badges"][gold]["tier"] = 2
        self.patch(ids[0], drop)
        me = self.call("/api/me")
        first = next(c for c in me["characters"] if c["id"] == ids[0])
        self.assertIs(first["icon_status"], False)
        self.assertIs(first["icon_slot"], True)
        self.assertEqual(me["build_slots"], {"unlocked": 5, "base": 4, "max": 8, "icons": 1, "kept": 0, "used": 5})
        self.assertEqual(self.create(1, 400)[0]["error"], "All 5 build slots are in use. Every ICON build on your account opens one more, up to 8.")
        # three more ICONs: 8 slots (the three said at once)
        for cid in ids[1:4]:
            self.patch(cid, make_icon)
        me = self.call("/api/me")
        self.assertEqual(me["build_slots"], {"unlocked": 8, "base": 4, "max": 8, "icons": 4, "kept": 0, "used": 5})
        self.assertEqual(me["build_slot_unlocked"], {"slot": 8, "max": 8, "opened": 3})
        ids += [r["character"]["id"] for r in self.create(3)]
        self.assertEqual(self.create(1, 400)[0]["error"], FULL8)
        # builds 5 to 8 become ICONs too: still 8, nothing opens past it, and the 9th is still refused
        for cid in ids[4:8]:
            self.patch(cid, make_icon)
        me = self.call("/api/me")
        self.assertEqual(me["build_slots"], {"unlocked": 8, "base": 4, "max": 8, "icons": 8, "kept": 0, "used": 8})
        self.assertIsNone(me["build_slot_unlocked"])
        self.assertTrue(all(c["icon_slot"] for c in me["characters"]))
        self.assertEqual(self.create(1, 400)[0]["error"], FULL8)

    def test_an_icon_not_marked_yet_counts_and_is_marked_when_its_slot_is_used(self):
        ids = [r["character"]["id"] for r in self.create(4)]
        self.patch(ids[2], make_icon)  # (no profile load in between)
        fifth = self.create(1)[0]
        self.assertEqual(fifth["build_slots"]["unlocked"], 5)
        self.assertIs(self.stored(ids[2]).get("icon_slot"), True, "the slot in use is the account's for good")
        self.assertIsNone(self.call("/api/me")["build_slot_unlocked"], "nothing new to say: it was counted already")

    def test_the_upgrade_that_makes_an_icon_opens_a_slot(self):
        ids = [r["character"]["id"] for r in self.create(4)]
        self.patch(ids[1], lambda ch: make_icon(ch, ovr99=False))
        me = self.call("/api/me")
        self.assertEqual(me["build_slots"]["unlocked"], 4)
        self.assertIs(next(c for c in me["characters"] if c["id"] == ids[1])["icon_status"], False)
        # an action that doesn't make one says nothing
        res = self.call(f"/api/characters/{ids[1]}/appearance", {"key": self.key(), "appearance": {"number": 7}})
        self.assertNotIn("build_slot_unlocked", res)
        res = self.call(f"/api/characters/{ids[1]}/upgrade", {"key": self.key(), "max": True})
        self.assertEqual(res["character"]["overall"], 99)
        self.assertIs(res["character"]["icon_status"], True)
        self.assertIs(res["character"]["icon_slot"], True)
        self.assertEqual(res["build_slot_unlocked"], {"slot": 5, "max": 8, "opened": 1})
        self.assertEqual(res["build_slots"], {"unlocked": 5, "base": 4, "max": 8, "icons": 1, "kept": 0, "used": 4})
        self.assertIsNone(self.call("/api/me")["build_slot_unlocked"], "said once, by the upgrade")
        self.create(1)

    def test_the_game_that_makes_an_icon_opens_a_slot(self):
        self.call("/api/ai-world", {"key": self.key(), "world": {"seed": 4747, "friends": [], "squad": [], "met": {}}})
        ids = [r["character"]["id"] for r in self.create(4)]
        self.patch(ids[3], gold_short)  # (no profile load: the game's badge catch-up raises the last badge)
        old_slack = server_app.TIME_SLACK
        server_app.TIME_SLACK = 10_000
        try:
            t = self.call("/api/matches", {"key": self.key(), "character_id": ids[3], "mode": "park", "venue": "brick", "format": 3, "target": 21})
            s = {"pts": 11, "fgm": 4, "fga": 9, "tpm": 3, "tpa": 5, "ftm": 0, "fta": 0, "ast": 2, "reb": 3}
            summary = {"mode": "park", "score": [21, 15], "winner": 0, "duration": 420, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}
            res = self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": summary})
            self.assertTrue(any(b["tier"] == 3 for b in res["badges_upgraded"]))
            self.assertIs(res["character"]["icon_status"], True)
            self.assertEqual(res["build_slot_unlocked"], {"slot": 5, "max": 8, "opened": 1})
            self.assertEqual(res["build_slots"]["unlocked"], 5)
            # an ordinary game: the key is there, empty
            t = self.call("/api/matches", {"key": self.key(), "character_id": ids[0], "mode": "park", "venue": "brick", "format": 3, "target": 21})
            res = self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": summary})
            self.assertIsNone(res["build_slot_unlocked"])
            self.assertNotIn("build_slots", res)
        finally:
            server_app.TIME_SLACK = old_slack
        self.assertEqual(self.call("/api/me")["build_slots"]["unlocked"], 5)

    def test_no_slot_past_eight_from_an_action(self):
        ids = [r["character"]["id"] for r in self.create(4)]
        for cid in ids:
            self.patch(cid, make_icon)
        self.assertEqual(self.call("/api/me")["build_slots"]["unlocked"], 8)
        ids += [r["character"]["id"] for r in self.create(4)]
        self.patch(ids[7], lambda ch: make_icon(ch, ovr99=False))
        res = self.call(f"/api/characters/{ids[7]}/upgrade", {"key": self.key(), "max": True})
        self.assertIs(res["character"]["icon_slot"], True)
        self.assertNotIn("build_slot_unlocked", res)
        self.assertEqual(self.create(1, 400)[0]["error"], FULL8)


if __name__ == "__main__":
    unittest.main()
