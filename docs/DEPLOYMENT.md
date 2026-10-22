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

### The sandbox

Each replay is a separate `node` process, and it runs with these limits:

- no shell;
- a minimal environment: only `PATH`, plus what node needs to start on Windows, with no settings and no secrets;
- the repository as its folder;
- a 5-second wall-clock timeout, after which it's killed;
- on Linux and macOS, 5 CPU-seconds, 256 MB of data memory (V8 heap 160 MB), no core files and no files over 1 MB;
- input capped at 160 KB (checked before anything starts) and output capped at 64 KB, parsed defensively;
- at most 2 at a time, never inside the database lock.

A completed run replays in about a quarter of a second.
