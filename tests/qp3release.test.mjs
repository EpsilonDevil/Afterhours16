// QP3 (v0.4.8.9) the GPU leak fix, the World agent's part (world/release.js): leaving a scene frees every geometry and
// texture it owns and nothing a cache keeps for reuse (shared); the venue caches (world/court.js) are leased by the
// scenes built with them and freed past the budget only when no live scene holds them; building a park again after
// leaving it works and reuses the cache. Headless, with a GL stand-in that counts what's alive.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x) * (h || y) * 4 || 4) }) : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
if (typeof globalThis.document === 'undefined') globalThis.document = { createElement: () => new OffscreenCanvas(1, 1) };

const { buildVenue } = await import('../client/js/world/venues.js');
const { buildProamHub } = await import('../client/js/world/proamhubs.js');
const { cachedTexture } = await import('../client/js/world/court.js');
const { releaseScene, freeMeshes, trimCaches, cacheStats, buildScope, CACHE_BUDGET } = await import('../client/js/world/release.js');

// a GL context stand-in: what's made, what's freed (twice is an error), what's alive
function fakeCtx() {
  const live = { geos: new Set(), texs: new Set() }, errors = [];
  const ctx = {
    live, errors,
    geometry: g => { const o = { ...g, vao: {}, buffers: {}, count: g.index ? g.index.length : g.position.length / 3, bounds: g.bounds || { center: [0, 0, 0], radius: 1 } }; live.geos.add(o); return o; },
    texture: (src, o) => { const t = { tex: {}, width: src?.width || 1, height: src?.height || 1, o }; live.texs.add(t); return t; },
    disposeGeometry: g => { if (!live.geos.delete(g)) errors.push('geometry freed twice or never made'); },
    disposeTexture: t => { if (!live.texs.delete(t)) errors.push('texture freed twice or never made'); },
    updateTexture() {}, updateAttribute() {}, setInstances(g, d, n) { g.instances = n; },
  };
  return ctx;
}
const fakeScene = () => ({ meshes: [], lights: [], add(m) { this.meshes.push(m); return m; }, remove(m) { const i = this.meshes.indexOf(m); if (i >= 0) this.meshes.splice(i, 1); } });
const rOf = ctx => ({ ctx, prewarm() {}, particles: { emit() {}, burst() {} } });
const used = scene => { const g = new Set(), t = new Set(); for (const m of scene.meshes) { g.add(m.geo); for (const k of ['map', 'normalMap', 'roughMap', 'emissiveMap', 'detailMap']) if (m.material?.[k]) t.add(m.material[k]); if (m.material?.floor?.overlay) t.add(m.material.floor.overlay); } if (scene.env) t.add(scene.env); return { g, t }; };

test('leaving a park frees all it owns and keeps the shared caches; building it again reuses them', () => {
  const ctx = fakeCtx(), r = rOf(ctx);
  const a = fakeScene(), va = buildVenue(r, a, 'harbor', { seed: 7 });
  assert.ok(va.courts.length >= 4 && a.meshes.length > 50);
  const { g, t } = used(a);
  const owned = [...g].filter(x => !x.shared).length, sharedT = [...t].filter(x => x.shared);
  assert.ok(owned > 50, 'the park owns its geometry');
  assert.ok(sharedT.length >= 6, 'the court overlays and the cached maps are shared');
  for (const m of a.meshes) for (const k of ['map', 'normalMap']) if (m.material?.floor && m.material[k]) assert.equal(m.material[k].shared, true, 'the court floor maps are the cache\'s');
  const geos0 = ctx.live.geos.size;
  releaseScene(ctx, a);
  assert.deepEqual(ctx.errors, []);
  assert.equal(a.meshes.length, 0, 'an empty scene: a frame drawn with it draws nothing');
  for (const x of g) if (!x.shared) assert.ok(!ctx.live.geos.has(x), 'every geometry it owned is freed');
  for (const x of t) if (!x.shared) assert.ok(!ctx.live.texs.has(x), 'every texture it owned is freed');
  for (const x of sharedT) assert.ok(ctx.live.texs.has(x), 'a shared texture stays (within the budget)');
  assert.ok(ctx.live.geos.size < geos0 - 50);
  // again: the same park, its overlays and maps from the cache (nothing of the first one's used)
  const texsBefore = new Set(ctx.live.texs);
  const b = fakeScene(); buildVenue(r, b, 'harbor', { seed: 7 });
  const ub = used(b);
  for (const x of sharedT) assert.ok(ub.t.has(x), 'the cached textures are used again');
  for (const x of ub.g) assert.ok(ctx.live.geos.has(x), 'the new park draws only live geometry');
  for (const x of ub.t) assert.ok(ctx.live.texs.has(x), 'and only live textures');
  assert.ok([...ub.t].filter(x => texsBefore.has(x)).length >= sharedT.length);
  releaseScene(ctx, b);
  releaseScene(ctx, b); // (twice: nothing more happens)
  assert.deepEqual(ctx.errors, []);
});

