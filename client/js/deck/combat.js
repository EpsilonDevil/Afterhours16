// The Gauntlet's combat (GAUNTLET.md §2-§4, §9, §15): a match is a run of possessions. A jump ball decides who has the
// ball first; then every turn one side is on offense and the other on defense. The opponents commit their cards at the
// start of the turn (you see them, unless they're hidden), you play yours with your energy, and End Turn plays both
// sides out together: the clash. Turns, energy, draw / discard / burn, Stops, statuses, combos and Flow chains, Depth /
// Tight deck-size scaling, the match rules, the abilities that act in a match, the opponents' sets and their AI, and the
// bosses' mechanics all live here. Pure: the match lives in run.match as plain JSON and every random draw comes from
// its own seeded stream (m.rs).
//
// THE CLASH (v0.4.8.9 qp4, "the higher number wins"): the offense's number O is the points of its Shots this
// possession (each computed exactly as a Shot always was: Shooting's ⌊stat/2⌋, Hot / Cold / Exposed, combos, Tight,
// Depth, Clutch, Mentalities, abilities, rules); the defense's number D is its Stops pool. O > D: the offense scores
// O − D (off the opponents' Heart, or your run Health). O ≤ D: stopped (defense wins ties). Several shots resolve in
// play order against what's left of the pool, so the total is always max(0, O − D); nothing random touches it.
//
// Stops last until you next defend: Stops a side gains with the ball (a Putback, a Behind the Back, a big's post-up)
// are still there on its next defense; after defending, what's left is gone (Hustle Stops keep one more turn).
// Statuses count down at the end of the possessions where they matter: Exposed on the side defending, Cold on the
// side shooting, Gassed on the side defending; Screened (you can't read the next set) after any possession.
//
// Called by: run.js (startMatch), replay.js, and the UI through index.js (playCard, endTurn, handView, flowView,
// canPlay, matchView).
import * as R from './rng.js';
import { cardDef, cardInfo, TIGHT_AT, DEPTH_FROM } from './cards.js';
import { BOSSES, NEMESIS_BOSS, BOSS_DMG, BOSS_PHASE } from './bosses.js';
import { foeStats, splitMoves, READ_TRAIT, RIVAL, PHASE_DMG, RIDER_P } from './foes.js';
import { ruleView } from './rules.js';
import { energyFor, ENERGY_ABILITIES } from './abilities.js';

// THE HAND (qp7): at most HAND_MAX cards (run.match.handMax: raised for the match by Playbook, Superteam, Up-Tempo,
// Next Play, Motion Offense). A possession's draw fills your hand up to it, never past; any other draw past it (a card's
// "draw N", Flow, Make-It-Take-It, ...) stops and asks, one card at a time: discard a card from your hand to take it, or
// refuse it (it goes to the discard pile). run.match.pendingDraw holds the question; resolveDraw answers it.
export const HAND_MAX = 5;
export const HAND = HAND_MAX, MAX_HAND = HAND_MAX; // (the old names)
export const HAND_FULL = 'Hand full: discard or refuse the card first';
export const COLD = 0.75, EXPOSED = 1.5, GASSED = 0.75;
export const SPOTLIGHT_CARDS = 6;
// The Shadow (a Final): he plays SHADOW.cards of your own cards a possession, their points and Stops at these shares
export const SHADOW = { cards: 5, pts: 1.0, stops: 0.6 };
// REPUTATION: a converted player (a sacrificed ICON, stats 6-10) is known in every park: his opponents bring more.
// §2's stat formulas are fixed, and at 6-10 they're ~4-5 energy, +3-5 on every card and ~80 Health against a 1-5
// starter's ~3 / +1 / 48, so without this a converted run is a formality. Tuned with tools/deck_sim.mjs (smart policy:
// converted ~50%, starters ~20%). Approved by the lead for v0.4.8.9.
export const REPUTATION = { heart: 1.1, dmg: 1.15 }; // (1.25 / 1.25 before the possessions of qp4; 1.15 / 1.2 in qp4)
// FREE THROWS: a fouled shot that goes in is an and-one (FT_AND_ONE of its points again, at least 1); a fouled shot that
// doesn't is two shots (FT_MISSED of its points, at least 1). Uncontested: straight off Heart or Health
export const FT_AND_ONE = 1 / 4, FT_MISSED = 1 / 3;
// FAST BREAK: the defense is caught in transition: its Stops count half, and it plays one Defense card at most
export const BREAK_STOPS = 0.5;
// POSSESSIONS (qp4): a turn used to be both ends of the floor on one hand; a possession is one end, so a match has
// about twice the turns (and cards) at the same Heart. Every opponent's Heart (the tables in foes.js / bosses.js stay
// as they are) is scaled by POSS.heart (a boss's by POSS.bossHeart), and since he now swings only on his own
// possessions, his shots by POSS.dmg (POSS.bossDmg).
// Tuned with tools/deck_sim.mjs to the targets (smart: starters ~20%, converted ~50%; ~70 min a completed run).
export const POSS = { heart: 0.4, dmg: 0.65, bossHeart: 0.5, bossDmg: 1.15 }; // (qp4: 0.4 / 0.85 / 0.55 / 1.35; qp7's 5-card hand made every side's hand smaller)
const ANIM_MS = { jumper: 900, three: 1000, layup: 900, dunk: 1100, floater: 900, post: 1000, crossover: 600, spin: 650, stepback: 800, pass: 500, lob: 700,
  closeout: 600, contest: 650, block: 800, steal: 600, rebound: 600, celebrate: 700, gassed: 500, foul: 600 };
// the tags an opponent's card carries, from what it looks like on the court (for assists, blocks, steals and boards)
const TAGS_BY_ANIM = { three: ['Perimeter'], jumper: ['Perimeter'], stepback: ['Perimeter', 'Handle'], floater: ['Drive'], layup: ['Drive'], dunk: ['Drive'],
  lob: ['Drive', 'Pass'], post: ['Post'], crossover: ['Handle'], spin: ['Drive', 'Handle'], pass: ['Pass'], steal: ['Handle', 'Hustle'], rebound: ['Hustle'],
  closeout: ['Hustle'], contest: [], block: ['Post'], foul: ['Hustle'], celebrate: [], gassed: [] };
const INSIDE_ANIMS = new Set(['layup', 'dunk', 'post', 'floater', 'lob']);
// what each side can play: Shots and Moves on offense, Defense cards on defense, Plays and Mentalities on both
const OFFENSE_TYPES = new Set(['shot', 'move', 'play', 'mentality']);
const DEFENSE_TYPES = new Set(['defense', 'play', 'mentality']);

const rule = (m, id) => m.rules.some(r => r.id === id);
const ab = (m, id) => m.ab.includes(id);
const pw = (m, id) => m.powers.filter(p => p.id === id);
const alive = m => m.opps.filter(o => o.heart > 0);
const oi = (m, o) => m.opps.indexOf(o);
const cap1 = s => s[0].toUpperCase() + s.slice(1);
const asMatch = x => (x && Array.isArray(x.hand) ? x : x?.match || null);

