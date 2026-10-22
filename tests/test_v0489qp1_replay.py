"""v0.4.8.9 qp1: Gauntlet replay checks through the optional Node helper (server/verify/gauntlet_replay.mjs,
server/gauntlet.py replay_check). An honest recorded run is replayed and paid from what the replay earned; a log that
doesn't replay, or a summary that claims more than it, is refused (409); without Node, or when the helper fails or
runs over its time (killed), the payout falls back to the count checks and the run is recorded as not verified. The
run's start (seed, player, world, unlocks) is kept when it starts and sent back, so the client starts from the same.

Needs Node.js on PATH (the fixture plays a run with tools/deck_sim.mjs; the helper replays it). Skipped without it.
Run from the project root:  python3 -m unittest tests.test_v0489qp1_replay -v
"""
import http.cookiejar
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, gauntlet as G, builds

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def play(start):
    """An honest run from this start, recorded: {log, over} (tests/fixtures/gauntlet_play.mjs)."""
    r = subprocess.run([NODE, str(ROOT / "tests/fixtures/gauntlet_play.mjs")], input=json.dumps({"start": start}).encode(), capture_output=True, timeout=60, cwd=str(ROOT))
    assert r.returncode == 0, r.stderr.decode()
    return json.loads(r.stdout.decode().splitlines()[-1])


