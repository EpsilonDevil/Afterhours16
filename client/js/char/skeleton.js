// Humanoid skeleton with build-driven proportions. Bind orientations are identity (world-aligned),
// character faces +Z, left side is +X. Arms are in a 40° A-pose in bind.
import { INCH } from '../sim/constants.js';

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'upperL', 'foreL', 'handL',
  'clavR', 'upperR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL', 'toeL',
  'thighR', 'shinR', 'footR', 'toeR',
];
export const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
export const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19];
export const ARM_ANGLE = 40 * Math.PI / 180;
// v0.4.7.5 qp3: how far the shoulder girdle rises when the arm goes straight up (the animator lifts the collarbone
// by this, and the simulation's standing reach includes it), as a share of height
export const OVERHEAD_LIFT = 0.025;
// Standing reach, from the model itself: the shoulder joint's height plus the overhead lift plus the arm to the
// fingertips (upper arm + forearm + hand). This is what contests, blocks and finishes measure against since qp3
// (it used to be 1.315 H scaled by the wingspan, a few percent longer than the arms on screen)
export function standingReach(d) {
  return d.hipY + d.spineLen + d.chestLen + d.clavY + 0.002 * d.H + OVERHEAD_LIFT * d.H + d.upperLen + d.foreLen + d.handLen;
}

// Build → body dimensions in meters. build: {height (in), weight (lb), wingspan (in)}
export function bodyDims(build) {
  const H = (build.height || 78) * INCH;
  const W = (build.weight || 210) * 0.4536;
  const WS = (build.wingspan || build.height + 3) * INCH;
  const bmi = W / (H * H);
  const girth = Math.max(0.86, Math.min(1.28, Math.sqrt(bmi / 23.5)));
  const muscle = Math.max(0.9, Math.min(1.2, 1 + (bmi - 24) * 0.03));
  // v0.4.7.5 qp3: the modeled wingspan is exactly the build's: fingertip to fingertip with the arms out level is
  // 2 × (shoulder + upper arm + forearm + hand), so the arm scale is solved from that, shoulder width included (it
  // used to be a flat ratio, and heavier, wider builds came out 2-3% longer than their wingspan)
  const shoulderX = 0.094 * H * Math.min(1.1, girth * 0.5 + 0.52);
  const armScale = Math.max(0.8, (WS / 2 - shoulderX) / (0.424 * H));
  const d = {
    H, W, WS, girth, muscle, armScale,
    hipY: 0.535 * H,
    spineLen: 0.075 * H, chestLen: 0.10 * H, neckLen: 0.115 * H, headLen: 0.05 * H,
    clavX: 0.022 * H, clavY: 0.097 * H, shoulderX,
    upperLen: 0.172 * H * armScale, foreLen: 0.148 * H * armScale, handLen: 0.104 * H * armScale,
    hipX: 0.05 * H * Math.min(1.1, girth), hipDrop: 0.03 * H,
    thighLen: 0.235 * H, shinLen: 0.23 * H, ankleY: 0.04 * H,
    footLen: 0.152 * H, toeFwd: 0.105 * H,
    headR: 0.063 * H,
  };
  d.reachStanding = standingReach(d);
  return d;
}

// Bind-pose local offsets (relative to parent joint), in meters.
export function bindOffsets(d) {
  const off = new Array(BONES.length);
  const s = Math.sin(ARM_ANGLE), c = Math.cos(ARM_ANGLE);
  off[B.hips] = [0, d.hipY, 0];
  off[B.spine] = [0, d.spineLen, -0.004 * d.H];
  off[B.chest] = [0, d.chestLen, 0];
  off[B.neck] = [0, d.neckLen, -0.006 * d.H];
  off[B.head] = [0, d.headLen, 0.006 * d.H];
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    off[B['clav' + side]] = [sg * d.clavX, d.clavY, -0.004 * d.H];
    off[B['upper' + side]] = [sg * (d.shoulderX - d.clavX), 0.002 * d.H, -0.004 * d.H];
    off[B['fore' + side]] = [sg * s * d.upperLen, -c * d.upperLen, 0];
    off[B['hand' + side]] = [sg * s * d.foreLen, -c * d.foreLen, 0];
    off[B['thigh' + side]] = [sg * d.hipX, -d.hipDrop, 0.004 * d.H];
    off[B['shin' + side]] = [0, -d.thighLen, 0.004 * d.H];
    off[B['foot' + side]] = [0, -d.shinLen, -0.006 * d.H];
    off[B['toe' + side]] = [0, -(d.hipY - d.hipDrop - d.thighLen - d.shinLen) + 0.012 * d.H, d.toeFwd];
  }
  return off;
}

// Bind-pose model-space joint positions.
export function bindPositions(off) {
  const pos = new Array(BONES.length);
  for (let i = 0; i < BONES.length; i++) {
    const p = PARENT[i];
    pos[i] = p < 0 ? off[i].slice() : [pos[p][0] + off[i][0], pos[p][1] + off[i][1], pos[p][2] + off[i][2]];
  }
  return pos;
}
