// v0.4.8.9 qp4: The Gauntlet plays in possessions (docs/GAUNTLET.md §15). The engine API the UI builds on, the jump
// ball, the clash table (O > D scores O − D, defense wins ties, shots in order against the pool), what each clash looks
// like (made / assist / and-one / block / steal / contest / charge, the boards), the turn types (offense, defense, fast
// break, second chance, free throws, make-it-take-it, turnovers), the hidden sets and the dead-hand rule.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/deck/index.js';
import { startMatch, endTurn, playCard, refreshSets, BREAK_STOPS, FT_AND_ONE, FT_MISSED, MAX_HAND } from '../client/js/deck/combat.js';
import { gainAbility } from '../client/js/deck/abilities.js';
import { stream, next } from '../client/js/deck/rng.js';
import { playRun } from '../tools/deck_sim.mjs';

const P = (o = {}) => ({ id: 't', name: 'Tester', stats: { stamina: 3, shooting: 2, defense: 2, health: 3, ...o } });
const OFF = { kind: 'shoot', pts: 10, anim: 'jumper', name: 'Test shot' };
const DEF = { kind: 'defend', stops: 0, anim: 'contest', name: 'Stands there' };
function force(run, ball = 'you', tt = null) {
  const m = run.match;
  m.ball = ball; m.phase = ball === 'you' ? 'offense' : 'defense'; m.turnType = tt || m.phase;
  if (ball === 'you' && !m.offN) m.offN = 1;
  for (const o of m.opps) o.set = o.heart > 0 ? [{ ...(ball === 'you' ? o.pools.def[0] : o.pools.off[0]) }] : [];
  refreshSets(m);
  return run;
}
function arena({ stats, rules = [], abilities = [], deck = Array(10).fill('jumper'), foes, off = OFF, def = DEF, heart = 200, ball = 'you', traits = [] } = {}) {
  const run = G.newRun({ seed: 9, player: P(stats) });
  run.deck = deck.slice();
  for (const a of abilities) gainAbility(run, a);
  const node = { id: 'arena', kind: 'match', phase: 1, round: 0, foes: foes || [{ charId: 'ai-1', name: 'Opp', style: 'slasher', rank: 0, traits }], rules, boss: null };
  const m = startMatch(run, node);
  for (const o of m.opps) { o.heart = o.maxHeart = heart; o.dmgK = 1; o.shooting = 0; o.defense = 0; o.cycle = true; o.pools = { off: [{ ...off }], def: [{ ...def }], ride: [] }; o.pools2 = null; }
  if (ball) force(run, ball);
  return run;
}
const hand = (run, refs, energy = 9) => { run.match.hand = refs.slice(); run.match.energy = energy; refreshSets(run.match); };
const play = (run, ref, ti = 0) => { const i = run.match.hand.indexOf(ref); assert.ok(i >= 0, `${ref} in hand`); const ev = playCard(run, i, ti); assert.notEqual(ev[0]?.type, 'invalid', ev[0]?.text); return ev; };
const opp = run => run.match.opps[0];
const shots = ev => ev.filter(e => e.type === 'shot');

