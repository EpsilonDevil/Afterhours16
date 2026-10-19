// v0.4.8.7 The Favelas, the event park on a hillside at golden hour. The favela, its ground and sky, the park life and
// the pipa streak are pure enough to check here: the ground flat under the park and its streets, nothing of the town on
// a court, a fence, a Got Next spot, the kiosks, the HQ, a street or in a camera's path, the houses packed but never
// inside one another, everybody on their feet, every event playing out and cleaning up, the police chase always ending
// with the rider getting away, the streak building and tearing down cleanly.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../client/js/core/math.js';
import { RNG } from '../client/js/core/rng.js';
import { THEMES, PARK_HQ, PARK_HALL } from '../client/js/world/themes.js';
import * as FV from '../client/js/world/favela.js';
import { onSomething, camClear } from '../client/js/world/harbor.js';
import { StreakFX, PIPA_FX } from '../client/js/world/streakfx.js';
import { createParkLife } from '../client/js/world/parklife.js';
import { FAVELA_SIGNS, favelaSignUV } from '../client/js/gfx/textures.js';

const theme = THEMES.favela;
const finite = m => [...m].every(Number.isFinite);
const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x) * (h || y) * 4 || 4) }) : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
const fakeScene = () => { const meshes = []; return { meshes, lights: [], exposure: 1, add(m) { meshes.push(m); return m; }, remove(m) { const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); } }; };
const ctx = { geometry: g => ({ ...g, count: g.index ? g.index.length : g.position.length / 3, bounds: { center: [0, 0, 0], radius: 1 } }), texture: () => ({}), updateTexture() {} };
const tris = g => (g.index ? g.index.length : g.position.length / 3) / 3;
const buildTown = () => { const scene = fakeScene(), park = { matte: [], metal: [], foliage: [], lamps: [] }; const town = FV.favelaTown(ctx, scene, new RNG(7), theme, park); return { scene, park, town }; };
const ROADS = [
  { x0: FV.ROAD.w - FV.ROAD.half, x1: FV.ROAD.e + FV.ROAD.half, z0: FV.ROAD.s - FV.ROAD.half, z1: FV.ROAD.s + FV.ROAD.half },
  { x0: FV.ROAD.w - FV.ROAD.half, x1: FV.ROAD.e + FV.ROAD.half, z0: FV.ROAD.n - FV.ROAD.half, z1: FV.ROAD.n + FV.ROAD.half },
  { x0: FV.ROAD.e - FV.ROAD.half, x1: FV.ROAD.e + FV.ROAD.half, z0: FV.ROAD.s, z1: FV.ROAD.n },
  { x0: FV.ROAD.w - FV.ROAD.half, x1: FV.ROAD.w + FV.ROAD.half, z0: FV.ROAD.s, z1: FV.ROAD.n },
];
const onRoad = (x, z, m = 0) => ROADS.some(r => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
const PARK = { x0: -63.6, x1: 63.6, z0: -34.3, z1: 33.4 };
const inPark = (x, z, m = 0) => x > PARK.x0 - m && x < PARK.x1 + m && z > PARK.z0 - m && z < PARK.z1 + m;

test('the ground: flat under the park and its streets, climbing beyond them (steepest to the north), finite everywhere', () => {
  for (let x = -84; x <= 74; x += 2) for (let z = -44; z <= 42; z += 2) assert.equal(FV.groundY(x, z), 0, `ground at ${x},${z}`);
  assert.ok(FV.groundY(0, 100) > 20, 'the hill to the north'); assert.ok(FV.groundY(120, 0) > 12 && FV.groundY(-130, 0) > 12, 'east and west');
  assert.ok(FV.groundY(0, -100) > 6 && FV.groundY(0, -100) < FV.groundY(0, 100), 'gentler to the south');
  for (let a = 0; a < Math.PI * 2; a += 0.2) assert.ok(Number.isFinite(FV.groundY(Math.cos(a) * 240, Math.sin(a) * 240)));
  // the stairways climb, never down
  for (const [side, l] of Object.entries(FV.ALLEYS)) for (const a of l) { let prev = -1; for (let d = 0; d < 60; d += 0.9) { const y = FV.stairY(side, a, d); assert.ok(y >= prev - 1e-9, `${side} ${a} at ${d}`); prev = y; } }
});

test('the plan: houses packed along the slopes, none inside another, none on the park, a street, a stairway or a camera path', () => {
  const H = FV.favelaPlan(2026);
  assert.ok(H.length > 700 && H.length < 1500, `${H.length} houses`);
  for (const k of ['n', 's', 'e', 'w']) assert.ok(H.filter(h => h.side === k).length > 60, `side ${k}`);
  const box = h => { const F = FV.houseFrame(h), pts = [F.P(-h.w / 2, 0, 0), F.P(h.w / 2, 0, 0), F.P(-h.w / 2, 0, -h.depth), F.P(h.w / 2, 0, -h.depth)]; return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), z0: Math.min(...pts.map(p => p[2])), z1: Math.max(...pts.map(p => p[2])) }; };
  const B = H.map(box);
  for (let i = 0; i < B.length; i++) {
    const a = B[i];
    assert.ok(!onRoad((a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2, 0) && !inPark(a.x0, a.z0, 1) && !inPark(a.x1, a.z1, 1), `house ${i} in the park or a street`);
    for (const [x, z] of [[a.x0, a.z0], [a.x1, a.z1], [a.x0, a.z1], [a.x1, a.z0]]) { assert.ok(!onRoad(x, z, 0.3), `house ${i} corner on a street at ${x.toFixed(1)},${z.toFixed(1)}`); assert.ok(FV.favelaClear(x, z, 0.5), `house ${i} in a camera path`); }
    for (let j = i + 1; j < B.length; j++) { const b = B[j]; assert.ok(!(a.x0 < b.x1 - 0.05 && a.x1 > b.x0 + 0.05 && a.z0 < b.z1 - 0.05 && a.z1 > b.z0 + 0.05), `houses ${i} and ${j} overlap`); }
  }
  // the stairways run clear between the houses
  for (const [side, l] of Object.entries(FV.ALLEYS)) for (const a of l) for (let d = 3; d < 50; d += 2) { const [x, , z] = FV.alleyPoint(side, a, d); assert.ok(!B.some(b => x > b.x0 + 0.3 && x < b.x1 - 0.3 && z > b.z0 + 0.3 && z < b.z1 - 0.3), `${side} stairway ${a} blocked at ${d}`); }
  // the shops are all on the first row, each once
  assert.deepEqual(H.filter(h => h.shop).map(h => h.shop.key).sort(), FV.SHOPS.map(s => s.key).sort());
  assert.ok(H.filter(h => h.shop).every(h => h.row === 0));
  assert.ok(H.filter(h => h.roof.tank).length > H.length * 0.4 && H.some(h => h.roof.laundry) && H.filter(h => h.roof.lights).length === 5 && H.some(h => h.brick));
  // the parked police car is off the street and the walks
  assert.ok(!onRoad(FV.POLICE_CAR.x - 0.9, FV.POLICE_CAR.z, 0) && !inPark(FV.POLICE_CAR.x - 1, FV.POLICE_CAR.z));
});