@unittest.skipUnless(NODE, "Node.js isn't installed")
class ReplayChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "r.sqlite3", dev_accounts=False)
        cls.service.rate_limit = lambda ip, category: None
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.p = cls.player()
        # one honest recorded run, over (completed or not): its seed, its log and its summary
        for seed in range(4100, 4140):
            st = cls.start_run(cls.p, seed)
            rec = play({"seed": seed, "world": st["world"]})
            if rec["over"]:
                cls.seed, cls.rec, cls.first = seed, rec, st
                break
        else:
            raise AssertionError("no finished run among the seeds")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    @classmethod
    def player(cls):
        p = type("P", (), {})()
        p.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        p.name = "rp_" + uuid.uuid4().hex[:6]
        req = urllib.request.Request(cls.base + "/api/register", method="POST", data=json.dumps({"username": p.name, "password": "longpassword1"}).encode(), headers={"Content-Type": "application/json"})
        with p.opener.open(req, timeout=30) as r:
            p.id = json.loads(r.read())["account"]["id"]
        return p

    @classmethod
    def raw(cls, p, path, body=None):
        req = urllib.request.Request(cls.base + path, method="GET" if body is None else "POST", data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with p.opener.open(req, timeout=60) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def call(self, p, path, body=None, expect=200):
        status, out = self.raw(p, path, body)
        self.assertEqual(status, expect, f"{path}: {out}")
        return out

    @classmethod
    def start_run(cls, p, seed):
        status, out = cls.raw(p, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": seed, "player": {"id": f"starter-{seed}-0", "name": "S"}})
        assert status == 200, out
        with cls.service.db.transaction() as c:  # (played for an hour)
            c.execute("UPDATE gauntlet_runs SET started_at=started_at-3600 WHERE id=?", (out["run_id"],))
        return out

    def finish(self, run_id, summary=None, choices="log", expect=200):
        body = {"run_id": run_id, "summary": summary or self.rec["over"]}
        if choices is not None:
            body["choices"] = self.rec["log"] if choices == "log" else choices
        return self.call(self.p, "/api/gauntlet/finish", body, expect)

    def row(self, run_id):
        with self.service.db.transaction() as c:
            return dict(c.execute("SELECT status, verified, replay_hash, start FROM gauntlet_runs WHERE id=?", (run_id,)).fetchone())

    def test_the_start_carries_the_world_and_unlocks_the_replay_starts_from(self):
        st = self.first
        ai = self.service.shared_world()["seed"]
        self.assertEqual((st["world"]["aiSeed"], st["world"]["chars"], st["unlocks"], st["replay"]), (ai, {}, None, True))
        start = json.loads(self.row(st["run_id"])["start"])
        self.assertEqual(start, {"seed": self.seed, "player": {"id": f"starter-{self.seed}-0", "converted": False}, "world": st["world"], "unlocks": None})

    def test_an_honest_run_is_verified_and_paid_from_its_replay(self):
        st = self.start_run(self.p, self.seed)
        bal0 = self.call(self.p, "/api/me")["balance"]
        out = self.finish(st["run_id"])
        over = self.rec["over"]
        self.assertTrue(out["verified"])
        self.assertEqual((out["matchesWon"], out["completed"]), (over["matchesWon"], over["completed"]))
        want = G.run_vc({"matchesWon": over["matchesWon"], "rivals": over["rivals"], "bosses": over["bosses"], "final": over["summary"]["final"], "completed": over["completed"]})["raw"]
        self.assertEqual(out["vc"], min(want, G.RUN_CAP))
        self.assertEqual(self.call(self.p, "/api/me")["balance"], bal0 + out["vc"])
        row = self.row(st["run_id"])
        self.assertEqual(row["verified"], 1)
        self.assertTrue(row["replay_hash"])
        again = self.finish(st["run_id"])
        self.assertEqual((again["repeat"], again["verified"], again["vc"]), (True, True, out["vc"]), "once")

    def test_a_tampered_log_is_refused(self):
        st = self.start_run(self.p, self.seed)
        bad = [list(c) for c in self.rec["log"]]
        i = next(k for k, c in enumerate(bad) if c[0] == "play")
        bad[i] = ["play", 9, 0]  # (a card that isn't in the hand)
        status, out = self.raw(self.p, "/api/gauntlet/finish", {"run_id": st["run_id"], "summary": self.rec["over"], "choices": bad})
        self.assertEqual(status, 409, out)
        self.assertEqual(out["replay"]["at"], i)
        self.assertIn("doesn't replay", out["error"])
        self.assertTrue(any(st["run_id"] in m and f"at choice {i}" in m for m in G.REPLAY_LOG), "logged with where and why")
        self.assertEqual(self.row(st["run_id"])["status"], "running", "nothing paid; still open")
        # a log cut short: the run isn't over
        status, out = self.raw(self.p, "/api/gauntlet/finish", {"run_id": st["run_id"], "summary": self.rec["over"], "choices": self.rec["log"][:-3]})
        self.assertEqual(status, 409, out)

    def test_a_summary_claiming_other_counts_is_refused(self):
        st = self.start_run(self.p, self.seed)
        over = json.loads(json.dumps(self.rec["over"]))
        if over["rivals"]:
            over["rivals"] -= 1
        else:
            over["rivals"] += 1
            over["matchesWon"] += 1
            over["nodesCleared"] += 1
        status, out = self.raw(self.p, "/api/gauntlet/finish", {"run_id": st["run_id"], "summary": over, "choices": self.rec["log"]})
        self.assertEqual(status, 409, out)
        self.assertIn("rivals", out["replay"]["diff"])

    def test_choices_are_required_when_it_can_replay(self):
        st = self.start_run(self.p, self.seed)
        self.finish(st["run_id"], choices=None, expect=400)

    def test_no_node_falls_back_unverified(self):
        st = self.start_run(self.p, self.seed)
        old = os.environ.get("RIMRIFT_NODE")
        os.environ["RIMRIFT_NODE"] = "/nonexistent/node"
        try:
            self.assertFalse(G.replay_status()["on"])
            out = self.finish(st["run_id"])
        finally:
            if old is None:
                os.environ.pop("RIMRIFT_NODE", None)
            else:
                os.environ["RIMRIFT_NODE"] = old
        self.assertFalse(out["verified"])
        self.assertEqual(out["matchesWon"], self.rec["over"]["matchesWon"], "paid by the counts")
        self.assertEqual(self.row(st["run_id"])["verified"], 0)
        # turned off the same way
        os.environ["RIMRIFT_REPLAY"] = "0"
        try:
            self.assertEqual(G.replay_status()["why"], "turned off (RIMRIFT_REPLAY=0)")
            self.assertIn("off", G.replay_banner())
        finally:
            os.environ.pop("RIMRIFT_REPLAY", None)
        self.assertIn("on (Node.js v", G.replay_banner())

    def test_a_helper_that_runs_over_is_killed_and_falls_back(self):
        d = Path(self.tmp.name)
        pidf = d / "fake.pid"
        fake = d / "slow_helper.mjs"
        fake.write_text("import fs from 'node:fs'; fs.writeFileSync(%r, String(process.pid)); setInterval(() => {}, 1000);\n" % str(pidf))
        st = self.start_run(self.p, self.seed)
        old = (G.HELPER, G.REPLAY_TIMEOUT)
        G.HELPER, G.REPLAY_TIMEOUT = fake, 1.0
        try:
            t0 = time.time()
            out = self.finish(st["run_id"])
            took = time.time() - t0
        finally:
            G.HELPER, G.REPLAY_TIMEOUT = old
        self.assertFalse(out["verified"])
        self.assertLess(took, 5)
        self.assertTrue(any(st["run_id"] in m and "timed out" in m for m in G.REPLAY_LOG))
        pid = int(pidf.read_text())
        time.sleep(0.2)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        # a helper that crashes, or answers garbage, falls back too
        for body in ("process.exit(3);", "console.log('not json');", "console.log(JSON.stringify({ ok: true, counts: { matchesWon: 'lots' } }));"):
            fake.write_text(body + "\n")
            G.HELPER = fake
            try:
                with self.assertRaises(G.ReplayUnavailable):
                    G.replay_check(json.loads(self.row(st["run_id"])["start"]), self.rec["log"])
            finally:
                G.HELPER = old[0]

    def test_an_oversized_log_is_refused_before_anything_starts(self):
        start = json.loads(self.row(self.first["run_id"])["start"])
        spawned = []
        old = G._spawn
        G._spawn = lambda *a, **k: spawned.append(a) or old(*a, **k)
        try:
            with self.assertRaises(builds.Invalid):
                G.replay_check(start, [["play", 0, 0]] * 15000)
        finally:
            G._spawn = old
        self.assertEqual(spawned, [], "never spawned")
        # (and the route's own body cap)
        status, out = self.raw(self.p, "/api/gauntlet/finish", {"run_id": self.first["run_id"], "summary": self.rec["over"], "choices": [["play", 0, 0]] * 15000})
        self.assertEqual(status, 413, out)

    def test_the_sandbox(self):
        env = G._env()
        self.assertTrue(set(env) <= {"PATH", "NODE_OPTIONS", "NODE_NO_WARNINGS", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP"}, "a minimal environment: no settings, no secrets")
        self.assertEqual(env["NODE_OPTIONS"], "")
        self.assertEqual((G.REPLAY_PARALLEL, G.REPLAY_TIMEOUT, G.REPLAY_MAX_IN), (2, 5.0, 160 * 1024))
        src = (ROOT / "server/gauntlet.py").read_text()
        self.assertIn('"shell": False', src)
        self.assertIn("resource.RLIMIT_CPU", src)
        self.assertIn("resource.RLIMIT_DATA", src)
        helper = (ROOT / "server/verify/gauntlet_replay.mjs").read_text()
        self.assertIn("import { replay, MAX_CHOICES } from '../../client/js/deck/index.js';", helper)
        self.assertIn("done({ ok: !!r.ok, counts: r.counts || null, hash: r.hash ?? null, error: r.error ?? null, at: r.at ?? null });", helper)


if __name__ == "__main__":
    unittest.main()
