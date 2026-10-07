// Venue scene builders: affiliation parks (3 courts, Got Next spots, life), Pro-Am arena, practice gym.
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { buildCourt, buildHoop, cachedTexture } from './court.js';
import * as PR from './props.js';
import { createParkLife } from './parklife.js';
import { THEMES, PARK_COURTS, gotNextSpots, AFFILIATIONS } from './themes.js';
import { COURT } from '../sim/constants.js';

const lin = hex => M.hexLinear(hex);

export function applyLighting(r, scene, theme) {
  scene.sky = { ...theme.sky };
  scene.sun = { ...theme.sun, dir: M.v3norm([0, 0, 0], theme.sun.dir) };
  scene.ambient = { ...theme.ambient };
  scene.fog = { ...theme.fog };
  scene.exposure = theme.exposure;
  scene.bloom = { ...theme.bloom };
  scene.grade = { ...theme.grade };
  scene.envIntensity = theme.envIntensity ?? 1;
  scene.env = cachedTexture(r.ctx, 'env-' + theme.id, () => T.envMap(theme.env), {});
}

function batch(ctx, scene, parts, mat, opts = {}) {
  if (!parts.length) return null;
  const mesh = new Mesh(ctx.geometry(G.merge(parts)), mat, opts);
  scene.add(mesh);
  return mesh;
}

export function buildVenue(r, scene, themeId, opts = {}) {
  const theme = THEMES[themeId] || THEMES.brick;
  applyLighting(r, scene, theme);
  if (theme.kind === 'park') return buildPark(r, scene, theme, opts);
  if (theme.kind === 'arena') return buildArena(r, scene, theme, opts);
  return buildGym(r, scene, theme, opts);
}

function commonMats(ctx) {
  return {
    matte: new Material({ color: [1, 1, 1], roughness: 0.82 }),
    metal: new Material({ color: [1, 1, 1], roughness: 0.42, metalness: 0.65 }),
    foliage: new Material({ color: [1, 1, 1], roughness: 0.9, shading: 'cloth', sheen: [0.05, 0.08, 0.04] }),
    lamp: new Material({ color: [1, 0.96, 0.85], shading: 'unlit', emissive: [6, 5.6, 4.8], fog: false }),
  };
}

