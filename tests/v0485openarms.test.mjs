// v0.4.8.5 Open Arms (the Stretch Big Icon badge): "+3% to every shooting and defense attribute (can pass 99). Unlocks
// exclusive ultra-flashy rebound snags." The +3% on exactly those eight, everywhere they're read and past 99; the badge
// reaching the player in every mode; every board a holder comes down with off a shot snagged (on the floor, in the air,
// out of a block jump, the AI too), the Rebound Package's six varied and the same on every screen; nobody else snags;
// the poses, the preview, the catalog item and where it shows.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam, makeBot } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT } from '../client/js/sim/constants.js';
import { Player, blankIntent, toWorld } from '../client/js/sim/player.js';
import { effectiveRatings, ICON_BADGES, STAT_BADGES } from '../client/js/sim/badges.js';
import { ATTR_GROUPS, ATTRS, boostedBuild, rk } from '../client/js/sim/ratings.js';
import * as S from '../client/js/sim/shots.js';
import { postResist } from '../client/js/sim/post.js';
import * as SN from '../client/js/sim/snags.js';
import { inStore, forBuild } from '../client/js/sim/builds.js';
import { PreviewSim } from '../client/js/game/preview.js';
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const tick = (g, it = {}) => { g.setInput({ ...blankIntent(), ...it }); g.step(DT); return g.events; };
const EIGHT = [...ATTR_GROUPS.Shooting, ...ATTR_GROUPS.Defense];
const PKG = SN.OA_REB_PKG;

// a half-court park game, live; mod(entries of team 0) makes the holder
function game(mod, seed = 9) {
  const r = new RNG(seed), a = makeTeam(r, 2, { catalog, level: 0.7 }), b = makeTeam(r, 2, { catalog, level: 0.7 });
  a[0].human = true; mod(a);
  const g = new Game({ mode: 'park', seed: 3, rosters: [a, b], catalog, target: 99 });
  for (let i = 0; i < 600 && g.phase !== 'live'; i++) tick(g);
  return g;
}
const holderEntry = (e, pkg = false) => { e.build.archetype = 'stretch_big'; e.build.icon_badge = 'open_arms'; e.build.equipment = { ...e.build.equipment }; if (pkg) e.build.equipment.rebound = PKG; else delete e.build.equipment.rebound; };
// a miss off the rim to p, alone under it: dropping to his waist (a floor grab), or high (he goes up for it: a rebound
// jump, or a jump that started as a block); the shooting team is the other one unless offense. Returns what happened
function board(g, p, { high = false, block = false, offense = false, aiJump = false } = {}) {
  const shooting = offense ? p.team : 1 - p.team, rim = g.rimFor(shooting), sd = g.sideFor(shooting), Bl = g.ball;
  const away = () => { for (const q of g.players) if (q !== p) { q.setPos(q.team ? -5 : 5, rim.z - sd * 7, 0); q.vx = q.vz = 0; q.action = null; } };
  away(); p.action = null; p.setPos(rim.x + 0.35, rim.z - sd * 1.7, 0); p.facing = Math.atan2(rim.x - p.x, rim.z - p.z);
  g.changePossessionTo(g.teams[shooting][0]); g.needsClear = [false, false]; Bl.holder = -1;
  const info = { shooter: g.teams[shooting][0].id, team: shooting, made: false, grade: 'late', three: false, type: 'jumper', missed: true };
  if (high) Bl.setFlight(rim.x + 0.1, 3.15, rim.z - sd * 0.25, 0.25, 2.6, -sd * 1.9, 'shot', info);
  else Bl.setFlight(rim.x + 0.3, 1.6, rim.z - sd * 1.15, 0, -0.5, -sd * 0.6, 'shot', info);
  Bl.flightTime = 1.2; Bl.touchedRim = true;
  const out = { evs: [], jumpType: null, preIcon: null, snag: null, airAtCatch: null, ballTrack: [] };
  let jumped = false;
  for (let i = 0; i < 240 && Bl.holder < 0; i++) {
    away();
    if (high && !jumped && !aiJump && Bl.mode === 'flight' && !p.airborne) {
      const tUp = Math.sqrt(2 * p.phys.vertical * 0.8 / 9.81), yAt = Bl.y + Bl.vy * tUp - 4.905 * tUp * tUp, d = Math.hypot(Bl.x - p.x, Bl.z - p.z);
      if (d < 1.4 && Bl.vy < 1 && yAt < p.phys.reach + p.phys.vertical * 0.8 + 0.25 && yAt > p.phys.reach - 0.15) {
        jumped = true;
        if (block) { const h = p.phys.vertical * 0.95, air = 2 * Math.sqrt(2 * h / 9.81); p.startAction('block', air + 0.2, { jumpAt: 0.06, jumpH: h, jumped: false, air, bstyle: 'reach', lead: 'L' }); }
        else g.startJump(p);
        out.jumpType = p.action?.type; out.preIcon = p.action?.icon ?? null;
      }
    }
    out.evs.push(...tick(g));
  }
  out.holder = Bl.holder; out.snag = p.action?.type === 'snag' ? p.action : null; out.airAtCatch = p.action?.air ?? null;
  return out;
}
// run a snag to its end: the ball always his, carried smoothly (m per tick, his own motion taken out)
function playOut(g, p, it = {}) {
  let maxStep = 0, prev = null, n = 0;
  while (p.action?.type === 'snag' && n < 400) {
    const Bl = g.ball, loc = [Bl.x - p.x, Bl.y - p.y, Bl.z - p.z];
    if (prev) maxStep = Math.max(maxStep, Math.hypot(loc[0] - prev[0], loc[1] - prev[1], loc[2] - prev[2]));
    prev = loc;
    assert.equal(Bl.holder, p.id, 'the ball never leaves his hands');
    for (const q of g.players) if (q !== p) { q.setPos(q.team ? -5 : 5, -6, 0); q.action = null; }
    tick(g, it); n++;
  }
  return { ticks: n, maxStep };
}

