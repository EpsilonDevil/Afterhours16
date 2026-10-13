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

// v0.4.8.5: one pinnate palm frond: a blade folded down along its midrib (a Λ section, both faces built so it reads
// from above and below), with zigzag edges for the leaflet tips. Arches up out of the crown, then droops; droop
// sets how hard it falls away (dead fronds hang almost straight down). Returns a part for G.merge.
export function palmFrond(top, a, L, up, droop, w, color, steps = 14, serrate = true) {
  const pos = [], idx = [];
  const sx = Math.sin(a), sz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
  const sec = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = top[1] + up * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.55) - t * t * t * droop;
    const cx = top[0] + sx * L * t * (1 - t * t * droop * 0.06), cz = top[2] + sz * L * t * (1 - t * t * droop * 0.06);
    let wd = w * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.06)) + 0.01;
    if (serrate && i % 2) wd *= 0.5;
    const fold = 0.35 + t * 0.5; // the leaflets hang lower toward the tip
    sec.push([[cx - rx * wd, y - fold * wd, cz - rz * wd], [cx, y + 0.02, cz], [cx + rx * wd, y - fold * wd, cz + rz * wd], [cx, y - 0.02, cz]]);
  }
  // top face: L, Ctop, R (3 verts a section); bottom face: L, Cbot, R
  const topB = 0; for (const s of sec) pos.push(...s[0], ...s[1], ...s[2]);
  const botB = pos.length / 3; for (const s of sec) pos.push(...s[0], ...s[3], ...s[2]);
  for (let i = 0; i < steps; i++) {
    const a0 = topB + i * 3, a1 = a0 + 3, b0 = botB + i * 3, b1 = b0 + 3;
    // (winding: the top face's normals point up, the bottom's down; checked in tests/v0485parks)
    idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1, a0 + 1, a1 + 1, a0 + 2, a0 + 2, a1 + 1, a1 + 2);
    idx.push(b0, b0 + 1, b1, b0 + 1, b1 + 1, b1, b0 + 1, b0 + 2, b1 + 1, b0 + 2, b1 + 2, b1 + 1);
  }
  const g = { position: new Float32Array(pos), normal: new Float32Array(pos.length), uv: new Float32Array(pos.length / 3 * 2), index: new Uint16Array(idx) };
  G.computeNormals(g);
  return { geo: g, color: col(color) };
}

