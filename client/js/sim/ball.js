// Basketball rigid-body flight: gravity, drag, Magnus, rim torus, glass, floor, net damping, score detection.
import { COURT, BALL_R, GRAVITY } from './constants.js';

const RT = COURT.rimR + COURT.rimTube; // torus centerline radius
const SUB = 4;

export class Ball {
  constructor() {
    this.x = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.wx = 0; this.wy = 0; this.wz = 0; // spin rad/s
    this.mode = 'dead'; // held | dribble | flight | dead
    this.holder = -1;
    this.kind = null; // shot | pass | loose
    this.info = null;
    this.lastTouch = -1; this.lastTeam = -1;
    this.touchedRim = false; this.touchedBoard = false;
    this.floorBounces = 0;
    this.surface = 'wood';
    this.halfOnly = false; // park: only +z hoop exists
    this.scoredFlag = 0;
  }
  setFlight(x, y, z, vx, vy, vz, kind, info) {
    Object.assign(this, { x, y, z, vx, vy, vz, mode: 'flight', holder: -1, kind, info: info || null });
    this.touchedRim = false; this.touchedBoard = false; this.floorBounces = 0; this.scoredFlag = 0;
    this.flightTime = 0; this.ghost = false;
  }
  snapshot() { return { x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz, wx: this.wx, wy: this.wy, wz: this.wz }; }

  // Step free flight by dt; returns array of events (may be empty).
  step(dt, events) {
    const h = dt / SUB;
    for (let i = 0; i < SUB; i++) this.substep(h, events);
    this.flightTime = (this.flightTime || 0) + dt;
  }

  substep(h, events) {
    const r = BALL_R;
    // forces
    const sp = Math.hypot(this.vx, this.vy, this.vz);
    const kd = 0.0185;
    let ax = -kd * sp * this.vx, ay = -GRAVITY - kd * sp * this.vy, az = -kd * sp * this.vz;
    const km = 0.0032; // Magnus ω × v
    ax += km * (this.wy * this.vz - this.wz * this.vy);
    ay += km * (this.wz * this.vx - this.wx * this.vz);
    az += km * (this.wx * this.vy - this.wy * this.vx);
    this.vx += ax * h; this.vy += ay * h; this.vz += az * h;
    const py = this.y;
    this.x += this.vx * h; this.y += this.vy * h; this.z += this.vz * h;
    // hoops
    const sides = this.halfOnly ? [1] : [1, -1];
    for (const side of sides) {
      const cz = side * COURT.hoopZ, cy = COURT.rimY;
      // score detection: crossing rim plane downward inside the ring
      if (py >= cy && this.y < cy && this.vy < 0) {
        const d = Math.hypot(this.x, this.z - cz);
        if (d < COURT.rimR - 0.035) {
          this.scoredFlag = side;
          events && events.push({ type: 'through', side, clean: !this.touchedRim && !this.touchedBoard, rim: this.touchedRim });
        }
      }
      if (!this.ghost) { this.collideRim(side, cz, cy, events); this.collideBoard(side, events); }
      // net: funnel and slow the ball under the rim
      const dn = Math.hypot(this.x, this.z - cz);
      if (this.y < cy && this.y > cy - 0.45 && dn < COURT.rimR && this.vy < 0) {
        const k = Math.exp(-5.5 * h);
        this.vx *= k; this.vz *= k; this.vy *= Math.exp(-2.2 * h);
        this.vx += -this.x * 9 * h; this.vz += -(this.z - cz) * 9 * h;
        if (!this.netTouched) { this.netTouched = true; events && events.push({ type: 'net', side }); }
      } else if (this.y < cy - 0.6) this.netTouched = false;
    }
    // floor
    if (this.y < r) {
      this.y = r;
      if (this.vy < 0) {
        const e = this.surface === 'wood' ? 0.8 : 0.74;
        const impact = -this.vy;
        this.vy = impact > 0.35 ? impact * e : 0;
        // friction & spin coupling
        const f = 0.86;
        const rollX = this.vx + this.wz * r * 0.4, rollZ = this.vz - this.wx * r * 0.4;
        this.vx = rollX * f; this.vz = rollZ * f;
        this.wx = this.vz / r * 0.5; this.wz = -this.vx / r * 0.5;
        this.floorBounces++;
        if (impact > 0.6) events && events.push({ type: 'bounce', x: this.x, z: this.z, v: impact });
      }
      if (this.vy === 0) { // rolling
        const k = Math.exp(-0.6 * h);
        this.vx *= k; this.vz *= k;
        this.wx = this.vz / r; this.wz = -this.vx / r;
      }
    }
    // spin decay
    const sk = Math.exp(-0.15 * h);
    this.wx *= sk; this.wy *= sk; this.wz *= sk;
  }