test('Open Arms: +3% on exactly the eight shooting and defense attributes, and they pass 99', () => {
  const oa = ICON_BADGES.open_arms;
  assert.equal(oa.archetype, 'stretch_big');
  assert.deepEqual(Object.keys(oa.stats).sort(), [...EIGHT].sort(), 'Shooting: Close Shot, Mid-Range, Three-Point, Free Throw; Defense: Perimeter D, Interior D, Steal, Block');
  assert.ok(Object.values(oa.stats).every(v => v === 0.03) && !oa.all);
  // a 99 everywhere with a badge behind every stat (no 10% no-badge drop): exactly 99 × 1.03 on the eight, 99 elsewhere
  const raw = Object.fromEntries(ATTRS.map(k => [k, 99])), all = Object.fromEntries([...new Set(Object.values(STAT_BADGES).flat())].map(k => [k, 4]));
  const on = effectiveRatings(raw, all, 'open_arms'), off = effectiveRatings(raw, all, null);
  for (const k of ATTRS) {
    if (EIGHT.includes(k)) { assert.ok(Math.abs(on[k] - 101.97) < 1e-9, `${k}: ${on[k]}`); assert.ok(on[k] > 99); }
    else assert.equal(on[k], off[k], `${k} untouched`);
  }
  // the same on a real player (badges capped by the build, the no-badge drop where it applies): the ratio is 1.03 exactly
  const bot = makeBot(new RNG(21), { catalog, level: 0.95, position: 'C', archetype: 'stretch_big' });
  const p1 = new Player(0, 0, { ...bot, build: { ...bot.build, icon_badge: 'open_arms' } }, catalog), p0 = new Player(1, 0, bot, catalog);
  assert.equal(p1.icon, 'open_arms'); assert.equal(p0.icon, null);
  for (const k of ATTRS) {
    if (EIGHT.includes(k)) assert.ok(Math.abs(p1.ratings[k] / p0.ratings[k] - 1.03) < 1e-12, k);
    else assert.equal(p1.ratings[k], p0.ratings[k], k);
  }
  // and with a takeover on (refreshRatings keeps the Icon)
  p1.takeover.active = true; p1.takeover.kind = 'shooting'; p1.refreshRatings();
  assert.ok(Math.abs(p1.ratings.three_point - (p0.ratings.three_point * 1.03 + 6)) < 1e-9);
  // past 99 it keeps paying off wherever the eight are read: the rating curve, green windows (jumpers, free throws),
  // make chance, contests (perimeter and paint), post defense (it used to stop at 99 there), steals, blocks
  const v = 101.97;
  assert.ok(rk(v) > rk(99));
  assert.ok(S.greenWindowMs(v, {}, { three: true, d: 7.5 }) > S.greenWindowMs(99, {}, { three: true, d: 7.5 }));
  assert.ok(S.greenWindowMs(v, {}, { ft: true }) > S.greenWindowMs(99, {}, { ft: true }));
  assert.ok(S.baseChance('close', 1.2, { close_shot: v }) > S.baseChance('close', 1.2, { close_shot: 99 }));
  const dfn = r => ({ ratings: r, badges: {} });
  for (const pw of [0, 1]) assert.ok(S.defSkill(dfn({ perimeter_d: v, interior_d: v, block: v }), pw) > S.defSkill(dfn({ perimeter_d: 99, interior_d: 99, block: 99 }), pw), `defSkill pw ${pw}`);
  assert.ok(postResist({ ratings: { interior_d: v }, phys: { strength: 0.6 } }) > postResist({ ratings: { interior_d: 99 }, phys: { strength: 0.6 } }), 'post defense past 99');
  // in a game: his windows are bigger than the same build's without it
  const r = new RNG(4), t = makeTeam(r, 1, { catalog, level: 0.9 }), o = makeTeam(r, 1, { catalog, level: 0.9 });
  t[0].human = true; t[0].build.archetype = 'stretch_big';
  const mk = icon => new Game({ mode: 'park', seed: 3, rosters: [[{ ...t[0], build: { ...t[0].build, icon_badge: icon } }], o], catalog, target: 11 });
  const [g0, g1] = [mk(null), mk('open_arms')], a = { startX: 0, startZ: 6, moving: 0 };
  assert.ok(g1.jumperWindow(g1.players[0], a, 0.3).total > g0.jumperWindow(g0.players[0], a, 0.3).total);
  assert.ok(g1.ftWindow(g1.players[0]).total > g0.ftWindow(g0.players[0]).total);
});

