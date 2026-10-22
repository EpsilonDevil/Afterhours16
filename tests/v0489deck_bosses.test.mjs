// v0.4.8.9 The Gauntlet: the bosses. Each one's mechanic does what its text says, and every boss can be beaten by a
// good deck (the smart policy of tools/deck_sim.mjs playing a phase-appropriate deck).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/deck/index.js';
import { startMatch, playCard, endTurn, SHADOW as COMBAT_SHADOW } from '../client/js/deck/combat.js';
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

test('the bosses\' mechanics', () => {
  // The Wall: hits over 10 are cut to 10, and he banks the rest as Stops
  let run = bossRun('the_wall', 1, 1); hand(run, ['logo_three']);
  let o = run.match.opps[0]; o.stops = 0; let h = o.heart; play(run, 'logo_three');
  assert.equal(h - o.heart, 10); assert.equal(o.stops, 14 + 2 - 10);
  // Showtime: his own combo every third turn
  run = bossRun('showtime', 1, 1);
  const kinds = [];
  for (let t = 0; t < 3; t++) { kinds.push(run.match.opps[0].intent.kind); hand(run, []); endTurn(run); }
  assert.equal(kinds[2], 'special'); assert.match(BOSSES.showtime.intent(run.match, run.match.opps[0], null, 3).name, /combo/i);
  // Ref's Favorite: a Ticky-Tack Foul in your draw pile every one of his turns
  run = bossRun('refs_favorite', 1, 1); hand(run, []); const before = run.match.drawPile.filter(r => r === 'ticky_tack').length + run.match.hand.filter(r => r === 'ticky_tack').length;
  endTurn(run);
  assert.ok([...run.match.drawPile, ...run.match.hand, ...run.match.discard].filter(r => r === 'ticky_tack').length >= before + 1);
  // The Professor copies your last card: his intent follows what you play
  run = bossRun('professor', 2, 1); hand(run, ['logo_three', 'block_shot']);
  play(run, 'logo_three'); assert.match(run.match.opps[0].intent.name, /From the Logo/);
  play(run, 'block_shot'); assert.match(run.match.opps[0].intent.name, /Swat/); assert.ok(run.match.opps[0].intent.stops > 0);
  // Twin Towers: two players, one Heart
  run = bossRun('twin_towers', 2, 1); assert.equal(run.match.opps.length, 2);
  hand(run, ['jumper']); h = run.match.opps[0].heart; run.match.opps.forEach(x => { x.stops = 0; }); playCard(run, 0, 1);
  assert.ok(run.match.opps[0].heart < h); assert.equal(run.match.opps[0].heart, run.match.opps[1].heart);
  // The Closer: Hot 3 below half, two hits a shot below a quarter
  run = bossRun('the_closer', 2, 1); o = run.match.opps[0]; o.stops = 0; o.heart = Math.floor(o.maxHeart / 2) + 3;
  hand(run, ['jumper']); play(run, 'jumper'); assert.equal(o.status.hot, 3);
  o.heart = Math.floor(o.maxHeart / 4) + 3; o.stops = 0; hand(run, ['jumper']); play(run, 'jumper'); assert.ok(o.mv.quarter); assert.equal(run.match.opps[0].intent.hits >= 2 || run.match.opps[0].intent.kind !== 'shoot', true);
  // The Enforcer: every Shot card costs you 1 Health
  run = bossRun('the_enforcer', 3, 1); h = run.match.you.hp; hand(run, ['jumper', 'closeout']); play(run, 'jumper'); assert.equal(run.match.you.hp, h - 1); play(run, 'closeout'); assert.equal(run.match.you.hp, h - 1);
  // The Press: a smaller hand, a first card at +1 unless it's a Pass, and a Pass breaks it
  run = bossRun('full_press', 3, 1); assert.equal(run.match.hand.length, 4);
  hand(run, ['jumper', 'outlet_pass'], 3); assert.equal(G.handView(run)[0].cost, 2); assert.equal(G.handView(run)[1].cost, 0);
  play(run, 'outlet_pass'); assert.equal(run.match.energy, 4, 'the Pass breaks the press: +1 energy');
  // The Phenom: Hot every turn
  run = bossRun('the_phenom', 3, 1); for (let t = 0; t < 4; t++) { hand(run, []); endTurn(run); } assert.equal(run.match.opps[0].status.hot, 1 + 2 + 2 + 3);
  // The Undisputed: a second half
  run = bossRun('undisputed', 4, 1); o = run.match.opps[0]; o.heart = 3; o.stops = 0; hand(run, ['jumper']); play(run, 'jumper');
  assert.ok(!run.match.over); assert.ok(o.mv.second); assert.equal(o.heart, o.maxHeart); assert.ok(o.status.hot >= 2);
  o.heart = 3; o.stops = 0; hand(run, ['jumper']); play(run, 'jumper'); assert.ok(run.match.over?.won, 'only once');
  // The Dynasty: three of them; next man up
  run = bossRun('dynasty', 4, 1); assert.equal(run.match.opps.length, 3);
  run.match.opps[0].heart = 2; run.match.opps[0].stops = 0; hand(run, ['jumper']); playCard(run, 0, 0);
  assert.equal(run.match.opps[1].status.hot, 2); assert.ok(!run.match.over);
  // The Shadow: plays your own deck
  run = bossRun('the_shadow', 4, 1); assert.ok(run.match.opps[0].queue[0].cards.length === COMBAT_SHADOW.cards && run.match.opps[0].queue[0].cards.every(r => DECKS[4].includes(r)));
});

test('the betrayal joins the boss at his bad moment and takes back the lent card', () => {
  const run = bossRun('the_wall', 1, 1);
  const m = run.match;
  m.betray = { charId: 'ai-300', name: 'Turncoat', style: 'slasher', rank: 1, node: m.id, line: 'Nothing personal.', done: false };
  m.lent = { charId: 'ai-300', card: 'tomahawk+', name: 'Turncoat' }; m.hand.push('tomahawk+');
  const o = m.opps[0]; o.stops = 0; o.heart = Math.floor(o.maxHeart / 2) + 2;
  hand(run, ['jumper', 'tomahawk+']); m.hand = ['jumper', 'tomahawk+'];
  const ev = play(run, 'jumper');
  assert.equal(m.opps.length, 2); assert.equal(m.opps[1].charId, 'ai-300');
  assert.ok(ev.some(e => e.type === 'betray' && /Nothing personal/.test(e.text)));
  assert.ok(!m.hand.includes('tomahawk+'));
});
