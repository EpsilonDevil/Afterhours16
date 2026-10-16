// v0.4.8.5 Open Arms (the Stretch Big Icon badge): rebound snags. Every board an Open Arms holder comes down with off a
// shot (offensive or defensive, in the air or on the floor, a jump that started as a block, the user or the AI) is
// snagged: his hands meet the ball where it is, rip it in, and he lands with the snag's gesture, the ball never
// leaving his hands. With the Icon's own Rebound Package on (slot 'rebound', the Inventory's Rebounds; nobody else
// can wear it) it is one of six streetball snags, a different one every board; without it, the Open Arms Rip.
//
// The snag is an action ('snag'): the sim carries the ball along its path (Game.holdPoint reads snagBall), the
// animator poses the body (Animator.snagPose / snagHands) from the same numbers (snagFrame), so the ball stays in
// his hands whatever the frame rate. Nothing here imports the sim or the animator.
//
// Timeline (action time t, 0 = the catch): the grab (SNAG.grab: the hands clamp on and pull it to where they can
// hold it), the rip (the style's own path to where he secures it), held there while he's still in the air, then from
// the landing (or the end of the rip, whichever is later) the gesture. The gesture is for show: once he's on the floor
// and the ball is secured (cutAt), moving, dribbling, passing, shooting or jumping ends it (Game.applyIntent).
export const OA_ICON = 'open_arms';
export const OA_REB_PKG = 'reb_openarms';
export const OA_BASIC = 'oa_rip';
export const SNAG = { grab: 0.06, max: 3.2, groundK: 0.8, spinT: 0.46, end: 0.08, cutK: 0.6 };
// the actions he can be in when the board comes to him (anything else, a shot or a finish, keeps its own animation)
export const SNAG_FROM = new Set(['catch', 'rebound', 'block', 'tipjump', 'steal', 'bump']);

// rip: s from the grab to secured; gest: s of the gesture after he's down (the gesture never holds him more than
// half a second, and he can cut it short)
export const SNAG_STYLES = [
  { id: 'oa_rip', name: 'Open Arms Rip', rip: 0.2, gest: 0.3, desc: 'Both arms thrown open, then the board ripped down to the chest with the elbows out.' },
  { id: 'chin_check', name: 'Chin Check', rip: 0.2, gest: 0.46, desc: 'Ripped down to the chin, elbows swung hard both ways to clear space, then the head thrown back with a scream.' },
  { id: 'cuff_holster', name: 'Cuff & Holster', rip: 0.3, gest: 0.44, desc: 'One hand cuffs it at the top of his reach and swings it straight-armed down to the hip, the other arm flung out; he lands pointing at the floor: his house.' },
  { id: 'pterodactyl', name: 'Pterodactyl', rip: 0.34, gest: 0.46, desc: 'Legs split wide, the ball ripped to the chest and swung out to arm\'s length as both arms spread like wings; he lands with the wingspan out and gives it a flap.' },
  { id: 'rip_360', name: '360 Rip-Through', rip: 0.4, gest: 0.42, desc: 'A full turn in the air with the ball ripped low through the hips, knees tucked; he lands in a crouch swinging it knee to knee.' },
  { id: 'tomahawk_yank', name: 'Tomahawk Yank', rip: 0.36, gest: 0.44, desc: 'One hand yanks it back behind the head, knee driven up, and whips it down over the top; he lands barking at whoever was under him.' },
  { id: 'hammer_down', name: 'Hammer Down', rip: 0.2, gest: 0.5, desc: 'Lifted overhead with both arms, hammered down to the floor as he lands and pounded twice, then up with a flex.' },
];
export const SNAG_BY_ID = Object.fromEntries(SNAG_STYLES.map(s => [s.id, s]));
export const snagName = id => SNAG_BY_ID[id]?.name || null;

