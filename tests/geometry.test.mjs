import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../client/js/gfx/geometry.js';

function windingScore(g) {
  const p = g.position, n = g.normal, idx = g.index;
  let good = 0, bad = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (Math.hypot(fx, fy, fz) < 1e-9) continue;
    const nx = n[a] + n[b] + n[c], ny = n[a + 1] + n[b + 1] + n[c + 1], nz = n[a + 2] + n[b + 2] + n[c + 2];
    (fx * nx + fy * ny + fz * nz > 0 ? good++ : bad++);
  }
  return bad / (good + bad);
}
test('primitive winding matches normals (CCW front faces)', () => {
  const prims = {
    box: G.box(1, 2, 3), plane: G.plane(2, 2, 4, 4), quad: G.quad(1, 1), sphere: G.sphere(1, 16, 12),
    cylinder: G.cylinder(0.5, 0.7, 2, 12), torus: G.torus(1, 0.2, 16, 8),
    tube: G.tube([[0, 0, 0], [1, 0.2, 0], [2, 0.5, 0.3], [3, 1, 0]], 0.1, 8), lathe: G.lathe([[0.2, 0], [0.5, 0.5], [0.3, 1]], 12),
  };
  for (const [name, g] of Object.entries(prims)) assert.ok(windingScore(g) < 0.02, `${name} winding bad ratio ${windingScore(g)}`);
});
