// Attribute → physical/gameplay parameters. Attributes are 25..99.
import { INCH } from './constants.js';

export const ATTRS = [
  'close_shot', 'mid_range', 'three_point', 'free_throw',
  'layup', 'driving_dunk', 'standing_dunk', 'post_control',
  'ball_handle', 'speed_with_ball', 'pass_accuracy',
  'perimeter_d', 'interior_d', 'steal', 'block',
  'off_rebound', 'def_rebound',
  'speed', 'acceleration', 'vertical', 'strength', 'stamina',
];
export const ATTR_GROUPS = {
  Shooting: ['close_shot', 'mid_range', 'three_point', 'free_throw'],
  Finishing: ['layup', 'driving_dunk', 'standing_dunk', 'post_control'],
  Playmaking: ['ball_handle', 'speed_with_ball', 'pass_accuracy'],
  Defense: ['perimeter_d', 'interior_d', 'steal', 'block'],
  Rebounding: ['off_rebound', 'def_rebound'],
  Athleticism: ['speed', 'acceleration', 'vertical', 'strength', 'stamina'],
};
// v0.4.2 boosts: +amount to every attribute in each boosted category for one game (capped at 99)
const BOOST_GROUP = { shooting: 'Shooting', finishing: 'Finishing', playmaking: 'Playmaking', defense: 'Defense', rebounding: 'Rebounding', athleticism: 'Athleticism' };
export function boostedBuild(build, cats, amount = 5) {
  const out = { ...build, attributes: { ...(build.attributes || {}) } };
  for (const c of cats || []) for (const a of ATTR_GROUPS[BOOST_GROUP[c]] || []) out.attributes[a] = Math.min(99, (out.attributes[a] ?? 60) + amount);
  return out;
}
export const ATTR_LABEL = {
  close_shot: 'Close Shot', mid_range: 'Mid-Range', three_point: 'Three-Point', free_throw: 'Free Throw',
  layup: 'Layup', driving_dunk: 'Driving Dunk', standing_dunk: 'Standing Dunk', post_control: 'Post Control',
  ball_handle: 'Ball Handle', speed_with_ball: 'Speed w/ Ball', pass_accuracy: 'Pass Accuracy',
  perimeter_d: 'Perimeter D', interior_d: 'Interior D', steal: 'Steal', block: 'Block',
  off_rebound: 'Off. Rebound', def_rebound: 'Def. Rebound',
  speed: 'Speed', acceleration: 'Acceleration', vertical: 'Vertical', strength: 'Strength', stamina: 'Stamina',
};

// v0.4.4 rating curve used for every skill check (shooting, finishing, handles, passing, defense, boards):
// linear 70..95, a stronger push above 95, a big jump at 99 (near-certain unless an opposing stat fights it),
// and a steeper fall-off under 70. Roughly 0 at 40, 0.43 at 60, 0.61 at 70, 0.95 at 95, 1.32 at 99.
// v0.4.5 quick patch: a stat under 70 isn't proficient: it plays 10% less effective, across the board (skills here,
// physical attributes below; a shooting stat's green window is cut 10% in shots.js instead, exactly)
export const SUB70_K = 0.9;
export const proficient = v => (v ?? 60) >= 70;
export function rk(v) { const x = rkRaw(v); return proficient(v) ? x : x * SUB70_K; }
export function rkRaw(v) {
  v = v ?? 60;
  let x = (v - 25) / 74;
  if (v < 70) x -= Math.pow((70 - v) / 30, 1.4) * 0.2;
  if (v > 95) x += Math.min(4, v - 95) * 0.03;
  if (v >= 99) x += 0.2;
  // v0.4.5: Icon badges and takeovers can push a rating past 99 in the sim; it keeps paying off
  if (v > 99) x += (v - 99) * 0.025;
  return Math.max(0, x);
}
// physical attributes (speed, bounce, strength, stamina) get a gentler top end so movement stays sane
const n = v => { v = v ?? 60; return ((v - 25) / 74 + (v > 95 ? (v - 95) * 0.012 : 0) + (v >= 99 ? 0.03 : 0)) * (v < 70 ? SUB70_K : 1); };

export function physical(build) {
  const a = build.attributes || {};
  const H = (build.height || 78) * INCH;
  const W = (build.weight || 210) * 0.4536;
  const WS = (build.wingspan || build.height + 3) * INCH;
  const massK = Math.pow(95 / W, 0.22);
  const sprint = 6.0 + n(a.speed) * 2.0;
  return {
    H, W, WS,
    radius: 0.25 + Math.min(0.08, Math.max(0, (W - 80) * 0.0016)) + (H - 1.9) * 0.08,
    sprint,
    jog: sprint * 0.62,
    walk: 1.6,
    ballSpeedK: 0.84 + n(a.speed_with_ball) * 0.14,
    // v0.4.5: a touch less snap in starts and turns (fluid over twitchy)
    accel: (11 + n(a.acceleration) * 6) * massK * 0.96,
    brake: (17 + n(a.acceleration) * 6) * massK * 0.97,
    turn: 13 * massK * 0.93,
    vertical: 0.42 + n(a.vertical) * 0.4,
    reach: H * 1.315 * (WS / H / 1.04), // standing reach
    strength: n(a.strength) * 0.7 + Math.min(1, (W - 75) / 50) * 0.3,
    // v0.4.5 stamina overhaul: sprinting drains faster and recovery is slower, so stamina actually matters
    staminaRate: (0.055 - n(a.stamina) * 0.03) * 1.35, // drain per second when sprinting
    recover: 0.022 + n(a.stamina) * 0.032,
  };
}

export const OVERALL_WEIGHTS = {
  PG: { three_point: 2, mid_range: 1.5, ball_handle: 2.4, pass_accuracy: 2.2, speed_with_ball: 1.6, speed: 1.4, acceleration: 1.3, perimeter_d: 1.2, steal: 1.2, layup: 1.2, close_shot: 0.6, free_throw: 0.6 },
  SG: { three_point: 2.4, mid_range: 2, ball_handle: 1.5, pass_accuracy: 1, speed_with_ball: 1.1, speed: 1.3, acceleration: 1.2, perimeter_d: 1.4, steal: 1.1, layup: 1.4, driving_dunk: 0.8, free_throw: 0.6 },
  SF: { three_point: 1.6, mid_range: 1.6, layup: 1.5, driving_dunk: 1.3, ball_handle: 1.1, perimeter_d: 1.6, interior_d: 0.8, steal: 1, block: 0.8, speed: 1.1, vertical: 1, strength: 0.8, def_rebound: 0.8 },
  PF: { close_shot: 1.6, mid_range: 1.2, layup: 1.2, standing_dunk: 1.4, driving_dunk: 1, post_control: 1.4, interior_d: 1.8, block: 1.4, def_rebound: 1.8, off_rebound: 1.5, strength: 1.4, vertical: 0.8 },
  C: { close_shot: 1.8, standing_dunk: 1.8, post_control: 1.6, interior_d: 2.2, block: 2, def_rebound: 2.2, off_rebound: 1.8, strength: 1.6, layup: 0.8, vertical: 0.7 },
};
export function overall(attrs, position = 'SF') {
  const w = OVERALL_WEIGHTS[position] || OVERALL_WEIGHTS.SF;
  let s = 0, t = 0;
  for (const k of ATTRS) { const wk = w[k] ?? 0.45; s += (attrs[k] ?? 50) * wk; t += wk; }
  const raw = s / t;
  return Math.round(Math.max(40, Math.min(99, 40 + (raw - 40) * 1.18)));
}
