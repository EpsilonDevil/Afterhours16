// v0.4.8.5 quick patch 5: Sexy Red (the Post Scorer Icon badge): "+5% Layup, Post Control and Close Shot (can pass 99).
// Unlocks exclusive post back-down animations." The audit found no exclusive back-down (the holder got the store's Bully
// Ball body over whatever package he wore) and Post Control past 99 counting for nothing on the block. Now: the Icon's
// own Post Move Package (post_sexy_red) with five back-downs of its own, varied through a possession and the same for a
// given game, its signature finishes, the holder's alone, everyone else (and the holder in any other package) exactly as
// before; and postPower keeps counting past 99 up to what 105 gives, unchanged at 99 and under.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam, makeBot } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT } from '../client/js/sim/constants.js';
import { Player, blankIntent } from '../client/js/sim/player.js';
import { POST, POST_PACKAGES, POST_ICON_PACKAGES, POST_PKG_BY_ID, postPackageItems, postPackageOf, postPower, backdownSpeed, beatChance, postShotK, PC_TOP } from '../client/js/sim/post.js';
import * as RP from '../client/js/sim/redpost.js';
import { inStore, forBuild } from '../client/js/sim/builds.js';
import { PreviewSim } from '../client/js/game/preview.js';
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';
import { P } from '../client/js/char/pose.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const PKG = RP.RED_POST_PKG;
const holderBuild = (o = {}) => ({ height: 82, weight: 250, wingspan: 86, hand: 'R', archetype: 'post_scorer', icon_badge: 'sexy_red', attributes: {}, equipment: { post: PKG }, ...o });
const rigFor = build => {
  const model = new AthleteModel(build, {}, 0.5), rig = new Rig(model);
  const view = { H: model.d.H, model, rig, y: 0, yaw: 0, update(pose, x, y, z, yaw) { rig.solve(pose, arguments[5]); this.x = x; this.y = y; this.z = z; this.yaw = yaw; } };
  return { rig, view, anim: new Animator(view) };
};

// ---------------- the item ----------------
test('the Sexy Red Post Move Package: the holder\'s alone, free, never in the store, top-tier bite and no more', () => {
  const it = catalog[PKG];
  assert.ok(it, 'in the catalog');
  assert.deepEqual(postPackageItems().find(i => i.id === PKG), it, 'server/catalog.json carries exactly post.js\'s entry');
  assert.equal(it.slot, 'post'); assert.equal(it.category, 'animation');
  assert.deepEqual([it.exclusive, it.icon, it.secret, it.price, it.original_2k_asset], ['icon', 'sexy_red', true, 0, false]);
  assert.deepEqual([it.min_overall, it.rep_required, it.min_attr], [0, 0, {}]);
  assert.equal(it.body, 'red');
  assert.deepEqual(it.backdowns, RP.RED_IDS);
  assert.equal(RP.RED_IDS.length, 5);
  assert.equal(new Set(RP.RED_BACKDOWNS.map(s => s.name)).size, 5);
  for (const s of RP.RED_BACKDOWNS) { assert.ok(s.len >= 1.2 && s.len <= 2, s.id); assert.ok(it.description.includes(s.name), s.name); }
  assert.ok(it.description.includes('Sexy Red Icon badge'));
  // (qp6) bites a little harder than the best package in the store (1.6 against 1.5); its own body (no store package's)
  const top = Math.max(...POST_PACKAGES.map(p => p.emph));
  assert.equal(it.emph, 1.6);
  assert.ok(it.emph > top && it.emph <= top * 1.1, 'harder, but only a little');
  assert.ok(!POST_PACKAGES.some(p => p.body === 'red'));
  assert.equal(POST_ICON_PACKAGES.length, 1);
  assert.equal(POST_PACKAGES.length, 10, 'the store\'s ten are unchanged');
  // the only Sexy Red item; never in the store, in the Inventory for the holder alone
  assert.deepEqual(list.filter(i => i.icon === 'sexy_red').map(i => i.id), [PKG]);
  assert.equal(inStore(it), false);
  assert.equal(forBuild(it, { icon_badge: 'sexy_red' }), true);
  for (const ic of [null, 'the_general', 'big_brother', 'open_arms']) assert.equal(forBuild(it, { icon_badge: ic }), false);
  // the AI's gear never picks it (it skips every exclusive item)
  const r = new RNG(41);
  for (let i = 0; i < 200; i++) assert.notEqual(makeBot(r, { catalog, level: 1, rep: 20, flash: 1, position: 'C', archetype: 'post_scorer' }).build.equipment.post, PKG);
});

