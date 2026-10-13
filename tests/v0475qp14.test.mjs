// v0.4.7.5 quick patch 3 (online performance): lockstep inputs as changes, a frame's ticks in one message, watchers'
// bundles, inputs that keep going out while the game waits, slow PCs sending further ahead (and the release timing
// allowing for it), the hub's queues (tests/test_online.py), and lighter frames at the park.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, GAME_SPEED } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT } from '../client/js/sim/constants.js';
import { blankIntent } from '../client/js/sim/player.js';
import { normIntent, intentDelta, applyDelta, takeInputs } from '../client/js/sim/wire.js';
import { Net } from '../client/js/core/netplay.js';
import { MatchSession } from '../client/js/game/session.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

// a player's input as session.stepIntent makes it (stick, buttons, presses with their numbers, a defender's facing)
function inputs(seed) {
  const r = new RNG(seed), held = {};
  let seq = 0, mx = 0, mz = 0;
  return id => {
    if (r.next() < 0.08) { mx = r.range(-1, 1); mz = r.range(-1, 1); } // (a keyboard: the stick jumps and stays)
    const it = { mx, mz, sprint: r.next() < 0.5, defense: false, handsUp: false, face: null, stickFace: true, shoot: null, shootHeld: false, pass: null, move: null, steal: false, jump: false, call: false, screen: false };
    if (held[id]) { held[id]--; it.shootHeld = true; }
    if (r.next() < 0.02) { it.shoot = 'press'; it.shootHeld = true; held[id] = 15 + r.int(0, 30); it.seq = { shoot: ++seq }; }
    if (r.next() < 0.01) { it.pass = { dir: { x: r.range(-1, 1), z: 1 }, type: 'chest' }; it.seq = { ...(it.seq || {}), pass: ++seq }; }
    if (r.next() < 0.2) { it.defense = true; it.face = r.range(-3, 3); }
    if (r.next() < 0.01) it.postStick = [r.range(-1, 1), -0];
    return it;
  };
}

test('the wire: an input goes out normalized (blank fields left out, the stick to 1/1000, no -0), then as the change from the tick before', () => {
  const n = normIntent({ mx: 0.70710678, mz: -0.0000001, sprint: false, face: null, stickFace: true, shoot: null, seq: { shoot: 3 }, attack: undefined, postStick: [-0, 0.33333] });
  assert.deepEqual(n, { mx: 0.707, stickFace: true, seq: { shoot: 3 }, postStick: [0, 0.333] });
  assert.ok(!Object.is(n.postStick[0], -0) && !('mz' in n), 'no -0 (atan2 tells it from 0), and a stick at 0 is blank');
  assert.equal(intentDelta(n, { ...n }), 0, 'nothing changed: 0');
  assert.deepEqual(intentDelta(n, { mx: 0.5, stickFace: true, seq: { shoot: 3 }, postStick: [0, 0.333] }), { mx: 0.5 });
  assert.deepEqual(intentDelta(n, { stickFace: true }), { mx: null, seq: null, postStick: null }, 'gone: null');
  assert.deepEqual(applyDelta(n, { mx: null, sprint: true }), { stickFace: true, seq: { shoot: 3 }, postStick: [0, 0.333], sprint: true });
  assert.equal(applyDelta(n, 0), n);
});

test('the wire: the game gets the same input from the changes as the sender\'s own game does, and it\'s a fraction of the bytes', () => {
  const gen = inputs(11);
  let prev = {}, dec = { k: 0, it: {} }, plain = 0, wire = 0;
  const rebuilt = [], sent = [];
  for (let t = 1; t <= 3000; t++) {
    const raw = gen(0), it = normIntent(raw), d = intentDelta(prev, it);
    prev = it; sent.push(it);
    plain += JSON.stringify(raw).length; wire += JSON.stringify(d).length + 1;
    // (through JSON, as the socket carries it; a few ticks a message)
    assert.ok(takeInputs(dec, t, JSON.parse(JSON.stringify([d])), (k, x) => rebuilt.push(x)));
  }
  const merged = x => ({ ...blankIntent(), ...x });
  for (let t = 0; t < sent.length; t++) assert.deepEqual(merged(rebuilt[t]), merged(sent[t]), `tick ${t + 1}`);
  // what the game reads is what the player pressed (the stick to 1/1000)
  const raw = inputs(11)(0);
  assert.ok(Math.abs(merged(normIntent(raw)).mx - raw.mx) < 6e-4);
  assert.ok(wire * 4 < plain, `${wire} bytes on the wire against ${plain} as plain JSON`);
  // a bundle that overlaps what's already in (the game so far, then the watchers' bundle) is taken once
  const d2 = { k: 0, it: {} }, got = [];
  takeInputs(d2, 1, [{ mx: 1 }, 0, { mx: null }], (k) => got.push(k));
  takeInputs(d2, 2, [0, { mx: null }, { sprint: true }], (k) => got.push(k));
  assert.deepEqual(got, [1, 2, 3, 4]);
  assert.equal(takeInputs(d2, 9, [0], () => {}), false, 'a gap is refused');
});

