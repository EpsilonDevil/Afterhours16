// v0.4.8.9 (docs/GAUNTLET.md §13): the Hillside Bandana's hanging ends drape over the head, the neck and the shoulders
// instead of passing through them. Every vertex of the ends, as drawn (the tails mesh on the bone char/sway.js writes),
// is sampled through the animations a player goes through: standing, sprinting and turning hard, jumpers, layups,
// dunks, a park game's worth of play, and every celebration (the Passinho too); none may be inside the head or the
// neck (a sphere round the head's centre, 0.95 of its radius; a capsule up the neck, half the head's radius). The same
// poses without the bodies do go through (so this checks the draping, not a pose that never reached the head).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Animator } from '../client/js/char/animator.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';
import { TailSway, drapeBodies, DRAPE } from '../client/js/char/sway.js';
import { Player } from '../client/js/sim/player.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam, resolveLook } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import * as M from '../client/js/core/math.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const catalog = Object.fromEntries(JSON.parse(src('server/catalog.json')).map(i => [i.id, i]));
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const segDist = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, t = l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0; return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t); };
const HEAD_IN = 0.95, NECK_IN = 0.5;

// a player wearing the bandana, posed through the animator; every frame the ends are swung (draped or not) and every
// vertex of them is measured against the head and the neck. worst: the deepest each got (in head radii; < 0 is inside)
function wearer(build, drape) {
  const look = resolveLook({ ...build, equipment: { headband: 'fv_band_bandana' } }, catalog);
  const model = new AthleteModel(build, look, 0.5); model.buildGear(look.gear);
  const rig = new Rig(model), world = M.m4(), bt = model.bandanaTail, R = model.d.headR, hc = model.headCenter(), tail = model.bandanaTailGeo;
  const sway = new TailSway(bt.pivot, bt.dir, bt.len, { samples: bt.samples }), out = new Float32Array(16), bodies = [];
  const worst = { head: 9, neck: 9, where: '' };
  let clock = 0, label = '';
  const view = {
    H: model.d.H, model, rig, y: 0,
    update(pose, x, y, z, yaw, o) {
      rig.solve(pose, o); M.m4fromYaw(world, x, y, z, yaw); rig.updateSkin(world); clock += 1 / 60;
      const S = rig.skin.subarray(B.head * 16, B.head * 16 + 16);
      sway.step(S, out, clock, drape ? drapeBodies(rig, world, hc, R, bodies) : null);
      assert.ok(out.every(Number.isFinite), `${label}: a finite matrix`);
      const c = xf(S, hc), n0 = rig.jointWorld(world, B.neck), n1 = rig.jointWorld(world, B.head);
      for (let i = 0; i < tail.position.length; i += 3) {
        const q = xf(out, [tail.position[i], tail.position[i + 1], tail.position[i + 2]]);
        const dh = (Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) - HEAD_IN * R) / R, dn = (segDist(q, n0, n1) - NECK_IN * R) / R;
        if (dh < worst.head) { worst.head = dh; if (dh < 0) worst.where = label; }
        if (dn < worst.neck) { worst.neck = dn; if (dn < 0) worst.where = label; }
      }
    },
  };
  const anim = new Animator(view);
  return { view, anim, worst, setLabel: l => { label = l; }, sway, model };
}
const BUILD = { height: 78, weight: 210, wingspan: 82 };
const CELEBRATIONS = ['airplane', 'bow', 'crown', 'dust', 'goggles', 'mic', 'ooh', 'roar', 'chestbeat', 'runningman', 'zombie', 'passinho', 'hammer', 'scorekeeper', 'sprinkler', 'lawnmower', 'chef', 'wings', 'calm', 'swim', 'guitar', 'drum', 'robot', 'boxer', 'cold', 'clock', 'sleep', 'stir', 'archer'];

