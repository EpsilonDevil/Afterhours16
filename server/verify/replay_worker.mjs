// v0.4.8.9 qp3: the long-running replay worker (server/gauntlet.py ReplayPool keeps up to REPLAY_PARALLEL of them, started
// when the first check comes, sandboxed like gauntlet_replay.mjs: no shell, a minimal environment, CPU and memory limits,
// a per-request timeout that kills it). It answers checks one at a time, as newline-delimited JSON (docs/REPLAY-WORKER.md):
//   in   {"id": n, "kind": "gauntlet", ...the kind's fields}           one line, at most MAX_LINE bytes
//   out  {"id": n, "rss": bytes, ...the kind's answer}                  one line, and nothing else ever goes to stdout
// A request never sees another's data: each one is parsed fresh, and the engine's own caches only hold what is derived
// from its tables or from a seed (the same caches the browser keeps between runs). It exits when stdin closes, or after
// argv[2] seconds with nothing to do.
import { replay, MAX_CHOICES } from '../../client/js/deck/index.js';

const MAX_LINE = 200 * 1024;
const IDLE_SECS = Math.max(5, Number(process.argv[2]) || 300);

// ---------- the check kinds (add one here and in gauntlet.py WORKER_KINDS; see docs/REPLAY-WORKER.md) ----------
const KINDS = {
  // a Gauntlet run from its start and its choices: what gauntlet_replay.mjs answers, field for field
  gauntlet(msg) {
    const r = replay(msg.start, msg.choices, { maxChoices: MAX_CHOICES });
    return { ok: !!r.ok, counts: r.counts || null, hash: r.hash ?? null, error: r.error ?? null, at: r.at ?? null };
  },
};

// ---------- the line protocol ----------
const send = obj => { process.stdout.write(JSON.stringify({ ...obj, rss: process.memoryUsage().rss }) + '\n'); };
function answer(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ id: null, ok: false, counts: null, hash: null, error: 'bad JSON', at: -1 }); }
  if (!msg || typeof msg !== 'object' || !Number.isInteger(msg.id)) return send({ id: null, ok: false, counts: null, hash: null, error: 'not a request', at: -1 });
  const kind = Object.hasOwn(KINDS, msg.kind) ? KINDS[msg.kind] : null;
  if (!kind) return send({ id: msg.id, ok: false, counts: null, hash: null, error: 'unknown kind', at: -1 });
  send({ id: msg.id, ...kind(msg) });
}

let idle = null;
const rest = () => { clearTimeout(idle); idle = setTimeout(() => process.exit(0), IDLE_SECS * 1000); };
let buf = '', skipping = false;
const tooBig = () => send({ id: null, ok: false, counts: null, hash: null, error: 'input too big', at: -1 });
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  rest();
  if (skipping) { // (the rest of a line that was too long: dropped up to its end)
    const nl = d.indexOf('\n');
    if (nl < 0) return;
    d = d.slice(nl + 1);
    skipping = false;
  }
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.length > MAX_LINE) tooBig(); else answer(line);
  }
  if (buf.length > MAX_LINE) { buf = ''; skipping = true; tooBig(); }
});
process.stdin.on('end', () => process.exit(0));
rest();
