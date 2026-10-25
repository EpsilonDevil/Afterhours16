// v0.4.8.9 qp7 §2: fuzz the Gauntlet engine for states that could freeze a UI (the Deck agent's harness).
//   node tools/deck_fuzz.mjs [runs=500] [seed0=1] [mode=both|replay|stress|smart]   (env ONLY=<seed>: one run; TRACE=1)
//   replay: honest random play, its log replayed; stress: abilities, cards, rules and bosses forced, most runs with
//   3,000 Health so random play reaches the Finals, and wrong-moment API calls; smart: deck_sim's policies, replayed.
// It's also a module: tests/v0489deck_fuzz.test.mjs runs a short pass of it.
// Random policies (seeded), starters and converted players, every rule / ability / boss / event / card reachable.
// Checks: no exceptions from any engine call or view; endTurn always returns events and either ends the match or
// advances the possession; matches end; a waiting draw is always resolvable; no NaN / undefined in events, foeSet,
// preview, hand views; replays of the logged choices equal the live outcome (replay mode).
import * as G from '../client/js/deck/index.js';
import { stream, next } from '../client/js/deck/rng.js';
import { CARD_LIST } from '../client/js/deck/cards.js';
import { ABILITY_LIST, gainAbility } from '../client/js/deck/abilities.js';
import { RULE_IDS } from '../client/js/deck/rules.js';
import { BOSSES } from '../client/js/deck/bosses.js';
import { convertedPlayer } from './deck_sim.mjs';

let findings = new Map(), SLOW = {};
const note = (kind, seed, detail) => { const k = kind + ': ' + String(detail).split('\n')[0].slice(0, 160); const f = findings.get(k) || { n: 0, seeds: [], detail: String(detail).slice(0, 900) }; f.n++; if (f.seeds.length < 6) f.seeds.push(seed); findings.set(k, f); };
const ANIMS = new Set(G.ANIMS);
const fin = x => typeof x === 'number' && Number.isFinite(x);
function checkEvents(evs, seed, where) {
  if (!Array.isArray(evs)) { note('events not an array', seed, where); return; }
  for (const e of evs) {
    if (!e || typeof e.type !== 'string') { note('event without a type', seed, `${where} ${JSON.stringify(e)}`); continue; }
    if (!(e.anim === null || ANIMS.has(e.anim))) note('event with an unknown anim', seed, `${where} ${e.type} ${e.anim}`);
    for (const k of ['t', 'points', 'stops']) if (!fin(e[k])) note(`event ${k} not a number`, seed, `${where} ${e.type} ${k}=${e[k]}`);
    if (e.actor !== 'you' && !Number.isInteger(e.actor)) note('event actor bad', seed, `${where} ${e.type} ${e.actor}`);
    if (typeof e.text !== 'string' || /undefined|NaN/.test(e.text)) note('event text bad', seed, `${where} ${e.type} ${e.text}`);
  }
}
function checkMatch(m, seed, where) {
  if (m.over) return;
  const fs = m.foeSet, p = m.preview;
  if (!fs || !Array.isArray(fs.cards)) { note('no foeSet', seed, where); return; }
  for (const c of fs.cards) if (!c.hidden) { if (typeof c.name !== 'string' || /undefined|NaN/.test(c.name + c.text)) note('foeSet card text bad', seed, `${where} ${JSON.stringify(c)}`); if (!fin(c.value)) note('foeSet value bad', seed, `${where} ${JSON.stringify(c)}`); if (!(c.anim === null || ANIMS.has(c.anim))) note('foeSet anim bad', seed, `${where} ${c.anim}`); }
  if (!(fs.total === null || fin(fs.total))) note('foeSet total bad', seed, `${where} ${fs.total}`);
  if (!p) { note('no preview', seed, where); return; }
  for (const k of ['o', 'd', 'points']) if (!(p[k] === null || fin(p[k]))) note('preview bad', seed, `${where} ${k}=${p[k]}`);
  if (!['score', 'stopped', '?'].includes(p.result)) note('preview result bad', seed, `${where} ${p.result}`);
  if (!fin(m.you.hp) || !fin(m.energy) || m.opps.some(o => !fin(o.heart) || !fin(o.stops))) note('match numbers bad', seed, `${where} hp ${m.you.hp} e ${m.energy} ${m.opps.map(o => o.heart + '/' + o.stops)}`);
  if (m.hand.length > m.handMax) note('hand past its max', seed, `${where} ${m.hand.length} > ${m.handMax}`);
  if (m.hand.some(r => !G.cardInfo(r)?.name)) note('unknown card in hand', seed, `${where} ${m.hand}`);
  const hv = G.handView({ match: m });
  for (const h of hv) if (!fin(h.points) || !fin(h.stops) || !(h.cost === null || fin(h.cost))) note('handView numbers bad', seed, `${where} ${JSON.stringify(h)}`);
  if (m.pendingDraw) { const pd = m.pendingDraw; if (!pd.ref || !pd.cardInfo?.name || !fin(pd.remaining) || !fin(pd.handMax) || typeof pd.why !== 'string') note('pendingDraw shape bad', seed, `${where} ${JSON.stringify(pd)}`); }
}

