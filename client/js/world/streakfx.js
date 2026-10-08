// v0.4.5 win-streak visuals, seen by everyone in the park.
//   * Regular parks: a wall of fire around the court of whoever is on a 3+ game streak. It grows every three
//     wins (3, 6, 9, 12) and stops growing at 12; the streak itself can keep going.
//   * The King Tut Cup: green lasers instead — beams that slide up and down the court sides and fade in and
//     out (phase), with more beams and brighter ones every three wins, also capped at 12.
import * as G from '../gfx/geometry.js';
import * as M from '../core/math.js';
import * as T from '../gfx/textures.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { cachedTexture } from './court.js';
import { COURT } from '../sim/constants.js';

export const streakLevel = streak => Math.min(4, Math.floor(Math.max(0, streak || 0) / 3));

// the court's outline at the fence line (the same runs venues.js fences)
function outline(court, inset = 0.35) {
  const [ox, , oz] = court.origin, W = COURT.width / 2 + 2.2 - inset, L = COURT.length / 2 + 2.6 - inset;
  const z0 = court.full ? oz - L : oz - 3.2 + inset, z1 = oz + L;
  return [[ox - W, z0], [ox + W, z0], [ox + W, z1], [ox - W, z1]];
}

export class StreakFX {
  constructor(ctx, scene, court, kind) {
    this.ctx = ctx; this.scene = scene; this.court = court; this.kind = kind;
    this.level = 0; this.show = 0; this.t = Math.random() * 10;
    this.meshes = [];
    const pts = outline(court);
    this.sides = pts.map((p, i) => [p, pts[(i + 1) % 4]]);
    if (kind === 'flame') this.buildFlames(); else this.buildLasers();
  }

