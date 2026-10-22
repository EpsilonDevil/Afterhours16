// v0.4.8.9 qp1: replaying a Gauntlet run from its start and its choices, the same code in the browser and in the
// server's Node helper. The server pays only what the replay earned.
//
// THE CHOICE VOCABULARY: every engine call that changes a run's state, as a JSON tuple. A run's log is the ordered
// list of the calls that succeeded (a refused call changes nothing and isn't logged):
//   ['node', nodeId]                     enterNode(run, nodeId)          nodeId: a string like '1-4-2'
//   ['play', handIndex, target]          playCard(run, handIndex, target) target: an opponent index (0 when one)
//   ['end']                              endTurn(run)
//   ['reward', card, ability]            takeReward(run, { card, ability }) card: index | null; ability: true | false | index
//   ['cooler', action, card]             cooler(run, action, card)       action: heal | upgrade | remove | icebath | skip;
//                                                                         card: deck index | null
//   ['shopBuy', kind, index]             shopBuy(run, kind, index)       kind: 'card' | 'ability'
//   ['shopRemove', card]                 shopRemove(run, card)           card: deck index
//   ['leave']                            leaveNode(run)                  (leaving a Shop; entering the next node also does)
//   ['event', choice]                    eventChoose(run, choice)        choice: the event choice index
// matchOver(run) isn't a choice: it only settles a finished match and is applied the moment one ends (it's idempotent;
// the UI may call it any time). The views (handView, shopView, ...) change nothing.
//
// The run's start is { seed, player, world, unlocks }, exactly as passed to newRun: the seed (1 to 2^32-1), the player
// (a starter from rollStarters(seed), or a converted player from rollConverted(seed, profile entry)), the stored
// nemesis world (its aiSeed is the account's AI world seed) and the unlocks. newRun's `ai` and `now` are cosmetic
// (names and looks) and aren't part of the start: compare runs with outcomeHash, which leaves the cosmetics out.
//
// The UI logs through act(run, log, kind, ...args): it makes the call and logs it only if it succeeded.
// Called by: index.js: ui/gauntlet.js logs through act(); server/verify/gauntlet_replay.mjs runs replay().
import { newRun, rollStarters, rollConverted, availableNodes, enterNode, matchOver, takeReward, cooler, coolerView, shopBuy, shopRemove, leaveNode, eventChoose, runOver } from './run.js';
import { playCard, endTurn, canPlay } from './combat.js';
import { normWorld } from './nemesis.js';
import { stateHash, outcomeHash } from './rng.js';
import { known } from './cards.js';
import { ABILITIES } from './abilities.js';

export const CHOICE_KINDS = ['node', 'play', 'end', 'reward', 'cooler', 'shopBuy', 'shopRemove', 'leave', 'event'];
export const MAX_CHOICES = 20000; // (a completed run is ~1,500-2,500 choices)
const COOLER_ACTIONS = ['heal', 'upgrade', 'remove', 'icebath', 'skip'];
const isIdx = (x, n = 1e6) => Number.isInteger(x) && x >= 0 && x < n;
const isOptIdx = x => x == null || isIdx(x);

// the shape of one choice: null when it's fine, else why not
export function choiceShapeError(c) {
  if (!Array.isArray(c) || c.length < 1 || c.length > 3) return 'not a choice';
  const [k, a, b] = c;
  if (typeof k !== 'string' || !CHOICE_KINDS.includes(k)) return `unknown choice kind ${JSON.stringify(String(k).slice(0, 20))}`;
  switch (k) {
    case 'node': return typeof a === 'string' && a.length <= 24 && c.length === 2 ? null : 'bad node id';
    case 'play': return isIdx(a) && (b === undefined || isIdx(b)) ? null : 'bad card or target index';
    case 'end': case 'leave': return c.length === 1 ? null : `${k} takes nothing`;
    case 'reward': return isOptIdx(a) && (b === undefined || typeof b === 'boolean' || isIdx(b)) ? null : 'bad reward pick';
    case 'cooler': return COOLER_ACTIONS.includes(a) && isOptIdx(b) ? null : 'bad Cooler action';
    case 'shopBuy': return (a === 'card' || a === 'ability') && isIdx(b) ? null : 'bad Shop item';
    case 'shopRemove': return isIdx(a) && c.length === 2 ? null : 'bad card index';
    case 'event': return isIdx(a) && c.length === 2 ? null : 'bad event choice';
  }
  return 'not a choice';
}
// a validated tuple for the log (throws on a bad shape: that's a bug in the caller, not player input)
export function recordChoice(log, kind, ...args) {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const c = [kind, ...args];
  const err = choiceShapeError(c);
  if (err) throw new Error(`recordChoice: ${err}`);
  log.push(c);
  return log;
}
// a finished match is settled before anything else happens
function settle(run) { if (run.match?.over && !run.match.result) matchOver(run); }