test('it plays only on the build that holds Sexy Red; worn by anyone else it is Fundamentals', () => {
  const p = { postPkg: PKG, icon: 'sexy_red', archetype: 'post_scorer', heightIn: 82, ratings: { post_control: 90 }, phys: { strength: 0.6 } };
  assert.equal(postPackageOf(p).id, PKG);
  for (const icon of [null, 'the_general', 'open_arms']) assert.equal(postPackageOf({ ...p, icon }).id, 'post_basic', String(icon));
  // and the holder in a store package plays that package
  for (const k of POST_PACKAGES) assert.equal(postPackageOf({ ...p, postPkg: k.id }).id, k.id);
  // a Player built from the holder's build has it
  const pl = new Player(0, 0, { build: { ...holderBuild(), attributes: {} }, name: 'Red', human: true }, catalog);
  assert.equal(pl.icon, 'sexy_red'); assert.equal(postPackageOf(pl).id, PKG);
});

// ---------------- postPower past 99 ----------------
const nOld = v => Math.max(0, Math.min(1, ((v ?? 50) - 25) / 74));
function postPowerOld(p) { // (the v0.4.8.5 formula before qp5, verbatim)
  const pkg = postPackageOf(p), arch = POST.arch[p.archetype] ?? 0.8, h = p.heightIn ?? p.build?.height ?? 78;
  const hK = Math.max(0.75, Math.min(1.1, 0.78 + (h - 69) * 0.017));
  return pkg.emph * (0.35 + 0.65 * nOld(p.ratings?.post_control)) * arch * hK;
}
test('postPower: identical at Post Control 99 and under; past 99 it keeps counting, up to what 105 gives', () => {
  const pkgs = [...POST_PACKAGES.map(k => [k.id, null]), [PKG, 'sexy_red']];
  let n = 0;
  for (const [pkg, icon] of pkgs) for (const arch of [...Object.keys(POST.arch), 'unknown']) for (const h of [68, 73, 78, 82, 86]) for (let pc = 0; pc <= 99; pc += 0.25) {
    const p = { postPkg: pkg, icon, archetype: arch, heightIn: h, ratings: { post_control: pc }, phys: { strength: 0.6 } };
    assert.equal(postPower(p), postPowerOld(p)); n++;
  }
  assert.ok(n > 100000);
  // (no rating at all: the same default)
  assert.equal(postPower({ postPkg: 'post_basic', archetype: 'post_scorer', heightIn: 82 }), postPowerOld({ postPkg: 'post_basic', archetype: 'post_scorer', heightIn: 82 }));
  // past 99: up with every point to 105, flat after
  const at = pc => postPower({ postPkg: PKG, icon: 'sexy_red', archetype: 'post_scorer', heightIn: 82, ratings: { post_control: pc }, phys: { strength: 0.6 } });
  assert.equal(PC_TOP, 105);
  for (let pc = 99; pc < 105; pc += 0.5) assert.ok(at(pc + 0.5) > at(pc), `${pc}`);
  assert.equal(at(110), at(105)); assert.equal(at(140), at(105));
  // Sexy Red's 99 × 1.05 = 103.95: +4.35% post power over 99 (it was +0%)
  const k = at(103.95) / at(99);
  assert.ok(Math.abs(k - (0.35 + 0.65 * (78.95 / 74))) < 1e-9, k.toFixed(4));
  assert.ok(k > 1.04 && k < 1.05);
  // and through to the back-down, the moves and the shots, against an elite post defender (qp6: the package bites a
  // little harder than the store's best, so against a merely good one his drop step is already at the 0.8 ceiling)
  const me = pc => ({ postPkg: PKG, icon: 'sexy_red', archetype: 'post_scorer', heightIn: 82, ratings: { post_control: pc }, phys: { strength: 0.7 } });
  const def = { ratings: { interior_d: 104 }, phys: { strength: 0.95 }, badges: { brick_wall: 4 } };
  assert.ok(beatChance(me(103.95), def, 'dropstep') < 0.8, 'under the ceiling');
  assert.ok(backdownSpeed(me(103.95), def) > backdownSpeed(me(99), def));
  assert.ok(beatChance(me(103.95), def, 'dropstep') > beatChance(me(99), def, 'dropstep'));
  // (a shot out of the post has its own ceiling, power 1.6, which the holder in his top-tier package is already past at
  // 99; in Fundamentals he isn't, and the extra Post Control shows)
  const basic = pc => ({ ...me(pc), postPkg: 'post_basic' });
  assert.ok(postPower(basic(99)) < 1.6);
  assert.ok(postShotK(basic(103.95), 'hook', false).bonus > postShotK(basic(99), 'hook', false).bonus);
  assert.ok(postShotK(basic(103.95), 'hook', false).shield > postShotK(basic(99), 'hook', false).shield);
});

