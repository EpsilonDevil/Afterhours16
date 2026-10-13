// v0.4.8.5 park scenery: Harbor Point's palms and sand, the Old Brick Yard's streets, Foundry Works' industry.
// The layouts are pure functions, checked here against the courts, the plaza, the game cameras and each other.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/gfx/geometry.js';
import * as PR from '../client/js/world/props.js';
import { RNG } from '../client/js/core/rng.js';
import * as M from '../client/js/core/math.js';
import { PARK_COURTS, PARK_HQ, PARK_HALL } from '../client/js/world/themes.js';
import { harborPalmSpots, camClear, onSomething, waterlineZ, SHORE, shadedPlane } from '../client/js/world/harbor.js';
import { streetMarkings, CROSSINGS, AVE, SOUTH_ST, NORTH_ST, ROW, EL_Z, STEAM_VENTS, EXTENT } from '../client/js/world/street.js';
import { industryFootprints, beam, PLANT } from '../client/js/world/industry.js';

const BOUNDS = { x0: -63, x1: 63, z0: -34, z1: 32 }; // the park's walkable area (venues.js)
const tris = parts => parts.reduce((n, p) => n + (p.geo.index ? p.geo.index.length : p.geo.position.length / 3) / 3, 0);
// every triangle's winding agrees with its vertex normals (front faces are CCW)
function badWinding(g) {
  const p = g.position, n = g.normal, idx = g.index; let bad = 0, all = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (Math.hypot(fx, fy, fz) < 1e-9) continue;
    all++; if (fx * (n[a] + n[b] + n[c]) + fy * (n[a + 1] + n[b + 1] + n[c + 1]) + fz * (n[a + 2] + n[b + 2] + n[c + 2]) <= 0) bad++;
  }
  return bad / Math.max(1, all);
}

test('palm fronds: a folded blade with both faces, wound to match its normals; top faces up', () => {
  const f = PR.palmFrond([0, 8, 0], 0.7, 3.2, 0.6, 2.2, 0.42, '#4f8a42', 10, true);
  assert.ok(badWinding(f.geo) < 0.02, 'frond winding');
  const n = f.geo.normal, half = n.length / 2;
  let up = 0; for (let i = 1; i < half; i += 3) up += n[i];
  assert.ok(up > 0, 'the top face looks up');
  assert.ok([...f.geo.position].every(Number.isFinite));
});

test('palm(): the default palm is unchanged; with opts it leans, and the cheaper tiers really are cheaper', () => {
  // the old palm: trunk, 8 rings, crown shaft, 11 fronds (blade + midrib), 5 coconuts
  assert.equal(PR.palm(0, 0, 1, new RNG(2)).length, 1 + 8 + 1 + 22 + 5);
  const full = PR.palm(10, 5, 1, new RNG(9), { height: 10, lean: [0, 3] });
  const top = full[0].geo.position, last = top.length / 3 - 1; // the trunk tube's last ring
  let zTop = 0, yTop = 0; for (let i = last - 7; i <= last; i++) { zTop += top[i * 3 + 2]; yTop = Math.max(yTop, top[i * 3 + 1]); }
  assert.ok(zTop / 8 > 5 + 2.5, 'leans out by ~3 m toward +z');
  assert.ok(yTop > 9.5 && yTop < 10.6, 'about opts.height tall');
  const mid = PR.palm(10, 5, 1, new RNG(9), { height: 10, mid: true }), lite = PR.palm(10, 5, 1, new RNG(9), { height: 10, lite: true });
  assert.ok(tris(full) > tris(mid) && tris(mid) > tris(lite), `${tris(full)} > ${tris(mid)} > ${tris(lite)}`);
  assert.ok(tris(full) < 1600, 'a near palm stays under 1600 triangles');
});

