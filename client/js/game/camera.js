// Basketball camera rigs: 2K-style elevated end view, broadcast sideline, behind-player, and roam.
import * as M from '../core/math.js';
import { COURT } from '../sim/constants.js';

export const CAM_MODES = ['2k', 'broadcast', 'player'];
export const CAM_LABEL = { '2k': '2K Cam', broadcast: 'Broadcast', player: 'Player Lock' };
// v0.4.7.5 quick patch (2K cam): how much of a sideways run the camera follows [position, aim] (was 0.32 / 0.55),
// and how much higher it sits (m)
export const FOLLOW_X = [0.58, 0.78];
export const CAM_H = 0.9;

export class CameraRig {
  constructor(cam) {
    this.cam = cam;
    this.mode = '2k';
    this.pos = [0, 8, -10]; this.tgt = [0, 1, 0];
    this.shakeT = 0; this.shakeA = 0;
    this.fov = 42;
    this.zoom = 0;
    this.cut = true;
    this.sideSmooth = 1;
    this.roamYaw = 0; this.roamPitch = 0.32; this.roamDist = 6.2;
  }
  cycle() { this.mode = CAM_MODES[(CAM_MODES.indexOf(this.mode) + 1) % CAM_MODES.length]; return this.mode; }
  shake(a = 0.12, t = 0.35) { this.shakeA = Math.max(this.shakeA, a); this.shakeT = Math.max(this.shakeT, t); }
  snap() { this.cut = true; }

  // ctx: {origin:[x,y,z], half, side (attack side +1/-1), focus:{x,z}, ball:{x,y,z}, me:{x,z,facing}|null, highlight}
  updateGame(dt, ctx) {
    const [ox, , oz] = ctx.origin;
    const f = ctx.focus, b = ctx.ball;
    this.sideSmooth = M.damp(this.sideSmooth, ctx.side, 2.2, dt);
    const s = this.sideSmooth;
    // v0.4.3: in games the stick follows the camera as it is on screen right now (see liveBasis below), so
    // when the 2K cam swings round on a change of possession a held stick swings with it, like NBA 2K
    this.inGame = true;
    let pos, tgt, fov;
    if (this.mode === 'broadcast') {
      const z = ctx.half ? M.clamp(f.z * 0.6 + 4.5, 2, 10) : M.clamp(b.z * 0.85, -11, 11);
      pos = [ox - (ctx.half ? 16.5 : 19), ctx.half ? 7.2 : 8.2, oz + z];
      tgt = [ox + f.x * 0.25 + 1.5, 1.2, oz + z + (ctx.half ? 0.6 : 0)];
      fov = ctx.half ? 40 : 44;
    } else if (this.mode === 'player' && ctx.me) {
      const rimZ = oz + s * COURT.hoopZ;
      const dx = ox - ctx.me.x, dz = rimZ - ctx.me.z, dl = Math.hypot(dx, dz) || 1;
      const ux = dx / dl, uz = dz / dl;
      pos = [ctx.me.x - ux * 6.4, 3.5, ctx.me.z - uz * 6.4];
      tgt = [ctx.me.x + ux * 3.6, 1.3, ctx.me.z + uz * 3.6];
      fov = 50;
    } else {
      // 2K cam: elevated, behind the play facing the basket being attacked
      // v0.4.7.5 quick patch: running looked quicker sideways than up and down the floor (the speed is the same every
      // way: the sim is measured equal in every direction). Two things made it look that way: the camera follows the
      // play up and down the floor one for one but only a third of the way sideways, so a sideways run streaked
      // across the screen while a run up the floor stayed put; and from a low angle a run toward the basket is
      // foreshortened. The camera now follows sideways runs more closely (FOLLOW_X) and sits a little higher (CAM_H),
      // so a sprint reads at the same pace every way you run.
      const rimZ = s * COURT.hoopZ;
      const fz = ctx.half ? M.clamp(f.z, 1, 13) : M.clamp(f.z, -13, 13);
      const back = ctx.half ? 16.5 : 15.5;
      if (ctx.half) {
        pos = [ox + f.x * FOLLOW_X[0], 7.0 + CAM_H, oz + Math.min(fz, 9) - s * back];
        tgt = [ox + f.x * FOLLOW_X[1], 0.9, oz + fz + s * 2.2];
      } else {
        // on a change of possession swing around the sideline instead of passing overhead
        const th = Math.acos(M.clamp(s, -1, 1));
        const sx = -Math.sin(th), sz = -Math.cos(th);
        pos = [ox + f.x * FOLLOW_X[0] + sx * back * 0.85, 7.6 + CAM_H, oz + fz + sz * back];
        tgt = [ox + f.x * FOLLOW_X[1] - sx * 1.5, 0.9, oz + fz - sz * 2.2];
      }
      // keep the rim in frame on halfcourt
      if (ctx.half) tgt[2] = Math.min(tgt[2], oz + rimZ - 1.5);
      fov = 44;
    }
    // the stick follows the camera's framing of the play (before any highlight punch-in), damped exactly like
    // the camera so it matches what's on screen through a possession swing
    const cut = this.cut;
    this.updateLiveBasis(dt, pos, tgt, cut);
    if (ctx.highlight) {
      // punch in toward the action
      const hx = ctx.highlight.x, hy = ctx.highlight.y, hz = ctx.highlight.z;
      const k = ctx.highlight.k;
      pos = [M.lerp(pos[0], hx + (pos[0] - hx) * 0.45, k), M.lerp(pos[1], hy + 1.8, k * 0.6), M.lerp(pos[2], hz + (pos[2] - hz) * 0.45, k)];
      tgt = [M.lerp(tgt[0], hx, k), M.lerp(tgt[1], hy, k), M.lerp(tgt[2], hz, k)];
    }
    this.apply(dt, pos, tgt, fov, 5.5);
  }

