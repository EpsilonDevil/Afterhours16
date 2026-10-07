// Procedural animation driven by the simulation: velocity-matched gait with planted feet,
// stance blending, ball-hand IK, and timed action bodies (jumpshots, layups, dunks, passes, defense).
import { P, GROUP_SIZE, neutral, newPose } from './pose.js';
import { COURT, BALL_R } from '../sim/constants.js';
import { dunkSpin } from '../sim/shots.js';

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const D = Math.PI / 180;
const TAU = Math.PI * 2;

function set3(p, g, x, y, z) { const o = P[g]; p[o] = x; p[o + 1] = y; p[o + 2] = z; }
function add3(p, g, x, y, z) { const o = P[g]; p[o] += x; p[o + 1] += y; p[o + 2] += z; }
function mix3(p, g, x, y, z, w) { const o = P[g]; p[o] += (x - p[o]) * w; p[o + 1] += (y - p[o + 1]) * w; p[o + 2] += (z - p[o + 2]) * w; }

export class Animator {
  constructor(view) {
    this.view = view;
    this.H = view.H;
    this.s = view.H / 2;
    this.pose = neutral();
    this.target = newPose();
    this.phase = 0;
    this.feet = [{ wx: null, wz: null, step: null }, { wx: null, wz: null, step: null }];
    this.lastFacing = 0;
    this.lean = { f: 0, s: 0 };
    this.prevV = { x: 0, z: 0 };
    this.time = 0;
    this.lastAction = null;
    this.follow = null;
    this.lookPt = [0, 1.7, 3];
    this.palm = { L: null, R: null };
    this.blink = 0;
    // landing absorption: a damped spring on hip height kicked by the touchdown speed
    this.land = { x: 0, v: 0 };
    this.prevY = 0; this.vyAir = 0; this.wasAir = false;
    this.outPose = newPose();
  }

  // local (character-space, meters) from world
  toLocal(x, y, z, out) {
    const c = Math.cos(this.f), s = Math.sin(this.f);
    const dx = x - this.x, dz = z - this.z;
    out[0] = c * dx - s * dz; out[1] = y - this.y; out[2] = s * dx + c * dz;
    return out;
  }

