// v0.4.8.7 The Favelas' own seven prizes (server/cup.py PRIZES_FAVELA): the Morro Kit (a striped football-style jersey
// and shorts with a painted-tile hem), the Ladeira hi-tops, the Hillside Bandana, the Passinho, the Pipa green release and
// the Cuica. They exist, they're the event's alone (never sold; on the AI only once one has won them), every one is
// really drawn, posed, played or heard, and the Passinho changes nothing about any other celebration.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Animator } from '../client/js/char/animator.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';
import { Player } from '../client/js/sim/player.js';
import { makeBot, makeTeam, resolveLook, WEAR_SETS } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { hexToRgb } from '../client/js/core/math.js';
import { morroStripe, morroTile, LADEIRA_TILES } from '../client/js/char/looks.js';
import { PASSINHO, PASSINHO_STEPS, passinhoFeet } from '../client/js/char/passinho.js';
import { TailSway } from '../client/js/char/sway.js';
import { GREEN_FX, GREEN_FX_IDS, GreenFxRunner, PIPA } from '../client/js/game/greenfx.js';
import { GREEN_SOUNDS, GREEN_SOUND_IDS, greenRecipe, renderGreen } from '../client/js/core/greensound.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(src('server/catalog.json'));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const IDS = ['fv_morro_top', 'fv_morro_shorts', 'fv_shoes_ladeira', 'fv_band_bandana', 'fv_celly_passinho', 'fv_gfx_pipa', 'fv_gsnd_cuica'];
const BUILD = { height: 78, weight: 210, wingspan: 82 };
const KIT = { top: 'fv_morro_top', bottom: 'fv_morro_shorts', shoes: 'fv_shoes_ladeira', headband: 'fv_band_bandana' };
const finite = g => g.position.every(Number.isFinite) && g.normal.every(Number.isFinite) && g.uv.every(Number.isFinite);
const range = (g, k, sel = () => true) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < g.position.length / 3; i++) if (sel(i)) { lo = Math.min(lo, g.position[i * 3 + k]); hi = Math.max(hi, g.position[i * 3 + k]); } return [lo, hi]; };

test('the seven prizes: the ids the prize table hands out, exclusive to the Favelas, free, in the event\'s own voice', () => {
  const fv = list.filter(i => i.exclusive === 'favela');
  assert.deepEqual(fv.map(i => i.id).sort(), [...IDS].sort());
  assert.deepEqual(fv.map(i => i.slot).sort(), ['bottom', 'celebration', 'greenfx', 'greensound', 'headband', 'shoes', 'top']);
  for (const i of fv) {
    assert.ok(i.price === 0 && i.min_overall === 0 && i.rep_required === 0 && i.original_2k_asset === false && i.v0487 === true, i.id);
    // (clearance: no 2K terms, no league, no brands, no real people)
    assert.doesNotMatch(i.name + i.description, /\b2k\b|\bnba\b|mypark|myplayer|nike|adidas|jordan|pel[eé]|neymar|cbf|seleç/i, i.id);
  }
  const tier = { fv_morro_top: 'grand prize', fv_morro_shorts: 'grand prize', fv_shoes_ladeira: 'exclusive (top 3)', fv_gfx_pipa: 'exclusive (top 3)', fv_celly_passinho: 'exclusive (top 10)', fv_gsnd_cuica: 'exclusive (top 10)', fv_band_bandana: 'exclusive (top 25)' };
  for (const [id, t] of Object.entries(tier)) assert.ok(catalog[id].description.startsWith(`The Favelas ${t}.`), id);
  const cup = src('server/cup.py'), table = cup.slice(cup.indexOf('PRIZES_FAVELA = ('), cup.indexOf('PRIZES = PRIZES_KINGTUT'));
  for (const id of IDS) assert.ok(table.includes(`"${id}"`), `${id} in PRIZES_FAVELA`);
  for (const id of table.match(/"fv_[a-z_]+"/g)) assert.ok(catalog[id.slice(1, -1)], id);
  const names = list.map(i => i.name.toLowerCase());
  for (const i of fv) assert.equal(names.filter(n => n === i.name.toLowerCase()).length, 1, i.name);
  assert.equal(list.filter(i => i.anim === 'passinho').length, 1);
  assert.equal(new Set(list.map(i => i.id)).size, list.length, 'ids unique');
  // the store and the inventory say where it comes from
  for (const f of ['client/js/ui/store.js', 'client/js/ui/inventory.js']) assert.ok(src(f).includes("i.exclusive === 'favela' ? '★ THE FAVELAS'"), f);
  assert.ok(src('client/js/ui/store.js').includes('Win it at The Favelas'));
});