// one choice against a run: { ok, error?, result } (result: what the engine call returned)
export function applyChoice(run, c) {
  const err = choiceShapeError(c);
  if (err) return { ok: false, error: err };
  settle(run);
  if (run.over) return { ok: false, error: 'the run is over' };
  const [k, a, b] = c, m = run.match;
  const fail = error => ({ ok: false, error });
  let result;
  switch (k) {
    case 'node': {
      if (!availableNodes(run).includes(a)) return fail(`node ${a} is not open`);
      result = enterNode(run, a);
      if (!result?.kind) return fail(`node ${a} refused`);
      break;
    }
    case 'play': {
      if (run.stage !== 'match' || !m || m.over) return fail('no match in progress');
      if (a >= m.hand.length) return fail(`card ${a} not in hand`);
      const chk = canPlay(m, a);
      if (!chk.ok) return fail(`card ${a} can't be played: ${chk.why}`);
      const t = b ?? 0;
      if (t >= m.opps.length) return fail(`no opponent ${t}`);
      result = playCard(run, a, t);
      if (result[0]?.type === 'invalid') return fail(result[0].text);
      break;
    }
    case 'end': {
      if (run.stage !== 'match' || !m || m.over) return fail('no match in progress');
      result = endTurn(run);
      break;
    }
    case 'reward': {
      const rw = run.reward;
      if (run.stage !== 'reward' || !rw) return fail('no reward to take');
      if (a != null && a >= rw.cards.length) return fail(`no reward card ${a}`);
      if (typeof b === 'number' && !(rw.abilities && b < rw.abilities.length)) return fail(`no reward ability ${b}`);
      if (b === true && !rw.ability) return fail('no reward ability');
      result = takeReward(run, { card: a ?? null, ability: b ?? false });
      if (!result.ok) return fail('reward refused');
      break;
    }
    case 'cooler': {
      if (run.stage !== 'cooler') return fail('not at a Cooler');
      const opt = coolerView(run).options.find(o => o.id === a);
      if (!opt || !opt.enabled) return fail(`Cooler: ${a} isn't open`);
      if ((a === 'upgrade' || a === 'remove') && !(b != null && b < run.deck.length)) return fail(`Cooler: no card ${b}`);
      result = cooler(run, a, b ?? undefined);
      if (!result.ok) return fail(`Cooler: ${result.text}`);
      break;
    }
    case 'shopBuy': {
      if (run.stage !== 'shop') return fail('not at a Shop');
      result = shopBuy(run, a, b);
      if (!result.ok) return fail(`Shop: ${result.text}`);
      break;
    }
    case 'shopRemove': {
      if (run.stage !== 'shop') return fail('not at a Shop');
      if (a >= run.deck.length) return fail(`Shop: no card ${a}`);
      result = shopRemove(run, a);
      if (!result.ok) return fail(`Shop: ${result.text}`);
      break;
    }
    case 'leave': {
      result = leaveNode(run);
      if (!result) return fail('nothing to leave');
      break;
    }
    case 'event': {
      if (run.stage !== 'event' || !run.event || run.event.done) return fail('no Mystery Stop open');
      result = eventChoose(run, a);
      if (!result || result.invalid) return fail(`event choice ${a} isn't open`);
      break;
    }
  }
  settle(run);
  return { ok: true, result };
}
// make the call and log it if it worked: what the UI uses, so the log is exactly what happened
export function act(run, log, kind, ...args) {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const c = [kind, ...args];
  const r = applyChoice(run, c);
  if (r.ok) log.push(c);
  return r;
}

