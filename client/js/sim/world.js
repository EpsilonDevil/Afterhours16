// v0.4.4 persistent AI world. Every account has its own population of AI hoopers, generated from a seed the
// server keeps (so the same people are there every time you load in): same name, build, height, badges,
// rep, animations and fit, same home park, same habits. Each one keeps a schedule (morning runs, lunch
// breaks, after school, evenings, night owls, weekend warriors, grinders), so who is online — and who is
// at your park — changes through the day. Skill comes in clear tiers, from casuals to park legends, and the
// tier drives attributes, badges, rep, gear and basketball IQ together.
import { RNG, hashString } from '../core/rng.js';
import { makeBot, wearUnlocked, BADGE_POOL } from './bots.js';
import { ICON_FOR_ARCH } from './badges.js';
import { capBadges, badgeCaps, caps, overall, iconNeed, buildFit, legendRaise, iconStatus, BADGE_IDS, OVR_CAP, BASE_OVR_CAP, PRORUN_GAMES_PER_OVR,
  CAP_BREAKERS_PER_HOF, CAP_BREAKER_HOF_LIMIT, LEGEND_GAMES_PER_OVR } from './builds.js';
import { squadWindowAt, nextSquadWindow, pickTrio, squadOutfit, setSquadClock, FIT_SLOTS } from './iconsquad.js';

export const POOL_SIZE = 900;
export const PARKS = ['harbor', 'brick', 'foundry'];
const REP_TIERS = ['Rookie', 'Pro', 'All-Star', 'Superstar', 'Legend'];
export const repLabel = lvl => (lvl >= 20 ? 'Legend' : `${REP_TIERS[Math.floor(lvl / 5)]} ${lvl % 5 + 1}`);

// skill tiers: share of the population, level range (drives attributes, badges, gear) and IQ range
export const SKILL_TIERS = [
  { id: 'casual', label: 'Casual', share: 0.2, lo: 0.04, hi: 0.3, iq: [0.1, 0.38], rep: [0, 4] },
  { id: 'regular', label: 'Regular', share: 0.33, lo: 0.3, hi: 0.55, iq: [0.3, 0.58], rep: [2, 8] },
  { id: 'hooper', label: 'Hooper', share: 0.26, lo: 0.55, hi: 0.75, iq: [0.48, 0.76], rep: [6, 12] },
  { id: 'elite', label: 'Elite', share: 0.16, lo: 0.75, hi: 0.9, iq: [0.66, 0.9], rep: [10, 17] },
  { id: 'legend', label: 'Park Legend', share: 0.05, lo: 0.9, hi: 1.0, iq: [0.84, 1.0], rep: [16, 20] },
];
// habits: when they usually play (local hours; sessions can run past midnight)
export const HABITS = [
  { id: 'morning', label: 'Morning runs', share: 0.08, start: [6, 8.5], len: [2, 3.5], days: 0.72 },
  { id: 'lunch', label: 'Lunch break', share: 0.08, start: [11, 13], len: [1.2, 2.5], days: 0.7, weekdays: true },
  { id: 'after_school', label: 'After school', share: 0.17, start: [14.5, 16.5], len: [3, 5], days: 0.8 },
  { id: 'evening', label: 'Evenings', share: 0.25, start: [17.5, 20], len: [3, 5.5], days: 0.8 },
  { id: 'night_owl', label: 'Night owl', share: 0.2, start: [20.5, 23.5], len: [4, 7], days: 0.78 },
  { id: 'weekend', label: 'Weekend warrior', share: 0.1, start: [10, 14], len: [5, 9], days: 0.92, weekends: true },
  { id: 'grinder', label: 'Grinder', share: 0.12, start: [9, 15], len: [8, 13], days: 0.88 },
];
const DAY = 86400000;
// v0.4.8.5 qp7: the persistent world keeps grinding, and the AI unlock exclusives the way you do.
//  * Career games: the ones this world has seen him play (prog g) plus the ones he plays when you're not around, about
//    perDay a day he's on (his habit's activity × how often he plays). (qp7's Icon badge by career games alone is now the
//    7th Hall of Fame badge of the qp8 climb below)
//  * The Daily Spin: every day he plays he may spin (habit: how keen he is on it, 0.25-0.85 × how often he's on), with the
//    wheel's own odds (server/progression.py WHEEL_ODDS: gear 12, animations 9.8 of 100, VC the rest), an item he
//    doesn't have yet of that kind each time it lands on one.
export const ICON_GRIND = { perDay: 3 };
export const AI_WHEEL = { gear: 12, anim: 9.8, habit: [0.25, 0.85] };
// v0.4.8.5 qp8: past 90 to 99, by your own rules (sim/builds.js maxOvr, caps with the cap breakers and the legend floor,
// legendRaise, badgeCaps, iconNeed, iconStatus: the same functions your build goes through). His potential (his level plus
// all the growth his tier allows) says how far his play can take him: the whole way (icon) or at most a few Hall of Fame
// badges (hof). One who can climb at all gets to a full 90 max OVR (every attribute at its cap, 30 Pro Run games in) after
// his own number of career games (full90: [from, spread] per tier, stable per AI), then earns Hall of Fame badges as he
// grinds (the n-th takes perHof × ramp[n] games: the first ones come quickly, the 6th and 7th take longest), the rest of
// a full badge set filling out alongside. The first five bring 5 cap breakers each (he puts them one apiece on his five
// best-fit attributes), the 7th his Icon badge, and from then on every 2 of his Pro Run games (proRun: the share of his
// games that are) are a Legend +1 OVR, to 99. At 99, every badge done and every cap breaker in, iconStatus says ICON,
// exactly as it would for you, and nowhere else.
//  * Rarity (seeds 4242 / 777 / 31337, checked every 15 days to two years): fewer above 90 than at 90 and under, fewer
//    at 96-99 than at 91-95, at every age. ICONs 6-9 at two months, 43-45 at six, 76-87 at a year, 127-133 at two years
//    (then it levels off at ~130: the Legends and the Elites with the potential for it). The other Elites and the better
//    Hoopers stop at 3-5 HOFs, 91-93 with their cap breakers in, which keeps the 91-95 band the bigger one for good.
export const AI_LADDER = {
  icon: 0.92, // potential for the whole climb (the 7th HOF, the Icon badge, Legend to 99)
  hof: [[0.76, 5], [0.7, 3], [0.66, 1]], // below that: potential at least → most HOF badges (below the last: never past 90)
  full90: { legend: [8, 40], elite: [60, 280], hooper: [110, 450] },
  perHof: { legend: [13, 20], elite: [60, 90], hooper: [40, 60] },
  ramp: [0, 0.5, 0.6, 0.7, 0.9, 1.1, 1.5, 1.9], // (the n-th HOF takes perHof × ramp[n] games)
  proRun: 0.3,
};
const activityOf = a => (a.habit.id === 'grinder' ? 1.6 : a.habit.id === 'weekend' || a.habit.id === 'lunch' ? 0.6 : 1);
const NONE = Object.freeze([]);

