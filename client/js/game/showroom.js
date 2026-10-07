// 3D studio used by menus, the builder and the VC Store (try-ons + animation previews).
import { Scene, Material, Mesh } from '../gfx/renderer.js';
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { Player } from '../sim/player.js';
import { Game } from '../sim/game.js';
import { GRAVITY, BALL_R } from '../sim/constants.js';
import { PlayerVisual } from './session.js';
import { cachedTexture } from '../world/court.js';

const holdPoint = Game.prototype.holdPoint;

export class Showroom {
  constructor(app) {
    this.app = app;
    const r = this.r = app.renderer;
    const ctx = r.ctx;
    const s = this.scene = new Scene();
    s.sky = { top: [0.012, 0.014, 0.02], horizon: [0.03, 0.035, 0.05], ground: [0.01, 0.01, 0.012], stars: 0 };
    s.sun = { dir: M.v3norm([0, 0, 0], [-0.45, 0.85, 0.75]), color: [1, 0.96, 0.9], intensity: 3.2 };
    s.ambient = { sky: [0.22, 0.24, 0.3], ground: [0.08, 0.07, 0.07] };
    s.fog = { color: [0.02, 0.025, 0.035], density: 0.035 };
    s.exposure = 1.15;
    s.bloom = { strength: 0.12, threshold: 1.0, radius: 1.1 };
    s.grade = { saturation: 1.06, contrast: 1.06, vignette: 0.85 };
    s.env = cachedTexture(ctx, 'env-studio', () => T.envMap({ top: '#1a1d24', horizon: '#6b7280', ground: '#202020', bands: [{ v: 0.2, h: 0.06, color: '#ffffff' }, { v: 0.35, h: 0.02, color: '#9fb6ff' }] }), {});
    s.envIntensity = 1.0;
    s.reflectionPlane = true;
    // floor
    const floor = new Mesh(ctx.geometry(G.plane(40, 40)), new Material({ color: [0.025, 0.027, 0.032], roughness: 0.25, reflective: true, reflectStrength: 0.35, floor: null }), { castShadow: false, reflect: false });
    floor.material.floor = null;
    s.add(floor);
    // podium
    this.accent = [1, 0.78, 0.25];
    const pod = new Mesh(ctx.geometry(G.cylinder(1.25, 1.32, 0.12, 64, { y0: true })), new Material({ color: [0.06, 0.065, 0.075], roughness: 0.35, metalness: 0.2 }));
    s.add(pod);
    this.ringMat = new Material({ color: this.accent, shading: 'unlit', emissive: [2.2, 1.6, 0.5], fog: false });
    const ring = new Mesh(ctx.geometry(G.torus(1.3, 0.012, 96, 6)), this.ringMat, { castShadow: false });
    M.m4translation(ring.matrix, 0, 0.12, 0);
    s.add(ring);
    // curved backdrop with a soft accent glow behind the player
    const back = G.cylinder(9, 9, 10, 64, { open: true, y0: true });
    G.flip(back);
    const glow = T.canvas(512, 256), g2 = glow.getContext('2d');
    const gr = g2.createRadialGradient(256, 150, 10, 256, 150, 260);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#7d7d7d'); gr.addColorStop(1, '#000000');
    g2.fillStyle = gr; g2.fillRect(0, 0, 512, 256);
    for (let y = 0; y < 256; y += 4) { g2.fillStyle = 'rgba(0,0,0,0.12)'; g2.fillRect(0, y, 512, 1); }
    this.backMat = new Material({ color: [0.3, 0.24, 0.08], shading: 'unlit', map: ctx.texture(glow, { wrap: 'clamp' }), fog: false });
    const backMesh = new Mesh(ctx.geometry(back), this.backMat, { castShadow: false, reflect: false });
    // only the far half of the cylinder carries the glow: rotate so u=0.5 (glow center) faces the camera side behind the player
    M.m4fromYaw(backMesh.matrix, 0, 0, 0, Math.PI / 2);
    s.add(backMesh);
    s.lights.push({ pos: [-3, 3.2, -2.5], range: 12, color: [0.55, 0.65, 1.0], intensity: 8, dir: null });
    s.lights.push({ pos: [3, 2.6, -2.2], range: 12, color: [1.0, 0.6, 0.35], intensity: 6, dir: null });
    s.lights.push({ pos: [0, 4.5, 3.5], range: 12, color: [1, 0.97, 0.92], intensity: 6, dir: [0, -0.6, -1], cos: 0.6 });
    s.shadowFocus = { center: [0, 1, 0], radius: 3 };
    // ball
    const bt = cachedTexture(ctx, 'ballC', () => T.ballTexture().color, {});
    const bn = cachedTexture(ctx, 'ballN', () => T.ballTexture().normal, { srgb: false });
    this.ball = new Mesh(ctx.geometry(G.sphere(BALL_R, 28, 18)), new Material({ map: bt, normalMap: bn, normalScale: 0.8, roughness: 0.6, color: [1, 1, 1] }));
    s.add(this.ball);
    this.ballQ = M.q4();
    this.visual = null;
    this.yaw = 0.35; this.yawVel = 0;
    this.focus = 'full';
    this.camPos = [0, 1.4, 5]; this.camTgt = [0, 1, 0];
    this.preview = 'idle'; this.pt = 0;
    this.ballFree = null;
    this.dragging = false;
    this.spin = d => { this.yaw += d; this.yawVel = d * 0.3; };
    this.zoom = 0;
    this.bindDrag();
  }

