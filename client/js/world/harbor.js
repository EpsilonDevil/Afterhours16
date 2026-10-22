// v0.4.8.5 Harbor Point: a beach park. The ground is sand (instead of the shared jointed concrete) running down a wet
// slope into the sea, and palms stand everywhere outside the courts: along the beach, round the perimeter beyond the
// fences, along the south edge of the plaza, round the beach houses, a few in the gaps inside the park, and cheap far
// groves out to the haze. Nothing goes where a game camera flies (see camClear) or on a court, fence or building.
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { RNG, makeNoise2D } from '../core/rng.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { cachedTexture } from './court.js';
import * as PR from './props.js';
import { PARK_COURTS, PARK_HQ, PARK_HALL, PARK_PROAM } from './themes.js';

const lin = hex => M.hexLinear(hex);
// the dry sand ends at SHORE.z; a wet slope runs down to SHORE.y at SHORE.wet (the sea sits at y -0.6, so the
// waterline falls at about z 50.7)
export const SHORE = { z: 44, wet: 53, y: -0.8, water: -0.6 };
const TILE = 12; // metres of beach one sand texture tile covers
export const waterlineZ = () => SHORE.z + (SHORE.wet - SHORE.z) * (SHORE.water + 0.005) / (SHORE.y + 0.005);

// a vertex-coloured ground plane (uv in metres / tile): x0..x1, z0..z1, cells about `cell` metres; shade(x, z) → rgb
export function shadedPlane(x0, x1, z0, z1, cell, tile, shade, y = 0) {
  const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell));
  const g = G.plane(x1 - x0, z1 - z0, nx, nz);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, n = g.position.length / 3;
  g.color = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = g.position[i * 3] += cx, z = g.position[i * 3 + 2] += cz;
    const yy = typeof y === 'function' ? y(x, z) : y;
    g.position[i * 3 + 1] = yy;
    g.uv[i * 2] = x / tile; g.uv[i * 2 + 1] = z / tile;
    const c = shade(x, z); g.color[i * 4] = c[0]; g.color[i * 4 + 1] = c[1]; g.color[i * 4 + 2] = c[2]; g.color[i * 4 + 3] = 1;
  }
  return g;
}

// the sand ground and the wet slope into the water. Returns the two meshes (already added to the scene).
export function harborGround(ctx, scene, theme) {
  let made = null; const sand = () => made || (made = T.sand({ meters: TILE }));
  const sandTex = cachedTexture(ctx, 'sand-c', () => sand().color, { aniso: 16 });
  const sandN = cachedTexture(ctx, 'sand-n', () => sand().normal, { srgb: false, aniso: 16 });
  const noise = makeNoise2D(73);
  const tint = lin(theme.ground);
  // a slow, non-repeating drift over the whole beach (the texture's own drift repeats every 8 m), damper toward
  // the shore, and a little paler along the boardwalk where the sand is dry and loose
  const shade = (x, z) => {
    const n = noise.fbm(x / 70, z / 70, 3), m = noise.fbm(x / 23 + 9, z / 23, 2);
    let k = 1 + n * 0.16 + m * 0.06;
    const damp = M.clamp((z - 36) / 8, 0, 1);
    k *= 1 - damp * 0.2;
    return [tint[0] * k * (1 + n * 0.03), tint[1] * k, tint[2] * k * (1 - n * 0.04 - damp * 0.03)];
  };
  const geo = shadedPlane(-300, 300, -300, SHORE.z, 10, TILE, shade, -0.005);
  const ground = new Mesh(ctx.geometry(geo), new Material({ color: [1, 1, 1], map: sandTex, normalMap: sandN, normalScale: 0.9, roughness: 0.95, specular: 0.5 }), { castShadow: false, reflect: false });
  ground.order = -2;
  scene.add(ground);
  // the wet slope: the same sand, darker and glossy, from the dry edge down under the water
  const wetShade = (x, z) => { const k = 0.62 - (z - SHORE.z) / (SHORE.wet - SHORE.z) * 0.12 + noise(x / 9, z / 3) * 0.04; return [tint[0] * k, tint[1] * k * 0.98, tint[2] * k * 0.95]; };
  const slope = shadedPlane(-300, 300, SHORE.z, SHORE.wet, 10, TILE, wetShade, (x, z) => -0.005 + (z - SHORE.z) / (SHORE.wet - SHORE.z) * (SHORE.y + 0.005));
  const wet = new Mesh(ctx.geometry(slope), new Material({ color: [1, 1, 1], map: sandTex, normalMap: sandN, normalScale: 0.5, roughness: 0.3, specular: 1.2 }), { castShadow: false, reflect: false });
  wet.order = -2;
  scene.add(wet);
  return [ground, wet];
}

