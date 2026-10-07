// Court floor + hoop assemblies (rim, glass board, stanchion, verlet net).
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { Net } from './net.js';
import { COURT } from '../sim/constants.js';
import * as M from '../core/math.js';

const texCache = new Map();
export function cachedTexture(ctx, key, make, opts) {
  let t = texCache.get(key);
  if (!t || t.ctx !== ctx) { t = { ctx, tex: ctx.texture(make(), opts) }; texCache.set(key, t); }
  return t.tex;
}

function boardMarkings() {
  const c = T.canvas(512, 300), g = c.getContext('2d');
  g.clearRect(0, 0, 512, 300);
  g.strokeStyle = '#ffffff'; g.lineWidth = 9;
  g.strokeRect(5, 5, 502, 290);
  // inner square 0.61 x 0.457 m on a 1.83 x 1.07 board
  const sw = 0.61 / 1.83 * 512, sh = 0.457 / 1.07 * 300;
  g.lineWidth = 7;
  g.strokeRect(256 - sw / 2, 300 - 0.15 / 1.07 * 300 - sh, sw, sh);
  return c;
}

// style: 'arena' | 'park' | 'gym'
export function buildHoop(ctx, side, style = 'park', opts = {}) {
  const meshes = [];
  const rimColor = opts.rimColor || '#d8431c';
  const metal = new Material({ color: opts.poleColor || (style === 'arena' ? '#1b1d22' : '#3d4a52'), roughness: 0.45, metalness: 0.7 });
  const dark = new Material({ color: '#15171b', roughness: 0.8 });
  const padMat = new Material({ color: opts.padColor || '#1c3557', roughness: 0.7, shading: 'cloth', sheen: [0.1, 0.1, 0.1] });
  const rimMat = new Material({ color: rimColor, roughness: 0.32, metalness: 0.65 });
  const glass = new Material({ color: '#c8dde6', opacity: 0.18, roughness: 0.04, specular: 1.2, blend: 'alpha', doubleSided: true });
  const markTex = cachedTexture(ctx, 'boardmark', boardMarkings, { wrap: 'clamp' });
  const marks = new Material({ color: [1, 1, 1], map: markTex, alphaTest: 0.5, roughness: 0.4, doubleSided: true });
  const frameMat = new Material({ color: '#c9cdd2', roughness: 0.3, metalness: 0.9 });
  const netMat = new Material({ color: opts.netColor || '#f4f4f0', roughness: 0.85, shading: 'cloth', sheen: [0.3, 0.3, 0.3] });

  const org = opts.origin || [0, 0, 0];
  const base = M.m4fromYaw(M.m4(), org[0], org[1], org[2] + side * COURT.hoopZ, side > 0 ? 0 : Math.PI);
  const place = (geo, mat, x, y, z, o = {}) => {
    const local = M.m4(); M.m4translation(local, x, y, z);
    if (o.rotX) { const r = M.m4(); M.m4compose(r, [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, o.rotX)); M.m4mul(local, local, r); }
    const m = M.m4mul(M.m4(), base, local);
    const mesh = new Mesh(geo, mat, { matrix: m, castShadow: o.shadow ?? true });
    meshes.push(mesh); return mesh;
  };
  const rimY = COURT.rimY, boardFace = COURT.boardZ - COURT.hoopZ; // 0.38
  const boardCY = COURT.boardBottom + COURT.boardH / 2;
  // Backboard glass + frame + markings
  place(ctx.geometry(G.box(COURT.boardW, COURT.boardH, 0.025)), glass, 0, boardCY, boardFace + 0.0125, { shadow: false });
  place(ctx.geometry(G.quad(COURT.boardW, COURT.boardH)), marks, 0, boardCY, boardFace - 0.002, { shadow: false }).matrix = M.m4mul(M.m4(), base, M.m4mul(M.m4(), M.m4translation(M.m4(), 0, boardCY, boardFace - 0.002), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 1, 0, Math.PI))));
  const fw = 0.035;
  const frameParts = [
    { geo: G.box(COURT.boardW + fw, fw, 0.045), matrix: M.m4translation(M.m4(), 0, boardCY + COURT.boardH / 2, boardFace + 0.015) },
    { geo: G.box(COURT.boardW + fw, fw, 0.045), matrix: M.m4translation(M.m4(), 0, boardCY - COURT.boardH / 2, boardFace + 0.015) },
    { geo: G.box(fw, COURT.boardH, 0.045), matrix: M.m4translation(M.m4(), COURT.boardW / 2, boardCY, boardFace + 0.015) },
    { geo: G.box(fw, COURT.boardH, 0.045), matrix: M.m4translation(M.m4(), -COURT.boardW / 2, boardCY, boardFace + 0.015) },
  ];
  place(ctx.geometry(G.merge(frameParts, false)), frameMat, 0, 0, 0);
  if (style !== 'park') {
    // bottom pad
    place(ctx.geometry(G.box(COURT.boardW + 0.06, 0.06, 0.07)), padMat, 0, COURT.boardBottom - 0.02, boardFace + 0.02);
  }
  // Rim + connector + flange
  const rimGeo = ctx.geometry(G.merge([
    { geo: G.torus(COURT.rimR + COURT.rimTube, COURT.rimTube, 48, 8) },
    { geo: G.box(0.11, 0.028, boardFace - COURT.rimR - 0.01), matrix: M.m4translation(M.m4(), 0, -0.012, (boardFace + COURT.rimR) / 2 + 0.005) },
    { geo: G.box(0.2, 0.16, 0.02), matrix: M.m4translation(M.m4(), 0, -0.06, boardFace - 0.01) },
    { geo: G.box(0.02, 0.1, 0.12), matrix: M.m4translation(M.m4(), 0, -0.07, boardFace - 0.07) },
  ], false));
  const rimMesh = place(rimGeo, rimMat, 0, rimY, 0);
  const rimBase = M.m4copy(M.m4(), rimMesh.matrix);
  // Support structure
  const backZ = boardFace + 0.03;
  if (style === 'park') {
    const poleZ = 1.6 + 1.1;
    const pole = G.cylinder(0.085, 0.1, 3.9, 14, { y0: true });
    const path = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; const a = t * Math.PI / 2; path.push([0, 3.9 + Math.sin(a) * 0.35 - (t > 0.5 ? (t - 0.5) * 0.1 : 0), poleZ - (1 - Math.cos(a)) * 0 - t * (poleZ - backZ - 0.35)]); }
    path.push([0, boardCY, backZ + 0.18]);
    const parts = [
      { geo: pole, matrix: M.m4translation(M.m4(), 0, 0, poleZ) },
      { geo: G.tube(path, 0.075, 10) },
      { geo: G.box(0.5, 0.5, 0.06), matrix: M.m4translation(M.m4(), 0, boardCY, backZ + 0.07) },
      { geo: G.box(0.06, 0.6, 0.5), matrix: M.m4translation(M.m4(), 0, boardCY - 0.05, backZ + 0.3) },
      { geo: G.cylinder(0.24, 0.28, 0.12, 14, { y0: true }), matrix: M.m4translation(M.m4(), 0, 0, poleZ) },
    ];
    place(ctx.geometry(G.merge(parts, false)), metal, 0, 0, 0);
    if (opts.poleSleeve) place(ctx.geometry(G.cylinder(0.14, 0.14, 1.8, 14, { y0: true })), padMat, 0, 0, poleZ);
  } else {
    // Arena/gym stanchion: padded base behind baseline, column, angled arm
    const baseZ = 1.6 + 1.25;
    place(ctx.geometry(G.box(1.25, 1.05, 1.7, {})), padMat, 0, 0.525, baseZ + 0.45);
    place(ctx.geometry(G.box(0.4, 2.2, 0.4)), padMat, 0, 2.1, baseZ - 0.1);
    const arm = [[0, 3.1, baseZ - 0.1], [0, 3.5, baseZ - 0.6], [0, boardCY + 0.1, backZ + 0.25]];
    place(ctx.geometry(G.merge([
      { geo: G.tube(arm, 0.08, 10) },
      { geo: G.tube([[0.3, 3.2, baseZ - 0.2], [0.3, boardCY - 0.2, backZ + 0.25]], 0.035, 8) },
      { geo: G.tube([[-0.3, 3.2, baseZ - 0.2], [-0.3, boardCY - 0.2, backZ + 0.25]], 0.035, 8) },
      { geo: G.box(0.9, 0.7, 0.08), matrix: M.m4translation(M.m4(), 0, boardCY, backZ + 0.2) },
    ], false)), dark, 0, 0, 0);
    // shot clock housing on top of board
    if (opts.shotClock !== false) place(ctx.geometry(G.box(0.62, 0.32, 0.22)), dark, 0, boardCY + COURT.boardH / 2 + 0.2, backZ + 0.06);
  }
  const rimWorld = { x: org[0], y: rimY, z: org[2] + side * COURT.hoopZ };
  const net = new Net(ctx, rimWorld, netMat);
  const netMesh = new Mesh(net.geo, netMat, { castShadow: true });
  meshes.push(netMesh);
  const hoop = {
    side, meshes, net, rimMesh, rimBase, shake: 0, shakeVel: 0, offset: { x: 0, y: 0, z: 0 }, hang: 0,
    // shotClockAnchor used by HUD/3D clocks
    clockPos: [org[0], boardCY + COURT.boardH / 2 + 0.2, org[2] + side * (COURT.boardZ + 0.1)],
    rim: rimWorld,
    update(dt, ball) {
      // damped spring for rim flex (dunks pull it down)
      const k = 260, c = 9;
      this.shakeVel += (-k * this.shake - c * this.shakeVel) * dt - this.hang * 4 * dt;
      this.shake += this.shakeVel * dt;
      this.offset.y = this.shake * 0.06;
      this.offset.z = 0;
      M.m4copy(rimMesh.matrix, rimBase);
      rimMesh.matrix[13] += this.offset.y;
      // tilt rim front edge downward slightly when flexed
      net.update(dt, ball, this.offset);
    },
    hit(strength) { this.shakeVel -= strength; },
  };
  return hoop;
}

