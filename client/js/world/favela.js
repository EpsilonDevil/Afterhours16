// v0.4.8.7 The Favelas, the event park on a hillside at golden hour going into dusk. The park keeps its standard layout;
// round it a ring of streets (the dirtbikes' loop, the police bike's too), and beyond them the favela climbs the slopes on
// three sides: terraces of two-to-four storey houses in painted concrete (terracotta, turquoise, yellow, pink, lime,
// white) and bare brick, packed wall to wall, their flat roof slabs (lajes) carrying blue water tanks, satellite dishes,
// potted plants, laundry lines and now and then somebody up top or a kid with a kite; stairways (becos) cut up between
// them; shops on the street (a mercadinho, a bar, açaí, a barber, a lanchonete, a bakery, ice cream), a tangle of
// wires from the poles to the houses, a police car parked on the east corner with its light bar going. The windows light
// up and go dark over the evening, a TV flickers here and there, string lights twinkle on a few lajes and the laundry
// sways. The sky is a dome of its own: deep blue overhead, lilac and pink, orange round the low sun in the west.
// Also here: the park life (favelaLife: people on the stairs and the sidewalks, neighbours at their doors, stray dogs,
// cats on the walls, chickens, a pigeon flock, the dirtbike riders) and its random events (favelaEvents: the police chase
// that never catches anyone, the foot chase, the kite fight, the samba drums coming down the street, a block's power
// flickering, a tropical shower), and the kites and bunting of the `pipa` streak (streakfx.js).
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG, makeNoise2D } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { cachedTexture } from './court.js';
import * as PR from './props.js';
import { PARK_COURTS } from './themes.js';
import { shadedPlane, camClear } from './harbor.js';
import { skinGeo, figureParts, poseFigure, MOVES, FB } from './horror.js';
import * as FX from '../core/favelasound.js';

const lin = hex => M.hexLinear(hex);
const c4 = (hex, a = 1) => (typeof hex === 'string' ? [...lin(hex), a] : hex);
const DEG = Math.PI / 180;
const Tm = (x, y, z) => M.m4translation(M.m4(), x, y, z);
const TR = (x, y, z, yaw = 0) => M.m4fromYaw(M.m4(), x, y, z, yaw);
const Rx = a => M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, a));
const Rz = a => M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, a));
const Sc = (x, y, z) => M.m4compose(M.m4(), [0, 0, 0], M.q4(), [x, y, z]);
const mul = (...ms) => ms.reduce((a, b) => M.m4mul(M.m4(), a, b));
const smooth = M.smooth || (x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); });

// the painted walls, the trims, the event's colours
export const PALETTE = ['#d9643a', '#2fb8b0', '#f2c230', '#e86aa0', '#9ad13a', '#f4efe4', '#e8934a', '#6aa8e0', '#c8452e', '#f7e6c4'];
export const HUE = { sun: '#ffb347', kite: ['#f2c230', '#2fb8b0', '#e86aa0', '#9ad13a', '#ff6a2a', '#6aa8e0'], tank: '#2f6fd0', police: '#1f4fb4' };

// ---- the plan (world metres; +z north, the park is |x| < 63.6, z -34.3 .. 33.4) ----
// the streets round the park: centre lines and half width (two lanes each, ±lane from the centre). The west street
// runs past the mural wall and the half courts' broadcast cameras (x -66 .. -72), so it's further out
export const ROAD = { s: -40.6, n: 38.6, e: 70.4, w: -80.4, half: 3.2, lane: 1.5, r: 4 };
// the ground is flat inside this, and climbs beyond it (steeper to the north, where the default cameras look)
export const FLAT = { x0: -85.2, x1: 75.2, z0: -45.2, z1: 43.2 };
export const SLOPE = { n: 0.5, s: 0.24, e: 0.4, w: 0.4 };
export const EXTENT = 240;
// (rows from `near` on are the far ones: plain boxes and a few lit windows, seen through the haze)
export const ROW = { depth: 8, step: 9.4, rows: 9, near: 7, storey: 2.9 };
// the stairways up between the houses: per side, where they cut through every row (along x for n/s, along z for e/w)
export const ALLEYS = { n: [-58, -24, 8, 40], s: [-44, -6, 30], e: [-18, 18], w: [-22, 16] };
export const POLICE_CAR = { x: 74.7, z: 27, yaw: 0 };
// shops on the north and south streets (the first row of houses): {side, along, key}
export const SHOPS = [
  { side: 'n', at: -40, key: 'MERCADINHO' }, { side: 'n', at: -6, key: 'BAR' }, { side: 'n', at: 24, key: 'AÇAÍ' }, { side: 'n', at: 55, key: 'BARBEARIA' },
  { side: 's', at: -26, key: 'LANCHONETE' }, { side: 's', at: 12, key: 'PADARIA' }, { side: 's', at: 50, key: 'SORVETES' },
];
export const sunDir = theme => { const s = theme?.sunset || { az: 72, el: 6 }, a = s.az * DEG, e = s.el * DEG; return [-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]; };

// the game cameras' paths (harbor.js camClear) plus the half courts' broadcast cameras past the west fence
export function favelaClear(x, z, pad = 4.5) {
  if (!camClear(x, z, pad)) return false;
  for (const c of PARK_COURTS) if (!c.full) { const [ox, , oz] = c.origin; if (Math.abs(x - (ox - 16.5)) < 3 + pad && z > oz - 2 - pad && z < oz + 12 + pad) return false; }
  return true;
}

// ---- the ground: flat round the park and its streets, then the hillsides ----
const tnoise = makeNoise2D(717);
export function groundY(x, z) {
  // (each side climbs at its own slope through the rows of houses, then eases off into the ridge beyond them)
  const D1 = 1.2 + ROW.rows * ROW.step, ease = q => (q < D1 ? q : D1 + (q - D1) * 0.2);
  const d = Math.max(0, SLOPE.n * ease(z - FLAT.z1), SLOPE.s * ease(FLAT.z0 - z), SLOPE.e * ease(x - FLAT.x1), SLOPE.w * ease(FLAT.x0 - x));
  if (d <= 0) return 0;
  // (a soft start at the foot of the slope, the far hills a little uneven)
  const k = smooth(d / 1.5);
  return d * k + (d > 12 ? (tnoise.fbm(x / 60, z / 60, 3) + 0.5) * Math.min(1, (d - 12) / 20) * 4 : 0);
}
// a point on a side's row line: side 'n'|'s'|'e'|'w', along (x for n/s, z for e/w), depth (m out from the flat ground)
export function sidePoint(side, along, depth) {
  if (side === 'n') return [along, FLAT.z1 + depth];
  if (side === 's') return [along, FLAT.z0 - depth];
  if (side === 'e') return [FLAT.x1 + depth, along];
  return [FLAT.x0 - depth, along];
}
// facing the park (downhill): the yaw a house front looks along
export const SIDE_YAW = { n: Math.PI, s: 0, e: -Math.PI / 2, w: Math.PI / 2 };
// a stairway's height at `depth` up it: steps of 0.9 m treads
export function stairY(side, along, depth) {
  const step = 0.9, d0 = Math.floor(depth / step) * step;
  const [x, z] = sidePoint(side, along, d0 + step * 0.5);
  return groundY(x, z);
}

// the dirtbikes' loop: the street centre lines as a rounded rectangle, lane offset (+ = the outer lane). u: metres round
// it (anticlockwise seen from above: east along the south street first). Returns [x, z, yaw]
export function loopLength(lane = 0) { const R = ROAD.r, w = ROAD.e - ROAD.w - 2 * R, d = ROAD.n - ROAD.s - 2 * R; return 2 * (w + d) + 2 * Math.PI * (R + lane); }
export function loopAt(u, lane = 0) {
  const R = ROAD.r, rr = R + lane, w = ROAD.e - ROAD.w - 2 * R, d = ROAD.n - ROAD.s - 2 * R, arc = Math.PI / 2 * rr, L = 2 * (w + d) + 4 * arc;
  u = ((u % L) + L) % L;
  const segs = [
    [w, k => [ROAD.w + R + k * w, ROAD.s - lane, Math.PI / 2]],
    [arc, k => { const a = -Math.PI / 2 + k * Math.PI / 2; return [ROAD.e - R + Math.cos(a) * rr, ROAD.s + R + Math.sin(a) * rr, Math.PI / 2 - k * Math.PI / 2]; }],
    [d, k => [ROAD.e + lane, ROAD.s + R + k * d, 0]],
    [arc, k => { const a = k * Math.PI / 2; return [ROAD.e - R + Math.cos(a) * rr, ROAD.n - R + Math.sin(a) * rr, -k * Math.PI / 2]; }],
    [w, k => [ROAD.e - R - k * w, ROAD.n + lane, -Math.PI / 2]],
    [arc, k => { const a = Math.PI / 2 + k * Math.PI / 2; return [ROAD.w + R + Math.cos(a) * rr, ROAD.n - R + Math.sin(a) * rr, -Math.PI / 2 - k * Math.PI / 2]; }],
    [d, k => [ROAD.w - lane, ROAD.n - R - k * d, Math.PI]],
    [arc, k => { const a = Math.PI + k * Math.PI / 2; return [ROAD.w + R + Math.cos(a) * rr, ROAD.s + R + Math.sin(a) * rr, Math.PI - k * Math.PI / 2]; }],
  ];
  for (const [len, f] of segs) { if (u <= len) return f(len ? u / len : 0); u -= len; }
  return segs[0][1](0);
}
// where a stairway meets its street (on the street's outer kerb) and the point d metres up it: [x, y, z]
export function alleyMouth(side, along) {
  if (side === 'n') return [along, 0, ROAD.n + ROAD.half];
  if (side === 's') return [along, 0, ROAD.s - ROAD.half];
  if (side === 'e') return [ROAD.e + ROAD.half, 0, along];
  return [ROAD.w - ROAD.half, 0, along];
}
export function alleyPoint(side, along, d) {
  const [mx, , mz] = alleyMouth(side, along), flat = side === 'n' ? FLAT.z1 - mz : side === 's' ? mz - FLAT.z0 : side === 'e' ? FLAT.x1 - mx : mx - FLAT.x0;
  if (d <= flat) { const [nx, nz] = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] }[side]; return [mx + nx * d, 0, mz + nz * d]; }
  const [x, z] = sidePoint(side, along, d - flat);
  return [x, stairY(side, along, d - flat), z];
}

// ---- houses (pure: the tests check the plan) ----
// every house: {side, along (centre), w, depth, storeys, x, z (front centre), y (floor), yaw (front faces the park), color,
// brick, row, roof: {tank, dish, plants, laundry, lights}, shop}
export function favelaPlan(seed = 2026) {
  const rng = new RNG(seed), houses = [];
  const span = { n: [FLAT.x0 - 64, FLAT.x1 + 64], s: [FLAT.x0 - 64, FLAT.x1 + 64], e: [FLAT.z0 + 2, FLAT.z1 - 2], w: [FLAT.z0 + 2, FLAT.z1 - 2] };
  for (const side of ['n', 's', 'e', 'w']) {
    for (let row = 0; row < ROW.rows; row++) {
      const depth = 1.2 + row * ROW.step;
      // (north and south rows run out to the corners' diagonals; east and west ones stop short of them)
      let a = Math.max(span[side][0], FLAT.x0 - depth - ROW.depth), end = Math.min(span[side][1], FLAT.x1 + depth + ROW.depth);
      // (east and west rows stop short of the north and south rows at the same depth: no two houses in one spot)
      if (side === 'e' || side === 'w') { a = FLAT.z0 - depth + ROW.depth + 0.6; end = FLAT.z1 + depth - ROW.depth - 0.6; }
      while (a < end) {
        const w = rng.range(4.2, 7.4);
        const mid = a + w / 2, alley = ALLEYS[side].find(q => Math.abs(q - mid) < w / 2 + 1.15);
        if (alley != null) { a = alley + 1.15; continue; }
        if (a + w > end) break;
        const [x, z] = sidePoint(side, mid, depth), y = groundY(x, z);
        if (row > 3 && rng.next() < 0.08) { a += w + rng.range(0, 1.5); continue; } // (a gap now and then up the hill: trees)
        const storeys = Math.min(5, (row === 0 ? 2 : 2 + (rng.next() < 0.5 ? 1 : 0)) + (rng.next() < 0.3 ? 1 : 0)), far = row >= ROW.near;
        const shop = row === 0 ? SHOPS.find(s => s.side === side && Math.abs(s.at - mid) < w / 2 + 0.5 && !houses.some(h => h.shop === s)) || null : null;
        houses.push({
          side, along: mid, w: w - 0.06, depth: ROW.depth + rng.range(-0.8, 0.4), storeys, x, z, y, yaw: SIDE_YAW[side], row,
          color: rng.pick(PALETTE), brick: !shop && !far && rng.next() < 0.26, shop, far,
          roof: far ? { tank: false, dish: false, plants: false, laundry: false, lights: false, parapet: false, rebar: false } : { tank: rng.next() < 0.62, dish: rng.next() < 0.22, plants: rng.next() < 0.34, laundry: row < 3 && rng.next() < 0.16, lights: false, parapet: rng.next() < 0.5, rebar: rng.next() < 0.2 },
          open: rng.next() < 0.18, seed: rng.int(1, 1e6),
        });
        a += w;
      }
    }
  }
  // string lights on a few lajes in the first rows the default cameras face
  const front = houses.filter(h => h.side === 'n' && h.row < 2 && Math.abs(h.along) < 60);
  for (let i = 0; i < 5 && front.length; i++) { const h = front.splice(rng.int(0, front.length - 1), 1)[0]; h.roof.lights = true; h.roof.laundry = false; }
  return houses;
}
// a house's local frame → world: P(lx, ly, lz) with lz forward (toward the street), ly up from its floor
export function houseFrame(h) {
  const s = Math.sin(h.yaw), c = Math.cos(h.yaw);
  return { yaw: h.yaw, P: (lx, ly, lz) => [h.x + c * lx + s * lz, h.y + ly, h.z - s * lx + c * lz], M: (lx, ly, lz, yaw = 0) => { const [x, y, z] = [h.x + c * lx + s * (lz), h.y + ly, h.z - s * lx + c * lz]; return M.m4fromYaw(M.m4(), x, y, z, h.yaw + yaw); } };
}

