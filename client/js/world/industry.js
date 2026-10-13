// v0.4.8.5 Foundry Works: the park in the middle of a sprawling industrial district, seen in every direction.
// North, past the freight line: a coal-fired power plant (boiler house, turbine hall, two banded smokestacks with
// blinking aviation lights, three hyperboloid cooling towers whose steam plumes roll up and away), its transformer
// yard and high-voltage lines on lattice pylons running off to the horizon. East: a tank farm (tanks with spiral
// stairs inside a bund), an oil field of nodding pumpjacks, a drilling derrick and a flare stack burning. West: a
// refinery (distillation columns with platforms, pipe racks, a second flare) and cement silos with their conveyor.
// South: a container port (ship-to-shore cranes, stacks of boxes, a rubber-tyred gantry). Sodium lights dot it all
// and stay lit through the haze. Over the whole area a low fog rolls along the ground (three thin layers drifting
// different ways, thinned out over the courts). Big things stand far out (80-350 m), the mid-sized (tanks, racks)
// at 45-90 m; nothing enters the park (x -63..63, z -34..32), the old buildings or the freight line (z 60-64).
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG, makeNoise2D } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { cachedTexture } from './court.js';
import { shadedPlane } from './harbor.js';
import { bake } from './props.js';

const lin = hex => M.hexLinear(hex);
const c4 = hex => typeof hex === 'string' ? [...lin(hex), 1] : hex;
const TR = (x, y, z, yaw = 0) => M.m4fromYaw(M.m4(), x, y, z, yaw);
const put = (out, geo, x, y, z, hex, yaw = 0) => out.push({ geo, matrix: TR(x, y, z, yaw), color: c4(hex) });
// a box from a to b (a member of a lattice, a pipe rack beam, a conveyor gallery): w wide, h deep
export function beam(out, a, b, w, h, hex) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
  if (L < 1e-4) return;
  const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const m = M.m4mul(M.m4(), TR((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, yaw), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, -pitch)));
  out.push({ geo: G.box(w, h, L), matrix: m, color: c4(hex) });
}

// ---- the plan: every footprint, so tests can check nothing lands in the park or on the old buildings ----
export const PLANT = {
  towers: [{ x: 70, z: 225, h: 118, rb: 40, rt: 25 }, { x: 150, z: 175, h: 104, rb: 35, rt: 22 }, { x: -95, z: 245, h: 124, rb: 42, rt: 26 }],
  stacks: [{ x: -52, z: 150, h: 168, rb: 7.5, rt: 4.6 }, { x: -24, z: 168, h: 150, rb: 6.6, rt: 4.0 }],
  boiler: { x: -40, z: 118, w: 34, d: 30, h: 62 }, hall: { x: 12, z: 118, w: 70, d: 30, h: 34 },
  yard: { x: 100, z: 100, w: 54, d: 34 },
  tanks: [[96, -24, 11, 14], [96, 6, 9, 12], [124, -38, 13, 16], [126, -6, 12, 15], [124, 24, 10, 13], [152, -20, 12, 16], [152, 12, 13, 17], [98, 34, 8, 11]],
  pumpjacks: [[180, -70, 0.4], [205, -38, 1.9], [178, 44, 2.6], [215, 20, 0.9], [240, -12, 1.4], [196, 80, 2.2]],
  derrick: { x: 250, z: -64 }, flares: [{ x: 262, z: 66, h: 64 }, { x: -205, z: -96, h: 58 }],
  columns: [[-104, -26, 2.6, 46], [-112, -6, 3.4, 58], [-104, 12, 2.2, 36], [-128, -18, 2.8, 52], [-130, 8, 3.0, 42], [-148, -4, 2.4, 34]],
  racks: [[-80, -38, -80, 50], [-86, -37, -150, -37], [-80, 24, -138, 24], [76, -36, 76, 36], [84, 54, 160, 54]],
  silos: { x: -112, z: 92 }, cranes: [-70, 0, 70], craneZ: -138,
  stacks2: { z0: -76, z1: -118 }, // container rows
};
export function industryFootprints() {
  const P = PLANT, f = [];
  for (const t of P.towers) f.push({ x: t.x, z: t.z, r: t.rb });
  for (const s of P.stacks) f.push({ x: s.x, z: s.z, r: s.rb + 2 });
  for (const b of [P.boiler, P.hall]) f.push({ x: b.x, z: b.z, r: Math.hypot(b.w, b.d) / 2 });
  f.push({ x: P.yard.x, z: P.yard.z, r: Math.hypot(P.yard.w, P.yard.d) / 2 });
  for (const [x, z, r] of P.tanks) f.push({ x, z, r: r + 1.5 });
  for (const [x, z] of P.pumpjacks) f.push({ x, z, r: 6 });
  f.push({ x: P.derrick.x, z: P.derrick.z, r: 14 });
  for (const fl of P.flares) f.push({ x: fl.x, z: fl.z, r: 3 });
  for (const [x, z, r] of P.columns) f.push({ x, z, r: r + 1.5 });
  for (const [x0, z0, x1, z1] of P.racks) { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 8); for (let i = 0; i <= n; i++) f.push({ x: x0 + (x1 - x0) * i / n, z: z0 + (z1 - z0) * i / n, r: 4 }); }
  f.push({ x: P.silos.x, z: P.silos.z, r: 16 });
  for (const x of P.cranes) f.push({ x, z: P.craneZ, r: 20 });
  for (let x = -96; x <= 96; x += 16) f.push({ x, z: (P.stacks2.z0 + P.stacks2.z1) / 2, r: 8 });
  return f;
}

