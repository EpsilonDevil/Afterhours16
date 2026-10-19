// v0.4.7.5 quick patch 3 (part 2): post moves (ten Post Move Packages, the post-up on LT / L2), the Event Park hall,
// the perceptual volume sliders, solid green windows on wide-open layups, and playing online with friends (several
// humans in one lockstep game, the input relay, the room setup).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, GAME_SPEED } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT } from '../client/js/sim/constants.js';
import { POST, POST_PACKAGES, POST_PKG_IDS, postPackageItems, postPackageNeed, postPower, beatChance, postShotK, backdownSpeed } from '../client/js/sim/post.js';
import { volumeGain, VOLUME_CURVE } from '../client/js/core/settings.js';
import { PARK_HALL, PARK_HQ, THEMES } from '../client/js/world/themes.js';
import { HALL_SIZE } from '../client/js/world/props.js';
import { Net } from '../client/js/core/netplay.js';
import { inputDelay } from '../client/js/ui/online.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

// ---------------- post moves ----------------
test('ten Post Move Packages in five tiers, in the store as the post slot, Fundamentals on every build', () => {
  assert.equal(POST_PACKAGES.length, 10);
  assert.deepEqual([1, 2, 3, 4, 5].map(t => POST_PACKAGES.filter(p => p.tier === t).length), [2, 2, 2, 2, 2]);
  // the catalog carries exactly the items post.js describes
  const items = postPackageItems(), inCat = list.filter(i => i.slot === 'post');
  assert.deepEqual(inCat, items);
  assert.ok(POST_PKG_IDS.every(id => catalog[id]?.category === 'animation'));
  assert.equal(catalog.post_basic.price, 0);
  assert.ok(POST_PACKAGES.every((p, i) => i === 0 || p.emph >= POST_PACKAGES[i - 1].emph), 'higher tiers bite harder');
  // the slot: default equipment and slot order (block stays last)
  const b = src('server/builds.py');
  assert.match(b, /"post": "post_basic"/);
  assert.match(b, /"post", "block"\)/);
  // the store tab, the inventory row, the preview
  assert.match(src('client/js/ui/store.js'), /Post Moves/);
  assert.match(src('client/js/ui/myplayer.js'), /'post'/);
  assert.match(src('client/js/game/preview.js'), /'post'/);
});

test('a package tier needs less Post Control from the tall and more from the small; Fundamentals is free', () => {
  assert.equal(postPackageNeed(1, 70, 'post_basic'), 0);
  for (let t = 2; t <= 5; t++) {
    const mid = postPackageNeed(t, 79), tall = postPackageNeed(t, POST.tall), short = postPackageNeed(t, POST.short);
    assert.ok(tall <= mid && mid <= short, `tier ${t}: ${tall} ${mid} ${short}`);
  }
  assert.equal(postPackageNeed(5, 79), 90);
  assert.equal(postPackageNeed(4, 84), 65);
});

const poster = (o = {}) => ({ postPkg: o.pkg || 'post_basic', archetype: o.arch || 'post_scorer', heightIn: o.h ?? 82, ratings: { post_control: o.pc ?? 80 }, phys: { strength: o.str ?? 0.6 }, build: { height: o.h ?? 82 } });
const def = { ratings: { interior_d: 72 }, phys: { strength: 0.6 }, badges: {} };

test('post power scales with the package, Post Control, height and archetype, Post Scorers on top', () => {
  const archs = Object.keys(POST.arch);
  const pw = archs.map(a => [a, postPower(poster({ arch: a }))]).sort((x, y) => y[1] - x[1]);
  assert.equal(pw[0][0], 'post_scorer', 'Post Scorers get the most out of the block');
  assert.ok(pw[0][1] > pw[1][1] * 1.2);
  assert.ok(postPower(poster({ pc: 90 })) > postPower(poster({ pc: 70 })));
  assert.ok(postPower(poster({ h: 84 })) > postPower(poster({ h: 76 })));
  assert.ok(postPower(poster({ pkg: 'post_legend' })) > postPower(poster({ pkg: 'post_footwork' })) && postPower(poster({ pkg: 'post_footwork' })) > postPower(poster()));
  // and through to the game: the back-down, a move beating the man, the shot's shield and bonus
  const big = poster({ pkg: 'post_legend', pc: 90, h: 83 }), small = poster({ arch: 'sharpshooter', pc: 60, h: 75 });
  assert.ok(backdownSpeed(big, def) > backdownSpeed(small, def));
  assert.ok(beatChance(big, def, 'dropstep') > 2 * beatChance(small, def, 'dropstep'));
  assert.ok(postShotK(big, 'hook', false).shield > postShotK(small, 'hook', false).shield);
  assert.ok(postShotK(big, 'hook', false).bonus > postShotK(small, 'hook', false).bonus);
});