// ---------------- the stream ----------------
test('the back-down stream: all five before any repeats, never the same twice running, seeded', () => {
  for (let seed = 1; seed < 60; seed++) {
    const s = RP.redSeed(seed % 6, seed * 977);
    let prev = null;
    for (let b = 0; b < 12; b++) {
      const bag = [0, 1, 2, 3, 4].map(i => RP.redStyleAt(s, b * 5 + i).id);
      assert.deepEqual([...bag].sort(), [...RP.RED_IDS].sort(), 'a bag is all five');
      for (const id of bag) { assert.notEqual(id, prev, 'never twice in a row'); prev = id; }
    }
  }
  // different players / games start differently
  const firsts = new Set(); for (let pid = 0; pid < 6; pid++) for (const gs of [1, 2, 3]) firsts.add(RP.redStyleAt(RP.redSeed(pid, gs), 0).id);
  assert.ok(firsts.size >= 4);
  // the clock: phrases in order, the envelope at the ends, a new post-up moves on
  const st = { seed: RP.redSeed(1, 1) };
  const F0 = RP.redClock(st, 0.1, true); assert.equal(F0.k, 0); assert.ok(F0.env > 0 && F0.env < 1);
  let F = F0; for (let i = 0; i < 9; i++) F = RP.redClock(st, 0.1, true);
  assert.equal(F.env, 1);
  for (let i = 0; i < 10; i++) RP.redClock(st, 0.1, false);
  assert.equal(RP.redClock(st, 0.02, true).k, 1, 'after a break, the next one');
});

