// v0.4.8.7 The Favelas: hanging pieces that swing (the Hillside Bandana's two ends; nothing else on a player hangs). A
// piece is static geometry on a bone (the head) with a pivot it hangs from (the knot) and a direction it hangs in, in
// the bind pose. Each frame TailSway.step takes that bone's skin matrix and writes the piece's own: the same, turned
// about the pivot so that
//   * it hangs toward the ground (most of the way: cloth with a little body to it), whatever the head is doing; and
//   * its tip lags and swings: a damped spring on the tip's sideways offset, pushed by the pivot's acceleration (he
//     starts to run: the ends fly back; he stops: they swing on past and settle, about one and a half swings a second).
// v0.4.8.9: and they drape over him instead of passing through: given the bodies (drapeBodies: the head, the neck, the
// upper back and the shoulders, as a sphere and capsules from the rig), points along the ends (o.samples) that end up
// inside one turn the piece out of it about the knot, and the spring's swing settles where the cloth comes to rest.
// Pure maths, no graphics (tests/v0487favelaitems.test.mjs and tests/v0489bandana.test.mjs run it).
import { B } from './skeleton.js';
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const xd = (m, d) => [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
// the rotation (3x3, column-major) turning unit vector a onto unit vector b (Rodrigues)
function turn(a, b) {
  const v = cross(a, b), c = dot(a, b), s = len(v);
  if (s < 1e-6) return c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const k = norm(v), x = k[0], y = k[1], z = k[2], C = 1 - c;
  return [c + x * x * C, y * x * C + z * s, z * x * C - y * s, x * y * C - z * s, c + y * y * C, z * y * C + x * s, x * z * C + y * s, y * z * C - x * s, c + z * z * C];
}
const mul3 = (A, B) => { const o = new Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2]; return o; };
const ap3 = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
// the nearest point to p on a body's core (a segment a-b; a sphere has a = b)
function nearest(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  if (l2 < 1e-12) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}
// the bodies the ends drape over, in world space, from the rig as it stands this frame (× the head's radius R): the head
// (a sphere round its centre: the skull and the hair under the band), the neck, the upper back (the chest joint up to
// the base of the neck) and the shoulders (across, joint to joint). hc: the head's centre in the bind pose.
export const DRAPE = { head: 1.08, neck: 0.62, back: 1.0, shoulders: 0.7, gap: 0.03 };
export function drapeBodies(rig, world, hc, R, out = []) {
  const S = rig.skin.subarray(B.head * 16, B.head * 16 + 16), c = xf(S, hc), J = b => rig.jointWorld(world, b, [0, 0, 0]);
  const neck = J(B.neck), head = J(B.head), chest = J(B.chest);
  out.length = 0;
  out.push({ a: c, b: c, r: DRAPE.head * R }, { a: neck, b: head, r: DRAPE.neck * R }, { a: chest, b: neck, r: DRAPE.back * R }, { a: J(B.upperL), b: J(B.upperR), r: DRAPE.shoulders * R });
  return out;
}

export const SWAY = { hang: 0.75, freq: 1.5, damp: 0.22, push: 1, maxSwing: 0.9, step: 1 / 120 };

