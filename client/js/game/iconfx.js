// v0.4.8.5 quick patch 3: ICON status, what everyone sees on the floor and around the player.
//   * The cursor: an ICON build's circular cursor (session.js PlayerVisual.addRing) is replaced in every mode by his own
//     Icon badge, animated on the floor: the badge art (ui/badgeart.js iconBadgeSVG, drawn into a texture once per badge)
//     facing whoever is looking, a spectrum rim turning round it, a spectrum glow under it turning the other way and
//     pulsing (the Icon pop-up's hofShift / hofGlow), and a thin ring in the team colour (yours gold, teammates blue,
//     opponents red online, white watching) so it still tells you who is who.
//   * The aura: a dark, flame-like energy wrapping the whole body and licking up over the head, near-black with a deep
//     violet edge (so it reads on a night court and a bright one alike). Hidden until the build is on a 3-game win
//     streak, one level stronger every 3 wins (taller, wider, denser, faster, a brighter edge), all the way at 12+: then
//     it roars, with embers rising through it, black crackles flashing round him and a dark shockwave pulsing out
//     over the floor.
// Both are one skinned mesh each (one draw call apiece): static geometry whose bones are set every frame (the body's
// feet and head, the flame tips, the crackles, the pulse), with the flames' motion in the texture scrolling up through
// them (the material's uvOffset). Alpha blended: additive light can't make black.
import { Material, Mesh } from '../gfx/renderer.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { cachedTexture } from '../world/court.js';
import { B } from '../char/skeleton.js';
import { iconStatus, winStreak, iconAuraLevel } from '../sim/builds.js';
import { iconBadgeSVG } from '../ui/badgeart.js';

// what the build gets: ICON or not, its Icon badge, the aura's level (0: hidden, 1..4) from its win streak
export function iconFxState(build) {
  const icon = !!build && iconStatus(build);
  return { icon, badge: icon ? (build.icon_badge || 'the_general') : null, streak: winStreak(build), level: icon ? iconAuraLevel(winStreak(build)) : 0 };
}
// a game left (forfeit): the server ends the build's win streak (app.py reset_win_streak); your copy of the build too
export function endWinStreak(app) {
  const c = app?.char?.();
  if (!c || !winStreak(c)) return false;
  app.replaceChar({ ...c, win_streak: 0, progression: { ...(c.progression || {}), win_streak: 0 } });
  return true;
}

// ---------------- the cursor ----------------
// sizes (m): the badge face's half-width, the spectrum rim's, the team ring's, the glow's radius
export const ICON_CURSOR = { face: 0.6, rim: 0.8, team: 0.88, glow: 1.1, spin: 1.25, glowSpin: -0.45, pulse: 2.4, order: 4 };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const canDraw = () => typeof document !== 'undefined' && typeof Image !== 'undefined';

// the atlas is the same for every badge until its art is drawn in: made once
let decalBase = null;
const baseAtlas = () => decalBase || (decalBase = T.iconDecalAtlas(512));
const drawn = new WeakMap(); // texture -> 'loading' | 'done' | 'failed'
export function iconDecalTexture(ctx, badge) {
  const tex = cachedTexture(ctx, 'iconDecal:' + badge, () => { const b = baseAtlas(); return { width: b.width, height: b.height, data: b.data }; }, { wrap: 'clamp' });
  if (tex && typeof tex === 'object' && !drawn.has(tex) && canDraw() && ctx.updateTexture) { drawn.set(tex, 'loading'); drawBadge(ctx, tex, badge); }
  return tex;
}
// the badge's own art, from its SVG: an image of it drawn into the face quarter of a copy of the atlas, over a dark
// halo so it reads on a light floor. Until then (or if it fails) the stand-in medallion shows.
function drawBadge(ctx, tex, badge) {
  const b = baseAtlas(), Q = b.width / 2;
  const svg = iconBadgeSVG(badge, 232).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  const img = new Image();
  img.onload = () => {
    try {
      const c = T.canvas(b.width, b.height), g = c.getContext('2d');
      g.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.width, b.height), 0, 0);
      g.clearRect(0, 0, Q, Q);
      const halo = g.createRadialGradient(Q / 2, Q / 2, Q * 0.3, Q / 2, Q / 2, Q * 0.5);
      halo.addColorStop(0, 'rgba(14,5,30,0.82)'); halo.addColorStop(0.75, 'rgba(14,5,30,0.55)'); halo.addColorStop(1, 'rgba(14,5,30,0)');
      g.fillStyle = halo; g.fillRect(0, 0, Q, Q);
      g.save(); g.shadowColor = 'rgba(10,0,24,0.9)'; g.shadowBlur = Q * 0.05;
      g.drawImage(img, Q * 0.047, Q * 0.047, Q * 0.906, Q * 0.906);
      g.restore();
      ctx.updateTexture(tex, c);
      drawn.set(tex, 'done');
    } catch (e) { drawn.set(tex, 'failed'); }
  };
  img.onerror = () => drawn.set(tex, 'failed');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
export const iconDecalState = tex => drawn.get(tex) || 'base';

