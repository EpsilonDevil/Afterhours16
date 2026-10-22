// The Gauntlet's rewards: coins, card and ability rewards, Shop stock and prices (GAUNTLET.md §3, §5, §6), and the
// VC figures of §11 for the run summary (the server makes the real VC call: it checks the run's time and progress
// and caps it).
//
// Balance reasoning:
//  * COINS: you start with 99 and a won match pays ~15 (Rival ~32, boss ~78), so a phase pays ~150-200: one Shop
//    visit buys a card and a removal, or saves toward an ability (~140-260). The genre's economy, which keeps a Shop
//    a real choice instead of a buffet.
//  * CARD ODDS: a normal match offers ~5% rares, a Rival ~13%, a boss only rares; upgraded copies appear from Phase 2
//    (12%) and Phase 3 (25%) so late rewards keep up with an upgraded deck.
//  * REMOVAL: 75 coins, +25 each time (Punch Card: always 50). Thin decks (Tight) cost real money to build.
//  * VC (§11): 140 a won match, 300 a Rival, 900 a phase boss, 2,000 the Final. A completed run wins ~15-17 matches and
//    ~3 Rivals on its path: ~8,000-8,700 before the cap (the smart policy averages ~8,600), so the completion bonus
//    is 0 and the summary caps a run at 8,000, the top of §11's 6,000-8,000. A failed run keeps what it earned
//    (~3,000 for the smart policy's failed runs).
import * as R from './rng.js';
import { POOL, canUpgrade, upgraded } from './cards.js';
import { ABILITY_POOL } from './abilities.js';

export const START_COINS = 99;
export const COINS = { match: [12, 18], rival: [28, 36], boss: [70, 85] };
export const CARD_ODDS = { match: [0.62, 0.33, 0.05], rival: [0.45, 0.42, 0.13], boss: [0, 0, 1] };
export const UPGRADED_CHANCE = [0, 0.12, 0.25, 0.3];
export const PRICES = { common: [45, 55], uncommon: [68, 82], rare: [135, 165], aCommon: [135, 150], aUncommon: [180, 200], aRare: [230, 260], aShop: [160, 175] };
export const REMOVE_BASE = 75, REMOVE_STEP = 25, PUNCH_PRICE = 50, SNEAKER_DEAL = 0.8;
export const VC = { match: 140, rival: 300, boss: 900, final: 2000, completion: 0, cap: 8000 };

const rarityOf = (st, odds) => { const x = R.next(st); return x < odds[0] ? 'common' : x < odds[0] + odds[1] ? 'uncommon' : 'rare'; };
export function rewardCards(st, kind, phase, n = 3) {
  const odds = CARD_ODDS[kind] || CARD_ODDS.match, out = [];
  for (let guard = 0; out.length < n && guard < 60; guard++) {
    const pool = POOL(rarityOf(st, odds));
    let ref = R.pick(st, pool);
    if (out.some(r => r.replace(/\+$/, '') === ref)) continue;
    if (canUpgrade(ref) && R.chance(st, UPGRADED_CHANCE[Math.min(3, phase - 1)] || 0)) ref = upgraded(ref);
    out.push(ref);
  }
  return out;
}
export function rewardCoins(st, kind, phase) { const [a, b] = COINS[kind] || COINS.match; return Math.round(R.int(st, a, b) * (1 + 0.1 * (Math.min(4, phase) - 1))); }
export function randomAbility(st, rarity, owned = []) {
  const pool = ABILITY_POOL(rarity).filter(a => !owned.includes(a));
  return pool.length ? R.pick(st, pool) : null;
}
export function rivalAbility(st, owned) {
  const x = R.next(st), r = x < 0.5 ? 'common' : x < 0.85 ? 'uncommon' : 'rare';
  return randomAbility(st, r, owned) || randomAbility(st, 'common', owned) || randomAbility(st, 'uncommon', owned);
}
export function bossAbilities(st, owned) { return R.sample(st, ABILITY_POOL('boss').filter(a => !owned.includes(a)), 3); }

export function makeShop(st, run, phase) {
  const disc = run.abilities.includes('sneaker_deal') ? SNEAKER_DEAL : 1;
  const price = ([a, b]) => Math.round(R.int(st, a, b) * disc);
  const cards = [];
  for (const r of ['common', 'common', 'uncommon', 'uncommon', 'rare']) {
    let ref; for (let g = 0; g < 20; g++) { ref = R.pick(st, POOL(r)); if (!cards.some(c => c.ref === ref)) break; }
    if (canUpgrade(ref) && R.chance(st, UPGRADED_CHANCE[Math.min(3, phase - 1)] || 0)) ref = upgraded(ref);
    cards.push({ ref, price: price(PRICES[r]), sold: false, rarity: r });
  }
  const sale = R.int(st, 0, cards.length - 1); cards[sale].price = Math.round(cards[sale].price / 2); cards[sale].sale = true;
  const abilities = [];
  for (const [r, pk] of [['common', 'aCommon'], ['uncommon', 'aUncommon'], [R.chance(st, 0.5) ? 'shop' : 'rare', null]]) {
    const id = randomAbility(st, r, [...run.abilities, ...abilities.map(a => a.id)]) || randomAbility(st, 'common', [...run.abilities, ...abilities.map(a => a.id)]);
    if (id) abilities.push({ id, price: price(PRICES[pk || (r === 'shop' ? 'aShop' : 'aRare')]), sold: false });
  }
  return { cards, abilities, removeUsed: false };
}
export function removePrice(run) {
  if (run.abilities.includes('punch_card')) return PUNCH_PRICE;
  const p = REMOVE_BASE + REMOVE_STEP * (run.removals || 0);
  return Math.round(p * (run.abilities.includes('sneaker_deal') ? SNEAKER_DEAL : 1));
}

// the §11 figures for a run's summary (the server checks and caps them)
export function vcFor({ matchesWon = 0, rivals = 0, bosses = 0, final = false, completed = false } = {}) {
  const normal = Math.max(0, matchesWon - rivals - bosses - (final ? 1 : 0));
  const parts = { matches: normal * VC.match, rivals: rivals * VC.rival, bosses: bosses * VC.boss, final: final ? VC.final : 0, completion: completed ? VC.completion : 0 };
  const raw = Object.values(parts).reduce((s, v) => s + v, 0);
  return { ...parts, raw, total: Math.min(VC.cap, raw), cap: VC.cap };
}
