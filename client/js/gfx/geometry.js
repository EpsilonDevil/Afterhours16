// Procedural geometry primitives. All return {position, normal, uv, index} typed arrays (+ optional color).
import { m3normalFromM4 } from '../core/math.js';

function build(pos, nrm, uv, idx) {
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
}

export function box(w, h, d, opts = {}) {
  const x = w / 2, y = h / 2, z = d / 2, t = opts.tile || 0;
  const faces = [
    [[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], d, h],
    [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], d, h],
    [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], w, d],
    [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], w, d],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], w, h],
    [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], w, h],
  ];
  const pos = [], nrm = [], uv = [], idx = [];
  for (const [n, v, fu, fv] of faces) {
    const b = pos.length / 3;
    const su = t ? fu / t : 1, sv = t ? fv / t : 1;
    for (let i = 0; i < 4; i++) { pos.push(...v[i]); nrm.push(...n); }
    uv.push(0, sv, su, sv, su, 0, 0, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = build(pos, nrm, uv, idx);
  if (opts.y0) translate(g, 0, h / 2, 0);
  return g;
}

export function plane(w, d, sx = 1, sz = 1, opts = {}) {
  const pos = [], nrm = [], uv = [], idx = [];
  const tu = opts.tile ? w / opts.tile : 1, tv = opts.tile ? d / opts.tile : 1;
  for (let j = 0; j <= sz; j++) for (let i = 0; i <= sx; i++) {
    const u = i / sx, v = j / sz;
    pos.push((u - 0.5) * w, 0, (v - 0.5) * d); nrm.push(0, 1, 0); uv.push(u * tu, v * tv);
  }
  for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
    const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  return build(pos, nrm, uv, idx);
}

// Vertical quad in XY plane facing +Z
export function quad(w, h, opts = {}) {
  const x = w / 2, y0 = opts.bottom ? 0 : -h / 2, y1 = y0 + h;
  return build([-x, y0, 0, x, y0, 0, x, y1, 0, -x, y1, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 1, 1, 1, 0, 0, 0], [0, 1, 2, 0, 2, 3]);
}

export function sphere(r, ws = 24, hs = 16, opts = {}) {
  const pos = [], nrm = [], uv = [], idx = [];
  const sx = opts.sx || 1, sy = opts.sy || 1, sz = opts.sz || 1;
  const phiMax = opts.phiMax ?? Math.PI;
  for (let j = 0; j <= hs; j++) {
    const v = j / hs, phi = v * phiMax;
    for (let i = 0; i <= ws; i++) {
      const u = i / ws, th = u * Math.PI * 2;
      const nx = -Math.cos(th) * Math.sin(phi), ny = Math.cos(phi), nz = Math.sin(th) * Math.sin(phi);
      pos.push(nx * r * sx, ny * r * sy, nz * r * sz);
      const l = Math.hypot(nx / sx, ny / sy, nz / sz) || 1;
      nrm.push(nx / sx / l, ny / sy / l, nz / sz / l);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
    const a = j * (ws + 1) + i, b = a + ws + 1;
    if (j !== 0 || phiMax < Math.PI) idx.push(a, b, a + 1);
    if (j !== hs - 1 || phiMax < Math.PI) idx.push(a + 1, b, b + 1);
  }
  return build(pos, nrm, uv, idx);
}

export function cylinder(rTop, rBot, h, seg = 16, opts = {}) {
  const pos = [], nrm = [], uv = [], idx = [];
  const y0 = opts.y0 ? 0 : -h / 2, slope = (rBot - rTop) / h;
  const hseg = opts.hseg || 1;
  for (let j = 0; j <= hseg; j++) {
    const v = j / hseg, y = y0 + v * h, r = rBot + (rTop - rBot) * v;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, a = u * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r, y, s * r);
      const l = Math.hypot(1, slope);
      nrm.push(c / l, slope / l, s / l);
      uv.push(u * (opts.uTile || 1), (1 - v) * (opts.vTile || 1));
    }
  }
  for (let j = 0; j < hseg; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const cap = (y, r, up) => {
    if (r <= 0) return;
    const c = pos.length / 3;
    pos.push(0, y, 0); nrm.push(0, up, 0); uv.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r); nrm.push(0, up, 0); uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
    }
    for (let i = 0; i < seg; i++) up > 0 ? idx.push(c, c + 2 + i, c + 1 + i) : idx.push(c, c + 1 + i, c + 2 + i);
  };
  if (!opts.open) { cap(y0 + h, rTop, 1); cap(y0, rBot, -1); }
  return build(pos, nrm, uv, idx);
}

export function torus(R, r, segR = 32, segT = 10, arc = Math.PI * 2) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let j = 0; j <= segR; j++) {
    const u = j / segR, a = u * arc, ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i <= segT; i++) {
      const v = i / segT, b = v * Math.PI * 2, cb = Math.cos(b), sb = Math.sin(b);
      pos.push((R + r * cb) * ca, r * sb, (R + r * cb) * sa);
      nrm.push(cb * ca, sb, cb * sa);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < segR; j++) for (let i = 0; i < segT; i++) {
    const a = j * (segT + 1) + i, b = a + segT + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return build(pos, nrm, uv, idx);
}