// one flat skinned mesh: bone 0 the glow (turning, pulsing), 1 the spectrum rim (turning), 2 the team ring, 3 the face
const CB = { glow: 0, rim: 1, team: 2, face: 3, n: 4 };
function cursorGeometry(team) {
  const P = [], N = [], U = [], C = [], J = [], W = [], I = [];
  const v = (x, z, u, vv, c, bone) => { P.push(x, 0, z); N.push(0, 1, 0); U.push(u, vv); C.push(c[0], c[1], c[2], c[3]); J.push(bone, 0, 0, 0); W.push(1, 0, 0, 0); return P.length / 3 - 1; };
  const e = 1 / 512; // (half a texel in: no bleeding from the next quarter)
  const quad = (s, [u0, v0, u1, v1], c, bone) => { const a = v(-s, -s, u0 + e, v0 + e, c, bone), b = v(s, -s, u1 - e, v0 + e, c, bone), d = v(-s, s, u0 + e, v1 - e, c, bone), f = v(s, s, u1 - e, v1 - e, c, bone); I.push(a, d, b, b, d, f); };
  // the glow: a fan, the spectrum round its edge (the texture fades it out), white-hot in the middle
  const R = ICON_CURSOR.glow, n = 32, c0 = v(0, 0, 0.25, 0.75, [1.6, 1.5, 1.7, 0.75], CB.glow);
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, s = T.iconSpectrum(i / n).map(x => (x / 255) ** 2.2 * 2.6);
    v(Math.cos(a) * R, Math.sin(a) * R, 0.25 + Math.cos(a) * 0.247, 0.75 + Math.sin(a) * 0.247, [s[0], s[1], s[2], 0.75], CB.glow);
    if (i) I.push(c0, c0 + i + 1, c0 + i);
  }
  quad(ICON_CURSOR.rim, [0.5, 0, 1, 0.5], [1.5, 1.5, 1.5, 1], CB.rim);
  quad(ICON_CURSOR.team, [0.5, 0.5, 1, 1], [...team.map(x => x * 1.6), 1], CB.team);
  quad(ICON_CURSOR.face, [0, 0, 0.5, 0.5], [1, 1, 1, 1], CB.face);
  return { position: new Float32Array(P), normal: new Float32Array(N), uv: new Float32Array(U), color: new Float32Array(C), joints: new Float32Array(J), weights: new Float32Array(W), index: new Uint16Array(I), bounds: { center: [0, 0, 0], radius: R } };
}

export class IconCursor {
  constructor(r, scene, badge, color) {
    this.r = r; this.ctx = r.ctx; this.scene = scene; this.badge = badge;
    const team = color ? M.hexLinear(color) : [0.9, 0.9, 0.88];
    this.tex = iconDecalTexture(this.ctx, badge);
    this.mat = new Material({ map: this.tex, color: [1.1, 1.1, 1.1], shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false });
    this.mesh = new Mesh(this.ctx.geometry(cursorGeometry(team)), this.mat, { castShadow: false, reflect: false, bones: new Float32Array(16 * CB.n), bounds: { center: [0, 0, 0], radius: ICON_CURSOR.glow } });
    this.mesh.order = ICON_CURSOR.order; this.mesh.name = 'iconCursor'; this.mesh.visible = false; // (shown once placed)
    scene.add(this.mesh);
    this.t = Math.random() * 10;
  }
  update(dt, x, y, z, yaw) {
    const t = (this.t += dt), b = this.mesh.bones, C = ICON_CURSOR;
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / C.pulse), h = 0.017;
    M.m4fromYaw(b.subarray(0, 16), x, h, z, t * C.glowSpin, 0.88 + 0.16 * pulse);
    M.m4fromYaw(b.subarray(16, 32), x, h + 0.001, z, t * C.spin, 1);
    M.m4fromYaw(b.subarray(32, 48), x, h + 0.002, z, 0, 1 + 0.025 * pulse);
    // the face turns to whoever is looking (upright on his screen), with a little sway
    M.m4fromYaw(b.subarray(48, 64), x, h + 0.003, z, yaw + Math.sin(t * 0.9) * 0.06, 1 + 0.03 * Math.sin(t * Math.PI * 2 / C.pulse + 1));
    const o = this.mesh.boundsOverride.center; o[0] = x; o[1] = 0; o[2] = z;
  }
  dispose() { this.scene.remove(this.mesh); this.ctx.disposeGeometry?.(this.mesh.geo); this.mesh = null; }
}

// ---------------- the aura ----------------
// per level (0 = none, then 3, 6, 9, 12+ wins): half-width at the shoulders (m), how far the flames rise over the head
// (m), the layer's opacity, the violet edge's brightness, the flames' rise (texture tiles a second), the tips' flicker
// (rad/s) and sway (half-widths), the outer roaring layer, the two sets of embers, black crackles (a second), the
// shockwave on the floor
// (v0.4.8.9: levels 3 and 4 are subtler than they were: still a step up from 2 and from each other, but fainter, a
// softer edge, less width and reach over the head, a smaller outer layer, fewer and smaller embers and crackles, a
// gentler floor pulse; they were 0.76/0.94 wide, rose 1.35/2.1 m, at 0.92/0.97 opacity with a 1.55/2.15 edge)
export const ICON_AURA = {
  width: [0.42, 0.54, 0.62, 0.69, 0.79],
  rise: [0.25, 0.5, 0.8, 1.04, 1.36],
  alpha: [0, 0.78, 0.84, 0.87, 0.9],
  rim: [0.9, 1.0, 1.15, 1.3, 1.52],
  speed: [0.3, 0.42, 0.55, 0.62, 0.74],
  flicker: [3, 4, 5.5, 6.4, 7.8],
  sway: [0, 0.07, 0.1, 0.115, 0.14],
  outer: [0, 0, 0, 0.4, 0.62],
  embers: [0, 0, 1, 0.8, 0.8],
  embers2: [0, 0, 0, 0.55, 0.65],
  crackle: [0, 0, 0, 0.25, 0.8],
  pulse: [0, 0, 0, 0, 1],
  pulseSpan: 0.9, // (m the floor pulse spreads at level 4: was 1.5)
  order: 6,
};
const REF_H = 1.75; // (m, feet to the head joint of the reference body the geometry is laid out on)
const NT = 6; // flame tips
// bones: 0 the feet, 1 the head, 2-7 the tips, 8-10 crackles, 11-12 the shockwave (inner / outer edge), 13-15 the outer
// layer (feet, head, tip), 16-18 and 19-21 the embers (feet, head, top)
export const AURA_BONES = { low: 0, head: 1, tip: 2, crack: 8, ringIn: 11, ringOut: 12, outer: 13, emb: 16, emb2: 19, n: 22 };
const AB = AURA_BONES;
const sm = t => M.smooth(t);