const shareOf = (list, x) => { let a = 0; for (const t of list) { a += t.share; if (x < a) return t; } return list[list.length - 1]; };
const fmtHour = h => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.round((h - hh) * 4) * 15; const H = hh % 12 || 12; return `${H}${mm ? ':' + String(mm % 60).padStart(2, '0') : ''} ${hh < 12 ? 'AM' : 'PM'}`; };
const fmtClock = t => { const d = new Date(t), h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
// local midnight-based day number (so schedules follow the player's clock)
const dayIndex = t => { const d = new Date(t); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / DAY); };
const localHour = t => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

// v0.4.8.5 qp8: his badges on the climb, a set like yours: his Hall of Fame badges (h of them: his own first, best first,
// then his archetype's, then the rest his build can take to Hall of Fame) and, filling out as h goes up, every other
// badge toward Gold (or its cap, if that's lower), never below what he already had. At h = target (his Icon badge) every
// badge is done: what ICON status asks of the badges
export function climbBadges(b, start, h, target) {
  const cap = badgeCaps(b), base = capBadges(start || {}, b), arch = b.archetype || 'two_way';
  const order = [...new Set([...Object.keys(base).filter(k => base[k] >= 4), ...Object.keys(base).filter(k => cap[k] >= 4).sort((x, y) => base[y] - base[x]),
    ...(BADGE_POOL[arch] || []).filter(k => cap[k] >= 4), ...BADGE_IDS.filter(k => cap[k] >= 4)])];
  const hof = new Set(order.slice(0, h)), q = target > 0 ? Math.min(1, h / target) : 1, out = {};
  for (const k of BADGE_IDS) {
    const fill = Math.floor(q * Math.min(cap[k], 3) + 1e-9), tier = hof.has(k) ? 4 : Math.min(cap[k], Math.max(base[k] || 0, fill));
    if (tier > 0) out[k] = tier;
  }
  return out;
}
// v0.4.8.5 qp8: his build at his place on the climb (AIWorld.ladder), the way yours gets there: his Pro Run games (a full 90
// max OVR: maxOvr), every attribute at its cap (caps), 5 cap breakers for each of his first five Hall of Fame badges, put one
// apiece on his five best-fit attributes (buildFit; a cap breaker only goes on an attribute at its cap, below 99, as
// yours), the Icon badge with the 7th, then a Legend +1 OVR (legendRaise) for every 2 Pro Run games since. Sets the same
// fields your build has (progression.prorun_completed, cap_breakers, legend, badges, icon_badge, overall), so
// iconStatus(build) decides ICON for him exactly as it does for you
export function climb(bot, L) {
  const b = bot.build;
  b.progression = { prorun_completed: L.pr };
  const tiers = climbBadges(b, L.frame.badges, L.h, L.target);
  const n = CAP_BREAKERS_PER_HOF * Math.min(CAP_BREAKER_HOF_LIMIT, L.h), top = caps(b), fit = buildFit(b), applied = {};
  for (let left = n; left > 0;) {
    let round = Math.min(CAP_BREAKERS_PER_HOF, left);
    const before = left;
    for (const k of fit) { if (!round) break; if (top[k] + (applied[k] || 0) < 99) { applied[k] = (applied[k] || 0) + 1; round--; left--; } }
    if (left === before) break; // (everything at 99)
  }
  b.cap_breakers = { earned: n, available: n - Object.values(applied).reduce((s, v) => s + v, 0), applied };
  b.legend = { games: L.legendGames, upgrades: 0, floor: {} };
  b.attributes = caps(b);
  for (let ups = Math.floor(L.legendGames / LEGEND_GAMES_PER_OVR); ups > 0 && legendRaise(b); ups--) b.legend.upgrades++;
  b.overall = overall(b.attributes, b.position);
  if (L.icon) b.icon_badge = ICON_FOR_ARCH[b.archetype] || 'the_general';
  bot.badges = tiers;
  b.badges = Object.fromEntries(Object.entries(tiers).map(([k, t]) => [k, { tier: t, progress: L.frame.use?.[k] || 0 }]));
  // (how strong he rates as a teammate or an opponent, sim/ranks.js levelRating: past 1 with every point past 90)
  bot.level = Math.max(bot.level || 0, 1 + (b.overall - OVR_CAP) * 0.0037);
  return bot;
}

