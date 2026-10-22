// v0.4.8.9 The Gauntlet balance harness: plays many seeded runs with scripted policies and reports win rates,
// boss walls, run length (15 s per card played, 30 s per non-match node, GAUNTLET.md task brief) and VC.
//   node tools/deck_sim.mjs [runs=200] [--policy=greedy|smart|both] [--type=starter|converted|both] [--seed=1]
//                           [--boss=<id>] (that boss in its phase on every run: a boss's own win rate) [--world]
// It's also a module: the tests use its policies (a good deck has to be able to beat every boss).
import * as G from '../client/js/deck/index.js';
import { cardDef, POOL, canUpgrade, CARDS } from '../client/js/deck/cards.js';
import { stream, next, shuffle, int } from '../client/js/deck/rng.js';
import { oppHit } from '../client/js/deck/combat.js';
import { BOSSES } from '../client/js/deck/bosses.js';

const clone = x => structuredClone(x);
// every call that changes the real run goes through the choice log (client/js/deck/replay.js), so a sim run can be
// replayed: LOGS maps a run to its log
const LOGS = new WeakMap();
const act = (run, kind, ...a) => { const l = LOGS.get(run); return l ? G.act(run, l, kind, ...a) : G.applyChoice(run, [kind, ...a]); };

// ---------- combat ----------
function incoming(m) {
  let n = 0;
  for (const o of m.opps) {
    if (o.heart <= 0) continue;
    const mv = o.queue[0];
    if (mv?.pts) n += oppHit(m, o, mv) * (mv.hits || 1) * (o.boss && BOSSES[o.boss]?.hitsMult ? BOSSES[o.boss].hitsMult(m, o) : 1);
  }
  return n;
}
const heartSum = m => { const seen = new Set(); let s = 0; for (const o of m.opps) { if (o.shared) { if (seen.has(o.shared)) continue; seen.add(o.shared); } s += Math.max(0, o.heart); } return s; };
function evalM(m0h, m, hpw) {
  if (m.over) return m.over.won ? 100000 + m.you.hp * 20 : -100000;
  const dmg = m0h - heartSum(m);
  const loss = Math.max(0, incoming(m) - m.you.stops);
  let v = dmg - loss * hpw - Math.max(0, -m.you.hp) * 50;
  v += (m.you.status.hot || 0) * 2.5 + m.powers.length * 7 + m.you.keep * 0.4 + (m.you.status.charge || 0) * 4;
  for (const o of m.opps) if (o.heart > 0) { v += Math.min(2, (o.status.exposed || 0) - 1) * 3 + (o.status.cold ? 1 : 0); v -= o.stops * 0.3; }
  v += m.hand.filter(r => cardDef(r)?.hold).length * 1.5;
  v += m.hand.length * 1.2 + m.energy * 0.5; // (options left this turn: what draws and energy are worth to a one-card-at-a-time player)
  return v;
}
const tgt = m => { let b = 0, bh = Infinity; m.opps.forEach((o, i) => { if (o.heart > 0 && o.heart < bh) { bh = o.heart; b = i; } }); return b; };
function sims(m, st) {
  const c = clone(m);
  shuffle(st, c.drawPile); c.rs = { s: (next(st) * 4294967296) >>> 0 }; // (the policy doesn't get to peek at the draw order)
  return c;
}
function playable(m) {
  const seen = new Set(), out = [];
  G.handView({ match: m }).forEach((h, i) => { if (h.playable && !seen.has(h.ref)) { seen.add(h.ref); out.push(i); } });
  return out;
}
// greedy: the card that looks best right now, one at a time, while anything improves the position
export function _greedyTurn(...a) { return greedyTurn(...a); }
function greedyTurn(run, st, hpw) {
  for (let guard = 0; guard < 25 && !run.match.over; guard++) {
    const m = run.match, h0 = heartSum(m);
    let best = null, bv = evalM(h0, m, hpw);
    for (const i of playable(m)) {
      const c = sims(m, st); G.playCard({ match: c, hp: run.hp, flags: {} }, i, tgt(c));
      const v = evalM(h0, c, hpw);
      if (v > bv + 0.01) { bv = v; best = i; }
    }
    if (best == null) break;
    act(run, 'play', best, tgt(m));
  }
}
// smart: a beam search over whole sequences (it sees combos, Flow, setups and kills), re-planned after each card
export function _smartTurn(...a) { return smartTurn(...a); }
function smartTurn(run, st, hpw, W = 5, D = 7) {
  for (let guard = 0; guard < 25 && !run.match.over; guard++) {
    const m = run.match, h0 = heartSum(m);
    let beam = [{ m, first: null }], best = { v: evalM(h0, m, hpw), first: null };
    for (let d = 0; d < D && beam.length; d++) {
      const nxt = [];
      for (const s of beam) for (const i of playable(s.m)) {
        const c = sims(s.m, st); G.playCard({ match: c, hp: run.hp, flags: {} }, i, tgt(c));
        const v = evalM(h0, c, hpw), first = s.first ?? i;
        nxt.push({ m: c, first, v });
        if (v > best.v + 0.01) best = { v, first };
      }
      nxt.sort((a, b) => b.v - a.v);
      beam = nxt.slice(0, W);
    }
    if (best.first == null) break;
    act(run, 'play', best.first, tgt(m));
  }
}

