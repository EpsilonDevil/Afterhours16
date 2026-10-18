// v0.4.8.5 The Clamp (the Lockdown Icon badge): "+5% Perimeter D and Steal (can pass 99). Unlocks steal animations that
// exist only for this badge." Every steal try the holder makes shows one (sim/clamp.js, the bodies char/clamp.js): a
// reach is one of six reaches picked for the moment (the hand, a low swipe, the ball high, reaching across), a pass he
// picks off one of three pick-offs, a ball he strips off a driver who runs into him the chest-up strip. Nobody else's
// ever does. None of it changes the game (the same reach, the game's RNG untouched, the overlay read by no gameplay
// code); the same seed plays the same ones; the ball he comes up with rides the animation's path into his hands.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../client/js/sim/clamp.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam, makeBot } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { Player } from '../client/js/sim/player.js';
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig, ARM_PROBE_UPPER, ARM_PROBE_FORE, ARM_HEAD_R, segSegDist } from '../client/js/char/rig.js';
import { B as BONE } from '../client/js/char/skeleton.js';
import * as M from '../client/js/core/math.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const REACHES = C.CLAMP_REACHES.map(s => s.id), PICKS = C.CLAMP_PICKS.map(s => s.id), STRIPS = C.CLAMP_STRIPS.map(s => s.id);
const ZERO = { next: () => 0, range: a => a, int: a => a, chance: () => true, pick: arr => arr[0] };

// a park game with a lockdown on team 1 (icon: the Clamp or not), wearing the Clamp's Steal Package (qp6: the full set
// is the package's; tests/v0485clampslot.test.mjs has the slot empty and the item on others)
function park(icon = 'the_clamp', seed = 21) {
  const r = new RNG(seed), A = makeTeam(r, 3, { catalog, level: 0.8 }), Bt = makeTeam(r, 3, { catalog, level: 0.8 });
  const h = makeBot(r, { catalog, level: 0.95, position: 'SG', archetype: 'lockdown' });
  h.build.icon_badge = icon; h.name = 'LOCK'; Bt[0] = h;
  if (icon === 'the_clamp') h.build.equipment = { ...h.build.equipment, steal: C.CLAMP_STEAL_PKG };
  const g = new Game({ mode: 'park', seed, rosters: [A, Bt], catalog, target: 21 });
  return { g, d: g.players.find(p => p.name === 'LOCK') };
}
const animOf = p => (p.action?.type === 'steal' && p.action.clamp) || p.clampFx?.style || null;

test('his own: six reaches, three pick-offs and a strip, keyed to the badge; the reach is the same reach', () => {
  assert.ok(REACHES.length >= 5 && PICKS.length >= 2 && STRIPS.length >= 1);
  assert.equal(new Set([...REACHES, ...PICKS, ...STRIPS]).size, REACHES.length + PICKS.length + STRIPS.length);
  for (const s of [...C.CLAMP_REACHES, ...C.CLAMP_PICKS, ...C.CLAMP_STRIPS]) assert.ok(s.name && s.desc && C.clampName(s.id) === s.name);
  assert.ok(REACHES.includes('vise'), 'the old two-hand clamp is one of them');
  // the same moment, a holder and a lockdown without the badge: the same reach in every field the game reads, the
  // game's RNG untouched by the pick
  for (const [dir, low] of [[null, false], [{ x: 1, z: 0 }, false], [{ x: -1, z: 0 }, false], [null, true]]) {
    const out = [];
    for (const icon of ['the_clamp', null]) {
      const { g, d } = park(icon), h = g.players[0];
      g.phase = 'live'; g.possession = 0; g.giveBall(h, 'dribble');
      h.setPos(0, 3, 0); d.setPos(0.15, 3.8, Math.PI);
      const s0 = g.rng.s; g.startSteal(d, dir, low);
      assert.equal(g.rng.s, s0, 'no draw of the game\'s RNG');
      const a = d.action;
      out.push({ hand: a.hand, low: a.low, aimed: a.aimed, checked: a.checked, dur: a.dur, cool: d.cool.steal, anim: a.clamp, icon: a.icon });
    }
    const [hold, plain] = out;
    assert.ok(REACHES.includes(hold.anim) && hold.icon === 'clamp', `the holder: ${hold.anim}`);
    assert.equal(plain.anim, null); assert.equal(plain.icon, null);
    for (const k of ['hand', 'low', 'aimed', 'checked', 'dur']) assert.equal(hold[k], plain[k], k);
  }
});