test('nothing unlocked → nothing worn: no bare bot ever wears or plays a Favelas exclusive; the kit goes on as a set once won', () => {
  const rng = new RNG(41);
  for (let n = 0; n < 160; n++) {
    const b = makeBot(rng, { catalog, level: (n % 10) / 10 });
    for (const [slot, id] of Object.entries(b.build.equipment || {})) assert.ok(!IDS.includes(id), `bot ${n} ${slot}: ${id}`);
  }
  assert.ok(WEAR_SETS.some(([a, b]) => a === 'fv_morro_top' && b === 'fv_morro_shorts'));
});

test('the Morro Kit: sun-faded stripes round the body, the painted tiles round the hems, a football shirt\'s number and name', () => {
  const top = catalog.fv_morro_top, bot = catalog.fv_morro_shorts;
  assert.equal(top.pattern, 'morro'); assert.equal(bot.pattern, 'morro'); assert.equal(top.family, 'tee'); assert.equal(bot.family, 'shorts');
  assert.ok(top.stripes.length === 2 && top.tile && top.lettering === 'MORRO');
  const look = resolveLook({ ...BUILD, equipment: KIT }, catalog);
  assert.equal(look.top.pattern, 'morro'); assert.equal(look.bottom.pattern, 'morro');
  const m = new AthleteModel(BUILD, look, 1);
  assert.ok(finite(m.buildTop(look.top)) && finite(m.buildBottom(look.bottom)));
  // the stripes: green, sunflower and sky blue all the way round (twelve repeats), paler toward the shoulders
  const base = hexToRgb(top.color), st = top.stripes.map(hexToRgb), seen = new Set();
  for (let u = 0; u < 1; u += 0.002) { const c = morroStripe(u, base, st, 1, 0); seen.add(c[2] > c[0] + 0.2 ? 'blue' : c[0] > 0.7 && c[1] > 0.6 && c[2] < 0.5 ? 'yellow' : c[1] > c[0] && c[1] > c[2] ? 'green' : '?'); }
  assert.deepEqual([...seen].sort(), ['blue', 'green', 'yellow']);
  const lum = c => c[0] + c[1] + c[2];
  assert.ok(lum(morroStripe(0.3, base, st, 0, 0)) > lum(morroStripe(0.3, base, st, 1, 0)), 'faded by the sun up top');
  // a tile: the border and the flower in ink, bare glaze between, four-fold symmetric
  const glaze = hexToRgb(top.trim), ink = hexToRgb(top.tile);
  assert.equal(morroTile(0.02, 0.5, glaze, ink), ink); assert.equal(morroTile(0.5, 0.5, glaze, ink), glaze); assert.equal(morroTile(0.5, 0.25, glaze, ink), ink);
  let inked = 0;
  for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) {
    const a = morroTile((x + 0.5) / 40, (y + 0.5) / 40, glaze, ink);
    assert.equal(a, morroTile((y + 0.5) / 40, (x + 0.5) / 40, glaze, ink)); assert.equal(a, morroTile(1 - (x + 0.5) / 40, (y + 0.5) / 40, glaze, ink));
    if (a === ink) inked++;
  }
  assert.ok(inked > 400 && inked < 1200, `ink on ${inked} of 1600`);
  const l = src('client/js/char/looks.js');
  assert.ok(l.includes("const morro = spec.pattern === 'morro'") && l.includes('morroTile((u * 24) % 1') && l.includes('morroTile((lu * 10) % 1'));
  assert.ok(l.includes('outlineText(num, W * 0.75, yOf(0.705), 92 * S, trim, sec)'), 'the number on the back');
});