// v0.4.8.5: the Harbor Point palm (palm() with opts): a ridged trunk banded light and dark (vertex colours along one
// tube, so a leaning trunk keeps its rings square to it), leaning over and turning back up at the top (opts.lean =
// [x, z] metres of lean), opts.height metres tall, pinnate fronds, a few dead ones hanging under the crown, and
// opts.coconuts nuts. opts.mid / opts.lite: cheaper versions for the rows past the fences and the far groves.
function palmLeaning(x, z, s, rng, o) {
  const parts = [], lite = !!o.lite, mid = !!o.mid; // (lite: the far groves; mid: in view but out past the fences)
  const h = (o.height ?? (6.5 + rng.next() * 4)) * s;
  const [lx, lz] = o.lean || [rng.range(-0.6, 0.6), rng.range(-0.6, 0.6)];
  const n = lite ? 5 : mid ? 8 : 12, path = [];
  for (let i = 0; i <= n; i++) { const t = i / n, k = 1.5 * t - 0.5 * t * t; path.push([x + lx * k, h * t, z + lz * k]); }
  const seg = lite ? 5 : mid ? 6 : 7;
  const trunk = G.tube(path, t => 0.21 * s * (1 - t * 0.38) * (lite ? 1 : 1 + 0.07 * ((Math.round(t * n) % 2) ? 1 : -1)), seg);
  const ca = col('#7d6447'), cb = col('#5f4c35'), cTop = col('#8f7a58');
  trunk.color = new Float32Array(trunk.position.length / 3 * 4);
  for (let k = 0; k <= n; k++) for (let i = 0; i <= seg; i++) trunk.color.set(k > n - 2 ? cTop : k % 2 ? cb : ca, (k * (seg + 1) + i) * 4);
  parts.push({ geo: trunk });
  const top = path[n];
  // crown shaft and the leaf bases round it
  parts.push({ geo: G.cylinder(0.19 * s, 0.13 * s, 0.6 * s, seg, { y0: true, open: true }), matrix: T(top[0], top[1] - 0.2 * s, top[2]), color: col('#6f7d45') });
  const nf = o.fronds ?? (lite ? 7 : mid ? 9 : 11);
  const greens = o.greens || ['#3f7a3a', '#4f8a42', '#5f9a4a', '#4a8240'];
  for (let k = 0; k < nf; k++) {
    const a = k / nf * Math.PI * 2 + rng.range(0, 0.35);
    const L = (2.8 + rng.next() * 1.1) * s, up = (0.5 + rng.next() * 0.45) * s, droop = (1.6 + rng.next() * 1.3) * s;
    parts.push(palmFrond([top[0], top[1] + 0.32 * s, top[2]], a, L, up, droop, 0.42 * s, rng.pick(greens), lite ? 5 : mid ? 6 : 8, !lite));
  }
  if (!lite && !mid) for (let k = 0; k < (o.dead ?? rng.int(1, 3)); k++) {
    const a = rng.range(0, Math.PI * 2);
    parts.push(palmFrond([top[0], top[1] + 0.05 * s, top[2]], a, (1.6 + rng.next() * 0.6) * s, 0.05 * s, (2.6 + rng.next()) * s, 0.3 * s, rng.pick(['#8a6f45', '#9c8156', '#7a5f3a']), 6, true));
  }
  const nc = o.coconuts ?? (lite ? 0 : mid ? 3 : rng.int(3, 6));
  for (let k = 0; k < nc; k++) {
    const a = k / nc * Math.PI * 2 + rng.range(0, 0.5), rr = (0.2 + rng.next() * 0.08) * s;
    parts.push({ geo: G.sphere(0.13 * s, 5, 4), matrix: T(top[0] + Math.sin(a) * rr, top[1] - (0.12 + rng.next() * 0.15) * s, top[2] + Math.cos(a) * rr), color: col(rng.pick(['#6b5a32', '#7a6a38', '#5f6b30'])) });
  }
  return parts;
}

// v0.4.5: the palm gets a ringed, thickening trunk, a crown shaft, fronds that arch up before they droop
// (each with a visible midrib), and a cluster of coconuts.
// v0.4.8.5: palm(x, z, s, rng, opts) with opts builds the leaning beach palm (palmLeaning); without, as before.
export function palm(x, z, s = 1, rng = new RNG(2), opts = null) {
  if (opts) return palmLeaning(x, z, s, rng, opts);
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

// v0.4.8.5: bake parts' matrices into their geometry with correct normals before G.merge. (G.merge transforms
// normals with M.m3normalFromM4, which returns the inverse rotation rather than the inverse transpose: a part turned
// by a yaw of 90 degrees gets its side normals mirrored, so it is lit from the wrong side. The v0.4.8.5 scenery bakes
// its own pieces here; the normal matrix is (A^-1)^T, whose columns are the cross products of A's columns.)
export function bake(parts) {
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return parts.map(p => {
    if (!p.matrix) return p;
    const m = p.matrix, g = G.clone(p.geo), pos = g.position, nrm = g.normal;
    const c0 = [m[0], m[1], m[2]], c1 = [m[4], m[5], m[6]], c2 = [m[8], m[9], m[10]], n0 = cr(c1, c2), n1 = cr(c2, c0), n2 = cr(c0, c1);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12]; pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      const a = nrm[i], b = nrm[i + 1], c = nrm[i + 2];
      const nx = n0[0] * a + n1[0] * b + n2[0] * c, ny = n0[1] * a + n1[1] * b + n2[1] * c, nz = n0[2] * a + n1[2] * b + n2[2] * c, l = Math.hypot(nx, ny, nz) || 1;
      nrm[i] = nx / l; nrm[i + 1] = ny / l; nrm[i + 2] = nz / l;
    }
    return { geo: g, color: p.color };
  });
}

