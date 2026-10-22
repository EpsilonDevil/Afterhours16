// v0.4.8.8 The Pro-Am Overhaul: the twelve Pro-Am parks, the home courts a Pro-Am team plays on (docs/PROAM-OVERHAUL.md
// §7). Each one is one regulation full court in a place of its own (under a highway, on the sand, in a gym, on a roof...)
// wearing the home team's colours and logo at center court and on its banners (paintHome), with its own clubhouse beside
// the court (the Hub agent's Gold teams walk out of it: clubhouse.door / clubhouse.anchor), and a time of day, weather
// and crowd drawn from the game's seed (proamLook: the same on every screen of an online game, nothing from outside it).
// buildProamPark(r, scene, id, {home, seed}) → the venue a MatchSession plays on: {theme, look, courts, hoops, bounds,
// solids, clubhouse, spawn, update, paintHome}. clubhouse.door {x, z, yaw, at}: where you stand on the ground outside it
// (at the foot of any steps), yaw the way it faces out, at the door itself ({x, z, y}: y its floor when it's raised);
// clubhouse.anchor {x, y, z, yaw, w, d}: the room inside (its centre, floor height, size); style: which clubhouse. The themes are THEMES.proam_<id> (kind 'proam': world/venues.js
// buildVenue builds them here). Budgets: about 120k triangles a park, eight lights at most, the crowd instanced.
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG, hashString } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { buildCourt, buildHoop, cachedTexture } from './court.js';
import * as PR from './props.js';
import { THEMES } from './themes.js';
import { COURT } from '../sim/constants.js';
import { audio } from '../core/audio.js';

const lin = hex => M.hexLinear(hex);
const c4 = hex => [...lin(hex), 1];
const TR = (x, y, z, yaw = 0, s = 1) => M.m4fromYaw(M.m4(), x, y, z, yaw, s);
const put = (out, geo, x, y, z, hex, yaw = 0) => { out.push({ geo, matrix: TR(x, y, z, yaw), color: Array.isArray(hex) ? hex : c4(hex) }); return out; };
const W2 = COURT.width / 2, L2 = COURT.length / 2; // (7.62, 14.325)

// ---------------- the twelve ----------------
// tods: the times of day it can be played at (weighted by repeats); indoor: no sky weather, the windows show the time
export const PROAM_PARKS = [
  { id: 'overpass', name: 'Under the Overpass', tods: ['day', 'dusk', 'night', 'night'], surface: 'asphalt', base: { court: '#465560', apron: '#2c3136', lines: '#efe9dc' } },
  { id: 'longbeach', name: 'Long Beach', tods: ['day', 'day', 'dusk', 'night'], weathers: ['clear', 'clear', 'clear', 'clear', 'haze', 'overcast'], surface: 'asphalt', base: { court: '#2f7f9c', apron: '#e2c799', lines: '#fbf5e6' } },
  { id: 'aau', name: 'AAU Gym', indoor: true, tods: ['day', 'dusk', 'night'], surface: 'wood', base: { court: '#c99a63', apron: '#a87a48', lines: '#f8f4ec' } },
  { id: 'rooftop', name: 'Rooftop', tods: ['day', 'dusk', 'dusk', 'night'], surface: 'asphalt', base: { court: '#38404a', apron: '#24282d', lines: '#f3efe4' } },
  { id: 'projects', name: 'Projects', tods: ['day', 'dusk', 'night'], surface: 'asphalt', base: { court: '#5b4a42', apron: '#3a3532', lines: '#f1ead8' } },
  { id: 'riverside', name: 'Riverside', tods: ['day', 'dusk', 'night', 'night'], surface: 'asphalt', base: { court: '#2d5a4a', apron: '#33393b', lines: '#eef0e6' } },
  { id: 'warehouse', name: 'Old Warehouse', indoor: true, tods: ['day', 'dusk', 'night'], surface: 'wood', base: { court: '#9c7244', apron: '#4a3b30', lines: '#f2ede0' } },
  { id: 'schoolyard', name: 'Schoolyard', tods: ['day', 'day', 'dusk'], surface: 'asphalt', base: { court: '#3f6fa8', apron: '#55606a', lines: '#ffffff' } },
  { id: 'cage', name: 'The Cage', tods: ['day', 'dusk', 'night', 'night'], surface: 'asphalt', base: { court: '#3a3f44', apron: '#2a2d30', lines: '#f4f0e2' } },
  { id: 'rec', name: 'Suburban Rec Center', indoor: true, tods: ['day', 'dusk', 'night'], surface: 'wood', base: { court: '#d6aa72', apron: '#b98a55', lines: '#2a2a2a' } },
  { id: 'desert', name: 'Desert Dusk', tods: ['dusk', 'dusk', 'dusk', 'night'], surface: 'asphalt', base: { court: '#a4583a', apron: '#c99a6a', lines: '#fbf1dc' } },
  { id: 'market', name: 'Night Market', tods: ['night', 'night', 'dusk'], surface: 'asphalt', base: { court: '#4a2f3e', apron: '#2e2328', lines: '#f6e7c8' } },
];
export const PROAM_IDS = PROAM_PARKS.map(p => p.id);
export const proamInfo = id => PROAM_PARKS.find(p => p.id === id) || null;
const WEATHERS = ['clear', 'clear', 'clear', 'overcast', 'overcast', 'haze', 'rain'];

// the look of one game: time of day, weather and crowd, from the park and the game's seed only (online, every screen
// draws the same: no clock, no Math.random). {tod: day|dusk|night, weather: clear|overcast|haze|rain|indoor, crowd: 0.35-1}
export function proamLook(id, seed = 0) {
  const P = proamInfo(id) || PROAM_PARKS[0], rng = new RNG((hashString(`proam|${P.id}`) ^ (seed >>> 0)) >>> 0 || 1);
  const tod = rng.pick(P.tods);
  let weather = P.indoor ? 'indoor' : rng.pick(P.weathers || WEATHERS);
  if (P.id === 'desert' && weather === 'rain') weather = 'haze'; // (it doesn't rain out there)
  if (P.id === 'market' && weather === 'haze') weather = 'clear';
  const crowd = Math.round((0.35 + rng.next() * 0.65) * 100) / 100;
  return { tod, weather, crowd, seed: seed >>> 0 };
}

// ---------------- light: the time of day and the weather ----------------
const LIGHT = {
  day: {
    sky: { top: [0.2, 0.38, 0.72], horizon: [0.72, 0.8, 0.9], ground: [0.32, 0.3, 0.28], stars: 0 },
    sun: { dir: [-0.45, 0.82, 0.35], color: [1.0, 0.95, 0.86], intensity: 3.7 },
    ambient: { sky: [0.46, 0.52, 0.62], ground: [0.26, 0.23, 0.2] },
    fog: { color: [0.7, 0.78, 0.86], density: 0.0026 },
    env: { top: '#4a74ba', horizon: '#d2e2ee', ground: '#5e5a54' },
    exposure: 1.0, bloom: { strength: 0.05, threshold: 1.2, radius: 1 }, grade: { saturation: 1.06, contrast: 1.04, vignette: 0.42 }, envIntensity: 0.95,
  },
  dusk: {
    sky: { top: [0.16, 0.2, 0.42], horizon: [1.0, 0.54, 0.3], ground: [0.32, 0.23, 0.19], stars: 0.05 },
    sun: { dir: [-0.78, 0.26, 0.55], color: [1.0, 0.64, 0.38], intensity: 3.2 },
    ambient: { sky: [0.4, 0.34, 0.48], ground: [0.3, 0.2, 0.15] },
    fog: { color: [0.84, 0.56, 0.44], density: 0.0032 },
    env: { top: '#3a3f7a', horizon: '#ff9a5c', horizonLow: '#f2b680', ground: '#6b5848', lights: [{ u: 0.12, v: 0.44, r: 0.06, color: 'rgba(255,210,160,1)' }] },
    exposure: 1.06, bloom: { strength: 0.09, threshold: 1.1, radius: 1 }, grade: { saturation: 1.1, contrast: 1.05, vignette: 0.55 }, envIntensity: 0.85,
  },
  night: {
    sky: { top: [0.012, 0.016, 0.045], horizon: [0.09, 0.08, 0.13], ground: [0.03, 0.03, 0.03], stars: 1 },
    sun: { dir: [0.2, 1, 0.25], color: [0.85, 0.88, 1.0], intensity: 1.6 },
    ambient: { sky: [0.12, 0.13, 0.2], ground: [0.08, 0.06, 0.05] },
    fog: { color: [0.06, 0.06, 0.09], density: 0.011 },
    env: { top: '#05060c', horizon: '#2a2533', ground: '#141414', skyline: '#0c0c12', lights: [{ u: 0.3, v: 0.42, r: 0.03, color: 'rgba(255,240,200,1)' }, { u: 0.72, v: 0.42, r: 0.03, color: 'rgba(255,240,200,1)' }] },
    exposure: 1.15, bloom: { strength: 0.13, threshold: 1.0, radius: 1.1 }, grade: { saturation: 1.05, contrast: 1.08, vignette: 0.7 }, envIntensity: 0.6,
  },
};
const mixC = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// lit windows by the time of day (dark by day, a glow at dusk, bright at night)
const win = (look, k = 1) => (look.tod === 'night' ? [1.6 * k, 1.4 * k, 1.1 * k] : look.tod === 'dusk' ? [0.5 * k, 0.44 * k, 0.34 * k] : [0, 0, 0]);
const TINTS = ['#ffffff', '#e8dcd0', '#d6dde6', '#f0e6d2', '#c9c4bc', '#e6d0c4', '#d0d8cc'];
// the theme lighting for a park and a look (indoor parks: the hall's own light, the sky only through the windows)
export function proamLighting(id, look) {
  const P = proamInfo(id) || PROAM_PARKS[0], L = JSON.parse(JSON.stringify(LIGHT[look.tod] || LIGHT.day));
  if (P.indoor) {
    L.sky = { top: [0.1, 0.1, 0.11], horizon: [0.16, 0.15, 0.14], ground: [0.08, 0.07, 0.06], stars: 0 };
    L.sun = { dir: [0.3, 1, 0.2], color: [1, 0.97, 0.9], intensity: 0.9 };
    L.ambient = { sky: [0.42, 0.4, 0.38], ground: [0.26, 0.22, 0.18] };
    L.fog = { color: [0.2, 0.19, 0.18], density: 0.004 };
    L.env = { top: '#3a3836', horizon: '#8a8070', ground: '#3a2c20', lights: [{ u: 0.25, v: 0.2, r: 0.05, color: 'rgba(255,250,235,1)' }, { u: 0.75, v: 0.2, r: 0.05, color: 'rgba(255,250,235,1)' }] };
    L.exposure = 1.0; L.envIntensity = 0.75; L.bloom = { strength: 0.06, threshold: 1.15, radius: 1 };
    return L;
  }
  if (look.weather === 'overcast' || look.weather === 'rain') {
    const g = look.tod === 'night' ? 0.4 : 1;
    L.sky.top = mixC(L.sky.top, [0.42 * g, 0.44 * g, 0.47 * g], 0.75); L.sky.horizon = mixC(L.sky.horizon, [0.62 * g, 0.63 * g, 0.64 * g], 0.7);
    L.sun.intensity *= look.weather === 'rain' ? 0.32 : 0.45; L.ambient.sky = mixC(L.ambient.sky, [0.5 * g, 0.52 * g, 0.56 * g], 0.5);
    L.fog = { color: mixC(L.fog.color, [0.55 * g, 0.57 * g, 0.6 * g], 0.7), density: L.fog.density * (look.weather === 'rain' ? 3 : 2) };
    L.env = { ...L.env, top: look.tod === 'night' ? '#141518' : '#6d7178', horizon: look.tod === 'night' ? '#2a2b30' : '#9fa3a8' };
    L.grade.saturation *= 0.85; L.sky.stars = 0;
  } else if (look.weather === 'haze') {
    L.fog = { color: mixC(L.fog.color, look.tod === 'night' ? [0.12, 0.11, 0.12] : [0.86, 0.8, 0.7], 0.5), density: L.fog.density * 2.6 };
    L.sun.intensity *= 0.8; L.grade.contrast *= 0.96;
  }
  if (P.id === 'desert') { L.sky.horizon = look.tod === 'night' ? [0.14, 0.08, 0.14] : [1.0, 0.42, 0.22]; L.sky.top = look.tod === 'night' ? [0.02, 0.015, 0.06] : [0.22, 0.14, 0.38]; L.fog.density *= 0.45; L.sun.dir = [-0.82, 0.16, 0.55]; }
  if (P.id === 'market') { L.sky.stars = 0.4; }
  if (P.id === 'longbeach') { L.fog.density *= 0.5; if (look.tod === 'dusk') L.sun.dir = [0.78, 0.24, -0.5]; } // (the sun goes down over the ocean, in front of the broadcast camera)
  return L;
}
function applyLook(r, scene, id, look) {
  const L = proamLighting(id, look);
  scene.sky = { ...L.sky };
  scene.sun = { ...L.sun, dir: M.v3norm([0, 0, 0], L.sun.dir) };
  scene.ambient = { ...L.ambient };
  scene.fog = { ...L.fog };
  scene.exposure = L.exposure; scene.bloom = { ...L.bloom }; scene.grade = { ...L.grade }; scene.envIntensity = L.envIntensity ?? 1;
  scene.env = cachedTexture(r.ctx, `env-proam-${id}-${look.tod}-${look.weather}`, () => T.envMap(L.env), {});
  return L;
}

// ---------------- the themes (THEMES.proam_<id>) ----------------
function themeOf(P) {
  const L = LIGHT[P.tods[0]];
  return {
    id: 'proam_' + P.id, kind: 'proam', proam: P.id, name: P.name, style: 'proam', indoor: !!P.indoor,
    court: { surface: P.surface, court: P.base.court, apron: P.base.apron, paint: P.base.court, lines: P.base.lines, wear: P.surface === 'wood' ? 0.15 : 0.55, logo: { shape: 'circle', color: P.base.court, accent: P.base.lines, text: 'PRO-AM', size: 1.5 }, baselineText: 'PRO-AM', asphaltTint: '#d8d4cc' },
    ...JSON.parse(JSON.stringify(L)), floodlights: false,
  };
}
export const PROAM_THEMES = PROAM_PARKS.map(themeOf);
for (const t of PROAM_THEMES) THEMES[t.id] = t;

// ---------------- the home team on the court and the banners ----------------
const DEFAULT_HOME = { name: 'Pro-Am', abbr: 'PRO', primary: '#c8452e', secondary: '#f4efe4', logo: 'circle' };
const readable = hex => { const c = M.hexToRgb(hex); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.6 ? '#15171b' : '#f6f2ea'; };
// the court spec with the home team's colours: their paint in the keys, their logo at center court, their name on the baselines
export function homeCourtSpec(P, home = DEFAULT_HOME) {
  const t = { ...DEFAULT_HOME, ...(home || {}) }, base = themeOf(P).court;
  return {
    ...base, paint: t.primary, apron: P.surface === 'wood' ? base.apron : base.apron,
    logo: { shape: t.logo || 'circle', color: t.primary, accent: t.secondary || '#f6f1e6', text: String(t.abbr || 'PRO').slice(0, 4).toUpperCase(), size: 1.6 },
    sideText: String(t.name || 'PRO-AM').toUpperCase(), baselineText: String(t.name || 'PRO-AM').toUpperCase(), woodTone: t.wood || undefined,
  };
}
function bannerCanvas(home, kind = 'name') {
  const t = { ...DEFAULT_HOME, ...(home || {}) }, ink = t.secondary && t.secondary !== t.primary ? t.secondary : readable(t.primary);
  if (kind === 'name') return T.banner(String(t.name || 'PRO-AM').toUpperCase().slice(0, 18), { w: 1024, h: 256, bg: t.primary, color: ink, size: 92, sub: 'HOME OF THE ' + String(t.abbr || 'PRO').toUpperCase(), stripe: ink });
  // the logo banner (tall): the team's logo on its colours
  const c = T.canvas(256, 512), g = c.getContext('2d');
  g.fillStyle = t.primary; g.fillRect(0, 0, 256, 512);
  g.fillStyle = ink; g.fillRect(0, 470, 256, 42);
  T.drawLogo(g, { shape: t.logo || 'circle', color: t.primary, accent: ink, text: String(t.abbr || 'PRO').slice(0, 4).toUpperCase() }, 128, 230, 100);
  return c;
}

// ---------------- shared pieces ----------------
function mats(ctx) {
  return {
    matte: new Material({ color: [1, 1, 1], roughness: 0.84 }),
    metal: new Material({ color: [1, 1, 1], roughness: 0.42, metalness: 0.65 }),
    foliage: new Material({ color: [1, 1, 1], roughness: 0.9, shading: 'cloth', sheen: [0.05, 0.08, 0.04] }),
    glow: new Material({ color: [2.6, 2.6, 2.6], shading: 'unlit', fog: false }), // (unlit: the vertex colours times this; an emissive would wash them all white)
  };
}
function batch(ctx, scene, parts, mat, opts = {}) {
  if (!parts.length) return null;
  const mesh = new Mesh(ctx.geometry(G.merge(parts)), mat, { castShadow: opts.castShadow ?? true, reflect: opts.reflect ?? true });
  if (opts.order != null) mesh.order = opts.order;
  scene.add(mesh);
  return mesh;
}
// a box whose texture tiles every tu metres across and tv metres up (facades, brick, concrete)
function texBox(w, h, d, tu, tv) {
  const g = G.box(w, h, d, { tile: 1 });
  for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] /= tu; g.uv[i + 1] /= tv; }
  return g;
}
function texQuad(w, h, tu, tv, opts = {}) {
  const g = G.quad(w, h, opts);
  for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] *= w / tu; g.uv[i + 1] *= h / tv; }
  return g;
}
// the ground: a big textured plane (tile metres a repeat), slightly under the court
// (rect [cx, cz, w, d]: a rectangle of it instead, e.g. the land up to a shore)
function ground(ctx, scene, key, make, size, tile, tint = '#ffffff', y = -0.004, rough = 0.9, rect = null) {
  const tex = cachedTexture(ctx, 'pg-' + key, () => make().color, { aniso: 8 });
  const [cx, cz, w, d] = rect || [0, 0, size, size];
  const geo = G.plane(w, d, 1, 1);
  for (let i = 0; i < geo.uv.length; i += 2) { geo.uv[i] *= w / tile; geo.uv[i + 1] *= d / tile; }
  const m = new Mesh(ctx.geometry(geo), new Material({ map: tex, color: lin(tint), roughness: rough }), { castShadow: false, reflect: false });
  m.matrix[12] = cx; m.matrix[13] = y; m.matrix[14] = cz; m.order = -2; scene.add(m);
  return m;
}
// a gable roof (a triangular prism): w across the ridge, d along it, h from the eaves to the ridge, sitting on y 0
function gable(w, d, h) {
  const P = [], N = [], U = [], I = [];
  const face = (vs, n) => { const k = P.length / 3; for (const [x, y, z, u, v] of vs) { P.push(x, y, z); N.push(...n); U.push(u, v); } if (vs.length === 3) I.push(k, k + 1, k + 2); else I.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  const a = w / 2, b = d / 2, s = Math.hypot(a, h), nx = h / s, ny = a / s;
  face([[-a, 0, b, 0, 0], [a, 0, b, 1, 0], [0, h, b, 0.5, 1]], [0, 0, 1]);
  face([[a, 0, -b, 0, 0], [-a, 0, -b, 1, 0], [0, h, -b, 0.5, 1]], [0, 0, -1]);
  face([[a, 0, b, 0, 0], [a, 0, -b, 1, 0], [0, h, -b, 1, 1], [0, h, b, 0, 1]], [nx, ny, 0]);
  face([[-a, 0, -b, 0, 0], [-a, 0, b, 1, 0], [0, h, b, 1, 1], [0, h, -b, 0, 1]], [-nx, ny, 0]);
  return { position: new Float32Array(P), normal: new Float32Array(N), uv: new Float32Array(U), index: new Uint16Array(I) };
}
const TRS = (x, y, z, yaw, sx, sy, sz) => M.m4compose(M.m4(), [x, y, z], M.qaxis(M.q4(), 0, 1, 0, yaw), [sx, sy, sz]);
// a lit sign (a banner texture on a quad): unlit by default so it reads at night
function sign(ctx, scene, key, text, o, x, y, z, yaw, w, h, lit = true) {
  const tex = cachedTexture(ctx, key, () => T.banner(text, o), {});
  const m = new Mesh(ctx.geometry(G.quad(w, h)), new Material(lit ? { map: tex, shading: 'unlit', color: [1.3, 1.3, 1.3] } : { map: tex, roughness: 0.8 }), { castShadow: false });
  M.m4fromYaw(m.matrix, x, y, z, yaw); scene.add(m);
  return m;
}
// chain-link runs [[x0, z0, x1, z1]...] h tall (y0: standing on something)
function fences(env, runs, h, color = '#59636b', y0 = 0) {
  const { ctx, scene, metal } = env, fp = [];
  const lift = m => (y0 ? M.m4mul(M.m4(), TR(0, y0, 0), m || M.m4()) : m);
  for (const [x0, z0, x1, z1] of runs) { const m = PR.fenceMesh(x0, z0, x1, z1, h); fp.push({ geo: m.geo, matrix: lift(m.matrix) }); metal.push(...PR.fenceFrame(x0, z0, x1, z1, h, color).map(p => ({ ...p, matrix: lift(p.matrix) }))); }
  scene.add(new Mesh(ctx.geometry(G.merge(fp, false)), new Material({ map: cachedTexture(ctx, 'chainlink', () => T.chainlink(256), {}), alphaTest: 0.5, doubleSided: true, roughness: 0.5, metalness: 0.6 }), { castShadow: false }));
}
// a city block of buildings with lit windows: [{x, z, w, d, h, yaw}] in one mesh (one facade texture)
function blocks(ctx, scene, list, key, opts = {}) {
  if (!list.length) return null;
  // (opts.detail {bays, floors, kind}: the detailed facade, brick or stone, a texture repeat every bays x 3.2 m by
  // floors x 3.4 m; both maps from one draw)
  let fac = null;
  const draw = () => fac || (fac = T.facade({ wall: opts.wall || '#6a5e58', glass: opts.glass || '#26313a', lit: opts.lit ?? 0.4, cols: 6, rows: 8, seed: opts.seed || 41, detail: opts.detail }));
  const f = cachedTexture(ctx, 'pf-' + key, () => draw().color, { aniso: 8 });
  const e = cachedTexture(ctx, 'pfe-' + key, () => draw().emissive, {});
  const tu = opts.detail ? opts.detail.bays * 3.2 : opts.tu || 12, tv = opts.detail ? opts.detail.floors * 3.4 : opts.tv || 24;
  const parts = list.map(b => ({ geo: texBox(b.w, b.h, b.d, tu, tv), matrix: TR(b.x, b.h / 2 + (b.y || 0), b.z, b.yaw || 0), color: b.tint ? c4(b.tint) : [1, 1, 1, 1] }));
  const mat = new Material({ map: f, emissiveMap: e, emissive: opts.emissive || [0, 0, 0], roughness: 0.85 });
  const m = new Mesh(ctx.geometry(G.merge(parts)), mat, { castShadow: !!opts.shadow, reflect: false });
  scene.add(m);
  return m;
}
// the instanced crowd: seats [{x, y, z, yaw}] filled to the look's crowd, in the home team's colours more than not
// (standing spectators, s.stand: the same figure on legs, a second instanced mesh)
const standPerson = () => G.merge([
  { geo: PR.crowdPerson(), matrix: TR(0, 0.78, 0) },
  ...[-0.08, 0.08].map(dx => ({ geo: G.cylinder(0.07, 0.06, 0.8, 5, { y0: true, open: true }), matrix: TR(dx, 0, 0) })),
], false);
function crowdMesh(ctx, scene, seats, rng, home, fill) {
  const sit = seats.filter(s => !s.stand), stand = seats.filter(s => s.stand);
  const a = crowdSet(ctx, scene, sit, rng, home, fill, false), b = crowdSet(ctx, scene, stand, rng, home, fill, true);
  return a || b ? { sit: a, stand: b, count: (a?.count || 0) + (b?.count || 0) } : null;
}
function crowdSet(ctx, scene, seats, rng, home, fill, standing) {
  const shirts = ['#e8e3d8', '#2a2c31', '#b8322f', '#2457c5', '#8d8f93', '#f2c14e', '#3a7a4a'];
  const take = seats.filter(() => rng.next() < fill);
  if (!take.length) return null;
  const geo = ctx.geometry(standing ? standPerson() : PR.crowdPerson());
  const data = new Float32Array(take.length * 20);
  take.forEach((s, i) => {
    data.set(M.m4fromYaw(M.m4(), s.x, s.y, s.z, s.yaw + rng.range(-0.25, 0.25), (0.9 + rng.next() * 0.18) * (s.scale || 1)), i * 20);
    const shirt = rng.next() < 0.45 ? (rng.next() < 0.7 ? home.primary : home.secondary || '#f4efe4') : rng.pick(shirts);
    const c = M.hexLinear(shirt).map(v => v * 0.6 + 0.012);
    data.set([c[0], c[1], c[2], rng.next()], i * 20 + 16);
  });
  ctx.setInstances?.(geo, data, take.length);
  geo.bounds = { center: [0, 2, 0], radius: 60 };
  const mesh = new Mesh(geo, new Material({ color: [1, 1, 1], roughness: 0.85, crowd: true, shading: 'cloth', sheen: [0.1, 0.1, 0.1] }), { castShadow: false, reflect: false });
  scene.add(mesh);
  mesh.count = take.length;
  return mesh;
}
// a row of standing spectators along a line (a, b), facing the court
function standRow(seats, ax, az, bx, bz, n, y = 0, faceTo = [0, 0]) {
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; seats.push({ x, y, z, yaw: Math.atan2(faceTo[0] - x, faceTo[1] - z), stand: true }); }
}
// seats on a bleacher (PR.bleacher's rows): w wide, rows deep, at x, z facing yaw
function bleacherSeats(seats, x, z, yaw, w, rows) {
  for (let r = 0; r < rows; r++) for (let k = 0; k < Math.floor(w / 0.6); k++) {
    const along = -w / 2 + (k + 0.5) * (w / Math.floor(w / 0.6)), m = M.m4mul(M.m4(), TR(x, 0, z, yaw), TR(along, 0.48 + r * 0.42, -r * 0.62));
    seats.push({ x: m[12], y: m[13], z: m[14], yaw });
  }
}
// floodlight towers at the court's corners (night: the lights; any time: the towers)
function floodTowers(parts, glow, at = [[-W2 - 6, -L2 - 3], [W2 + 6, -L2 - 3], [-W2 - 6, L2 + 3], [W2 + 6, L2 + 3]], h = 11, color = '#2a3036') {
  for (const [x, z] of at) {
    const yaw = Math.atan2(-x, -z);
    parts.push(...PR.lightPole(x, z, yaw, h, color));
    glow.push(...PR.lampFaces(x, z, yaw, h));
  }
}
function nightLights(scene, look, color = [1, 0.95, 0.85], k = 1) {
  if (look.tod !== 'night' && look.weather !== 'rain' && look.weather !== 'indoor') return;
  const I = (look.tod === 'night' ? 26 : 12) * k;
  scene.lights.push({ pos: [-9, 11, -10], range: 36, color, intensity: I, dir: [0.45, -1, 0.4], cos: 0.55 });
  scene.lights.push({ pos: [9, 11, 10], range: 36, color, intensity: I, dir: [-0.45, -1, -0.4], cos: 0.55 });
  scene.lights.push({ pos: [9, 11, -10], range: 36, color, intensity: I * 0.8, dir: [-0.45, -1, 0.4], cos: 0.55 });
  scene.lights.push({ pos: [-9, 11, 10], range: 36, color, intensity: I * 0.8, dir: [0.45, -1, -0.4], cos: 0.55 });
}
// rain over the court and its surrounds: streaks the vertex shader rains down (shaders.js RAIN), no per-frame uploads
function rainMesh(ctx, scene, rng, area = 26, n = 2400) {
  const H = 18, pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    const x = (rng.next() * 2 - 1) * area, z = (rng.next() * 2 - 1) * area * 1.3, y = rng.next() * H, len = 0.5 + 0.4 * rng.next(), w = 0.006 + 0.005 * rng.next(), k = i * 4;
    for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { pos.push(x, y, z); nrm.push(len, w, 0); uv.push(sx, sy); }
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const geo = ctx.geometry({ position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), index: new Uint16Array(idx) });
  const m = new Mesh(geo, new Material({ color: [0.5, 0.56, 0.64], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true, rain: [H, 15, 0.6, 0.25] }), { castShadow: false, reflect: false });
  m.order = 6; scene.add(m);
  return m;
}
// a banner on its own: a flat quad facing yaw (one shared texture per set, so paintHome swaps it once)
// (two faces back to back: it reads right from the court and from behind it, where the game cameras often are)
function bannerQuad(ctx, scene, mat, x, y, z, yaw, w, h, list) {
  const geo = ctx.geometry(G.quad(w, h));
  for (const [dy, ox] of [[0, 0], [Math.PI, 0.012]]) {
    const m = new Mesh(geo, mat, { castShadow: false });
    M.m4fromYaw(m.matrix, x - Math.sin(yaw) * ox, y, z - Math.cos(yaw) * ox, yaw + dy);
    scene.add(m); list.push(m);
  }
  return list.at(-1);
}
// the clubhouse sign and door: a lit sign over a door, the door itself (a dark panel with a frame); returns the door spot
function clubDoor(parts, glow, x, z, yaw, opts = {}) {
  const at = (dx, dy, dz) => M.m4mul(M.m4(), TR(x, 0, z, yaw), TR(dx, dy, dz));
  parts.push({ geo: G.box(1.5, 2.35, 0.08), matrix: at(0, 1.175, 0.02), color: c4(opts.door || '#2a2522') });
  parts.push({ geo: G.box(1.75, 0.12, 0.14), matrix: at(0, 2.42, 0.05), color: c4(opts.frame || '#8a8f94') });
  for (const sx of [-1, 1]) parts.push({ geo: G.box(0.12, 2.42, 0.14), matrix: at(sx * 0.82, 1.21, 0.05), color: c4(opts.frame || '#8a8f94') });
  parts.push({ geo: G.box(0.06, 0.06, 0.12), matrix: at(0.5, 1.1, 0.1), color: c4('#c9c2b0') });
  glow.push({ geo: G.box(1.2, 0.05, 0.06), matrix: at(0, 2.6, 0.1), color: [1, 0.92, 0.75, 1] });
  const out = at(0, 0, 1.3);
  return { x: out[12], z: out[14], yaw, at: { x, z } };
}

