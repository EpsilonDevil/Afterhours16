// v0.4.8.5 quick patch: the Sharp Eye release placed for its doubled hop. The ball goes at the top of the 2.0 hop, so it
// leaves twice as high over his standing release point as it did on the old 1.0 hop, the same way in a game, for the AI,
// in the store / My Player preview (the game's own hop: shots.js jumperHop) and on the shot meter (its ideal is the top);
// the defense still measures it as if from the old height (showK), the AI's estimate included; the heels float at the top
// of the hop it actually is; and a Sharp Eye holder's store preview of another base shows that base.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT, GRAVITY } from '../client/js/sim/constants.js';
import { blankIntent } from '../client/js/sim/player.js';
import { physical } from '../client/js/sim/ratings.js';
import * as S from '../client/js/sim/shots.js';
import { PreviewSim } from '../client/js/game/preview.js';
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { P } from '../client/js/char/pose.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const tick = (g, it = {}) => { g.setInput({ ...blankIntent(), ...it }); g.step(DT); return g.events; };
// the catalog with the Sharp Eye base on its old 1.0 hop (v0.4.8), for comparison
const oldHop = { ...catalog, js_base_sharpeye: { ...catalog.js_base_sharpeye, jump: 1.0 } };

// a perfect release (at the ideal moment, as a green) from `dist` m in a practice game; what the ball and his body were
// doing the moment it left his hands, his highest point, and (anim) the animator's leg targets at that moment
function jumper({ cat = catalog, vert = 80, equip = S.SHARP_EYE_PKG, dist = 5, anim = false } = {}) {
  const me = makeTeam(new RNG(8), 1, { catalog: cat, level: 0.8 })[0];
  me.build = { ...me.build, archetype: 'sharpshooter', icon_badge: 'sharp_eye', attributes: { ...me.build.attributes, vertical: vert }, equipment: { ...me.build.equipment, ...equip } }; me.human = true;
  const g = new Game({ mode: 'practice', seed: 3, rosters: [[me], []], catalog: cat }), p = g.players[0], rim = g.rimFor(0);
  p.setPos(rim.x, rim.z - g.sideFor(0) * dist, 0); g.giveBall(p, 'held');
  let A = null;
  if (anim) { const model = new AthleteModel(me.build, {}, 1), rig = new Rig(model); A = new Animator({ H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } }); }
  let rel = null;
  const release = g.releaseShot.bind(g);
  g.releaseShot = (q, a) => { if (q === p) rel = { t: a.t, py: p.y, ball: g.holdPoint(p).y }; return release(q, a); };
  tick(g, { shoot: 'press', shootHeld: true });
  const a = p.action;
  a.releaseAt = a.tRel;
  let top = 0, feet = null;
  for (let i = 0; i < 150 && !(a.released && !p.airborne); i++) {
    const was = a.released;
    tick(g, { shootHeld: true });
    top = Math.max(top, p.y);
    if (A) {
      const b = g.ball;
      A.update(DT, { x: p.x, y: p.y, z: p.z, facing: p.facing }, p, g, { x: b.x, y: b.y, z: b.z });
      if (a.released && !was) feet = { y: A.target[P.footL + 1], z: A.target[P.footL + 2] };
    }
  }
  return { g, p, a, rel, top, feet, tUp: Math.sqrt(2 * a.jumpH / GRAVITY) };
}

test('in a game the Sharp Eye ball goes at the top of its doubled hop: twice as high over his standing release as on the old 1.0 hop', () => {
  for (const vert of [45, 80, 99]) {
    for (const dist of [5, 7.6]) {
      const now = jumper({ vert, dist }), old = jumper({ cat: oldHop, vert, dist });
      assert.equal(now.a.showK, 0.5); assert.equal(old.a.showK, 0);
      for (const [r, nm] of [[now, '2.0'], [old, '1.0']]) {
        assert.ok(r.rel, `released (${nm})`);
        // the ideal release (the middle of the green window, the meter's top) is the top of the hop...
        assert.ok(Math.abs(r.a.takeoff + r.tUp - r.a.tRel) < 1e-9, `the apex is the ideal release (${nm}, vert ${vert})`);
        // ...and that's where the ball leaves: within a sim tick of it, at his full height
        assert.ok(r.rel.py >= 0.99 * r.top, `${nm} hop, vert ${vert}, ${dist} m: let go at ${r.rel.py.toFixed(3)} m of a ${r.top.toFixed(3)} m hop`);
      }
      // the ball sits in the same place on his body (the base's release point); the hop is what lifts it, so its height
      // over his standing release point is how high he is, twice what it was
      assert.ok(Math.abs((now.rel.ball - now.rel.py) - (old.rel.ball - old.rel.py)) < 1e-9, 'the same release point on the body');
      const k = now.rel.py / old.rel.py;
      assert.ok(k > 1.95 && k < 2.1, `vert ${vert}, ${dist} m: ${now.rel.py.toFixed(3)} m over his standing release against ${old.rel.py.toFixed(3)} m (×${k.toFixed(3)})`);
    }
  }
  // the timing feel is the base's own: the doubled hop changed when he leaves the floor, not when the ball goes
  const now = jumper(), old = jumper({ cat: oldHop });
  assert.equal(now.a.tRel, old.a.tRel);
  assert.ok(now.a.takeoff < old.a.takeoff - 0.08, 'off the floor sooner, to be at the top in time');
});

