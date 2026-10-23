// v0.4.8.9 The Gauntlet: combat rules (energy, Stops, statuses, combos and Flow, Depth / Tight, Burn / Hold, Clutch,
// Mentalities), every match rule, and every ability's trigger, in possessions (qp4, GAUNTLET.md §15). Matches are
// built directly with a known deck, hand and opponent cards, and the possession is forced to the side under test, so
// each number is exact. A Shot's number is what it adds to your O this possession (run.match.preview.o).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/deck/index.js';
import { startMatch, endTurn, playCard, costOf, refreshSets } from '../client/js/deck/combat.js';
import { RULE_IDS } from '../client/js/deck/rules.js';
import { ABILITY_LIST, gainAbility } from '../client/js/deck/abilities.js';

const P = (o = {}) => ({ id: 't', name: 'Tester', stats: { stamina: 3, shooting: 2, defense: 2, health: 3, ...o } });
const OFF = { kind: 'shoot', pts: 10, anim: 'jumper', name: 'Test shot' };
const DEF = { kind: 'defend', stops: 0, anim: 'contest', name: 'Stands there' };
// the side of the ball under test: the possession, his committed card for it, the live clash
function force(run, ball = 'you', tt = null) {
  const m = run.match;
  m.ball = ball; m.phase = ball === 'you' ? 'offense' : 'defense'; m.turnType = tt || m.phase;
  if (ball === 'you' && !m.offN) m.offN = 1;
  for (const o of m.opps) o.set = o.heart > 0 ? [{ ...(ball === 'you' ? o.pools.def[0] : o.pools.off[0]) }] : [];
  refreshSets(m);
  return run;
}
// a match against one opponent who plays exactly `off` with the ball and `def` without it
function arena({ stats, rules = [], abilities = [], deck = Array(10).fill('jumper'), kind = 'match', foes, off = OFF, def = DEF, heart = 200, converted = false, ball = 'you' } = {}) {
  const run = G.newRun({ seed: 9, player: { ...P(stats), converted } });
  run.deck = deck.slice();
  for (const a of abilities) gainAbility(run, a);
  const node = { id: 'arena', kind, phase: 1, round: 0, foes: foes || [{ charId: 'ai-1', name: 'Opp', style: 'slasher', rank: 0, traits: [] }], rules, boss: null };
  const m = startMatch(run, node);
  for (const o of m.opps) { o.heart = o.maxHeart = heart; o.dmgK = 1; o.shooting = 0; o.defense = 0; o.cycle = true; o.pools = { off: [{ ...off }], def: [{ ...def }], ride: [] }; o.pools2 = null; }
  if (ball) force(run, ball);
  return run;
}
const hand = (run, refs, energy = 3) => { run.match.hand = refs.slice(); run.match.energy = energy; refreshSets(run.match); };
const play = (run, ref, ti = 0) => { const i = run.match.hand.indexOf(ref); assert.ok(i >= 0, `${ref} in hand`); return playCard(run, i, ti); };
const opp = run => run.match.opps[0];
// what a Shot adds to your number this possession
const dealt = (run, ref, setup = () => {}) => { setup(run); assert.equal(run.match.ball, 'you'); const o0 = run.match.preview.o; play(run, ref); return run.match.preview.o - o0; };
// what their possession takes off you
const taken = run => { assert.equal(run.match.ball, 'them'); const hp = run.match.you.hp; endTurn(run); return hp - run.match.you.hp; };

// ---------- energy ----------
test('energy comes from Stamina (3 / 4 / 5), cards cost it, it resets each possession', () => {
  for (const [s, e] of [[1, 3], [4, 3], [5, 4], [8, 4], [9, 5], [10, 5]]) assert.equal(arena({ stats: { stamina: s } }).match.maxEnergy, e, `stamina ${s}`);
  const run = arena();
  hand(run, ['jumper', 'jumper', 'jumper', 'jumper'], 3);
  play(run, 'jumper'); play(run, 'jumper'); play(run, 'jumper');
  assert.equal(run.match.energy, 0);
  const ev = play(run, 'jumper');
  assert.equal(ev[0].type, 'invalid'); assert.match(ev[0].text, /energy/i);
  hand(run, ['second_wind'], 0); play(run, 'second_wind');
  assert.equal(run.match.energy, 1, 'Second Wind: +1 energy now');
  assert.ok(run.match.burned.includes('second_wind'), 'and it burns');
  endTurn(run);
  assert.equal(run.match.energy, 3);
});

