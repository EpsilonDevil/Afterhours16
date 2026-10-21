// v0.4.8.7 quick patch 5 (David: "let's allow for auto-play in pro-am online for now; to allow for players to take breaks
// and continue playing during long pro-am grinds"). Online, auto-play is each seat's own: it rides in the player's
// inputs (it.auto, sim/wire.js), so every screen (the people in the game and everyone watching) plays that seat with
// the AI from the same tick, with the game's own rng: the lockstep games stay identical. One rule for "a person plays
// this player": Game.controlled(p) (not the AI's, no offline auto-play, his seat not on auto). Only in online Pro-Am:
// H there toggles it (and settings.autoPlay carries it into the next game, as offline); online park and the rest say
// it's only in Pro-Am. The feed and his name tag on every screen say he's on auto-play. Rewards are as offline auto-play:
// nothing in the result says who played, so it pays the same and the server's results check sees the same result
// from every screen.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const catalog = Object.fromEntries(JSON.parse(src('server/catalog.json')).map(i => [i.id, i]));
globalThis.window = globalThis; globalThis.addEventListener = () => {};
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, setAttribute() {} });
globalThis.document = { documentElement: el(), body: el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: el, getElementById: () => null, hidden: false };

const { Game } = await import('../client/js/sim/game.js');
const { makeTeam } = await import('../client/js/sim/bots.js');
const { RNG } = await import('../client/js/core/rng.js');
const { DT } = await import('../client/js/sim/constants.js');
const { blankIntent } = await import('../client/js/sim/player.js');
const W = await import('../client/js/sim/wire.js');
const { settings } = await import('../client/js/core/settings.js');

// a 5-on-5 online Pro-Am: two people (one a side), eight of the AI
function rosters(seed) {
  const r = new RNG(seed);
  const a = makeTeam(r, 5, { catalog, level: 0.7 }), b = makeTeam(r, 5, { catalog, level: 0.7 });
  a[0].human = true; b[0].human = true;
  return JSON.parse(JSON.stringify([a, b]));
}
const cfg = { mode: 'proam', seed: 41, catalog, quarterLen: 120, quarters: 4, multi: true, inputDelay: 4 };
// each person's stick and buttons, the same stream for every screen
function inputs(seed) {
  const ir = new RNG(seed), held = {};
  let seq = 0;
  return id => {
    const it = { mx: ir.range(-1, 1), mz: ir.range(-1, 1), sprint: ir.next() < 0.3, shootHeld: false };
    if (held[id]) { held[id]--; it.shootHeld = true; }
    if (ir.next() < 0.02) { it.shoot = 'press'; it.shootHeld = true; held[id] = 15 + ir.int(0, 30); it.seq = { shoot: ++seq }; }
    if (ir.next() < 0.01) { it.pass = { dir: { x: ir.range(-1, 1), z: 1 }, type: 'chest' }; it.seq = { ...(it.seq || {}), pass: ++seq }; }
    return W.normIntent(it);
  };
}
// seat 5 (the other team's person) goes on auto-play for a while, twice; seat 0 never
const autoAt = t => (t >= 600 && t < 2400) || t >= 3600;
const TICKS = 5000;

