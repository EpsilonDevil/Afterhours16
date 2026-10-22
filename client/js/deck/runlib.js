// Small run-state primitives the run, the events and the shop share. Pure; they only touch the run object.
import { cardDef, canUpgrade, upgraded, known, baseId } from './cards.js';
import { gainAbility, bumpStat } from './abilities.js';

export function addCard(run, ref) { if (!known(ref)) return false; run.deck.push(ref); return true; }
export function removeCardAt(run, i) { if (i == null || i < 0 || i >= run.deck.length) return null; return run.deck.splice(i, 1)[0]; }
export function upgradeAt(run, i) { const r = run.deck[i]; if (!canUpgrade(r)) return null; run.deck[i] = upgraded(r); return run.deck[i]; }
export function healRun(run, n) { const h = Math.max(0, Math.min(Math.round(n), run.maxHp - run.hp)); run.hp += h; return h; }
// events never knock you out: the worst they do is leave you at 1
export function hurtRun(run, n) { const d = Math.max(0, Math.min(Math.round(n), run.hp - 1)); run.hp -= d; return d; }
export function coinsRun(run, n) { const before = run.coins; run.coins = Math.max(0, run.coins + Math.round(n)); return run.coins - before; }
export function abilityRun(run, id) { return gainAbility(run, id); }
export function statRun(run, stat, n) { return bumpStat(run, stat, n); }
export function maxHpRun(run, n) { run.bonusHp = (run.bonusHp || 0) + n; run.maxHp = Math.max(1, run.maxHp + n); run.hp = Math.max(1, Math.min(run.maxHp, run.hp + Math.max(0, n))); }
// a character's part in the run, for worldAfterRun
export function outcome(run, charId, result, extra = {}) {
  if (!charId) return;
  const c = run.chars[charId] || {};
  run.outcomes.push({ charId, name: c.name || charId, style: c.style, result, phase: run.phase, ...extra });
}
// the card a "remove" or "transform" with no choice takes: Fatigue first, then a starter basic, then the cheapest common
export function worstCardIndex(run) {
  const score = r => { const d = cardDef(r); if (!d) return -1; if (d.type === 'fatigue') return 0; if (d.rarity === 'starter' && (d.id === 'jumper' || d.id === 'closeout')) return d.upgraded ? 3 : 1; if (d.rarity === 'starter') return 4; return { common: 5, uncommon: 7, rare: 9 }[d.rarity] + (d.upgraded ? 1 : 0); };
  let best = -1, bs = Infinity;
  run.deck.forEach((r, i) => { const s = score(r); if (s < bs) { bs = s; best = i; } });
  return best;
}
export function bestCardIndex(run, pred = () => true) {
  const score = r => { const d = cardDef(r); return d ? { rare: 9, uncommon: 7, common: 5, starter: 1, fatigue: -9, special: 0 }[d.rarity] - (d.upgraded ? 1 : 0) : -9; };
  let best = -1, bs = -Infinity;
  run.deck.forEach((r, i) => { if (!pred(r)) return; const s = score(r); if (s > bs) { bs = s; best = i; } });
  return best;
}
export const upgradableIdx = run => run.deck.map((r, i) => [r, i]).filter(([r]) => canUpgrade(r)).map(([, i]) => i);
export const nameOf = ref => cardDef(ref)?.name || baseId(ref);