test('the loop: the dirtbikes\' street circuit is continuous, on the streets, clear of the park and the houses', () => {
  for (const lane of [-FV.ROAD.lane, FV.ROAD.lane]) {
    const L = FV.loopLength(lane); let prev = FV.loopAt(0, lane);
    for (let u = 0.5; u <= L + 0.01; u += 0.5) {
      const p = FV.loopAt(u, lane); assert.ok(Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 0.6, `jump at ${u}`);
      assert.ok(onRoad(p[0], p[1], 0.01), `off the street at ${p[0].toFixed(1)},${p[1].toFixed(1)}`); assert.ok(!inPark(p[0], p[1], 0.5)); prev = p;
    }
  }
  // the half courts' broadcast cameras past the west fence stay clear of the west street
  assert.ok(!FV.favelaClear(-68.5, -12, 2) && FV.favelaClear(FV.ROAD.w, 0, 2));
});

test('signs: every shop word in its own row of the atlas', () => {
  for (const s of FV.SHOPS) assert.ok(FAVELA_SIGNS.includes(s.key), s.key);
  const cells = FAVELA_SIGNS.map(w => favelaSignUV(w).join());
  assert.equal(new Set(cells).size, cells.length);
});

test('the town: a few dozen batches, no NaN, nothing on the park or in a camera path, within its triangle budget; the windows switch and the power goes and comes back', () => {
  const { scene, park, town } = buildTown();
  assert.ok(scene.meshes.length > 10 && scene.meshes.length < 45, `${scene.meshes.length} meshes`);
  let total = 0; const P = [0, 0, 0];
  for (const m of scene.meshes) {
    const g = m.geo; total += tris(g);
    assert.ok(finite(g.position) && finite(m.matrix), 'no NaN');
    if (g.joints || m.material.blend || m.order <= -5 || m.visible === false) continue;
    for (let i = 0; i < g.position.length; i += 3) {
      M.v3transformMat4(P, [g.position[i], g.position[i + 1], g.position[i + 2]], m.matrix);
      if (P[1] < 0.1 && Math.hypot(P[0], P[2]) < 90 && !inPark(P[0], P[2], -0.5)) continue; // (flat on the ground: the street's paint)
      if (inPark(P[0], P[2], -1)) assert.ok(P[1] < 0.02, `town piece in the park at ${P[0].toFixed(1)},${P[1].toFixed(1)},${P[2].toFixed(1)}`);
      assert.ok(!onSomething(P[0], P[2], 0.2) || P[1] < 0.02, `town piece on something at ${P[0].toFixed(1)},${P[2].toFixed(1)}`);
      assert.ok(camClear(P[0], P[2], 0) || P[1] < 0.02, `town piece in a camera path at ${P[0].toFixed(1)},${P[2].toFixed(1)}`);
    }
  }
  assert.ok(total < 120000, `${total} triangles in the town`); // (the Monster Mash's town budget)
  console.log(`  (the favela: ${town.houses.length} houses, ${scene.meshes.length} meshes, ${total} triangles, ${park.foliage.length} plant parts)`);
  for (const q of [...park.lamps, ...park.foliage]) { const x = q.matrix?.[12] ?? 0, z = q.matrix?.[14] ?? 0; if (!q.matrix) continue; assert.ok(!inPark(x, z, 0.5), `park piece at ${x},${z}`); }
  // the windows: some on, some off, switching over a few minutes; a blackout takes groups dark and gives them back
  const lit = () => town.groups.filter(g => g.mat.color[0] > 0.5).length;
  for (let i = 0; i < 30 * 30; i++) town.update(1 / 30);
  const a = lit(); for (let i = 0; i < 30 * 120; i++) town.update(1 / 30);
  assert.ok(a > 0 && a < town.groups.length, `${a} of ${town.groups.length} groups lit`);
  town.power([0, 1, 2], false); for (let i = 0; i < 60; i++) town.update(1 / 30);
  assert.ok([0, 1, 2].every(i => town.groups[i].mat.color[0] < 0.1), 'dark'); assert.equal(town.dark, 3);
  town.power([0, 1, 2], true); for (let i = 0; i < 90; i++) town.update(1 / 30);
  assert.equal(town.dark, 0);
  // the laundry sways, the light bar flashes
  const L0 = town.laundryRig.length ? scene.meshes.find(m => m.geo.joints && m.bones?.length === 16 * town.laundryRig.length).bones.slice() : null;
  for (let i = 0; i < 20; i++) town.update(1 / 30);
  if (L0) assert.ok(scene.meshes.find(m => m.geo.joints && m.bones?.length === 16 * town.laundryRig.length).bones.some((v, i) => Math.abs(v - L0[i]) > 1e-4), 'the laundry sways');
  let red = 0, blue = 0; for (let i = 0; i < 60; i++) { town.update(1 / 60); if (town.bar.material.color[0] > 5) red++; if (town.bar.material.color[2] > 5) blue++; }
  assert.ok(red > 0 && blue > 0, 'the parked car\'s light bar flashes red and blue');
  for (const m of scene.meshes) assert.ok(finite(m.matrix) && (!m.bones || finite(m.bones)));
});

