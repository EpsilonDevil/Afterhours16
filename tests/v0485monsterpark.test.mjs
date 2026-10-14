// v0.4.8.5 quick patch 2: The Monster Mash, the Halloween event park. The haunted town, its ground and sky, the
// monsters and the haunt streak are pure enough to check here: the ground flat under the park, nothing of the town on
// a court, a fence, a Got Next spot, the kiosks, the HQ or in a camera's path, every monster on its feet, the events
// and the streak building and tearing down cleanly (the floodlights given back).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../client/js/core/math.js';
import { RNG } from '../client/js/core/rng.js';
import { THEMES, EVENTS, PARK_COURTS, PARK_HQ, PARK_HALL } from '../client/js/world/themes.js';
import * as HR from '../client/js/world/horror.js';
import { onSomething, camClear } from '../client/js/world/harbor.js';
import { StreakFX, HAUNT_FX } from '../client/js/world/streakfx.js';
import { createParkLife } from '../client/js/world/parklife.js';
import { HORROR_SIGNS, horrorSignUV } from '../client/js/gfx/textures.js';

const theme = THEMES.monster;
const finite = m => [...m].every(Number.isFinite);
// (the town paints its facades, signs and ground on canvases: a stand-in 2D context that draws nothing)
const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x) * (h || y) * 4 || 4) }) : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
const fakeScene = () => { const meshes = []; return { meshes, lights: [], exposure: 1, add(m) { meshes.push(m); return m; }, remove(m) { const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); } }; };
const ctx = { geometry: g => ({ ...g, count: g.index ? g.index.length : g.position.length / 3, bounds: { center: [0, 0, 0], radius: 1 } }), texture: () => ({}), updateTexture() {} };
const tris = g => (g.index ? g.index.length : g.position.length / 3) / 3;
const buildTown = () => { const scene = fakeScene(), park = { matte: [], metal: [], foliage: [], lamps: [] }; const town = HR.horrorTown(ctx, scene, new RNG(7), theme, park); return { scene, park, town }; };

test('the theme: a horror park with the haunt streak, a jack-o\'-lantern court, the moon low in the north', () => {
  assert.equal(theme.style, 'horror'); assert.equal(theme.streakFx, 'haunt'); assert.ok(theme.event && theme.kind === 'park');
  assert.equal(EVENTS.monster.color, '#7cff4f'); assert.equal(EVENTS.monster.accent, '#ff7a1a');
  const c = theme.court;
  assert.equal(c.logo.shape, 'jack'); assert.equal(c.baselineText, 'THE MONSTER MASH'); assert.ok(c.horror && c.horror.count > 20);
  assert.ok(theme.floodlights, 'a night park: the floodlights are on');
  // the moon hangs low over the cemetery and the mansion's hill (north, the way the default cameras look)
  const d = HR.moonDir(theme), el = Math.asin(d[1]) * 180 / Math.PI;
  assert.ok(el > 4 && el < 15 && d[2] > 0.95, `moon at ${el.toFixed(1)} degrees`);
  // the moonlight comes from the moon's half of the sky, high enough to play by
  const s = M.v3norm([0, 0, 0], theme.sun.dir);
  assert.ok(s[2] > 0.3 && s[1] > 0.6, 'cold light from over the cemetery');
  assert.ok(theme.fog.density < 0.012, 'fog, but not so thick the far courts vanish');
});

test('the ground: flat under the park, its sidewalks and the south street; the hill rises under the mansion; the swamp dips', () => {
  for (let x = -68; x <= 68; x += 2) for (let z = -64; z <= 37; z += 2) assert.equal(HR.groundY(x, z), 0, `ground at ${x},${z}`);
  assert.ok(HR.groundY(HR.MANSION.x, HR.MANSION.z) > 10, 'the mansion stands on its hill');
  assert.ok(HR.groundY(HR.CEMETERY.gate, HR.CEMETERY.z1) > 0.5, 'the cemetery climbs toward it');
  assert.ok(HR.groundY(HR.LAKE.x, HR.LAKE.z) < HR.LAKE.y, 'the water covers the swamp bed');
  for (let a = 0; a < Math.PI * 2; a += 0.2) assert.ok(Number.isFinite(HR.groundY(Math.cos(a) * 250, Math.sin(a) * 250)));
  for (let x = -140; x <= 140; x += 2) for (const z of [HR.STREET.z0, HR.STREET.z1, HR.STREET.walk[1]]) assert.ok(Math.abs(HR.groundY(x, z)) < 0.02, `the street level at ${x},${z}`);
});