// ---------------- v0.4.8.5 street vehicles (the Old Brick Yard) ----------------
// All face +z with the wheels on the ground. Bodies are parts for G.merge; carLights() gives the lamps as vertex
// coloured parts for one unlit mesh (white heads, red tails, plus extras such as a taxi's roof sign).
const wheel = (x, z, r = 0.33, w = 0.24) => {
  const m = M.m4mul(M.m4(), T(x, r, z), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, Math.PI / 2)));
  return [{ geo: G.cylinder(r, r, w, 9), matrix: m, color: col('#111214') }, { geo: G.cylinder(r * 0.55, r * 0.55, w + 0.02, 6), matrix: m, color: col('#6a6d70') }];
};
export function car(paint = '#7a1f1c', o = {}) {
  const L = 4.4, p = [], glass = o.glass || '#121820';
  const body = o.body || (() => [{ geo: G.box(1.8, 0.5, L), matrix: T(0, 0.55, 0), color: col(paint) }]);
  p.push(...body());
  p.push({ geo: G.box(1.74, 0.12, 1.25), matrix: T(0, 0.86, 1.5), color: col(o.hood || paint) });      // hood
  p.push({ geo: G.box(1.74, 0.1, 0.9), matrix: T(0, 0.85, -1.7), color: col(o.hood || paint) });       // trunk lid
  p.push({ geo: G.box(1.6, 0.52, 2.1), matrix: T(0, 1.06, -0.15), color: col(glass) });               // the glasshouse
  p.push({ geo: G.box(1.52, 0.07, 1.8), matrix: T(0, 1.355, -0.2), color: col(o.roof || paint) });    // roof
  for (const sx of [-1, 1]) {
    p.push({ geo: G.box(0.06, 0.5, 0.1), matrix: T(sx * 0.79, 1.06, 0.88), color: col(o.roof || paint) });   // A pillar
    p.push({ geo: G.box(0.06, 0.5, 0.12), matrix: T(sx * 0.79, 1.06, -1.18), color: col(o.roof || paint) }); // C pillar
    p.push({ geo: G.box(0.18, 0.1, 0.08), matrix: T(sx * 0.95, 0.98, 0.78), color: col(paint) });             // mirror
  }
  for (const sz of [-1, 1]) p.push({ geo: G.box(1.84, 0.18, 0.12), matrix: T(0, 0.42, sz * 2.22), color: col('#1a1b1d') });
  for (const [x, z] of [[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.35], [0.8, -1.35]]) p.push(...wheel(x, z));
  if (o.taxi) {
    p.push({ geo: G.box(0.9, 0.24, 0.32), matrix: T(0, 1.51, -0.1), color: col('#1d1d1d') });
    for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) p.push({ geo: G.box(0.02, 0.07, 0.25), matrix: T(sx * 0.905, 0.72, -1.0 + i * 0.25), color: col(i % 2 ? '#111111' : '#f0f0ea') });
  }
  return p;
}
export function carLights(L = 4.4, o = {}) {
  const p = [-0.62, 0.62].map(x => ({ geo: G.box(0.3, 0.13, 0.04), matrix: T(x, 0.72, L / 2 + 0.01), color: [1, 0.95, 0.82, 1] }));
  p.push(...[-0.64, 0.64].map(x => ({ geo: G.box(0.32, 0.12, 0.04), matrix: T(x, 0.78, -L / 2 - 0.01), color: [1, 0.06, 0.04, 1] })));
  if (o.taxi) p.push({ geo: G.box(0.86, 0.2, 0.34), matrix: T(0, 1.52, -0.1), color: [1, 0.85, 0.45, 1] });
  return p;
}
// a police cruiser: black front and back, white doors and roof, a push bar and the light bar's housing. The body is
// drawn with the door-panel texture (T.policeDoor): every part but the door panels samples its white corner, so
// vertex colours paint it. Returns {body, bar}: bar = the two lamp banks (red, blue) for their own flashing mesh.
export function cruiser() {
  const pin = parts => parts.map(q => { const g = G.clone(q.geo); for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] = 0.5; g.uv[i + 1] = 0.12; } return { ...q, geo: g }; });
  const body = car('#f2f2ee', {
    hood: '#121315', roof: '#f2f2ee',
    body: () => [
      { geo: G.box(1.8, 0.5, 1.45), matrix: T(0, 0.55, 1.475), color: col('#121315') },
      { geo: G.box(1.8, 0.5, 1.5), matrix: T(0, 0.55, 0), color: col('#f2f2ee') },
      { geo: G.box(1.8, 0.5, 1.45), matrix: T(0, 0.55, -1.475), color: col('#121315') },
    ],
  });
  body.push({ geo: G.box(1.5, 0.32, 0.08), matrix: T(0, 0.62, 2.34), color: col('#0c0c0d') });            // push bar
  for (const sx of [-0.5, 0.5]) body.push({ geo: G.box(0.08, 0.36, 0.2), matrix: T(sx, 0.62, 2.26), color: col('#0c0c0d') });
  body.push({ geo: G.box(1.34, 0.1, 0.34), matrix: T(0, 1.44, -0.25), color: col('#1c1d20') });           // light bar base
  body.push({ geo: G.box(0.04, 0.5, 0.04), matrix: T(-0.5, 1.6, -1.3), color: col('#1c1d20') });          // aerial
  const out = pin(body);
  // the door panels (POLICE over a stripe), one each side, facing out
  for (const sx of [-1, 1]) out.push({ geo: G.quad(1.48, 0.42), matrix: T(sx * 0.905, 0.6, 0, sx * Math.PI / 2), color: [1, 1, 1, 1] });
  const bar = [
    { geo: G.box(0.58, 0.12, 0.28), matrix: T(-0.33, 1.55, -0.25), color: [1, 0.04, 0.0, 1] },
    { geo: G.box(0.58, 0.12, 0.28), matrix: T(0.33, 1.55, -0.25), color: [0.0, 0.16, 1, 1] },
  ];
  return { body: out, bar };
}
// a city bus (11.5 m): two-tone body, a band of windows (lit inside: busLights), wheels; facing +z
export function bus(paint = '#2457a5') {
  const L = 11.5, p = [];
  p.push({ geo: G.box(2.5, 1.0, L), matrix: T(0, 0.85, 0), color: col(paint) });
  p.push({ geo: G.box(2.46, 1.05, L - 0.9), matrix: T(0, 1.88, -0.3), color: col('#111820') });
  p.push({ geo: G.box(2.5, 0.55, L), matrix: T(0, 2.68, 0), color: col('#e8e6e0') });
  p.push({ geo: G.box(2.3, 0.16, L - 0.8), matrix: T(0, 3.02, -0.2), color: col('#9a9c9e') });
  p.push({ geo: G.box(2.34, 1.25, 0.06), matrix: T(0, 1.9, L / 2 + 0.01), color: col('#111820') });   // windscreen
  for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) p.push({ geo: G.box(0.03, 1.05, 0.08), matrix: T(sx * 1.245, 1.88, -L / 2 + 1 + i * 1.55), color: col('#e8e6e0') }); // window posts
  for (const sz of [-1, 1]) p.push({ geo: G.box(2.54, 0.25, 0.14), matrix: T(0, 0.45, sz * (L / 2 + 0.04)), color: col('#1a1b1d') });
  for (const [x, z] of [[-1.05, 3.6], [1.05, 3.6], [-1.05, -3.4], [1.05, -3.4]]) p.push(...wheel(x, z, 0.5, 0.32));
  return p;
}
export function busLights() {
  const L = 11.5, p = carLights(L);
  for (const q of p) q.matrix[13] += 0.05;
  for (const sx of [-1, 1]) p.push({ geo: G.box(0.02, 0.82, L - 1.6), matrix: T(sx * 1.236, 1.92, -0.4), color: [0.15, 0.125, 0.09, 1] }); // the lit inside, through the windows
  p.push({ geo: G.box(1.7, 0.26, 0.04), matrix: T(0, 2.68, L / 2 + 0.03), color: [1, 0.55, 0.08, 1] }); // destination sign
  return p;
}

