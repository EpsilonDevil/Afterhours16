// The rig: a pose vector (char/pose.js) solved onto the skeleton (char/skeleton.js) and turned into skin matrices.
//   FK spine and neck with an optional look-at; analytic two-bone IK for the legs and arms; the limb clearance that
//   keeps knees, feet, hands and arms out of each other and out of the torso and head; palm orientation.
// Owned by AthleteView (char/view.js), which calls solve() then updateSkin() every frame a player is posed; the
// animator (char/animator.js) produces the pose. Render-only: nothing in the sim reads it.
// (QOL+perf: solve() runs for every posed player every frame, so its inner loops work in preallocated scratch vectors
// instead of fresh arrays; the arithmetic, its order and every result are exactly as before.)
import { B, BONES, ARM_ANGLE } from './skeleton.js';
import { P } from './pose.js';
import * as M from '../core/math.js';
import { torsoTableInto } from './athlete.js';

// ---------- vector helpers ----------
const _skinM = M.m4(), _skinL = M.m4(); // (updateSkin's two scratch matrices)
const tmpQ = M.q4(), tmpQ2 = M.q4();
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function qrot(q, v) { const o = [0, 0, 0]; M.v3transformQuat(o, v, q); return o; }
// (the same three, writing into `o`)
function normTo(o, x, y, z) { const l = Math.hypot(x, y, z) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; return o; }
function crossTo(o, a, b) { const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0]; o[0] = x; o[1] = y; o[2] = z; return o; }
function qrotTo(o, q, x, y, z) { _qv[0] = x; _qv[1] = y; _qv[2] = z; return M.v3transformQuat(o, _qv, q); }
const _qv = [0, 0, 0], _tv = [0, 0, 0], _tt = [0, 0, 0, 0, 0];

// Quaternion from orthonormal basis columns (x,y,z)
function quatFromBasis(out, x, y, z) {
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; out[3] = 0.25 * s; out[0] = (m21 - m12) / s; out[1] = (m02 - m20) / s; out[2] = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; out[3] = (m21 - m12) / s; out[0] = 0.25 * s; out[1] = (m01 + m10) / s; out[2] = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; out[3] = (m02 - m20) / s; out[0] = (m01 + m10) / s; out[1] = 0.25 * s; out[2] = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; out[3] = (m10 - m01) / s; out[0] = (m02 + m20) / s; out[1] = (m12 + m21) / s; out[2] = 0.25 * s; }
  return M.qnorm(out, out);
}
// the orthonormal frame of an axis `a` and a normal `n` (n made perpendicular to a) into x, y, z
function basisInto(x, y, z, a, n) {
  normTo(x, a[0], a[1], a[2]);
  normTo(z, n[0], n[1], n[2]);
  const d = dot(z, x);
  normTo(z, z[0] - x[0] * d, z[1] - x[1] * d, z[2] - x[2] * d);
  crossTo(y, z, x);
}
// Rotation mapping frame (a0,n0) → (a1,n1)
const _bx = [0, 0, 0], _by = [0, 0, 0], _bz = [0, 0, 0], _fq0 = M.q4(), _fq1 = M.q4(), _fqi = M.q4();
function frameRot(out, a0, n0, a1, n1) {
  basisInto(_bx, _by, _bz, a0, n0);
  const q0 = quatFromBasis(_fq0, _bx, _by, _bz);
  basisInto(_bx, _by, _bz, a1, n1);
  const q1 = quatFromBasis(_fq1, _bx, _by, _bz);
  return M.qmul(out, q1, M.qinvert(_fqi, q0));
}

