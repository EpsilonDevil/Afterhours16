// The Gauntlet's bracket map (GAUNTLET.md §5): three phases, each a branching bracket of 13 rounds bottom to top
// (12 rounds of nodes with 2-4 choices, the last always Coolers, then the boss), and the Final (a Shop or a Cooler,
// a Cooler, the Final boss).
//
// Balance reasoning (the mix): the spec's rough mix per phase is 45% matches, 10% Rivals, 15% Coolers, 10% Shops and
// 20% Mystery Stops. Round 1 is all matches (you earn your first card before anything else) and round 12 is all
// Coolers, so the middle rounds use weights that bring the whole phase back to that mix. The bans below (no Rival or
// Cooler before round 5, no Shop before round 3, no Cooler right before the Cooler row, and a node never repeats its
// parent's kind when that kind is a Rival, a Cooler or a Shop: the genre's rule, no two rests in a row) cut the rarer
// kinds, so their weights sit above the target. Measured over 2,000 phases (tests/v0489deck_map.test.mjs): 45.1% matches, 10.0% Rivals, 14.6% Coolers, 9.9% Shops, 20.5% Stops.
// Called by: run.js newRun (one bracket per phase).
import * as R from './rng.js';
import { pickRules } from './rules.js';
import { BOSS_POOLS } from './bosses.js';

export const ROUNDS = 13; // per phase, the boss's round included
export const MID_WEIGHTS = { match: 34, rival: 19, cooler: 17, shop: 13, event: 19 };
const NO_REPEAT = new Set(['rival', 'cooler', 'shop']);

// edges between two rows (counts a, b) that never cross and leave no node unreachable
function link(st, a, b) {
  const x = i => (i + 0.5) / a, y = j => (j + 0.5) / b;
  const lo = [];
  for (let i = 0; i < a; i++) { let best = 0; for (let j = 1; j < b; j++) if (Math.abs(y(j) - x(i)) < Math.abs(y(best) - x(i))) best = j; lo.push(best); }
  const hi = lo.slice();
  for (let i = 0; i < a; i++) if (hi[i] + 1 < b && (i === a - 1 || lo[i + 1] >= hi[i] + 1) && R.chance(st, 0.45)) hi[i]++;
  // fill the gaps so every node of the next row has a way in
  lo[0] = 0; hi[a - 1] = b - 1;
  for (let i = 0; i < a - 1; i++) if (lo[i + 1] > hi[i] + 1) hi[i] = lo[i + 1] - 1;
  const out = [];
  for (let i = 0; i < a; i++) { const l = []; for (let j = lo[i]; j <= hi[i]; j++) l.push(j); out.push(l); }
  return out;
}

// cast(kind, phase, round, nodeId) -> foes for a node (run.js supplies it from the nemesis world and the AI world)
// bossFor(phase) -> boss id (and its foes come from cast('boss', ...))
export function genPhase(seed, phase, cast, bossFor) {
  const st = R.stream(seed, 'map', phase);
  const nodes = {}, rows = [];
  if (phase === 4) {
    const r0 = [mk(phase, 0, 0, 'shop', 0.33), mk(phase, 0, 1, 'cooler', 0.67)], r1 = [mk(phase, 1, 0, 'cooler', 0.5)], r2 = [mk(phase, 2, 0, 'boss', 0.5)];
    rows.push(r0, r1, r2);
  } else {
    for (let r = 0; r < ROUNDS; r++) {
      const n = r === ROUNDS - 1 ? 1 : r === ROUNDS - 2 ? R.int(st, 2, 3) : r === 0 ? 3 : R.int(st, 2, 4);
      const row = [];
      for (let i = 0; i < n; i++) row.push(mk(phase, r, i, r === 0 ? 'match' : r === ROUNDS - 2 ? 'cooler' : r === ROUNDS - 1 ? 'boss' : null, (i + 0.5) / n));
      rows.push(row);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    const L = link(st, rows[r].length, rows[r + 1].length);
    rows[r].forEach((nd, i) => { nd.next = L[i].map(j => rows[r + 1][j].id); });
  }
  // the kinds of the middle rounds
  const parents = {};
  for (const row of rows) for (const nd of row) for (const c of nd.next) (parents[c] || (parents[c] = [])).push(nd);
  for (let r = 1; r < rows.length - 2; r++) for (const nd of rows[r]) {
    const banned = new Set((parents[nd.id] || []).map(p => p.kind).filter(k => NO_REPEAT.has(k)));
    if (r < 4) banned.add('rival'), banned.add('cooler');
    if (r < 2) banned.add('shop');
    if (r === ROUNDS - 3) banned.add('cooler');
    nd.kind = R.weighted(st, Object.entries(MID_WEIGHTS).filter(([k]) => !banned.has(k)));
  }
  // who's on each node, and the rules
  for (const row of rows) for (const nd of row) {
    if (nd.kind === 'boss') { nd.boss = bossFor(phase); nd.foes = cast('boss', phase, nd.round, nd.id, nd.boss); nd.rules = pickRules(st, 'boss'); }
    else if (nd.kind === 'match' || nd.kind === 'rival') { nd.foes = cast(nd.kind, phase, nd.round, nd.id); nd.rules = pickRules(st, nd.kind); }
    nodes[nd.id] = nd;
  }
  return { phase, rows: rows.map(row => row.map(nd => nd.id)), nodes };
}
function mk(phase, round, i, kind, x) { return { id: `${phase}-${round}-${i}`, phase, round, kind, x: Math.round(x * 1000) / 1000, next: [], foes: null, rules: null, boss: null }; }

// the phase's boss: one of its pool, or your top Nemesis once a run (§8)
export function pickBoss(st, phase, nemesisFree) {
  const pool = BOSS_POOLS[phase].slice();
  if (nemesisFree && phase <= 3) pool.push('nemesis');
  return R.pick(st, pool);
}