// ---------------- in a game ----------------
function postUpGame(seed, { pkg = PKG, icon = 'sexy_red', reps = 4 } = {}) {
  const r = new RNG(seed), a = makeTeam(r, 1, { catalog, level: 0.8 }), b = makeTeam(r, 1, { catalog, level: 0.8 });
  a[0].human = true; Object.assign(a[0].build, { archetype: 'post_scorer', icon_badge: icon, height: 82 }); a[0].build.equipment = { ...a[0].build.equipment, post: pkg };
  const g = new Game({ mode: 'practice', seed, rosters: [a, b], catalog, target: 99 });
  const p = g.players[0], d = g.players[1];
  const { anim, rig } = rigFor(p.entry.build);
  for (let i = 0; i < 300 && g.phase !== 'live'; i++) { g.setInput(blankIntent()); g.step(DT); }
  const seq = [], styles = new Set(); let bad = 0, frames = 0, posted = 0;
  const upd = () => { anim.update(DT, { x: p.x, y: p.y, z: p.z, facing: p.facing }, p, g, g.ball); for (const bn of ['hips', 'head', 'handL', 'handR', 'footL', 'footR']) for (const c of rig.pos[B[bn]]) if (!Number.isFinite(c)) bad++; };
  for (let rep = 0; rep < reps; rep++) {
    const rim = g.rimFor(p.team), sd = g.sideFor(p.team);
    p.setPos(rim.x + 1.0, rim.z - sd * 3.6, 0); p.facing = Math.atan2(p.x - rim.x, p.z - rim.z); p.action = null;
    d.setPos(rim.x + 0.95, rim.z - sd * 2.9, 0); d.action = null;
    g.ball.holder = p.id; g.ball.mode = 'dribble'; p.dribble.used = false;
    for (let i = 0; i < 60 * 3.5; i++) {
      const tx = rim.x - p.x, tz = rim.z - p.z, l = Math.hypot(tx, tz) || 1, st = i % 120 < 70 ? 0.9 : 0;
      g.setInput({ ...blankIntent(), post: true, mx: tx / l * st, mz: tz / l * st });
      g.step(DT); upd(); frames++;
      if (p.postUp) posted++;
      const id = anim.redF?.id || null;
      if (id) styles.add(id);
      if (seq[seq.length - 1] !== id) seq.push(id);
    }
    p.postUp = false; p.posting = 0;
    for (let i = 0; i < 60; i++) { g.setInput(blankIntent()); g.step(DT); upd(); }
  }
  return { seq: seq.filter(Boolean), styles, bad, frames, posted };
}

test('in a game the holder wearing it backs down with its own five, varied through the possession, the same for a given game', () => {
  const A = postUpGame(9), A2 = postUpGame(9), C = postUpGame(10);
  assert.ok(A.posted > A.frames * 0.8, 'he really posts up');
  assert.equal(A.bad, 0);
  assert.ok(A.styles.size >= 4, `${A.styles.size} different back-downs: ${A.seq.join(' ')}`);
  assert.ok(A.seq.length >= 8, 'one after another');
  for (let i = 1; i < A.seq.length; i++) assert.notEqual(A.seq[i], A.seq[i - 1]);
  assert.deepEqual(A2.seq, A.seq, 'deterministic for the game\'s seed');
  assert.notDeepEqual(C.seq, A.seq, 'another game, another order');
  for (const s of A.styles) assert.ok(RP.RED_BY_ID[s]);
  // nobody else: the holder in the Bully Ball, a non-holder wearing it
  assert.equal(postUpGame(9, { pkg: 'post_bully', reps: 1 }).styles.size, 0);
  assert.equal(postUpGame(9, { icon: null, reps: 1 }).styles.size, 0);
});

// the animator's back-down pose for a player (g null: the preview's way), frames at 60 Hz
function postingPoses(p, n = 150) {
  const { anim } = rigFor(p.entry.build), out = [];
  for (let i = 0; i < n; i++) {
    p.posting = 0.3; p.backing = 1; p.dribble.phase = (p.dribble.phase + 1.4 / 60) % 1;
    anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: Math.PI }, p, null, { x: 0.26, y: 0.6, z: -0.3 }, { hasBall: true, ballMode: 'dribble' });
    out.push(Float32Array.from(anim.target));
  }
  return { anim, out };
}
test('the badge no longer swaps anyone\'s package: the holder in any store package, and a non-holder, pose exactly as before', () => {
  const anim = src('client/js/char/animator.js');
  assert.ok(!anim.includes("p.icon === 'sexy_red'"), 'the old override is gone');
  for (const k of POST_PACKAGES) {
    const mk = icon => { const pl = new Player(3, 0, { build: { ...holderBuild({ icon_badge: icon }), equipment: { post: k.id } }, name: 'X', human: true }, catalog); pl.icon = icon; return pl; };
    const a = postingPoses(mk('sexy_red')), b = postingPoses(mk(null));
    assert.equal(a.anim.redF, null, k.id);
    for (let i = 0; i < a.out.length; i++) assert.deepEqual(a.out[i], b.out[i], `${k.id} frame ${i}`);
  }
  // and the holder in his own package does something else entirely
  const pl = new Player(3, 0, { build: holderBuild(), name: 'X', human: true }, catalog);
  const red = postingPoses(pl), bully = postingPoses(new Player(3, 0, { build: holderBuild({ equipment: { post: 'post_bully' } }), name: 'X', human: true }, catalog));
  assert.ok(red.anim.redF && RP.RED_BY_ID[red.anim.redF.id]);
  let diff = 0; for (let i = 0; i < red.out.length; i++) for (let j = 0; j < P.N; j++) diff += Math.abs(red.out[i][j] - bully.out[i][j]);
  assert.ok(diff / red.out.length > 1, `different from the Bully Ball body (${(diff / red.out.length).toFixed(2)})`);
});