test('the engine API: version, phase, ball, turn type and label, the committed set, the live clash, the tip-off', () => {
  assert.equal(G.ENGINE_VERSION, 3); // (3 since qp7's hand max)
  const run = G.newRun({ seed: 4, player: G.rollStarters(4)[0] });
  assert.equal(run.engine, 3);
  G.enterNode(run, G.availableNodes(run)[0]);
  const m = run.match;
  assert.ok(['offense', 'defense'].includes(m.phase)); assert.ok(['you', 'them'].includes(m.ball));
  assert.equal(m.phase, m.ball === 'you' ? 'offense' : 'defense'); assert.equal(m.turnType, m.phase);
  assert.equal(typeof m.turnLabel, 'string'); assert.ok(m.turnLabel.length > 3);
  assert.equal(typeof m.foeSet.hidden, 'boolean'); assert.ok(Array.isArray(m.foeSet.cards) && m.foeSet.cards.length >= 1);
  for (const c of m.foeSet.cards) for (const k of ['name', 'kind', 'value', 'anim', 'tags', 'text']) assert.ok(k in c, k);
  assert.equal(m.foeSet.total, m.ball === 'you' ? m.preview.d : m.preview.o);
  for (const k of ['o', 'd', 'result', 'points']) assert.ok(k in m.preview, k);
  assert.ok(['score', 'stopped', '?'].includes(m.preview.result));
  // the tip-off plays first, then the first possession and the first turn
  assert.equal(m.intro[0].type, 'jump'); assert.equal(m.intro[0].anim, 'rebound');
  assert.equal(m.intro[0].actor === 'you', m.ball === 'you');
  assert.deepEqual(m.intro.filter(e => e.type === 'possession').map(e => [e.to, e.turnType]), [[m.ball, m.turnType]]);
  for (const e of m.intro) assert.ok(e.anim === null || G.ANIMS.includes(e.anim), `anim ${e.anim}`);
  // canPlay is phase-aware, and takes the run or the match
  const r2 = arena({ ball: 'them' }); hand(r2, ['jumper', 'crossover', 'closeout', 'outlet_pass', 'green_light']);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => G.canPlay(r2, i).ok), [false, false, true, true, true]);
  assert.match(G.canPlay(r2, 0).why, /Shots can't be played on defense/); assert.match(G.canPlay(r2.match, 1).why, /Moves can't be played on defense/);
  force(r2, 'you'); assert.deepEqual([0, 1, 2, 3, 4].map(i => G.canPlay(r2, i).ok), [true, true, false, true, true]);
  assert.match(G.canPlay(r2, 2).why, /Defense cards can't be played on offense/);
  assert.equal(G.handView(r2)[2].offPhase, true); assert.equal(G.handView(r2)[0].offPhase, false);
});

test('the jump ball: a seeded coin, 50/50, the same on a replay', () => {
  let you = 0;
  for (let s = 1; s <= 300; s++) {
    const a = G.newRun({ seed: s, player: G.rollStarters(s)[0] }), b = G.newRun({ seed: s, player: G.rollStarters(s)[0] });
    G.enterNode(a, G.availableNodes(a)[0]); G.enterNode(b, G.availableNodes(b)[0]);
    assert.equal(a.match.ball, b.match.ball, `seed ${s}`);
    if (a.match.ball === 'you') you++;
  }
  assert.ok(you > 120 && you < 180, `${you}/300 tips won`);
});

test('the clash: O > D scores O − D, defense wins ties, several shots go up in order against what\'s left of the pool', () => {
  const at = (stops, refs) => { const r = arena({ def: { kind: 'defend', stops, anim: 'contest' } }); hand(r, refs); for (const x of refs) play(r, x); const h = opp(r).heart, p = { ...r.match.preview }; const ev = endTurn(r); return { dealt: h - opp(r).heart, ev, p }; };
  let r = at(7, ['jumper']); // 7 vs 7
  assert.equal(r.dealt, 0); assert.deepEqual(r.p, { o: 7, d: 7, result: 'stopped', points: 0 });
  assert.deepEqual(r.ev.find(e => e.type === 'clash'), { ...r.ev.find(e => e.type === 'clash'), o: 7, d: 7, winner: 'defense' }, 'a tie goes to the defense');
  r = at(6, ['jumper']); assert.equal(r.dealt, 1); assert.equal(r.p.result, 'score'); assert.equal(r.ev.find(e => e.type === 'clash').winner, 'offense');
  r = at(10, ['jumper', 'jumper']); // 7 + 7 vs 10: the first is stopped, the second goes in for 4
  assert.deepEqual(shots(r.ev).map(e => [e.made, e.points, e.stops]), [[false, 0, 7], [true, 4, 3]]);
  assert.equal(r.dealt, 4);
  const types = r.ev.map(e => e.type).filter(t => ['card', 'shot', 'clash', 'possession'].includes(t));
  assert.deepEqual(types.slice(types.indexOf('shot')), ['shot', 'shot', 'clash', 'possession'], 'shots, then the clash, then the next possession');
  // the total is always max(0, O − D), whatever the mix, on both ends of the floor
  const st = stream(77, 'clash'), pool = ['jumper', 'layup', 'rain_check', 'floater', 'tip_in', 'step_back_three'];
  for (let k = 0; k < 120; k++) {
    const refs = Array.from({ length: 1 + Math.floor(next(st) * 4) }, () => pool[Math.floor(next(st) * pool.length)]), stops = Math.floor(next(st) * 40);
    const x = at(stops, refs);
    assert.equal(x.dealt, Math.max(0, x.p.o - stops), `${refs} vs ${stops}`); assert.equal(x.p.points, x.dealt);
    const theirs = Math.floor(next(st) * 40), y = arena({ ball: 'them', off: { kind: 'shoot', pts: theirs, anim: 'jumper' } }), cards = ['closeout', 'block_shot', 'ice_screen'].slice(0, Math.floor(next(st) * 4));
    hand(y, cards); for (const c of cards) play(y, c);
    const D = y.match.preview.d, hp = y.match.you.hp; endTurn(y);
    assert.equal(hp - y.match.you.hp, Math.max(0, theirs - D), `${theirs} vs ${D}`);
  }
});