export class AIWorld {
  constructor(data, catalog) {
    data = data || {};
    this.seed = data.seed || ((Math.random() * 2147483646) | 0) + 1;
    this.born = data.born || Date.now();
    this.friends = [...(data.friends || [])];
    this.squad = (data.squad || []).filter(id => this.friends.includes(id));
    this.met = { ...(data.met || {}) };
    // v0.4.7.5: every AI hooper's games (g) and wins (w) since this world began: they get better as they play
    this.prog = { ...(data.prog || {}) };
    // v0.4.7.5: your squad from the last time you played (it breaks up when you close the game; the ones who choose
    // to keep running together stay a group at the park for a few hours)
    this.exSquad = data.exSquad && Array.isArray(data.exSquad.ids) ? { ids: data.exSquad.ids.slice(0, 4), at: +data.exSquad.at || 0 } : null;
    this.catalog = catalog || {};
    this.cache = new Map(); // id → account (cheap header)
    this.full = new Map(); // id → generated entry (build, look)
    this.dirty = !data.seed;
    this.listeners = new Set();
    this.extra = new Map(); // id → {park, until}: regulars who hopped on early to keep a quiet park playable
    // v0.4.8.5 qp7: what they've unlocked. wheel: id → his Daily Spins so far ({day: the next UTC day to spin, spins,
    // owned}); prizes: id → the event prizes he's won (the server's word, setUnlocks), unlockVer: bumped when they change
    // (every entry is built again)
    this.frames = new Map(); // (qp8: id → his build at his potential, what his climb past 90 starts from)
    this.wheel = new Map();
    this.prizes = {};
    this.unlockVer = 0; this.unlockSig = '{}'; this.unlockThrough = null; this.unlockAsked = 0; this.unlockOk = false;
    this.squads = new Map(); // (v0.4.8.6: window k → its ICON Squad, or null: none that time)
    this.preparing = null; this.squadAsync = typeof window !== 'undefined' && typeof setTimeout === 'function';
  }

