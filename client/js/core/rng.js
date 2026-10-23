// Seeded deterministic RNG (mulberry32) used by the simulation and procedural content.
export class RNG {
  constructor(seed = 1) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  normal() { // Box–Muller
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
}
// hashString(a + sep + b) without building the joined string (perf: AIWorld.pick hashes 900 of these a call). The
// same FNV-1a over the same characters in the same order, so the same number
export function hashJoin(a, sep, b) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < a.length; i++) { h ^= a.charCodeAt(i); h = Math.imul(h, 16777619); }
  for (let i = 0; i < sep.length; i++) { h ^= sep.charCodeAt(i); h = Math.imul(h, 16777619); }
  for (let i = 0; i < b.length; i++) { h ^= b.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Smooth value noise for procedural textures/animation.
export function makeNoise2D(seed = 7) {
  const rng = new RNG(seed), perm = new Uint8Array(512), grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; grad[i] = rng.next() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const f = t => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = grad[perm[X + perm[Y]]], b = grad[perm[X + 1 + perm[Y]]], c = grad[perm[X + perm[Y + 1]]], d = grad[perm[X + 1 + perm[Y + 1]]];
    const u = f(xf), v = f(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  noise.fbm = (x, y, oct = 4, lac = 2, gain = 0.5) => {
    let s = 0, amp = 0.5, fr = 1;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * fr, y * fr); fr *= lac; amp *= gain; }
    return s;
  };
  // Tileable fbm over period p (in noise units): each octave blends the four samples (X, Y), (X - P, Y), (X, Y - P),
  // (X - P, Y - P). (qp3 perf: the procedural textures call this tens of millions of times on a first park load. The
  // four samples share two columns and two rows, so each column's and row's floor, fraction, fade and permutation entry
  // is worked out once here instead of once per sample; every value is computed exactly as noise() computes it.)
  noise.tile = (x, y, p, oct = 4) => {
    let s = 0, amp = 0.5, fr = 1;
    for (let i = 0; i < oct; i++) {
      const P = p * fr, X = x * fr, Y = y * fr;
      const u = X / P, v = Y / P; // blend 4 samples to tile
      const X1 = X - P, Y1 = Y - P;
      const xi0 = Math.floor(X), xi1 = Math.floor(X1), yi0 = Math.floor(Y), yi1 = Math.floor(Y1);
      const xf0 = X - xi0, xf1 = X1 - xi1, yf0 = Y - yi0, yf1 = Y1 - yi1;
      const cx0 = xi0 & 255, cx1 = xi1 & 255, ry0 = yi0 & 255, ry1 = yi1 & 255;
      const u0 = xf0 * xf0 * (3 - 2 * xf0), u1 = xf1 * xf1 * (3 - 2 * xf1), v0 = yf0 * yf0 * (3 - 2 * yf0), v1 = yf1 * yf1 * (3 - 2 * yf1);
      const pa0 = perm[ry0], pb0 = perm[ry0 + 1], pa1 = perm[ry1], pb1 = perm[ry1 + 1];
      const n00 = lattice(perm, grad, cx0, u0, pa0, pb0, v0), n10 = lattice(perm, grad, cx1, u1, pa0, pb0, v0);
      const n01 = lattice(perm, grad, cx0, u0, pa1, pb1, v1), n11 = lattice(perm, grad, cx1, u1, pa1, pb1, v1);
      const fx = u - Math.floor(u), fy = v - Math.floor(v);
      s += amp * ((n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy);
      fr *= 2; amp *= 0.5;
    }
    return s;
  };
  return noise;
}
// one value-noise sample from its column (X & 255 and its fade u) and row (perm[Y], perm[Y + 1] and its fade v): the
// same four lattice values and the same blend, term for term, as makeNoise2D's noise(x, y)
function lattice(perm, grad, X, u, pY, pY1, v) {
  const a = grad[perm[X + pY]], b = grad[perm[X + 1 + pY]], c = grad[perm[X + pY1]], d = grad[perm[X + 1 + pY1]];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