test('the reach fits the moment, and is a different one each time, the same for the same game', () => {
  const p = { id: 3, x: 0, z: 0, facing: 0 };
  const pick = (ball, o, tick) => C.pickClampReach(p, ball, { tick, ...o });
  const dribble = y => ({ x: 0.25, z: 0.8, y, mode: 'dribble' }), held = { x: 0.25, z: 0.8, y: 1.1, mode: 'held' };
  // reaching across his body (the hand away from the ball): the slap-down
  for (let i = 0; i < 20; i++) assert.equal(pick(dribble(0.8), { hand: 'R', aimed: true, low: false }, i), 'slap_down');
  const seen = sit => new Set(Array.from({ length: 60 }, (_, i) => sit(i)));
  const low = seen(i => pick(dribble(0.8), { hand: 'L', aimed: true, low: true }, i)), down = seen(i => pick(dribble(0.3), { hand: 'L', aimed: false, low: false }, i));
  for (const s of [low, down]) assert.deepEqual([...s].sort(), ['dig', 'swipe_spin', 'vise']);
  const up = seen(i => pick(held, { hand: 'L', aimed: false, low: false }, i));
  assert.deepEqual([...up].sort(), ['double_tap', 'hip_rip', 'vise']);
  const mid = seen(i => pick(dribble(0.8), { hand: 'L', aimed: false, low: false }, i));
  assert.deepEqual([...mid].sort(), ['dig', 'double_tap', 'hip_rip', 'swipe_spin', 'vise']);
  // never the same twice running where there's a choice
  const q = { id: 1, x: 0, z: 0, facing: 0 }, run = Array.from({ length: 80 }, (_, i) => C.pickClampReach(q, dribble(0.8), { hand: 'L', tick: i * 7 }));
  assert.ok(run.every((s, i) => i === 0 || s !== run[i - 1]));
  // the same count and tick, the same reach (lockstep: every screen deals the same one)
  const q2 = { id: 1, x: 0, z: 0, facing: 0 }, run2 = Array.from({ length: 80 }, (_, i) => C.pickClampReach(q2, dribble(0.8), { hand: 'L', tick: i * 7 }));
  assert.deepEqual(run2, run);
});

test('a pass he picks off shows a pick-off and the ball rides it into his hands; never for anyone else', () => {
  for (const icon of ['the_clamp', null]) {
    const { g, d } = park(icon), [passer, recv] = g.players;
    g.phase = 'live'; g.possession = 0; g.giveBall(passer, 'held');
    for (const q of g.players) q.setPos(-6, 9, 0);
    passer.setPos(0, 2, 0); recv.setPos(0, 9, Math.PI); d.setPos(0, 5, Math.PI); d.facing = Math.PI;
    d.ratings.steal = 99; passer.ratings.pass_accuracy = 40;
    g.startPass(passer, { target: recv.id, type: 'chest' });
    for (let i = 0; i < 60 && g.ball.mode !== 'flight'; i++) g.tickAction(passer, 1 / 60), g.updateBall(1 / 60);
    assert.equal(g.ball.mode, 'flight'); assert.equal(g.ball.kind, 'pass');
    // the ball at his hands: the roll goes his way
    const b = g.ball; b.x = d.x + Math.sin(d.facing) * 0.25 + 0.15; b.z = d.z + Math.cos(d.facing) * 0.25; b.y = 1.25; b.flightTime = 0.5;
    const rng = g.rng; g.rng = ZERO; g.events.length = 0; g.interactions(1 / 60); g.rng = rng;
    assert.ok(g.events.some(e => e.type === 'steal' && e.intercept && e.player === d.id), 'picked off');
    assert.equal(g.ball.holder, d.id);
    if (!icon) { assert.equal(d.clampFx ?? null, null, 'no Clamp animation without the badge'); continue; }
    assert.equal(d.clampFx.kind, 'pick'); assert.ok(PICKS.includes(d.clampFx.style), d.clampFx.style);
    // the ball: from where his hands met it, along the pick, into an ordinary hold by its end
    const at0 = g.holdPoint(d); g.updateBall(1 / 60);
    assert.ok(Math.hypot(at0.x - 0.15 - d.x, at0.z - d.z - 0.25 * Math.cos(d.facing)) < 0.6, 'starts at his hands');
    const pts = [];
    while (d.clampFx) { g.tickAction(d, 1 / 60); g.updateBall(1 / 60); pts.push([g.ball.x, g.ball.y, g.ball.z]); }
    for (const v of pts.flat()) assert.ok(Number.isFinite(v));
    const H = d.phys.H, hs = d.dribble.hand === 'R' ? -1 : 1, end = g.holdPoint(d), want = [d.x + Math.cos(d.facing) * hs * 0.14 + Math.sin(d.facing) * 0.3, 0.56 * H, d.z - Math.sin(d.facing) * hs * 0.14 + Math.cos(d.facing) * 0.3];
    assert.ok(Math.hypot(end.x - want[0], end.y - want[1], end.z - want[2]) < 0.02, 'an ordinary hold after it');
  }
});

