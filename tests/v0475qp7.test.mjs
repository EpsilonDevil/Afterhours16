// v0.4.7.5 quick patch 3: thirty block styles in five tiers by Block rating and height (sim/blocks.js), each with its
// own body (char/animator.js blockPose / blockLanding), picked for the moment (rim, chase-down, perimeter), with the
// swat firing from the contact and a landing gesture after a block that got the ball.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BLOCK_STYLES, BLOCK_BY_ID, blockTier, blockPool, pickBlockStyle, blockCallout, BLOCK_TIER_MIN, BLOCK_PACKAGES, blockPackageItems, blockPackageNeed, blockPackageOf } from '../client/js/sim/blocks.js';
import { Animator } from '../client/js/char/animator.js';
import { P, neutral } from '../client/js/char/pose.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B as BONE } from '../client/js/char/skeleton.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

test('thirty styles, six a tier, every one unique by id, name and spec', () => {
  assert.equal(BLOCK_STYLES.length, 30);
  assert.equal(new Set(BLOCK_STYLES.map(s => s.id)).size, 30);
  assert.equal(new Set(BLOCK_STYLES.map(s => s.name)).size, 30);
  for (let t = 1; t <= 5; t++) assert.equal(BLOCK_STYLES.filter(s => s.tier === t).length, 6, `tier ${t}`);
  const key = s => [s.lead, s.cock, s.swat, s.off, s.lean.join(','), s.twist, s.legs, s.land].join('|');
  assert.equal(new Set(BLOCK_STYLES.map(key)).size, 30, 'no two specs the same');
  // the higher the tier, the more emphatic
  const emph = t => BLOCK_STYLES.filter(s => s.tier === t).reduce((a, s) => a + s.emph, 0) / 6;
  for (let t = 2; t <= 5; t++) assert.ok(emph(t) > emph(t - 1), `tier ${t} bigger than ${t - 1}`);
  assert.ok(BLOCK_STYLES.filter(s => s.tier === 5).every(s => s.land !== 'none'), 'every top-tier block has a gesture after it');
  assert.ok(BLOCK_STYLES.filter(s => s.tier === 1).every(s => s.land === 'none' && s.cock < 0.2), 'the basics are plain');
  for (const s of BLOCK_STYLES) assert.ok(s.situ.length && s.situ.every(x => ['any', 'rim', 'chase', 'perim'].includes(x)));
  assert.equal(blockCallout('thunder_clap'), 'THUNDER CLAP!'); assert.equal(blockCallout('reach'), null);
});

test('the tier follows the Block rating, bumped for the tall and down for the small; the pool fits the moment', () => {
  const mk = (block, height) => ({ ratings: { block }, entry: { build: { height } } });
  assert.deepEqual(BLOCK_TIER_MIN, [0, 0, 55, 70, 85, 95]);
  assert.equal(blockTier(mk(40, 78)), 1); assert.equal(blockTier(mk(60, 78)), 2); assert.equal(blockTier(mk(75, 78)), 3); assert.equal(blockTier(mk(90, 78)), 4); assert.equal(blockTier(mk(97, 78)), 5);
  assert.equal(blockTier(mk(75, 84)), 4, 'a 7-footer blocks a tier up'); assert.equal(blockTier(mk(75, 72)), 2, 'a 6-footer a tier down');
  assert.equal(blockTier(mk(99, 86)), 5); assert.equal(blockTier(mk(30, 70)), 1);
  // pools (revised: packages): with no package of his own he blocks with his tier's six, those that fit the moment
  const p3 = mk(75, 78);
  assert.equal(blockPackageOf(p3), 'block_wiper');
  const pool = blockPool(p3, 'rim');
  assert.ok(pool.length && pool.every(s => s.tier === 3 && s.situ.includes('rim')));
  const chase = blockPool(p3, 'chase'); assert.ok(chase.some(s => s.id === 'chase_swat') && chase.every(s => s.situ.includes('chase')));
  // every package has a block for every moment (fallbacks never leave it empty)
  for (const t of [1, 2, 3, 4, 5]) for (const situ of ['any', 'rim', 'chase', 'perim']) assert.ok(blockPool(mk([30, 60, 75, 90, 97][t - 1], 78), situ).length > 0, `tier ${t} ${situ}`);
  // picks are from the package, spread across it
  const rng = new RNG(5), seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(pickBlockStyle(p3, rng, 'any'));
  assert.ok(seen.size >= 5, `variety: ${[...seen].join(', ')}`);
  for (const id of seen) assert.equal(BLOCK_BY_ID[id].tier, 3);
  // a top-tier giant never throws a basic block
  const g5 = mk(97, 86), s5 = new Set(); for (let i = 0; i < 300; i++) s5.add(pickBlockStyle(g5, rng, 'any'));
  assert.ok([...s5].every(id => BLOCK_BY_ID[id].tier === 5));
  // the package he wears wins over his rating: a 40 Block who bought the Hammer package throws hammers
  const worn = { ...mk(40, 78), blockPkg: 'block_hammer' }, sw = new Set(); for (let i = 0; i < 200; i++) sw.add(pickBlockStyle(worn, rng, 'any'));
  assert.ok(sw.size >= 4 && [...sw].every(id => BLOCK_BY_ID[id].tier === 4));
  assert.equal(blockPackageOf({ ...mk(40, 78), blockPkg: 'no_such_thing' }), 'block_basic', 'an unknown package falls back to his tier');
});

