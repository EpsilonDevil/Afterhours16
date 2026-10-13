// v0.4.8.5 quick patch: And The Beat Goes On's own seven prizes (server/cup.py PRIZES_BEAT): the 80s shell suit
// (windbreaker and track pants), the Boombox hi-tops with their velcro strap, the Neon Terry band, the Running Man, the
// Disco Ball green release and the Eight-O-Eight green sound. They exist, they're the event's alone (never sold, never on
// the AI), and every one is really drawn, posed, played or heard.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AthleteModel, SHOE_STRAP } from '../client/js/char/athlete.js';
import { Animator } from '../client/js/char/animator.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';
import { Player } from '../client/js/sim/player.js';
import { makeBot, makeTeam, resolveLook } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { GREEN_FX, GREEN_FX_IDS, GreenFxRunner } from '../client/js/game/greenfx.js';
import { GREEN_SOUNDS, GREEN_SOUND_IDS, greenRecipe, renderGreen } from '../client/js/core/greensound.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(src('server/catalog.json'));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const IDS = ['bg_tracksuit_top', 'bg_tracksuit_pants', 'bg_shoes_boombox', 'bg_band_terry', 'bg_celly_runningman', 'bg_gfx_discoball', 'bg_gsnd_808'];
const BUILD = { height: 78, weight: 210, wingspan: 82 };
const SUIT = { top: catalog.bg_tracksuit_top, bottom: catalog.bg_tracksuit_pants };
const yRange = g => { let lo = 1e9, hi = -1e9; for (let i = 1; i < g.position.length; i += 3) { lo = Math.min(lo, g.position[i]); hi = Math.max(hi, g.position[i]); } return [lo, hi]; };
const finite = g => g.position.every(Number.isFinite) && g.normal.every(Number.isFinite);

test('the seven prizes: the ids the prize table hands out, exclusive to the Beat, free, in the event\'s own voice', () => {
  const bg = list.filter(i => i.exclusive === 'beat');
  assert.deepEqual(bg.map(i => i.id).sort(), [...IDS].sort());
  assert.deepEqual(bg.map(i => i.slot).sort(), ['bottom', 'celebration', 'greenfx', 'greensound', 'headband', 'shoes', 'top']);
  for (const i of bg) {
    assert.ok(i.price === 0 && i.min_overall === 0 && i.rep_required === 0 && i.original_2k_asset === false && i.v0485qp === true, i.id);
    assert.doesNotMatch(i.name + i.description, /\b2k\b|\bnba\b|giant/i, i.id);
  }
  // the tiers (cup.py): the suit for the winner, the shoes and the green FX for the top 3, the celly and the sound for the
  // top 10, the band for the top 25
  const tier = { bg_tracksuit_top: 'grand prize', bg_tracksuit_pants: 'grand prize', bg_shoes_boombox: 'exclusive (top 3)', bg_gfx_discoball: 'exclusive (top 3)', bg_celly_runningman: 'exclusive (top 10)', bg_gsnd_808: 'exclusive (top 10)', bg_band_terry: 'exclusive (top 25)' };
  for (const [id, t] of Object.entries(tier)) assert.ok(catalog[id].description.startsWith(`And The Beat Goes On ${t}.`), id);
  const cup = src('server/cup.py'), table = cup.slice(cup.indexOf('PRIZES_BEAT = ('), cup.indexOf('PRIZES = PRIZES_KINGTUT'));
  for (const id of IDS) assert.ok(table.includes(`"${id}"`), `${id} in PRIZES_BEAT`);
  // names of their own (nothing else in the catalog is called the same, no celebration shares the Running Man)
  const names = list.map(i => i.name.toLowerCase());
  for (const i of bg) assert.equal(names.filter(n => n === i.name.toLowerCase()).length, 1, i.name);
  assert.equal(list.filter(i => i.anim === 'runningman').length, 1);
});

