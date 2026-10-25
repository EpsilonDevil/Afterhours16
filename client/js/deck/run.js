// The Gauntlet's run (GAUNTLET.md §1, §5, §11): starting players, the run state, the bracket walk, matches and their
// rewards, Coolers, Shops, Mystery Stops and the summary. Pure: everything is drawn from the run's seed, so the same
// seed and the same choices give the same run (the server re-checks summaries with stateHash).
//
// run.stage: 'map' | 'match' | 'reward' | 'cooler' | 'shop' | 'event' | 'over'
//
// Balance reasoning:
//  * START: 99 coins and the 10-card starter deck; Health is 30 + 6 × the Health stat (§2).
//  * PHASE HEAL: between phases you get back half your missing Health (the genre heals between acts; half keeps a
//    bad Phase 1 meaningful).
//  * COOLER: 30% of max Health (§5), the genre's rest.
//  * CONVERTED players (§1): a build's rating mapped onto 6-10, rolled each run in [base-2, base+1], clamped 1-10.
// Called by: index.js (the UI's whole run flow) and replay.js.
import * as R from './rng.js';
import { STARTER_DECK, cardDef, canUpgrade, known, cardInfo } from './cards.js';
import { maxHpFor, gainAbility, ABILITIES, bumpStat } from './abilities.js';
import { startMatch } from './combat.js';
import { genPhase, pickBoss } from './map.js';
import { normWorld, makeCaster, makePlot, charLine } from './nemesis.js';
import { rewardCards, rewardCoins, rivalAbility, bossAbilities, makeShop, removePrice, vcFor, START_COINS } from './rewards.js';
import { pickEvent, eventView as evView, eventResolve } from './events.js';
import { healRun, removeCardAt, upgradeAt, outcome } from './runlib.js';
import { AIWorld } from '../sim/world.js';

export const STATS = ['stamina', 'shooting', 'defense', 'health'];
// the Gauntlet's rules version (§15): 1 = turns, 2 = possessions (v0.4.8.9 qp4), 3 = the hand max (qp7). Every new run
// records it (run.engine)
export const ENGINE_VERSION = 3;
export const PHASES = 3; // plus the Final (phase 4)
export const PHASE_HEAL = 0.5, COOLER_HEAL = 0.3, ICE_CHEST_HEAL = 0.4;
export const AI_BORN = 1767225600000; // (a fixed birth for an AI world the engine builds itself: names never move)
const clampStat = x => Math.max(1, Math.min(10, Math.round(+x || 1)));

// ---------- players ----------
const START_NAMES = ['Rook', 'Ledger', 'Juke', 'Halftime', 'Sparrow', 'Brick', 'Ozzie', 'Clutch', 'Nova', 'Tempo', 'Shade', 'Pistol', 'Moose', 'Echo', 'Dash', 'Riot'];
export function rollStarters(seed, n = 3) {
  const st = R.stream(seed, 'starters');
  const names = R.sample(st, START_NAMES, n);
  return Array.from({ length: n }, (_, i) => ({ id: `starter-${(seed >>> 0)}-${i}`, name: names[i], look: null, converted: false,
    stats: Object.fromEntries(STATS.map(k => [k, R.int(st, 1, 5)])) }));
}
// a converted player's base for a stat: his build's rating onto 6-10 (60 → 6 ... 99 → 10, linear; below 60 → 6)
export const ratingBase = v => Math.max(6, Math.min(10, 6 + Math.round((Math.max(60, Math.min(99, +v || 0)) - 60) / 39 * 4)));
// (a base already on 6-10, as rollConverted's own output carries it)
export const convertedBase = v => { v = +v || 0; return v <= 10 ? Math.max(6, Math.min(10, Math.round(v))) : ratingBase(v); };
// p: the server's profile entry { id: 'cv-<id>', name, converted: true, stats: {stamina, shooting, defense, health} (0-99
// ratings), build: {...look}, icon }, or one of our own rolls (which carries base, 6-10). The id is kept as it is.
export function rollConverted(seed, p) {
  const st = R.stream(seed, 'converted', p?.id || '');
  const base = p?.base ? Object.fromEntries(STATS.map(k => [k, convertedBase(p.base[k] ?? 8)])) : Object.fromEntries(STATS.map(k => [k, ratingBase(p?.stats?.[k] ?? 80)]));
  const stats = Object.fromEntries(STATS.map(k => [k, clampStat(R.int(st, base[k] - 2, base[k] + 1))]));
  return { ...p, look: p?.look || p?.build || null, base, stats, converted: true };
}

