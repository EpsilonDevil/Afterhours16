// v0.4.5 win-streak visuals, seen by everyone in the park.
//   * Regular parks: a wall of fire around the court of whoever is on a 3+ game streak. It grows every three
//     wins (3, 6, 9, 12) and stops growing at 12; the streak itself can keep going.
//   * The King Tut Cup: green lasers instead — beams that slide up and down the court sides and fade in and
//     out (phase), with more beams and brighter ones every three wins, also capped at 12.
//   * The Jungle Ballers (v0.4.7.5 qp3): rain over the court — a drizzle at 3 wins, heavier and slanting at 6
//     and 9, a downpour with lightning (a bolt over the court, the flash on everything, the thunder) at 12.
import * as G from '../gfx/geometry.js';
import * as M from '../core/math.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { COURT } from '../sim/constants.js';
import { audio } from '../core/audio.js';

// the rain, per level: drops added at that level, their fall speed, the slant of the fall (m sideways per m down)
const RAINS = new WeakMap(); // scene -> the rain effects in it (the lightning flash is shared)
export const RAIN = { height: 11, drops: [420, 520, 700, 900], speed: [8, 9.5, 11, 13], slant: [0.02, 0.08, 0.16, 0.24], len: [0.3, 0.38, 0.46, 0.55], bolt: { every: [5, 11], hold: 0.16, flashes: 3 } };

