// Venue themes. Three affiliation parks (original names/art), the Pro-Am arena and the practice gym.
export const AFFILIATIONS = {
  harbor: { id: 'harbor', name: 'Harbor Kings', park: 'Harbor Point', color: '#ef7d3c', accent: '#0d8a8f', blurb: 'Sunset courts on the boardwalk. Fast pace, highlight plays.', jersey: 'jersey_harbor_kings' },
  brick: { id: 'brick', name: 'Old Brick Society', park: 'Old Brick Yard', color: '#b8322f', accent: '#f0e2c4', blurb: 'Downtown under the floodlights. Old-school, physical.', jersey: 'jersey_old_brick' },
  foundry: { id: 'foundry', name: 'Foundry Rivets', park: 'Foundry Works', color: '#3b5873', accent: '#f2c14e', blurb: 'Steel and sodium lights by the rail yard. Grit over glamour.', jersey: 'jersey_foundry_rivets' },
};

// v0.4.5 park events. Not an affiliation (nobody calls it home), but a park in every other way.
export const EVENTS = {
  kingtut: { id: 'kingtut', name: 'King Tut Cup', park: 'The King Tut Cup', color: '#39ff88', accent: '#b14dff', blurb: 'Glow-in-the-dark ante-ups among the pyramids. 48-hour leaderboard.', event: true },
};
// name/colors for any park id, affiliation or event
export const parkInfo = id => AFFILIATIONS[id] || EVENTS[id] || null;