test('Harbor Point palms: plenty of them, none on a court, fence, shop, the HQ, the hall, the slab, a path or a game camera', () => {
  const houses = [-70, -42, -14, 14, 42, 70].map((x, i) => ({ x, z: -48 - i % 3 * 2, w: 15, d: 11 }));
  const spots = harborPalmSpots(new RNG(4242), houses);
  assert.ok(spots.length >= 90, `${spots.length} palms`);
  assert.ok(spots.filter(p => p.tier === 'full').length >= 15 && spots.filter(p => p.tier === 'lite').length >= 30);
  for (const p of spots) {
    assert.ok(!onSomething(p.x, p.z, 1), `palm on something at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    assert.ok(camClear(p.x, p.z, 4), `palm in a game camera's path at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    assert.ok(p.z < waterlineZ() - 2, 'palm in the sea');
    for (const h of houses) assert.ok(!(Math.abs(p.x - h.x) < h.w / 2 + 1 && Math.abs(p.z - h.z) < h.d / 2 + 1), 'palm in a beach house');
  }
  // every part of the park gets some: the beach, both sides, the south edge and a few inside
  assert.ok(spots.some(p => p.z > 39 && Math.abs(p.x) < 60), 'beach');
  assert.ok(spots.some(p => p.x > 64 && Math.abs(p.z) < 40) && spots.some(p => p.x < -64 && Math.abs(p.z) < 40), 'sides');
  assert.ok(spots.some(p => p.z < -35 && p.z > -45 && Math.abs(p.x) < 60), 'south edge');
  assert.ok(spots.some(p => p.x > BOUNDS.x0 && p.x < BOUNDS.x1 && p.z > BOUNDS.z0 && p.z < BOUNDS.z1), 'inside the park');
  // the plaza shops, the wheel, the HQ and the hall really are kept clear
  assert.ok(onSomething(0, -24) && onSomething(PARK_HQ.x, PARK_HQ.z) && onSomething(PARK_HALL.x, PARK_HALL.z) && onSomething(52, 16));
});

test('the sand runs down a wet slope into the water; the ground plane helper shades and lays out its vertices', () => {
  const wl = waterlineZ();
  assert.ok(wl > SHORE.z && wl < SHORE.wet, `waterline at ${wl}`);
  const g = shadedPlane(-10, 10, -5, 5, 5, 4, (x, z) => [x, z, 1], (x, z) => x * 0.1);
  assert.equal(g.position.length / 3, 5 * 3);
  for (let i = 0; i < g.position.length / 3; i++) {
    assert.equal(g.color[i * 4], g.position[i * 3]); assert.equal(g.color[i * 4 + 1], g.position[i * 3 + 2]);
    assert.ok(Math.abs(g.position[i * 3 + 1] - g.position[i * 3] * 0.1) < 1e-6);
    assert.ok(Math.abs(g.uv[i * 2] - g.position[i * 3] / 4) < 1e-6);
  }
});

test('Old Brick Yard streets: the traffic lanes sit in the avenues, the El over the north street, no paint under a court', () => {
  for (const lane of [66, 68.5]) assert.ok(lane > AVE.x0 && lane < AVE.park, 'parklife lane inside the avenue');
  assert.ok(AVE.center > 66 && AVE.center < 68.5);
  assert.ok(EL_Z > NORTH_ST.z0 && EL_Z < NORTH_ST.z1);
  assert.ok(ROW.z0 > 16.95 + 0.5 && ROW.z1 < 32.75, 'Brick Row between the courts and the wall');
  assert.ok(SOUTH_ST.walkIn <= -36.25 && NORTH_ST.walkIn >= 33.25, 'the cross streets stay outside the walls');
  const { lines, cells } = streetMarkings();
  assert.ok(lines.length > 200 && cells.length > 80);
  const courtRects = PARK_COURTS.map(c => { const [ox, , oz] = c.origin; return { x0: ox - 9.9, x1: ox + 9.9, z0: c.full ? oz - 16.95 : oz - 3.3, z1: oz + 16.95 }; }).concat([{ x0: 47, x1: 57, z0: 12, z1: 21 }]);
  const hits = (x0, z0, x1, z1) => courtRects.some(r => x1 > r.x0 && x0 < r.x1 && z1 > r.z0 && z0 < r.z1);
  for (const L of lines) {
    const x0 = Math.min(L.x0, L.x1) - L.w / 2, x1 = Math.max(L.x0, L.x1) + L.w / 2, z0 = Math.min(L.z0, L.z1) - L.w / 2, z1 = Math.max(L.z0, L.z1) + L.w / 2;
    assert.ok(!hits(x0, z0, x1, z1), `paint under a court at ${x0.toFixed(1)},${z0.toFixed(1)}`);
    assert.ok(L.x0 === L.x1 || L.z0 === L.z1, 'lines are axis aligned');
    assert.ok(Math.abs(L.x0) <= EXTENT + 1 && Math.abs(L.z1) <= EXTENT + 1);
  }
  for (const C of cells) assert.ok(!hits(C.x - C.w / 2, C.z - C.w / 2, C.x + C.w / 2, C.z + C.w / 2), `decal under a court at ${C.x.toFixed(1)},${C.z.toFixed(1)}`);
  // a double yellow down each avenue, and a zebra on every approach of every crossing
  for (const s of [-1, 1]) assert.equal(lines.filter(L => L.paint === 'yellow' && L.x0 === L.x1 && Math.abs(L.x0 - s * AVE.center) < 0.2).length > 4, true);
  for (const b of CROSSINGS) {
    const near = lines.filter(L => L.w === 0.5 && Math.min(L.x0, L.x1) > b.x0 - 5 && Math.max(L.x0, L.x1) < b.x1 + 5 && Math.min(L.z0, L.z1) > b.z0 - 5 && Math.max(L.z0, L.z1) < b.z1 + 5);
    const approaches = b.ns.filter(Boolean).length + b.ew.filter(Boolean).length;
    assert.ok(near.length >= approaches * 5, `zebras at the crossing ${b.x0},${b.z0}`);
  }
  // the steam vents are on manholes in the road, not inside a court
  for (const [x, z] of STEAM_VENTS) assert.ok(!hits(x - 0.5, z - 0.5, x + 0.5, z + 0.5));
});

test('vehicles: a car, a taxi, a bus and a cruiser whose body samples the white of its door texture', () => {
  for (const parts of [PR.car('#7a1f1c'), PR.car('#f2b81c', { taxi: true }), PR.bus()]) {
    assert.ok(parts.length > 10);
    const g = G.merge(parts);
    assert.ok([...g.position].every(Number.isFinite));
    assert.ok(Math.min(...g.position.filter((_, i) => i % 3 === 1)) > -0.01, 'nothing below the road');
  }
  const cr = PR.cruiser();
  const doors = cr.body.filter(p => p.geo.position.length === 12); // the two door panels (quads)
  assert.equal(doors.length, 2);
  for (const p of cr.body) if (!doors.includes(p)) for (let i = 0; i < p.geo.uv.length; i += 2) { assert.equal(p.geo.uv[i], 0.5); assert.ok(Math.abs(p.geo.uv[i + 1] - 0.12) < 1e-6); }
  assert.equal(cr.bar.length, 2);
  assert.ok(cr.bar[0].color[0] > 0.9 && cr.bar[1].color[2] > 0.9, 'red and blue lamp banks');
});

test('Foundry Works: the industry stays out of the park, off the old buildings and the freight line, and reaches far', () => {
  const f = industryFootprints();
  assert.ok(f.length > 60);
  for (const p of f) {
    assert.ok(!(p.x + p.r > BOUNDS.x0 && p.x - p.r < BOUNDS.x1 && p.z + p.r > BOUNDS.z0 && p.z - p.r < BOUNDS.z1), `in the park: ${JSON.stringify(p)}`);
    assert.ok(!(p.x + p.r > -82 && p.x - p.r < 82 && p.z + p.r > -61 && p.z - p.r < -43), `on the south buildings: ${JSON.stringify(p)}`);
    assert.ok(!(p.x + p.r > -73 && p.x - p.r < 73 && p.z + p.r > 40 && p.z - p.r < 56), `on the north buildings: ${JSON.stringify(p)}`);
    assert.ok(!(Math.abs(p.x) < 130 && p.z + p.r > 60.4 && p.z - p.r < 63.6), `on the rails: ${JSON.stringify(p)}`);
  }
  // big things far out, in every direction
  const far = PLANT.towers.concat(PLANT.stacks).map(t => Math.hypot(t.x, t.z));
  assert.ok(far.every(d => d > 80 && d < 350));
  const dirs = new Set(f.filter(p => Math.hypot(p.x, p.z) > 70).map(p => Math.round(Math.atan2(p.z, p.x) / (Math.PI / 2)) & 3));
  assert.equal(dirs.size, 4, 'industry to the north, south, east and west');
  // footprints don't pile on each other (towers, stacks, tanks, columns)
  const big = PLANT.towers.map(t => ({ x: t.x, z: t.z, r: t.rb })).concat(PLANT.tanks.map(([x, z, r]) => ({ x, z, r })), PLANT.columns.map(([x, z, r]) => ({ x, z, r: r + 1.3 })));
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) assert.ok(Math.hypot(big[i].x - big[j].x, big[i].z - big[j].z) > big[i].r + big[j].r, `overlap ${i} ${j}`);
});

