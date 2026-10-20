// v0.4.8.7 rules: a quarter break doesn't change possession (Pro-Am, the Pro Run), and a wide-open three by an 85+
// three-point shooter has a solid green window whatever his archetype
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import * as S from '../client/js/sim/shots.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
function proam(seed = 11) {
  const rng = new RNG(seed);
  const rosters = [makeTeam(rng, 5, { catalog, level: 0.7 }), makeTeam(rng, 5, { catalog, level: 0.7 })];
  return new Game({ mode: 'proam', seed, rosters, catalog, quarterLen: 60, quarters: 4, difficulty: 0.6 });
}
// run the quarter break through: endPeriod, then the dead ball's restart
function breakWith(g, setup) {
  for (let i = 0; i < 60 * 3 && g.phase !== 'live'; i++) g.step(1 / 60);
  setup(g);
  g.endPeriod();
  for (let i = 0; i < 60 * 4 && g.quarter === 1; i++) g.step(1 / 60);
  return { quarter: g.quarter, team: g.possession };
}

test('a quarter break keeps the ball with the team that had it at the buzzer', () => {
  for (const team of [0, 1]) for (const seed of [11, 12, 13]) {
    const r = breakWith(proam(seed), g => { g.possession = team; g.lastMade = null; });
    assert.equal(r.quarter, 2);
    assert.equal(r.team, team, `seed ${seed}: team ${team} had it at the buzzer and starts quarter 2 with it`);
  }
});

test('a basket on the buzzer hands the next quarter to the other team, like any make', () => {
  const r = breakWith(proam(11), g => { g.possession = 0; g.lastMade = { team: 0, t: g.time }; });
  assert.equal(r.team, 1);
  const old = breakWith(proam(12), g => { g.possession = 1; g.lastMade = { team: 0, t: g.time - 20 }; });
  assert.equal(old.team, 1, 'an old basket does not count');
  assert.ok(!fs.readFileSync(new URL('../client/js/sim/game.js', import.meta.url), 'utf8').includes('(this.firstPossession + q) % 2'), 'no more alternating');
});

test('a wide-open three by an 85+ three-point shooter: a solid green window for any archetype', () => {
  assert.equal(S.OPEN_THREE_SURE, 85);
  assert.equal(S.openThreeSure(0.05, 85), true);
  assert.equal(S.openThreeSure(0.1, 99), true);
  assert.equal(S.openThreeSure(0.05, 84), false, 'under 85');
  assert.equal(S.openThreeSure(0.11, 90), false, 'not wide open');
  const g = proam(21), p = g.players.find(q => q.team === 0);
  const rim = g.rimFor(p.team), side = g.sideFor(p.team);
  // a spot well behind the arc, straight on
  const a = { startX: 0, startZ: rim.z - side * 8.0, moving: 0 };
  for (const arch of ['slasher', 'lockdown', 'post_scorer', 'sharpshooter']) {
    p.archetype = arch;
    for (const [rating, contest, sure] of [[85, 0.05, true], [92, 0, true], [84, 0.05, arch === 'sharpshooter'], [90, 0.3, arch === 'sharpshooter']]) {
      p.ratings = { ...p.ratings, three_point: rating }; p.raw = { ...(p.raw || p.ratings), three_point: rating };
      const W = g.jumperWindow(p, a, contest);
      assert.ok(W.three, 'a three');
      assert.equal(W.sure, sure, `${arch} ${rating} at ${contest}: sure ${W.sure}`);
    }
    // and the non-shooter's 10% smaller window doesn't apply to it
    p.ratings = { ...p.ratings, three_point: 88 }; p.raw = { ...p.raw, three_point: 88 };
    const open = g.jumperWindow(p, a, 0.05), justOff = g.jumperWindow(p, a, 0.1);
    assert.ok(open.total > 0 && justOff.total > 0 && open.openThree);
  }
});