// ---------------- the poses ----------------
// one back-down at a time on the rig (the stream steered to it): what the joints do over its phrase
function playStyle(id, hand = 'R') {
  const build = holderBuild({ hand }), pl = new Player(0, 0, { build, name: 'Red', human: true }, catalog);
  pl.dribble.hand = hand;
  const { rig, view, anim } = rigFor(build);
  // (find the k where this style plays in this player's stream, and start the clock there)
  const seed = RP.redSeed(pl.id, 0); let k = 0; while (RP.redStyleAt(seed, k).id !== id) k++;
  anim.red = { key: `${pl.id}:0`, seed, k, u: 0, off: 0, on: false };
  const len = RP.RED_BY_ID[id].len, frames = [];
  for (let i = 0; i < Math.round(len * 60) - 2; i++) {
    pl.posting = 0.3; pl.backing = 1; pl.dribble.phase = (pl.dribble.phase + 1.4 / 60) % 1;
    const ph = pl.dribble.phase, hs = hand === 'R' ? -1 : 1, H = pl.phys.H;
    // the ball where the dribble puts it (game.holdPoint's dribble, standing still), in his frame then the world
    const lx = hs * 0.26, ly = 0.12 + (0.47 * H - 0.12) * Math.abs(Math.cos(Math.PI * ph)), lz = 0.24, f = Math.PI;
    const ball = { x: lx * Math.cos(f) + lz * Math.sin(f), y: ly, z: -lx * Math.sin(f) + lz * Math.cos(f) };
    anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: f }, pl, null, ball, { hasBall: true, ballMode: 'dribble' });
    assert.equal(anim.redF?.id, id);
    const c = Math.cos(view.yaw), s = Math.sin(view.yaw), toW = q => [view.x + q[2] * s + q[0] * c, view.y + q[1], view.z + q[2] * c - q[0] * s];
    frames.push({ T: Float32Array.from(anim.target), pos: Object.fromEntries(['hips', 'chest', 'head', 'handL', 'handR', 'footL', 'footR', 'foreL', 'foreR'].map(b => [b, toW(rig.pos[B[b]])])), ball, ph });
  }
  return frames;
}
test('each of the five on the rig: finite, feet on or over the floor, the dribble hand over the ball, and big enough to read', () => {
  const sig = {};
  for (const s of RP.RED_BACKDOWNS) for (const hand of ['R', 'L']) {
    const fr = playStyle(s.id, hand), dh = hand === 'R' ? 'handR' : 'handL';
    let horiz = 0;
    for (const f of fr) {
      for (const v of Object.values(f.pos)) for (const c of v) assert.ok(Number.isFinite(c), s.id);
      assert.ok(Math.min(f.pos.footL[1], f.pos.footR[1]) > -0.03, `${s.id}: feet above the floor`);
      horiz = Math.max(horiz, Math.hypot(f.pos[dh][0] - f.ball.x, f.pos[dh][2] - f.ball.z));
    }
    assert.ok(horiz < 0.2, `${s.id} ${hand}: the dribble hand stays over the ball (${horiz.toFixed(3)} m)`);
    // the motion: how far the head, the hips, the off hand and the feet travel over the phrase (m)
    const range = b => { const xs = fr.map(f => f.pos[b]); return Math.max(...[0, 1, 2].map(i => Math.max(...xs.map(x => x[i])) - Math.min(...xs.map(x => x[i])))); };
    const off = hand === 'R' ? 'handL' : 'handR', feet = Math.max(range('footL'), range('footR'));
    const mv = range('head') + range('hips') + range(off) + feet;
    assert.ok(mv > 0.3, `${s.id}: moves enough to read from the game camera (${mv.toFixed(2)} m)`);
    if (hand === 'R') sig[s.id] = fr;
  }
  // the five are different from one another: the mean distance between their poses over the phrase (head, hands, feet)
  const ids = Object.keys(sig), parts = ['head', 'chest', 'handL', 'footL', 'footR'];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = sig[ids[i]], Bf = sig[ids[j]], n = Math.min(A.length, Bf.length);
    let d = 0; for (let t = 0; t < n; t++) for (const b of parts) d += Math.hypot(...[0, 1, 2].map(k => A[t].pos[b][k] - Bf[t].pos[b][k]));
    assert.ok(d / n / parts.length > 0.03, `${ids[i]} vs ${ids[j]}: ${(d / n / parts.length).toFixed(3)}`);
  }
  // their own signatures: the shimmy's shoulders, the seal's hip-checks, the two-step's knee, the peek's head, the feint's hips
  const span = (fr, g, i = 0) => { const v = fr.map(f => f.T[P[g] + i]); return Math.max(...v) - Math.min(...v); };
  assert.ok(span(sig.red_grind, 'chest', 1) > 0.6, 'the shoulders shimmy');
  assert.ok(span(sig.red_seal, 'root', 2) > 0.12, 'the hips check back');
  assert.ok(span(sig.red_twostep, 'footL', 1) > 0.18 || span(sig.red_twostep, 'footR', 1) > 0.18, 'the knee comes up');
  assert.ok(span(sig.red_peek, 'head', 1) > 1.0, 'the head looks over one shoulder, then the other');
  assert.ok(span(sig.red_feint, 'pelvis', 1) > 0.45, 'the hips start the spin');
});

