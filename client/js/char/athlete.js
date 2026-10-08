// Procedural skinned athlete (v0.4 "realism pass").
// One skinned body (torso, limbs, five-finger hands) sculpted with anatomical bump fields (pecs, lats,
// deltoids, biceps/triceps, quads, calves, glutes…), a separate high-resolution head with carved eye
// openings, real eyeballs, nose/lips/ears geometry, then hair, apparel and footwear as their own meshes.
// Everything is generated from the build (height / weight / wingspan / archetype) and look settings.
import { B, BONES, ARM_ANGLE, bodyDims, bindOffsets, bindPositions } from './skeleton.js';
import { computeNormals } from '../gfx/geometry.js';
import { RNG, hashString } from '../core/rng.js';
import { hexToRgb, hexLinear } from '../core/math.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const addS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
// raised-cosine bump: 1 at c, 0 beyond ±w
const bump = (x, c, w) => { const d = Math.abs(x - c); return d >= w ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / w)); };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const bumpAng = (phi, c, w) => bump(angDiff(phi, c), 0, w);
// 2D elliptic bump
const bump2 = (x, y, cx, cy, rx, ry) => { const d = Math.hypot((x - cx) / rx, (y - cy) / ry); return d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * d)); };

class GB {
  constructor() { this.p = []; this.uv = []; this.c = []; this.j = []; this.w = []; this.i = []; }
  get count() { return this.p.length / 3; }
  v(p, uv, col, wts) {
    this.p.push(p[0], p[1], p[2]);
    this.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    const c = col || [1, 1, 1, 1];
    this.c.push(c[0], c[1], c[2], c[3] ?? 1);
    const ws = (wts || [[0, 1]]).filter(x => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = ws.reduce((s, x) => s + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) { this.j.push(ws[k] ? ws[k][0] : 0); this.w.push(ws[k] ? ws[k][1] / tot : 0); }
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  // Ring grid: rows×cols closed in cols. f(r,c) → {p, uv, col, w, keep}
  grid(rows, cols, f, opts = {}) {
    const idx = [];
    for (let r = 0; r < rows; r++) {
      idx.push([]);
      for (let c = 0; c <= cols; c++) {
        const o = f(r, c);
        idx[r].push(o.keep === false ? -1 : this.v(o.p, o.uv, o.col, o.w));
      }
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
      const a = idx[r][c], b = idx[r][c + 1], d = idx[r + 1][c + 1], e = idx[r + 1][c];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      if (opts.inward) { this.tri(a, d, b); this.tri(a, e, d); } else { this.tri(a, b, d); this.tri(a, d, e); }
    }
    return idx;
  }
  capRing(ringIdx, center, uv, col, w, flipped) {
    const c = this.v(center, uv, col, w);
    for (let k = 0; k < ringIdx.length - 1; k++) {
      if (ringIdx[k] < 0 || ringIdx[k + 1] < 0) continue;
      flipped ? this.tri(c, ringIdx[k], ringIdx[k + 1]) : this.tri(c, ringIdx[k + 1], ringIdx[k]);
    }
  }
  // Tube along a polyline with per-point radius (rx along `up`, ry along side) and rounded end caps.
  tube(points, radii, up0, opts = {}) {
    const n = points.length, cols = opts.cols || 12;
    // parallel-transport frames
    const T = points.map((p, i) => norm(sub(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)])));
    let U = norm(sub(up0, scale(T[0], dot(up0, T[0]))));
    const rings = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) { const t = T[i]; U = norm(sub(U, scale(t, dot(U, t)))); }
      const S = cross(T[i], U);
      const [ra, rb] = Array.isArray(radii[i]) ? radii[i] : [radii[i], radii[i]];
      const ring = [];
      for (let c = 0; c <= cols; c++) {
        const a = c / cols * Math.PI * 2;
        const p = add(points[i], add(scale(U, Math.cos(a) * ra), scale(S, Math.sin(a) * rb)));
        ring.push(this.v(p, opts.uv ? opts.uv(i / (n - 1), c / cols) : [0, 0], opts.col ? opts.col(i / (n - 1), c / cols) : null, opts.w ? opts.w(i / (n - 1)) : [[0, 1]]));
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) for (let c = 0; c < cols; c++) {
      const a = rings[i][c], b = rings[i][c + 1], d = rings[i + 1][c + 1], e = rings[i + 1][c];
      this.tri(a, b, d); this.tri(a, d, e);
    }
    // round caps (small domes)
    const cap = (ring, center, dir, rad, flip) => {
      const tip = this.v(addS(center, dir, rad * 0.8), [0, 0], opts.col ? opts.col(flip ? 1 : 0, 0) : null, opts.w ? opts.w(flip ? 1 : 0) : [[0, 1]]);
      for (let c = 0; c < cols; c++) flip ? this.tri(tip, ring[c], ring[c + 1]) : this.tri(tip, ring[c + 1], ring[c]);
    };
    if (opts.capEnd !== false) { const r = radii[n - 1]; cap(rings[n - 1], points[n - 1], T[n - 1], Array.isArray(r) ? Math.min(...r) : r, true); }
    if (opts.capStart) { const r = radii[0]; cap(rings[0], points[0], scale(T[0], -1), Array.isArray(r) ? Math.min(...r) : r, false); }
    return rings;
  }
  merge(o) {
    const base = this.count;
    this.p.push(...o.p); this.uv.push(...o.uv); this.c.push(...o.c); this.j.push(...o.j); this.w.push(...o.w);
    for (const i of o.i) this.i.push(i + base);
  }
  finish() {
    if (!this.i.length) return null;
    const g = {
      position: new Float32Array(this.p), uv: new Float32Array(this.uv), color: new Float32Array(this.c),
      joints: new Float32Array(this.j), weights: new Float32Array(this.w),
      index: this.count > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i),
    };
    computeNormals(g);
    weldNormals(g);
    return g;
  }
}

// v0.4.2: ring/tube seams and cap joins duplicate vertices, which shaded as hard lines ("blocky" edges).
// Average the normals of vertices at the same spot when they face roughly the same way (keeps real creases,
// e.g. a sole edge, sharp).
function weldNormals(g, creaseCos = 0.5) {
  const p = g.position, n = g.normal, cnt = p.length / 3, q = 1e4;
  const buckets = new Map();
  for (let i = 0; i < cnt; i++) {
    const k = `${Math.round(p[i * 3] * q)},${Math.round(p[i * 3 + 1] * q)},${Math.round(p[i * 3 + 2] * q)}`;
    const b = buckets.get(k);
    if (b) b.push(i); else buckets.set(k, [i]);
  }
  const out = new Float32Array(n);
  for (const ids of buckets.values()) {
    if (ids.length === 1) continue;
    for (const i of ids) {
      let x = 0, y = 0, z = 0;
      for (const j of ids) {
        const d = n[i * 3] * n[j * 3] + n[i * 3 + 1] * n[j * 3 + 1] + n[i * 3 + 2] * n[j * 3 + 2];
        if (d >= creaseCos) { x += n[j * 3]; y += n[j * 3 + 1]; z += n[j * 3 + 2]; }
      }
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
  }
  for (const ids of buckets.values()) if (ids.length > 1) for (const i of ids) { n[i * 3] = out[i * 3]; n[i * 3 + 1] = out[i * 3 + 1]; n[i * 3 + 2] = out[i * 3 + 2]; }
}

// ---------------- torso ----------------
// yf (fraction of H), half-width, front depth, back depth, z-center, superellipse exponent
const TORSO = [
  [0.452, 0.034, 0.018, 0.024, 0.006, 2.0],
  [0.468, 0.074, 0.044, 0.060, 0.000, 2.2],
  [0.495, 0.086, 0.051, 0.067, -0.002, 2.3],
  [0.525, 0.088, 0.052, 0.063, 0.000, 2.3],
  [0.555, 0.082, 0.051, 0.054, 0.003, 2.2],
  [0.590, 0.075, 0.049, 0.048, 0.005, 2.2],
  [0.630, 0.076, 0.052, 0.049, 0.005, 2.3],
  [0.670, 0.085, 0.058, 0.054, 0.003, 2.4],
  [0.705, 0.097, 0.065, 0.058, 0.001, 2.5],
  [0.738, 0.103, 0.067, 0.061, -0.002, 2.6],
  [0.768, 0.105, 0.065, 0.062, -0.005, 2.6],
  [0.795, 0.108, 0.057, 0.060, -0.008, 2.5],
  [0.815, 0.098, 0.047, 0.055, -0.010, 2.3],
  [0.831, 0.070, 0.040, 0.046, -0.009, 2.1],
  [0.845, 0.049, 0.035, 0.038, -0.006, 2.0],
  [0.864, 0.036, 0.031, 0.031, -0.001, 2.0],
  [0.888, 0.034, 0.030, 0.029, 0.004, 2.0],
];
function torsoTable(yf) {
  const T = TORSO;
  if (yf <= T[0][0]) return T[0].slice(1);
  for (let i = 1; i < T.length; i++) if (yf <= T[i][0]) {
    const a = T[i - 1], b = T[i], k = (yf - a[0]) / (b[0] - a[0]);
    const p0 = T[Math.max(0, i - 2)], p3 = T[Math.min(T.length - 1, i + 1)];
    return a.slice(1).map((v, j) => {
      const P0 = p0[j + 1], P1 = v, P2 = b[j + 1], P3 = p3[j + 1], t = k, t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * P1) + (-P0 + P2) * t + (2 * P0 - 5 * P1 + 4 * P2 - P3) * t2 + (-P0 + 3 * P1 - 3 * P2 + P3) * t3);
    });
  }
  return T[T.length - 1].slice(1);
}
const sePow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), 2 / e);