// the reference body's half-width at height yn (0 feet, 1 head, above it 1 + share of the flames' height)
function widthAt(yn) {
  if (yn <= 1) return yn < 0.3 ? 0.62 + 0.45 * Math.max(0, yn) : yn < 0.8 ? 0.755 + 0.49 * (yn - 0.3) : 1 - 0.5 * (yn - 0.8);
  return 0.9 * (1 - 0.68 * Math.min(1, yn - 1));
}

export function auraGeometry() {
  const P = [], N = [], U = [], C = [], J = [], W = [], I = [];
  const v = (x, y, z, u, vv, c, jw) => {
    P.push(x, y, z); N.push(0, 0, 1); U.push(u, vv); C.push(c[0], c[1], c[2], c[3]);
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0]; jw.slice(0, 4).forEach(([b, k], i) => { j[i] = b; w[i] = k; });
    const s = w[0] + w[1] + w[2] + w[3] || 1; J.push(...j); W.push(w[0] / s, w[1] / s, w[2] / s, w[3] / s);
    return P.length / 3 - 1;
  };
  const [fu0, fu1] = T.AURA_UV.flames;
  // a sheet of flame facing the camera: nx by ny cells from the floor to the top of the flames, its alpha shaped by
  // env(xn, yn) and its edge brightened toward the sides and the tips
  const sheet = ({ z, nx, ny, u0, u1, tile, phase, env, low, head, tips, nTips, xs = 1 }) => {
    const base = P.length / 3;
    for (let j = 0; j <= ny; j++) {
      const yn = -0.03 + 2.03 * (j / ny) ** 1.15; // (rows closer together near the floor and the body)
      for (let i = 0; i <= nx; i++) {
        const xn = -1 + 2 * i / nx, ax = Math.abs(xn);
        const x = xn * widthAt(yn) * xs;
        const u = Math.max(fu0, Math.min(fu1, u0 + (u1 - u0) * (i / nx) + 0.025 * Math.sin(yn * 2.6 + xn * 1.9 + phase)));
        const vv = phase + (yn <= 1 ? yn * REF_H : REF_H + (yn - 1) * 1.1) / tile;
        const a = env(xn, yn), boost = 1 + 0.7 * sm((ax - 0.4) / 0.5) + 0.35 * sm(yn - 1);
        let jw;
        if (yn <= 1) { const t = sm((yn - 0.35) / 0.6); jw = [[low, 1 - t], [head, t]]; }
        else {
          const t = sm((yn - 1) / 0.16);
          if (nTips === 1) jw = [[head, 1 - t], [tips, t]];
          else { const tp = (xn * 0.5 + 0.5) * (nTips - 1), k = Math.min(nTips - 2, Math.floor(tp)), f = tp - k; jw = [[head, 1 - t], [tips + k, t * (1 - f)], [tips + k + 1, t * f]]; }
        }
        v(x, yn, z, u, vv, [boost, boost * 0.95, boost, a], jw);
      }
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; I.push(a, b, c, b, d, c); }
  };
  const fadeUp = (yn, top) => yn <= 1 ? 1 : 1 - sm((yn - 1 - 0.12 * top) / (0.88 * top));
  const floorIn = yn => sm((yn + 0.03) / 0.16);
  // the outer roaring layer, furthest back (the heat-haze: wide, faint, fast)
  sheet({ z: -0.5, nx: 10, ny: 12, u0: 0.62, u1: 0.95, tile: 2.4, phase: 0.37, xs: 1.3, low: AB.outer, head: AB.outer + 1, tips: AB.outer + 2, nTips: 1,
    env: (xn, yn) => (1 - sm((Math.abs(xn) - 0.35) / 0.65)) * floorIn(yn) * fadeUp(yn, 1) * 0.68 });
  // the main body of it, behind him (his body hides the middle: it frames him)
  sheet({ z: -0.26, nx: 12, ny: 18, u0: 0.32, u1: 0.95, tile: 1.35, phase: 0, low: AB.low, head: AB.head, tips: AB.tip, nTips: NT,
    env: (xn, yn) => (1 - sm((Math.abs(xn) - 0.45) / 0.55)) * floorIn(yn) * fadeUp(yn, 1) });
  // the embers rising through it: narrow columns of the ember strip at random depths (square texels: 0.22 m wide)
  const [e0, e1] = T.AURA_UV.embers, eu0 = e0 + 0.008, eu1 = e1 - 0.008;
  const embers = (n, b0, tile, seed) => {
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let k = 0; k < n; k++) {
      const cx = (rnd() * 2 - 1) * 0.85, z = (rnd() * 2 - 1) * 0.36, hw = 0.17, ph = rnd(), base = P.length / 3;
      for (const [yn, a, bone] of [[0.05, 0, b0], [0.95, 0.95, b0 + 1], [1.95, 0, b0 + 2]]) {
        const vv = ph + (yn <= 1 ? yn * REF_H : REF_H + (yn - 1) * 1.1) / tile;
        v(cx - hw, yn, z, eu0, vv, [1.5, 1.3, 1.6, a], [[bone, 1]]); v(cx + hw, yn, z, eu1, vv, [1.5, 1.3, 1.6, a], [[bone, 1]]);
      }
      for (let r = 0; r < 2; r++) { const a = base + r * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  };
  embers(8, AB.emb, 1.76, 91);
  embers(6, AB.emb2, 1.2, 337);
  // the front layer: licks up his sides, faint across the middle of him
  sheet({ z: 0.3, nx: 10, ny: 14, u0: 0.4, u1: 0.9, tile: 1.0, phase: 0.61, low: AB.low, head: AB.head, tips: AB.tip, nTips: NT,
    env: (xn, yn) => { const ax = Math.abs(xn); return (0.14 + 0.86 * sm((ax - 0.2) / 0.4) * (1 - sm((ax - 0.7) / 0.3))) * floorIn(yn) * fadeUp(yn, 0.75) * 0.6; } });
  // the crackles: jagged black ribbons with a violet fringe (the solid strip: their shape is all vertex colour)
  const su = T.AURA_UV.solid, DARK = [0.02, 0, 0.05, 1], FRINGE = [1.1, 0.45, 2.2, 0];
  for (let c = 0; c < 3; c++) {
    let s = 17 + c * 101; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const pts = []; let x = 0;
    for (let k = 0; k <= 6; k++) { pts.push([x, k / 6 * 0.7]); x += (rnd() - 0.5) * 0.22; }
    const base = P.length / 3;
    pts.forEach(([px, py], k) => {
      const w = 0.035 * Math.sin(Math.PI * (0.15 + 0.7 * k / 6));
      v(px - w, py - 0.35, 0, su, 0.5, FRINGE, [[AB.crack + c, 1]]); v(px, py - 0.35, 0, su, 0.5, DARK, [[AB.crack + c, 1]]); v(px + w, py - 0.35, 0, su, 0.5, FRINGE, [[AB.crack + c, 1]]);
      if (k) { const a = base + (k - 1) * 3, b = base + k * 3; I.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2); }
    });
  }
  // the shockwave on the floor: a ring whose inner and outer edges ride their own bones (it thins away at the end)
  { const n = 48, rings = [[0, [0.12, 0.03, 0.24, 0]], [0.55, [0.015, 0, 0.03, 0.42]], [0.85, [0.28, 0.09, 0.56, 0.15]], [1, [0.28, 0.09, 0.56, 0]]] /* (v0.4.8.9: fainter: 0.62 / 0.22 alpha) */, base = P.length / 3;
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      for (const [w, c] of rings) { P.push(dx, 0, dz); N.push(0, 1, 0); U.push(su, 0.5); C.push(...c); J.push(AB.ringIn, AB.ringOut, 0, 0); W.push(1 - w, w, 0, 0); }
    }
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) { const a = base + i * 4 + r, b = a + 4; I.push(a, b, a + 1, a + 1, b, b + 1); } }
  return { position: new Float32Array(P), normal: new Float32Array(N), uv: new Float32Array(U), color: new Float32Array(C), joints: new Float32Array(J), weights: new Float32Array(W), index: new Uint16Array(I), bounds: { center: [0, 1, 0], radius: 3 } };
}

