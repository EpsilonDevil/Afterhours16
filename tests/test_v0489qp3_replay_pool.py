"""v0.4.8.9 qp3: the long-running replay workers (server/verify/replay_worker.mjs, server/gauntlet.py ReplayPool). A
check is answered by a warm worker exactly as the one-off helper answers it (honest, tampered and cut-short logs, in any
order, from several threads); a worker that runs over is killed and the check falls back to the count checks; one that
won't start, crashes or answers garbage falls back to the one-off helper; workers are recycled after WORKER_REQUESTS;
RIMRIFT_REPLAY_POOL=0 turns them off; the worker runs in the same sandbox.

Needs Node.js on PATH (runs are recorded with tests/fixtures/gauntlet_play.mjs). Skipped without it.
Run from the project root:  python3 -m unittest tests.test_v0489qp3_replay_pool -v
"""
import json
import os
import random
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from server import gauntlet as G

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def record(seed):
    r = subprocess.run([NODE, str(ROOT / "tests/fixtures/gauntlet_play.mjs")], input=json.dumps({"start": {"seed": seed, "world": {"aiSeed": 777, "chars": {}}}}).encode(),
                       capture_output=True, timeout=60, cwd=str(ROOT))
    assert r.returncode == 0, r.stderr.decode()
    rec = json.loads(r.stdout.decode().splitlines()[-1])
    return {"seed": seed, "player": {"id": f"starter-{seed}-0", "converted": False}, "world": {"aiSeed": 777, "chars": {}}, "unlocks": None}, rec["log"]


def spawned(start, choices):
    """The one-off helper's answer (the pool off)."""
    os.environ["RIMRIFT_REPLAY_POOL"] = "0"
    try:
        return G.replay_check(start, choices)
    finally:
        os.environ.pop("RIMRIFT_REPLAY_POOL", None)