// limb radius profiles: t, radius (H units)
const UPPER = [[-0.07, 0.027], [0.0, 0.033], [0.22, 0.031], [0.45, 0.0275], [0.68, 0.0275], [0.88, 0.0245], [1.02, 0.0225], [1.08, 0.021]];
const FORE = [[-0.07, 0.022], [0.0, 0.0225], [0.16, 0.0245], [0.42, 0.0215], [0.72, 0.0175], [0.92, 0.0148], [1.02, 0.0142]];
const THIGH = [[-0.14, 0.046], [0.0, 0.052], [0.25, 0.0485], [0.55, 0.0425], [0.84, 0.0355], [1.02, 0.0315], [1.08, 0.029]];
const SHIN = [[-0.08, 0.031], [0.0, 0.0305], [0.1, 0.03], [0.3, 0.0305], [0.6, 0.0245], [0.86, 0.0185], [1.03, 0.0182]];
function profile(prof, t) {
  if (t <= prof[0][0]) return prof[0][1];
  for (let i = 1; i < prof.length; i++) if (t <= prof[i][0]) {
    const a = prof[i - 1], b = prof[i], k = (t - a[0]) / (b[0] - a[0]), s = k * k * (3 - 2 * k);
    return lerp(a[1], b[1], s);
  }
  return prof[prof.length - 1][1];
}

// Facial layout in face space (fx = x/sx across, fy = y up, unit head). Shared with the face painter.
const HEAD_PITCH = 0.1, HEAD_PC = Math.cos(HEAD_PITCH), HEAD_PS = Math.sin(HEAD_PITCH);
export const FACE = {
  sx: 0.78, eyeX: 0.4, eyeY: 0.05, eyeW: 0.14, eyeH: 0.034, browY: 0.17,
  noseTip: -0.24, noseBase: -0.31, lipU: -0.415, mouth: -0.458, lipL: -0.505, mouthW: 0.25, chinY: -0.82,
};

export class AthleteModel {
  // build: {height, weight, wingspan, position, archetype}, look: appearance + equipment specs
  constructor(build, look = {}, detail = 1) {
    this.build = build;
    this.d = bodyDims(build);
    this.off = bindOffsets(this.d);
    this.bind = bindPositions(this.off);
    this.look = look;
    this.detail = detail;
    this.seed = hashString(JSON.stringify([build.height, build.weight, look.skin, look.face, look.hair, look.number || 0]));
    const W = this.d.W, H = this.d.H;
    // muscle definition & body fat from build (heavier for height → thicker, smoother; lean → more defined)
    const bmi = W / (H * H);
    this.m = clamp(0.85 + (bmi - 22) * 0.05, 0.75, 1.25);   // muscle volume
    this.fat = clamp((bmi - 26.5) * 0.08, 0, 0.6);          // soft tissue over the definition
    this.def = clamp(1.15 - this.fat * 1.4, 0.4, 1.15);      // definition (crease depth)
  }

  // ---------- skin weights ----------
  torsoWeights(y, lx, x) {
    const P = this.bind, H = this.d.H;
    const yh = P[B.hips][1], ys = P[B.spine][1], yc = P[B.chest][1], yn = P[B.neck][1], yhd = P[B.head][1];
    const k1 = smooth(yh - 0.02 * H, yh + 0.055 * H, y);
    const k2 = smooth(ys, yc, y);
    const k3 = smooth(yn - 0.025 * H, yn + 0.01 * H, y);
    const k4 = smooth(yhd - 0.015 * H, yhd + 0.01 * H, y);
    let wh = 1 - k1, wsp = k1 * (1 - k2), wc = k1 * k2 * (1 - k3), wn = k1 * k2 * k3 * (1 - k4), whd = k1 * k2 * k3 * k4;
    const clavK = smooth(0.4, 0.9, Math.abs(lx)) * smooth(yc + 0.03 * H, yc + 0.08 * H, y) * (1 - smooth(yn - 0.005 * H, yn + 0.015 * H, y));
    const clav = x > 0 ? B.clavL : B.clavR;
    wc *= 1 - clavK * 0.85;
    const thighK = (1 - smooth(yh - 0.07 * H, yh - 0.005 * H, y)) * smooth(0.25, 0.9, Math.abs(lx)) * 0.45;
    const thigh = x > 0 ? B.thighL : B.thighR;
    wh *= 1 - thighK;
    return [[B.hips, wh], [B.spine, wsp], [B.chest, wc], [B.neck, wn], [B.head, whd], [clav, clavK * 0.85], [thigh, thighK]];
  }

  // ---------- torso surface ----------
  // Cross-section point at height yf, angle phi (0 = front +Z, +π/2 = left +X). Returns model-space [x, y, z].
  torsoPoint(yf, phi, loose = 0, hang = 0) {
    const H = this.d.H, g = this.d.girth;
    let [rx, zf, zb, zc, e] = torsoTable(yf);
    if (hang > 0 && yf < 0.738) {
      // garments don't follow the waist in: blend toward the chest section below it
      const ch = torsoTable(0.738), k = smooth(0.738, 0.6, yf) * hang;
      rx = Math.max(rx, lerp(rx, ch[0] * 0.97, k)); zf = Math.max(zf, lerp(zf, ch[1] * 0.95, k)); zb = Math.max(zb, lerp(zb, ch[2], k));
    }
    const s = Math.sin(phi), c = Math.cos(phi), as = Math.abs(s), ang = Math.acos(clamp(c, -1, 1)); // 0 front .. π back
    const m = this.m, def = this.def, fat = this.fat;
    // girth: wider/deeper torso for heavier builds; shoulders broaden with muscle
    const gw = g * (yf > 0.7 ? lerp(1, 0.94 + 0.08 * m, smooth(0.7, 0.79, yf)) : 1);
    let x = sePow(s, e) * rx * gw;
    let z = zc + sePow(c, e) * (c >= 0 ? zf : zb) * g;
    // v0.4.4: garments (hang >= 0.5) drape over every bulge (pecs, lats, glutes, belly) but skip the grooves,
    // so the body underneath can never poke through the fabric
    let pos = 0, neg = 0;
    {
      const front = Math.max(0, c), back = Math.max(0, -c);
      // pectorals with a defined lower edge, sternum groove
      pos += 0.011 * m * bump(yf, 0.748, 0.038) * bump(as, 0.4, 0.36) * Math.pow(front, 0.6);
      neg += 0.0035 * def * bump(yf, 0.726, 0.012) * bump(as, 0.38, 0.32) * front;
      neg += 0.003 * def * bump(yf, 0.735, 0.05) * bump(as, 0, 0.08) * front;
      // abdominals: rectus with three tendinous lines + linea alba, obliques
      pos += 0.0045 * m * bump(yf, 0.645, 0.062) * bump(as, 0, 0.34) * front;
      for (const yg of [0.618, 0.65, 0.682]) neg += 0.0016 * def * bump(yf, yg, 0.009) * bump(as, 0, 0.3) * front;
      neg += 0.0022 * def * bump(as, 0, 0.05) * bump(yf, 0.645, 0.075) * front;
      pos += 0.0035 * m * bump(yf, 0.69, 0.045) * bump(ang, 1.25, 0.45);           // serratus / obliques
      pos += 0.003 * bump(yf, 0.565, 0.02) * bump(ang, 1.05, 0.5);                 // iliac crest
      // lats (V-taper), scapulae, spine groove + erector ridges, traps
      pos += 0.011 * m * bump(yf, 0.725, 0.065) * bump(ang, 2.0, 0.6);
      pos += 0.006 * m * bump(yf, 0.765, 0.03) * bump(ang, 2.45, 0.45);
      neg += 0.0055 * def * bump(as, 0, 0.12) * back * bump(yf, 0.68, 0.15);
      pos += 0.0038 * m * bump(as, 0.2, 0.11) * back * bump(yf, 0.6, 0.08);
      pos += 0.006 * m * bump(yf, 0.828, 0.026) * bump(as, 0.5, 0.36) * (c < 0.3 ? 1 : 0.4);
      // glutes with cleft
      pos += 0.012 * m * bump(yf, 0.497, 0.036) * bump(as, 0.42, 0.36) * back;
      neg += 0.0075 * bump(as, 0, 0.08) * back * bump(yf, 0.49, 0.045);
      // clavicles, neck muscles
      pos += 0.0025 * def * bump(yf, 0.812, 0.011) * bump(as, 0.35, 0.26) * front;
      pos += 0.003 * bump(yf, 0.856, 0.03) * bump(as, 0.55, 0.25) * front;
      // soft tissue for heavier builds (belly, love handles)
      pos += 0.016 * fat * bump(yf, 0.62, 0.075) * front + 0.008 * fat * bump(yf, 0.58, 0.04) * bump(ang, 1.6, 0.6);
    }
    const dr = pos - neg * smooth(0.6, 0.4, hang);
    const nx = s, nz = c, l = Math.hypot(nx, nz) || 1;
    x += nx / l * (dr + loose);
    z += nz / l * (dr + loose);
    return [x * H, yf * H, z * H];
  }

  // regional skin tint (rgb multipliers) + ambient occlusion (alpha) for torso
  torsoColor(yf, phi) {
    const as = Math.abs(Math.sin(phi)), c = Math.cos(phi);
    let ao = 1;
    ao -= 0.28 * bump(yf, 0.775, 0.03) * bump(as, 0.98, 0.16);     // armpits
    ao -= 0.3 * bump(yf, 0.455, 0.02);                                  // crotch
    ao -= 0.15 * bump(yf, 0.885, 0.02) * Math.max(0, c);                // under the chin
    ao -= 0.1 * bump(yf, 0.725, 0.01) * bump(as, 0.38, 0.32) * Math.max(0, c); // under pecs
    return [1, 1, 1, clamp(ao, 0.5, 1)];
  }

  loftTorso(gb, opts) {
    const H = this.d.H;
    const rows = opts.rows || Math.round(40 * this.detail) + 6, cols = opts.cols || Math.round(48 * this.detail) + 8;
    return gb.grid(rows, cols, (r, c) => {
      const t = r / (rows - 1), u0 = c / cols, phi0 = u0 * Math.PI * 2 - Math.PI / 2;
      const yf = lerp(opts.y0, opts.topY ? Math.min(opts.y1, opts.topY(phi0)) : opts.y1, t);
      const u = c / cols, phi = u * Math.PI * 2 - Math.PI / 2;
      const p = this.torsoPoint(yf, phi, opts.loose ? opts.loose(yf, phi) : 0, typeof opts.hang === 'function' ? opts.hang(yf) : opts.hang || 0);
      const keep = opts.keep ? opts.keep(yf, phi, u, t) : true;
      return {
        p, keep,
        uv: opts.uv ? opts.uv(u, t, yf) : [u * 1.9, yf * H / 0.6],
        col: opts.col ? opts.col(u, t, yf, phi) : this.torsoColor(yf, phi),
        w: this.torsoWeights(p[1], Math.sin(phi), p[0]),
      };
    }, opts.grid || {});
  }

