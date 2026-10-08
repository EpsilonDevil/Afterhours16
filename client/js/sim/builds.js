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
export function caps(b) {
  const base = baseCaps(b), pos = b.position || 'SF';
  let out = null;
  for (let i = 0; i < 1200; i++) {
    const k = 0.5 + i * 0.0025;
    out = {};
    for (const a of ATTRS) out[a] = Math.max(40, Math.min(99, Math.round(40 + (base[a] - 40) * k)));
    if (overall(out, pos) >= OVR_CAP) break;
  }
  const applied = b.cap_breakers?.applied || {};
  for (const [a, n] of Object.entries(applied)) if (out[a] != null && n > 0) out[a] = Math.min(99, out[a] + n);
  return out;
}
export function startingAttributes(b) {
  const c = caps(b), out = {};
  for (const k of ATTRS) out[k] = Math.max(35, Math.round(c[k] * 0.72));
  return out;
}
export function upgradeCost(cur, target) { let s = 0; for (let l = cur; l < target; l++) s += 150 + (l - 40) * 16; return Math.round(s * COST_K); }
export { overall };