test('the signature finishes: the Shimmy Turnaround and the Leaning Hook, on its post shots only', () => {
  const run = (pkg, post) => {
    const build = holderBuild({ equipment: { post: pkg } }), pl = new Player(0, 0, { build, name: 'Red', human: true }, catalog), { anim } = rigFor(build);
    pl.startAction('shoot', 1.1, { post, postBeat: false, pkg, hookShape: 'jump', fadeShape: 'high', tRel: 0.53, takeoff: 0.27, jumpH: 0.3, dRim: 2.4, kind: post === 'hook' ? 'close' : 'jumper', fade: false });
    const out = [];
    for (let i = 0; i < 26; i++) { pl.action.t += 1 / 60; anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, pl, null, { x: 0, y: 1.2, z: 0.3 }, { hasBall: true, ballMode: 'held' }); out.push(Float32Array.from(anim.target)); }
    return out;
  };
  const span = (fr, o) => { const v = fr.slice(0, 14).map(T => T[o]); return Math.max(...v) - Math.min(...v); };
  const redTurn = run(PKG, 'turn'), bullyTurn = run('post_backboard', 'turn');
  assert.ok(span(redTurn, P.chest + 1) > 0.45, `the shimmy before the rise (${span(redTurn, P.chest + 1).toFixed(2)})`);
  assert.ok(span(bullyTurn, P.chest + 1) < 0.25);
  const redHook = run(PKG, 'hook'), bbHook = run('post_backboard', 'hook');
  assert.ok(Math.abs(redHook[25][P.spine + 2]) > Math.abs(bbHook[25][P.spine + 2]) + 0.12, 'the lean');
  // a non-holder can't have the package on his shots (startPostShot takes postPackageOf's id)
  assert.match(src('client/js/sim/game.js'), /pkg: pkg\.id, hookShape: pkg\.hook/);
});