  // st: {x,y,z,facing} render-interpolated; p: sim player; g: game (or null); ball: render ball {x,y,z}
  update(dt, st, p, g, ball, extra = {}) {
    this.time += dt;
    this.x = st.x; this.y = st.y; this.z = st.z; this.f = st.facing + dunkSpin(p.action); // v0.4.3: 360 dunks spin the body
    const s = this.s, H = this.H;
    const T = this.target;
    neutral(T);
    const c = Math.cos(this.f), sn = Math.sin(this.f);
    const vx = p.vx, vz = p.vz;
    const lvx = c * vx - sn * vz, lvz = sn * vx + c * vz;
    const speed = Math.hypot(vx, vz);
    // acceleration for lean
    const ax = (vx - this.prevV.x) / Math.max(dt, 1e-3), az = (vz - this.prevV.z) / Math.max(dt, 1e-3);
    this.prevV.x = vx; this.prevV.z = vz;
    const lax = c * ax - sn * az, laz = sn * ax + c * az;
    this.lean.f = lerp(this.lean.f, Math.max(-6, Math.min(8, laz)), 1 - Math.exp(-dt * 6));
    this.lean.s = lerp(this.lean.s, Math.max(-8, Math.min(8, lax)), 1 - Math.exp(-dt * 6));
    const a = p.action;
    const has = g ? g.ball.holder === p.id : !!extra.hasBall;
    const bmode = g ? g.ball.mode : extra.ballMode;
    const defense = p.stance === 'defense';
    const airborne = p.airborne || st.y - (extra.floorY || 0) > 0.02;
    {
      const vy = (st.y - this.prevY) / Math.max(dt, 1e-3);
      this.prevY = st.y;
      if (airborne) this.vyAir = vy;
      else if (this.wasAir) { this.land.v -= Math.min(5.5, Math.max(0, -this.vyAir)) * 1.7; this.vyAir = 0; }
      this.wasAir = airborne;
      const L = this.land, w = 13, z = 0.72, n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
      for (let i = 0; i < n; i++) { L.v += (-w * w * L.x - 2 * z * w * L.v) * h; L.x += L.v * h; }
      if (L.x < -0.2) { L.x = -0.2; if (L.v < 0) L.v = 0; }
      if (airborne) { L.x *= 0.8; L.v = 0; }
    }
    // ---- locomotion & stance ----
    // Gait parameters follow measured human running/walking data (scaled by height): step length grows
    // with speed (walk ≈0.26+0.33v m, run ≈0.62+0.17v m for a 1.8 m adult), stance share (duty factor)
    // falls from ~62% walking to ~40% jogging and ~28% sprinting, and the swing foot rises much higher
    // when running (heel recovery toward the glutes) than when walking.
    const runK = sm(1.9, 3.1, speed), sprintK = sm(5.0, 7.0, speed);
    const shuffle = (defense || (has && bmode === 'dribble' && speed < 3.4 && Math.abs(lvx) > Math.abs(lvz) * 0.9)) && speed < 4.5;
    const hs = H / 1.8;
    const stepM = lerp(Math.min(0.9, 0.26 + 0.33 * speed), 0.62 + 0.17 * speed, runK) * hs;
    let stride = shuffle ? Math.min(0.72, 0.4 + speed * 0.12) : (2 * stepM) / s;
    const duty = shuffle ? 0.6 : lerp(lerp(0.62, 0.36, runK), 0.26, sprintK);
    const lift = shuffle ? 0.07 : lerp(0.11, 0.3, runK) + sprintK * 0.2;
    const strideM = stride * s;
    this.phase = (this.phase + speed * dt / Math.max(0.3, strideM)) % 1;
    const dirL = speed > 0.05 ? [lvx / speed, lvz / speed] : [0, 1];
    const wGait = sm(0.18, 0.85, speed) * (airborne ? 0 : 1);
    this.gaitInfo = { runK, sprintK, duty, wGait, shuffle };
    // stance widths (reference units)
    let crouch = 0, stanceW = 0.125, stagger = 0;
    if (defense) { crouch = -0.2; stanceW = 0.3; }
    else if (has && bmode === 'dribble') { crouch = -0.08 - (speed < 1 ? 0.04 : 0); stanceW = 0.19; stagger = 0.05; }
    else if (has) { crouch = -0.07; stanceW = 0.2; stagger = 0.08; }
    if (p.stamina < 0.18 && !has && speed < 0.3 && !defense && !a) crouch -= 0.05;
    const restL = [stanceW, 0.08, stagger], restR = [-stanceW, 0.08, -stagger];
    // gait feet: [x, y, z, pitch, toeBend]
    const hp = lerp(0.85, 0.6, runK); // swing height peaks earlier when running (heel recovery)
    // runners touch down only a little ahead of the hips and push off well behind them
    const shift = shuffle ? 0 : 0.1 * runK * duty * stride;
    const gaitFoot = (side, off) => {
      const ph = (this.phase + off) % 1;
      let along, h = 0, pitch = 0, toe = 0;
      if (ph < duty) {
        // stance: heel strike (walk) or flat midfoot contact (run), heel-off, then toe-off on the ball of the foot
        const q = ph / duty;
        along = (0.5 - q) * duty * stride - shift;
        if (q < 0.15) pitch = -0.22 * (1 - runK) * (1 - q / 0.15);
        else if (q > 0.55) pitch = sm(0.55, 1, q) * (0.35 + 0.3 * runK);
        toe = -Math.max(0, pitch) * 0.95;
      } else {
        const q = (ph - duty) / (1 - duty), e = q * q * (3 - 2 * q);
        along = (-0.5 + e) * duty * stride - shift;
        h = Math.sin(Math.PI * Math.pow(q, hp)) * lift;
        // toes stay pointed after push-off, then the ankle dorsiflexes ready for contact
        pitch = lerp(0.62, -0.15 * (1 - runK), sm(0, 0.8, q)) * (0.4 + 0.6 * Math.max(runK, 0.35));
      }
      const base = shuffle ? (side > 0 ? 0.26 : -0.26) : side * (0.11 - runK * 0.035);
      let fx = base + dirL[0] * along, fz = dirL[1] * along;
      // crossover steps pass in front
      if (!shuffle && Math.abs(dirL[0]) > 0.5 && ph >= duty) fz += Math.sin((ph - duty) / (1 - duty) * Math.PI) * 0.12 * Math.abs(dirL[0]);
      return [fx, 0.08 + h, fz, pitch, toe];
    };
    const gL = gaitFoot(1, 0), gR = gaitFoot(-1, 0.5);
    // idle feet: world-locked plants that step when displaced
    const idle = [restL, restR];
    const gaits = [gL, gR];
    const tmp = [0, 0, 0];
    for (let k = 0; k < 2; k++) {
      const F = this.feet[k];
      const side = k === 0 ? 1 : -1;
      let local;
      if (wGait > 0.5 || F.wx == null || airborne) {
        // keep plant synced to where the foot is now
        const gl = wGait > 0.5 ? gaits[k] : idle[k];
        F.wx = this.x + (c * gl[0] * s + sn * gl[2] * s); F.wz = this.z + (-sn * gl[0] * s + c * gl[2] * s);
        F.step = null;
        local = idle[k].slice();
      } else {
        this.toLocal(F.wx, 0, F.wz, tmp);
        local = [tmp[0] / s, 0.08, tmp[2] / s];
        const dx = local[0] - idle[k][0], dz = local[2] - idle[k][2];
        const off = Math.hypot(dx, dz);
        if (!F.step && off > (defense ? 0.16 : 0.2) && !(this.feet[1 - k].step)) F.step = { t: 0, from: local.slice(), dur: 0.2 };
        if (F.step) {
          F.step.t += dt;
          const q = Math.min(1, F.step.t / F.step.dur), e = q * q * (3 - 2 * q);
          local = [lerp(F.step.from[0], idle[k][0], e), 0.08 + Math.sin(q * Math.PI) * 0.07, lerp(F.step.from[2], idle[k][2], e)];
          if (q >= 1) { F.step = null; F.wx = this.x + (c * idle[k][0] * s + sn * idle[k][2] * s); F.wz = this.z + (-sn * idle[k][0] * s + c * idle[k][2] * s); }
        }
      }
      const g2 = gaits[k];
      const fx = lerp(local[0], g2[0], wGait), fy = lerp(local[1], g2[1], wGait), fz = lerp(local[2], g2[2], wGait);
      set3(T, k === 0 ? 'footL' : 'footR', fx, fy, fz);
      T[k === 0 ? P.pitchL : P.pitchR] = g2[3] * wGait;
      T[k === 0 ? P.toeL : P.toeR] = g2[4] * wGait;
      T[k === 0 ? P.yawL : P.yawR] = side * (defense ? 18 : 8) * D + (shuffle ? 0 : Math.atan2(dirL[0], Math.max(0.3, Math.abs(dirL[1]))) * 0.3 * wGait);
      if (defense) set3(T, k === 0 ? 'kneeL' : 'kneeR', side * 0.45, 0, 1);
    }
    // hips & spine. Centre of mass: walking vaults over a stiff stance leg (highest at mid-stance, lowest in
    // double support, ~3-4 cm); running is spring-mass (lowest at mid-stance, highest in flight, ~5-8 cm).
    const ms = duty / 2; // phase of left mid-stance (right is +0.5)
    const c2 = Math.cos(4 * Math.PI * (this.phase - ms));
    const bobWalk = 0.035 * (c2 - 1) * 0.5, bobRun = -(0.075 - 0.025 * sprintK) * (0.5 + 0.5 * c2);
    const bob = wGait * (shuffle ? -0.012 * (0.5 + 0.5 * c2) : lerp(bobWalk, bobRun, runK) - 0.02 * runK);
    T[P.root + 1] = crouch + bob - (shuffle ? 0.03 : 0);
    // lateral sway over the stance foot (walking), pelvis rotation with the swing leg, hip drop on the swing side
    const cs = Math.cos(TAU * (this.phase - ms));
    T[P.root] = wGait * (1 - runK) * cs * 0.025;
    T[P.pelvis + 1] = -wGait * Math.cos(this.phase * TAU) * (0.08 + 0.06 * runK);
    T[P.chest + 1] = -T[P.pelvis + 1] * 1.6;
    const roll = shuffle ? 0 : wGait * cs * (0.06 + 0.02 * runK);
    T[P.pelvis + 2] = roll;
    // trunk: ~3° walking, ~6° jogging, ~11° sprinting, plus up to ~16° more while accelerating hard
    const leanF = (defense ? 0.32 : has ? 0.16 : 0.04) + runK * 0.06 + sprintK * 0.09 + Math.max(-0.12, Math.min(0.28, this.lean.f * 0.035));
    T[P.spine] = leanF * 0.6; T[P.chest] = leanF * 0.4;
    T[P.spine + 2] = -this.lean.s * 0.02 - roll * 0.9;
    T[P.chest + 2] = -this.lean.s * 0.012;
    T[P.head] = -leanF * 0.5;
    // arms (free): counter-swing; running arms bend ~90° and the forward hand rises toward the chest/chin
    const armAmp = wGait * (0.1 + 0.2 * runK + sprintK * 0.1);
    const swL = -Math.cos((this.phase) * TAU) * armAmp, swR = -Math.cos((this.phase + 0.5) * TAU) * armAmp;
    const armY = 1.0 + 0.06 * runK + 0.04 * sprintK + crouch * 0.85;
    const up = 0.4 + 0.5 * runK, back = 0.25 * runK;
    const armX = 0.26 + 0.02 * runK - crouch * 0.25; // crouching: hands hang outside the knees, not in the shorts
    set3(T, 'handL', armX - Math.max(0, swL) * 0.15 * runK, armY + Math.max(0, swL) * up + Math.max(0, -swL) * back, 0.08 + swL - crouch * 0.4);
    set3(T, 'handR', -armX + Math.max(0, swR) * 0.15 * runK, armY + Math.max(0, swR) * up + Math.max(0, -swR) * back, 0.08 + swR - crouch * 0.4);
    if (crouch < -0.04) { set3(T, 'elbowL', 0.5, -0.4, -0.8); set3(T, 'elbowR', -0.5, -0.4, -0.8); }
    if (runK > 0.3) { set3(T, 'elbowL', 0.2, -0.3, -1); set3(T, 'elbowR', -0.2, -0.3, -1); }
    if (defense) {
      const w = Math.sin(this.time * 7 + p.id) * 0.03;
      set3(T, 'handL', 0.5, 1.22 + w, 0.28); set3(T, 'handR', -0.5, 1.22 - w, 0.28);
      set3(T, 'elbowL', 0.8, -0.6, -0.4); set3(T, 'elbowR', -0.8, -0.6, -0.4);
    }
    if (p.handsUp && !a) { set3(T, 'handL', 0.2, 2.25, 0.2); set3(T, 'handR', -0.2, 2.28, 0.2); set3(T, 'elbowL', 0.6, 0, -0.5); set3(T, 'elbowR', -0.6, 0, -0.5); }
    else if (p.handsSide && !a) {
      // v0.4.4: a hand out on one side (right stick held left/right on defense)
      const c0 = Math.cos(this.f), s0 = Math.sin(this.f), lxs = p.handsSide.x * c0 - p.handsSide.z * s0;
      const hd = lxs >= 0 ? 'L' : 'R', sg = hd === 'L' ? 1 : -1;
      set3(T, 'hand' + hd, sg * 0.72, 1.3, 0.3); set3(T, 'elbow' + hd, sg * 1, -0.2, -0.3);
    }
    // exhausted: hands on knees
    if (p.stamina < 0.12 && !has && speed < 0.25 && !defense && !a) {
      T[P.spine] = 0.55; T[P.chest] = 0.25; T[P.root + 1] = -0.1;
      set3(T, 'handL', 0.15, 0.62, 0.28); set3(T, 'handR', -0.15, 0.62, 0.28);
    }
    // v0.4.3 size-up packages: holding the dribble in front of a defender, better packages sit lower and work
    // him with shoulder and head jabs
    if (has && bmode === 'dribble' && speed < 1.2 && !a && (p.sizeupLvl || 0) > 0) {
      const lvl = p.sizeupLvl, w = this.time * (5 + lvl * 1.8) + p.id;
      T[P.root + 1] -= 0.035 * lvl;
      T[P.chest + 1] += Math.sin(w) * 0.08 * lvl;
      T[P.spine + 2] += Math.sin(w * 0.5) * 0.05 * lvl;
      T[P.head] += Math.sin(w + 1.3) * 0.035 * lvl;
    }
    // ---- actions ----
    const palm = this.palm; palm.L = null; palm.R = null;
    const lb = [0, 0, 0];
    if (ball) this.toLocal(ball.x, ball.y, ball.z, lb);
    const lbs = [lb[0] / s, lb[1] / s, lb[2] / s];
    let look = null, lookW = 0.6;
    if (ball) look = [lb[0], lb[1], lb[2]];
    const rim = g ? g.rimFor(p.team) : null;
    if (a) this.actionPose(T, a, p, g, lbs, lb, rim);
    // ---- ball hands ----
    if (has && ball && !(a && (a.type === 'hang'))) this.ballHands(T, p, g, a, lbs, bmode);
    else if (ball && !has && g && g.ball.mode === 'flight') {
      // reach for an incoming pass / loose ball near the hands
      const dist = Math.hypot(lb[0], lb[1] - 1.3 * s, lb[2]);
      const coming = g.ball.kind === 'pass' && g.ball.info?.to === p.id;
      if ((coming && dist < 2.4) || (dist < 0.9 && (a?.type === 'rebound' || a?.type === 'block' || a?.type === 'catch'))) {
        const w = coming ? sm(2.4, 0.8, dist) : 1;
        mix3(T, 'handL', lbs[0] + 0.14, lbs[1] - 0.02, lbs[2] - 0.05, w);
        mix3(T, 'handR', lbs[0] - 0.14, lbs[1] - 0.02, lbs[2] - 0.05, w);
        palm.L = { normal: [-1, 0, 0.2], fingers: [0, 0.8, 0.6], w: w * 0.8 };
        palm.R = { normal: [1, 0, 0.2], fingers: [0, 0.8, 0.6], w: w * 0.8 };
      }
    }
    // look target
    if (rim && a && (a.type === 'shoot' || a.type === 'layup' || a.type === 'dunk' || a.type === 'ftshot')) { this.toLocal(rim.x, rim.y, rim.z, tmp); look = tmp.slice(); lookW = 0.9; }
    else if (defense && g) { const h = g.holder(); if (h) { this.toLocal(h.x, 1.4, h.z, tmp); look = tmp.slice(); lookW = 0.8; } }
    else if (has && g && rim && bmode === 'dribble') { this.toLocal(rim.x, 1.8, rim.z, tmp); look = tmp.slice(); lookW = 0.5; }
    if (extra.look) { this.toLocal(extra.look[0], extra.look[1], extra.look[2], tmp); look = tmp.slice(); lookW = 0.8; }
    // ---- smoothing ----
    const out = this.pose;
    const kFast = 1 - Math.exp(-dt * 26), kSlow = 1 - Math.exp(-dt * 12);
    const rawGroups = this.rawGroups(has, a, airborne);
    // explosive actions track their key poses tightly (a lagging hip makes takeoffs look floaty)
    const athletic = a && (a.type === 'shoot' || a.type === 'ftshot' || a.type === 'layup' || a.type === 'dunk' || a.type === 'block' || a.type === 'rebound' || a.type === 'tipjump');
    for (const [g2, o] of Object.entries(P)) {
      if (g2 === 'N') continue;
      const n = GROUP_SIZE[g2];
      const k = rawGroups.has(g2) ? 1 : (g2.startsWith('foot') || g2.startsWith('pitch') || g2.startsWith('toe') || g2.startsWith('yaw')) ? (wGait > 0.5 ? 1 : kFast) : (athletic && (g2 === 'root' || g2 === 'spine' || g2 === 'chest' || g2.startsWith('knee'))) ? kFast : kSlow;
      for (let i = 0; i < n; i++) out[o + i] += (T[o + i] - out[o + i]) * k;
    }
    this.look = look; this.lookW = lookW;
    const fin = this.outPose;
    fin.set(out);
    const lx = this.land.x;
    if (lx < -1e-4) { fin[P.root + 1] += lx; fin[P.spine] -= lx * 0.9; fin[P.chest] -= lx * 0.3; fin[P.head] += lx * 0.5; }
    this.clearBody(fin);
    this.view.update(fin, st.x, st.y, st.z, st.facing, { look, lookW, palmL: palm.L, palmR: palm.R });
  }