test('Open Arms reaches the player in every mode: park, event parks, Pro-Am, the Pro Run, online, Crew HQ, and an AI holder', () => {
  const bot = makeBot(new RNG(8), { catalog, level: 0.9, position: 'PF', archetype: 'stretch_big' });
  const char = { ...bot.build, name: 'Stretchy', icon_badge: 'open_arms', equipment: { ...bot.build.equipment, rebound: PKG }, boosts: { shooting: 2 } };
  char.attributes = { ...char.attributes, three_point: 97 };
  const entries = {
    // park / event parks (game/park.js) and the Pro Run (ui/prorun.js): boostedBuild(char, the ticket's boosts)
    park: { build: boostedBuild(char, ['shooting', 'defense']), name: char.name, human: true },
    // Pro-Am, practice (ui/modes.js) and Crew HQ (game/crewhq.js): the whole character
    proam: { build: { ...char }, name: char.name, human: true },
    // online: your entry goes out as JSON and every screen builds the game from it (the hub relays it as is)
    online: JSON.parse(JSON.stringify({ build: boostedBuild(char, ['shooting']), name: char.name, look: null, badges: {}, human: true, username: 'x' })),
    // an AI holder: the Icon comes with his entry (not his build)
    ai: { ...bot, icon: 'open_arms' },
  };
  for (const [mode, e] of Object.entries(entries)) {
    const p = new Player(0, 0, e, catalog), twin = new Player(1, 0, { ...e, icon: null, build: { ...e.build, icon_badge: null } }, catalog);
    assert.equal(p.icon, 'open_arms', mode); assert.equal(twin.icon, null);
    for (const k of EIGHT) assert.ok(Math.abs(p.ratings[k] / twin.ratings[k] - 1.03) < 1e-12, `${mode}: +3% ${k}`);
  }
  // a boost caps the build at 99, and the Icon still takes it past (the boost is to the build, the Icon to the play)
  const pk = new Player(0, 0, entries.park, catalog);
  assert.equal(pk.raw.three_point, 99);
  assert.equal(pk.reboundPkg, PKG, 'his package comes along');
  assert.equal(new Player(0, 0, entries.online, catalog).reboundPkg, PKG, 'and online, on every screen');
  assert.equal(new Player(0, 0, entries.ai, catalog).reboundPkg, null, 'the AI never wears it');
  // (the modes build your entry from the whole character; the online setup copies an AI player's own Icon)
  assert.match(src('client/js/ui/prorun.js'), /build: boostedBuild\(c, ticket\.meta\.boosts\)/);
  assert.match(src('client/js/ui/online.js'), /build: boostedBuild\(c, boosts\)/);
  assert.match(src('client/js/ui/online.js'), /for \(const k of \['iq', 'number', 'icon', 'level'\]\)/);
  assert.match(src('client/js/ui/modes.js'), /build: \{ \.\.\.c \}/);
  assert.match(src('client/js/game/park.js'), /boostedBuild\(app\.char\(\), ticket\.meta\.boosts\)/);
  assert.match(src('client/js/game/crewhq.js'), /build: \{ \.\.\.(app\.char\(\)|char) \}/);
});