// two screens in lockstep through a stand-in for the hub, each running the real session code that sends and takes inputs
function screens(R, D) {
  const hub = [], mk = local => {
    const s = Object.create(MatchSession.prototype);
    s.game = new Game({ mode: 'park', seed: 31, rosters: structuredClone(R), catalog, target: 15, multi: true, inputDelay: D });
    s.game.human = s.game.players[local];
    s.pend = {}; s.paused = false; s.ended = false;
    s.online = { local, game: 1, delay: D, net: { attachGame: () => () => {}, attachWatch: () => () => {}, send: m => { hub.push({ from: local, m }); return true; } } };
    s.initOnline();
    return s;
  };
  return { hub, mk };
}
// one frame of frameOnline's lockstep part: send (up to where this frame gets), then step every tick whose inputs are in
function frame(s, ticks) {
  const g = s.game, lk = s.lk;
  s.sendOnline(g.tick + ticks + lk.D + lk.extra);
  for (let n = 0; n < ticks; n++) {
    const k = g.tick + 1;
    if (s.missingFor(k).length) return false;
    for (const id of lk.humans) if (g.players[id].human) g.humanIntents.set(id, k <= lk.D ? {} : id === s.online.local ? lk.mine.get(k) || {} : lk.theirs.get(k).get(id));
    lk.theirs.delete(k); lk.mine.delete(k);
    g.step(DT);
  }
  return true;
}

test('lockstep through the wire: both screens run the same game, a slow PC sending further ahead included (its dl moves its release timing)', () => {
  const R = [makeTeam(new RNG(3), 3, { catalog, level: 0.7 }), makeTeam(new RNG(4), 3, { catalog, level: 0.7 })];
  R[0][0].human = true; R[1][0].human = true;
  const { hub, mk } = screens(R, 4);
  const A = mk(0), B = mk(3);
  const ga = inputs(5), gb = inputs(6);
  A.stepIntent = () => ga(0); B.stepIntent = () => gb(3);
  const deliver = () => { while (hub.length) { const { from, m } = hub.shift(); assert.ok(Array.isArray(m.b) && m.k >= 1 && !('i' in m)); (from === 0 ? B : A).netMessage({ ...JSON.parse(JSON.stringify(m)), s: from }); } };
  let bytes = 0, msgs = 0;
  const count = () => { for (const { m } of hub) { bytes += JSON.stringify(m).length; msgs++; } };
  for (let f = 0; f < 1500; f++) {
    if (f === 500) B.lk.extra = 2; // (B's frames got slow: his input goes out two ticks further ahead from here)
    if (f === 1000) B.lk.extra = 0;
    const tA = 1 + (f % 6 === 0 ? 1 : 0), tB = f >= 500 && f < 1000 ? (f % 2 ? 2 : 3) : tA; // (B at ~30 fps for a while)
    frame(A, tA); frame(B, tB); count(); deliver();
    // whoever's behind catches up (the stepping rule doesn't change what's simulated, only when)
    while (A.game.tick < B.game.tick && frame(A, 1)) { count(); deliver(); }
    while (B.game.tick < A.game.tick && frame(B, 1)) { count(); deliver(); }
    if (A.game.tick === B.game.tick && A.game.tick % 60 === 0) assert.equal(A.game.stateHash(), B.game.stateHash(), `tick ${A.game.tick}`);
  }
  assert.ok(A.game.tick > 1500, String(A.game.tick));
  assert.ok(bytes / msgs < 120, `${(bytes / msgs).toFixed(0)} bytes a message`);
  // B's inputs carried dl 2 while he sent further ahead, and a release he made then is graded that much earlier
  const g = A.game, p = g.players[3];
  p.intent = { dl: 2 }; assert.ok(Math.abs(g.relAt(p, { t: 1 }) - (1 - 6 * DT)) < 1e-9);
  p.intent = {}; assert.ok(Math.abs(g.relAt(p, { t: 1 }) - (1 - 4 * DT)) < 1e-9);
  p.intent = { dl: 99 }; assert.ok(Math.abs(g.relAt(p, { t: 1 }) - (1 - 28 * DT)) < 1e-9, 'capped (v0.4.8: at 24)');
});

