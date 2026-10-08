// 3D studio used by menus, the builder and the VC Store (try-ons + animation previews).
import { Scene, Material, Mesh } from '../gfx/renderer.js';
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { BALL_R } from '../sim/constants.js';
import { PlayerVisual } from './session.js';
import { cachedTexture } from '../world/court.js';
import { PreviewSim } from './preview.js';

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
    // v0.4.5 stage 7: the preview itself (what the player and ball do) lives in preview.js, graphics-free
    this.sim = new PreviewSim();
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
    this.sim.setPlayer(build, this.app.catalog);
    this.H = this.player.phys.H;
  }

  setFocus(f) { this.focus = f; }
  setPreview(kind, opts = {}) { this.sim.setPreview(kind, opts); }
  get preview() { return this.sim.preview; }
  get player() { return this.sim.player; }

  frame(dt) {
    this.active = true;
    if (!this.visual) return;
    if (!this.dragging) { this.yawVel *= Math.exp(-dt * 4); this.yaw += this.yawVel; }
    const p = this.player, out = this.sim.step(dt, this.yaw);
    const bp = out.ball;
    if (bp) {
      M.m4compose(this.ball.matrix, [bp.x, bp.y, bp.z], this.ballQ);
      this.ball.visible = true;
    } else this.ball.visible = false;
    this.visual.anim.update(dt, { x: 0, y: p.y + 0.12, z: 0, facing: p.facing }, p, null, bp, { hasBall: out.hasBall, ballMode: out.ballMode, look: this.lookAt(), floorY: 0.12 });
    this.updateCamera(dt);
  }

  lookAt() {
    if (this.preview === 'jumpshot' || this.preview === 'dunk' || this.preview === 'layup') return null;
    if (this.preview === 'walk' || this.preview === 'jog' || this.preview === 'sprint') { const f = this.player.facing; return [Math.sin(f) * 12, 0.12 + this.visual.view.H * 0.9, Math.cos(f) * 12]; }
    const cam = this.app.camera;
    return [cam.pos[0], cam.pos[1] - 0.1, cam.pos[2]];
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
