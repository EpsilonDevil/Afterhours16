// v0.4.8.5 quick patch 2: The Monster Mash, the event park on Halloween night. The park keeps its standard layout; round
// it a haunted town under a huge full moon: Hollow Hill Cemetery across the north sidewalk (crooked headstones, crosses,
// a mausoleum, an iron fence and gate, dead trees), the church and its bell tower at the cemetery's west end, the haunted
// mansion on the hill behind with the moon rising over it, the pumpkin patch with its scarecrows and the corn maze to the
// north-east, an abandoned carnival to the east (a Ferris wheel and a carousel turning slowly, the HAUNTED HOUSE ride with
// its glowing eyes), a street of Halloween houses strung with orange lights to the south with the funeral home and its
// hearse, and a misty swamp to the west with the witch's cottage and her bubbling cauldron. Ground fog hugs all of it
// (thin over the courts), jack-o'-lanterns flicker everywhere. The sky is a dome of its own: blue-black, stars, the moon
// and its halo, thin clouds drifting across it. Also here: the skinned figures parklife.js animates (zombies, a vampire,
// the werewolf, mummies, skeletons, ghosts, black cats, bats, trick-or-treaters, the slasher, the Lantern Man), the
// hearse and the witch on her broom.
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG, makeNoise2D } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { cachedTexture } from './court.js';
import * as PR from './props.js';
import { PARK_COURTS, plazaLampOff } from './themes.js';
import { shadedPlane, camClear, onSomething } from './harbor.js';

const lin = hex => M.hexLinear(hex);
const c4 = (hex, a = 1) => (typeof hex === 'string' ? [...lin(hex), a] : hex);
const TR = (x, y, z, yaw = 0) => M.m4fromYaw(M.m4(), x, y, z, yaw);
const DEG = Math.PI / 180;
const Rx = a => M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, a));
const Ry = a => M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 1, 0, a));
const Rz = a => M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, a));
const Sc = (x, y, z) => M.m4compose(M.m4(), [0, 0, 0], M.q4(), [x, y, z]);
const Tm = (x, y, z) => M.m4translation(M.m4(), x, y, z);
const mul = (...ms) => ms.reduce((a, b) => M.m4mul(M.m4(), a, b));
// (cheap pieces for the many: a box without its top and bottom, an octahedron for a bulb)
const bar = (w, h, d) => { const g = G.box(w, h, d); return { position: g.position, normal: g.normal, uv: g.uv, index: new Uint16Array([...g.index.slice(0, 12), ...g.index.slice(24, 36)]) }; };
const gem = r => { const P = [[r, 0, 0], [-r, 0, 0], [0, r * 1.3, 0], [0, -r * 1.3, 0], [0, 0, r], [0, 0, -r]], F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]], pos = [], nrm = [];
  for (const f of F) { const [a, b, c] = f.map(i => P[i]), n = M.v3norm([0, 0, 0], M.v3cross([0, 0, 0], [b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]])); pos.push(...a, ...b, ...c); nrm.push(...n, ...n, ...n); }
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(pos.length / 3 * 2), index: new Uint16Array(F.flatMap((_, i) => [i * 3, i * 3 + 1, i * 3 + 2])) }; };
// (a string-light bulb: a three-sided double pyramid, 6 triangles: unlit, a dot at any distance)
const dot = r => { const P = [[r, 0, 0], [-r * 0.5, 0, r * 0.87], [-r * 0.5, 0, -r * 0.87], [0, r * 1.3, 0], [0, -r * 1.3, 0]], F = [[0, 3, 1], [1, 3, 2], [2, 3, 0], [1, 4, 0], [2, 4, 1], [0, 4, 2]], pos = [];
  for (const f of F) for (const i of f) pos.push(...P[i]);
  return { position: new Float32Array(pos), normal: new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), uv: new Float32Array(pos.length / 3 * 2), index: new Uint16Array(F.flatMap((_, i) => [i * 3, i * 3 + 1, i * 3 + 2])) }; };
export const HUE = { slime: '#7cff4f', pumpkin: '#ff7a1a', candle: '#ffb347', bone: '#e8e2d0', purple: '#7a3cff', moon: '#e8eeff' };

// ---- the town plan (world metres; +z north, the park is |x| < 63.6, z -34.3 .. 33.4) ----
export const CEMETERY = { x0: -44, x1: 24, z0: 38.5, z1: 66, fence: 37.2, gate: -10 };
export const CHURCH = { x: -54, z: 74, w: 12, d: 22, h: 6.8, tower: { x: -60.5, z: 61, s: 6.4, h: 21, spire: 14 } };
export const MAUSOLEUM = { x: 2, z: 58, w: 6, d: 7, h: 4.6 };
export const HILL = { x: 10, z: 136, r: 66, h: 13 };
// the old folly: a broken stone tower on the hill's flank, right under the moon as you look from the plaza (the werewolf
// climbs it to howl)
export const FOLLY = { x: 22, z: 76, r: 2.3, h: 11 };
export const MANSION = { x: 10, z: 132, w: 26, d: 16 };
export const PATCH = { x0: 28, x1: 61, z0: 39, z1: 55 };
export const CORN = { x0: 26, x1: 96, z0: 60, z1: 86, gap: 44 };
export const CARNIVAL = { wheel: { x: 96, z: 34, r: 13, axle: 15.5 }, carousel: { x: 90, z: 6, r: 6.5 }, ride: { x: 88, z: -24, w: 18, d: 11, h: 9.5 }, arch: { x: 70, z: 10 } };
export const STREET = { walk: [-36.8, -34.3], z0: -46, z1: -36.8, lanes: [{ z: -39.4, dir: 1 }, { z: -43.4, dir: -1 }], kerb: -46, yard: -50 };
export const LAKE = { x: -132, z: 10, rx: 36, rz: 38, y: -0.42 }; // (its dip ends short of the south street's sidewalk)
export const COTTAGE = { x: -101, z: -25, yaw: 1.25, cauldron: { x: -94.5, z: -21.5 } };
export const FUNERAL = { x: 47, z: -58, w: 20, d: 12 };
export const EXTENT = 260;
// the open graves the zombies climb out of (parklife), and where the bats live (the church's belfry)
export const GRAVES = [[-30, 49], [-22, 54], [-34, 58], [12, 47], [18, 52], [-4, 44]];
export const BELFRY = { x: CHURCH.tower.x, y: CHURCH.tower.h - 3.2, z: CHURCH.tower.z };
export const moonDir = theme => { const m = theme?.moon || { az: -9, el: 8.5 }, a = m.az * DEG, e = m.el * DEG; return [-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]; };

// the game cameras' paths (harbor.js camClear) plus the half courts' broadcast cameras past the west fence
export function horrorClear(x, z, pad = 4.5) {
  if (!camClear(x, z, pad)) return false;
  for (const c of PARK_COURTS) if (!c.full) { const [ox, , oz] = c.origin; if (Math.abs(x - (ox - 16.5)) < 3 + pad && z > oz - 2 - pad && z < oz + 12 + pad) return false; }
  return true;
}

// ---- the ground: flat under the park, its sidewalks and the south street; the cemetery rising toward the mansion's
// hill, rolling hills out in the fog, the swamp's bed dipping under the water ----
const tnoise = makeNoise2D(606);
const bump = (dx, dz, r) => { const q = (dx * dx + dz * dz) / (r * r); return q >= 1 ? 0 : (1 - q) * (1 - q); };
export function groundY(x, z) {
  let y = HILL.h * bump(x - HILL.x, z - HILL.z, HILL.r) + 3.2 * M.smooth((z - 38) / 80);
  const d = Math.hypot(x * 0.8, z * 0.9);
  y += M.smooth((d - 140) / 70) * (5 + 12 * (tnoise.fbm(x / 80 + 3, z / 80, 3) + 0.5));
  const lq = ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2;
  y -= 1.7 * M.smooth((1.25 - lq) / 0.45);
  const out = Math.max(Math.abs(x) - 68, z - 37, -z - 64);
  return y * M.smooth(out / 14);
}

let groundMaps = null;
export function horrorGround(ctx, scene, theme) {
  const maps = () => groundMaps || (groundMaps = T.spookyGround({}));
  const color = cachedTexture(ctx, 'spooky-c', () => maps().color, { aniso: 8 });
  const normal = cachedTexture(ctx, 'spooky-n', () => maps().normal, { srgb: false, aniso: 8 });
  const noise = makeNoise2D(17);
  // vertex shade: darker in the fog, greener on the cemetery's grass, a pale track from its gate to the mausoleum,
  // darker under the pumpkin vines
  const shade = (x, z) => {
    const n = noise.fbm(x / 40, z / 40, 3), k = 0.82 + n * 0.3;
    let r = 0.62 * k, gg = 0.6 * k, b = 0.55 * k;
    if (x > CEMETERY.x0 - 4 && x < CEMETERY.x1 + 4 && z > CEMETERY.z0 - 1 && z < CEMETERY.z1 + 4) { gg *= 1.12; r *= 0.9; }
    const path = Math.max(0, 1 - Math.abs(x - CEMETERY.gate - (z - 38) * 0.35) / 1.6) * (z > 37 && z < MAUSOLEUM.z - 3 ? 1 : 0);
    r += path * 0.18; gg += path * 0.14; b += path * 0.08;
    if (x > PATCH.x0 && x < PATCH.x1 && z > PATCH.z0 && z < PATCH.z1) { r *= 0.8; gg *= 0.95; b *= 0.75; }
    return [r, gg, b];
  };
  const geo = shadedPlane(-EXTENT, EXTENT, -EXTENT + 30, EXTENT, 9, 6, shade, (x, z) => groundY(x, z) - 0.025);
  G.computeNormals(geo);
  const ground = new Mesh(ctx.geometry(geo), new Material({ color: [1, 1, 1], map: color, normalMap: normal, normalScale: 0.8, roughness: 0.95, specular: 0.4 }), { castShadow: false, reflect: false });
  ground.order = -3; scene.add(ground);
  // the park's own slab: the event parks' jointed concrete, cold and grey under the moon
  const conc = cachedTexture(ctx, 'concrete', () => T.concrete({ joints: true }).color, {});
  const concN = cachedTexture(ctx, 'concreteN', () => T.concrete({ joints: true }).normal, { srgb: false });
  const W = 127.2, D = 67.7, slab = G.plane(W, D, 1, 1);
  for (let i = 0; i < slab.uv.length; i += 2) { slab.uv[i] *= W / 4; slab.uv[i + 1] *= D / 4; }
  const m = new Mesh(ctx.geometry(slab), new Material({ color: lin(theme.ground), map: conc, normalMap: concN, normalScale: 0.6, roughness: 0.85 }), { castShadow: false, reflect: false });
  M.m4translation(m.matrix, 0, -0.005, (33.4 - 34.3) / 2); m.order = -2; scene.add(m);
  return [ground, m];
}

// ---- the sky: blue-black overhead, a cold glow round the moon, the stars (in the dome itself), the moon and its halo,
// thin clouds drifting across it ----
// el: elevation (radians), cm: cosine of the angle to the moon
export function nightSky(el, cm) {
  const e = el / DEG, mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  let c;
  if (e < 0) c = mix([0.035, 0.045, 0.06], [0.012, 0.014, 0.018], M.smooth(-e / 12));
  else {
    const stops = [[0, [0.05, 0.065, 0.09]], [5, [0.034, 0.046, 0.075]], [14, [0.018, 0.026, 0.05]], [35, [0.008, 0.012, 0.03]], [90, [0.004, 0.006, 0.016]]];
    let k = 0; while (k < stops.length - 2 && e > stops[k + 1][0]) k++;
    c = mix(stops[k][1], stops[k + 1][1], M.smooth((e - stops[k][0]) / (stops[k + 1][0] - stops[k][0])));
  }
  const g = Math.max(0, cm);
  return [c[0] + 0.05 * g ** 12 + 0.035 * g ** 60, c[1] + 0.065 * g ** 12 + 0.04 * g ** 60, c[2] + 0.1 * g ** 12 + 0.05 * g ** 60];
}
export function horrorSky(ctx, scene, theme) {
  const Mn = theme.moon, md = moonDir(theme), R = 255;
  const els = [-90, -30, -10, -4, -1, 0, 1.5, 3, 5, 7.5, 10, 13, 17, 22, 29, 38, 50, 64, 78, 90].map(d => d * DEG), nAz = 64;
  const pos = [], col = [], nrm = [], uv = [], idx = [];
  els.forEach(el => {
    for (let j = 0; j <= nAz; j++) {
      const a = j / nAz * Math.PI * 2, d = [Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)];
      pos.push(d[0] * R, d[1] * R, d[2] * R); nrm.push(-d[0], -d[1], -d[2]); uv.push(j / nAz, 0);
      col.push(...nightSky(el, d[0] * md[0] + d[1] * md[1] + d[2] * md[2]), 1);
    }
  });
  for (let i = 0; i < els.length - 1; i++) for (let j = 0; j < nAz; j++) { const a = i * (nAz + 1) + j, b = a + nAz + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  // the stars: little quads just inside the dome, fewer near the horizon's haze, none round the moon
  const rng = new RNG(1031);
  for (let i = 0; i < 1400; i++) {
    const u = rng.range(Math.sin(7 * DEG), 1), a = rng.range(0, Math.PI * 2), ce = Math.sqrt(1 - u * u), d = [ce * Math.sin(a), u, ce * Math.cos(a)];
    if (d[0] * md[0] + d[1] * md[1] + d[2] * md[2] > Math.cos((Mn.size * 1.6) * DEG)) continue;
    const s = rng.range(0.14, 0.34) * (rng.next() < 0.06 ? 1.7 : 1), r = R - 2, b = pos.length / 3;
    const t1 = M.v3norm([0, 0, 0], [d[2], 0, -d[0]]), t2 = M.v3cross([0, 0, 0], d, t1);
    const k = rng.range(0.5, 1.6) * Math.min(1, (u - 0.1) * 3), tint = rng.pick([[1, 1, 1], [0.8, 0.88, 1], [1, 0.92, 0.8]]);
    for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(d[0] * r + (t1[0] * p + t2[0] * q) * s, d[1] * r + (t1[1] * p + t2[1] * q) * s, d[2] * r + (t1[2] * p + t2[2] * q) * s); nrm.push(-d[0], -d[1], -d[2]); uv.push(0, 0); col.push(tint[0] * k, tint[1] * k, tint[2] * k, 1); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const domeMat = new Material({ color: [1, 1, 1], shading: 'unlit', fog: false, doubleSided: true, depthWrite: false });
  const dome = new Mesh(ctx.geometry({ position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), color: new Float32Array(col), index: new Uint16Array(idx) }), domeMat, { castShadow: false, reflect: false, cull: false });
  dome.order = -10; scene.add(dome);
  // the moon and its halo
  const dist = Mn.dist, rad = Math.tan(Mn.size / 2 * DEG) * dist, q = rad * 2 / 0.8;
  const cx = md[0] * dist, cy = md[1] * dist, cz = md[2] * dist, yaw = Math.atan2(-cx, -cz), pitch = Math.asin(md[1]);
  const face = mul(TR(cx, cy, cz, yaw), Rx(pitch));
  const moonMat = new Material({ map: cachedTexture(ctx, 'moondisc', () => T.moonDisc(), { wrap: 'clamp' }), color: [2.1, 2.15, 2.3], shading: 'unlit', fog: false, blend: 'alpha', depthWrite: false });
  const moon = new Mesh(ctx.geometry(G.quad(q, q)), moonMat, { castShadow: false, reflect: false }); moon.matrix.set(face); moon.order = -9; scene.add(moon);
  const haloMat = new Material({ map: cachedTexture(ctx, 'glowspot-2', () => T.glowSpot(128, 2.6), { wrap: 'clamp' }), color: [0.32, 0.38, 0.5], shading: 'unlit', fog: false, blend: 'add', depthWrite: false });
  const halo = new Mesh(ctx.geometry(G.quad(q * 4.2, q * 4.2)), haloMat, { castShadow: false, reflect: false }); halo.matrix.set(mul(TR(cx * 1.02, cy * 1.02, cz * 1.02, yaw), Rx(pitch))); halo.order = -9.5; scene.add(halo);
  // thin clouds all round, a couple low across the moon; the layer turns slowly so they drift past it
  const clouds = [], crng = new RNG(808), base = Math.atan2(md[0], md[2]);
  for (let i = 0; i < 18; i++) {
    const near = i < 3, a = near ? base + rng.range(-0.12, 0.12) + (i - 1) * 0.5 : crng.range(0, Math.PI * 2), d = crng.range(200, 232), el = (near ? crng.range(5, 13) : crng.range(4, 24)) * DEG;
    const x = Math.sin(a) * Math.cos(el) * d, y = Math.sin(el) * d, z = Math.cos(a) * Math.cos(el) * d, w = crng.range(40, 110), h = w * crng.range(0.06, 0.1);
    const gq = G.quad(w, h); if (crng.next() < 0.5) for (let v = 0; v < 4; v++) gq.uv[v * 2] = 1 - gq.uv[v * 2];
    clouds.push({ geo: gq, matrix: TR(x, y, z, Math.atan2(-x, -z)), color: [0.16, 0.19, 0.26, crng.range(0.75, 1)] });
  }
  const cloudMat = new Material({ map: cachedTexture(ctx, 'cloudstreak', () => T.cloudStreak(), { wrap: 'clamp' }), color: [1, 1, 1], shading: 'unlit', fog: false, blend: 'alpha', depthWrite: false });
  const cm = new Mesh(ctx.geometry(G.merge(PR.bake(clouds))), cloudMat, { castShadow: false, reflect: false, cull: false });
  cm.order = -8; scene.add(cm);
  return { dome, moon, halo, clouds: cm, domeMat, moonMat, haloMat, cloudMat, moonPos: [cx, cy, cz], moonRad: rad };
}

// ---- the low fog: three thin layers following the ground, drifting different ways, a wisp over the courts ----
function groundFog(ctx, scene) {
  const tex = cachedTexture(ctx, 'fogwisps', () => T.fogWisps({}), {});
  const layers = [[0.25, 0.3, 40, [0.009, 0.004]], [0.8, 0.2, 58, [-0.006, 0.007]], [1.6, 0.12, 84, [0.003, -0.006]]], mats = [];
  const thin = (x, z) => { const dx = Math.max(0, Math.abs(x) - 62), dz = Math.max(0, z > 0 ? z - 31 : -z - 33); return 0.12 + 0.88 * M.clamp(Math.hypot(dx, dz) / 14, 0, 1); };
  for (const [y, a, tile, scroll] of layers) {
    const g = shadedPlane(-230, 230, -200, 230, 14, tile, () => [1, 1, 1], (x, z) => Math.max(groundY(x, z), LAKE.y) + y); // (over the swamp's water, not under it)
    for (let i = 0; i < g.position.length / 3; i++) { const x = g.position[i * 3], z = g.position[i * 3 + 2]; g.color[i * 4 + 3] = thin(x, z) * (1 - M.smooth((Math.hypot(x, z) - 170) / 50)); }
    const mat = new Material({ map: tex, color: [0.26, 0.31, 0.34], opacity: a, shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false });
    const m = new Mesh(ctx.geometry(g), mat, { castShadow: false, reflect: false, cull: false });
    m.order = 4; scene.add(m);
    mats.push([mat, scroll]);
  }
  return mats;
}

