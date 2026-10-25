// v0.4.8.9 qp7: the hand max (docs/GAUNTLET.md §15.13). Five cards by default, held cards included; a possession
// draws up to the max and never past it; any other draw past it waits on resolveDraw (discard a hand card to take it,
// or refuse it: it goes to the discard pile), one card at a time, the rest queued behind; the raisers (Playbook,
// Superteam, Up-Tempo, Next Play, Motion Offense); both answers replay exactly. And the engine fuzz (tools/deck_fuzz.mjs):
// no exceptions, no stuck or silent turns, no NaN on screen, honest logs replay.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/deck/index.js';
import { startMatch, endTurn, playCard, refreshSets, resolveDraw, HAND_MAX, HAND_FULL } from '../client/js/deck/combat.js';
import { gainAbility } from '../client/js/deck/abilities.js';
import { playRun } from '../tools/deck_sim.mjs';
import { fuzz } from '../tools/deck_fuzz.mjs';

const P = (o = {}) => ({ id: 't', name: 'Tester', stats: { stamina: 3, shooting: 2, defense: 2, health: 3, ...o } });
const OFF = { kind: 'shoot', pts: 10, anim: 'jumper', name: 'Test shot' };
const DEF = { kind: 'defend', stops: 0, anim: 'contest', name: 'Stands there' };
function force(run, ball = 'you') {
  const m = run.match;
  m.ball = ball; m.phase = ball === 'you' ? 'offense' : 'defense'; m.turnType = m.phase;
  for (const o of m.opps) o.set = o.heart > 0 ? [{ ...(ball === 'you' ? o.pools.def[0] : o.pools.off[0]) }] : [];
  refreshSets(m);
  return run;
}
function arena({ rules = [], abilities = [], deck = Array(12).fill('jumper'), heart = 200, ball = 'you', boss = null } = {}) {
  const run = G.newRun({ seed: 9, player: P() });
  run.deck = deck.slice();
  for (const a of abilities) gainAbility(run, a);
  const m = startMatch(run, { id: 'arena', kind: 'match', phase: 1, round: 0, foes: [{ charId: 'ai-1', name: 'Opp', style: 'slasher', rank: 0, traits: [] }], rules, boss: null });
  for (const o of m.opps) { o.heart = o.maxHeart = heart; o.dmgK = 1; o.shooting = 0; o.defense = 0; o.cycle = true; o.pools = { off: [{ ...OFF }], def: [{ ...DEF }], ride: [] }; o.pools2 = null; if (boss) o.boss = boss; }
  if (ball) force(run, ball);
  return run;
}
const hand = (run, refs, energy = 9) => { run.match.hand = refs.slice(); run.match.energy = energy; refreshSets(run.match); };
const play = (run, ref) => { const i = run.match.hand.indexOf(ref); assert.ok(i >= 0, `${ref} in hand`); return playCard(run, i, 0); };

test('five cards by default; a possession draws up to the max, never past it; held cards count', () => {
  assert.equal(HAND_MAX, 5); assert.equal(G.HAND_MAX, 5);
  const r = arena({ ball: 'them' });
  assert.equal(r.match.handMax, 5); assert.equal(r.match.hand.length, 5); assert.equal(r.match.pendingDraw, null);
  // three Shots held through a defense: the next possession draws two
  hand(r, ['jumper', 'logo_three', 'pull_up']); endTurn(r);
  assert.equal(r.match.hand.length, 5); assert.ok(['jumper', 'logo_three', 'pull_up'].every(x => r.match.hand.includes(x)));
  assert.equal(r.match.pendingDraw, null, 'the possession\'s draw never asks');
  // a full hand of held cards: nothing new, and nothing asks
  const f = arena({ ball: 'them' }); hand(f, ['jumper', 'jumper', 'logo_three', 'pull_up', 'layup']); const d0 = f.match.drawPile.length; endTurn(f);
  assert.equal(f.match.hand.length, 5); assert.equal(f.match.drawPile.length + f.match.discard.length >= d0, true); assert.equal(f.match.pendingDraw, null);
  // the Press keeps every hand one short; Ankle Weights, the first one
  const p = arena({ abilities: ['ankle_weights'] }); assert.equal(p.match.hand.length, 4); assert.equal(p.match.handMax, 5);
  const run = G.newRun({ seed: 3, player: { id: 't', name: 'T', stats: { stamina: 4, shooting: 4, defense: 4, health: 5 } } });
  run.deck = Array(14).fill('jumper');
  const m = startMatch(run, { id: '3-12-0', kind: 'boss', phase: 3, round: 12, foes: [{ charId: 'ai-9', name: 'B', style: 'big', rank: 0, traits: [] }], rules: [], boss: 'full_press' });
  assert.equal(m.hand.length, 4); assert.equal(m.handMax, 5);
});

