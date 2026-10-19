// v0.4.8.6 quick patch: the ICON Squad, the rarest thing in the park. A full squad of three AI 99 OVR ICONs from your own
// AI world shows up at one of the three parks and plays there for an hour: all three in the same outfit, on builds that
// fit together (a ball handler, a wing and a big, three different archetypes). Then it's gone for at least 12 hours.
//  * When: each squad arrives 12 hours plus 10 to 30 minutes (a different amount every time) after the last one arrived,
//    so it never comes sooner than 12 hours and it walks round the clock (about 40 minutes later each day). The series
//    is the same for everyone (the server's clock: setSquadClock), starting Sunday Oct 18 2026, 7 PM Pacific.
//  * Where: Harbor Point, Old Brick Yard or Foundry Works, never the same park twice running. One window at a time and
//    the windows never overlap, so there is only ever one ICON Squad in the three parks. (The park makes sure no other
//    AI team anywhere has three ICONs: MAX_ICONS_PER_AI_TEAM.)
//  * Who: real ICONs of your world (sim/world.js AIWorld.iconSquad: 99 OVR by the same rules as yours, iconStatus). A
//    world with fewer than three skips the window: the AI play by the players' rules, and nobody is made an ICON for it.
//  * The outfit: the leader's clothes, worn by all three (squadOutfit). Only what all three can wear: an exclusive goes
//    on only if every one of them has unlocked it. Each keeps his own name, number, animations and Icon package.
import { hashString, RNG } from '../core/rng.js';
import { iconStatus } from './builds.js';
import { canEquip } from './bots.js';

export const ICON_SQUAD = {
  first: Date.UTC(2026, 9, 19, 2, 0), // (the first squad: Sun Oct 18 2026, 7:00 PM Pacific)
  every: 12 * 3600000, jitter: [10, 30], // (the next one comes every + 10-30 min later: minutes, drawn to the second)
  length: 60 * 60000, size: 3,
  parks: ['harbor', 'brick', 'foundry'],
};
// no AI team but the ICON Squad ever has more than two ICONs (game/park.js takeEntries and formAILine)
export const MAX_ICONS_PER_AI_TEAM = 2;
export const isIconEntry = e => !!e && !!e.build && iconStatus(e.build);

// the server's clock (sim/world.js setEventSchedule passes its skew on), so every copy of the game agrees on the windows
let SKEW = 0;
export const setSquadClock = skew => { SKEW = Number.isFinite(skew) ? skew : 0; };

// the series, grown as far as anyone asks (start in server time, ms)
const SERIES = [];
const hk = k => hashString(`icon-squad|${k}`);
function grow(k) {
  const S = ICON_SQUAD;
  if (!SERIES.length) { const r = new RNG(hk(0)); SERIES.push({ k: 0, start: S.first, park: S.parks[Math.floor(r.next() * S.parks.length)], late: 0 }); }
  while (SERIES.length <= k) {
    const p = SERIES[SERIES.length - 1], n = p.k + 1, r = new RNG(hk(n));
    const lo = S.jitter[0] * 60, span = (S.jitter[1] - S.jitter[0]) * 60, late = (lo + Math.floor(r.next() * (span + 1))) * 1000;
    const others = S.parks.filter(x => x !== p.park);
    SERIES.push({ k: n, start: p.start + S.every + late, park: others[Math.floor(r.next() * others.length)], late });
  }
  return SERIES[k];
}
// window k (0 is the first): {k, start, end, park, late: how far past 12 hours it came (ms)} on the local clock
export function squadWindow(k) {
  if (!(k >= 0)) return null;
  const w = grow(k | 0);
  return { k: w.k, start: w.start - SKEW, end: w.start + ICON_SQUAD.length - SKEW, park: w.park, late: w.late };
}
// the last window to start at or before t (server time), or -1
function lastK(st) {
  if (st < ICON_SQUAD.first) return -1;
  let hi = Math.ceil((st - ICON_SQUAD.first) / (ICON_SQUAD.every + ICON_SQUAD.jitter[0] * 60000)) + 1;
  grow(hi);
  let lo = 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (SERIES[m].start <= st) lo = m; else hi = m - 1; }
  return lo;
}
// the window on at t (local clock), or null
export function squadWindowAt(t = Date.now()) {
  const st = t + SKEW, k = lastK(st);
  if (k < 0 || st >= SERIES[k].start + ICON_SQUAD.length) return null;
  return squadWindow(k);
}
// the next window to start after t
export function nextSquadWindow(t = Date.now()) {
  const st = t + SKEW, k = lastK(st);
  return squadWindow(k + 1);
}