test('a PC whose frames are slow sends further ahead: up at once, down a step after a few steady seconds', () => {
  const s = Object.create(MatchSession.prototype);
  s.game = { speed: GAME_SPEED }; s.lk = { fms: [], extra: 0, frameExtra: 0, netExtra: 0, lowFor: 0 };
  const second = ms => { for (let i = 0; i < 60; i++) s.paceOnline(ms / 1000); };
  second(16.7); assert.equal(s.lk.extra, 0, '60 fps: nothing extra');
  second(33.4); assert.equal(s.lk.extra, 1, '30 fps');
  second(55); assert.equal(s.lk.extra, 3);
  second(16.7); second(16.7); assert.equal(s.lk.extra, 3, 'not straight back down');
  second(16.7); assert.equal(s.lk.extra, 2);
  second(200); assert.equal(s.lk.extra, 4, 'at most 4');
});

test('a player whose inputs keep arriving late (the others say how long they waited) sends them further ahead, and comes back down', () => {
  const s = Object.create(MatchSession.prototype);
  s.game = { speed: GAME_SPEED }; s.online = { local: 3 };
  s.lk = { fms: [], extra: 0, frameExtra: 0, netExtra: 0, lowFor: 0, lateWin: new Map(), raisedAt: 0, calm: 0 };
  s.lateReport(120, 30); assert.equal(s.lk.extra, 0, 'a blink: nothing');
  s.lateReport(240, 180); s.lateReport(240, 400); assert.equal(s.lk.extra, 1, 'once a window, however many say so');
  s.lateReport(360, 150); assert.equal(s.lk.extra, 2);
  for (let k = 480; k <= 1200; k += 120) s.lateReport(k, 500);
  assert.equal(s.lk.extra, 4, 'at most 4 for the network');
  // quiet from here: down a tick for every three quiet windows (each judged once everyone's reported it)
  for (let k = 1320; k <= 1320 + 120 * 12; k += 120) { s.lateReport(k, 0); s.calmOnline(k + 240); }
  assert.ok(s.lk.extra <= 1, String(s.lk.extra));
  // slow frames and a slow connection: whichever needs more
  s.lk.netExtra = 1; s.lk.frameExtra = 3; s.setExtra(); assert.equal(s.lk.extra, 3);
  // the hub passes the waits on with the state check
  assert.match(src('server/online.py'), /"t": "hash", "k": msg\.get\("k"\), "h": msg\.get\("h"\), "w": w/);
});

test('the socket client: watchers\' bundles go to the game being watched, a round trip update to the people here and the squad', () => {
  const n = new Net();
  n.receive({ t: 'hello', you: { id: 'me', username: 'me' }, friends: [] });
  n.receive({ t: 'here', place: 'jungle', players: [{ id: 'b', rtt: 50 }], courts: {}, games: [] });
  n.receive({ t: 'squad', squad: { id: 's', leader: 'me', members: [{ id: 'me' }, { id: 'b', rtt: 50 }] } });
  n.receive({ t: 'rtt', id: 'b', rtt: 125 });
  assert.equal(n.people.get('b').rtt, 125); assert.equal(n.squad.members[1].rtt, 125);
  n.receive({ t: 'watch', setup: { game: 3 }, log: [[1, 1, [{ mx: 1 }]]] });
  const got = [];
  n.attachWatch(3, m => got.push(m.t));
  n.receive({ t: 'inw', g: 3, m: [[1, 2, [0]], [2, 1, [0, 0]]] });
  assert.deepEqual(got, ['inw', 'inw']);
});

test('the pieces: the hub queues per socket and relays batches, watchers play steadily behind, the park animates only what you can see', () => {
  const hub = src('server/online.py');
  for (const t of ['def send_frame', 'def _writer', 'MAX_BACKLOG', 'def flush_watch', '"inw"', 'def unmask', '"rtt"']) assert.ok(hub.includes(t), t);
  assert.doesNotMatch(hub, /payload\[i\] \^= mask/, 'no byte-at-a-time unmasking');
  const ses = src('client/js/game/session.js');
  for (const t of ['sendOnline(upTo)', 'paceOnline(dt)', 'takeInputs(s, k, b)', 'lk.buf']) assert.ok(ses.includes(t), t);
  assert.match(src('client/js/sim/game.js'), /lagOf\(p\) \{/);
});