// Chain-link fence run between two points (posts + rails); mesh part separately (alpha texture)
// ---------------- v0.4.7.5 qp3 The Jungle Ballers ----------------
// A rainforest giant: a tall, slightly leaning trunk with buttress roots flaring at the base, a few big limbs
// high up, an umbrella of leaf clumps (dark under, lit on top) and lianas hanging off the limbs. s scales the
// whole thing; the trunk is 18-30 m at s = 1, so the canopy stands well over the light poles.
export function rainTree(x, z, s = 1, rng = new RNG(3), opts = {}) {
  const parts = [], leafA = opts.leaf || '#2f6b33', leafB = opts.leaf2 || '#4a8a3c', bark = opts.bark || '#4a3a2c';
  const H = (18 + rng.next() * 12) * s, lean = rng.range(-0.08, 0.08), leanZ = rng.range(-0.08, 0.08);
  const at = t => [x + lean * H * t * t, H * t, z + leanZ * H * t * t];
  const path = []; for (let i = 0; i <= 8; i++) path.push(at(i / 8));
  const R = (0.55 + rng.next() * 0.35) * s;
  parts.push({ geo: G.tube(path, t => R * (1.05 - 0.6 * t), 9), color: col(bark) });
  // buttress roots: tall thin wedges leaning out from the base
  const nr = 4 + rng.int(0, 3);
  for (let i = 0; i < nr; i++) {
    const a = i / nr * Math.PI * 2 + rng.range(0, 0.6), out = (1.6 + rng.next() * 1.4) * s, h = (2.2 + rng.next() * 1.8) * s;
    const rp = [[x + Math.sin(a) * R * 0.5, h, z + Math.cos(a) * R * 0.5], [x + Math.sin(a) * (R + out * 0.55), h * 0.35, z + Math.cos(a) * (R + out * 0.55)], [x + Math.sin(a) * (R + out), 0.05, z + Math.cos(a) * (R + out)]];
    parts.push({ geo: G.tube(rp, t => (0.32 - 0.14 * t) * s, 5), color: col(bark) });
  }
  // limbs from the upper trunk, each ending in a clump; the crown clump on top
  const clumps = [], nl = 3 + rng.int(0, 2);
  for (let b = 0; b < nl; b++) {
    const a = b / nl * Math.PI * 2 + rng.range(0, 1.0), t0 = 0.62 + rng.range(0, 0.2), from = at(t0);
    const reach = (4 + rng.next() * 4) * s, rise = (2 + rng.next() * 3) * s;
    const bp = [from, [from[0] + Math.sin(a) * reach * 0.5, from[1] + rise * 0.6, from[2] + Math.cos(a) * reach * 0.5], [from[0] + Math.sin(a) * reach, from[1] + rise, from[2] + Math.cos(a) * reach]];
    parts.push({ geo: G.tube(bp, t => (0.3 - 0.18 * t) * s, 6), color: col(bark) });
    clumps.push([bp[2][0], bp[2][1], bp[2][2], (3.2 + rng.next() * 1.8) * s]);
    // lianas: a vine or two hanging off the limb, swinging a little off the vertical
    if (rng.next() < 0.7) {
      const vx = bp[1][0] + rng.range(-0.5, 0.5), vz = bp[1][2] + rng.range(-0.5, 0.5), top = bp[1][1], len = (6 + rng.next() * 9) * s, sway = rng.range(-1.2, 1.2);
      const vp = []; for (let i = 0; i <= 5; i++) { const t = i / 5; vp.push([vx + sway * t * t, top - len * t, vz + sway * 0.6 * t]); }
      parts.push({ geo: G.tube(vp, t => (0.06 - 0.025 * t) * s, 4), color: col('#5a6a2a') });
    }
  }
  clumps.push([at(1)[0], H + 1.5 * s, at(1)[2], (4.5 + rng.next() * 2) * s]);
  const A = M.hexLinear(leafA), B = M.hexLinear(leafB);
  for (const [cx, cy, cz, r] of clumps) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const ox = rng.range(-0.5, 0.5) * r, oy = rng.range(-0.25, 0.3) * r, oz = rng.range(-0.5, 0.5) * r, rr = r * (0.6 + rng.next() * 0.45);
      const shade = 0.55 + 0.55 * Math.max(0, (oy + rr * 0.5) / r) + rng.range(-0.05, 0.05);
      const c = i % 2 ? A : B;
      // flattened lobes read as spreading foliage rather than balloons
      parts.push({ geo: G.sphere(rr, 8, 6), matrix: TS(cx + ox, cy + oy, cz + oz, 1.15, 0.62, 1.15, rng.range(0, 3)), color: [...c.map(v => v * shade), 1] });
    }
  }
  return parts;
}