// the start's player, as the engine would have rolled him: a starter must be rollStarters(seed)'s, a converted
// player is rolled here from his profile entry (or checked against his base); anything else only with strictPlayer off
function canonicalPlayer(seed, p, strict) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || p.id.length > 64) return { error: 'bad player' };
  const s = p.stats && typeof p.stats === 'object' ? p.stats : {};
  const sm = /^starter-(\d+)-([0-2])$/.exec(p.id);
  if (sm) {
    if (Number(sm[1]) !== seed) return { error: 'a starter from another seed' };
    const c = rollStarters(seed)[+sm[2]];
    if (p.stats && Object.keys(c.stats).some(k => s[k] !== c.stats[k])) return { error: 'starter stats don\'t match the roll' };
    return { player: c };
  }
  if (p.converted) {
    const rolled = rollConverted(seed, { id: p.id, name: String(p.name || '').slice(0, 40), converted: true, ...(p.base ? { base: p.base } : { stats: s }), build: p.build || p.look || null, icon: p.icon });
    if (p.base && p.stats && Object.keys(rolled.stats).some(k => s[k] !== rolled.stats[k])) return { error: 'converted stats don\'t match the roll' };
    return { player: rolled };
  }
  if (strict) return { error: 'unknown player' };
  return { player: { id: p.id, name: String(p.name || 'You').slice(0, 40), converted: false, stats: Object.fromEntries(['stamina', 'shooting', 'defense', 'health'].map(k => [k, Math.max(1, Math.min(10, Math.round(+s[k] || 3)))])) } };
}
function cleanUnlocks(u) {
  if (!u || typeof u !== 'object') return null;
  const out = {};
  if (typeof u.startAbility === 'string' && ABILITIES[u.startAbility]) out.startAbility = u.startAbility;
  if (Array.isArray(u.cards)) out.cards = u.cards.slice(0, 10).filter(r => typeof r === 'string' && r.length <= 40 && known(r));
  return Object.keys(out).length ? out : null;
}
// the counts a run has earned so far (also for a run that never ended)
export function runCounts(run) {
  const L = run.log;
  return { matchesWon: L.matchesWon, rivals: L.rivals, bosses: L.bosses, final: L.final, turns: L.turns, cardsPlayed: L.cardsPlayed, nonMatchNodes: L.nonMatch, phase: run.phase, completed: !!run.over?.completed, over: !!run.over };
}

// replay(start, choices, opts) -> { ok, run, over, counts, hash, fullHash, steps, error?, at? }
//   hash: outcomeHash(run) (no cosmetics: the one client and server compare); fullHash: stateHash(run)
//   at: the index of the first refused choice (-1: the start itself)
//   opts: { ai, now } (cosmetic), maxChoices (≤ 50,000; default 20,000), strictPlayer (default true)
export function replay(start, choices, opts = {}) {
  const maxChoices = Math.max(0, Math.min(50000, Number.isInteger(opts.maxChoices) ? opts.maxChoices : MAX_CHOICES));
  let run = null, at = -1, steps = 0;
  const out = (ok, error) => {
    let over = null, counts = null, hash = null, fullHash = null;
    try { if (run) { settle(run); over = runOver(run); counts = runCounts(run); hash = outcomeHash(run); fullHash = stateHash(run); } } catch { /* (a broken run still reports) */ }
    return { ok, run, over, counts, hash, fullHash, steps, ...(ok ? {} : { error, at }) };
  };
  try {
    if (!start || typeof start !== 'object') return out(false, 'no start');
    const seed = start.seed;
    if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) return out(false, 'bad seed');
    const pc = canonicalPlayer(seed, start.player, opts.strictPlayer !== false);
    if (pc.error) return out(false, pc.error);
    const world = normWorld(start.world && typeof start.world === 'object' ? start.world : null);
    run = newRun({ seed, player: pc.player, world, unlocks: cleanUnlocks(start.unlocks), ai: opts.ai || null, now: opts.now });
    if (!Array.isArray(choices)) return out(false, 'choices is not a list');
    if (choices.length > maxChoices) { at = maxChoices; return out(false, `too many choices (${choices.length} > ${maxChoices})`); }
    for (at = 0; at < choices.length; at++) {
      steps++;
      const r = applyChoice(run, choices[at]);
      if (!r.ok) return out(false, r.error);
    }
    at = choices.length;
    return out(true);
  } catch (e) {
    return out(false, 'engine error: ' + String(e?.message || e).slice(0, 200));
  }
}