// the clubhouse's marquee: a lit sign box you can read from the court (CLUBHOUSE and what it is), two lamps over it;
// at dusk and night a warm light at the door (env.lights, while there's room)
function clubMarquee(env, key, sub, x, y, z, yaw, w = 3.8, col = '#ffb347', bg = '#14161a', door = null) {
  const { ctx, scene, matte, glow, look } = env, h = w * 0.27;
  const at = (dx, dy, dz) => M.m4mul(M.m4(), TR(x, y, z, yaw), TR(dx, dy, dz));
  matte.push({ geo: G.box(w + 0.24, h + 0.24, 0.22), matrix: at(0, 0, -0.12), color: c4('#1a1c20') });
  const tex = cachedTexture(ctx, 'clubm-' + key, () => T.banner('CLUBHOUSE', { w: 512, h: 140, bg, color: col, size: 58, sub, stripe: col }), {});
  const m = new Mesh(ctx.geometry(G.quad(w, h)), new Material({ map: tex, shading: 'unlit', color: [1.45, 1.45, 1.45], fog: false }), { castShadow: false });
  M.m4mul(m.matrix, TR(x, y, z, yaw), TR(0, 0, 0.006)); scene.add(m);
  for (const sx of [-1, 1]) { matte.push({ geo: G.box(0.05, 0.05, 0.5), matrix: at(sx * w * 0.32, h / 2 + 0.14, 0.2), color: c4('#2a2d30') }); glow.push({ geo: G.cylinder(0.09, 0.14, 0.12, 8), matrix: at(sx * w * 0.32, h / 2 + 0.1, 0.45), color: [1, 0.9, 0.7, 1] }); }
  if (door && look.tod !== 'day') env.lights.push({ pos: [door.x, 2.8, door.z], range: 10, color: [1, 0.82, 0.55], intensity: 5, dir: null });
  return m;
}
// traffic: cars (and the first opts.buses as buses) moving along lanes [{x0, z0, dx, dz, y, dir, len}], instanced: one
// draw for each kind's bodies and one for their lights (headlights white, tail lights red; dim by day). → {step(dt)}
const PAINTS = ['#d8d4cc', '#1e1f22', '#7a1f1c', '#2a4a7a', '#f2c14e', '#5a6066', '#e8e4dc', '#3a5a3a'];
function traffic(env, lanes, n, opts = {}) {
  const { ctx, scene, fixed, look } = env, lit = look.tod === 'day' ? 0.35 : look.tod === 'dusk' ? 1.4 : 2.6;
  const kinds = [{ geo: G.merge(PR.car('#ffffff'), true), lights: G.merge(PR.carLights(4.4), true) }, { geo: G.merge(PR.bus('#ffffff'), true), lights: G.merge(PR.busLights(), true), bus: true }];
  const groups = [[], []];
  for (let i = 0; i < n; i++) { const L = lanes[i % lanes.length], b = i < (opts.buses || 0) ? 1 : 0; groups[b].push({ lane: L, s: fixed.range(-L.len / 2, L.len / 2), v: fixed.range(opts.vmin || 10, opts.vmax || 18) * (b ? 0.8 : 1), paint: b ? fixed.pick(['#2457a5', '#d8d4cc', '#c8302a', '#e8a82a']) : fixed.pick(PAINTS) }); }
  const sets = kinds.map((K, ki) => {
    const list = groups[ki]; if (!list.length) return null;
    const body = ctx.geometry(K.geo), lg = ctx.geometry(K.lights);
    body.bounds = lg.bounds = opts.bounds || { center: [0, 2, 0], radius: 130 };
    const bm = new Mesh(body, new Material({ color: [1, 1, 1], roughness: 0.4, metalness: 0.3 }), { castShadow: false, reflect: false });
    const lm = new Mesh(lg, new Material({ color: [lit, lit, lit], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
    scene.add(bm); scene.add(lm); bm.count = lm.count = list.length;
    return { list, body, lg, bd: new Float32Array(list.length * 20), ld: new Float32Array(list.length * 20), bus: !!K.bus };
  }).filter(Boolean);
  const place = () => {
    for (const S of sets) {
      S.list.forEach((c, i) => {
        const L = c.lane, m = M.m4fromYaw(M.m4(), L.x0 + L.dx * c.s, L.y, L.z0 + L.dz * c.s, Math.atan2(L.dx * L.dir, L.dz * L.dir)), p = M.hexLinear(c.paint);
        S.bd.set(m, i * 20); S.bd.set([p[0], p[1], p[2], 1], i * 20 + 16); S.ld.set(m, i * 20); S.ld.set([1, 1, 1, 1], i * 20 + 16);
      });
      ctx.setInstances?.(S.body, S.bd, S.list.length); ctx.setInstances?.(S.lg, S.ld, S.list.length);
    }
  };
  place();
  return { sets, step(dt) { for (const S of sets) for (const c of S.list) { c.s += c.v * dt * c.lane.dir; const h = c.lane.len / 2; if (c.s > h) c.s -= 2 * h; if (c.s < -h) c.s += 2 * h; } place(); opts.onStep?.(sets); } };
}

// ---------------- the builder ----------------
// opts.home: the home team {name, abbr, primary, secondary, logo, wood}; opts.seed: the game's seed (the look)
export function buildProamPark(r, scene, id, opts = {}) {
  const P = proamInfo(id) || PROAM_PARKS[0], ctx = r.ctx, seed = opts.seed >>> 0 || 0;
  const look = opts.look || proamLook(P.id, seed), home = { ...DEFAULT_HOME, ...(opts.home || {}) };
  const theme = THEMES['proam_' + P.id];
  scene.lights.length = 0;
  applyLook(r, scene, P.id, look);
  const rng = new RNG((hashString(`proam-build|${P.id}`) ^ seed) >>> 0 || 7); // (the crowd and the little things: from the seed)
  const fixed = new RNG(hashString(`proam-layout|${P.id}`)); // (the park itself: the same every game)
  const k = mats(ctx), matte = [], metal = [], foliage = [], glow = [];
  // the court in the home team's colours, the hoops
  let courtMeshes = [];
  const court = { id: 'proam_' + P.id, origin: [0, 0, 0], format: 5, full: true, hoops: null, floor: null };
  const layCourt = h => {
    for (const m of courtMeshes) scene.remove(m);
    const built = buildCourt(ctx, { ...homeCourtSpec(P, h), margin: 2.4 }, [0, 0, 0]);
    built.meshes.forEach(m => scene.add(m));
    courtMeshes = built.meshes; court.floor = built.floor;
  };
  layCourt(home);
  const style = P.indoor ? 'gym' : 'park';
  const hoops = [1, -1].map(side => buildHoop(ctx, side, style, { padColor: home.primary, rimColor: P.id === 'market' ? '#ff6a2a' : '#d8431c', poleColor: P.id === 'longbeach' ? '#2f5f63' : P.id === 'desert' ? '#5a3a2a' : '#30363c', shotClock: false }));
  hoops.forEach(h => h.meshes.forEach(m => scene.add(m)));
  court.hoops = hoops;
  // the banners: two textures (the name, the logo) every banner of the park shares
  const bannerMats = { name: new Material({ map: ctx.texture(bannerCanvas(home, 'name')), roughness: 0.9, shading: 'cloth' }), logo: new Material({ map: ctx.texture(bannerCanvas(home, 'logo')), roughness: 0.9, shading: 'cloth' }) };
  const banners = [];
  const env = { ctx, scene, P, look, home, rng, fixed, k, matte, metal, foliage, glow, seats: [], solids: [], banners, bannerMats, anim: [], lights: [] };
  const park = SCENERY[P.id](env);
  // the crowd, the lights, the weather
  const crowd = crowdMesh(ctx, scene, env.seats, rng, home, look.crowd);
  if (look.weather === 'rain' && !P.indoor) env.anim.push({ rain: rainMesh(ctx, scene, rng) });
  batch(ctx, scene, matte, k.matte);
  batch(ctx, scene, metal, k.metal);
  batch(ctx, scene, foliage, k.foliage);
  const glowMesh = batch(ctx, scene, glow, k.glow, { castShadow: false, reflect: false });
  if (glowMesh && look.tod === 'day' && !P.indoor) k.glow.color = [1.15, 1.15, 1.15]; // (lamps off by day: just pale)
  if (park.floodlit !== false) nightLights(scene, look, park.lightColor, park.lightK || 1);
  for (const l of env.lights) if (scene.lights.length < 8) scene.lights.push(l);
  scene.reflectionPlane = P.indoor;
  scene.shadowFocus = { center: [0, 0, 0], radius: park.shadowRadius || 19 };
  const fx = [0, 0, 1.4, 0];
  let t = 0;
  const venue = {
    theme, look, proam: P.id, name: P.name, home,
    courts: [court], hoops, crowd, banners,
    bounds: park.bounds, solids: env.solids, clubhouse: park.clubhouse, spawn: park.spawn || { x: park.clubhouse.door.x, z: park.clubhouse.door.z, yaw: park.clubhouse.door.yaw },
    // info: {ball, phase, over, events}: the park's own life (traffic, waves, lanterns) and the crowd's moods
    update(dt, info = {}) {
      t += dt;
      for (const a of env.anim) a.step?.(dt, t, info);
      const ph = info.phase || '';
      fx[1] = M.damp(fx[1], ph === 'ft' || ph === 'ftflight' || ph === 'dead' || ph === 'inbound' ? 1 : 0, 3, dt);
      fx[3] = M.damp(fx[3], info.over ? 1 : 0, 1.5, dt);
      scene.crowdFx = fx;
    },
    // the home team changed (a Gold team's office: floor, colours, logo): the court and every banner in theirs
    paintHome(team) {
      const h = { ...DEFAULT_HOME, ...(team || {}) };
      venue.home = h;
      layCourt(h);
      for (const kind of ['name', 'logo']) { const old = bannerMats[kind].map; bannerMats[kind].map = ctx.texture(bannerCanvas(h, kind)); ctx.disposeTexture?.(old); }
    },
  };
  return venue;
}

// ---------------- the parks ----------------
const SCENERY = {};

// 1. Under the Overpass: the court sits right under a big elevated highway: twin concrete viaducts running the length
// of the court on portal bents (columns down both sides and, past the baselines, one behind each basket), box girders
// and sodium lamps under the decks, a slot of sky between them over the court, traffic up top (headlights at night, the
// rumble of the heavy ones going over), graffiti on the columns and the retaining wall, a chain-link fence; the
// clubhouse is two shipping containers stacked under the east deck.
// (the game cameras never see above their own height (8.5 m), so the decks' undersides start at 9.6 m: the columns,
// the girders' far ends from the broadcast side, the shade and the lamps are what reads from the court)
SCENERY.overpass = env => {
  const { ctx, scene, matte, metal, glow, seats, solids, fixed, look, k } = env;
  ground(ctx, scene, 'concrete', () => T.concrete({ color: [0.5, 0.5, 0.49], joints: true }), 260, 6, '#c8c6c2');
  const conc = cachedTexture(ctx, 'pg-concwall', () => T.concrete({ color: [0.62, 0.61, 0.58] }).color, { aniso: 8 });
  const deckMat = new Material({ map: conc, roughness: 0.9 }), deck = [];
  const CX = 21, CAP0 = 9.6, CAP1 = 11.0, SLAB1 = 11.9, BENTS = [-56, -34, -12, 12, 34, 56];
  // the bents: square columns, a cap beam across the whole width; past the baselines a third column behind the basket
  for (const z of BENTS) {
    const xs = Math.abs(z) > 20 ? [-CX, 0, CX] : [-CX, CX];
    for (const x of xs) {
      deck.push({ geo: texBox(2.4, CAP0, 2.4, 3, 3), matrix: TR(x, CAP0 / 2, z), color: [1, 1, 1, 1] }, { geo: texBox(3.2, 0.9, 3.2, 3, 3), matrix: TR(x, 0.45, z), color: [0.82, 0.82, 0.8, 1] });
      metal.push({ geo: G.cylinder(0.12, 0.12, CAP0, 8, { y0: true }), matrix: TR(x + (x > 0 ? -1.34 : 1.34), 0, z + 0.8), color: c4('#3a3f44') }); // (a drain pipe)
      solids.push({ x0: x - 1.6, x1: x + 1.6, z0: z - 1.6, z1: z + 1.6, h: CAP0 });
    }
    deck.push({ geo: texBox(2 * CX + 4, CAP1 - CAP0, 2.6, 4, 4), matrix: TR(0, (CAP0 + CAP1) / 2, z), color: [0.86, 0.86, 0.84, 1] });
  }
  // the twin decks: a slab on four box girders each, Jersey barriers, a slot of sky between them
  for (const sx of [-1, 1]) {
    const xc = sx * 13.5;
    deck.push({ geo: texBox(21, SLAB1 - CAP1, 240, 6, 6), matrix: TR(xc, (CAP1 + SLAB1) / 2, 0), color: [1, 1, 1, 1] });
    for (const gx of [-8.2, -2.8, 2.8, 8.2]) deck.push({ geo: texBox(1.3, CAP1 - CAP0, 240, 4, 4), matrix: TR(xc + gx, (CAP0 + CAP1) / 2, 0), color: [0.78, 0.78, 0.76, 1] });
    for (const ex of [-10.2, 10.2]) deck.push({ geo: texBox(0.6, 1.05, 240, 4, 4), matrix: TR(xc + ex, SLAB1 + 0.52, 0), color: [0.92, 0.92, 0.9, 1] });
    for (let z = -108; z <= 108; z += 36) { metal.push({ geo: G.cylinder(0.12, 0.16, 9, 8, { y0: true }), matrix: TR(xc + sx * 10.2, SLAB1 + 1, z), color: c4('#4a5056') }, { geo: G.box(2.2, 0.16, 0.4), matrix: TR(xc + sx * 9.2, SLAB1 + 10, z), color: c4('#4a5056') }); glow.push({ geo: G.box(0.8, 0.1, 0.36), matrix: TR(xc + sx * 8.4, SLAB1 + 9.9, z), color: [1, 0.7, 0.36, 1] }); }
    // sodium lamps under the girders, over the court and its surrounds
    for (const gx of [-5.5, 0, 5.5]) for (let z = -30; z <= 30; z += 10) glow.push({ geo: G.box(0.5, 0.14, 0.8), matrix: TR(xc + gx, CAP0 + 0.4, z), color: [1, 0.6, 0.22, 1] });
  }
  scene.add(new Mesh(ctx.geometry(G.merge(deck)), deckMat, { castShadow: true, reflect: false }));
  // graffiti: up the columns facing the court, along the retaining wall to the east
  const graf = ['RUN IT', 'NEXT UP', 'UNDERPASS', 'AND ONE', 'HOLD COURT', 'BUCKETS'];
  const grafMats = graf.map((txt, i) => new Material({ map: cachedTexture(ctx, 'graf-' + i, () => T.mural(txt, { seed: 90 + i, bg: '#5a5852', palette: [['#ff5a3c', '#ffd23f', '#2fe0ff', '#ff3fa4', '#f4f1e8'], ['#7dff6a', '#ffe45c', '#b14dff', '#ff8a3c', '#f4f1e8']][i % 2] }), {}), roughness: 0.9 }));
  graf.forEach((txt, i) => { const mesh = new Mesh(ctx.geometry(G.quad(9, 4.5, { bottom: true })), grafMats[i], { castShadow: false }); M.m4fromYaw(mesh.matrix, 27.6, 0.3, -30 + i * 12, -Math.PI / 2); scene.add(mesh); });
  { let i = 0; for (const z of BENTS) for (const x of Math.abs(z) > 20 ? [-CX, 0, CX] : [-CX, CX]) {
    if (Math.abs(z) > 40) continue;
    const g = G.quad(2.3, 4.6, { bottom: true }); for (let j = 0; j < g.uv.length; j += 2) g.uv[j] = g.uv[j] * 0.45 + (i % 2) * 0.5; // (a slice of a mural: tags up a column)
    const face = x === 0 ? (z > 0 ? Math.PI : 0) : (x > 0 ? -Math.PI / 2 : Math.PI / 2), off = 1.22;
    const m = new Mesh(ctx.geometry(g), grafMats[i++ % graf.length], { castShadow: false }); M.m4fromYaw(m.matrix, x + Math.sin(face) * off, 0.95, z + Math.cos(face) * off, face); scene.add(m);
  } }
  matte.push({ geo: G.box(1.2, 5.2, 80), matrix: TR(28.4, 2.6, 0), color: c4('#7c7a74') });
  solids.push({ x0: 27.6, x1: 29, z0: -40, z1: 40, h: 5.2 });
  // the fence round the court (gaps at the corners)
  const fx = W2 + 4.5, fz = L2 + 4.2;
  fences(env, [[-fx, -fz, fx, -fz], [-fx, fz, fx, fz], [-fx, -fz + 3, -fx, fz - 3], [fx, -fz, fx, -6], [fx, 6, fx, fz]], 3.4);
  // the crowd: along the fences, on the column footings, on car hoods
  standRow(seats, -fx - 0.8, -fz + 2, -fx - 0.8, fz - 2, 34);
  standRow(seats, fx + 0.8, -fz + 2, fx + 0.8, -7, 12); standRow(seats, fx + 0.8, 7, fx + 0.8, fz - 2, 12);
  standRow(seats, -fx + 2, fz + 1, fx - 2, fz + 1, 16); standRow(seats, -fx + 2, -fz - 1, fx - 2, -fz - 1, 16);
  for (const z of [-12, 12]) for (const x of [-CX, CX]) sitRow(seats, x + (x > 0 ? -1.75 : 1.75), z - 1.2, x + (x > 0 ? -1.75 : 1.75), z + 1.2, 3, 0.9);
  // parked cars along the west (people sitting on two of them), a dumpster, crates
  for (let i = 0; i < 5; i++) { for (const p of PR.car(fixed.pick(['#7a1f1c', '#2a4a7a', '#d8d4cc', '#1e1f22', '#5a6b3a']))) matte.push({ ...p, matrix: M.m4mul(M.m4(), TR(-fx - 6, 0, -16 + i * 7.5, Math.PI / 2), p.matrix || M.m4()) }); solids.push({ x0: -fx - 7.2, x1: -fx - 4.8, z0: -18.4 + i * 7.5, z1: -13.6 + i * 7.5, h: 1.5 }); if (i % 2) seats.push({ x: -fx - 4.6, y: 0.86, z: -16 + i * 7.5 + 0.8, yaw: Math.PI / 2 }, { x: -fx - 4.6, y: 0.86, z: -16 + i * 7.5 - 0.4, yaw: Math.PI / 2 }); }
  put(matte, G.box(3.4, 1.6, 1.8), fx + 3.5, 0.8, -12, '#2f5a3a');
  for (let i = 0; i < 6; i++) matte.push({ geo: G.box(0.5, 0.32, 0.36), matrix: TR(fx + 2.2 + (i % 3) * 0.55, 0.16 + Math.floor(i / 3) * 0.32, 15 + (i % 2) * 0.1), color: c4(['#2457a5', '#c8302a', '#2f8a4a'][i % 3]) });
  // the city past the highway: towers to the north and south
  const city = [];
  for (let i = 0; i < 26; i++) { const a = fixed.range(0, Math.PI * 2), d = fixed.range(70, 130), h = fixed.range(18, 60); city.push({ x: Math.sin(a) * d, z: Math.cos(a) * d, w: fixed.range(12, 22), d: fixed.range(12, 22), h, yaw: fixed.range(-0.3, 0.3), tint: fixed.pick(TINTS) }); }
  blocks(ctx, scene, city, 'overpass', { wall: '#5d5852', lit: 0.45, emissive: win(look), seed: 52 });
  // sodium light under each deck at dusk and night, the floods on two corners
  if (look.tod !== 'day') env.lights.push({ pos: [-15, CAP0 - 1, 0], range: 32, color: [1, 0.6, 0.28], intensity: 14, dir: null }, { pos: [15, CAP0 - 1, 0], range: 32, color: [1, 0.6, 0.28], intensity: 14, dir: null }); // (the columns and the decks' undersides lit orange)
  floodTowers(metal, glow, [[-fx - 2, -fz - 2], [fx + 2, fz + 2]], 8.6);
  // the traffic up top: southbound on the west deck, northbound on the east, cars and a few buses and trucks
  const lanes = [-11.5, -7.5, -3.5].map(o => ({ x0: -13.5 + o + 7.5, z0: 0, dx: 0, dz: 1, y: SLAB1, dir: -1, len: 240 })).concat([3.5, 7.5, 11.5].map(o => ({ x0: 13.5 + o - 7.5, z0: 0, dx: 0, dz: 1, y: SLAB1, dir: 1, len: 240 })));
  let heavyNear = new Set();
  env.anim.push(traffic(env, lanes, 22, { buses: 4, vmin: 14, vmax: 24, bounds: { center: [0, SLAB1, 0], radius: 125 }, onStep(sets) { const bus = sets.find(S => S.bus); if (!bus) return; const now = new Set(); bus.list.forEach((c, i) => { if (Math.abs(c.s) < 9) { now.add(i); if (!heavyNear.has(i)) audio.rumble(0.09); } }); heavyNear = now; } }));
  // the home team: banners on the fence, the logo hung from the bents over each side, on the retaining wall
  for (const [x, z, yaw] of [[fx + 0.05, -12, -Math.PI / 2], [fx + 0.05, 12, -Math.PI / 2], [0, fz + 0.05, Math.PI], [0, -fz - 0.05, 0]]) bannerQuad(ctx, scene, env.bannerMats.name, x, 1.6, z, yaw, 5.2, 1.3, env.banners); // (none on the west fence: the broadcast camera looks over it)
  for (const z of [-12, 12]) for (const x of [-16, 16]) { bannerQuad(ctx, scene, env.bannerMats.logo, x, CAP0 - 2.2, z + 1.32, 0, 1.8, 3.6, env.banners); metal.push({ geo: G.box(2, 0.06, 0.06), matrix: TR(x, CAP0 - 0.4, z + 1.32), color: c4('#2a2d30') }); }
  bannerQuad(ctx, scene, env.bannerMats.logo, 27.75, 2.8, 22, -Math.PI / 2, 2, 4, env.banners);
  // the clubhouse: two shipping containers, stacked, under the east deck south of the court, a stair up the side
  const cx = 16, cz = -24, cyaw = -Math.PI / 2 + 0.2;
  const at = (dx, dy, dz) => M.m4mul(M.m4(), TR(cx, 0, cz, cyaw), TR(dx, dy, dz));
  matte.push({ geo: G.box(12.2, 2.6, 2.45), matrix: at(0, 1.3, 0), color: c4('#2f6a8a') }, { geo: G.box(12.2, 2.6, 2.45), matrix: at(0.8, 3.9, 0.2), color: c4('#a8432e') });
  for (let i = -5; i <= 5; i++) { metal.push({ geo: G.box(0.06, 2.5, 0.05), matrix: at(i * 1.1, 1.3, 1.25), color: c4('#25506a') }, { geo: G.box(0.06, 2.5, 0.05), matrix: at(0.8 + i * 1.1, 3.9, 1.45), color: c4('#86331f') }); }
  for (let s = 0; s < 10; s++) metal.push({ geo: G.box(1, 0.06, 0.3), matrix: at(6.6, 0.25 + s * 0.26, 1.2 - s * 0.24), color: c4('#3a3f44') });
  for (const dx of [-5, 1.5]) litWindow(env, matte, ...(() => { const m = at(dx, 1.5, 1.27); return [m[12], m[13], m[14]]; })(), cyaw, 1.4, 0.9, 0.9);
  const door = clubDoor(matte, glow, at(-3, 0, 1.25)[12], at(-3, 0, 1.25)[14], cyaw, { door: '#1c2a33' });
  { const sm = at(0.8, 5.95, 1.5); clubMarquee(env, 'overpass', 'CONTAINER YARD', sm[12], sm[13], sm[14], cyaw, 4.2, '#ffb347', '#14181c', door); }
  solids.push({ x0: cx - 2.6, x1: cx + 2.6, z0: cz - 6.6, z1: cz + 6.6, h: 5.2 }); // (the containers run north-south, turned a little)
  return { bounds: { x0: -26, x1: 26, z0: -30, z1: 30 }, clubhouse: { door, anchor: { x: at(0, 0, 0)[12], y: 0, z: at(0, 0, 0)[14], yaw: cyaw, w: 12, d: 2.4 }, style: 'containers' }, lightColor: [1, 0.86, 0.66], shadowRadius: 26 };
};

// 2. Long Beach: the court on warm sand between the boardwalk (west, its shops behind it) and the ocean (east, out to
// the horizon past the far sideline, where the broadcast camera looks), the surf rolling in, a pier with a Ferris wheel,
// a lifeguard tower, umbrellas and towels, palms along the boardwalk, string lights over the court at night; the
// clubhouse is a beach shack on stilts on the ocean side
SCENERY.longbeach = env => {
  const { ctx, scene, matte, metal, foliage, glow, seats, solids, fixed, look, anim } = env;
  const SHORE = 44;
  ground(ctx, scene, 'sand', () => T.sand({ meters: 12, seed: 71 }), 0, 12, '#ffe8c2', -0.006, 0.95, [SHORE - 260, 0, 520, 600]);
  matte.push({ geo: G.plane(8, 600), matrix: TR(SHORE - 4, -0.003, 0), color: c4('#b49474') }); // (the wet sand at the water's edge)
  // the ocean: out to the horizon, its swell scrolling, the surf rolling in in lines of foam
  const wn = cachedTexture(ctx, 'waterN2', () => T.waterNormal({ seed: 41 }), { srgb: false });
  const sea = G.plane(1800, 1400, 1, 1); for (let i = 0; i < sea.uv.length; i += 2) { sea.uv[i] *= 150; sea.uv[i + 1] *= 115; }
  const seaMat = new Material({ color: lin(look.tod === 'night' ? '#0a2a3a' : look.tod === 'dusk' ? '#2a5a72' : '#1e7898'), normalMap: wn, normalScale: 0.6, roughness: 0.06, specular: 1.6, metalness: 0.1 });
  const seaM = new Mesh(ctx.geometry(sea), seaMat, { castShadow: false, reflect: false }); M.m4translation(seaM.matrix, SHORE + 900, -0.25, 0); scene.add(seaM);
  const foam = [];
  for (const [dx, w] of [[1.5, 3], [7, 2.2], [15, 1.6]]) { const g = G.plane(w, 600, 1, 1); for (let i = 0; i < g.uv.length; i += 2) g.uv[i + 1] *= 70; foam.push({ geo: g, matrix: TR(SHORE + dx, -0.2 + dx * 0.002, 0) }); }
  const foamMat = new Material({ color: [1.15, 1.18, 1.2], normalMap: wn, normalScale: 0.3, roughness: 0.3, blend: 'alpha', opacity: 0.55, depthWrite: false });
  const foamM = new Mesh(ctx.geometry(G.merge(foam, false)), foamMat, { castShadow: false, reflect: false }); foamM.order = 2; scene.add(foamM);
  anim.push({ step(dt, t) { seaMat.uvOffset[0] -= 0.02 * dt; seaMat.uvOffset[1] += 0.008 * dt; foamMat.uvOffset[1] = (foamMat.uvOffset[1] + 0.05 * dt) % 1; foamM.matrix[12] = Math.sin(t * 0.45) * 1.6; foamMat.opacity = 0.42 + Math.sin(t * 0.45 + 1) * 0.16; } });
  // the boardwalk to the west (behind the broadcast camera), its railing, the shops behind it
  const wood = '#a07a52';
  matte.push({ geo: G.box(6, 0.25, 220), matrix: TR(-33, 0.42, 0), color: c4(wood) });
  for (let z = -108; z <= 108; z += 3) { metal.push({ geo: G.cylinder(0.04, 0.04, 1, 6, { y0: true }), matrix: TR(-29.9, 0.55, z), color: c4('#e8e3d8') }); matte.push({ geo: G.box(0.25, 0.45, 0.25), matrix: TR(-35.8, 0.22, z), color: c4('#6a5034') }); }
  metal.push({ geo: G.tube([[-29.9, 1.55, -108], [-29.9, 1.55, 108]], 0.04, 6), color: c4('#e8e3d8') });
  const shops = [];
  for (let i = 0; i < 11; i++) shops.push({ x: -45, z: -100 + i * 20, w: 9, d: 17, h: 5 + fixed.range(0, 5), tint: fixed.pick(['#f2d9c0', '#d6eae6', '#f5e6b8', '#f2c6c0', '#e0d8f0']) });
  blocks(ctx, scene, shops, 'beachshops', { wall: '#efe4d2', glass: '#3a6a7a', lit: 0.5, emissive: win(look, 1.1), tu: 8, tv: 12, seed: 33 });
  shops.forEach((sh, i) => { matte.push({ geo: G.box(0.1, 0.12, 14), matrix: M.m4mul(M.m4(), TR(sh.x + 4.9, 3.1, sh.z), TRP(0, 0, 0, Math.PI / 2, 0.3)), color: c4(['#e8513a', '#2fb8b0', '#f2c230', '#5a8ac8'][i % 4]) }); });
  // palms along the boardwalk (clear of the broadcast camera's spot) and at the ends of the beach
  for (const [x, z] of [[-27.5, -40], [-27.5, -26], [-28.5, 20], [-27.5, 34], [-27.5, 48], [-27.5, -54], [-12, 40], [10, -42], [-16, -44], [24, 42], [-40, -8], [-40, 10]]) foliage.push(...PR.palm(x, z, 1.05, new RNG(Math.round(x * 31 + z * 7))));
  // the lifeguard tower by the water, a volleyball net, umbrellas and towels on the ocean side
  { const lx = 37, lz = 14, at = (dx, dy, dz) => M.m4mul(M.m4(), TR(lx, 0, lz, -Math.PI / 2 + 0.2), TR(dx, dy, dz));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) matte.push({ geo: G.box(0.16, 2.6, 0.16), matrix: at(sx * 1.1, 1.3, sz * 1.1), color: c4('#e8e3d8') });
    matte.push({ geo: G.box(3, 2.1, 3), matrix: at(0, 3.65, 0), color: c4('#2fb8b0') }, { geo: G.box(3.6, 0.2, 3.8), matrix: at(0, 2.55, 0.3), color: c4('#f4efe4') }, { geo: gable(3.4, 3.4, 1.2), matrix: at(0, 4.7, 0), color: c4('#e8513a') });
    for (let s = 0; s < 7; s++) matte.push({ geo: G.box(1.1, 0.06, 0.3), matrix: at(0, 0.2 + s * 0.34, 2.0 + 2.4 - s * 0.34), color: c4('#e8e3d8') });
    glow.push({ geo: G.box(1.6, 0.6, 0.04), matrix: at(0, 3.8, 1.52), color: look.tod === 'day' ? [0.4, 0.5, 0.55, 1] : [1, 0.86, 0.6, 1] });
    solids.push({ x0: lx - 2, x1: lx + 2, z0: lz - 2, z1: lz + 2, h: 5 }); }
  for (const sx of [-4.5, 4.5]) metal.push({ geo: G.cylinder(0.05, 0.05, 2.5, 6, { y0: true }), matrix: TR(30, 0, -20 + sx), color: c4('#e8e3d8') });
  matte.push({ geo: G.box(0.03, 0.9, 9), matrix: TR(30, 1.95, -20), color: c4('#f4f4f0') });
  for (let i = 0; i < 9; i++) {
    const x = fixed.range(21, 39), z = fixed.range(-34, 36); if (Math.hypot(x - 37, z - 14) < 4 || Math.hypot(x - 26, z + 12) < 7 || Math.abs(z + 20) < 6) continue;
    const c = fixed.pick(['#e8513a', '#2fb8b0', '#f2c230', '#5a8ac8', '#f4efe4']);
    metal.push({ geo: G.cylinder(0.03, 0.03, 2.2, 6, { y0: true }), matrix: TR(x, 0, z), color: c4('#e8e3d8') }); matte.push({ geo: G.cylinder(0.04, 1.3, 0.45, 10, { y0: true }), matrix: TR(x, 1.9, z), color: c4(c) });
    matte.push({ geo: G.box(0.8, 0.03, 1.7), matrix: TR(x + 0.9, 0.015, z, fixed.range(-0.4, 0.4)), color: c4(fixed.pick(['#e8513a', '#2fb8b0', '#f2c230', '#f4efe4'])) });
    seats.push({ x: x + 0.9, y: 0, z: z - 0.2, yaw: -Math.PI / 2 });
  }
  // the pier south of the court, out over the water, its lamps and a Ferris wheel near its end
  { const pz = -46, x0 = 26, x1 = 160, py = 3.4;
    matte.push({ geo: G.box(x1 - x0, 0.4, 9), matrix: TR((x0 + x1) / 2, py, pz), color: c4('#8a6a46') });
    for (let x = x0 + 2; x < x1; x += 6) for (const sz of [-4, 4]) matte.push({ geo: G.cylinder(0.25, 0.25, py + 2, 6, { y0: true }), matrix: TR(x, -2, pz + sz), color: c4('#5a4430') });
    for (const sz of [-4.4, 4.4]) { metal.push({ geo: G.tube([[x0, py + 1.1, pz + sz], [x1, py + 1.1, pz + sz]], 0.05, 4), color: c4('#e8e3d8') }); for (let x = x0; x <= x1; x += 12) { metal.push({ geo: G.cylinder(0.07, 0.09, 4.2, 6, { y0: true }), matrix: TR(x, py, pz + sz), color: c4('#2a3a40') }); glow.push({ geo: G.sphere(0.24, 8, 6), matrix: TR(x, py + 4.35, pz + sz), color: [1, 0.86, 0.6, 1] }); } }
    matte.push({ geo: G.box(8, 0.5, 4), matrix: TR(x0 - 3, 1.6, pz), color: c4('#8a6a46') }); // (the ramp up from the sand)
    blocks(ctx, scene, [{ x: x1 - 8, y: py, z: pz, w: 10, d: 7, h: 4.2, tint: '#f2d9c0' }], 'pierhouse', { wall: '#efe4d2', glass: '#3a6a7a', lit: 0.6, emissive: win(look, 1.2), tu: 8, tv: 12, seed: 35 });
    sign(ctx, scene, 'piersign', 'BAIT & TACKLE', { w: 512, h: 112, bg: '#2f8a8c', color: '#fbf5e6', size: 56 }, x1 - 13.05, py + 3.4, pz, -Math.PI / 2, 4, 0.85);
    const wx = 118, wy = py + 13.5, R = 11.5, wheel = [], bulbs = [];
    const flat = (g, m) => ({ geo: g, matrix: m });
    for (const sz of [-1.1, 1.1]) wheel.push({ ...flat(G.torus(R, 0.22, 48, 6), M.m4mul(M.m4(), TR(0, 0, sz), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2), [1, 1, 1]))), color: c4('#f4f4f0') });
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rz = M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, a), [1, 1, 1]); for (const sz of [-1.1, 1.1]) wheel.push({ geo: G.box(0.1, R, 0.1), matrix: M.m4mul(M.m4(), rz, TR(0, R / 2, sz)), color: c4('#e8e3d8') }); wheel.push({ geo: G.box(1.3, 1.2, 1.6), matrix: M.m4mul(M.m4(), rz, TR(0, R + 0.5, 0)), color: c4(['#e8513a', '#2fb8b0', '#f2c230', '#5a8ac8'][i % 4]) }); }
    for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; bulbs.push({ geo: G.sphere(0.14, 6, 4), matrix: TR(Math.sin(a) * (R + 0.1), Math.cos(a) * (R + 0.1), 1.25), color: [1, 0.85 - (i % 3) * 0.2, 0.5 + (i % 2) * 0.3, 1] }); }
    wheel.push({ geo: G.cylinder(0.6, 0.6, 3, 12), matrix: M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2), [1, 1, 1]), color: c4('#9aa0a6') });
    const wm = new Mesh(ctx.geometry(G.merge(wheel)), new Material({ color: [1, 1, 1], roughness: 0.5, metalness: 0.3 }), { castShadow: false, reflect: false });
    const bm = new Mesh(ctx.geometry(G.merge(bulbs)), new Material({ color: look.tod === 'day' ? [0.9, 0.9, 0.9] : [2.6, 2.6, 2.6], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
    scene.add(wm); scene.add(bm);
    for (const sz of [-2.4, 2.4]) for (const sx of [-1, 1]) metal.push({ geo: G.tube([[wx + sx * 6, py, pz + sz], [wx, wy, pz + sz * 0.6]], 0.2, 6), color: c4('#d8dde4') });
    let spin = 0;
    const placeWheel = () => { const m = M.m4mul(M.m4(), TR(wx, wy, pz, Math.PI / 2), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, spin), [1, 1, 1])); wm.matrix.set(m); bm.matrix.set(m); };
    placeWheel(); anim.push({ step(dt) { spin += dt * 0.09; placeWheel(); } });
  }
  // the crowd: beach chairs and towels by the sidelines, a row at the boardwalk rail, a row behind each baseline
  for (let i = 0; i < 18; i++) { const z = -14 + i * 1.6, s = i % 2 ? -1 : 1; for (const side of [-1, 1]) { const x = side * (W2 + 3.2 + (i % 3) * 0.9); matte.push({ geo: G.box(0.6, 0.06, 1.3), matrix: TR(x, 0.03, z, s * 0.1), color: c4(fixed.pick(['#e8513a', '#2fb8b0', '#f2c230', '#f4efe4'])) }); seats.push({ x, y: 0, z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 }); } }
  standRow(seats, -30.6, -26, -30.6, 26, 32, 0.55, [0, 0]);
  standRow(seats, -W2 + 1, L2 + 3.6, W2 - 1, L2 + 3.6, 12); standRow(seats, -W2 + 1, -L2 - 3.6, W2 - 1, -L2 - 3.6, 12);
  // string lights over the court (lit at dusk and night), on poles at the corners
  stringLights(env, [[-W2 - 2.4, -L2 - 2.4], [W2 + 2.4, -L2 - 2.4], [W2 + 2.4, L2 + 2.4], [-W2 - 2.4, L2 + 2.4]], 7, 1.2, [[1, 0.85, 0.55, 1], [1, 0.7, 0.45, 1], [1, 0.95, 0.75, 1]], true, '#5a4632');
  // the home team: logo flags on two poles, name boards behind the baselines, a banner on the lifeguard tower
  for (const [x, z] of [[-W2 - 4, L2 + 5], [W2 + 4, -L2 - 5]]) { metal.push({ geo: G.cylinder(0.05, 0.06, 6, 8, { y0: true }), matrix: TR(x, 0, z), color: c4('#e8e3d8') }); bannerQuad(ctx, scene, env.bannerMats.logo, x + Math.sign(x) * 0.8, 4.6, z, Math.PI / 2, 1.5, 3, env.banners); }
  for (const z of [-L2 - 4.4, L2 + 4.4]) { bannerQuad(ctx, scene, env.bannerMats.name, 7, 0.75, z, z < 0 ? 0 : Math.PI, 3.6, 0.9, env.banners); for (const dx of [-1.7, 1.7]) metal.push({ geo: G.box(0.06, 1.2, 0.06), matrix: TR(7 + dx, 0.6, z), color: c4('#6a5034') }); }
  bannerQuad(ctx, scene, env.bannerMats.name, 37 - 1.6, 4.6, 14 - 0.3, -Math.PI / 2 + 0.2, 2.8, 0.7, env.banners);
  // the clubhouse: a stilted beach shack with a deck and steps, on the ocean side
  const cx = 26, cz = -12, cyaw = -Math.PI / 2;
  const at = (dx, dy, dz) => M.m4mul(M.m4(), TR(cx, 0, cz, cyaw), TR(dx, dy, dz));
  for (const [sx, sz] of [[-4, -3], [4, -3], [-4, 3], [4, 3], [0, -3], [0, 3]]) matte.push({ geo: G.box(0.25, 1.2, 0.25), matrix: at(sx, 0.6, sz), color: c4('#6a5034') });
  matte.push({ geo: G.box(9, 0.2, 6.4), matrix: at(0, 1.25, 0.6), color: c4('#a07a52') }, { geo: G.box(8, 3.2, 4.6), matrix: at(0, 2.95, -0.4), color: c4('#e7ddc8') }, { geo: G.box(9, 0.3, 5.8), matrix: at(0, 4.7, -0.4), color: c4('#2f8a8c') });
  for (let i = -3; i <= 3; i++) matte.push({ geo: G.box(1, 0.07, 0.3), matrix: at(i * 1.15, 1.32, 4.2), color: c4('#8a6a46') });
  for (let s = 0; s < 6; s++) matte.push({ geo: G.box(1.4, 0.08, 0.5), matrix: at(-2.2, 0.15 + s * 0.2, 5.3 - s * 0.5), color: c4('#8a6a46') });
  for (const dx of [1.2, 3.2]) { const m = at(dx, 2.9, 1.92); litWindow(env, matte, m[12], m[13], m[14], cyaw, 1.2, 1, 0.9); }
  const door = clubDoor(matte, glow, at(-2.2, 1.35, 1.9)[12], at(-2.2, 1.35, 1.9)[14], cyaw, { door: '#2f6a8a', frame: '#f4efe4' });
  { const m = at(0, 5.55, 1.9); clubMarquee(env, 'beach', 'BEACH SHACK', m[12], m[13], m[14], cyaw, 3.8, '#fbf5e6', '#2f8a8c', door); }
  stringLights(env, [[cx - 4.3, cz - 4.4], [cx - 4.3, cz + 4.4]], 4.6, 0.4, [[1, 0.8, 0.5, 1], [0.6, 0.9, 1, 1], [1, 0.6, 0.7, 1]], false, '#6a5034', 0.06);
  solids.push({ x0: cx - 3.5, x1: cx + 3.5, z0: cz - 5, z1: cz + 5, h: 4.8 });
  if (look.tod !== 'day') env.lights.push({ pos: [0, 6, 0], range: 30, color: [1, 0.82, 0.55], intensity: 10, dir: null });
  const foot = at(-2.2, 0, 6.1); // (where you stand: at the foot of the steps up to the deck; the door itself up on it)
  return { bounds: { x0: -28, x1: 36, z0: -30, z1: 30 }, clubhouse: { door: { x: foot[12], z: foot[14], yaw: cyaw, at: { ...door.at, y: 1.35 } }, anchor: { x: at(0, 0, 0)[12], y: 1.35, z: at(0, 0, 0)[14], yaw: cyaw, w: 8, d: 4.6 }, style: 'beachshack' }, floodlit: look.tod === 'night', lightColor: [1, 0.86, 0.6], lightK: 0.8, shadowRadius: 22 };
};

