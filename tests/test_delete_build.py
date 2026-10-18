"""v0.4.8.5 quick patch 8: deleting builds (server side). POST /api/characters/<id>/delete with an idempotency key: owner
only, never while the build is in a game that can still finish, and in one transaction the build goes with its games and
its Pro Run career; the account's VC, ledger and locker stay. A build holding an ICON slot leaves it open for the account
(icon_slots): counted once, never announced again, and the slots still top out at 8.

Run from the project root:  python3 -m unittest tests.test_delete_build -v
"""
import contextlib
import http.cookiejar
import io
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app
from tests.test_icon_slots import make_icon, BUILD

FULL8 = "All 8 build slots are in use (the most an account can have)."
STATS = {"pts": 11, "fgm": 4, "fga": 9, "tpm": 3, "tpa": 5, "ftm": 0, "fta": 0, "ast": 2, "reb": 3}
WIN = {"mode": "park", "score": [21, 15], "winner": 0, "duration": 420, "quarter": 1, "players": [], "me": {"team": 0, "stats": STATS}, "forfeit": False}


class DeleteApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "delete.sqlite3")
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
        self.service.attempts.clear()  # (the sign-up rate limit: every test makes its own accounts)
        self.opener = self.account()

    def account(self):
        """A new signed-in account (its own cookie jar)."""
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.call("/api/register", {"username": "dl_" + uuid.uuid4().hex[:8], "password": "longpassword1"}, opener=opener)
        return opener

    def call(self, path, body=None, expect=200, opener=None):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with (opener or self.opener).open(req, timeout=20) as r:
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
        return [self.call("/api/characters", {"key": self.key(), "build": {**BUILD, "name": f"Del {uuid.uuid4().hex[:4]}"}}, expect) for _ in range(n)]

    def ids(self, n):
        return [r["character"]["id"] for r in self.create(n)]

    def delete(self, cid, expect=200, key=None, opener=None):
        return self.call(f"/api/characters/{cid}/delete", {"key": key or self.key()}, expect, opener)

    def patch(self, cid, fn):
        with self.service.db.transaction() as c:
            ch = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            fn(ch)
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), cid))

    def rows(self, sql, *args):
        return self.service.db.query(sql, args)

    def count(self, table, col, cid):
        return self.rows(f"SELECT count(*) FROM {table} WHERE {col}=?", cid)[0][0]

    def play(self, cid, finish=True):
        t = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "park", "venue": "brick", "format": 3, "target": 21})
        if finish == "cancel":
            self.call(f"/api/matches/{t['id']}/cancel", {})
        elif finish:
            self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": WIN})
        return t["id"]

    def aid(self):
        return self.call("/api/me")["account"]["id"]

    def test_the_build_and_only_its_own_rows_go(self):
        self.assertEqual(self.service.db.conn.execute("PRAGMA foreign_keys").fetchone()[0], 1, "foreign keys are enforced")
        a, b = self.ids(2)
        old_slack = server_app.TIME_SLACK
        server_app.TIME_SLACK = 10_000
        try:
            for cid in (a, b):
                self.play(cid)
                self.play(cid, "cancel")
                self.call("/api/prorun", {"key": self.key(), "character_id": cid, "career": {"v": 1, "phase": "college"}})
        finally:
            server_app.TIME_SLACK = old_slack
        self.call("/api/store/purchase", {"key": self.key(), "item_id": "band_lime", "character_id": a})  # (bought with it: still the account's)
        aid = self.aid()
        before = {"balance": self.call("/api/me")["balance"], "inventory": sorted(self.call("/api/me")["inventory"]),
                  "ledger": self.rows("SELECT count(*) FROM ledger WHERE account_id=?", aid)[0][0]}
        self.assertEqual((self.count("matches", "character_id", a), self.count("prorun_careers", "character_id", a)), (2, 1))
        res = self.delete(a)
        self.assertEqual(res["deleted"]["id"], a)
        self.assertIs(res["deleted"]["icon_slot_kept"], False)
        self.assertEqual(res["deleted"]["removed"], {"matches": 2, "prorun_careers": 1})
        self.assertEqual([c["id"] for c in res["characters"]], [b])
        self.assertEqual(res["build_slots"], {"unlocked": 4, "base": 4, "max": 8, "icons": 0, "kept": 0, "used": 1})
        for table, col in (("characters", "id"), ("matches", "character_id"), ("prorun_careers", "character_id")):
            self.assertEqual(self.count(table, col, a), 0, table)
        self.assertEqual((self.count("characters", "id", b), self.count("matches", "character_id", b), self.count("prorun_careers", "character_id", b)), (1, 2, 1))
        me = self.call("/api/me")
        self.assertEqual([c["id"] for c in me["characters"]], [b])
        self.assertNotIn(a, json.dumps(me["recent_matches"]))
        self.assertEqual(me["balance"], before["balance"], "the wallet is the account's")
        self.assertEqual(sorted(me["inventory"]), before["inventory"], "so is the locker")
        self.assertEqual(self.rows("SELECT count(*) FROM ledger WHERE account_id=?", aid)[0][0], before["ledger"])
        self.assertEqual(self.rows("SELECT count(*) FROM icon_slots WHERE account_id=?", aid)[0][0], 0)
        # the other build still plays and saves
        self.call(f"/api/characters/{b}/appearance", {"key": self.key(), "appearance": {"number": 3}})
        self.call("/api/characters/" + a + "/appearance", {"key": self.key(), "appearance": {"number": 3}}, expect=404)
        self.call("/api/prorun", {"key": self.key(), "character_id": a, "career": {"v": 1, "phase": "college"}}, expect=404)
        self.assertEqual(self.call("/api/characters/" + b + "/delete", {"key": self.key(), "extra": 1}, expect=400)["error"], "Unsupported fields in request.")

    def test_owner_only(self):
        a = self.ids(1)[0]
        other = self.account()
        self.assertEqual(self.delete(a, 404, opener=other)["error"], "Player not found.")
        self.assertEqual(self.count("characters", "id", a), 1)
        anon = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.call(f"/api/characters/{a}/delete", {"key": self.key()}, expect=401, opener=anon)
        self.assertEqual(self.count("characters", "id", a), 1)

    def test_not_while_its_game_is_running(self):
        a, b = self.ids(2)
        mid = self.play(a, finish=False)
        err = self.delete(a, 400)["error"]
        self.assertIn("is in a game that's still running", err)
        self.assertEqual(self.count("characters", "id", a), 1)
        self.delete(b)  # (another build's game doesn't hold this one up)
        self.call(f"/api/matches/{mid}/cancel", {})
        self.delete(a)
        self.assertEqual(self.count("matches", "character_id", a), 0)
        # a game left "running" for good (the page closed hours ago) doesn't block it; it goes with the build
        c = self.ids(1)[0]
        mid = self.play(c, finish=False)
        with self.service.db.transaction() as t:
            t.execute("UPDATE matches SET created_at=? WHERE id=?", (time.time() - server_app.GAME_OPEN_SECS - 60, mid))
        self.delete(c)
        self.assertEqual(self.count("matches", "id", mid), 0)

    def test_idempotent(self):
        a = self.ids(1)[0]
        k = self.key()
        first = self.delete(a, key=k)
        self.assertEqual(self.delete(a, key=k), first, "the same request answers the same")
        self.assertEqual(self.delete(a, 404)["error"], "Player not found.", "a new one: it's gone")

    def test_deleting_the_last_build(self):
        a = self.ids(1)[0]
        res = self.delete(a)
        self.assertEqual(res["characters"], [])
        self.assertEqual(res["build_slots"]["used"], 0)
        self.assertEqual(self.call("/api/me")["characters"], [])
        self.create(1)

    def test_a_deleted_icon_keeps_its_slot_once(self):
        ids = self.ids(4)
        self.patch(ids[0], make_icon)
        self.assertEqual(self.call("/api/me")["build_slot_unlocked"], {"slot": 5, "max": 8, "opened": 1})
        ids += self.ids(1)
        res = self.delete(ids[0])
        self.assertIs(res["deleted"]["icon_slot_kept"], True)
        self.assertEqual(res["build_slots"], {"unlocked": 5, "base": 4, "max": 8, "icons": 1, "kept": 1, "used": 4})
        aid = self.aid()
        self.assertEqual([tuple(r) for r in self.rows("SELECT character_id FROM icon_slots WHERE account_id=?", aid)], [(ids[0],)])
        me = self.call("/api/me")
        self.assertEqual(me["build_slots"], {"unlocked": 5, "base": 4, "max": 8, "icons": 1, "kept": 1, "used": 4})
        self.assertIsNone(me["build_slot_unlocked"], "never announced again")
        ids.append(self.create(1)[0]["character"]["id"])  # 5 builds in 5 slots
        self.assertEqual(self.create(1, 400)[0]["error"], "All 5 build slots are in use. Every ICON build on your account opens one more, up to 8.")
        # the next ICON opens slot 6 (the kept one counts as had already, so nothing is said twice)
        self.patch(ids[1], make_icon)
        me = self.call("/api/me")
        self.assertEqual(me["build_slot_unlocked"], {"slot": 6, "max": 8, "opened": 1})
        self.assertEqual(me["build_slots"], {"unlocked": 6, "base": 4, "max": 8, "icons": 2, "kept": 1, "used": 5})
        # and through an action too: a build one upgrade short of ICON
        self.patch(ids[2], lambda ch: make_icon(ch, ovr99=False))
        up = self.call(f"/api/characters/{ids[2]}/upgrade", {"key": self.key(), "max": True})
        self.assertEqual(up["build_slot_unlocked"], {"slot": 7, "max": 8, "opened": 1})
        self.assertEqual(up["build_slots"]["kept"], 1)

    def test_never_more_than_eight(self):
        ids = self.ids(4)
        for cid in ids:
            self.patch(cid, make_icon)
        self.assertEqual(self.call("/api/me")["build_slots"]["unlocked"], 8)
        ids += self.ids(4)
        for cid in ids[4:]:
            self.patch(cid, make_icon)
        for cid in ids[:4]:
            self.delete(cid)
        me = self.call("/api/me")
        self.assertEqual(me["build_slots"], {"unlocked": 8, "base": 4, "max": 8, "icons": 8, "kept": 4, "used": 4})
        self.assertIsNone(me["build_slot_unlocked"])
        self.create(4)
        self.assertEqual(self.create(1, 400)[0]["error"], FULL8)

    def test_all_or_nothing(self):
        a = self.ids(1)[0]
        self.play(a, "cancel")
        self.patch(a, make_icon)
        real = server_app.Service.build_slots

        def boom(*args, **kw):
            raise RuntimeError("fail half-way")
        server_app.Service.build_slots = staticmethod(boom)
        try:
            with contextlib.redirect_stderr(io.StringIO()):  # (the service prints the traceback of a 500)
                self.delete(a, 500)
        finally:
            server_app.Service.build_slots = staticmethod(real)
        self.assertEqual((self.count("characters", "id", a), self.count("matches", "character_id", a)), (1, 1), "nothing went")
        self.assertEqual(self.rows("SELECT count(*) FROM icon_slots WHERE character_id=?", a)[0][0], 0)
        self.delete(a)


if __name__ == "__main__":
    unittest.main()
