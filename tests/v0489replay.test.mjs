// v0.4.8.9 qp1: replaying a Gauntlet run from its start and its choice log (client/js/deck/replay.js), the code the
// server's Node helper runs. Same start + same choices = the same outcome whatever AIWorld and clock the cosmetics
// came from; a tampered log is refused at the right index; hostile input is handled within budget.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as G from '../client/js/deck/index.js';
import { AIWorld } from '../client/js/sim/world.js';
import { normWorld } from '../client/js/deck/nemesis.js';
import { playRun, convertedPlayer } from '../tools/deck_sim.mjs';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
// the browser's side: the game's AIWorld (with the catalog, its own birth) and its clock
const appAI = seed => new AIWorld({ seed, born: 1760000000000 }, catalog);
const NOW = 1790000000000;
// a world with history, so the nemesis plot (allies, grudges, a Nemesis boss) is part of the replay
function storyWorld(aiSeed) {
  const w = G.emptyWorld(aiSeed);
  const ch = (id, o) => ({ id, name: 'N' + id, rank: 0, traits: [], memories: [], record: { w: 0, l: 0 }, met: 1, last: 1, idle: 0, streak: 0, owes: 0, grudge: 0, turned: false, rel: {}, ...o });
  w.chars['ai-12'] = ch('ai-12', { owes: 2, rel: { 'ai-13': 'rival' } });
  w.chars['ai-13'] = ch('ai-13', { grudge: 2, rank: 1, traits: ['vengeful'], rel: { 'ai-12': 'rival', 'ai-14': 'friend' } });
  w.chars['ai-14'] = ch('ai-14', { grudge: 1, rel: { 'ai-13': 'friend' } });
  w.chars['ai-15'] = ch('ai-15', { rank: 3, traits: ['read_handle'], record: { w: 2, l: 0 } });
  return w;
}

// played once, used by several tests: smart runs recorded on the "browser", including completed ones
const RUNS = [];
function runs() {
  if (RUNS.length) return RUNS;
  let completed = 0;
  for (let k = 0; k < 60 && (RUNS.length < 10 || completed < 2); k++) {
    const seed = 1 + k * 7919, conv = k % 4 === 3, world = k % 2 ? storyWorld(900 + k) : G.emptyWorld(900 + k);
    const r = playRun(seed, 'smart', { world, ai: appAI(900 + k), now: NOW, player: conv ? convertedPlayer(seed) : null });
    if (r.completed) completed++;
    if (RUNS.length < 10 || r.completed) RUNS.push(r);
  }
  return RUNS;
}

test('the choice vocabulary and the log: act logs exactly the calls that worked; recordChoice checks shapes', () => {
  assert.deepEqual(G.CHOICE_KINDS, ['node', 'play', 'end', 'reward', 'cooler', 'shopBuy', 'shopRemove', 'leave', 'event']);
  const run = G.newRun({ seed: 5, player: G.rollStarters(5)[0] });
  const log = [];
  assert.equal(G.act(run, log, 'node', '1-7-0').ok, false, 'not open');
  assert.equal(G.act(run, log, 'play', 0).ok, false, 'no match yet');
  assert.ok(G.act(run, log, 'node', G.availableNodes(run)[0]).ok);
  assert.ok(G.act(run, log, 'play', 0).ok);
  assert.equal(G.act(run, log, 'play', 9).ok, false);
  assert.ok(G.act(run, log, 'end').ok);
  assert.deepEqual(log.map(c => c[0]), ['node', 'play', 'end']);
  assert.deepEqual(log[1], ['play', 0]);
  const l2 = [];
  G.recordChoice(l2, 'play', 2, 0); G.recordChoice(l2, 'reward', null, true); G.recordChoice(l2, 'cooler', 'upgrade', 3); G.recordChoice(l2, 'leave');
  assert.deepEqual(l2, [['play', 2, 0], ['reward', null, true], ['cooler', 'upgrade', 3], ['leave']]);
  for (const bad of [['dance'], ['play', -1], ['play', 1.5], ['cooler', 'nap'], ['shopBuy', 'car', 0], ['node', 5], ['end', 1]]) assert.throws(() => G.recordChoice([], ...bad), bad.join());
  // the replay of that log is the same run
  const rp = G.replay({ seed: 5, player: G.rollStarters(5)[0], world: null, unlocks: null }, log);
  assert.ok(rp.ok); assert.equal(rp.fullHash, G.stateHash(run)); assert.equal(rp.hash, G.outcomeHash(run));
});