// ---------------- Parks ----------------
function buildPark(r, scene, theme, opts) {
  const ctx = r.ctx, rng = new RNG(theme.id.length * 977 + 13);
  const mats = commonMats(ctx);
  const matte = [], metal = [], foliage = [], lamps = [];
  const courts = [], hoops = [];
  // ground
  const conc = cachedTexture(ctx, 'concrete', () => T.concrete({ joints: true }).color, {});
  const concN = cachedTexture(ctx, 'concreteN', () => T.concrete({ joints: true }).normal, { srgb: false });
  const groundGeo = G.plane(160, 140, 1, 1);
  for (let i = 0; i < groundGeo.uv.length; i += 2) { groundGeo.uv[i] *= 160 / 4; groundGeo.uv[i + 1] *= 140 / 4; }
  const ground = new Mesh(ctx.geometry(groundGeo), new Material({ color: lin(theme.ground), map: conc, normalMap: concN, normalScale: 0.6, roughness: theme.style === 'city' ? 0.55 : 0.85 }), { castShadow: false, reflect: false });
  ground.matrix[13] = -0.005; ground.order = -2;
  scene.add(ground);
  // courts (v0.4.2: three full courts + two 2v2 and one 1v1 half courts)
  const fenceTex = cachedTexture(ctx, 'chainlink', () => T.chainlink(256), {});
  const fenceRuns = [];
  for (const c of PARK_COURTS) {
    const full = !!c.full;
    const spec = { ...theme.court, halfOnly: !full, seed: c.origin[0] + 7 };
    if (c.format === 2) spec.logo = { ...spec.logo, size: 1.1 };
    if (c.format === 1) spec.logo = { ...spec.logo, size: 0.9 };
    const built = buildCourt(ctx, spec, c.origin);
    built.meshes.forEach(m => scene.add(m));
    const hs = (full ? [1, -1] : [1]).map(side => buildHoop(ctx, side, 'park', { origin: c.origin, rimColor: theme.id === 'foundry' ? '#d8a21c' : '#d8431c', poleColor: theme.id === 'harbor' ? '#2f5f63' : '#3a4249', netColor: theme.id === 'brick' ? '#dcdcd6' : '#f4f4f0' }));
    hs.forEach(h => h.meshes.forEach(m => scene.add(m)));
    hoops.push(...hs);
    courts.push({ ...c, hoops: hs, floor: built.floor, spots: gotNextSpots(c) });
    // fences: full courts get both baselines and the west sideline (east sideline stays open to the Got
    // Next line); half courts get a cage with the half-court end open
    const [ox, , oz] = c.origin;
    const W = COURT.width / 2 + 2.2, L = COURT.length / 2 + 2.6;
    const zf = full ? oz - L : oz - 3.2;
    const runs = [[ox - W, oz + L, ox + W, oz + L], [ox - W, zf, ox - W, oz + L], [ox + W, oz + 6, ox + W, oz + L]];
    if (full) runs.push([ox - W, oz - L, ox + W, oz - L], [ox + W, oz - L, ox + W, oz - 9]);
    for (const [x0, z0, x1, z1] of runs) { metal.push(...PR.fenceFrame(x0, z0, x1, z1, 3.8)); fenceRuns.push(PR.fenceMesh(x0, z0, x1, z1, 3.8)); }
    // light poles at the corners
    const corners = full ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 1], [1, 1], [-1, -0.05], [1, -0.05]];
    for (const [sx, sz] of corners) {
      const lx = ox + sx * (W + 0.3), lz = sz > 0 ? oz + sz * (L - 1.5) : (full ? oz + sz * (L - 1.5) : zf + 1.2);
      const yaw = Math.atan2(ox - lx, (full ? oz : oz + 7) - lz);
      metal.push(...PR.lightPole(lx, lz, yaw, full ? 10 : 8));
      lamps.push(...PR.lampFaces(lx, lz, yaw, full ? 10 : 8));
    }
    // benches on the west sideline and by the Got Next line (east)
    const nb = full ? 3 : 1;
    for (let k = 0; k < nb; k++) matte.push(...PR.bench(ox - W + 0.9, (full ? oz - 9 : oz + 4) + k * 6, Math.PI / 2, theme.id === 'harbor' ? '#b58a5c' : '#8a5f3a'));
    matte.push(...PR.bench(ox + W + 1.6, oz + (full ? -6 : 0), -Math.PI / 2));
    matte.push(...PR.trashCan(ox + W + 1.4, oz + 12));
    // small bleachers behind the main court baseline
    if (c.id === 'main') { matte.push(...PR.bleacher(ox - 4.5, oz - L - 0.9, 0, 7, 4)); matte.push(...PR.bleacher(ox + 4.5, oz - L - 0.9, 0, 7, 4)); }
  }
  scene.add(new Mesh(ctx.geometry(G.merge(fenceRuns, false)), new Material({ color: [0.75, 0.78, 0.8], map: fenceTex, alphaTest: 0.5, doubleSided: true, roughness: 0.4, metalness: 0.6 }), { castShadow: true }));
  // Got Next spot rings
  const ringTex = cachedTexture(ctx, 'ring', () => T.ringTexture(256), { wrap: 'clamp' });
  const gotNextMat = new Material({ color: lin(AFFILIATIONS[theme.id]?.color || '#ffffff'), map: ringTex, shading: 'unlit', emissive: [0, 0, 0], blend: 'add', depthWrite: false, fog: false });
  const ringParts = [];
  for (const c of courts) for (const s of c.spots) ringParts.push({ geo: G.plane(1.3, 1.3), matrix: M.m4translation(M.m4(), s.x, 0.02, s.z) });
  const gotNext = new Mesh(ctx.geometry(G.merge(ringParts, false)), gotNextMat, { castShadow: false, reflect: false });
  gotNext.order = 5;
  scene.add(gotNext);
  // practice hoop slab (east annex, north of the 1v1 court)
  const prOrigin = [52, 0, 16];
  const practiceHoop = buildHoop(ctx, 1, 'park', { origin: [prOrigin[0], 0, prOrigin[2] - COURT.hoopZ + 4], rimColor: '#d8431c' });
  practiceHoop.meshes.forEach(m => scene.add(m));
  hoops.push(practiceHoop);
  matte.push({ geo: G.box(10, 0.04, 9), matrix: M.m4translation(M.m4(), prOrigin[0], 0.02, prOrigin[2] + 0.5), color: [...lin(theme.court.court), 1] });
  matte.push(...PR.ballRack(prOrigin[0] - 4, prOrigin[2] - 2, Math.PI / 2));
  // south plaza: Daily Spin wheel | VC Store | Boosts, side by side
  const storePos = [0, -24], wheelPos = [-6.2, -24], boostPos = [6.2, -24];
  const affColor = AFFILIATIONS[theme.id]?.color || '#e0482f';
  matte.push(...PR.kiosk(storePos[0], storePos[1], 0, affColor));
  matte.push(...PR.kiosk(boostPos[0], boostPos[1], 0, '#2f8f6b'));
  const signs = [
    [storePos, 'storesign', () => T.banner('VC STORE', { bg: '#121418', color: '#f2c14e', stripe: '#e0482f', sub: 'APPAREL · SHOES · ANIMATIONS' })],
    [boostPos, 'boostsign', () => T.banner('BOOSTS', { bg: '#0f1a16', color: '#7ff0b8', stripe: '#2f8f6b', sub: 'SHOOTING · FINISHING · DEFENSE · MORE' })],
    [wheelPos, 'wheelsign', () => T.banner('DAILY SPIN', { bg: '#1a1210', color: '#ffd84a', stripe: affColor, sub: 'ONE FREE SPIN EVERY 24 HOURS' })],
  ];
  for (const [pos, key, make] of signs) {
    const signTex = cachedTexture(ctx, key, make, {});
    const sign = new Mesh(ctx.geometry(G.quad(3.8, 0.95)), new Material({ map: signTex, shading: 'unlit', color: [1.4, 1.4, 1.4], fog: false }), { castShadow: false });
    M.m4translation(sign.matrix, pos[0], key === 'wheelsign' ? 4.35 : 3.55, pos[1] + (key === 'wheelsign' ? 0.2 : 1.71));
    scene.add(sign);
    if (key !== 'wheelsign') {
      const sign2 = new Mesh(sign.geo, sign.material, { castShadow: false });
      M.m4mul(sign2.matrix, M.m4translation(M.m4(), pos[0], 3.55, pos[1] - 1.71), M.m4fromYaw(M.m4(), 0, 0, 0, Math.PI));
      scene.add(sign2);
    }
  }
  const wheel = PR.prizeWheel(ctx, wheelPos[0], wheelPos[1], affColor);
  for (const m of wheel.meshes) scene.add(m);
  // perimeter scenery by style
  const lightsOut = [];
  if (theme.style === 'coast') coastScenery(ctx, scene, rng, matte, metal, foliage);
  else if (theme.style === 'city') cityScenery(ctx, scene, rng, matte, metal, theme);
  else industrialScenery(ctx, scene, rng, matte, metal, theme);
  // trees/palms scattered around plaza
  for (let i = 0; i < 14; i++) {
    const x = rng.range(-50, 50), z = rng.next() < 0.5 ? rng.range(-34, -22) : rng.range(20, 30);
    if (Math.abs(x) < 10 && z < -18) continue;
    if (Math.abs(x) > 38 && z > 18) continue; // annex courts / practice slab
    if (theme.style === 'coast') foliage.push(...PR.palm(x, z, 1, rng)); else foliage.push(...PR.tree(x, z, 0.9 + rng.next() * 0.4, rng, theme.style === 'industrial' ? '#55623d' : '#3f6b3a'));
  }
  for (let i = 0; i < 10; i++) metal.push(...PR.streetLamp(-40 + i * 9, -27));
  // murals on a wall behind the west court
  const muralTex = cachedTexture(ctx, 'mural-' + theme.id, () => T.mural(AFFILIATIONS[theme.id]?.park?.split(' ')[0]?.toUpperCase() || 'AFTERHOURS', { seed: theme.id.length * 11, palette: theme.id === 'harbor' ? ['#ef7d3c', '#ffd25e', '#0d8a8f', '#d1386b', '#fff4e0'] : theme.id === 'brick' ? ['#b8322f', '#f0e2c4', '#f2c14e', '#3b6fb5', '#fafafa'] : ['#f2c14e', '#3b5873', '#e05a2f', '#9ab3c9', '#f4efe3'] }), {});
  const wall = new Mesh(ctx.geometry(G.box(18, 6, 0.6)), new Material({ map: muralTex, roughness: 0.85, color: [1, 1, 1] }));
  M.m4mul(wall.matrix, M.m4translation(M.m4(), -66, 3, -4), M.m4fromYaw(M.m4(), 0, 0, 0, Math.PI / 2));
  scene.add(wall);
  batch(ctx, scene, matte, mats.matte);
  batch(ctx, scene, metal, mats.metal);
  batch(ctx, scene, foliage, mats.foliage);
  batch(ctx, scene, lamps, mats.lamp, { castShadow: false });
  // floodlights for night parks: spotlights on the active halves
  scene.lights.length = 0;
  if (theme.floodlights) {
    const lc = theme.lightColor;
    for (const c of courts) {
      const [ox, , oz] = c.origin;
      scene.lights.push({ pos: [ox - 9, 10, oz + 12], range: 34, color: lc, intensity: c.full ? 26 : 20, dir: [0.5, -1, -0.5], cos: 0.55 });
      scene.lights.push({ pos: [ox + 9, 10, oz + (c.full ? -8 : 2)], range: 34, color: lc, intensity: c.full ? 24 : 18, dir: [-0.5, -1, c.full ? 0.5 : 0.3], cos: 0.55 });
    }
    scene.lights.push({ pos: [0, 4.6, -20.5], range: 16, color: [1, 0.85, 0.6], intensity: 12, dir: null });
    scene.lights.push({ pos: [-14, 5.5, -19], range: 20, color: [0.75, 0.82, 1], intensity: 9, dir: null });
  }
  scene.shadowFocus = { center: [0, 0, 6], radius: 18 };
  // v0.4.3: people, traffic and random events in the background of every park
  const life = createParkLife(r, scene, theme, new RNG(theme.id.length * 31 + 7));
  let t = 0;
  return {
    theme, courts, hoops, practice: { origin: prOrigin, hoop: practiceHoop }, store: { x: storePos[0], z: storePos[1] + 2.4 }, gotNext, life,
    boosts: { x: boostPos[0], z: boostPos[1] + 2.4 }, wheel: { x: wheelPos[0], z: wheelPos[1] + 2.2, obj: wheel },
    solids: [storePos, boostPos].map(q => ({ x0: q[0] - 2.3, x1: q[0] + 2.3, z0: q[1] - 1.7, z1: q[1] + 1.7, h: 3.1 })).concat([{ x0: wheelPos[0] - 1.6, x1: wheelPos[0] + 1.6, z0: wheelPos[1] - 0.8, z1: wheelPos[1] + 0.8, h: 4 }]),
    bounds: { x0: -63, x1: 63, z0: -34, z1: 32 },
    update(dt) {
      t += dt;
      wheel.update(dt);
      life.update(dt);
      gotNextMat.emissive = [0, 0, 0];
      gotNextMat.opacity = 0.7 + Math.sin(t * 3) * 0.25;
    },
  };
}