// ---------- events ----------
function ev(m, e) {
  const t = m.evt || 0;
  const out = { t, actor: 'you', anim: null, made: false, points: 0, stops: 0, text: '', ...e };
  m.evq.push(out);
  if (out.anim) m.evt = t + (ANIM_MS[out.anim] || 500);
}
function flush(m) { const q = m.evq; m.evq = []; m.evt = 0; return q; }
// the match ends: its 'end' event goes last, after the clash that ended it
function endEvent(m) { if (m.over) dropPending(m); if (m.over && !m.endSent) { m.endSent = true; ev(m, m.over.won ? { type: 'end', anim: 'celebrate', text: 'Game. You win.' } : { type: 'end', actor: 0, anim: 'gassed', text: 'You\'re out.' }); } }

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
    else if (where === 'hand' && m.hand.length < m.handMax) m.hand.push(ref);
    else m.discard.push(ref);
  },
  lastCard(m) { return m.lastRef ? cardDef(m.lastRef) : null; },
  hurtYou(m, n, anim, text) { m.you.hp -= n; ev(m, { type: 'hurt', actor: 0, anim, points: n, text }); checkDeath(m); },
  twin(m) {
    const a = m.opps[0], f = m.foes[1] || m.foes[0];
    const b = { ...JSON.parse(JSON.stringify(a)), id: 1, charId: f.charId, name: f.name, look: m.looks?.[f.charId] || null, moves: a.moves2, pools: a.pools2, set: [], mv: { offenseN: 0, defenseN: 0, last: {} } };
    a.shared = b.shared = 'twins';
    m.opps.push(b);
  },
  trio(m) {
    const a = m.opps[0];
    for (let i = 1; i < 3; i++) {
      const f = m.foes[i] || m.foes[0];
      m.opps.push({ ...JSON.parse(JSON.stringify(a)), id: i, charId: f.charId, name: f.name, look: m.looks?.[f.charId] || null, set: [], mv: { offenseN: i, defenseN: i, last: {} } });
    }
  },
  shadow(m) { m.shadow = { pile: R.shuffle(m.rs, m.deck.filter(r => cardDef(r)?.type !== 'fatigue')), discard: [] }; },
  // his card for this possession: SHADOW.cards of your own cards, the Shots on his offense, the Stops on his defense
  shadowSet(m, o, side) {
    const sh = m.shadow, cards = [];
    for (let k = 0; k < SHADOW.cards; k++) {
      if (!sh.pile.length) { sh.pile = R.shuffle(m.rs, sh.discard); sh.discard = []; }
      if (!sh.pile.length) break;
      const r = sh.pile.pop(); sh.discard.push(r); cards.push(r);
    }
    let pts = 0, stops = 0, hot = 0, anim = side === 'offense' ? 'jumper' : 'contest';
    const sb = Math.floor(m.stats.shooting / 2), db = Math.floor(m.stats.defense / 2);
    for (const r of cards) {
      const d = cardDef(r);
      if (d.fx.pts) { pts += ((d.fx.pts || 0) + sb) * (d.fx.hits || 1); if (side === 'offense') anim = d.anim; }
      if (d.fx.stops) { stops += d.fx.stops + (d.type === 'defense' ? db : 0); if (side === 'defense') anim = d.anim; }
      if (d.type === 'move' || d.type === 'play' || d.type === 'mentality') hot += 1;
    }
    const name = `Your own ${cards.map(r => cardDef(r).name).join(', ')}`;
    if (side === 'offense') return { kind: 'shoot', pts: Math.max(1, Math.round(pts * SHADOW.pts)), hot: Math.min(2, hot), anim, name, cards };
    return { kind: 'defend', stops: Math.max(1, Math.round(stops * SHADOW.stops)), anim, name, cards };
  },
};

// ---------- building a match ----------
// node.foes: [{ charId, name, look, style, rank, traits }], node.kind, node.boss, node.rules
export function startMatch(run, node) {
  const rs = R.stream(run.seed, 'match', node.id, run.matchCount || 0);
  const stats = run.player.stats;
  const m = {
    id: node.id, kind: node.kind, bracket: node.phase, round: node.round, boss: node.boss || null,
    // the possession (§15): who has the ball, the kind of turn, its banner, the opponents' committed set, the live clash
    phase: 'jump', ball: null, turnType: 'jump_ball', turnLabel: 'Jump ball', foeSet: null, preview: null, poss: 0, offN: 0,
    turn: 0, energy: 0, maxEnergy: 0, hand: [], handMax: HAND_MAX, pendingDraw: null, drawQ: null, drawPile: [], discard: [], burned: [],
    you: { hp: run.hp, maxHp: run.maxHp, stops: 0, keep: 0, outlet: 0, status: {} },
    opps: [], foes: node.foes, rules: (node.rules || []).map(ruleView), score: [0, 0],
    rs, looks: Object.fromEntries((node.foes || []).map(f => [f.charId, run.chars?.[f.charId]?.look || null])), deck: run.deck.slice(), deckSize: run.deck.length, ab: run.abilities.slice(), powers: [],
    converted: !!run.player.converted, stats: { ...stats }, mods: { shooting: 0, defense: 0 }, flags: { sixthUsed: !!run.flags?.sixthUsed },
    t: null, lastRef: null, evq: [], evt: 0, over: null, endSent: false,
    log: { played: 0, tags: {}, finisher: null, turns: 0, maxTurnPts: 0, dead: 0, poss: { you: 0, them: 0 } }, lent: null, betray: null,
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
    m.opps.push(mkOpp(m, 0, f, Math.round(heart * bh * heartRule(m)), shooting, defense, moves, { boss: node.boss, cycle: !def.nemesis, moves2, dmgK: (def.nemesis || def.id === 'the_shadow' ? 1 : BOSS_DMG) * bd }));
    if (def.nemesis) m.opps[0].mv.readTag = (f.traits || []).map(t => Object.entries(READ_TRAIT).find(([, v]) => v === t)?.[0]).find(Boolean) || null;
    if (def.setup) def.setup(m, X);
  } else {
    node.foes.forEach((f, i) => {
      const st = foeStats({ style: f.style, phase: ph, round: node.round, rival: node.kind === 'rival', rank: f.rank, traits: f.traits || [] });
      const share = node.foes.length > 1 ? 0.62 : 1; // (two at once: an ambush; each a bit lighter)
      m.opps.push(mkOpp(m, i, f, Math.round(st.heart * share * heartRule(m)), st.shooting, st.defense, st.moves, { pools: st.pools }));
    });
  }
  // the energy and the starting statuses
  m.handMax = HAND_MAX + (rule(m, 'up_tempo') ? 1 : 0) + (ab(m, 'superteam') ? 1 : 0) + (ab(m, 'playbook') ? 1 : 0);
  m.maxEnergy = energyFor(stats.stamina) + m.ab.filter(a => ENERGY_ABILITIES.includes(a)).length + (rule(m, 'run_and_gun') ? 1 : 0);
  if (rule(m, 'home_crowd')) m.you.status.hot = 1;
  if (rule(m, 'hostile_crowd')) applyStatus(m, m.you, 'cold', 1);
  for (const o of m.opps) {
    if (o.traits.includes('hot_start')) o.status.hot = (o.status.hot || 0) + 1;
    if (o.traits.includes('trash_mouth')) applyStatus(m, m.you, 'cold', 1);
  }
  if (ab(m, 'wristbands')) { m.you.stops += 5; ev(m, { type: 'stops', stops: 5, text: 'Wristbands: 5 Stops.' }); }
  // the piles
  m.drawPile = R.shuffle(rs, run.deck.slice());
  if (ab(m, 'signature_shoe')) X.addCard(m, 'ticky_tack', 'draw');
  if (ab(m, 'pregame_meal') && (node.kind === 'rival' || node.kind === 'boss')) heal(m, 8, 'Pre-Game Meal');
  // the nemesis plot: an ally lends you a card, a betrayer waits for the boss's bad moment
  const plot = run.plot || {};
  const lend = (plot.lends || []).find(l => l.node === node.id);
  if (lend) m.lent = { charId: lend.charId, card: lend.card, name: lend.name };
  if (plot.betray && plot.betray.node === node.id) m.betray = { ...plot.betray, done: false };
  // the jump ball: a seeded coin, 50/50
  const youWin = R.next(rs) < 0.5;
  ev(m, { type: 'jump', actor: youWin ? 'you' : 0, anim: 'rebound', text: youWin ? 'Tip-off: you win it.' : `Tip-off: ${m.opps[0].name} wins it.` });
  // (the lent card goes in your hand before the first draw, so it counts toward your hand max)
  if (m.lent) { m.hand.push(m.lent.card); ev(m, { type: 'ally', actor: 'you', anim: 'pass', text: `${m.lent.name} has your back: he lends you ${cardDef(m.lent.card).name} for this match.` }); }
  beginPossession(m, youWin ? 'you' : 'them', youWin ? 'offense' : 'defense', youWin ? 'You won the tip' : 'They won the tip');
  m.intro = flush(m); // (the tip-off and the match's opening events, played before the first turn)
  return m;
}
function heartRule(m) { return (m.boss ? POSS.bossHeart : POSS.heart) * (rule(m, 'short_game') ? 0.75 : 1) * (rule(m, 'king_court') ? 1.2 : 1) * (m.converted ? REPUTATION.heart : 1); }
function mkOpp(m, i, f, heart, shooting, defense, moves, o) {
  return { id: i, charId: f.charId, name: f.name, look: f.look || m.looks?.[f.charId] || null, style: f.style, rank: f.rank || 0, traits: (f.traits || []).slice(),
    heart, maxHeart: heart, stops: 0, status: {}, shooting, defense, moves, moves2: o.moves2 || null, boss: o.boss || null, cycle: !!o.cycle,
    pools: o.pools || splitMoves(moves), pools2: o.moves2 ? splitMoves(o.moves2) : null,
    set: [], intent: null, next: null, mv: { offenseN: 0, defenseN: 0, last: {} }, shared: null, dmgK: (o.dmgK || 1) * (m.boss ? POSS.bossDmg : POSS.dmg) * (m.converted ? REPUTATION.dmg : 1) };
}

