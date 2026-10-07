// Pose parameter vector. Positions are in character space (meters, authored for a 2.0 m athlete and
// scaled at runtime). Angles are radians. Character faces +Z, left = +X, origin on the floor.
export const P = {
  root: 0, pelvis: 3, spine: 6, chest: 9, neck: 12, head: 15, clavL: 18, clavR: 21,
  handL: 24, handR: 27, elbowL: 30, elbowR: 33, wristL: 36, wristR: 39,
  footL: 42, footR: 45, yawL: 48, yawR: 49, pitchL: 50, pitchR: 51, toeL: 52, toeR: 53,
  kneeL: 54, kneeR: 57, N: 60,
};
export const GROUP_SIZE = {
  root: 3, pelvis: 3, spine: 3, chest: 3, neck: 3, head: 3, clavL: 3, clavR: 3, handL: 3, handR: 3,
  elbowL: 3, elbowR: 3, wristL: 3, wristR: 3, footL: 3, footR: 3, yawL: 1, yawR: 1, pitchL: 1, pitchR: 1,
  toeL: 1, toeR: 1, kneeL: 3, kneeR: 3,
};
export const ANGLE_GROUPS = new Set(['pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'clavR', 'wristL', 'wristR', 'yawL', 'yawR', 'pitchL', 'pitchR', 'toeL', 'toeR']);
export const GROUPS = Object.keys(GROUP_SIZE);
const D = Math.PI / 180;

export function newPose() { return new Float32Array(P.N); }

// Neutral standing pose (reference 2.0 m athlete)
export function neutral(out = newPose()) {
  out.fill(0);
  out.set([0.235, 1.0, 0.04], P.handL); out.set([-0.235, 1.0, 0.04], P.handR);
  out.set([0.35, -0.2, -1], P.elbowL); out.set([-0.35, -0.2, -1], P.elbowR);
  out.set([0.125, 0.08, 0.0], P.footL); out.set([-0.125, 0.08, 0.0], P.footR);
  out[P.yawL] = 8 * D; out[P.yawR] = -8 * D;
  out.set([0.15, 0, 1], P.kneeL); out.set([-0.15, 0, 1], P.kneeR);
  out.set([0, 0, 6 * D], P.wristL); out.set([0, 0, -6 * D], P.wristR);
  return out;
}

// Convert authored key {group: [..] in degrees for angle groups} to a full vector + mask
export function compileKey(key, base) {
  const v = base ? base.slice() : neutral();
  const mask = new Float32Array(P.N);
  for (const [g, val] of Object.entries(key)) {
    if (!(g in P) || g === 'N') continue;
    const o = P[g], n = GROUP_SIZE[g], arr = Array.isArray(val) ? val : [val];
    for (let i = 0; i < n; i++) {
      v[o + i] = ANGLE_GROUPS.has(g) ? (arr[i] ?? 0) * D : (arr[i] ?? 0);
      mask[o + i] = 1;
    }
  }
  return { v, mask };
}

export function blendInto(out, src, w, mask) {
  if (w <= 0) return out;
  if (w >= 1 && !mask) { out.set(src); return out; }
  for (let i = 0; i < P.N; i++) {
    const k = mask ? w * mask[i] : w;
    if (k > 0) out[i] += (src[i] - out[i]) * k;
  }
  return out;
}

// Mirror a pose left↔right (x negated, yaw/roll negated)
export function mirror(out, src) {
  const swap = (a, b, n) => { for (let i = 0; i < n; i++) { const t = src[a + i]; out[a + i] = src[b + i]; out[b + i] = t; } };
  out.set(src);
  swap(P.clavL, P.clavR, 3); swap(P.handL, P.handR, 3); swap(P.elbowL, P.elbowR, 3); swap(P.wristL, P.wristR, 3);
  swap(P.footL, P.footR, 3); swap(P.yawL, P.yawR, 1); swap(P.pitchL, P.pitchR, 1); swap(P.toeL, P.toeR, 1); swap(P.kneeL, P.kneeR, 3);
  for (const g of ['handL', 'handR', 'elbowL', 'elbowR', 'footL', 'footR', 'kneeL', 'kneeR', 'root']) out[P[g]] = -out[P[g]];
  for (const g of ['pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'clavR', 'wristL', 'wristR']) { out[P[g] + 1] = -out[P[g] + 1]; out[P[g] + 2] = -out[P[g] + 2]; }
  for (const g of ['yawL', 'yawR']) out[P[g]] = -out[P[g]];
  return out;
}