test('never on the AI: no bot, at any level, ever wears or plays a Beat exclusive', () => {
  const rng = new RNG(85);
  for (let n = 0; n < 160; n++) {
    const b = makeBot(rng, { catalog, level: (n % 10) / 10 });
    for (const [slot, id] of Object.entries(b.build.equipment || {})) assert.ok(!IDS.includes(id), `bot ${n} ${slot}: ${id}`);
  }
  assert.ok(src('client/js/sim/bots.js').includes('!i.exclusive'));
});

test('the windbreaker: its own cut (a stand-up collar, blousing over an elastic waistband, gathered cuffs), painted and shiny', () => {
  const top = catalog.bg_tracksuit_top;
  assert.equal(top.family, 'shell'); assert.equal(top.pattern, 'shellsuit');
  assert.ok(top.color && top.secondary && top.accent && top.stripe && top.trim);
  const m = new AthleteModel(BUILD, SUIT, 1), shell = m.buildTop(top), hoodie = m.buildTop({ ...top, family: 'hoodie', pattern: 'solid' });
  assert.ok(finite(shell));
  // the collar stands up round the neck, above where any hoodie's body goes, and it has the strip of texture of its own
  const H = m.d.H, [, top1] = yRange(shell), [, top2] = yRange(hoodie);
  assert.ok(top1 > 0.86 * H, `collar up to ${(top1 / H).toFixed(3)}H`);
  let collar = 0; for (let i = 1; i < shell.uv.length; i += 2) if (shell.uv[i] > 0.751 && shell.uv[i] < 0.779) collar++;
  assert.ok(collar > 60, `${collar} collar vertices`);
  // the rib cuff strip (v .955-1) and the waistband rows exist; cuffs pulled in tighter than the forearm above them
  let cuff = 0; for (let i = 1; i < shell.uv.length; i += 2) if (shell.uv[i] > 0.955) cuff++;
  assert.ok(cuff > 20);
  assert.equal(m.topCut(top).shell, true); assert.ok(m.topCut(top).keep(0.845, 0), 'no neckline cut: the zip closes it');
  // drawn with its own painter and the nylon material
  const v = src('client/js/char/view.js'), l = src('client/js/char/looks.js');
  assert.ok(v.includes("paintShell(top, 'top'") && v.includes("paintShell(bot, 'bottom'") && v.includes('shellTop ? 0.36'));
  assert.ok(l.includes('export function paintShell') && l.includes("'BEAT GOES ON'"));
  // a chain sits outside the collar; an arm sleeve stays under the long sleeves
  const a = src('client/js/char/athlete.js');
  assert.ok(a.includes("fam === 'hoodie' || fam === 'shell' ? fabric") && a.includes("topFam === 'hoodie' || topFam === 'shell'"));
});

test('the track pants: one tapering leg (not shorts over leggings) into an elastic cuff just over a hi-top\'s collar, socks pulled up under it', () => {
  const pants = catalog.bg_tracksuit_pants;
  assert.equal(pants.family, 'joggers'); assert.equal(pants.pattern, 'shellsuit');
  const H = new AthleteModel(BUILD, {}, 1).d.H;
  const cuffed = new AthleteModel(BUILD, SUIT, 1), plain = new AthleteModel(BUILD, { top: SUIT.top, bottom: { ...pants, pattern: 'solid' } }, 1);
  const gc = cuffed.buildBottom(pants), gp = plain.buildBottom({ ...pants, pattern: 'solid' });
  assert.ok(finite(gc));
  // the cuff ends above a hi-top's collar (0.108 H), where plain joggers run down into the shoe
  const [lo] = yRange(gc), [lo2] = yRange(gp);
  assert.ok(lo > 0.1 * H && lo < 0.125 * H, `cuff bottom at ${(lo / H).toFixed(3)}H`);
  assert.ok(lo2 < 0.08 * H);
  // and the socks come up to meet it (so no bare shin between the cuff and a low-top)
  const sock = g => yRange(g)[1];
  const socks = cuffed.buildGear({ shoes: { cut: 'low' } }), socks2 = new AthleteModel(BUILD, { bottom: { family: 'joggers' } }, 1).buildGear({ shoes: { cut: 'low' } });
  assert.ok(sock(socks) > sock(socks2) + 0.05 * H, 'tube socks');
  assert.ok(sock(socks) > lo + 0.01 * H, 'the sock tucks up under the cuff');
});

