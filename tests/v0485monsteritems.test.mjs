// v0.4.8.5 quick patch 2: The Monster Mash's own seven prizes (server/cup.py PRIZES_MONSTER): the Bone Suit (a
// glow-in-the-dark skeleton bodysuit: top with gloves, and tights), the Coffin hi-tops with their skull charm, the
// Jack-o'-Lantern band, the Zombie Shuffle, the Jack-o'-Lantern green release and the Haunted Organ. They exist, they're
// the event's alone (never sold; on the AI only once one has won them, qp7), and every one is really drawn, posed, played
// or heard.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AthleteModel, SHOE_CHARM } from '../client/js/char/athlete.js';
import { Animator } from '../client/js/char/animator.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';
import { Player } from '../client/js/sim/player.js';
import { makeBot, makeTeam, resolveLook } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import * as M from '../client/js/core/math.js';
import { GREEN_FX, GREEN_FX_IDS, GreenFxRunner } from '../client/js/game/greenfx.js';
import { GREEN_SOUNDS, GREEN_SOUND_IDS, greenRecipe, renderGreen } from '../client/js/core/greensound.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(src('server/catalog.json'));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const IDS = ['mm_bones_top', 'mm_bones_tights', 'mm_shoes_coffin', 'mm_band_pumpkin', 'mm_celly_zombie', 'mm_gfx_lantern', 'mm_gsnd_organ'];
const BUILD = { height: 78, weight: 210, wingspan: 82 };
const SUIT = { top: catalog.mm_bones_top, bottom: catalog.mm_bones_tights };
const finite = g => g.position.every(Number.isFinite) && g.normal.every(Number.isFinite) && g.uv.every(Number.isFinite);
const range = (g, k, sel = () => true) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < g.position.length / 3; i++) if (sel(i)) { lo = Math.min(lo, g.position[i * 3 + k]); hi = Math.max(hi, g.position[i * 3 + k]); } return [lo, hi]; };
// share of the vertices (picked by sel) whose normal points away from their own centre: a closed shape faces out
const outward = (g, sel) => {
  const P = g.position, N = g.normal, c = [0, 0, 0]; let n = 0;
  for (let i = 0; i < P.length / 3; i++) if (sel(i)) { c[0] += P[i * 3]; c[1] += P[i * 3 + 1]; c[2] += P[i * 3 + 2]; n++; }
  let out = 0;
  for (let i = 0; i < P.length / 3; i++) if (sel(i) && N[i * 3] * (P[i * 3] - c[0] / n) + N[i * 3 + 1] * (P[i * 3 + 1] - c[1] / n) + N[i * 3 + 2] * (P[i * 3 + 2] - c[2] / n) > 0) out++;
  return out / n;
};

test('the seven prizes: the ids the prize table hands out, exclusive to the Mash, free, in the event\'s own voice', () => {
  const mm = list.filter(i => i.exclusive === 'monster');
  assert.deepEqual(mm.map(i => i.id).sort(), [...IDS].sort());
  assert.deepEqual(mm.map(i => i.slot).sort(), ['bottom', 'celebration', 'greenfx', 'greensound', 'headband', 'shoes', 'top']);
  for (const i of mm) {
    assert.ok(i.price === 0 && i.min_overall === 0 && i.rep_required === 0 && i.original_2k_asset === false && i.v0485qp2 === true, i.id);
    assert.doesNotMatch(i.name + i.description, /\b2k\b|\bnba\b|giant/i, i.id);
  }
  // the tiers (cup.py): the suit for the winner, the shoes and the green FX for the top 3, the celly and the sound for the
  // top 10, the band for the top 25
  const tier = { mm_bones_top: 'grand prize', mm_bones_tights: 'grand prize', mm_shoes_coffin: 'exclusive (top 3)', mm_gfx_lantern: 'exclusive (top 3)', mm_celly_zombie: 'exclusive (top 10)', mm_gsnd_organ: 'exclusive (top 10)', mm_band_pumpkin: 'exclusive (top 25)' };
  for (const [id, t] of Object.entries(tier)) assert.ok(catalog[id].description.startsWith(`The Monster Mash ${t}.`) || catalog[id].description.startsWith(`Monster Mash ${t}.`), id);
  const cup = src('server/cup.py'), table = cup.slice(cup.indexOf('PRIZES_MONSTER = ('), cup.indexOf('PRIZES = PRIZES_KINGTUT'));
  for (const id of IDS) assert.ok(table.includes(`"${id}"`), `${id} in PRIZES_MONSTER`);
  // every id the table hands out is a real item here (none left out, none misspelled)
  for (const id of table.match(/"mm_[a-z_]+"/g)) assert.ok(catalog[id.slice(1, -1)], id);
  // names of their own (nothing else in the catalog is called the same), and the Zombie Shuffle's animation is its own
  const names = list.map(i => i.name.toLowerCase());
  for (const i of mm) assert.equal(names.filter(n => n === i.name.toLowerCase()).length, 1, i.name);
  assert.equal(list.filter(i => i.anim === 'zombie').length, 1);
  assert.equal(new Set(list.map(i => i.id)).size, list.length, 'ids unique');
});

