// v0.4.7.5 quick patch 3 (screens): a screen's quality comes from the run-in speed, how set and square the screener
// is, a called screen, the size of both men, Strength and Brick Wall. Good screens visibly stop the defender, and a
// Brick Wall screener's perfect screen puts him on the floor.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, SCREEN } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { physical } from '../client/js/sim/ratings.js';
import { bk } from '../client/js/sim/badges.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const game = (seed = 5, size = 3, mode = 'park') => {
  const rng = new RNG(seed);
  return new Game({ mode, seed, rosters: [makeTeam(rng, size, { catalog, level: 0.7 }), makeTeam(rng, size, { catalog, level: 0.7 })], catalog, target: 21, quarterLen: 120, quarters: 4, difficulty: 0.6 });
};
// a player shaped like a build: height (in), weight (lb), strength rating, Brick Wall tier
const shape = (p, { h, w, strength, bw = 0 }) => {
  const b = { height: h, weight: w, wingspan: h + 3, attributes: { ...p.raw, strength } };
  p.phys = physical(b); p.raw.strength = strength; p.ratings.strength = strength;
  p.badges = { ...p.badges }; delete p.badges.brick_wall; if (bw) p.badges.brick_wall = bw;
};
// screener s set at the origin facing +z, defender d running at him from +z at `v` m/s
const setup = (g, s, d, v, { face = true, set = true, called = false } = {}) => {
  g.possession = s.team; g.phase = 'live';
  const h = g.mates(s)[0]; g.giveBall(h, 'dribble'); h.setPos(-3, -1, 0);
  s.setPos(0, 0, face ? 0 : Math.PI / 2); s.vx = 0; s.vz = set ? 0 : 0.7; s.action = null; s.screening = called ? 0.5 : 0;
  d.setPos(0, s.phys.radius + d.phys.radius - 0.02, Math.PI); d.vx = 0; d.vz = -v; d.action = null; d.bumpT = 0; d.airborne = false;
};

test('screen quality: speed into it, set and square, called, size, Strength and Brick Wall all count', () => {
  const g = game(5), s = g.players[0], d = g.players[3];
  const q = (ss, dd, v, o) => { shape(s, ss); shape(d, dd); setup(g, s, d, v, o); return g.screenQuality(s, d, v).q; };
  const big = { h: 84, w: 265, strength: 90 }, guard = { h: 74, w: 180, strength: 55 };
  // the same screener hits harder the faster the defender runs into him
  assert.ok(q(big, guard, 4.5) > q(big, guard, 2) + 0.1, 'run-in speed');
  // set and square beat settling and sideways
  assert.ok(q(big, guard, 3) > q(big, guard, 3, { set: false }) + 0.05, 'set');
  assert.ok(q(big, guard, 3) > q(big, guard, 3, { face: false }) + 0.08, 'square');
  assert.ok(q(big, guard, 3, { called: true }) > q(big, guard, 3), 'called');
  // size and strength: a big on a guard beats a guard on a big, and strength alone counts
  assert.ok(q(big, guard, 3) > q(guard, big, 3) + 0.25, `size: big on guard ${q(big, guard, 3).toFixed(2)} vs guard on big ${q(guard, big, 3).toFixed(2)}`);
  const same = { h: 79, w: 215, strength: 60 };
  assert.ok(q({ ...same, strength: 95 }, same, 3) > q(same, same, 3) + 0.03, 'Strength rating');
  // Brick Wall per tier, on either side
  const t = [0, 1, 2, 3, 4].map(bw => q({ ...same, bw }, same, 3));
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], `screener's Brick Wall tier ${i}`);
  assert.ok(q(same, { ...same, bw: 4 }, 3) < q(same, same, 3) - 0.15, 'the defender\'s Brick Wall fights through');
  // bounded
  assert.ok(q({ h: 87, w: 290, strength: 99, bw: 4 }, { h: 70, w: 160, strength: 40 }, 6) <= 1 && q({ h: 70, w: 160, strength: 40 }, { h: 87, w: 290, strength: 99, bw: 4 }, 1.2) >= 0);
});