// ---- builders ----
// hyperboloid cooling tower: a lathed shell (outside weathered, inside dark) on a ring of raking columns
function coolingTower(out, t, noise) {
  const yt = t.h * 0.8, c = yt / Math.sqrt((t.rb / t.rt) ** 2 - 1), n = 13, prof = [];
  for (let i = 0; i <= n; i++) { const y = 7 + (t.h - 7) * i / n; prof.push([t.rt * Math.sqrt(1 + ((y - yt) / c) ** 2), y]); }
  const seg = 28, g = G.lathe(prof, seg), base = lin('#9a9690');
  g.color = new Float32Array(g.position.length / 3 * 4);
  for (let k = 0; k <= n; k++) for (let i = 0; i <= seg; i++) {
    // streaks down the shell, darker near the lip (soot and wet), a lighter band at the throat
    const a = i / seg, y = k / n, s = 0.86 + noise(a * 24, y * 2.5) * 0.12 - (y > 0.93 ? 0.18 : 0) + (Math.abs(y - 0.78) < 0.05 ? 0.05 : 0);
    g.color.set([base[0] * s, base[1] * s, base[2] * s, 1], (k * (seg + 1) + i) * 4);
  }
  out.push({ geo: g, matrix: TR(t.x, 0, t.z) });
  const inner = G.flip(G.lathe(prof.map(([r, y]) => [r - 0.6, y]), seg));
  out.push({ geo: inner, matrix: TR(t.x, 0, t.z), color: c4('#3a3836') });
  // the raking columns round the base (a V pair every few metres) and the cold-water basin's rim
  const r0 = prof[0][0];
  for (let i = 0; i < 36; i++) {
    const a = i / 36 * Math.PI * 2, a2 = (i + 0.5) / 36 * Math.PI * 2;
    beam(out, [t.x + Math.cos(a) * (r0 + 1.5), 0, t.z + Math.sin(a) * (r0 + 1.5)], [t.x + Math.cos(a2) * r0, 7.2, t.z + Math.sin(a2) * r0], 0.9, 0.9, '#7c7872');
    beam(out, [t.x + Math.cos(a + Math.PI * 2 / 36) * (r0 + 1.5), 0, t.z + Math.sin(a + Math.PI * 2 / 36) * (r0 + 1.5)], [t.x + Math.cos(a2) * r0, 7.2, t.z + Math.sin(a2) * r0], 0.9, 0.9, '#7c7872');
  }
  out.push({ geo: G.cylinder(r0 + 3, r0 + 3, 1.2, 28, { y0: true, open: true }), matrix: TR(t.x, 0, t.z), color: c4('#6a6660') });
  return { top: [t.x, t.h, t.z], r: prof[n][0] };
}
// a smokestack: tapered, with red and white bands at the top, two service platforms
function smokestack(out, glow, s) {
  out.push({ geo: G.cylinder(s.rt, s.rb, s.h, 16, { y0: true }), matrix: TR(s.x, 0, s.z), color: c4('#8a8580') });
  const rAt = y => s.rb + (s.rt - s.rb) * y / s.h;
  for (let i = 0; i < 5; i++) {
    const y0 = s.h - 30 + i * 6;
    out.push({ geo: G.cylinder(rAt(y0 + 6) + 0.08, rAt(y0) + 0.08, 6, 16, { y0: true, open: true }), matrix: TR(s.x, y0, s.z), color: c4(i % 2 ? '#e8e4dc' : '#b0302a') });
  }
  out.push({ geo: G.cylinder(s.rt + 0.3, s.rt + 0.3, 1.2, 16, { y0: true }), matrix: TR(s.x, s.h - 0.6, s.z), color: c4('#2a2826') });
  for (const f of [0.45, 0.78]) out.push({ geo: G.cylinder(rAt(s.h * f) + 1.6, rAt(s.h * f) + 1.6, 0.4, 16, { y0: true }), matrix: TR(s.x, s.h * f, s.z), color: c4('#4a4c4e') });
  // aviation lights: four round the top and at two levels below
  for (const f of [1, 0.66, 0.33]) for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4, y = s.h * f - (f === 1 ? 1.2 : 0), r = rAt(y) + 0.6; glow.push({ geo: G.sphere(f === 1 ? 1.1 : 0.9, 6, 5), matrix: TR(s.x + Math.cos(a) * r, y, s.z + Math.sin(a) * r), color: [1, 0.05, 0.03, 1] }); }
  return [s.x, s.h, s.z];
}
// a lattice tower (pylon or derrick): 4 legs from half-width b0 at the ground to b1 at h, girts every `step`,
// X bracing on every face. yaw turns it; m is the member size
function lattice(out, x, z, h, b0, b1, step, m, hex, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw), P = (lx, y, lz) => [x + lx * c + lz * s, y, z - lx * s + lz * c];
  const hw = y => b0 + (b1 - b0) * y / h, corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) beam(out, P(sx * b0, 0, sz * b0), P(sx * b1, h, sz * b1), m * 1.4, m * 1.4, hex);
  const n = Math.max(1, Math.round(h / step));
  for (let i = 0; i <= n; i++) {
    const y = h * i / n, w = hw(y);
    for (let k = 0; k < 4; k++) { const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4]; beam(out, P(ax * w, y, az * w), P(bx * w, y, bz * w), m, m, hex); }
    if (i === n) break;
    const y2 = h * (i + 1) / n, w2 = hw(y2);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
      beam(out, P(ax * w, y, az * w), P(bx * w2, y2, bz * w2), m * 0.7, m * 0.7, hex);
      beam(out, P(bx * w, y, bz * w), P(ax * w2, y2, az * w2), m * 0.7, m * 0.7, hex);
    }
  }
  return P;
}
// a high-voltage pylon: lattice body, two cross arms each side, insulators; returns the conductor points
function pylon(out, x, z, yaw) {
  const P = lattice(out, x, z, 42, 4.2, 0.9, 6, 0.28, '#6e7276', yaw), tips = [];
  for (const [y, L] of [[30, 8.5], [36.5, 6.5]]) {
    beam(out, P(-L, y, 0), P(L, y, 0), 0.5, 0.7, '#6e7276');
    beam(out, P(-L, y, 0), P(-0.9, y + 3, 0), 0.3, 0.3, '#6e7276'); beam(out, P(L, y, 0), P(0.9, y + 3, 0), 0.3, 0.3, '#6e7276');
    for (const sx of [-1, 1]) { const tp = P(sx * (L - 0.6), y - 2.6, 0); beam(out, P(sx * (L - 0.6), y, 0), tp, 0.35, 0.35, '#c8c4b8'); tips.push(tp); }
  }
  tips.push(P(0, 44.5, 0));
  beam(out, P(0, 42, 0), P(0, 45, 0), 0.3, 0.3, '#6e7276');
  return tips;
}
// a sagging conductor between two points
function wire(out, a, b, sag, r = 0.13) {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]); }
  out.push({ geo: G.tube(pts, r, 3), color: c4('#2a2c2e') });
}
// a storage tank: the shell, a shallow cone roof, a wind girder, a spiral stair round it with a handrail
function tank(out, glow, rng, x, z, r, h) {
  const shade = rng.pick(['#d8d6d0', '#c4c6c8', '#e2ddd2', '#a88a6a']);
  out.push({ geo: G.cylinder(r, r, h, 22, { y0: true }), matrix: TR(x, 0, z), color: c4(shade) });
  out.push({ geo: G.cylinder(0.6, r + 0.15, r * 0.18, 22, { y0: true }), matrix: TR(x, h, z), color: c4('#9a9a96') });
  out.push({ geo: G.cylinder(r + 0.35, r + 0.35, 0.35, 22, { y0: true, open: true }), matrix: TR(x, h - 1.2, z), color: c4('#7a7c7e') });
  const steps = Math.round(h / 0.5), a0 = rng.range(0, Math.PI * 2), turn = 0.9 * Math.PI * 2 * (12 / Math.max(10, r)), rail = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps, a = a0 + t * turn, y = t * h, rr = r + 0.6;
    out.push({ geo: G.box(1.0, 0.08, 0.32), matrix: M.m4mul(M.m4(), TR(x + Math.cos(a) * rr, y + 0.2, z + Math.sin(a) * rr, -a), M.m4()), color: c4('#3a3c3e') });
    if (i % 3 === 0) rail.push([x + Math.cos(a) * (rr + 0.5), y + 1.2, z + Math.sin(a) * (rr + 0.5)]);
  }
  if (rail.length > 1) out.push({ geo: G.tube(rail, 0.05, 4), color: c4('#c8a020') });
  const ta = a0 + turn;
  glow.push({ geo: G.sphere(0.35, 5, 4), matrix: TR(x + Math.cos(ta) * (r + 0.8), h + 1.2, z + Math.sin(ta) * (r + 0.8)), color: [1, 0.62, 0.22, 1] });
}
// a distillation column with platforms, a ladder cage line, a top head and a lamp on each platform
function column(out, glow, x, z, r, h) {
  out.push({ geo: G.cylinder(r, r, h, 14, { y0: true }), matrix: TR(x, 0, z), color: c4('#b8b6ae') });
  out.push({ geo: G.sphere(r, 14, 6, { phiMax: Math.PI / 2 }), matrix: TR(x, h, z), color: c4('#b8b6ae') });
  out.push({ geo: G.cylinder(r * 1.3, r * 1.4, 3, 14, { y0: true }), matrix: TR(x, 0, z), color: c4('#6a6a66') });
  for (let y = 9; y < h - 2; y += 9) {
    out.push({ geo: G.cylinder(r + 1.3, r + 1.3, 0.25, 14, { y0: true }), matrix: TR(x, y, z), color: c4('#50524e') });
    out.push({ geo: G.cylinder(r + 1.3, r + 1.3, 0.08, 14, { y0: true, open: true }), matrix: TR(x, y + 1.05, z), color: c4('#c8a020') });
    glow.push({ geo: G.sphere(0.3, 5, 4), matrix: TR(x + r + 1.1, y + 1.4, z), color: [1, 0.62, 0.22, 1] });
  }
  out.push({ geo: G.box(0.5, h, 0.5), matrix: TR(x - r - 0.5, h / 2, z), color: c4('#4a4c4a') });
  out.push({ geo: G.cylinder(0.4, 0.4, 6, 6, { y0: true }), matrix: TR(x + r * 0.4, h + r * 0.8, z), color: c4('#8a8a86') }); // vent
}
// a pipe rack between two points (axis aligned): bents every 8 m, two beam levels, six pipes
function rack(out, glow, x0, z0, x1, z1) {
  const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, px = -uz, pz = ux, n = Math.ceil(L / 8);
  for (let i = 0; i <= n; i++) {
    const cx = x0 + ux * L * i / n, cz = z0 + uz * L * i / n;
    for (const s of [-1, 1]) out.push({ geo: G.box(0.45, 8, 0.45), matrix: TR(cx + px * s * 3, 4, cz + pz * s * 3), color: c4('#5a5e62') });
    for (const y of [4.6, 7.8]) beam(out, [cx - px * 3.3, y, cz - pz * 3.3], [cx + px * 3.3, y, cz + pz * 3.3], 0.4, 0.5, '#5a5e62');
    if (i % 3 === 1) glow.push({ geo: G.sphere(0.28, 5, 4), matrix: TR(cx + px * 3.3, 8.4, cz + pz * 3.3), color: [1, 0.62, 0.22, 1] });
  }
  const pipes = [[-2.2, 5.3, 0.45, '#8a7a5a'], [-0.9, 5.25, 0.35, '#a8a8a2'], [0.4, 5.35, 0.55, '#6a7a8a'], [1.9, 5.2, 0.3, '#9a4a2a'], [-1.4, 8.45, 0.5, '#b8b6ae'], [1.2, 8.4, 0.4, '#5a6a5a']];
  for (const [o, y, r, hex] of pipes) out.push({ geo: G.tube([[x0 + px * o, y, z0 + pz * o], [x1 + px * o, y, z1 + pz * o]], r, 6), color: c4(hex) });
}
// a pumpjack's still parts (skid, samson post, gearbox, motor, wellhead); the walking beam and the crank are
// instanced and move (see the update)
function pumpjackBase(out, x, z, yaw) {
  const P = (lx, y, lz) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + lx * c + lz * s, y, z - lx * s + lz * c]; };
  const part = (geo, lx, y, lz, hex) => out.push({ geo, matrix: M.m4mul(M.m4(), TR(...P(lx, y, lz), yaw), M.m4()), color: c4(hex) });
  part(G.box(11, 0.6, 2.8), 0, 0.3, 0, '#4a4844');
  for (const s of [-1, 1]) beam(out, P(-0.4, 0.6, s * 1.2), P(0, 6.4, 0), 0.35, 0.35, '#6a5a3a');
  beam(out, P(1.6, 0.6, 0), P(0, 6.4, 0), 0.3, 0.3, '#6a5a3a');
  part(G.box(1.8, 1.6, 1.6), -3.6, 1.4, 0, '#3a3c3e');   // gearbox
  part(G.box(1.4, 1.1, 1.0), -5.0, 1.15, 0, '#2a4a6a');  // motor
  part(G.cylinder(0.25, 0.3, 1.4, 8, { y0: true }), 4.6, 0, 0, '#5a5a56'); // wellhead
}
function pumpjackBeam() {
  // local: pivot at the origin, the beam along +x (horsehead at +x), the rear end over the crank
  const p = [];
  p.push({ geo: G.box(9, 0.6, 0.55), matrix: TR(0.6, 0, 0), color: c4('#c8a020') });
  p.push({ geo: G.box(0.5, 2.6, 0.9), matrix: TR(5.25, -0.5, 0), color: c4('#c8a020') });   // horsehead
  p.push({ geo: G.box(0.4, 0.9, 0.9), matrix: TR(5.0, 0.7, 0), color: c4('#c8a020') });
  p.push({ geo: G.box(0.6, 0.6, 0.9), matrix: TR(0, -0.25, 0), color: c4('#2a2a28') });     // saddle bearing
  p.push({ geo: G.box(0.3, 4.3, 0.3), matrix: TR(-3.6, -2.2, 0.7), color: c4('#3a3c3e') }); // pitman arms
  p.push({ geo: G.box(0.3, 4.3, 0.3), matrix: TR(-3.6, -2.2, -0.7), color: c4('#3a3c3e') });
  p.push({ geo: G.box(0.08, 5.5, 0.08), matrix: TR(5.5, -3.4, 0), color: c4('#d8d8d0') });   // polished rod & bridle
  return G.merge(bake(p));
}
function pumpjackCrank() {
  const p = [];
  for (const s of [-1, 1]) {
    p.push({ geo: G.box(0.3, 2.6, 0.25), matrix: TR(0, 0, s * 0.95), color: c4('#3a3c3e') });
    p.push({ geo: G.box(1.5, 1.3, 0.35), matrix: TR(0, -1.2, s * 1.0), color: c4('#a82a22') }); // counterweights
  }
  return G.merge(bake(p));
}
// a ship-to-shore container crane: portal legs, the boom out over the quay, an A-frame with stays, a machinery house
function stsCrane(out, glow, x, z) {
  const col = '#c8442a', W = 9, D = 14;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push({ geo: G.box(1.6, 40, 1.6), matrix: TR(x + sx * W, 20, z + sz * D), color: c4(col) });
  for (const sz of [-1, 1]) out.push({ geo: G.box(W * 2 + 1.6, 2.2, 1.8), matrix: TR(x, 39, z + sz * D), color: c4(col) });
  for (const sx of [-1, 1]) { out.push({ geo: G.box(1.8, 2.2, D * 2), matrix: TR(x + sx * W, 30, z), color: c4(col) }); out.push({ geo: G.box(1.2, 1.2, D * 2), matrix: TR(x + sx * W, 8, z), color: c4(col) }); }
  // the boom: out over the water side (-z) and back over the land (+z)
  for (const sx of [-1, 1]) out.push({ geo: G.box(1.6, 3, 112), matrix: TR(x + sx * 3, 44, z - 22), color: c4(col) });
  for (let i = 0; i < 14; i++) beam(out, [x - 3, 45.5, z - 76 + i * 8], [x + 3, 45.5, z - 72 + i * 8], 0.5, 0.5, col);
  for (const sx of [-1, 1]) { beam(out, [x + sx * W, 41, z + D], [x + sx * 3, 66, z + 4], 1.2, 1.2, col); beam(out, [x + sx * W, 41, z - D], [x + sx * 3, 66, z + 4], 1.2, 1.2, col); beam(out, [x + sx * 3, 66, z + 4], [x + sx * 3, 45, z - 74], 0.5, 0.5, '#d8d4c8'); beam(out, [x + sx * 3, 66, z + 4], [x + sx * 3, 45, z + 32], 0.5, 0.5, '#d8d4c8'); }
  out.push({ geo: G.box(10, 6, 12), matrix: TR(x, 49, z + 18), color: c4('#e8e4dc') });
  out.push({ geo: G.box(3, 3, 3.5), matrix: TR(x, 41.5, z - 18), color: c4('#e8e4dc') }); // the trolley cab
  glow.push({ geo: G.sphere(0.9, 6, 5), matrix: TR(x, 67.2, z + 4), color: [1, 0.05, 0.03, 1] });
  for (let i = 0; i < 6; i++) glow.push({ geo: G.box(1.2, 0.5, 0.8), matrix: TR(x + (i % 2 ? 3 : -3), 42.2, z - 70 + i * 18), color: [1, 0.95, 0.85, 1] });
}

