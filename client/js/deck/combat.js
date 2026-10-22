// The Gauntlet's combat (GAUNTLET.md §2-§4, §9): turns, energy, draw / discard / burn, Stops, statuses, combos and
// Flow chains, Depth / Tight deck-size scaling, the match rules, the abilities that act in a match, the opponents'
// intents and their AI, and the bosses' mechanics. Pure: the match lives in run.match as plain JSON and every
// random draw comes from its own seeded stream (m.rs).
//
// Statuses: Hot n (strength: +n on every Shot hit, all match), Cold n (weak: Shots score 25% less), Exposed n
// (vulnerable: takes 50% more), Gassed n (frail: Stops from cards 25% less). Cold / Exposed / Gassed count down at
// the end of their owner's turn, as in the genre, so a debuff you put on him before your shots lands this turn.
//
// Balance reasoning:
//  * HAND 5, energy from Stamina (3 / 4 / 5): the genre's baseline. MAX_HAND 10.
//  * COLD 0.75, EXPOSED 1.5, GASSED 0.75: the genre's numbers; they're the main reason sequencing matters.
//  * FLOW (+1 energy, draw 1 at 3 different tags, once a turn) is about one free card: worth building around, not
//    automatic (the starter deck has 3 tags only in Crossover + Outlet + one of the 8 basics).
//  * Opponent intent weights avoid the same move 3 times running so a fight never stalls into one pattern.
import * as R from './rng.js';
import { cardDef, TIGHT_AT, DEPTH_FROM } from './cards.js';
import { BOSSES, NEMESIS_BOSS, BOSS_DMG, BOSS_PHASE } from './bosses.js';
import { foeStats, READ_TRAIT, RIVAL, PHASE_DMG } from './foes.js';
import { ruleView } from './rules.js';
import { energyFor, ENERGY_ABILITIES } from './abilities.js';

export const HAND = 5, MAX_HAND = 10;
export const COLD = 0.75, EXPOSED = 1.5, GASSED = 0.75;
export const SPOTLIGHT_CARDS = 6;
// The Shadow (a Final): he plays SHADOW.cards of your own cards a turn, their points and Stops at these shares. Tuned so
// the smart starter beats him ~75% of the time (at 3 cards and 70% he never lost; at 4 and 85%, 97%).
export const SHADOW = { cards: 5, pts: 1.0, stops: 0.6 };
// REPUTATION: a converted player (a sacrificed ICON, stats 6-10) is known in every park: his opponents bring more.
// §2's stat formulas are fixed, and at 6-10 they're ~4-5 energy, +3-5 on every card and ~80 Health against a 1-5
// starter's ~3 / +1 / 48, so without this a converted run is a formality (~90% for the smart policy in
// tools/deck_sim.mjs). At +25% Heart and +25% damage it's ~50% (starters ~22%): noticeably better, not trivial.
// (It's steep: +20% gives ~62%, +30% ~40%.) Approved by the lead for v0.4.8.9.
export const REPUTATION = { heart: 1.25, dmg: 1.25 };
const ANIM_MS = { jumper: 900, three: 1000, layup: 900, dunk: 1100, floater: 900, post: 1000, crossover: 600, spin: 650, stepback: 800, pass: 500, lob: 700,
  closeout: 600, contest: 650, block: 800, steal: 600, rebound: 600, celebrate: 700, gassed: 500, foul: 600 };

const rule = (m, id) => m.rules.some(r => r.id === id);
const ab = (m, id) => m.ab.includes(id);
const pw = (m, id) => m.powers.filter(p => p.id === id);
const alive = m => m.opps.filter(o => o.heart > 0);
const oi = (m, o) => m.opps.indexOf(o);

// ---------- events ----------
function ev(m, e) {
  const t = m.evt || 0;
  const out = { t, actor: 'you', anim: null, made: false, points: 0, stops: 0, text: '', ...e };
  m.evq.push(out);
  if (out.anim) m.evt = t + (ANIM_MS[out.anim] || 500);
}
function flush(m) { const q = m.evq; m.evq = []; m.evt = 0; return q; }

// ---------- deck size: Depth and Tight ----------
export function deckSize(m) { return m.deckSize; }
export function isTight(m) {
  if (rule(m, 'half_court')) return true;
  if (rule(m, 'deep_bench')) return false;
  return m.deckSize <= (ab(m, 'minimalist') ? 15 : TIGHT_AT);
}
export function depthSteps(m, per) {
  if (rule(m, 'half_court')) return 0;
  const n = m.deckSize + (rule(m, 'deep_bench') ? 8 : 0) + (ab(m, 'deep_rotation') ? 6 : 0);
  return Math.max(0, Math.floor((n - DEPTH_FROM) / per));
}
export function isClutch(m) {
  if (pw(m, 'always_clutch').length) return true;
  return m.you.hp <= m.you.maxHp * (ab(m, 'clutch_chain') ? 0.7 : 0.5);
}