// 3. AAU Gym: a big tournament hall: the game court and two more courts beyond it through divider curtains (teams
// warming up on them), a center-hung scoreboard over court 2, the tournament's banner hung across the hall, a real
// scorer's table with the officials at it, pull-out bleachers, champions' banners on the end walls, high windows; the
// clubhouse is the coaches' office up a stair on a mezzanine in the south-west corner
SCENERY.aau = env => {
  const { ctx, scene, matte, metal, glow, seats, solids, look, fixed } = env;
  const W = W2 + 12.5, L = L2 + 15, H = 13; // (the game cameras inside: the broadcast one 19 m out, the 2K one 28.5 m back;
  // the clubhouse door's spot is at the foot of the stair up to the office)
  const C2 = 29, C3 = 56, XW = C3 + W2 + 4.6, CUR = [15.5, 42.5], mid = (XW - W) / 2;
  // the floor, courts 2 and 3 (their own floors and hoops: the teams waiting their turn warm up on them)
  const floor = new Mesh(ctx.geometry(G.plane(XW + W, L * 2)), new Material({ color: lin('#6a4a30'), roughness: 0.45, reflective: true, reflectStrength: 0.25 }), { castShadow: false, reflect: false });
  floor.matrix[12] = mid; floor.matrix[13] = -0.004; floor.order = -2; scene.add(floor);
  [[C2, '#2f5a8a', 'COURT 2'], [C3, '#2f7a4a', 'COURT 3']].forEach(([x, paint, label]) => {
    buildCourt(ctx, { surface: 'wood', court: '#b8874f', apron: '#9a6e3e', paint, lines: '#f8f4ec', wear: 0.2, logo: { shape: 'circle', color: paint, accent: '#f8f4ec', text: 'AAU', size: 1.2 }, baselineText: label, margin: 1 }, [x, 0, 0]).meshes.forEach(m => scene.add(m));
    for (const sd of [1, -1]) buildHoop(ctx, sd, 'gym', { origin: [x, 0, 0], padColor: paint, shotClock: false }).meshes.forEach(m => scene.add(m));
  });
  // walls (painted block), the ceiling and its trusses and lights
  const wallMat = new Material({ map: cachedTexture(ctx, 'pg-aaublock', () => T.concrete({ color: [0.78, 0.76, 0.72], joints: true }).color, { aniso: 8 }), roughness: 0.9 }), walls = [];
  for (const [x, z, w, yaw] of [[mid, -L, XW + W, 0], [mid, L, XW + W, Math.PI], [-W, 0, L * 2, Math.PI / 2], [XW, 0, L * 2, -Math.PI / 2]]) walls.push({ geo: texQuad(w, H, 4, 4, { bottom: true }), matrix: TR(x, 0, z, yaw) });
  scene.add(new Mesh(ctx.geometry(G.merge(walls, false)), wallMat, { castShadow: false }));
  for (const z of [-L + 0.1, L - 0.1]) matte.push({ geo: G.box(XW + W, 1.4, 0.2), matrix: TR(mid, 0.7, z), color: c4('#2f5a8a') });
  matte.push({ geo: G.box(0.2, 1.4, L * 2), matrix: TR(XW - 0.1, 0.7, 0), color: c4('#2f5a8a') });
  const ceil = new Mesh(ctx.geometry(G.plane(XW + W + 2, L * 2)), new Material({ color: lin('#34363a'), roughness: 0.9 }), { castShadow: false, reflect: false });
  M.m4mul(ceil.matrix, M.m4translation(M.m4(), mid, H, 0), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI))); scene.add(ceil);
  for (let i = -4; i <= 4; i++) {
    metal.push({ geo: G.box(XW + W, 0.4, 0.3), matrix: TR(mid, H - 1.2, i * 6.5), color: c4('#2e3135') });
    for (let x = -W + 2; x < XW - 1; x += 16) metal.push({ geo: G.tube([[x, H - 1.2, i * 6.5], [x + 8, H - 2.6, i * 6.5], [x + 16, H - 1.2, i * 6.5]], 0.06, 4), color: c4('#2e3135') });
    for (const sx of [-8, 0, 8, C2 - 8, C2, C2 + 8, C3 - 8, C3, C3 + 8]) { metal.push({ geo: G.cylinder(0.5, 0.3, 0.45, 12, { y0: true }), matrix: TR(sx, H - 2.6, i * 6.5), color: c4('#2e3135') }); glow.push({ geo: G.cylinder(0.48, 0.48, 0.02, 12, { y0: true }), matrix: TR(sx, H - 2.62, i * 6.5), color: [1, 1, 1, 1] }); }
  }
  // the divider curtains: vinyl to head height, mesh above it up to the trusses, pleated
  const meshMat = new Material({ map: cachedTexture(ctx, 'chainlink', () => T.chainlink(256), {}), alphaTest: 0.5, doubleSided: true, color: [0.32, 0.34, 0.4] }); // (open netting: the courts beyond show through it)
  for (const cx of CUR) {
    const m = new Mesh(ctx.geometry(texQuad(L * 2 - 1, H - 3.4, 2.6, 2.6, { bottom: true })), meshMat, { castShadow: false }); M.m4fromYaw(m.matrix, cx, 2.0, 0, Math.PI / 2); scene.add(m);
    matte.push({ geo: G.box(0.06, 2.0, L * 2 - 1), matrix: TR(cx, 1.0, 0), color: c4('#1e2a4a') }, { geo: G.box(0.1, 0.1, L * 2 - 1), matrix: TR(cx, H - 1.4, 0), color: c4('#2e3135') });
    for (let z = -L + 1.5; z < L - 1; z += 1.6) matte.push({ geo: G.box(0.1, 2.0, 0.06), matrix: TR(cx, 1.0, z), color: c4('#16203a') });
  }
  // high windows on the north wall (the time of day through them)
  const winC = look.tod === 'day' ? [1.25, 1.32, 1.42] : look.tod === 'dusk' ? [1.1, 0.68, 0.42] : [0.05, 0.06, 0.1];
  const wq = new Mesh(ctx.geometry(G.quad((XW + W) * 0.8, 1.6)), new Material({ color: winC, shading: 'unlit', fog: false }), { castShadow: false });
  M.m4fromYaw(wq.matrix, mid, 10, L - 0.05, Math.PI); scene.add(wq);
  // the center-hung scoreboard over court 2 (LED faces all round), and the tournament's banner across the hall
  { const led = new Material({ map: cachedTexture(ctx, 'aauled', () => T.ledBoard('HOME 34  AWAY 31', '#ff4a2a', '#ffe45c'), {}), shading: 'unlit', color: [1.3, 1.3, 1.3] });
    matte.push({ geo: G.box(3.4, 1.7, 3.4), matrix: TR(C2, 10.4, 0), color: c4('#14161a') });
    scene.add(new Mesh(ctx.geometry(G.merge([0, 1, 2, 3].map(i => ({ geo: G.quad(3.1, 1.1), matrix: TR(C2 + Math.sin(i * Math.PI / 2) * 1.72, 10.4, Math.cos(i * Math.PI / 2) * 1.72, i * Math.PI / 2) })), false)), led, { castShadow: false }));
    metal.push({ geo: G.box(0.04, 1.4, 0.04), matrix: TR(C2, 11.95, 0), color: c4('#2a2a2a') });
    const tb = new Mesh(ctx.geometry(G.quad(15, 3.2)), new Material({ map: cachedTexture(ctx, 'aaushowcase', () => T.banner('PRO-AM SUMMER SHOWCASE', { w: 1024, h: 220, bg: '#1e3d63', color: '#f9ecd3', size: 70, sub: 'TOURNAMENT OF CHAMPIONS · COURTS 1-3', stripe: '#c8452e' }), {}), roughness: 0.9, shading: 'cloth', doubleSided: true }), { castShadow: false });
    M.m4fromYaw(tb.matrix, CUR[0] + 1.2, 8.9, 0, -Math.PI / 2); scene.add(tb);
    for (const dz of [-7.3, 7.3]) metal.push({ geo: G.box(0.02, 2.4, 0.02), matrix: TR(CUR[0] + 1.2, 11.7, dz), color: c4('#2a2a2a') }); }
  // the scorer's table at the far sideline (the home team's name on its skirt), the officials at it, the benches
  { const tx = W2 + 1.9;
    matte.push({ geo: G.box(0.9, 0.06, 6.4), matrix: TR(tx, 0.76, 0), color: c4('#2b2f36') });
    for (const dz of [-3, 3]) for (const dx of [-0.38, 0.38]) metal.push({ geo: G.box(0.05, 0.74, 0.05), matrix: TR(tx + dx, 0.37, dz), color: c4('#9aa0a6') });
    const sk = new Mesh(ctx.geometry(G.quad(6.4, 0.68)), env.bannerMats.name, { castShadow: false }); M.m4fromYaw(sk.matrix, tx - 0.46, 0.4, 0, -Math.PI / 2); scene.add(sk); env.banners.push(sk);
    for (const dz of [-2, 0, 2]) { matte.push({ geo: G.box(0.34, 0.02, 0.48), matrix: TR(tx + 0.05, 0.8, dz), color: c4('#1a1c20') }, { geo: G.box(0.02, 0.3, 0.46), matrix: TRP(tx + 0.2, 0.94, dz, 0, 0), color: c4('#2a3a4a') }); metal.push({ geo: G.box(0.44, 0.04, 0.44), matrix: TR(tx + 0.85, 0.45, dz), color: c4('#3a3f47') }); seats.push({ x: tx + 0.85, y: 0.45, z: dz, yaw: -Math.PI / 2 }); }
    const sc = new Mesh(ctx.geometry(G.quad(0.9, 0.42)), new Material({ map: cachedTexture(ctx, 'aaushot', () => T.ledBoard('24', '#ff4a2a', '#ffe45c'), {}), shading: 'unlit', color: [1.3, 1.3, 1.3] }), { castShadow: false });
    matte.push({ geo: G.box(0.3, 0.5, 1.0), matrix: TR(tx, 1.04, 1.0), color: c4('#14161a') }); M.m4fromYaw(sc.matrix, tx - 0.16, 1.04, 1.0, -Math.PI / 2); scene.add(sc);
    for (const sz of [-1, 1]) for (let i = 0; i < 6; i++) { matte.push({ geo: G.box(0.5, 0.45, 0.5), matrix: TR(W2 + 2.2, 0.225, sz * (4.6 + i * 0.6)), color: c4('#3a3f47') }); if (fixed.next() < 0.7) seats.push({ x: W2 + 2.2, y: 0.45, z: sz * (4.6 + i * 0.6), yaw: -Math.PI / 2 }); }
    solids.push({ x0: tx - 0.5, x1: tx + 1.2, z0: -3.3, z1: 3.3, h: 1.3 }); }
  // the bleachers on the west, people standing at the ends; teams warming up on courts 2 and 3, others waiting by the curtains
  matte.push(...PR.bleacher(-W2 - 2.6, 0, Math.PI / 2, 24, 7, '#4a3a2a', '#b08a5a')); bleacherSeats(seats, -W2 - 2.6, 0, Math.PI / 2, 24, 7); solids.push({ x0: -W2 - 7.5, x1: -W2 - 2.2, z0: -12, z1: 12, h: 3.5 });
  standRow(seats, -W2, -L + 1.2, W2, -L + 1.2, 14); standRow(seats, -W2, L - 1.2, W2, L - 1.2, 14);
  for (const x of [C2, C3]) {
    for (const sd of [-1, 1]) { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, px = x + Math.sin(a) * 2.2, pz = sd * 9.5 + Math.cos(a) * 2.2; seats.push({ x: px, y: 0, z: pz, yaw: Math.atan2(x - px, sd * 9.5 - pz), stand: true }); } }
    standRow(seats, x - 6, -L + 2, x + 6, -L + 2, 8, 0, [x, 0]); sitRow(seats, x + W2 + 2.5, -8, x + W2 + 2.5, 8, 12, 0.45, [x, 0]);
    for (let i = 0; i < 12; i++) metal.push({ geo: G.box(0.44, 0.04, 0.44), matrix: TR(x + W2 + 2.5, 0.45, -8 + (i + 0.5) * (16 / 12)), color: c4('#3a3f47') });
  }
  // champions' banners on the end walls, the home team's banners
  const tbs = ['SPRING SHOOTOUT', 'SUMMER CLASSIC', 'HOOP FEST', 'FALL SHOWCASE', 'TIP-OFF CLASSIC', 'WINTER JAM'];
  { // (all six on one texture, three across and two down, in one mesh)
    const atlas = cachedTexture(ctx, 'aaubanners', () => { const c = T.canvas(1536, 1280), g = c.getContext('2d'); tbs.forEach((txt, i) => g.drawImage(T.banner(txt, { w: 512, h: 640, bg: ['#1e3d63', '#8a2b2b', '#2f6a3a', '#5a2f6a', '#c8452e', '#2a5a7a'][i], color: '#f9ecd3', size: 54, sub: 'CHAMPIONS' }), (i % 3) * 512, Math.floor(i / 3) * 640)); return c; }, {});
    const parts = tbs.map((txt, i) => { const g = G.quad(2.2, 2.8), u0 = (i % 3) / 3, v0 = Math.floor(i / 3) / 2; for (let j = 0; j < g.uv.length; j += 2) { g.uv[j] = u0 + g.uv[j] / 3; g.uv[j + 1] = v0 + g.uv[j + 1] / 2; } const z = i % 2 ? L - 0.08 : -L + 0.08; return { geo: g, matrix: TR(-10 + Math.floor(i / 2) * 2.6 + (i % 2 ? 0 : 12), 8.6, z, z > 0 ? Math.PI : 0) }; });
    scene.add(new Mesh(ctx.geometry(G.merge(parts, false)), new Material({ map: atlas, roughness: 0.9, shading: 'cloth', doubleSided: true }), { castShadow: false })); }
  for (const z of [-L + 0.06, L - 0.06]) bannerQuad(ctx, scene, env.bannerMats.name, 0, 4.2, z, z < 0 ? 0 : Math.PI, 8, 2, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.logo, -W + 0.06, 8.2, 18, Math.PI / 2, 2.2, 4.4, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.logo, CUR[0] + 0.1, 6, -16, -Math.PI / 2, 2.2, 4.4, env.banners); bannerQuad(ctx, scene, env.bannerMats.logo, CUR[0] + 0.1, 6, 16, -Math.PI / 2, 2.2, 4.4, env.banners);
  // the clubhouse: the coaches' office on a mezzanine in the south-west corner, a steel stair up to it
  const ox = -W + 4, oz = -L + 3;
  matte.push({ geo: G.box(8, 0.3, 6), matrix: TR(ox + 1, 3.6, oz), color: c4('#4a4f55') }, { geo: G.box(7, 2.8, 5), matrix: TR(ox + 1, 5.15, oz - 0.3), color: c4('#c9c3b8') });
  for (const [dx, dz] of [[-3, 2.8], [5, 2.8]]) metal.push({ geo: G.box(0.2, 3.6, 0.2), matrix: TR(ox + dx, 1.8, oz + dz), color: c4('#3a3f44') });
  for (let st = 0; st < 12; st++) metal.push({ geo: G.box(1.1, 0.06, 0.28), matrix: TR(ox + 5.6, 0.3 * (st + 1), oz + 5.6 - st * 0.24), color: c4('#3a3f44') });
  metal.push({ geo: G.tube([[ox - 3, 4.75, oz + 3], [ox + 5, 4.75, oz + 3]], 0.04, 6), color: c4('#c8452e') });
  glow.push({ geo: G.box(4, 1.2, 0.05), matrix: TR(ox + 1, 5.4, oz + 2.22), color: [0.9, 0.95, 1, 1] }); // (the office window, lit)
  const door = clubDoor(matte, glow, ox + 3.8, oz + 2.21, 0, { door: '#5a3a2a' });
  clubMarquee(env, 'aau', "COACHES' OFFICE", ox + 1, 7.05, oz + 2.25, 0, 3.6, '#f9ecd3', '#1e3d63', null);
  solids.push({ x0: ox - 3, x1: ox + 6.2, z0: oz - 3, z1: oz + 3.2, h: 3.6 });
  env.lights.push({ pos: [-6, H - 3, -8], range: 30, color: [1, 0.98, 0.94], intensity: 13, dir: null }, { pos: [6, H - 3, 8], range: 30, color: [1, 0.98, 0.94], intensity: 13, dir: null }, { pos: [C2, H - 3, 0], range: 28, color: [1, 0.98, 0.94], intensity: 9, dir: null }, { pos: [C3, H - 3, 0], range: 28, color: [1, 0.98, 0.94], intensity: 7, dir: null });
  return { bounds: { x0: -W + 1, x1: CUR[0] - 0.5, z0: -L + 1, z1: L - 1 }, clubhouse: { door: { x: ox + 5.6, z: oz + 6.1, yaw: 0, at: { ...door.at, y: 3.75 } }, anchor: { x: ox + 1, y: 3.75, z: oz - 0.3, yaw: 0, w: 7, d: 5 }, style: 'mezzanine' }, floodlit: false };
};