// ---- the ground mesh and the park's slab ----
export function favelaGround(ctx, scene, theme) {
  const noise = makeNoise2D(19);
  const conc = cachedTexture(ctx, 'concrete', () => T.concrete({ joints: true }).color, {});
  const concN = cachedTexture(ctx, 'concreteN', () => T.concrete({ joints: true }).normal, { srgb: false });
  // (v0.4.8.7 polish: the hillside is its own ground now, packed red earth with patches of old concrete (T.favelaGround,
  // 8 m a tile), scrubby green here and there; the flat ring round the park is paved, the streets asphalt with kerbs and
  // gutters, each its own mesh over it)
  const earth = cachedTexture(ctx, 'favela-ground', () => T.favelaGround().color, { aniso: 4 }), earthN = cachedTexture(ctx, 'favela-groundN', () => T.favelaGround().normal, { srgb: false });
  const shade = (x, z) => {
    const n = noise.fbm(x / 30, z / 30, 3), k = 0.9 + n * 0.22;
    if (x > FLAT.x0 && x < FLAT.x1 && z > FLAT.z0 && z < FLAT.z1) return [0.9 * k, 0.9 * k, 0.9 * k];
    const g = smooth((noise.fbm(x / 14 + 7, z / 14, 2) - 0.02) / 0.12);
    return [k * (1 - 0.2 * g), k * (1 - 0.03 * g), k * (1 - 0.26 * g)];
  };
  const geo = shadedPlane(-EXTENT, EXTENT, -EXTENT, EXTENT, 5, 8, shade, (x, z) => groundY(x, z) - 0.03);
  // (the first grid line out past each edge of the flat is moved onto the edge, so the slope starts exactly there and
  // never rises through the paving between two grid lines)
  { const C = 5, snap = (v, e, out) => (out > 0 ? (v > e && v - e < C ? e : v) : (v < e && e - v < C ? e : v)), P = geo.position;
    for (let i = 0; i < P.length; i += 3) {
      const x = snap(snap(P[i], FLAT.x1, 1), FLAT.x0, -1), z = snap(snap(P[i + 2], FLAT.z1, 1), FLAT.z0, -1);
      if (x === P[i] && z === P[i + 2]) continue;
      P[i] = x; P[i + 2] = z; P[i + 1] = groundY(x, z) - 0.03; geo.uv[i / 3 * 2] = x / 8; geo.uv[i / 3 * 2 + 1] = z / 8;
    } }
  G.computeNormals(geo);
  const ground = new Mesh(ctx.geometry(geo), new Material({ color: [1, 1, 1], map: earth, normalMap: earthN, normalScale: 0.7, roughness: 0.95 }), { castShadow: false, reflect: false });
  ground.order = -3; scene.add(ground);
  // the paving round the park (outside its slab, out to the foot of the hill): sidewalk slabs
  const PK = { x0: -63.6, x1: 63.6, z0: -34.3, z1: 33.4 }, strip = (x0, x1, z0, z1, tile, y, col) => { const g = G.plane(x1 - x0, z1 - z0, 1, 1); for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] *= (x1 - x0) / tile; g.uv[i + 1] *= (z1 - z0) / tile; } return { geo: g, matrix: Tm((x0 + x1) / 2, y, (z0 + z1) / 2), color: col }; };
  const pv = [strip(FLAT.x0, FLAT.x1, PK.z1, FLAT.z1, 3, -0.018, [0.92, 0.9, 0.86, 1]), strip(FLAT.x0, FLAT.x1, FLAT.z0, PK.z0, 3, -0.018, [0.92, 0.9, 0.86, 1]), strip(PK.x1, FLAT.x1, PK.z0, PK.z1, 3, -0.018, [0.92, 0.9, 0.86, 1]), strip(FLAT.x0, PK.x0, PK.z0, PK.z1, 3, -0.018, [0.92, 0.9, 0.86, 1])];
  const paving = new Mesh(ctx.geometry(G.merge(pv)), new Material({ color: [1, 1, 1], map: conc, normalMap: concN, normalScale: 0.6, roughness: 0.88 }), { castShadow: false, reflect: false });
  paving.order = -3; scene.add(paving);
  // the streets: asphalt round the loop
  const asph = cachedTexture(ctx, 'favela-asphalt', () => T.asphalt({ size: 512, cracks: 10 }).color, { aniso: 4 }), asphN = cachedTexture(ctx, 'favela-asphaltN', () => T.asphalt({ size: 512, cracks: 10 }).normal, { srgb: false });
  const R0 = ROAD, hh = R0.half, rd = [strip(R0.w - hh, R0.e + hh, R0.s - hh, R0.s + hh, 6, -0.008, [1, 1, 1, 1]), strip(R0.w - hh, R0.e + hh, R0.n - hh, R0.n + hh, 6, -0.008, [1, 1, 1, 1]), strip(R0.e - hh, R0.e + hh, R0.s + hh, R0.n - hh, 6, -0.008, [1, 1, 1, 1]), strip(R0.w - hh, R0.w + hh, R0.s + hh, R0.n - hh, 6, -0.008, [1, 1, 1, 1])];
  const street = new Mesh(ctx.geometry(G.merge(rd)), new Material({ color: [1.15, 1.13, 1.12], map: asph, normalMap: asphN, normalScale: 0.5, roughness: 0.82 }), { castShadow: false, reflect: false });
  street.order = -2; scene.add(street);
  const W = 127.2, D = 67.7, slab = G.plane(W, D, 1, 1);
  for (let i = 0; i < slab.uv.length; i += 2) { slab.uv[i] *= W / 4; slab.uv[i + 1] *= D / 4; }
  const m = new Mesh(ctx.geometry(slab), new Material({ color: lin(theme.ground), map: conc, normalMap: concN, normalScale: 0.6, roughness: 0.85 }), { castShadow: false, reflect: false });
  M.m4translation(m.matrix, 0, -0.005, (33.4 - 34.3) / 2); m.order = -2; scene.add(m);
  // the street's lane paint: dashed centre lines round the loop
  const dash = [];
  for (let u = 0, L = loopLength(0); u < L; u += 6) { const [x, z, yaw] = loopAt(u, 0); dash.push({ geo: G.plane(0.14, 2.6), matrix: TR(x, 0.012, z, yaw), color: [0.95, 0.85, 0.4, 1] }); }
  // the kerbs (a 12 cm step up to the sidewalks, both sides of every street) and the gutters (dark, damp channels along
  // the kerbs' feet)
  const kerbCol = [0.7, 0.68, 0.64, 1], gut = [0.16, 0.16, 0.17, 1];
  const kerb = (x0, x1, z0, z1) => { dash.push({ geo: G.box(x1 - x0, 0.12, z1 - z0), matrix: Tm((x0 + x1) / 2, 0.05, (z0 + z1) / 2), color: kerbCol }); };
  const gutter = (x0, x1, z0, z1) => dash.push({ geo: G.plane(x1 - x0, z1 - z0), matrix: Tm((x0 + x1) / 2, -0.002, (z0 + z1) / 2), color: gut });
  const kw = 0.16, gw = 0.32;
  // (the outer kerbs run right round the corners; the inner ones stop at the crossing streets)
  for (const zc of [R0.s, R0.n]) for (const sd of [-1, 1]) {
    const ze = zc + sd * hh, out = sd === (zc === R0.n ? 1 : -1), [a, b] = out ? [R0.w - hh - kw, R0.e + hh + kw] : [R0.w + hh, R0.e - hh];
    kerb(a, b, Math.min(ze, ze + sd * kw), Math.max(ze, ze + sd * kw));
    gutter(a + (out ? kw : 0), b - (out ? kw : 0), Math.min(ze, ze - sd * gw), Math.max(ze, ze - sd * gw));
  }
  for (const xc of [R0.w, R0.e]) for (const sd of [-1, 1]) {
    const xe = xc + sd * hh, out = sd === (xc === R0.e ? 1 : -1), [a, b] = out ? [R0.s - hh, R0.n + hh] : [R0.s + hh, R0.n - hh];
    kerb(Math.min(xe, xe + sd * kw), Math.max(xe, xe + sd * kw), a, b);
    gutter(Math.min(xe, xe - sd * gw), Math.max(xe, xe - sd * gw), a + (out ? gw : 0), b - (out ? gw : 0));
  }
  const paint = new Mesh(ctx.geometry(G.merge(dash)), new Material({ color: [1, 1, 1], roughness: 0.8 }), { castShadow: false, reflect: false });
  paint.order = -1; scene.add(paint);
  return [ground, m, paint, paving, street];
}

// ---- the sky: deep blue overhead, lilac, pink, orange round the low sun; a soft sun disc; long clouds lit from below ----
export function duskSky(el, cs, cd) {
  // el: elevation (rad); cs: how much this bearing faces the sun's (−1..1); cd: cosine of the angle to the sun
  const e = el / DEG, mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  if (e < 0) return mix([0.42, 0.3, 0.3], [0.16, 0.12, 0.14], smooth(-e / 14));
  const away = [[0, [0.62, 0.42, 0.56]], [6, [0.5, 0.38, 0.62]], [16, [0.3, 0.3, 0.6]], [40, [0.13, 0.16, 0.42]], [90, [0.06, 0.08, 0.26]]];
  const toward = [[0, [1.25, 0.62, 0.3]], [5, [1.1, 0.55, 0.36]], [14, [0.72, 0.46, 0.52]], [36, [0.24, 0.26, 0.55]], [90, [0.06, 0.08, 0.26]]];
  const at = stops => { let k = 0; while (k < stops.length - 2 && e > stops[k + 1][0]) k++; return mix(stops[k][1], stops[k + 1][1], smooth((e - stops[k][0]) / (stops[k + 1][0] - stops[k][0]))); };
  const c = mix(at(away), at(toward), smooth((cs + 0.3) / 1.3));
  const g = Math.max(0, cd);
  return [c[0] + 0.9 * g ** 40 + 0.25 * g ** 6, c[1] + 0.55 * g ** 40 + 0.12 * g ** 6, c[2] + 0.2 * g ** 40 + 0.02 * g ** 6];
}
export function favelaSky(ctx, scene, theme) {
  const S = theme.sunset, sd = sunDir(theme), R = 255;
  const els = [-90, -30, -10, -4, -1.5, 0, 1, 2.2, 3.6, 5.5, 8, 11, 15, 20, 27, 36, 48, 62, 76, 90].map(d => d * DEG), nAz = 64;
  const pos = [], col = [], nrm = [], uv = [], idx = [], bx = sd[0] / Math.hypot(sd[0], sd[2]), bz = sd[2] / Math.hypot(sd[0], sd[2]);
  els.forEach(el => {
    for (let j = 0; j <= nAz; j++) {
      const a = j / nAz * Math.PI * 2, d = [Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)];
      pos.push(d[0] * R, d[1] * R, d[2] * R); nrm.push(-d[0], -d[1], -d[2]); uv.push(j / nAz, 0);
      col.push(...duskSky(el, Math.sin(a) * bx + Math.cos(a) * bz, d[0] * sd[0] + d[1] * sd[1] + d[2] * sd[2]), 1);
    }
  });
  for (let i = 0; i < els.length - 1; i++) for (let j = 0; j < nAz; j++) { const a = i * (nAz + 1) + j, b = a + nAz + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const dome = new Mesh(ctx.geometry({ position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), color: new Float32Array(col), index: new Uint16Array(idx) }),
    new Material({ color: [1, 1, 1], shading: 'unlit', fog: false, doubleSided: true, depthWrite: false }), { castShadow: false, reflect: false, cull: false });
  dome.order = -10; scene.add(dome);
  // the sun: a soft glow with a hot core, low in the west
  const dist = S.dist, rad = Math.tan(S.size / 2 * DEG) * dist, cx = sd[0] * dist, cy = sd[1] * dist, cz = sd[2] * dist;
  const glow = cachedTexture(ctx, 'glowspot-sun', () => T.glowSpot(256, 1.2), { wrap: 'clamp' });
  const sun = new Mesh(ctx.geometry(G.merge([{ geo: G.quad(rad * 9, rad * 9), color: [1.0, 0.55, 0.25, 0.55] }, { geo: G.quad(rad * 2.2, rad * 2.2), matrix: Tm(0, 0, 0.5), color: [2.6, 2.0, 1.2, 1] }])),
    new Material({ map: glow, color: [1, 1, 1], shading: 'unlit', fog: false, blend: 'add', depthWrite: false }), { castShadow: false, reflect: false });
  M.m4fromYaw(sun.matrix, cx, cy, cz, Math.atan2(-cx, -cz)); sun.order = -9; scene.add(sun);
  // long thin clouds, lit orange and pink from below near the sun, lilac away from it
  const clouds = [], rng = new RNG(311), base = Math.atan2(bx, bz);
  for (let i = 0; i < 18; i++) {
    const near = i < 6, a = base + (near ? rng.range(-0.4, 0.4) : rng.range(-2.6, 2.6)), d = rng.range(212, 236), el = (near ? rng.range(3, 12) : rng.range(6, 24)) * DEG;
    const x = Math.sin(a) * Math.cos(el) * d, y = Math.sin(el) * d, z = Math.cos(a) * Math.cos(el) * d, w = rng.range(34, 90), h = w * rng.range(0.07, 0.12);
    const k = Math.max(0, Math.cos(a - base)), glowK = near ? 1 : k * k;
    clouds.push({ geo: G.quad(w, h), matrix: TR(x, y, z, Math.atan2(-x, -z)), color: [0.62 + 0.7 * glowK, 0.42 + 0.22 * glowK, 0.58 - 0.18 * glowK, rng.range(0.6, 0.9)] });
  }
  const cm = new Mesh(ctx.geometry(G.merge(PR.bake(clouds))), new Material({ map: cachedTexture(ctx, 'cloudstreak', () => T.cloudStreak(), { wrap: 'clamp' }), color: [1.15, 1.15, 1.15], shading: 'unlit', fog: false, blend: 'alpha', depthWrite: false }), { castShadow: false, reflect: false });
  cm.order = -8; scene.add(cm);
  return { dome, sun, clouds: cm };
}