// ---------- the AI world the names and looks come from ----------
const AI_CACHE = new Map();
function aiFor(seed) {
  let ai = AI_CACHE.get(seed);
  if (!ai) { ai = new AIWorld({ seed, born: AI_BORN }, {}); AI_CACHE.set(seed, ai); if (AI_CACHE.size > 8) AI_CACHE.delete(AI_CACHE.keys().next().value); }
  return ai;
}

// ---------- a new run ----------
// opts.ai: the game's AIWorld (app.ai) so names and looks match the park; opts.now: the time the looks are taken at.
// Both are cosmetic: who you face and everything else that decides outcomes comes from seed, player, world (with
// world.aiSeed, the account's AI world seed) and unlocks alone. unlocks: { startAbility?, cards?: [ref] }
export function newRun({ seed = 1, player, world = null, unlocks = null, ai = null, now = undefined } = {}) {
  seed = (seed >>> 0) || 1;
  const w = normWorld(world);
  const p = player || rollStarters(seed, 1)[0];
  const stats = Object.fromEntries(STATS.map(k => [k, clampStat(p.stats?.[k] ?? 3)]));
  const maxHp = maxHpFor(stats.health);
  const run = {
    v: 1, engine: ENGINE_VERSION, seed, player: { id: String(p.id || 'player'), name: String(p.name || 'You'), look: p.look || null, converted: !!p.converted, stats, start: { ...stats } },
    hp: maxHp, maxHp, bonusHp: 0, coins: START_COINS, deck: STARTER_DECK.slice(), abilities: [],
    phase: 1, at: null, stage: 'map', node: null, match: null, event: null, shop: null, cooler: null, reward: null,
    map: { phases: [] }, chars: {}, sideline: [], wc: {}, plot: null, outcomes: [], usedChars: [], seenEvents: [],
    flags: {}, rs: R.stream(seed, 'run'), cleared: [], matchCount: 0, removals: 0, over: null,
    log: { matchesWon: 0, rivals: 0, bosses: 0, final: false, turns: 0, cardsPlayed: 0, nonMatch: 0, nodes: [], killer: null, bossesFaced: [] },
    unlocks: unlocks || null,
  };
  const caster = makeCaster(run, w, ai, now, aiFor(w.aiSeed)); // (outcomes from world.aiSeed; ai / now: names and looks only)
  const bst = R.stream(seed, 'bosses');
  let nemFree = !!caster.nemesis;
  for (let ph = 1; ph <= PHASES + 1; ph++) {
    const bossFor = phase => { if (phase === 4) return pickBoss(bst, 4, false); const b = pickBoss(bst, phase, nemFree); if (b === 'nemesis') nemFree = false; return b; };
    run.map.phases.push(genPhase(seed, ph, caster.cast, bossFor));
  }
  // the people at the Mystery Stops: a sideline cast, and a snapshot of the world's characters this run met
  for (let k = 0; k < 8; k++) run.sideline.push(caster.extra('match', 1 + (k % 3), 'side' + k).charId);
  let extra = 0;
  for (const [id, c] of Object.entries(w.chars).sort((a, b) => (b[1].grudge + b[1].owes + b[1].rank) - (a[1].grudge + a[1].owes + a[1].rank) || (a[0] < b[0] ? -1 : 1))) { if (!run.chars[id] && extra < 12 && (c.grudge || c.owes || c.rank >= 1)) { caster.register(id); extra++; } }
  for (const id of Object.keys(run.chars)) if (w.chars[id]) { const c = w.chars[id]; run.wc[id] = { name: c.name, rank: c.rank, grudge: c.grudge, owes: c.owes, rel: { ...c.rel }, memories: c.memories.slice(), traits: c.traits.slice() }; }
  run.plot = makePlot(run, w, caster);
  if (unlocks?.startAbility && ABILITIES[unlocks.startAbility]) gainAbility(run, unlocks.startAbility);
  for (const r of unlocks?.cards || []) if (known(r) && cardDef(r).type !== 'fatigue') run.deck.push(r);
  return run;
}

