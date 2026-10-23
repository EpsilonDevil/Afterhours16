"""v0.4.8.9 qp4: the Gauntlet's engine version on the server's side (server/gauntlet.py ENGINE_VERSION). The service reads
it from the engine (deck/run.js, re-exported by deck/index.js), returns it from /api/gauntlet/start and records it in
the run's start; a client on other rules, or one that doesn't say (from before qp4), is told to update instead of
starting; a run started on the old rules (no
engine in its start, or 1) is paid by its counts (verified: false), never refused for it, and never replayed; a run on
this version goes through the replay check (here with fake replay answers: nothing depends on the new combat itself)
and, with Node, through the replay workers.

Run from the project root:  python3 -m unittest tests.test_v0489qp4_gauntlet_version -v
"""
import http.cookiejar
import json
import re
import shutil
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, gauntlet as G

try:
    from tests.test_v0489_gauntlet import counts, COMPLETE
except ImportError:
    from test_v0489_gauntlet import counts, COMPLETE

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
# (what a replay of COMPLETE answers: deck/replay.js counts)
REPLAYED = {"matchesWon": 19, "rivals": 3, "bosses": 3, "final": True, "turns": 140, "cardsPlayed": 600, "nonMatchNodes": 20, "phase": 3, "completed": True, "over": True}