// ---- small shapes ----
// a kite (pipa): a diamond with a cross-spar, its tail a ribbon of bows; faces +z, its nose up. s: size (m)
export function kiteParts(color, s = 1, bone = 0, tail = 6) {
  const out = [], P = [[0, 0.62 * s], [0.42 * s, 0.1 * s], [0, -0.5 * s], [-0.42 * s, 0.1 * s]];
  const tri = (a, b, c, col) => ({ geo: { position: new Float32Array([...a, ...b, ...c, ...a, ...c, ...b]), normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1]), uv: new Float32Array(12), index: new Uint16Array([0, 1, 2, 3, 4, 5]) }, color: c4(col), bone });
  const o = [0, 0.1 * s, 0], lighter = '#f4efe4';
  out.push(tri([...P[0], 0], [...P[1], 0], [0, 0.1 * s, 0], color), tri([...P[1], 0], [...P[2], 0], [0, 0.1 * s, 0], lighter), tri([...P[2], 0], [...P[3], 0], [0, 0.1 * s, 0], color), tri([...P[3], 0], [...P[0], 0], [0, 0.1 * s, 0], lighter));
  void o;
  for (let k = 1; k <= tail; k++) out.push({ geo: G.box(0.16 * s, 0.05 * s, 0.01), matrix: Tm(Math.sin(k * 1.3) * 0.06 * s, -0.5 * s - k * 0.22 * s, 0), color: c4(k % 2 ? color : lighter), bone });
  return out;
}
// a dog (faces +z): body, head, snout, ears, legs, a tail
export function dogParts(col, bone = 0) {
  const c = c4(col), d = c4('#2a2018');
  return [{ geo: G.box(0.22, 0.22, 0.62), matrix: Tm(0, 0.42, 0), color: c, bone }, { geo: G.box(0.18, 0.18, 0.2), matrix: Tm(0, 0.58, 0.38), color: c, bone }, { geo: G.box(0.1, 0.09, 0.12), matrix: Tm(0, 0.53, 0.53), color: d, bone },
    ...[-0.06, 0.06].map(x => ({ geo: G.box(0.05, 0.09, 0.04), matrix: Tm(x, 0.7, 0.33), color: d, bone })), ...[[-0.07, 0.22], [0.07, 0.22], [-0.07, -0.22], [0.07, -0.22]].map(([x, z]) => ({ geo: G.box(0.06, 0.32, 0.06), matrix: Tm(x, 0.16, z), color: c, bone })),
    { geo: G.box(0.04, 0.04, 0.26), matrix: mul(Tm(0, 0.56, -0.38), Rx(-0.7)), color: c, bone }];
}
export function catParts(col, bone = 0) {
  const c = c4(col);
  return [{ geo: G.box(0.14, 0.18, 0.3), matrix: Tm(0, 0.14, -0.02), color: c, bone }, { geo: G.box(0.13, 0.12, 0.12), matrix: Tm(0, 0.29, 0.1), color: c, bone },
    ...[-0.04, 0.04].map(x => ({ geo: G.box(0.03, 0.05, 0.02), matrix: Tm(x, 0.37, 0.1), color: c, bone })), { geo: G.box(0.03, 0.03, 0.26), matrix: mul(Tm(0, 0.12, -0.24), Rx(0.5)), color: c, bone }];
}
export function chickenParts(col, bone = 0) {
  return [{ geo: G.box(0.16, 0.16, 0.24), matrix: Tm(0, 0.22, 0), color: c4(col), bone }, { geo: G.box(0.08, 0.1, 0.08), matrix: Tm(0, 0.34, 0.12), color: c4(col), bone },
    { geo: G.box(0.03, 0.05, 0.05), matrix: Tm(0, 0.41, 0.12), color: c4('#d8302a'), bone }, { geo: G.box(0.03, 0.03, 0.05), matrix: Tm(0, 0.33, 0.18), color: c4('#f2a020'), bone },
    ...[-0.04, 0.04].map(x => ({ geo: G.box(0.02, 0.14, 0.02), matrix: Tm(x, 0.07, 0), color: c4('#f2a020'), bone }))];
}
export function pigeonParts(bone = 0) {
  return [{ geo: G.box(0.1, 0.1, 0.22), matrix: Tm(0, 0.1, 0), color: c4('#7d8088'), bone }, { geo: G.box(0.07, 0.07, 0.07), matrix: Tm(0, 0.17, 0.1), color: c4('#5a6068'), bone }, { geo: G.box(0.36, 0.02, 0.1), matrix: Tm(0, 0.13, -0.01), color: c4('#8a8e96'), bone }];
}
// a person (faces +z, feet on the ground): the park's crowd figure in colours: shirt, trousers, skin
export const SKINS = ['#8a5a3a', '#c48e62', '#5a3a26', '#e0b088', '#a06a44', '#3e2a1e'];
export const SHIRTS = ['#f4f2ec', '#2fb8b0', '#f2c230', '#e86aa0', '#d8302a', '#2f6fd0', '#9ad13a', '#3a3a3a', '#e8934a', '#7ac8e8'], PANTS = ['#2a3a5a', '#3a3a3a', '#5a4a3a', '#2a2a2a', '#6a8aa8', '#f4f2ec'];
// v0.4.8.7 polish: the people are the Monster Mash's skinned figures (horror.js: 12 bones each, two to a mesh) in the
// neighbourhood's clothes, so they really walk: legs and arms swinging (MOVES.walk / run / stand). A spec: {skin, top,
// bottom, hair ('short' | 'long' | 'messy' | 'cap'), hairCol, extra: more parts on the figure's bones (drums, a flag)}
const HAIRS = ['short', 'short', 'long', 'messy', 'cap'], HAIRC = ['#1a1410', '#2a1a10', '#3a2416', '#0e0a08', '#5a3a20'];
export function personSpec(rng, o = {}) { const hair = o.hair || rng.pick(HAIRS); return { skin: o.skin || rng.pick(SKINS), top: o.top || rng.pick(SHIRTS), bottom: o.bottom || rng.pick(PANTS), hair, hairCol: o.hairCol || (hair === 'cap' ? rng.pick(SHIRTS) : rng.pick(HAIRC)), extra: o.extra || null }; }
export function peopleGeo(specs) {
  const all = [];
  specs.forEach((sp, i) => { for (const q of [...figureParts('teen', sp), ...(sp.extra || [])]) all.push({ ...q, bone: q.bone + i * FB }); });
  return skinGeo(all);
}
const FIGS = new WeakMap(); // (GL context → key → geometry: the events' figures are made once)
export function figGeo(ctx, key, specs) { let m = FIGS.get(ctx); if (!m) FIGS.set(ctx, m = new Map()); let g = m.get(key); if (!g) m.set(key, g = ctx.geometry(peopleGeo(specs))); return g; }
// where a figure's hand is (its forearm's end): bones, slot, right (6) or left (4)
export function handAt(bones, slot, b = 6) { const o = (slot * FB + b) * 16, m = bones; return [m[o + 12] - 0.29 * m[o + 4], m[o + 13] - 0.29 * m[o + 5], m[o + 14] - 0.29 * m[o + 6]]; }
// a cast of figures, two to a mesh: pose(j, x, y, z, yaw, P, k) poses figure j
export function castOf(add, ctx, mat, specs, key) {
  const ms = [];
  for (let i = 0; i < specs.length; i += 2) { const sp = specs.slice(i, i + 2), bones = new Float32Array(16 * FB * sp.length); ms.push({ bones, mesh: add(figGeo(ctx, key + ':' + i, sp), mat, { cull: false, bones }) }); }
  return { meshes: ms.map(m => m.mesh), n: specs.length,
    pose(j, x, y, z, yaw, P, k = 1, kind = 'default') { poseFigure(ms[j >> 1].bones, j & 1, x, y, z, yaw, P, k, kind); },
    hand(j, b = 6) { return handAt(ms[j >> 1].bones, j & 1, b); },
    bones(j) { return ms[j >> 1].bones.subarray((j & 1) * FB * 16, ((j & 1) + 1) * FB * 16); } };
}
// talking at a door: one hand going, the head nodding and turning
export const chatPose = (t, ph, talk) => ({ aL: [0.12, 0.12, 0.35], aR: talk ? [0.45 + 0.25 * Math.sin(t * 3.1 + ph), 0.25, 1.1 + 0.45 * Math.sin(t * 4.3 + ph)] : [0.05, 0.12, 0.2], head: [0.06 * Math.sin(t * 2 + ph), 0.18 * Math.sin(t * 0.7 + ph), 0], twist: talk ? 0.08 * Math.sin(t * 1.3 + ph) : 0 });
// the old rigid crowd figure (kept for anything that wants a one-bone person)
export function personParts(shirt, pants, skin, bone = 0, o = {}) {
  const s = o.s || 1, S = (x, y, z) => mul(Sc(s, s, s), Tm(x, y, z));
  const out = [
    { geo: G.box(0.3, 0.42, 0.18), matrix: S(0, 1.1, 0), color: c4(shirt), bone }, { geo: G.box(0.32, 0.12, 0.2), matrix: S(0, 1.34, 0), color: c4(shirt), bone },
    { geo: G.sphere(0.11, 7, 5), matrix: S(0, 1.55, 0.01), color: c4(skin), bone },
    ...[-0.08, 0.08].map(x => ({ geo: G.box(0.12, 0.86, 0.14), matrix: S(x, 0.45, 0), color: c4(pants), bone })),
    ...[-0.21, 0.21].map(x => ({ geo: G.box(0.08, 0.5, 0.09), matrix: S(x, 1.08, 0.02), color: c4(skin), bone })),
  ];
  if (o.cap) out.push({ geo: G.box(0.24, 0.07, 0.3), matrix: S(0, 1.65, 0.04), color: c4(o.cap), bone });
  if (o.hair) out.push({ geo: G.box(0.23, 0.08, 0.23), matrix: S(0, 1.64, -0.01), color: c4(o.hair), bone });
  return out;
}
// a dirtbike with its rider (faces +z, the rear axle at the origin's z −0.62: a wheelie pivots there). police: the blue
// and white bike with its light bar (the bar is a separate part list: lights)
export function bikeParts(o = {}) {
  const body = o.police ? '#f4f6f8' : o.color || '#e83a2a', dark = c4('#161618'), b = o.bone || 0, out = [];
  const wheel = z => ({ geo: G.cylinder(0.34, 0.34, 0.12, 12), matrix: mul(Tm(0, 0.34, z), Rz(Math.PI / 2)), color: dark, bone: b });
  out.push(wheel(-0.62), wheel(0.62));
  out.push({ geo: G.box(0.24, 0.3, 0.9), matrix: Tm(0, 0.62, 0), color: c4(body), bone: b }, { geo: G.box(0.26, 0.1, 0.62), matrix: Tm(0, 0.86, -0.18), color: c4('#1a1a1c'), bone: b },
    { geo: G.box(0.3, 0.06, 0.46), matrix: mul(Tm(0, 0.74, 0.72), Rx(0.3)), color: c4(body), bone: b }, { geo: G.box(0.05, 0.62, 0.05), matrix: mul(Tm(0, 0.76, 0.5), Rx(-0.4)), color: c4('#9a9ea4'), bone: b },
    { geo: G.box(0.6, 0.04, 0.04), matrix: Tm(0, 1.06, 0.38), color: dark, bone: b }, { geo: G.box(0.28, 0.08, 0.5), matrix: Tm(0, 0.58, -0.62), color: c4(body), bone: b });
  if (o.police) out.push({ geo: G.box(0.26, 0.12, 0.92), matrix: Tm(0, 0.64, 0), color: c4(HUE.police), bone: b }, { geo: G.box(0.32, 0.26, 0.04), matrix: Tm(0, 1.0, 0.56), color: c4('#d8e4f0', 1), bone: b });
  // the rider: legs on the pegs, hands on the bars, a helmet
  const sh = o.police ? '#1f3a6a' : o.shirt || '#2fb8b0', pa = o.police ? '#1a2a44' : o.pants || '#2a3a5a', helm = o.police ? '#f4f6f8' : o.helmet || '#f2c230';
  out.push({ geo: G.box(0.32, 0.46, 0.2), matrix: mul(Tm(0, 1.32, -0.1), Rx(0.35)), color: c4(sh), bone: b }, { geo: G.sphere(0.15, 8, 6), matrix: Tm(0, 1.66, 0.04), color: c4(helm), bone: b },
    ...[-0.13, 0.13].map(x => ({ geo: G.box(0.13, 0.13, 0.5), matrix: Tm(x, 0.98, 0.0), color: c4(pa), bone: b })), ...[-0.13, 0.13].map(x => ({ geo: G.box(0.12, 0.42, 0.12), matrix: Tm(x, 0.72, 0.22), color: c4(pa), bone: b })),
    ...[-0.24, 0.24].map(x => ({ geo: G.box(0.08, 0.08, 0.46), matrix: mul(Tm(x, 1.24, 0.18), Rx(0.5)), color: c4(o.police ? '#1f3a6a' : '#c48e62'), bone: b })));
  return out;
}
export function policeLightParts(bone = 0) { return [{ geo: G.box(0.12, 0.1, 0.08), matrix: Tm(-0.1, 1.18, 0.56), color: [1, 1, 1, 1], bone }, { geo: G.box(0.12, 0.1, 0.08), matrix: Tm(0.1, 1.18, 0.56), color: [1, 1, 1, 1], bone }]; }
// the light bar's pattern: red twice, blue twice (~1.1 s round). → {red, blue}
export function barPhase(ph) { const p = ((ph % 1) + 1) % 1; return { red: p < 0.09 || (p > 0.14 && p < 0.23), blue: (p > 0.5 && p < 0.59) || (p > 0.64 && p < 0.73) }; }

