// Venue themes. Three affiliation parks (original names/art), the Pro-Am arena and the practice gym.
export const AFFILIATIONS = {
  harbor: { id: 'harbor', name: 'Harbor Kings', park: 'Harbor Point', color: '#ef7d3c', accent: '#0d8a8f', blurb: 'Sunset courts on the boardwalk. Fast pace, highlight plays.', jersey: 'jersey_harbor_kings' },
  brick: { id: 'brick', name: 'Old Brick Society', park: 'Old Brick Yard', color: '#b8322f', accent: '#f0e2c4', blurb: 'Downtown under the floodlights. Old-school, physical.', jersey: 'jersey_old_brick' },
  foundry: { id: 'foundry', name: 'Foundry Rivets', park: 'Foundry Works', color: '#3b5873', accent: '#f2c14e', blurb: 'Steel and sodium lights by the rail yard. Grit over glamour.', jersey: 'jersey_foundry_rivets' },
};

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
// the floor area a court's game uses (walkers stay out while it's being played on)
export function courtPlayRect(c, pad = 0.6) {
  const [ox, , oz] = c.origin, hw = COURT_W / 2 + pad, hl = COURT_L / 2 + pad;
  return c.full ? { x0: ox - hw, x1: ox + hw, z0: oz - hl, z1: oz + hl } : { x0: ox - hw, x1: ox + hw, z0: oz - 1.4 - pad, z1: oz + hl };
}
const COURT_W = 15.24, COURT_L = 28.65;
export function gotNextSpots(court) {
  const [ox, , oz] = court.origin;
  const spots = [];
  for (let i = 0; i < court.format; i++) spots.push({ x: ox + 9.4, z: oz + 2.5 + i * 2.2 });
  return spots;
}