test('the game, the AI and the store preview time the hop the same way (shots.js jumperHop); the defense counts a 1.0 hop', () => {
  // the game's shot is jumperHop's numbers exactly, for the Sharp Eye and for an ordinary base
  for (const equip of [S.SHARP_EYE_PKG, { jumpshot: 'js_base_standard', release: 'release_classic' }]) {
    const r = jumper({ equip, dist: 7.6 }), pkg = r.p.shotPkg;
    const h = S.jumperHop(pkg, r.p.phys.vertical, r.a.tRel, { dRim: r.a.dRim, stamina: r.stamina0 ?? r.p.stamina });
    assert.ok(Math.abs(h.jumpH - r.a.jumpH) < 0.02 && h.showK === r.a.showK, equip.jumpshot);
  }
  const pkg = S.jumpshotPackage({ icon_badge: 'sharp_eye', equipment: S.SHARP_EYE_PKG }, catalog);
  const h = S.jumperHop(pkg, 0.7, 0.52, { dRim: 5 });
  assert.ok(Math.abs(h.takeoff + h.tUp - 0.52) < 1e-12, 'released right at the top');
  assert.equal(h.showK, 0.5);
  assert.equal(S.jumperHop(pkg, 0.7, 0.52, { close: true }).showK, 0, 'a close shot is a close shot');
  // every jumper the game times (set, moving, pull-up, running fade, pro hop, step-back, fade; mid-range or three) at any
  // vertical up to 99, fresh legs: the doubled hop leaves the floor in time for the ball to go at the top (the 0.12 s
  // floor it had sent a good leaper's pull-up up to 77 ms early, on the way up; SHOW_HOP_FLOOR never binds)
  for (const v of [40, 70, 85, 99]) {
    const vert = physical({ attributes: { vertical: v } }).vertical;
    for (const o of [{}, { three: true }, { moving: 3 }, { hustle: 'pullup' }, { hustle: 'pullup', three: true }, { hustle: 'runfade' }, { hustle: 'prohop' }, { stepback: true }, { fade: true }]) {
      const tRel = pkg.tRel * S.jumperTimingK(o), q = S.jumperHop(pkg, vert, tRel, { dRim: 5 });
      assert.ok(q.takeoff > S.SHOW_HOP_FLOOR && Math.abs(q.takeoff + q.tUp - tRel) < 1e-12, `vertical ${v} ${JSON.stringify(o)}: off the floor at ${q.takeoff.toFixed(3)} s`);
    }
  }
  const std = S.jumpshotPackage({ equipment: { jumpshot: 'js_base_standard', release: 'release_classic' } }, catalog), hs = S.jumperHop(std, 0.7, std.tRel, { dRim: 5 });
  assert.equal(hs.showK, 0);
  assert.ok(Math.abs(hs.takeoff - Math.max(0.2, std.tRel - hs.tUp * 0.9)) < 1e-12, 'the other bases: just before the top, as always');
  // an AI Sharp Eye holder: the same hop, the ball at the top; and his read of the defense is the defense's own: the rise
  // that counts is a 1.0 hop's (the extra height is for the eye), not the 2.0 hop's
  const t = makeTeam(new RNG(3), 1, { catalog, level: 0.8 }), o = makeTeam(new RNG(4), 1, { catalog, level: 0.6 });
  const g = new Game({ mode: 'park', seed: 3, rosters: [[{ ...t[0], icon: 'sharp_eye' }], o], catalog, target: 11 });
  const ai = g.players[0], d = g.players[1], rim = g.rimFor(0), side = g.sideFor(0);
  assert.equal(ai.shotPkg.style, 'sharpeye');
  ai.setPos(0, rim.z - side * 6, 0); d.setPos(0, rim.z - side * 4.9, Math.PI);
  const est = q => g.ai.estimateContest(ai, [d], rim, 0);
  const se = est(), pk0 = ai.shotPkg;
  ai.shotPkg = { ...pk0, jumpK: 1 }; const one = est();
  ai.shotPkg = { ...pk0, jumpK: 0.75 }; const low = est();
  ai.shotPkg = pk0;
  assert.ok(se > 0, 'a defender in his face');
  assert.equal(se, one, 'the AI reads the Sharp Eye shot as a 1.0 hop, as the defense measures it');
  assert.ok(low > one, 'a lower hop is still easier to contest');
});

