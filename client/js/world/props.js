// Prop geometry builders. Each returns parts [{geo, matrix, color}] for batching with G.merge().
import * as G from '../gfx/geometry.js';
import * as M from '../core/math.js';
import { RNG } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { drawWheel } from './wheelart.js';

const T = (x, y, z, yaw = 0, s = 1) => M.m4fromYaw(M.m4(), x, y, z, yaw, s);
const col = hex => [...M.hexLinear(hex), 1];
const TS = (x, y, z, sx, sy, sz, yaw = 0) => { const m = M.m4fromYaw(M.m4(), x, y, z, yaw); const sc = M.m4(); sc[0] = sx; sc[5] = sy; sc[10] = sz; return M.m4mul(M.m4(), m, sc); };

export function bench(x, z, yaw, wood = '#9a6b42', metal = '#30363b') {
  return [
    { geo: G.box(2.2, 0.06, 0.42), matrix: T(x, 0.46, z, yaw), color: col(wood) },
    { geo: G.box(2.2, 0.3, 0.05), matrix: M.m4mul(M.m4(), T(x, 0.72, z, yaw), T(0, 0, -0.22)), color: col(wood) },
    { geo: G.box(0.06, 0.46, 0.4), matrix: M.m4mul(M.m4(), T(x, 0.23, z, yaw), T(-0.95, 0, 0)), color: col(metal) },
    { geo: G.box(0.06, 0.46, 0.4), matrix: M.m4mul(M.m4(), T(x, 0.23, z, yaw), T(0.95, 0, 0)), color: col(metal) },
  ];
}

export function lightPole(x, z, yaw, h = 9, color = '#2c3237') {
  const parts = [
    { geo: G.cylinder(0.09, 0.14, h, 10, { y0: true }), matrix: T(x, 0, z), color: col(color) },
    { geo: G.box(1.6, 0.12, 0.12), matrix: T(x, h - 0.1, z, yaw), color: col(color) },
  ];
  for (const o of [-0.55, 0, 0.55]) parts.push({ geo: G.box(0.38, 0.22, 0.3), matrix: M.m4mul(M.m4(), T(x, h - 0.25, z, yaw), T(o, 0, 0.12)), color: col('#1c2024') });
  return parts;
}
// emissive lamp faces (separate unlit material)
export function lampFaces(x, z, yaw, h = 9) {
  const parts = [];
  for (const o of [-0.55, 0, 0.55]) {
    const m = M.m4mul(M.m4(), T(x, h - 0.37, z, yaw), T(o, 0, 0.12));
    const r = M.m4(); M.m4compose(r, [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2));
    parts.push({ geo: G.plane(0.32, 0.24), matrix: M.m4mul(M.m4(), m, M.m4mul(M.m4(), r, M.m4())), color: [1, 1, 1, 1] });
  }
  return parts;
}

export function tree(x, z, s = 1, rng = new RNG(1), leaf = '#3f6b3a', trunk = '#5a4330') {
  const parts = [{ geo: G.cylinder(0.12 * s, 0.2 * s, 2.6 * s, 8, { y0: true }), matrix: T(x, 0, z), color: col(trunk) }];
  for (let i = 0; i < 5; i++) {
    const r = (0.9 + rng.next() * 0.7) * s;
    const g = G.sphere(r, 10, 8);
    const k = 0.75 + rng.next() * 0.4;
    parts.push({ geo: g, matrix: T(x + rng.range(-0.7, 0.7) * s, 2.9 * s + rng.range(0, 1.4) * s, z + rng.range(-0.7, 0.7) * s), color: [...M.hexLinear(leaf).map(v => v * k), 1] });
  }
  return parts;
}

export function palm(x, z, s = 1, rng = new RNG(2)) {
  const parts = [];
  const h = (6 + rng.next() * 3) * s;
  const lean = rng.range(-0.4, 0.4), leanZ = rng.range(-0.3, 0.3);
  const path = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; path.push([x + lean * t * t * 2, h * t, z + leanZ * t * t * 2]); }
  parts.push({ geo: G.tube(path, t => 0.16 * s * (1 - t * 0.35), 8), color: col('#7d6447') });
  const top = path[path.length - 1];
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * Math.PI * 2 + rng.next() * 0.3;
    const fr = [];
    const L = (2.6 + rng.next()) * s;
    for (let i = 0; i <= 6; i++) { const t = i / 6; fr.push([top[0] + Math.sin(a) * L * t, top[1] + 0.3 * s - t * t * 1.6 * s, top[2] + Math.cos(a) * L * t]); }
    parts.push({ geo: G.tube(fr, t => 0.28 * s * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1)) + 0.02, 4), color: col(k % 2 ? '#3d7a3a' : '#4f8a42') });
  }
  return parts;
}

