// v0.4.8.9 The Gauntlet: the nemesis system. Characters grow (rank, learned traits), regress (losing streaks, sitting
// out), remember (memories and generated lines), and the people you help or wrong come back as allies, betrayers and
// grudges. Pure and deterministic per seed.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/deck/index.js';
import { normWorld, topNemesis } from '../client/js/deck/nemesis.js';
import { TRAITS } from '../client/js/deck/foes.js';
import { playRun } from '../tools/deck_sim.mjs';

const P = { id: 't', name: 'T', stats: { stamina: 3, shooting: 3, defense: 3, health: 3 } };
const ch = (id, o = {}) => ({ id, name: 'N' + id.slice(3), rank: 0, traits: [], memories: [], record: { w: 0, l: 0 }, met: 1, last: 1, idle: 0, streak: 0, owes: 0, grudge: 0, turned: false, rel: {}, ...o });
const world = (...cs) => { const w = G.emptyWorld(7); for (const c of cs) w.chars[c.id] = c; return w; };
const after = (w, chars, seed = 1) => G.worldAfterRun(w, { chars }, seed);

test('grow: a character who beats you ranks up and learns how you play', () => {
  const { world: w, feed } = after(world(), [{ charId: 'ai-5', name: 'Rook Vance', result: 'lost', phase: 2, tag: 'Handle', kind: 'match' }]);
  const c = w.chars['ai-5'];
  assert.equal(c.rank, 1); assert.equal(G.rankName(c.rank), 'Contender');
  assert.ok(c.traits.includes('read_handle'), 'learned your crossover');
  assert.equal(c.record.w, 1);
  assert.equal(c.memories.at(-1).text, 'I sent you home in Phase 2.');
  assert.ok(feed.some(l => /Rook Vance/.test(l) && /Contender/.test(l)));
  // and it bites: Handle cards cost +1 against him
  const run = G.newRun({ seed: 3, player: P, world: w });
  const node = Object.values(run.map.phases[0].nodes).find(n => n.foes?.some(f => f.charId === 'ai-5')) || null;
  const f = { charId: 'ai-5', name: 'Rook', style: 'slasher', rank: c.rank, traits: c.traits };
  const { startMatch } = COMBAT;
  const m = startMatch(run, { id: 'x', kind: 'match', phase: 1, round: 0, foes: [f], rules: [] });
  m.hand = ['crossover', 'jumper'];
  assert.equal(G.handView(run)[0].cost, 2); assert.equal(G.handView(run)[1].cost, 1);
  assert.ok(node === null || node.foes[0].rank === 1);
  // ranks top out at Legend
  let w2 = w; for (let k = 0; k < 8; k++) w2 = after(w2, [{ charId: 'ai-5', result: 'lost', phase: 3, tag: 'Post' }], k).world;
  assert.equal(w2.chars['ai-5'].rank, 4); assert.equal(G.rankName(4), 'Legend');
  assert.ok(w2.chars['ai-5'].traits.length <= 4); assert.ok(w2.chars['ai-5'].memories.length <= 5);
});
import * as COMBAT from '../client/js/deck/combat.js';

test('survive: a Rival you went around may rank up and remembers it', () => {
  let ups = 0;
  for (let s = 1; s <= 40; s++) { const { world: w } = after(world(ch('ai-9')), [{ charId: 'ai-9', result: 'dodged', phase: 1, kind: 'rival' }], s); if (w.chars['ai-9'].rank === 1) { ups++; assert.match(w.chars['ai-9'].memories.at(-1).text, /ducked me in Phase 1/); } }
  assert.ok(ups > 10 && ups < 30, `${ups}/40`);
});

test('regress: two straight losses to you, or three runs sitting out, cost a rank or a trait', () => {
  let w = world(ch('ai-3', { rank: 2 }));
  w = after(w, [{ charId: 'ai-3', result: 'beat', phase: 1, tag: 'Handle', kind: 'match' }]).world;
  assert.equal(w.chars['ai-3'].rank, 2);
  assert.equal(w.chars['ai-3'].memories.at(-1).text, 'You broke my ankles in Phase 1.');
  const r = after(w, [{ charId: 'ai-3', result: 'beat', phase: 2, tag: 'Drive', kind: 'match' }]);
  assert.equal(r.world.chars['ai-3'].rank, 1);
  assert.equal(r.world.chars['ai-3'].memories.at(-1).text, 'You dunked on me in Phase 2.');
  assert.ok(r.feed.some(l => /keeps losing to you/.test(l)));
  // sitting out
  let w2 = world(ch('ai-4', { rank: 3, traits: ['iron_man'] })), dropped = false;
  for (let k = 0; k < 12 && !dropped; k++) { w2 = after(w2, [], k).world; dropped = w2.chars['ai-4'].rank < 3; }
  assert.ok(dropped, 'off the radar');
  // a Streetballer with no traits has nothing to lose
  let w3 = world(ch('ai-6')); for (let k = 0; k < 6; k++) w3 = after(w3, [], k).world; assert.equal(w3.chars['ai-6'].rank, 0);
});

