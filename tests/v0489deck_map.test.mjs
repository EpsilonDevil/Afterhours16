// v0.4.8.9 The Gauntlet: the bracket map (3 phases of 13 rounds plus the Final, the node mix, a Cooler before every
// boss, rules and opponents shown on match nodes), Coolers, Shop prices and card removal, and the Mystery Stops.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/deck/index.js';
import { genPhase, ROUNDS } from '../client/js/deck/map.js';
import { PRICES, REMOVE_BASE, REMOVE_STEP } from '../client/js/deck/rewards.js';
import { EVENTS, NEMESIS_EVENTS } from '../client/js/deck/events.js';
import { BOSS_POOLS } from '../client/js/deck/bosses.js';
import { RULE_IDS } from '../client/js/deck/rules.js';

const P = { id: 't', name: 'T', stats: { stamina: 3, shooting: 3, defense: 3, health: 3 } };

test('3 phases of 13 bracket rounds with 2-4 choices, then the Final; every node reachable, every path ends at the boss', () => {
  for (const seed of [1, 2, 3, 99]) {
    const run = G.newRun({ seed, player: P });
    assert.equal(run.map.phases.length, 4);
    for (const ph of run.map.phases) {
      const rows = ph.rows;
      if (ph.phase === 4) { assert.deepEqual(rows.map(r => r.map(id => ph.nodes[id].kind)), [['shop', 'cooler'], ['cooler'], ['boss']]); continue; }
      assert.equal(rows.length, ROUNDS);
      assert.equal(rows[0].length, 3); assert.equal(rows[ROUNDS - 1].length, 1);
      for (let r = 1; r < ROUNDS - 1; r++) assert.ok(rows[r].length >= 2 && rows[r].length <= 4, `round ${r}`);
      assert.ok(rows[0].every(id => ph.nodes[id].kind === 'match'), 'round 1 is all matches');
      // reachability both ways, edges only to the next round
      const reach = new Set(rows[0]);
      for (let r = 0; r < ROUNDS - 1; r++) for (const id of rows[r]) {
        const n = ph.nodes[id];
        assert.ok(n.next.length >= 1, `${id} leads somewhere`);
        for (const c of n.next) { assert.ok(rows[r + 1].includes(c)); if (reach.has(id)) reach.add(c); }
      }
      assert.equal(reach.size, Object.keys(ph.nodes).length, 'every node reachable');
    }
  }
});

test('a Cooler right before every boss, the boss from its phase pool, the Final a Final', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const run = G.newRun({ seed, player: P });
    for (const ph of run.map.phases) {
      const boss = Object.values(ph.nodes).find(n => n.kind === 'boss');
      const parents = Object.values(ph.nodes).filter(n => n.next.includes(boss.id));
      assert.ok(parents.length && parents.every(n => n.kind === 'cooler'), `phase ${ph.phase}`);
      assert.ok([...BOSS_POOLS[ph.phase], 'nemesis'].includes(boss.boss));
      if (ph.phase === 4) assert.ok(BOSS_POOLS[4].includes(boss.boss));
      assert.ok(boss.foes.length >= 1 && boss.foes.every(f => /^ai-\d+$/.test(f.charId)));
    }
  }
  const all = new Set();
  for (let seed = 1; seed <= 200; seed++) for (const ph of G.newRun({ seed, player: P }).map.phases) all.add(Object.values(ph.nodes).find(n => n.kind === 'boss').boss);
  for (const p of [1, 2, 3, 4]) for (const b of BOSS_POOLS[p]) assert.ok(all.has(b), `${b} shows up`);
});