// a controlled post-up: back down 1.2 s, then a hook out of the post released ±70 ms around the top
function trial(cfg, seed) {
  const rng = new RNG(seed), t = makeTeam(rng, 2, { catalog, level: 0.75 });
  const me = t[0]; me.human = true;
  me.build = { ...me.build, archetype: cfg.arch, height: cfg.h, equipment: { ...me.build.equipment, post: cfg.pkg } };
  me.build.attributes = { ...(me.build.attributes || {}), post_control: cfg.pc, close_shot: cfg.pc - 4, mid_range: 70, strength: 70 };
  const dd = t[1]; dd.build = { ...dd.build, height: 81 }; dd.build.attributes = { ...(dd.build.attributes || {}), interior_d: 72, strength: 70 };
  const g = new Game({ mode: 'practice', seed, rosters: [[me], [dd]], catalog });
  const p = g.players[0], d = g.players[1], rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x + 1.4, rim.z - side * 3.6, side > 0 ? Math.PI : 0); d.setPos(rim.x + 1.3, rim.z - side * 2.6, side > 0 ? Math.PI : 0); g.giveBall(p, 'dribble');
  const ux = rim.x - p.x, uz = rim.z - p.z, L = Math.hypot(ux, uz), d0 = Math.hypot(rim.x - p.x, rim.z - p.z);
  g.ai.think = () => { const tx = p.x + (rim.x - p.x) * 0.35, tz = p.z + (rim.z - p.z) * 0.35; d.intent.mx = (tx - d.x) * 3; d.intent.mz = (tz - d.z) * 3; d.intent.defense = true; d.intent.handsUp = true; };
  let ev = null, posted = false;
  const step = it => { g.setInput({ mx: 0, mz: 0, ...it }); g.step(DT); posted = posted || p.postUp; for (const e of g.events) if (e.type === 'release') ev = e; };
  for (let i = 0; i < 72; i++) step({ post: true, mx: ux / L, mz: uz / L });
  const backed = d0 - Math.hypot(rim.x - p.x, rim.z - p.z);
  step({ post: true, shoot: 'press', shootHeld: true, mx: ux / L, mz: uz / L });
  const a = p.action;
  if (!a || a.type !== 'shoot') return { made: false, posted, backed };
  const relT = a.tRel + ((seed * 7919) % 141 - 70) / 1000;
  for (let i = 0; i < 120 && !ev; i++) step({ post: true, shootHeld: a.t < relT });
  return { made: !!ev?.made, post: ev?.post, posted, backed };
}
const rate = (cfg, n = 40) => { let m = 0, posted = 0, backed = 0, hooks = 0; for (let s = 1; s <= n; s++) { const r = trial(cfg, s * 131 + 7); m += r.made; posted += r.posted; backed += r.backed; hooks += r.post === 'hook'; } return { pct: m / n, posted: posted / n, backed: backed / n, hooks: hooks / n }; };

test('in the game: holding the post-up backs the man down, and a Post Scorer\'s hook beats a shooter\'s by a mile', () => {
  const ps = rate({ arch: 'post_scorer', pc: 88, h: 82, pkg: 'post_legend' });
  const ss = rate({ arch: 'sharpshooter', pc: 60, h: 75, pkg: 'post_basic' });
  const mid = rate({ arch: 'glass_cleaner', pc: 78, h: 82, pkg: 'post_footwork' });
  assert.equal(ps.posted, 1, 'the trigger puts his back to the basket'); assert.equal(ps.hooks, 1, 'stick to the rim: a hook');
  assert.ok(ps.backed > ss.backed + 0.15, `back-down ${ps.backed.toFixed(2)} vs ${ss.backed.toFixed(2)} m`);
  assert.ok(ps.pct > mid.pct && mid.pct > ss.pct, `hooks ${ps.pct} / ${mid.pct} / ${ss.pct}`);
  assert.ok(ps.pct - ss.pct >= 0.2);
});