test('every board a holder comes down with is snagged: on the floor, in the air, out of a block jump, offense or defense, and the AI too', () => {
  // on the floor (a defensive board)
  let g = game(a => holderEntry(a[0], true)), p = g.players[0];
  let r = board(g, p);
  assert.equal(r.holder, p.id); assert.ok(r.snag, 'a floor grab is a snag'); assert.equal(r.snag.air, false);
  assert.ok(r.evs.some(e => e.type === 'snag' && e.player === p.id && e.style === r.snag.style));
  assert.ok(r.evs.some(e => e.type === 'rebound' && e.player === p.id), 'still a rebound in the box score');
  assert.ok(SN.SNAG_PKG_BY_ID[PKG].styles.includes(r.snag.style));
  let o = playOut(g, p);
  assert.ok(o.ticks > 20 && o.ticks < 70, `floor snag ${o.ticks} ticks`);
  assert.ok(o.maxStep < 0.45, `the ball carried smoothly in his hands (${o.maxStep.toFixed(2)} m a tick at most)`);
  // in the air, off a rebound jump (it starts with the Open Arms reach) and an offensive board
  g = game(a => holderEntry(a[0], true)); p = g.players[0];
  r = board(g, p, { high: true, offense: true });
  assert.equal(r.jumpType, 'rebound'); assert.equal(r.preIcon, 'openarms', 'the arms go up wide open');
  assert.ok(r.snag && r.snag.air, 'snagged in the air'); assert.equal(r.snag.landAt, null);
  assert.ok(r.evs.some(e => e.type === 'rebound' && e.offensive));
  o = playOut(g, p);
  assert.ok(r.snag.landAt > 0, 'the gesture waits for the landing');
  assert.ok(o.maxStep < 0.45, `smooth (${o.maxStep.toFixed(2)})`);
  // a jump that started as a block
  g = game(a => holderEntry(a[0], true)); p = g.players[0];
  r = board(g, p, { high: true, block: true });
  assert.equal(r.jumpType, 'block'); assert.ok(r.snag && r.snag.air, 'a block jump that comes down with the board snags it');
  // the AI: a holder the AI plays (his Icon on his entry), jumping or not as it likes
  g = game(a => { a[1].icon = 'open_arms'; a[1].build.archetype = 'stretch_big'; }); p = g.players[1];
  assert.equal(p.human, false); assert.equal(p.icon, 'open_arms');
  for (const high of [false, true]) {
    r = board(g, p, { high, aiJump: true });
    assert.equal(r.holder, p.id); assert.ok(r.snag, `the AI holder snags it (${high ? 'high' : 'low'})`); assert.equal(r.snag.style, SN.OA_BASIC, 'with the basic snag: the AI never wears the package');
    playOut(g, p);
  }
  // the basic Open Arms Rip for a holder with nothing in the slot
  g = game(a => holderEntry(a[0], false)); p = g.players[0];
  assert.equal(p.reboundPkg, null);
  r = board(g, p); assert.equal(r.snag?.style, SN.OA_BASIC);
});

