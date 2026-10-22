// Build legality (mirrors server/builds.py — keep the two in sync; tests cross-check them).
import { ATTRS, overall, OVERALL_WEIGHTS } from './ratings.js';

export const POSITIONS = { PG: [67, 79], SG: [70, 80], SF: [75, 82], PF: [77, 84], C: [80, 87] };
export const ARCHETYPES = {
  sharpshooter: { label: 'Sharpshooter', blurb: 'Elite range, quick trigger.' },
  slasher: { label: 'Slasher', blurb: 'Explosive finisher and dunker.' },
  playmaker: { label: 'Playmaker', blurb: 'Handles and passing first.' },
  lockdown: { label: 'Lockdown', blurb: 'Perimeter stopper, pick pocket.' },
  two_way: { label: 'Two-Way', blurb: 'Balanced on both ends.' },
  glass_cleaner: { label: 'Glass Cleaner', blurb: 'Boards, blocks, paint presence.' },
  stretch_big: { label: 'Stretch Big', blurb: 'Big who spaces the floor.' },
  post_scorer: { label: 'Post Scorer', blurb: 'Back-to-basket bully.' },
};
export const ARCH_BONUS = {
  sharpshooter: { three_point: 12, mid_range: 10, free_throw: 8, close_shot: 2, layup: -6, driving_dunk: -10, standing_dunk: -8, post_control: -6, interior_d: -8, block: -8, off_rebound: -6, def_rebound: -6, strength: -4 },
  slasher: { layup: 10, driving_dunk: 14, close_shot: 4, speed: 4, acceleration: 4, vertical: 6, three_point: -12, mid_range: -4, free_throw: -4, pass_accuracy: -4, post_control: -2 },
  playmaker: { ball_handle: 10, pass_accuracy: 12, speed_with_ball: 8, three_point: 2, driving_dunk: -6, block: -8, off_rebound: -6, def_rebound: -6, strength: -6, post_control: -6, interior_d: -6 },
  lockdown: { perimeter_d: 12, steal: 10, speed: 2, acceleration: 3, stamina: 3, three_point: -6, mid_range: -4, ball_handle: -6, pass_accuracy: -4, post_control: -4 },
  two_way: { perimeter_d: 2, steal: 2, mid_range: 2, layup: 2, ball_handle: -2, pass_accuracy: -2, block: -2, post_control: -2 },
  glass_cleaner: { off_rebound: 12, def_rebound: 12, block: 8, interior_d: 8, strength: 6, three_point: -16, mid_range: -10, ball_handle: -10, speed_with_ball: -8, free_throw: -8 },
  stretch_big: { three_point: 12, mid_range: 8, free_throw: 6, post_control: -6, standing_dunk: -8, strength: -6, off_rebound: -8, block: -4 },
  post_scorer: { post_control: 14, close_shot: 10, standing_dunk: 6, strength: 6, three_point: -12, ball_handle: -8, speed: -4, speed_with_ball: -6 },
};
export const ARCH_SCALE = 1.12; // v0.4.3 1.4, v0.4.4 strengths/weaknesses 20% smaller
export const STYLE_TO_ARCH = { outside: 'sharpshooter', balanced: 'two_way', inside: 'slasher' };