// ---- the low rolling fog: three thin layers drifting different ways, thinned out over the park ----
function lowFog(ctx, scene) {
  const tex = cachedTexture(ctx, 'fogwisps', () => T.fogWisps({}), {});
  const layers = [[0.22, 0.34, 46, [0.011, 0.004]], [0.7, 0.24, 64, [-0.006, 0.009]], [1.35, 0.15, 90, [0.004, -0.007]]], mats = [];
  // inside the park the fog keeps to a wisp so the floor, the lines, the ball and everyone's feet stay clear
  const thin = (x, z) => { const dx = Math.max(0, Math.abs(x) - 60), dz = Math.max(0, z > 0 ? z - 29 : -z - 31); return 0.16 + 0.84 * M.clamp(Math.hypot(dx, dz) / 18, 0, 1); };
  for (const [y, a, tile, scroll] of layers) {
    const g = shadedPlane(-360, 360, -360, 360, 24, tile, () => [1, 1, 1], y);
    for (let i = 0; i < g.position.length / 3; i++) g.color[i * 4 + 3] = thin(g.position[i * 3], g.position[i * 3 + 2]);
    const mat = new Material({ map: tex, color: [0.5, 0.41, 0.43], opacity: a, shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false });
    const m = new Mesh(ctx.geometry(g), mat, { castShadow: false, reflect: false });
    m.order = 4; scene.add(m);
    mats.push([mat, scroll]);
  }
  return mats;
}

