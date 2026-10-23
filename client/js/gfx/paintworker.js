// qp3 perf: paints the ground textures (gfx/textures.js paintAsphalt / paintSand) off the main thread for
// textures.js prepaintGrounds, which main.js calls once the menus are up. The bytes come back transferred; the main
// thread turns them into the same canvas the painter would have made there (textures.js groundOut).
import { GROUND_PAINTERS } from './textures.js';

self.onmessage = e => {
  const { key, kind, opts } = e.data || {};
  let p = null;
  try { p = GROUND_PAINTERS[kind] ? GROUND_PAINTERS[kind](opts || {}) : null; } catch { p = null; }
  self.postMessage({ key, p }, p ? [p.rgba.buffer, p.normal.data.buffer] : []);
};
