"""v0.4.8.6 quick patch: the season reset (server/reset.py). At midnight Eastern going into Oct 19 2026 (04:00 UTC) every
account on a save starts over with 250,000 VC and the free basics, the first time the service runs at or after that moment
(start-up, or the first request), exactly once per save, after a backup copy. Accounts, sign-ins, real-player friends and
the online-server link stay; builds, games, careers, items, the ledger, teams, crews, event entries, spins, locker codes,
ICON slots, saved replies and the AI world go.

Run from the project root:  python3 -m unittest tests.test_season_reset -v
"""
import http.cookiejar
import json
import sqlite3
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
from server import reset as season


def fill(db, aid, other):
    """Everything a played account has, straight into the save."""
    now = time.time()
    with db.transaction() as c:
        c.execute("INSERT INTO characters VALUES(?,?,?,?)", ("c-" + aid[:8], aid, json.dumps({"schema": 3, "name": "Old Build"}), now))
        c.execute("INSERT INTO matches(id,account_id,character_id,status,seed,state,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                  ("m-" + aid[:8], aid, "c-" + aid[:8], "done", 1, None, "{}", now, now))
        c.execute("INSERT INTO prorun_careers VALUES(?,?,?,?,?)", ("c-" + aid[:8], aid, "{}", now, now))
        c.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (aid, "wheel_jersey_aurora", now))
        c.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (aid, "jersey_black_gold", now))
        db.change_wallet(c, aid, 777_000, "match_reward", "m:" + aid)
        c.execute("INSERT INTO proam_teams VALUES(?,?,?,?)", (aid, "{}", now, now))
        c.execute("INSERT INTO crews VALUES(?,?,?,?)", (aid, "{}", now, now))
        c.execute("INSERT OR IGNORE INTO online_crews VALUES(?,?,?,?,?,?,?,?)", (aid, "Old Crew", "OLD", "#ff0000", 7, 9000, 50, now))
        c.execute("INSERT OR IGNORE INTO online_crew_members VALUES(?,?,?)", (aid, aid, now))
        c.execute("INSERT OR IGNORE INTO online_friends VALUES(?,?,?,?)", (aid, other, "friends", now))
        c.execute("INSERT OR IGNORE INTO hub_links(account_id,hub,username,token,updated_at) VALUES(?,?,?,?,?)", (aid, "https://hub.example", "me", "t", now))
        c.execute("INSERT INTO cup_entries VALUES(?,?,?,?)", (aid, 5, "{}", now))
        c.execute("INSERT INTO daily_spins VALUES(?,?,?,?)", (aid, now, 3, "x"))
        c.execute("INSERT INTO locker_redemptions VALUES(?,?,?,?)", (aid, "CODE", 1, now))
        c.execute("INSERT INTO icon_slots VALUES(?,?,?,?)", (aid, "c-gone", "Gone", now))
        c.execute("INSERT INTO ai_world VALUES(?,?,?)", (aid, json.dumps({"seed": 4242, "born": 1}), now))
        c.execute("INSERT INTO requests VALUES(?,?,?,?,?)", (aid, "k" * 10, "f", "{}", now))


def count(db, table, aid=None):
    col = "id" if table == "online_crews" else "account_id"
    q = f"SELECT COUNT(*) FROM {table}" + (f" WHERE {col}=?" if aid else "")
    return db.query(q, (aid,) if aid else ())[0][0]