test('bake(): parts turned by a yaw keep normals that point the way their faces do (G.merge alone mirrors them)', () => {
  for (const yaw of [0, 0.6, Math.PI / 2, -Math.PI / 2, 2.5]) {
    const g = G.merge(PR.bake([{ geo: G.box(1, 1, 3), matrix: M.m4fromYaw(M.m4(), 2, 1, -3, yaw) }]));
    assert.ok(badWinding(g) < 0.02, `yaw ${yaw}`);
  }
  const quad = G.merge(PR.bake([{ geo: G.quad(2, 1), matrix: M.m4fromYaw(M.m4(), 0, 0, 0, Math.PI / 2) }]));
  assert.ok(quad.normal[0] > 0.99, 'a quad turned to face +x has a +x normal');
});

test('beam(): a member from a to b is a box of that length centred between them, pointing along a-b', () => {
  const out = [];
  beam(out, [1, 2, 3], [4, 6, 3], 0.5, 0.5, '#ffffff');
  const g = G.merge(PR.bake(out));
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.position.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g.position[i + k]); hi[k] = Math.max(hi[k], g.position[i + k]); }
  assert.ok(Math.abs((lo[0] + hi[0]) / 2 - 2.5) < 1e-4 && Math.abs((lo[1] + hi[1]) / 2 - 4) < 1e-4);
  assert.ok(hi[1] - lo[1] > 4 && hi[1] - lo[1] < 4.5, 'spans the rise');
  assert.ok(badWinding(g) < 0.02);
});
