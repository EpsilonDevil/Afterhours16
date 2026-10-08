// v0.4.5 quick patch: the middle of the green window is where the ball leaves his hand, on the real body model, for
// every jump-shot base and release timing, every layup package and coverage, and short / tall, short- / long-armed
// builds. Traced through the game, the animator and the rig: at the ideal release the hand is still on the ball (the
// arm reaches it), and the ball and the hand both stop rising exactly then.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const builds = [{ height: 69, wingspan: 67, weight: 160 }, { height: 78, wingspan: 82, weight: 214 }, { height: 87, wingspan: 96, weight: 268 }];
const rigFor = build => { const model = new AthleteModel(build, {}, 1), rig = new Rig(model); return { rig, view: { H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } } }; };

function setup(build, equip) {
  const rng = new RNG(3), me = makeTeam(rng, 1, { catalog, level: 0.8 })[0];
  Object.assign(me.build, build, { hand: 'R' });
  me.build.equipment = { ...me.build.equipment, ...equip };
  me.human = true;
  const g = new Game({ mode: 'practice', seed: 3, rosters: [[me], []], catalog });
  return { g, p: g.players[0], ...rigFor(me.build) };
}
// hold the shot through the top; per frame: the shooting hand's IK shortfall, ball and hand heights over the feet
function hold(g, p, a, view, hand, input) {
  const anim = new Animator(view), rows = [];
  for (let i = 0; i < 150 && !a.released; i++) {
    const b = g.ball;
    anim.update(1 / 60, { x: p.x, y: p.y, z: p.z, facing: p.facing }, p, g, { x: b.x, y: b.y, z: b.z });
    rows.push({ t: a.t, ik: view.rig.reach[hand], by: b.y - p.y, hy: view.rig.pos[B['hand' + hand]][1] + view.y - p.y });
    if (a.t > a.tRel + 0.15) break;
    g.setInput(input()); g.step(1 / 60);
  }
  return rows;
}
function check(rows, T, what) {
  const atT = rows.reduce((m, r) => Math.abs(r.t - T) < Math.abs(m.t - T) ? r : m, rows[0]);
  let iB = 0, iH = 0;
  rows.forEach((r, i) => { if (r.by > rows[iB].by + 1e-4) iB = i; if (r.hy > rows[iH].hy + 1e-4) iH = i; });
  const tick = 1 / 60 + 1e-6;
  assert.ok(atT.ik < 0.005, `${what}: the hand is on the ball at the release (${(atT.ik * 100).toFixed(1)} cm short)`);
  assert.ok(Math.abs(rows[iB].t - T) <= tick, `${what}: the ball tops out at the release (${((rows[iB].t - T) * 1000).toFixed(0)} ms)`);
  assert.ok(Math.abs(rows[iH].t - T) <= tick, `${what}: so does the hand (${((rows[iH].t - T) * 1000).toFixed(0)} ms)`);
}

test('jumpers and free throws: the green window is centred on the ball leaving the hand, for every base and build', () => {
  const bases = list.filter(i => i.slot === 'jumpshot').map(i => i.id);
  const rels = list.filter(i => i.slot === 'release').sort((a, b) => (a.release_seconds ?? 0.72) - (b.release_seconds ?? 0.72));
  let n = 0;
  for (const build of builds) for (const base of bases) for (const rel of [rels[0].id, rels[rels.length - 1].id]) for (const v of ['mid', 'three', 'fade', 'ft']) {
    if (v === 'ft' && base !== bases[0]) continue;
    const { g, p, view } = setup(build, { jumpshot: base, release: rel });
    const rim = g.rimFor(0), side = g.sideFor(0);
    if (v === 'ft') g.practiceFT = true;
    p.setPos(rim.x, rim.z - side * (v === 'three' ? 7.6 : v === 'ft' ? 4.6 : 5.2), side > 0 ? 0 : Math.PI);
    g.giveBall(p, 'held');
    g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true, forceJumper: true }); g.step(1 / 60);
    const a = p.action;
    assert.equal(a?.type, 'shoot', `${base}/${v}: a jumper`);
    if (v === 'fade') a.fade = true;
    check(hold(g, p, a, view, 'R', () => ({ mx: 0, mz: 0, shootHeld: true })), a.tRel, `${build.height}"/${build.wingspan}" ${base} ${rel} ${v}`);
    n++;
  }
  assert.ok(n > 150);
});

test('layups: the same, for every package and every coverage', () => {
  for (const build of builds) for (const ls of ['basic', 'euro', 'finger', 'scoop']) for (const [cov, cs] of [['open', 1], ['side', 1], ['side', -1], ['front', 1], ['rim', 1], ['rim', -1], ['trail', 1]]) {
    const { g, p, view } = setup(build, { layup: 'layup_' + ls });
    const rim = g.rimFor(0), side = g.sideFor(0);
    p.setPos(rim.x, rim.z - side * 3.4, side > 0 ? 0 : Math.PI); p.vz = side * 4; g.giveBall(p, 'dribble');
    g.setInput({ mx: 0, mz: 0, shootHeld: true });
    const a = g.startLayup(p, rim, {});
    a.cov = cov; a.covSide = cs;
    const hand = (cov === 'side' || cov === 'rim') && cs > 0 ? 'L' : 'R';
    check(hold(g, p, a, view, hand, () => ({ mx: 0, mz: side * 0.5, shootHeld: true })), a.tRel, `${build.height}"/${build.wingspan}" ${ls} ${cov}${cs > 0 ? '' : ' (other side)'}`);
  }
});