// ---------------- the preview and the screens ----------------
test('the preview backs down long enough to show all five in two loops, then its signature shots', () => {
  const build = holderBuild(), sim = new PreviewSim(); sim.setPlayer(build, catalog); sim.setPreview('post', { pkg: PKG, sig: catalog[PKG].sig });
  const { anim } = rigFor(build), seen = new Set(), shots = new Set();
  for (let i = 0; i < 60 * 18; i++) {
    const out = sim.step(1 / 60, 0), p = sim.player;
    anim.update(1 / 60, { x: 0, y: p.y + 0.12, z: 0, facing: p.facing }, p, null, out.ball, { hasBall: out.hasBall, ballMode: out.ballMode, floorY: 0.12 });
    if (anim.redF) seen.add(anim.redF.id);
    if (p.action?.type === 'shoot') { assert.equal(p.action.pkg, PKG); shots.add(p.action.post); }
  }
  assert.equal(seen.size, 5, [...seen].join(' '));
  assert.ok(shots.has('turn') && shots.has('hook'), [...shots].join(' '));
  // a store package's preview is as it was (2.2 s of back-down)
  const s2 = new PreviewSim(); s2.setPlayer(holderBuild({ equipment: { post: 'post_bully' } }), catalog); s2.setPreview('post', { pkg: 'post_bully' });
  let moveAt = null; for (let i = 0; i < 400 && moveAt == null; i++) { s2.step(1 / 60, 0); if (s2.player.action?.type === 'post') moveAt = i / 60; }
  assert.ok(Math.abs(moveAt - 2.2) < 0.05, `${moveAt}`);
  // the screens: MyPlayer's "Post-move package" row lists what this build owns and may wear (forBuild) with Preview,
  // the Inventory's Post Moves tab the same, the store only what's for sale
  const mp = src('client/js/ui/myplayer.js'), inv = src('client/js/ui/inventory.js'), store = src('client/js/ui/store.js');
  assert.ok(mp.includes("['post', 'Post-move package', 'post']"));
  assert.ok(mp.includes('inv.has(i.id) && forBuild(i, c)') && mp.includes('pkg: po?.id'));
  assert.ok(inv.includes('inv.has(i.id) && forBuild(i, c)'));
  assert.ok(store.includes('inStore(i) && inCat(i, cat)'));
  assert.ok(store.includes("app.showroom.setPreview('post', { pkg: item.id, sig: item.sig })"));
  assert.ok(POST_PKG_BY_ID[PKG], 'the preview finds it');
});

test('qp6: Sexy Red\'s package hits a little harder than the best in the store, in every part of the post game', () => {
  const me = pkg => ({ postPkg: pkg, icon: 'sexy_red', archetype: 'post_scorer', heightIn: 82, ratings: { post_control: 103.95 }, phys: { strength: 0.7 } });
  const def = { ratings: { interior_d: 104 }, phys: { strength: 0.95 }, badges: { brick_wall: 4 } };
  const red = me(PKG), store = me('post_backboard');
  assert.ok(Math.abs(postPower(red) / postPower(store) - 1.6 / 1.5) < 1e-9, 'post power ×1.067');
  assert.ok(backdownSpeed(red, def) > backdownSpeed(store, def));
  for (const m of ['dropstep', 'postspin']) assert.ok(beatChance(red, def, m) > beatChance(store, def, m), m);
  for (const k of ['hook', 'turn']) assert.ok(postShotK(red, k, false).bonus > postShotK(store, k, false).bonus, k);
  // only a little: under 10% more power
  assert.ok(postPower(red) / postPower(store) < 1.1);
});