// calls a UI might make at the wrong moment: they must not throw, and a refused one must change nothing
function hostile(run, seed, rnd, ri) {
  const before = G.stateHash(run), stage = run.stage, m = run.match;
  const calls = [
    ['playCard 99', () => G.playCard(run, 99, 0), stage !== 'match'],
    ['playCard -1', () => G.playCard(run, -1, 7), true],
    ['resolveDraw none', () => (m?.pendingDraw ? [] : G.resolveDraw(run, { discard: 0 })), true],
    ['resolveDraw junk', () => G.resolveDraw(run, { discard: 'x' }), true],
    ['endTurn off-match', () => (stage !== 'match' ? G.endTurn(run) : []), true],
    ['takeReward off-stage', () => (stage !== 'reward' ? G.takeReward(run, { card: 0, ability: true }) : null), true],
    ['enterNode bad', () => G.enterNode(run, 'nope-' + ri(9)), true],
    ['shopBuy off-stage', () => (stage !== 'shop' ? G.shopBuy(run, 'card', 0) : null), true],
    ['shopRemove off-stage', () => (stage !== 'shop' ? G.shopRemove(run, 0) : null), true],
    ['cooler off-stage', () => (stage !== 'cooler' ? G.cooler(run, 'heal') : null), true],
    ['eventChoose off-stage', () => (stage !== 'event' ? G.eventChoose(run, 0) : null), true],
    ['views', () => { G.handView(run); G.flowView(run); G.mapView(run); if (stage === 'shop') G.shopView(run); if (stage === 'cooler') G.coolerView(run); if (stage === 'event') G.eventView(run); G.runOver(run); return null; }, true],
  ];
  const [name, f, pure] = calls[ri(calls.length)];
  try { f(); } catch (e) { note('exception from a hostile call', seed, `${name} (${stage}): ${e?.stack || e}`); return; }
  if (pure && name !== 'views' && G.stateHash(run) !== before) note('a refused call changed the run', seed, `${name} (${stage})`);
}
function oneRun(seed, mode) {
  const st = stream(seed, 'fuzz');
  const rnd = () => next(st), ri = n => Math.floor(rnd() * n), pick = l => l[ri(l.length)];
  const conv = rnd() < 0.35;
  const unlocks = rnd() < 0.5 ? { startAbility: pick(ABILITY_LIST).id, cards: Array.from({ length: ri(4) }, () => pick(CARD_LIST).id) } : null;
  const start = { engine: G.ENGINE_VERSION, seed, player: conv ? convertedPlayer(seed) : G.rollStarters(seed)[ri(3)], world: null, unlocks };
  const run = G.newRun(start);
  const log = [];
  if (mode === 'stress') {
    if (rnd() < 0.7) { run.maxHp = run.hp = 3000; } // (deep: random play reaches the late phases, every boss and the Finals)
    for (let k = ri(7); k > 0; k--) gainAbility(run, pick(ABILITY_LIST).id);
    for (let k = ri(10); k > 0; k--) run.deck.push(pick(CARD_LIST).id + (rnd() < 0.3 ? '+' : ''));
    if (rnd() < 0.4) for (let k = 3 + ri(8); k > 0; k--) run.deck.push(pick(['skip_pass', 'spin_move', 'no_look', 'motion_offense', 'strip_job', 'clear_out', 'next_play', 'handle_mastery', 'crossover', 'outlet_pass', 'extra_pass']) + (rnd() < 0.3 ? '+' : ''));
    run.deck = run.deck.filter(r => G.cardInfo(r)?.name);
    for (const ph of run.map.phases) for (const n of Object.values(ph.nodes)) {
      if (n.kind === 'match' || n.kind === 'rival' || n.kind === 'boss') { const r1 = rnd() < 0.15 ? 'make_it_take_it' : pick(RULE_IDS), r2 = pick(RULE_IDS); n.rules = rnd() < 0.4 && r1 !== r2 ? [r1, r2] : [r1]; }
      if (n.kind === 'boss' && n.foes.length === 1 && rnd() < 0.7) { const pool = Object.values(BOSSES).filter(b => b.phase === ph.phase && !['twin_towers', 'dynasty'].includes(b.id)); if (pool.length) n.boss = pick(pool).id; }
    }
  }
  const A = (kind, ...a) => { const t = performance.now(); const r = G.act(run, log, kind, ...a); const dt = performance.now() - t; if (dt > (SLOW[kind]?.ms || 0)) SLOW[kind] = { ms: dt, seed }; return r; };
  const endP = rnd() < 0.5 ? 0.25 : 0.6; // (a spammy End Turn player, or one who plays out his hand)
  let steps = 0, poss = 0, matchSteps = 0, lastMatch = null;
  for (; steps < 30000 && !run.over; steps++) {
    const stage = run.stage;
    if (rnd() < 0.08) hostile(run, seed, rnd, ri);
    try {
      if (stage === 'map') {
        const av = G.availableNodes(run);
        if (!av.length) { note('map with nowhere to go', seed, `phase ${run.phase} at ${run.at}`); break; }
        G.mapView(run);
        const r = A('node', pick(av));
        if (!r.ok) note('node refused', seed, r.error);
      } else if (stage === 'match') {
        const m = run.match;
        if (m !== lastMatch) { lastMatch = m; poss = 0; matchSteps = 0; checkEvents(m.intro, seed, 'intro'); }
        if (++matchSteps > 20000) { note('match never ends (steps)', seed, `${m.kind} ${m.boss} poss ${m.poss} hp ${m.you.hp} heart ${m.opps.map(o => o.heart)}`); break; }
        if (m.over) { G.matchOver(run); if (run.stage === 'match') { note('match over but stage stays match', seed, JSON.stringify(m.over)); break; } continue; }
        checkMatch(m, seed, `match ${m.id} poss ${m.poss}`);
        if (m.pendingDraw) {
          const x = rnd();
          // (a nonsense answer must be refused and change nothing)
          if (x < 0.1) { const bad = G.resolveDraw(run, rnd() < 0.5 ? { discard: m.hand.length + 3 } : {}); if (bad.ok !== false) note('bad draw answer accepted', seed, 'resolveDraw'); if (!m.pendingDraw) note('bad draw answer cleared the wait', seed, ''); continue; }
          if (x < 0.15) { const p = G.playCard(run, 0, 0), e = G.endTurn(run); if (p.ok !== false || e.ok !== false) note('play/end allowed while a draw waits', seed, `${p.ok} ${e.ok}`); continue; }
          const r = x < 0.5 || !m.hand.length ? A('draw', 'refuse') : A('draw', 'discard', ri(m.hand.length));
          if (!r.ok) note('draw answer refused', seed, r.error); else checkEvents(r.result, seed, 'resolveDraw');
          continue;
        }
        const playable = m.hand.map((_, i) => i).filter(i => G.canPlay(run, i).ok);
        if (playable.length && rnd() > endP) {
          const i = rnd() < 0.9 ? pick(playable) : ri(m.hand.length + 1);
          const r = A('play', i, ri(m.opps.length));
          if (r.ok) checkEvents(r.result, seed, 'playCard');
        } else {
          if (process.env.TRACE && poss > 590) console.log(`poss ${m.poss} ${m.turnType} E${m.energy}/${m.maxEnergy} hand ${m.hand.join(',')} playable ${playable} max ${m.handMax} stops ${m.you.stops} set ${JSON.stringify(m.opps.map(o => o.set.map(x => [x.name, x.pts, x.stops])))} prev ${JSON.stringify(m.preview)} deck ${m.deck.length} draw ${m.drawPile.length} disc ${m.discard.length} burned ${m.burned.length} hp ${m.you.hp} heart ${m.opps.map(o => o.heart + '/' + o.stops)} st ${JSON.stringify(m.opps.map(o => o.status))} you ${JSON.stringify(m.you.status)}`);
          const p0 = m.poss, r = A('end');
          if (!r.ok) { note('end refused', seed, r.error); break; }
          checkEvents(r.result, seed, 'endTurn');
          if (!r.result.length) note('endTurn returned no events', seed, `${m.kind} poss ${m.poss}`);
          if (!m.over && m.poss === p0) note('endTurn neither ended nor advanced', seed, `${m.kind} poss ${m.poss}`);
          // (a long match is fine while someone's still losing Heart or Health; 150 possessions with no change is a stall)
          if (++poss % 150 === 0) { const sig = m.you.hp + '|' + m.opps.map(o => o.heart).join(','); if (sig === m._fz) { note('match stalled: 150 possessions, nothing changes', seed, `${m.kind} ${m.boss || ''} rules ${m.rules.map(r => r.id)} hp ${m.you.hp} heart ${m.opps.map(o => o.heart)}`); break; } m._fz = sig; }
          if (poss > 3000) { note('match never ends (possessions)', seed, `${m.kind} ${m.boss || ''} rules ${m.rules.map(r => r.id)} hp ${m.you.hp} heart ${m.opps.map(o => o.heart)}`); break; }
        }
      } else if (stage === 'reward') {
        const rw = run.reward;
        const card = rnd() < 0.8 ? ri(rw.cards.length) : null;
        const ab = rw.abilities ? ri(rw.abilities.length) : rw.ability ? rnd() < 0.7 : false;
        const r = A('reward', card, ab);
        if (!r.ok) { note('reward refused', seed, r.error); break; }
      } else if (stage === 'cooler') {
        const opts = G.coolerView(run).options.filter(o => o.enabled);
        if (!opts.length) { note('cooler with no option', seed, ''); break; }
        const o = pick(opts);
        const r = A('cooler', o.id, o.id === 'upgrade' || o.id === 'remove' ? ri(run.deck.length) : null);
        if (!r.ok) { const r2 = A('cooler', 'skip'); if (!r2.ok && !A('cooler', 'heal').ok) { note('cooler stuck', seed, `${r.error} / ${r2.error}`); break; } }
      } else if (stage === 'shop') {
        const v = G.shopView(run), x = rnd();
        if (x < 0.3 && v.cards.length) A('shopBuy', 'card', ri(v.cards.length));
        else if (x < 0.45 && v.abilities.length) A('shopBuy', 'ability', ri(v.abilities.length));
        else if (x < 0.55 && run.deck.length) A('shopRemove', ri(run.deck.length));
        else { const r = A('leave'); if (!r.ok) { note('shop leave refused', seed, r.error); break; } }
      } else if (stage === 'event') {
        const v = G.eventView(run);
        if (run.event?.done) { const r = A('leave'); if (!r.ok) { note('done event, leave refused', seed, r.error); break; } continue; }
        const en = v.choices.map((c, i) => [c, i]).filter(([c]) => c.enabled);
        if (!en.length) { note('event with no open choice', seed, v.id); break; }
        const r = A('event', pick(en)[1]);
        if (!r.ok) { note('event choice refused', seed, `${v.id}: ${r.error}`); break; }
      } else { note('unknown stage', seed, stage); break; }
    } catch (e) { note('exception', seed, `${stage}: ${e?.stack || e}`); break; }
  }
  if (!run.over && steps >= 30000) note('run never ends (steps)', seed, `stage ${run.stage} phase ${run.phase}`);
  try { G.runOver(run); if (run.over) { const s = G.runOver(run); if (!fin(s.summary.vc.total)) note('vc not a number', seed, JSON.stringify(s.summary.vc)); } } catch (e) { note('exception in runOver', seed, e?.stack || e); }
  if (mode === 'replay') {
    try { const rp = G.replay(start, log); if (!rp.ok) note('replay refused an honest log', seed, `${rp.error} at ${rp.at}`); else if (rp.hash !== G.outcomeHash(run)) note('replay differs from the live run', seed, `${rp.hash} vs ${G.outcomeHash(run)}`); }
    catch (e) { note('exception in replay', seed, e?.stack || e); }
  }
  return { steps, completed: !!run.over?.completed, log: log.length, draws: log.filter(c => c[0] === 'draw').length };
}

