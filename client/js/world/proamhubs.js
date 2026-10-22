// v0.4.8.8 The Pro-Am Overhaul, the Hub agent's part (docs/PROAM-OVERHAUL.md §8): the Pro-Am team's hub building, the
// one its members meet in (game/proamhub.js runs it). The building goes with the team's tier:
//  * Bronze: Eastside Middle School's gym. A small, worn one-court gym: wall-mounted and ceiling-hung goals, a stage at
//    the south end, one bank of folding bleachers pulled out (the other folded against the wall), caged lights (one of
//    them flickers), clerestory windows, and the coach's little office through a door in the wall behind the north hoop.
//  * Silver: Northgate High's gym. A full high-school court on portable stanchions, wooden bleachers both sides,
//    championship banners in the rafters, an electronic scoreboard, and a bigger office off the south end with a window
//    onto the floor.
//  * Gold: the team's own clubhouse. A main court and a shootaround half court in the team's floor, walls, logo and
//    colors (team.custom: the office's team settings), a logo wall, an LED ribbon, a hanging scoreboard, a trophy case
//    and lounge, a large glass-fronted office, and glass doors out to the team's home park (world/proamparks.js).
//  * Platinum and up: the Gold clubhouse with a Platinum trim (lead), until those tiers are designed.
// Every office has the same four interactables: the whiteboard (the series as a canvas: drawWhiteboard), the clipboard
// on the desk (the draft), the computer (team settings) and a "queue the next game" spot. The floor plan (rooms, the
// doorways between them, windows) gives the walls, the collision (walkable) and the roam camera's walls (camSolids).
// buildProamHub(r, scene, tier, {team}) → the venue: {theme, tier, look, courts, hoops, shootSlots, rooms, gaps,
// walkable, solids, camSolids, bounds, spawn, interactables, office, walkout, boards, mats, paint(team), update(dt)}.
// Budgets: under 80k triangles for Bronze and Silver, under 120k for Gold and Platinum; eight lights at most.
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG, hashString } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { buildCourt, buildHoop, woodTextures } from './court.js';
import * as PR from './props.js';
import { applyLighting } from './venues.js';
import { COURT } from '../sim/constants.js';
import { divInfo } from '../sim/ranks.js';
import { PROAM_IDS, proamInfo } from './proamparks.js';

const lin = hex => M.hexLinear(hex);
const c4 = hex => [...lin(hex), 1];
const TR = (x, y, z, yaw = 0, s = 1) => M.m4fromYaw(M.m4(), x, y, z, yaw, s);
const W2 = COURT.width / 2, L2 = COURT.length / 2;
const HEX = /^#[0-9a-f]{6}$/i;
const okHex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const luma = hex => { const c = M.hexToRgb(hex); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const inkOn = hex => (luma(hex) > 0.55 ? '#15171b' : '#f6f2ea');
const rgb = (hex, k = 1, a = 1) => { const c = M.hexToRgb(hex); return `rgba(${Math.min(255, c[0] * k * 255) | 0},${Math.min(255, c[1] * k * 255) | 0},${Math.min(255, c[2] * k * 255) | 0},${a})`; };
const mixHex = (a, b, t) => { const x = M.hexToRgb(a), y = M.hexToRgb(b); return '#' + x.map((v, i) => Math.round((v + (y[i] - v) * t) * 255).toString(16).padStart(2, '0')).join(''); };

// ---------------- the tiers, the team's look ----------------
export const HUB_TIERS = ['bronze', 'silver', 'gold', 'platinum'];
export const HUB_NAMES = { bronze: 'Eastside Middle School Gym', silver: 'Northgate High School Gym', gold: 'The Clubhouse', platinum: 'The Clubhouse · Platinum' };
// the team's tier as the hub goes (Diamond and up are Platinum's building for now): team.division.tier (the server's
// team view: 0 Bronze … 6 Grandmaster), else team.tier (a name or a number), else team.div (the flat division index)
export function hubTier(team) {
  if (!team) return 'bronze';
  let t = team.division?.tier;
  if (!Number.isFinite(t) && typeof team.tier === 'string') { const i = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster'].indexOf(team.tier.toLowerCase()); t = i >= 0 ? i : 0; }
  if (!Number.isFinite(t) && Number.isFinite(+team.tier)) t = +team.tier;
  if (!Number.isFinite(t) && Number.isFinite(+team.div)) t = divInfo(+team.div).tier;
  t = Math.max(0, Math.floor(+t || 0));
  return t >= 3 ? 'platinum' : HUB_TIERS[t];
}
export const tierRank = tier => Math.max(0, HUB_TIERS.indexOf(tier));
export const customizable = tier => tierRank(tier) >= 2; // (Gold and up: §8 Gold extras)

// what the office's team settings can set for a Gold clubhouse (team.custom: {floor, walls, logo, colors}; the Server/UI
// agent's settings panel keeps it, the hub renders it)
export const HUB_FLOORS = {
  natural: { label: 'Natural maple', tone: [0.84, 0.62, 0.4], slab: '#7f5d3b' },
  honey: { label: 'Honey gloss', tone: [0.92, 0.6, 0.3], slab: '#8a5527' },
  ebony: { label: 'Ebony stain', tone: [0.34, 0.25, 0.19], slab: '#251c16' },
  whitewash: { label: 'Whitewashed', tone: [0.93, 0.87, 0.77], slab: '#a99d8a' },
  slate: { label: 'Slate gray', tone: [0.52, 0.52, 0.55], slab: '#46474b' },
};
export const HUB_WALLS = {
  brick: { label: 'Red brick' },
  block: { label: 'Painted block' },
  panel: { label: 'Wood panels' },
  concrete: { label: 'Polished concrete' },
  team: { label: 'Team colors' },
};
export const HUB_LOGOS = ['bolt', 'crown', 'flame', 'star', 'shield', 'hex', 'circle', 'diamond', 'wolf', 'eagle', 'skull', 'wave']; // (server/proam.py LOGOS)
const DRAWN = new Set(['circle', 'shield', 'diamond', 'hex', 'star', 'crown', 'bolt']);
// the shape T.drawLogo paints for a team logo (the ones it has no drawing for are a roundel with the abbreviation)
export const logoShape = l => (DRAWN.has(l) ? l : 'circle');

// the team's look in the hub: name, abbreviation, colors and logo, and (Gold and up) the floor and walls it chose
export function hubLook(team = {}) {
  const cu = team?.custom && typeof team.custom === 'object' ? team.custom : {};
  const cols = Array.isArray(cu.colors) && cu.colors.length ? cu.colors : Array.isArray(team?.colors) && team.colors.length ? team.colors : [team?.primary, team?.secondary];
  const primary = okHex(cols[0], '#2457c5'), secondary0 = okHex(cols[1], '#f2c14e');
  const secondary = secondary0 === primary ? inkOn(primary) : secondary0;
  const logo = HUB_LOGOS.includes(cu.logo) ? cu.logo : HUB_LOGOS.includes(team?.logo) ? team.logo : 'circle';
  return {
    name: String(team?.name || 'Pro-Am Team').slice(0, 22), abbr: String(team?.abbr || 'PRO').toUpperCase().slice(0, 4),
    primary, secondary, logo, floor: HUB_FLOORS[cu.floor] ? cu.floor : 'natural', walls: HUB_WALLS[cu.walls] ? cu.walls : 'brick',
  };
}
// the team's home park (§7): its chosen court, else one of the twelve picked from the team's id (the same for every
// member: the walk-out needs one even when the team plays a different park every home game)
export function homePark(team) {
  const c = team?.court ?? team?.homeCourt ?? null;
  const id = typeof c === 'string' ? c.replace(/^proam_/, '') : null;
  if (id && PROAM_IDS.includes(id)) return id;
  return PROAM_IDS[hashString(`hubpark|${team?.id || team?.name || 'team'}`) % PROAM_IDS.length];
}

// ---------------- lighting ----------------
const LIGHT = {
  bronze: {
    sky: { top: [0.06, 0.06, 0.06], horizon: [0.14, 0.13, 0.11], ground: [0.06, 0.05, 0.04], stars: 0 },
    sun: { dir: [-0.3, 1, 0.22], color: [1.0, 0.92, 0.78], intensity: 1.45 },
    ambient: { sky: [0.36, 0.35, 0.32], ground: [0.27, 0.21, 0.15] },
    fog: { color: [0.1, 0.1, 0.1], density: 0 },
    env: { top: '#34312c', horizon: '#76684f', ground: '#6a4f31', bands: [{ v: 0.12, h: 0.025, color: '#fff0cf' }] },
    exposure: 1.1, bloom: { strength: 0.1, threshold: 1.05, radius: 1 }, grade: { saturation: 0.95, contrast: 1.05, vignette: 0.58 }, envIntensity: 0.75,
  },
  silver: {
    sky: { top: [0.06, 0.06, 0.07], horizon: [0.14, 0.14, 0.15], ground: [0.05, 0.05, 0.05], stars: 0 },
    sun: { dir: [-0.25, 1, 0.3], color: [1.0, 0.98, 0.94], intensity: 1.85 },
    ambient: { sky: [0.42, 0.42, 0.44], ground: [0.3, 0.24, 0.18] },
    fog: { color: [0.1, 0.1, 0.11], density: 0 },
    env: { top: '#3a3d42', horizon: '#9a9a96', ground: '#8a6844', bands: [{ v: 0.1, h: 0.03, color: '#ffffff' }] },
    exposure: 1.1, bloom: { strength: 0.09, threshold: 1.1, radius: 1 }, grade: { saturation: 1.04, contrast: 1.04, vignette: 0.48 }, envIntensity: 0.9,
  },
  gold: {
    sky: { top: [0.04, 0.04, 0.05], horizon: [0.12, 0.11, 0.1], ground: [0.04, 0.04, 0.04], stars: 0 },
    sun: { dir: [-0.35, 1, 0.25], color: [1.0, 0.95, 0.88], intensity: 1.9 },
    ambient: { sky: [0.46, 0.45, 0.47], ground: [0.32, 0.26, 0.2] },
    fog: { color: [0.08, 0.08, 0.09], density: 0 },
    env: { top: '#2a2a2e', horizon: '#6e6253', ground: '#7a5a3a', bands: [{ v: 0.1, h: 0.03, color: '#fff3dc' }, { v: 0.3, h: 0.02, color: '#ffe2b0' }] },
    exposure: 1.12, bloom: { strength: 0.14, threshold: 1.0, radius: 1 }, grade: { saturation: 1.08, contrast: 1.06, vignette: 0.5 }, envIntensity: 0.9,
  },
};
LIGHT.platinum = { ...LIGHT.gold, sun: { ...LIGHT.gold.sun, color: [0.96, 0.97, 1.0] }, env: { top: '#2a2c31', horizon: '#6a6e78', ground: '#6a5a48', bands: [{ v: 0.1, h: 0.03, color: '#eef6ff' }, { v: 0.3, h: 0.02, color: '#dfe9ff' }] }, grade: { saturation: 1.04, contrast: 1.07, vignette: 0.5 } };

// the themes (kind gym: indoors, no crowd bed; MatchSession reads court.surface)
export const HUB_THEMES = Object.fromEntries(HUB_TIERS.map(t => [t, { id: 'pahub_' + t, kind: 'gym', style: 'gym', name: HUB_NAMES[t], court: { surface: 'wood' }, floodlights: false, ...LIGHT[t] }]));

// ---------------- floor plans ----------------
// rooms: the floor areas (x0..x1, z0..z1, h the ceiling), walls on all four sides of each; gaps: openings across a wall
// line (x0..x1 by z0..z1 straddling it): a doorway (walk: you can go through it; y1 its head) or a window (y0..y1);
// court: the main court (full, at the origin); shoot: the extra shootaround half court (Gold). Interactable spots are
// where you stand (x, z) and how close you need to be (r).
const PLANS = {
  bronze: {
    rooms: [
      { id: 'gym', x0: -11.2, x1: 11.2, z0: -18.8, z1: 15.7, h: 7.6, walls: { lower: 'dado', upper: 'wall', dado: 2.4 }, floor: 'wood', ceil: 'ceil' },
      { id: 'office', x0: 2.6, x1: 7.8, z0: 15.7, z1: 19.5, h: 2.9, walls: { lower: 'odado', upper: 'owall', dado: 1.0 }, floor: 'tile', ceil: 'oceil' },
    ],
    gaps: [
      { id: 'office', x0: 4.3, x1: 5.5, z0: 15.1, z1: 16.3, y1: 2.15, walk: true },
      { id: 'owin', x0: 6.3, x1: 7.4, z0: 15.5, z1: 15.9, y0: 1.15, y1: 2.05 },
    ],
    spawn: { x: 9.7, z: -13.6, yaw: -Math.PI / 2 },
    exit: { x: 10.25, z: -13.6, r: 1.7, door: { x: 11.2, z: -13.6, yaw: -Math.PI / 2, w: 2.2 } },
    office: { room: 'office', door: { x: 4.9, z: 15.7 }, whiteboard: { x: 4.7, z: 18.65, r: 1.05, at: { x: 4.7, y: 1.6, z: 19.46, yaw: Math.PI, w: 2.4, h: 1.25 } }, settings: { x: 6.55, z: 16.85, r: 0.75 }, draft: { x: 6.55, z: 18.0, r: 0.75 }, queue: { x: 3.3, z: 16.75, r: 0.75 } },
    shoot: [{ x: 0, z: 9, r: 3.6 }, { x: -9.3, z: 12.6, r: 1.8 }],
  },
  silver: {
    rooms: [
      { id: 'gym', x0: -15.6, x1: 15.6, z0: -19.6, z1: 17.8, h: 10.2, walls: { lower: 'dado', upper: 'wall', dado: 3.0 }, floor: 'wood', ceil: 'ceil' },
      { id: 'office', x0: 4.6, x1: 14.6, z0: -25.8, z1: -19.6, h: 3.1, walls: { lower: 'owall', upper: 'owall', dado: 0 }, floor: 'carpet', ceil: 'oceil' },
    ],
    gaps: [
      { id: 'office', x0: 7.9, x1: 9.3, z0: -20.2, z1: -19.0, y1: 2.2, walk: true },
      { id: 'owin', x0: 10.8, x1: 13.9, z0: -19.8, z1: -19.4, y0: 1.0, y1: 2.25 },
    ],
    spawn: { x: -8.6, z: -18.2, yaw: 0 },
    exit: { x: -8.6, z: -18.75, r: 1.7, door: { x: -8.6, z: -19.6, yaw: 0, w: 2.4 } },
    office: { room: 'office', door: { x: 8.6, z: -19.6 }, whiteboard: { x: 9.4, z: -24.85, r: 1.15, at: { x: 9.4, y: 1.6, z: -25.76, yaw: 0, w: 3.4, h: 1.35 } }, settings: { x: 12.0, z: -23.4, r: 0.8 }, draft: { x: 13.35, z: -23.4, r: 0.8 }, queue: { x: 6.1, z: -20.45, r: 0.8 } },
    shoot: [{ x: 0, z: 9, r: 3.8 }, { x: 5.2, z: 16.2, r: 1.8 }],
  },
  gold: {
    rooms: [
      { id: 'hall', x0: -12, x1: 31, z0: -20, z1: 18, h: 11, walls: { lower: 'wall', upper: 'wall', dado: 0 }, floor: 'slab', ceil: 'ceil' },
      { id: 'office', x0: 15, x1: 31, z0: -28.5, z1: -20, h: 3.6, walls: { lower: 'owall', upper: 'owall', dado: 0 }, floor: 'ofloor', ceil: 'oceil' },
    ],
    gaps: [
      { id: 'office', x0: 18.6, x1: 20.2, z0: -20.6, z1: -19.4, y1: 2.4, walk: true },
      { id: 'oglass', x0: 21.0, x1: 30.4, z0: -20.2, z1: -19.8, y0: 0.5, y1: 2.9 },
    ],
    spawn: { x: -5, z: -18.1, yaw: 0 },
    exit: { x: -5, z: -18.95, r: 1.7, door: { x: -5, z: -20, yaw: 0, w: 1.9 } },
    walkout: { x: -10.9, z: -2, r: 1.9, door: { x: -12, z: -2, yaw: Math.PI / 2, w: 3.2 } },
    office: { room: 'office', door: { x: 19.4, z: -20 }, whiteboard: { x: 29.95, z: -24.3, r: 1.2, at: { x: 30.95, y: 1.7, z: -24.3, yaw: -Math.PI / 2, w: 4.0, h: 1.6 } }, settings: { x: 23.65, z: -27.3, r: 0.85 }, draft: { x: 25.65, z: -27.3, r: 0.85 }, queue: { x: 16.6, z: -21.15, r: 0.85 } },
    shootCourt: [21.5, 0, -1.5],
    shoot: [{ x: 0, z: 9, r: 3.8 }, { x: 21.5, z: 7.5, r: 4 }],
  },
};
PLANS.platinum = PLANS.gold;
export const hubPlan = tier => PLANS[tier] || PLANS.bronze;

// ---------------- walls, collision ----------------
const inRect = (R, x, z, m = 0) => x >= R.x0 + m && x <= R.x1 - m && z >= R.z0 + m && z <= R.z1 - m;
// can a person of radius r stand here? (inside a room, or in a doorway)
export function walkableIn(plan, x, z, r = 0.35) {
  for (const R of plan.rooms) if (inRect(R, x, z, r)) return true;
  for (const g of plan.gaps) if (g.walk && inRect(g, x, z, Math.min(r, (g.x1 - g.x0) / 2 - 0.02, (g.z1 - g.z0) / 2 - 0.02))) return true;
  return false;
}
// the walls along each room's sides with the doorways cut out of them, as boxes (the roam camera's boom stops at them)
function wallLines(plan) {
  const out = [];
  for (const R of plan.rooms) {
    const edges = [['x', R.z0, R.x0, R.x1], ['x', R.z1, R.x0, R.x1], ['z', R.x0, R.z0, R.z1], ['z', R.x1, R.z0, R.z1]];
    for (const [axis, fixed, a, b] of edges) {
      const cut = plan.gaps.filter(g => g.walk && (axis === 'x' ? g.z0 < fixed && g.z1 > fixed : g.x0 < fixed && g.x1 > fixed)).map(g => (axis === 'x' ? [g.x0, g.x1] : [g.z0, g.z1])).sort((p, q) => p[0] - q[0]);
      let s = a;
      for (const [g0, g1] of [...cut, [b, b]]) {
        const e = Math.min(g0, b);
        if (e - s > 0.05) out.push(axis === 'x' ? { x0: s, x1: e, z0: fixed - 0.25, z1: fixed + 0.25, h: 99 } : { x0: fixed - 0.25, x1: fixed + 0.25, z0: s, z1: e, h: 99 });
        s = Math.max(s, g1);
      }
    }
  }
  return out;
}

// ---------------- textures ----------------
function blockCanvas(paint, mortar, seed = 3, wear = 0) {
  const S = 512, c = T.canvas(S, S), g = c.getContext('2d'), rng = new RNG(seed);
  g.fillStyle = mortar; g.fillRect(0, 0, S, S);
  const bw = S / 4, bh = S / 8;
  for (let r = 0; r < 8; r++) for (let k = -1; k < 5; k++) {
    const x = k * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
    g.fillStyle = rgb(paint, 0.94 + rng.next() * 0.09); g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
  }
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + rng.next() * 0.06})`; g.fillRect(rng.next() * S, rng.next() * S, 1 + rng.next() * 2, 1 + rng.next() * 2); }
  for (let i = 0; i < wear * 40; i++) { g.fillStyle = `rgba(40,30,20,${0.05 + rng.next() * 0.1})`; const x = rng.next() * S, y = rng.next() * S; g.fillRect(x, y, 4 + rng.next() * 40, 2 + rng.next() * 5); } // (scuffs)
  return c;
}
function panelCanvas(base = '#6e4a2e', seed = 5) {
  const S = 512, c = T.canvas(S, S), g = c.getContext('2d'), rng = new RNG(seed);
  const n = 8, w = S / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = rgb(base, 0.86 + rng.next() * 0.26); g.fillRect(i * w, 0, w, S);
    for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(30,18,8,${0.05 + rng.next() * 0.08})`; g.fillRect(i * w + rng.next() * w, 0, 1 + rng.next() * 2, S); } // (grain)
    g.fillStyle = 'rgba(10,6,3,0.75)'; g.fillRect(i * w, 0, 4, S); // (the gap between slats)
  }
  return c;
}
function plasterCanvas(base, seed = 9) {
  const S = 256, c = T.canvas(S, S), g = c.getContext('2d'), rng = new RNG(seed);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2200; i++) { const k = rng.next(); g.fillStyle = k > 0.5 ? `rgba(255,255,255,${0.02 + rng.next() * 0.035})` : `rgba(0,0,0,${0.02 + rng.next() * 0.04})`; g.fillRect(rng.next() * S, rng.next() * S, 2 + rng.next() * 5, 2 + rng.next() * 5); }
  return c;
}
function tileCanvas(a = '#cfc8b8', b = '#8a7f6c', seed = 4) { // (vinyl tile, checkered, a little worn)
  const S = 256, c = T.canvas(S, S), g = c.getContext('2d'), rng = new RNG(seed), n = 4, w = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = rgb((i + j) % 2 ? a : b, 0.92 + rng.next() * 0.12); g.fillRect(i * w, j * w, w, w); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(i * w + 0.5, j * w + 0.5, w - 1, w - 1); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + rng.next() * 0.06})`; g.fillRect(rng.next() * S, rng.next() * S, 1 + rng.next() * 3, 1); }
  return c;
}
function carpetCanvas(base = '#3a3f47', seed = 6) {
  const S = 256, c = T.canvas(S, S), g = c.getContext('2d'), rng = new RNG(seed);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) { g.fillStyle = rng.next() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'; g.fillRect(rng.next() * S, rng.next() * S, 1, 1); }
  return c;
}
// the worn gym's floor: scuffs (sneakers, chairs dragged), a dull patch in each key and at center, tape marks
function scuffCanvas(seed = 12) {
  const S = 1024, c = T.canvas(S, S), g = c.getContext('2d'), rng = new RNG(seed);
  g.clearRect(0, 0, S, S);
  const pat = (x, y, r, a) => { for (let i = 0; i < 70; i++) { const ang = rng.next() * Math.PI * 2, d = rng.next() * r; g.fillStyle = `rgba(255,248,232,${a * (0.3 + rng.next() * 0.7)})`; g.beginPath(); g.ellipse(x + Math.cos(ang) * d, y + Math.sin(ang) * d, 8 + rng.next() * 26, 4 + rng.next() * 12, ang, 0, Math.PI * 2); g.fill(); } };
  pat(S / 2, S * 0.1, 120, 0.05); pat(S / 2, S * 0.9, 120, 0.05); pat(S / 2, S / 2, 160, 0.04);
  for (let i = 0; i < 420; i++) {
    const x = rng.next() * S, y = rng.next() * S, a = rng.next() * Math.PI, L = 6 + rng.next() * 34;
    g.strokeStyle = `rgba(20,14,10,${0.08 + rng.next() * 0.2})`; g.lineWidth = 1 + rng.next() * 2.5;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + rng.range(-6, 6), y + Math.sin(a) * L * 0.5 + rng.range(-6, 6), x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(230,225,200,${0.12 + rng.next() * 0.15})`; g.fillRect(rng.next() * S, rng.next() * S, 18 + rng.next() * 30, 5); } // (old tape)
  return c;
}