// ---------- the helper object the bosses' hooks get ----------
const X = {
  ev, oi,
  addCard(m, ref, where = 'discard') {
    if (where === 'draw') m.drawPile.splice(R.int(m.rs, 0, m.drawPile.length), 0, ref);
    else if (where === 'hand' && m.hand.length < MAX_HAND) m.hand.push(ref);
    else m.discard.push(ref);
  },
  lastCard(m) { return m.lastRef ? cardDef(m.lastRef) : null; },
  hurtYou(m, n, anim, text) { m.you.hp -= n; ev(m, { type: 'hurt', actor: 0, anim, points: n, text }); checkDeath(m); },
  twin(m) {
    const a = m.opps[0], f = m.foes[1] || m.foes[0];
    const b = { ...JSON.parse(JSON.stringify(a)), id: 1, charId: f.charId, name: f.name, look: m.looks?.[f.charId] || null, moves: a.moves2, queue: [], mv: { i: 1 } };
    a.shared = b.shared = 'twins';
    m.opps.push(b);
  },
  trio(m) {
    const a = m.opps[0];
    for (let i = 1; i < 3; i++) {
      const f = m.foes[i] || m.foes[0];
      m.opps.push({ ...JSON.parse(JSON.stringify(a)), id: i, charId: f.charId, name: f.name, look: m.looks?.[f.charId] || null, queue: [], mv: { i } });
    }
  },
  shadow(m) { m.shadow = { pile: R.shuffle(m.rs, m.deck.filter(r => cardDef(r)?.type !== 'fatigue')), discard: [] }; },
  shadowIntent(m, o) {
    const sh = m.shadow, cards = [];
    for (let k = 0; k < SHADOW.cards; k++) {
      if (!sh.pile.length) { sh.pile = R.shuffle(m.rs, sh.discard); sh.discard = []; }
      if (!sh.pile.length) break;
      const r = sh.pile.pop(); sh.discard.push(r); cards.push(r);
    }
    // (your own cards, with your Shooting and Defense, at SHADOW's share: he plays them every turn whatever they cost)
    let pts = 0, stops = 0, hot = 0, anim = 'jumper';
    const sb = Math.floor(m.stats.shooting / 2), db = Math.floor(m.stats.defense / 2);
    for (const r of cards) {
      const d = cardDef(r);
      if (d.fx.pts) { pts += ((d.fx.pts || 0) + sb) * (d.fx.hits || 1); anim = d.anim; }
      if (d.fx.stops) stops += d.fx.stops + (d.type === 'defense' ? db : 0);
      if (d.type === 'move' || d.type === 'play' || d.type === 'mentality') hot += 1;
    }
    const names = cards.map(r => cardDef(r).name).join(', ');
    return { kind: pts ? 'shoot' : stops ? 'defend' : 'buff', pts: Math.round(pts * SHADOW.pts), stops: Math.round(stops * SHADOW.stops), hot: Math.min(2, hot), anim, name: `Your own ${names}`, cards };
  },
};

// ---------- building a match ----------
// node.foes: [{ charId, name, look, style, rank, traits }], node.kind, node.boss, node.rules
export function startMatch(run, node) {
  const rs = R.stream(run.seed, 'match', node.id, run.matchCount || 0);
  const stats = run.player.stats;
  const m = {
    id: node.id, kind: node.kind, phase: node.phase, round: node.round, boss: node.boss || null,
    turn: 0, energy: 0, maxEnergy: 0, hand: [], drawPile: [], discard: [], burned: [],
    you: { hp: run.hp, maxHp: run.maxHp, stops: 0, keep: 0, status: {} },
    opps: [], foes: node.foes, rules: (node.rules || []).map(ruleView), score: [0, 0],
    rs, looks: Object.fromEntries((node.foes || []).map(f => [f.charId, run.chars?.[f.charId]?.look || null])), deck: run.deck.slice(), deckSize: run.deck.length, ab: run.abilities.slice(), powers: [],
    converted: !!run.player.converted, stats: { ...stats }, mods: { shooting: 0, defense: 0 }, flags: { sixthUsed: !!run.flags?.sixthUsed },
    t: null, lastRef: null, noShot: 0, evq: [], evt: 0, over: null,
    log: { played: 0, tags: {}, finisher: null, turns: 0, maxTurnPts: 0 }, lent: null, betray: null,
  };
  run.match = m;
  // the opponents
  const ph = node.phase;
  if (node.boss) {
    const def = BOSSES[node.boss], f = node.foes[0];
    let heart, moves, moves2 = null, shooting = f.rank || 0, defense = 0;
    if (def.nemesis) {
      const st = foeStats({ style: f.style, phase: Math.min(3, ph), rank: f.rank, traits: f.traits, rival: true });
      const k = NEMESIS_BOSS.dmg[Math.min(3, ph)] / (RIVAL.dmg * PHASE_DMG[Math.min(3, ph) - 1]);
      heart = NEMESIS_BOSS.heart[Math.min(3, ph)] * (1 + 0.1 * (f.rank || 0)); moves = st.moves.map(mv => ({ ...mv, pts: mv.pts ? Math.round(mv.pts * k) : mv.pts }));
      shooting = st.shooting; defense = st.defense;
    } else { heart = def.heart; moves = (def.cycle || []).map(x => ({ ...x })); moves2 = def.cycle2 ? def.cycle2.map(x => ({ ...x })) : null; if ((f.traits || []).includes('vengeful')) shooting += 2; }
    if ((f.traits || []).includes('iron_man')) heart *= 1.15;
    const [bh, bd] = BOSS_PHASE[Math.min(4, Math.max(1, ph))];
    m.opps.push(mkOpp(m, 0, f, Math.round(heart * bh * heartRule(m)), shooting, defense, moves, { boss: node.boss, cycle: !def.nemesis && !def.intent, moves2, dmgK: (def.nemesis || def.id === 'the_shadow' ? 1 : BOSS_DMG) * bd }));
    if (def.nemesis) m.opps[0].mv.readTag = (f.traits || []).map(t => Object.entries(READ_TRAIT).find(([, v]) => v === t)?.[0]).find(Boolean) || null;
    if (def.setup) def.setup(m, X);
  } else {
    node.foes.forEach((f, i) => {
      const st = foeStats({ style: f.style, phase: ph, round: node.round, rival: node.kind === 'rival', rank: f.rank, traits: f.traits || [] });
      const share = node.foes.length > 1 ? 0.62 : 1; // (two at once: an ambush; each a bit lighter)
      m.opps.push(mkOpp(m, i, f, Math.round(st.heart * share * heartRule(m)), st.shooting, st.defense, st.moves, {}));
    });
  }
  // the energy and the starting statuses
  m.maxEnergy = energyFor(stats.stamina) + m.ab.filter(a => ENERGY_ABILITIES.includes(a)).length + (rule(m, 'run_and_gun') ? 1 : 0);
  if (rule(m, 'home_crowd')) m.you.status.hot = 1;
  if (rule(m, 'hostile_crowd')) applyStatus(m, m.you, 'cold', 1);
  for (const o of m.opps) {
    if (o.traits.includes('hot_start')) o.status.hot = (o.status.hot || 0) + 1;
    if (o.traits.includes('trash_mouth')) applyStatus(m, m.you, 'cold', 1);
  }
  // the piles
  m.drawPile = R.shuffle(rs, run.deck.slice());
  if (ab(m, 'signature_shoe')) X.addCard(m, 'ticky_tack', 'draw');
  if (ab(m, 'pregame_meal') && (node.kind === 'rival' || node.kind === 'boss')) heal(m, 8, 'Pre-Game Meal');
  // the nemesis plot: an ally lends you a card, a betrayer waits for the boss's bad moment
  const plot = run.plot || {};
  const lend = (plot.lends || []).find(l => l.node === node.id);
  if (lend) m.lent = { charId: lend.charId, card: lend.card, name: lend.name };
  if (plot.betray && plot.betray.node === node.id) m.betray = { ...plot.betray, done: false };
  for (const o of m.opps) fillQueue(m, o);
  startTurn(m);
  if (m.lent) { X.addCard(m, m.lent.card, 'hand'); ev(m, { type: 'ally', actor: 'you', anim: 'pass', text: `${m.lent.name} has your back: he lends you ${cardDef(m.lent.card).name} for this match.` }); }
  refreshIntents(m);
  m.intro = flush(m); // (the match's opening events: turn 1, an ally's lent card, the abilities that fire at the start)
  return m;
}
function heartRule(m) { return (rule(m, 'short_game') ? 0.75 : 1) * (rule(m, 'king_court') ? 1.2 : 1) * (m.converted ? REPUTATION.heart : 1); }
function mkOpp(m, i, f, heart, shooting, defense, moves, o) {
  return { id: i, charId: f.charId, name: f.name, look: f.look || m.looks?.[f.charId] || null, style: f.style, rank: f.rank || 0, traits: (f.traits || []).slice(),
    heart, maxHeart: heart, stops: 0, status: {}, shooting, defense, moves, moves2: o.moves2 || null, boss: o.boss || null, cycle: !!o.cycle,
    queue: [], intent: null, next: null, mv: { i: 0, last: [] }, shared: null, dmgK: (o.dmgK || 1) * (m.converted ? REPUTATION.dmg : 1) };
}

