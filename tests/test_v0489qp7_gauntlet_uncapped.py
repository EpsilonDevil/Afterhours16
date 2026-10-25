"""v0.4.8.9 qp7: the Gauntlet pays a run exactly what it earned (no cap per run, docs/GAUNTLET.md §11), its one limit
300 VC a real minute; and the engine's version (now 3, the hand rule) as the service reads it from the engine, with
runs started on an older version (2, or 1) paid by their counts and never replayed. Nothing here depends on the new
hand rule: the replay answers are fakes, as in the qp4 tests.

Run from the project root:  python3 -m unittest tests.test_v0489qp7_gauntlet_uncapped -v
"""
import http.cookiejar
import json
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, gauntlet as G

ROOT = Path(__file__).resolve().parents[1]
# a completed run that won more than the old 8,000 cap's worth: 21 matches, 5 Rivals, 3 bosses and the Final
BIG = {"completed": True, "phaseReached": 4, "nodesCleared": 43, "matchesWon": 30, "rivals": 5, "bosses": 3, "durationTurns": 300,
       "summary": {"final": True, "cardsPlayed": 900, "nonMatchNodes": 13}}
BIG_RAW = 21 * 140 + 5 * 300 + 3 * 900 + 2000
REPLAYED = {"matchesWon": 30, "rivals": 5, "bosses": 3, "final": True, "turns": 300, "cardsPlayed": 900, "nonMatchNodes": 13, "phase": 3, "completed": True, "over": True}


class Uncapped(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "u.sqlite3", dev_accounts=False)
        cls.service.rate_limit = lambda ip, category: None
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        cls.call_(None, "/api/register", {"username": "uc_" + uuid.uuid4().hex[:6], "password": "longpassword1"})

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    @classmethod
    def call_(cls, self, path, body=None, expect=200):
        req = urllib.request.Request(cls.base + path, method="GET" if body is None else "POST", data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with cls.opener.open(req, timeout=60) as r:
                status, out = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, out = e.code, json.loads(e.read() or b"null")
        assert status == expect, f"{path}: {status} {out}"
        return out

    def call(self, path, body=None, expect=200):
        return self.call_(self, path, body, expect)

    def setUp(self):
        self.calls, self.answer = [], None
        self.old = (G.replay_check, G.replay_status)
        G.replay_status = lambda: {"on": True, "node": "node", "version": "v22.0.0", "why": None}

        def fake(start, choices):
            self.calls.append(start)
            return self.answer
        G.replay_check = fake

    def tearDown(self):
        G.replay_check, G.replay_status = self.old

    SEEDS = iter(range(7000, 10 ** 6))

    def start(self, secs=3600, engine=None):
        seed = next(self.SEEDS)
        out = self.call("/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": seed, "player": {"id": f"starter-{seed}-0", "name": "S"}, "engine": G.ENGINE_VERSION})
        with self.service.db.transaction() as c:
            c.execute("UPDATE gauntlet_runs SET started_at=started_at-? WHERE id=?", (secs, out["run_id"]))
            if engine is not None:  # (a run started before the service took this engine version)
                start = json.loads(c.execute("SELECT start FROM gauntlet_runs WHERE id=?", (out["run_id"],)).fetchone()[0])
                start["engine"] = engine
                c.execute("UPDATE gauntlet_runs SET start=? WHERE id=?", (json.dumps(start), out["run_id"]))
        return out["run_id"]

    def finish(self, rid, expect=200):
        return self.call("/api/gauntlet/finish", {"run_id": rid, "summary": BIG, "choices": [["end"]]}, expect)

    def test_no_cap_per_run(self):
        self.assertGreater(BIG_RAW, 8000)
        self.answer = {"ok": True, "counts": dict(REPLAYED), "hash": "h" * 16, "error": None, "at": None}
        bal0 = self.call("/api/me")["balance"]
        out = self.finish(self.start())
        self.assertEqual((out["verified"], out["vc_parts"]["raw"], out["vc"]), (True, BIG_RAW, BIG_RAW), "all of it, verified")
        self.assertEqual(self.call("/api/me")["balance"], bal0 + BIG_RAW)
        self.assertNotIn("cap", self.call("/api/gauntlet/profile")["rules"])
        self.assertEqual(self.call("/api/gauntlet/profile")["rules"]["vcPerMin"], 300)

    def test_the_minute_limit_still_holds(self):
        self.answer = {"ok": True, "counts": dict(REPLAYED), "hash": "h" * 16, "error": None, "at": None}
        out = self.finish(self.start(secs=20 * 60))  # (20 real minutes: 6,000 at the most)
        self.assertEqual((out["vc_parts"]["raw"], out["vc"], out["cap"]), (BIG_RAW, 6000, 6000))

    def test_the_version_follows_the_engine(self):
        src = (ROOT / "client/js/deck/run.js").read_text()
        self.assertEqual(G.ENGINE_VERSION, int(re.search(r"^export const ENGINE_VERSION = (\d+);", src, re.M).group(1)))
        f = Path(self.tmp.name) / "run.js"
        f.write_text("// an engine\nexport const ENGINE_VERSION = 3;\n")
        self.assertEqual(G.read_engine_version(f), 3)
        out = self.call("/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": 77, "player": {"id": "starter-77-0", "name": "S"}, "engine": G.ENGINE_VERSION - 1}, expect=400)
        self.assertEqual(out["error"], "Update the game to play the Gauntlet.")

    def test_runs_started_on_an_older_version_are_paid_by_their_counts(self):
        self.answer = {"ok": False, "counts": None, "hash": None, "error": "old engine", "at": -1}  # (what a replay would say)
        for v in sorted({1, G.ENGINE_VERSION - 1}):
            n = len(G.REPLAY_LOG)
            out = self.finish(self.start(engine=v))
            self.assertEqual((out["verified"], out["completed"], out["vc"]), (False, True, BIG_RAW), v)
            self.assertTrue(any(f"engine {v}, this is {G.ENGINE_VERSION}" in m for m in list(G.REPLAY_LOG)[n:]), v)
        self.assertEqual(self.calls, [], "never replayed")
        # and one on this version goes through the replay
        self.answer = {"ok": True, "counts": dict(REPLAYED), "hash": "h" * 16, "error": None, "at": None}
        self.assertTrue(self.finish(self.start())["verified"])
        self.assertEqual(self.calls[-1]["engine"], G.ENGINE_VERSION)


if __name__ == "__main__":
    unittest.main()
