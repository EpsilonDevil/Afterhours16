// v0.4.8.5 Big Brother (the Glass Cleaner Icon badge): "+5% Offensive and Defensive Rebound, Block and Interior D (can
// pass 99). Unlocks exclusive ultra-flashy block animations." The animations are the Icon's own Block Package now
// (block_big_brother, slot 'block'): seven brand-new blocks in the style system of the thirty (sim/blocks.js, the
// bodies char/bigbro.js), each with its swat timed to the contact, its own landing gesture and its own callout. Worn,
// his blocks draw from it, varied and the same on every screen; not worn, he blocks exactly as anyone would (the old
// one-pose override that turned the styles off, and left his hand further from the ball, is gone). Nobody else can wear
// it, it's never sold, and at the contact his hand is at least as near the ball as the same build's without the badge.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as BL from '../client/js/sim/blocks.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam, makeBot } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { inStore, forBuild } from '../client/js/sim/builds.js';
import { ICON_BADGES } from '../client/js/sim/badges.js';
import { PreviewSim } from '../client/js/game/preview.js';
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig, ARM_PROBE_UPPER, ARM_PROBE_FORE, ARM_HEAD_R, segSegDist } from '../client/js/char/rig.js';
import { B as BONE } from '../client/js/char/skeleton.js';
import * as M from '../client/js/core/math.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const PKG = BL.BB_BLOCK_PKG, BB = BL.BB_BLOCK_STYLES, IDS = BB.map(s => s.id);
// a block picker's player: ratings, height, the package he wears and his Icon
const who = (block, height, { pkg = null, icon = null } = {}) => ({ ratings: { block }, entry: { build: { height } }, blockPkg: pkg, icon });
const rigged = build => { const model = new AthleteModel(build, {}, 0.5), rig = new Rig(model), H = model.d.H; return { model, rig, H, view: { H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } } }; };

test('the Big Brother Block Package: the catalog carries the table\'s entry, an Icon secret, never sold, for the holder alone', () => {
  const it = catalog[PKG];
  assert.ok(it, 'in server/catalog.json');
  assert.deepEqual(it, BL.iconBlockPackageItems()[0], 'the catalog entry is the table\'s');
  assert.equal(it.slot, 'block'); assert.equal(it.category, 'animation');
  assert.deepEqual([it.exclusive, it.icon, it.secret, it.price, it.original_2k_asset], ['icon', 'big_brother', true, 0, false]);
  assert.deepEqual(it.styles, IDS); assert.equal(it.signature, IDS[0]);
  assert.match(it.description, /Big Brother Icon badge/);
  assert.deepEqual(list.filter(i => i.icon === 'big_brother').map(i => i.id), [PKG], 'the only Big Brother item');
  // never in the store; in the Inventory and MyPlayer only for a build holding Big Brother
  assert.equal(inStore(it), false);
  assert.equal(forBuild(it, { icon_badge: 'big_brother' }), true);
  for (const ic of [null, 'open_arms', 'the_clamp', 'sharp_eye']) assert.equal(forBuild(it, { icon_badge: ic }), false);
  // it is a Block Package: the slot's row in MyPlayer lists it and its Preview plays its styles (the store's try-on too)
  assert.ok(src('client/js/ui/myplayer.js').includes("kind === 'block' ? bk?.styles"));
  // bare bots never carry it (exclusives are left out of their picks: nothing unlocked → nothing worn; an AI world
  // Glass Cleaner who has unlocked Big Brother wears it, v0.4.8.5 qp7: tests/v0485qp7ai.test.mjs)
  const team = makeTeam(new RNG(4), 8, { catalog, level: 0.95 });
  assert.ok(team.every(e => e.build.equipment.block !== PKG));
  // and the badge still says what it unlocks
  assert.match(ICON_BADGES.big_brother.desc, /ultra-flashy block animations/);
});

