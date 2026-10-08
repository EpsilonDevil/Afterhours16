// Prop geometry builders. Each returns parts [{geo, matrix, color}] for batching with G.merge().
import * as G from '../gfx/geometry.js';
import * as M from '../core/math.js';
import { RNG } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { drawWheel } from './wheelart.js';

const T = (x, y, z, yaw = 0, s = 1) => M.m4fromYaw(M.m4(), x, y, z, yaw, s);
const col = hex => [...M.hexLinear(hex), 1];
const TS = (x, y, z, sx, sy, sz, yaw = 0) => { const m = M.m4fromYaw(M.m4(), x, y, z, yaw); const sc = M.m4(); sc[0] = sx; sc[5] = sy; sc[10] = sz; return M.m4mul(M.m4(), m, sc); };

// v0.4.5: slatted park bench (separate boards with gaps, armrests, angled back) instead of two slabs
export function bench(x, z, yaw, wood = '#9a6b42', metal = '#30363b') {
  const at = (dx, dy, dz) => M.m4mul(M.m4(), T(x, 0, z, yaw), T(dx, dy, dz));
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push({ geo: G.box(2.2, 0.05, 0.12), matrix: at(0, 0.46, -0.14 + i * 0.14), color: col(wood) });
  for (let i = 0; i < 3; i++) parts.push({ geo: G.box(2.2, 0.11, 0.045), matrix: at(0, 0.6 + i * 0.13, -0.23 - i * 0.035), color: col(wood) });
  for (const sx of [-1, 1]) {
    parts.push({ geo: G.box(0.07, 0.46, 0.08), matrix: at(sx * 0.95, 0.23, 0.12), color: col(metal) });
    parts.push({ geo: G.box(0.07, 0.46, 0.08), matrix: at(sx * 0.95, 0.23, -0.2), color: col(metal) });
    parts.push({ geo: G.box(0.07, 0.06, 0.52), matrix: at(sx * 0.95, 0.44, -0.05), color: col(metal) });   // seat rail
    parts.push({ geo: G.box(0.06, 0.05, 0.42), matrix: at(sx * 1.02, 0.78, -0.08), color: col(metal) });   // armrest
    parts.push({ geo: G.box(0.06, 0.3, 0.05), matrix: at(sx * 1.02, 0.62, 0.1), color: col(metal) });      // armrest post
  }
  return parts;
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

// v0.4.5: a real tree instead of a pole with five balls on it — a tapered, leaning trunk, three or four
// branches that actually reach into the canopy, and a layered canopy whose clumps sit on those branches and
// shade from dark underneath to sunlit on top.
export function tree(x, z, s = 1, rng = new RNG(1), leaf = '#3f6b3a', trunk = '#5a4330') {
  const parts = [];
  const H = (3.2 + rng.next() * 1.1) * s;
  const lean = rng.range(-0.25, 0.25), leanZ = rng.range(-0.25, 0.25);
  const at = t => [x + lean * t * t, H * t, z + leanZ * t * t];
  const path = []; for (let i = 0; i <= 7; i++) path.push(at(i / 7));
  parts.push({ geo: G.tube(path, t => (0.2 - 0.12 * t) * s, 9), color: col(trunk) });
  // root flare
  parts.push({ geo: G.cylinder(0.3 * s, 0.17 * s, 0.34 * s, 9, { y0: true }), matrix: T(x, 0, z), color: col(trunk) });
  const base = M.hexLinear(leaf);
  const clumps = [];
  const nb = 3 + (rng.next() < 0.5 ? 1 : 0);
  for (let b = 0; b < nb; b++) {
    const a = b / nb * Math.PI * 2 + rng.range(0, 0.8);
    const t0 = 0.62 + rng.range(0, 0.16), from = at(t0);
    const reach = (0.75 + rng.next() * 0.6) * s, rise = (0.8 + rng.next() * 0.7) * s;
    const bp = [from, [from[0] + Math.sin(a) * reach * 0.45, from[1] + rise * 0.55, from[2] + Math.cos(a) * reach * 0.45],
      [from[0] + Math.sin(a) * reach, from[1] + rise, from[2] + Math.cos(a) * reach]];
    parts.push({ geo: G.tube(bp, t => (0.085 - 0.045 * t) * s, 6), color: col(trunk) });
    clumps.push([bp[2][0], bp[2][1], bp[2][2], (0.72 + rng.next() * 0.42) * s]);
  }
  clumps.push([at(1)[0], H + 0.35 * s, at(1)[2], (0.95 + rng.next() * 0.3) * s]);
  for (const [cx, cy, cz, r] of clumps) {
    // two or three overlapping lobes per clump so the silhouette isn't a sphere
    const n = 2 + (rng.next() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const ox = rng.range(-0.45, 0.45) * r, oy = rng.range(-0.3, 0.35) * r, oz = rng.range(-0.45, 0.45) * r;
      const rr = r * (0.62 + rng.next() * 0.42);
      const shade = 0.62 + 0.5 * Math.max(0, (oy + rr * 0.5) / r) + rng.range(-0.06, 0.06);
      parts.push({ geo: G.sphere(rr, 9, 7), matrix: T(cx + ox, cy + oy, cz + oz), color: [...base.map(v => v * shade), 1] });
    }
  }
  return parts;
}

// v0.4.5: the palm gets a ringed, thickening trunk, a crown shaft, fronds that arch up before they droop
// (each with a visible midrib), and a cluster of coconuts.
export function palm(x, z, s = 1, rng = new RNG(2)) {
  const parts = [];
  const h = (6 + rng.next() * 3) * s;
  const lean = rng.range(-0.4, 0.4), leanZ = rng.range(-0.3, 0.3);
  const path = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; path.push([x + lean * t * t * 2, h * t, z + leanZ * t * t * 2]); }
  parts.push({ geo: G.tube(path, t => 0.2 * s * (1 - t * 0.42), 9), color: col('#7d6447') });
  // trunk rings (old frond scars)
  for (let i = 1; i < 9; i++) {
    const t = i / 10, p = path[i];
    parts.push({ geo: G.cylinder(0.205 * s * (1 - t * 0.42), 0.205 * s * (1 - t * 0.42), 0.07 * s, 9, { y0: true }), matrix: T(p[0], p[1], p[2]), color: col(i % 2 ? '#6d573c' : '#8a7152') });
  }
  const top = path[path.length - 1];
  parts.push({ geo: G.cylinder(0.2 * s, 0.1 * s, 0.5 * s, 9, { y0: true }), matrix: T(top[0], top[1] - 0.1 * s, top[2]), color: col('#5f7a42') });
  const nf = 11;
  for (let k = 0; k < nf; k++) {
    const a = k / nf * Math.PI * 2 + rng.range(0, 0.25);
    const L = (2.7 + rng.next() * 0.9) * s, up = (0.55 + rng.next() * 0.35) * s;
    const fr = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      // arch: rises first, then droops away
      const y = top[1] + 0.3 * s + up * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.55) - t * t * t * 2.3 * s;
      fr.push([top[0] + Math.sin(a) * L * t, y, top[2] + Math.cos(a) * L * t]);
    }
    const green = k % 3 === 0 ? '#366c37' : k % 3 === 1 ? '#4f8a42' : '#5f9a4a';
    // blade, then a thin midrib along it so the frond reads as a leaf and not a tube
    parts.push({ geo: G.tube(fr, t => 0.3 * s * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) + 0.015, 5), color: col(green) });
    parts.push({ geo: G.tube(fr, t => 0.045 * s * (1 - t * 0.6), 4), color: col('#6f8a3e') });
  }
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2;
    parts.push({ geo: G.sphere(0.13 * s, 7, 6), matrix: T(top[0] + Math.sin(a) * 0.22 * s, top[1] - 0.2 * s, top[2] + Math.cos(a) * 0.22 * s), color: col('#6b5a32') });
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

