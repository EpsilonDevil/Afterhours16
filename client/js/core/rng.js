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
  // Tileable fbm over period p (in noise units)
  noise.tile = (x, y, p, oct = 4) => {
    let s = 0, amp = 0.5, fr = 1;
    for (let i = 0; i < oct; i++) {
      const P = p * fr, X = x * fr, Y = y * fr;
      const u = X / P, v = Y / P; // blend 4 samples to tile
      const n00 = noise(X, Y), n10 = noise(X - P, Y), n01 = noise(X, Y - P), n11 = noise(X - P, Y - P);
      const fx = u - Math.floor(u), fy = v - Math.floor(v);
      s += amp * ((n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy);
      fr *= 2; amp *= 0.5;
    }
    return s;
  };
  return noise;
}
