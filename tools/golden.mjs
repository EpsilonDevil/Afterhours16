// Behaviour fingerprint for refactors: node tools/golden.mjs [out.json]
//
// Plays fixed, seeded slices of every deterministic system and prints one hash per slice. A cleanup or performance
// change that is meant to change nothing must leave every hash identical (compare with a saved run). Covers:
//   * sim:       park 3v3 and 2v2, Pro-Am 5v5 (with and without the Pro-Am realism), park with park cards, the AI world
//                rosters, a two-human lockstep game with auto-play toggles
//   * director:  the park director's state over 240 ticks
//   * gauntlet:  seeded runs played by the balance policy, and their replays
//   * world:     the shared AI world's schedule and population at fixed times
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { blankIntent } from '../client/js/sim/player.js';
import { RNG } from '../client/js/core/rng.js';
import { AIWorld, setWorldClock } from '../client/js/sim/world.js';
import { ParkDirector, hashState } from '../client/js/game/parkdirector.js';
import { PARK_COURTS, squadSpots, courtPlayRect } from '../client/js/world/themes.js';
import * as D from '../client/js/deck/index.js';
import { playRun } from './deck_sim.mjs';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
const out = {};
const h = v => hashState(v);

// ---------------- sim ----------------
function snap(g) {
  return {
    t: g.tick, score: g.score, phase: g.phase, poss: g.possession, q: g.quarter, over: g.over,
    ball: [g.ball.x, g.ball.y, g.ball.z, g.ball.mode, g.ball.holder],
    players: g.players.map(p => [p.x, p.z, p.y, p.facing, p.stamina, p.action?.type || null, JSON.stringify(p.stats)]),
  };
}
function runSim(name, cfg, ticks, every = 600, drive = null) {
  const g = new Game({ catalog, quarterLen: 120, quarters: 4, difficulty: 0.6, target: 21, ...cfg });
  const hs = [];
  for (let i = 1; i <= ticks && !g.over; i++) {
    if (drive) drive(g, i);
    g.step(1 / 60);
    if (i % every === 0) hs.push(h(snap(g)));
  }
  hs.push(h(snap(g)));
  out['sim:' + name] = h(hs);
}
const teams = (seed, n, level = 0.6) => { const rng = new RNG(seed); return [makeTeam(rng, n, { catalog, level }), makeTeam(rng, n, { catalog, level })]; };
for (const seed of [101, 202, 303]) runSim(`park3-${seed}`, { mode: 'park', seed, rosters: teams(seed, 3) }, 60 * 60 * 6);
runSim('park2-404', { mode: 'park', seed: 404, rosters: teams(404, 2), target: 15 }, 60 * 60 * 4);
for (const seed of [11, 12]) {
  runSim(`proam-${seed}`, { mode: 'proam', seed, rosters: teams(seed, 5) }, 60 * 60 * 5);
  runSim(`proam-real-${seed}`, { mode: 'proam', seed, rosters: teams(seed, 5), realism: true }, 60 * 60 * 5);
}
{
  const ro = teams(505, 3); ro[0][0].parkCards = [{ attr: 'three_point', pct: 5 }]; ro[0][1].parkCards = [{ attr: 'steal', pct: 3 }];
  runSim('park-cards-505', { mode: 'park', seed: 505, rosters: ro, parkCards: true }, 60 * 60 * 4);
}
{
  const w = new AIWorld({ seed: 1606 }, catalog), rng = new RNG(16), ids = w.ids();
  const pick = () => w.gameEntry(ids[rng.int(0, ids.length - 1)]);
  runSim('world-rosters-16', { mode: 'park', seed: 16, rosters: [[pick(), pick(), pick()], [pick(), pick(), pick()]] }, 60 * 60 * 4);
}
{
  // two humans in lockstep, scripted inputs, one of them on auto-play for a stretch
  const ro = teams(707, 3); ro[0][0].human = true; ro[1][0].human = true;
  const ir = new RNG(77);
  runSim('lockstep-707', { mode: 'proam', seed: 707, rosters: ro, multi: true, inputDelay: 3, realism: true }, 60 * 60 * 3, 600, (g, i) => {
    for (const p of g.players.filter(q => q.human)) {
      const it = { ...blankIntent(), mx: Math.round((ir.next() * 2 - 1) * 1000) / 1000, mz: Math.round((ir.next() * 2 - 1) * 1000) / 1000, sprint: ir.next() < 0.3 };
      if (ir.next() < 0.02) it.shoot = 'press';
      if (p.team === 1 && i > 2000 && i < 5000) it.auto = true;
      g.humanIntents.set(p.id, it); // (as session.js feeds a lockstep tick)
    }
  });
}

// ---------------- the shared AI world ----------------
{
  const w = new AIWorld({ seed: 4242, born: Date.UTC(2026, 0, 1) }, catalog);
  const at = [Date.UTC(2026, 9, 21, 1), Date.UTC(2026, 9, 21, 15), Date.UTC(2026, 9, 25, 22)];
  out['world:4242'] = h(at.map(t => {
    setWorldClock(t, 0, t);
    const ids = w.ids().slice(0, 60);
    const st = ids.map(id => { const a = w.account(id), s = w.status(id, t); return [id, a.start, a.len, s ? s.park : null, s ? s.until : null]; });
    return [st, w.onlineCount(t), w.onlineAt('harbor', t)];
  }));
  setWorldClock(null);
}

// ---------------- the park director ----------------
{
  const T0 = Date.UTC(2026, 9, 21, 1, 0);
  setWorldClock(T0, 0, T0);
  const layout = { courts: PARK_COURTS.filter(c => ['main', 'w2a', 'e1'].includes(c.id)).map(c => ({ ...c, rows: squadSpots(c), rect: courtPlayRect(c) })), solids: [] };
  const w = new AIWorld({ seed: 4242, born: T0 - 300 * 86400000 }, catalog); w.shared = true; w.squadAsync = true;
  const P = new ParkDirector({ world: w, park: 'harbor', layout, catalog, epoch: 3, t0: T0, surface: 'asphalt', toLocal: ms => ms });
  const hs = [];
  for (let k = 1; k <= 240; k++) { P.step([]); if (k % 20 === 0) hs.push(P.hash()); }
  out['director:harbor'] = h(hs);
  setWorldClock(null);
}

// ---------------- the Gauntlet ----------------
for (const seed of [1000003, 77, 4242]) {
  const r = playRun(seed, 'smart');
  const rep = D.replay(r.start, r.log);
  out['gauntlet:' + seed] = h([rep.hash, rep.counts, r.log.length]);
}

const keys = Object.keys(out).sort();
const res = Object.fromEntries(keys.map(k => [k, out[k]]));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(res, null, 1));
for (const k of keys) console.log(k.padEnd(28), res[k]);