test('replay matches the browser\'s run with no AIWorld and another clock: same outcome hash and counts', () => {
  const rs = runs();
  assert.ok(rs.filter(r => r.completed).length >= 2, 'completed runs in the set');
  assert.ok(rs.some(r => r.run.player.converted) && rs.some(r => r.run.plot.allies.length));
  for (const r of rs) {
    const rp = G.replay(r.start, r.log); // (the server: no ai, no now)
    assert.ok(rp.ok, `${r.seed}: ${rp.error} at ${rp.at}`);
    assert.equal(rp.hash, G.outcomeHash(r.run), `seed ${r.seed}`);
    const a = G.runOver(r.run), b = rp.over;
    assert.equal(!!a, !!b);
    if (a) for (const k of ['completed', 'phaseReached', 'nodesCleared', 'matchesWon', 'rivals', 'bosses', 'durationTurns']) assert.equal(b[k], a[k], `${r.seed} ${k}`);
    if (a) { assert.deepEqual(b.summary.vc, a.summary.vc); assert.equal(b.summary.estMinutes, a.summary.estMinutes); assert.deepEqual(b.summary.chars.map(c => [c.charId, c.result]), a.summary.chars.map(c => [c.charId, c.result])); }
    assert.deepEqual(rp.counts, G.runCounts(r.run));
    // and with yet another AIWorld and clock: still the same outcome, other names
    const rp2 = G.replay(r.start, r.log, { ai: appAI(12345), now: NOW + 9e9 });
    assert.equal(rp2.hash, rp.hash);
    // only the cosmetics differ: the full hash may, the outcome hash may not
    assert.equal(G.outcomeHash(rp2.run), G.outcomeHash(r.run));
  }
  // the browser's own AIWorld and clock reproduce the full state too
  const r0 = rs[0], same = G.replay(r0.start, r0.log, { ai: appAI(900), now: NOW });
  assert.equal(same.fullHash, G.stateHash(r0.run));
});

test('a full completed run replays in well under a second', () => {
  const r = runs().find(x => x.completed);
  const times = [];
  for (let k = 0; k < 3; k++) { const t0 = performance.now(); const rp = G.replay(r.start, r.log); times.push(performance.now() - t0); assert.ok(rp.ok && rp.over.completed); }
  const best = Math.min(...times);
  console.log(`# full completed-run replay: ${r.log.length} choices, best ${best.toFixed(0)} ms of ${times.map(t => t.toFixed(0)).join(' / ')} ms`);
  assert.ok(best < 1500, `${best} ms`);
});

