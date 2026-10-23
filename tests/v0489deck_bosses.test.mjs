// v0.4.8.9 The Gauntlet: the bosses. Each one's mechanic does what its text says, and every boss can be beaten by a
// good deck (the smart policy of tools/deck_sim.mjs playing a phase-appropriate deck).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/deck/index.js';
import { startMatch, playCard, endTurn, refreshSets, SHADOW as COMBAT_SHADOW } from '../client/js/deck/combat.js';
import { gainAbility } from '../client/js/deck/abilities.js';
import { BOSSES, BOSS_POOLS } from '../client/js/deck/bosses.js';
import { stream } from '../client/js/deck/rng.js';
import { playMatch } from '../tools/deck_sim.mjs';

// good decks for each phase: the starter thinned and upgraded a little, plus the cards a decent run picks up
const DECKS = {
  1: ['jumper+', 'jumper', 'jumper', 'closeout+', 'closeout', 'closeout', 'crossover+', 'outlet_pass', 'step_back_three', 'pull_up', 'rain_check', 'ice_screen', 'swagger', 'hand_in_face'],
  2: ['jumper+', 'jumper', 'closeout+', 'closeout', 'closeout', 'crossover+', 'outlet_pass+', 'step_back_three+', 'pull_up', 'rain_check+', 'shut_down', 'green_light', 'euro_step', 'skip_pass', 'tomahawk', 'ice_screen'],
  3: ['jumper+', 'closeout+', 'closeout', 'closeout', 'crossover+', 'outlet_pass+', 'step_back_three+', 'pull_up+', 'rain_check+', 'shut_down+', 'green_light+', 'euro_step', 'skip_pass', 'tomahawk+', 'paint_patrol', 'motion_offense', 'killer_cross', 'range_finder'],
};
DECKS[4] = [...DECKS[3], 'statement_dunk', 'd_mindset'];
const ABS = { 1: ['knee_pads'], 2: ['knee_pads', 'captains_band'], 3: ['knee_pads', 'captains_band', 'metronome'], 4: ['knee_pads', 'captains_band', 'metronome', 'max_contract'] };
const STATS = { stamina: 4, shooting: 4, defense: 4, health: 5 };

function bossRun(boss, phase, seed, { deck = DECKS[phase], abilities = ABS[phase], stats = STATS, world = null } = {}) {
  const run = G.newRun({ seed, player: { id: 't', name: 'T', stats }, world });
  run.deck = deck.slice(); for (const a of abilities) gainAbility(run, a);
  const n = boss === 'twin_towers' ? 2 : boss === 'dynasty' ? 3 : 1;
  const foes = Array.from({ length: n }, (_, k) => ({ charId: 'ai-' + (100 + k), name: 'Boss ' + k, style: 'big', rank: 0, traits: [] }));
  const node = { id: `${phase}-12-0`, kind: 'boss', phase, round: 12, foes, rules: [], boss };
  run.at = node.id; run.stage = 'match';
  startMatch(run, node);
  return run;
}
const hand = (run, refs, energy = 9) => { run.match.hand = refs.slice(); run.match.energy = energy; };
const play = (run, ref) => playCard(run, run.match.hand.indexOf(ref), 0);

test('there are 3 bosses a phase and 3 Finals, each with its own text', () => {
  const PARKS = ['overpass', 'longbeach', 'aau', 'rooftop', 'projects', 'riverside', 'warehouse', 'schoolyard', 'cage', 'rec', 'desert', 'market'];
  for (const id of Object.keys(BOSSES)) assert.ok(PARKS.includes(G.bossInfo(id).court), `${id}: a real Pro-Am park`);
  assert.equal(new Set([1, 2, 3, 4].flatMap(p => BOSS_POOLS[p]).map(b => G.bossInfo(b).court)).size, 12, 'each pool boss has its own park');
  for (const p of [1, 2, 3, 4]) { assert.equal(BOSS_POOLS[p].length, 3); for (const b of BOSS_POOLS[p]) { assert.equal(BOSSES[b].phase, p); assert.ok(BOSSES[b].text.length > 20); } }
  assert.equal(new Set(Object.values(BOSSES).map(b => b.title)).size, Object.keys(BOSSES).length);
});