// v0.4.5: a slatted park bin on a base with a domed lid and an opening, not a plain drum
export function trashCan(x, z, color = '#2f4f45') {
  const parts = [
    { geo: G.cylinder(0.34, 0.31, 0.08, 14, { y0: true }), matrix: T(x, 0, z), color: col('#22262a') },
    { geo: G.cylinder(0.29, 0.26, 0.82, 14, { y0: true }), matrix: T(x, 0.08, z), color: col(color) },
  ];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    parts.push({ geo: G.box(0.05, 0.78, 0.05), matrix: T(x + Math.sin(a) * 0.295, 0.1, z + Math.cos(a) * 0.295), color: col('#22262a') });
  }
  parts.push(
    { geo: G.cylinder(0.33, 0.33, 0.06, 14, { y0: true }), matrix: T(x, 0.88, z), color: col('#22262a') },
    { geo: G.cylinder(0.3, 0.16, 0.16, 14, { y0: true }), matrix: T(x, 0.94, z), color: col('#2b3034') },
    { geo: G.sphere(0.11, 9, 7), matrix: T(x, 1.12, z), color: col('#2b3034') },
  );
  return parts;
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

// v0.4.5: the kiosks became real shops. A walled unit with a wide serving window on each side, a striped
// awning, a lit interior with a counter, back shelves stocked with goods, and a worker standing behind the
// counter. `kind` dresses the inside: 'store' (apparel and shoe boxes) or 'boost' (bottles and crates).
export function kiosk(x, z, yaw, color = '#e0482f', kind = 'store', rng = new RNG(7)) {
  const parts = [];
  const W = 5.2, D = 3.4, Hh = 3.2, t = 0.18;
  const put = (geo, dx, dy, dz, c) => parts.push({ geo, matrix: M.m4mul(M.m4(), T(x, 0, z, yaw), T(dx, dy, dz)), color: col(c) });
  const wall = '#e8e2d6', dark = '#2a2e33';
  // floor, ceiling, back/side walls (the two long sides are open above the counter)
  put(G.box(W, 0.12, D), 0, 0.06, 0, '#cfc7b8');
  put(G.box(W + 0.5, 0.22, D + 0.5), 0, Hh, 0, dark);
  put(G.box(t, Hh, D), -W / 2 + t / 2, Hh / 2, 0, wall);
  put(G.box(t, Hh, D), W / 2 - t / 2, Hh / 2, 0, wall);
  // front and back: a knee wall with a counter, then a header above the opening
  for (const sz of [1, -1]) {
    put(G.box(W - t * 2, 1.05, t), 0, 0.52, sz * (D / 2 - t / 2), wall);
    put(G.box(W - t * 2 + 0.3, 0.1, 0.5), 0, 1.1, sz * (D / 2 - 0.1), '#8a6f4e');      // counter top
    put(G.box(W - t * 2, 0.9, t), 0, Hh - 0.45, sz * (D / 2 - t / 2), wall);            // header
    // awning: three stripes stepping down and out
    for (let i = 0; i < 3; i++) put(G.box((W + 0.6) / 3 - 0.02, 0.1, 1.15), (i - 1) * (W + 0.6) / 3, Hh - 0.3 - i * 0.0, sz * (D / 2 + 0.5), i % 2 ? '#f4f1ea' : color);
    put(G.box(W + 0.6, 0.26, 0.12), 0, Hh - 0.42, sz * (D / 2 + 1.03), color);          // awning valance
  }
  // interior: back shelving, goods, a till and a stool
  const goods = kind === 'boost'
    ? ['#7ff0b8', '#2f8f6b', '#f2c14e', '#9fe0ff', '#e05a2f']
    : ['#e0482f', '#f2c14e', '#3b6fb5', '#f4f1ea', '#1d2328', '#ef7d3c'];
  for (let shelf = 0; shelf < 3; shelf++) {
    const sy = 0.75 + shelf * 0.72;
    put(G.box(W - 0.9, 0.07, 0.42), 0, sy, -0.2, '#6d5a42');
    for (let i = 0; i < 7; i++) {
      const bw = kind === 'boost' ? 0.16 : 0.34, bh = kind === 'boost' ? 0.3 : 0.22;
      const gx = -(W - 1.5) / 2 + i * ((W - 1.5) / 6);
      if (kind === 'boost') put(G.cylinder(bw / 2, bw / 2, bh, 7, { y0: true }), gx, sy + 0.035, -0.2, goods[(i + shelf) % goods.length]);
      else put(G.box(bw, bh, 0.3), gx, sy + 0.035 + bh / 2, -0.2, goods[(i + shelf * 2) % goods.length]);
    }
  }
  put(G.box(0.42, 0.26, 0.3), W / 2 - 1.2, 1.28, D / 2 - 0.45, '#1d2328'); // till
  put(G.box(1.1, 0.08, 0.5), -W / 2 + 1.1, 1.18, D / 2 - 0.5, '#f4f1ea');  // folded goods on the counter
  put(G.box(1.0, 0.1, 0.44), -W / 2 + 1.1, 1.3, D / 2 - 0.5, goods[1]);
  // the worker behind the counter, facing the front window
  const skin = ['#8d5a36', '#5d3a22', '#c69c73', '#3f2a1c'][rng.int(0, 3)];
  const shirt = kind === 'boost' ? '#2f8f6b' : color;
  put(G.cylinder(0.19, 0.22, 0.72, 8, { y0: true }), 0.5, 0.62, -0.5, shirt);
  put(G.box(0.52, 0.14, 0.22), 0.5, 1.22, -0.5, shirt);
  put(G.cylinder(0.07, 0.07, 0.5, 6, { y0: true }), 0.82, 0.86, -0.42, skin);
  put(G.cylinder(0.07, 0.07, 0.5, 6, { y0: true }), 0.18, 0.86, -0.42, skin);
  put(G.sphere(0.13, 8, 7), 0.5, 1.48, -0.5, skin);
  put(G.cylinder(0.15, 0.15, 0.08, 8, { y0: true }), 0.5, 1.55, -0.5, '#1d2328'); // cap
  return parts;
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

// v0.4.5: a real park lamp — a fluted base, a tapered column, a curved arm and a lantern head with a glass
// bowl and a finial (the old one was a pole with a ball on top).
export function streetLamp(x, z, h = 5.5, color = '#25292d') {
  const parts = [
    { geo: G.cylinder(0.17, 0.13, 0.32, 10, { y0: true }), matrix: T(x, 0, z), color: col(color) },
    { geo: G.cylinder(0.12, 0.095, 0.18, 10, { y0: true }), matrix: T(x, 0.32, z), color: col(color) },
    { geo: G.cylinder(0.075, 0.055, h - 0.5, 9, { y0: true }), matrix: T(x, 0.5, z), color: col(color) },
    { geo: G.cylinder(0.1, 0.1, 0.1, 9, { y0: true }), matrix: T(x, h - 0.3, z), color: col(color) },
  ];
  // arm: a quarter arc out and up to the lantern
  const arm = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; arm.push([x + Math.sin(t * Math.PI / 2) * 0.5, h - 0.2 + (1 - Math.cos(t * Math.PI / 2)) * 0.42, z]); }
  parts.push({ geo: G.tube(arm, 0.045, 7), color: col(color) });
  const lx = x + 0.5, ly = h + 0.22;
  parts.push(
    { geo: G.cylinder(0.1, 0.19, 0.34, 8, { y0: true }), matrix: T(lx, ly - 0.34, z), color: col('#fdf0cf') }, // glass bowl
    { geo: G.cylinder(0.21, 0.05, 0.22, 8, { y0: true }), matrix: T(lx, ly, z), color: col(color) },           // hood
    { geo: G.sphere(0.05, 7, 6), matrix: T(lx, ly + 0.26, z), color: col(color) },                             // finial
  );
  return parts;
}

