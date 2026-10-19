// v0.4.8.7 polish for The Favelas: the siren and the bateria's drums (synthesized, positioned, at or under the park
// ambience, silent with SFX off, every node stopped when the event ends or the park is left), the doors that open for a
// neighbour and always shut again, the people walking with real strides (the crowd, the officers on foot, the drummers),
// the kite fight close and low enough to read from the plaza, and the ground between the houses.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../client/js/core/rng.js';
import { THEMES } from '../client/js/world/themes.js';
import * as FV from '../client/js/world/favela.js';
import * as FX from '../client/js/core/favelasound.js';
import { SPOOKY } from '../client/js/core/spooky.js';
import { audio } from '../client/js/core/audio.js';
import { createParkLife } from '../client/js/world/parklife.js';
import * as T from '../client/js/gfx/textures.js';

const theme = THEMES.favela;
const finite = m => [...m].every(Number.isFinite);
const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x) * (h || y) * 4 || 4) }) : k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
const fakeScene = () => { const meshes = []; return { meshes, lights: [], exposure: 1, shadowFocus: { center: [0, 0, 30], radius: 16 }, add(m) { meshes.push(m); return m; }, remove(m) { const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); } }; };
const ctx = { geometry: g => ({ ...g, count: g.index ? g.index.length : g.position.length / 3, bounds: { center: [0, 0, 0], radius: 1 } }), texture: () => ({}), updateTexture() {} };
const buildTown = () => { const scene = fakeScene(), park = { matte: [], metal: [], foliage: [], lamps: [] }; const town = FV.favelaTown(ctx, scene, new RNG(7), theme, park); return { scene, park, town }; };

// ---- a stand-in WebAudio: every node it makes, every source started and stopped, the params' last values ----
const made = [];
class Param { constructor(v = 0) { this.value = v; this.events = []; } setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); return this; } linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['lin', v, t]); return this; } exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exp', v, t]); return this; } setTargetAtTime(v, t, k) { this.value = v; this.events.push(['target', v, t, k]); return this; } cancelScheduledValues() { return this; } }
class Node { constructor(kind) { this.kind = kind; this.out = []; made.push(this); } connect(n) { this.out.push(n); return n; } disconnect() {} }
class Source extends Node { constructor(kind) { super(kind); this.started = null; this.stopped = null; this.frequency = new Param(440); this.detune = new Param(0); } start(t = 0) { this.started = t; } stop(t = 0) { if (this.started == null) throw new Error('stop before start'); this.stopped = t; } }
class FakeAC {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sampleRate = 8000; this.destination = new Node('dest'); }
  resume() {}
  createGain() { const n = new Node('gain'); n.gain = new Param(1); return n; }
  createOscillator() { const n = new Source('osc'); n.type = 'sine'; return n; }
  createBufferSource() { const n = new Source('buffer'); return n; }
  createBiquadFilter() { const n = new Node('filter'); n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); return n; }
  createStereoPanner() { const n = new Node('pan'); n.pan = new Param(0); return n; }
  createDynamicsCompressor() { const n = new Node('comp'); n.threshold = new Param(0); n.ratio = new Param(1); return n; }
  createDelay() { const n = new Node('delay'); n.delayTime = new Param(0); return n; }
  createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
}
globalThis.window = globalThis.window || {};
globalThis.window.AudioContext = FakeAC;
const on = () => { audio.unlocked = true; audio.muted = false; audio.volume.sfx = 0.9; assert.ok(audio.ensure(), 'the stand-in context comes up'); };
const tick = (s = 1 / 60) => { audio.ctx.currentTime += s; };
const srcOf = h => h.sources;