// ---- palm placement ----
// where the game cameras fly (camera.js): behind each full court's play along its axis, swinging round the sideline
// at mid-court, and behind the half courts. A palm's crown (to ~3.5 m from the trunk at 6-12 m up) must stay out.
export function camClear(x, z, pad = 4.5) {
  for (const c of PARK_COURTS) {
    const [ox, , oz] = c.origin;
    if (c.full) {
      if (Math.abs(x - ox) < 4.4 + pad && Math.abs(z - oz) < 28.5 + pad) return false;
      if (Math.abs(x - ox) < 17.6 + pad && Math.abs(z - oz) < 13 + pad) return false;
    } else if (Math.abs(x - ox) < 4.4 + pad && z > oz - 16.5 - pad && z < oz - 7.5 + pad) return false;
  }
  return true;
}
// courts (with aprons and fences), the practice slab, the plaza shops and wheel, the Crew HQ and the Event hall
export function onSomething(x, z, r = 1.2) {
  for (const c of PARK_COURTS) {
    const [ox, , oz] = c.origin, W = 9.82 + r, L = 16.92 + r;
    if (Math.abs(x - ox) < W && (c.full ? Math.abs(z - oz) < L : z > oz - 3.2 - r && z < oz + L)) return true;
  }
  if (x > 47 - r && x < 57 + r && z > 11.5 - r && z < 21 + r) return true;          // practice slab
  if (Math.abs(x) < 9.6 + r && Math.abs(z + 24) < 2.4 + r) return true;              // kiosks + the wheel
  if (Math.abs(x - PARK_HQ.x) < 3.6 + r && Math.abs(z - PARK_HQ.z) < 2.2 + r) return true;
  if (Math.abs(x - PARK_HALL.x) < 2.9 + r && Math.abs(z - PARK_HALL.z) < 2.2 + r) return true;
  if (Math.abs(x - PARK_PROAM.x) < 3.5 + r && z > PARK_PROAM.z - 2.3 - r && z < PARK_PROAM.z + 4.4 + r) return true; // (v0.4.8.8 the Pro-Am HUB and its carpet)
  const lx = (((x + 40) % 9) + 9) % 9;
  if (Math.abs(z + 27) < 0.6 + r && x > -41 - r && x < 42 + r && Math.min(lx, 9 - lx) < 0.6 + r) return true; // plaza lamps
  if (Math.abs(x + 66) < 1 + r && z > -13 - r && z < 5 + r) return true;            // the mural wall
  return false;
}
// the people walking the beach and the plaza (parklife.js lanes) keep their paths
const onLane = (x, z) => (Math.abs(x) < 69 && (Math.abs(z - 35.6) < 1.6 || Math.abs(z - 38.5) < 1.6)) || (Math.abs(x) < 61 && Math.abs(z + 30.5) < 1.6);