// a far tree for the forest wall on the horizon: a trunk and two lobes, cheap (the detail is in the fog anyway)
export function farTree(x, z, s = 1, rng = new RNG(8), leaf = '#2f6b33') {
  const H = (16 + rng.next() * 12) * s, base = M.hexLinear(leaf);
  const parts = [{ geo: G.tube([[x, 0, z], [x + rng.range(-1, 1), H * 0.5, z + rng.range(-1, 1)], [x + rng.range(-2, 2), H, z + rng.range(-2, 2)]], t => (0.7 - 0.4 * t) * s, 5), color: col('#4a3a2c') }];
  for (let i = 0; i < 2; i++) parts.push({ geo: G.sphere((4 + rng.next() * 3) * s, 6, 4), matrix: TS(x + rng.range(-3, 3), H + rng.range(-2, 2), z + rng.range(-3, 3), 1.2, 0.6, 1.2), color: [...base.map(v => v * rng.range(0.6, 1.0)), 1] });
  return parts;
}
// an undergrowth bush: a few dark lobes
export function bush(x, z, s = 1, rng = new RNG(9), leaf = '#2a5a2a') {
  const parts = [], base = M.hexLinear(leaf), n = 2 + rng.int(0, 2);
  for (let i = 0; i < n; i++) parts.push({ geo: G.sphere((0.8 + rng.next() * 0.8) * s, 7, 5), matrix: TS(x + rng.range(-1, 1) * s, 0.3 * s, z + rng.range(-1, 1) * s, 1.3, 0.7, 1.1, rng.range(0, 3)), color: [...base.map(v => v * rng.range(0.55, 1.0)), 1] });
  return parts;
}