test('the plan: the landmarks off the park, the street and the cameras; the monsters\' haunts clear of the HQ', () => {
  const park = { x0: -63.6, x1: 63.6, z0: -34.3, z1: 33.4 }, street = { x0: -400, x1: 400, z0: HR.STREET.z0, z1: HR.STREET.walk[1] };
  const ov = (a, b, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
  const rect = (x, z, w, d) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
  const L = HR.CARNIVAL, marks = {
    church: rect(HR.CHURCH.x, HR.CHURCH.z, HR.CHURCH.w, HR.CHURCH.d), tower: rect(HR.CHURCH.tower.x, HR.CHURCH.tower.z, HR.CHURCH.tower.s, HR.CHURCH.tower.s),
    mausoleum: rect(HR.MAUSOLEUM.x, HR.MAUSOLEUM.z, HR.MAUSOLEUM.w + 1.6, HR.MAUSOLEUM.d + 1.6), mansion: rect(HR.MANSION.x, HR.MANSION.z, HR.MANSION.w, HR.MANSION.d),
    folly: rect(HR.FOLLY.x, HR.FOLLY.z, HR.FOLLY.r * 2, HR.FOLLY.r * 2), patch: { x0: HR.PATCH.x0, x1: HR.PATCH.x1, z0: HR.PATCH.z0 - 0.6, z1: HR.PATCH.z1 },
    corn: { x0: HR.CORN.x0, x1: HR.CORN.x1, z0: HR.CORN.z0, z1: HR.CORN.z1 }, cemetery: { x0: HR.CEMETERY.x0, x1: HR.CEMETERY.x1, z0: HR.CEMETERY.fence, z1: HR.CEMETERY.z1 },
    wheel: rect(L.wheel.x, L.wheel.z, 9, 4), carousel: rect(L.carousel.x, L.carousel.z, L.carousel.r * 2, L.carousel.r * 2), ride: rect(L.ride.x, L.ride.z, L.ride.w, L.ride.d),
    funeral: rect(HR.FUNERAL.x, HR.FUNERAL.z, HR.FUNERAL.w, HR.FUNERAL.d), cottage: rect(HR.COTTAGE.x, HR.COTTAGE.z, 8, 8), lake: rect(HR.LAKE.x, HR.LAKE.z, HR.LAKE.rx * 2, HR.LAKE.rz * 2),
  };
  for (const [k, r] of Object.entries(marks)) {
    assert.ok(!ov(r, park, 0.5), `${k} in the park`); assert.ok(!ov(r, street, 0.2), `${k} on the street`);
    for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1], [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]]) assert.ok(HR.horrorClear(x, z, 0.5), `${k} in a camera's path at ${x.toFixed(0)},${z.toFixed(0)}`);
  }
  // the graves the dead climb out of are inside the fence, the belfry is the tower's
  for (const [x, z] of HR.GRAVES) assert.ok(x > HR.CEMETERY.x0 && x < HR.CEMETERY.x1 && z > HR.CEMETERY.fence + 3 && z < HR.CEMETERY.z1);
  assert.ok(HR.BELFRY.y > 12 && HR.BELFRY.x === HR.CHURCH.tower.x);
  // the half courts' broadcast cameras past the west fence are kept clear too
  assert.ok(!HR.horrorClear(-68.5, -12, 2) && !HR.horrorClear(-68.5, 9, 2) && HR.horrorClear(-90, -40, 3));
  for (const p of [PARK_HQ, PARK_HALL]) assert.ok(onSomething(p.x, p.z, 0), 'the HQ and the hall are what onSomething guards');
});

