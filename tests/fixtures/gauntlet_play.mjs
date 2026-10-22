// v0.4.8.9 qp1 test fixture: an honest Gauntlet run, recorded. stdin: { start: {seed, player, world}, policy }; plays it
// with the deck agent's balance-harness policy (tools/deck_sim.mjs playRun, which logs every choice through the
// engine's act) and prints { log, over } (over: runOver(run), the summary the client sends).
import { playRun } from '../../tools/deck_sim.mjs';
import { runOver } from '../../client/js/deck/index.js';

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { buf += d; });
process.stdin.on('end', () => {
  const { start, policy = 'smart' } = JSON.parse(buf);
  const r = playRun(start.seed, policy, { world: start.world });
  process.stdout.write(JSON.stringify({ log: r.log, over: runOver(r.run), start: r.start }) + '\n');
});
