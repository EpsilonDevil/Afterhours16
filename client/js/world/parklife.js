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
import * as RT from './retro.js';
import * as HR from './horror.js';
import { favelaLife, favelaEvents } from './favela.js';
import * as SP from '../core/spooky.js';
import { worldNow, WORLD_CLOCK } from '../sim/world.js';
import { hashString } from '../core/rng.js';

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
      // (v0.4.8.5 quick patch: the Beat Goes On's sidewalks: the Strip's, the plaza front, and along the shops as far as
      // the disco's crowd; jit: how far off the line they wander, y: the pavement's height)
      : theme.style === 'retro' ? [{ z: 34.4, x0: -62, x1: 62, jit: 0.4, y: 0.1 }, { z: -35.0, x0: -62, x1: 62, jit: 0.25, y: 0.02 }, { z: -37.4, x0: -60, x1: 12, jit: 0.3, y: 0.02 }]
        // (v0.4.8.5 quick patch 2: the Monster Mash's sidewalks, fewer people out: the monsters fill the rest)
        : theme.style === 'horror' ? [{ z: 34.5, x0: -62, x1: 62, jit: 0.4 }, { z: -35.6, x0: -60, x1: 60, jit: 0.3 }]
          // (v0.4.8.7: the Favelas' park-side sidewalks; favelaLife fills the stairways and the far sidewalks)
          : theme.style === 'favela' ? [{ z: 34.6, x0: -62, x1: 62, jit: 0.4 }, { z: -35.8, x0: -60, x1: 60, jit: 0.3 }]
            : [{ z: -35.5, x0: -70, x1: 70 }, { z: 33, x0: -70, x1: 70 }];
  const people = [];
  for (let i = 0; i < (theme.style === 'horror' ? 12 : theme.style === 'favela' ? 10 : 22); i++) {
    const ln = lanes[i % lanes.length], jog = rng.next() < 0.18;
    const p = { ln, x: rng.range(ln.x0, ln.x1), dz: rng.range(-1, 1) * (ln.jit ?? 1), dir: rng.next() < 0.5 ? 1 : -1, v: jog ? rng.range(2.6, 3.4) : rng.range(1.1, 1.6), jog, ph: rng.range(0, 6), stop: 0, s: rng.range(0.92, 1.08) };
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
      M.m4fromYaw(p.mesh.matrix, p.x, bob + (p.ln.y || 0), z, yaw, p.s);
      if (p.jog) { p.mesh.matrix[8] += 0.06 * p.dir; } // lean into the run
      if (p.dog) M.m4fromYaw(p.dog.matrix, p.x + p.dir * 0.9, Math.abs(Math.sin(p.ph * 1.6)) * 0.03, z + 0.5, yaw);
    }
  };

  // ---------- ambient traffic / boats / machinery (always running) ----------
  const movers = [], updExtra = [];
  let retro = null, lifeT = 0; // (v0.4.8.5 quick patch: the Beat Goes On's park life, and a clock for it)
  let horror = null; // (v0.4.8.5 quick patch 2: the Monster Mash's monsters)
  let favela = null; // (v0.4.8.7: the Favelas' people, animals and riders)
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
  } else if (theme.style === 'retro') {
    // v0.4.8.5 quick patch: And The Beat Goes On: lowriders, dancers, skaters (retroLife, below)
    retro = retroLife({ r, ctx, rng, add, geoOf, updExtra, city: opts.city, t: () => lifeT });
  } else if (theme.style === 'horror') {
    // v0.4.8.5 quick patch 2: The Monster Mash: monsters on the loose (horrorLife, below)
    horror = horrorLife({ r, ctx, rng, add, geoOf, updExtra, scene, town: opts.town, t: () => lifeT });
  } else if (theme.style === 'favela') {
    // v0.4.8.7 The Favelas: people on the stairs, animals, dirtbikes (favela.js favelaLife)
    favela = favelaLife({ r, ctx, rng, add, geoOf, updExtra, scene, town: opts.town, t: () => lifeT });
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
    retro: retro ? retroEvents({ r, rng, add, geoOf, scene, city: opts.city, vmat }, retro) : null,
    horror: horror ? horrorEvents({ r, ctx, rng, add, geoOf, scene, town: opts.town, vmat, theme }, horror) : null,
    favela: favela ? favelaEvents({ r, ctx, rng, add, geoOf, scene, town: opts.town, vmat, theme }, favela) : null, // (v0.4.8.7)
  }[theme.style] || [() => birds('pigeon')];
  let nextEvt = rng.range(6, 14);
  const start = make => {
    const before = dyn.length, fn = make();
    events.push({ fn, meshes: dyn.splice(before) });
  };
  // v0.4.8.7: the park's events on the world's clock (sim/world.js worldNow, the online server's): every LIFE.slot ms one
  // may start (which one, and everything it picks as it starts, from the park and the slot: the life rng is set from them
  // for its start), so everybody at the same park sees the same one. Arriving, the ones under way are picked up where they
  // are by now
  let lifeSlot = null, lifeSynced = false;
  const LIFE = { slot: 20000, chance: 80, back: 4 };
  // (and the park's clock and its traffic, boats and crane put where the world's clock has them: the same on every screen.
  // Only the movers that run on their own rhythm can be; the people's stops and turns are each screen's own)
  const syncLife = () => {
    lifeSynced = true;
    const T = (worldNow() / 1000) % 86400, wrap = (v, a, b) => a + ((((v - a) % (b - a)) + (b - a)) % (b - a));
    lifeT = T;
    for (const m of movers) {
      if (m.axis === 'z') m.z = wrap(m.z + m.dir * m.v * (T % (160 / m.v)), -80, 80);
      else if (m.shuttle) { const span = m.x1 - m.x0, P = 2 * span / m.v; let d = ((m.x - m.x0) + (m.dir > 0 ? 0 : 2 * span - 2 * (m.x - m.x0)) + m.v * (T % P)) % (2 * span); m.dir = d < span ? 1 : -1; m.x = d < span ? m.x0 + d : m.x1 - (d - span); }
      else m.x = wrap(m.x + m.dir * m.v * (T % (220 / m.v)), -110, 110);
      if (m.ph != null) m.ph = (m.ph + T * (m.sloth ? 0.25 : 1.3)) % (Math.PI * 2 * 1000);
    }
    if (crane) crane.t = T;
  };
  const slotEvent = k => { const h = hashString(`${theme.id}|life|${k}`); return h % 100 < LIFE.chance ? (h >>> 8) % EVENTS.length : -1; };
  const startAt = (i, k) => { const s0 = rng.s; rng.s = (hashString(`${theme.id}|ev|${k}`) >>> 0) || 1; start(EVENTS[i]); rng.s = s0; };
  const lifeSlots = () => {
    const now = worldNow(), k = Math.floor(now / LIFE.slot);
    if (lifeSlot === k) return;
    for (let j = lifeSlot == null ? k - LIFE.back : k; j <= k; j++) {
      const i = slotEvent(j);
      if (i < 0 || events.length >= 2) continue;
      startAt(i, j);
      if (j === k) continue;
      const ev = events[events.length - 1];
      let on = true; for (let a = (now - j * LIFE.slot) / 1000; a > 0 && on; a -= 0.1) on = ev.fn(Math.min(0.1, a)); // (under way: caught up)
      if (!on) { for (const m of ev.meshes) scene.remove(m); events.pop(); }
    }
    lifeSlot = k;
  };

  return {
    update(dt) {
      dt = Math.min(dt, 0.1); lifeT += dt;
      if (WORLD_CLOCK.shared && !lifeSynced) syncLife();
      updPeople(dt); updMovers(dt); for (const f of updExtra) f(dt);
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].fn(dt)) continue;
        for (const m of events[i].meshes) scene.remove(m); // geometry stays cached for the next time
        events.splice(i, 1);
      }
      // (v0.4.8.7: on an online server's world, the park's events go by its clock, so friends at the same park see the
      // same ones at the same moment: lifeSlots)
      if (WORLD_CLOCK.shared) { lifeSlots(); return; }
      lifeSlot = null;
      if ((nextEvt -= dt) <= 0) {
        nextEvt = rng.range(15, 35);
        if (events.length < 2) start(rng.pick(EVENTS));
      }
    },
    trigger(i) { start(EVENTS[i % EVENTS.length]); },
    get eventCount() { return events.length; },
    get retro() { return retro; }, // (v0.4.8.5 quick patch: the Beat Goes On's cars and dancers, for the tests and the dev views)
    get horror() { return horror; }, // (v0.4.8.5 quick patch 2: the Monster Mash's monsters)
    get favela() { return favela; }, // (v0.4.8.7: the Favelas' life, for the tests and the dev views)
  };
}

