// v0.4.8.5 quick patch: And The Beat Goes On, the 80s event park. The city plan, the disco bar, the people and lowriders,
// the sky and the disco streak are pure enough to check here: nothing in the park or on a street, low roofs under the
// sun, figures on their feet, the events and the streak building and tearing down cleanly.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../client/js/core/math.js';
import { RNG } from '../client/js/core/rng.js';
import { THEMES, EVENTS, PARK_COURTS, PARK_HQ, PARK_HALL } from '../client/js/world/themes.js';
import * as RT from '../client/js/world/retro.js';
import { onSomething, camClear } from '../client/js/world/harbor.js';
import { StreakFX, DISCO_FX } from '../client/js/world/streakfx.js';
import { createParkLife } from '../client/js/world/parklife.js';
import { RETRO_WORDS, retroSignUV } from '../client/js/gfx/textures.js';

const theme = THEMES.beat;
const tris = parts => parts.reduce((n, p) => n + p.geo.index.length / 3, 0);
const box = b => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 });
const overlap = (a, b, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
const finite = m => [...m].every(Number.isFinite);

test('the theme: a retro park event with the disco streak, retro courts, the sun on the horizon', () => {
  assert.equal(theme.style, 'retro'); assert.equal(theme.streakFx, 'disco'); assert.ok(theme.event && theme.kind === 'park');
  assert.equal(EVENTS.beat.color, '#ff3fa4'); assert.equal(EVENTS.beat.accent, '#2fe0ff');
  const c = theme.court;
  assert.equal(c.logo.shape, 'sunset'); assert.equal(c.baselineText, 'AND THE BEAT GOES ON'); assert.ok(c.retro && c.retro.stripes.length === 3);
  // low sun, long shadows, but enough of it on the floor to play by
  const d = M.v3norm([0, 0, 0], theme.sun.dir), el = Math.asin(d[1]) * 180 / Math.PI;
  assert.ok(el > 10 && el < 20, `sun ${el.toFixed(1)} degrees up`);
  assert.ok(theme.sunset.el < 8 && theme.sunset.size >= 6, 'the disc sits on the horizon');
  // the disc and the light come from the same bearing
  const az = Math.atan2(-d[0], d[2]) * 180 / Math.PI;
  assert.ok(Math.abs(az - theme.sunset.az) < 2, `light at ${az.toFixed(1)}, disc at ${theme.sunset.az}`);
});

test('the sky: purple overhead, orange at the horizon under the sun, pinker away from it', () => {
  const D = Math.PI / 180;
  const top = RT.skyColor(80 * D, 0, 0), sunHz = RT.skyColor(0.5 * D, 1, 0.99), farHz = RT.skyColor(0.5 * D, -1, -0.3), mid = RT.skyColor(12 * D, 0, 0);
  assert.ok(top[2] > top[1] && top[0] > top[1] && top[0] + top[1] + top[2] < 0.5, 'deep purple overhead');
  assert.ok(sunHz[0] > sunHz[1] && sunHz[1] > sunHz[2], 'orange toward the sun');
  assert.ok(sunHz[0] + sunHz[1] > farHz[0] + farHz[1], 'brighter toward the sun');
  assert.ok(farHz[2] > sunHz[2] * 0.8 && farHz[0] > farHz[1], 'pink away from it');
  assert.ok(mid[0] > mid[1] * 3 && mid[2] > mid[1] * 2, 'hot pink to magenta in between');
});

test('the city plan: every block off the park, the streets and each other; only low roofs under the sun', () => {
  const plan = RT.cityPlan(theme);
  assert.ok(plan.length > 60, `${plan.length} blocks`);
  for (const k of ['arcade', 'hotel', 'rink', 'disco', 'diner', 'motel']) assert.ok(plan.some(b => b.special === k), k);
  const park = { x0: -63.6, x1: 63.6, z0: -34.3, z1: 33.4 };
  const roads = [{ x0: -400, x1: 400, z0: RT.STRIP.walkIn[0], z1: RT.STRIP.walkOut[1] }, { x0: -400, x1: 400, z0: RT.SOUTH.back, z1: RT.SOUTH.z1 + 3 },
    ...[-1, 1].map(s => ({ x0: s > 0 ? RT.AVE.walkIn : -RT.AVE.walkOut, x1: s > 0 ? RT.AVE.walkOut : -RT.AVE.walkIn, z0: -400, z1: 400 }))];
  plan.forEach((b, i) => {
    const r = box(b);
    assert.ok(!overlap(r, park, 0.4), `block ${i} (${b.special || b.kind}) in the park`);
    for (const rd of roads) assert.ok(!overlap(r, rd, -0.05), `block ${i} at ${b.x.toFixed(0)},${b.z.toFixed(0)} on a street`);
    for (let j = 0; j < i; j++) assert.ok(!overlap(r, box(plan[j]), -0.1), `blocks ${j} and ${i} overlap`);
    if (RT.inSunBand(b.x, b.z, theme)) assert.ok(b.h <= 4.2, `a ${b.h.toFixed(1)} m block under the sun at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
    assert.ok(b.h > 3 && b.h < 80);
  });
  // the shops on the plaza face it; the disco is where the people gather
  const disco = plan.find(b => b.special === 'disco');
  assert.equal(disco.face, 'z+'); assert.equal(disco.z + disco.d / 2, RT.DISCO.z);
});

test('the disco bar, the breakers, the crew and the line stay off the courts, the plaza shops, the HQ and the cameras', () => {
  const D = RT.DISCO;
  assert.ok(D.z < -34, 'the disco is across the sidewalk');
  for (let x = D.x - D.w / 2; x <= D.x + D.w / 2; x += 1) assert.ok(!onSomething(x, D.z - 0.5, 0.5) && camClear(x, D.z, 4.5), `disco front at ${x}`);
  for (const k of ['breakers', 'crew']) {
    const s = RT.SPOTS[k];
    for (let a = 0; a < Math.PI * 2; a += 0.3) { const x = s.x + Math.cos(a) * 3.3, z = s.z + Math.sin(a) * 3.3; /* (the onlookers' ring) */ assert.ok(!onSomething(x, z, 0.4), `${k} ring on something at ${x.toFixed(1)},${z.toFixed(1)}`); assert.ok(RT.retroClear(x, z, 0.5), `${k} in a camera path`); }
    assert.ok(Math.hypot(s.x - PARK_HQ.x, s.z - PARK_HQ.z) > 8 && Math.hypot(s.x - PARK_HALL.x, s.z - PARK_HALL.z) > 8);
  }
  for (const c of PARK_COURTS) for (const s of [RT.SPOTS.breakers, RT.SPOTS.crew]) assert.ok(Math.abs(s.x - c.origin[0]) > 9.82 + 3.3 || Math.abs(s.z - c.origin[2]) > 16.9 + 3.3, 'off the courts');
  // the half courts' broadcast cameras stand past the west fence: retroClear keeps palms off them
  assert.ok(!RT.retroClear(-68.5, -12, 2) && !RT.retroClear(-68.5, 9, 2) && RT.retroClear(-79.6, -30, 3));
});

test('neon: the 80s words are all in the atlas, the event name across a whole row', () => {
  for (const w of ['DISCO', 'ARCADE', 'VIDEO', 'ROLLER RINK', 'RECORDS', 'DINER', 'MOTEL']) assert.ok(RETRO_WORDS.some(([t]) => t === w), w);
  assert.deepEqual(retroSignUV('BEAT'), [0, 0.75, 1, 0.125]);
  const cells = RETRO_WORDS.map(([t]) => retroSignUV(t).join());
  assert.equal(new Set(cells).size, cells.length, 'every word its own cell');
});

test('lowriders: one long, low part list, wheels on the ground, the front at +z, light enough to run a dozen', () => {
  for (const conv of [false, true]) {
    const parts = RT.lowrider('#7b1fa2', { convertible: conv });
    let lo = Infinity, hi = -Infinity, z0 = Infinity, z1 = -Infinity, top = -Infinity;
    for (const p of parts) for (let i = 0; i < p.geo.position.length; i += 3) { lo = Math.min(lo, p.geo.position[i + 1]); top = Math.max(top, p.geo.position[i + 1]); z0 = Math.min(z0, p.geo.position[i + 2]); z1 = Math.max(z1, p.geo.position[i + 2]); }
    assert.ok(Math.abs(lo) < 0.02, `wheels at ${lo}`); assert.ok(z1 - z0 > 5.5 && z1 - z0 < 6.3, 'long'); assert.ok(top < 1.45, 'low');
    assert.ok(tris(parts) < 1200, `${tris(parts)} triangles`);
    assert.ok(parts.every(p => !p.matrix && p.color.length === 4), 'baked, coloured');
  }
});

test('dancers: every pose builds, on its feet (the power moves keep the standing frame), a figure the right size', () => {
  for (const [name, pose] of Object.entries(RT.POSES)) {
    const parts = RT.dancer(pose, RT.OUTFITS[3]);
    let lo = Infinity, hi = -Infinity;
    for (const p of parts) for (let i = 1; i < p.geo.position.length; i += 3) { lo = Math.min(lo, p.geo.position[i]); hi = Math.max(hi, p.geo.position[i]); }
    assert.ok(parts.every(p => [...p.geo.position].every(Number.isFinite)), name);
    if (!pose.free) assert.ok(Math.abs(lo) < 1e-5, `${name} floats or sinks (${lo})`);
    assert.ok(tris(parts) < 600, `${name}: ${tris(parts)} triangles`);
    if (name === 'stand') assert.ok(hi > 1.7 && hi < 1.95, `stands ${hi.toFixed(2)} m`);
  }
  for (const o of RT.OUTFITS) assert.ok(RT.dancer(RT.POSES.stand, { ...o, skates: true }).length > RT.dancer(RT.POSES.stand, o).length, 'skates on');
});

test('beams and mirror balls: fading cones with no NaN in them, a ball of flat facets', () => {
  const g = RT.beamGeo(11 / Math.cos(0.5), 0.06, 1.6, 12, 0.3);
  assert.ok([...g.color].every(Number.isFinite));
  let tip = 0; for (let i = 0; i < g.position.length / 3; i++) if (g.position[i * 3 + 1] > 12) tip = Math.max(tip, g.color[i * 4 + 3]);
  assert.ok(tip < 1e-6, 'gone at the tip');
  const b = RT.mirrorBall(1, 12, 22);
  assert.ok(b.index.length / 3 > 300 && b.index.length / 3 < 800);
  // each facet's four corners share the facet's normal
  for (let f = 0; f < b.position.length / 12; f++) { const n = b.normal.slice(f * 12, f * 12 + 3); for (let k = 1; k < 4; k++) assert.ok(Math.abs(b.normal[f * 12 + k * 3] - n[0]) < 1e-6); }
});

// (the banner plane and the blimp paint their banners on a canvas: a stand-in 2D context that draws nothing)
const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
const fakeScene = () => { const meshes = []; return { meshes, lights: [], add(m) { meshes.push(m); return m; }, remove(m) { const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); } }; };
const ctx = { geometry: g => ({ ...g, count: g.index ? g.index.length : g.position.length / 3, bounds: { center: [0, 0, 0], radius: 1 } }), texture: () => ({}) };

test('the disco streak: hidden until a streak, the ball lowers in, more and more at every level, lights from 6 wins, all gone on dispose', () => {
  const scene = fakeScene(), court = { id: 'main', origin: [0, 0, 0], full: true };
  const fx = new StreakFX(ctx, scene, court, 'disco');
  const settle = (lv, s = 6) => { fx.setLevel(lv); for (let i = 0; i < s * 60; i++) fx.update(1 / 60); return fx.meshes.filter(m => m.visible).length; };
  assert.equal(settle(0), 0);
  let prev = 0;
  for (const lv of [1, 2, 3, 4]) { const n = settle(lv); assert.ok(n > prev, `level ${lv}: ${n} visible`); prev = n; assert.equal(scene.lights.length, lv >= 2 ? 2 : 0, `lights at ${lv}`); }
  assert.ok(Math.abs(fx.ball.matrix[13] - DISCO_FX.height) < 0.01, 'the ball hangs at its height');
  for (const m of fx.meshes) assert.ok(finite(m.matrix));
  for (const l of scene.lights) assert.ok(l.intensity > 0 && l.dir.every(Number.isFinite) && l.dir[1] < -0.5, 'aimed down');
  assert.equal(settle(0), 0); assert.equal(scene.lights.length, 0);
  settle(3); fx.dispose(); assert.equal(scene.lights.length, 0); assert.ok(!scene.meshes.length, 'all removed');
});

test('park life: lowriders cruise and hop, dancers change pose on the beat, every event plays out and leaves nothing behind', () => {
  const scene = fakeScene(), bursts = [];
  const r = { ctx, particles: { burst: (...a) => bursts.push(a), emit() {} } };
  const city = { t: 0, BPM: 118, dark: 0, blackout() { this.dark++; }, disco: { face: { P: (a, o) => [25 + a, -40.2 + o], nx: 0, nz: 1 } } };
  const life = createParkLife(r, scene, theme, new RNG(7), { city });
  const R = life.retro;
  assert.ok(R && R.cars.length >= 8 && R.parked.length === 3 && R.breakers.length === 4 && R.dancers.length >= 20);
  const start = R.cars.map(c => c.p), poses = new Set();
  let pitched = 0;
  for (let i = 0; i < 60 * 12; i++) { city.t += 1 / 60; life.update(1 / 60); for (const d of R.dancers) poses.add(d.pose); for (const c of R.parked) pitched = Math.max(pitched, Math.abs(c.mesh.matrix[9])); }
  assert.ok(R.cars.every((c, i) => c.p !== start[i]), 'they cruise');
  assert.ok(pitched > 0.2, 'the hopper gets its nose up');
  assert.ok(bursts.length > 0, 'sparks when it lands');
  assert.ok(poses.size > 12, `${poses.size} poses seen`);
  for (const m of scene.meshes) assert.ok(finite(m.matrix), 'no NaN in a matrix');
  // every event runs to its end and cleans up (first let any random one the scheduler started finish)
  const drain = () => { for (let k = 0; k < 60 * 600 && life.eventCount; k++) { city.t += 1 / 60; life.update(1 / 60); } }; // (random ones chain on)
  drain();
  const base = scene.meshes.length, dancers = R.dancers.length;
  for (let i = 0; i < 9; i++) {
    life.trigger(i);
    assert.ok(scene.meshes.length >= base);
    drain();
    assert.equal(life.eventCount, 0, `event ${i} ends`);
    assert.equal(scene.meshes.length, base, `event ${i} leaves no meshes`);
    assert.equal(R.dancers.length, dancers, `event ${i} leaves no dancers`);
  }
  assert.ok(city.dark >= 1, 'the blackout asked the city');
});
