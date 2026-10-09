// v0.4.5 quick patch: the redesigned shot meter. The window on screen comes from the same functions that grade the
// release, so letting go anywhere the meter shows green is an Excellent and anywhere else isn't, frame for frame,
// even with a defender closing out. The solid core is the build's own ratings; badges, the Icon badge, a takeover
// and animation bonuses only ever add to the outer (yellow) part. Solid means automatic; outlined means it isn't.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { MatchSession } from '../client/js/game/session.js';
import { meterGradient, METER_COLORS } from '../client/js/game/hud.js';
import * as S from '../client/js/sim/shots.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
const live = (g, me) => MatchSession.prototype.liveMeter.call({ game: g, meterOf: MatchSession.prototype.meterOf }, me, me.action);
const inGreen = m => !!m && !m.smothered && m.half > 0 && Math.abs(m.fill - 1) <= m.half + 1e-9;

// a jumper from `spot` (metres from the rim, straight out), optionally with a defender closing out from `defAt`
function jumperGame(seed, spot, defAt) {
  const rng = new RNG(seed), team = makeTeam(rng, 2, { catalog, level: 0.75 });
  const me = team[0]; me.human = true;
  const g = new Game({ mode: 'practice', seed, rosters: defAt ? [[me], [team[1]]] : [[me], []], catalog });
  const p = g.players[0], rim = g.rimFor(0), side = g.sideFor(0);
  p.archetype = 'sharpshooter'; // (v0.4.7.5 quick patch: a shooter, whose greens from three are sure makes; see v0475qp)
  p.setPos(rim.x, rim.z - side * spot, side > 0 ? 0 : Math.PI);
  if (defAt) { const d = g.players[1]; d.setPos(rim.x + 0.3, rim.z - side * (spot - defAt), side > 0 ? Math.PI : 0); }
  g.giveBall(p, 'held');
  return { g, p };
}

// let go `k` frames into the shot: what did the meter show on the frame you let go, and what was the grade?
function releaseAt(seed, spot, defAt, k) {
  const { g, p } = jumperGame(seed, spot, defAt);
  g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true }); g.step(1 / 60);
  if (p.action?.type !== 'shoot') return null;
  for (let i = 0; i < k; i++) { g.setInput({ mx: 0, mz: 0, shootHeld: true }); g.step(1 / 60); }
  const shown = live(g, p);
  let ev = null;
  for (let i = 0; i < 90 && !ev; i++) { g.setInput({ mx: 0, mz: 0, shootHeld: false }); g.step(1 / 60); ev = g.events.find(e => e.type === 'release'); }
  return { shown, ev, a: p.action };
}

test('the green on the meter is exactly where a release grades Excellent (open, and with a defender closing out)', () => {
  let checked = 0, greens = 0;
  for (const [seed, spot, defAt] of [[3, 5.2, 0], [4, 7.4, 0], [5, 6.4, 2.6], [6, 7.6, 1.8], [7, 4.8, 1.2]]) {
    for (let k = 10; k <= 60; k++) {
      const r = releaseAt(seed, spot, defAt, k);
      if (!r || !r.shown || !r.ev) continue;
      checked++;
      const want = inGreen(r.shown);
      assert.equal(r.ev.grade === 'excellent', want, `seed ${seed}, ${spot} m, frame ${k}: meter fill ${r.shown.fill.toFixed(3)} vs window ±${r.shown.half.toFixed(3)} → ${r.ev.grade}`);
      if (want) greens++;
      // the frozen meter after the release is the graded window, with the cursor where you let go
      assert.ok(Math.abs(1 + r.ev.err / r.ev.tRel - r.shown.fill) < 1e-9, 'frozen where you let go');
      assert.ok(Math.abs(r.ev.win / 1000 / r.ev.tRel - r.shown.half) < 1e-9, 'on the same window');
      // inside 35 ft a green always goes in, so the window is drawn solid
      if (r.ev.grade === 'excellent') { assert.equal(r.shown.sure, true); assert.equal(r.ev.made, true); }
    }
  }
  assert.ok(checked > 200 && greens > 10, `${checked} releases checked, ${greens} greens`);
});