test('the Boombox hi-top: its own design and a real velcro strap laid over the upper', () => {
  const s = catalog.bg_shoes_boombox;
  assert.equal(s.model, 'boombox'); assert.equal(s.cut, 'high');
  const look = resolveLook({ ...BUILD, equipment: { shoes: s.id } }, catalog);
  assert.equal(look.gear.shoes.model, 'boombox');
  const shoe = model => { const m = new AthleteModel(BUILD, {}, 1); m.buildGear({ shoes: { ...look.gear.shoes, model } }); return m.shoeGeo; };
  const withStrap = shoe('boombox'), without = shoe('rise');
  assert.ok(finite(withStrap));
  const n1 = withStrap.position.length / 3, n0 = without.position.length / 3;
  assert.ok(n1 > n0 + 100, `strap vertices ${n1 - n0}`);
  // the strap stands off the leather: its points sit outside the upper's (further from the foot's centre line)
  assert.ok(SHOE_STRAP.thick > 0 && SHOE_STRAP.t0 < SHOE_STRAP.t1 && SHOE_STRAP.v0 > 0.5);
  const l = src('client/js/char/looks.js');
  assert.ok(l.includes("case 'boombox':") && l.includes('SHOE_STRAP'), 'paintShoe draws the strap where the mesh lies');
});

test('the Neon Terry: a plush striped terry band of its own (matte, crisp stripes in order), passed through to the look', () => {
  const b = catalog.bg_band_terry;
  assert.deepEqual(b.stripes, ['#ff3fa4', '#ffe23f', '#2fe0ff']);
  const look = resolveLook({ ...BUILD, equipment: { headband: b.id } }, catalog);
  assert.deepEqual(look.gear.headband.stripes, b.stripes);
  const m = new AthleteModel(BUILD, look, 1); m.buildGear(look.gear);
  const g = m.terryGeo; assert.ok(g && finite(g));
  // the top rows are pink, the bottom ones cyan (stripes go top to bottom)
  const H = m.d.H, n = g.position.length / 3; let topY = -1e9, botY = 1e9, topC = null, botC = null;
  for (let i = 0; i < n; i++) { const y = g.position[i * 3 + 1]; if (y > topY) { topY = y; topC = [g.color[i * 4], g.color[i * 4 + 1], g.color[i * 4 + 2]]; } if (y < botY) { botY = y; botC = [g.color[i * 4], g.color[i * 4 + 1], g.color[i * 4 + 2]]; } }
  assert.ok(topC[0] > topC[1] * 3 && topC[2] > topC[1], 'pink on top'); assert.ok(botC[2] > botC[0] * 3, 'cyan at the bottom');
  assert.ok(topY - botY > 0.022 * H, `a tall band (${((topY - botY) / H).toFixed(3)}H)`);
  // a plain band is unchanged (no terry mesh)
  const m2 = new AthleteModel(BUILD, {}, 1); m2.buildGear({ headband: { color: '#ffffff' } }); assert.equal(m2.terryGeo, null);
  assert.ok(src('client/js/char/view.js').includes("if (geo.terry) add(geo.terry"));
  assert.ok(src('client/js/sim/bots.js').includes('stripes: item(eq.headband).stripes'));
});