test('the five Block Packages: six styles a tier, in the catalog and the store, gated by Block rating with the height break', async () => {
  assert.equal(BLOCK_PACKAGES.length, 5);
  assert.deepEqual(BLOCK_PACKAGES.map(k => k.tier), [1, 2, 3, 4, 5]);
  const items = blockPackageItems();
  for (const it of items) {
    const cat = catalog[it.id];
    assert.ok(cat, `${it.id} is in server/catalog.json`);
    assert.deepEqual(cat, it, `${it.id}: the catalog entry is the table's`);
    assert.equal(cat.slot, 'block'); assert.equal(cat.category, 'animation'); assert.equal(cat.styles.length, 6);
    assert.ok(cat.styles.every(id => BLOCK_BY_ID[id].tier === it.tier), 'the tier\'s six');
  }
  assert.equal(items[0].price, 0, 'Fundamentals is free'); assert.ok(items.slice(1).every((it, i) => it.price > (items[i].price || 0)), 'dearer up the tiers');
  // the requirement: the tier's Block rating; a tier less for 6'11"+, a tier more for 6'1" and under
  assert.deepEqual(items.map(i => i.min_attr.block ?? 0), [0, 55, 70, 85, 95]);
  assert.deepEqual(items.map(i => i.min_attr_tall.block ?? 0), [0, 0, 55, 70, 85]);
  assert.deepEqual(items.map(i => i.min_attr_short.block ?? 0), [0, 70, 85, 95, 95]);
  assert.equal(blockPackageNeed(4, 84), 70); assert.equal(blockPackageNeed(4, 72), 95); assert.equal(blockPackageNeed(1, 72), 0);
  // the store's lock reason and the bots' canEquip read the same height break
  const { canEquip, minAttrFor } = await import('../client/js/sim/bots.js');
  const hammer = catalog.block_hammer;
  assert.deepEqual(minAttrFor(hammer, 78), { block: 85 }); assert.deepEqual(minAttrFor(hammer, 84), { block: 70 }); assert.deepEqual(minAttrFor(hammer, 72), { block: 95 });
  assert.equal(canEquip(hammer, { block: 80 }, 70, 4, 84), true); assert.equal(canEquip(hammer, { block: 80 }, 70, 4, 78), false); assert.equal(canEquip(hammer, { block: 90 }, 70, 4, 72), false); assert.equal(canEquip(hammer, { block: 80 }, 70, 0, 84), false, 'and Rep 4');
  // (the store's lockReason reads minAttrFor with the build's height; it needs a DOM, so the source is checked)
  const storeSrc = fs.readFileSync(new URL('../client/js/ui/store.js', import.meta.url), 'utf8');
  assert.ok(storeSrc.includes("minAttrFor(i, c.height || c.build?.height)") && storeSrc.includes("['block', 'Blocks', 'wide', 'Animations']"), 'the store: height-aware locks and a Blocks tab under Animations');
  assert.ok(/optionalSlot = i => !\[[^\]]*'block'\]/.test(storeSrc), 'the block slot always has something on');
  assert.ok(storeSrc.includes("app.showroom.setPreview('block', { styles: item.styles })"), 'try-on previews the six');
  // the server's defaults and slots
  const py = fs.readFileSync(new URL('../server/builds.py', import.meta.url), 'utf8');
  assert.ok(py.includes('"block": "block_basic"') && /EQUIP_SLOTS = \([^)]*"block"\)/.test(py));
  // the store preview: the package's six in turn, each swatting the ball away
  const { PreviewSim } = await import('../client/js/game/preview.js');
  const sim = new PreviewSim(); sim.setPlayer({ height: 80, weight: 230, wingspan: 85, hand: 'R', attributes: {}, equipment: { block: 'block_eraser' } }, catalog); sim.setPreview('block', { styles: catalog.block_eraser.styles });
  const seen = []; let swats = 0;
  for (let i = 0; i < 60 * 16; i++) { sim.step(1 / 60, 0); const a = sim.player.action; if (a?.bstyle && seen[seen.length - 1] !== a.bstyle) seen.push(a.bstyle); if (sim.ballFree?.swatted && sim.ballFree.vz > 0 && sim.ballFree.vz === 3.2 && a?.hit) swats++; }
  assert.deepEqual(seen.slice(0, 6), catalog.block_eraser.styles, 'all six, in order (then round again)');
  assert.ok(swats > 0);
  // bots pick one by their rating and height; a Player wears what his equipment says
  const rng = new RNG(11), team = makeTeam(rng, 3, { catalog, level: 0.9 });
  assert.ok(team.every(e => catalog[e.build.equipment.block]?.slot === 'block'), 'every bot carries a Block Package');
  const g = new Game({ mode: 'practice', seed: 11, rosters: [team, []], catalog });
  assert.ok(g.players.every(p => p.blockPkg === p.entry.build.equipment.block && blockPackageOf(p) === p.blockPkg));
});

