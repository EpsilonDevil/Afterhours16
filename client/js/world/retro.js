// v0.4.8.5 quick patch: And The Beat Goes On, the event park in an 80s city at sundown. The park keeps its standard
// layout; round it runs a city block of its own: a palm-lined boulevard along the north side ("the Strip"), an avenue
// down each side, a strip of shops facing the plaza from the south (the diner, a cocktail lounge, the record shop, the
// pizza place, the DISCO and a live-music club) and a street behind them. Pastel art-deco blocks with neon trim, rounded
// corners and stepped crowns line every street; mirror-glass towers stand in the haze. The sun sits right on the
// west-north-west horizon (a striped synthwave disc on a sky dome of its own: purple overhead, hot pink, orange at the
// horizon) and the low buildings and palms along its bearing stand in silhouette against it. Neon signs everywhere
// (some flicker, some chase, some cycle colour; they all black out together in an event: parklife.js), the disco bar
// with its mirror ball over the door, a light-up dance floor through the windows and searchlights sweeping the sky.
// Also here: the lowrider and the dancer figures parklife.js animates (one mesh each).
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG, makeNoise2D } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { cachedTexture } from './court.js';
import * as PR from './props.js';
import { PARK_COURTS } from './themes.js';
import { shadedPlane, camClear } from './harbor.js';

const lin = hex => M.hexLinear(hex);
const c4 = hex => (typeof hex === 'string' ? [...lin(hex), 1] : hex);
const TR = (x, y, z, yaw = 0) => M.m4fromYaw(M.m4(), x, y, z, yaw);
const put = (out, geo, x, y, z, hex, yaw = 0) => out.push({ geo, matrix: TR(x, y, z, yaw), color: c4(hex) });
const DEG = Math.PI / 180;
const Rx = a => M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, a));
const Ry = a => M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 1, 0, a));
const Rz = a => M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, a));
const Tm = (x, y, z) => M.m4translation(M.m4(), x, y, z);
const mul = (...ms) => ms.reduce((a, b) => M.m4mul(M.m4(), a, b));
export const NEON = { pink: '#ff3fa4', cyan: '#2fe0ff', purple: '#b14dff', yellow: '#ffe45c', orange: '#ff8a3c', mint: '#3dffb0', red: '#ff4a6a', white: '#fff4e6' };

// ---- the street plan (world metres) ----
// the Strip: the boulevard north of the park (westbound lanes on its south half, eastbound on the north, palms down the
// median); the avenues east and west (AVE mirrored); the shops along the south sidewalk, a street behind them
export const STRIP = { z0: 37, z1: 56, median: [45, 48], walkIn: [33.4, 37], walkOut: [56, 60], lanes: [{ z: 39.3, dir: -1 }, { z: 42.7, dir: -1 }, { z: 50.3, dir: 1 }, { z: 53.7, dir: 1 }] };
export const AVE = { x0: 67.5, x1: 77.5, walkIn: 63.6, walkOut: 81.5, lanes: [{ x: 69.9, dir: -1 }, { x: 75.1, dir: 1 }] };
export const SOUTH = { walk: [-40.2, -34.3], front: -40.2, z0: -66, z1: -57, lanes: [{ z: -59.3, dir: 1 }, { z: -63.7, dir: -1 }], back: -70 };
export const EXTENT = 175;
// the disco bar: its front (the door in the middle) faces the plaza from across the south sidewalk
export const DISCO = { x: 25, z: -40.2, w: 22, d: 13.6, h: 8 };
// where people gather (parklife.js): the breakers' cardboard, the boombox crew, the dancers outside the disco and the line
// (v0.4.8.8: the breakers' cardboard moved west of the kiosks, from x 17.5: the Pro-Am HUB stands east of them now)
export const SPOTS = { breakers: { x: -10.5, z: -31.2 }, crew: { x: 36.5, z: -31.2 }, door: { x: DISCO.x, z: DISCO.z + 2.6 }, line: { x0: DISCO.x + 3.2, x1: DISCO.x + 9.6, z: DISCO.z + 0.9 } };
// the sun's bearing (from north toward the west) as a unit vector on the ground
export const sunBearing = theme => { const a = (theme?.sunset?.az ?? 68) * DEG; return [-Math.sin(a), Math.cos(a)]; };

// the game cameras' paths (harbor.js camClear) plus the half courts' broadcast cameras, which stand out past the west
// fence over the avenue's sidewalk: nothing tall goes there
export function retroClear(x, z, pad = 4.5) {
  if (!camClear(x, z, pad)) return false;
  for (const c of PARK_COURTS) if (!c.full) {
    const [ox, , oz] = c.origin;
    if (Math.abs(x - (ox - 16.5)) < 3 + pad && z > oz - 2 - pad && z < oz + 12 + pad) return false;
  }
  return true;
}
// low buildings only along the sun's bearing, so the disc shows over the roofs from the courts and the plaza
export function inSunBand(x, z, theme) { const [bx, bz] = sunBearing(theme); return x * bx + z * bz > 62 && Math.abs(-x * bz + z * bx) < 36; }

// ---- the ground ----
let streetTex = null;
const streetMaps = () => streetTex || (streetTex = T.street({ meters: 16 }));
export function retroGround(ctx, scene, theme) {
  // the streets: one asphalt plane out to the haze, vertex shaded so the tile never shows (the same maps as the Old
  // Brick Yard's: they're cached under the same keys)
  const color = cachedTexture(ctx, 'street-c', () => streetMaps().color, { aniso: 16 });
  const normal = cachedTexture(ctx, 'street-n', () => streetMaps().normal, { srgb: false, aniso: 16 });
  const rough = cachedTexture(ctx, 'street-r', () => streetMaps().rough, { srgb: false, aniso: 16 });
  const noise = makeNoise2D(91), tint = lin('#c4bccc');
  const shade = (x, z) => { const n = noise.fbm(x / 45, z / 45, 3), k = 1 + n * 0.2 + noise(x / 11, z / 11) * 0.05; return [tint[0] * k, tint[1] * k, tint[2] * k * (1 + n * 0.06)]; };
  const geo = shadedPlane(-EXTENT - 40, EXTENT + 40, -EXTENT - 40, EXTENT + 40, 12, 16, shade, -0.02);
  const ground = new Mesh(ctx.geometry(geo), new Material({ color: [1, 1, 1], map: color, normalMap: normal, normalScale: 0.5, roughMap: rough, roughness: 0.7, specular: 0.42 }), { castShadow: false, reflect: false });
  ground.order = -3; scene.add(ground);
  // the park's own slab: the event parks' jointed concrete, warm and pale under the sunset
  const conc = cachedTexture(ctx, 'concrete', () => T.concrete({ joints: true }).color, {});
  const concN = cachedTexture(ctx, 'concreteN', () => T.concrete({ joints: true }).normal, { srgb: false });
  const W = 127.2, D = 67.7, slab = G.plane(W, D, 1, 1);
  for (let i = 0; i < slab.uv.length; i += 2) { slab.uv[i] *= W / 4; slab.uv[i + 1] *= D / 4; }
  const m = new Mesh(ctx.geometry(slab), new Material({ color: lin(theme.ground).map(v => v * 1.75), map: conc, normalMap: concN, normalScale: 0.6, roughness: 0.8 }), { castShadow: false, reflect: false });
  M.m4translation(m.matrix, 0, -0.005, (33.4 - 34.3) / 2); m.order = -2; scene.add(m);
  return [ground, m];
}

// ---- the sky: a dome of vertex colours, the striped sun on the horizon, long thin clouds across it ----
// el: elevation (radians), cs: cosine of the angle to the sun's bearing (round the horizon), cd: to the disc itself
export function skyColor(el, cs, cd) {
  const e = el / DEG, mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sunward = Math.pow(Math.max(0, cs * 0.5 + 0.5), 3);
  const hz = mix([0.88, 0.3, 0.4], [1.25, 0.46, 0.2], sunward);
  let c;
  if (e < 0) c = mix(mix(hz, [0.86, 0.44, 0.42], 0.5), [0.2, 0.09, 0.13], M.smooth(-e / 10));
  else {
    const stops = [[0, hz], [4, mix([0.92, 0.22, 0.44], [1.1, 0.34, 0.3], sunward)], [9, [0.62, 0.1, 0.42]], [18, [0.32, 0.06, 0.38]], [32, [0.14, 0.04, 0.27]], [60, [0.06, 0.025, 0.16]], [90, [0.035, 0.02, 0.1]]];
    let k = 0; while (k < stops.length - 2 && e > stops[k + 1][0]) k++;
    c = mix(stops[k][1], stops[k + 1][1], M.smooth((e - stops[k][0]) / (stops[k + 1][0] - stops[k][0])));
  }
  // the glow round the sun
  const g = Math.max(0, cd);
  return [c[0] + 0.6 * g ** 30 + 0.18 * g ** 6, c[1] + 0.26 * g ** 30 + 0.05 * g ** 6, c[2] + 0.06 * g ** 30 + 0.02 * g ** 6];
}
export function retroSky(ctx, scene, theme) {
  const S = theme.sunset, [bx, bz] = sunBearing(theme), sel = S.el * DEG;
  const sd = [bx * Math.cos(sel), Math.sin(sel), bz * Math.cos(sel)];
  // (the dome is drawn first and writes no depth, so its size only has to keep it inside the far plane from anywhere a
  // camera goes; the sun and the clouds sit inside it, beyond the city and the ground's far edge)
  const els = [-90, -30, -10, -4, -1.5, 0, 0.8, 1.8, 3, 4.5, 6.5, 9, 12, 16, 21, 28, 37, 48, 62, 76, 90].map(d => d * DEG), nAz = 72, R = 255;
  const pos = [], col = [], nrm = [], uv = [], idx = [];
  els.forEach(el => {
    for (let j = 0; j <= nAz; j++) {
      const a = j / nAz * Math.PI * 2, d = [Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)];
      pos.push(d[0] * R, d[1] * R, d[2] * R); nrm.push(-d[0], -d[1], -d[2]); uv.push(j / nAz, 0);
      const cs = (Math.sin(a) * bx + Math.cos(a) * bz), cd = d[0] * sd[0] + d[1] * sd[1] + d[2] * sd[2];
      col.push(...skyColor(el, cs, cd), 1);
    }
  });
  for (let i = 0; i < els.length - 1; i++) for (let j = 0; j < nAz; j++) { const a = i * (nAz + 1) + j, b = a + nAz + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const dome = new Mesh(ctx.geometry({ position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), color: new Float32Array(col), index: new Uint16Array(idx) }),
    new Material({ color: [1, 1, 1], shading: 'unlit', fog: false, doubleSided: true, depthWrite: false }), { castShadow: false, reflect: false, cull: false });
  dome.order = -10; scene.add(dome);
  // the sun: a striped disc (T.synthSun) facing the park, just above the horizon
  const dist = S.dist, rad = Math.tan(S.size / 2 * DEG) * dist, q = rad * 2 / 0.68;
  const cx = sd[0] * dist, cy = Math.sin(sel) * dist, cz = sd[2] * dist;
  const sun = new Mesh(ctx.geometry(G.quad(q, q)), new Material({ map: cachedTexture(ctx, 'synthsun', () => T.synthSun(), { wrap: 'clamp' }), color: [2.4, 2.4, 2.4], shading: 'unlit', fog: false, blend: 'alpha', depthWrite: false }), { castShadow: false, reflect: false });
  M.m4fromYaw(sun.matrix, cx, cy, cz, Math.atan2(-cx, -cz)); sun.order = -9; scene.add(sun);
  // long thin clouds lit pink and orange from below, a few across the sun, the rest round the western half of the sky
  const clouds = [], rng = new RNG(77), base = Math.atan2(bx, bz);
  for (let i = 0; i < 16; i++) {
    const near = i < 5, a = base + (near ? rng.range(-0.16, 0.16) : rng.range(-1.6, 1.6)), d = rng.range(215, 238), el = (near ? rng.range(2, 10) : rng.range(3, 16)) * DEG;
    const x = Math.sin(a) * Math.cos(el) * d, y = Math.sin(el) * d, z = Math.cos(a) * Math.cos(el) * d, w = rng.range(36, 95) * (near ? 0.8 : 1), h = w * rng.range(0.07, 0.12);
    const k = Math.max(0, Math.cos(a - base)), glow = near ? 1 : k * k;
    const cl = [0.6 + 0.7 * glow, 0.2 + 0.3 * glow, 0.46 - 0.1 * glow, rng.range(0.7, 0.95)];
    const gq = G.quad(w, h); if (rng.next() < 0.5) for (let v = 0; v < 4; v++) gq.uv[v * 2] = 1 - gq.uv[v * 2];
    clouds.push({ geo: gq, matrix: TR(x, y, z, Math.atan2(-x, -z)), color: cl });
  }
  const cm = new Mesh(ctx.geometry(G.merge(PR.bake(clouds))), new Material({ map: cachedTexture(ctx, 'cloudstreak', () => T.cloudStreak(), { wrap: 'clamp' }), color: [1.2, 1.2, 1.2], shading: 'unlit', fog: false, blend: 'alpha', depthWrite: false }), { castShadow: false, reflect: false });
  cm.order = -8; scene.add(cm);
  return { dome, sun, clouds: cm };
}