test('a lease: a cache entry a live scene holds is never freed; idle ones go past the budget, the oldest first', () => {
  const ctx = fakeCtx(), r = rOf(ctx);
  const arena = team => { const s = fakeScene(); buildVenue(r, s, 'arena', { team: { name: team, abbr: team.slice(0, 3).toUpperCase(), primary: '#2457c5', secondary: '#f2c14e', logo: 'bolt' } }); return s; };
  const s1 = arena('Alpha'), s2 = arena('Bravo');
  const ov1 = s1.meshes.find(m => m.material?.floor).material.floor.overlay, ov2 = s2.meshes.find(m => m.material?.floor).material.floor.overlay;
  assert.notEqual(ov1, ov2, 'two teams, two court overlays');
  releaseScene(ctx, s1);
  trimCaches(ctx, 0); // (no budget at all: every idle entry goes)
  assert.ok(!ctx.live.texs.has(ov1), 'the overlay nobody holds is freed');
  assert.ok(ctx.live.texs.has(ov2), 'the one a live scene holds is kept');
  assert.deepEqual(ctx.errors, []);
  // and built again when it's needed: a fresh texture, alive
  const s3 = arena('Alpha'), ov3 = s3.meshes.find(m => m.material?.floor).material.floor.overlay;
  assert.ok(ctx.live.texs.has(ov3) && ov3 !== ov1);
  releaseScene(ctx, s2); releaseScene(ctx, s3);
  assert.ok(ctx.live.texs.has(ov2) && ctx.live.texs.has(ov3), 'within the budget, idle entries stay cached');
  assert.ok(cacheStats().idle <= CACHE_BUDGET);
  assert.deepEqual(ctx.errors, []);
});

test('a cache entry used outside a venue build is pinned for good; freeMeshes keeps what is shared', () => {
  const ctx = fakeCtx();
  const t = cachedTexture(ctx, 'qp3-test-pin', () => ({ width: 64, height: 64 }), {});
  assert.equal(t.shared, true);
  trimCaches(ctx, 0);
  assert.ok(ctx.live.texs.has(t), 'pinned: never trimmed');
  // a piece taken out of the scene by its owner (StreakFX, a session's ball): its own geometry and textures go
  const own = ctx.texture({ width: 8, height: 8 }), geo = ctx.geometry({ position: new Float32Array(9) }), sg = ctx.geometry({ position: new Float32Array(9) });
  sg.shared = true;
  freeMeshes(ctx, [{ geo, material: { map: own, normalMap: t } }, { geo: sg, material: { map: own } }]);
  assert.ok(!ctx.live.texs.has(own) && !ctx.live.geos.has(geo), 'its own are freed, once');
  assert.ok(ctx.live.texs.has(t) && ctx.live.geos.has(sg), 'the shared ones stay');
  assert.deepEqual(ctx.errors, []);
  // a scope's leases end with the scene
  const s = fakeScene();
  buildScope(s, () => cachedTexture(ctx, 'qp3-test-lease', () => ({ width: 32, height: 32 }), {}));
  assert.equal(s._leases.size, 1);
  releaseScene(ctx, s);
  assert.equal(s._leases, null);
});

test('the Pro-Am HUB building: released, it frees its own and keeps the shared wood', () => {
  const ctx = fakeCtx(), r = rOf(ctx);
  for (const tier of ['bronze', 'gold', 'platinum']) {
    const s = fakeScene(); buildProamHub(r, s, tier, { team: { id: 't-' + tier, name: 'Leak Check', abbr: 'LKC', primary: '#2457c5', secondary: '#f2c14e' } });
    const { g, t } = used(s);
    assert.ok(g.size > 10);
    releaseScene(ctx, s);
    for (const x of g) assert.equal(ctx.live.geos.has(x), !!x.shared, tier + ': geometry');
    for (const x of t) assert.equal(ctx.live.texs.has(x), !!x.shared, tier + ': textures');
  }
  assert.deepEqual(ctx.errors, []);
});