function coastScenery(ctx, scene, rng, matte, metal, foliage) {
  // ocean beyond the north boardwalk
  const water = G.plane(400, 160, 1, 1);
  for (let i = 0; i < water.uv.length; i += 2) { water.uv[i] *= 60; water.uv[i + 1] *= 24; }
  const wn = cachedTexture(ctx, 'waterN', () => T.asphalt({ cracks: 0, seed: 77, base: [0.5, 0.5, 0.5] }).normal, { srgb: false });
  const sea = new Mesh(ctx.geometry(water), new Material({ color: lin('#1d5d72'), normalMap: wn, normalScale: 0.35, roughness: 0.12, specular: 1.2 }), { castShadow: false, reflect: false });
  M.m4translation(sea.matrix, 0, -0.6, 115);
  scene.add(sea);
  // sand strip
  matte.push({ geo: G.box(400, 0.5, 12), matrix: M.m4translation(M.m4(), 0, -0.3, 40), color: [...lin('#e2c99a'), 1] });
  // boardwalk railing
  for (let x = -66; x <= 66; x += 2.5) metal.push({ geo: G.cylinder(0.04, 0.04, 1.1, 6, { y0: true }), matrix: M.m4translation(M.m4(), x, 0, 33.5), color: [...lin('#e8e3d8'), 1] });
  metal.push({ geo: G.tube([[-66, 1.1, 33.5], [66, 1.1, 33.5]], 0.04, 6), color: [...lin('#e8e3d8'), 1] });
  // pier & low beach houses to the sides
  for (let i = 0; i < 6; i++) {
    const x = -70 + i * 28, z = -46 - rng.range(0, 8);
    matte.push({ geo: G.box(14, 7 + rng.range(0, 6), 10), matrix: M.m4translation(M.m4(), x, 4, z), color: [...lin(rng.pick(['#e9d8c0', '#f2c6a8', '#c9e0dd', '#f5e6b8'])), 1] });
    matte.push({ geo: G.box(15, 0.6, 11), matrix: M.m4translation(M.m4(), x, 8 + rng.range(0, 6), z), color: [...lin('#b65c3a'), 1] });
  }
}

function cityScenery(ctx, scene, rng, matte, metal, theme) {
  const f1 = T.facade({ wall: '#5c3b33', lit: 0.4, seed: 3 }), f2 = T.facade({ wall: '#3c3f47', lit: 0.3, seed: 9, cols: 8, rows: 10, glass: '#1d2833' });
  const m1 = new Material({ map: ctx.texture(f1.color), emissiveMap: ctx.texture(f1.emissive), emissive: [2.2, 1.9, 1.4], roughness: 0.85 });
  const m2 = new Material({ map: ctx.texture(f2.color), emissiveMap: ctx.texture(f2.emissive), emissive: [1.8, 1.7, 1.5], roughness: 0.7 });
  const b1 = [], b2 = [];
  for (let i = 0; i < 9; i++) { const w = 12 + rng.range(0, 8), h = 14 + rng.range(0, 26); (i % 2 ? b1 : b2).push(PR.building(-64 + i * 16, -50 - rng.range(0, 10), w, 12, h)); }
  for (let i = 0; i < 8; i++) { const w = 12 + rng.range(0, 8), h = 12 + rng.range(0, 30); (i % 2 ? b2 : b1).push(PR.building(-60 + i * 17, 46 + rng.range(0, 10), w, 12, h)); }
  for (let i = 0; i < 4; i++) { b1.push(PR.building(-74, -30 + i * 18, 12, 14, 16 + rng.range(0, 14))); b2.push(PR.building(74, -30 + i * 18, 12, 14, 16 + rng.range(0, 14))); }
  scene.add(new Mesh(ctx.geometry(G.merge(b1, false)), m1));
  scene.add(new Mesh(ctx.geometry(G.merge(b2, false)), m2));
  // brick wall segments
  const br = T.brick({});
  const brickMat = new Material({ map: ctx.texture(br.color), normalMap: ctx.texture(br.normal, { srgb: false }), roughness: 0.9 });
  const wall = G.box(140, 3, 0.5); for (let i = 0; i < wall.uv.length; i += 2) { wall.uv[i] *= 46; wall.uv[i + 1] *= 1.2; }
  const w1 = new Mesh(ctx.geometry(wall), brickMat); M.m4translation(w1.matrix, 0, 1.5, 33); scene.add(w1);
  const w2 = new Mesh(w1.geo, brickMat); M.m4translation(w2.matrix, 0, 1.5, -36); scene.add(w2);
}