const lerpTab = (tab, lv) => { const i = Math.max(0, Math.min(3, Math.floor(lv))), k = Math.max(0, Math.min(1, lv - i)); return tab[i] + (tab[i + 1] - tab[i]) * k; };
// a bone: translate p, turn to yaw, scale (sx, sy, sz), about the anchor point (ax, ay, az) of the geometry
function bone(o, px, py, pz, yaw, sx, sy, sz, ax = 0, ay = 0, az = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  o[0] = c * sx; o[1] = 0; o[2] = -s * sx; o[3] = 0;
  o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0;
  o[8] = s * sz; o[9] = 0; o[10] = c * sz; o[11] = 0;
  o[12] = px - (o[0] * ax + o[8] * az); o[13] = py - sy * ay; o[14] = pz - (o[2] * ax + o[10] * az); o[15] = 1;
  return o;
}
const zero = o => o.fill(0);

export class IconAura {
  constructor(r, scene, level = 0) {
    this.r = r; this.ctx = r.ctx; this.scene = scene;
    this.tex = cachedTexture(this.ctx, 'iconAura', () => T.auraTexture(256), {});
    this.mat = new Material({ map: this.tex, color: [1, 1, 1], opacity: 0, shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false, doubleSided: true });
    this.mat.uvOffset = [0, Math.random()];
    this.mesh = new Mesh(this.ctx.geometry(auraGeometry()), this.mat, { castShadow: false, reflect: false, bones: new Float32Array(16 * AB.n), bounds: { center: [0, 1, 0], radius: 3 } });
    this.mesh.order = ICON_AURA.order; this.mesh.name = 'iconAura'; this.mesh.visible = false;
    scene.add(this.mesh);
    this.level = 0; this.show = 0; this.t = Math.random() * 20;
    this.cracks = [0, 1, 2].map(i => ({ life: 0, wait: 0.2 + i * 0.3, x: 0, y: 0, a: 0, s: 1 }));
    this.tips = Array.from({ length: NT }, (_, i) => ({ ph: i * 1.7 + Math.random(), f: 0.8 + 0.4 * Math.random() }));
    this.setLevel(level, true);
  }
  setLevel(level, snap = false) { this.level = Math.max(0, Math.min(4, level | 0)); if (snap) this.show = this.level; }
  get visible() { return !!this.mesh?.visible; }
  // where he is: the floor under him (x, y = his feet's height off it, z), the head (world), the camera's yaw from him
  update(dt, foot, head, yaw) {
    this.t += dt;
    this.show = M.damp(this.show, this.level, 2.2, dt);
    const lv = this.show, on = lv > 0.02, mesh = this.mesh;
    mesh.visible = on;
    if (!on) return;
    const A = ICON_AURA, t = this.t, b = mesh.bones, k1 = Math.min(1, lv);
    const at = i => b.subarray(i * 16, i * 16 + 16);
    const [fx, fy, fz] = foot, [hx, hy, hz] = head;
    const Hh = Math.max(0.9, hy - fy), size = 0.85 + 0.15 * Hh / REF_H;
    const sx = lerpTab(A.width, lv) * size * (0.6 + 0.4 * k1), rise = lerpTab(A.rise, lv) * size;
    const fl = lerpTab(A.flicker, lv), sw = lerpTab(A.sway, lv);
    // the body: feet and head (it bends with him: a lean, a crouch, a jump)
    bone(at(AB.low), fx, fy, fz, yaw, sx, Hh, 1);
    bone(at(AB.head), hx, hy, hz, yaw, sx, Hh, 1, 0, 1, 0);
    // the tips flicker: each sways and stretches on its own
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.tips.forEach((q, i) => {
      const ph = q.ph, f = fl * q.f;
      const swy = sw * sx * (Math.sin(t * f * 0.55 + ph) + 0.45 * Math.sin(t * f * 1.3 + ph * 2.1));
      const st = 1 + 0.22 * Math.sin(t * f + ph * 1.3) + 0.12 * Math.sin(t * f * 2.3 + ph);
      bone(at(AB.tip + i), hx + c * swy, hy, hz - s * swy, yaw, sx, rise * st, 1, 0, 1, 0);
    });
    // the outer layer: wide and faint, from 9 wins; roaring at 12
    const go = Math.max(0, Math.min(1, lerpTab(A.outer, lv)));
    if (go > 0.01) {
      const sw2 = sw * 1.4 * sx * Math.sin(t * fl * 0.7 + 0.4), st2 = 1 + 0.25 * Math.sin(t * fl * 0.9) + 0.1 * Math.sin(t * fl * 2.7 + 1);
      bone(at(AB.outer), fx, fy, fz, yaw, sx * go, Hh, go);
      bone(at(AB.outer + 1), hx, hy, hz, yaw, sx * go, Hh, go, 0, 1, 0);
      bone(at(AB.outer + 2), hx + c * sw2, hy, hz - s * sw2, yaw, sx * go, rise * 1.2 * st2 * go, go, 0, 1, 0);
    } else for (let i = 0; i < 3; i++) zero(at(AB.outer + i));
    // the embers (they rise with the texture)
    for (const [b0, tab] of [[AB.emb, A.embers], [AB.emb2, A.embers2]]) {
      const g = Math.max(0, Math.min(1, lerpTab(tab, lv)));
      if (g > 0.01) {
        bone(at(b0), fx, fy, fz, yaw, sx * g, Hh, g);
        bone(at(b0 + 1), hx, hy, hz, yaw, sx * g, Hh, g, 0, 1, 0);
        bone(at(b0 + 2), hx, hy, hz, yaw, sx * g, rise * 1.1 * g, g, 0, 1, 0);
      } else for (let i = 0; i < 3; i++) zero(at(b0 + i));
    }
    // black crackles flashing round him
    const rate = lerpTab(A.crackle, lv);
    this.cracks.forEach((q, i) => {
      const m = at(AB.crack + i);
      if (q.life > 0) {
        q.life -= dt;
        if (q.life > 0 && Math.sin(t * 70 + i * 2) > -0.35) {
          const rx = q.x * sx, py = fy + q.y * Hh, sc = q.s * (0.75 + 0.25 * k1);
          const rot = M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, q.a), [sc, sc, sc]);
          M.m4mul(m, bone(M.m4(), fx + c * rx + s * 0.34, py, fz - s * rx + c * 0.34, yaw, 1, 1, 1), rot);
          return;
        }
      }
      zero(m);
      if (rate > 0.01 && (q.wait -= dt) <= 0) { q.wait = (0.4 + Math.random() * 1.2) / rate; q.life = 0.1 + Math.random() * 0.14; q.x = (Math.random() * 2 - 1) * 0.95; q.y = 0.15 + Math.random() * 1.05; q.a = (Math.random() - 0.5) * 1.6; q.s = 0.7 + Math.random() * 0.6; }
    });
    // the shockwave: out from his feet every beat, thinning away as it goes
    const gp = Math.max(0, Math.min(1, lerpTab(A.pulse, lv)));
    if (gp > 0.01) {
      const P = 1.35, p = (t % P) / P, out = 1 - (1 - p) ** 2.2, inn = 1 - (1 - Math.max(0, (p - 0.22) / 0.78)) ** 1.6;
      const r0 = 0.9, span = A.pulseSpan * gp;
      M.m4fromYaw(at(AB.ringOut), fx, 0.02, fz, 0, 1); const ro = r0 + span * out; at(AB.ringOut)[0] = ro; at(AB.ringOut)[10] = ro;
      M.m4fromYaw(at(AB.ringIn), fx, 0.02, fz, 0, 1); const ri = r0 + span * inn; at(AB.ringIn)[0] = ri; at(AB.ringIn)[10] = ri;
    } else { zero(at(AB.ringIn)); zero(at(AB.ringOut)); }
    // the material: denser, brighter-edged and faster every level; a flicker in its strength
    const mat = this.mat;
    mat.opacity = lerpTab(A.alpha, lv) * Math.min(1, lv / 0.6) * (0.93 + 0.05 * Math.sin(t * fl * 1.7) + 0.02 * Math.sin(t * 23));
    const rim = lerpTab(A.rim, lv); mat.color[0] = rim; mat.color[1] = rim; mat.color[2] = rim;
    mat.uvOffset[1] = ((mat.uvOffset[1] - lerpTab(A.speed, lv) * dt) % 1 + 1) % 1;
    const o = mesh.boundsOverride; o.center[0] = (fx + hx) / 2; o.center[1] = fy + Hh * 0.7; o.center[2] = (fz + hz) / 2; o.radius = 1.4 + rise + (gp > 0.01 ? 0.6 + A.pulseSpan * 0.6 : 0);
  }
  dispose() { this.scene.remove(this.mesh); this.ctx.disposeGeometry?.(this.mesh.geo); this.mesh = null; }
}

