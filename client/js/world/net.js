// Verlet-simulated basketball net rendered as individual knotted strands (thin tubes).
import { COURT, BALL_R } from '../sim/constants.js';

export class Net {
  constructor(ctx, rim, material, opts = {}) {
    this.ctx = ctx;
    this.rim = rim; // {x,y,z}
    this.cols = opts.cols || 12;
    this.rows = opts.rows || 6;
    this.depth = opts.depth || 0.44;
    this.bottomR = opts.bottomR || 0.13;
    const n = this.cols * (this.rows + 1);
    this.p = new Float32Array(n * 3);
    this.q = new Float32Array(n * 3);
    this.rest = [];
    this.home = new Float32Array(n * 3);
    for (let r = 0; r <= this.rows; r++) {
      const t = r / this.rows;
      const rad = COURT.rimR + (this.bottomR - COURT.rimR) * Math.pow(t, 0.8);
      for (let c = 0; c < this.cols; c++) {
        const a = (c + (r % 2) * 0.5) / this.cols * Math.PI * 2;
        const i = (r * this.cols + c) * 3;
        this.home[i] = Math.cos(a) * rad; this.home[i + 1] = -t * this.depth; this.home[i + 2] = Math.sin(a) * rad;
      }
    }
    for (let i = 0; i < n * 3; i += 3) {
      this.p[i] = rim.x + this.home[i]; this.p[i + 1] = rim.y + this.home[i + 1]; this.p[i + 2] = rim.z + this.home[i + 2];
    }
    this.q.set(this.p);
    // strands: diamond lattice
    this.strands = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const a = r * this.cols + c;
      const off = r % 2; // odd rows shifted +half
      const b1 = (r + 1) * this.cols + ((c + off) % this.cols);
      const b2 = (r + 1) * this.cols + ((c + off - 1 + this.cols) % this.cols);
      this.strands.push([a, b1], [a, b2]);
    }
    for (const [a, b] of this.strands) this.rest.push(this.dist(this.home, a, b));
    // horizontal soft constraints keep the shape round
    this.rings = [];
    for (let r = 1; r <= this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const a = r * this.cols + c, b = r * this.cols + (c + 1) % this.cols;
      this.rings.push([a, b, this.dist(this.home, a, b)]);
    }
    this.radial = 4; // tube sides
    this.material = material;
    this.buildGeometry();
    this.energy = 0;
    this.offset = { x: 0, y: 0, z: 0 };
  }
  dist(arr, a, b) { return Math.hypot(arr[a * 3] - arr[b * 3], arr[a * 3 + 1] - arr[b * 3 + 1], arr[a * 3 + 2] - arr[b * 3 + 2]); }

  buildGeometry() {
    const S = this.strands.length, R = this.radial;
    const nv = S * 2 * R, ni = S * R * 6;
    this.pos = new Float32Array(nv * 3); this.nrm = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2), idx = new Uint16Array(ni);
    let k = 0;
    for (let s = 0; s < S; s++) {
      const base = s * 2 * R;
      for (let i = 0; i < R; i++) {
        const a = base + i, b = base + (i + 1) % R, c2 = base + R + i, d = base + R + (i + 1) % R;
        idx.set([a, c2, b, b, c2, d], k); k += 6;
      }
    }
    this.geo = this.ctx.geometry({ position: this.pos, normal: this.nrm, uv, index: idx }, true);
    this.geo.bounds = { center: [this.rim.x, this.rim.y - 0.2, this.rim.z], radius: 0.6 };
    this.updateMesh();
  }

  // rimOffset: displacement of the rim (shake). ball: {x,y,z} or null
  update(dt, ball, rimOffset) {
    const off = rimOffset || this.offset;
    const n = this.p.length / 3;
    const g = -9.8 * dt * dt;
    const damp = 0.965;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (i < this.cols) { // pinned to rim hooks
        this.p[j] = this.rim.x + off.x + this.home[j]; this.p[j + 1] = this.rim.y + off.y + this.home[j + 1]; this.p[j + 2] = this.rim.z + off.z + this.home[j + 2];
        this.q[j] = this.p[j]; this.q[j + 1] = this.p[j + 1]; this.q[j + 2] = this.p[j + 2];
        continue;
      }
      const x = this.p[j], y = this.p[j + 1], z = this.p[j + 2];
      // spring toward rest shape (stiffness of the cord) to keep it lively but stable
      const hx = this.rim.x + off.x + this.home[j], hy = this.rim.y + off.y + this.home[j + 1], hz = this.rim.z + off.z + this.home[j + 2];
      const k = 0.012;
      this.p[j] += (x - this.q[j]) * damp + (hx - x) * k;
      this.p[j + 1] += (y - this.q[j + 1]) * damp + g + (hy - y) * k;
      this.p[j + 2] += (z - this.q[j + 2]) * damp + (hz - z) * k;
      this.q[j] = x; this.q[j + 1] = y; this.q[j + 2] = z;
    }
    for (let it = 0; it < 4; it++) {
      for (let s = 0; s < this.strands.length; s++) this.solve(this.strands[s][0], this.strands[s][1], this.rest[s], 1);
      for (const [a, b, r] of this.rings) this.solve(a, b, r, 0.35);
      if (ball) this.collide(ball);
    }
    this.updateMesh();
  }
  solve(a, b, rest, stiff) {
    const p = this.p, ia = a * 3, ib = b * 3;
    const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    if (d < rest && stiff < 1) return; // ring constraints only resist stretching
    const diff = (d - rest) / d * stiff;
    const wa = a < this.cols ? 0 : 0.5, wb = b < this.cols ? 0 : 0.5;
    const tot = wa + wb || 1;
    p[ia] += dx * diff * wa / tot; p[ia + 1] += dy * diff * wa / tot; p[ia + 2] += dz * diff * wa / tot;
    p[ib] -= dx * diff * wb / tot; p[ib + 1] -= dy * diff * wb / tot; p[ib + 2] -= dz * diff * wb / tot;
  }
  collide(ball) {
    const R = BALL_R + 0.012, p = this.p;
    const dx0 = ball.x - this.rim.x, dz0 = ball.z - this.rim.z;
    if (dx0 * dx0 + dz0 * dz0 > 0.5 || ball.y > this.rim.y + 0.3 || ball.y < this.rim.y - this.depth - 0.4) return;
    for (let i = this.cols; i < p.length / 3; i++) {
      const j = i * 3;
      const dx = p[j] - ball.x, dy = p[j + 1] - ball.y, dz = p[j + 2] - ball.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < R && d > 1e-6) {
        const k = (R - d) / d;
        p[j] += dx * k; p[j + 1] += dy * k; p[j + 2] += dz * k;
        this.energy = Math.min(1, this.energy + 0.02);
      }
    }
  }
  updateMesh() {
    const S = this.strands.length, R = this.radial, p = this.p, rad = 0.0045;
    let v = 0;
    for (let s = 0; s < S; s++) {
      const [a, b] = this.strands[s];
      const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2], bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
      let tx = bx - ax, ty = by - ay, tz = bz - az; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // perpendicular frame
      let nx = -tz, ny = 0, nz = tx; let nl = Math.hypot(nx, nz); if (nl < 1e-4) { nx = 1; nz = 0; nl = 1; } nx /= nl; nz /= nl;
      const bxv = ty * nz - tz * ny, byv = tz * nx - tx * nz, bzv = tx * ny - ty * nx;
      for (let end = 0; end < 2; end++) {
        const cx = end ? bx : ax, cy = end ? by : ay, cz = end ? bz : az;
        for (let i = 0; i < R; i++) {
          const ang = i / R * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
          const ox = nx * c + bxv * sn, oy = ny * c + byv * sn, oz = nz * c + bzv * sn;
          this.pos[v * 3] = cx + ox * rad; this.pos[v * 3 + 1] = cy + oy * rad; this.pos[v * 3 + 2] = cz + oz * rad;
          this.nrm[v * 3] = ox; this.nrm[v * 3 + 1] = oy; this.nrm[v * 3 + 2] = oz;
          v++;
        }
      }
    }
    this.ctx.updateAttribute(this.geo, 'position', this.pos);
    this.ctx.updateAttribute(this.geo, 'normal', this.nrm);
  }
}