// ---- steam and smoke plumes: bent, widening tubes with a wisp texture scrolling up them, fading out ----
function plumes(ctx, scene, sources) {
  const parts = [], wind = M.v3norm([0, 0, 0], [0.75, 0, 0.6]);
  for (const s of sources) {
    const [x, y, z] = s.top, rings = 12, seg = 16, pos = [], nrm = [], uv = [], col = [], idx = [];
    for (let k = 0; k <= rings; k++) {
      const t = k / rings, h = t * s.len, rr = s.r * (1 + t * s.spread), drift = s.len * 0.55 * t * t;
      const cx = x + wind[0] * drift, cz = z + wind[2] * drift, cy = y + h - t * t * s.len * 0.15;
      const alpha = s.alpha * Math.min(1, t * 6 + 0.25) * (1 - t) ** 1.4;
      for (let i = 0; i <= seg; i++) {
        const a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        pos.push(cx + ca * rr, cy, cz + sa * rr); nrm.push(ca, 0.3, sa); uv.push(i / seg * 2, -h / s.r / 2.2);
        col.push(s.shade[0], s.shade[1], s.shade[2], alpha);
      }
    }
    for (let k = 0; k < rings; k++) for (let i = 0; i < seg; i++) { const a = k * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    parts.push({ geo: { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), color: new Float32Array(col), index: new Uint16Array(idx) } });
  }
  const tex = cachedTexture(ctx, 'fogwisps', () => T.fogWisps({}), {});
  // lit (the low sun catches the plumes) but unaffected by the vertex alpha's ambient darkening: the alpha is
  // carried by the texture and opacity; a separate colour per vertex keeps steam white and smoke grey
  const mat = new Material({ map: tex, color: [1, 1, 1], roughness: 1, specular: 0.2, blend: 'alpha', depthWrite: false, doubleSided: true, emissive: [0.05, 0.04, 0.045] });
  const m = new Mesh(ctx.geometry(G.merge(parts)), mat, { castShadow: false, reflect: false });
  m.order = 2; scene.add(m);
  return mat;
}