// the team banner the middle school let them hang: butcher paper, painted by hand
function paperBanner(look) {
  const W = 1024, H = 384, c = T.canvas(W, H), g = c.getContext('2d'), rng = new RNG(hashString(look.name) || 3);
  g.fillStyle = '#efe6d2'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(120,100,70,${0.02 + rng.next() * 0.04})`; g.fillRect(rng.next() * W, rng.next() * H, 2 + rng.next() * 8, 1 + rng.next() * 2); }
  g.save(); g.translate(W / 2, H / 2); g.rotate(-0.025);
  g.fillStyle = look.primary; g.font = '900 54px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('HOME OF THE', 0, -112);
  g.font = '900 118px "Arial Black", Impact, sans-serif'; g.fillStyle = look.primary; g.fillText(look.name.toUpperCase().slice(0, 16), 0, 6);
  g.strokeStyle = look.secondary; g.lineWidth = 3; g.strokeText(look.name.toUpperCase().slice(0, 16), 0, 6);
  g.font = '700 40px "Arial Black", Impact, sans-serif'; g.fillStyle = mixHex(look.primary, '#222222', 0.35); g.fillText(`PRO-AM · ${look.abbr} · BRONZE`, 0, 112);
  g.restore();
  for (const [x, y] of [[8, 8], [W - 48, 8], [8, H - 30], [W - 48, H - 30]]) { g.fillStyle = 'rgba(200,196,180,0.85)'; g.fillRect(x, y, 40, 22); } // (tape)
  return c;
}
// a hanging vinyl banner in the team's colors: its name and logo
function teamBanner(look, sub = 'PRO-AM') {
  const W = 512, H = 1024, c = T.canvas(W, H), g = c.getContext('2d'), ink = look.secondary;
  g.fillStyle = look.primary; g.fillRect(0, 0, W, H);
  g.fillStyle = ink; g.fillRect(0, 0, W, 26); g.fillRect(0, H - 120, W, 120);
  T.drawLogo(g, { shape: logoShape(look.logo), color: mixHex(look.primary, '#000000', 0.15), accent: ink, text: look.abbr }, W / 2, 360, 170);
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 64px "Arial Black", Impact, sans-serif';
  const words = look.name.toUpperCase().split(' ');
  words.slice(0, 3).forEach((w, i) => g.fillText(w.slice(0, 11), W / 2, 640 + i * 76));
  g.fillStyle = look.primary; g.font = '900 46px "Arial Black", Impact, sans-serif'; g.fillText(sub, W / 2, H - 60);
  return c;
}
// a school's championship pennant (a rectangle with a notch out of the bottom): fictional schools and years
function pennant(bg, ink, lines) {
  const W = 256, H = 512, c = T.canvas(W, H), g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = bg; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W / 2, H - 70); g.lineTo(0, H); g.closePath(); g.fill();
  g.strokeStyle = ink; g.lineWidth = 8; g.strokeRect(14, 14, W - 28, 60);
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.font = `900 ${i === 0 ? 34 : i === 1 ? 54 : 30}px "Arial Black", Impact, sans-serif`; g.fillText(l, W / 2, 44 + i * 92 + (i ? 40 : 0)); });
  return c;
}
function scoreboardCanvas(o) {
  const W = 1024, H = 384, c = T.canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#0a0b0d'; g.fillRect(0, 0, W, H);
  g.strokeStyle = o.trim || '#3a3d42'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#e8e3d6'; g.font = '900 44px Arial, sans-serif'; g.fillText(o.home || 'HOME', 200, 64); g.fillText(o.guest || 'GUEST', W - 200, 64);
  const dig = (t, x, col) => { g.font = '900 150px "Courier New", monospace'; g.fillStyle = 'rgba(255,60,40,0.08)'; g.fillText('88', x, 200); g.fillStyle = col; g.fillText(t, x, 200); };
  dig(String(o.hs ?? 0).padStart(2, '0'), 200, o.digit || '#ff4a2a'); dig(String(o.gs ?? 0).padStart(2, '0'), W - 200, o.digit || '#ff4a2a');
  g.font = '900 96px "Courier New", monospace'; g.fillStyle = o.clock || '#ffc23a'; g.fillText(o.time || '0:00', W / 2, 140);
  g.font = '700 34px Arial, sans-serif'; g.fillStyle = '#c9c4b8'; g.fillText(o.mid || 'PERIOD 1', W / 2, 236);
  if (o.foot) { g.font = '900 38px Arial, sans-serif'; g.fillStyle = o.footColor || '#e8e3d6'; g.fillText(o.foot, W / 2, 320); }
  return c;
}

// ---------------- the whiteboard ----------------
// what the whiteboard shows, from the team (the server's team view: name, division, record, series, current) and the
// season ({n, end} or a ready line). Pure: the hub's tests read it.
export function whiteboardData(team, season = null, now = Date.now() / 1000) {
  const t = team || {}, sr = t.current || null, look = hubLook(t);
  const games = sr ? (sr.games || []).map((g, i) => ({ n: g.n ?? i + 1, opponent: g.opponent?.name || 'TBD', ai: g.opponent?.kind === 'ai', home: !!g.home, result: g.result || null, score: Array.isArray(g.score) ? g.score : null, venue: g.venue || null })) : [];
  const pending = games.find(g => !g.result) || null;
  const next = sr ? (pending ? { ...pending } : { n: games.length + 1, opponent: null, home: games.length % 2 === 0 }) : null;
  let seasonText = '';
  if (typeof season === 'string') seasonText = season;
  else if (season && Number.isFinite(+season.end)) {
    const left = Math.max(0, +season.end - now), d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600);
    seasonText = `Season ${season.n ?? 1} · ${d}d ${h}h left`;
  }
  return {
    name: look.name, abbr: look.abbr, primary: look.primary,
    division: t.division?.label || 'Bronze 1', record: Array.isArray(t.record) ? t.record : [0, 0], seriesRecord: Array.isArray(t.series) ? t.series : [0, 0],
    series: sr ? { label: sr.division?.label || t.division?.label || '', wins: sr.wins || 0, losses: sr.losses || 0, need: sr.need || 2, length: sr.length || 3, status: sr.status || 'open' } : null,
    games, next, season: seasonText,
    members: (t.members || []).map(m => ({ name: m.username || m.name || '?', rank: m.build?.state?.label || '', rp: m.build?.state?.rp ?? null })).slice(0, 10),
  };
}
// a whiteboard in marker: the team, the series game by game, the record, the next opponent, the season
export function drawWhiteboard(cvs, d) {
  const g = cvs.getContext('2d'), W = cvs.width, H = cvs.height;
  g.fillStyle = '#f5f6f2'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(120,130,140,0.08)'; for (let i = 0; i < 6; i++) g.fillRect(40 + i * 160, 30 + (i % 3) * 140, 120, 18); // (ghosts of old marker)
  const blue = '#1f4fa8', red = '#c8322f', ink = '#1c1d20', green = '#1f8a4c';
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const marker = (txt, x, y, px, col, w = 700) => { g.fillStyle = col; g.font = `${w} ${px}px "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive`; g.fillText(txt, x, y); };
  if (!d) { marker('No team', 40, H / 2, 60, ink); return; }
  marker(`${d.name}`.toUpperCase(), 36, 52, 52, d.primary && luma(d.primary) < 0.75 ? d.primary : blue, 900);
  marker(`${d.division}`, W - 330, 52, 40, red);
  g.strokeStyle = ink; g.lineWidth = 3; g.beginPath(); g.moveTo(30, 90); g.lineTo(W - 30, 92); g.stroke();
  const s = d.series;
  if (s) {
    marker(`SERIES  ${s.wins}-${s.losses}`, 36, 136, 46, ink, 900);
    marker(`(${s.length} games · first to ${s.need})`, 360, 138, 28, '#555b63');
    d.games.slice(0, 7).forEach((gm, i) => {
      const y = 190 + i * 44, col = gm.result === 'W' ? green : gm.result === 'L' ? red : ink;
      marker(`G${gm.n}`, 44, y, 30, ink, 900);
      marker(gm.home ? 'HOME' : 'AWAY', 110, y, 26, '#555b63');
      marker(`vs ${gm.opponent}`.slice(0, 26), 210, y, 30, col);
      marker(gm.result ? `${gm.result}${gm.score ? ` ${gm.score[0]}-${gm.score[1]}` : ''}` : 'NEXT', 590, y, 30, col, 900);
    });
    if (!d.games.length) marker('Game 1 · HOME · to be matched', 44, 190, 30, ink);
  } else {
    marker('No series on', 36, 136, 44, ink, 900);
    marker('Queue a game to start one', 44, 190, 30, '#555b63');
  }
  // the right column: next game, records, season
  const x2 = 700;
  g.strokeStyle = 'rgba(28,29,32,0.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x2 - 24, 110); g.lineTo(x2 - 22, H - 40); g.stroke();
  marker('NEXT', x2, 136, 36, red, 900);
  const nx = d.next;
  marker(nx ? `G${nx.n} · ${nx.home ? 'HOME' : 'AWAY'}` : 'Queue up', x2, 182, 30, ink);
  marker(nx?.opponent ? `vs ${nx.opponent}`.slice(0, 20) : 'opponent: TBD', x2, 222, 28, blue);
  marker(`Games ${d.record[0]}-${d.record[1]}`, x2, 290, 30, ink);
  marker(`Series ${d.seriesRecord[0]}-${d.seriesRecord[1]}`, x2, 330, 30, ink);
  if (d.season) marker(d.season, x2, 396, 24, '#555b63');
  // a little play diagram in the corner
  g.strokeStyle = blue; g.lineWidth = 3; g.beginPath(); g.arc(W - 120, H - 80, 46, Math.PI, 0); g.stroke();
  for (const [x, y] of [[W - 170, H - 60], [W - 120, H - 140], [W - 70, H - 60]]) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = red; g.beginPath(); g.moveTo(W - 170, H - 60); g.quadraticCurveTo(W - 150, H - 120, W - 120, H - 132); g.stroke();
}