  toJSON() { return { seed: this.seed, born: this.born, friends: this.friends, squad: this.squad, met: this.met, prog: this.prog, ...(this.exSquad ? { exSquad: this.exSquad } : {}) }; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { this.dirty = true; for (const fn of this.listeners) fn(this); }

  ids() { const out = []; for (let i = 0; i < POOL_SIZE; i++) out.push('ai-' + i); return out; }
  rng(id, salt = '') { return new RNG(hashString(id + '|' + salt) ^ this.seed); }

  // cheap header: tier, habit, home park, rep, iq (no build yet)
  account(id) {
    let a = this.cache.get(id);
    if (a) return a;
    const r = this.rng(id, 'acct');
    const tier = shareOf(SKILL_TIERS, r.next());
    const habit = shareOf(HABITS, r.next());
    const position = ['PG', 'SG', 'SF', 'PF', 'C'][r.int(0, 4)];
    const level = r.range(tier.lo, tier.hi);
    const iq = Math.max(0, Math.min(1, r.range(tier.iq[0], tier.iq[1])));
    const home = r.next() < 0.14 ? null : PARKS[r.int(0, PARKS.length - 1)];
    // rep grows slowly the longer this world has existed (they keep playing when you're not around)
    const days = Math.max(0, (Date.now() - this.born) / DAY);
    const activity = habit.id === 'grinder' ? 1.6 : habit.id === 'weekend' || habit.id === 'lunch' ? 0.6 : 1;
    const baseRep = r.int(tier.rep[0], tier.rep[1]);
    const rep = Math.min(20, baseRep + Math.min(4, Math.floor(days * activity / r.range(9, 16))));
    const start = r.range(habit.start[0], habit.start[1]), len = r.range(habit.len[0], habit.len[1]);
    a = { id, tier, habit, position, level, iq, home, rep, repLabel: repLabel(rep), start, len, daysP: habit.days * r.range(0.85, 1.05), extra: r.range(0.08, 0.3) };
    this.cache.set(id, a);
    return a;
  }

  // v0.4.7.5: how much better he's got (level, 0..0.12): slowly with every game he plays (in front of you or not:
  // the park's other courts count) and a little with time (he plays when you're not around), up to a bit past his
  // tier's ceiling. About +1 OVR for every dozen games.
  growth(id, t = Date.now()) {
    const a = this.account(id), p = this.prog[id];
    const days = Math.max(0, (t - this.born) / DAY), activity = a.habit.id === 'grinder' ? 1.6 : a.habit.id === 'weekend' || a.habit.id === 'lunch' ? 0.6 : 1;
    const g = Math.min(0.1, (p?.g || 0) * 0.0022 + (p?.w || 0) * 0.0008) + Math.min(0.04, days * activity * 0.0006);
    return Math.max(0, Math.min(0.12, g, Math.min(1, a.tier.hi + 0.08) - a.level));
  }
  // full player: build, gear and look (deterministic), plus the header fields. v0.4.7.5: his attributes, overall and
  // badges grow with growth(); who he is (name, body, gear, look) never changes. v0.4.8.5 qp7: and he wears what he's
  // unlocked (his Icon badge's package, the wheel's items, the events' prizes: bots.js wearUnlocked); with nothing
  // unlocked he is exactly the makeBot hooper he always was. qp8: past 90, his build carries what yours does on the way
  // to 99 (max OVR, cap breakers, the legend floor, a badge set, the Icon badge): climb()
  entry(id, t = Date.now()) {
    const gk = Math.round(this.growth(id, t) * 400);
    const L = this.ladder(id, t), wheel = this.wheelOf(id, t), prizes = this.prizes[id] || NONE, sq = this.squadKnown(id, t); // (only a squad already picked: an entry never sets a pick off)
    const key = `${gk}|${L ? `${L.h}:${L.pr}` : '-'}|${wheel.owned.length}|${this.unlockVer}|${sq ? sq.k : '-'}`;
    let e = this.full.get(id);
    if (e && e.key === key) return e;
    const a = this.account(id);
    const flash = Math.min(1, a.level * 0.6 + a.rep / 40);
    const bot = makeBot(this.rng(id, 'build'), { catalog: this.catalog, position: a.position, level: a.level, rep: a.rep, flash });
    if (gk > 0) {
      const up = makeBot(this.rng(id, 'build'), { catalog: this.catalog, position: a.position, level: Math.min(1, a.level + gk / 400), rep: a.rep, flash });
      bot.build.attributes = up.build.attributes; bot.build.overall = up.build.overall;
      bot.badges = up.badges; bot.badgeUse = up.badgeUse; bot.level = up.level;
    }
    if (L) climb(bot, L);
    const ic = bot.build.icon_badge || null;
    if (ic || wheel.owned.length || prizes.length) wearUnlocked(bot.build, [...wheel.owned, ...prizes], this.catalog, this.rng(id, 'wear'), flash, a.rep);
    // (v0.4.8.6: for his ICON Squad's hour, the squad's outfit: sim/iconsquad.js squadOutfit)
    if (sq) { const eq = bot.build.equipment = { ...bot.build.equipment }; for (const slot of FIT_SLOTS) { if (sq.outfit[slot]) eq[slot] = sq.outfit[slot]; else delete eq[slot]; } }
    e = { ...bot, aiId: id, iq: a.iq, tier: a.tier.id, tierLabel: a.tier.label, rep: { level: a.rep, label: a.repLabel }, home: a.home, habit: a.habit.label, gk, key, games: this.prog[id]?.g || 0 };
    if (ic || wheel.owned.length || prizes.length) e.unlocked = { icon: ic, wheel: wheel.owned.slice(), prizes: [...prizes] };
    if (L) e.climb = { hof: L.h, proRun: L.pr, legend: bot.build.legend.upgrades };
    if (sq) e.iconSquad = sq.k;
    e.build.rep = e.rep;
    this.full.set(id, e);
    return e;
  }

  // ---------- v0.4.8.5 qp7: what they unlock grinding ----------
  // his games since this world began: the ones it has seen (prog g: with you, against you, on the park's other courts)
  // and the ones he plays when you're not around
  careerGames(id, t = Date.now()) {
    const a = this.account(id), days = Math.max(0, (t - this.born) / DAY);
    return (this.prog[id]?.g || 0) + days * activityOf(a) * a.daysP * ICON_GRIND.perDay;
  }
  // a number of his own, stable per AI (a hash of his id with this world's seed)
  hashOf(id, salt) { return (hashString(`${id}|${salt}|`) ^ this.seed) >>> 0; }
  // ---------- v0.4.8.5 qp8: the climb past 90 (AI_LADDER) ----------
  // how good he can get: his level plus all the growth his tier allows (growth()'s ceiling)
  potential(id) { const a = this.account(id); return Math.min(a.level + 0.12, Math.min(1, a.tier.hi + 0.08)); }
  // his build at his potential (body, archetype and the badges his best play earns): where his climb starts. Drawn from his
  // own build seed like every entry, a hair above anything growth() can reach, so nothing he had on the way is lost
  frame(id) {
    let f = this.frames.get(id);
    if (!f) {
      const a = this.account(id);
      const b = makeBot(this.rng(id, 'build'), { catalog: this.catalog, position: a.position, level: Math.min(1, this.potential(id) + 0.0025), rep: a.rep, flash: Math.min(1, a.level * 0.6 + a.rep / 40) });
      f = { archetype: b.build.archetype, height: b.build.height, badges: b.badges, use: b.badgeUse };
      this.frames.set(id, f);
    }
    return f;
  }
  // where he is on the climb by time t: null below a full 90 max OVR, else {h: Hall of Fame badges, target: the HOFs his
  // Icon badge takes (iconNeed), pr: his Pro Run games, icon, legendGames: his Pro Run games since the Icon}. Every part
  // of it only grows with his career games
  ladder(id, t = Date.now()) {
    const a = this.account(id), L = AI_LADDER, r90 = L.full90[a.tier.id], pot = this.potential(id);
    const most = pot >= L.icon ? Infinity : (L.hof.find(([p]) => pot >= p) || [0, -1])[1];
    if (!r90 || most < 0) return null;
    const G = this.careerGames(id, t), g90 = r90[0] + this.hashOf(id, 'full90') % r90[1];
    if (G < g90) return null;
    const f = this.frame(id), target = iconNeed(f), cap = badgeCaps(f);
    const h0 = Object.entries(f.badges).filter(([k, v]) => Math.min(v, cap[k] ?? 4) >= 4).length;
    const ph = L.perHof[a.tier.id], per = ph[0] + this.hashOf(id, 'hof') % ph[1];
    const top = Math.max(h0, Math.min(target, most, pot >= L.icon ? target : target - 1)); // (only the whole climb takes the Icon)
    // (the n-th Hall of Fame badge takes per × ramp[n] games: the first few come quickly, the 6th and 7th take the longest)
    const cost = n => per * (L.ramp[n] ?? 1);
    let h = h0, used = 0;
    while (h < top && used + cost(h + 1) <= G - g90) used += cost(++h);
    const pr0 = PRORUN_GAMES_PER_OVR * (OVR_CAP - BASE_OVR_CAP), pr = pr0 + Math.floor(L.proRun * (G - g90));
    let toIcon = 0; for (let n = h0 + 1; n <= target; n++) toIcon += cost(n);
    const icon = h >= target, prIcon = pr0 + Math.floor(L.proRun * toIcon);
    return { G, g90, per, h0, h, target, pr, icon, legendGames: icon ? Math.max(0, pr - prIcon) : 0, frame: f };
  }
  // has he unlocked his Icon badge (his 7th Hall of Fame badge) by time t? (ICON status is iconStatus(entry.build): 99)
  hasIcon(id, t = Date.now()) { return !!this.ladder(id, t)?.icon; }
  // ---------- v0.4.8.6 quick patch: the ICON Squad (sim/iconsquad.js) ----------
  // the squad on now: {k, park, start, end, ids (guard to big), leader, roles ('handler', 'wing', 'big'), outfit, fit}, or null (no window on,
  // or this world doesn't have three ICONs yet). Chosen once per window, as of its start. In the game the pick runs a
  // slice at a time off the frame (prepareSquad: going through a year-old world's ICONs takes 0.1-0.4 s), started a few
  // minutes early by initWorld's timer, so the squad is ready when its hour begins (if the game opens mid-hour, they
  // show up a second or two after it loads); squadAsync false (Node, the tests) picks at once
  iconSquad(t = Date.now()) {
    const w = squadWindowAt(t);
    if (!w) return null;
    if (this.squads.has(w.k)) return this.squads.get(w.k);
    if (this.squadAsync) { this.prepareSquad(w); return null; }
    this.squads.set(w.k, null); // (while it's being picked: entries built for it are nobody's squad yet)
    this.keepSquad(w.k, this.pickSquad(w));
    return this.squads.get(w.k);
  }
  keepSquad(k, s) { this.squads.set(k, s); while (this.squads.size > 6) this.squads.delete(this.squads.keys().next().value); return s; }
  // pick window w's squad a slice (sliceMs) at a time, yielding to the frame in between. Resolves to the squad (or null)
  prepareSquad(w, sliceMs = 4) {
    if (!w) return Promise.resolve(null);
    if (this.squads.has(w.k) && this.preparing?.k !== w.k) return Promise.resolve(this.squads.get(w.k));
    if (this.preparing?.k === w.k) return this.preparing.p;
    const run = async () => {
      const pause = () => new Promise(r => setTimeout(r, 0)), now = () => (globalThis.performance ? performance.now() : Date.now());
      let t0 = now();
      for (let i = 0; i < POOL_SIZE; i++) {
        const id = 'ai-' + i, a = this.account(id);
        if (AI_LADDER.full90[a.tier.id] && this.potential(id) >= AI_LADDER.icon && this.hasIcon(id, w.start)) this.entry(id, w.start);
        if (now() - t0 > sliceMs) { await pause(); t0 = now(); }
      }
      this.squads.set(w.k, null);
      return this.keepSquad(w.k, this.pickSquad(w)); // (everything it needs is built now: a few ms)
    };
    const p = run().catch(e => { console.warn('ICON Squad not picked', e?.message || e); return this.keepSquad(w.k, null); }).finally(() => { if (this.preparing?.k === w.k) this.preparing = null; });
    this.preparing = { k: w.k, p };
    return p;
  }
  squadOf(id, t = Date.now()) { const s = this.iconSquad(t); return s && s.ids.includes(id) ? s : null; }
  squadKnown(id, t = Date.now()) { const w = squadWindowAt(t), s = w && this.squads.get(w.k); return s && s.ids.includes(id) ? s : null; }
  // this world's ICONs at time t (99 OVR, every badge done, every cap breaker in: iconStatus, as for you), as
  // {id, position, archetype}. Only an AI with the potential for the whole climb can be one (AI_LADDER.icon)
  iconPool(t = Date.now()) {
    const out = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const id = 'ai-' + i, a = this.account(id);
      if (!AI_LADDER.full90[a.tier.id] || this.potential(id) < AI_LADDER.icon || !this.hasIcon(id, t)) continue;
      const e = this.entry(id, t);
      if (iconStatus(e.build)) out.push({ id, position: e.build.position, archetype: e.build.archetype });
    }
    return out;
  }
  pickSquad(w) {
    const t = w.start, trio = pickTrio(this.iconPool(t), w.k);
    if (!trio) return null;
    const order = [trio.leader, ...trio.ids.filter(x => x !== trio.leader)];
    const members = order.map(id => { const e = this.entry(id, t); return { id, build: e.build, owned: [...(e.unlocked?.wheel || []), ...(e.unlocked?.prizes || [])] }; });
    return Object.freeze({ k: w.k, park: w.park, start: w.start, end: w.end, ids: Object.freeze(trio.ids), leader: trio.leader, roles: Object.freeze(trio.roles),
      outfit: Object.freeze(squadOutfit(members, this.catalog, w.k)), fit: trio.fit });
  }
  // the wheel's exclusives of a kind ('gear' or 'anim'), as server/progression.py spin_wheel lists them (sorted ids)
  wheelPool(kind) {
    const k = '_wheel_' + kind;
    if (!this[k]) this[k] = Object.values(this.catalog).filter(i => i.exclusive === 'wheel' && (i.category === 'animation') === (kind === 'anim')).map(i => i.id).sort();
    return this[k];
  }
  // his Daily Spins, every UTC day finished since this world began (spun once, kept: each day only adds to it)
  wheelOf(id, t = Date.now()) {
    const today = Math.floor(t / DAY);
    let s = this.wheel.get(id);
    if (!s) { s = { day: Math.floor(this.born / DAY), spins: 0, owned: [] }; this.wheel.set(id, s); }
    if (s.day >= today) return s;
    const a = this.account(id), [h0, h1] = AI_WHEEL.habit, p = a.daysP * (h0 + (h1 - h0) * this.rng(id, 'spinhabit').next());
    for (let d = s.day; d < today; d++) {
      const r = this.rng(id, 'spin' + d);
      if (r.next() >= p) continue;
      s.spins++;
      const x = r.next() * 100, kind = x < AI_WHEEL.gear ? 'gear' : x < AI_WHEEL.gear + AI_WHEEL.anim ? 'anim' : null;
      if (!kind) continue; // (VC)
      const pool = this.wheelPool(kind).filter(i => !s.owned.includes(i));
      if (pool.length) s.owned.push(pool[Math.floor(r.next() * pool.length)]); // (nothing left of that kind: VC instead)
    }
    s.day = today;
    return s;
  }
  // the event prizes the AI field has won, from the server (GET /api/ai-world/unlocks: {prizes: {id: [items]}, through:
  // the last closed window}). Returns true when they changed (every entry is built again the next time it's asked for)
  setUnlocks(data, t = Date.now()) {
    const raw = data && data.prizes && typeof data.prizes === 'object' ? data.prizes : {}, prizes = {};
    for (const [id, l] of Object.entries(raw)) if (/^ai-\d+$/.test(id) && Array.isArray(l)) prizes[id] = Object.freeze(l.filter(x => typeof x === 'string').slice(0, 64));
    this.unlockThrough = Number.isFinite(data?.through) ? data.through : null;
    this.unlockAsked = this.unlockAsked || t; this.unlockOk = true;
    const sig = JSON.stringify(prizes);
    if (sig === this.unlockSig) return false;
    this.prizes = prizes; this.unlockSig = sig; this.unlockVer++;
    return true;
  }
  // time to ask again: never asked, the last ask failed (a minute on), or an event window has closed since the last
  // closed one the server told us about (a minute between asks, so a PC clock a bit ahead of the server's catches up)
  unlocksDue(t = Date.now()) {
    if (!this.unlockAsked) return true;
    if (t - this.unlockAsked < 60000) return false;
    if (!this.unlockOk) return true;
    return cupWindow(t) - 1 > (this.unlockThrough ?? cupWindow(this.unlockAsked) - 1);
  }
  // v0.4.7.5: a game they played (any court): ids played, winners won
  playedGame(ids, winners = []) {
    const won = new Set(winners);
    for (const id of ids) {
      if (!id || !/^ai-\d+$/.test(id)) continue;
      const p = this.prog[id] || (this.prog[id] = { g: 0, w: 0 });
      p.g = Math.min(99999, p.g + 1); if (won.has(id)) p.w = Math.min(99999, p.w + 1);
    }
    this.changed();
  }
  // v0.4.7.5: old squad mates of yours who chose to keep running together (and are online now)
  aiParty(t = Date.now()) {
    const x = this.exSquad;
    if (!x || t - x.at > 6 * 3600000) return [];
    return x.ids.filter(id => (hashString(id + '|party|' + x.at) % 100) < 60 && this.online(id, t) && !this.squadOf(id, t));
  }
  // v0.4.7.5: closing the game leaves the squad. Called once when the game starts up: last time's squad breaks up.
  leaveSquadOnStart(t = Date.now()) {
    if (!this.squad.length) return false;
    this.exSquad = { ids: this.squad.slice(0, 4), at: t };
    this.squad = [];
    this.changed();
    return true;
  }
  // a fresh copy for a game (rosters get mutated: look, human flag)
  gameEntry(id) { const e = this.entry(id); return { ...e, build: { ...e.build }, badges: { ...e.badges } }; }