// v0.4.7.5 qp3 limb clearance (Rig.armClear): forearm samples inside this share of the padded torso column count as
// inside the body; the hand target moves forward by ARM_CLEAR_STEP x H a time, up to ARM_CLEAR_ITERS times
export const ARM_CLEAR_TORSO = 0.82, ARM_CLEAR_STEP = 0.04, ARM_CLEAR_ITERS = 8;
// the least distance (x H) between the two forearms' centrelines: two forearms' thickness
export const ARM_CROSS_GAP = 0.056;
// the head's radius (x H) for the arm probes: a little under the hand's (0.07 H), so an upper arm beside the ear is fine
export const ARM_HEAD_R = 0.084;
// the least distance (x H) between a forearm's centreline and a thigh's / a shin's: the leg's radius plus the arm's
export const LEG_CLEAR_THIGH = 0.082, LEG_CLEAR_SHIN = 0.068;
// the least distance between two segments p1-q1 and p2-q2
// (scalars, not arrays: the arm clearance calls it a few hundred times a frame)
export function segSegDist(p1, q1, p2, q2) {
  const d1x = q1[0] - p1[0], d1y = q1[1] - p1[1], d1z = q1[2] - p1[2];
  const d2x = q2[0] - p2[0], d2y = q2[1] - p2[1], d2z = q2[2] - p2[2];
  const rx = p1[0] - p2[0], ry = p1[1] - p2[1], rz = p1[2] - p2[2];
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let sc = 0, tc = 0;
  if (a > 1e-9 && e > 1e-9) {
    const c = d1x * rx + d1y * ry + d1z * rz, b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
    sc = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
    tc = (b * sc + f) / e;
    if (tc < 0) { tc = 0; sc = Math.max(0, Math.min(1, -c / a)); } else if (tc > 1) { tc = 1; sc = Math.max(0, Math.min(1, (b - c) / a)); }
  } else if (e > 1e-9) tc = Math.max(0, Math.min(1, f / e));
  const x = p1[0] + d1x * sc - p2[0] - d2x * tc, y = p1[1] + d1y * sc - p2[1] - d2y * tc, z = p1[2] + d1z * sc - p2[2] - d2z * tc;
  return Math.hypot(x, y, z);
}
// where the arm is probed against the torso column, as [share of the segment, the r2 it must keep]: the padded
// column's r2 is 1 at an arm's radius outside the skin and ~0.6 at the skin itself; a hanging upper arm sits in the
// shoulder's own mass (r2 ~0.6-0.7 along its first half), so it is held only from its middle and only to the skin
export const ARM_PROBE_UPPER = [[0.5, 0.5], [0.65, 0.6], [0.8, 0.72], [1.0, ARM_CLEAR_TORSO]];
export const ARM_PROBE_FORE = [[0.15, ARM_CLEAR_TORSO], [0.32, ARM_CLEAR_TORSO], [0.49, ARM_CLEAR_TORSO], [0.66, ARM_CLEAR_TORSO], [0.83, ARM_CLEAR_TORSO], [1.0, ARM_CLEAR_TORSO]];

export class Rig {
  constructor(model) {
    this.model = model;
    const d = model.d;
    this.d = d;
    this.s = d.H / 2.0;
    this.off = model.off;
    this.bind = model.bind;
    this.n = BONES.length;
    this.rot = Array.from({ length: this.n }, () => M.q4());
    this.pos = Array.from({ length: this.n }, () => [0, 0, 0]);
    this.skin = new Float32Array(16 * this.n);
    this.world = M.m4();
    const o = this.off;
    this.len = {
      upper: Math.hypot(...o[B.foreL]), fore: Math.hypot(...o[B.handL]),
      thigh: Math.hypot(...o[B.shinL]), shin: Math.hypot(...o[B.footL]),
    };
    const s40 = Math.sin(ARM_ANGLE), c40 = Math.cos(ARM_ANGLE);
    this.armA0 = { L: [norm(o[B.foreL]), norm(o[B.handL])], R: [norm(o[B.foreR]), norm(o[B.handR])] };
    this.armN0 = { L: cross(norm(o[B.foreL]), [0, 0, -1]), R: cross(norm(o[B.foreR]), [0, 0, -1]) };
    this.legA0 = { L: [norm(o[B.shinL]), norm(o[B.footL])], R: [norm(o[B.shinR]), norm(o[B.footR])] };
    this.legN0 = { L: cross(norm(o[B.shinL]), [0, 0, 1]), R: cross(norm(o[B.shinR]), [0, 0, 1]) };
    this.palm0 = { L: [-c40, -s40, 0], R: [c40, -s40, 0] };
    this.handA0 = { L: [s40, -c40, 0], R: [-s40, -c40, 0] };
    this.elbowPos = { L: [0, 0, 0], R: [0, 0, 0] };
    this.reach = { L: 0, R: 0 };
  }

  eulerQ(out, p, i) { return M.qeuler(out, p[i], p[i + 1], p[i + 2]); }