// ---------------- the builder ----------------
function kit(ctx, scene, plan, look, tier) {
  const L = { matte: [], metal: [], glow: [], cloth: [], teamA: [], teamB: [], trim: [], glass: [] };
  const B = {
    ctx, scene, plan, look, tier, L, walls: {}, floors: {}, ceils: {}, solids: [], lights: [], anim: [], signs: [],
    rng: new RNG(hashString('pahub|' + tier)),
    put(list, geo, x, y, z, hex, yaw = 0) { L[list].push({ geo, matrix: TR(x, y, z, yaw), color: hex ? (Array.isArray(hex) ? hex : c4(hex)) : [1, 1, 1, 1] }); },
    // a box with its bottom at y0
    box(list, w, h, d, x, y0, z, hex, yaw = 0) { this.put(list, G.box(w, h, d), x, y0 + h / 2, z, hex, yaw); },
    // a box in another frame (x, z, yaw), offset by (dx, dy, dz) in it
    boxAt(list, w, h, d, fx, fz, fyaw, dx, dy, dz, hex, yaw2 = 0) { L[list].push({ geo: G.box(w, h, d), matrix: M.m4mul(M.m4(), TR(fx, 0, fz, fyaw), TR(dx, dy + h / 2, dz, yaw2)), color: hex ? c4(hex) : [1, 1, 1, 1] }); },
    solid(x0, x1, z0, z1, h) { this.solids.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), h }); },
    // an unlit sign with a canvas on it (lit: its brightness)
    sign(cvs, w, h, x, y, z, yaw, o = {}) {
      const tex = ctx.texture(cvs, { wrap: 'clamp' });
      const mat = o.cloth ? new Material({ map: tex, roughness: 0.9, shading: 'cloth', doubleSided: !!o.double, alphaTest: o.alphaTest || 0 }) : new Material({ map: tex, color: [o.lit ?? 1.25, o.lit ?? 1.25, o.lit ?? 1.25], shading: 'unlit', fog: false, alphaTest: o.alphaTest || 0, doubleSided: !!o.double });
      const m = new Mesh(ctx.geometry(G.quad(w, h)), mat, { castShadow: false, reflect: !!o.reflect });
      m.matrix = o.matrix || TR(x, y, z, yaw);
      scene.add(m); const s = { cvs, tex, mesh: m, mat }; this.signs.push(s); return s;
    },
    light(x, y, z, range, intensity, color = [1, 0.97, 0.92]) { if (this.lights.length < 8) this.lights.push({ pos: [x, y, z], range, color, intensity, dir: null }); return this.lights.at(-1); },
  };
  return B;
}
function addBatch(B, parts, mat, opts = {}) {
  if (!parts.length) return null;
  const m = new Mesh(B.ctx.geometry(G.merge(parts, opts.color !== false)), mat, { castShadow: opts.castShadow ?? true, reflect: opts.reflect ?? true });
  if (opts.order != null) m.order = opts.order;
  B.scene.add(m);
  return m;
}

// walls, floors and ceilings of every room, from the plan (UVs in metres: each material's uvScale is its tiling)
function shell(B) {
  const { plan } = B;
  const quad = (key, cx, cz, yaw, w, y0, y1) => {
    if (w < 0.02 || y1 - y0 < 0.02) return;
    const g = G.quad(w, y1 - y0, { bottom: true });
    for (let i = 0; i < 4; i++) { g.uv[i * 2] = g.position[i * 3] + w / 2; g.uv[i * 2 + 1] = -(g.position[i * 3 + 1] + y0); }
    (B.walls[key] ||= []).push({ geo: g, matrix: TR(cx, y0, cz, yaw) });
  };
  for (const R of plan.rooms) {
    const sp = R.walls;
    const span = (cx, cz, yaw, w, y0, y1) => {
      if (sp.dado && y0 < sp.dado) { quad(sp.lower, cx, cz, yaw, w, y0, Math.min(y1, sp.dado)); if (y1 > sp.dado) quad(sp.upper, cx, cz, yaw, w, sp.dado, y1); }
      else quad(sp.upper, cx, cz, yaw, w, y0, y1);
    };
    const edges = [['x', R.z0, R.x0, R.x1, 0], ['x', R.z1, R.x0, R.x1, Math.PI], ['z', R.x0, R.z0, R.z1, Math.PI / 2], ['z', R.x1, R.z0, R.z1, -Math.PI / 2]];
    for (const [axis, fixed, a, b, yaw] of edges) {
      const gaps = plan.gaps.filter(g => (axis === 'x' ? g.z0 < fixed && g.z1 > fixed : g.x0 < fixed && g.x1 > fixed)).map(g => ({ a: axis === 'x' ? g.x0 : g.z0, b: axis === 'x' ? g.x1 : g.z1, y0: g.y0 || 0, y1: Math.min(R.h, g.y1 ?? 2.2) })).filter(g => g.b > a && g.a < b).sort((p, q) => p.a - q.a);
      const at = c => (axis === 'x' ? [c, fixed] : [fixed, c]);
      let s = a;
      for (const g of [...gaps, { a: b, b, y0: 0, y1: 0, end: true }]) {
        const e = Math.max(s, Math.min(g.a, b));
        if (e - s > 0.01) { const [cx, cz] = at((s + e) / 2); span(cx, cz, yaw, e - s, 0, R.h); }
        if (!g.end) {
          const g0 = Math.max(a, g.a), g1 = Math.min(b, g.b), [cx, cz] = at((g0 + g1) / 2);
          if (g.y0 > 0) span(cx, cz, yaw, g1 - g0, 0, g.y0);
          span(cx, cz, yaw, g1 - g0, g.y1, R.h);
        }
        s = Math.max(s, g.b);
      }
    }
    // floor and ceiling
    const w = R.x1 - R.x0, d = R.z1 - R.z0, cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
    const fl = G.plane(w, d);
    for (let i = 0; i < fl.uv.length / 2; i++) { const x = fl.position[i * 3] + cx, z = fl.position[i * 3 + 2] + cz; fl.uv[i * 2] = z; fl.uv[i * 2 + 1] = x; } // (planks along z, like the court)
    (B.floors[R.floor] ||= []).push({ geo: fl, matrix: TR(cx, -0.004, cz) });
    const ce = G.plane(w, d);
    for (let i = 0; i < ce.uv.length / 2; i++) { ce.uv[i * 2] = ce.position[i * 3] + cx; ce.uv[i * 2 + 1] = ce.position[i * 3 + 2] + cz; }
    (B.ceils[R.ceil] ||= []).push({ geo: ce, matrix: M.m4mul(M.m4(), M.m4translation(M.m4(), cx, R.h, cz), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI))) });
  }
  // the doorways' frames and the windows' glass and frames
  for (const g of plan.gaps) {
    const alongX = (g.line || 'z') === 'z', len = alongX ? g.x1 - g.x0 : g.z1 - g.z0, cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2, yaw = alongX ? 0 : Math.PI / 2, y0 = g.y0 || 0, y1 = g.y1 ?? 2.2;
    const fr = B.tier === 'bronze' ? '#6b6f73' : B.tier === 'silver' ? '#2c3540' : '#1c1f24';
    for (const s of [-1, 1]) B.L.metal.push({ geo: G.box(0.1, y1 - y0, 0.3), matrix: M.m4mul(M.m4(), TR(cx, 0, cz, yaw), TR(s * (len / 2 + 0.05), y0 + (y1 - y0) / 2, 0)), color: c4(fr) });
    B.L.metal.push({ geo: G.box(len + 0.2, 0.1, 0.3), matrix: M.m4mul(M.m4(), TR(cx, 0, cz, yaw), TR(0, y1 + 0.05, 0)), color: c4(fr) });
    if (!g.walk) {
      if (y0 > 0) B.L.metal.push({ geo: G.box(len + 0.2, 0.08, 0.34), matrix: M.m4mul(M.m4(), TR(cx, 0, cz, yaw), TR(0, y0 - 0.04, 0)), color: c4(fr) });
      B.L.glass.push({ geo: G.box(len, y1 - y0, 0.02), matrix: M.m4mul(M.m4(), TR(cx, 0, cz, yaw), TR(0, (y0 + y1) / 2, 0)), color: [1, 1, 1, 1] });
      const n = Math.max(1, Math.round(len / 1.6));
      for (let i = 1; i < n; i++) B.L.metal.push({ geo: G.box(0.06, y1 - y0, 0.08), matrix: M.m4mul(M.m4(), TR(cx, 0, cz, yaw), TR(-len / 2 + i * len / n, (y0 + y1) / 2, 0)), color: c4(fr) });
    }
  }
}