test('the node mix per phase: ~45% matches, 10% Rivals, 15% Coolers, 10% Shops, 20% Mystery Stops', () => {
  const c = {}; let n = 0;
  for (let s = 1; s <= 2000; s++) {
    const p = genPhase(s, 1 + (s % 3), () => [], () => 'the_wall');
    for (const nd of Object.values(p.nodes)) { if (nd.kind === 'boss') continue; c[nd.kind] = (c[nd.kind] || 0) + 1; n++; }
  }
  const want = { match: 0.45, rival: 0.10, cooler: 0.15, shop: 0.10, event: 0.20 };
  for (const [k, v] of Object.entries(want)) assert.ok(Math.abs(c[k] / n - v) < 0.02, `${k}: ${(c[k] / n).toFixed(3)} vs ${v}`);
  // the genre's spacing: no Rival or Cooler in the first 4 rounds, no Shop in the first 2, no repeats of those down a path
  for (let s = 1; s <= 300; s++) {
    const p = genPhase(s, 1, () => [], () => 'the_wall');
    for (const nd of Object.values(p.nodes)) {
      if (nd.round < 4) assert.ok(!['rival', 'cooler'].includes(nd.kind));
      if (nd.round < 2) assert.notEqual(nd.kind, 'shop');
      if (['rival', 'cooler', 'shop'].includes(nd.kind) && nd.round < ROUNDS - 2) for (const c2 of nd.next) if (p.nodes[c2].round < ROUNDS - 2) assert.notEqual(p.nodes[c2].kind, nd.kind);
    }
  }
});

test('match nodes show their opponent and 1-2 rules before you pick them', () => {
  const run = G.newRun({ seed: 5, player: P });
  const v = G.mapView(run);
  let seen = 0, two = 0;
  for (const row of v.rows) for (const n of row) if (['match', 'rival', 'boss'].includes(n.kind)) {
    seen++;
    assert.ok(n.foes.length >= 1 && n.foes[0].name && n.foes[0].style);
    assert.ok(n.rules.length >= 1 && n.rules.length <= 2 && n.rules.every(r => RULE_IDS.includes(r.id) && r.text));
    if (n.rules.length === 2) two++;
    if (n.kind === 'boss') assert.ok(n.boss.title && n.boss.text);
  }
  assert.ok(seen >= 12 && two >= 1);
  // the match you enter has exactly the rules and the opponent the node showed
  const id = G.availableNodes(run)[1], n = G.nodeOf(run, id);
  G.enterNode(run, id);
  assert.deepEqual(run.match.rules.map(r => r.id), n.rules);
  assert.equal(run.match.opps[0].charId, n.foes[0].charId);
  // a node you can't reach is refused
  assert.equal(G.enterNode(run, '1-5-0').kind, null);
});

// walk to the first node of a kind (fighting through with a simple player)
function walkTo(seed, kind) {
  for (let s = seed; s < seed + 200; s++) {
    const run = G.newRun({ seed: s, player: { ...P, stats: { stamina: 5, shooting: 6, defense: 6, health: 10 } } });
    for (let step = 0; step < 14 && !run.over; step++) {
      const av = G.availableNodes(run);
      const hit = av.find(id => G.nodeOf(run, id).kind === kind);
      if (hit) { G.enterNode(run, hit); return run; }
      const id = av.find(x => G.nodeOf(run, x).kind === 'match') || av[0];
      const r = G.enterNode(run, id);
      if (['match', 'rival', 'boss'].includes(r.kind)) {
        for (let t = 0; t < 30 && !run.match.over; t++) { let i; while (!run.match.over && (i = G.handView(run).findIndex(h => h.playable)) >= 0) G.playCard(run, i); if (!run.match.over) G.endTurn(run); }
        if (G.matchOver(run)?.won) G.takeReward(run, { card: null }); else break;
      } else if (r.kind === 'cooler') G.cooler(run, 'skip');
      else if (r.kind === 'shop') G.leaveNode(run);
      else if (r.kind === 'event') { const v = G.eventView(run); const res = G.eventChoose(run, v.choices.findIndex(c => c.enabled)); if (res.fight) break; }
    }
  }
  throw new Error('no ' + kind);
}