test('screens stop the defender: speed is taken, he is slowed, a good one stops him dead, a weak one just staggers him', () => {
  const g = game(6), s = g.players[0], d = g.players[3];
  // a glancing screen: small screener, defender jogging in sideways to him
  shape(s, { h: 74, w: 175, strength: 45 }); shape(d, { h: 82, w: 250, strength: 90 });
  setup(g, s, d, 1.6, { face: false, set: false });
  let r = g.screenHit(s, d);
  assert.ok(!r.knock && !r.stun, `weak screen q ${r.q.toFixed(2)}: no stop`);
  assert.ok(d.speed < 1.6 * (1 - SCREEN.stop0) + 1e-9 && d.speed > 0.2, `takes some speed (${d.speed.toFixed(2)} m/s left)`);
  assert.ok(d.bumpT >= SCREEN.slow0 && d.action?.type === 'bump', 'slowed and staggered');
  // a solid screen: a big set and square on a sprinting guard, no Brick Wall -> stopped dead, not knocked down
  shape(s, { h: 83, w: 255, strength: 85 }); shape(d, { h: 75, w: 185, strength: 55 });
  setup(g, s, d, 4.5, { called: true });
  r = g.screenHit(s, d);
  assert.ok(r.stun && !r.knock, `solid screen q ${r.q.toFixed(2)}: stopped, not floored`);
  assert.equal(d.action?.type, 'stumble'); assert.ok(d.action.back && !d.action.fall && d.action.screen);
  assert.ok(d.action.dur >= SCREEN.stun0 && d.action.dur <= SCREEN.stun0 + SCREEN.stun1 + 1e-9);
  assert.ok(d.speed < 0.5, `nearly all his speed is gone (${d.speed.toFixed(2)})`);
  // the stumble locks him: stepping the game, he does not get past the screener for the duration
  const z0 = d.z; d.intent = { ...d.intent, mx: 0, mz: -1, sprint: true };
  for (let i = 0; i < 18; i++) { d.intent = { ...d.intent, mx: 0, mz: -1, sprint: true }; g.moveOne(d, 1 / 60); g.tickAction?.(d, 1 / 60); }
  assert.ok(d.z >= z0 - 0.15, `held where he was stopped (${(z0 - d.z).toFixed(2)} m)`);
  // the screener holds his ground: his mass in the contact goes up with strength and Brick Wall
  assert.ok(g.screenAnchor(s) > 1.5);
  shape(s, { h: 83, w: 255, strength: 85, bw: 4 }); s.screening = 0.5;
  assert.ok(g.screenAnchor(s) > 3);
});

test('Brick Wall: a perfect screen knocks the defender to the floor; without the badge the same screen only stops him', () => {
  const g = game(7), s = g.players[0], d = g.players[3];
  const big = { h: 85, w: 270, strength: 95 }, guard = { h: 74, w: 180, strength: 55 };
  // HOF Brick Wall, set, square, called, on a sprinting guard
  shape(s, { ...big, bw: 4 }); shape(d, guard);
  setup(g, s, d, 5, { called: true });
  let r = g.screenHit(s, d);
  assert.ok(r.knock, `perfect HOF screen q ${r.q.toFixed(2)} knocks him down`);
  assert.equal(d.action?.type, 'stumble'); assert.ok(d.action.fall && d.action.screen && d.action.hard === 4);
  const k4 = bk({ brick_wall: 4 }, 'brick_wall');
  assert.ok(d.action.dur >= SCREEN.fall0 + SCREEN.fallk * k4 - 1e-9 && d.action.dur <= SCREEN.fall0 + SCREEN.fallk * k4 + 0.4 + 1e-9, `on the floor ${d.action.dur.toFixed(2)} s`);
  assert.ok(d.vz > 0 && d.speed < 1.5, 'knocked back off the screen');
  const ev = g.events.filter(e => e.type === 'screen').pop();
  assert.ok(ev && ev.knock && ev.q >= 0.7 && ev.player === s.id && ev.victim === d.id);
  // the same screen without the badge: stopped dead, never floored
  shape(s, big); setup(g, s, d, 5, { called: true });
  r = g.screenHit(s, d);
  assert.ok(!r.knock && r.stun, `no badge: q ${r.q.toFixed(2)} stops, no knockdown`);
  // bronze needs a better screen than Hall of Fame for the knockdown: a bronze big on a guard at a slow jog is a stop,
  // the HOF big is a knockdown
  shape(s, { ...big, bw: 1 }); setup(g, s, d, 1.6); r = g.screenHit(s, d);
  const bronze = r;
  shape(s, { ...big, bw: 4 }); setup(g, s, d, 1.6); r = g.screenHit(s, d);
  assert.ok(!bronze.knock && r.knock, `bronze q ${bronze.q.toFixed(2)} (no knockdown) vs HOF q ${r.q.toFixed(2)} (knockdown) at a slow jog`);
  // a like-sized defender with his own Brick Wall fights through an HOF screen on his feet
  shape(d, { ...big, bw: 4 }); setup(g, s, d, 4); r = g.screenHit(s, d);
  assert.ok(!r.knock, `Brick Wall vs Brick Wall q ${r.q.toFixed(2)}: stays up`);
  // a defender in the air or already shooting a block is never floored by a screen
  shape(d, guard); setup(g, s, d, 5, { called: true }); d.airborne = true; r = g.screenHit(s, d);
  assert.ok(!r.knock && !r.stun && d.action == null, 'airborne: slowed only');
});