// Chain-link fence run between two points (posts + rails); mesh part separately (alpha texture)
export function fenceFrame(x0, z0, x1, z1, h = 3.6, color = '#59636b') {
  const parts = [];
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 3));
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    parts.push({ geo: G.cylinder(0.035, 0.035, h, 6, { y0: true }), matrix: T(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t), color: col(color) });
  }
  for (const y of [h - 0.02, 0.15]) {
    parts.push({ geo: G.tube([[x0, y, z0], [x1, y, z1]], 0.025, 5), color: col(color) });
  }
  return parts;
}
export function fenceMesh(x0, z0, x1, z1, h = 3.6) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = G.quad(len, h, { bottom: true });
  for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] *= len / 1.2; g.uv[i + 1] *= h / 1.2; }
  const yaw = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
  return { geo: g, matrix: T((x0 + x1) / 2, 0, (z0 + z1) / 2, yaw) };
}

export function bleacher(x, z, yaw, w = 8, rows = 4, color = '#7d8790', seat = '#b0b8bf') {
  const parts = [];
  for (let r = 0; r < rows; r++) {
    parts.push({ geo: G.box(w, 0.06, 0.32), matrix: M.m4mul(M.m4(), T(x, 0, z, yaw), T(0, 0.45 + r * 0.42, -r * 0.62)), color: col(seat) });
    parts.push({ geo: G.box(w, 0.05, 0.28), matrix: M.m4mul(M.m4(), T(x, 0, z, yaw), T(0, 0.12 + r * 0.42, -r * 0.62 + 0.3)), color: col(color) });
  }
  for (const sx of [-w / 2, 0, w / 2]) parts.push({ geo: G.box(0.08, 0.45 + rows * 0.42, 0.08), matrix: M.m4mul(M.m4(), T(x, 0, z, yaw), T(sx, (0.45 + rows * 0.42) / 2, -(rows - 1) * 0.62)), color: col(color) });
  return parts;
}

export function building(x, z, w, d, h, yaw = 0) {
  const g = G.box(w, h, d);
  // UVs scaled by size so facade texture tiles per ~6x8m
  const tiles = [w / 6, h / 8];
  for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] *= tiles[0]; g.uv[i + 1] *= tiles[1]; }
  return { geo: g, matrix: T(x, h / 2, z, yaw) };
}

export function trashCan(x, z, color = '#2f4f45') {
  return [{ geo: G.cylinder(0.3, 0.27, 0.95, 12, { y0: true }), matrix: T(x, 0, z), color: col(color) }, { geo: G.cylinder(0.33, 0.33, 0.05, 12, { y0: true }), matrix: T(x, 0.95, z), color: col('#22262a') }];
}

export function ballRack(x, z, yaw) {
  const parts = [{ geo: G.box(1.4, 0.05, 0.4), matrix: T(x, 0.55, z, yaw), color: col('#2c3237') }, { geo: G.box(1.4, 0.05, 0.4), matrix: T(x, 0.95, z, yaw), color: col('#2c3237') }];
  for (const sx of [-0.68, 0.68]) parts.push({ geo: G.box(0.05, 1.0, 0.4), matrix: M.m4mul(M.m4(), T(x, 0.5, z, yaw), T(sx, 0, 0)), color: col('#2c3237') });
  return parts;
}

