// v0.4.8.5 The Old Brick Yard as a real city block. The park sits in a street grid: an avenue down each side (the
// traffic lanes parklife.js drives, x ±66 / ±68.5), a street under the El along the north wall, one along the south
// wall, a side street running off each of those at x 0, and inside the park "Brick Row", a play street closed to
// traffic behind the north courts. Asphalt with tar seams, patches and puddles (T.street), road markings as decals
// (double yellow, lane lines, zebra crossings, stop bars and STOP stencils, manholes, storm drains, oil stains),
// raised kerbs and sidewalks, row buildings with detailed windows (T.facade detail: recesses, frames, blinds,
// curtains and people in the lit ones, fire escapes), shopfronts with neon signs (a few flicker), street lights with
// pools of light, traffic signals cycling at the intersections and windows that switch on and off.
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG, makeNoise2D } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { cachedTexture } from './court.js';
import * as PR from './props.js';
import { PARK_COURTS, plazaLampOff } from './themes.js';
import { shadedPlane } from './harbor.js';

const lin = hex => M.hexLinear(hex);
const c4 = hex => [...lin(hex), 1];
const TR = (x, y, z, yaw = 0) => M.m4fromYaw(M.m4(), x, y, z, yaw);
const put = (out, geo, x, y, z, hex, yaw = 0) => out.push({ geo, matrix: TR(x, y, z, yaw), color: typeof hex === 'string' ? c4(hex) : hex });

// ---- the street plan (world metres) ----
export const EXTENT = 170;                                              // how far the streets run out
export const AVE = { x0: 63.5, x1: 72.5, center: 67.25, park: 69.8, walk: 75.5 }; // east avenue (the west mirrors it)
export const SOUTH_ST = { z0: -46.5, z1: -38.5, center: -42.5, walkOut: -49.5, walkIn: -36.25 };
export const NORTH_ST = { z0: 35.25, z1: 43.25, center: 39.25, walkOut: 46.25, walkIn: 33.25 };
export const SIDE_ST = { x0: -4.5, x1: 4.5, walk: 7.5 };               // off the south and north streets at x 0
export const ROW = { z0: 22.5, z1: 30, center: 26.25, x0: -63.5, x1: 63.5 }; // Brick Row, inside the park
export const EL_Z = NORTH_ST.center;                                    // the El runs over the north street
// intersections: {x0, x1, z0, z1, ax: approaches along z (avenue / side street), bx: along x (cross street)}
export const CROSSINGS = [-1, 1].flatMap(s => [SOUTH_ST, NORTH_ST].map(st => ({ x0: s > 0 ? AVE.x0 : -AVE.x1, x1: s > 0 ? AVE.x1 : -AVE.x0, z0: st.z0, z1: st.z1, ns: [true, true], ew: [true, true] })))
  .concat([{ x0: SIDE_ST.x0, x1: SIDE_ST.x1, z0: SOUTH_ST.z0, z1: SOUTH_ST.z1, ns: [true, false], ew: [true, true] }, { x0: SIDE_ST.x0, x1: SIDE_ST.x1, z0: NORTH_ST.z0, z1: NORTH_ST.z1, ns: [false, true], ew: [true, true] }]);
// manholes that vent steam (parklife.js puffs it)
export const STEAM_VENTS = [[-31, 26.6], [22, 25.8], [AVE.center + 0.9, -12], [-AVE.center - 0.9, 14], [SIDE_ST.x0 + 2.2, SOUTH_ST.center - 9]];

// the court floors, fences and the practice slab: no paint goes there (it would show through the courts)
function underCourt(x0, z0, x1, z1, m = 0.6) {
  for (const c of PARK_COURTS) {
    const [ox, , oz] = c.origin, W = 9.9 + m, za = c.full ? oz - 16.95 - m : oz - 3.3 - m, zb = oz + 16.95 + m;
    if (x1 > ox - W && x0 < ox + W && z1 > za && z0 < zb) return true;
  }
  if (x1 > 46.5 && x0 < 57.5 && z1 > 11.5 && z0 < 21.5) return true;
  return false;
}