// ---------- the bracket ----------
export const nodeOf = (run, id) => { for (const p of run.map.phases) if (p.nodes[id]) return p.nodes[id]; return null; };
const phaseMap = (run, ph) => run.map.phases[ph - 1];
export function availableNodes(run) {
  if (run.over || run.stage === 'match' || run.stage === 'reward' || run.stage === 'event' && !run.event?.done || run.stage === 'cooler') return [];
  if (!run.at) return phaseMap(run, run.phase).rows[0].slice();
  const n = nodeOf(run, run.at);
  if (n.kind === 'boss') return n.phase < run.phase && phaseMap(run, run.phase) ? phaseMap(run, run.phase).rows[0].slice() : [];
  return n.next.slice();
}
function foeOf(run, charId) { const c = run.chars[charId]; return { charId, name: c.name, style: c.style, rank: c.rank, traits: c.traits.slice() }; }
export function enterNode(run, nodeId) {
  const ok = availableNodes(run);
  if (!ok.includes(nodeId)) return { kind: null, error: 'You can\'t go there.' };
  const n = nodeOf(run, nodeId);
  // the Rivals you went around this round survive you (§8: they grow)
  const prev = run.at ? nodeOf(run, run.at) : null;
  if (prev && prev.kind === 'boss' && n.phase !== run.phase) { /* (handled when the boss fell) */ }
  for (const sib of ok) { if (sib === nodeId) continue; const s = nodeOf(run, sib); if (s.kind === 'rival' && s.foes?.[0] && run.wc[s.foes[0].charId]) outcome(run, s.foes[0].charId, 'dodged', { kind: 'rival' }); }
  if (run.stage === 'shop' || run.stage === 'event') leaveNode(run);
  run.at = nodeId; run.node = { id: nodeId, kind: n.kind, done: false };
  run.log.nodes.push(nodeId);
  if (n.kind === 'match' || n.kind === 'rival' || n.kind === 'boss') {
    run.stage = 'match'; run.matchCount++;
    const m = startMatch(run, n);
    applyMatchFlags(run, m, n);
    return { kind: n.kind, node: n.id };
  }
  run.log.nonMatch++;
  if (n.kind === 'cooler') { run.stage = 'cooler'; run.cooler = { used: false }; }
  if (n.kind === 'shop') { run.stage = 'shop'; run.shop = makeShop(R.stream(run.seed, 'shop', nodeId), run, n.phase); }
  if (n.kind === 'event') { run.stage = 'event'; const e = pickEvent(run, nodeId); run.event = { ...e, done: false }; }
  return { kind: n.kind, node: n.id };
}
function applyMatchFlags(run, m, n) {
  if (run.flags.nextHot) { m.you.status.hot = (m.you.status.hot || 0) + run.flags.nextHot; delete run.flags.nextHot; }
  if (n.kind === 'boss' && run.flags.bossExposed === n.phase) { for (const o of m.opps) o.status.exposed = (o.status.exposed || 0) + 2; delete run.flags.bossExposed; }
}
export function leaveNode(run) {
  if (run.stage === 'shop' || run.stage === 'cooler' || (run.stage === 'event' && run.event?.done)) { finishNode(run); return true; }
  return false;
}
function finishNode(run) {
  if (run.node && !run.node.done) { run.node.done = true; run.cleared.push(run.node.id); }
  run.stage = run.over ? 'over' : 'map';
}

