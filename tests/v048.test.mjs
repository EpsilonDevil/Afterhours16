// v0.4.8: online inputs land where you made them. A release is graded on the shot meter the shooter saw when he let go
// (the window and the defense then, not a few ticks later when his let-go reaches the game), his own meter stops where he
// let go, every tick's input says exactly how late it lands (dl), the input delay and round trips are measured finer,
// and the hub passes inputs on without the hop to a writer thread.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT } from '../client/js/sim/constants.js';
import { normIntent } from '../client/js/sim/wire.js';
import { MatchSession } from '../client/js/game/session.js';
import { rttReport, inputDelay, DELAY_SPARE_MS } from '../client/js/ui/online.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const D = 4;

// an online game (lockstep, a delay of D ticks) with one human, the ball in his hands at a spot, everyone else out of
// the way; tick(intent) runs one tick with his input as it comes off the wire
function online({ seed = 31, at = 5.2, dx = 0 } = {}) {
  const R = [makeTeam(new RNG(3), 3, { catalog, level: 0.7 }), makeTeam(new RNG(4), 3, { catalog, level: 0.7 })];
  R[0][0].human = true;
  const g = new Game({ mode: 'park', seed, rosters: R, catalog, target: 15, multi: true, inputDelay: D });
  const p = g.players[0], side = g.sideFor(0), rim = g.rimFor(0);
  for (let i = 0; i < 600 && g.phase !== 'live'; i++) { g.humanIntents.set(0, {}); g.step(DT); }
  g.changePossessionTo(p); g.giveBall(p, 'held'); g.needsClear = [false, false]; g.phase = 'live';
  p.setPos(rim.x + dx, rim.z - side * at, 0); p.facing = side > 0 ? 0 : Math.PI;
  const away = () => {
    for (const d of g.opponents(p)) { d.x = 6; d.z = rim.z - side * 0.5; d.vx = d.vz = 0; }
    for (const m of g.mates(p)) { m.x = -6; m.z = rim.z - side; m.vx = m.vz = 0; }
  };
  const events = [];
  const tick = it => { g.humanIntents.set(0, normIntent(it)); g.step(DT); events.push(...g.events); };
  // the man closes out right in front of him
  const close = () => { const d = g.opponents(p)[0]; d.x = p.x; d.z = p.z + side * 0.5; d.vx = d.vz = 0; d.handsUp = true; };
  return { g, p, side, away, tick, close, events };
}
// hold the shot until the meter reaches the ideal release (the screen the shooter lets go on: state s); then the
// let-go read there lands dl ticks after the game's delay, with the man closing out in between (or not)
function shootAndLetGo(G, { attack = false, dl = 3, closeout = true, before = null } = {}) {
  const { g, p, away, tick, close, events } = G;
  let s = null, reading = null;
  for (let i = 0; i < 240 && s == null; i++) {
    away(); if (!attack) p.vx = p.vz = 0;
    tick({ shoot: 'press', shootHeld: true, ...(attack ? { attack: true, mz: G.side } : {}), seq: { shoot: 1 } });
    const a = p.action;
    if (a && (a.type === 'shoot' || a.type === 'layup') && a.tRel && a.t >= a.tRel - DT / 2) { s = g.tick; reading = g.meterRead(p, a); }
  }
  assert.ok(reading, 'the shot is up');
  const a = p.action, shown = before ? before(a) : null;
  const t = s + D + 1 + dl; // (lk.seen = s as the let-go was read: session.onlineIntent's dl)
  while (g.tick < t - 1) { away(); if (closeout) close(); tick({ shootHeld: true, seq: { shoot: 1 }, dl: g.tick - D - s }); }
  if (closeout) close();
  const live = a.type === 'layup' ? g.layupContest(p, a, g.releaseYNext(p)).guard : g.shotRaw(p, a, g.releaseYNext(p));
  tick({ shootHeld: false, seq: { shoot: 1 }, dl });
  return { a, s, reading, shown, live, rel: events.find(e => e.type === 'release' && e.player === p.id) };
}

