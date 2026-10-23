# The replay workers (v0.4.8.9 qp3)

The server checks some results by running the game's own deterministic code in Node.js. Today that's the Gauntlet:
a run's payout is replayed from its choices. Once the sim is ported, park and Pro-Am results can be checked the same
way. This page covers how the workers run, the protocol they speak, and how to add a new kind of check. The operator's
side (settings, fallbacks, numbers) is in [DEPLOYMENT.md](DEPLOYMENT.md).

## The pieces

- `server/verify/replay_worker.mjs` is the long-running worker. It reads requests on stdin and writes answers on stdout,
  one JSON object per line, one request at a time. Its `KINDS` table maps a kind to the function that answers it.
- `server/gauntlet.py`:
  - `ReplayPool`, kept in `_pool`, holds up to `POOL_SIZE` (2) idle workers and starts them when they're needed.
  - `_Worker` is one worker process. It owns the request deadline, the answer cap and the reader thread.
  - `replay_check()` is what the finish route calls. It checks the input size, takes one of the `REPLAY_PARALLEL` slots,
    asks the pool, and falls back if it has to. `_answer()` checks the shape of the answer for every path.
- `server/verify/gauntlet_replay.mjs` is the one-off helper from qp1, one `node` process per check. It's the fallback
  when no worker can answer, and it's used directly when `RIMRIFT_REPLAY_POOL=0` or when `HELPER` points somewhere else.

## The protocol

Each request is one line, at most 200 KB. The server's own input cap, `REPLAY_MAX_IN` (160 KB), is checked before
anything is sent.

```
{"id": 17, "kind": "gauntlet", "start": {...}, "choices": [[...], ...]}
```

Each answer is one line, at most `REPLAY_MAX_OUT` (64 KB) as it's read:

```
{"id": 17, "rss": 61234176, "ok": true, "counts": {...}, "hash": "…", "error": null, "at": null}
```

- `id` is the request's own number. An answer with any other `id` fails the check, and the worker is replaced.
- `rss` is the worker's memory. Above `WORKER_RSS` the worker is replaced after this answer.
- Everything else is the kind's answer, field for field what the one-off helper would print for the same input.
- Garbage, a line that's too long, and an unknown kind are answered with `id: null` or `error: "unknown kind"`. The
  worker keeps serving after each.
- An exception inside a kind isn't caught: the worker dies, and the check goes to the one-off helper, which fails the
  same way. That's how the qp1 helper behaves too.
- The worker exits when stdin closes, which happens when the service exits or kills it. It also exits after its idle
  time (`argv[2]` seconds, `WORKER_IDLE`, 300 s).

## Limits (the same sandbox as the one-off helper)

- **Process:** no shell, and a minimal environment (`_env()`: PATH, plus what node needs on Windows). The repository is
  the working folder.
- **Node flags:** `--max-old-space-size=160` and `--disallow-code-generation-from-strings`.
- **Linux and macOS rlimits:**
  - 256 MB of data memory, no core files, no files over 1 MB;
  - CPU-seconds of `REPLAY_CPU_SECS × WORKER_REQUESTS`. One check is bounded by `REPLAY_TIMEOUT` (5 s of wall clock),
    after which the worker is killed and the check goes to the count checks.
- **Recycling:** a worker is replaced after `WORKER_REQUESTS` (100) checks, above `WORKER_RSS` (200 MB), when it dies,
  and when it's within 10 s of its idle exit.
- **No shared state:**
  - each request is parsed fresh, and nothing from one request is kept for the next;
  - the engine's module caches only hold what's derived from its tables or from a seed: card definitions, and the AI
    world for a seed;
  - these are the same caches the browser keeps between runs, so a warm worker answers as a cold one does. The test
    proves it by running the checks in shuffled orders from several threads against the one-off helper's answers.

## Adding a kind (the park and Pro-Am results checks)

When the sim port lands, a park or Pro-Am game's result can be checked by re-running the game from its seed and its
inputs, in the same workers.

1. **The kind** goes in `replay_worker.mjs` `KINDS`:

   ```js
   import { replayGame } from '../../client/js/sim/replay.js';   // (the sim's deterministic re-run)
   const KINDS = {
     gauntlet(msg) { ... },
     park(msg) {
       const r = replayGame(msg.start, msg.inputs, { maxTicks: MAX_TICKS });
       return { ok: !!r.ok, result: r.result || null, hash: r.hash ?? null, error: r.error ?? null, at: r.at ?? null };
     },
   };
   ```

   Keep the answer small: counts, a hash and where it went wrong, never the game itself. It must be deterministic, and
   it may keep only caches derived from tables or seeds.
2. **The name** goes in `gauntlet.py` `WORKER_KINDS`, so the pool accepts it.
3. **A caller** with the same shape as `replay_check()`:
   - check the input size before anything starts;
   - take a slot from `_slots`, and never hold the database lock while waiting;
   - call `_pool.check(node, {"kind": "park", ...}, timeout)`;
   - map `_WorkerTimeout` to the fallback and `_WorkerFailed` to a one-off run or the fallback;
   - check the answer's shape, as `_answer()` does for the Gauntlet.

   If a game's inputs can be bigger than 160 KB, give the kind its own cap. Raise the worker's `MAX_LINE` with it.
4. **The timeout:** a full park game re-runs far more ticks than a Gauntlet run has choices, so measure it.
   `REPLAY_TIMEOUT` is per check. Set the kind's own timeout well above its p99 and below the finish route's patience.
   - The CPU rlimit covers `WORKER_REQUESTS` checks. If a kind's checks are heavy, lower `WORKER_REQUESTS` instead of
     raising the CPU limit.
   - If a kind needs more than the 160 MB heap, give it its own pool rather than raising the limit for every kind.
5. **Tests:** as in `tests/test_v0489qp3_replay_pool.py`:
   - the worker's answer equals a one-off run's for honest, tampered and cut-short inputs, in any order;
   - a timeout kills the worker;
   - a failing worker falls back.
6. **Docs:** this page, and the operator's section in DEPLOYMENT.md.

The pool lives in `gauntlet.py` because the Gauntlet is its only user today. When a second kind arrives it can move to
its own module, for example `server/verify/pool.py`, with `replay_check()` and the new caller both importing it.