// ---- road markings (pure: tests/v0485parks checks them) ----
// lines: {x0, z0, x1, z1, w, paint: 'white'|'yellow'} (an axis-aligned stripe, the segment is its centre line);
// cells: {x, z, w, l, yaw, cell: [col, row, cols, rows], tint} (an atlas cell laid flat, see T.streetDecals)
export const DECAL = { manhole: [0, 0, 1, 1], manhole2: [1, 0, 1, 1], drain: [2, 0, 2, 1], oil: [4, 0, 1, 1], oil2: [5, 0, 1, 1], arrow: [6, 0, 1, 1], stop: [0, 1, 4, 1], slow: [4, 1, 4, 1], play: [0, 2, 8, 1], only: [0, 3, 4, 1], bus: [4, 3, 4, 1] };
export function streetMarkings(seed = 7) {
  const rng = new RNG(seed), lines = [], cells = [];
  const boxes = CROSSINGS.map(b => ({ ...b }));
  // a run along one axis with the intersections (and their crossings) and the courts cut out
  const run = (axis, c, a0, a1, w, paint, dash = null, cut = 4.6) => {
    const ivs = [[a0, a1]];
    for (const b of boxes) {
      const [lo, hi] = axis === 'z' ? [b.z0, b.z1] : [b.x0, b.x1], [p0, p1] = axis === 'z' ? [b.x0, b.x1] : [b.z0, b.z1];
      if (c < p0 - 0.01 || c > p1 + 0.01) continue;
      for (let k = ivs.length - 1; k >= 0; k--) {
        const [s, e] = ivs[k], cs = lo - cut, ce = hi + cut;
        if (e <= cs || s >= ce) continue;
        ivs.splice(k, 1, ...[[s, cs], [ce, e]].filter(([u, v]) => v - u > 0.3));
      }
    }
    for (const [s, e] of ivs) {
      const pieces = [];
      if (dash) for (let p = s; p < e; p += dash[0] + dash[1]) pieces.push([p, Math.min(e, p + dash[0])]); else pieces.push([s, e]);
      for (const [u, v] of pieces) {
        const seg = axis === 'z' ? { x0: c, z0: u, x1: c, z1: v } : { x0: u, z0: c, x1: v, z1: c };
        // split round the courts in 1 m steps (only Brick Row and the plaza come near them)
        if (underCourt(Math.min(seg.x0, seg.x1) - w, Math.min(seg.z0, seg.z1) - w, Math.max(seg.x0, seg.x1) + w, Math.max(seg.z0, seg.z1) + w)) {
          let st = null;
          for (let q = u; q <= v + 1e-6; q += 1) {
            const q1 = Math.min(v, q + 1), bad = axis === 'z' ? underCourt(c - w, q, c + w, q1) : underCourt(q, c - w, q1, c + w);
            if (!bad && st == null) st = q;
            if ((bad || q1 >= v) && st != null) { const end = bad ? q : q1; if (end - st > 0.4) lines.push(axis === 'z' ? { x0: c, z0: st, x1: c, z1: end, w, paint } : { x0: st, z0: c, x1: end, z1: c, w, paint }); st = null; }
          }
        } else lines.push({ ...seg, w, paint });
      }
    }
  };
  const doubleYellow = (axis, c, a0, a1, cut) => { run(axis, c - 0.11, a0, a1, 0.1, 'yellow', null, cut); run(axis, c + 0.11, a0, a1, 0.1, 'yellow', null, cut); };
  // a zebra: bars along the traffic (axis) across a band [b0, b1] on that axis, spanning [w0, w1] across it
  const zebra = (axis, b0, b1, w0, w1) => { for (let p = w0 + 0.45; p < w1 - 0.3; p += 1.1) run(axis, p, b0, b1, 0.5, 'white', null, -1e9); };
  // (a stencil reads for a driver heading (dx, dz): its letters stretched along the lane, as painted on roads)
  const stencil = (key, x, z, dx, dz, w = 2.8, l = 2.2) => cells.push({ x, z, w, l, yaw: Math.atan2(-dx, -dz), cell: DECAL[key], tint: 'white' });
  for (const s of [-1, 1]) {
    // the avenues: double yellow, the kerb-side edge line, the parking-lane line with its T marks
    const cx = s * AVE.center;
    doubleYellow('z', cx, -EXTENT, EXTENT, 4.6);
    run('z', s * (AVE.x0 + 0.3), -EXTENT, EXTENT, 0.12, 'white');
    run('z', s * AVE.park, -EXTENT, EXTENT, 0.12, 'white');
    for (let z = -EXTENT + 3; z < EXTENT; z += 6.5) if (!boxes.some(b => z > b.z0 - 5 && z < b.z1 + 5)) run('x', z, s * AVE.park, s * (AVE.park + 0.7), 0.12, 'white', null, -1e9);
  }
  // the cross streets (under the El and along the south wall): double yellow and edge lines
  for (const st of [SOUTH_ST, NORTH_ST]) {
    doubleYellow('x', st.center, -EXTENT, EXTENT, 4.6);
    run('x', st.z0 + 0.3, -EXTENT, EXTENT, 0.12, 'white');
    run('x', st.z1 - 0.3, -EXTENT, EXTENT, 0.12, 'white');
  }
  // the side streets at x 0: one-way toward the cross streets, two lanes split by white dashes, arrows in both
  run('z', 0, -EXTENT, SOUTH_ST.z0, 0.12, 'white', [3, 6]); run('z', 0, NORTH_ST.z1, EXTENT, 0.12, 'white', [3, 6]);
  for (const sx of [-1, 1]) { run('z', sx * (SIDE_ST.x1 - 0.3), -EXTENT, SOUTH_ST.z0, 0.12, 'white'); run('z', sx * (SIDE_ST.x1 - 0.3), NORTH_ST.z1, EXTENT, 0.12, 'white'); }
  for (const lx of [-2.25, 2.25]) {
    for (let z = SOUTH_ST.z0 - 16; z > -EXTENT + 10; z -= 32) cells.push({ x: lx, z, w: 1.1, l: 3.6, yaw: Math.PI, cell: DECAL.arrow, tint: 'white' });
    for (let z = NORTH_ST.z1 + 16; z < EXTENT - 10; z += 32) cells.push({ x: lx, z, w: 1.1, l: 3.6, yaw: 0, cell: DECAL.arrow, tint: 'white' });
  }
  // crossings: a zebra on every approach just outside the box, a stop bar behind it in the incoming lane and a
  // STOP stencil behind that. (Traffic keeps left here: the incoming lane is the one left of the centre line.)
  for (const b of boxes) {
    const cxm = (b.x0 + b.x1) / 2, czm = (b.z0 + b.z1) / 2;
    // approaches along z (from the south: heading +z; from the north: heading -z)
    for (const [dir, has] of [[1, b.ns[0]], [-1, b.ns[1]]]) {
      if (!has) continue;
      const edge = dir > 0 ? b.z0 : b.z1, band0 = edge - dir * 0.6, band1 = edge - dir * 3.8;
      zebra('z', Math.min(band0, band1), Math.max(band0, band1), b.x0, b.x1);
      // heading +z the left-hand lane is at larger x (see the avenue lanes), heading -z at smaller x; the one-way
      // side streets stop across both lanes
      const side = Math.abs(cxm) < 30;
      const lane = side ? [b.x0 + 0.3, b.x1 - 0.3] : dir > 0 ? [cxm + 0.2, cxm > 0 ? AVE.park : -AVE.x0] : [cxm > 0 ? AVE.x0 + 0.3 : -AVE.park, cxm - 0.2];
      const zs = edge - dir * 5.1;
      run('x', zs, Math.min(lane[0], lane[1]), Math.max(lane[0], lane[1]), 0.45, 'white', null, -1e9);
      if (side) for (const lx of [-2.25, 2.25]) stencil('stop', cxm + lx, zs - dir * 2.6, 0, dir, 2.6, 2.1);
      else stencil('stop', (lane[0] + lane[1]) / 2, zs - dir * 2.6, 0, dir);
    }
    // approaches along x (cross streets: from the west heading +x, from the east heading -x)
    for (const [dir, has] of [[1, b.ew[0]], [-1, b.ew[1]]]) {
      if (!has) continue;
      const edge = dir > 0 ? b.x0 : b.x1, band0 = edge - dir * 0.6, band1 = edge - dir * 3.8;
      zebra('x', Math.min(band0, band1), Math.max(band0, band1), b.z0, b.z1);
      // heading +x the left-hand lane is at larger z (facing +x, left is -z?): facing +x the left side is -z... see note
      const lane = dir > 0 ? [b.z0 + 0.3, czm - 0.2] : [czm + 0.2, b.z1 - 0.3];
      const xs = edge - dir * 5.1;
      run('z', xs, lane[0], lane[1], 0.45, 'white', null, -1e9);
      stencil('stop', xs - dir * 2.6, (lane[0] + lane[1]) / 2, dir, 0);
    }
  }
  // Brick Row: closed to traffic; a double yellow, edge lines, zebras at the alley mouths and PLAY STREET stencils
  doubleYellow('x', ROW.center, ROW.x0 + 1, ROW.x1 - 1, 0);
  run('x', ROW.z0 + 0.35, ROW.x0 + 1, ROW.x1 - 1, 0.12, 'white');
  run('x', ROW.z1 - 0.35, ROW.x0 + 1, ROW.x1 - 1, 0.12, 'white');
  for (const x of [-39, -13, 13, 39]) zebra('x', x - 1.6, x + 1.6, ROW.z0 + 0.5, ROW.z1 - 0.5);
  for (const [x, dir] of [[-26, 1], [26, -1], [-52, 1], [52, -1]]) { stencil('play', x, ROW.center + dir * -1.9, dir, 0, 3.3, 1.7); stencil('slow', x + dir * 4.6, ROW.center + dir * -1.9, dir, 0, 2.8, 2.0); }
  // the plaza: zebras across the mouths of the alleys between the courts
  for (const x of [-39, -13, 13, 39]) zebra('x', x - 1.6, x + 1.6, -21.8, -18.2);
  // a crossing over each avenue where Brick Row meets it, and a bus stop's BUS ONLY
  for (const s of [-1, 1]) zebra('z', ROW.center - 1.6, ROW.center + 1.6, s > 0 ? AVE.x0 : -AVE.x1, s > 0 ? AVE.x1 : -AVE.x0);
  cells.push({ x: AVE.center + 1.25, z: -24, w: 2.6, l: 0.9, yaw: Math.PI, cell: DECAL.bus, tint: 'white' }, { x: AVE.center + 1.25, z: -21.6, w: 2.6, l: 0.9, yaw: Math.PI, cell: DECAL.only, tint: 'white' });
  // manholes, storm drains at the kerbs, oil stains where cars wait
  const free = (x, z, r = 1) => !underCourt(x - r, z - r, x + r, z + r, 0.3) && !lines.some(L => x + r > Math.min(L.x0, L.x1) - L.w && x - r < Math.max(L.x0, L.x1) + L.w && z + r > Math.min(L.z0, L.z1) - L.w && z - r < Math.max(L.z0, L.z1) + L.w);
  const hole = (x, z) => { if (free(x, z, 0.4)) cells.push({ x, z, w: 0.9, l: 0.9, yaw: rng.range(0, 6.3), cell: rng.next() < 0.5 ? DECAL.manhole : DECAL.manhole2, tint: 'white' }); };
  for (const [x, z] of STEAM_VENTS) cells.push({ x, z, w: 0.9, l: 0.9, yaw: rng.range(0, 6.3), cell: DECAL.manhole, tint: 'white' });
  for (const s of [-1, 1]) for (let z = -EXTENT + 10; z < EXTENT; z += rng.range(22, 34)) hole(s * (AVE.center + (rng.next() < 0.5 ? 1.25 : -1.25)), z);
  for (const st of [SOUTH_ST, NORTH_ST]) for (let x = -EXTENT + 10; x < EXTENT; x += rng.range(24, 36)) hole(x, st.center + (rng.next() < 0.5 ? 2 : -2));
  for (const x of [-48, -20, 6, 33]) hole(x + rng.range(-2, 2), ROW.center + rng.range(-2.4, 2.4));
  hole(-30, -19.8); hole(24, -20.4);
  const drain = (x, z, yaw) => cells.push({ x, z, w: 1.2, l: 0.6, yaw, cell: DECAL.drain, tint: 'white' });
  for (const s of [-1, 1]) for (let z = -EXTENT + 18; z < EXTENT; z += 36) if (!boxes.some(b => z > b.z0 - 6 && z < b.z1 + 6)) { drain(s * (AVE.x0 + 0.35), z, Math.PI / 2); drain(s * (AVE.x1 - 0.35), z + 9, Math.PI / 2); }
  for (const st of [SOUTH_ST, NORTH_ST]) for (let x = -EXTENT + 14; x < EXTENT; x += 32) if (!boxes.some(b => x > b.x0 - 6 && x < b.x1 + 6)) { drain(x, st.z0 + 0.35, 0); drain(x + 11, st.z1 - 0.35, 0); }
  for (let k = 0; k < 46; k++) {
    const pick = rng.next(), s = rng.next() < 0.5 ? -1 : 1;
    const [x, z] = pick < 0.45 ? [s * (AVE.center + rng.range(-2.6, 3.2)), rng.range(-EXTENT, EXTENT)] : pick < 0.8 ? [rng.range(-EXTENT, EXTENT), (rng.next() < 0.5 ? SOUTH_ST : NORTH_ST).center + rng.range(-3, 3)] : [rng.range(-60, 60), rng.next() < 0.6 ? ROW.center + rng.range(-3, 3) : rng.range(-33, -19)];
    if (free(x, z, 0.8)) { const sz = rng.range(0.9, 2.2); cells.push({ x, z, w: sz, l: sz * rng.range(0.7, 1.3), yaw: rng.range(0, 6.3), cell: rng.next() < 0.5 ? DECAL.oil : DECAL.oil2, tint: 'white' }); }
  }
  return { lines, cells };
}