test('signs: every word in its own row of the atlas', () => {
  for (const w of ['HAUNTED HOUSE', 'FUNERAL HOME', 'HOLLOW HILL CEMETERY', 'PUMPKIN PATCH', 'CORN MAZE', 'MONSTER MASH']) assert.ok(HORROR_SIGNS.includes(w), w);
  const cells = HORROR_SIGNS.map(w => horrorSignUV(w).join());
  assert.equal(new Set(cells).size, cells.length);
});

test('the town: built in a few dozen batches with no NaN, nothing on a court, a fence, the kiosks or in a camera path, within its triangle budget', () => {
  const { scene, park, town } = buildTown();
  assert.ok(scene.meshes.length > 15 && scene.meshes.length < 60, `${scene.meshes.length} meshes`);
  const r = { particles: { burst() {}, emit() {} } };
  town.update(1 / 30, r); // (the gate leaf and the mansion's silhouettes take their places on the first update)
  let total = 0;
  const P = [0, 0, 0];
  for (const m of scene.meshes) {
    const g = m.geo; total += tris(g);
    assert.ok(finite(g.position) && finite(m.matrix), 'no NaN');
    if (g.joints) { assert.ok(Math.max(...g.joints) < 24, 'within the skinning shader\'s 24 bones'); continue; }
    // (the sky, the fog, the light pools and the cobwebs are decals and veils: everything solid stays off what the park needs)
    if (m.material.blend || m.order <= -5 || m.visible === false) continue;
    for (let i = 0; i < g.position.length; i += 3) {
      M.v3transformMat4(P, [g.position[i], g.position[i + 1], g.position[i + 2]], m.matrix);
      if (P[1] < 0.1 && Math.hypot(P[0], P[2]) < 60) continue; // (flat on the ground: the street's paint)
      assert.ok(!onSomething(P[0], P[2], 0.2), `town piece on something at ${P[0].toFixed(1)},${P[1].toFixed(1)},${P[2].toFixed(1)}`);
      assert.ok(camClear(P[0], P[2], 0), `town piece in a camera path at ${P[0].toFixed(1)},${P[2].toFixed(1)}`);
    }
  }
  assert.ok(total < 120000, `${total} triangles in the town`);
  // what stands inside the park (the braziers, the jack-o'-lantern piles) goes into the park's shadow batches
  for (const q of [...park.metal, ...park.matte]) { const x = q.matrix[12], z = q.matrix[14]; assert.ok(!onSomething(x, z, 0.3) && camClear(x, z, 0), `park piece at ${x},${z}`); }
  assert.ok(park.metal.length && park.matte.length);
  // the town runs: the rides turn, the lightning lights everything up and fades
  const wheel = scene.meshes.find(m => m.bones && m.bones.length === 16 * 17);
  assert.ok(wheel, 'the Ferris wheel (17 bones)');
  town.update(1 / 30, r); const w0 = wheel.bones.slice(0, 16);
  for (let i = 0; i < 90; i++) town.update(1 / 30, r);
  assert.ok(wheel.bones.some((v, i) => i < 16 && Math.abs(v - w0[i]) > 1e-4), 'the wheel turns');
  const e0 = scene.exposure; HR.flashScene(scene, 1); town.update(1 / 30, r);
  assert.ok(scene.exposure > e0 * 1.2, 'a flash'); for (let i = 0; i < 120; i++) town.update(1 / 30, r);
  assert.ok(Math.abs(scene.exposure - e0) < 0.02, 'and it fades');
  for (const m of scene.meshes) assert.ok(finite(m.matrix) && (!m.bones || finite(m.bones)));
});

