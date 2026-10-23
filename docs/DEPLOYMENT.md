# Deployment notes

How the game service is run is in the README (**Play online with friends** and **Host on a server**). This page is
for what a server operator might want to know beyond that.

## Gauntlet replay checks (v0.4.8.9 qp1)

The server checks a Gauntlet run before paying for it by replaying the run's choices through the deck engine itself.
The engine lives in `client/js/deck/`, the same code the game runs. The replay is done by a small optional Node.js
helper, `server/verify/gauntlet_replay.mjs`.

- **With Node.js (v14 or newer)**, the payout comes from what the replay earned. A log that doesn't replay, or a
  summary that claims more than the replay found, is refused (HTTP 409), and the service logs where and why.
- **Without Node.js**, the service falls back to checking the run's counts: they must hang together, and the run must
  have taken at least the real time they need. The same fallback is used when the helper fails or runs over its time.
  These runs are recorded as not verified.

Since qp4 every run's start records the engine version it's played on (`ENGINE_VERSION` in `client/js/deck/run.js`,
read by the service when it starts). A run started on the old rules (before qp4: no version, or 1) can't be replayed by
the new engine, so it's paid by its counts and recorded as not verified, never refused for it. A client on a different
version, or one that doesn't send its version (every client from before qp4), is told "Update the game to play the
Gauntlet." instead of starting a run.

The service's start banner says which applies, for example `Gauntlet replay checks: on (Node.js v18.19.1)` or
`Gauntlet replay checks: off: Node.js not found (runs are checked by their counts)`.

### The online server (Ubuntu)

- `deploy/install.sh` installs Ubuntu's `nodejs` package. Ubuntu 24.04's is v18. If the install fails, the setup
  carries on and the server falls back to count checks.
- A server set up before this patch needs nothing from its operator. On the next update the service restarts; its
  start step, which runs as root, tries Ubuntu's `nodejs` package once, without holding the start up. The log for that
  try is `/var/log/afterhours16-node.log`. If it didn't work, each later update prints a hint. Installing it by hand
  is `sudo apt-get install -y nodejs`. The service finds node as soon as it's installed; no restart is needed.

### A player-hosted PC (Windows, `host.cmd`)

Nothing is needed. If `node` is on the PATH it's used; otherwise runs are checked by their counts.

### Settings

- `RIMRIFT_NODE=/path/to/node` sets which Node.js to use. By default it's `node` on the PATH.
- `RIMRIFT_REPLAY=0` turns replay checks off.
- `RIMRIFT_REPLAY_POOL=0` turns the replay workers off (qp3, below): every check starts its own `node` again.

### The sandbox

Each replay is a separate `node` process, and it runs with these limits:

- no shell;
- a minimal environment: only `PATH`, plus what node needs to start on Windows, with no settings and no secrets;
- the repository as its folder;
- a 5-second wall-clock timeout, after which it's killed;
- on Linux and macOS, 5 CPU-seconds, 256 MB of data memory (V8 heap 160 MB), no core files and no files over 1 MB;
- input capped at 160 KB (checked before anything starts) and output capped at 64 KB, parsed defensively;
- at most 2 at a time, never inside the database lock.

A completed run replays in about a quarter of a second this way.

### The replay workers (v0.4.8.9 qp3)

Since qp3 a check doesn't start Node for itself. Up to 2 long-running workers (`server/verify/replay_worker.mjs`)
are started when the first check comes. Each answers one check at a time, with the same sandbox as above. The
differences:

- the CPU limit covers a worker's 100 checks (500 CPU-seconds), because a single check is bounded by its 5-second
  wall-clock timeout, after which the worker is killed;
- a worker is replaced after 100 checks, when it reports more than 200 MB of memory, when it dies, and after 5 idle
  minutes (it exits by itself, and it's started again when needed);
- no check sees another's data.

A completed run is checked in about 30 ms instead of about 150 ms. If no worker can answer (it won't start, crashes or
answers garbage), the check uses the one-off helper above, and if that fails too, the count checks. A check that runs
over its time goes straight to the count checks. The protocol, and how to add new kinds of check (the park and
Pro-Am results checks the sim port will bring), are in [REPLAY-WORKER.md](REPLAY-WORKER.md).

## The save's durability (v0.4.8.9 qp3)

`RIMRIFT_DB_SYNC` sets how hard each commit waits for the disk:

- **`normal`** (the default). SQLite's WAL mode with `synchronous=NORMAL`, plus a sync at most a second after a write.
  - A crash of the service (killed, crashed, closed window) loses nothing that was committed: every commit is in the
    operating system before the request is answered.
  - An operating-system crash or a power cut can lose the commits of the last second or so. The save itself is never
    corrupted by it.
  - The sync is a passive checkpoint. In NORMAL mode it syncs the WAL before copying anything, and the database file
    after. While a backup holds a read open, the WAL is synced directly (Linux, macOS) or on the next second
    (Windows).
- **`full`** (the safest). `synchronous=FULL`: every commit waits until it's on the disk, so not even a power cut loses
  it. Each write pays one disk sync while it holds the database. Use it where power is unreliable, or if losing even a
  second of progress isn't acceptable.

With a disk that takes 4 ms to sync, a store purchase or a build save takes about 7 ms with `full` and 2 ms with
`normal`, and a park game's start and finish together take 15 ms with `full` and 4 ms with `normal`. On a fast
virtual disk (0.2 ms syncs) the difference is about 15%. Set it in `/etc/afterhours16.env` on the online server, or in
the environment before `host.cmd`. A value it doesn't know means the default.