// 4. Rooftop: a court on a city rooftop: parapet walls with a safety fence, a water tower, AC units and vents, the
// skyline all round (below and above), a billboard on the next roof; the clubhouse is the stair bulkhead with a roof deck
SCENERY.rooftop = env => {
  const { ctx, scene, matte, metal, glow, seats, solids, fixed, look } = env;
  const RW = W2 + 9, RL = L2 + 10; // the roof
  ground(ctx, scene, 'roof', () => T.concrete({ color: [0.42, 0.42, 0.43], joints: true }), RW * 2 + 2, 4, '#b8b6b2', -0.005, 0.85);
  // the building under the roof (its top three floors show past the parapet), the street far below
  const below = new Mesh(ctx.geometry(G.plane(800, 800)), new Material({ color: lin(look.tod === 'night' ? '#1a1a1e' : '#4a4a4c'), roughness: 0.95 }), { castShadow: false, reflect: false });
  below.matrix[13] = -60; scene.add(below);
  blocks(ctx, scene, [{ x: 0, y: -60, z: 0, w: RW * 2 + 2, d: RL * 2 + 2, h: 59.8 }], 'roofbldg', { wall: '#7a5a4a', lit: 0.4, emissive: win(look, 0.9), seed: 61 });
  // the parapet and a safety fence on it (lower on the south side: the skyline view)
  for (const [x, z, w, d] of [[0, -RL, RW * 2 + 1, 0.5], [0, RL, RW * 2 + 1, 0.5], [-RW, 0, 0.5, RL * 2], [RW, 0, 0.5, RL * 2]]) { matte.push({ geo: G.box(w, 1.1, d), matrix: TR(x, 0.55, z), color: c4('#8a7a6e') }); solids.push({ x0: x - w / 2 - 0.2, x1: x + w / 2 + 0.2, z0: z - d / 2 - 0.2, z1: z + d / 2 + 0.2, h: 3 }); }
  const fenceMat = new Material({ map: cachedTexture(ctx, 'chainlink', () => T.chainlink(256), {}), alphaTest: 0.5, doubleSided: true, roughness: 0.5, metalness: 0.6 }), fp = [];
  for (const [x0, z0, x1, z1] of [[-RW, -RL, RW, -RL], [-RW, RL, RW, RL], [-RW, -RL, -RW, RL], [RW, -RL, RW, RL]]) { const m = PR.fenceMesh(x0, z0, x1, z1, 2.6); fp.push({ geo: m.geo, matrix: M.m4mul(M.m4(), TR(0, 1.1, 0), m.matrix) }); metal.push(...PR.fenceFrame(x0, z0, x1, z1, 2.6, '#3a4046').map(p => ({ ...p, matrix: M.m4mul(M.m4(), TR(0, 1.1, 0), p.matrix || M.m4()) }))); }
  scene.add(new Mesh(ctx.geometry(G.merge(fp, false)), fenceMat, { castShadow: false }));
  // the water tower on its legs (north-west), AC units and vents
  const wx = -RW + 4.5, wz = RL - 4.5;
  for (const [sx, sz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) metal.push({ geo: G.cylinder(0.12, 0.14, 6, 6, { y0: true }), matrix: TR(wx + sx, 0, wz + sz), color: c4('#2a2d30') });
  matte.push({ geo: G.cylinder(2.6, 2.6, 4.6, 18, { y0: true }), matrix: TR(wx, 6, wz), color: c4('#8a6a4a') }, { geo: G.cylinder(0.2, 2.9, 1.6, 18, { y0: true }), matrix: TR(wx, 10.6, wz), color: c4('#5a4636') });
  solids.push({ x0: wx - 2.8, x1: wx + 2.8, z0: wz - 2.8, z1: wz + 2.8, h: 12 });
  for (const [x, z] of [[RW - 3, RL - 3], [RW - 3, RL - 6.5], [RW - 3, -RL + 4]]) { matte.push({ geo: G.box(2.4, 1.6, 2), matrix: TR(x, 0.8, z), color: c4('#b8bcc0') }); metal.push({ geo: G.cylinder(0.7, 0.7, 0.1, 14, { y0: true }), matrix: TR(x, 1.6, z), color: c4('#3a3f44') }); solids.push({ x0: x - 1.3, x1: x + 1.3, z0: z - 1.1, z1: z + 1.1, h: 1.7 }); }
  for (let i = 0; i < 5; i++) metal.push({ geo: G.cylinder(0.25, 0.25, 1.4, 10, { y0: true }), matrix: TR(-RW + 1.5, 0, -8 + i * 4), color: c4('#9aa0a6') });
  // the skyline: towers on every side, some taller than us; a billboard on the next roof with the home team's name
  const city = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2 + fixed.range(-0.06, 0.06), d = fixed.range(55, 140), h = fixed.range(20, 110); city.push({ x: Math.sin(a) * d, y: -60, z: Math.cos(a) * d, w: fixed.range(14, 26), d: fixed.range(14, 26), h: h + 60, tint: fixed.pick(TINTS) }); }
  // (the nearer ones in detailed brick and stone, with their own water towers, crowns and rooftop signs; the far ones plain)
  const nearB = city.filter(b => Math.hypot(b.x, b.z) < 95), farB = city.filter(b => Math.hypot(b.x, b.z) >= 95);
  blocks(ctx, scene, nearB.filter((b, i) => i % 2), 'skynearA', { wall: '#7a5040', lit: 0.45, emissive: win(look, 1.2), seed: 79, detail: { bays: 6, floors: 5, kind: 'brick', fireEscape: 0.3 } });
  blocks(ctx, scene, nearB.filter((b, i) => !(i % 2)), 'skynearB', { wall: '#8a867e', lit: 0.45, emissive: win(look, 1.2), seed: 81, detail: { bays: 6, floors: 5, kind: 'stone' } });
  blocks(ctx, scene, farB, 'skyline', { wall: '#55606a', glass: '#1e2a36', lit: 0.4, emissive: win(look), seed: 77, tu: 14, tv: 28 });
  const roofWords = ['HOTEL', 'GARAGE', 'DINER', 'LOFTS', 'PLAZA', 'TOWER'];
  nearB.forEach((b, i) => {
    const top = b.y + b.h;
    matte.push({ geo: G.box(b.w + 0.6, 0.6, b.d + 0.6), matrix: TR(b.x, top + 0.3, b.z), color: c4(i % 2 ? '#5a3a30' : '#6a6660') });
    if (i % 3 === 0) { matte.push({ geo: G.cylinder(2, 2, 3.4, 12, { y0: true }), matrix: TR(b.x + b.w / 4, top + 2.4, b.z), color: c4('#7a6248') }, { geo: G.cylinder(0.2, 2.2, 1.1, 12, { y0: true }), matrix: TR(b.x + b.w / 4, top + 5.8, b.z), color: c4('#4a3a2e') }); for (const [sx, sz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) metal.push({ geo: G.box(0.14, 2.4, 0.14), matrix: TR(b.x + b.w / 4 + sx, top + 1.2, b.z + sz), color: c4('#2a2d30') }); }
    if (i % 3 === 1 && top > -10) { const yaw = Math.atan2(-b.x, -b.z); sign(ctx, scene, 'roofword-' + (i % roofWords.length), roofWords[i % roofWords.length], { w: 512, h: 128, bg: '#14100e', color: ['#ff4a5a', '#ffd23f', '#5ad8ff'][i % 3], size: 80 }, b.x - Math.sin(-yaw) * 0, top + 2.6, b.z, yaw, 8, 2); for (const dx of [-3.4, 3.4]) metal.push({ geo: G.box(0.2, 2.6, 0.2), matrix: TR(b.x + Math.cos(yaw) * dx, top + 1.3, b.z - Math.sin(yaw) * dx), color: c4('#2a2d30') }); }
  });
  metal.push({ geo: G.box(0.3, 6, 0.3), matrix: TR(-14, 3, -RL - 16), color: c4('#2a2d30') }, { geo: G.box(0.3, 6, 0.3), matrix: TR(-4, 3, -RL - 16), color: c4('#2a2d30') });
  bannerQuad(ctx, scene, env.bannerMats.name, -9, 7.5, -RL - 15.8, 0, 13, 3.3, env.banners);
  matte.push({ geo: G.box(30, 0.4, 20), matrix: TR(-9, -0.2, -RL - 18), color: c4('#4a4a4c') });
  // the crowd: on folding chairs along the sidelines and standing at the parapets
  for (const sx of [-1, 1]) for (let i = 0; i < 14; i++) { const x = sx * (W2 + 2.8), z = -11 + i * 1.7; metal.push({ geo: G.box(0.45, 0.04, 0.45), matrix: TR(x, 0.45, z), color: c4('#3a3f44') }); seats.push({ x, y: 0.42, z, yaw: sx > 0 ? -Math.PI / 2 : Math.PI / 2 }); }
  standRow(seats, -RW + 0.9, -RL + 3, -RW + 0.9, RL - 9, 20); standRow(seats, -10, RL - 0.9, 10, RL - 0.9, 14); standRow(seats, -10, -RL + 0.9, 10, -RL + 0.9, 14);
  floodTowers(metal, glow, [[-W2 - 3, -L2 - 3], [W2 + 3, -L2 - 3], [-W2 - 3, L2 + 3], [W2 + 3, L2 + 3]], 8, '#2a2d30');
  // banners on the fence
  for (const x of [-8, 8]) bannerQuad(ctx, scene, env.bannerMats.name, x, 1.9, RL - 0.1, Math.PI, 5, 1.2, env.banners);
  for (const z of [-6, 6]) bannerQuad(ctx, scene, env.bannerMats.logo, RW - 0.1, 2.3, z, -Math.PI / 2, 1.3, 2.6, env.banners);
  // the clubhouse: the stair bulkhead (brick, a steel door) with a little deck on top, south-east corner
  const cx = RW - 5, cz = -RL + 4;
  const br = cachedTexture(ctx, 'pg-brick', () => T.brick({ color: [0.5, 0.24, 0.17], seed: 23 }).color, { aniso: 8 });
  const bulk = new Mesh(ctx.geometry(texBox(7, 3.6, 5, 2, 2)), new Material({ map: br, roughness: 0.9 }), { castShadow: true }); M.m4translation(bulk.matrix, cx, 1.8, cz); scene.add(bulk);
  matte.push({ geo: G.box(7.4, 0.25, 5.4), matrix: TR(cx, 3.72, cz), color: c4('#5a5a5c') });
  for (const [x0, z0, x1, z1] of [[cx - 3.6, cz - 2.6, cx + 3.6, cz - 2.6], [cx - 3.6, cz + 2.6, cx + 3.6, cz + 2.6], [cx - 3.6, cz - 2.6, cx - 3.6, cz + 2.6]]) metal.push({ geo: G.tube([[x0, 4.8, z0], [x1, 4.8, z1]], 0.04, 6), color: c4('#2a2d30') });
  for (let s = 0; s < 6; s++) put(metal, G.box(0.9, 0.08, 0.3), cx + 3.9, 0.6 * (s + 1), cz - 1.8 + s * 0.6, '#3a3f44');
  const door = clubDoor(matte, glow, cx - 1, cz + 2.52, 0, { door: '#2c3a46' });
  clubMarquee(env, 'roof', 'STAIR HOUSE', cx, 4.5, cz + 2.45, 0, 3.6, '#ff8a3c', '#1b1d22', door);
  solids.push({ x0: cx - 3.6, x1: cx + 3.6, z0: cz - 2.6, z1: cz + 2.6, h: 3.8 });
  return { bounds: { x0: -RW + 1, x1: RW - 1, z0: -RL + 1, z1: RL - 1 }, clubhouse: { door, anchor: { x: cx, y: 0, z: cz, yaw: 0, w: 7, d: 5 }, style: 'bulkhead' }, lightColor: [1, 0.95, 0.88] };
};

// ---------------- more shared pieces (the last eight) ----------------
const TRP = (x, y, z, yaw, pitch, sx = 1, sy = 1, sz = 1) => M.m4compose(M.m4(), [x, y, z], M.qmul(M.q4(), M.qaxis(M.q4(), 0, 1, 0, yaw), M.qaxis(M.q4(), 1, 0, 0, pitch)), [sx, sy, sz]);
// string lights between posts [[x, z]...] (closed: back to the first), y high, sagging; a bulb every ~1.6 m
function stringLights(env, posts, y, sag, colors, closed = true, postColor = '#5a4632', size = 0.07) {
  const { metal, glow } = env;
  for (const [x, z] of posts) metal.push({ geo: G.cylinder(0.07, 0.09, y + 0.2, 8, { y0: true }), matrix: TR(x, 0, z), color: c4(postColor) });
  const n = closed ? posts.length : posts.length - 1;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = posts[i], [bx, bz] = posts[(i + 1) % posts.length], m = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 1.6));
    const path = [];
    for (let j = 0; j <= 8; j++) { const t = j / 8; path.push([ax + (bx - ax) * t, y - Math.sin(t * Math.PI) * sag, az + (bz - az) * t]); }
    metal.push({ geo: G.tube(path, 0.012, 3), color: c4('#1e1e1e') });
    for (let j = 1; j < m; j++) { const t = j / m, c = colors[k++ % colors.length]; glow.push({ geo: G.sphere(size, 6, 4), matrix: TR(ax + (bx - ax) * t, y - Math.sin(t * Math.PI) * sag - size * 1.4, az + (bz - az) * t), color: Array.isArray(c) ? c : c4(c) }); }
  }
}
// a seated row along a line (benches, steps, chairs), facing the court
function sitRow(seats, ax, az, bx, bz, n, y, faceTo = [0, 0]) {
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; seats.push({ x, y, z, yaw: Math.atan2(faceTo[0] - x, faceTo[1] - z) }); }
}
// a box room with a textured shell (one mesh): walls of material mat, w along x, d along z, h tall, at x, z turned yaw
function shell(ctx, scene, mat, x, z, w, h, d, yaw, tu = 3, tv = 3) {
  const m = new Mesh(ctx.geometry(texBox(w, h, d, tu, tv)), mat, { castShadow: true });
  M.m4fromYaw(m.matrix, x, h / 2, z, yaw); scene.add(m);
  return m;
}
// a lit window: a frame and a pane that glows by the time of day (indoors: always a little)
function litWindow(env, parts, x, y, z, yaw, w, h, k = 1) {
  const g = win(env.look, k), lit = g[0] > 0;
  parts.push({ geo: G.box(w + 0.16, h + 0.16, 0.08), matrix: TR(x, y, z, yaw), color: c4('#2a2d30') });
  (lit ? env.glow : parts).push({ geo: G.box(w, h, 0.06), matrix: M.m4mul(M.m4(), TR(x, y, z, yaw), TR(0, 0, 0.03)), color: lit ? [g[0] * 0.55, g[1] * 0.5, g[2] * 0.42, 1] : c4('#22303a') });
}
// a desert or park rock: a squashed low-poly ball
function rock(parts, x, z, s, color, rng) { parts.push({ geo: G.sphere(1, 7, 5), matrix: TRS(x, s * 0.25, z, rng.range(0, 6.28), s * rng.range(0.9, 1.4), s * rng.range(0.5, 0.8), s), color: c4(color) }); }

// 5. Projects: a court in the middle of a housing project: tall brick slabs all round (lit windows, water tanks on
// the roofs), a tall chain-link cage round the court with a gate, benches, a jungle gym, handball walls with murals at
// both ends; the clubhouse is the low brick community center on the east side
SCENERY.projects = env => {
  const { ctx, scene, matte, metal, foliage, glow, seats, solids, fixed, look } = env;
  ground(ctx, scene, 'asph-proj', () => T.asphalt({ seed: 14 }), 320, 8, '#c8c2ba');
  // worn lawns behind low pipe rails, a tree or two on each
  for (const [x, z, w, d] of [[-36, -30, 24, 18], [36, -32, 22, 16], [-36, 32, 24, 18], [38, 30, 20, 20]]) {
    matte.push({ geo: G.box(w, 0.06, d), matrix: TR(x, 0.03, z), color: c4('#56653f') });
    const r = [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]];
    for (let i = 0; i < 4; i++) { const [ax, az] = r[i], [bx, bz] = r[(i + 1) % 4]; metal.push({ geo: G.tube([[ax, 0.55, az], [bx, 0.55, bz]], 0.03, 4), color: c4('#3e4a3a') }); }
    for (let i = 0; i < 2; i++) foliage.push(...PR.tree(x + (i ? 1 : -1) * w / 4, z + fixed.range(-d / 4, d / 4), 0.9 + fixed.next() * 0.3, fixed, '#4a6a38'));
  }
  // the towers: brick slabs of twelve to twenty floors, a parapet, a bulkhead and a water tank on every roof
  const FL = 3.4, towers = [
    { x: -50, z: -48, w: 32, d: 14, h: 14 * FL }, { x: 0, z: -66, w: 36, d: 14, h: 16 * FL }, { x: 52, z: -46, w: 14, d: 32, h: 13 * FL },
    { x: -54, z: 42, w: 14, d: 32, h: 15 * FL }, { x: 4, z: 68, w: 36, d: 14, h: 14 * FL }, { x: 52, z: 46, w: 32, d: 14, h: 12 * FL },
    { x: -110, z: -6, w: 16, d: 44, h: 18 * FL }, { x: 112, z: 8, w: 16, d: 44, h: 17 * FL }, { x: -40, z: -122, w: 40, d: 16, h: 20 * FL }, { x: 60, z: 120, w: 40, d: 16, h: 19 * FL },
  ].map((t, i) => ({ ...t, tint: ['#ffffff', '#ead8cc', '#dccabe'][i % 3] }));
  blocks(ctx, scene, towers, 'projects', { wall: '#7a4434', lit: 0.48, emissive: win(look, 1.25), seed: 64, detail: { bays: 6, floors: 5, kind: 'brick' } });
  for (const t of towers) {
    matte.push({ geo: G.box(t.w + 0.5, 0.7, t.d + 0.5), matrix: TR(t.x, t.h + 0.35, t.z), color: c4('#5a3a30') }, { geo: G.box(5, 3, 4), matrix: TR(t.x + t.w / 4, t.h + 1.5, t.z), color: c4('#6a4a3e') });
    const tx = t.x - t.w / 5, tz = t.z;
    matte.push({ geo: G.cylinder(2.2, 2.2, 3.6, 12, { y0: true }), matrix: TR(tx, t.h + 2.4, tz), color: c4('#7a6248') }, { geo: G.cylinder(0.2, 2.4, 1.2, 12, { y0: true }), matrix: TR(tx, t.h + 6, tz), color: c4('#4a3a2e') });
    for (const [sx, sz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) metal.push({ geo: G.box(0.14, 2.4, 0.14), matrix: TR(tx + sx, t.h + 1.2, tz + sz), color: c4('#2a2d30') });
    // a lit entrance canopy at the foot of the nearer ones
    if (Math.hypot(t.x, t.z) < 90) { const f = Math.abs(t.x) > Math.abs(t.z) ? [t.x - Math.sign(t.x) * (t.w / 2 + 1), t.z, Math.PI / 2] : [t.x, t.z - Math.sign(t.z) * (t.d / 2 + 1), 0]; matte.push({ geo: G.box(f[2] ? 2.2 : 5, 0.25, f[2] ? 5 : 2.2), matrix: TR(f[0], 3.2, f[1]), color: c4('#3a3f44') }); glow.push({ geo: G.box(0.8, 0.06, 0.8), matrix: TR(f[0], 3.05, f[1]), color: [1, 0.86, 0.6, 1] }); }
  }
  // stoops at the nearer towers' doors: people sitting out on the steps, a few standing about in front
  for (const t of towers) if (Math.hypot(t.x, t.z) < 90) {
    const side = Math.abs(t.x) > Math.abs(t.z), fx0 = side ? t.x - Math.sign(t.x) * (t.w / 2) : t.x, fz0 = side ? t.z : t.z - Math.sign(t.z) * (t.d / 2), out = side ? [-Math.sign(t.x), 0] : [0, -Math.sign(t.z)], yaw = Math.atan2(out[0], out[1]);
    for (let st = 0; st < 3; st++) matte.push({ geo: G.box(side ? 0.5 : 4.4, 0.18 * (3 - st), side ? 4.4 : 0.5), matrix: TR(fx0 + out[0] * (0.25 + st * 0.5), 0.09 * (3 - st), fz0 + out[1] * (0.25 + st * 0.5)), color: c4('#9a968e') });
    for (let i = 0; i < 4; i++) { const a = -1.6 + i * 1.05, st = 1 + (i % 2); seats.push({ x: fx0 + out[0] * (0.25 + st * 0.5) + (side ? 0 : a), y: 0.18 * (3 - st), z: fz0 + out[1] * (0.25 + st * 0.5) + (side ? a : 0), yaw }); }
    standRow(seats, fx0 + out[0] * 3.2 + (side ? 0 : -2.2), fz0 + out[1] * 3.2 + (side ? -2.2 : 0), fx0 + out[0] * 3.6 + (side ? 0 : 2.2), fz0 + out[1] * 3.6 + (side ? 2.2 : 0), 3, 0, [0, 0]);
  }
  // the cage round the court: a tall chain-link fence, the gate mid-west
  const fx = W2 + 4.4, fz = L2 + 4.2;
  fences(env, [[-fx, -fz, fx, -fz], [-fx, fz, fx, fz], [-fx, -fz, -fx, -1.6], [-fx, 1.6, -fx, fz], [fx, -fz, fx, fz]], 4.8);
  // handball walls behind both baselines (past the game cameras), each with a mural toward the court
  for (const [z, yaw, i] of [[-31.5, 0, 0], [31.5, Math.PI, 1]]) {
    const wtex = cachedTexture(ctx, 'projmural-' + i, () => T.mural(['HOLD IT DOWN', 'OUR HOUSE'][i], { seed: 140 + i, bg: '#6a6660', palette: [['#ff5a3c', '#ffd23f', '#2fe0ff', '#f4f1e8', '#7dff6a'], ['#b14dff', '#ff8a3c', '#43e8ff', '#f4f1e8', '#ffe45c']][i] }), {});
    matte.push({ geo: G.box(16.6, 5.2, 0.7), matrix: TR(0, 2.6, z - Math.cos(yaw) * 0.36), color: c4('#8a8680') });
    const m = new Mesh(ctx.geometry(G.quad(16, 5, { bottom: true })), new Material({ map: wtex, roughness: 0.9 }), { castShadow: false });
    M.m4fromYaw(m.matrix, 0, 0.1, z + Math.cos(yaw) * 0.01, yaw); scene.add(m);
    solids.push({ x0: -8.3, x1: 8.3, z0: z - 0.8, z1: z + 0.8, h: 5.2 });
  }
  // benches outside the cage, people on them and standing at the fence
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
    const x = sx * (fx + 2.4), z = -12 + i * 6, yaw = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
    if (sx < 0 && z === 0) continue; // (the gate)
    metal.push(...PR.bench(x, z, yaw, '#6a5a48', '#2a2e33'));
    for (const d of [-0.7, 0, 0.7]) seats.push({ x: x + Math.sin(yaw) * 0.05, y: 0.46, z: z + d, yaw });
  }
  standRow(seats, -fx - 0.8, -fz + 1, -fx - 0.8, -2.6, 13); standRow(seats, -fx - 0.8, 2.6, -fx - 0.8, fz - 1, 13);
  standRow(seats, fx + 0.8, -fz + 1, fx + 0.8, fz - 1, 28);
  standRow(seats, -fx + 1, -fz - 0.8, fx - 1, -fz - 0.8, 18); standRow(seats, -fx + 1, fz + 0.8, fx - 1, fz + 0.8, 18);
  // the jungle gym and swings on a rubber pad north-east
  { const px = 28, pz = 24, red = '#d8432c';
    matte.push({ geo: G.box(13, 0.06, 10), matrix: TR(px, 0.03, pz), color: c4('#3f6a4a') });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) metal.push({ geo: G.cylinder(0.07, 0.07, 2.7, 8, { y0: true }), matrix: TR(px - 3 + sx * 0.95, 0, pz + sz * 0.95), color: c4(red) });
    matte.push({ geo: G.box(2, 0.12, 2), matrix: TR(px - 3, 1.5, pz), color: c4('#f2c230') }, { geo: G.box(2.3, 0.1, 2.3), matrix: TR(px - 3, 2.75, pz), color: c4('#2f6ab8') });
    matte.push({ geo: G.box(0.8, 0.06, 3.4), matrix: TRP(px - 3, 0.78, pz + 2.5, 0, Math.atan2(1.5, 3)), color: c4('#2f9a6a') });
    for (let s = 0; s < 5; s++) metal.push({ geo: G.box(0.7, 0.04, 0.04), matrix: TR(px - 3, 0.3 * (s + 1), pz - 1.1), color: c4('#c9ced6') });
    for (let i = 0; i < 7; i++) metal.push({ geo: G.box(0.04, 0.04, 0.6), matrix: TR(px - 1.9 + i * 0.45, 2.1, pz), color: c4('#c9ced6') });
    metal.push({ geo: G.tube([[px - 2, 2.1, pz - 0.3], [px + 1.2, 2.1, pz - 0.3]], 0.03, 4), color: c4(red) }, { geo: G.tube([[px - 2, 2.1, pz + 0.3], [px + 1.2, 2.1, pz + 0.3]], 0.03, 4), color: c4(red) });
    metal.push({ geo: G.tube([[px + 2, 0, pz - 3], [px + 3, 2.6, pz - 3], [px + 6, 2.6, pz - 3], [px + 7, 0, pz - 3]], 0.06, 6), color: c4(red) });
    for (const sx of [3.8, 5.2]) { metal.push({ geo: G.box(0.02, 2, 0.02), matrix: TR(px + sx, 1.6, pz - 3), color: c4('#9aa0a6') }); matte.push({ geo: G.box(0.5, 0.05, 0.22), matrix: TR(px + sx, 0.6, pz - 3), color: c4('#1e1f22') }); }
  }
  // kids on the climbing frame and the swings, a dominoes table by the community center
  for (const [x, y, z] of [[25.2, 1.56, 23.8], [24.6, 1.56, 24.4], [27.2, 2.12, 24], [29.6, 0, 25.6], [31.8, 0.6, 21], [33.2, 0.6, 21]]) seats.push({ x, y, z, yaw: fixed.range(-3, 3), stand: y !== 0.6, scale: 0.66 });
  { const tx = 20.5, tz = 4; matte.push({ geo: G.box(1.2, 0.05, 1.2), matrix: TR(tx, 0.74, tz), color: c4('#e8e4dc') }, { geo: G.cylinder(0.05, 0.05, 0.72, 6, { y0: true }), matrix: TR(tx, 0, tz), color: c4('#3a3f44') });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, x = tx + Math.sin(a) * 0.95, z = tz + Math.cos(a) * 0.95; matte.push({ geo: G.cylinder(0.17, 0.17, 0.45, 8, { y0: true }), matrix: TR(x, 0, z), color: c4('#c8302a') }); seats.push({ x, y: 0.45, z, yaw: a + Math.PI }); }
    for (let i = 0; i < 8; i++) matte.push({ geo: G.box(0.05, 0.02, 0.1), matrix: TR(tx - 0.3 + (i % 4) * 0.2, 0.775, tz - 0.15 + Math.floor(i / 4) * 0.3, 0.3), color: c4('#f4f4f0') });
    standRow(seats, tx + 1.6, tz - 0.8, tx + 1.6, tz + 0.8, 2, 0, [tx, tz]); }
  // street lamps on the walks
  for (const [x, z] of [[-17, -24], [17, -24], [-17, 24], [17, 24], [-30, 0], [32, 6]]) metal.push(...PR.streetLamp(x, z, 5.5));
  // the clubhouse: the community center, low brick on the east side, a canopy over its door
  const cx = 26, cz = -11, cw = 9, cd = 14, ch = 4.6;
  const br = new Material({ map: cachedTexture(ctx, 'pg-brick2', () => T.brick({ color: [0.46, 0.25, 0.18], seed: 29 }).color, { aniso: 8 }), roughness: 0.9 });
  shell(ctx, scene, br, cx, cz, cw, ch, cd, 0, 2, 2);
  matte.push({ geo: G.box(cw + 0.5, 0.4, cd + 0.5), matrix: TR(cx, ch + 0.2, cz), color: c4('#4a4f55') });
  for (const z of [cz - 4.5, cz + 4.2]) litWindow(env, matte, cx - cw / 2 - 0.02, 2.1, z, -Math.PI / 2, 2.6, 1.4, 0.8);
  const door = clubDoor(matte, glow, cx - cw / 2 - 0.02, cz, -Math.PI / 2, { door: '#1e3a5a', frame: '#c9c2b0' });
  matte.push({ geo: G.box(2.4, 0.18, 3), matrix: TR(cx - cw / 2 - 1.1, 3.1, cz), color: c4('#2a2d30') });
  for (let s = 0; s < 2; s++) matte.push({ geo: G.box(1.2 - s * 0.4, 0.15, 3.2), matrix: TR(cx - cw / 2 - 0.6 + s * 0.2, 0.075 + s * 0.15, cz), color: c4('#9a968e') });
  clubMarquee(env, 'proj', 'COMMUNITY CENTER', cx - cw / 2 + 0.1, ch + 0.95, cz, -Math.PI / 2, 4.4, '#f4efe4', '#1e3a5a', door);
  bannerQuad(ctx, scene, env.bannerMats.logo, cx - cw / 2 - 0.06, 2.2, cz - 2.3, -Math.PI / 2, 1.1, 2.2, env.banners);
  sitRow(seats, cx - cw / 2 - 0.5, cz + 2.2, cx - cw / 2 - 0.5, cz + 6, 4, 0.3);
  solids.push({ x0: cx - cw / 2, x1: cx + cw / 2, z0: cz - cd / 2, z1: cz + cd / 2, h: ch });
  // the home team's banners: on the cage, and hanging big down the two towers behind the baselines
  for (const z of [-fz - 0.05, fz + 0.05]) bannerQuad(ctx, scene, env.bannerMats.name, 0, 1.45, z, z < 0 ? 0 : Math.PI, 5.6, 1.3, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.logo, 0, 26, -66 + 7.1, 0, 7, 14, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.logo, 4, 24, 68 - 7.1, Math.PI, 7, 14, env.banners);
  floodTowers(metal, glow);
  if (look.tod !== 'day') env.lights.push({ pos: [cx - cw / 2 - 1.5, 3, cz], range: 12, color: [1, 0.85, 0.6], intensity: 6, dir: null });
  return { bounds: { x0: -21, x1: 21, z0: -27, z1: 27 }, clubhouse: { door, anchor: { x: cx, y: 0, z: cz, yaw: -Math.PI / 2, w: cd - 0.6, d: cw - 0.6 }, style: 'community' }, lightColor: [1, 0.9, 0.74] };
};

