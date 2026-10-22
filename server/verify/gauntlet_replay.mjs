// v0.4.8.9 qp1: the Gauntlet replay check, the server's optional Node helper (server/gauntlet.py replay_check runs it
// sandboxed: a timeout, CPU and memory limits, no shell, a minimal environment). One JSON object on stdin,
// { start, choices }; the run replayed by the deck engine itself (client/js/deck/replay.js); one JSON line on stdout,
// { ok, counts, hash, error, at }, and nothing else (never the run).
import { replay, MAX_CHOICES } from '../../client/js/deck/index.js';

const MAX_IN = 200 * 1024;
const done = obj => { process.stdout.write(JSON.stringify(obj) + '\n'); };
let buf = '', size = 0, over = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { size += d.length; if (size > MAX_IN) { over = true; return; } buf += d; });
process.stdin.on('end', () => {
  if (over) return done({ ok: false, counts: null, hash: null, error: 'input too big', at: -1 });
  let msg;
  try { msg = JSON.parse(buf); } catch { return done({ ok: false, counts: null, hash: null, error: 'bad JSON', at: -1 }); }
  if (!msg || typeof msg !== 'object') return done({ ok: false, counts: null, hash: null, error: 'not an object', at: -1 });
  const r = replay(msg.start, msg.choices, { maxChoices: MAX_CHOICES });
  done({ ok: !!r.ok, counts: r.counts || null, hash: r.hash ?? null, error: r.error ?? null, at: r.at ?? null });
});