// ---------- Shots, Stops ----------
test('Shooting adds ⌊stat/2⌋ to every Shot hit, Defense ⌊stat/2⌋ to every Defense card', () => {
  for (const [s, pts] of [[1, 6], [2, 7], [5, 8], [10, 11]]) { const run = arena({ stats: { shooting: s } }); hand(run, ['jumper']); assert.equal(dealt(run, 'jumper'), pts, `shooting ${s}`); }
  const r2 = arena({ stats: { shooting: 4 } }); hand(r2, ['rain_check']); assert.equal(dealt(r2, 'rain_check'), 3 * (3 + 2), 'each of 3 hits');
  for (const [d, st] of [[1, 5], [3, 6], [8, 9]]) { const run = arena({ stats: { defense: d }, ball: 'them' }); hand(run, ['closeout']); play(run, 'closeout'); assert.equal(run.match.you.stops, st, `defense ${d}`); }
  const r3 = arena({ stats: { defense: 8 } }); hand(r3, ['putback']); play(r3, 'putback'); assert.equal(r3.match.you.stops, 3, 'a Shot that gives Stops gets no Defense bonus');
});

test('the clash: their points minus your Stops; Hustle Stops last a possession; Stops gained with the ball wait for your defense', () => {
  const run = arena({ stats: { defense: 2 }, ball: 'them' }); // Closeout: 6
  hand(run, ['closeout']); play(run, 'closeout');
  assert.deepEqual(run.match.preview, { o: 10, d: 6, result: 'score', points: 4 });
  const hp = run.match.you.hp;
  const ev = endTurn(run);
  const shot = ev.find(e => e.type === 'shot' && e.actor === 0);
  assert.equal(shot.stops, 6); assert.equal(shot.points, 4); assert.equal(run.match.you.hp, hp - 4);
  assert.deepEqual(ev.find(e => e.type === 'clash'), { ...ev.find(e => e.type === 'clash'), o: 10, d: 6, winner: 'offense' });
  assert.deepEqual(run.match.score, [0, 4]);
  // leftover Stops are gone after the defense, Hustle Stops stay to the next one
  const r2 = arena({ ball: 'them' });
  hand(r2, ['closeout', 'ice_screen']); play(r2, 'closeout'); play(r2, 'ice_screen');
  assert.equal(r2.match.you.stops, 6 + 7);
  endTurn(r2); // (10 into 13: stopped; you have more Hustle on the boards: your ball)
  assert.equal(r2.match.ball, 'you');
  assert.equal(r2.match.you.stops, 7, 'only the Hustle Stops carry over');
  hand(r2, []); endTurn(r2); // (no shot: a turnover)
  assert.equal(r2.match.ball, 'them'); assert.equal(r2.match.you.stops, 7, 'still there on the next defense');
  hand(r2, []); assert.equal(taken(r2), 3, '10 into 7');
  assert.equal(r2.match.you.stops, 0, 'and gone after it');
  // his Stops soak your Shots
  const r3 = arena({ def: { kind: 'defend', stops: 5, anim: 'contest' } });
  assert.equal(r3.match.preview.d, 5);
  hand(r3, ['jumper']); play(r3, 'jumper');
  assert.equal(r3.match.preview.points, 2, '7 points, 5 into his Stops');
  const h = opp(r3).heart; endTurn(r3); assert.equal(h - opp(r3).heart, 2);
  // Stops you gain with the ball (a Putback) are there when they have it
  const r4 = arena(); hand(r4, ['putback']); play(r4, 'putback'); endTurn(r4);
  assert.equal(r4.match.ball, 'them'); assert.equal(r4.match.preview.d, 3);
});

// ---------- statuses ----------
test('Exposed ×1.5, Cold ×0.75, Gassed ×0.75 Stops, Hot +n a hit; they count down at the end of the possessions they matter in', () => {
  let run = arena(); hand(run, ['crossover', 'jumper']); play(run, 'crossover');
  assert.equal(opp(run).status.exposed, 1);
  assert.equal(dealt(run, 'jumper'), Math.floor(7 * 1.5));
  endTurn(run); assert.ok(!opp(run).status.exposed, 'gone after he defends');
  run = arena(); run.match.you.status.cold = 1; hand(run, ['jumper']); assert.equal(dealt(run, 'jumper'), Math.floor(7 * 0.75));
  endTurn(run); assert.ok(!run.match.you.status.cold, 'your Cold goes after you shoot');
  run = arena({ ball: 'them' }); run.match.you.status.gassed = 1; hand(run, ['closeout']); play(run, 'closeout'); assert.equal(run.match.you.stops, Math.floor(6 * 0.75));
  run = arena(); run.match.you.status.hot = 2; hand(run, ['rain_check']); assert.equal(dealt(run, 'rain_check'), 3 * (3 + 1 + 2));
  // his statuses: Cold cuts his shot, your Exposed raises it
  run = arena({ ball: 'them' }); opp(run).status.cold = 1; refreshSets(run.match); hand(run, []); assert.equal(taken(run), Math.floor(10 * 0.75));
  run = arena({ ball: 'them' }); run.match.you.status.exposed = 2; refreshSets(run.match); hand(run, []); assert.equal(taken(run), 15);
  assert.equal(run.match.you.status.exposed, 1, 'yours count down at the end of your defense');
  run = arena({ ball: 'them' }); opp(run).set.push({ kind: 'debuff', you: { cold: 2 }, anim: 'crossover', rider: true }); hand(run, []); endTurn(run);
  assert.equal(run.match.you.status.cold, 2, 'his set\'s debuff lands after the possession');
});

