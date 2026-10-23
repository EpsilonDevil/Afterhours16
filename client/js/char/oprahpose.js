// v0.4.8.5 qp5: the bodies of Oprah's passes (the Playmaker's Icon badge). sim/oprah.js has the pick, the ball's path
// and the body's facing up to the release (the sim carries the ball on it, so it leaves his hand where the pose has
// it); this is the rest: the trunk, the legs, the free arm, the head and eyes, the hand on the ball, and each style's
// finish, held a moment after the ball is gone (and the turn back to where the sim has him facing, or the rest of
// the Spin Dish's turn). The Animator calls in at five points (facing, actionPose, ballHands, the look, the hold).
//
// Everything is authored for a right-handed throw in the Animator's reference units (a 2.0 m athlete: hips ~1.07,
// shoulders ~1.6, head ~1.8; + x = his left, + z = ahead) and mirrored for a left hand.
import { P } from './pose.js';
import { BALL_R } from '../sim/constants.js';
import { opK, oprahFacing, oprahHand, oprahBall } from '../sim/oprah.js';
import { trunkPoint } from '../sim/snags.js';
import { hypot3 } from '../gfx/fastmath.js'; // (qp3: Math.hypot, without its per-call allocation)

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const wrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const norm = v => { const l = hypot3(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// the finish, in seconds after the release: in its shape by `in`, held to `hold`, gone by hold + out; the body turns
// back to the sim's facing over `back` (the Spin Dish carries its turn round over `spin`); another action cuts it
// short over `cut`
export const OP_FINISH = { in: 0.12, hold: 0.34, out: 0.22, back: [0.12, 0.46], spin: 0.44, cut: 0.12 };

// The styles. win(k, c): the windup (k: its share done, 0 → 1); fin(f, c): the finish (f: 0 → 1 into it). Each gives the
// trunk (root y, pelvis/spine/chest/head [pitch, yaw, roll]), the free (off) hand and elbow pole, the feet when he's
// standing, and for the finish the throwing hand's move on from where it let go (dT), its elbow pole and palm.
// c: { th (the man's angle off his body at the release, + = left, already mirrored), lob, bnc, ls (the no-look's
// side), stand (0..1, how planted he is) }
const STY = {
  btb: {
    win: (k, c) => ({
      root: -0.07 - 0.05 * k, pelvis: [0, 0.14 * k, 0], spine: [0.16 + 0.06 * k, 0, 0.05 * k], chest: [0.04, -0.55 * sm(0, 0.7, k) + 0.3 * sm(0.7, 1, k), 0], head: [0, 0.1 * k, 0],
      handO: [0.46, 1.3, 0.36], elbowO: [0.8, -0.3, 0.2],
      footO: [0.27, 0.08, 0.06 + 0.16 * k], footT: [-0.16, 0.08, -0.07], kneeO: [0.3, 0, 1],
    }),
    fin: (f, c) => ({
      root: -0.12, pelvis: [0, 0.2, 0], spine: [0.16, 0, -0.03], chest: [0.04, lerp(-0.25, 0.3, f), 0], head: [0, 0.15, 0],
      dT: [0.06, 0.02, -0.02], elbowT: [-0.6, -0.1, -1], palmT: { normal: [1, -0.1, 0.25], fingers: [0.25, -0.35, -0.9] },
      handO: [0.66, 1.34, 0.26], elbowO: [1, -0.1, 0.1],
      footO: [0.3, 0.08, 0.22], footT: [-0.16, 0.08, -0.07], kneeO: [0.3, 0, 1],
    }),
  },
  nolook: {
    // the head and the chest sell the lie (ls: the side he looks to), the free hand fakes that way
    win: (k, c) => ({
      root: -0.06, pelvis: [0, 0, 0], spine: [0.12, 0.1 * c.ls * k, 0], chest: [0.02, 0.32 * c.ls * sm(0, 0.6, k), 0], head: [0.04, 0.2 * c.ls * sm(0, 0.5, k), -0.12 * c.ls * k],
      handO: c.ls > 0 ? [0.66, 1.4, 0.36] : [0.36, 1.0, -0.1], elbowO: c.ls > 0 ? [1, -0.2, 0] : [0.6, -0.3, -1], palmO: c.ls > 0 ? { normal: [0.2, -0.1, 1], fingers: [0.9, 0.1, 0.3] } : null,
      footO: [0.15, 0.08, 0.12 * k], footT: [-0.15, 0.08, -0.04],
    }),
    fin: (f, c) => ({
      root: -0.07, pelvis: [0, 0, 0], spine: [0.14, 0.1 * c.ls, 0], chest: [0.02, 0.3 * c.ls, 0], head: [0.04, 0.22 * c.ls, -0.14 * c.ls],
      dT: [0.22 * Math.sin(c.th), c.lob ? 0.12 : c.bnc ? -0.06 : 0.02, 0.22 * Math.max(0.2, Math.cos(c.th))], elbowT: c.ls > 0 ? [-0.6, -0.5, 0.2] : [-0.3, -0.8, 0.5], palmT: { normal: [Math.sin(c.th), c.bnc ? -0.5 : -0.1, Math.cos(c.th)], fingers: [Math.sin(c.th) * 0.6, 0.2, Math.cos(c.th)] },
      handO: c.ls > 0 ? [0.76, 1.44, 0.34] : [0.38, 0.98, -0.14], elbowO: c.ls > 0 ? [1, -0.2, 0] : [0.6, -0.3, -1], palmO: c.ls > 0 ? { normal: [0.2, -0.1, 1], fingers: [0.9, 0.1, 0.3] } : null,
      footO: [0.15, 0.08, 0.12], footT: [-0.15, 0.08, -0.04],
    }),
  },
  wrap: {
    // a deep lunge to the ball side, the arm out at full length round the man, the free arm up as the bar
    win: (k, c) => ({
      root: -0.1 - 0.2 * sm(0.05, 1, k), pelvis: [0, -0.14 * k, 0.08 * k], spine: [0.28 + 0.26 * k, -0.1 * k, 0.36 * sm(0, 1, k)], chest: [0.08, -0.36 + 0.24 * k, 0.08 * k], head: [-0.16 * k, -0.18 * k, -0.24 * k],
      handO: [0.14, 1.3, 0.46], elbowO: [1, 0, 0.2],
      footT: [-0.52, 0.08, 0.06 + 0.32 * k], footO: [0.2, 0.08, -0.18], kneeT: [-0.7, 0, 1], kneeO: [0.3, 0, 1],
    }),
    fin: (f, c) => ({
      root: -0.3 + 0.03 * f, pelvis: [0, -0.14, 0.08], spine: [0.54, -0.1, 0.34], chest: [0.08, -0.08, 0.08], head: [-0.18, -0.18, -0.24],
      dT: [0.06, -0.04, 0.18], elbowT: [-0.5, -0.4, 0.4], palmT: { normal: [0.2, -0.5, 0.85], fingers: [0.15, -0.3, 1] },
      handO: [0.18, 1.28, 0.44], elbowO: [1, 0, 0.2],
      footT: [-0.52, 0.08, 0.38], footO: [0.2, 0.08, -0.18], kneeT: [-0.7, 0, 1], kneeO: [0.3, 0, 1],
    }),
  },
  btl: {
    // down in a wide straddle, knees out, head down to see it go through
    win: (k, c) => ({
      root: -0.24 * sm(0, 0.7, k), pelvis: [0.1 * k, 0, 0], spine: [0.3 + 0.38 * sm(0, 0.8, k), 0, 0], chest: [0.14 * k, -0.1 * k, 0], head: [0.2 * k, 0, 0],
      handO: [0.34, 0.78, 0.3], elbowO: [1, -0.2, 0.2], palmO: { normal: [0, -1, 0.2], fingers: [-0.2, 0, 1] },
      footO: [0.36, 0.08, -0.02], footT: [-0.36, 0.08, 0.02], kneeO: [0.9, 0, 0.5], kneeT: [-0.9, 0, 0.5], wide: 1,
    }),
    fin: (f, c) => ({
      root: -0.24 + 0.08 * f, pelvis: [0.1, 0, 0], spine: [0.66 - 0.12 * f, 0, 0], chest: [0.12, -0.06, 0], head: [0.32, 0, 0],
      dT: [0.02, -0.04, -0.14], elbowT: [-0.5, -0.6, 0.5], palmT: { normal: [0, -0.2, -1], fingers: [0, -1, -0.2] },
      handO: [0.34, 0.8, 0.3], elbowO: [1, -0.2, 0.2], palmO: { normal: [0, -1, 0.2], fingers: [-0.2, 0, 1] },
      footO: [0.36, 0.08, -0.02], footT: [-0.36, 0.08, 0.02], kneeO: [0.9, 0, 0.5], kneeT: [-0.9, 0, 0.5], wide: 1,
    }),
  },
  shoulder: {
    // blind: eyes still ahead, the free arm still out in front as if he's going on, the flip up and back over the shoulder
    win: (k, c) => ({
      root: -0.05, pelvis: [0, 0, 0], spine: [0.1 - 0.16 * k, 0, 0.05 * k], chest: [-0.04 * k, -0.22 * k, 0.04 * k], head: [-0.06 * k, 0.12 * k, 0],
      handO: [0.3, 1.22, 0.52], elbowO: [0.8, -0.4, 0.4],
      footO: [0.15, 0.08, 0.16 * k], footT: [-0.15, 0.08, -0.04],
    }),
    fin: (f, c) => ({
      root: -0.05, pelvis: [0, 0, 0], spine: [-0.04, 0, 0.06], chest: [-0.06, -0.24, 0.04], head: [-0.06, 0.12, 0],
      dT: [-0.02, 0.06, -0.08], elbowT: [-0.4, 1, 0.5], palmT: { normal: [-0.1, 0.25, -1], fingers: [0, 1, -0.3] },
      handO: [0.32, 1.26, 0.54], elbowO: [0.8, -0.4, 0.4],
      footO: [0.15, 0.08, 0.16], footT: [-0.15, 0.08, -0.04],
    }),
  },
  elbow: {
    // the behind-the-back fake, the far arm cocked in a chicken wing (hand on the hip, elbow out behind him); the elbow
    // pops back into the ball as it comes round, the trunk snapping round with it
    win: (k, c) => ({
      root: -0.08, pelvis: [0, 0.1 * k, 0], spine: [0.16, 0, 0.04 * k], chest: [0.04, -0.5 * sm(0, 0.72, k) + 0.5 * sm(0.78, 1, k), 0], head: [0, 0.2 * k, 0],
      handO: [0.28 - 0.03 * sm(0.75, 1, k), 1.12 + 0.03 * sm(0.75, 1, k), -0.02 + 0.1 * sm(0.75, 1, k)], elbowO: [0.8, 0, -1 - 0.6 * sm(0.75, 1, k)],
      palmO: { normal: [-1, 0, 0.2], fingers: [0, -1, 0.3] },
      footO: [0.24, 0.08, 0.08], footT: [-0.16, 0.08, -0.06],
    }),
    fin: (f, c) => ({
      root: -0.08, pelvis: [0, 0.14, 0], spine: [0.14, 0, 0.02], chest: [0.04, 0.12 + 0.12 * f, 0], head: [0, 0.3, 0],
      dT: [0.02, 0, 0], elbowT: [-0.6, -0.1, -1], palmT: { normal: [1, -0.1, 0.2], fingers: [0.2, -0.4, -0.9] },
      handO: [0.25, 1.15, 0.1], elbowO: [0.8, 0.1, -1.6],
      footO: [0.26, 0.08, 0.1], footT: [-0.16, 0.08, -0.06],
    }),
  },
  spin: {
    // the sling: the ball out at arm's length, the free arm tucked in tight for the turn; on the pivot foot
    win: (k, c) => ({
      root: -0.08, pelvis: [0, 0, 0], spine: [0.14, 0, -0.06 * k], chest: [0.02, 0.12 * k, 0], head: [0, 0.22 * k, 0],
      handO: [0.12, 1.38, 0.26], elbowO: [1, -0.4, 0], palmO: { normal: [-1, 0, 0], fingers: [0, 1, 0] },
      footO: [0.06, 0.08, 0.03], footT: [-0.3, 0.1 + 0.04 * k, -0.06],
    }),
    fin: (f, c) => ({
      root: -0.08, pelvis: [0, 0, 0], spine: [0.12, 0, -0.04], chest: [0.02, lerp(0.12, -0.2, f), 0], head: [0, 0.1, 0],
      handT: [-0.16, 1.34, 0.6], elbowT: [-0.8, -0.3, 0.3], palmT: { normal: [0.1, -0.6, 0.8], fingers: [0.1, -0.2, 1] },
      handO: [0.56, 1.22, -0.02], elbowO: [1, -0.2, -0.2],
      footO: [0.06, 0.08, 0.03], footT: [-0.3, 0.12, -0.06],
    }),
  },
  bullet: {
    // cocked by the ear straight out of the dribble, a long step in with the other foot, the free arm thrown back
    win: (k, c) => ({
      root: -0.06 - 0.06 * k, pelvis: [0, -0.14 * k, 0], spine: [0.1 + 0.2 * sm(0.4, 1, k), 0, 0], chest: [0.04, -0.38 * sm(0, 0.55, k) + 0.5 * sm(0.55, 1, k), 0], head: [0.02, 0, 0],
      handO: [0.36, 1.14, -0.16 + 0.1 * (1 - k)], elbowO: [0.6, -0.3, -1],
      footO: [0.15, 0.08, 0.12 + 0.3 * k], footT: [-0.15, 0.08, -0.16], kneeO: [0.2, 0, 1],
    }),
    fin: (f, c) => ({
      root: -0.13, pelvis: [0, -0.16, 0], spine: [0.32, 0, 0], chest: [0.06, 0.16, 0], head: [0.04, 0, 0],
      handT: [-0.06 + 0.7 * Math.sin(c.th), 1.42, 0.72 * Math.max(0.5, Math.cos(c.th))], elbowT: [-0.3, -0.6, 0.4], palmT: { normal: [Math.sin(c.th) * 0.4, -0.8, 0.5], fingers: [Math.sin(c.th) * 0.6, -0.4, 1] },
      handO: [0.38, 1.12, -0.22], elbowO: [0.6, -0.3, -1],
      footO: [0.15, 0.08, 0.44], footT: [-0.15, 0.08, -0.18], kneeO: [0.2, 0, 1],
    }),
  },
  overhead: {
    // up and back behind the head (a little arch), flicked over the top with a snap forward; the free hand points the way
    win: (k, c) => ({
      root: -0.04, pelvis: [0, 0, 0], spine: [0.02 - 0.16 * sm(0, 0.65, k) + 0.3 * sm(0.65, 1, k), 0, 0], chest: [-0.08 * sm(0, 0.65, k) + 0.1 * sm(0.65, 1, k), 0, 0], head: [-0.1 * k, 0, 0],
      handO: [0.28 + 0.3 * Math.sin(c.th), 1.6, 0.5], elbowO: [0.6, -0.6, -0.2], palmO: { normal: [0, -0.3, 1], fingers: [Math.sin(c.th) * 0.5, 0.3, 1] },
      footO: [0.15, 0.08, 0.1 * k], footT: [-0.15, 0.08, -0.04],
    }),
    fin: (f, c) => ({
      root: -0.05, pelvis: [0, 0, 0], spine: [0.16, 0, 0], chest: [0.06, 0, 0], head: [-0.08, 0, 0],
      handT: [-0.12 + 0.3 * Math.sin(c.th), 1.98, 0.5], elbowT: [-0.5, 0.2, 0.6], palmT: { normal: [0, -0.7, 0.7], fingers: [0, -0.4, 1] },
      handO: [0.3 + 0.32 * Math.sin(c.th), 1.64, 0.54], elbowO: [0.6, -0.6, -0.2], palmO: { normal: [0, -0.3, 1], fingers: [Math.sin(c.th) * 0.5, 0.3, 1] },
      footO: [0.15, 0.08, 0.12], footT: [-0.15, 0.08, -0.04],
    }),
  },
};
export const OP_POSES = STY;

// ---- the state the Animator keeps for the pass in hand (an._op) ----
function stateFor(an, a) {
  const o = a.op, m = o.hand === 'L' ? -1 : 1;
  return an._op = { id: a.id, a, style: o.style, hand: o.hand, m, th: o.th * m, ls: (o.look || 1) * m, spin: o.spin || 0, type: a.ptype, relAt: null, vf: o.f0, vfRel: null, cutAt: null, done: false, handRel: null, last: null };
}

// 1) the body's facing this frame (absolute radians), or null when there's no Oprah pass on. Before the release it is
// the sim's own (oprahFacing, which the ball's path is in); after it, the turn back to the sim's facing, or the rest
// of the Spin Dish's full turn
export function opFacing(an, a, f) {
  let S = an._op;
  if (a && a.type === 'pass' && a.op) {
    if (!S || S.id !== a.id) S = stateFor(an, a);
    S.a = a;
    if (!a.released) { S.vf = oprahFacing(a); an._opF = S.vf; return S.vf; }
  } else if (!S || S.done) { an._opF = null; return null; }
  else if (S.relAt == null) { S.done = true; an._opF = null; return null; } // (never saw it go, a figure off screen: no stale finish)
  else if (a && S.cutAt == null) S.cutAt = an.time; // something else started: wind it up quickly
  if (S.relAt == null) { S.relAt = an.time; S.vfRel = S.a && S.a.op ? oprahFacing(atRelease(S.a)) : S.vf; }
  const since = an.time - S.relAt;
  let vf;
  if (S.spin) {
    const u = Math.min(1, since / OP_FINISH.spin);
    vf = S.vfRel + S.spin * TAU * (1 - (1 - u) * (1 - u)) + wrap(f - S.vfRel) * sm(0.24, OP_FINISH.spin + 0.06, since);
  } else { const big = Math.min(1, Math.abs(wrap(f - S.vfRel)) / Math.PI); vf = S.vfRel + wrap(f - S.vfRel) * sm(OP_FINISH.back[0], OP_FINISH.back[1] + 0.18 * big, since); }
  if (S.cutAt != null) vf += wrap(f - vf) * sm(0, OP_FINISH.cut, an.time - S.cutAt);
  const over = S.cutAt != null ? an.time - S.cutAt >= OP_FINISH.cut : since >= Math.max(OP_FINISH.back[1] + 0.18, OP_FINISH.spin + 0.06) && since >= OP_FINISH.hold + OP_FINISH.out;
  if (over) { S.done = true; an._opF = null; return null; }
  S.vf = vf; an._opF = vf;
  return vf;
}

// the action as it was at the release (k = 1: the end of the path), whenever the sim actually let go
const atRelease = a => ({ ...a, t: Math.max(a.t, a.rel) });

// the throwing hand's wrist on a ball at b (reference units, body frame): on the shoulder's side of it, a palm's width
// off (the arm reaching to it); the palm on it, the fingers round it
function wristOn(an, T, S, b) {
  const s = an.s, H = an.H, r = BALL_R / s, d = an.view?.model?.d, sg = S.hand === 'L' ? 1 : -1;
  const body = { c: T[P.root + 1], sp: T[P.spine], cp: T[P.chest], tw: T[P.chest + 1] + T[P.spine + 1] };
  const sh = trunkPoint(H, body, [sg * (d ? d.shoulderX : 0.094 * H), 0.099 * H, -0.008 * H]);
  const n = norm([b[0] - sh[0] / s, b[1] - sh[1] / s, b[2] - sh[2] / s]), gap = r + 0.07;
  const up = Math.abs(n[1]) > 0.8 ? [0, 0, 1] : [0, 1, 0], dd = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  return { w: [b[0] - n[0] * gap, b[1] - n[1] * gap, b[2] - n[2] * gap], n, fingers: norm([up[0] - n[0] * dd, up[1] - n[1] * dd, up[2] - n[2] * dd]) };
}

// how far into the finish, and how much of the style is on (0..1)
function phase(an, S, a) {
  if (S.relAt == null || (a && !a.released)) { const k = a ? opK(a) : 1; return { k, since: 0, f: 0, w: sm(0, 0.4, k) }; }
  const since = an.time - S.relAt;
  let w = 1 - sm(OP_FINISH.hold, OP_FINISH.hold + OP_FINISH.out, since);
  if (S.cutAt != null) w *= 1 - sm(0, OP_FINISH.cut, an.time - S.cutAt);
  return { k: 1, since, f: sm(0, OP_FINISH.in, since), w };
}

function ctxOf(an, S, p) {
  const gi = an.gaitInfo || { wGait: 0 };
  return { th: S.th, lob: S.type === 'lob' || S.type === 'alley', bnc: S.type === 'bounce', ls: S.ls, stand: 1 - Math.min(1, gi.wGait * 1.3) };
}

// mirrored writes: 'T' = the throwing side, 'O' = the other; x, yaw and roll flip for a left hand
function writer(T, S, w) {
  const m = S.m, T1 = S.hand, O1 = T1 === 'R' ? 'L' : 'R';
  const g = n => n.replace(/T$/, T1).replace(/O$/, O1);
  return {
    v3(n, v, k = w) { if (!v || k <= 0) return; const o = P[g(n)]; T[o] += (m * v[0] - T[o]) * k; T[o + 1] += (v[1] - T[o + 1]) * k; T[o + 2] += (v[2] - T[o + 2]) * k; },
    ang(n, v, k = w) { if (!v || k <= 0) return; const o = P[n]; T[o] += (v[0] - T[o]) * k; T[o + 1] += (m * v[1] - T[o + 1]) * k; T[o + 2] += (m * v[2] - T[o + 2]) * k; },
    palm(an, side, pm, k = 1) { if (!pm) return; an.palm[side === 'T' ? T1 : O1] = { normal: [m * pm.normal[0], pm.normal[1], pm.normal[2]], fingers: [m * pm.fingers[0], pm.fingers[1], pm.fingers[2]], w: 0.85 * k }; },
  };
}

// apply one style frame (q: win or fin output) at weight w
function apply(an, T, S, q, w, stand, opts = {}) {
  const W = writer(T, S, w);
  T[P.root + 1] += (q.root - T[P.root + 1]) * w;
  W.ang('pelvis', q.pelvis); W.ang('spine', q.spine); W.ang('chest', q.chest); W.ang('head', q.head);
  if (!opts.skipOff) { W.v3('handO', q.handO); W.v3('elbowO', q.elbowO); if (q.palmO) W.palm(an, 'O', q.palmO, w); }
  // the feet only where he's planted (on the run the stride carries on under the pass); the straddle goes down anyway
  const fw = w * (q.wide ? Math.max(stand, 0.6) : stand);
  W.v3('footT', q.footT, fw); W.v3('footO', q.footO, fw); W.v3('kneeT', q.kneeT, fw); W.v3('kneeO', q.kneeO, fw);
  if (fw > 0 && q.footT && q.footO) {
    // (the planted feet's spots follow, so they don't step back when the pass is over)
    for (const [k, side] of [[0, 'L'], [1, 'R']]) {
      const F = an.feet?.[k]; if (!F || F.wx == null) continue;
      const o = P['foot' + side], s = an.s, c = Math.cos(an.f), sn = Math.sin(an.f);
      F.wx = an.x + (c * T[o] * s + sn * T[o + 2] * s); F.wz = an.z + (-sn * T[o] * s + c * T[o + 2] * s); F.step = null;
    }
  }
}

// 2) the body, from actionPose (the pass action: windup and finish)
export function oprahPose(an, T, a, p, g, b) {
  let S = an._op;
  if (!S || S.id !== a.id) S = stateFor(an, a);
  const St = STY[S.style] || STY.nolook, c = ctxOf(an, S, p), ph = phase(an, S, a);
  if (!a.released) { apply(an, T, S, St.win(ph.k, c), ph.w, c.stand); S.last = St.win(1, c); return; }
  if (!S.relHand) {
    // the moment it goes: the hand is where the ball left it (the end of the style's path), so the finish starts there
    S.relHand = true;
    if (S.style !== 'elbow') { const e = oprahBall(atRelease(a), an.H), q = wristOn(an, T, S, [e[0] / an.s, e[1] / an.s, e[2] / an.s]); S.handRel = [q.w[0] * S.m, q.w[1], q.w[2]]; }
  }
  finish(an, T, S, St, c, ph);
}

// 3) after the pass action is over: the finish runs on to its end (or is cut short by whatever he does next)
export function oprahHold(an, T, p, g, a, has) {
  const S = an._op;
  if (!S || S.done || S.relAt == null) return;
  if ((has || (a && a !== S.a)) && S.cutAt == null) S.cutAt = an.time;
  const St = STY[S.style] || STY.nolook, c = ctxOf(an, S, p), ph = phase(an, S, null);
  if (a && a !== S.a) return; // (another action's pose is its own; the facing still eases back)
  finish(an, T, S, St, c, ph);
}

function finish(an, T, S, St, c, ph) {
  if (ph.w <= 0) return;
  const q0 = S.last || St.win(1, c), q1 = St.fin(ph.f, c), f = ph.f;
  // the trunk and the free arm from the windup's end into the finish
  const mixv = (x, y) => (x && y ? [lerp(x[0], y[0], f), lerp(x[1], y[1], f), lerp(x[2], y[2], f)] : y || x);
  const q = { root: lerp(q0.root, q1.root, f) };
  for (const k of ['pelvis', 'spine', 'chest', 'head', 'handO', 'elbowO', 'footT', 'footO', 'kneeT', 'kneeO']) q[k] = mixv(q0[k], q1[k]);
  q.palmO = q1.palmO; q.wide = q1.wide;
  apply(an, T, S, q, ph.w, c.stand);
  // the throwing hand: on from where it let the ball go (S.handRel, the body frame), along the throw
  const W = writer(T, S, ph.w), hr = S.handRel;
  if (hr) {
    const d = q1.dT || [0, 0, 0], A = q1.handT;
    const tgt = A ? [lerp(hr[0], A[0], f), lerp(hr[1], A[1], f), lerp(hr[2], A[2], f)] : [hr[0] + d[0] * f, hr[1] + d[1] * f, hr[2] + d[2] * f]; // (author space, like everything here)
    W.v3('handT', tgt); W.v3('elbowT', q1.elbowT); W.palm(an, 'T', q1.palmT, ph.w);
  }
}

// 4) the hand on the ball up to the release (from ballHands): the throwing hand's wrist on the shoulder's side of the
// ball (the arm reaching to it), the palm on it; a two-hand hold at the press peels the other hand off as it goes
export function oprahHands(an, T, p, a, b) {
  let S = an._op;
  if (!S || S.id !== a.id) S = stateFor(an, a);
  const k = opK(a), r = BALL_R / an.s;
  const hand = oprahHand(a, k), H1 = S.hand, sg = H1 === 'L' ? 1 : -1;
  if (hand) {
    const q = wristOn(an, T, S, b), wr = q.w;
    T[P['hand' + H1]] = wr[0]; T[P['hand' + H1] + 1] = wr[1]; T[P['hand' + H1] + 2] = wr[2];
    an.palm[H1] = { normal: q.n, fingers: q.fingers, w: 0.9 };
    S.handRel = [wr[0] * S.m, wr[1], wr[2]]; // (author space: x un-mirrored; the writer mirrors it back)
  } else if (S.handRel) {
    // (the elbow pass: off his fingers behind his back, the hand stays there while the ball goes on to the elbow)
    T[P['hand' + H1]] = S.handRel[0] * S.m; T[P['hand' + H1] + 1] = S.handRel[1]; T[P['hand' + H1] + 2] = S.handRel[2];
    an.palm[H1] = { normal: [-sg, 0, -0.2], fingers: [0, -0.4, -1], w: 0.7 };
  }
  // the elbow pole for the throwing arm: out and back for the wraps behind him, down and out otherwise
  const st = S.style, m = S.m, eT = st === 'btb' || st === 'elbow' ? [-0.7, -0.2, -1] : st === 'shoulder' || st === 'overhead' ? [-0.5, 0.6, 0.4] : st === 'btl' ? [-0.6, -0.5, 0.6] : st === 'spin' || st === 'wrap' ? [-0.6, -0.6, -0.2] : [-0.6, -0.6, 0.2];
  const eo = P['elbow' + H1]; T[eo] = m * eT[0]; T[eo + 1] = eT[1]; T[eo + 2] = eT[2];
  // the other hand: still on the ball where he had it in both, peeling off into the style's own place
  if (a.op.two) {
    const O1 = H1 === 'R' ? 'L' : 'R', so = O1 === 'L' ? 1 : -1, peel = sm(0.05, 0.5, k), o = P['hand' + O1];
    const on = [b[0] + so * (r + 0.075), b[1] - 0.03, b[2] - 0.07];
    T[o] = lerp(on[0], T[o], peel); T[o + 1] = lerp(on[1], T[o + 1], peel); T[o + 2] = lerp(on[2], T[o + 2], peel);
    if (peel < 0.6) an.palm[O1] = { normal: [-so, 0.05, 0.2], fingers: [0, 0.75, 0.65], w: 0.85 * (1 - peel) };
  }
}

// 5) the head and eyes: at the man (most), the other way (the no-look's lie), still ahead (the blind flip over the
// shoulder), down through his legs (the straddle). look: [x, y, z] in the body frame (meters), w: the look weight
export function oprahLook(an, a, p, g) {
  const S = an._op;
  if (!S || S.done || !(a ? a.type === 'pass' && a.op && a.id === S.id : S.relAt != null)) return null;
  const st = S.style, s = an.s, since = S.relAt == null ? 0 : an.time - S.relAt;
  const fade = 1 - sm(OP_FINISH.hold, OP_FINISH.hold + OP_FINISH.out, since);
  if (st === 'nolook') { const ang = S.ls * 1.4; return { look: [Math.sin(ang) * 5, 1.75, Math.cos(ang) * 5], w: 0.9 * fade + 0.1 }; }
  if (st === 'shoulder') return { look: [0, 1.7, 6], w: 0.9 };
  if (st === 'btl') return { look: [0, 0.2, 1.2], w: 0.5 * fade };
  if (st === 'spin' && S.relAt != null) return { look: [0, 1.6, 5], w: 0.3 };
  // the man: where he is (court-local, the game proxy's world offset if there is one)
  const q = g?.players?.[(a || S.a).to];
  if (!q) return null;
  const wq = g.worldOf ? g.worldOf(q) : q, out = [0, 0, 0];
  an.toLocal(wq.x, 1.5, wq.z, out);
  return { look: out, w: 0.85 * fade + 0.1 };
}
