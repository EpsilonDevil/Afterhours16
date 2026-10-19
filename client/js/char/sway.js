// v0.4.8.7 The Favelas: hanging pieces that swing (the Hillside Bandana's two ends; nothing else on a player hangs). A
// piece is static geometry on a bone (the head) with a pivot it hangs from (the knot) and a direction it hangs in, in
// the bind pose. Each frame TailSway.step takes that bone's skin matrix and writes the piece's own: the same, turned
// about the pivot so that
//   * it hangs toward the ground (most of the way: cloth with a little body to it), whatever the head is doing; and
//   * its tip lags and swings: a damped spring on the tip's sideways offset, pushed by the pivot's acceleration (he
//     starts to run: the ends fly back; he stops: they swing on past and settle, about one and a half swings a second).
// Pure maths, no graphics (tests/v0487favelaitems.test.mjs runs it).
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
  }
  reset() { this.u = [0, 0, 0]; this.v = [0, 0, 0]; this.last = null; this.prev = null; this.vel = [0, 0, 0]; }
  // S: the bone's skin matrix (16, column-major); out: the piece's (16); t: seconds (any clock)
  step(S, out, t) {
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
    const R = mul3(turn(d1, d2), R1);
    this.angle = Math.acos(Math.max(-1, Math.min(1, dot(dw, d2))));
    // out = T(pw) R T(-pw) S
    const Rp = ap3(R, pw), tx = pw[0] - Rp[0], ty = pw[1] - Rp[1], tz = pw[2] - Rp[2];
    for (let c = 0; c < 4; c++) {
      const col = [S[c * 4], S[c * 4 + 1], S[c * 4 + 2]], r = ap3(R, col), w = S[c * 4 + 3];
      out[c * 4] = r[0] + tx * w; out[c * 4 + 1] = r[1] + ty * w; out[c * 4 + 2] = r[2] + tz * w; out[c * 4 + 3] = w;
    }
    return out;
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