// ---- the city plan (pure; tests/v0485beatpark checks it) ----
// every block: {x, z (footprint centre), w (along x), d (along z), h, face ('z+' | 'z-' | 'x+' | 'x-': its street side),
// kind ('stucco' | 'glass'), tint, trim (neon colour), round (a rounded front corner: -1 left, 1 right, 0 none), crown,
// shop: {key, icon} (a shopfront with a neon sign), special ('arcade' | 'hotel' | 'rink' | 'disco' | 'diner' | 'motel')}
export const TINTS = ['#ffd2e2', '#d2f0ff', '#fff0c2', '#e2d4ff', '#cff8e2', '#ffdcc4', '#ffe6f2', '#d8fff4'];
const TRIMS = [NEON.pink, NEON.cyan, NEON.purple, NEON.yellow, NEON.mint, NEON.orange];
const FLOOR = 3.4;
// the streets' carriageways and sidewalks (a footprint of half size r centred at x, z touching any of them)
export const onRoad = (x, z, r = 0) => (Math.abs(x) > AVE.walkIn - r && Math.abs(x) < AVE.walkOut + r) || (z > STRIP.walkIn[0] - r && z < STRIP.walkOut[1] + r) || (z > SOUTH.back - r && z < SOUTH.z1 + 3 + r);
export const YAW = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 };
export function cityPlan(theme, seed = 1985) {
  const rng = new RNG(seed), out = [];
  const add = b => { const o = { kind: 'stucco', tint: rng.pick(TINTS), trim: rng.pick(TRIMS), round: 0, crown: false, shop: null, ...b }; out.push(o); return o; };
  const N = STRIP.walkOut[1], S = SOUTH.front, E = AVE.walkOut, Wst = -AVE.walkOut;
  // the north row across the Strip, facing the park (in the sun's shadow: the neon carries it)
  add({ special: 'arcade', x: -51, z: N + 8, w: 22, d: 16, h: 7.4, face: 'z-', tint: '#d2f0ff', trim: NEON.cyan, shop: { key: 'ARCADE', icon: 'bolt' } });
  add({ x: -31.5, z: N + 7, w: 14, d: 14, h: 3 * FLOOR, face: 'z-', tint: '#fff0c2', trim: NEON.yellow, round: -1, shop: { key: 'VIDEO', icon: 'cassette' } });
  add({ special: 'hotel', x: -6, z: N + 9, w: 28, d: 18, h: 8 * FLOOR, face: 'z-', tint: '#ffd2e2', trim: NEON.pink, round: 2, shop: { key: 'COCKTAILS', icon: 'cocktail' } }); // (its billboard is its crown)
  add({ special: 'rink', x: 23, z: N + 11, w: 28, d: 22, h: 8.5, face: 'z-', tint: '#e2d4ff', trim: NEON.purple, shop: { key: 'ROLLER RINK', icon: 'skate' } });
  add({ x: 49, z: N + 8, w: 22, d: 16, h: 4 * FLOOR, face: 'z-', tint: '#cff8e2', trim: NEON.mint, round: 1, shop: { key: 'DANCE', icon: 'note' } });
  // the strip of shops facing the plaza from the south (the sun on their faces)
  add({ special: 'diner', x: -54, z: S - 4.2, w: 14, d: 6, h: 4.2, face: 'z+', tint: '#e8eef4', trim: NEON.red, shop: { key: 'DINER', icon: 'star' } });
  add({ x: -39, z: S - 6.8, w: 12, d: 13.6, h: 2 * FLOOR + 0.6, face: 'z+', tint: '#e2d4ff', trim: NEON.cyan, shop: { key: 'COCKTAILS', icon: 'cocktail' } });
  add({ x: -22.5, z: S - 6.8, w: 17, d: 13.6, h: 2 * FLOOR + 0.6, face: 'z+', tint: '#ffdcc4', trim: NEON.orange, shop: { key: 'RECORDS', icon: 'record' } });
  add({ x: -6, z: S - 6.8, w: 14, d: 13.6, h: 3 * FLOOR, face: 'z+', tint: '#d2f0ff', trim: NEON.yellow, round: -1, shop: { key: 'PIZZA', icon: 'star' } });
  add({ special: 'disco', x: DISCO.x, z: DISCO.z - DISCO.d / 2, w: DISCO.w, d: DISCO.d, h: DISCO.h, face: 'z+', tint: '#2a1840', trim: NEON.pink });
  add({ x: 47.5, z: S - 6.8, w: 19, d: 13.6, h: 3 * FLOOR, face: 'z+', tint: '#ffd2e2', trim: NEON.purple, round: 1, crown: true, shop: { key: 'LIVE MUSIC', icon: 'note' } });
  // the motel on the east avenue, facing the sun
  add({ special: 'motel', x: E + 7, z: -14, w: 14, d: 32, h: 2 * FLOOR, face: 'x-', tint: '#cff8e2', trim: NEON.mint, shop: { key: 'MOTEL', icon: 'palm' } });
  // fill the rest of the frontage: [a, b] along the row, its front line, which way the blocks run back, their face
  const fill = (axis, a, b, front, dir, face, lo, hi, shops) => {
    let p = a;
    while (p < b - 6) {
      const wid = Math.min(b - p, rng.range(11, 22)), dep = rng.range(12, 18), c = p + wid / 2;
      const x = axis === 'x' ? c : front + dir * dep / 2, z = axis === 'x' ? front + dir * dep / 2 : c;
      let floors = rng.int(lo, hi), kind = 'stucco';
      if (inSunBand(x, z, theme)) floors = 1;
      else if (Math.hypot(x, z) > 110 && rng.next() < 0.35) { kind = 'glass'; floors = rng.int(7, 13); }
      const near = Math.hypot(x, z) < 125;
      add({ x, z, w: axis === 'x' ? wid : dep, d: axis === 'x' ? dep : wid, h: floors * FLOOR + (kind === 'glass' ? 0 : 0.6), face, kind, round: kind === 'stucco' && rng.next() < 0.3 ? rng.pick([-1, 1]) : 0, crown: kind === 'stucco' && floors > 3 && rng.next() < 0.5,
        shop: shops && near && kind === 'stucco' && rng.next() < 0.55 ? { key: rng.pick(['PIZZA', 'VIDEO', 'RECORDS', 'COCKTAILS', 'DINER', 'ARCADE', 'LIVE MUSIC', 'DANCE']), icon: rng.pick(T.RETRO_ICONS) } : null });
      p += wid + (rng.next() < 0.2 ? rng.range(2, 4) : 0.4);
    }
  };
  // (the blocks between the streets: the Strip z 33.4-60, the avenues |x| 63.6-81.5, the south street z -70 to -54)
  const xs = [[-EXTENT, Wst - 1], [-AVE.walkIn + 0.1, AVE.walkIn - 0.1], [-Wst + 1, EXTENT]];
  fill('x', xs[0][0], xs[0][1], N, 1, 'z-', 2, 5, true); fill('x', xs[2][0], xs[2][1], N, 1, 'z-', 3, 7, true);
  fill('z', -54, -32, E, 1, 'x-', 3, 6, true); fill('z', 4, 31.5, E, 1, 'x-', 3, 6, true);
  fill('z', -54, 31.5, Wst, -1, 'x+', 1, 3, true);
  // behind the south street, and the second rows
  for (const [a, b] of xs) { fill('x', a, b, SOUTH.back, -1, 'z+', 3, 9, false); fill('x', a, b, N + 26, 1, 'z-', 4, 10, false); }
  fill('z', -54, 31.5, E + 22, 1, 'x-', 4, 10, false); fill('z', -54, 31.5, Wst - 22, -1, 'x+', 2, 6, false);
  // the skyline out in the haze: mirror-glass towers with neon crowns (none along the sun's bearing)
  for (let i = 0; i < 30; i++) {
    const a = i / 30 * Math.PI * 2 + rng.range(-0.05, 0.05), dd = rng.range(125, 185), x = Math.cos(a) * dd * 1.15, z = Math.sin(a) * dd;
    const s = rng.range(16, 26);
    const d = s * rng.range(0.8, 1.2), fp = { x0: x - s / 2 - 2, x1: x + s / 2 + 2, z0: z - d / 2 - 2, z1: z + d / 2 + 2 };
    if (inSunBand(x, z, theme) || (Math.abs(x) < 100 && Math.abs(z) < 80) || onRoad(x, z, s * 0.62) || out.some(b => b.x + b.w / 2 > fp.x0 && b.x - b.w / 2 < fp.x1 && b.z + b.d / 2 > fp.z0 && b.z - b.d / 2 < fp.z1)) continue;
    add({ x, z, w: s, d, h: rng.int(10, 22) * FLOOR, face: Math.abs(x) > Math.abs(z) ? (x > 0 ? 'x-' : 'x+') : (z > 0 ? 'z-' : 'z+'), kind: rng.next() < 0.7 ? 'glass' : 'stucco', crown: true, tower: true });
  }
  return out;
}