  // v0.4.2 anti-clipping: keep hand targets outside an elliptic torso/hip column (sized by girth and moved
  // with the crouch and forward lean), so idles, size-ups and dribble moves don't bury hands in the body.
  clearBody(f) {
    const g = this.view.model?.d?.girth || 1;
    const root = f[P.root + 1], lean = f[P.spine] + f[P.chest] * 0.6;
    for (const h of ['handL', 'handR']) {
      const o = P[h], side = h === 'handL' ? 1 : -1;
      const by = f[o + 1] - root; // height on the body (reference units)
      if (by < 0.62 || by > 1.5) continue;
      const hips = by < 1.05;
      const rx = (hips ? 0.235 : 0.215) * g, rz = (hips ? 0.15 : 0.145) * g;
      const zc = Math.max(0, by - 0.9) * Math.sin(lean) * 0.9 + (hips ? -0.01 : 0.01);
      const ex = f[o] / rx, ez = (f[o + 2] - zc) / rz, e = Math.hypot(ex, ez);
      if (e >= 1) continue;
      if (e < 0.15) { f[o] = side * rx; continue; } // dead center: push to the hand's own side
      f[o] *= 1 / e; f[o + 2] = zc + (f[o + 2] - zc) / e;
    }
  }

  rawGroups(has, a, airborne) {
    const set = new Set();
    if (has) { set.add('handL'); set.add('handR'); }
    if (a && (a.type === 'hang')) { set.add('handL'); set.add('handR'); }
    return set;
  }