// ---------- intents ----------
function rawMove(m, o, turn) {
  const def = o.boss && BOSSES[o.boss];
  if (def?.intent) return def.intent(m, o, X, turn);
  const list = (o.mv.second || (o.shared && o.id === 1)) && o.moves2 ? o.moves2 : o.moves;
  if (o.cycle || def) { const mv = list[o.mv.i % list.length]; o.mv.i++; return { ...mv }; }
  // weighted, never the same move 3 times running
  const last = o.mv.last;
  const opts = list.map((mv, i) => [i, (last.length >= 2 && last[0] === i && last[1] === i) ? 0 : mv.w || 1]);
  const i = R.weighted(m.rs, opts);
  o.mv.last = [i, ...last].slice(0, 2);
  return { ...list[i] };
}
function fillQueue(m, o) { while (o.queue.length < 2) o.queue.push(rawMove(m, o, m.turn + 1 + o.queue.length)); }
// what one of his hits scores on you now
export function oppHit(m, o, mv) {
  let p = Math.round((mv.pts || 0) * (o.dmgK || 1)) + o.shooting + (o.status.hot || 0);
  if (rule(m, 'run_and_gun')) p += 2;
  if (rule(m, 'physical')) p -= 1;
  if (rule(m, 'up_tempo')) p += 1;
  if (rule(m, 'overtime') && m.turn >= 5) p += 3;
  let k = 1;
  if (rule(m, 'threes_double') && mv.anim === 'three') k *= 1.5;
  if (rule(m, 'short_game')) k *= 1.25;
  const def = o.boss && BOSSES[o.boss];
  if (def?.dmgMult) k *= def.dmgMult(m, o);
  if (o.traits.includes('closer') && o.heart <= o.maxHeart / 2) k *= 1.5;
  if (o.status.cold) k *= COLD;
  if (m.you.status.exposed) k *= EXPOSED;
  return Math.max(0, Math.floor(p * k));
}
function oppHits(m, o, mv) { const def = o.boss && BOSSES[o.boss]; return (mv.hits || 1) * (def?.hitsMult ? def.hitsMult(m, o) : 1); }
function oppStops(m, o, mv) {
  if (!mv.stops) return 0;
  let s = mv.stops + o.defense + (rule(m, 'physical') ? 2 : 0);
  if (o.status.gassed) s = Math.floor(s * GASSED);
  return Math.max(0, s);
}
function intentView(m, o, mv) {
  if (!mv) return null;
  if (ab(m, 'franchise_tag')) return { kind: 'unknown', value: null, text: '?', anim: null };
  const hits = oppHits(m, o, mv), per = mv.pts ? oppHit(m, o, mv) : 0, stops = oppStops(m, o, mv);
  const parts = [];
  if (mv.pts) parts.push(hits > 1 ? `Shoot ${per}×${hits}` : `Shoot ${per}`);
  if (stops) parts.push(`${stops} Stops`);
  if (mv.hot) parts.push(`Hot ${mv.hot}`);
  if (mv.you) for (const [k, n] of Object.entries(mv.you)) parts.push(`${k[0].toUpperCase() + k.slice(1)} ${n}`);
  if (mv.fatigue) parts.push(`+${mv.fatigue.n} ${cardDef(mv.fatigue.id)?.name || 'Fatigue'}`);
  return { kind: mv.kind, value: mv.pts ? per * hits : stops || mv.hot || 0, text: `${mv.name ? mv.name + ': ' : ''}${parts.join(', ')}`, anim: mv.anim || null, pts: per, hits, stops, name: mv.name || '' };
}
export function refreshIntents(m) {
  for (const o of m.opps) {
    if (o.heart <= 0) { o.intent = null; o.next = null; continue; }
    const def = o.boss && BOSSES[o.boss];
    if (def?.live && o.queue.length) o.queue[0] = def.intent(m, o, X, m.turn);
    o.intent = intentView(m, o, o.queue[0]);
    o.next = ab(m, 'scouting_report') ? intentView(m, o, o.queue[1]) : null;
  }
}