test('the Ladeira hi-top: its own design (the tile panel down each side), a gum sole with lugs up the toe and heel', () => {
  const s = catalog.fv_shoes_ladeira;
  assert.equal(s.model, 'ladeira'); assert.equal(s.cut, 'high');
  const look = resolveLook({ ...BUILD, equipment: { shoes: s.id } }, catalog);
  assert.deepEqual([look.gear.shoes.model, look.gear.shoes.sole, look.gear.shoes.accent], ['ladeira', s.sole, s.accent]);
  const [r, g, b] = hexToRgb(s.sole); assert.ok(r > g && g > b && r > 0.6 && b < 0.4, 'gum');
  const m = new AthleteModel(BUILD, {}, 1); m.buildGear(look.gear); assert.ok(m.shoeGeo && finite(m.shoeGeo));
  // the panel sits on the side panel of the texture (v .52 - .86, the upper above the midsole), heel to toe
  const T = LADEIRA_TILES; assert.ok(T.v0 >= 0.52 && T.v1 <= 0.86 && T.t0 > 0.1 && T.t1 < 0.8 && T.cols * T.rows >= 8);
  const l = src('client/js/char/looks.js');
  assert.ok(l.includes("case 'ladeira': ladeiraShoe(") && l.includes('function ladeiraShoe') && l.includes("model === 'ladeira' ? rgbStr(shade(hexToRgb(sole), 0.78))"));
  // the lugs read from across a court: dark gum blocks all along the sidewall, up past the midsole at the toe and heel
  const lad = l.slice(l.indexOf('function ladeiraShoe'), l.indexOf('function smoothT'));
  assert.ok(lad.includes('deep = rgbStr(shade(sole, 0.34))') && lad.includes('for (let t = 0.01; t < 0.99; t += 0.05) poly(half') && /h = 0\.43/.test(lad));
  // (and the store tries a band on close up)
  assert.ok(src('client/js/ui/store.js').includes("const focus = item?.slot === 'headband' || item?.slot === 'chain' ? 'upper'"));
});

test('the Hillside Bandana: a printed band round the head, knotted at the back, its two ends hanging down', () => {
  const b = catalog.fv_band_bandana;
  assert.equal(b.pattern, 'bandana'); assert.ok(b.color && b.trim);
  const look = resolveLook({ ...BUILD, equipment: { headband: b.id } }, catalog);
  assert.equal(look.gear.headband.pattern, 'bandana'); assert.equal(look.gear.headband.trim, b.trim);
  const m = new AthleteModel(BUILD, look, 1); m.buildGear(look.gear);
  const g = m.bandanaGeo, R = m.d.headR, c = m.headCenter(); assert.ok(g && finite(g));
  for (let i = 0; i < g.joints.length; i += 4) assert.equal(g.joints[i], B.head);
  const band = i => g.uv[i * 2] < 0.8001, knot = i => g.uv[i * 2] > 0.8099;
  const [bx0, bx1] = range(g, 0, band), [by0, by1] = range(g, 1, band), [kz0] = range(g, 2, knot);
  assert.ok(bx1 - bx0 > 1.4 * R, 'all the way round');
  assert.ok(by1 - by0 > 0.18 * R && by1 - by0 < 0.45 * R, `a folded band ${((by1 - by0) / R).toFixed(2)}R tall`);
  assert.ok(kz0 < c[2] - 0.9 * R, 'the knot at the back of the head');
  // the ends: their own mesh (they swing), on the head bone, hanging down the back from the knot
  const tg = m.bandanaTailGeo, bt = m.bandanaTail; assert.ok(tg && finite(tg) && bt);
  for (let i = 0; i < tg.joints.length; i += 4) assert.equal(tg.joints[i], B.head);
  const [ty0] = range(tg, 1), [tx0, tx1] = range(tg, 0);
  assert.ok(ty0 < by0 - 0.6 * R, `the ends hang down ${((by0 - ty0) / R).toFixed(2)}R below the band`);
  assert.ok(tx1 - tx0 < 0.75 * R, 'close together, down the back of the head');
  assert.ok(bt.dir[1] < -0.7 && bt.len > 0.9 * R, `hanging down (${bt.dir.map(v => v.toFixed(2))}), ${(bt.len / R).toFixed(2)}R long`);
  // a plain band is unchanged (no bandana mesh)
  const m2 = new AthleteModel(BUILD, {}, 1); m2.buildGear({ headband: { color: '#ffffff' } }); assert.equal(m2.bandanaGeo, null);
  const v = src('client/js/char/view.js'), l = src('client/js/char/looks.js');
  assert.ok(v.includes('if (geo.bandana)') && v.includes('paintBandana(hb)'), 'drawn with its print');
  assert.ok(l.includes('export function paintBandana'));
});