test('park life: people, animals and riders on their feet and moving; every event plays out and leaves nothing behind', () => {
  const { scene, town } = buildTown();
  const r = { ctx, particles: { burst() {}, emit() {} } };
  const life = createParkLife(r, scene, theme, new RNG(7), { town });
  const F = life.favela;
  assert.ok(F && F.people.length >= 14 && F.riders.length === 3 && F.flock);
  const snap = m => (m.meshes ? Float32Array.from(m.meshes.flatMap(q => [...q.bones])) : m.bones.slice());
  const c0 = snap(F.crowd), d0 = snap(F.dogs), b0 = snap(F.bikes);
  for (let i = 0; i < 60 * 8; i++) { life.update(1 / 60); town.update(1 / 60); }
  for (const [m, s, w] of [[F.crowd, c0, 'people walk'], [F.dogs, d0, 'dogs trot'], [F.bikes, b0, 'bikes ride']]) assert.ok(snap(m).some((v, i) => Math.abs(v - s[i]) > 1e-3), w);
  for (const m of scene.meshes) assert.ok(finite(m.matrix) && (!m.bones || finite(m.bones)), 'no NaN');
  // everybody's feet on the ground they're over (the people on the streets and stairs, the riders on the street)
  for (const p of F.people) { const B = F.crowd.bones(p.i), y = B[13] - 1.0 * p.k, x = B[12], z = B[14]; assert.ok(y > -0.15 && y < FV.groundY(x, z) + 1.3 && y > FV.groundY(x, z) - 1.0, `walker at ${x.toFixed(1)},${y.toFixed(2)},${z.toFixed(1)}`); assert.ok(!inPark(x, z, -0.5) || Math.abs(y) < 0.2); }
  for (const b of F.riders) { const x = F.bikes.bones[b.i * 16 + 12], z = F.bikes.bones[b.i * 16 + 14]; assert.ok(onRoad(x, z, 0.2), `rider off the street at ${x},${z}`); }
  // a wheelie now and then
  let wheelie = 0; for (let i = 0; i < 60 * 60; i++) { life.update(1 / 60); if (F.riders.some(b => b.pitch > 0.3)) wheelie++; }
  assert.ok(wheelie > 0, 'somebody pulls a wheelie');
  // the pigeons take off and come back
  let flew = false; for (let i = 0; i < 60 * 80 && !flew; i++) { life.update(1 / 60); if (F.flock.k > 0.8) flew = true; } assert.ok(flew, 'the pigeons fly');
  // every event runs to its end and cleans up
  const drain = () => { for (let k = 0; k < 60 * 600 && life.eventCount; k++) { life.update(1 / 60); if (k % 4 === 0) town.update(4 / 60); } };
  drain();
  const base = scene.meshes.length, lights = scene.lights.length, e0 = scene.exposure;
  for (let i = 0; i < 7; i++) {
    life.trigger(i);
    for (let k = 0; k < 60 * 4; k++) { life.update(1 / 60); assert.ok(scene.lights.length <= 8); }
    for (const m of scene.meshes) assert.ok(finite(m.matrix) && (!m.bones || finite(m.bones)), `event ${i}: no NaN`);
    drain();
    assert.equal(life.eventCount, 0, `event ${i} ends`);
    assert.equal(scene.meshes.length, base, `event ${i} leaves no meshes`);
    assert.equal(scene.lights.length, lights, `event ${i} leaves no lights`);
    assert.ok(Math.abs(scene.exposure - e0) < 1e-9, `event ${i} gives the exposure back`);
  }
  assert.equal(town.dark, 0, 'the power is back'); assert.equal(F.hold.riders.size, 0, 'the borrowed rider is back on the loop');
});