// ---- shared shapes ----
// a pumpkin (radius 1 across, ribbed, squashed), its stem on top: one geometry, placed by matrix
let pumpkinGeoCache = null;
export function pumpkinGeo(seg = 12, rings = 6) {
  if (seg === 12 && rings === 6 && pumpkinGeoCache) return pumpkinGeoCache;
  const pos = [], nrm = [], uv = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const ph = j / rings * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, rib = 1 - 0.09 * Math.abs(Math.sin(a * 4)) ** 0.6, s = Math.sin(ph), y = Math.cos(ph) * 0.72 * (j === 0 || j === rings ? 0.8 : 1);
      pos.push(Math.cos(a) * s * rib, y + 0.72, Math.sin(a) * s * rib); nrm.push(Math.cos(a) * s, Math.cos(ph), Math.sin(a) * s); uv.push(i / seg, j / rings);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), index: new Uint16Array(idx) };
  if (seg === 12 && rings === 6) pumpkinGeoCache = g;
  return g;
}
// a carved face for a pumpkin of radius r facing +z at its centre height: eyes, nose, a toothy grin (flat glow pieces)
const triGeo = (a, b, c) => ({ position: new Float32Array([...a, ...b, ...c]), normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), uv: new Float32Array(6), index: new Uint16Array([0, 1, 2]) });
export function jackFace(r = 0.4, style = 0) {
  const z = r * 0.97, y = 0.72 * r, k = r, out = [];
  const T3 = (a, b, c) => out.push({ geo: triGeo([a[0] * k, a[1] * k + y, z], [b[0] * k, b[1] * k + y, z], [c[0] * k, c[1] * k + y, z]) });
  if (style % 2) { T3([-0.5, 0.12], [-0.14, 0.12], [-0.32, 0.42]); T3([0.14, 0.12], [0.5, 0.12], [0.32, 0.42]); } else { T3([-0.5, 0.36], [-0.14, 0.12], [-0.42, 0.06]); T3([0.14, 0.12], [0.5, 0.36], [0.42, 0.06]); }
  T3([-0.09, -0.06], [0.09, -0.06], [0, 0.1]);
  const m = [[-0.55, -0.2], [-0.4, -0.3], [-0.3, -0.22], [-0.2, -0.36], [-0.08, -0.26], [0, -0.4], [0.08, -0.26], [0.2, -0.36], [0.3, -0.22], [0.4, -0.3], [0.55, -0.2]];
  for (let i = 0; i < m.length - 1; i++) T3([m[i][0], m[i][1]], [m[i + 1][0], m[i + 1][1]], [(m[i][0] + m[i + 1][0]) / 2, -0.52 + Math.abs(m[i][0] + m[i + 1][0]) * 0.22]);
  T3([-0.55, -0.2], [0.55, -0.2], [0, -0.52]);
  return out;
}
// a dead tree: a gnarled trunk splitting into bare, crooked branches (4-sided tubes); s ~ height / 10 m
export function deadTree(x, z, s = 1, rng = new RNG(5), o = {}) {
  const out = [], bark = o.bark || rng.pick(['#2e2824', '#3a322a', '#26221e']), y0 = o.y ?? 0, seg = o.lite ? 3 : 4;
  const limb = (p, dir, len, r, depth) => {
    const pts = [p], n = o.lite || depth < 1 ? 2 : 3; let q = p, d = dir;
    for (let i = 1; i <= n; i++) { d = M.v3norm([0, 0, 0], [d[0] + rng.range(-0.35, 0.35), d[1] + rng.range(-0.2, 0.25), d[2] + rng.range(-0.35, 0.35)]); q = [q[0] + d[0] * len / n, q[1] + d[1] * len / n, q[2] + d[2] * len / n]; pts.push(q); }
    out.push({ geo: G.tube(pts, t => r * (1 - t * 0.6), depth >= 2 ? seg : 3), color: c4(bark) });
    if (depth > 0) { const k = 2; for (let i = 0; i < k; i++) { const a = rng.range(0, Math.PI * 2), up = rng.range(0.2, 0.9); limb(q, M.v3norm([0, 0, 0], [d[0] * 0.5 + Math.cos(a), d[1] * 0.5 + up, d[2] * 0.5 + Math.sin(a)]), len * rng.range(0.55, 0.75), r * 0.55, depth - 1); } }
  };
  const lean = [rng.range(-0.25, 0.25), 1, rng.range(-0.25, 0.25)], h = 10 * s;
  const trunk = [[x, y0 - 0.3, z]]; let q = trunk[0];
  for (let i = 1; i <= 4; i++) { q = [q[0] + lean[0] * h * 0.14 + rng.range(-0.3, 0.3) * s, q[1] + h * 0.15, q[2] + lean[2] * h * 0.14 + rng.range(-0.3, 0.3) * s]; trunk.push(q); }
  out.push({ geo: G.tube(trunk, t => 0.42 * s * (1 - t * 0.55) * (t < 0.12 ? 1.4 - t * 3.3 : 1), o.lite ? 4 : 6), color: c4(bark) });
  const k = o.lite ? 3 : rng.int(3, 4);
  for (let i = 0; i < k; i++) { const a = i / k * Math.PI * 2 + rng.range(-0.4, 0.4), t = trunk[rng.int(2, 4)]; limb(t, M.v3norm([0, 0, 0], [Math.cos(a), rng.range(0.35, 1.0), Math.sin(a)]), h * rng.range(0.32, 0.45), 0.2 * s, o.lite ? 1 : 2); }
  return out;
}
// a tombstone (facing +z): kind 0 a rounded headstone, 1 a cross, 2 a little obelisk, 3 a flat-topped slab, 4 a winged one
export function tombstone(kind, s = 1, col = '#7a7684') {
  const out = [], P = (geo, m, hex = col) => out.push({ geo, matrix: m, color: c4(hex) });
  if (kind === 0) { P(G.box(0.62 * s, 0.7 * s, 0.16 * s), Tm(0, 0.35 * s, 0)); P(G.cylinder(0.31 * s, 0.31 * s, 0.16 * s, 7), mul(Tm(0, 0.7 * s, 0), Rx(Math.PI / 2), Ry(Math.PI / 14))); }
  else if (kind === 1) { P(G.box(0.14 * s, 1.2 * s, 0.14 * s), Tm(0, 0.6 * s, 0)); P(G.box(0.66 * s, 0.14 * s, 0.14 * s), Tm(0, 0.88 * s, 0)); }
  else if (kind === 2) { P(G.box(0.44 * s, 0.3 * s, 0.44 * s), Tm(0, 0.15 * s, 0)); P(G.cylinder(0.08 * s, 0.17 * s, 1.5 * s, 4, { y0: true }), mul(Tm(0, 0.3 * s, 0), Ry(Math.PI / 4))); }
  else if (kind === 3) { P(G.box(0.7 * s, 0.9 * s, 0.18 * s), Tm(0, 0.45 * s, 0)); P(G.box(0.8 * s, 0.1 * s, 0.24 * s), Tm(0, 0.92 * s, 0)); }
  else { P(G.box(0.5 * s, 0.85 * s, 0.16 * s), Tm(0, 0.42 * s, 0)); for (const sx of [-1, 1]) P(G.box(0.36 * s, 0.22 * s, 0.06 * s), mul(Tm(sx * 0.36 * s, 0.82 * s, 0), Rz(sx * 0.5))); P(gem(0.12 * s), Tm(0, 0.98 * s, 0)); }
  P(G.box(0.8 * s, 0.1 * s, 0.4 * s), Tm(0, 0.03, 0.05), '#5a5662');
  return out;
}

// a lightning flash from anywhere (the haunt streak's bolts): the town's update lights everything up with it
const FLASH = new WeakMap();
export function flashScene(scene, k = 1) { FLASH.set(scene, Math.max(FLASH.get(scene) || 0, k)); }

