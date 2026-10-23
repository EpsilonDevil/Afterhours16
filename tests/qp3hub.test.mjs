// v0.4.8.9 qp3, the Hub agent's part: faster, byte-identical procedural textures and fewer per-frame allocations.
//  * gfx/fastmath.js hypot2 / hypot3 give exactly Math.hypot's results (V8's algorithm), without its allocation
//  * core/rng.js makeNoise2D's tile() (the shared-column version) gives exactly the original's results
//  * the ground textures (gfx/textures.js asphalt / sand, now painted as bytes, from a worker when prepainted) are the
//    same pixels as before, byte for byte
// Run: node --test tests/qp3hub.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

let put = null;
const fake2d = new Proxy({}, { get: (o, k) => (k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : k === 'putImageData' ? img => { put = img.data; } : () => {}), set: () => true });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fake2d; } };
const { hypot2, hypot3 } = await import('../client/js/gfx/fastmath.js');
const { makeNoise2D, RNG } = await import('../client/js/core/rng.js');
const T = await import('../client/js/gfx/textures.js');
const fnv = d => { let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };

test('hypot2 and hypot3 are Math.hypot, bit for bit', () => {
  const r = new RNG(77), sc = [1e-300, 1e-9, 1e-3, 1, 7, 1e4, 1e150, 1e300];
  for (let i = 0; i < 300000; i++) {
    const s = sc[i % sc.length], x = (r.next() - 0.5) * s * (i % 11 ? 1 : 0), y = (r.next() - 0.5) * sc[(i >> 3) % sc.length], z = (r.next() - 0.5) * s;
    assert.ok(Object.is(hypot3(x, y, z), Math.hypot(x, y, z)), `hypot3 ${x} ${y} ${z}`);
    assert.ok(Object.is(hypot2(x, y), Math.hypot(x, y)), `hypot2 ${x} ${y}`);
  }
  for (const t of [[0, 0, 0], [-0, -0, 0], [NaN, 1, 2], [Infinity, NaN, 1], [NaN, Infinity, 1], [1, NaN, -Infinity], [3, 4, 0], [5e-324, 0, 0]]) {
    assert.ok(Object.is(hypot3(...t), Math.hypot(...t)), String(t));
    assert.ok(Object.is(hypot2(t[0], t[1]), Math.hypot(t[0], t[1])), String(t));
  }
});

// the tile() of makeNoise2D as it was before qp3 (four noise() calls an octave), for the comparison
function refNoise(seed) {
  const rng = new RNG(seed), perm = new Uint8Array(512), grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; grad[i] = rng.next() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const f = t => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = grad[perm[X + perm[Y]]], b = grad[perm[X + 1 + perm[Y]]], c = grad[perm[X + perm[Y + 1]]], d = grad[perm[X + 1 + perm[Y + 1]]];
    const u = f(xf), v = f(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, p, oct = 4) => {
    let s = 0, amp = 0.5, fr = 1;
    for (let i = 0; i < oct; i++) {
      const P = p * fr, X = x * fr, Y = y * fr, u = X / P, v = Y / P;
      const n00 = noise(X, Y), n10 = noise(X - P, Y), n01 = noise(X, Y - P), n11 = noise(X - P, Y - P);
      const fx = u - Math.floor(u), fy = v - Math.floor(v);
      s += amp * ((n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy);
      fr *= 2; amp *= 0.5;
    }
    return s;
  };
}
test('noise.tile is exactly the original, over random and edge inputs', () => {
  for (const seed of [5, 7, 17, 61, 68, 91]) {
    const fast = makeNoise2D(seed), ref = refNoise(seed), r = new RNG(seed);
    const edges = [0, 1, -1, 255, 256, 1e-12, -1e-12, 1023.999999, -300.25];
    for (let k = 0; k < 40000; k++) {
      const x = k < 81 ? edges[k % 9] : (r.next() - 0.3) * 600, y = k < 81 ? edges[Math.floor(k / 9)] : (r.next() - 0.3) * 600;
      const p = [3, 5, 14, 24, 20.48, 3.072, 0.75][k % 7], oct = 1 + (k % 5);
      assert.ok(Object.is(fast.tile(x, y, p, oct), ref(x, y, p, oct)), `seed ${seed} ${x} ${y} ${p} ${oct}`);
    }
  }
});

test('the ground textures are the same bytes as before qp3 (colour as put on the canvas, normal map)', () => {
  // (hashes of the v0.4.8.9 qp2 painters' output)
  const want = { 'asphalt{}': ['b143695f', '7e0bbea0'], 'sand{"meters":12}': ['f364dc20', '4894e748'] };
  for (const [kind, opts] of [['asphalt', {}], ['sand', { meters: 12 }]]) {
    put = null;
    const r = T[kind](opts);
    assert.deepEqual([fnv(put), fnv(r.normal.data)], want[kind + JSON.stringify(opts)], kind);
    // the worker paints with the same function: its bytes are the canvas's
    const d = T.GROUND_PAINTERS[kind](opts);
    assert.deepEqual([fnv(d.rgba), fnv(d.normal.data)], want[kind + JSON.stringify(opts)], kind + ' (painter)');
  }
  assert.equal(T.prepaintGrounds([['asphalt', {}]]), typeof Worker !== 'undefined', 'no worker here: nothing to start');
});