// a hung light: a housing and a lit face (wire cage for the old gym)
function highBay(B, x, z, y, kind = 'led') {
  if (kind === 'cage') {
    B.put('metal', G.cylinder(0.3, 0.42, 0.42, 10, { y0: true }), x, y - 0.42, z, '#4a4d50');
    B.put('glow', G.cylinder(0.36, 0.36, 0.02, 10, { y0: true }), x, y - 0.44, z, '#ffeccc');
    for (let i = 0; i < 4; i++) B.put('metal', G.box(0.02, 0.36, 0.76), x, y - 0.62, z, '#2a2c2e', i * Math.PI / 4);
    B.put('metal', G.box(0.03, 0.9, 0.03), x, y + 0.04, z, '#2a2c2e');
  } else if (kind === 'panel') {
    B.put('metal', G.box(1.3, 0.12, 0.6), x, y - 0.06, z, '#2b2e33');
    B.put('glow', G.box(1.2, 0.02, 0.5), x, y - 0.13, z, '#f4f8ff');
  } else {
    B.put('metal', G.cylinder(0.5, 0.56, 0.16, 14, { y0: true }), x, y - 0.16, z, '#2b2e33');
    B.put('glow', G.cylinder(0.5, 0.5, 0.02, 14, { y0: true }), x, y - 0.18, z, '#f4f6ff');
    B.put('metal', G.box(0.03, 1.1, 0.03), x, y + 0.4, z, '#2b2e33');
  }
}
// a folding chair, facing +z before yaw
function chair(B, x, z, yaw, color = '#5d6268') {
  const at = (w, h, d, dx, dy, dz, c) => B.boxAt('metal', w, h, d, x, z, yaw, dx, dy, dz, c);
  at(0.42, 0.04, 0.4, 0, 0.44, 0, color); at(0.42, 0.34, 0.04, 0, 0.62, -0.2, color);
  for (const sx of [-0.19, 0.19]) { at(0.025, 0.46, 0.025, sx, 0, 0.17, '#2a2c2e'); at(0.025, 0.96, 0.025, sx, 0, -0.19, '#2a2c2e'); }
}
// an office desk (facing +z: the side you stand at), with a top, legs or a modesty panel, a drawer pedestal
function desk(B, x, z, yaw, w, d, top, body, list = 'matte') {
  B.boxAt(list, w, 0.05, d, x, z, yaw, 0, 0.72, 0, top);
  B.boxAt(list, 0.45, 0.7, d - 0.06, x, z, yaw, w / 2 - 0.25, 0.02, 0, body);
  B.boxAt(list, 0.05, 0.7, d - 0.06, x, z, yaw, -w / 2 + 0.03, 0.02, 0, body);
  B.boxAt(list, w - 0.1, 0.5, 0.03, x, z, yaw, 0, 0.2, -d / 2 + 0.03, body);
  for (let i = 0; i < 3; i++) B.boxAt('metal', 0.14, 0.02, 0.02, x, z, yaw, w / 2 - 0.25, 0.18 + i * 0.22, d / 2 - 0.02, '#a8adb2');
}
// the clipboard (on a desk top at y), with paper and a clip
function clipboard(B, x, y, z, yaw) {
  B.boxAt('matte', 0.25, 0.012, 0.34, x, z, yaw, 0, y, 0, '#8a6a45');
  B.boxAt('matte', 0.22, 0.004, 0.29, x, z, yaw, 0, y + 0.012, 0.01, '#f2f0ea');
  B.boxAt('metal', 0.1, 0.02, 0.04, x, z, yaw, 0, y + 0.014, -0.15, '#c9cdd2');
  for (let i = 0; i < 6; i++) B.boxAt('matte', 0.16, 0.002, 0.008, x, z, yaw, -0.01, y + 0.017, -0.08 + i * 0.035, '#4a5260');
}
// a monitor (and keyboard) facing +z before yaw, on a desk top at y: old (a beige box) or flat
function monitor(B, x, y, z, yaw, kind = 'flat', lit = '#9fd0ff') {
  if (kind === 'crt') {
    B.boxAt('matte', 0.42, 0.36, 0.4, x, z, yaw, 0, y, -0.06, '#c9c1ad');
    B.L.glow.push({ geo: G.box(0.32, 0.25, 0.01), matrix: M.m4mul(M.m4(), TR(x, 0, z, yaw), TR(0, y + 0.19, 0.145)), color: c4('#4a8fd0') });
  } else {
    B.boxAt('metal', 0.18, 0.02, 0.14, x, z, yaw, 0, y, -0.05, '#1b1d20');
    B.boxAt('metal', 0.04, 0.24, 0.03, x, z, yaw, 0, y, -0.06, '#1b1d20');
    B.boxAt('metal', 0.62, 0.38, 0.03, x, z, yaw, 0, y + 0.2, -0.04, '#121417');
    B.L.glow.push({ geo: G.box(0.58, 0.34, 0.005), matrix: M.m4mul(M.m4(), TR(x, 0, z, yaw), TR(0, y + 0.39, -0.022)), color: c4(lit) });
  }
  B.boxAt('matte', 0.44, 0.02, 0.15, x, z, yaw, 0, y, 0.22, '#2a2c30');
}
// a wall phone / tablet you queue from: a small lit panel on a wall (facing +z before yaw)
function queuePanel(B, x, y, z, yaw, accent) {
  const c = T.canvas(256, 384), g = c.getContext('2d');
  g.fillStyle = '#0d0f12'; g.fillRect(0, 0, 256, 384);
  g.fillStyle = accent; g.fillRect(0, 0, 256, 60);
  g.fillStyle = inkOn(accent); g.font = '900 30px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GAME DAY', 128, 32);
  g.fillStyle = '#e8e3d6'; g.font = '900 54px "Arial Black", Impact, sans-serif'; g.fillText('QUEUE', 128, 170); g.font = '700 28px Arial, sans-serif'; g.fillText('next game', 128, 222);
  g.strokeStyle = accent; g.lineWidth = 6; g.strokeRect(40, 270, 176, 70); g.fillStyle = accent; g.font = '900 30px Arial, sans-serif'; g.fillText('CAPTAIN', 128, 306);
  B.boxAt('metal', 0.4, 0.56, 0.04, x, z, yaw, 0, y - 0.28, 0.02, '#1b1d20');
  B.sign(c, 0.34, 0.5, 0, 0, 0, 0, { lit: 1.2, matrix: M.m4mul(M.m4(), TR(x, 0, z, yaw), TR(0, y, 0.045)) });
}
// the whiteboard on a wall: frame, tray and markers; returns the board (set(data) draws it)
function whiteboardAt(B, at) {
  const { x, y, z, yaw, w, h } = at;
  B.boxAt('metal', w + 0.1, h + 0.1, 0.03, x, z, yaw, 0, y - h / 2 - 0.05, 0.0, '#b9bec4');
  B.boxAt('metal', w * 0.8, 0.03, 0.08, x, z, yaw, 0, y - h / 2 - 0.06, 0.05, '#9aa0a6');
  ['#1f4fa8', '#c8322f', '#1c1d20', '#1f8a4c'].forEach((col, i) => B.boxAt('matte', 0.12, 0.016, 0.016, x, z, yaw, -0.3 + i * 0.17, y - h / 2 - 0.03, 0.06, col));
  const cvs = T.canvas(1024, Math.round(1024 * h / w)), tex = B.ctx.texture(cvs, { wrap: 'clamp' });
  const mat = new Material({ map: tex, color: [1.05, 1.05, 1.05], roughness: 0.25, specular: 0.6 });
  const m = new Mesh(B.ctx.geometry(G.quad(w, h)), mat, { castShadow: false, reflect: false });
  m.matrix = M.m4mul(M.m4(), TR(x, 0, z, yaw), TR(0, y, 0.02));
  B.scene.add(m);
  const board = { cvs, tex, mesh: m, data: null, draws: 0, set(d) { this.data = d; drawWhiteboard(cvs, d); this.draws++; B.ctx.updateTexture?.(tex, cvs); } };
  board.set(null);
  return board;
}
// a wall-mounted goal's bracket (the old gym): its back plate on the wall at z = wallZ, arms out to the board
function wallMount(B, side, wallZ) {
  const bz = side * (COURT.boardZ + 0.05), cy = COURT.boardBottom + COURT.boardH / 2;
  for (const sx of [-0.55, 0.55]) {
    const len = Math.abs(wallZ - bz);
    B.put('metal', G.box(0.08, 0.08, len), sx, cy + 0.32, (wallZ + bz) / 2, '#3b4045');
    B.put('metal', G.box(0.08, 0.08, len), sx, cy - 0.32, (wallZ + bz) / 2, '#3b4045');
    // a brace down to the wall
    const L = Math.hypot(len, 1.6), a = Math.atan2(1.6, len);
    B.L.metal.push({ geo: G.box(0.06, 0.06, L), matrix: M.m4mul(M.m4(), M.m4translation(M.m4(), sx, cy - 0.32 - 0.8, (wallZ + bz) / 2), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, side > 0 ? a : -a))), color: c4('#3b4045') });
  }
  B.put('metal', G.box(1.5, 2.4, 0.08), 0, cy - 0.6, wallZ - side * 0.05, '#2e3236');
}
// a ceiling-hung goal: posts from the ceiling down to the board and braces back
function ceilingMount(B, side, ceilY) {
  const bz = side * (COURT.boardZ + 0.08), top = COURT.boardBottom + COURT.boardH;
  for (const sx of [-0.5, 0.5]) {
    B.put('metal', G.box(0.08, ceilY - top, 0.08), sx, (ceilY + top) / 2, bz, '#3b4045');
    const dz = 2.2 * side, L = Math.hypot(ceilY - top - 0.6, 2.2), a = Math.atan2(2.2, ceilY - top - 0.6);
    B.L.metal.push({ geo: G.box(0.06, L, 0.06), matrix: M.m4mul(M.m4(), M.m4translation(M.m4(), sx, (ceilY + top + 0.6) / 2, bz + dz / 2), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, side > 0 ? a : -a))), color: c4('#3b4045') });
  }
  B.put('metal', G.box(1.2, 0.08, 0.08), 0, top + 0.05, bz, '#3b4045');
}
// take a gym hoop's roll-out stanchion away (buildHoop 'gym' style without a shot clock: glass, marks, frame, pad, rim,
// base, column, arm, net): the old gym's goals hang from the wall and the ceiling instead
export function stripStanchion(h) {
  if (h.meshes.length === 9) h.meshes.splice(5, 3);
  return h;
}

// the court floors (the main court; the Gold clubhouse's shootaround half court too): painted again when the team's look
// changes (paint), so they're apart from the hoops
function courtFloors(B, spec, opts) {
  const main = buildCourt(B.ctx, { ...spec, margin: opts.margin ?? 2.0 }, [0, 0, 0]);
  main.meshes.forEach(m => B.scene.add(m));
  const out = { main: main.floor, half: null, meshes: [...main.meshes] };
  if (opts.shoot) {
    const half = buildCourt(B.ctx, { ...spec, halfOnly: true, margin: 1.6, logo: spec.logo ? { ...spec.logo, size: 1.0 } : undefined, baselineText: 'SHOOTAROUND', sideText: '' }, opts.shoot);
    half.meshes.forEach(m => B.scene.add(m));
    out.half = half.floor; out.meshes.push(...half.meshes);
  }
  return out;
}
// the courts, the hoops, the shootaround court
function courts(B, spec, opts) {
  const ctx = B.ctx, F = courtFloors(B, spec, opts);
  const pad = opts.padColor || '#1c3557';
  const hoops = [1, -1].map(side => buildHoop(ctx, side, 'gym', { padColor: pad, shotClock: false }));
  if (opts.wallMount) hoops.forEach(stripStanchion);
  hoops.forEach(h => h.meshes.forEach(m => B.scene.add(m)));
  const padLin = lin(pad), padMats = new Set();
  const out = { mainCourt: { id: 'pahub-main', name: 'Main court', origin: [0, 0, 0], hoops, format: 5, full: true, floor: F.main }, hoops: [...hoops], courtMeshes: F.meshes };
  if (opts.shoot) {
    const sh = buildHoop(ctx, 1, 'gym', { origin: opts.shoot, padColor: pad, shotClock: false });
    sh.meshes.forEach(m => B.scene.add(m));
    out.shootCourt = { id: 'pahub-shoot', name: 'Shootaround', origin: opts.shoot, hoops: [sh], format: 1, floor: F.half };
    out.hoops.push(sh);
  }
  // (the pads: the hoops' materials in the pad color, so a repaint can recolor them)
  for (const h of out.hoops) for (const m of h.meshes) if (m.material?.color?.every?.((v, i) => Math.abs(v - padLin[i]) < 1e-6)) padMats.add(m.material);
  out.padMats = padMats;
  return out;
}