// ---------- statuses, healing, hits ----------
function applyStatus(m, who, k, n) {
  if (!n) return false;
  if (rule(m, 'tight_whistle') && k !== 'hot') return false;
  if (who === m.you && k === 'cold' && ab(m, 'sweatband') && !m.flags.sweatband) { m.flags.sweatband = true; ev(m, { type: 'ability', text: 'Sweatband: you shake off the Cold.' }); return false; }
  who.status[k] = (who.status[k] || 0) + n;
  return true;
}
function tick(who) { for (const k of ['cold', 'exposed', 'gassed']) if (who.status[k]) { who.status[k]--; if (!who.status[k]) delete who.status[k]; } }
function heal(m, n, why = '') {
  if (rule(m, 'no_timeouts')) { ev(m, { type: 'heal', text: 'No Timeouts: no healing tonight.' }); return 0; }
  const h = Math.max(0, Math.min(n, m.you.maxHp - m.you.hp));
  m.you.hp += h;
  ev(m, { type: 'heal', anim: null, points: h, text: `${why ? why + ': ' : ''}heal ${h}.` });
  return h;
}
function target(m, ti) { const o = m.opps[ti]; return o && o.heart > 0 ? o : alive(m)[0] || null; }
// one of your hits on him: Stops first, then Heart
function hitOpp(m, o, pts, anim, text) {
  const def = o.boss && BOSSES[o.boss];
  if (def?.onHit) { const before = pts; pts = def.onHit(m, o, pts); if (pts < before) ev(m, { type: 'wall', actor: oi(m, o), anim: 'block', stops: before - pts, text: `${o.name} eats ${before - pts} of it.` }); }
  const absorbed = Math.min(o.stops, pts);
  o.stops -= absorbed;
  let dmg = pts - absorbed;
  if (dmg >= o.heart && rule(m, 'win_by_2') && !o.mv.winBy2) {
    o.mv.winBy2 = true; dmg = Math.max(0, o.heart - 1);
    o.heart -= dmg; m.score[0] += dmg;
    const h = Math.round(o.maxHeart * 0.2); o.heart += h;
    ev(m, { type: 'shot', actor: 'you', anim, made: dmg > 0, points: dmg, stops: absorbed, target: oi(m, o), text });
    ev(m, { type: 'heal', actor: oi(m, o), anim: 'celebrate', points: h, text: `Win By 2: ${o.name} hangs on at 1 and heals ${h}.` });
    syncShared(m, o);
    return dmg;
  }
  o.heart -= dmg; m.score[0] += dmg; m.t.scored += dmg;
  ev(m, { type: 'shot', actor: 'you', anim, made: dmg > 0, points: dmg, stops: absorbed, target: oi(m, o), text });
  if (o.mv.bank) { o.stops += o.mv.bank; o.mv.bank = 0; }
  syncShared(m, o);
  if (def?.onLow && o.heart > 0) def.onLow(m, o, X);
  if (o.heart <= 0) oppDown(m, o);
  return dmg;
}
function syncShared(m, o) { if (o.shared) for (const p of m.opps) if (p !== o && p.shared === o.shared) p.heart = o.heart; }
function oppDown(m, o) {
  const def = o.boss && BOSSES[o.boss];
  if (def?.onDeath && def.onDeath(m, o, X)) { o.queue = []; fillQueue(m, o); return; }
  o.heart = 0; o.stops = 0;
  if (o.shared) for (const p of m.opps) if (p.shared === o.shared) { p.heart = 0; p.stops = 0; }
  ev(m, { type: 'down', actor: oi(m, o), anim: 'gassed', text: `${o.name} is done.` });
  checkWin(m);
}
function checkWin(m) { if (!m.over && !alive(m).length) { m.over = { won: true }; ev(m, { type: 'end', anim: 'celebrate', text: 'Game. You win.' }); } }
function checkDeath(m) {
  if (m.over || m.you.hp > 0) return;
  if (ab(m, 'sixth_man') && !m.flags.sixthUsed) {
    m.flags.sixthUsed = true; m.you.hp = Math.max(1, Math.floor(m.you.maxHp * 0.25));
    ev(m, { type: 'ability', anim: 'celebrate', text: 'Sixth Man: you get up off the floor.' });
    return;
  }
  m.you.hp = Math.max(0, m.you.hp);
  m.over = { won: false };
  ev(m, { type: 'end', actor: 0, anim: 'gassed', text: 'You\'re out.' });
}
// one of his hits on you
function hitYou(m, o, pts, anim, text) {
  const absorbed = Math.min(m.you.stops, pts);
  m.you.stops -= absorbed;
  let dmg = pts - absorbed;
  if (dmg > 0 && ab(m, 'mouthguard') && !m.flags.mouthguard) { m.flags.mouthguard = true; ev(m, { type: 'ability', text: 'Mouthguard: that one doesn\'t count.' }); dmg = 0; }
  m.you.hp -= dmg; m.score[1] += dmg;
  ev(m, { type: 'shot', actor: oi(m, o), anim, made: dmg > 0, points: dmg, stops: absorbed, text });
  checkDeath(m);
  return dmg;
}