  bindDrag() {
    const cv = this.app.renderer.canvas;
    let lx = 0;
    cv.addEventListener('pointerdown', e => { if (!this.active) return; this.dragging = true; lx = e.clientX; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!this.active || !this.dragging) return; this.yawVel = (e.clientX - lx) * 0.01; this.yaw += this.yawVel; lx = e.clientX; });
    cv.addEventListener('pointerup', () => { this.dragging = false; });
    cv.addEventListener('wheel', e => { if (!this.active) return; this.zoom = M.clamp(this.zoom + Math.sign(e.deltaY) * -0.4, -1, 2.5); }, { passive: true });
  }

  setAccent(hex) {
    const c = M.hexLinear(hex);
    this.ringMat.color = c; this.ringMat.emissive = c.map(v => v * 2.4);
    this.backMat.color = c.map(v => v * 0.3 + 0.025);
    this.scene.lights[1].color = c.map(v => Math.min(1, v * 1.2 + 0.1));
  }

  // build: character build (with equipment), look: resolved look
  setCharacter(build, look) {
    // the animation packages count too (store previews swap only the jumpshot / release / dunk / size-up)
    const key = JSON.stringify([build.height, build.weight, build.wingspan, build.hand, look, build.equipment || null]);
    if (key === this.key) return;
    this.key = key;
    if (this.visual) this.visual.dispose();
    this.visual = new PlayerVisual(this.r, this.scene, build, look, { detail: 1 });
    this.scene.remove(this.visual.blob);
    this.player = new Player(0, 0, { build: { ...build, attributes: build.attributes || {} }, name: build.name || 'Player' }, this.app.catalog);
    this.fake = { ball: { mode: 'dribble', holder: 0 }, phase: 'live', players: [this.player] };
    this.H = this.player.phys.H;
    this.pt = 0;
  }

  setFocus(f) { this.focus = f; }
  setPreview(kind, opts = {}) { this.preview = kind; this.previewOpts = opts; this.pt = 0; this.ballFree = null; if (this.player) { this.player.action = null; this.player.y = 0; this.player.airborne = false; } }

  frame(dt) {
    this.active = true;
    if (!this.visual) return;
    const p = this.player;
    this.pt += dt;
    if (!this.dragging) { this.yawVel *= Math.exp(-dt * 4); this.yaw += this.yawVel; }
    p.facing = this.yaw;
    p.vx = 0; p.vz = 0;
    this.runPreview(dt);
    // vertical motion
    if (p.airborne) { p.vy -= GRAVITY * dt; p.y += p.vy * dt; if (p.y <= 0) { p.y = 0; p.vy = 0; p.airborne = false; } }
    if (p.action) { p.action.t += dt; }
    // ball
    let bp;
    if (this.ballFree) {
      const b = this.ballFree;
      b.vy -= GRAVITY * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < BALL_R + 0.12 && Math.hypot(b.x, b.z) < 1.3) { b.y = BALL_R + 0.12; b.vy = -b.vy * 0.7; b.vx *= 0.8; b.vz *= 0.8; }
      else if (b.y < BALL_R) { b.y = BALL_R; b.vy = -b.vy * 0.7; b.vx *= 0.8; b.vz *= 0.8; }
      bp = b;
    } else if (this.fake.ball.holder === 0) {
      bp = holdPoint.call(this.fake, p, {});
    }
    if (bp) {
      M.m4compose(this.ball.matrix, [bp.x, bp.y + (this.ballFree ? 0 : 0.12), bp.z], this.ballQ);
      this.ball.visible = true;
    } else this.ball.visible = false;
    const hasBall = this.fake.ball.holder === 0 && !this.ballFree;
    const ballR = bp ? { x: bp.x, y: bp.y + (this.ballFree ? 0 : 0.12), z: bp.z } : null;
    this.visual.anim.update(dt, { x: 0, y: p.y + 0.12, z: 0, facing: p.facing }, p, null, ballR, { hasBall, ballMode: this.fake.ball.mode, look: this.lookAt(), floorY: 0.12 });
    this.updateCamera(dt);
  }

  lookAt() {
    if (this.preview === 'jumpshot' || this.preview === 'dunk') return null;
    if (this.preview === 'walk' || this.preview === 'jog' || this.preview === 'sprint') { const f = this.player.facing; return [Math.sin(f) * 12, 0.12 + this.visual.view.H * 0.9, Math.cos(f) * 12]; }
    const cam = this.app.camera;
    return [cam.pos[0], cam.pos[1] - 0.1, cam.pos[2]];
  }

  runPreview(dt) {
    const p = this.player, fb = this.fake.ball;
    const kind = this.preview;
    if (kind === 'idle' || kind === 'dribble' || kind === 'moves') {
      fb.holder = 0; this.ballFree = null;
      const cycle = 7;
      const t = this.pt % cycle;
      const dribbling = kind !== 'idle' || t > 3.2;
      fb.mode = dribbling ? 'dribble' : 'held';
      if (dribbling) p.dribble.phase = (p.dribble.phase + (kind === 'moves' ? 2.4 : 1.6) * dt) % 1;
      if (kind === 'moves' && !p.action && this.pt > 0.6) {
        const mv = ['cross', 'btl', 'btb', 'hesi', 'cross', 'spin'][Math.floor(this.pt / 1.1) % 6];
        const durs = { cross: 0.4, btl: 0.44, btb: 0.44, spin: 0.56, hesi: 0.5 };
        p.startAction('move', durs[mv], { move: mv, handFrom: p.dribble.hand, vx: 0, vz: 0, f0: p.facing, dir: 1 });
      }
      if (p.action && p.action.type === 'move' && p.action.t >= p.action.dur) {
        if (['cross', 'btl', 'btb'].includes(p.action.move)) p.dribble.hand = p.dribble.hand === 'R' ? 'L' : 'R';
        p.action = null;
      }
      p.stance = 'normal';
      return;
    }
    if (kind === 'walk' || kind === 'jog' || kind === 'sprint') {
      // treadmill locomotion preview (the gait is velocity-driven, so the athlete runs in place)
      const v = { walk: 1.4, jog: 3.8, sprint: 6.8 }[kind];
      p.vx = Math.sin(p.facing) * v; p.vz = Math.cos(p.facing) * v;
      fb.holder = -1; fb.mode = 'dead'; this.ballFree = null; p.action = null;
      return;
    }
    if (kind === 'jumpshot') {
      const pkg = p.shotPkg;
      const tRel = pkg.tRel, jumpH = p.phys.vertical * pkg.jumpK * 0.52, tk = Math.max(0.2, tRel - Math.sqrt(2 * jumpH / 9.81) * 0.9), total = tRel + 1.9;
      const t = this.pt % total;
      if (t < 0.02 || !p.action || p.action.type !== 'shoot') {
        if (t < 0.05) { fb.holder = 0; fb.mode = 'held'; this.ballFree = null; p.action = null; p.startAction('shoot', tRel + 0.6, { tRel, takeoff: tk, releaseAt: tRel, jumpH, dRim: 5, kind: 'jumper' }); p.action.t = t; }
      }
      const a = p.action;
      if (a && !a.jumped && a.t >= tk) { a.jumped = true; p.jump(a.jumpH); }
      if (a && !a.released && a.t >= tRel) {
        a.released = true;
        const bp = holdPoint.call(this.fake, p, {});
        const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
        this.ballFree = { x: bp.x, y: bp.y, z: bp.z, vx: fx * 2.6, vy: 6.2, vz: fz * 2.6 };
        fb.holder = -1;
      }
      if (a && a.t > a.dur + 0.8) { p.action = null; }
      return;
    }
    if (kind === 'dunk') {
      const total = 2.6, t = this.pt % total;
      const style = this.previewOpts?.style || 'power';
      if (t < 0.05 && (!p.action || p.action.type !== 'dunk')) { fb.holder = 0; fb.mode = 'held'; this.ballFree = null; p.action = null; p.startAction('dunk', 1.6, { takeoff: 0.35, slam: 0.85, style, tUp: 0.5, jumpH: p.phys.vertical }); }
      const a = p.action;
      if (a && !a.jumped && a.t >= a.takeoff) { a.jumped = true; p.jump(a.jumpH); }
      if (a && !a.slammed && a.t >= a.slam) { a.slammed = true; const bp = holdPoint.call(this.fake, p, {}); this.ballFree = { x: bp.x, y: bp.y, z: bp.z, vx: 0, vy: -5, vz: 0 }; fb.holder = -1; }
      if (a && a.t > a.dur) p.action = null;
      return;
    }
    if (kind === 'celebrate') {
      fb.holder = -1; this.ballFree = null;
      if (!p.action) p.startAction('celebrate', 2.4, { kind: this.previewOpts?.kind || 'flex' });
      if (p.action && p.action.t > p.action.dur) p.action = null;
    }
  }

  updateCamera(dt) {
    const H = this.H || 2;
    // the menu panel sits on the left, so frame the player right of center
    const ox = this.frameX ?? -1.35;
    const presets = {
      full: [[ox, H * 0.56, 4.9 + H * 0.6], [ox, H * 0.5, 0]],
      upper: [[ox * 0.55, H * 0.82, 2.6], [ox * 0.55, H * 0.74, 0]],
      face: [[ox * 0.28, H * 0.93, 1.15], [ox * 0.28, H * 0.92, 0]],
      head: [[ox * 0.12, H * 0.935, 0.62], [ox * 0.12, H * 0.928, 0]],
      closeup: [[0, H * 0.94, 0.42], [0, H * 0.935, 0]],
      eye: [[0.03, H * 0.945, 0.24], [0.03, H * 0.945, 0]],
      shoes: [[ox * 0.3 + 0.25, 0.55, 1.65], [ox * 0.3, 0.12, 0]],
      wide: [[ox * 1.2, H * 0.66, 7.2], [ox * 1.2, H * 0.55, 0]],
      left: [[ox, H * 0.56, 4.9 + H * 0.6], [ox, H * 0.5, 0]],
    };
    const [pos, tgt] = presets[this.focus] || presets.full;
    const z = this.zoom;
    const P = [pos[0], pos[1], pos[2] - z * 0.9], Tt = tgt;
    for (let i = 0; i < 3; i++) { this.camPos[i] = M.damp(this.camPos[i], P[i], 5, dt); this.camTgt[i] = M.damp(this.camTgt[i], Tt[i], 5, dt); }
    const cam = this.app.camera;
    cam.pos.set(this.camPos); cam.target.set(this.camTgt); cam.fov = 35 * M.DEG;
  }

  deactivate() { this.active = false; }
}
