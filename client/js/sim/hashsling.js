// v0.4.7.5 quick patch (qp3): the Hash-Slinging dunk package. The Slasher's Icon badge unlocks a package nobody can
// buy: six long streetball finishes (two passes of the ball round the body in the air, back-arched reverses, full
// turns with the ball between the legs) that put most defenders flat on their back. Nothing here imports the sim, so
// shots.js (the body spin), game.js (the ball's path, the poster) and the animator (the body) all read from it.
//
// Timing: every finish runs on k, the share of the way from HS_TIMING.pre seconds before the takeoff (the last gather
// step, where the wind-up starts) to the slam. The slam itself is held past the apex (the dunker is still above the
// rim on the way down), so the flight is ~0.6 s instead of ~0.45 s: the room these need.

export const HS_PKG = 'dunk_hash_slinging';
export const HS_TIMING = { pre: 0.15, hang: 0.6, hangOnRim: 0.6, hangOnRimR: 0.35 };
// the poster: the dunker wins the contact on the way up at least this often, and the man he finishes over goes
// flat on his back this often (more against a weaker defender), for dur0 + up to durR seconds
export const HS_POSTER = { pc: 0.88, fall: 0.85, fallStr: 0.1, fallMin: 0.6, fallMax: 0.97, dur0: 3.1, durR: 0.7, push: 1.3, reach: 1.4, ahead: -0.3 };

const sstep = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const clamp01 = x => Math.max(0, Math.min(1, x));
// eased key path: keys [k, x (m, + = his left), y (×H), z (m, + = ahead)] in the BODY frame (the spin, if any, turns
// the body and the ball together); 'TOP' for y is the slam height
export function hsKeyPath(keys, k, H, topY) {
  let i = 1;
  while (i < keys.length - 1 && k > keys[i][0]) i++;
  const a = keys[i - 1], b = keys[i], u = clamp01((k - a[0]) / Math.max(1e-6, b[0] - a[0])), e = u * u * (3 - 2 * u);
  const ya = a[2] === 'TOP' ? topY : a[2] * H, yb = b[2] === 'TOP' ? topY : b[2] * H;
  return [a[1] + (b[1] - a[1]) * e, ya + (yb - ya) * e, a[3] + (b[3] - a[3]) * e];
}

// Each style: name, what it looks like (store / notes), the ball's keys, which hand has it (by k; 'B' = both), the
// body turn [k0, k1, turns], and the callout.
export const HS_STYLES = {
  hs_lostcause: {
    name: 'Lost Cause', callout: 'LOST CAUSE!',
    desc: 'Between the legs front to back, around the back to the other hand, then a one-hand tomahawk over the top.',
    keys: [[0, -0.2, 0.62, 0.3], [0.14, -0.14, 0.46, 0.18], [0.26, 0.0, 0.36, 0.0], [0.36, 0.17, 0.42, -0.14], [0.48, 0.03, 0.5, -0.26], [0.6, -0.22, 0.52, -0.16], [0.74, -0.32, 0.84, -0.02], [0.88, -0.1, 1.08, 0.18], [1, -0.04, 'TOP', 0.5]],
    hands: [[0.31, 'R'], [0.54, 'L'], [1, 'R']], spin: null,
  },
  hs_stinger: {
    name: 'Stinger', callout: 'STINGER!',
    desc: 'Half turn, the ball taken over the head and down behind the back, then flicked backward over the head into the rim with the heels kicked up behind.',
    keys: [[0, -0.1, 0.64, 0.3], [0.2, 0.0, 0.9, 0.22], [0.34, 0.0, 1.06, -0.02], [0.48, 0.0, 0.76, -0.3], [0.6, 0.0, 0.62, -0.28], [0.74, 0.0, 0.84, -0.36], [0.88, 0.0, 1.06, -0.4], [1, 0.0, 'TOP', -0.5]],
    hands: [[1, 'B']], spin: [0.12, 0.62, 0.5],
  },
  hs_doubledip: {
    name: 'Double Dip', callout: 'DOUBLE DIP!',
    desc: 'Through the legs twice: right hand to left under the right thigh, around the outside, left hand to right under the left, then up and in.',
    keys: [[0, -0.2, 0.62, 0.3], [0.1, -0.12, 0.46, 0.16], [0.2, 0.0, 0.36, 0.0], [0.3, 0.19, 0.44, -0.12], [0.42, 0.26, 0.5, 0.16], [0.54, 0.0, 0.36, -0.02], [0.64, -0.21, 0.46, -0.14], [0.78, -0.3, 0.82, 0.0], [0.9, -0.14, 1.08, 0.22], [1, -0.04, 'TOP', 0.5]],
    hands: [[0.25, 'R'], [0.58, 'L'], [1, 'R']], spin: null,
  },
  hs_backdoormill: {
    name: 'Backdoor Mill', callout: 'BACKDOOR MILL!',
    desc: 'Around the back to the left hand, straight into a full left-arm windmill.',
    keys: null, // (its own path: the wrap, then a circle round the left shoulder)
    hands: [[0.36, 'R'], [1, 'L']], spin: null,
  },
  hs_cradlespin: {
    name: 'Cradle Spin', callout: 'CRADLE SPIN!',
    desc: 'A full turn with the ball rocked out wide in the right elbow, switched to the left hand at the top.',
    keys: [[0, -0.24, 0.6, 0.3], [0.15, -0.42, 0.56, 0.12], [0.35, -0.44, 0.9, 0.08], [0.52, -0.42, 0.58, 0.12], [0.7, -0.4, 0.98, 0.1], [0.84, -0.1, 1.08, 0.3], [1, 0.06, 'TOP', 0.5]],
    hands: [[0.8, 'R'], [1, 'L']], spin: [0.1, 0.86, 1],
  },
  hs_sling: {
    name: 'The Hash Sling', callout: 'HASH SLING!',
    desc: 'Between the legs in the middle of a full turn, carried up the far side and slung in left-handed. The package\'s own.',
    keys: [[0, -0.2, 0.62, 0.3], [0.16, -0.14, 0.5, 0.2], [0.3, -0.06, 0.4, 0.08], [0.42, 0.0, 0.36, -0.02], [0.54, 0.16, 0.44, -0.16], [0.68, 0.3, 0.7, -0.04], [0.84, 0.22, 1.02, 0.18], [1, 0.06, 'TOP', 0.5]],
    hands: [[0.46, 'R'], [1, 'L']], spin: [0.08, 0.82, 1],
  },
};
export const HS_IDS = Object.keys(HS_STYLES);
export const isHS = st => !!(st && HS_STYLES[st]);
export const hsName = st => HS_STYLES[st]?.name || null;
export const hsCallout = st => HS_STYLES[st]?.callout || null;