// v0.4.8.7 polish: the front doors that open (the first row on the north street, a couple on the south): every other plain
// closed house in the stretch the cameras face. Pure: the plan's houses → the ones whose door swings
export const DOORS = { n: 7, s: 2, leaf: [0.96, 2.05], swing: 1.75 };
export function favelaDoors(houses) {
  const pick = (side, span, n) => houses.filter(h => h.side === side && h.row === 0 && !h.shop && !h.open && !h.far && Math.abs(h.along) < span).filter((_, i) => i % 2 === 0).slice(0, n);
  return [...pick('n', 62, DOORS.n), ...pick('s', 50, DOORS.s)];
}
// a door's hinge (on the doorway's left edge, as you face the house) and where its doorway's middle is: world [x, y, z]
export function doorFrame(h) { const F = houseFrame(h), lx = -h.w / 2 * 0.45; return { F, lx, hinge: F.P(lx - DOORS.leaf[0] / 2, 0, 0.03), mid: F.P(lx, 0, 0) }; }

// ---- the favela ----
// park: the park's shadow batches {matte, metal, foliage, lamps}. Returns {update(dt, r), lights, houses, power(groups,
// on), windowGroups, laundry, ...}: the hooks the park life and its events use
export function favelaTown(ctx, scene, rng, theme, park) {
  const houses = favelaPlan(2026), nG = 12;
  favelaSky(ctx, scene, theme);
  const walls = [], bricks = [], roofs = [], detail = [], glass = Array.from({ length: nG }, () => []), tv = [], lightsOn = [], signs = [], warm = [];
  const laundry = [], laundryRig = [];
  const stone = c4('#9a948a'), slabCol = c4('#a8a298'), frameCol = c4('#3a3430');
  const winRng = new RNG(808);
  const swing = favelaDoors(houses), doorLeaves = [], doorRig = [];
  for (const h of houses) {
    const F = houseFrame(h), H = h.storeys * ROW.storey, hw = h.w / 2, hd = h.depth;
    // the walls: a box from 3 m under the floor (it sits into the hillside) to the slab; brick ones textured in metres
    const box = G.box(h.w, H + 3, hd, { tile: 1 });
    const part = { geo: box, matrix: F.M(0, (H - 3) / 2, -hd / 2), color: h.brick ? c4('#ffffff') : c4(h.color) };
    (h.brick ? bricks : walls).push(part);
    // the laje: a slab a little wider than the walls, a low parapet on some, rebar stubs on a few
    roofs.push({ geo: G.box(h.w + 0.24, 0.2, hd + 0.24), matrix: F.M(0, H + 0.1, -hd / 2), color: slabCol });
    if (h.roof.parapet && h.row < 3) for (const [lx, lz, w, d] of [[0, -0.02, h.w + 0.24, 0.12], [-hw - 0.06, -hd / 2, 0.12, hd + 0.2], [hw + 0.06, -hd / 2, 0.12, hd + 0.2]]) roofs.push({ geo: G.box(w, 0.6, d), matrix: F.M(lx, H + 0.5, lz), color: h.brick ? c4('#b0583a') : c4(h.color) });
    if (h.roof.rebar) for (let k = 0; k < 2; k++) detail.push({ geo: G.box(0.03, 0.8, 0.03), matrix: F.M(-hw + 0.3 + k * 0.3, H + 0.6, -0.3), color: c4('#5a3a2a') });
    // (the far rows: a few windows, no frames, no door)
    if (h.far) { for (let f = 0; f < h.storeys; f++) for (const lx of h.w > 5.6 ? [-hw * 0.45, hw * 0.45] : [0]) if (winRng.next() < 0.7) glass[winRng.int(0, nG - 1)].push({ geo: G.quad(1.0, 1.15), matrix: F.M(lx, f * ROW.storey + 1.55, 0.04), color: [2.3, 1.7, 0.95, 1] }); continue; }
    // the front: windows on every floor (the shops' ground floors open), a door, a sill and a band under each window
    const nW = h.w > 5.6 ? 2 : 1;
    for (let f = 0; f < h.storeys; f++) {
      if (f === 0 && h.shop) continue;
      for (let k = 0; k < nW; k++) {
        if (f === 0 && k === 0) continue; // (the door's place)
        const lx = nW === 1 ? (f === 0 ? hw * 0.45 : 0) : (k === 0 ? -hw * 0.45 : hw * 0.45), ly = f * ROW.storey + 1.55;
        detail.push({ geo: G.quad(1.2, 1.36), matrix: F.M(lx, ly, 0.035), color: frameCol });
        const g = winRng.int(0, nG - 1), tint = winRng.pick([[2.4, 1.6, 0.8], [2.2, 1.9, 1.3], [2.5, 1.4, 0.6], [1.9, 1.8, 1.6]]);
        if (h.row < 4 && winRng.next() < 0.04) tv.push({ geo: G.quad(0.96, 1.1), matrix: F.M(lx, ly, 0.08), color: [1, 1, 1, 1] });
        else glass[g].push({ geo: G.quad(0.96, 1.1), matrix: F.M(lx, ly, 0.08), color: [...tint, 1] });
        detail.push({ geo: G.quad(1.34, 0.12), matrix: F.M(lx, ly - 0.72, 0.05), color: stone });
      }
    }
    // the door (the shops: a roll-up shutter half up, the lit counter inside, an awning and the sign over it)
    if (h.shop) {
      const sw = Math.min(h.w - 0.8, 4.2);
      warm.push({ geo: G.quad(sw, 2.2), matrix: F.M(0, 1.15, 0.04), color: [1.15, 0.9, 0.62, 1] });
      detail.push({ geo: G.box(sw + 0.2, 0.7, 0.12), matrix: F.M(0, 2.55, 0.08), color: c4('#8a8e94') });
      detail.push({ geo: G.box(sw + 0.6, 0.08, 1.3), matrix: mul(F.M(0, 3.05, 0.6), Rx(-0.22)), color: c4(rng.pick(['#d8302a', '#2fb8b0', '#f2c230', '#2f8a4a'])) });
      signs.push({ geo: G.quad(Math.min(h.w - 0.4, 4.6), 0.58), matrix: F.M(0, 3.55, 0.09), color: [1.25, 1.25, 1.25, 1], uv: T.favelaSignUV(h.shop.key) });
    }
    // (v0.4.8.7 polish: a concrete step at the front doors of the near rows)
    if (!h.shop && h.row < 2) detail.push({ geo: G.box(1.3, 0.16, 0.5), matrix: F.M(-hw * 0.45, 0.06, 0.25), color: c4('#a8a298') });
    if (h.shop) { /* (the shop front is above) */ } else if (swing.includes(h)) {
      // (a door that opens: the dark doorway with a lamp-lit room behind, the leaf on its own bone, hinged on the left)
      const b = doorRig.length, col = c4(rng.pick(['#6a3a22', '#2a5a7a', '#8a2a2a', '#3a6a3a', '#d8d2c4'])), [L, Hh] = DOORS.leaf;
      detail.push({ geo: G.quad(L, Hh), matrix: F.M(-hw * 0.45, 1.03, 0.015), color: c4('#1a1612') });
      warm.push({ geo: G.quad(L - 0.2, Hh - 0.2), matrix: F.M(-hw * 0.45, 0.98, 0.02), color: [0.62, 0.44, 0.26, 1] });
      doorLeaves.push({ geo: G.box(L, Hh - 0.15, 0.05), matrix: Tm(L / 2, (Hh - 0.15) / 2 + 0.16, 0.025), color: col, bone: b }, { geo: G.box(0.05, 0.05, 0.08), matrix: Tm(L - 0.12, 1.0, 0.07), color: c4('#c8b070'), bone: b });
      doorRig.push({ h, ...doorFrame(h), k: 0 });
    } else {
      detail.push({ geo: G.quad(0.96, 2.05), matrix: F.M(-hw * 0.45, 1.03, h.open ? 0.02 : 0.04), color: h.open ? c4('#1a1612') : c4(rng.pick(['#6a3a22', '#2a5a7a', '#8a2a2a', '#3a6a3a', '#d8d2c4'])) });
      if (h.open) warm.push({ geo: G.quad(0.8, 1.9), matrix: F.M(-hw * 0.45, 1.0, 0.05), color: [1.0, 0.75, 0.45, 1] });
    }
    // up on the laje: the water tank, a dish, plants in pots, laundry, string lights
    if (h.roof.tank && h.row < 5) { const lx = rng.range(-hw + 0.8, hw - 0.8), lz = -rng.range(1.2, hd - 1.2); detail.push({ geo: G.cylinder(0.6, 0.52, 1.05, 8, { y0: true }), matrix: F.M(lx, H + 0.2, lz), color: c4(HUE.tank) }); }
    if (h.roof.dish && h.row < 5) {
      const lx = rng.range(-hw + 0.5, hw - 0.5);
      detail.push({ geo: G.cylinder(0.36, 0.06, 0.16, 8, { open: true }), matrix: mul(F.M(lx, H + 1.0, -0.4), Rx(-1.0)), color: c4('#d8d8d4') }, { geo: G.box(0.04, 0.8, 0.04), matrix: F.M(lx, H + 0.6, -0.5), color: c4('#8a8a8a') });
    }
    if (h.roof.plants && h.row < 4) for (let k = 0; k < 2; k++) {
      const lx = -hw + 0.5 + k * (h.w - 1);
      detail.push({ geo: G.cylinder(0.18, 0.13, 0.28, 5, { y0: true }), matrix: F.M(lx, H + 0.2, -0.3), color: c4('#b8582e') }, { geo: G.sphere(0.3, 5, 3), matrix: F.M(lx, H + 0.62, -0.3), color: c4(rng.pick(['#3f8a3a', '#2f6a2a', '#5aa040'])) });
    }
    if (h.roof.laundry && laundryRig.length < 22) {
      const b = laundryRig.length, lz = -rng.range(1.5, hd - 1.5), a = F.P(-hw + 0.4, H + 1.7, lz), c = F.P(hw - 0.4, H + 1.7, lz);
      for (const lx of [-hw + 0.4, hw - 0.4]) detail.push({ geo: G.box(0.05, 1.5, 0.05), matrix: F.M(lx, H + 0.95, lz), color: c4('#6a6a6a') });
      detail.push({ geo: G.tube([a, c], 0.012, 3), color: c4('#e8e8e0') });
      // the clothes hang from the line on its bone (the bone's origin on the line: they swing round it)
      const n = Math.max(2, Math.floor((h.w - 1) / 0.75)), yaw = h.yaw;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, w = rng.range(0.35, 0.6), hh = rng.range(0.4, 0.75);
        laundry.push({ geo: G.box(w, hh, 0.02), matrix: mul(Tm((t - 0.5) * (h.w - 0.8), -hh / 2, 0)), color: c4(rng.pick(['#f4f2ec', '#e86aa0', '#2f6fd0', '#f2c230', '#d8302a', '#9ad13a', '#3a3a3a', '#7ac8e8'])), bone: b });
      }
      laundryRig.push({ x: (a[0] + c[0]) / 2, y: a[1], z: (a[2] + c[2]) / 2, yaw, ph: rng.range(0, 6), s: rng.range(0.6, 1.3) });
    }
    if (h.roof.lights) {
      const pts = [];
      for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(F.P(-hw + 0.3 + t * (h.w - 0.6), H + 2.0 - Math.sin(t * Math.PI) * 0.4, -hd * 0.5 + Math.sin(t * 6) * 0.3)); }
      for (const p of pts) lightsOn.push({ geo: G.sphere(0.07, 5, 3), matrix: Tm(p[0], p[1], p[2]), color: c4(rng.pick(['#ffd060', '#ff6a8a', '#7ae0ff', '#a8ff7a', '#ffffff']), 1) });
      detail.push({ geo: G.tube(pts, 0.01, 3), color: c4('#2a2a2a') });
      for (const lx of [-hw + 0.3, hw - 0.3]) detail.push({ geo: G.box(0.05, 2.0, 0.05), matrix: F.M(lx, H + 1.1, -hd * 0.5), color: c4('#5a5a5a') });
    }
  }
  // the stairways: treads and risers up each one, a rail on one side
  const steps = [];
  for (const side of ['n', 's', 'e', 'w']) for (const along of ALLEYS[side]) {
    const [nx, nz] = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] }[side], yaw = SIDE_YAW[side];
    let prev = 0;
    for (let d = 0; d < ROW.near * ROW.step; d += 0.9) {
      const [x, z] = sidePoint(side, along, d + 0.45), y = stairY(side, along, d);
      steps.push({ geo: G.plane(2.0, 0.9), matrix: TR(x, y + 0.01, z, yaw), color: c4('#b8b0a4') });
      // (v0.4.8.7 polish: the open gutter down the side of the steps, dark and damp)
      { const o = side === 'n' || side === 's' ? [0.78, 0] : [0, 0.78]; steps.push({ geo: G.plane(0.26, 0.9), matrix: TR(x + o[0], y + 0.016, z + o[1], yaw), color: c4('#3a3c3e') }); }
      if (y > prev + 0.01) { const [rx, rz] = sidePoint(side, along, d); steps.push({ geo: G.quad(2.0, y - prev + 0.02), matrix: TR(rx, prev + (y - prev) / 2, rz, yaw), color: c4('#8a847a') }); }
      prev = y;
      if (Math.floor(d / 0.9) % 6 === 0) { const [px, pz] = sidePoint(side, along, d + 0.45); const s = side === 'n' || side === 's' ? [0.95, 0] : [0, 0.95]; steps.push({ geo: G.box(0.05, 1.0, 0.05), matrix: Tm(px + s[0], y + 0.5, pz + s[1]), color: c4('#3a3a3a') }); }
      void nx; void nz;
    }
  }
  // poles along the streets' outer kerbs, wires between them and from them to the houses
  const wires = [], poles = [];
  const poleAt = [];
  for (let x = ROAD.w + 6; x < ROAD.e; x += 17) { poleAt.push([x, ROAD.n + ROAD.half + 0.6, 'n']); poleAt.push([x + 6, ROAD.s - ROAD.half - 0.6, 's']); }
  for (let z = ROAD.s + 8; z < ROAD.n - 4; z += 17) { poleAt.push([ROAD.e + ROAD.half + 0.6, z, 'e']); poleAt.push([ROAD.w - ROAD.half - 0.6, z + 5, 'w']); }
  for (const [x, z] of poleAt) {
    poles.push({ geo: G.cylinder(0.11, 0.14, 8, 6, { y0: true }), matrix: Tm(x, 0, z), color: c4('#8a8478') }, { geo: G.box(1.4, 0.1, 0.1), matrix: Tm(x, 7.4, z), color: c4('#6a645a') });
    park.lamps.push({ geo: G.cylinder(0.12, 0.18, 0.28, 8, { y0: true }), matrix: Tm(x, 6.6, z), color: [1, 0.72, 0.4, 1] });
    poles.push({ geo: G.box(0.06, 0.06, 0.7), matrix: mul(Tm(x, 6.9, z)), color: c4('#4a4a4a') });
  }
  const sag = (a, b, s, n = 6) => { const p = []; for (let k = 0; k <= n; k++) { const t = k / n; p.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * s, a[2] + (b[2] - a[2]) * t]); } return p; };
  const byside = s => poleAt.filter(p => p[2] === s);
  for (const s of ['n', 's', 'e', 'w']) { const ps = byside(s); for (let i = 0; i < ps.length - 1; i++) for (const dy of [7.4, 7.1, 6.85]) wires.push({ geo: G.tube(sag([ps[i][0], dy, ps[i][1]], [ps[i + 1][0], dy, ps[i + 1][1]], 0.5 + rng.next() * 0.3), 0.018, 3), color: c4('#1a1a1a') }); }
  // (the tangles: from each pole to the nearest houses' fronts)
  for (const [x, z, s] of poleAt) {
    const near = houses.filter(h => h.side === s && h.row === 0 && Math.hypot(h.x - x, h.z - z) < 16);
    for (const h of near.slice(0, 3)) { const F = houseFrame(h), e = F.P(rng.range(-h.w / 3, h.w / 3), Math.min(h.storeys * ROW.storey - 0.4, 5.2), 0.05); wires.push({ geo: G.tube(sag([x, 7.0, z], e, 0.6), 0.014, 3), color: c4('#1a1a1a') }); }
  }
  // the parked police car on the east corner: light bar going, its colour pooled on the street round it
  const cr = PR.cruiser(), PC = POLICE_CAR;
  const livery = new Material({ map: ctx.texture(T.policeDoor(), {}), roughness: 0.38, specular: 0.9 });
  const carBody = new Mesh(ctx.geometry(G.merge(PR.bake(cr.body))), livery, { castShadow: true, reflect: false }); M.m4fromYaw(carBody.matrix, PC.x, 0, PC.z, PC.yaw); scene.add(carBody);
  const carLights = new Mesh(ctx.geometry(G.merge(PR.carLights())), new Material({ color: [2.2, 2.2, 2.2], shading: 'unlit', fog: false }), { castShadow: false, reflect: false }); carLights.matrix.set(carBody.matrix); scene.add(carLights);
  const barMat = new Material({ color: [0.3, 0.1, 0.3], shading: 'unlit', fog: false });
  const bar = new Mesh(ctx.geometry(G.merge(cr.bar)), barMat, { castShadow: false, reflect: false }); bar.matrix.set(carBody.matrix); scene.add(bar);
  const poolMat = new Material({ map: cachedTexture(ctx, 'glowspot', () => T.glowSpot(128, 1.6), { wrap: 'clamp' }), color: [0, 0, 0], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
  const pool = new Mesh(ctx.geometry(G.plane(12, 12)), poolMat, { castShadow: false, reflect: false }); M.m4translation(pool.matrix, PC.x - 1, 0.04, PC.z); pool.order = 1; scene.add(pool);

  // ---- the batches ----
  const plaster = cachedTexture(ctx, 'favela-plaster', () => T.plaster({ seed: 5 }), { aniso: 4 });
  const br = cachedTexture(ctx, 'favela-brick', () => T.brick({}).color, { aniso: 4 }), brN = cachedTexture(ctx, 'favela-brickN', () => T.brick({}).normal, { srgb: false });
  const mk = (parts, mat, o = {}) => { if (!parts.length) return null; const m = new Mesh(ctx.geometry(G.merge(parts)), mat, { castShadow: false, reflect: false, ...o }); scene.add(m); return m; };
  mk(walls, new Material({ map: plaster, color: [1, 1, 1], roughness: 0.92 }), { castShadow: true });
  mk(bricks, new Material({ map: br, normalMap: brN, normalScale: 0.8, color: [0.92, 0.8, 0.74], roughness: 0.94 }), { castShadow: true });
  mk(roofs, new Material({ color: [1, 1, 1], roughness: 0.9 }));
  mk([...detail, ...steps, ...poles], new Material({ color: [1, 1, 1], roughness: 0.75 }));
  mk(wires, new Material({ color: [1, 1, 1], roughness: 0.6 }));
  const signTex = cachedTexture(ctx, 'favela-signs', () => T.favelaSigns(), {});
  const signGeo = G.merge(signs.map(s => { const g = G.clone(s.geo), [u0, v0, uw, vh] = s.uv; for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] = u0 + g.uv[i] * uw; g.uv[i + 1] = v0 + g.uv[i + 1] * vh; } return { geo: g, matrix: s.matrix, color: s.color }; }));
  const signMesh = new Mesh(ctx.geometry(signGeo), new Material({ map: signTex, color: [1, 1, 1], shading: 'unlit', fog: false }), { castShadow: false, reflect: false }); scene.add(signMesh);
  mk(warm, new Material({ color: [1, 1, 1], shading: 'unlit', fog: false }));
  // the windows: twelve groups scattered over the hill, each on or off on its own clock (lit: its tint; dark: dim glass)
  const groups = glass.map((parts, i) => {
    const mat = new Material({ color: [0.05, 0.05, 0.06], shading: 'unlit', fog: true });
    const mesh = mk(parts, mat);
    return { mat, mesh, on: i % 3 !== 0, k: i % 3 !== 0 ? 1 : 0, t: rng.range(4, 30), forced: null };
  });
  const tvMat = new Material({ color: [0.4, 0.5, 0.9], shading: 'unlit', fog: true }), tvMesh = mk(tv, tvMat);
  const bulbMat = new Material({ color: [2.2, 2.2, 2.2], shading: 'unlit', fog: false }), bulbs = mk(lightsOn, bulbMat);
  const laundryMesh = laundry.length ? new Mesh(ctx.geometry(skinGeo(laundry)), new Material({ color: [1, 1, 1], roughness: 0.9, doubleSided: true }), { castShadow: false, reflect: false, cull: false, bones: new Float32Array(16 * Math.max(1, laundryRig.length)) }) : null;
  if (laundryMesh) scene.add(laundryMesh);
  // (the doors that open: one skinned mesh, a bone per leaf; k 0 shut .. 1 wide open, swung out toward the street)
  const doorMesh = doorLeaves.length ? new Mesh(ctx.geometry(skinGeo(doorLeaves)), new Material({ color: [1, 1, 1], roughness: 0.8 }), { castShadow: false, reflect: false, cull: false, bones: new Float32Array(16 * doorRig.length) }) : null;
  if (doorMesh) scene.add(doorMesh);
  const setDoor = (i, k) => { const d = doorRig[i]; if (!d) return; d.k = Math.max(0, Math.min(1, k)); if (doorMesh) doorMesh.bones.set(TR(d.hinge[0], d.hinge[1], d.hinge[2], d.h.yaw - d.k * DOORS.swing), i * 16); };
  doorRig.forEach((_, i) => setDoor(i, 0));
  // plants and trees in the gaps up the hill (the park's foliage batch)
  const fr = new RNG(91);
  for (let i = 0; i < 70; i++) {
    const side = fr.pick(['n', 'n', 'e', 'w', 's']), along = side === 'n' || side === 's' ? fr.range(-140, 130) : fr.range(-40, 40), depth = fr.range(2, ROW.rows * ROW.step);
    const [x, z] = sidePoint(side, along, depth);
    if (houses.some(h => Math.hypot(h.x - x, h.z - z) < h.w * 0.5 + 2.5 || (Math.abs(h.x - x) < h.w && Math.abs(h.z - z) < h.depth + 1))) continue;
    if (Object.entries(ALLEYS).some(([s, l]) => s === side && l.some(a => Math.abs(a - along) < 2))) continue;
    const y = groundY(x, z);
    const parts = fr.next() < 0.5 ? PR.palm(x, z, 0.7 + fr.next() * 0.3, fr) : PR.tree(x, z, 0.7 + fr.next() * 0.4, fr, '#3f7a34');
    for (const p of parts) if (p.matrix) p.matrix[13] += y;
    park.foliage.push(...parts);
  }

  let t = 0;
  const SET = (mat, k, tint) => { mat.color[0] = 0.05 + (tint[0] - 0.05) * k; mat.color[1] = 0.05 + (tint[1] - 0.05) * k; mat.color[2] = 0.06 + (tint[2] - 0.06) * k; };
  let flickerUntil = 0;
  const town = {
    houses, groups, laundryRig, poles: poleAt, bulbs, tvMesh, pool, bar, carBody, lights: [],
    doors: doorRig, doorMesh, setDoor, // (v0.4.8.7 polish: the doors the neighbours come out of)
    // a block's power: groups (indices) off, or back on with a flicker (the events)
    power(idx, on) { for (const i of idx) { const g = groups[i]; if (!g) continue; g.forced = on ? null : 0; if (on) { g.on = true; g.flick = 1.2; } } if (!on) flickerUntil = t + 0.6; },
    get dark() { return groups.filter(g => g.forced === 0).length; },
    update(dt) {
      t += dt;
      // the windows: each group switches on or off now and then (more on as the evening goes); a flicker as power returns
      for (const g of groups) {
        if (g.forced == null && (g.t -= dt) <= 0) { g.on = Math.random() < 0.72; g.t = 8 + Math.random() * 40; }
        const want = g.forced != null ? g.forced : g.on ? 1 : 0;
        g.k = M.damp(g.k, want, 6, dt);
        let k = g.k;
        if (g.flick > 0) { g.flick -= dt; k *= Math.random() < 0.5 ? 0.15 : 1; }
        if (t < flickerUntil && g.forced === 0) k = Math.random() < 0.3 ? 0.6 : 0;
        SET(g.mat, k, [1, 1, 1]);
      }
      // the TVs flicker blue and white
      const f = 0.5 + 0.35 * Math.sin(t * 13) * Math.sin(t * 5.3) + (Math.random() < 0.08 ? 0.4 : 0);
      tvMat.color[0] = 0.35 * f; tvMat.color[1] = 0.5 * f; tvMat.color[2] = 1.1 * f;
      // string lights twinkle; the laundry sways (each line on its bone, a slow swing round the line)
      bulbMat.color[0] = bulbMat.color[1] = bulbMat.color[2] = 2.0 + 0.4 * Math.sin(t * 3.1);
      if (laundryMesh) laundryRig.forEach((L, i) => { const a = Math.sin(t * 1.3 * L.s + L.ph) * 0.22 + 0.05; laundryMesh.bones.set(mul(TR(L.x, L.y, L.z, L.yaw), Rx(a)), i * 16); });
      // the parked police car's light bar
      const p = barPhase(t / 1.1);
      barMat.color = [0.5 + (p.red ? 11 : 0), 0.25 + (p.red || p.blue ? 1.2 : 0), 0.5 + (p.blue ? 12 : 0)];
      pool.visible = p.red || p.blue; poolMat.color = p.red ? [1.0, 0.06, 0.04] : [0.05, 0.2, 1.3];
    },
  };
  town.update(0);
  return town;
}