test('a jumper online is graded on the meter the shooter saw as he let go: a closeout while his let-go lands can\'t take the green away', () => {
  const r = shootAndLetGo(online());
  assert.ok(r.live > 1, `the man is all over him by the time it lands (${r.live.toFixed(2)})`);
  assert.equal(r.rel.win, r.reading.W.total, 'the window he saw');
  assert.equal(r.rel.guard, r.reading.guard);
  assert.ok(Math.abs(r.a.releaseAt - r.reading.t) < 1e-9, 'let go where his screen was');
  assert.equal(r.rel.grade, 'excellent'); assert.equal(r.rel.smothered, false); assert.equal(r.rel.made, true);
  // before v0.4.8 (measured as it landed): smothered, no window, no make
  const G = online(); G.g.seenRead = () => null;
  const old = shootAndLetGo(G);
  assert.equal(old.rel.smothered, true); assert.equal(old.rel.win, 0); assert.equal(old.rel.made, false);
});

test('a layup: the green window doesn\'t drop after the let-go (the one on his screen is the one it\'s graded on)', () => {
  const r = shootAndLetGo(online({ at: 2.4, dx: 0.3 }), { attack: true, dl: 2 });
  assert.equal(r.a.type, 'layup');
  assert.equal(r.rel.win, r.reading.W.total);
  assert.equal(r.rel.grade, 'excellent'); assert.equal(r.rel.made, true);
  const G = online({ at: 2.4, dx: 0.3 }); G.g.seenRead = () => null;
  const old = shootAndLetGo(G, { attack: true, dl: 2 });
  assert.ok(old.rel.win < r.rel.win * 0.8, `before: the window shrank after he let go (${old.rel.win.toFixed(1)} of ${r.rel.win.toFixed(1)} ms)`);
});

test('your own screen: the meter stops where you let go, and the result comes up on that same picture', () => {
  const G = online();
  const ses = Object.create(MatchSession.prototype);
  ses.game = G.g; ses.input = { isDown: () => false, gp: {}, ctx: 'offense' }; ses.letGo = null;
  const r = shootAndLetGo(G, { dl: 5, before: () => { ses.noteLetGo(); return ses.letGo?.m; } });
  assert.ok(r.shown, 'kept as you let go');
  const e = r.rel, after = ses.meterOf(e.smothered ? 0 : e.win, e.smothered ? 0 : e.nat, e.tRel, e.err, e.sure, !!e.smothered, e.grade);
  assert.ok(Math.abs(after.fill - r.shown.fill) < 1e-9, `fill ${r.shown.fill} → ${after.fill}`);
  assert.equal(after.half, r.shown.half, 'the window');
  assert.equal(after.sure, r.shown.sure);
  // (and while it lands, the meter you see is that one, not the live one running on)
  assert.match(src('client/js/game/session.js'), /const held = this\.letGo && a && this\.letGo\.a === a && !a\.released \? this\.letGo\.m : null;/);
});

test('every tick\'s input says exactly how late it lands after what your screen showed (dl), while a shot could use it', () => {
  const ses = Object.create(MatchSession.prototype);
  ses.game = { tick: 100, human: { action: null } }; ses.lk = { D: 4, seen: 100, seq: 0 }; ses.pend = { shoot: { ttl: 1 } };
  ses.paused = false; ses.ended = false; ses.input = { isDown: () => false, gp: {} };
  ses.stepIntent = () => ({ mx: 0, shootHeld: false });
  assert.equal(ses.onlineIntent(105).dl, undefined, 'the next tick: nothing extra');
  assert.equal(ses.onlineIntent(106).dl, 1);
  assert.equal(ses.onlineIntent(116).dl, 11, 'a catch-up after a wait: 11 ticks more');
  assert.equal(ses.onlineIntent(200).dl, 24, 'at most 24');
  ses.pend = {};
  assert.equal(ses.onlineIntent(110).dl, undefined, 'no shot, nothing pressed: not sent');
  // the game takes it: a let-go 11 ticks late is graded 11 ticks earlier than one on time
  const G = online(), p = G.p;
  p.intent = { dl: 11 }; assert.ok(Math.abs(G.g.relAt(p, { t: 1 }) - (1 - (D + 11) * DT)) < 1e-9);
  p.intent = { dl: 99 }; assert.ok(Math.abs(G.g.lagOf(p) - (D + 24) * DT) < 1e-9);
  assert.match(src('client/js/game/session.js'), /lk\.seen = g\.tick;\n {4}if \(!this\.paused && !spec\) \{ this\.captureInput\(\); this\.noteLetGo\(\); \}/);
});