// ---------------- v0.4.8.5 quick patch: And The Beat Goes On ----------------
// Lowriders cruising the Strip and the avenues (now and then one hits its switches: the front pumping, or up on three
// wheels), two in the lot by the disco hopping in place and one at the Strip's kerb bouncing its hood; b-boys taking
// turns on the cardboard by the plaza (toprock, six-step, headspins, windmills, a freeze), a boombox crew popping and
// locking, dancers spilling out of the disco's door, the line on the sidewalk with its bouncer, roller skaters circling
// the block. Every figure is one mesh: its pose is a geometry swapped on the beat (retro.js dancer()), its moves the
// mesh's matrix. env: the createParkLife closures. Returns what the retro events need.
function retroLife(env) {
  const { r, ctx, rng, add, geoOf, updExtra, city } = env;
  const BPM = city?.BPM || 118, clock = () => (city ? city.t : env.t()) * BPM / 60; // beats (shared with the disco floor)
  const lowMat = new Material({ color: [1, 1, 1], roughness: 0.2, metalness: 0.55, specular: 1.4 });
  const dmat = new Material({ color: [1, 1, 1], roughness: 0.7, shading: 'cloth', sheen: [0.08, 0.08, 0.08] });
  const { LOWRIDER: LW } = RT;
  // ---- lowriders ----
  // a car's pose: lift (m), pitch (front up, about the rear axle), roll (the left side up, about the long axis)
  const carM = (m, x, z, yaw, lift = 0, pitch = 0, roll = 0) => M.m4mul(m, M.m4fromYaw(M.m4(), x, lift, z, yaw), M.m4mul(M.m4(), M.m4mul(M.m4(), M.m4translation(M.m4(), 0, LW.axle, LW.rear), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, -pitch))), M.m4mul(M.m4(), M.m4translation(M.m4(), 0, -LW.axle, -LW.rear), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, roll)))));
  const lowrider = (paint, conv) => add(geoOf(() => RT.lowrider(paint, { convertible: conv, roof: conv ? null : rng.next() < 0.4 ? '#f4f1ea' : null }), 'lr' + paint + (conv ? 'c' : '')), lowMat);
  // a hop: the front leaps h metres and lands, a couple of smaller bounces after; returns [lift, pitch] at time t (s)
  const WB = LW.front - LW.rear;
  const hop = (t, h) => {
    const T = 0.45 + h * 0.35;
    const seg = [[0, T, h], [T, T * 0.55, h * 0.22], [T * 1.55, T * 0.35, h * 0.06]];
    for (const [t0, d, hh] of seg) if (t >= t0 && t < t0 + d) { const k = Math.sin((t - t0) / d * Math.PI), fh = hh * k; return [fh * 0.12, Math.atan2(fh, WB)]; }
    return [0, 0];
  };
  const cars = [];
  // cruisers: on the Strip's four lanes, the avenues, the street behind the shops
  const ln = [...RT.STRIP.lanes.map(l => ({ axis: 'x', c: l.z, dir: l.dir })), ...[-1, 1].flatMap(s => RT.AVE.lanes.map(l => ({ axis: 'z', c: s * l.x, dir: s * l.dir }))), ...RT.SOUTH.lanes.map(l => ({ axis: 'x', c: l.z, dir: l.dir }))];
  const spec = [[0, -60], [1, 40], [2, -20], [3, 70], [0, 120], [2, 100], [4, -40], [5, 60], [6, 10], [7, -90], [8, 30]];
  spec.forEach(([li, p], i) => {
    const L = ln[li], c = { mesh: lowrider(RT.CANDY[i % RT.CANDY.length], i % 3 === 1), L, p, v: rng.range(4.2, 6.5), mode: 'cruise', mt: rng.range(4, 14), t: 0, ph: rng.range(0, 6) };
    cars.push(c);
  });
  // parked: two in the lot between the pizza place and the disco (nose to the plaza), one at the Strip's north kerb
  const parked = [
    { mesh: lowrider('#ff3f9a', false), x: 5.2, z: -46.5, yaw: 0, kind: 'hopper', t: rng.range(0, 6) },
    { mesh: lowrider('#00a0a8', true), x: 10.4, z: -47, yaw: 0, kind: 'three', t: rng.range(0, 6) },
    { mesh: lowrider('#d4a017', false), x: -8, z: 55.0, yaw: Math.PI / 2, kind: 'bounce', t: 0 },
  ];
  const pose = c => {
    if (c.mode === 'bounce') return [0.02, 0.07 * Math.abs(Math.sin(c.t * 4.4)), 0];
    if (c.mode === 'three') { const k = Math.min(1, c.t * 1.5, (c.mt) * 1.5); return [0.05 * k, 0.06 * k, 0.15 * k]; }
    return [0, 0, 0];
  };
  updExtra.push(dt => {
    for (const c of cars) {
      c.t += dt; c.mt -= dt;
      if (c.mt <= 0) { if (c.mode === 'cruise') { c.mode = rng.pick(['bounce', 'bounce', 'three']); c.mt = rng.range(2.5, 4.5); } else { c.mode = 'cruise'; c.mt = rng.range(8, 20); } c.t = 0; }
      c.p += c.L.dir * c.v * dt; if (c.p > 185) c.p -= 370; if (c.p < -185) c.p += 370;
      const [lift, pitch, roll] = pose(c), x = c.L.axis === 'x' ? c.p : c.L.c, z = c.L.axis === 'x' ? c.L.c : c.p;
      const yaw = c.L.axis === 'x' ? (c.L.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.L.dir > 0 ? 0 : Math.PI);
      carM(c.mesh.matrix, x, z, yaw, lift, pitch, roll);
    }
    for (const c of parked) {
      c.t += dt;
      let lift = 0, pitch = 0, roll = 0;
      if (c.kind === 'hopper') { const cyc = c.t % 7.5, n = Math.floor(cyc / 1.6); if (n < 3) { const hh = [0.7, 1.0, 1.35][n], tt = cyc - n * 1.6; [lift, pitch] = hop(tt, hh); } }
      else if (c.kind === 'three') { const cyc = c.t % 9, k = M.smooth(cyc / 1.2) * (1 - M.smooth((cyc - 5) / 1.2)); lift = 0.06 * k; pitch = 0.05 * k; roll = 0.17 * k; }
      else { pitch = 0.075 * Math.abs(Math.sin(c.t * 4.6)); lift = 0.02; }
      // sparks off the back bumper when the hopper's nose comes down from a big one
      c.peak = Math.max(c.peak || 0, pitch);
      if (c.kind === 'hopper' && c.peak > 0.15 && pitch < 0.01) { r.particles.burst(c.x, 0.15, c.z + LW.rear - 0.7, 14, { color: [6, 3, 0.9], speed: 3, life: 0.5, size: 0.04, gravity: -9 }); c.peak = 0; }
      carM(c.mesh.matrix, c.x, c.z, c.yaw, lift, pitch, roll);
    }
  });

  // ---- people ----
  const OUT = RT.OUTFITS, P = RT.POSES;
  const outfit = (i, skates = false) => (skates ? { ...OUT[i % OUT.length], skates: true } : OUT[i % OUT.length]);
  const fig = (o, pose, key) => geoOf(() => RT.dancer(P[pose], o), 'dn' + key + pose);
  // a dancer: style picks its pose on each beat; its matrix does the rest (bob, sway, spins)
  const dancers = [];
  const person = (x, z, yaw, oi, style, o = {}) => {
    const of = outfit(oi, style === 'skate'), key = oi + (style === 'skate' ? 's' : '');
    const d = { x, z, yaw, of, key, style, mesh: add(fig(of, 'stand', key), dmat), ph: rng.range(0, 4) | 0, pose: 'stand', t: rng.range(0, 10), s: rng.range(0.95, 1.06), ...o };
    if (o.shadow) d.mesh.castShadow = true;
    dancers.push(d); return d;
  };
  const setPose = (d, pose) => { if (d.pose !== pose) { d.pose = pose; d.mesh.geo = fig(d.of, pose, d.key); } };
  const SEQ = {
    disco: ['point', 'point', 'point2', 'point2', 'roll', 'roll', 'vee', 'shift'], popper: ['wave', 'wave2', 'robot', 'robot2', 'wave', 'robot2', 'wave2', 'robot'],
    locker: ['lock', 'lock2', 'lock', 'point', 'lock2', 'lock', 'roll', 'lock2'], toprock: ['rock1', 'rock2'], runner: ['run1', 'run2'], clap: ['clap', 'stand'],
    boombox: ['boombox'], idle: ['stand', 'shift', 'pockets', 'cross', 'shift', 'stand'], cheer: ['cheer', 'clap', 'cheer', 'clap'],
  };
  // the b-boys round their cardboard: one in the middle at a time, the rest on the edge
  const BC = RT.SPOTS.breakers, breakers = [];
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4, x = BC.x + Math.sin(a) * 1.95, z = BC.z + Math.cos(a) * 1.95; breakers.push(person(x, z, Math.atan2(BC.x - x, BC.z - z), [0, 1, 4, 6][i], 'edge', { home: [x, z], shadow: true })); }
  for (let i = 0; i < 3; i++) { const a = 2.2 + i * 0.9, x = BC.x + Math.sin(a) * 2.9, z = BC.z + Math.cos(a) * 2.9; person(x, z, Math.atan2(BC.x - x, BC.z - z), [3, 7, 2][i], 'clap', { shadow: true }); }
  const brk = { turn: 0, t: 0, move: 'headspin', len: 10, battle: 0 };
  // the boombox crew by the east end of the plaza, facing the park
  const CR = RT.SPOTS.crew;
  person(CR.x - 1.3, CR.z + 0.6, 0.15, 4, 'popper', { shadow: true }); person(CR.x + 1.3, CR.z + 0.4, -0.2, 5, 'locker', { shadow: true });
  person(CR.x, CR.z + 1.6, 0, 2, 'popper', { ph: 2, shadow: true }); person(CR.x + 2.6, CR.z - 0.9, -0.7, 0, 'boombox', { shadow: true });
  // the dancers spilling out of the disco's door, and the runner
  const DR = RT.SPOTS.door;
  for (const [dx, dz, oi, st] of [[-0.9, 0.4, 2, 'disco'], [1.0, 1.0, 5, 'disco'], [-3.2, 1.6, 7, 'disco'], [3.2, 1.9, 3, 'runner'], [-1.8, 2.6, 1, 'locker']]) person(DR.x + dx, DR.z + dz, rng.range(-0.5, 0.5), oi, st);
  // roller skaters round the block: the Strip's sidewalk, the avenues', the plaza front
  const loop = [[-64.6, 34.3], [64.6, 34.3], [64.6, -34.5], [-64.6, -34.5]], segs = loop.map((p, i) => { const q = loop[(i + 1) % 4]; return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }; }), LOOP = segs.reduce((a, s) => a + s.len, 0);
  const along = s => { s = ((s % LOOP) + LOOP) % LOOP; for (const g of segs) { if (s <= g.len) { const k = s / g.len; return [g.p[0] + (g.q[0] - g.p[0]) * k, g.p[1] + (g.q[1] - g.p[1]) * k, Math.atan2(g.q[0] - g.p[0], g.q[1] - g.p[1])]; } s -= g.len; } return [loop[0][0], loop[0][1], 0]; };
  const skaters = [];
  for (let i = 0; i < 5; i++) skaters.push(person(0, 0, 0, i + 2, 'skate', { s0: i * LOOP / 5 + rng.range(-10, 10), v: rng.range(3.4, 5.2), dir: i % 2 ? -1 : 1 }));
  // the line at the door (one mesh: they wait), the bouncer, the rope; the cardboard and the crew's boombox
  {
    const parts = [], at = (o, pose, x, z, yaw) => { for (const q of RT.dancer(P[pose], OUT[o])) parts.push({ geo: q.geo, matrix: M.m4fromYaw(M.m4(), x, 0.02, z, yaw), color: q.color }); };
    const L = RT.SPOTS.line;
    ['pockets', 'cross', 'shift', 'stand', 'pockets', 'shift', 'cross'].forEach((pz, i) => at(i % OUT.length, pz, L.x0 + 0.6 + i * 0.92, L.z + rng.range(-0.15, 0.15), -Math.PI / 2 + rng.range(-0.5, 0.4)));
    for (const q of RT.dancer(P.cross, { skin: '#5d3a22', hair: '#0e0a08', style: 'flat', top: '#121216', bottom: '#121216', shoes: '#121216' })) parts.push({ geo: q.geo, matrix: M.m4mul(M.m4(), M.m4fromYaw(M.m4(), L.x0 - 1.1, 0.02, L.z - 0.1, 0.25), M.m4compose(M.m4(), [0, 0, 0], M.q4(), [1.15, 1.08, 1.2])), color: q.color });
    for (let i = 0; i < 6; i++) parts.push({ geo: G.cylinder(0.04, 0.05, 0.95, 8, { y0: true }), matrix: T(L.x0 + i * 1.25, 0.02, L.z + 0.8), color: col('#d8dde4') });
    for (let i = 0; i < 5; i++) { const x0 = L.x0 + i * 1.25, x1 = x0 + 1.25; parts.push({ geo: G.tube([[x0, 0.9, L.z + 0.8], [(x0 + x1) / 2, 0.72, L.z + 0.8], [x1, 0.9, L.z + 0.8]], 0.03, 5), color: col('#b0102a') }); }
    parts.push({ geo: G.box(2.3, 0.02, 2.3), matrix: T(BC.x, 0.01, BC.z, 0.3), color: col('#a8865a') }, { geo: G.box(1.2, 0.022, 1.0), matrix: T(BC.x + 0.4, 0.012, BC.z - 0.5, 0.9), color: col('#9a7a4e') });
    parts.push({ geo: G.box(0.7, 0.36, 0.2), matrix: T(CR.x + 0.2, 0.18, CR.z - 0.6, 0.2), color: col('#c9ced6') });
    for (const sx of [-0.2, 0.2]) parts.push({ geo: G.cylinder(0.12, 0.12, 0.03, 12), matrix: M.m4mul(M.m4(), T(CR.x + 0.2 + sx * Math.cos(0.2), 0.18, CR.z - 0.6 - sx * Math.sin(0.2) + 0.1, 0.2), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2))), color: col('#1d1f26') });
    const m = add(geoOf(() => PR.bake(parts), 'beatline'), dmat); m.castShadow = true;
  }
  // power moves: matrices that turn a standing-frame pose upside down or lay it on the floor
  const powerM = (d, move, t) => {
    const m = d.mesh.matrix;
    if (move === 'headspin') return M.m4mul(m, M.m4translation(M.m4(), d.x, 1.86, d.z), M.m4mul(M.m4(), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, Math.PI)), M.m4fromYaw(M.m4(), 0, 0, 0, t * 9)));
    if (move === 'windmill') return M.m4mul(m, M.m4fromYaw(M.m4(), d.x, 0.32, d.z, t * 2.6), M.m4mul(M.m4(), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, Math.PI / 2)), M.m4mul(M.m4(), M.m4fromYaw(M.m4(), 0, 0, 0, t * 7), M.m4translation(M.m4(), 0, -1.25, 0))));
    if (move === 'freeze') return M.m4mul(m, M.m4fromYaw(M.m4(), d.x, 0.28, d.z, d.yaw), M.m4mul(M.m4(), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, 2.3)), M.m4translation(M.m4(), 0, -1.5, 0)));
    return M.m4fromYaw(m, d.x, 0, d.z, d.yaw, d.s);
  };
  updExtra.push(dt => {
    const beat = clock(), bi = Math.floor(beat), bp = beat - bi, dip = Math.pow(1 - Math.abs(Math.cos(bp * Math.PI)), 2);
    // the breakers' turns: toprock, drop, six-step, the power move, a freeze, back to the edge
    brk.t += dt;
    if (brk.t > brk.len) { brk.t = 0; brk.turn = (brk.turn + 1) % breakers.length; brk.move = rng.pick(['headspin', 'windmill', 'windmill', 'headspin']); brk.len = brk.battle > 0 ? 8.5 : 10.5; }
    if (brk.battle > 0) brk.battle -= dt;
    breakers.forEach((d, i) => {
      if (i !== brk.turn) {
        d.x = d.home[0]; d.z = d.home[1]; d.yaw = Math.atan2(BC.x - d.x, BC.z - d.z);
        const st = brk.battle > 0 ? (i % 2 ? 'cheer' : 'toprock') : (i % 2 ? 'crouch' : 'toprock');
        setPose(d, st === 'crouch' ? 'crouch' : SEQ[st][(bi + i) % SEQ[st].length]);
        M.m4fromYaw(d.mesh.matrix, d.x, st === 'crouch' ? 0 : -0.03 * dip, d.z, d.yaw + (st === 'toprock' ? Math.sin(beat * Math.PI) * 0.25 : 0), d.s);
        return;
      }
      const t = brk.t, cx = BC.x, cz = BC.z;
      // walk in from the edge, and back out at the end
      const k = M.smooth(t / 1.0) * (1 - M.smooth((t - (brk.len - 1.0)) / 1.0));
      d.x = d.home[0] + (cx - d.home[0]) * k; d.z = d.home[1] + (cz - d.home[1]) * k;
      if (t < 2.4 || t > brk.len - 1.0) { setPose(d, t > brk.len - 1.0 ? 'glide' : SEQ.toprock[bi % 2]); M.m4fromYaw(d.mesh.matrix, d.x, -0.03 * dip, d.z, d.yaw + Math.sin(beat * Math.PI) * 0.35, d.s); }
      else if (t < 2.9) { setPose(d, 'crouch'); M.m4fromYaw(d.mesh.matrix, d.x, 0, d.z, d.yaw, d.s); }
      else if (t < 5.2) { setPose(d, Math.floor(beat * 2) % 2 ? 'six1' : 'six2'); M.m4mul(d.mesh.matrix, M.m4fromYaw(M.m4(), d.x, 0, d.z, d.yaw + (t - 2.9) * 2.6), M.m4translation(M.m4(), 0, 0, -0.45)); }
      else if (t < brk.len - 2.1) { setPose(d, brk.move); powerM(d, brk.move, t); }
      else { setPose(d, 'freeze'); powerM(d, 'freeze', t); }
    });
    // everyone else on the beat
    for (const d of dancers) {
      if (d.style === 'edge') continue;
      if (d.style === 'skate') {
        d.s0 += d.dir * d.v * dt; const [x, z, yaw] = along(d.s0), push = Math.sin(d.s0 * 0.9);
        d.x = x; d.z = z; d.yaw = M.dampAngle(d.yaw, d.dir > 0 ? yaw : yaw + Math.PI, 6, dt);
        setPose(d, push > 0.35 ? 'skate1' : push < -0.35 ? 'skate2' : 'glide');
        if (d.train != null) setPose(d, d.train === 0 ? (bi % 2 ? 'cheer' : 'glide') : 'train');
        const m = M.m4fromYaw(d.mesh.matrix, x, z > 0 || Math.abs(x) > 63.6 ? 0.1 : 0.02, z, d.yaw, d.s), lean = (d.train != null ? Math.sin(d.s0 * 0.5) : -push) * 0.12;
        m[4] += lean * Math.cos(d.yaw); m[6] -= lean * Math.sin(d.yaw); // (leaning into the push)
        continue;
      }
      const seq = SEQ[d.style] || SEQ.idle;
      setPose(d, seq[(bi + d.ph) % seq.length]);
      let y = -0.035 * dip, yaw = d.yaw, x = d.x;
      if (d.style === 'disco') { yaw += Math.sin(beat * Math.PI * 0.5 + d.ph) * 0.35; y += 0.02 * Math.sin(beat * Math.PI * 2); }
      else if (d.style === 'popper') { if (bp < 0.12) y += 0.03; yaw += (bi % 4 < 2 ? 0.25 : -0.25); }
      else if (d.style === 'locker') { yaw += Math.sin(beat * Math.PI * 0.25) * 0.5; }
      else if (d.style === 'runner') { x += Math.sin(beat * Math.PI * 0.25) * 0.3; y = -0.05 * dip; }
      else if (d.style === 'boombox') { y = -0.02 * dip; }
      M.m4fromYaw(d.mesh.matrix, x, y, d.z, yaw, d.s);
    }
  });
  const drop = list => { for (const d of list) { const i = dancers.indexOf(d); if (i >= 0) dancers.splice(i, 1); } };
  return { cars, parked, breakers, brk, lowrider, carM, hop, person, dancers, drop, setPose, fig, outfit, along, LOOP, clock, SEQ, dmat, lowMat };
}

