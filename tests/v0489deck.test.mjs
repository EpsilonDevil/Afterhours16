// v0.4.8.9 The Gauntlet engine (client/js/deck): the §14 API shapes, determinism (same seed + same choices = same
// state hash), plain-JSON run state, and a pure source (no Math.random, no Date.now, no DOM).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as G from '../client/js/deck/index.js';
import { CARD_LIST } from '../client/js/deck/cards.js';
import { ABILITY_LIST } from '../client/js/deck/abilities.js';
import { STYLES } from '../client/js/deck/foes.js';
import { BOSSES } from '../client/js/deck/bosses.js';
import { playRun } from '../tools/deck_sim.mjs';

const API = ['newRun', 'rollStarters', 'rollConverted', 'availableNodes', 'enterNode', 'playCard', 'endTurn', 'matchOver', 'takeReward', 'cooler', 'shopView', 'shopBuy', 'shopRemove',
  'eventView', 'eventChoose', 'runOver', 'cardInfo', 'abilityInfo', 'worldAfterRun', 'worldTick', 'charLine'];

// a fixed, simple player: plays every playable card left to right, takes the first card, heals at Coolers, picks the
// first enabled event choice, buys nothing. Returns the run and a log of hashes after every step.
function scripted(seed, steps = 400) {
  const run = G.newRun({ seed, player: G.rollStarters(seed)[0] });
  const hashes = [];
  for (let k = 0; k < steps && !run.over; k++) {
    const av = G.availableNodes(run);
    if (!av.length) break;
    const r = G.enterNode(run, av[av.length - 1]);
    const fight = () => {
      for (let t = 0; t < 40 && !run.match.over; t++) {
        for (let g = 0; g < 12 && !run.match.over; g++) { const i = G.handView(run).findIndex(h => h.playable); if (i < 0) break; G.playCard(run, i); }
        if (!run.match.over) G.endTurn(run);
      }
      if (!run.match.over) { run.match.over = { won: false }; }
      const mo = G.matchOver(run);
      if (mo.won && run.stage === 'reward') G.takeReward(run, { card: 0, ability: true });
    };
    if (['match', 'rival', 'boss'].includes(r.kind)) fight();
    else if (r.kind === 'cooler') G.cooler(run, 'heal');
    else if (r.kind === 'shop') G.leaveNode(run);
    else if (r.kind === 'event') { const v = G.eventView(run); const res = G.eventChoose(run, Math.max(0, v.choices.findIndex(c => c.enabled))); if (res.fight) fight(); }
    hashes.push(G.stateHash(run));
  }
  return { run, hashes };
}

test('the engine publishes every §14 function', () => {
  for (const f of API) assert.equal(typeof G[f], 'function', f);
  assert.deepEqual(G.ANIMS, ['jumper', 'three', 'layup', 'dunk', 'floater', 'post', 'crossover', 'spin', 'stepback', 'pass', 'lob', 'closeout', 'contest', 'block', 'steal', 'rebound', 'celebrate', 'gassed', 'foul']);
});

test('the source is pure: no Math.random, no Date.now, no DOM', () => {
  const dir = new URL('../client/js/deck/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const code = fs.readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const bad of ['Math.random', 'Date.now', 'new Date', 'performance.now', 'document.', 'window.', 'localStorage']) assert.ok(!code.includes(bad), `${f} uses ${bad}`);
  }
});