test('online, the rest that\'s timed counts from his screen too: a shot held too long, a free throw, the alley-oop button', () => {
  const G = online(), g = G.g, p = G.p;
  p.intent = { dl: 2 };
  assert.ok(Math.abs(g.lateBy(p) - (D + 2) * DT) < 1e-9);
  const off = new Game({ mode: 'park', seed: 4, rosters: [makeTeam(new RNG(1), 1, { catalog }), makeTeam(new RNG(2), 1, { catalog })], catalog, target: 11 });
  off.players[0].human = true; assert.equal(off.lateBy(off.players[0]), 0, 'offline: as before');
  const game = src('client/js/sim/game.js');
  assert.match(game, /a\.t - this\.lateBy\(p\) > a\.tRel \+ 0\.3\) a\.releaseAt = a\.t - this\.lateBy\(p\);/);
  assert.match(game, /a\.t - this\.lateBy\(p\) > a\.release \+ 0\.3\)/);
  assert.match(game, /a\.t - this\.lateBy\(p\) > a\.tRel \+ 0\.35\) a\.releaseAt = a\.t - this\.lateBy\(p\);/);
  // the alley-oop: a press read on his screen at time T is judged at T, as offline (it was a tick late)
  p.intent = { dl: 0 }; p.oopQte = { t0: g.time - 0.5, open: 0.1, close: 0.9, btn: 0 };
  g.oopInput(p, 0);
  assert.ok(Math.abs(p.oopQte.at - (0.5 - (D + 1) * DT)) < 1e-9);
});

test('the meter and the release read the same thing: a shot out of the post with its shield, and the hook has a meter now', () => {
  const G = online({ at: 1.6 }), g = G.g, p = G.p;
  const d = g.opponents(p)[0]; d.x = p.x; d.z = p.z + G.side * 0.7;
  const a = g.startPostShot(p, 'fade');
  const r = g.meterRead(p, a);
  assert.ok(r.raw < g.contestIfReleased(p), 'the fade\'s shield is on the meter (it used to show the plain contest)');
  p.action = null; g.giveBall(p, 'held');
  const h = g.startPostShot(p, 'hook');
  assert.equal(h.kind, 'close');
  const ses = Object.create(MatchSession.prototype); ses.game = g;
  h.t = 0.2;
  assert.ok(ses.liveMeter(p, h), 'a hook is timed: its meter shows');
});

test('round trips to 5 ms (said again once they move 4 ms), 25 ms to spare in the input delay', () => {
  const net = { rtt: 61 };
  assert.equal(rttReport(net), 60);
  net.rtt = 63.9; assert.equal(rttReport(net), 60, 'a flicker: not sent again');
  net.rtt = 64.1; assert.equal(rttReport(net), 65);
  net.rtt = null; assert.equal(rttReport(net), null);
  assert.equal(DELAY_SPARE_MS, 25);
  assert.equal(inputDelay([30, 30]), 4, 'a tick less than with 30 ms to spare (5)');
});

test('the hub sends an input straight out when nothing is queued for that socket; a hosted service switches threads every 1 ms', () => {
  const hub = src('server/online.py');
  assert.match(hub, /DIRECT_SEND = hasattr\(socket, "MSG_DONTWAIT"\)/);
  assert.match(hub, /self\.sock\.send\(fr, socket\.MSG_DONTWAIT\)/);
  assert.match(src('server/app.py'), /sys\.setswitchinterval\(0\.001\)/);
  // (players whose inputs come late raise their own send-ahead sooner: past 60 ms of waiting in 2 s)
  assert.match(src('client/js/game/session.js'), /if \(ms > 60 && k > lk\.raisedAt\)/);
});

test('v0.4.8 quick patch: five new mixes on the soundtrack, each in parts that play back to back (every part under 30 MB)', () => {
  const dir = new URL('../client/audio/music/', import.meta.url);
  const list = JSON.parse(fs.readFileSync(new URL('tracks.json', dir))).tracks;
  const want = { 'family-tree-vol-10-orosa': 2, 'soulection-626-full-crate': 5, 'soulection-631-olea': 5, 'soulection-611-keyrah': 4, 'the-playlist-finds-you': 2 };
  for (const [slug, n] of Object.entries(want)) {
    const t = list.find(x => x.file === `${slug}-1.mp3`);
    assert.ok(t, slug);
    assert.deepEqual(t.parts, Array.from({ length: n }, (_, i) => `${slug}-${i + 1}.mp3`));
    assert.ok(t.title && t.artist && t.duration > 3000, slug);
    for (const f of t.parts) { const u = new URL(f, dir); if (fs.existsSync(u)) assert.ok(fs.statSync(u).size < 30e6, f); }
  }
  assert.equal(new Set(list.map(t => t.file)).size, list.length, 'no track twice');
});
