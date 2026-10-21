// v0.4.8.7 the park director (client/js/game/parkdirector.js, parklink.js): one deterministic park for everyone in it.
// Every client runs the same director from the same epoch (or the server's snapshot) with the same server-ordered events;
// these check that its result is a function of those alone: not of the wall clock, this PC's clock skew, Math.random,
// performance.now, the frame rate or who is watching which court; that a snapshot plus the events since plays on exactly
// as the park did; and what the real players' events do to it.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AIWorld, setWorldClock } from '../client/js/sim/world.js';
import { squadWindow } from '../client/js/sim/iconsquad.js';
import { ParkDirector, TICK_UNITS, canonical, hashState, stepCost } from '../client/js/game/parkdirector.js';
import { ParkLink, PD_CHECK, PD_SNAP } from '../client/js/game/parklink.js';
import { PARK_COURTS, squadSpots, courtPlayRect } from '../client/js/world/themes.js';
import { RNG } from '../client/js/core/rng.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
const lay = ids => ({ courts: PARK_COURTS.filter(c => ids.includes(c.id)).map(c => ({ ...c, rows: squadSpots(c), rect: courtPlayRect(c) })), solids: [{ x0: 2, x1: 8, z0: -28, z1: -24 }, { x0: -9, x1: -6, z0: -27, z1: -25 }] });
const SMALL = lay(['main', 'w2a', 'e1']), ICONS = lay(['main', 'east', 'west']);
const T0 = Date.UTC(2026, 9, 21, 1, 0); // (an evening: the park is busy)
const realNow = Date.now, realPerf = performance.now, realRandom = Math.random;
// one client: its own copy of the shared world on its own clock (skew: how far this PC's clock is off the server's)
function client({ skew = 0, noise = 1, layout = SMALL, t0 = T0, epoch = 3, born = T0 - 300 * 86400000 } = {}) {
  setWorldClock(T0, 0, T0 - skew); // (the world's clock: the server's time read against this PC's)
  const r = new RNG(noise * 7919);
  Date.now = () => realNow() - skew; performance.now = () => realPerf.call(performance) * noise + noise * 1000; Math.random = () => r.next();
  const w = new AIWorld({ seed: 4242, born }, catalog); w.shared = true; w.squadAsync = true;
  return new ParkDirector({ world: w, park: 'harbor', layout, catalog, epoch, t0, surface: 'asphalt', toLocal: ms => ms - skew });
}
const restore = () => { Date.now = realNow; performance.now = realPerf; Math.random = realRandom; setWorldClock(null); };
// run a director to tick n with events (k → [ev]); hashes every 10 ticks. render: step the courts' games toward random
// points between ticks, as a screen does every frame (never past the next tick)
function play(D, n, evs = {}, { render = false, rng = new RNG(5), at = {} } = {}) {
  const hs = [];
  for (let k = D.k + 1; k <= n; k++) {
    if (render) for (let f = 0; f < 3; f++) { const U = (k - 1) * TICK_UNITS + Math.floor(rng.next() * TICK_UNITS); for (const r of D.runners) if (r) r.stepTo(U, 1 + Math.floor(rng.next() * 40)); }
    D.step(evs[k] || []);
    if (k % 10 === 0) hs.push([k, D.hash()]);
    at[k]?.(D);
  }
  return hs;
}

test('the director never reads the clock, the frame time or Math.random (the source)', () => {
  const src = fs.readFileSync(new URL('../client/js/game/parkdirector.js', import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const bad of [/Math\.random/, /Date\.now/, /performance\.now/, /requestAnimationFrame/, /setTimeout|setInterval/, /\bdt\b/, /new Date\b/]) assert.doesNotMatch(src, bad, `parkdirector.js uses ${bad}`);
  // (the courts' games step by the sim's fixed DT, at a pace set by the game's phase alone)
  assert.match(src, /g\.step\(DT\)/);
  assert.equal(stepCost({ phase: 'live' }), 6); assert.equal(stepCost({ phase: 'dead' }), 3); assert.equal(stepCost({ phase: 'check' }), 2); assert.equal(stepCost({ phase: 'live', over: true }), 3);
});

test('the state hash is canonical: key order does not matter, values do', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: null }] }), canonical({ a: [2, { c: null, d: 3 }], b: 1 }));
  assert.equal(hashState({ x: 1, y: 2 }), hashState({ y: 2, x: 1 }));
  assert.notEqual(hashState({ x: 1, y: 2 }), hashState({ x: 1, y: 3 }));
});