// v0.4.5 Crews: the Crew HQ storefront on every park's plaza. A low brick-and-steel clubhouse with a glass
// double door in the north face (toward the courts), a crew-colored awning and lit windows. Returns
// { parts, glow }: glow pieces are the lit windows and the light strip over the door (batched unlit).
export const HQ_SIZE = { w: 7, d: 4.2, h: 4.4 };
export function crewHQ(x, z, color = '#e0482f') {
  const parts = [], glow = [];
  const { w: W, d: D, h: Hh } = HQ_SIZE, t = 0.22;
  const put = (geo, dx, dy, dz, c, out = parts) => out.push({ geo, matrix: T(x + dx, dy, z + dz), color: col(c) });
  const brick = '#5b3a33', trim = '#22262b', glass = '#1c2a33';
  // shell: back and side walls, roof slab with a parapet, a plinth all round
  put(G.box(W, Hh, t), 0, Hh / 2, -D / 2 + t / 2, brick);
  for (const sx of [-1, 1]) put(G.box(t, Hh, D), sx * (W / 2 - t / 2), Hh / 2, 0, brick);
  put(G.box(W + 0.3, 0.3, D + 0.3), 0, Hh + 0.15, 0, trim);
  for (const sz of [-1, 1]) put(G.box(W + 0.3, 0.5, 0.14), 0, Hh + 0.55, sz * (D / 2 + 0.08), trim);
  for (const sx of [-1, 1]) put(G.box(0.14, 0.5, D + 0.3), sx * (W / 2 + 0.08), Hh + 0.55, 0, trim);
  put(G.box(W + 0.12, 0.35, D + 0.12), 0, 0.175, 0, '#3a3f45');
  // front: brick piers either side of the door, a header over it, glass doors in a steel frame
  const door = 2.2, fz = D / 2 - t / 2;
  for (const sx of [-1, 1]) put(G.box((W - door) / 2, Hh, t), sx * (door / 2 + (W - door) / 4), Hh / 2, fz, brick);
  put(G.box(door, Hh - 2.7, t), 0, 2.7 + (Hh - 2.7) / 2, fz, brick);
  put(G.box(door, 2.7, 0.06), 0, 1.35, fz - 0.02, glass);
  for (const dx of [-door / 2, 0, door / 2]) put(G.box(0.1, 2.7, 0.12), dx, 1.35, fz + 0.02, trim);
  put(G.box(door + 0.1, 0.1, 0.12), 0, 2.7, fz + 0.02, trim);
  for (const dx of [-0.18, 0.18]) put(G.box(0.04, 0.7, 0.06), dx, 1.2, fz + 0.1, '#c9cdd2'); // door pulls
  // awning in crew color over the door, on two steel brackets
  put(G.box(door + 1.2, 0.12, 1.3), 0, 3.05, D / 2 + 0.65, color);
  put(G.box(door + 1.2, 0.3, 0.08), 0, 2.92, D / 2 + 1.3, color);
  for (const sx of [-1, 1]) put(G.box(0.06, 0.06, 1.3), sx * (door / 2 + 0.5), 2.95, D / 2 + 0.65, trim);
  // windows either side: lit from inside, steel mullions over them
  for (const sx of [-1, 1]) {
    const wx = sx * (door / 2 + (W - door) / 4);
    put(G.box(1.5, 1.3, 0.04), wx, 1.85, D / 2 + 0.005, '#ffd9a0', glow);
    put(G.box(1.62, 0.08, 0.1), wx, 2.52, D / 2 + 0.03, trim);
    put(G.box(1.62, 0.08, 0.1), wx, 1.18, D / 2 + 0.03, trim);
    put(G.box(0.06, 1.3, 0.1), wx, 1.85, D / 2 + 0.03, trim);
  }
  // a light strip under the awning and a little light in each window's frame
  put(G.box(door + 0.8, 0.04, 0.1), 0, 2.98, D / 2 + 1.2, '#fff2d6', glow);
  return { parts, glow };
}

// v0.4.5 Crew HQ lounge furniture: a three-seat couch (seat, back, arms, cushions) facing +z before yaw
export function couch(x, z, yaw, color = '#3a3f47', w = 2.4) {
  const parts = [];
  const put = (geo, dx, dy, dz, c) => parts.push({ geo, matrix: M.m4mul(M.m4(), T(x, 0, z, yaw), T(dx, dy, dz)), color: col(c) });
  put(G.box(w, 0.38, 0.95), 0, 0.19, 0, color);
  put(G.box(w, 0.62, 0.24), 0, 0.69, -0.36, color);
  for (const sx of [-1, 1]) put(G.box(0.22, 0.62, 0.95), sx * (w / 2 + 0.11), 0.31, 0, color);
  const n = Math.max(2, Math.round(w / 0.8));
  for (let i = 0; i < n; i++) put(G.box(w / n - 0.04, 0.1, 0.7), -w / 2 + (i + 0.5) * w / n, 0.43, 0.1, '#4a505a');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(G.box(0.06, 0.06, 0.06), sx * (w / 2 + 0.1), 0.03, sz * 0.4, '#15171a');
  return parts;
}
