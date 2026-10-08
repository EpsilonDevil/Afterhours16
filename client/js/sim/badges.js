// v0.4.5 badge model, shared by every badge check in the sim.
//
// * Tier strength: each tier step is 10% bigger than the one before it, so Hall of Fame is far ahead of
//   Bronze (1.00, 2.10, 3.31, 4.64 instead of 1, 2, 3, 4). Badge code multiplies its per-tier effect by bk().
// * No-badge penalty: a stat tied to badges plays 10% weaker when the player has none of the badges that
//   stat feeds (rk(effective) ≈ 0.9 × rk(rating)). The rating shown in menus doesn't change.
// * Archetype Icon badges (unlocked by a build's 7th Hall of Fame badge) multiply their stats and are allowed
//   past 99 in the sim (the rating curve keeps rising above 99).
// * Takeovers add a temporary boost to a stat group.
export const BADGE_K = [0, 1, 2.1, 3.31, 4.641];
export const bk = (badges, key) => BADGE_K[Math.max(0, Math.min(4, (badges && badges[key]) || 0))];
// a per-tier table [0, b1, b2, b3, b4] with each step 10% bigger than the last (same rule as bk)
export function tierTable(t) { const o = [0]; for (let i = 1; i < t.length; i++) o.push(o[i - 1] + (t[i] - t[i - 1]) * Math.pow(1.1, i - 1)); return o; }
export const TIER_NAMES = ['', 'Bronze', 'Silver', 'Gold', 'Hall of Fame'];

// stat -> the badges that work through it
export const STAT_BADGES = {
  close_shot: ['contact_finisher', 'acrobat', 'deadeye'],
  mid_range: ['deadeye', 'green_machine', 'clutch', 'catch_shoot'],
  three_point: ['catch_shoot', 'corner_specialist', 'limitless', 'deadeye', 'green_machine', 'clutch'],
  free_throw: ['green_machine', 'clutch'],
  layup: ['contact_finisher', 'acrobat'],
  driving_dunk: ['posterizer'],
  standing_dunk: ['posterizer'],
  post_control: ['contact_finisher', 'brick_wall'],
  ball_handle: ['ankle_breaker', 'handles_for_days'],
  speed_with_ball: ['handles_for_days'],
  pass_accuracy: ['dimer'],
  perimeter_d: ['pick_pocket', 'brick_wall'],
  interior_d: ['rim_protector', 'brick_wall'],
  steal: ['pick_pocket', 'interceptor'],
  block: ['rim_protector', 'chasedown'],
  off_rebound: ['rebound_chaser'],
  def_rebound: ['rebound_chaser'],
  strength: ['brick_wall'],
};
export const NO_BADGE_K = 0.9;

// v0.4.5 Archetype Icon badges: one per archetype, unlocked with the build's 7th Hall of Fame badge
export const ICON_BADGES = {
  sharp_eye: { name: 'Sharp Eye', archetype: 'sharpshooter', desc: '5% bigger green window on every shot, everywhere on the court. Unlocks exclusive ultra-flashy shooting animations.', stats: {}, green: 0.05 },
  hash_slinging: { name: 'Hash-Slinging', archetype: 'slasher', desc: '+5% Driving Dunk and Standing Dunk (can pass 99). Unlocks exclusive ultra-flashy dunk animations.', stats: { driving_dunk: 0.05, standing_dunk: 0.05 } },
  oprah: { name: 'Oprah', archetype: 'playmaker', desc: '+5% Ball Handle, Speed with Ball and Pass Accuracy (can pass 99). Unlocks exclusive ultra-flashy passing animations.', stats: { ball_handle: 0.05, speed_with_ball: 0.05, pass_accuracy: 0.05 } },
  the_clamp: { name: 'The Clamp', archetype: 'lockdown', desc: '+5% Perimeter D and Steal (can pass 99). Unlocks steal animations that exist only for this badge.', stats: { perimeter_d: 0.05, steal: 0.05 } },
  the_general: { name: 'The General', archetype: 'two_way', desc: '+2.5% to every attribute (can pass 99). Unlocks an exclusive salute celebration.', all: 0.025, stats: {} },
  big_brother: { name: 'Big Brother', archetype: 'glass_cleaner', desc: '+5% Offensive and Defensive Rebound, Block and Interior D (can pass 99). Unlocks exclusive ultra-flashy block animations.', stats: { off_rebound: 0.05, def_rebound: 0.05, block: 0.05, interior_d: 0.05 } },
  open_arms: { name: 'Open Arms', archetype: 'stretch_big', desc: '+3% to every shooting and defense attribute (can pass 99). Unlocks exclusive ultra-flashy rebound snags.', stats: { close_shot: 0.03, mid_range: 0.03, three_point: 0.03, free_throw: 0.03, perimeter_d: 0.03, interior_d: 0.03, steal: 0.03, block: 0.03 } },
  sexy_red: { name: 'Sexy Red', archetype: 'post_scorer', desc: '+5% Layup, Post Control and Close Shot (can pass 99). Unlocks exclusive post back-down animations.', stats: { layup: 0.05, post_control: 0.05, close_shot: 0.05 } },
};
export const ICON_FOR_ARCH = Object.fromEntries(Object.entries(ICON_BADGES).map(([k, v]) => [v.archetype, k]));

// v0.4.5 takeovers (position-locked): what each one boosts and by how much (rating points)
export const TAKEOVERS = {
  shooting: { label: 'Shooting Takeover', positions: ['PG', 'SG'], stats: ['close_shot', 'mid_range', 'three_point', 'free_throw'], boost: 8, green: 0.12 },
  finishing: { label: 'Finishing Takeover', positions: ['SF', 'PF'], stats: ['layup', 'driving_dunk', 'standing_dunk', 'close_shot', 'post_control'], boost: 8 },
  glass: { label: 'Glass & Rim Takeover', positions: ['C'], stats: ['off_rebound', 'def_rebound', 'block', 'interior_d'], boost: 8 },
};
export const TAKEOVER_FOR_POS = { PG: 'shooting', SG: 'shooting', SF: 'finishing', PF: 'finishing', C: 'glass' };
export const TAKEOVER_NEED = 6;
export const TAKEOVER_SECS = 60; // real seconds

// Effective sim ratings. `raw` = the build's attributes; badges = {id: tier}; icon = icon badge id or null.
export function effectiveRatings(raw, badges = {}, icon = null, takeover = null) {
  const out = { ...raw };
  for (const [stat, list] of Object.entries(STAT_BADGES)) {
    if (out[stat] == null) continue;
    if (!list.some(b => (badges[b] || 0) > 0)) out[stat] = 25 + (out[stat] - 25) * NO_BADGE_K;
  }
  const ic = icon && ICON_BADGES[icon];
  if (ic) {
    for (const k in out) {
      const pct = (ic.all || 0) + (ic.stats[k] || 0);
      if (pct) out[k] = out[k] * (1 + pct);
    }
  }
  const t = takeover && TAKEOVERS[takeover];
  if (t) for (const k of t.stats) if (out[k] != null) out[k] += t.boost;
  return out;
}