test('nobody else snags: no badge, another Icon badge, or the package worn without the badge', () => {
  const cases = {
    none: a => { a[0].build.equipment = { ...a[0].build.equipment }; },
    bigBrother: a => { a[0].build.icon_badge = 'big_brother'; a[0].build.equipment = { ...a[0].build.equipment, rebound: PKG }; },
    pkgOnly: a => { a[0].build.equipment = { ...a[0].build.equipment, rebound: PKG }; },
  };
  for (const [k, mod] of Object.entries(cases)) {
    const g = game(mod), p = g.players[0];
    assert.equal(p.reboundPkg, null, `${k}: the package only plays for its Icon`);
    assert.equal(SN.snagPool(p), null);
    for (const high of [false, true]) {
      const r = board(g, p, { high });
      assert.equal(r.holder, p.id);
      assert.equal(r.snag, null, `${k}: no snag`);
      assert.ok(!r.evs.some(e => e.type === 'snag'));
      for (let i = 0; i < 90; i++) tick(g);
    }
  }
});

test('the Rebound Package: a different snag every board, all six, and the same on every screen for the same seed', () => {
  const run = seed => {
    const g = game(a => holderEntry(a[0], true), seed), p = g.players[0], seq = [];
    for (let i = 0; i < 36; i++) { const r = board(g, p, { high: i % 3 === 0 }); assert.ok(r.snag, `board ${i}`); seq.push(r.snag.style); playOut(g, p); }
    return seq;
  };
  const a = run(9), b = run(9);
  assert.deepEqual(a, b, 'deterministic for a seed (the game\'s RNG: online, every screen picks the same)');
  for (let i = 1; i < a.length; i++) assert.notEqual(a[i], a[i - 1], 'never the same twice running');
  assert.deepEqual([...new Set(a)].sort(), [...SN.SNAG_PKG_BY_ID[PKG].styles].sort(), `all six show up: ${a.join(' ')}`);
  // and the whole game state with it (online's desync check)
  const h = seed => { const g = game(a2 => holderEntry(a2[0], true), seed), p = g.players[0], out = []; for (let i = 0; i < 4; i++) { board(g, p, { high: i % 2 === 1 }); while (p.action?.type === 'snag') { tick(g); out.push(g.stateHash()); } } return out; };
  assert.deepEqual(h(5), h(5));
});

test('the gesture never costs a play: at most half a second, and moving, dribbling, passing or shooting cuts it short once he is down', () => {
  for (const s of SN.SNAG_STYLES) { assert.ok(s.gest <= 0.5, `${s.id} gesture ${s.gest}s`); assert.ok(s.rip <= 0.42); }
  for (const cut of [{ mx: 1, mz: 0 }, { pass: { target: 1, type: 'chest' } }, { shoot: 'press' }, { jump: true }]) {
    const g = game(a => holderEntry(a[0], true)), p = g.players[0];
    const r = board(g, p); assert.ok(r.snag);
    const a = p.action, T = () => SN.snagTimes(a);
    // still securing it: nothing cuts it
    p.intent = { ...blankIntent(), ...cut }; g.applyIntent(p, DT);
    assert.ok(a.t < T().cutAt); assert.equal(p.action, a, 'not before the ball is secured');
    while (p.action === a && a.t < T().cutAt) tick(g);
    // standing there, the gesture plays; wanting to go, it's over (and the play goes the same tick)
    p.intent = blankIntent(); g.applyIntent(p, DT); assert.equal(p.action, a, 'standing still, it plays');
    p.intent = { ...blankIntent(), ...cut }; g.applyIntent(p, DT);
    assert.notEqual(p.action, a, `cut by ${Object.keys(cut)[0]}`);
  }
  // left alone, the whole floor snag is over in well under a second
  const g = game(a => holderEntry(a[0], true)), p = g.players[0];
  board(g, p);
  const { ticks } = playOut(g, p);
  assert.ok(ticks * DT < 0.95, `${(ticks * DT).toFixed(2)} s`);
});