  // Hand targets for whoever is holding/dribbling the ball (positions in reference units)
  ballHands(T, p, g, a, b, mode) {
    const r = BALL_R / this.s;
    const palm = this.palm;
    const shootHand = (p.shotPkg?.hand || 'R') === 'L' ? 'L' : 'R';
    const sgn = side => side === 'L' ? 1 : -1;
    if (a && (a.type === 'shoot' || a.type === 'ftshot' || a.type === 'pumpfake')) {
      if (a.released) return;
      const sh = shootHand, gh = sh === 'L' ? 'R' : 'L';
      set3(T, 'hand' + sh, b[0] + sgn(sh) * 0.02, b[1] - r - 0.07, b[2] - 0.06);
      // shooting elbow: tucked for the high-set bases, flared on the push shot
      const est = a.type === 'shoot' && a.kind !== 'close' ? p.shotPkg?.style : 'standard';
      set3(T, 'elbow' + sh, sgn(sh) * (est === 'push' ? 0.6 : est === 'high' ? 0.04 : 0.15), -1, 0.5);
      palm[sh] = { normal: [0, 0.85, 0.5], fingers: [0, 0.75, -0.6], w: 0.9 };
      set3(T, 'hand' + gh, b[0] + sgn(gh) * (r + 0.075), b[1] - 0.04, b[2] - 0.06);
      set3(T, 'elbow' + gh, sgn(gh) * 1, -0.4, 0.1);
      palm[gh] = { normal: [-sgn(gh), 0.1, 0.1], fingers: [0, 0.9, 0.3], w: 0.85 };
      return;
    }
    if (a && (a.type === 'layup' || a.type === 'dunk')) {
      const one = a.type === 'layup' || a.style === 'onehand' || a.style === 'tomahawk' || a.style === 'windmill' || a.style === 'cradle' || a.style === 'reverse';
      const sh = 'R';
      set3(T, 'handR', b[0] - 0.02, b[1] - r - 0.06, b[2] - 0.05);
      palm.R = { normal: [0, 0.8, 0.55], fingers: [0, 0.8, -0.5], w: 0.85 };
      set3(T, 'elbowR', -0.4, -1, 0.3);
      if (!one || (a.type === 'dunk' && a.t < a.takeoff * 0.8) || (a.type === 'layup' && a.t < a.takeoff)) {
        set3(T, 'handL', b[0] + r + 0.075, b[1] - 0.03, b[2] - 0.05);
        palm.L = { normal: [-1, 0.1, 0.1], fingers: [0, 0.9, 0.3], w: 0.85 };
      }
      return;
    }
    if (a && a.type === 'pass' && !a.released) {
      set3(T, 'handL', b[0] + r + 0.07, b[1] - 0.03, b[2] - 0.08);
      set3(T, 'handR', b[0] - r - 0.07, b[1] - 0.03, b[2] - 0.08);
      palm.L = { normal: [-1, 0, 0.25], fingers: [0, 0.6, 0.8], w: 0.85 };
      palm.R = { normal: [1, 0, 0.25], fingers: [0, 0.6, 0.8], w: 0.85 };
      set3(T, 'elbowL', 0.8, -0.6, -0.5); set3(T, 'elbowR', -0.8, -0.6, -0.5);
      return;
    }
    if (mode === 'dribble') {
      const hand = p.dribble.hand;
      const other = hand === 'L' ? 'R' : 'L';
      const pocket = 0.92;
      const top = b[1] + r + 0.02;
      const hy = Math.max(top, pocket - 0.2);
      set3(T, 'hand' + hand, b[0] - sgn(hand) * 0.0, hy, b[2] - 0.06);
      set3(T, 'elbow' + hand, sgn(hand) * 0.6, -0.3, -0.8);
      palm[hand] = { normal: [0, -1, 0.15], fingers: [-sgn(hand) * 0.2, -0.25, 1], w: sm(pocket - 0.05, pocket - 0.25, hy) * 0.5 + 0.4 };
      // off arm: protective bar when a defender is close
      let near = false;
      if (g) for (const d of g.opponents(p)) if (d.dist(p) < 2.2) near = true;
      if (near) { set3(T, 'hand' + other, sgn(other) * 0.36, 1.18, 0.36); set3(T, 'elbow' + other, sgn(other) * 0.9, -0.5, -0.2); }
      else { set3(T, 'hand' + other, sgn(other) * 0.32, 0.98, 0.2); set3(T, 'elbow' + other, sgn(other) * 0.7, -0.5, -0.5); }
      // crossover-type moves: both hands participate around the ball
      if (p.action?.type === 'move') {
        const mv = p.action.move;
        if (mv === 'cross' || mv === 'btl' || mv === 'btb' || mv === 'inout') {
          const k = Math.sin(Math.min(1, p.action.t / p.action.dur) * Math.PI);
          mix3(T, 'hand' + other, b[0] + sgn(other) * 0.06, Math.max(top, 0.7), b[2] - 0.05, k * (b[0] * sgn(other) > -0.05 ? 1 : 0.5));
        }
      } else if (p.dribble.xover) {
        // size-up crossover: the dribble hand lets go, the other hand meets the ball on its side
        const ph = p.dribble.phase;
        mix3(T, 'hand' + hand, sgn(hand) * 0.3, 0.98, 0.2, sm(0.3, 0.55, ph));
        mix3(T, 'hand' + other, b[0], Math.max(top, 0.55), b[2] - 0.05, sm(0.5, 0.9, ph));
      }
      return;
    }
    // two-hand hold (triple threat / check / catch)
    set3(T, 'handL', b[0] + r + 0.075, b[1] - 0.03, b[2] - 0.07);
    set3(T, 'handR', b[0] - r - 0.075, b[1] - 0.03, b[2] - 0.07);
    set3(T, 'elbowL', 0.9, -0.7, -0.4); set3(T, 'elbowR', -0.9, -0.7, -0.4);
    palm.L = { normal: [-1, 0.05, 0.2], fingers: [0, 0.75, 0.65], w: 0.85 };
    palm.R = { normal: [1, 0.05, 0.2], fingers: [0, 0.75, 0.65], w: 0.85 };
  }

