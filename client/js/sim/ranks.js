// v0.4.8.5: Pro-Am ranks, per build: Bronze to Grandmaster by RP (ranked points), no divisions. The same table as
// server/progression.py PROAM_RANKS (tests/v0485proam.test.mjs checks they match). The server alone works out the RP a
// game pays or costs (win or loss, how strong the other team was, how you played); the client tells it how strong
// the other team was (levelRating / teamRating) and shows the result.
export const RANKS = [
  { id: 'bronze', name: 'Bronze', floor: 0, color: '#d08a4e', dark: '#6e3b17' },
  { id: 'silver', name: 'Silver', floor: 400, color: '#dfe5ec', dark: '#6f7b88' },
  { id: 'gold', name: 'Gold', floor: 800, color: '#ffd458', dark: '#a0690a' },
  { id: 'platinum', name: 'Platinum', floor: 1200, color: '#72e8d6', dark: '#16756f' },
  { id: 'diamond', name: 'Diamond', floor: 1600, color: '#7cc4ff', dark: '#1d4fc4' },
  { id: 'master', name: 'Master', floor: 2000, color: '#c792ff', dark: '#5320ab' },
  { id: 'grandmaster', name: 'Grandmaster', floor: 2400, color: '#ff5a48', dark: '#8a1010' },
];
export const RANK_SPAN = 2;          // friends in an online Pro-Am squad play together within 2 ranks
export const RATING_MAX = 3200;      // an opponent rating (sent with the ticket) is 0..3200
export const FORFEIT_RP = 20;        // Forfeit & leave
export const SEED_MAX = 1199;        // a build from before ranks starts between Bronze and Gold

const cleanRP = rp => (Number.isFinite(+rp) && +rp > 0 ? Math.floor(+rp) : 0);
// {tier, id, name, floor, next, rp, pct, toNext, color, dark}: next is the RP the next rank starts at (null at the top)
export function rankOf(rp) {
  rp = cleanRP(rp);
  let tier = 0;
  for (let i = 0; i < RANKS.length; i++) if (rp >= RANKS[i].floor) tier = i;
  const r = RANKS[tier], next = tier + 1 < RANKS.length ? RANKS[tier + 1].floor : null;
  return { tier, id: r.id, name: r.name, floor: r.floor, next, rp, pct: next == null ? 1 : (rp - r.floor) / (next - r.floor), toNext: next == null ? 0 : next - rp, color: r.color, dark: r.dark };
}
export const tierOf = rp => rankOf(rp).tier;
// a build's RP as the server describes it (character.progression.proam.rp)
export const rpOf = c => cleanRP(c?.progression?.proam?.rp);
// a real player's RP in an online entry (online.js myEntry), null when it isn't there
export const entryRP = e => (e && Number.isFinite(+e.proam_rp) ? Math.min(100000, cleanRP(e.proam_rp)) : null);

// The friends rule: every pair of real teammates within RANK_SPAN ranks. members: [{name, rp, you}] (rp null: unknown,
// not checked). null when it's fine, else the widest pair: {hi, lo, apart}
export function rankSpan(members, span = RANK_SPAN) {
  const known = (members || []).filter(m => m && m.rp != null).map(m => ({ ...m, rank: rankOf(m.rp) }));
  if (known.length < 2) return null;
  let hi = known[0], lo = known[0];
  for (const m of known) { if (m.rank.tier > hi.rank.tier) hi = m; if (m.rank.tier < lo.rank.tier) lo = m; }
  const apart = hi.rank.tier - lo.rank.tier;
  return apart > span ? { hi, lo, apart } : null;
}
export const withinSpan = (a, b, span = RANK_SPAN) => Math.abs(tierOf(a) - tierOf(b)) <= span;
const who = m => (m.you ? 'you' : m.name || 'A teammate');
export function spanMessage(bad, span = RANK_SPAN) {
  if (!bad) return '';
  return `Pro-Am squads must be within ${span} ranks: ${who(bad.hi)} (${bad.hi.rank.name}) and ${who(bad.lo)} (${bad.lo.rank.name}) are ${bad.apart} apart.`;
}

// how strong an AI team (or player) is, on the RP scale: its level (0..1, sim/bots.js makeBot) from 0.5 up
export const levelRating = level => Math.round(Math.max(0, Math.min(RATING_MAX, ((+level || 0) - 0.5) * 6000)));
// a roster's rating: the average over its players, real ones by their RP, AI ones by their level (fallback: the team's)
export function teamRating(roster, fallbackLevel = 0.6) {
  const list = (roster || []).filter(Boolean);
  if (!list.length) return levelRating(fallbackLevel);
  const one = e => (e.human && entryRP(e) != null ? Math.min(RATING_MAX, entryRP(e)) : levelRating(e.level ?? fallbackLevel));
  return Math.round(list.reduce((s, e) => s + one(e), 0) / list.length);
}
