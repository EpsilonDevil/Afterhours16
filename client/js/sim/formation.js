// Court spots relative to the attacking side (+1 attacks +Z rim, -1 attacks -Z rim).
import { COURT } from './constants.js';

const R = COURT.hoopZ;
// Offensive spots expressed as (x, distance-from-baseline-side rim z offset), mirrored by side.
const SPOTS = {
  top: [0, R - 7.9], wingL: [5.3, R - 5.6], wingR: [-5.3, R - 5.6], cornerL: [6.75, R - 0.3], cornerR: [-6.75, R - 0.3],
  elbowL: [2.45, R - 4.6], elbowR: [-2.45, R - 4.6], blockL: [2.95, R - 1.1], blockR: [-2.95, R - 1.1], // (qp3: the low block is outside the lane line, not in the paint) dunkL: [2.9, R + 0.4], dunkR: [-2.9, R + 0.4],
  slotL: [2.9, R - 7.3], slotR: [-2.9, R - 7.3],
};
export const FORMATIONS = {
  1: [['top']],
  2: [['top', 'wingL'], ['top', 'cornerR']],
  3: [['top', 'wingL', 'blockR'], ['slotR', 'wingL', 'dunkR'], ['top', 'cornerL', 'elbowR']],
  4: [['top', 'wingL', 'cornerR', 'blockL'], ['slotL', 'slotR', 'cornerL', 'dunkR']],
  5: [['top', 'wingL', 'wingR', 'blockL', 'elbowR'], ['top', 'wingL', 'cornerR', 'blockR', 'dunkL'], ['slotL', 'wingR', 'cornerL', 'elbowL', 'blockR']],
};
// perf: spots, spot sets and rims are asked for many times a tick and only ever read (the AI and the Game copy the
// numbers out or build new objects from them; nothing writes into one or keeps it to change later), so each one for a
// side of +1 / -1 is made once and frozen: a write would throw instead of moving a spot. Any other side gets a new
// object, as before
const sideIx = side => (side === 1 ? 0 : side === -1 ? 1 : -1);
const SPOT_CACHE = [new Map(), new Map()], SET_CACHE = [new Map(), new Map()];
const makeSpot = (name, side) => { const s = SPOTS[name] || SPOTS.top; return { x: s[0] * side, z: s[1] * side }; };
export function spot(name, side) {
  const i = sideIx(side);
  if (i < 0) return makeSpot(name, side);
  let o = SPOT_CACHE[i].get(name);
  if (!o) SPOT_CACHE[i].set(name, (o = Object.freeze(makeSpot(name, side))));
  return o;
}
export function spotsFor(count, side, variant = 0) {
  const sets = FORMATIONS[Math.max(1, Math.min(5, count))];
  const set = sets[variant % sets.length];
  const i = sideIx(side);
  if (i < 0) return set.map(n => ({ name: n, ...makeSpot(n, side) }));
  let out = SET_CACHE[i].get(set);
  if (!out) SET_CACHE[i].set(set, (out = Object.freeze(set.map(n => Object.freeze({ name: n, ...makeSpot(n, side) })))));
  return out;
}
export const CHECK_SPOT = side => ({ x: 0, z: side * (R - 8.6) });
const RIMS = [Object.freeze({ x: 0, y: COURT.rimY, z: 1 * COURT.hoopZ }), Object.freeze({ x: 0, y: COURT.rimY, z: -1 * COURT.hoopZ })];
export const rimOf = side => { const i = sideIx(side); return i < 0 ? { x: 0, y: COURT.rimY, z: side * COURT.hoopZ } : RIMS[i]; };