test('a ball he strips off a driver who runs into him shows the chest-up strip; never for anyone else', () => {
  for (const icon of ['the_clamp', null]) {
    const { g, d } = park(icon), h = g.players[0];
    g.phase = 'live'; g.possession = 0; g.giveBall(h, 'dribble');
    for (const q of g.players) if (q !== h && q !== d) q.setPos(-6, 9, 0);
    h.setPos(0, 3, 0); h.facing = 0; d.setPos(0, 3 + h.phys.radius + d.phys.radius - 0.05, Math.PI);
    h.vx = 0; h.vz = 4; d.vx = 0; d.vz = 0; h.bumpT = 0; d.bumpT = 0; h.ratings.ball_handle = 30;
    const rng = g.rng; g.rng = ZERO; g.events.length = 0; g.collide(1 / 60); g.rng = rng;
    assert.ok(g.events.some(e => e.type === 'steal' && e.bump && e.player === d.id), 'stripped');
    if (!icon) { assert.equal(d.clampFx ?? null, null); continue; }
    assert.equal(d.clampFx.kind, 'strip'); assert.ok(STRIPS.includes(d.clampFx.style));
    assert.equal(g.ball.mode, 'flight', 'the ball goes where the game sends it: loose');
    let n = 0; while (d.clampFx && n < 200) { g.tickAction(d, 1 / 60); n++; }
    assert.ok(n > 20 && n < 60, `over in ${n} ticks`);
  }
});

test('in games: every steal the holder makes shows a Clamp animation, nobody else\'s ever does, and the same seed plays the same ones', () => {
  const play = (icon, seed) => {
    const { g, d } = park(icon, seed), log = [], miss = [];
    let other = 0, steps = 0;
    while (!g.over && steps < 60 * 60 * 25) {
      g.step(1 / 60); steps++;
      for (const e of g.events) if (e.type === 'steal' && e.player === d.id) { const k = e.intercept ? 'intercept' : e.bump ? 'bump' : 'reach'; const an = animOf(d); log.push(`${g.tick}:${k}:${an}`); if (!an) miss.push(k); }
      for (const q of g.players) if (q !== d && (q.clampFx || q.action?.clamp)) other++;
      if (icon && d.action?.type === 'steal') assert.ok(REACHES.includes(d.action.clamp));
      if (!icon && (d.clampFx || d.action?.clamp)) other++;
    }
    return { log, miss, other };
  };
  let kinds = new Set(), anims = new Set(), steals = 0;
  for (const seed of [21, 33, 47]) {
    const r = play('the_clamp', seed);
    assert.deepEqual(r.miss, [], `seed ${seed}: steals without a Clamp animation: ${r.miss.join(', ')}`);
    assert.equal(r.other, 0);
    for (const l of r.log) { const [, k, an] = l.split(':'); kinds.add(k); anims.add(an); }
    steals += r.log.length;
    if (seed === 21) assert.deepEqual(play('the_clamp', 21).log, r.log, 'the same seed, the same animations');
  }
  assert.ok(steals >= 8, `${steals} steals`); assert.ok(kinds.has('reach'));
  assert.ok(anims.size >= 3, `varied: ${[...anims].join(', ')}`);
  assert.equal(play(null, 21).other, 0, 'the same build without the badge: none');
});

