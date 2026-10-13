// v0.4.8 quick patch 2 (Oct 13): take it back (half-court games), and the Sharp Eye Icon badge: its 5% everywhere, its
// own jumpshot base and release for the holder alone, and the backflip after a green.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FLIP, SHOT_PATH } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT, GRAVITY } from '../client/js/sim/constants.js';
import { blankIntent } from '../client/js/sim/player.js';
import * as S from '../client/js/sim/shots.js';
import { ICON_BADGES } from '../client/js/sim/badges.js';
import { flipAngle, flipAir } from '../client/js/char/animator.js';
import { placeFlipped } from '../client/js/char/view.js';
import { inStore, forBuild } from '../client/js/sim/builds.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const tick = (g, it = {}) => { g.setInput({ ...blankIntent(), ...it }); g.step(DT); return g.events; };

// a half-court park game (1v1 or 2v2, as at the park's annex courts), live, the human on team 0
function halfCourt(n, seed = 9, opts = {}) {
  const r = new RNG(seed), a = makeTeam(r, n, { catalog, level: 0.6 }), b = makeTeam(r, n, { catalog, level: 0.6 });
  a[0].human = true;
  const g = new Game({ mode: 'park', seed: 3, rosters: [a, b], catalog, target: 21, ...opts });
  for (let i = 0; i < 600 && g.phase !== 'live'; i++) tick(g);
  return g;
}
// a missed shot by team `shooting` coming off the rim to `catcher`, alone under it (everyone else kept well away)
function missTo(g, shooting, catcher) {
  const rim = g.rimFor(shooting), away = () => { for (const p of g.players) if (p !== catcher) { p.setPos(p.team ? -5 : 5, rim.z - 6, 0); p.vx = p.vz = 0; } };
  catcher.setPos(rim.x, rim.z - 1.2, 0);
  g.changePossessionTo(g.teams[shooting][0]); g.needsClear = [false, false];
  const B = g.ball; B.holder = -1;
  B.setFlight(rim.x, 2.0, rim.z - 1.1, 0, 0.5, -0.2, 'shot', { shooter: g.teams[shooting][0].id, team: shooting, made: false, grade: 'late', three: false, type: 'jumper' });
  B.flightTime = 1.2;
  const evs = [];
  for (let i = 0; i < 200 && B.holder < 0; i++) { away(); evs.push(...tick(g)); }
  return evs;
}

test('take it back: a defensive rebound, a pick-off or a loose ball the defense comes up with lights the arc (1v1 and 2v2); an offensive board doesn\'t', () => {
  for (const n of [1, 2]) {
    const g = halfCourt(n);
    assert.equal(g.half, true, `${n}v${n} is a half-court game`);
    const evs = missTo(g, 0, g.teams[1][0]);
    assert.equal(g.ball.holder, g.teams[1][0].id);
    assert.deepEqual(g.needsClear, [false, true], `${n}v${n}: the defense has to take it back`);
    assert.ok(evs.some(e => e.type === 'possession' && e.reason === 'rebound' && e.team === 1));
    // an offensive rebound keeps the ball where it is: nothing to clear
    const g2 = halfCourt(n, 11);
    missTo(g2, 0, g2.teams[0][n - 1]);
    assert.deepEqual(g2.needsClear, [false, false], `${n}v${n}: offensive board`);
  }
  // a pass picked off, and a ball the defense picks up loose: the same (catchBall changes hands through the rule)
  const g = halfCourt(2, 5), d = g.teams[1][1];
  g.needsClear = [false, false]; g.possession = 0;
  g.changePossessionTo(d, 'steal'); g.catchBall(d);
  assert.deepEqual(g.needsClear, [false, true]);
  const g3 = halfCourt(2, 6), d3 = g3.teams[1][0];
  g3.needsClear = [false, false]; g3.possession = 0;
  g3.catchBall(d3);
  assert.equal(g3.needsClear[1], true, 'a loose ball the defense comes up with');
  // full-court park games (the 3v3 main courts) have no such rule
  const r = new RNG(2), full = new Game({ mode: 'park', full: true, seed: 3, rosters: [makeTeam(r, 3, { catalog }), makeTeam(r, 3, { catalog })], catalog, target: 21 });
  full.possession = 0; full.catchBall(full.teams[1][0]);
  assert.deepEqual(full.needsClear, [false, false]);
});