// ---------- after a match ----------
export function matchOver(run) {
  const m = run.match;
  if (!m || !m.over) return null;
  if (m.result) return m.result;
  run.hp = Math.max(0, m.you.hp);
  if (m.flags.sixthUsed) run.flags.sixthUsed = true;
  run.log.turns += m.turn; run.log.cardsPlayed += m.log.played;
  const n = nodeOf(run, m.id) || run.fightNode;
  const topTag = Object.entries(m.log.tags).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || null;
  const finTag = m.log.finisher ? (cardDef(m.log.finisher).tags[0] || topTag) : topTag;
  const ph = n?.phase || run.phase;
  if (!m.over.won) {
    const killer = (m.opps.find(o => o.heart > 0) || m.opps[0]);
    run.log.killer = killer?.charId || null;
    if (killer) outcome(run, killer.charId, 'lost', { tag: topTag, kind: m.kind });
    if (m.betray?.done) outcome(run, m.betray.charId, 'betrayed', { kind: m.kind });
    run.over = { completed: false }; run.stage = 'over';
    m.result = { won: false, reward: null };
    return m.result;
  }
  // a win
  run.log.matchesWon++;
  if (m.kind === 'rival') run.log.rivals++;
  if (m.kind === 'boss' && ph <= PHASES) { run.log.bosses++; }
  if (m.kind === 'boss' && ph > PHASES) run.log.final = true;
  if (m.kind === 'boss') run.log.bossesFaced.push(m.boss);
  for (const o of m.opps) if (o.charId && o.charId !== m.betray?.charId) outcome(run, o.charId, 'beat', { tag: finTag, kind: m.kind });
  if (m.betray?.done) outcome(run, m.betray.charId, 'betrayed', { kind: m.kind });
  if (m.lent && !(m.betray?.done && m.betray.charId === m.lent.charId)) outcome(run, m.lent.charId, 'lent', { kind: m.kind });
  if (run.abilities.includes('water_bottle')) healRun(run, 4);
  if (m.kind === 'boss' && ph > PHASES) {
    run.over = { completed: true }; run.stage = 'over';
    m.result = { won: true, reward: null };
    return m.result;
  }
  const st = R.stream(run.seed, 'reward', m.id, run.matchCount);
  const kind = m.kind === 'boss' ? 'boss' : m.kind === 'rival' || m.ambush ? 'rival' : 'match';
  let coins = rewardCoins(st, kind, ph);
  if (run.abilities.includes('tip_jar')) coins += 8;
  if (run.abilities.includes('agent')) coins = Math.round(coins * 1.25);
  if (run.abilities.includes('max_contract')) coins = Math.round(coins / 2);
  if (m.rules.some(r => r.id === 'king_court')) coins = Math.round(coins * 1.5);
  const reward = { cards: rewardCards(st, kind, ph), coins };
  if (kind === 'rival') { const a = rivalAbility(st, run.abilities); if (a) reward.ability = a; }
  if (kind === 'boss') { const l = bossAbilities(st, run.abilities); if (l.length) { reward.abilities = l; reward.ability = l[0]; } }
  run.reward = reward; run.stage = 'reward';
  m.result = { won: true, reward };
  return m.result;
}
// pick: { card: index | null, ability: bool | index }
export function takeReward(run, pick = {}) {
  const m = run.match, rw = run.reward;
  if (run.stage !== 'reward' || !rw) return { ok: false };
  run.coins += rw.coins;
  const out = { ok: true, card: null, ability: null, coins: rw.coins };
  if (pick.card != null && rw.cards[pick.card]) { run.deck.push(rw.cards[pick.card]); out.card = rw.cards[pick.card]; }
  if (pick.ability != null && pick.ability !== false && rw.ability) {
    const id = typeof pick.ability === 'number' && rw.abilities ? rw.abilities[pick.ability] : rw.ability;
    if (id && gainAbility(run, id)) out.ability = id;
  }
  run.reward = null; run.match = null;
  const n = nodeOf(run, m.id);
  if (run.fightNode) { run.fightNode = null; if (run.event) run.event.done = true; }
  finishNode(run);
  // a phase boss down: on to the next phase, half your missing Health back
  if (n && n.kind === 'boss' && n.phase <= PHASES) { run.phase = n.phase + 1; healRun(run, (run.maxHp - run.hp) * PHASE_HEAL); }
  return out;
}