// (v0.4.8.5 qp7: an AI hooper of the persistent world wears the Mash prizes he has won: tests/v0485qp7ai.test.mjs. A bare
// makeBot has unlocked nothing: nothing unlocked → nothing worn)
test('nothing unlocked → nothing worn: no bare bot, at any level, ever wears or plays a Monster Mash exclusive', () => {
  const rng = new RNG(31);
  for (let n = 0; n < 160; n++) {
    const b = makeBot(rng, { catalog, level: (n % 10) / 10 });
    for (const [slot, id] of Object.entries(b.build.equipment || {})) assert.ok(!IDS.includes(id), `bot ${n} ${slot}: ${id}`);
  }
  assert.ok(src('client/js/sim/bots.js').includes('!i.exclusive'));
});

test('the Bone Suit top: a skin-tight bodysuit with gloves, its skeleton painted as anatomy and glowing at night', () => {
  const top = catalog.mm_bones_top;
  assert.equal(top.family, 'compression'); assert.equal(top.pattern, 'bones'); assert.ok(top.glow && top.trim && top.color);
  const m = new AthleteModel(BUILD, SUIT, 1), g = m.buildTop(top), H = m.d.H;
  assert.ok(finite(g));
  // the uv the painter draws into: the torso v 0 - .75 (its anatomy laid round it by angle), the sleeves .78 - 1
  let torso = 0, sleeve = 0; for (let i = 1; i < g.uv.length; i += 2) { if (g.uv[i] <= 0.7501) torso++; else if (g.uv[i] >= 0.7799) sleeve++; else assert.fail(`uv v ${g.uv[i]}`); }
  assert.ok(torso > 1000 && sleeve > 1000);
  // the gloves: both hands again (every finger), a hair bigger, on the hands' own bones, with a cuff over the sleeve's end
  const gl = m.gloveGeo; assert.ok(gl && finite(gl), 'gloves built with the top');
  const plain = new AthleteModel(BUILD, {}, 1); plain.buildTop({ family: 'compression' }); assert.equal(plain.gloveGeo, null, 'no gloves on any other top');
  const body = m.buildBody(), handBones = new Set([B.handL, B.handR]);
  const onHand = (geo, i) => handBones.has(geo.joints[i * 4]) && geo.weights[i * 4] > 0.9;
  for (const s of [1, -1]) {
    const [bx0, bx1] = range(body, 1, i => onHand(body, i) && s * body.position[i * 3] > 0), [gx0, gx1] = range(gl, 1, i => onHand(gl, i) && s * gl.position[i * 3] > 0);
    assert.ok(gx0 < bx0 && gx1 > bx1 - 0.002 * H, `the glove covers the hand top to fingertips (${s})`);
    assert.ok(outward(gl, i => onHand(gl, i) && s * gl.position[i * 3] > 0) > 0.7, 'and faces out');
  }
  // its uv: the palm and the back of the hand u 0-.5, v 0-.5; the fingers u .5-1; the thumb u 0-.25 v .5-.75; the cuff v .78-.98
  for (let i = 0; i < gl.uv.length; i += 2) { const u = gl.uv[i], v = gl.uv[i + 1]; assert.ok((v <= 0.5001) || (u <= 0.2501 && v <= 0.7501) || (u >= 0.2499 && v >= 0.7799 && v <= 0.9801), `glove uv ${u} ${v}`); }
  // painted and lit: the bones and their glow map on the top, the tights and the gloves; the anatomy is all there
  const v = src('client/js/char/view.js'), l = src('client/js/char/looks.js');
  assert.ok(v.includes("paintBones(top, 'top', true, boneRes)") && v.includes("paintBones(bot, 'bottom', true, boneRes)") && v.includes('paintBoneGlove(top, true)') && v.includes('if (geo.gloves)'));
  assert.ok(l.includes('export function paintBones') && l.includes('export function paintBoneGlove'));
  for (const part of ['the costal arch', 'the sternum', 'the collarbones', 'the spine (C7 to L5', 'the shoulder blades', 'the humerus', 'the radius', 'the ulna', 'the carpals', 'the metacarpals', 'phalanges', 'function bonePelvis', 'the femur', 'the kneecap', 'the tibia', 'the fibula']) assert.ok(l.includes(part), part);
  // (it isn't the mo-cap suit's lines and dots: a painter of its own, nothing of mocapMarks)
  const painter = l.slice(l.indexOf('export function paintBones'), l.indexOf('export function paintBoneGlove'));
  assert.ok(!painter.includes('mocapMarks') && painter.includes('torsoAng('));
});