test('what a clash looks like comes from the cards: made, assist, and-one, block, steal, contest, charge', () => {
  // made, and an assist when a Pass set it up
  let r = arena(); hand(r, ['jumper', 'outlet_pass', 'jumper']); play(r, 'jumper'); play(r, 'outlet_pass'); play(r, 'jumper');
  let ev = endTurn(r); assert.deepEqual(shots(ev).map(e => e.how), ['made', 'assist']); assert.equal(shots(ev)[1].assist, 'you');
  // his too, when a Pass card in his set sets it up
  r = arena({ ball: 'them' }); opp(r).set.push({ kind: 'buff', hot: 1, anim: 'pass', name: 'Sets the table', rider: true }); hand(r, []);
  ev = endTurn(r); assert.equal(shots(ev)[0].how, 'assist'); assert.equal(shots(ev)[0].assist, 0);
  // and-one: a fouled basket (Physical Night: a Drive or Post shot)
  r = arena({ rules: ['physical'] }); hand(r, ['layup']); play(r, 'layup'); ev = endTurn(r);
  assert.equal(shots(ev)[0].how, 'and_one');
  // your stopped shots: a block when his biggest card is a block and you went inside; a steal when he went for the ball
  // and you handled it; otherwise a contest and the boards
  r = arena({ def: { kind: 'defend', stops: 30, anim: 'block' } }); hand(r, ['layup']); play(r, 'layup'); ev = endTurn(r); assert.equal(shots(ev)[0].how, 'block');
  r = arena({ def: { kind: 'defend', stops: 30, anim: 'block' } }); hand(r, ['jumper']); play(r, 'jumper'); ev = endTurn(r); assert.equal(shots(ev)[0].how, 'contest', 'a jumper isn\'t blocked');
  assert.equal(ev.filter(e => e.type === 'rebound').length, 1);
  r = arena({ def: { kind: 'defend', stops: 30, anim: 'steal' } }); hand(r, ['crossover', 'jumper']); play(r, 'crossover'); play(r, 'jumper'); ev = endTurn(r);
  assert.equal(shots(ev)[0].how, 'steal'); assert.equal(r.match.ball, 'them'); assert.equal(r.match.turnType, 'fast_break');
  r = arena({ def: { kind: 'defend', stops: 30, anim: 'steal' } }); hand(r, ['jumper']); play(r, 'jumper'); ev = endTurn(r); assert.equal(shots(ev)[0].how, 'contest', 'nothing to pick off');
  // their stopped shots, by your Defense cards
  const vs = (anim, cards, pts = 5) => { const y = arena({ ball: 'them', off: { kind: 'shoot', pts, anim } }); hand(y, cards); for (const c of cards) play(y, c); return { ev: endTurn(y), run: y }; };
  assert.equal(shots(vs('layup', ['block_shot']).ev)[0].how, 'block');
  assert.equal(shots(vs('post', ['box_out']).ev)[0].how, 'block', 'a Post Defense card protects the rim');
  assert.equal(shots(vs('jumper', ['block_shot']).ev)[0].how, 'contest');
  const st = vs('stepback', ['swipe']); assert.equal(shots(st.ev)[0].how, 'steal'); assert.equal(st.run.match.ball, 'you'); assert.equal(st.run.match.turnType, 'fast_break');
  const ch = vs('layup', ['take_charge']); assert.equal(shots(ch.ev)[0].how, 'charge'); assert.equal(ch.run.match.ball, 'you'); assert.match(ch.run.match.turnLabel, /charge/i);
  for (const e of [...ev, ...st.ev, ...ch.ev]) assert.ok(e.anim === null || G.ANIMS.includes(e.anim), `anim ${e.anim}`);
});