// v0.4.5: every build maxes out at exactly 90 OVR before cap breakers (mirrors server/builds.py)
export const OVR_CAP = 90;
// v0.4.7.5: VC takes a new build to 80 OVR; every 3 Pro Run games played raise the max by 1, up to 90 (then cap
// breakers unlock). Mirrors server/builds.py max_ovr.
export const BASE_OVR_CAP = 80;
export const PRORUN_GAMES_PER_OVR = 3;
export const prorunCompleted = c => { const p = c?.progression || {}; return (p.prorun_completed ?? p.prorun?.games ?? 0) | 0; };
export function maxOvr(c = {}) {
  if (c.max_ovr != null) return c.max_ovr; // (the server's word, when the character came from it)
  const done = prorunCompleted(c), earned = BASE_OVR_CAP + Math.floor(done / PRORUN_GAMES_PER_OVR);
  // (qp3, Oct 12: a kept OVR (ovr_floor) climbs from there too, every 3 games since ovr_floor_at: mirrors the server)
  const floor = c.ovr_floor ? (c.ovr_floor | 0) + Math.floor(Math.max(0, done - (c.ovr_floor_at | 0)) / PRORUN_GAMES_PER_OVR) : 0;
  return Math.max(BASE_OVR_CAP, Math.min(OVR_CAP, Math.max(earned, floor)));
}
export const COST_K = 0.65; // v0.4.5: everything costs 35% less
export const HOF_LIMIT = 7;
function baseCaps(b) {
  const big = (b.height - 67) / 20, heavy = (b.weight - 200) / 100, wing = Math.max(-0.8, Math.min(1, (b.wingspan - b.height - 3) / 5));
  const c = {
    close_shot: 80 + big * 8, mid_range: 84 - big * 8, three_point: 84 - big * 14 - wing * 3, free_throw: 84 - big * 6,
    layup: 86 - big * 4 - heavy * 4, driving_dunk: 74 + big * 10 - heavy * 6 + wing * 2, standing_dunk: 55 + big * 35 + heavy * 4, post_control: 60 + big * 25 + heavy * 6,
    ball_handle: 90 - big * 24, speed_with_ball: 90 - big * 22 - heavy * 8, pass_accuracy: 88 - big * 14,
    perimeter_d: 84 - big * 12 + wing * 4, interior_d: 62 + big * 30 + heavy * 4 + wing * 3, steal: 82 - big * 10 + wing * 3, block: 55 + big * 35 + wing * 5,
    off_rebound: 55 + big * 35 + heavy * 3, def_rebound: 58 + big * 35 + heavy * 3,
    speed: 92 - big * 20 - heavy * 10, acceleration: 92 - big * 20 - heavy * 8, vertical: 85 - big * 10 - heavy * 10, strength: 50 + big * 25 + heavy * 25, stamina: 92 - heavy * 5,
  };
  const arch = b.archetype || STYLE_TO_ARCH[b.style] || 'two_way';
  const bonus = ARCH_BONUS[arch] || {};
  const out = {};
  for (const k of ATTRS) out[k] = c[k] + (bonus[k] || 0) * ARCH_SCALE;
  return out;
}
// The caps: the build's base curve scaled by the first step k = 0.5 + i × 0.0025 (i = 0..1199) whose overall reaches
// the goal (else the last step). perf: a binary search over those same steps. Every attribute only rises with k (or
// stays at the 40 floor), overall's weights are all positive and every rounding in it is monotone, so "overall >= goal"
// is false, false, ..., then true from some step on, and the search lands on exactly the step the old scan stopped at
// (about 11 overall() calls instead of up to 1,200: this runs for every hooper made, at every park and AI world load)
const CAP_STEPS = 1200;
const capsAt = (base, i) => {
  const k = 0.5 + i * 0.0025, out = {};
  for (const a of ATTRS) out[a] = Math.max(40, Math.min(99, Math.round(40 + (base[a] - 40) * k)));
  return out;
};
export function caps(b, target = null) {
  const base = baseCaps(b), pos = b.position || 'SF', goal = target ?? maxOvr(b);
  let out = capsAt(base, CAP_STEPS - 1);
  if (overall(out, pos) >= goal) {
    let lo = 0, hi = CAP_STEPS - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (overall(capsAt(base, mid), pos) >= goal) hi = mid; else lo = mid + 1; }
    out = capsAt(base, lo);
  }
  const applied = b.cap_breakers?.applied || {};
  for (const [a, n] of Object.entries(applied)) if (out[a] != null && n > 0) out[a] = Math.min(99, out[a] + n);
  // (v0.4.7.5 quick patch: Icon Legend upgrades raise the caps with the attributes, server/builds.py legend_raise)
  for (const [a, v] of Object.entries(b.legend?.floor || {})) if (out[a] != null && v > 0) out[a] = Math.max(out[a], Math.min(99, v));
  return out;
}
// v0.4.7.5 quick patch, Icon Legend: with the Icon badge, every 2 Pro Run games played to the end are +1 OVR, up to 99,
// placed by the build system (mirrors server/builds.py LEGEND_*)
export const LEGEND_GAMES_PER_OVR = 2;
export const LEGEND_OVR_CAP = 99;
// v0.4.8.5 qp8: the order the build system raises a build's attributes in (server/builds.py legend_raise's `fit`): its
// own shape (the curve its caps come from: what its archetype, size and weight lean on) and what its position's overall
// counts most. (The AI world's hoopers place their cap breakers along it too: sim/world.js)
export function buildFit(b) {
  const base = baseCaps(b), w = OVERALL_WEIGHTS[b.position || 'SF'] || OVERALL_WEIGHTS.SF;
  return ATTRS.map((a, i) => [a, base[a] + 6 * (w[a] ?? 0.45), i]).sort((x, y) => y[1] - x[1] || x[2] - y[2]).map(x => x[0]);
}
// v0.4.8.5 qp8: one Icon Legend upgrade, server/builds.py legend_raise to the letter (tests/test_ai_ladder.py runs the two
// side by side): +1 overall, a point at a time round the top half of buildFit until the overall is up by one (an
// attribute at 99 drops out, the next in line takes its place), the legend floor raised with it so the caps never drop
// below. Changes b (attributes, legend.floor); returns {from, to, changes}, or null at 99. (The AI world's Icons climb to
// 99 with it, the way you do)
export function legendRaise(b) {
  const attrs = { ...(b.attributes || {}) }, pos = b.position || 'SF', cur = overall(attrs, pos);
  if (cur >= LEGEND_OVR_CAP) return null;
  const fit = buildFit(b), cand = {};
  for (const a of ATTRS) cand[a] = attrs[a] ?? 40;
  const target = cur + 1, group = Math.floor(ATTRS.length / 2);
  while (overall(cand, pos) < target) {
    const open = fit.filter(a => cand[a] < 99);
    if (!open.length) break;
    for (const a of open.slice(0, group)) { cand[a]++; if (overall(cand, pos) >= target) break; }
  }
  const changes = {};
  for (const a of ATTRS) if (cand[a] > (attrs[a] ?? 0)) changes[a] = cand[a] - (attrs[a] ?? 0);
  if (!Object.keys(changes).length) return null;
  b.attributes = cand;
  const lg = b.legend || (b.legend = { games: 0, upgrades: 0, floor: {} }), floor = lg.floor || (lg.floor = {});
  for (const a of Object.keys(changes)) floor[a] = Math.max(floor[a] | 0, cand[a]);
  return { from: cur, to: overall(cand, pos), changes };
}
export function startingAttributes(b) {
  const c = caps(b, OVR_CAP), out = {};
  for (const k of ATTRS) out[k] = Math.max(35, Math.round(c[k] * 0.72));
  return out;
}
export function upgradeCost(cur, target) { let s = 0; for (let l = cur; l < target; l++) s += 150 + (l - 40) * 16; return Math.round(s * COST_K); }
export { overall };