// the Beat Goes On's random events: a lowrider hop-off on the Strip, a breakdance battle, a roller-skate train round the
// block, a neon blackout, a plane towing the event's banner, a blimp with a message board, the disco's light show,
// fireworks over the Strip, and a lowrider parade
function retroEvents(env, R) {
  const { r, rng, add, geoOf, city, vmat } = env;
  const DEG = Math.PI / 180;
  // the hop-off: two roll up nose to nose on the Strip's near side, a crowd gathers, they take turns hopping higher each
  // time (sparks off the back bumpers when the front comes down), and the winner rolls off up on three wheels
  const hopOff = () => {
    const z = 40.6, A = { mesh: R.lowrider(rng.pick(RT.CANDY), false), x0: 140, stop: 15, dir: -1 }, B = { mesh: R.lowrider(rng.pick(RT.CANDY), true), x0: -140, stop: -1, dir: 1 };
    const crowd = [];
    for (let i = 0; i < 11; i++) { const x = rng.range(-4, 17), zz = rng.next() < 0.65 ? rng.range(34.8, 36.6) : rng.range(45.2, 45.9); crowd.push(R.person(x, zz, Math.atan2(7 - x, z - zz), rng.int(0, 7), i % 3 ? 'cheer' : 'clap', { ph: rng.int(0, 3) })); }
    const order = [B, A, B, A, B, A], H = [0.55, 0.8, 1.05, 1.35, 1.6, 1.95];
    let t = 0;
    return dt => {
      t += dt;
      for (const c of [A, B]) {
        let lift = 0, pitch = 0, roll = 0, x;
        if (t < 7) x = c.x0 + (c.stop - c.x0) * (1 - (1 - t / 7) ** 3);
        else if (t < 25) {
          x = c.stop; const i = Math.floor((t - 7) / 3), tt = (t - 7) - i * 3;
          if (order[i] === c) { [lift, pitch] = R.hop(tt, H[i]); c.pk = Math.max(c.pk || 0, pitch); if (c.pk > 0.12 && pitch < 0.01) { r.particles.burst(x - c.dir * 2.9, 0.15, z, 20, { color: [6, 3, 0.9], speed: 3.5, life: 0.6, size: 0.045, gravity: -9 }); audio.rumble?.(0.12); c.pk = 0; } }
        } else { const k = t - 25; x = c.stop + c.dir * 1.6 * k * k; if (c === A) { const e = Math.min(1, k * 1.2); roll = 0.17 * e; pitch = 0.05 * e; lift = 0.05 * e; } }
        R.carM(c.mesh.matrix, x, z, c.dir > 0 ? Math.PI / 2 : -Math.PI / 2, lift, pitch, roll);
      }
      if (t > 34) { R.drop(crowd); return false; }
      return true;
    };
  };
  // the battle: a ring of onlookers forms round the cardboard, the b-boys take quicker turns, the others cheering
  const breakBattle = () => {
    const BC = RT.SPOTS.breakers, ring = [];
    R.brk.battle = 26; R.brk.t = R.brk.len;
    for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2 + 0.2, rr = 3.15 + rng.range(-0.15, 0.25), x = BC.x + Math.sin(a) * rr, z = Math.max(-33.7, BC.z + Math.cos(a) * rr); ring.push(R.person(x, z, Math.atan2(BC.x - x, BC.z - z), (i + 3) % 8, i % 3 ? 'clap' : 'cheer', { ph: i % 2 })); }
    let t = 0;
    return dt => { if ((t += dt) > 26) { R.drop(ring); return false; } return true; };
  };
  // the skate train: eight skaters round the block, hands on the shoulders in front, the leader waving
  const skateTrain = () => {
    const s0 = rng.range(0, R.LOOP), dir = rng.next() < 0.5 ? 1 : -1, train = [];
    for (let i = 0; i < 8; i++) train.push(R.person(0, 0, 0, i, 'skate', { s0: s0 - dir * i * 1.1, v: 5.4, dir, train: i }));
    let t = 0;
    return dt => { if ((t += dt) > 40) { R.drop(train); return false; } return true; };
  };
  // the neon blackout: every sign, tube and bulb in the city stutters out, stays dark, and comes back a block at a time
  const neonBlackout = () => { city?.blackout(); audio.rumble?.(0.2); let t = 0; return dt => (t += dt) < 9; };
  // a prop plane towing AND THE BEAT GOES ON past the north side
  let bannerMat = null, ledMat = null;
  const bannerPlane = () => {
    bannerMat = bannerMat || new Material({ map: ctx2tex(env, 'beatbanner', () => TX.banner('AND THE BEAT GOES ON  ★', { w: 1024, h: 128, bg: '#fff4e6', color: '#ff3fa4', size: 84 })), roughness: 0.9, shading: 'cloth', doubleSided: true, sheen: [0.1, 0.1, 0.1] });
    const plane = add(geoOf(() => [
      { geo: G.box(1.0, 1.0, 6.2), matrix: T(0, 0, 0), color: col('#f4f1ea') }, { geo: G.box(1.02, 0.25, 6.22), matrix: T(0, 0.1, 0), color: col('#ff3fa4') },
      { geo: G.box(10.5, 0.14, 1.5), matrix: T(0, 0.35, 0.8), color: col('#f4f1ea') }, { geo: G.box(3.4, 0.1, 0.9), matrix: T(0, 0.2, -2.8), color: col('#f4f1ea') },
      { geo: G.box(0.1, 1.3, 1.0), matrix: T(0, 0.75, -2.8), color: col('#2fe0ff') }, { geo: G.box(2.2, 0.08, 0.12), matrix: T(0, 0, 3.15), color: col('#202226') },
      { geo: G.box(0.05, 0.05, 3.2), matrix: M.m4mul(M.m4(), T(0, -0.4, -4.4), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, 0.2))), color: col('#3a3a3a') },
    ], 'beatplane'), vmat);
    const banner = add(geoOf(() => [{ geo: G.quad(28, 3.2), matrix: T(0, 0, 0) }], 'beatbannerq'), bannerMat);
    const z = rng.range(70, 90); let t = 0;
    return dt => {
      t += dt; const x = -250 + 24 * t, y = 33 + Math.sin(t * 0.4) * 1.5;
      M.m4fromYaw(plane.matrix, x, y, z, Math.PI / 2);
      M.m4mul(banner.matrix, M.m4fromYaw(M.m4(), x - 20.5, y - 1.2, z, Math.PI), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.sin(t * 3.1) * 0.12), [1, 1, 1]));
      return x < 290;
    };
  };
  // the blimp, its message board scrolling down both flanks
  const blimp = () => {
    ledMat = ledMat || new Material({ map: ctx2tex(env, 'beatled', () => TX.ledBoard('AND THE BEAT GOES ON ★ DANCE ALL NIGHT ★ ', '#ff3fa4', '#ffe45c'), { wrap: 'repeat' }), color: [2.2, 2.2, 2.2], shading: 'unlit', fog: false });
    const body = add(geoOf(() => [
      { geo: G.sphere(1, 18, 12, { sx: 5, sy: 5, sz: 19 }), matrix: T(0, 0, 0), color: col('#d8dde4') },
      ...[0, 1, 2, 3].map(k => ({ geo: G.box(0.2, 4.2, 3.4), matrix: M.m4mul(M.m4(), T(0, 0, -16.5), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, k * Math.PI / 2 + Math.PI / 4))), color: col(k % 2 ? '#ff3fa4' : '#2fe0ff') })),
      { geo: G.box(1.6, 1.3, 4.5), matrix: T(0, -5.4, 1.5), color: col('#2a2a32') },
    ], 'beatblimp'), vmat);
    const board = add(geoOf(() => [-1, 1].map(s => { const q = G.quad(24, 3); for (let i = 0; i < 4; i++) q.uv[i * 2] *= 2; return { geo: q, matrix: T(s * 5.06, 0.4, 0, s * Math.PI / 2) }; }), 'beatblimpled'), ledMat);
    const z = rng.range(85, 105), dir = rng.next() < 0.5 ? 1 : -1; let t = 0;
    return dt => {
      t += dt; const x = dir * (-230 + 9 * t), y = 46 + Math.sin(t * 0.3) * 1.2, m = M.m4fromYaw(body.matrix, x, y, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      board.matrix.set(m); ledMat.uvOffset[0] = (ledMat.uvOffset[0] + dt * 0.06) % 1;
      return Math.abs(x) < 240 || t < 2;
    };
  };
  // the disco's light show: searchlights all along its roof sweep and cross, lasers fan out over the plaza
  const beamMats = {};
  const discoShow = () => {
    const D = city?.disco; if (!D) return () => false;
    const f = D.face, H = RT.DISCO.h, hues = [[1.7, 0.3, 1.1], [0.3, 1.2, 1.8], [1.6, 1.3, 0.3], [1.0, 0.4, 1.9], [0.4, 1.7, 0.8], [1.8, 0.6, 0.3]];
    const mat = (k, c) => beamMats[k] || (beamMats[k] = new Material({ color: c, shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true }));
    const beams = [-9, -5.4, -1.8, 1.8, 5.4, 9].map((a, i) => { const [x, z] = f.P(a, -2); const m = add(geoOf(() => [{ geo: RT.beamGeo(170, 0.3, 6, 12, 0.22) }], 'showbeam'), mat('b' + i, hues[i])); m.cull = false; m.order = 5; return { m, x, z, i }; });
    const lasers = Array.from({ length: 8 }, (_, i) => { const m = add(geoOf(() => [{ geo: RT.beamGeo(110, 0.03, 0.07, 5, 0.9) }], 'laser'), mat('l' + (i % 2), i % 2 ? [2.4, 0.3, 1.3] : [0.3, 2.4, 1.0])); m.cull = false; m.order = 5; return { m, i }; });
    const [lx, lz] = f.P(0, 0.2), ly = H + 5.4, base = Math.atan2(f.nx, f.nz);
    let t = 0;
    return dt => {
      t += dt; const on = t < 15.5 || Math.sin(t * 22) > 0;
      for (const b of beams) { M.m4mul(b.m.matrix, M.m4fromYaw(M.m4(), b.x, H + 0.6, b.z, base + Math.sin(t * 1.3 + b.i * 1.1) * 1.4), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, 0.35 + 0.3 * Math.sin(t * 0.9 + b.i)), [1, 1, 1])); b.m.visible = on; }
      // (the lasers fan up over the plaza into the sky, clear of the courts and their cameras)
      for (const l of lasers) {
        M.m4mul(l.m.matrix, M.m4fromYaw(M.m4(), lx, ly, lz, base + (l.i - 3.5) * 0.16 + Math.sin(t * 2.2) * 0.3), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, (62 + Math.sin(t * 1.7 + l.i) * 8) * DEG), [1, 1, 1]));
        l.m.visible = on && Math.sin(t * 9 + l.i) > -0.6;
      }
      return t < 16;
    };
  };
  // fireworks over the Strip in the event's colours
  const fireworks = () => {
    let t = 0;
    return dt => {
      t += dt;
      if (rng.next() < dt * 2.8) {
        const x = rng.range(-75, 75), y = rng.range(30, 54), z = rng.range(68, 120), c = rng.pick([[4, 0.6, 2.4], [0.6, 3.4, 4], [4, 3.4, 0.8], [2.4, 0.8, 4], [0.8, 4, 1.6]]);
        r.particles.burst(x, y, z, 36, { color: c, speed: 8, life: 1.5, size: 0.5, gravity: 2.4, drag: 0.6 });
        if (rng.next() < 0.5) r.particles.burst(x, y, z, 14, { color: [4, 3.6, 3], speed: 4, life: 0.9, size: 0.3, gravity: 1, drag: 1 });
        audio.rumble?.(0.05);
      }
      return t < 11;
    };
  };
  // cruise night: a parade of lowriders rolls down the Strip's near lane, bouncing, one up on three wheels now and then
  const cruise = () => {
    const n = 6, parade = Array.from({ length: n }, (_, i) => ({ mesh: R.lowrider(RT.CANDY[(i * 3 + rng.int(0, 7)) % RT.CANDY.length], i % 2 === 1), off: i * 9.5, ph: rng.range(0, 6), three: i === 2 || i === 4 }));
    const z = RT.STRIP.lanes[0].z; let t = 0;
    return dt => {
      t += dt; const head = 125 - 5.2 * t;
      for (const c of parade) {
        const x = head + c.off, b = Math.abs(Math.sin(t * 4.2 + c.ph)), th = c.three && Math.sin(t * 0.5 + c.ph) > 0.3;
        R.carM(c.mesh.matrix, x, z, -Math.PI / 2, th ? 0.05 : 0.02 * b, th ? 0.05 : 0.07 * b, th ? 0.17 : 0);
      }
      return head + n * 9.5 > -130;
    };
  };
  return [hopOff, breakBattle, skateTrain, neonBlackout, bannerPlane, blimp, discoShow, fireworks, cruise];
}
// a texture for the retro events, made once per GL context
const evTex = new Map();
function ctx2tex(env, key, make, opts = {}) { const ctx = env.r.ctx; let t = evTex.get(key); if (!t || t.ctx !== ctx) { t = { ctx, tex: ctx.texture(make(), opts) }; evTex.set(key, t); } return t.tex; }