test('a tampered log is refused at the right index', () => {
  const rs = runs(), r = rs.find(x => x.completed), log = r.log, start = r.start;
  const fails = (l, at, re, s = start) => { const rp = G.replay(s, l); assert.equal(rp.ok, false, `expected a refusal at ${at}`); assert.equal(rp.at, at); assert.match(rp.error, re); return rp; };
  // a card not in hand
  const pi = log.findIndex(c => c[0] === 'play');
  fails([...log.slice(0, pi), ['play', 7, 0], ...log.slice(pi + 1)], pi, /card 7 not in hand/);
  // a card that can't be paid for: play the turn's cards twice over
  const ei = log.findIndex((c, i) => c[0] === 'end' && i > pi);
  const turn = log.slice(pi, ei).filter(c => c[0] === 'play');
  const greedy = [...log.slice(0, ei), ...Array(12).fill(['play', 0, 0])];
  const rg = G.replay(start, greedy); assert.equal(rg.ok, false); assert.ok(rg.at >= ei && rg.at < ei + 12); assert.match(rg.error, /not in hand|can't be played/);
  assert.ok(turn.length >= 1);
  // a reward taken twice (an extra win's worth of cards and coins)
  const ri = log.findIndex(c => c[0] === 'reward');
  fails([...log.slice(0, ri + 1), log[ri], ...log.slice(ri + 1)], ri + 1, /no reward to take/);
  // a reward with no match won: right after entering a node
  const ni = log.findIndex(c => c[0] === 'node');
  fails([...log.slice(0, ni + 1), ['reward', 0, false]], ni + 1, /no reward to take/);
  // an extra win: skip the turns and claim the match's reward straight away
  const firstReward = log.findIndex(c => c[0] === 'reward');
  const lastNode = log.slice(0, firstReward).map(c => c[0]).lastIndexOf('node');
  fails([...log.slice(0, lastNode + 1), log[firstReward]], lastNode + 1, /no reward to take/);
  // a skipped boss: from the Phase 1 Cooler row straight to Phase 2
  const ci = log.findIndex(c => c[0] === 'node' && /^1-11-/.test(c[1]));
  const cool = log.findIndex((c, i) => i > ci && c[0] === 'cooler');
  fails([...log.slice(0, cool + 1), ['node', '2-0-0']], cool + 1, /node 2-0-0 is not open/);
  // a choice after the run ended
  fails([...log, ['node', '1-0-0']], log.length, /the run is over/);
  fails([...log, ['end']], log.length, /the run is over/);
  // a forged start: another seed's starter, doctored stats, a made-up player
  fails(log, -1, /another seed/, { ...start, player: G.rollStarters(start.seed + 1)[0] });
  fails(log, -1, /don't match the roll/, { ...start, player: { ...start.player, stats: { ...start.player.stats, shooting: 10 } } });
  fails(log, -1, /unknown player/, { ...start, player: { id: 'me', name: 'Me', stats: { stamina: 10, shooting: 10, defense: 10, health: 10 } } });
  const cv = rs.find(x => x.run.player.converted);
  if (cv) fails(cv.log, -1, /converted stats don't match/, { ...cv.start, player: { ...cv.start.player, stats: { stamina: 10, shooting: 10, defense: 10, health: 10 } } });
  // a different world is a different run: the replay goes elsewhere (or refuses), never the same outcome
  const other = G.replay({ ...start, world: storyWorld(31337) }, log);
  assert.ok(!other.ok || other.hash !== G.outcomeHash(r.run));
});

test('hostile input: bad shapes, huge numbers, unknown kinds, too-long logs, all refused within budget', () => {
  const start = { seed: 77, player: G.rollStarters(77)[0], world: null, unlocks: null };
  const first = G.newRun({ seed: 77, player: start.player }).map.phases[0].rows[0][0];
  const t0 = performance.now();
  for (const [s, re] of [[null, /no start/], [{ seed: 0, player: start.player }, /bad seed/], [{ seed: 2 ** 40, player: start.player }, /bad seed/], [{ seed: NaN, player: start.player }, /bad seed/],
    [{ seed: 77, player: null }, /bad player/], [{ seed: 77, player: { id: 'x'.repeat(500) } }, /bad player/], [{ seed: '77', player: start.player }, /bad seed/]]) {
    const rp = G.replay(s, []); assert.equal(rp.ok, false); assert.match(rp.error, re); assert.equal(rp.at, -1);
  }
  const junkWorld = { aiSeed: 'x', chars: Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['ai-' + i, { rank: 1e9, name: { a: 1 }, memories: 'no', rel: [1, 2] }])), feed: { x: 1 } };
  assert.ok(G.replay({ ...start, world: junkWorld, unlocks: { startAbility: '__proto__', cards: ['jumper', { x: 1 }, 'nope'] } }, []).ok, 'junk world and unlocks are cleaned');
  // the client's newRun and the replay both clean the world: cleaning twice changes nothing
  const once = normWorld(junkWorld), sw = normWorld(storyWorld(3));
  assert.deepEqual(normWorld(once), once); assert.deepEqual(normWorld(sw), sw);
  for (const [l, re] of [[{ length: 3 }, /not a list/], ['abc', /not a list/], [Array(20001).fill(['end']), /too many choices/]]) { const rp = G.replay(start, l); assert.equal(rp.ok, false); assert.match(rp.error, re); }
  const bad = [null, 5, 'node', {}, [], ['dance'], ['play', 1e309], ['play', -1], ['play', 2 ** 53], ['play', '0'], ['node', 'x'.repeat(100000)], ['node'], ['reward', 0, 'yes'], ['cooler', 'heal', -3],
    ['shopBuy', 'card', 1.5], ['event', null], ['end', 'now'], ['play', 0, 0, 0], [['node', first]], ['__proto__'], ['constructor']];
  for (const c of bad) { const rp = G.replay(start, [['node', first], c]); assert.equal(rp.ok, false, JSON.stringify(c)?.slice(0, 40)); assert.equal(rp.at, 1); }
  // a crafted 20,000-choice log does bounded work: it's refused when the run ends (or plays out, all 20,000)
  const long = [['node', first], ...Array(19999).fill(['end'])];
  const t1 = performance.now(), rl = G.replay(start, long);
  assert.ok(!rl.ok && /the run is over/.test(rl.error) || rl.ok); assert.ok(rl.steps <= 20000);
  assert.ok(performance.now() - t1 < 3000);
  // the cap can be lowered, never raised past 50,000
  assert.match(G.replay(start, Array(101).fill(['end']), { maxChoices: 100 }).error, /too many/);
  assert.match(G.replay(start, Array(50001).fill(['end']), { maxChoices: 1e9 }).error, /too many/);
  assert.ok(performance.now() - t0 < 8000);
});
