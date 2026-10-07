"""Server tests for v0.3: build legality, save migration, progression validation and the HTTP API.

Run from the project root:  python -m unittest discover -s tests -v
"""
import http.cookiejar
import json
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import time
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app
from server import builds, progression
from server.database import Database

ROOT = Path(__file__).resolve().parents[1]


def legal_builds():
    for pos, (lo, hi) in builds.POSITIONS.items():
        for arch in builds.ARCHETYPES:
            for h in (lo, hi):
                for w in (150, 300):
                    for ws in (h - 1, h + 8):
                        yield builds.spec({"position": pos, "archetype": arch, "height": h, "weight": w, "wingspan": ws})


class BuildTests(unittest.TestCase):
    def test_every_legal_build_can_be_maxed_with_the_welcome_grant(self):
        n = 0
        for b in legal_builds():
            char = {**b, "attributes": builds.starting_attributes(b)}
            cost, maxed = builds.quote(char, builds.max_targets(char))
            self.assertLessEqual(cost, 1_000_000, b)
            self.assertEqual(maxed, builds.caps(b))
            self.assertTrue(all(40 <= v <= 99 for v in maxed.values()))
            n += 1
        self.assertGreater(n, 300)

    def test_spec_rejects_illegal_bodies(self):
        for bad in ({"position": "PG", "height": 90}, {"weight": 120}, {"position": "C", "height": 84, "wingspan": 80},
                    {"archetype": "goat"}, {"hand": "X"}, {"name": ""}, {"secret": 1}, {"appearance": {"hair": "mohawk"}}):
            with self.assertRaises(builds.Invalid):
                builds.spec(bad)

    def test_quote_refuses_downgrades_and_over_cap(self):
        b = builds.spec({"position": "SG", "archetype": "sharpshooter"})
        char = {**b, "attributes": builds.starting_attributes(b)}
        cap = builds.caps(b)
        with self.assertRaises(builds.Invalid):
            builds.quote(char, {"three_point": cap["three_point"] + 1})
        with self.assertRaises(builds.Invalid):
            builds.quote(char, {"three_point": char["attributes"]["three_point"] - 1})
        with self.assertRaises(builds.Invalid):
            builds.quote(char, {"shooting": 99})

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_caps_and_overall_match_the_client(self):
        sample = list(legal_builds())[::17]
        script = (
            "import('./client/js/sim/builds.js').then(async B => { const R = await import('./client/js/sim/ratings.js');"
            "const input = JSON.parse(process.argv[1]);"
            "console.log(JSON.stringify(input.map(b => { const c = B.caps(b); return { caps: c, start: B.startingAttributes(b), ovr: R.overall(c, b.position) }; })));"
            "});"
        )
        out = subprocess.run(["node", "--input-type=module", "-e", script, json.dumps(sample)], cwd=ROOT, capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        js = json.loads(out.stdout)
        for b, j in zip(sample, js):
            self.assertEqual(builds.caps(b), j["caps"], b)
            self.assertEqual(builds.starting_attributes(b), j["start"], b)
            self.assertEqual(builds.overall(builds.caps(b), b["position"]), j["ovr"], b)

    def test_v02_character_is_upgraded_idempotently(self):
        legacy = {"id": "old", "name": "Old Timer", "position": "SF", "style": "outside", "height": 78, "weight": 210, "wingspan": 81,
                  "attributes": {"shooting": 80, "finishing": 60, "dunk": 55, "handle": 70, "passing": 65, "defense": 66, "rebound": 50, "speed": 75, "stamina": 80},
                  "equipment": {"top": "jersey_coral", "bottom": "yard_shorts", "shoes": "yard_shoes", "release": "release_classic"},
                  "appearance": {"skin": "#a56945", "hair": "crop", "number": 16}}
        char = builds.normalize(json.loads(json.dumps(legacy)))
        self.assertEqual(char["schema"], 3)
        self.assertEqual(char["archetype"], "sharpshooter")
        self.assertEqual(set(char["attributes"]), set(builds.ATTRIBUTES))
        cap, start = builds.caps(char), builds.starting_attributes(char)
        for k, v in char["attributes"].items():
            self.assertTrue(start[k] <= v <= cap[k], k)
        self.assertEqual(char["equipment"]["top"], "jersey_coral")  # purchases stay equipped
        self.assertEqual(char["equipment"]["jumpshot"], builds.DEFAULT_EQUIPMENT["jumpshot"])
        again = builds.normalize(json.loads(json.dumps(char)))
        self.assertEqual(again, char)


def summary(score=(21, 15), winner=0, duration=600, mode="park", **stats):
    s = {"pts": 0, "fgm": 0, "fga": 0, "tpm": 0, "tpa": 0, "ftm": 0, "fta": 0}
    s.update(stats)
    return {"mode": mode, "score": list(score), "winner": winner, "duration": duration, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}


PARK = {"mode": "park", "meta": {"target": 21, "streak": 0}}
PROAM = {"mode": "proam", "meta": {"quarter_len": 180, "quarters": 4}}


class ProgressionTests(unittest.TestCase):
    def test_valid_summary_pays_and_levels(self):
        s = progression.validate_summary(summary(pts=11, fgm=4, fga=9, tpm=3, tpa=5, ast=4, reb=3), PARK)
        rw = progression.rewards(s, PARK, {})
        self.assertTrue(rw["won"])
        self.assertGreater(rw["vc"], 0)
        self.assertLessEqual(rw["vc"], 2200)
        char = builds.normalize({**builds.spec({}), "attributes": builds.starting_attributes(builds.spec({}))})
        out = progression.apply_progress(char, s, rw)
        self.assertEqual(char["progression"]["park"]["streak"], 1)
        self.assertGreaterEqual(out["rep_after"]["points"], out["rep_before"]["points"])
        self.assertGreater(char["badges"]["catch_shoot"]["progress"], 0)

    def test_inconsistent_or_impossible_results_are_rejected(self):
        bad = [
            summary(pts=10, fgm=4, fga=9),                    # points don't add up
            summary(pts=4, fgm=2, fga=1),                     # makes > attempts
            summary(pts=30, fgm=15, fga=20),                  # more than the team scored
            summary(score=(15, 12)),                          # nobody reached 21
            summary(score=(15, 21), winner=0),                # wrong winner
            summary(duration=20),                             # faster than a real game
            {**summary(), "bonus_vc": 9999},                  # unknown fields
            summary(mode="proam"),                            # mode mismatch
        ]
        for s in bad:
            with self.assertRaises(builds.Invalid, msg=json.dumps(s)):
                progression.validate_summary(s, PARK)
        with self.assertRaises(builds.Invalid):
            progression.validate_summary(summary(mode="proam", score=(40, 40), duration=900), PROAM)
        with self.assertRaises(builds.Invalid):
            progression.validate_summary(summary(mode="proam", score=(40, 38), duration=120), PROAM)

    def test_forfeit_pays_nothing(self):
        s = summary(score=(5, 9), winner=None)
        s["forfeit"] = True
        v = progression.validate_summary(s, PARK)
        self.assertEqual(v["winner"], 1)
        rw = progression.rewards(v, PARK, {})
        self.assertEqual((rw["vc"], rw["rep"], rw["badges"]), (0, 0, {}))

    def test_rep_tiers_are_monotonic(self):
        self.assertEqual(progression.rep_label(0), "Rookie 1")
        self.assertEqual(progression.rep_label(5), "Pro 1")
        self.assertEqual(progression.rep_label(20), "Legend")
        t = progression.REP_THRESHOLDS
        self.assertTrue(all(a < b for a, b in zip(t, t[1:])))
        self.assertEqual(progression.rep_level(t[7]), 7)
        self.assertEqual(progression.rep_level(t[7] - 1), 6)


class RewardTests(unittest.TestCase):
    def test_streak_multiplier_grows_with_the_streak(self):
        mults = [progression.streak_multiplier(k) for k in range(1, 14)]
        self.assertEqual(mults[0], 1.0)
        self.assertTrue(all(b > a for a, b in zip(mults[:11], mults[1:11])))
        self.assertEqual(mults[-1], 2.5)
        stats = {k: 0 for k in ("pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "reb", "oreb", "ast", "stl", "blk", "tov", "pf", "dunks", "ankles", "posters", "contested_makes", "greens", "alleyoops")}
        stats.update(pts=10, fgm=5, fga=9, ast=3, reb=4)
        summ = {"mode": "park", "winner": 0, "team": 0, "forfeit": False, "stats": stats}
        low = progression.rewards(summ, {"meta": {"streak": 0}}, {})
        high = progression.rewards(summ, {"meta": {"streak": 6}}, {})
        self.assertGreater(high["vc"], low["vc"]); self.assertGreater(high["rep"], low["rep"])
        self.assertEqual(high["streak_mult"], progression.streak_multiplier(7))

    def test_wheel_odds_and_tiers(self):
        import random
        self.assertEqual(sorted(progression.WHEEL_VC.values()), [500, 2500, 10000, 50000, 250000])
        self.assertAlmostEqual(sum(progression.WHEEL_ODDS.values()), 100.0)
        self.assertLess(progression.WHEEL_ODDS["vc250000"], 1)  # the jackpot is extremely rare
        rng, counts = random.Random(4), {}
        for _ in range(4000):
            r = progression.spin_wheel(rng, server_app.CATALOG, set())
            counts[r["kind"]] = counts.get(r["kind"], 0) + 1
            if r["item"]:
                self.assertEqual(server_app.CATALOG[r["item"]].get("exclusive"), "wheel")
        self.assertGreater(counts["vc500"], counts["vc2500"] > counts.get("vc50000", 0))
        everything = set(server_app.CATALOG)
        self.assertTrue(all(progression.spin_wheel(rng, server_app.CATALOG, everything)["item"] is None for _ in range(300)))


class LegacySaveTests(unittest.TestCase):
    def test_v02_database_migrates_without_losing_wallet_items_or_players(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "legacy.sqlite3"
            c = sqlite3.connect(p)
            c.executescript((ROOT / "server/migrations/001_initial.sql").read_text())
            c.executescript((ROOT / "server/migrations/002_court_settings.sql").read_text())
            c.execute("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)")
            c.execute("INSERT INTO schema_migrations VALUES(1,0)")
            c.execute("INSERT INTO schema_migrations VALUES(2,0)")
            c.execute("INSERT INTO accounts VALUES(?,?,?,?,?)", ("legacy", "oldplayer", "salt", "hash", 0))
            c.execute("INSERT INTO wallets VALUES(?,?)", ("legacy", 996500))
            c.execute("INSERT INTO ledger(account_id,delta,balance_after,kind,reference,created_at) VALUES(?,?,?,?,?,?)", ("legacy", 1000000, 1000000, "welcome_grant", "welcome:v1", 0))
            c.execute("INSERT INTO ledger(account_id,delta,balance_after,kind,reference,created_at) VALUES(?,?,?,?,?,?)", ("legacy", -3500, 996500, "store_purchase", "purchase:old", 1))
            c.execute("INSERT INTO inventory VALUES(?,?,?)", ("legacy", "jersey_coral", 1))
            old_char = {"id": "oldchar", "name": "Old Timer", "position": "PG", "style": "balanced", "height": 74, "weight": 185, "wingspan": 77,
                        "attributes": {k: 70 for k in builds.LEGACY_ATTRIBUTES}, "equipment": {"top": "jersey_coral", "bottom": "yard_shorts", "shoes": "yard_shoes", "release": "release_classic"},
                        "appearance": {"skin": "#a56945", "hair": "crop", "number": 16}}
            c.execute("INSERT INTO characters VALUES(?,?,?,?)", ("oldchar", "legacy", json.dumps(old_char), 0))
            c.execute("INSERT INTO matches(id,account_id,character_id,status,seed,state,result,created_at,updated_at,venue) VALUES(?,?,?,?,?,?,?,?,?,?)",
                      ("oldmatch", "legacy", "oldchar", "running", 16, "{}", None, 0, 0, "yard"))
            c.commit()
            c.close()
            svc = server_app.Service(p, dev_accounts=False)
            try:
                db = svc.db
                self.assertEqual(db.query("SELECT max(version) FROM schema_migrations")[0][0], 5)
                self.assertEqual(db.query("SELECT balance FROM wallets")[0][0], 996500)
                self.assertEqual(len(db.query("SELECT * FROM ledger WHERE kind='welcome_grant'")), 1)
                self.assertEqual(db.query("SELECT item_id FROM inventory")[0][0], "jersey_coral")
                self.assertEqual(db.query("SELECT status, mode FROM matches")[0][:], ("cancelled", "park"))
                char = json.loads(db.query("SELECT data FROM characters")[0][0])
                self.assertEqual(char["schema"], 3)
                self.assertEqual(len(char["attributes"]), len(builds.ATTRIBUTES))
                self.assertEqual(svc.profile("legacy")["characters"][0]["name"], "Old Timer")
            finally:
                svc.close()
            # reopening is a no-op
            svc = server_app.Service(p, dev_accounts=False)
            try:
                self.assertEqual(svc.db.query("SELECT count(*) FROM schema_migrations")[0][0], 5)
            finally:
                svc.close()


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "api.sqlite3")
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

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

    def test_full_player_journey(self):
        self.assertFalse(self.call("/api/config")["signed_in"])
        self.call("/api/me", expect=401)
        prof = self.call("/api/dev-account", {})
        self.assertEqual(prof["balance"], 1_000_000)
        self.assertTrue(self.call("/api/config")["signed_in"])
        build = {"name": "Test Hooper", "position": "SG", "archetype": "sharpshooter", "height": 77, "weight": 195, "wingspan": 80}
        preview = self.call("/api/build-preview", build)
        k = self.key()
        char = self.call("/api/characters", {"key": k, "build": build})["character"]
        self.assertEqual(self.call("/api/characters", {"key": k, "build": build})["character"]["id"], char["id"])  # idempotent replay
        self.assertEqual(char["attributes"], preview["attributes"])
        cid = char["id"]
        # upgrades
        up = self.call(f"/api/characters/{cid}/upgrade", {"key": self.key(), "max": True})
        self.assertEqual(up["balance"], 1_000_000 - up["cost"])
        self.assertEqual(up["character"]["attributes"], up["character"]["caps"])
        self.call(f"/api/characters/{cid}/upgrade", {"key": self.key(), "max": True}, expect=400)
        # store
        buy = self.call("/api/store/purchase", {"key": self.key(), "item_id": "jersey_coral", "character_id": cid})
        self.assertEqual(buy["balance"], up["balance"] - buy["cost"])
        self.call("/api/store/purchase", {"key": self.key(), "item_id": "jersey_black_gold", "character_id": cid}, expect=400)  # Rep locked
        self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "top", "item_id": "jersey_black_gold"}, expect=400)  # not owned
        eq = self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "top", "item_id": "jersey_coral"})
        self.assertEqual(eq["character"]["equipment"]["top"], "jersey_coral")
        self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": "shoes", "item_id": "jersey_coral"}, expect=400)  # wrong slot
        # affiliation is chosen once
        self.call(f"/api/characters/{cid}/affiliation", {"key": self.key(), "affiliation": "brick"})
        self.call(f"/api/characters/{cid}/affiliation", {"key": self.key(), "affiliation": "harbor"}, expect=400)
        # park game: early results are refused, then a legitimate result pays out once
        t = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "park", "venue": "brick", "format": 3, "target": 21})
        good = summary(pts=11, fgm=4, fga=9, tpm=3, tpa=5, ast=2, reb=3, duration=420)
        self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": good}, expect=400)
        old_slack = server_app.TIME_SLACK
        server_app.TIME_SLACK = 10_000
        try:
            ck = self.key()
            res = self.call(f"/api/matches/{t['id']}/complete", {"key": ck, "summary": good})
            again = self.call(f"/api/matches/{t['id']}/complete", {"key": ck, "summary": good})
            self.assertEqual(res, again)
            self.assertTrue(res["won"])
            self.assertGreater(res["vc"], 0)
            self.assertEqual(res["streak"], 1)
            # a second complete with a new key returns the stored result without paying again
            third = self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": good})
            self.assertEqual(third["balance"], res["balance"])
        finally:
            server_app.TIME_SLACK = old_slack
        self.assertEqual(self.call("/api/me")["balance"], res["balance"])
        # Pro-Am requires a team; team identity is validated
        self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "proam", "venue": "arena", "format": 5}, expect=400)
        self.call("/api/proam/team", {"key": self.key(), "team": {"name": "X", "abbr": "TOOLONG"}}, expect=400)
        team = self.call("/api/proam/team", {"key": self.key(), "team": {"name": "Night Shift", "abbr": "NS", "primary": "#C8322F", "secondary": "#111111", "logo": "star", "wood": "dark", "roster_seed": 77}})["team"]
        self.assertEqual((team["primary"], team["wins"]), ("#c8322f", 0))
        pt = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "proam", "venue": "arena", "format": 5, "quarter_len": 180})
        cancel = self.call(f"/api/matches/{pt['id']}/cancel", {})
        self.assertEqual(cancel["status"], "cancelled")
        # wallet ledger always reconciles with the balance
        w = self.call("/api/wallet")
        self.assertEqual(sum(tx["delta"] for tx in w["transactions"]), w["balance"])

    def test_cross_origin_and_bad_json_are_refused(self):
        req = urllib.request.Request(self.base + "/api/dev-account", method="POST", data=b"{}",
                                     headers={"Content-Type": "application/json", "Origin": "http://evil.example"})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(e.exception.code, 403)
        req = urllib.request.Request(self.base + "/api/dev-account", method="POST", data=b"{nope", headers={"Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(e.exception.code, 400)

    def test_daily_spin_boosts_and_exclusives(self):
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        prev, self.opener = self.opener, opener  # fresh account (dev account is shared per server)
        try:
            prof = self.call("/api/register", {"username": "spinner_" + uuid.uuid4().hex[:6], "password": "longpassword1"})
            bal0 = prof["balance"]
            self.assertEqual(prof["daily_spin"]["next_at"], 0)
            # exclusives are never sold and never handed out as free starters
            self.assertNotIn("wheel_jersey_aurora", prof["inventory"])
            build = {"name": "Spin Guy", "position": "PG", "archetype": "playmaker", "height": 74, "weight": 185, "wingspan": 76}
            cid = self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]
            self.call("/api/store/purchase", {"key": self.key(), "item_id": "wheel_jersey_aurora", "character_id": cid}, expect=400)
            k = self.key()
            r = self.call("/api/daily-spin", {"key": k})
            self.assertEqual(self.call("/api/daily-spin", {"key": k}), r)  # idempotent replay
            self.call("/api/daily-spin", {"key": self.key()}, expect=400)  # once per 24 h
            self.assertIn(r["kind"], progression.WHEEL_ODDS)
            self.assertEqual(progression.WHEEL_SEGMENTS[r["segment"]], r["kind"])
            prof = self.call("/api/me")
            if r["vc"]:
                self.assertEqual(prof["balance"], bal0 + r["vc"])
            else:
                self.assertIn(r["item"], prof["inventory"])
                slot = server_app.CATALOG[r["item"]]["slot"]
                self.call(f"/api/characters/{cid}/equip", {"key": self.key(), "slot": slot, "item_id": r["item"]})
            self.assertGreater(prof["daily_spin"]["next_at"], time.time() + 23 * 3600)
            # boosts: buy, stock limit, consumed one game per tip-off
            bal = prof["balance"]
            b = self.call("/api/boosts/purchase", {"key": self.key(), "character_id": cid, "category": "shooting", "games": 3})
            self.assertEqual(b["balance"], bal - progression.BOOST_PACKS[3])
            self.assertEqual(b["character"]["boosts"], {"shooting": 3})
            self.call("/api/boosts/purchase", {"key": self.key(), "character_id": cid, "category": "shooting", "games": 5})
            self.call("/api/boosts/purchase", {"key": self.key(), "character_id": cid, "category": "shooting", "games": 5}, expect=400)
            self.call("/api/boosts/purchase", {"key": self.key(), "character_id": cid, "category": "luck", "games": 1}, expect=400)
            t = self.call("/api/matches", {"key": self.key(), "character_id": cid, "mode": "park", "venue": "brick", "format": 1, "target": 11})
            self.assertEqual(t["meta"]["boosts"], ["shooting"])
            chars = {c["id"]: c for c in self.call("/api/me")["characters"]}
            self.assertEqual(chars[cid]["boosts"], {"shooting": 7})
        finally:
            self.opener = prev

    def test_locker_codes_and_ai_world(self):
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        prev, self.opener = self.opener, opener
        try:
            prof = self.call("/api/register", {"username": "locker_" + uuid.uuid4().hex[:6], "password": "longpassword1"})
            bal = prof["balance"]
            self.assertEqual(prof["locker_codes"], [])
            self.call("/api/locker-codes/redeem", {"key": self.key(), "code": "NOT-A-CODE"}, expect=400)
            vc = progression.LOCKER_CODES["HELP-I-NEED-VC"]["vc"]
            k = self.key()
            r = self.call("/api/locker-codes/redeem", {"key": k, "code": " help-i-need-vc "})  # case and spaces don't matter
            self.assertEqual(self.call("/api/locker-codes/redeem", {"key": k, "code": "HELP-I-NEED-VC"}), r)  # idempotent replay
            self.assertEqual((r["used"], r["max"], r["balance"]), (1, 3, bal + vc))
            for i in (2, 3):
                self.assertEqual(self.call("/api/locker-codes/redeem", {"key": self.key(), "code": "HELP-I-NEED-VC"})["used"], i)
            self.call("/api/locker-codes/redeem", {"key": self.key(), "code": "HELP-I-NEED-VC"}, expect=400)  # 3 per account
            prof = self.call("/api/me")
            self.assertEqual(prof["balance"], bal + 3 * vc)
            self.assertEqual(prof["locker_codes"][0]["used"], 3)
            # social: friends and squad persist; junk is dropped; the squad must be friends
            self.assertIsNone(prof["ai_world"])
            w = self.call("/api/ai-world", {"key": self.key(), "world": {"seed": 1234, "born": 1.7e12, "friends": ["ai-7", "ai-12", "nope", 5], "squad": ["ai-7", "ai-99"], "met": {"ai-7": {"games": 3, "with": 2, "vs": 1, "wins": True, "last": 1.5}, "x": 1}}})["world"]
            self.assertEqual(w, {"seed": 1234, "born": 1.7e12, "friends": ["ai-7", "ai-12"], "squad": ["ai-7"], "met": {"ai-7": {"games": 3, "with": 2, "vs": 1, "wins": 0, "last": 1.5}}})
            self.assertEqual(self.call("/api/me")["ai_world"], w)
            self.call("/api/ai-world", {"key": self.key(), "world": {"seed": -1}}, expect=400)
        finally:
            self.opener = prev

    def test_quit_and_ping_are_launcher_only(self):
        self.assertEqual(self.call("/api/ping"), {"ok": True})
        self.assertIsNotNone(self.service.last_ping)
        # a server started by hand (not by Afterhours16.exe) can't be stopped from a web page
        self.call("/api/quit", {}, expect=403)
        self.assertFalse(self.service.quit_requested)
        req = urllib.request.Request(self.base + "/api/quit", method="POST", data=b"{}",
                                     headers={"Content-Type": "application/json", "Origin": "http://evil.example"})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(e.exception.code, 403)

    def test_static_client_is_served_but_dev_pages_are_not(self):
        with urllib.request.urlopen(self.base + "/", timeout=10) as r:
            self.assertIn(b"AFTERHOURS", r.read().upper())
        with urllib.request.urlopen(self.base + "/js/main.js", timeout=10) as r:
            self.assertIn("javascript", r.headers["Content-Type"])
        for path in ("/dev/match-test.html", "/../server/app.py", "/js/../../data/afterhours.sqlite3"):
            with self.assertRaises(urllib.error.HTTPError, msg=path):
                urllib.request.urlopen(self.base + path, timeout=10)


if __name__ == "__main__":
    unittest.main()