  actionPose(T, a, p, g, b, bm, rim) {
    const t = a.t;
    const s = this.s;
    const tmp = [0, 0, 0];
    switch (a.type) {
      case 'shoot': case 'ftshot': {
        // Jump-shot phases from shooting kinematics: countermovement (knees to ~110-120°, trunk inclines
        // ~10°), triple extension (hip/knee/ankle) with the heels lifting just before takeoff, a near-
        // straight-legged flight with pointed toes, release just before the apex, then a held follow-through
        // ("gooseneck" wrist) until the landing absorbs.
        const ft = a.type === 'ftshot';
        const tR = a.tRel || 0.6, tk = ft ? tR * 0.92 : (a.takeoff ?? tR * 0.36);
        const deep = Math.max(0, Math.min(1, ((a.dRim ?? 5) - 4) / 4));
        // v0.4.3: each jump-shot base has its own body language (dip, legs in the air, lean) and each release
        // its own follow-through
        const style = ft || a.kind === 'close' ? 'standard' : (p.shotPkg?.style || 'standard'), relS = p.shotPkg?.release || 'classic';
        const dip = ft ? 0.1 : a.kind === 'close' ? 0.11 : 0.15 + 0.04 * deep + (style === 'push' ? 0.035 : style === 'flick' ? -0.025 : style === 'high' ? 0.01 : style === 'wide' ? 0.045 : style === 'sniper' ? -0.02 : 0);
        const sh = (p.shotPkg?.hand || 'R') === 'L' ? 'L' : 'R', sg = sh === 'L' ? 1 : -1;
        if (t < 0) { T[P.root + 1] = -0.05; T[P.spine] = 0.14; } // free-throw routine dribbles
        else if (!p.airborne && !(a.released && t > tk + 0.1)) {
          const tDown = tk * 0.58;
          let y, heel = 0;
          if (t < tDown) { const q = t / Math.max(0.05, tDown); y = -dip * Math.sin(q * Math.PI / 2) ** 1.4; }
          else { const q = Math.min(1, (t - tDown) / Math.max(0.04, tk - tDown)); y = lerp(-dip, 0.025, q * q); heel = sm(0.55, 1, q); }
          T[P.root + 1] = y - 0.03 * (1 - sm(0, 0.15, t));
          // shooting-side foot slightly ahead, toes turned a touch toward the off side
          set3(T, 'foot' + sh, sg * 0.13, 0.08, 0.06); set3(T, 'foot' + (sh === 'L' ? 'R' : 'L'), -sg * 0.13, 0.08, -0.03);
          T[P.pitchL] = heel * 0.42; T[P.pitchR] = heel * 0.42; T[P.toeL] = -heel * 0.38; T[P.toeR] = -heel * 0.38;
          set3(T, 'kneeL', 0.12, 0, 1); set3(T, 'kneeR', -0.12, 0, 1);
          // v0.4.4 bases: wide stance sets with the feet well outside the hips; sniper squares up, feet under him
          if (style === 'wide') { set3(T, 'footL', 0.22, 0.08, 0.02); set3(T, 'footR', -0.22, 0.08, 0.0); set3(T, 'kneeL', 0.3, 0, 1); set3(T, 'kneeR', -0.3, 0, 1); }
          else if (style === 'sniper') { set3(T, 'footL', 0.11, 0.08, 0.02); set3(T, 'footR', -0.11, 0.08, 0.02); }
          const inc = -y / dip; // trunk follows the dip
          T[P.spine] = 0.04 + inc * 0.12; T[P.chest] = 0.02 + inc * 0.05;
        } else if (p.airborne) {
          T[P.root + 1] = 0.0;
          // near-straight legs hang under the hips, toes pointed; a slight tuck at the top of the jump
          const tuck = a.released ? 0.006 : 0.016;
          set3(T, 'footL', 0.12, 0.085 + tuck, 0.03); set3(T, 'footR', -0.12, 0.085 + tuck * 1.3, -0.01);
          T[P.pitchL] = 0.62; T[P.pitchR] = 0.66; T[P.toeL] = 0; T[P.toeR] = 0;
          set3(T, 'kneeL', 0.1, 0, 1); set3(T, 'kneeR', -0.1, 0, 1);
          T[P.spine] = -0.02; T[P.chest] = -0.03;
          if (style === 'high') { set3(T, 'footL', 0.08, 0.08, 0.0); set3(T, 'footR', -0.08, 0.08, -0.01); T[P.pitchL] = 0.72; T[P.pitchR] = 0.72; T[P.spine] = -0.05; T[P.head] = -0.16; }
          else if (style === 'flick') { set3(T, 'footL', 0.13, 0.13, -0.09); set3(T, 'footR', -0.13, 0.14, -0.11); T[P.spine] = 0.04; }
          else if (style === 'push') { set3(T, 'foot' + sh, sg * 0.13, 0.1, 0.13); set3(T, 'foot' + (sh === 'L' ? 'R' : 'L'), -sg * 0.13, 0.12, -0.12); T[P.spine] = 0.03; }
          else if (style === 'lean') { set3(T, 'footL', 0.13, 0.12, 0.13); set3(T, 'footR', -0.13, 0.11, 0.11); T[P.spine] = -0.13; T[P.chest] = -0.07; }
          // v0.4.4: kick out = the off-side leg swings forward with a bent knee at the top of the jump
          else if (style === 'kick') { const off = sh === 'L' ? 'R' : 'L', k2 = sm(0, 0.18, t - tk); set3(T, 'foot' + off, -sg * 0.15, 0.1 + 0.2 * k2, 0.02 + 0.3 * k2); set3(T, 'knee' + off, -sg * 0.15, 0.3 * k2, 1); T[off === 'L' ? P.pitchL : P.pitchR] = 0.45; T[P.spine] = -0.04; }
          else if (style === 'wide') { set3(T, 'footL', 0.2, 0.09, 0.02); set3(T, 'footR', -0.2, 0.09, 0.0); T[P.spine] = 0.0; }
          else if (style === 'sniper') { set3(T, 'footL', 0.1, 0.08, 0.02); set3(T, 'footR', -0.1, 0.08, 0.02); T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; T[P.spine] = -0.02; T[P.head] = -0.1; }
          if (a.fade) { T[P.spine] = -0.16; T[P.chest] = -0.08; set3(T, 'footL', 0.12, 0.11, 0.12); set3(T, 'footR', -0.12, 0.12, 0.1); }
        } else { T[P.spine] = 0.08; T[P.chest] = 0.02; }
        T[P.head] = -0.12;
        if (a.released) {
          // follow-through: elbow locked above the eyes, wrist flexed, guide hand peels off and drops
          const gh = sh === 'L' ? 'R' : 'L';
          // release styles: Snap = fast hard wrist flick, Float/High = arm stays up long, Quick = compact and
          // gone early, Butter = smooth and slow; Classic in between
          // v0.4.4: Feather = soft wrist, guide hand stays up; Dart = flat and fast; Rainbow = tall, long hold;
          // Laser = the quickest snap with the hand finishing straight at the rim
          const RS = { snap: [0.06, 0.02, 0.44, -0.95, 0.35], quick: [0.08, -0.03, 0.45, -0.8, 0.3], high: [0.12, 0.1, 0.32, -0.7, 0.75], float: [0.16, 0.07, 0.48, -0.6, 0.85], butter: [0.18, 0.05, 0.42, -0.7, 0.7],
            feather: [0.17, 0.06, 0.44, -0.58, 0.8], dart: [0.06, -0.03, 0.52, -0.9, 0.3], rainbow: [0.15, 0.14, 0.28, -0.66, 0.95], laser: [0.05, 0.0, 0.48, -1.0, 0.3] }[relS] || [0.12, 0.04, 0.46, -0.8, 0.5];
          const k = Math.min(1, (t - (a.releaseAt ?? tR)) / RS[0]);
          const relY = (p.phys.reach * (p.shotPkg?.relK ?? 0.93)) / s;
          set3(T, 'hand' + sh, sg * 0.05, relY + RS[1] - (1 - k) * 0.03, 0.36 + k * (RS[2] - 0.36));
          set3(T, 'elbow' + sh, sg * (style === 'push' ? 0.45 : 0.1), -0.6, 0.6);
          this.palm[sh] = { normal: [0, -0.45, 0.9], fingers: [0, RS[3], 0.6], w: 0.9 };
          set3(T, 'hand' + gh, -sg * (relS === 'snap' || relS === 'laser' ? 0.34 : 0.26), relY - 0.14 - k * (relS === 'float' || relS === 'feather' ? 0.03 : 0.12), 0.28);
          set3(T, 'elbow' + gh, -sg * 0.6, -0.6, 0.45);
          const hold = (a.releaseAt ?? tR) + (p.airborne ? 9 : RS[4]);
          if (t > hold) {
            // arms come down by the sides; elbow poles point down/back the whole way so they can't flip out
            set3(T, 'hand' + sh, sg * 0.27, 1.02, 0.12); set3(T, 'hand' + gh, -sg * 0.27, 1.02, 0.12);
            set3(T, 'elbow' + sh, sg * 0.35, -1, -0.25); set3(T, 'elbow' + gh, -sg * 0.35, -1, -0.25);
            this.palm[sh] = null; this.palm[gh] = null;
          }
        }
        break;
      }
      case 'pumpfake': {
        const k = Math.sin(Math.min(1, t / a.dur) * Math.PI);
        T[P.root + 1] = -0.06 + k * 0.05; T[P.spine] = 0.05 - k * 0.1; T[P.head] = -0.15 * k;
        break;
      }
      case 'layup': {
        const tk = a.takeoff;
        if (!p.airborne && t < tk) {
          // gather steps: last step long, low
          const q = t / Math.max(0.05, tk);
          T[P.root + 1] = -0.06 - Math.sin(q * Math.PI) * 0.14;
          T[P.spine] = 0.25;
        } else if (p.airborne) {
          // one-foot takeoff: right knee drives up, left leg trails
          set3(T, 'footR', -0.1, 0.55, 0.32); set3(T, 'kneeR', -0.1, 0.3, 1); T[P.pitchR] = 0.5;
          set3(T, 'footL', 0.1, 0.18, -0.22); set3(T, 'kneeL', 0.1, 0, 1); T[P.pitchL] = 0.8;
          T[P.spine] = -0.05; T[P.chest] = -0.05; T[P.head] = -0.2;
          if (a.released) { set3(T, 'handR', -0.06, 2.45, 0.32); this.palm.R = { normal: [0, 0.3, 0.95], fingers: [0, 0.95, -0.2], w: 0.8 }; }
          set3(T, 'handL', 0.35, 1.7, 0.2); set3(T, 'elbowL', 1, -0.3, 0);
        } else { T[P.root + 1] = -0.12; T[P.spine] = 0.2; }
        break;
      }
      case 'dunk': case 'oop': {
        const tk = a.takeoff ?? 0;
        if (!p.airborne && t < tk) {
          const q = t / Math.max(0.05, tk);
          T[P.root + 1] = -0.08 - Math.sin(q * Math.PI) * 0.2;
          T[P.spine] = 0.3;
        } else if (p.airborne) {
          const st = a.style, two = st === 'power' || st === 'double' || st === '360';
          const up = a.slam ? Math.min(1, Math.max(0, (t - tk) / Math.max(0.1, a.slam - tk))) : 1;
          if (st === '360') {
            // tight tuck through the spin
            set3(T, 'footL', 0.12, 0.42, -0.02); set3(T, 'footR', -0.12, 0.4, -0.04); T[P.pitchL] = 0.75; T[P.pitchR] = 0.75; set3(T, 'kneeL', 0.25, 0, 1); set3(T, 'kneeR', -0.25, 0, 1);
          } else if (st === 'cradle') {
            // knees driven up together while the ball swings out wide
            set3(T, 'footL', 0.1, 0.5, 0.18); set3(T, 'footR', -0.1, 0.52, 0.2); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; set3(T, 'kneeL', 0.2, 0.4, 1); set3(T, 'kneeR', -0.2, 0.4, 1);
          } else if (st === 'windmill') {
            // split legs, lead knee high, trail leg kicked back
            set3(T, 'footR', -0.1, 0.62, 0.34); set3(T, 'kneeR', -0.1, 0.3, 1); set3(T, 'footL', 0.12, 0.34, -0.42); set3(T, 'kneeL', 0.1, -0.2, 1); T[P.pitchL] = 0.9; T[P.pitchR] = 0.5;
          } else if (st === 'double') {
            // legs kick back as the ball comes down, then snap forward for the slam
            const back = Math.sin(Math.min(1, up / 0.75) * Math.PI);
            set3(T, 'footL', 0.14, 0.3 + back * 0.15, 0.05 - back * 0.3); set3(T, 'footR', -0.14, 0.3 + back * 0.12, 0.05 - back * 0.28); T[P.pitchL] = 0.75; T[P.pitchR] = 0.75; set3(T, 'kneeL', 0.3, 0, 1); set3(T, 'kneeR', -0.3, 0, 1);
          } else if (two || a.type === 'oop') { set3(T, 'footL', 0.14, 0.32, 0.05); set3(T, 'footR', -0.14, 0.3, 0.05); T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; set3(T, 'kneeL', 0.3, 0, 1); set3(T, 'kneeR', -0.3, 0, 1); }
          else { set3(T, 'footR', -0.1, 0.6, 0.3); set3(T, 'kneeR', -0.1, 0.3, 1); set3(T, 'footL', 0.1, 0.2, -0.2); T[P.pitchL] = 0.8; T[P.pitchR] = 0.5; }
          T[P.spine] = st === 'tomahawk' ? -0.2 : st === 'windmill' || st === 'cradle' ? -0.12 * Math.sin(up * Math.PI) - 0.04 : st === '360' ? 0.08 : -0.05;
          T[P.chest] = st === 'tomahawk' ? -0.15 : st === 'windmill' ? -0.08 : 0; T[P.head] = -0.15;
          // the free arm balances flashy dunks out wide
          if (!a.slammed && (st === 'windmill' || st === 'cradle' || st === 'tomahawk')) { set3(T, 'handL', 0.55, 1.75, 0.05); set3(T, 'elbowL', 1, -0.2, -0.3); }
          if (a.type === 'oop') { set3(T, 'handL', 0.15, 2.5, 0.35); set3(T, 'handR', -0.15, 2.5, 0.35); }
          if (a.slammed) { set3(T, 'handR', -0.08, 2.3, 0.45); set3(T, 'handL', 0.25, 2.1, 0.3); }
          if (!a.slammed && a.style === 'reverse') { T[P.chest + 1] = 0.3; }
        } else { T[P.root + 1] = -0.18; T[P.spine] = 0.25; }
        break;
      }
      case 'hang': {
        // hands on the rim, legs dangle and swing
        if (rim) {
          const l1 = [0, 0, 0], l2 = [0, 0, 0];
          const fx = Math.sin(p.facing), fz = Math.cos(p.facing), lx = Math.cos(p.facing), lz = -Math.sin(p.facing);
          this.toLocal(rim.x + lx * 0.16 - fx * 0.12, rim.y + 0.02, rim.z + lz * 0.16 - fz * 0.12, l1);
          this.toLocal(rim.x - lx * 0.16 - fx * 0.12, rim.y + 0.02, rim.z - lz * 0.16 - fz * 0.12, l2);
          set3(T, 'handL', l1[0] / s, l1[1] / s - 0.02, l1[2] / s - 0.05); set3(T, 'handR', l2[0] / s, l2[1] / s - 0.02, l2[2] / s - 0.05);
          this.palm.L = { normal: [0, -1, 0], fingers: [0, 0, 1], w: 0.8 }; this.palm.R = { normal: [0, -1, 0], fingers: [0, 0, 1], w: 0.8 };
        }
        const sw = Math.sin(t * 7) * 0.12 * Math.exp(-t * 2);
        set3(T, 'footL', 0.12, 0.25 + Math.max(0, sw) * 0.4, 0.1 + sw); set3(T, 'footR', -0.12, 0.22, 0.05 + sw);
        T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; T[P.spine] = -0.08; T[P.head] = -0.15;
        set3(T, 'elbowL', 0.8, 0, -0.6); set3(T, 'elbowR', -0.8, 0, -0.6);
        break;
      }
      case 'land': T[P.root + 1] = -0.05 * Math.sin(Math.min(1, t / a.dur) * Math.PI); T[P.spine] = 0.12; break;
      case 'pass': {
        const q = Math.min(1, t / a.dur);
        const step = Math.sin(q * Math.PI);
        set3(T, 'footL', 0.13, 0.08, 0.05 + step * 0.22);
        T[P.spine] = 0.1 + step * (a.ptype === 'bounce' ? 0.3 : 0.15); T[P.root + 1] = -0.06 - step * 0.06;
        if (a.released) {
          const tgt0 = g?.players[a.to];
          const tgt = tgt0 && g.worldOf ? g.worldOf(tgt0) : tgt0;
          let dx = 0, dz = 1;
          if (tgt) { const lt = [0, 0, 0]; this.toLocal(tgt.x, 1.2, tgt.z, lt); const l = Math.hypot(lt[0], lt[2]) || 1; dx = lt[0] / l; dz = lt[2] / l; }
          const y = a.ptype === 'bounce' ? 0.9 : a.ptype === 'lob' || a.ptype === 'alley' ? 1.9 : 1.32;
          set3(T, 'handL', 0.14 + dx * 0.55, y, 0.2 + dz * 0.5); set3(T, 'handR', -0.14 + dx * 0.55, y, 0.2 + dz * 0.5);
          this.palm.L = { normal: [0, -0.3, 1], fingers: [0.2, 0.3, 0.9], w: 0.7 }; this.palm.R = { normal: [0, -0.3, 1], fingers: [-0.2, 0.3, 0.9], w: 0.7 };
        }
        break;
      }
      case 'catch': T[P.root + 1] -= 0.05; T[P.spine] += 0.08; break;
      case 'steal': {
        // v0.4.4: reach with the chosen hand (left/right), or a low swipe at the dribble
        const k = Math.sin(Math.min(1, t / a.dur) * Math.PI);
        const hd = a.hand === 'L' ? 'L' : 'R', sg = hd === 'L' ? 1 : -1;
        T[P.spine] = 0.2 + k * (a.low ? 0.55 : 0.4); T[P.chest + 1] = sg * 0.25 * k; T[P.root + 1] = -0.1 - k * (a.low ? 0.2 : 0.12);
        set3(T, 'foot' + hd, sg * 0.18, 0.08, 0.1 + k * 0.38);
        const reach = b && Math.hypot(b[0], b[2]) < 1.6 ? [b[0], Math.max(a.low ? 0.35 : 0.6, b[1]), b[2]] : [sg * 0.1, a.low ? 0.55 : 0.95, 0.8];
        set3(T, 'hand' + hd, lerp(sg * 0.25, reach[0], k), lerp(1.0, reach[1], k), lerp(0.2, reach[2], k));
        set3(T, 'elbow' + hd, sg * 0.5, -1, 0);
        this.palm[hd] = { normal: [-sg * 0.3, -0.6, 0.6], fingers: [0, -0.2, 1], w: 0.6 * k };
        break;
      }
      case 'block': case 'rebound': case 'tipjump': {
        if (p.airborne) {
          set3(T, 'footL', 0.13, 0.22, 0.04); set3(T, 'footR', -0.13, 0.2, 0.0); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6;
          set3(T, 'kneeL', 0.2, 0, 1); set3(T, 'kneeR', -0.2, 0, 1);
          if (a.type === 'block' || a.type === 'tipjump') { set3(T, 'handR', -0.1, 2.62, 0.22); set3(T, 'handL', 0.28, 2.3, 0.22); }
          else { set3(T, 'handL', 0.13, 2.55, 0.2); set3(T, 'handR', -0.13, 2.55, 0.2); }
          set3(T, 'elbowL', 0.6, 0, -0.5); set3(T, 'elbowR', -0.6, 0, -0.5);
          T[P.spine] = -0.06; T[P.head] = -0.25;
        } else { T[P.root + 1] = -0.16; T[P.spine] = 0.25; set3(T, 'handL', 0.3, 1.5, 0.25); set3(T, 'handR', -0.3, 1.5, 0.25); }
        break;
      }
      case 'stumble': {
        const q = Math.min(1, t / a.dur);
        if (a.fall) {
          const down = sm(0.05, 0.3, q) * (1 - sm(0.72, 1, q));
          T[P.root + 1] = -0.82 * down; T[P.root + 2] = -0.25 * down;
          set3(T, 'footL', 0.2, 0.08, 0.35 * down + 0.05); set3(T, 'footR', -0.22, 0.08, 0.5 * down);
          set3(T, 'handL', 0.35, 0.15 + 0.85 * (1 - down), -0.25 * down); set3(T, 'handR', -0.35, 0.15 + 0.85 * (1 - down), -0.25 * down);
          T[P.spine] = 0.1 - 0.2 * down; T[P.pelvis] = -0.4 * down; T[P.head] = -0.2 * down;
        } else if (a.back) {
          // shoved backward (posterized / bumped off the line): torso snaps back, arms flail, quick back-steps
          const k = Math.sin(q * Math.PI), st = Math.sin(Math.min(1, q * 1.6) * Math.PI);
          T[P.root + 1] = -0.12 * k; T[P.root + 2] = -0.18 * k;
          T[P.spine] = -0.32 * k; T[P.chest] = -0.18 * k; T[P.head] = 0.25 * k;
          set3(T, 'footL', 0.16, 0.08 + st * 0.06, -0.22 * k); set3(T, 'footR', -0.16, 0.08, 0.1 - 0.3 * k);
          set3(T, 'handL', 0.5, 1.45 + 0.3 * k, 0.15); set3(T, 'handR', -0.5, 1.4 + 0.35 * k, 0.12);
          set3(T, 'elbowL', 0.8, -0.2, -0.4); set3(T, 'elbowR', -0.8, -0.2, -0.4);
        } else {
          const k = Math.sin(q * Math.PI);
          T[P.root + 1] = -0.25 * k; T[P.spine + 2] = a.dir * 0.4 * k; T[P.root] = a.dir * 0.15 * k;
          set3(T, a.dir > 0 ? 'footL' : 'footR', a.dir * 0.42 * k + (a.dir > 0 ? 0.12 : -0.12), 0.08, -0.1);
          set3(T, 'handL', 0.5, 1.1 + 0.3 * k, 0.1); set3(T, 'handR', -0.5, 1.1 + 0.3 * k, 0.1);
        }
        break;
      }
      case 'bump': { const k = Math.sin(Math.min(1, t / a.dur) * Math.PI); T[P.spine] -= 0.18 * k; T[P.root + 2] -= 0.06 * k; break; }
      case 'move': {
        const q = Math.min(1, t / a.dur), k = Math.sin(q * Math.PI) * (1 + 0.25 * (a.lvl || 0)); // better packages sell it harder
        const side = a.handFrom === 'R' ? 1 : -1;
        if (a.move === 'cross' || a.move === 'btl' || a.move === 'btb' || a.move === 'inout') {
          T[P.root + 1] -= 0.08 * k; T[P.spine + 2] = -side * 0.25 * Math.sin(q * Math.PI * 2) * (a.move === 'inout' ? 1 : 0.6);
          T[P.chest + 1] = side * 0.2 * k;
          // plant & push: wide step
          set3(T, side > 0 ? 'footR' : 'footL', -side * 0.34, 0.08, 0.1);
        } else if (a.move === 'hesi') {
          T[P.root + 1] += q < 0.5 ? 0.04 * Math.sin(q * 2 * Math.PI) : -0.08 * Math.sin((q - 0.5) * 2 * Math.PI);
          T[P.spine] = q < 0.55 ? -0.08 : 0.3;
        } else if (a.move === 'stepback') {
          const hop = Math.sin(Math.min(1, q / 0.55) * Math.PI);
          set3(T, 'footL', 0.18, 0.08 + hop * 0.12, -0.05 - hop * 0.15); set3(T, 'footR', -0.18, 0.08 + hop * 0.12, -0.12 - hop * 0.15);
          T[P.root + 1] = -0.1 - 0.06 * k; T[P.spine] = 0.05;
        } else if (a.move === 'spin') {
          T[P.root + 1] = -0.12 * k; T[P.spine] = 0.25 * k;
          set3(T, 'handL', 0.45, 1.15, 0.0); set3(T, 'handR', -0.45, 1.15, 0.0);
        }
        break;
      }
      case 'celebrate': this.celebrate(T, a, p); break;
    }
  }

