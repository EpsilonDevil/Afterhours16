// Pose → skeleton solve (FK spine, analytic two-bone IK for limbs, look-at, palm orientation) → skin matrices.
import { B, BONES, PARENT, ARM_ANGLE } from './skeleton.js';
import { P } from './pose.js';
import * as M from '../core/math.js';

const tmpQ = M.q4(), tmpQ2 = M.q4();
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function qrot(q, v) { const o = [0, 0, 0]; M.v3transformQuat(o, v, q); return o; }

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
function basis(a, n) { const x = norm(a); let z = norm(n); z = norm([z[0] - x[0] * dot(z, x), z[1] - x[1] * dot(z, x), z[2] - x[2] * dot(z, x)]); return [x, cross(z, x), z]; }
// Rotation mapping frame (a0,n0) → (a1,n1)
function frameRot(out, a0, n0, a1, n1) {
  const [x0, y0, z0] = basis(a0, n0), [x1, y1, z1] = basis(a1, n1);
  const q0 = quatFromBasis(M.q4(), x0, y0, z0), q1 = quatFromBasis(M.q4(), x1, y1, z1);
  return M.qmul(out, q1, M.qinvert(M.q4(), q0));
}

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
    // arms
    for (const side of ['L', 'R']) {
      const clav = B['clav' + side], up = B['upper' + side], fo = B['fore' + side], ha = B['hand' + side];
      this.chainFK(clav, B.chest, this.eulerQ(tmpQ, pose, P['clav' + side]));
      const S = [0, 0, 0];
      const o = qrot(this.rot[clav], this.off[up]);
      S[0] = this.pos[clav][0] + o[0]; S[1] = this.pos[clav][1] + o[1]; S[2] = this.pos[clav][2] + o[2];
      const hi = P['hand' + side], ei = P['elbow' + side];
      const T = [pose[hi] * s, pose[hi + 1] * s, pose[hi + 2] * s];
      const pole = [pose[ei], pose[ei + 1], pose[ei + 2]];
      const { E, W, n } = this.twoBone(S, T, this.len.upper, this.len.fore, pole);
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
    }
    // legs
    for (const side of ['L', 'R']) {
      const th = B['thigh' + side], sh = B['shin' + side], ft = B['foot' + side], toe = B['toe' + side];
      const hj = qrot(rH, this.off[th]);
      const Hj = [hips[0] + hj[0], hips[1] + hj[1], hips[2] + hj[2]];
      const fi = P['foot' + side], ki = P['knee' + side];
      const T = [pose[fi] * s, pose[fi + 1] * s, pose[fi + 2] * s];
      const { E, W, n } = this.twoBone(Hj, T, this.len.thigh, this.len.shin, [pose[ki], pose[ki + 1], pose[ki + 2]]);
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
    const m = M.m4(), local = M.m4();
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