// ---------- card values (the policies' taste) ----------
function deckTags(deck) { const t = {}; for (const r of deck) for (const g of cardDef(r)?.tags || []) t[g] = (t[g] || 0) + 1; return t; }
export function cardValue(ref, deck) {
  const d = cardDef(ref);
  if (!d) return -10;
  if (d.type === 'fatigue') return -8;
  let v = { starter: 1, common: 4, uncommon: 6, rare: 8, special: 3 }[d.rarity] + (d.upgraded ? 1.5 : 0);
  if (d.id === 'crossover' || d.id === 'outlet_pass') v = 3 + (d.upgraded ? 1 : 0);
  const tags = deckTags(deck), n = deck.length;
  if (d.fx.combo && (tags[d.fx.combo.tag] || 0) >= 3) v += 1.5;
  if (d.fx.power?.tag && (tags[d.fx.power.tag] || 0) >= 4) v += 2;
  if (d.fx.depth) v += n >= 18 ? 1.5 : -1;
  if (d.fx.tight || d.fx.power?.id === 'tight_energy') v += n <= 13 ? 1.5 : -2.5;
  const defs = deck.filter(r => cardDef(r)?.type === 'defense').length;
  if (d.type === 'defense' && defs < n * 0.3) v += 1.5;
  if ((d.fx.draw || d.fx.energy) && d.cost === 0) v += 0.5;
  return v;
}
const deckValue = deck => deck.reduce((s, r) => s + cardValue(r, deck), 0);
function runValue(run) {
  const s = run.player.stats;
  return run.hp * 1.0 + run.coins * 0.12 + deckValue(run.deck) * 0.8 + run.abilities.length * 12 + (s.stamina + s.shooting + s.defense) * 10 + s.health * 8 + (run.bonusHp || 0) * 0.6;
}