test('two screens running the same inputs, one seat toggling auto-play on and off mid-game: identical, tick by tick', () => {
  const R = rosters(7);
  const A = new Game({ ...cfg, rosters: structuredClone(R) }), B = new Game({ ...cfg, rosters: structuredClone(R) });
  A.human = A.players[0]; B.human = B.players[5]; // (each screen's own player: only the UI reads it)
  const humans = A.players.filter(p => p.human).map(p => p.id);
  assert.deepEqual(humans, [0, 5]);
  const inp = inputs(13);
  // B's screen rebuilds everyone's inputs from the changes on the wire, as a remote client does (A uses them as sent)
  const last = { 0: W.normIntent(blankIntent()), 5: W.normIntent(blankIntent()) }, rebuilt = { ...last };
  const flips = { A: [], B: [] };
  let hashes = 0;
  for (let t = 1; t <= TICKS; t++) {
    for (const id of humans) {
      let it = inp(id);
      if (id === 5 && autoAt(t)) it = W.normIntent({ auto: true }); // (his screen sends only that while he's on auto)
      A.humanIntents.set(id, it);
      const d = W.intentDelta(last[id], it); last[id] = it;
      rebuilt[id] = W.applyDelta(rebuilt[id], d);
      B.humanIntents.set(id, structuredClone(rebuilt[id]));
    }
    A.step(DT); B.step(DT);
    for (const [G, f] of [[A, flips.A], [B, flips.B]]) for (const e of G.events) if (e.type === 'autoplay') f.push([t, e.player, e.on]);
    if (t % 60 === 0) { assert.equal(A.stateHash(), B.stateHash(), `diverged by tick ${t}`); hashes++; }
    if (t === 1200) {
      // on auto: the AI plays him (on both screens), with his own career numbers' profile
      for (const G of [A, B]) { const p = G.players[5]; assert.equal(p.auto, true); assert.equal(G.isAI(p), true); assert.equal(G.controlled(p), false); assert.equal(G.autoPlays(p), true); assert.equal(G.controlled(G.players[0]), true); }
    }
    if (t === 3000) for (const G of [A, B]) { assert.equal(G.players[5].auto, false); assert.equal(G.controlled(G.players[5]), true); }
  }
  assert.ok(hashes > 80);
  // on and off at the same ticks on both screens: on at 600, off at 2400, on at 3600
  assert.deepEqual(flips.A, flips.B);
  assert.deepEqual(flips.A.map(f => [f[1], f[2]]), [[5, true], [5, false], [5, true]]);
  assert.equal(flips.A[0][0], 600);
});

test('auto-play really hands his player to the AI: the same game without it plays out differently', () => {
  const R = rosters(7), inp1 = inputs(13), inp2 = inputs(13);
  const A = new Game({ ...cfg, rosters: structuredClone(R) }), C = new Game({ ...cfg, rosters: structuredClone(R) });
  let diverged = null, aiMoved = 0;
  for (let t = 1; t <= 1800; t++) {
    for (const id of [0, 5]) {
      const a = inp1(id), c = inp2(id);
      A.humanIntents.set(id, id === 5 && autoAt(t) ? W.normIntent({ auto: true }) : a);
      C.humanIntents.set(id, c);
    }
    const p = A.players[5], x0 = p.x, z0 = p.z;
    A.step(DT); C.step(DT);
    if (autoAt(t) && Math.hypot(p.x - x0, p.z - z0) > 0.01) aiMoved++;
    if (diverged == null && A.stateHash() !== C.stateHash()) diverged = t;
  }
  assert.ok(diverged != null && diverged >= 600, `diverged at ${diverged}`);
  assert.ok(aiMoved > 200, `he plays on auto (moved on ${aiMoved} ticks with no stick of his)`);
});

test('a watcher, fed the same inputs in bundles from the online server, plays the auto seat the same', () => {
  const R = rosters(7), inp = inputs(13);
  const A = new Game({ ...cfg, rosters: structuredClone(R) }), Wt = new Game({ ...cfg, rosters: structuredClone(R) });
  A.human = A.players[0]; Wt.human = null; // (a spectator has no player of his own)
  const last = { 0: W.normIntent(blankIntent()), 5: W.normIntent(blankIntent()) }, buf = [], rebuilt = { 0: last[0], 5: last[5] };
  const fa = [], fw = [];
  for (let t = 1; t <= 3000; t++) {
    for (const id of [0, 5]) {
      const it = id === 5 && autoAt(t) ? W.normIntent({ auto: true }) : inp(id);
      A.humanIntents.set(id, it);
      buf.push([id, t, W.intentDelta(last[id], it)]); last[id] = it;
    }
    A.step(DT);
    for (const e of A.events) if (e.type === 'autoplay') fa.push([A.tick, e.on]);
    // the watcher gets them a few ticks late, in bundles ('inw'), and plays them in order
    if (t % 6 === 0) {
      const ticks = new Map();
      for (const [id, k, d] of buf.splice(0)) { rebuilt[id] = W.applyDelta(rebuilt[id], d); (ticks.get(k) || ticks.set(k, new Map()).get(k)).set(id, structuredClone(rebuilt[id])); }
      for (const [, m] of [...ticks].sort((a, b) => a[0] - b[0])) { for (const [id, it] of m) Wt.humanIntents.set(id, it); Wt.step(DT); for (const e of Wt.events) if (e.type === 'autoplay') fw.push([Wt.tick, e.on]); }
      assert.equal(Wt.stateHash(), A.stateHash(), `the watcher differs at tick ${t}`);
    }
  }
  assert.deepEqual(fw, fa, 'the seat went on and off auto-play at the same ticks for the watcher');
  assert.deepEqual(fa.map(f => f[1]), [true, false]);
});