// builds the markings into one decal mesh (alpha blended over the ground, lit like paint)
const PAINT = { white: [0.5, 0.5, 0.47, 1], yellow: [0.6, 0.4, 0.05, 1] };
function decalMesh(ctx, mk) {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  const quad = (cx, cz, w, l, yaw, u0, v0, u1, v1, color, y = 0.004) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), b = pos.length / 3;
    for (const [lx, lz, u, v] of [[-w / 2, -l / 2, u0, v0], [w / 2, -l / 2, u1, v0], [-w / 2, l / 2, u0, v1], [w / 2, l / 2, u1, v1]]) {
      pos.push(cx + lx * c + lz * s, y, cz - lx * s + lz * c); nrm.push(0, 1, 0); uv.push(u, v); col.push(...color);
    }
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  };
  for (const L of mk.lines) {
    const len = Math.hypot(L.x1 - L.x0, L.z1 - L.z0), along = L.z1 !== L.z0;
    // the paint row tiles along u: one repeat every 3 m, from a random start so neighbouring lines differ
    const u0 = (L.x0 * 0.37 + L.z0 * 0.61) % 1;
    if (along) quad((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2, len, L.w, Math.PI / 2, u0, 0.012, u0 + len / 3, 0.113, PAINT[L.paint]);
    else quad((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2, len, L.w, 0, u0, 0.012, u0 + len / 3, 0.113, PAINT[L.paint]);
  }
  for (const C of mk.cells) {
    const [cx, cy, cw, ch] = C.cell, u0 = cx * 128 / 1024 + 0.002, v0 = (128 + cy * 128) / 1024 + 0.002, u1 = (cx + cw) * 128 / 1024 - 0.002, v1 = (128 + (cy + ch) * 128) / 1024 - 0.002;
    quad(C.x, C.z, C.w, C.l, C.yaw, u0, v0, u1, v1, [1, 1, 1, 1], 0.005);
  }
  const g = { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), color: new Float32Array(col), index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
  const tex = cachedTexture(ctx, 'streetdecals', () => T.streetDecals(), { aniso: 16 });
  const mesh = new Mesh(ctx.geometry(g), new Material({ color: [1, 1, 1], map: tex, roughness: 0.55, specular: 0.8, blend: 'alpha', depthWrite: false, layer: 1 }), { castShadow: false, reflect: false });
  mesh.order = -1;
  return mesh;
}

// ---- the ground ----
let streetTex = null;
const streetMaps = () => streetTex || (streetTex = T.street({ meters: 16 }));
// the row buildings' two detailed facades (brick and stone: their colour and window-light maps and their window layout)
let rowFac = null;
const rowFacades = () => rowFac || (rowFac = { brick: T.facade({ wall: '#6a4034', seed: 3, lit: 0.42, detail: { kind: 'brick', fireEscape: 0.34 } }), stone: T.facade({ wall: '#5a5c62', seed: 9, lit: 0.36, detail: { kind: 'stone', fireEscape: 0 } }) });
export function streetGround(ctx, scene, theme) {
  const color = cachedTexture(ctx, 'street-c', () => streetMaps().color, { aniso: 16 });
  const normal = cachedTexture(ctx, 'street-n', () => streetMaps().normal, { srgb: false, aniso: 16 });
  const rough = cachedTexture(ctx, 'street-r', () => streetMaps().rough, { srgb: false, aniso: 16 });
  const noise = makeNoise2D(29), tint = lin(theme.ground);
  // a slow drift so the 16 m tile never shows; the park's own yard (inside the walls) a touch paler and drier
  const shade = (x, z) => {
    const n = noise.fbm(x / 45, z / 45, 3), k = 1 + n * 0.22 + noise(x / 11, z / 11) * 0.05;
    const yard = Math.abs(x) < 63 && z > -36 && z < 33 && !(z > ROW.z0 && z < ROW.z1) ? 1.08 : 1;
    return [tint[0] * k * yard, tint[1] * k * yard, tint[2] * k * yard * (1 + n * 0.05)];
  };
  const geo = shadedPlane(-EXTENT - 10, EXTENT + 10, -EXTENT - 10, EXTENT + 10, 9, 16, shade, -0.005);
  const ground = new Mesh(ctx.geometry(geo), new Material({ color: [1, 1, 1], map: color, normalMap: normal, normalScale: 0.5, roughMap: rough, roughness: 0.42, specular: 1.0 }), { castShadow: false, reflect: false });
  ground.order = -2;
  scene.add(ground);
  return ground;
}

// ---- buildings ----
const FLOOR = 3.4, BAY = 3.2;
const FAC = { bays: 6, floors: 5 }; // one facade tile: 6 bays x 5 floors (19.2 x 17 m)
// four walls of a block with the facade mapped in metres (ground floor at the bottom of a texture row), offset by
// whole bays/floors so neighbours don't match; the roof is separate
function blockWalls(out, x, z, w, d, h, ou, ov, tint) {
  const TW = BAY * FAC.bays, TH = FLOOR * FAC.floors;
  for (const [fx, fz, len, yaw] of [[x, z + d / 2, w, 0], [x, z - d / 2, w, Math.PI], [x + w / 2, z, d, Math.PI / 2], [x - w / 2, z, d, -Math.PI / 2]]) {
    const g = G.quad(len, h, { bottom: true });
    for (let i = 0; i < 4; i++) { const lx = g.position[i * 3], ly = g.position[i * 3 + 1]; g.uv[i * 2] = ou + (lx + len / 2) / TW; g.uv[i * 2 + 1] = ov + 1 - ly / TH; }
    out.push({ geo: g, matrix: TR(fx, 0, fz, yaw), color: tint });
  }
}
// rooftops: a cornice and roof slab, and now and then a water tank on legs, a bulkhead, vents and an aerial
function roofTop(matte, metal, lamps, rng, x, z, w, d, h) {
  put(matte, G.box(w + 0.5, 0.75, d + 0.5), x, h + 0.37, z, '#2a2624');
  put(matte, G.box(w - 0.4, 0.2, d - 0.4), x, h + 0.65, z, '#1b1a1a');
  if (rng.next() < 0.6) put(matte, G.box(Math.min(5, w * 0.3), 2.6, Math.min(4, d * 0.3)), x + rng.range(-w, w) * 0.25, h + 0.75 + 1.3, z + rng.range(-d, d) * 0.25, '#2f2b29');
  for (let k = 0; k < rng.int(1, 3); k++) put(metal, G.box(1.2, 0.8, 1.6), x + rng.range(-w, w) * 0.35, h + 1.15, z + rng.range(-d, d) * 0.35, '#5a5f63');
  if (h < 42 && rng.next() < 0.45) {
    // a wooden water tank on a steel stand, with a conical cap
    const tx = x + rng.range(-w, w) * 0.25, tz = z + rng.range(-d, d) * 0.25, ty = h + 0.75;
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]]) put(metal, G.box(0.14, 3.2, 0.14), tx + lx, ty + 1.6, tz + lz, '#26282a');
    put(matte, G.cylinder(1.7, 1.7, 3.4, 12, { y0: true }), tx, ty + 3.2, tz, '#5a4434');
    put(matte, G.cylinder(0.05, 1.9, 1.2, 12, { y0: true }), tx, ty + 6.6, tz, '#3a2e26');
    for (const by of [0.6, 1.7, 2.8]) put(metal, G.cylinder(1.72, 1.72, 0.08, 12, { y0: true }), tx, ty + 3.2 + by, tz, '#222426');
  }
  if (h > 30 && rng.next() < 0.5) {
    const ax = x + rng.range(-w, w) * 0.2, az = z + rng.range(-d, d) * 0.2, ah = rng.range(5, 10);
    put(metal, G.cylinder(0.06, 0.1, ah, 6, { y0: true }), ax, h + 0.75, az, '#3a3c3e');
    lamps.push({ geo: G.sphere(0.2, 6, 5), matrix: TR(ax, h + 0.75 + ah, az), color: [1, 0.08, 0.05, 1] }); // aviation light (red)
  }
}