function industrialScenery(ctx, scene, rng, matte, metal, theme) {
  const f = T.facade({ wall: '#4a4642', lit: 0.12, seed: 21, cols: 4, rows: 4, glass: '#2a2f33' });
  const m = new Material({ map: ctx.texture(f.color), emissiveMap: ctx.texture(f.emissive), emissive: [2.2, 1.5, 0.8], roughness: 0.8 });
  const b = [];
  for (let i = 0; i < 6; i++) b.push(PR.building(-70 + i * 28, -52, 24, 18, 12 + rng.range(0, 6)));
  for (let i = 0; i < 5; i++) b.push(PR.building(-60 + i * 30, 48, 26, 16, 10 + rng.range(0, 8)));
  scene.add(new Mesh(ctx.geometry(G.merge(b, false)), m));
  // steel truss gantry over the plaza + crane silhouette
  const steel = '#3f4a52';
  for (let i = 0; i < 5; i++) {
    const x = -48 + i * 24;
    metal.push({ geo: G.box(0.4, 9, 0.4), matrix: M.m4translation(M.m4(), x, 4.5, -30), color: [...lin(steel), 1] });
    metal.push({ geo: G.box(0.4, 9, 0.4), matrix: M.m4translation(M.m4(), x, 4.5, 28), color: [...lin(steel), 1] });
  }
  metal.push({ geo: G.box(98, 0.5, 0.5), matrix: M.m4translation(M.m4(), 0, 9, -30), color: [...lin(steel), 1] });
  metal.push({ geo: G.box(98, 0.5, 0.5), matrix: M.m4translation(M.m4(), 0, 9, 28), color: [...lin(steel), 1] });
  metal.push({ geo: G.box(1.2, 34, 1.2), matrix: M.m4translation(M.m4(), 66, 17, 40), color: [...lin('#c8962f'), 1] });
  metal.push({ geo: G.box(40, 1.4, 1.4), matrix: M.m4translation(M.m4(), 52, 33, 40), color: [...lin('#c8962f'), 1] });
  // shipping containers
  const cc = ['#b5482f', '#2f6b8a', '#c8962f', '#4d6b3a', '#7a7f85'];
  for (let i = 0; i < 12; i++) matte.push({ geo: G.box(6, 2.6, 2.45), matrix: M.m4fromYaw(M.m4(), -60 + (i % 6) * 7, 1.3 + Math.floor(i / 6) * 2.6, -40 - (i % 3) * 3, rng.range(-0.05, 0.05)), color: [...lin(rng.pick(cc)), 1] });
}