test('wrong someone: a grudge, his friends join it, and he comes back stronger', () => {
  let w = world(ch('ai-1', { rel: { 'ai-2': 'friend' } }), ch('ai-2', { rel: { 'ai-1': 'friend' } }));
  w = after(w, [{ charId: 'ai-1', result: 'wronged', phase: 1 }]).world;
  assert.equal(w.chars['ai-1'].grudge, 1); assert.equal(w.chars['ai-2'].grudge, 1, 'he recruits his friends');
  assert.equal(w.chars['ai-2'].memories.at(-1).text, 'You did my boy wrong.');
  w = after(w, [{ charId: 'ai-1', result: 'wronged', phase: 2 }]).world;
  assert.ok(w.chars['ai-1'].traits.includes('vengeful'), 'grudge 2: vengeful');
  // grudges come looking for you: they show up on your bracket, mostly at Rival nodes
  let seen = 0, rival = 0;
  for (let s = 1; s <= 20; s++) {
    const run = G.newRun({ seed: s, player: P, world: w });
    for (const ph of run.map.phases) for (const n of Object.values(ph.nodes)) if (n.foes?.some(f => f.charId === 'ai-1')) { seen++; if (n.kind === 'rival') rival++; assert.ok(n.foes.find(f => f.charId === 'ai-1').traits.includes('vengeful')); }
  }
  assert.ok(seen >= 12, `seen ${seen}/20`); assert.ok(rival >= seen / 2);
});

test('help someone: he owes you, lends you a card in a match, or brings a gift', () => {
  let w = world(ch('ai-20'));
  w = after(w, [{ charId: 'ai-20', name: 'Ozzie Hale', result: 'helped', phase: 1 }]).world;
  assert.equal(w.chars['ai-20'].owes, 1); assert.equal(w.chars['ai-20'].memories.at(-1).text, 'You helped me at the sideline.');
  let lent = 0;
  for (let s = 1; s <= 10; s++) {
    const run = G.newRun({ seed: s, player: P, world: w });
    assert.deepEqual(run.plot.allies, ['ai-20']);
    const l = run.plot.lends.find(x => x.charId === 'ai-20');
    assert.ok(l && G.nodeOf(run, l.node), 'a match where he has your back');
    // play straight to that node: the card is in your hand
    const n = G.nodeOf(run, l.node);
    run.at = null; run.stage = 'map';
    const m = COMBAT.startMatch(run, n);
    assert.ok(m.hand.includes(l.card)); assert.equal(m.lent.charId, 'ai-20'); lent++;
    if (s === 1) { m.over = { won: true }; G.matchOver(run); assert.ok(run.outcomes.some(o => o.charId === 'ai-20' && o.result === 'lent')); }
  }
  assert.equal(lent, 10);
  // the debt gets paid down
  const w2 = after(w, [{ charId: 'ai-20', result: 'lent', phase: 1 }]).world;
  assert.equal(w2.chars['ai-20'].owes, 0); assert.match(w2.chars['ai-20'].memories.at(-1).text, /had your back/);
});

test('betray: a character you helped, whose rival holds a grudge on you, may switch sides at a boss', () => {
  const w = world(ch('ai-30', { owes: 2, rel: { 'ai-31': 'rival' } }), ch('ai-31', { grudge: 3, rel: { 'ai-30': 'rival' } }));
  let betrays = 0;
  for (let s = 1; s <= 20; s++) {
    const run = G.newRun({ seed: s, player: P, world: w });
    if (!run.plot.betray) continue;
    betrays++;
    const b = run.plot.betray, n = G.nodeOf(run, b.node);
    assert.equal(b.charId, 'ai-30'); assert.equal(n.kind, 'boss'); assert.ok(n.phase === 2 || n.phase === 3);
    assert.ok(b.line && !/undefined/.test(b.line));
  }
  assert.ok(betrays >= 12, `${betrays}/20 (80% expected)`);
  // without a grudge in the picture, a helped character almost never turns
  const w2 = world(ch('ai-30', { owes: 2 }));
  let b2 = 0; for (let s = 1; s <= 40; s++) if (G.newRun({ seed: s, player: P, world: w2 }).plot.betray) b2++;
  assert.ok(b2 <= 6, `${b2}/40`);
  // and afterwards the world knows
  const r = after(w, [{ charId: 'ai-30', result: 'betrayed', phase: 2 }]);
  assert.equal(r.world.chars['ai-30'].owes, 0); assert.equal(r.world.chars['ai-30'].turned, true);
  assert.match(r.world.chars['ai-30'].memories.at(-1).text, /switched sides/);
});