  buildFlames() {
    const tex = cachedTexture(this.ctx, 'flamewall', () => T.flameWallTexture(), { wrap: 'repeat' });
    const parts = [];
    for (const [[x0, z0], [x1, z1]] of this.sides) {
      const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
      const q = G.quad(len, 1);
      // quad is centered; lift it so its base sits on the floor, tile the strip along its length
      for (let i = 1; i < q.position.length; i += 3) q.position[i] += 0.5;
      for (let i = 0; i < q.uv.length; i += 2) q.uv[i] *= len / 2.4;
      parts.push({ geo: q, matrix: M.m4fromYaw(M.m4(), (x0 + x1) / 2, 0, (z0 + z1) / 2, yaw) });
    }
    const geo = this.ctx.geometry(G.merge(parts, false));
    // two layers scrolling at different speeds so the fire never looks like a looping strip
    this.layers = [0, 1].map(k => {
      const mat = new Material({ map: tex, color: [2.2, 1.6, 1.1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true, uvOffset: [k * 0.37, 0] });
      const m = new Mesh(geo, mat, { castShadow: false, reflect: false });
      m.order = 6; m.visible = false; this.scene.add(m); this.meshes.push(m);
      return { m, mat, speed: k ? 0.55 : 0.85, drift: k ? -0.04 : 0.03, scale: k ? 0.85 : 1 };
    });
  }

  buildLasers() {
    const green = [0.35, 2.6, 1.1];
    this.beamMat = new Material({ color: green, shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
    // horizontal beams: one geometry with a beam along each side (moved up and down as a ring)
    const ring = this.sides.map(([[x0, z0], [x1, z1]]) => {
      const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
      return { geo: G.box(0.035, 0.035, len), matrix: M.m4fromYaw(M.m4(), (x0 + x1) / 2, 0, (z0 + z1) / 2, yaw) };
    });
    const ringGeo = this.ctx.geometry(G.merge(ring, false));
    this.rings = [0, 1, 2, 3].map(i => { const m = new Mesh(ringGeo, this.beamMat, { castShadow: false, reflect: false }); m.order = 6; m.visible = false; this.scene.add(m); this.meshes.push(m); return { m, ph: i * 1.7 }; });
    // vertical beams that slide along the sides
    const sliderGeo = this.ctx.geometry(G.box(0.04, 2.6, 0.04));
    this.sliders = [0, 1, 2, 3, 4, 5, 6, 7].map(i => { const m = new Mesh(sliderGeo, this.beamMat, { castShadow: false, reflect: false }); m.order = 6; m.visible = false; this.scene.add(m); this.meshes.push(m); return { m, side: i % 4, ph: i * 0.61, speed: 0.18 + (i % 3) * 0.05 }; });
    // emitters at the corners
    const em = this.sides.map(([[x, z]]) => ({ geo: G.box(0.22, 0.22, 0.22), matrix: M.m4translation(M.m4(), x, 0.11, z) }));
    this.emitters = new Mesh(this.ctx.geometry(G.merge(em, false)), new Material({ color: [0.5, 3, 1.4], shading: 'unlit', fog: false }), { castShadow: false, reflect: false });
    this.emitters.visible = false; this.scene.add(this.emitters); this.meshes.push(this.emitters);
  }

  setLevel(level) { this.level = Math.max(0, Math.min(4, level | 0)); }

  update(dt) {
    this.t += dt;
    // fade in and out instead of popping
    this.show = M.damp(this.show, this.level, 2.5, dt);
    const lv = this.show;
    if (this.kind === 'flame') {
      const h = lv < 0.02 ? 0 : 0.6 + lv * 0.95; // 1.55 m at 3 wins, 2.5 at 6, 3.45 at 9, 4.4 m (over the fence) at 12
      for (const L of this.layers) {
        L.m.visible = h > 0;
        if (!L.m.visible) continue;
        L.mat.uvOffset[1] = (L.mat.uvOffset[1] + L.speed * dt) % 1;
        L.mat.uvOffset[0] = (L.mat.uvOffset[0] + L.drift * dt) % 1;
        const flick = 1 + 0.06 * Math.sin(this.t * 13 + L.speed * 7) + 0.04 * Math.sin(this.t * 23);
        M.m4compose(L.m.matrix, [0, 0, 0], M.q4(), [1, h * L.scale * flick, 1]);
        const b = 0.6 + 0.25 * lv;
        L.mat.color[0] = 2.2 * b; L.mat.color[1] = 1.55 * b; L.mat.color[2] = 1.0 * b;
      }
      return;
    }
    const on = lv > 0.02, n = Math.round(Math.max(this.level, lv));
    const bright = 0.5 + 0.28 * lv;
    this.beamMat.color[0] = 0.35 * bright; this.beamMat.color[1] = 2.6 * bright; this.beamMat.color[2] = 1.1 * bright;
    this.emitters.visible = on;
    this.rings.forEach((r, i) => {
      r.m.visible = on && i < n;
      if (!r.m.visible) return;
      // slide up and down the sides; phase out briefly now and then
      const y = 0.35 + 1.1 * (0.5 + 0.5 * Math.sin(this.t * (0.9 + i * 0.23) + r.ph));
      r.m.visible = Math.sin(this.t * (1.7 + i * 0.4) + r.ph * 3) > -0.85;
      M.m4translation(r.m.matrix, 0, y, 0);
    });
    this.sliders.forEach((sl, i) => {
      sl.m.visible = on && i < n * 2;
      if (!sl.m.visible) return;
      const [[x0, z0], [x1, z1]] = this.sides[sl.side];
      const u = 0.5 + 0.5 * Math.sin(this.t * sl.speed * Math.PI * 2 + sl.ph);
      sl.m.visible = Math.sin(this.t * 2.3 + sl.ph * 5) > -0.7;
      M.m4translation(sl.m.matrix, x0 + (x1 - x0) * u, 1.3, z0 + (z1 - z0) * u);
    });
  }

  dispose() { for (const m of this.meshes) this.scene.remove(m); this.meshes = []; }
}