test('every style has its own body: pairwise distinct poses through the rise, the swat and the landing', () => {
  const an = Object.create(Animator.prototype); an.palm = { L: null, R: null };
  const sample = id => {
    const out = [];
    const a = { type: 'block', bstyle: id, jumpAt: 0.06, air: 0.7, hit: true, hitAt: 0.06 + 0.35 };
    for (const [t, up, up2] of [[0.2, 0.45, 0.35], [0.36, 0.9, 0.8], [0.41, 1, 1], [0.5, 1, 1], [0.6, 1, 1]]) {
      const T = neutral(); an.palm = { L: null, R: null };
      an.blockPose(T, a, { u: t - 0.06, air: 0.7, up, up2, tx: 0.2, ty: 2.55, tz: 0.3, ld: 'L', tr: 'R', ls: 1, t });
      for (const k of ['handL', 'handR', 'elbowL', 'elbowR', 'footL', 'footR', 'kneeL', 'kneeR']) out.push(T[P[k]], T[P[k] + 1], T[P[k] + 2]);
      out.push(T[P.spine], T[P.spine + 2], T[P.chest + 1], T[P.head]);
      for (const v of out) assert.ok(Number.isFinite(v), `${id}: finite`);
    }
    // the landing gesture
    for (const q2 of [0.15, 0.4]) { const T = neutral(); an.blockLanding(T, a, q2); for (const k of ['handL', 'handR']) out.push(T[P[k]], T[P[k] + 1], T[P[k] + 2]); out.push(T[P.spine], T[P.head]); }
    return out;
  };
  const S = BLOCK_STYLES.map(s => ({ id: s.id, v: sample(s.id) }));
  let minD = Infinity, pair = '';
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const a = S[i].v, b = S[j].v; let d = 0; for (let k = 0; k < a.length; k++) d += (a[k] - b[k]) ** 2; d = Math.sqrt(d / a.length);
    if (d < minD) { minD = d; pair = `${S[i].id} vs ${S[j].id}`; }
  }
  assert.ok(minD > 0.11, `the closest pair (${pair}) differs by ${minD.toFixed(3)} RMS over the sampled pose`);
  // (qp3 revision: no two packages share a block: across packages every pair is further apart still, every style has
  // its own lead / off-hand / legs triple, and no swat shape is in more than two packages)
  let minX = Infinity, pairX = '';
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    if (BLOCK_BY_ID[S[i].id].tier === BLOCK_BY_ID[S[j].id].tier) continue;
    const a = S[i].v, b = S[j].v; let d = 0; for (let k = 0; k < a.length; k++) d += (a[k] - b[k]) ** 2; d = Math.sqrt(d / a.length);
    if (d < minX) { minX = d; pairX = `${S[i].id} vs ${S[j].id}`; }
  }
  assert.ok(minX > 0.12, `across packages the closest pair (${pairX}) differs by ${minX.toFixed(3)} RMS`);
  assert.equal(new Set(BLOCK_STYLES.map(s => [s.lead, s.off, s.legs].join('/'))).size, 30, 'every style its own lead / off-hand / legs');
  const swatPk = {}; for (const s of BLOCK_STYLES) (swatPk[s.swat] = swatPk[s.swat] || new Set()).add(s.tier);
  for (const [sw, pk] of Object.entries(swatPk)) assert.ok(pk.size <= 2, `the ${sw} swat is in ${pk.size} packages`);
  assert.ok(Object.keys(swatPk).length >= 18, `${Object.keys(swatPk).length} swat shapes`);
  // every lead hand gets up to the ball at the top of the reach
  for (const s of BLOCK_STYLES) {
    const T = neutral(); an.palm = { L: null, R: null };
    const a = { type: 'block', bstyle: s.id, jumpAt: 0.06, air: 0.7, hit: false };
    an.blockPose(T, a, { u: 0.3, air: 0.7, up: 1, up2: 1, tx: 0.2, ty: 2.3, tz: 0.3, ld: 'L', tr: 'R', ls: 1, t: 0.36 });
    const hand = s.lead === 'far' ? 'handR' : 'handL';
    // (qp3 revision: within the arm's reach of the shoulder, clampReach, so a touch under the ball's centre at most)
    assert.ok(T[P[hand] + 1] > 2.0, `${s.id}: a hand up at the ball (${T[P[hand] + 1].toFixed(2)})`);
  }
});