// ---------------- on fire ----------------
// v0.4.8.5 quick patch 5: an ICON build on fire (the hot state: session.js PlayerVisual.setStatus) keeps his badge on
// the floor, and it burns: a ring of purple flame licking up from the cursor's outer rim, in place of the flame icon
// everyone else gets under him. It's laid out round the camera, like the badge's face: the flames behind the badge
// stand up tall, the ones at its sides lean out, and the ones between it and the camera lie low, reaching out over the
// floor toward it, so from any camera they frame the badge without covering it. A violet glow on the floor under them,
// a taller deep-purple layer with a bright violet-magenta core inside it, and embers rising off the back and sides.
// One skinned mesh (one draw call), built the first time he goes on fire and kept for the next time: bone 0 carries it
// to him turned to the camera, 1 the floor glow (pulsing), then one bone per sector of the ring (its tongues flicker:
// taller, further out, a sway), then the embers. The flames rise through it with the texture (uvOffset).
export const ICON_FIRE = {
  r0: 0.83, // where the tongues start (m): the team ring's outer edge
  len: [0.52, 0.86], // how far they reach (m), in front of the badge and behind it
  lean: [0.14, 1.22], // their angle up off the floor (rad), in front and behind (the park camera looks down at ~0.3)
  tongues: 15, // round the ring (the outer layer; the core has its own)
  glow: [0.78, 1.36], // the floor glow's inner and outer edge (m)
  speed: 0.95, // the flames' rise (texture heights a second)
  flicker: 7, // rad/s
  fadeIn: 0.3, fadeOut: 0.6, // (s: it flares up when he goes on fire, dies down when he cools off)
  order: 5,
};
const NS = 10, NE = 8; // sectors round the ring, embers
export const FIRE_BONES = { base: 0, glow: 1, tip: 2, ember: 2 + NS, n: 2 + NS + NE };
const FB = FIRE_BONES;