// Tube along a polyline path (array of [x,y,z]).
export function tube(path, radius, seg = 8, opts = {}) {
  const pos = [], nrm = [], uv = [], idx = [];
  const n = path.length;
  let prevN = null;
  let len = 0;
  for (let k = 0; k < n; k++) {
    const p = path[k];
    const a = path[Math.max(0, k - 1)], b = path[Math.min(n - 1, k + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let nx, ny, nz;
    if (!prevN) { if (Math.abs(ty) < 0.9) { nx = -tz; ny = 0; nz = tx; } else { nx = 1; ny = 0; nz = 0; } }
    else { [nx, ny, nz] = prevN; const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz; }
    let nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    prevN = [nx, ny, nz];
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    if (k > 0) len += Math.hypot(p[0] - path[k - 1][0], p[1] - path[k - 1][1], p[2] - path[k - 1][2]);
    const r = typeof radius === 'function' ? radius(k / (n - 1)) : radius;
    for (let i = 0; i <= seg; i++) {
      const ang = i / seg * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      const ox = nx * c + bx * s, oy = ny * c + by * s, oz = nz * c + bz * s;
      pos.push(p[0] + ox * r, p[1] + oy * r, p[2] + oz * r);
      nrm.push(ox, oy, oz);
      uv.push(i / seg, len * (opts.vScale || 1));
    }
  }
  for (let k = 0; k < n - 1; k++) for (let i = 0; i < seg; i++) {
    const a = k * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return build(pos, nrm, uv, idx);
}

// Lathe around Y from profile [[r, y], ...]
export function lathe(profile, seg = 24, opts = {}) {
  const pos = [], nrm = [], uv = [], idx = [];
  const n = profile.length;
  const sx = opts.sx || 1, sz = opts.sz || 1;
  for (let k = 0; k < n; k++) {
    const [r, y] = profile[k];
    const p0 = profile[Math.max(0, k - 1)], p1 = profile[Math.min(n - 1, k + 1)];
    let dr = p1[0] - p0[0], dy = p1[1] - p0[1];
    const l = Math.hypot(dr, dy) || 1; dr /= l; dy /= l;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r * sx, y, s * r * sz);
      const nx = dy * c / sx, nz = dy * s / sz, ny = -dr, nl = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / nl, ny / nl, nz / nl);
      uv.push(i / seg, k / (n - 1));
    }
  }
  for (let k = 0; k < n - 1; k++) for (let i = 0; i < seg; i++) {
    const a = k * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return build(pos, nrm, uv, idx);
}

export function translate(g, x, y, z) {
  for (let i = 0; i < g.position.length; i += 3) { g.position[i] += x; g.position[i + 1] += y; g.position[i + 2] += z; }
  return g;
}
export function scaleGeo(g, sx, sy, sz) {
  for (let i = 0; i < g.position.length; i += 3) { g.position[i] *= sx; g.position[i + 1] *= sy; g.position[i + 2] *= sz; }
  for (let i = 0; i < g.normal.length; i += 3) {
    const x = g.normal[i] / sx, y = g.normal[i + 1] / sy, z = g.normal[i + 2] / sz, l = Math.hypot(x, y, z) || 1;
    g.normal[i] = x / l; g.normal[i + 1] = y / l; g.normal[i + 2] = z / l;
  }
  return g;
}
export function transformGeo(g, m) {
  const nm = new Float32Array(9);
  m3normalFromM4(nm, m);
  const p = g.position, n = g.normal;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    p[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    p[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    p[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    const a = n[i], b = n[i + 1], c = n[i + 2];
    const nx = nm[0] * a + nm[3] * b + nm[6] * c, ny = nm[1] * a + nm[4] * b + nm[7] * c, nz = nm[2] * a + nm[5] * b + nm[8] * c;
    const l = Math.hypot(nx, ny, nz) || 1;
    n[i] = nx / l; n[i + 1] = ny / l; n[i + 2] = nz / l;
  }
  return g;
}
export function clone(g) {
  const o = {};
  for (const k of Object.keys(g)) o[k] = g[k] && g[k].slice ? g[k].slice() : g[k];
  return o;
}

// Merge parts: [{geo, matrix?, color?:[r,g,b,a]}] → single geometry with vertex colors.
export function merge(parts, withColor = true) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.geo.position.length / 3; ni += p.geo.index ? p.geo.index.length : p.geo.position.length / 3; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = withColor ? new Float32Array(nv * 4) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.matrix ? transformGeo(clone(p.geo), p.matrix) : p.geo;
    const n = g.position.length / 3;
    pos.set(g.position, vo * 3);
    nrm.set(g.normal, vo * 3);
    if (g.uv) uv.set(g.uv, vo * 2);
    if (col) {
      const c = p.color || [1, 1, 1, 1];
      if (g.color) col.set(g.color, vo * 4);
      else for (let i = 0; i < n; i++) col.set(c.length === 4 ? c : [...c, 1], (vo + i) * 4);
    }
    if (g.index) for (let i = 0; i < g.index.length; i++) idx[io++] = g.index[i] + vo;
    else for (let i = 0; i < n; i++) idx[io++] = vo + i;
    vo += n;
  }
  return { position: pos, normal: nrm, uv, color: col, index: idx };
}

// Recompute smooth normals (used for deformed procedural shapes).
export function computeNormals(g) {
  const p = g.position, idx = g.index, n = new Float32Array(p.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  g.normal = n;
  return g;
}
// Flip winding (for inward facing geometry).
export function flip(g) {
  const idx = g.index;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  for (let i = 0; i < g.normal.length; i++) g.normal[i] = -g.normal[i];
  return g;
}