test('the controls: hold LT / L2 (X or right click) with the ball; the right stick calls the post moves while it\'s held', () => {
  const inp = src('client/js/core/input.js');
  assert.match(inp, /post: \['KeyX', 'Mouse2'\]/);
  assert.match(inp, /post: 'LT'/);
  const ses = src('client/js/game/session.js');
  assert.match(ses, /move = 'dropstep'/); assert.match(ses, /move = 'postspin'/); assert.match(ses, /move = 'upunder'/);
  assert.match(src('client/js/sim/ai.js'), /postPackageOf/, 'the AI posts up too');
});

// ---------------- Event Park hall, volume, wide-open layups ----------------
test('the Event Park hall stands next to the Crew HQ on every park; at an event park it takes you home', () => {
  const dx = PARK_HALL.x - PARK_HQ.x;
  assert.ok(dx > HALL_SIZE.w && dx < 12 && PARK_HALL.z === PARK_HQ.z, 'beside the HQ, not inside it');
  const v = src('client/js/world/venues.js');
  assert.match(v, /theme\.event \? \{ title: 'HOME PARK'/);
  assert.match(v, /PR\.eventHall\(PARK_HALL\.x, PARK_HALL\.z/);
  const m = src('client/js/ui/modes.js');
  assert.match(m, /openHall\(hub\)/); assert.match(m, /enterPark\(app, ev\.id, \{ at: 'hall' \}\)/); assert.match(m, /enterPark\(app, home, \{ at: 'hall' \}\)/);
  assert.ok(Object.values(THEMES).some(t => t.event));
});

test('volume sliders are perceptual: the lowest step before silence is near-silent, full is full', () => {
  assert.equal(volumeGain(0), 0); assert.equal(volumeGain(1), 1);
  assert.ok(VOLUME_CURVE >= 2);
  assert.ok(volumeGain(0.05) < 0.002, 'the first notch is quiet');
  assert.ok(volumeGain(0.25) < 0.05 && volumeGain(0.5) < 0.25 && volumeGain(0.75) > 0.4);
  for (let s = 0.05; s <= 1; s += 0.05) assert.ok(volumeGain(s) > volumeGain(s - 0.05));
  assert.match(src('client/js/core/music.js'), /volumeGain/);
});

test('a wide-open layup gets the solid green window; any coverage keeps it outlined', () => {
  const rng = new RNG(4), t = makeTeam(rng, 1, { catalog, level: 0.7 }), o = makeTeam(rng, 1, { catalog, level: 0.7 });
  t[0].human = true;
  const g = new Game({ mode: 'park', seed: 3, rosters: [t, o], catalog, target: 11 });
  const p = g.players[0], a = { lstyle: 'normal' };
  assert.equal(g.layupWindow(p, a, 0).sure, true);
  assert.equal(g.layupWindow(p, a, 0.35).sure, false);
  assert.ok(g.layupWindow(p, a, 0).total > 0);
});

// ---------------- online play ----------------
function rosters(seed) {
  const r = new RNG(seed);
  const a = makeTeam(r, 3, { catalog, level: 0.7 }), b = makeTeam(r, 3, { catalog, level: 0.7 });
  a[0].human = true; a[1].human = true; b[0].human = true;
  return JSON.parse(JSON.stringify([a, b]));
}
function randomInputs(seed) {
  const ir = new RNG(seed), held = {};
  let seq = 0;
  return id => {
    const it = { mx: ir.range(-1, 1), mz: ir.range(-1, 1), sprint: ir.next() < 0.3, shootHeld: false };
    if (held[id]) { held[id]--; it.shootHeld = true; }
    if (ir.next() < 0.02) { it.shoot = 'press'; it.shootHeld = true; held[id] = 15 + ir.int(0, 30); it.seq = { shoot: ++seq }; }
    if (ir.next() < 0.01) { it.pass = { dir: { x: ir.range(-1, 1), z: 1 }, type: 'chest' }; it.seq = { ...(it.seq || {}), pass: ++seq }; }
    if (ir.next() < 0.01) { it.steal = true; it.seq = { ...(it.seq || {}), steal: ++seq }; }
    if (ir.next() < 0.004) it.callScreen = true;
    return JSON.parse(JSON.stringify(it));
  };
}

test('online: every client simulates the same game from the same inputs, whoever "the user" is on each screen', () => {
  const R = rosters(5), cfg = { mode: 'park', full: true, seed: 99, catalog, target: 21, multi: true, inputDelay: 5 };
  const A = new Game({ ...cfg, rosters: structuredClone(R) }), B = new Game({ ...cfg, rosters: structuredClone(R) });
  A.human = A.players[0]; B.human = B.players[3]; // (each screen's own player: only the UI reads it)
  assert.equal(A.assist, false);
  const humans = A.players.filter(p => p.human).map(p => p.id);
  assert.deepEqual(humans, [0, 1, 3]);
  const inputs = randomInputs(77);
  for (let t = 1; t <= 4000; t++) {
    for (const id of humans) { const it = inputs(id); if (A.players[id].human) A.humanIntents.set(id, it); if (B.players[id].human) B.humanIntents.set(id, structuredClone(it)); }
    if (t === 2000) { A.dropHuman(1); B.dropHuman(1); } // he left: the AI has him from here, on both screens
    A.step(DT); B.step(DT);
    if (t % 50 === 0) assert.equal(A.stateHash(), B.stateHash(), `diverged by tick ${t}`);
  }
  assert.equal(A.players[1].human, false);
  // the people's Lock-In grades come from the game itself (nobody's screen drives a player's stamina)
  assert.ok(humans.every(id => A.aiGrades.has(id)));
});

test('online: a press is used once (its number), the alley-oop and a timed release count from the player\'s screen', () => {
  const R = rosters(9);
  R[1].forEach(e => { e.human = false; });
  R[0][1].human = false;
  const g = new Game({ mode: 'park', seed: 4, rosters: R, catalog, target: 11, multi: true, inputDelay: 6 });
  const p = g.players[0];
  for (let i = 0; i < 400 && g.phase !== 'live'; i++) { g.humanIntents.set(0, {}); g.step(DT); }
  g.giveBall(p, 'dribble');
  // the same shoot press (seq 5) arrives on several ticks: one shot, not a shot then a second one
  let starts = 0;
  for (let i = 0; i < 12; i++) { g.humanIntents.set(0, { shoot: 'press', shootHeld: true, seq: { shoot: 5 } }); const was = p.action?.id; g.step(DT); if (p.action?.type === 'shoot' && p.action.id !== was) starts++; }
  assert.equal(starts, 1);
  assert.equal(p.usedSeq, 5);
  // let go: graded as of `lag` before the tick it lands on
  const a = p.action, t0 = a.t;
  g.humanIntents.set(0, { shootHeld: false }); g.step(DT);
  assert.ok(Math.abs(a.releaseAt - Math.max(0, t0 - 6 * DT)) < 1e-9, `${a.releaseAt} vs ${t0 - 6 * DT}`); // (the intent applies before the action ticks)
  assert.equal(g.relAt({ human: false }, { t: 1 }), 1, 'the AI is never shifted');
  // single-player games are untouched
  const s = new Game({ mode: 'park', seed: 4, rosters: rosters(9), catalog, target: 11 });
  assert.equal(s.multi, false); assert.equal(s.lag, 0); assert.equal(s.relAt(s.players[0], { t: 0.5 }), 0.5);
});

test('online: the input delay covers the two slowest players\' trip through the service, 3 to 15 ticks', () => {
  const tick = 1000 / (60 * GAME_SPEED);
  assert.equal(inputDelay([1, 1]), 3);
  assert.equal(inputDelay([2, 60, 80]), Math.ceil((70 + 25) / tick)); // (v0.4.8: 25 ms to spare)
  assert.equal(inputDelay([900, 900]), 15);
  assert.ok(inputDelay([null, 40]) >= inputDelay([0, 40]), 'an unknown round trip counts as a slow one');
});

test('online: the socket client holds a game\'s inputs until the game takes them, and early ones until their start', () => {
  const n = new Net();
  const got = [];
  n.receive({ t: 'start', setup: { game: 1 } });
  n.receive({ t: 'in', s: 1, k: 4, g: 1, i: { mx: 1 } });
  n.receive({ t: 'in', s: 1, k: 3, g: 2, i: {} }); // (the next game's, before its start)
  n.receive({ t: 'left', slot: 1, last: 4 });
  const off = n.attachGame(1, m => got.push(m));
  assert.deepEqual(got.map(m => m.t + (m.k ?? '')), ['in4', 'left']);
  n.receive({ t: 'in', s: 1, k: 5, g: 1, i: {} });
  assert.equal(got.length, 3);
  off();
  n.receive({ t: 'start', setup: { game: 2 } });
  assert.deepEqual(n.inbox.map(m => m.k), [3]);
  // the round trip is the second best of the last eight (a slow frame doesn't inflate the input delay)
  const now = performance.now();
  for (const ms of [400, 30, 35, 500]) n.receive({ t: 'pong', c: now - ms });
  assert.ok(n.rtt >= 35 && n.rtt < 60, String(n.rtt));
});

test('online: the pieces are wired: the phone tab, the session lockstep, the park and arena games, host.cmd / join.cmd', () => {
  assert.match(src('client/js/ui/phone.js'), /\['online', 'Online'\]/);
  const ses = src('client/js/game/session.js');
  assert.match(ses, /frameOnline\(dt\)/); assert.match(ses, /this\.online\.net\.send\(\{ t: 'in', k: k0, g: this\.online\.game, b \}\)/); // (qp3 perf: a frame's ticks, as changes)
  assert.match(ses, /Waiting for/);
  assert.match(src('client/js/game/park.js'), /async startOnlineGame\(setup, local\)/);
  assert.match(src('client/js/ui/modes.js'), /export async function playProAmOnline/);
  assert.match(src('client/js/main.js'), /initOnline\(app\)/);
  const host = src('host.cmd'), join = src('join.cmd');
  assert.match(host, /--online --port %PORT%/); assert.match(host, /RIMRIFT_JOIN_CODE/); // (v0.4.8.6)
  assert.match(join, /--unsafely-treat-insecure-origin-as-secure/);
  assert.match(src('server/app.py'), /"\/api\/ws"/);
  assert.match(src('server/migrations/009_v0475_online.sql'), /CREATE TABLE online_friends/);
});

test('online from your own copy: the socket goes to the host\'s game, checks the version, signs in with the token', () => {
  const sent = [];
  class FakeWS { constructor(url) { this.url = url; this.readyState = 0; FakeWS.last = this; } send(d) { sent.push(JSON.parse(d)); } close() {} }
  const had = globalThis.WebSocket; globalThis.WebSocket = FakeWS;
  try {
    const n = new Net();
    n.configure({ hub: '203.0.113.7:8765', token: 'tok', build: 'abc123def456' });
    n.start();
    assert.equal(FakeWS.last.url, 'ws://203.0.113.7:8765/api/ws');
    FakeWS.last.readyState = 1; FakeWS.last.onopen();
    assert.deepEqual(sent.slice(0, 2).map(m => m.t), ['hi', 'auth']);
    assert.equal(sent[1].token, 'tok'); assert.equal(sent[1].build, 'abc123def456');
    assert.equal(n.connected, false, 'open is not signed in');
    n.receive({ t: 'authed', token: 'tok2', you: { id: 'x', username: 'me' } });
    n.receive({ t: 'hello', you: { id: 'x', username: 'me' }, friends: [] });
    assert.equal(n.connected, true); assert.equal(n.token, 'tok2');
    n.receive({ t: 'autherror', code: 'version', text: 'update' });
    assert.equal(n.want, false, 'a different version stops trying');
    n.stop();
  } finally { globalThis.WebSocket = had; }
  const s = src('server/app.py');
  assert.match(s, /def compute_build/); assert.match(s, /"\/api\/online-link"/);
  assert.match(src('server/online.py'), /def sign_in/);
  assert.match(src('client/js/ui/online.js'), /function linkForm/);
});
