// v0.4.3 park life: background population plus random events, different for every park. Everything is
// procedural and original: people walking the sidewalks beyond the fences, traffic, boats, birds, trains, a
// helicopter with a searchlight, a container crane at work, sparks and steam. A scheduler fires a random
// event every ~15-35 s so the park never looks frozen.
import * as G from '../gfx/geometry.js';
import * as M from '../core/math.js';
import { Material, Mesh } from '../gfx/renderer.js';
import * as PR from './props.js';
import { audio } from '../core/audio.js';
import * as TX from '../gfx/textures.js';
import { AVE, EL_Z, STEAM_VENTS } from './street.js';

const lin = hex => M.hexLinear(hex);
const col = hex => [...lin(hex), 1];
const T = (x, y, z, yaw = 0) => M.m4fromYaw(M.m4(), x, y, z, yaw);
const wrapX = (x, a, b) => (x > b ? a + (x - b) : x < a ? b - (a - x) : x);

export function createParkLife(r, scene, theme, rng, opts = {}) {
  const ctx = r.ctx, night = !!theme.floodlights || theme.id === 'foundry';
  const vmat = new Material({ color: [1, 1, 1], roughness: 0.55, specular: 0.6 });
  const glow = new Material({ color: [1, 1, 1], shading: 'unlit', emissive: [3, 2.8, 2.4], fog: false });
  const red = new Material({ color: [1, 0.2, 0.15], shading: 'unlit', emissive: [3, 0.4, 0.3], fog: false });
  const dyn = [];
  const add = (geo, mat, o = {}) => { const m = new Mesh(geo, mat, { castShadow: false, reflect: false, ...o }); scene.add(m); dyn.push(m); return m; };
  // geometry is cached by key so repeat events reuse GPU buffers instead of leaking new ones
  const gcache = new Map();
  const geoOf = (parts, key) => {
    if (key && gcache.has(key)) return gcache.get(key);
    const g = ctx.geometry(G.merge(typeof parts === 'function' ? parts() : parts));
    if (key) gcache.set(key, g);
    return g;
  };

  // ---------- people on the sidewalks beyond the fences ----------
  const personGeo = ctx.geometry(PR.crowdPerson());
  const shirtMats = ['#e8e3d8', '#2a2c31', '#b8322f', '#2457c5', '#3a7a4a', '#f2c14e', '#8d6e9e', '#d9782f'].map(h => new Material({ color: lin(h), roughness: 0.85, shading: 'cloth', sheen: [0.08, 0.08, 0.08] }));
  const lanes = theme.style === 'coast'
    ? [{ z: 35.6, x0: -68, x1: 68 }, { z: -30.5, x0: -60, x1: 60 }, { z: 38.5, x0: -68, x1: 68 }]
    : theme.style === 'city' ? [{ z: -32.5, x0: -60, x1: 60 }, { z: 31, x0: -60, x1: 60 }, { z: -31, x0: -45, x1: 45 }]
      : [{ z: -35.5, x0: -70, x1: 70 }, { z: 33, x0: -70, x1: 70 }];
  const people = [];
  for (let i = 0; i < 22; i++) {
    const ln = lanes[i % lanes.length], jog = rng.next() < 0.18;
    const p = { ln, x: rng.range(ln.x0, ln.x1), dz: rng.range(-1, 1), dir: rng.next() < 0.5 ? 1 : -1, v: jog ? rng.range(2.6, 3.4) : rng.range(1.1, 1.6), jog, ph: rng.range(0, 6), stop: 0, s: rng.range(0.92, 1.08) };
    p.mesh = add(personGeo, shirtMats[i % shirtMats.length]);
    if (rng.next() < 0.15) p.dog = add(geoOf([{ geo: G.box(0.18, 0.2, 0.5), matrix: T(0, 0.3, 0), color: col(rng.pick(['#5a4030', '#d9c7a0', '#1d1d1d'])) }, { geo: G.box(0.14, 0.16, 0.18), matrix: T(0, 0.45, 0.3), color: col('#3a2a20') }, ...[[-0.06, 0.18], [0.06, 0.18], [-0.06, -0.18], [0.06, -0.18]].map(([x, z]) => ({ geo: G.box(0.05, 0.2, 0.05), matrix: T(x, 0.1, z), color: col('#2a2018') }))]), vmat);
    people.push(p);
  }
  const updPeople = dt => {
    for (const p of people) {
      if (p.stop > 0) { p.stop -= dt; } else {
        p.x += p.dir * p.v * dt;
        if (!p.jog && Math.abs(p.x) < 14 && rng.next() < dt * 0.04) p.stop = rng.range(3, 9); // stop and watch a game
      }
      if (p.x > p.ln.x1 || p.x < p.ln.x0) { p.dir = -p.dir; p.x = M.clamp(p.x, p.ln.x0, p.ln.x1); }
      p.ph += dt * (p.jog ? 9 : 6) * (p.stop > 0 ? 0 : 1);
      const bob = Math.abs(Math.sin(p.ph)) * (p.jog ? 0.07 : 0.03), z = p.ln.z + p.dz;
      const yaw = p.stop > 0 ? (p.ln.z > 0 ? Math.PI : 0) : (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      M.m4fromYaw(p.mesh.matrix, p.x, bob, z, yaw, p.s);
      if (p.jog) { p.mesh.matrix[8] += 0.06 * p.dir; } // lean into the run
      if (p.dog) M.m4fromYaw(p.dog.matrix, p.x + p.dir * 0.9, Math.abs(Math.sin(p.ph * 1.6)) * 0.03, z + 0.5, yaw);
    }
  };

  // ---------- ambient traffic / boats / machinery (always running) ----------
  const movers = [], updExtra = [];
  const carParts = (body, cabin) => [
    { geo: G.box(1.8, 0.62, 4.3), matrix: T(0, 0.62, 0), color: col(body) },
    { geo: G.box(1.62, 0.55, 2.3), matrix: T(0, 1.2, -0.2), color: col(cabin) },
    ...[[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]].map(([x, z]) => ({ geo: G.cylinder(0.33, 0.33, 0.22, 10), matrix: M.m4mul(M.m4(), T(x, 0.33, z), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, Math.PI / 2))), color: col('#111214') })),
  ];
  const lightsFor = () => [
    ...[-0.6, 0.6].map(x => ({ geo: G.box(0.3, 0.14, 0.04), matrix: T(x, 0.7, 2.16), color: [1, 1, 1, 1] })),
  ];
  const tailsFor = () => [-0.6, 0.6].map(x => ({ geo: G.box(0.3, 0.12, 0.04), matrix: T(x, 0.72, -2.16), color: [1, 1, 1, 1] }));
  // v0.4.8.5 Old Brick Yard: police cruisers (a generic black-and-white livery, POLICE on the doors) with light bars
  // that flash red and blue, throwing coloured light on the street round them; one parked at the kerb with its
  // lights going and an officer beside it; taxis and a bus in the traffic; steam from the manholes; a pursuit now
  // and then (parklife EVENTS.city). cops: every cruiser on the street, for the flash update.
  const cops = [];
  const lightsMat = new Material({ color: [2.6, 2.6, 2.6], shading: 'unlit', fog: false });
  let liveryMat = null, poolTex = null;
  const cruiserMeshes = (parked = false, own = true) => {
    if (!liveryMat) { liveryMat = new Material({ map: ctx.texture(TX.policeDoor(), {}), roughness: 0.38, specular: 0.9 }); poolTex = ctx.texture(TX.glowSpot(128, 1.4), { wrap: 'clamp' }); }
    const cr = PR.cruiser();
    const body = add(geoOf(() => PR.bake(cr.body), 'cruiser'), liveryMat), lights = add(geoOf(() => PR.carLights(), 'carlights'), lightsMat);
    const barMat = new Material({ color: [0.3, 0.1, 0.3], shading: 'unlit', fog: false });
    const bar = add(geoOf(cr.bar, 'cruiserbar'), barMat);
    const poolMat = new Material({ map: poolTex, color: [0, 0, 0], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
    const pool = add(geoOf(() => [{ geo: G.plane(15, 15), matrix: T(0, 0.03, 0) }], 'coppool'), poolMat);
    pool.order = 1;
    const cop = { barMat, poolMat, pool, on: parked || rng.next() < 0.5, t: rng.range(5, 25), ph: rng.range(0, 1), parked };
    if (own) cops.push(cop); // (a pursuit's cruisers flash from the event itself)
    return { meshes: [body, lights, bar, pool], cop };
  };
  // the light bar's pattern: red twice, blue twice, round again (~1.1 s)
  const flash = (cop, dt) => {
    if (!cop.parked && cop.t !== Infinity) { cop.t -= dt; if (cop.t <= 0) { cop.on = !cop.on; cop.t = cop.on ? rng.range(10, 30) : rng.range(15, 45); } }
    cop.ph = (cop.ph + dt / 1.1) % 1;
    const p = cop.ph, R = cop.on && (p < 0.09 || (p > 0.14 && p < 0.23)), B = cop.on && ((p > 0.5 && p < 0.59) || (p > 0.64 && p < 0.73));
    cop.barMat.color = cop.on ? [0.5 + (R ? 11 : 0), 0.25 + (R || B ? 1.2 : 0), 0.5 + (B ? 12 : 0)] : [0.25, 0.08, 0.3];
    cop.pool.visible = R || B;
    cop.poolMat.color = R ? [1.1, 0.06, 0.04] : [0.05, 0.2, 1.4];
  };
  if (theme.style === 'city') {
    // streets on the east and west edges, plus an elevated train line (viaduct) above the north street
    const roads = [{ x: -66, dir: 1 }, { x: -68.5, dir: -1 }, { x: 66, dir: -1 }, { x: 68.5, dir: 1 }];
    const paints = ['#c8322f', '#e8e3d8', '#1d2731', '#f2c14e', '#3b5873', '#6b6f75', '#2f6b54'];
    // v0.4.8.5: cars, three taxis, a bus and two cruisers (14 in all), spread out along the four lanes
    const kinds = ['car', 'car', 'taxi', 'cruiser', 'car', 'car', 'taxi', 'bus', 'car', 'car', 'taxi', 'cruiser', 'car', 'car'];
    kinds.forEach((kind, i) => {
      const rd = roads[i % roads.length], z = -80 + (Math.floor(i / 4) + rng.next() * 0.6) * 40, v = kind === 'bus' ? 7.5 : rng.range(8, 13);
      let meshes;
      if (kind === 'cruiser') meshes = cruiserMeshes().meshes;
      else if (kind === 'bus') meshes = [add(geoOf(() => PR.bake(PR.bus()), 'bus'), vmat), add(geoOf(() => PR.busLights(), 'buslights'), lightsMat)];
      else {
        const paint = kind === 'taxi' ? '#f2b81c' : rng.pick(paints);
        meshes = [add(geoOf(() => PR.bake(PR.car(paint, { taxi: kind === 'taxi' })), 'car' + kind + paint), vmat), add(geoOf(() => PR.carLights(4.4, { taxi: kind === 'taxi' }), 'carlights' + kind), lightsMat)];
      }
      movers.push({ meshes, x: rd.x, z, dir: rd.dir, v, axis: 'z' });
    });
    // the parked cruiser: at the east avenue's kerb by Brick Row, lights going, an officer on the sidewalk
    const pc = cruiserMeshes(true);
    for (const m of pc.meshes) M.m4fromYaw(m.matrix, AVE.park + 1.35, 0, 21.5, 0);
    const officer = add(personGeo, new Material({ color: lin('#1c2a44'), roughness: 0.8, shading: 'cloth', sheen: [0.05, 0.05, 0.08] }));
    M.m4fromYaw(officer.matrix, AVE.x1 + 1.2, 0.15, 22.8, -Math.PI / 2 + 0.4, 1.04);
    const via = [];
    for (let x = -120; x <= 120; x += 12) via.push({ geo: G.box(1.2, 8.4, 1.2), matrix: T(x, 4.2, EL_Z), color: col('#2b2d31') });
    via.push({ geo: G.box(260, 0.9, 4.2), matrix: T(0, 8.85, EL_Z), color: col('#34373c') });
    add(geoOf(via), vmat, { castShadow: true });
    // steam from the manholes: soft puffs that rise, spread and drift
    let steamAcc = 0;
    updExtra.push(dt => {
      for (const cop of cops) flash(cop, dt);
      steamAcc += dt;
      if (steamAcc < 0.12) return;
      steamAcc = 0;
      for (const [x, z] of STEAM_VENTS) r.particles.emit({ x: x + rng.range(-0.25, 0.25), y: 0.1, z: z + rng.range(-0.25, 0.25), vx: 0.45 + rng.range(-0.2, 0.2), vy: rng.range(1.4, 2.1), vz: rng.range(-0.2, 0.2), life: rng.range(4, 6), size: rng.range(0.32, 0.48), color: [0.05, 0.05, 0.056], gravity: 0.05, drag: 0.22, grow: 3.6, fade: 1 });
    });
  } else if (theme.style === 'coast') {
    // v0.4.5: proper sailboats — a tapered hull with a keel line and a cabin, a boom, and two curved sails
    // (main and jib) built from lofted rings rather than flat boxes.
    for (let i = 0; i < 4; i++) {
      const hull = col(rng.pick(['#f4f2ec', '#1d3b5a', '#b8322f'])), sail = col('#f8f4ea'), sail2 = col('#efe7d6');
      // a sail: vertical panels of falling height, bellied out to one side, so it reads as cloth under wind
      const sailParts = (h, foot, bow, lean, c) => {
        const out = [], n = 7;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;                      // 0 at the mast, 1 at the leech
          const belly = Math.sin(Math.PI * t) * foot * 0.26;
          const ph = h * (1 - t * 0.92), zc = bow - foot * t * 0.5 - lean * 0.5;
          out.push({ geo: G.box(0.05, ph, foot / n * 1.06), matrix: T(belly, 0.62 + ph / 2, zc - foot * t * 0.5), color: c });
        }
        return out;
      };
      const parts = [
        { geo: G.box(1.5, 0.52, 5.6), matrix: T(0, 0.3, 0), color: hull },
        { geo: G.box(1.15, 0.3, 4.6), matrix: T(0, 0.62, -0.1), color: col('#e8e2d2') },     // deck
        { geo: G.box(1.0, 0.42, 1.5), matrix: T(0, 0.86, -1.1), color: col('#d8d2c4') },     // cabin
        { geo: G.box(0.2, 0.9, 2.6), matrix: T(0, -0.3, 0.2), color: col('#20242a') },        // keel
        { geo: G.cylinder(0.055, 0.075, 7.2, 7, { y0: true }), matrix: T(0, 0.7, 0.4), color: col('#d0ccc4') },
        { geo: G.cylinder(0.04, 0.04, 2.6, 6, { y0: true }), matrix: M.m4mul(M.m4(), T(0, 1.15, 0.4), M.m4fromYaw(M.m4(), 0, 0, 0, 0)), color: col('#c6c2ba') },
      ];
      parts.push(...sailParts(5.2, 2.4, 0.2, 0.3, sail), ...sailParts(3.0, 1.4, 1.4, -0.4, sail2));
      movers.push({ meshes: [add(geoOf(parts, 'boat' + i), vmat)], x: rng.range(-150, 150), z: rng.range(70, 140), y: -0.55, dir: rng.next() < 0.5 ? 1 : -1, v: rng.range(1.2, 2.4), boat: true, ph: rng.range(0, 6) });
    }
  } else if (theme.style === 'tut') {
    // v0.4.5 King Tut Cup: glowing lanterns drifting high over the dunes
    const lantern = new Material({ color: [1, 1, 1], shading: 'unlit', emissive: [0, 0, 0], fog: false });
    for (let i = 0; i < 9; i++) {
      const hue = rng.pick(['#39ff88', '#b14dff', '#e8c15a', '#2fd3ff']);
      const m = add(geoOf([{ geo: G.cylinder(0.35, 0.5, 0.9, 8, { y0: true }), matrix: T(0, 0, 0), color: [...lin(hue).map(v => v * 2.4), 1] }], 'lantern' + hue), lantern);
      movers.push({ meshes: [m], x: rng.range(-110, 110), z: rng.range(-70, 80), y: rng.range(14, 30), dir: rng.next() < 0.5 ? 1 : -1, v: rng.range(0.6, 1.4), boat: true, ph: rng.range(0, 6) });
    }
  } else if (theme.style === 'jungle') {
    // v0.4.7.5 qp3 The Jungle Ballers: animals roaming the forest floor round the park. Each one is a body mesh and
    // two leg meshes (opposite pairs) that swing as it walks; they wander a ring of waypoints outside the fences,
    // stopping now and then. A sloth hangs from a liana by the east annex and barely moves.
    const skin = new Material({ color: [1, 1, 1], roughness: 0.85, shading: 'cloth', sheen: [0.06, 0.05, 0.04] });
    const Q = (yaw, swing) => M.qmul(M.q4(), M.qaxis(M.q4(), 0, 1, 0, yaw), M.qaxis(M.q4(), 1, 0, 0, swing));
    // waypoints: a ring just outside the fences, jittered; the waterfall pool (north middle) is skipped
    const ring = [];
    for (let i = 0; i < 10; i++) ring.push([-76 + i * 17, -44 + rng.range(-3, 3)]);
    for (let i = 1; i < 5; i++) ring.push([78 + rng.range(-3, 3), -44 + i * 17.6]);
    for (let i = 0; i < 10; i++) { const x = 76 - i * 17; ring.push([x, (Math.abs(x) < 22 ? 40 : 44) + rng.range(-2, 2)]); }
    for (let i = 1; i < 5; i++) ring.push([-78 + rng.range(-3, 3), 44 - i * 17.6]);
    const creature = (spec, k = 1) => {
      const body = add(geoOf(() => spec.body.map(q => ({ ...q, matrix: M.m4mul(M.m4(), M.m4compose(M.m4(), [0, 0, 0], M.q4(), [k, k, k]), q.matrix || M.m4()) })), 'cr-' + spec.key + k), skin);
      const legGeo = (dz, s2) => geoOf(() => spec.legs.map(([x, z]) => ({ geo: G.box(spec.legW * k, spec.legH * k, spec.legW * k), matrix: T(x * k * s2, -spec.legH * k / 2, (z + dz) * k), color: col(spec.legColor) })), 'legs-' + spec.key + k + dz + s2);
      // pair A: front-left + back-right; pair B: front-right + back-left (they swing opposite ways)
      const legsA = add(legGeo(0, 1), skin), legsB = add(legGeo(0, -1), skin);
      return { body, legsA, legsB, hip: spec.hip * k, k, speed: spec.speed, bob: spec.bob ?? 0.03, stride: spec.stride ?? 7, swing: spec.swing ?? 0.55, i: rng.int(0, ring.length - 1), dir: rng.next() < 0.5 ? 1 : -1, x: 0, z: 0, yaw: 0, ph: rng.range(0, 6), pause: rng.range(0, 4), t: 0 };
    };
    const JAGUAR = { key: 'jaguar', speed: 1.5, hip: 0.72, legW: 0.11, legH: 0.7, legColor: '#c9962f', stride: 8, swing: 0.6,
      body: [{ geo: G.box(0.46, 0.42, 1.5), matrix: T(0, 0.9, 0), color: col('#d2a23a') }, { geo: G.box(0.34, 0.3, 0.5), matrix: T(0, 1.1, 0.9), color: col('#d2a23a') }, { geo: G.box(0.3, 0.2, 0.26), matrix: T(0, 1.02, 1.18), color: col('#e8d8b0') },
        ...[-0.11, 0.11].map(x => ({ geo: G.box(0.08, 0.08, 0.06), matrix: T(x, 1.26, 1.08), color: col('#2a2018') })),
        ...Array.from({ length: 14 }, (_, i) => ({ geo: G.box(0.07, 0.07, 0.07), matrix: T((i % 2 ? 0.2 : -0.2) + rng.range(-0.05, 0.05), 0.85 + rng.range(0, 0.25), -0.6 + i * 0.1), color: col('#3a2a14') })),
        { geo: G.tube([[0, 0.95, -0.75], [0, 1.0, -1.2], [0.1, 0.8, -1.55]], 0.04, 4), color: col('#c9962f') }],
      legs: [[-0.16, 0.55], [0.16, -0.55]] };
    const CAPY = { key: 'capy', speed: 0.6, hip: 0.42, legW: 0.1, legH: 0.4, legColor: '#5a4330', stride: 6, swing: 0.4,
      body: [{ geo: G.box(0.5, 0.48, 1.0), matrix: T(0, 0.65, 0), color: col('#7a5a3c') }, { geo: G.box(0.34, 0.34, 0.5), matrix: T(0, 0.7, 0.62), color: col('#7a5a3c') }, ...[-0.1, 0.1].map(x => ({ geo: G.box(0.06, 0.1, 0.04), matrix: T(x, 0.92, 0.5), color: col('#5a4330') })), { geo: G.box(0.2, 0.14, 0.12), matrix: T(0, 0.6, 0.9), color: col('#4a3324') }],
      legs: [[-0.18, 0.35], [0.18, -0.35]] };
    const TAPIR = { key: 'tapir', speed: 0.85, hip: 0.68, legW: 0.13, legH: 0.66, legColor: '#2a2624', stride: 6, swing: 0.45,
      body: [{ geo: G.box(0.66, 0.6, 1.5), matrix: T(0, 0.98, 0), color: col('#2e2a28') }, { geo: G.box(0.64, 0.5, 0.9), matrix: T(0, 1.06, -0.2), color: col('#d8d2c8') }, { geo: G.box(0.4, 0.4, 0.6), matrix: T(0, 1.05, 0.95), color: col('#2e2a28') }, { geo: G.tube([[0, 1.0, 1.25], [0, 0.9, 1.5], [0, 0.72, 1.6]], 0.08, 5), color: col('#2e2a28') }, ...[-0.14, 0.14].map(x => ({ geo: G.box(0.08, 0.14, 0.05), matrix: T(x, 1.32, 0.85), color: col('#2e2a28') }))],
      legs: [[-0.22, 0.55], [0.22, -0.55]] };
    const MONKEY = { key: 'monkey', speed: 1.3, hip: 0.4, legW: 0.07, legH: 0.38, legColor: '#4a3a2a', stride: 10, swing: 0.7, bob: 0.08,
      body: [{ geo: G.box(0.26, 0.3, 0.5), matrix: T(0, 0.55, 0), color: col('#5a4632') }, { geo: G.sphere(0.13, 7, 6), matrix: T(0, 0.72, 0.3), color: col('#5a4632') }, { geo: G.box(0.16, 0.12, 0.08), matrix: T(0, 0.69, 0.42), color: col('#d8c8a8') }, { geo: G.tube([[0, 0.6, -0.25], [0, 0.95, -0.5], [0.1, 1.15, -0.3]], 0.025, 4), color: col('#5a4632') }],
      legs: [[-0.1, 0.18], [0.1, -0.18]] };
    const animals = [creature(JAGUAR), creature(TAPIR), creature(MONKEY), creature(MONKEY, 0.9), creature(MONKEY, 1.1)];
    const herd = [creature(CAPY), creature(CAPY, 0.85), creature(CAPY, 0.7)];
    herd[1].follow = herd[0]; herd[2].follow = herd[0]; herd[1].off = [1.4, -0.6]; herd[2].off = [-1.2, -1.1];
    animals.push(...herd);
    for (const a of animals) { const w = ring[a.i]; a.x = w[0]; a.z = w[1]; }
    // the sloth: hanging under a liana by the east annex, turning its head now and then
    const slothY = 6.2;
    const sloth = add(geoOf(() => [{ geo: G.box(0.34, 0.3, 0.7), matrix: T(0, -0.3, 0), color: col('#6a6048') }, { geo: G.sphere(0.16, 7, 6), matrix: T(0, -0.2, 0.42), color: col('#7a7058') }, { geo: G.box(0.1, 0.05, 0.03), matrix: T(0, -0.22, 0.58), color: col('#2a2018') },
      ...[[-0.14, 0.25], [0.14, 0.25], [-0.14, -0.25], [0.14, -0.25]].map(([x, z]) => ({ geo: G.box(0.06, 0.5, 0.06), matrix: T(x, 0.1, z), color: col('#5a5040') })),
      { geo: G.tube([[0, 0.3, -0.6], [0, 6, -0.6]], 0.05, 4), color: col('#56662a') }, { geo: G.tube([[0, 0.3, 0.6], [0, 6, 0.6]], 0.05, 4), color: col('#56662a') }], 'sloth'), skin);
    movers.push({ meshes: [sloth], x: 70, z: 18, y: slothY, dir: 1, v: 0, boat: true, ph: 0, sloth: true });
    const updAnimals = dt => {
      for (const a of animals) {
        a.t += dt;
        if (a.follow) {
          // a follower keeps its place beside the leader
          const L = a.follow, tx = L.x + Math.cos(L.yaw) * a.off[0] - Math.sin(L.yaw) * a.off[1], tz = L.z - Math.sin(L.yaw) * a.off[0] - Math.cos(L.yaw) * a.off[1];
          const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
          const moving = d > 0.3;
          if (moving) { const v = Math.min(a.speed * 1.3, d) * dt; a.x += dx / d * v; a.z += dz / d * v; a.yaw = Math.atan2(dx, dz); }
          a.ph += dt * (moving ? a.stride : 0);
        } else if (a.pause > 0) { a.pause -= dt; }
        else {
          const w = ring[a.i], dx = w[0] - a.x, dz = w[1] - a.z, d = Math.hypot(dx, dz);
          if (d < 0.5) { a.i = (a.i + a.dir + ring.length) % ring.length; if (rng.next() < 0.35) a.pause = rng.range(2, 8); if (rng.next() < 0.1) a.dir = -a.dir; }
          else { a.x += dx / d * a.speed * dt; a.z += dz / d * a.speed * dt; let want = Math.atan2(dx, dz), dd = want - a.yaw; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2; a.yaw += dd * Math.min(1, dt * 4); }
          a.ph += dt * a.stride;
        }
        const walking = a.follow ? true : a.pause <= 0;
        const sw = walking ? Math.sin(a.ph) * a.swing : 0, bob = walking ? Math.abs(Math.sin(a.ph)) * a.bob : 0;
        M.m4fromYaw(a.body.matrix, a.x, bob, a.z, a.yaw, a.k);
        M.m4compose(a.legsA.matrix, [a.x, a.hip + bob, a.z], Q(a.yaw, sw), [1, 1, 1]);
        M.m4compose(a.legsB.matrix, [a.x, a.hip + bob, a.z], Q(a.yaw, -sw), [1, 1, 1]);
      }
    };
    updExtra.push(updAnimals);
  } else {
    // industrial: a forklift shuttling along the container yard, and the crane trolley working
    const fork = add(geoOf([
      { geo: G.box(1.3, 1.1, 2.2), matrix: T(0, 0.75, 0), color: col('#e0a21c') }, { geo: G.box(1.2, 1.2, 0.08), matrix: T(0, 1.8, -0.3), color: col('#2a2c30') },
      { geo: G.box(0.1, 2.4, 0.1), matrix: T(-0.5, 1.4, 1.15), color: col('#2a2c30') }, { geo: G.box(0.1, 2.4, 0.1), matrix: T(0.5, 1.4, 1.15), color: col('#2a2c30') },
      { geo: G.box(6, 2.6, 2.45), matrix: T(0, 1.6, 4.4), color: col(rng.pick(['#b5482f', '#2f6b8a', '#4d6b3a'])) },
    ]), vmat);
    movers.push({ meshes: [fork], x: -10, z: -37.8, dir: 1, v: 3.2, x0: -20, x1: 40, shuttle: true });
    // rails for the freight line behind the north buildings
    add(geoOf([{ geo: G.box(260, 0.15, 0.12), matrix: T(0, 0.1, 61.3), color: col('#5a5550') }, { geo: G.box(260, 0.15, 0.12), matrix: T(0, 0.1, 62.7), color: col('#5a5550') }, { geo: G.box(260, 0.08, 3.2), matrix: T(0, 0.02, 62), color: col('#3a3430') }]), vmat);
  }
  // crane trolley + hanging container (industrial)
  let crane = null;
  if (theme.style === 'industrial') {
    const trolley = add(geoOf([{ geo: G.box(2.4, 1.2, 1.8), matrix: T(0, 0, 0), color: col('#c8962f') }]), vmat);
    const cable = add(geoOf([{ geo: G.box(0.06, 1, 0.06), matrix: T(0, -0.5, 0), color: col('#202226') }]), vmat);
    const box = add(geoOf([{ geo: G.box(6, 2.6, 2.45), matrix: T(0, 0, 0), color: col('#2f6b8a') }]), vmat);
    crane = { trolley, cable, box, t: 0 };
  }
  const updMovers = dt => {
    for (const m of movers) {
      m.x += m.dir * m.v * dt;
      if (m.axis === 'z') { m.x -= m.dir * m.v * dt; m.z += m.dir * m.v * dt; m.z = wrapX(m.z, -80, 80); }
      else if (m.shuttle) { if (m.x > m.x1 || m.x < m.x0) m.dir = -m.dir; }
      else m.x = wrapX(m.x, -110, 110);
      const yaw = m.axis === 'z' ? (m.dir > 0 ? 0 : Math.PI) : m.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (m.sloth) { m.ph += dt * 0.25; M.m4fromYaw(m.meshes[0].matrix, m.x, m.y + Math.sin(m.ph) * 0.05, m.z, Math.PI / 2 + Math.sin(m.ph * 0.7) * 0.25); continue; }
      const y = m.boat ? m.y + Math.sin((m.ph += dt * 1.3)) * 0.12 : 0;
      for (const mesh of m.meshes) M.m4fromYaw(mesh.matrix, m.x, y, m.z, yaw);
      if (m.boat) { const roll = Math.sin(m.ph * 0.8) * 0.04; for (const mesh of m.meshes) mesh.matrix[1] = roll; }
    }
    if (crane) {
      crane.t += dt;
      // the trolley runs along the jib (x 34..68 at 33 m), lowers, lifts and swings a container
      const cyc = (crane.t % 40) / 40, along = 34 + 32 * (0.5 - 0.5 * Math.cos(cyc * Math.PI * 2));
      const drop = 8 + 14 * Math.max(0, Math.sin(cyc * Math.PI * 4)) ** 2, sway = Math.sin(crane.t * 0.9) * 0.4;
      M.m4fromYaw(crane.trolley.matrix, along, 32.1, 40, 0);
      const cm = crane.cable.matrix; M.m4fromYaw(cm, along, 31.5, 40, 0); cm[5] = drop;
      M.m4fromYaw(crane.box.matrix, along + sway, 31.5 - drop - 1.3, 40, Math.sin(crane.t * 0.3) * 0.15);
    }
  };

  // ---------- random events ----------
  const events = [];
  const birds = (kind) => {
    // a flock crosses the park, wheeling once over the courts
    const n = kind === 'toucan' ? 3 + rng.int(0, 3) : kind === 'macaw' ? 2 + rng.int(0, 3) : 9 + rng.int(0, 6), c = kind === 'gull' ? '#f4f2ec' : kind === 'crow' || kind === 'toucan' ? '#141416' : kind === 'macaw' ? '#d8302a' : '#7d8088';
    // v0.4.7.5 qp3: toucans (black, a cream bib, the big orange beak) and macaws (red, blue wings, a long tail)
    const geo = geoOf(() => [{ geo: G.box(kind === 'macaw' ? 0.7 : 0.5, 0.03, 0.14), matrix: T(0, 0, 0), color: col(kind === 'macaw' ? '#2457c5' : c) }, { geo: G.box(0.08, 0.08, kind === 'macaw' ? 0.34 : 0.3), matrix: T(0, 0, 0.02), color: col(c) },
      ...(kind === 'toucan' ? [{ geo: G.box(0.05, 0.05, 0.2), matrix: T(0, -0.01, 0.26), color: col('#ff8a1f') }, { geo: G.box(0.07, 0.04, 0.1), matrix: T(0, -0.05, 0.1), color: col('#fff3d0') }] : kind === 'macaw' ? [{ geo: G.box(0.04, 0.03, 0.3), matrix: T(0, 0, -0.3), color: col('#2457c5') }, { geo: G.box(0.05, 0.05, 0.08), matrix: T(0, 0, 0.22), color: col('#f4f2ec') }] : [])], 'bird' + kind);
    const flock = [], side = rng.next() < 0.5 ? -1 : 1, z0 = rng.range(-20, 20);
    for (let i = 0; i < n; i++) flock.push({ m: add(geo, vmat), o: [rng.range(-3, 3), rng.range(-1, 1.5), rng.range(-3, 3)], ph: rng.range(0, 6) });
    let t = 0; const dur = 16;
    return dt => {
      t += dt; const k = t / dur;
      const cx = side * (-90 + 180 * k), cy = 14 + Math.sin(k * Math.PI) * 6, cz = z0 + Math.sin(k * Math.PI * 2) * 18;
      const yaw = Math.atan2(side * 180, Math.cos(k * Math.PI * 2) * 18 * Math.PI * 2);
      for (const b of flock) {
        b.ph += dt * 14;
        M.m4fromYaw(b.m.matrix, cx + b.o[0], cy + b.o[1] + Math.sin(b.ph * 0.2) * 0.3, cz + b.o[2], yaw);
        b.m.matrix[1] = Math.sin(b.ph) * 0.45; // wing beat (tilts the span)
      }
      if (t >= dur) { for (const b of flock) b.m.visible = false; return false; }
      return true;
    };
  };
  const train = (kind) => {
    // a train rolls past behind the park: elevated commuter train (city) or freight (industrial)
    const cars = [], n = kind === 'freight' ? 10 : 6, len = kind === 'freight' ? 13 : 15, y = kind === 'freight' ? 0.3 : 9.3, z = kind === 'freight' ? 62 : EL_Z;
    const dir = rng.next() < 0.5 ? 1 : -1, v = kind === 'freight' ? 9 : 16;
    const carGeo = kind === 'freight'
      ? null : geoOf(() => [{ geo: G.box(3, 3.2, len - 0.6), matrix: T(0, 1.6, 0), color: col('#9aa3ad') }, { geo: G.box(3.05, 0.5, len - 0.4), matrix: T(0, 2.4, 0), color: col('#b8322f') }], 'elcar');
    const winGeo = kind === 'freight' ? null : geoOf(() => [-1, 1].map(s => ({ geo: G.box(0.04, 0.9, len - 2), matrix: T(s * 1.53, 2.0, 0), color: [1, 1, 1, 1] })), 'elwin');
    const FC = ['#b5482f', '#2f6b8a', '#c8962f', '#4d6b3a', '#7a7f85'];
    for (let i = 0; i < n; i++) {
      const fc = rng.pick(FC);
      const g = carGeo || geoOf(() => [{ geo: G.box(2.9, 2.7, len - 0.8), matrix: T(0, 1.75, 0), color: col(fc) }, { geo: G.box(2.6, 0.5, len - 0.4), matrix: T(0, 0.25, 0), color: col('#1d1f22') }], 'fcar' + fc);
      cars.push({ body: add(g, vmat), win: winGeo ? add(winGeo, glow) : null, off: -i * len });
    }
    let x = -dir * 140, rumble = 0;
    return dt => {
      x += dir * v * dt;
      for (const c of cars) { const cx = x - dir * -c.off; M.m4fromYaw(c.body.matrix, cx, y, z, Math.PI / 2); if (c.win) M.m4fromYaw(c.win.matrix, cx, y, z, Math.PI / 2); }
      if ((rumble -= dt) <= 0 && Math.abs(x) < 100) { rumble = 1.2; audio.rumble?.(0.18); }
      if (Math.abs(x) > 140 + n * len && Math.sign(x) === dir) { for (const c of cars) { c.body.visible = false; if (c.win) c.win.visible = false; } return false; }
      return true;
    };
  };
  const heli = () => {
    // a police-style helicopter crosses with a sweeping searchlight (a real light while it's over the park)
    const body = add(geoOf(() => [{ geo: G.box(1.4, 1.3, 3.6), matrix: T(0, 0, 0), color: col('#1d2026') }, { geo: G.box(0.3, 0.3, 3.4), matrix: T(0, 0.2, -3), color: col('#1d2026') }], 'heli'), vmat);
    const rotor = add(geoOf(() => [{ geo: G.box(8, 0.05, 0.25), matrix: T(0, 0.9, 0), color: col('#0e0f12') }], 'rotor'), vmat);
    const beacon = add(geoOf(() => [{ geo: G.box(0.2, 0.15, 0.2), matrix: T(0, -0.75, 0.9), color: [1, 1, 1, 1] }], 'beacon'), red);
    const light = { pos: [0, 30, 0], range: 60, color: [0.85, 0.9, 1], intensity: 0, dir: [0, -1, 0], cos: 0.93 };
    scene.lights.unshift(light);
    let t = 0; const dur = 26, dir = rng.next() < 0.5 ? 1 : -1, z0 = rng.range(-10, 10);
    return dt => {
      t += dt; const k = t / dur, x = dir * (-110 + 220 * k), y = 34, z = z0 + Math.sin(k * 5) * 6;
      const yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      M.m4fromYaw(body.matrix, x, y, z, yaw); M.m4fromYaw(rotor.matrix, x, y, z, t * 30); M.m4fromYaw(beacon.matrix, x, y, z, yaw);
      beacon.visible = (t * 2) % 1 < 0.35;
      const sx = Math.sin(t * 0.7) * 14, sz = Math.cos(t * 0.5) * 10;
      light.pos = [x, y - 1, z]; const d = M.v3norm([0, 0, 0], [sx - x * 0.15, -y, sz]); light.dir = d;
      light.intensity = Math.abs(x) < 80 ? 55 : 0;
      if ((t % 1.6) < dt) audio.rumble?.(0.06);
      if (t >= dur) { body.visible = rotor.visible = beacon.visible = false; const i = scene.lights.indexOf(light); if (i >= 0) scene.lights.splice(i, 1); return false; }
      return true;
    };
  };
  const speedboat = () => {
    const boat = add(geoOf(() => [{ geo: G.box(1.8, 0.8, 5), matrix: T(0, 0.4, 0), color: col('#f4f2ec') }, { geo: G.box(1.5, 0.5, 1.4), matrix: T(0, 1.0, -0.4), color: col('#1d3b5a') }], 'speedboat'), vmat);
    const dir = rng.next() < 0.5 ? 1 : -1, z = rng.range(55, 80); let x = -dir * 140, t = 0;
    return dt => {
      t += dt; x += dir * 22 * dt;
      M.m4fromYaw(boat.matrix, x, -0.45 + Math.sin(t * 6) * 0.08, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      if ((t * 20) % 1 < dt * 20) r.particles.burst(x - dir * 2.6, -0.3, z, 3, { color: [2.2, 2.3, 2.4], speed: 1.5, life: 1.6, size: 0.25, gravity: -1.5, drag: 0.6 });
      if (Math.abs(x) > 145) { boat.visible = false; return false; }
      return true;
    };
  };
  const sparks = () => {
    // welding sparks at the works across the yard
    const x = rng.range(-60, 40), z = -44 + rng.range(-2, 2); let t = 0;
    return dt => {
      t += dt;
      if (rng.next() < dt * 18) r.particles.burst(x, 3 + rng.range(0, 3), z, 8, { color: [6, 3.2, 0.9], speed: 3.5, life: 0.7, size: 0.05, gravity: -9 });
      return t < 9;
    };
  };
  const steam = () => {
    const x = rng.range(-50, 50), z = rng.pick([-50, 46]); let t = 0;
    return dt => {
      t += dt;
      if (rng.next() < dt * 10) r.particles.burst(x, 9, z, 4, { color: [0.9, 0.9, 0.92], speed: 0.6, up: 1.8, life: 3.5, size: 0.9, gravity: 0.4, drag: 0.3 });
      return t < 12;
    };
  };
  const fireworksOrLights = () => {
    // city: a block of windows flickers on in a wave across a building face
    let t = 0;
    return dt => {
      t += dt;
      if (rng.next() < dt * 3) r.particles.burst(rng.range(-60, 60), rng.range(12, 30), rng.pick([-52, 50]), 6, { color: [3.5, 3, 2], speed: 0.4, life: 1.2, size: 0.35, gravity: 0 });
      return t < 8;
    };
  };
  // v0.4.5 King Tut Cup events: laser beams sweeping the sky from the pyramid tops, and green/purple fireworks
  const laserShow = () => {
    const beamMat = new Material({ color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, emissive: [0, 0, 0] });
    const tops = [[-48, 36, 82], [8, 50, 104], [62, 28, 78]];
    const beams = tops.map(([x, y, z], i) => ({ x, y, z, m: add(geoOf(() => [{ geo: G.box(0.35, 0.35, 120), matrix: T(0, 0, 60), color: [...lin(i % 2 ? '#b14dff' : '#39ff88').map(v => v * 1.6), 1] }], 'beam' + (i % 2)), beamMat), ph: rng.range(0, 6) }));
    let t = 0;
    return dt => {
      t += dt;
      for (const b of beams) {
        const yaw = Math.PI + Math.sin(t * 0.7 + b.ph) * 0.9, pitch = 0.35 + 0.25 * Math.sin(t * 0.5 + b.ph * 2);
        const q = M.q4(); M.qaxis(q, 0, 1, 0, yaw); const q2 = M.qaxis(M.q4(), 1, 0, 0, -pitch);
        M.m4compose(b.m.matrix, [b.x, b.y, b.z], M.qmul(M.q4(), q, q2));
        b.m.visible = t < 13.5 || Math.sin(t * 20) > 0;
      }
      return t < 14;
    };
  };
  const glowFireworks = () => {
    let t = 0;
    return dt => {
      t += dt;
      if (rng.next() < dt * 2.2) r.particles.burst(rng.range(-70, 70), rng.range(26, 42), rng.range(40, 90), 26, { color: rng.next() < 0.5 ? [0.6, 4, 1.6] : [2.6, 0.9, 4], speed: 7, life: 1.4, size: 0.45, gravity: 2.2, drag: 0.6 });
      return t < 9;
    };
  };
  const plane = () => {
    const body = add(geoOf(() => [{ geo: G.box(1, 1, 7), matrix: T(0, 0, 0), color: col('#c9ced6') }, { geo: G.box(9, 0.15, 1.4), matrix: T(0, 0, 0.3), color: col('#c9ced6') }], 'plane'), vmat);
    const blink = add(geoOf(() => [{ geo: G.box(0.3, 0.3, 0.3), matrix: T(4.4, 0, 0.3), color: [1, 1, 1, 1] }, { geo: G.box(0.3, 0.3, 0.3), matrix: T(-4.4, 0, 0.3), color: [1, 1, 1, 1] }], 'blink'), red);
    const dir = rng.next() < 0.5 ? 1 : -1, z = rng.range(-60, 60); let t = 0;
    return dt => {
      t += dt; const x = dir * (-260 + 26 * t);
      M.m4fromYaw(body.matrix, x, 120, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2); blink.matrix.set(body.matrix);
      blink.visible = (t % 1.2) < 0.15;
      if (Math.abs(x) > 270) { body.visible = blink.visible = false; return false; }
      return true;
    };
  };
  // v0.4.7.5 qp3 The Jungle Ballers: mist rolling off the forest floor, fireflies in the trees, butterflies over the
  // ferns; the toucans and macaws fly low through the canopy (birds)
  const mist = () => {
    const x0 = rng.pick([-1, 1]) * rng.range(60, 80), z0 = rng.range(-40, 40); let t = 0;
    return dt => {
      t += dt;
      if (rng.next() < dt * 6) r.particles.burst(x0 + rng.range(-12, 12), 0.4, z0 + rng.range(-12, 12), 3, { color: [0.55, 0.62, 0.55], speed: 0.4, up: 0.3, life: 6, size: 2.2, gravity: 0.02, drag: 0.4 });
      return t < 14;
    };
  };
  const fireflies = () => {
    const x0 = rng.pick([-1, 1]) * rng.range(66, 90), z0 = rng.range(-44, 44); let t = 0;
    return dt => {
      t += dt;
      if (rng.next() < dt * 9) r.particles.burst(x0 + rng.range(-10, 10), rng.range(1, 6), z0 + rng.range(-10, 10), 1, { color: [2.2, 3.2, 0.8], speed: 0.5, up: 0.2, life: 2.4, size: 0.09, gravity: 0, drag: 0.8, flick: 1 });
      return t < 16;
    };
  };
  const butterflies = () => {
    const x0 = rng.range(-60, 60), z0 = rng.pick([-35, 33]); let t = 0;
    const hue = rng.pick([[2.6, 1.2, 0.3], [0.6, 1.4, 2.8], [2.8, 2.4, 0.5], [2.4, 0.6, 1.8]]);
    return dt => {
      t += dt;
      if (rng.next() < dt * 5) r.particles.burst(x0 + rng.range(-6, 6), rng.range(0.6, 2.4), z0 + rng.range(-2, 2), 1, { color: hue, speed: 0.6, up: 0.4, life: 3, size: 0.12, gravity: -0.1, drag: 0.5, flick: 1 });
      return t < 12;
    };
  };
  // v0.4.8.5: a pursuit down one of the avenues: a car flat out over the centre line, two cruisers on its tail with
  // their lights going (and the light washing red and blue over the street as they pass)
  const pursuit = () => {
    const s = rng.next() < 0.5 ? 1 : -1, dir = rng.next() < 0.5 ? 1 : -1, x = s * AVE.center, v = rng.range(22, 27);
    const runner = [add(geoOf(() => PR.bake(PR.car('#d8d4cc')), 'car-runner'), vmat), add(geoOf(() => PR.carLights(), 'carlights'), lightsMat)];
    const chase = [cruiserMeshes(false, false), cruiserMeshes(false, false)];
    for (const c of chase) { c.cop.on = true; c.cop.t = Infinity; }
    let z = -dir * 175, t = 0;
    const yaw = dir > 0 ? 0 : Math.PI;
    return dt => {
      t += dt; z += dir * v * dt;
      const weave = Math.sin(t * 2.3) * 0.45;
      for (const m of runner) M.m4fromYaw(m.matrix, x + weave, 0, z, yaw + Math.cos(t * 2.3) * 0.04);
      chase.forEach((c, i) => { const cz = z - dir * (15 + i * 12), cx = x + Math.sin(t * 2.3 - 0.9 - i) * 0.35; for (const m of c.meshes) M.m4fromYaw(m.matrix, cx, 0, cz, yaw); flash(c.cop, dt); });
      if ((t % 1.4) < dt && Math.abs(z) < 120) audio.rumble?.(0.05);
      return Math.abs(z - dir * 40) < 220;
    };
  };
  const EVENTS = {
    coast: [() => birds('gull'), () => birds('gull'), speedboat, speedboat, plane],
    jungle: [() => birds('toucan'), () => birds('toucan'), () => birds('macaw'), mist, fireflies, butterflies],
    city: [() => train('el'), heli, () => birds('pigeon'), fireworksOrLights, plane, pursuit, pursuit],
    industrial: [() => train('freight'), () => train('freight'), sparks, steam, () => birds('crow')],
    tut: [laserShow, laserShow, glowFireworks, () => birds('crow'), plane],
  }[theme.style] || [() => birds('pigeon')];
  let nextEvt = rng.range(6, 14);
  const start = make => {
    const before = dyn.length, fn = make();
    events.push({ fn, meshes: dyn.splice(before) });
  };

  return {
    update(dt) {
      dt = Math.min(dt, 0.1);
      updPeople(dt); updMovers(dt); for (const f of updExtra) f(dt);
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].fn(dt)) continue;
        for (const m of events[i].meshes) scene.remove(m); // geometry stays cached for the next time
        events.splice(i, 1);
      }
      if ((nextEvt -= dt) <= 0) {
        nextEvt = rng.range(15, 35);
        if (events.length < 2) start(rng.pick(EVENTS));
      }
    },
    trigger(i) { start(EVENTS[i % EVENTS.length]); },
    get eventCount() { return events.length; },
  };
}
