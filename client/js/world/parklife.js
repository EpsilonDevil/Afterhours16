// v0.4.3 park life: background population plus random events, different for every park. Everything is
// procedural and original: people walking the sidewalks beyond the fences, traffic, boats, birds, trains, a
// helicopter with a searchlight, a container crane at work, sparks and steam. A scheduler fires a random
// event every ~15-35 s so the park never looks frozen.
import * as G from '../gfx/geometry.js';
import * as M from '../core/math.js';
import { Material, Mesh } from '../gfx/renderer.js';
import * as PR from './props.js';
import { audio } from '../core/audio.js';

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
  const movers = [];
  const carParts = (body, cabin) => [
    { geo: G.box(1.8, 0.62, 4.3), matrix: T(0, 0.62, 0), color: col(body) },
    { geo: G.box(1.62, 0.55, 2.3), matrix: T(0, 1.2, -0.2), color: col(cabin) },
    ...[[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]].map(([x, z]) => ({ geo: G.cylinder(0.33, 0.33, 0.22, 10), matrix: M.m4mul(M.m4(), T(x, 0.33, z), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, Math.PI / 2))), color: col('#111214') })),
  ];
  const lightsFor = () => [
    ...[-0.6, 0.6].map(x => ({ geo: G.box(0.3, 0.14, 0.04), matrix: T(x, 0.7, 2.16), color: [1, 1, 1, 1] })),
  ];
  const tailsFor = () => [-0.6, 0.6].map(x => ({ geo: G.box(0.3, 0.12, 0.04), matrix: T(x, 0.72, -2.16), color: [1, 1, 1, 1] }));
  if (theme.style === 'city') {
    // streets on the east and west edges, plus an elevated train line (viaduct) above the north wall
    const roads = [{ x: -66, dir: 1 }, { x: -68.5, dir: -1 }, { x: 66, dir: -1 }, { x: 68.5, dir: 1 }];
    const paints = ['#c8322f', '#e8e3d8', '#1d2731', '#f2c14e', '#3b5873', '#6b6f75', '#2f6b54'];
    for (let i = 0; i < 10; i++) {
      const rd = roads[i % roads.length], paint = rng.pick(paints);
      const body = add(geoOf(() => carParts(paint, '#1b2028'), 'car' + paint), vmat);
      const hl = add(geoOf(lightsFor, 'hl'), glow), tl = add(geoOf(tailsFor, 'tl'), red);
      movers.push({ meshes: [body, hl, tl], x: rd.x, z: rng.range(-60, 60), dir: rd.dir, v: rng.range(8, 13), axis: 'z' });
    }
    const via = [];
    for (let x = -120; x <= 120; x += 12) via.push({ geo: G.box(1.2, 8.4, 1.2), matrix: T(x, 4.2, 37), color: col('#2b2d31') });
    via.push({ geo: G.box(260, 0.9, 4.2), matrix: T(0, 8.85, 37), color: col('#34373c') });
    add(geoOf(via), vmat, { castShadow: true });
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
    const n = 9 + rng.int(0, 6), c = kind === 'gull' ? '#f4f2ec' : kind === 'crow' ? '#141416' : '#7d8088';
    const geo = geoOf(() => [{ geo: G.box(0.5, 0.03, 0.12), matrix: T(0, 0, 0), color: col(c) }, { geo: G.box(0.08, 0.08, 0.3), matrix: T(0, 0, 0.02), color: col(c) }], 'bird' + kind);
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
    const cars = [], n = kind === 'freight' ? 10 : 6, len = kind === 'freight' ? 13 : 15, y = kind === 'freight' ? 0.3 : 9.3, z = kind === 'freight' ? 62 : 37;
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
  const EVENTS = {
    coast: [() => birds('gull'), () => birds('gull'), speedboat, speedboat, plane],
    city: [() => train('el'), heli, () => birds('pigeon'), fireworksOrLights, plane],
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
      updPeople(dt); updMovers(dt);
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