test('every snag on the rig: finite, the ball in his hands, feet never under the floor, in the air and on the floor', () => {
  for (const ground of [false, true]) for (const st of SN.SNAG_STYLES) for (const hand of ['R', 'L']) {
    const build = { height: hand === 'R' ? 84 : 80, weight: 235, wingspan: hand === 'R' ? 88 : 82, hand, archetype: 'stretch_big', icon_badge: 'open_arms', attributes: {}, equipment: { rebound: PKG } };
    const sim = new PreviewSim(); sim.setPlayer(build, catalog); sim.setPreview('rebound', { styles: [st.id], ground });
    const model = new AthleteModel(build, {}, 0.5), rig = new Rig(model);
    const view = { H: model.d.H, model, rig, y: 0, yaw: 0, update(pose, x, y, z, yaw) { rig.solve(pose, arguments[5]); this.x = x; this.y = y; this.z = z; this.yaw = yaw; } };
    const anim = new Animator(view);
    const toW = q => { const c = Math.cos(view.yaw), s = Math.sin(view.yaw); return [view.x + q[2] * s + q[0] * c, view.y + q[1], view.z + q[2] * c - q[0] * s]; };
    let bad = 0, low = 0, far = 0, frames = 0, sawGesture = false, spun = 0;
    for (let i = 0; i < 170; i++) {
      const out = sim.step(1 / 60, 0.4), p = sim.player;
      anim.update(1 / 60, { x: 0, y: p.y + 0.12, z: 0, facing: p.facing }, p, null, out.ball, { hasBall: out.hasBall, ballMode: out.ballMode, floorY: 0.12 });
      for (const bn of ['hips', 'head', 'handL', 'handR', 'footL', 'footR']) for (const c of rig.pos[B[bn]]) if (!Number.isFinite(c)) bad++;
      const fl = toW(rig.pos[B.footL]), fr = toW(rig.pos[B.footR]);
      if (Math.min(fl[1], fr[1]) < 0.12 - 0.04) low++;
      const a = p.action;
      if (a?.type === 'snag' && out.hasBall && a.t > SN.SNAG.grab) {
        frames++; const F = anim.snag, b = out.ball;
        const d = side => { const h = toW(rig.pos[B['hand' + side]]); return Math.hypot(h[0] - b.x, h[1] - b.y, h[2] - b.z); };
        const m = F.grip > 0.9 ? Math.max(d('L'), d('R')) : d(F.hand);
        if (m > 0.36) far++;
        if (F.g > 0) sawGesture = true;
        spun = Math.max(spun, Math.abs(SN.snagSpin(a)));
      }
    }
    const tag = `${st.id} ${ground ? 'floor' : 'air'} ${hand}`;
    assert.equal(bad, 0, `${tag}: finite`);
    assert.equal(low, 0, `${tag}: feet above the floor`);
    assert.ok(frames > 20, `${tag}: snagged (${frames} frames)`);
    assert.equal(far, 0, `${tag}: the ball stays in his hand(s)`);
    assert.ok(sawGesture, `${tag}: and the landing gesture`);
    if (st.id === 'rip_360') assert.ok(Math.abs(spun - 2 * Math.PI) < 1e-6, 'all the way round');
  }
});