// ======================================================================================================================
// ---- park life (parklife.js calls these with its closures: env {r, ctx, rng, add, geoOf, updExtra, scene, town, t}) ----
// Everyone and everything that moves is a skinned mesh (a bone each, horror.js skinGeo), a few draw calls in all.
const boneSet = (mesh, i, x, y, z, yaw, pitch = 0, roll = 0) => {
  const m = M.m4fromYaw(M.m4(), x, y, z, yaw);
  if (pitch || roll) M.m4mul(m, m, mul(Rx(-pitch), Rz(roll)));
  mesh.bones.set(m, i * 16);
};
const hide = (mesh, i) => mesh.bones.set(Tm(0, -200, 0), i * 16);
// a polyline walker: pts [[x, y, z]...]; s (m along it) → [x, y, z, yaw]
export function along(pts, s) {
  let rem = Math.max(0, s);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (rem <= l || i === pts.length - 2) { const k = l ? Math.min(1, rem / l) : 0; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, Math.atan2(b[0] - a[0], b[2] - a[2])]; }
    rem -= l;
  }
  const p = pts[pts.length - 1]; return [p[0], p[1], p[2], 0];
}
export const pathLength = pts => { let l = 0; for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]); return l; };
export function alleyPath(side, along, len = 40) { const out = []; for (let d = 0; d <= len; d += 1.8) { const p = alleyPoint(side, along, d); out.push([p[0], p[1] + 0.02, p[2]]); } return out; }
// the outer sidewalks (beyond the streets) and the park-side ones, as walking lines
export function sidewalkPaths() {
  const yo = 0.02;
  return [
    [[ROAD.w + 6, yo, ROAD.n + ROAD.half + 1.5], [ROAD.e - 6, yo, ROAD.n + ROAD.half + 1.5]],
    [[ROAD.w + 6, yo, ROAD.s - ROAD.half - 1.5], [ROAD.e - 6, yo, ROAD.s - ROAD.half - 1.5]],
    [[ROAD.e + ROAD.half + 1.6, yo, ROAD.s + 6], [ROAD.e + ROAD.half + 1.6, yo, ROAD.n - 18]],
    [[ROAD.w - ROAD.half - 1.6, yo, ROAD.s + 6], [ROAD.w - ROAD.half - 1.6, yo, ROAD.n - 6]],
  ];
}