test('turn types: fast break, second chance, free throws, make-it-take-it, turnovers', () => {
  // your fast break: his Stops count half, and only one of them gets back
  let r = arena({ foes: [{ charId: 'ai-1', name: 'A', style: 'slasher', rank: 0, traits: [] }, { charId: 'ai-2', name: 'B', style: 'big', rank: 0, traits: [] }], def: { kind: 'defend', stops: 10, anim: 'contest' } });
  r.match.opps.forEach(o => { o.pools.def = [{ kind: 'defend', stops: 10, anim: 'contest' }]; });
  force(r, 'them'); hand(r, ['swipe']); r.match.opps.forEach(o => { o.set = [{ kind: 'shoot', pts: 2, anim: 'stepback' }]; }); refreshSets(r.match);
  play(r, 'swipe'); endTurn(r);
  assert.equal(r.match.turnType, 'fast_break'); assert.equal(r.match.ball, 'you'); assert.match(r.match.turnLabel, /Fast break/);
  assert.deepEqual(r.match.opps.map(o => o.set.length), [1, 0], 'one man back');
  assert.equal(r.match.preview.d, Math.floor(10 * BREAK_STOPS));
  // their fast break: your Stops count half, one Defense card
  r = arena({ ball: 'them' }); force(r, 'them', 'fast_break'); hand(r, ['closeout', 'closeout']); play(r, 'closeout');
  assert.equal(r.match.preview.d, Math.floor(6 * BREAK_STOPS)); assert.match(G.canPlay(r, 0).why, /one Defense card/);
  // second chance: stopped, but you had more Hustle on the floor than he did
  r = arena({ def: { kind: 'defend', stops: 30, anim: 'contest' } }); hand(r, ['tip_in', 'jumper']); play(r, 'tip_in'); play(r, 'jumper');
  let ev = endTurn(r); assert.ok(ev.some(e => e.type === 'rebound' && e.offensive)); assert.equal(r.match.ball, 'you'); assert.equal(r.match.turnType, 'second_chance');
  r = arena({ def: { kind: 'defend', stops: 30, anim: 'contest' } }); hand(r, ['jumper']); play(r, 'jumper'); ev = endTurn(r);
  assert.ok(ev.some(e => e.type === 'rebound' && !e.offensive)); assert.equal(r.match.ball, 'them'); assert.equal(r.match.turnType, 'defense');
  // free throws: a fouled miss is two shots (FT_MISSED of its points), a fouled basket an and-one (FT_AND_ONE); they
  // never flip the clash
  r = arena({ ball: 'them', off: { kind: 'shoot', pts: 12, anim: 'layup', foul: true } }); hand(r, ['block_shot', 'closeout']); play(r, 'block_shot'); play(r, 'closeout');
  let hp = r.match.you.hp; ev = endTurn(r);
  assert.equal(shots(ev)[0].made, false); assert.equal(ev.find(e => e.type === 'ft').points, Math.floor(12 * FT_MISSED)); assert.equal(hp - r.match.you.hp, Math.floor(12 * FT_MISSED));
  assert.equal(ev.find(e => e.type === 'clash').winner, 'defense');
  r = arena({ ball: 'them', off: { kind: 'shoot', pts: 12, anim: 'layup', foul: true } }); hand(r, []); hp = r.match.you.hp; ev = endTurn(r);
  assert.equal(shots(ev)[0].how, 'and_one'); assert.equal(hp - r.match.you.hp, 12 + Math.floor(12 * FT_AND_ONE));
  assert.equal(ev.filter(e => e.type === 'foul').length, 1); assert.ok(ev.findIndex(e => e.type === 'foul') < ev.findIndex(e => e.type === 'clash'));
  // a basket gives the ball back; with Make-It-Take-It the scorer keeps it
  r = arena(); hand(r, ['jumper']); play(r, 'jumper'); endTurn(r); assert.equal(r.match.ball, 'them');
  r = arena({ rules: ['make_it_take_it'] }); hand(r, ['jumper']); play(r, 'jumper'); ev = endTurn(r); assert.equal(r.match.ball, 'you');
  assert.deepEqual(ev.filter(e => e.type === 'possession').map(e => [e.to, e.turnType]), [['you', 'offense']]);
  // no shot: a turnover (picked off into a fast break if he went for the ball and you handled it)
  r = arena(); hand(r, ['crossover']); play(r, 'crossover'); ev = endTurn(r); assert.equal(r.match.ball, 'them'); assert.match(r.match.turnLabel, /Turnover/);
  r = arena({ def: { kind: 'defend', stops: 5, anim: 'steal' } }); hand(r, ['crossover']); play(r, 'crossover'); ev = endTurn(r);
  assert.ok(ev.some(e => e.type === 'shot' && e.how === 'steal')); assert.equal(r.match.turnType, 'fast_break');
  // every possession event names who has it next and the kind of turn
  for (const e of ev.filter(x => x.type === 'possession')) { assert.ok(['you', 'them'].includes(e.to)); assert.ok(['offense', 'defense', 'fast_break', 'second_chance'].includes(e.turnType)); assert.ok(e.text); }
});

