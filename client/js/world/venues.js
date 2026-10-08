// Venue scene builders: affiliation parks (3 courts, Got Next spots, life), Pro-Am arena, practice gym.
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { buildCourt, buildHoop, cachedTexture } from './court.js';
import * as PR from './props.js';
import { createParkLife } from './parklife.js';
import { THEMES, PARK_COURTS, squadSpots, AFFILIATIONS, parkInfo, PARK_HQ, HQ } from './themes.js';
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
  if (theme.kind === 'hq') return buildHQ(r, scene, theme, opts);
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
  const matte = [], metal = [], foliage = [], lamps = [], neon = [];
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
    const tut = theme.style === 'tut';
    const hs = (full ? [1, -1] : [1]).map(side => buildHoop(ctx, side, 'park', { origin: c.origin, rimColor: tut ? '#e8c15a' : theme.id === 'foundry' ? '#d8a21c' : '#d8431c', poleColor: tut ? '#1c1428' : theme.id === 'harbor' ? '#2f5f63' : '#3a4249', netColor: tut ? '#b8ffd8' : theme.id === 'brick' ? '#dcdcd6' : '#f4f4f0' }));
    // v0.4.5 King Tut Cup: the lines glow (an additive neon copy of the markings laid over the court)
    if (theme.court.neon) {
      const nz = theme.court.neon;
      const key = 'neonlines-' + (full ? 'f' : 'h') + c.format;
      const tex = cachedTexture(ctx, key, () => T.courtOverlay({ ...spec, court: '#000000', apron: '#000000', paint: '#000000', arcTint: null, wear: 0, lines: nz.lines, logo: { ...spec.logo, color: '#000000', accent: nz.text }, keyText: '', asphaltTint: null }).canvas, { wrap: 'clamp' });
      const ov = built.overlay, z0 = full ? -ov.length / 2 : -2.2, z1 = ov.length / 2;
      const geo = G.plane(ov.width, z1 - z0, 1, 1);
      // overlay UVs: map the plane onto the overlay texture's rect
      for (let i = 0; i < geo.uv.length; i += 2) { const x = geo.position[(i / 2) * 3], z = geo.position[(i / 2) * 3 + 2] + (z0 + z1) / 2; geo.uv[i] = x / ov.width + 0.5; geo.uv[i + 1] = z / ov.length + 0.5; }
      if (!full) for (let i = 2; i < geo.position.length; i += 3) geo.position[i] += (z0 + z1) / 2;
      const glowLines = new Mesh(ctx.geometry(geo), new Material({ map: tex, color: [2.4, 2.4, 2.4], shading: 'unlit', blend: 'add', depthWrite: false, fog: false }), { castShadow: false, reflect: false });
      M.m4translation(glowLines.matrix, c.origin[0], 0.006, c.origin[2]);
      glowLines.order = 4;
      scene.add(glowLines);
    }
    hs.forEach(h => h.meshes.forEach(m => scene.add(m)));
    hoops.push(...hs);
    const rows = squadSpots(c);
    courts.push({ ...c, hoops: hs, floor: built.floor, rows, spots: rows[0] });
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
    for (let k = 0; k < nb; k++) matte.push(...PR.bench(ox - W + 0.9, (full ? oz - 9 : oz + 4) + k * 6, Math.PI / 2, theme.id === 'harbor' ? '#b58a5c' : tut ? '#3a2a1a' : '#8a5f3a', tut ? '#1c1428' : undefined));
    if (tut) {
      // neon strips along the fence bottoms (laser-tag arena trim)
      for (const [x0, z0, x1, z1] of runs) {
        const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
        neon.push({ geo: G.box(0.06, 0.06, len), matrix: M.m4fromYaw(M.m4(), (x0 + x1) / 2, 0.12, (z0 + z1) / 2, yaw), color: [...lin(c.format === 3 ? '#39ff88' : '#b14dff'), 1] });
      }
    }
    matte.push(...PR.bench(ox + W + 1.6, oz + (full ? -6 : 0), -Math.PI / 2));
    matte.push(...PR.trashCan(ox + W + 1.4, oz + 12));
    // v0.4.5: the two small bleachers that stood between the main court and the stores are gone; spectators
    // now sit on the benches and stand along the sidelines of every court (game/park.js)
  }
  scene.add(new Mesh(ctx.geometry(G.merge(fenceRuns, false)), new Material({ color: [0.75, 0.78, 0.8], map: fenceTex, alphaTest: 0.5, doubleSided: true, roughness: 0.4, metalness: 0.6 }), { castShadow: true }));
  // Got Next spot rings
  const ringTex = cachedTexture(ctx, 'ring', () => T.ringTexture(256), { wrap: 'clamp' });
  const gotNextMat = new Material({ color: lin(parkInfo(theme.id)?.color || '#ffffff'), map: ringTex, shading: 'unlit', emissive: [0, 0, 0], blend: 'add', depthWrite: false, fog: false });
  // v0.4.5 squad spots: the GOT NEXT row glows, the 2ND and 3RD rows behind it are smaller and dimmer, and a
  // stencil on the ground names each row
  const ringParts = [], ringParts2 = [];
  for (const c of courts) c.rows.forEach((row, r) => { for (const s of row) (r ? ringParts2 : ringParts).push({ geo: G.plane(r ? 1.05 : 1.3, r ? 1.05 : 1.3), matrix: M.m4translation(M.m4(), s.x, 0.02, s.z) }); });
  const gotNext = new Mesh(ctx.geometry(G.merge(ringParts, false)), gotNextMat, { castShadow: false, reflect: false });
  gotNext.order = 5;
  scene.add(gotNext);
  const laterMat = new Material({ color: lin(parkInfo(theme.id)?.color || '#ffffff').map(v => v * 0.55), map: ringTex, shading: 'unlit', emissive: [0, 0, 0], blend: 'add', depthWrite: false, fog: false });
  const later = new Mesh(ctx.geometry(G.merge(ringParts2, false)), laterMat, { castShadow: false, reflect: false });
  later.order = 5;
  scene.add(later);
  ['GOT NEXT', '2ND', '3RD'].forEach((label, r) => {
    const tex = cachedTexture(ctx, 'floorlabel-' + r, () => T.floorLabel(label), { wrap: 'clamp' });
    const parts = [];
    for (const c of courts) {
      const row = c.rows[r]; if (!row) continue;
      const a = row[0], b = row[row.length - 1], along = Math.abs(b.z - a.z) > 0.1 || row.length === 1;
      // lying flat just before the row's first circle, reading toward the court
      const m = M.m4mul(M.m4(), M.m4translation(M.m4(), a.x, 0.021, a.z - (along ? (r ? 0.55 : 0.95) + 0.8 : 1.1)), M.m4fromYaw(M.m4(), 0, 0, 0, along ? Math.PI / 2 : 0));
      parts.push({ geo: G.plane(r ? 1.1 : 1.9, r ? 0.28 : 0.42), matrix: m });
    }
    const mesh = new Mesh(ctx.geometry(G.merge(parts, false)), new Material({ map: tex, color: [r ? 0.55 : 0.85, r ? 0.55 : 0.85, r ? 0.55 : 0.85], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, emissive: [0, 0, 0] }), { castShadow: false, reflect: false });
    mesh.order = 5; scene.add(mesh);
  });
  // practice hoop slab (east annex, north of the 1v1 court)
  const prOrigin = [52, 0, 16];
  const practiceHoop = buildHoop(ctx, 1, 'park', { origin: [prOrigin[0], 0, prOrigin[2] - COURT.hoopZ + 4], rimColor: '#d8431c' });
  practiceHoop.meshes.forEach(m => scene.add(m));
  hoops.push(practiceHoop);
  matte.push({ geo: G.box(10, 0.04, 9), matrix: M.m4translation(M.m4(), prOrigin[0], 0.02, prOrigin[2] + 0.5), color: [...lin(theme.court.court), 1] });
  matte.push(...PR.ballRack(prOrigin[0] - 4, prOrigin[2] - 2, Math.PI / 2));
  // south plaza: Daily Spin wheel | VC Store | Boosts, side by side
  const storePos = [0, -24], wheelPos = [-6.2, -24], boostPos = [6.2, -24];
  const affColor = parkInfo(theme.id)?.color || '#e0482f';
  matte.push(...PR.kiosk(storePos[0], storePos[1], 0, affColor, 'store', rng));
  matte.push(...PR.kiosk(boostPos[0], boostPos[1], 0, '#2f8f6b', 'boost', rng));
  const signs = [
    [storePos, 'storesign', () => T.banner('VC STORE', { bg: '#121418', color: '#f2c14e', stripe: '#e0482f', sub: 'APPAREL · SHOES · ANIMATIONS' })],
    [boostPos, 'boostsign', () => T.banner('BOOSTS', { bg: '#0f1a16', color: '#7ff0b8', stripe: '#2f8f6b', sub: 'SHOOTING · FINISHING · DEFENSE · MORE' })],
    [wheelPos, 'wheelsign', () => T.banner('DAILY SPIN', { bg: '#1a1210', color: '#ffd84a', stripe: affColor, sub: 'ONE FREE SPIN EVERY 24 HOURS' })],
  ];
  for (const [pos, key, make] of signs) {
    const signTex = cachedTexture(ctx, key, make, {});
    const sign = new Mesh(ctx.geometry(G.quad(3.8, 0.95)), new Material({ map: signTex, shading: 'unlit', color: [1.4, 1.4, 1.4], fog: false }), { castShadow: false });
    M.m4translation(sign.matrix, pos[0], key === 'wheelsign' ? 4.35 : 3.72, pos[1] + (key === 'wheelsign' ? 0.2 : 2.33));
    scene.add(sign);
    if (key !== 'wheelsign') {
      const sign2 = new Mesh(sign.geo, sign.material, { castShadow: false });
      M.m4mul(sign2.matrix, M.m4translation(M.m4(), pos[0], 3.72, pos[1] - 2.33), M.m4fromYaw(M.m4(), 0, 0, 0, Math.PI));
      scene.add(sign2);
    }
  }
  const wheel = PR.prizeWheel(ctx, wheelPos[0], wheelPos[1], affColor);
  for (const m of wheel.meshes) scene.add(m);
  // v0.4.5 Crews: the Crew HQ clubhouse on the plaza; walk up to its door to go in (or start a crew)
  const hq = PR.crewHQ(PARK_HQ.x, PARK_HQ.z, affColor), HS = PR.HQ_SIZE;
  matte.push(...hq.parts);
  batch(ctx, scene, hq.glow, new Material({ color: [1.5, 1.5, 1.5], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
  const hqSign = new Mesh(ctx.geometry(G.quad(3.4, 0.85)), new Material({ map: cachedTexture(ctx, 'hqsign-' + theme.id, () => T.banner('CREW HQ', { bg: '#121418', color: '#f4f1ea', stripe: affColor, sub: 'MEMBERS ONLY · 5-ON-5 · SHOOTAROUND' }), {}), shading: 'unlit', color: [1.4, 1.4, 1.4], fog: false }), { castShadow: false });
  M.m4translation(hqSign.matrix, PARK_HQ.x, 3.75, PARK_HQ.z + HS.d / 2 + 0.03);
  scene.add(hqSign);
  // perimeter scenery by style
  const lightsOut = [];
  let board = null;
  if (theme.style === 'coast') coastScenery(ctx, scene, rng, matte, metal, foliage);
  else if (theme.style === 'city') cityScenery(ctx, scene, rng, matte, metal, theme);
  else if (theme.style === 'tut') board = tutScenery(ctx, scene, rng, matte, metal, neon, foliage);
  else industrialScenery(ctx, scene, rng, matte, metal, theme);
  // trees/palms scattered around plaza
  for (let i = 0; i < 14; i++) {
    const x = rng.range(-50, 50), z = rng.next() < 0.5 ? rng.range(-34, -22) : rng.range(20, 30);
    if (Math.abs(x) < 10 && z < -18) continue;
    if (Math.abs(x) > 38 && z > 18) continue; // annex courts / practice slab
    if (theme.style === 'tut' && (z > 18 || (x < -30 && z < -30))) continue; // mini-golf strip / leaderboard
    if (Math.abs(x - PARK_HQ.x) < 6.5 && z < -20) continue; // the Crew HQ
    if (theme.style === 'coast' || theme.style === 'tut') foliage.push(...PR.palm(x, z, theme.style === 'tut' ? 0.85 : 1, rng)); else foliage.push(...PR.tree(x, z, 0.9 + rng.next() * 0.4, rng, theme.style === 'industrial' ? '#55623d' : '#3f6b3a'));
  }
  for (let i = 0; i < 10; i++) metal.push(...PR.streetLamp(-40 + i * 9, -27, 5.5, theme.style === 'tut' ? '#1c1428' : undefined));
  // murals on a wall behind the west court
  const muralTex = cachedTexture(ctx, 'mural-' + theme.id, () => T.mural(theme.id === 'kingtut' ? 'KING TUT' : AFFILIATIONS[theme.id]?.park?.split(' ')[0]?.toUpperCase() || 'AFTERHOURS', { seed: theme.id.length * 11, palette: theme.id === 'harbor' ? ['#ef7d3c', '#ffd25e', '#0d8a8f', '#d1386b', '#fff4e0'] : theme.id === 'brick' ? ['#b8322f', '#f0e2c4', '#f2c14e', '#3b6fb5', '#fafafa'] : theme.id === 'kingtut' ? ['#39ff88', '#b14dff', '#e8c15a', '#2fd3ff', '#14101f'] : ['#f2c14e', '#3b5873', '#e05a2f', '#9ab3c9', '#f4efe3'] }), {});
  const wall = new Mesh(ctx.geometry(G.box(18, 6, 0.6)), new Material({ map: muralTex, roughness: 0.85, color: [1, 1, 1] }));
  M.m4mul(wall.matrix, M.m4translation(M.m4(), -66, 3, -4), M.m4fromYaw(M.m4(), 0, 0, 0, Math.PI / 2));
  scene.add(wall);
  batch(ctx, scene, matte, mats.matte);
  batch(ctx, scene, metal, mats.metal);
  batch(ctx, scene, foliage, mats.foliage);
  batch(ctx, scene, lamps, mats.lamp, { castShadow: false });
  // v0.4.5 neon (King Tut Cup): unlit and bright enough to bloom; vertex colors give each piece its hue
  batch(ctx, scene, neon, new Material({ color: [2.6, 2.6, 2.6], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
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
    boosts: { x: boostPos[0], z: boostPos[1] + 2.4 }, wheel: { x: wheelPos[0], z: wheelPos[1] + 2.2, obj: wheel }, board,
    hq: { x: PARK_HQ.x, z: PARK_HQ.z + HS.d / 2 + 1.1 },
    solids: [storePos, boostPos].map(q => ({ x0: q[0] - 2.9, x1: q[0] + 2.9, z0: q[1] - 1.75, z1: q[1] + 1.75, h: 3.3 })).concat([{ x0: wheelPos[0] - 1.6, x1: wheelPos[0] + 1.6, z0: wheelPos[1] - 0.8, z1: wheelPos[1] + 0.8, h: 4 }],
      [{ x0: PARK_HQ.x - HS.w / 2 - 0.1, x1: PARK_HQ.x + HS.w / 2 + 0.1, z0: PARK_HQ.z - HS.d / 2 - 0.1, z1: PARK_HQ.z + HS.d / 2 + 0.05, h: HS.h + 0.3 }], board?.solids || []),
    bounds: { x0: -63, x1: 63, z0: -34, z1: 32 },
    update(dt) {
      t += dt;
      for (const [m, su, sv] of water_anim) { m.uvOffset[0] = (m.uvOffset[0] + su * dt) % 1; m.uvOffset[1] = (m.uvOffset[1] + sv * dt) % 1; }
      wheel.update(dt);
      life.update(dt);
      if (board) board.update(dt);
      gotNextMat.emissive = [0, 0, 0];
      gotNextMat.opacity = 0.7 + Math.sin(t * 3) * 0.25;
    },
  };
}

// materials whose UVs scroll every frame (water, surf)
const water_anim = [];
function coastScenery(ctx, scene, rng, matte, metal, foliage) {
  water_anim.length = 0;
  // ocean beyond the north boardwalk
  // v0.4.5: real water. Two scrolling swell layers (crossing each other) over a deep-blue base, plus a line
  // of surf where it meets the sand.
  const water = G.plane(400, 160, 1, 1);
  for (let i = 0; i < water.uv.length; i += 2) { water.uv[i] *= 34; water.uv[i + 1] *= 14; }
  const wn = cachedTexture(ctx, 'waterN2', () => T.waterNormal({ seed: 41 }), { srgb: false });
  const seaMat = new Material({ color: lin('#15566e'), normalMap: wn, normalScale: 0.65, roughness: 0.07, specular: 1.5, metalness: 0.08 });
  const sea = new Mesh(ctx.geometry(water), seaMat, { castShadow: false, reflect: false });
  M.m4translation(sea.matrix, 0, -0.6, 115);
  scene.add(sea);
  const water2 = G.plane(400, 160, 1, 1);
  for (let i = 0; i < water2.uv.length; i += 2) { water2.uv[i] *= 19; water2.uv[i + 1] *= 9; }
  const seaMat2 = new Material({ color: lin('#2b7f92'), normalMap: wn, normalScale: 0.5, roughness: 0.1, specular: 1.3, blend: 'alpha', opacity: 0.4, depthWrite: false });
  const sea2 = new Mesh(ctx.geometry(water2), seaMat2, { castShadow: false, reflect: false });
  M.m4translation(sea2.matrix, 0, -0.55, 115);
  sea2.order = 1;
  scene.add(sea2);
  // surf line along the beach
  const surf = G.plane(400, 5, 1, 1);
  for (let i = 0; i < surf.uv.length; i += 2) { surf.uv[i] *= 46; surf.uv[i + 1] *= 1; }
  const surfMat = new Material({ color: [1.1, 1.15, 1.18], normalMap: wn, normalScale: 0.3, roughness: 0.25, blend: 'alpha', opacity: 0.55, depthWrite: false });
  const surfM = new Mesh(ctx.geometry(surf), surfMat, { castShadow: false, reflect: false });
  M.m4translation(surfM.matrix, 0, -0.5, 36.5);
  surfM.order = 2;
  scene.add(surfM);
  water_anim.push([seaMat, 0.016, 0.03], [seaMat2, -0.026, 0.018], [surfMat, 0.0, 0.14]);
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

// ---------------- v0.4.5 The King Tut Cup ----------------
// Pyramids with neon edges on the skyline, two sphinxes guarding the plaza, obelisks with glowing cartouches,
// braziers, a glow-in-the-dark mini-golf strip along the north edge and laser-tag barriers (with dark gaps
// between them) around the outside. Returns the plaza leaderboard billboard.
const NEON = { green: '#39ff88', purple: '#b14dff', gold: '#e8c15a', cyan: '#2fd3ff', pink: '#ff4fd8', orange: '#ff8a2a' };
function tutScenery(ctx, scene, rng, matte, metal, neon, foliage) {
  const c4 = h => [...lin(h), 1];
  const stone = '#2b2336', stoneLit = '#3a2f48', sand = '#2a2030';
  const glow = (geo, matrix, hex) => neon.push({ geo, matrix, color: c4(hex) });
  const edge = (a, b, hex, r = 0.1) => neon.push({ geo: G.tube([a, b], r, 6), color: c4(hex) });
  // sand dunes beyond the park, low and dark
  for (let i = 0; i < 14; i++) {
    const x = rng.range(-150, 150), z = rng.next() < 0.5 ? rng.range(45, 110) : rng.range(-110, -48);
    matte.push({ geo: G.sphere(1, 14, 8), matrix: M.m4compose(M.m4(), [x, -2, z], M.q4(), [rng.range(16, 34), rng.range(3, 6), rng.range(10, 20)]), color: c4(sand) });
  }
  // pyramids: square base (a 4-sided cone turned 45°), neon edges, a gold glowing capstone
  const pyramid = (x, z, half, h, edgeHex) => {
    matte.push({ geo: G.cylinder(0.01, half * Math.SQRT2, h, 4, { y0: true }), matrix: M.m4fromYaw(M.m4(), x, 0, z, Math.PI / 4), color: c4(stone) });
    const top = [x, h, z];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) edge([x + sx * half, 0.05, z + sz * half], top, edgeHex, Math.max(0.12, h * 0.006));
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) edge([x + a[0] * half, 0.08, z + a[1] * half], [x + b[0] * half, 0.08, z + b[1] * half], edgeHex, Math.max(0.12, h * 0.005));
    glow(G.cylinder(0.01, h * 0.06 * Math.SQRT2, h * 0.06, 4, { y0: true }), M.m4fromYaw(M.m4(), x, h * 0.94, z, Math.PI / 4), NEON.gold);
  };
  pyramid(-48, 82, 26, 36, NEON.green);
  pyramid(8, 104, 36, 50, NEON.purple);
  pyramid(62, 78, 20, 28, NEON.green);
  pyramid(-70, -72, 16, 22, NEON.purple);
  pyramid(58, -66, 14, 19, NEON.cyan);
  // sphinxes guarding the plaza, facing into the park
  const sphinx = (x, z, yaw, k) => {
    const at = (dx, dy, dz) => M.m4mul(M.m4(), M.m4fromYaw(M.m4(), x, 0, z, yaw), M.m4translation(M.m4(), dx * k, dy * k, dz * k));
    const put = (geo, dx, dy, dz, hex) => matte.push({ geo, matrix: at(dx, dy, dz), color: c4(hex) });
    put(G.box(3.2 * k, 0.5 * k, 7.6 * k), 0, 0.25, 0.2, stoneLit);            // plinth
    put(G.box(2.3 * k, 1.7 * k, 4.4 * k), 0, 1.35, -0.9, stone);              // body
    put(G.sphere(1.25 * k, 12, 9), 0, 1.6, -2.7, stone);                       // haunches
    for (const sx of [-0.62, 0.62]) {
      put(G.box(0.62 * k, 0.55 * k, 3.0 * k), sx, 0.78, 2.4, stone);          // front legs
      put(G.box(0.7 * k, 0.32 * k, 0.75 * k), sx, 0.66, 3.75, stoneLit);      // paws
    }
    put(G.box(1.9 * k, 1.9 * k, 1.5 * k), 0, 2.5, 1.2, stone);                // chest
    put(G.box(1.25 * k, 1.35 * k, 1.2 * k), 0, 3.75, 1.45, stoneLit);         // head
    put(G.box(2.1 * k, 1.5 * k, 0.9 * k), 0, 3.85, 1.05, '#3b2e1c'); // nemes headdress
    for (const sx of [-0.88, 0.88]) put(G.box(0.42 * k, 1.9 * k, 0.6 * k), sx, 3.0, 1.35, '#3b2e1c'); // lappets
    // neon: headdress stripes, eyes, outline along the back
    for (let i = 0; i < 5; i++) glow(G.box(2.14 * k, 0.06 * k, 0.94 * k), at(0, 3.3 + i * 0.26, 1.05), i % 2 ? NEON.cyan : NEON.gold);
    for (const sx of [-0.28, 0.28]) glow(G.box(0.22 * k, 0.09 * k, 0.05 * k), at(sx, 3.95, 2.06), NEON.green);
    for (const [a, b] of [[[0, 2.25, -3.8], [0, 2.25, 0.4]], [[-1.15, 0.52, -3.6], [-1.15, 0.52, 3.9]], [[1.15, 0.52, -3.6], [1.15, 0.52, 3.9]]]) {
      const pa = at(a[0], a[1], a[2]), pb = at(b[0], b[1], b[2]);
      edge([pa[12], pa[13], pa[14]], [pb[12], pb[13], pb[14]], NEON.purple, 0.05 * k);
    }
  };
  sphinx(-24, -40, 0, 1.25);
  sphinx(24, -40, 0, 1.25);
  // obelisks with glowing cartouche bands and a gold pyramidion
  const obelisk = (x, z, h) => {
    matte.push({ geo: G.cylinder(0.42, 0.62, h, 4, { y0: true }), matrix: M.m4fromYaw(M.m4(), x, 0, z, Math.PI / 4), color: c4(stoneLit) });
    glow(G.cylinder(0.01, 0.45, 0.8, 4, { y0: true }), M.m4fromYaw(M.m4(), x, h, z, Math.PI / 4), NEON.gold);
    for (let i = 0; i < 4; i++) glow(G.box(0.95 - i * 0.06, 0.07, 0.95 - i * 0.06), M.m4translation(M.m4(), x, 1.2 + i * h * 0.21, z), i % 2 ? NEON.green : NEON.purple);
  };
  for (const [x, z] of [[-60, -31], [60, -31], [-60, 28], [60, 28], [-12, -33.5], [12, -33.5]]) obelisk(x, z, 8 + (Math.abs(x) > 30 ? 3 : 0));
  // braziers with green fire (the fire is glow; the bowls are metal)
  for (const [x, z] of [[-18, -33], [18, -33], [-33, 31], [33, 31], [-66, 0], [66, 0]]) {
    metal.push({ geo: G.cylinder(0.08, 0.12, 1.2, 8, { y0: true }), matrix: M.m4translation(M.m4(), x, 0, z), color: c4('#3b2e1c') });
    metal.push({ geo: G.cylinder(0.5, 0.2, 0.32, 12, { y0: true }), matrix: M.m4translation(M.m4(), x, 1.2, z), color: c4('#6b5226') });
    glow(G.cylinder(0.03, 0.4, 0.6, 9, { y0: true }), M.m4translation(M.m4(), x, 1.5, z), NEON.green);
    glow(G.cylinder(0.02, 0.22, 0.95, 7, { y0: true }), M.m4translation(M.m4(), x, 1.5, z), '#c8ffe0');
  }
  // mini-golf strip along the north edge: dark felt greens with neon borders, little pyramid and sphinx-head
  // obstacles, glowing cups and flags
  for (let i = 0; i < 4; i++) {
    const x = -45 + i * 30, z = 25.5, w = 9, d = 4.5;
    matte.push({ geo: G.box(w, 0.08, d), matrix: M.m4translation(M.m4(), x, 0.04, z), color: c4('#0f2a1c') });
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) edge([x + a[0] * w / 2, 0.14, z + a[1] * d / 2], [x + b[0] * w / 2, 0.14, z + b[1] * d / 2], i % 2 ? NEON.pink : NEON.cyan, 0.06);
    matte.push({ geo: G.cylinder(0.01, 0.9, 1.0, 4, { y0: true }), matrix: M.m4fromYaw(M.m4(), x - 1.5, 0.08, z, Math.PI / 4), color: c4(stoneLit) });
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) edge([x - 1.5 + sx * 0.64, 0.1, z + sz * 0.64], [x - 1.5, 1.08, z], NEON.gold, 0.025);
    glow(G.cylinder(0.12, 0.12, 0.02, 12, { y0: true }), M.m4translation(M.m4(), x + 3.2, 0.09, z + 0.8), NEON.green);
    metal.push({ geo: G.cylinder(0.02, 0.02, 1.1, 6, { y0: true }), matrix: M.m4translation(M.m4(), x + 3.2, 0.08, z + 0.8), color: c4('#e8e3d8') });
    glow(G.box(0.02, 0.3, 0.42), M.m4translation(M.m4(), x + 3.2, 1.0, z + 1.02), i % 2 ? NEON.purple : NEON.green);
  }
  // laser-tag barriers outside the park: staggered dark panels with neon stripes and dark gaps between them
  const barrier = (x, z, yaw, w, h) => {
    matte.push({ geo: G.box(w, h, 0.5), matrix: M.m4fromYaw(M.m4(), x, h / 2, z, yaw), color: c4('#16121f') });
    glow(G.box(w * 0.92, 0.07, 0.52), M.m4fromYaw(M.m4(), x, h * 0.33, z, yaw), rng.pick([NEON.green, NEON.purple, NEON.cyan, NEON.pink]));
    glow(G.box(0.07, h * 0.6, 0.52), M.m4fromYaw(M.m4(), x + Math.cos(yaw) * w * 0.38, h * 0.55, z - Math.sin(yaw) * w * 0.38, yaw), NEON.green);
  };
  for (let i = 0; i < 12; i++) { const z = -30 + i * 5.4; barrier(-68 - (i % 2) * 1.6, z, Math.PI / 2, 4, 2.4 + (i % 3) * 0.5); barrier(68 + (i % 2) * 1.6, z, Math.PI / 2, 4, 2.4 + ((i + 1) % 3) * 0.5); }
  for (let i = 0; i < 16; i++) { const x = -64 + i * 8.5; barrier(x, 35 + (i % 2) * 1.8, 0, 6, 2.2 + (i % 3) * 0.6); }
  // neon arrows on the plaza floor, leading from the entrance to the courts (mini-golf course markings)
  for (let i = 0; i < 6; i++) {
    const z = -33 + i * 1.6;
    for (const sx of [-1, 1]) glow(G.box(0.8, 0.012, 0.08), M.m4fromYaw(M.m4(), sx * 0.27, 0.012, z, sx * 0.9), NEON.green);
  }
  // the leaderboard billboard behind the plaza (canvas texture; park.js feeds it the standings)
  const bw = 9, bh = 4.6, bx = -38, bz = -33.6;
  metal.push({ geo: G.box(0.3, 3.2, 0.3), matrix: M.m4translation(M.m4(), bx - 3.5, 0, bz), color: c4('#1c1428') });
  metal.push({ geo: G.box(0.3, 3.2, 0.3), matrix: M.m4translation(M.m4(), bx + 3.5, 0, bz), color: c4('#1c1428') });
  matte.push({ geo: G.box(bw + 0.5, bh + 0.5, 0.3), matrix: M.m4translation(M.m4(), bx, 3.2 + bh / 2, bz - 0.2), color: c4('#0d0a14') });
  for (const [a, b] of [[[-1, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, 0]]]) edge([bx + a[0] * (bw / 2 + 0.25), 3.2 - 0.25 + a[1] * (bh + 0.5), bz - 0.02], [bx + b[0] * (bw / 2 + 0.25), 3.2 - 0.25 + b[1] * (bh + 0.5), bz - 0.02], NEON.gold, 0.06);
  const cvs = T.canvas(1024, 520);
  const tex = ctx.texture(cvs, { wrap: 'clamp' });
  const screen = new Mesh(ctx.geometry(G.quad(bw, bh)), new Material({ map: tex, color: [1.5, 1.5, 1.5], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
  M.m4translation(screen.matrix, bx, 3.2 + bh / 2, bz);
  scene.add(screen);
  let data = null, dirty = true, tick = 0;
  const draw = () => {
    const g = cvs.getContext('2d'), W = cvs.width, H = cvs.height;
    g.fillStyle = '#07050d'; g.fillRect(0, 0, W, H);
    g.fillStyle = NEON.gold; g.font = '900 54px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('KING TUT CUP', W / 2, 46);
    g.font = '700 24px Arial, sans-serif'; g.fillStyle = NEON.green;
    const left = data ? Math.max(0, (data.end - Date.now()) / 1000) : 0; // data.end is in ms
    g.fillText(data ? `LEADERBOARD · NET VC WON · ENDS IN ${Math.floor(left / 3600)}h ${String(Math.floor(left % 3600 / 60)).padStart(2, '0')}m` : 'LEADERBOARD', W / 2, 96);
    const rows = data?.rows || [];
    g.textAlign = 'left'; g.font = '700 30px Arial, sans-serif';
    rows.slice(0, 6).forEach((r, i) => {
      const y = 150 + i * 52, me = r.me;
      if (me) { g.fillStyle = 'rgba(57,255,136,0.18)'; g.fillRect(40, y - 24, W - 80, 48); }
      g.fillStyle = i === 0 ? NEON.gold : me ? NEON.green : '#d9d0f2';
      g.fillText(`${r.rank}`, 60, y); g.fillText(r.name.slice(0, 22), 140, y);
      g.textAlign = 'right'; g.fillText(`${r.net >= 0 ? '' : '−'}${Math.abs(r.net).toLocaleString()} VC`, W - 60, y); g.textAlign = 'left';
    });
    if (!rows.length) { g.textAlign = 'center'; g.fillStyle = '#d9d0f2'; g.fillText('Loading the standings…', W / 2, 260); }
    g.fillStyle = NEON.purple; g.fillRect(0, H - 10, W, 10);
    ctx.updateTexture(tex, cvs);
  };
  return {
    // the mini-golf pyramids and the billboard posts are solid (nobody walks through them)
    solids: [-45, -15, 15, 45].map(x => ({ x0: x - 1.5 - 0.7, x1: x - 1.5 + 0.7, z0: 25.5 - 0.7, z1: 25.5 + 0.7, h: 1.1 })),
    set(d) { data = d; dirty = true; },
    update(dt) { tick += dt; if (dirty || tick > 30) { dirty = false; tick = 0; draw(); } },
  };
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
    spec.sideText = (team.name || 'AFTERHOURS').toUpperCase(); spec.baselineText = (opts.baseline || team.abbr || 'PRO-AM').toUpperCase();
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
  const label = (opts.label || 'PRO-AM').toUpperCase(); // v0.4.5: the Pro Run's college and pro arenas say so
  const ledTex = cachedTexture(ctx, 'led-' + (team.name || '') + label, () => T.banner(`${(team.name || 'AFTERHOURS PRO-AM').toUpperCase()}  ·  ${label}  ·  ${(team.abbr || 'AH16').toUpperCase()}`, { w: 2048, h: 128, bg: '#06070a', color: team.primary ? '#ffffff' : '#f2c14e', size: 64 }), {});
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
  const tableTex = cachedTexture(ctx, 'table-' + (team.name || '') + label, () => T.banner(`${(team.abbr || 'AH16').toUpperCase()}  ·  ${(team.name || 'AFTERHOURS').toUpperCase()}  ·  ${label}`, { w: 1024, h: 80, bg: '#05070b', color: team.primary ? '#ffffff' : '#f2c14e', size: 46 }), {});
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

// ---------------- v0.4.5 Crew HQ ----------------
// The crew's clubhouse: a full 5-on-5 court and a shootaround half court in the crew's colors, a lounge with
// couches facing the members board, the crew level board, a taped-off "coming soon" corner for interior
// customization, and the exit door back to the park. opts.crew = { name, tag, color }. The two boards are
// live canvases (game/crewhq.js feeds them).
const readable = hex => { const c = M.hexToRgb(hex); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.6 ? '#15171b' : '#f4f1ea'; };
function buildHQ(r, scene, theme, opts) {
  const ctx = r.ctx, crew = opts.crew || { name: 'Crew', tag: 'HQ', color: '#2457c5' };
  const cc = crew.color || '#2457c5', ink = readable(cc), tag = (crew.tag || 'HQ').slice(0, 4), name = (crew.name || 'Crew').toUpperCase();
  const c4 = h => [...lin(h), 1];
  const mats = commonMats(ctx);
  const matte = [], metal = [], lamps = [], glow = [];
  const { walls: Wl } = HQ;
  // courts: paint, logo and wordmarks in the crew's colors
  const spec = { ...theme.court, paint: cc, logo: { shape: 'circle', color: cc, accent: ink === '#15171b' ? '#15171b' : '#f4f1ea', text: tag, size: 1.45 }, baselineText: name.slice(0, 18), sideText: `${tag} · CREW HQ` };
  const main = buildCourt(ctx, { ...spec, margin: 2.0 }, HQ.main);
  main.meshes.forEach(m => scene.add(m));
  const mainHoops = [1, -1].map(side => buildHoop(ctx, side, 'gym', { origin: HQ.main, padColor: cc, shotClock: false }));
  const shoot = buildCourt(ctx, { ...spec, halfOnly: true, logo: { ...spec.logo, size: 1.0 }, sideText: '', baselineText: 'SHOOTAROUND' }, HQ.shoot);
  shoot.meshes.forEach(m => scene.add(m));
  const shootHoop = buildHoop(ctx, 1, 'gym', { origin: HQ.shoot, padColor: cc, shotClock: false });
  const hoops = [...mainHoops, shootHoop];
  hoops.forEach(h => h.meshes.forEach(m => scene.add(m)));
  // shell: concrete-block walls with a crew-color band, rubber floor, dark ceiling
  const cb = T.concrete({ color: [0.62, 0.6, 0.58], joints: true });
  const wallMat = new Material({ map: ctx.texture(cb.color), normalMap: ctx.texture(cb.normal, { srgb: false }), roughness: 0.9 });
  const W = Wl.x1 - Wl.x0, L = Wl.z1 - Wl.z0, cx = (Wl.x0 + Wl.x1) / 2, cz = (Wl.z0 + Wl.z1) / 2;
  const walls = [];
  for (const [x, z, w, yaw] of [[cx, Wl.z0, W, 0], [cx, Wl.z1, W, Math.PI], [Wl.x0, cz, L, Math.PI / 2], [Wl.x1, cz, L, -Math.PI / 2]]) {
    const g = G.quad(w, Wl.h, { bottom: true });
    for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] *= w / 4; g.uv[i + 1] *= Wl.h / 4; }
    walls.push({ geo: g, matrix: M.m4fromYaw(M.m4(), x, 0, z, yaw) });
    // a band of crew color at shoulder height and a dark base
    matte.push({ geo: G.box(w, 0.5, 0.06), matrix: M.m4fromYaw(M.m4(), x, 1.6, z, yaw), color: c4(cc) });
    matte.push({ geo: G.box(w, 0.25, 0.06), matrix: M.m4fromYaw(M.m4(), x, 0.125, z, yaw), color: c4('#1d2024') });
  }
  scene.add(new Mesh(ctx.geometry(G.merge(walls, false)), wallMat, { castShadow: false }));
  const floor = new Mesh(ctx.geometry(G.plane(W, L)), new Material({ color: lin('#26292e'), roughness: 0.75 }), { castShadow: false, reflect: false });
  M.m4translation(floor.matrix, cx, -0.004, cz); floor.order = -2; scene.add(floor);
  const ceil = new Mesh(ctx.geometry(G.plane(W, L)), new Material({ color: lin('#2c2e33'), roughness: 0.9 }), { castShadow: false, reflect: false });
  M.m4mul(ceil.matrix, M.m4translation(M.m4(), cx, Wl.h, cz), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.PI)));
  scene.add(ceil);
  // trusses and hanging lights over both courts and the lounge
  for (let z = -18; z <= 15; z += 5.5) {
    metal.push({ geo: G.box(W, 0.35, 0.25), matrix: M.m4translation(M.m4(), cx, Wl.h - 1.1, z), color: c4('#2e3135') });
    for (const x of [-5, 1.5, 8, 17, 25]) {
      metal.push({ geo: G.cylinder(0.45, 0.25, 0.4, 12, { y0: true }), matrix: M.m4translation(M.m4(), x, Wl.h - 2.3, z), color: c4('#2e3135') });
      lamps.push({ geo: G.cylinder(0.43, 0.43, 0.02, 12, { y0: true }), matrix: M.m4translation(M.m4(), x, Wl.h - 2.32, z), color: [1, 1, 1, 1] });
    }
  }
  // crew banners: a big one over the north baseline, a tall one on the west wall
  const flag = big => { const c = T.banner(tag, { bg: cc, color: ink, stripe: ink === '#15171b' ? '#15171b' : '#f4f1ea', sub: name.slice(0, 24), w: 1024, h: big ? 512 : 1024, size: big ? 230 : 300 }); return new Material({ map: ctx.texture(c), roughness: 0.9, shading: 'cloth', doubleSided: true }); };
  const banner = new Mesh(ctx.geometry(G.quad(9, 4.5)), flag(true), { castShadow: false });
  M.m4fromYaw(banner.matrix, 0, 5.2, Wl.z1 - 0.06, Math.PI); scene.add(banner);
  const tall = new Mesh(ctx.geometry(G.quad(3, 3)), flag(false), { castShadow: false });
  for (const z of [-8, 8]) { const m = new Mesh(tall.geo, tall.material, { castShadow: false }); M.m4fromYaw(m.matrix, Wl.x0 + 0.06, 5.6, z, Math.PI / 2); scene.add(m); }
  // a short bleacher on the main court's west sideline
  matte.push(...PR.bleacher(HQ.bleacher.x, HQ.bleacher.z, Math.PI / 2, 12, 3, '#2e3238', '#5d636b'));
  // scorer's table between the courts (run 5-on-5 from here) with LED fascia on both sides
  const tb = HQ.table;
  matte.push({ geo: G.box(0.9, 0.8, 6), matrix: M.m4translation(M.m4(), tb.x, 0.4, tb.z), color: c4('#2b2f36') });
  matte.push({ geo: G.box(1.0, 0.04, 6.1), matrix: M.m4translation(M.m4(), tb.x, 0.82, tb.z), color: c4('#d9d4c8') });
  const ledTex = ctx.texture(T.banner(`${tag} · CREW RUN · 5-ON-5`, { w: 1024, h: 96, bg: '#05070b', color: ink === '#15171b' ? '#f4f1ea' : cc, size: 52 }), { wrap: 'clamp' });
  for (const sx of [-1, 1]) {
    const led = new Mesh(ctx.geometry(G.quad(5.8, 0.6, { bottom: true })), new Material({ map: ledTex, shading: 'unlit', color: [1.5, 1.5, 1.5], fog: false }), { castShadow: false });
    M.m4fromYaw(led.matrix, tb.x + sx * 0.46, 0.1, tb.z, sx < 0 ? -Math.PI / 2 : Math.PI / 2);
    scene.add(led);
  }
  for (const z of [-1.6, 1.6]) matte.push({ geo: G.box(0.5, 0.46, 0.5), matrix: M.m4translation(M.m4(), tb.x + 0.95, 0.23, tb.z + z), color: c4(cc) });
  // ball rack by the shootaround court, with balls on it
  matte.push(...PR.ballRack(HQ.rack.x, HQ.rack.z, 0));
  for (let i = 0; i < 4; i++) for (const y of [0.7, 1.1]) matte.push({ geo: G.sphere(0.12, 10, 8), matrix: M.m4translation(M.m4(), HQ.rack.x - 0.5 + i * 0.33, y, HQ.rack.z), color: c4('#c8601f') });
  // lounge: rug, couches facing the members board, a coffee table, a plant
  const co = HQ.coffee;
  matte.push({ geo: G.box(6, 0.02, 7.5), matrix: M.m4translation(M.m4(), co.x - 0.6, 0.01, co.z), color: c4(cc).map((v, i) => (i < 3 ? v * 0.45 + 0.01 : 1)) });
  for (const [x, z, yaw] of HQ.couches) matte.push(...PR.couch(x, z, yaw, '#33373e', 2.6));
  matte.push({ geo: G.box(0.7, 0.42, 1.8), matrix: M.m4translation(M.m4(), co.x, 0.21, co.z), color: c4('#4a3727') });
  matte.push({ geo: G.cylinder(0.3, 0.24, 0.55, 10, { y0: true }), matrix: M.m4translation(M.m4(), 29.9, 0, -16.5), color: c4('#2b2f36') });
  matte.push(...PR.tree(29.9, -16.5, 0.28, new RNG(5), '#3f6b3a'));
  // members board (east wall, over the couches) and level board (south wall): live canvases
  const screen = (w, h, cw, ch) => { const cvs = T.canvas(cw, ch); const tex = ctx.texture(cvs, { wrap: 'clamp' }); const m = new Mesh(ctx.geometry(G.quad(w, h)), new Material({ map: tex, color: [1.35, 1.35, 1.35], shading: 'unlit', fog: false }), { castShadow: false, reflect: false }); scene.add(m); return { cvs, tex, m }; };
  const mb = screen(6.4, 3.5, 1024, 560), lb = screen(5.4, 2.7, 1024, 512);
  M.m4fromYaw(mb.m.matrix, HQ.board.x - 0.08, 2.95, HQ.board.z, -Math.PI / 2);
  M.m4fromYaw(lb.m.matrix, HQ.levels.x, 2.85, HQ.levels.z + 0.08, 0);
  // frames behind the screens (their front faces stay a few cm behind the glass)
  matte.push({ geo: G.box(6.7, 3.8, 0.08), matrix: M.m4fromYaw(M.m4(), HQ.board.x + 0.02, 2.95, HQ.board.z, -Math.PI / 2), color: c4('#0d0f12') });
  matte.push({ geo: G.box(5.7, 3.0, 0.08), matrix: M.m4fromYaw(M.m4(), HQ.levels.x, 2.85, HQ.levels.z + 0.01, 0), color: c4('#0d0f12') });
  // "coming soon" corner: floor tape, crates, a ladder and a sign
  const cs = HQ.custom;
  for (const [x, z, w, d] of [[cs.x, cs.z + 0.6 + 4.2, 6, 0.12], [cs.x - 3, cs.z + 0.6 + 2.1, 0.12, 4.2], [cs.x + 3, cs.z + 0.6 + 2.1, 0.12, 4.2]]) matte.push({ geo: G.box(w, 0.012, d), matrix: M.m4translation(M.m4(), x, 0.006, z), color: c4('#f2c14e') });
  matte.push({ geo: G.box(1.1, 0.8, 0.9), matrix: M.m4fromYaw(M.m4(), cs.x - 1.8, 0.4, cs.z + 1.3, 0.2), color: c4('#8a6a45') });
  matte.push({ geo: G.box(0.8, 0.6, 0.7), matrix: M.m4fromYaw(M.m4(), cs.x - 1.7, 1.1, cs.z + 1.3, -0.15), color: c4('#9b7a52') });
  for (const dx of [0.9, 1.3]) matte.push({ geo: G.cylinder(0.16, 0.16, 0.3, 10, { y0: true }), matrix: M.m4translation(M.m4(), cs.x + dx, 0, cs.z + 1.0), color: c4(dx > 1 ? cc : '#d9d4c8') });
  for (const sx of [-0.25, 0.25]) metal.push({ geo: G.box(0.05, 2.6, 0.05), matrix: M.m4fromYaw(M.m4(), cs.x + 2.2 + sx, 1.25, cs.z + 0.45, 0, 1), color: c4('#9aa3ad') });
  for (let i = 0; i < 7; i++) metal.push({ geo: G.box(0.5, 0.04, 0.05), matrix: M.m4translation(M.m4(), cs.x + 2.2, 0.3 + i * 0.32, cs.z + 0.45), color: c4('#9aa3ad') });
  const soon = new Mesh(ctx.geometry(G.quad(5, 1.25)), new Material({ map: cachedTexture(ctx, 'hqsoon', () => T.banner('COMING SOON', { bg: '#15171b', color: '#f2c14e', stripe: '#f2c14e', sub: 'INTERIOR CUSTOMIZATION · TROPHIES · FURNITURE · LIGHTING' }), {}), shading: 'unlit', color: [1.3, 1.3, 1.3], fog: false }), { castShadow: false });
  M.m4fromYaw(soon.matrix, cs.x, 3.1, cs.z + 0.05, 0); scene.add(soon);
  // exit door in the south wall with a glowing EXIT sign
  const dr = HQ.door;
  matte.push({ geo: G.box(2.6, 2.8, 0.12), matrix: M.m4translation(M.m4(), dr.x, 1.4, Wl.z0 + 0.06), color: c4('#1c2a33') });
  for (const dx of [-1.3, 0, 1.3]) metal.push({ geo: G.box(0.1, 2.8, 0.16), matrix: M.m4translation(M.m4(), dr.x + dx, 1.4, Wl.z0 + 0.1), color: c4('#22262b') });
  metal.push({ geo: G.box(2.7, 0.12, 0.16), matrix: M.m4translation(M.m4(), dr.x, 2.82, Wl.z0 + 0.1), color: c4('#22262b') });
  for (const dx of [-0.2, 0.2]) metal.push({ geo: G.box(0.05, 0.8, 0.08), matrix: M.m4translation(M.m4(), dr.x + dx, 1.2, Wl.z0 + 0.2), color: c4('#c9cdd2') });
  const exitTex = cachedTexture(ctx, 'hqexit', () => T.banner('EXIT', { w: 512, h: 160, bg: '#300808', color: '#ff4a3a', size: 110 }), {});
  const exit = new Mesh(ctx.geometry(G.quad(1.2, 0.38)), new Material({ map: exitTex, shading: 'unlit', color: [2.2, 2.2, 2.2], fog: false }), { castShadow: false });
  M.m4fromYaw(exit.matrix, dr.x, 3.25, Wl.z0 + 0.08, 0); scene.add(exit);
  glow.push({ geo: G.box(2.4, 0.05, 0.08), matrix: M.m4translation(M.m4(), dr.x, 2.98, Wl.z0 + 0.2), color: c4('#fff2d6') });
  batch(ctx, scene, matte, mats.matte);
  batch(ctx, scene, metal, mats.metal);
  batch(ctx, scene, lamps, mats.lamp, { castShadow: false });
  batch(ctx, scene, glow, new Material({ color: [1.5, 1.5, 1.5], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
  scene.lights.length = 0;
  scene.lights.push({ pos: [0, 8, -6], range: 26, color: [1, 0.97, 0.92], intensity: 12, dir: null });
  scene.lights.push({ pos: [0, 8, 7], range: 26, color: [1, 0.97, 0.92], intensity: 12, dir: null });
  scene.lights.push({ pos: [21, 8, 6], range: 22, color: [1, 0.97, 0.92], intensity: 10, dir: null });
  scene.lights.push({ pos: [27.5, 5.5, -11], range: 18, color: [1, 0.88, 0.7], intensity: 10, dir: null });
  scene.lights.push({ pos: [18, 6, -17], range: 16, color: [1, 0.92, 0.8], intensity: 7, dir: null });
  scene.reflectionPlane = true;
  scene.shadowFocus = { center: [8, 0, -4], radius: 20 };

  // ---- live boards ----
  const font = (w, px) => `${w} ${px}px Arial, sans-serif`;
  const fmt = n => Math.round(n).toLocaleString();
  const members = { data: null, draw() {
    const g = mb.cvs.getContext('2d'), Wc = mb.cvs.width, Hc = mb.cvs.height, d = this.data || { rows: [] };
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, Wc, Hc);
    g.fillStyle = cc; g.fillRect(0, 0, Wc, 86);
    g.fillStyle = ink; g.font = '900 48px "Arial Black", Impact, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText(`${tag}  ${name}`.slice(0, 30), 30, 45);
    g.textAlign = 'right'; g.font = font(700, 28); g.fillText(`${d.rows.length}/39 · ${d.online || 0} ON NOW`, Wc - 30, 45);
    g.textAlign = 'left';
    if (!d.rows.length) { g.fillStyle = '#c9ced6'; g.font = font(700, 32); g.fillText('No members yet — add friends from the crew menu.', 40, 200); }
    const per = 9, colW = (Wc - 60) / 2;
    d.rows.slice(0, per * 2).forEach((m, i) => {
      const x = 30 + Math.floor(i / per) * colW, y = 122 + (i % per) * 48;
      g.fillStyle = m.online ? '#3ddc84' : '#4a4f57'; g.beginPath(); g.arc(x + 12, y, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = m.online ? '#f4f1ea' : '#9aa3ad'; g.font = font(700, 27); g.fillText(m.name.slice(0, 18), x + 32, y);
      g.textAlign = 'right'; g.fillStyle = '#c9ced6'; g.font = font(600, 23); g.fillText(`${m.ovr} ${m.pos} · ${fmt(m.xp)} XP`, x + colW - 24, y); g.textAlign = 'left';
    });
    if (d.rows.length > per * 2) { g.fillStyle = '#9aa3ad'; g.font = font(600, 22); g.fillText(`+${d.rows.length - per * 2} more in the crew menu`, 40, Hc - 24); }
    ctx.updateTexture(mb.tex, mb.cvs);
  }, set(d) { this.data = d; this.draw(); } };
  const levels = { data: null, draw() {
    const g = lb.cvs.getContext('2d'), Wc = lb.cvs.width, Hc = lb.cvs.height, lv = this.data?.level || { level: 1, xp: 0, floor: 0, next: 2500 };
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, Wc, Hc);
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = '#9aa3ad'; g.font = font(700, 28); g.fillText('CREW LEVEL', Wc / 2, 46);
    g.fillStyle = cc === '#111111' ? '#f4f1ea' : cc; g.font = '900 120px "Arial Black", Impact, sans-serif'; g.fillText(String(lv.level), Wc / 2 - 60, 150);
    g.fillStyle = '#c9ced6'; g.font = font(700, 40); g.fillText('/ 40', Wc / 2 + 90, 170);
    const pct = lv.next ? (lv.xp - lv.floor) / (lv.next - lv.floor) : 1;
    g.fillStyle = '#2a2f36'; g.fillRect(80, 240, Wc - 160, 34);
    g.fillStyle = cc === '#111111' ? '#f4f1ea' : cc; g.fillRect(80, 240, (Wc - 160) * Math.max(0, Math.min(1, pct)), 34);
    g.fillStyle = '#e6e2da'; g.font = font(700, 28); g.fillText(lv.next ? `${fmt(lv.xp)} XP · ${fmt(lv.next - lv.xp)} to level ${lv.level + 1}` : `${fmt(lv.xp)} XP · max level`, Wc / 2, 310);
    for (let i = 0; i < 40; i++) { const x = 80 + i * ((Wc - 160) / 40); g.fillStyle = i < lv.level ? (cc === '#111111' ? '#f4f1ea' : cc) : '#3a3f46'; g.fillRect(x + 2, 360, (Wc - 160) / 40 - 4, 26); }
    g.fillStyle = '#f2c14e'; g.font = font(700, 26); g.fillText('LEVEL REWARDS: COMING SOON', Wc / 2, 430);
    g.fillStyle = '#9aa3ad'; g.font = font(600, 22); g.fillText('Your games and your members\' games level the crew', Wc / 2, 472);
    ctx.updateTexture(lb.tex, lb.cvs);
  }, set(d) { this.data = d; this.draw(); } };
  members.draw(); levels.draw();
  const solids = [
    { x0: tb.x - 0.5, x1: tb.x + 0.5, z0: tb.z - 3.05, z1: tb.z + 3.05, h: 0.85 },
    { x0: co.x - 0.4, x1: co.x + 0.4, z0: co.z - 0.95, z1: co.z + 0.95, h: 0.45 },
    { x0: HQ.rack.x - 0.75, x1: HQ.rack.x + 0.75, z0: HQ.rack.z - 0.25, z1: HQ.rack.z + 0.25, h: 1.1 },
    { x0: HQ.bleacher.x - 1.4, x1: HQ.bleacher.x + 0.25, z0: HQ.bleacher.z - 6.1, z1: HQ.bleacher.z + 6.1, h: 1.4 },
    { x0: cs.x - 2.4, x1: cs.x - 1.2, z0: cs.z + 0.8, z1: cs.z + 1.8, h: 1.4 },
    { x0: 29.5, x1: 30.3, z0: -16.9, z1: -16.1, h: 1.2 },
    ...HQ.couches.map(([x, z]) => ({ x0: x - 0.5, x1: x + 0.5, z0: z - 1.45, z1: z + 1.45, h: 1 })),
  ];
  return {
    theme, crew,
    courts: [
      { id: 'hq-main', name: 'Main court', origin: HQ.main, hoops: mainHoops, format: 5, full: true, floor: main.floor },
      { id: 'hq-shoot', name: 'Shootaround', origin: HQ.shoot, hoops: [shootHoop], format: 1, floor: shoot.floor },
    ],
    hoops, solids, bounds: HQ.bounds, boards: { members, levels },
    update() { },
  };
}