test('Shop: 5 cards and 3 abilities at their prices, one on sale; buying; one removal a visit at 75, +25 each time', () => {
  const run = walkTo(1, 'shop');
  assert.equal(run.stage, 'shop');
  const v = G.shopView(run);
  assert.equal(v.cards.length, 5); assert.equal(v.abilities.length, 3);
  assert.equal(v.cards.filter(c => c.sale).length, 1);
  for (const c of v.cards) {
    const r = G.cardInfo(c.ref).rarity, [lo, hi] = PRICES[r];
    if (c.sale) assert.ok(c.price >= Math.round(lo / 2) - 1 && c.price <= Math.round(hi / 2) + 1, `${c.ref} on sale`);
    else assert.ok(c.price >= lo && c.price <= hi, `${c.ref} ${c.price}`);
  }
  assert.equal(v.removePrice, REMOVE_BASE);
  run.coins = 1000;
  const n = run.deck.length;
  const b = G.shopBuy(run, 'card', 0);
  assert.ok(b.ok); assert.equal(run.deck.length, n + 1); assert.equal(run.coins, 1000 - v.cards[0].price);
  assert.equal(G.shopBuy(run, 'card', 0).ok, false, 'sold out');
  const ab = G.shopBuy(run, 'ability', 1); assert.ok(ab.ok); assert.ok(run.abilities.includes(v.abilities[1].id));
  const coins = run.coins, first = run.deck[0];
  const rm = G.shopRemove(run, 0);
  assert.ok(rm.ok); assert.equal(run.deck.length, n); assert.equal(run.coins, coins - REMOVE_BASE);
  assert.equal(G.shopRemove(run, 0).ok, false, 'one removal a visit');
  assert.equal(G.shopView(run).removePrice, REMOVE_BASE + REMOVE_STEP, 'and the next one costs more');
  run.coins = 10;
  const poor = G.shopBuy(run, 'card', 2); assert.equal(poor.ok, false); assert.match(poor.text, /coins/);
  assert.ok(first);
  // leaving: the next round opens
  assert.ok(G.availableNodes(run).length >= 1);
});

test('Cooler: heal 30% or upgrade a card, then on to the next round', () => {
  let run = walkTo(1, 'cooler');
  run.hp = 5;
  const ids = G.coolerView(run).options.map(o => o.id);
  assert.ok(ids.includes('heal') && ids.includes('upgrade') && !ids.includes('remove') && !ids.includes('icebath'));
  assert.ok(G.cooler(run, 'heal').ok); assert.equal(run.hp, 5 + Math.round(run.maxHp * 0.3));
  assert.equal(G.cooler(run, 'heal').ok, false, 'one use');
  assert.ok(G.availableNodes(run).length >= 1);
  run = walkTo(1, 'cooler');
  const i = run.deck.indexOf('crossover');
  assert.equal(G.cooler(run, 'upgrade').ok, false, 'needs a card');
  assert.equal(G.canUpgrade(run.deck[i]), true); assert.equal(G.canUpgrade('crossover+'), false); assert.equal(G.canUpgrade('heavy_legs'), false);
  assert.ok(G.cooler(run, 'upgrade', i).ok); assert.equal(run.deck[i], 'crossover+');
});