test('screens in play: they still happen in park games, carry their quality, and knockdowns are rare', () => {
  let screens = 0, knocks = 0, stuns = 0, qs = 0, games = 0;
  for (const seed of [31, 32, 33, 34]) {
    const g = game(seed);
    for (let i = 0; i < 60 * 240 && !g.over; i++) {
      g.step(1 / 60);
      for (const e of g.events) if (e.type === 'screen') { screens++; qs += e.q; if (e.knock) knocks++; if (e.stun) stuns++; }
    }
    games++;
  }
  assert.ok(screens > 6, `${screens} screens in ${games} games`);
  assert.ok(qs / screens > 0.25 && qs / screens < 0.85, `mean quality ${(qs / screens).toFixed(2)}`);
  assert.ok(knocks <= screens * 0.35, `${knocks} knockdowns of ${screens} screens (${stuns} stops)`);
});

// ---- the knockdown on the body ----
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B as BONE } from '../client/js/char/skeleton.js';

test('the Brick Wall knockdown reads on the body: thrown back, down onto the floor, then back up on his feet', () => {
  const g = game(8), s = g.players[0], d = g.players[3];
  shape(s, { h: 85, w: 270, strength: 95, bw: 4 }); shape(d, { h: 74, w: 180, strength: 55 });
  setup(g, s, d, 5, { called: true });
  const r = g.screenHit(s, d);
  assert.ok(r.knock);
  const model = new AthleteModel(d.entry.build, {}, 0.5), rig = new Rig(model);
  const view = { H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } };
  const anim = new Animator(view), H = model.d.H;
  let minHip = 9, maxBack = 0, bad = 0, lowFoot = 0;
  const a = d.action, dur = a.dur;
  for (let i = 0; i < Math.ceil(dur * 60) + 30; i++) {
    g.tickAction(d, 1 / 60);
    anim.update(1 / 60, { x: d.x, y: d.y, z: d.z, facing: d.facing }, d, g, { x: g.ball.x, y: g.ball.y, z: g.ball.z });
    const hip = rig.pos[BONE.hips], fl = rig.pos[BONE.footL], fr = rig.pos[BONE.footR];
    for (const v of [hip, fl, fr]) for (const c of v) if (!Number.isFinite(c)) bad++;
    minHip = Math.min(minHip, hip[1]);
    // "back" is the opposite of the facing: the hips travel behind the feet as he goes down
    const bx = -Math.sin(d.facing), bz = -Math.cos(d.facing);
    maxBack = Math.max(maxBack, (hip[0] - (fl[0] + fr[0]) / 2) * bx + (hip[2] - (fl[2] + fr[2]) / 2) * bz);
    if (Math.min(fl[1], fr[1]) < -0.03) lowFoot++;
  }
  assert.equal(bad, 0, 'finite joints');
  assert.ok(minHip < 0.3 * H, `hips reach the floor (lowest ${(minHip / H).toFixed(2)} H)`);
  assert.ok(maxBack > 0.08, `he goes down backwards (${maxBack.toFixed(2)} m)`);
  assert.equal(lowFoot, 0, 'feet never go under the floor');
  assert.equal(d.action, null, 'back on his feet at the end');
  assert.ok(rig.pos[BONE.hips][1] > 0.45 * H, 'standing again');
});