  chainFK(bone, parentBone, localQ) {
    const pr = this.rot[parentBone], pp = this.pos[parentBone];
    M.qmul(this.rot[bone], pr, localQ);
    const o = qrot(pr, this.off[bone]);
    this.pos[bone][0] = pp[0] + o[0]; this.pos[bone][1] = pp[1] + o[1]; this.pos[bone][2] = pp[2] + o[2];
  }

  // opts: {look:[x,y,z] char-space point, lookW, palmL:{normal, fingers}, palmR}
  solve(pose, opts = {}) {
    const s = this.s, d = this.d;
    const hips = this.pos[B.hips];
    const rH = this.rot[B.hips];
    this.eulerQ(rH, pose, P.pelvis);
    hips[0] = pose[P.root] * s; hips[1] = this.bind[B.hips][1] + pose[P.root + 1] * s; hips[2] = pose[P.root + 2] * s;
    // pelvis auto-drop so grounded feet can be reached
    const maxL = (this.len.thigh + this.len.shin) * 0.995;
    let drop = 0;
    for (const side of ['L', 'R']) {
      const fo = P['foot' + side];
      const hj = qrot(rH, this.off[B['thigh' + side]]);
      const A = [pose[fo] * s, pose[fo + 1] * s, pose[fo + 2] * s];
      const hx = hips[0] + hj[0] - A[0], hz = hips[2] + hj[2] - A[2], dy = hips[1] + hj[1] - A[1];
      const h2 = hx * hx + hz * hz;
      if (h2 < maxL * maxL) { const need = dy - Math.sqrt(maxL * maxL - h2); if (need > drop) drop = need; }
    }
    hips[1] -= Math.min(drop, 0.35 * d.H);
    // spine chain
    this.chainFK(B.spine, B.hips, this.eulerQ(tmpQ, pose, P.spine));
    this.chainFK(B.chest, B.spine, this.eulerQ(tmpQ, pose, P.chest));
    let neckQ = this.eulerQ(M.q4(), pose, P.neck), headQ = this.eulerQ(M.q4(), pose, P.head);
    if (opts.look && opts.lookW > 0) {
      // direction to target in chest frame
      const c = this.pos[B.chest];
      const headPos = [c[0], c[1] + 0.17 * d.H, c[2]];
      const dir = norm([opts.look[0] - headPos[0], opts.look[1] - headPos[1], opts.look[2] - headPos[2]]);
      const inv = M.qinvert(M.q4(), this.rot[B.chest]);
      const ld = qrot(inv, dir);
      let yaw = Math.atan2(ld[0], ld[2]), pitch = -Math.atan2(ld[1], Math.hypot(ld[0], ld[2]));
      yaw = M.clamp(yaw, -1.25, 1.25) * opts.lookW; pitch = M.clamp(pitch, -0.6, 0.7) * opts.lookW;
      M.qmul(neckQ, neckQ, M.qeuler(tmpQ2, pitch * 0.35, yaw * 0.4, 0));
      M.qmul(headQ, headQ, M.qeuler(tmpQ2, pitch * 0.65, yaw * 0.6, 0));
    }
    this.chainFK(B.neck, B.chest, neckQ);
    this.chainFK(B.head, B.neck, headQ);
    // legs (v0.4.7.5: the feet are kept a shin's width apart, so the legs never pass through each other, and the
    // knees swing out round the hip-ankle line when they'd knock)
    const FT = this.footTargets(pose), KP = this.kneePoles(pose, hips, rH, FT);
    for (const side of ['L', 'R']) {
      const th = B['thigh' + side], sh = B['shin' + side], ft = B['foot' + side], toe = B['toe' + side];
      const hj = qrot(rH, this.off[th]);
      const Hj = [hips[0] + hj[0], hips[1] + hj[1], hips[2] + hj[2]];
      const ki = P['knee' + side];
      const T = FT[side];
      const { E, W, n } = this.twoBone(Hj, T, this.len.thigh, this.len.shin, KP[side] || [pose[ki], pose[ki + 1], pose[ki + 2]]);
      const a0 = this.legA0[side], n0 = this.legN0[side];
      frameRot(this.rot[th], a0[0], n0, norm([E[0] - Hj[0], E[1] - Hj[1], E[2] - Hj[2]]), n);
      this.pos[th][0] = Hj[0]; this.pos[th][1] = Hj[1]; this.pos[th][2] = Hj[2];
      frameRot(this.rot[sh], a0[1], n0, norm([W[0] - E[0], W[1] - E[1], W[2] - E[2]]), n);
      const ks = qrot(this.rot[th], this.off[sh]);
      this.pos[sh][0] = Hj[0] + ks[0]; this.pos[sh][1] = Hj[1] + ks[1]; this.pos[sh][2] = Hj[2] + ks[2];
      const af = qrot(this.rot[sh], this.off[ft]);
      this.pos[ft][0] = this.pos[sh][0] + af[0]; this.pos[ft][1] = this.pos[sh][1] + af[1]; this.pos[ft][2] = this.pos[sh][2] + af[2];
      M.qeuler(this.rot[ft], pose[P['pitch' + side]], pose[P['yaw' + side]], 0);
      this.chainFK(toe, ft, M.qaxis(tmpQ, 1, 0, 0, pose[P['toe' + side]]));
    }
    // arms (v0.4.7.5 qp3: solved after the legs, so an arm is kept off a raised thigh too; each solved by solveArm, then,
    // where the two forearms would pass through each other, the second hand's target moves forward and its arm is
    // solved again, so crossing arms pass in front of one another)
    const chestInv = M.qinvert(M.q4(), this.rot[B.chest]);
    const armT = { L: null, R: null };
    for (const side of ['L', 'R']) armT[side] = this.solveArm(side, pose, opts, chestInv);
    const mv = opts.pinR && !opts.pinL ? 'L' : opts.pinR && opts.pinL ? null : 'R'; // (the hand that moves: never one on the ball)
    for (let it = 0; mv && it < ARM_CLEAR_ITERS; it++) {
      const gap = ARM_CROSS_GAP * this.d.H, dd = segSegDist(this.pos[B.foreL], this.pos[B.handL], this.pos[B.foreR], this.pos[B.handR]);
      if (dd >= gap) break;
      const f = qrot(this.rot[B.chest], [0, 0, 1]), step = gap - dd + 0.01 * this.d.H;
      armT[mv][0] += f[0] * step; armT[mv][1] += f[1] * step; armT[mv][2] += f[2] * step;
      this.solveArm(mv, pose, opts, chestInv, armT[mv]);
    }
  }


