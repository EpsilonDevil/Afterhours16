// v0.4.8.7 quick patch 3: a perfectly timed open green layup goes in, however late it was started or let go.
// Before: a layup started right under the rim, or carried in under it by a late release, came out below the rim's front
// and hit its underside. The planner still called it a make (its prediction, with twice the layup's real spin, bounced
// in off the underside), and a green with no clean path wasn't flown as a ghost the way a green jumper is.
//  * the shooter never gets inside LAYUP_FIN of the rim's centre while he still has the ball (started under it, he glides
//    through to that distance on the far side);
//  * planShot never counts a ball that touches the rim before it has been up over the rim's plane as a make, and plans
//    with the spin the flight really gets;
//  * a green with no clean path is a ghost through the rim, like a green jumper.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, LAYUP_FIN } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { blankIntent } from '../client/js/sim/player.js';
import { RNG } from '../client/js/core/rng.js';
import { Ball, predictShot } from '../client/js/sim/ball.js';
import { COURT } from '../client/js/sim/constants.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const catalog = Object.fromEntries(JSON.parse(src('server/catalog.json')).map(i => [i.id, i]));

function layup(seed, d, speed, lateBy) {
  const rng = new RNG(seed), me = makeTeam(rng, 1, { catalog, level: 0.6 })[0];
  me.human = true; me.build.attributes = { ...me.build.attributes, layup: 85, driving_dunk: 40, standing_dunk: 40 };
  const g = new Game({ mode: 'practice', seed, rosters: [[me], []], catalog });
  const p = g.players[0], rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x, rim.z - side * d, side > 0 ? 0 : Math.PI); p.vz = side * speed; g.giveBall(p, 'dribble');
  g.setInput({ ...blankIntent(), mx: 0, mz: side, sprint: true, shoot: 'press', shootHeld: true, forceLayup: true }); g.step(1 / 60);
  const a = p.action; if (a?.type !== 'layup') return null;
  let rel = null, through = false, heldMin = 9;
  for (let i = 0; i < 400; i++) {
    const held = !(a.t >= a.tRel + lateBy);
    g.setInput({ ...blankIntent(), mx: 0, mz: side, sprint: true, shootHeld: held, shoot: held ? null : 'release' });
    g.step(1 / 60);
    if (g.ball.holder === p.id && a.jumped) heldMin = Math.min(heldMin, Math.hypot(p.x - rim.x, p.z - rim.z));
    for (const e of g.events) { if (e.type === 'release') rel = e; if (e.type === 'through') through = true; }
    if (rel && (through || (g.ball.mode !== 'flight' && i > 0) || g.ball.floorBounces > 0)) break;
  }
  return { rel, through, heldMin };
}

test('a green layup goes in: started late right under the rim, or let go late, wide open', () => {
  let greens = 0;
  for (const seed of [4, 7]) for (let d = 0.2; d <= 2.6; d += 0.2) for (const s of [2, 5, 6.5]) for (const late of [0, 0.03]) {
    const r = layup(seed, +d.toFixed(2), s, late);
    if (!r || r.rel?.grade !== 'excellent') continue;
    greens++;
    assert.ok(r.through, `seed ${seed}, ${d.toFixed(1)} m at ${s} m/s, ${late}s late: a green that missed`);
  }
  assert.ok(greens >= 60, `${greens} greens checked`);
});

test('while he still has the ball he never gets inside the finishing distance (unless he started under it)', () => {
  for (const [d, s] of [[1.2, 6.5], [1.6, 5], [2.2, 6.5]]) {
    const r = layup(4, d, s, 0.05);
    assert.ok(r.heldMin >= LAYUP_FIN - 0.08, `${d} m at ${s} m/s: ${r.heldMin.toFixed(2)} m from the rim with the ball`);
  }
});

test('the planner: a ball that hits the rim from underneath is never a make, and layups plan with their real spin', () => {
  const b = new Ball(); b.halfOnly = true;
  // flat from just under the front of the rim, straight into its underside
  Object.assign(b, { x: 0, y: 2.72, z: COURT.hoopZ - 0.38, vx: 0, vy: 2.69, vz: 1.3, wx: -7, wy: 0, wz: 0, mode: 'flight', touchedRim: false, touchedBoard: false, floorBounces: 0 });
  const r = predictShot(b, 4);
  assert.equal(r.rim, true); assert.equal(r.under, true);
  const s = src('client/js/sim/shots.js'), g = src('client/js/sim/game.js');
  assert.match(s, /if \(res\.r\.made && !res\.r\.under\) return/);
  assert.match(g, /spinK: 0\.5 \}\);[\s\S]{0,300}b\.wx = plan\.wx; b\.wz = plan\.wz; b\.ghost = !!plan\.ghost;/);
});