  celebrate(T, a, p) {
    const t = a.t, k = Math.min(1, t / 0.25) * (1 - Math.max(0, (t - a.dur + 0.3) / 0.3));
    const kind = a.kind || 'flex';
    if (kind === 'flex') {
      mix3(T, 'handL', 0.38, 1.78, 0.02, k); mix3(T, 'handR', -0.38, 1.78, 0.02, k);
      set3(T, 'elbowL', 1, -0.3, 0); set3(T, 'elbowR', -1, -0.3, 0); T[P.spine] = -0.12 * k; T[P.head] = -0.2 * k;
      T[P.chest + 2] = Math.sin(t * 10) * 0.05 * k;
    } else if (kind === 'shimmy') {
      T[P.chest + 1] = Math.sin(t * 22) * 0.25 * k; T[P.clavL + 2] = Math.sin(t * 22) * 0.15 * k; T[P.clavR + 2] = Math.sin(t * 22) * 0.15 * k;
      mix3(T, 'handL', 0.3, 1.3, 0.2, k); mix3(T, 'handR', -0.3, 1.3, 0.2, k);
    } else if (kind === 'point') {
      mix3(T, 'handR', -0.12, 2.55, 0.3, k); T[P.head] = -0.4 * k;
    } else if (kind === 'chest') {
      const hit = Math.abs(Math.sin(t * 9));
      mix3(T, 'handR', -0.05, 1.45, 0.12 + hit * 0.12, k); T[P.spine] = -0.1 * k;
    } else if (kind === 'shush') {
      mix3(T, 'handR', -0.02, 1.86, 0.18, k); this.palm.R = { normal: [1, 0, 0], fingers: [0, 1, 0], w: k };
    } else if (kind === 'too_small') {
      mix3(T, 'handR', -0.3, 0.75, 0.35, k); T[P.spine] = 0.2 * k; this.palm.R = { normal: [0, -1, 0], fingers: [0, 0, 1], w: k };
    } else if (kind === 'shrug') { // v0.4.4: palms up, shoulders up, head tilted
      const up = 0.04 * Math.min(1, t / 0.3);
      mix3(T, 'handL', 0.46, 1.22 + up, 0.3, k); mix3(T, 'handR', -0.46, 1.22 + up, 0.3, k);
      set3(T, 'elbowL', 1, -0.6, 0.2); set3(T, 'elbowR', -1, -0.6, 0.2);
      this.palm.L = { normal: [0, 1, 0], fingers: [0.3, 0, 1], w: k }; this.palm.R = { normal: [0, 1, 0], fingers: [-0.3, 0, 1], w: k };
      T[P.head + 2] = 0.18 * k; T[P.spine] = -0.04 * k;
    } else if (kind === 'salute') {
      mix3(T, 'handR', -0.06, 1.8, 0.2, k); set3(T, 'elbowR', -1, 0.15, 0.2);
      this.palm.R = { normal: [0, -0.4, -1], fingers: [0.6, 0.6, 0], w: k }; T[P.spine] = -0.06 * k; T[P.head] = -0.06 * k;
    } else if (kind === 'heart') {
      if (t < 0.85) { const tap = Math.abs(Math.sin(t * 11)); mix3(T, 'handR', 0.05, 1.5, 0.12 + tap * 0.07, k); this.palm.R = { normal: [0, 0, -1], fingers: [1, 0.3, 0], w: k }; }
      else { const q = Math.min(1, (t - 0.85) / 0.3); mix3(T, 'handR', -0.12, 1.5 + 1.05 * q, 0.14 + 0.16 * q, k); T[P.head] = -0.42 * q * k; }
    } else if (kind === 'crown') { // both hands set a crown on the head, then frame it
      const down = 0.14 * Math.min(1, t / 0.7);
      mix3(T, 'handL', 0.14, 2.22 - down, 0.04, k); mix3(T, 'handR', -0.14, 2.22 - down, 0.04, k);
      set3(T, 'elbowL', 1, 0.3, 0); set3(T, 'elbowR', -1, 0.3, 0);
      this.palm.L = { normal: [0, -1, 0], fingers: [-0.4, 0, 1], w: k }; this.palm.R = { normal: [0, -1, 0], fingers: [0.4, 0, 1], w: k };
      T[P.spine] = -0.08 * k; T[P.head] = 0.05 * k;
    }
  }
}