test('the Running Man: knees up in turn, the other foot hopping back, arms pumping, the hips dipping on the beat', () => {
  assert.equal(catalog.bg_celly_runningman.anim, 'runningman');
  assert.ok(src('client/js/char/animator.js').includes('  runningman: (T, t, k'));
  const e = makeTeam(new RNG(3), 1, { catalog, level: 0.7 })[0];
  const p = new Player(0, 0, e, catalog), model = new AthleteModel(e.build, {}, 0.5), rig = new Rig(model);
  const anim = new Animator({ H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); } });
  for (let i = 0; i < 30; i++) anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
  p.startAction('celebrate', 1.6, { kind: 'runningman' });
  const H = model.d.H, tr = [];
  for (let i = 0; i < 96; i++) {
    p.action.t += 1 / 60; anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
    tr.push({ t: p.action.t, fl: rig.pos[B.footL][1] / H, fr: rig.pos[B.footR][1] / H, zl: rig.pos[B.footL][2] / H, zr: rig.pos[B.footR][2] / H, hl: rig.pos[B.handL][2] / H, hip: rig.pos[B.hips][1] / H });
  }
  const live = tr.filter(q => q.t > 0.3 && q.t < 1.3), max = k => Math.max(...live.map(q => q[k])), min = k => Math.min(...live.map(q => q[k]));
  assert.ok(max('fl') - min('fl') > 0.1 && max('fr') - min('fr') > 0.1, `the knees come up (${(max('fl') - min('fl')).toFixed(2)}H, ${(max('fr') - min('fr')).toFixed(2)}H)`);
  assert.ok(max('zl') - min('zl') > 0.12 && max('zr') - min('zr') > 0.12, 'the feet slide well back');
  // never both feet up at once: when one is high the other is down
  for (const q of live) assert.ok(Math.min(q.fl, q.fr) < 0.06, `t ${q.t.toFixed(2)} both feet up`);
  assert.ok(Math.abs(live.find(q => q.fl === max('fl')).t - live.find(q => q.fr === max('fr')).t) > 0.2, 'left, then right');
  assert.ok(max('hl') - min('hl') > 0.12, 'the arms pump'); assert.ok(max('hip') - min('hip') > 0.011, `the hips dip (${(max('hip') - min('hip')).toFixed(3)}H)`);
});