test('in the game: a block picks a style for the moment, the swat fires from the contact, and the body plays it on the rig', () => {
  const rng = new RNG(31);
  const g = new Game({ mode: 'park', seed: 31, rosters: [makeTeam(rng, 3, { catalog, level: 0.7 }), makeTeam(rng, 3, { catalog, level: 0.7 })], catalog, target: 21 });
  const d = g.players[3], h = g.players[0];
  g.phase = 'live'; g.possession = h.team; g.giveBall(h, 'held');
  const rim = g.rimFor(h.team), side = g.sideFor(h.team);
  h.setPos(0, rim.z - side * 1.6, side > 0 ? 0 : Math.PI);
  d.setPos(0.3, rim.z - side * 0.6, side > 0 ? Math.PI : 0);
  g.startJump(d);
  assert.equal(d.action?.type, 'block');
  assert.ok(BLOCK_BY_ID[d.action.bstyle], `a style: ${d.action.bstyle}`);
  assert.ok(BLOCK_BY_ID[d.action.bstyle].situ.includes('rim') || BLOCK_BY_ID[d.action.bstyle].situ.includes('any'), 'at the rim: a rim style');
  // the contact marks the swat and, for a style with a gesture, lengthens the action
  const dur0 = d.action.dur;
  g.giveBall(h, 'held'); h.startAction('layup', 0.6, { takeoff: 0, release: 0.2, tRel: 0.2, side });
  g.blockBall(d, h, false);
  assert.ok(d.action.hit && d.action.hitAt >= 0, 'hit from the contact');
  const st = BLOCK_BY_ID[d.action.bstyle];
  if (st.land !== 'none') assert.ok(d.action.dur > dur0 + 0.5, 'time for the gesture'); else assert.equal(d.action.dur, dur0);
  const ev = g.events.find(e => e.type === 'block');
  assert.equal(ev.style, d.action.bstyle);
  // on the rig: finite joints, hand over the head at the peak, feet never under the floor, for every style
  for (const s of BLOCK_STYLES) {
    const model = new AthleteModel(d.entry.build, {}, 0.5), rig = new Rig(model);
    const view = { H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } };
    const anim = new Animator(view), H = model.d.H;
    const a = d.startAction('block', 0.9, { jumpAt: 0.06, jumpH: 0.5, jumped: false, air: 0.64, bstyle: s.id, lead: 'L' });
    let peakHand = 0, lowFoot = 0, bad = 0;
    for (let i = 0; i < 70; i++) {
      a.t += 1 / 60;
      if (!a.jumped && a.t >= a.jumpAt) { a.jumped = true; d.jump(0.5); }
      if (a.t > 0.3 && !a.hit) { a.hit = true; a.hitAt = a.t; }
      d.vy -= 9.81 / 60; d.y = Math.max(0, d.y + d.vy / 60); if (d.y === 0) { d.vy = 0; d.airborne = false; } else d.airborne = true;
      anim.update(1 / 60, { x: d.x, y: d.y, z: d.z, facing: d.facing }, d, g, { x: d.x + 0.2, y: 2.6, z: d.z + 0.3 });
      const hl = rig.pos[BONE.handL], hr = rig.pos[BONE.handR], hd = rig.pos[BONE.head], fl = rig.pos[BONE.footL], fr = rig.pos[BONE.footR];
      for (const v of [hl, hr, hd, fl, fr]) for (const c of v) if (!Number.isFinite(c)) bad++;
      peakHand = Math.max(peakHand, Math.max(hl[1], hr[1]) - hd[1]);
      if (Math.min(fl[1], fr[1]) < -0.03) lowFoot++;
    }
    d.action = null; d.y = 0; d.vy = 0; d.airborne = false;
    assert.equal(bad, 0, `${s.id}: finite`);
    assert.ok(peakHand > 0.15 * H, `${s.id}: a hand well over the head (${(peakHand / H).toFixed(2)} H)`);
    assert.equal(lowFoot, 0, `${s.id}: feet never under the floor`);
  }
});