// ---------- your turn ----------
function newTurnState() { return { played: [], last: null, chain: [], wild: 0, flows: 0, shots: 0, scored: 0, cheap: 0, next: [], firstDef: false, firstDrive: false, firstPass: false, firstShot: false, tagDraws: 0, passes: 0, combo: false, mitt: 0, hotHand: false, trash: false, flowed: false, pressBroken: false }; }
export function startTurn(m) {
  m.turn++;
  m.t = newTurnState();
  // Stops reset; Hustle Stops last into this turn
  m.you.stops = Math.min(m.you.stops, m.you.keep); m.you.keep = 0;
  const charge = m.you.status.charge || 0; delete m.you.status.charge;
  m.energy = m.maxEnergy + charge + (m.turn === 1 && ab(m, 'captains_band') ? 1 : 0) + pw(m, 'tight_energy').reduce((s, p) => s + (isTight(m) ? p.n : 0), 0);
  if (m.turn === 1 && ab(m, 'captains_band')) m.you.status.hot = (m.you.status.hot || 0) + 1;
  if (m.turn === 1 && ab(m, 'wristbands')) { m.you.stops += 5; ev(m, { type: 'stops', stops: 5, text: 'Wristbands: 5 Stops.' }); }
  for (const p of pw(m, 'turn_stops')) gainStops(m, p.n, false, 'Defensive Mindset');
  for (const p of pw(m, 'depth_stops')) gainStops(m, Math.floor(m.deckSize / p.n), false, 'Deep Bench');
  for (const p of pw(m, 'turn_cold')) for (const o of alive(m)) applyStatus(m, o, 'cold', p.n);
  let n = HAND + (rule(m, 'up_tempo') ? 1 : 0) + (ab(m, 'superteam') ? 1 : 0) + pw(m, 'turn_draw').reduce((s, p) => s + p.n, 0);
  for (const o of alive(m)) { const d = o.boss && BOSSES[o.boss]; if (d?.drawMod) n += d.drawMod; }
  if (m.turn === 1) n += (ab(m, 'playbook') ? 2 : 0) - (ab(m, 'ankle_weights') ? 1 : 0);
  draw(m, n);
  ev(m, { type: 'turn', text: `Turn ${m.turn}.` });
}
function draw(m, n) {
  let guard = 0;
  for (let k = 0; k < n && guard < 40; guard++) {
    if (m.hand.length >= MAX_HAND) break;
    if (!m.drawPile.length) { if (!m.discard.length) break; m.drawPile = R.shuffle(m.rs, m.discard); m.discard = []; }
    const r = m.drawPile.pop(), d = cardDef(r);
    if (d?.type === 'fatigue' && rule(m, 'no_blood')) { m.burned.push(r); ev(m, { type: 'burn', text: `No Blood, No Foul: ${d.name} burns.` }); continue; }
    m.hand.push(r); k++;
    if (d?.fx?.drawn?.energy) { m.energy = Math.max(0, m.energy + d.fx.drawn.energy); ev(m, { type: 'energy', anim: 'foul', text: `${d.name}: ${d.fx.drawn.energy} energy.` }); }
  }
}
function gainStops(m, n, hustle, why) {
  if (n <= 0) return 0;
  m.you.stops += n; if (hustle) m.you.keep += n;
  ev(m, { type: 'stops', stops: n, text: `${why ? why + ': ' : ''}${n} Stops.` });
  return n;
}

// the cost of a card in your hand right now (null: unplayable)
export function costOf(m, ref) {
  const d = cardDef(ref);
  if (!d || d.unplayable || d.cost == null) return null;
  let c = d.cost;
  for (const o of alive(m)) {
    if (o.traits.includes('read_handle') && d.tags.includes('Handle')) c += 1;
    if (o.traits.includes('read_pass') && d.tags.includes('Pass')) c += 1;
    const def = o.boss && BOSSES[o.boss];
    if (def?.costMod) c += def.costMod(m, d);
  }
  if (rule(m, 'ball_movement') && d.tags.includes('Pass') && !m.t.firstPass) c = 0;
  if (m.t.cheap) c -= m.t.cheap;
  return Math.max(0, c);
}
export function canPlay(m, i) {
  const r = m.hand[i], d = cardDef(r);
  if (!d || m.over) return { ok: false, why: 'The match is over.' };
  const c = costOf(m, r);
  if (c == null) return { ok: false, why: `${d.name} can't be played.` };
  if (d.type === 'mentality' && rule(m, 'old_school')) return { ok: false, why: 'Old School: no Mentalities.' };
  if (ab(m, 'spotlight') && m.t.played.length >= SPOTLIGHT_CARDS) return { ok: false, why: 'Spotlight: 6 cards a turn.' };
  if (c > m.energy) return { ok: false, why: 'Not enough energy.' };
  return { ok: true, cost: c };
}

