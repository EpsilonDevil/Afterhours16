// v0.4.5 win-streak visuals, seen by everyone in the park.
//   * Regular parks: a wall of fire around the court of whoever is on a 3+ game streak. It grows every three
//     wins (3, 6, 9, 12) and stops growing at 12; the streak itself can keep going.
//   * The King Tut Cup: green lasers instead — beams that slide up and down the court sides and fade in and
//     out (phase), with more beams and brighter ones every three wins, also capped at 12.
//   * The Jungle Ballers (v0.4.7.5 qp3): rain over the court — a drizzle at 3 wins, heavier and slanting at 6
//     and 9, a downpour with lightning (a bolt over the court, the flash on everything, the thunder) at 12.
//   * And The Beat Goes On (v0.4.8.5 quick patch): a disco — a mirror ball lowers over the court at 3 wins with two
//     spotlights sweeping the floor; more spotlights and brighter at 6 (and real coloured light on the players), the
//     mirror ball's specks wheeling over the court at 9, and at 12 the full light show: four rigs of spots, the pools
//     flashing on the beat, beams from the corners up into the sky.
//   * The Monster Mash (v0.4.8.5 quick patch 2): the court is haunted — ghost-green spectral flames and will-o'-wisps ring
//     it at 3 wins; at 6 skeleton hands claw up out of the apron, fog creeps over the floor and the court's floodlights
//     turn ghost green and flicker; at 9 a ring of ghosts circles it; at 12 lightning cracks round it, a giant spectral
//     skull rises over it, its jaw working, and the ghosts and the wisps spiral up round it in a vortex of green fire.
import * as G from '../gfx/geometry.js';
import * as M from '../core/math.js';
import { Material, Mesh } from '../gfx/renderer.js';
import { COURT } from '../sim/constants.js';
import { audio } from '../core/audio.js';
import { mirrorBall, beamGeo } from './retro.js';
import * as T from '../gfx/textures.js';
import { cachedTexture } from './court.js';
import { skinGeo, ghostGeo, poseGhost, flashScene } from './horror.js';
import * as SP from '../core/spooky.js';

// the rain, per level: drops added at that level, their fall speed, the slant of the fall (m sideways per m down)
const RAINS = new WeakMap(); // scene -> the rain effects in it (the lightning flash is shared)
export const RAIN = { height: 11, drops: [420, 520, 700, 900], speed: [8, 9.5, 11, 13], slant: [0.02, 0.08, 0.16, 0.24], len: [0.3, 0.38, 0.46, 0.55], bolt: { every: [5, 11], hold: 0.16, flashes: 3 } };

export const streakLevel = streak => Math.min(4, Math.floor(Math.max(0, streak || 0) / 3));
// v0.4.8.5 quick patch: the disco, per level: a rig of spotlights turning round the ball ([cones, tilt from straight down
// (rad), turn speed (rad/s), colours]); the ball's height over the floor; the beat
export const DISCO_FX = { height: 11, bpm: 118, rigs: [
  [2, 0.5, 0.55, ['#ff3fa4', '#2fe0ff']], [2, 0.78, -0.7, ['#ffe45c', '#b14dff']],
  [4, 0.34, 0.95, ['#ff3fa4', '#3dffb0', '#2fe0ff', '#ffe45c']], [4, 0.98, -1.15, ['#b14dff', '#ff8a3c', '#2fe0ff', '#ff3fa4']]] };