  // ---------- limbs ----------
  limbFrame(dir) {
    let fr = [0, 0, 1];
    const dt = dot(fr, dir);
    fr = norm([fr[0] - dir[0] * dt, fr[1] - dir[1] * dt, fr[2] - dir[2] * dt]);
    return { fr, lt: cross(dir, fr) };
  }
  // Loft along bone a→b. rfn(t, phi, latSign) → radius (H units) or [rFront, rLat].
  loftLimb(gb, a, b, rfn, wfn, opts = {}) {
    const H = this.d.H, A = opts.start || this.bind[a], Bp = opts.end || this.bind[b];
    const dir = norm(sub(Bp, A)), len = Math.hypot(...sub(Bp, A));
    const { fr, lt } = this.limbFrame(dir);
    const side = Math.sign(A[0] + Bp[0]) || 1;
    const latSign = Math.sign(lt[0] * side) || 1; // which way "away from the body" is in the lt axis
    const t0 = opts.t0, t1 = opts.t1;
    const rows = opts.rows || Math.round(20 * this.detail) + 4, cols = opts.cols || Math.round(26 * this.detail) + 4;
    const circ = 2 * Math.PI * 0.04 * H;
    return gb.grid(rows, cols, (r, c) => {
      const t = lerp(t0, t1, r / (rows - 1));
      const u = c / cols, phi = u * Math.PI * 2 - Math.PI / 2;
      let rr = rfn(t, phi, latSign);
      let rf, rl; if (Array.isArray(rr)) [rf, rl] = rr; else rf = rl = rr;
      rf = (rf + (opts.offset || 0)) * H; rl = (rl + (opts.offset || 0)) * H;
      const ctr = addS(A, dir, t * len);
      const p = addS(addS(ctr, fr, Math.cos(phi) * rf), lt, Math.sin(phi) * rl);
      const keep = opts.keep ? opts.keep(t, phi, u) : true;
      return {
        p, keep,
        uv: opts.uv ? opts.uv(u, (t - t0) / (t1 - t0)) : [u * circ / 0.6, t * len / 0.6],
        col: opts.col ? opts.col(t, phi, latSign) : null,
        w: wfn(t, phi),
      };
    });
  }

  jointBlend(parent, bone, child, bl = 0.14) {
    return t => {
      const wp = parent >= 0 ? 0.5 * (1 - smooth(-bl, bl, t)) : 0;
      const wc = child >= 0 ? 0.5 * smooth(1 - bl, 1 + bl, t) : 0;
      return [[parent, wp], [bone, 1 - wp - wc], [child, wc]].filter(x => x[0] >= 0);
    };
  }

  // anatomical radius fields; phi: 0 front, π back, latSign·π/2 lateral (away from body)
  upperArmR(t, phi, ls) {
    const m = this.m, lat = ls * Math.PI / 2;
    let r = profile(UPPER, t) * (0.7 + 0.3 * m) + this.fat * 0.003;
    r += 0.0055 * m * bump(t, 0.1, 0.32) * bumpAng(phi, lat, 1.5);                // deltoid cap
    r += 0.003 * m * bump(t, 0.12, 0.25) * bumpAng(phi, 0.35 * ls, 0.9);          // front delt
    r += 0.0045 * m * bump(t, 0.63, 0.25) * bumpAng(phi, 0, 1.0);                 // biceps
    r += 0.004 * m * bump(t, 0.45, 0.3) * bumpAng(phi, Math.PI, 1.1);             // triceps
    r -= 0.002 * bump(t, 0.5, 0.45) * bumpAng(phi, -lat, 0.8);                    // flatter inner arm
    r -= 0.0018 * this.def * bump(t, 0.43, 0.06) * bumpAng(phi, lat, 0.6);        // deltoid insertion groove
    return r;
  }
  foreArmR(t, phi, ls) {
    const m = this.m, lat = ls * Math.PI / 2;
    let r = profile(FORE, t) * (0.75 + 0.25 * m) + this.fat * 0.0015;
    r += 0.004 * m * bump(t, 0.2, 0.3) * bumpAng(phi, lat * 0.55, 1.1);            // brachioradialis / extensors
    r += 0.0028 * m * bump(t, 0.22, 0.3) * bumpAng(phi, -lat * 0.7, 0.9);          // flexors
    r += 0.003 * bump(t, 0.0, 0.1) * bumpAng(phi, Math.PI, 0.7);                   // olecranon
    const wf = smooth(0.7, 1.0, t); // wrist: wider across than front-to-back
    return [r * (1 - 0.22 * wf), r * (1 + 0.1 * wf)];
  }
  thighR(t, phi, ls) {
    const m = this.m, lat = ls * Math.PI / 2;
    let r = profile(THIGH, t) * (0.72 + 0.28 * m) * Math.min(1.12, this.d.girth) + this.fat * 0.005;
    r += 0.0045 * m * bump(t, 0.55, 0.35) * bumpAng(phi, 0, 1.0);                  // rectus femoris / quads
    r += 0.0055 * m * bump(t, 0.86, 0.14) * bumpAng(phi, -lat * 0.55, 0.75);       // vastus medialis teardrop
    r += 0.0035 * m * bump(t, 0.5, 0.35) * bumpAng(phi, lat * 0.75, 0.9);          // vastus lateralis
    r += 0.0035 * m * bump(t, 0.5, 0.32) * bumpAng(phi, Math.PI, 1.1);             // hamstrings
    r += 0.003 * m * bump(t, 0.18, 0.25) * bumpAng(phi, -lat, 0.9);                // adductors
    r -= 0.002 * bump(t, 0.6, 0.35) * bumpAng(phi, lat, 0.35);                     // IT band flat
    r += 0.004 * bump(t, 1.01, 0.08) * bumpAng(phi, 0, 0.7);                       // patella
    return r;
  }
  shinR(t, phi, ls) {
    const m = this.m, lat = ls * Math.PI / 2;
    let r = profile(SHIN, t) * (0.75 + 0.25 * m) + this.fat * 0.002;
    r += 0.0075 * m * bump(t, 0.28, 0.24) * bumpAng(phi, Math.PI - lat * 0.3, 0.9);   // lateral gastrocnemius
    r += 0.0082 * m * bump(t, 0.34, 0.24) * bumpAng(phi, Math.PI + lat * 0.35, 0.9);  // medial gastrocnemius (lower)
    r -= 0.003 * bump(t, 0.5, 0.45) * bumpAng(phi, 0, 0.35);                          // tibia ridge
    r -= 0.004 * bump(t, 0.85, 0.15) * bumpAng(phi, Math.PI, 0.6);                    // achilles narrows
    r += 0.002 * bump(t, 0.03, 0.06) * bumpAng(phi, 0, 0.5);                          // patellar tendon
    r += 0.0025 * bump(t, 0.99, 0.05) * (bumpAng(phi, lat, 0.45) + bumpAng(phi, -lat, 0.45)); // ankle bones
    return r;
  }
  limbColor(part) {
    // darker, rougher skin over knees and elbows; AO at the joints' inner side
    return (t, phi, ls) => {
      let k = 1, ao = 1;
      if (part === 'fore') k -= 0.07 * bump(t, 0.0, 0.08) * bumpAng(phi, Math.PI, 0.9);
      if (part === 'shin') k -= 0.06 * bump(t, 0.02, 0.08) * bumpAng(phi, 0, 0.9);
      if (part === 'upper') ao -= 0.15 * bump(t, 1.0, 0.08) * bumpAng(phi, 0, 0.9);
      if (part === 'thigh') ao -= 0.2 * bump(t, -0.1, 0.12) * bumpAng(phi, -ls * Math.PI / 2, 1.0);
      return [k, k * 0.985, k * 0.98, ao];
    };
  }

  buildBody() {
    const gb = new GB(), H = this.d.H;
    const tidx = this.loftTorso(gb, { y0: 0.452, y1: 0.9 });
    gb.capRing(tidx[0], [0, 0.448 * H, 0.004 * H], [0.5, 0.5], [1, 1, 1, 0.6], [[B.hips, 1]], true);
    for (const side of ['L', 'R']) {
      const clav = B['clav' + side], up = B['upper' + side], fo = B['fore' + side], ha = B['hand' + side];
      this.loftLimb(gb, up, fo, (t, p, ls) => this.upperArmR(t, p, ls) * (1 - 0.12 * smooth(1.0, 1.07, t)), this.jointBlend(clav, up, fo, 0.2), { t0: -0.07, t1: 1.07, col: this.limbColor('upper') });
      this.loftLimb(gb, fo, ha, (t, p, ls) => { const r = this.foreArmR(t, p, ls), k = 1 - 0.1 * smooth(0, -0.07, t); return [r[0] * k, r[1] * k]; }, this.jointBlend(up, fo, ha, 0.12), { t0: -0.07, t1: 1.0, col: this.limbColor('fore') });
      this.buildHand(gb, side);
      const th = B['thigh' + side], sh = B['shin' + side], ft = B['foot' + side];
      this.loftLimb(gb, th, sh, (t, p, ls) => this.thighR(t, p, ls), t => {
        const base = this.jointBlend(-1, th, sh, 0.12)(t);
        const wh = 0.5 * (1 - smooth(-0.15, 0.15, t));
        return [[B.hips, wh], ...base.map(([b, w]) => [b, b === th ? w - wh : w])];
      }, { t0: -0.14, t1: 1.07, col: this.limbColor('thigh') });
      this.loftLimb(gb, sh, ft, (t, p, ls) => this.shinR(t, p, ls) * (1 - 0.1 * smooth(0, -0.08, t)), this.jointBlend(th, sh, ft, 0.1), { t0: -0.08, t1: 1.03, col: this.limbColor('shin') });
    }
    return gb.finish();
  }

