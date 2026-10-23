// QP3 follow-up (v0.4.8.9): the athletes' shared textures (char/view.js sharedTex: skin, hair, shoes, chains...) are leased
// (world/release.js): every AthleteView holds the ones it's built with until it's disposed, a VisualPool's parked views
// keep theirs, and the ones nobody wears are freed past ATHLETE_BUDGET, the least recently worn first, never one a view
// still wears (a staged build's included, between its steps). Headless, with a GL stand-in that counts what's alive.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x) * (h || y) * 4 || 4) }) : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
if (typeof globalThis.document === 'undefined') globalThis.document = { createElement: () => new OffscreenCanvas(1, 1) };

const { AthleteView } = await import('../client/js/char/view.js');
const { VisualPool, visualKey } = await import('../client/js/game/vispool.js');
const { makeBot, resolveLook } = await import('../client/js/sim/bots.js');
const { RNG } = await import('../client/js/core/rng.js');
const { trimCaches, cacheStats, ATHLETE_BUDGET, CACHE_BUDGET, releaseScene } = await import('../client/js/world/release.js');

function fakeCtx() {
  const live = new Set(), errors = [];
  return {
    live, errors,
    geometry: g => ({ ...g, vao: {}, buffers: {}, bounds: g.bounds || { center: [0, 0, 0], radius: 1 } }),
    texture: (src, o) => { const t = { tex: {}, width: src?.width || 1, height: src?.height || 1 }; live.add(t); return t; },
    disposeGeometry() {}, disposeTexture: t => { if (!live.delete(t)) errors.push('texture freed twice or never made'); },
  };
}
const ctx = fakeCtx(), r = { ctx };
const OPTS = { detail: 0.3, lod: false, faceRes: 64 };
// a bot's look, with its hair colour and shoes made distinct by i (distinct shared textures)
const lookOf = i => {
  const b = makeBot(new RNG(1000 + i), { level: 0.6 }), look = resolveLook(b.build, {});
  look.hair_color = '#' + (0x100000 + i * 7919).toString(16).slice(-6);
  if (look.gear?.shoes) look.gear.shoes = { ...look.gear.shoes, color: '#' + (0x200000 + i * 104729).toString(16).slice(-6) };
  return { build: b.build, look };
};
const texOf = v => { const s = new Set(); for (const m of v.meshes) for (const k of ['map', 'normalMap', 'emissiveMap', 'detailMap']) if (m.material[k]) s.add(m.material[k]); return s; };
const athleteIdle = () => cacheStats('athlete').idle;

test('a view holds every shared texture it wears and lets go on dispose; unworn ones stay cached within the budget', () => {
  assert.ok(ATHLETE_BUDGET > 0 && ATHLETE_BUDGET < CACHE_BUDGET, 'the athletes have a budget of their own');
  const a = lookOf(1), v = new AthleteView(r, a.build, a.look, OPTS);
  const tex = texOf(v), sharedT = [...tex].filter(t => t.shared);
  assert.ok(sharedT.length >= 4, 'skin, detail normals, hair, shoes...');
  assert.equal(v.leases.size, new Set([...v.leases].map(e => e.tex)).size);
  for (const t of sharedT) assert.ok([...v.leases].some(e => e.tex === t), 'held: every shared texture it wears');
  for (const e of v.leases) assert.ok(e.refs >= 1);
  const held = [...v.leases];
  v.dispose();
  assert.equal(v.leases.size, 0);
  for (const e of held) assert.equal(e.refs, 0, 'let go');
  for (const t of sharedT) assert.ok(ctx.live.has(t), 'still cached: nobody needs it gone yet');
  assert.ok(athleteIdle() <= ATHLETE_BUDGET);
  v.dispose(); // (twice: nothing more)
  assert.deepEqual(ctx.errors, []);
});

test('churn: unworn textures are freed oldest first past the budget, never one a live view or a parked one wears', () => {
  const keep = lookOf(2), wearing = new AthleteView(r, keep.build, keep.look, OPTS), worn = texOf(wearing);
  // a pool's parked view keeps its holds
  const pool = new VisualPool(r, { maxFree: 4 }), pk = lookOf(3), parked = new AthleteView(r, pk.build, pk.look, OPTS), parkedTex = texOf(parked);
  pool.release(visualKey(pk.build, pk.look, OPTS), parked);
  const gone = [];
  for (let i = 10; i < 22; i++) { const l = lookOf(i), v = new AthleteView(r, l.build, l.look, OPTS); for (const t of texOf(v)) if (t.shared) gone.push(t); v.dispose(); }
  trimCaches(ctx, 0, 'athlete'); // (no budget at all: everything nobody wears goes)
  assert.equal(athleteIdle(), 0);
  for (const t of worn) assert.ok(ctx.live.has(t), 'a live view\'s textures are never freed');
  for (const t of parkedTex) assert.ok(ctx.live.has(t), 'nor a parked view\'s');
  assert.ok(gone.some(t => !ctx.live.has(t) && !worn.has(t)), 'the unworn ones are freed');
  // the same look again after its textures went: painted and uploaded anew, alive
  const again = lookOf(10), v2 = new AthleteView(r, again.build, again.look, OPTS);
  for (const t of texOf(v2)) assert.ok(ctx.live.has(t));
  v2.dispose();
  // the pool's disposal lets the parked view's holds go
  pool.dispose();
  trimCaches(ctx, 0, 'athlete');
  for (const t of parkedTex) if (t.shared && !worn.has(t)) assert.ok(!ctx.live.has(t), 'freed once the pool let it go');
  for (const t of worn) assert.ok(ctx.live.has(t));
  wearing.dispose();
  assert.deepEqual(ctx.errors, []);
});

test('a staged build holds what it took in its first steps, through a trim between steps', () => {
  const l = lookOf(40), { view, steps } = AthleteView.staged(r, l.build, l.look, OPTS);
  while (view.leases?.size < 3 || !view.leases) if (steps.next().done) break; // (up to the skin and the detail normals: taken)
  assert.ok(!view.meshes?.length || view.meshes.length < 4, 'still mid-build');
  const early = [...view.leases].map(e => e.tex);
  assert.ok(early.length >= 3);
  trimCaches(ctx, 0, 'athlete');
  for (const t of early) assert.ok(ctx.live.has(t), 'kept between steps');
  for (const _ of steps) { /* the rest */ }
  for (const t of texOf(view)) assert.ok(ctx.live.has(t), 'and everything it wears at the end is alive');
  view.dispose();
  // a venue scene's release never frees an athlete's textures (they're shared)
  const l2 = lookOf(41), v = new AthleteView(r, l2.build, l2.look, OPTS), scene = { meshes: [], lights: [], add(m) { this.meshes.push(m); } };
  v.addTo(scene);
  const t2 = [...texOf(v)].filter(t => t.shared);
  releaseScene(ctx, scene);
  for (const t of t2) assert.ok(ctx.live.has(t));
  assert.deepEqual(ctx.errors, []);
});