// the run of it: standing, a sprint with hard plants and turns, every celebration, then a park game (jumpers, layups,
// dunks, cuts, a stumble or two), the bandana on three of its players
function everything(drape) {
  const results = [];
  { const e = makeTeam(new RNG(5), 1, { catalog, level: 0.7 })[0], p = new Player(0, 0, e, catalog), w = wearer(e.build || BUILD, drape);
    w.setLabel('idle'); for (let i = 0; i < 60; i++) w.anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
    w.setLabel('sprint and hard turns'); let z = 0;
    for (let i = 0; i < 300; i++) { const dir = Math.floor(i / 45) % 2 ? -1 : 1, side = Math.floor(i / 90) % 2 ? 1.5 : 0; p.vx = side * dir; p.vz = 7.5 * dir; z += p.vz / 60; p.z = z; w.anim.update(1 / 60, { x: 0, y: 0, z, facing: Math.atan2(p.vx, p.vz) }, p, null, null); }
    results.push(w.worst); }
  for (const kind of CELEBRATIONS) {
    const e = makeTeam(new RNG(3), 1, { catalog, level: 0.7 })[0], p = new Player(0, 0, e, catalog), w = wearer(e.build, drape);
    w.setLabel('celebration ' + kind);
    for (let i = 0; i < 30; i++) w.anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
    p.startAction('celebrate', 2.4, { kind });
    for (let i = 0; i < 150 && p.action.t < p.action.dur; i++) { p.action.t += 1 / 60; w.anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null); }
    results.push(w.worst);
  }
  const rng = new RNG(31), rosters = [makeTeam(rng, 3, { catalog, level: 0.8 }), makeTeam(rng, 3, { catalog, level: 0.55 })];
  const g = new Game({ mode: 'park', full: true, seed: 31, rosters, catalog, target: 21, quarterLen: 150, quarters: 4, difficulty: 0.6 });
  const ws = g.players.slice(0, 3).map(p => ({ p, w: wearer(p.build || BUILD, drape) }));
  const proxy = { get ball() { return g.ball; }, holder: () => g.holder(), opponents: p => g.opponents(p), players: g.players, rimFor: t => g.rimFor(t), worldOf: q => ({ x: q.x, z: q.z }) };
  const seen = new Set();
  const frame = () => { g.step(1 / 60); for (const { p, w } of ws) { const a = p.action ? p.action.type + (p.action.kind ? ':' + p.action.kind : '') : 'move'; seen.add(a); w.setLabel('game ' + a); w.anim.update(1 / 60, { x: p.x, y: p.y, z: p.z, facing: p.facing }, p, proxy, g.ball); } };
  for (let f = 0; f < 60 * 75 && !g.over; f++) frame();
  // and dunks, on purpose: the ball to each of them under the rim, a dunk, the play carried on
  for (const { p } of ws) {
    if (g.over) break;
    g.phase = 'live'; g.possession = p.team; g.giveBall(p, 'held');
    const rim = g.rimFor(p.team); p.x = rim.x + 0.6; p.z = rim.z - Math.sign(rim.z || 1) * 3.2;
    g.startDunk(p, rim, { forced: true, able: true });
    for (let f = 0; f < 120; f++) frame();
  }
  for (const { w } of ws) results.push(w.worst);
  return { results, seen };
}

test('the ends drape over the head, the neck and the shoulders: no vertex goes inside the head or the neck, in anything he does', () => {
  const { results, seen } = everything(true);
  for (const r of results) {
    assert.ok(r.head >= 0, `inside the head by ${(-r.head).toFixed(3)} head radii (${r.where})`);
    assert.ok(r.neck >= 0, `inside the neck by ${(-r.neck).toFixed(3)} head radii (${r.where})`);
  }
  for (const a of ['shoot:jumper', 'layup', 'dunk']) assert.ok([...seen].some(s => s.startsWith(a)), `the run had a ${a} (${[...seen].join(' ')})`);
});

test('without the bodies the same poses go through the head (so it is the draping that keeps them out)', () => {
  const { results } = everything(false);
  assert.ok(results.some(r => r.head < -0.2), `the undraped ends reach ${Math.min(...results.map(r => r.head)).toFixed(2)} head radii`);
});

test('the bodies come from the rig, the samples from the bandana itself, and the view drapes them every frame', () => {
  const look = resolveLook({ ...BUILD, equipment: { headband: 'fv_band_bandana' } }, catalog);
  const m = new AthleteModel(BUILD, look, 1); m.buildGear(look.gear);
  const bt = m.bandanaTail, R = m.d.headR, c = m.headCenter();
  assert.equal(bt.samples.length, 36, 'three points down the inner face of each end, six rings, two ends');
  for (const s of bt.samples) assert.ok(Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2]) > DRAPE.head * R * 0.98, 'in the bind pose they hang clear of the head');
  const rig = new Rig(m), world = M.m4(); rig.solve(new Animator({ H: m.d.H, model: m, rig, y: 0, update() {} }).pose); rig.updateSkin(world);
  const bodies = drapeBodies(rig, world, c, R);
  assert.equal(bodies.length, 4);
  assert.ok(bodies.every(b => b.r > 0 && [...b.a, ...b.b].every(Number.isFinite)));
  assert.ok(Math.abs(bodies[0].r - DRAPE.head * R) < 1e-9 && bodies[1].r < bodies[0].r && bodies[3].a[0] > bodies[3].b[0], 'the head, the neck, the back and the shoulders (left to right)');
  // standing still and level they hang free (nothing to drape over), as before
  const sw = new TailSway(bt.pivot, bt.dir, bt.len, { samples: bt.samples }), out = new Float32Array(16);
  for (let f = 0; f < 30; f++) sw.step(rig.skin.subarray(B.head * 16, B.head * 16 + 16), out, f / 60, bodies);
  assert.ok(sw.angle < 0.6, `standing: ${sw.angle.toFixed(2)} rad from the bone's own pose`);
  const v = src('client/js/char/view.js');
  assert.ok(v.includes('new TailSway(bt.pivot, bt.dir, bt.len, { samples: bt.samples })'), 'the view swings them with the samples');
  assert.ok(v.includes('const bodies = drapeBodies(this.rig, this.world, this.tailHC, this.model.d.headR, this.tailBodies);') && v.includes('this.tailSway.step(this.rig.skin.subarray(h, h + 16), this.tailBones.subarray(h, h + 16), t, bodies);'), 'and the bodies every frame');
});