test('monsters: every kind builds, stands on its feet, about 1.87 m tall, light enough to run a crowd; every move is finite', () => {
  const kinds = ['zombie', 'mummy', 'vampire', 'werewolf', 'wolfman', 'skeleton', 'kidSheet', 'kidPumpkin', 'kidWitch', 'kidSkelly', 'kidCape', 'teen', 'slasher', 'lanternman', 'witch'];
  const B = new Float32Array(16 * HR.FB);
  for (const kind of kinds) {
    const { geo, glow } = HR.figureGeo([{ kind }]);
    assert.ok(tris(geo) + (glow ? tris(glow) : 0) < 2000, `${kind}: ${tris(geo)} triangles`);
    HR.poseFigure(B, 0, 0, 0, 0, 0, HR.MOVES.stand(0), 1, kind);
    let lo = Infinity, hi = -Infinity; const P = [0, 0, 0];
    for (let i = 0; i < geo.position.length / 3; i++) { const j = geo.joints[i * 4]; M.v3transformMat4(P, [geo.position[i * 3], geo.position[i * 3 + 1], geo.position[i * 3 + 2]], B.subarray(j * 16, j * 16 + 16)); lo = Math.min(lo, P[1]); hi = Math.max(hi, P[1]); }
    // (the long robes and coats hang to the ground with the feet)
    assert.ok(lo > -0.06 && lo < 0.05, `${kind} floats or sinks (${lo.toFixed(3)})`);
    assert.ok(hi > 1.75 && hi < 2.45, `${kind} stands ${hi.toFixed(2)} m`);
  }
  for (const [name, mv] of Object.entries(HR.MOVES)) for (let ph = 0; ph < 12; ph += 0.37) { HR.poseFigure(B, 0, 1, 0, 2, 0.5, mv(ph, ph), 1.1, 'slasher'); assert.ok(finite(B), `${name} at ${ph}`); }
  for (let b = 0; b < 32; b += 0.25) { const { P, dx } = HR.zombieRoutine(b); HR.poseFigure(B, 0, dx, 0, 0, 0, P, 1, 'zombie'); assert.ok(finite(B) && Number.isFinite(dx), `the routine at beat ${b}`); }
  HR.poseFigure(B, 0, 5, 0, 5, 0, { hidden: true }); assert.ok(B[13] < -50, 'hidden folds it away under the ground');
  // the little ones: ghosts, cats, bats, all within the shader's bones
  const gb = new Float32Array(16 * 16), g = HR.ghostGeo(8); HR.poseGhost(gb, 7, 0, 1, 0, 0, 3); assert.ok(Math.max(...g.joints) < 16 && finite(gb));
  const cb = new Float32Array(16 * 15), c = HR.catGeo(3); HR.poseCat(cb, 2, 0, 1.6, 0, 0, 2, 1, 1); assert.ok(Math.max(...c.geo.joints) < 15 && finite(cb));
  const bb = new Float32Array(16 * 24), b = HR.batGeo(8); HR.poseBat(bb, 7, 0, 9, 0, 0, 3, 0.2, 1.6); assert.ok(Math.max(...b.joints) < 24 && finite(bb));
});