test('the siren: two tones, louder as it comes and fading as it goes, bent up then down as it passes, panned across; every node stopped', () => {
  on();
  const scene = fakeScene(); scene.shadowFocus.center = [0, 0, 38];
  const n0 = made.length, h = FX.siren(scene);
  assert.ok(h && FX.live.has(h), 'it plays');
  assert.ok(made.length - n0 >= 6, `${made.length - n0} nodes`);
  assert.ok(srcOf(h).length >= 1 && srcOf(h).every(s => s.started != null && s.stopped == null), 'its oscillators are going');
  // the police bike rides past along the north street at 14 m/s
  const g = h.nodes.find(n => n.kind === 'gain' && n.out[0]?.kind === 'pan'), pan = h.nodes.find(n => n.kind === 'pan'), o = srcOf(h)[0];
  const trace = [];
  for (let x = 80; x >= -80; x -= 14 / 60) { h.update(1 / 60, x, 38); tick(); trace.push({ x, g: g.gain.value, det: o.detune.value, pan: pan.pan.value }); }
  const near = trace.reduce((b, q) => (q.g > b.g ? q : b));
  assert.ok(Math.abs(near.x) < 16, `loudest as it passes (at x ${near.x.toFixed(1)})`);
  assert.ok(trace[0].g < near.g * 0.3 && trace[trace.length - 1].g < near.g * 0.3, 'quieter far off');
  assert.ok(near.g <= FX.FAVELA_SOUND.level + 1e-9 && FX.FAVELA_SOUND.level <= SPOOKY.level, 'no louder than the park ambience');
  const coming = trace.find(q => q.x < 40 && q.x > 30), going = trace.find(q => q.x < -30 && q.x > -40);
  assert.ok(coming.det > 20 && going.det < -20, `the Doppler bend: ${coming.det.toFixed(0)} then ${going.det.toFixed(0)} cents`);
  assert.ok(Math.sign(coming.pan) === -Math.sign(going.pan) && Math.abs(coming.pan) > 0.3, 'it crosses from one side to the other');
  // two tones alternating
  const fs = new Set(o.frequency.events.filter(e => e[0] === 'set').map(e => e[1]));
  assert.deepEqual([...fs].sort(), [FX.FAVELA_SOUND.siren.lo, FX.FAVELA_SOUND.siren.hi].sort());
  h.stop();
  assert.ok(srcOf(h).every(s => s.stopped != null), 'stopped'); assert.ok(!FX.live.has(h));
});

test('the bateria: surdo, caixa and tamborim on the pattern; at or under the ambience; stopped at the end', () => {
  on();
  const scene = fakeScene(), h = FX.bateria(scene);
  assert.ok(h, 'it plays');
  for (let i = 0; i < 60 * 4; i++) { h.update(1 / 60, 0, 40); tick(); }
  const per = 60 / FX.FAVELA_SOUND.bpm / 4;
  assert.ok(Math.abs(h.steps - 4.2 / per) < 4, `${h.steps} sixteenths in 4 s`);
  const gains = h.nodes.filter(n => n.kind === 'gain' && n.out[0]?.kind !== 'pan' && n.gain.events.some(e => e[0] === 'lin'));
  assert.ok(gains.length >= 3, `${gains.length} drum voices hit`);
  for (const g of gains) for (const e of g.gain.events) if (e[0] === 'lin') assert.ok(e[1] <= 0.25, 'each hit kept low');
  h.stop();
  assert.ok(h.sources.length >= 4 && h.sources.every(s => s.stopped != null), 'every source stopped');
});

test('silent when SFX is off or muted: nothing is made at all', () => {
  on();
  const scene = fakeScene();
  audio.volume.sfx = 0; let n0 = made.length;
  assert.equal(FX.siren(scene), null); assert.equal(FX.bateria(scene), null); assert.equal(made.length, n0, 'no nodes with SFX off');
  audio.volume.sfx = 0.9; audio.muted = true; n0 = made.length;
  assert.equal(FX.siren(scene), null); assert.equal(made.length, n0, 'none muted');
  audio.muted = false;
});

test('a sound left behind (the park was left mid-event) stops itself', async () => {
  on();
  const h = FX.siren(fakeScene()); h.update(1 / 60, 0, 0);
  await new Promise(r => setTimeout(r, (FX.FAVELA_SOUND.watchdog + 0.7) * 1000));
  assert.ok(h.stopped && h.sources.every(s => s.stopped != null), 'the watchdog stopped it');
});

test('the events carry their sounds: the chases a siren, the bateria its drums; all stopped when they end', () => {
  on();
  const { scene, town } = buildTown();
  const life = createParkLife({ ctx, particles: { burst() {}, emit() {} } }, scene, theme, new RNG(5), { town }), F = life.favela;
  for (let k = 0; k < 60 * 600 && life.eventCount; k++) life.update(1 / 60);
  FX.stopAll();
  for (const i of [0, 2, 4]) {
    const n0 = made.length;
    life.trigger(i);
    for (let k = 0; k < 60 * 3; k++) { life.update(1 / 60); tick(); }
    assert.equal(FX.live.size, 1, `event ${i} sounds`);
    const h = [...FX.live][0];
    for (let k = 0; k < 60 * 600 && life.eventCount; k++) { life.update(1 / 60); tick(); }
    assert.equal(life.eventCount, 0);
    assert.equal(FX.live.size, 0, `event ${i}: its sound stopped`);
    assert.ok(h.sources.every(s => s.stopped != null), `event ${i}: every source stopped`);
    assert.ok(made.slice(n0).filter(n => n instanceof Source).every(s => s.stopped != null), `event ${i}: nothing left playing`);
  }
  assert.ok(F.stats.sirens >= 2 && F.stats.drums >= 1);
});