// ---------- the rest of a run ----------
const POL = {
  greedy: {
    turn: greedyTurn,
    node(run, av) {
      const pref = run.hp < run.maxHp * 0.4 ? ['cooler', 'shop', 'event', 'match', 'rival', 'boss'] : ['match', 'event', 'rival', 'shop', 'cooler', 'boss'];
      return av.slice().sort((a, b) => pref.indexOf(G.nodeOf(run, a).kind) - pref.indexOf(G.nodeOf(run, b).kind))[0];
    },
    reward(run, rw) {
      const rank = r => ({ rare: 3, uncommon: 2, common: 1 }[cardDef(r).rarity] || 0) + (cardDef(r).upgraded ? 0.5 : 0);
      let bi = 0; rw.cards.forEach((r, i) => { if (rank(r) > rank(rw.cards[bi])) bi = i; });
      return { card: bi, ability: true };
    },
    cooler(run) {
      if (run.hp < run.maxHp * 0.5 || !run.deck.some(canUpgrade)) return ['heal'];
      return ['upgrade', run.deck.findIndex(canUpgrade)];
    },
    shop(run) {
      const v = G.shopView(run);
      const c = v.cards.map((c, i) => [c, i]).filter(([c]) => !c.sold && c.price <= run.coins).sort((a, b) => b[0].price - a[0].price)[0];
      if (c) act(run, 'shopBuy', 'card', c[1]);
    },
    event(run) { const v = G.eventView(run); return Math.max(0, v.choices.findIndex(c => c.enabled)); },
  },
  smart: {
    turn: smartTurn,
    node(run, av) {
      // look ahead: what this node is worth now, plus the best of what it leads to
      const hpF = run.hp / run.maxHp;
      const worth = n => {
        const k = n.kind;
        if (k === 'boss') return 0;
        if (k === 'match') return hpF > 0.35 ? 6 : 1;
        if (k === 'rival') return hpF > 0.7 ? 9 : hpF > 0.5 ? 3 : -12;
        if (k === 'cooler') return hpF < 0.6 ? 12 : 5;
        if (k === 'shop') return run.coins >= 140 ? 9 : run.coins >= 80 ? 5 : 1;
        return 5; // event
      };
      const look = (id, d) => { const n = G.nodeOf(run, id); if (!n.next.length || d === 0) return worth(n); return worth(n) + 0.6 * Math.max(...n.next.map(x => look(x, d - 1))); };
      return av.slice().sort((a, b) => look(b, 3) - look(a, 3) || (a < b ? -1 : 1))[0];
    },
    reward(run, rw) {
      let bi = null, bv = run.deck.length < 14 ? 3.5 : 4.8;
      rw.cards.forEach((r, i) => { const v = cardValue(r, run.deck); if (v > bv) { bv = v; bi = i; } });
      return { card: bi, ability: rw.abilities ? bestBoss(run, rw.abilities) : true };
    },
    cooler(run, nextBoss) {
      const v = G.coolerView(run).options.filter(o => o.enabled).map(o => o.id);
      const need = nextBoss ? 0.8 : 0.6;
      if (v.includes('icebath')) return ['icebath'];
      if (v.includes('heal') && run.hp < run.maxHp * need) return ['heal'];
      if (v.includes('remove')) { const i = run.deck.findIndex(r => cardDef(r).type === 'fatigue'); if (i >= 0) return ['remove', i]; }
      if (v.includes('upgrade')) {
        let bi = -1, bv = -Infinity;
        run.deck.forEach((r, i) => { if (!canUpgrade(r)) return; const d = cardDef(r); const s = { rare: 8, uncommon: 6, common: 4, starter: d.id === 'crossover' ? 5 : 1 }[d.rarity] + (d.type === 'mentality' ? 2 : 0); if (s > bv) { bv = s; bi = i; } });
        if (bi >= 0) return ['upgrade', bi];
      }
      return v.includes('heal') ? ['heal'] : ['skip'];
    },
    shop(run) {
      let v = G.shopView(run);
      // a removal first: Fatigue, then a starter basic
      const worst = run.deck.findIndex(r => cardDef(r).type === 'fatigue');
      const basic = run.deck.findIndex(r => r === 'jumper' || r === 'closeout');
      const ri = worst >= 0 ? worst : basic;
      if (ri >= 0 && !v.removeUsed && run.coins >= v.removePrice && (worst >= 0 || run.coins >= v.removePrice + 40)) act(run, 'shopRemove', ri);
      for (let k = 0; k < 3; k++) {
        v = G.shopView(run);
        const opts = [];
        v.abilities.forEach((a, i) => { if (!a.sold && a.price <= run.coins) opts.push(['ability', i, 14 - a.price / 40]); });
        v.cards.forEach((c, i) => { if (!c.sold && c.price <= run.coins) { const cv = cardValue(c.ref, run.deck); if (cv >= 5) opts.push(['card', i, cv - c.price / 30]); } });
        opts.sort((a, b) => b[2] - a[2]);
        if (!opts.length || opts[0][2] < 2) break;
        act(run, 'shopBuy', opts[0][0], opts[0][1]);
      }
    },
    event(run) {
      const v = G.eventView(run);
      let bi = 0, bv = -Infinity;
      v.choices.forEach((c, i) => {
        if (!c.enabled) return;
        const r2 = clone(run);
        const res = G.eventChoose(r2, i);
        let val = runValue(r2);
        if (res.fight) val += run.hp > run.maxHp * 0.65 ? 18 : -30;
        if (val > bv) { bv = val; bi = i; }
      });
      return bi;
    },
  },
};
function bestBoss(run, list) {
  // energy is king, unless its drawback hits this deck hard
  const pref = ['max_contract', 'spotlight', 'signature_shoe', 'superteam', 'franchise_tag'];
  let bi = 0; list.forEach((a, i) => { if (pref.indexOf(a) < pref.indexOf(list[bi])) bi = i; });
  return bi;
}