test('the solid core is the build\'s own ratings; badges, Icon badge, takeover and animation bonus only add the outer part', () => {
  const { g, p } = jumperGame(3, 6, 0);
  g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true }); g.step(1 / 60);
  const a = p.action;
  p.badges = {}; p.icon = null; p.shotPkg = { ...p.shotPkg, winK: 1 }; p.refreshRatings();
  // a stat with none of its badges plays under its rating: the whole (smaller) window is core, nothing is yellow
  const bare = g.jumperWindow(p, a, 0);
  assert.ok(Math.abs(bare.total - bare.natural) < 1e-9, 'no badges: all core');
  // with a badge that doesn't touch the window (Clutch), the stat plays at its rating, and the core is that window
  p.badges = { clutch: 1 }; p.refreshRatings();
  const plain = g.jumperWindow(p, a, 0);
  assert.ok(Math.abs(plain.total - plain.natural) < 1e-9 && plain.total > bare.total, 'no boosts: all core');
  assert.ok(Math.abs(plain.natural - S.greenWindowMs(p.raw.mid_range, {}, { d: 6, pkg: p.shotPkg }) * g.speed) < 1e-9, 'the core is the build\'s own Mid-Range');
  const boosts = [
    ['Green Machine (HoF)', () => { p.badges = { clutch: 1, green_machine: 4 }; }],
    ['Sharp Eye Icon badge', () => { p.icon = 'sharp_eye'; }],
    ['Shooting Takeover', () => { p.takeover = { kind: 'shooting', active: true, left: 60, prog: 0 }; p.refreshRatings(); }],
    ['a jumpshot base with a bigger window', () => { p.shotPkg = { ...p.shotPkg, winK: 1.07 }; }],
  ];
  let prev = plain;
  for (const [what, add] of boosts) {
    add();
    const w = g.jumperWindow(p, a, 0);
    assert.ok(w.total > prev.total + 0.5, `${what} grows the window (${prev.total.toFixed(1)} → ${w.total.toFixed(1)} ms)`);
    assert.ok(Math.abs(w.natural - prev.natural) < 1e-6 || w.natural < prev.natural, `${what} doesn't grow the core`);
    prev = w;
  }
  // the core reads the build's ratings: an Icon badge's or a takeover's rating boosts aren't in it
  p.icon = 'the_general'; p.refreshRatings();
  assert.ok(p.ratings.three_point > g.natural(p).three_point, 'The General\'s +2.5% is a boost');
  p.icon = null; p.refreshRatings();
  // a tighter base shrinks the window for real, so it's part of the core, not a negative boost
  p.badges = {}; p.icon = null; p.takeover = { kind: 'shooting', active: false, left: 0, prog: 0 }; p.refreshRatings();
  p.shotPkg = { ...p.shotPkg, winK: 0.95 };
  const tight = g.jumperWindow(p, a, 0);
  assert.ok(Math.abs(tight.total - tight.natural) < 1e-9 && tight.total < plain.total);
  // the same split for layups (Finishing badges, a forgiving package) and free throws
  const lay = { lstyle: 'scoop' };
  p.badges = { contact_finisher: 3 };
  const lw = g.layupWindow(p, lay, 0.8);
  assert.ok(lw.total > lw.natural && lw.sure === false, 'a green layup is a boost, not automatic: outlined');
  p.badges = { green_machine: 2 };
  const fw = g.ftWindow(p);
  assert.ok(fw.total > fw.natural && fw.sure === true);
});

test('past 35 ft the window is outlined (not automatic), and past half court there is none', () => {
  for (const [spot, sure, open] of [[S.DEEP_D - 0.3, true, true], [S.DEEP_D + 0.8, false, true], [S.HALF_D + 0.5, false, false]]) {
    const { g, p } = jumperGame(3, spot, 0);
    g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true }); g.step(1 / 60);
    const m = live(g, p);
    assert.equal(m.sure, sure, `${(spot / 0.3048).toFixed(0)} ft: ${sure ? 'solid' : 'outlined'}`);
    assert.equal(m.half > 0, open, `${(spot / 0.3048).toFixed(0)} ft: ${open ? 'a window' : 'no window'}`);
  }
});