test('Mystery Stops: 26 events, 9 nemesis-driven; each one plays out with every choice, and helping or wronging counts', () => {
  assert.ok(EVENTS.length >= 24 && EVENTS.length <= 28);
  assert.ok(NEMESIS_EVENTS.length >= EVENTS.length * 0.3 && NEMESIS_EVENTS.length <= EVENTS.length * 0.4);
  // a run with a world full of history, so every nemesis event has a cast
  const world = G.emptyWorld(3);
  for (let k = 0; k < 6; k++) world.chars['ai-' + (10 + k)] = { id: 'ai-' + (10 + k), name: 'C' + k, rank: 2, traits: [], memories: [], record: { w: 1, l: 0 }, met: 1, last: 1, idle: 0, streak: 0, owes: k % 2, grudge: k < 3 ? 2 : 0, turned: false, rel: k === 0 ? { 'ai-13': 'friend' } : k === 3 ? { 'ai-10': 'friend' } : {} };
  const types = new Set();
  for (const e of EVENTS) {
    const base = G.newRun({ seed: 4, player: P, world });
    const n = Object.values(base.map.phases[0].nodes).find(x => x.kind === 'event') || Object.values(base.map.phases[1].nodes).find(x => x.kind === 'event');
    base.at = n.id; base.stage = 'event'; base.node = { id: n.id, kind: 'event', done: false };
    const choices = (() => { const r = JSON.parse(JSON.stringify(base)); r.event = { id: e.id, ctx: castFor(r, e), rs: { s: 7 }, done: false }; return G.eventView(r).choices; })();
    assert.ok(choices.length >= 2, e.id);
    choices.forEach((c, i) => {
      if (!c.enabled) return;
      const r = JSON.parse(JSON.stringify(base));
      r.coins = 200; r.event = { id: e.id, ctx: castFor(r, e), rs: { s: 7 }, done: false };
      const v = G.eventView(r);
      assert.ok(v.title && v.text && v.text.length > 10, e.id);
      const before = r.outcomes.length;
      const res = G.eventChoose(r, i);
      assert.ok(typeof res.text === 'string' && res.text.length > 3 && Array.isArray(res.effects), `${e.id} ${i}`);
      for (const f of res.effects) types.add(f.kind);
      if (res.fight) { assert.equal(r.stage, 'match'); assert.ok(r.match.opps.length >= 1); }
      else assert.notEqual(r.stage, 'event');
      if (e.nemesis && res.effects.some(f => f.kind === 'nemesis')) assert.ok(r.outcomes.length > before && r.outcomes.slice(before).every(o => ['helped', 'wronged', 'lent'].includes(o.result)));
    });
  }
  for (const k of ['coins', 'hp', 'card', 'ability', 'upgrade', 'remove', 'stat', 'nemesis', 'fight', 'transform']) assert.ok(types.has(k), k);
  for (const k of types) assert.ok(G.EFFECT_KINDS.includes(k), `effect kind ${k} is on the fixed list`);
  assert.deepEqual(G.EFFECT_KINDS, ['coins', 'hp', 'maxHp', 'card', 'remove', 'transform', 'upgrade', 'ability', 'stat', 'flag', 'nemesis', 'fight']);
  // a run picks them from its seed, a third of them nemesis events when there's a cast, and never the same one twice
  let nem = 0, tot = 0;
  for (let s = 1; s <= 60; s++) {
    const run = G.newRun({ seed: s, player: P, world });
    const evs = Object.values(run.map.phases[0].nodes).filter(x => x.kind === 'event');
    const ids = [];
    for (const nd of evs) { run.at = nd.id; const pk = pickFor(run, nd.id); ids.push(pk); tot++; if (NEMESIS_EVENTS.includes(pk)) nem++; }
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.ok(nem / tot > 0.22 && nem / tot < 0.5, `${nem}/${tot}`);
});
import { pickEvent } from '../client/js/deck/events.js';
function pickFor(run, id) { return pickEvent(run, id).id; }
function castFor(run, e) {
  if (!e.nemesis) return { chars: [] };
  const known = Object.keys(run.wc).sort();
  if (e.cast === 'grudgeFriend') return { chars: ['ai-10', 'ai-13'] };
  if (e.cast === 'owed') return { chars: [known.find(id => run.wc[id].owes)] };
  if (e.cast === 'grudge') return { chars: [known.find(id => run.wc[id].grudge)] };
  if (e.cast === 'pair') return { chars: [known[0], run.sideline[0]] };
  return { chars: [e.cast === 'fresh' ? run.sideline[0] : known[0]] };
}