test('starters roll 1-5, converted players [base-2, base+1] on 6-10, both deterministic', () => {
  const a = G.rollStarters(42), b = G.rollStarters(42);
  assert.equal(a.length, 3); assert.deepEqual(a, b);
  for (const p of G.rollStarters(7, 50)) for (const k of ['stamina', 'shooting', 'defense', 'health']) assert.ok(p.stats[k] >= 1 && p.stats[k] <= 5);
  assert.notDeepEqual(G.rollStarters(1), G.rollStarters(2));
  const icon = { id: 'b1', name: 'Icon', base: { stamina: 99, shooting: 80, defense: 60, health: 8 } };
  const seen = { stamina: new Set(), shooting: new Set(), defense: new Set(), health: new Set() };
  for (let s = 1; s < 300; s++) { const p = G.rollConverted(s, icon); assert.equal(p.converted, true); for (const k in seen) seen[k].add(p.stats[k]); }
  // ratings map onto 6-10: 99 → 10, 80 → 8, 60 → 6; a value already on 1-10 is the base itself
  assert.deepEqual([...seen.stamina].sort((a, b) => a - b), [8, 9, 10]);
  assert.deepEqual([...seen.shooting].sort((a, b) => a - b), [6, 7, 8, 9]);
  assert.deepEqual([...seen.defense].sort((a, b) => a - b), [4, 5, 6, 7]);
  assert.deepEqual([...seen.health].sort((a, b) => a - b), [6, 7, 8, 9]);
  assert.deepEqual(G.rollConverted(9, icon), G.rollConverted(9, icon));
  // starter ids are exactly starter-<seed>-<0|1|2>, and stable
  assert.deepEqual(G.rollStarters(123456).map(p => p.id), ['starter-123456-0', 'starter-123456-1', 'starter-123456-2']);
  assert.deepEqual(G.rollStarters(42).map(p => [p.id, p.name, p.stats]), [['starter-42-0', a[0].name, a[0].stats], ['starter-42-1', a[1].name, a[1].stats], ['starter-42-2', a[2].name, a[2].stats]]);
  // the server's profile shape: stats are 0-99 ratings, build is the look, the cv- id stays
  const cv = { id: 'cv-77', name: 'Big Icon', converted: true, stats: { stamina: 99, shooting: 80, defense: 60, health: 40 }, build: { height: 80, appearance: { skin: '#a' } }, icon: 'the_general' };
  for (let s = 1; s < 200; s++) {
    const p = G.rollConverted(s, cv);
    assert.equal(p.id, 'cv-77'); assert.equal(p.icon, 'the_general'); assert.deepEqual(p.look, cv.build);
    assert.deepEqual(p.base, { stamina: 10, shooting: 8, defense: 6, health: 6 });
    for (const k in p.base) assert.ok(p.stats[k] >= Math.max(1, p.base[k] - 2) && p.stats[k] <= Math.min(10, p.base[k] + 1), `${k} ${p.stats[k]}`);
    assert.deepEqual(G.rollConverted(s, p).stats, p.stats, 'rolling a roll again keeps its base');
  }
});

test('newRun: plain JSON, the §2 numbers, the starter deck, 3 phases plus the Final', () => {
  const p = { id: 'p', name: 'P', stats: { stamina: 2, shooting: 3, defense: 4, health: 5 } };
  const run = G.newRun({ seed: 11, player: p });
  assert.deepEqual(JSON.parse(JSON.stringify(run)), run);
  assert.equal(run.maxHp, 30 + 6 * 5); assert.equal(run.hp, run.maxHp);
  assert.deepEqual(run.deck.slice().sort(), ['closeout', 'closeout', 'closeout', 'closeout', 'crossover', 'jumper', 'jumper', 'jumper', 'jumper', 'outlet_pass']);
  assert.equal(run.map.phases.length, 4);
  assert.equal(run.stage, 'map');
  assert.equal(G.availableNodes(run).length, 3);
});

test('match state has the §14 shape, and every event too', () => {
  const run = G.newRun({ seed: 3, player: G.rollStarters(3)[0] });
  const r = G.enterNode(run, G.availableNodes(run)[0]);
  assert.equal(r.kind, 'match');
  const m = run.match;
  for (const k of ['turn', 'energy', 'maxEnergy', 'hand', 'drawPile', 'discard', 'burned', 'you', 'opps', 'rules', 'score']) assert.ok(k in m, k);
  for (const k of ['hp', 'maxHp', 'stops', 'status']) assert.ok(k in m.you, k);
  const o = m.opps[0];
  for (const k of ['id', 'charId', 'name', 'look', 'heart', 'maxHeart', 'stops', 'status', 'intent']) assert.ok(k in o, k);
  for (const k of ['kind', 'value', 'text']) assert.ok(k in o.intent, k);
  assert.match(o.charId, /^ai-\d+$/); assert.ok(o.name && o.name !== o.charId, 'a real AI world name');
  assert.ok(m.rules.length >= 1 && m.rules.every(x => x.id && x.name && x.text));
  assert.equal(m.score.length, 2);
  const evs = [...G.playCard(run, 0), ...G.endTurn(run)];
  assert.ok(evs.length);
  for (const e of evs) {
    for (const k of ['t', 'actor', 'anim', 'made', 'points', 'stops', 'text']) assert.ok(k in e, k);
    assert.ok(e.anim === null || G.ANIMS.includes(e.anim), `anim ${e.anim}`);
    assert.ok(e.actor === 'you' || Number.isInteger(e.actor));
  }
});

test('the Flow chain is public: flowView and handView(run).flow', () => {
  // (a match where you won the tip: Moves and Shots are offense cards)
  let run = null;
  for (let seed = 2; !run || run.match.ball !== 'you'; seed++) { run = G.newRun({ seed, player: G.rollStarters(seed)[0] }); G.enterNode(run, G.availableNodes(run)[0]); }
  run.match.hand = ['crossover', 'outlet_pass', 'jumper', 'jumper']; run.match.energy = 3;
  assert.deepEqual(G.handView(run).flow, { chain: [], wild: 0, flowed: false, flows: 0, max: 1, need: 3 });
  G.playCard(run, 0); G.playCard(run, 0);
  assert.deepEqual(G.flowView(run), { chain: ['Handle', 'Pass'], wild: 0, flowed: false, flows: 0, max: 1, need: 1 });
  G.playCard(run, 0);
  const f = G.handView(run).flow;
  assert.equal(f.flowed, true); assert.equal(f.flows, 1); assert.equal(f.need, 0); assert.deepEqual(f.chain, []);
});

