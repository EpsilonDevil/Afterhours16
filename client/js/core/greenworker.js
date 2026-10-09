// v0.4.7.5 quick patch: renders green release sounds off the main thread (core/greensound.js asks; the samples come
// back as a transferred Float32Array), so a game never stalls while a sound is being made.
import { renderGreen } from './greensound.js';

self.onmessage = e => {
  const { key, id, ts } = e.data || {};
  let x = null;
  try { x = renderGreen(id, { ts }); } catch { x = null; }
  self.postMessage({ key, x }, x ? [x.buffer] : []);
};