test('two clients, different clocks, skews, Math.random and frame rates: the same park, tick for tick', () => {
  try {
    const A = client({ skew: 0, noise: 1 }), ha = play(A, 240, {}, { render: true, rng: new RNG(11) }), sa = A.snapshot();
    const B = client({ skew: -37250, noise: 3 }), hb = play(B, 240, {}, { render: false }), sb = B.snapshot();
    assert.deepEqual(hb, ha);
    assert.equal(canonical(sb), canonical(sa));
    // (a living park: games played out and rotated, people about, lines on the spots)
    assert.ok(sa.courts.some(c => c.ks > 0 || c.g?.k0 > 0), 'games were played and the courts turned over');
    assert.ok(sa.walkers.length >= 3, 'park-goers about');
    for (const c of sa.courts) if (c.g) { const ids = c.g.r.flat(); assert.equal(new Set(ids).size, ids.length); }
    const all = [...sa.walkers.map(w => w.id), ...sa.courts.flatMap(c => (c.g ? c.g.r.flat() : []))];
    assert.equal(new Set(all).size, all.length, 'nobody is in two places');
    for (const c of sa.courts) for (const l of c.lines) if (l) for (const id of l.ids) assert.equal(sa.walkers.find(w => w.id === id)?.st, 'line', 'a line is park-goers on its spot');
  } finally { restore(); }
});

test('a snapshot plus the events since plays on exactly as the park did (a newcomer, a resync)', () => {
  try {
    const evs = { 30: [{ e: 'squad', from: 'u1', ids: ['ai-5', 'ai-6'] }], 95: [{ e: 'claim', c: 0, r: 0, aid: 'u1' }], 100: [{ e: 'ready', from: 'u1', c: 0 }], 170: [{ e: 'court', c: 1, real: 1 }], 200: [{ e: 'court', c: 1, real: 0 }] };
    let snap = null, h120 = null;
    const A = client({ skew: 1200 }), ha = play(A, 240, evs, { render: true, at: { 120: D => { snap = D.snapshot(); h120 = D.hash(); } } });
    // (the hash doesn't care how the courts' runners are held: a court that never had a game is a court with none)
    const h = A.hash(); A.runners.push(null, null); assert.equal(A.hash(), h); A.runners.length = SMALL.courts.length;
    const C = client({ skew: -900, noise: 2 });
    const R = new ParkDirector({ world: C.world, park: 'harbor', layout: SMALL, catalog, epoch: 3, t0: T0, toLocal: C.toLocal }, snap);
    assert.equal(R.k, 120);
    // (a court with no game since the start and one that had one: the same digest either way)
    assert.equal(JSON.stringify(R.digest()).length > 0 && R.digest().length, SMALL.courts.length);
    let n = 0; while (R.behind(R.k * TICK_UNITS) > 0 && n++ < 1e5) R.catchUp(97, R.k * TICK_UNITS); // (its courts' games replayed from their start, a slice at a time)
    assert.equal(R.hash(), h120, 'the newcomer\'s park is the park as of its snapshot');
    const hr = play(R, 240, evs);
    assert.deepEqual(hr, ha.filter(([k]) => k > 120));
  } finally { restore(); }
});