test('every opponent action plays something on the court', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const run = G.newRun({ seed, player: G.rollStarters(seed)[0] });
    G.enterNode(run, G.availableNodes(run)[seed % 3]);
    for (let t = 0; t < 8 && !run.match.over; t++) {
      const n = run.match.opps.filter(o => o.heart > 0).length;
      const evs = G.endTurn(run).filter(e => Number.isInteger(e.actor));
      const acted = new Set(evs.filter(e => e.anim).map(e => e.actor));
      assert.ok(acted.size >= Math.min(1, n), `turn ${t}: ${JSON.stringify(evs.map(e => [e.type, e.anim]))}`);
    }
  }
});

test('every card and every opponent move carries a court animation; cardInfo and abilityInfo shapes', () => {
  const playable = CARD_LIST.filter(c => c.type !== 'fatigue');
  assert.ok(playable.length >= 85 && playable.length <= 115, `${playable.length} cards`);
  for (const c of CARD_LIST) {
    assert.ok(G.ANIMS.includes(c.anim), c.id);
    for (const ref of [c.id, c.id + '+']) {
      const i = G.cardInfo(ref);
      for (const k of ['id', 'name', 'cost', 'type', 'rarity', 'tags', 'text', 'anim', 'upgraded']) assert.ok(k in i, `${ref} ${k}`);
      assert.ok(i.text.length > 3, ref);
    }
    if (c.type !== 'fatigue') assert.notEqual(G.cardInfo(c.id).text + G.cardInfo(c.id).cost, G.cardInfo(c.id + '+').text + G.cardInfo(c.id + '+').cost, `${c.id}+ is an upgrade`);
  }
  for (const r of ['common', 'uncommon', 'rare']) assert.ok(playable.filter(c => c.rarity === r).length >= 15, r);
  for (const s of Object.values(STYLES)) for (const mv of [...s.moves, s.rival]) assert.ok(G.ANIMS.includes(mv.anim), mv.name);
  for (const b of Object.values(BOSSES)) for (const mv of [...(b.cycle || []), ...(b.cycle2 || [])]) assert.ok(G.ANIMS.includes(mv.anim), `${b.id} ${mv.name}`);
  assert.ok(ABILITY_LIST.length >= 38 && ABILITY_LIST.length <= 46);
  for (const a of ABILITY_LIST) { const i = G.abilityInfo(a.id); assert.deepEqual(Object.keys(i).sort(), ['id', 'name', 'rarity', 'text']); }
  for (const r of ['common', 'uncommon', 'rare', 'boss', 'shop']) assert.ok(ABILITY_LIST.some(a => a.rarity === r), r);
});

test('determinism: the same seed and the same choices give the same state hash at every step', () => {
  for (const seed of [5, 77]) {
    const a = scripted(seed), b = scripted(seed);
    assert.ok(a.hashes.length > 5);
    assert.deepEqual(a.hashes, b.hashes);
    assert.deepEqual(G.runOver(a.run), G.runOver(b.run));
  }
  assert.notDeepEqual(scripted(5).hashes.slice(0, 3), scripted(6).hashes.slice(0, 3));
});

test('a run survives a save and resume through JSON mid-match', () => {
  const run = G.newRun({ seed: 21, player: G.rollStarters(21)[0] });
  G.enterNode(run, G.availableNodes(run)[0]);
  G.playCard(run, 0); G.endTurn(run);
  const saved = JSON.parse(JSON.stringify(run));
  const go = r => { for (let t = 0; t < 30 && !r.match.over; t++) { let i; while (!r.match.over && (i = G.handView(r).findIndex(h => h.playable)) >= 0) G.playCard(r, i); if (!r.match.over) G.endTurn(r); } return G.stateHash(r); };
  assert.equal(go(run), go(saved));
});

test('a full run reaches a summary with the §14 fields and the §11 VC figures', () => {
  const r = playRun(3, 'smart');
  const s = G.runOver(r.run);
  for (const k of ['completed', 'phaseReached', 'nodesCleared', 'matchesWon', 'rivals', 'bosses', 'durationTurns', 'summary']) assert.ok(k in s, k);
  assert.ok(s.summary.vc.total >= 0 && s.summary.vc.total <= 8000);
  assert.ok(Array.isArray(s.summary.chars) && s.summary.chars.length > 0);
  assert.equal(G.vcFor({ matchesWon: 20, rivals: 3, bosses: 3, final: true, completed: true }).raw, 13 * 140 + 3 * 300 + 3 * 900 + 2000);
  assert.equal(G.vcFor({ matchesWon: 30, rivals: 5, bosses: 3, final: true, completed: true }).total, 8000, 'capped');
});