// 6. Riverside: a court on the embankment by a wide river: a railed promenade with lamps and benches, the city across
// the water lit up, a steel truss bridge upstream and an arch bridge down, lofts behind; the clubhouse is the old
// boathouse on the bank west of the court
SCENERY.riverside = env => {
  const { ctx, scene, matte, metal, foliage, glow, seats, solids, fixed, look, anim } = env;
  const bank = 25.5;
  ground(ctx, scene, 'conc-river', () => T.concrete({ color: [0.56, 0.55, 0.52], joints: true }), 300, 5, '#cfcbc4', -0.004, 0.9, [0, bank - 150, 300, 300]);
  // the river: its walls, the water two and a half metres down, scrolling
  matte.push({ geo: G.box(300, 3.2, 0.8), matrix: TR(0, -1.6, bank + 0.4), color: c4('#6e6a64') });
  const wn = cachedTexture(ctx, 'waterN2', () => T.waterNormal({ seed: 41 }), { srgb: false });
  const water = G.plane(700, 320, 1, 1); for (let i = 0; i < water.uv.length; i += 2) { water.uv[i] *= 46; water.uv[i + 1] *= 22; }
  const wMat = new Material({ color: lin(look.tod === 'night' ? '#06141c' : look.tod === 'dusk' ? '#2a3442' : '#24485a'), normalMap: wn, normalScale: 0.5, roughness: 0.05, specular: 1.6, metalness: 0.1 });
  const wM = new Mesh(ctx.geometry(water), wMat, { castShadow: false, reflect: false }); M.m4translation(wM.matrix, 0, -2.4, bank + 160); scene.add(wM);
  anim.push({ step(dt) { wMat.uvOffset[0] += 0.02 * dt; wMat.uvOffset[1] += 0.006 * dt; } });
  // the railing, the promenade's lamps (clear of the game cameras) and benches facing the water
  for (let x = -90; x <= 90; x += 2) if (x < -33 || x > -21) metal.push({ geo: G.box(0.06, 1.1, 0.06), matrix: TR(x, 0.55, bank - 0.3), color: c4('#2c3a40') });
  for (const [a, b] of [[-90, -33], [-21, 90]]) for (const y of [0.55, 1.1]) metal.push({ geo: G.tube([[a, y, bank - 0.3], [b, y, bank - 0.3]], 0.035, 5), color: c4('#2c3a40') });
  for (const x of [-46, -14, 14, 26, 38, 50, 62]) metal.push(...PR.streetLamp(x, bank - 1.2, 5, '#1e2a30'));
  for (const x of [-40, -14, 20, 32, 44]) metal.push(...PR.bench(x, bank - 2.4, 0, '#6a5038', '#1e2a30'));
  for (const x of [-40, 20, 32, 44]) sitRow(seats, x - 0.7, bank - 2.45, x + 0.7, bank - 2.45, 3, 0.46, [x, bank + 10]);
  // planters with trees along the promenade, past the sidelines
  for (const [x, z] of [[-28, -8], [-28, 4], [22, -20], [24, 20], [-30, -22], [36, -6]]) { matte.push({ geo: G.box(2.4, 0.6, 2.4), matrix: TR(x, 0.3, z), color: c4('#7a766e') }); foliage.push(...PR.tree(x, z, 0.85, fixed, '#3f6a3a')); solids.push({ x0: x - 1.3, x1: x + 1.3, z0: z - 1.3, z1: z + 1.3, h: 0.6 }); }
  // across the river: the city, tall and lit, its lights on the water
  const city = [];
  for (let i = 0; i < 34; i++) { const x = -230 + i * 14 + fixed.range(-4, 4), z = fixed.range(165, 230), h = fixed.range(26, 130); city.push({ x, z, w: fixed.range(12, 20), d: fixed.range(12, 20), h, tint: fixed.pick(TINTS) }); }
  blocks(ctx, scene, city, 'rivercity', { wall: '#4e5660', glass: '#1a2632', lit: 0.5, emissive: win(look, 1.1), seed: 83, tu: 14, tv: 28 });
  matte.push({ geo: G.box(500, 2, 30), matrix: TR(0, -1.4, 160), color: c4('#4a4844') });
  // the truss bridge upstream (west): its deck on piers, the steel trusses either side, lights along it
  { const bx = -64, y = 12, steel = '#3a5a6a';
    matte.push({ geo: G.box(13, 1.2, 230), matrix: TR(bx, y, 60), color: c4('#5a5a58') });
    for (const z of [-30, 10, bank + 25, bank + 75, bank + 125]) matte.push({ geo: G.box(5, y + 3, 7), matrix: TR(bx, (y - 3) / 2 - 1.5, z), color: c4('#7a766e') });
    for (const sx of [-1, 1]) {
      const x = bx + sx * 6.4, top = [], bot = [];
      for (let z = bank; z <= bank + 125; z += 10) { top.push([x, y + 7, z]); bot.push([x, y + 0.6, z]); }
      metal.push({ geo: G.tube(top, 0.3, 4), color: c4(steel) }, { geo: G.tube(bot, 0.3, 4), color: c4(steel) });
      for (let i = 0; i < top.length; i++) { metal.push({ geo: G.tube([bot[i], top[i]], 0.18, 4), color: c4(steel) }); if (i) metal.push({ geo: G.tube([bot[i - 1], top[i]], 0.16, 4), color: c4(steel) }); }
    }
    for (let z = -60; z <= 170; z += 7) for (const sx of [-1, 1]) glow.push({ geo: G.sphere(0.18, 6, 4), matrix: TR(bx + sx * 6.2, y + 1.2, z), color: [1, 0.82, 0.5, 1] });
  }
  // the arch bridge downstream (east): two arches over the deck, hangers down to it
  { const bx = 82, y = 8, span = [bank + 6, bank + 126], steel = '#c9ced6';
    matte.push({ geo: G.box(14, 1, 240), matrix: TR(bx, y, 60), color: c4('#5e5e5c') });
    for (const z of [-30, 10, span[0], span[1]]) matte.push({ geo: G.box(6, y + 3, 8), matrix: TR(bx, (y - 3) / 2 - 1.5, z), color: c4('#7a766e') });
    for (const sx of [-1, 1]) {
      const x = bx + sx * 6.6, arch = [];
      for (let i = 0; i <= 16; i++) { const t = i / 16; arch.push([x, y + 0.5 + Math.sin(t * Math.PI) * 30, span[0] + (span[1] - span[0]) * t]); }
      metal.push({ geo: G.tube(arch, 0.6, 6), color: c4(steel) });
      for (let i = 1; i < 16; i++) metal.push({ geo: G.tube([[x, y + 0.5, arch[i][2]], arch[i]], 0.06, 3), color: c4(steel) });
      for (let i = 0; i <= 16; i += 2) glow.push({ geo: G.sphere(0.3, 6, 4), matrix: TR(arch[i][0], arch[i][1] + 0.6, arch[i][2]), color: [0.9, 0.95, 1, 1] });
    }
  }
  // behind the court (south): a street and old lofts with big windows
  const lofts = [];
  for (let i = 0; i < 9; i++) lofts.push({ x: -88 + i * 22, z: -50, w: 20, d: 16, h: fixed.range(12, 26), tint: fixed.pick(['#ffffff', '#e8dcd0', '#d8ccc4']) });
  blocks(ctx, scene, lofts, 'riverlofts', { wall: '#6a3e30', lit: 0.45, emissive: win(look), seed: 88, detail: { bays: 5, floors: 4, kind: 'brick' } });
  matte.push({ geo: G.box(240, 0.04, 10), matrix: TR(0, 0.02, -37), color: c4('#3a3b3e') });
  for (let i = 0; i < 4; i++) for (const p of PR.car(fixed.pick(['#7a1f1c', '#2a4a7a', '#d8d4cc', '#1e1f22']))) matte.push({ ...p, matrix: M.m4mul(M.m4(), TR(-30 + i * 19, 0, -39.5, Math.PI / 2), p.matrix || M.m4()) });
  // the concrete steps on the east side (the crowd sits on them), chairs along the west
  for (let i = 0; i < 4; i++) { matte.push({ geo: G.box(0.9, 0.42 * (i + 1), 22), matrix: TR(W2 + 4.6 + i * 0.9, 0.21 * (i + 1), 0), color: c4('#8e8a82') }); sitRow(seats, W2 + 4.6 + i * 0.9, -10.5, W2 + 4.6 + i * 0.9, 10.5, 26, 0.42 * (i + 1)); }
  solids.push({ x0: W2 + 4.1, x1: W2 + 8.4, z0: -11, z1: 11, h: 1.7 });
  for (let i = 0; i < 16; i++) { const z = -11 + i * 1.45; metal.push({ geo: G.box(0.45, 0.04, 0.45), matrix: TR(-W2 - 3, 0.45, z), color: c4('#2a5a6a') }); seats.push({ x: -W2 - 3, y: 0.42, z, yaw: Math.PI / 2 }); }
  standRow(seats, -18, bank - 1, 18, bank - 1, 26, 0, [0, 0]); standRow(seats, -W2, -L2 - 4, W2, -L2 - 4, 16);
  floodTowers(metal, glow, [[-W2 - 5, -L2 - 3], [W2 + 5, -L2 - 3], [-W2 - 5, L2 + 3], [W2 + 5, L2 + 3]], 10, '#26343a');
  // the clubhouse: the old boathouse on the bank, west: board-and-batten walls, a green gable roof, boat doors to
  // the river, its side door toward the court
  const cx = -27, cz = 18, cw = 11, cd = 13, ch = 4.4;
  matte.push({ geo: G.box(cw, ch, cd), matrix: TR(cx, ch / 2, cz), color: c4('#6e4a30') });
  for (let i = 0; i <= 18; i++) { const z = cz - cd / 2 + i * (cd / 18); for (const sx of [-1, 1]) matte.push({ geo: G.box(0.08, ch, 0.12), matrix: TR(cx + sx * (cw / 2 + 0.04), ch / 2, z), color: c4('#5a3a24') }); }
  for (let i = 0; i <= 14; i++) { const x = cx - cw / 2 + i * (cw / 14); matte.push({ geo: G.box(0.12, ch, 0.08), matrix: TR(x, ch / 2, cz - cd / 2 - 0.04), color: c4('#5a3a24') }); }
  matte.push({ geo: gable(cw + 1, cd + 1, 3.2), matrix: TR(cx, ch, cz), color: c4('#2f4a3a') });
  matte.push({ geo: G.box(cw - 3, 3, 0.1), matrix: TR(cx, 1.5, cz + cd / 2 + 0.05), color: c4('#e8e2d4') });
  for (let x = -3; x <= 3; x++) metal.push({ geo: G.box(0.06, 3, 0.04), matrix: TR(cx + x * 1.1, 1.5, cz + cd / 2 + 0.11), color: c4('#2f4a3a') });
  matte.push({ geo: G.box(cw, 0.2, 8), matrix: TR(cx, -0.4, bank + 4), color: c4('#7a5a3a') });
  for (const [sx, sz] of [[-1, 2], [1, 2], [-1, 6], [1, 6]]) matte.push({ geo: G.box(0.25, 2.4, 0.25), matrix: TR(cx + sx * (cw / 2 - 0.4), -1.6, bank + sz), color: c4('#4a3624') });
  litWindow(env, matte, cx + cw / 2 + 0.03, 2.2, cz + 3, Math.PI / 2, 2, 1.2, 0.8);
  const door = clubDoor(matte, glow, cx + cw / 2 + 0.03, cz - 2.5, Math.PI / 2, { door: '#2f4a3a', frame: '#e8e2d4' });
  glow.push({ geo: G.box(0.5, 0.12, 0.3), matrix: TR(cx + cw / 2 + 0.2, 2.75, cz - 2.5), color: [1, 0.86, 0.6, 1] });
  if (look.tod !== 'day') env.lights.push({ pos: [cx + cw / 2 + 1.5, 3, cz - 2.5], range: 12, color: [1, 0.84, 0.6], intensity: 6, dir: null });
  clubMarquee(env, 'river', 'BOATHOUSE', cx + cw / 2 + 0.14, 3.62, cz + 1.2, Math.PI / 2, 3.2, '#f4efe4', '#2f4a3a', door);
  solids.push({ x0: cx - cw / 2, x1: cx + cw / 2, z0: cz - cd / 2, z1: cz + cd / 2, h: ch });
  // the home team's banners: on the light poles, and big on the boathouse gable
  for (const [x, z] of [[-W2 - 5, -L2 - 3], [W2 + 5, L2 + 3]]) bannerQuad(ctx, scene, env.bannerMats.logo, x + Math.sign(x) * 0.25, 5.5, z, Math.PI / 2, 1.3, 2.8, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.name, cx, ch + 1.2, cz - cd / 2 - 0.62, Math.PI, 5, 1.25, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.name, 0, 1.15, bank - 0.35, Math.PI, 5.2, 1.1, env.banners);
  if (look.tod !== 'day') env.lights.push({ pos: [0, 5, bank - 2], range: 26, color: [1, 0.84, 0.6], intensity: 7, dir: null });
  return { bounds: { x0: -21, x1: 21, z0: -27, z1: bank - 1 }, clubhouse: { door, anchor: { x: cx, y: 0, z: cz, yaw: Math.PI / 2, w: cd - 0.6, d: cw - 0.6 }, style: 'boathouse' }, lightColor: [0.92, 0.95, 1] };
};

// 7. Old Warehouse: an indoor court laid in a converted brick warehouse: a steel frame, a sawtooth roof whose glazing
// shows the sky, tall multi-pane windows, pendant lamps, a loading door, a forklift and pallets, crates for seats and a
// bleacher, a mural on the end wall; the clubhouse is the foreman's office in the south-west corner
SCENERY.warehouse = env => {
  const { ctx, scene, matte, metal, glow, seats, solids, fixed, look } = env;
  const W = W2 + 12.5, L = L2 + 15, H = 12.5; // (the game cameras inside: the broadcast one 19 m out, the 2K one 28.5 back)
  ground(ctx, scene, 'conc-ware', () => T.concrete({ color: [0.46, 0.45, 0.43], joints: true }), 0, 4, '#b0aaa2', -0.004, 0.7, [0, 0, W * 2, L * 2]);
  const brickTex = cachedTexture(ctx, 'pg-brick3', () => T.brick({ color: [0.44, 0.22, 0.15], seed: 37 }).color, { aniso: 8 });
  const walls = [];
  for (const [x, z, w, yaw] of [[0, -L, W * 2, 0], [0, L, W * 2, Math.PI], [-W, 0, L * 2, Math.PI / 2], [W, 0, L * 2, -Math.PI / 2]]) walls.push({ geo: texQuad(w, H + 2.6, 2.2, 2.2, { bottom: true }), matrix: TR(x, 0, z, yaw) });
  scene.add(new Mesh(ctx.geometry(G.merge(walls, false)), new Material({ map: brickTex, roughness: 0.92 }), { castShadow: false }));
  for (const [x, z, w, d] of [[0, -L + 0.08, W * 2, 0.16], [0, L - 0.08, W * 2, 0.16], [-W + 0.08, 0, 0.16, L * 2], [W - 0.08, 0, 0.16, L * 2]]) matte.push({ geo: G.box(w, 1.1, d), matrix: TR(x, 0.55, z), color: c4('#3e4a44') }); // (the old paint band)
  // the steel frame: columns down the long walls, a truss across at each
  const steel = '#2e3a40';
  for (let z = -24; z <= 24; z += 8) {
    for (const sx of [-1, 1]) { const x = sx * (W - 0.5); metal.push({ geo: G.box(0.3, H, 0.3), matrix: TR(x, H / 2, z), color: c4(steel) }, { geo: G.box(0.06, H, 0.5), matrix: TR(x - sx * 0.15, H / 2, z), color: c4(steel) }); }
    metal.push({ geo: G.box(W * 2, 0.35, 0.25), matrix: TR(0, H - 0.2, z), color: c4(steel) }, { geo: G.box(W * 2, 0.25, 0.25), matrix: TR(0, H - 2.2, z), color: c4(steel) });
    for (let i = -6; i <= 6; i++) metal.push({ geo: G.tube([[i * 3.2, H - 2.2, z], [i * 3.2 + 1.6, H - 0.2, z], [i * 3.2 + 3.2, H - 2.2, z]], 0.06, 4), color: c4(steel) });
  }
  // the sawtooth roof: sloped panels, the glazing in each step lit by the sky
  const n = 10, step = (L * 2) / n, rise = 2.4, sky = look.tod === 'day' ? [2.2, 2.35, 2.5] : look.tod === 'dusk' ? [1.9, 1.15, 0.75] : [0.07, 0.08, 0.14];
  const roof = [], glaze = [];
  for (let i = 0; i < n; i++) {
    const z0 = -L + i * step;
    roof.push({ geo: G.box(W * 2, 0.14, Math.hypot(step, rise)), matrix: TRP(0, H + rise / 2, z0 + step / 2, 0, -Math.atan2(rise, step)), color: c4('#3a3632') });
    glaze.push({ geo: G.quad(W * 2, rise, { bottom: true }), matrix: TR(0, H, z0 + step - 0.02, Math.PI) });
    for (let x = -W + 2; x < W; x += 2.4) metal.push({ geo: G.box(0.08, rise, 0.1), matrix: TR(x, H + rise / 2, z0 + step - 0.05), color: c4(steel) });
  }
  scene.add(new Mesh(ctx.geometry(G.merge(roof)), new Material({ color: [1, 1, 1], roughness: 0.9 }), { castShadow: false, reflect: false }));
  scene.add(new Mesh(ctx.geometry(G.merge(glaze, false)), new Material({ color: [1, 1, 1], shading: 'unlit', emissive: sky, fog: false }), { castShadow: false, reflect: false }));
  // tall multi-pane windows down both long walls
  const paneC = look.tod === 'day' ? [0.85, 0.9, 1, 1] : look.tod === 'dusk' ? [0.8, 0.5, 0.32, 1] : [0.03, 0.035, 0.06, 1];
  for (const sx of [-1, 1]) for (const z of [-20, -12, -4, 4, 12, 20]) {
    const x = sx * (W - 0.04), yaw = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
    glow.push({ geo: G.box(0.04, 4.6, 4.2), matrix: TR(x, 6.2, z), color: paneC });
    for (let i = 0; i <= 6; i++) metal.push({ geo: G.box(0.1, 4.6, 0.07), matrix: TR(x - sx * 0.03, 6.2, z - 2.1 + i * 0.7), color: c4('#1e2426') });
    for (let i = 0; i <= 6; i++) metal.push({ geo: G.box(0.1, 0.07, 4.2), matrix: TR(x - sx * 0.03, 3.9 + i * (4.6 / 6), z), color: c4('#1e2426') });
    matte.push({ geo: G.box(0.3, 0.2, 4.6), matrix: TR(x - sx * 0.12, 3.8, z), color: c4('#8a7a6a') });
    void yaw;
  }
  // pendant lamps over the floor (high: above the game cameras' frames), on cables to the trusses
  for (const x of [-7, 0, 7]) for (const z of [-16, -5.5, 5.5, 16]) {
    metal.push({ geo: G.cylinder(0.1, 0.6, 0.5, 12, { y0: true }), matrix: TR(x, 9.6, z), color: c4('#3a4a3e') }, { geo: G.box(0.02, H - 2.2 - 10.1, 0.02), matrix: TR(x, (H - 2.2 + 10.1) / 2, z), color: c4('#111') });
    glow.push({ geo: G.cylinder(0.56, 0.56, 0.02, 12, { y0: true }), matrix: TR(x, 9.58, z), color: [1, 0.9, 0.72, 1] });
  }
  // the loading door (north wall), a forklift, pallets and drums
  { const dx = -9;
    matte.push({ geo: G.box(6.4, 5.4, 0.12), matrix: TR(dx, 2.7, L - 0.1), color: c4('#7a8088') });
    for (let i = 0; i < 18; i++) metal.push({ geo: G.box(6.3, 0.05, 0.06), matrix: TR(dx, 0.2 + i * 0.3, L - 0.18), color: c4('#5a6068') });
    for (let i = 0; i < 9; i++) matte.push({ geo: G.box(0.7, 0.3, 0.04), matrix: TR(dx - 2.8 + i * 0.7, 5.6, L - 0.2), color: c4(i % 2 ? '#1e1e1e' : '#f2c230') });
    const fk = [-14, L - 6];
    matte.push({ geo: G.box(1.3, 1.1, 2.2), matrix: TR(fk[0], 0.75, fk[1]), color: c4('#e8a82a') }, { geo: G.box(1.2, 0.08, 1.4), matrix: TR(fk[0], 2.2, fk[1] + 0.2), color: c4('#1e1e1e') });
    for (const sx of [-0.5, 0.5]) { metal.push({ geo: G.box(0.1, 2.4, 0.1), matrix: TR(fk[0] + sx, 1.2, fk[1] - 1.15), color: c4('#2a2a2a') }, { geo: G.box(0.12, 0.05, 1.1), matrix: TR(fk[0] + sx * 0.6, 0.1, fk[1] - 1.7), color: c4('#2a2a2a') }); for (const sz of [-0.7, 0.7]) matte.push({ geo: G.cylinder(0.3, 0.3, 0.24, 10), matrix: TRP(fk[0] + sx * 1.4, 0.3, fk[1] + sz, Math.PI / 2, Math.PI / 2), color: c4('#1a1a1a') }); }
    solids.push({ x0: fk[0] - 0.9, x1: fk[0] + 0.9, z0: fk[1] - 2.3, z1: fk[1] + 1.2, h: 2.3 });
    for (const [x, z, k] of [[W - 3, L - 3, 4], [W - 5.5, L - 2.5, 2], [-W + 3, 8, 3], [W - 3, -L + 6, 3]]) for (let j = 0; j < k; j++) matte.push({ geo: G.box(1.2, 0.14, 1.0), matrix: TR(x, 0.07 + j * 0.15, z, 0.1 * j), color: c4('#9a7a52') });
    for (const [x, z, c] of [[W - 2, -6, '#2f5a8a'], [W - 2.7, -5.4, '#8a2f2a'], [W - 2, -4.6, '#2f5a8a'], [-W + 2, 18, '#3a6a3a']]) matte.push({ geo: G.cylinder(0.3, 0.3, 0.9, 12, { y0: true }), matrix: TR(x, 0, z), color: c4(c) });
  }
  // the mural on the south wall
  { const tex = cachedTexture(ctx, 'waremural', () => T.mural('OLD WORKS', { seed: 177, bg: '#4a3a30', palette: ['#ffb347', '#f4f1e8', '#43e8ff', '#ff5a3c', '#f2c14e'] }), {});
    const m = new Mesh(ctx.geometry(G.quad(14, 6.5, { bottom: true })), new Material({ map: tex, roughness: 0.9 }), { castShadow: false }); M.m4fromYaw(m.matrix, 3, 1.8, -L + 0.05, 0); scene.add(m); }
  // the seats: a bleacher on the east side, crate stacks and an old couch on the west
  matte.push(...PR.bleacher(W2 + 3.4, 0, -Math.PI / 2, 22, 6, '#3a3632', '#8a6a46')); bleacherSeats(seats, W2 + 3.4, 0, -Math.PI / 2, 22, 6);
  solids.push({ x0: W2 + 3, x1: W2 + 7.4, z0: -11, z1: 11, h: 3 });
  for (let i = 0; i < 9; i++) { const z = -12 + i * 3, x = -W2 - 3.6; matte.push({ geo: G.box(1.2, 0.9, 1.2), matrix: TR(x, 0.45, z, fixed.range(-0.1, 0.1)), color: c4(fixed.pick(['#8a6a46', '#7a5a3a', '#9a7a52'])) }, { geo: G.box(1.2, 0.9, 1.2), matrix: TR(x - 1.3, 0.45, z, fixed.range(-0.1, 0.1)), color: c4('#7a5a3a') }, { geo: G.box(1.1, 0.8, 1.1), matrix: TR(x - 1.3, 1.3, z, 0.2), color: c4('#8a6a46') }); seats.push({ x, y: 0.9, z: z - 0.3, yaw: Math.PI / 2 }, { x, y: 0.9, z: z + 0.3, yaw: Math.PI / 2 }, { x: x - 1.3, y: 1.7, z, yaw: Math.PI / 2 }); }
  solids.push({ x0: -W2 - 5.6, x1: -W2 - 2.9, z0: -13, z1: 13, h: 1.7 });
  matte.push(...PR.couch(-W2 - 3.4, 16.5, Math.PI / 2, '#6a3a2a', 2.6)); sitRow(seats, -W2 - 3.4, 15.6, -W2 - 3.4, 17.4, 3, 0.42);
  standRow(seats, -W + 2, -L + 1.6, -8, -L + 1.6, 9); standRow(seats, 0, -L + 1.6, W - 2, -L + 1.6, 12); standRow(seats, -W2, L - 1.6, W2, L - 1.6, 16);
  // the clubhouse: the foreman's office in the south-west corner: brick to the sill, a lit window band, a door
  const ox = -W + 4.5, oz = -L + 3.2, ow = 8, od = 6.2, oh = 3.6;
  matte.push({ geo: G.box(ow, oh, od), matrix: TR(ox, oh / 2, oz), color: c4('#5a3e30') }, { geo: G.box(ow + 0.4, 0.25, od + 0.4), matrix: TR(ox, oh + 0.12, oz), color: c4('#2a2d30') });
  glow.push({ geo: G.box(4.6, 1.3, 0.06), matrix: TR(ox - 1.2, 2.25, oz + od / 2 + 0.02), color: [0.95, 0.85, 0.6, 1] });
  for (let i = 0; i <= 6; i++) metal.push({ geo: G.box(0.05, 1.3, 0.08), matrix: TR(ox - 3.5 + i * 0.77, 2.25, oz + od / 2 + 0.05), color: c4('#1e2426') });
  const door = clubDoor(matte, glow, ox + 2.6, oz + od / 2 + 0.02, 0, { door: '#3a4a3e', frame: '#8a7a6a' });
  clubMarquee(env, 'ware', "FOREMAN'S OFFICE", ox - 1.2, oh + 0.75, oz + od / 2 - 0.05, 0, 3.8, '#ffb347', '#1e2426', null);
  for (let j = 0; j < 3; j++) matte.push({ geo: G.box(1.1, 0.9, 1.1), matrix: TR(ox - 2 + j * 1.6, oh + 0.7, oz - 1, 0.3 * j), color: c4('#8a6a46') });
  solids.push({ x0: ox - ow / 2, x1: ox + ow / 2, z0: oz - od / 2, z1: oz + od / 2, h: oh });
  // the home team: banners down the end walls, the logo between the windows
  for (const z of [-L + 0.1, L - 0.1]) bannerQuad(ctx, scene, env.bannerMats.name, z < 0 ? -12 : 6, 9, z, z < 0 ? 0 : Math.PI, 8, 2, env.banners);
  for (const sx of [-1, 1]) bannerQuad(ctx, scene, env.bannerMats.logo, sx * (W - 0.12), 6.5, 0, sx < 0 ? Math.PI / 2 : -Math.PI / 2, 2.4, 4.8, env.banners);
  env.lights.push({ pos: [-7, 9, -9], range: 26, color: [1, 0.9, 0.74], intensity: 13, dir: null }, { pos: [7, 9, 9], range: 26, color: [1, 0.9, 0.74], intensity: 13, dir: null }, { pos: [7, 9, -9], range: 22, color: [1, 0.9, 0.74], intensity: 9, dir: null }, { pos: [-7, 9, 9], range: 22, color: [1, 0.9, 0.74], intensity: 9, dir: null });
  return { bounds: { x0: -W + 1, x1: W - 1, z0: -L + 1, z1: L - 1 }, clubhouse: { door, anchor: { x: ox, y: 0, z: oz, yaw: 0, w: ow - 0.5, d: od - 0.5 }, style: 'office' }, floodlit: false };
};

