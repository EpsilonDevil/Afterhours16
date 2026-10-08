// v0.4.4 persistent AI world. Every account has its own population of AI hoopers, generated from a seed the
// server keeps (so the same people are there every time you load in): same name, build, height, badges,
// rep, animations and fit, same home park, same habits. Each one keeps a schedule (morning runs, lunch
// breaks, after school, evenings, night owls, weekend warriors, grinders), so who is online — and who is
// at your park — changes through the day. Skill comes in clear tiers, from casuals to park legends, and the
// tier drives attributes, badges, rep, gear and basketball IQ together.
import { RNG, hashString } from '../core/rng.js';
import { makeBot } from './bots.js';

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

const shareOf = (list, x) => { let a = 0; for (const t of list) { a += t.share; if (x < a) return t; } return list[list.length - 1]; };
const fmtHour = h => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.round((h - hh) * 4) * 15; const H = hh % 12 || 12; return `${H}${mm ? ':' + String(mm % 60).padStart(2, '0') : ''} ${hh < 12 ? 'AM' : 'PM'}`; };
// local midnight-based day number (so schedules follow the player's clock)
const dayIndex = t => { const d = new Date(t); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / DAY); };
const localHour = t => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

export class AIWorld {
  constructor(data, catalog) {
    data = data || {};
    this.seed = data.seed || ((Math.random() * 2147483646) | 0) + 1;
    this.born = data.born || Date.now();
    this.friends = [...(data.friends || [])];
    this.squad = (data.squad || []).filter(id => this.friends.includes(id));
    this.met = { ...(data.met || {}) };
    this.catalog = catalog || {};
    this.cache = new Map(); // id → account (cheap header)
    this.full = new Map(); // id → generated entry (build, look)
    this.dirty = !data.seed;
    this.listeners = new Set();
    this.extra = new Map(); // id → {park, until}: regulars who hopped on early to keep a quiet park playable
  }

  toJSON() { return { seed: this.seed, born: this.born, friends: this.friends, squad: this.squad, met: this.met }; }
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

  // full player: build, gear and look (deterministic), plus the header fields
  entry(id) {
    let e = this.full.get(id);
    if (e) return e;
    const a = this.account(id);
    const r = this.rng(id, 'build');
    const bot = makeBot(r, { catalog: this.catalog, position: a.position, level: a.level, rep: a.rep, flash: Math.min(1, a.level * 0.6 + a.rep / 40) });
    e = { ...bot, aiId: id, iq: a.iq, tier: a.tier.id, tierLabel: a.tier.label, rep: { level: a.rep, label: a.repLabel }, home: a.home, habit: a.habit.label };
    e.build.rep = e.rep;
    this.full.set(id, e);
    return e;
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
    const x = this.extra.get(id);
    if (x && x.until > t) return x;
    const d = dayIndex(t);
    for (const day of [d, d - 1]) for (const s of this.sessions(id, day)) if (t >= s.start && t < s.end) {
      // v0.4.5: entrants of the running King Tut Cup spend about half their online hours at the Cup
      if (cupEntrant(id, cupWindow(t)) && hashString(`${id}|cuphr|${Math.floor(t / 3600000)}`) % 100 < 55) return { park: 'kingtut', until: Math.min(s.end, (Math.floor(t / 3600000) + 1) * 3600000) };
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
      const at = s.park === here ? 'at this park' : `at ${PARK_NAMES[s.park] || s.park}`;
      return { online: true, park: s.park, text: `Online ${at} · on for ${left < 1 ? Math.max(5, Math.round(left * 12) * 5) + ' more min' : 'about ' + Math.round(left) + ' more hr'}` };
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
      if (park === 'kingtut' ? !cupEntrant(id, cupWindow(t)) : (a.home && a.home !== park)) continue;
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
    return (hashString(id + '@' + Math.floor(t / 360000) + '|' + this.seed) % 100) < 45;
  }
  // v0.4.5: you can only pull someone into your squad when he's online and not in a game. `playing` comes from
  // the park you're at (courts and your own game); everyone else uses playingElsewhere.
  invite(id, t = Date.now(), playing = null) {
    if (this.inSquad(id)) return { ok: false, msg: 'Already in your squad.' };
    if (!this.isFriend(id)) return { ok: false, msg: 'Add him as a friend first.' };
    if (this.squad.length >= 4) return { ok: false, msg: 'Your squad is full (4 + you).' };
    if (!this.online(id, t)) return { ok: false, msg: `${this.entry(id).name} is offline.` };
    if (playing ?? this.playingElsewhere(id, t)) return { ok: false, msg: `${this.entry(id).name} is in a game right now. Try again when it's over.` };
    this.squad.push(id); this.changed();
    return { ok: true, msg: `${this.entry(id).name} joined your squad.` };
  }
  kick(id) { this.squad = this.squad.filter(x => x !== id); this.changed(); }
  // squad members who are online right now (offline ones drop out of the squad)
  activeSquad(t = Date.now()) {
    const keep = this.squad.filter(id => this.online(id, t));
    if (keep.length !== this.squad.length) { this.squad = keep; this.changed(); }
    return keep;
  }
  // after a game: who you played with and against
  recordGame(withIds, vsIds, won, t = Date.now()) {
    const bump = (id, k) => { const m = this.met[id] || (this.met[id] = { games: 0, with: 0, vs: 0, wins: 0, last: 0 }); m.games++; m[k]++; if (k === 'with' && won) m.wins++; m.last = t; };
    for (const id of withIds) bump(id, 'with');
    for (const id of vsIds) bump(id, 'vs');
    const ids = Object.keys(this.met);
    if (ids.length > 400) ids.sort((a, b) => this.met[a].last - this.met[b].last).slice(0, ids.length - 400).forEach(id => delete this.met[id]);
    this.changed();
  }
  recent(n = 40) { return Object.entries(this.met).sort((a, b) => b[1].last - a[1].last).slice(0, n).map(([id, m]) => ({ id, ...m })); }
}

export const PARK_NAMES = { harbor: 'Harbor Point', brick: 'Old Brick Yard', foundry: 'Foundry Works', kingtut: 'The King Tut Cup' };

// v0.4.5 King Tut Cup windows and entrants — the same rules as server/cup.py (48-hour windows from
// 2026-01-01 00:00 UTC; an AI hooper entered window w when FNV("ai-N|cup|w") % 100 < 22)
export const CUP_EPOCH = 1767225600000, CUP_WINDOW = 48 * 3600000;
export const cupWindow = (t = Date.now()) => Math.floor((t - CUP_EPOCH) / CUP_WINDOW);
export const cupEntrant = (id, w) => hashString(`${id}|cup|${w}`) % 100 < 22;

// app-level helpers: one world per account, saved to the server (debounced) whenever it changes
export function initWorld(app) {
  const w = new AIWorld(app.profile?.ai_world, app.catalog);
  app.ai = w;
  let timer = 0;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { const r = await app.api.mutate('/api/ai-world', { world: w.toJSON() }); w.dirty = false; if (app.profile) app.profile.ai_world = r.world; } catch (e) { console.warn('AI world not saved', e.message); }
    }, 800);
  };
  w.onChange(save);
  if (w.dirty) save();
  return w;
}