test('hidden sets: Screened, a poker face, the Franchise Tag; a Scouting Report reads them; hiding never changes the result', () => {
  // Screened: his set's debuff, for your next possession only
  const r = arena({ ball: 'them', off: { kind: 'shoot', pts: 5, anim: 'steal', you: { screened: 1 } } });
  assert.equal(r.match.foeSet.hidden, false); hand(r, []); endTurn(r);
  assert.equal(r.match.you.status.screened, 1);
  assert.equal(r.match.foeSet.hidden, true); assert.match(r.match.foeSet.why, /Screened/); assert.equal(r.match.foeSet.total, null);
  assert.deepEqual(r.match.foeSet.cards.map(c => c.hidden), [true]);
  hand(r, []); endTurn(r); assert.ok(!r.match.you.status.screened); assert.equal(r.match.foeSet.hidden, false);
  // a poker face: you see his total, not his card
  const p = arena({ ball: 'them', traits: ['poker_face'] });
  assert.equal(p.match.foeSet.hidden, true); assert.equal(p.match.foeSet.total, 10); assert.equal(p.match.preview.o, 10); assert.equal(p.match.preview.result, 'score');
    // the Franchise Tag hides it all; a Scouting Report reads through a Screen or a poker face
  const f = arena({ ball: 'them', abilities: ['franchise_tag'] }); assert.equal(f.match.foeSet.hidden, true); assert.equal(f.match.preview.o, null); assert.equal(f.match.preview.result, '?');
  const s = arena({ ball: 'them', traits: ['poker_face'], abilities: ['scouting_report'] }); assert.equal(s.match.foeSet.hidden, false); assert.equal(s.match.foeSet.cards[0].name, 'Test shot');
  // the same possession hidden and open plays out the same
  const out = hide => { const x = arena({ ball: 'them', abilities: hide ? ['franchise_tag'] : [] }); x.match.maxEnergy = 3; hand(x, ['closeout']); play(x, 'closeout'); const ev = endTurn(x); return [x.match.you.hp, ev.filter(e => ['shot', 'clash'].includes(e.type)).map(e => [e.type, e.points, e.how, e.o, e.d])]; };
  assert.deepEqual(out(true), out(false));
});

test('the dead-hand rule: a card you can\'t play on this side of the ball stays for the next possession', () => {
  const r = arena({ ball: 'them', deck: Array(10).fill('closeout') }); hand(r, ['jumper', 'logo_three', 'closeout', 'closeout']); play(r, 'closeout');
  endTurn(r);
  assert.ok(r.match.hand.includes('jumper') && r.match.hand.includes('logo_three'), 'the Shots wait for your ball');
  assert.ok(r.match.discard.includes('closeout'), 'the Defense card you didn\'t play is discarded as ever');
  // and the hand never grows past its cap
  const c = arena({ ball: 'them', deck: Array(20).fill('jumper') }); hand(c, Array(4).fill('logo_three')); endTurn(c);
  assert.equal(c.match.hand.length, MAX_HAND, 'held cards count toward the hand max (qp7): one new card');
  // a possession that opens with nothing playable is counted (tools/deck_sim.mjs keeps it rare)
  const d = arena({ ball: 'them', deck: Array(10).fill('closeout') }); const n0 = d.match.log.dead; hand(d, []); endTurn(d);
  assert.equal(d.match.ball, 'you'); assert.ok(d.match.hand.every(x => x === 'closeout')); assert.equal(d.match.log.dead, n0 + 1);
});

test('a new run replays to its live outcome on the possession engine; an old run\'s start is refused', () => {
  for (const [seed, pol] of [[3, 'greedy'], [11, 'smart']]) {
    const r = playRun(seed, pol);
    assert.equal(r.start.engine, 3);
    const rp = G.replay(r.start, r.log);
    assert.ok(rp.ok, rp.error); assert.equal(rp.hash, G.outcomeHash(r.run));
  }
  const r = playRun(5, 'greedy'), { engine, ...old } = r.start;
  assert.equal(engine, 3);
  const rp = G.replay(old, r.log); assert.equal(rp.ok, false); assert.equal(rp.at, -1); assert.match(rp.error, /old engine/);
});