// ---------- combos and Flow ----------
test('Combo X: the bonus applies when the last card played this possession has tag X', () => {
  let run = arena(); hand(run, ['crossover', 'step_back_three'], 3);
  play(run, 'crossover'); opp(run).status = {}; // (no Exposed in the way)
  assert.equal(dealt(run, 'step_back_three'), 7 + 6 + 1, 'Step-Back Three +6 after a Handle card');
  run = arena(); hand(run, ['jumper', 'step_back_three']); play(run, 'jumper');
  assert.equal(dealt(run, 'step_back_three'), 7 + 1, 'not after a Perimeter card');
  run = arena(); hand(run, ['outlet_pass', 'alley_oop']); play(run, 'outlet_pass');
  assert.equal(dealt(run, 'alley_oop'), (6 + 1) * 2, 'Alley-Oop doubles after a Pass');
  // the combo looks at the last card only, and only this possession
  run = arena(); hand(run, ['crossover', 'jumper', 'step_back_three']); play(run, 'crossover'); play(run, 'jumper'); opp(run).status = {};
  assert.equal(dealt(run, 'step_back_three'), 8);
  run = arena(); hand(run, ['crossover'], 3); play(run, 'crossover'); endTurn(run); force(run, 'you'); hand(run, ['step_back_three']); opp(run).status = {};
  assert.equal(dealt(run, 'step_back_three'), 8, 'a new possession starts a new chain');
});

test('Flow: three different tags in one possession: +1 energy and draw 1, once a possession', () => {
  const run = arena();
  hand(run, ['crossover', 'outlet_pass', 'jumper', 'jumper', 'outlet_pass', 'jumper'], 3);
  play(run, 'crossover'); play(run, 'outlet_pass');
  const e = run.match.energy, h = run.match.hand.length;
  const ev = play(run, 'jumper');
  assert.ok(ev.some(x => x.type === 'flow'));
  assert.equal(run.match.energy, e - 1 + 1); assert.equal(run.match.hand.length, h - 1 + 1);
  play(run, 'jumper'); play(run, 'outlet_pass');
  const ev2 = play(run, 'jumper');
  assert.ok(!ev2.some(x => x.type === 'flow'), 'once per possession');
  // Extra Pass counts as every tag for the chain
  const r2 = arena(); hand(r2, ['extra_pass', 'jumper'], 3); play(r2, 'extra_pass');
  assert.ok(play(r2, 'jumper').some(x => x.type === 'flow'));
});

// ---------- deck size ----------
test('Depth cards scale with deck size past 10; Tight cards get their bonus at 12 cards or fewer', () => {
  const bench = n => { const run = arena({ deck: Array(n).fill('jumper') }); hand(run, ['bench_shooter']); return dealt(run, 'bench_shooter'); };
  assert.equal(bench(10), 5 + 1); assert.equal(bench(14), 5 + 2 + 1); assert.equal(bench(22), 5 + 6 + 1);
  const floater = n => { const run = arena({ deck: Array(n).fill('jumper') }); hand(run, ['floater']); return dealt(run, 'floater'); };
  assert.equal(floater(12), 7 + 4 + 1); assert.equal(floater(13), 7 + 1);
  const wall = n => { const run = arena({ deck: Array(n).fill('jumper'), ball: 'them' }); hand(run, ['wall_up']); play(run, 'wall_up'); return run.match.you.stops; };
  assert.equal(wall(10), 5 + 1); assert.equal(wall(18), 5 + 4 + 1);
});