// a big leaf cluster hanging in the canopy: a few long drooping fronds (flattened lobes) from one point
export function canopyLeaves(x, y, z, s = 1, rng = new RNG(4), leaf = '#3a7a3a') {
  const parts = [], base = M.hexLinear(leaf), n = 4 + rng.int(0, 4);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rng.range(0, 0.7), L = (3 + rng.next() * 3) * s, droop = (0.8 + rng.next() * 1.4) * s;
    const pts = []; for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([x + Math.sin(a) * L * t, y - droop * t * t, z + Math.cos(a) * L * t]); }
    const shade = 0.5 + rng.next() * 0.6;
    parts.push({ geo: G.tube(pts, t => (0.35 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))) * s, 5), color: [...base.map(v => v * shade), 1] });
  }
  return parts;
}

// a liana hanging from (x, top, z) down to y1, sagging sideways; a few leaves along it
export function vine(x, top, z, y1, rng = new RNG(5), opts = {}) {
  const parts = [], sway = opts.sway ?? rng.range(-2, 2), swayZ = opts.swayZ ?? rng.range(-2, 2), n = 6;
  const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([x + sway * Math.sin(t * Math.PI) * 0.5 + sway * t * t * 0.3, top + (y1 - top) * t, z + swayZ * Math.sin(t * Math.PI) * 0.5]); }
  parts.push({ geo: G.tube(pts, t => 0.07 + 0.03 * (1 - t), 4), color: col(opts.color || '#56662a') });
  const leaf = M.hexLinear(opts.leaf || '#3f8a3a');
  for (let i = 1; i < n; i++) if (rng.next() < 0.75) {
    const p = pts[i], a = rng.range(0, 6.3);
    parts.push({ geo: G.sphere(0.32, 6, 4), matrix: TS(p[0] + Math.sin(a) * 0.3, p[1], p[2] + Math.cos(a) * 0.3, 1.6, 0.35, 0.9, a), color: [...leaf.map(v => v * rng.range(0.6, 1.1)), 1] });
  }
  return parts;
}

// a vine swag between two canopy points (a catenary), with leaves
export function vineSwag(a, b, rng = new RNG(6), sag = 3) {
  const parts = [], n = 8, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * Math.sin(t * Math.PI), a[2] + (b[2] - a[2]) * t]); }
  parts.push({ geo: G.tube(pts, 0.09, 4), color: col('#56662a') });
  const leaf = M.hexLinear('#3f8a3a');
  for (let i = 1; i < n; i++) if (rng.next() < 0.6) { const p = pts[i]; parts.push({ geo: G.sphere(0.4, 6, 4), matrix: TS(p[0], p[1] - 0.2, p[2], 1.6, 0.3, 0.9, rng.range(0, 6.3)), color: [...leaf.map(v => v * rng.range(0.6, 1.1)), 1] }); }
  return parts;
}