  // Ground direction the camera is looking (no shake, no highlight punch-in), damped like the camera itself.
  // Stick input in games maps onto this, so "up" is always up the screen: through a camera swing a held stick
  // turns the player smoothly with the view instead of keeping a stale direction and running him off the floor.
  updateLiveBasis(dt, pos, tgt, cut) {
    const fx = tgt[0] - pos[0], fz = tgt[2] - pos[2];
    if (Math.hypot(fx, fz) < 0.5) return;
    const want = Math.atan2(fx, fz);
    if (cut || this.basisYaw == null) this.basisYaw = want;
    else { const d = Math.atan2(Math.sin(want - this.basisYaw), Math.cos(want - this.basisYaw)); this.basisYaw += d * (1 - Math.exp(-5.5 * dt)); }
    this.liveBasis = { fx: Math.sin(this.basisYaw), fz: Math.cos(this.basisYaw) };
  }

  // Free-roam third-person follow
  updateRoam(dt, me, input, bounds, solids) {
    if (input) {
      if (input.mouse.buttons & 2 || input.mouse.locked) { this.roamYaw -= input.mouse.dx * 0.005; this.roamPitch = M.clamp(this.roamPitch + input.mouse.dy * 0.003, 0.08, 0.95); }
      if (input.gp.connected) { const rs = input.stick(2, 3); this.roamYaw -= rs.x * dt * 2.6; this.roamPitch = M.clamp(this.roamPitch + rs.y * dt * 1.3 * (this.invertY ? -1 : 1), 0.08, 0.95); }
      if (input.mouse.wheel) this.roamDist = M.clamp(this.roamDist + input.mouse.wheel * 0.6, 3.2, 12);
    }
    let d = this.roamDist;
    const sx = Math.sin(this.roamYaw) * Math.cos(this.roamPitch), sz = Math.cos(this.roamYaw) * Math.cos(this.roamPitch), sy = Math.sin(this.roamPitch);
    // pull the boom in when a solid (store kiosk etc.) sits between camera and player
    if (solids) for (let t = 0.6; t <= d; t += 0.25) {
      const px = me.x - sx * t, pz = me.z - sz * t, py = 1.4 + sy * t;
      if (solids.some(b => px > b.x0 - 0.3 && px < b.x1 + 0.3 && pz > b.z0 - 0.3 && pz < b.z1 + 0.3 && py < b.h + 0.3)) { d = Math.max(1.6, t - 0.3); break; }
    }
    const cx = me.x - sx * d, cz = me.z - sz * d;
    const cy = 1.4 + sy * d;
    this.inGame = false;
    this.restBasis = { fx: Math.sin(this.roamYaw), fz: Math.cos(this.roamYaw) };
    this.apply(dt, [cx, cy, cz], [me.x, 1.45, me.z], 50, 8);
  }

  // ground basis for stick input: in games the live camera direction, in the park the roam camera's yaw
  inputBasis() {
    const b = this.inGame ? (this.liveBasis || this.restBasis) : this.restBasis;
    if (!b) return this.groundBasis();
    const l = Math.hypot(b.fx, b.fz) || 1, fx = b.fx / l, fz = b.fz / l;
    return { fx, fz, rx: -fz, rz: fx };
  }

  // forward direction on the ground for camera-relative movement
  groundBasis() {
    const fx = this.tgt[0] - this.pos[0], fz = this.tgt[2] - this.pos[2], l = Math.hypot(fx, fz) || 1;
    return { fx: fx / l, fz: fz / l, rx: -fz / l, rz: fx / l };
  }

  apply(dt, pos, tgt, fov, k) {
    if (this.cut) { this.pos = pos.slice(); this.tgt = tgt.slice(); this.fov = fov; this.cut = false; }
    else {
      for (let i = 0; i < 3; i++) { this.pos[i] = M.damp(this.pos[i], pos[i], k, dt); this.tgt[i] = M.damp(this.tgt[i], tgt[i], k * 1.3, dt); }
      this.fov = M.damp(this.fov, fov, 4, dt);
    }
    let sx = 0, sy = 0;
    if (this.shakeT > 0) { this.shakeT -= dt; const a = this.shakeA * Math.max(0, this.shakeT) * 3; sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a; if (this.shakeT <= 0) this.shakeA = 0; }
    this.cam.pos.set([this.pos[0] + sx, this.pos[1] + sy, this.pos[2]]);
    this.cam.target.set([this.tgt[0] + sx * 0.5, this.tgt[1] + sy * 0.5, this.tgt[2]]);
    this.cam.fov = this.fov * M.DEG;
  }
}