export class TailSway {
  // pivot, dir: in the bind pose (model space); length: pivot to tip (metres)
  constructor(pivot, dir, length, o = {}) {
    this.pivot = pivot; this.dir = norm(dir); this.L = length;
    this.o = { ...SWAY, ...o };
    this.k = Math.pow(2 * Math.PI * this.o.freq, 2); this.c = 2 * this.o.damp * Math.sqrt(this.k);
    this.u = [0, 0, 0]; this.v = [0, 0, 0]; // the tip's sideways offset from hanging straight, and its speed (world, m)
    this.last = null; this.prev = null; this.vel = [0, 0, 0];
    this.angle = 0; // (how far from the bone's own pose it hangs now, radians: for the tests)
    this.samples = o.samples || null; // (points along the ends, bind pose: what's kept out of the bodies)
    this.touching = false; // (resting on him this frame: for the tests)
  }
  reset() { this.u = [0, 0, 0]; this.v = [0, 0, 0]; this.last = null; this.prev = null; this.vel = [0, 0, 0]; }
  // S: the bone's skin matrix (16, column-major); out: the piece's (16); t: seconds (any clock); bodies: drapeBodies()
  step(S, out, t, bodies = null) {
    const pw = xf(S, this.pivot), dw = norm(xd(S, this.dir));
    let dt = this.last == null ? 0 : t - this.last;
    this.last = t;
    let acc = [0, 0, 0];
    if (this.prev && dt > 1e-4 && dt < 0.1 && len(sub(pw, this.prev)) < 0.6) {
      const vel = sub(pw, this.prev).map(x => x / dt);
      acc = sub(vel, this.vel).map(x => x / dt);
      this.vel = vel;
      const a = len(acc), cap = 40; if (a > cap) acc = acc.map(x => x * cap / a); // (a teleport or a hitch is not a shove)
    } else { dt = 0; this.vel = [0, 0, 0]; if (this.prev && len(sub(pw, this.prev)) >= 0.6) { this.u = [0, 0, 0]; this.v = [0, 0, 0]; } }
    this.prev = pw;
    // the spring: the tip pulled back to hanging straight, damped, pushed the opposite way to the pivot's acceleration
    // (sideways only: up and down just stretch the cloth)
    const ah = [acc[0], 0, acc[2]];
    for (let left = dt; left > 1e-6; left -= this.o.step) {
      const h = Math.min(this.o.step, left);
      for (let i = 0; i < 3; i++) { this.v[i] += (-this.k * this.u[i] - this.c * this.v[i] - this.o.push * ah[i]) * h; this.u[i] += this.v[i] * h; }
      this.u[1] = 0; this.v[1] = 0;
      const ul = len(this.u), mx = this.o.maxSwing * this.L; if (ul > mx) { this.u = this.u.map(x => x * mx / ul); }
    }
    // the rotation: first most of the way from where the bone holds it toward straight down, then the swing (down toward
    // the tip's offset)
    const down = [0, -1, 0], ang = Math.acos(Math.max(-1, Math.min(1, dot(dw, down))));
    const d1 = norm(slerpDir(dw, down, this.o.hang, ang));
    const R1 = turn(dw, d1);
    const d2 = norm([d1[0] * this.L + this.u[0], d1[1] * this.L + this.u[1], d1[2] * this.L + this.u[2]]);
    let R = mul3(turn(d1, d2), R1);
    this.touching = false;
    if (bodies && this.samples) R = this.drape(S, pw, R, bodies, dw, d1);
    this.angle = Math.acos(Math.max(-1, Math.min(1, dot(dw, ap3(R, dw)))));
    // out = T(pw) R T(-pw) S
    const Rp = ap3(R, pw), tx = pw[0] - Rp[0], ty = pw[1] - Rp[1], tz = pw[2] - Rp[2];
    for (let c = 0; c < 4; c++) {
      const col = [S[c * 4], S[c * 4 + 1], S[c * 4 + 2]], r = ap3(R, col), w = S[c * 4 + 3];
      out[c * 4] = r[0] + tx * w; out[c * 4 + 1] = r[1] + ty * w; out[c * 4 + 2] = r[2] + tz * w; out[c * 4 + 3] = w;
    }
    return out;
  }
  // the ends out of the bodies: the deepest point inside one turns the piece about the knot until it's on the surface (a
  // few passes: off the head it may meet the shoulders). A body the knot itself is inside (a head thrown right back onto
  // the upper back) is left out this frame: nothing about the knot could clear it. Then the spring is told where the
  // cloth lies (the tip's offset), and loses any speed into the body, so it rests on him rather than pressing through
  drape(S, pw, R, bodies, dw, d1) {
    const live = bodies.filter(b => len(sub(pw, nearest(pw, b.a, b.b))) > b.r + 0.004);
    if (!live.length) return R;
    const rel = this.samples.map(p => sub(xf(S, p), pw)), gap = DRAPE.gap * this.L * 0.4;
    let n = null;
    for (let it = 0; it < 8; it++) {
      let worst = 0, wv = null, wn = null;
      for (const p of rel) {
        const v = ap3(R, p), q = [pw[0] + v[0], pw[1] + v[1], pw[2] + v[2]];
        for (const b of live) { const c = nearest(q, b.a, b.b), d = len(sub(q, c)), pen = b.r + gap - d; if (pen > worst) { worst = pen; wv = v; wn = d > 1e-6 ? sub(q, c).map(x => x / d) : [0, 0, -1]; } }
      }
      if (!wv) break;
      const v2 = [wv[0] + wn[0] * (worst + 1e-3), wv[1] + wn[1] * (worst + 1e-3), wv[2] + wn[2] * (worst + 1e-3)];
      R = mul3(turn(norm(wv), norm(v2)), R); n = wn;
    }
    if (n) {
      this.touching = true;
      const df = ap3(R, dw);
      this.u = [(df[0] - d1[0]) * this.L, 0, (df[2] - d1[2]) * this.L];
      const ul = len(this.u), mx = this.o.maxSwing * this.L; if (ul > mx) this.u = this.u.map(x => x * mx / ul);
      const vn = dot(this.v, n); if (vn < 0) this.v = this.v.map((x, i) => x - n[i] * vn);
      this.v[1] = 0;
    }
    return R;
  }
  // where its tip is now (world), for the tests
  tip(out) { return xf(out, [this.pivot[0] + this.dir[0] * this.L, this.pivot[1] + this.dir[1] * this.L, this.pivot[2] + this.dir[2] * this.L]); }
}
// a direction part of the way (f) from a to b, through the angle between them (ang)
function slerpDir(a, b, f, ang) {
  if (ang < 1e-5) return a;
  const s = Math.sin(ang), wa = Math.sin((1 - f) * ang) / s, wb = Math.sin(f * ang) / s;
  if (!Number.isFinite(wa) || s < 1e-5) return b;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
}