// ---------- a whole run ----------
const takeR = (run, pk) => act(run, 'reward', pk.card ?? null, run.reward.ability ? (pk.ability ?? false) : false);
export function playMatch(run, policy, st) {
  const P = POL[policy];
  const boss = run.match.kind === 'boss';
  for (let t = 0; t < 60 && !run.match.over; t++) {
    const hpw = 1.15 + 1.6 * (1 - run.hp / run.maxHp) + (boss ? 0.25 : 0);
    P.turn(run, st, hpw);
    if (!run.match.over) act(run, 'end');
  }
  if (!run.match.over) return { won: false, stalled: true }; // (60 turns: the policy is stuck; the run stops here)
  return G.matchOver(run);
}
export function playRun(seed, policy = 'smart', { player = null, world = null, forceBoss = null, ai = null, now = undefined } = {}) {
  const P = POL[policy], st = stream(seed, 'policy', policy);
  const start = { seed, player: player || G.rollStarters(seed)[0], world, unlocks: null };
  const run = G.newRun({ ...start, ai, now });
  const log = []; LOGS.set(run, log);
  if (forceBoss) for (const ph of run.map.phases) for (const n of Object.values(ph.nodes)) if (n.kind === 'boss' && BOSSES[forceBoss].phase === ph.phase && n.foes.length === 1) n.boss = forceBoss;
  const bosses = [], fights = [];
  for (let guard = 0; guard < 120 && !run.over; guard++) {
    const av = G.availableNodes(run);
    if (!av.length) break;
    const id = av.length === 1 ? av[0] : P.node(run, av);
    const n = G.nodeOf(run, id);
    const r = act(run, 'node', id).result;
    if (r.kind === 'match' || r.kind === 'rival' || r.kind === 'boss') {
      const hp0 = run.hp;
      const mo = playMatch(run, policy, st);
      fights.push({ kind: r.kind === 'boss' ? (n.phase === 4 ? 'final' : 'boss') : r.kind, phase: n.phase, turns: run.match.turn, cards: run.match.log.played, lost: hp0 - run.hp, won: mo.won });
      if (r.kind === 'boss') bosses.push({ id: n.boss, phase: n.phase, won: mo.won, hpIn: hp0 / run.maxHp });
      if (mo.stalled) break;
      if (mo.won && run.stage === 'reward') takeR(run, P.reward(run, run.reward));
    } else if (r.kind === 'cooler') {
      const nextBoss = n.next.some(x => G.nodeOf(run, x).kind === 'boss');
      const [a, i] = P.cooler(run, nextBoss); act(run, 'cooler', a, i ?? null);
    } else if (r.kind === 'shop') { P.shop(run); act(run, 'leave'); }
    else if (r.kind === 'event') {
      const res = act(run, 'event', P.event(run)).result;
      if (res?.fight) { const mo = playMatch(run, policy, st); if (mo.stalled) break; if (mo.won && run.stage === 'reward') takeR(run, P.reward(run, run.reward)); }
    }
  }
  const sum = G.runOver(run) || { completed: false, phaseReached: run.phase, summary: { estMinutes: 0, vc: { total: 0 } } };
  return { seed, policy, start, log, fights, completed: sum.completed, phase: sum.phaseReached, minutes: sum.summary.estMinutes, vc: sum.summary.vc.total, vcRaw: sum.summary.vc.raw ?? 0, bosses, deck: run.deck.length, abilities: run.abilities.length, turns: sum.durationTurns, stats: run.player.start, run };
}
// a converted player: an ICON build's ratings (high-80s to 90s)
export function convertedPlayer(seed) {
  const st = stream(seed, 'conv');
  const base = { stamina: int(st, 80, 97), shooting: int(st, 80, 97), defense: int(st, 80, 97), health: int(st, 80, 97) };
  return G.rollConverted(seed, { id: 'icon-' + seed, name: 'Icon', base, converted: true });
}