// 8. Schoolyard: a middle school's blacktop: the brick school along the south with murals on its ground floor and a
// flagpole, hopscotch and four-square painted behind both baselines, a climbing frame with a tube slide, a tetherball
// pole, aluminium bleachers, houses across the street to the north; the clubhouse is the portable classroom
SCENERY.schoolyard = env => {
  const { ctx, scene, matte, metal, foliage, glow, seats, solids, fixed, look } = env;
  ground(ctx, scene, 'asph-school', () => T.asphalt({ seed: 22 }), 320, 8, '#d6d2cc');
  // the painted games on the blacktop (a decal behind each baseline, where the 2K camera sees it)
  const games = cachedTexture(ctx, 'yardgames', () => {
    const c = T.canvas(1024, 512), g = c.getContext('2d');
    g.clearRect(0, 0, 1024, 512); g.lineWidth = 7; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // hopscotch
    g.strokeStyle = '#ffe14a'; g.fillStyle = '#ffe14a';
    const hs = [[0, 1], [1, 1], [2, 2], [3, 1], [4, 2], [5, 1]]; let n = 1;
    for (const [row, k] of hs) for (let i = 0; i < k; i++) { const x = 60 + row * 70, y = k === 1 ? 216 : 146 + i * 140; g.strokeRect(x, y, 70, k === 1 ? 80 : 70); g.fillText(String(n++), x + 35, y + (k === 1 ? 40 : 35)); }
    // four-square
    g.strokeStyle = '#f4f4f0'; g.strokeRect(500, 106, 300, 300); g.beginPath(); g.moveTo(650, 106); g.lineTo(650, 406); g.moveTo(500, 256); g.lineTo(800, 256); g.stroke();
    g.fillStyle = '#f4f4f0'; ['A', 'B', 'C', 'D'].forEach((t, i) => g.fillText(t, 575 + (i % 2) * 150, 181 + Math.floor(i / 2) * 150));
    // a compass rose
    g.strokeStyle = '#5ac8ff'; g.beginPath(); g.arc(920, 256, 80, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#5ac8ff';
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.beginPath(); g.moveTo(920 + Math.sin(a) * 90, 256 - Math.cos(a) * 90); g.lineTo(920 + Math.sin(a + 0.4) * 22, 256 - Math.cos(a + 0.4) * 22); g.lineTo(920 + Math.sin(a - 0.4) * 22, 256 - Math.cos(a - 0.4) * 22); g.fill(); }
    return c;
  }, { wrap: 'clamp' });
  const gm = new Material({ map: games, alphaTest: 0.4, roughness: 0.8, color: [0.9, 0.9, 0.9] });
  for (const [z, yaw] of [[-L2 - 7.4, 0], [L2 + 7.4, Math.PI]]) { const m = new Mesh(ctx.geometry(G.plane(14, 7)), gm, { castShadow: false, reflect: false }); M.m4fromYaw(m.matrix, 0, 0.012, z, yaw); m.order = 1; scene.add(m); }
  // the school along the south: three floors of brick, the entrance pavilion with its name, murals on the ground floor
  const sz = -36;
  blocks(ctx, scene, [{ x: 0, z: sz - 8, w: 84, d: 16, h: 11 }, { x: -48, z: sz - 14, w: 14, d: 28, h: 7.6 }, { x: 48, z: sz - 14, w: 14, d: 28, h: 7.6 }], 'school', { wall: '#8a4a36', lit: 0.3, emissive: win(look, 0.7), seed: 91, detail: { bays: 6, floors: 3, kind: 'brick' } });
  matte.push({ geo: G.box(84.6, 0.6, 16.6), matrix: TR(0, 11.3, sz - 8), color: c4('#d8d2c4') }, { geo: G.box(15, 12.6, 4.4), matrix: TR(0, 6.3, sz + 1.8), color: c4('#c9c0ae') });
  glow.push({ geo: G.box(4.6, 2.6, 0.06), matrix: TR(0, 1.4, sz + 4.03), color: look.tod === 'day' ? [0.5, 0.56, 0.6, 1] : [1, 0.86, 0.6, 1] });
  for (let i = 0; i < 4; i++) matte.push({ geo: G.box(9 - i * 0.6, 0.16, 0.5), matrix: TR(0, 0.08 + i * 0.16, sz + 4.4 + (3 - i) * 0.5), color: c4('#a8a298') });
  sign(ctx, scene, 'schoolname', 'OAK GROVE MIDDLE SCHOOL', { w: 1024, h: 128, bg: '#1e3a6a', color: '#f4efe4', size: 64 }, 0, 9.6, sz + 4.04, 0, 13, 1.6, false);
  for (const [x, t, i] of [[-24, 'DREAM BIG', 0], [24, 'TEAMWORK', 1]]) {
    const tex = cachedTexture(ctx, 'schoolmural-' + i, () => T.mural(t, { seed: 210 + i, bg: ['#2f8ac8', '#f2a03a'][i], palette: ['#ffe14a', '#ff5a7a', '#5ad87a', '#ffffff', '#7a5aff'] }), {});
    const m = new Mesh(ctx.geometry(G.quad(26, 3.2, { bottom: true })), new Material({ map: tex, roughness: 0.9 }), { castShadow: false }); M.m4fromYaw(m.matrix, x, 0.2, sz + 0.04, 0); scene.add(m);
  }
  // the flagpole, a bike rack, a tetherball pole
  metal.push({ geo: G.cylinder(0.06, 0.1, 11, 8, { y0: true }), matrix: TR(11, 0, sz + 6), color: c4('#d8dde4') });
  { const fm = new Mesh(ctx.geometry(G.quad(2, 1.2)), new Material({ map: cachedTexture(ctx, 'schoolflag', () => T.banner('OAK GROVE', { w: 512, h: 300, bg: '#1e3a6a', color: '#ffe14a', size: 70, stripe: '#ffe14a' }), {}), roughness: 0.9, doubleSided: true, shading: 'cloth' }), { castShadow: false }); M.m4fromYaw(fm.matrix, 12.05, 10.2, sz + 6, 0); scene.add(fm); }
  for (let i = 0; i < 7; i++) metal.push({ geo: G.tube([[-14 + i * 0.7, 0, sz + 5], [-14 + i * 0.7, 0.8, sz + 5], [-14 + i * 0.7, 0.8, sz + 6], [-14 + i * 0.7, 0, sz + 6]], 0.03, 4), color: c4('#9aa0a6') });
  metal.push({ geo: G.cylinder(0.05, 0.05, 3.2, 8, { y0: true }), matrix: TR(22, 0, 24), color: c4('#c9ced6') }, { geo: G.box(0.01, 1.4, 0.01), matrix: TR(22.4, 2.4, 24), color: c4('#eeeeee') });
  matte.push({ geo: G.sphere(0.13, 10, 8), matrix: TR(22.4, 1.65, 24), color: c4('#ffe14a') });
  // the climbing frame with a tube slide, west of the court on its blue pad
  { const px = -28, pz = 20, cols = ['#d8432c', '#f2c230', '#2f6ab8'];
    matte.push({ geo: G.box(14, 0.06, 12), matrix: TR(px, 0.03, pz), color: c4('#2f5a9a') });
    for (const [tx, tz, i] of [[-3, -2, 0], [3, 2, 1]]) {
      for (const [sx, sz2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) metal.push({ geo: G.cylinder(0.08, 0.08, 3.2, 8, { y0: true }), matrix: TR(px + tx + sx * 0.9, 0, pz + tz + sz2 * 0.9), color: c4(cols[i]) });
      matte.push({ geo: G.box(1.9, 0.12, 1.9), matrix: TR(px + tx, 1.6, pz + tz), color: c4(cols[2 - i]) }, { geo: G.cylinder(0.05, 1.5, 1.1, 4, { y0: true }), matrix: TRS(px + tx, 3.2, pz + tz, Math.PI / 4, 1, 1, 1), color: c4(cols[i]) });
    }
    matte.push({ geo: G.box(1.2, 0.1, 6.2), matrix: TRP(px, 1.6, pz, Math.atan2(6, 4), 0), color: c4('#f2c230') });
    for (const sx of [-0.6, 0.6]) metal.push({ geo: G.tube([[px - 3 + sx * 0.4, 2.4, pz - 0.6], [px + 3 + sx * 0.4, 2.4, pz + 0.6]], 0.04, 4), color: c4('#d8432c') });
    const spiral = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 1.6; spiral.push([px + 3 + 0.9 + Math.cos(a) * 1.4, 1.6 - i / 24 * 1.25, pz + 2 + Math.sin(a) * 1.4]); }
    matte.push({ geo: G.tube(spiral, 0.42, 10), color: c4('#2fa86a') });
    for (let s = 0; s < 5; s++) metal.push({ geo: G.box(0.9, 0.05, 0.05), matrix: TR(px - 3, 0.3 * (s + 1), pz - 3), color: c4('#c9ced6') });
  }
  // the yard's fence, the street and the houses across it (north)
  fences(env, [[-32, -34, -32, 32], [32, -34, 32, -6], [32, -2, 32, 32], [-32, 32, -3, 32], [3, 32, 32, 32]], 2.4, '#7a8288');
  matte.push({ geo: G.box(260, 0.04, 9), matrix: TR(0, 0.02, 39), color: c4('#3a3b3e') });
  for (let i = 0; i < 10; i++) {
    const x = -72 + i * 16, z = 52, c = fixed.pick(['#e8dcc4', '#c4d4dc', '#e4c8b8', '#d0dcc0', '#f0e4c8']);
    matte.push({ geo: G.box(10, 5, 8), matrix: TR(x, 2.5, z), color: c4(c) }, { geo: gable(10.8, 8.8, 2.6), matrix: TR(x, 5, z, Math.PI / 2), color: c4(fixed.pick(['#5a3a30', '#3a4048', '#4a3a2a'])) });
    litWindow(env, matte, x - 2.6, 2.4, z - 4.03, Math.PI, 1.6, 1.1, 0.8); litWindow(env, matte, x + 2.6, 2.4, z - 4.03, Math.PI, 1.6, 1.1, 0.8);
    matte.push({ geo: G.box(1.1, 2.1, 0.06), matrix: TR(x, 1.05, z - 4.03), color: c4('#5a3a2a') });
    foliage.push(...PR.tree(x + 8, z - 3, 0.75 + fixed.next() * 0.3, fixed, '#4f7a3a'));
  }
  for (const [x, z] of [[-29, -27], [28, -27], [-28, 29], [16, 29.5], [-16, 29.5]]) foliage.push(...PR.tree(x, z, 0.85 + fixed.next() * 0.2, fixed, '#4f7a3a'));
  // aluminium bleachers on the west side, kids and parents standing on the east and on the school steps
  matte.push(...PR.bleacher(-W2 - 3.4, 0, Math.PI / 2, 18, 5, '#8a939b', '#c8ced4')); bleacherSeats(seats, -W2 - 3.4, 0, Math.PI / 2, 18, 5);
  solids.push({ x0: -W2 - 6.8, x1: -W2 - 3, z0: -9, z1: 9, h: 2.4 });
  standRow(seats, W2 + 3.4, -12, W2 + 3.4, 12, 24); standRow(seats, -W2, -L2 - 3.2, W2, -L2 - 3.2, 14); standRow(seats, -W2, L2 + 3.2, W2, L2 + 3.2, 14);
  sitRow(seats, -4, sz + 5.2, 4, sz + 5.2, 10, 0.64, [0, 0]);
  // the clubhouse: the portable classroom on the east side, on blocks, a ramp and steps up to its door
  const cx = 25.5, cz = 6, cw = 7, cd = 13, ch = 3.2, y0 = 0.7;
  matte.push({ geo: G.box(cw, ch, cd), matrix: TR(cx, y0 + ch / 2, cz), color: c4('#d8cfb8') }, { geo: G.box(cw + 0.3, 0.2, cd + 0.3), matrix: TR(cx, y0 + ch + 0.1, cz), color: c4('#6a6458') }, { geo: G.box(cw - 0.2, y0, cd - 0.2), matrix: TR(cx, y0 / 2, cz), color: c4('#4a4a46') });
  matte.push({ geo: G.box(0.04, 0.3, cd), matrix: TR(cx - cw / 2 - 0.02, y0 + 0.5, cz), color: c4('#2f5a9a') });
  for (const z of [cz - 4.2, cz - 1.2]) litWindow(env, matte, cx - cw / 2 - 0.03, y0 + 1.8, z, -Math.PI / 2, 1.8, 1.1, 0.8);
  const door = clubDoor(matte, glow, cx - cw / 2 - 0.03, cz + 3.8, -Math.PI / 2, { door: '#2f5a9a', frame: '#f4efe4' });
  door.x = cx - cw / 2 - 3.2; door.at.y = y0; // (where you stand: at the foot of its steps)
  matte.push({ geo: G.box(1.6, 0.12, 1.8), matrix: TR(cx - cw / 2 - 0.8, y0 - 0.06, cz + 3.8), color: c4('#8a6a46') });
  for (let s = 0; s < 3; s++) matte.push({ geo: G.box(0.4, 0.08, 1.6), matrix: TR(cx - cw / 2 - 1.8 - s * 0.35, y0 - 0.22 - s * 0.22, cz + 3.8), color: c4('#8a6a46') });
  for (const sz2 of [-0.85, 0.85]) metal.push({ geo: G.tube([[cx - cw / 2 - 0.1, y0 + 0.9, cz + 3.8 + sz2], [cx - cw / 2 - 1.6, y0 + 0.9, cz + 3.8 + sz2], [cx - cw / 2 - 2.8, 0.9, cz + 3.8 + sz2]], 0.03, 4), color: c4('#c9ced6') });
  clubMarquee(env, 'school', 'ROOM 12', cx - cw / 2 + 0.1, y0 + ch + 0.75, cz - 1, -Math.PI / 2, 3.6, '#ffe14a', '#2f5a9a', door);
  bannerQuad(ctx, scene, env.bannerMats.name, cx, y0 + ch + 0.9, cz - cd / 2 - 0.05, Math.PI, 5, 1.25, env.banners);
  solids.push({ x0: cx - cw / 2, x1: cx + cw / 2, z0: cz - cd / 2, z1: cz + cd / 2, h: y0 + ch });
  // the home team's banners: on the fence behind the baselines, the logo on the school's pavilion
  for (const x of [-20, 20]) bannerQuad(ctx, scene, env.bannerMats.name, x, 1.4, 31.95, Math.PI, 5, 1.2, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.logo, -5.5, 6, sz + 4.06, 0, 2.2, 4.4, env.banners); bannerQuad(ctx, scene, env.bannerMats.logo, 5.5, 6, sz + 4.06, 0, 2.2, 4.4, env.banners);
  for (const x of [-30, -15, 15, 30]) glow.push({ geo: G.box(0.7, 0.2, 0.3), matrix: TR(x, 5.4, sz + 0.2), color: [1, 0.9, 0.7, 1] });
  return { bounds: { x0: -24, x1: 24, z0: -30, z1: 28 }, clubhouse: { door, anchor: { x: cx, y: y0, z: cz, yaw: -Math.PI / 2, w: cd - 0.5, d: cw - 0.5 }, style: 'portable' }, lightColor: [1, 0.94, 0.85] };
};