  // ---------- hands: palm + four three-segment fingers + thumb, relaxed curl ----------
  buildHand(gb, side) {
    const H = this.d.H, ha = B['hand' + side], fo = B['fore' + side];
    const W = this.bind[ha];
    const sg = side === 'L' ? 1 : -1;
    const s40 = Math.sin(ARM_ANGLE), c40 = Math.cos(ARM_ANGLE);
    const a = norm([sg * s40, -c40, 0]);          // along the hand (fingers)
    const pn = norm([-sg * c40, -s40, 0]);        // palm normal (toward the body)
    const th = [0, 0, 1];                         // thumb side
    const L = this.d.handLen;
    const palmLen = L * 0.47, palmW = 0.044 * H * (0.92 + 0.08 * this.m), palmT = 0.0145 * H;
    const palmCol = this.look.palm || null;
    const tintPalm = (k) => [1 + 0.1 * k, 1 + 0.08 * k, 1 + 0.07 * k, 1];
    const wHand = t => [[fo, 0.5 * (1 - smooth(-0.15, 0.2, t))], [ha, 1 - 0.5 * (1 - smooth(-0.15, 0.2, t))]];
    // palm: boxy loft from wrist to knuckles
    const rows = 7, cols = 14;
    const flip = dot(cross(a, th), pn) < 0;
    gb.grid(rows, cols, (r, c) => {
      const t = lerp(-0.06, 1.0, r / (rows - 1));
      const ph = c / cols * Math.PI * 2;
      const ws = lerp(0.62, 1.0, smooth(-0.06, 0.45, t)) * palmW * 0.5;   // narrow at the wrist
      const ts = lerp(0.9, 1.0, smooth(0, 0.5, t)) * palmT * 0.5 * (1 + 0.25 * bump(t, 0.35, 0.4));
      const cs = Math.cos(ph), sn = Math.sin(ph);
      const sx = sePow(cs, 3), sy = sePow(sn, 3);
      // thenar pad bulges the palm on the thumb side
      const thenar = 0.006 * H * bump(t, 0.25, 0.32) * Math.max(0, sx) * Math.max(0, sy);
      const p = addS(addS(addS(W, a, t * palmLen), th, sx * ws), pn, sy * ts + thenar * 0.6);
      const onPalm = sy > 0.3;
      return { p, uv: [c / cols * 0.4, t * 0.15], col: onPalm ? tintPalm(0.9) : [1, 1, 1, 1], w: wHand(t) };
    }, { inward: flip });
    // fingers: index (thumb side) → pinky
    const lens = [0.395, 0.44, 0.41, 0.33], offs = [0.36, 0.12, -0.12, -0.35];
    const curl = [[0.12, 0.16, 0.1], [0.14, 0.2, 0.12], [0.17, 0.22, 0.13], [0.2, 0.25, 0.15]];
    const rad0 = 0.0044 * H * (0.94 + 0.06 * this.m);
    for (let f = 0; f < 4; f++) {
      const base = addS(addS(W, a, palmLen * (f === 1 ? 1.0 : f === 0 || f === 2 ? 0.98 : 0.93)), th, offs[f] * palmW);
      const segs = [0.47, 0.3, 0.23].map(s => s * lens[f] * L);
      const pts = [addS(base, a, -0.012 * H)], radii = [rad0 * (f === 3 ? 0.88 : 1) * 1.1];
      let dir = norm(addS(a, th, offs[f] * 0.05)), p = base;
      pts.push(p); radii.push(rad0 * (f === 3 ? 0.86 : 1) * 1.08);
      for (let k = 0; k < 3; k++) {
        dir = norm(addS(dir, pn, Math.tan(curl[f][k]) * 0.9)); // flex toward the palm
        const steps = 2;
        for (let st = 1; st <= steps; st++) {
          p = addS(p, dir, segs[k] / steps);
          pts.push(p);
          const tt = (k + st / steps) / 3;
          radii.push(rad0 * (f === 3 ? 0.86 : 1) * lerp(1.0, 0.78, tt) * (st === steps && k < 2 ? 1.06 : 1));
        }
      }
      gb.tube(pts, radii.map(r => [r * 0.92, r]), pn, { cols: 10, w: () => [[ha, 1]], col: (t, u) => (Math.cos(u * Math.PI * 2) > 0.35 ? tintPalm(0.8) : [1, 1, 1, t < 0.2 ? 0.85 : 1]) });
    }
    // thumb: from the base of the palm on the thumb side, angled forward and toward the palm
    const tb = addS(addS(addS(W, a, palmLen * 0.12), th, palmW * 0.42), pn, palmT * 0.25);
    let tdir = norm(addS(addS(a, th, 0.75), pn, 0.35));
    const tpts = [tb], trad = [0.0072 * H];
    let tp = tb;
    const tsegs = [0.17, 0.15, 0.12].map(s => s * L);
    for (let k = 0; k < 3; k++) {
      tdir = norm(addS(tdir, pn, 0.18));
      tp = addS(tp, tdir, tsegs[k]); tpts.push(tp);
      trad.push(0.0066 * H * lerp(1, 0.78, (k + 1) / 3));
    }
    gb.tube(tpts, trad, pn, { cols: 10, w: t => wHand(0.3 + t), col: (t, u) => (Math.cos(u * Math.PI * 2) > 0.3 ? tintPalm(0.7) : [1, 1, 1, 1]) });
  }

  // ---------- head ----------
  headCenter() {
    const P = this.bind[B.head], H = this.d.H;
    return [P[0], P[1] + 0.052 * H, P[2] + 0.010 * H];
  }

  // Unit direction n → head surface point (head-radius units, head-centered). Features are modeled in
  // "face space": fx = x / FACE.sx (left +), fy = y, on the front of the skull (see FACE for the layout).
  // The whole head is pitched slightly forward (chin down) so the Frankfort plane sits level with a
  // neutral neck; without it the rounded skull reads as looking up.
  headShape(n, opts = {}) {
    const [x, y, z] = this.headShape0(n, opts);
    return [x, y * HEAD_PC - z * HEAD_PS, y * HEAD_PS + z * HEAD_PC];
  }

  headShape0(n, opts = {}) {
    const F = FACE, face = this.look.face || 'oval';
    const jawW = { oval: 0.8, square: 0.9, angular: 0.76, round: 0.88 }[face] || 0.8;
    const chinA = { oval: 0.045, square: 0.045, angular: 0.06, round: 0.032 }[face] || 0.045;
    const cheekA = { oval: 0.04, square: 0.035, angular: 0.055, round: 0.045 }[face] || 0.04;
    const [nx, ny, nz] = n;
    // cranium: ellipsoid with a narrower crown; lower face tapers into the jaw and tucks in at the back
    let sx = F.sx, sy = 1.0, sz = nz > 0 ? 0.98 : 1.0;
    if (ny > 0.3) sx *= lerp(1, 0.93, smooth(0.3, 1, ny));
    if (ny < 0) { const k = smooth(0, -0.95, ny); sx *= lerp(1, jawW, k); if (nz < 0.3) sz *= lerp(1, 0.84, k * smooth(0.3, -0.4, nz)); }
    let x = nx * sx, y = ny * sy, z = nz * sz;
    if (opts.skullOnly) return [x, y, z];
    const fx = nx / F.sx, fy = ny, ax = Math.abs(fx), sgn = Math.sign(fx) || 1;
    const wf = smooth(0.15, 0.55, nz);
    let dz = 0, dx = 0, dy = 0;
    // underside of the jaw: flatter plane from the chin back to the neck
    if (ny < -0.55) dy += 0.1 * smooth(-0.55, -1, ny) * (1 - smooth(0.25, 0.65, nz));
    // jaw angle (gonion) and mandible line
    dx += sgn * 0.05 * bump2(ax, fy, 0.92, -0.52, 0.24, 0.22) * smooth(-0.5, 0.1, nz) * jawW;
    dy -= 0.03 * bump2(ax, fy, 0.85, -0.6, 0.25, 0.2) * smooth(-0.5, 0.1, nz);
    // forehead & brow ridge; temples
    dz += 0.055 * bump(fy, F.browY + 0.03, 0.11) * bump(fx, 0, 0.95) * wf;
    dz -= 0.02 * bump(fy, 0.55, 0.25) * wf;
    dx -= sgn * 0.03 * bump2(ax, fy, 0.86, 0.25, 0.24, 0.2);
    // eye sockets, cheekbones, cheek hollows
    for (const s of [1, -1]) {
      dz -= 0.085 * bump2(fx, fy, s * F.eyeX, F.eyeY, 0.27, 0.16) * wf;
      dz += cheekA * bump2(fx, fy, s * 0.62, F.eyeY - 0.21, 0.28, 0.19) * wf;
      dx += s * cheekA * 0.25 * bump2(fx, fy, s * 0.72, F.eyeY - 0.2, 0.25, 0.2);
      dz -= 0.022 * bump2(fx, fy, s * 0.58, -0.4, 0.22, 0.14) * wf * this.def;
    }
    // nose: bridge between the eyes → tip → base, with alae (nostril wings)
    const nTop = F.eyeY + 0.08, nTip = F.noseTip, nBase = F.noseBase;
    if (fy < nTop + 0.06 && fy > nBase - 0.05) {
      const prof = fy > nTip ? lerp(0.19, 0.02, Math.pow(smooth(nTip, nTop, fy), 0.8)) : lerp(0.025, 0.19, smooth(nBase - 0.02, nTip, fy));
      const wdt = fy > nTip + 0.05 ? 0.105 : lerp(0.14, 0.105, smooth(nTip - 0.04, nTip + 0.08, fy));
      dz += prof * Math.pow(bump(fx, 0, wdt), 0.7) * wf;
      for (const s of [1, -1]) dz += 0.07 * bump2(fx, fy, s * 0.15, nBase + 0.04, 0.09, 0.065) * wf;
      dy -= 0.025 * bump2(fx, fy, 0, nBase + 0.01, 0.12, 0.04) * wf;
    }
    // philtrum, lips, mouth line, chin
    const mw = F.mouthW;
    dz -= 0.01 * bump2(fx, fy, 0, (nBase + F.lipU) / 2, 0.05, 0.035) * wf;
    const mCurve = F.mouth - 0.012 * Math.min(1, (ax / mw) ** 2);
    dz += 0.024 * bump2(fx, fy, 0, F.lipU, mw * 0.95, 0.055) * wf;
    dz -= 0.013 * bump2(fx, fy, 0, mCurve, mw * 0.98, 0.012) * wf;
    dz += 0.028 * bump2(fx, fy, 0, F.lipL, mw * 0.82, 0.055) * wf;
    for (const s of [1, -1]) dz -= 0.015 * bump2(fx, fy, s * mw * 1.02, F.mouth, 0.05, 0.04) * wf; // mouth corners
    dz -= 0.02 * bump2(fx, fy, 0, F.lipL - 0.075, mw * 0.7, 0.035) * wf;
    dz += 0.022 * bump2(fx, fy, 0, F.mouth, 0.5, 0.2) * wf;     // muzzle
    dz += chinA * bump2(fx, fy, 0, F.chinY + 0.1, 0.38, 0.19) * wf;
    dy -= 0.035 * bump2(fx, fy, 0, F.chinY + 0.05, 0.3, 0.12) * wf;
    // eye openings: push the skin behind the eyeball inside an almond-shaped lid opening
    if (!opts.noEyes) for (const s of [1, -1]) {
      const ox = fx - s * F.eyeX;
      const ex = ox / F.eyeW, ey = (fy - F.eyeY - 0.05 * ox * s) / F.eyeH;
      const alm = ex * ex + ey * ey / Math.max(0.15, 1 - 0.55 * ex * ex);
      if (alm < 1.4 && nz > 0.55) {
        dz -= 0.11 * (1 - smooth(0.8, 1.08, alm));
        dz += 0.014 * bump(alm, 1.12, 0.26); // lid rim
      }
      dz -= 0.008 * bump2(fx, fy, s * F.eyeX, F.eyeY + 0.075, 0.16, 0.02) * wf; // upper lid crease
    }
    return [x + dx, y + dy, z + dz];
  }

