// v0.4.5 quick patch: the win-streak fire. One continuous strip of procedural fire all the way round the court (no
// texture, so nothing repeats), seamless where it closes, growing smoothly at 3, 6, 9 and 12 wins, and never
// rescaled frame to frame (the old wall jittered).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { StreakFX } from '../client/js/world/streakfx.js';
import { STD_FS } from '../client/js/gfx/shaders.js';
import { COURT } from '../client/js/sim/constants.js';

const ctx = { geometry: g => g };
const scene = { add() {}, remove() {} };

function fire(full = true) {
  const fx = new StreakFX(ctx, scene, { id: 'main', origin: [0, 0, 0], full }, 'flame');
  return fx;
}
const settle = (fx, level, secs = 8) => { fx.setLevel(level); for (let i = 0; i < secs * 60; i++) fx.update(1 / 60); };

test('one strip of fire all the way round, continuous through the corners and closing without a seam', () => {
  for (const full of [true, false]) {
    const fx = fire(full), g = fx.wall.geo, uv = g.uv, pos = g.position;
    assert.equal(fx.meshes.length, 1, 'a single wall, not stacked layers');
    assert.equal(fx.flameMat.map, null, 'procedural: no image to repeat');
    // u runs in metres along the edge: it only ever grows, and ends at the perimeter where the strip meets its start
    for (let i = 4; i < uv.length; i += 4) assert.ok(uv[i] > uv[i - 4]);
    const n = pos.length / 3;
    assert.deepEqual([pos[0], pos[2]], [pos[(n - 2) * 3], pos[(n - 2) * 3 + 2]], 'it closes where it started');
    assert.ok(Math.abs(uv[uv.length - 4] - fx.perimeter) < 1e-4);
    const W = COURT.width + 4.4 - 0.7;
    assert.ok(fx.perimeter > 2 * W + 10, `round the whole court (${fx.perimeter.toFixed(1)} m)`);
    // the noise wraps after a whole number of cells (a multiple of 4 for the coarse octaves): no seam where it closes
    const [, , k, cells] = fx.flameMat.flame;
    assert.equal(cells % 4, 0); assert.ok(Math.abs(k * fx.perimeter - cells) < 1e-9);
  }
});

test('it grows at every milestone, smoothly, and is never rescaled frame to frame', () => {
  const fx = fire();
  settle(fx, 0); assert.equal(fx.wall.visible, false, 'no streak, no fire');
  const heights = [], bright = [];
  for (const lv of [1, 2, 3, 4]) { settle(fx, lv); heights.push(+fx.wall.matrix[5].toFixed(2)); bright.push(fx.flameMat.flame[0]); }
  assert.deepEqual(heights, [1.4, 2.2, 3, 3.8], 'taller at 3, 6, 9 and 12 wins');
  for (let i = 1; i < 4; i++) assert.ok(bright[i] > bright[i - 1] && fx.flameMat.flameT[2] > 0, 'brighter and fuller too');
  // holding a level: the wall stays put (all the motion is in the shader)
  const a = fx.wall.matrix[5]; fx.update(1 / 60); fx.update(1 / 60);
  assert.equal(fx.wall.matrix[5], a);
  // going up a level eases in: no frame jumps more than a few centimetres
  fx.setLevel(1); settle(fx, 1);
  let prev = fx.wall.matrix[5], maxStep = 0;
  fx.setLevel(4);
  for (let i = 0; i < 300; i++) { fx.update(1 / 60); maxStep = Math.max(maxStep, Math.abs(fx.wall.matrix[5] - prev)); prev = fx.wall.matrix[5]; }
  assert.ok(maxStep < 0.12, `grows smoothly (largest step ${(maxStep * 100).toFixed(1)} cm a frame)`);
  // the shader's clock loops on its own seamless period
  for (let i = 0; i < 60 * 300; i++) fx.update(1 / 60);
  assert.ok(fx.flameMat.flameT[0] >= 0 && fx.flameMat.flameT[0] < 240);
});

test('the fire shader is procedural and loops seamlessly', () => {
  assert.ok(STD_FS.includes('#ifdef FLAME') && STD_FS.includes('vec3 flameColor(vec2 uv)'));
  assert.ok(/FLAME_SPEED = 289\.0 \/ 240\.0/.test(STD_FS), 'the y lattice (289 cells) wraps exactly once per 240 s loop');
  assert.ok(!/flameColor[\s\S]*texture\(/.test(STD_FS.slice(STD_FS.indexOf('vec3 flameColor'), STD_FS.indexOf('void main'))), 'no texture lookups');
});