// ---------------- Bronze: Eastside Middle School ----------------
const SCHOOL_B = { name: 'EASTSIDE MIDDLE', mascot: 'OWLS', color: '#6e2a2f', accent: '#f2e6c8', abbr: 'EMS' };
function dressBronze(B) {
  const { look } = B, gym = B.plan.rooms[0], of = B.plan.rooms[1], H = gym.h;
  // the stage at the south end: a platform, its apron, the proscenium and the curtains drawn back
  const sz0 = gym.z0, sz1 = -16.0, sh = 1.05;
  B.box('matte', 16, sh, sz1 - sz0, 0, 0, (sz0 + sz1) / 2, '#4a3426');
  B.box('matte', 16.1, 0.08, 0.2, 0, sh - 0.04, sz1 + 0.06, '#2a1f18');
  for (let i = 0; i < 8; i++) B.box('matte', 1.9, sh - 0.1, 0.03, -7 + i * 2, 0.02, sz1 + 0.01, i % 2 ? '#3d2b20' : '#45311f');
  B.box('matte', gym.x1 - gym.x0, H - 4.6, 0.3, 0, 4.6, sz1 - 0.15, '#cdbfa6'); // (the proscenium wall over the opening)
  for (const sx of [-1, 1]) B.box('matte', (gym.x1 - gym.x0) / 2 - 8, H, 0.3, sx * (8 + ((gym.x1 - gym.x0) / 2 - 8) / 2), 0, sz1 - 0.15, '#cdbfa6');
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) B.put('cloth', G.box(0.32, 3.5, 0.16), sx * (7.6 - i * 0.28), sh + 1.75, sz1 - 0.5 - (i % 2) * 0.12, SCHOOL_B.color);
  for (let i = 0; i < 14; i++) B.put('cloth', G.box(1.18, 0.7, 0.12), -7.7 + i * 1.18, 4.25, sz1 - 0.38 - (i % 2) * 0.06, mixHex(SCHOOL_B.color, '#000000', 0.15));
  for (let i = 0; i < 16; i++) B.put('cloth', G.box(1.0, 3.5, 0.08), -7.5 + i * 1.0, sh + 1.75, sz0 + 0.3 + (i % 2) * 0.1, mixHex(SCHOOL_B.color, '#000000', 0.35)); // (the back curtain, in folds)
  B.box('matte', 15.8, 0.1, 2.6, 0, sh, (sz0 + sz1) / 2, '#5a4030'); // (the stage floor)
  B.light(0, 4.0, sz1 - 0.6, 9, 2.4, [1, 0.86, 0.66]);
  B.solid(-8.1, 8.1, sz0, sz1 + 0.15, sh);
  B.solid(gym.x0, -8.0, sz0, sz1, H); B.solid(8.0, gym.x1, sz0, sz1, H); // (behind the proscenium's sides)
  // the north wall: pads under the goal, the team's paper banner, the school's pennants
  for (let i = 0; i < 4; i++) B.box('matte', 1.9, 1.8, 0.08, -3.9 + i * 2, 0.15, gym.z1 - 0.05, i % 2 ? '#1f3a68' : '#22406f');
  B.sign(paperBanner(look), 6.4, 2.4, 0, 5.05, gym.z1 - 0.06, Math.PI, { cloth: true });
  const pn = [['EMS', 'GIRLS', 'VB 2016'], ['EMS', 'TRACK', 'DIST. 2'], ['EMS', 'BOYS BB', '8TH GR.']];
  pn.forEach((l, i) => B.sign(pennant(i % 2 ? '#f2e6c8' : SCHOOL_B.color, i % 2 ? SCHOOL_B.color : '#f2e6c8', l), 1.0, 2.0, gym.x0 + 0.06, 4.45, -6 + i * 5, Math.PI / 2, { cloth: true, alphaTest: 0.5 }));
  // the bleachers: pulled out on the west, folded against the east wall
  B.L.matte.push(...PR.bleacher(gym.x0 + 2.3, -1.5, Math.PI / 2, 18, 4, '#5d4330', '#9b7650'));
  B.solid(gym.x0, gym.x0 + 2.45, -10.6, 7.6, 1.9);
  for (let r = 0; r < 4; r++) B.box('matte', 0.16, 3.1 - r * 0.2, 18, gym.x1 - 0.12 - r * 0.17, 0.05, -1.5, r % 2 ? '#7a5a3c' : '#8c6a48');
  for (let k = 0; k < 9; k++) B.box('matte', 0.03, 0.05, 18, gym.x1 - 0.74, 0.35 + k * 0.32, -1.5, '#4a3524'); // (the seat edges of the folded rows)
  B.box('metal', 0.7, 0.12, 18.2, gym.x1 - 0.36, 0, -1.5, '#2a2c2e');
  B.solid(gym.x1 - 0.8, gym.x1, -10.6, 7.6, 3.2);
  // the scoreboard over the folded bleachers (old, red digits)
  const sbc = scoreboardCanvas({ home: look.abbr, guest: 'GUEST', hs: 0, gs: 0, time: '8:00', mid: 'PERIOD 1', foot: SCHOOL_B.name, footColor: '#f2e6c8', trim: SCHOOL_B.color });
  B.box('metal', 0.3, 1.6, 4.4, gym.x1 - 0.2, 4.25, -1.5, '#15171a');
  B.sign(sbc, 4.1, 1.5, gym.x1 - 0.36, 5.05, -1.5, -Math.PI / 2, { lit: 1.15 });
  // clerestory windows (wired glass) high on the west wall, light coming in
  for (let i = 0; i < 5; i++) {
    const z = -12 + i * 5.5;
    B.put('glow', G.box(0.04, 1.1, 3.2), gym.x0 + 0.03, 6.55, z, '#c9d9e6');
    for (let k = 0; k < 4; k++) B.put('metal', G.box(0.06, 1.2, 0.05), gym.x0 + 0.06, 6.55, z - 1.6 + k * 1.07, '#3a3d40');
    B.put('metal', G.box(0.07, 0.06, 3.3), gym.x0 + 0.06, 6.0, z, '#3a3d40');
  }
  // bar joists and caged lights; one of them flickers
  for (let z = -15; z <= 14; z += 4.8) {
    B.put('metal', G.box(gym.x1 - gym.x0, 0.06, 0.06), 0, H - 0.25, z, '#5a5e62');
    B.put('metal', G.box(gym.x1 - gym.x0, 0.06, 0.06), 0, H - 0.75, z, '#5a5e62');
    for (let k = 0; k < 14; k++) B.L.metal.push({ geo: G.box(0.04, 0.68, 0.04), matrix: M.m4mul(M.m4(), M.m4translation(M.m4(), -10.5 + k * 1.6, H - 0.5, z), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, k % 2 ? 0.7 : -0.7))), color: c4('#5a5e62') });
  }
  for (const z of [-9.6, 0, 9.6]) for (const x of [-4.5, 4.5]) highBay(B, x, z, H - 0.8, 'cage');
  const flick = B.light(4.5, H - 1.4, 9.6, 17, 6.2, [1, 0.94, 0.8]);
  B.light(-4.5, H - 1.4, 9.6, 17, 6.2, [1, 0.94, 0.8]);
  B.light(-4.5, H - 1.4, 0, 17, 6.2, [1, 0.94, 0.8]); B.light(4.5, H - 1.4, 0, 17, 6.2, [1, 0.94, 0.8]);
  B.light(-4.5, H - 1.4, -9.6, 17, 6.0, [1, 0.94, 0.8]); B.light(4.5, H - 1.4, -9.6, 17, 6.0, [1, 0.94, 0.8]);
  let ft = 0;
  B.anim.push(dt => { ft += dt; const k = Math.sin(ft * 0.7) > 0.86 ? (Math.sin(ft * 47) > 0 ? 0.35 : 1) : 1; flick.intensity = 6.2 * k; });
  // the exit doors (double, push bars, an EXIT sign) in the east wall
  const ex = B.plan.exit.door;
  B.boxAt('matte', ex.w, 2.2, 0.08, ex.x, ex.z, ex.yaw, 0, 0, 0.04, '#5a6168');
  for (const s of [-1, 0, 1]) B.boxAt('metal', 0.08, 2.25, 0.12, ex.x, ex.z, ex.yaw, s * ex.w / 2, 0, 0.06, '#2c3035');
  for (const s of [-0.55, 0.55]) B.boxAt('metal', 0.8, 0.06, 0.08, ex.x, ex.z, ex.yaw, s, 1.0, 0.12, '#b9bec4');
  for (const s of [-0.55, 0.55]) B.L.glow.push({ geo: G.box(0.22, 0.5, 0.01), matrix: M.m4mul(M.m4(), TR(ex.x, 0, ex.z, ex.yaw), TR(s, 1.65, 0.09)), color: c4('#a9c6d8') });
  B.sign(T.banner('EXIT', { w: 512, h: 160, bg: '#300808', color: '#ff4a3a', size: 110 }), 0.9, 0.3, 0, 0, 0, 0, { lit: 2.2, matrix: M.m4mul(M.m4(), TR(ex.x, 0, ex.z, ex.yaw), TR(0, 2.6, 0.1)) });
  // a ball cart in the north-west corner, a drinking fountain, a mop bucket, folding chairs along the east wall
  B.L.metal.push(...PR.ballRack(-9.3, 13.9, 0));
  for (let i = 0; i < 4; i++) for (const y of [0.7, 1.1]) B.put('matte', G.sphere(0.12, 10, 8), -9.8 + i * 0.33, y, 13.9, '#c8601f');
  B.solid(-10.1, -8.5, 13.6, 14.2, 1.1);
  B.box('metal', 0.5, 0.9, 0.36, 10.85, 0, 11.4, '#9aa0a6'); B.box('metal', 0.44, 0.06, 0.3, 10.8, 0.9, 11.4, '#c9cdd2');
  B.solid(10.5, 11.2, 11.1, 11.7, 1);
  B.put('matte', G.cylinder(0.24, 0.2, 0.4, 10, { y0: true }), 10.6, 0, 13.9, '#d8b422'); B.put('metal', G.box(0.03, 1.2, 0.03), 10.6, 0.6, 13.9, '#b0763a');
  for (let i = 0; i < 4; i++) chair(B, 10.4, 9.0 - i * 0.6, -Math.PI / 2, '#5d6268');
  // the worn floor
  const scuff = B.ctx.texture(scuffCanvas(), { wrap: 'clamp' });
  const sm = new Mesh(B.ctx.geometry(G.plane(gym.x1 - gym.x0, sz1 - gym.z0 + (gym.z1 - sz1))), new Material({ map: scuff, color: [1, 1, 1], roughness: 0.7, blend: 'alpha' }), { castShadow: false, reflect: false });
  sm.matrix = TR(0, 0.004, (gym.z0 + gym.z1) / 2); sm.order = 1; B.scene.add(sm);
  wallMount(B, 1, gym.z1); ceilingMount(B, -1, H);
  // ---- the coach's office: little, cluttered ----
  const o = B.plan.office;
  desk(B, 7.38, 17.4, -Math.PI / 2, 2.0, 0.78, '#8b8f94', '#6f7378', 'metal');
  B.solid(6.95, 7.8, 16.35, 18.45, 0.8);
  monitor(B, 7.45, 0.745, 16.85, -Math.PI / 2, 'crt');
  clipboard(B, 7.25, 0.745, 18.0, -Math.PI / 2 + 0.2);
  chair(B, 6.25, 17.4, Math.PI / 2, '#3c4a5a');
  B.box('metal', 0.5, 1.33, 0.62, 3.0, 0, 18.95, '#7d8288'); for (let i = 0; i < 3; i++) B.box('metal', 0.3, 0.02, 0.02, 3.0, 0.32 + i * 0.42, 18.62, '#c9cdd2');
  B.solid(2.6, 3.3, 18.6, 19.5, 1.4);
  const cork = T.canvas(512, 384), cg = cork.getContext('2d'), r = new RNG(8);
  cg.fillStyle = '#b48a5a'; cg.fillRect(0, 0, 512, 384);
  for (let i = 0; i < 9; i++) { cg.fillStyle = ['#f6f2e8', '#fff3a8', '#cfe8ff', '#ffd6d6'][i % 4]; cg.save(); cg.translate(40 + (i % 3) * 160 + r.next() * 20, 50 + Math.floor(i / 3) * 120 + r.next() * 10); cg.rotate(r.range(-0.1, 0.1)); cg.fillRect(0, 0, 120, 90); cg.fillStyle = 'rgba(40,40,60,0.6)'; for (let k = 0; k < 5; k++) cg.fillRect(10, 14 + k * 14, 70 + r.next() * 30, 3); cg.restore(); }
  B.sign(cork, 1.4, 1.0, of.x0 + 0.03, 1.9, 18.0, Math.PI / 2, { cloth: true });
  queuePanel(B, of.x0 + 0.02, 1.45, o.queue.z, Math.PI / 2, look.primary);
  // the window from the office onto the gym gets blinds
  for (let i = 0; i < 8; i++) B.box('metal', 1.1, 0.012, 0.05, 6.85, 1.2 + i * 0.11, 15.78, '#d8d6cf');
  highBay(B, 5.2, 17.6, of.h, 'panel');
  B.light(5.2, of.h - 0.4, 17.6, 6.5, 3.2, [0.96, 1, 0.98]);
  return { flick };
}