// ---------- the report ----------
function report(rows, label) {
  const n = rows.length, won = rows.filter(r => r.completed);
  const pct = x => (100 * x).toFixed(1) + '%';
  const avg = (l, f) => (l.length ? l.reduce((s, r) => s + f(r), 0) / l.length : 0);
  const reach = p => rows.filter(r => r.phase >= p).length / n;
  console.log(`\n== ${label}: ${n} runs ==`);
  console.log(`  Final won: ${pct(won.length / n)}   reached P2 ${pct(reach(2))}  P3 ${pct(reach(3))}  Final ${pct(rows.filter(r => r.bosses.some(b => b.phase === 4)).length / n)}`);
  console.log(`  minutes (completed): avg ${avg(won, r => r.minutes).toFixed(0)}  min ${Math.min(...won.map(r => r.minutes), Infinity)}  max ${Math.max(...won.map(r => r.minutes), 0)}   (all runs avg ${avg(rows, r => r.minutes).toFixed(0)})`);
  console.log(`  VC (completed): avg ${avg(won, r => r.vc).toFixed(0)} (before the cap ${avg(won, r => r.vcRaw).toFixed(0)})   failed avg ${avg(rows.filter(r => !r.completed), r => r.vc).toFixed(0)}`);
  console.log(`  deck at end ${avg(rows, r => r.deck).toFixed(1)} cards, ${avg(rows, r => r.abilities).toFixed(1)} abilities, ${avg(won, r => r.turns).toFixed(0)} turns a completed run`);
  const fk = {};
  for (const r of rows) for (const f of r.fights) { const k = `${f.kind}${f.kind === 'final' ? '' : ' P' + f.phase}`; const x = fk[k] || (fk[k] = { n: 0, t: 0, c: 0, l: 0 }); x.n++; x.t += f.turns; x.c += f.cards; x.l += f.lost; }
  console.log('  fights (count a run, turns, cards, Health lost): ' + Object.entries(fk).sort().map(([k, x]) => `${k} ${(x.n / n).toFixed(1)}× ${(x.t / x.n).toFixed(1)}t ${(x.c / x.n).toFixed(1)}c -${(x.l / x.n).toFixed(1)}`).join(' | '));
  const deaths = {};
  for (const r of rows) if (!r.completed) { const b = r.bosses.find(x => !x.won); const lf = r.fights.find(f => !f.won); const k = b ? `boss ${b.id}` : `P${r.phase} ${lf ? lf.kind : 'other'}`; deaths[k] = (deaths[k] || 0) + 1; }
  console.log('  where runs end: ' + Object.entries(deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / n)}`).join(', '));
  const bs = {};
  for (const r of rows) for (const b of r.bosses) { const x = bs[b.id] || (bs[b.id] = { f: 0, w: 0, hp: 0 }); x.f++; x.w += b.won ? 1 : 0; x.hp += b.hpIn; }
  console.log('  boss win rate (faced → won, Health coming in): ' + Object.entries(bs).sort((a, b) => (BOSSES[a[0]].phase - BOSSES[b[0]].phase) || (a[0] < b[0] ? -1 : 1)).map(([k, x]) => `${k} ${x.w}/${x.f} ${pct(x.w / x.f)} (${pct(x.hp / x.f)})`).join(', '));
  return { n, win: won.length / n, minutes: avg(won, r => r.minutes) };
}
// --world: one account's runs back to back (the smart policy, starters), the nemesis world carried between them
function worldReport(N, seed0) {
  let world = G.emptyWorld(seed0), wins = 0, nemBoss = 0, lends = 0, betrays = 0;
  const feed = [];
  for (let k = 0; k < N; k++) {
    const s = seed0 + k * 104729;
    const r = playRun(s, 'smart', { world });
    if (r.completed) wins++;
    if (r.run.map.phases.some(ph => Object.values(ph.nodes).some(n => n.boss === 'nemesis'))) nemBoss++;
    lends += r.run.plot.lends.length; betrays += r.run.plot.betray ? 1 : 0;
    const after = G.worldAfterRun(world, G.runOver(r.run) || { chars: r.run.outcomes }, s);
    const tick = G.worldTick(after.world, s);
    world = tick.world; feed.push(...after.feed, ...tick.feed);
  }
  const ranks = [0, 0, 0, 0, 0], cs = Object.values(world.chars);
  for (const c of cs) ranks[c.rank]++;
  console.log(`\n== nemesis world over ${N} runs (smart, starters) ==`);
  console.log(`  Final won ${(100 * wins / N).toFixed(1)}%   runs with a Nemesis boss on the map ${nemBoss}   ally lends ${lends}   betrayal plots ${betrays}`);
  console.log(`  characters ${cs.length}: ` + ranks.map((n, i) => `${G.rankName(i)} ${n}`).join(', ') + `   grudges ${cs.filter(c => c.grudge).length}, owe you ${cs.filter(c => c.owes).length}`);
  console.log('  word on the street (last 8):\n    ' + feed.slice(-8).join('\n    '));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
  const N = +(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 200), seed0 = +(args.seed || 1);
  const pols = args.policy && args.policy !== 'both' ? [args.policy] : ['greedy', 'smart'];
  const types = args.type && args.type !== 'both' ? [args.type] : ['starter', 'converted'];
  const t0 = Date.now();
  if ('world' in args) { worldReport(N, seed0); console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`); process.exit(0); }
  for (const type of types) for (const pol of pols) {
    const rows = [];
    for (let k = 0; k < N; k++) { const s = seed0 + k * 7919; const r = playRun(s, pol, { player: type === 'converted' ? convertedPlayer(s) : null, forceBoss: args.boss || null }); delete r.run; rows.push(r); }
    report(rows, `${pol} policy, ${type} players`);
  }
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