// Floor + markings. spec from venue; returns {meshes, hoops}
export function buildCourt(ctx, spec, origin = [0, 0, 0], rotY = 0) {
  const meshes = [];
  const surface = spec.surface || 'asphalt';
  const ov = T.courtOverlay(spec);
  const overlayTex = ctx.texture(ov.canvas, { wrap: 'clamp', aniso: 16 });
  let map, normalMap, roughness, uvScale, reflective = false;
  if (surface === 'wood') {
    const wood = woodTextures(ctx, spec.woodTone);
    map = wood.color; normalMap = wood.normal; roughness = spec.gloss ?? 0.28; uvScale = [1 / 2.0, 1 / 2.0]; reflective = spec.reflective ?? true;
  } else {
    const asph = asphaltTextures(ctx);
    map = asph.color; normalMap = asph.normal; roughness = 0.82; uvScale = [1 / 4, 1 / 4];
  }
  // v0.4.2: half courts (2v2 / 1v1 park courts) only lay down the +z half (plus a strip past half court)
  const z0 = spec.halfOnly ? -2.2 : -ov.length / 2, z1 = ov.length / 2;
  const geo = G.plane(ov.width, z1 - z0, 1, 1);
  if (spec.halfOnly) for (let i = 2; i < geo.position.length; i += 3) geo.position[i] += (z0 + z1) / 2;
  // local-space UVs in meters: overlay uses them directly, base maps tile via uFloorTile
  for (let i = 0; i < geo.uv.length; i += 2) { geo.uv[i] = geo.position[(i / 2) * 3]; geo.uv[i + 1] = geo.position[(i / 2) * 3 + 2]; }
  const mat = new Material({
    color: surface === 'wood' ? [1, 1, 1] : M.hexLinear(spec.asphaltTint || '#ffffff'), map, normalMap, normalScale: surface === 'wood' ? 0.35 : 0.8, roughness,
    uvScale: [1, 1], floor: { overlay: overlayTex, rect: ov.rect, tile: uvScale, swap: surface === 'wood' }, reflective, reflectStrength: spec.reflectStrength ?? 0.55,
    specular: surface === 'wood' ? 1.1 : 0.6,
  });
  const m = M.m4fromYaw(M.m4(), origin[0], origin[1] + 0.001, origin[2], rotY);
  const floor = new Mesh(ctx.geometry(geo), mat, { matrix: m, castShadow: false, reflect: false });
  floor.order = -1;
  meshes.push(floor);
  return { meshes, floor, overlay: ov };
}

let woodCache = null, asphaltCache = null;
export function woodTextures(ctx, tone) {
  const key = 'wood' + (tone || '');
  if (woodCache && woodCache.key === key && woodCache.ctx === ctx) return woodCache;
  const t = T.hardwood({ tone: tone || [0.82, 0.6, 0.38] });
  woodCache = { key, ctx, color: ctx.texture(t.color, { aniso: 16 }), normal: ctx.texture(t.normal, { srgb: false, aniso: 16 }) };
  return woodCache;
}
export function asphaltTextures(ctx) {
  if (asphaltCache && asphaltCache.ctx === ctx) return asphaltCache;
  const t = T.asphalt({});
  asphaltCache = { ctx, color: ctx.texture(t.color, { aniso: 16 }), normal: ctx.texture(t.normal, { srgb: false, aniso: 16 }) };
  return asphaltCache;
}