// ---------- Coolers ----------
export function coolerView(run) {
  const a = id => run.abilities.includes(id);
  const heal = Math.round(run.maxHp * (a('ice_chest') ? ICE_CHEST_HEAL : COOLER_HEAL));
  return { options: [
    { id: 'heal', text: `Rest: heal ${heal}`, enabled: !a('superteam') },
    { id: 'upgrade', text: 'Film: upgrade a card', enabled: run.deck.some(r => canUpgrade(r)) },
    ...(a('trainers_table') ? [{ id: 'remove', text: 'Trainer\'s Table: remove a card', enabled: run.deck.length > 1 }] : []),
    ...(a('ice_bucket') ? [{ id: 'icebath', text: 'Ice Bath: +1 Stamina for the run', enabled: !run.flags.iceBath && run.player.stats.stamina < 10 }] : []),
    { id: 'skip', text: 'Move on', enabled: true },
  ] };
}
export function cooler(run, action, cardIndex) {
  if (run.stage !== 'cooler' || run.cooler?.used) return { ok: false, text: 'There\'s no Cooler here.' };
  const opt = coolerView(run).options.find(o => o.id === action);
  if (!opt || !opt.enabled) return { ok: false, text: 'You can\'t do that here.' };
  let text = '';
  if (action === 'heal') { const h = healRun(run, run.maxHp * (run.abilities.includes('ice_chest') ? ICE_CHEST_HEAL : COOLER_HEAL)); text = `You rest. +${h} Health.`; }
  if (action === 'upgrade') { if (!canUpgrade(run.deck[cardIndex])) return { ok: false, text: 'Pick a card to upgrade.' }; const r = upgradeAt(run, cardIndex); text = `${cardDef(r).name}.`; }
  if (action === 'remove') { const r = removeCardAt(run, cardIndex); if (!r) return { ok: false, text: 'Pick a card to remove.' }; text = `${cardDef(r).name} is gone.`; }
  if (action === 'icebath') { run.flags.iceBath = true; bumpStat(run, 'stamina', 1); text = 'Ice Bath: +1 Stamina.'; }
  if (action === 'skip') text = 'You move on.';
  run.cooler.used = true;
  finishNode(run);
  return { ok: true, text };
}