test('your highest-ranked Nemesis can take a phase boss\'s place, once a run', () => {
  const w = world(ch('ai-40', { rank: 3, traits: ['read_handle', 'iron_man'], record: { w: 3, l: 0 } }), ch('ai-41', { rank: 2 }));
  assert.equal(topNemesis(w), 'ai-40');
  let found = 0;
  for (let s = 1; s <= 30; s++) {
    const run = G.newRun({ seed: s, player: P, world: w });
    const bosses = run.map.phases.map(ph => Object.values(ph.nodes).find(n => n.kind === 'boss'));
    const nem = bosses.filter(b => b.boss === 'nemesis');
    assert.ok(nem.length <= 1);
    if (nem.length) { found++; assert.equal(nem[0].foes[0].charId, 'ai-40'); assert.ok(nem[0].phase <= 3); }
  }
  assert.ok(found >= 10, `${found}/30`);
  // he plays as a boss, with what he learned: Handle cards cost +1 and give him Stops
  const run = G.newRun({ seed: 1, player: P, world: w });
  const m = COMBAT.startMatch(run, { id: '2-12-0', kind: 'boss', phase: 2, round: 12, boss: 'nemesis', foes: [{ charId: 'ai-40', name: 'N40', style: 'big', rank: 3, traits: ['read_handle', 'iron_man'] }], rules: [] });
  assert.equal(m.opps[0].mv.readTag, 'Handle');
  m.hand = ['crossover']; m.energy = 5; const st = m.opps[0].stops;
  COMBAT.playCard(run, 0);
  assert.equal(m.energy, 3); assert.equal(m.opps[0].stops, st + 3);
  assert.equal(topNemesis(world(ch('ai-1', { rank: 2 }))), null, 'no Nemesis below rank 3');
});

