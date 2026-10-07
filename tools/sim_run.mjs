// Quick headless simulation runner: node tools/sim_run.mjs park|proam [seed]
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { AIWorld, SKILL_TIERS } from '../client/js/sim/world.js';
const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
export function runGame(mode, seed, opts = {}) {
  const rng = new RNG(seed);
  const size = mode === 'proam' ? 5 : (opts.size || 3);
  // v0.4.4: opts.world → rosters drawn from a persistent AI world (mixed skill tiers, with IQ); opts.tiers →
  // [tierA, tierB] matchups
  let rosters;
  if (opts.world || opts.tiers) {
    const w = opts.worldObj || new AIWorld({ seed: 1000 + seed }, catalog);
    const pool = w.ids().filter(id => !opts.tiers || opts.tiers.includes(w.account(id).tier.id));
    const pick = tier => { for (;;) { const id = pool[rng.int(0, pool.length - 1)]; if ((!tier || w.account(id).tier.id === tier) && !used.has(id)) { used.add(id); return w.gameEntry(id); } } };
    const used = new Set();
    rosters = [0, 1].map(t => Array.from({ length: size }, () => pick(opts.tiers ? opts.tiers[t] : null)));
  } else rosters = [makeTeam(rng, size, { catalog, level: 0.6 }), makeTeam(rng, size, { catalog, level: 0.6 })];
  const g = new Game({ mode, seed, rosters, catalog, target: opts.target || 21, quarterLen: opts.quarterLen || 120, quarters: 4, difficulty: 0.6 });
  const counts = {};
  let steps = 0;
  const maxSteps = 60 * 60 * (opts.maxMinutes || 30);
  while (!g.over && steps < maxSteps) {
    g.step(1 / 60); steps++;
    for (const e of g.events) counts[e.type] = (counts[e.type] || 0) + 1;
  }
  return { g, counts, minutes: steps / 3600 };
}
if ((process.argv[1] || '').endsWith('sim_run.mjs')) {
  const mode = process.argv[2] || 'park', seed = +(process.argv[3] || 7);
  const t0 = Date.now();
  const { g, counts, minutes } = runGame(mode, seed);
  console.log(mode, 'seed', seed, 'over', g.over, 'score', g.score, 'sim minutes', minutes.toFixed(1), 'wall ms', Date.now() - t0, 'q', g.quarter);
  console.log(JSON.stringify(counts));
  for (const p of g.players) console.log(p.team, p.position, p.name.padEnd(16), JSON.stringify(p.stats));
}