test('the gesture after a block never costs a play: wanting to move or jump ends it at once', () => {
  const rng = new RNG(32);
  const g = new Game({ mode: 'park', seed: 32, rosters: [makeTeam(rng, 3, { catalog, level: 0.7 }), makeTeam(rng, 3, { catalog, level: 0.7 })], catalog, target: 21 });
  const d = g.players[3];
  g.phase = 'live';
  const a = d.startAction('block', 0.9, { jumpAt: 0.06, jumpH: 0.5, jumped: true, air: 0.6, bstyle: 'finger_wag', hit: true, hitAt: 0.3 });
  a.t = 0.75; a.dur = 1.7; d.airborne = false; d.y = 0;
  d.intent = { ...d.intent, mx: 0, mz: 0, jump: false, steal: false };
  g.applyIntent(d, 1 / 60);
  assert.equal(d.action, a, 'standing there, the wag plays');
  d.intent = { ...d.intent, mx: 1, mz: 0 };
  g.applyIntent(d, 1 / 60);
  assert.equal(d.action, null, 'he wants to run: the wag is over');
});

// ---------------- qp3 revision: no limb clips through the body ----------------
test('no block clips: arms never pass through the torso, the head, the legs or each other, on three builds', async () => {
  const { ARM_PROBE_UPPER, ARM_PROBE_FORE, ARM_HEAD_R, segSegDist } = await import('../client/js/char/rig.js');
  const M = await import('../client/js/core/math.js');
  const rng = new RNG(31);
  const g = new Game({ mode: 'park', seed: 31, rosters: [makeTeam(rng, 3, { catalog, level: 0.7 }), makeTeam(rng, 3, { catalog, level: 0.7 })], catalog, target: 21 });
  const d = g.players[3]; g.phase = 'live'; g.ball.mode = 'dead'; g.ball.holder = -1;
  const segPt = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const bad = [];
  for (const bd of [{ height: 78, weight: 210, wingspan: 82 }, { height: 84, weight: 260, wingspan: 88 }, { height: 71, weight: 170, wingspan: 72 }]) {
    const build = { ...d.entry.build, ...bd };
    for (const s of BLOCK_STYLES) {
      const model = new AthleteModel(build, {}, 0.5), rig = new Rig(model), H = model.d.H;
      const view = { H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } };
      const anim = new Animator(view);
      const a = d.startAction('block', 0.9, { jumpAt: 0.06, jumpH: 0.5, jumped: false, air: 0.64, bstyle: s.id, lead: 'L', hit: false });
      d.y = 0; d.vy = 0; d.airborne = false; d.setPos(0, 0, 0);
      let torso = 0, head = 0, leg = 0, arms = 0;
      for (let i = 0; i < 90; i++) {
        a.t += 1 / 60;
        if (!a.jumped && a.t >= a.jumpAt) { a.jumped = true; d.jump(0.5); }
        if (a.t > 0.36 && !a.hit) { a.hit = true; a.hitAt = a.t; }
        d.vy -= 9.81 / 60; d.y = Math.max(0, d.y + d.vy / 60); if (d.y === 0) { d.vy = 0; d.airborne = false; } else d.airborne = true;
        anim.update(1 / 60, { x: 0, y: d.y, z: 0, facing: 0 }, d, g, { x: 0.2, y: 2.45, z: 0.3 });
        const pos = rig.pos, chestInv = M.qinvert(M.q4(), rig.rot[BONE.chest]);
        const hd = pos[BONE.head], hc = [hd[0], hd[1] + 0.055 * H, hd[2] + 0.01 * H], hr = 0.07 * H;
        const arm = { L: [[pos[BONE.upperL], pos[BONE.foreL]], [pos[BONE.foreL], pos[BONE.handL]]], R: [[pos[BONE.upperR], pos[BONE.foreR]], [pos[BONE.foreR], pos[BONE.handR]]] };
        const legs = [[pos[BONE.thighL], pos[BONE.shinL]], [pos[BONE.shinL], pos[BONE.footL]], [pos[BONE.thighR], pos[BONE.shinR]], [pos[BONE.shinR], pos[BONE.footR]]];
        let fT = 0, fH = 0, fL = 0;
        for (const side of ['L', 'R']) for (const [si, [p, q]] of arm[side].entries()) for (const [k, thr] of (si === 0 ? ARM_PROBE_UPPER : ARM_PROBE_FORE)) {
          const pt = segPt(p, q, k), tt = rig.torsoAt(pt, chestInv);
          if (tt && tt.x * tt.x + tt.z * tt.z < thr - 0.02) fT++;
          if (Math.hypot(pt[0] - hc[0], pt[1] - hc[1], pt[2] - hc[2]) < ARM_HEAD_R * H - 0.012 * H) fH++; // (the arm's surface off the head)
          for (const [lp, lq] of legs) if (segSegDist(pt, pt, lp, lq) < 0.059 * H) fL++;
        }
        if (fT) torso++; if (fH) head++; if (fL) leg++;
        if (segSegDist(pos[BONE.foreL], pos[BONE.handL], pos[BONE.foreR], pos[BONE.handR]) < 0.04 * H) arms++;
      }
      d.action = null; d.y = 0; d.vy = 0; d.airborne = false;
      if (torso || head || leg || arms) bad.push(`${s.id} @${bd.height}": torso ${torso} head ${head} legs ${leg} arms ${arms}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('the arm clearance leaves ordinary poses alone and fixes an arm aimed through the body', async () => {
  const { Rig, ARM_PROBE_UPPER } = await import('../client/js/char/rig.js');
  const M = await import('../client/js/core/math.js');
  const build = { height: 78, weight: 210, wingspan: 82, hand: 'R', attributes: {} };
  const model = new AthleteModel(build, {}, 0.5), rig = new Rig(model), H = model.d.H;
  // natural poses: nothing to do
  for (const [name, hx, hy, hz, ex, ey, ez] of [['hanging', null], ['hand on the far shoulder', -0.25, 1.62, 0.18, 0.6, -0.3, 0.6], ['hand in front of the chest', 0.0, 1.45, 0.35, 0.8, -0.4, 0.3], ['hands on hips', 0.3, 1.1, 0.05, 0.9, -0.4, -0.3]]) {
    const p2 = neutral(); if (hx != null) { p2[P.handL] = hx; p2[P.handL + 1] = hy; p2[P.handL + 2] = hz; p2[P.elbowL] = ex; p2[P.elbowL + 1] = ey; p2[P.elbowL + 2] = ez; }
    rig.solve(p2, {});
    const chestInv = M.qinvert(M.q4(), rig.rot[BONE.chest]);
    assert.equal(rig.armPenetration(rig.pos[BONE.upperL], rig.pos[BONE.foreL], rig.pos[BONE.handL], chestInv), 0, `${name}: clear`);
    // the hand lands where the pose asked
    if (hx != null) { const w = rig.pos[BONE.handL], s = rig.s; assert.ok(Math.hypot(w[0] - hx * s, w[1] - hy * s, w[2] - hz * s) < 0.16 * s, `${name}: the hand is where it was put`); }
  }
  // a hand aimed straight through the chest to the far hip: the arm is kept out of the body
  const p3 = neutral(); p3[P.handL] = -0.3; p3[P.handL + 1] = 1.25; p3[P.handL + 2] = -0.02; p3[P.elbowL] = 0.3; p3[P.elbowL + 1] = -0.5; p3[P.elbowL + 2] = -0.8;
  rig.solve(p3, {});
  const chestInv = M.qinvert(M.q4(), rig.rot[BONE.chest]);
  const S = rig.pos[BONE.upperL], E = rig.pos[BONE.foreL], W = rig.pos[BONE.handL];
  assert.ok(rig.armPenetration(S, E, W, chestInv) < 0.25, 'the arm is brought (almost all the way) out of the torso'); // (a target inside the far hip: as far out as the arm allows)
  assert.ok(Math.abs(W[2]) > 0.06 * H, `the hand came out through the nearest skin, front or back (z ${(W[2] / H).toFixed(2)} H)`);
  assert.ok(ARM_PROBE_UPPER[0][1] < ARM_PROBE_UPPER[3][1], 'the upper arm is held looser near the shoulder');
});