test('the real players: lend, free, claims, a real court, ready, squads, a player gone', () => {
  try {
    const A = client({ skew: 0 });
    play(A, 25);
    const w0 = A.s.walkers.find(w => w.st !== 'line' && w.unit == null);
    assert.ok(w0, 'a park-goer to take');
    // a real player takes him for his Got Next spot: gone from the park-goers, lent to him
    play(A, 26, { 26: [{ e: 'claim', c: 0, r: 1, aid: 'u1' }, { e: 'lend', from: 'u1', c: 0, r: 1, ids: [w0.id] }] });
    assert.ok(!A.W(w0.id) && A.s.lent.some(l => l[0] === w0.id && l[1] === 'u1' && l[3] === 1));
    assert.equal(A.s.courts[0].lines[1], null, 'no AI line on a spot a real squad has');
    // someone else can't lend him from another court; the court changing hands can (run it back)
    play(A, 27, { 27: [{ e: 'lend', from: 'u2', c: 1, ids: [w0.id] }] });
    assert.equal(A.s.lent.find(l => l[0] === w0.id)[1], 'u1');
    // ready: the AI game on the court is wrapped up and the kings wait for the squad
    play(A, 28, { 28: [{ e: 'ready', from: 'u1', c: 0 }] });
    play(A, 60);
    const c0 = A.s.courts[0];
    assert.equal(c0.g, null, 'the game on it was wrapped up');
    assert.ok(c0.ready != null && (c0.kings?.length === 3 || c0.kings === null));
    const kings = c0.kings || [];
    assert.equal(kings.length, 3, 'the kings wait on the court for the squad (this world, this evening)');
    // their game on: the kings lent (off the court's record), then the AI win it: they hold the court with one more
    play(A, 61, { 61: [{ e: 'court', c: 0, real: 1 }, { e: 'lend', from: 'u1', c: 0, ids: kings }] });
    assert.equal(c0.ready, null); assert.equal(c0.kings, null);
    for (const id of kings) assert.ok(A.s.lent.some(l => l[0] === id && l[1] === 'u1'));
    {
      play(A, 90, { 90: [{ e: 'free', from: 'u1', c: 0, ids: kings, kings: 1, ks: 4 }, { e: 'court', c: 0, real: 0 }] });
      assert.deepEqual(A.s.courts[0].g?.r[0], kings, 'the kings who beat them hold the court');
      assert.equal(A.s.courts[0].ks, 4);
    }
    // a real court: the AI game on it walks off
    const c2 = A.s.courts[2], had = c2.g ? c2.g.r.flat() : [];
    play(A, 91, { 91: [{ e: 'court', c: 2, real: 1 }] });
    assert.equal(c2.g, null);
    for (const id of had) assert.ok(!A.s.courts.some(c => c.g?.r.flat().includes(id)));
    // a player's own AI squad is nobody else's
    play(A, 140, { 92: [{ e: 'squad', from: 'u3', ids: ['ai-1', 'ai-2', 'ai-3'] }] });
    const busy = [...A.s.walkers.map(w => w.id), ...A.s.courts.flatMap(c => [...(c.g && c.g.k0 > 92 ? c.g.r.flat() : []), ...c.lines.flatMap(l => (l && l.full > 92 ? l.ids : []))])];
    for (const id of ['ai-1', 'ai-2', 'ai-3']) assert.ok(!busy.includes(id), `${id} stays with his player`);
    // a player gone: what he had goes back to the park
    play(A, 141, { 141: [{ e: 'gone', from: 'u1' }] });
    assert.ok(!A.s.lent.some(l => l[1] === 'u1'));
    assert.ok(!A.s.courts.some(c => c.claim.includes('u1') || c.rb === 'u1'));
    // nonsense from a client changes nothing
    const lent = JSON.stringify(A.s.lent), claims = JSON.stringify(A.s.courts.map(c => c.claim));
    A.step([{ e: 'lend', from: 'u9', c: 99, ids: ['x'] }, { e: 'lend', from: 'u9', c: 0, ids: ['ai-1; drop', 7, null] }, { e: 'free', from: 'u9', c: 0, ids: ['ai-1'] }, { e: 'zap' }, null, { e: 'claim', c: 0, r: 5 }, { e: 'squad', ids: ['ai-9'] }]);
    assert.equal(JSON.stringify(A.s.lent), lent); assert.equal(JSON.stringify(A.s.courts.map(c => c.claim)), claims);
  } finally { restore(); }
});