test('the bandana\'s ends hang toward the ground and swing: they lag when he moves off, swing past when he stops, settle', () => {
  const look = resolveLook({ ...BUILD, equipment: { headband: 'fv_band_bandana' } }, catalog);
  const m = new AthleteModel(BUILD, look, 1); m.buildGear(look.gear);
  const bt = m.bandanaTail, out = new Float32Array(16);
  const at = (x, pitch = 0) => { const c = Math.cos(pitch), s = Math.sin(pitch), a = new Float32Array(16); a[0] = 1; a[5] = c; a[6] = s; a[9] = -s; a[10] = c; a[15] = 1; a[12] = x; return a; }; // (a head turned about x, moved along x)
  const dirOf = sw => { const p = [out[0] * bt.pivot[0] + out[4] * bt.pivot[1] + out[8] * bt.pivot[2] + out[12], out[1] * bt.pivot[0] + out[5] * bt.pivot[1] + out[9] * bt.pivot[2] + out[13], out[2] * bt.pivot[0] + out[6] * bt.pivot[1] + out[10] * bt.pivot[2] + out[14]], q = sw.tip(out); const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(...d); return d.map(v => v / l); };
  // standing still, the head level or bowed well forward: they hang (nearly) straight down either way
  for (const pitch of [0, 0.6, -0.4]) {
    const sw = new TailSway(bt.pivot, bt.dir, bt.len);
    for (let f = 0; f < 30; f++) sw.step(at(0, pitch), out, f / 60);
    assert.ok(dirOf(sw)[1] < -0.9, `pitch ${pitch}: hanging ${dirOf(sw).map(v => v.toFixed(2))}`);
  }
  // he sets off along +x (8 m/s² for half a second), stops hard: the ends trail behind (-x), then swing on past (+x) and settle
  const sw = new TailSway(bt.pivot, bt.dir, bt.len); let x = 0, v = 0; const tr = [];
  for (let f = 0; f < 240; f++) {
    const t = f / 60, acc = t < 0.5 ? 8 : 0; v = t < 0.5 ? v + acc / 60 : t < 0.55 ? Math.max(0, v - 80 / 60) : 0; x += v / 60;
    sw.step(at(x), out, t); tr.push({ t, dx: dirOf(sw)[0] });
  }
  const win = (a, b) => tr.filter(q => q.t >= a && q.t < b);
  assert.ok(Math.min(...win(0.1, 0.5).map(q => q.dx)) < -0.25, `trailing (${Math.min(...win(0.1, 0.5).map(q => q.dx)).toFixed(2)})`);
  assert.ok(Math.max(...win(0.5, 1.2).map(q => q.dx)) > 0.25, `swinging past (${Math.max(...win(0.5, 1.2).map(q => q.dx)).toFixed(2)})`);
  assert.ok(Math.max(...win(3.5, 4).map(q => Math.abs(q.dx))) < 0.04, 'settled');
  // a teleport (a new possession, a cut) is not a shove: no wild swing, nothing broken
  sw.step(at(40), out, 4.02); sw.step(at(40), out, 4.04);
  assert.ok(out.every(Number.isFinite) && Math.abs(dirOf(sw)[0]) < 0.1);
  const v2 = src('client/js/char/view.js');
  assert.ok(v2.includes('this.tailSway = new TailSway(bt.pivot, bt.dir, bt.len)') && v2.includes('tm.bones = this.tailBones') && (v2.match(/if \(this\.tailSway\) this\.swing\(\);/g) || []).length === 2, 'swung every pose and every move');
});