export const THEMES = {
  harbor: {
    id: 'harbor', kind: 'park', name: 'Harbor Point', style: 'coast',
    court: { surface: 'asphalt', court: '#2f8a8c', apron: '#e6c79a', paint: '#ef7d3c', lines: '#fbf5e6', arcTint: 'rgba(255,255,255,0.05)', wear: 0.55, logo: { shape: 'crown', color: '#ef7d3c', accent: '#fbf5e6', text: 'HK', size: 1.35 }, baselineText: 'HARBOR KINGS', asphaltTint: '#d8d2c8' },
    ground: '#c7b392',
    sky: { top: [0.16, 0.2, 0.42], horizon: [1.0, 0.56, 0.32], ground: [0.35, 0.25, 0.2], stars: 0 },
    sun: { dir: [-0.75, 0.32, 0.55], color: [1.0, 0.68, 0.42], intensity: 3.4 },
    ambient: { sky: [0.42, 0.36, 0.48], ground: [0.32, 0.22, 0.16] },
    fog: { color: [0.86, 0.6, 0.48], density: 0.0022 },
    env: { top: '#3a3f7a', horizon: '#ff9a5c', horizonLow: '#f2b680', ground: '#6b5848', lights: [{ u: 0.12, v: 0.42, r: 0.06, color: 'rgba(255,220,170,1)' }] },
    exposure: 1.05, bloom: { strength: 0.08, threshold: 1.1, radius: 1 }, grade: { saturation: 1.1, contrast: 1.05, vignette: 0.55 },
    floodlights: false, envIntensity: 0.9,
  },
  brick: {
    id: 'brick', kind: 'park', name: 'Old Brick Yard', style: 'city',
    court: { surface: 'asphalt', court: '#7a2e2a', apron: '#3a3634', paint: '#e8dcc0', lines: '#f6efdd', wear: 0.75, logo: { shape: 'shield', color: '#2b2523', accent: '#f0e2c4', text: 'OBS', size: 1.4 }, baselineText: 'OLD BRICK SOCIETY', asphaltTint: '#b8b2aa' },
    ground: '#57534f',
    sky: { top: [0.01, 0.015, 0.04], horizon: [0.09, 0.08, 0.12], ground: [0.03, 0.03, 0.03], stars: 1 },
    sun: { dir: [0.18, 1, 0.24], color: [0.95, 0.93, 1.0], intensity: 2.6 },
    ambient: { sky: [0.12, 0.13, 0.2], ground: [0.08, 0.06, 0.05] },
    fog: { color: [0.06, 0.06, 0.09], density: 0.012 },
    env: { top: '#05060c', horizon: '#2a2533', ground: '#141414', skyline: '#0c0c12', lights: [{ u: 0.3, v: 0.4, r: 0.03, color: 'rgba(255,240,200,1)' }, { u: 0.7, v: 0.4, r: 0.03, color: 'rgba(255,240,200,1)' }] },
    exposure: 1.15, bloom: { strength: 0.12, threshold: 1.0, radius: 1.1 }, grade: { saturation: 1.05, contrast: 1.08, vignette: 0.7 },
    floodlights: true, lightColor: [1.0, 0.95, 0.85], envIntensity: 0.6,
  },
  foundry: {
    id: 'foundry', kind: 'park', name: 'Foundry Works', style: 'industrial',
    court: { surface: 'asphalt', court: '#3b5873', apron: '#2f3337', paint: '#f2c14e', lines: '#ece6d3', wear: 0.85, logo: { shape: 'hex', color: '#1b222b', accent: '#f2c14e', text: 'FR', size: 1.4 }, baselineText: 'FOUNDRY RIVETS', asphaltTint: '#a8a8aa' },
    ground: '#4b4a48',
    sky: { top: [0.12, 0.12, 0.2], horizon: [0.62, 0.4, 0.42], ground: [0.12, 0.11, 0.1], stars: 0.15 },
    sun: { dir: [0.6, 0.38, -0.5], color: [1.0, 0.72, 0.5], intensity: 2.4 },
    ambient: { sky: [0.26, 0.24, 0.32], ground: [0.14, 0.11, 0.09] },
    fog: { color: [0.42, 0.32, 0.34], density: 0.01 },
    env: { top: '#25263a', horizon: '#a8686a', ground: '#2a2522', skyline: '#1e1d22' },
    exposure: 1.1, bloom: { strength: 0.1, threshold: 1.0, radius: 1 }, grade: { saturation: 0.95, contrast: 1.08, vignette: 0.65 },
    floodlights: true, lightColor: [1.0, 0.72, 0.42], envIntensity: 0.7,
  },
  // v0.4.5 The King Tut Cup: the same park layout under a black-light night — neon court lines, pyramids,
  // sphinxes, obelisks, glowing props and dark corners, like a mini-golf course crossed with a laser-tag arena
  kingtut: {
    id: 'kingtut', kind: 'park', name: 'The King Tut Cup', style: 'tut', event: true,
    court: { surface: 'asphalt', court: '#17122a', apron: '#0c0a14', paint: '#2c1658', lines: '#39ff88', wear: 0.2, logo: { shape: 'sphinx', color: '#120d22', accent: '#e8c15a', size: 1.5, inHalf: true }, baselineText: 'KING TUT CUP', asphaltTint: '#6e6a80', neon: { lines: '#39ff88', accent: '#b14dff', text: '#e8c15a' } },
    ground: '#2a2438',
    sky: { top: [0.008, 0.004, 0.025], horizon: [0.08, 0.03, 0.14], ground: [0.01, 0.008, 0.015], stars: 1 },
    sun: { dir: [-0.3, 1, 0.4], color: [0.66, 0.52, 1.0], intensity: 1.9 },
    ambient: { sky: [0.24, 0.16, 0.44], ground: [0.1, 0.07, 0.15] },
    fog: { color: [0.05, 0.02, 0.09], density: 0.011 },
    env: { top: '#06030f', horizon: '#2a0f45', ground: '#0c0816', skyline: '#08050f', lights: [{ u: 0.25, v: 0.42, r: 0.03, color: 'rgba(120,255,170,1)' }, { u: 0.75, v: 0.42, r: 0.03, color: 'rgba(190,110,255,1)' }] },
    exposure: 1.2, bloom: { strength: 0.32, threshold: 0.85, radius: 1.3 }, grade: { saturation: 1.18, contrast: 1.1, vignette: 0.75 },
    floodlights: true, lightColor: [0.62, 0.42, 1.0], envIntensity: 0.55,
  },
  arena: {
    id: 'arena', kind: 'arena', name: 'Afterhours Arena', style: 'arena',
    court: { surface: 'wood', paint: '#1e3d63', lines: '#f6f1e6', apron: 'rgba(20,32,52,0.92)', keyText: '', baselineText: 'PRO-AM', sideText: 'AFTERHOURS 16', logo: { shape: 'circle', color: '#1e3d63', accent: '#f6f1e6', text: 'AH', size: 1.55 }, reflective: true, reflectStrength: 0.6, gloss: 0.22 },
    sky: { top: [0.01, 0.01, 0.015], horizon: [0.02, 0.02, 0.03], ground: [0.01, 0.01, 0.01], stars: 0 },
    sun: { dir: [0.12, 1, 0.3], color: [1.0, 0.97, 0.92], intensity: 3.1 },
    ambient: { sky: [0.3, 0.29, 0.3], ground: [0.22, 0.16, 0.1] },
    fog: { color: [0.02, 0.02, 0.03], density: 0.008 },
    env: { top: '#1a1a1f', horizon: '#3a3530', ground: '#7a5a3a', bands: [{ v: 0.08, h: 0.03, color: '#fffbe8' }, { v: 0.16, h: 0.02, color: '#fff5d8' }] },
    exposure: 1.1, bloom: { strength: 0.1, threshold: 1.15, radius: 1 }, grade: { saturation: 1.08, contrast: 1.06, vignette: 0.5 },
    floodlights: false, envIntensity: 1.0,
  },
  gym: {
    id: 'gym', kind: 'gym', name: 'Union Fieldhouse', style: 'gym',
    court: { surface: 'wood', paint: '#8a2b2b', lines: '#f9ecd3', apron: null, keyText: 'UNION', logo: { shape: 'diamond', color: '#8a2b2b', accent: '#f9ecd3', text: 'U', size: 1.3 }, reflective: true, reflectStrength: 0.45, gloss: 0.3, woodTone: [0.86, 0.66, 0.44] },
    sky: { top: [0.3, 0.4, 0.55], horizon: [0.7, 0.75, 0.8], ground: [0.2, 0.2, 0.2], stars: 0 },
    sun: { dir: [-0.5, 0.75, 0.3], color: [1.0, 0.96, 0.88], intensity: 2.2 },
    ambient: { sky: [0.42, 0.42, 0.44], ground: [0.3, 0.24, 0.18] },
    fog: { color: [0.3, 0.3, 0.32], density: 0.0 },
    env: { top: '#8a8a8a', horizon: '#c9c2b5', ground: '#a07850', bands: [{ v: 0.1, h: 0.03, color: '#ffffff' }] },
    exposure: 1.1, bloom: { strength: 0.07, threshold: 1.2, radius: 1 }, grade: { saturation: 1.05, contrast: 1.03, vignette: 0.45 },
    floodlights: false, envIntensity: 0.9,
  },
  // v0.4.5 Crews: the Crew HQ, an indoor clubhouse (the court paint, logo and banners take the crew's colors)
  hq: {
    id: 'hq', kind: 'hq', name: 'Crew HQ', style: 'hq',
    court: { surface: 'wood', paint: '#2457c5', lines: '#f4f1ea', apron: null, keyText: '', logo: { shape: 'circle', color: '#2457c5', accent: '#f4f1ea', text: 'HQ', size: 1.45 }, reflective: true, reflectStrength: 0.5, gloss: 0.26, woodTone: [0.78, 0.58, 0.38] },
    sky: { top: [0.05, 0.05, 0.06], horizon: [0.12, 0.11, 0.1], ground: [0.05, 0.04, 0.04], stars: 0 },
    sun: { dir: [-0.35, 1, 0.25], color: [1.0, 0.95, 0.86], intensity: 1.9 },
    ambient: { sky: [0.4, 0.38, 0.4], ground: [0.28, 0.21, 0.15] },
    fog: { color: [0.08, 0.08, 0.09], density: 0.0 },
    env: { top: '#2a2a2e', horizon: '#6a5f52', ground: '#7a5a3a', bands: [{ v: 0.1, h: 0.03, color: '#fff3dc' }] },
    exposure: 1.12, bloom: { strength: 0.12, threshold: 1.05, radius: 1 }, grade: { saturation: 1.08, contrast: 1.06, vignette: 0.5 },
    floodlights: false, envIntensity: 0.85,
  },
};
// v0.4.5 Crew HQ floor plan (meters; +z is north, the door is in the south wall). A full 5-on-5 court, a
// shootaround half court to its east with its hoop at the north end, and the lounge in the south-east corner
// (couches, the members board, the level board and the "coming soon" customization corner).
export const HQ = {
  walls: { x0: -11, x1: 31, z0: -21, z1: 17.6, h: 9.5 },
  bounds: { x0: -10.4, x1: 30.4, z0: -20.4, z1: 17 },
  main: [0, 0, 0],
  shoot: [21, 0, 0],
  door: { x: 21, z: -20.3 },
  spawn: { x: 21, z: -16.8 },
  board: { x: 30.9, z: -11.1 },   // members board on the east wall (faces west, toward the couches)
  levels: { x: 26, z: -20.9 },    // level board on the south wall (faces north)
  custom: { x: 14.5, z: -20.9 },  // "interior customization: coming soon" corner
  table: { x: 10.4, z: 0 },       // scorer's table between the courts: run 5-on-5 from here
  rack: { x: 17.5, z: -3.4 },     // ball rack at the foot of the shootaround court
  couches: [[25.2, -13.3, Math.PI / 2], [25.2, -8.9, Math.PI / 2]],
  coffee: { x: 27.1, z: -11.1 },
  bleacher: { x: -9.2, z: 0 },    // a short bleacher on the main court's west sideline
};
// Park court layout (shared by every affiliation park). v0.4.2: three full courts for 3v3 (full-court
// games), two 2v2 half courts on the west annex and a 1v1 half court on the east annex.
export const PARK_COURTS = [
  { id: 'main', name: 'Court 1 · Main', format: 3, origin: [0, 0, 0], full: true },
  { id: 'east', name: 'Court 2', format: 3, origin: [26, 0, 0], full: true },
  { id: 'west', name: 'Court 3', format: 3, origin: [-26, 0, 0], full: true },
  { id: 'w2a', name: 'Court 4 · 2v2', format: 2, origin: [-52, 0, -15] },
  { id: 'w2b', name: 'Court 5 · 2v2', format: 2, origin: [-52, 0, 5] },
  { id: 'e1', name: 'Court 6 · 1v1', format: 1, origin: [52, 0, -10] },
];
// v0.4.5 Crews: the Crew HQ building on every park's plaza (center of its footprint), between two street lamps
// west of the Daily Spin wheel; its door faces the courts
export const PARK_HQ = { x: -26.5, z: -26.8 };
// the floor area a court's game uses (walkers stay out while it's being played on)
export function courtPlayRect(c, pad = 0.6) {
  const [ox, , oz] = c.origin, hw = COURT_W / 2 + pad, hl = COURT_L / 2 + pad;
  return c.full ? { x0: ox - hw, x1: ox + hw, z0: oz - hl, z1: oz + hl } : { x0: ox - hw, x1: ox + hw, z0: oz - 1.4 - pad, z1: oz + hl };
}
const COURT_W = 15.24, COURT_L = 28.65;
export function gotNextSpots(court) { return squadSpots(court)[0]; }
// v0.4.5 squad spots (2K-style): three rows of circles by each court, in priority order (GOT NEXT, 2ND, 3RD).
// Rows step out from the sideline; by the east edge of the park they stack along the sideline instead.
export const SQUAD_ROWS = 3;
export function squadSpots(court) {
  const [ox, , oz] = court.origin, rows = [];
  const outward = ox + 9.4 + (SQUAD_ROWS - 1) * 1.7 < 62;
  for (let r = 0; r < SQUAD_ROWS; r++) {
    const row = [];
    for (let i = 0; i < court.format; i++) row.push(outward ? { x: ox + 9.4 + r * 1.7, z: oz + 2.5 + i * 2.2 } : { x: ox + 9.4, z: oz + 2.5 + (r * court.format + i) * 2.2 });
    rows.push(row);
  }
  return rows;
}
