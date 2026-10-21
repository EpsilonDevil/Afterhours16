// v0.4.8.7 quick patch 4: everyone at a park sees the real players' games while they're on. A player's own game (alone
// at the park when it began: the AI with him and against him) goes out as it's played (game/park.js LocalPub: every
// tick's input change, the auto-play switch, the Lock-In grade, a state hash every 2 s); the others play the very same
// game from it (ParkHub.localWatch / localStep), from its start when they arrive late. These play one game on "his
// screen" and on "a watcher's", through JSON as the server passes it on, and check they're the same tick for tick.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { spreadGreens } from '../client/js/sim/bots.js';
import { AIWorld } from '../client/js/sim/world.js';
import { DT } from '../client/js/sim/constants.js';
import { RNG } from '../client/js/core/rng.js';
import { LocalPub, ParkHub } from '../client/js/game/park.js';
import { MatchSession } from '../client/js/game/session.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
const T0 = Date.UTC(2026, 9, 21, 1, 0);
const world = new AIWorld({ seed: 99, born: T0 - 200 * 86400000 }, catalog);
const entries = ids => ids.map(id => ({ ...world.entry(id, T0), human: false }));
const makeGame = setup => { const g = new Game({ mode: 'park', full: !!setup.full, seed: setup.seed, rosters: structuredClone(setup.rosters), catalog, target: setup.target, surface: 'asphalt', difficulty: setup.difficulty, assist: setup.assist, greenBonus: setup.greenBonus, multi: false, inputDelay: 0 }); spreadGreens(g.players, catalog); return g; };
// the part of a session that changes a game (celebrations: the game's rng), as his screen and the watcher's both run it
const effects = g => ({ game: g, catalog, checkCelebrations: MatchSession.prototype.checkCelebrations, celebrationKind: MatchSession.prototype.celebrationKind, celebrationEffects: MatchSession.prototype.celebrationEffects, backgroundEvents() {} });

// his screen: a game with a stick that moves, buttons pressed now and then, ticks with no input, his auto-play switched
// on and off, his Lock-In grade moving; everything he'd send, collected as the server would pass it on
function play(n, seed = 7) {
  const me = { ...world.entry('ai-11', T0), human: true, name: 'ME' };
  const setup = { court: 0, full: true, seed: 4242, rosters: [[me, ...entries(['ai-12', 'ai-13'])], entries(['ai-14', 'ai-15', 'ai-16'])], teams: [{ abbr: 'YOU' }, { abbr: 'KNG' }], target: 11, difficulty: 0.6, assist: false, greenBonus: 1.1 };
  const sent = [], net = { send: m => { sent.push(JSON.parse(JSON.stringify(m))); return true; } };
  const pub = new LocalPub(net), g = makeGame(setup), fx = effects(g), r = new RNG(seed), hashes = [];
  pub.begin(setup);
  let realNow = performance.now, t = 0; performance.now = () => (t += 35); // (a message every few ticks)
  try {
    for (let k = 1; k <= n; k++) {
      if (k === 900) g.assist = true;
      if (k === 2400) g.assist = false;
      if (k % 300 === 0) g.lockIn = { id: g.human.id, idx: Math.round(r.next() * 1000) / 7 };
      const intent = r.next() < 0.1 ? null : { mx: Math.sin(k / 40) * 0.8 + r.next() * 0.01, mz: Math.cos(k / 55) * 0.7, sprint: r.next() < 0.3, shoot: r.next() < 0.01 ? 'press' : null, shootHeld: r.next() < 0.05, pass: r.next() < 0.01 ? 1 : null, face: r.next() < 0.5 ? null : r.next() * 6 - 3, call: false };
      hashes.push(g.stateHash());
      const it = pub.take(g, intent);
      if (it) g.setInput(it);
      g.step(DT);
      fx.celebrationEffects(g.events);
    }
    pub.stop();
  } finally { performance.now = realNow; }
  return { setup, sent, hashes, end: { score: g.score.join('-'), tick: g.tick, hash: g.stateHash() } };
}
// a watcher's screen: the park's own localWatch / localIn / localStep on a court, from the messages (from = whoever: tick k)
function watch(msgs, from = 0) {
  const P = Object.create(ParkHub.prototype), court = { origin: [0, 0, 0], full: true };
  P.courts = [court];
  const start = msgs.find(m => m.t === 'lstart'), lins = msgs.filter(m => m.t === 'lin');
  // (what the server hands someone arriving after `from` ticks: the setup and every tick so far, then the rest as it comes)
  const g = makeGame(start.setup), s = { game: g, ...effects(g), lw: { from: 'him', dec: { k: 0, it: {} }, recs: new Map(), maxK: 0, checked: 0, bad: 0 } };
  s.celebrationEffects = MatchSession.prototype.celebrationEffects; s.backgroundEvents = () => {};
  court.live = s;
  const early = lins.filter(m => m.k <= from).flatMap(m => m.b), late = lins.filter(m => m.k > from);
  P.localIn({ from: 'him', k: 1, b: early });
  for (const m of late) P.localIn({ from: 'him', ...m });
  const hashes = [];
  while (g.tick < s.lw.maxK) { hashes.push(g.stateHash()); P.localStep(s, []); }
  return { hashes, lw: s.lw, end: { score: g.score.join('-'), tick: g.tick, hash: g.stateHash() } };
}

test('a player\'s own game, watched: the same game tick for tick (auto-play, Lock-In, ticks with no input)', () => {
  const his = play(3600);
  assert.equal(his.sent[0].t, 'lstart');
  assert.equal(his.sent.at(-1).t, 'lstop');
  const lins = his.sent.filter(m => m.t === 'lin');
  for (let i = 1; i < lins.length; i++) assert.equal(lins[i].k, lins[i - 1].k + lins[i - 1].b.length, 'every tick once, in order');
  const w = watch(his.sent);
  assert.equal(w.hashes.length, his.hashes.length);
  const off = w.hashes.findIndex((h, i) => h !== his.hashes[i]);
  assert.equal(off, -1, `the same game (first difference at tick ${off + 1})`);
  assert.deepEqual(w.end, his.end);
  assert.ok(w.lw.checked >= 29 && w.lw.bad === 0, 'his state checks all agree');
  // bandwidth: what goes out for a minute of his game
  const bytes = lins.reduce((n, m) => n + JSON.stringify(m).length, 0), secs = 3600 / 60 / (1.15 * 1.0375 * 0.9815 * 0.9925 * 0.9625 * 1.025);
  console.log(`# ${Math.round(bytes / secs)} bytes/s, ${lins.length} messages for ${3600} ticks`);
  assert.ok(bytes / secs < 6000, 'a light stream (the stick moving every tick here: a few kB a second at most)');
});

test('arriving late: the game so far, then the rest: the same game', () => {
  const his = play(2000, 3);
  const w = watch(his.sent, 1500);
  assert.deepEqual(w.end, his.end);
  assert.equal(w.lw.bad, 0);
});