// v0.4.7.5 badge restrictions (mirrors server/builds.py BADGE_ARCH_CAPS; tests cross-check them): the highest tier
// each badge can reach on a build. The archetype sets a base cap (4 Hall of Fame, 3 Gold, 2 Silver, 1 Bronze), then
// height opens or closes a few doors: small guards handle and finish better but can't anchor the paint, bigs
// protect the rim and the glass but can't break ankles or bomb from deep.
export const BADGE_IDS = ['deadeye', 'catch_shoot', 'corner_specialist', 'limitless', 'green_machine', 'clutch', 'posterizer', 'contact_finisher',
  'acrobat', 'ankle_breaker', 'dimer', 'handles_for_days', 'pick_pocket', 'interceptor', 'rim_protector', 'chasedown', 'brick_wall', 'rebound_chaser'];
export const BADGE_ARCH_CAPS = {
  sharpshooter: [4, 4, 4, 4, 4, 4, 1, 2, 2, 2, 3, 4, 3, 3, 1, 2, 2, 2],
  slasher: [2, 2, 1, 1, 2, 3, 4, 4, 4, 4, 3, 4, 3, 4, 2, 4, 3, 3],
  playmaker: [3, 3, 2, 3, 3, 4, 1, 3, 4, 4, 4, 4, 4, 4, 1, 2, 1, 1],
  lockdown: [2, 2, 2, 1, 2, 3, 2, 3, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4], // (v0.4.8.7: shooting Silver at best; Rebound Chaser HOF)
  two_way: [4, 4, 3, 2, 3, 4, 3, 4, 3, 3, 3, 3, 4, 4, 3, 4, 4, 3],
  glass_cleaner: [1, 1, 1, 1, 1, 2, 4, 4, 3, 1, 4, 2, 2, 3, 4, 4, 4, 4],
  stretch_big: [4, 4, 4, 3, 4, 4, 2, 3, 1, 1, 3, 2, 2, 3, 4, 3, 3, 4],
  post_scorer: [3, 2, 1, 1, 3, 4, 4, 4, 4, 2, 4, 2, 2, 2, 4, 2, 4, 4],
};
// height bands (inches): small ≤ 6'2", medium 6'3"-6'6", tall 6'7"-6'9", big 6'10"-7'0", giant 7'1"+
export const HEIGHT_BANDS = [['small', 74], ['medium', 78], ['tall', 81], ['big', 84], ['giant', 99]];
export const BAND_LABEL = { small: '6\'2" and under', medium: '6\'3"–6\'6"', tall: '6\'7"–6\'9"', big: '6\'10"–7\'0"', giant: '7\'1" and up' };
export const BADGE_HEIGHT_UP = { small: ['ankle_breaker', 'handles_for_days', 'acrobat', 'pick_pocket'], medium: [], tall: [], big: ['rim_protector', 'rebound_chaser', 'brick_wall'], giant: ['rim_protector', 'rebound_chaser', 'brick_wall', 'posterizer'] };
export const BADGE_HEIGHT_MAX = {
  small: { rim_protector: 2, rebound_chaser: 3, brick_wall: 3, posterizer: 3, chasedown: 3 }, medium: { rim_protector: 3 }, tall: {},
  big: { ankle_breaker: 3, handles_for_days: 3, limitless: 3 }, giant: { ankle_breaker: 2, handles_for_days: 2, limitless: 2, acrobat: 3, pick_pocket: 3 },
};
// v0.4.8.7: a Lockdown's defensive badges get past the height limits (mirrors server/builds.py ARCH_HEIGHT_FREE)
const ALL_BANDS = ['small', 'medium', 'tall', 'big', 'giant'];
export const ARCH_HEIGHT_FREE = { lockdown: { chasedown: ALL_BANDS, brick_wall: ALL_BANDS, rim_protector: ALL_BANDS.slice(1), pick_pocket: ['giant'] } };
export const heightBand = h => (HEIGHT_BANDS.find(([, top]) => (h || 0) <= top) || ['giant'])[0];
// {badge id: highest tier this build can reach}
export function badgeCaps(b = {}) {
  const arch = b.archetype || STYLE_TO_ARCH[b.style] || 'two_way', base = BADGE_ARCH_CAPS[arch] || BADGE_ARCH_CAPS.two_way;
  const band = heightBand(b.height ?? 76), up = BADGE_HEIGHT_UP[band], top = BADGE_HEIGHT_MAX[band], out = {};
  const free = ARCH_HEIGHT_FREE[arch] || {};
  BADGE_IDS.forEach((k, i) => { out[k] = Math.max(1, Math.min(4, base[i] + (up.includes(k) ? 1 : 0), (free[k] || []).includes(band) ? 4 : (top[k] ?? 4))); });
  return out;
}
// what a badge set plays at on a build: every tier clamped to the build's cap
export function capBadges(tiers = {}, b = null) {
  if (!b) return { ...tiers };
  const cap = badgeCaps(b), out = {};
  for (const [k, t] of Object.entries(tiers || {})) { const v = Math.min(t, cap[k] ?? 4); if (v > 0) out[k] = v; }
  return out;
}
export const hofCapacity = b => Object.values(badgeCaps(b)).filter(v => v >= 4).length;
// Hall of Fame badges needed for the Icon badge: the 7th, or every one the build can reach if that's fewer
export const iconNeed = b => Math.max(1, Math.min(HOF_LIMIT, hofCapacity(b)));