// a celebration through the animator: the rig's joints at every frame (t: seconds into it)
function celebrate(kind, frames = 96) {
  const e = makeTeam(new RNG(3), 1, { catalog, level: 0.7 })[0];
  const p = new Player(0, 0, e, catalog), model = new AthleteModel(e.build, {}, 0.5), rig = new Rig(model);
  const anim = new Animator({ H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); } });
  for (let i = 0; i < 30; i++) anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
  const stand = rig.pos[B.hips][1];
  p.startAction('celebrate', 1.6, { kind });
  const tr = [];
  for (let i = 0; i < frames; i++) {
    p.action.t += 1 / 60; anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
    tr.push({ t: p.action.t, rig: Object.fromEntries(['handL', 'handR', 'footL', 'footR', 'head', 'hips', 'chest', 'upperL'].map(j => [j, [...rig.pos[B[j]]]])) });
  }
  return { tr, H: model.d.H, stand };
}

test('the Passinho: low and loose, the feet flying in quick heel-and-toe steps, the arms hanging easy', () => {
  assert.equal(catalog.fv_celly_passinho.anim, 'passinho');
  const { tr, H, stand } = celebrate('passinho');
  const win = tr.filter(q => q.t > 0.25 && q.t < 1.3), f = (q, j, k) => q.rig[j][k] / H;
  // low: the hips well under his standing height all through it
  for (const q of win) assert.ok(stand - q.rig.hips[1] > 0.025 * H, `t ${q.t.toFixed(2)} hips only ${((stand - q.rig.hips[1]) / H).toFixed(3)}H down`);
  // the feet: each flicks out in front (a heel), the left taps behind him, the right kicks out to the side
  const zL = win.map(q => f(q, 'footL', 2)), zR = win.map(q => f(q, 'footR', 2)), xR = win.map(q => f(q, 'footR', 0));
  assert.ok(Math.max(...zL) > 0.09 && Math.min(...zL) < -0.06, `left foot ${Math.min(...zL).toFixed(2)} .. ${Math.max(...zL).toFixed(2)}H`);
  assert.ok(Math.max(...zR) > 0.09, `right foot out to ${Math.max(...zR).toFixed(2)}H`);
  assert.ok(Math.min(...xR) < Math.min(...tr.slice(0, 5).map(q => f(q, 'footR', 0))) - 0.06, 'the right foot kicks out to the side');
  // fast: eight steps a second (the left foot every other one, heel out in front, then toe back behind), so in just over
  // a second it's out and back four times, and the feet between them change place eight
  let outs = 0; for (let i = 1; i < zL.length; i++) if (Math.abs(zL[i]) > 0.05 && Math.abs(zL[i - 1]) <= 0.05) outs++;
  assert.ok(outs >= 4, `${outs} left foot flicks`);
  let moves = 0; for (let i = 1; i < win.length; i++) { const a = Math.abs(zL[i]) > Math.abs(zR[i]) + 0.01, b = Math.abs(zL[i - 1]) > Math.abs(zR[i - 1]) + 0.01; if (a !== b) moves++; }
  assert.ok(moves >= 6, `${moves} changes of foot`);
  assert.equal(PASSINHO.rate, 8); assert.equal(PASSINHO_STEPS.length, 4);
  assert.ok(PASSINHO_STEPS.some(s => s.pitch < -0.4) && PASSINHO_STEPS.some(s => s.pitch > 0.4), 'heel (toe up) and toe (toe down) flicks');
  // a step out and back inside each eighth of a second: the moving foot is home at each step's end
  for (let k = 1; k < 9; k++) { const a = passinhoFeet(PASSINHO.lead + k / PASSINHO.rate - 1e-4); assert.ok(Math.abs(a.L[2] - 0.02) < 0.02 && Math.abs(a.R[2] - 0.02) < 0.02, `home at step ${k}`); }
  // the arms hang easy: the hands low, by the hips, never up over the chest
  for (const q of win) for (const s of ['L', 'R']) assert.ok(q.rig['hand' + s][1] < q.rig.chest[1], `t ${q.t.toFixed(2)} hand ${s} low`);
  for (const q of win) assert.ok(q.rig[`footL`].every(Number.isFinite) && q.rig.footR[1] > -0.01, 'feet on or over the floor');
});