test('the bodies on the rig: finite, and no arm through the body, the head, the legs or the other arm', () => {
  const segPt = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const holdPoint = Game.prototype.holdPoint, bad = [];
  for (const bd of [{ height: 77, weight: 200, wingspan: 81 }, { height: 72, weight: 175, wingspan: 74 }, { height: 82, weight: 240, wingspan: 86 }]) {
    const build = { ...bd, hand: 'R', attributes: {}, icon_badge: 'the_clamp', equipment: {} };
    const model = new AthleteModel(build, {}, 0.5), rig = new Rig(model), H = model.d.H;
    const view = { H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } };
    const p = new Player(0, 0, { build, name: 'C', human: true }, {}), fake = { ball: { mode: 'held', holder: 0 }, phase: 'live', players: [p], reachTop: Game.prototype.reachTop };
    const runs = [];
    for (const style of REACHES) for (const hand of ['L', 'R']) for (const res of ['clean', 'poke']) for (const by of [0.45, 0.85, 1.1]) runs.push({ kind: 'reach', style, hand, res, by });
    for (const style of PICKS) for (const from of [[0.3, 1.1, 0.5], [-0.35, 1.5, 0.45], [0.05, 0.8, 0.6]]) runs.push({ kind: 'pick', style, from });
    for (const side of [1, -1]) runs.push({ kind: 'strip', side });
    for (const r of runs) {
      const anim = new Animator(view); p.action = null; p.clampFx = null; p.setPos(0, 0, 0); p.facing = 0; p.stance = 'defense';
      let has = false, ball = null, fT = 0, fH = 0, fL = 0, arms = 0, nan = 0;
      const sd = r.hand === 'L' ? 1 : -1;
      if (r.kind === 'reach') p.startAction('steal', 0.46, { checked: false, hand: r.hand, low: r.by < 0.5, aimed: true, icon: 'clamp', clamp: r.style });
      for (let i = 0; i < 50; i++) {
        const t = (i + 1) / 60, a = p.action;
        if (a) a.t += 1 / 60;
        if (r.kind === 'reach') {
          const bx = sd * (r.style === 'slap_down' ? -1 : 1) * 0.22;
          if (!has) ball = r.res === 'poke' && a && a.t >= 0.13 ? { x: bx + sd * 2.5 * (a.t - 0.13), y: r.by, z: 0.8 + 3 * (a.t - 0.13) } : { x: bx, y: r.by, z: 0.8 };
          if (a && a.t >= 0.13 && r.res === 'clean' && !has) { C.clampGot(p, a, ball); has = true; }
          if (has) { const q = holdPoint.call(fake, p, {}); ball = { x: q.x, y: q.y, z: q.z }; }
          if (a && a.t >= a.dur) p.action = null;
        } else if (r.kind === 'pick') {
          if (t >= 0.05 && !has) { const fx = C.clampPickStart(p, { x: r.from[0], y: r.from[1], z: r.from[2] }); fx.style = r.style; has = true; p.stance = 'normal'; p.startAction('catch', 0.2, {}); }
          if (has) { C.clampFxTick(p, 1 / 60); if (p.action && p.action.t >= p.action.dur) p.action = null; const q = holdPoint.call(fake, p, {}); ball = { x: q.x, y: q.y, z: q.z }; } else ball = { x: r.from[0] - 2 + t * 20, y: r.from[1], z: r.from[2] };
        } else {
          if (t >= 0.05 && !p.clampFx && !ball?.loose) { C.clampStripStart(p, { x: r.side * 0.3, y: 0.85, z: 0.5 }); ball = { x: r.side * 0.3, y: 0.85, z: 0.5, loose: true }; }
          else if (ball?.loose) { ball = { x: ball.x - r.side * 0.03, y: ball.y, z: ball.z - 0.05, loose: true }; C.clampFxTick(p, 1 / 60); }
          else ball = { x: r.side * 0.3, y: 0.85, z: 0.5 };
        }
        anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, ball, { hasBall: has, ballMode: 'held' });
        const pos = rig.pos, chestInv = M.qinvert(M.q4(), rig.rot[BONE.chest]), hd = pos[BONE.head], hc = [hd[0], hd[1] + 0.055 * H, hd[2] + 0.01 * H];
        for (const v of [pos[BONE.handL], pos[BONE.handR], hd, pos[BONE.footL], pos[BONE.footR]]) for (const x of v) if (!Number.isFinite(x)) nan++;
        const armSeg = { L: [[pos[BONE.upperL], pos[BONE.foreL]], [pos[BONE.foreL], pos[BONE.handL]]], R: [[pos[BONE.upperR], pos[BONE.foreR]], [pos[BONE.foreR], pos[BONE.handR]]] };
        const legs = [[pos[BONE.thighL], pos[BONE.shinL]], [pos[BONE.shinL], pos[BONE.footL]], [pos[BONE.thighR], pos[BONE.shinR]], [pos[BONE.shinR], pos[BONE.footR]]];
        let t1 = 0, h1 = 0, l1 = 0;
        for (const side of ['L', 'R']) for (const [si, [q0, q1]] of armSeg[side].entries()) for (const [k, thr] of (si === 0 ? ARM_PROBE_UPPER : ARM_PROBE_FORE)) {
          const pt = segPt(q0, q1, k), tt = rig.torsoAt(pt, chestInv);
          if (tt && tt.x * tt.x + tt.z * tt.z < thr - 0.02) t1++;
          if (Math.hypot(pt[0] - hc[0], pt[1] - hc[1], pt[2] - hc[2]) < ARM_HEAD_R * H - 0.012 * H) h1++;
          for (const [lp, lq] of legs) if (segSegDist(pt, pt, lp, lq) < 0.059 * H) l1++;
        }
        if (t1) fT++; if (h1) fH++; if (l1) fL++;
        if (segSegDist(pos[BONE.foreL], pos[BONE.handL], pos[BONE.foreR], pos[BONE.handR]) < 0.04 * H) arms++;
      }
      if (nan || fT || fH || fL || arms) bad.push(`${r.kind}:${r.style || ''} ${r.hand || ''} ${r.res || ''} ${r.by ?? r.from ?? r.side} @${bd.height}": nan ${nan} torso ${fT} head ${fH} legs ${fL} arms ${arms}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('the Swipe & Spin turns him a full turn (the ball he came up with goes round with him); the reach hands are on the ball', () => {
  const a = { type: 'steal', clamp: 'swipe_spin', hand: 'L', t: 0.05, dur: 0.46 };
  assert.equal(C.clampSpin(a), 0);
  a.t = 0.46; assert.ok(Math.abs(C.clampSpin(a) + 2 * Math.PI) < 0.01, 'all the way round, the way the swipe goes');
  assert.ok(C.clampSpin({ ...a, hand: 'R' }) > 6);
  for (const s of REACHES.filter(x => x !== 'swipe_spin')) assert.equal(C.clampSpin({ ...a, clamp: s }), 0);
  // the rip: from where he got it, into an ordinary hold by the end of the reach
  const H = 2, hold = [-0.14, 0.56 * H, 0.3];
  for (const clamp of REACHES) {
    const r = { type: 'steal', clamp, hand: 'L', t: 0.13, dur: 0.46, gotAt: 0.13, gotFrom: [0.2, 0.8, 0.8] };
    const first = C.clampStealBall(r, H, hold); assert.ok(Math.hypot(first[0] - 0.2, first[1] - 0.8, first[2] - 0.8) < 1e-6, `${clamp}: starts where he got it`);
    r.t = 0.46; const last = C.clampStealBall(r, H, hold);
    const spun = C.clampSpin(r), c = Math.cos(spun), s = Math.sin(spun), want = [hold[0] * c + hold[2] * s, hold[1], -hold[0] * s + hold[2] * c];
    assert.ok(Math.hypot(last[0] - want[0], last[1] - want[1], last[2] - want[2]) < 1e-6, `${clamp}: an ordinary hold at the end`);
  }
  // wired up: the sim deals them, the animator plays them
  const gs = src('client/js/sim/game.js'), an = src('client/js/char/animator.js');
  assert.ok(gs.includes('clampReach(') && gs.includes('clampPickStart(') && gs.includes('clampStripStart(') && gs.includes('clampFxTick('));
  assert.ok(an.includes('clampStealPose(') && an.includes('clampOverlay(') && an.includes('clampSpin('));
});
