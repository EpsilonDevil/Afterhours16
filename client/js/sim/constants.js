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

// v0.4.5 out of bounds, regulation style: the court's measurements run to the INSIDE edge of the painted
// boundary lines, which are 2" (5.08 cm) wide and are themselves out of bounds. A ball touching the floor on or
// past a line is out (its floor contact is right under its center); a player is out as soon as a foot touches
// a line (feet reach about 12 cm from his center). Half-court games use the painted half-court line, drawn just
// outside the half that's in play, as their back boundary.
export const LINE_W = 0.0508;
export const FOOT_R = 0.12;
export function ballOut(x, z, half = false) {
  return Math.abs(x) >= COURT.width / 2 || Math.abs(z) >= COURT.length / 2 || (half && z <= 0);
}
export function feetOut(x, z, half = false) {
  return Math.abs(x) + FOOT_R >= COURT.width / 2 || Math.abs(z) + FOOT_R >= COURT.length / 2 || (half && z - FOOT_R <= 0);
}
