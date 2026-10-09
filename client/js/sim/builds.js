// Build legality (mirrors server/builds.py — keep the two in sync; tests cross-check them).
import { ATTRS, overall } from './ratings.js';

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
  const earned = BASE_OVR_CAP + Math.floor(prorunCompleted(c) / PRORUN_GAMES_PER_OVR);
  return Math.max(BASE_OVR_CAP, Math.min(OVR_CAP, Math.max(earned, c.ovr_floor | 0)));
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
export function caps(b, target = null) {
  const base = baseCaps(b), pos = b.position || 'SF', goal = target ?? maxOvr(b);
  let out = null;
  for (let i = 0; i < 1200; i++) {
    const k = 0.5 + i * 0.0025;
    out = {};
    for (const a of ATTRS) out[a] = Math.max(40, Math.min(99, Math.round(40 + (base[a] - 40) * k)));
    if (overall(out, pos) >= goal) break;
  }
  const applied = b.cap_breakers?.applied || {};
  for (const [a, n] of Object.entries(applied)) if (out[a] != null && n > 0) out[a] = Math.min(99, out[a] + n);
  return out;
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
  lockdown: [3, 4, 4, 1, 2, 3, 2, 3, 2, 2, 2, 4, 4, 4, 4, 4, 4, 3],
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
export const heightBand = h => (HEIGHT_BANDS.find(([, top]) => (h || 0) <= top) || ['giant'])[0];
// {badge id: highest tier this build can reach}
export function badgeCaps(b = {}) {
  const arch = b.archetype || STYLE_TO_ARCH[b.style] || 'two_way', base = BADGE_ARCH_CAPS[arch] || BADGE_ARCH_CAPS.two_way;
  const band = heightBand(b.height ?? 76), up = BADGE_HEIGHT_UP[band], top = BADGE_HEIGHT_MAX[band], out = {};
  BADGE_IDS.forEach((k, i) => { out[k] = Math.max(1, Math.min(4, base[i] + (up.includes(k) ? 1 : 0), top[k] ?? 4)); });
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
