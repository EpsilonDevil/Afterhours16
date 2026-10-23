// qp3 perf: Math.hypot without its allocation. V8's Math.hypot (the engine under the game's Chromium window) builds an
// array of its arguments on every call, and the rig and the animator call it thousands of times a frame. These are the
// same computation, step for step, as V8's (builtins/math.tq MathHypot: absolute values, scaled by the largest, a
// compensated sum of squares, the square root times the largest; Infinity before NaN), so every result is bit-for-bit
// the one Math.hypot gives there (tests/qp3hub.test.mjs checks it over millions of inputs). Render-side only: nothing in
// the sim uses them.
export function hypot2(x, y) {
  const ax = Math.abs(x), ay = Math.abs(y);
  let max = 0;
  if (ax > max) max = ax;
  if (ay > max) max = ay;
  if (max === Infinity) return Infinity;
  if (x !== x || y !== y) return NaN;
  if (max === 0) return 0;
  let sum = 0, comp = 0, n, s, p;
  n = ax / max; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  n = ay / max; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  return Math.sqrt(sum) * max;
}
export function hypot3(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let max = 0;
  if (ax > max) max = ax;
  if (ay > max) max = ay;
  if (az > max) max = az;
  if (max === Infinity) return Infinity;
  if (x !== x || y !== y || z !== z) return NaN;
  if (max === 0) return 0;
  let sum = 0, comp = 0, n, s, p;
  n = ax / max; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  n = ay / max; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  n = az / max; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  return Math.sqrt(sum) * max;
}