// ---------------- Pro-Am arena ----------------
function buildArena(r, scene, theme, opts) {
  const ctx = r.ctx, rng = new RNG(31);
  const team = opts.team || {};
  const spec = { ...theme.court };
  if (team.primary) {
    spec.paint = team.primary; spec.apron = hexA(team.primary, 0.92);
    spec.logo = { shape: team.logo || 'circle', color: team.primary, accent: team.secondary || '#f6f1e6', text: (team.abbr || 'AH').slice(0, 4), size: 1.6 };
    spec.sideText = (team.name || 'AFTERHOURS').toUpperCase(); spec.baselineText = (team.abbr || 'PRO-AM').toUpperCase();
    spec.woodTone = team.wood || undefined;
  }
  const built = buildCourt(ctx, { ...spec, margin: 2.4 }, [0, 0, 0]);
  built.meshes.forEach(m => scene.add(m));
  const hoops = [1, -1].map(side => buildHoop(ctx, side, 'arena', { padColor: team.primary || '#1c3557' }));
  hoops.forEach(h => h.meshes.forEach(m => scene.add(m)));
  const mats = commonMats(ctx);
  const matte = [], metal = [], lamps = [];
  // floor surround (dark rubber)
  const surround = new Mesh(ctx.geometry(G.plane(70, 80)), new Material({ color: lin('#16181c'), roughness: 0.7 }), { castShadow: false, reflect: false });
  surround.matrix[13] = -0.004; surround.order = -2; scene.add(surround);
  // seating bowl: rows of risers on 4 sides
  const crowd = [];
  const seatCol = lin(team.secondary || '#2a3a55').map(v => v * 0.22 + 0.012);
  const W = COURT.width / 2 + 4.2, L = COURT.length / 2 + 4.2;
  const rows = 14;
  for (let rI = 0; rI < rows; rI++) {
    const y = 0.5 + rI * 0.55, off = rI * 0.85;
    const sides = [
      { x: 0, z: -(L + off), w: COURT.width + 8 + off * 2, yaw: 0 }, { x: 0, z: L + off, w: COURT.width + 8 + off * 2, yaw: Math.PI },
      { x: -(W + off), z: 0, w: COURT.length + 8 + off * 2, yaw: Math.PI / 2 }, { x: W + off, z: 0, w: COURT.length + 8 + off * 2, yaw: -Math.PI / 2 },
    ];
    for (const s of sides) {
      matte.push({ geo: G.box(s.w, 0.55, 0.85), matrix: M.m4fromYaw(M.m4(), s.x, y - 0.275, s.z, s.yaw), color: [...(rI % 2 ? seatCol : seatCol.map(v => v * 0.8)), 1] });
      // crowd members along the row
      const n = Math.floor(s.w / 0.62);
      for (let k = 0; k < n; k++) {
        if (rng.next() < 0.12) continue;
        const along = -s.w / 2 + (k + 0.5) * (s.w / n);
        const lx = Math.cos(s.yaw) * along, lz = -Math.sin(s.yaw) * along;
        crowd.push({ x: s.x + lx, y: y, z: s.z + lz, yaw: s.yaw });
      }
    }
  }
  // fascia LED ribbon
  const ledTex = cachedTexture(ctx, 'led-' + (team.name || ''), () => T.banner(`${(team.name || 'AFTERHOURS PRO-AM').toUpperCase()}  ·  PRO-AM  ·  ${(team.abbr || 'AH16').toUpperCase()}`, { w: 2048, h: 128, bg: '#06070a', color: team.primary ? '#ffffff' : '#f2c14e', size: 64 }), {});
  const ledMat = new Material({ map: ledTex, shading: 'unlit', color: [1.6, 1.6, 1.6], fog: false });
  for (const [x, z, w, yaw] of [[0, -(L - 0.2), COURT.width + 8, 0], [0, L - 0.2, COURT.width + 8, Math.PI], [-(W - 0.2), 0, COURT.length + 8, Math.PI / 2], [W - 0.2, 0, COURT.length + 8, -Math.PI / 2]]) {
    const m = new Mesh(ctx.geometry(G.quad(w, 0.5, { bottom: true })), ledMat, { castShadow: false });
    M.m4fromYaw(m.matrix, x, 0.02, z, yaw);
    scene.add(m);
  }
  // scorer's table + benches
  const tableX = -(COURT.width / 2 + 1.6);
  matte.push({ geo: G.box(0.9, 0.8, 9), matrix: M.m4translation(M.m4(), tableX, 0.4, 0), color: [...lin('#2b2f36'), 1] });
  matte.push({ geo: G.box(1.0, 0.04, 9.1), matrix: M.m4translation(M.m4(), tableX, 0.82, 0), color: [...lin('#d9d4c8'), 1] });
  // LED fascia on the court-facing side of the table
  const tableTex = cachedTexture(ctx, 'table-' + (team.name || ''), () => T.banner(`${(team.abbr || 'AH16').toUpperCase()}  ·  ${(team.name || 'AFTERHOURS').toUpperCase()}  ·  PRO-AM`, { w: 1024, h: 80, bg: '#05070b', color: team.primary ? '#ffffff' : '#f2c14e', size: 46 }), {});
  const tableLed = new Mesh(ctx.geometry(G.quad(8.6, 0.62, { bottom: true })), new Material({ map: tableTex, shading: 'unlit', color: [1.5, 1.5, 1.5], fog: false }), { castShadow: false });
  M.m4fromYaw(tableLed.matrix, tableX + 0.46, 0.1, 0, Math.PI / 2);
  scene.add(tableLed);
  for (const sz of [-1, 1]) for (let k = 0; k < 7; k++) matte.push({ geo: G.box(0.5, 0.48, 0.5), matrix: M.m4translation(M.m4(), -(COURT.width / 2 + 1.5), 0.24, sz * (4 + k * 0.65)), color: [...lin(sz < 0 ? (team.primary || '#2457c5') : '#3a3f47'), 1] });
  // v0.4.3: subs on both benches, courtside VIP row, announcers' desk dressing
  for (const sz of [-1, 1]) for (let k = 0; k < 6; k++) if (rng.next() < 0.85) crowd.push({ x: -(COURT.width / 2 + 1.5), y: 0.46, z: sz * (4.2 + k * 0.65), yaw: Math.PI / 2, s: 1.12, shirt: sz < 0 ? (team.primary || '#2457c5') : '#4a4f57' });
  for (let z = -12; z <= 12; z += 0.85) {
    if (Math.abs(z) < 1.4) continue; // camera position
    matte.push({ geo: G.box(0.5, 0.45, 0.5), matrix: M.m4translation(M.m4(), COURT.width / 2 + 1.7, 0.225, z), color: [...lin('#2a2d33'), 1] });
    if (rng.next() < 0.8) crowd.push({ x: COURT.width / 2 + 1.7, y: 0.45, z, yaw: -Math.PI / 2, vip: true });
  }
  // announcers' desk: monitors, mics, name plates (people are animated below)
  for (const z of [-2.6, -1.3, 0, 1.3, 2.6]) {
    matte.push({ geo: G.box(0.06, 0.34, 0.5), matrix: M.m4fromYaw(M.m4(), tableX - 0.18, 1.0, z + 0.32, Math.PI / 2 + 0.25), color: [...lin('#121418'), 1] });
    lamps.push({ geo: G.box(0.012, 0.28, 0.44), matrix: M.m4fromYaw(M.m4(), tableX - 0.215, 1.0, z + 0.32, Math.PI / 2 + 0.25), color: [0.35, 0.5, 0.9, 1] });
    metal.push({ geo: G.cylinder(0.012, 0.012, 0.3, 6, { y0: true }), matrix: M.m4translation(M.m4(), tableX + 0.05, 0.84, z - 0.15), color: [...lin('#202226'), 1] });
    metal.push({ geo: G.sphere(0.035, 8, 6), matrix: M.m4translation(M.m4(), tableX + 0.05, 1.16, z - 0.15), color: [...lin('#111214'), 1] });
  }
  // jumbotron
  const jumbo = makeJumbotron(ctx, scene, team);
  // ceiling & light rigs
  const ceil = new Mesh(ctx.geometry(G.plane(90, 100)), new Material({ color: lin('#0a0b0e'), roughness: 0.9 }), { castShadow: false, reflect: false });
  M.m4mul(ceil.matrix, M.m4translation(M.m4(), 0, 24, 0), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI)));
  scene.add(ceil);
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) {
    metal.push({ geo: G.box(1.6, 0.3, 0.8), matrix: M.m4translation(M.m4(), sx * 6, 21, -15 + i * 6), color: [...lin('#202328'), 1] });
    lamps.push({ geo: G.box(1.4, 0.05, 0.6), matrix: M.m4translation(M.m4(), sx * 6, 20.84, -15 + i * 6), color: [1, 1, 1, 1] });
  }
  batch(ctx, scene, matte, mats.matte);
  batch(ctx, scene, metal, mats.metal);
  batch(ctx, scene, lamps, mats.lamp, { castShadow: false });
  // instanced crowd
  const crowdMesh = makeCrowd(ctx, scene, crowd, rng, team);
  const crew = arenaCrew(ctx, scene, rng, team, tableX);
  scene.lights.length = 0;
  scene.lights.push({ pos: [0, 18, -10], range: 40, color: [1, 0.97, 0.9], intensity: 30, dir: [0, -1, 0.2], cos: 0.5 });
  scene.lights.push({ pos: [0, 18, 10], range: 40, color: [1, 0.97, 0.9], intensity: 30, dir: [0, -1, -0.2], cos: 0.5 });
  scene.lights.push({ pos: [-14, 10, 0], range: 30, color: [1, 0.9, 0.75], intensity: 8, dir: null });
  scene.lights.push({ pos: [14, 10, 0], range: 30, color: [1, 0.9, 0.75], intensity: 8, dir: null });
  scene.reflectionPlane = true;
  scene.shadowFocus = { center: [0, 0, 0], radius: 17 };
  return {
    theme, courts: [{ id: 'arena', origin: [0, 0, 0], hoops, format: 5, floor: built.floor }], hoops, jumbotron: jumbo, crowd: crowdMesh,
    bounds: { x0: -14, x1: 14, z0: -19, z1: 19 },
    // info: { ball:{x,y,z}, phase, over, hype, events }
    update(dt, info = {}) { crew.update(dt, info, scene); },
  };
}