export const streakLevel = streak => Math.min(4, Math.floor(Math.max(0, streak || 0) / 3));
// the fire shader's noise: cells per metre along the edge, and how often its motion loops (shaders.js FLAME_SPEED)
const FLAME_CELLS_PER_M = 2.2, FLAME_LOOP = 240;
const hashStr = s => { let h = 7; for (const ch of String(s ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

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
    if (kind === 'flame') this.buildFlames(court); else if (kind === 'rain') this.buildRain(court); else this.buildLasers();
  }

  // v0.4.7.5 qp3: rain over the court. Four layers of streaks (one per level) over the court and its apron, each a
  // static geometry the vertex shader rains down (shaders.js RAIN): no per-frame uploads. Level 4 adds the bolts.
  buildRain(court) {
    const [ox, , oz] = court.origin, W = COURT.width / 2 + 2.6, L = COURT.length / 2 + 3.0;
    const z0 = court.full ? oz - L : oz - 3.6, z1 = oz + L, H = RAIN.height;
    const rng = (seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; })((court.seed ?? hashStr(court.id)) + 11);
    this.rainMat = [];
    this.rain = RAIN.drops.map((n, lv) => {
      const pos = [], nrm = [], uv = [], idx = [];
      for (let i = 0; i < n; i++) {
        const x = ox + (rng() * 2 - 1) * W, z = z0 + rng() * (z1 - z0), y = rng() * H, len = RAIN.len[lv] * (0.7 + 0.6 * rng()), w = 0.005 + 0.006 * rng();
        const k = i * 4;
        for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { pos.push(x, y, z); nrm.push(len, w, 0); uv.push(sx, sy); }
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
      const geo = this.ctx.geometry({ position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), index: new Uint16Array(idx) });
      const mat = new Material({ color: [0.55, 0.62, 0.7], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true, rain: [H, RAIN.speed[lv], RAIN.slant[lv], RAIN.slant[lv] * 0.4] });
      this.rainMat.push(mat);
      const m = new Mesh(geo, mat, { castShadow: false, reflect: false });
      m.order = 6; m.visible = false; this.scene.add(m); this.meshes.push(m);
      return m;
    });
    // the bolt: a jagged bright line from high over the court down to a point on the apron; rebuilt per strike
    this.boltMat = new Material({ color: [8, 8.5, 10], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true });
    this.bolt = null; this.boltT = 0; this.nextBolt = RAIN.bolt.every[0] + rng() * (RAIN.bolt.every[1] - RAIN.bolt.every[0]); this.flash = 0;
    this.rng = rng; this.rect = { x0: ox - W, x1: ox + W, z0, z1 };
    this.baseExposure = null;
    if (!RAINS.has(this.scene)) RAINS.set(this.scene, new Set());
    RAINS.get(this.scene).add(this);
  }

  strike() {
    const r = this.rng, { x0, x1, z0, z1 } = this.rect;
    const tx = x0 + r() * (x1 - x0), tz = z0 + r() * (z1 - z0), top = [tx + (r() - 0.5) * 14, 46, tz + (r() - 0.5) * 14];
    const path = [top];
    for (let i = 1; i <= 9; i++) { const t = i / 9; path.push([top[0] + (tx - top[0]) * t + (r() - 0.5) * 3 * (1 - t), 46 * (1 - t) + 0.2, top[2] + (tz - top[2]) * t + (r() - 0.5) * 3 * (1 - t)]); }
    const parts = [{ geo: G.tube(path, t => 0.22 - 0.15 * t, 5) }];
    // a fork off the middle
    const k = 3 + Math.floor(r() * 3), f0 = path[k], fork = [f0, [f0[0] + (r() - 0.5) * 6, f0[1] - 6 - r() * 6, f0[2] + (r() - 0.5) * 6]];
    fork.push([fork[1][0] + (r() - 0.5) * 5, fork[1][1] - 5 - r() * 5, fork[1][2] + (r() - 0.5) * 5]);
    parts.push({ geo: G.tube(fork, t => 0.07 - 0.05 * t, 4) });
    if (this.bolt) { this.scene.remove(this.bolt); const i = this.meshes.indexOf(this.bolt); if (i >= 0) this.meshes.splice(i, 1); }
    this.bolt = new Mesh(this.ctx.geometry(G.merge(parts, false)), this.boltMat, { castShadow: false, reflect: false });
    this.bolt.order = 7; this.scene.add(this.bolt); this.meshes.push(this.bolt);
    this.boltT = RAIN.bolt.hold * RAIN.bolt.flashes; this.flash = 1;
    audio.rumble?.(0.6);
  }

  // v0.4.5 quick patch: one continuous wall of procedural fire all the way round the court (shaders.js FLAME). It
  // used to be a flame picture tiled every 2.4 m and scrolled upward, which repeated visibly, wrapped its glowing
  // base round to the top, and jittered as the whole wall was rescaled every frame.
  buildFlames(court) {
    // one strip round the outline; u = metres along the edge, continuous through the corners and back to the start
    const pts = [...this.sides.map(s => s[0]), this.sides[0][0]];
    const pos = [], nrm = [], uv = [], idx = [];
    let u = 0;
    pts.forEach(([x, z], i) => {
      if (i) u += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      pos.push(x, 0, z, x, 1, z); nrm.push(0, 0, 1, 0, 0, 1); uv.push(u, 0, u, 1);
      if (i) { const k = i * 2; idx.push(k - 2, k, k + 1, k - 2, k + 1, k - 1); }
    });
    this.perimeter = u;
    const geo = this.ctx.geometry({ position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), index: new Uint16Array(idx) });
    // the noise has to close round the court: a whole number of cells (a multiple of 4, for the coarser octaves)
    const cells = Math.max(8, Math.round(u * FLAME_CELLS_PER_M / 4) * 4);
    this.flameMat = new Material({ color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true, flame: [0, 1, cells / u, cells], flameT: [0, (court.seed ?? hashStr(court.id)) % 97, 0, 0] });
    this.wall = new Mesh(geo, this.flameMat, { castShadow: false, reflect: false });
    this.wall.order = 6; this.wall.visible = false; this.scene.add(this.wall); this.meshes.push(this.wall);
    this.flameT = Math.random() * FLAME_LOOP;
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
      // each milestone (3, 6, 9, 12 wins) makes it taller, brighter and fuller: 1.4 m, 2.2 m, 3.0 m, 3.8 m. The level
      // eases in, so it grows smoothly instead of popping, and nothing is rescaled per frame
      const on = lv > 0.02;
      this.wall.visible = on;
      if (!on) return;
      this.flameT = (this.flameT + dt) % FLAME_LOOP; // the shader's motion loops seamlessly every FLAME_LOOP seconds
      const h = 0.6 + 0.8 * lv, fade = Math.min(1, lv / 0.6);
      M.m4compose(this.wall.matrix, [0, 0, 0], M.q4(), [1, h, 1]);
      const F = this.flameMat.flame, T = this.flameMat.flameT;
      F[0] = fade * (0.75 + 0.15 * lv); F[1] = h;
      T[0] = this.flameT; T[2] = 0.02 * lv;
      return;
    }
    if (this.kind === 'rain') {
      const on = lv > 0.02;
      // each level's layer fades in as the level eases up to it
      this.rain.forEach((m, i) => { const k = Math.max(0, Math.min(1, lv - i)); m.visible = on && k > 0.02; const c = 0.55 * k * (0.7 + 0.1 * lv); this.rainMat[i].color[0] = c; this.rainMat[i].color[1] = c * 1.12; this.rainMat[i].color[2] = c * 1.3; });
      // the storm: bolts over the court at the top tier
      const scene = this.scene;
      if (this.baseExposure == null) this.baseExposure = scene.exposure;
      if (this.level >= 4 && lv > 3.5) { if ((this.nextBolt -= dt) <= 0) { this.strike(); this.nextBolt = RAIN.bolt.every[0] + this.rng() * (RAIN.bolt.every[1] - RAIN.bolt.every[0]); } }
      if (this.bolt) {
        this.boltT -= dt;
        const ph = Math.max(0, this.boltT) / RAIN.bolt.hold;
        this.bolt.visible = this.boltT > 0 && (ph % 1) > 0.35;
        this.flash = this.boltT > 0 ? (this.bolt.visible ? 1 : 0.35) : M.damp(this.flash, 0, 12, dt);
        if (this.boltT <= 0 && this.flash < 0.02) { this.scene.remove(this.bolt); const i = this.meshes.indexOf(this.bolt); if (i >= 0) this.meshes.splice(i, 1); this.bolt = null; this.flash = 0; }
      }
      // (every court's rain shares the scene: the flash that shows is the brightest of all of them right now)
      let fl = 0; for (const o of RAINS.get(scene) || []) fl = Math.max(fl, o.flash || 0);
      scene.exposure = this.baseExposure * (1 + 1.4 * fl);
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

  dispose() { for (const m of this.meshes) this.scene.remove(m); this.meshes = []; if (this.kind === 'rain') { RAINS.get(this.scene)?.delete(this); if (this.baseExposure != null) this.scene.exposure = this.baseExposure; } }
}