  // Head mesh: spherical grid warped to put most vertices on the face
  buildHead() {
    const gb = new GB(), R = this.d.headR, c = this.headCenter();
    const det = this.detail;
    const ws = Math.round(84 * det) + 12, hs = Math.round(64 * det) + 10;
    // u → theta: dense on the face (theta≈π/2 is +Z front)
    // θ: 2.2× denser on the face (θ = π/2 is +Z), φ: denser around the equator (eyes → mouth)
    const warpU = u => { const t = u * 2 * Math.PI; return t - 0.74 * Math.sin(t - Math.PI / 2); };
    const warpV = v => Math.PI * (v + 0.115 * Math.sin(2 * Math.PI * v));
    const idx = [];
    for (let j = 0; j <= hs; j++) {
      idx.push([]);
      const v = j / hs, phi = warpV(v);
      for (let i = 0; i <= ws; i++) {
        const th = warpU(i / ws);
        const n = [-Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi)];
        const s = this.headShape(n);
        const p = [c[0] + s[0] * R, c[1] + s[1] * R, c[2] + s[2] * R];
        const wn = smooth(-0.55, -0.95, n[1]) * (n[2] < 0.3 ? 1 : 0.4);
        // uv: unwarped spherical coordinates (face painter uses the same mapping)
        const tu = th / (2 * Math.PI);
        // AO: inner corners of eyes, nostrils, mouth corners, under nose
        let ao = 1;
        const fx = n[0] / FACE.sx, fy = n[1];
        if (n[2] > 0.4) {
          for (const sg of [1, -1]) { ao -= 0.25 * bump2(fx, fy, sg * (FACE.eyeX - FACE.eyeW * 0.95), FACE.eyeY, 0.06, 0.05); ao -= 0.2 * bump2(fx, fy, sg * FACE.mouthW * 0.95, FACE.mouth, 0.05, 0.03); }
          ao -= 0.18 * bump2(fx, fy, 0, FACE.noseBase + 0.01, 0.16, 0.04);
          ao -= 0.12 * bump2(fx, fy, 0, -0.95, 0.6, 0.12);
        }
        idx[j].push(gb.v(p, [tu, phi / Math.PI], [1, 1, 1, ao], [[B.head, 1 - wn * 0.5], [B.neck, wn * 0.5]]));
      }
    }
    for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
      const a = idx[j][i], b = idx[j + 1][i], d = idx[j][i + 1], e = idx[j + 1][i + 1];
      if (j !== 0) gb.tri(a, b, d);
      if (j !== hs - 1) gb.tri(d, b, e);
    }
    this.buildEars(gb);
    return gb.finish();
  }

  buildEars(gb) {
    const R = this.d.headR, c = this.headCenter();
    for (const sg of [1, -1]) {
      // ear root on the skull behind the jaw, between brow and nose-base height
      const dirn = norm([sg * 1, -0.07, -0.16]);
      const sp = this.headShape(dirn, { skullOnly: true });
      const base = [c[0] + sp[0] * R * 0.97, c[1] + sp[1] * R, c[2] + sp[2] * R];
      const out = norm([sg, 0, -0.42]);           // the ear stands off the head, angled back
      const up = norm([0, 1, 0.16]);
      let back = norm(cross(out, up)); if (back[2] > 0) back = scale(back, -1); // points toward the back of the head
      const ws = 22, hs = 9;
      const outline = a => {
        const ca = Math.cos(a), sa = Math.sin(a);
        const h = 0.27 * R * (sa < 0 ? 0.82 : 1);                 // lobe slightly shorter
        const w = (ca > 0 ? 0.17 : 0.06) * R;                     // attached at the front edge
        return [ca * w, sa * h, ca, sa];
      };
      const sheet = (sideSign) => {
        const rows = [];
        for (let j = 0; j <= hs; j++) {
          const sr = j / hs; rows.push([]);
          for (let i = 0; i <= ws; i++) {
            const a = i / ws * Math.PI * 2;
            const [bx, uy, ca] = outline(a);
            const stand = 0.015 * R + 0.12 * R * smooth(-0.4, 1, ca) * Math.pow(sr, 0.8);   // flare toward the back rim
            const helix = 0.03 * R * bump(sr, 0.93, 0.12) * smooth(-0.3, 0.3, ca + 0.4);
            const anti = 0.018 * R * bump(sr, 0.62, 0.16);
            const concha = -0.03 * R * bump(sr, 0.22, 0.3) * smooth(-0.6, 0.2, ca);
            const thick = 0.022 * R * (1 - smooth(0.85, 1.0, sr));
            const d = sideSign > 0 ? stand + helix + anti + concha : stand - thick;
            const p = addS(addS(addS(base, back, bx * sr), up, uy * sr), out, d);
            const shade = sideSign > 0 ? (sr < 0.45 ? 0.72 : 1) : 0.9;
            rows[j].push(gb.v(p, [sg > 0 ? 0.5 : 0.0, 0.52], [1.04, 0.96, 0.95, shade], [[B.head, 1]]));
          }
        }
        return rows;
      };
      const F = sheet(1), Bk = sheet(-1);
      // orientation: front sheet faces `out`
      const flip = dot(cross(back, up), out) < 0;
      for (const [rows, outward] of [[F, true], [Bk, false]]) {
        const f = outward !== flip;
        for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
          const a = rows[j][i], b = rows[j + 1][i], d = rows[j][i + 1], e = rows[j + 1][i + 1];
          if (f) { gb.tri(a, b, d); gb.tri(d, b, e); } else { gb.tri(a, d, b); gb.tri(d, e, b); }
        }
      }
    }
  }

  // Eyeballs: sclera, iris, pupil and a raised cornea for a wet highlight
  eyeCenters() {
    const R = this.d.headR, c = this.headCenter();
    return [1, -1].map(sg => {
      const fx = sg * FACE.eyeX, fy = FACE.eyeY;
      const nz = Math.sqrt(Math.max(0.1, 1 - (fx * FACE.sx) ** 2 - fy * fy));
      const s = this.headShape([fx * FACE.sx, fy, nz], { noEyes: true });
      const er = 0.105 * R;
      return { sg, er, p: [c[0] + s[0] * R, c[1] + s[1] * R - 0.006 * R, c[2] + (s[2] - 0.045) * R - er * 0.72] };
    });
  }
  buildEyes() {
    const gb = new GB();
    const iris = hexToRgb(this.look.eyes || '#3a2418');
    for (const { er, p: ec } of this.eyeCenters()) {
      const ws = 32, hs = 26, idx = [];
      for (let j = 0; j <= hs; j++) {
        idx.push([]);
        const phi = j / hs * Math.PI;
        for (let i = 0; i <= ws; i++) {
          const th = i / ws * Math.PI * 2;
          // pole of this sphere points forward (+Z)
          const nx = Math.cos(th) * Math.sin(phi), ny = Math.sin(th) * Math.sin(phi), nz = Math.cos(phi);
          const front = nz;
          let col;
          if (front > 0.975) col = [0.015, 0.012, 0.012, 1];
          else if (front > 0.885) { const k = (front - 0.885) / 0.09; col = [iris[0] * (0.65 + 0.55 * k), iris[1] * (0.65 + 0.55 * k), iris[2] * (0.65 + 0.55 * k), 1]; }
          else if (front > 0.865) col = [0.22, 0.18, 0.16, 1];
          else col = [0.74, 0.7, 0.66, 1];
          const lid = 1 - 0.45 * smooth(0.15, 0.6, ny) - 0.15 * smooth(-0.3, -0.7, ny); // lids shade the eyeball
          col = [col[0] * lid, col[1] * lid, col[2] * lid, 1];
          const bulge = front > 0.86 ? 1 + 0.07 * smooth(0.86, 1.0, front) : 1;
          idx[j].push(gb.v([ec[0] + nx * er * bulge, ec[1] + ny * er * bulge, ec[2] + nz * er * bulge], [0, 0], col, [[B.head, 1]]));
        }
      }
      for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
        const a = idx[j][i], b = idx[j + 1][i], d = idx[j][i + 1], e = idx[j + 1][i + 1];
        if (j) gb.tri(a, b, d);
        if (j < hs - 1) gb.tri(d, b, e);
      }
    }
    return gb.finish();
  }

  hairCoverage(style, n) {
    const [x, y, z] = n;
    const az = Math.abs(Math.atan2(x, z)); // 0 front, π/2 sides, π back
    let line;
    if (az < 0.62) line = 0.58 + 0.07 * bump(az, 0.48, 0.22) - 0.02 * bump(az, 0, 0.18);          // forehead with temple recession
    else if (az < 1.3) line = lerp(0.6, 0.02, smooth(0.62, 1.3, az));                             // down the temple to the sideburn
    else if (az < 1.95) line = 0.02 + 0.2 * bump(az, 1.62, 0.36);                                  // up and over the ear
    else line = lerp(0.02, -0.5, smooth(1.95, 2.9, az));                                           // down to the nape
    if (style === 'fade') line = Math.max(line, az > 1.1 ? 0.42 : line);
    if (style === 'high_top') line = Math.max(line, 0.3);
    return y - line;
  }

  // v0.4.4: how far the hair stands off the skull in direction n (same rules as buildHair, with the noisy
  // styles taken at their peak), so the headband can sit on top of any hairstyle instead of inside it
  hairOffsetAt(n) {
    const style = this.look.hair || 'crop';
    if (style === 'bald') return 0;
    const cov = this.hairCoverage(style, n);
    if (cov < -0.12) return 0;
    const thick = { buzz: 0.02, crop: 0.05, fade: 0.055, curls: 0.15, twists: 0.12, high_top: 0.12, cornrows: 0.028, waves: 0.032 }[style] ?? 0.05;
    const edge = smooth(-0.03, style === 'fade' ? 0.35 : 0.2, cov);
    let o = 0.008 + thick * edge;
    if (style === 'curls') o += (0.022 + 0.05 * Math.max(0, n[1])) * smooth(0, 0.3, cov);
    if (style === 'twists') o += 0.045 * smooth(0, 0.25, cov);
    if (style === 'high_top') o += 0.55 * smooth(0.2, 0.8, n[1]) + 0.04;
    if (style === 'cornrows') o += 0.012 * edge;
    return o;
  }

  buildHair() {
    const style = this.look.hair || 'crop';
    if (style === 'bald') return null;
    const gb = new GB(), R = this.d.headR, c = this.headCenter();
    const ws = Math.round(96 * this.detail) + 16, hs = Math.round(56 * this.detail) + 10;
    const thick = { buzz: 0.02, crop: 0.05, fade: 0.055, curls: 0.15, twists: 0.12, high_top: 0.12, cornrows: 0.028, waves: 0.032 }[style] ?? 0.05;
    const idx = [];
    for (let j = 0; j <= hs; j++) {
      idx.push([]);
      const v = j / hs, phi = v * Math.PI * 0.8;
      for (let i = 0; i <= ws; i++) {
        const u = i / ws, t = u * Math.PI * 2, th = t - 0.6 * Math.sin(t - Math.PI / 2);
        const n = [-Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi)];
        const cov = this.hairCoverage(style, n);
        const s = this.headShape(n, { skullOnly: true });
        // tapered edge: hair gets thinner toward the hairline (fade styles taper over a longer band)
        const edge = smooth(-0.03, style === 'fade' ? 0.35 : 0.2, cov);
        let o = 0.008 + thick * edge;
        if (style === 'curls') o += (0.022 * Math.sin(th * 13) * Math.sin(phi * 15) + 0.05 * Math.max(0, n[1])) * smooth(0, 0.3, cov);
        if (style === 'twists') o += 0.045 * Math.pow(Math.max(0, Math.sin(th * 20) * Math.sin(phi * 16)), 0.6) * smooth(0, 0.25, cov);
        if (style === 'high_top') o += 0.55 * smooth(0.2, 0.8, n[1]);
        if (style === 'cornrows') o += 0.012 * Math.abs(Math.sin(th * 14)) * edge;
        const len = Math.hypot(s[0], s[1], s[2]);
        let p = [s[0] + s[0] / len * o, s[1] + s[1] / len * o, s[2] + s[2] / len * o];
        if (style === 'high_top') { p[1] = Math.min(p[1], 1.42); p[0] *= 1 + 0.08 * smooth(0.3, 0.9, n[1]); }
        // alpha in vertex color: soft hairline (the material alpha-tests a noisy texture against it)
        const a = smooth(-0.03, 0.07, cov);
        idx[j].push(cov < -0.12 ? -1 : gb.v([c[0] + p[0] * R, c[1] + p[1] * R, c[2] + p[2] * R], [u * 4, v * 3], [1, 1, 1, a], [[B.head, 1]]));
      }
    }
    for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
      const a = idx[j][i], b = idx[j + 1][i], d = idx[j][i + 1], e = idx[j + 1][i + 1];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      if (j) gb.tri(a, b, d);
      gb.tri(d, b, e);
    }
    return gb.finish();
  }

  // ---------- apparel ----------
  topCut(top) {
    const fam = top.family || 'jersey';
    const tank = fam === 'jersey';
    const hem = fam === 'compression' ? 0.5 : top.tucked ? 0.565 : 0.47;
    const neckTop = fam === 'hoodie' ? 0.856 : tank ? 0.83 : 0.843;
    // v0.4.5: a basketball tank is cut along curves, not boxes: a U-shaped scoop neck in front, a shallower one in
    // back, wide straps over the trapezius and deep, rounded armholes. topY(phi) is the top edge of the fabric at
    // each angle around the body; the mesh columns run from the hem up to exactly that edge (no stair-steps).
    const topY = tank ? phi => {
      const a = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))); // 0 front .. π back
      const back = a > Math.PI / 2, b = back ? Math.PI - a : a;      // mirrored: 0 = center line .. π/2 = side
      const aI = 0.31, aO = 0.7, yT = neckTop, yN = back ? 0.808 : 0.783, yA = 0.744;
      if (b < aI) return yN + (yT - yN) * Math.pow(b / aI, 2.3);                     // neckline
      if (b <= aO) return yT - 0.003 * Math.pow((b - aI) / (aO - aI), 2);             // strap (slight slope out)
      const q = (b - aO) / (Math.PI / 2 - aO);
      return yA + (yT - 0.003 - yA) * Math.pow(Math.cos(q * Math.PI / 2), 0.62);     // armhole
    } : null;
    const keep = (yf, phi) => {
      const s = Math.abs(Math.sin(phi)), front = Math.cos(phi) > 0;
      if (yf > neckTop + 1e-4 || yf < hem - 1e-4) return false;
      if (tank) return yf <= topY(phi) + 1e-4;
      if (yf > 0.83 && front && s < 0.32) return false;
      return true;
    };
    return { fam, tank, hem, neckTop, keep, topY };
  }

  buildTop(top) {
    const { fam, tank, hem, neckTop, keep, topY } = this.topCut(top);
    const gb = new GB(), H = this.d.H;
    const base = fam === 'compression' ? 0.0025 : fam === 'hoodie' ? 0.016 : 0.009;
    const tucked = !!top.tucked && fam !== 'compression';
    // loose fit with soft vertical folds below the chest; fabric drapes over the bumps
    const loose = (yf, phi) => {
      const below = smooth(0.74, 0.55, yf);
      const folds = fam === 'compression' ? 0 : 0.0028 * below * (Math.sin(phi * 7 + 1.3) * 0.6 + Math.sin(phi * 12 + 0.4) * 0.4);
      let l = base * (yf > 0.8 ? 0.45 : 1) + folds;
      // v0.4.4: an untucked top always hangs outside the shorts' waistband and seat (which sit at
      // 0.011-0.0185 off the body), so the shorts never poke through the hem; a tucked one stays inside them
      if (fam !== 'compression' && !tucked) l = Math.max(l, (0.017 + 0.0135 * smooth(0.57, 0.47, yf)) * smooth(0.66, 0.6, yf) + Math.abs(folds) * 0.5); // v0.4.5: more room over the shorts' legs
      if (tucked) l = Math.min(l, lerp(0.006, l, smooth(0.6, 0.64, yf)));
      return l;
    };
    const vTop = neckTop, vHem = hem;
    // v0.4.5: sleeker fit (the top used to hang almost straight down from the chest, which read boxy)
    const hang = fam === 'compression' ? 0 : tucked ? yf => lerp(0.3, 0.8, smooth(0.6, 0.66, yf)) : 0.8;
    this.loftTorso(gb, {
      y0: hem, y1: neckTop, hang, loose, keep: tank ? null : keep, topY,
      uv: (u, t, yf) => [u, (vTop - yf) / (vTop - vHem) * 0.75], col: () => null, cols: Math.round((tank ? 96 : 44) * this.detail) + (tank ? 16 : 8),
    });
    if (tank) {
      // v0.4.5: a rolled binding along the neckline and armholes gives the edge real thickness (it read as a paper
      // cut-out before) and keeps the edge off the skin. uv points at the trim color in the texture.
      const cols = Math.round(160 * this.detail) + 24, hg = typeof hang === 'function' ? hang : () => hang;
      const ring = [[-0.0075, 0.0026], [-0.0012, 0.0036], [0.0004, 0.0016], [-0.004, -0.0002]];
      gb.grid(ring.length, cols, (r, c) => {
        const phi = c / cols * Math.PI * 2 - Math.PI / 2, y = topY(phi) + ring[r][0];
        const p = this.torsoPoint(y, phi, loose(y, phi) + ring[r][1], hg(y));
        return { p, uv: [c / cols, 0.744], w: this.torsoWeights(p[1], Math.sin(phi), p[0]) };
      });
    }
    if (!tank) {
      const sleeveEnd = fam === 'tee' ? 0.48 : fam === 'compression' ? 0.92 : 1.0;
      for (const side of ['L', 'R']) {
        const clav = B['clav' + side], up = B['upper' + side], fo = B['fore' + side], ha = B['hand' + side];
        const off = fam === 'compression' ? 0.0025 : fam === 'tee' ? 0.013 : 0.016;
        const flare = fam === 'tee' ? 0.006 : 0;
        this.loftLimb(gb, up, fo, (t, p, ls) => this.upperArmR(t, p, ls) * (fam === 'compression' ? 1 : 0.92) + 0.004 + flare * smooth(0.1, sleeveEnd, t), this.jointBlend(clav, up, fo, 0.2), { t0: -0.07, t1: sleeveEnd > 0.9 ? 1.07 : sleeveEnd, offset: off, uv: (u, t) => [u * 0.5 + (side === 'L' ? 0.5 : 0), 0.78 + t * 0.1] });
        if (sleeveEnd > 0.9 && fam !== 'tee') this.loftLimb(gb, fo, ha, (t, p, ls) => this.foreArmR(t, p, ls), this.jointBlend(up, fo, ha, 0.12), { t0: -0.08, t1: 0.93, offset: off * 0.9, uv: (u, t) => [u * 0.5 + (side === 'L' ? 0.5 : 0), 0.88 + t * 0.12] });
      }
      if (fam === 'hoodie') {
        const P = this.bind[B.chest];
        const n = 16, rows = 7;
        gb.grid(rows, n, (r, c) => {
          const a = c / n * Math.PI * 1.2 - Math.PI * 0.6, t = r / (rows - 1);
          const rad = 0.07 * H * (0.6 + 0.4 * Math.sin(t * Math.PI));
          const y = (0.8 + t * 0.06) * H, z = P[2] - 0.058 * H - Math.cos(a) * rad * 0.6;
          return { p: [Math.sin(a) * rad * 1.1, y, z], uv: [0.1, 0.8], w: this.torsoWeights(y, Math.sin(a) * 0.5, Math.sin(a)) };
        }, { inward: true });
      }
    }
    return gb.finish();
  }

  buildBottom(bot) {
    const fam = bot.family || 'shorts';
    const gb = new GB();
    const waist = 0.6;
    // v0.4.5: tights (the King Tut Cup mo-cap suit) hug the body: no drape over the hips, legs just over the skin
    const tight = bot.pattern === 'mocap' || fam === 'tights';
    const baggy = tight ? 0.002 : fam === 'joggers' ? 0.011 : 0.0165; // v0.4.5: a trimmer short (the old one read as a tube on a bent knee)
    this.loftTorso(gb, {
      y0: 0.452, y1: waist, cols: Math.round(40 * this.detail) + 8, hang: tight ? 0 : 0.3,
      loose: tight ? () => 0.0035 : (yf, phi) => 0.011 + 0.006 * smooth(0.52, 0.47, yf) + 0.0015 * Math.sin(phi * 9) * smooth(0.56, 0.48, yf),
      uv: (u, t) => [u, 0.5 - t * 0.5], col: () => null,
    });
    for (const side of ['L', 'R']) {
      const th = B['thigh' + side], sh = B['shin' + side], ft = B['foot' + side];
      const len = fam === 'joggers' ? 1 : (bot.length || 0.88);
      this.loftLimb(gb, th, sh, (t, p, ls) => {
        // baggy shorts: cylinder that widens toward the hem, with soft folds
        if (tight) return this.thighR(t, p, ls) + 0.0045;
        const r = Math.max(profile(THIGH, t) * Math.min(1.12, this.d.girth), profile(THIGH, 0.1) * 0.95) + baggy * (0.6 + t * 0.35);
        // v0.4.4: never tighter than the thigh underneath (heavy, muscular builds) so the leg can't poke through
        return Math.max(r + (fam === 'joggers' ? 0 : 0.0022 * Math.sin(p * 6 + t * 3) * smooth(0.2, 0.9, t)), this.thighR(t, p, ls) + 0.005);
      }, t => {
        const base = this.jointBlend(-1, th, sh, 0.12)(t);
        const wh = 0.5 * (1 - smooth(-0.15, 0.15, t));
        return [[B.hips, wh], ...base.map(([b, w]) => [b, b === th ? w - wh : w])];
      }, { t0: -0.12, t1: Math.min(1.14, fam === 'joggers' ? 1.04 : len), uv: (u, t) => [u * 0.5 + (side === 'L' ? 0.5 : 0), 0.5 + t * 0.5], rows: 12 });
      // v0.4.5: a rolled hem that folds back in to the leg, so a driven knee never shows the inside of the
      // shorts (or the thigh through the opening)
      const hemT = Math.min(1.14, fam === 'joggers' ? 1.04 : len);
      const wfn = t => {
        const base = this.jointBlend(-1, th, sh, 0.12)(t);
        const wh = 0.5 * (1 - smooth(-0.15, 0.15, t));
        return [[B.hips, wh], ...base.map(([b, w]) => [b, b === th ? w - wh : w])];
      };
      if (!tight) this.loftLimb(gb, th, sh, (t, p, ls) => {
        const k = smooth(hemT - 0.04, hemT, t);     // 0 at the hem, 1 just inside it
        const outer = Math.max(profile(THIGH, t) * Math.min(1.12, this.d.girth), profile(THIGH, 0.1) * 0.95) + baggy * (0.6 + t * 0.35);
        return lerp(Math.max(outer, this.thighR(t, p, ls) + 0.005), this.thighR(t, p, ls) + 0.0035, k);
      }, wfn, { t0: hemT - 0.04, t1: hemT, uv: (u, t) => [u * 0.5 + (side === 'L' ? 0.5 : 0), 0.99 - t * 0.01], rows: 4 });
      if (fam === 'joggers') {
        this.loftLimb(gb, sh, ft, (t, p, ls) => (tight ? this.shinR(t, p, ls) + 0.0045 : this.shinR(t, p, ls) * 0.85 + 0.012 - t * 0.004), this.jointBlend(th, sh, ft, 0.1), { t0: -0.02, t1: 0.95, uv: (u, t) => [u * 0.5 + (side === 'L' ? 0.5 : 0), 0.75 + t * 0.25] });
      }
    }
    return gb.finish();
  }

  // Gear: socks, shoes, sleeves, bands, pads — colored by vertex color
  buildGear(gear) {
    const gb = new GB(), sgb = new GB(), H = this.d.H;
    this.shoeGeo = null;
    const sock = gear.socks ? [...hexLinear(gear.socks.color), 1] : [0.94, 0.94, 0.92, 1];
    // v0.4.4: an arm sleeve under a hoodie or a leg sleeve under joggers is left out (it could only poke through);
    // sleeves and pads worn over compression sleeves or joggers sit on top of the fabric so they stay fully visible
    const topFam = this.look.top?.family || 'jersey', botFam = this.look.bottom?.family || 'shorts';
    const underHoodie = topFam === 'hoodie', overComp = topFam === 'compression' ? 0.006 : 0, joggers = botFam === 'joggers';
    const sockLen = joggers ? 0.9 : gear.socks?.style === 'ankle' ? 0.9 : gear.socks?.style === 'tall' ? 0.45 : 0.64;
    for (const side of ['L', 'R']) {
      const th = B['thigh' + side], sh = B['shin' + side], ft = B['foot' + side];
      const fo = B['fore' + side], ha = B['hand' + side], up = B['upper' + side], clav = B['clav' + side];
      // socks (ribbed via a fine radial wave)
      this.loftLimb(gb, sh, ft, (t, p, ls) => this.shinR(t, p, ls) + 0.0032 + 0.0004 * Math.sin(p * 28), this.jointBlend(th, sh, ft, 0.1), { t0: sockLen, t1: 1.03, col: (t) => (t < sockLen + 0.04 && gear.socks?.stripe ? [...hexLinear(gear.socks.stripe), 1] : sock), rows: 7 });
      this.buildShoe(sgb, side, gear.shoes || {});
      if (gear.sleeve && !underHoodie && side === (gear.sleeve.side || 'R')) {
        const sc = [...hexLinear(gear.sleeve.color), 1];
        this.loftLimb(gb, up, fo, (t, p, ls) => this.upperArmR(t, p, ls) + 0.0038 + overComp, this.jointBlend(clav, up, fo, 0.2), { t0: 0.14, t1: 1.02, col: () => sc });
        this.loftLimb(gb, fo, ha, (t, p, ls) => { const r = this.foreArmR(t, p, ls); return [r[0] + 0.0036 + overComp, r[1] + 0.0036 + overComp]; }, this.jointBlend(up, fo, ha, 0.12), { t0: -0.02, t1: 0.95, col: () => sc });
      }
      if (gear.wristband) {
        const wc = [...hexLinear(gear.wristband.color), 1];
        this.loftLimb(gb, fo, ha, (t, p, ls) => { const r = this.foreArmR(t, p, ls); const o = 0.0068 + (topFam === 'hoodie' ? 0.0148 : topFam === 'compression' ? 0.0024 : 0); return [r[0] + o, r[1] + o]; }, this.jointBlend(up, fo, ha, 0.12), { t0: 0.76, t1: 0.95, col: () => wc, rows: 5 });
      }
      if (gear.legSleeve && !joggers && side === (gear.legSleeve.side || 'L')) {
        const lc = [...hexLinear(gear.legSleeve.color), 1];
        this.loftLimb(gb, sh, ft, (t, p, ls) => this.shinR(t, p, ls) + 0.0036, this.jointBlend(th, sh, ft, 0.1), { t0: -0.04, t1: sockLen + 0.02, col: () => lc });
        this.loftLimb(gb, th, sh, (t, p, ls) => this.thighR(t, p, ls) + 0.004, this.jointBlend(-1, th, sh, 0.12), { t0: 0.52, t1: 1.02, col: () => lc });
      }
      if (gear.kneePad && side === (gear.kneePad.side || 'R')) {
        const kc = [...hexLinear(gear.kneePad.color), 1];
        const ko = 0.0088 + (joggers ? 0.017 : 0);
        this.loftLimb(gb, th, sh, (t, p, ls) => this.thighR(t, p, ls) + ko + 0.003 * bumpAng(p, 0, 1.2), this.jointBlend(-1, th, sh, 0.12), { t0: 0.86, t1: 1.02, col: () => kc, rows: 5 });
        this.loftLimb(gb, sh, ft, (t, p, ls) => this.shinR(t, p, ls) + ko + 0.003 * bumpAng(p, 0, 1.2), this.jointBlend(th, sh, ft, 0.1), { t0: -0.03, t1: 0.13, col: () => kc, rows: 5 });
      }
    }
    if (gear.headband) {
      // v0.4.5: a glow-in-the-dark band (King Tut Cup) is painted brighter than any dye can be, so it blooms
      const hc = [...hexLinear(gear.headband.color).map(v => v * (gear.headband.glow ? 2.6 : 1)), 1], R = this.d.headR, c = this.headCenter();
      const rows = 4, cols = 40;
      gb.grid(rows, cols, (r, k) => {
        const th = k / cols * Math.PI * 2, y = 0.36 + r / (rows - 1) * 0.17;
        const n = norm([Math.sin(th), y, Math.cos(th)]);
        const s = this.headShape(n, { skullOnly: true }), len = Math.hypot(...s);
        const o = Math.max(0.03, this.hairOffsetAt(n) + 0.02); // on top of the hair, whatever the style
        return { p: [c[0] + (s[0] + s[0] / len * o) * R, c[1] + (s[1] + s[1] / len * o) * R, c[2] + (s[2] + s[2] / len * o) * R], col: hc, w: [[B.head, 1]] };
      });
    }
    // v0.4.4: chains are their own textured meshes (link tube + pendant), draped over whatever top is worn
    this.chainGeo = gear.chain ? this.buildChain(gear.chain) : null;
    this.shoeGeo = sgb.finish();
    return gb.finish();
  }

  // v0.4.4 chain: a closed tube of links resting on the traps at the back and dipping to the chest in front,
  // offset off the body by the top's fabric (so it never sinks into a jersey or hoodie), plus a pendant.
  // UV u runs along the chain in link repeats (the link texture tiles), v around the tube.
  buildChain(spec) {
    const H = this.d.H, top = this.look.top || { family: 'jersey' };
    const fam = top.family || 'jersey';
    const fabric = fam === 'compression' ? 0.0025 : fam === 'hoodie' ? 0.016 : 0.009;
    const iced = spec.kind === 'ice';
    const drape = fam === 'compression' ? 0 : 0.8; // same drape as buildTop, so the chain follows the fabric
    const r = iced ? 0.0042 : 0.0036; // tube radius (H units)
    const path = [], wts = [], N = 72;
    // point on the (clothed) body surface at height yf with lateral offset xt (H units), front or back
    const surf = (yf, xt, frontSide, loose) => {
      let lo = frontSide ? 0 : Math.PI / 2, hi = frontSide ? Math.PI / 2 : Math.PI, phi = (lo + hi) / 2;
      for (let k = 0; k < 24; k++) {
        phi = (lo + hi) / 2;
        const x = Math.abs(this.torsoPoint(yf, phi, loose, drape)[0]) / H;
        if ((x < xt) === frontSide) lo = phi; else hi = phi;
      }
      return phi;
    };
    for (let i = 0; i <= N; i++) {
      // the chain sits at the base of the neck at the back and sides, then drops in a U to the sternum
      const ang = -Math.PI + (i / N) * Math.PI * 2, c0 = Math.cos(ang), side = Math.sign(Math.sin(ang)) || 1;
      const front = Math.pow((1 + c0) / 2, 1.6);
      const yf = 0.838 - 0.072 * front;
      const xt = Math.abs(Math.sin(ang)) * (0.056 - 0.01 * front);
      const cloth = fam === 'hoodie' ? fabric : yf > 0.8 ? fabric * 0.45 : fabric;
      const loose = cloth + r + 0.0022;
      const phi = surf(yf, xt, c0 >= 0, loose) * side;
      const p = this.torsoPoint(yf, phi, loose, drape);
      path.push(p);
      wts.push(this.torsoWeights(p[1], Math.sin(phi), p[0]));
    }
    let len = 0; const acc = [0];
    for (let i = 1; i < path.length; i++) { len += Math.hypot(...sub(path[i], path[i - 1])); acc.push(len); }
    const linkRepeat = 0.06 * H; // one texture tile (4 links)
    const gb = new GB();
    gb.tube(path, path.map(() => r * H), [0, 1, 0], {
      cols: 10, capEnd: false,
      uv: (t, c) => [acc[Math.round(t * N)] / linkRepeat, c],
      w: t => wts[Math.round(t * N)],
    });
    const chain = gb.finish();
    // pendant: a medallion hanging just below the lowest point, facing forward with the chest
    const pg = new GB(), lo = path[N / 2], w = wts[N / 2];
    const pr = (iced ? 0.02 : 0.017) * H, th = 0.004 * H;
    const cz = lo[2] + 0.004 * H, cy = lo[1] - pr - 0.004 * H;
    const seg = 28;
    const ringF = [], ringB = [];
    for (let k = 0; k <= seg; k++) {
      const a = k / seg * Math.PI * 2, x = Math.sin(a) * pr, y = Math.cos(a) * pr;
      ringF.push(pg.v([lo[0] + x, cy + y, cz + th], [0.5 + Math.sin(a) * 0.5, 0.5 - Math.cos(a) * 0.5], null, w));
      ringB.push(pg.v([lo[0] + x, cy + y, cz - th], [0.5 + Math.sin(a) * 0.5, 0.5 - Math.cos(a) * 0.5], null, w));
    }
    pg.capRing(ringF, [lo[0], cy, cz + th], [0.5, 0.5], null, w, true);
    pg.capRing(ringB, [lo[0], cy, cz - th], [0.5, 0.5], null, w, false);
    for (let k = 0; k < seg; k++) { pg.tri(ringF[k], ringB[k], ringB[k + 1]); pg.tri(ringF[k], ringB[k + 1], ringF[k + 1]); }
    // bail (the loop the chain runs through)
    pg.tube([[lo[0], cy + pr, cz], [lo[0], cy + pr + 0.006 * H, cz + 0.001 * H], [lo[0], lo[1], lo[2]]], [0.0022 * H, 0.0022 * H, 0.002 * H], [0, 0, 1], { cols: 8, uv: () => [0.95, 0.5], w: () => w });
    return { chain, pendant: pg.finish(), iced };
  }

  // Basketball shoe: rubber outsole, thick midsole and an upper with a rounded toe box and heel, built as two
  // half shells (lateral / medial) so it can carry a painted texture (v0.4.3: designs come from paintShoe
  // in looks.js; before this the details were vertex colours too fine for the mesh and in the wrong space).
  // UV: u = side half (lateral 0..0.5, medial 0.5..1) + heel→toe; v = 0 sole centre → 0.5 midsole top edge →
  // 1 top centre (laces).
  buildShoe(gb, side, shoe) {
    const H = this.d.H, ft = B['foot' + side], toe = B['toe' + side];
    const A = this.bind[ft], T = this.bind[toe];
    const cut = shoe.cut || 'mid';
    const collar = { low: 0.058, mid: 0.08, high: 0.108 }[cut] * H;
    const heelZ = A[2] - 0.052 * H, toeZ = T[2] + 0.036 * H;
    const sg = side === 'L' ? 1 : -1;
    const toeJ = T[2];
    const rows = 30, half = 14;
    const halfW = t => H * (0.025 + 0.013 * Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.5) - 0.02 * smooth(0.84, 1.0, t));
    const topH = t => lerp(collar, 0.03 * H, smooth(0.22, 0.72, t)) - 0.012 * H * smooth(0.86, 1, t);
    const midH = 0.018 * H;
    const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
    for (const hs of [1, -1]) {
      const lateral = hs * sg > 0;
      gb.grid(rows, half, (r, c) => {
        const t = r / (rows - 1), z = lerp(heelZ, toeZ, t);
        const phi = hs > 0 ? c / half * Math.PI : -Math.PI + c / half * Math.PI; // 0 = top centre, ±pi = sole centre
        const cy = Math.cos(phi), sx = Math.sin(phi);
        const w = halfW(t), h = topH(t);
        let x = sp(sx, 0.5) * w;
        let y = cy >= 0 ? midH + sp(cy, 0.6) * (h - midH) : midH * (1 + cy);
        // rounded heel and toe that close to a point (no open ends)
        const e = t < 0.1 ? Math.sqrt(Math.max(0, 1 - (1 - t / 0.1) ** 2)) : t > 0.9 ? Math.sqrt(Math.max(0, 1 - (1 - (1 - t) / 0.1) ** 2)) : 1;
        const yc = midH * 0.9 + (t < 0.5 ? 0.012 * H : 0.004 * H);
        x *= e; y = yc + (y - yc) * Math.pow(e, 0.8);
        if (cy < 0.05) x *= 1.06; // midsole flares out a little
        const spring = 0.008 * H * smooth(0.82, 1, t); // toe spring lifts the front
        y = Math.max(0, y) + spring * (cy < 0 ? 1 : 0.6);
        x += sg * 0.0015 * H;
        const v = hs > 0 ? 1 - phi / Math.PI : 1 + phi / Math.PI;
        const u = (lateral ? 0.008 : 0.508) + t * 0.484;
        // baked occlusion: midsole seam and the inside of the collar
        const ao = 1 - 0.22 * bump(v, 0.5, 0.05) - 0.3 * smooth(0.93, 1, v) * (t < 0.4 ? 1 : 0);
        const wt = smooth(toeJ - 0.015 * H, toeJ + 0.02 * H, z);
        return { p: [A[0] + x, y, z], uv: [u, 1 - v], col: [1, 1, 1, Math.max(0.55, ao)], w: [[ft, 1 - wt], [toe, wt]] };
      }, { inward: true });
    }
  }

  // v0.4.5 stage 7: the same parts, one per step (see AthleteView.staged)
  *buildSteps(out) {
    const look = this.look;
    out.body = this.buildBody(); yield;
    out.head = this.buildHead(); out.eyes = this.buildEyes(); out.hair = this.buildHair(); yield;
    out.top = this.buildTop(look.top || { family: 'jersey' }); yield;
    out.bottom = this.buildBottom(look.bottom || { family: 'shorts' }); yield;
    out.gear = this.buildGear(look.gear || {}); out.shoes = this.shoeGeo; out.chain = this.chainGeo;
    return out;
  }
  buildAll() {
    const look = this.look;
    return {
      body: this.buildBody(),
      head: this.buildHead(),
      eyes: this.buildEyes(),
      hair: this.buildHair(),
      top: this.buildTop(look.top || { family: 'jersey' }),
      bottom: this.buildBottom(look.bottom || { family: 'shorts' }),
      gear: this.buildGear(look.gear || {}),
      shoes: this.shoeGeo,
      chain: this.chainGeo,
    };
  }
}