// every palm: {x, z, s, height, lean:[x, z], tier}. tier: 'full' (casts shadows: in the park and the stretch of
// beach whose long evening shadows fall across it), 'mid' (the rest in view) or 'lite' (far groves).
// houses: [{x, z, w, d}] (the beach houses)
export function harborPalmSpots(rng, houses = []) {
  const out = [];
  const near = (x, z, d) => out.some(p => Math.hypot(p.x - x, p.z - z) < d);
  const inHouse = (x, z, r) => houses.some(h => Math.abs(x - h.x) < h.w / 2 + r && Math.abs(z - h.z) < h.d / 2 + r);
  const ok = (x, z, gap = 3.2, r = 1.2) => camClear(x, z) && !onSomething(x, z, r) && !onLane(x, z) && !inHouse(x, z, 1.5) && !near(x, z, gap);
  // (the sun sits low in the north-west: palms on the beach and off the west side throw shadows into the park)
  const tierOf = (x, z, lite) => lite ? 'lite' : (Math.abs(x) < 64 && z < 34) || (z > 34 && Math.abs(x) < 48) ? 'full' : 'mid';
  const put = (x, z, o) => { if (ok(x, z, o.gap)) { out.push({ x, z, s: o.s ?? 1, height: o.height, lean: o.lean, tier: tierOf(x, z, o.lite) }); return true; } return false; };
  // the beach: clusters of two or three between the walkers' path and the water, leaning out to sea
  for (let x = -128; x <= 128; x += rng.range(8, 13)) {
    const n = rng.next() < 0.35 ? 1 : rng.next() < 0.6 ? 2 : 3, far = Math.abs(x) > 84;
    for (let k = 0; k < n; k++) {
      const px = x + rng.range(-2.5, 2.5), pz = rng.range(40.6, 47.5);
      put(px, pz, { height: rng.range(7.5, 12.5), lean: [rng.range(-1.4, 1.4), rng.range(0.8, 3.2)], lite: far, gap: 2.4 });
    }
  }
  // the perimeter beyond the side fences
  for (const sx of [-1, 1]) for (let z = -46; z <= 38; z += rng.range(6, 10)) {
    const n = rng.next() < 0.5 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const px = sx * rng.range(68.5, 84), pz = z + rng.range(-2, 2);
      put(px, pz, { height: rng.range(6.5, 11), lean: [sx * rng.range(0, 1.6), rng.range(-1, 1)], gap: 3.6 });
    }
  }
  // the south edge of the plaza, between the park and the beach houses
  for (let x = -62; x <= 62; x += rng.range(7, 11)) put(x + rng.range(-1.5, 1.5), rng.range(-41, -36.5), { height: rng.range(7, 11), lean: [rng.range(-0.8, 0.8), rng.range(-1.2, 0.2)], gap: 4 });
  // beside each beach house
  for (const h of houses) for (const sx of [-1, 1]) {
    if (rng.next() < 0.25) continue;
    put(h.x + sx * (h.w / 2 + rng.range(2, 3.5)), h.z + rng.range(-h.d / 2, h.d / 2), { height: rng.range(8, 13), lean: [sx * rng.range(0.2, 1.4), rng.range(-0.6, 0.6)], gap: 3 });
    if (rng.next() < 0.5) put(h.x + sx * (h.w / 2 + rng.range(4.5, 6.5)), h.z + rng.range(-h.d / 2, h.d / 2), { height: rng.range(6, 9), lean: [sx * rng.range(0.4, 1.6), rng.range(-0.6, 0.6)], gap: 3 });
  }
  // inside the park, in the gaps no game camera reaches: the north strip by the boardwalk and the plaza corners
  for (const [x, z] of [[-39, 26], [-13, 27.5], [13, 26.5], [39, 25.5], [-49, 27.5], [49, 27], [13.5, -31.8], [36, -31.8], [-36.5, -31.8]]) put(x, z, { height: rng.range(7, 10.5), lean: [rng.range(-0.7, 0.7), rng.range(-0.7, 0.7)], gap: 3 });
  // far groves on the sand behind the houses and off to the sides (cheap palms, in the haze)
  for (let i = 0; i < 70 && out.filter(p => p.tier === 'lite').length < 64; i++) {
    const a = rng.range(Math.PI * 1.02, Math.PI * 1.98), d = rng.range(95, 210);
    const cx = Math.cos(a) * d * 1.25, cz = Math.sin(a) * d * 0.8 - 10;
    const n = rng.int(2, 5);
    for (let k = 0; k < n; k++) put(cx + rng.range(-7, 7), cz + rng.range(-7, 7), { height: rng.range(7, 13), lean: [rng.range(-1.5, 1.5), rng.range(-1.5, 1.5)], lite: true, gap: 3 });
  }
  return out;
}

// builds the palms: the 'full' ones into `foliage` (the park's shadow-casting batch), the rest into one batch of
// their own that casts no shadows
export function harborPalms(ctx, scene, rng, foliage, houses, mat) {
  const spots = harborPalmSpots(rng, houses), far = [];
  for (const p of spots) (p.tier === 'full' ? foliage : far).push(...PR.palm(p.x, p.z, p.s, rng, { height: p.height, lean: p.lean, lite: p.tier === 'lite', mid: p.tier === 'mid' }));
  if (far.length) scene.add(new Mesh(ctx.geometry(G.merge(far)), mat, { castShadow: false, reflect: false }));
  return spots;
}