test('the police chase: whoever runs always gets away up the stairs; the police never close on him and stop at the foot of the steps', () => {
  const { scene, town } = buildTown();
  const r = { ctx, particles: { burst() {}, emit() {} } };
  const life = createParkLife(r, scene, theme, new RNG(11), { town });
  const F = life.favela;
  for (let k = 0; k < 60 * 600 && life.eventCount; k++) life.update(1 / 60);
  for (let n = 0; n < 24; n++) {
    life.trigger(n % 3); // (0 and 1: the police bike, 2: two officers on foot)
    for (let k = 0; k < 60 * 600 && life.eventCount; k++) life.update(1 / 60);
    assert.equal(life.eventCount, 0, `chase ${n} ends`);
  }
  assert.ok(F.stats.chases >= 24, `${F.stats.chases} chases`);
  assert.equal(F.stats.escapes, F.stats.chases, 'every one of them got away');
  assert.ok(F.stats.minGap > FV.CHASE.minGap * 0.4, `closest the police got: ${F.stats.minGap.toFixed(1)} m`);
  // the plan: along a street into a stairway, the police's stop short of the steps
  const rng = new RNG(3);
  for (let i = 0; i < 40; i++) {
    const p = FV.chasePlan(rng, i % 2 === 1);
    for (const q of p.rider.slice(0, 2)) assert.ok(onRoad(q[0], q[2], 0.1), `the chase starts on a street (${q[0].toFixed(1)}, ${q[2].toFixed(1)})`);
    assert.ok(p.total - p.mouthS > 15, 'a long way up the steps');
  }
});