// the package: the six (never the basic Rip), for the holder of the badge alone
export const SNAG_PACKAGES = [
  {
    id: OA_REB_PKG, name: 'Rebound Package: Open Arms', icon: OA_ICON,
    styles: ['chin_check', 'cuff_holster', 'pterodactyl', 'rip_360', 'tomahawk_yank', 'hammer_down'],
    desc: 'The Stretch Big Icon\'s own: six aggressive streetball rebound snags, a different one on every board you come down with (the Chin Check, Cuff & Holster, Pterodactyl, 360 Rip-Through, Tomahawk Yank and Hammer Down), and the ball never leaves your hands. Comes with the Open Arms Icon badge, for that build only; it cannot be bought.',
  },
];
export const SNAG_PKG_BY_ID = Object.fromEntries(SNAG_PACKAGES.map(k => [k.id, k]));
// the catalog entries (server/catalog.json carries exactly these: a test checks)
export function snagPackageItems() {
  return SNAG_PACKAGES.map(k => ({
    category: 'animation', min_overall: 0, rep_required: 0, original_2k_asset: false,
    id: k.id, name: k.name, slot: 'rebound', price: 0, min_attr: {},
    styles: [...k.styles], signature: k.styles[0], description: k.desc,
    exclusive: 'icon', icon: k.icon, secret: true, v0485: true,
  }));
}