test('the preview: the package\'s six in turn (or the basic Rip), each a snag with the ball in his hands', () => {
  const build = { height: 83, weight: 240, wingspan: 87, hand: 'R', archetype: 'stretch_big', icon_badge: 'open_arms', attributes: {}, equipment: { rebound: PKG } };
  for (const ground of [false, true]) {
    const sim = new PreviewSim(); sim.setPlayer(build, catalog); sim.setPreview('rebound', { styles: catalog[PKG].styles, ground });
    const seen = []; let held = 0, reach = false;
    for (let i = 0; i < 60 * 18; i++) {
      const out = sim.step(1 / 60, 0), a = sim.player.action;
      if (a?.type === 'snag' && seen[seen.length - 1] !== a.style) seen.push(a.style);
      if (a?.type === 'snag') { assert.ok(out.hasBall && out.ball, 'held'); held++; }
      if (a?.type === 'rebound' && a.icon === 'openarms') reach = true;
    }
    assert.deepEqual(seen.slice(0, 6), catalog[PKG].styles, `all six in order (${ground ? 'floor' : 'air'})`);
    assert.ok(held > 200);
    assert.equal(reach, !ground, 'the Open Arms reach on the way up');
  }
  const sim = new PreviewSim(); sim.setPlayer({ ...build, equipment: {} }, catalog); sim.setPreview('rebound');
  let style = null; for (let i = 0; i < 120 && !style; i++) { sim.step(1 / 60, 0); style = sim.player.action?.type === 'snag' ? sim.player.action.style : null; }
  assert.equal(style, SN.OA_BASIC);
});

test('the Rebound Package item: the holder\'s alone, never in the store, a category and a MyPlayer row only for him, never on the AI', () => {
  assert.deepEqual(SN.snagPackageItems(), [catalog[PKG]], 'server/catalog.json carries exactly the table\'s entry');
  const it = catalog[PKG];
  assert.equal(it.slot, 'rebound'); assert.equal(it.exclusive, 'icon'); assert.equal(it.icon, 'open_arms'); assert.equal(it.secret, true); assert.equal(it.price, 0);
  assert.equal(it.styles.length, 6);
  for (const s of it.styles) assert.ok(SN.SNAG_BY_ID[s] && s !== SN.OA_BASIC);
  assert.equal(new Set(SN.SNAG_STYLES.map(s => s.id)).size, 7, 'six snags and the basic one, all different');
  assert.equal(inStore(it), false);
  assert.equal(forBuild(it, { icon_badge: 'open_arms' }), true);
  for (const ic of [null, 'big_brother', 'sharp_eye']) assert.equal(forBuild(it, { icon_badge: ic }), false);
  // the AI never wears it (its gear skips every exclusive item; it has no rebound slot of its own)
  const r = new RNG(77);
  for (let i = 0; i < 200; i++) { const b = makeBot(r, { catalog, level: 1, rep: 20, flash: 1, position: 'C', archetype: 'stretch_big' }); assert.equal(b.build.equipment.rebound, undefined); }
  // the screens: a Rebounds category under Animations named for Open Arms (the store never shows it; the Inventory only
  // for the holder), the store's preview and swatch, and a MyPlayer row for him alone
  const store = src('client/js/ui/store.js'), inv = src('client/js/ui/inventory.js'), mp = src('client/js/ui/myplayer.js');
  assert.ok(store.includes("['rebound', 'Rebounds', 'wide', 'Animations', 'open_arms']"));
  assert.ok(store.includes('export const catsFor = (build = null) => CATS.filter(x => !x[4] || (!!build && build.icon_badge === x[4]));'));
  assert.ok(store.includes('if (!catShown(cat)) cat = \'top\';'), 'the store falls back off it');
  assert.ok(store.includes("app.showroom.setPreview('rebound', { styles: item.styles })"));
  assert.ok(inv.includes('catTabs(cat, count, c)') && inv.includes('if (!catShown(cat, c)) cat = \'top\';'));
  assert.ok(mp.includes("['rebound', 'Rebound package', 'rebound', 'open_arms']") && mp.includes('.filter(([, , , icon]) => !icon || c.icon_badge === icon)'));
  assert.ok(mp.includes("kind === 'rebound' ? (rb?.styles || [OA_BASIC])"));
});
