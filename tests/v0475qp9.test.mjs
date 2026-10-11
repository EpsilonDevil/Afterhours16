// v0.4.7.5 quick patch 3: who takes threes. The AI (and auto-play) is less inclined to a three the further the Three
// Point rating sits under 70, and less inclined again at PF and C (sim/ai.js THREE_TEND / threeTend).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { THREE_TEND, threeTend } from '../client/js/sim/ai.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

test('the tendency: 1 at 70 Three Point and up for a guard or wing, down to 0.45 at 55; bigs lower still, back to 1 at 95', () => {
  const t = (r, pos) => threeTend({ ratings: { three_point: r }, position: pos });
  assert.equal(THREE_TEND.rating, 70); assert.equal(THREE_TEND.floor, 55);
  for (const pos of ['PG', 'SG', 'SF']) { assert.equal(t(70, pos), 1); assert.equal(t(99, pos), 1); assert.ok(Math.abs(t(55, pos) - THREE_TEND.low) < 1e-9); assert.equal(t(40, pos), THREE_TEND.low); assert.ok(t(62, pos) > t(55, pos) && t(62, pos) < t(70, pos)); }
  for (const pos of ['PF', 'C']) { assert.ok(Math.abs(t(70, pos) - THREE_TEND.big) < 1e-9, `${pos} at 70`); assert.ok(t(85, pos) > t(70, pos) && t(85, pos) < 1); assert.equal(t(95, pos), 1); assert.ok(t(55, pos) < t(55, 'SG')); }
  assert.ok(t(60, 'C') < t(60, 'SG') && t(60, 'SG') < t(80, 'SG'));
});

test('in games: a weak or big shooter left open at the arc lets it fly far less often than a shooter does', () => {
  // the same open look, 60 tries each: the ball at the top of the arc with the defense 6 m away. The AI either
  // shoots the three within two seconds or does something else (drives in for a two, passes it on)
  const tries = (three_point, position) => {
    let shots = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = new RNG(seed), me = makeTeam(rng, 2, { catalog, level: 0.75 }), opp = makeTeam(rng, 2, { catalog, level: 0.75 });
      me[0].build.attributes.three_point = three_point; me[0].build.position = position;
      me[0].build.attributes.ball_handle = 60; me[0].build.attributes.driving_dunk = 50; me[0].build.attributes.layup = 55;
      const g = new Game({ mode: 'park', seed, rosters: [me, opp], catalog, target: 21, difficulty: 0.6 });
      for (let i = 0; i < 600 && g.phase !== 'live'; i++) g.step(1 / 60);
      if (g.phase !== 'live') continue;
      const p = g.players[0], side = g.sideFor(0), rim = g.rimFor(0);
      g.possession = 0; g.giveBall(p, 'dribble'); g.shotClock = 18;
      p.setPos(rim.x, rim.z - side * 7.3, side > 0 ? 0 : Math.PI);
      g.players[1].setPos(rim.x - 5, rim.z - side * 2, 0);
      for (const d of g.teams[1]) d.setPos(rim.x + 2, rim.z - side * 13, 0);
      n++;
      let shot = false, done = false;
      for (let i = 0; i < 120 && !done; i++) { g.step(1 / 60); for (const e of g.events) { if (e.type === 'release' && e.player === p.id) { done = true; if (e.three) shot = true; } if (e.type === 'turnover' || (e.type === 'pass' && e.player === p.id)) done = true; } }
      if (shot) shots++;
    }
    return shots / Math.max(1, n);
  };
  const sg80 = tries(80, 'SG'), sg60 = tries(60, 'SG'), c60 = tries(60, 'C'), c85 = tries(85, 'C');
  if (process.env.SHOW) console.log({ sg80, sg60, c60, c85 });
  assert.ok(sg80 > 0.5, `an 80 Three Point SG shoots the open look (${(sg80 * 100).toFixed(0)}%)`);
  assert.ok(sg60 < sg80 * 0.7, `a 60 SG shoots it a lot less (${(sg60 * 100).toFixed(0)}% vs ${(sg80 * 100).toFixed(0)}%)`);
  assert.ok(c60 < sg60 * 0.8 + 0.02, `a 60 C less again (${(c60 * 100).toFixed(0)}% vs ${(sg60 * 100).toFixed(0)}%)`);
  assert.ok(c85 < sg80, `and an 85 C still a little less than the SG (${(c85 * 100).toFixed(0)}% vs ${(sg80 * 100).toFixed(0)}%)`);
});