// the package a player plays (Player.reboundPkg): what he wears, only if it's his Icon's (null: none)
export function reboundPackageOf(build, icon) {
  const id = build?.equipment?.rebound, k = id && SNAG_PKG_BY_ID[id];
  return k && k.icon === icon ? id : null;
}
// the snags a player can play: the package's six, the basic Rip for a holder without it, nothing for anyone else
export function snagPool(p) {
  if (!p || p.icon !== OA_ICON) return null;
  const k = SNAG_PKG_BY_ID[p.reboundPkg];
  return k && k.icon === p.icon ? k.styles : [OA_BASIC];
}
// a different snag from the last one, every board (the game's RNG: online, every screen picks the same one)
export function pickSnag(p, rng) {
  const pool = snagPool(p);
  if (!pool) return null;
  let id = pool[0];
  if (pool.length > 1) { const opts = pool.filter(s => s !== p.lastSnag); id = opts[rng.int(0, opts.length - 1)]; }
  p.lastSnag = id;
  return id;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = v => clamp(v, 0, 1);
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoother = k => { k = clamp01(k); return k * k * k * (k * (k * 6 - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;
const L3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const Q3 = (a, c, b, t) => { const u = 1 - t; return [0, 1, 2].map(i => u * u * a[i] + 2 * u * t * c[i] + t * t * b[i]); };
const rotY = (v, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };

// the snag's data, as the action starts (Player.startAction('snag', SNAG.max, ...)). ball: where it is (world); the
// player's own frame is his position and facing. raw: where his hands met it; from: the nearest point to it they can
// hold it at (the grab pulls it there); hand: the side it came in on (the one-hand snags use that hand); dir: the
// spin's way round; air: caught in the air (landAt: when he touched down; a floor snag starts down)
export function snagAction(p, style, ball) {
  const H = p.phys.H, c = Math.cos(p.facing), s = Math.sin(p.facing);
  const dx = ball.x - p.x, dz = ball.z - p.z;
  const raw = [dx * c - dz * s, ball.y - p.y, dx * s + dz * c];
  const top = Math.max(0.6 * H, (p.phys.reach || 1.33 * H) - 0.14);
  const from = [clamp(raw[0], -0.34, 0.34), clamp(raw[1], 0.4 * H, top), clamp(raw[2], 0.14, 0.5)];
  const hand = Math.abs(raw[0]) > 0.05 ? (raw[0] > 0 ? 'L' : 'R') : (p.hand === 'L' ? 'L' : 'R');
  const air = !!p.airborne;
  return { style, raw, from, hand, dir: hand === 'L' ? 1 : -1, air, landAt: air ? null : 0, ripK: air ? 1 : SNAG.groundK, H };
}
// the snag's clock: rip end, gesture start, when he can cut it short and when it's over (null while he's in the air)
export function snagTimes(a) {
  const S = SNAG_BY_ID[a.style] || SNAG_BY_ID[OA_BASIC];
  const rip = S.rip * (a.ripK || 1), ripEnd = SNAG.grab + rip;
  if (a.landAt == null) return { S, rip, ripEnd, gs: null, cutAt: null, end: null };
  const gs = Math.max(a.landAt, ripEnd);
  return { S, rip, ripEnd, gs, cutAt: Math.max(a.landAt, SNAG.grab + rip * SNAG.cutK), end: gs + S.gest };
}
// every tick (Game.tickAction, the preview): note the touchdown; true when the snag is over
export function snagTick(p, a) {
  if (a.landAt == null && !p.airborne) a.landAt = a.t;
  const T = snagTimes(a);
  return (T.end != null && a.t >= T.end) || a.t >= (a.dur || SNAG.max);
}
// whether moving, dribbling, passing, shooting or jumping ends it now (on the floor with the ball secured)
export function snagCuttable(a) { const T = snagTimes(a); return T.cutAt != null && a.t >= T.cutAt; }
// the whole body's turn (the 360): the animator turns him by it and the ball goes round with him (radians)
export function snagSpin(a) {
  if (!a || a.type !== 'snag' || a.style !== 'rip_360') return 0;
  return (a.dir || 1) * 2 * Math.PI * smoother((a.t - SNAG.grab) / (SNAG.spinT * (a.ripK || 1)));
}

// a point carried by the trunk: rel (m) from the chest joint, through the trunk's numbers (c: hips up/down, reference
// units, as the animator's root; sp: spine pitch, forward +; cp: chest pitch; tw: chest turn, to his left +). The rig's
// own chain (char/rig.js: the spine joint 0.075 H over the hips, the chest joint 0.10 H up the spine), so a ball held
// at the chin stays at the chin as he bends, arches or swings his elbows
export function trunkPoint(H, b, rel) {
  const s = H / 2, sp = b.sp || 0, cp = b.cp || 0, tw = b.tw || 0;
  const y0 = 0.535 * H + (b.c || 0) * s + 0.075 * H, z0 = -0.004 * H;
  const cy = y0 + 0.1 * H * Math.cos(sp), cz = z0 + 0.1 * H * Math.sin(sp);
  let [x, y, z] = rel;
  [y, z] = [y * Math.cos(cp) - z * Math.sin(cp), y * Math.sin(cp) + z * Math.cos(cp)];
  [x, z] = [x * Math.cos(tw) + z * Math.sin(tw), -x * Math.sin(tw) + z * Math.cos(tw)];
  [y, z] = [y * Math.cos(sp) - z * Math.sin(sp), y * Math.sin(sp) + z * Math.cos(sp)];
  return [x, cy + y, cz + z];
}

// where the ball sits on him (m, from the chest joint)
const CHIN = H => [0, 0.085 * H, 0.12 * H];
const CHEST = H => [0, -0.02 * H, 0.14 * H];
const BELLY = H => [0, -0.12 * H, 0.15 * H];
const B0 = { c: 0, sp: 0, cp: 0, tw: 0 };

// The styles. air(k): the rip (k 0..1, its share done) and the hold after it; gest(g): the gesture, g s after it
// starts. Each returns { ball (m, his frame, before the spin), body (the trunk numbers), grip (1 two hands, 0 the
// snag hand alone) } plus whatever the animator reads for the free arm and the legs (fx: 0..1 phase values).
const STYLE = {
  oa_rip: {
    air(k, f) {
      const e = sm(0, 1, k), body = { c: 0, sp: 0.2 * e, cp: 0.06 * e, tw: 0 };
      const sec = trunkPoint(f.H, body, CHEST(f.H));
      return { ball: Q3(f.from, [f.from[0] * 0.3, lerp(f.from[1], sec[1], 0.35), lerp(f.from[2], sec[2], 0.7)], sec, e), body, grip: 1, e };
    },
    gest(g, f) {
      const q = clamp01(g / 0.3), up = Math.sin(Math.PI * q);
      const body = { c: -0.1 * up, sp: 0.2 + 0.08 * up, cp: 0.06, tw: f.hs * 0.34 * Math.sin(Math.PI * clamp01(g / 0.24)) };
      return { ball: trunkPoint(f.H, body, L3(CHEST(f.H), CHIN(f.H), 0.8 * up)), body, grip: 1, flare: up };
    },
  },
  chin_check: {
    air(k, f) {
      const e = 1 - Math.pow(1 - clamp01(k), 2.4), body = { c: 0, sp: 0.34 * e, cp: 0.12 * e, tw: 0 };
      const sec = trunkPoint(f.H, body, CHIN(f.H));
      return { ball: Q3(f.from, [f.from[0] * 0.2, Math.max(f.from[1], sec[1]), lerp(f.from[2], sec[2], 0.5)], sec, e), body, grip: 1, e };
    },
    gest(g, f) {
      // elbows swung hard one way and then the other, then the scream: head back, chest out
      const env = sm(0, 0.04, g) * (1 - sm(0.19, 0.25, g)), sc = sm(0.22, 0.29, g);
      const body = { c: lerp(-0.2, -0.07, sc), sp: lerp(0.4, -0.16, sc), cp: lerp(0.12, -0.18, sc), tw: f.hs * 0.6 * Math.sin(2 * Math.PI * g / 0.24) * env };
      return { ball: trunkPoint(f.H, body, CHIN(f.H)), body, grip: 1, swing: env, scream: sc };
    },
  },
  cuff_holster: {
    air(k, f) {
      const H = f.H, hs = f.hs, low = [hs * 0.2 * H, 0.44 * H, 0.17 * H], hip = [hs * 0.21 * H, 0.5 * H, 0.0];
      const kA = clamp01(k / 0.62), kB = clamp01((k - 0.62) / 0.38);
      const ball = k < 0.62 ? Q3(f.from, [hs * 0.17 * H, 0.86 * H, 0.42 * H], low, Math.pow(kA, 1.35)) : Q3(low, [hs * 0.25 * H, 0.4 * H, 0.06 * H], hip, sm(0, 1, kB));
      const body = { c: 0, sp: 0.08 + 0.2 * sm(0.3, 0.8, k), cp: 0.04, tw: -hs * 0.22 * sm(0.4, 1, k) };
      return { ball, body, grip: 0, swingK: k, e: k };
    },
    gest(g, f) {
      const H = f.H, s = H / 2, c = -0.12 * sm(0, 0.08, g);
      // two hard points at the floor (his house), a nod with each
      const jab = g > 0.06 && g < 0.34 ? Math.abs(Math.sin(Math.PI * (g - 0.06) / 0.14)) : 0;
      const body = { c, sp: 0.28 + 0.14 * jab, cp: 0.06, tw: -f.hs * 0.22 };
      return { ball: [f.hs * 0.21 * H, 0.5 * H + c * s + 0.01 * jab, 0.0], body, grip: 0, jab };
    },
  },
  pterodactyl: {
    air(k, f) {
      const H = f.H, hs = f.hs, kA = clamp01(k / 0.38), kB = clamp01((k - 0.38) / 0.62), eB = sm(0, 1, kB);
      const body = { c: 0, sp: 0.12 * (1 - eB) - 0.16 * eB, cp: -0.1 * eB, tw: 0 };
      const chest = trunkPoint(H, { c: 0, sp: 0.12, cp: 0, tw: 0 }, CHEST(H)), wing = [hs * 0.5 * H, 0.83 * H, 0.04 * H];
      const ball = k < 0.38 ? Q3(f.from, [f.from[0] * 0.3, lerp(f.from[1], chest[1], 0.3), lerp(f.from[2], chest[2], 0.7)], chest, sm(0, 1, kA)) : Q3(chest, [hs * 0.3 * H, 0.87 * H, 0.17 * H], wing, eB);
      return { ball, body, grip: 1 - sm(0.3, 0.46, k), spread: eB };
    },
    gest(g, f) {
      const H = f.H, s = H / 2, c = -0.1 * sm(0, 0.08, g);
      const flap = Math.sin(2 * Math.PI * clamp01(g / 0.4)) * (1 - sm(0.3, 0.4, g));
      const body = { c, sp: -0.16, cp: -0.1, tw: 0 };
      return { ball: [f.hs * 0.5 * H, 0.83 * H + c * s - 0.05 * H * flap, 0.04 * H], body, grip: 0, spread: 1, flap };
    },
  },
  rip_360: {
    air(k, f) {
      const H = f.H, d = f.dir, kA = clamp01(k / 0.4), low = [d * 0.15 * H, 0.5 * H, 0.11 * H];
      const ball = k < 0.4 ? Q3(f.from, [f.from[0] * 0.4, lerp(f.from[1], low[1], 0.25), 0.16 * H], low, sm(0, 1, kA)) : L3(low, [d * 0.12 * H, 0.53 * H, 0.1 * H], sm(0.4, 1, k));
      const body = { c: 0, sp: 0.3 * sm(0, 0.5, k), cp: 0.1 * sm(0, 0.5, k), tw: 0 };
      return { ball, body, grip: 1, tuck: sm(0, 0.4, k) };
    },
    gest(g, f) {
      // down in a crouch, the ball swung hard across the knees to the other side and back, then up
      const H = f.H, s = H / 2, d = f.dir, q = clamp01(g / 0.3);
      const c = -0.26 * sm(0, 0.08, g) * (1 - sm(0.3, 0.42, g));
      const body = { c, sp: 0.46 * (1 - sm(0.3, 0.42, g)) + 0.1, cp: 0.08, tw: -d * 0.25 * Math.sin(Math.PI * 2 * q) };
      const x = d * 0.13 * H * Math.cos(2 * Math.PI * q), dip = 0.05 * H * Math.abs(Math.sin(2 * Math.PI * q));
      return { ball: [x, 0.52 * H + c * s - dip, 0.12 * H + 0.04 * H * (1 - Math.abs(Math.cos(2 * Math.PI * q)))], body, grip: 1, crouch: -c / 0.26 };
    },
  },
  tomahawk_yank: {
    air(k, f) {
      const H = f.H, hs = f.hs, behind = [hs * 0.12 * H, 0.97 * H, -0.05 * H];
      const kA = clamp01(k / 0.42), kB = clamp01((k - 0.52) / 0.48), eB = Math.pow(kB, 1.7);
      const body = { c: 0, sp: -0.14 * sm(0, 0.42, k) * (1 - sm(0.52, 0.8, k)) + 0.3 * sm(0.6, 1, k), cp: -0.1 * sm(0, 0.42, k) * (1 - sm(0.52, 0.8, k)) + 0.08 * sm(0.6, 1, k), tw: hs * 0.25 * sm(0, 0.42, k) * (1 - sm(0.52, 0.9, k)) };
      const chest = trunkPoint(H, body, CHEST(H));
      const ball = k < 0.52 ? Q3(f.from, [hs * 0.1 * H, Math.max(f.from[1], 0.97 * H) + 0.04 * H, f.from[2] * 0.3], behind, sm(0, 1, kA)) : Q3(behind, [hs * 0.06 * H, 1.02 * H, 0.2 * H], chest, eB);
      return { ball, body, grip: sm(0.82, 0.96, k), knee: sm(0, 0.35, k), cock: sm(0.1, 0.42, k) * (1 - sm(0.52, 0.7, k)) };
    },
    gest(g, f) {
      // bent over the ball at his belly, two barks: the chest and the head driven forward at the man
      const bark = (g > 0.04 && g < 0.16 ? Math.sin(Math.PI * (g - 0.04) / 0.12) : 0) + (g > 0.2 && g < 0.32 ? Math.sin(Math.PI * (g - 0.2) / 0.12) : 0);
      const c = -0.12 * sm(0, 0.08, g), body = { c, sp: 0.3 + 0.12 * bark, cp: 0.06 + 0.06 * bark, tw: 0 };
      return { ball: trunkPoint(f.H, body, BELLY(f.H)), body, grip: 1, bark };
    },
  },
  hammer_down: {
    air(k, f) {
      const H = f.H, e = sm(0, 1, k), over = [0, 1.1 * H, 0.06 * H];
      const body = { c: 0, sp: -0.12 * e, cp: -0.08 * e, tw: 0 };
      return { ball: Q3(f.from, [f.from[0] * 0.5, Math.max(f.from[1], over[1]) + 0.03 * H, lerp(f.from[2], over[2], 0.5)], over, e), body, grip: 1, over: e };
    },
    gest(g, f) {
      // hammered down to the floor on the landing, pounded twice, then up on the hip with a flex
      const H = f.H, s = H / 2, hs = f.hs;
      const dn = clamp01(g / 0.13), eh = Math.pow(dn, 1.6), rise = sm(0.22, 0.3, g);
      const c = lerp(-0.3 * sm(0, 0.13, g), -0.06, rise);
      const body = { c, sp: lerp(lerp(-0.12, 0.62, eh), -0.12, rise), cp: lerp(lerp(-0.08, 0.12, eh), -0.06, rise), tw: 0 };
      const pound = g > 0.13 && g < 0.23 ? Math.abs(Math.sin(Math.PI * (g - 0.13) / 0.05)) : 0;
      const down = [0, 0.42 * H + c * s + 0.07 * H * pound, 0.23 * H];
      const over = [0, 1.1 * H, 0.06 * H], hip = [hs * 0.2 * H, 0.5 * H + c * s, 0.04 * H];
      const ball = g < 0.13 ? L3(over, down, eh) : L3(down, hip, rise);
      return { ball, body, grip: 1 - sm(0.22, 0.3, g), pound, flex: sm(0.22, 0.3, g) };
    },
  },
};

// Everything about the snag now, for the sim (ball) and the animator (body): {style, k (the rip done), g (s into the
// gesture, < 0 before), ball (m, his frame, turned with the spin), body, grip (1 two hands), spin, fin (0..1: easing
// back to an ordinary hold at the end), hand, hs, dir, and the style's own phase values}. hold: the ordinary held-ball
// point (m) it eases back to at the end (holdPoint's own; the animator doesn't need it)
export function snagFrame(a, H = a.H || 2, hold = null) {
  const T = snagTimes(a), st = STYLE[a.style] ? a.style : OA_BASIC, X = STYLE[st];
  const hs = a.hand === 'L' ? 1 : -1, f = { H, from: a.from || [0, 0.6 * H, 0.3], hs, dir: a.dir || hs };
  const t = a.t, k = clamp01((t - SNAG.grab) / T.rip), g = T.gs != null ? t - T.gs : -1;
  let o = X.air(k, f);
  if (g >= 0) {
    // into the gesture: eased in over its first 0.08 s from where the rip left him
    const G = X.gest(g, f), w = sm(0, 0.08, g);
    o = { ...o, ...G, ball: L3(o.ball, G.ball, w), body: { c: lerp(o.body.c, G.body.c, w), sp: lerp(o.body.sp, G.body.sp, w), cp: lerp(o.body.cp, G.body.cp, w), tw: lerp(o.body.tw, G.body.tw, w) }, grip: lerp(o.grip, G.grip, w), gw: w };
  }
  let ball = o.ball;
  // the grab: from where his hands met it to where they can hold it
  if (t < SNAG.grab) ball = L3(a.raw || f.from, ball, sm(0, SNAG.grab, t));
  // the end: back to an ordinary hold, the trunk upright again
  const fin = T.end != null ? sm(T.end - SNAG.end, T.end, t) : 0;
  let body = o.body;
  if (fin > 0) {
    if (hold) ball = L3(ball, hold, fin);
    body = { c: body.c * (1 - fin), sp: body.sp * (1 - fin), cp: body.cp * (1 - fin), tw: body.tw * (1 - fin) };
  }
  const spin = snagSpin(a);
  if (spin) ball = rotY(ball, spin);
  return { ...o, style: st, k, g, q: g >= 0 ? clamp01(g / T.S.gest) : -1, ball, body, grip: Math.max(o.grip, fin), spin, fin, hand: a.hand === 'L' ? 'L' : 'R', hs, dir: f.dir, landed: a.landAt != null, times: T };
}
// the ball (m, his frame) for Game.holdPoint
export function snagBall(a, H, hold) { return snagFrame(a, H, hold).ball; }