test('the haunt streak: hidden until a streak, more at every level, the floodlights green from 6 wins and given back, all gone on dispose', () => {
  const scene = fakeScene(), court = { id: 'main', origin: [0, 0, 0], full: true };
  const flood = { pos: [0, 13.5, 0], range: 38, color: [0.9, 1, 0.86], intensity: 46, dir: [0, -1, 0], cos: 0.5 }, other = { pos: [26, 13.5, 0], range: 38, color: [0.9, 1, 0.86], intensity: 46, dir: [0, -1, 0], cos: 0.5 };
  scene.lights.push(flood, other);
  const fx = new StreakFX(ctx, scene, court, 'haunt');
  const settle = (lv, s = 6) => { fx.setLevel(lv); for (let i = 0; i < s * 60; i++) fx.update(1 / 60); return fx.meshes.filter(m => m.visible).length; };
  assert.equal(settle(0), 0);
  let prev = 0;
  for (const lv of [1, 2, 3, 4]) {
    const n = settle(lv); assert.ok(n > prev, `level ${lv}: ${n} visible`); prev = n;
    if (lv >= 2) assert.ok(flood.color[1] > flood.color[0] * 1.8, `green floodlight at ${lv}`); else assert.deepEqual(flood.color, [0.9, 1, 0.86]);
    assert.deepEqual(other.color, [0.9, 1, 0.86], 'the next court\'s light is left alone');
  }
  assert.equal(scene.lights.length, 2, 'no lights of its own');
  // the skull over the court, the ghosts round it, the hands on the apron (never on the floor in play, never at Got Next)
  assert.ok(Math.abs(fx.skull.bones[13] - HAUNT_FX.skullH) < 1.2, 'the skull hangs over the court');
  for (const sp of fx.handSpots) { assert.ok(Math.abs(sp.x) > 7.4 || Math.abs(sp.z) > 14.1, `a hand on the floor at ${sp.x.toFixed(1)},${sp.z.toFixed(1)}`); assert.ok(!(Math.abs(sp.x - 9.4) < 1.6 && Math.abs(sp.z) < 6.5), 'Got Next stays clear'); }
  for (const m of fx.meshes) assert.ok(finite(m.matrix) && (!m.bones || finite(m.bones)));
  // lightning: a bolt now and then at the top level, gone again after its flashes
  let bolts = 0; for (let i = 0; i < 60 * 20; i++) { fx.update(1 / 60); if (fx.hBolt) bolts++; }
  assert.ok(bolts > 0, 'lightning at 12 wins');
  assert.equal(settle(0, 10), 0); assert.deepEqual(flood.color, [0.9, 1, 0.86]); assert.equal(flood.intensity, 46);
  assert.ok(!fx.hBolt, 'no bolt left');
  settle(4); fx.dispose(); assert.deepEqual(flood.color, [0.9, 1, 0.86]); assert.equal(flood.intensity, 46);
  assert.ok(!scene.meshes.length, 'all removed'); assert.equal(scene.lights.length, 2);
});

test('park life: the monsters walk their haunts, every event plays out and leaves no meshes, no lights, nobody borrowed', () => {
  const { scene, town } = buildTown();
  const r = { ctx, particles: { burst() {}, emit() {} } };
  const life = createParkLife(r, scene, theme, new RNG(7), { town });
  const H = life.horror;
  assert.ok(H && H.zA && H.vamp && H.wolf && H.mum && H.skel && H.kids.length === 2 && H.swarms.length === 3);
  const b0 = H.zA.bones.slice(), v0 = H.vamp.bones.slice();
  for (let i = 0; i < 60 * 6; i++) { life.update(1 / 60); town.update(1 / 60, r); }
  assert.ok(H.zA.bones.some((v, i) => Math.abs(v - b0[i]) > 1e-3), 'the zombies shamble');
  assert.ok(H.vamp.bones.some((v, i) => Math.abs(v - v0[i]) > 1e-3), 'the vampire glides');
  for (const m of scene.meshes) assert.ok(finite(m.matrix) && (!m.bones || finite(m.bones)), 'no NaN');
  // every event runs to its end and cleans up (first let any random one the scheduler started finish)
  const drain = () => { for (let k = 0; k < 60 * 600 && life.eventCount; k++) { life.update(1 / 60); if (k % 4 === 0) town.update(4 / 60, r); } };
  drain();
  const base = scene.meshes.length, lights = scene.lights.length;
  for (let i = 0; i < 11; i++) {
    life.trigger(i);
    assert.ok(scene.meshes.length >= base);
    for (let k = 0; k < 60 * 4; k++) { life.update(1 / 60); assert.ok(scene.lights.length <= 8, 'never more lights than the renderer uses'); }
    for (const m of scene.meshes) assert.ok(finite(m.matrix) && (!m.bones || finite(m.bones)), `event ${i}: no NaN`);
    drain();
    assert.equal(life.eventCount, 0, `event ${i} ends`);
    assert.equal(scene.meshes.length, base, `event ${i} leaves no meshes`);
    assert.equal(scene.lights.length, lights, `event ${i} leaves no lights`);
  }
  for (let i = 0; i < 60 * 3 && life.eventCount === 0; i++) life.update(1 / 60);
  if (!life.eventCount) assert.ok(H.hold.slasher <= 0 && H.hold.zombies <= 0, 'the borrowed monsters are back');
});