  collideRim(side, cz, cy, events) {
    const r = BALL_R, rt = COURT.rimTube;
    const dx = this.x, dz = this.z - cz;
    const dh = Math.hypot(dx, dz);
    if (dh > RT + r + 0.05 || Math.abs(this.y - cy) > r + 0.05) return;
    let qx, qz;
    if (dh < 1e-5) { qx = RT; qz = 0; } else { qx = dx / dh * RT; qz = dz / dh * RT; }
    // the connector side (toward board) is part of the rim too
    const px = this.x - qx, py = this.y - cy, pz = this.z - (cz + qz);
    const dist = Math.hypot(px, py, pz);
    if (dist < r + rt && dist > 1e-6) {
      const nx = px / dist, ny = py / dist, nz = pz / dist;
      const pen = r + rt - dist;
      this.x += nx * pen; this.y += ny * pen; this.z += nz * pen;
      const vn = this.vx * nx + this.vy * ny + this.vz * nz;
      if (vn < 0) {
        // v0.4.2: a real rim isn't a perfect torus: the ring flexes and the net hooks pull on it, so each
        // contact deflects a little differently. The jitter is a deterministic hash of the contact point, so
        // the pre-simulated make/miss stays exact.
        const hsh = v => { const s = Math.sin(v) * 43758.5453; return s - Math.floor(s); };
        const j1 = hsh(this.x * 127.1 + this.z * 311.7 + this.y * 74.7) - 0.5, j2 = hsh(this.x * 269.5 + this.z * 183.3 + this.y * 246.1) - 0.5;
        const tl = Math.hypot(-nz, nx) || 1;
        let mx = nx + (-nz / tl) * j1 * 0.22, my = ny + j2 * 0.12, mz = nz + (nx / tl) * j1 * 0.22;
        const ml = Math.hypot(mx, my, mz); mx /= ml; my /= ml; mz /= ml;
        const vm = this.vx * mx + this.vy * my + this.vz * mz;
        const e = 0.5 + 0.12 * (hsh(this.x * 13.3 + this.z * 7.7) ) - Math.min(0.08, -vn * 0.008);
        if (vm < 0) { this.vx -= (1 + e) * vm * mx; this.vy -= (1 + e) * vm * my; this.vz -= (1 + e) * vm * mz; }
        else { this.vx -= (1 + e) * vn * nx; this.vy -= (1 + e) * vn * ny; this.vz -= (1 + e) * vn * nz; }
        // tangential friction
        const vn2 = this.vx * nx + this.vy * ny + this.vz * nz;
        const tx = this.vx - vn2 * nx, ty = this.vy - vn2 * ny, tz = this.vz - vn2 * nz;
        const f = 0.9;
        this.vx = vn2 * nx + tx * f; this.vy = vn2 * ny + ty * f; this.vz = vn2 * nz + tz * f;
        // spin from glancing contact
        this.wx += (ny * tz - nz * ty) * 4; this.wy += (nz * tx - nx * tz) * 4; this.wz += (nx * ty - ny * tx) * 4;
        this.touchedRim = true;
        if (-vn > 0.25) events && events.push({ type: 'rim', side, v: -vn, x: this.x, y: this.y, z: this.z });
      }
    }
    // rim connector/bracket box behind the ring (toward glass)
    const backZ0 = cz + side * RT, backZ1 = side * COURT.boardZ;
    const zmin = Math.min(backZ0, backZ1), zmax = Math.max(backZ0, backZ1);
    if (Math.abs(this.x) < 0.06 + r && this.z > zmin - r && this.z < zmax + r && this.y > cy - 0.03 - r && this.y < cy + 0.01 + r && Math.abs(this.x) < 0.06 + r * 0.5) {
      if (this.vy < 0 && this.y > cy) { this.y = cy + 0.01 + r; this.vy = -this.vy * 0.45; this.touchedRim = true; events && events.push({ type: 'rim', side, v: 1, x: this.x, y: this.y, z: this.z }); }
    }
  }

  collideBoard(side, events) {
    const r = BALL_R;
    const face = side * COURT.boardZ; // front face plane z
    const y0 = COURT.boardBottom, y1 = COURT.boardBottom + COURT.boardH, hw = COURT.boardW / 2;
    if (this.y < y0 - r || this.y > y1 + r || Math.abs(this.x) > hw + r) return;
    const depth = (this.z - face) * side; // >0 means past the face (into the board)
    if (depth > -r && depth < COURT.boardT + r) {
      // closest point on board box to center
      const cx = Math.max(-hw, Math.min(hw, this.x)), cy = Math.max(y0, Math.min(y1, this.y));
      const czMin = Math.min(face, face + side * COURT.boardT), czMax = Math.max(face, face + side * COURT.boardT);
      const cz = Math.max(czMin, Math.min(czMax, this.z));
      const px = this.x - cx, py = this.y - cy, pz = this.z - cz;
      const dist = Math.hypot(px, py, pz);
      if (dist < r) {
        let nx, ny, nz;
        if (dist > 1e-6) { nx = px / dist; ny = py / dist; nz = pz / dist; } else { nx = 0; ny = 0; nz = -side; }
        const pen = r - dist;
        this.x += nx * pen; this.y += ny * pen; this.z += nz * pen;
        const vn = this.vx * nx + this.vy * ny + this.vz * nz;
        if (vn < 0) {
          const e = 0.62;
          this.vx -= (1 + e) * vn * nx; this.vy -= (1 + e) * vn * ny; this.vz -= (1 + e) * vn * nz;
          this.vx *= 0.94; this.vy *= 0.94;
          this.touchedBoard = true;
          if (-vn > 0.3) events && events.push({ type: 'board', side, v: -vn });
        }
      }
    }
  }
}

// Clone ball for trajectory pre-simulation
export function cloneBall(b) {
  const c = new Ball();
  Object.assign(c, b);
  c.info = null;
  return c;
}

// Simulate a shot forward to find whether it scores. Returns {made, rim, board, time, path?}
export function predictShot(ball, maxT = 4) {
  const b = cloneBall(ball);
  const ev = [];
  const dt = 1 / 60;
  let made = false, t = 0;
  while (t < maxT) {
    ev.length = 0;
    b.step(dt, ev);
    t += dt;
    for (const e of ev) if (e.type === 'through') { made = true; }
    if (made) break;
    if (b.y < 1.5 && b.vy < 0 && b.floorBounces > 0) break;
    if (b.y <= BALL_R + 0.001 && t > 0.4) break;
  }
  return { made, rim: b.touchedRim, board: b.touchedBoard, time: t };
}