test('the Bone Suit tights: hugging the legs, the thigh and the shin each with their own share of the texture', () => {
  const tights = catalog.mm_bones_tights;
  assert.equal(tights.family, 'joggers'); assert.equal(tights.pattern, 'bones');
  const m = new AthleteModel(BUILD, SUIT, 1), g = m.buildBottom(tights), H = m.d.H;
  const loose = new AthleteModel(BUILD, {}, 1).buildBottom({ family: 'joggers' });
  assert.ok(finite(g));
  // skin-tight: the thigh no wider than plain joggers' (which hang loose)
  const width = geo => { let w = 0; for (let i = 0; i < geo.position.length / 3; i++) { const y = geo.position[i * 3 + 1] / H; if (y > 0.36 && y < 0.38) w = Math.max(w, Math.abs(geo.position[i * 3])); } return w; };
  assert.ok(width(g) < width(loose) - 0.002 * H, `tight (${(width(g) / H).toFixed(3)}H vs ${(width(loose) / H).toFixed(3)}H)`);
  // the thigh v .5 - .76 (the femur), the shin .76 - 1 (tibia and fibula): no texel is shared between them
  let thigh = 0, shin = 0, waist = 0;
  for (let i = 0; i < g.uv.length / 2; i++) { const v = g.uv[i * 2 + 1], y = g.position[i * 3 + 1] / H; if (v < 0.5) waist++; else if (y > 0.27) { thigh++; assert.ok(v <= 0.7601, `thigh v ${v}`); } else if (y < 0.24) { shin++; assert.ok(v >= 0.7599, `shin v ${v} at ${y}`); } }
  assert.ok(thigh > 200 && shin > 200 && waist > 200);
  assert.ok(src('client/js/char/athlete.js').includes("const bones = bot.pattern === 'bones';"));
});

