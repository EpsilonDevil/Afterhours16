// Regulation-style court geometry in meters. Court long axis = Z, rims at ±hoopZ, y up.
export const COURT = {
  length: 28.65, width: 15.24,
  hoopZ: 12.725, rimY: 3.05, rimR: 0.2286, rimTube: 0.0095,
  boardZ: 13.105, boardW: 1.83, boardH: 1.07, boardBottom: 2.9, boardT: 0.05,
  keyWidth: 4.88, ftDist: 5.79, ftRadius: 1.83,
  threeRadius: 7.24, cornerThree: 6.71, restricted: 1.22, centerRadius: 1.83,
};
export const BALL_R = 0.1194;
export const GRAVITY = 9.81;
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

// Rim center for a side (+1 / -1)
export const rimPos = side => ({ x: 0, y: COURT.rimY, z: side * COURT.hoopZ });

// Is (x,z) beyond the three-point line for the rim on `side`?
export function isThree(x, z, side) {
  const rz = side * COURT.hoopZ;
  const dz = (z - rz) * side; // positive = toward baseline
  const d = Math.hypot(x, z - rz);
  const cornerZone = dz > -Math.sqrt(COURT.threeRadius ** 2 - COURT.cornerThree ** 2);
  if (cornerZone && Math.abs(x) >= COURT.cornerThree) return true;
  if (cornerZone) return false;
  return d >= COURT.threeRadius;
}
export function inBounds(x, z, pad = 0) {
  return Math.abs(x) <= COURT.width / 2 + pad && Math.abs(z) <= COURT.length / 2 + pad;
}
export const INCH = 0.0254;
export const LB = 0.4536;
