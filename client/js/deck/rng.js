// The Gauntlet's seeded RNG. Pure: no Math.random, no clock. The state is a plain object ({s: uint32}) kept inside the
// run (or the match), so a run saved to localStorage and resumed keeps drawing the same numbers, and the same seed with
// the same choices always replays the same run (the server re-checks summaries).
// mulberry32 (the same generator as core/rng.js), on a state object instead of a class instance.

export function hash(...parts) {
  let h = 2166136261 >>> 0;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const stream = (...parts) => ({ s: hash(...parts) || 0x9e3779b9 });

export function next(st) {
  let t = (st.s = (st.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const int = (st, a, b) => a + Math.floor(next(st) * (b - a + 1));
export const chance = (st, p) => next(st) < p;
export const pick = (st, arr) => arr[Math.floor(next(st) * arr.length)];
export function shuffle(st, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next(st) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
// weighted pick: items [[value, weight], ...]
export function weighted(st, items) {
  let tot = 0; for (const [, w] of items) tot += Math.max(0, w);
  let r = next(st) * tot;
  for (const [v, w] of items) { r -= Math.max(0, w); if (r < 0) return v; }
  return items[items.length - 1][0];
}
// n distinct picks
export function sample(st, arr, n) { return shuffle(st, arr.slice()).slice(0, n); }
// a stable hash of any JSON value (the determinism tests and the server's re-check use it)
export function stateHash(obj) { return hash(JSON.stringify(obj)).toString(16).padStart(8, '0'); }
// the same, without the cosmetics: names, looks and every line of text. The client (with the game's AIWorld and its
// clock) and the server's replay (with neither) agree on this one; stateHash also covers the cosmetics
export const COSMETIC_KEYS = new Set(['name', 'look', 'looks', 'text', 'line', 'title']);
export function outcomeHash(obj) { return hash(JSON.stringify(obj, (k, v) => (COSMETIC_KEYS.has(k) ? undefined : v))).toString(16).padStart(8, '0'); }