  // one arm: the clavicle, then the two-bone IK to the hand target (the pose's, or `T0` as given), kept out of the
  // torso and the head (see the arm-clearance loop). Returns the hand target it ended with.
  solveArm(side, pose, opts, chestInv, T0 = null) {
    const s = this.s;
    const clav = B['clav' + side], up = B['upper' + side], fo = B['fore' + side], ha = B['hand' + side];
    this.chainFK(clav, B.chest, this.eulerQ(tmpQ, pose, P['clav' + side]));
    const S = [0, 0, 0];
    const o = qrot(this.rot[clav], this.off[up]);
    S[0] = this.pos[clav][0] + o[0]; S[1] = this.pos[clav][1] + o[1]; S[2] = this.pos[clav][2] + o[2];
    const hi = P['hand' + side], ei = P['elbow' + side];
    const T = T0 ? T0.slice() : [pose[hi] * s, pose[hi + 1] * s, pose[hi + 2] * s];
    // v0.4.7.5 limb collisions: the hand never goes inside the head
    this.clearHead(T);
    let pole = [pose[ei], pose[ei + 1], pose[ei + 2]];
    let { E, W, n } = this.twoBone(S, T, this.len.upper, this.len.fore, pole);
    // ...and the arm never goes through the torso or the head (v0.4.7.5; qp3: the whole arm, not only the elbow):
    // first the elbow swings round the shoulder-wrist line to the nearest spot where the upper arm and the forearm
    // both clear the body (the hand stays exactly where it was); where no swing clears (the hand itself across the
    // chest, say), the hand target moves out — forward of the chest, or off the head — and the arm is solved again
    const pinned = !!opts['pin' + side]; // (a hand on the ball stays exactly where it is)
    for (let it = 0; it < ARM_CLEAR_ITERS; it++) {
      if (!this.armPenetration(S, E, W, chestInv)) break;
      const alt = this.elbowOut(S, W, E, side, chestInv);
      if (alt) ({ E, W, n } = this.twoBone(S, T, this.len.upper, this.len.fore, alt.d));
      if (pinned || (alt && alt.clear)) break;
      if (!this.armClear(S, E, W, T, chestInv)) break;
      ({ E, W, n } = this.twoBone(S, T, this.len.upper, this.len.fore, pole));
    }
    this.reach[side] = Math.hypot(T[0] - W[0], T[1] - W[1], T[2] - W[2]);
    const a0 = this.armA0[side], n0 = this.armN0[side];
    frameRot(this.rot[up], a0[0], n0, norm([E[0] - S[0], E[1] - S[1], E[2] - S[2]]), n);
    this.pos[up][0] = S[0]; this.pos[up][1] = S[1]; this.pos[up][2] = S[2];
    frameRot(this.rot[fo], a0[1], n0, norm([W[0] - E[0], W[1] - E[1], W[2] - E[2]]), n);
    const ef = qrot(this.rot[up], this.off[fo]);
    this.pos[fo][0] = S[0] + ef[0]; this.pos[fo][1] = S[1] + ef[1]; this.pos[fo][2] = S[2] + ef[2];
    this.elbowPos[side] = this.pos[fo].slice();
    const hf = qrot(this.rot[fo], this.off[ha]);
    this.pos[ha][0] = this.pos[fo][0] + hf[0]; this.pos[ha][1] = this.pos[fo][1] + hf[1]; this.pos[ha][2] = this.pos[fo][2] + hf[2];
    const palm = opts['palm' + side];
    if (palm && palm.w > 0) {
      const want = frameRot(M.q4(), this.handA0[side], this.palm0[side], palm.fingers, palm.normal);
      const fk = M.qmul(M.q4(), this.rot[fo], this.eulerQ(tmpQ, pose, P['wrist' + side]));
      M.qslerp(this.rot[ha], fk, want, palm.w);
    } else {
      M.qmul(this.rot[ha], this.rot[fo], this.eulerQ(tmpQ, pose, P['wrist' + side]));
    }
    return T;
  }