test('close shots aren\'t timed, so they get no meter; smothered jumpers show no window', () => {
  const { g, p } = jumperGame(3, 1.2, 0);
  g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true }); g.step(1 / 60);
  assert.equal(p.action?.kind, 'close');
  assert.equal(live(g, p), null);
  const sm = jumperGame(5, 5, 0.6);
  sm.g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true }); sm.g.step(1 / 60);
  for (let i = 0; i < 25; i++) { sm.g.setInput({ mx: 0, mz: 0, shootHeld: true }); sm.g.step(1 / 60); }
  const m = live(sm.g, sm.p);
  assert.equal(m.smothered, true); assert.equal(m.half, 0); assert.equal(inGreen(m), false);
});

// a layup from `lstyle`, with a defender at the rim or not, let go `k` frames after the gather starts
function layupAt(lstyle, def, k) {
  const rng = new RNG(9), team = makeTeam(rng, 2, { catalog, level: 0.75 });
  const me = team[0]; me.human = true;
  me.build.equipment = { ...me.build.equipment, layup: 'layup_' + lstyle };
  const g = new Game({ mode: 'practice', seed: 9, rosters: def ? [[me], [team[1]]] : [[me], []], catalog });
  const p = g.players[0], rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x, rim.z - side * 3.4, side > 0 ? 0 : Math.PI); p.vz = side * 4; g.giveBall(p, 'dribble');
  if (def) g.players[1].setPos(rim.x + 0.4, rim.z - side * 0.9, side > 0 ? Math.PI : 0);
  g.setInput({ mx: 0, mz: side * 0.5, shootHeld: true });
  const a = g.startLayup(p, rim, {});
  let shown = null, ev = null;
  for (let i = 0; i < 120 && !ev; i++) {
    if (i === k) shown = live(g, p);
    g.setInput({ mx: 0, mz: side * 0.5, shootHeld: i < k });
    g.step(1 / 60);
    ev = g.events.find(e => e.type === 'release');
  }
  return { shown, ev, a };
}

test('layups too: the meter\'s window is the graded window, frame for frame, and it\'s outlined', () => {
  let checked = 0, greens = 0;
  for (const lstyle of ['basic', 'euro', 'finger', 'scoop']) for (const def of [false, true]) {
    for (let k = 4; k <= 50; k++) {
      const r = layupAt(lstyle, def, k);
      if (!r.shown || !r.ev || r.ev.grade === 'none') continue;
      checked++;
      assert.equal(r.ev.grade === 'excellent', inGreen(r.shown), `${lstyle}${def ? ' vs a rim protector' : ''}, frame ${k}: fill ${r.shown.fill.toFixed(3)} vs ±${r.shown.half.toFixed(3)} → ${r.ev.grade}`);
      assert.equal(r.shown.sure, false);
      if (r.ev.grade === 'excellent') greens++;
    }
  }
  assert.ok(checked > 100 && greens > 8, `${checked} layups checked, ${greens} greens`);
});

test('the window is drawn green in the middle and fades out to yellow over the boosts', () => {
  const C = METER_COLORS;
  assert.equal(meterGradient(0.9, 0.2, 0.1, 0.1), C.core, 'no boosts: solid green');
  const gr = meterGradient(0.88, 0.24, 0.06, 0.12);
  assert.ok(gr.startsWith(`linear-gradient(0deg, ${C.edge} 0%`) && gr.endsWith(`${C.edge} 100%)`), 'yellow at the outer edges');
  // the core sits exactly on the natural window: from (1 - nat) to (1 + nat)
  assert.ok(gr.includes(`${C.core} calc(25% + 1px)`) && gr.includes(`${C.core} calc(75% - 1px)`), gr);
});