// the fire shader's noise: cells per metre along the edge, and how often its motion loops (shaders.js FLAME_SPEED)
const FLAME_CELLS_PER_M = 2.2, FLAME_LOOP = 240;
// v0.4.8.5 quick patch 2: the haunt, per level: tongues of ghost fire round the court (their spacing, m), the wisps, the
// skeleton hands, the ghosts circling, the skull's height over the floor, how often the lightning strikes (s)
export const HAUNT_FX = { tongue: 0.85, wisps: 16, hands: 14, ghosts: 8, skullH: 15, bolt: { every: [3.5, 8], hold: 0.16, flashes: 3 } };
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
    if (kind === 'flame') this.buildFlames(court); else if (kind === 'rain') this.buildRain(court); else if (kind === 'disco') this.buildDisco(court); else if (kind === 'haunt') this.buildHaunt(court); else this.buildLasers();
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

  // v0.4.8.5 quick patch: the disco. Everything is static geometry turned by a matrix: the ball (with its cable), each rig's
  // cones and the pools they throw on the floor (one mesh each, turning together round the ball's axis), the specks (one
  // mesh of little squares on the floor, wheeling), the four sky beams. Two real spotlights ride the first rig from 6 wins.
  buildDisco(court) {
    const [ox, , oz] = court.origin, H = DISCO_FX.height, cz = court.full ? oz : oz + 6.5, lin = h => M.hexLinear(h);
    this.dc = { x: ox, z: cz, H };
    const mk = (geo, mat, order = 6) => { const m = new Mesh(this.ctx.geometry(geo), mat, { castShadow: false, reflect: false, cull: false }); m.order = order; m.visible = false; this.scene.add(m); this.meshes.push(m); return m; };
    // the ball and its cable
    const ball = mirrorBall(0.75, 12, 22, 7);
    this.ball = mk(G.merge([{ geo: ball, color: [1, 1, 1, 1] }, { geo: G.box(0.03, 40, 0.03), matrix: M.m4translation(M.m4(), 0, 20.7, 0), color: [0.3, 0.3, 0.32, 1] }]), new Material({ color: [0.95, 0.95, 1], roughness: 0.1, metalness: 1, specular: 1.5, emissive: [0.35, 0.33, 0.4] }), 0);
    // the rigs: cones from the ball down to the floor, and their pools of light
    this.rigs = DISCO_FX.rigs.map(([n, tilt, speed, cols], ri) => {
      const L = H / Math.cos(tilt), rf = 1.2 + 0.9 * tilt, cones = [], pools = [];
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + ri * 0.7, d = [Math.sin(tilt) * Math.cos(a), -Math.cos(tilt), Math.sin(tilt) * Math.sin(a)], c = lin(cols[i % cols.length]);
        const g = beamGeo(L, 0.06, rf, 12, 0.2); for (let v = 0; v < g.color.length; v += 4) { g.color[v] = c[0]; g.color[v + 1] = c[1]; g.color[v + 2] = c[2]; }
        cones.push({ geo: g, matrix: M.m4compose(M.m4(), [0, 0, 0], M.qfromTo(M.q4(), [0, 1, 0], d)) });
        // the pool: a disc fan, bright in the middle and gone at the rim, stretched along the tilt like a real oval
        const px = d[0] * L, pz = d[2] * L, pos = [px, -H + 0.035, pz], col = [...c, 0.55], idx = [], seg = 20, ux = Math.cos(a), uz = Math.sin(a), st = 1 / Math.cos(tilt);
        for (let k = 0; k <= seg; k++) { const t = k / seg * Math.PI * 2, rx = Math.cos(t) * rf * 1.1 * st, ry = Math.sin(t) * rf * 1.1; pos.push(px + ux * rx - uz * ry, -H + 0.035, pz + uz * rx + ux * ry); col.push(...c, 0); if (k) idx.push(0, k + 1, k); }
        const np = pos.length / 3, nrm = new Float32Array(np * 3); for (let k = 0; k < np; k++) nrm[k * 3 + 1] = 1;
        pools.push({ geo: { position: new Float32Array(pos), normal: nrm, uv: new Float32Array(np * 2), color: new Float32Array(col), index: new Uint16Array(idx) } });
      }
      const mat = new Material({ color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true });
      const pmat = new Material({ color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
      return { cones: mk(G.merge(cones), mat, 7), pools: mk(G.merge(pools), pmat, 6), mat, pmat, speed, tilt, a: ri * 1.3, dirs: cones.map(q => { const m = q.matrix; return [m[4], m[5], m[6]]; }), cols: cols.map(lin) };
    });
    // the specks: little squares of light wheeling over the floor
    const rng = (seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; })((court.seed ?? hashStr(court.id)) + 29);
    const sp = [], R = court.full ? 16 : 10, cs = ['#ffffff', '#ffffff', '#ff9fd0', '#9ff0ff', '#fff0a0'];
    for (let i = 0; i < 150; i++) { const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R, c = lin(cs[i % cs.length]); sp.push({ geo: G.plane(0.2, 0.2), matrix: M.m4translation(M.m4(), Math.cos(a) * r, -H + 0.04, Math.sin(a) * r), color: [...c, 1] }); }
    this.speckMat = new Material({ color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
    this.specks = mk(G.merge(sp), this.speckMat, 6);
    // the sky beams from the court's corners
    this.beamMat = new Material({ color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true });
    const bg = this.ctx.geometry(beamGeo(110, 0.25, 4.5, 12, 0.2));
    this.beams = this.sides.map(([[x, z]], i) => { const m = new Mesh(bg, this.beamMat, { castShadow: false, reflect: false, cull: false }); m.order = 7; m.visible = false; this.scene.add(m); this.meshes.push(m); return { m, x, z, i }; });
    this.discoLights = [0, 1].map(i => ({ pos: [ox, H, cz], range: H * 2.2, color: this.rigs[0].cols[i], intensity: 0, dir: [0, -1, 0], cos: Math.cos(0.2) }));
    this.lightsOn = false;
  }

  updateDisco(dt) {
    const lv = this.show, on = lv > 0.02, { x, z, H } = this.dc, beat = this.t * DISCO_FX.bpm / 60, pulse = 0.55 + 0.45 * (1 - (beat % 1)) ** 2;
    // the ball lowers into place as the streak starts, and turns
    const drop = Math.min(1, lv * 1.5), k = Math.max(0.001, Math.min(1, lv));
    this.ball.visible = on;
    M.m4compose(this.ball.matrix, [x, H + (1 - drop) * 14, z], M.qaxis(M.q4(), 0, 1, 0, this.t * 0.7), [k, k, k]);
    const top = this.level >= 4 && lv > 3.5;
    this.rigs.forEach((r, i) => {
      const b = Math.max(0, Math.min(1, lv - i)), vis = on && b > 0.02 && drop > 0.95;
      r.cones.visible = r.pools.visible = vis;
      if (!vis) return;
      r.a += r.speed * dt * (top ? 1.6 : 1);
      M.m4fromYaw(r.cones.matrix, x, H, z, r.a); r.pools.matrix.set(r.cones.matrix);
      const g = b * (0.55 + 0.12 * lv) * (top ? 0.65 + 0.55 * pulse : 1);
      r.mat.color[0] = r.mat.color[1] = r.mat.color[2] = g * 0.32;
      r.pmat.color[0] = r.pmat.color[1] = r.pmat.color[2] = g * 1.6;
    });
    // the specks from 9 wins, the sky beams at 12
    const sb = Math.max(0, Math.min(1, lv - 2));
    this.specks.visible = on && sb > 0.02;
    if (this.specks.visible) { M.m4fromYaw(this.specks.matrix, x, H, z, -this.t * 0.45); this.speckMat.color[0] = this.speckMat.color[1] = this.speckMat.color[2] = 1.8 * sb; }
    const bb = Math.max(0, Math.min(1, lv - 3));
    for (const b of this.beams) {
      b.m.visible = on && bb > 0.02;
      if (!b.m.visible) continue;
      const yaw = Math.atan2(b.x - x, b.z - z) + Math.sin(this.t * 0.8 + b.i * 1.7) * 0.7, tilt = 0.3 + 0.2 * Math.sin(this.t * 1.1 + b.i);
      M.m4mul(b.m.matrix, M.m4fromYaw(M.m4(), b.x, 0.2, b.z, yaw), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, tilt), [1, 1, 1]));
    }
    const hue = (beat * 0.125) % 1, f = n => { const kk = (n + hue * 6) % 6; return 1 - Math.max(0, Math.min(kk, 4 - kk, 1)); };
    this.beamMat.color[0] = (0.4 + 0.5 * f(5)) * bb; this.beamMat.color[1] = (0.2 + 0.5 * f(3)) * bb; this.beamMat.color[2] = (0.4 + 0.5 * f(1)) * bb;
    // real coloured light on the court from 6 wins: two spotlights riding the first rig's cones
    const want = on && this.level >= 2 && lv > 1.2, L = this.scene.lights;
    if (want && !this.lightsOn) { L.push(...this.discoLights); this.lightsOn = true; }
    if (!want && this.lightsOn) { for (const l of this.discoLights) { const i = L.indexOf(l); if (i >= 0) L.splice(i, 1); } this.lightsOn = false; }
    if (this.lightsOn) {
      const r0 = this.rigs[0], c = Math.cos(r0.a), s = Math.sin(r0.a);
      this.discoLights.forEach((l, i) => { const d = r0.dirs[i]; l.dir = [c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]]; l.intensity = 28 * Math.min(1, lv - 1.2) * (top ? 0.7 + 0.3 * pulse : 1); });
    }
  }

  // v0.4.8.5 quick patch 2: the haunt. Static geometry on bones (horror.js skinGeo): the tongues' tips ride six bones that
  // flicker up and down, each wisp, hand and ghost has its own, the skull two (its jaw works); the fog's texture drifts
  buildHaunt(court) {
    const [ox, , oz] = court.origin, C = this.ctx, lin = h => M.hexLinear(h), H = HAUNT_FX;
    const rng = (seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; })((court.seed ?? hashStr(court.id)) + 41);
    const mk = (geo, mat, order, nb = 0) => { const m = new Mesh(C.geometry(geo), mat, { castShadow: false, reflect: false, cull: false, bones: nb ? new Float32Array(16 * nb) : null }); m.order = order; m.visible = false; this.scene.add(m); this.meshes.push(m); return m; };
    const add = o => new Material({ color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true, ...o });
    // the outline as a path: u metres round it → [x, z, outward normal x, z]
    const P = [...this.sides.map(s => s[0]), this.sides[0][0]], seg = []; let tot = 0;
    for (let i = 0; i < 4; i++) { const [a, b] = [P[i], P[i + 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]), mx = (a[0] + b[0]) / 2 - ox, mz = (a[1] + b[1]) / 2 - (court.full ? oz : oz + 6.5); let nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l; if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; } seg.push({ a, b, l, u: tot, nx, nz }); tot += l; }
    const along = u => { u = ((u % tot) + tot) % tot; for (const g of seg) if (u <= g.u + g.l) { const k = (u - g.u) / g.l; return [g.a[0] + (g.b[0] - g.a[0]) * k, g.a[1] + (g.b[1] - g.a[1]) * k, g.nx, g.nz]; } return [P[0][0], P[0][1], 0, -1]; };
    // (the Got Next spots on the east side stay clear: nothing rises there)
    const nm = { x: ox + 9.4, z: court.full ? oz : oz + 6.2 }, clearOf = (x, z) => !(Math.abs(x - nm.x) < 1.6 && Math.abs(z - nm.z) < 6.5);
    this.hc = { ox, oz, cz: court.full ? oz : oz + 6.5, along, tot, rx: Math.abs(P[1][0] - P[0][0]) / 2 + 1.2, rz: Math.abs(P[2][1] - P[1][1]) / 2 + 1.2, rng };
    // the ghost fire: crossed quads round the outline, wide and bright at the floor, fading to a point; the tips on bones
    // 1..6, and a glowing band on the apron under them
    { const pos = [], col = [], jnt = [], wgt = [], idx = [], nrm = [], uv = [];
      const v = (x, y, z, c, b) => { pos.push(x, y, z); col.push(...c); jnt.push(b, 0, 0, 0); wgt.push(1, 0, 0, 0); nrm.push(0, 1, 0); uv.push(0, 0); return pos.length / 3 - 1; };
      let i = 0;
      for (let u = 0; u < tot; u += H.tongue * (0.8 + rng() * 0.4), i++) {
        const [x, z, nx, nz] = along(u); if (!clearOf(x, z)) continue;
        // (a tongue: wide and bright at the floor, a waist half way up leaning off to one side, the tip fading out)
        const h = 0.6 + rng() * 0.9, w = 0.16 + rng() * 0.16, b = 1 + (i % 6), lean = (rng() - 0.5) * 0.35, base = [0.1, 0.75, 0.2, 0.6], mid = [0.16, 0.9, 0.3, 0.32], tip = [0.3, 1.0, 0.4, 0];
        for (const [ax, az] of [[-nz, nx], [nx, nz]]) { const q0 = v(x - ax * w, 0, z - az * w, base, 0), q1 = v(x + ax * w, 0, z + az * w, base, 0), m1 = v(x + ax * (w * 0.55 + lean * 0.5), h * 0.45, z + az * (w * 0.55 + lean * 0.5), mid, 0), m0 = v(x - ax * (w * 0.55 - lean * 0.5), h * 0.45, z - az * (w * 0.55 - lean * 0.5), mid, 0), q2 = v(x + ax * (0.02 + lean), h, z + az * (0.02 + lean), tip, b), q3 = v(x - ax * (0.02 - lean), h, z - az * (0.02 - lean), tip, b); idx.push(q0, q1, m1, q0, m1, m0, m0, m1, q2, m0, q2, q3); }
      }
      for (let u = 0; u < tot; u += 1.0) { const [x, z, nx, nz] = along(u), [x2, z2] = along(u + 1.0); const a = v(x - nx * 0.6, 0.02, z - nz * 0.6, [0.2, 0.9, 0.3, 0], 0), b = v(x + nx * 0.2, 0.02, z + nz * 0.2, [0.2, 0.9, 0.3, 0.5], 0), c = v(x2 + nx * 0.2, 0.02, z2 + nz * 0.2, [0.2, 0.9, 0.3, 0.5], 0), d = v(x2 - nx * 0.6, 0.02, z2 - nz * 0.6, [0.2, 0.9, 0.3, 0], 0); idx.push(a, b, c, a, c, d); }
      this.fireMat = add({});
      this.fire = mk({ position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), color: new Float32Array(col), joints: new Float32Array(jnt), weights: new Float32Array(wgt), index: new Uint16Array(idx) }, this.fireMat, 6, 7); }
    // the will-o'-wisps: a hot core in a soft halo, a bone each
    const wp = []; for (let k = 0; k < H.wisps; k++) wp.push({ geo: G.sphere(0.09, 6, 4), color: [0.7, 1.4, 0.7, 1], bone: k }, { geo: G.sphere(0.3, 8, 6), color: [0.15, 0.7, 0.2, 0.3], bone: k });
    this.wispMat = add({}); this.wisps = mk(skinGeo(wp), this.wispMat, 7, H.wisps);
    this.wispU = Array.from({ length: H.wisps }, (_, k) => ({ u: k / H.wisps * tot + rng() * 3, s: (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.8), y: 1.0 + rng() * 1.2, ph: rng() * 6.3 }));
    // the hands: a bony forearm, the palm, curled fingers; a mound of earth each (bone 14, still) and a green glow under it
    const hp = [], bn = '#e2dccb', spots = [];
    for (let u = rng() * 3, k = 0; k < H.hands && u < tot; u += tot / H.hands) { const [x, z, nx, nz] = along(u); if (!clearOf(x, z)) continue; spots.push({ x: x - nx * 0.5, z: z - nz * 0.5, yaw: Math.atan2(-nx, -nz), ph: rng() * 6.3 }); }
    const HS = 1.6; // (the hands are big: you see them from the far end of the court)
    spots.forEach((sp, k) => {
      const n0 = hp.length;
      for (const sx of [-0.026, 0.026]) hp.push({ geo: G.box(0.04, 0.5, 0.04), matrix: M.m4translation(M.m4(), sx, 0.25, 0), color: [...lin(bn), 1], bone: k });
      hp.push({ geo: G.sphere(0.055, 6, 4), matrix: M.m4translation(M.m4(), 0, 0.51, 0), color: [...lin(bn), 1], bone: k }, { geo: G.box(0.15, 0.13, 0.05), matrix: M.m4translation(M.m4(), 0, 0.6, 0.01), color: [...lin(bn), 1], bone: k });
      for (let f = 0; f < 4; f++) { const fx = -0.055 + f * 0.037; hp.push({ geo: G.box(0.024, 0.11, 0.024), matrix: M.m4translation(M.m4(), fx, 0.72, 0.03), color: [...lin(bn), 1], bone: k }, { geo: G.box(0.022, 0.09, 0.022), matrix: M.m4mul(M.m4(), M.m4translation(M.m4(), fx, 0.78, 0.08), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, 0.9))), color: [...lin(bn), 1], bone: k }); }
      hp.push({ geo: G.box(0.024, 0.1, 0.024), matrix: M.m4mul(M.m4(), M.m4translation(M.m4(), 0.09, 0.6, 0.03), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 0, 0, 1, -0.7))), color: [...lin(bn), 1], bone: k });
      for (let q = n0; q < hp.length; q++) hp[q].matrix = M.m4mul(M.m4(), M.m4compose(M.m4(), [0, 0, 0], M.q4(), [HS, HS, HS]), hp[q].matrix);
      hp.push({ geo: G.sphere(0.5, 8, 5, { sy: 0.22 }), matrix: M.m4translation(M.m4(), sp.x, 0.0, sp.z), color: [...lin('#2a2018'), 1], bone: 14 });
    });
    this.handMat = new Material({ color: [1, 1, 1], roughness: 0.7, emissive: [0.04, 0.1, 0.05] });
    this.hands = mk(skinGeo(hp), this.handMat, 0, 15); this.handSpots = spots;
    M.m4identity(this.hands.bones.subarray(14 * 16, 15 * 16));
    this.glowMat = new Material({ map: cachedTexture(C, 'glowspot', () => T.glowSpot(128, 1.6), { wrap: 'clamp' }), color: [0, 0, 0], shading: 'unlit', blend: 'add', depthWrite: false, fog: false });
    this.glows = mk(G.merge(spots.map(sp => ({ geo: G.plane(1.8, 1.8), matrix: M.m4translation(M.m4(), sp.x, 0.03, sp.z), color: [0.3, 1, 0.35, 1] }))), this.glowMat, 5);
    // the fog over the floor: two thin drifting layers of wisps
    const fw = Math.abs(P[1][0] - P[0][0]) + 2, fd = Math.abs(P[2][1] - P[1][1]) + 2, ftex = cachedTexture(C, 'fogwisps', () => T.fogWisps({}), {});
    this.fogMats = [[0.2, 0.13, 7], [0.8, 0.07, 11]].map(([y, a, tile]) => { const g = G.plane(fw, fd, 1, 1); for (let q = 0; q < g.uv.length; q += 2) { g.uv[q] *= fw / tile; g.uv[q + 1] *= fd / tile; } const mat = new Material({ map: ftex, color: [0.42, 0.62, 0.48], opacity: 0, shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false }); const m = mk(g, mat, 5); M.m4translation(m.matrix, ox, y, this.hc.cz + (court.full ? 0 : -1.2)); return [mat, a, m]; });
    // the circle of ghosts
    this.ghostMat = new Material({ color: [0.8, 1.2, 1.0], opacity: 0, shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false });
    this.ghosts = mk(ghostGeo(H.ghosts, 1.3), this.ghostMat, 7, H.ghosts * 2);
    // the skull: the cranium and the face (bone 0), the jaw (bone 1), see-through ghost green, dark sockets; its eyes burn
    // (a second mesh, additive, on the same bones)
    const sk = [], sc = [0.7, 1.1, 0.8, 0.42], dk = [0.01, 0.04, 0.02, 0.9];
    sk.push({ geo: G.sphere(2.6, 16, 12, { sz: 1.1, sy: 0.95 }), matrix: M.m4translation(M.m4(), 0, 1.0, 0), color: sc, bone: 0 }, { geo: G.box(3.4, 1.7, 2.2), matrix: M.m4translation(M.m4(), 0, -0.6, 1.2), color: sc, bone: 0 });
    for (const sx of [-1, 1]) sk.push({ geo: G.sphere(0.72, 10, 8, { sz: 0.5 }), matrix: M.m4translation(M.m4(), sx * 0.95, 0.35, 2.55), color: dk, bone: 0 });
    sk.push({ geo: G.cylinder(0.02, 0.36, 0.6, 3), matrix: M.m4translation(M.m4(), 0, -0.45, 2.45), color: dk, bone: 0 });
    for (let k = -3; k <= 3; k++) { sk.push({ geo: G.box(0.32, 0.5, 0.2), matrix: M.m4translation(M.m4(), k * 0.36, -1.45, 2.2 - Math.abs(k) * 0.1), color: [0.9, 1.2, 0.95, 0.6], bone: 0 }, { geo: G.box(0.32, 0.45, 0.2), matrix: M.m4translation(M.m4(), k * 0.36, 0.2, 1.1 - Math.abs(k) * 0.1), color: [0.9, 1.2, 0.95, 0.6], bone: 1 }); }
    sk.push({ geo: G.box(2.9, 0.7, 2.0), matrix: M.m4translation(M.m4(), 0, -0.2, 0.3), color: sc, bone: 1 });
    this.skullMat = new Material({ color: [1, 1, 1], opacity: 0, shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false });
    this.skull = mk(skinGeo(sk), this.skullMat, 8, 2);
    this.skullEyeMat = add({});
    this.skullEyes = mk(skinGeo([-1, 1].map(sx => ({ geo: G.sphere(0.42, 10, 8), matrix: M.m4translation(M.m4(), sx * 0.95, 0.35, 2.35), color: [0.5, 2.2, 0.6, 1], bone: 0 }))), this.skullEyeMat, 9, 2);
    this.skullEyes.bones = this.skull.bones;
    // the lightning: a bolt rebuilt per strike, the flash on the whole town (horror.js flashScene)
    this.hBoltMat = new Material({ color: [6, 8.5, 6.5], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, doubleSided: true });
    this.hBolt = null; this.hBoltT = 0; this.hNext = 1;
    // the court's own floodlights: tinted ghost green and flickering from 6 wins (put back when the streak ends)
    this.hLights = this.scene.lights.filter(l => l.dir && Math.abs(l.pos[0] - ox) < 12 && Math.abs(l.pos[2] - this.hc.cz) < 22).map(l => ({ l, color: [...l.color], intensity: l.intensity }));
    this.hTint = false; this.hLevel = 0;
  }

  updateHaunt(dt) {
    const lv = this.show, on = lv > 0.02, H = HAUNT_FX, c = this.hc, t = this.t, k1 = Math.min(1, lv), k2 = Math.max(0, Math.min(1, lv - 1)), k3 = Math.max(0, Math.min(1, lv - 2)), k4 = Math.max(0, Math.min(1, lv - 3));
    const TR = (m, x, y, z, yaw, s = 1) => M.m4fromYaw(m, x, y, z, yaw, s);
    // the ghost fire: taller and hotter every level, the tips dancing
    this.fire.visible = on;
    if (on) {
      const b = this.fire.bones, hk = 0.55 + 0.55 * lv + 0.9 * k4;
      M.m4compose(b.subarray(0, 16), [0, 0, 0], M.q4(), [1, hk, 1]);
      // (the tips: their height flickers and they sway; the waists ride bone 0, so a tongue bends as it dances)
      for (let i = 1; i <= 6; i++) { const f = 0.75 + 0.25 * Math.sin(t * (7 + i) + i * 2) + 0.12 * Math.sin(t * 19 + i); M.m4compose(b.subarray(i * 16, i * 16 + 16), [Math.sin(t * 3 + i) * 0.16, 0, Math.cos(t * 2.6 + i) * 0.16], M.q4(), [1, hk * f, 1]); }
      const g = k1 * (0.75 + 0.12 * lv) * (0.9 + 0.1 * Math.sin(t * 17)); this.fireMat.color[0] = this.fireMat.color[1] = this.fireMat.color[2] = g;
    }
    // the wisps: drifting round the outline, bobbing; at 12 wins spiralling up round the court
    this.wisps.visible = on;
    if (on) {
      const b = this.wisps.bones;
      this.wispU.forEach((w, i) => {
        w.u += w.s * dt * (1 + k4 * 2);
        let [x, z] = c.along(w.u), y = w.y + Math.sin(t * 1.7 + w.ph) * 0.35;
        if (k4 > 0) { const f = ((t * 0.12 + i / H.wisps) % 1), a = w.u / c.tot * Math.PI * 2 + t * 0.8, rr = 1 - f * 0.45; x = c.ox + (x - c.ox) * (1 - k4) + Math.sin(a) * c.rx * rr * k4; z = c.cz + (z - c.cz) * (1 - k4) + Math.cos(a) * c.rz * rr * k4; y = y * (1 - k4) + (2 + f * 16) * k4; }
        TR(b.subarray(i * 16, i * 16 + 16), x, y, z, 0, 0.6 + 0.4 * k1 + 0.15 * Math.sin(t * 9 + w.ph));
      });
      const g = k1 * (0.8 + 0.2 * Math.sin(t * 5)); this.wispMat.color[0] = this.wispMat.color[1] = this.wispMat.color[2] = g;
    }
    // the hands claw their way up out of the apron, and keep clawing
    this.hands.visible = this.glows.visible = k2 > 0.01;
    if (this.hands.visible) {
      const b = this.hands.bones;
      this.handSpots.forEach((sp, i) => { const rise = M.smooth(k2 * 1.6 - (i % 5) * 0.12), m = b.subarray(i * 16, i * 16 + 16); TR(m, sp.x, -1.4 + rise * 1.4, sp.z, sp.yaw + Math.sin(t * 1.3 + sp.ph) * 0.3); const r = M.m4mul(M.m4(), m, M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.sin(t * 2.4 + sp.ph) * 0.35 + 0.15), null)); m.set(r); });
      const g = k2 * (0.6 + 0.2 * Math.sin(t * 3)); this.glowMat.color = [g * 0.4, g * 1.2, g * 0.45];
    }
    for (const [mat, a, m] of this.fogMats) { m.visible = k2 > 0.01; mat.opacity = a * k2; mat.uvOffset[0] = (mat.uvOffset[0] + dt * 0.012) % 1; mat.uvOffset[1] = (mat.uvOffset[1] + dt * 0.007) % 1; }
    // the floodlights: ghost green, flickering
    const want = this.level >= 2 && k2 > 0.3;
    if (want || this.hTint) for (const q of this.hLights) {
      if (!want) { q.l.color = [...q.color]; q.l.intensity = q.intensity; continue; }
      const f = 0.82 + 0.18 * Math.sin(t * 13 + q.intensity) * Math.sin(t * 3.1) + (Math.random() < dt * 2 ? -0.5 : 0);
      q.l.color = [M.lerp(q.color[0], 0.42, k2), M.lerp(q.color[1], 1.0, k2), M.lerp(q.color[2], 0.48, k2)]; q.l.intensity = q.intensity * Math.max(0.3, f);
    }
    this.hTint = want;
    // the ghosts circle the court; at 12 wins they spiral up into the vortex
    this.ghosts.visible = k3 > 0.01; this.ghostMat.opacity = k3 * 0.9;
    if (this.ghosts.visible) for (let i = 0; i < H.ghosts; i++) {
      const a = t * 0.35 + i / H.ghosts * Math.PI * 2, f = ((t * 0.08 + i / H.ghosts) % 1), rr = 1 - k4 * f * 0.4, x = c.ox + Math.sin(a) * c.rx * rr, z = c.cz + Math.cos(a) * c.rz * rr, y = 3.4 + Math.sin(t * 1.2 + i) * 0.4 + k4 * f * 15;
      poseGhost(this.ghosts.bones, i, x, y, z, a + Math.PI / 2, t + i, 1);
    }
    // the skull rises over the court, its jaw working, its eyes burning; lightning cracks round it
    this.skull.visible = this.skullEyes.visible = k4 > 0.01;
    if (this.skull.visible) {
      const b = this.skull.bones, y = H.skullH - 6 * (1 - k4) + Math.sin(t * 0.9) * 0.5, s = 0.4 + 0.6 * k4;
      M.m4mul(b.subarray(0, 16), M.m4fromYaw(M.m4(), c.ox, y, c.cz, Math.PI + Math.sin(t * 0.37) * 0.5, s), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.sin(t * 0.5) * 0.1), null));
      M.m4mul(b.subarray(16, 32), b.subarray(0, 16), M.m4mul(M.m4(), M.m4translation(M.m4(), 0, -1.3, -0.3), M.m4mul(M.m4(), M.m4compose(M.m4(), [0, 0, 0], M.qaxis(M.q4(), 1, 0, 0, Math.max(0, Math.sin(t * 2.2)) * 0.45), null), M.m4translation(M.m4(), 0, -0.4, 0.4))));
      this.skullMat.opacity = k4; const g = k4 * (1.2 + 0.5 * Math.sin(t * 6)); this.skullEyeMat.color[0] = this.skullEyeMat.color[1] = this.skullEyeMat.color[2] = g;
      if (this.level >= 4 && k4 > 0.9 && (this.hNext -= dt) <= 0) { this.hauntStrike(); this.hNext = H.bolt.every[0] + c.rng() * (H.bolt.every[1] - H.bolt.every[0]); }
    }
    if (this.hBolt) { this.hBoltT -= dt; const ph = Math.max(0, this.hBoltT) / H.bolt.hold; this.hBolt.visible = this.hBoltT > 0 && (ph % 1) > 0.35; if (this.hBolt.visible) flashScene(this.scene, 0.7); if (this.hBoltT <= 0) { this.scene.remove(this.hBolt); const i = this.meshes.indexOf(this.hBolt); if (i >= 0) this.meshes.splice(i, 1); this.hBolt = null; } }
    if (Math.floor(lv + 0.5) > this.hLevel) { if (this.hLevel >= 1 && lv > 2.5) SP.moan(0, 0.3); } this.hLevel = Math.floor(lv + 0.5);
  }
  // a bolt from high over the court down onto its apron (never onto the floor in play)
  hauntStrike() {
    const c = this.hc, r = c.rng, [tx, tz] = c.along(r() * c.tot), top = [tx + (r() - 0.5) * 10, 42, tz + (r() - 0.5) * 10], path = [top];
    for (let i = 1; i <= 9; i++) { const k = i / 9; path.push([top[0] + (tx - top[0]) * k + (r() - 0.5) * 2.5 * (1 - k), 42 * (1 - k) + 0.1, top[2] + (tz - top[2]) * k + (r() - 0.5) * 2.5 * (1 - k)]); }
    const f0 = path[3 + Math.floor(r() * 3)], parts = [{ geo: G.tube(path, k => 0.2 - 0.13 * k, 5) }, { geo: G.tube([f0, [f0[0] + (r() - 0.5) * 7, f0[1] - 7, f0[2] + (r() - 0.5) * 7], [f0[0] + (r() - 0.5) * 9, f0[1] - 13, f0[2] + (r() - 0.5) * 9]], k => 0.07 - 0.05 * k, 4) }];
    if (this.hBolt) { this.scene.remove(this.hBolt); const i = this.meshes.indexOf(this.hBolt); if (i >= 0) this.meshes.splice(i, 1); }
    this.hBolt = new Mesh(this.ctx.geometry(G.merge(parts, false)), this.hBoltMat, { castShadow: false, reflect: false });
    this.hBolt.order = 9; this.scene.add(this.hBolt); this.meshes.push(this.hBolt);
    this.hBoltT = HAUNT_FX.bolt.hold * HAUNT_FX.bolt.flashes; flashScene(this.scene, 1); SP.thunder(0.12, 0.9);
    audio.rumble?.(0.35);
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
    if (this.kind === 'disco') return this.updateDisco(dt);
    if (this.kind === 'haunt') return this.updateHaunt(dt);
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

  dispose() {
    for (const m of this.meshes) this.scene.remove(m); this.meshes = [];
    if (this.lightsOn) { for (const l of this.discoLights) { const i = this.scene.lights.indexOf(l); if (i >= 0) this.scene.lights.splice(i, 1); } this.lightsOn = false; }
    if (this.hLights) { for (const q of this.hLights) { q.l.color = [...q.color]; q.l.intensity = q.intensity; } this.hTint = false; } // (v0.4.8.5 quick patch 2: the haunt gives the floodlights back)
    if (this.kind === 'rain') { RAINS.get(this.scene)?.delete(this); if (this.baseExposure != null) this.scene.exposure = this.baseExposure; } }
}