test('the Passinho is additive: every other celebration poses exactly as before it (the Godot port reads animator.js)', () => {
  const before = JSON.parse(src('tests/fixtures/celebrations-v0486.json'));
  assert.ok(Object.keys(before).length >= 40);
  for (const [kind, rows] of Object.entries(before)) {
    const { tr } = celebrate(kind);
    const now = tr.filter((_, i) => i % 12 === 11).map(q => ['handL', 'handR', 'footL', 'footR', 'head', 'hips', 'chest'].flatMap(j => q.rig[j].map(v => +v.toFixed(5))));
    for (let r = 0; r < rows.length; r++) for (let k = 0; k < rows[r].length; k++) assert.ok(Math.abs(rows[r][k] - now[r][k]) < 2e-5, `${kind}: changed (row ${r}, value ${k}: ${rows[r][k]} -> ${now[r][k]})`);
  }
  // and in the file itself the Passinho is two lines: its import and its entry in the CELEB2 table
  const a = src('client/js/char/animator.js'), lines = a.split('\n').filter(s => /passinho/i.test(s));
  assert.deepEqual(lines.map(s => s.trim()), ["import { passinhoPose } from './passinho.js'; // (v0.4.8.7 The Favelas: the Passinho celebration)", '// v0.4.8.7 The Favelas: the Passinho (char/passinho.js)', 'passinho: (T, t, k, an) => passinhoPose(T, t, k, an),']);
});