// ---------------- Silver: Northgate High ----------------
const SCHOOL_S = { name: 'NORTHGATE', mascot: 'STALLIONS', color: '#1f3a68', accent: '#e8c15a', abbr: 'NG' };
function dressSilver(B) {
  const { look } = B, gym = B.plan.rooms[0], of = B.plan.rooms[1], H = gym.h;
  // bleachers both sides, seven rows
  for (const s of [-1, 1]) {
    B.L.matte.push(...PR.bleacher(s * 9.9, -0.5, s < 0 ? Math.PI / 2 : -Math.PI / 2, 22, 7, '#6b4a2e', '#b58654'));
    B.solid(s < 0 ? -13.8 : 9.75, s < 0 ? -9.75 : 13.8, -11.6, 10.6, 3.4);
    for (const z of [-11.4, 10.4]) B.box('metal', 0.06, 1.0, 0.06, s * 9.95, 0.42, z, '#c9cdd2'); // (rail ends)
  }
  // the walls' painted lettering over the bleachers: the school's name and its mascot
  const wl = T.canvas(2048, 256), wg = wl.getContext('2d'); wg.clearRect(0, 0, 2048, 256); wg.fillStyle = SCHOOL_S.color; wg.font = '900 190px "Arial Black", Impact, sans-serif'; wg.textAlign = 'center'; wg.textBaseline = 'middle'; wg.fillText(SCHOOL_S.name, 1024, 128);
  B.sign(wl, 14, 1.75, gym.x0 + 0.04, 6.1, -0.5, Math.PI / 2, { cloth: true, alphaTest: 0.4 });
  const wm = T.canvas(2048, 256), mg = wm.getContext('2d'); mg.clearRect(0, 0, 2048, 256); mg.fillStyle = SCHOOL_S.color; mg.font = '900 190px "Arial Black", Impact, sans-serif'; mg.textAlign = 'center'; mg.textBaseline = 'middle'; mg.fillText(SCHOOL_S.mascot, 1024, 128);
  B.sign(wm, 14, 1.75, gym.x1 - 0.04, 6.1, -0.5, -Math.PI / 2, { cloth: true, alphaTest: 0.4 });
  // championship banners in the rafters (north and south), the team's banners hung beside them
  const champs = [['NORTHGATE', 'DISTRICT', 'CHAMPS 2014'], ['NORTHGATE', 'STATE', 'QUALIFIER 11'], ['NORTHGATE', 'CONF.', 'CHAMPS 2019'], ['NORTHGATE', 'REGIONAL', 'FINALS 2022']];
  champs.forEach((l, i) => B.sign(pennant(i % 2 ? SCHOOL_S.accent : SCHOOL_S.color, i % 2 ? SCHOOL_S.color : SCHOOL_S.accent, l), 1.6, 3.2, [-12.4, -8.4, 8.4, 12.4][i], 7.6, gym.z1 - 0.08, Math.PI, { cloth: true, alphaTest: 0.5 }));
  const tb = teamBanner(look, 'PRO-AM · SILVER');
  for (const x of [-11.5, 11.5]) B.sign(tb, 2.2, 4.4, x, 6.2, gym.z0 + 0.08, 0, { cloth: true });
  // the scoreboard on the north wall over the goal
  B.sign(scoreboardCanvas({ home: look.abbr, guest: 'GUEST', hs: 0, gs: 0, time: '12:00', mid: 'PERIOD 1', foot: `${SCHOOL_S.name} ${SCHOOL_S.mascot}`, footColor: SCHOOL_S.accent, trim: SCHOOL_S.color, digit: '#ffb03a' }), 6.0, 2.25, 0, 7.6, gym.z1 - 0.18, Math.PI, { lit: 1.2 });
  B.box('metal', 6.4, 2.6, 0.12, 0, 6.3, gym.z1 - 0.08, '#101215');
  // wall pads at both ends
  for (const z of [gym.z1 - 0.05, gym.z0 + 0.05]) for (let i = -3; i <= 3; i++) B.box('matte', 1.9, 1.8, 0.08, i * 2, 0.15, z, SCHOOL_S.color);
  // high clerestory windows east and west
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
    const z = -15 + i * 6, x = s < 0 ? gym.x0 + 0.03 : gym.x1 - 0.03;
    B.put('glow', G.box(0.04, 1.3, 4.0), x, 8.7, z, '#cfe0ec');
    for (let k = 0; k < 5; k++) B.put('metal', G.box(0.06, 1.4, 0.06), x + s * -0.03, 8.7, z - 2 + k, '#2c3540');
  }
  // trusses and LED high-bays
  for (let z = -16; z <= 16; z += 6.4) {
    B.put('metal', G.box(gym.x1 - gym.x0, 0.3, 0.22), 0, H - 1.1, z, '#2e3238');
    B.put('metal', G.box(gym.x1 - gym.x0, 0.08, 0.08), 0, H - 0.3, z, '#2e3238');
  }
  for (const z of [-9.6, 0, 9.6]) for (const x of [-5.5, 5.5]) highBay(B, x, z, H - 1.2);
  for (const z of [-9.6, 0, 9.6]) for (const x of [-5.5, 5.5]) B.light(x, H - 2.0, z, 19, 7.2, [1, 0.99, 0.96]);
  // the exit: double doors in the south wall with an EXIT sign and a lit hallway beyond the glass
  const ex = B.plan.exit.door;
  B.boxAt('matte', ex.w, 2.25, 0.08, ex.x, ex.z, ex.yaw, 0, 0, 0.04, '#2f4a6e');
  for (const s of [-1, 0, 1]) B.boxAt('metal', 0.08, 2.3, 0.12, ex.x, ex.z, ex.yaw, s * ex.w / 2, 0, 0.06, '#1c232c');
  for (const s of [-0.6, 0.6]) { B.boxAt('metal', 0.9, 0.06, 0.08, ex.x, ex.z, ex.yaw, s, 1.0, 0.12, '#c9cdd2'); B.L.glow.push({ geo: G.box(0.3, 0.7, 0.01), matrix: M.m4mul(M.m4(), TR(ex.x, 0, ex.z, ex.yaw), TR(s, 1.6, 0.09)), color: c4('#e8e2c8') }); }
  B.sign(T.banner('EXIT', { w: 512, h: 160, bg: '#300808', color: '#ff4a3a', size: 110 }), 0.9, 0.3, 0, 0, 0, 0, { lit: 2.2, matrix: M.m4mul(M.m4(), TR(ex.x, 0, ex.z, ex.yaw), TR(0, 2.65, 0.1)) });
  // a ball rack at the north end, a scorer's table on the east sideline's south end, the trophy case by the exit
  B.L.metal.push(...PR.ballRack(5.2, 15.6, 0));
  for (let i = 0; i < 4; i++) for (const y of [0.7, 1.1]) B.put('matte', G.sphere(0.12, 10, 8), 4.7 + i * 0.33, y, 15.6, '#c8601f');
  B.solid(4.4, 6.0, 15.3, 15.9, 1.1);
  B.box('matte', 3.2, 0.78, 0.7, -2.2, 0, -16.1, '#22324a'); B.box('matte', 3.3, 0.04, 0.78, -2.2, 0.78, -16.1, '#d9d4c8');
  B.solid(-3.85, -0.55, -16.5, -15.7, 0.85);
  for (const x of [-3.2, -1.2]) chair(B, x, -16.8, 0, '#2f3f57');
  // the trophy case on the south wall
  B.box('matte', 3.6, 0.9, 0.55, -13.2, 0, gym.z0 + 0.3, '#4a3626');
  B.put('glass', G.box(3.5, 1.3, 0.5), -13.2, 1.55, gym.z0 + 0.3);
  B.box('matte', 3.6, 0.1, 0.56, -13.2, 2.2, gym.z0 + 0.3, '#4a3626');
  for (let i = 0; i < 6; i++) { const x = -14.6 + i * 0.55, hh = 0.25 + (i % 3) * 0.12; B.put('metal', G.cylinder(0.08, 0.05, hh, 10, { y0: true }), x, 0.92, gym.z0 + 0.3, '#d8b04a'); B.put('metal', G.sphere(0.07, 8, 6), x, 0.92 + hh + 0.05, gym.z0 + 0.3, '#d8b04a'); }
  B.solid(-15.1, -11.3, gym.z0, gym.z0 + 0.6, 2.3);
  // ---- the office: bigger, with a window onto the floor ----
  const o = B.plan.office, oz = of.z0;
  desk(B, 12.65, -22.4, Math.PI, 2.4, 0.85, '#6b4a30', '#4e3624');
  B.solid(11.4, 13.9, -22.85, -21.95, 0.8);
  monitor(B, 12.0, 0.745, -22.45, Math.PI, 'flat');
  clipboard(B, 13.3, 0.745, -22.25, Math.PI + 0.25);
  chair(B, 11.1, -23.1, 0.5, '#20242a');
  // couch, a TV on the west wall with game film, a trophy shelf
  B.L.matte.push(...PR.couch(8.0, -23.4, -Math.PI / 2, '#3a3f47', 2.2));
  B.solid(7.5, 8.55, -24.55, -22.25, 1);
  const tv = T.canvas(512, 288), tg = tv.getContext('2d');
  tg.fillStyle = '#7a5a32'; tg.fillRect(0, 0, 512, 288); tg.strokeStyle = '#efe8d8'; tg.lineWidth = 3; tg.strokeRect(40, 30, 432, 228); tg.beginPath(); tg.arc(256, 144, 40, 0, Math.PI * 2); tg.stroke();
  for (let i = 0; i < 10; i++) { tg.fillStyle = i < 5 ? look.primary : '#e8e8e8'; tg.beginPath(); tg.arc(90 + (i * 37) % 340, 70 + (i * 53) % 160, 7, 0, Math.PI * 2); tg.fill(); }
  tg.fillStyle = 'rgba(0,0,0,0.6)'; tg.fillRect(0, 250, 512, 38); tg.fillStyle = '#fff'; tg.font = '700 22px Arial'; tg.fillText('GAME FILM · 2ND QTR', 16, 270);
  B.box('metal', 0.06, 0.9, 1.55, of.x0 + 0.04, 1.15, -23.4, '#111');
  B.sign(tv, 1.45, 0.82, of.x0 + 0.08, 1.6, -23.4, Math.PI / 2, { lit: 1.1 });
  B.box('matte', 2.2, 0.04, 0.3, 6.4, 1.7, oz + 0.16, '#4e3624'); B.box('matte', 2.2, 0.04, 0.3, 6.4, 2.15, oz + 0.16, '#4e3624');
  for (let i = 0; i < 4; i++) { B.put('metal', G.cylinder(0.06, 0.04, 0.22, 8, { y0: true }), 5.6 + i * 0.5, 1.72, oz + 0.16, '#c8a24a'); B.put('metal', G.sphere(0.05, 8, 6), 5.6 + i * 0.5, 1.98, oz + 0.16, '#c8a24a'); }
  queuePanel(B, o.queue.x, 1.45, of.z1 - 0.02, Math.PI, look.primary);
  B.sign(teamBanner(look, 'PRO-AM'), 0.9, 1.8, of.x1 - 0.04, 1.7, -22.2, -Math.PI / 2, { cloth: true });
  for (let i = 0; i < 10; i++) B.box('metal', 3.0, 0.012, 0.05, 12.35, 1.05 + i * 0.12, -19.68, '#d8d6cf');
  highBay(B, 7.5, -22.7, of.h, 'panel'); highBay(B, 11.7, -22.7, of.h, 'panel');
  B.light(9.6, of.h - 0.4, -22.7, 8.5, 3.6, [0.98, 1, 1]);
  B.light(-8.6, 3.2, -17.4, 8, 2.0, [1, 0.95, 0.85]);
  return {};
}