test('remember: generated lines bring up shared history, deterministic, never empty', () => {
  const w = world(ch('ai-50', { rank: 2, memories: [{ k: 'beat', text: 'You broke my ankles in Phase 2.', run: 1, phase: 2 }], grudge: 0 }), ch('ai-51', { grudge: 2 }), ch('ai-52', { owes: 1 }));
  const lines = new Set();
  for (let s = 1; s <= 30; s++) {
    for (const sit of ['intro', 'win', 'lose', 'boss', 'ally', 'betray', 'help', 'wrong']) {
      const l = G.charLine(w, 'ai-50', sit, s);
      assert.ok(typeof l === 'string' && l.length > 3 && !/undefined|\{/.test(l), `${sit}: ${l}`);
      assert.equal(l, G.charLine(w, 'ai-50', sit, s));
      lines.add(l);
    }
  }
  assert.ok(lines.size > 15);
  assert.ok([...Array(20)].some((_, s) => /broke my ankles/.test(G.charLine(w, 'ai-50', 'intro', s))), 'his memory comes up before a match');
  assert.ok([...Array(20)].some((_, s) => /personal|owe me|forgotten|watching/.test(G.charLine(w, 'ai-51', 'intro', s))), 'a grudge shows');
  assert.ok(G.charLine(G.emptyWorld(1), 'ai-999', 'intro', 3).length > 3, 'a stranger still talks');
});

test('between runs the world ticks: characters train, feud and team up; a "word on the street" feed', () => {
  const w = world(ch('ai-60', { rank: 1, traits: ['hot_start'], rel: { 'ai-61': 'rival', 'ai-62': 'friend', 'ai-63': 'protege' } }), ch('ai-61', { rank: 1, rel: { 'ai-60': 'rival' } }),
    ch('ai-62', { rel: { 'ai-60': 'friend' } }), ch('ai-63', { rel: { 'ai-60': 'mentor' } }), ch('ai-64'), ch('ai-65'));
  const a = G.worldTick(w, 5), b = G.worldTick(w, 5);
  assert.deepEqual(a, b);
  assert.ok(a.feed.length >= 1 && a.feed.every(l => typeof l === 'string' && l.length > 5));
  let x = w; const all = [];
  for (let k = 0; k < 30; k++) { const r = G.worldTick(x, k); x = r.world; all.push(...r.feed); }
  assert.ok(all.some(l => /settled it/.test(l)), 'feuds'); assert.ok(all.some(l => /running together|tight now/.test(l)), 'team-ups'); assert.ok(all.some(l => /gym|after dark/.test(l)), 'training');
  assert.notDeepEqual(x.chars, w.chars);
  assert.ok(x.feed.length <= 12);
  assert.match(G.worldTick(G.emptyWorld(1), 1).feed[0], /Nobody knows your name/);
});

test('the stored world fits the server: aiSeed kept, ai-<n> ids, at most 120 characters and 64 KB', () => {
  assert.equal(G.emptyWorld(987654).aiSeed, 987654);
  const run = G.newRun({ seed: 4, player: P, world: G.emptyWorld(987654) });
  assert.ok(Object.keys(run.chars).every(id => /^ai-\d+$/.test(id)));
  // a world stuffed past every limit: long names, full memories, relationships
  const big = G.emptyWorld(5);
  for (let i = 0; i < 200; i++) big.chars['ai-' + i] = ch('ai-' + i, { name: 'X'.repeat(60), rank: i % 5, memories: Array.from({ length: 9 }, (_, k) => ({ k: 'beat', text: 'You broke my ankles in Phase 2. '.repeat(5), run: k, phase: 2 })), rel: { ['ai-' + ((i + 1) % 200)]: 'rival', ['ai-' + ((i + 2) % 200)]: 'friend' } });
  const clean = normWorld(big);
  assert.ok(Object.keys(clean.chars).length <= 120);
  const chars = Array.from({ length: 40 }, (_, i) => ({ charId: 'ai-' + (500 + i), name: 'New ' + i, result: i % 3 ? 'beat' : 'lost', phase: 2, tag: 'Post', kind: 'match' }));
  for (const w0 of [big, clean]) {
    const { world: w } = G.worldAfterRun(w0, { chars }, 9);
    const t = G.worldTick(w, 9).world;
    for (const x of [w, t]) {
      const ids = Object.keys(x.chars);
      assert.ok(ids.length <= 80, `${ids.length} characters`); assert.ok(ids.every(id => /^ai-\d+$/.test(id)));
      assert.ok(JSON.stringify(x).length <= 64 * 1024, `${JSON.stringify(x).length} bytes`);
      assert.equal(x.aiSeed, 5);
      for (const c of Object.values(x.chars)) for (const r of Object.keys(c.rel)) assert.ok(x.chars[r], 'no dangling relationships');
    }
    for (const c of Object.values(normWorld(w0).chars)) if (c.rank === 4) assert.ok(w.chars[c.id], 'the least relevant go first: every Legend is kept');
  }
});
test('a run\'s summary feeds the world; the stored world is cleaned on the way in', () => {
  const r = playRun(5, 'smart');
  const sum = G.runOver(r.run);
  const { world: w, feed } = G.worldAfterRun(G.emptyWorld(7), sum, 5);
  assert.deepEqual(G.worldAfterRun(G.emptyWorld(7), sum.summary, 5).world, w, 'runOver() or its .summary');
  assert.equal(w.runs, 1);
  const met = Object.values(w.chars);
  assert.ok(met.length >= 5 && met.every(c => c.name && !/^ai-/.test(c.name)));
  assert.ok(met.some(c => c.memories.length));
  assert.ok(Array.isArray(feed));
  const junk = normWorld({ aiSeed: 3, runs: -4, chars: { 'bad': {}, 'ai-1': { rank: 99, traits: ['nope', 'iron_man'], memories: [{ text: 5 }], rel: { 'ai-2': 'enemy', 'ai-3': 'friend' }, owes: 9 } }, feed: [1, 'ok'] });
  assert.deepEqual(Object.keys(junk.chars), ['ai-1']);
  assert.equal(junk.chars['ai-1'].rank, 4); assert.deepEqual(junk.chars['ai-1'].traits, ['iron_man']); assert.equal(junk.chars['ai-1'].owes, 3);
  assert.deepEqual(junk.chars['ai-1'].rel, {}, 'unknown kinds and people who aren\'t in the world are dropped'); assert.deepEqual(junk.feed, ['ok']); assert.equal(junk.runs, 0);
  for (const t of Object.values(TRAITS)) assert.ok(t.name && t.text);
});