test('the Coffin Hi: its own design, its slime glowing, and a little skull charm on the laces', () => {
  const s = catalog.mm_shoes_coffin;
  assert.equal(s.model, 'coffin'); assert.equal(s.cut, 'high');
  const look = resolveLook({ ...BUILD, equipment: { shoes: s.id } }, catalog);
  assert.deepEqual([look.gear.shoes.model, look.gear.shoes.lace, look.gear.shoes.sole], ['coffin', s.lace, s.sole]);
  const shoe = model => { const m = new AthleteModel(BUILD, {}, 1); m.buildGear({ shoes: { ...look.gear.shoes, model } }); return m; };
  const m = shoe('coffin'), withCharm = m.shoeGeo, without = shoe('rise').shoeGeo, H = m.d.H;
  assert.ok(finite(withCharm));
  const n1 = withCharm.position.length / 3, n0 = without.position.length / 3;
  assert.ok(n1 > n0 + 600, `charm vertices ${n1 - n0}`);
  // the charm reads two swatches between the shoe's halves (u .5): bone white (v .75) and the glowing eye sockets (v .25)
  const charm = i => Math.abs(withCharm.uv[i * 2] - 0.5) < 1e-6;
  let bone = 0, eyes = 0; for (let i = 0; i < n1; i++) if (charm(i)) { if (Math.abs(withCharm.uv[i * 2 + 1] - 0.75) < 1e-6) bone++; else if (Math.abs(withCharm.uv[i * 2 + 1] - 0.25) < 1e-6) eyes++; }
  assert.ok(bone > 400 && eyes > 200, `${bone} bone, ${eyes} socket vertices`);
  // it sits up on top of the laces of each shoe (above the upper, over the instep), a skull a couple of centimetres across, facing out
  for (const sg of [1, -1]) {
    const sel = i => charm(i) && sg * withCharm.position[i * 3] > 0;
    const [y0, y1] = range(withCharm, 1, sel), [x0, x1] = range(withCharm, 0, sel), [sy0, sy1] = range(without, 1, i => sg * without.position[i * 3] > 0);
    assert.ok(y1 > sy1 * 0.45 && y0 > 0.025 * H, `on the laces (${(y0 / H).toFixed(3)} .. ${(y1 / H).toFixed(3)}H)`);
    assert.ok(x1 - x0 > 0.008 * H && x1 - x0 < 0.016 * H, `${((x1 - x0) / H).toFixed(4)}H across`);
    assert.ok(outward(withCharm, i => sel(i) && Math.abs(withCharm.uv[i * 2 + 1] - 0.75) < 1e-6) > 0.7);
  }
  assert.ok(SHOE_CHARM.t > 0.38 && SHOE_CHARM.t < 0.5, 'by the top lace');
  const l = src('client/js/char/looks.js'), v = src('client/js/char/view.js');
  assert.ok(l.includes("case 'coffin': coffinShoe(") && l.includes('export function paintShoeGlow') && l.includes('function coffinShoe'));
  assert.ok(v.includes("sh.model === 'coffin' ? sharedTex(ctx, key + ':e', () => paintShoeGlow(sh), {})"));
});

test('the Jack-o\'-Lantern band: a pumpkin-orange band with a carved pumpkin standing out on the front, lit inside', () => {
  const b = catalog.mm_band_pumpkin;
  assert.equal(b.pattern, 'jackolantern'); assert.ok(b.glow && b.color);
  const look = resolveLook({ ...BUILD, equipment: { headband: b.id } }, catalog);
  assert.equal(look.gear.headband.pattern, 'jackolantern');
  const m = new AthleteModel(BUILD, look, 1); m.buildGear(look.gear);
  const g = m.lanternGeo, R = m.d.headR, c = m.headCenter(); assert.ok(g && finite(g));
  // the band: round the head, on the head bone; the pumpkin (uv u > .5) on the front, standing well out of the band
  // (squat: wider than tall), its stem on top
  for (let i = 0; i < g.joints.length; i += 4) assert.equal(g.joints[i], B.head);
  const band = i => g.uv[i * 2] < 0.5, pumpkin = i => g.uv[i * 2] > 0.5001 && Math.abs(g.uv[i * 2] - 0.505) > 1e-6, stem = i => Math.abs(g.uv[i * 2] - 0.505) < 1e-6;
  const [, bz] = range(g, 2, band), [, pz] = range(g, 2, pumpkin), [px0, px1] = range(g, 0, pumpkin), [py0, py1] = range(g, 1, pumpkin), [, sy] = range(g, 1, stem);
  const [bx0, bx1] = range(g, 0, band);
  assert.ok(bx1 - bx0 > 1.4 * R, 'all the way round');
  assert.ok(pz > bz + 0.15 * R, `the pumpkin stands out ${((pz - bz) / R).toFixed(2)}R`);
  assert.ok(px1 - px0 > py1 - py0 && px1 - px0 > 0.4 * R && Math.abs((px0 + px1) / 2 - c[0]) < 0.02 * R, 'squat, centred on the forehead');
  assert.ok(sy > py1, 'the stem on top');
  assert.ok(outward(g, pumpkin) > 0.8);
  // a plain band is unchanged (no lantern mesh)
  const m2 = new AthleteModel(BUILD, {}, 1); m2.buildGear({ headband: { color: '#ffffff' } }); assert.equal(m2.lanternGeo, null);
  const v = src('client/js/char/view.js'), l = src('client/js/char/looks.js');
  assert.ok(v.includes('if (geo.lantern)') && v.includes('paintLantern(hb, true)') && v.includes('this.lanternMat.emissive[0]'), 'drawn, glowing, flickering');
  assert.ok(l.includes('export function paintLantern'));
  assert.ok(src('client/js/sim/bots.js').includes('pattern: item(eq.headband).pattern'));
});