  // the session(s) this account plays on a given local day: [{start, end, park}] in absolute ms
  sessions(id, day) {
    const key = id + ':' + day;
    const hit = this.sessCache?.get(key);
    if (hit) return hit;
    if (!this.sessCache || this.sessCache.size > 20000) this.sessCache = new Map();
    const out = this.makeSessions(id, day);
    this.sessCache.set(key, out);
    return out;
  }
  makeSessions(id, day) {
    const a = this.account(id);
    const r = this.rng(id, 'day' + day);
    const out = [];
    const wd = new Date(day * DAY + 12 * 3600000).getUTCDay(); // 0 Sun … 6 Sat
    const weekend = wd === 0 || wd === 6;
    let p = a.daysP;
    if (a.habit.weekdays && weekend) p *= 0.25;
    if (a.habit.weekends && !weekend) p *= 0.18;
    const midnight = new Date(day * DAY); // UTC midnight of that date → convert to local midnight
    const localMid = new Date(midnight.getUTCFullYear(), midnight.getUTCMonth(), midnight.getUTCDate()).getTime();
    const parkFor = () => (a.home && r.next() < 0.8 ? a.home : PARKS[r.int(0, PARKS.length - 1)]);
    if (r.next() < p) {
      const s = a.start + r.range(-0.9, 0.9), l = a.len * r.range(0.65, 1.25);
      out.push({ start: localMid + s * 3600000, end: localMid + (s + l) * 3600000, park: parkFor() });
    } else r.next();
    // the odd extra session at a random time
    if (r.next() < a.extra) {
      const s = r.range(7, 23.5), l = r.range(0.75, 2.5);
      out.push({ start: localMid + s * 3600000, end: localMid + (s + l) * 3600000, park: parkFor() });
    }
    return out;
  }
  // where is this account right now? → {park, until} or null when offline
  status(id, t = Date.now()) {
    // (v0.4.8.6: for his ICON Squad's hour he's at the squad's park, whatever else he'd be doing)
    const sq = this.squadOf(id, t);
    if (sq) return { park: sq.park, until: sq.end, iconSquad: sq.k };
    const x = this.extra.get(id);
    if (x && x.until > t) return x;
    const d = dayIndex(t);
    for (const day of [d, d - 1]) for (const s of this.sessions(id, day)) if (t >= s.start && t < s.end) {
      // v0.4.5: entrants of the running park event (the Cup, the Jungle...) spend about half their online hours there
      // (qp4: the event on at that moment by the server's schedule, so a game left running across a handover sends them
      // to the new park on time; they used to keep going to the one that had just closed, and the new one stood empty)
      const ev = eventVenueAt(t);
      if (ev && cupEntrant(id, cupWindow(t)) && hashString(`${id}|cuphr|${Math.floor(t / 3600000)}`) % 100 < 55) return { park: ev, until: Math.min(s.end, (Math.floor(t / 3600000) + 1) * 3600000, nextEventChange(t) ?? Infinity) };
      return { park: s.park, until: s.end };
    }
    return null;
  }
  online(id, t = Date.now()) { return !!this.status(id, t); }
  // next time he's on (within a week)
  nextOnline(id, t = Date.now()) {
    const d = dayIndex(t);
    let best = null;
    for (let k = 0; k < 8; k++) for (const s of this.sessions(id, d + k)) if (s.start > t && (!best || s.start < best.start)) best = s;
    return best;
  }
  habitText(id) {
    const a = this.account(id);
    const end = a.start + a.len;
    return `${a.habit.label} · usually ${fmtHour(a.start)}–${fmtHour(end)}${a.habit.weekends ? ' (weekends)' : a.habit.weekdays ? ' (weekdays)' : ''}`;
  }
  statusText(id, t = Date.now(), here = null) {
    const s = this.status(id, t);
    if (s) {
      const left = (s.until - t) / 3600000;
      const at = (s.park === here ? 'at this park' : `at ${PARK_NAMES[s.park] || s.park}`) + (s.iconSquad != null ? ' with his ICON squad' : '');
      return { online: true, park: s.park, ...(s.iconSquad != null ? { iconSquad: s.iconSquad } : {}), text: `Online ${at} · on for ${left < 1 ? Math.max(5, Math.round(left * 12) * 5) + ' more min' : 'about ' + Math.round(left) + ' more hr'}` };
    }
    const nx = this.nextOnline(id, t);
    if (!nx) return { online: false, text: 'Offline' };
    const dd = dayIndex(nx.start) - dayIndex(t);
    return { online: false, text: `Offline · back ${dd === 0 ? 'around ' + fmtHour(localHour(nx.start)) : dd === 1 ? 'tomorrow ' + fmtHour(localHour(nx.start)) : 'in ' + dd + ' days'}` };
  }