// v0.4.3 Pro-Am life: three announcers who follow the ball and react to big plays, baseline photographers
// whose flashes pop on shots and dunks, a broadcast camera operator panning with the play, and the crowd's
// moods (clapping on dead balls and free throws, a stadium wave now and then, a standing ovation at the end).
function arenaCrew(ctx, scene, rng, team, tableX) {
  const mat = new Material({ color: [1, 1, 1], roughness: 0.75, shading: 'cloth', sheen: [0.08, 0.08, 0.08] });
  const skinMat = new Material({ color: [1, 1, 1], roughness: 0.6 });
  const flashMat = new Material({ color: [1, 1, 1], shading: 'unlit', emissive: [40, 40, 38], fog: false, blend: 'add', depthWrite: false });
  const T = (x, y, z, yaw = 0) => M.m4fromYaw(M.m4(), x, y, z, yaw);
  const c4 = h => [...lin(h), 1];
  const mk = (parts, m) => { const mesh = new Mesh(ctx.geometry(G.merge(parts)), m, { castShadow: false, reflect: false }); scene.add(mesh); return mesh; };
  const skins = ['#e9c2a0', '#c68b62', '#8d5a3b', '#5a3a28'];
  // announcers
  const people = [];
  const suits = ['#1d2430', '#2a2d33', team.primary || '#3b3f47'];
  [-1.3, 0, 1.3].forEach((z, i) => {
    const x = tableX - 0.75;
    const body = mk([
      { geo: G.box(0.5, 0.5, 0.5), matrix: T(0, 0.22, 0), color: c4('#25272c') }, // chair
      { geo: G.box(0.46, 0.62, 0.3), matrix: T(0, 0.82, 0.02), color: c4(suits[i]) },
      { geo: G.box(0.2, 0.1, 0.02), matrix: T(0, 1.02, 0.17), color: c4('#e8e3d8') }, // shirt collar
    ], mat);
    M.m4fromYaw(body.matrix, x, 0, z, Math.PI / 2);
    const head = mk([
      { geo: G.sphere(0.115, 10, 8), matrix: T(0, 0, 0), color: c4(rng.pick(skins)) },
      { geo: G.box(0.26, 0.04, 0.04), matrix: T(0, 0.08, 0), color: c4('#111214') }, // headset band
      { geo: G.box(0.03, 0.03, 0.12), matrix: T(-0.11, -0.04, 0.07), color: c4('#111214') }, // boom mic
    ], skinMat);
    const armL = mk([{ geo: G.box(0.09, 0.09, 0.42), matrix: T(0, 0, 0.21), color: c4(suits[i]) }], mat);
    const armR = mk([{ geo: G.box(0.09, 0.09, 0.42), matrix: T(0, 0, 0.21), color: c4(suits[i]) }], mat);
    people.push({ x, z, head, armL, armR, look: 0, excite: 0, talk: rng.range(0, 6) });
  });
  // baseline photographers (kneeling) with flash units
  const shooters = [];
  for (const [x, z] of [[-4.6, 15.6], [4.4, 15.7], [-4.2, -15.6], [4.8, -15.7]]) {
    const yaw = z > 0 ? Math.PI : 0;
    const body = mk([
      { geo: G.box(0.44, 0.5, 0.34), matrix: T(0, 0.55, 0), color: c4('#1b1c20') },
      { geo: G.sphere(0.11, 10, 8), matrix: T(0, 0.94, 0), color: c4(rng.pick(skins)) },
      { geo: G.box(0.36, 0.2, 0.5), matrix: T(0, 0.18, 0.12), color: c4('#2a2c31') },
      { geo: G.box(0.16, 0.13, 0.12), matrix: T(0, 0.92, 0.18), color: c4('#0c0d0f') },
      { geo: G.cylinder(0.05, 0.05, 0.22, 10), matrix: M.m4mul(M.m4(), T(0, 0.92, 0.32), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2))), color: c4('#1a1b1e') },
    ], mat);
    M.m4fromYaw(body.matrix, x, 0, z, yaw);
    const flash = mk([{ geo: G.box(0.12, 0.07, 0.03), matrix: T(0, 1.06, 0.2), color: [1, 1, 1, 1] }], flashMat);
    M.m4fromYaw(flash.matrix, x, 0, z, yaw); flash.visible = false; flash.order = 6;
    shooters.push({ x, z, flash, t: 0 });
  }
  // broadcast camera on a tripod across from the table, panning with the ball
  const camBase = mk([
    { geo: G.cylinder(0.03, 0.03, 1.3, 6, { y0: true }), matrix: T(0, 0, 0), color: c4('#2a2c31') },
    { geo: G.box(0.44, 0.5, 0.34), matrix: T(-0.5, 0.95, 0), color: c4('#22252b') }, // operator torso
    { geo: G.sphere(0.11, 10, 8), matrix: T(-0.5, 1.35, 0), color: c4(rng.pick(skins)) },
  ], mat);
  const camX = COURT.width / 2 + 1.7;
  M.m4fromYaw(camBase.matrix, camX, 0, 0, -Math.PI / 2);
  const camHead = mk([{ geo: G.box(0.3, 0.3, 0.62), matrix: T(0, 0, 0.1), color: c4('#141518') }, { geo: G.cylinder(0.1, 0.12, 0.3, 12), matrix: M.m4mul(M.m4(), T(0, 0, 0.5), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI / 2))), color: c4('#0b0c0e') }], mat);
  let waveT = 0, waveCool = rng.range(40, 70), clap = 0, wave = 0, ovation = 0, lastPhase = '';
  const fx = [0, 0, 1.6, 0];
  const pop = () => { for (const s of shooters) if (rng.next() < 0.6) s.t = rng.range(0, 0.25) - 0.12; };
  return {
    update(dt, info, sc) {
      const b = info.ball || { x: 0, y: 1, z: 0 }, hype = sc.hype || 0;
      for (const ev of info.events || []) {
        if (ev.type === 'release' || ev.type === 'slam' || ev.type === 'block') pop();
        if (ev.type === 'score' && (ev.pts === 3 || ev.kind === 'dunk')) for (const p of people) p.excite = 1.6;
      }
      // announcers: heads follow the ball, they talk (small nods), and get up off their seat on big plays
      for (const p of people) {
        p.talk += dt; p.excite = Math.max(0, p.excite - dt * 0.6);
        const want = Math.atan2(b.x - p.x, b.z - p.z);
        p.look += Math.atan2(Math.sin(want - p.look), Math.cos(want - p.look)) * Math.min(1, dt * 4);
        const nod = Math.sin(p.talk * 7) * 0.02 * (0.5 + 0.5 * Math.sin(p.talk * 0.9)), up = Math.min(1, p.excite) * 0.12;
        M.m4fromYaw(p.head.matrix, p.x + 0.02, 1.27 + nod + up, p.z, p.look);
        const raise = Math.min(1, p.excite);
        for (const [arm, s] of [[p.armL, 1], [p.armR, -1]]) {
          const m = M.m4fromYaw(arm.matrix, p.x + 0.05, 0.92 + up + raise * (s > 0 ? 0.25 : 0.1), p.z + s * 0.22, Math.PI / 2);
          if (raise > 0.1 && s > 0) { m[9] = 0.9 * raise; } // forearm up for the "OH!" call
        }
      }
      for (const s of shooters) { s.t += dt; s.flash.visible = s.t > 0 && s.t < 0.06; }
      // camera operator pans with the ball
      M.m4fromYaw(camHead.matrix, camX, 1.4, 0, Math.atan2(b.x - camX, b.z));
      // crowd moods
      const ph = info.phase || '';
      clap = M.damp(clap, ph === 'ft' || ph === 'ftflight' || ph === 'dead' || ph === 'inbound' ? 1 : 0, 3, dt);
      if (ph !== lastPhase) lastPhase = ph;
      waveCool -= dt;
      if (waveCool <= 0 && waveT <= 0 && !info.over) { waveT = 14; waveCool = rng.range(70, 120); }
      if (waveT > 0) waveT -= dt;
      wave = M.damp(wave, waveT > 1.5 ? 1 : 0, 2, dt);
      ovation = M.damp(ovation, info.over ? 1 : 0, 1.5, dt);
      fx[0] = wave; fx[1] = clap * (1 - ovation); fx[2] = 1.6; fx[3] = ovation;
      sc.crowdFx = fx;
      if (hype > 0.6) for (const p of people) p.excite = Math.max(p.excite, 0.6);
    },
  };
}