// ---------------- Gold and Platinum: the clubhouse ----------------
function dressGold(B, plat) {
  const { look } = B, hall = B.plan.rooms[0], of = B.plan.rooms[1], H = hall.h;
  // the logo wall behind the north goal (a canvas: paint() redraws it), the LED ribbon round the hall
  const logoC = T.canvas(1024, 1024), logoS = B.sign(logoC, 7.2, 7.2, 0, 7.0, hall.z1 - 0.08, Math.PI, { lit: 1.0 });
  const ribbonC = T.canvas(2048, 64), ribbon = { cvs: ribbonC, tex: B.ctx.texture(ribbonC, { wrap: 'repeat' }) };
  const ribbonMat = new Material({ map: ribbon.tex, color: [1.7, 1.7, 1.7], shading: 'unlit', fog: false, uvScale: [1 / 18, 1] });
  const rparts = [];
  for (const [x0, z0, x1, z1, yaw] of [[hall.x0, hall.z0 + 0.06, hall.x1, hall.z0 + 0.06, 0], [hall.x1, hall.z1 - 0.06, hall.x0, hall.z1 - 0.06, Math.PI], [hall.x0 + 0.06, hall.z1, hall.x0 + 0.06, hall.z0, Math.PI / 2], [hall.x1 - 0.06, hall.z0, hall.x1 - 0.06, hall.z1, -Math.PI / 2]]) {
    const len = Math.hypot(x1 - x0, z1 - z0), g = G.quad(len, 0.55, { bottom: true });
    for (let i = 0; i < 4; i++) { g.uv[i * 2] = g.position[i * 3] + len / 2; }
    rparts.push({ geo: g, matrix: TR((x0 + x1) / 2, 4.2, (z0 + z1) / 2, yaw) });
  }
  const ribbonMesh = new Mesh(B.ctx.geometry(G.merge(rparts, false)), ribbonMat, { castShadow: false, reflect: false });
  B.scene.add(ribbonMesh);
  const zc = (hall.z0 + hall.z1) / 2;
  for (const [x, z, w, d, band] of [[(hall.x0 + hall.x1) / 2, hall.z0 + 0.04, hall.x1 - hall.x0, 0.06, false], [(hall.x0 + hall.x1) / 2, hall.z1 - 0.04, hall.x1 - hall.x0, 0.06, true], [hall.x0 + 0.04, zc, 0.06, hall.z1 - hall.z0, false], [hall.x1 - 0.04, zc, 0.06, hall.z1 - hall.z0, true]]) {
    B.put('trim', G.box(w, 0.06, d), x, 4.17, z); B.put('trim', G.box(w, 0.06, d), x, 4.78, z);
    if (band) B.put('teamA', G.box(w, 0.9, d), x, 0.45, z); // (a base band in the team's color, on the walls without doors)
  }
  // the hanging scoreboard over center court: four faces
  const sbC = scoreboardCanvas({ home: look.abbr, guest: 'GUEST', hs: 0, gs: 0, time: '10:00', mid: 'SHOOTAROUND', foot: look.name.toUpperCase(), footColor: look.secondary, trim: look.primary, digit: '#ffffff', clock: look.secondary });
  const sbTex = B.ctx.texture(sbC, { wrap: 'clamp' }), sbMat = new Material({ map: sbTex, color: [1.25, 1.25, 1.25], shading: 'unlit', fog: false });
  const sbParts = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(yaw => ({ geo: G.quad(3.4, 1.28), matrix: M.m4mul(M.m4(), TR(0, 0, 0, yaw), TR(0, 8.2, 1.78)) }));
  B.scene.add(new Mesh(B.ctx.geometry(G.merge(sbParts, false)), sbMat, { castShadow: false, reflect: false }));
  B.box('metal', 3.5, 1.5, 3.5, 0, 7.45, 0, '#101215');
  B.box('teamA', 3.56, 0.14, 3.56, 0, 7.36, 0); B.box('trim', 3.56, 0.08, 3.56, 0, 8.95, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.put('metal', G.box(0.03, H - 9.0, 0.03), sx * 1.4, (H + 9.0) / 2, sz * 1.4, '#3a3d42');
  // trusses and lights: four over the main court, two over the shootaround, the office's and the lounge's
  for (let z = -16; z <= 16; z += 6.4) B.put('metal', G.box(hall.x1 - hall.x0, 0.4, 0.3), (hall.x0 + hall.x1) / 2, H - 1.2, z, '#24272c');
  for (const z of [-11, -3.6, 3.6, 11]) for (const x of [-5, 5, 18, 25]) highBay(B, x, z, H - 1.4);
  for (const [x, z] of [[-4.5, -7], [4.5, -7], [-4.5, 7], [4.5, 7], [21.5, 5]]) B.light(x, H - 2.2, z, x > 15 ? 21 : 19, x > 15 ? 7.6 : 7.6, plat ? [0.97, 0.99, 1] : [1, 0.97, 0.92]);
  B.light(22.5, 3.0, -12.5, 10, 3.2, [1, 0.9, 0.74]);
  // the walk-out: glass double doors in the west wall, a lit sign naming the home park
  const wo = B.plan.walkout.door, park = proamInfo(B.park) || { name: 'Home Court' };
  B.boxAt('metal', wo.w + 0.4, 0.3, 0.24, wo.x, wo.z, wo.yaw, 0, 2.62, 0.08, '#15171a'); // (the head)
  for (const s of [-1, 1]) B.boxAt('metal', 0.2, 2.62, 0.24, wo.x, wo.z, wo.yaw, s * (wo.w / 2 + 0.1), 0, 0.08, '#15171a'); // (the jambs)
  B.L.glow.push({ geo: G.box(wo.w, 2.6, 0.01), matrix: M.m4mul(M.m4(), TR(wo.x, 0, wo.z, wo.yaw), TR(0, 1.31, 0.02)), color: c4('#e9b98a') }); // (the evening outside, through the glass)
  B.L.glass.push({ geo: G.box(wo.w, 2.6, 0.03), matrix: M.m4mul(M.m4(), TR(wo.x, 0, wo.z, wo.yaw), TR(0, 1.31, 0.1)), color: [1, 1, 1, 1] });
  for (const s of [-1, 0, 1]) B.boxAt('trim', 0.07, 2.6, 0.08, wo.x, wo.z, wo.yaw, s * wo.w / 2, 0, 0.13);
  for (const s of [-0.18, 0.18]) B.boxAt('trim', 0.04, 1.0, 0.06, wo.x, wo.z, wo.yaw, s, 0.7, 0.2); // (the pull handles)
  const woC = T.banner(park.name.toUpperCase(), { w: 1024, h: 192, bg: '#0d0f12', color: look.secondary, stripe: look.primary, sub: 'HOME COURT · WALK OUT', size: 84 });
  const woSign = B.sign(woC, 3.4, 0.64, 0, 0, 0, 0, { lit: 1.6, matrix: M.m4mul(M.m4(), TR(wo.x, 0, wo.z, wo.yaw), TR(0, 3.3, 0.12)) });
  // the exit door (back where you came from)
  const ex = B.plan.exit.door;
  B.boxAt('matte', ex.w, 2.3, 0.08, ex.x, ex.z, ex.yaw, 0, 0, 0.04, '#23262b');
  for (const s of [-1, 1]) B.boxAt('trim', 0.08, 2.35, 0.12, ex.x, ex.z, ex.yaw, s * ex.w / 2, 0, 0.06);
  B.boxAt('trim', 0.05, 0.9, 0.06, ex.x, ex.z, ex.yaw, 0.6, 0.7, 0.12);
  B.sign(T.banner('EXIT', { w: 512, h: 160, bg: '#300808', color: '#ff4a3a', size: 110 }), 0.9, 0.3, 0, 0, 0, 0, { lit: 2.2, matrix: M.m4mul(M.m4(), TR(ex.x, 0, ex.z, ex.yaw), TR(0, 2.7, 0.1)) });
  // banners: the team's on the west and east walls (Platinum: its crest too)
  const tbC = teamBanner(look, plat ? 'PLATINUM' : 'GOLD'), tbTex = B.ctx.texture(tbC, { wrap: 'clamp' }), tbMat = new Material({ map: tbTex, roughness: 0.9, shading: 'cloth' });
  const tbParts = [];
  for (const z of [-12, 8]) tbParts.push({ geo: G.quad(2.6, 5.2), matrix: TR(hall.x0 + 0.08, 7.6, z, Math.PI / 2) });
  for (const z of [-12, 12]) tbParts.push({ geo: G.quad(2.6, 5.2), matrix: TR(hall.x1 - 0.08, 7.6, z, -Math.PI / 2) });
  B.scene.add(new Mesh(B.ctx.geometry(G.merge(tbParts, false)), tbMat, { castShadow: false, reflect: false }));
  if (plat) {
    const crest = T.canvas(512, 512), cg = crest.getContext('2d');
    cg.clearRect(0, 0, 512, 512); cg.fillStyle = '#dfe6ec'; T.drawLogo(cg, { shape: 'diamond', color: '#9fb0c0', accent: '#f4f8fb', text: 'PLAT' }, 256, 256, 220);
    for (const x of [-9, 9]) B.sign(crest, 2.6, 2.6, x, 8.6, hall.z1 - 0.1, Math.PI, { lit: 1.3, alphaTest: 0.4 });
    for (const x of [-12, 31]) B.put('glow', G.box(0.04, 0.05, hall.z1 - hall.z0), x === -12 ? hall.x0 + 0.05 : hall.x1 - 0.05, 5.1, 0, '#cfe4ff');
  }
  // the lounge between the shootaround and the office: couches facing a big screen, a trophy case, plants
  B.L.matte.push(...PR.couch(19, -10.6, 0, '#2b2f36', 3.0), ...PR.couch(25.4, -10.6, 0, '#2b2f36', 3.0));
  B.solid(17.3, 20.7, -11.1, -10.1, 1); B.solid(23.7, 27.1, -11.1, -10.1, 1);
  B.box('matte', 2.2, 0.4, 0.9, 22.2, 0, -8.9, '#3a2c22'); B.solid(21.1, 23.3, -9.35, -8.45, 0.45);
  const tvC = T.canvas(1024, 576), tg = tvC.getContext('2d');
  tg.fillStyle = look.primary; tg.fillRect(0, 0, 1024, 576); T.drawLogo(tg, { shape: logoShape(look.logo), color: mixHex(look.primary, '#000000', 0.25), accent: look.secondary, text: look.abbr }, 512, 250, 170);
  tg.fillStyle = look.secondary; tg.font = '900 64px "Arial Black", Impact, sans-serif'; tg.textAlign = 'center'; tg.fillText(look.name.toUpperCase(), 512, 500);
  const tvS = B.sign(tvC, 4.2, 2.36, 22.2, 2.4, -19.4, 0, { lit: 1.15 });
  B.box('metal', 4.4, 2.5, 0.1, 22.2, 1.17, -19.45, '#0d0e10');
  B.box('matte', 4.6, 0.55, 0.5, 22.2, 0, -19.6, '#1d2024'); B.solid(19.9, 24.5, -20, -19.3, 0.6);
  // trophy case along the hall's south wall
  B.box('matte', 6.4, 0.9, 0.6, 5, 0, hall.z0 + 0.32, '#1d2024');
  B.put('glass', G.box(6.3, 1.6, 0.55), 5, 1.7, hall.z0 + 0.32);
  B.box('trim', 6.4, 0.08, 0.6, 5, 2.5, hall.z0 + 0.32);
  for (let i = 0; i < 9; i++) { const x = 2.2 + i * 0.7, hh = 0.3 + (i % 3) * 0.14; B.put('trim', G.cylinder(0.1, 0.06, hh, 12, { y0: true }), x, 0.92, hall.z0 + 0.32); B.put('trim', G.sphere(0.09, 10, 8), x, 0.92 + hh + 0.06, hall.z0 + 0.32); }
  B.solid(1.7, 8.3, hall.z0, hall.z0 + 0.65, 2.6);
  for (const [x, z] of [[-11.2, -19.2], [12.6, -19.2], [30.2, -19.2], [-11.2, 17.2]]) { B.put('matte', G.cylinder(0.32, 0.26, 0.6, 12, { y0: true }), x, 0, z, '#1d2024'); B.L.matte.push(...PR.tree(x, z, 0.3, new RNG(Math.round(x * 7 + z)), '#3f6b3a')); B.solid(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 1.4); }
  // a ball rack by each court
  for (const [x, z] of [[10.9, 14.6], [13.2, 5]]) { B.L.metal.push(...PR.ballRack(x, z, Math.PI / 2)); for (let i = 0; i < 4; i++) for (const y of [0.7, 1.1]) B.put('matte', G.sphere(0.12, 10, 8), x, y, z - 0.5 + i * 0.33, '#c8601f'); B.solid(x - 0.3, x + 0.3, z - 0.8, z + 0.8, 1.1); }
  // ---- the office: large, a glass front onto the lounge ----
  const o = B.plan.office;
  desk(B, 24.7, -26.2, Math.PI, 3.0, 1.0, '#5a3d28', '#3b2a1e');
  B.solid(23.1, 26.3, -26.75, -25.65, 0.8);
  monitor(B, 23.65, 0.745, -26.3, Math.PI, 'flat', '#9fd0ff'); monitor(B, 24.35, 0.745, -26.3, Math.PI, 'flat', '#b9e0ff');
  clipboard(B, 25.6, 0.745, -26.0, Math.PI + 0.2);
  chair(B, 27.0, -27.4, -0.6, '#1b1d20');
  for (const x of [23.9, 25.5]) chair(B, x, -24.6, Math.PI, '#3a3f47');
  // the rug with the team's logo, the couch and TV wall at the west end, the bookshelf of trophies
  const rugC = T.canvas(512, 512), rg = rugC.getContext('2d');
  rg.fillStyle = mixHex(look.primary, '#111111', 0.55); rg.fillRect(0, 0, 512, 512); rg.strokeStyle = look.secondary; rg.lineWidth = 10; rg.strokeRect(20, 20, 472, 472);
  T.drawLogo(rg, { shape: logoShape(look.logo), color: look.primary, accent: look.secondary, text: look.abbr }, 256, 256, 150);
  const rug = new Mesh(B.ctx.geometry(G.plane(5, 5)), new Material({ map: B.ctx.texture(rugC), roughness: 0.95, shading: 'cloth' }), { castShadow: false, reflect: false });
  rug.matrix = TR(24.7, 0.006, -24.4); rug.order = 1; B.scene.add(rug);
  B.L.matte.push(...PR.couch(18.6, -25.2, -Math.PI / 2, '#3a3026', 2.6));
  B.solid(18.0, 19.2, -26.6, -23.8, 1);
  B.box('matte', 1.1, 0.4, 1.8, 17.2, 0, -25.2, '#2a2420'); B.solid(16.6, 17.8, -26.1, -24.3, 0.45);
  const film = T.canvas(512, 288), fg = film.getContext('2d');
  fg.fillStyle = '#20262e'; fg.fillRect(0, 0, 512, 288); fg.fillStyle = look.primary; fg.fillRect(0, 0, 512, 40); fg.fillStyle = inkOn(look.primary); fg.font = '900 24px Arial'; fg.fillText(`${look.abbr} · SCOUTING`, 14, 28);
  for (let i = 0; i < 5; i++) { fg.fillStyle = '#d9dee4'; fg.fillRect(20, 60 + i * 42, 300, 24); fg.fillStyle = look.secondary; fg.fillRect(340, 60 + i * 42, 80 + i * 20, 24); }
  B.box('metal', 0.08, 1.2, 2.1, of.x0 + 0.05, 1.0, -25.2, '#0d0e10');
  B.sign(film, 1.98, 1.1, of.x0 + 0.1, 1.6, -25.2, Math.PI / 2, { lit: 1.1 });
  B.box('matte', 3.2, 2.4, 0.4, 28.6, 0, of.z0 + 0.22, '#3b2a1e');
  for (let k = 0; k < 4; k++) B.box('matte', 3.0, 0.04, 0.36, 28.6, 0.5 + k * 0.6, of.z0 + 0.26, '#2a1e15');
  for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) { const x = 27.4 + i * 0.75; B.put('trim', G.cylinder(0.06, 0.04, 0.24, 10, { y0: true }), x, 0.54 + k * 0.6, of.z0 + 0.26); B.put('trim', G.sphere(0.055, 8, 6), x, 0.82 + k * 0.6, of.z0 + 0.26); }
  B.solid(26.9, 30.3, of.z0, of.z0 + 0.5, 2.4);
  B.sign(teamBanner(look, plat ? 'PLATINUM' : 'GOLD'), 1.0, 2.0, of.x1 - 0.05, 1.9, -27.2, -Math.PI / 2, { cloth: true });
  queuePanel(B, o.queue.x, 1.45, of.z1 - 0.02, Math.PI, look.primary);
  for (const x of [18.5, 23, 27.5]) highBay(B, x, -24.2, of.h, 'panel');
  B.light(19.5, of.h - 0.5, -24.6, 9, 4.2, plat ? [0.97, 0.99, 1] : [1, 0.96, 0.9]);
  B.light(27.0, of.h - 0.5, -24.4, 9, 4.2, plat ? [0.97, 0.99, 1] : [1, 0.96, 0.9]);
  return { logoS, logoC, ribbon, ribbonMat, sbC, sbTex, tbC, tbTex, tvS, tvC, woSign, rugC, rug };
}

// the Gold clubhouse's customizable pieces, painted from the team's look (paint() calls it again)
function paintGold(B, extra, look) {
  const g = extra.logoC.getContext('2d');
  g.clearRect(0, 0, 1024, 1024);
  g.fillStyle = look.primary; g.beginPath(); g.arc(512, 512, 500, 0, Math.PI * 2); g.fill();
  g.strokeStyle = look.secondary; g.lineWidth = 22; g.beginPath(); g.arc(512, 512, 470, 0, Math.PI * 2); g.stroke();
  T.drawLogo(g, { shape: logoShape(look.logo), color: mixHex(look.primary, '#000000', 0.2), accent: look.secondary, text: look.abbr }, 512, 470, 300);
  g.fillStyle = look.secondary; g.font = '900 78px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(look.name.toUpperCase().slice(0, 16), 512, 860);
  B.ctx.updateTexture?.(extra.logoS.tex, extra.logoC);
  const r = extra.ribbon.cvs.getContext('2d');
  r.fillStyle = mixHex(look.primary, '#000000', 0.45); r.fillRect(0, 0, 2048, 64);
  r.fillStyle = look.secondary; r.font = '900 40px "Arial Black", Impact, sans-serif'; r.textBaseline = 'middle'; r.textAlign = 'left';
  for (let x = 20, i = 0; x < 2048; i++) { const t = i % 2 ? `${look.abbr}  ·  PRO-AM` : look.name.toUpperCase(); r.fillText(t, x, 34); x += 40 * t.length * 0.72 + 90; }
  B.ctx.updateTexture?.(extra.ribbon.tex, extra.ribbon.cvs);
}