test('the wire: auto goes out, comes back, and off again; left out while it\'s off', () => {
  assert.equal(blankIntent().auto, false);
  const on = W.normIntent({ ...blankIntent(), auto: true });
  assert.deepEqual(on, { auto: true });
  assert.ok(!('auto' in W.normIntent(blankIntent())));
  const prev = W.normIntent(blankIntent()), d = W.intentDelta(prev, on);
  assert.equal(d.auto, true);
  assert.deepEqual(W.applyDelta(prev, d), on);
  assert.equal(W.intentDelta(on, on), 0, 'held on: nothing on the wire');
  assert.equal(W.applyDelta(on, W.intentDelta(on, prev)).auto, undefined, 'and back off');
  // it's never a one-off press: multiIntent keeps it every tick, whatever was used
  const g = new Game({ ...cfg, rosters: rosters(3) });
  g.humanIntents = new Map([[0, { auto: true, shoot: 'press', seq: { shoot: 4 } }]]); g.players[0].usedSeq = 4;
  const m = g.multiIntent(g.players[0]);
  assert.equal(m.auto, true); assert.equal(m.shoot, null);
});

test('offline is as it was: one auto-play for the game (H), and nobody\'s inputs can set a seat\'s auto there', () => {
  const r = new RNG(5), t0 = makeTeam(r, 3, { catalog, level: 0.7 }), t1 = makeTeam(r, 3, { catalog, level: 0.7 });
  t0[0].human = true;
  const g = new Game({ mode: 'park', seed: 5, rosters: [t0, t1], catalog, target: 11 });
  const p = g.players[0];
  assert.equal(g.controlled(p), true); assert.equal(g.isAI(p), false);
  g.assist = true;
  assert.equal(g.controlled(p), false); assert.equal(g.isAI(p), true); assert.equal(g.autoPlays(p), true);
  g.assist = false;
  g.setInput({ ...blankIntent(), auto: true }); g.step(DT);
  assert.equal(p.auto, false, 'offline, an input never turns auto-play on');
  assert.equal(g.controlled(p), true);
  // the AI's own players: never "controlled", never "auto-playing" a person
  assert.equal(g.controlled(g.players[1]), false); assert.equal(g.autoPlays(g.players[1]), false);
  // every "a person plays him" check in the sim goes through controlled(p)
  const sim = src('client/js/sim/game.js');
  assert.equal((sim.match(/p\.human && !this\.assist/g) || []).length, 2, 'only in controlled() itself and where the game reads his inputs');
  assert.match(sim, /isAI\(p\) \{ return !p\.human \|\| this\.assist \|\| !!p\.auto; \}/);
  assert.ok(!/\(p\.human && (this\.)?g\.assist && p\.profile/.test(src('client/js/sim/ai.js')), 'the AI\'s profile play goes through onAuto');
  assert.match(src('client/js/sim/ai.js'), /const onAuto = \(g, p\) => \(g\.autoPlays \? g\.autoPlays\(p\) :/);
});

test('a shot he\'d already started when auto-play goes on is let go by the AI (never left hanging)', () => {
  const R = rosters(9);
  const g = new Game({ ...cfg, rosters: R });
  for (let i = 0; i < 600 && g.phase !== 'live'; i++) { g.humanIntents.set(0, {}); g.humanIntents.set(5, {}); g.step(DT); }
  const p = g.players[0];
  g.giveBall(p, 'held');
  g.humanIntents.set(0, { shoot: 'press', shootHeld: true, seq: { shoot: 1 } }); g.humanIntents.set(5, {}); g.step(DT);
  assert.equal(p.action?.type, 'shoot', 'a jumper of his is up');
  for (let i = 0; i < 3; i++) { g.humanIntents.set(0, { shootHeld: true }); g.step(DT); }
  g.humanIntents.set(0, { auto: true }); g.step(DT);
  assert.ok(p.action.releaseAt != null, 'the AI\'s release, set the tick it went on');
  let released = false;
  for (let i = 0; i < 120 && !released; i++) { g.humanIntents.set(0, { auto: true }); g.humanIntents.set(5, {}); g.step(DT); released = g.events.some(e => e.type === 'release' && e.player === 0); }
  assert.ok(released);
});

test('the session: H in online Pro-Am toggles your seat\'s auto-play (and remembers it); elsewhere online it says it\'s only in Pro-Am', async () => {
  const S = await import('../client/js/game/session.js');
  const mk = (mode, extra = {}) => {
    const g = new Game({ ...cfg, mode, rosters: rosters(3), ...(mode === 'park' ? { target: 11 } : {}) });
    g.human = g.players[0];
    const feed = [], pressed = new Set(['assist']);
    const s = Object.assign(Object.create(S.MatchSession.prototype), {
      game: g, online: { local: 0 }, spectate: false, background: false, autoOnline: false, pend: { shoot: { ttl: 1 } }, lk: { seq: 0, D: 4 },
      hud: { pushFeed: t => feed.push(t), showCam() {} }, input: { wasPressed: k => pressed.has(k), isDown: () => false, gp: {} }, frameOnline() {}, ...extra,
    });
    return { s, g, feed };
  };
  settings.autoPlay = false;
  { const { s, feed } = mk('proam'); s.frame(DT);
    assert.equal(s.autoOnline, true); assert.match(feed[0], /Auto-play ON/); assert.deepEqual(s.pend, {}, 'what you\'d pressed is dropped');
    assert.equal(settings.autoPlay, true, 'it carries over to your next game, as offline');
    assert.deepEqual(s.onlineIntent(10), { auto: true }, 'your inputs say so, every tick');
    assert.equal(s.stepIntent(), null);
    s.frame(DT); assert.equal(s.autoOnline, false); assert.match(feed[1], /Auto-play OFF/); assert.equal(settings.autoPlay, false); }
  { const { s, feed } = mk('park'); s.frame(DT); assert.equal(s.autoOnline, false); assert.equal(feed[0], 'Auto-play is only in online Pro-Am'); }
  { const { s, feed } = mk('proam', { spectate: true }); s.game.human = null; s.frame(DT); assert.equal(s.autoOnline, false); assert.match(feed[0], /for the players in the game/); }
  // the start: on in online Pro-Am when your choice is on; never anywhere else online
  { const { s } = mk('proam'); assert.equal(s.autoAllowed(), true); }
  { const { s } = mk('park'); assert.equal(s.autoAllowed(), false); }
  const ss = src('client/js/game/session.js');
  assert.match(ss, /this\.autoOnline = !!\(this\.online && this\.autoAllowed\(\) && settings\.autoPlay\);/);
  // the feed and his name tag, on every screen
  assert.match(ss, /case 'autoplay': if \(P\) hud\.pushFeed\(/);
  assert.match(ss, /<em class="ptag-auto">AUTO<\/em>/);
});

test('rewards are as offline auto-play: the result doesn\'t say who played, so every screen reports the same', () => {
  const R = rosters(7), inp = inputs(13);
  const g = new Game({ ...cfg, rosters: R });
  for (let t = 1; t <= 600; t++) { for (const id of [0, 5]) g.humanIntents.set(id, id === 5 ? W.normIntent({ auto: true }) : inp(id)); g.step(DT); }
  const s = g.summary();
  assert.ok(!JSON.stringify(Object.keys(s)).includes('auto') && !JSON.stringify(Object.keys(s)).includes('assist'));
  assert.ok(!/auto|assist/.test(src('server/progression.py').match(/strict_keys\(data, \([^)]*\)\)/)[0]), 'the server takes no such field');
});