@unittest.skipUnless(NODE, "Node.js isn't installed")
class ReplayPool(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        rnd = random.Random(9)
        cls.cases = []
        for seed in (4100, 4101, 4102):
            start, log = record(seed)
            bad = [list(c) for c in log]
            bad[rnd.randrange(len(bad))] = ["play", 9, 0]
            cls.cases += [(start, log), (start, bad), (start, log[:-2])]
        cls.cases.append(({"seed": 5, "player": {"id": "nope"}, "world": None, "unlocks": None}, [["node", "1-1-1"]]))
        cls.want = [spawned(*c) for c in cls.cases]

    @classmethod
    def tearDownClass(cls):
        G._pool.close()
        cls.tmp.cleanup()

    def setUp(self):
        G._pool.close()

    def test_a_worker_answers_as_the_one_off_helper_in_any_order(self):
        self.assertTrue(any(w["ok"] for w in self.want) and any(not w["ok"] for w in self.want))
        before = G.pool_stats()
        got = {}

        def go(k):
            order = list(range(len(self.cases)))
            random.Random(k).shuffle(order)
            for i in order:
                got.setdefault(i, []).append(G.replay_check(*self.cases[i]))
        ts = [threading.Thread(target=go, args=(k,)) for k in range(3)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        for i, w in enumerate(self.want):
            self.assertEqual(got[i], [w] * 3, i)
        st = G.pool_stats()
        self.assertEqual(st["checks"] - before["checks"], 3 * len(self.cases))
        self.assertLessEqual(st["started"] - before["started"], G.POOL_SIZE, "warm workers, reused")
        self.assertLessEqual(st["idle"], G.POOL_SIZE)

    def test_recycled_after_its_requests(self):
        old = G.WORKER_REQUESTS
        G.WORKER_REQUESTS = 2
        try:
            before = G.pool_stats()
            for c, w in zip(self.cases[:5], self.want[:5]):
                self.assertEqual(G.replay_check(*c), w)
            st = G.pool_stats()
            self.assertEqual(st["started"] - before["started"], 3)
        finally:
            G.WORKER_REQUESTS = old

    def test_a_worker_that_runs_over_is_killed_and_the_check_falls_back(self):
        d = Path(self.tmp.name)
        pidf = d / "worker.pid"
        fake = d / "slow_worker.mjs"
        fake.write_text("import fs from 'node:fs'; fs.writeFileSync(%r, String(process.pid)); setInterval(() => {}, 1000);\n" % str(pidf))
        old = (G.WORKER, G.REPLAY_TIMEOUT)
        G.WORKER, G.REPLAY_TIMEOUT = fake, 1.0
        try:
            t0 = time.time()
            with self.assertRaises(G.ReplayUnavailable) as e:
                G.replay_check(*self.cases[0])
            self.assertLess(time.time() - t0, 3)
        finally:
            G.WORKER, G.REPLAY_TIMEOUT = old
        self.assertIn("timed out", str(e.exception))
        time.sleep(0.2)
        with self.assertRaises(ProcessLookupError):
            os.kill(int(pidf.read_text()), 0)
        self.assertEqual(G.pool_stats()["idle"], 0)

    def test_a_worker_that_fails_falls_back_to_the_one_off_helper(self):
        d = Path(self.tmp.name)
        fake = d / "bad_worker.mjs"
        for body in ("process.exit(3);", "process.stdin.on('data', () => console.log('not json'));",
                     "process.stdin.on('data', () => console.log(JSON.stringify({ id: -1, ok: true })));"):
            fake.write_text(body + "\n")
            old = G.WORKER
            G.WORKER = fake
            try:
                n = len(G.REPLAY_LOG)
                self.assertEqual(G.replay_check(*self.cases[0]), self.want[0], body)
                self.assertTrue(any("one-off helper" in m for m in list(G.REPLAY_LOG)[n:]), body)
            finally:
                G.WORKER = old
        G.WORKER = Path(self.tmp.name) / "missing.mjs"
        try:
            self.assertEqual(G.replay_check(*self.cases[1]), self.want[1], "a worker that won't load")
        finally:
            G.WORKER = old

    def test_turned_off(self):
        before = G.pool_stats()["started"]
        self.assertEqual(spawned(*self.cases[0]), self.want[0])
        self.assertEqual(G.pool_stats()["started"], before)

    def test_the_line_protocol_and_its_caps(self):
        p = subprocess.Popen([NODE, "--disallow-code-generation-from-strings", str(G.WORKER), "30"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, cwd=str(ROOT), env=G._env())
        try:
            start, log = self.cases[0]
            big = b'{"id":1,"kind":"gauntlet","pad":"' + b"x" * (300 * 1024) + b'"}\n'
            p.stdin.write(big + json.dumps({"id": 2, "kind": "gauntlet", "start": start, "choices": log}).encode() + b"\n" + b'{"id":3,"kind":"nope"}\n')
            p.stdin.flush()
            a, b, c = (json.loads(p.stdout.readline()) for _ in range(3))
            self.assertEqual((a["id"], a["error"]), (None, "input too big"))
            self.assertEqual(b["id"], 2)
            self.assertEqual(G._answer(b), self.want[0])
            self.assertEqual((c["id"], c["error"]), (3, "unknown kind"))
            p.stdin.close()
            self.assertEqual(p.wait(timeout=5), 0, "exits when its input closes")
        finally:
            if p.poll() is None:
                p.kill()
            p.stdout.close()

    def test_the_sandbox(self):
        G.replay_check(*self.cases[0])
        with G._pool.lock:
            w = G._pool.idle[0]
        args = w.proc.args
        self.assertEqual(args[1:4], [f"--max-old-space-size={G.REPLAY_HEAP_MB}", "--disallow-code-generation-from-strings", str(G.WORKER)])
        if os.path.exists(f"/proc/{w.proc.pid}/limits"):
            lim = Path(f"/proc/{w.proc.pid}/limits").read_text()
            self.assertRegex(lim, r"Max cpu time\s+%d\s" % (G.REPLAY_CPU_SECS * G.WORKER_REQUESTS))
            self.assertRegex(lim, r"Max data size\s+%d\s" % G.REPLAY_DATA_BYTES)
            self.assertRegex(lim, r"Max core file size\s+0\s")
            env = Path(f"/proc/{w.proc.pid}/environ").read_bytes().split(b"\0")
            self.assertTrue({e.split(b"=")[0].decode() for e in env if e} <= {"PATH", "NODE_OPTIONS", "NODE_NO_WARNINGS", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP"})
        src = (ROOT / "server/gauntlet.py").read_text()
        self.assertIn('"shell": False, "bufsize": 0', src)


if __name__ == "__main__":
    unittest.main()