// ---------------- materials ----------------
function wallMaterials(B, tier, look) {
  const ctx = B.ctx;
  const tex = (cvs, o = {}) => ctx.texture(cvs, { aniso: 8, ...o });
  if (tier === 'bronze') return {
    wall: new Material({ map: tex(blockCanvas('#d9cfb8', '#b3a88f', 3, 1)), roughness: 0.9, uvScale: [1 / 1.6, 1 / 1.6] }),
    dado: new Material({ map: tex(blockCanvas(SCHOOL_B.color, '#4a1d20', 4, 3)), roughness: 0.75, uvScale: [1 / 1.6, 1 / 1.6] }),
    owall: new Material({ map: tex(plasterCanvas('#d6d2c4')), roughness: 0.9, uvScale: [1 / 2, 1 / 2] }),
    odado: new Material({ map: tex(plasterCanvas('#8a8e86')), roughness: 0.8, uvScale: [1 / 2, 1 / 2] }),
  };
  if (tier === 'silver') return {
    wall: new Material({ map: tex(blockCanvas('#e9e5da', '#c9c3b5', 7, 0)), roughness: 0.85, uvScale: [1 / 1.6, 1 / 1.6] }),
    dado: new Material({ map: tex(blockCanvas(SCHOOL_S.color, '#14233f', 8, 0)), roughness: 0.6, uvScale: [1 / 1.6, 1 / 1.6] }),
    owall: new Material({ map: tex(plasterCanvas('#c9ccc8')), roughness: 0.9, uvScale: [1 / 2, 1 / 2] }),
  };
  return { wall: hallWall(B, look), owall: new Material({ map: tex(panelCanvas('#b0835a', 11)), roughness: 0.6, uvScale: [1 / 2.4, 1 / 2.4] }) };
}
// the clubhouse hall's walls (team.custom.walls)
function hallWall(B, look, mat = null) {
  const ctx = B.ctx, m = mat || new Material({ roughness: 0.85 });
  const set = (map, scale, color = [1, 1, 1], rough = 0.85, nm = null) => { m.map = map; m.normalMap = nm; m.uvScale = [1 / scale, 1 / scale]; m.color = color; m.roughness = rough; };
  const w = look.walls;
  if (w === 'brick') { const b = T.brick({ color: [0.62, 0.3, 0.22], mortar: '#b9b0a2' }); set(ctx.texture(b.color, { aniso: 8 }), 1.2, [1.15, 1.1, 1.05], 0.9, ctx.texture(b.normal, { srgb: false })); }
  else if (w === 'block') set(ctx.texture(blockCanvas('#d7d5cf', '#bab6ad', 13, 0), { aniso: 8 }), 1.6, [1, 1, 1], 0.85);
  else if (w === 'panel') set(ctx.texture(panelCanvas('#a8774c', 14), { aniso: 8 }), 2.4, [1, 1, 1], 0.6);
  else if (w === 'concrete') { const c = T.concrete({ color: [0.6, 0.6, 0.59] }); set(ctx.texture(c.color, { aniso: 8 }), 3.0, [1, 1, 1], 0.45, ctx.texture(c.normal, { srgb: false })); }
  else set(ctx.texture(plasterCanvas('#ffffff', 15), { aniso: 8 }), 2.0, lin(look.primary), 0.8);
  m.wallStyle = w;
  return m;
}
function floorMaterials(B, tier, look) {
  const ctx = B.ctx;
  if (tier === 'bronze' || tier === 'silver') {
    const tone = tier === 'bronze' ? [0.86, 0.65, 0.39] : [0.88, 0.63, 0.37];
    const wood = woodTextures(ctx, tone);
    return {
      wood: new Material({ map: wood.color, normalMap: wood.normal, normalScale: 0.35, roughness: tier === 'bronze' ? 0.55 : 0.32, uvScale: [0.5, 0.5], specular: 1.0 }),
      tile: new Material({ map: ctx.texture(tileCanvas()), roughness: 0.6, uvScale: [1 / 1.2, 1 / 1.2] }),
      carpet: new Material({ map: ctx.texture(carpetCanvas()), roughness: 0.98, shading: 'cloth', uvScale: [0.5, 0.5] }),
    };
  }
  return { slab: slabMaterial(B, look), ofloor: new Material({ map: ctx.texture(carpetCanvas('#4b4f58', 17)), roughness: 0.97, shading: 'cloth', uvScale: [0.5, 0.5] }) };
}
// the clubhouse floor round the courts, in the chosen wood (team.custom.floor)
function slabMaterial(B, look, mat = null) {
  const f = HUB_FLOORS[look.floor] || HUB_FLOORS.natural, wood = woodTextures(B.ctx, f.tone);
  const m = mat || new Material({ normalScale: 0.35, roughness: 0.3, uvScale: [0.5, 0.5], specular: 1.0 });
  m.map = wood.color; m.normalMap = wood.normal; m.floorStyle = look.floor;
  return m;
}
function ceilMaterials(tier) {
  return {
    ceil: new Material({ color: lin(tier === 'bronze' ? '#4a4844' : tier === 'silver' ? '#3a3d42' : '#2c2e33'), roughness: 0.92 }),
    oceil: new Material({ color: lin(tier === 'bronze' ? '#d8d4c8' : '#e2e2de'), roughness: 0.9 }),
  };
}
// the court spec for each tier (Gold: the team's, with its floor and logo)
export function hubCourtSpec(tier, look) {
  if (tier === 'bronze') return { surface: 'wood', paint: mixHex(SCHOOL_B.color, '#8a6a4a', 0.25), lines: '#efe6cf', apron: null, keyText: '', logo: { shape: 'circle', color: SCHOOL_B.color, accent: SCHOOL_B.accent, text: SCHOOL_B.abbr, size: 1.25 }, baselineText: SCHOOL_B.name, sideText: SCHOOL_B.mascot, reflective: true, reflectStrength: 0.22, gloss: 0.48, woodTone: [0.86, 0.65, 0.39] };
  if (tier === 'silver') return { surface: 'wood', paint: SCHOOL_S.color, lines: '#f8f4ea', apron: null, keyText: SCHOOL_S.abbr, paintCircle: true, logo: { shape: 'diamond', color: SCHOOL_S.color, accent: SCHOOL_S.accent, text: SCHOOL_S.abbr, size: 1.5 }, baselineText: SCHOOL_S.name, sideText: SCHOOL_S.mascot, reflective: true, reflectStrength: 0.5, gloss: 0.24, woodTone: [0.88, 0.63, 0.37] };
  const f = HUB_FLOORS[look.floor] || HUB_FLOORS.natural;
  return { surface: 'wood', paint: look.primary, lines: luma(f.slab) < 0.25 ? '#f4f1ea' : '#f8f6f0', apron: mixHex(look.primary, '#000000', 0.35), keyText: look.abbr, paintCircle: true, logo: { shape: logoShape(look.logo), color: look.primary, accent: look.secondary, text: look.abbr, size: 1.7 }, baselineText: look.name.toUpperCase(), sideText: `${look.abbr} · PRO-AM`, reflective: true, reflectStrength: 0.55, gloss: 0.22, woodTone: f.tone };
}

// ---------------- the venue ----------------
// opts.team: the team (the server's team view: name, abbr, primary/secondary or colors, logo, court, custom)
export function buildProamHub(r, scene, tierIn, opts = {}) {
  const tier = HUB_TIERS.includes(tierIn) ? tierIn : hubTier(opts.team);
  const ctx = r.ctx, plan = hubPlan(tier), theme = HUB_THEMES[tier], plat = tier === 'platinum';
  let look = hubLook(opts.team || {});
  if (!customizable(tier)) look = { ...look, floor: 'natural', walls: 'brick' }; // (only Gold and up choose)
  scene.lights.length = 0;
  applyLighting(r, scene, theme);
  const B = kit(ctx, scene, plan, look, tier);
  B.park = homePark(opts.team);
  const wallM = wallMaterials(B, tier, look), floorM = floorMaterials(B, tier, look), ceilM = ceilMaterials(tier);
  shell(B);
  const C = courts(B, hubCourtSpec(tier, look), { margin: tier === 'gold' || plat ? 2.4 : 2.0, padColor: tier === 'bronze' ? '#1f3a68' : tier === 'silver' ? SCHOOL_S.color : look.primary, wallMount: tier === 'bronze', shoot: plan.shootCourt });
  const extra = tier === 'bronze' ? dressBronze(B) : tier === 'silver' ? dressSilver(B) : dressGold(B, plat);
  // the office's whiteboard (all tiers)
  const whiteboard = whiteboardAt(B, plan.office.whiteboard.at);
  // the batches
  const mats = {
    matte: new Material({ color: [1, 1, 1], roughness: 0.84 }),
    metal: new Material({ color: [1, 1, 1], roughness: 0.42, metalness: 0.65 }),
    glow: new Material({ color: [2.3, 2.3, 2.3], shading: 'unlit', fog: false }),
    cloth: new Material({ color: [1, 1, 1], roughness: 0.95, shading: 'cloth', sheen: [0.08, 0.08, 0.08] }),
    teamA: new Material({ color: lin(look.primary), roughness: 0.6 }),
    teamB: new Material({ color: lin(look.secondary), roughness: 0.6 }),
    trim: new Material({ color: lin(plat ? '#dfe6ec' : '#d8b04a'), roughness: 0.25, metalness: 0.9 }),
    glass: new Material({ color: '#c8dde6', opacity: 0.16, roughness: 0.04, specular: 1.2, blend: 'alpha', doubleSided: true }),
    ...wallM, ...floorM, ...ceilM,
  };
  for (const [k, parts] of Object.entries(B.walls)) addBatch(B, parts, mats[k], { color: false, castShadow: false, reflect: false });
  for (const [k, parts] of Object.entries(B.floors)) { const m = addBatch(B, parts, mats[k], { color: false, castShadow: false, reflect: false, order: -2 }); if (m) m.order = -2; }
  for (const [k, parts] of Object.entries(B.ceils)) addBatch(B, parts, mats[k], { color: false, castShadow: false, reflect: false });
  for (const k of ['matte', 'metal', 'cloth', 'teamA', 'teamB', 'trim']) addBatch(B, B.L[k], mats[k]);
  addBatch(B, B.L.glow, mats.glow, { castShadow: false, reflect: false });
  addBatch(B, B.L.glass, mats.glass, { castShadow: false, reflect: false, order: 4 });
  for (const l of B.lights) scene.lights.push(l);
  scene.reflectionPlane = true;
  scene.shadowFocus = { center: [0, 0, 0], radius: 19 };
  // the shootaround slots: the main court's north goal (everyone can share it: game/proamhub.js SharedHoop) and the
  // Gold clubhouse's shootaround court
  const shootSlots = [{ id: 'main', court: { id: 'pahub-n', origin: [0, 0, 0], hoops: [C.mainCourt.hoops[0]], format: 1 }, spot: plan.shoot[0] }];
  if (C.shootCourt) shootSlots.push({ id: 'side', court: { id: 'pahub-side', origin: C.shootCourt.origin, hoops: C.shootCourt.hoops, format: 1 }, spot: plan.shoot[1] });
  const rack = !C.shootCourt && plan.shoot[1] ? plan.shoot[1] : null;
  // where you can stand, the walls for the camera, the interactables
  const bounds = plan.rooms.reduce((b, R) => ({ x0: Math.min(b.x0, R.x0), x1: Math.max(b.x1, R.x1), z0: Math.min(b.z0, R.z0), z1: Math.max(b.z1, R.z1) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  const o = plan.office;
  const interactables = [
    { id: 'exit', x: plan.exit.x, z: plan.exit.z, r: plan.exit.r },
    ...(plan.walkout ? [{ id: 'walkout', x: plan.walkout.x, z: plan.walkout.z, r: plan.walkout.r, park: B.park }] : []),
    { id: 'whiteboard', x: o.whiteboard.x, z: o.whiteboard.z, r: o.whiteboard.r },
    { id: 'draft', x: o.draft.x, z: o.draft.z, r: o.draft.r },
    { id: 'settings', x: o.settings.x, z: o.settings.z, r: o.settings.r },
    { id: 'queue', x: o.queue.x, z: o.queue.z, r: o.queue.r },
    ...shootSlots.map((s, i) => ({ id: 'shoot', slot: i, x: s.spot.x, z: s.spot.z, r: s.spot.r })),
    ...(rack ? [{ id: 'shoot', slot: 0, x: rack.x, z: rack.z, r: rack.r }] : []),
  ];
  const tris = scene.meshes.reduce((a, m) => a + (m.geo?.count || 0) / 3, 0);
  let t = 0;
  const venue = {
    theme, tier, look, plan, park: B.park, name: HUB_NAMES[tier],
    courts: [C.mainCourt, ...(C.shootCourt ? [C.shootCourt] : [])], hoops: C.hoops, shootSlots,
    rooms: plan.rooms, gaps: plan.gaps, solids: B.solids, camSolids: [...wallLines(plan), ...B.solids], bounds,
    spawn: plan.spawn, exit: plan.exit, walkout: plan.walkout ? { ...plan.walkout, park: B.park } : null, office: plan.office,
    interactables, boards: { whiteboard }, mats, extra, lights: B.lights, tris,
    walkable: (x, z, rr = 0.35) => walkableIn(plan, x, z, rr),
    roomAt(x, z) { return plan.rooms.find(R => inRect(R, x, z)) || null; },
    update(dt) { t += dt; for (const a of B.anim) a(dt, t); },
    // the team changed (its name, colors, logo; Gold: its floor and walls): the clubhouse in its new look
    paint(team) {
      const lk = hubLook(team || {});
      if (!customizable(tier)) return false;
      venue.look = lk;
      mats.teamA.color = lin(lk.primary); mats.teamB.color = lin(lk.secondary);
      for (const pm of C.padMats) pm.color = lin(lk.primary);
      hallWall(B, lk, mats.wall);
      slabMaterial(B, lk, mats.slab);
      for (const m of C.courtMeshes) scene.remove(m);
      const F = courtFloors(B, hubCourtSpec(tier, lk), { margin: 2.4, shoot: plan.shootCourt });
      C.courtMeshes = F.meshes; C.mainCourt.floor = F.main; if (C.shootCourt) C.shootCourt.floor = F.half;
      paintGold(B, extra, lk);
      return true;
    },
  };
  if (customizable(tier)) paintGold(B, extra, look);
  return venue;
}