function hexA(hex, a) { const c = M.hexToRgb(hex); return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`; }

function makeCrowd(ctx, scene, seats, rng, team) {
  const geo = ctx.geometry(PR.crowdPerson());
  const data = new Float32Array(seats.length * 20);
  const shirts = ['#e8e3d8', '#2a2c31', '#b8322f', '#2457c5', team.primary || '#f2c14e', team.primary || '#3a7a4a', '#8d8f93', '#f2c14e'];
  seats.forEach((s, i) => {
    const m = M.m4fromYaw(M.m4(), s.x, s.y, s.z, s.yaw, s.s || (0.92 + rng.next() * 0.16));
    data.set(m, i * 20);
    const c = M.hexLinear(s.shirt || rng.pick(shirts)).map(v => v * (s.vip || s.shirt ? 0.8 : 0.55) + 0.01);
    data.set([c[0], c[1], c[2], rng.next()], i * 20 + 16);
  });
  ctx.setInstances(geo, data, seats.length);
  geo.bounds = { center: [0, 4, 0], radius: 40 };
  const mesh = new Mesh(geo, new Material({ color: [1, 1, 1], roughness: 0.85, crowd: true, shading: 'cloth', sheen: [0.1, 0.1, 0.1] }), { castShadow: false, reflect: false });
  scene.add(mesh);
  return mesh;
}

function makeJumbotron(ctx, scene, team) {
  const W = 1024, H = 512;
  const canvas = T.canvas(W, H);
  const tex = ctx.texture(canvas, { wrap: 'clamp' });
  const mat = new Material({ map: tex, shading: 'unlit', color: [1.5, 1.5, 1.5], fog: false });
  const frameMat = new Material({ color: lin('#121418'), roughness: 0.5, metalness: 0.5 });
  const y = 14.5;
  const body = new Mesh(ctx.geometry(G.box(7.4, 4.0, 7.4)), frameMat);
  M.m4translation(body.matrix, 0, y, 0);
  scene.add(body);
  const screens = [];
  for (let i = 0; i < 4; i++) {
    const yaw = i * Math.PI / 2;
    const m = new Mesh(ctx.geometry(G.quad(7.0, 3.5)), mat, { castShadow: false });
    M.m4fromYaw(m.matrix, Math.sin(yaw) * 3.72, y, Math.cos(yaw) * 3.72, yaw);
    scene.add(m);
    screens.push(m);
  }
  let last = '';
  return {
    draw(info) {
      const key = JSON.stringify(info);
      if (key === last) return;
      last = key;
      const g = canvas.getContext('2d');
      g.fillStyle = '#05060a'; g.fillRect(0, 0, W, H);
      g.fillStyle = team.primary || '#1e3d63'; g.fillRect(0, 0, W, 90);
      g.fillStyle = '#fff'; g.font = '900 56px "Arial Black", sans-serif'; g.textAlign = 'center'; g.fillText(info.title || 'PRO-AM', W / 2, 68);
      g.font = '900 150px "Arial Black", sans-serif';
      g.fillStyle = info.homeColor || '#f2c14e'; g.fillText(String(info.home ?? 0), W * 0.25, 300);
      g.fillStyle = info.awayColor || '#ffffff'; g.fillText(String(info.away ?? 0), W * 0.75, 300);
      g.font = '700 46px Arial, sans-serif'; g.fillStyle = '#c9ced6';
      g.fillText((info.homeName || 'HOME').slice(0, 10), W * 0.25, 380); g.fillText((info.awayName || 'AWAY').slice(0, 10), W * 0.75, 380);
      g.font = '900 64px "Arial Black", sans-serif'; g.fillStyle = '#ff4f3d'; g.fillText(info.clock || '', W / 2, 470);
      g.fillStyle = '#fff'; g.font = '700 40px Arial'; g.fillText(info.period || '', W / 2, 200);
      ctx.updateTexture(tex, canvas);
    },
  };
}

// ---------------- Practice gym ----------------
function buildGym(r, scene, theme, opts) {
  const ctx = r.ctx;
  const built = buildCourt(ctx, { ...theme.court, margin: 2.0 }, [0, 0, 0]);
  built.meshes.forEach(m => scene.add(m));
  const hoops = [1, -1].map(side => buildHoop(ctx, side, 'gym', { padColor: '#8a2b2b', shotClock: false }));
  hoops.forEach(h => h.meshes.forEach(m => scene.add(m)));
  const mats = commonMats(ctx);
  const matte = [], metal = [], lamps = [];
  const cb = T.concrete({ color: [0.72, 0.7, 0.66], joints: true });
  const wallMat = new Material({ map: ctx.texture(cb.color), normalMap: ctx.texture(cb.normal, { srgb: false }), roughness: 0.9 });
  const W = COURT.width / 2 + 6, L = COURT.length / 2 + 4, Hh = 11;
  const walls = [];
  for (const [x, z, w, yaw] of [[0, -L, W * 2, 0], [0, L, W * 2, Math.PI], [-W, 0, L * 2, Math.PI / 2], [W, 0, L * 2, -Math.PI / 2]]) {
    const g = G.quad(w, Hh, { bottom: true });
    for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] *= w / 4; g.uv[i + 1] *= Hh / 4; }
    walls.push({ geo: g, matrix: M.m4fromYaw(M.m4(), x, 0, z, yaw) });
  }
  scene.add(new Mesh(ctx.geometry(G.merge(walls, false)), wallMat, { castShadow: false }));
  const floor = new Mesh(ctx.geometry(G.plane(W * 2, L * 2)), new Material({ color: lin('#5a3f2a'), roughness: 0.5 }), { castShadow: false, reflect: false });
  floor.matrix[13] = -0.004; floor.order = -2; scene.add(floor);
  const ceil = new Mesh(ctx.geometry(G.plane(W * 2, L * 2)), new Material({ color: lin('#3a3c40'), roughness: 0.9 }), { castShadow: false, reflect: false });
  M.m4mul(ceil.matrix, M.m4translation(M.m4(), 0, Hh, 0), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI)));
  scene.add(ceil);
  // trusses + hanging lights
  for (let i = -3; i <= 3; i++) {
    metal.push({ geo: G.box(W * 2, 0.35, 0.25), matrix: M.m4translation(M.m4(), 0, Hh - 1.2, i * 5), color: [...lin('#2e3135'), 1] });
    for (const sx of [-6, 0, 6]) { metal.push({ geo: G.cylinder(0.45, 0.25, 0.4, 12, { y0: true }), matrix: M.m4translation(M.m4(), sx, Hh - 2.4, i * 5), color: [...lin('#2e3135'), 1] }); lamps.push({ geo: G.cylinder(0.43, 0.43, 0.02, 12, { y0: true }), matrix: M.m4translation(M.m4(), sx, Hh - 2.42, i * 5), color: [1, 1, 1, 1] }); }
  }
  // pulled-out bleachers along both sidelines: backs to the walls, seats facing the court (v0.4.2)
  matte.push(...PR.bleacher(-(COURT.width / 2 + 2.4), 0, Math.PI / 2, 22, 6, '#6b4a2e', '#a57a4c'));
  matte.push(...PR.bleacher(COURT.width / 2 + 2.4, 0, -Math.PI / 2, 22, 6, '#6b4a2e', '#a57a4c'));
  // banners
  const bannerTex = cachedTexture(ctx, 'gymbanner', () => T.banner('UNION', { bg: '#8a2b2b', color: '#f9ecd3', sub: 'FIELDHOUSE · EST. 1962', h: 512, w: 512, size: 150 }), {});
  for (let i = 0; i < 4; i++) {
    const m = new Mesh(ctx.geometry(G.quad(2, 2.6)), new Material({ map: bannerTex, roughness: 0.9, shading: 'cloth', doubleSided: true }), { castShadow: false });
    M.m4fromYaw(m.matrix, W - 0.05, 6.5, -12 + i * 8, -Math.PI / 2);
    scene.add(m);
  }
  // windows (emissive strips) high on the far wall
  const win = new Mesh(ctx.geometry(G.quad(W * 1.6, 1.4)), new Material({ color: [1, 1, 1], shading: 'unlit', emissive: [3.5, 3.6, 3.8], fog: false }), { castShadow: false });
  M.m4fromYaw(win.matrix, 0, 8.5, L - 0.05, Math.PI);
  scene.add(win);
  batch(ctx, scene, matte, mats.matte);
  batch(ctx, scene, metal, mats.metal);
  batch(ctx, scene, lamps, mats.lamp, { castShadow: false });
  scene.lights.length = 0;
  scene.lights.push({ pos: [0, 9, -6], range: 26, color: [1, 0.98, 0.94], intensity: 12, dir: null });
  scene.lights.push({ pos: [0, 9, 8], range: 26, color: [1, 0.98, 0.94], intensity: 12, dir: null });
  scene.reflectionPlane = true;
  scene.shadowFocus = { center: [0, 0, 7], radius: 15 };
  return { theme, courts: [{ id: 'gym', origin: [0, 0, 0], hoops, format: 1, floor: built.floor }], hoops, bounds: { x0: -W + 1, x1: W - 1, z0: -L + 1, z1: L - 1 }, update() { } };
}