  // ---- v0.4.7.5 limb collisions ----
  // the torso as an elliptic column round the spine (chest frame), padded by an upper arm's thickness
  // (the cross-section is the model's own at that height: narrow at the waist, broad at the chest)
  // ({x, z}: the point in the column's own units, 1 on its padded surface; null above the neck or below the hips)
  torsoAt(E, chestInv) { const t = this.torsoAtXYZ(E[0], E[1], E[2], chestInv); return t && { x: t.x, z: t.z }; }
  // (the same for a point px, py, pz, into one scratch object: what the per-frame probes use)
  torsoAtXYZ(px, py, pz, chestInv) {
    const H = this.d.H, g = this.d.girth || 1, c = this.pos[B.chest], hy = this.pos[B.hips][1], ny = this.pos[B.neck][1];
    if (py < hy - 0.02 * H || py > ny - 0.01 * H) return null;
    const v = qrotTo(_tv, chestInv, px - c[0], py - c[1], pz - c[2]);
    const tt = torsoTableInto((this.bind[B.chest][1] + v[1]) / H, _tt), rx = tt[0], zf = tt[1], zb = tt[2], zc = tt[3], pad = 0.024 * H;
    const o = this._tq || (this._tq = { x: 0, z: 0 });
    o.x = v[0] / (rx * g * H + pad); o.z = (v[2] - zc * H) / ((v[2] - zc * H >= 0 ? zf : zb) * g * H + pad);
    return o;
  }
  insideTorso(E, chestInv) { const t = this.torsoAtXYZ(E[0], E[1], E[2], chestInv); return !!t && t.x * t.x + t.z * t.z < 1; }
  // the pole that puts the arm outside the torso and the head with the least swing round the shoulder-wrist line:
  // {d: the pole, clear: whether the whole arm clears} (qp3: it used to look at the elbow point alone, so an upper
  // arm could still cut through the chest or the head on its way to a clear elbow)
  elbowOut(S, W, E, side, chestInv) {
    const ax = norm([W[0] - S[0], W[1] - S[1], W[2] - S[2]]);
    const c = [S[0] + ax[0] * dot([E[0] - S[0], E[1] - S[1], E[2] - S[2]], ax), 0, 0];
    const t0 = dot([E[0] - S[0], E[1] - S[1], E[2] - S[2]], ax);
    c[0] = S[0] + ax[0] * t0; c[1] = S[1] + ax[1] * t0; c[2] = S[2] + ax[2] * t0;
    const r0 = [E[0] - c[0], E[1] - c[1], E[2] - c[2]], h = Math.hypot(...r0) || 1e-4;
    const u = norm(r0), w = cross(ax, u);
    let best = null, bv = Infinity;
    for (let k = 1; k <= 12; k++) for (const sg of [1, -1]) {
      const a = sg * k * Math.PI / 12, ca = Math.cos(a), sa = Math.sin(a);
      const d = [u[0] * ca + w[0] * sa, u[1] * ca + w[1] * sa, u[2] * ca + w[2] * sa];
      const P2 = [c[0] + d[0] * h, c[1] + d[1] * h, c[2] + d[2] * h];
      const v = this.armPenetration(S, P2, W, chestInv);
      if (!v) return { d, clear: true };
      if (v < bv) { bv = v; best = d; }
    }
    return best ? { d: best, clear: false } : null; // (nowhere fully clear: as far out of the body as it can get)
  }
  // how far the arm (shoulder S, elbow E, wrist W) sits inside the torso's own surface (ARM_CLEAR_TORSO of the padded
  // column: the pad is an arm's thickness, so that is the skin) or the head: 0 when it clears
  armPenetration(S, E, W, chestInv) {
    let v = 0;
    for (const [k, thr] of ARM_PROBE_UPPER) v = this.penProbe(v, S[0] + (E[0] - S[0]) * k, S[1] + (E[1] - S[1]) * k, S[2] + (E[2] - S[2]) * k, thr, chestInv);
    for (const [k, thr] of ARM_PROBE_FORE) v = this.penProbe(v, E[0] + (W[0] - E[0]) * k, E[1] + (W[1] - E[1]) * k, E[2] + (W[2] - E[2]) * k, thr, chestInv);
    // ...and the forearm and hand against the thighs and shins (a raised knee, a pike)
    for (const [lp, lq, r] of this.legCapsules()) { const dd = segSegDist(E, W, lp, lq); if (dd < r) v += (r - dd) / r; }
    return v;
  }
  // one armPenetration probe: v plus how far the point sits inside the torso (below thr) and inside the head
  penProbe(v, px, py, pz, thr, chestInv) {
    const H = this.d.H, hd = this.pos[B.head], hr = ARM_HEAD_R * H;
    const cx = hd[0], cy = hd[1] + 0.055 * H, cz = hd[2] + 0.01 * H;
    const t = this.torsoAtXYZ(px, py, pz, chestInv);
    if (t) { const r2 = t.x * t.x + t.z * t.z; if (r2 < thr) v += thr - r2; }
    const dd = Math.hypot(px - cx, py - cy, pz - cz);
    if (dd < hr - 0.005 * H) v += (hr - dd) / hr;
    return v;
  }
  torsoDepth(E, chestInv) { const t = this.torsoAtXYZ(E[0], E[1], E[2], chestInv); return t ? -(t.x * t.x + t.z * t.z) : -9; }
  // v0.4.7.5 qp3: the arm (shoulder S, elbow E, wrist W) and the hand T against the torso and the head, when no elbow
  // swing clears it: samples inside the torso's skin move the hand forward of the chest by ARM_CLEAR_STEP; samples
  // inside the head move it away from the head's centre. Returns whether the target moved.
  armClear(S, E, W, T, chestInv) {
    const H = this.d.H, hd = this.pos[B.head], hr = ARM_HEAD_R * H;
    const cx = hd[0], cy = hd[1] + 0.055 * H, cz = hd[2] + 0.01 * H;
    let worstT = 0, headPush = null, outDir = null;
    const probe = (px, py, pz, thr) => {
      const t = this.torsoAtXYZ(px, py, pz, chestInv);
      if (t) { const r2 = t.x * t.x + t.z * t.z; if (r2 < thr && thr - r2 > worstT) { worstT = thr - r2; outDir = { x: t.x, z: t.z }; } }
      const dx = px - cx, dy = py - cy, dz = pz - cz, dd = Math.hypot(dx, dy, dz);
      if (dd < hr - 0.005 * H && dd > 1e-5 && (!headPush || hr - dd > headPush[3])) headPush = [dx / dd, dy / dd, dz / dd, hr - dd];
    };
    for (const [k, thr] of ARM_PROBE_UPPER) probe(S[0] + (E[0] - S[0]) * k, S[1] + (E[1] - S[1]) * k, S[2] + (E[2] - S[2]) * k, thr);
    for (const [k, thr] of ARM_PROBE_FORE) probe(E[0] + (W[0] - E[0]) * k, E[1] + (W[1] - E[1]) * k, E[2] + (W[2] - E[2]) * k, thr);
    // a forearm or hand on a thigh or shin: the hand lifts away from the leg's line
    let legPush = null;
    for (const [lp, lq, r] of this.legCapsules()) {
      const dd = segSegDist(E, W, lp, lq);
      if (dd < r && (!legPush || r - dd > legPush[3])) {
        // away from the leg: from the leg's nearest point to the hand, mostly upward
        const lx = lq[0] - lp[0], ly = lq[1] - lp[1], lz = lq[2] - lp[2], ll = lx * lx + ly * ly + lz * lz || 1e-6;
        const t = Math.max(0, Math.min(1, ((W[0] - lp[0]) * lx + (W[1] - lp[1]) * ly + (W[2] - lp[2]) * lz) / ll));
        const nx = W[0] - (lp[0] + lx * t), ny = W[1] - (lp[1] + ly * t) + 0.02 * H, nz = W[2] - (lp[2] + lz * t), nl = Math.hypot(nx, ny, nz) || 1e-6;
        legPush = [nx / nl, ny / nl, nz / nl, r - dd];
      }
    }
    if (!worstT && !headPush && !legPush) return false;
    if (legPush) { const step = legPush[3] + 0.01 * H; T[0] += legPush[0] * step; T[1] += legPush[1] * step; T[2] += legPush[2] * step; }
    if (worstT) {
      // out through the nearest skin: forward of the chest for an arm across the front, backward for one behind the
      // back, sideways for one along the flank (the probe's own direction from the column's axis, chest frame)
      const dl = Math.hypot(outDir.x, outDir.z) || 1, dir = dl < 0.2 ? [0, 0, 1] : [outDir.x / dl, 0, outDir.z / dl];
      const f = qrot(this.rot[B.chest], dir), step = ARM_CLEAR_STEP * H * Math.min(1, 0.5 + worstT);
      T[0] += f[0] * step; T[1] += f[1] * step; T[2] += f[2] * step;
    }
    if (headPush) { const step = headPush[3] + 0.01 * H; T[0] += headPush[0] * step; T[1] += headPush[1] * step; T[2] += headPush[2] * step; }
    return true;
  }
  // the legs as capsules [from, to, radius + an arm's radius] for the arm clearance (the thigh and the shin of each side)
  // (built once: the joint positions are the rig's own arrays, updated in place by every solve)
  legCapsules() {
    if (this._legCaps) return this._legCaps;
    const H = this.d.H, p = this.pos;
    return (this._legCaps = [[p[B.thighL], p[B.shinL], LEG_CLEAR_THIGH * H], [p[B.shinL], p[B.footL], LEG_CLEAR_SHIN * H], [p[B.thighR], p[B.shinR], LEG_CLEAR_THIGH * H], [p[B.shinR], p[B.footR], LEG_CLEAR_SHIN * H]]);
  }
  // a hand target inside the head is pushed out to its surface
  clearHead(T) {
    const H = this.d.H, hd = this.pos[B.head], r = 0.07 * H;
    const cx = hd[0], cy = hd[1] + 0.055 * H, cz = hd[2] + 0.01 * H;
    const dx = T[0] - cx, dy = T[1] - cy, dz = T[2] - cz, dd = Math.hypot(dx, dy, dz);
    if (dd >= r || dd < 1e-5) return;
    const k = r / dd; T[0] = cx + dx * k; T[1] = cy + dy * k; T[2] = cz + dz * k;
  }
  // knee poles that keep the knees at least a knee's width apart (null: the pose's own)
  kneePoles(pose, hips, rH, FT) {
    const H = this.d.H, min = 0.066 * H, out = { L: null, R: null }, J = {}, K = {};
    for (const side of ['L', 'R']) {
      const hj = qrot(rH, this.off[B['thigh' + side]]), ki = P['knee' + side];
      J[side] = [hips[0] + hj[0], hips[1] + hj[1], hips[2] + hj[2]];
      K[side] = this.twoBone(J[side], FT[side], this.len.thigh, this.len.shin, [pose[ki], pose[ki + 1], pose[ki + 2]]).E;
    }
    let d = Math.hypot(K.L[0] - K.R[0], K.L[1] - K.R[1], K.L[2] - K.R[2]);
    if (d >= min) return out;
    // turn each knee outward (left knee to +x, right to -x) in steps until they clear
    for (let k = 1; k <= 8 && d < min; k++) {
      for (const side of ['L', 'R']) {
        const ki = P['knee' + side], sx = side === 'L' ? 1 : -1;
        const base = [pose[ki], pose[ki + 1], pose[ki + 2]], bl = Math.hypot(...base) || 1;
        out[side] = [base[0] / bl + sx * 0.18 * k, base[1] / bl, base[2] / bl];
        K[side] = this.twoBone(J[side], FT[side], this.len.thigh, this.len.shin, out[side]).E;
      }
      d = Math.hypot(K.L[0] - K.R[0], K.L[1] - K.R[1], K.L[2] - K.R[2]);
    }
    return out;
  }
  // foot targets, nudged apart where they'd overlap
  footTargets(pose) {
    const s = this.s, H = this.d.H, L = P.footL, R = P.footR;
    const a = [pose[L] * s, pose[L + 1] * s, pose[L + 2] * s], b = [pose[R] * s, pose[R + 1] * s, pose[R + 2] * s];
    const min = 0.062 * H, dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2], dd = Math.hypot(dx, dy, dz);
    if (dd < min) {
      // apart sideways (left foot to the left), keeping their heights and how far forward each is
      const push = (min - dd) / 2, sx = dx >= 0 ? 1 : -1;
      const lat = Math.hypot(dx, dz) > 1e-4 ? [dx / Math.hypot(dx, dz), 0, dz / Math.hypot(dx, dz)] : [sx, 0, 0];
      a[0] += lat[0] * push; a[2] += lat[2] * push; b[0] -= lat[0] * push; b[2] -= lat[2] * push;
    }
    return { L: a, R: b };
  }

  twoBone(A, T, l1, l2, pole) {
    let dx = T[0] - A[0], dy = T[1] - A[1], dz = T[2] - A[2];
    let dist = Math.hypot(dx, dy, dz) || 1e-4;
    const dn = [dx / dist, dy / dist, dz / dist];
    dist = M.clamp(dist, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
    const W = [A[0] + dn[0] * dist, A[1] + dn[1] * dist, A[2] + dn[2] * dist];
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    let p = norm(pole);
    const pd = dot(p, dn);
    p = [p[0] - dn[0] * pd, p[1] - dn[1] * pd, p[2] - dn[2] * pd];
    if (Math.hypot(p[0], p[1], p[2]) < 1e-4) p = norm(cross(dn, [1, 0, 0])); else p = norm(p);
    const E = [A[0] + dn[0] * a + p[0] * h, A[1] + dn[1] * a + p[1] * h, A[2] + dn[2] * a + p[2] * h];
    const n = norm(cross(dn, p));
    return { E, W, n };
  }

  // world: character placement matrix (yaw + translation). Fills this.skin.
  updateSkin(world) {
    const m = _skinM, local = _skinL;
    for (let i = 0; i < this.n; i++) {
      const q = this.rot[i], p = this.pos[i], b = this.bind[i];
      M.m4compose(local, p, q);
      // local * T(-bind)
      const bx = -b[0], by = -b[1], bz = -b[2];
      local[12] += local[0] * bx + local[4] * by + local[8] * bz;
      local[13] += local[1] * bx + local[5] * by + local[9] * bz;
      local[14] += local[2] * bx + local[6] * by + local[10] * bz;
      M.m4mul(m, world, local);
      this.skin.set(m, i * 16);
    }
  }

  // Char-space → world-space helper for a bone joint
  jointWorld(world, bone, out = [0, 0, 0]) {
    const p = this.pos[bone];
    out[0] = world[0] * p[0] + world[4] * p[1] + world[8] * p[2] + world[12];
    out[1] = world[1] * p[0] + world[5] * p[1] + world[9] * p[2] + world[13];
    out[2] = world[2] * p[0] + world[6] * p[1] + world[10] * p[2] + world[14];
    return out;
  }
}