test('the ICON Squad: they come in together, play as one and are the same on every screen', () => {
  let win = null; for (let k = 0; k < 60 && !win; k++) { const w = squadWindow(k); if (w.park === 'harbor' && w.start > Date.UTC(2026, 9, 24)) win = w; }
  const t0 = win.start - 60000, born = t0 - 400 * 86400000;
  try {
    const A = client({ layout: ICONS, t0, born, skew: 0 }), ha = play(A, 200, {}, { render: true });
    const B = client({ layout: ICONS, t0, born, skew: 5000, noise: 4 }), hb = play(B, 200);
    assert.deepEqual(hb, ha);
    const u = A.s.icon;
    assert.ok(u, 'this world has its ICON Squad at Harbor Point this window');
    { // (a world with three ICONs by then)
      assert.ok(u.formed, 'they came in');
      const where = [...A.s.walkers.filter(w => u.ids.includes(w.id)).map(w => 'w'), ...A.s.courts.flatMap(c => [...(c.g ? c.g.r.filter(r => r.every(id => u.ids.includes(id))).map(() => 'g') : []), ...c.lines.filter(l => l?.icon === u.k).map(() => 'l')])];
      assert.ok(where.length >= 1, 'they are somewhere in the park, as one');
      for (const c of A.s.courts) if (c.g) for (const r of c.g.r) { const n = r.filter(id => u.ids.includes(id)).length; assert.ok(n === 0 || n === 3, 'never split across teams'); }
    }
  } finally { restore(); }
});

test('the link plays a tick only once the server has said every event for it is out, and checks in', () => {
  try {
    const A = client({ skew: 0 });
    const sent = [], net = { send: m => { sent.push(m); return true; } };
    let now = T0 + 5000;
    const L = new ParkLink(net, 'harbor', () => ({ world: A.world, park: 'harbor', layout: SMALL, catalog, toLocal: ms => ms }), {});
    L.serverNow = () => now;
    assert.ok(L.state({ place: 'harbor', epoch: 3, t0: T0, seed: 0, k: 5, w: 3, n: 0, snap: null, log: [] }));
    for (let i = 0; i < 100; i++) L.frame(); // (a tick's court steps go a frame's budget at a time)
    assert.equal(L.dir.k, 3, 'up to the watermark, no further');
    L.tick({ place: 'harbor', epoch: 3, k: 40 }); now = T0 + 25000; for (let i = 0; i < 400; i++) L.frame();
    assert.equal(L.dir.k, Math.floor(25 - 1.5), 'and up to the server clock less the delay');
    assert.ok(sent.some(m => m.t === 'pcheck' && m.k === PD_CHECK && Number.isInteger(m.h)), 'a hash every 10 ticks');
    // an event for a tick already played: out of step: it asks for the park again
    L.event({ place: 'harbor', epoch: 3, k: 2, n: 1, ev: { e: 'court', c: 0, real: 1 } });
    assert.ok(sent.some(m => m.t === 'pwant'));
    // events in order are played on their tick
    L.event({ place: 'harbor', epoch: 3, k: 30, n: 2, ev: { e: 'court', c: 2, real: 1 } });
    L.tick({ place: 'harbor', epoch: 3, k: 70 }); now = T0 + 70000; for (let i = 0; i < 1000; i++) L.frame();
    assert.equal(L.dir.s.courts[2].real, 1);
    assert.ok(sent.some(m => m.t === 'pcheck' && m.k === PD_SNAP && m.s && m.s.k === PD_SNAP), 'the state every 60');
    // other epochs and other parks are ignored
    L.event({ place: 'brick', epoch: 3, k: 90, n: 3, ev: { e: 'court', c: 0, real: 1 } }); L.event({ place: 'harbor', epoch: 4, k: 90, n: 3, ev: { e: 'court', c: 0, real: 1 } });
    assert.ok(!L.pend.has(90));
  } finally { restore(); }
});