export function fireGeometry() {
  const F = ICON_FIRE, P = [], N = [], U = [], C = [], J = [], W = [], I = [], TAU = Math.PI * 2;
  const v = (x, y, z, u, vv, c, j, w) => { P.push(x, y, z); N.push(0, 1, 0); U.push(u, vv); C.push(c[0], c[1], c[2], c[3]); J.push(j[0], j[1] ?? 0, j[2] ?? 0, 0); W.push(w[0], w[1] ?? 0, w[2] ?? 0, 0); return P.length / 3 - 1; };
  const su = T.FIRE_UV.solid, [fu0, fu1] = T.FIRE_UV.flames;
  // the glow on the floor: a ring, strongest just outside the rim, gone at both edges
  { const n = 48, rows = [[F.glow[0], 0], [F.r0 + 0.05, 0.45], [F.r0 + 0.25, 0.18], [F.glow[1], 0]], k = rows.length, base = P.length / 3;
    for (let i = 0; i <= n; i++) { const a = i / n * TAU; for (const [r, al] of rows) v(Math.sin(a) * r, 0.019, Math.cos(a) * r, su, 0.5, [0.62, 0.06, 1.35, al], [FB.glow], [1]); }
    for (let i = 0; i < n; i++) for (let j = 0; j < k - 1; j++) { const a = base + i * k + j, b = a + k; I.push(a, b, a + 1, a + 1, b, b + 1); } }
  // a layer of flame: segs columns round the ring (reps times across the flame strip, each strip's ends on the same
  // spot), rows from the rim out to the tips. Angle 0 is toward the camera (local +z)
  const layer = ({ r0, len, lean, nT, phase, tile, alpha, c0, c1, seed, rows = 6, segs = 90, reps = 3 }) => {
    let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const tall = Array.from({ length: nT }, () => 0.7 + 0.6 * rnd()), k = segs / reps;
    for (let rep = 0; rep < reps; rep++) {
      const base = P.length / 3;
      for (let j = 0; j <= rows; j++) {
        const t = j / rows;
        for (let i = 0; i <= k; i++) {
          const a = (rep * k + i) / segs * TAU, sa = Math.sin(a), ca = Math.cos(a);
          const back = sm((1 - ca) / 2); // (0 in front of the badge, 1 behind it)
          const e = lean[0] + (lean[1] - lean[0]) * back, L = len[0] + (len[1] - len[0]) * back;
          // the tongues: tall in the middle, low between; the ones behind curl up a little as they rise
          const tp = a / TAU * nT + phase, ti = Math.floor(tp), prof = 0.5 - 0.5 * Math.cos((tp - ti) * TAU);
          const reach = L * (0.42 + 0.58 * prof ** 1.4 * tall[((ti % nT) + nT) % nT]) * t, ee = e + (Math.PI / 2 - e) * 0.2 * t * back;
          const rr = r0 + reach * Math.cos(ee), yy = 0.021 + reach * Math.sin(ee);
          const al = alpha * sm(t / 0.14) * (1 - t) ** 0.9 * (0.55 + 0.45 * prof);
          const sp = a / TAU * NS, sk = Math.floor(sp) % NS, sf = sp - Math.floor(sp), w = t ** 1.2;
          v(sa * rr, yy, ca * rr, fu0 + (fu1 - fu0) * i / k, phase + L * t / tile, [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, al],
            [FB.base, FB.tip + sk, FB.tip + (sk + 1) % NS], [1 - w, w * (1 - sf), w * sf]);
        }
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < k; i++) { const a = base + j * (k + 1) + i, b = a + 1, c = a + k + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    }
  };
  // the outer layer, deep purple at the tips; the core inside it, shorter and brighter (drawn over it)
  layer({ r0: F.r0, len: F.len, lean: F.lean, nT: F.tongues, phase: 0.13, tile: 0.95, alpha: 1, c0: [1.4, 0.36, 2.4], c1: [0.4, 0.05, 1.15], seed: 7 });
  layer({ r0: F.r0 - 0.015, len: F.len.map(l => l * 0.55), lean: [F.lean[0] + 0.03, F.lean[1]], nT: 11, phase: 0.61, tile: 0.6, alpha: 1, c0: [2.3, 0.95, 3.0], c1: [1.4, 0.28, 2.5], seed: 29, rows: 4 });
  // the embers: little sparks facing the camera, each on its own bone (where it is now; scaled to nothing between lives)
  for (let e = 0; e < NE; e++) {
    const hw = 0.03, b = FB.ember + e, col = [2.2, 0.7, 3.0], base = P.length / 3;
    v(0, 0, 0, su, 0.5, [...col, 1], [b], [1]);
    for (const [x, y] of [[-hw, 0], [0, hw * 1.7], [hw, 0], [0, -hw * 1.7]]) v(x, y, 0, su, 0.5, [...col, 0], [b], [1]);
    for (let q = 0; q < 4; q++) I.push(base, base + 1 + q, base + 1 + (q + 1) % 4);
  }
  return { position: new Float32Array(P), normal: new Float32Array(N), uv: new Float32Array(U), color: new Float32Array(C), joints: new Float32Array(J), weights: new Float32Array(W), index: new Uint16Array(I), bounds: { center: [0, 0.3, 0], radius: 1.7 } };
}

export class IconFire {
  constructor(r, scene) {
    this.r = r; this.ctx = r.ctx; this.scene = scene;
    this.tex = cachedTexture(this.ctx, 'iconFire', () => T.iconFireTexture(256), {});
    this.mat = new Material({ map: this.tex, color: [1, 1, 1], opacity: 0, shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false, doubleSided: true });
    this.mat.uvOffset = [0, Math.random()];
    this.mesh = new Mesh(this.ctx.geometry(fireGeometry()), this.mat, { castShadow: false, reflect: false, bones: new Float32Array(16 * FB.n), bounds: { center: [0, 0.3, 0], radius: 1.7 } });
    this.mesh.order = ICON_FIRE.order; this.mesh.name = 'iconFire'; this.mesh.visible = false;
    scene.add(this.mesh);
    this.show = 0; this.t = Math.random() * 10;
    this.tips = Array.from({ length: NS }, (_, i) => ({ ph: i * 2.3 + Math.random() * 2, f: 0.75 + 0.5 * Math.random() }));
    this.embers = Array.from({ length: NE }, (_, i) => ({ life: 0, age: 0, wait: i * 0.11, a: 0, r: 0, up: 0, out: 0, s: 1 }));
  }
  get visible() { return !!this.mesh?.visible; }
  hide() { this.show = 0; if (this.mesh) this.mesh.visible = false; }
  // the badge's spot (x, z: it stays on the floor like the badge, whatever his height y), the camera's yaw from it, and
  // whether he's on fire now (it flares up, and dies down when he cools off)
  update(dt, x, y, z, yaw, on = true) {
    const F = ICON_FIRE, mesh = this.mesh;
    this.show = on ? Math.min(1, this.show + dt / F.fadeIn) : Math.max(0, this.show - dt / F.fadeOut);
    mesh.visible = this.show > 0.001;
    if (!mesh.visible) return;
    const t = (this.t += dt), b = mesh.bones, at = i => b.subarray(i * 16, i * 16 + 16), k = sm(this.show), fl = F.flicker;
    M.m4fromYaw(at(FB.base), x, 0, z, yaw, 1);
    M.m4fromYaw(at(FB.glow), x, 0, z, yaw, 0.96 + 0.05 * Math.sin(t * 4.3) + 0.02 * Math.sin(t * 11));
    // the tongues: each sector of the ring reaches up and out on its own, and sways (they grow up out of the floor as
    // it flares up)
    this.tips.forEach((q, i) => {
      const f = fl * q.f, ph = q.ph, st = 1 + 0.2 * Math.sin(t * f + ph) + 0.1 * Math.sin(t * f * 2.3 + ph * 1.7), out = 1 + 0.07 * (st - 1);
      bone(at(FB.tip + i), x, 0, z, yaw + 0.045 * Math.sin(t * f * 0.5 + ph * 0.7), out, st * (0.25 + 0.75 * k), out);
    });
    // the embers: off the back and the sides of the ring, up and away, gone
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.embers.forEach((q, i) => {
      const m = at(FB.ember + i);
      if (q.life > 0 && (q.age += dt) < q.life) {
        const p = q.age / q.life, rr = q.r + q.out * p, lx = Math.sin(q.a) * rr + 0.03 * Math.sin(t * 3 + i), lz = Math.cos(q.a) * rr;
        M.m4fromYaw(m, x + c * lx + s * lz, 0.04 + q.up * p, z - s * lx + c * lz, yaw, q.s * Math.min(1, p * 6) * (1 - p) ** 0.7 * k);
        return;
      }
      zero(m); q.life = 0;
      if (on && (q.wait -= dt) <= 0) Object.assign(q, { a: Math.PI + (Math.random() * 2 - 1) * 2.2, r: F.r0 + Math.random() * 0.15, up: 0.55 + Math.random() * 0.6, out: 0.05 + Math.random() * 0.25, life: 0.7 + Math.random() * 0.6, age: 0, s: 0.7 + Math.random() * 0.6, wait: Math.random() * 0.5 });
    });
    // the material: a flicker in its strength and brightness; the flames rising through it
    const mat = this.mat, br = 1 + 0.08 * Math.sin(t * fl * 1.1 + 1);
    mat.opacity = k * (0.93 + 0.05 * Math.sin(t * fl * 1.6) + 0.02 * Math.sin(t * 23));
    mat.color[0] = br; mat.color[1] = br; mat.color[2] = br;
    mat.uvOffset[1] = ((mat.uvOffset[1] - F.speed * dt) % 1 + 1) % 1;
    const o = mesh.boundsOverride.center; o[0] = x; o[1] = 0.3; o[2] = z;
  }
  dispose() { this.scene.remove(this.mesh); this.ctx.disposeGeometry?.(this.mesh.geo); this.mesh = null; }
}

// ---------------- the two together, for a PlayerVisual ----------------
// opts.color: the team ring's colour (null: white); opts.cursor: false for the aura alone
export class IconFX {
  constructor(r, scene, build, opts = {}) {
    this.r = r; this.scene = scene; this.color = opts.color ?? null;
    this.state = iconFxState(build);
    this.cursor = opts.cursor === false ? null : new IconCursor(r, scene, this.state.badge || 'the_general', this.color);
    this.aura = null;
    // (statusOn: cold, the ice icon takes the badge's place; onFire: hot, the badge burns purple: IconFire, built the
    // first time it's needed)
    this.fire = null; this.onFire = false;
    this.hidden = false; this.statusOn = false; this.culled = false;
    this.last = null;
    this.setBuild(build, true);
  }
  get level() { return this.state.level; }
  // the build again (roam: a game played, an upgrade): its streak may have moved on (or ended)
  setBuild(build, snap = false) {
    this.state = iconFxState(build);
    if (this.state.level > 0 && !this.aura) { this.aura = new IconAura(this.r, this.scene, this.state.level); this.aura.mesh.culled = this.culled; }
    if (this.aura) this.aura.setLevel(this.state.level, snap);
    if (this.cursor && this.state.badge && this.state.badge !== this.cursor.badge) { this.cursor.dispose(); this.cursor = new IconCursor(this.r, this.scene, this.state.badge, this.color); this.cursor.mesh.culled = this.culled; }
  }
  setCulled(c) { this.culled = c; if (this.cursor) this.cursor.mesh.culled = c; if (this.aura) this.aura.mesh.culled = c; if (this.fire) this.fire.mesh.culled = c; }
  setHidden(h) { this.hidden = !!h; if (h) { if (this.cursor) this.cursor.mesh.visible = false; if (this.aura) this.aura.mesh.visible = false; if (this.fire) this.fire.hide(); } }
  // every frame, after he's posed: x, y, z where he is (y: off the floor), view his AthleteView (for his hips and head)
  place(x, y, z, view, hide = false, dt = null) {
    const tn = now(), d = dt ?? (this.last == null ? 1 / 60 : Math.max(0, Math.min(0.1, tn - this.last)));
    this.last = tn;
    const off = hide || this.hidden;
    const eye = this.r.lodEye, yaw = eye ? Math.atan2(eye[0] - x, eye[2] - z) : 0;
    if (this.cursor) {
      this.cursor.mesh.visible = !off && !this.statusOn;
      this.cursor.update(d, x, y, z, yaw);
    }
    // on fire: the badge stays and burns purple (an ICON build's own on-fire look; everybody else gets the flame icon)
    const burn = !!this.cursor && this.onFire && !this.statusOn;
    if (burn && !off && !this.fire) { this.fire = new IconFire(this.r, this.scene); this.fire.mesh.culled = this.culled; }
    if (this.fire) { if (off) this.fire.hide(); else this.fire.update(d, x, y, z, yaw, burn); }
    if (this.aura) {
      let foot = [x, y, z], head = [x, y + REF_H, z];
      if (view?.joint && view.model !== null) {
        const hp = view.joint(B.hips, [0, 0, 0]), hd = view.joint(B.head, [0, 0, 0]);
        if (Number.isFinite(hp[0]) && Number.isFinite(hd[1])) { foot = [x + (hp[0] - x) * 0.6, y, z + (hp[2] - z) * 0.6]; head = hd; }
      }
      if (off) { this.aura.mesh.visible = false; this.aura.show = this.aura.level ? this.aura.show : 0; return; }
      this.aura.update(d, foot, head, yaw);
    }
  }
  dispose() { if (this.cursor) this.cursor.dispose(); if (this.aura) this.aura.dispose(); if (this.fire) this.fire.dispose(); this.cursor = this.aura = this.fire = null; }
}