// ---------- who: three ICONs whose builds fit together ----------
const POS_ORDER = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
const roleOf = p => (p === 'PG' ? ['handler'] : p === 'SG' ? ['handler', 'wing'] : p === 'SF' ? ['wing'] : ['big']);
const SKILLS = {
  creation: new Set(['playmaker', 'slasher']), shooting: new Set(['sharpshooter', 'stretch_big']),
  inside: new Set(['slasher', 'post_scorer', 'glass_cleaner']), defense: new Set(['lockdown', 'glass_cleaner', 'two_way']),
};
// how well three builds fit: a handler, a wing and a big (6 points), three different archetypes (2 each pair) and what
// they bring between them (1 each: creation, shooting, inside scoring, defense)
export function trioFit(a, b, c) {
  const m = [a, b, c], P = m.map(x => x.position), A = m.map(x => x.archetype);
  let best = 0;
  for (const r0 of roleOf(P[0])) for (const r1 of roleOf(P[1])) for (const r2 of roleOf(P[2])) best = Math.max(best, new Set([r0, r1, r2]).size);
  let s = best === 3 ? 6 : best === 2 ? 2 : 0;
  s += (A[0] !== A[1]) * 2 + (A[0] !== A[2]) * 2 + (A[1] !== A[2]) * 2;
  for (const set of Object.values(SKILLS)) if (A.some(x => set.has(x))) s += 1;
  return s;
}
// the squad for window k from a pool of ICONs [{id, position, archetype}]: a trio that fits (trioFit FIT_GOOD or more: a
// handler, a wing and a big on three archetypes that bring at least three of the four things between them; else the best
// the pool has), and among those the one window k's draw favours (a number per ICON per window, so it's a different squad
// most times). Returns {ids: handler, wing, big, fit, leader} or null
export const FIT_GOOD = 15;
const KIND = { PG: 0, SG: 1, SF: 2, PF: 3, C: 3 }, KIND_POS = ['PG', 'SG', 'SF', 'C'];
let COVER = null; // (trioFit's role points for every mix of the four kinds of position: 64 entries)
export function pickTrio(pool, k, cap = 120) {
  if (!pool || pool.length < ICON_SQUAD.size) return null;
  if (!COVER) {
    COVER = new Int8Array(64);
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) COVER[a * 16 + b * 4 + c] = trioFit({ position: KIND_POS[a], archetype: 'x' }, { position: KIND_POS[b], archetype: 'x' }, { position: KIND_POS[c], archetype: 'x' });
  }
  const skills = Object.values(SKILLS), arch = new Map();
  const draw = id => new RNG(hashString(`icon-squad|${k}|${id}`)).next(); // (mixed: FNV of ids a digit apart lines up)
  const list = pool.map(p => ({ ...p, d: draw(p.id), kind: KIND[p.position] ?? 2, a: arch.get(p.archetype) ?? arch.set(p.archetype, arch.size).get(p.archetype),
    sk: skills.reduce((m, s, i) => m | (s.has(p.archetype) ? 1 << i : 0), 0) })).sort((x, y) => x.d - y.d).slice(0, cap);
  const bits = m => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  let best = null, bs = -1, bd = Infinity;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) for (let l = j + 1; l < list.length; l++) {
    const x = list[i], y = list[j], z = list[l];
    // (the same sum as trioFit, from the numbers worked out above)
    const s = Math.min(FIT_GOOD, COVER[x.kind * 16 + y.kind * 4 + z.kind] + ((x.a !== y.a) + (x.a !== z.a) + (y.a !== z.a)) * 2 + bits(x.sk | y.sk | z.sk));
    if (s < bs) continue;
    const d = x.d + y.d + z.d;
    if (s > bs || d < bd) { bs = s; bd = d; best = [x, y, z]; }
  }
  // handler, wing, big: by position (an SG with a PG beside him plays the wing)
  best.sort((x, y) => POS_ORDER[x.position] - POS_ORDER[y.position] || (x.d - y.d));
  // (the first guard brings it up; a second guard plays the wing)
  let guard = false;
  const roles = best.map(x => { if (x.position === 'PG' || x.position === 'SG') { const r = guard ? 'wing' : 'handler'; guard = true; return r; } return x.position === 'SF' ? 'wing' : 'big'; });
  return { ids: best.map(x => x.id), roles, fit: trioFit(...best), leader: best.reduce((m, x) => (x.d < m.d ? x : m)).id };
}

// ---------- the outfit ----------
export const FIT_SLOTS = ['top', 'bottom', 'shoes', 'socks', 'headband', 'sleeve', 'wristband', 'leg_sleeve', 'knee_pad', 'chain'];
const NEEDED = new Set(['top', 'bottom', 'shoes']);
// members: [{build, owned: [item ids he's unlocked]}], leader first. Slot by slot: the leader's item if all three can wear
// it (canEquip for each, and an exclusive only when every one of them has it), else the next member's that they all can;
// a slot the leader leaves empty stays empty on all three; a top, shorts or shoes nobody's fits: a store item they all
// can wear (window k's draw). Returns {slot: itemId | null} (null: nothing on that slot)
export function squadOutfit(members, catalog = {}, k = 0) {
  const fits = id => {
    const it = catalog[id];
    if (!it) return false;
    return members.every(m => canEquip(it, m.build.attributes || {}, m.build.overall ?? 0, m.build.rep?.level ?? m.rep ?? 20, m.build.height)
      && (!it.exclusive || (m.owned || []).includes(id)));
  };
  const out = {}, lead = members[0].build.equipment || {};
  for (const slot of FIT_SLOTS) {
    if (!lead[slot] && !NEEDED.has(slot)) { out[slot] = null; continue; }
    let id = [lead[slot], ...members.slice(1).map(m => (m.build.equipment || {})[slot])].find(x => x && fits(x)) || null;
    if (!id && NEEDED.has(slot)) {
      const l = Object.values(catalog).filter(i => i.slot === slot && !i.exclusive && fits(i.id)).map(i => i.id).sort();
      if (l.length) id = l[hashString(`${slot}|icon-fit|${k}`) % l.length];
    }
    out[slot] = id;
  }
  return out;
}