// 9. The Cage: a tight, tall-fenced court on a downtown block: sidewalks round it packed two and three deep, streets on
// all four sides with taxis and traffic, tall brick and stone buildings with shops at their feet, a metro entrance and
// a hot-dog cart on the corners; the clubhouse is the little brick park house on the south-west corner
SCENERY.cage = env => {
  const { ctx, scene, matte, metal, glow, seats, solids, fixed, look, anim } = env;
  const SX = 22, SZ = 26; // the sidewalk round the cage (the streets beyond, the buildings past |x| 34, |z| 38)
  ground(ctx, scene, 'street-cage', () => T.asphalt({ seed: 47 }), 420, 8, '#a29e97', -0.006);
  ground(ctx, scene, 'walk-cage', () => T.concrete({ color: [0.6, 0.59, 0.56], joints: true }), 0, 2.5, '#d4d0c8', -0.003, 0.9, [0, 0, SX * 2, SZ * 2]);
  for (const [x, z, w, d] of [[0, -SZ, SX * 2, 0.3], [0, SZ, SX * 2, 0.3], [-SX, 0, 0.3, SZ * 2], [SX, 0, 0.3, SZ * 2]]) matte.push({ geo: G.box(w, 0.15, d), matrix: TR(x, 0.075, z), color: c4('#9a968e') });
  for (let i = -8; i <= 8; i++) { matte.push({ geo: G.box(0.15, 0.01, 3), matrix: TR(28, 0.006, i * 8), color: c4('#e8c040') }, { geo: G.box(0.15, 0.01, 3), matrix: TR(-28, 0.006, i * 8), color: c4('#e8c040') }, { geo: G.box(3, 0.01, 0.15), matrix: TR(i * 8, 0.006, 32), color: c4('#e8c040') }, { geo: G.box(3, 0.01, 0.15), matrix: TR(i * 8, 0.006, -32), color: c4('#e8c040') }); }
  for (const [x, z, yaw] of [[-SX - 3, -SZ + 2, 0], [SX + 3, SZ - 2, 0], [-SX + 2, SZ + 3, Math.PI / 2], [SX - 2, -SZ - 3, Math.PI / 2]]) for (let i = 0; i < 6; i++) matte.push({ geo: G.box(0.5, 0.01, 4), matrix: TR(x + (yaw ? 0 : (i - 2.5) * 1), 0.007, z + (yaw ? (i - 2.5) * 1 : 0), yaw), color: c4('#e8e4dc') }); // (crosswalks)
  // the buildings: tall, close, brick and stone, shops at their feet facing the streets
  const rows = [], stone = [], FL = 3.4;
  for (let i = 0; i < 7; i++) {
    const z = -60 + i * 20, h1 = fixed.range(6, 20) * FL, h2 = fixed.range(5, 16) * FL;
    (i % 2 ? stone : rows).push({ x: -47, z, w: 26, d: 19.6, h: h1, tint: fixed.pick(TINTS) });
    (i % 2 ? rows : stone).push({ x: 47, z, w: 26, d: 19.6, h: h2, tint: fixed.pick(TINTS) });
  }
  for (let i = 0; i < 4; i++) { const x = -30 + i * 20; ((i % 2) ? rows : stone).push({ x, z: 51, w: 19.6, d: 26, h: fixed.range(8, 22) * FL, tint: fixed.pick(TINTS) }); ((i % 2) ? stone : rows).push({ x, z: -51, w: 19.6, d: 26, h: fixed.range(7, 18) * FL, tint: fixed.pick(TINTS) }); }
  blocks(ctx, scene, rows, 'cagebrick', { wall: '#6e3e30', lit: 0.5, emissive: win(look, 1.25), seed: 103, detail: { bays: 6, floors: 5, kind: 'brick', fireEscape: 0.34 } });
  blocks(ctx, scene, stone, 'cagestone', { wall: '#7a7670', lit: 0.5, emissive: win(look, 1.25), seed: 107, detail: { bays: 6, floors: 5, kind: 'stone' } });
  const shopWords = ['DELI', 'PIZZA', 'LAUNDRY', 'BARBER', 'HARDWARE', 'CAFE', 'SHOES', 'BOOKS', 'FLOWERS', 'BAKERY'];
  const awn = ['#2f5a3a', '#7a1f1c', '#1e3a6a', '#3a3a3a', '#8a5a1e'];
  let si = 0;
  const shopFront = (x, z, yaw) => {
    const at = (dx, dy, dz) => M.m4mul(M.m4(), TR(x, 0, z, yaw), TR(dx, dy, dz));
    glow.push({ geo: G.box(7, 2.4, 0.06), matrix: at(0, 1.5, 0.04), color: look.tod === 'day' ? [0.32, 0.36, 0.4, 1] : [0.95, 0.82, 0.6, 1] });
    matte.push({ geo: G.box(8, 0.12, 1.6), matrix: M.m4mul(M.m4(), at(0, 3.1, 0.8), TRP(0, 0, 0, 0, 0.25)), color: c4(awn[si % awn.length]) });
    sign(ctx, scene, 'cageshop-' + (si % shopWords.length), shopWords[si % shopWords.length], { w: 512, h: 96, bg: '#14161a', color: '#f4efe4', size: 60 }, ...(() => { const m = at(0, 3.75, 0.08); return [m[12], m[13], m[14]]; })(), yaw, 4, 0.75);
    si++;
  };
  for (let i = 0; i < 7; i++) { shopFront(-47 + 13.02, -60 + i * 20, Math.PI / 2); shopFront(47 - 13.02, -60 + i * 20, -Math.PI / 2); }
  for (let i = 0; i < 4; i++) { shopFront(-30 + i * 20, 51 - 13.02, Math.PI); shopFront(-30 + i * 20, -51 + 13.02, 0); }
  // the cage: a tall fence close round the court, gates at two corners; lights on poles at the corners
  const fx = W2 + 2.6, fz = L2 + 2.8;
  fences(env, [[-fx, -fz, fx - 2, -fz], [-fx + 2, fz, fx, fz], [-fx, -fz, -fx, fz - 0], [fx, -fz, fx, fz]], 6.5, '#2e3338');
  floodTowers(metal, glow, [[-fx - 0.6, -fz - 0.6], [fx + 0.6, -fz - 0.6], [-fx - 0.6, fz + 0.6], [fx + 0.6, fz + 0.6]], 9.5, '#2e3338');
  // the crowd, packed against the fence on every side
  for (let r = 0; r < 3; r++) {
    const o = 0.7 + r * 0.7;
    standRow(seats, -fx - o, -fz + 0.5, -fx - o, fz - 0.5, 40); standRow(seats, fx + o, -fz + 0.5, fx + o, fz - 0.5, 40);
    standRow(seats, -fx + 0.5, -fz - o, fx - 0.5, -fz - o, 22); standRow(seats, -fx + 0.5, fz + o, fx - 0.5, fz + o, 22);
  }
  // the street: parked cars and taxis at the kerbs, traffic going by, hydrants, the metro entrance, a hot-dog cart
  const cabRoof = () => [{ geo: G.box(0.7, 0.2, 0.3), matrix: TR(0, 1.5, -0.2), color: c4('#f4efe4') }];
  const parkedAt = [[SX + 1.4, -18], [SX + 1.4, -10], [SX + 1.4, 6], [SX + 1.4, 16], [-SX - 1.4, -14], [-SX - 1.4, 2], [-SX - 1.4, 12]];
  parkedAt.forEach(([x, z], i) => { const taxi = i % 3 === 0, paint = taxi ? '#f2c230' : fixed.pick(['#1e1f22', '#d8d4cc', '#2a4a7a', '#7a1f1c']); for (const p of [...PR.car(paint), ...(taxi ? cabRoof() : [])]) matte.push({ ...p, matrix: M.m4mul(M.m4(), TR(x, 0, z, 0), p.matrix || M.m4()) }); });
  const lanes = [{ axis: 'z', c: 27, dir: 1 }, { axis: 'z', c: -29, dir: -1 }, { axis: 'x', c: 31, dir: -1 }, { axis: 'x', c: -33, dir: 1 }];
  const carGeo = ctx.geometry(G.merge(PR.car('#ffffff'), true)), traffic = [];
  for (let i = 0; i < 10; i++) { const L = lanes[i % 4], taxi = i % 3 === 1, m = new Mesh(carGeo, new Material({ color: lin(taxi ? '#f2c230' : fixed.pick(['#d8d4cc', '#1e1f22', '#7a1f1c', '#2a4a7a', '#5a6066'])), roughness: 0.4, metalness: 0.3 }), { castShadow: false, reflect: false }); scene.add(m); traffic.push({ L, s: fixed.range(-70, 70), v: fixed.range(6, 10), m }); }
  anim.push({ step(dt) { for (const c of traffic) { c.s += c.v * dt * c.L.dir; if (c.s > 70) c.s -= 140; if (c.s < -70) c.s += 140; const yaw = c.L.axis === 'z' ? (c.L.dir > 0 ? 0 : Math.PI) : (c.L.dir > 0 ? Math.PI / 2 : -Math.PI / 2); M.m4fromYaw(c.m.matrix, c.L.axis === 'z' ? c.L.c : c.s, 0, c.L.axis === 'z' ? c.s : c.L.c, yaw); } } });
  // people on the parked cars, a line at the hot-dog cart, a group by the metro, stoops along the side streets
  parkedAt.forEach(([x, z], i) => { if (i % 2 === 0) seats.push({ x: x - Math.sign(x) * 1.0, y: 0.86, z: z + 1.2, yaw: x > 0 ? -Math.PI / 2 : Math.PI / 2 }, { x: x - Math.sign(x) * 1.0, y: 0.86, z: z + 0.5, yaw: x > 0 ? -Math.PI / 2 : Math.PI / 2 }); });
  standRow(seats, 17.5 - 0.3, 20 - 1.4, 17.5 - 0.3, 20 - 4.4, 4, 0, [17.5, 20]); standRow(seats, 13.5, -20.2, 15.2, -19.6, 3, 0, [17, -22.5]);
  for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) {
    const x = -30 + i * 20 + 6.2, fz = sz * (51 - 13), out = -sz;
    for (let st = 0; st < 4; st++) matte.push({ geo: G.box(1.8, 0.18 * (4 - st), 0.42), matrix: TR(x, 0.09 * (4 - st), fz + out * (0.21 + st * 0.42)), color: c4('#8a6a56') });
    for (const dx of [-0.95, 0.95]) metal.push({ geo: G.tube([[x + dx, 1.6, fz], [x + dx, 0.9, fz + out * 1.7]], 0.03, 4), color: c4('#1e1f22') });
    for (let k = 0; k < 3; k++) seats.push({ x: x - 0.6 + k * 0.6, y: 0.18 * (3 - (k % 2)), z: fz + out * (0.21 + (1 + (k % 2)) * 0.42), yaw: sz > 0 ? Math.PI : 0 });
  }
  for (const [x, z] of [[SX - 0.6, -22], [-SX + 0.6, 20], [12, SZ - 0.6]]) { matte.push({ geo: G.cylinder(0.14, 0.16, 0.6, 10, { y0: true }), matrix: TR(x, 0, z), color: c4('#c8302a') }, { geo: G.sphere(0.15, 8, 6), matrix: TR(x, 0.62, z), color: c4('#c8302a') }); }
  { const mx = 17, mz = -22.5;
    matte.push({ geo: G.box(2.4, 0.02, 4.4), matrix: TR(mx, 0.01, mz), color: c4('#141414') });
    for (const [a, b] of [[[mx - 1.3, -2.3], [mx - 1.3, 2.3]], [[mx + 1.3, -2.3], [mx + 1.3, 2.3]], [[mx - 1.3, -2.3], [mx + 1.3, -2.3]]]) metal.push({ geo: G.tube([[a[0], 1, mz + a[1]], [b[0], 1, mz + b[1]]], 0.04, 5), color: c4('#2f5a3a') });
    for (const sx of [-1.3, 1.3]) { metal.push({ geo: G.cylinder(0.05, 0.06, 2.6, 8, { y0: true }), matrix: TR(mx + sx, 0, mz + 2.3), color: c4('#2f5a3a') }); glow.push({ geo: G.sphere(0.22, 10, 8), matrix: TR(mx + sx, 2.8, mz + 2.3), color: [0.5, 1.2, 0.6, 1] }); }
    sign(ctx, scene, 'cagemetro', 'METRO', { w: 256, h: 96, bg: '#14161a', color: '#f4efe4', size: 56 }, mx, 1.35, mz + 2.33, 0, 1.4, 0.5);
    solids.push({ x0: mx - 1.4, x1: mx + 1.4, z0: mz - 2.4, z1: mz + 2.4, h: 1.1 });
    const hx = 17.5, hz = 20;
    matte.push({ geo: G.box(1.8, 0.9, 1), matrix: TR(hx, 0.75, hz), color: c4('#c9ced6') }, { geo: G.cylinder(0.02, 1.4, 0.5, 10, { y0: true }), matrix: TR(hx, 2.3, hz), color: c4('#e8513a') });
    metal.push({ geo: G.cylinder(0.03, 0.03, 2.3, 6, { y0: true }), matrix: TR(hx, 0, hz), color: c4('#9aa0a6') });
    for (const sx of [-0.6, 0.6]) matte.push({ geo: G.cylinder(0.28, 0.28, 0.1, 10), matrix: TRP(hx + sx, 0.28, hz + 0.52, 0, Math.PI / 2), color: c4('#1a1a1a') });
    solids.push({ x0: hx - 1, x1: hx + 1, z0: hz - 0.6, z1: hz + 0.6, h: 1.2 });
  }
  for (const [x, z] of [[-SX + 1, -SZ + 1], [SX - 1, SZ - 1], [SX - 1, -SZ + 6], [-SX + 1, SZ - 1]]) metal.push(...PR.streetLamp(x, z, 6, '#1e2226'));
  for (const [x, z] of [[-SX + 0.8, 8], [SX - 0.8, -4]]) matte.push(...PR.trashCan(x, z, '#2a3a2e'));
  // the clubhouse: the park house on the south-west corner: brick, a hipped slate roof, a lamp over the door
  const cx = -18.5, cz = -21.5, cw = 7, cd = 5, ch = 3.8;
  const br = new Material({ map: cachedTexture(ctx, 'pg-brick4', () => T.brick({ color: [0.5, 0.27, 0.19], seed: 41 }).color, { aniso: 8 }), roughness: 0.9 });
  shell(ctx, scene, br, cx, cz, cw, ch, cd, 0, 2, 2);
  matte.push({ geo: G.box(cw + 0.4, 0.3, cd + 0.4), matrix: TR(cx, ch + 0.15, cz), color: c4('#c9c2b0') }, { geo: G.cylinder(0.03, 1, 1, 4, { y0: true }), matrix: TRS(cx, ch + 0.3, cz, Math.PI / 4, cw * 0.74, 1.8, cd * 0.74), color: c4('#3a4048') });
  litWindow(env, matte, cx - 1.8, 2.2, cz + cd / 2 + 0.03, 0, 1.4, 1.1, 0.8);
  const door = clubDoor(matte, glow, cx + 1.2, cz + cd / 2 + 0.03, 0, { door: '#2f4a3a', frame: '#c9c2b0' });
  glow.push({ geo: G.sphere(0.16, 8, 6), matrix: TR(cx + 1.2, 3.0, cz + cd / 2 + 0.3), color: [1, 0.86, 0.6, 1] });
  clubMarquee(env, 'cage', 'PARK HOUSE', cx - 1.5, 3.32, cz + cd / 2 + 0.14, 0, 2.9, '#f4efe4', '#2f4a3a', door);
  solids.push({ x0: cx - cw / 2, x1: cx + cw / 2, z0: cz - cd / 2, z1: cz + cd / 2, h: ch });
  // the home team's banners: on the cage, and big down the buildings over the streets
  for (const z of [-8, 8]) bannerQuad(ctx, scene, env.bannerMats.name, fx + 0.05, 2.2, z, -Math.PI / 2, 5.2, 1.3, env.banners); // (east fence only: the game cameras look through the others)
  bannerQuad(ctx, scene, env.bannerMats.logo, -10, 22, 51 - 13.1, Math.PI, 6, 12, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.logo, 47 - 13.1, 20, 0, -Math.PI / 2, 6, 12, env.banners);
  if (look.tod !== 'day') env.lights.push({ pos: [0, 7, -SZ - 4], range: 26, color: [1, 0.82, 0.55], intensity: 7, dir: null });
  return { bounds: { x0: -SX + 1, x1: SX - 1, z0: -SZ + 1, z1: SZ - 1 }, clubhouse: { door, anchor: { x: cx, y: 0, z: cz, yaw: 0, w: cw - 0.5, d: cd - 0.5 }, style: 'parkhouse' }, lightColor: [1, 0.92, 0.8] };
};

// 10. Suburban Rec Center: a bright indoor wood court: painted block walls with a coloured band, pads under the
// baskets, fluorescent strips under the joists, clerestory windows, a stage with its curtains at one end, a scoreboard,
// a community bulletin board and a trophy case, pull-out bleachers and folding chairs, vending machines; the clubhouse
// is the community room in the south-west corner
SCENERY.rec = env => {
  const { ctx, scene, matte, metal, glow, seats, solids, fixed, look } = env;
  const W = W2 + 12.5, L = L2 + 15, H = 9.6; // (a lower ceiling than a big gym's: still a metre over the 2K camera)
  ground(ctx, scene, 'rec-floor', () => T.hardwood({ seed: 5 }), 0, 4, '#e8c898', -0.004, 0.45, [0, 0, W * 2, L * 2]);
  const blockTex = cachedTexture(ctx, 'pg-recblock', () => T.concrete({ color: [0.86, 0.84, 0.78], joints: true }).color, { aniso: 8 });
  const walls = [];
  for (const [x, z, w, yaw] of [[0, -L, W * 2, 0], [0, L, W * 2, Math.PI], [-W, 0, L * 2, Math.PI / 2], [W, 0, L * 2, -Math.PI / 2]]) walls.push({ geo: texQuad(w, H, 2.4, 2.4, { bottom: true }), matrix: TR(x, 0, z, yaw) });
  scene.add(new Mesh(ctx.geometry(G.merge(walls, false)), new Material({ map: blockTex, roughness: 0.85, color: [1.05, 1.03, 0.98] }), { castShadow: false }));
  for (const [x, z, w, d] of [[0, -L + 0.06, W * 2, 0.12], [0, L - 0.06, W * 2, 0.12], [-W + 0.06, 0, 0.12, L * 2], [W - 0.06, 0, 0.12, L * 2]]) matte.push({ geo: G.box(w, 1.3, d), matrix: TR(x, 0.65, z), color: c4('#2f7a8a') }, { geo: G.box(w, 0.18, d), matrix: TR(x, 3.1, z), color: c4('#e8822a') });
  // the drop ceiling (acoustic tiles in their grid), its fluorescent panels
  const tiles = cachedTexture(ctx, 'rectiles', () => { const c = T.canvas(256, 256), g = c.getContext('2d'); g.fillStyle = '#e8e6e0'; g.fillRect(0, 0, 256, 256); const rq = new RNG(3); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(120,115,105,${rq.range(0.05, 0.18)})`; g.fillRect(rq.next() * 256, rq.next() * 256, 2, 2); } g.fillStyle = '#b8bcc0'; g.fillRect(0, 0, 256, 6); g.fillRect(0, 0, 6, 256); g.fillRect(0, 125, 256, 6); g.fillRect(125, 0, 6, 256); return c; }, {});
  const cg = G.plane(W * 2, L * 2); for (let i = 0; i < cg.uv.length; i += 2) { cg.uv[i] *= W * 2 / 1.2; cg.uv[i + 1] *= L * 2 / 1.2; }
  const ceil = new Mesh(ctx.geometry(cg), new Material({ map: tiles, roughness: 0.95 }), { castShadow: false, reflect: false });
  M.m4mul(ceil.matrix, M.m4translation(M.m4(), 0, H, 0), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI))); scene.add(ceil);
  for (let x = -16.8; x <= 16.8; x += 4.8) for (let z = -26.4; z <= 26.4; z += 4.8) glow.push({ geo: G.box(1.15, 0.04, 0.55), matrix: TR(x, H - 0.03, z), color: [0.95, 0.97, 1, 1] });
  // clerestory windows down both long walls
  const paneC = look.tod === 'day' ? [0.9, 0.95, 1.05, 1] : look.tod === 'dusk' ? [0.8, 0.52, 0.34, 1] : [0.03, 0.035, 0.06, 1];
  for (const sx of [-1, 1]) for (let z = -24; z <= 24; z += 4) { glow.push({ geo: G.box(0.04, 1.3, 3.2), matrix: TR(sx * (W - 0.04), 8.2, z), color: paneC }); metal.push({ geo: G.box(0.08, 1.45, 0.08), matrix: TR(sx * (W - 0.07), 8.2, z + 1.65), color: c4('#4a4f55') }); }
  // pads under the baskets, the scoreboard, a clock
  for (const z of [-L + 0.12, L - 0.12]) matte.push({ geo: G.box(10, 2.2, 0.16), matrix: TR(0, 1.1, z), color: c4('#2f4a8a') });
  { const sb = new Mesh(ctx.geometry(G.quad(7, 1.4)), new Material({ map: cachedTexture(ctx, 'recscore', () => T.ledBoard('HOME 00   GUEST 00', '#ff4a2a', '#ffe45c'), {}), shading: 'unlit', color: [1.2, 1.2, 1.2] }), { castShadow: false });
    M.m4fromYaw(sb.matrix, 0, 6.6, -L + 0.2, 0); scene.add(sb); matte.push({ geo: G.box(7.6, 1.9, 0.3), matrix: TR(0, 6.6, -L + 0.05), color: c4('#14161a') }); }
  matte.push({ geo: G.cylinder(0.45, 0.45, 0.1, 20), matrix: TRP(W - 0.06, 6.2, 8, Math.PI / 2, Math.PI / 2), color: c4('#f4f4f0') }, { geo: G.box(0.05, 0.36, 0.04), matrix: TR(W - 0.13, 6.32, 8), color: c4('#14161a') }, { geo: G.box(0.05, 0.04, 0.26), matrix: TR(W - 0.13, 6.2, 8.1), color: c4('#14161a') });
  // the stage at the north end, its curtains and valance
  matte.push({ geo: G.box(14, 1.0, 3.4), matrix: TR(0, 0.5, L - 1.7), color: c4('#6a4a30') }, { geo: G.box(14.4, 0.06, 3.6), matrix: TR(0, 1.03, L - 1.7), color: c4('#8a6a46') });
  for (let i = 0; i < 12; i++) matte.push({ geo: G.box(1.25, 5.4, 0.12), matrix: TR(-6.9 + i * 1.25, 3.7, L - 0.12 - (i % 2) * 0.12), color: c4(i % 2 ? '#8a1e24' : '#7a1a20') });
  matte.push({ geo: G.box(15, 0.9, 0.2), matrix: TR(0, 6.6, L - 0.3), color: c4('#6a141a') });
  solids.push({ x0: -7, x1: 7, z0: L - 3.4, z1: L, h: 1 });
  sitRow(seats, -6, L - 3.2, 6, L - 3.2, 14, 1.0);
  // the community bulletin board and the trophy case (west wall), vending machines and a fountain (east)
  { const bb = cachedTexture(ctx, 'recboard', () => {
      const c = T.canvas(1024, 576), g = c.getContext('2d'), rr = new RNG(19);
      g.fillStyle = '#b08458'; g.fillRect(0, 0, 1024, 576);
      for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rr.next() < 0.5 ? '90,60,30' : '210,170,120'},0.25)`; g.fillRect(rr.next() * 1024, rr.next() * 576, 2, 2); }
      g.strokeStyle = '#6a4a2a'; g.lineWidth = 22; g.strokeRect(0, 0, 1024, 576);
      const notes = [['YOUTH LEAGUE', 'SIGN-UPS OPEN'], ['BAKE SALE', 'SATURDAY 10AM'], ['PICKUP GAMES', 'MON · WED · 6PM'], ['LOST:', 'BLUE WATER BOTTLE'], ['SUMMER CAMP', 'ASK AT THE DESK'], ['YOGA', 'TUE · THU 9AM'], ['VOLUNTEERS', 'NEEDED!'], ['SWIM LESSONS', 'ALL AGES'], ['GARAGE SALE', 'MAPLE ST'], ['TUTORING', 'FREE · ROOM B']];
      notes.forEach(([a, b], i) => {
        const x = 50 + (i % 5) * 190 + rr.range(-10, 10), y = 50 + Math.floor(i / 5) * 250 + rr.range(-10, 10), w = 160, h = 200;
        g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(rr.range(-0.08, 0.08));
        g.fillStyle = rr.pick(['#fdfbf2', '#fff3a8', '#cfe8ff', '#ffd6e0', '#d8f5c8']); g.fillRect(-w / 2, -h / 2, w, h);
        g.fillStyle = '#2a2a2a'; g.textAlign = 'center'; g.font = 'bold 22px sans-serif'; g.fillText(a, 0, -50); g.font = '17px sans-serif'; g.fillText(b, 0, -16);
        g.fillStyle = 'rgba(40,40,40,0.35)'; for (let k = 0; k < 4; k++) g.fillRect(-55, 14 + k * 18, 110 - rr.range(0, 40), 5);
        g.fillStyle = rr.pick(['#d8302a', '#2a6ad8', '#2a9a4a', '#e8a82a']); g.beginPath(); g.arc(0, -h / 2 + 12, 9, 0, Math.PI * 2); g.fill(); g.restore();
      });
      return c;
    }, {});
    const m = new Mesh(ctx.geometry(G.quad(5, 2.8)), new Material({ map: bb, roughness: 0.9 }), { castShadow: false }); M.m4fromYaw(m.matrix, W - 0.08, 3.5, 16.5, -Math.PI / 2); scene.add(m); // (the east wall: across the court from the broadcast camera, over the bleachers' end)
    sign(ctx, scene, 'recboardtitle', 'COMMUNITY BOARD', { w: 512, h: 80, bg: '#2f7a8a', color: '#f4f4f0', size: 44 }, W - 0.09, 5.25, 16.5, -Math.PI / 2, 3.4, 0.53, false); }
  { const tx = W - 0.5, tz = 22.4;
    matte.push({ geo: G.box(0.9, 0.9, 5), matrix: TR(tx, 0.45, tz), color: c4('#6a4a30') }, { geo: G.box(0.9, 0.12, 5), matrix: TR(tx, 2.95, tz), color: c4('#6a4a30') });
    for (const y of [1.4, 2.1]) metal.push({ geo: G.box(0.7, 0.03, 4.8), matrix: TR(tx, y, tz), color: c4('#d8dde4') });
    for (let i = 0; i < 9; i++) { const y = i < 5 ? 0.9 : i < 7 ? 1.43 : 2.13, z = tz - 2 + (i < 5 ? i : i < 7 ? (i - 5) * 2 + 1 : (i - 7) * 2 + 1.2); matte.push({ geo: G.cylinder(0.08, 0.12, 0.12, 8, { y0: true }), matrix: TR(tx, y, z), color: c4('#3a2a1a') }, { geo: G.cylinder(0.07, 0.03, 0.3, 8, { y0: true }), matrix: TR(tx, y + 0.12, z), color: c4('#e8c15a') }, { geo: G.sphere(0.09, 8, 6), matrix: TR(tx, y + 0.5, z), color: c4('#e8c15a') }); }
    glow.push({ geo: G.box(0.02, 2, 5), matrix: TR(tx - 0.46, 1.95, tz), color: [0.16, 0.18, 0.2, 1] }); }
  for (let i = 0; i < 2; i++) { const z = -18 + i * 1.3; matte.push({ geo: G.box(0.8, 1.9, 1.1), matrix: TR(W - 0.5, 0.95, z), color: c4(['#c8302a', '#2f5a9a'][i]) }); glow.push({ geo: G.box(0.03, 1.2, 0.8), matrix: TR(W - 0.91, 1.15, z), color: [0.9, 0.95, 1, 1] }); }
  matte.push({ geo: G.box(0.5, 0.9, 0.6), matrix: TR(W - 0.3, 0.45, -14), color: c4('#c9ced6') });
  // seats: pull-out bleachers on the east, folding chairs on the west, people standing at the south end
  matte.push(...PR.bleacher(W2 + 3.2, 0, -Math.PI / 2, 22, 6, '#6a5a48', '#d8b07a')); bleacherSeats(seats, W2 + 3.2, 0, -Math.PI / 2, 22, 6);
  solids.push({ x0: W2 + 2.8, x1: W2 + 7, z0: -11, z1: 11, h: 3 });
  for (const dx of [3, 3.9]) for (let i = 0; i < 14; i++) { const x = -W2 - dx, z = -9.5 + i * 1.45; metal.push({ geo: G.box(0.44, 0.04, 0.44), matrix: TR(x, 0.45, z), color: c4('#3a3f47') }, { geo: G.box(0.44, 0.4, 0.04), matrix: TR(x - 0.2, 0.67, z), color: c4('#3a3f47') }); seats.push({ x, y: 0.42, z, yaw: Math.PI / 2 }); }
  standRow(seats, -4, -L + 1.4, W - 3, -L + 1.4, 14);
  // the community touches: the centre's name painted up the east wall, fold-up practice hoops on it, a banner over the
  // stage, volleyball lines across the floor, a ping-pong and a foosball table in the south-east corner
  sign(ctx, scene, 'recname', 'MAPLEWOOD COMMUNITY CENTER', { w: 1536, h: 160, bg: '#e8e2d4', color: '#2f7a8a', size: 92, stripe: '#e8822a' }, W - 0.07, 6.6, -2, -Math.PI / 2, 15, 1.56, false);
  for (const z of [-24, 9.5]) { const y = 3.05; matte.push({ geo: G.box(0.06, 1.0, 1.7), matrix: TR(W - 0.95, y + 0.45, z), color: c4('#f4f4f0') }, { geo: G.box(0.05, 0.45, 0.55), matrix: TR(W - 0.92, y + 0.3, z), color: c4('#e8822a') }); metal.push({ geo: G.box(0.9, 0.06, 0.06), matrix: TR(W - 0.5, y + 0.2, z - 0.6), color: c4('#3a3f44') }, { geo: G.box(0.9, 0.06, 0.06), matrix: TR(W - 0.5, y + 0.2, z + 0.6), color: c4('#3a3f44') }, { geo: G.torus(0.23, 0.015, 16, 4), matrix: TR(W - 1.2, y, z), color: c4('#e8501c') }); }
  sign(ctx, scene, 'recstage', 'TALENT SHOW · FRIDAY 7PM', { w: 1024, h: 140, bg: '#f2c14e', color: '#6a141a', size: 72 }, 0, 7.6, L - 0.25, Math.PI, 8.6, 1.15, false);
  for (const [x0, z0, x1, z1] of [[-9, -4.5, 9, -4.5], [-9, 4.5, 9, 4.5], [-9, -4.5, -9, 4.5], [9, -4.5, 9, 4.5], [0, -4.5, 0, 4.5]]) matte.push({ geo: G.plane(Math.abs(x1 - x0) + 0.06, Math.abs(z1 - z0) + 0.06), matrix: TR((x0 + x1) / 2, 0.006, (z0 + z1) / 2, Math.PI / 2), color: c4('#e8c040') });
  { const px = 14.5, pz = -25.5;
    matte.push({ geo: G.box(1.525, 0.05, 2.74), matrix: TR(px, 0.76, pz), color: c4('#1e5a3a') }, { geo: G.box(1.6, 0.15, 0.02), matrix: TR(px, 0.86, pz), color: c4('#f4f4f0') });
    for (const [dx, dz] of [[-0.6, -1.1], [0.6, -1.1], [-0.6, 1.1], [0.6, 1.1]]) metal.push({ geo: G.box(0.05, 0.74, 0.05), matrix: TR(px + dx, 0.37, pz + dz), color: c4('#3a3f44') });
    matte.push({ geo: G.box(0.75, 0.9, 1.3), matrix: TR(px - 4, 0.45, pz + 0.5), color: c4('#6a4a30') }, { geo: G.box(0.7, 0.02, 1.2), matrix: TR(px - 4, 0.91, pz + 0.5), color: c4('#2f8a4a') });
    for (let i = 0; i < 4; i++) metal.push({ geo: G.cylinder(0.015, 0.015, 1.5, 5), matrix: TRP(px - 4, 0.95, pz + 0.05 + i * 0.3, Math.PI / 2, Math.PI / 2), color: c4('#c9ced6') });
    standRow(seats, px - 1.4, pz - 1.6, px + 1.4, pz - 1.6, 2, 0, [px, pz]); standRow(seats, px - 0.4, pz + 2, px + 0.4, pz + 2, 1, 0, [px, pz]); standRow(seats, px - 4.6, pz + 0.5, px - 4.6, pz + 0.6, 1, 0, [px - 4, pz + 0.5]); }
  // the clubhouse: the community room in the south-west corner: a glass front onto the gym, a door, its sign
  const ox = -W + 5, oz = -L + 3.2, ow = 9, od = 6.2, oh = 3.4;
  matte.push({ geo: G.box(ow, oh, od), matrix: TR(ox, oh / 2, oz), color: c4('#d8d0c0') }, { geo: G.box(ow + 0.3, 0.2, od + 0.3), matrix: TR(ox, oh + 0.1, oz), color: c4('#2f7a8a') });
  glow.push({ geo: G.box(5.4, 1.6, 0.06), matrix: TR(ox - 1.4, 1.9, oz + od / 2 + 0.02), color: [0.95, 0.92, 0.82, 1] });
  for (let i = 0; i <= 4; i++) metal.push({ geo: G.box(0.06, 1.6, 0.08), matrix: TR(ox - 4.1 + i * 1.35, 1.9, oz + od / 2 + 0.05), color: c4('#c9ced6') });
  const door = clubDoor(matte, glow, ox + 3, oz + od / 2 + 0.02, 0, { door: '#2f5a9a', frame: '#c9ced6' });
  clubMarquee(env, 'rec', 'COMMUNITY ROOM', ox, oh + 0.62, oz + od / 2 - 0.05, 0, 3.6, '#f4f4f0', '#2f7a8a', null);
  solids.push({ x0: ox - ow / 2, x1: ox + ow / 2, z0: oz - od / 2, z1: oz + od / 2, h: oh });
  // the home team: banners over the pads, the logo on the long walls
  for (const z of [-L + 0.1, L - 0.1]) bannerQuad(ctx, scene, env.bannerMats.name, z < 0 ? 10 : -10, 5, z, z < 0 ? 0 : Math.PI, 6.4, 1.6, env.banners);
  for (const sx of [-1, 1]) bannerQuad(ctx, scene, env.bannerMats.logo, sx * (W - 0.1), 4.6, sx < 0 ? 16 : -13, sx < 0 ? Math.PI / 2 : -Math.PI / 2, 1.8, 3.6, env.banners);
  env.lights.push({ pos: [-7, H - 1, -9], range: 26, color: [0.96, 0.98, 1], intensity: 12, dir: null }, { pos: [7, H - 1, 9], range: 26, color: [0.96, 0.98, 1], intensity: 12, dir: null }, { pos: [7, H - 1, -9], range: 22, color: [0.96, 0.98, 1], intensity: 9, dir: null }, { pos: [-7, H - 1, 9], range: 22, color: [0.96, 0.98, 1], intensity: 9, dir: null });
  return { bounds: { x0: -W + 1, x1: W - 1, z0: -L + 1, z1: L - 1 }, clubhouse: { door, anchor: { x: ox, y: 0, z: oz, yaw: 0, w: ow - 0.5, d: od - 0.5 }, style: 'community room' }, floodlit: false };
};