// the fx a card resolves with right now (its own, plus combo / Tight / Clutch / Depth)
function liveFx(m, d) {
  const fx = d.fx, out = { ...fx, add: 0, addStops: 0, mult: 1, comboHit: false };
  delete out.combo; delete out.tight; delete out.clutch; delete out.depth;
  const merge = x => {
    for (const [k, v] of Object.entries(x)) {
      if (k === 'tag') continue;
      if (k === 'pts') out.add += v;
      else if (k === 'stops') out.addStops += v;
      else if (k === 'mult') out.mult *= v;
      else if (k === 'foe') out.foe = { ...(out.foe || {}), ...Object.fromEntries(Object.entries(v).map(([s, n]) => [s, (out.foe?.[s] || 0) + n])) };
      else if (typeof v === 'number') out[k] = (out[k] || 0) + v;
      else out[k] = v;
    }
  };
  if (fx.combo && m.t.last && m.t.last.includes(fx.combo.tag)) { merge(fx.combo); out.comboHit = true; }
  if (fx.tight && isTight(m)) merge(fx.tight);
  if (fx.clutch && isClutch(m)) merge(fx.clutch);
  if (fx.depth) { const b = depthSteps(m, fx.depth.per) * fx.depth.add; if (fx.depth.k === 'pts') out.add += b; else out.addStops += b; }
  return out;
}
// what one hit of a Shot card scores against o (before his Stops), and how many hits
export function shotValue(m, d, o, peek = true) {
  const f = liveFx(m, d);
  let p = (f.pts || 0) + f.add;
  if (f.special === 'first_card' && m.t.played.length === 0) p += f.bonus;
  if (f.special === 'per_tag_played') p += f.bonus * m.t.played.filter(r => cardDef(r).tags.includes(f.tag)).length;
  if (f.special === 'per_type_played') p += f.bonus * m.t.played.filter(r => cardDef(r).type === f.ptype).length;
  for (const nx of m.t.next) if (!nx.tag || d.tags.includes(nx.tag)) p += nx.add;
  for (const pp of pw(m, 'tag_pts')) if (d.tags.includes(pp.tag)) p += pp.n;
  if (ab(m, 'heavy_ball') && d.tags.includes('Post')) p += 2;
  if (ab(m, 'chalk_bag') && m.turn === 1) p += 3;
  if (rule(m, 'and_one_night') && !m.t.firstShot) p += 3;
  if (rule(m, 'physical')) p -= 1;
  if (rule(m, 'run_and_gun')) p += 2;
  if (rule(m, 'overtime') && m.turn >= 5) p += 3;
  if (rule(m, 'windy')) { if (d.tags.includes('Perimeter')) p -= 2; if (d.tags.includes('Drive')) p += 2; }
  if (o) for (const [tag, tr] of [['Drive', 'read_drive'], ['Post', 'read_post'], ['Perimeter', 'read_perimeter']]) if (o.traits.includes(tr) && d.tags.includes(tag)) p -= tr === 'read_perimeter' ? 2 : 3;
  p -= m.hand.filter(r => cardDef(r)?.fx?.inHand?.shot).length;
  p += Math.floor((m.stats.shooting + m.mods.shooting) / 2) + (m.you.status.hot || 0);
  let k = f.mult;
  if (ab(m, 'lucky_headband') && !m.flags.lucky) k *= 2;
  if (rule(m, 'threes_double') && d.tags.includes('Perimeter')) k *= 1.5;
  if (m.you.status.cold) k *= COLD;
  if (o && o.status.exposed) k *= EXPOSED;
  const hits = (f.hits || 1) * (f.special === 'flow_triple' && m.t.flowed ? 3 : 1);
  return { per: Math.max(0, Math.floor(p * k)), hits };
}
export function stopsValue(m, d) {
  const f = liveFx(m, d);
  if (!f.stops && !f.addStops) return 0;
  let s = (f.stops || 0) + f.addStops;
  if (d.type === 'defense') s += Math.floor((m.stats.defense + m.mods.defense) / 2) + (rule(m, 'physical') ? 2 : 0) + (ab(m, 'knee_pads') && !m.t.firstDef ? 3 : 0);
  if (d.tags.includes('Hustle')) { if (ab(m, 'hustle_tape')) s += 2; if (alive(m).some(o => o.traits.includes('read_hustle'))) s -= 3; }
  if (m.you.status.gassed) s = Math.floor(s * GASSED);
  return Math.max(0, s);
}

