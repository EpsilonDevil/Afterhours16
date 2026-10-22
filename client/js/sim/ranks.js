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

// ---------------- v0.4.8.8 The Pro-Am Overhaul: seasons, divisions (docs/PROAM-OVERHAUL.md §2) ----------------
// The same ladder as server/proam.py TIERS / DIVS (tests/v0488proam.test.mjs checks they match). A build's season rank is
// its division (a flat index, 0 = Bronze 1) and RP 0..100 in it, as the server describes it (character.pa). The server
// alone works it out; the game shows it: the rank icon by a player's name, his card, the Pro-Am tab.
export const DIV_TIERS = [['bronze', 'Bronze', 3], ['silver', 'Silver', 5], ['gold', 'Gold', 7], ['platinum', 'Platinum', 7], ['diamond', 'Diamond', 7], ['master', 'Master', 7], ['grandmaster', 'Grandmaster', 7]];
export const DIVS = DIV_TIERS.flatMap(([, , n], t) => Array.from({ length: n }, (_, d) => [t, d]));
export const DIV_TOP = DIVS.length - 1;
export const RP_MAX = 100;
export const PLAYABLE_TOP = DIV_TIERS.slice(0, 4).reduce((s, x) => s + x[2], 0) - 1; // (the last Platinum division: Diamond and up are for later)
// the VC and Rep boost of a tier, in every mode (only the current tier's: never stacked)
export const BOOST = [0, 0.02, 0.04, 0.05, 0.05, 0.05, 0.05];
export const GOLD = 2, PLATINUM = 3;
// {index, tier, tier_id, tier_name, div, divs, label, color, dark}
export function divInfo(i) {
  const k = Math.max(0, Math.min(DIV_TOP, Math.floor(+i || 0)));
  const [t, d] = DIVS[k], [id, name, n] = DIV_TIERS[t];
  return { index: k, tier: t, tier_id: id, tier_name: name, div: d + 1, divs: n, label: `${name} ${d + 1}`, color: RANKS[t].color, dark: RANKS[t].dark };
}
export const divIndex = (tier, div) => DIV_TIERS.slice(0, tier).reduce((s, x) => s + x[2], 0) + Math.max(0, Math.min(DIV_TIERS[tier][2], div) - 1);
// a build's season rank (character.pa from the server), or Bronze 1 at 0 RP for one that has none yet
export function seasonRank(c) {
  const pa = c?.pa;
  const info = divInfo(pa?.index ?? 0);
  const rp = Number.isFinite(+pa?.rp) ? Math.max(0, Math.min(RP_MAX, Math.floor(+pa.rp))) : 0;
  // (best: the highest tier the build has reached, this season or before: what a tier unlocks for good goes by it)
  const best = Number.isFinite(+pa?.best) ? Math.max(info.tier, Math.min(DIV_TIERS.length - 1, Math.floor(+pa.best))) : info.tier;
  return { ...info, rp, record: Array.isArray(pa?.record) ? pa.record : [0, 0], series: Array.isArray(pa?.series) ? pa.series : [0, 0], boost: BOOST[info.tier], best };
}
// series: Bronze first to 2 of 3, Silver 3 of 5, Gold and up 5 of 7
export const seriesShape = i => { const t = divInfo(i).tier; return t === 0 ? [3, 2] : t === 1 ? [5, 3] : [7, 5]; };
// what shows by a player's name: the rank icon from Silver up (Bronze: none)
export const showsIcon = tier => tier >= 1;
// the introduction card's borderplate: Gold with a sheen, Platinum animated (and above it the same, for later)
export const borderplate = tier => (tier >= PLATINUM ? 'platinum' : tier >= GOLD ? 'gold' : null);
// an online entry's Pro-Am line (ui/online.js myEntry: entry.proam): his tier and division, his record and whether he
// shows it over his head (Settings → Pro-Am record: Platinum's, for good once reached: best, game/recordtag.js checks)
export function entryProam(c, showRecord = false) {
  const r = seasonRank(c);
  return { tier: r.tier, div: r.div, record: r.record, showRecord: !!showRecord, best: r.best };
}
// the tier a player's name carries (the rank icon by his name, his card's borderplate: both follow the current tier): a
// real player's online entry says it (entry.proam), else his build's season rank (character.pa); null when nothing says
// (the AI's players)
export function entryRankTier(e) {
  const t = e?.proam && Number.isFinite(+e.proam.tier) ? +e.proam.tier : e?.build?.pa ? seasonRank(e.build).tier : e?.pa ? seasonRank(e).tier : null;
  return t == null ? null : Math.max(0, Math.min(DIV_TIERS.length - 1, Math.floor(t)));
}
// a season banner item (server/proam.py season_catalog: pa_banner_s<n>_<tier>): {season, tier, tier_name, label}
export function bannerInfo(item) {
  if (!item || item.slot !== 'banner') return null;
  const t = Math.max(0, DIV_TIERS.findIndex(x => x[0] === item.tier));
  return { season: item.season | 0, tier: t, tier_name: DIV_TIERS[t][1], label: `S${item.season | 0} · ${DIV_TIERS[t][1]}` };
}