test('the Zombie Shuffle: arms locked straight out in front, the head lolled, a dragging shuffle, a twitch, a lunge', () => {
  assert.equal(catalog.mm_celly_zombie.anim, 'zombie');
  assert.ok(src('client/js/char/animator.js').includes('  zombie: (T, t, k, an) => {'));
  const e = makeTeam(new RNG(3), 1, { catalog, level: 0.7 })[0];
  const p = new Player(0, 0, e, catalog), model = new AthleteModel(e.build, {}, 0.5), rig = new Rig(model);
  const anim = new Animator({ H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); } });
  for (let i = 0; i < 30; i++) anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
  p.startAction('celebrate', 1.6, { kind: 'zombie' });
  const H = model.d.H, up = q => { const o = [0, 0, 0]; M.v3transformQuat(o, [0, 1, 0], q); return o; };
  const elbow = s => { const a = rig.pos[B['upper' + s]], b = rig.pos[B['fore' + s]], c = rig.pos[B['hand' + s]], u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]; return Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)) * 180 / Math.PI; };
  const tr = [];
  for (let i = 0; i < 96; i++) {
    p.action.t += 1 / 60; anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
    const P = rig.pos;
    tr.push({ t: p.action.t, hz: Math.min(P[B.handL][2], P[B.handR][2]) / H, hy: (P[B.handL][1] - P[B.upperL][1]) / H, el: Math.min(elbow('L'), elbow('R')), roll: up(rig.rot[B.head])[0] - up(rig.rot[B.chest])[0],
      fr: P[B.footR][2] / H, fl: P[B.footL][2] / H, hipz: P[B.hips][2] / H, hipy: P[B.hips][1] / H });
  }
  const at = s => tr.reduce((a, q) => (Math.abs(q.t - s) < Math.abs(a.t - s) ? q : a));
  const win = (a, b) => tr.filter(q => q.t >= a && q.t <= b), max = (a, k) => Math.max(...a.map(q => q[k])), min = (a, k) => Math.min(...a.map(q => q[k]));
  // the arms: from a third of a second to the end of the lunge, straight (elbows locked) and out in front at about
  // shoulder height
  for (const q of win(0.32, 1.4)) {
    assert.ok(q.el > 165, `t ${q.t.toFixed(2)} elbows ${q.el.toFixed(0)}`);
    assert.ok(q.hz > 0.28 && Math.abs(q.hy) < 0.09, `t ${q.t.toFixed(2)} hands ${q.hz.toFixed(2)}H out, ${q.hy.toFixed(2)}H from the shoulder`);
  }
  // the head lolls over to one side through the shuffle
  for (const q of win(0.4, 0.74)) assert.ok(Math.abs(q.roll) > 0.3, `t ${q.t.toFixed(2)} head roll ${q.roll.toFixed(2)}`);
  // the shuffle: the right foot slides out in front and back again (dragging: never lifted high), the hips ride over it
  const sh = win(0.2, 0.8);
  assert.ok(max(sh, 'fr') > 0.12 && at(0.8).fr < 0.03, `the right foot out ${max(sh, 'fr').toFixed(2)}H and back`);
  assert.ok(max(sh, 'hipz') > 0.04 && at(0.85).hipz < 0.02, 'the hips lurch forward and back');
  assert.ok(Math.abs(max(sh, 'fl')) < 0.01, 'the left foot stays put');
  // the twitch: the head flops over to the other side and back inside a quarter of a second
  const tw = win(0.74, 1.0), r0 = at(0.72).roll;
  assert.ok(tw.some(q => Math.sign(q.roll) !== Math.sign(r0) && Math.abs(q.roll) > 0.12), 'the head flops across');
  assert.ok(max(tw, 'roll') - min(tw, 'roll') > 0.45, `twitch ${(max(tw, 'roll') - min(tw, 'roll')).toFixed(2)}`);
  // the lunge: the left foot stamps out in front, he drops and throws himself forward, the hands thrust further out
  const l0 = at(0.95), l1 = at(1.3);
  assert.ok(l1.fl > 0.15 && l1.hipz > l0.hipz + 0.05 && l1.hipy < l0.hipy - 0.03 && l1.hz > l0.hz + 0.05, `lunge ${JSON.stringify(l1)}`);
});