export function favelaLife(env) {
  const { rng, add, ctx, town } = env;
  // (a breath of warm emission: nobody goes black in a house's shadow at dusk)
  const skinMat = new Material({ color: [1, 1, 1], roughness: 0.8, shading: 'cloth', sheen: [0.05, 0.05, 0.05], emissive: [0.05, 0.04, 0.035] });
  const rig = (parts, n) => add(ctx.geometry(skinGeo(parts)), skinMat, { cull: false, bones: new Float32Array(16 * n) });
  // people (v0.4.8.7 polish: skinned figures that walk, castOf): up and down the stairways and along the sidewalks, back
  // and forth with pauses; two pairs of neighbours chatting at their doors
  const paths = [...sidewalkPaths(), ...Object.entries(ALLEYS).flatMap(([s, l]) => l.map(a => alleyPath(s, a, 44)))];
  const people = [];
  const N1 = 16;
  const crowd = castOf(add, ctx, skinMat, Array.from({ length: N1 }, () => personSpec(rng)), 'crowd');
  for (let i = 0; i < N1; i++) {
    const path = paths[i % paths.length], L = pathLength(path);
    people.push({ i, path, L, s: rng.range(0, L), dir: rng.next() < 0.5 ? 1 : -1, v: rng.range(0.9, 1.4), pause: rng.range(0, 3), ph: rng.range(0, 6), k: rng.range(0.88, 0.98) });
  }
  // neighbours: two pairs at their doors (first-row houses on the north street, not the ones whose doors open), facing
  // each other, taking turns to talk with their hands
  const swing = new Set((town.doors || []).map(d => d.h));
  const doors = town.houses.filter(h => h.side === 'n' && h.row === 0 && !h.shop && Math.abs(h.along) < 50 && !swing.has(h)).slice(0, 8);
  const NB = 4, neighbours = castOf(add, ctx, skinMat, Array.from({ length: NB }, () => personSpec(rng)), 'nb'), nb = [];
  for (let i = 0; i < NB && doors.length > 1; i++) {
    const h = doors[Math.floor(i / 2) * 3 % doors.length], F = houseFrame(h), s = i % 2 ? 1 : -1, [x, y, z] = F.P(-h.w * 0.22 + s * 0.45, 0, 1.0);
    nb.push({ x, y, z, yaw: h.yaw + Math.PI + s * Math.PI / 2, ph: rng.range(0, 6), k: rng.range(0.9, 0.98) });
  }
  // people up on the lajes: two hanging out, kids flying kites (the kites and their strings a mesh of their own, a bone
  // each, out over the hill)
  const tops = town.houses.filter(h => h.row >= 1 && h.row <= 3 && (h.side === 'n' || h.side === 'e' || h.side === 'w') && Math.abs(h.along) < 70 && !h.roof.laundry && !h.roof.lights);
  const NR = 6, NK = 4, rt = [];
  const roofers = castOf(add, ctx, skinMat, Array.from({ length: NR }, () => personSpec(rng)), 'roof');
  const kParts = [];
  for (let k = 0; k < NK; k++) kParts.push(...kiteParts(HUE.kite[k % HUE.kite.length], 1.3, k, 7));
  for (let k = 0; k < NK; k++) kParts.push({ geo: G.box(0.025, 1, 0.025), matrix: Tm(0, 0.5, 0), color: c4('#f4f2ec', 1), bone: NK + k });
  const kites = rig(kParts, NK * 2);
  for (let i = 0; i < NR && tops.length; i++) {
    const h = tops.splice(rng.int(0, tops.length - 1), 1)[0], F = houseFrame(h), [x, y, z] = F.P(rng.range(-h.w / 4, h.w / 4), h.storeys * ROW.storey + 0.2, -1.2);
    rt.push({ x, y, z, yaw: h.yaw + rng.range(-0.6, 0.6), ph: rng.range(0, 6), k: i < NK ? 0.7 : 0.95, kite: i < NK ? { ph: rng.range(0, 6), r: rng.range(16, 26), up: rng.range(16, 24) } : null });
  }
  // the doors that open (town.doors): now and then one swings out, a neighbour steps out onto the street, stands about or
  // chats with whoever else is out, goes back in, and the door shuts behind them. A few at a time
  const DL = { max: 3, slots: 4, gap: [3, 11], open: 1.0, walk: 1.5, stay: [5, 12], close: 1.0, step: 1.2 };
  const dpl = castOf(add, ctx, skinMat, Array.from({ length: DL.slots }, () => personSpec(rng)), 'door');
  const dslots = Array.from({ length: DL.slots }, (_, j) => ({ j, d: -1, st: 'idle', t: 0, stay: 0, turn: 0, ph: rng.range(0, 6), k: rng.range(0.88, 0.98) }));
  const doorLife = { on: true, cycles: 0, closed: 0, maxActive: 0, next: rng.range(1, 4), slots: dslots, cfg: DL };
  // animals: stray dogs on the sidewalks and stairs (sniffing at things), cats on the walls and roof edges, chickens by a
  // door, a pigeon flock on a roof
  const ND = 4, dogs = rig(Array.from({ length: ND }, (_, i) => dogParts(['#c8a070', '#3a2a20', '#8a6a4a', '#e8dcc4'][i], i)).flat(), ND), dg = [];
  for (let i = 0; i < ND; i++) { const path = paths[(i * 5 + 2) % paths.length], L = pathLength(path); dg.push({ path, L, s: rng.range(0, L), dir: rng.next() < 0.5 ? 1 : -1, sniff: 0, ph: rng.range(0, 6), v: rng.range(1.4, 2.2) }); }
  const cs = town.houses.filter(h => h.row <= 1 && (h.side === 'n' || h.side === 's') && Math.abs(h.along) < 70), NC = 5, cats = rig(Array.from({ length: NC }, (_, i) => catParts(['#1a1a1a', '#e8934a', '#f4f2ec', '#8a8a8a', '#5a3a2a'][i], i)).flat(), NC), ct = [];
  for (let i = 0; i < NC && cs.length; i++) { const h = cs[(i * 7) % cs.length], F = houseFrame(h), H = h.storeys * ROW.storey + 0.2 + (h.roof.parapet ? 0.6 : 0); ct.push({ F, h, lx: rng.range(-h.w / 3, h.w / 3), y: H, walk: 0, dir: 1, ph: rng.range(0, 6), sit: rng.range(4, 12) }); }
  const coop = town.houses.find(h => h.side === 'n' && h.row === 0 && !h.shop && h.along > 20) || town.houses[0], NCH = 5;
  const chickens = rig(Array.from({ length: NCH }, (_, i) => chickenParts(i === 0 ? '#c8452e' : rng.pick(['#f4efe4', '#d8a060', '#8a5a3a']), i)).flat(), NCH), chk = [];
  { const F = houseFrame(coop); for (let i = 0; i < NCH; i++) { const [x, , z] = F.P(rng.range(-1.5, 1.5), 0, rng.range(0.8, 2.0)); chk.push({ x, z, cx: x, cz: z, yaw: rng.range(0, 6), peck: rng.range(0, 2), t: rng.range(0, 3) }); } }
  const roost = town.houses.find(h => h.side === 'n' && h.row === 1 && h.along > -10 && h.along < 20) || town.houses[1], NP = 12;
  const pigeons = rig(Array.from({ length: NP }, (_, i) => pigeonParts(i)).flat(), NP);
  const RF = houseFrame(roost), roostY = roost.storeys * ROW.storey + 0.2, pg = Array.from({ length: NP }, () => ({ lx: rng.range(-roost.w / 2 + 0.3, roost.w / 2 - 0.3), lz: -rng.range(0.4, roost.depth - 0.4), ph: rng.range(0, 6) }));
  const flock = { state: 'sit', t: rng.range(12, 30), k: 0 };
  // the dirtbike riders on the loop: two lanes, either way round; now and then one pulls a wheelie down a straight
  const NBk = 3, bikesMesh = add(ctx.geometry(skinGeo([...bikeParts({ color: '#e83a2a', shirt: '#f2c230', bone: 0 }), ...bikeParts({ color: '#2a8ad8', shirt: '#f4f2ec', helmet: '#e86aa0', bone: 1 }), ...bikeParts({ color: '#9ad13a', shirt: '#3a3a3a', helmet: '#f4f2ec', bone: 2 })])), skinMat, { cull: false, bones: new Float32Array(16 * NBk) });
  const riders = Array.from({ length: NBk }, (_, i) => ({ i, lane: i % 2 ? ROAD.lane : -ROAD.lane, dir: i % 2 ? -1 : 1, u: rng.range(0, loopLength()), v: rng.range(9, 12.5), wheelie: 0, wt: rng.range(4, 12), pitch: 0, hold: 0, out: false }));
  const hold = { riders: new Set() }; // (a rider borrowed by an event: hidden here)

  const update = dt => {
    const t = env.t();
    for (const p of people) {
      if (p.pause > 0) p.pause -= dt; else { p.s += p.dir * p.v * dt; if (p.s > p.L || p.s < 0) { p.dir = -p.dir; p.s = M.clamp(p.s, 0, p.L); p.pause = rng.range(1, 6); } }
      if (p.pause <= 0) p.ph += dt * p.v * 3.7; // (a stride is ~1.7 m: the legs keep up with the feet)
      const [x, y, z, yaw] = along(p.path, p.s);
      crowd.pose(p.i, x, y, z, p.dir > 0 ? yaw : yaw + Math.PI, p.pause > 0 ? MOVES.stand(t + p.i) : MOVES.walk(p.ph, 0.9), p.k);
    }
    nb.forEach((n, i) => { const talk = Math.sin(t * 0.45 + Math.floor(i / 2) * 2) * (i % 2 ? 1 : -1) > 0; neighbours.pose(i, n.x, n.y, n.z, n.yaw + Math.sin(t * 0.3 + n.ph) * 0.1, chatPose(t, n.ph, talk), n.k); });
    for (let i = nb.length; i < NB; i++) neighbours.pose(i, 0, 0, 0, 0, { hidden: true });
    rt.forEach((q, i) => {
      if (q.kite) {
        // (the kite flies out over the hill behind the house, swinging about on the wind; the kid faces it, one hand up
        // on the line, the other tugging it in)
        const k = i, a = t * 0.18 + q.kite.ph, bx = -Math.sin(q.yaw), bz = -Math.cos(q.yaw);
        const kx = q.x + bx * q.kite.r + Math.sin(a) * 3 * bz, ky = q.y + q.kite.up + Math.sin(a * 2.3) * 1.5, kz2 = q.z + bz * q.kite.r - Math.sin(a) * 3 * bx;
        boneSet(kites, k, kx, ky, kz2, Math.atan2(q.x - kx, q.z - kz2), 0.35, Math.sin(a * 3) * 0.3);
        const tug = Math.max(0, Math.sin(t * 2.2 + q.ph)), face = Math.atan2(kx - q.x, kz2 - q.z);
        roofers.pose(i, q.x, q.y, q.z, face, { aR: [2.2 + tug * 0.25, 0.2, 0.35], aL: [1.2 + tug * 0.3, 0.15, 1.1 - tug * 0.5], lL: [0.15, 0.08, 0.1], lR: [-0.1, 0.08, 0.05], lean: -0.12 - tug * 0.06, head: [-0.5, 0, 0] }, q.k);
        // the string: from the kid's raised hand to the kite
        const [hx, hy, hz] = roofers.hand(i), dx = kx - hx, dy = ky - hy, dz = kz2 - hz, L = Math.hypot(dx, dy, dz) || 1;
        const yaw = Math.atan2(dx, dz), pitch = Math.asin(Math.max(-1, Math.min(1, dy / L)));
        kites.bones.set(mul(TR(hx, hy, hz, yaw), Rx(Math.PI / 2 - pitch), Sc(1, L, 1)), (NK + k) * 16);
      } else roofers.pose(i, q.x, q.y, q.z, q.yaw + Math.sin(t * 0.4 + q.ph) * 0.3, MOVES.stand(t + q.ph), q.k);
    });
    for (let i = rt.length; i < NR; i++) roofers.pose(i, 0, 0, 0, 0, { hidden: true });
    for (let k = rt.filter(q => q.kite).length; k < NK; k++) { hide(kites, k); hide(kites, NK + k); }
    // the doors: start a neighbour's trip out now and then (a few at a time), and move everyone who's out
    const D = town.doors || [], active = dslots.filter(s => s.d >= 0).length;
    doorLife.maxActive = Math.max(doorLife.maxActive, active);
    if (D.length && doorLife.on && (doorLife.next -= dt) <= 0) {
      doorLife.next = rng.range(DL.gap[0], DL.gap[1]);
      const s = dslots.find(q => q.d < 0), busy = new Set(dslots.map(q => q.d));
      const free = D.map((_, i) => i).filter(i => !busy.has(i) && D[i].k === 0);
      if (s && active < DL.max && free.length) { s.d = rng.pick(free); s.st = 'open'; s.t = 0; s.stay = rng.range(DL.stay[0], DL.stay[1]); s.turn = rng.range(-0.7, 0.7); doorLife.cycles++; }
    }
    for (const s of dslots) {
      if (s.d < 0) { dpl.pose(s.j, 0, 0, 0, 0, { hidden: true }); continue; }
      const d = D[s.d], F = d.F; s.t += dt;
      let lz = -0.6, yaw = d.h.yaw, P = MOVES.stand(t + s.ph), hidden = false;
      if (s.st === 'open') { town.setDoor(s.d, smooth(s.t / DL.open)); hidden = true; if (s.t >= DL.open) { s.st = 'out'; s.t = 0; } }
      else if (s.st === 'out') { const k = Math.min(1, s.t / DL.walk); lz = -0.6 + k * (DL.step + 0.6); s.ph += dt * 3.4; P = MOVES.walk(s.ph, 0.8); if (k >= 1) { s.st = 'stay'; s.t = 0; } }
      else if (s.st === 'stay') {
        lz = DL.step;
        // (somebody else out at a door near by: turn to them and talk; else look up and down the street)
        const o = dslots.find(q => q !== s && q.d >= 0 && q.st === 'stay' && Math.hypot(D[q.d].mid[0] - d.mid[0], D[q.d].mid[2] - d.mid[2]) < 14);
        const [mx, , mz] = F.P(d.lx, 0, lz);
        yaw = o ? Math.atan2(D[o.d].mid[0] - mx, D[o.d].mid[2] - mz) : d.h.yaw + s.turn * Math.sin(Math.min(1, s.t / 2) * Math.PI / 2);
        P = o ? chatPose(t, s.ph, Math.sin(t * 0.5 + s.j) > 0) : MOVES.stand(t + s.ph);
        if (s.t >= s.stay) { s.st = 'in'; s.t = 0; }
      } else if (s.st === 'in') { const k = Math.min(1, s.t / DL.walk); lz = DL.step - k * (DL.step + 0.6); yaw = d.h.yaw + Math.PI; s.ph += dt * 3.4; P = MOVES.walk(s.ph, 0.8); if (k >= 1) { s.st = 'close'; s.t = 0; } }
      else if (s.st === 'close') { hidden = true; town.setDoor(s.d, 1 - smooth(s.t / DL.close)); if (s.t >= DL.close) { town.setDoor(s.d, 0); s.d = -1; s.st = 'idle'; doorLife.closed++; dpl.pose(s.j, 0, 0, 0, 0, { hidden: true }); continue; } }
      const [x, y, z] = F.P(d.lx, 0, lz);
      dpl.pose(s.j, x, y + 0.02 + (lz > -0.1 && lz < 0.6 ? 0.14 : 0), z, yaw, hidden ? { hidden: true } : P, s.k);
    }
    dg.forEach((d, i) => {
      if (d.sniff > 0) d.sniff -= dt; else { d.s += d.dir * d.v * dt; if (d.s > d.L || d.s < 0) { d.dir = -d.dir; d.s = M.clamp(d.s, 0, d.L); } if (rng.next() < dt * 0.25) d.sniff = rng.range(1.5, 4); }
      d.ph += dt * (d.sniff > 0 ? 0 : 11);
      const [x, y, z, yaw] = along(d.path, d.s);
      boneSet(dogs, i, x + 0.7, y + Math.abs(Math.sin(d.ph)) * 0.04, z, d.dir > 0 ? yaw : yaw + Math.PI, d.sniff > 0 ? -0.25 : 0);
    });
    ct.forEach((c, i) => {
      if (c.sit > 0) { c.sit -= dt; if (c.sit <= 0) { c.walk = rng.range(2, 5); c.dir = rng.next() < 0.5 ? 1 : -1; } }
      else { c.walk -= dt; c.lx = M.clamp(c.lx + c.dir * 0.5 * dt, -c.h.w / 2 + 0.3, c.h.w / 2 - 0.3); if (c.walk <= 0) c.sit = rng.range(5, 14); }
      const [x, y, z] = c.F.P(c.lx, c.y, -0.15); boneSet(cats, i, x, y, z, c.h.yaw + (c.sit > 0 ? Math.PI + Math.sin(t * 0.5 + c.ph) * 0.5 : c.dir * Math.PI / 2));
    });
    for (let i = ct.length; i < NC; i++) hide(cats, i);
    chk.forEach((c, i) => {
      c.t -= dt; if (c.t <= 0) { c.t = rng.range(1, 3.5); c.yaw += rng.range(-1.5, 1.5); }
      const mv = c.t > 2 ? 0.35 * dt : 0; c.x += Math.sin(c.yaw) * mv; c.z += Math.cos(c.yaw) * mv;
      if (Math.hypot(c.x - c.cx, c.z - c.cz) > 1.8) { c.yaw = Math.atan2(c.cx - c.x, c.cz - c.z); }
      const peck = Math.max(0, Math.sin(t * 7 + i)) > 0.6 && c.t < 2 ? 0.6 : 0;
      boneSet(chickens, i, c.x, 0, c.z, c.yaw, -peck);
    });
    // the pigeons: they sit and hop about, take off together, circle over the street and settle back
    flock.t -= dt;
    if (flock.state === 'sit' && flock.t <= 0) { flock.state = 'fly'; flock.t = rng.range(9, 14); flock.k = 0; }
    else if (flock.state === 'fly' && flock.t <= 0) { flock.state = 'sit'; flock.t = rng.range(20, 45); }
    flock.k = M.damp(flock.k, flock.state === 'fly' ? 1 : 0, 1.6, dt);
    const [rx, ry, rz] = RF.P(0, roostY, -roost.depth / 2);
    pg.forEach((b, i) => {
      const [sx, sy, sz] = RF.P(b.lx, roostY, b.lz), a = t * 0.9 + i * 0.52, R = 9 + (i % 3) * 2.5;
      const fx = rx + Math.sin(a) * R, fy = ry + 7 + Math.sin(a * 1.7 + i) * 1.5, fz = rz - 6 + Math.cos(a) * R * 0.7, k = flock.k;
      const x = sx + (fx - sx) * k, y = sy + (fy - sy) * k + (k < 0.02 ? Math.max(0, Math.sin(t * 3 + b.ph)) * 0.04 : 0), z = sz + (fz - sz) * k;
      boneSet(pigeons, i, x, y, z, k > 0.1 ? a + Math.PI / 2 : roost.yaw + b.ph, 0, k > 0.1 ? Math.sin(t * 18 + i) * 0.5 : 0);
    });
    riders.forEach(b => {
      if (hold.riders.has(b.i)) { hide(bikesMesh, b.i); return; }
      b.u += b.dir * b.v * dt;
      const L = loopLength(b.lane), uu = ((b.u % L) + L) % L, [x, z, yaw0] = loopAt(uu, b.lane), yaw = b.dir > 0 ? yaw0 : yaw0 + Math.PI;
      // wheelies only on the long straights
      const straight = Math.abs(loopAt(uu + 8, b.lane)[2] - yaw0) < 0.01 && Math.abs(loopAt(uu - 8, b.lane)[2] - yaw0) < 0.01;
      if (b.hold > 0) { b.hold -= dt; if (b.hold <= 0 || !straight) b.hold = 0; } else if ((b.wt -= dt) <= 0) { b.wt = rng.range(6, 16); if (straight && rng.next() < 0.7) b.hold = rng.range(1.2, 3); }
      b.pitch = M.damp(b.pitch, b.hold > 0 ? 0.48 + Math.sin(t * 4) * 0.04 : 0, 7, dt);
      // (the wheelie pivots on the rear axle, 0.62 m back)
      const m = M.m4fromYaw(M.m4(), x, 0, z, yaw); M.m4mul(m, m, mul(Tm(0, 0.34, -0.62), Rx(-b.pitch), Tm(0, -0.34, 0.62))); bikesMesh.bones.set(m, b.i * 16);
      if (b.hold > 0 && rng.next() < dt * 5) env.r?.particles?.burst?.(x - Math.sin(yaw) * 1, 0.2, z - Math.cos(yaw) * 1, 1, { color: [0.26, 0.2, 0.15], speed: 0.5, up: 0.3, life: 1.0, size: 0.28, gravity: 0.1, drag: 0.5 });
    });
  };
  update(0);
  env.updExtra.push(update);
  return { town, crowd, people, neighbours, roofers, kites, doorPeople: dpl, doorLife, dogs, cats, chickens, pigeons, flock, bikes: bikesMesh, riders, hold, skinMat, rig };
}