test('take it back: no shot, layup, dunk or alley-oop until the ball is behind the arc; a pass still goes; then it\'s on', () => {
  for (const n of [1, 2]) {
    const g = halfCourt(n, 7), me = g.teams[0][0], rim = g.rimFor(0), side = g.sideFor(0);
    g.changePossessionTo(me); g.giveBall(me, 'held'); g.needsClear = [true, false];
    me.setPos(rim.x + 0.5, rim.z - side * 3, 0); me.action = null;
    let evs = tick(g, { shoot: 'press', shootHeld: true, attack: true });
    assert.ok(!me.action || (me.action.type !== 'shoot' && me.action.type !== 'layup' && me.action.type !== 'dunk'), `${n}v${n}: no shot (${me.action?.type})`);
    assert.ok(evs.some(e => e.type === 'mustClear' && e.player === me.id), 'TAKE IT BACK');
    // the call doesn't come every tick
    evs = tick(g, { shoot: 'press', shootHeld: true });
    assert.ok(!evs.some(e => e.type === 'mustClear'));
    // an alley-oop thrown before the clear goes up as a lob
    if (n === 2) {
      const mate = g.teams[0][1]; mate.setPos(rim.x - 1.2, rim.z - side * 2.2, 0);
      for (let i = 0; i < 40 && me.action; i++) tick(g);
      g.giveBall(me, 'held'); me.action = null;
      g.startPass(me, { target: mate.id, type: 'alley' });
      assert.notEqual(g.ball.info?.type, 'alley', 'not an alley-oop before the clear');
      g.giveBall(me, 'held'); me.action = null; mate.action = null;
    }
    // behind the arc: cleared, and the shot goes
    me.action = null; g.giveBall(me, 'held'); me.setPos(rim.x, rim.z - side * 7.9, 0);
    evs = tick(g);
    assert.equal(g.needsClear[0], false, `${n}v${n}: cleared`);
    assert.ok(evs.some(e => e.type === 'cleared'));
    for (let i = 0; i < 30 && me.action; i++) tick(g);
    me.setPos(rim.x, rim.z - side * 4.5, 0); g.giveBall(me, 'held'); me.action = null;
    tick(g, { shoot: 'press', shootHeld: true });
    assert.equal(me.action?.type, 'shoot', `${n}v${n}: now he can shoot`);
  }
  // the HUD: the arc glows for the team that has to clear it, and flares on a shot asked for too soon
  const ses = src('client/js/game/session.js');
  assert.match(ses, /g\.needsClear\[team\] && \(g\.phase === 'live' \|\| g\.phase === 'dead'\)/);
  assert.match(ses, /case 'mustClear': if \(P && P === g\.human\) \{ hud\.callout\('TAKE IT BACK', 'bad'\)/);
});

test('take it back: the AI clears it after every change of hands before it shoots, in 1v1 and 2v2 games played out', () => {
  for (const n of [1, 2]) {
    const r = new RNG(40 + n), a = makeTeam(r, n, { catalog, level: 0.7 }), b = makeTeam(r, n, { catalog, level: 0.7 });
    const g = new Game({ mode: 'park', seed: 17 + n, rosters: [a, b], catalog, target: 11, assist: true });
    let clears = 0, early = 0, shots = 0;
    for (let i = 0; i < 60 * 240 && !g.over; i++) {
      const before = [...g.needsClear], ids = g.players.map(p => p.action?.id);
      g.step(DT);
      for (const e of g.events) if (e.type === 'cleared') clears++;
      // (every shot, layup and dunk started this tick)
      for (const p of g.players) {
        const a = p.action;
        if (!a || a.id === ids[p.id] || !['shoot', 'layup', 'dunk'].includes(a.type) || a.oop) continue;
        shots++; if (before[p.team]) early++;
      }
    }
    assert.ok(clears >= 2, `${n}v${n}: ${clears} take-backs`);
    assert.ok(shots >= 6, `${n}v${n}: ${shots} shots`);
    console.log(`  ${n}v${n}: ${shots} shots, ${clears} take-backs, ${early} before the clear, score ${g.score.join('-')}`);
    assert.equal(early, 0, `${n}v${n}: no shot before the clear`);
  }
});

test('Sharp Eye: 5% more green window on every shot, everywhere: open, contested, on the move, from deep, at the floor, free throws and layups', () => {
  const gk = 1 + ICON_BADGES.sharp_eye.green;
  assert.equal(gk, 1.05);
  const ctxs = [{}, { contest: 0.4 }, { contest: 0.7, three: true, d: 7.5 }, { moving: 4 }, { three: true, d: 9.5 }, { d: 12 }, { fade: true, hustle: 'runfade', moving: 5, contest: 0.6, d: 8.5, three: true }];
  for (const v of [45, 70, 85, 99]) for (const c of ctxs) {
    const a = S.greenWindowMs(v, {}, c), b = S.greenWindowMs(v, {}, { ...c, greenK: gk });
    if (a > 0) assert.ok(Math.abs(b / a - gk) < 1e-9, `${v} ${JSON.stringify(c)}: ${(b / a).toFixed(4)}`);
  }
  assert.ok(Math.abs(S.greenWindowMs(80, {}, { ft: true, greenK: gk }) / S.greenWindowMs(80, {}, { ft: true }) - gk) < 1e-9, 'free throws');
  assert.ok(Math.abs(S.layupWindowMs(80, {}, { greenK: gk }) / S.layupWindowMs(80, {}, {}) - gk) < 1e-9, 'layups');
  assert.equal(S.greenWindowMs(99, {}, { contest: S.SMOTHER, greenK: gk }), 0, '(smothered is still no window at all, whatever adds to it)');
  // in a game: a holder's windows (jumper, layup, free throw) are 5% over the same build without it
  const r = new RNG(4), t = makeTeam(r, 1, { catalog, level: 0.8 }), o = makeTeam(r, 1, { catalog, level: 0.8 });
  t[0].build.archetype = 'sharpshooter'; t[0].human = true;
  const mk = icon => new Game({ mode: 'park', seed: 3, rosters: [[{ ...t[0], icon }], o], catalog, target: 11 });
  const [g0, g1] = [mk(null), mk('sharp_eye')], [p0, p1] = [g0.players[0], g1.players[0]];
  assert.equal(p1.icon, 'sharp_eye');
  const a = { startX: 0, startZ: 6, moving: 0 };
  assert.ok(Math.abs(g1.jumperWindow(p1, a, 0.3).total / g0.jumperWindow(p0, a, 0.3).total - gk) < 1e-9);
  assert.ok(Math.abs(g1.ftWindow(p1).total / g0.ftWindow(p0).total - gk) < 1e-9);
  assert.ok(Math.abs(g1.layupWindow(p1, { lstyle: 'normal' }, 0.2).total / g0.layupWindow(p0, { lstyle: 'normal' }, 0.2).total - gk) < 1e-9);
  // a green that only the 5% made: the Icon badge pops up
  const evs = []; g1.emit = e => evs.push(e);
  const W = g1.jumperWindow(p1, a, 0.3).total;
  g1.sharpEyeSave(p1, 'excellent', (W / 1000) * 0.99, W);
  assert.ok(evs.some(e => e.type === 'badge' && e.badge === 'sharp_eye' && e.icon));
  evs.length = 0; g1.sharpEyeSave(p1, 'excellent', (W / 1000) * 0.5, W);
  assert.equal(evs.length, 0, 'a green that was a green anyway');
});

test('the Sharp Eye package: its own base and release, for the holder only (never in the store, only in that build\'s inventory)', () => {
  const base = catalog.js_base_sharpeye, rel = catalog.release_sharpeye;
  for (const i of [base, rel]) {
    assert.equal(i.exclusive, 'icon'); assert.equal(i.icon, 'sharp_eye'); assert.equal(i.secret, true); assert.equal(i.price, 0);
    assert.equal(inStore(i), false, 'not in the store');
    assert.equal(forBuild(i, { icon_badge: 'sharp_eye' }), true);
    assert.equal(forBuild(i, { icon_badge: 'hash_slinging' }), false, 'another build of the same account doesn\'t see it');
    assert.equal(forBuild(i, { icon_badge: null }), false);
  }
  assert.equal(inStore(catalog.js_base_standard), true);
  assert.deepEqual(S.SHARP_EYE_PKG, { jumpshot: base.id, release: rel.id });
  // the base: the highest jump of them all, the quickest hop, and the ball at the very top
  const bases = list.filter(i => i.slot === 'jumpshot');
  assert.ok(bases.every(b => b === base || b.jump < base.jump), 'higher than any other base');
  const build = icon => ({ icon_badge: icon, equipment: { jumpshot: base.id, release: rel.id } });
  const pk = S.jumpshotPackage(build('sharp_eye'), catalog);
  assert.equal(pk.style, 'sharpeye'); assert.equal(pk.release, 'sharpeye'); assert.equal(pk.jumpK, 1); assert.equal(pk.apexK, 1);
  for (const b of bases) if (b !== base) assert.ok(S.jumpshotPackage({ icon_badge: 'sharp_eye', equipment: { jumpshot: b.id, release: rel.id } }, catalog).tRel >= pk.tRel - 1e-9, `quicker than ${b.id}`);
  assert.ok(SHOT_PATH.sharpeye.line, 'one smooth line up through the set');
  assert.ok(S.BASE_FEEL.sharpeye.speed <= Math.min(...Object.values(S.BASE_FEEL).map(f => f.speed)), 'the quickest feel there is');
  // anyone else who somehow wears it shoots the standard
  const not = S.jumpshotPackage(build(null), catalog);
  assert.equal(not.style, 'standard'); assert.equal(not.release, 'classic');
  // in a game: the jump is the highest, and he lets go right at the top of it
  const r = new RNG(8), me = makeTeam(r, 1, { catalog, level: 0.8 })[0];
  me.build = { ...me.build, archetype: 'sharpshooter', icon_badge: 'sharp_eye', equipment: { ...me.build.equipment, ...S.SHARP_EYE_PKG } }; me.human = true;
  const g = new Game({ mode: 'practice', seed: 3, rosters: [[me], []], catalog }), p = g.players[0], rim = g.rimFor(0);
  p.setPos(rim.x, rim.z - g.sideFor(0) * 5, 0); g.giveBall(p, 'held');
  tick(g, { shoot: 'press', shootHeld: true });
  const a = p.action, tUp = Math.sqrt(2 * a.jumpH / GRAVITY);
  assert.equal(a.type, 'shoot');
  assert.ok(Math.abs(a.takeoff - (a.tRel - tUp)) < 1e-9, 'the release comes at the apex');
  let top = 0;
  for (let i = 0; i < 90; i++) { tick(g, { shootHeld: i < 200 }); top = Math.max(top, p.y); }
  // the same player on another base gets less air
  const me2 = { ...me, build: { ...me.build, equipment: { ...me.build.equipment, jumpshot: 'js_base_dip' } } };
  const g2 = new Game({ mode: 'practice', seed: 3, rosters: [[me2], []], catalog }), p2 = g2.players[0];
  p2.setPos(rim.x, rim.z - g2.sideFor(0) * 5, 0); g2.giveBall(p2, 'held');
  tick(g2, { shoot: 'press', shootHeld: true });
  let top2 = 0;
  for (let i = 0; i < 90; i++) { tick(g2, { shootHeld: true }); top2 = Math.max(top2, p2.y); }
  assert.ok(top > top2 * 1.1, `${top.toFixed(3)} m against ${top2.toFixed(3)} m on the Dip (the highest before)`);
  // an AI Sharp Eye holder shoots the package; a human shoots what he wears
  const ai = makeTeam(new RNG(3), 1, { catalog })[0];
  const gA = new Game({ mode: 'park', seed: 3, rosters: [[{ ...ai, icon: 'sharp_eye' }], makeTeam(new RNG(4), 1, { catalog })], catalog, target: 11 });
  assert.equal(gA.players[0].shotPkg.style, 'sharpeye');
  const anim = src('client/js/char/animator.js');
  for (const f of ['sharpeye: (T, u) =>', 'sharpeye: (T, t, k, relY, sh, sg, gh, H2, G2, F, an) =>', "sharpeye: { k: 0.24"]) assert.ok(anim.includes(f), f);
  assert.doesNotMatch(anim, /a\.icon === 'sharpeye'/, 'the old overlay is gone: the package is the look');
});

test('the Sharp Eye backflip: a green that goes in, for a holder wearing the package, once he\'s down; nobody else', () => {
  const run = (icon, equip, grade = 'excellent', made = true) => {
    const r = new RNG(8), me = makeTeam(r, 1, { catalog, level: 0.8 })[0];
    me.build = { ...me.build, archetype: 'sharpshooter', icon_badge: icon, equipment: { ...me.build.equipment, ...equip } }; me.human = true;
    const o = makeTeam(new RNG(5), 1, { catalog })[0];
    const g = new Game({ mode: 'park', seed: 3, rosters: [[me], [o]], catalog, target: 11 }), p = g.players[0];
    for (let i = 0; i < 600 && g.phase !== 'live'; i++) tick(g);
    g.changePossessionTo(p); g.needsClear = [false, false];
    const rim = g.rimFor(0), B = g.ball; B.holder = -1;
    g.players[1].setPos(-6, rim.z - 8, 0);
    p.setPos(rim.x, rim.z - g.sideFor(0) * 6, 0); p.action = null;
    B.setFlight(rim.x + (made ? 0 : 0.7), rim.y + 0.6, rim.z, 0, -0.5, 0, 'shot', { shooter: p.id, team: 0, made, grade, three: false, type: 'jumper', d: 6 });
    const evs = [];
    let flipT = null, maxA = 0, landed = false;
    for (let i = 0; i < 300; i++) {
      g.players[1].setPos(-6, rim.z - 8, 0);
      evs.push(...tick(g));
      const a = p.action;
      if (a?.type === 'flip') { if (flipT == null) flipT = g.time; maxA = Math.min(maxA, flipAngle(a)); if (a.jumped && !p.airborne) landed = true; }
    }
    return { evs, flipT, maxA, landed, p };
  };
  const yes = run('sharp_eye', S.SHARP_EYE_PKG);
  assert.ok(yes.evs.some(e => e.type === 'score'), 'it went in');
  assert.ok(yes.evs.some(e => e.type === 'backflip'), 'the backflip');
  assert.ok(yes.flipT != null && yes.landed);
  assert.ok(Math.abs(yes.maxA + 2 * Math.PI) < 1e-6, 'all the way round');
  assert.equal(yes.p.action, null, 'and done');
  assert.ok(!run('sharp_eye', { jumpshot: 'js_base_standard', release: 'release_classic' }).evs.some(e => e.type === 'backflip'), 'a holder on another jumper: no');
  assert.ok(!run(null, S.SHARP_EYE_PKG).evs.some(e => e.type === 'backflip'), 'not a holder (wearing it somehow): no');
  assert.ok(!run('sharp_eye', S.SHARP_EYE_PKG, 'late').evs.some(e => e.type === 'backflip'), 'not a green: no');
  assert.ok(!run('sharp_eye', S.SHARP_EYE_PKG, 'excellent', false).evs.some(e => e.type === 'backflip'), 'a green that misses (from deep, it can): no');
  // the turn is finished before he lands (90% of the air time), round his middle
  const a = { jumped: true, takeoff: FLIP.takeoff, h: FLIP.h, t: FLIP.takeoff + flipAir({ h: FLIP.h }) * 0.9 };
  assert.ok(Math.abs(flipAngle(a) + 2 * Math.PI) < 1e-9);
  assert.ok(Math.abs(flipAngle({ ...a, t: FLIP.takeoff })) < 1e-12);
  const o = new Float32Array(16);
  placeFlipped(o, 0, 0, 0, 0, -Math.PI, 1);
  assert.ok(Math.abs(o[13] - 2) < 1e-6 && Math.abs(o[5] + 1) < 1e-6, 'upside down at the halfway point, turning round his middle');
});