test('the Jack-o\'-Lantern: a pumpkin rises and swells over his head, lights up, and bursts into bats on the make (fx.flight)', () => {
  assert.equal(GREEN_FX.mm_gfx_lantern, catalog.mm_gfx_lantern.name); assert.ok(GREEN_FX_IDS.includes('mm_gfx_lantern'));
  for (const flight of [0.8, 1.4]) {
    let live = [], total = 0, peak = 0; const log = [];
    const ps = { emit(o) { const q = { ...o, age: 0 }; live.push(q); total++; return q; }, burst(x, y, z, n, o) { for (let k = 0; k < n; k++) { live.push({ x, y, z, life: o?.life || 0.8, age: 0, burst: true }); total++; } } };
    const r = new GreenFxRunner(ps, { view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    r.play('mm_gfx_lantern', () => [0, 2.1, 0], () => [0, 0, 0], 1, { flight });
    for (let f = 0; f < 220; f++) {
      const before = total; r.tick(1 / 60);
      for (const q of live) q.age += 1 / 60; live = live.filter(q => q.age < q.life); peak = Math.max(peak, live.length);
      // (by colour: the orange shell, the candle-yellow face, the purple bats)
      const vis = live.filter(q => q.hold && q.size > 0), c = q => q.color;
      const shell = vis.filter(q => c(q)[0] > c(q)[1] * 4 && c(q)[2] < c(q)[1] && c(q)[0] < 1.5), face = vis.filter(q => c(q)[1] > c(q)[0] * 0.3 && c(q)[1] < c(q)[0] * 0.95 && c(q)[0] > 0.6), bats = vis.filter(q => c(q)[2] > c(q)[0]);
      const ys = shell.map(q => q.y), xs = shell.map(q => q.x);
      log.push({ t: (f + 1) / 60, born: total - before, n: shell.length, y: ys.length ? ys.reduce((a, b) => a + b) / ys.length : null, w: xs.length ? Math.max(...xs) - Math.min(...xs) : 0, face: face.length, bats: bats.length, spread: bats.length ? Math.max(...bats.map(q => Math.hypot(q.x, q.z))) : 0 });
    }
    assert.equal(r.jobs.length, 0); assert.ok(peak < 1200 && total < 6000, `peak ${peak}, total ${total}`);
    assert.ok(live.every(q => [q.x, q.y, q.z].every(Number.isFinite)));
    const at = s => log[Math.round(s * 60) - 1];
    // it rises off his head and swells (a pumpkin half a metre across, over his head)
    assert.ok(at(0.4).y > at(0.03).y + 0.15 && at(0.4).y > 2.3 && at(0.4).y < 2.8, `rises (${at(0.03).y.toFixed(2)} -> ${at(0.4).y.toFixed(2)})`);
    assert.ok(at(0.4).w > at(0.03).w * 2 && at(0.4).w > 0.35 && at(0.4).w < 0.6, `swells to ${at(0.4).w.toFixed(2)} m`);
    // dark at first, then its face lights up (and stays lit to the make)
    assert.ok(at(0.1).face === 0 && at(0.45).face > 40 && at(flight - 0.03).face > 40, 'the candle catches');
    assert.ok(at(flight - 0.03).n > 200, 'the shell is all there right up to the make');
    // the burst: a rush of new particles the frame the shot drops, the pumpkin gone, and the bats pouring out
    const burst = log.findIndex(q => q.born > 300) / 60;
    assert.ok(Math.abs(burst - flight) < 0.04, `bursts at ${burst.toFixed(2)} for a ${flight} s flight`);
    assert.ok(at(flight + 0.05).n === 0 && at(flight + 0.05).face === 0, 'and the pumpkin is gone');
    assert.ok(at(flight + 0.1).bats > 200, 'bats');
    assert.ok(at(flight + 0.6).spread > at(flight + 0.1).spread + 0.8, `flying off every way (${at(flight + 0.1).spread.toFixed(2)} -> ${at(flight + 0.6).spread.toFixed(2)} m)`);
  }
  // the bats flap (their wing tips go up and down) and the smoke is ghost green
  const g = src('client/js/game/greenfx.js');
  assert.ok(g.includes('flap = Math.sin(tt * bt.rate + bt.ph)') && g.includes('ghost: [0.04, 0.3, 0.12]'));
});

test('the Haunted Organ: a minor chord on a pedal note, a thunder crack, a chain, a gate creaking, a theremin rising', () => {
  assert.equal(GREEN_SOUNDS.mm_gsnd_organ, catalog.mm_gsnd_organ.name); assert.ok(GREEN_SOUND_IDS.includes('mm_gsnd_organ') && greenRecipe('mm_gsnd_organ'));
  const SR = 44100, x = renderGreen('mm_gsnd_organ'), st = renderGreen.stats;
  assert.ok(x.every(Number.isFinite));
  // as loud as every other green, never clipping (the 808 and the Pharaoh's Horn level the same way)
  assert.ok(st.loud > 0.058 && st.loud < 0.095 && st.peak <= 0.951, `loud ${st.loud.toFixed(3)} peak ${st.peak.toFixed(3)}`);
  assert.ok(st.dur > 1.5 && st.dur <= 4.21, `${st.dur.toFixed(2)} s`);
  renderGreen('bg_gsnd_808'); const ref = renderGreen.stats; assert.ok(Math.abs(st.loud - ref.loud) < 0.01);
  const tone = (t0, t1, f) => { let re = 0, im = 0; const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR), n = i1 - i0; for (let i = i0; i < i1; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - i0) / n), a = 2 * Math.PI * f * i / SR; re += x[i] * w * Math.cos(a); im += x[i] * w * Math.sin(a); } return (re * re + im * im) / (n * n); };
  const loudest = (t0, t1, lo, hi, step = 2) => { let b = 0, bf = 0; for (let f = lo; f <= hi; f += step) { const p = tone(t0, t1, f); if (p > b) { b = p; bf = f; } } return bf; };
  const hp = (t0, t1) => { let s = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) { const d = x[i] - 2 * x[i - 1] + x[i - 2]; s += d * d; } return s / ((t1 - t0) * SR); };
  const band = (t0, t1, lo, hi) => { let s = 0; for (let f = lo; f <= hi; f += 25) s += tone(t0, t1, f); return s; };
  const N = n => 440 * Math.pow(2, (n - 69) / 12);
  // the mordent: A, then G, on top
  assert.ok(tone(0, 0.05, N(81)) > tone(0, 0.05, N(79)) * 100 && tone(0.06, 0.1, N(79)) > tone(0, 0.05, N(79)) * 100, 'A-G-A');
  // the pedal: D2 under the chord
  const ped = loudest(0.25, 0.7, 30, 120, 0.5); assert.ok(Math.abs(ped - N(38)) < 2, `pedal ${ped} Hz`);
  // the chord: D, F, A and C# ring; the notes between them don't (a D minor chord with its leading tone)
  const on = [62, 65, 69, 73].map(n => tone(0.3, 0.7, N(n))), off = [64, 67, 68, 70].map(n => tone(0.3, 0.7, N(n)));
  assert.ok(Math.min(...on) > Math.max(...off) * 30, `chord ${on.map(v => (10 * Math.log10(v)).toFixed(0))} vs ${off.map(v => (10 * Math.log10(v)).toFixed(0))} dB`);
  // the thunder crack under the chord's first moment: the highs jump
  assert.ok(hp(0.15, 0.25) > hp(0.07, 0.13) * 3 && hp(0.15, 0.25) > hp(0.3, 0.5) * 3, 'the crack');
  // the chain's clinks, then the gate's creak, each brightening its own band over the organ's
  assert.ok(band(0.55, 0.8, 2600, 6000) > band(0.3, 0.5, 2600, 6000) * 1.4 && hp(0.55, 0.75) > hp(0.3, 0.5) * 5, 'the chain');
  assert.ok(band(0.9, 1.15, 1100, 2600) > band(0.45, 0.65, 1100, 2600) * 1.5 && band(0.9, 1.15, 1100, 2600) > band(1.45, 1.7, 1100, 2600) * 3, 'the creak');
  // and the theremin rises out of it, past an octave
  const f0 = loudest(1.1, 1.18, 400, 1300, 3), f1 = loudest(1.62, 1.7, 400, 1300, 3);
  assert.ok(f0 > 420 && f0 < 620 && f1 > f0 * 1.7, `theremin ${f0} -> ${f1} Hz`);
  assert.ok(src('client/js/core/greenworker.js').includes('renderGreen(id, { ts })'));
});