// ---------- keywords ----------
test('Burn, Hold, Fatigue, Clutch and Mentalities', () => {
  let run = arena(); run.match.you.hp = 20; hand(run, ['tape_job', 'bank_shot', 'heavy_legs', 'jumper']);
  play(run, 'tape_job');
  assert.equal(run.match.you.hp, 26, 'Tape Job heals 6'); assert.ok(run.match.burned.includes('tape_job'));
  assert.equal(play(run, 'heavy_legs')[0].type, 'invalid');
  endTurn(run);
  assert.ok(run.match.hand.includes('bank_shot'), 'Hold stays'); assert.ok(!run.match.hand.includes('heavy_legs') || run.match.hand.filter(r => r === 'heavy_legs').length <= 1);
  run = arena(); hand(run, ['dagger']); assert.equal(dealt(run, 'dagger'), 8);
  run = arena(); run.match.you.hp = Math.floor(run.match.you.maxHp / 2); hand(run, ['dagger']); assert.equal(dealt(run, 'dagger'), 16, 'Clutch doubles at half Health');
  run = arena(); hand(run, ['green_light', 'jumper', 'layup'], 3); play(run, 'green_light');
  assert.ok(!run.match.discard.includes('green_light') && run.match.powers.length === 1, 'a Mentality stays in play');
  assert.equal(dealt(run, 'jumper'), 7 + 2); assert.equal(dealt(run, 'layup'), 6 + 1, 'only Perimeter');
  endTurn(run); force(run, 'you'); hand(run, ['jumper']); assert.equal(dealt(run, 'jumper'), 9, 'all match');
  run = arena(); run.match.hand = ['cramp']; const hp = run.match.you.hp; endTurn(run);
  assert.equal(hp - run.match.you.hp, 2, 'Cramp bites in your hand');
  run = arena({ deck: Array(10).fill('ticky_tack') }); assert.equal(run.match.energy, 0, 'Ticky-Tack Fouls cost energy when drawn');
});

test('their committed set shows before you play, matching what it does; the match ends both ways', () => {
  const run = arena({ heart: 8, ball: 'them' });
  const fs = run.match.foeSet;
  assert.equal(fs.hidden, false); assert.equal(fs.total, 10); assert.equal(fs.side, 'offense');
  assert.equal(fs.cards[0].name, 'Test shot'); assert.equal(fs.cards[0].kind, 'shot'); assert.equal(fs.cards[0].value, 10); assert.equal(fs.cards[0].anim, 'jumper'); assert.deepEqual(fs.cards[0].tags, ['Perimeter']);
  assert.equal(opp(run).intent.kind, 'shoot'); assert.equal(opp(run).intent.value, 10); assert.match(opp(run).intent.text, /Shoots 10/);
  hand(run, []); assert.equal(taken(run), 10, 'what it showed');
  force(run, 'you'); hand(run, ['jumper', 'jumper']); play(run, 'jumper'); play(run, 'jumper');
  assert.equal(run.match.over, null, 'nothing lands before End Turn');
  const ev = endTurn(run);
  assert.deepEqual(run.match.over, { won: true }); assert.equal(ev[ev.length - 1].type, 'end');
  const mo = G.matchOver(run);
  assert.equal(mo.won, true); assert.equal(mo.reward.cards.length, 3); assert.ok(mo.reward.coins > 0);
  const r2 = arena({ off: { kind: 'shoot', pts: 500, anim: 'dunk' }, ball: 'them' });
  hand(r2, []); endTurn(r2);
  assert.deepEqual(r2.match.over, { won: false });
  assert.equal(G.matchOver(r2).won, false); assert.ok(r2.over); assert.equal(G.runOver(r2).completed, false);
});