export function playCard(run, handIndex, ti = 0) {
  const m = run.match;
  if (!m || m.over) return [];
  const chk = m.hand[handIndex] == null ? { ok: false, why: 'No such card.' } : canPlay(m, handIndex);
  if (!chk.ok) return [{ t: 0, type: 'invalid', actor: 'you', anim: null, made: false, points: 0, stops: 0, text: chk.why }];
  const ref = m.hand[handIndex], d = cardDef(ref);
  m.energy -= chk.cost;
  m.t.cheap = 0;
  m.hand.splice(handIndex, 1);
  const o = target(m, ti);
  ev(m, { type: 'card', card: ref, anim: d.type === 'shot' ? null : d.anim, text: `You play ${d.name}.` });
  if (ab(m, 'drive_lanes') && d.tags.includes('Drive') && !m.t.firstDrive && o) { m.t.firstDrive = true; if (applyStatus(m, o, 'exposed', 1)) ev(m, { type: 'status', text: `Driving Lanes: ${o.name} is Exposed 1.` }); }
  const f = liveFx(m, d);
  // Shots
  if (d.type === 'shot' || f.pts) {
    const sv = shotValue(m, d, o);
    const startScore = m.t.scored;
    for (let h = 0; h < sv.hits; h++) {
      const tg = target(m, ti); if (!tg) break;
      const per = h === 0 ? sv.per : shotValue(m, d, tg).per;
      hitOpp(m, tg, per, d.anim, `${d.name}: ${per}.`);
      if (m.over) break;
    }
    if (d.type === 'shot') {
      m.t.shots++; m.t.firstShot = true; m.noShot = -1; m.t.next = m.t.next.filter(nx => !(!nx.tag || d.tags.includes(nx.tag)));
      if (ab(m, 'lucky_headband') && !m.flags.lucky) { m.flags.lucky = true; ev(m, { type: 'ability', text: 'Lucky Headband: double.' }); }
      if (rule(m, 'make_it_take_it') && m.t.scored > startScore && m.t.mitt < 2) { m.t.mitt++; draw(m, 1); ev(m, { type: 'draw', text: 'Make-It-Take-It: draw 1.' }); }
    }
  }
  if (!m.over) {
    // Stops, healing, energy, draws, statuses, setups
    const s = stopsValue(m, d);
    if (s) gainStops(m, s, !!f.hustle, d.name);
    if (d.type === 'defense') m.t.firstDef = true;
    if (f.selfDmg) { m.you.hp -= f.selfDmg; ev(m, { type: 'hurt', anim: 'foul', points: f.selfDmg, text: `${d.name}: take ${f.selfDmg}.` }); checkDeath(m); }
    if (f.heal) heal(m, f.heal, d.name);
    if (f.energy) { m.energy += f.energy; ev(m, { type: 'energy', text: `+${f.energy} energy.` }); }
    if (f.charge) m.you.status.charge = (m.you.status.charge || 0) + f.charge;
    if (f.hot) { m.you.status.hot = (m.you.status.hot || 0) + f.hot; ev(m, { type: 'status', text: `Hot ${f.hot}.` }); }
    if (f.foe && o && o.heart > 0) for (const [k, n] of Object.entries(f.foe)) if (applyStatus(m, o, k, n)) ev(m, { type: 'status', target: oi(m, o), text: `${o.name} is ${k[0].toUpperCase() + k.slice(1)} ${n}.` });
    if (f.next) m.t.next.push({ ...f.next });
    if (f.cheap) m.t.cheap = f.cheap;
    if (f.special === 'strip' && o) { const n = o.stops; o.stops = 0; ev(m, { type: 'status', anim: 'steal', target: oi(m, o), stops: n, text: `${o.name} loses ${n} Stops.` }); }
    if (f.special === 'burn_fatigue') { const j = m.hand.findIndex(r => cardDef(r)?.type === 'fatigue'); if (j >= 0) { const [b] = m.hand.splice(j, 1); m.burned.push(b); ev(m, { type: 'burn', text: `${cardDef(b).name} burns.` }); } }
    if (f.special === 'stat_match') { m.mods[f.stat] += f.n; ev(m, { type: 'status', text: `+${f.n} ${f.stat} for this match.` }); }
    if (f.special === 'draw_if_exposed' && o && o.status.exposed) f.draw = (f.draw || 0) + 1;
    if (f.draw) draw(m, f.draw);
    if (f.power) { m.powers.push({ ...f.power }); ev(m, { type: 'power', text: `${d.name} is on for the match.` }); }
  }
  // where the card goes
  if (d.type === 'mentality') { /* it stays in play for the match */ } else if (d.burn || d.type === 'fatigue') m.burned.push(ref); else m.discard.push(ref);
  // tags: combos, the Flow chain, the on-play powers and abilities
  if (f.comboHit) {
    m.t.combo = true;
    ev(m, { type: 'combo', text: `Combo ${d.fx.combo.tag}!` });
    for (const p of pw(m, 'combo_hot')) { m.you.status.hot = (m.you.status.hot || 0) + p.n; }
    if (ab(m, 'film_reel') && !m.t.filmReel) { m.t.filmReel = true; m.energy += 1; ev(m, { type: 'ability', text: 'Film Reel: +1 energy.' }); }
  }
  m.t.played.push(ref); m.lastRef = ref; m.t.last = d.wild ? ['Handle', 'Drive', 'Post', 'Perimeter', 'Pass', 'Hustle'] : d.tags.slice();
  m.log.played++; for (const tg of d.tags) m.log.tags[tg] = (m.log.tags[tg] || 0) + 1;
  for (const tg of d.tags) if (!m.t.chain.includes(tg)) m.t.chain.push(tg);
  if (d.wild) m.t.wild++;
  const maxFlows = 1 + pw(m, 'flow_twice').length;
  if (!m.over && m.t.chain.length + m.t.wild >= 3 && m.t.flows < maxFlows) {
    m.t.flows++; m.t.flowed = true; m.t.chain = []; m.t.wild = 0;
    const e = ab(m, 'second_gear') ? 2 : 1;
    m.energy += e; ev(m, { type: 'flow', anim: null, text: `Flow! +${e} energy, draw 1.` }); draw(m, 1);
    if (ab(m, 'metronome')) gainStops(m, 4, false, 'Metronome');
  }
  if (!m.over) {
    for (const p of pw(m, 'tag_stops')) if (d.tags.includes(p.tag)) gainStops(m, p.n, false, 'Mentality');
    for (const p of pw(m, 'tag_draw')) if (d.tags.includes(p.tag) && m.t.tagDraws < 3) { m.t.tagDraws++; draw(m, p.n); }
    if (d.tags.includes('Pass')) { m.t.firstPass = true; m.t.passes++; if (m.t.passes === 2 && ab(m, 'assist_log')) { draw(m, 1); ev(m, { type: 'ability', text: 'Assist Log: draw 1.' }); } }
    if (ab(m, 'jump_rope') && m.t.played.length % 3 === 0) gainStops(m, 3, false, 'Jump Rope');
    for (const op of alive(m)) { const def = op.boss && BOSSES[op.boss]; if (def?.onPlay) def.onPlay(m, d, X); }
    if (!m.t.hotHand && m.t.scored >= 15 && ab(m, 'hot_hand')) { m.t.hotHand = true; m.you.status.hot = (m.you.status.hot || 0) + 1; ev(m, { type: 'ability', text: 'Hot Hand: Hot 1.' }); }
    if (!m.t.trash && m.t.scored >= 12 && rule(m, 'trash_talk')) { m.t.trash = true; m.you.status.hot = (m.you.status.hot || 0) + 1; ev(m, { type: 'rule', text: 'Trash Talk: you\'re Hot 1.' }); }
    betrayCheck(run, m);
  }
  if (d.type === 'shot' || f.pts) m.log.finisher = ref;
  m.log.maxTurnPts = Math.max(m.log.maxTurnPts, m.t.scored);
  refreshIntents(m);
  run.hp = Math.max(0, m.you.hp);
  return flush(m);
}

// the betrayal (§8): a character you helped, turned by a rival of his, switches sides at the boss's bad moment
function betrayCheck(run, m) {
  const b = m.betray;
  if (!b || b.done || !m.opps[0] || m.opps[0].heart > m.opps[0].maxHeart * 0.5) return;
  b.done = true;
  const st = foeStats({ style: b.style, phase: Math.min(3, m.phase), round: 6, rival: true, rank: b.rank || 0, traits: [] });
  const heart = Math.round(st.heart * 0.55 * heartRule(m));
  const o = mkOpp(m, m.opps.length, { charId: b.charId, name: b.name, look: b.look, style: b.style, rank: b.rank, traits: [] }, heart, st.shooting, st.defense, st.moves, {});
  m.opps.push(o); fillQueue(m, o);
  // he takes back what he lent you
  if (m.lent && m.lent.charId === b.charId) for (const pile of ['hand', 'drawPile', 'discard']) { const j = m[pile].indexOf(m.lent.card); if (j >= 0) m[pile].splice(j, 1); }
  ev(m, { type: 'betray', actor: oi(m, o), anim: 'steal', text: b.line || `${b.name} switches sides.` });
}