test('the Disco Ball: drops in over his head on its line, turns throwing light, and bursts on the make (fx.flight)', () => {
  assert.equal(GREEN_FX.bg_gfx_discoball, catalog.bg_gfx_discoball.name); assert.ok(GREEN_FX_IDS.includes('bg_gfx_discoball'));
  const run = flight => {
    let live = [], total = 0, peak = 0; const log = [];
    const ps = { emit(o) { const q = { ...o, age: 0 }; live.push(q); total++; return q; }, burst(x, y, z, n, o) { for (let k = 0; k < n; k++) { live.push({ x, y, z, life: o?.life || 0.8, age: 0, burst: true }); total++; } } };
    const r = new GreenFxRunner(ps, { view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    r.play('bg_gfx_discoball', () => [0, 2.1, 0], () => [0, 0, 0], 1, { flight });
    for (let f = 0; f < 180; f++) {
      const before = total; r.tick(1 / 60);
      for (const q of live) q.age += 1 / 60; live = live.filter(q => q.age < q.life); peak = Math.max(peak, live.length);
      // the ball: the held particles with size (facets), their highest and lowest point
      const held = live.filter(q => q.hold && q.size > 0.03 && q.size < 0.06);
      log.push({ t: (f + 1) / 60, born: total - before, top: held.length ? Math.max(...held.map(q => q.y)) : null, n: held.length });
    }
    assert.equal(r.jobs.length, 0); assert.ok(peak < 1200 && total < 6000, `peak ${peak}, total ${total}`);
    assert.ok(live.every(q => [q.x, q.y, q.z].every(Number.isFinite)));
    return log;
  };
  for (const flight of [0.8, 1.4]) {
    const log = run(flight), at = s => log[Math.round(s * 60) - 1];
    // it comes down from above and settles over his head (0.4-0.9 m above the anchor)
    assert.ok(at(0.05).top > at(0.6).top + 1, `drops (${at(0.05).top.toFixed(2)} -> ${at(0.6).top.toFixed(2)})`);
    assert.ok(at(0.6).top > 2.1 + 0.4 && at(0.6).top < 2.1 + 0.95);
    assert.ok(at(flight - 0.05).n > 40, 'the ball is all there right up to the make');
    // the burst: a rush of new particles the frame the ball is gone
    const burst = log.findIndex(q => q.born > 150) / 60;
    assert.ok(Math.abs(burst - flight) < 0.04, `bursts at ${burst.toFixed(2)} for a ${flight} s flight`);
    assert.ok(at(flight + 0.1).n === 0, 'and the ball is gone');
  }
});

test('the Eight-O-Eight: an 808 kick, the cowbell, a gated snare and a rising arpeggio, as loud as every other green', () => {
  assert.equal(GREEN_SOUNDS.bg_gsnd_808, catalog.bg_gsnd_808.name); assert.ok(GREEN_SOUND_IDS.includes('bg_gsnd_808') && greenRecipe('bg_gsnd_808'));
  const SR = 44100, x = renderGreen('bg_gsnd_808'), st = renderGreen.stats;
  assert.ok(x.every(Number.isFinite));
  assert.ok(st.loud > 0.058 && st.loud < 0.095 && st.peak <= 0.951, `loud ${st.loud.toFixed(3)} peak ${st.peak.toFixed(3)}`);
  assert.ok(st.dur > 1.0 && st.dur < 2.2, `${st.dur.toFixed(2)} s`);
  // the power at one frequency over a window (a single Hann-windowed DFT bin)
  const tone = (t0, t1, f) => { let re = 0, im = 0; const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR), n = i1 - i0; for (let i = i0; i < i1; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - i0) / n), a = 2 * Math.PI * f * i / SR; re += x[i] * w * Math.cos(a); im += x[i] * w * Math.sin(a); } return (re * re + im * im) / (n * n); };
  const loudest = (t0, t1, lo, hi, step = 5) => { let b = 0, bf = 0; for (let f = lo; f <= hi; f += step) { const p = tone(t0, t1, f); if (p > b) { b = p; bf = f; } } return bf; };
  const hp = (t0, t1) => { let s = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) { const d = x[i] - 2 * x[i - 1] + x[i - 2]; s += d * d; } return s / ((t1 - t0) * SR); };
  // the kick: a boom down around 50 Hz under the downbeat
  const f0 = loudest(0.02, 0.2, 30, 140, 2); assert.ok(f0 > 40 && f0 < 75, `kick at ${f0} Hz`);
  // the 808 cowbell (587 / 845 Hz) on the sixteenths after it
  const cb = loudest(0.09, 0.2, 500, 1000, 3); assert.ok(Math.abs(cb - 587) < 25 || Math.abs(cb - 845) < 25, `cowbell at ${cb} Hz`);
  // the snare's room, held open and then gated shut: the highs (a second difference) fall off a cliff
  const open = hp(0.42, 0.58), shut = hp(0.66, 0.72);
  assert.ok(open > shut * 20, `gate ${(open / shut).toFixed(0)}x`);
  // the arpeggio climbs: C4 at its start, then E4, G4 ... to the held C6 at the top
  const a0 = loudest(0.5, 0.548, 200, 450, 2), a1 = loudest(0.548, 0.596, 200, 450, 2), top = loudest(0.85, 1.15, 600, 1400, 2);
  assert.ok(Math.abs(a0 - 261.6) < 15 && Math.abs(a1 - 329.6) < 15, `arp ${a0} -> ${a1}`);
  assert.ok(Math.abs(top - 1046.5) < 20, `top note ${top}`);
  // rendered on the worker like every green (greenworker.js renders any recipe by id)
  assert.ok(src('client/js/core/greenworker.js').includes('renderGreen(id, { ts })'));
});