class SeasonReset(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "data" / "save.sqlite3"
        self.at = time.time() + 3600
        self.reset = {"id": "test-reset", "at": self.at, "vc": 250_000}

    def tearDown(self):
        self.tmp.cleanup()

    def service(self):
        return server_app.Service(self.path, dev_accounts=False, season_reset=self.reset)

    def test_the_time_and_amount(self):
        self.assertEqual(season.SEASON_RESET["at"], 1792382400)  # 2026-10-19 04:00 UTC: 12:00 AM EDT, 9:00 PM PDT on the 18th
        self.assertEqual(time.strftime("%Y-%m-%d %H:%M", time.gmtime(season.SEASON_RESET["at"])), "2026-10-19 04:00")
        self.assertEqual(season.SEASON_RESET["vc"], 250_000)
        # a Service made without one (the tests, tools) never resets
        s = server_app.Service(Path(self.tmp.name) / "plain.sqlite3", dev_accounts=False)
        self.assertIsNone(s.maybe_reset(now=season.SEASON_RESET["at"] + 10))
        s.close()

    def test_every_account_starts_over_once(self):
        s = self.service()
        db = s.db
        a = db.create_account("alpha", "password123", ["yard_teal"])
        b = db.create_account("bravo", "password123", ["yard_teal"])
        fill(db, a, b)
        fill(db, b, a)
        token = db.session(a)
        # before the time: nothing happens
        self.assertIsNone(s.maybe_reset(now=self.at - 1))
        self.assertEqual(count(db, "characters"), 2)
        # at the time: everything goes, once
        starters = [i for i in server_app.CATALOG if server_app.CATALOG[i]["price"] == 0 and not server_app.CATALOG[i].get("exclusive")]
        out = s.maybe_reset(now=self.at)
        self.assertEqual(out["accounts"], 2)
        for table in season.WIPE:
            if table == "ledger" or table == "inventory":
                continue
            self.assertEqual(count(db, table), 0, table)
        for aid in (a, b):
            self.assertEqual(db.query("SELECT balance FROM wallets WHERE account_id=?", (aid,))[0][0], 250_000)
            rows = db.query("SELECT delta, balance_after, kind FROM ledger WHERE account_id=?", (aid,))
            self.assertEqual([tuple(r) for r in rows], [(250_000, 250_000, "season_reset")])
            inv = sorted(r[0] for r in db.query("SELECT item_id FROM inventory WHERE account_id=?", (aid,)))
            self.assertEqual(inv, sorted(starters))  # (the free basics only: no store, wheel or event items)
            self.assertNotIn("wheel_jersey_aurora", inv)
        # kept: the accounts, sign-ins, friends, the online-server link
        self.assertEqual(count(db, "accounts"), 2)
        self.assertEqual(db.authenticate(token), a)
        self.assertEqual(count(db, "online_friends"), 2)
        self.assertEqual(count(db, "hub_links"), 2)
        self.assertTrue(season.done(db, self.reset))
        # the backup has the old save
        self.assertTrue(out["backup"] and Path(out["backup"]).is_file())
        self.assertEqual(Path(out["backup"]).parent, self.path.parent / "backups")
        old = sqlite3.connect(out["backup"])
        self.assertEqual(old.execute("SELECT COUNT(*) FROM characters").fetchone()[0], 2)
        old.close()
        # once: what's played after it stays, through another check and a restart
        fill(db, a, b)
        self.assertIsNone(s.maybe_reset(now=self.at + 60))
        s.close()
        s2 = self.service()
        self.assertIsNone(s2.maybe_reset(now=self.at + 120))
        self.assertEqual(count(s2.db, "characters", a), 1)
        s2.close()

    def test_a_copy_started_after_the_time_resets_at_start_up(self):
        s = server_app.Service(self.path, dev_accounts=False)  # (an older copy: no reset in it)
        a = s.db.create_account("alpha", "password123", [])
        fill(s.db, a, a)
        s.close()
        self.reset["at"] = time.time() - 60  # (the time has passed: the updated copy starts)
        s = self.service()
        self.assertTrue(season.done(s.db, self.reset))
        self.assertEqual(count(s.db, "characters"), 0)
        self.assertEqual(s.db.query("SELECT balance FROM wallets WHERE account_id=?", (a,))[0][0], 250_000)
        s.close()

    def test_a_new_account_after_it_starts_with_250k_too(self):
        # the game's service (main) grants 250,000 to a new account from this patch on (--welcome-vc's default)
        import inspect
        src = inspect.getsource(server_app.main)
        self.assertIn('"--welcome-vc", type=int, default=250_000', src)
        self.assertIn("season.SEASON_RESET)", src)


class SeasonResetOverHttp(unittest.TestCase):
    """The request hook: a game left open across the moment gets the fresh account on its next call, still signed in."""

    def test_the_next_request_after_the_time_sees_a_fresh_account(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            reset = {"id": "http-reset", "at": time.time() + 2.5, "vc": 250_000}
            svc = server_app.Service(Path(tmp.name) / "api.sqlite3", season_reset=reset)
            svc.bug_root = Path(tmp.name)
            handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
            srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            srv.daemon_threads = True
            srv.service = svc
            threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
            base = f"http://127.0.0.1:{srv.server_address[1]}"
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

            def call(path, body=None):
                req = urllib.request.Request(base + path, method="GET" if body is None else "POST", data=None if body is None else json.dumps(body).encode(),
                                             headers={} if body is None else {"Content-Type": "application/json"})
                with opener.open(req, timeout=20) as r:
                    return json.loads(r.read() or b"null")

            prof = call("/api/dev-account", {})
            call("/api/characters", {"key": uuid.uuid4().hex, "build": {"name": "Old Build", "position": "SG", "archetype": "sharpshooter", "height": 77, "weight": 195, "wingspan": 80}})
            cfg = call("/api/config")
            self.assertEqual(cfg["season_reset"], {"id": "http-reset", "at": reset["at"], "vc": 250_000, "done": False})
            self.assertEqual(len(call("/api/me")["characters"]), 1)
            time.sleep(max(0, reset["at"] - time.time()) + 0.3)
            me = call("/api/me")  # (still signed in)
            self.assertEqual(me["characters"], [])
            self.assertEqual(me["balance"], 250_000)
            self.assertIsNone(me.get("ai_world"))
            self.assertTrue(call("/api/config")["season_reset"]["done"])
            self.assertGreater(prof["balance"], 250_000)  # (the dev account had its welcome grant before)
            srv.shutdown()
            srv.server_close()
            svc.close()
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