test('the doors: now and then one swings open, a neighbour steps out, stands about, goes back in, and it shuts; a few at a time', () => {
  const { scene, town } = buildTown();
  assert.ok(town.doors.length >= 6, `${town.doors.length} doors that open`);
  for (const d of town.doors) { assert.equal(d.h.row, 0); assert.ok(!d.h.shop); assert.equal(d.k, 0); }
  const life = createParkLife({ ctx, particles: { burst() {}, emit() {} } }, scene, theme, new RNG(9), { town }), F = life.favela, D = F.doorLife;
  let maxK = 0, outFront = 0;
  for (let i = 0; i < 60 * 240; i++) {
    life.update(1 / 60);
    for (const d of town.doors) maxK = Math.max(maxK, d.k);
    for (const s of D.slots) if (s.st === 'stay') {
      // the neighbour's out in front of their door, on their feet
      const B = F.doorPeople.bones(s.j), d = town.doors[s.d], dist = Math.hypot(B[12] - d.mid[0], B[14] - d.mid[2]);
      assert.ok(dist < 2.0 && dist > 0.6, `out in front (${dist.toFixed(2)} m)`); assert.ok(d.k > 0.99, 'the door stands open while they are out'); outFront++;
    }
  }
  assert.ok(D.cycles >= 8, `${D.cycles} trips out`); assert.ok(maxK > 0.99, 'doors swing all the way open'); assert.ok(outFront > 0);
  assert.ok(D.maxActive <= D.cfg.max, `at most ${D.cfg.max} at a time (${D.maxActive})`);
  // stop new trips: every door ends shut and everybody back in
  D.on = false;
  for (let i = 0; i < 60 * 40; i++) life.update(1 / 60);
  assert.ok(town.doors.every(d => d.k === 0), 'every door shut again');
  assert.ok(D.slots.every(s => s.d < 0 && s.st === 'idle'), 'everybody back inside');
  assert.equal(D.closed, D.cycles, 'every door that opened closed');
  // the leaves are back flush in their frames
  for (let i = 0; i < town.doors.length; i++) { const b = town.doorMesh.bones.subarray(i * 16, i * 16 + 16), d = town.doors[i]; assert.ok(Math.hypot(b[12] - d.hinge[0], b[14] - d.hinge[2]) < 1e-4); assert.ok(Math.abs(Math.atan2(b[8], b[10]) - Math.atan2(Math.sin(d.h.yaw), Math.cos(d.h.yaw))) < 1e-4); }
  for (const m of scene.meshes) assert.ok(!m.bones || finite(m.bones));
});

// the angle between a figure's thigh (or upper arm) and its hips, about their sides: changes as the legs swing
const limb = (B, b) => { const o = b * 16, dot = (i, j) => B[o + i] * B[j] + B[o + i + 1] * B[j + 1] + B[o + i + 2] * B[j + 2]; return Math.atan2(dot(4, 8), dot(4, 4)); }; // (the bone's up axis against the hips' forward and up)
const swings = (read, steps, run) => { const a = [], r = [], l = []; for (let i = 0; i < steps; i++) { run(); const B = read(); a.push(limb(B, 3)); r.push(limb(B, 5)); l.push(limb(B, 7)); } const span = v => Math.max(...v) - Math.min(...v); return { arm: Math.max(span(a), span(r)), leg: span(l) }; };