// each row: [x0, x1] spans along a front line (front: z for 'z' rows, x for the side columns), facing dir
function rowSpans() {
  const xs = [[-EXTENT, -AVE.walk], [-AVE.x0 + 3, SIDE_ST.x0 - 3], [SIDE_ST.x1 + 3, AVE.x0 - 3], [AVE.walk, EXTENT]];
  return [
    ...xs.map(([a, b]) => ({ axis: 'x', a, b, front: SOUTH_ST.walkOut, dir: -1 })),   // south row, fronts facing +z (the park)
    ...xs.map(([a, b]) => ({ axis: 'x', a, b, front: NORTH_ST.walkOut, dir: 1 })),    // north row, fronts facing -z
    { axis: 'z', a: SOUTH_ST.walkIn + 0.5, b: NORTH_ST.walkIn - 0.5, front: AVE.walk, dir: 1 },   // east column
    { axis: 'z', a: SOUTH_ST.walkIn + 0.5, b: NORTH_ST.walkIn - 0.5, front: -AVE.walk, dir: -1 }, // west column
  ];
}

// ---- the whole street scene ----
export function cityStreets(ctx, scene, rng) {
  // everything here goes into one batch of its own that casts no shadows (the shadow map only covers the courts and
  // the player, inside the walls): matte and metal are the same list
  const street = [], matte = street, metal = street;
  const ups = [], glow = []; // glow: small coloured lights (street lamp lenses, aviation lights, barricade lamps)
  scene.add(decalMesh(ctx, streetMarkings()));
  // kerbs and sidewalks (raised outside the park; inside its bounds they lie flush so nobody's feet sink)
  const walk = '#5d5a56', kerb = '#77736d';
  const slab = (x0, x1, z0, z1, h = 0.15) => {
    const along = (x1 - x0) > (z1 - z0), L = along ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / 2.4)), step = L / n;
    for (let i = 0; i < n; i++) {
      const a = (along ? x0 : z0) + i * step;
      if (along) put(matte, G.box(step - 0.03, h, z1 - z0), a + step / 2, h / 2, (z0 + z1) / 2, i % 3 ? walk : '#57544f');
      else put(matte, G.box(x1 - x0, h, step - 0.03), (x0 + x1) / 2, h / 2, a + step / 2, i % 3 ? walk : '#57544f');
    }
  };
  const cut = (a, b, holes) => { let iv = [[a, b]]; for (const [h0, h1] of holes) iv = iv.flatMap(([s, e]) => [[s, Math.min(e, h0)], [Math.max(s, h1), e]].filter(([u, v]) => v - u > 0.5)); return iv; };
  for (const s of [-1, 1]) {
    // the avenue's outer sidewalk, its kerb line, and the park-side kerb strip
    for (const [z0, z1] of cut(-EXTENT, EXTENT, [[SOUTH_ST.z0, SOUTH_ST.z1], [NORTH_ST.z0, NORTH_ST.z1]])) {
      slab(s > 0 ? AVE.x1 : -AVE.walk, s > 0 ? AVE.walk : -AVE.x1, z0, z1);
      put(matte, G.box(0.18, 0.16, z1 - z0), s * (AVE.x1 + 0.09), 0.08, (z0 + z1) / 2, kerb);
    }
    for (const [z0, z1] of cut(-EXTENT, EXTENT, [[SOUTH_ST.walkOut, SOUTH_ST.walkIn], [NORTH_ST.walkIn, NORTH_ST.walkOut]])) {
      const inside = z0 > SOUTH_ST.walkIn - 1 && z1 < NORTH_ST.walkIn + 1;
      if (inside) put(matte, G.box(0.45, 0.012, z1 - z0), s * (AVE.x0 - 0.25), 0.006, (z0 + z1) / 2, kerb);
      else { slab(s > 0 ? AVE.x0 - 3 : -AVE.x0, s > 0 ? AVE.x0 : -AVE.x0 + 3, z0, z1); put(matte, G.box(0.18, 0.16, z1 - z0), s * (AVE.x0 - 0.09), 0.08, (z0 + z1) / 2, kerb); }
    }
  }
  for (const st of [SOUTH_ST, NORTH_ST]) {
    const out = st === SOUTH_ST ? [st.walkOut, st.z0] : [st.z1, st.walkOut], inn = st === SOUTH_ST ? [st.z1, st.walkIn] : [st.walkIn, st.z0];
    for (const [x0, x1] of cut(-EXTENT, EXTENT, [[-AVE.x1, -AVE.x0], [SIDE_ST.x0, SIDE_ST.x1], [AVE.x0, AVE.x1]])) slab(x0, x1, out[0], out[1]);
    for (const [x0, x1] of cut(-EXTENT, EXTENT, [[-AVE.x1, -AVE.x0], [AVE.x0, AVE.x1]])) slab(x0, x1, inn[0], inn[1]);
  }
  for (const [z0, z1] of [[-EXTENT, SOUTH_ST.z0], [NORTH_ST.z1, EXTENT]]) for (const sx of [-1, 1]) slab(sx > 0 ? SIDE_ST.x1 : -SIDE_ST.walk, sx > 0 ? SIDE_ST.walk : SIDE_ST.x0, z0, z1);
  // Brick Row's north sidewalk (flush: the walkers' path) and its kerb line
  put(matte, G.box(ROW.x1 - ROW.x0, 0.012, 32.75 - ROW.z1 - 0.2), 0, 0.006, (ROW.z1 + 0.2 + 32.75) / 2, '#4f4c48');
  put(matte, G.box(ROW.x1 - ROW.x0, 0.02, 0.2), 0, 0.01, ROW.z1 + 0.1, kerb);

  // buildings
  // (the two facades are drawn once and uploaded once: coming back to the park reuses them)
  const { brick: fBrick, stone: fStone } = rowFacades();
  const mBrick = new Material({ map: cachedTexture(ctx, 'street-fb-c', () => fBrick.color, { aniso: 8 }), emissiveMap: cachedTexture(ctx, 'street-fb-e', () => fBrick.emissive, { aniso: 8 }), emissive: [2.1, 1.9, 1.6], roughness: 0.86 });
  const mStone = new Material({ map: cachedTexture(ctx, 'street-fs-c', () => fStone.color, { aniso: 8 }), emissiveMap: cachedTexture(ctx, 'street-fs-e', () => fStone.emissive, { aniso: 8 }), emissive: [1.9, 1.85, 1.75], roughness: 0.7 });
  const wBrick = [], wStone = [], fronts = [];
  const tints = { brick: ['#ffffff', '#efdcd2', '#d8c4bc', '#f4e6d8'], stone: ['#ffffff', '#dcdfe8', '#efe6d6', '#c8ccd2'] };
  const building = (x, z, w, d, floors, kind, face) => {
    const h = floors * FLOOR, ou = rng.int(0, FAC.bays - 1) / FAC.bays, ov = rng.int(0, FAC.floors - 1) / FAC.floors;
    blockWalls(kind === 'brick' ? wBrick : wStone, x, z, w, d, h, ou, ov, c4(rng.pick(tints[kind])));
    roofTop(matte, metal, glow, rng, x, z, w, d, h);
    if (face) fronts.push({ x, z, w, d, h, kind, face, ou, ov });
  };
  for (const R of rowSpans()) {
    let p = R.a;
    while (p < R.b - 6) {
      const wid = Math.min(R.b - p, rng.range(9, 22)), dep = rng.range(12, 18), near = R.axis === 'z' || Math.abs(p) < 90;
      const floors = rng.int(near ? 4 : 5, near ? 11 : 15), kind = rng.next() < 0.6 ? 'brick' : 'stone';
      const c = p + wid / 2;
      if (R.axis === 'x') building(c, R.front + R.dir * dep / 2, wid, dep, floors, kind, R.dir < 0 ? 'z+' : 'z-');
      else building(R.front + R.dir * dep / 2, c, dep, wid, floors, kind, R.dir > 0 ? 'x-' : 'x+');
      p += wid + (rng.next() < 0.18 ? rng.range(1.5, 3) : 0);
    }
  }
  // the skyline beyond: taller blocks out in the haze (no shopfronts)
  for (let i = 0; i < 34; i++) {
    const a = i / 34 * Math.PI * 2 + rng.range(-0.05, 0.05), dd = rng.range(105, 165);
    const x = Math.cos(a) * dd * 1.1, z = Math.sin(a) * dd;
    if (Math.abs(x) < AVE.walk + 12 && Math.abs(z) < 70) continue;
    building(x, z, rng.range(14, 26), rng.range(14, 26), rng.int(9, 24), rng.next() < 0.4 ? 'brick' : 'stone', null);
  }
  scene.add(new Mesh(ctx.geometry(G.merge(PR.bake(wBrick))), mBrick));
  scene.add(new Mesh(ctx.geometry(G.merge(PR.bake(wStone))), mStone));

  // shopfronts on the street faces nearest the park: a lit display window, an awning, a neon sign over it
  const shop = [], neon = [], neonFlicker = [];
  const neonTex = cachedTexture(ctx, 'neonsigns', () => T.neonSigns(), { aniso: 8 });
  const signUV = i => [(i % 2) * 0.5, Math.floor(i / 2) * 0.25, 0.5, 0.25];
  let flickers = 0;
  for (const f of fronts) {
    const along = f.face[0] === 'z' ? f.w : f.d;
    if (Math.hypot(f.x, f.z) > 120 || rng.next() < 0.25) continue;
    const n = along > 15 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * along / n + rng.range(-1, 1), ww = Math.min(along / n - 1.5, rng.range(3.2, 5));
      if (ww < 2.4) continue;
      // local frame: out = the face normal; a point `off` along the face, `o` out from it
      const nx = f.face === 'x+' ? 1 : f.face === 'x-' ? -1 : 0, nz = f.face === 'z+' ? 1 : f.face === 'z-' ? -1 : 0;
      const fx = f.x + nx * (f.face[0] === 'x' ? f.w / 2 : 0), fz = f.z + nz * (f.face[0] === 'z' ? f.d / 2 : 0);
      const ax = nz !== 0 ? 1 : 0, az = nx !== 0 ? 1 : 0, yaw = Math.atan2(nx, nz);
      const P = (o) => [fx + ax * off + nx * o, fz + az * off + nz * o];
      const [wx, wz] = P(0.04), warm = rng.pick([[0.62, 0.48, 0.3], [0.5, 0.52, 0.58], [0.6, 0.4, 0.24], [0.42, 0.55, 0.48]]);
      const sq = G.quad(ww, 2.3, { bottom: true }), half = rng.next() < 0.5 ? 0 : 0.5;
      for (let i = 0; i < 4; i++) sq.uv[i * 2] = half + sq.uv[i * 2] * 0.5;
      shop.push({ geo: sq, matrix: TR(wx, 0.35, wz, yaw), color: [...warm, 1] });
      put(matte, G.box(ww + 0.3, 0.25, 0.2), ...(([a, b]) => [a, 2.75, b])(P(0.1)), '#1d1b1a', yaw);         // header
      put(matte, G.box(ww + 0.3, 0.12, 0.2), ...(([a, b]) => [a, 0.3, b])(P(0.1)), '#2a2725', yaw);         // stall riser
      const awn = rng.pick(['#7a1f1c', '#1f4d3a', '#22324f', '#5a3a1a', '#3a3a3a']);
      const am = M.m4mul(M.m4(), TR(...(([a, b]) => [a, 3.0, b])(P(0.75)), yaw), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, 0.38)));
      matte.push({ geo: G.box(ww + 0.4, 0.06, 1.5), matrix: am, color: c4(awn) });
      // the neon sign above the awning; some flicker
      const si = rng.int(0, T.NEON_WORDS.length - 1), [u0, v0, uw, vh] = signUV(si);
      const sg = G.quad(Math.min(ww + 0.6, 4.6), 1.15);
      for (let i = 0; i < 4; i++) { sg.uv[i * 2] = u0 + sg.uv[i * 2] * uw; sg.uv[i * 2 + 1] = v0 + sg.uv[i * 2 + 1] * vh; }
      const [sx, sz] = P(0.18), flick = flickers < 3 && rng.next() < 0.22;
      if (flick) flickers++;
      (flick ? neonFlicker : neon).push({ geo: sg, matrix: TR(sx, 4.15, sz, yaw), color: [1, 1, 1, 1] });
    }
  }
  if (shop.length) scene.add(new Mesh(ctx.geometry(G.merge(PR.bake(shop))), new Material({ map: cachedTexture(ctx, 'shopwindow', () => T.shopWindow(), {}), color: [1.5, 1.45, 1.35], shading: 'unlit', fog: false }), { castShadow: false, reflect: false }));
  const neonMat = new Material({ map: neonTex, color: [2.6, 2.6, 2.6], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
  if (neon.length) { const m = new Mesh(ctx.geometry(G.merge(PR.bake(neon))), neonMat, { castShadow: false, reflect: false }); m.order = 3; scene.add(m); }
  if (neonFlicker.length) {
    const fm = new Material({ map: neonTex, color: [2.6, 2.6, 2.6], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
    const m = new Mesh(ctx.geometry(G.merge(PR.bake(neonFlicker))), fm, { castShadow: false, reflect: false }); m.order = 3; scene.add(m);
    let t = 0, off = 0;
    ups.push(dt => {
      t += dt;
      // a failing tube: steady, then a burst of stutters, sometimes out for a moment
      if (off > 0) off -= dt; else if (Math.random() < dt * 0.25) off = Math.random() * 0.6;
      const buzz = Math.sin(t * 2.3) > 0.6 ? (Math.random() < 0.35 ? 0.15 : 1) : 1;
      const k = off > 0 ? 0.05 : buzz * (0.92 + Math.random() * 0.08);
      fm.color = [2.6 * k, 2.6 * k, 2.6 * k];
    });
  }

  // street lights: tall poles on the sidewalks with a cobra head; a warm pool of light on the street under each
  const pools = [];
  const light = (x, z, yaw) => {
    put(metal, G.cylinder(0.09, 0.14, 7.6, 8, { y0: true }), x, 0, z, '#2a2d30');
    const arm = [[x, 7.4, z], [x + Math.sin(yaw) * 1.2, 7.9, z + Math.cos(yaw) * 1.2], [x + Math.sin(yaw) * 2.2, 7.95, z + Math.cos(yaw) * 2.2]];
    metal.push({ geo: G.tube(arm, 0.06, 6), color: c4('#2a2d30') });
    const hx = x + Math.sin(yaw) * 2.5, hz = z + Math.cos(yaw) * 2.5;
    put(metal, G.box(0.42, 0.18, 0.8), hx, 7.92, hz, '#33373a', yaw);
    glow.push({ geo: G.box(0.32, 0.04, 0.6), matrix: TR(hx, 7.82, hz, yaw), color: [1.1, 0.95, 0.75, 1] });
    pools.push({ geo: G.plane(13, 13), matrix: TR(hx, 0.02, hz), color: [1, 0.68, 0.36, 1] });
  };
  for (const s of [-1, 1]) for (let z = -EXTENT + 8; z < EXTENT; z += 24) if (!CROSSINGS.some(b => z > b.z0 - 3 && z < b.z1 + 3)) light(s * (AVE.x1 + 0.6), z, -s * Math.PI / 2);
  for (const st of [SOUTH_ST, NORTH_ST]) for (let x = -EXTENT + 14; x < EXTENT; x += 26) if (!CROSSINGS.some(b => x > b.x0 - 3 && x < b.x1 + 3)) light(x, st === SOUTH_ST ? st.z0 - 0.6 : st.z1 + 0.6, st === SOUTH_ST ? 0 : Math.PI);
  for (const sz of [-1, 1]) for (let k = 1; k < 6; k++) light(SIDE_ST.x1 + 0.6, sz * (sz > 0 ? NORTH_ST.z1 : -SOUTH_ST.z0) + sz * k * 22, -Math.PI / 2);
  // Brick Row's lamps along its north sidewalk, arms out over the play street
  for (let x = -55; x <= 55; x += 22) light(x + 4, 32.3, Math.PI);
  // and the plaza's own lamps (the park's lanterns at z -27) get a warm globe and a pool of light under them
  for (let i = 0; i < 10; i++) {
    const lx = -40 + i * 9 + 0.5;
    if (plazaLampOff(lx - 0.5)) continue; // (v0.4.8.8: the Pro-Am HUB stands there)
    glow.push({ geo: G.cylinder(0.106, 0.198, 0.35, 8, { y0: true }), matrix: TR(lx, 5.5 + 0.22 - 0.345, -27), color: [1, 0.78, 0.48, 1] });
    pools.push({ geo: G.plane(10, 10), matrix: TR(lx, 0.02, -27), color: [0.9, 0.62, 0.34, 1] });
  }
  const poolMesh = new Mesh(ctx.geometry(G.merge(PR.bake(pools))), new Material({ map: cachedTexture(ctx, 'glowspot', () => T.glowSpot(128, 1.6), { wrap: 'clamp' }), color: [0.55, 0.5, 0.45], shading: 'unlit', blend: 'add', depthWrite: false }), { castShadow: false, reflect: false });
  poolMesh.order = 0; scene.add(poolMesh);

  // traffic signals: a post on the far side of each approach, the head facing the oncoming lane. Group A faces
  // traffic along z (the avenues, the side streets), group B along x; they take turns.
  const lamp = { A: { r: [], y: [], g: [] }, B: { r: [], y: [], g: [] } };
  const signal = (x, z, dx, dz, grp) => {
    const yaw = Math.atan2(-dx, -dz); // the head looks back down the approach
    put(metal, G.cylinder(0.08, 0.1, 3.0, 8, { y0: true }), x, 0, z, '#2b2e24');
    put(metal, G.box(0.38, 1.05, 0.3), x, 3.55, z, '#2e3324', yaw);
    for (const [k, y] of [['r', 3.88], ['y', 3.55], ['g', 3.22]]) {
      const m = M.m4mul(M.m4(), TR(x, y, z, yaw), M.m4mul(M.m4(), TR(0, 0, 0.16), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2))));
      matte.push({ geo: G.cylinder(0.12, 0.12, 0.02, 10), matrix: m, color: c4(k === 'r' ? '#2a0a08' : k === 'y' ? '#2a1c06' : '#06200e') });
      const mo = M.m4mul(M.m4(), TR(x, y, z, yaw), M.m4mul(M.m4(), TR(0, 0, 0.175), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2))));
      lamp[grp][k].push({ geo: G.cylinder(0.12, 0.12, 0.02, 10), matrix: mo, color: k === 'r' ? [1, 0.06, 0.03, 1] : k === 'y' ? [1, 0.55, 0.05, 1] : [0.1, 1, 0.45, 1] });
      put(metal, G.box(0.3, 0.03, 0.2), ...(([a, b]) => [a, y + 0.15, b])([x - Math.sin(yaw) * -0.26, z - Math.cos(yaw) * -0.26]), '#24271e', yaw); // visor
    }
  };
  for (const b of CROSSINGS) {
    // heading +z (from the south): post past the box on the driver's (left, +x) side; and so on round
    if (b.ns[0]) signal(b.x1 + 0.6, b.z1 + 0.8, 0, 1, 'A');
    if (b.ns[1]) signal(b.x0 - 0.6, b.z0 - 0.8, 0, -1, 'A');
    if (b.ew[0]) signal(b.x1 + 0.8, b.z0 - 0.6, 1, 0, 'B');
    if (b.ew[1]) signal(b.x0 - 0.8, b.z1 + 0.6, -1, 0, 'B');
  }
  const sigMeshes = {};
  for (const grp of ['A', 'B']) for (const k of ['r', 'y', 'g']) {
    const m = new Mesh(ctx.geometry(G.merge(PR.bake(lamp[grp][k]))), new Material({ color: [4, 4, 4], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
    scene.add(m); sigMeshes[grp + k] = m;
  }
  let sigT = rng.range(0, 30);
  const setSignals = () => {
    const t = sigT % 30, a = t < 12 ? 'g' : t < 15 ? 'y' : 'r', b = t >= 16 && t < 27 ? 'g' : t >= 27 ? 'y' : 'r';
    for (const k of ['r', 'y', 'g']) { sigMeshes['A' + k].visible = a === k; sigMeshes['B' + k].visible = b === k; }
  };
  setSignals();
  ups.push(dt => { sigT += dt; setSignals(); });

  // Brick Row's ends: sawhorse barricades (striped boards, amber lamps) closing it to traffic
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const x = s * 63.4, z = ROW.z0 + 1.6 + k * 2.6;
    for (const dz of [-0.9, 0.9]) put(metal, G.box(0.08, 1.0, 0.08), x, 0.5, z + dz, '#d8d4c8');
    for (let i = 0; i < 4; i++) put(matte, G.box(0.06, 0.2, 0.46), x, 0.85, z - 0.69 + i * 0.46, i % 2 ? '#f2efe6' : '#e0601c');
    glow.push({ geo: G.box(0.12, 0.12, 0.12), matrix: TR(x, 1.05, z + 0.9), color: [1, 0.55, 0.08, 1] });
  }
  // hydrants and a bus stop on the east avenue sidewalk
  for (const [x, z] of [[AVE.x1 + 0.7, -28], [-AVE.x1 - 0.7, 8], [AVE.x1 + 0.7, 30], [-AVE.x1 - 0.7, -30], [12, SOUTH_ST.z0 - 0.8], [-20, NORTH_ST.z1 + 0.8]]) {
    put(matte, G.cylinder(0.14, 0.17, 0.7, 8, { y0: true }), x, 0.15, z, '#a8221c');
    put(matte, G.sphere(0.15, 8, 6), x, 0.85, z, '#a8221c');
    put(matte, G.cylinder(0.05, 0.05, 0.36, 6), x, 0.6, z, '#8a1c18', Math.PI / 2);
  }
  {
    const bx = AVE.x1 + 1.9, bz = -22.5;
    put(metal, G.box(0.08, 2.5, 0.08), bx - 0.6, 1.4, bz - 1.8, '#30343a'); put(metal, G.box(0.08, 2.5, 0.08), bx - 0.6, 1.4, bz + 1.8, '#30343a');
    put(metal, G.box(0.08, 2.5, 0.08), bx + 0.6, 1.4, bz - 1.8, '#30343a'); put(metal, G.box(0.08, 2.5, 0.08), bx + 0.6, 1.4, bz + 1.8, '#30343a');
    put(matte, G.box(1.5, 0.08, 3.9), bx, 2.66, bz, '#26292d');
    put(matte, G.box(0.5, 0.06, 2.6), bx + 0.35, 0.6, bz, '#3a3f45');
    glow.push({ geo: G.box(0.06, 1.6, 1.1), matrix: TR(bx + 0.6, 1.25, bz + 1.4), color: [0.5, 0.55, 0.62, 1] }); // the lit ad panel
  }
  // parked cars along the avenues' outer kerbs and the cross streets (lights off)
  const paints = ['#7a1f1c', '#d8d4cc', '#1d2731', '#3b5873', '#6b6f75', '#2f4a3a', '#8a6a2a', '#202224', '#5a2a4a'];
  const park = (x, z, yaw) => { for (const p of PR.car(rng.pick(paints))) matte.push({ ...p, matrix: M.m4mul(M.m4(), TR(x, 0, z, yaw), p.matrix || M.m4()) }); };
  for (const s of [-1, 1]) for (let z = -EXTENT + 6; z < EXTENT; z += rng.range(5.6, 9)) {
    if (CROSSINGS.some(b => z > b.z0 - 9 && z < b.z1 + 9) || Math.abs(z - ROW.center) < 5 || (s > 0 && z > -27 && z < -18) || (s > 0 && Math.abs(z - 21.5) < 4)) continue;
    if (rng.next() < 0.3) continue;
    park(s * (AVE.park + 1.35), z, s > 0 ? 0 : Math.PI);
  }
  for (const st of [SOUTH_ST, NORTH_ST]) for (let x = -EXTENT + 6; x < EXTENT; x += rng.range(5.6, 9)) {
    if (CROSSINGS.some(b => x > b.x0 - 9 && x < b.x1 + 9) || rng.next() < 0.4) continue;
    park(x, st.z0 + 1.2, Math.PI / 2);
  }

  // windows that switch on and off, and a couple of TVs flickering: small quads over unlit windows of the blocks
  // facing the park, added light (additive), their colours rewritten a few times a second
  const win = [], slots = [];
  for (const f of fronts) {
    if (Math.hypot(f.x, f.z) > 95) continue;
    const L = f.kind === 'brick' ? fBrick.layout : fStone.layout, along = f.face[0] === 'z' ? f.w : f.d;
    const nx = f.face === 'x+' ? 1 : f.face === 'x-' ? -1 : 0, nz = f.face === 'z+' ? 1 : f.face === 'z-' ? -1 : 0;
    const fx = f.x + nx * (f.face[0] === 'x' ? f.w / 2 : 0), fz = f.z + nz * (f.face[0] === 'z' ? f.d / 2 : 0), yaw = Math.atan2(nx, nz);
    // quad local x runs along the face: +x local = (cos yaw, -sin yaw)
    const ex = Math.cos(yaw), ez = -Math.sin(yaw);
    for (let fl = 1; fl < Math.floor(f.h / FLOOR); fl++) for (let bay = 0; bay < Math.floor(along / BAY); bay++) {
      if (rng.next() > 0.22) continue;
      const lx = -along / 2 + (bay + 0.5) * BAY;
      const u = f.ou + (lx + along / 2) / (BAY * FAC.bays), tb = Math.floor(((u % 1) + 1) % 1 * FAC.bays);
      const yc = fl * FLOOR + L.win[1] + L.win[3] / 2;
      const v = f.ov + 1 - yc / (FLOOR * FAC.floors), tf = Math.floor(((v % 1) + 1) % 1 * FAC.floors);
      if (L.lit[tf][tb]) continue;
      // the window centre in this cell (texture bays are centred, so the cell centre is the window centre)
      const cxu = (tb + 0.5) / FAC.bays, lx2 = (Math.floor(u) + cxu - f.ou) * BAY * FAC.bays - along / 2;
      if (Math.abs(lx2) > along / 2 - 1) continue;
      win.push({ geo: G.quad(L.win[2] - 0.2, L.win[3] - 0.2), matrix: TR(fx + ex * lx2 + nx * 0.03, yc, fz + ez * lx2 + nz * 0.03, yaw), color: [0, 0, 0, 1] });
      slots.push({ on: rng.next() < 0.3, t: rng.range(2, 40), tv: rng.next() < 0.15, hue: rng.pick([[1, 0.78, 0.45], [1, 0.85, 0.6], [0.85, 0.92, 1]]) });
    }
  }
  if (win.length) {
    const geo = G.merge(PR.bake(win)), gl = ctx.geometry(geo, true), cols = geo.color;
    const wm = new Mesh(gl, new Material({ color: [1.1, 0.95, 0.75], shading: 'unlit', blend: 'add', depthWrite: false, fog: false }), { castShadow: false, reflect: false });
    wm.order = 3; scene.add(wm);
    let acc = 0;
    ups.push(dt => {
      acc += dt;
      for (const s of slots) { s.t -= dt; if (s.t <= 0) { s.on = !s.on; s.t = s.on ? rng.range(15, 70) : rng.range(8, 50); } }
      if (acc < 0.12) return;
      acc = 0;
      slots.forEach((s, i) => {
        let c = [0, 0, 0];
        if (s.on && s.tv) { const k = 0.25 + Math.random() * 0.45; c = [0.35 * k, 0.5 * k, 1.0 * k]; }
        else if (s.on) c = s.hue;
        // brighter under the ceiling than at the sill (quad corners: bottom two, then top two)
        for (let v = 0; v < 4; v++) { const k = v < 2 ? 0.45 : 0.85; cols.set([c[0] * k, c[1] * k, c[2] * k, 1], (i * 4 + v) * 4); }
      });
      ctx.updateAttribute(gl, 'color', cols);
    });
  }
  scene.add(new Mesh(ctx.geometry(G.merge(PR.bake(glow))), new Material({ color: [3, 3, 3], shading: 'unlit', fog: false }), { castShadow: false, reflect: false }));
  scene.add(new Mesh(ctx.geometry(G.merge(PR.bake(street))), new Material({ color: [1, 1, 1], roughness: 0.7, metalness: 0.2, specular: 0.8 }), { castShadow: false, reflect: false }));
  return { update(dt) { for (const f of ups) f(dt); } };
}