// ---- random events: each returns dt => still going (parklife.js removes what it added when it's over) ----
// the police chase: a rider flat out down a street with the police bike (light bar and siren going) on his tail; he cuts
// into a stairway and he's gone up it; the officer stops at the foot of the steps, waits, gives up and rides off. The
// rider always gets away: the police bike never closes to within CHASE.minGap of him
const SHOWERS = new WeakMap();
export const CHASE = { rider: 15.5, police: 14, gap0: 16, minGap: 7, wait: 3.2, up: 22 };
export function chasePlan(rng, foot = false) {
  // a stairway on the north or south street (the side the cameras see most), approached along that street
  const sides = ['n', 's', 'n'], side = rng.pick(sides), along = rng.pick(ALLEYS[side]), dir = rng.next() < 0.5 ? 1 : -1;
  const roomW = along - (ROAD.w + ROAD.r), roomE = ROAD.e - ROAD.r - along, d = roomE > roomW ? -1 : 1; void dir;
  const z = side === 'n' ? ROAD.n + ROAD.lane * 0.6 : ROAD.s - ROAD.lane * 0.6, startX = along - d * Math.min(foot ? 55 : 95, Math.max(roomE, roomW));
  const street = [[startX, 0, z], [along - d * 3, 0, z]];
  const [mx, , mz] = alleyMouth(side, along), mouth = [mx, 0, mz];
  const up = alleyPath(side, along, CHASE.up + 6).slice(1);
  const rider = [...street, mouth, ...up];
  return { side, along, dir: d, rider, mouthS: pathLength([...street, mouth]), total: pathLength(rider) };
}
// the bateria's route: down a north stairway (from 24 m up it), east or west along the street's outer sidewalk, up the next
// stairway along
export function bateriaRoute(rng) {
  const al = ALLEYS.n, i = rng.int(0, al.length - 2), [a, b] = rng.next() < 0.5 ? [al[i], al[i + 1]] : [al[i + 1], al[i]];
  const down = alleyPath('n', a, 24).reverse(), up = alleyPath('n', b, 24), z = ROAD.n + ROAD.half + 1.5;
  return [...down, [a, 0.02, z], [b, 0.02, z], ...up];
}
export function favelaEvents(env, F) {
  const { rng, add, ctx, scene, r } = env;
  const dust = (x, z) => r?.particles?.burst?.(x, 0.25, z, 2, { color: [0.26, 0.2, 0.15], speed: 0.7, up: 0.5, life: 1.2, size: 0.3, gravity: 0.05, drag: 0.45 });
  const stats = F.stats || (F.stats = { chases: 0, escapes: 0, minGap: Infinity });
  // a chase: the rider borrowed from the loop if one's free (hidden there), the police bike or two officers on foot
  const chase = (foot = false) => () => {
    // (v0.4.8.7 polish: in the foot chase it's a lad on foot who legs it, the officers running after him, all of them
    // skinned figures with real strides; the siren goes with the police, bike or foot: favelasound.js)
    const plan = chasePlan(rng, foot);
    const runner = foot ? castOf(add, ctx, F.skinMat, [{ skin: '#5a3a26', top: '#e86aa0', bottom: '#2a3a5a', hair: 'cap', hairCol: '#f2c230' }], 'runner')
      : add(ctx.geometry(skinGeo(bikeParts({ color: '#e8934a', shirt: '#e86aa0', helmet: '#2a2a2a', bone: 0 }))), F.skinMat, { cull: false, bones: new Float32Array(16) });
    const free = F.riders.find(b => !F.hold.riders.has(b.i)); if (free && !foot) F.hold.riders.add(free.i);
    const cops = foot ? castOf(add, ctx, F.skinMat, [0, 1].map(i => ({ skin: SKINS[i * 2], top: '#1f3a6a', bottom: '#1a2a44', hair: 'cap', hairCol: '#1a2a44' })), 'cops')
      : add(ctx.geometry(skinGeo(bikeParts({ police: true, bone: 0 }))), F.skinMat, { cull: false, bones: new Float32Array(16) });
    const barMat = new Material({ color: [1, 1, 1], shading: 'unlit', fog: false }), bar = foot ? null : add(ctx.geometry(skinGeo(policeLightParts(0))), barMat, { cull: false, bones: cops.bones });
    const vR = foot ? 7.4 : CHASE.rider, vP = foot ? 6.2 : CHASE.police, stopAt = plan.mouthS - (foot ? 1.5 : 2.2);
    let sR = 0, sP = -CHASE.gap0, t = 0, waited = 0, back = 0, done = false, ph = 0, escaped = false, rph = 0;
    const siren = FX.siren(scene, foot ? 0.8 : 1);
    if (foot) F.cast = { ...F.cast, runner, cops };
    stats.chases++; stats.sirens = (stats.sirens || 0) + (siren ? 1 : 0);
    return dt => {
      t += dt; ph += dt / 1.1;
      // the rider: flat out, slowing for the turn into the steps and the climb, gone at the top of what you can see
      const slow = sR > plan.mouthS - 6 ? (foot ? 0.8 : 0.55) : 1;
      if (!escaped) { sR += vR * slow * dt; rph += vR * slow * dt * 2.7; if (sR >= plan.total - 0.5) { escaped = true; stats.escapes++; } }
      const [x, y, z, yaw] = along(plan.rider, sR);
      if (foot) runner.pose(0, x, y, z, yaw, escaped ? { hidden: true } : MOVES.run(rph, 1), 0.92);
      else if (escaped) hide(runner, 0); else { const climb = sR > plan.mouthS ? 0.18 : 0; const m = M.m4fromYaw(M.m4(), x, y, z, yaw); M.m4mul(m, m, Rx(-climb)); runner.bones.set(m, 0); }
      if (!foot && !escaped && sR < plan.mouthS && rng.next() < dt * 10) dust(x - Math.sin(yaw), z - Math.cos(yaw));
      // the police: never past the foot of the steps; they wait there, then turn back the way they came
      if (waited < CHASE.wait) { if (sP < stopAt) sP = Math.min(stopAt, sP + vP * dt); else waited += dt; }
      else { back += vP * 0.8 * dt; }
      const sp = waited < CHASE.wait ? sP : Math.max(-60, stopAt - back);
      if (!escaped && sp > 0) stats.minGap = Math.min(stats.minGap, sR - sp);
      const [px, py, pz, pyaw] = along(plan.rider, Math.max(0, sp)), facing = waited >= CHASE.wait ? pyaw + Math.PI : pyaw, offStreet = sp < 0;
      const ox = offStreet ? plan.rider[0][0] + (sp) * plan.dir : px, oz = pz;
      if (foot) {
        // (running flat out; at the foot of the steps hands on their knees getting their breath, then a look up the steps;
        // then they walk back the way they came)
        const run = waited < CHASE.wait && sP < stopAt, cph = t * vP * 2.7;
        for (let i = 0; i < 2; i++) {
          const lag = i * 1.4, s2 = Math.max(0, sp - lag), [qx, qy, qz, qyaw] = along(plan.rider, s2);
          const P = run ? MOVES.run(cph + i * 0.9, 0.95) : waited < CHASE.wait ? (waited < CHASE.wait * 0.6 ? MOVES.hunch(0.55) : MOVES.stand(t + i)) : MOVES.walk(t * 4.6 + i, 0.85);
          cops.pose(i, (offStreet ? ox - lag * plan.dir : qx) + (i ? 0.7 : -0.4), qy, qz + (i ? 0.5 : 0), waited >= CHASE.wait ? qyaw + Math.PI : qyaw, P, 0.96);
        }
      } else boneSet(cops, 0, ox, py, oz, facing);
      if (bar) { const p = barPhase(ph); barMat.color = [0.4 + (p.red ? 12 : 0), 0.2 + (p.red || p.blue ? 1.2 : 0), 0.4 + (p.blue ? 12 : 0)]; if (!offStreet && rng.next() < dt * 6 && waited < CHASE.wait) dust(px - Math.sin(pyaw), pz - Math.cos(pyaw)); }
      siren?.update(dt, ox, oz);
      done = escaped && waited >= CHASE.wait && (stopAt - back) < -40;
      if (done || t > 60) { if (!escaped) { stats.escapes++; escaped = true; } if (free && !foot) F.hold.riders.delete(free.i); if (foot) runner.pose(0, 0, 0, 0, 0, { hidden: true }); else hide(runner, 0); siren?.stop(); return false; }
      return true;
    };
  };
  // the kite fight (v0.4.8.7 polish: read from the plaza): two kids on the lajes of the first row up the north hill fly big
  // pipas just over the roofs behind, their long strings drawn from their hands; the kites swoop round each other and cross
  // lines, one string is cut, and the loose kite drifts away across the view on the wind, tumbling, a bit of its line
  // trailing, while its kid hauls in the slack and the winner throws his arms up
  const KF = { s: 4.2, y: 26, z: 62, cut: 10, drift: 3.4, end: 27, strW: 0.05 };
  const kiteFight = () => {
    const parts = [...kiteParts('#f2c230', KF.s, 0, 9), ...kiteParts('#e86aa0', KF.s, 1, 9)];
    for (let k = 0; k < 2; k++) parts.push({ geo: G.box(KF.strW, 1, KF.strW), matrix: Tm(0, 0.5, 0), color: c4('#f4f2ec'), bone: 2 + k });
    const mesh = add(ctx.geometry(skinGeo(parts)), F.skinMat, { cull: false, bones: new Float32Array(64) });
    const cx = rng.range(-28, 14), loser = rng.int(0, 1), dirX = cx > -6 ? -1 : 1;
    // (the flyers: on first-row roofs either side of the fight, kids, facing their kites)
    const roofs = (env.town?.houses || []).filter(h => h.side === 'n' && h.row === 0 && !h.roof.laundry && !h.roof.lights);
    const spot = x0 => { const h = roofs.reduce((b, h) => (!b || Math.abs(h.along - x0) < Math.abs(b.along - x0) ? h : b), null); if (!h) return [x0, 12, 56]; const p = houseFrame(h).P(0, h.storeys * ROW.storey + 0.2, -2.5); return p; };
    const fl = [spot(cx - 10), spot(cx + 10)], kids = castOf(add, ctx, F.skinMat, [{ skin: '#5a3a26', top: '#f2c230', bottom: '#2a3a5a', hair: 'short' }, { skin: '#c48e62', top: '#e86aa0', bottom: '#3a3a3a', hair: 'cap', hairCol: '#2fb8b0' }], 'kfly'); F.cast = { ...F.cast, kids };
    const st = { t: 0, cut: false, kites: [[0, 0, 0], [0, 0, 0]] }; F.kiteFightState = st;
    return dt => {
      const t = (st.t += dt), cut = st.cut = t > KF.cut;
      for (let i = 0; i < 2; i++) {
        let x, y, z, roll, pitch = 0.3;
        const a = t * (0.85 + i * 0.22) + i * Math.PI;
        if (i === loser && cut) { const k = t - KF.cut; x = cx + 2 + dirX * k * KF.drift; y = KF.y + 2 - k * 0.3 + Math.sin(k * 2.6) * 0.9; z = KF.z - k * 0.2; roll = Math.sin(k * 3.1) * 1.4; pitch = 0.3 + Math.sin(k * 2.2) * 0.6; }
        else { const r = cut ? 3 : 7; x = cx + (i ? 4 : -4) * (cut ? 0.3 : 1) + Math.sin(a) * r; y = KF.y + Math.sin(a * 2) * 3 + (cut ? Math.min(4, (t - KF.cut) * 0.8) : 0); z = KF.z + Math.cos(a) * 3; roll = Math.cos(a) * 0.6; }
        st.kites[i] = [x, y, z];
        boneSet(mesh, i, x, y, z, Math.PI, pitch, roll);
        // the kid: faces the kite, hands on the line (the loser's hauling in; the winner's arms up)
        const [fx, fy, fz] = fl[i], face = Math.atan2(x - fx, z - fz), tug = Math.max(0, Math.sin(t * 2.6 + i * 2));
        const P = cut && i !== loser && t < KF.cut + 3 ? { aL: [2.8, 0.4, 0.2], aR: [2.8, 0.4, 0.2], head: [-0.4, 0, 0] }
          : cut && i === loser ? { aR: [1.0 + tug * 0.6, 0.2, 1.4 - tug * 0.8], aL: [1.3 - tug * 0.6, 0.2, 1.4], lean: 0.1, head: [-0.2, 0, 0] }
            : { aR: [2.2 + tug * 0.3, 0.2, 0.35], aL: [1.2 + tug * 0.3, 0.15, 1.1 - tug * 0.5], lL: [0.2, 0.08, 0.12], lR: [-0.12, 0.08, 0.05], lean: -0.12 - tug * 0.08, head: [-0.55, 0, 0] };
        kids.pose(i, fx, fy, fz, face, P, 0.74);
        // the string: hand to kite; the cut one a loose length trailing down from the drifting kite
        let h0 = kids.hand(i), dx, dy, dz, L;
        if (i === loser && cut) { h0 = [x - dirX * 2, y - 9, z + 1]; }
        dx = x - h0[0]; dy = y - h0[1]; dz = z - h0[2]; L = Math.hypot(dx, dy, dz) || 1;
        mesh.bones.set(mul(TR(h0[0], h0[1], h0[2], Math.atan2(dx, dz)), Rx(Math.PI / 2 - Math.asin(Math.max(-1, Math.min(1, dy / L)))), Sc(1, L, 1)), (2 + i) * 16);
      }
      return t < KF.end;
    };
  };
  // a bateria comes down one of the north stairways, along the street and up another one: drummers in a block, the flag
  // up front, everybody bouncing on the beat (the route: bateriaRoute)
  // (v0.4.8.7 polish: the drummers are walking figures with their drums on them and their sticks going on the beat: the
  // tamborims up front, the caixas, the surdos at the back; the flag bearer ahead; the drums sound: favelasound.js)
  const bateria = () => {
    const N = 10, drum = i => (i === 0 ? 'flag' : ['tamborim', 'caixa', 'surdo'][Math.floor((i - 1) / 3)]);
    const kit = {
      flag: [{ geo: G.box(0.035, 2.5, 0.035), matrix: Tm(0, -1.0, 0.02), color: c4('#d8d2c4'), bone: 6 }, { geo: G.box(0.02, 0.85, 1.25), matrix: Tm(0, -1.85, -0.64), color: c4('#2f8a4a'), bone: 6 }, { geo: G.box(0.026, 0.42, 0.42), matrix: mul(Tm(0, -1.85, -0.64), Rx(Math.PI / 4)), color: c4('#f2c230'), bone: 6 }],
      tamborim: [{ geo: G.cylinder(0.11, 0.11, 0.04, 10), matrix: mul(Tm(0, -0.33, 0.04), Rx(Math.PI / 2)), color: c4('#c8c8cc'), bone: 4 }, { geo: G.box(0.02, 0.02, 0.3), matrix: Tm(0, -0.3, 0.13), color: c4('#2a2a2a'), bone: 6 }],
      caixa: [{ geo: G.cylinder(0.2, 0.2, 0.16, 12), matrix: mul(Tm(0.04, 0.1, 0.3), Rx(0.45)), color: c4('#c8c8cc'), bone: 0 }, ...[4, 6].map(b => ({ geo: G.box(0.02, 0.02, 0.36), matrix: Tm(0, -0.3, 0.15), color: c4('#e8dcc4'), bone: b }))],
      surdo: [{ geo: G.cylinder(0.28, 0.28, 0.48, 12), matrix: mul(Tm(0, -0.04, 0.33), Rx(0.25)), color: c4('#d8302a'), bone: 0 }, { geo: G.cylinder(0.285, 0.285, 0.03, 12), matrix: mul(Tm(0, -0.04, 0.33), Rx(0.25), Tm(0, 0.24, 0)), color: c4('#f4f2ec'), bone: 0 }, { geo: G.box(0.035, 0.035, 0.34), matrix: Tm(0, -0.3, 0.16), color: c4('#3a2a1a'), bone: 6 }, { geo: G.sphere(0.06, 6, 4), matrix: Tm(0, -0.3, 0.33), color: c4('#f4f2ec'), bone: 6 }],
    };
    const specs = Array.from({ length: N }, (_, i) => ({ skin: SKINS[(i * 5) % SKINS.length], top: i === 0 ? '#2f8a4a' : i % 2 ? '#f4f2ec' : '#2fb8b0', bottom: '#f4f2ec', hair: 'cap', hairCol: i % 2 ? '#2fb8b0' : '#f4f2ec', extra: kit[drum(i)] }));
    const band = castOf(add, ctx, F.skinMat, specs, 'bateria'); F.cast = { ...F.cast, band };
    const route = bateriaRoute(rng), L = pathLength(route), bpm = FX.FAVELA_SOUND.bpm, st = { s: 0, t: 0, route, L, at: route[0].slice() }; F.bateriaState = st;
    const drums = FX.bateria(scene); stats.drums = (stats.drums || 0) + (drums ? 1 : 0);
    // the arms on the beat: e rises through a stroke and drops on the hit
    const stroke = (b, off = 0) => { const f = (((b + off) % 1) + 1) % 1; return f * f; };
    return dt => {
      const t = (st.t += dt), s = (st.s += 1.25 * dt), b = t * bpm / 60;
      for (let i = 0; i < N; i++) {
        const row = i === 0 ? -1 : Math.floor((i - 1) / 3), col = i === 0 ? 1 : (i - 1) % 3, si = s - (i === 0 ? -2.5 : row * 1.3);
        if (si < 0 || si > L) { band.pose(i, 0, 0, 0, 0, { hidden: true }); continue; } // (still up the stairway, or gone up the other one)
        const [x, y, z, yaw] = along(route, si), off = i === 0 ? 0 : (col - 1) * 0.85;
        // (a step on every beat, short strides; a bounce on the beat)
        const P = MOVES.walk(b * Math.PI + col * 0.3, 0.6); P.drop = 0.03 + Math.abs(Math.sin(b * Math.PI)) * 0.04; P.lean = 0.02;
        const k = drum(i);
        if (k === 'flag') { P.aR = [0.5, 0.15, 2.4 + Math.sin(t * 1.3) * 0.08]; P.aL = [0.35, 0.25, 0.5]; P.twist = Math.sin(b * Math.PI / 2) * 0.15; }
        else if (k === 'surdo') { const e = stroke(b / 2, 0.5); P.aR = [0.45 + e * 0.75, 0.2, 0.7 + e * 0.6]; P.aL = [0.55, 0.3, 1.0]; }
        else if (k === 'caixa') { P.aR = [0.5 + stroke(b * 2) * 0.35, 0.18, 1.15 + stroke(b * 2) * 0.35]; P.aL = [0.5 + stroke(b * 2, 0.5) * 0.35, 0.18, 1.15 + stroke(b * 2, 0.5) * 0.35]; }
        else { P.aL = [1.1, 0.3, 1.5]; P.aR = [0.9 + stroke(b * 2) * 0.45, 0.2, 1.3 + stroke(b * 2) * 0.4]; }
        band.pose(i, x + Math.cos(yaw) * off, y, z - Math.sin(yaw) * off, yaw, P, 0.95);
        if (i === 4) st.at = [x, y, z];
      }
      drums?.update(dt, st.at[0], st.at[2]);
      if (s >= L + 6) { drums?.stop(1.2); return false; }
      return true;
    };
  };
  // a block's power goes: a third of the windows flicker out, stay dark a few seconds and come back flickering
  const blackout = () => {
    const idx = [0, 1, 2, 3].map(k => (k * 3 + rng.int(0, 2)) % F.groupsN);
    let t = 0, off = false;
    return dt => {
      t += dt;
      if (!off && t > 0.3) { off = true; env.town?.power(idx, false); }
      if (off && t > 5.5) { env.town?.power(idx, true); return false; }
      return t < 8;
    };
  };
  // a tropical shower: rain streaming down over the hillside and the park's edges, splashes on the street, then it stops
  // (showers can overlap: the exposure they dim is the one from before the first, given back when the last stops)
  const shower = () => {
    let t = 0; const S = SHOWERS.get(scene) || { n: 0, base: scene.exposure }; if (!S.n) S.base = scene.exposure; S.n++; SHOWERS.set(scene, S); const e0 = S.base;
    return dt => {
      t += dt;
      const k = Math.max(0, Math.min(1, t / 2, (16 - t) / 2));
      for (let n = 0; n < 40 * dt * 60 * k; n++) r?.particles?.emit?.({ x: rng.range(-90, 80), y: rng.range(10, 18), z: rng.pick([rng.range(36, 70), rng.range(-70, -36), rng.range(-34, 34)]), vx: 1.2, vy: -16, vz: 0.4, life: 1.1, size: 0.05, color: [0.55, 0.6, 0.7], gravity: 3, drag: 0, grow: 1, fade: 1 });
      scene.exposure = e0 * (1 - 0.12 * Math.max(0, k));
      if (t >= 16) { if (--S.n === 0) scene.exposure = e0; return false; }
      return true;
    };
  };
  F.groupsN = env.town?.groups?.length || 12;
  return [chase(false), chase(false), chase(true), kiteFight, bateria, blackout, shower];
}
