// v0.4.8.9 The Gauntlet: the engine API (docs/GAUNTLET.md §14). Everything here is pure and seeded: no DOM, no
// Math.random, no clock. Run state is plain JSON (save it, resume it, send its summary to the server).
//
// The §14 surface, plus a few additions the UI can use (all backward-compatible):
//   handView(run)       your hand as shown: cost now, playable, points / Stops it would give, combo lit;
//                       the array also carries .flow (flowView)
//   flowView(run)       the Flow chain this turn: { chain: [tags], wild, flowed, flows, max, need }
//   canUpgrade(ref)     whether a card can be upgraded (at a Cooler)
//   EFFECT_KINDS        the effect kinds eventChoose can return (see run.js eventChoose)
//   replay, act, recordChoice, applyChoice, CHOICE_KINDS: the choice log and its replay (replay.js has the vocabulary)
//   outcomeHash(run)    stateHash without the cosmetics (names, looks, text): client and server compare this one
//   coolerView(run)     the Cooler's options (heal / upgrade / remove / icebath / skip), with what's enabled
//   leaveNode(run)      leave a Shop (entering the next node also leaves it)
//   nodeOf(run, id)     a bracket node: { id, phase, round, kind, x, next, foes, rules, boss }
//   mapView(run)        the bracket for the current phase: rows of nodes, with rule and boss info filled in
//   bossInfo(id), ruleView(id), stateHash(obj), rankName(r), emptyWorld(aiSeed), vcFor(summary)
// newRun also takes { ai, now }: the game's AIWorld (app.ai) so the opponents' names and looks match the park, and
// the time their looks are taken at. Without `ai`, one is built from world.aiSeed.
// takeReward's `ability` may be true (the offered one) or an index into reward.abilities (a boss offers three).
// run.stage says what screen the run is on: 'map' | 'match' | 'reward' | 'cooler' | 'shop' | 'event' | 'over'.
// Events from playCard / endTurn: { t, actor, anim, made, points, stops, text, type, ... } where t is the event's
// offset in ms on the court's timeline for that call (each animated event moves it on by its anim's length), and
// type is one of card, shot, stops, status, heal, energy, draw, flow, combo, power, burn, fatigue, hurt, move,
// wall, rule, ability, ally, betray, phase, down, turn, end, invalid; and since qp4 jump, possession, clash, rebound,
// foul, ft (GAUNTLET.md §14, §15.9).
// A match's opening events (the tip-off, turn 1, an ally lending a card, start-of-match abilities) are in run.match.intro.
// v0.4.8.9 qp4, possessions (GAUNTLET.md §15): ENGINE_VERSION (2; every new run records it as run.engine, and a replay
// start must carry engine: 2), canPlay(run, handIndex) -> { ok, why, cost } (phase-aware), and on run.match: phase
// ('jump' | 'offense' | 'defense'), ball ('you' | 'them'), turnType, turnLabel, foeSet, preview, intro. endTurn's events
// for a possession: card, shot { how }, foul, ft, rebound, clash { o, d, winner }, possession { to, turnType, text }, end.
// eventChoose may return { fight: true }: the Mystery Stop became a match (run.stage 'match'); finish it as any other.
// rollConverted(seed, { id, name, look, base: { stamina, shooting, defense, health } }): base is the build's rating
// for each stat, 0-99 (60 → 6 ... 99 → 10, linear; below 60 → 6) or already on 6-10.
export { ANIMS } from './anims.js';
export { EFFECT_KINDS } from './events.js';
export { newRun, rollStarters, rollConverted, availableNodes, enterNode, matchOver, takeReward, cooler, coolerView, shopView, shopBuy, shopRemove, eventView, eventChoose, runOver, leaveNode, nodeOf } from './run.js';
export { playCard, endTurn, handView, flowView, canPlay } from './combat.js';
export { ENGINE_VERSION } from './run.js';
export { cardInfo, canUpgrade } from './cards.js';
export { abilityInfo } from './abilities.js';
export { worldAfterRun, worldTick, charLine, emptyWorld, rankName } from './nemesis.js';
export { bossInfo } from './bosses.js';
export { ruleView } from './rules.js';
export { stateHash, outcomeHash } from './rng.js';
export { replay, applyChoice, act, recordChoice, choiceShapeError, runCounts, CHOICE_KINDS, MAX_CHOICES } from './replay.js';
export { vcFor } from './rewards.js';
import { nodeOf as _node } from './run.js';
import { ruleView as _rule } from './rules.js';
import { bossInfo as _boss } from './bosses.js';
import { cardDef } from './cards.js';

export function mapView(run, phase = run.phase) {
  const p = run.map.phases[phase - 1];
  if (!p) return null;
  return { phase, rows: p.rows.map(row => row.map(id => {
    const n = _node(run, id);
    return { id, kind: n.kind, round: n.round, x: n.x, next: n.next.slice(), cleared: run.cleared.includes(id), here: run.at === id,
      foes: (n.foes || []).map(f => ({ charId: f.charId, name: f.name, style: f.style, rank: f.rank })), rules: (n.rules || []).map(_rule), boss: n.boss ? _boss(n.boss) : null };
  })) };
}
export const cardName = ref => cardDef(ref)?.name || String(ref);