test('every boss can be beaten by a good deck', () => {
  for (const p of [1, 2, 3, 4]) for (const b of BOSS_POOLS[p]) {
    let w = 0;
    for (let s = 1; s <= 6; s++) { const run = bossRun(b, p, s); if (playMatch(run, 'smart', stream(s, 'boss-test')).won) w++; }
    // (a phase boss falls to a good deck most of the time; a Final is the run's hardest fight, about even for a good
    // deck that wasn't built for him: The Shadow plays that deck back at you, ~75% inside real runs)
    assert.ok(w >= (p === 4 ? 3 : 4), `${b}: ${w}/6`);
  }
});

// play possessions out (no cards) until the ball is on that side
const until = (run, ball) => { for (let k = 0; k < 8 && run.match.ball !== ball && !run.match.over; k++) { hand(run, []); endTurn(run); } assert.equal(run.match.ball, ball); };
// your possession against nothing but his carried Stops
const open = run => { until(run, 'you'); for (const o of run.match.opps) { o.set = []; o.stops = 0; } refreshSets(run.match); };
test('the bosses\' mechanics, in possessions', () => {
  // The Wall: a basket that beats his Stops counts 10 at most, and he banks the rest as Stops for his next defense
  let run = bossRun('the_wall', 1, 1); open(run); hand(run, ['logo_three']);
  let o = run.match.opps[0], h = o.heart; play(run, 'logo_three');
  assert.equal(run.match.preview.o, 14 + 2); assert.equal(run.match.preview.points, 10);
  let ev = endTurn(run);
  assert.equal(h - o.heart, 10); assert.equal(o.stops, 14 + 2 - 10); assert.ok(ev.some(e => e.type === 'wall'));
  // Showtime: his own combo every third time he has the ball; on his fast break you can't read him
  run = bossRun('showtime', 1, 1); o = run.match.opps[0];
  assert.match(BOSSES.showtime.offense(run.match, o, null, 2).name, /combo/i); assert.equal(BOSSES.showtime.offense(run.match, o, null, 2).hits, 3);
  until(run, 'them'); assert.equal(run.match.foeSet.hidden, false);
  run.match.turnType = 'fast_break'; refreshSets(run.match); assert.equal(run.match.foeSet.hidden, true); assert.equal(run.match.foeSet.total, null);
  // Ref's Favorite: a Ticky-Tack Foul in your draw pile every time he gets the ball; his drives draw free throws
  run = bossRun('refs_favorite', 1, 1); until(run, 'you'); hand(run, []);
  const tt = r => [...r.match.drawPile, ...r.match.hand, ...r.match.discard].filter(x => x === 'ticky_tack').length, before = tt(run);
  endTurn(run); assert.equal(run.match.ball, 'them'); assert.equal(tt(run), before + 1);
  assert.ok(BOSSES.refs_favorite.cycle.some(mv => mv.foul && mv.hits === 3));
  // The Professor: copies your last card, with the ball and without; you see his total, not his card
  run = bossRun('professor', 2, 1); open(run); o = run.match.opps[0];
  hand(run, ['logo_three']); play(run, 'logo_three'); o.mv.offenseN = 0; endTurn(run);
  assert.equal(run.match.ball, 'them'); assert.match(o.set[0].name, /From the Logo/);
  assert.equal(run.match.foeSet.hidden, true); assert.equal(run.match.foeSet.total, run.match.preview.o); assert.ok(run.match.foeSet.total > 0, 'his total shows');
  assert.ok(run.match.foeSet.cards.every(c => c.hidden));
  hand(run, ['block_shot']); play(run, 'block_shot'); o.set = []; endTurn(run);
  assert.equal(run.match.ball, 'you'); assert.match(o.set[0].name, /Swat/); assert.ok(o.set[0].stops > 0);
  // Twin Towers: two players, one Heart
  run = bossRun('twin_towers', 2, 1); assert.equal(run.match.opps.length, 2); open(run);
  hand(run, ['jumper']); h = run.match.opps[0].heart; playCard(run, 0, 1); endTurn(run);
  assert.ok(run.match.opps[0].heart < h); assert.equal(run.match.opps[0].heart, run.match.opps[1].heart);
  // The Closer: Hot 3 below half, two hits a shot below a quarter
  run = bossRun('the_closer', 2, 1); run.match.you.hp = 1e6; o = run.match.opps[0]; open(run); o.heart = Math.floor(o.maxHeart / 2) + 3;
  hand(run, ['jumper']); play(run, 'jumper'); endTurn(run); assert.equal(o.status.hot, 3);
  open(run); o.heart = Math.floor(o.maxHeart / 4) + 3; hand(run, ['jumper']); play(run, 'jumper'); endTurn(run); assert.ok(o.mv.quarter);
  assert.equal(BOSSES.the_closer.hitsMult(run.match, o), 2);
  // The Enforcer: every Shot card costs you 1 Health
  run = bossRun('the_enforcer', 3, 1); until(run, 'you'); h = run.match.you.hp; hand(run, ['jumper']); play(run, 'jumper'); assert.equal(run.match.you.hp, h - 1);
  run = bossRun('the_enforcer', 3, 1); until(run, 'them'); h = run.match.you.hp; hand(run, ['closeout']); play(run, 'closeout'); assert.equal(run.match.you.hp, h);
  // The Press: a smaller hand, a first card at +1 unless it's a Pass, and a Pass breaks it
  run = bossRun('full_press', 3, 1); assert.equal(run.match.hand.length, 4);
  until(run, 'you'); hand(run, ['jumper', 'outlet_pass'], 3); assert.equal(G.handView(run)[0].cost, 2); assert.equal(G.handView(run)[1].cost, 0);
  play(run, 'outlet_pass'); assert.equal(run.match.energy, 4, 'the Pass breaks the press: +1 energy');
  // The Phenom: Hot every time he has the ball, more and more
  run = bossRun('the_phenom', 3, 1); run.match.you.hp = 1e6; o = run.match.opps[0];
  for (let k = 0; k < 20 && o.mv.offenseN < 4; k++) { hand(run, []); endTurn(run); }
  assert.equal(o.mv.offenseN, 4); assert.equal(o.status.hot, 1 + 2 + 2 + 3);
  // The Undisputed: a second half
  run = bossRun('undisputed', 4, 1); run.match.you.hp = 1e6; o = run.match.opps[0]; open(run); o.heart = 3; hand(run, ['jumper']); play(run, 'jumper'); endTurn(run);
  assert.ok(!run.match.over); assert.ok(o.mv.second); assert.equal(o.heart, o.maxHeart); assert.ok(o.status.hot >= 2);
  open(run); o.heart = 3; hand(run, ['jumper']); play(run, 'jumper'); endTurn(run); assert.ok(run.match.over?.won, 'only once');
  // The Dynasty: three of them; next man up
  run = bossRun('dynasty', 4, 1); assert.equal(run.match.opps.length, 3); open(run);
  run.match.opps[0].heart = 2; hand(run, ['jumper']); playCard(run, 0, 0); endTurn(run);
  assert.equal(run.match.opps[1].status.hot, 2); assert.ok(!run.match.over);
  // The Shadow: plays your own deck, and you can't read a thing
  run = bossRun('the_shadow', 4, 1); o = run.match.opps[0];
  assert.ok(o.set[0].cards.length === COMBAT_SHADOW.cards && o.set[0].cards.every(r => DECKS[4].includes(r)));
  assert.equal(run.match.foeSet.hidden, true); assert.equal(run.match.foeSet.total, null); assert.equal(run.match.preview.result, '?');
});

test('the betrayal joins the boss at his bad moment and takes back the lent card', () => {
  const run = bossRun('the_wall', 1, 1);
  const m = run.match;
  open(run);
  m.betray = { charId: 'ai-300', name: 'Turncoat', style: 'slasher', rank: 1, node: m.id, line: 'Nothing personal.', done: false };
  m.lent = { charId: 'ai-300', card: 'tomahawk+', name: 'Turncoat' };
  const o = m.opps[0]; o.heart = Math.floor(o.maxHeart / 2) + 2;
  hand(run, ['jumper', 'tomahawk+']);
  play(run, 'jumper');
  const ev = endTurn(run);
  assert.equal(m.opps.length, 2); assert.equal(m.opps[1].charId, 'ai-300');
  assert.ok(ev.some(e => e.type === 'betray' && /Nothing personal/.test(e.text)));
  assert.ok(![...m.hand, ...m.discard, ...m.drawPile].includes('tomahawk+'));
});