export async function fuzz(N = 500, S0 = 1, MODE = 'both', only = null) {
  findings = new Map(); SLOW = {};
  const t0 = Date.now();
  let runs = 0, steps = 0, comp = 0, draws = 0;
  const modes = MODE === 'both' ? ['replay', 'stress'] : [MODE];
  if (only != null) { oneRun(+only, MODE === 'both' ? 'stress' : MODE); runs = 1; }
  else if (MODE === 'smart') {
    const { playRun } = await import('./deck_sim.mjs');
    for (let k = 0; k < +N; k++) {
      const s = +S0 + k * 104729, pol = k % 3 === 0 ? 'greedy' : 'smart';
      try {
        const r = playRun(s, pol, { player: k % 2 ? convertedPlayer(s) : null });
        draws += r.log.filter(c => c[0] === 'draw').length;
        const rp = G.replay(r.start, r.log);
        if (!rp.ok) note('replay refused a policy log', s, `${pol}: ${rp.error} at ${rp.at}`); else if (rp.hash !== G.outcomeHash(r.run)) note('replay differs (policy)', s, pol);
        runs++; comp += r.completed ? 1 : 0; steps += r.log.length;
      } catch (e) { note('exception (policy run)', s, e?.stack || e); }
    }
  } else for (const mode of modes) for (let k = 0; k < +N; k++) { const s = +S0 + k * 7919 + (mode === 'stress' ? 1 : 0); const r = oneRun(s, mode); runs++; steps += r.steps; comp += r.completed ? 1 : 0; draws += r.draws; }
  return { runs, steps, completed: comp, draws, secs: (Date.now() - t0) / 1000, modes, findings: [...findings].map(([k, f]) => ({ what: k, ...f })), slow: SLOW };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [N = '500', S0 = '1', MODE = 'both'] = process.argv.slice(2);
  const r = await fuzz(+N, +S0, MODE, process.env.ONLY || null);
  console.log(`fuzz: ${r.runs} runs (${MODE}), ${r.steps} choices, ${r.completed} completed, ${r.draws} hand-full draw answers, ${r.secs.toFixed(0)} s`);
  for (const f of r.findings) console.log(`\n[${f.n}x] ${f.what}\n  seeds ${f.seeds.join(', ')}\n  ${f.detail.replace(/\n/g, '\n  ')}`);
  if (!r.findings.length) console.log('no findings');
  console.log('slowest call of each kind (ms):', Object.entries(r.slow).map(([k, v]) => `${k} ${v.ms.toFixed(1)} (seed ${v.seed})`).join(', '));
}