test('seven brand-new blocks: their own swats, legs, off arms and gestures, flashier than the Eraser, each with a callout', () => {
  assert.ok(BB.length >= 6);
  assert.equal(new Set(IDS).size, BB.length); assert.equal(new Set(BB.map(s => s.name)).size, BB.length);
  const thirty = BL.BLOCK_STYLES;
  assert.equal(thirty.length, 30, 'the thirty are still the thirty');
  for (const s of BB) {
    assert.equal(BL.BLOCK_BY_ID[s.id], s, `${s.id} in BLOCK_BY_ID`);
    assert.equal(s.icon, 'big_brother'); assert.equal(s.tier, 6);
    for (const k of ['swat', 'legs', 'land']) assert.ok(!thirty.some(t => t[k] === s[k]), `${s.id}: its ${k} (${s[k]}) is new`);
    assert.ok(s.land !== 'none', `${s.id}: a landing gesture`);
    assert.ok(s.emph > Math.max(...thirty.filter(t => t.tier === 5).map(t => t.emph)), `${s.id}: bigger than the Eraser`);
    assert.ok(s.situ.length && s.situ.every(x => ['any', 'rim', 'chase', 'perim'].includes(x)));
    // the callout: its own, shouted, and what the session shows for it
    assert.equal(BL.blockCallout(s.id), s.callout);
    assert.match(s.callout, /^[A-Z][A-Z' ,]*[A-Z]!$/, `${s.id}: ${s.callout}`);
  }
  assert.equal(new Set(BB.map(s => s.callout)).size, BB.length, 'a callout each');
  assert.equal(new Set(BB.map(s => s.swat)).size, BB.length, 'a swat each');
  assert.equal(new Set(BB.map(s => s.land)).size, BB.length, 'a gesture each');
  assert.equal(new Set(BB.map(s => s.legs)).size, BB.length, 'legs each');
  for (const situ of ['any', 'rim', 'chase', 'perim']) assert.ok(BB.filter(s => s.situ.includes(situ)).length >= 2, `two or more for ${situ}`);
  // the tier callouts are as they were
  assert.equal(BL.blockCallout('thunder_clap'), 'THUNDER CLAP!'); assert.equal(BL.blockCallout('reach'), null);
  // the session shows the named callout to the blocker (a Big Brother block's comes first, even on a chase-down)
  const ses = src('client/js/game/session.js');
  assert.ok(ses.includes("(this.isMe(blk) && bst?.icon && blockCallout(e.style)) || (e.chase ? 'CHASE-DOWN!'"));
});

test('the old one-pose override is gone: a holder\'s block picks a style and plays it through blockPose', () => {
  assert.ok(!src('client/js/sim/game.js').includes("'bigbro'"), 'game.js: no bigbro action icon');
  assert.ok(!src('client/js/char/animator.js').includes("a.icon === 'bigbro'"), 'animator.js: no bigbro pose');
  for (const pkg of [PKG, null, 'block_hammer']) {
    const r = new RNG(31), A = makeTeam(r, 3, { catalog, level: 0.7 }), Bt = makeTeam(r, 3, { catalog, level: 0.7 });
    const h = makeBot(r, { catalog, level: 0.95, position: 'C', archetype: 'glass_cleaner' });
    h.build.icon_badge = 'big_brother'; h.build.equipment = { ...h.build.equipment, block: pkg };
    Bt[0] = h;
    const g = new Game({ mode: 'park', seed: 31, rosters: [A, Bt], catalog, target: 21 });
    const d = g.players[3], s = g.players[0];
    g.phase = 'live'; g.possession = s.team; g.giveBall(s, 'held');
    const rim = g.rimFor(s.team), side = g.sideFor(s.team);
    s.setPos(0, rim.z - side * 1.6, side > 0 ? 0 : Math.PI); d.setPos(0.3, rim.z - side * 0.6, side > 0 ? Math.PI : 0);
    g.startJump(d);
    assert.equal(d.action.type, 'block'); assert.equal(d.action.icon, null);
    assert.ok(BL.BLOCK_BY_ID[d.action.bstyle], `${pkg}: a style (${d.action.bstyle})`);
    assert.equal(!!BL.BLOCK_BY_ID[d.action.bstyle].icon, pkg === PKG, `${pkg}: ${d.action.bstyle}`);
    if (pkg === 'block_hammer') assert.equal(BL.BLOCK_BY_ID[d.action.bstyle].tier, 4);
    // the contact: the swat fires from it and the gesture gets its time; the event names the style
    const dur0 = d.action.dur;
    s.startAction('layup', 0.6, { takeoff: 0, release: 0.2, tRel: 0.2, side });
    g.blockBall(d, s, false);
    assert.ok(d.action.hit && d.action.dur > dur0 + 0.5);
    assert.equal(g.events.find(e => e.type === 'block').style, d.action.bstyle);
  }
});

test('wearing it, his blocks are its seven only, a different one every time, the same for the same seed', () => {
  const seq = (seed, situ, n = 200) => { const p = who(97, 84, { pkg: PKG, icon: 'big_brother' }), r = new RNG(seed); return Array.from({ length: n }, () => BL.pickBlockStyle(p, r, situ)); };
  for (const situ of ['any', 'rim', 'chase', 'perim']) {
    const a = seq(5, situ);
    assert.ok(a.every(id => IDS.includes(id) && BL.BLOCK_BY_ID[id].situ.includes(situ)), `${situ}: only the package's, for the moment`);
    assert.ok(a.every((id, i) => i === 0 || id !== a[i - 1]), `${situ}: never the same twice running`);
    assert.ok(new Set(a).size >= Math.min(3, BB.filter(s => s.situ.includes(situ)).length), `${situ}: varied (${new Set(a).size})`);
    assert.deepEqual(seq(5, situ), a, 'the same seed, the same blocks (online every screen picks the same)');
    assert.notDeepEqual(seq(6, situ), a, 'another seed, another order');
  }
  const all = new Set([...seq(1, 'any'), ...seq(2, 'rim'), ...seq(3, 'chase'), ...seq(4, 'perim')]);
  assert.deepEqual([...all].sort(), [...IDS].sort(), 'all seven come up');
  // one draw of the game's RNG a block, as for anyone (the game's sequence after it is the same)
  const p = who(97, 84, { pkg: PKG, icon: 'big_brother' }), r1 = new RNG(9), r2 = new RNG(9);
  BL.pickBlockStyle(p, r1, 'rim'); r2.next();
  assert.equal(r1.s, r2.s);
});

test('not wearing it he blocks exactly as anyone with his ratings would; nobody else can play it', () => {
  for (const [block, height] of [[40, 78], [72, 80], [90, 84], [97, 86], [80, 72]]) for (const pkg of [null, 'block_swatter', 'block_eraser']) for (const situ of ['any', 'rim', 'chase', 'perim']) {
    const holder = who(block, height, { pkg, icon: 'big_brother' }), plain = who(block, height, { pkg, icon: null });
    assert.equal(BL.blockPackageOf(holder), BL.blockPackageOf(plain));
    const r1 = new RNG(block * 7 + height), r2 = new RNG(block * 7 + height);
    const a = Array.from({ length: 40 }, () => BL.pickBlockStyle(holder, r1, situ)), b = Array.from({ length: 40 }, () => BL.pickBlockStyle(plain, r2, situ));
    assert.deepEqual(a, b, `${block}/${height}" ${pkg} ${situ}: the badge changes nothing`);
    assert.ok(a.every(id => !BL.BLOCK_BY_ID[id].icon));
  }
  // anyone else wearing it (another Icon, or none) blocks with his tier's six, as if he wore nothing
  for (const icon of [null, 'open_arms', 'the_clamp']) {
    const p = who(90, 80, { pkg: PKG, icon });
    assert.equal(BL.blockPackageOf(p), 'block_hammer');
    const r = new RNG(3); for (let i = 0; i < 100; i++) assert.ok(!BL.BLOCK_BY_ID[BL.pickBlockStyle(p, r, 'any')].icon);
  }
  // the badge itself still gives its +5% Block
  assert.equal(ICON_BADGES.big_brother.stats.block, 0.05);
});

test('the bodies on the rig: finite, a hand up at the ball, the swat and the gesture, no limb through another, three builds', () => {
  const r = new RNG(31), g = new Game({ mode: 'park', seed: 31, rosters: [makeTeam(r, 3, { catalog, level: 0.7 }), makeTeam(r, 3, { catalog, level: 0.7 })], catalog, target: 21 });
  const d = g.players[3]; g.phase = 'live'; g.ball.mode = 'dead'; g.ball.holder = -1;
  const segPt = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const bad = [], shapes = {};
  for (const bd of [{ height: 78, weight: 210, wingspan: 82 }, { height: 84, weight: 260, wingspan: 88 }, { height: 71, weight: 170, wingspan: 72 }]) {
    for (const s of BB) for (const ball of [[0.2, 2.2, 0.45], [-0.45, 2.0, 0.85]]) {
      const { rig, H, view } = rigged({ ...d.entry.build, ...bd }), anim = new Animator(view);
      const a = d.startAction('block', 1.7, { jumpAt: 0.06, jumpH: 0.5, jumped: false, air: 0.64, bstyle: s.id, lead: ball[0] > 0 ? 'L' : 'R', hit: false });
      d.y = 0; d.vy = 0; d.airborne = false; d.setPos(0, 0, 0);
      let torso = 0, head = 0, leg = 0, arms = 0, nan = 0, low = 0, peak = -9, wristAtHit = null;
      const trace = [];
      for (let i = 0; i < 100; i++) {
        a.t += 1 / 60;
        if (!a.jumped && a.t >= a.jumpAt) { a.jumped = true; d.jump(0.5); }
        d.vy -= 9.81 / 60; d.y = Math.max(0, d.y + d.vy / 60); if (d.y === 0) { d.vy = 0; d.airborne = false; } else d.airborne = true;
        const bw = { x: ball[0] * H / 2, y: d.y + ball[1] * H / 2, z: ball[2] * H / 2 };
        anim.update(1 / 60, { x: 0, y: d.y, z: 0, facing: 0 }, d, g, bw);
        const pos = rig.pos, chestInv = M.qinvert(M.q4(), rig.rot[BONE.chest]);
        if (a.t > 0.36 && !a.hit) {
          a.hit = true; a.hitAt = a.t;
          if (bd.height === 84) wristAtHit = Math.min(...[BONE.handL, BONE.handR].map(k => Math.hypot(pos[k][0] - bw.x, pos[k][1] - (bw.y - d.y), pos[k][2] - bw.z)));
        }
        const hd = pos[BONE.head], hc = [hd[0], hd[1] + 0.055 * H, hd[2] + 0.01 * H];
        for (const v of [pos[BONE.handL], pos[BONE.handR], hd, pos[BONE.footL], pos[BONE.footR]]) for (const x of v) if (!Number.isFinite(x)) nan++;
        peak = Math.max(peak, Math.max(pos[BONE.handL][1], pos[BONE.handR][1]) - hd[1]);
        if (Math.min(pos[BONE.footL][1], pos[BONE.footR][1]) < -0.03) low++;
        const arm = { L: [[pos[BONE.upperL], pos[BONE.foreL]], [pos[BONE.foreL], pos[BONE.handL]]], R: [[pos[BONE.upperR], pos[BONE.foreR]], [pos[BONE.foreR], pos[BONE.handR]]] };
        const legs = [[pos[BONE.thighL], pos[BONE.shinL]], [pos[BONE.shinL], pos[BONE.footL]], [pos[BONE.thighR], pos[BONE.shinR]], [pos[BONE.shinR], pos[BONE.footR]]];
        let fT = 0, fH = 0, fL = 0;
        for (const side of ['L', 'R']) for (const [si, [p, q]] of arm[side].entries()) for (const [k, thr] of (si === 0 ? ARM_PROBE_UPPER : ARM_PROBE_FORE)) {
          const pt = segPt(p, q, k), tt = rig.torsoAt(pt, chestInv);
          if (tt && tt.x * tt.x + tt.z * tt.z < thr - 0.02) fT++;
          if (Math.hypot(pt[0] - hc[0], pt[1] - hc[1], pt[2] - hc[2]) < ARM_HEAD_R * H - 0.012 * H) fH++;
          for (const [lp, lq] of legs) if (segSegDist(pt, pt, lp, lq) < 0.059 * H) fL++;
        }
        if (fT) torso++; if (fH) head++; if (fL) leg++;
        if (segSegDist(pos[BONE.foreL], pos[BONE.handL], pos[BONE.foreR], pos[BONE.handR]) < 0.04 * H) arms++;
        if (i % 6 === 0) trace.push(...pos[BONE.handL], ...pos[BONE.handR], ...pos[BONE.footL], ...pos[BONE.footR], pos[BONE.head][2]);
      }
      d.action = null; d.y = 0; d.vy = 0; d.airborne = false;
      const tag = `${s.id} @${bd.height}" ball ${ball}`;
      if (nan || low || torso || head || leg || arms) bad.push(`${tag}: nan ${nan} lowFoot ${low} torso ${torso} head ${head} legs ${leg} arms ${arms}`);
      assert.ok(peak > (ball[1] > 2.1 ? 0.12 : 0.06) * H, `${tag}: a hand over his head (${(peak / H).toFixed(2)} H)`);
      if (wristAtHit != null) assert.ok(wristAtHit < 0.3, `${tag}: the wrist ${wristAtHit.toFixed(2)} m from the ball at the contact`);
      if (bd.height === 78 && ball[0] > 0) shapes[s.id] = trace;
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
  // every one its own: pairwise apart over the whole block (rise, swat, landing gesture)
  const ids = Object.keys(shapes); let minD = Infinity, pair = '';
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = shapes[ids[i]], b = shapes[ids[j]]; let s2 = 0; for (let k = 0; k < a.length; k++) s2 += (a[k] - b[k]) ** 2;
    const dd = Math.sqrt(s2 / a.length); if (dd < minD) { minD = dd; pair = `${ids[i]} vs ${ids[j]}`; }
  }
  assert.ok(minD > 0.08, `closest pair ${pair}: ${minD.toFixed(3)} m RMS`);
});

test('the gestures and the poses through time are finite, and the Spin Swat turns him all the way round', () => {
  const an = Object.create(Animator.prototype); an.palm = { L: null, R: null }; an.H = 2; an.s = 1; an.view = null;
  for (const s of BB) for (const lead of ['L', 'R']) {
    const a = { type: 'block', bstyle: s.id, jumpAt: 0.06, air: 0.7, hit: true, hitAt: 0.42, lead, t: 0 };
    for (let t = 0.06; t < 0.8; t += 0.02) {
      const T = new Float32Array(60); a.t = t;
      an.blockPose(T, a, { u: t - 0.06, air: 0.7, up: 1, up2: 1, tx: 0.2, ty: 2.3, tz: 0.4, ld: lead, tr: lead === 'L' ? 'R' : 'L', ls: lead === 'L' ? 1 : -1, t, b: [0.25, 2.2, 0.6] });
      assert.ok(T.every(Number.isFinite), `${s.id} ${lead} @${t.toFixed(2)}`);
    }
    for (let q = 0; q < 1; q += 0.05) { const T = new Float32Array(60); T[24] = 0.3; T[25] = 1.1; T[27] = -0.3; T[28] = 1.1; an.blockLanding(T, a, q); assert.ok(T.every(Number.isFinite), `${s.id} gesture @${q.toFixed(2)}`); }
  }
  // the turn: half in the air from the contact, the rest on the landing; none without the ball or for any other style
  const a = { type: 'block', bstyle: 'bb_spin_swat', jumpAt: 0.06, air: 0.66, hit: true, hitAt: 0.38, ldUsed: 'L', t: 0.38 };
  assert.equal(BL.blockSpin(a), 0);
  a.t = 0.72; assert.ok(Math.abs(Math.abs(BL.blockSpin(a)) - Math.PI) < 0.05, 'half a turn by the landing');
  a.t = 1.2; assert.ok(Math.abs(Math.abs(BL.blockSpin(a)) - 2 * Math.PI) < 1e-6, 'all the way round after it');
  assert.ok(BL.blockSpin({ ...a, ldUsed: 'R' }) > 0 && BL.blockSpin(a) < 0, 'the way the swat goes');
  assert.equal(BL.blockSpin({ ...a, hit: false }), 0); assert.equal(BL.blockSpin({ ...a, bstyle: 'bb_tomahawk' }), 0); assert.equal(BL.blockSpin({ ...a, bstyle: 'eraser' }), 0);
});

test('the Preview (MyPlayer, Inventory) plays the seven in turn, each swatting the ball away', () => {
  const sim = new PreviewSim();
  sim.setPlayer({ height: 84, weight: 255, wingspan: 88, hand: 'R', attributes: {}, icon_badge: 'big_brother', equipment: { block: PKG } }, catalog);
  sim.setPreview('block', { styles: catalog[PKG].styles });
  const seen = []; let swats = 0, last = null;
  for (let i = 0; i < 60 * 20; i++) { sim.step(1 / 60, 0); const a = sim.player.action; if (a?.bstyle && seen[seen.length - 1] !== a.bstyle) seen.push(a.bstyle); if (a?.hit && a !== last) { swats++; last = a; } }
  assert.deepEqual(seen.slice(0, 7), IDS);
  assert.ok(swats >= 7);
});

test('in games: at the contact his hand is at least as near the ball as the same build\'s without the badge', () => {
  // (the measure: the nearer wrist to the ball the frame before the block, on the animated rig; the animator runs only
  // through his block jumps here, for speed)
  const run = (icon, n = 6) => {
    const gaps = [];
    for (let gi = 0; gi < n; gi++) {
      const seed = 4000 + gi * 29, rng = new RNG(seed);
      const A = makeTeam(rng, 3, { catalog, level: 0.85 }), Bt = makeTeam(rng, 3, { catalog, level: 0.85 });
      const h = makeBot(rng, { catalog, level: 0.97, position: 'C', archetype: 'glass_cleaner' });
      h.build.icon_badge = icon ? 'big_brother' : null; if (icon) h.build.equipment = { ...h.build.equipment, block: PKG };
      h.name = 'HOLDER'; h.badges = { rim_protector: 4, rebound_chaser: 4, brick_wall: 3 };
      A[2] = h;
      const g = new Game({ mode: 'park', seed, rosters: [A, Bt], catalog, target: 21 });
      const p = g.players.find(q => q.name === 'HOLDER'), { rig, view } = rigged(p.entry.build), an = new Animator(view);
      let steps = 0, prev = null;
      while (!g.over && steps < 60 * 60 * 20) {
        g.step(1 / 60); steps++;
        const b = g.ball;
        for (const e of g.events) if (e.type === 'block' && e.player === p.id && prev) gaps.push(prev);
        prev = null;
        if (p.action?.type === 'block') {
          an.update(1 / 60, { x: p.x, y: p.y, z: p.z, facing: p.facing }, p, g, { x: b.x, y: b.y, z: b.z });
          const f = an.f, c = Math.cos(f), s = Math.sin(f), w = v => [p.x + c * v[0] + s * v[2], p.y + v[1], p.z - s * v[0] + c * v[2]];
          prev = Math.min(...[BONE.handL, BONE.handR].map(k => { const q = w(rig.pos[k]); return Math.hypot(q[0] - b.x, q[1] - b.y, q[2] - b.z); }));
        }
      }
    }
    gaps.sort((a, b) => a - b);
    return { n: gaps.length, median: gaps[Math.floor(gaps.length / 2)] };
  };
  const on = run(true), off = run(false);
  assert.ok(on.n >= 8 && off.n >= 8, `blocks: ${on.n} with, ${off.n} without`);
  assert.ok(on.median <= off.median, `median wrist to ball at the contact: ${on.median.toFixed(2)} m with the package, ${off.median.toFixed(2)} m without the badge`);
});