// ---------------- v0.4.8.5 quick patch 2: The Monster Mash ----------------
// Monsters on the loose round the park, each a skinned figure (horror.js: one mesh moves two of them, its glowing bits a
// second unlit mesh on the same bones): zombies shambling along the cemetery fence and among the graves, the vampire
// gliding round the mausoleum, the werewolf prowling the pumpkin patch and stopping to howl at the moon, two mummies on
// the swamp's shore, two skeletons dancing on the mausoleum's steps, ghosts drifting through the cemetery, black cats (on
// the fence rail, a gate pillar, a porch), bats wheeling round the floodlights, trick-or-treaters going door to door, the
// slasher stalking slowly round the block with his lantern, and the Lantern Man beckoning at the carnival's gate.
// env: the createParkLife closures. Returns what the horror events need
const HSK = new Map(); // skinned geometries, made once per GL context
let poolTex = null; const poolTexOf = ctx => (poolTex && poolTex.ctx === ctx ? poolTex.t : (poolTex = { ctx, t: ctx.texture(TX.glowSpot(128, 1.6), { wrap: 'clamp' }) }).t);
function horrorLife(env) {
  const { r, ctx, rng, add, updExtra, town } = env;
  // (a strong cold sheen: the moon rims them, so they read against the dark; a breath of emission so nobody vanishes)
  const fmat = new Material({ color: [1, 1, 1], roughness: 0.78, shading: 'cloth', sheen: [0.5, 0.6, 0.78], emissive: [0.03, 0.036, 0.046] });
  const gmat = new Material({ color: [2.8, 2.8, 2.8], shading: 'unlit', fog: false });
  const ghostMat = new Material({ color: [0.8, 1.15, 1.0], shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false });
  const batMat = new Material({ color: [1, 1, 1], roughness: 0.85, doubleSided: true, emissive: [0.1, 0.085, 0.12] });
  const sgeo = (key, make) => { let e = HSK.get(key); if (!e || e.ctx !== ctx) { const g = make(); e = { ctx, v: g.geo ? { geo: ctx.geometry(g.geo), glow: g.glow ? ctx.geometry(g.glow) : null } : { geo: ctx.geometry(g) } }; HSK.set(key, e); } return e.v; };
  const bounds = (m, pts) => { let cx = 0, cz = 0, cy = 0; for (const q of pts) { cx += q[0]; cy += q[1]; cz += q[2]; } cx /= pts.length; cy /= pts.length; cz /= pts.length; let rr = 0; for (const q of pts) rr = Math.max(rr, Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz)); m.boundsOverride = { center: [cx, cy + 1, cz], radius: rr + 3 }; };
  // a mesh with one or two figures: pose(i, ...) poses figure i; done() updates the culling sphere
  const group = specs => {
    const key = 'fig:' + specs.map(s => s.kind + (s.v || '')).join('+'), g = sgeo(key, () => HR.figureGeo(specs)), bones = new Float32Array(16 * HR.FB * specs.length);
    const mesh = add(g.geo, fmat, { bones }), glow = g.glow ? add(g.glow, gmat, { bones }) : null, at = specs.map(() => [0, -60, 0]);
    return { mesh, glow, bones, kinds: specs.map(s => s.kind), at,
      pose(i, x, y, z, yaw, P, k = 1) { HR.poseFigure(bones, i, x, y, z, yaw, P, k, this.kinds[i]); at[i][0] = x; at[i][1] = P.hidden ? -60 : y; at[i][2] = z; },
      done() { bounds(mesh, at); if (glow) glow.boundsOverride = mesh.boundsOverride; } };
  };
  // walking a polyline (loop or back and forth): returns x, z and the heading at distance s
  const path = (pts, loop = true) => {
    const all = loop ? [...pts, pts[0]] : pts, segs = []; let L = 0;
    for (let i = 0; i < all.length - 1; i++) { const [a, b] = [all[i], all[i + 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push({ a, b, l, s: L }); L += l; }
    return { L, at(s0) { let s = s0, back = false; if (loop) s = ((s % L) + L) % L; else { const m = ((s % (2 * L)) + 2 * L) % (2 * L); back = m > L; s = back ? 2 * L - m : m; }
      for (const g of segs) if (s <= g.s + g.l) { const k = (s - g.s) / g.l; return [g.a[0] + (g.b[0] - g.a[0]) * k, g.a[1] + (g.b[1] - g.a[1]) * k, Math.atan2(g.b[0] - g.a[0], g.b[1] - g.a[1]) + (back ? Math.PI : 0)]; } const g = segs[segs.length - 1]; return [g.b[0], g.b[1], 0]; } };
  };
  const gy = HR.groundY, C = HR.CEMETERY;
  // ---- the cast ----
  const zA = group([{ kind: 'zombie', top: '#6a7aa8' }, { kind: 'zombie', top: '#9a6a4a', skin: '#a8bc96', v: 'b' }]);
  const zB = group([{ kind: 'zombie', top: '#8a5a7a', skin: '#94a888', v: 'c' }, { kind: 'zombie', top: '#5a7a5a', v: 'd' }]);
  const fenceWalk = path([[-42, 36.0], [22, 36.0]], false), graveWalk = path([[-36, 44], [-20, 47], [-14, 62], [-36, 63], [-40, 52]]);
  const vamp = group([{ kind: 'vampire' }, { kind: 'lanternman' }]), vampPath = path([[-6, 50], [10, 49], [16, 61], [2, 66], [-12, 63], [-24, 56], [-20, 46]]);
  const wolf = group([{ kind: 'werewolf' }, { kind: 'slasher' }]), wolfPath = path([[28, 57], [60, 57.5], [66, 50], [66, 38], [56, 36.6], [40, 36.6], [28, 40]]);
  const mum = group([{ kind: 'mummy' }, { kind: 'mummy', v: 'b' }]), mumPath = path([[-83, -30], [-82, -6], [-84, 12], [-83, 30]], false);
  const skel = group([{ kind: 'skeleton' }, { kind: 'skeleton', v: 'b' }]);
  const kids = [group([{ kind: 'kidSheet' }, { kind: 'kidPumpkin', skin: '#8d5a36' }]), group([{ kind: 'kidWitch' }, { kind: 'kidSkelly' }])];
  const slashPath = path([[-56, 36.2], [57, 36.2], [67, 30], [67, -30], [60, -47.6], [-60, -47.6], [-79, -34], [-80, 30]]);
  const ghostG = sgeo('ghosts6', () => HR.ghostGeo(6)), ghostBones = new Float32Array(16 * 12), ghosts = add(ghostG.geo, ghostMat, { bones: ghostBones }); ghosts.order = 3;
  const catG = sgeo('cats3', () => HR.catGeo(3)), catBones = new Float32Array(16 * 15), cats = add(catG.geo, fmat, { bones: catBones }), catEyes = add(catG.glow, gmat, { bones: catBones });
  const batG = sgeo('bats8', () => HR.batGeo(8)), swarms = [[-36.1, 15.4], [36.1, 15.4], [10.1, -15.4]].map(([x, z], i) => ({ x, z, y: 10.9, bones: new Float32Array(16 * 24), ph: i * 2.1 }));
  for (const sw of swarms) { sw.mesh = add(batG.geo, batMat, { bones: sw.bones }); sw.mesh.boundsOverride = { center: [sw.x, sw.y, sw.z], radius: 5 }; }
  const doors = town?.doors?.filter(d => !d.funeral) || [];
  const kidState = kids.map((g, i) => ({ g, i: i * 4 % Math.max(1, doors.length), mode: 'walk', t: 0, x: doors.length ? doors[i * 4 % doors.length].x - 10 * (i ? -1 : 1) : 0, dir: i ? -1 : 1, ph: rng.range(0, 6) }));
  const st = { t: 0, slash: { s: rng.range(0, 300), stop: 0, next: rng.range(15, 30) }, wolf: { s: 0, howl: 0 }, zA: rng.range(0, 60), zB: rng.range(0, 60), vamp: rng.range(0, 40), mum: 0, cats: [0, 0, 0], arch: [0, 0, 0], owl: rng.range(20, 50), creak: rng.range(10, 30) };
  // the ambient slasher and the zombies can be borrowed by an event (they hide while it has them)
  const hold = { slasher: 0, zombies: 0 };
  updExtra.push(dt => {
    const t = (st.t += dt);
    // zombies: two along the cemetery fence (back and forth), two among the graves
    if (hold.zombies <= 0) {
      st.zA += dt * 0.55; for (let i = 0; i < 2; i++) { const [x, z, yaw] = fenceWalk.at(st.zA - i * 2.2), ph = (st.zA - i * 2.2) * 2.6; zA.pose(i, x + (i ? 0.6 : 0), 0, z - i * 0.5, yaw, HR.MOVES.shamble(ph, t + i), 1.02); }
      st.zB += dt * 0.45; for (let i = 0; i < 2; i++) { const [x, z, yaw] = graveWalk.at(st.zB + i * 31), ph = (st.zB + i * 31) * 2.6; zB.pose(i, x, gy(x, z), z, yaw, HR.MOVES.shamble(ph, t * 1.1 + i), 0.98); }
    } else { hold.zombies -= dt; for (let i = 0; i < 2; i++) { zA.pose(i, 0, 0, 0, 0, { hidden: true }); zB.pose(i, 0, 0, 0, 0, { hidden: true }); } }
    zA.done(); zB.done();
    // the vampire glides (feet off the ground, the cape streaming); the Lantern Man beckons at the carnival gate
    st.vamp += dt * 1.25; { const [x, z, yaw] = vampPath.at(st.vamp); vamp.pose(0, x, gy(x, z) + 0.18 + Math.sin(t * 1.4) * 0.06, z, yaw, HR.MOVES.glide(t), 1.03); }
    { const A = HR.CARNIVAL.arch, P = (t % 14) < 9 ? HR.MOVES.beckon(t) : HR.MOVES.stand(t); vamp.pose(1, A.x - 1.3, 0, A.z + 4.8, -Math.PI / 2 - 0.3, P, 1.08); }
    vamp.done();
    // the werewolf prowls the patch; once a lap, at its far corner, it stands up and howls at the moon
    const W = st.wolf;
    if (W.howl > 0) { W.howl -= dt; const k = Math.min(1, (5.5 - W.howl) * 1.5, W.howl * 1.5); const [x, z] = wolfPath.at(W.s); wolf.pose(0, x, 0, z, Math.PI * 0.05, HR.MOVES.howl(Math.max(0, k)), 1.12); }
    else {
      const s0 = W.s;
      W.s += dt * 1.7;
      if (Math.floor(s0 / wolfPath.L) !== Math.floor(W.s / wolfPath.L) || (W.s % wolfPath.L > 58 && s0 % wolfPath.L <= 58)) { W.howl = 5.5; SP.howl(1.5); }
      const [x, z, yaw] = wolfPath.at(W.s);
      wolf.pose(0, x, gy(x, z), z, yaw, HR.MOVES.prowl(W.s * 1.9, t), 1.12);
    }
    // the slasher: slow and steady round the block, stopping now and then to look over at the courts
    const S = st.slash;
    if (hold.slasher > 0) { hold.slasher -= dt; wolf.pose(1, 0, 0, 0, 0, { hidden: true }); }
    else {
      if (S.stop > 0) S.stop -= dt; else { S.s += dt * 0.95; if ((S.next -= dt) <= 0) { S.stop = rng.range(3, 6); S.next = rng.range(18, 40); } }
      const [x, z, yaw] = slashPath.at(S.s), look = Math.atan2(-x, -z);
      const P = S.stop > 0 ? { ...HR.MOVES.stand(t), aL: [0.35, 0.2, 0.3], prop: [Math.sin(t * 2) * 0.08 - 0.35, 0, 0], head: [0.15, Math.max(-1.1, Math.min(1.1, Math.atan2(Math.sin(look - yaw), Math.cos(look - yaw)))), 0] } : HR.MOVES.creep(S.s * 2.2, t);
      wolf.pose(1, x, gy(x, z), z, yaw, P, 1.15);
    }
    wolf.done();
    // mummies on the shore
    st.mum += dt * 0.42; for (let i = 0; i < 2; i++) { const [x, z, yaw] = mumPath.at(st.mum - i * 1.6); mum.pose(i, x + (i ? 1.0 : 0), gy(x, z), z, yaw, HR.MOVES.mummy((st.mum - i * 1.6) * 3.4, t), 1.0); } mum.done();
    // the skeletons dance on the mausoleum's steps
    { const b = t * 2, Mz = HR.MAUSOLEUM, y = gy(Mz.x, Mz.z) + 0.66; for (let i = 0; i < 2; i++) skel.pose(i, Mz.x + (i ? 1.1 : -1.1), y, Mz.z - Mz.d / 2 - 0.5, Math.PI + (i ? -0.3 : 0.3), HR.MOVES.skel(b + i * 2), 1.0); skel.done(); }
    // ghosts drifting among the graves
    for (let i = 0; i < 6; i++) {
      const a = t * (0.05 + i * 0.012) + i * 1.7, cx = -12 + Math.cos(i * 2.3) * 16, cz = 52 + Math.sin(i * 1.7) * 7, x = cx + Math.cos(a) * 9, z = cz + Math.sin(a * 1.3) * 5;
      HR.poseGhost(ghostBones, i, x, gy(x, z) + 1.1 + (i % 3) * 0.3, z, a + Math.PI / 2 + Math.sin(t * 0.3 + i) * 0.4, t, 1);
    }
    ghosts.boundsOverride = { center: [-12, 3, 52], radius: 30 };
    // cats: one walks the fence rail, one sits on a gate pillar, one on a porch rail; now and then one arches its back
    { const c0 = path([[-40, 37.2], [20, 37.2]], false), [x, z, yaw] = c0.at(t * 0.45); HR.poseCat(catBones, 0, x, 1.62, z, yaw, t * 6, t, 0);
      for (let i = 1; i < 3; i++) { st.arch[i] = M.damp(st.arch[i], (t + i * 7) % 23 < 2 ? 1 : 0, 4, dt); }
      HR.poseCat(catBones, 1, C.gate - 2.3 + 0.28, 3.2, C.fence - 0.2, Math.PI, null, t, st.arch[1]);
      const d = doors[2]; if (d) HR.poseCat(catBones, 2, d.rail[0], d.rail[1], d.rail[2], 0.2, null, t + 3, st.arch[2]); }
    cats.boundsOverride = catEyes.boundsOverride = { center: [-10, 2, 0], radius: 70 };
    // bats wheeling round three of the floodlights
    for (const sw of swarms) for (let i = 0; i < 8; i++) {
      const a = t * (1.6 + (i % 3) * 0.3) * (i % 2 ? 1 : -1) + i * 0.8 + sw.ph, rr = 1.6 + (i % 4) * 0.5, y = sw.y + Math.sin(t * 1.3 + i) * 0.9;
      HR.poseBat(sw.bones, i, sw.x + Math.cos(a) * rr, y, sw.z + Math.sin(a) * rr, a + (i % 2 ? Math.PI : 0), t * 22 + i, 0, 1.6);
    }
    // trick-or-treaters: along the far sidewalk, up each path to knock, a moment at the door, back out
    for (const k of kidState) {
      if (!doors.length) { k.g.pose(0, 0, 0, 0, 0, { hidden: true }); k.g.pose(1, 0, 0, 0, 0, { hidden: true }); k.g.done(); continue; }
      const d = doors[k.i], walkZ = -47.6; k.t += dt;
      let x = k.x, z = walkZ, yaw = k.dir > 0 ? Math.PI / 2 : -Math.PI / 2, P = null;
      if (k.mode === 'walk') { k.x += k.dir * 1.0 * dt; x = k.x; k.ph += dt * 7; P = HR.MOVES.walk(k.ph, 0.9); if (Math.abs(k.x - d.x) < 0.2) { k.mode = 'up'; k.t = 0; } }
      else if (k.mode === 'up' || k.mode === 'down') {
        const f = Math.min(1, k.t / 3.2), u = k.mode === 'up' ? f : 1 - f;
        x = d.x;
        z = walkZ + (d.z - walkZ) * u;
        yaw = k.mode === 'up' ? Math.PI : 0;
        k.ph += dt * 7;
        P = HR.MOVES.walk(k.ph, 0.9);
        if (f >= 1) {
          k.mode = k.mode === 'up' ? 'door' : 'walk';
          k.t = 0;
          if (k.mode === 'walk') { k.i = (k.i + (k.dir > 0 ? 1 : -1) + doors.length) % doors.length; if ((k.dir > 0 && doors[k.i].x < k.x) || (k.dir < 0 && doors[k.i].x > k.x)) { k.dir = -k.dir; k.i = (k.i + 2 * (k.dir > 0 ? 1 : -1) + doors.length) % doors.length; } }
        }
      }
      else { x = d.x; z = d.z; yaw = Math.PI; P = k.t < 1.5 ? HR.MOVES.knock(k.t) : HR.MOVES.treat(k.t); if (k.t > 4.5) { k.mode = 'down'; k.t = 0; } }
      for (let j = 0; j < 2; j++) { const ox = (j ? 0.75 : -0.15) * (k.mode === 'walk' ? 1 : 0.9), oz = k.mode === 'walk' ? (j ? 0.5 : 0) : (j ? 0.55 : 0); k.g.pose(j, x + (k.mode === 'walk' ? -k.dir * j * 0.9 : ox), 0, z + oz, yaw, P, 0.6 + j * 0.04); }
      k.g.done();
    }
    // the night's sounds, now and then: an owl, the gate
    if ((st.owl -= dt) <= 0) { st.owl = rng.range(45, 100); SP.owl(rng.range(-0.6, 0.6)); }
    if ((st.creak -= dt) <= 0) { st.creak = rng.range(30, 70); SP.creak(0, 0.4); }
  });
  return { zA, zB, vamp, wolf, mum, skel, kids: kidState, ghosts, cats, swarms, hold, group, sgeo, path, fmat, gmat, ghostMat, batMat, st };
}

// the Monster Mash's random events: a thunderstorm over the town, the dead rising from their graves, the zombie troupe's
// dance on the sidewalk, the slasher chasing screaming teens past the fence, the witch flying across the moon, bats
// bursting out of the bell tower, a ghost parade, the werewolf's transformation on the mausoleum's roof (against the
// moon), the HAUNTED HOUSE ride bursting open, fireworks in pumpkin orange and slime green, the hearse rolling by
function horrorEvents(env, H) {
  const { r, ctx, rng, add, scene, town } = env;
  const gy = HR.groundY, C = HR.CEMETERY;
  const boltMat = new Material({ color: [6, 6.5, 8], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true });
  // a lightning strike far over the hills: a jagged bolt, the town lit up, the thunder after it
  const strike = m0 => {
    const a = rng.range(-Math.PI, Math.PI), d = rng.range(110, 190), tx = Math.cos(a) * d, tz = Math.sin(a) * d, top = [tx + rng.range(-20, 20), 90, tz + rng.range(-20, 20)], path = [top];
    for (let i = 1; i <= 10; i++) { const k = i / 10; path.push([top[0] + (tx - top[0]) * k + rng.range(-5, 5) * (1 - k), 90 * (1 - k) + gy(tx, tz), top[2] + (tz - top[2]) * k + rng.range(-5, 5) * (1 - k)]); }
    const parts = [{ geo: G.tube(path, k => 0.9 - 0.6 * k, 5) }], f0 = path[4]; parts.push({ geo: G.tube([f0, [f0[0] + rng.range(-14, 14), f0[1] - 20, f0[2] + rng.range(-14, 14)], [f0[0] + rng.range(-20, 20), f0[1] - 38, f0[2] + rng.range(-20, 20)]], k => 0.4 - 0.25 * k, 4) });
    m0.geo = ctx.geometry(G.merge(parts, false)); m0.order = 7;
    town?.flash(1); SP.thunder(d / 340, d < 140 ? 0.7 : 0.3, Math.cos(a) * 0.5);
    return m0;
  };
  const storm = () => {
    const bolts = [0, 1, 2, 3, 4].map(() => { const m = add(ctx.geometry(G.box(0.1, 0.1, 0.1)), boltMat); m.visible = false; return m; });
    let t = 0, next = 0.4, bolt = null, bt = 0, n = 0;
    return dt => {
      t += dt;
      if ((next -= dt) <= 0 && t < 13 && n < bolts.length) { if (bolt) bolt.visible = false; bolt = strike(bolts[n++]); bt = 0.42; next = rng.range(2.2, 4.5); }
      if (bolt) { bt -= dt; bolt.visible = bt > 0 && (bt % 0.14) > 0.05; if (bt > 0.2 && Math.random() < 0.2) town?.flash(0.6); }
      if (Math.random() < dt * 30 && r.particles) for (let k = 0; k < 2; k++) r.particles.emit({ x: rng.range(-70, 70), y: 16, z: rng.range(-40, 40), vy: -18, vx: 1.5, life: 1, size: 0.03, color: [0.25, 0.3, 0.35], gravity: 0, drag: 0 });
      return t < 16;
    };
  };
  // the dead rise: six zombies claw their way out of the open graves, look about, shamble down toward the fence, and
  // sink back into the earth
  const rising = () => {
    const gs = [0, 1, 2].map(i => H.group([{ kind: 'zombie', top: rng.pick(['#4a5a7a', '#6a4a3a', '#3a4a3a']), v: 'r' + i }, { kind: 'zombie', top: rng.pick(['#5a3a4a', '#4a4a5a']), skin: '#94a888', v: 'q' + i }]));
    const z = HR.GRAVES.map(([x, zz], i) => ({ x, z: zz, y0: gy(x, zz), t0: i * 0.6, yaw: Math.PI + rng.range(-0.4, 0.4) }));
    // an eerie green light welling up out of the graves (a real light for the while)
    const glowL = { pos: [-12, 4, 50], range: 30, color: [0.4, 1, 0.45], intensity: 0, dir: null }; scene.lights.unshift(glowL);
    let t = 0; SP.groan(0);
    return dt => {
      t += dt;
      glowL.intensity = 14 * Math.min(1, t / 2) * (1 - M.smooth((t - 28) / 4)) * (0.85 + 0.15 * Math.sin(t * 7));
      if (t >= 33) { const i = scene.lights.indexOf(glowL); if (i >= 0) scene.lights.splice(i, 1); }
      z.forEach((q, i) => {
        const g = gs[Math.floor(i / 2)], j = i % 2, lt = t - q.t0;
        if (lt < 0) { g.pose(j, 0, 0, 0, 0, { hidden: true }); return; }
        if (lt < 4) { const k = M.smooth(lt / 4); g.pose(j, q.x, q.y0 - 1.9 * (1 - k), q.z, q.yaw, HR.MOVES.rise(k), 1); if (Math.random() < dt * 10 && r.particles) r.particles.burst(q.x, q.y0 + 0.1, q.z, 3, { color: [0.22, 0.16, 0.1], speed: 1.6, life: 0.9, size: 0.09, gravity: -6 }); return; }
        const w = lt - 4, zz = Math.max(C.z0 + 0.8, q.z - w * 0.45), xx = q.x + Math.sin(w * 0.3 + i) * 1.2;
        if (lt < 26) g.pose(j, xx, gy(xx, zz), zz, Math.PI + Math.sin(w * 0.3 + i) * 0.3, HR.MOVES.shamble(w * 2.4, t + i), 1);
        else { const k = Math.min(1, (lt - 26) / 3); g.pose(j, xx, gy(xx, zz) - k * 2, zz, Math.PI, HR.MOVES.rise(1 - k), 1); }
      });
      for (const g of gs) g.done();
      return t < 33;
    };
  };
  // the troupe: eight zombies file out of the cemetery gate onto the sidewalk, line up in two rows facing the courts, dance
  // the routine (horror.js zombieRoutine) to their own little groove, and shamble back in
  const troupe = () => {
    const gs = [0, 1, 2, 3].map(i => H.group([{ kind: 'zombie', top: ['#5a2a6a', '#4a5a7a', '#6a4a3a', '#3a4a3a'][i], v: 't' + i }, { kind: i ? 'zombie' : 'mummy', top: ['#2a2a3a', '#5a3a4a', '#4a4a5a', '#6a5a3a'][i], skin: '#94a888', v: 'u' + i }]));
    const spots = []; for (let row = 0; row < 2; row++) for (let k = 0; k < 4; k++) spots.push([C.gate - 4.5 + k * 3 + row * 1.5 - 0.75, 34.6 + row * 1.4]);
    const BPM = 112, beatLen = 60 / BPM; let t = 0, played = false;
    H.hold.zombies = 40;
    // stage lights: a pink-and-green spot from over the courts' end (a real light while they dance), pools on the sidewalk
    const spot = { pos: [C.gate, 9, 24], range: 30, color: [0.7, 1, 0.5], intensity: 0, dir: M.v3norm([0, 0, 0], [0, -8, 11]), cos: 0.84 }; scene.lights.unshift(spot);
    const pm = new Material({ map: poolTexOf(ctx), color: [0, 0, 0], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
    const pools = add(ctx.geometry(G.merge([[-3, 0], [3, 0], [0, 1.2]].map(([dx, dz], i) => ({ geo: G.plane(7, 7), matrix: T(C.gate + dx, 0.05, 35.2 + dz), color: i === 2 ? [0.3, 1, 0.3, 1] : [1, 0.45, 0.1, 1] })))), pm); pools.order = 2;
    const off = () => { const i = scene.lights.indexOf(spot); if (i >= 0) scene.lights.splice(i, 1); };
    return dt => {
      t += dt;
      { const on = Math.min(1, t / 3) * (1 - M.smooth((t - 34) / 4)), b = (t - 8.5) / beatLen, pulse = t > 8.5 && t < 31 ? 0.6 + 0.4 * (1 - (b % 1)) ** 2 : 0.6; spot.intensity = 30 * on * pulse; const k = on * pulse * 0.55; pm.color = [k, k, k]; if (t >= 40) off(); }
      spots.forEach(([sx, sz], i) => {
        const g = gs[i >> 1], j = i & 1, enter = Math.min(1, Math.max(0, (t - i * 0.5) / 6)), leave = Math.max(0, Math.min(1, (t - 30 - (7 - i) * 0.4) / 6));
        const gx = C.gate + (i % 4 - 1.5) * 0.6, gz = 40;
        if (t < 8.5 || leave > 0) {
          const u = leave > 0 ? 1 - leave : enter, x = gx + (sx - gx) * u, z = gz + (sz - gz) * u;
          g.pose(j, x, 0, z, leave > 0 ? 0 : Math.PI + (u < 1 ? 0 : 0), u > 0 && u < 1 ? HR.MOVES.shamble(t * 2.6 + i, t) : HR.MOVES.stand(t), 1);
          if (leave >= 1) g.pose(j, 0, 0, 0, 0, { hidden: true });
          return;
        }
        if (!played) { played = true; SP.groove(BPM, 20.5); }
        const b = (t - 8.5) / beatLen, { P, dx } = HR.zombieRoutine(b);
        g.pose(j, sx + dx, 0, sz, Math.PI, P, 1);
      });
      for (const g of gs) g.done();
      if (t >= 40) off();
      return t < 40;
    };
  };
  // the chase: four teens pelting along the north sidewalk, one trips and scrambles up; the slasher lumbering after them
  // with his lantern, who stops at the cemetery gate, turns to look at the courts, and walks off into the cemetery
  const chase = () => {
    const tg = [H.group([{ kind: 'teen', top: '#c83a2a', hair: 'long', hairCol: '#e8c060' }, { kind: 'teen', top: '#2a6a9a', skin: '#8d5a36', hair: 'short', hairCol: '#1a1210', v: 'b' }]), H.group([{ kind: 'teen', top: '#3a8a4a', hair: 'cap', hairCol: '#1a2a6a', v: 'c' }, { kind: 'teen', top: '#8a4aa0', skin: '#c68b62', hair: 'long', hairCol: '#2a1810', v: 'd' }])];
    const sl = H.group([{ kind: 'slasher', v: 'e' }]);
    H.hold.slasher = 46; // (as long as the chase: he's back on his rounds when it ends)
    // his lantern throws real light round him as he comes
    const lamp = { pos: [0, 1, 0], range: 9, color: [1, 0.62, 0.28], intensity: 0, dir: null }; scene.lights.unshift(lamp);
    const z = 34.8, dir = 1; let t = 0;
    return dt => {
      t += dt;
      { const m = sl.bones.subarray(11 * 16, 12 * 16); lamp.pos = [m[12], m[13] - 0.2, m[14]]; lamp.intensity = 7 * Math.min(1, t) * (0.85 + 0.15 * Math.sin(t * 11)) * (t < 44 ? 1 : 0); if (t >= 46) { const i = scene.lights.indexOf(lamp); if (i >= 0) scene.lights.splice(i, 1); } }
      for (let i = 0; i < 4; i++) {
        const g = tg[i >> 1], j = i & 1, x = -78 + (t - i * 0.35) * 5.2 * dir, trip = i === 2 && x > -12 && x < -4;
        if (x > 85) { g.pose(j, 0, 0, 0, 0, { hidden: true }); continue; }
        if (trip) { const k = (x + 12) / 8; g.pose(j, x - 3 * k, 0, z + 0.3, Math.PI / 2, k < 0.5 ? { ...HR.MOVES.hunch(1), pitch: 1.2 * Math.sin(k * Math.PI) } : HR.MOVES.scream(t * 9), 1); continue; }
        g.pose(j, x, 0, z + (i % 2) * 0.6 - 0.3, Math.PI / 2, HR.MOVES.scream(t * 9 + i), 1);
      }
      if (t > 1 && t < 1.1) SP.screams(4, -0.5);
      if (t > 12 && t < 12.1) SP.screams(3, 0.4);
      // him: steady, the lantern swinging, to the gate; a look round; then in among the graves and gone in the fog
      const sx = -84 + t * 2.0, gate = C.gate;
      if (sx < gate) sl.pose(0, sx, 0, z, Math.PI / 2, HR.MOVES.creep(t * 2.6, t), 1.15);
      else {
        const w = t - (gate + 84) / 2.0;
        if (w < 4) sl.pose(0, gate, 0, z, Math.PI / 2 - Math.min(1, w) * (Math.PI / 2 + 0.6), { ...HR.MOVES.stand(t), aL: [0.35, 0.2, 0.3], head: [0.1, -0.5, 0] }, 1.15);
        else { const zz = z + (w - 4) * 1.3; sl.pose(0, gate, gy(gate, zz), zz, 0, HR.MOVES.creep(t * 2.6, t), 1.15); }
      }
      for (const g of tg) g.done(); sl.done();
      return t < 46;
    };
  };
  // the witch on her broomstick crossing the face of the moon, cackling, a trail of green sparks behind her
  const witch = () => {
    const g = H.group([{ kind: 'witch' }]), mdir = HR.moonDir(env.theme), az0 = Math.atan2(mdir[0], mdir[2]), el0 = Math.asin(mdir[1]), D = 95;
    let t = 0; SP.cackle(0);
    return dt => {
      // (across the moon's upper half, over the mansion's roofline as you see it from the plaza)
      t += dt; const k = t / 14, az = az0 + 0.55 - 1.1 * k, el = el0 + 0.075 + Math.sin(k * Math.PI) * 0.02 + Math.sin(t * 2) * 0.004;
      const x = Math.sin(az) * D, z = Math.cos(az) * D - 20, y = 3.4 + Math.tan(el) * Math.hypot(x, z + 20) - 3.0;
      const P = { ...HR.MOVES.sit(t), aR: (t % 4) < 1.2 ? [2.2, 0.4, 0.3] : [0.9, 0.15, 0.5], prop: [0, 0, 0] };
      g.pose(0, x, y, z, az - Math.PI / 2, P, 3.2); g.done();
      if (Math.random() < dt * 25 && r.particles) r.particles.emit({ x: x + Math.cos(az) * 2.5, y: y + 2.4, z: z - Math.sin(az) * 2.5, vy: -0.5, life: 1.4, size: 0.35, color: [0.6, 3, 0.5], gravity: 0.5, drag: 0.5, flick: 2 });
      if (t > 6 && t < 6.05) SP.cackle(0.3);
      return t < 14;
    };
  };
  // bats: the bell tolls, and a swarm bursts out of the belfry, wheels over the park and streams off toward the moon
  const batBurst = () => {
    const ms = [0, 1, 2].map(() => { const bones = new Float32Array(16 * 24), m = add(H.sgeo('bats8', () => HR.batGeo(8)).geo, H.batMat, { bones }); return { m, bones }; });
    const B = HR.BELFRY, mdir = HR.moonDir(env.theme), bats = Array.from({ length: 24 }, (_, i) => ({ d: [rng.range(-1, 1), rng.range(0.2, 1), rng.range(-1, 0.4)], ph: rng.range(0, 6), sp: rng.range(5, 9), a: rng.range(0, 6.3), r: rng.range(6, 16) }));
    let t = 0; SP.bell(3, -0.4);
    return dt => {
      t += dt;
      bats.forEach((b, i) => {
        const g = ms[Math.floor(i / 8)], lt = Math.max(0, t - 0.8 - i * 0.05);
        let x, y, z;
        if (lt < 2) { x = B.x + b.d[0] * lt * b.sp; y = B.y + b.d[1] * lt * b.sp * 0.6; z = B.z + b.d[2] * lt * b.sp; }
        else if (lt < 12) { const w = lt - 2, a = b.a + w * 0.7 * (i % 2 ? 1 : -1), cx = -20 + w * 2.2, cz = 30 - w * 1.5; x = cx + Math.cos(a) * b.r; y = 18 + Math.sin(w * 1.3 + i) * 3; z = cz + Math.sin(a) * b.r * 0.7; }
        else { const w = lt - 12, cx = -20 + 22, cz = 15; x = cx + Math.cos(b.a) * b.r + mdir[0] * w * 14; y = 18 + mdir[1] * w * 14 + w * 2; z = cz + mdir[2] * w * 14; }
        HR.poseBat(g.bones, i % 8, x, y, z, Math.atan2(x - B.x, z - B.z) + Math.sin(t + i), t * 24 + i, 0, 1.8);
      });
      for (const g of ms) g.m.boundsOverride = { center: [0, 30, 40], radius: 160 };
      return t < 22;
    };
  };
  // the ghost parade: eight ghosts in single file behind the Lantern Man, drifting along the sidewalk and up into the
  // cemetery, fading as they go
  const parade = () => {
    const bones = new Float32Array(16 * 16), mat = new Material({ color: [0.8, 1.15, 1.0], opacity: 0, shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false });
    const gm = add(H.sgeo('ghosts8', () => HR.ghostGeo(8)).geo, mat, { bones }); gm.order = 3;
    const lead = H.group([{ kind: 'lanternman', v: 'p' }]), route = H.path([[-66, 35.2], [C.gate - 0.5, 35.2], [C.gate, 40], [C.gate + 6, 56], [18, 64]], false);
    let t = 0; SP.moan(-0.4, 0.4);
    return dt => {
      t += dt; const s = t * 1.5;
      mat.opacity = Math.min(1, t / 2) * (1 - M.smooth((t - 36) / 4));
      const [lx, lz, ly] = route.at(s); lead.pose(0, lx, gy(lx, lz), lz, ly, { ...HR.MOVES.walk(s * 2.2, 0.8), aR: [0.6, 0.2, 0.8] }, 1.08); lead.done();
      for (let i = 0; i < 8; i++) { const [x, z, yaw] = route.at(s - 2.6 - i * 2.4); HR.poseGhost(bones, i, x, gy(x, z) + 1.0, z, yaw, t + i, 1); }
      gm.boundsOverride = { center: [lx, 3, lz], radius: 30 };
      if (t > 14 && t < 14.05) SP.moan(0.2, 0.35);
      if (t > 40) lead.pose(0, 0, 0, 0, 0, { hidden: true });
      return t < 41;
    };
  };
  // the transformation: a man on top of the old folly (right under the moon, as you look from the plaza) doubles over,
  // smoke bursts round him, the werewolf rears up out of it against the moon and howls, the moon's halo flaring; then it
  // leaps down behind
  const transform = () => {
    const F = HR.FOLLY, x = F.x, y = gy(F.x, F.z) - 0.4 + F.h - 0.1, z = F.z;
    const g = H.group([{ kind: 'wolfman', v: 'x' }]), wolfGeo = H.sgeo('fig:werewolfx', () => HR.figureGeo([{ kind: 'werewolf' }]));
    const eyes = add(wolfGeo.glow, H.gmat, { bones: g.bones }); eyes.visible = false;
    let t = 0, swapped = false;
    return dt => {
      t += dt;
      if (t < 3) g.pose(0, x, y, z, 0, { ...HR.MOVES.hunch(Math.min(1, t / 1.5)), side: Math.sin(t * 30) * 0.05 * t }, 1.3);
      else {
        if (!swapped) { swapped = true; g.mesh.geo = wolfGeo.geo; eyes.visible = true; g.kinds[0] = 'werewolf'; if (r.particles) r.particles.burst(x, y + 1, z, 50, { color: [0.4, 0.45, 0.5], speed: 3, life: 1.6, size: 0.45, gravity: 0.5, drag: 1.2 }); }
        const k = Math.min(1, (t - 3) / 1.2), sc = 1.4 + 1.0 * k; // (he grows as he turns: a giant against the moon)
        if (t < 10) { g.pose(0, x, y, z, 0, t < 4.2 ? HR.MOVES.hunch(1 - k) : HR.MOVES.howl(Math.min(1, (t - 4.2) * 1.5)), sc); if (t > 4.4 && t < 4.45) SP.howl(1.2); }
        else { const w = t - 10; g.pose(0, x, y + 3 * w - 9 * w * w, z + w * 4, 0, { ...HR.MOVES.run(w * 6), pitch: 0.6 }, sc); if (w > 1.5) g.pose(0, 0, 0, 0, 0, { hidden: true }); }
      }
      if (town?.sky && t > 4.2 && t < 10) { const h = town.sky.haloMat.color; h[0] = 0.32 * (1.6 + Math.sin(t * 6) * 0.2); h[1] = 0.38 * (1.6 + Math.sin(t * 6) * 0.2); h[2] = 0.5 * (1.6 + Math.sin(t * 6) * 0.2); }
      g.done(); eyes.boundsOverride = g.mesh.boundsOverride;
      return t < 11.6;
    };
  };
  // the HAUNTED HOUSE bursts open: its lights strobe, the doors fly open, green fog rolls out, a ghost shrieks out over
  // the carnival and away, the organ swells
  const ride = () => {
    const R = HR.CARNIVAL.ride, bones = new Float32Array(16 * 2), gm = add(H.sgeo('ghosts1', () => HR.ghostGeo(1, 2.2)).geo, H.ghostMat, { bones }); gm.order = 3;
    town?.rideBurst(); SP.organ(0.5); SP.creak(0.5, 0.6);
    let t = 0;
    return dt => {
      t += dt;
      if (r.particles && t < 7 && Math.random() < dt * 14) r.particles.emit({ x: R.x - 0.6, y: 0.8 + Math.random() * 2, z: R.z + rng.range(-2.2, 2.2), vx: -rng.range(1.5, 3), vy: 0.2, vz: rng.range(-0.5, 0.5), life: 3, size: 0.8, color: [0.12, 0.5, 0.1], gravity: 0.05, drag: 0.5, grow: 2 });
      const w = Math.max(0, t - 1.4), x = R.x - 1 - w * 7, y = 2 + w * w * 1.2, z = R.z + Math.sin(w * 2) * 2;
      HR.poseGhost(bones, 0, x, y, z, -Math.PI / 2, t * 2, 1); gm.visible = t > 1.2 && t < 7.5; gm.boundsOverride = { center: [x, y, z], radius: 6 };
      if (t > 1.5 && t < 1.55) SP.screams(1, 0.6);
      return t < 9.2;
    };
  };
  // fireworks over the cemetery and the hill in pumpkin orange and slime green, a few purple
  const fireworks = () => {
    let t = 0;
    return dt => {
      t += dt;
      if (rng.next() < dt * 2.6 && r.particles) {
        const x = rng.range(-70, 70), y = rng.range(32, 56), z = rng.range(70, 130), c = rng.pick([[4, 1.6, 0.3], [0.8, 4, 0.6], [4, 1.6, 0.3], [0.8, 4, 0.6], [2.6, 0.8, 4]]);
        r.particles.burst(x, y, z, 40, { color: c, speed: 8.5, life: 1.6, size: 0.55, gravity: 2.4, drag: 0.6 });
        if (rng.next() < 0.5) r.particles.burst(x, y, z, 16, { color: [4, 3.6, 2.6], speed: 4, life: 0.9, size: 0.3, gravity: 1, drag: 1 });
        audio.rumble?.(0.05);
      }
      return t < 11;
    };
  };
  // the hearse, rolling slowly along the street with its lamps lit and the curtains glowing
  let hlMat = null;
  const hearseBy = () => {
    hlMat = hlMat || new Material({ color: [1.6, 1.6, 1.6], shading: 'unlit', fog: false });
    const body = add(H.sgeo('hearse', () => G.merge(HR.hearse())).geo, env.vmat), lights = add(H.sgeo('hearselights', () => G.merge(HR.hearseLights())).geo, hlMat);
    const z = HR.STREET.lanes[0].z; let x = -125, t = 0;
    return dt => {
      t += dt; x += 4.6 * dt;
      for (const m of [body, lights]) M.m4fromYaw(m.matrix, x, Math.abs(Math.sin(t * 9)) * 0.01, z, Math.PI / 2);
      if ((t % 2.2) < dt && Math.abs(x) < 70) audio.rumble?.(0.04);
      return x < 125;
    };
  };
  return [storm, rising, troupe, chase, witch, batBurst, parade, transform, ride, fireworks, hearseBy];
}