test('the store preview releases the Sharp Eye at the top of the doubled hop too, twice as high as the old hop, as the game does', () => {
  const preview = (cat, vert, equip = S.SHARP_EYE_PKG, icon = 'sharp_eye') => {
    const me = makeTeam(new RNG(8), 1, { catalog: cat, level: 0.8 })[0];
    const build = { ...me.build, archetype: 'sharpshooter', icon_badge: icon, attributes: { ...me.build.attributes, vertical: vert }, equipment: { ...me.build.equipment, ...equip } };
    const sim = new PreviewSim(); sim.setPlayer(build, cat); sim.setPreview('jumpshot');
    const p = sim.player;
    let rel = null, top = 0, a = null;
    for (let i = 0; i < 200; i++) {
      const y0 = p.y, o = sim.step(1 / 60, 0);
      a = a || p.action; top = Math.max(top, p.y);
      if (o.release && !rel) rel = { y: y0 };
      if (rel && !p.airborne && i > 60) break;
    }
    return { p, a, rel, top, tUp: Math.sqrt(2 * a.jumpH / GRAVITY) };
  };
  for (const vert of [45, 80, 99]) {
    const now = preview(catalog, vert), old = preview(oldHop, vert);
    const h = S.jumperHop(now.p.shotPkg, now.p.phys.vertical, now.a.tRel, { dRim: 5 });
    assert.equal(now.a.takeoff, h.takeoff, 'the game\'s own hop'); assert.equal(now.a.jumpH, h.jumpH);
    // (it used to leave the floor at 0.2 s at the earliest and let go 0.9 of the way up: 50-105 ms before the top)
    assert.ok(now.rel.y >= 0.995 * now.top, `vert ${vert}: let go at ${now.rel.y.toFixed(3)} m of ${now.top.toFixed(3)} m`);
    const k = now.rel.y / old.rel.y;
    assert.ok(k > 1.95 && k < 2.1, `vert ${vert}: ×${k.toFixed(3)}`);
  }
  // the other bases are previewed as they always were
  const std = preview(catalog, 80, { jumpshot: 'js_base_standard', release: 'release_classic' }, null);
  assert.ok(Math.abs(std.a.takeoff - Math.max(0.2, std.a.tRel - std.tUp * 0.9)) < 1e-12);
  // a Sharp Eye holder trying another base on in the store sees that base, as he'd shoot it in his games
  const dip = preview(catalog, 80, { jumpshot: 'js_base_dip', release: 'release_classic' });
  assert.equal(dip.p.shotPkg.style, 'dip'); assert.equal(dip.p.shotPkg.release, 'classic'); assert.equal(dip.p.shotPkg.jumpK, catalog.js_base_dip.jump);
  const own = preview(catalog, 80);
  assert.equal(own.p.shotPkg.style, 'sharpeye'); assert.equal(own.p.shotPkg.release, 'sharpeye');
});

test('the Sharp Eye heels float at the top of the hop he actually takes (timed on the rise, not in seconds)', () => {
  const now = jumper({ anim: true }), old = jumper({ cat: oldHop, anim: true });
  assert.ok(now.feet && old.feet);
  // at the release: the same share of the float on either hop (part way up, rising through the top), where in seconds
  // the doubled hop's would have long finished before it
  assert.ok(Math.abs(now.feet.y - old.feet.y) < 0.012, `heels ${now.feet.y.toFixed(3)} against ${old.feet.y.toFixed(3)} (old hop)`);
  const share = (now.feet.y - 0.085) / 0.07;
  assert.ok(share > 0.35 && share < 0.92, `float ${share.toFixed(2)} of the way at the release`);
});