export function endTurn(run) {
  const m = run.match;
  if (!m || m.over) return [];
  // the Fatigue in your hand bites
  for (const r of m.hand) {
    const d = cardDef(r);
    if (d?.fx?.inHand?.dmg) { m.you.hp -= d.fx.inHand.dmg; ev(m, { type: 'hurt', anim: 'gassed', points: d.fx.inHand.dmg, text: `${d.name}: take ${d.fx.inHand.dmg}.` }); }
    if (d?.fx?.inHand?.cold) applyStatus(m, m.you, 'cold', d.fx.inHand.cold);
  }
  checkDeath(m);
  // discard, except Hold (and one card with Muscle Memory)
  const keep = [];
  let mm = ab(m, 'muscle_memory');
  if (mm) {
    let best = -1, bc = -1;
    m.hand.forEach((r, i) => { const d = cardDef(r); if (d.type !== 'fatigue' && !d.hold && (d.cost || 0) > bc) { bc = d.cost || 0; best = i; } });
    if (best >= 0) keep.push(m.hand[best]), m.hand.splice(best, 1);
  }
  for (const r of m.hand) { const d = cardDef(r); if (d?.hold) keep.push(r); else m.discard.push(r); }
  m.hand = keep;
  tick(m.you);
  // the Shot Clock
  if (rule(m, 'shot_clock')) {
    m.noShot = m.noShot < 0 ? 0 : m.noShot + 1;
    if (m.noShot >= 2) { m.noShot = 0; m.you.hp -= 3; ev(m, { type: 'rule', anim: 'foul', points: 3, text: 'Shot Clock violation: take 3.' }); checkDeath(m); }
  }
  m.log.turns++;
  // their turn
  if (!m.over) for (const o of m.opps.slice()) {
    if (o.heart <= 0 || m.over) continue;
    const def = o.boss && BOSSES[o.boss];
    o.stops = 0;
    if (def?.turnStart) def.turnStart(m, o, X);
    const mv = o.queue.shift() || rawMove(m, o, m.turn);
    let scored = 0;
    // (a move with no shot, Stops or Hot of its own still plays on the court: a debuff, a Fatigue, a special)
    if (!mv.pts && !mv.stops && !mv.hot) ev(m, { type: 'move', actor: oi(m, o), anim: mv.anim || 'crossover', text: `${o.name}: ${mv.name || 'makes a move'}.` });
    if (mv.stops) { const s = oppStops(m, o, mv); o.stops += s; ev(m, { type: 'stops', actor: oi(m, o), anim: mv.pts ? null : mv.anim, stops: s, text: `${o.name}: ${mv.name || 'defends'}, ${s} Stops.` }); }
    if (mv.pts) for (let h = 0, n = oppHits(m, o, mv); h < n && !m.over; h++) scored += hitYou(m, o, oppHit(m, o, mv), mv.anim || 'jumper', `${o.name}: ${mv.name || 'shoots'}.`);
    if (mv.hot) { o.status.hot = (o.status.hot || 0) + mv.hot; ev(m, { type: 'status', actor: oi(m, o), anim: mv.pts || mv.stops ? null : mv.anim, text: `${o.name} is Hot ${o.status.hot}.` }); }
    if (mv.you) for (const [k, n] of Object.entries(mv.you)) if (applyStatus(m, m.you, k, n)) ev(m, { type: 'status', actor: oi(m, o), text: `You're ${k[0].toUpperCase() + k.slice(1)} ${n}.` });
    if (mv.fatigue) { for (let k = 0; k < mv.fatigue.n; k++) X.addCard(m, mv.fatigue.id, 'discard'); ev(m, { type: 'fatigue', actor: oi(m, o), anim: 'foul', text: `${o.name} adds ${mv.fatigue.n} ${cardDef(mv.fatigue.id).name} to your discard.` }); }
    if (rule(m, 'trash_talk') && scored >= 12) o.status.hot = (o.status.hot || 0) + 1;
    tick(o);
    fillQueue(m, o);
  }
  if (!m.over) startTurn(m);
  refreshIntents(m);
  run.hp = Math.max(0, m.you.hp);
  if (m.flags.sixthUsed) (run.flags || (run.flags = {})).sixthUsed = true;
  return flush(m);
}

// the Flow chain this turn, for the UI: the different tags played since the last Flow, the wild cards (Extra Pass)
// counted in, whether Flow has triggered this turn, how many times, the most it can, and how many tags are still needed
export function flowView(run) {
  const m = run.match;
  if (!m || !m.t) return { chain: [], wild: 0, flowed: false, flows: 0, max: 1, need: 3 };
  const max = 1 + pw(m, 'flow_twice').length;
  return { chain: m.t.chain.slice(), wild: m.t.wild, flowed: m.t.flowed, flows: m.t.flows, max, need: m.t.flows >= max ? 0 : Math.max(0, 3 - m.t.chain.length - m.t.wild) };
}
// your hand as the UI shows it: each card's info, its cost right now, whether it can be played and what it'd do
export function handView(run) {
  const m = run.match;
  if (!m) { const e = []; e.flow = flowView(run); return e; }
  const out = m.hand.map((ref, i) => {
    const d = cardDef(ref), chk = canPlay(m, i), o = target(m, 0);
    const sv = d && (d.type === 'shot' || d.fx.pts) && o ? shotValue(m, d, o) : null;
    return { ref, index: i, cost: costOf(m, ref), playable: chk.ok, why: chk.ok ? '' : chk.why, points: sv ? sv.per * sv.hits : 0, hits: sv ? sv.hits : 0, stops: d ? stopsValue(m, d) : 0,
      combo: !!(d?.fx?.combo && m.t.last && m.t.last.includes(d.fx.combo.tag)), lent: m.lent?.card === ref };
  });
  out.flow = flowView(run);
  return out;
}