  // everyone online at a park right now (sorted by id so it is stable)
  onlineAt(park, t = Date.now()) {
    const out = [];
    for (let i = 0; i < POOL_SIZE; i++) { const id = 'ai-' + i, s = this.status(id, t); if (s && s.park === park) out.push(id); }
    return out;
  }
  // how many are online in total (for the phone header)
  onlineCount(t = Date.now()) { let n = 0; for (let i = 0; i < POOL_SIZE; i++) if (this.status('ai-' + i, t)) n++; return n; }
  // accounts that are about to be on (used to top a quiet park up: "just hopped on")
  closestOffline(park, n, t = Date.now(), exclude = new Set()) {
    const cands = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const id = 'ai-' + i;
      if (exclude.has(id) || this.status(id, t)) continue;
      const a = this.account(id);
      // the Cup is topped up from its own entrants; a park from its regulars (and people with no home park)
      if (EVENT_PARKS.has(park) ? !cupEntrant(id, cupWindow(t)) : (a.home && a.home !== park)) continue;
      const nx = this.nextOnline(id, t);
      cands.push([id, nx ? nx.start - t : 1e12]);
    }
    return cands.sort((x, y) => x[1] - y[1]).slice(0, n).map(c => c[0]);
  }

  // best account for a slot (Pro-Am fill-ins, challengers): close to the wanted level, online first, stable
  // for a given key so the same guys tend to come back
  pick({ position = null, level = 0.6, exclude = new Set(), online = true, key = '' } = {}, t = Date.now()) {
    let best = null, bv = Infinity;
    for (let i = 0; i < POOL_SIZE; i++) {
      const id = 'ai-' + i;
      if (exclude.has(id)) continue;
      const a = this.account(id);
      if (position && a.position !== position) continue;
      if (online && this.squadOf(id, t)) continue; // (v0.4.8.6: busy with his ICON Squad)
      let v = Math.abs(a.level - level) * 4 + (hashString(id + '#' + key) % 1000) / 1000 * 0.7;
      if (online && !this.online(id, t)) v += 3;
      if (v < bv) { bv = v; best = id; }
    }
    return best;
  }

  // ---------- social ----------
  isFriend(id) { return this.friends.includes(id); }
  inSquad(id) { return this.squad.includes(id); }
  addFriend(id) { if (!this.isFriend(id) && this.friends.length < 200) { this.friends.push(id); this.changed(); return true; } return false; }
  removeFriend(id) { this.friends = this.friends.filter(x => x !== id); this.squad = this.squad.filter(x => x !== id); this.changed(); }
  // v0.4.5: someone online at a park you're not at is in the middle of a game about 45% of the time (games come
  // in ~6-minute blocks, the same answer for everyone asking during that block)
  playingElsewhere(id, t = Date.now()) {
    if (!this.online(id, t)) return false;
    if (this.squadOf(id, t)) return true; // (v0.4.8.6: his ICON Squad runs the whole hour)
    return (hashString(id + '@' + Math.floor(t / 360000) + '|' + this.seed) % 100) < 45;
  }
  // v0.4.5: you can only pull someone into your squad when he's online and not in a game. `playing` comes from
  // the park you're at (courts and your own game); everyone else uses playingElsewhere.
  invite(id, t = Date.now(), playing = null) {
    if (this.inSquad(id)) return { ok: false, msg: 'Already in your squad.' };
    if (!this.isFriend(id)) return { ok: false, msg: 'Add him as a friend first.' };
    if (this.squad.length >= 4) return { ok: false, msg: 'Your squad is full (4 + you).' };
    if (!this.online(id, t)) return { ok: false, msg: `${this.entry(id).name} is offline.` };
    const sq = this.squadOf(id, t);
    if (sq) return { ok: false, msg: `${this.entry(id).name} is running with his ICON squad at ${PARK_NAMES[sq.park] || sq.park} until ${fmtClock(sq.end)}.` };
    if (playing ?? this.playingElsewhere(id, t)) return { ok: false, msg: `${this.entry(id).name} is in a game right now. Try again when it's over.` };
    this.squad.push(id); this.changed();
    return { ok: true, msg: `${this.entry(id).name} joined your squad.` };
  }
  kick(id) { this.squad = this.squad.filter(x => x !== id); this.changed(); }
  // squad members who are online right now (offline ones drop out of the squad)
  activeSquad(t = Date.now()) {
    const keep = this.squad.filter(id => this.online(id, t) && !this.squadOf(id, t)); // (v0.4.8.6: and not off with his ICON Squad)
    if (keep.length !== this.squad.length) { this.squad = keep; this.changed(); }
    return keep;
  }
  // after a game: who you played with and against
  recordGame(withIds, vsIds, won, t = Date.now()) {
    const bump = (id, k) => { const m = this.met[id] || (this.met[id] = { games: 0, with: 0, vs: 0, wins: 0, last: 0 }); m.games++; m[k]++; if (k === 'with' && won) m.wins++; m.last = t; };
    for (const id of withIds) bump(id, 'with');
    for (const id of vsIds) bump(id, 'vs');
    // (v0.4.7.5: and they get a game better)
    for (const id of [...withIds, ...vsIds]) { const p = this.prog[id] || (this.prog[id] = { g: 0, w: 0 }); p.g++; if (won ? withIds.includes(id) : vsIds.includes(id)) p.w++; }
    const ids = Object.keys(this.met);
    if (ids.length > 400) ids.sort((a, b) => this.met[a].last - this.met[b].last).slice(0, ids.length - 400).forEach(id => delete this.met[id]);
    this.changed();
  }
  recent(n = 40) { return Object.entries(this.met).sort((a, b) => b[1].last - a[1].last).slice(0, n).map(([id, m]) => ({ id, ...m })); }
}