// ---- the whole city ----
// park: the park's own batches ({matte, metal, foliage}: palms inside the block cast shadows with the rest of the park).
// Returns {update(dt), blackout(), level, disco: {...}, lights}. Everything else here goes into batches of its own that
// cast no shadows (the shadow map only covers the courts)
let decoS = null, decoG = null;
export function retroCity(ctx, scene, rng, theme, park) {
  const city = [], chrome = [], walls = { stucco: [], glass: [] }, inner = [], shopWin = [];
  const neon = { tube: [], sign: [], flick: [], cycle: [], beat: [], beatSign: [], chase: [[], [], []] };
  const tube = (pts, hex, r = 0.06, group = 'tube') => neon[group].push({ geo: G.tube(pts, r, 5), color: c4(hex) });
  const bulbs = (pts, hex = '#ffe9b0', s = 0.13) => pts.forEach((p, i) => neon.chase[i % 3].push({ geo: G.box(s, s, s * 0.6), matrix: TR(p[0], p[1], p[2], p[3] || 0), color: c4(hex) }));
  // a neon sign from the atlas: the tubes (additive) over a dark board; w wide, its height from the cell's shape
  const sign = (key, x, y, z, yaw, w, group = 'sign', board = '#150b24') => {
    const [u0, v0, uw, vh] = T.retroSignUV(key), h = w * vh / uw;
    const q = G.quad(w, h);
    for (let i = 0; i < 4; i++) { q.uv[i * 2] = u0 + q.uv[i * 2] * uw; q.uv[i * 2 + 1] = v0 + q.uv[i * 2 + 1] * vh; }
    neon[group === 'beat' ? 'beatSign' : group].push({ geo: q, matrix: TR(x + Math.sin(yaw) * 0.075, y, z + Math.cos(yaw) * 0.075, yaw), color: [1, 1, 1, 1] });
    if (board) put(city, G.box(w * 0.98, h * 0.9, 0.12), x, y, z, board, yaw);
    return h;
  };
  // a face's frame: e runs along it (left to right as you look at it from the street), n out of it
  const frame = b => {
    const yaw = YAW[b.face], ex = Math.cos(yaw), ez = -Math.sin(yaw), nx = Math.sin(yaw), nz = Math.cos(yaw), zf = b.face[0] === 'z';
    const Fx = b.x + nx * (zf ? 0 : b.w / 2), Fz = b.z + nz * (zf ? b.d / 2 : 0);
    return { yaw, ex, ez, nx, nz, along: zf ? b.w : b.d, depth: zf ? b.d : b.w, P: (a, o = 0) => [Fx + ex * a + nx * o, Fz + ez * a + nz * o] };
  };
  const { bays, floors, bayW, floorH } = T.DECO_TILE, TW = bays * bayW, TH = floors * floorH;
  // the walls of a block, facade mapped in metres; a rounded corner (round: -1 / 1 the front left / right) is a quarter
  // of a cylinder with the walls either side of it cut back
  const block = b => {
    const out = walls[b.kind], tint = c4(b.tint), ou = rng.int(0, 3) / 4, ov = rng.int(0, 3) / 4, f = frame(b);
    const r = b.round ? Math.min(3.2, f.along * 0.18, f.depth * 0.3) : 0;
    const corners = b.round === 2 ? [-1, 1] : b.round ? [b.round] : [];
    // corner centres in world space, and how much each of the four walls is cut back at each end
    const cc = corners.map(s => f.P(s * (f.along / 2 - r), -r));
    const wall = (cx, cz, len, yaw, cut0, cut1) => {
      const L = len - cut0 - cut1, ex = Math.cos(yaw), ez = -Math.sin(yaw), off = (cut0 - cut1) / 2;
      const g = G.quad(L, b.h, { bottom: true });
      for (let i = 0; i < 4; i++) { const lx = g.position[i * 3], ly = g.position[i * 3 + 1]; g.uv[i * 2] = ou + (lx + off + len / 2) / TW; g.uv[i * 2 + 1] = ov + 1 - ly / TH; }
      out.push({ geo: g, matrix: TR(cx + ex * off, 0, cz + ez * off, yaw), color: tint });
    };
    // front, back, left and right as seen from the street
    const back = f.P(0, -f.depth), lc = f.P(-f.along / 2, -f.depth / 2), rc = f.P(f.along / 2, -f.depth / 2);
    const has = s => corners.includes(s);
    wall(...f.P(0), f.along, f.yaw, has(-1) ? r : 0, has(1) ? r : 0);
    wall(back[0], back[1], f.along, f.yaw + Math.PI, 0, 0);
    wall(lc[0], lc[1], f.depth, f.yaw - Math.PI / 2, 0, has(-1) ? r : 0);
    wall(rc[0], rc[1], f.depth, f.yaw + Math.PI / 2, has(1) ? r : 0, 0);
    for (const [x, z] of cc) {
      const g = G.cylinder(r, r, b.h, 12, { y0: true, open: true });
      for (let i = 0; i < g.position.length / 3; i++) { const a = Math.atan2(g.position[i * 3 + 2], g.position[i * 3]); g.uv[i * 2] = ou + a * r / TW; g.uv[i * 2 + 1] = ov + 1 - g.position[i * 3 + 1] / TH; }
      out.push({ geo: g, matrix: TR(x, 0, z), color: tint });
    }
    // the cornice (a band of the trim's colour, pale), the roof, a rooftop box or two
    const band = c4(b.kind === 'glass' ? '#1c1a2c' : M.mixRgb(lin(b.tint), lin(b.trim), 0.35).concat(1));
    const top = b.h, bh = b.kind === 'glass' ? 0.5 : 0.8;
    const slab = (x, z, w, d, y, h, col) => city.push({ geo: G.box(w, h, d), matrix: TR(x, y, z, f.yaw), color: col });
    const fc = f.P(0, -f.depth / 2);
    if (!r) slab(fc[0], fc[1], f.along + 0.3, f.depth + 0.3, top + bh / 2, bh, band);
    else {
      // round the corners: the slab in pieces and a short cylinder at each corner
      const inset = corners.length * r;
      const mid = f.P((has(-1) ? r : 0) / 2 - (has(1) ? r : 0) / 2, -f.depth / 2);
      slab(mid[0], mid[1], f.along + 0.3 - inset, f.depth + 0.3, top + bh / 2, bh, band);
      for (const s of corners) { const q = f.P(s * (f.along / 2 - r / 2), -f.depth / 2 - r / 2); slab(q[0], q[1], r + 0.3, f.depth - r + 0.3, top + bh / 2, bh, band); }
      for (const [x, z] of cc) city.push({ geo: G.cylinder(r + 0.15, r + 0.15, bh, 12, { y0: true }), matrix: TR(x, top, z), color: band });
    }
    slab(fc[0], fc[1], f.along - 0.6, f.depth - 0.6, top + bh + 0.05, 0.1, c4('#3a2e3a'));
    if (!b.tower && b.kind === 'stucco' && rng.next() < 0.7) slab(...f.P(rng.range(-0.25, 0.25) * f.along, -f.depth * rng.range(0.4, 0.7)), Math.min(5, f.along * 0.25), Math.min(4, f.depth * 0.25), top + bh + 1, 2, c4('#8a7c8a'));
    // neon along the cornice: the front edge, round the corners, and the sides a little way back
    if (b.kind === 'stucco' || !b.tower) {
      const y = top + bh + 0.08, e0 = has(-1) ? -f.along / 2 + r : -f.along / 2 - 0.15, e1 = has(1) ? f.along / 2 - r : f.along / 2 + 0.15, grp = rng.next() < 0.2 ? 'cycle' : 'tube';
      const pa = f.P(e0, 0.18), pb = f.P(e1, 0.18);
      tube([[pa[0], y, pa[1]], [pb[0], y, pb[1]]], grp === 'cycle' ? '#ffffff' : b.trim, 0.07, grp);
      for (const s of corners) {
        const [x, z] = cc[corners.indexOf(s)], pts = [];
        // a quarter turn from the front face round to the side face
        for (let k = 0; k <= 8; k++) { const t = k / 8 * Math.PI / 2, dx = f.nx * Math.cos(t) + s * f.ex * Math.sin(t), dz = f.nz * Math.cos(t) + s * f.ez * Math.sin(t); pts.push([x + dx * (r + 0.33), y, z + dz * (r + 0.33)]); }
        tube(pts, grp === 'cycle' ? '#ffffff' : b.trim, 0.07, grp);
      }
      // a second line under the cornice on the taller ones
      if (b.h > 9 && rng.next() < 0.5) tube([[f.P(e0, 0.1)[0], top - 0.35, f.P(e0, 0.1)[1]], [f.P(e1, 0.1)[0], top - 0.35, f.P(e1, 0.1)[1]]], rng.pick(TRIMS), 0.05);
    }
    // a stepped crown with a fin, neon up its front edge
    if (b.crown) {
      const cw = Math.min(10, f.along * 0.36), cd = Math.min(8, f.depth * 0.4), y0 = top + bh, q = f.P(0, -cd / 2 - 0.6);
      if (b.tower && b.kind === 'glass') {
        // a mirror-glass tower's crown: a stepped pyramid outlined in neon
        const steps = 3; let w = f.along * 0.8, d = f.depth * 0.8, y = y0;
        for (let k = 0; k < steps; k++) { slab(...f.P(0, -f.depth / 2), w, d, y + 1.2, 2.4, c4('#2a2848')); const hw = w / 2, hd = d / 2, ctr = f.P(0, -f.depth / 2);
          const cn = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]].map(([a, o]) => [ctr[0] + f.ex * a + f.nx * o, y + 2.45, ctr[1] + f.ez * a + f.nz * o]); tube(cn, b.trim, 0.12, k === steps - 1 ? 'cycle' : 'tube'); w *= 0.66; d *= 0.66; y += 2.4; }
        const ctr = f.P(0, -f.depth / 2); tube([[ctr[0], y, ctr[1]], [ctr[0], y + 9, ctr[1]]], NEON.red, 0.14);
      } else {
        slab(q[0], q[1], cw, cd, y0 + 1.4, 2.8, c4(b.tint)); slab(q[0], q[1], cw * 0.6, cd * 0.6, y0 + 3.6, 1.6, c4(b.tint));
        // the fin stands forward of the crown over the facade, neon up its front edge
        const fin = f.P(0, -0.5); city.push({ geo: G.box(0.5, 6, 2), matrix: TR(fin[0], y0 + 3, fin[1], f.yaw), color: c4(b.tint) });
        const t0 = f.P(0, 0.53); tube([[t0[0], y0 + 0.2, t0[1]], [t0[0], y0 + 5.9, t0[1]]], b.trim, 0.08, 'cycle');
      }
    }
  };
  // a shopfront: a lit window either side of the door, a striped awning, the neon sign over it and an icon beside it
  const shopfront = (b, at = 0, len = null) => {
    const f = frame(b), L = len ?? Math.min(f.along - 3, 11), s = b.shop;
    const win = (a, w) => { const [x, z] = f.P(a, 0.05), g = G.quad(w, 2.3, { bottom: true }), half = rng.next() < 0.5 ? 0 : 0.5; for (let i = 0; i < 4; i++) g.uv[i * 2] = half + g.uv[i * 2] * 0.5; shopWin.push({ geo: g, matrix: TR(x, 0.4, z, f.yaw), color: c4(rng.pick(['#ffd8b0', '#ffc8e8', '#c8f0ff', '#fff0c0'])) }); };
    const ww = (L - 1.8) / 2;
    win(at - 0.9 - ww / 2, ww); win(at + 0.9 + ww / 2, ww);
    const [dx, dz] = f.P(at, 0.03); city.push({ geo: G.box(1.6, 2.6, 0.06), matrix: TR(dx, 1.3, dz, f.yaw), color: c4('#1a1424') });
    for (const a of [at - L / 2, at - 0.85, at + 0.85, at + L / 2]) { const [x, z] = f.P(a, 0.1); chrome.push({ geo: G.box(0.12, 2.9, 0.12), matrix: TR(x, 1.45, z, f.yaw), color: c4('#d8dde4') }); }
    // the awning: stripes in two colours, sloping out over the sidewalk
    const stripes = Math.max(4, Math.round(L / 0.8)), cols = [b.trim === NEON.yellow ? '#ff3fa4' : b.trim, '#fff4e6'];
    for (let k = 0; k < stripes; k++) {
      const a = at - L / 2 + (k + 0.5) * L / stripes, [x, z] = f.P(a, 0.8);
      city.push({ geo: G.box(L / stripes + 0.01, 0.06, 1.6), matrix: mul(TR(x, 3.15, z, f.yaw), Rx(0.32)), color: c4(cols[k % 2]) });
    }
    const [vx, vz] = f.P(at, 1.55); city.push({ geo: G.box(L + 0.05, 0.3, 0.06), matrix: TR(vx, 2.85, vz, f.yaw), color: c4(cols[0]) });
    // the sign over the awning, and the icon to one side
    const sw = Math.min(L * 0.9, 7.2), [sx, sz] = f.P(at, 0.12), sy = 3.55 + sw / 8 + 0.15;
    sign(s.key, sx, sy, sz, f.yaw, sw, rng.next() < 0.18 ? 'flick' : 'sign');
    if (s.icon && f.along > L + 3) { const side = rng.pick([-1, 1]), [ix, iz] = f.P(at + side * (L / 2 + 1.0), 0.12); sign(s.icon, ix, 4.3, iz, f.yaw, 1.7, 'sign'); }
  };

  const plan = cityPlan(theme);
  for (const b of plan) {
    if (b.special === 'disco' || b.special === 'diner' || b.special === 'rink') continue; // (their own builders, below)
    block(b);
    if (b.shop) shopfront(b, b.special === 'hotel' ? 0 : rng.range(-1, 1) * Math.max(0, frame(b).along / 2 - 7.5));
  }

  // ---- the specials ----
  const byKind = k => plan.find(b => b.special === k);
  // the arcade: ARCADE in big flickering neon along its roof, a lightning bolt beside it
  { const b = byKind('arcade'), f = frame(b), [x, z] = f.P(-1.5, -0.3); sign('ARCADE', x, b.h + 2.4, z, f.yaw, 12, 'flick'); const [ix, iz] = f.P(6.6, -0.3); sign('bolt', ix, b.h + 2.4, iz, f.yaw, 2.6, 'sign');
    for (const s of [-1, 1]) { const [px, pz] = f.P(s * 5.5, -0.5); chrome.push({ geo: G.box(0.14, 1.2, 0.14), matrix: TR(px, b.h + 1.2, pz), color: c4('#c9ced6') }); } }
  // the hotel: the event's name on a billboard frame over its roof, chasing bulbs round it
  { const b = byKind('hotel'), f = frame(b), w = 24, y = b.h + 4.8, [x, z] = f.P(0, -4.5), h = w / 8;
    for (const s of [-0.4, 0, 0.4]) { const [px, pz] = f.P(s * w, -4.8); chrome.push({ geo: G.box(0.25, 4.8, 0.25), matrix: TR(px, b.h + 2.4, pz), color: c4('#9aa3ad') }); }
    put(city, G.box(w + 1, 0.15, 1.2), x, y - h / 2 - 0.5, z, '#3a3240', f.yaw);
    sign('BEAT', x, y, z, f.yaw, w, 'sign', '#120a1e');
    const pts = []; for (let a = -w / 2 - 0.3; a <= w / 2 + 0.3; a += 0.6) for (const yy of [y - h / 2 - 0.25, y + h / 2 + 0.25]) { const [px, pz] = f.P(a, -4.2); pts.push([px, yy, pz, f.yaw]); }
    bulbs(pts); }
  // the motel: a pylon by the avenue, MOTEL over VACANCY, an arrow of chasing bulbs pointing at the office
  { const b = byKind('motel'), f = frame(b), [px, pz] = f.P(10, 2.2);
    chrome.push({ geo: G.cylinder(0.18, 0.22, 8.2, 10, { y0: true }), matrix: TR(px, 0, pz), color: c4('#d8dde4') });
    for (const s of [1, -1]) { const yaw = f.yaw + (s > 0 ? 0 : Math.PI); sign('MOTEL', px + Math.sin(yaw) * 0.12, 7.0, pz + Math.cos(yaw) * 0.12, yaw, 5.2); sign('VACANCY', px + Math.sin(yaw) * 0.12, 5.4, pz + Math.cos(yaw) * 0.12, yaw, 3.8, 'flick'); }
    sign('palm', px, 9.2, pz, f.yaw, 2.4, 'sign', null);
    const arrow = []; for (let k = 0; k < 12; k++) { const [ax, az] = f.P(10 - k * 0.45, 2.3); arrow.push([ax, 4.2 - k * 0.08, az]); }
    for (const [dy, da] of [[0.4, 0.4], [-0.4, 0.4], [0.8, 0.8], [-0.8, 0.8]]) { const [ax, az] = f.P(10 - 11 * 0.45 + da, 2.3); arrow.push([ax, 4.2 - 11 * 0.08 + dy, az]); }
    bulbs(arrow, '#ffcf6a', 0.16); }
  // the roller rink: a wide hall under a barrel vault, ROLLER RINK on the gable in neon, bulbs chasing round its arc
  { const b = byKind('rink'), f = frame(b), wallH = 5.6, rise = 6.5;
    block({ ...b, h: wallH, crown: false, round: 0 });
    shopfront({ ...b, h: wallH }, 0, 12);
    // the vault runs back from the street: its cross-section (a half ellipse across the front) swept along the depth;
    // both windings so it reads from any side
    const A = f.along / 2 + 0.3, arc = k => { const t = k / 20 * Math.PI, na = -Math.cos(t) / A, ny = Math.sin(t) / rise, l = Math.hypot(na, ny); return [-Math.cos(t) * A, wallH + Math.sin(t) * rise, na / l, ny / l]; };
    const pos = [], nrm = [], idx = [];
    for (let k = 0; k <= 20; k++) {
      const [a, y, na, ny] = arc(k);
      for (const o of [0.3, -f.depth - 0.3]) { const [x, z] = f.P(a, o); pos.push(x, y, z); nrm.push(f.ex * na, ny, f.ez * na); }
      if (k) { const i = k * 2; idx.push(i - 2, i, i - 1, i - 1, i, i + 1, i - 2, i - 1, i, i - 1, i + 1, i); }
    }
    city.push({ geo: { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(pos.length / 3 * 2), index: new Uint16Array(idx) }, color: c4('#f2d8f0') });
    // the front gable: a half ellipse closing the vault's end, the sign on it
    const gp = [...f.P(0, 0.3)], gi = [];
    gp.splice(1, 0, wallH);
    for (let k = 0; k <= 20; k++) { const [a, y] = arc(k), [x, z] = f.P(a, 0.3); gp.push(x, y, z); if (k) gi.push(0, k, k + 1, 0, k + 1, k); }
    const gn = new Float32Array(gp.length); for (let i = 0; i < gp.length; i += 3) { gn[i] = f.nx; gn[i + 2] = f.nz; }
    city.push({ geo: { position: new Float32Array(gp), normal: gn, uv: new Float32Array(gp.length / 3 * 2), index: new Uint16Array(gi) }, color: c4(b.tint) });
    const [gx, gz] = f.P(0, 0.42);
    sign('ROLLER RINK', gx, wallH + rise * 0.4, gz, f.yaw, 14);
    sign('skate', gx, wallH + rise * 0.8, gz, f.yaw, 2.4, 'flick', null);
    const arcPts = []; for (let k = 0; k <= 40; k++) { const t2 = k / 40 * Math.PI, [x, z] = f.P(-Math.cos(t2) * (A + 0.1), 0.45); arcPts.push([x, wallH + Math.sin(t2) * (rise + 0.12), z]); }
    tube(arcPts, NEON.purple, 0.11, 'cycle');
    const dense = []; for (let k = 1; k < 60; k++) { const t2 = k / 60 * Math.PI, [x, z] = f.P(-Math.cos(t2) * (A - 0.7), 0.45); dense.push([x, wallH + Math.sin(t2) * (rise - 0.6), z, f.yaw]); }
    bulbs(dense); }
  // the diner: a stainless car with rounded ends, a band of windows, red and teal stripes; DINER on a pole
  { const b = byKind('diner'), f = frame(b), L = b.w, D = b.d, H = b.h, r = D / 2, steel = '#dfe6ee';
    const [mx, mz] = f.P(0, -D / 2);
    chrome.push({ geo: G.box(L - D, H - 0.5, D), matrix: TR(mx, 0.3 + (H - 0.5) / 2, mz, f.yaw), color: c4(steel) });
    for (const s of [-1, 1]) { const [ex, ez] = f.P(s * (L / 2 - r), -r); chrome.push({ geo: G.cylinder(r, r, H - 0.5, 18, { y0: true }), matrix: TR(ex, 0.3, ez), color: c4(steel) }); city.push({ geo: G.cylinder(r + 0.05, r + 0.05, 0.3, 18, { y0: true }), matrix: TR(ex, 0, ez), color: c4('#2a2228') }); city.push({ geo: G.cylinder(r + 0.18, r + 0.18, 0.22, 18, { y0: true }), matrix: TR(ex, H - 0.2, ez), color: c4('#f4f1ea') }); }
    city.push({ geo: G.box(L - D, 0.3, D + 0.1), matrix: TR(mx, 0.15, mz, f.yaw), color: c4('#2a2228') });
    city.push({ geo: G.box(L - D, 0.22, D + 0.36), matrix: TR(mx, H - 0.09, mz, f.yaw), color: c4('#f4f1ea') });
    for (const [y, col] of [[0.95, '#ff4a6a'], [1.1, '#ff4a6a'], [3.1, '#17a9c6']]) { const [sx, sz] = f.P(0, 0.03); city.push({ geo: G.box(L - D + 0.2, 0.08, 0.06), matrix: TR(sx, y, sz, f.yaw), color: c4(col) }); }
    for (let k = 0; k < 6; k++) { const a = -L / 2 + r + 0.6 + k * (L - D - 1.2) / 5.5, [wx, wz] = f.P(a, 0.04), g = G.quad(1.25, 1.35, { bottom: true }); for (let i = 0; i < 4; i++) g.uv[i * 2] = g.uv[i * 2] * 0.25 + (k % 2) * 0.5; shopWin.push({ geo: g, matrix: TR(wx, 1.45, wz, f.yaw), color: c4('#ffe2c0') }); }
    const [vx, vz] = f.P(-L / 2 + r + 0.2, 0.7); city.push({ geo: G.box(2.2, 3.2, 1.4), matrix: TR(vx, 1.6, vz, f.yaw), color: c4('#ff4a6a') }); { const [dx, dz] = f.P(-L / 2 + r + 0.2, 1.42); city.push({ geo: G.box(1.2, 2.3, 0.04), matrix: TR(dx, 1.25, dz, f.yaw), color: c4('#1a1424') }); }
    const [px, pz] = f.P(L / 2 + 1.6, 1.4); chrome.push({ geo: G.cylinder(0.14, 0.18, 7.2, 10, { y0: true }), matrix: TR(px, 0, pz), color: c4('#d8dde4') });
    for (const s of [1, -1]) { const yaw = f.yaw + (s > 0 ? 0 : Math.PI); sign('DINER', px + Math.sin(yaw) * 0.12, 6.2, pz + Math.cos(yaw) * 0.12, yaw, 4.6); }
    sign('star', px, 7.9, pz, f.yaw, 1.6, 'flick', null);
    const dp = []; for (let a = -2.4; a <= 2.4; a += 0.4) for (const yy of [6.2 - 0.75, 6.2 + 0.75]) { const [qx, qz] = f.P(L / 2 + 1.6 + a, 1.55); dp.push([qx, yy, qz, f.yaw]); }
    bulbs(dp, '#ffd88a');
    const ra = []; for (let a = -L / 2 + r; a <= L / 2 - r; a += 1) { const [qx, qz] = f.P(a, 0.1); ra.push([qx, H + 0.06, qz]); } tube(ra, NEON.red, 0.07); }

  // ---- the disco bar ----
  // a black-and-chrome deco front: big windows either side of an open doorway (the room inside: a light-up floor, a
  // mirror ball, specks of light turning in the haze, the DJ booth), a marquee over the door with bulbs chasing under it,
  // a giant mirror ball over the marquee, DISCO in pink neon on the stepped crown, searchlights on the roof
  const disco = {};
  { const b = byKind('disco'), f = frame(b), W = b.w, H = b.h, Dp = b.d, body = '#1e1030', dark = '#140a22';
    const box = (w, h, d, a, o, y, col, out = city) => { const [x, z] = f.P(a, o); out.push({ geo: G.box(w, h, d), matrix: TR(x, y, z, f.yaw), color: c4(col) }); };
    // the shell
    box(W, H, 0.4, 0, -Dp + 0.2, H / 2, body); for (const s of [-1, 1]) box(0.4, H, Dp, s * (W / 2 - 0.2), -Dp / 2, H / 2, body);
    box(W + 0.4, 0.4, Dp + 0.4, 0, -Dp / 2, H + 0.2, '#2a1a3c');
    // the front: sills, piers, the deep fascia over the windows and the door
    for (const s of [-1, 1]) { box(6.5, 0.5, 0.4, s * 6.25, -0.2, 0.25, body); box(1.5, 3.7, 0.4, s * 2.25, -0.2, 1.85, body); box(1.5, 3.7, 0.4, s * 10.25, -0.2, 1.85, body); }
    box(W, H - 3.7, 0.4, 0, -0.2, 3.7 + (H - 3.7) / 2, body);
    for (let k = 0; k < 3; k++) box(W - 1.2, 0.09, 0.06, 0, 0.03, 4.5 + k * 0.3, '#e8ecf2', chrome);
    for (const s of [-1, 1]) for (const a of [3.0, 9.5]) box(0.08, 3.7, 0.06, s * a, 0.03, 1.85, '#e8ecf2', chrome); // (chrome down the window jambs)
    // neon: round the windows (pink), the doorway (cyan), the corners (colour cycling), the roof edge
    const rect = (a0, a1, y0, y1, o, hex, grp = 'tube') => { const p = (a, y) => { const [x, z] = f.P(a, o); return [x, y, z]; }; tube([p(a0, y0), p(a1, y0), p(a1, y1), p(a0, y1), p(a0, y0)], hex, 0.07, grp); };
    for (const s of [-1, 1]) rect(s * 3.05, s * 9.45, 0.55, 3.65, 0.08, NEON.pink);
    rect(-1.45, 1.45, 0.02, 3.65, 0.08, NEON.cyan, 'beat');
    for (const s of [-1, 1]) { const [x, z] = f.P(s * (W / 2 - 0.05), 0.06); tube([[x, 0.2, z], [x, H, z]], '#ffffff', 0.09, 'cycle'); }
    { const p0 = f.P(-W / 2, 0.12), p1 = f.P(W / 2, 0.12); tube([[p0[0], H + 0.42, p0[1]], [p1[0], H + 0.42, p1[1]]], NEON.pink, 0.08); }
    // the crown and its sign
    box(11.4, 2.9, 1.4, 0, -0.5, H + 1.45, dark); box(7, 1.5, 1.2, 0, -0.6, H + 3.65, dark); box(3.4, 1.2, 1.0, 0, -0.6, H + 5, dark);
    { const [x, z] = f.P(0, 0.22); sign('DISCO', x, H + 1.5, z, f.yaw, 10, 'beat', null); }
    { const pts = []; for (let a = -5.4; a <= 5.41; a += 0.45) for (const y of [H + 0.12, H + 2.88]) { const [x, z] = f.P(a, 0.3); pts.push([x, y, z, f.yaw]); } for (let y = H + 0.57; y < H + 2.6; y += 0.45) for (const a of [-5.4, 5.4]) { const [x, z] = f.P(a, 0.3); pts.push([x, y, z, f.yaw]); } bulbs(pts, '#fff0c8', 0.15); }
    { const p = (a, y) => { const [x, z] = f.P(a, 0.12); return [x, y, z]; }; tube([p(-3.5, H + 2.9), p(-3.5, H + 4.4), p(3.5, H + 4.4), p(3.5, H + 2.9)], NEON.cyan, 0.07, 'cycle'); tube([p(-1.7, H + 4.4), p(-1.7, H + 5.6), p(1.7, H + 5.6), p(1.7, H + 4.4)], NEON.yellow, 0.07, 'cycle'); }
    // the marquee over the door: bulbs chasing under it, neon round its edges
    box(8, 0.38, 3.0, 0, 1.5, 3.95, dark);
    { const pts = []; for (const o of [0.7, 1.5, 2.3]) for (let a = -3.6; a <= 3.61; a += 0.4) { const [x, z] = f.P(a, o); pts.push([x, 3.74, z, f.yaw]); } bulbs(pts, '#fff0c8', 0.14); }
    { const p = (a, o, y) => { const [x, z] = f.P(a, o); return [x, y, z]; }; tube([p(-4, 0, 4.16), p(-4, 3, 4.16), p(4, 3, 4.16), p(4, 0, 4.16)], NEON.pink, 0.07, 'beat'); tube([p(-4, 3.02, 3.76), p(4, 3.02, 3.76)], NEON.cyan, 0.06); }
    // the giant mirror ball over the marquee, on a chrome arm out of the fascia
    { const p = (a, o, y) => { const [x, z] = f.P(a, o); return [x, y, z]; }; chrome.push({ geo: G.tube([p(0, 0, 7.6), p(0, 1.3, 7.6), p(0, 1.3, 7.2)], 0.07, 6), color: c4('#e8ecf2') }); }
    { const [x, z] = f.P(0, 1.3); disco.ball = { x, y: 6.05, z, r: 1.15 }; }
    // icons on the outer piers
    for (const [s, key] of [[-1, 'cocktail'], [1, 'note']]) { const [x, z] = f.P(s * 10.25, 0.06); sign(key, x, 2.5, z, f.yaw, 1.3, 'sign', null); }
    // glass in the windows
    disco.glass = [-1, 1].map(s => { const [x, z] = f.P(s * 6.25, -0.06); return { geo: G.quad(6.4, 3.1, { bottom: true }), matrix: TR(x, 0.55, z, f.yaw), color: [1, 1, 1, 1] }; });
    // the room: dark (unlit), the DJ booth and speaker stacks against the back wall, neon pillars
    box(W - 1, 0.1, Dp - 1.4, 0, -Dp / 2 - 0.2, 4.45, '#0e0818', inner);
    box(W - 1, 4.4, 0.1, 0, -Dp + 0.5, 2.2, '#1a0c2c', inner);
    for (const s of [-1, 1]) box(0.1, 4.4, Dp - 1, s * (W / 2 - 0.5), -Dp / 2, 2.2, '#160a26', inner);
    box(4.2, 1.2, 1.4, 0, -Dp + 1.6, 0.6, '#2a1a40', inner);
    for (const s of [-1, 1]) { const [x, z] = f.P(s * 1.0, -Dp + 1.6); inner.push({ geo: G.cylinder(0.32, 0.32, 0.05, 14, { y0: true }), matrix: TR(x, 1.2, z), color: c4('#3a3a44') }); }
    for (const s of [-1, 1]) { box(1.4, 2.6, 1.0, s * 4.2, -Dp + 1.3, 1.3, '#120a1c', inner); for (const y of [0.7, 1.9]) { const [x, z] = f.P(s * 4.2, -Dp + 1.82); neon.tube.push({ geo: G.torus(0.36, 0.035, 16, 4), matrix: mul(TR(x, y, z, f.yaw), Rx(Math.PI / 2)), color: c4(NEON.cyan) }); } }
    { const p0 = f.P(-1.9, -Dp + 0.92), p1 = f.P(1.9, -Dp + 0.92); tube([[p0[0], 1.15, p0[1]], [p1[0], 1.15, p1[1]]], NEON.cyan, 0.05, 'beat'); }
    for (const s of [-1, 1]) { const [x, z] = f.P(s * 5.5, -5.5); tube([[x, 0.05, z], [x, 4.4, z]], s > 0 ? NEON.pink : NEON.purple, 0.09, 'cycle'); }
    // the light-up floor, the inner ball and the specks turning round it
    { const [x, z] = f.P(0, -Dp / 2 - 0.4); disco.floor = { x, z, w: W - 1.2, d: Dp - 2.2, yaw: f.yaw }; const [bx2, bz2] = f.P(0, -6); disco.inner = { x: bx2, y: 3.75, z: bz2, r: 0.5 }; }
    // searchlights on the roof
    disco.search = [-1, 1].map(s => { const [x, z] = f.P(s * 8, -4.5); chrome.push({ geo: G.cylinder(0.55, 0.7, 0.6, 12, { y0: true }), matrix: TR(x, H + 0.4, z), color: c4('#c9ced6') }); chrome.push({ geo: G.cylinder(0.45, 0.45, 1.0, 12), matrix: TR(x, H + 1.4, z), color: c4('#2a2a30') }); return { x, y: H + 1.9, z, s }; });
    const lp = f.P(0, 2.4); disco.face = f; disco.light = { pos: [lp[0], 3.6, lp[1]], range: 15, color: [1, 0.32, 0.72], intensity: 9, dir: null };
  }

  // ---- sidewalks, the median, road markings ----
  const pave = (x0, x1, z0, z1, h = 0.1, cols = ['#e9b8c0', '#f0e2d2'], tile = 3) => {
    const along = x1 - x0 > z1 - z0, Lg = along ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(Lg / tile)), st = Lg / n;
    for (let i = 0; i < n; i++) { const a = (along ? x0 : z0) + (i + 0.5) * st; put(city, along ? G.box(st - 0.04, h, z1 - z0) : G.box(x1 - x0, h, st - 0.04), along ? a : (x0 + x1) / 2, h / 2 - 0.01, along ? (z0 + z1) / 2 : a, cols[i % cols.length]); }
  };
  const segX = [[-EXTENT, -AVE.x1], [-AVE.x0, AVE.x0], [AVE.x1, EXTENT]], segZ = [[-EXTENT, SOUTH.z0], [SOUTH.z1, STRIP.z0], [STRIP.z1, EXTENT]];
  for (const [a, b] of segX) {
    pave(a, b, STRIP.walkIn[0], STRIP.walkIn[1]); pave(a, b, STRIP.walkOut[0], STRIP.walkOut[1]);
    pave(a, b, STRIP.median[0], STRIP.median[1], 0.22, ['#c8a8b0', '#d8b8c0'], 6);
    pave(a, b, SOUTH.back, SOUTH.z0); pave(a, b, SOUTH.z1, SOUTH.z1 + 3);
  }
  for (const [a, b] of segZ) for (const s of [-1, 1]) { pave(s > 0 ? AVE.walkIn : -AVE.x0, s > 0 ? AVE.x0 : -AVE.walkIn, a, b); pave(s > 0 ? AVE.x1 : -AVE.walkOut, s > 0 ? AVE.walkOut : -AVE.x1, a, b); }
  // the plaza front, flush (the walkers' path): pink and cream terrazzo squares
  pave(-AVE.walkIn, AVE.walkIn, SOUTH.walk[0], SOUTH.walk[1], 0.02, ['#f0c4c8', '#f4e6d8'], 3);
  const line = (x0, z0, x1, z1, w, col) => put(city, G.box(Math.max(w, Math.abs(x1 - x0)), 0.016, Math.max(w, Math.abs(z1 - z0))), (x0 + x1) / 2, -0.004, (z0 + z1) / 2, col);
  for (const [a, b] of segX) {
    for (const z of [STRIP.z0 + 0.3, STRIP.median[0] - 0.3, STRIP.median[1] + 0.3, STRIP.z1 - 0.3]) line(a, z, b, z, 0.12, '#e8e0d8');
    for (const z of [41, 52]) for (let x = a + 2; x < b - 3; x += 9) line(x, z, x + 3, z, 0.13, '#e8e0d8');
    for (const dz of [-0.11, 0.11]) line(a, -61.5 + dz, b, -61.5 + dz, 0.1, '#e0a020');
  }
  for (const [a, b] of segZ) for (const s of [-1, 1]) for (const dx of [-0.11, 0.11]) line(s * 72.5 + dx, a, s * 72.5 + dx, b, 0.1, '#e0a020');
  // zebras where the Strip crosses the avenues
  for (const s of [-1, 1]) for (const x of [s * (AVE.x0 - 2), s * (AVE.x1 + 2)]) for (let z = STRIP.z0 + 0.8; z < STRIP.z1 - 0.5; z += 1.1) line(x - 1.4, z, x + 1.4, z, 0.5, '#f0ece4');

  // ---- palms: down the Strip's median (the west end's stand against the sun), along the park's north side, the plaza
  // front and the avenues; clear of the game cameras. Inside the block they cast shadows with the park ----
  const farPalms = [], greens = ['#2f5a34', '#3a6a3a', '#447240', '#365f36'];
  const palm = (x, z, h, tier) => (tier === 'full' ? park.foliage : farPalms).push(...PR.palm(x, z, 0.78, rng, { height: h, lean: [rng.range(-0.7, 0.7), rng.range(-0.7, 0.7)], mid: tier === 'mid', lite: tier === 'lite', coconuts: 0, greens, dead: tier === 'full' ? 1 : 0 }));
  for (let x = -EXTENT + 4; x < EXTENT; x += rng.range(9.5, 12.5)) { if (Math.abs(x) > AVE.x0 - 4 && Math.abs(x) < AVE.x1 + 4) continue; palm(x, 46.5 + rng.range(-0.4, 0.4), rng.range(14, 19), Math.abs(x) < 64 || inSunBand(x, 46.5, theme) ? 'mid' : 'lite'); }
  for (let x = -57; x <= 57.1; x += 11.4) palm(x + rng.range(-1, 1), 36.3, rng.range(11, 15), 'full');
  for (const x of [-30.5, -13.5, 1.5, 11.5, 38.5, 49, 59]) palm(x, -35.7, rng.range(9, 12.5), 'mid');
  for (const s of [-1, 1]) for (let z = -52; z <= 30; z += 11) for (const x of [s * 65.6, s * 79.6]) if (retroClear(x, z, 3) && (Math.abs(x) < 70 || Math.round(z) % 2 === 0)) palm(x, z + rng.range(-1, 1), rng.range(11, 16), Math.abs(x) < 70 ? 'mid' : 'lite');
  for (let x = -EXTENT + 8; x < EXTENT; x += 21) if (!(Math.abs(x) > AVE.x0 - 3 && Math.abs(x) < AVE.x1 + 3)) palm(x, 57.8, rng.range(12, 16), Math.abs(x) < 60 ? 'mid' : 'lite');

  // ---- materials and meshes ----
  const add = (parts, mat, o = {}) => { if (!parts.length) return null; const m = new Mesh(ctx.geometry(G.merge(PR.bake(parts))), mat, { castShadow: false, reflect: false, ...o }); scene.add(m); return m; };
  const FS = decoS || (decoS = T.decoFacade({ kind: 'stucco', seed: 83 })), FG = decoG || (decoG = T.decoFacade({ kind: 'glass', seed: 41, lit: 0.42 }));
  add(walls.stucco, new Material({ map: cachedTexture(ctx, 'deco-s-c', () => FS.color, { aniso: 8 }), emissiveMap: cachedTexture(ctx, 'deco-s-e', () => FS.emissive, { aniso: 8 }), emissive: [1.8, 1.5, 1.4], roughness: 0.82 }));
  add(walls.glass, new Material({ map: cachedTexture(ctx, 'deco-g-c', () => FG.color, { aniso: 8 }), emissiveMap: cachedTexture(ctx, 'deco-g-e', () => FG.emissive, { aniso: 8 }), emissive: [1.7, 1.5, 1.4], roughness: 0.18, metalness: 0.3, specular: 1.4 }));
  add(city, new Material({ color: [1, 1, 1], roughness: 0.72, specular: 0.8 }));
  add(chrome, new Material({ color: [1, 1, 1], roughness: 0.22, metalness: 0.85, specular: 1.2 }));
  add(inner, new Material({ color: [1.3, 1.3, 1.3], shading: 'unlit', fog: false }));
  const mWin = new Material({ map: cachedTexture(ctx, 'shopwindow', () => T.shopWindow(), {}), color: [1.5, 1.4, 1.35], shading: 'unlit', fog: false });
  add(shopWin, mWin);
  if (farPalms.length) scene.add(new Mesh(ctx.geometry(G.merge(farPalms)), new Material({ color: [1, 1, 1], roughness: 0.9, shading: 'cloth', sheen: [0.05, 0.08, 0.04] }), { castShadow: false, reflect: false }));
  const unlit = k => new Material({ color: [k, k, k], shading: 'unlit', fog: false });
  const atlas = cachedTexture(ctx, 'retrosigns', () => T.retroSigns(), { aniso: 8 });
  const signMat = k => new Material({ map: atlas, color: [k, k, k], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
  const mats = { tube: unlit(2.4), beat: unlit(2.4), cycle: unlit(2.4), sign: signMat(2.6), flick: signMat(2.6), beatSign: signMat(2.6), chase: [unlit(3), unlit(3), unlit(3)] };
  for (const k of ['tube', 'beat', 'cycle']) add(neon[k], mats[k]);
  for (const k of ['sign', 'flick', 'beatSign']) add(neon[k], mats[k], { order: 3 });
  neon.chase.forEach((l, i) => add(l, mats.chase[i]));
  // the disco's moving parts: the floor, the two mirror balls, the specks, the searchlight beams, the glass
  const D = disco;
  const fl = G.plane(D.floor.w, D.floor.d, 1, 1); for (let i = 0; i < fl.uv.length; i += 2) { fl.uv[i] *= D.floor.w / 0.85 / 8; fl.uv[i + 1] *= D.floor.d / 0.85 / 8; }
  const mFloor = new Material({ map: cachedTexture(ctx, 'dancefloor', () => T.danceFloor(), {}), color: [1.7, 1.7, 1.7], shading: 'unlit', fog: false });
  const floor = new Mesh(ctx.geometry(fl), mFloor, { castShadow: false, reflect: false }); M.m4fromYaw(floor.matrix, D.floor.x, 0.03, D.floor.z, D.floor.yaw); scene.add(floor);
  const ballGeo = ctx.geometry(mirrorBall(1, 12, 22)), mBall = new Material({ color: [0.95, 0.95, 1.0], roughness: 0.1, metalness: 1, specular: 1.5, emissive: [0.3, 0.28, 0.36] });
  const ball = new Mesh(ballGeo, mBall, { castShadow: false, reflect: false }), iball = new Mesh(ballGeo, mBall, { castShadow: false, reflect: false });
  scene.add(ball); scene.add(iball);
  // glints: little four-point stars on some of the big ball's facets, in two sets that twinkle in turn as it turns
  const glint = k => { const parts = [], gr = new RNG(50 + k); for (let i = 0; i < 26; i++) { const u = gr.range(-0.9, 0.9), a = gr.range(0, Math.PI * 2), d = [Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a)], s2 = gr.range(0.18, 0.34); for (const r2 of [0, Math.PI / 2]) parts.push({ geo: G.box(s2, 0.025, 0.025), matrix: mul(TR(d[0] * 1.03, d[1] * 1.03, d[2] * 1.03), M.m4compose(M.m4(), [0, 0, 0], M.qfromTo(M.q4(), [0, 0, 1], d)), Rz(r2 + 0.4)), color: [1, 1, 1, 1] }); } return parts; };
  // and thin coloured rays out of it, turning with it, down over the sidewalk and the people at the door
  const rays = [], rr = new RNG(61);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + rr.range(-0.2, 0.2), dn = rr.range(0.3, 0.85), d = [Math.cos(a) * Math.cos(dn), -Math.sin(dn), Math.sin(a) * Math.cos(dn)], c = lin([NEON.pink, NEON.cyan, NEON.yellow, NEON.purple][i % 4]);
    const g = beamGeo(11, 0.06, 0.6, 8, 0.3); for (let v = 0; v < g.color.length; v += 4) { g.color[v] = c[0]; g.color[v + 1] = c[1]; g.color[v + 2] = c[2]; }
    rays.push({ geo: g, matrix: M.m4compose(M.m4(), [0, 0, 0], M.qfromTo(M.q4(), [0, 1, 0], d)) });
  }
  const mRays = new Material({ color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true });
  const rayMesh = new Mesh(ctx.geometry(G.merge(rays)), mRays, { castShadow: false, reflect: false }); rayMesh.order = 5; scene.add(rayMesh);
  const mGlint = [0, 1].map(() => new Material({ color: [3, 3, 3], shading: 'unlit', blend: 'add', depthWrite: false, fog: false }));
  const glints = [0, 1].map(k => { const m = new Mesh(ctx.geometry(G.merge(PR.bake(glint(k)))), mGlint[k], { castShadow: false, reflect: false }); m.order = 4; scene.add(m); return m; });
  const sp = [], srng = new RNG(31);
  for (let i = 0; i < 160; i++) { const u = srng.range(-1, 1), a = srng.range(0, Math.PI * 2), rr = srng.range(2.2, 4.4), d = [Math.sqrt(1 - u * u) * Math.cos(a) * rr, u * rr, Math.sqrt(1 - u * u) * Math.sin(a) * rr]; if (D.inner.y + d[1] < 0.3 || D.inner.y + d[1] > 4.3) continue; sp.push({ geo: G.sphere(0.05, 4, 2), matrix: TR(...d), color: c4(srng.pick([NEON.white, NEON.white, NEON.pink, NEON.cyan, NEON.yellow])) }); }
  const mSpeck = new Material({ color: [3, 3, 3], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
  const specks = new Mesh(ctx.geometry(G.merge(sp)), mSpeck, { castShadow: false, reflect: false }); specks.order = 4; scene.add(specks);
  const mBeams = [new Material({ color: [0.8, 0.14, 0.55], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true }), new Material({ color: [0.12, 0.6, 0.85], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true })];
  const bgeo = ctx.geometry(beamGeo(140, 0.35, 5, 14, 0.16));
  const beams = D.search.map((s, i) => { const m = new Mesh(bgeo, mBeams[i], { castShadow: false, reflect: false, cull: false }); m.order = 5; scene.add(m); return m; });
  add(D.glass, new Material({ color: lin('#5a3a7a'), opacity: 0.22, roughness: 0.05, specular: 1.5, blend: 'alpha', depthWrite: false }), { order: 2 });

  // ---- the beat, the neon's life, and the blackout ----
  const BPM = 118, beatLen = 60 / BPM;
  let t = rng.range(0, 20), bo = null, step = -1, flickOff = 0;
  const hsv = (h, s, v) => { const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
  const level = g => {
    if (!bo) return 1;
    if (bo.t < 1.4) return Math.random() < 1 - bo.t / 1.4 ? 1 : 0.04;
    const back = bo.back[g] ?? bo.back.tube;
    if (bo.t < back) return 0.03;
    if (bo.t < back + 0.9) return Math.random() < 0.55 ? 1 : 0.08;
    return 1;
  };
  const set = (m, k) => { m.color[0] = m.color[1] = m.color[2] = k; };
  const lightBase = D.light.intensity;
  return {
    disco: D, lights: [D.light], plan, BPM,
    get t() { return t; },
    // the neon blackout (an event): it all stutters out, stays dark a few seconds, then comes back a group at a time
    blackout() { const r = () => 4.2 + Math.random() * 3.2; bo = { t: 0, back: { tube: r(), sign: r(), flick: r() + 1, cycle: r(), beat: r(), chase: r(), floor: r(), win: r() } }; },
    get dark() { return !!bo; },
    update(dt) {
      t += dt;
      if (bo && (bo.t += dt) > Math.max(...Object.values(bo.back)) + 1) bo = null;
      const ph = (t / beatLen) % 1, pulse = 0.55 + 0.45 * (1 - ph) ** 2;
      set(mats.tube, 2.4 * level('tube'));
      set(mats.sign, 2.6 * level('sign'));
      // the failing ones: steady, then a burst of stutters, sometimes out for a moment
      if (flickOff > 0) flickOff -= dt; else if (Math.random() < dt * 0.3) flickOff = Math.random() * 0.5;
      set(mats.flick, (flickOff > 0 ? 0.08 : Math.sin(t * 2.1) > 0.7 && Math.random() < 0.35 ? 0.3 : 2.6) * level('flick'));
      const bl = level('beat'); set(mats.beat, 2.6 * pulse * bl); set(mats.beatSign, 2.8 * (0.7 + 0.3 * pulse) * bl);
      const c = hsv((t * 0.07) % 1, 0.75, 2.6 * level('cycle')); mats.cycle.color[0] = c[0]; mats.cycle.color[1] = c[1]; mats.cycle.color[2] = c[2];
      const ch = Math.floor(t * 7) % 3, cl = level('chase'); mats.chase.forEach((m, i) => set(m, (i === ch ? 3.2 : 0.35) * cl));
      set(mWin, 1.45 * Math.max(0.25, level('win'))); mWin.color[2] = 1.3 * Math.max(0.25, level('win'));
      // the dance floor steps a tile on every beat; the balls turn; the specks turn with the inner one
      const s = Math.floor(t / beatLen);
      if (s !== step) { step = s; mFloor.uvOffset[0] = ((s * 3) % 8) / 8; mFloor.uvOffset[1] = ((s * 5) % 8) / 8; }
      set(mFloor, 1.7 * Math.max(0.05, level('floor')));
      M.m4compose(ball.matrix, [D.ball.x, D.ball.y, D.ball.z], M.qaxis(M.q4(), 0, 1, 0, t * 0.6), [D.ball.r, D.ball.r, D.ball.r]);
      glints.forEach((g, k) => { g.matrix.set(ball.matrix); const tw = Math.max(0, Math.sin(t * 5.3 + k * Math.PI)); set(mGlint[k], 3.2 * tw * tw * level('floor')); });
      M.m4compose(rayMesh.matrix, [D.ball.x, D.ball.y, D.ball.z], M.qaxis(M.q4(), 0, 1, 0, t * 0.6), null); set(mRays, 0.9 * (0.6 + 0.4 * pulse) * level('floor'));
      M.m4compose(iball.matrix, [D.inner.x, D.inner.y, D.inner.z], M.qaxis(M.q4(), 0, 1, 0, t * 0.8), [D.inner.r, D.inner.r, D.inner.r]);
      M.m4compose(specks.matrix, [D.inner.x, D.inner.y, D.inner.z], M.qaxis(M.q4(), 0, 1, 0, t * 0.8), null);
      set(mSpeck, 3 * level('floor'));
      // the searchlights sweep slowly across the sky
      D.search.forEach((sl, i) => {
        const yaw = Math.atan2(D.face.nx, D.face.nz) + Math.sin(t * 0.21 + i * 2.1) * 1.1, tilt = 0.42 + 0.18 * Math.sin(t * 0.33 + i);
        M.m4mul(beams[i].matrix, TR(sl.x, sl.y, sl.z, yaw), Rx(tilt));
        beams[i].visible = level('beat') > 0.5;
      });
      D.light.intensity = lightBase * (0.75 + 0.25 * pulse) * Math.max(0.05, level('beat'));
    },
  };
}

// ---- shared shapes ----
// a light beam along +y: a cone from r0 at its base to r1 at len, fading out along its length (vertex alpha a0 → 0);
// draw it additive and unlit
export function beamGeo(len, r0, r1, seg = 12, a0 = 0.5) {
  const g = G.cylinder(r1, r0, len, seg, { y0: true, open: true });
  g.color = new Float32Array(g.position.length / 3 * 4);
  for (let i = 0; i < g.position.length / 3; i++) { const k = Math.min(1, Math.max(0, g.position[i * 3 + 1] / len)); g.color.set([1, 1, 1, a0 * (1 - k) ** 1.6], i * 4); } // (clamped: float32 rounding can put the tip a hair past len, and a negative base to a fractional power is NaN)
  return g;
}
// a mirror ball (radius 1): flat square-ish facets with hairline gaps, each with its own normal so it catches a different
// bit of the sky as it turns
export function mirrorBall(r = 1, rows = 12, cols = 22, seed = 3) {
  const rng = new RNG(seed), pos = [], nrm = [], col = [], idx = [];
  const P = (p, a) => [Math.sin(p) * Math.cos(a) * r, Math.cos(p) * r, Math.sin(p) * Math.sin(a) * r];
  for (let i = 0; i < rows; i++) {
    const p0 = i / rows * Math.PI, p1 = (i + 1) / rows * Math.PI, n = Math.max(4, Math.round(cols * Math.sin((p0 + p1) / 2)));
    for (let j = 0; j < n; j++) {
      const a0 = j / n * Math.PI * 2, a1 = (j + 1) / n * Math.PI * 2, gp = 0.06 * (p1 - p0), ga = 0.06 * (a1 - a0);
      const q = [P(p0 + gp, a0 + ga), P(p0 + gp, a1 - ga), P(p1 - gp, a1 - ga), P(p1 - gp, a0 + ga)];
      const c = P((p0 + p1) / 2, (a0 + a1) / 2), l = Math.hypot(...c), b = pos.length / 3, k = 0.72 + rng.next() * 0.28;
      for (const v of q) { pos.push(...v); nrm.push(c[0] / l, c[1] / l, c[2] / l); col.push(k, k, k * 1.02, 1); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(pos.length / 3 * 2), color: new Float32Array(col), index: new Uint16Array(idx) };
}

// ---- lowriders ----
// a long, low 60s-style sedan (or a convertible) facing +z with its wheels on the ground: candy paint fading darker
// below the chrome trim, chrome bumpers, grille and wire wheels in fat whitewalls, little rear fins. One part list (one
// mesh: it hops by its matrix). The rear axle (the hop's pivot) sits at z LOWRIDER.rear, y LOWRIDER.axle
export const LOWRIDER = { len: 5.7, rear: -1.75, front: 1.7, axle: 0.31, track: 0.9 };
export const CANDY = ['#c8102e', '#7b1fa2', '#00a0a8', '#d4a017', '#ff3f9a', '#1f4fd8', '#6abf2a', '#e8622c'];
export function lowrider(paint = '#7b1fa2', o = {}) {
  const L = LOWRIDER.len, W = 2.02, p = [], dk = M.mixRgb(lin(paint), [0.02, 0.0, 0.03], 0.45).concat(1), chromeC = c4('#e4e9f0'), glass = c4('#1c1828'), trim = c4(o.trim || '#f2e6d0');
  const B = (w, h, d, x, y, z, col, m = null) => p.push({ geo: G.box(w, h, d), matrix: m || TR(x, y, z), color: c4(col) });
  B(W, 0.34, L, 0, 0.43, 0, dk);                               // the lower body (the candy fades darker down here)
  B(W - 0.02, 0.22, L - 0.12, 0, 0.71, 0, paint);              // the upper body
  B(W - 0.1, 0.08, 1.75, 0, 0.84, 1.88, paint);                // hood
  B(W - 0.1, 0.08, 1.45, 0, 0.84, -2.05, paint);               // deck
  for (const s of [-1, 1]) {
    B(0.1, 0.16, 1.0, s * 0.95, 0.9, -2.3, paint);             // fins
    B(0.03, 0.05, L - 0.5, s * (W / 2 + 0.005), 0.6, 0, chromeC); // side trim
    B(0.03, 0.42, 0.82, s * (W / 2 + 0.006), 0.44, 1.7, '#0a090e'); B(0.03, 0.42, 0.82, s * (W / 2 + 0.006), 0.44, -1.75, '#0a090e'); // wheel arches
  }
  for (const sz of [-1, 1]) B(W + 0.1, 0.17, 0.2, 0, 0.4, sz * (L / 2 + 0.06), chromeC); // bumpers
  B(1.5, 0.26, 0.05, 0, 0.6, L / 2 + 0.01, chromeC);           // grille
  for (const s of [-1, 1]) { B(0.32, 0.18, 0.04, s * 0.78, 0.62, L / 2 + 0.02, '#fff4dc'); B(0.36, 0.12, 0.04, s * 0.74, 0.68, -L / 2 - 0.02, '#e01030'); }
  if (!o.convertible) {
    B(1.72, 0.44, 2.15, 0, 1.04, -0.35, glass);                // the glasshouse
    B(1.68, 0.07, 1.95, 0, 1.29, -0.45, o.roof || paint);      // the roof (vinyl on some)
    for (const s of [-1, 1]) { B(0.07, 0.44, 0.12, s * 0.85, 1.04, 0.66, chromeC); B(0.07, 0.44, 0.34, s * 0.85, 1.04, -1.3, o.roof || paint); }
  } else {
    p.push({ geo: G.box(1.74, 0.42, 0.04), matrix: mul(TR(0, 1.04, 0.72), Rx(-0.42)), color: glass });  // windshield
    p.push({ geo: G.box(1.8, 0.05, 0.06), matrix: mul(TR(0, 1.23, 0.64), Rx(-0.42)), color: chromeC });
    B(1.72, 0.2, 0.62, 0, 0.72, 0.05, trim); B(1.72, 0.36, 0.14, 0, 0.92, -0.28, trim);   // tuck-and-roll benches
    B(1.72, 0.2, 0.62, 0, 0.72, -1.0, trim); B(1.72, 0.34, 0.14, 0, 0.92, -1.33, trim);
    p.push({ geo: G.torus(0.17, 0.025, 14, 4), matrix: mul(TR(-0.45, 1.0, 0.45), Rx(1.2)), color: chromeC });
    B(1.9, 0.12, 1.2, 0, 0.84, -2.05, o.boot || paint);       // the folded top's boot
  }
  // wire wheels: tyre, a fat whitewall, the chrome rim, the knock-off
  for (const [x, z] of [[-1, LOWRIDER.front], [1, LOWRIDER.front], [-1, LOWRIDER.rear], [1, LOWRIDER.rear]]) {
    const m = mul(TR(x * LOWRIDER.track, LOWRIDER.axle, z), Rz(Math.PI / 2));
    p.push({ geo: G.cylinder(0.31, 0.31, 0.22, 12), matrix: m, color: c4('#121214') });
    p.push({ geo: G.cylinder(0.25, 0.25, 0.225, 12), matrix: m, color: c4('#f4f2ec') });
    p.push({ geo: G.cylinder(0.17, 0.17, 0.235, 10), matrix: m, color: chromeC });
    p.push({ geo: G.cylinder(0.05, 0.05, 0.27, 6), matrix: m, color: c4('#e8c050') });
  }
  return PR.bake(p);
}

// ---- dancers ----
// a figure facing +z, feet on y 0, built from boxes posed by a few angles (radians): lean / side / twist (the torso),
// drop (how far the hips sink, m), aL / aR: [forward raise, side raise, elbow bend] at each shoulder, lL / lR: [forward
// raise, side raise, knee bend] at each hip, head: [nod, turn]; prop: 'boombox' (on the right shoulder)
export const OUTFITS = [
  { skin: '#8d5a36', hair: '#1a1210', style: 'flat', top: '#c8102e', bottom: '#c8102e', stripe: '#f4f1ea', shoes: '#f4f1ea' },
  { skin: '#5d3a22', hair: '#120c0a', style: 'cap', cap: '#1d1f26', top: '#2457c5', bottom: '#1d1f26', stripe: '#f4f1ea', shoes: '#f4f1ea' },
  { skin: '#e9c2a0', hair: '#d8b25a', style: 'perm', top: '#ff3fa4', bottom: '#2fe0ff', warmers: '#ffe45c', shoes: '#f4f1ea', band: '#2fe0ff' },
  { skin: '#c68b62', hair: '#2a1a12', style: 'afro', top: '#ffe45c', bottom: '#3a4a6a', shoes: '#1d1f26' },
  { skin: '#3f2a1c', hair: '#0e0a08', style: 'flat', top: '#3dffb0', sleeve: '#7b3cff', bottom: '#7b3cff', stripe: '#3dffb0', shoes: '#f4f1ea' },
  { skin: '#e9c2a0', hair: '#5a3a1a', style: 'pony', top: '#7b3cff', bottom: '#1d1f26', warmers: '#ff3fa4', shoes: '#ff3fa4', band: '#ff3fa4' },
  { skin: '#a8754e', hair: '#1a1210', style: 'cap', cap: '#ff8a3c', top: '#f4f1ea', bottom: '#3a4a6a', shoes: '#c8102e' },
  { skin: '#8d5a36', hair: '#120c0a', style: 'afro', top: '#ff8a3c', bottom: '#5a3a1a', shoes: '#f4f1ea', band: '#f4f1ea' },
];
export const POSES = {
  stand: {}, shift: { side: 0.06, twist: 0.15, lL: [0, 0.1, 0.05], lR: [0.08, 0.02, 0.18], aL: [0.1, 0.18, 0.4], aR: [0, 0.12, 0.25] },
  clap: { aL: [1.0, 0.2, 1.3], aR: [1.0, 0.2, 1.3], head: [0.1, 0] }, cheer: { aL: [0.3, 2.7, 0.2], aR: [0.4, 2.5, 0.4], head: [-0.2, 0] },
  cross: { aL: [0.55, 0.05, 2.0], aR: [0.5, 0.05, 2.05], side: 0.04 }, pockets: { aL: [-0.15, 0.1, 0.4], aR: [-0.12, 0.1, 0.45], lR: [0.1, 0.05, 0.1] },
  boombox: { aR: [0.1, 2.4, 2.5], aL: [0.05, 0.15, 0.3], head: [0, -0.25], prop: 'boombox' },
  // disco: the point up and across, the point down, the roll, arms up
  point: { aL: [0.25, 2.55, 0.05], aR: [0.3, 0.75, 2.0], side: -0.12, twist: 0.25, lL: [0, 0.18, 0], lR: [0.15, 0.05, 0.3], head: [-0.25, 0.3] },
  point2: { aR: [0.5, 0.85, 0.05], aL: [0.3, 0.75, 2.0], side: 0.12, twist: -0.25, lR: [0, 0.18, 0], lL: [0.15, 0.05, 0.3], head: [0.25, -0.3] },
  roll: { aL: [1.25, 0.12, 1.75], aR: [1.05, 0.12, 1.85], lean: 0.12, drop: 0.06, lL: [0.15, 0.08, 0.3], lR: [0.15, 0.08, 0.3] },
  vee: { aL: [0.1, 2.6, 0.1], aR: [0.1, 2.6, 0.1], drop: 0.02, head: [-0.25, 0] },
  // popping and locking: hard angles
  wave: { aL: [0, 1.57, 0], aR: [0, 1.57, 1.3], side: 0.08, head: [0, -0.5] }, wave2: { aR: [0, 1.57, 0], aL: [0, 1.57, 1.3], side: -0.08, head: [0, 0.5] },
  robot: { aL: [1.57, 0.1, 1.57], aR: [0.0, 0.1, 1.57], twist: 0.35, drop: 0.04 }, robot2: { aR: [1.57, 0.1, 1.57], aL: [0.0, 0.1, 1.57], twist: -0.35, drop: 0.04 },
  lock: { aL: [1.4, 0.55, 0.15], aR: [1.4, 0.55, 0.15], drop: 0.16, lean: 0.12, lL: [0.45, 0.1, 0.75], lR: [0.45, 0.1, 0.75] },
  lock2: { aL: [0.6, 0.35, 1.9], aR: [0.6, 0.35, 1.9], drop: 0.3, lean: 0.3, lL: [0.75, 0.2, 1.3], lR: [0.75, 0.2, 1.3], head: [0.3, 0] },
  // toprock and the running man
  rock1: { lL: [0.55, 0.05, 0.55], lR: [-0.1, 0.05, 0.2], aL: [0.4, 0.9, 1.0], aR: [0.5, 0.9, 1.2], lean: 0.1, twist: 0.35, drop: 0.05 },
  rock2: { lR: [0.55, 0.05, 0.55], lL: [-0.1, 0.05, 0.2], aR: [0.4, 0.9, 1.0], aL: [0.5, 0.9, 1.2], lean: 0.1, twist: -0.35, drop: 0.05 },
  run1: { lL: [1.0, 0.0, 1.3], lR: [-0.3, 0.0, 0.4], aL: [-0.5, 0.1, 1.5], aR: [0.8, 0.1, 1.5], drop: 0.1, lean: 0.08 },
  run2: { lR: [1.0, 0.0, 1.3], lL: [-0.3, 0.0, 0.4], aR: [-0.5, 0.1, 1.5], aL: [0.8, 0.1, 1.5], drop: 0.1, lean: 0.08 },
  // skating: a push to one side, the glide
  skate1: { lean: 0.4, drop: 0.14, lL: [-0.55, 0.35, 0.25], lR: [0.35, 0.0, 0.75], aL: [0.7, 0.15, 0.6], aR: [-0.6, 0.15, 0.3], twist: 0.15 },
  skate2: { lean: 0.4, drop: 0.14, lR: [-0.55, 0.35, 0.25], lL: [0.35, 0.0, 0.75], aR: [0.7, 0.15, 0.6], aL: [-0.6, 0.15, 0.3], twist: -0.15 },
  glide: { lean: 0.25, drop: 0.1, lL: [0.25, 0.0, 0.45], lR: [0.25, 0.0, 0.45], aL: [0.25, 0.5, 0.4], aR: [0.25, 0.5, 0.4] },
  train: { lean: 0.3, drop: 0.12, lL: [0.3, 0.05, 0.5], lR: [0.2, 0.05, 0.4], aL: [1.35, 0.22, 0.1], aR: [1.35, 0.22, 0.1] },
  // breaking: a squat on the edge of the circle, the six-step on the hands, and the power moves (posed upright here;
  // parklife turns them upside down or lays them on the floor): the headspin, the windmill, the baby freeze
  crouch: { drop: 0.42, lean: 0.55, lL: [1.45, 0.25, 2.3], lR: [1.45, 0.25, 2.3], aL: [0.7, 0.1, 1.3], aR: [0.7, 0.1, 1.3] },
  six1: { drop: 0.62, lean: 1.25, aL: [1.2, 0.1, 0.1], aR: [1.2, 0.1, 0.1], lL: [1.7, 0.4, 2.4], lR: [0.4, 0.2, 0.9] },
  six2: { drop: 0.62, lean: 1.25, aL: [1.2, 0.1, 0.1], aR: [1.2, 0.1, 0.1], lR: [1.7, 0.4, 2.4], lL: [0.4, 0.2, 0.9], twist: 0.3 },
  headspin: { free: true, lL: [0.1, 0.75, 0.1], lR: [0.1, 0.75, 0.1], aL: [0.3, 1.3, 0.6], aR: [0.3, 1.3, 0.6], head: [0, 0] },
  windmill: { free: true, lL: [0.3, 0.95, 0.05], lR: [0.3, 0.95, 0.05], aL: [0.3, 0.4, 1.4], aR: [0.3, 0.4, 1.4] },
  freeze: { free: true, aL: [0.3, 1.2, 1.6], aR: [1.0, 0.3, 1.0], lL: [1.2, 0.3, 1.9], lR: [0.5, 0.6, 1.0], side: 0.2, head: [0.2, 0.3] },
};
export function dancer(pose = {}, outfit = OUTFITS[0]) {
  const P = { lean: 0, side: 0, twist: 0, drop: 0, aL: [0, 0.12, 0.12], aR: [0, 0.12, 0.12], lL: [0, 0.04, 0], lR: [0, 0.04, 0], head: [0, 0], ...pose }, o = outfit, parts = [];
  const box = (m, w, h, d, hex, oy) => parts.push({ geo: G.box(w, h, d), matrix: mul(m, Tm(0, oy, 0)), color: c4(hex) });
  const root = mul(Tm(0, 0.95 - P.drop, 0), Ry(P.twist * 0.3));
  box(root, 0.32, 0.2, 0.2, o.bottom, 0);
  const chest = mul(root, Tm(0, 0.08, 0), Ry(P.twist * 0.7), Rx(P.lean), Rz(P.side));
  box(chest, 0.37, 0.47, 0.22, o.top, 0.24);
  if (o.stripe) for (const s of [-1, 1]) box(mul(chest, Tm(s * 0.12, 0, 0.112)), 0.04, 0.44, 0.01, o.stripe, 0.24);
  const neck = mul(chest, Tm(0, 0.5, 0), Rx(P.head[0]), Ry(P.head[1]));
  box(neck, 0.09, 0.1, 0.09, o.skin, 0.03);
  const head = mul(neck, Tm(0, 0.17, 0.01));
  parts.push({ geo: G.sphere(0.112, 9, 7), matrix: head, color: c4(o.skin) });
  if (o.style === 'afro') parts.push({ geo: G.sphere(0.16, 9, 7), matrix: mul(head, Tm(0, 0.06, -0.02)), color: c4(o.hair) });
  else if (o.style === 'perm') parts.push({ geo: G.sphere(0.145, 9, 7, { sy: 0.9 }), matrix: mul(head, Tm(0, 0.04, -0.03)), color: c4(o.hair) });
  else if (o.style === 'flat') parts.push({ geo: G.box(0.22, 0.18, 0.22), matrix: mul(head, Tm(0, 0.1, -0.01)), color: c4(o.hair) });
  else if (o.style === 'pony') { parts.push({ geo: G.sphere(0.118, 9, 7, { sy: 0.8 }), matrix: mul(head, Tm(0, 0.03, -0.015)), color: c4(o.hair) }); parts.push({ geo: G.box(0.07, 0.22, 0.07), matrix: mul(head, Tm(0, -0.02, -0.14)), color: c4(o.hair) }); }
  else if (o.style === 'cap') { parts.push({ geo: G.sphere(0.12, 9, 5, { phiMax: Math.PI / 2 }), matrix: mul(head, Tm(0, 0.02, 0)), color: c4(o.cap) }); parts.push({ geo: G.box(0.16, 0.025, 0.14), matrix: mul(head, Tm(0, 0.04, -0.15)), color: c4(o.cap) }); }
  if (o.band) parts.push({ geo: G.cylinder(0.118, 0.118, 0.035, 10, { open: true }), matrix: mul(head, Tm(0, 0.04, 0)), color: c4(o.band) });
  for (const [s, a] of [[1, P.aL], [-1, P.aR]]) {
    const sh = mul(chest, Tm(s * 0.22, 0.43, 0), Rz(s * a[1]), Rx(-a[0]));
    box(sh, 0.095, 0.29, 0.095, o.sleeve || o.top, -0.145);
    const el = mul(sh, Tm(0, -0.29, 0), Rx(-a[2]));
    box(el, 0.085, 0.25, 0.085, o.sleeve || o.top, -0.12);
    box(el, 0.08, 0.09, 0.08, o.skin, -0.29);
    if (s < 0 && P.prop === 'boombox') parts.push({ geo: G.box(0.5, 0.26, 0.14), matrix: mul(el, Tm(-0.05, -0.36, 0.05)), color: c4('#c9ced6') });
  }
  for (const [s, l] of [[1, P.lL], [-1, P.lR]]) {
    const hp = mul(root, Tm(s * 0.095, -0.06, 0), Rz(s * l[1]), Rx(-l[0]));
    box(hp, 0.14, 0.44, 0.15, o.bottom, -0.22);
    const kn = mul(hp, Tm(0, -0.44, 0), Rx(l[2]));
    box(kn, 0.11, 0.42, 0.12, o.warmers || o.bottom, -0.21);
    box(mul(kn, Tm(0, -0.43, 0.05)), 0.12, 0.09, 0.27, o.shoes, 0);
    if (o.skates) for (const dz of [-0.09, 0.09]) parts.push({ geo: G.box(0.1, 0.06, 0.06), matrix: mul(kn, Tm(0, -0.5, 0.05 + dz)), color: c4('#ffe45c') });
  }
  // (feet, or hands, on the floor: the power moves keep their standing frame, parklife pivots them)
  const out = PR.bake(parts);
  if (!P.free) { let lo = Infinity; for (const q of out) for (let i = 1; i < q.geo.position.length; i += 3) lo = Math.min(lo, q.geo.position[i]); for (const q of out) for (let i = 1; i < q.geo.position.length; i += 3) q.geo.position[i] -= lo; }
  return out;
}