// ---------- the opponents' sets ----------
// the card he commits for this possession: his boss card, his cycle in order (per side), or a weighted pick that never
// repeats the same card 3 times running
function pickMove(m, o, side) {
  const def = o.boss && BOSSES[o.boss];
  const key = side + 'N', k = o.mv[key] || 0;
  o.mv[key] = k + 1;
  if (def && def[side]) return { ...def[side](m, o, X, k) };
  const pools = (o.mv.second || (o.shared && o.id === 1)) && o.pools2 ? o.pools2 : o.pools;
  const list = side === 'offense' ? pools.off : pools.def;
  if (o.cycle) return { ...list[k % list.length] };
  const last = o.mv.last[side] || [];
  const opts = list.map((mv, i) => [i, (last.length >= 2 && last[0] === i && last[1] === i) ? 0 : mv.w || 1]);
  const i = R.weighted(m.rs, opts);
  o.mv.last[side] = [i, ...last].slice(0, 2);
  return { ...list[i] };
}
function commitSets(m) {
  const side = m.ball === 'them' ? 'offense' : 'defense';
  const breakD = m.ball === 'you' && m.turnType === 'fast_break'; // (on your fast break: one of them, caught in transition)
  let first = true;
  for (const o of m.opps) {
    o.set = [];
    if (o.heart <= 0) continue;
    const def = o.boss && BOSSES[o.boss];
    if (def?.turnStart) def.turnStart(m, o, X, side);
    if (breakD && !first) continue;
    first = false;
    o.set.push(pickMove(m, o, side));
    const pools = (o.mv.second || (o.shared && o.id === 1)) && o.pools2 ? o.pools2 : o.pools;
    const riders = (pools.ride || []).filter(r => r.side === side);
    if (riders.length && !breakD && R.chance(m.rs, RIDER_P)) o.set.push({ ...R.pick(m.rs, riders), rider: true });
  }
}
// what one of his shots scores now (his card's points, his Shooting and Hot, the rules, Cold / Exposed)
export function oppHit(m, o, mv) {
  let p = Math.round((mv.pts || 0) * (o.dmgK || 1)) + o.shooting + (o.status.hot || 0);
  if (rule(m, 'run_and_gun')) p += 2;
  if (rule(m, 'physical')) p -= 1;
  if (rule(m, 'up_tempo')) p += 1;
  if (rule(m, 'overtime') && m.turn >= OVERTIME_AT) p += 3;
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
export const OVERTIME_AT = 9; // (Overtime: from the 9th possession, about where the old turn 5 was)
export function oppHits(m, o, mv) { const def = o.boss && BOSSES[o.boss]; return (mv.hits || 1) * (def?.hitsMult ? def.hitsMult(m, o) : 1); }
export function oppStops(m, o, mv) {
  if (!mv.stops) return 0;
  let s = mv.stops + o.defense + (rule(m, 'physical') ? 2 : 0);
  if (o.status.gassed) s = Math.floor(s * GASSED);
  return Math.max(0, s);
}
const cardTags = mv => TAGS_BY_ANIM[mv.anim] || [];
// one committed card as the player sees it
function cardView(m, o, mv, side) {
  const tags = cardTags(mv);
  const parts = [];
  let kind, value;
  if (side === 'offense' && mv.pts) {
    const per = oppHit(m, o, mv), hits = oppHits(m, o, mv);
    kind = 'shot'; value = per * hits; parts.push(hits > 1 ? `Shoots ${per}×${hits}` : `Shoots ${per}`);
  } else if (side === 'defense' && mv.stops) { kind = 'stops'; value = oppStops(m, o, mv); parts.push(`${value} Stops`); }
  else { kind = mv.you || mv.fatigue ? 'debuff' : mv.hot ? 'buff' : 'special'; value = 0; }
  if (mv.hot) parts.push(`Hot ${mv.hot}`);
  if (mv.you) for (const [k, n] of Object.entries(mv.you)) parts.push(`${cap1(k)} ${n}`);
  if (mv.fatigue) parts.push(`+${mv.fatigue.n} ${cardDef(mv.fatigue.id)?.name || 'Fatigue'}`);
  if (mv.foul) parts.push('draws fouls');
  return { name: mv.name || (kind === 'shot' ? 'Shot' : 'Defense'), kind, value, anim: mv.anim || null, tags, text: parts.join(', '), actor: oi(m, o) };
}
// can you read their set? null, or {how: 'full' | 'cards', why}
function hiddenHow(m) {
  if (ab(m, 'franchise_tag')) return { how: 'full', why: 'Franchise Tag: you can\'t read their sets.' };
  let h = null;
  for (const o of alive(m)) {
    const def = o.boss && BOSSES[o.boss], bh = def?.hidden ? def.hidden(m, o) : null;
    if (bh === 'full') { h = { how: 'full', why: `${def.title}: you can't read a thing.`, boss: true }; break; }
    if (bh === 'cards' && !h) h = { how: 'cards', why: `${def.title} hides which card he plays.` };
    if (o.traits.includes('poker_face') && !h) h = { how: 'cards', why: `${o.name} has a poker face.` };
  }
  if (!h && m.you.status.screened) h = { how: 'full', why: 'Screened: you can\'t see their set this turn.' };
  // a Scouting Report reads through all of it but the Shadow (his total only)
  if (h && ab(m, 'scouting_report')) return h.boss ? { how: 'cards', why: 'Scouting Report: you know his total, not his cards.' } : null;
  return h;
}
// the side each committed card plays for, this possession
const setSide = m => (m.ball === 'them' ? 'offense' : 'defense');
// your Stops pool as the defense, this possession (half of it caught in transition)
function yourD(m) { const s = m.you.stops; return m.ball === 'them' && m.turnType === 'fast_break' ? Math.floor(s * BREAK_STOPS) : s; }
// their Stops pool as the defense, this possession
function theirD(m) {
  let d = 0;
  for (const o of alive(m)) { d += o.stops; for (const mv of o.set) d += oppStops(m, o, mv); }
  return m.ball === 'you' && m.turnType === 'fast_break' ? Math.floor(d * BREAK_STOPS) : d;
}
// your attempts this possession, against whom (and his cap on one basket: The Wall)
function yourAttempts(m) {
  const out = [];
  for (const a of m.t.attempts) {
    const o = target(m, a.target), def = o && o.boss && BOSSES[o.boss];
    out.push({ ...a, pts: a.per, cap: def?.hitCap ?? Infinity, o });
  }
  return out;
}
// the shots in order against the Stops pool: what each one meets, scores and (over a cap) gives up as his Stops.
// Without a cap the total is exactly max(0, O − D); The Wall's cap only trims what a basket that beat him counts
function resolveShots(atts, D) {
  let pool = D, total = 0;
  const out = atts.map(a => {
    const absorbed = Math.min(pool, a.pts);
    pool -= absorbed;
    const got = a.pts - absorbed, pts = Math.min(got, a.cap ?? Infinity);
    total += pts;
    return { absorbed, pts, bank: got - pts };
  });
  out.total = total;
  return out;
}
function theirAttempts(m) {
  const out = [];
  for (const o of alive(m)) for (const mv of o.set) if (mv.pts) {
    const per = oppHit(m, o, mv), n = oppHits(m, o, mv);
    const assist = o.set.some(x => x !== mv && cardTags(x).includes('Pass')); // (a Pass in his set set it up)
    for (let h = 0; h < n; h++) out.push({ o, mv, per, pts: per, tags: cardTags(mv), anim: mv.anim || 'jumper', name: mv.name || 'shoots', foul: !!mv.foul, assist });
  }
  return out;
}
// the live clash: what the player sees (hidden numbers as null)
export function refreshSets(m) {
  if (!m.t || m.over) { m.preview = m.over ? { o: 0, d: 0, result: 'stopped', points: 0 } : null; return; }
  const side = setSide(m), hid = hiddenHow(m);
  const cards = [];
  for (const o of alive(m)) for (const mv of o.set) cards.push(hid ? { hidden: true, actor: oi(m, o) } : cardView(m, o, mv, side));
  const atts = m.ball === 'you' ? yourAttempts(m) : theirAttempts(m);
  const o = atts.reduce((s, a) => s + a.pts, 0), d = m.ball === 'you' ? theirD(m) : yourD(m);
  const total = m.ball === 'you' ? d : o;
  const showTotal = !hid || hid.how === 'cards';
  m.foeSet = { side, hidden: !!hid, cards, total: showTotal ? total : null, ...(hid ? { why: hid.why } : {}) };
  const po = m.ball === 'you' ? o : showTotal ? o : null, pd = m.ball === 'you' ? (showTotal ? d : null) : d;
  m.preview = { o: po, d: pd, result: po == null || pd == null ? '?' : po > pd ? 'score' : 'stopped', points: po == null || pd == null ? null : resolveShots(atts, d).total };
  // (the old intent fields, for the UI's opponent tiles: his first card this possession)
  for (const op of m.opps) {
    op.next = null;
    if (op.heart <= 0 || !op.set.length) { op.intent = null; continue; }
    const v = hid ? { kind: 'unknown', value: null, text: '?', anim: null } : cardView(m, op, op.set[0], side);
    op.intent = hid ? v : { kind: v.kind === 'shot' ? 'shoot' : v.kind === 'stops' ? 'defend' : v.kind, value: v.value, text: `${v.name}: ${v.text}`, anim: v.anim, name: v.name };
  }
}
export const refreshIntents = refreshSets;

// ---------- statuses, healing, hits ----------
function applyStatus(m, who, k, n) {
  if (!n) return false;
  if (rule(m, 'tight_whistle') && k !== 'hot' && k !== 'screened') return false;
  if (who === m.you && k === 'cold' && ab(m, 'sweatband') && !m.flags.sweatband) { m.flags.sweatband = true; ev(m, { type: 'ability', text: 'Sweatband: you shake off the Cold.' }); return false; }
  who.status[k] = (who.status[k] || 0) + n;
  return true;
}
function tickOne(who, k) { if (who.status[k]) { who.status[k]--; if (!who.status[k]) delete who.status[k]; } }
// the end of a possession: each status counts down where it matters (§15)
function tickPossession(m, offense) {
  const youD = offense === 'them';
  if (youD) { tickOne(m.you, 'exposed'); tickOne(m.you, 'gassed'); } else tickOne(m.you, 'cold');
  for (const o of m.opps) { if (youD) tickOne(o, 'cold'); else { tickOne(o, 'exposed'); tickOne(o, 'gassed'); } }
  tickOne(m.you, 'screened');
}
function heal(m, n, why = '') {
  if (rule(m, 'no_timeouts')) { ev(m, { type: 'heal', text: 'No Timeouts: no healing tonight.' }); return 0; }
  const h = Math.max(0, Math.min(n, m.you.maxHp - m.you.hp));
  m.you.hp += h;
  ev(m, { type: 'heal', anim: null, points: h, text: `${why ? why + ': ' : ''}heal ${h}.` });
  return h;
}
function target(m, ti) { const o = m.opps[ti]; return o && o.heart > 0 ? o : alive(m)[0] || null; }
// points off his Heart (after the clash: no Stops left in the way)
function damageOpp(m, o, dmg) {
  const def = o.boss && BOSSES[o.boss];
  if (dmg >= o.heart && rule(m, 'win_by_2') && !o.mv.winBy2) {
    o.mv.winBy2 = true; const d0 = Math.max(0, o.heart - 1);
    o.heart -= d0; m.score[0] += d0; m.t.scored += d0;
    const h = Math.round(o.maxHeart * 0.2); o.heart += h;
    ev(m, { type: 'heal', actor: oi(m, o), anim: 'celebrate', points: h, text: `Win By 2: ${o.name} hangs on at 1 and heals ${h}.` });
    syncShared(m, o);
    return d0;
  }
  o.heart -= dmg; m.score[0] += dmg; m.t.scored += dmg;
  syncShared(m, o);
  if (def?.onLow && o.heart > 0) def.onLow(m, o, X);
  if (o.heart <= 0) oppDown(m, o);
  return dmg;
}
function syncShared(m, o) { if (o.shared) for (const p of m.opps) if (p !== o && p.shared === o.shared) p.heart = o.heart; }
function oppDown(m, o) {
  const def = o.boss && BOSSES[o.boss];
  if (def?.onDeath && def.onDeath(m, o, X)) { o.set = []; return; }
  o.heart = 0; o.stops = 0; o.set = [];
  if (o.shared) for (const p of m.opps) if (p.shared === o.shared) { p.heart = 0; p.stops = 0; p.set = []; }
  ev(m, { type: 'down', actor: oi(m, o), anim: 'gassed', text: `${o.name} is done.` });
  if (!m.over && !alive(m).length) m.over = { won: true };
}
function checkDeath(m) {
  if (m.over || m.you.hp > 0) return;
  if (ab(m, 'sixth_man') && !m.flags.sixthUsed) {
    m.flags.sixthUsed = true; m.you.hp = Math.max(1, Math.floor(m.you.maxHp * 0.25));
    ev(m, { type: 'ability', anim: 'celebrate', text: 'Sixth Man: you get up off the floor.' });
    return;
  }
  m.you.hp = Math.max(0, m.you.hp);
  m.over = { won: false };
}
// points off your Health (after the clash; the Mouthguard eats the first that would count)
function damageYou(m, dmg) {
  if (dmg > 0 && ab(m, 'mouthguard') && !m.flags.mouthguard) { m.flags.mouthguard = true; ev(m, { type: 'ability', text: 'Mouthguard: that one doesn\'t count.' }); return 0; }
  m.you.hp -= dmg; m.score[1] += dmg;
  checkDeath(m);
  return dmg;
}

// ---------- a possession starts ----------
function newTurnState() { return { played: [], last: null, chain: [], wild: 0, flows: 0, shots: 0, scored: 0, cheap: 0, next: [], firstDef: false, firstDrive: false, firstPass: false, firstShot: false, tagDraws: 0, passes: 0, combo: false, hotHand: false, trash: false, flowed: false, pressBroken: false, attempts: [], defCards: [], hustle: 0, handlePass: false }; }
const LABELS = {
  you: { offense: 'Your ball', fast_break: 'Fast break: you stole it', second_chance: 'Second chance: your board', keep: 'Make-it, take-it: your ball again' },
  them: { offense: 'Their ball: defend', fast_break: 'Fast break: they stole it, get back', second_chance: 'Second chance: their board', keep: 'Make-it, take-it: their ball again' },
};
// the next possession: who has the ball, the kind of turn, its banner; then the turn itself starts
function beginPossession(m, ball, kind, why) {
  m.ball = ball;
  m.phase = ball === 'you' ? 'offense' : 'defense';
  const tt = kind === 'keep' ? (ball === 'you' ? 'offense' : 'defense') : kind === 'offense' || kind === 'defense' ? (ball === 'you' ? 'offense' : 'defense') : kind;
  m.turnType = tt;
  m.turnLabel = why || (LABELS[ball][kind] || LABELS[ball].offense);
  m.poss++;
  if (ball === 'you') m.offN++;
  m.log.poss[ball]++;
  ev(m, { type: 'possession', to: ball, turnType: tt, text: m.turnLabel });
  startTurn(m);
}
export function startTurn(m) {
  m.turn++;
  m.t = newTurnState();
  const charge = m.you.status.charge || 0; delete m.you.status.charge;
  m.energy = m.maxEnergy + charge + (m.turn === 1 && ab(m, 'captains_band') ? 1 : 0) + pw(m, 'tight_energy').reduce((s, p) => s + (isTight(m) ? p.n : 0), 0);
  if (m.turn === 1 && ab(m, 'captains_band')) m.you.status.hot = (m.you.status.hot || 0) + 1;
  for (const p of pw(m, 'turn_stops')) gainStops(m, p.n, false, 'Defensive Mindset');
  for (const p of pw(m, 'depth_stops')) gainStops(m, Math.floor(m.deckSize / p.n), false, 'Deep Bench');
  for (const p of pw(m, 'turn_cold')) for (const o of alive(m)) applyStatus(m, o, 'cold', p.n);
  // the possession's draw: up to your hand max (the Press keeps it 1 short; Ankle Weights, your first hand)
  let fill = m.handMax;
  for (const o of alive(m)) { const d = o.boss && BOSSES[o.boss]; if (d?.drawMod) fill += d.drawMod; }
  if (m.turn === 1 && ab(m, 'ankle_weights')) fill -= 1;
  fillHand(m, fill);
  commitSets(m);
  refreshSets(m);
  // (how often a turn opens with nothing you can play: tools/deck_sim.mjs keeps it rare)
  if (!m.hand.some((r, i) => canPlay(m, i).ok)) m.log.dead++;
  ev(m, { type: 'turn', text: `${m.turnLabel}.` });
}
// the top card of the draw pile (the discard reshuffled in when it runs out; No Blood burns the Fatigue), or null
function topCard(m) {
  for (let guard = 0; guard < 200; guard++) {
    if (!m.drawPile.length) { if (!m.discard.length) return null; m.drawPile = R.shuffle(m.rs, m.discard); m.discard = []; }
    const r = m.drawPile.pop(), d = cardDef(r);
    if (d?.type === 'fatigue' && rule(m, 'no_blood')) { m.burned.push(r); ev(m, { type: 'burn', text: `No Blood, No Foul: ${d.name} burns.` }); continue; }
    return r;
  }
  return null;
}
// a card goes into your hand (what happens when it's drawn: a Ticky-Tack Foul's energy)
function takeCard(m, r) {
  const d = cardDef(r);
  m.hand.push(r);
  if (d?.fx?.drawn?.energy) { m.energy = Math.max(0, m.energy + d.fx.drawn.energy); ev(m, { type: 'energy', anim: 'foul', text: `${d.name}: ${d.fx.drawn.energy} energy.` }); }
}
// the possession's draw: up to n cards in hand, never past it, never a question
function fillHand(m, n) {
  while (m.hand.length < n) { const r = topCard(m); if (r == null) break; takeCard(m, r); }
}
// any other draw: n cards; past your hand max, each one waits on resolveDraw (later draws queue behind it)
function draw(m, n, why = 'Draw') {
  if (!(n > 0)) return;
  if (m.pendingDraw) { m.pendingDraw.remaining += n; return; }
  for (let k = 0; k < n; k++) {
    if (m.over) return;
    const r = topCard(m);
    if (r == null) return;
    if (m.hand.length < m.handMax) { takeCard(m, r); continue; }
    m.pendingDraw = { ref: r, cardInfo: cardInfo(r), remaining: n - k - 1, handMax: m.handMax, why: `${why}: your hand is full (${m.handMax}). Discard a card to take ${cardDef(r).name}, or refuse it.` };
    m.drawQ = why;
    ev(m, { type: 'draw', text: `${cardDef(r).name}: hand full. Discard a card or refuse it.` });
    return;
  }
}
// a match that ends with a card waiting: it goes to the discard pile
function dropPending(m) { if (m.pendingDraw) { m.discard.push(m.pendingDraw.ref); m.pendingDraw = null; m.drawQ = null; } }
// resolveDraw(run, { discard: handIndex } | { refuse: true }) -> events (an array; .ok false and .why when refused)
export function resolveDraw(run, choice = {}) {
  const m = run?.match;
  const no = why => { const out = [{ t: 0, type: 'invalid', actor: 'you', anim: null, made: false, points: 0, stops: 0, text: why }]; out.ok = false; out.why = why; return out; };
  if (!m || m.over) return no('No match in progress.');
  const p = m.pendingDraw;
  if (!p) return no('No card is waiting.');
  const dc = cardDef(p.ref);
  if (choice && choice.refuse === true) {
    m.pendingDraw = null;
    m.discard.push(p.ref);
    ev(m, { type: 'draw', text: `You let ${dc.name} go.` });
  } else if (choice && Number.isInteger(choice.discard) && choice.discard >= 0 && choice.discard < m.hand.length) {
    m.pendingDraw = null;
    const [out] = m.hand.splice(choice.discard, 1);
    m.discard.push(out);
    ev(m, { type: 'draw', text: `You discard ${cardDef(out).name} for ${dc.name}.` });
    takeCard(m, p.ref);
  } else return no('Discard a card from your hand, or refuse the card.');
  const why = m.drawQ || 'Draw';
  m.drawQ = null;
  draw(m, p.remaining, why);
  refreshSets(m);
  run.hp = Math.max(0, m.you.hp);
  const ev2 = flush(m).map(e => ({ ...e, anim: null }));
  ev2.ok = true;
  return ev2;
}
function gainStops(m, n, hustle, why) {
  if (n <= 0) return 0;
  m.you.stops += n; if (hustle) m.you.keep += n;
  ev(m, { type: 'stops', stops: n, text: `${why ? why + ': ' : ''}${n} Stops.` });
  return n;
}

// ---------- your cards ----------
// can this card be played on this side of the ball?
export function phaseOk(m, d) { return d.type === 'fatigue' || (m.ball === 'you' ? OFFENSE_TYPES : DEFENSE_TYPES).has(d.type); }
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
// canPlay(run | match, handIndex) -> { ok, why, cost }: phase-aware ("Shots can't be played on defense")
export function canPlay(x, i) {
  const m = asMatch(x);
  const r = m?.hand?.[i], d = cardDef(r);
  if (!m || !d || m.over) return { ok: false, why: m?.over ? 'The match is over.' : 'No such card.' };
  if (!m.t) return { ok: false, why: 'Not your turn.' };
  if (m.pendingDraw) return { ok: false, why: HAND_FULL };
  const c = costOf(m, r);
  if (c == null) return { ok: false, why: `${d.name} can't be played.` };
  if (!phaseOk(m, d)) return { ok: false, why: m.ball === 'you' ? `${cap1(d.type)} cards can't be played on offense.` : `${d.type === 'shot' ? 'Shots' : cap1(d.type) + 's'} can't be played on defense.` };
  if (d.type === 'defense' && m.ball === 'them' && m.turnType === 'fast_break' && m.t.defCards.length >= 1) return { ok: false, why: 'Caught in transition: one Defense card.' };
  if (d.type === 'mentality' && rule(m, 'old_school')) return { ok: false, why: 'Old School: no Mentalities.' };
  if (ab(m, 'spotlight') && m.t.played.length >= SPOTLIGHT_CARDS) return { ok: false, why: 'Spotlight: 6 cards a turn.' };
  if (c > m.energy) return { ok: false, why: 'Not enough energy.' };
  return { ok: true, why: '', cost: c };
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
export function shotValue(m, d, o) {
  const f = liveFx(m, d);
  let p = (f.pts || 0) + f.add;
  if (f.special === 'first_card' && m.t.played.length === 0) p += f.bonus;
  if (f.special === 'per_tag_played') p += f.bonus * m.t.played.filter(r => cardDef(r).tags.includes(f.tag)).length;
  if (f.special === 'per_type_played') p += f.bonus * m.t.played.filter(r => cardDef(r).type === f.ptype).length;
  for (const nx of m.t.next) if (!nx.tag || d.tags.includes(nx.tag)) p += nx.add;
  for (const pp of pw(m, 'tag_pts')) if (d.tags.includes(pp.tag)) p += pp.n;
  if (ab(m, 'heavy_ball') && d.tags.includes('Post')) p += 2;
  if (ab(m, 'chalk_bag') && m.offN === 1 && m.ball === 'you') p += 3;
  if (rule(m, 'and_one_night') && !m.t.firstShot) p += 3;
  if (rule(m, 'physical')) p -= 1;
  if (rule(m, 'run_and_gun')) p += 2;
  if (rule(m, 'overtime') && m.turn >= OVERTIME_AT) p += 3;
  if (rule(m, 'windy')) { if (d.tags.includes('Perimeter')) p -= 2; if (d.tags.includes('Drive')) p += 2; }
  if (o) for (const [tag, tr] of [['Drive', 'read_drive'], ['Post', 'read_post'], ['Perimeter', 'read_perimeter']]) if (o.traits.includes(tr) && d.tags.includes(tag)) p -= tr === 'read_perimeter' ? 2 : 3;
  p -= m.hand.filter(r => cardDef(r)?.fx?.inHand?.shot).length;
  p += Math.floor((m.stats.shooting + m.mods.shooting) / 2) + (m.you.status.hot || 0);
  if (d.type === 'shot' && !m.t.firstShot && m.you.outlet) p += m.you.outlet;
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

// playCard: the card's own effects happen now (Stops, draws, energy, statuses, setups); a Shot is lined up, worked out
// as it stands now, and goes up at End Turn against their defense. The events are the table's (text, no court
// animation): endTurn plays the whole possession on the court
export function playCard(run, handIndex, ti = 0) {
  const m = run.match;
  if (!m || m.over) return [];
  const chk = m.pendingDraw ? { ok: false, why: HAND_FULL } : m.hand[handIndex] == null ? { ok: false, why: 'No such card.' } : canPlay(m, handIndex);
  if (!chk.ok) { const out = [{ t: 0, type: 'invalid', actor: 'you', anim: null, made: false, points: 0, stops: 0, text: chk.why }]; out.ok = false; out.why = chk.why; return out; }
  const ref = m.hand[handIndex], d = cardDef(ref);
  m.energy -= chk.cost;
  m.t.cheap = 0;
  m.hand.splice(handIndex, 1);
  const o = target(m, ti);
  ev(m, { type: 'card', card: ref, text: `You play ${d.name}.` });
  if (ab(m, 'drive_lanes') && d.tags.includes('Drive') && !m.t.firstDrive && o) { m.t.firstDrive = true; if (applyStatus(m, o, 'exposed', 1)) ev(m, { type: 'status', text: `Driving Lanes: ${o.name} is Exposed 1.` }); }
  const f = liveFx(m, d);
  const assist = m.t.played.some(r => cardDef(r).tags.includes('Pass'));
  // Shots: lined up for the clash
  if (d.type === 'shot') {
    const sv = shotValue(m, d, o);
    for (let h = 0; h < sv.hits; h++) m.t.attempts.push({ ref, name: d.name, per: h === 0 ? sv.per : shotValue(m, d, o).per, anim: d.anim, tags: d.tags.slice(), assist, target: o ? oi(m, o) : 0 });
    m.t.shots++; m.t.firstShot = true; m.t.next = m.t.next.filter(nx => !(!nx.tag || d.tags.includes(nx.tag)));
    if (m.you.outlet) { ev(m, { type: 'status', text: `Outlet: +${m.you.outlet} on this shot.` }); m.you.outlet = 0; }
    if (ab(m, 'lucky_headband') && !m.flags.lucky) { m.flags.lucky = true; ev(m, { type: 'ability', text: 'Lucky Headband: double.' }); }
  } else if (f.pts) {
    // (points on a Defense card, Swat Party's outlet: +that much on your first Shot next time you have the ball)
    const add = (f.pts || 0) + f.add;
    m.you.outlet += add; ev(m, { type: 'status', text: `Outlet: +${add} on your next Shot.` });
  }
  if (!m.over) {
    const s = stopsValue(m, d);
    if (s) gainStops(m, s, !!f.hustle, d.name);
    if (d.type === 'defense') { m.t.firstDef = true; m.t.defCards.push({ ref, stops: s, anim: d.anim, tags: d.tags.slice(), steal: d.anim === 'steal', block: d.anim === 'block' || d.tags.includes('Post') }); }
    if (f.selfDmg) { m.you.hp -= f.selfDmg; ev(m, { type: 'hurt', points: f.selfDmg, text: `${d.name}: take ${f.selfDmg}.` }); checkDeath(m); }
    if (f.heal) heal(m, f.heal, d.name);
    if (f.energy) { m.energy += f.energy; ev(m, { type: 'energy', text: `+${f.energy} energy.` }); }
    if (f.charge) m.you.status.charge = (m.you.status.charge || 0) + f.charge;
    if (f.hot) { m.you.status.hot = (m.you.status.hot || 0) + f.hot; ev(m, { type: 'status', text: `Hot ${f.hot}.` }); }
    if (f.foe && o && o.heart > 0) for (const [k, n] of Object.entries(f.foe)) if (applyStatus(m, o, k, n)) ev(m, { type: 'status', target: oi(m, o), text: `${o.name} is ${cap1(k)} ${n}.` });
    if (f.next) m.t.next.push({ ...f.next });
    if (f.cheap) m.t.cheap = f.cheap;
    if (f.special === 'strip' && o) { const n = o.stops; o.stops = 0; ev(m, { type: 'status', target: oi(m, o), stops: n, text: `${o.name} loses ${n} Stops.` }); }
    if (f.special === 'burn_fatigue') { const j = m.hand.findIndex(r => cardDef(r)?.type === 'fatigue'); if (j >= 0) { const [b] = m.hand.splice(j, 1); m.burned.push(b); ev(m, { type: 'burn', text: `${cardDef(b).name} burns.` }); } }
    if (f.special === 'stat_match') { m.mods[f.stat] += f.n; ev(m, { type: 'status', text: `+${f.n} ${f.stat} for this match.` }); }
    if (f.special === 'draw_if_exposed' && o && o.status.exposed) f.draw = (f.draw || 0) + 1;
    if (f.handMax) { m.handMax += f.handMax; ev(m, { type: 'power', text: `${d.name}: your hand holds ${m.handMax} this match.` }); }
    if (f.power?.id === 'hand_max') { m.handMax += f.power.n; ev(m, { type: 'power', text: `${d.name}: your hand holds ${m.handMax} this match.` }); }
    if (f.draw) draw(m, f.draw, d.name);
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
  if (d.tags.includes('Hustle')) m.t.hustle++;
  if (d.tags.includes('Handle') || d.tags.includes('Pass')) m.t.handlePass = true;
  m.log.played++; for (const tg of d.tags) m.log.tags[tg] = (m.log.tags[tg] || 0) + 1;
  for (const tg of d.tags) if (!m.t.chain.includes(tg)) m.t.chain.push(tg);
  if (d.wild) m.t.wild++;
  const maxFlows = 1 + pw(m, 'flow_twice').length;
  if (!m.over && m.t.chain.length + m.t.wild >= 3 && m.t.flows < maxFlows) {
    m.t.flows++; m.t.flowed = true; m.t.chain = []; m.t.wild = 0;
    const e = ab(m, 'second_gear') ? 2 : 1;
    m.energy += e; ev(m, { type: 'flow', text: `Flow! +${e} energy, draw 1.` }); draw(m, 1, 'Flow');
    if (ab(m, 'metronome')) gainStops(m, 4, false, 'Metronome');
  }
  if (!m.over) {
    for (const p of pw(m, 'tag_stops')) if (d.tags.includes(p.tag)) gainStops(m, p.n, false, 'Mentality');
    for (const p of pw(m, 'tag_draw')) if (d.tags.includes(p.tag) && m.t.tagDraws < 3) { m.t.tagDraws++; draw(m, p.n, 'Mentality'); }
    if (d.tags.includes('Pass')) { m.t.firstPass = true; m.t.passes++; if (m.t.passes === 2 && ab(m, 'assist_log')) { draw(m, 1, 'Assist Log'); ev(m, { type: 'ability', text: 'Assist Log: draw 1.' }); } }
    if (ab(m, 'jump_rope') && m.t.played.length % 3 === 0) gainStops(m, 3, false, 'Jump Rope');
    for (const op of alive(m)) { const def = op.boss && BOSSES[op.boss]; if (def?.onPlay) def.onPlay(m, d, X); }
  }
  if (d.type === 'shot') m.log.finisher = ref;
  refreshSets(m);
  run.hp = Math.max(0, m.you.hp);
  endEvent(m);
  return flush(m).map(e => (e.type === 'end' ? e : { ...e, anim: null }));
}

// the betrayal (§8): a character you helped, turned by a rival of his, switches sides at the boss's bad moment
function betrayCheck(m) {
  const b = m.betray;
  if (!b || b.done || m.over || !m.opps[0] || m.opps[0].heart > m.opps[0].maxHeart * 0.5) return;
  b.done = true;
  const st = foeStats({ style: b.style, phase: Math.min(3, m.bracket), round: 6, rival: true, rank: b.rank || 0, traits: [] });
  const heart = Math.round(st.heart * 0.55 * heartRule(m));
  const o = mkOpp(m, m.opps.length, { charId: b.charId, name: b.name, look: b.look, style: b.style, rank: b.rank, traits: [] }, heart, st.shooting, st.defense, st.moves, { pools: st.pools });
  m.opps.push(o);
  // he takes back what he lent you
  if (m.lent && m.lent.charId === b.charId) for (const pile of ['hand', 'drawPile', 'discard']) { const j = m[pile].indexOf(m.lent.card); if (j >= 0) m[pile].splice(j, 1); }
  ev(m, { type: 'betray', actor: oi(m, o), anim: 'steal', text: b.line || `${b.name} switches sides.` });
}

// ---------- the clash: End Turn ----------
// how a stopped shot looks (GAUNTLET.md §15, pinned by tests/v0489deck_possession.test.mjs):
//   block    the defense's biggest card is a block (a block, or a Post Defense card) and the shot went inside
//            (a Drive or Post shot: layup, dunk, floater, post, lob)
//   steal    otherwise, the defense played a steal card (anim steal) and the offense leaned on Handle or Pass
//   contest  otherwise: a contested miss, and the boards decide who has it next
// and a made one: and_one (fouled), else assist (a Pass card set it up), else made
const insideShot = a => a.tags.includes('Drive') || a.tags.includes('Post') || INSIDE_ANIMS.has(a.anim);
function stopHow(defTop, defSteal, offHandlePass, a) {
  if (defTop?.block && insideShot(a)) return 'block';
  if (defSteal && offHandlePass) return 'steal';
  return 'contest';
}
export function endTurn(run) {
  const m = run.match;
  if (!m || m.over || !m.t) return [];
  if (m.pendingDraw) { const out = [{ t: 0, type: 'invalid', actor: 'you', anim: null, made: false, points: 0, stops: 0, text: HAND_FULL }]; out.ok = false; out.why = HAND_FULL; return out; }
  // the Fatigue in your hand bites
  for (const r of m.hand) {
    const d = cardDef(r);
    if (d?.fx?.inHand?.dmg) { m.you.hp -= d.fx.inHand.dmg; ev(m, { type: 'hurt', anim: 'gassed', points: d.fx.inHand.dmg, text: `${d.name}: take ${d.fx.inHand.dmg}.` }); }
    if (d?.fx?.inHand?.cold) applyStatus(m, m.you, 'cold', d.fx.inHand.cold);
  }
  checkDeath(m);
  const offense = m.ball, youO = offense === 'you';
  // the setup, on the court: the defense's cards, then the offense's moves and passes, in the order they were played
  const yourSetup = m.t.played.filter(r => cardDef(r).type !== 'shot');
  const theirSetup = [];
  for (const o of alive(m)) for (const mv of o.set) if (!(youO ? false : mv.pts) || mv.stops) theirSetup.push({ o, mv });
  const showYours = () => { for (const r of yourSetup) { const d = cardDef(r); ev(m, { type: 'card', actor: 'you', anim: d.anim, ref: r, name: d.name, text: `${d.name}.` }); } };
  const showTheirs = () => { for (const { o, mv } of theirSetup) if (!(mv.pts && !youO)) ev(m, { type: 'card', actor: oi(m, o), anim: mv.anim || 'contest', name: mv.name || '', text: `${o.name}: ${mv.name || 'sets up'}.` }); };
  if (youO) { showTheirs(); showYours(); } else { showYours(); showTheirs(); }
  // the numbers
  const atts = youO ? yourAttempts(m) : theirAttempts(m);
  const D = youO ? theirD(m) : yourD(m);
  const O = atts.reduce((s, a) => s + a.pts, 0);
  // the defense's cards: its biggest contributor, whether it went for a steal, its Hustle
  let defTop = null, defSteal = false, defHustle = 0, offHustle = 0, offHP = false, defCharge = false;
  if (youO) {
    for (const o of alive(m)) for (const mv of o.set) { const s = oppStops(m, o, mv); if (!mv.stops) continue; if (!defTop || s > defTop.stops) defTop = { stops: s, block: mv.anim === 'block', anim: mv.anim }; if (mv.anim === 'steal') defSteal = true; if (cardTags(mv).includes('Hustle')) defHustle++; }
    offHustle = m.t.hustle; offHP = m.t.handlePass;
  } else {
    for (const c of m.t.defCards) { if (!defTop || c.stops > defTop.stops) defTop = c; if (c.steal) defSteal = true; if (c.ref === 'take_charge' || c.ref === 'take_charge+') defCharge = true; }
    defHustle = m.t.hustle;
    for (const o of alive(m)) for (const mv of o.set) { const tg = cardTags(mv); if (tg.includes('Hustle')) offHustle++; if (tg.includes('Handle') || tg.includes('Pass')) offHP = true; }
  }
  // the shots, in order, against what's left of the defense's Stops
  let scored = 0, last = null, fouled = null;
  const banks = new Map(), res = resolveShots(atts, D);
  for (let k = 0; k < atts.length; k++) {
    if (m.over) break;
    const a = atts[k], { absorbed, pts, bank } = res[k], made = pts > 0;
    const foul = !rule(m, 'tight_whistle') && !fouled && ((rule(m, 'physical') && insideShot(a)) || a.foul);
    const how = made ? (foul ? 'and_one' : a.assist ? 'assist' : 'made') : (defCharge && insideShot(a) ? 'charge' : stopHow(defTop, defSteal, offHP, a));
    const actor = youO ? 'you' : oi(m, a.o);
    const e = { type: 'shot', actor, anim: a.anim, made, points: pts, stops: absorbed, how, text: `${youO ? a.name : `${a.o.name}: ${a.name}`}: ${made ? pts : 'no good'}.` };
    if (made && a.assist) e.assist = youO ? 'you' : actor;
    if (youO) e.target = oi(m, a.o || target(m, 0));
    ev(m, e);
    if (made) { if (youO) { const o = a.o && a.o.heart > 0 ? a.o : target(m, a.target); if (o) damageOpp(m, o, pts); } else damageYou(m, pts); scored += pts; }
    if (bank && a.o) { banks.set(a.o, (banks.get(a.o) || 0) + bank); ev(m, { type: 'wall', actor: oi(m, a.o), anim: null, text: `${a.o.name} only gives up ${pts} on that one.` }); }
    if (foul && !m.over) {
      fouled = a;
      const ft = Math.max(1, Math.floor(a.per * (made ? FT_AND_ONE : FT_MISSED)));
      ev(m, { type: 'foul', actor: youO ? 0 : 'you', anim: 'foul', text: rule(m, 'physical') && !a.foul ? 'Physical Night: the whistle.' : 'Foul.' });
      ev(m, { type: 'ft', actor, anim: 'jumper', points: ft, text: `Free throws: ${ft}.` });
      if (youO) { const o = target(m, a.target); if (o) damageOpp(m, o, ft); } else damageYou(m, ft);
      scored += ft;
    }
    last = { a, made, how };
  }
  m.log.maxTurnPts = Math.max(m.log.maxTurnPts, youO ? scored : 0);
  // no shot at all: a turnover (picked off, if the defense went for the ball and the offense handled it)
  const pickedOff = !atts.length && !m.over && defSteal && offHP;
  if (pickedOff) ev(m, { type: 'shot', actor: youO ? 'you' : 0, anim: 'steal', made: false, points: 0, stops: 0, how: 'steal', text: 'Picked off.' });
  ev(m, { type: 'clash', actor: youO ? 'you' : 0, o: O, d: D, winner: O > D ? 'offense' : 'defense', text: `${youO ? 'You' : 'Them'} ${O} vs ${D} ${youO ? 'Them' : 'You'}` });
  // what scoring did: Hot Hand, Trash Talk, Make-It-Take-It's draw
  if (youO && !m.over) {
    if (scored >= 15 && ab(m, 'hot_hand')) { m.you.status.hot = (m.you.status.hot || 0) + 1; ev(m, { type: 'ability', text: 'Hot Hand: Hot 1.' }); }
    if (scored >= 12 && rule(m, 'trash_talk')) { m.you.status.hot = (m.you.status.hot || 0) + 1; ev(m, { type: 'rule', text: 'Trash Talk: you\'re Hot 1.' }); }
  } else if (!youO && scored >= 12 && rule(m, 'trash_talk')) for (const o of alive(m)) o.status.hot = (o.status.hot || 0) + 1;
  // the Shot Clock: on offense, a Shot or a violation
  let violation = false;
  if (youO && rule(m, 'shot_clock') && !m.t.shots && !m.over) { violation = true; m.you.hp -= 3; ev(m, { type: 'rule', anim: 'foul', points: 3, text: 'Shot Clock violation: take 3, and the ball.' }); checkDeath(m); }
  // after the clash: the defense's leftover Stops are gone (Hustle Stops keep a turn), the offense's carry; The Wall banks
  if (youO) { for (const o of m.opps) o.stops = 0; for (const [o, b] of banks) if (o.heart > 0) { o.stops += b; ev(m, { type: 'stops', actor: oi(m, o), stops: b, text: `${o.name} banks ${b} Stops.` }); } }
  else { m.you.stops = Math.min(m.you.stops, m.you.keep); m.you.keep = 0; }
  // their cards' riders and the Stops they gained with the ball, now that it's played out
  tickPossession(m, offense);
  for (const o of alive(m)) for (const mv of o.set) {
    if (!youO && mv.stops) o.stops += oppStops(m, o, mv); // (a post-up's Stops: there on his next defense)
    if (mv.hot) { o.status.hot = (o.status.hot || 0) + mv.hot; ev(m, { type: 'status', actor: oi(m, o), text: `${o.name} is Hot ${o.status.hot}.` }); }
    if (mv.you) for (const [k, n] of Object.entries(mv.you)) if (applyStatus(m, m.you, k, n)) ev(m, { type: 'status', actor: oi(m, o), text: `You're ${cap1(k)} ${n}.` });
    if (mv.fatigue) { for (let k = 0; k < mv.fatigue.n; k++) X.addCard(m, mv.fatigue.id, 'discard'); ev(m, { type: 'fatigue', actor: oi(m, o), anim: 'foul', text: `${o.name} adds ${mv.fatigue.n} ${cardDef(mv.fatigue.id).name} to your discard.` }); }
  }
  betrayCheck(m);
  // your hand: what you could have played this turn and didn't goes to the discard; a card that couldn't be played on
  // this side of the ball stays for the next possession (the dead-hand rule, §15); Hold cards and Muscle Memory as ever
  const keep = [];
  if (ab(m, 'muscle_memory')) {
    let best = -1, bc = -1;
    m.hand.forEach((r, i) => { const d = cardDef(r); if (d.type !== 'fatigue' && !d.hold && phaseOk(m, d) && (d.cost || 0) > bc) { bc = d.cost || 0; best = i; } });
    if (best >= 0) keep.push(m.hand[best]), m.hand.splice(best, 1);
  }
  for (const r of m.hand) { const d = cardDef(r); if (d?.hold || (d && d.type !== 'fatigue' && !phaseOk(m, d))) keep.push(r); else m.discard.push(r); }
  m.hand = keep;
  m.log.turns++;
  run.hp = Math.max(0, m.you.hp);
  if (m.flags.sixthUsed) (run.flags || (run.flags = {})).sixthUsed = true;
  if (m.over) { m.t = null; refreshSets(m); endEvent(m); return flush(m); }
  // who has it next
  const defSide = youO ? 'them' : 'you';
  let next, kind, why;
  if (violation) { next = defSide; kind = 'offense'; why = youO ? 'Shot clock: their ball' : null; }
  else if (!atts.length) {
    if (pickedOff) { next = defSide; kind = 'fast_break'; }
    else { next = defSide; kind = 'offense'; why = youO ? 'Turnover: their ball' : 'Turnover: your ball'; }
  } else if (fouled) { next = last.made && rule(m, 'make_it_take_it') ? offense : defSide; kind = next === offense ? 'keep' : 'offense'; }
  else if (last.made) { next = rule(m, 'make_it_take_it') ? offense : defSide; kind = next === offense ? 'keep' : 'offense'; }
  else if (last.how === 'steal') { next = defSide; kind = 'fast_break'; }
  else if (last.how === 'charge') { next = defSide; kind = 'offense'; why = youO ? 'Charge: their ball' : 'You took the charge: your ball'; }
  else {
    const offBoard = offHustle > defHustle;
    ev(m, { type: 'rebound', actor: offBoard ? (youO ? 'you' : 0) : (youO ? 0 : 'you'), anim: 'rebound', offensive: offBoard, text: offBoard ? 'Offensive board.' : 'Rebound.' });
    next = offBoard ? offense : defSide; kind = offBoard ? 'second_chance' : 'offense';
  }
  beginPossession(m, next, kind, why);
  // (Make-It-Take-It's card comes on top of the new possession's draw: past a full hand it asks)
  if (next === 'you' && rule(m, 'make_it_take_it') && youO && last?.made) { ev(m, { type: 'draw', text: 'Make-It-Take-It: draw 1.' }); draw(m, 1, 'Make-It-Take-It'); refreshSets(m); }
  run.hp = Math.max(0, m.you.hp);
  return flush(m);
}

// ---------- views ----------
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
  if (!m || !m.t) { const e = []; e.flow = flowView(run); return e; }
  const out = m.hand.map((ref, i) => {
    const d = cardDef(ref), chk = canPlay(m, i), o = target(m, 0);
    const sv = d && d.type === 'shot' && o ? shotValue(m, d, o) : null;
    return { ref, index: i, cost: costOf(m, ref), playable: chk.ok, why: chk.ok ? '' : chk.why, offPhase: !!d && !phaseOk(m, d), points: sv ? sv.per * sv.hits : 0, hits: sv ? sv.hits : 0, stops: d ? stopsValue(m, d) : 0,
      combo: !!(d?.fx?.combo && m.t.last && m.t.last.includes(d.fx.combo.tag)), lent: m.lent?.card === ref };
  });
  out.flow = flowView(run);
  return out;
}