// v0.4.8: an Icon badge's secret package (the Sharp Eye jumpshot base and release) is never in the store, and shows in
// the Inventory only for the build that holds that Icon badge (the server only lets that build put it on: app.eligible)
// (v0.4.8.7 qp7: every Icon badge's own item, by its "icon" field, whatever else it's marked: the Hash-Slinging dunk
// package used to show in the store and, locked, in every other build's Inventory. iconItemFor is the rule: the build has
// unlocked that Icon badge (c.icon_badge, which the server sets from its archetype at the unlock: an Oprah item is a
// Playmaker's who has unlocked Oprah). Everyone else doesn't see it at all; it stays in the account's locker for them)
export const iconItemFor = (i, c) => !!c && !!i?.icon && c.icon_badge === i.icon;
// (v0.4.8.8: the Pro-Am rank and season items are won, not bought: never in the store, only in the Inventory once won)
export const inStore = i => !i.secret && !i.icon && i.exclusive !== 'proam';
export const forBuild = (i, c) => (i.icon ? iconItemFor(i, c) : !i.secret);

// v0.4.8.5 quick patch 3: ICON status, the endgame (mirrors server/builds.py icon_status_info). Every cap breaker the
// build can earn unlocked (they open at 90 max OVR, 5 a Hall of Fame badge for the first 5), every badge as high as it
// can go on this build (its cap; the Hall of Fame slots full, the rest at Gold) and 99 OVR. The server's word wins
// when the character came from it (c.icon_status).
export const ICON_STATUS_OVR = 99, CAP_BREAKERS_PER_HOF = 5, CAP_BREAKER_HOF_LIMIT = 5;
export function iconStatusInfo(c = {}) {
  if (c.icon_status_info) return c.icon_status_info;
  const caps = badgeCaps(c), have = c.badges || {};
  const tierOf = k => Math.min(Number(have[k]?.tier ?? have[k] ?? 0) || 0, caps[k]);
  const capacity = hofCapacity(c), hofs = BADGE_IDS.filter(k => tierOf(k) >= 4).length;
  const badgesLeft = BADGE_IDS.filter(k => tierOf(k) < caps[k]).length; // (v0.4.8.7: every badge at its cap, Hall of Fame included: no 7-HOF limit)
  const cbMax = Math.min(CAP_BREAKER_HOF_LIMIT, capacity) * CAP_BREAKERS_PER_HOF, cbEarned = c.cap_breakers_earned ?? c.cap_breakers?.earned ?? 0;
  const cbDone = maxOvr(c) >= OVR_CAP && cbEarned >= cbMax;
  const ovr = c.overall ?? (c.attributes ? overall(c.attributes, c.position || 'SF') : 0);
  return { active: cbDone && badgesLeft === 0 && ovr >= ICON_STATUS_OVR, cap_breakers: cbDone, cap_breakers_earned: cbEarned, cap_breakers_max: cbMax, badges: badgesLeft === 0, badges_left: badgesLeft, ovr, ovr_need: ICON_STATUS_OVR };
}
export const iconStatus = c => !!c && (c.icon_status != null ? !!c.icon_status : iconStatusInfo(c).active);
// v0.4.8.5 qp7: ICON build slots (mirrors server/builds.py build_slots). An account has 4 build slots, +1 for every build
// holding an ICON slot (an ICON now, or one before: icon_slot, the slot is the account's for good), up to 8. The
// server's word (profile.build_slots) wins; this keeps it current between profile loads.
export const BASE_BUILD_SLOTS = 4, MAX_BUILD_SLOTS = 8;
export const holdsIconSlot = c => !!c && (!!c.icon_slot || iconStatus(c));
// (qp8: kept, the slots deleted ICON builds left open for the account: the server's build_slots.kept)
export function buildSlots(chars = [], kept = 0) {
  kept = Math.max(0, kept | 0);
  const icons = chars.filter(holdsIconSlot).length + kept;
  return { unlocked: Math.min(MAX_BUILD_SLOTS, BASE_BUILD_SLOTS + icons), base: BASE_BUILD_SLOTS, max: MAX_BUILD_SLOTS, icons, kept, used: chars.length };
}
// keeps profile.build_slots current after a build comes back from the server (main.js app.replaceChar; a slot is never
// taken back). Returns {slot, max, opened} when the account's slots just went up (a build just became an ICON), else null
export function refreshSlots(profile) {
  const was = profile.build_slots, now = buildSlots(profile.characters || [], was?.kept);
  if (was) now.unlocked = Math.max(now.unlocked, was.unlocked | 0);
  profile.build_slots = now;
  return was && now.unlocked > was.unlocked ? { slot: now.unlocked, max: now.max, opened: now.unlocked - was.unlocked } : null;
}
// why a new build can't be made: the create endpoint's refusal, word for word (server/builds.py build_slot_rule)
export const buildSlotRule = s => {
  const max = s?.max ?? MAX_BUILD_SLOTS;
  return s.unlocked >= max ? `All ${max} build slots are in use (the most an account can have).` : `All ${s.unlocked} build slots are in use. Every ICON build on your account opens one more, up to ${max}.`;
};
// what the game says when slots open (u: the server's build_slot_unlocked, {slot, max, opened})
export const slotOpenedText = u => (u.opened > 1 ? `ICON status: your account opened build slots ${u.slot - u.opened + 1}–${u.slot} of ${u.max}.` : `ICON status: your account opened build slot ${u.slot} of ${u.max}.`);
// the build's own win streak, every mode together (the server keeps it: progression.win_streak)
export const winStreak = c => Math.max(0, (c?.win_streak ?? c?.progression?.win_streak ?? 0) | 0);
// the ICON aura: hidden until a 3-game streak, one step stronger every 3 wins after that, all the way at 12+
export const ICON_AURA_STEP = 3, ICON_AURA_MAX = 4;
export const iconAuraLevel = streak => (streak >= ICON_AURA_STEP ? Math.min(ICON_AURA_MAX, Math.floor(streak / ICON_AURA_STEP)) : 0);