// v0.4.7.5 court bounties: kings on a streak above 6 have a VC bounty on them for whoever breaks the streak (the same
// numbers as server/progression.py bounty_for)
export const BOUNTY_MIN = 7;
export const bountyFor = streak => (streak >= BOUNTY_MIN ? Math.min(15000, 2500 + 750 * (streak - BOUNTY_MIN)) : 0);

export const PARK_NAMES = { harbor: 'Harbor Point', brick: 'Old Brick Yard', foundry: 'Foundry Works', kingtut: 'The King Tut Cup', jungle: 'The Jungle Ballers', beat: 'And The Beat Goes On', monster: 'The Monster Mash', favela: 'The Favelas' };
// v0.4.7.5 qp3: the park events, and which one is on (the server's schedule, set from /api/config `event` by main.js;
// the AI world sends the event's entrants there). null between events: entrants stay in their home parks.
export const EVENT_PARKS = new Set(['kingtut', 'jungle', 'beat', 'monster', 'favela']); // (v0.4.8.7: The Favelas)
export let EVENT_VENUE = 'kingtut';
// v0.4.8.5 quick patch 4: the whole schedule (from /api/config `event_schedule`, refreshed by /api/cup), so the AI world
// follows a handover the moment it happens instead of whatever event was on when the game was started. setEventVenue
// on its own (no schedule) still pins one venue; keepSchedule leaves a known schedule in charge.
let EVENT_SCHEDULE = null, CLOCK_SKEW = 0;
export const setEventVenue = (v, keepSchedule = false) => { EVENT_VENUE = v && EVENT_PARKS.has(v) ? v : null; if (!keepSchedule) EVENT_SCHEDULE = null; };
// rows: [{event, venue, from, until}] in Unix seconds (null = open-ended); serverNow: the server's clock (s), so a PC
// clock that's off by a few minutes still switches when the server does (ignored past 6 hours: a clock that wrong is
// a time-zone mix-up, not drift)
export function setEventSchedule(rows, serverNow = null) {
  if (!Array.isArray(rows)) return false;
  EVENT_SCHEDULE = rows.filter(r => r && typeof r === 'object').map(r => ({
    venue: EVENT_PARKS.has(r.venue) ? r.venue : null, // (an event this copy of the game doesn't know: nobody goes)
    from: Number.isFinite(r.from) ? r.from * 1000 : -Infinity, until: Number.isFinite(r.until) ? r.until * 1000 : Infinity,
  }));
  if (Number.isFinite(serverNow)) { const k = serverNow * 1000 - Date.now(); CLOCK_SKEW = Math.abs(k) < 6 * 3600000 ? k : 0; setSquadClock(CLOCK_SKEW); }
  EVENT_VENUE = eventVenueAt(Date.now());
  return true;
}
// the event park on at time t (local clock), or null when nothing is scheduled
export function eventVenueAt(t = Date.now()) {
  if (!EVENT_SCHEDULE) return EVENT_VENUE;
  const st = t + CLOCK_SKEW;
  for (const r of EVENT_SCHEDULE) if (st >= r.from && st < r.until) return r.venue;
  return null;
}
// the next handover after t (local clock, ms), or null: nothing else is scheduled
export function nextEventChange(t = Date.now()) {
  if (!EVENT_SCHEDULE) return null;
  const st = t + CLOCK_SKEW;
  let best = null;
  for (const r of EVENT_SCHEDULE) for (const b of [r.from, r.until]) if (Number.isFinite(b) && b > st && (best == null || b < best)) best = b;
  return best == null ? null : best - CLOCK_SKEW;
}