test('people walk with real strides: legs and arms swing (the crowd, the officers on foot, the drummers)', () => {
  const { scene, town } = buildTown();
  const life = createParkLife({ ctx, particles: { burst() {}, emit() {} } }, scene, theme, new RNG(4), { town }), F = life.favela;
  for (let k = 0; k < 60 * 600 && life.eventCount; k++) life.update(1 / 60);
  // a walker who's walking
  for (const p of F.people) p.pause = 0;
  const p = F.people[0];
  const w = swings(() => F.crowd.bones(p.i), 90, () => { p.pause = 0; life.update(1 / 60); });
  assert.ok(w.leg > 0.5 && w.arm > 0.3, `the walker's legs swing ${w.leg.toFixed(2)} rad, arms ${w.arm.toFixed(2)}`);
  // standing still, they don't stride
  p.pause = 100; const s = swings(() => F.crowd.bones(p.i), 60, () => life.update(1 / 60));
  assert.ok(s.leg < 0.1, `standing: ${s.leg.toFixed(2)}`);
  // the officers on foot running
  life.trigger(2); for (let k = 0; k < 60; k++) life.update(1 / 60);
  const c = swings(() => F.cast.cops.bones(0), 60, () => life.update(1 / 60));
  assert.ok(c.leg > 0.8 && c.arm > 0.6, `the officer runs: legs ${c.leg.toFixed(2)}, arms ${c.arm.toFixed(2)}`);
  const r = swings(() => F.cast.runner.bones(0), 30, () => life.update(1 / 60));
  assert.ok(r.leg > 0.8, `the lad runs: ${r.leg.toFixed(2)}`);
  for (let k = 0; k < 60 * 600 && life.eventCount; k++) life.update(1 / 60);
  // the bateria: once they're on the street, legs stepping and sticks going
  life.trigger(4); for (let k = 0; k < 60 * 25; k++) life.update(1 / 60);
  for (const j of [0, 2, 5, 8]) {
    const B0 = F.cast.band.bones(j); if (B0[13] < -20) continue;
    const b = swings(() => F.cast.band.bones(j), 40, () => life.update(1 / 60));
    assert.ok(b.leg > 0.2, `drummer ${j} steps: ${b.leg.toFixed(2)}`); if (j) assert.ok(b.arm > 0.05, `drummer ${j} plays: ${b.arm.toFixed(2)}`);
  }
  for (const m of scene.meshes) assert.ok(!m.bones || finite(m.bones));
});

test('the kite fight reads from the plaza: close and low over the first rows, big kites on long strings, the cut one drifting across', () => {
  const { scene, town } = buildTown();
  const life = createParkLife({ ctx, particles: { burst() {}, emit() {} } }, scene, theme, new RNG(21), { town }), F = life.favela;
  for (let k = 0; k < 60 * 600 && life.eventCount; k++) life.update(1 / 60);
  life.trigger(3);
  const st = F.kiteFightState, path = [[], []];
  for (let k = 0; k < 60 * 30 && life.eventCount; k++) { life.update(1 / 60); if (k % 10 === 0) for (let i = 0; i < 2; i++) path[i].push({ t: st.t, cut: st.cut, p: st.kites[i].slice() }); }
  assert.equal(life.eventCount, 0, 'it ends');
  for (const q of [...path[0], ...path[1]].filter(q => !q.cut)) {
    assert.ok(q.p[2] < 75 && q.p[2] > 50, `over the first rows (z ${q.p[2].toFixed(1)})`);
    assert.ok(q.p[1] < 30 && q.p[1] > FV.groundY(q.p[0], q.p[2]) + 8, `low but over the roofs (y ${q.p[1].toFixed(1)})`);
    // from the plaza (the middle of the park, eye height) they're in a normal view: under ~25 degrees up
    assert.ok(Math.atan2(q.p[1] - 2, q.p[2]) < 25 * Math.PI / 180);
  }
  const drift = path.map(v => { const c = v.filter(q => q.cut); return c.length ? Math.abs(c[c.length - 1].p[0] - c[0].p[0]) : 0; });
  assert.ok(Math.max(...drift) > 30, `the cut kite drifts ${Math.max(...drift).toFixed(0)} m across the view`);
  assert.ok(Math.min(...drift) < 15, 'the winner stays put');
});

test('the ground between the houses: its own earth-and-concrete texture, paved round the park, asphalt streets with kerbs and gutters', () => {
  const g = T.favelaGround({ size: 64 });
  assert.ok(g.color && g.normal && g.normal.data.length === 64 * 64 * 4);
  const nz = new Set(); for (let i = 0; i < g.normal.data.length; i += 4) nz.add(g.normal.data[i]); assert.ok(nz.size > 4, 'bumpy');
  const scene = fakeScene(), ms = FV.favelaGround(ctx, scene, theme);
  assert.equal(ms.length, 5, 'the hillside, the park slab, the paint (kerbs and gutters), the paving, the streets');
  for (const m of ms) { assert.ok(finite(m.matrix)); assert.ok([...m.geo.position].every(Number.isFinite)); }
  // the kerbs never cross a street: no kerb box over the dirtbikes' loop
  const paint = ms[2], P = paint.geo.position;
  let onLoop = 0; for (let u = 0, L = FV.loopLength(0); u < L; u += 1) for (const lane of [-FV.ROAD.lane, FV.ROAD.lane]) { const [x, z] = FV.loopAt(u, lane); for (let i = 1; i < P.length; i += 3) if (P[i] > 0.1 && Math.abs(P[i - 1] - x) < 0.3 && Math.abs(P[i + 1] - z) < 0.3) { onLoop++; break; } }
  assert.equal(onLoop, 0, 'no kerb in the street');
});