// ---- the whole sprawl ----
export function industrialSprawl(ctx, scene, rng0) {
  const rng = new RNG(8181), noise = makeNoise2D(19), P = PLANT;
  const far = [], glow = [], blink = [];
  // the ground beyond the yard: packed dirt and old concrete out to the haze
  const tint = lin('#5a5652');
  const shade = (x, z) => { const n = noise.fbm(x / 60, z / 60, 3), k = 0.9 + n * 0.3; return [tint[0] * k, tint[1] * k * 0.98, tint[2] * k * 0.95]; };
  const conc = cachedTexture(ctx, 'concrete', () => T.concrete({ joints: true }).color, {});
  const yard = new Mesh(ctx.geometry(shadedPlane(-380, 380, -380, 380, 20, 4, shade, -0.03)), new Material({ color: [1, 1, 1], map: conc, roughness: 0.9 }), { castShadow: false, reflect: false });
  yard.order = -3; scene.add(yard);

  // the power plant
  const plumeSrc = [];
  for (const t of P.towers) { const top = coolingTower(far, t, noise); plumeSrc.push({ top: top.top, r: top.r * 0.92, len: 150, spread: 1.6, alpha: 0.85, shade: [0.92, 0.9, 0.92] }); }
  for (const s of P.stacks) { const top = smokestack(far, blink, s); plumeSrc.push({ top, r: s.rt * 0.9, len: 120, spread: 3.5, alpha: 0.55, shade: [0.42, 0.4, 0.42] }); }
  for (const t of P.towers) for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2; blink.push({ geo: G.sphere(1.1, 6, 5), matrix: TR(t.x + Math.cos(a) * (t.rt + 2.5), t.h + 0.6, t.z + Math.sin(a) * (t.rt + 2.5)), color: [1, 0.05, 0.03, 1] }); }
  const B = P.boiler, H = P.hall;
  put(far, G.box(B.w, B.h, B.d), B.x, B.h / 2, B.z, '#6e6a66');
  put(far, G.box(H.w, H.h, H.d), H.x, H.h / 2, H.z, '#7a756e');
  put(far, G.box(H.w + 1, 2, H.d + 1), H.x, H.h + 1, H.z, '#4a4642');
  for (let i = 0; i < 4; i++) put(far, G.box(5, 6, 5), H.x - 24 + i * 16, H.h + 3, H.z, '#5a5652');           // roof vents
  // rows of lit windows (some dark) on the hall and the boiler house
  const windows = (cx, w, z, ys) => { for (const y of ys) for (let x = cx - w / 2 + 2; x < cx + w / 2 - 2; x += 3.2) if (rng.next() < 0.7) glow.push({ geo: G.box(2, 1.3, 0.2), matrix: TR(x, y, z), color: [0.62, 0.42, 0.2, 1] }); };
  windows(H.x, H.w, H.z - H.d / 2 - 0.15, [8, 18, 28]); windows(B.x, B.w, B.z - B.d / 2 - 0.15, [12, 26, 40, 54]);
  // flues from the boiler house to the stacks, and the coal conveyor up to its top
  for (const s of P.stacks) beam(far, [B.x + 6, 30, B.z + 8], [s.x, 24, s.z], 4, 4, '#5a5652');
  beam(far, [B.x - 70, 2, B.z - 20], [B.x - 8, B.h - 6, B.z - 4], 4.5, 3.5, '#6a645e');
  for (let i = 1; i < 6; i++) { const t = i / 6; put(far, G.box(1.2, (B.h - 8) * t, 1.2), B.x - 70 + 62 * t, (B.h - 8) * t / 2, B.z - 20 + 16 * t, '#4a4642'); }
  for (let i = 0; i < 4; i++) far.push({ geo: G.sphere(1, 10, 6, { phiMax: Math.PI / 2 }), matrix: M.m4compose(M.m4(), [B.x - 92 + i * 9, 0, B.z - 34 + rng.range(-4, 4)], M.q4(), [rng.range(8, 12), rng.range(4, 7), rng.range(7, 10)]), color: c4('#1e1c1b') }); // coal piles
  // the transformer yard: transformers, bus gantries, a fence line
  const Y = P.yard;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
    const tx = Y.x - Y.w / 2 + 6 + i * 8.5, tz = Y.z - 6 + j * 12;
    put(far, G.box(4.5, 4, 3.2), tx, 2, tz, '#5e6a5e');
    for (let k = 0; k < 3; k++) put(far, G.cylinder(0.25, 0.35, 2.4, 6, { y0: true }), tx - 1.4 + k * 1.4, 4, tz, '#c8c0a8');
  }
  for (let i = 0; i < 4; i++) { const gx = Y.x - Y.w / 2 + 4 + i * 15; for (const gz of [Y.z - 14, Y.z + 14]) put(far, G.box(0.6, 14, 0.6), gx, 7, gz, '#7a7e82'); beam(far, [gx, 14, Y.z - 14], [gx, 14, Y.z + 14], 0.6, 0.8, '#7a7e82'); }
  for (const [a, b] of [[[Y.x - Y.w / 2, 0, Y.z - Y.d / 2], [Y.x + Y.w / 2, 0, Y.z - Y.d / 2]], [[Y.x - Y.w / 2, 0, Y.z + Y.d / 2], [Y.x + Y.w / 2, 0, Y.z + Y.d / 2]]]) far.push({ geo: G.box(Y.w, 2.4, 0.1), matrix: TR((a[0] + b[0]) / 2, 1.2, a[2]), color: c4('#4a4e52') });
  for (let i = 0; i < 6; i++) glow.push({ geo: G.sphere(0.3, 5, 4), matrix: TR(Y.x - Y.w / 2 + 4 + i * 10, 15, Y.z - 14), color: [1, 0.62, 0.22, 1] });
  // high-voltage lines on lattice pylons, out of the yard and away to the horizon in three directions
  const line = pts => {
    let prev = null;
    pts.forEach((p, i) => {
      const nx = pts[Math.min(pts.length - 1, i + 1)], pv = pts[Math.max(0, i - 1)], yaw = Math.atan2(nx[0] - pv[0], nx[1] - pv[1]) + Math.PI / 2;
      const tips = pylon(far, p[0], p[1], yaw);
      if (i % 2 === 0) blink.push({ geo: G.sphere(0.8, 6, 5), matrix: TR(p[0], 46, p[1]), color: [1, 0.05, 0.03, 1] });
      if (prev) for (let k = 0; k < tips.length; k++) wire(far, prev[k], tips[k], k === tips.length - 1 ? 3 : 5.5);
      prev = tips;
    });
  };
  line([[Y.x + 34, Y.z + 30], [200, 150], [255, 205], [300, 260], [345, 320]]);
  line([[Y.x - 30, Y.z + 24], [10, 158], [-60, 190], [-140, 196], [-215, 200], [-292, 205], [-360, 210]]);
  line([[Y.x + 40, Y.z - 8], [205, 112], [272, 108], [345, 104]]);
  line([[-250, 10], [-262, -70], [-272, -150], [-282, -230], [-292, -310]]);
  // east: the tank farm in its bund, the oil field and its pumpjacks, the derrick, a flare stack burning
  for (const [x, z, r, h] of P.tanks) tank(far, glow, rng, x, z, r, h);
  put(far, G.box(0.8, 1.6, 86), 80, 0.8, 5, '#6a665e'); put(far, G.box(0.8, 1.6, 86), 168, 0.8, 5, '#6a665e');
  put(far, G.box(88, 1.6, 0.8), 124, 0.8, -38, '#6a665e'); put(far, G.box(88, 1.6, 0.8), 124, 0.8, 48, '#6a665e');
  for (const [x0, z0, x1, z1] of P.racks) rack(far, glow, x0, z0, x1, z1);
  for (const [x, z, yaw] of P.pumpjacks) pumpjackBase(far, x, z, yaw);
  const D = P.derrick;
  put(far, G.box(16, 1.2, 16), D.x, 8, D.z, '#4a4844');                                        // drill floor
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) put(far, G.box(1.2, 8, 1.2), D.x + sx * 7, 4, D.z + sz * 7, '#5a5852');
  const DP = lattice(far, D.x, D.z, 52, 5.2, 1.3, 5.2, 0.38, '#c8a020', 0.3);
  put(far, G.box(3.4, 3, 3.4), ...DP(0, 53.5, 0), '#8a8a86');                                   // crown block
  put(far, G.box(6, 0.4, 2.5), ...DP(0, 28, 2.2), '#4a4844');                                    // monkey board
  put(far, G.box(9, 4, 4), D.x - 12, 2, D.z + 6, '#6a3a2a'); put(far, G.box(12, 3, 3.5), D.x + 12, 1.5, D.z - 4, '#4a5a6a'); put(far, G.box(12, 3, 3.5), D.x + 12, 1.5, D.z + 1, '#4a5a6a');
  for (let y = 10; y < 52; y += 10) glow.push({ geo: G.sphere(0.45, 5, 4), matrix: TR(...DP(1.1, y, -1.1)), color: [1, 0.68, 0.3, 1] });
  blink.push({ geo: G.sphere(1.0, 6, 5), matrix: TR(...DP(0, 56, 0)), color: [1, 0.05, 0.03, 1] });
  const flames = [];
  for (const f of P.flares) {
    put(far, G.cylinder(0.7, 1.1, f.h, 10, { y0: true }), f.x, 0, f.z, '#6a6660');
    put(far, G.cylinder(1.4, 1.0, 2.0, 10, { y0: true }), f.x, f.h - 0.5, f.z, '#3a3836');
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; wire(far, [f.x, f.h * 0.75, f.z], [f.x + Math.cos(a) * f.h * 0.5, 0.3, f.z + Math.sin(a) * f.h * 0.5], 0.5, 0.06); }
    flames.push([f.x, f.h + 1.4, f.z]);
  }
  // west: the refinery's columns and racks (racks above), the cement silos and their conveyor
  for (const [x, z, r, h] of P.columns) column(far, glow, x, z, r, h);
  for (let i = 0; i < 4; i++) { const sx = P.silos.x + (i % 2) * 11, sz = P.silos.z + Math.floor(i / 2) * 11; put(far, G.cylinder(4.8, 4.8, 26, 16, { y0: true }), sx, 6, sz, '#c8c4bc'); put(far, G.cylinder(0.6, 4.8, 5, 16, { y0: true }), sx, 32, sz, '#b8b4ac'); put(far, G.cylinder(1, 4.8, 6, 16, { y0: true, open: true }), sx, 0, sz, '#8a8680'); for (const [lx, lz] of [[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]]) put(far, G.box(0.6, 6, 0.6), sx + lx, 3, sz + lz, '#6a6862'); }
  put(far, G.box(8, 40, 8), P.silos.x + 5.5, 20, P.silos.z + 23, '#7a7670');
  beam(far, [P.silos.x + 5.5, 38, P.silos.z + 5.5], [P.silos.x + 5.5, 38, P.silos.z + 20], 3, 3, '#6a645e');
  beam(far, [P.silos.x + 40, 1, P.silos.z + 60], [P.silos.x + 5.5, 38, P.silos.z + 23], 3.5, 3, '#6a645e');
  glow.push({ geo: G.sphere(0.5, 5, 4), matrix: TR(P.silos.x + 5.5, 41, P.silos.z + 23), color: [1, 0.62, 0.22, 1] });
  blink.push({ geo: G.sphere(0.8, 6, 5), matrix: TR(P.silos.x + 5.5, 40.8, P.silos.z + 23), color: [1, 0.05, 0.03, 1] });
  // south: the container port: rows of stacked boxes, the ship-to-shore cranes along the quay, an RTG
  const boxes = ['#b5482f', '#2f6b8a', '#c8962f', '#4d6b3a', '#7a7f85', '#8a2a2a', '#2a4a7a', '#d8d4c8'];
  for (let row = 0; row < 5; row++) for (let x = -100; x <= 100; x += 12.8) {
    if (rng.next() < 0.12) continue;
    const z = P.stacks2.z0 - row * 9, n = rng.int(1, 4);
    for (let k = 0; k < n; k++) for (const dz of [-1.3, 1.3]) if (rng.next() < 0.85) put(far, G.box(12.2, 2.59, 2.44), x, 1.3 + k * 2.6, z + dz, boxes[rng.int(0, boxes.length - 1)]);
  }
  for (const x of P.cranes) stsCrane(far, blink, x, P.craneZ);
  put(far, G.box(320, 2.5, 6), 0, 1.25, P.craneZ - 20, '#5a5652');                               // the quay edge
  for (const sx of [-1, 1]) { put(far, G.box(1.2, 18, 1.2), -30 + sx * 13, 9, P.stacks2.z0 - 4.5 - 7, '#e0a21c'); put(far, G.box(1.2, 18, 1.2), -30 + sx * 13, 9, P.stacks2.z0 - 4.5 + 7, '#e0a21c'); }
  put(far, G.box(28, 2, 2), -30, 18, P.stacks2.z0 - 11.5, '#e0a21c'); put(far, G.box(28, 2, 2), -30, 18, P.stacks2.z0 + 2.5, '#e0a21c');
  // sodium lamps on tall masts round the yards
  for (const [x, z] of [[78, -60], [160, -55], [100, 62], [-88, 62], [-88, -60], [-150, 40], [40, -70], [-40, -70], [130, 140], [-130, 140]]) {
    put(far, G.cylinder(0.25, 0.4, 28, 6, { y0: true }), x, 0, z, '#4a4c4e');
    put(far, G.box(3, 0.6, 3), x, 28, z, '#2a2c2e');
    glow.push({ geo: G.box(2.6, 0.3, 2.6), matrix: TR(x, 27.6, z), color: [1, 0.66, 0.3, 1] });
  }

  // the meshes: the whole sprawl in one batch that casts no shadows (it's all far outside the shadow map), its lamps
  // unlit and unfogged, the aviation lights blinking
  scene.add(new Mesh(ctx.geometry(G.merge(bake(far))), new Material({ color: [1, 1, 1], roughness: 0.78, metalness: 0.15 }), { castShadow: false, reflect: false }));
  scene.add(new Mesh(ctx.geometry(G.merge(bake(glow))), new Material({ color: [3.2, 3.2, 3.2], shading: 'unlit', fog: false }), { castShadow: false, reflect: false }));
  const blinkMesh = new Mesh(ctx.geometry(G.merge(bake(blink))), new Material({ color: [4.5, 4.5, 4.5], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
  scene.add(blinkMesh);
  // pumpjacks: the walking beams and cranks are two instanced meshes, posed every frame
  const beamGeo = ctx.geometry(pumpjackBeam()), crankGeo = ctx.geometry(pumpjackCrank());
  const nJ = P.pumpjacks.length, beamData = new Float32Array(nJ * 20), crankData = new Float32Array(nJ * 20);
  const jacks = P.pumpjacks.map(([x, z, yaw], i) => ({ x, z, yaw, ph: i * 1.7, w: 0.9 + (i % 3) * 0.12 }));
  const pose = t => {
    jacks.forEach((j, i) => {
      const a = t * j.w + j.ph, c = Math.cos(j.yaw), s = Math.sin(j.yaw);
      // the beam rocks about the samson post's bearing; the crank turns at the gearbox
      const bm = M.m4mul(M.m4(), TR(j.x, 6.75, j.z, j.yaw), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, Math.sin(a) * 0.3)));
      const ckx = j.x + -3.6 * c, ckz = j.z - -3.6 * s;
      const cm = M.m4mul(M.m4(), TR(ckx, 2.2, ckz, j.yaw), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, -a)));
      beamData.set(bm, i * 20); beamData.set([1, 1, 1, 1], i * 20 + 16);
      crankData.set(cm, i * 20); crankData.set([1, 1, 1, 1], i * 20 + 16);
    });
    ctx.setInstances(beamGeo, beamData, nJ); ctx.setInstances(crankGeo, crankData, nJ);
  };
  pose(0);
  for (const g of [beamGeo, crankGeo]) g.bounds = { center: [210, 4, 5], radius: 110 };
  const jackMat = new Material({ color: [1, 1, 1], roughness: 0.6, metalness: 0.3 });
  scene.add(new Mesh(beamGeo, jackMat, { castShadow: false, reflect: false }));
  scene.add(new Mesh(crankGeo, jackMat, { castShadow: false, reflect: false }));
  // the flares: a flickering flame (two nested cones, added light) on each stack, plus embers rising off it
  const flameParts = flames.flatMap(([x, y, z]) => [
    { geo: G.cylinder(0.3, 3.4, 13, 10, { y0: true }), matrix: TR(x, y, z), color: [1, 0.36, 0.06, 1] },
    { geo: G.cylinder(0.15, 1.7, 7.5, 8, { y0: true }), matrix: TR(x, y, z), color: [1, 0.85, 0.5, 1] },
    { geo: G.sphere(2.2, 8, 6), matrix: TR(x, y + 1.2, z), color: [1, 0.6, 0.2, 1] },
  ]);
  const flameMat = new Material({ color: [3, 3, 3], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
  const flameMesh = new Mesh(ctx.geometry(G.merge(bake(flameParts))), flameMat, { castShadow: false, reflect: false });
  flameMesh.order = 3; scene.add(flameMesh);
  // plumes and the low fog (their textures scroll)
  const plumeMat = plumes(ctx, scene, plumeSrc);
  const fogMats = lowFog(ctx, scene);
  let t = 0, emberAcc = 0;
  return {
    update(dt, r) {
      t += dt;
      pose(t);
      blinkMesh.visible = (t % 1.6) < 0.55;
      const fl = 0.8 + Math.sin(t * 13) * 0.08 + Math.sin(t * 31.7) * 0.07 + (Math.random() - 0.5) * 0.12;
      flameMat.color = [3.4 * fl, 3.0 * fl, 2.6 * fl];
      plumeMat.uvOffset[1] = (plumeMat.uvOffset[1] + dt * 0.035) % 1; plumeMat.uvOffset[0] = (plumeMat.uvOffset[0] + dt * 0.004) % 1;
      for (const [m, [su, sv]] of fogMats) { m.uvOffset[0] = (m.uvOffset[0] + su * dt) % 1; m.uvOffset[1] = (m.uvOffset[1] + sv * dt) % 1; }
      emberAcc += dt;
      if (r && emberAcc > 0.08) {
        emberAcc = 0;
        for (const [x, y, z] of flames) r.particles.emit({ x: x + (Math.random() - 0.5) * 2, y: y + 6 + Math.random() * 6, z: z + (Math.random() - 0.5) * 2, vx: 1.6 + Math.random() * 1.5, vy: 5 + Math.random() * 4, vz: (Math.random() - 0.5) * 2, life: 0.9 + Math.random() * 0.7, size: 3 + Math.random() * 2.5, color: [1.6, 0.55, 0.12], gravity: 1.5, drag: 0.6, grow: -0.6 });
      }
    },
  };
}
