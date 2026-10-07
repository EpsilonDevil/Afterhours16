// Court spots relative to the attacking side (+1 attacks +Z rim, -1 attacks -Z rim).
import { COURT } from './constants.js';

const R = COURT.hoopZ;
// Offensive spots expressed as (x, distance-from-baseline-side rim z offset), mirrored by side.
const SPOTS = {
  top: [0, R - 7.9], wingL: [5.3, R - 5.6], wingR: [-5.3, R - 5.6], cornerL: [6.75, R - 0.3], cornerR: [-6.75, R - 0.3],
  elbowL: [2.45, R - 4.6], elbowR: [-2.45, R - 4.6], blockL: [2.1, R - 1.2], blockR: [-2.1, R - 1.2], dunkL: [2.9, R + 0.4], dunkR: [-2.9, R + 0.4],
  slotL: [2.9, R - 7.3], slotR: [-2.9, R - 7.3],
};
export const FORMATIONS = {
  1: [['top']],
  2: [['top', 'wingL'], ['top', 'cornerR']],
  3: [['top', 'wingL', 'blockR'], ['slotR', 'wingL', 'dunkR'], ['top', 'cornerL', 'elbowR']],
  4: [['top', 'wingL', 'cornerR', 'blockL'], ['slotL', 'slotR', 'cornerL', 'dunkR']],
  5: [['top', 'wingL', 'wingR', 'blockL', 'elbowR'], ['top', 'wingL', 'cornerR', 'blockR', 'dunkL'], ['slotL', 'wingR', 'cornerL', 'elbowL', 'blockR']],
};
export function spot(name, side) {
  const s = SPOTS[name] || SPOTS.top;
  return { x: s[0] * side, z: s[1] * side };
}
export function spotsFor(count, side, variant = 0) {
  const sets = FORMATIONS[Math.max(1, Math.min(5, count))];
  const set = sets[variant % sets.length];
  return set.map(n => ({ name: n, ...spot(n, side) }));
}
export const CHECK_SPOT = side => ({ x: 0, z: side * (R - 8.6) });
export const rimOf = side => ({ x: 0, y: COURT.rimY, z: side * COURT.hoopZ });