test('a draw past the max waits: discard a card to take it, or refuse it; nothing else can be played meanwhile', () => {
  const r = arena({ deck: Array(12).fill('pull_up') });
  hand(r, ['skip_pass', 'jumper', 'jumper', 'layup', 'layup']);
  const ev = play(r, 'skip_pass'); // (4 left: the first card fits, the second waits)
  const m = r.match, p = m.pendingDraw;
  assert.equal(m.hand.length, 5); assert.ok(p); assert.equal(p.ref, 'pull_up'); assert.equal(p.cardInfo.name, G.cardInfo('pull_up').name);
  assert.equal(p.remaining, 0); assert.equal(p.handMax, 5); assert.match(p.why, /Skip Pass/); assert.match(p.why, /full/);
  assert.ok(ev.some(e => e.type === 'draw'));
  // while it waits
  assert.deepEqual(G.canPlay(r, 0), { ok: false, why: HAND_FULL });
  const pc = playCard(r, 0, 0); assert.equal(pc.ok, false); assert.equal(pc.why, HAND_FULL); assert.equal(pc[0].type, 'invalid');
  const et = endTurn(r); assert.equal(et.ok, false); assert.equal(et.why, HAND_FULL); assert.equal(m.poss, m.poss);
  assert.ok(G.handView(r).every(h => !h.playable));
  // nonsense answers change nothing
  const h0 = G.stateHash(r);
  for (const bad of [{}, { discard: 5 }, { discard: -1 }, { discard: 1.5 }, { refuse: 'yes' }, null]) { const x = resolveDraw(r, bad); assert.equal(x.ok, false); }
  assert.equal(G.stateHash(r), h0);
  // discard: that card goes to the discard pile, the drawn one into your hand
  const out = m.hand[1], disc0 = m.discard.length;
  const res = resolveDraw(r, { discard: 1 });
  assert.equal(res.ok, true); assert.equal(m.pendingDraw, null); assert.equal(m.hand.length, 5);
  assert.ok(m.hand.includes('pull_up')); assert.equal(m.discard.length, disc0 + 1); assert.equal(m.discard[m.discard.length - 1], out);
  assert.ok(G.canPlay(r, 0).ok);
  // refuse: the drawn card goes to the discard pile, the hand stays
  const r2 = arena({ deck: Array(12).fill('pull_up') }); hand(r2, ['skip_pass', 'jumper', 'jumper', 'layup', 'layup']); play(r2, 'skip_pass');
  const before = r2.match.hand.slice(), res2 = resolveDraw(r2, { refuse: true });
  assert.equal(res2.ok, true); assert.deepEqual(r2.match.hand, before); assert.equal(r2.match.discard[r2.match.discard.length - 1], 'pull_up');
  assert.equal(resolveDraw(r2, { refuse: true }).ok, false, 'nothing waits now');
});

test('one card at a time: the rest of the draw, and any draw that comes meanwhile, wait behind it', () => {
  // a 6-card hand (over the max) playing a draw 2: both wait, one after the other
  const r = arena({ deck: Array(12).fill('pull_up') }); hand(r, ['skip_pass', 'jumper', 'jumper', 'layup', 'layup', 'layup']);
  play(r, 'skip_pass');
  assert.equal(r.match.pendingDraw.remaining, 1);
  resolveDraw(r, { refuse: true }); assert.equal(r.match.pendingDraw.remaining, 0);
  resolveDraw(r, { discard: 0 }); assert.equal(r.match.pendingDraw, null);
  // Flow's draw while a card waits: queued behind it
  const f = arena({ deck: Array(12).fill('pull_up') }); hand(f, ['crossover', 'outlet_pass', 'spin_move', 'jumper', 'jumper']);
  play(f, 'crossover'); play(f, 'outlet_pass'); assert.equal(f.match.pendingDraw, null);
  const ev = play(f, 'spin_move'); // (Handle, Pass, Drive: Flow; Spin Move draws 2 into a hand of 4)
  assert.ok(ev.some(e => e.type === 'flow')); assert.equal(f.match.pendingDraw.remaining, 1, 'Flow\'s card queued');
  // Make-It-Take-It's card comes on top of the new possession's full hand
  const k = arena({ rules: ['make_it_take_it'] }); hand(k, ['jumper']); play(k, 'jumper'); const ke = endTurn(k);
  assert.equal(k.match.ball, 'you'); assert.equal(k.match.hand.length, 5); assert.ok(k.match.pendingDraw); assert.match(k.match.pendingDraw.why, /Make-It-Take-It/);
  assert.ok(ke.some(e => e.type === 'possession') && ke.some(e => /Make-It-Take-It/.test(e.text)));
  // a match that ends with a card waiting: it goes to the discard pile, nothing waits
  const e = arena({ deck: Array(12).fill('pull_up'), boss: 'the_enforcer' }); e.match.you.hp = 1;
  hand(e, ['elbow_jumper', 'jumper', 'jumper', 'layup', 'layup', 'layup']); play(e, 'elbow_jumper');
  assert.deepEqual(e.match.over, { won: false }); assert.equal(e.match.pendingDraw, null); assert.ok(e.match.discard.includes('pull_up'));
});

