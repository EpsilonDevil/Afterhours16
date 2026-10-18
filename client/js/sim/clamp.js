// v0.4.8.5 The Clamp (the Lockdown Icon badge): "unlocks steal animations that exist only for this badge". Every steal
// try the holder makes has a Clamp animation, and only his: a reach (the 'steal' action) is one of six reaches picked
// for the moment (the hand he reached with, a low swipe or the ball high or across his body), a pass he picks off is
// one of three interceptions, and a ball he strips off a man who runs into him is the chest-up rip.
//
// None of it changes the game. The reach is the same reach (the same hand, the same timing, the same odds; the sim's
// own fields), and the interception and the strip are an overlay (Player.clampFx, ticked by Game.tickAction) that no
// gameplay code reads: who gets the ball, and when, is the game's alone. The picks don't touch the game's RNG; they're
// dealt from the player's own count of them and the tick, so online every screen plays the same one (lockstep).
// Where the ball is in his hands (a steal he comes up with, a pass he picks off), the sim carries it along the
// animation's path (Game.holdPoint reads clampStealBall / clampPickBall) and the animator's hands are on it.
//
// The animator's side is char/clamp.js. Nothing here imports the sim or the animator.
import { trunkPoint } from './snags.js';

export const CLAMP_ICON = 'the_clamp';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = v => clamp(v, 0, 1);
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoother = k => { k = clamp01(k); return k * k * k * (k * (k * 6 - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;
const L3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const Q3 = (a, c, b, t) => { const u = 1 - t; return [0, 1, 2].map(i => u * u * a[i] + 2 * u * t * c[i] + t * t * b[i]); };

// the reach's clock (Game.startSteal: 0.46 s; resolveSteal at 0.13 s, the contact)
export const CLAMP_HIT = 0.13;
export const CLAMP_REACHES = [
  { id: 'vise', name: 'The Vise', desc: 'Both hands clamped on the ball from either side, low and square in a wide stance, and ripped in to the chest.' },
  { id: 'hip_rip', name: 'Hip Rip', desc: 'Both hands on it at his hip, then ripped back across his own body to the far hip, the shoulders turning away and the lead foot dropping back.' },
  { id: 'dig', name: 'Dig', desc: 'A deep lunge, the lead hand stabbing down at the low dribble palm-down, the other arm trailing straight back.' },
  { id: 'slap_down', name: 'Slap-Down', desc: 'Reaching across: the far hand comes high over the top and slaps down across his body onto the ball, the near hand held wide.' },
  { id: 'swipe_spin', name: 'Swipe & Spin', spin: true, desc: 'A swipe straight through the ball, and the momentum spins him out a full turn.' },
  { id: 'double_tap', name: 'Double Tap', desc: 'Two quick pokes at the ball, jab-jab, bouncing on his toes, the other hand up high.' },
];
// a pass he picks off (overlay, dur s)
export const CLAMP_PICKS = [
  { id: 'lane_dive', name: 'Lane Dive', dur: 0.56, desc: 'Lunging into the lane, low and stretched out, both hands snatching it out of the air and pulling it in.' },
  { id: 'tip_self', name: 'Tip to Himself', dur: 0.58, desc: 'One hand tips it up off the fingertips, and both hands take it as it drops.' },
  { id: 'pick_go', name: 'Pick & Go', dur: 0.56, desc: 'Picked out of the air with one hand, swung to the hip, the shoulders and hips turning upcourt.' },
];
// a ball he strips off a driver who runs into him (overlay)
export const CLAMP_STRIPS = [
  { id: 'chest_rip', name: 'Chest-Up Strip', dur: 0.52, desc: 'Chest up and square into the contact, both hands down on the ball and ripping it out and away to his hip.' },
];
export const CLAMP_BY_ID = Object.fromEntries([...CLAMP_REACHES, ...CLAMP_PICKS, ...CLAMP_STRIPS].map(s => [s.id, s]));
export const clampName = id => CLAMP_BY_ID[id]?.name || null;

// v0.4.8.5 qp6: the Icon's own Steal Package (slot 'steal', the Inventory's Steals; like the Open Arms Rebound Package).
// Worn, the holder gets all ten: the six reaches for the moment, the three pick-offs and the strip. Taken off (the slot
// empty), the badge still has its basic steal, The Vise, on every reach, and no pick-off or strip. Nobody else can wear
// it, and anyone else who did would get nothing from it. It comes with the badge (server/app.py grant_icon_items, and
// once on the profile load for a build that already held it: ICON_EQUIP_ONCE); it cannot be bought.
export const CLAMP_STEAL_PKG = 'steal_the_clamp';
export const CLAMP_BASIC = 'vise';
export const CLAMP_PACKAGES = [
  {
    id: CLAMP_STEAL_PKG, name: 'Steal Package: The Clamp', icon: CLAMP_ICON, styles: [...CLAMP_REACHES, ...CLAMP_PICKS, ...CLAMP_STRIPS].map(s => s.id),
    desc: 'The Lockdown Icon\'s own: ten steal animations that exist only for The Clamp. Six reaches picked for the moment (The Vise, Hip Rip, Dig, Slap-Down, Swipe & Spin and Double Tap), three pick-offs for a pass you jump (Lane Dive, Tip to Himself and Pick & Go) and the Chest-Up Strip on a driver who runs into you. Without it, the badge\'s basic steal: The Vise. Comes with The Clamp Icon badge, for that build only (a Lockdown who has unlocked it); it cannot be bought.',
  },
];
export const CLAMP_PKG_BY_ID = Object.fromEntries(CLAMP_PACKAGES.map(k => [k.id, k]));
// the catalog entry (server/catalog.json carries exactly it: a test checks)
export function clampPackageItems() {
  return CLAMP_PACKAGES.map(k => ({
    category: 'animation', min_overall: 0, rep_required: 0, original_2k_asset: false,
    id: k.id, name: k.name, slot: 'steal', price: 0, min_attr: {},
    styles: [...k.styles], signature: k.styles[0], description: k.desc,
    exclusive: 'icon', icon: k.icon, secret: true, v0485qp6: true,
  }));
}
// the package a player plays (Player.stealPkg): what he wears, only if it's his Icon's (null: none)
export function stealPackageOf(build, icon) {
  const id = build?.equipment?.steal, k = id && CLAMP_PKG_BY_ID[id];
  return k && k.icon === icon ? id : null;
}
// the full set: a holder wearing his package (the pick-offs and the strip are his only then)
export const clampFull = p => !!p && p.icon === CLAMP_ICON && CLAMP_PKG_BY_ID[p.stealPkg]?.icon === p.icon;
// the styles a player can play: the package's ten, the basic Vise for a holder without it, nothing for anyone else
export function clampPool(p) {
  if (!p || p.icon !== CLAMP_ICON) return null;
  return clampFull(p) ? CLAMP_PKG_BY_ID[p.stealPkg].styles : [CLAMP_BASIC];
}

// one of the pool, dealt from his own count and the tick (never the game's RNG), never the same twice running
function deal(p, pool, tick, key) {
  const n = (p.clampN = (p.clampN || 0) + 1);
  let i = (Math.imul(n * 2654435761 + (p.id + 1) * 40503 + (tick | 0) * 69069, 1) >>> 7) % pool.length;
  if (pool.length > 1 && pool[i] === p[key]) i = (i + 1 + ((n + (tick | 0)) % (pool.length - 1))) % pool.length;
  return (p[key] = pool[i]);
}

// The reach for the moment (Game.startSteal). ball: the game ball (world); hand: the hand he reaches with ('L' / 'R');
// low: a low swipe at the dribble; aimed: reached with a chosen hand. Across his body (aimed with the hand away from the
// ball): the slap-down; low (the swipe, or the dribble down near the floor): the dig, the vise or the swipe & spin;
// the ball up (held, or high in the dribble): the hip rip, the double tap or the vise; otherwise any but the slap-down.
export function pickClampReach(p, ball, { hand, low, aimed, tick = 0 }) {
  const lx = Math.cos(p.facing), lz = -Math.sin(p.facing), ballLeft = (ball.x - p.x) * lx + (ball.z - p.z) * lz >= 0;
  let pool;
  if (aimed && !low && (hand === 'L') !== ballLeft) pool = ['slap_down'];
  else if (low || (ball.mode === 'dribble' && ball.y < 0.5)) pool = ['dig', 'swipe_spin', 'vise'];
  else if (ball.mode !== 'dribble' || ball.y > 0.95) pool = ['hip_rip', 'double_tap', 'vise'];
  else pool = ['vise', 'hip_rip', 'swipe_spin', 'double_tap', 'dig'];
  return deal(p, pool, tick, 'lastClampReach');
}
// the reach a player's steal try shows (Game.startSteal): one for the moment with the package on, The Vise with the
// slot empty, none for anyone but the holder
export function clampReach(p, ball, opts) {
  if (!p || p.icon !== CLAMP_ICON) return null;
  return clampFull(p) ? pickClampReach(p, ball, opts) : CLAMP_BASIC;
}
// the Swipe & Spin's turn (radians; the animator turns him by it, and a ball he came up with goes round with him):
// a full turn the way the swipe goes, from just before the contact to the end of the reach
export function clampSpin(a) {
  if (!a || a.type !== 'steal' || a.clamp !== 'swipe_spin') return 0;
  return (a.hand === 'L' ? -1 : 1) * 2 * Math.PI * smoother((a.t - 0.1) / 0.34) || 0;
}

// a steal he comes up with: where he got it (his frame, m), for the ball's path (Game.resolveSteal, before giveBall)
export function clampGot(p, a, ball) {
  const c = Math.cos(p.facing), s = Math.sin(p.facing), dx = ball.x - p.x, dz = ball.z - p.z;
  a.gotAt = a.t; a.gotFrom = [c * dx - s * dz, ball.y - p.y, s * dx + c * dz];
}
// the double tap's two pokes (0..1)
export const clampJab = t => Math.max(sm(0, CLAMP_HIT, t) * (1 - sm(0.15, 0.23, t)), sm(0.23, 0.31, t) * (1 - sm(0.33, 0.43, t)));
// The trunk through a reach, shared by the animator's body (char/clamp.js) and the path of a ball he comes up with, so
// the ball held in front of his chest is in front of it however low he is or however far he's bent or turned: c (the
// hips, reference units, as the animator's root), sp (spine pitch, forward +), cp (chest pitch), tw (chest turn, to his
// left +), roll (spine roll, to his right +). Eased back toward a ready stance over the last of the reach.
export function clampStealBody(a) {
  const t = a.t, dur = a.dur || 0.46, sg = a.hand === 'L' ? 1 : -1, inK = sm(0, CLAMP_HIT, t), g = t - CLAMP_HIT, out = sm(dur - 0.13, dur, t);
  let c, sp, tw = 0, roll = 0;
  switch (a.clamp) {
    case 'hip_rip': { const k2 = sm(0, 0.2, g); c = -0.2; sp = 0.42 * inK - 0.12 * k2; tw = -sg * (0.2 * inK + 0.6 * k2); break; }
    case 'dig': { const k2 = sm(0.04, 0.24, g), lunge = inK * (1 - 0.6 * out); c = -0.34 * lunge; sp = 0.78 * lunge - 0.15 * k2; tw = -sg * 0.22 * lunge; break; }
    case 'slap_down': { const k2 = sm(0, 0.16, g); c = -0.18 - 0.1 * k2; sp = 0.22 + 0.42 * k2; tw = -sg * (0.35 * inK + 0.3 * k2); roll = sg * 0.14 * inK; break; }
    case 'swipe_spin': { const k2 = sm(0, 0.12, g); c = -0.15; sp = 0.36 * inK - 0.16 * k2; tw = sg * 0.3 * inK - sg * 0.8 * k2; break; }
    case 'double_tap': { const j = clampJab(t), bounce = Math.abs(Math.sin(Math.PI * t / 0.22)); c = -0.12 - 0.05 * bounce - 0.06 * j; sp = 0.22 + 0.3 * j; tw = -sg * 0.3 * j; break; }
    default: { const k2 = sm(0, 0.16, g); c = -0.24 - 0.1 * inK + 0.1 * k2; sp = 0.36 + 0.3 * inK - 0.25 * k2; } // 'vise'
  }
  const r = 1 - out * 0.7;
  return { c: c * r - 0.12 * (1 - r), sp: sp * r + 0.25 * (1 - r), cp: 0, tw: tw * r, roll: roll * r };
}
// where the ball sits on him (m, from the chest joint: sim/snags.js trunkPoint)
const HOLD = H => [0, -0.03 * H, 0.21 * H];
// the ball in his hands after a steal he came up with (Game.holdPoint; his frame, m, before the spin): from where he got
// it along the reach's own rip, then into an ordinary hold (hold) by the end of the reach
export function clampStealBall(a, H, hold) {
  const t = a.t, g = t - (a.gotAt ?? CLAMP_HIT), ls = a.hand === 'L' ? 1 : -1, dur = a.dur || 0.46;
  let f = a.gotFrom || hold;
  // (the Swipe & Spin: where he got it, in the frame he'd turned to by then, so it starts right there)
  const sp0 = a.gotFrom ? clampSpin({ ...a, t: a.gotAt ?? CLAMP_HIT }) : 0;
  if (sp0) { const c = Math.cos(-sp0), s = Math.sin(-sp0); f = [f[0] * c + f[2] * s, f[1], -f[0] * s + f[2] * c]; }
  const body = clampStealBody(a), chest = trunkPoint(H, body, HOLD(H));
  let b;
  switch (a.clamp) {
    case 'hip_rip': { const hip = trunkPoint(H, body, [-ls * 0.08 * H, -0.13 * H, 0.26 * H]); b = Q3(f, [lerp(f[0], hip[0], 0.3), Math.max(f[1], hip[1]) + 0.05, Math.max(f[2], hip[2]) + 0.08], hip, sm(0, 0.2, g)); break; }
    case 'dig': { b = Q3(f, [f[0] * 0.5, f[1] + 0.12, Math.max(f[2], chest[2]) + 0.14], chest, sm(0, 0.2, g)); break; }
    case 'slap_down': { const dn = [f[0], Math.max(0.3 * H, f[1] - 0.14), f[2]]; b = g < 0.08 ? L3(f, dn, sm(0, 0.08, g)) : L3(dn, chest, sm(0.08, 0.24, g)); break; }
    case 'swipe_spin': { b = L3(f, trunkPoint(H, body, [0, -0.08 * H, 0.21 * H]), sm(0, 0.12, g)); break; }
    default: b = L3(f, chest, sm(0, 0.16, g));
  }
  b = L3(b, hold, sm(dur - 0.1, dur, t));
  const sp = clampSpin(a);
  if (sp) { const c = Math.cos(sp), s = Math.sin(sp), x = b[0]; b = [x * c + b[2] * s, b[1], -x * s + b[2] * c]; }
  return b;
}

// The overlays: a pass he picks off ('pick') and a ball he strips ('strip'). fx: { kind, style, t (s), dur, from (where
// the ball was, his frame, m), side (+1 his left), up (the turn upcourt, radians, for the Pick & Go) }
export function clampPickStart(p, ball, { tick = 0, rim = null } = {}) {
  const c = Math.cos(p.facing), s = Math.sin(p.facing), dx = ball.x - p.x, dz = ball.z - p.z, H = p.phys.H;
  const from = [c * dx - s * dz, ball.y - p.y, s * dx + c * dz];
  const side = from[0] >= 0 ? 1 : -1;
  // high (over his shoulders): the tip or the pick; off to his side: the pick or the dive; in front of him: the dive
  // or the tip
  const pool = from[1] > 0.8 * H ? ['tip_self', 'pick_go'] : Math.abs(from[0]) > 0.3 ? ['pick_go', 'lane_dive'] : ['lane_dive', 'tip_self'];
  const style = deal(p, pool, tick, 'lastClampPick');
  // upcourt: toward the rim he attacks now that it's his ball, as a turn of the hips from where he faces
  let up = 0;
  if (rim) { const fx = Math.sin(p.facing), fz = Math.cos(p.facing), rx = rim.x - p.x, rz = rim.z - p.z; up = clamp(Math.atan2(fx * rz - fz * rx, fx * rx + fz * rz), -1, 1) * -1; }
  return (p.clampFx = { kind: 'pick', style, t: 0, dur: CLAMP_BY_ID[style].dur, from, side, up, H });
}
export function clampStripStart(p, ball, { tick = 0 } = {}) {
  const c = Math.cos(p.facing), s = Math.sin(p.facing), dx = ball.x - p.x, dz = ball.z - p.z;
  const from = [c * dx - s * dz, ball.y - p.y, s * dx + c * dz];
  const style = deal(p, CLAMP_STRIPS.map(x => x.id), tick, 'lastClampStrip');
  return (p.clampFx = { kind: 'strip', style, t: 0, dur: CLAMP_BY_ID[style].dur, from, side: from[0] >= 0 ? 1 : -1, H: p.phys.H });
}
// every tick (Game.tickAction): its clock; over at its end
export function clampFxTick(p, dt) {
  const f = p.clampFx;
  if (!f) return;
  f.t += dt;
  if (f.t >= f.dur) p.clampFx = null;
}
// the trunk through a pick-off, shared by the animator's body and the ball's path (as clampStealBody; yaw: the hips'
// turn, z: the hips forward, reference units), all eased out by its end
export function clampPickBody(fx) {
  const t = fx.t, sd = fx.side || 1, fin = 1 - sm(fx.dur - 0.16, fx.dur, t);
  switch (fx.style) {
    case 'tip_self': { const tip = 1 - sm(0.12, 0.2, t); return { c: 0.03 * tip * fin, sp: -0.1 * fin, cp: 0, tw: 0, yaw: 0, z: 0 }; }
    case 'pick_go': { const turn = sm(0.1, 0.3, t) * (1 - sm(0.4, fx.dur, t)), up = clamp(fx.up ?? sd * 0.6, -1, 1); return { c: -0.08 * fin, sp: 0.22 * fin * (1 - turn * 0.5), cp: 0, tw: up * 0.5 * turn, yaw: up * 0.55 * turn, z: 0 }; }
    default: { const lunge = sm(0, 0.04, t) * (1 - sm(0.22, fx.dur, t)); return { c: -0.34 * lunge, sp: (0.66 * lunge + 0.1) * fin, cp: 0, tw: -sd * 0.3 * lunge, yaw: 0, z: 0.12 * lunge }; }
  }
}
// the ball in his hands through a pick-off (Game.holdPoint; his frame, m): from where his hands met it along the
// pick's own path, then into an ordinary hold (hold) by the end
export function clampPickBall(fx, H, hold) {
  const t = fx.t, f = fx.from || hold, sd = fx.side || 1, s = H / 2;
  const body = clampPickBody(fx);
  const onHim = rel => { const q = trunkPoint(H, body, rel), c = Math.cos(body.yaw), sn = Math.sin(body.yaw); return [q[0] * c + q[2] * sn, q[1], -q[0] * sn + q[2] * c + body.z * s]; };
  // where his hands can hold it right away: in reach, in front of him
  const at = [clamp(f[0], -0.42, 0.42), clamp(f[1], 0.42 * H, 0.98 * H), clamp(f[2], 0.22, 0.62)];
  const chest = onHim(HOLD(H));
  let b;
  switch (fx.style) {
    case 'tip_self': {
      // tipped up off the fingertips (a quick pop up and back toward him), then dropping into both hands at the chest
      const top = [at[0] * 0.6, Math.max(at[1], 0.82 * H) + 0.3, at[2] * 0.8 + 0.06];
      b = t < 0.17 ? Q3(at, [at[0], top[1] - 0.02, at[2]], top, sm(0, 0.17, t)) : Q3(top, [top[0] * 0.5, top[1] + 0.02, (top[2] + chest[2]) / 2], chest, Math.pow(clamp01((t - 0.17) / 0.24), 1.6));
      break;
    }
    case 'pick_go': {
      // one hand: swung down to the hip on that side and held there through the turn
      const hip = onHim([sd * 0.15 * H, -0.15 * H, 0.17 * H]);
      b = Q3(at, [lerp(at[0], hip[0], 0.5) + sd * 0.06, lerp(at[1], hip[1], 0.3), Math.max(at[2], hip[2]) + 0.06], hip, sm(0, 0.22, t));
      break;
    }
    default: {
      // the dive: snatched where it was and pulled in to the chest (in front of it, however low he is in the lunge)
      at[1] = Math.min(at[1], 0.7 * H); at[2] = Math.max(at[2], 0.42);
      const out = onHim([clamp(at[0] * 0.4, -0.12, 0.12), 0.02 * H, 0.36 * H]); // (held out in front of him at full stretch)
      b = t < 0.1 ? L3(at, out, sm(0, 0.08, t)) : Q3(out, [out[0] * 0.6, Math.max(out[1], chest[1]) + 0.02, Math.max(out[2], chest[2]) + 0.04], chest, sm(0.1, 0.3, t));
    }
  }
  if (t < 0.04) b = L3(L3(f, at, 0.5), b, t / 0.04); // (the grab: from where it was)
  return L3(b, hold, sm(fx.dur - 0.12, fx.dur, t));
}