// a fern: a fan of drooping fronds from the ground
export function fern(x, z, s = 1, rng = new RNG(7), leaf = '#3f8a3a') {
  const parts = [], base = M.hexLinear(leaf), n = 6 + rng.int(0, 4);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rng.range(0, 0.5), L = (0.9 + rng.next() * 0.7) * s;
    const pts = []; for (let k = 0; k <= 3; k++) { const t = k / 3; pts.push([x + Math.sin(a) * L * t, 0.1 + (0.9 * Math.sin(t * Math.PI * 0.6)) * s - t * t * 0.3 * s, z + Math.cos(a) * L * t]); }
    parts.push({ geo: G.tube(pts, t => (0.04 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))) * s, 4), color: [...base.map(v => v * rng.range(0.55, 1.05)), 1] });
  }
  return parts;
}

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
// v0.4.7.5 qp3: the Event Park hall next to the Crew HQ (the same shell in the event's colours, a ticket window instead
// of lit windows, a marquee over the door). At an event park it's the Home Park hall, in the affiliation's colour.
export const HALL_SIZE = { w: 5.6, d: 4.2, h: 4.4 };
export function eventHall(x, z, color = '#ff8a1f', accent = '#2ec4ff') {
  const parts = [], glow = [];
  const { w: W, d: D, h: Hh } = HALL_SIZE, t = 0.22;
  const put = (geo, dx, dy, dz, c, out = parts) => out.push({ geo, matrix: T(x + dx, dy, z + dz), color: col(c) });
  const wall = '#2a2d33', trim = '#15171b', glass = '#1c2a33';
  put(G.box(W, Hh, t), 0, Hh / 2, -D / 2 + t / 2, wall);
  for (const sx of [-1, 1]) put(G.box(t, Hh, D), sx * (W / 2 - t / 2), Hh / 2, 0, wall);
  put(G.box(W + 0.3, 0.3, D + 0.3), 0, Hh + 0.15, 0, trim);
  put(G.box(W + 0.12, 0.35, D + 0.12), 0, 0.175, 0, '#3a3f45');
  // the front: a wide glass door in the middle, a ticket window to its right, the event's colour on the piers
  const door = 2.0, fz = D / 2 - t / 2;
  for (const sx of [-1, 1]) put(G.box((W - door) / 2, Hh, t), sx * (door / 2 + (W - door) / 4), Hh / 2, fz, color);
  put(G.box(door, Hh - 2.7, t), 0, 2.7 + (Hh - 2.7) / 2, fz, wall);
  put(G.box(door, 2.7, 0.06), 0, 1.35, fz - 0.02, glass);
  for (const dx of [-door / 2, 0, door / 2]) put(G.box(0.1, 2.7, 0.12), dx, 1.35, fz + 0.02, trim);
  put(G.box(door + 0.1, 0.1, 0.12), 0, 2.7, fz + 0.02, trim);
  for (const dx of [-0.18, 0.18]) put(G.box(0.04, 0.7, 0.06), dx, 1.2, fz + 0.1, '#c9cdd2');
  const wx = door / 2 + (W - door) / 4;
  put(G.box(1.1, 0.9, 0.04), wx, 1.7, D / 2 + 0.005, '#ffe9c0', glow); // the ticket window, lit
  put(G.box(1.22, 0.08, 0.1), wx, 2.2, D / 2 + 0.03, trim); put(G.box(1.22, 0.08, 0.1), wx, 1.2, D / 2 + 0.03, trim);
  put(G.box(1.3, 0.06, 0.5), wx, 1.22, D / 2 + 0.25, trim); // the counter
  // the marquee: a lit box over the door with the accent trim, and chasing bulbs along its edge
  put(G.box(W - 0.4, 0.9, 0.5), 0, 3.5, D / 2 + 0.2, trim);
  put(G.box(W - 0.6, 0.62, 0.06), 0, 3.5, D / 2 + 0.46, '#fff6e0', glow);
  for (let i = 0; i < 9; i++) put(G.box(0.1, 0.1, 0.08), -W / 2 + 0.5 + i * (W - 1) / 8, 4.05, D / 2 + 0.44, i % 2 ? accent : color, glow);
  for (let i = 0; i < 9; i++) put(G.box(0.1, 0.1, 0.08), -W / 2 + 0.5 + i * (W - 1) / 8, 2.95, D / 2 + 0.44, i % 2 ? color : accent, glow);
  put(G.box(W - 0.4, 0.06, 0.1), 0, 2.86, D / 2 + 0.42, '#fff2d6', glow);
  return { parts, glow };
}

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