// ---------- every match rule ----------
const NOSHOT = { kind: 'shoot', pts: 0, anim: 'jumper', name: 'Holds it' };
const RULE_TESTS = {
  make_it_take_it: () => {
    const r = arena({ rules: ['make_it_take_it'] }); hand(r, ['jumper']); play(r, 'jumper'); const ev = endTurn(r);
    assert.equal(r.match.ball, 'you', 'you scored: your ball again'); assert.ok(ev.some(e => /Make-It-Take-It/.test(e.text)));
    const r2 = arena({ rules: ['make_it_take_it'], ball: 'them' }); hand(r2, []); endTurn(r2); assert.equal(r2.match.ball, 'them', 'and his');
  },
  threes_double: () => { const r = arena({ rules: ['threes_double'], off: { kind: 'shoot', pts: 10, anim: 'three' } }); hand(r, ['jumper', 'layup']); assert.equal(dealt(r, 'jumper'), Math.floor(7 * 1.5)); assert.equal(dealt(r, 'layup'), 7); force(r, 'them'); hand(r, []); assert.equal(taken(r), 15); },
  shot_clock: () => {
    const r = arena({ rules: ['shot_clock'], off: NOSHOT, ball: 'them' }); hand(r, []); const hp = r.match.you.hp; endTurn(r); assert.equal(r.match.you.hp, hp, 'no clock on defense');
    force(r, 'you'); hand(r, []); const ev = endTurn(r); assert.equal(r.match.you.hp, hp - 3); assert.equal(r.match.ball, 'them', 'and the ball'); assert.ok(ev.some(e => /Shot Clock/.test(e.text)));
    force(r, 'you'); hand(r, ['jumper']); play(r, 'jumper'); endTurn(r); assert.equal(r.match.you.hp, hp - 3, 'a Shot beats it');
  },
  physical: () => {
    const r = arena({ rules: ['physical'] }); hand(r, ['jumper', 'layup']); assert.equal(dealt(r, 'jumper'), 6);
    const r1 = arena({ rules: ['physical'] }); hand(r1, ['layup']); play(r1, 'layup'); const ev = endTurn(r1);
    const s = ev.find(e => e.type === 'shot'); assert.equal(s.how, 'and_one'); assert.ok(ev.some(e => e.type === 'foul')); assert.equal(ev.find(e => e.type === 'ft').points, 1, 'a Drive shot draws the whistle');
    const r2 = arena({ rules: ['physical'], ball: 'them' }); hand(r2, ['closeout']); play(r2, 'closeout'); assert.equal(r2.match.you.stops, 8);
    const r3 = arena({ rules: ['physical'], ball: 'them' }); hand(r3, []); assert.equal(taken(r3), 9);
  },
  win_by_2: () => {
    const r = arena({ rules: ['win_by_2'], heart: 5 }); hand(r, ['jumper']); play(r, 'jumper'); endTurn(r); assert.equal(opp(r).heart, 1 + Math.round(5 * 0.2)); assert.ok(!r.match.over);
    const r2 = arena({ rules: ['win_by_2'], heart: 5 }); hand(r2, ['jumper', 'jumper']); play(r2, 'jumper'); play(r2, 'jumper'); endTurn(r2); assert.ok(r2.match.over?.won, 'only once');
  },
  no_timeouts: () => { const r = arena({ rules: ['no_timeouts'] }); r.match.you.hp = 10; hand(r, ['tape_job']); play(r, 'tape_job'); assert.equal(r.match.you.hp, 10); },
  run_and_gun: () => { const r = arena({ rules: ['run_and_gun'] }); assert.equal(r.match.maxEnergy, 4); hand(r, ['jumper']); assert.equal(dealt(r, 'jumper'), 9); force(r, 'them'); hand(r, []); assert.equal(taken(r), 12); },
  old_school: () => { const r = arena({ rules: ['old_school'] }); hand(r, ['green_light']); assert.equal(play(r, 'green_light')[0].type, 'invalid'); },
  home_crowd: () => { const r = arena({ rules: ['home_crowd'] }); assert.equal(r.match.you.status.hot, 1); },
  hostile_crowd: () => { const r = arena({ rules: ['hostile_crowd'] }); assert.equal(r.match.you.status.cold, 1); },
  and_one_night: () => { const r = arena({ rules: ['and_one_night'] }); hand(r, ['jumper', 'jumper']); assert.equal(dealt(r, 'jumper'), 10); assert.equal(dealt(r, 'jumper'), 7); },
  ball_movement: () => { const r = arena({ rules: ['ball_movement'] }); hand(r, ['skip_pass', 'skip_pass']); assert.equal(costOf(r.match, 'skip_pass'), 0); play(r, 'skip_pass'); assert.equal(costOf(r.match, 'skip_pass'), 1); },
  up_tempo: () => { const r = arena({ rules: ['up_tempo'] }); assert.equal(r.match.hand.length, 6); force(r, 'them'); hand(r, []); assert.equal(taken(r), 11); },
  short_game: () => { const r = arena({ rules: ['short_game'], ball: 'them' }); hand(r, []); assert.equal(taken(r), 12); },
  no_blood: () => { const r = arena({ rules: ['no_blood'], deck: [...Array(6).fill('heavy_legs'), ...Array(6).fill('jumper')] }); assert.ok(r.match.hand.every(x => x === 'jumper')); assert.ok(r.match.burned.includes('heavy_legs')); },
  windy: () => { const r = arena({ rules: ['windy'] }); hand(r, ['jumper', 'layup']); assert.equal(dealt(r, 'jumper'), 5); assert.equal(dealt(r, 'layup'), 9); },
  king_court: () => { const r = arena({ rules: ['king_court'] }); r.match.over = { won: true }; const a = G.matchOver(r).reward.coins; const r2 = arena(); r2.match.over = { won: true }; const b = G.matchOver(r2).reward.coins; assert.equal(a, Math.round(b * 1.5)); },
  overtime: () => {
    const r = arena({ rules: ['overtime'], off: { kind: 'shoot', pts: 1, anim: 'jumper' } });
    hand(r, ['jumper']); assert.equal(dealt(r, 'jumper'), 7, 'not yet');
    for (let k = 0; k < 8; k++) { hand(r, []); endTurn(r); }
    assert.equal(r.match.turn, 9); force(r, 'you'); opp(r).stops = 0; hand(r, ['jumper']); assert.equal(dealt(r, 'jumper'), 10, 'the 9th possession on');
  },
  tight_whistle: () => {
    const r = arena({ rules: ['tight_whistle'] }); hand(r, ['crossover']); play(r, 'crossover'); assert.ok(!opp(r).status.exposed);
    const r2 = arena({ rules: ['tight_whistle', 'physical'] }); hand(r2, ['layup']); play(r2, 'layup'); assert.ok(!endTurn(r2).some(e => e.type === 'foul'), 'and no whistles');
  },
  deep_bench: () => { const r = arena({ rules: ['deep_bench'], deck: Array(10).fill('jumper') }); hand(r, ['bench_shooter', 'floater']); assert.equal(dealt(r, 'bench_shooter'), 5 + 4 + 1); assert.equal(dealt(r, 'floater'), 8, 'nothing is Tight'); },
  half_court: () => { const r = arena({ rules: ['half_court'], deck: Array(30).fill('jumper') }); hand(r, ['bench_shooter', 'floater']); assert.equal(dealt(r, 'bench_shooter'), 6); assert.equal(dealt(r, 'floater'), 12, 'always Tight'); },
  trash_talk: () => {
    const r = arena({ rules: ['trash_talk'] }); hand(r, ['jumper']); play(r, 'jumper'); endTurn(r); assert.ok(!r.match.you.status.hot, '7 is not enough');
    const r2 = arena({ rules: ['trash_talk'] }); hand(r2, ['jumper', 'jumper']); play(r2, 'jumper'); play(r2, 'jumper'); endTurn(r2); assert.equal(r2.match.you.status.hot, 1, '14 in a possession');
  },
};
test('every match rule applies', () => {
  assert.ok(RULE_IDS.length >= 18 && RULE_IDS.length <= 24);
  for (const id of RULE_IDS) { assert.ok(RULE_TESTS[id], `a test for ${id}`); RULE_TESTS[id](); }
  // short game: 25% less Heart (on the real Heart, before the arena overrides it); king of the court: 20% more
  const run = G.newRun({ seed: 9, player: P() });
  const node = r => ({ id: 'x', kind: 'match', phase: 1, round: 0, foes: [{ charId: 'ai-1', name: 'O', style: 'big', rank: 0, traits: [] }], rules: r });
  const h0 = startMatch(run, node([])).opps[0].maxHeart, h1 = startMatch(run, node(['short_game'])).opps[0].maxHeart, h2 = startMatch(run, node(['king_court'])).opps[0].maxHeart;
  assert.ok(Math.abs(h1 - h0 * 0.75) <= 1, `${h1} vs ${h0}`); assert.ok(Math.abs(h2 - h0 * 1.2) <= 1, `${h2} vs ${h0}`);
});