test('raising the max for the match: Playbook, Superteam, Up-Tempo, Next Play, Motion Offense', () => {
  assert.equal(arena({ abilities: ['playbook'] }).match.handMax, 6);
  assert.equal(arena({ abilities: ['superteam'] }).match.handMax, 6);
  assert.equal(arena({ rules: ['up_tempo'] }).match.handMax, 6);
  assert.equal(arena({ abilities: ['playbook', 'superteam'], rules: ['up_tempo'] }).match.handMax, 8);
  const r = arena(); hand(r, ['next_play', 'next_play+']); play(r, 'next_play'); assert.equal(r.match.handMax, 6); play(r, 'next_play+'); assert.equal(r.match.handMax, 8);
  assert.match(G.cardInfo('next_play').text, /hand holds 1 more card/); assert.match(G.cardInfo('motion_offense').text, /hand holds 1 more card.*Draw 3/);
  // Motion Offense: +1 first, then its draw 3 into the room it made
  const mo = arena({ deck: Array(12).fill('pull_up') }); hand(mo, ['motion_offense', 'jumper', 'jumper', 'layup', 'layup']); play(mo, 'motion_offense');
  assert.equal(mo.match.handMax, 6); assert.equal(mo.match.hand.length, 6); assert.equal(mo.match.pendingDraw.remaining, 0, '4 + 2 fit, the third waits');
  // it's for the match: the next one starts at 5 again
  const run = G.newRun({ seed: 9, player: P() }); run.deck = Array(10).fill('jumper');
  const m1 = startMatch(run, { id: 'a', kind: 'match', phase: 1, round: 0, foes: [{ charId: 'ai-1', name: 'O', style: 'big', rank: 0, traits: [] }], rules: [] });
  m1.handMax = 9;
  const m2 = startMatch(run, { id: 'b', kind: 'match', phase: 1, round: 0, foes: [{ charId: 'ai-1', name: 'O', style: 'big', rank: 0, traits: [] }], rules: [] });
  assert.equal(m2.handMax, 5);
});

test('both answers replay exactly, and the answer is part of the run', () => {
  let found = { discard: 0, refuse: 0 }, checked = 0;
  for (const seed of [3, 11, 21, 40]) {
    const r = playRun(seed, 'smart');
    const draws = r.log.map((c, i) => [c, i]).filter(([c]) => c[0] === 'draw');
    for (const [c] of draws) found[c[1]]++;
    const rp = G.replay(r.start, r.log); assert.ok(rp.ok, rp.error); assert.equal(rp.hash, G.outcomeHash(r.run));
    if (!draws.length) continue;
    checked++;
    const [c, i] = draws[0];
    // the other answer is another run (or a refused log), never the same outcome
    const flip = c[1] === 'refuse' ? ['draw', 'discard', 0] : ['draw', 'refuse'];
    const alt = G.replay(r.start, [...r.log.slice(0, i), flip, ...r.log.slice(i + 1)]);
    assert.ok(!alt.ok || alt.hash !== rp.hash || alt.fullHash !== rp.fullHash, `seed ${seed}: the answer changed nothing`);
    // a play or an End Turn while it waits is refused at that index; so is an answer when nothing waits
    const p = G.replay(r.start, [...r.log.slice(0, i), ['end'], ...r.log.slice(i)]); assert.equal(p.ok, false); assert.equal(p.at, i); assert.match(p.error, /waiting/);
    const n = r.log.findIndex(x => x[0] === 'node');
    const q = G.replay(r.start, [...r.log.slice(0, n + 1), ['draw', 'refuse']]); assert.equal(q.ok, false); assert.equal(q.at, n + 1); assert.match(q.error, /no drawn card/);
  }
  assert.ok(checked >= 2, 'runs with draw answers');
  assert.ok(found.discard > 0 && found.refuse > 0, JSON.stringify(found));
  // the shape
  assert.equal(G.choiceShapeError(['draw', 'refuse']), null); assert.equal(G.choiceShapeError(['draw', 'discard', 2]), null);
  for (const bad of [['draw'], ['draw', 'discard'], ['draw', 'refuse', 0], ['draw', 'keep', 1], ['draw', 'discard', -1]]) assert.ok(G.choiceShapeError(bad), JSON.stringify(bad));
  assert.ok(G.CHOICE_KINDS.includes('draw'));
});

test('the engine fuzz: random play over seeded runs finds no freeze, no exception, no NaN, no stuck turn', async () => {
  for (const [mode, n] of [['replay', 120], ['stress', 120]]) {
    const r = await fuzz(n, 31, mode);
    assert.deepEqual(r.findings.map(f => `${f.what} (seeds ${f.seeds.join(', ')})`), [], mode);
    assert.ok(r.steps > n * 20, `${mode}: ${r.steps} choices`);
  }
  // (the seeds that once looked like matches that never end: 3,000 Health and a random player against a 14-Stop
  // defender; they're still decided, just slowly)
  for (const s of [14998688, 20526150, 38169682]) assert.deepEqual((await fuzz(1, 0, 'stress', s)).findings, [], `seed ${s}`);
});