// k for a dunk action: 0 at HS_TIMING.pre before the takeoff, 1 at the slam (clamped)
export function hsK(a) {
  if (!a) return 0;
  const t0 = (a.takeoff || 0) - HS_TIMING.pre, t1 = a.slam || 1;
  return clamp01((a.t - t0) / Math.max(0.1, t1 - t0));
}
export function hsHand(st, k) {
  const s = HS_STYLES[st];
  if (!s) return 'R';
  for (const [until, h] of s.hands) if (k < until) return h;
  return s.hands[s.hands.length - 1][1];
}
// body turn in radians at k (positive = spinDir)
export function hsSpin(st, k, dir = 1) {
  const s = HS_STYLES[st];
  if (!s || !s.spin) return 0;
  const [k0, k1, turns] = s.spin, u = clamp01((k - k0) / Math.max(0.05, k1 - k0));
  return dir * turns * Math.PI * 2 * u * u * u * (u * (u * 6 - 15) + 10);
}
// the ball in the body frame at k. topY: the slam height; arm: Player.arm (for the mill's circle)
export function hsPath(st, k, H, topY, arm) {
  const s = HS_STYLES[st];
  if (!s) return [0, 0.65 * H, 0.3];
  if (st === 'hs_backdoormill') {
    // the wrap: front right, behind the waist, front left (right hand to left), at the hip
    if (k < 0.38) {
      const u = sstep(k / 0.38), phi = -Math.PI / 3 - (4 * Math.PI / 3) * u, R = 0.36;
      return [R * Math.sin(phi), (0.55 + 0.04 * u) * H, R * Math.cos(phi)];
    }
    // the mill: a circle round the LEFT shoulder at arm's length (the right arm's circle, mirrored), from low in
    // front down past the hip, behind, over the top and down in front at the rim
    const A = arm || { shoulderY: 0.806 * H, shoulderX: 0.1 * H, z: -0.012 * H, len: 0.33 * H };
    const reach = (A.len + 0.055 * H) * 0.97, cx = A.shoulderX + 0.03 * H, cy = A.shoulderY + 0.0125 * H, cz = A.z;
    const u = sstep((k - 0.38) / 0.56), al = -0.38 * Math.PI - 1.22 * Math.PI * u; // (ends high in front, just past the top)
    const x = cx, y = cy + reach * Math.sin(al), z = cz + reach * Math.cos(al);
    const f = sstep((k - 0.9) / 0.1);
    return [x * (1 - f) + 0.06 * f, y + (topY - y) * f, z + (0.5 - z) * f];
  }
  return hsKeyPath(s.keys, k, H, topY);
}