// v0.4.5 King Tut Cup windows and entrants — the same rules as server/cup.py (48-hour windows from
// 2026-01-01 00:00 UTC; an AI hooper entered window w when FNV("ai-N|cup|w") % 100 < 22)
export const CUP_EPOCH = 1767225600000, CUP_WINDOW = 48 * 3600000;
export const cupWindow = (t = Date.now()) => Math.floor((t - CUP_EPOCH) / CUP_WINDOW);
export const cupEntrant = (id, w) => hashString(`${id}|cup|${w}`) % 100 < 22;

// app-level helpers: one world per account, saved to the server (debounced) whenever it changes
let squadLeft = false; // (once per launch of the game)
export function initWorld(app) {
  // (v0.4.8.6 qp: after the season reset, an AI world from before it is the old one, whatever got it saved: a new one instead)
  const r = app.config?.season_reset, saved = app.profile?.ai_world;
  const stale = !!(r?.done && saved && !(Number(saved.born) >= (r.at - 3600) * 1000));
  const w = new AIWorld(stale ? null : saved, app.catalog);
  app.ai = w;
  // v0.4.7.5: you left your squad when you closed the game (the AI who want to keep running together still do)
  if (!squadLeft) { squadLeft = true; if (w.leaveSquadOnStart()) app.squadNote = w.exSquad; }
  let timer = 0;
  const save = () => {
    clearTimeout(timer);
    if (app.seasonResetting) return; // (v0.4.8.6 qp: the reset is happening: this page's world is the old one, never saved again)
    timer = setTimeout(async () => {
      try { const r = await app.api.mutate('/api/ai-world', { world: w.toJSON() }); w.dirty = false; if (app.profile) app.profile.ai_world = r.world; } catch (e) { console.warn('AI world not saved', e.message); }
    }, 800);
  };
  w.onChange(save);
  if (w.dirty) save();
  refreshUnlocks(app, w); // (v0.4.8.5 qp7: what the AI field has won in the events; ui/events.js asks again as windows close)
  // (v0.4.8.6: the ICON Squad is picked a few minutes before its hour, off the frame, so it's ready on time)
  const watch = () => {
    if (app.ai !== w) return; // (another account signed in: its own world watches)
    const t = Date.now(), on = squadWindowAt(t), nx = nextSquadWindow(t);
    if (on) w.prepareSquad(on); else if (nx && nx.start - t < 4 * 60000) w.prepareSquad(nx);
    setTimeout(watch, 60000);
  };
  setTimeout(watch, 1500);
  return w;
}
// v0.4.8.5 qp7: the AI world's event prizes, from the server (it alone knows the final standings)
export async function refreshUnlocks(app, w = app?.ai) {
  if (!w || !app?.api) return false;
  w.unlockAsked = Date.now(); w.unlockOk = false;
  try { const r = await app.api.get('/api/ai-world/unlocks'); return app.ai === w ? w.setUnlocks(r) : false; } catch (e) { console.warn('AI unlocks not loaded', e.message); return false; }
}