test('the Pipa: paper scraps on the release, then on the make a flight of two-colour kites with fluttering tails fans out and climbs', () => {
  assert.equal(GREEN_FX.fv_gfx_pipa, catalog.fv_gfx_pipa.name); assert.ok(GREEN_FX_IDS.includes('fv_gfx_pipa'));
  for (const flight of [0.7, 1.3]) {
    let live = [], total = 0, peak = 0; const log = [];
    const ps = { emit(o) { const q = { ...o, age: 0 }; live.push(q); total++; return q; }, burst(x, y, z, n, o) { for (let k = 0; k < n; k++) { live.push({ x, y, z, life: o?.life || 0.8, age: 0, burst: true }); total++; } } };
    const r = new GreenFxRunner(ps, { view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    r.play('fv_gfx_pipa', () => [0, 2.1, 0], () => [0, 0, 0], 1, { flight });
    for (let f = 0; f < 260; f++) {
      const before = total; r.tick(1 / 60);
      for (const q of live) q.age += 1 / 60; live = live.filter(q => q.age < q.life); peak = Math.max(peak, live.length);
      const kites = live.filter(q => q.hold && q.size > 0), loose = live.filter(q => !q.hold);
      const tails = kites.filter(q => q.color === PIPA.bow);
      log.push({ t: (f + 1) / 60, born: total - before, kites: kites.length, tails: tails.length, loose: loose.length, top: kites.length ? Math.max(...kites.map(q => q.y)) : 0, spread: kites.length ? Math.max(...kites.map(q => Math.abs(q.x))) : 0, cols: new Set(kites.map(q => q.color)).size });
    }
    assert.equal(r.jobs.length, 0); assert.ok(peak < 1200 && total < 3000, `peak ${peak}, total ${total}`);
    assert.ok(live.every(q => [q.x, q.y, q.z].every(Number.isFinite)));
    const at = s => log[Math.round(s * 60) - 1];
    // before the make: only the paper scraps twirling up (no kites yet)
    assert.ok(at(flight * 0.5).kites === 0 && at(flight * 0.5).loose > 3, 'scraps, no kites, before the make');
    // the make: the frame the shot drops a rush of new particles, and the kites are up
    const burst = log.findIndex(q => q.born > 300) / 60;
    assert.ok(Math.abs(burst - flight) < 0.04, `launches at ${burst.toFixed(2)} for a ${flight} s flight`);
    const k1 = at(flight + 0.1), k2 = at(flight + 0.9);
    assert.ok(k1.kites > 500 && k1.tails >= 8 * PIPA.tail * 0.9, `${k1.kites} kite points, ${k1.tails} tail bows`);
    assert.ok(k1.cols >= 6, `${k1.cols} colours`);
    // climbing and fanning out across the sky, metres above his head
    assert.ok(k2.top > k1.top + 1 && k2.top > 4, `climbing (${k1.top.toFixed(1)} -> ${k2.top.toFixed(1)} m)`);
    assert.ok(k2.spread > k1.spread + 0.8 && k2.spread > 1.4, `fanning out (${k1.spread.toFixed(2)} -> ${k2.spread.toFixed(2)} m)`);
    // and gone inside two seconds of the make
    assert.equal(at(Math.min(4.3, flight + 2)).kites, 0);
  }
  // the tails wave (the wave runs down them) and the kites rock nose first
  const g = src('client/js/game/greenfx.js');
  assert.ok(g.includes('Math.sin(13 * tt - m * 0.85 + kt.ph)') && g.includes('Math.atan2(vy, vx) - Math.PI / 2'));
});

test('the Cuica: quick whoops up and down, then a long call sliding up high and falling away, at every green\'s loudness', () => {
  assert.equal(GREEN_SOUNDS.fv_gsnd_cuica, catalog.fv_gsnd_cuica.name); assert.ok(GREEN_SOUND_IDS.includes('fv_gsnd_cuica') && greenRecipe('fv_gsnd_cuica'));
  const SR = 44100, x = renderGreen('fv_gsnd_cuica'), st = renderGreen.stats;
  assert.ok(x.every(Number.isFinite));
  assert.ok(st.loud > 0.058 && st.loud < 0.095 && st.peak <= 0.951, `loud ${st.loud.toFixed(3)} peak ${st.peak.toFixed(3)}`);
  assert.ok(st.dur > 1.2 && st.dur <= 4.21, `${st.dur.toFixed(2)} s`);
  for (const ref of ['bg_gsnd_808', 'mm_gsnd_organ', 'gsnd_basic']) { renderGreen(ref); assert.ok(Math.abs(st.loud - renderGreen.stats.loud) < 0.01, ref); }
  const tone = (t0, t1, f) => { let re = 0, im = 0; const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR), n = i1 - i0; for (let i = i0; i < i1; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - i0) / n), a = 2 * Math.PI * f * i / SR; re += x[i] * w * Math.cos(a); im += x[i] * w * Math.sin(a); } return (re * re + im * im) / (n * n); };
  const pitch = (t0, t1) => { let b = 0, bf = 0; for (let f = 300; f <= 1200; f += 5) { const p = tone(t0, t1, f); if (p > b) { b = p; bf = f; } } return bf; };
  // the whoops: the first rises, the second falls, the third rises
  const w1 = [pitch(0.01, 0.045), pitch(0.085, 0.125)], w2 = [pitch(0.18, 0.21), pitch(0.25, 0.285)], w3 = [pitch(0.33, 0.365), pitch(0.41, 0.445)];
  assert.ok(w1[1] > w1[0] * 1.4 && w2[1] < w2[0] / 1.3 && w3[1] > w3[0] * 1.4, `whoops ${JSON.stringify([w1, w2, w3])}`);
  // the long call: up past 900 Hz at its height, and down again by its end
  const hi = pitch(0.67, 0.72), lo = pitch(1.0, 1.06);
  assert.ok(hi > 900 && lo < hi / 1.5, `the call ${hi} -> ${lo} Hz`);
});