// ---- the town ----
// park: the park's own batches ({matte, metal, foliage, lamps}: what stands inside the park casts shadows with it).
// Returns {update(dt), lights, sky, flash(k), rideBurst(), toll(), graves, ...}: everything else here goes into batches of
// its own that cast no shadows (the shadow map only covers the courts)
let facades = null;
export function horrorTown(ctx, scene, rng, theme, park) {
  const town = [], siding = [], stone = [], glow = [], flick = [[], []], bulbs = [[], []], signs = [], pools = [], webs = [], corn = [];
  const put = (out, geo, m, hex) => out.push({ geo, matrix: m, color: c4(hex) });
  const gy = groundY;
  // a facade-mapped wall quad (local frame L), w wide, h high, its bottom at y0, facing the local +z turned by yaw
  const { bays, floors, bayW, floorH } = T.HFACADE, TW = bays * bayW, TH = floors * floorH;
  const wall = (out, L, x, y0, z, yaw, w, h, tint, ou = 0) => {
    const g = G.quad(w, h, { bottom: true });
    for (let i = 0; i < 4; i++) { g.uv[i * 2] = ou + (g.position[i * 3] + w / 2) / TW; g.uv[i * 2 + 1] = 1 - g.position[i * 3 + 1] / TH; }
    out.push({ geo: g, matrix: mul(L, TR(x, y0, z, yaw)), color: c4(tint) });
  };
  const tri3 = (a, b, c, hex) => ({ geo: { position: new Float32Array([...a, ...b, ...c]), normal: (() => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = M.v3norm([0, 0, 0], M.v3cross([0, 0, 0], u, v)); return new Float32Array([...n, ...n, ...n]); })(), uv: new Float32Array(6), index: new Uint16Array([0, 1, 2]) }, color: c4(hex) });
  // a gable roof over a w x d box whose walls top out at y (local frame, front at z 0, back at -d), ridge along z
  const gableRoof = (L, w, d, y, rise, hex, gableHex, trim) => {
    const ov = 0.5, half = w / 2 + ov, drop = rise * ov / (w / 2), len = Math.hypot(half, rise + drop);
    for (const s of [-1, 1]) {
      const ang = Math.atan2(rise + drop, half);
      put(town, G.box(len, 0.16, d + 0.9), mul(L, Tm(s * half / 2, y + rise - (rise + drop) / 2 + 0.08, -d / 2), Rz(-s * ang)), hex);
      if (trim) put(town, G.box(len, 0.22, 0.12), mul(L, Tm(s * half / 2, y + rise - (rise + drop) / 2 - 0.02, 0.42), Rz(-s * ang)), trim);
    }
    put(town, G.box(0.3, 0.22, d + 0.95), mul(L, Tm(0, y + rise + 0.1, -d / 2)), hex);
    for (const [zz, flip] of [[0, false], [-d, true]]) { const a = [-w / 2, y, zz], b = [w / 2, y, zz], c = [0, y + rise, zz]; const t = flip ? tri3(b, a, c, gableHex) : tri3(a, b, c, gableHex); t.geo = PR.bake([{ geo: t.geo, matrix: L }])[0].geo; town.push(t); }
  };
  // string lights along a line (sagging): two colours alternating into the two twinkle groups
  const string = (pts, cols = ['#ff8a1a', '#a24cff'], step = 0.42, sag = 0.18) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [a, b] = [pts[k], pts[k + 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(2, Math.round(len / step));
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, y = a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag; const g = (k * 31 + i) % 2; bulbs[g].push({ geo: BULB, matrix: TR(a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t), color: c4(cols[g]) }); }
    }
  };
  const pool = (x, z, r, hex, k = 1) => { const y = gy(x, z) + 0.04; pools.push({ geo: G.plane(r * 2, r * 2), matrix: TR(x, y, z), color: c4(hex).map((v, i) => (i < 3 ? v * k : 1)) }); };
  const PG = pumpkinGeo(), PGs = pumpkinGeo(8, 4), BULB = dot(0.06), BAR = bar(0.035, 1.8, 0.035), PICKET = bar(0.06, 0.95, 0.04), BALUSTER = bar(0.05, 0.9, 0.05);
  // a pumpkin of radius r on the ground at x, z (facing yaw); lit: a jack-o'-lantern (its face flickers)
  const pumpkin = (x, z, r, yaw = 0, lit = false, hex = '#e86a10', y = null, far = false) => {
    const yy = y ?? gy(x, z), L = TR(x, yy, z, yaw);
    town.push({ geo: far ? PGs : PG, matrix: mul(L, Sc(r, r * (0.8 + (x * 7 % 1 + 1) % 1 * 0.2), r)), color: c4(hex) });
    town.push({ geo: G.cylinder(0.04 * r * 2, 0.06 * r * 2, 0.22 * r * 2, 5, { y0: true }), matrix: mul(L, Tm(0, 1.4 * r, 0), Rz(0.2)), color: c4('#4a5a22') });
    if (lit) { for (const q of jackFace(r, (x * 3 | 0) & 1)) flick[(z * 5 | 0) & 1].push({ geo: q.geo, matrix: L, color: c4('#ffb347') }); if (far !== true) pool(x + Math.sin(yaw) * r * 1.2, z + Math.cos(yaw) * r * 1.2, r * 3.2, '#ff8a2a', 0.5); }
  };
  // a quarter cobweb with its corner at x, y, z (the texture's corner at the quad's top left; flip: top right)
  const web = (x, y, z, yaw, s, flip = false) => webs.push({ geo: G.quad(s, s), matrix: mul(TR(x, y, z, yaw), Sc(flip ? -1 : 1, 1, 1), Tm(s / 2, -s / 2, 0)), color: [0.5, 0.52, 0.6, 1] });
  const sign = (key, x, y, z, yaw, w, k = 1) => { const [u0, v0, uw, vh] = T.horrorSignUV(key), h = w / 8; const q = G.quad(w, h); for (let i = 0; i < 4; i++) { q.uv[i * 2] = u0 + q.uv[i * 2] * uw; q.uv[i * 2 + 1] = v0 + q.uv[i * 2 + 1] * vh; } signs.push({ geo: q, matrix: TR(x, y, z, yaw), color: [k, k, k, 1] }); put(town, G.box(w + 0.2, h + 0.2, 0.1), TR(x - Math.sin(yaw) * 0.07, y, z - Math.cos(yaw) * 0.07, yaw), '#1a1418'); };
  const lantern = (x, z, h = 3.4, hex = '#ffc870', pk = 0.6, poolHex = '#ffb060') => {
    const y = gy(x, z);
    put(town, G.cylinder(0.06, 0.09, h, 6, { y0: true }), TR(x, y, z), '#16141a');
    put(town, G.box(0.36, 0.08, 0.36), TR(x, y + h, z), '#16141a'); put(town, G.cylinder(0.02, 0.26, 0.3, 4, { y0: true }), mul(TR(x, y + h + 0.5, z), Ry(Math.PI / 4)), '#16141a');
    glow.push({ geo: G.box(0.24, 0.42, 0.24), matrix: TR(x, y + h + 0.27, z), color: c4(hex) });
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) put(town, G.box(0.03, 0.46, 0.03), TR(x + dx * 0.13, y + h + 0.27, z + dz * 0.13), '#16141a');
    pool(x, z, 4.2, poolHex, pk);
  };

  // ---------- Hollow Hill Cemetery ----------
  const C = CEMETERY;
  {
    // the iron fence: spear-topped bars between square posts, along the front and down both sides; the gate in the middle
    const iron = '#141218', bar = BAR, tip = G.cylinder(0.005, 0.05, 0.16, 4, { y0: true, open: true });
    const run = (x0, z0, x1, z1, gate = null) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 0.28), yaw = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, y = gy(x, z);
        if (gate !== null && Math.abs(x - gate) < 2.1) continue;
        if (i % 10 === 0) { put(town, G.box(0.16, 2.2, 0.16), TR(x, y + 1.1, z), iron); put(town, gem(0.12), TR(x, y + 2.32, z), iron); continue; }
        put(town, bar, TR(x, y + 0.9, z), iron); put(town, tip, TR(x, y + 1.8, z), iron);
      }
      for (const h of [0.3, 1.55]) for (let k = 0; k < Math.ceil(len / 12); k++) { const t0 = k * 12 / len, t1 = Math.min(1, (k + 1) * 12 / len), xa = x0 + (x1 - x0) * t0, za = z0 + (z1 - z0) * t0, xb = x0 + (x1 - x0) * t1, zb = z0 + (z1 - z0) * t1;
        if (gate !== null && Math.abs((xa + xb) / 2 - gate) < 6 && Math.min(xa, xb) < gate + 2.1 && Math.max(xa, xb) > gate - 2.1) {
          for (const [p, q] of [[Math.min(xa, xb), gate - 2.1], [gate + 2.1, Math.max(xa, xb)]]) if (q - p > 0.2) put(town, G.box(q - p, 0.05, 0.05), TR((p + q) / 2, gy((p + q) / 2, za) + h, za, 0), iron);
          continue;
        }
        put(town, G.box(0.05, 0.05, Math.hypot(xb - xa, zb - za)), TR((xa + xb) / 2, (gy(xa, za) + gy(xb, zb)) / 2 + h, (za + zb) / 2, yaw), iron); }
    };
    run(C.x0, C.fence, C.x1, C.fence, C.gate); run(C.x0, C.fence, C.x0, C.z1 + 2); run(C.x1, C.fence, C.x1, C.z1 + 2);
    // the gate: stone pillars with jack-o'-lanterns on them, an iron arch with the cemetery's name, one leaf open (it
    // swings: parklife creaks it), the other shut
    for (const s of [-1, 1]) { const x = C.gate + s * 2.3; put(town, G.box(0.8, 3.0, 0.8), TR(x, 1.5, C.fence), '#5a5662'); put(town, G.box(1.0, 0.2, 1.0), TR(x, 3.1, C.fence), '#4a4652'); pumpkin(x, C.fence, 0.32, Math.PI, true, '#e86a10', 3.2); }
    const arch = []; for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI; arch.push([C.gate - Math.cos(t) * 1.9, 3.4 + Math.sin(t) * 1.3, C.fence]); }
    town.push({ geo: G.tube(arch, 0.06, 5), color: c4(iron) });
    sign('HOLLOW HILL CEMETERY', C.gate, 4.0, C.fence - 0.05, Math.PI, 3.4, 0.75);
    for (let k = 0; k < 8; k++) put(town, bar, TR(C.gate + 0.12 + k * 0.24, 0.95, C.fence), iron); // the shut leaf (east)
    put(town, G.box(1.9, 0.06, 0.05), TR(C.gate + 1.0, 1.75, C.fence), iron); put(town, G.box(1.9, 0.06, 0.05), TR(C.gate + 1.0, 0.25, C.fence), iron);
    web(C.gate - 2.7, 2.9, C.fence + 0.42, 0, 1.0);
    // the headstones, in rough rows up the slope, all a little crooked; candles on a few; the open graves
    const taken = [[MAUSOLEUM.x, MAUSOLEUM.z, 6.5], [C.gate, 41, 2.6], ...GRAVES.map(([x, z]) => [x, z, 1.7])];
    const free = (x, z, r) => !taken.some(([a, b, rr]) => Math.hypot(a - x, b - z) < r + rr) && Math.abs(x - C.gate - (z - 38) * 0.35) > 1.8;
    const greys = ['#7a7684', '#6a6672', '#8a8690', '#5e6a5e', '#7a7a70', '#6a6060'];
    for (let z = C.z0 + 1.5; z < C.z1; z += rng.range(2.8, 3.6)) for (let x = C.x0 + 1.5; x < C.x1 - 1; x += rng.range(2.4, 3.8)) {
      const px = x + rng.range(-0.5, 0.5), pz = z + rng.range(-0.4, 0.4); if (!free(px, pz, 0.7) || rng.next() < 0.18) continue;
      const kind = rng.next() < 0.5 ? 0 : rng.int(1, 4), s = rng.range(0.85, 1.35), y = gy(px, pz);
      for (const q of tombstone(kind, s, rng.pick(greys))) town.push({ geo: q.geo, matrix: mul(TR(px, y, pz, rng.range(-0.25, 0.25)), Rz(rng.range(-0.14, 0.14)), Rx(rng.range(-0.12, 0.08)), q.matrix), color: q.color });
      taken.push([px, pz, 0.6]);
      if (rng.next() < 0.1) { glow.push({ geo: G.cylinder(0.035, 0.035, 0.16, 5, { y0: true }), matrix: TR(px + 0.3, y, pz + 0.35), color: c4('#fff0d0') }); flick[0].push({ geo: G.cylinder(0.005, 0.03, 0.08, 4, { y0: true }), matrix: TR(px + 0.3, y + 0.17, pz + 0.35), color: c4('#ffb347') }); }
    }
    for (const [x, z] of GRAVES) {
      const y = gy(x, z);
      put(town, G.sphere(1, 8, 5), mul(TR(x, y - 0.1, z), Sc(0.9, 0.32, 1.5)), '#2e241c');
      put(town, G.box(1.2, 0.04, 2.2), TR(x, y + 0.02, z, 0), '#120e0c');
      for (const q of tombstone(0, 1.1, '#6a6672')) town.push({ geo: q.geo, matrix: mul(TR(x, y, z - 1.7, 0.1), Rz(0.12), q.matrix), color: q.color });
    }
    put(town, G.box(0.05, 1.3, 0.05), mul(TR(GRAVES[1][0] + 0.8, gy(GRAVES[1][0], GRAVES[1][1]) + 0.5, GRAVES[1][1] + 0.6), Rz(0.3)), '#5a4630');
    put(town, G.box(0.25, 0.32, 0.03), mul(TR(GRAVES[1][0] + 1.0, gy(GRAVES[1][0], GRAVES[1][1]) + 0.05, GRAVES[1][1] + 0.6), Rz(0.3)), '#6a6a70'); // a shovel left in a mound
    // the path's lanterns
    for (const t of [0.25, 0.7]) { const z = 38 + (MAUSOLEUM.z - 4 - 38) * t, x = C.gate + (z - 38) * 0.35 + 1.4; lantern(x, z, 2.6, '#c8ff9a', 0.55, '#7cff4f'); }
    // the mausoleum: steps, four columns, a pediment, a bronze door ajar with green light in the gap
    const Mz = MAUSOLEUM, my = gy(Mz.x, Mz.z), ML = TR(Mz.x, my, Mz.z, Math.PI), mc = '#a49c8c';
    for (let k = 0; k < 3; k++) put(town, G.box(Mz.w + 1.6 - k * 0.4, 0.22, Mz.d + 1.6 - k * 0.4), mul(ML, Tm(0, 0.11 + k * 0.22, 0)), '#6a6672');
    put(town, G.box(Mz.w, Mz.h, Mz.d - 1.6), mul(ML, Tm(0, 0.66 + Mz.h / 2, -0.8)), mc);
    for (const sx of [-1.15, -0.4, 0.4, 1.15]) put(town, G.cylinder(0.2, 0.24, Mz.h, 8, { y0: true }), mul(ML, Tm(sx * Mz.w / 2.4, 0.66, Mz.d / 2 - 0.5)), '#a09ca8');
    put(town, G.box(Mz.w + 0.4, 0.45, Mz.d + 0.2), mul(ML, Tm(0, 0.66 + Mz.h + 0.22, 0)), mc);
    { const y = my + 0.66 + Mz.h + 0.45, zf = Mz.z + Mz.d / 2 + 0.1, zb = Mz.z - Mz.d / 2 - 0.1, hw = Mz.w / 2 + 0.2, r = 1.3;
      town.push(tri3([Mz.x - hw, y, zf], [Mz.x + hw, y, zf], [Mz.x, y + r, zf], mc), tri3([Mz.x + hw, y, zb], [Mz.x - hw, y, zb], [Mz.x, y + r, zb], mc));
      for (const s of [-1, 1]) { const ang = Math.atan2(r, hw), len = Math.hypot(hw, r); put(town, G.box(len + 0.2, 0.14, Mz.d + 0.4), mul(TR(Mz.x + s * hw / 2, y + r / 2, Mz.z), Rz(-s * ang)), '#6a6672'); } }
    put(town, G.box(1.0, 2.4, 0.1), mul(ML, Tm(-0.55, 0.66 + 1.2, Mz.d / 2 - 0.78), Ry(0.5)), '#3a4a3a'); put(town, G.box(1.0, 2.4, 0.1), mul(ML, Tm(0.55, 0.66 + 1.2, Mz.d / 2 - 0.8)), '#3a4a3a');
    glow.push({ geo: G.box(0.5, 2.3, 0.04), matrix: mul(ML, Tm(-0.05, 0.66 + 1.15, Mz.d / 2 - 0.84)), color: c4('#7cff4f') }); pool(Mz.x, Mz.z - Mz.d / 2 - 1.2, 2.4, '#7cff4f', 0.6);
    web(Mz.x + Mz.w / 2 + 0.1, my + 0.66 + Mz.h, Mz.z - Mz.d / 2 + 0.4, Math.PI, 1.1);
  }

  // ---------- the church and its bell tower (the bats live in the belfry), its front to the park ----------
  {
    const Cc = CHURCH, y = gy(Cc.x, Cc.z), L = TR(Cc.x, y, Cc.z - Cc.d / 2, Math.PI), tw = Cc.tower, sc = '#9a96a6';
    put(town, G.box(Cc.w + 0.4, 0.8, Cc.d + 0.4), mul(L, Tm(0, 0.4, -Cc.d / 2)), '#4a4652');
    for (const [x, z, yaw, w] of [[-Cc.w / 2, -Cc.d / 2, -Math.PI / 2, Cc.d], [Cc.w / 2, -Cc.d / 2, Math.PI / 2, Cc.d], [0, -Cc.d, Math.PI, Cc.w], [0, 0, 0, Cc.w]]) wall(stone, L, x, 0.8, z, yaw, w, Cc.h, sc, rng.range(0, 1));
    gableRoof(L, Cc.w, Cc.d, 0.8 + Cc.h, Cc.w * 0.75, '#22202a', sc, null);
    // the rose window in the front gable, the door under it
    const RL = mul(L, Tm(0, 0.8 + Cc.h + 2.4, 0.06));
    glow.push({ geo: G.cylinder(1.3, 1.3, 0.05, 16), matrix: mul(RL, Rx(Math.PI / 2)), color: c4('#a65cff') });
    for (let k = 0; k < 8; k++) put(town, G.box(0.08, 2.6, 0.06), mul(RL, Tm(0, 0, 0.04), Rz(k * Math.PI / 8)), '#2a2830');
    glow.push({ geo: G.cylinder(0.45, 0.45, 0.06, 10), matrix: mul(RL, Tm(0, 0, 0.02), Rx(Math.PI / 2)), color: c4('#ffb347') });
    put(town, G.box(2.0, 3.0, 0.12), mul(L, Tm(0, 0.8 + 1.5, 0.05)), '#2a1e16'); put(town, G.cylinder(1.0, 1.0, 0.13, 10), mul(L, Tm(0, 0.8 + 3.0, 0.05), Rx(Math.PI / 2)), '#2a1e16');
    glow.push({ geo: G.box(1.6, 0.5, 0.04), matrix: mul(L, Tm(0, 0.8 + 3.3, 0.12)), color: c4('#ffb347') });
    // the tower at the front's west corner: plain stone with courses, tall slits lit from inside, the belfry (dark arches,
    // the bell inside), pinnacles, the spire
    const ty = gy(tw.x, tw.z), TL = TR(tw.x, ty, tw.z - tw.s / 2, Math.PI);
    put(town, G.box(tw.s + 0.5, 0.8, tw.s + 0.5), mul(TL, Tm(0, 0.4, -tw.s / 2)), '#4a4652');
    put(town, G.box(tw.s, tw.h - 5, tw.s), mul(TL, Tm(0, 0.8 + (tw.h - 5) / 2, -tw.s / 2)), '#7a7684');
    for (let k = 1; k < 5; k++) put(town, G.box(tw.s + 0.2, 0.18, tw.s + 0.2), mul(TL, Tm(0, 0.8 + k * (tw.h - 5) / 5, -tw.s / 2)), '#5a5662');
    for (const [dx, dz, yaw] of [[0, 0.03, 0], [tw.s / 2 + 0.03, -tw.s / 2, Math.PI / 2], [-tw.s / 2 - 0.03, -tw.s / 2, -Math.PI / 2]]) for (const yy of [7.5, 12]) glow.push({ geo: G.box(0.35, 1.6, 0.04), matrix: mul(TL, Tm(dx, yy, dz), Ry(yaw)), color: c4(yy > 10 ? '#a65cff' : '#ffb347') });
    const by = ty + tw.h - 4.2;
    put(town, G.box(tw.s + 0.3, 0.4, tw.s + 0.3), TR(tw.x, by, tw.z), '#6a6672');
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) put(town, G.box(1.2, 3.6, 1.2), TR(tw.x + dx * (tw.s / 2 - 0.6), by + 2.0, tw.z + dz * (tw.s / 2 - 0.6)), sc);
    put(town, G.box(tw.s - 2.2, 3.6, tw.s - 2.2), TR(tw.x, by + 2.0, tw.z), '#0e0c12'); // the dark inside of the belfry
    town.push({ geo: G.lathe([[0.02, 0], [0.62, 0.05], [0.66, 0.3], [0.48, 0.9], [0.3, 1.1], [0.05, 1.15]], 10), matrix: TR(tw.x, by + 1.0, tw.z), color: c4('#8a6a2a') }); // the bell
    put(town, G.box(tw.s + 0.4, 0.5, tw.s + 0.4), TR(tw.x, by + 4.0, tw.z), '#6a6672');
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) put(town, G.cylinder(0.02, 0.32, 1.6, 4, { y0: true }), mul(TR(tw.x + dx * (tw.s / 2), by + 4.2, tw.z + dz * (tw.s / 2)), Ry(Math.PI / 4)), '#3a3842');
    put(town, G.cylinder(0.04, tw.s * 0.62, tw.spire, 4, { y0: true }), mul(TR(tw.x, by + 4.25, tw.z), Ry(Math.PI / 4)), '#22202a');
    const top = by + 4.25 + tw.spire; put(town, G.box(0.1, 1.6, 0.1), TR(tw.x, top + 0.7, tw.z), '#2a2830'); put(town, G.box(0.8, 0.1, 0.1), TR(tw.x, top + 1.0, tw.z), '#2a2830');
    for (let k = 0; k < 9; k++) { // bats roosting under the belfry's ledge
      const a = k / 9 * Math.PI * 2 + rng.range(-0.2, 0.2), r = tw.s / 2 + 0.22;
      put(town, G.box(0.08, 0.18, 0.08), TR(tw.x + Math.max(-r, Math.min(r, Math.cos(a) * r * 1.4)), by - 0.35, tw.z + Math.max(-r, Math.min(r, Math.sin(a) * r * 1.4))), '#0c0a0e');
    }
    put(town, G.box(1.8, 2.8, 0.12), mul(TL, Tm(0, 0.8 + 1.4, 0.04)), '#2a1e16');
    for (const s2 of [-1, 1]) glow.push({ geo: G.box(0.22, 0.34, 0.22), matrix: mul(TL, Tm(s2 * 1.5, 3.0, 0.3)), color: c4('#ffc870') });
    pool(tw.x, tw.z - tw.s / 2 - 2, 4, '#ffb060', 0.6); pool(Cc.x, Cc.z - Cc.d / 2 - 2, 4, '#ffb060', 0.5);
    web(tw.x + tw.s / 2 + 0.05, ty + 4.6, tw.z - tw.s / 2 - 0.05, Math.PI, 1.2);
  }

  // ---------- the folly: a round stone tower, its top broken off jagged, a dark doorway, a slit lit from inside ----------
  {
    const F = FOLLY, y = gy(F.x, F.z) - 0.4;
    put(town, G.cylinder(F.r * 0.92, F.r, F.h, 14, { y0: true }), TR(F.x, y, F.z), '#7a7684');
    for (let k = 1; k < 4; k++) put(town, G.cylinder(F.r + 0.08, F.r + 0.08, 0.2, 14, { y0: true }), TR(F.x, y + k * F.h / 4, F.z), '#5e5a66');
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, h = rng.range(0.3, 1.6) * (k % 3 === 2 ? 0.2 : 1); put(town, G.box(0.9, h, 0.5), TR(F.x + Math.cos(a) * (F.r - 0.25), y + F.h + h / 2, F.z + Math.sin(a) * (F.r - 0.25), -a + Math.PI / 2), '#6a6672'); }
    put(town, G.cylinder(F.r - 0.4, F.r - 0.4, 0.3, 12, { y0: true }), TR(F.x, y + F.h - 0.25, F.z), '#4a4652');
    put(town, G.box(1.2, 2.2, 0.3), TR(F.x, y + 1.1, F.z - F.r + 0.05, 0), '#0c0a10');
    glow.push({ geo: G.box(0.25, 1.1, 0.06), matrix: TR(F.x + 0.6, y + 6.5, F.z - F.r * 0.93, 0.25), color: c4('#ffb347') });
    for (let k = 0; k < 6; k++) put(town, G.box(rng.range(0.4, 0.9), rng.range(0.3, 0.6), rng.range(0.4, 0.8)), TR(F.x + rng.range(-3.5, 3.5), gy(F.x, F.z) + 0.1, F.z + rng.range(-3.5, 3.5), rng.range(0, 3)), '#6a6672'); // fallen stones
  }

  // ---------- the haunted mansion on the hill: a tall house, a round tower, a widow's walk, lit windows ----------
  const mansion = {};
  {
    const Mn = MANSION, y = gy(Mn.x, Mn.z) - 0.5, L = TR(Mn.x, y, Mn.z, Math.PI * 0.02), tint = '#5a5868';
    put(town, G.box(Mn.w + 1, 9.2, Mn.d + 1), mul(L, Tm(0, -3.4, -Mn.d / 2)), '#3a3842'); // (the foundation runs down into the slope)
    put(town, G.box(Mn.w + 6, 7, 6), mul(L, Tm(0, -3.2, 3.2)), '#2e2c34');
    const hm = 3 * floorH;
    for (const [x, z, yaw, w] of [[-Mn.w / 2, -Mn.d / 2, -Math.PI / 2, Mn.d], [Mn.w / 2, -Mn.d / 2, Math.PI / 2, Mn.d], [0, -Mn.d, Math.PI, Mn.w], [0, 0, 0, Mn.w]]) wall(siding, L, x, 1.2, z, yaw, w, hm, tint, rng.range(0, 1));
    // two front gables and the main hipped roof between them
    gableRoof(mul(L, Tm(-Mn.w / 2 + 4.5, 0, 0)), 9, Mn.d, 1.2 + hm, 6.2, '#1c1a22', '#4a4858', '#2a2830');
    gableRoof(mul(L, Tm(Mn.w / 2 - 4.5, 0, 0)), 9, Mn.d, 1.2 + hm, 6.2, '#1c1a22', '#4a4858', '#2a2830');
    put(town, G.box(Mn.w - 17, 3.2, Mn.d - 2), mul(L, Tm(0, 1.2 + hm + 1.6, -Mn.d / 2)), '#1c1a22');
    put(town, G.box(Mn.w - 16, 0.12, Mn.d - 1), mul(L, Tm(0, 1.2 + hm + 3.25, -Mn.d / 2)), '#2a2830');
    for (let k = 0; k < 9; k++) put(town, G.box(0.06, 0.8, 0.06), mul(L, Tm(-4.2 + k * 1.05, 1.2 + hm + 3.7, -1.6)), '#2a2830'); // the widow's walk
    put(town, G.box(9, 0.06, 0.06), mul(L, Tm(0, 1.2 + hm + 4.1, -1.6)), '#2a2830');
    for (const x of [-9, 3, 8]) put(town, G.box(1.1, 4.5, 1.1), mul(L, Tm(x, 1.2 + hm + 3.5, -Mn.d + 3)), '#3a3036'); // chimneys
    // the round tower at the front right corner, taller than the rest, its conical roof and a lightning rod
    const tr = 3.2, th = hm + 7.2, tg = G.cylinder(tr, tr, th, 16, { y0: true, open: true });
    for (let i = 0; i < tg.position.length / 3; i++) { const a = Math.atan2(tg.position[i * 3 + 2], tg.position[i * 3]); tg.uv[i * 2] = a * tr / TW; tg.uv[i * 2 + 1] = 1 - tg.position[i * 3 + 1] / TH; }
    siding.push({ geo: tg, matrix: mul(L, Tm(Mn.w / 2 - 1.2, 1.2, 0.6)), color: c4('#4e4c5c') });
    put(town, G.cylinder(0.05, tr + 0.5, 7.5, 16, { y0: true }), mul(L, Tm(Mn.w / 2 - 1.2, 1.2 + th, 0.6)), '#1c1a22');
    put(town, G.box(0.06, 3, 0.06), mul(L, Tm(Mn.w / 2 - 1.2, 1.2 + th + 8.5, 0.6)), '#2a2830');
    // the porch with its columns and the front door, light behind its glass
    put(town, G.box(10, 0.3, 3.2), mul(L, Tm(-1, 1.35, 1.6)), '#2a2830'); put(town, G.box(10.6, 0.25, 3.6), mul(L, Tm(-1, 4.6, 1.7)), '#1c1a22');
    for (const x of [-5.6, -2.6, 0.6, 3.6]) put(town, G.cylinder(0.16, 0.18, 3.2, 8, { y0: true }), mul(L, Tm(x, 1.5, 3.0)), '#d8d2c4');
    put(town, G.box(1.8, 2.8, 0.1), mul(L, Tm(-1, 1.5 + 1.4, 0.05)), '#1a1210'); glow.push({ geo: G.box(1.4, 0.5, 0.04), matrix: mul(L, Tm(-1, 4.25, 0.08)), color: c4('#ffb347') });
    // two lit windows on the first floor with silhouettes passing behind them now and then (parklife-free: town.update)
    const wins = [[-8.4, 1.2 + floorH + 1.0], [6.6, 1.2 + floorH + 1.0]];
    mansion.wins = wins.map(([x, wy]) => { glow.push({ geo: G.box(1.3, 2.0, 0.04), matrix: mul(L, Tm(x, wy + 1.0, 0.06)), color: c4('#ffb050') }); return { L: mul(L, Tm(x, wy, 0.1)), x }; });
    mansion.L = L;
    // the drive up the hill: lamps along it
    for (let k = 0; k < 5; k++) { const z = 72 + k * 11, x = Mn.x + Math.sin(k * 1.3) * 6; lantern(x + 2.4, z, 3.2, '#ffd890', 0.4); }
  }

  // ---------- the pumpkin patch, the scarecrows, the corn maze ----------
  {
    const P = PATCH;
    // a split-rail fence along its front, a gap with the sign
    for (let x = P.x0; x < P.x1 - 0.1; x += 3) {
      if (Math.abs(x + 1.5 - (P.x0 + P.x1) / 2) < 2) continue;
      for (const [dx] of [[0]]) put(town, G.box(0.14, 1.2, 0.14), TR(x + dx, 0.6, P.z0 - 0.5), '#4a3626');
      for (const yy of [0.45, 0.95]) put(town, G.box(3.0, 0.1, 0.08), mul(TR(x + 1.5, yy, P.z0 - 0.5), Rz(rng.range(-0.04, 0.04))), '#5a4430');
    }
    sign('PUMPKIN PATCH', (P.x0 + P.x1) / 2 + 3.4, 1.8, P.z0 - 0.6, Math.PI, 3.2, 0.7); put(town, G.box(0.12, 2.0, 0.12), TR((P.x0 + P.x1) / 2 + 1.9, 1.0, P.z0 - 0.5), '#4a3626'); put(town, G.box(0.12, 2.0, 0.12), TR((P.x0 + P.x1) / 2 + 4.9, 1.0, P.z0 - 0.5), '#4a3626');
    const spots = [];
    for (let i = 0; i < 74; i++) {
      const x = rng.range(P.x0 + 1, P.x1 - 1), z = rng.range(P.z0 + 1, P.z1 - 1); if (spots.some(([a, b, r]) => Math.hypot(a - x, b - z) < r + 0.6)) continue;
      const big = rng.next() < 0.08, r = big ? rng.range(0.7, 0.95) : rng.range(0.22, 0.45), lit = !big && z < P.z0 + 9 && rng.next() < 0.38;
      spots.push([x, z, r]); pumpkin(x, z, r, lit ? Math.PI + rng.range(-0.6, 0.6) : rng.range(0, 6), lit, rng.pick(['#e86a10', '#f07a18', '#d85a0c', '#e8a020']), null, !lit && !big);
      if (rng.next() < 0.5) town.push({ geo: G.tube([[x, 0.05, z], [x + rng.range(-1.5, 1.5), 0.08, z + rng.range(-1.5, 1.5)], [x + rng.range(-2.5, 2.5), 0.05, z + rng.range(-2.5, 2.5)]], 0.04, 3), color: c4('#3a4a1e') }); // vines
    }
    // hay bales by the gate, a giant pumpkin on top
    for (const [x, z, yy] of [[P.x0 + 3, P.z0 + 1.4, 0], [P.x0 + 4.4, P.z0 + 1.6, 0], [P.x0 + 3.7, P.z0 + 1.5, 0.55]]) put(town, G.box(1.2, 0.55, 0.7), TR(x, yy + 0.28, z, 0.1), '#b89a4a');
    pumpkin(P.x0 + 3.7, P.z0 + 1.5, 0.42, Math.PI, true, '#e86a10', 1.1);
    // the scarecrows: a post and crossbar, a stuffed shirt, a burlap head with a stitched grin, a hat, straw at the cuffs
    for (const [x, z, yaw] of [[P.x0 + 9, P.z0 + 8, 0.2], [P.x1 - 7, P.z0 + 11, -0.3]]) {
      const L = TR(x, 0, z, yaw), straw = '#c8a850';
      put(town, G.box(0.12, 3.0, 0.12), mul(L, Tm(0, 1.5, -0.1)), '#4a3626'); put(town, G.box(2.4, 0.1, 0.1), mul(L, Tm(0, 2.15, -0.1)), '#4a3626');
      put(town, G.box(0.6, 0.8, 0.32), mul(L, Tm(0, 1.95, 0)), '#6a3a5a'); put(town, G.box(2.0, 0.22, 0.24), mul(L, Tm(0, 2.17, 0)), '#6a3a5a');
      put(town, G.box(0.5, 0.5, 0.3), mul(L, Tm(0, 1.38, 0)), '#3a4a6a');
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) put(town, G.box(0.04, 0.3, 0.04), mul(L, Tm(s * (1.05 + k * 0.04), 2.05, 0.05 * k), Rz(s * (0.3 + k * 0.25))), straw);
      put(town, G.sphere(0.24, 8, 6), mul(L, Tm(0, 2.62, 0)), '#a8885a');
      for (const s of [-1, 1]) put(town, G.box(0.07, 0.07, 0.02), mul(L, Tm(s * 0.09, 2.68, 0.23)), '#141014');
      for (let k = -3; k <= 3; k++) put(town, G.box(0.03, k % 2 ? 0.06 : 0.02, 0.02), mul(L, Tm(k * 0.045, 2.53, 0.225)), '#141014');
      put(town, G.cylinder(0.42, 0.42, 0.04, 10), mul(L, Tm(0, 2.82, 0), Rz(0.15)), '#5a4428'); put(town, G.cylinder(0.04, 0.2, 0.46, 8, { y0: true }), mul(L, Tm(0, 2.82, 0), Rz(0.15), Rx(-0.2)), '#5a4428');
      town.push({ geo: G.box(0.05, 0.05, 0.05), matrix: mul(L, Tm(0.95, 2.45, 0.1)), color: c4('#0c0a0e') }); // a crow? (just a dark lump on the arm)
    }
    // the corn: rows of crossed quads (an alpha-tested picture of dry stalks); the maze's mouth, its sign
    for (let z = CORN.z0; z < CORN.z1; z += 1.5) for (let x = CORN.x0; x < CORN.x1; x += rng.range(1.0, 1.6)) {
      if (Math.abs(x - CORN.gap) < 2 && z < CORN.z0 + 12) continue;
      if (Math.hypot(x - CARNIVAL.wheel.x, z - CARNIVAL.wheel.z) < 18) continue;
      const y = gy(x, z), h = rng.range(2.3, 2.9), a = rng.range(0, Math.PI);
      for (const yaw of [a, a + Math.PI / 2]) {
        const q = G.quad(1.4, h, { bottom: true });
        if (rng.next() < 0.5) for (let v = 0; v < 4; v++) q.uv[v * 2] = 1 - q.uv[v * 2];
        corn.push({ geo: q, matrix: TR(x + rng.range(-0.3, 0.3), y - 0.05, z + rng.range(-0.3, 0.3), yaw), color: c4(rng.pick(['#c8b890', '#b8a880', '#d0c098']), 1) });
      }
    }
    sign('CORN MAZE', CORN.gap, 2.4, CORN.z0 - 0.7, Math.PI, 3.6, 0.7); for (const s of [-1, 1]) put(town, G.box(0.12, 2.6, 0.12), TR(CORN.gap + s * 1.7, gy(CORN.gap, CORN.z0) + 1.3, CORN.z0 - 0.6), '#4a3626');
  }

  // ---------- the abandoned carnival: the Ferris wheel, the carousel (skinned, they turn), the HAUNTED HOUSE ride ----------
  const K = CARNIVAL, wheelYaw = Math.atan2(-K.wheel.x, -K.wheel.z + 10);
  const ride = {};
  {
    // the wheel's legs (an A-frame either side) and its platform
    const W = K.wheel, WL = TR(W.x, 0, W.z, wheelYaw);
    for (const s of [-1, 1]) for (const f of [-1, 1]) put(town, G.box(0.35, Math.hypot(W.axle, 7.5), 0.35), mul(WL, Tm(f * 3.7, W.axle / 2, s * 1.6), Rz(-f * Math.atan2(7.4, W.axle))), '#3a3036');
    put(town, G.box(10, 0.5, 5), mul(WL, Tm(0, 0.25, 0)), '#4a4048'); put(town, G.box(2.2, 2.4, 2.2), mul(WL, Tm(5.4, 1.2, 0)), '#5a2a3a');
    // the carousel's base and the ride's facade are below; the arch and the ticket booth at the sidewalk
    const A = K.arch;
    for (const s of [-1, 1]) { put(town, G.box(0.5, 6.2, 0.5), TR(A.x, 3.1, A.z + s * 3.4), '#2a1a2e'); for (let k = 0; k < 6; k++) put(town, G.box(0.54, 0.4, 0.54), TR(A.x, 0.6 + k * 1.0, A.z + s * 3.4), k % 2 ? '#ff7a1a' : '#5a2a6a'); }
    put(town, G.box(0.4, 1.4, 7.6), TR(A.x, 6.6, A.z), '#2a1a2e');
    sign('MONSTER MASH', A.x - 0.25, 6.6, A.z, -Math.PI / 2, 7.2, 1.6);
    string([[A.x - 0.3, 5.9, A.z - 3.6], [A.x - 0.3, 5.9, A.z + 3.6]], ['#ff8a1a', '#7cff4f'], 0.3, 0.05);
    put(town, G.box(2.4, 2.6, 2.0), TR(A.x + 3, 1.3, A.z - 6.5), '#5a2a3a'); put(town, G.box(2.8, 0.25, 2.4), TR(A.x + 3, 2.75, A.z - 6.5), '#ff7a1a');
    sign('TICKETS', A.x + 1.75, 2.15, A.z - 6.5, -Math.PI / 2, 2.0, 1.2); glow.push({ geo: G.box(0.04, 0.8, 1.4), matrix: TR(A.x + 1.78, 1.25, A.z - 6.5), color: c4('#ffc870') });
    // striped tents with pennants
    for (const [x, z, r, h] of [[110, 10, 5, 7], [114, -8, 4, 6], [106, 56, 5.5, 7.5], [74, 40, 3.5, 5]]) {
      const n = 12, tent = G.cylinder(0.05, r, h * 0.55, n, { y0: true }), tc = new Float32Array(tent.position.length / 3 * 4);
      for (let i = 0; i < tent.position.length / 3; i++) { const a = Math.atan2(tent.position[i * 3 + 2], tent.position[i * 3]), stripe = Math.floor((a + Math.PI) / (Math.PI * 2) * n + 0.5) % 2; tc.set(c4(stripe ? '#ff7a1a' : '#3a1a4a'), i * 4); }
      tent.color = tc; town.push({ geo: tent, matrix: TR(x, h * 0.45, z) });
      put(town, G.cylinder(r, r, h * 0.45, n, { y0: true, open: true }), TR(x, 0, z), '#2a1830');
      put(town, G.box(0.05, 1.4, 0.05), TR(x, h + 0.6, z), '#2a2830'); put(town, G.box(0.02, 0.4, 0.7), TR(x, h + 1.0, z + 0.36), '#7cff4f');
    }
    // the HAUNTED HOUSE: a two-storey false front facing the park, a monster's face over the entrance (its eyes glow; the
    // doors are its mouth and burst open in an event), bulbs round the sign
    const R = K.ride, RL = TR(R.x, 0, R.z, -Math.PI / 2), face = '#6a2a6e';
    put(town, G.box(R.w + 1, R.h, R.d), mul(RL, Tm(0, R.h / 2, -R.d / 2)), '#3a2a3e');
    for (const s of [-1, 1]) for (const yy of [2.5, 7]) { pools.push({ geo: G.quad(4.5, 4.5), matrix: mul(RL, Tm(s * (R.w / 2 - 0.7), yy, 0.65)), color: c4(yy > 5 ? '#7cff4f' : '#ff7a1a').map((v, i) => (i < 3 ? v * 0.35 : 1)) }); }
    put(town, G.box(R.w + 1.4, 0.5, R.d + 0.4), mul(RL, Tm(0, R.h + 0.25, -R.d / 2)), '#1a0e1a');
    for (const s of [-1, 1]) { put(town, G.box(2.4, R.h + 3.5, 0.6), mul(RL, Tm(s * (R.w / 2 - 0.7), (R.h + 3.5) / 2, 0.3)), face); put(town, G.cylinder(0.05, 1.5, 3.4, 4, { y0: true }), mul(RL, Tm(s * (R.w / 2 - 0.7), R.h + 3.5, 0.3), Ry(Math.PI / 4)), '#1a0e1a'); }
    put(town, G.box(R.w - 4, 6.6, 0.4), mul(RL, Tm(0, 4.2 + 3.3, 0.2)), face);
    // the face: brow ridges, two big eyes (they glow: the ride's own material, strobed in its event), a nose, the fangs
    ride.eyes = [];
    for (const s of [-1, 1]) {
      put(town, G.box(2.6, 0.5, 0.5), mul(RL, Tm(s * 2.2, 9.3, 0.55), Rz(s * 0.25)), '#1a0e1a');
      put(town, G.sphere(1.05, 10, 8), mul(RL, Tm(s * 2.2, 8.0, 0.3), Sc(1, 0.8, 0.4)), '#1a0e1a');
      ride.eyes.push({ geo: G.sphere(0.8, 10, 8), matrix: mul(RL, Tm(s * 2.2, 8.0, 0.52), Sc(1, 0.7, 0.35)), color: c4('#ffe060') });
      ride.eyes.push({ geo: G.sphere(0.32, 8, 6), matrix: mul(RL, Tm(s * 2.0, 7.9, 0.78), Sc(0.6, 1, 0.3)), color: c4('#ff2a10') });
    }
    put(town, G.cylinder(0.1, 0.6, 1.2, 4, { y0: true }), mul(RL, Tm(0, 6.3, 0.55), Rx(0.6)), '#1a0e1a');
    for (let k = -3; k <= 3; k++) put(town, G.cylinder(0.02, 0.22, 0.9, 4, { y0: true }), mul(RL, Tm(k * 0.75, 4.7, 0.6), Rx(Math.PI)), '#f0e8d0'); // the fangs over the doorway
    put(town, G.box(6.4, 0.5, 0.7), mul(RL, Tm(0, 4.45, 0.35)), '#5a0a1a');
    put(town, G.box(5.8, 4.2, 0.2), mul(RL, Tm(0, 2.1, -0.2)), '#0a0608'); // the black doorway behind the doors
    ride.doorL = mul(RL, Tm(-2.7, 0, 0.12)); ride.doorR = mul(RL, Tm(2.7, 0, 0.12));
    sign('HAUNTED HOUSE', R.x + 0.45, R.h + 2.05, R.z, -Math.PI / 2, 9.8, 2.2);
    ride.bulbs = [];
    for (let k = 0; k <= 30; k++) { const a = -5.2 + k * 10.4 / 30; for (const yy of [R.h + 1.2, R.h + 2.9]) ride.bulbs.push({ geo: G.box(0.14, 0.14, 0.1), matrix: mul(RL, Tm(a, yy, 0.62)), color: c4(k % 2 ? '#ffe9a0' : '#ff7a1a') }); }
    for (let k = 0; k <= 10; k++) for (const s of [-1, 1]) ride.bulbs.push({ geo: G.box(0.14, 0.14, 0.1), matrix: mul(RL, Tm(s * (R.w / 2 - 0.7), 0.6 + k * (R.h + 2.6) / 10, 0.62)), color: c4(k % 2 ? '#7cff4f' : '#ff7a1a') });
    // the track out of the doorway and back in, a coffin car waiting
    for (const s of [-1, 1]) put(town, G.box(0.08, 0.06, 12), mul(RL, Tm(s * 0.55, 0.03, 6)), '#4a4a50');
    put(town, G.box(1.1, 0.5, 2.2), mul(RL, Tm(0, 0.45, 4)), '#2a1a12'); put(town, G.box(0.9, 0.12, 1.9), mul(RL, Tm(0, 0.72, 4)), '#5a0a1a');
    pool(R.x - 3, R.z, 6, '#ff7a1a', 0.5); pool(R.x - 2, R.z, 3.5, '#7cff4f', 0.4);
    web(R.x - 0.7, R.h + 3.6, R.z - R.w / 2 + 0.7, -Math.PI / 2, 1.4);
    // string lights round the carnival on poles
    const poles = [[68.5, -36], [68.5, -22], [68.5, -8], [68.5, 22], [68.5, 36], [80, 48], [96, 54], [112, 48], [122, 30], [122, 6], [120, -20], [108, -38], [90, -40], [74, -40]];
    for (const [x, z] of poles) put(town, G.box(0.18, 5.2, 0.18), TR(x, 2.6, z), '#2a2228');
    string(poles.map(([x, z]) => [x, 5.0, z]), ['#ff8a1a', '#7cff4f'], 0.5, 0.6);
  }

  // ---------- the street of Halloween houses to the south ----------
  const doors = [];
  {
    // the road and its kerbs: asphalt, a faded centre line; the sidewalk on the far side
    const S = STREET;
    put(town, G.box(2 * EXTENT, 0.03, S.z1 - S.z0), TR(0, -0.005, (S.z0 + S.z1) / 2), '#1e1e22');
    for (let x = -EXTENT + 3; x < EXTENT - 3; x += 7) put(town, G.box(3, 0.035, 0.14), TR(x, 0, (S.z0 + S.z1) / 2), '#8a8060');
    put(town, G.box(2 * EXTENT, 0.14, 0.25), TR(0, 0.07, S.z1 + 0.1), '#5a5a5e'); put(town, G.box(2 * EXTENT, 0.14, 0.25), TR(0, 0.07, S.z0 - 0.1), '#5a5a5e');
    put(town, G.box(2 * EXTENT, 0.1, 3.2), TR(0, 0.05, S.z0 - 1.85), '#4a4a50');
    put(town, G.box(2 * EXTENT, 0.04, S.walk[1] - S.walk[0] + 0.2), TR(0, 0.0, (S.walk[0] + S.walk[1]) / 2), '#4a4a52');
    const plan = [
      { x: -104, w: 12, d: 10, f: 2, tint: '#7a6a9a' }, { x: -82, w: 13, d: 11, f: 3, tint: '#5a7a6a', turret: 1 }, { x: -60, w: 12, d: 10, f: 2, tint: '#9a7a50' },
      { x: -38, w: 13, d: 11, f: 2, tint: '#6a5a7a' }, { x: -16, w: 13, d: 11, f: 3, tint: '#4a6a7a', turret: -1 }, { x: 6, w: 12, d: 10, f: 2, tint: '#8a5050' },
      { x: 25, w: 13, d: 11, f: 2, tint: '#7a7a62' }, { x: FUNERAL.x, w: FUNERAL.w, d: FUNERAL.d, f: 2, tint: '#34463c', funeral: 1 }, { x: 72, w: 12, d: 10, f: 2, tint: '#6a6a8a' },
      { x: 94, w: 14, d: 11, f: 3, tint: '#7a5a7a', turret: 1 }, { x: 118, w: 12, d: 10, f: 2, tint: '#5a6a5a' },
    ];
    for (const b of plan) {
      const z0 = S.yard - 5, L = TR(b.x, 0, z0, 0), H = b.f * floorH, rise = b.w * 0.42, roof = rng.pick(['#26222c', '#2a2026', '#1e2228']), trim = b.funeral ? '#c8c0b0' : '#efe8dc';
      put(town, G.box(b.w + 0.3, 0.6, b.d + 0.3), mul(L, Tm(0, 0.3, -b.d / 2)), '#4a4650');
      for (const [x, z, yaw, w] of [[-b.w / 2, -b.d / 2, -Math.PI / 2, b.d], [b.w / 2, -b.d / 2, Math.PI / 2, b.d], [0, -b.d, Math.PI, b.w], [0, 0, 0, b.w]]) wall(siding, L, x, 0.6, z, yaw, w, H, b.tint, rng.range(0, 1));
      gableRoof(L, b.w, b.d, 0.6 + H, rise, roof, M.mixRgb(lin(b.tint), [0, 0, 0], 0.15).concat(1), trim);
      glow.push({ geo: G.cylinder(0.55, 0.55, 0.05, 10), matrix: mul(L, Tm(0, 0.6 + H + rise * 0.42, 0.05), Rx(Math.PI / 2)), color: c4(rng.next() < 0.5 ? '#ffb050' : '#9aff7a') }); // the attic window
      put(town, G.box(1.0, 3.2, 1.0), mul(L, Tm(b.w * 0.25, 0.6 + H + rise * 0.6, -b.d * 0.7)), '#3a2e2e');
      if (b.turret) {
        const tr = 1.7, th = H + 2.6, tx = b.turret * (b.w / 2 - 0.4), tg = G.cylinder(tr, tr, th, 14, { y0: true, open: true });
        for (let i = 0; i < tg.position.length / 3; i++) { const a = Math.atan2(tg.position[i * 3 + 2], tg.position[i * 3]); tg.uv[i * 2] = a * tr / TW; tg.uv[i * 2 + 1] = 1 - tg.position[i * 3 + 1] / TH; }
        siding.push({ geo: tg, matrix: mul(L, Tm(tx, 0.6, 0.4)), color: c4(b.tint) });
        put(town, G.cylinder(0.04, tr + 0.35, 4.6, 14, { y0: true }), mul(L, Tm(tx, 0.6 + th, 0.4)), roof);
      }
      // the porch: floor, posts, roof, railing, steps, the door; string lights along it; jack-o'-lanterns on the steps
      const pw = Math.min(b.w - 1.5, 9), pz = 2.4;
      put(town, G.box(pw, 0.62, pz), mul(L, Tm(0, 0.31, pz / 2)), '#3a3038'); put(town, G.box(pw + 0.6, 0.14, pz + 0.5), mul(L, Tm(0, 3.6, pz / 2 + 0.1)), roof);
      for (const x of [-pw / 2 + 0.1, -1.2, 1.2, pw / 2 - 0.1]) put(town, G.box(0.16, 2.95, 0.16), mul(L, Tm(x, 0.62 + 1.47, pz - 0.15)), trim);
      for (const s of [-1, 1]) { put(town, G.box(pw / 2 - 1.3, 0.08, 0.08), mul(L, Tm(s * (pw / 4 + 0.6), 1.55, pz - 0.15)), trim); for (let x = 1.4; x < pw / 2 - 0.1; x += 0.36) put(town, BALUSTER, mul(L, Tm(s * x, 1.07, pz - 0.15)), trim); }
      for (let k = 0; k < 3; k++) put(town, G.box(2.2, 0.2, 0.4), mul(L, Tm(0, 0.1 + k * 0.2, pz + 1.0 - k * 0.38)), '#4a4048');
      put(town, G.box(1.1, 2.3, 0.08), mul(L, Tm(0, 0.62 + 1.15, 0.04)), b.funeral ? '#1a1414' : rng.pick(['#3a1a1a', '#1a2a1a', '#2a1a2a']));
      glow.push({ geo: G.box(0.9, 0.35, 0.04), matrix: mul(L, Tm(0, 3.0, 0.06)), color: c4(b.funeral ? '#c0a0ff' : '#ffb050') });
      glow.push({ geo: G.box(0.18, 0.28, 0.18), matrix: mul(L, Tm(0.95, 2.4, 0.2)), color: c4('#ffc870') });
      pool(b.x, z0 + pz + 0.8, 3.0, '#ffa040', 0.35);
      const P0 = M.v3transformMat4([0, 0, 0], [-pw / 2 - 0.3, 3.5, pz + 0.38], L), P1 = M.v3transformMat4([0, 0, 0], [pw / 2 + 0.3, 3.5, pz + 0.38], L);
      if (!b.funeral) {
        string([[P0[0], P0[1], P0[2]], [P1[0], P1[1], P1[2]]], undefined, 0.55);
        const g0 = M.v3transformMat4([0, 0, 0], [-b.w / 2 - 0.5, 0.6 + H - 0.2, 0.55], L), gt = M.v3transformMat4([0, 0, 0], [0, 0.6 + H + rise + 0.1, 0.55], L), g1 = M.v3transformMat4([0, 0, 0], [b.w / 2 + 0.5, 0.6 + H - 0.2, 0.55], L);
        string([[g0[0], g0[1], g0[2]], [gt[0], gt[1], gt[2]], [g1[0], g1[1], g1[2]]], ['#ff8a1a', '#ff8a1a'], 0.6, 0.06);
        for (const [x, r] of [[-1.25, 0.3], [1.3, 0.36], [1.75, 0.24]]) { const p = M.v3transformMat4([0, 0, 0], [x, 0, pz + 0.75], L); pumpkin(p[0], p[2], r, 0, true, '#e86a10', 0.2 + (x > 1.5 ? 0.2 : 0), 'cheap'); }
        for (const s of [-1, 1]) { const p = M.v3transformMat4([0, 0, 0], [s * (pw / 2 - 0.05), 3.45, pz - 0.12], L); web(p[0], p[1], p[2], 0, 0.9, s > 0); }
        // the front yard's decorations: little tombstones, a skeleton hand reaching out of the lawn
        for (const [dx, dz] of [[-4.2, 2.4], [-2.8, 3.3], [4.0, 2.9]]) for (const q of tombstone(rng.int(0, 3), 0.7, '#8a8690')) town.push({ geo: q.geo, matrix: mul(TR(b.x + dx, 0, z0 + dz, rng.range(-0.3, 0.3)), Rz(rng.range(-0.15, 0.15)), q.matrix), color: q.color });
      } else {
        // the funeral home: a porte-cochère on columns over the drive to its side, the sign on a post, lamps
        put(town, G.box(5, 0.3, 6), mul(L, Tm(b.w / 2 + 2.6, 3.8, 1.0)), roof); for (const [x, z] of [[b.w / 2 + 4.8, 3.8], [b.w / 2 + 4.8, -1.8]]) put(town, G.cylinder(0.18, 0.2, 3.7, 8, { y0: true }), mul(L, Tm(x, 0, z)), trim);
        sign('FUNERAL HOME', b.x - 5.5, 1.6, S.yard - 1.0, 0, 3.4, 0.8); for (const s of [-1, 1]) put(town, G.box(0.12, 2.1, 0.12), TR(b.x - 5.5 + s * 1.75, 1.05, S.yard - 1.0), '#1a1418');
        for (const s of [-1, 1]) lantern(b.x + s * 3.2, S.yard - 0.8, 2.2, '#d0b0ff', 0.4, '#a070ff');
      }
      // the picket fence along the yard's front, a gap at the path
      for (let x = -b.w / 2 - 2; x < b.w / 2 + 2; x += 0.34) { if (Math.abs(x) < 1.2) continue; put(town, PICKET, TR(b.x + x, 0.47, S.yard), b.funeral ? '#141216' : '#d8d2c4'); }
      for (const s of [-1, 1]) put(town, G.box(b.w / 2 + 0.8, 0.06, 0.05), TR(b.x + s * (b.w / 4 + 1.4), 0.75, S.yard), b.funeral ? '#141216' : '#d8d2c4');
      put(town, G.box(1.6, 0.03, S.yard - (z0 + pz + 1.4)), TR(b.x, 0.015, (S.yard + z0 + pz + 1.4) / 2), '#5a5660');
      doors.push({ x: b.x, z: z0 + pz + 1.3, rail: [b.x + pw / 2 - 0.6, 1.55, z0 + pz - 0.15], roof: [b.x, 0.6 + H + rise, z0 - b.d / 2], funeral: !!b.funeral, w: b.w });
    }
    // gas lamps along the sidewalk, sodium-orange pools under them
    for (let x = -120; x <= 120; x += 24) lantern(x + 12, S.z0 - 1.2, 3.8, '#ffb060', 0.55, '#ff9a40');
    // the hearse parked at the funeral home's kerb
    const hz = S.lanes[1].z - 0.6; for (const q of hearse()) town.push({ ...q, matrix: q.matrix ? mul(TR(FUNERAL.x + 4, 0, hz, -Math.PI / 2), q.matrix) : TR(FUNERAL.x + 4, 0, hz, -Math.PI / 2) });
    for (const q of hearseLights()) glow.push({ ...q, matrix: mul(TR(FUNERAL.x + 4, 0, hz, -Math.PI / 2), q.matrix || M.m4()), color: q.color.map((v, i) => (i < 3 ? v * 0.5 : v)) });
  }

  // ---------- the swamp and the witch's cottage ----------
  const cauldron = {};
  {
    // the dead cypresses standing in the water, moss hanging off them; reeds along the shore; lily pads; a dock and a boat
    for (let i = 0; i < 16; i++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 0.9, x = LAKE.x + Math.cos(a) * LAKE.rx * r, z = LAKE.z + Math.sin(a) * LAKE.rz * r;
      if (x > -90) continue;
      const parts = deadTree(x, z, rng.range(0.7, 1.15), rng, { y: LAKE.y - 0.4, bark: '#2a2a22' }); town.push(...parts);
      for (let k = 0; k < 4; k++) { const hx = x + rng.range(-3, 3), hz = z + rng.range(-3, 3), top = rng.range(5, 8); put(town, G.box(0.08, rng.range(1.2, 2.6), 0.02), TR(hx, top - 1, hz, rng.range(0, 3)), '#4a5a44'); }
    }
    for (let i = 0; i < 110; i++) {
      const a = rng.range(0, Math.PI * 2), x = LAKE.x + Math.cos(a) * LAKE.rx * rng.range(0.92, 1.06), z = LAKE.z + Math.sin(a) * LAKE.rz * rng.range(0.92, 1.06);
      if (x > -82 || !horrorClear(x, z, 1)) continue;
      const h = rng.range(0.8, 1.8), y = gy(x, z);
      put(town, bar(0.04, h, 0.04), mul(TR(x, y + h / 2 - 0.3, z), Rz(rng.range(-0.2, 0.2))), '#4a5a2e');
      if (rng.next() < 0.4) put(town, bar(0.07, 0.22, 0.07), TR(x, y + h - 0.24, z), '#3a2414');
    }
    for (let i = 0; i < 28; i++) {
      const x = LAKE.x + rng.range(-0.8, 0.8) * LAKE.rx, z = LAKE.z + rng.range(-0.8, 0.8) * LAKE.rz;
      if (((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2 > 0.7) continue;
      put(town, G.cylinder(rng.range(0.3, 0.6), rng.range(0.3, 0.6), 0.02, 7), TR(x, LAKE.y + 0.02, z), rng.pick(['#2a4a22', '#34522a']));
    }
    { const x0 = -92, z = 14; for (let k = 0; k < 6; k++) put(town, G.box(2.0, 0.12, 0.3), TR(x0 - 0.6 - k * 0.32 * 0 - 1, 0.2, z - 1.5 + k * 0.36 * 0 + k * 0.5), '#4a3a2a'); put(town, G.box(5.5, 0.12, 2.0), TR(x0 - 3.2, 0.25, z), '#4a3a2a'); for (const [dx, dz] of [[-0.5, -0.9], [-0.5, 0.9], [-5.5, -0.9], [-5.5, 0.9]]) put(town, G.box(0.18, 1.6, 0.18), TR(x0 + dx, -0.4, z + dz), '#3a2a1a');
      put(town, G.box(1.2, 0.45, 3.2), mul(TR(x0 - 4, LAKE.y + 0.18, z + 2.2, 0.3), Rz(0.05)), '#3a2a1e'); put(town, G.box(0.9, 0.06, 2.8), TR(x0 - 4, LAKE.y + 0.42, z + 2.2, 0.3), '#2a1e14'); }
    for (let z = -28; z <= 28; z += 14) lantern(-79.5, z, 2.8, '#c8ff9a', 0.45, '#7cff4f');
    // will-o'-wisps hanging over the water, a green sheen under each (so the dark water reads as water from the plaza)
    for (const [u, v] of [[0.55, -0.2], [0.3, 0.45], [-0.1, 0.1], [0.62, 0.5], [0.2, -0.6], [-0.45, -0.3]]) {
      const x = LAKE.x + u * LAKE.rx, z = LAKE.z + v * LAKE.rz, y = LAKE.y + 1.1 + (u * 7 % 1 + 1) % 1 * 0.6;
      flick[(u * 10 | 0) & 1].push({ geo: gem(0.16), matrix: TR(x, y, z), color: c4('#c8ffb0') });
      pools.push({ geo: G.plane(7, 7), matrix: TR(x, LAKE.y + 0.03, z), color: c4('#7cff4f').map((c, i) => (i < 3 ? c * 0.45 : 1)) });
    }
    // the cottage: a crooked little house, its roof sagging, a round window glowing green, a leaning stone chimney; the
    // cauldron over a fire in front of it (bubbling: town.update), a broom by the door, potions on a stump
    const Co = COTTAGE, y = gy(Co.x, Co.z), L = mul(TR(Co.x, y, Co.z, Co.yaw), Rz(0.04));
    put(town, G.box(7, 0.5, 6), mul(L, Tm(0, 0.25, -3)), '#4a4652');
    put(town, G.box(7, 1.4, 6), mul(L, Tm(0, 1.2, -3)), '#6a6470'); put(town, G.box(7.1, 1.6, 6.1), mul(L, Tm(0, 2.7, -3)), '#4a3a2e');
    for (const x of [-3.4, -1.2, 1.2, 3.4]) put(town, G.box(0.18, 1.7, 0.1), mul(L, Tm(x, 2.7, 0.06)), '#2a1e16');
    put(town, G.box(7.2, 0.16, 0.12), mul(L, Tm(0, 1.95, 0.06)), '#2a1e16'); put(town, G.box(7.2, 0.16, 0.12), mul(L, Tm(0, 3.45, 0.06)), '#2a1e16');
    gableRoof(mul(L, Rz(-0.06)), 7, 6, 3.5, 4.2, '#2a3022', '#5a5040', '#3a2e22');
    put(town, G.box(1.1, 6.5, 1.1), mul(L, Tm(-2.4, 3.2, -4.5), Rz(0.12)), '#5a5462');
    put(town, G.box(1.2, 2.3, 0.1), mul(L, Tm(1.4, 0.5 + 1.15, 0.05)), '#2a1e16');
    glow.push({ geo: G.cylinder(0.55, 0.55, 0.06, 12), matrix: mul(L, Tm(-1.6, 2.2, 0.06), Rx(Math.PI / 2)), color: c4('#7cff4f') });
    glow.push({ geo: G.cylinder(0.4, 0.4, 0.06, 10), matrix: mul(L, Tm(0, 3.5 + 2.2, 0.06), Rx(Math.PI / 2)), color: c4('#c8ff7a') });
    put(town, G.box(0.05, 1.7, 0.05), mul(L, Tm(2.5, 0.85, 0.35), Rz(-0.25)), '#5a4428'); put(town, G.cylinder(0.02, 0.22, 0.6, 7, { y0: true }), mul(L, Tm(2.29, 0.0, 0.35), Rz(-0.25)), '#a88a4a');
    const cx = Co.cauldron.x, cz = Co.cauldron.z, cy = gy(cx, cz);
    town.push({ geo: G.lathe([[0.02, 0], [0.55, 0.08], [0.78, 0.4], [0.74, 0.8], [0.66, 0.92], [0.7, 0.98]], 14), matrix: TR(cx, cy + 0.32, cz), color: c4('#141216') });
    for (let k = 0; k < 3; k++) put(town, G.box(0.08, 0.5, 0.08), mul(TR(cx + Math.cos(k * 2.1) * 0.55, cy + 0.2, cz + Math.sin(k * 2.1) * 0.55), Rz(0.2)), '#141216');
    for (let k = 0; k < 5; k++) put(town, G.cylinder(0.07, 0.07, 1.0, 5), mul(TR(cx, cy + 0.08, cz, k * 0.65), Rz(Math.PI / 2)), '#3a2414');
    cauldron.x = cx; cauldron.y = cy + 1.24; cauldron.z = cz;
    flick[1].push({ geo: G.cylinder(0.62, 0.62, 0.04, 14), matrix: TR(cx, cy + 1.2, cz), color: c4('#7cff4f') });
    for (let k = 0; k < 6; k++) flick[0].push({ geo: G.cylinder(0.01, 0.16, rng.range(0.35, 0.6), 5, { y0: true }), matrix: TR(cx + Math.cos(k) * 0.32, cy + 0.06, cz + Math.sin(k) * 0.32), color: c4(k % 2 ? '#ff9a2a' : '#ffd060') });
    pool(cx, cz, 5, '#7cff4f', 0.7); pool(cx, cz, 2.4, '#ff9a2a', 0.5);
    { const sx = cx + 2.2, sz = cz - 1.0; put(town, G.cylinder(0.45, 0.5, 0.7, 8, { y0: true }), TR(sx, gy(sx, sz), sz), '#4a3a28'); for (let k = 0; k < 4; k++) glow.push({ geo: G.cylinder(0.07, 0.09, 0.26, 6, { y0: true }), matrix: TR(sx + Math.cos(k * 1.6) * 0.22, gy(sx, sz) + 0.7, sz + Math.sin(k * 1.6) * 0.22), color: c4(['#7cff4f', '#c040ff', '#ff4a2a', '#40c0ff'][k]) }); }
  }

  // ---------- dead trees everywhere, and the far ring of them on the hills ----------
  {
    const spots = [[-38, 44, 1.1], [-26, 60, 1.25], [16, 62, 0.9], [-8, 48, 0.75], [20, 42, 0.8], [-62, 42, 1.0], [-74, 30, 0.9], [-70, -34, 0.95], [-84, -18, 0.85], [-80, 26, 0.8], [66, -44, 0.8], [-122, -40, 1.1], [130, -36, 1.0], [126, 18, 1.1], [62, 64, 0.9], [-30, 96, 1.0], [40, 100, 1.1], [-60, 110, 1.2], [70, 118, 1.0], [-90, 80, 1.1]];
    for (const [x, z, s] of spots) { if (!horrorClear(x, z, 2) || onSomething(x, z, 3)) continue; town.push(...deadTree(x, z, s, rng, { y: gy(x, z) })); }
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2 + rng.range(-0.03, 0.03), d = rng.range(150, 225), x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d;
      town.push(...deadTree(x, z, rng.range(0.9, 1.6), rng, { y: gy(x, z), lite: true, bark: '#1e1c1c' }));
    }
    // bats roosting under the biggest branches
    for (let i = 0; i < 12; i++) { const [x, z] = spots[i % 6], y = gy(x, z) + rng.range(6, 9); put(town, G.box(0.1, 0.22, 0.08), TR(x + rng.range(-2.5, 2.5), y, z + rng.range(-2.5, 2.5)), '#0c0a0e'); }
  }

  // ---------- inside the park: braziers of green fire and piles of jack-o'-lanterns in the corners no camera crosses ----------
  {
    for (const [x, z] of [[-13, -33.4], [13, -33.4], [30, -33.4], [-46, -33.2], [46, -33.2], [-13, 27.5], [13, 27.5], [-39, 26], [39, 26]]) {
      park.metal.push({ geo: G.cylinder(0.07, 0.11, 1.15, 7, { y0: true }), matrix: TR(x, 0, z), color: c4('#18161c') });
      for (let k = 0; k < 3; k++) park.metal.push({ geo: G.box(0.05, 0.6, 0.05), matrix: mul(TR(x + Math.cos(k * 2.1) * 0.18, 0.28, z + Math.sin(k * 2.1) * 0.18), Rz(0.3)), color: c4('#18161c') });
      park.metal.push({ geo: G.lathe([[0.1, 0], [0.42, 0.06], [0.5, 0.3], [0.46, 0.36]], 10), matrix: TR(x, 1.15, z), color: c4('#2a2830') });
      flick[1].push({ geo: G.cylinder(0.03, 0.36, 0.7, 7, { y0: true }), matrix: TR(x, 1.45, z), color: c4('#7cff4f') });
      flick[0].push({ geo: G.cylinder(0.02, 0.2, 1.0, 6, { y0: true }), matrix: TR(x, 1.45, z), color: c4('#d0ffb0') });
      pool(x, z, 4.5, '#7cff4f', 0.55);
    }
    for (const [x, z, n] of [[21, -33.2, 3], [-6.5, 28.5, 3], [6.5, 28.5, 2], [-50, 27.5, 3], [50, 27.5, 3], [-32, -33.2, 2]]) for (let k = 0; k < n; k++) {
      const px = x + (k - (n - 1) / 2) * 0.8, r = 0.28 + (k % 2) * 0.1, L = TR(px, 0, z, 0);
      park.matte.push({ geo: PG, matrix: mul(L, Sc(r, r * 0.9, r)), color: c4('#e86a10') });
      park.matte.push({ geo: G.cylinder(0.03, 0.05, 0.16, 5, { y0: true }), matrix: mul(L, Tm(0, 1.4 * r, 0)), color: c4('#4a5a22') });
      for (const q of jackFace(r, k)) flick[k % 2].push({ geo: q.geo, matrix: mul(L, Ry(z > 0 ? Math.PI : 0)), color: c4('#ffb347') });
    }
    // (glow pools under the plaza's street lamps: sodium orange)
    for (let i = 0; i < 10; i++) if (!plazaLampOff(-40 + i * 9)) pool(-40 + i * 9 + 0.5, -27, 3.6, '#ff9a40', 0.35); // (v0.4.8.8: none where the Pro-Am HUB stands)
  }

  // ---------- materials and meshes ----------
  const add = (parts, mat, o = {}) => { if (!parts.length) return null; const m = new Mesh(ctx.geometry(G.merge(PR.bake(parts))), mat, { castShadow: false, reflect: false, ...o }); scene.add(m); return m; };
  const FS = facades?.s || (facades = { s: T.horrorFacade({ kind: 'siding', seed: 66, lit: 0.42 }), t: T.horrorFacade({ kind: 'stone', seed: 23, lit: 0.55 }) }).s, FT = facades.t;
  add(siding, new Material({ map: cachedTexture(ctx, 'hf-s-c', () => FS.color, { aniso: 8 }), emissiveMap: cachedTexture(ctx, 'hf-s-e', () => FS.emissive, { aniso: 8 }), emissive: [2.4, 1.8, 1.2], roughness: 0.85 }));
  add(stone, new Material({ map: cachedTexture(ctx, 'hf-t-c', () => FT.color, { aniso: 8 }), emissiveMap: cachedTexture(ctx, 'hf-t-e', () => FT.emissive, { aniso: 8 }), emissive: [2.2, 2.0, 2.0], roughness: 0.9 }));
  add(town, new Material({ color: [1, 1, 1], roughness: 0.82, specular: 0.6 }));
  const unlit = (k, o = {}) => new Material({ color: [k, k, k], shading: 'unlit', fog: false, ...o });
  add(glow, unlit(1.8));
  const mFlick = [unlit(2.2), unlit(2.2)]; flick.forEach((l, i) => add(l, mFlick[i]));
  const mBulb = [unlit(2.4), unlit(2.4)]; bulbs.forEach((l, i) => add(l, mBulb[i]));
  add(signs, new Material({ map: cachedTexture(ctx, 'horrorsigns', () => T.horrorSigns(), { aniso: 8 }), color: [1, 1, 1], shading: 'unlit', fog: false }), { order: 1 });
  const mPools = new Material({ map: cachedTexture(ctx, 'glowspot', () => T.glowSpot(128, 1.6), { wrap: 'clamp' }), color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
  add(pools, mPools, { order: 2 });
  add(webs, new Material({ map: cachedTexture(ctx, 'cobweb', () => T.cobweb(), { wrap: 'clamp' }), color: [0.9, 0.9, 1], shading: 'unlit', blend: 'add', depthWrite: false, doubleSided: true }), { order: 3 });
  add(corn, new Material({ map: cachedTexture(ctx, 'cornstalks', () => T.cornStalks(), { wrap: 'clamp' }), alphaTest: 0.5, doubleSided: true, roughness: 0.9, shading: 'cloth', sheen: [0.04, 0.04, 0.03] }));
  const mRide = unlit(2.2); add(ride.eyes, mRide); const mRideBulbs = unlit(2.6); add(ride.bulbs, mRideBulbs);
  // the swamp's water: dark, glossy, its normals drifting
  const wn = cachedTexture(ctx, 'waterN2', () => T.waterNormal({ seed: 41 }), { srgb: false });
  const lake = G.plane(LAKE.rx * 2.6, LAKE.rz * 2.6, 1, 1); for (let i = 0; i < lake.uv.length; i += 2) { lake.uv[i] *= LAKE.rx * 2.6 / 7; lake.uv[i + 1] *= LAKE.rz * 2.6 / 7; }
  const mWater = new Material({ color: lin('#0e1a16'), normalMap: wn, normalScale: 0.45, roughness: 0.06, specular: 1.6, metalness: 0.05, emissive: [0.03, 0.055, 0.05] }); // (a murky green glow: it reads as water in the dark)
  const water = new Mesh(ctx.geometry(lake), mWater, { castShadow: false, reflect: false }); M.m4translation(water.matrix, LAKE.x, LAKE.y, LAKE.z); water.order = 1; scene.add(water);
  const sky = horrorSky(ctx, scene, theme), fog = groundFog(ctx, scene);
  // the moving parts: the Ferris wheel, the carousel, the ride's doors, the cemetery gate, the mansion's silhouettes
  const movers = carnivalRides(ctx, scene, wheelYaw, ride);
  const gateMesh = new Mesh(ctx.geometry(G.merge(PR.bake([...Array.from({ length: 8 }, (_, k) => ({ geo: G.box(0.035, 1.8, 0.035), matrix: Tm(-0.12 - k * 0.24, 0.95, 0), color: c4('#141218') })), ...[0.25, 1.75].map(yy => ({ geo: G.box(1.95, 0.06, 0.05), matrix: Tm(-1.0, yy, 0), color: c4('#141218') }))]))), new Material({ color: [1, 1, 1], roughness: 0.7, metalness: 0.4 }), { castShadow: false, reflect: false });
  scene.add(gateMesh);
  const silMat = new Material({ color: [0.02, 0.015, 0.02], shading: 'unlit', fog: false });
  const sil = mansion.wins.map(w => { const m = new Mesh(ctx.geometry(G.merge(PR.bake([{ geo: G.box(0.34, 0.75, 0.02), matrix: Tm(0, 0.9, 0), color: [1, 1, 1, 1] }, { geo: G.sphere(0.15, 8, 6), matrix: Tm(0, 1.45, 0), color: [1, 1, 1, 1] }, { geo: G.box(0.5, 0.18, 0.02), matrix: Tm(0, 1.2, 0), color: [1, 1, 1, 1] }]))), silMat, { castShadow: false, reflect: false }); scene.add(m); return { m, w, t: rng.range(0, 20), dir: 1 }; });

  // ---- the town's life: flicker, twinkle, the cauldron bubbling, the fog and the water drifting, the clouds turning,
  // the gate swinging, the rides turning, lightning flashes (parklife's storm and the haunt streak call flash()) ----
  let t = rng.range(0, 30), flash = 0, burst = 0;
  const baseExp = scene.exposure, baseDome = [...sky.domeMat.color], baseCloud = [...sky.cloudMat.color], baseHalo = [...sky.haloMat.color];
  const set = (m, k) => { m.color[0] = m.color[1] = m.color[2] = k; };
  const fl = (s, a) => 0.78 + 0.12 * Math.sin(t * 9.1 + s) + 0.08 * Math.sin(t * 23.7 + s * 3) + a * (Math.random() - 0.5);
  return {
    sky, lights: [], doors, ride, cauldron, mansion, gate: { x: CEMETERY.gate, z: CEMETERY.fence }, wheelYaw,
    get t() { return t; },
    // a lightning flash: everything lit up (exposure), the sky and the clouds bright for a moment
    flash(k = 1) { flash = Math.max(flash, k); },
    // the haunted house ride's doors burst open and its lights strobe (parklife's event)
    rideBurst() { burst = 9; },
    get bursting() { return burst > 0; },
    update(dt, r) {
      t += dt; const rParticles = r?.particles;
      flash = Math.max(0, flash - dt * 2.6, FLASH.get(scene) || 0); FLASH.set(scene, 0);
      scene.exposure = baseExp * (1 + 0.9 * flash);
      sky.domeMat.color = baseDome.map(v => v * (1 + 3.5 * flash)); sky.cloudMat.color = baseCloud.map(v => v * (1 + 5 * flash));
      sky.haloMat.color = baseHalo.map(v => v * (0.92 + 0.08 * Math.sin(t * 0.4)));
      M.m4fromYaw(sky.clouds.matrix, 0, 0, 0, t * 0.004);
      set(mFlick[0], 2.2 * fl(0, 0.12)); set(mFlick[1], 2.3 * fl(2, 0.1));
      const tw = Math.sin(t * 1.7); set(mBulb[0], 2.2 + 0.6 * tw); set(mBulb[1], 2.2 - 0.6 * tw);
      for (const [m, [su, sv]] of fog) { m.uvOffset[0] = (m.uvOffset[0] + su * dt) % 1; m.uvOffset[1] = (m.uvOffset[1] + sv * dt) % 1; }
      mWater.uvOffset[0] = (mWater.uvOffset[0] + 0.006 * dt) % 1; mWater.uvOffset[1] = (mWater.uvOffset[1] + 0.009 * dt) % 1;
      // the gate's open leaf drifts in the wind
      M.m4mul(gateMesh.matrix, TR(CEMETERY.gate - 0.05, 0, CEMETERY.fence, 0), Ry(1.1 + Math.sin(t * 0.7) * 0.12 + Math.sin(t * 2.3) * 0.03));
      // the cauldron bubbles
      if (Math.random() < dt * 7 && rParticles) rParticles.emit({ x: cauldron.x + (Math.random() - 0.5) * 0.8, y: cauldron.y, z: cauldron.z + (Math.random() - 0.5) * 0.8, vy: 0.6 + Math.random() * 0.5, life: 1.6, size: 0.09 + Math.random() * 0.06, color: [0.5, 2.4, 0.4], gravity: 0.1, drag: 0.6, flick: 2 });
      if (Math.random() < dt * 2.5 && rParticles) rParticles.emit({ x: cauldron.x, y: cauldron.y + 0.3, z: cauldron.z, vx: 0.2, vy: 0.5, life: 4, size: 0.5, color: [0.06, 0.16, 0.05], gravity: 0.08, drag: 0.3, grow: 2.5 });
      // the haunted house's eyes pulse; in a burst they strobe and its bulbs chase
      burst = Math.max(0, burst - dt);
      if (burst > 0) { const s = Math.floor(t * 12) % 2; set(mRide, s ? 4.5 : 0.4); set(mRideBulbs, s ? 0.3 : 4); movers.doors(Math.min(1, (9 - burst) * 3) * Math.min(1, burst * 1.2)); }
      else { set(mRide, 1.8 + 0.5 * Math.sin(t * 1.3)); set(mRideBulbs, 2.4 + 0.5 * Math.sin(t * 5)); movers.doors(0); }
      movers.update(dt, t);
      // a figure passes behind one of the mansion's windows now and then
      for (const s of sil) { s.t += dt; const cyc = s.t % 24, k = cyc < 6 ? cyc / 6 : -1; s.m.visible = k >= 0; if (k >= 0) s.m.matrix.set(mul(s.w.L, Tm(-0.8 + k * 1.6, 0, 0))); }
    },
  };
}

// ---- skinning: one mesh moves many rigid pieces, a bone each (shaders.js SKINNED: up to 24 bones, world matrices) ----
// parts: [{geo, matrix?, color, bone}] → one geometry with joints / weights
export function skinGeo(parts) {
  const baked = PR.bake(parts), g = G.merge(baked), n = g.position.length / 3, joints = new Float32Array(n * 4), weights = new Float32Array(n * 4);
  let v = 0;
  parts.forEach((p, i) => { const k = baked[i].geo.position.length / 3; for (let j = 0; j < k; j++) { joints[(v + j) * 4] = p.bone || 0; weights[(v + j) * 4] = 1; } v += k; });
  g.joints = joints; g.weights = weights;
  return g;
}
const bonesOf = n => new Float32Array(16 * n);
const setBone = (bones, i, m) => bones.set(m, i * 16);

// ---- the carnival's rides ----
function carnivalRides(ctx, scene, wheelYaw, ride) {
  const lit = new Material({ color: [1, 1, 1], roughness: 0.6, metalness: 0.3 }), bulbMat = new Material({ color: [2.4, 2.4, 2.4], shading: 'unlit', fog: false });
  const mk = (parts, mat, nb, bounds) => { const m = new Mesh(ctx.geometry(skinGeo(parts)), mat, { castShadow: false, reflect: false, bones: bonesOf(nb), bounds }); scene.add(m); return m; };
  // the Ferris wheel: bone 0 the wheel (rims, spokes, hub, its bulbs), bones 1..16 the gondolas, hanging level
  const W = CARNIVAL.wheel, R = W.r, NG = 16, wp = [], wb = [];
  for (const z of [-0.9, 0.9]) { wp.push({ geo: G.torus(R, 0.13, 64, 5), matrix: mul(Tm(0, 0, z), Rx(Math.PI / 2)), color: c4('#7a6a72'), bone: 0 }); wp.push({ geo: G.torus(R * 0.55, 0.08, 40, 4), matrix: mul(Tm(0, 0, z), Rx(Math.PI / 2)), color: c4('#6a5a62'), bone: 0 }); }
  for (let i = 0; i < NG; i++) {
    const a = i / NG * Math.PI * 2;
    for (const z of [-0.9, 0.9]) wp.push({ geo: G.box(R, 0.1, 0.1), matrix: mul(Tm(0, 0, z), Rz(a), Tm(R / 2, 0, 0)), color: c4('#8a7a82'), bone: 0 });
    wp.push({ geo: G.box(0.1, 0.1, 1.8), matrix: mul(Rz(a), Tm(R, 0, 0)), color: c4('#8a7a82'), bone: 0 });
    for (let k = 1; k <= 5; k++) for (const z of [-0.95, 0.95]) wb.push({ geo: G.box(0.16, 0.16, 0.12), matrix: mul(Tm(0, 0, z), Rz(a), Tm(R * k / 5.4, 0.12, 0)), color: c4(k % 2 ? '#ff8a1a' : (i % 2 ? '#7cff4f' : '#b04cff')), bone: 0 });
  }
  for (let i = 0; i < 64; i++) wb.push({ geo: G.box(0.16, 0.16, 0.12), matrix: mul(Tm(0, 0, 1.05), Rz(i / 64 * Math.PI * 2), Tm(R + 0.15, 0, 0)), color: c4(i % 3 ? '#ffd890' : '#ff7a1a'), bone: 0 });
  wp.push({ geo: G.cylinder(0.6, 0.6, 2.6, 12), matrix: Rx(Math.PI / 2), color: c4('#3a3036'), bone: 0 });
  const gcols = ['#8a3a1a', '#4a2a5a', '#3a5a2a', '#6a2a2a'];
  for (let i = 0; i < NG; i++) {
    const b = i + 1, col = gcols[i % gcols.length];
    for (const s of [-1, 1]) wp.push({ geo: G.box(0.06, 0.9, 0.06), matrix: Tm(s * 0.7, -0.45, 0), color: c4('#2a2228'), bone: b });
    wp.push({ geo: G.box(1.6, 0.8, 1.1), matrix: Tm(0, -1.3, 0), color: c4(col), bone: b }); wp.push({ geo: G.box(1.7, 0.08, 1.2), matrix: Tm(0, -0.1, 0), color: c4('#2a2228'), bone: b });
    wp.push({ geo: G.box(1.5, 0.1, 1.0), matrix: Tm(0, -1.7, 0), color: c4('#1a1418'), bone: b });
  }
  const WL = TR(W.x, W.axle, W.z, wheelYaw), wb0 = { center: [W.x, W.axle, W.z], radius: R + 3 };
  const wheel = mk(wp, lit, NG + 1, wb0), wheelBulbs = mk(wb, bulbMat, 1, wb0); wheelBulbs.bones = wheel.bones; // (one set of bones for both)
  // the carousel: bone 0 the platform, its column and canopy (striped, a scalloped valance with bulbs), bones 1..12 the
  // horses (black ones and skeleton ones) rising and falling on their poles
  const Cc = CARNIVAL.carousel, CR = Cc.r, NH = 12, cp = [], cb = [];
  cp.push({ geo: G.cylinder(CR, CR, 0.4, 24, { y0: true }), matrix: Tm(0, 0.35, 0), color: c4('#3a2230'), bone: 0 });
  cp.push({ geo: G.cylinder(0.9, 0.9, 3.6, 12, { y0: true }), matrix: Tm(0, 0.75, 0), color: c4('#2a1a3a'), bone: 0 });
  const cone = G.cylinder(0.06, CR + 0.6, 2.2, 24, { y0: true }), cc = new Float32Array(cone.position.length / 3 * 4);
  for (let i = 0; i < cone.position.length / 3; i++) { const a = Math.atan2(cone.position[i * 3 + 2], cone.position[i * 3]); cc.set(c4(Math.floor((a + Math.PI) / (Math.PI * 2) * 24 + 0.5) % 2 ? '#ff7a1a' : '#2a1240'), i * 4); }
  cone.color = cc; cp.push({ geo: cone, matrix: Tm(0, 4.35, 0), bone: 0 });
  cp.push({ geo: G.cylinder(CR + 0.62, CR + 0.62, 0.7, 24, { y0: true, open: true }), matrix: Tm(0, 3.7, 0), color: c4('#5a1a4a'), bone: 0 });
  cp.push({ geo: G.sphere(0.4, 8, 6), matrix: Tm(0, 6.7, 0), color: c4('#e86a10'), bone: 0 });
  for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; cb.push({ geo: G.box(0.16, 0.16, 0.16), matrix: Tm(Math.cos(a) * (CR + 0.66), 3.9, Math.sin(a) * (CR + 0.66)), color: c4(i % 2 ? '#ffd890' : '#7cff4f'), bone: 0 }); }
  for (let i = 0; i < NH; i++) {
    const a = i / NH * Math.PI * 2, x = Math.cos(a) * (CR - 1.3), z = Math.sin(a) * (CR - 1.3), b = i + 1, skel = i % 2, body = skel ? '#d8d0bc' : '#141016', mane = skel ? '#8a8070' : '#7cff4f';
    cp.push({ geo: G.cylinder(0.04, 0.04, 3.2, 5, { y0: true }), matrix: Tm(x, 0.75, z), color: c4('#c8b070'), bone: 0 });
    const hp = [[G.box(0.36, 0.42, 1.1), Tm(0, 0, 0), body], [G.box(0.26, 0.6, 0.3), mul(Tm(0, 0.35, 0.5), Rx(-0.5)), body], [G.box(0.24, 0.26, 0.55), mul(Tm(0, 0.62, 0.78), Rx(0.3)), body], [G.box(0.06, 0.4, 0.5), mul(Tm(0, 0.48, 0.38), Rx(-0.5)), mane], [G.box(0.08, 0.5, 0.08), mul(Tm(0, -0.05, -0.62), Rx(0.7)), mane]];
    for (const [lx, lz, ang] of [[-0.12, 0.42, -0.9], [0.12, 0.42, -0.5], [-0.12, -0.42, 0.6], [0.12, -0.42, 0.9]]) hp.push([G.box(0.09, 0.55, 0.09), mul(Tm(lx, -0.25, lz), Rx(ang), Tm(0, -0.22, 0)), body]);
    if (!skel) for (const s of [-0.07, 0.07]) hp.push([G.box(0.04, 0.04, 0.02), Tm(s, 0.68, 1.06), '#7cff4f']);
    for (const [geo, m, col] of hp) cp.push({ geo, matrix: mul(Ry(-a), m), color: c4(col), bone: b });
  }
  const CL = TR(Cc.x, 0, Cc.z), cb0 = { center: [Cc.x, 3, Cc.z], radius: CR + 3 };
  const carousel = mk(cp, lit, NH + 1, cb0), carBulbs = mk(cb, bulbMat, 1, cb0); carBulbs.bones = carousel.bones;
  // the ride's doors: bone 0 the left one, bone 1 the right, hinged at their outer edges
  const dp = [];
  for (const [s, b] of [[1, 0], [-1, 1]]) {
    dp.push({ geo: G.box(2.6, 4.1, 0.14), matrix: Tm(s * 1.3, 2.05, 0), color: c4('#3a0a14'), bone: b });
    for (let k = 0; k < 4; k++) dp.push({ geo: G.box(0.12, 0.6 + k * 0.3, 0.04), matrix: Tm(s * (0.5 + k * 0.5), 3.6 - (0.3 + k * 0.15), 0.08), color: c4('#7cff4f'), bone: b });
    dp.push({ geo: G.sphere(0.14, 6, 5), matrix: Tm(s * 2.2, 2.0, 0.1), color: c4('#d8d0bc'), bone: b });
  }
  const doors = mk(dp, lit, 2, { center: [CARNIVAL.ride.x, 2, CARNIVAL.ride.z], radius: 6 });
  let wa = 0, ca = 0;
  return {
    update(dt, t) {
      wa += dt * 0.07; ca += dt * 0.32;
      const b = wheel.bones; setBone(b, 0, mul(WL, Rz(wa)));
      for (let i = 0; i < NG; i++) { const a = i / NG * Math.PI * 2 + wa; setBone(b, i + 1, mul(WL, Tm(Math.cos(a) * R, Math.sin(a) * R, 0), Rz(Math.sin(t * 0.8 + i) * 0.06))); }
      const cbn = carousel.bones; setBone(cbn, 0, mul(CL, Ry(ca)));
      for (let i = 0; i < NH; i++) { const a = i / NH * Math.PI * 2, x = Math.cos(a) * (CR - 1.3), z = Math.sin(a) * (CR - 1.3); setBone(cbn, i + 1, mul(CL, Ry(ca), Tm(x, 2.0 + Math.sin(ca * 3 + i * 1.1) * 0.35, z))); }
    },
    doors(k) { setBone(doors.bones, 0, mul(ride.doorL, Ry(-1.45 * k))); setBone(doors.bones, 1, mul(ride.doorR, Ry(1.45 * k))); },
    meshes: { wheel, wheelBulbs, carousel, carBulbs, doors },
  };
}

// ---- the hearse: a long black car facing +z, wheels on the ground: a tall back with curtained windows and chrome landau
// bars, a long hood, fins. hearseLights(): its head and tail lamps and the dim purple glow behind the curtains ----
export function hearse() {
  const p = [], B = (w, h, d, x, y, z, col, m = null) => p.push({ geo: G.box(w, h, d), matrix: m || Tm(x, y, z), color: c4(col) }), blk = '#0e0e12', ch = '#c8ccd2';
  B(2.0, 0.55, 6.3, 0, 0.62, 0, blk); B(1.96, 0.3, 1.9, 0, 1.02, 2.15, blk); B(1.9, 1.15, 4.0, 0, 1.45, -1.0, blk);
  p.push({ geo: G.box(1.82, 0.7, 0.06), matrix: mul(Tm(0, 1.4, 1.12), Rx(-0.45)), color: c4('#1a1c24') });
  for (const s of [-1, 1]) {
    B(0.04, 0.55, 0.9, s * 0.96, 1.48, 0.45, '#1a1c24');
    B(0.04, 0.6, 2.2, s * 0.965, 1.5, -1.5, '#24182c');
    p.push({ geo: G.tube([[s * 0.98, 1.85, -2.2], [s * 0.98, 1.55, -1.9], [s * 0.98, 1.75, -1.4], [s * 0.98, 1.4, -1.1]], 0.025, 4), color: c4(ch) });
    B(0.1, 0.2, 1.0, s * 0.9, 1.1, -2.85, blk);
    B(0.03, 0.05, 6.0, s * 1.005, 0.78, 0, ch);
  }
  for (const sz of [-1, 1]) B(2.1, 0.16, 0.18, 0, 0.42, sz * 3.18, ch);
  B(1.3, 0.3, 0.05, 0, 0.75, 3.16, ch);
  for (const [x, z] of [[-0.9, 2.0], [0.9, 2.0], [-0.9, -2.0], [0.9, -2.0]]) { const m = mul(Tm(x, 0.36, z), Rz(Math.PI / 2)); p.push({ geo: G.cylinder(0.36, 0.36, 0.24, 10), matrix: m, color: c4('#0a0a0c') }, { geo: G.cylinder(0.2, 0.2, 0.26, 8), matrix: m, color: c4(ch) }); }
  return PR.bake(p);
}
export function hearseLights() {
  return PR.bake([...[-0.65, 0.65].map(x => ({ geo: G.box(0.32, 0.16, 0.04), matrix: Tm(x, 0.78, 3.17), color: [1.4, 1.3, 1.1, 1] })), ...[-0.8, 0.8].map(x => ({ geo: G.box(0.2, 0.2, 0.04), matrix: Tm(x, 0.8, -3.17), color: [1.6, 0.05, 0.04, 1] })), ...[-1, 1].map(s => ({ geo: G.box(0.02, 0.5, 2.1), matrix: Tm(s * 0.952, 1.5, -1.5), color: [0.45, 0.2, 0.7, 1] }))]);
}

// ---------------- the figures (parklife.js and streakfx.js move them) ----------------
// One skinned mesh carries up to two figures, 12 bones each: 0 hips, 1 chest, 2 head, 3 / 4 the left arm (upper, fore),
// 5 / 6 the right arm, 7 / 8 the left leg (thigh, shin), 9 / 10 the right leg, 11 a prop (a lantern, a cape, a pail, a
// tail, a broom). A figure faces +z, its feet on y 0, 1.87 m tall at k 1. Pieces that glow (eyes, a lantern, a
// jack-o'-lantern head) go in a second geometry on the same bones, drawn unlit
export const FB = 12;
export const DIMS = { hipY: 1.0, chest: 0.08, neck: 0.5, shX: 0.215, shY: 0.43, upper: 0.29, fore: 0.27, hipX: 0.1, thigh: 0.45, shin: 0.44 };
// where each kind's prop hangs: [parent bone, x, y, z]
const PROP_AT = { slasher: [4, 0, -0.3, 0.02], kid: [6, 0, -0.3, 0.03], vampire: [1, 0, 0.45, -0.1], werewolf: [0, 0, 0.02, -0.12], lanternman: [6, 0, -0.29, 0.02], witch: [0, 0, -0.02, 0], skeleton: [2, 0, 0, 0], default: [1, 0, 0.2, 0] };
const kidKinds = ['kidSheet', 'kidPumpkin', 'kidWitch', 'kidSkelly', 'kidCape'];
export const propAt = kind => PROP_AT[kidKinds.includes(kind) ? 'kid' : kind] || PROP_AT.default;
const BX = (w, h, d, x, y, z, hex, b, glow = false) => ({ geo: G.box(w, h, d), matrix: Tm(x, y, z), color: c4(hex), bone: b, glow });
const SP = (r, x, y, z, hex, b, o = {}) => ({ geo: G.sphere(r, o.ws || 9, o.hs || 7, o), matrix: Tm(x, y, z), color: c4(hex), bone: b, glow: !!o.glow });
// the base body: hips, chest, neck and head, the arms with their hands, the legs with their shoes
function body(o) {
  const p = [], sk = o.skin || '#c68b62', top = o.top || '#3a4a6a', sl = o.sleeve || top, bot = o.bottom || '#2a2a34', sh = o.shoes || '#1a1a1e';
  p.push(BX(0.32, 0.2, 0.2, 0, 0, 0, bot, 0), BX(0.38 * (o.wide || 1), 0.5, 0.22 * (o.deep || 1), 0, 0.24, 0, top, 1), BX(0.09, 0.1, 0.09, 0, 0.03, 0, sk, 2), SP(0.115, 0, 0.17, 0.01, o.head || sk, 2));
  for (const [s, u, f] of [[1, 3, 4], [-1, 5, 6]]) {
    if (!o.noArms) { p.push(BX(0.1, 0.29, 0.1, 0, -0.145, 0, (s > 0 ? o.sleeveL : o.sleeveR) || sl, u), BX(0.09, 0.25, 0.09, 0, -0.125, 0, (s > 0 ? o.foreL : o.foreR) || sl, f), BX(0.08, 0.09, 0.08, 0, -0.29, 0, o.hands || sk, f)); }
  }
  for (const [th, sn, s] of [[7, 8, 1], [9, 10, -1]]) p.push(BX(0.15, 0.45, 0.15, 0, -0.225, 0, bot, th), BX(0.12, 0.43, 0.12, 0, -0.215, 0, o.shins || bot, sn), BX(0.12, 0.09, 0.27, 0, -0.45, 0.05, (s > 0 ? o.shoeL : o.shoeR) || sh, sn));
  if (o.hair === 'short') p.push(BX(0.235, 0.09, 0.24, 0, 0.26, -0.005, o.hairCol || '#1a1210', 2));
  else if (o.hair === 'long') p.push(BX(0.24, 0.1, 0.25, 0, 0.26, 0, o.hairCol, 2), BX(0.24, 0.3, 0.06, 0, 0.12, -0.11, o.hairCol, 2));
  else if (o.hair === 'messy') for (let k = 0; k < 6; k++) p.push(BX(0.07, 0.08, 0.07, Math.cos(k * 1.1) * 0.08, 0.27 + (k % 2) * 0.02, Math.sin(k * 1.1) * 0.08, o.hairCol || '#2a2018', 2));
  else if (o.hair === 'cap') p.push({ geo: G.sphere(0.122, 9, 5, { phiMax: Math.PI / 2 }), matrix: Tm(0, 0.19, 0), color: c4(o.hairCol), bone: 2 }, BX(0.16, 0.025, 0.14, 0, 0.21, 0.15, o.hairCol, 2));
  return p;
}
const eyes = (b, hex, glow = false, y = 0.19, gap = 0.045, z = 0.105, s = 0.03) => [-1, 1].map(sx => BX(s, s * 0.8, 0.02, sx * gap, y, z, hex, b, glow));
// every kind's parts, bones 0..11; o: colour variations
export function figureParts(kind, o = {}) {
  let p = [];
  if (kind === 'zombie') {
    const sk = o.skin || '#8aa27a';
    p = body({ skin: sk, top: o.top || '#4a5a7a', bottom: o.bottom || '#3a3640', foreR: sk, shoeL: sk, hair: 'messy', hairCol: '#2a2420' });
    p.push(...eyes(2, '#140c0c', false), BX(0.08, 0.05, 0.02, 0.01, 0.1, 0.105, '#2a1010', 2), ...[-0.12, -0.02, 0.1].map(x => BX(0.07, 0.12, 0.2, x, -0.04, 0.02, o.top || '#4a5a7a', 1)), BX(0.12, 0.08, 0.23, 0.08, 0.32, 0.0, '#5a6a50', 1));
    p.push(...eyes(2, '#c8ffb0', true, 0.19, 0.045, 0.116, 0.012));
  } else if (kind === 'mummy') {
    const b1 = '#d6ccb0', b2 = '#aaa088';
    p = body({ skin: b1, top: b1, bottom: b1, shoes: b2, hands: b2 });
    for (const [b, y0, y1, w] of [[1, 0.02, 0.5, 0.4], [0, -0.08, 0.1, 0.34], [2, 0.08, 0.28, 0.25], [3, -0.28, 0, 0.12], [5, -0.28, 0, 0.12], [7, -0.44, 0, 0.17], [9, -0.44, 0, 0.17]]) for (let y = y0 + 0.04; y < y1; y += 0.085) p.push({ geo: G.box(w, 0.025, w * 0.62), matrix: mul(Tm(0, y, 0), Rz(((y * 37) % 1 - 0.5) * 0.35)), color: c4(b2), bone: b });
    p.push(BX(0.12, 0.022, 0.02, 0, 0.19, 0.112, '#120c08', 2), ...eyes(2, '#ffb030', true, 0.19, 0.03, 0.118, 0.016), BX(0.05, 0.5, 0.012, 0.02, -0.5, 0.05, b1, 4));
  } else if (kind === 'vampire') {
    const sk = '#dcdae6';
    p = body({ skin: sk, top: '#141218', bottom: '#141218', shoes: '#08080a', hands: '#e8e6ee', hair: 'short', hairCol: '#08080c', wide: 1.05 });
    p.push(BX(0.12, 0.38, 0.02, 0, 0.28, 0.112, '#f0eee8', 1), BX(0.1, 0.05, 0.03, 0, 0.42, 0.122, '#a01020', 1), BX(0.06, 0.08, 0.05, 0, 0.27, 0.11, '#08080c', 2));
    p.push(...eyes(2, '#ff2030', true, 0.19, 0.04, 0.112, 0.018));
    // the cape (bone 11, from the shoulders): a black back panel and wings, red inside, a high collar
    for (const [x, yaw] of [[0, 0], [-0.33, 0.55], [0.33, -0.55]]) { p.push({ geo: G.box(0.42, 1.38, 0.03), matrix: mul(Tm(x, -0.66, -0.06 - Math.abs(x) * 0.25), Ry(yaw)), color: c4('#0c0a10'), bone: 11 }, { geo: G.box(0.4, 1.32, 0.012), matrix: mul(Tm(x, -0.64, -0.035 - Math.abs(x) * 0.25), Ry(yaw)), color: c4('#8a0a1a'), bone: 11 }); }
    for (const s of [-1, 1]) p.push({ geo: G.box(0.16, 0.3, 0.025), matrix: mul(Tm(s * 0.12, 0.12, -0.02), Rz(s * 0.35), Rx(-0.2)), color: c4('#8a0a1a'), bone: 11 });
  } else if (kind === 'werewolf' || kind === 'wolfman') {
    const wolf = kind === 'werewolf', fur = '#4e4036', dk = '#2e2620';
    p = body(wolf ? { skin: fur, top: fur, bottom: '#3a3a5a', shins: fur, shoes: dk, hands: dk, wide: 1.15, deep: 1.2 } : { skin: '#c69a72', top: '#8a2a2a', bottom: '#3a4a6a', hair: 'messy', hairCol: '#4a3020' });
    if (wolf) {
      p.push(BX(0.13, 0.11, 0.2, 0, 0.13, 0.15, fur, 2), BX(0.06, 0.05, 0.04, 0, 0.17, 0.25, '#0a0808', 2), BX(0.1, 0.03, 0.12, 0, 0.07, 0.17, '#e8e0d0', 2));
      for (const s of [-1, 1]) p.push({ geo: G.cylinder(0.005, 0.05, 0.14, 4, { y0: true }), matrix: mul(Tm(s * 0.07, 0.25, -0.02), Rz(-s * 0.3)), color: c4(dk), bone: 2 });
      p.push(SP(0.2, 0, 0.42, -0.04, dk, 1, { sx: 1.2, sy: 0.7 }), BX(0.24, 0.35, 0.05, 0, 0.22, 0.1, '#6a5a48', 1));
      for (const f of [4, 6]) for (const k of [-1, 0, 1]) p.push(BX(0.015, 0.06, 0.015, k * 0.025, -0.36, 0.03, '#e8e0d0', f));
      p.push(...eyes(2, '#ffd020', true, 0.19, 0.05, 0.105, 0.026));
      p.push({ geo: G.tube([[0, 0, 0], [0, -0.15, -0.2], [0, -0.4, -0.3], [0, -0.55, -0.25]], t => 0.07 * (1 - t * 0.6), 5), color: c4(dk), bone: 11 });
    } else p.push(...eyes(2, '#1a1414'));
  } else if (kind === 'skeleton') {
    const bn = '#e6e0cc', dk = '#14100e';
    p.push(BX(0.26, 0.12, 0.12, 0, 0, 0, bn, 0), BX(0.05, 0.5, 0.05, 0, 0.24, -0.06, bn, 1));
    for (let k = 0; k < 5; k++) p.push(BX(0.3 - k * 0.02, 0.035, 0.18, 0, 0.18 + k * 0.065, 0, bn, 1));
    p.push(BX(0.4, 0.05, 0.08, 0, 0.45, -0.02, bn, 1), BX(0.04, 0.1, 0.04, 0, 0.03, 0, bn, 2), SP(0.12, 0, 0.18, 0.01, bn, 2), BX(0.13, 0.06, 0.1, 0, 0.07, 0.05, bn, 2), ...eyes(2, dk, false, 0.19, 0.045, 0.1, 0.045), BX(0.025, 0.035, 0.02, 0, 0.14, 0.118, dk, 2));
    for (const [u, f] of [[3, 4], [5, 6]]) p.push(BX(0.04, 0.29, 0.04, 0, -0.145, 0, bn, u), SP(0.035, 0, -0.29, 0, bn, u, { ws: 6, hs: 4 }), BX(0.035, 0.25, 0.035, 0, -0.125, 0, bn, f), BX(0.07, 0.09, 0.03, 0, -0.3, 0, bn, f));
    for (const [t, s] of [[7, 8], [9, 10]]) p.push(BX(0.05, 0.45, 0.05, 0, -0.225, 0, bn, t), SP(0.04, 0, -0.45, 0, bn, t, { ws: 6, hs: 4 }), BX(0.045, 0.43, 0.045, 0, -0.215, 0, bn, s), BX(0.09, 0.05, 0.22, 0, -0.45, 0.05, bn, s));
    p.push(...eyes(2, '#7cff4f', true, 0.19, 0.045, 0.104, 0.014));
  } else if (kidKinds.includes(kind)) {
    const sk = o.skin || '#c68b62';
    if (kind === 'kidSheet') {
      p = body({ skin: sk, top: '#f4f2ea', bottom: '#2a2a34', noArms: true });
      p.push({ geo: G.cylinder(0.17, 0.4, 1.05, 12, { y0: true }), matrix: Tm(0, -0.5, 0), color: c4('#f4f2ea'), bone: 1 }, SP(0.17, 0, 0.18, 0, '#f4f2ea', 2), ...[-1, 1].map(s => BX(0.05, 0.07, 0.02, s * 0.06, 0.2, 0.16, '#14100e', 2)));
    } else if (kind === 'kidPumpkin') {
      p = body({ skin: sk, top: '#e86a10', sleeve: '#2a3a1a', bottom: '#2a3a1a', hair: 'short', hairCol: '#2a1a10' });
      p.push({ geo: pumpkinGeo(10, 6), matrix: mul(Tm(0, -0.2, 0), Sc(0.34, 0.42, 0.3)), color: c4('#e86a10'), bone: 1 }, BX(0.06, 0.12, 0.06, 0, 0.36, 0, '#3a5a1a', 2));
      for (const q of jackFace(0.32)) p.push({ geo: q.geo, matrix: mul(Tm(0, -0.2, 0.0), Sc(1.05, 1.3, 0.92)), color: c4('#2a1408'), bone: 1 });
    } else if (kind === 'kidWitch') {
      p = body({ skin: o.skin || '#8ac87a', top: '#1a1420', bottom: '#5a2a6a', hair: 'long', hairCol: '#c84a1a' });
      p.push({ geo: G.cylinder(0.14, 0.34, 0.8, 10, { y0: true }), matrix: Tm(0, -0.6, 0), color: c4('#1a1420'), bone: 0 }, { geo: G.cylinder(0.3, 0.3, 0.02, 12), matrix: Tm(0, 0.27, 0), color: c4('#1a1420'), bone: 2 }, { geo: G.cylinder(0.005, 0.15, 0.42, 8, { y0: true }), matrix: mul(Tm(0, 0.27, 0), Rx(-0.15)), color: c4('#1a1420'), bone: 2 }, { geo: G.cylinder(0.152, 0.152, 0.05, 10), matrix: Tm(0, 0.31, 0), color: c4('#7a3cff'), bone: 2 });
    } else if (kind === 'kidSkelly') {
      p = body({ skin: '#e6e0cc', top: '#141218', bottom: '#141218', head: '#e6e0cc' });
      for (let k = 0; k < 4; k++) p.push(BX(0.3, 0.03, 0.01, 0, 0.18 + k * 0.08, 0.115, '#e6e0cc', 1));
      for (const b of [3, 4, 5, 6, 7, 8, 9, 10]) p.push(BX(0.03, b > 6 ? 0.36 : 0.22, 0.012, 0, b > 6 ? -0.22 : -0.13, b > 6 ? 0.08 : 0.052, '#e6e0cc', b));
      p.push(...eyes(2, '#14100e', false, 0.19, 0.045, 0.104, 0.04));
    } else {
      p = body({ skin: sk, top: '#1a3a8a', bottom: '#1a1a2a', hair: 'short', hairCol: '#1a1210' });
      for (const s of [-1, 0, 1]) p.push({ geo: G.box(0.2, 0.75, 0.02), matrix: mul(Tm(s * 0.13, -0.32, -0.14 - Math.abs(s) * 0.03), Ry(s * -0.3)), color: c4('#b01a1a'), bone: 1 });
      p.push(BX(0.24, 0.05, 0.02, 0, 0.19, 0.11, '#141218', 2));
    }
    // the candy pail
    p.push({ geo: G.cylinder(0.11, 0.09, 0.15, 10, { y0: true }), matrix: Tm(0, -0.25, 0), color: c4('#ff7a1a'), bone: 11 }, { geo: G.torus(0.09, 0.008, 10, 3, Math.PI), matrix: mul(Tm(0, -0.1, 0), Rx(Math.PI / 2), Rz(Math.PI)), color: c4('#1a1418'), bone: 11 });
    for (const q of jackFace(0.11)) p.push({ geo: q.geo, matrix: mul(Tm(0, -0.25, 0), Sc(1, 0.8, 1.02)), color: c4('#ffb347'), bone: 11, glow: true });
  } else if (kind === 'teen') {
    p = body({ skin: o.skin || '#e9c2a0', top: o.top || '#2a6a9a', bottom: o.bottom || '#2a3a5a', shoes: '#e8e6e0', hair: o.hair || 'short', hairCol: o.hairCol || '#4a3020' });
    p.push(...eyes(2, '#1a1414'), BX(0.06, 0.07, 0.02, 0, 0.1, 0.112, '#3a1010', 2));
  } else if (kind === 'slasher') {
    const sl = '#f0c81e', dk = '#141210';
    p = body({ skin: '#8a7350', top: sl, sleeve: sl, bottom: '#2a2a2e', shoes: dk, hands: '#3a3028', head: '#8a7350', wide: 1.2, deep: 1.3 });
    p.push({ geo: G.cylinder(0.24, 0.34, 0.78, 10, { y0: true, open: true }), matrix: Tm(0, -0.72, 0), color: c4(sl), bone: 0 });
    p.push({ geo: G.sphere(0.16, 9, 7, { phiMax: Math.PI * 0.62 }), matrix: mul(Tm(0, 0.19, -0.03), Rx(-0.5)), color: c4('#b8981a'), bone: 2 });
    for (const sx of [-0.05, 0.05]) p.push({ geo: G.sphere(0.028, 6, 4), matrix: Tm(sx, 0.2, 0.1), color: c4('#060404'), bone: 2 });
    for (let k = -3; k <= 3; k++) p.push(BX(0.012, k % 2 ? 0.04 : 0.02, 0.015, k * 0.022, 0.1, 0.108, '#2a1a10', 2));
    p.push(BX(0.2, 0.025, 0.2, 0, 0.04, 0, '#5a4a30', 2));
    // the lantern (bone 11 in the left hand): a frame, its glass alight, the bail
    p.push(BX(0.18, 0.025, 0.18, 0, -0.08, 0, dk, 11), BX(0.2, 0.03, 0.2, 0, -0.34, 0, dk, 11), { geo: G.torus(0.07, 0.008, 10, 3, Math.PI), matrix: mul(Tm(0, -0.06, 0), Rx(Math.PI / 2), Rz(Math.PI)), color: c4(dk), bone: 11 });
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.push(BX(0.02, 0.26, 0.02, x * 0.08, -0.21, z * 0.08, dk, 11));
    p.push(BX(0.13, 0.22, 0.13, 0, -0.21, 0, '#ffb040', 11, true));
  } else if (kind === 'lanternman') {
    p = body({ skin: '#e86a10', top: '#141218', bottom: '#2a1a3a', shoes: '#08080a', hands: '#f0ece0', head: '#e86a10' });
    for (let k = 0; k < 6; k++) for (const b of [7, 9]) p.push(BX(0.152, 0.03, 0.152, 0, -0.04 - k * 0.07, 0, '#5a2a7a', b));
    for (const s of [-1, 1]) p.push({ geo: G.box(0.13, 0.62, 0.03), matrix: mul(Tm(s * 0.08, -0.36, -0.11), Rz(s * 0.06)), color: c4('#141218'), bone: 0 });
    p.push({ geo: pumpkinGeo(10, 6), matrix: mul(Tm(0, 0.03, 0.01), Sc(0.17, 0.18, 0.16)), color: c4('#e86a10'), bone: 2 });
    for (const q of jackFace(0.165)) p.push({ geo: q.geo, matrix: Tm(0, 0.03, 0.01), color: c4('#ffd060'), bone: 2, glow: true });
    p.push({ geo: G.cylinder(0.2, 0.2, 0.015, 12), matrix: Tm(0, 0.3, 0), color: c4('#08080a'), bone: 2 }, { geo: G.cylinder(0.1, 0.11, 0.34, 10, { y0: true }), matrix: Tm(0, 0.3, 0), color: c4('#08080a'), bone: 2 }, { geo: G.cylinder(0.112, 0.112, 0.05, 10), matrix: Tm(0, 0.35, 0), color: c4('#ff7a1a'), bone: 2 });
    p.push(BX(0.03, 0.95, 0.03, 0, -0.38, 0, '#1a1418', 11), SP(0.04, 0, 0.1, 0, '#c8b070', 11, { ws: 6, hs: 4 }));
  } else if (kind === 'witch') {
    p = body({ skin: '#7ab86a', top: '#141018', bottom: '#141018', shoes: '#08080a', hair: 'long', hairCol: '#2a2a3a' });
    p.push({ geo: G.cylinder(0.16, 0.4, 0.8, 10, { y0: true, open: true }), matrix: mul(Tm(0, -0.7, 0.1), Rx(-0.4)), color: c4('#141018'), bone: 0 });
    p.push({ geo: G.cylinder(0.34, 0.34, 0.02, 12), matrix: Tm(0, 0.26, 0), color: c4('#141018'), bone: 2 }, { geo: G.cylinder(0.005, 0.16, 0.5, 8, { y0: true }), matrix: mul(Tm(0, 0.26, -0.02), Rx(-0.35)), color: c4('#141018'), bone: 2 }, BX(0.04, 0.04, 0.09, 0, 0.14, 0.14, '#6aa85a', 2));
    p.push(...eyes(2, '#ffe020', true, 0.19, 0.045, 0.108, 0.02));
    p.push({ geo: G.cylinder(0.025, 0.025, 1.7, 5), matrix: mul(Tm(0, -0.05, 0.25), Rx(Math.PI / 2 + 0.08)), color: c4('#5a4428'), bone: 11 }, { geo: G.cylinder(0.04, 0.17, 0.5, 7, { y0: true }), matrix: mul(Tm(0, -0.12, -0.55), Rx(-Math.PI / 2 + 0.08)), color: c4('#a88a4a'), bone: 11 });
  }
  return p;
}
// one or two figures' geometry for a mesh: {geo, glow} (glow null when nothing on them glows)
export function figureGeo(specs) {
  const all = [], gl = [];
  specs.forEach((sp, i) => { for (const q of figureParts(sp.kind, sp)) (q.glow ? gl : all).push({ ...q, bone: q.bone + i * FB }); });
  return { geo: skinGeo(all), glow: gl.length ? skinGeo(gl) : null };
}
// pose a figure into bones (slot: which of the mesh's figures). P: {lean, side, twist, drop, pitch, roll, aL / aR [fwd, side,
// elbow], lL / lR [fwd, side, knee], head [nod, turn, tilt], prop [x, y, z]}; k scale; hidden: folds it away
const QA = M.q4(), QB = M.q4(), QT = M.q4(), MT = M.m4(), MR = M.m4(), VT = [0, 0, 0];
function joint(out, parent, x, y, z, ax, ay, az, order) {
  M.qidentity(QT);
  for (let i = 0; i < order.length; i++) { const ch = order[i]; M.qaxis(QA, ch === 'x' ? 1 : 0, ch === 'y' ? 1 : 0, ch === 'z' ? 1 : 0, ch === 'x' ? ax : ch === 'y' ? ay : az); M.qmul(QB, QT, QA); M.qcopy(QT, QB); }
  VT[0] = x; VT[1] = y; VT[2] = z; M.m4compose(MT, VT, QT, null); return M.m4mul(out, parent, MT);
}
const Z3 = [0, 0, 0];
export function poseFigure(B, slot, x, y, z, yaw, P = {}, k = 1, kind = 'default') {
  const V = i => B.subarray((slot * FB + i) * 16, (slot * FB + i + 1) * 16), d = DIMS;
  if (P.hidden) { for (let i = 0; i < FB; i++) { const v = V(i); v.fill(0); v[13] = -60; v[15] = 1; } return; }
  M.m4fromYaw(MR, x, y, z, yaw, k);
  if (P.pitch || P.roll) { joint(MT, MR, 0, 0, 0, P.pitch || 0, 0, P.roll || 0, 'xz'); MR.set(MT); }
  const aL = P.aL || [0, 0.1, 0.1], aR = P.aR || [0, 0.1, 0.1], lL = P.lL || [0, 0.03, 0], lR = P.lR || [0, 0.03, 0], hd = P.head || Z3, tw = P.twist || 0;
  joint(V(0), MR, 0, d.hipY - (P.drop || 0), 0, 0, tw * 0.3, 0, 'y');
  joint(V(1), V(0), 0, d.chest, 0, P.lean || 0, tw * 0.7, P.side || 0, 'yxz');
  joint(V(2), V(1), 0, d.neck, 0, hd[0], hd[1], hd[2] || 0, 'yxz');
  joint(V(3), V(1), d.shX, d.shY, 0, -aL[0], 0, aL[1], 'zx'); joint(V(4), V(3), 0, -d.upper, 0, -aL[2], 0, 0, 'x');
  joint(V(5), V(1), -d.shX, d.shY, 0, -aR[0], 0, -aR[1], 'zx'); joint(V(6), V(5), 0, -d.upper, 0, -aR[2], 0, 0, 'x');
  joint(V(7), V(0), d.hipX, -0.06, 0, -lL[0], 0, lL[1], 'zx'); joint(V(8), V(7), 0, -d.thigh, 0, lL[2], 0, 0, 'x');
  joint(V(9), V(0), -d.hipX, -0.06, 0, -lR[0], 0, -lR[1], 'zx'); joint(V(10), V(9), 0, -d.thigh, 0, lR[2], 0, 0, 'x');
  const pa = propAt(kind), pr = P.prop || Z3;
  joint(V(11), V(pa[0]), pa[1], pa[2], pa[3], pr[0], pr[1], pr[2], 'yxz');
}
// gaits and moves: each returns a pose for a phase (radians of stride) or a time
export const MOVES = {
  walk: (ph, a = 1) => { const s = Math.sin(ph) * 0.5 * a, c = Math.cos(ph); return { lL: [s, 0.03, Math.max(0, -c) * 0.6 * a + 0.05], lR: [-s, 0.03, Math.max(0, c) * 0.6 * a + 0.05], aL: [-s * 0.8, 0.12, 0.25], aR: [s * 0.8, 0.12, 0.25], lean: 0.05, drop: Math.abs(c) * 0.02 }; },
  run: (ph, a = 1) => { const s = Math.sin(ph) * 0.9 * a, c = Math.cos(ph); return { lL: [s, 0.03, Math.max(0, -c) * 1.4 + 0.2], lR: [-s, 0.03, Math.max(0, c) * 1.4 + 0.2], aL: [-s * 1.1, 0.2, 1.4], aR: [s * 1.1, 0.2, 1.4], lean: 0.32, drop: 0.06 + Math.abs(c) * 0.05, head: [-0.15, 0, 0] }; },
  // arms out and up in front, one leg dragging, the head lolling
  shamble: (ph, t = 0) => { const s = Math.sin(ph), c = Math.cos(ph); return { lL: [s * 0.45, 0.06, Math.max(0, -c) * 0.5 + 0.1], lR: [-s * 0.2 - 0.05, 0.1, 0.12], aL: [1.35 + Math.sin(t * 1.3) * 0.1, 0.12, 0.25], aR: [1.15 + Math.sin(t * 1.7 + 1) * 0.12, 0.05, 0.4], lean: 0.18, side: 0.08 * s, twist: 0.12 * s, head: [0.25, 0.2 * Math.sin(t * 0.6), 0.35], drop: 0.03 + Math.abs(c) * 0.03 }; },
  mummy: (ph, t = 0) => { const s = Math.sin(ph); return { lL: [s * 0.22, 0.03, 0.02], lR: [-s * 0.22, 0.03, 0.02], aL: [1.5, 0.05, 0.05], aR: [1.45, 0.05, 0.1], lean: -0.04, side: 0.06 * s, head: [0.05, 0, 0.05 * s] }; },
  creep: (ph, t = 0) => { const s = Math.sin(ph) * 0.38, c = Math.cos(ph); return { lL: [s, 0.05, Math.max(0, -c) * 0.45 + 0.08], lR: [-s, 0.05, Math.max(0, c) * 0.45 + 0.08], aL: [0.35, 0.2, 0.3], aR: [s * 0.5, 0.15, 0.3], lean: 0.12, head: [0.22, 0, 0], prop: [Math.sin(ph * 2) * 0.12 - 0.35, 0, Math.sin(ph) * 0.1], drop: 0.04 }; },
  glide: t => ({ lL: [0.05, 0.02, 0], lR: [0.05, 0.02, 0], aL: [0.5, 0.9 + Math.sin(t * 1.2) * 0.15, 0.6], aR: [0.5, 0.9 + Math.sin(t * 1.2 + 0.4) * 0.15, 0.6], lean: -0.05, head: [0.05, Math.sin(t * 0.4) * 0.4, 0], prop: [-0.35 - Math.sin(t * 2.2) * 0.12, 0, 0] }),
  prowl: (ph, t = 0) => { const s = Math.sin(ph) * 0.55, c = Math.cos(ph); return { lL: [s + 0.3, 0.1, Math.max(0, -c) * 0.8 + 0.5], lR: [-s + 0.3, 0.1, Math.max(0, c) * 0.8 + 0.5], aL: [0.9 - s * 0.6, 0.25, 0.6], aR: [0.9 + s * 0.6, 0.25, 0.6], lean: 0.75, drop: 0.24, head: [-0.6, Math.sin(t * 0.7) * 0.3, 0], prop: [-0.3 + Math.sin(ph * 2) * 0.2, Math.sin(ph) * 0.4, 0] }; },
  howl: k => ({ lL: [0.2, 0.15, 0.3], lR: [-0.1, 0.15, 0.2], aL: [0.4 + k * 0.6, 0.6 + k * 0.6, 1.2], aR: [0.4 + k * 0.6, 0.6 + k * 0.6, 1.2], lean: -0.25 * k, head: [-0.9 * k, 0, 0], drop: 0.05, prop: [-0.6, 0, 0] }),
  hunch: k => ({ lL: [0.6, 0.15, 1.0], lR: [0.5, 0.15, 0.9], aL: [0.6, 0.3, 1.6], aR: [0.7, 0.3, 1.5], lean: 0.9 * k, drop: 0.32 * k, head: [0.5, 0, 0] }),
  stand: t => ({ aL: [0.05, 0.12, 0.2], aR: [0.05, 0.12, 0.2], head: [0.05, Math.sin(t * 0.3) * 0.3, 0], drop: 0.01 * Math.sin(t * 1.4) }),
  beckon: t => ({ aL: [0.1, 0.15, 0.2], aR: [0.9, 0.35, 1.4 + Math.sin(t * 4) * 0.5], head: [0.1, 0.25, 0.15], prop: [0, 0, 0], lean: 0.05 }),
  knock: t => ({ aR: [1.5, 0.2, 0.6 + Math.abs(Math.sin(t * 9)) * 0.4], aL: [0.2, 0.12, 0.4], head: [-0.15, 0, 0] }),
  treat: t => ({ aR: [1.1 + Math.sin(t * 6) * 0.1, 0.15, 0.5], aL: [0.3, 0.15, 0.4], head: [-0.2, 0, 0], drop: Math.abs(Math.sin(t * 5)) * 0.03 }),
  // the skeletons' dance: knees in and out, the arms flapping, a jerky head
  skel: b => { const i = Math.floor(b) % 4, f = b % 1, j = 1 - f * 0.4; return [
    { lL: [0.6 * j, 0.5, 1.0 * j], lR: [0, 0.05, 0.1], aL: [0.2, 1.4, 1.5], aR: [0.2, 1.4, 1.5], head: [0, 0.4, 0.3], side: 0.12 },
    { lR: [0.6 * j, 0.5, 1.0 * j], lL: [0, 0.05, 0.1], aL: [0.2, 1.4, 0.2], aR: [0.2, 1.4, 0.2], head: [0, -0.4, -0.3], side: -0.12 },
    { lL: [0.3, 0.6 * j, 0.7], lR: [0.3, 0.6 * j, 0.7], aL: [1.6, 0.3, 0.3], aR: [-0.3, 0.3, 0.3], drop: 0.12 * j, head: [0.3, 0, 0] },
    { lL: [0.3, 0.6 * j, 0.7], lR: [0.3, 0.6 * j, 0.7], aR: [1.6, 0.3, 0.3], aL: [-0.3, 0.3, 0.3], drop: 0.12 * j, head: [0.3, 0, 0] }][i]; },
  sit: t => ({ lL: [1.45, 0.12, 1.45], lR: [1.4, 0.12, 1.5], aL: [0.9, 0.15, 0.5], aR: [0.9, 0.15, 0.5], lean: 0.25, head: [-0.1, Math.sin(t * 0.8) * 0.3, 0] }),
  rise: k => ({ aL: [2.6 - k * 1.1, 0.3, 0.3], aR: [2.4 - k * 0.9, 0.3, 0.6], lean: 0.3 * (1 - k), head: [-0.5 * (1 - k), 0, 0.3], lL: [0.1, 0.05, 0.2], lR: [0.2, 0.05, 0.3] }),
  scream: (ph) => { const P = MOVES.run(ph, 1); P.aL = [2.4, 0.5 + Math.sin(ph * 2) * 0.3, 0.4]; P.aR = [2.3, 0.5 + Math.cos(ph * 2) * 0.3, 0.5]; P.head = [-0.35, 0, 0]; return P; },
};
// the zombie troupe's routine (eight counts a move, original): the claw step to the side, the shoulder pops, the slow
// head roll with the arm sweep, the stomp and point at the crowd. b: beats; returns {P, dx (side step, m)}
export function zombieRoutine(b) {
  const bar = Math.floor(b / 8) % 4, f = b % 1, bt = Math.floor(b) % 8, hit = Math.pow(1 - f, 3), sgn = bt % 2 ? 1 : -1;
  if (bar === 0) return { P: { aL: [1.2, 1.2 + 0.3 * sgn, 1.6], aR: [1.2, 1.2 - 0.3 * sgn, 1.6], lL: [0.3 * (sgn > 0), 0.35, 0.5], lR: [0.3 * (sgn < 0), 0.35, 0.5], drop: 0.12 + 0.06 * hit, side: 0.18 * sgn, head: [0.2, 0.3 * sgn, 0.3 * sgn] }, dx: Math.sin(b * Math.PI / 4) * 0.5 };
  if (bar === 1) return { P: { aL: [0.3, 0.3 + 0.5 * (bt % 2 === 0) * hit, 1.9], aR: [0.3, 0.3 + 0.5 * (bt % 2 === 1) * hit, 1.9], lL: [0.1, 0.1, 0.25], lR: [0.1, 0.1, 0.25], drop: 0.08, twist: 0.25 * sgn * hit, head: [0.1 * hit, 0, 0] }, dx: 0 };
  if (bar === 2) {
    const a = b * Math.PI / 4;
    return { P: { aL: [0.8 + Math.sin(a) * 0.6, 1.0 + Math.cos(a) * 0.5, 0.4], aR: [0.8 - Math.sin(a) * 0.6, 1.0 - Math.cos(a) * 0.5, 0.4], lL: [0.2, 0.2, 0.4], lR: [0.2, 0.2, 0.4], drop: 0.1, head: [Math.cos(a) * 0.4, Math.sin(a) * 0.5, Math.sin(a) * 0.4], side: Math.sin(a) * 0.15 }, dx: 0 };
  }
  return { P: bt < 4 ? { lL: [0.9 * hit * (bt % 2), 0.1, 1.2 * hit * (bt % 2)], lR: [0.9 * hit * (1 - bt % 2), 0.1, 1.2 * hit * (1 - bt % 2)], aL: [1.4, 0.2, 0.2], aR: [1.4, 0.2, 0.2], lean: 0.2, head: [0.3, 0, 0] } : { aR: [1.6, 0.1, 0.05], aL: [0.4, 0.4, 1.6], lL: [0.4, 0.3, 0.6], lR: [0, 0.2, 0.1], drop: 0.1, lean: 0.1, head: [-0.1, 0, 0.2] }, dx: 0 };
}

// ---- ghosts: a sheet with a dome for a head, little arms, a wavy hem that swings (bone 2i the body, 2i + 1 the hem);
// n of them in one mesh. Drawn unlit and see-through; the eyes and the mouth are dark
export function ghostGeo(n = 6, k = 1) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const b = i * 2, s = k * (0.9 + (i % 3) * 0.12);
    const top = G.lathe([[0.0, 0.62], [0.16, 0.6], [0.27, 0.52], [0.33, 0.38], [0.36, 0.2], [0.37, 0]].map(([r, y]) => [r * s, y * s]), 14);
    parts.push({ geo: top, color: [0.9, 1.0, 0.95, 0.62], bone: b });
    const hem = G.lathe([[0.37, 0], [0.42, -0.35], [0.5, -0.72]].map(([r, y]) => [r * s, y * s]), 14);
    for (let v = 0; v < hem.position.length / 3; v++) if (hem.position[v * 3 + 1] < -0.6 * s) { const a = Math.atan2(hem.position[v * 3 + 2], hem.position[v * 3]); hem.position[v * 3 + 1] += Math.sin(a * 5) * 0.07 * s; }
    parts.push({ geo: hem, color: [0.85, 1.0, 0.92, 0.5], bone: b + 1 });
    for (const sx of [-1, 1]) parts.push({ geo: G.cylinder(0.03 * s, 0.07 * s, 0.24 * s, 6), matrix: mul(Tm(sx * 0.38 * s, 0.12 * s, 0.02), Rz(sx * 1.2)), color: [0.9, 1.0, 0.95, 0.55], bone: b });
    for (const sx of [-1, 1]) parts.push({ geo: G.sphere(0.055 * s, 6, 5, { sy: 1.4, sz: 0.4 }), matrix: Tm(sx * 0.11 * s, 0.4 * s, 0.31 * s), color: [0.02, 0.03, 0.04, 0.9], bone: b });
    parts.push({ geo: G.sphere(0.07 * s, 6, 5, { sy: 1.3, sz: 0.4 }), matrix: Tm(0, 0.22 * s, 0.35 * s), color: [0.02, 0.03, 0.04, 0.85], bone: b });
  }
  return skinGeo(parts);
}
export function poseGhost(B, i, x, y, z, yaw, t, k = 1) {
  const V0 = B.subarray(i * 32, i * 32 + 16), V1 = B.subarray(i * 32 + 16, i * 32 + 32);
  M.m4fromYaw(MR, x, y + Math.sin(t * 1.6 + i) * 0.18, z, yaw, k);
  joint(V0, MR, 0, 0, 0, Math.sin(t * 1.1 + i) * 0.08, 0, Math.sin(t * 0.9 + i * 2) * 0.1, 'xz');
  joint(V1, V0, 0, 0, 0, Math.sin(t * 2.3 + i) * 0.22 - 0.1, Math.sin(t * 1.7 + i) * 0.3, Math.sin(t * 2.9 + i) * 0.12, 'xyz');
}
// ---- black cats: bones 5i body, +1 head, +2 tail, +3 / +4 the leg pairs; their eyes glow (cat glow geometry)
export function catGeo(n = 3) {
  const p = [], g = [], blk = '#0e0c10';
  for (let i = 0; i < n; i++) {
    const b = i * 5;
    p.push({ geo: G.box(0.15, 0.15, 0.42), matrix: Tm(0, 0, 0), color: c4(blk), bone: b }, { geo: G.sphere(0.09, 8, 6), matrix: Tm(0, 0.05, 0.06), color: c4(blk), bone: b + 1 }, { geo: G.box(0.07, 0.05, 0.06), matrix: Tm(0, 0.02, 0.13), color: c4(blk), bone: b + 1 });
    for (const s of [-1, 1]) p.push({ geo: G.cylinder(0.005, 0.035, 0.08, 4, { y0: true }), matrix: mul(Tm(s * 0.05, 0.12, 0.05), Rz(-s * 0.25)), color: c4(blk), bone: b + 1 });
    for (const s of [-1, 1]) g.push({ geo: G.box(0.03, 0.022, 0.015), matrix: Tm(s * 0.035, 0.07, 0.14), color: c4('#c8ff40'), bone: b + 1 });
    p.push({ geo: G.tube([[0, 0, 0], [0, 0.12, -0.08], [0, 0.3, -0.1], [0, 0.4, -0.02]], 0.022, 4), color: c4(blk), bone: b + 2 });
    for (const [x, z, pr] of [[-0.055, 0.15, 3], [0.055, -0.15, 3], [0.055, 0.15, 4], [-0.055, -0.15, 4]]) p.push({ geo: G.box(0.04, 0.2, 0.04), matrix: Tm(x, -0.1, z), color: c4(blk), bone: b + pr });
  }
  return { geo: skinGeo(p), glow: skinGeo(g) };
}
// pose: x, y (the ground or a rail under it), z, yaw; walk: stride phase or null (sitting); arch 0..1
export function poseCat(B, i, x, y, z, yaw, ph, t, arch = 0) {
  const V = j => B.subarray((i * 5 + j) * 16, (i * 5 + j + 1) * 16), walking = ph != null;
  M.m4fromYaw(MR, x, y + (walking ? 0.2 : 0.14) + arch * 0.08, z, yaw);
  joint(V(0), MR, 0, 0, 0, walking ? 0 : -0.45 + arch * 0.45, 0, 0, 'x');
  joint(V(1), V(0), 0, 0.08, 0.2, walking ? 0.1 : 0.3, Math.sin(t * 0.7) * 0.4, 0, 'yxz');
  joint(V(2), V(0), 0, 0.05, -0.2, walking ? -0.3 : -1.0 + arch * 1.2, Math.sin(t * 2.3) * (walking ? 0.2 : 0.5), 0, 'yx');
  const sw = walking ? Math.sin(ph) * 0.6 : 0;
  joint(V(3), V(0), 0, -0.04, 0, walking ? sw : 0.9, 0, 0, 'x'); joint(V(4), V(0), 0, -0.04, 0, walking ? -sw : 0.9, 0, 0, 'x');
}
// ---- bats: bones 3i body, +1 left wing, +2 right wing; dark, the wings flat scalloped fans
export function batGeo(n = 8, s = 1) {
  const p = [], tri = (a, b2, c, bone) => p.push({ geo: { position: new Float32Array([...a, ...b2, ...c]), normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), uv: new Float32Array(6), index: new Uint16Array([0, 1, 2]) }, color: c4('#141016'), bone });
  for (let i = 0; i < n; i++) {
    const b = i * 3;
    p.push({ geo: G.sphere(0.05 * s, 6, 4, { sz: 1.6 }), matrix: Tm(0, 0, 0), color: c4('#0e0a0e'), bone: b });
    for (const sx of [-1, 1]) p.push({ geo: G.cylinder(0.002, 0.018 * s, 0.05 * s, 3, { y0: true }), matrix: Tm(sx * 0.022 * s, 0.03 * s, 0.05 * s), color: c4('#0e0a0e'), bone: b });
    for (const [sx, wb] of [[1, b + 1], [-1, b + 2]]) {
      const w = [[0, 0, 0.04], [0.14, 0.02, 0.06], [0.3, 0.0, 0.03], [0.34, 0, -0.06], [0.22, 0, -0.03], [0.14, 0, -0.08], [0.04, 0, -0.06]].map(([x, y, z]) => [x * sx * s, y * s, z * s]);
      for (let k = 1; k < w.length - 1; k++) tri(w[0], sx > 0 ? w[k] : w[k + 1], sx > 0 ? w[k + 1] : w[k], wb);
    }
  }
  return skinGeo(p);
}
export function poseBat(B, i, x, y, z, yaw, flap, pitch = 0, k = 1) {
  const V = j => B.subarray((i * 3 + j) * 16, (i * 3 + j + 1) * 16);
  M.m4fromYaw(MR, x, y, z, yaw, k);
  joint(V(0), MR, 0, 0, 0, pitch, 0, 0, 'x');
  joint(V(1), V(0), 0.03, 0, 0, 0, 0, Math.sin(flap) * 0.9, 'z'); joint(V(2), V(0), -0.03, 0, 0, 0, 0, -Math.sin(flap) * 0.9, 'z');
}