// 11. Desert Dusk: a slab court out on red sand under the mountains: ranges and mesas in the haze all round, saguaros
// and boulders, an old windmill and its tank, string lights over the court, hay bales and lawn chairs, cars pulled up to
// watch; the clubhouse is the adobe ranch house with a shade porch on the east side
SCENERY.desert = env => {
  const { ctx, scene, matte, metal, foliage, glow, seats, solids, fixed, look, anim } = env;
  ground(ctx, scene, 'sand-desert', () => T.sand({ meters: 14, seed: 93, color: [0.78, 0.5, 0.33] }), 1200, 14, '#f0b088', -0.006, 0.95);
  ground(ctx, scene, 'conc-desert', () => T.concrete({ color: [0.62, 0.55, 0.48] }), 0, 4, '#d8c4b0', -0.003, 0.9, [0, 0, 26, 40]);
  // the mountains: ranges of low-poly peaks far out, nearer mesas with flat tops
  const far = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + fixed.range(-0.08, 0.08), d = fixed.range(330, 520), sx = fixed.range(60, 140), sy = fixed.range(45, 120) * (Math.cos(a) > 0.3 ? 1.3 : 1);
    far.push({ geo: G.cylinder(fixed.range(0.04, 0.16), 1, 1, 7, { y0: true }), matrix: TRS(Math.sin(a) * d, -2, Math.cos(a) * d, fixed.range(0, 6), sx, sy, fixed.range(50, 120)), color: c4(fixed.pick(['#7a4a44', '#6a4452', '#5e4256', '#80503e'])) });
  }
  for (let i = 0; i < 6; i++) {
    const a = fixed.range(0, Math.PI * 2), d = fixed.range(170, 250), r = fixed.range(22, 40), h = fixed.range(22, 42);
    far.push({ geo: G.cylinder(0.82, 1, 1, 8, { y0: true }), matrix: TRS(Math.sin(a) * d, -1, Math.cos(a) * d, fixed.range(0, 6), r, h, r * fixed.range(0.6, 1)), color: c4('#9a5038') });
    far.push({ geo: G.cylinder(0.84, 0.86, 1, 8, { y0: true }), matrix: TRS(Math.sin(a) * d, -1 + h * 0.62, Math.cos(a) * d, 0, r * 0.87, h * 0.12, r * 0.87 * fixed.range(0.6, 1)), color: c4('#c87850') });
  }
  scene.add(new Mesh(ctx.geometry(G.merge(far)), new Material({ color: [1, 1, 1], roughness: 0.95 }), { castShadow: false, reflect: false }));
  // saguaros, boulders and scrub (out of the game cameras' way)
  const clear = (x, z, r = 3) => !(Math.abs(x) < 18 + r && Math.abs(z) < 34 + r) && Math.hypot(x - 26, z - 8) > 12 && Math.hypot(x + 36, z - 30) > 9;
  const cactus = '#4f6e3a';
  for (let i = 0, n = 0; i < 140 && n < 30; i++) {
    const a = fixed.range(0, Math.PI * 2), d = fixed.range(22, 110), x = Math.sin(a) * d, z = Math.cos(a) * d;
    if (!clear(x, z)) continue;
    n++;
    const h = fixed.range(3.5, 7.5), r = 0.3 + h * 0.02;
    foliage.push({ geo: G.cylinder(r * 0.92, r, h, 10, { y0: true }), matrix: TR(x, 0, z), color: c4(cactus) }, { geo: G.sphere(r * 0.92, 10, 6, { hemi: true }), matrix: TR(x, h, z), color: c4(cactus) });
    const arms = fixed.int(0, 3);
    for (let k = 0; k < arms; k++) {
      const ay = h * fixed.range(0.35, 0.6), aa = fixed.range(0, Math.PI * 2), out = fixed.range(0.7, 1.1), up = fixed.range(1.0, 2.0), ux = Math.sin(aa), uz = Math.cos(aa);
      foliage.push({ geo: G.tube([[x + ux * r * 0.6, ay, z + uz * r * 0.6], [x + ux * out, ay + 0.15, z + uz * out], [x + ux * out, ay + 0.6, z + uz * out], [x + ux * out, ay + up, z + uz * out]], r * 0.7, 8), color: c4(cactus) }, { geo: G.sphere(r * 0.7, 8, 6), matrix: TR(x + ux * out, ay + up, z + uz * out), color: c4(cactus) });
    }
  }
  for (let i = 0, n = 0; i < 160 && n < 46; i++) { const a = fixed.range(0, Math.PI * 2), d = fixed.range(20, 90), x = Math.sin(a) * d, z = Math.cos(a) * d; if (!clear(x, z, 0)) continue; n++; if (n % 3) rock(matte, x, z, fixed.range(0.5, 2.2), fixed.pick(['#8a5a40', '#7a4a34', '#9a6a4a']), fixed); else matte.push({ geo: G.sphere(1, 7, 5), matrix: TRS(x, 0.3, z, 0, fixed.range(0.5, 1), fixed.range(0.35, 0.6), fixed.range(0.5, 1)), color: c4(fixed.pick(['#7a7a4a', '#8a8a5a', '#6a6a3e'])) }); }
  // the windmill and its tank, north-west
  { const wx = -36, wz = 30, top = 11.5;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) metal.push({ geo: G.tube([[wx + sx * 1.7, 0, wz + sz * 1.7], [wx + sx * 0.35, top, wz + sz * 0.35]], 0.07, 4), color: c4('#5a5a58') });
    for (let y = 2; y < top; y += 2.4) { const s = 1.7 - (y / top) * 1.35; for (const [a, b] of [[[-s, -s], [s, -s]], [[s, -s], [s, s]], [[s, s], [-s, s]], [[-s, s], [-s, -s]]]) metal.push({ geo: G.tube([[wx + a[0], y, wz + a[1]], [wx + b[0], y, wz + b[1]]], 0.035, 3), color: c4('#5a5a58') }); }
    metal.push({ geo: G.box(0.5, 0.4, 2.2), matrix: TR(wx, top + 0.3, wz + 0.3), color: c4('#4a4a48') }, { geo: G.box(0.04, 1.2, 1.8), matrix: TR(wx, top + 0.4, wz + 1.9), color: c4('#8a8a86') });
    const blades = [];
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; blades.push({ geo: G.box(0.32, 1.7, 0.03), matrix: M.m4mul(M.m4(), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, a), [1, 1, 1]), TRP(0, 1.25, 0, 0, 0.3)), color: c4('#9a9a96') }); }
    blades.push({ geo: G.cylinder(0.18, 0.18, 0.3, 10), matrix: TRP(0, 0, 0, 0, Math.PI / 2), color: c4('#4a4a48') });
    const fan = new Mesh(ctx.geometry(G.merge(blades)), new Material({ color: [1, 1, 1], roughness: 0.5, metalness: 0.5 }), { castShadow: false });
    scene.add(fan);
    let spin = 0;
    anim.push({ step(dt) { spin += dt * 1.6; M.m4mul(fan.matrix, TR(wx, top + 0.3, wz - 0.9), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, spin), [1, 1, 1])); } });
    matte.push({ geo: G.cylinder(2.8, 2.8, 2.4, 18, { y0: true }), matrix: TR(wx + 5.5, 0, wz + 3), color: c4('#8a8e90') }, { geo: G.cylinder(2.85, 2.85, 0.1, 18, { y0: true }), matrix: TR(wx + 5.5, 2.4, wz + 3), color: c4('#6a6e70') });
    solids.push({ x0: wx - 2, x1: wx + 8.5, z0: wz - 2, z1: wz + 6, h: 3 });
  }
  // string lights over the court on timber posts
  stringLights(env, [[-W2 - 2.8, -L2 - 2.8], [W2 + 2.8, -L2 - 2.8], [W2 + 2.8, L2 + 2.8], [-W2 - 2.8, L2 + 2.8]], 7, 1.2, ['#ffcf7a', '#ffa64a', '#fff0c0'], true, '#6a4a30');
  // the crowd: hay bales on the west, lawn chairs on the east, cars pulled up behind them
  for (let i = 0; i < 9; i++) { const z = -12 + i * 3; for (const dx of [3, 4.4]) { const x = -W2 - dx; matte.push({ geo: G.box(1.0, 0.55, 2.4), matrix: TR(x, 0.275, z), color: c4(i % 2 ? '#c8a050' : '#d4ac5c') }); sitRow(seats, x, z - 0.8, x, z + 0.8, 3, 0.55); } }
  solids.push({ x0: -W2 - 5, x1: -W2 - 2.5, z0: -13.4, z1: 13.4, h: 0.6 });
  for (let i = 0; i < 12; i++) { const z = -11 + i * 2, x = W2 + 3.2 + (i % 2) * 0.6, c = fixed.pick(['#2fb8b0', '#e8513a', '#f2c230', '#5a8ac8']); matte.push({ geo: G.box(0.55, 0.05, 0.55), matrix: TR(x, 0.38, z), color: c4(c) }, { geo: G.box(0.55, 0.6, 0.05), matrix: TR(x + 0.26, 0.66, z, Math.PI / 2), color: c4(c) }); seats.push({ x, y: 0.36, z, yaw: -Math.PI / 2 }); }
  for (let i = 0; i < 4; i++) { const z = -15 + i * 9; for (const p of PR.car(fixed.pick(['#8a2f1e', '#d8d4cc', '#2a4a5a', '#5a4a3a', '#c8a050']))) matte.push({ ...p, matrix: M.m4mul(M.m4(), TR(W2 + 10.5, 0, z, Math.PI / 2 + fixed.range(-0.3, 0.3)), p.matrix || M.m4()) }); solids.push({ x0: W2 + 8, x1: W2 + 13, z0: z - 1.4, z1: z + 1.4, h: 1.5 }); standRow(seats, W2 + 7.8, z - 1.2, W2 + 7.8, z + 1.2, 2); }
  standRow(seats, -W2, -L2 - 4, W2, -L2 - 4, 14); standRow(seats, -W2, L2 + 4, W2, L2 + 4, 14);
  // the clubhouse: the adobe ranch house, vigas out of its walls, a shade porch (a ramada) in front of the door
  const cx = 26, cz = 8, cw = 8, cd = 11, ch = 3.8;
  const adobe = new Material({ map: cachedTexture(ctx, 'pg-adobe', () => T.plaster({ seed: 7 }), { aniso: 8 }), color: lin('#d89466'), roughness: 0.95 });
  shell(ctx, scene, adobe, cx, cz, cw, ch, cd, 0, 3, 3);
  for (const [dx, dz, w, d] of [[0, -cd / 2 + 0.2, cw, 0.4], [0, cd / 2 - 0.2, cw, 0.4], [-cw / 2 + 0.2, 0, 0.4, cd], [cw / 2 - 0.2, 0, 0.4, cd]]) matte.push({ geo: G.box(w, 0.5, d), matrix: TR(cx + dx, ch + 0.25, cz + dz), color: c4('#c8845a') });
  for (let i = 0; i < 7; i++) matte.push({ geo: G.cylinder(0.12, 0.12, 0.9, 8), matrix: TRP(cx - cw / 2 - 0.2, ch - 0.35, cz - cd / 2 + 0.9 + i * 1.55, Math.PI / 2, Math.PI / 2), color: c4('#5a3a22') });
  for (const z of [cz - 3.4, cz + 3.6]) { litWindow(env, matte, cx - cw / 2 - 0.03, 1.9, z, -Math.PI / 2, 1.1, 1.1, 0.8); matte.push({ geo: G.box(0.06, 1.3, 1.3), matrix: TR(cx - cw / 2 - 0.05, 1.9, z), color: c4('#2f6a9a') }); }
  const door = clubDoor(matte, glow, cx - cw / 2 - 0.03, cz, -Math.PI / 2, { door: '#6a3a1e', frame: '#2f6a9a' });
  for (const [dz, dx] of [[-2.2, -3.4], [2.2, -3.4]]) matte.push({ geo: G.box(0.2, 2.8, 0.2), matrix: TR(cx - cw / 2 + dx, 1.4, cz + dz), color: c4('#6a4a30') });
  matte.push({ geo: G.box(3.6, 0.16, 4.8), matrix: TR(cx - cw / 2 - 1.8, 2.85, cz), color: c4('#6a4a30') });
  for (let i = 0; i < 11; i++) matte.push({ geo: G.box(3.6, 0.08, 0.1), matrix: TR(cx - cw / 2 - 1.8, 2.98, cz - 2.3 + i * 0.46), color: c4('#8a6a46') });
  clubMarquee(env, 'desert', 'RANCH HOUSE', cx - cw / 2 + 0.1, ch + 1.1, cz, -Math.PI / 2, 3.6, '#fbf1dc', '#6a3a1e', door);
  sitRow(seats, cx - cw / 2 - 2.6, cz - 1.8, cx - cw / 2 - 2.6, cz - 0.8, 2, 0.45);
  solids.push({ x0: cx - cw / 2, x1: cx + cw / 2, z0: cz - cd / 2, z1: cz + cd / 2, h: ch });
  // the home team's banners: on the light posts and the ranch house wall
  for (const [x, z] of [[-W2 - 2.8, -L2 - 2.8], [W2 + 2.8, L2 + 2.8]]) bannerQuad(ctx, scene, env.bannerMats.logo, x + Math.sign(x) * 0.25, 4.6, z, Math.PI / 2, 1.3, 2.8, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.name, cx - cw / 2 - 0.06, 2.2, cz - 2.6, -Math.PI / 2, 2.6, 0.65, env.banners);
  for (const z of [-L2 - 2.85, L2 + 2.85]) bannerQuad(ctx, scene, env.bannerMats.name, 0, 0.95, z, z < 0 ? 0 : Math.PI, 5, 1.0, env.banners);
  for (const z of [-L2 - 2.85, L2 + 2.85]) for (const sx of [-2.6, 2.6]) metal.push({ geo: G.cylinder(0.04, 0.04, 1.5, 6, { y0: true }), matrix: TR(sx, 0, z), color: c4('#6a4a30') });
  if (look.tod !== 'day') env.lights.push({ pos: [0, 6.5, 0], range: 30, color: [1, 0.78, 0.5], intensity: 9, dir: null });
  return { bounds: { x0: -22, x1: 21, z0: -28, z1: 28 }, clubhouse: { door, anchor: { x: cx, y: 0, z: cz, yaw: -Math.PI / 2, w: cd - 0.8, d: cw - 0.8 }, style: 'adobe' }, floodlit: look.tod === 'night', lightColor: [1, 0.84, 0.62], lightK: 0.8 };
};

// 12. Night Market: a court in the middle of a night market: food stalls with lit awnings down both sides, lantern
// strings on posts, folding tables, crowds; shophouses all round with their signs lit; the clubhouse is the red
// two-storey shophouse with a lantern-hung balcony on the south-east corner
SCENERY.market = env => {
  const { ctx, scene, matte, metal, glow, seats, solids, fixed, look } = env;
  ground(ctx, scene, 'asph-market', () => T.asphalt({ seed: 31 }), 360, 8, '#a49c94');
  const foods = ['NOODLES', 'DUMPLINGS', 'TACOS', 'SKEWERS', 'BBQ', 'BUBBLE TEA', 'BAO', 'SWEETS', 'FRIED RICE', 'CREPES', 'GRILLED CORN', 'LEMONADE', 'RAMEN', 'WAFFLES', 'SPRING ROLLS', 'ICE CREAM'];
  const awnings = ['#c8302a', '#2f8a6a', '#e8a82a', '#2f5a9a', '#8a2f6a', '#e86a2a'];
  // the stalls: a counter, a back wall, posts, a pitched awning with bulbs along its edge, the sign over it
  let n = 0;
  const stall = (x, z, yaw) => {
    const at = (dx, dy, dz) => M.m4mul(M.m4(), TR(x, 0, z, yaw), TR(dx, dy, dz)), col = awnings[n % awnings.length];
    matte.push({ geo: G.box(4.2, 1.0, 0.9), matrix: at(0, 0.5, 0.7), color: c4(n % 2 ? '#8a6a46' : '#9aa0a6') }, { geo: G.box(4.6, 2.6, 0.1), matrix: at(0, 1.3, -1.2), color: c4('#2a2426') });
    for (const [sx, sz] of [[-2.2, -1.15], [2.2, -1.15], [-2.2, 1.2], [2.2, 1.2]]) metal.push({ geo: G.box(0.08, 2.8, 0.08), matrix: at(sx, 1.4, sz), color: c4('#3a3f44') });
    matte.push({ geo: G.box(4.8, 0.08, 2.8), matrix: M.m4mul(M.m4(), at(0, 2.95, 0.1), TRP(0, 0, 0, 0, 0.16)), color: c4(col) }, { geo: G.box(4.8, 0.32, 0.05), matrix: at(0, 2.6, 1.5), color: c4(col) });
    for (let i = 0; i < 7; i++) glow.push({ geo: G.sphere(0.07, 6, 4), matrix: at(-2.1 + i * 0.7, 2.38, 1.52), color: [1, 0.85, 0.55, 1] });
    glow.push({ geo: G.box(3.6, 0.05, 0.12), matrix: at(0, 2.55, 0.2), color: [1, 0.8, 0.52, 1] });
    for (let i = 0; i < 4; i++) matte.push(fixed.next() < 0.5 ? { geo: G.cylinder(0.22, 0.2, 0.3, 10, { y0: true }), matrix: at(-1.4 + i * 0.95, 1.0, 0.6), color: c4('#b8bcc0') } : { geo: G.box(0.5, 0.12, 0.35), matrix: at(-1.4 + i * 0.95, 1.06, 0.6), color: c4(fixed.pick(['#e8c15a', '#c8302a', '#f4efe4', '#5a8a3a'])) });
    const sm = at(0, 3.55, 1.3);
    sign(ctx, scene, 'mkt-' + (n % foods.length), foods[n % foods.length], { w: 512, h: 112, bg: '#14100e', color: ['#ffd23f', '#ff6a3c', '#7dff9a', '#5ad8ff', '#ff7ad8'][n % 5], size: 62 }, sm[12], sm[13], sm[14], yaw, 3.4, 0.74);
    n++;
  };
  const SXs = W2 + 6.4;
  for (let i = 0; i < 8; i++) { const z = -21 + i * 6; stall(SXs, z, -Math.PI / 2); stall(-SXs, z, Math.PI / 2); }
  for (const sx of [-1, 1]) solids.push({ x0: sx > 0 ? SXs - 1.8 : -SXs - 1.4, x1: sx > 0 ? SXs + 1.4 : -SXs + 1.8, z0: -24, z1: 24, h: 3 });
  // lantern strings down the east side on posts (seen across the court from the broadcast camera)
  { const posts = []; for (let z = -24; z <= 24; z += 8) posts.push([W2 + 3.4, z]);
    for (const [x, z] of posts) metal.push({ geo: G.cylinder(0.07, 0.09, 5.6, 8, { y0: true }), matrix: TR(x, 0, z), color: c4('#3a2a24') });
    const cols = [[1.6, 0.25, 0.15, 1], [1.7, 0.7, 0.2, 1], [1.6, 1.15, 0.35, 1]];
    let k = 0;
    for (let i = 0; i < posts.length - 1; i++) {
      const [ax, az] = posts[i], [, bz] = posts[i + 1], path = [];
      for (let j = 0; j <= 8; j++) { const t = j / 8; path.push([ax, 5.4 - Math.sin(t * Math.PI) * 0.7, az + (bz - az) * t]); }
      metal.push({ geo: G.tube(path, 0.012, 3), color: c4('#1e1e1e') });
      for (let j = 1; j < 6; j++) { const t = j / 6; glow.push({ geo: G.sphere(1, 8, 6), matrix: TRS(ax, 5.4 - Math.sin(t * Math.PI) * 0.7 - 0.36, az + (bz - az) * t, 0, 0.22, 0.3, 0.22), color: cols[k++ % 3] }); }
    }
    // and short strings from each post out to the stalls' roofs
    for (const [x, z] of posts) for (const dz of [-2.4, 2.4]) { const path = [[x, 5.4, z], [(x + SXs) / 2, 4.6, z + dz / 2], [SXs - 1.2, 3.4, z + dz]]; metal.push({ geo: G.tube(path, 0.01, 3), color: c4('#1e1e1e') }); glow.push({ geo: G.sphere(1, 8, 6), matrix: TRS((x + SXs) / 2, 4.3, z + dz / 2, 0, 0.18, 0.24, 0.18), color: cols[k++ % 3] }); }
  }
  // the shophouses all round, their signs lit
  const houses = [], words = ['TEA HOUSE', 'BAKERY', 'GIFTS', 'NOODLE HOUSE', 'KARAOKE', 'FLOWERS', 'BOOKS', 'HERBS', 'TAILOR', 'CAFE'];
  for (let i = 0; i < 9; i++) { houses.push({ x: -34, z: -40 + i * 10, w: 12, d: 9.6, h: fixed.range(2, 4) * 3.4, tint: fixed.pick(['#f2d8c0', '#d8e8d8', '#f0e0b0', '#e8c8c8', '#d0d8e8']) }); houses.push({ x: 34, z: -40 + i * 10, w: 12, d: 9.6, h: fixed.range(2, 4) * 3.4, tint: fixed.pick(['#f2d8c0', '#d8e8d8', '#f0e0b0', '#e8c8c8', '#d0d8e8']) }); }
  for (let i = 0; i < 6; i++) { houses.push({ x: -25 + i * 10, z: 40, w: 9.6, d: 12, h: fixed.range(2, 5) * 3.4, tint: fixed.pick(TINTS) }); houses.push({ x: -25 + i * 10, z: -40, w: 9.6, d: 12, h: fixed.range(2, 5) * 3.4, tint: fixed.pick(TINTS) }); }
  blocks(ctx, scene, houses, 'shophouses', { wall: '#a88a70', lit: 0.55, emissive: win(look, 1.1), seed: 121, detail: { bays: 3, floors: 2, kind: 'stone' } });
  houses.forEach((h, i) => { if (i % 2 && i > 3) return; const face = Math.abs(h.x) > Math.abs(h.z) ? [h.x - Math.sign(h.x) * (h.w / 2 + 0.06), h.z, h.x > 0 ? -Math.PI / 2 : Math.PI / 2] : [h.x, h.z - Math.sign(h.z) * (h.d / 2 + 0.06), h.z > 0 ? Math.PI : 0]; sign(ctx, scene, 'mktshop-' + (i % words.length), words[i % words.length], { w: 512, h: 112, bg: '#1a1012', color: ['#ff4a5a', '#ffd23f', '#5ad8ff', '#7dff9a'][i % 4], size: 62 }, face[0], 4.2, face[1], face[2], 4.4, 0.95); });
  // folding tables in the corners, people at them; the crowd at the stalls and behind the baselines
  for (const [tx, tz] of [[-14, -27], [-9, -27], [9, -27], [14, -27], [-14, 27], [-9, 27], [9, 27], [14, 27]]) {
    matte.push({ geo: G.box(1.8, 0.05, 0.8), matrix: TR(tx, 0.74, tz), color: c4('#e8e4dc') }, { geo: G.box(1.6, 0.72, 0.05), matrix: TR(tx, 0.36, tz), color: c4('#9aa0a6') });
    for (const sz of [-0.7, 0.7]) for (const sx of [-0.5, 0.5]) { matte.push({ geo: G.cylinder(0.17, 0.17, 0.45, 8, { y0: true }), matrix: TR(tx + sx, 0, tz + sz), color: c4('#c8302a') }); if (fixed.next() < 0.75) seats.push({ x: tx + sx, y: 0.45, z: tz + sz, yaw: sz > 0 ? Math.PI : 0 }); }
  }
  for (const sx of [-1, 1]) { standRow(seats, sx * (W2 + 4.2), -22, sx * (W2 + 4.2), 22, 30); standRow(seats, sx * (W2 + 5.2), -22, sx * (W2 + 5.2), 22, 22, 0, [sx * 30, 0]); }
  standRow(seats, -W2, -L2 - 3.6, W2, -L2 - 3.6, 16); standRow(seats, -W2, L2 + 3.6, W2, L2 + 3.6, 16);
  // the clubhouse: the red two-storey shophouse, a lit shopfront and a balcony hung with lanterns
  const cx = 21, cz = -29.5, cw = 8, cd = 9, ch = 7.4; // (past the end of the stall row, its door onto the corner)
  matte.push({ geo: G.box(cw, ch, cd), matrix: TR(cx, ch / 2, cz), color: c4('#8a2622') }, { geo: G.box(cw + 1.2, 0.3, cd + 1.2), matrix: TR(cx, ch + 0.15, cz), color: c4('#2a1a18') }, { geo: G.box(cw + 0.4, 0.5, cd + 0.4), matrix: TR(cx, ch + 0.55, cz), color: c4('#e8c15a') });
  glow.push({ geo: G.box(0.06, 2.2, 5.4), matrix: TR(cx - cw / 2 - 0.02, 1.5, cz - 1.4), color: [1, 0.78, 0.5, 1] });
  const door = clubDoor(matte, glow, cx - cw / 2 - 0.03, cz + 2.6, -Math.PI / 2, { door: '#2a1a18', frame: '#e8c15a' });
  matte.push({ geo: G.box(1.4, 0.16, cd), matrix: TR(cx - cw / 2 - 0.7, 3.6, cz), color: c4('#2a1a18') });
  for (let i = 0; i <= 12; i++) metal.push({ geo: G.box(0.04, 0.9, 0.04), matrix: TR(cx - cw / 2 - 1.35, 4.1, cz - cd / 2 + i * (cd / 12)), color: c4('#e8c15a') });
  metal.push({ geo: G.box(0.06, 0.06, cd), matrix: TR(cx - cw / 2 - 1.35, 4.55, cz), color: c4('#e8c15a') });
  for (const z of [cz - 3, cz, cz + 3]) litWindow(env, matte, cx - cw / 2 - 0.03, 5.3, z, -Math.PI / 2, 1.4, 1.6, 1);
  for (let i = 0; i < 5; i++) glow.push({ geo: G.sphere(1, 8, 6), matrix: TRS(cx - cw / 2 - 1.2, 6.4, cz - 3.6 + i * 1.8, 0, 0.26, 0.36, 0.26), color: [1.7, 0.28, 0.16, 1] });
  clubMarquee(env, 'market', 'SHOPHOUSE', cx - cw / 2 - 0.02, ch + 1.6, cz, -Math.PI / 2, 4.4, '#e8c15a', '#2a1a18', door);
  solids.push({ x0: cx - cw / 2 - 0.2, x1: cx + cw / 2, z0: cz - cd / 2, z1: cz + cd / 2, h: ch });
  // the home team's banners: over the stall rows and on the clubhouse
  for (const sx of [-1, 1]) bannerQuad(ctx, scene, env.bannerMats.name, sx * (SXs + 1.3), 4.4, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 6, 1.4, env.banners);
  bannerQuad(ctx, scene, env.bannerMats.logo, cx - cw / 2 - 0.06, 6, cz + 3.9, -Math.PI / 2, 1, 2, env.banners);
  for (const z of [-L2 - 3, L2 + 3]) bannerQuad(ctx, scene, env.bannerMats.logo, z < 0 ? -10 : 10, 4, z, z < 0 ? 0 : Math.PI, 1.4, 2.8, env.banners);
  for (const z of [-L2 - 3, L2 + 3]) metal.push({ geo: G.cylinder(0.05, 0.06, 5.6, 8, { y0: true }), matrix: TR(z < 0 ? -10.8 : 10.8, 0, z), color: c4('#3a2a24') });
  env.lights.push({ pos: [SXs - 1, 3, -10], range: 16, color: [1, 0.7, 0.42], intensity: 9, dir: null }, { pos: [SXs - 1, 3, 10], range: 16, color: [1, 0.7, 0.42], intensity: 9, dir: null }, { pos: [-SXs + 1, 3, -10], range: 16, color: [1, 0.7, 0.42], intensity: 9, dir: null }, { pos: [-SXs + 1, 3, 10], range: 16, color: [1, 0.7, 0.42], intensity: 9, dir: null });
  return { bounds: { x0: -W2 - 4, x1: 18, z0: -28, z1: 27 }, clubhouse: { door, anchor: { x: cx, y: 0, z: cz, yaw: -Math.PI / 2, w: cd - 0.6, d: cw - 0.6 }, style: 'shophouse' }, lightColor: [1, 0.86, 0.66], lightK: 0.85 };
};