test('the pipa streak: hidden until a streak, more at every level, all gone on dispose', () => {
  const scene = fakeScene(), court = { id: 'main', origin: [0, 0, 0], full: true };
  const fx = new StreakFX(ctx, scene, court, 'pipa');
  const settle = (lv, s = 6) => { fx.setLevel(lv); for (let i = 0; i < s * 60; i++) fx.update(1 / 60); return fx.meshes.filter(m => m.visible).length; };
  assert.equal(settle(0), 0);
  let prev = 0;
  for (const lv of [1, 2, 3, 4]) { const n = settle(lv); assert.ok(n > prev, `level ${lv}: ${n} visible`); prev = n; }
  for (const m of fx.meshes) assert.ok(finite(m.matrix) && (!m.bones || finite(m.bones)));
  // the kites fly higher as the streak goes on, and stay off the court's floor
  const kiteY = () => Math.max(...Array.from({ length: 8 }, (_, i) => fx.kites[0].bones[i * 16 + 13]));
  settle(1); const y1 = kiteY(); settle(4); const y4 = kiteY();
  assert.ok(y1 > 2 && y4 > y1 + 3, `kites at ${y1.toFixed(1)} m, then ${y4.toFixed(1)} m`);
  assert.ok(PIPA_FX.buntingH > 7, 'the bunting hangs over the players\' heads');
  assert.equal(scene.lights.length, 0, 'no lights of its own');
  assert.equal(settle(0, 10), 0);
  settle(4); fx.dispose();
  assert.ok(!scene.meshes.length, 'all removed');
});

test('the bateria comes down a stairway, along the street and up another: never through a house or under the hill', () => {
  const H = FV.favelaPlan(2026), rng = new RNG(5);
  for (let n = 0; n < 12; n++) {
    const route = FV.bateriaRoute(rng), L = FV.pathLength(route);
    assert.ok(L > 40, `a real walk (${L.toFixed(0)} m)`);
    for (let s = 0; s <= L; s += 0.5) {
      const [x, y, z] = FV.along(route, s);
      assert.ok(y > FV.groundY(x, z) - 1.0, `under the hill at ${x.toFixed(1)},${z.toFixed(1)}`);
      assert.ok(!inPark(x, z, -0.2), 'not in the park');
      for (const h of H) { const F = FV.houseFrame(h), [lx, lz] = (() => { const dx = x - h.x, dz = z - h.z, c = Math.cos(h.yaw), sn = Math.sin(h.yaw); return [c * dx - sn * dz, sn * dx + c * dz]; })(); void F; assert.ok(!(Math.abs(lx) < h.w / 2 - 0.2 && lz < -0.2 && lz > -h.depth + 0.2), `through a house at ${x.toFixed(1)},${z.toFixed(1)}`); }
    }
  }
});