// ---------- every ability ----------
const coolerOpts = run => G.coolerView(run).options.map(o => o.id);
const AB_TESTS = {
  lucky_headband: () => { const r = arena({ abilities: ['lucky_headband'] }); hand(r, ['jumper', 'jumper']); assert.equal(dealt(r, 'jumper'), 14); assert.equal(dealt(r, 'jumper'), 7); },
  wristbands: () => { const r = arena({ abilities: ['wristbands'], ball: 'them' }); assert.equal(r.match.you.stops, 5); assert.equal(r.match.preview.d, 5); },
  chalk_bag: () => { const r = arena({ abilities: ['chalk_bag'] }); hand(r, ['jumper']); assert.equal(dealt(r, 'jumper'), 10); endTurn(r); r.match.offN = 2; force(r, 'you'); hand(r, ['jumper']); assert.equal(dealt(r, 'jumper'), 7, 'the first possession only'); },
  water_bottle: () => { const r = arena({ abilities: ['water_bottle'] }); r.match.you.hp = 20; r.match.over = { won: true }; G.matchOver(r); assert.equal(r.hp, 24); },
  lucky_socks: () => { const r = arena(); const mx = r.maxHp; gainAbility(r, 'lucky_socks'); assert.equal(r.maxHp, mx + 10); },
  knee_pads: () => { const r = arena({ abilities: ['knee_pads'], ball: 'them' }); hand(r, ['closeout', 'closeout']); play(r, 'closeout'); assert.equal(r.match.you.stops, 9); play(r, 'closeout'); assert.equal(r.match.you.stops, 15); },
  pregame_meal: () => { const run = G.newRun({ seed: 9, player: P() }); gainAbility(run, 'pregame_meal'); run.hp = 20; const m = startMatch(run, { id: 'r', kind: 'rival', phase: 1, round: 5, foes: [{ charId: 'ai-2', name: 'R', style: 'big', rank: 0, traits: [] }], rules: [] }); assert.equal(m.you.hp, 28); },
  playbook: () => { const r = arena({ abilities: ['playbook'] }); assert.equal(r.match.hand.length, 7); },
  tip_jar: () => { const a = arena({ abilities: ['tip_jar'] }), b = arena(); a.match.over = b.match.over = { won: true }; assert.equal(G.matchOver(a).reward.coins, G.matchOver(b).reward.coins + 8); },
  jump_rope: () => { const r = arena({ abilities: ['jump_rope'] }); hand(r, ['jumper', 'jumper', 'jumper']); play(r, 'jumper'); play(r, 'jumper'); assert.equal(r.match.you.stops, 0); play(r, 'jumper'); assert.equal(r.match.you.stops, 3); },
  sweatband: () => { const r = arena({ abilities: ['sweatband'], rules: ['hostile_crowd'] }); assert.ok(!r.match.you.status.cold); },
  mouthguard: () => { const r = arena({ abilities: ['mouthguard'], ball: 'them' }); hand(r, []); assert.equal(taken(r), 0); force(r, 'them'); hand(r, []); assert.equal(taken(r), 10); },
  scouting_report: () => {
    const a = arena({ ball: 'them' }); a.match.you.status.screened = 1; refreshSets(a.match); assert.equal(a.match.foeSet.hidden, true);
    const b = arena({ abilities: ['scouting_report'], ball: 'them' }); b.match.you.status.screened = 1; refreshSets(b.match); assert.equal(b.match.foeSet.hidden, false); assert.equal(b.match.foeSet.total, 10);
  },
  film_reel: () => { const r = arena({ abilities: ['film_reel'] }); hand(r, ['crossover', 'step_back_three'], 2); play(r, 'crossover'); play(r, 'step_back_three'); assert.equal(r.match.energy, 1); },
  metronome: () => { const r = arena({ abilities: ['metronome'] }); hand(r, ['crossover', 'outlet_pass', 'jumper']); play(r, 'crossover'); play(r, 'outlet_pass'); play(r, 'jumper'); assert.equal(r.match.you.stops, 4); },
  heavy_ball: () => { const r = arena({ abilities: ['heavy_ball'] }); hand(r, ['post_hook']); assert.equal(dealt(r, 'post_hook'), 7 + 2 + 1); },
  drive_lanes: () => { const r = arena({ abilities: ['drive_lanes'] }); hand(r, ['layup', 'layup']); assert.equal(dealt(r, 'layup'), Math.floor(7 * 1.5)); assert.equal(dealt(r, 'layup'), Math.floor(7 * 1.5), 'still Exposed, not twice'); assert.equal(opp(r).status.exposed, 1); },
  trainers_table: () => { const r = arena({ abilities: ['trainers_table'] }); assert.ok(coolerOpts(r).includes('remove')); assert.ok(!coolerOpts(arena()).includes('remove')); },
  ice_bucket: () => { const r = arena({ abilities: ['ice_bucket'] }); r.stage = 'cooler'; r.cooler = { used: false }; const s = r.player.stats.stamina; assert.ok(G.cooler(r, 'icebath').ok); assert.equal(r.player.stats.stamina, s + 1); r.stage = 'cooler'; r.cooler = { used: false }; assert.ok(!G.cooler(r, 'icebath').ok, 'once a run'); },
  iron_lungs: () => { const r = arena(); const s = r.player.stats.stamina; gainAbility(r, 'iron_lungs'); assert.equal(r.player.stats.stamina, s + 1); },
  protein_shake: () => { const r = arena(); const mx = r.maxHp; gainAbility(r, 'protein_shake'); assert.equal(r.maxHp, mx + 6); },
  game_tape: () => { const r = arena(); gainAbility(r, 'game_tape'); assert.equal(r.player.stats.shooting, 3); },
  grip_gloves: () => { const r = arena(); gainAbility(r, 'grip_gloves'); assert.equal(r.player.stats.defense, 3); },
  hustle_tape: () => { const r = arena({ abilities: ['hustle_tape'], ball: 'them' }); hand(r, ['closeout']); play(r, 'closeout'); assert.equal(r.match.you.stops, 8); },
  assist_log: () => { const r = arena({ abilities: ['assist_log'] }); hand(r, ['kick_out', 'kick_out']); play(r, 'kick_out'); const h = r.match.hand.length; play(r, 'kick_out'); assert.equal(r.match.hand.length, h - 1 + 1); },
  sixth_man: () => { const r = arena({ abilities: ['sixth_man'], off: { kind: 'shoot', pts: 500, anim: 'dunk' }, ball: 'them' }); hand(r, []); endTurn(r); assert.ok(!r.match.over); assert.equal(r.match.you.hp, Math.floor(r.match.you.maxHp * 0.25)); force(r, 'them'); hand(r, []); endTurn(r); assert.ok(r.match.over && !r.match.over.won, 'once a run'); },
  second_gear: () => { const r = arena({ abilities: ['second_gear'] }); hand(r, ['crossover', 'outlet_pass', 'jumper']); play(r, 'crossover'); play(r, 'outlet_pass'); play(r, 'jumper'); assert.equal(r.match.energy, 3 - 2 + 2); },
  captains_band: () => { const r = arena({ abilities: ['captains_band'] }); assert.equal(r.match.energy, 4); assert.equal(r.match.you.status.hot, 1); },
  muscle_memory: () => { const r = arena({ abilities: ['muscle_memory'], deck: Array(10).fill('closeout') }); hand(r, ['logo_three', 'jumper'], 0); endTurn(r); assert.ok(r.match.hand.includes('logo_three')); assert.ok(!r.match.hand.includes('jumper')); },
  deep_rotation: () => { const r = arena({ abilities: ['deep_rotation'] }); hand(r, ['bench_shooter']); assert.equal(dealt(r, 'bench_shooter'), 5 + 2 + 1); },
  minimalist: () => { const r = arena({ abilities: ['minimalist'], deck: Array(15).fill('jumper') }); hand(r, ['floater']); assert.equal(dealt(r, 'floater'), 12); },
  clutch_chain: () => { const r = arena({ abilities: ['clutch_chain'] }); r.match.you.hp = Math.floor(r.match.you.maxHp * 0.65); hand(r, ['dagger']); assert.equal(dealt(r, 'dagger'), 16); },
  hot_hand: () => {
    const r = arena({ abilities: ['hot_hand'] }); hand(r, ['jumper', 'jumper']); play(r, 'jumper'); play(r, 'jumper'); endTurn(r); assert.ok(!r.match.you.status.hot, '14');
    const r2 = arena({ abilities: ['hot_hand'] }); hand(r2, ['jumper', 'jumper', 'jumper']); for (let k = 0; k < 3; k++) play(r2, 'jumper'); endTurn(r2); assert.equal(r2.match.you.status.hot, 1, '21');
  },
  ankle_weights: () => { const r = arena({ abilities: ['ankle_weights'] }); assert.equal(r.match.maxEnergy, 4); assert.equal(r.match.hand.length, 4); },
  max_contract: () => { const a = arena({ abilities: ['max_contract'] }), b = arena(); assert.equal(a.match.maxEnergy, 4); a.match.over = b.match.over = { won: true }; assert.equal(G.matchOver(a).reward.coins, Math.round(G.matchOver(b).reward.coins / 2)); },
  superteam: () => { const r = arena({ abilities: ['superteam'] }); assert.equal(r.match.hand.length, 6); assert.equal(G.coolerView(r).options.find(o => o.id === 'heal').enabled, false); },
  signature_shoe: () => { const r = arena({ abilities: ['signature_shoe'] }); assert.equal(r.match.maxEnergy, 4); assert.ok([...r.match.drawPile, ...r.match.hand].includes('ticky_tack')); },
  franchise_tag: () => {
    const r = arena({ abilities: ['franchise_tag'], ball: 'them' }); assert.equal(r.match.maxEnergy, 4);
    assert.equal(r.match.foeSet.hidden, true); assert.equal(r.match.foeSet.total, null); assert.deepEqual(r.match.foeSet.cards, [{ hidden: true, actor: 0 }]);
    assert.equal(r.match.preview.result, '?'); assert.equal(opp(r).intent.kind, 'unknown'); assert.equal(opp(r).intent.value, null);
    hand(r, []); assert.equal(taken(r), 10, 'hidden or not, the same 10');
  },
  spotlight: () => { const r = arena({ abilities: ['spotlight'] }); hand(r, Array(7).fill('finger_roll'), 4); for (let k = 0; k < 6; k++) play(r, 'finger_roll'); assert.equal(play(r, 'finger_roll')[0].type, 'invalid'); },
  sneaker_deal: () => { const mk = ab => SHOP.makeShop({ s: 5 }, arena({ abilities: ab }), 1); const a = mk(['sneaker_deal']), b = mk([]); a.cards.forEach((c, i) => assert.ok(Math.abs(c.price - b.cards[i].price * 0.8) <= 1, `${c.ref}: ${c.price} vs ${b.cards[i].price}`)); },
  punch_card: () => { const r = arena({ abilities: ['punch_card'] }); r.removals = 4; assert.equal(G.shopView(r).removePrice, 50); },
  agent: () => { const a = arena({ abilities: ['agent'] }), b = arena(); a.match.over = b.match.over = { won: true }; assert.equal(G.matchOver(a).reward.coins, Math.round(G.matchOver(b).reward.coins * 1.25)); },
  ice_chest: () => { const r = arena({ abilities: ['ice_chest'] }); r.hp = 1; r.stage = 'cooler'; r.cooler = { used: false }; G.cooler(r, 'heal'); assert.equal(r.hp, 1 + Math.round(r.maxHp * 0.4)); },
};
import * as SHOP from '../client/js/deck/rewards.js';
test('every ability triggers', () => {
  for (const a of ABILITY_LIST) { assert.ok(AB_TESTS[a.id], `a test for ${a.id}`); AB_TESTS[a.id](); }
});