class EngineVersion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "v.sqlite3", dev_accounts=False)
        cls.service.rate_limit = lambda ip, category: None
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.p = cls.player()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        G._pool.close()
        cls.tmp.cleanup()

    def setUp(self):
        self.calls = []
        self.answer = None
        self.old = (G.replay_check, G.replay_status)
        G.replay_status = lambda: {"on": True, "node": "node", "version": "v22.0.0", "why": None}

        def fake(start, choices):
            self.calls.append(start)
            return self.answer
        G.replay_check = fake

    def tearDown(self):
        G.replay_check, G.replay_status = self.old

    @classmethod
    def player(cls):
        p = type("P", (), {})()
        p.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        req = urllib.request.Request(cls.base + "/api/register", method="POST", data=json.dumps({"username": "ev_" + uuid.uuid4().hex[:6], "password": "longpassword1"}).encode(),
                                     headers={"Content-Type": "application/json"})
        with p.opener.open(req, timeout=30) as r:
            p.id = json.loads(r.read())["account"]["id"]
        return p

    def call(self, path, body=None, expect=200):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST", data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with self.p.opener.open(req, timeout=60) as r:
                status, out = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, out = e.code, json.loads(e.read() or b"null")
        self.assertEqual(status, expect, f"{path}: {out}")
        return out

    SEEDS = iter(range(5000, 10 ** 6))

    def start(self, **extra):
        seed = next(self.SEEDS)
        out = self.call("/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": seed, "player": {"id": f"starter-{seed}-0", "name": "S"}, "engine": G.ENGINE_VERSION, **extra})
        with self.service.db.transaction() as c:  # (played for an hour)
            c.execute("UPDATE gauntlet_runs SET started_at=started_at-3600 WHERE id=?", (out["run_id"],))
        return out

    def stored_start(self, rid):
        with self.service.db.transaction() as c:
            s = c.execute("SELECT start FROM gauntlet_runs WHERE id=?", (rid,)).fetchone()[0]
        return json.loads(s) if s else None

    def set_start(self, rid, start):
        with self.service.db.transaction() as c:
            c.execute("UPDATE gauntlet_runs SET start=? WHERE id=?", (None if start is None else json.dumps(start), rid))

    def finish(self, rid, expect=200, **extra):
        return self.call("/api/gauntlet/finish", {"run_id": rid, "summary": counts(**COMPLETE), **extra}, expect)

    def test_the_version_is_read_from_the_engine(self):
        src = (ROOT / "client/js/deck/run.js").read_text()
        self.assertEqual(G.ENGINE_VERSION, int(re.search(r"^export const ENGINE_VERSION = (\d+);", src, re.M).group(1)))
        self.assertIn("export { ENGINE_VERSION } from './run.js';", (ROOT / "client/js/deck/index.js").read_text())
        self.assertEqual(G.read_engine_version(Path(self.tmp.name) / "missing.js"), G.ENGINE_FALLBACK)
        if NODE:
            r = subprocess.run([NODE, "--input-type=module", "-e", "import { ENGINE_VERSION } from './client/js/deck/index.js'; console.log(ENGINE_VERSION);"],
                               capture_output=True, timeout=30, cwd=str(ROOT))
            self.assertEqual(int(r.stdout.decode().strip()), G.ENGINE_VERSION, r.stderr.decode())

    def test_start_returns_and_records_it(self):
        st = self.start()
        self.assertEqual(st["engine"], G.ENGINE_VERSION)
        self.assertEqual(self.stored_start(st["run_id"])["engine"], G.ENGINE_VERSION)

    def test_a_client_on_other_rules_is_told_to_update(self):
        before = self.call("/api/gauntlet/profile")["stats"]["started"]
        body = {"seed": 77, "player": {"id": "starter-77-0", "name": "S"}}
        # (no engine at all: every client from before qp4, whose run's finish couldn't be checked)
        for extra in ({}, *({"engine": v} for v in (1, G.ENGINE_VERSION + 1, str(G.ENGINE_VERSION), True, None, 2.0))):
            out = self.call("/api/gauntlet/start", {"key": uuid.uuid4().hex, **body, **extra}, expect=400)
            self.assertEqual(out["error"], "Update the game to play the Gauntlet.", extra)
        self.assertEqual(self.call("/api/gauntlet/profile")["stats"]["started"], before, "no run started")

    def test_an_old_rules_run_is_paid_by_its_counts_never_refused(self):
        self.answer = {"ok": False, "counts": None, "hash": None, "error": "old engine (1, this is 2)", "at": -1}  # (what a replay would say)
        for old in ("no engine", 1, "none at all"):
            st = self.start()
            start = self.stored_start(st["run_id"])
            if old == "no engine":
                start.pop("engine")
                self.set_start(st["run_id"], start)
            elif old == 1:
                self.set_start(st["run_id"], {**start, "engine": 1})
            else:
                self.set_start(st["run_id"], None)  # (a run started before replay checks)
            n = len(G.REPLAY_LOG)
            out = self.finish(st["run_id"], choices=[["play", 9, 0]] if old == 1 else None)  # (a log or none: never asked for, never replayed)
            self.assertEqual((out["verified"], out["completed"], out["vc"]), (False, True, 7280), old)
            if old != "none at all":
                self.assertTrue(any(st["run_id"] in m and "engine 1" in m for m in list(G.REPLAY_LOG)[n:]), old)
        self.assertEqual(self.calls, [], "never replayed")

    def test_a_run_on_this_version_is_replayed(self):
        st = self.start()
        self.answer = {"ok": True, "counts": dict(REPLAYED), "hash": "h" * 16, "error": None, "at": None}
        out = self.finish(st["run_id"], choices=[["end"]])
        self.assertTrue(out["verified"])
        self.assertEqual(self.calls[-1]["engine"], G.ENGINE_VERSION, "replayed from the start it was recorded with")
        st2 = self.start()
        self.answer = {"ok": False, "counts": None, "hash": None, "error": "not your card", "at": 3}
        out = self.finish(st2["run_id"], expect=409, choices=[["end"]])
        self.assertEqual(out["replay"]["at"], 3)
        self.finish(st2["run_id"], expect=400)  # (and its choices are needed)

    @unittest.skipUnless(NODE, "Node.js isn't installed")
    def test_through_the_replay_workers(self):
        G.replay_check, G.replay_status = self.old
        seen = Path(self.tmp.name) / "seen.txt"
        fake = Path(self.tmp.name) / "fake_worker.mjs"
        fake.write_text("import fs from 'node:fs'; import rl from 'node:readline';\n"
                        "rl.createInterface({ input: process.stdin }).on('line', l => { const m = JSON.parse(l);\n"
                        "  fs.appendFileSync(%r, String(m.start.engine) + '\\n');\n"
                        "  console.log(JSON.stringify({ id: m.id, rss: 1, ok: true, counts: %s, hash: 'fake', error: null, at: null })); });\n"
                        % (str(seen), json.dumps(REPLAYED)))
        old = G.WORKER
        G.WORKER = fake
        G._pool.close()
        try:
            out = self.finish(self.start()["run_id"], choices=[["end"]])
            self.assertTrue(out["verified"])
            st = self.start()
            start = self.stored_start(st["run_id"])
            start.pop("engine")
            self.set_start(st["run_id"], start)
            self.assertFalse(self.finish(st["run_id"], choices=[["end"]])["verified"])
        finally:
            G.WORKER = old
            G._pool.close()
        self.assertEqual(seen.read_text().split(), [str(G.ENGINE_VERSION)], "only the run on this version reached a worker")


if __name__ == "__main__":
    unittest.main()