// v0.4.2 Daily Spin prize wheel (face points +z). Returns {meshes, update(dt), spinTo(segment)}.
export function prizeWheel(ctx, x, z, accent = '#ffd84a') {
  const segs = ['vc500', 'gear', 'vc2500', 'vc10000', 'anim', 'vc500', 'vc50000', 'gear', 'vc2500', 'anim', 'vc10000', 'vc250000'];
  const c = document.createElement('canvas'); c.width = c.height = 512;
  drawWheel(c.getContext('2d'), 512, segs, accent);
  const faceMat = new Material({ map: ctx.texture(c, { aniso: 8 }), shading: 'unlit', color: [1.25, 1.25, 1.25], alphaTest: 0.5, doubleSided: false, fog: false });
  const frameMat = new Material({ color: M.hexLinear('#2a2e33'), roughness: 0.5, metalness: 0.4 });
  const goldMat = new Material({ color: M.hexLinear(accent), roughness: 0.35, metalness: 0.7 });
  const cy = 2.35, R = 1.45;
  const meshes = [];
  const parts = [
    { geo: G.box(3.2, 0.3, 1.2), matrix: T(x, 0.15, z) },
    { geo: G.box(0.22, cy, 0.22), matrix: T(x - 1.05, cy / 2, z - 0.25) },
    { geo: G.box(0.22, cy, 0.22), matrix: T(x + 1.05, cy / 2, z - 0.25) },
    { geo: G.box(2.3, 0.2, 0.22), matrix: T(x, cy, z - 0.25) },
  ];
  const frame = new Mesh(ctx.geometry(G.merge(parts, false)), frameMat);
  meshes.push(frame);
  const ringGeo = G.torus(R + 0.03, 0.06, 48, 8);
  const ring = new Mesh(ctx.geometry(ringGeo), goldMat);
  M.m4compose(ring.matrix, [x, cy, z + 0.02], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2));
  meshes.push(ring);
  const face = new Mesh(ctx.geometry(G.quad(R * 2, R * 2)), faceMat, { castShadow: false });
  meshes.push(face);
  const pointer = new Mesh(ctx.geometry(G.box(0.16, 0.34, 0.1)), goldMat);
  M.m4compose(pointer.matrix, [x, cy + R + 0.1, z + 0.08], M.qaxis(M.q4(), 0, 0, 1, Math.PI / 4));
  meshes.push(pointer);
  let ang = 0, from = 0, to = 0, t = 1, dur = 1, idle = 0;
  const q = M.q4();
  const place = () => M.m4compose(face.matrix, [x, cy, z + 0.06], M.qaxis(q, 0, 0, 1, -ang));
  place();
  return {
    meshes, segments: segs,
    update(dt) {
      if (t < 1) { t = Math.min(1, t + dt / dur); const e = 1 - Math.pow(1 - t, 3.2); ang = from + (to - from) * e; idle = 0; }
      else { idle += dt; if (idle > 12) ang += dt * 0.12; }
      place();
    },
    spinTo(i, seconds = 4.2) {
      const step = Math.PI * 2 / segs.length;
      from = ang % (Math.PI * 2); const base = Math.ceil(from / (Math.PI * 2)) * Math.PI * 2;
      to = base + 5 * Math.PI * 2 + ((Math.PI * 2 - i * step) % (Math.PI * 2)); t = 0; dur = seconds;
    },
  };
}

export function kiosk(x, z, yaw, color = '#e0482f') {
  return [
    { geo: G.box(4, 2.8, 2.6), matrix: T(x, 1.4, z, yaw), color: col('#2a2e33') },
    { geo: G.box(4.6, 0.25, 3.4), matrix: T(x, 2.95, z, yaw), color: col(color) },
    { geo: G.box(3.6, 1.0, 0.1), matrix: M.m4mul(M.m4(), T(x, 0, z, yaw), T(0, 0.5, 1.32)), color: col('#3a3f45') },
  ];
}

// low-poly crowd figure (for instancing)
export function crowdPerson() {
  return G.merge([
    { geo: G.cylinder(0.16, 0.2, 0.62, 6, { y0: true, open: true }), matrix: T(0, 0.0, 0) },
    { geo: G.sphere(0.11, 6, 5), matrix: T(0, 0.75, 0) },
    { geo: G.box(0.44, 0.12, 0.2), matrix: T(0, 0.56, 0) },
    { geo: G.box(0.09, 0.42, 0.09), matrix: T(0.2, 0.3, 0.06) },
    { geo: G.box(0.09, 0.42, 0.09), matrix: T(-0.2, 0.3, 0.06) },
  ], false);
}

export function streetLamp(x, z, h = 5.5) {
  return [
    { geo: G.cylinder(0.06, 0.09, h, 8, { y0: true }), matrix: T(x, 0, z), color: col('#25292d') },
    { geo: G.sphere(0.22, 10, 8), matrix: T(x, h + 0.1, z), color: col('#25292d') },
  ];
}