// ---------- Shops ----------
export function shopView(run) {
  const s = run.shop;
  if (!s) return { cards: [], abilities: [], removePrice: removePrice(run) };
  return { cards: s.cards.map(c => ({ ref: c.ref, price: c.price, sold: c.sold, sale: !!c.sale })), abilities: s.abilities.map(a => ({ id: a.id, price: a.price, sold: a.sold })),
    removePrice: removePrice(run), removeUsed: s.removeUsed, coins: run.coins };
}
export function shopBuy(run, kind, index) {
  const s = run.shop;
  if (run.stage !== 'shop' || !s) return { ok: false, text: 'There\'s no Shop here.' };
  const list = kind === 'card' ? s.cards : kind === 'ability' ? s.abilities : null;
  const it = list?.[index];
  if (!it || it.sold) return { ok: false, text: 'Not for sale.' };
  if (run.coins < it.price) return { ok: false, text: 'Not enough coins.' };
  run.coins -= it.price; it.sold = true;
  if (kind === 'card') run.deck.push(it.ref); else gainAbility(run, it.id);
  return { ok: true, text: kind === 'card' ? `${cardDef(it.ref).name} joins your deck.` : `${ABILITIES[it.id].name}.`, coins: run.coins };
}
export function shopRemove(run, cardIndex) {
  const s = run.shop;
  if (run.stage !== 'shop' || !s) return { ok: false, text: 'There\'s no Shop here.' };
  if (s.removeUsed) return { ok: false, text: 'One removal per visit.' };
  const price = removePrice(run);
  if (run.coins < price) return { ok: false, text: 'Not enough coins.' };
  if (cardIndex == null || !run.deck[cardIndex] || run.deck.length <= 1) return { ok: false, text: 'Pick a card to remove.' };
  run.coins -= price; s.removeUsed = true; run.removals++;
  const r = removeCardAt(run, cardIndex);
  return { ok: true, text: `${cardDef(r).name} is gone.`, coins: run.coins };
}

// ---------- Mystery Stops ----------
export function eventView(run) { return evView(run); }
// returns { text, effects: [{ kind, ... }], fight? }. effects only ever use the kinds in EFFECT_KINDS (events.js):
// coins {n}, hp {n}, maxHp {n}, card {ref}, remove {ref}, transform {from, to}, upgrade {cards}, ability {id},
// stat {stat, n}, flag {id}, nemesis {charId, what: 'helped'|'wronged'|'lent'}, fight {}
export function eventChoose(run, i) {
  if (run.stage !== 'event' || !run.event || run.event.done) return { text: '', effects: [], invalid: true };
  const res = eventResolve(run, i);
  if (!res || res.invalid) return res || { text: '', effects: [], invalid: true };
  if (res.fight) {
    // a fight at a Mystery Stop: it plays as a match (a Rival's reward for a challenge, a match's for an ambush)
    const n = nodeOf(run, run.at);
    const fnode = { id: n.id + '-fight', kind: res.fight.kind, phase: n.phase, round: n.round, foes: res.fight.foes.filter(Boolean).map(id => foeOf(run, id)), rules: [], boss: null };
    run.fightNode = fnode; run.stage = 'match'; run.matchCount++;
    const m = startMatch(run, fnode);
    m.ambush = !!res.fight.ambush;
    applyMatchFlags(run, m, fnode);
    run.event.done = true;
    return { ...res, fight: true };
  }
  finishNode(run);
  return res;
}

// ---------- the end ----------
export function runOver(run) {
  if (!run.over) return null;
  const L = run.log;
  const phaseReached = run.over.completed ? 4 : run.phase;
  const vc = vcFor({ matchesWon: L.matchesWon, rivals: L.rivals, bosses: L.bosses, final: L.final, completed: run.over.completed });
  const estMinutes = Math.round((L.cardsPlayed * 15 + L.nonMatch * 30) / 60);
  return {
    completed: !!run.over.completed, phaseReached, nodesCleared: run.cleared.length + (run.over.completed ? 1 : 0), matchesWon: L.matchesWon, rivals: L.rivals, bosses: L.bosses, durationTurns: L.turns,
    summary: {
      seed: run.seed, player: { id: run.player.id, name: run.player.name, converted: run.player.converted, stats: { ...run.player.start }, end: { ...run.player.stats } },
      final: L.final, cardsPlayed: L.cardsPlayed, nonMatchNodes: L.nonMatch, estMinutes, nodes: L.nodes.slice(), bossesFaced: L.bossesFaced.slice(), killer: L.killer,
      deck: run.deck.length, abilities: run.abilities.slice(), coins: run.coins, hp: run.hp, vc, chars: run.outcomes.map(o => ({ ...o })),
    },
  };
}
export { cardInfo, charLine };
