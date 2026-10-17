// v0.4.8.5 Big Brother (the Glass Cleaner Icon badge): the bodies of the Icon's Block Package, seven blocks of its own
// (sim/blocks.js BB_BLOCK_STYLES), and their landing gestures. Animator.blockPose / blockLanding hand them the same
// numbers the thirty get (c: u, air, up, up2; tx ty tz, the ball clamped; ld / tr / ls, its side; t) and b, the ball as
// it is. What makes them more than the Eraser's:
//   * the reach goes further. It goes for the ball where it is (out to 1.1 in front, 0.95 to the side, 3.0 up, where
//     the thirty stop at 0.55 / 0.6 / 2.75), the body thrown at it (leaned toward it, the lead shoulder turned to it)
//     and the arm's reach measured from where that shoulder really is in the lean, so at the contact the palm is on the
//     ball wherever an arm can get to it;
//   * the wind-up is huge (an arm cocked behind the head, two fists up over it, the back bowed), quicker than the
//     thirty's and done by 85% of the rise, so it never costs the reach;
//   * the swat after the contact (a.hitAt) is the whole body: the trunk snaps through, the legs swing, one spins round;
//   * each lands with a gesture of its own (the chest thump, the shove-away, the watching eyes, the shush, the stare
//     down, the crab flex, raising the roof).
// Positions are the animator's: character space, reference units (a 2 m athlete), +z in front, +x his left.
import { P } from './pose.js';
import { BLOCK_BY_ID } from '../sim/blocks.js';
import { BALL_R } from '../sim/constants.js';
import { qeuler, qmul, v3transformQuat } from '../core/math.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const L3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function set3(T, g, x, y, z) { const o = P[g]; T[o] = x; T[o + 1] = y; T[o + 2] = z; }
const put = (T, g, v) => set3(T, g, v[0], v[1], v[2]);
// (the same share of the arm's length as Animator.clampReach's REACH_K)
const REACH = 0.96;

// where his shoulder is (reference units) with the trunk as T has it: the rig's own chain (char/skeleton.js: hips, the
// spine joint 0.075 H up, the chest joint 0.10 H on, the collarbone and the shoulder), each turned by its pose angles
// (core/math.js qeuler, as Rig.solve applies them). The thirty measure the reach from an upright shoulder; a lean
// toward the ball takes the shoulder to it, and so does the reach here.
const qa = new Float32Array(4), qb = new Float32Array(4), qc = new Float32Array(4), qt = new Float32Array(4), vt = [0, 0, 0];
export function shoulderAt(an, T, side) {
  const d = an.view?.model?.d, k = d ? 2 / an.H : 1, sg = side === 'L' ? 1 : -1;
  const hipY = d ? d.hipY * k : 1.07, spL = d ? d.spineLen * k : 0.15, chL = d ? d.chestLen * k : 0.2;
  const cx = d ? d.clavX * k : 0.044, cy = d ? d.clavY * k : 0.194, sx = d ? d.shoulderX * k : 0.188, z0 = d ? 0.004 * d.H * k : 0.008;
  qeuler(qa, T[P.pelvis], T[P.pelvis + 1], T[P.pelvis + 2]);
  qmul(qb, qa, qeuler(qt, T[P.spine], T[P.spine + 1], T[P.spine + 2]));
  qmul(qc, qb, qeuler(qt, T[P.chest], T[P.chest + 1], T[P.chest + 2]));
  const p = [T[P.root], hipY + T[P.root + 1], T[P.root + 2]];
  const add = (q, x, y, z) => { vt[0] = x; vt[1] = y; vt[2] = z; v3transformQuat(vt, vt, q); p[0] += vt[0]; p[1] += vt[1]; p[2] += vt[2]; };
  add(qa, 0, spL, -z0); add(qb, 0, chL, 0); add(qc, sg * cx, cy, -z0); add(qc, sg * (sx - cx), 0.002 * 2, -z0);
  return p;
}
// the arm's reach (reference units, to the wrist, as clampReach)
function armReach(an) {
  const d = an.view?.model?.d, k = d ? 2 / an.H : 1;
  return (d ? (d.upperLen + d.foreLen + 0.5 * d.handLen) * k : 0.74) * REACH;
}
// a hand target kept within the arm's reach of the shoulder as the lean has it
function reachFrom(an, T, side, sh) {
  const i = P['hand' + side], R = armReach(an);
  const dx = T[i] - sh[0], dy = T[i + 1] - sh[1], dz = T[i + 2] - sh[2], dd = Math.hypot(dx, dy, dz);
  if (dd <= R || dd < 1e-6) return;
  const f = R / dd; T[i] = sh[0] + dx * f; T[i + 1] = sh[1] + dy * f; T[i + 2] = sh[2] + dz * f;
}

// The block. Every style: the lead wrist from the hand's start low at his side, through the wind-up (cock: where the
// style cocks it), onto the ball (the palm on it: the wrist just short of its middle, on the line to the shoulder), then
// the style's swat from the contact; the other hand, the legs and the trunk the style's own.
export function bigBroBlockPose(an, T, a, c) {
  const S = BLOCK_BY_ID[a.bstyle], id = S.id, E = S.emph / 1.5;
  const { air, up2, t } = c, u = c.u;
  // the ball as it is (his frame, reference units), further than the thirty's clamp
  const B = c.b;
  let bx = c.tx, by = c.ty, bz = c.tz;
  if (B) { bx = clamp(B[0], -0.95, 0.95); by = clamp(B[1], 1.55, 3.0); bz = clamp(B[2], -0.15, 1.1); }
  // (from the contact on, where it was then: the swat goes through that spot, not after the ball it sent flying)
  if (a.hit) { if (!a.bbAim) a.bbAim = [bx, by, bz]; [bx, by, bz] = a.bbAim; }
  // the lead side: the ball's, and from the contact on the one it went on (the swat, the spin and the gesture go that way)
  let ld = c.ld;
  if (a.hit) { if (!a.bbLd) a.bbLd = ld; ld = a.bbLd; }
  const ls = ld === 'L' ? 1 : -1, tr = ld === 'L' ? 'R' : 'L';
  a.ldUsed = ld;
  // the reach: straight at the ball over the first 36% of the air (preS); a cocked arm winds up over the first 20%,
  // holds, and fires at the ball between 25% and 36% (the contact is rarely before 38%: it is the swat that's late)
  const preS = sm(0, air * 0.36, u), wind = sm(0, air * 0.2, u), fire = sm(air * 0.25, air * 0.36, u);
  const pre = lerp(preS, fire, S.cock), rise = sm(0, air * 0.5, u), late = sm(air * 0.55, air * 0.95, u);
  const hitT = a.hitAt ?? ((a.jumpAt || 0) + air * 0.5), since = t - hitT;
  const sw = sm(0, 0.18, since) * (a.hit ? 1 : 0.55), swp = Math.sin(Math.PI * clamp(since / 0.22, 0, 1)) * (a.hit ? 1 : 0.55);
  const cockK = S.cock * wind * (1 - fire);
  // ---- the trunk: the style's lean and twist, plus the lean that takes the shoulder to the ball ----
  const adPitch = clamp((bz - 0.32) * 0.55, -0.06, 0.4) * pre, adRoll = clamp((Math.abs(bx) - 0.22) * 0.7, 0, 0.32) * pre;
  let pitch = adPitch, roll = adRoll, yaw = -ls * (0.15 + 0.3 * S.twist) * pre, cpitch = 0, head = -0.2 - 0.15 * pre;
  // ---- the hands' start (low at his sides) ----
  const start = [ls * 0.42, 1.05, 0.12], start2 = [-ls * 0.42, 1.05, 0.12];
  // the ball, the palm on it: the wrist short of its middle by a palm, toward the shoulder
  const sh0 = [ls * 0.19, 1.62, -0.02], two = S.lead === 'two', spread = S.spread ?? 0;
  const onBall = (off = 0) => { const p = [bx + off, by, bz], dx = sh0[0] - p[0], dy = sh0[1] - p[1], dz = sh0[2] - p[2], dl = Math.hypot(dx, dy, dz) || 1, g = BALL_R / (an.H / 2) * 0.55; return [p[0] + dx / dl * g, p[1] + dy / dl * g, p[2] + dz / dl * g]; };
  let hand = onBall(two ? ls * spread / 2 : 0), off = null, ePole = [ls * 0.8, -0.2, -0.45], oPole = [-ls * 0.9, -0.3, -0.4];
  let palmL = { normal: [ls * 0.25, 0.15, 1], fingers: [0, 1, 0.1], w: 0.9 * pre };
  const reachTo = (cock) => L3(L3(start, hand, preS), L3(L3(start, cock, wind), hand, fire), S.cock);
  switch (id) {
    case 'bb_tomahawk': {
      // cocked all the way back behind his head, the elbow pointing at the sky and the back arched, then over the top:
      // through the ball and on down across him to the far hip, the trunk crunching after it
      const ck = [ls * 0.16, 2.0, -0.44];
      let h = reachTo(ck);
      h = [h[0] - ls * 0.62 * sw, h[1] - 1.45 * sw * E, h[2] + 0.5 * swp + 0.14 * sw];
      hand = h; ePole = [ls * lerp(lerp(0.7, 0.45, cockK), 0.4, sw), lerp(lerp(-0.2, 1.4, cockK), -0.6, sw), lerp(lerp(-0.4, 0.4, cockK), 0.2, sw)];
      // (the other arm out at the ball while he's cocked, like a pitcher's glove arm; flung back down on the swat)
      off = L3(L3(start2, [-ls * 0.3, 1.78, 0.5], wind), [-ls * 0.6, lerp(1.05, 1.3, sw), lerp(-0.4, -0.15, sw)], Math.max(fire * 0.6, sw)); oPole = [-ls * 1, -0.2, lerp(0.2, -0.6, Math.max(fire, sw))];
      pitch += -0.45 * cockK * E + 0.55 * sw * E; cpitch = -0.15 * cockK + 0.18 * sw;
      yaw += ls * 0.45 * cockK - ls * 0.35 * sw; roll += 0.1 * cockK;
      head += -0.15 * cockK + 0.25 * sw;
      palmL = { normal: [ls * 0.2, lerp(0.3, -0.5, sw), 1], fingers: [0, lerp(1, 0.2, sw), lerp(0.1, 0.9, sw)], w: 0.9 };
      // a knee driven up on the lead side, the other leg trailing; both tucked on the swat
      set3(T, 'foot' + ld, ls * 0.13, 0.25 + 0.48 * rise + 0.1 * sw, 0.16 + 0.3 * rise);
      set3(T, 'foot' + tr, -ls * 0.13, 0.22 + 0.06 * rise + 0.25 * sw, -0.2 * rise + 0.1 * sw);
      set3(T, 'knee' + ld, ls * 0.2, 0.7, 1); set3(T, 'knee' + tr, -ls * 0.18, -0.1 + 0.5 * sw, 1);
      T[P.pitchL] = 0.7; T[P.pitchR] = 0.7;
      break;
    }
    case 'bb_volley_spike': {
      // bowed back like a volleyball hitter, both hands up behind his head and both heels kicked up behind him, then
      // spiked down through the ball together, the legs swinging through under him
      const ck = [ls * spread / 2, 2.12, -0.36];
      let h = reachTo(ck);
      h = [h[0], h[1] - 1.15 * sw * E, h[2] + 0.62 * sw + 0.15 * swp];
      hand = h; ePole = [ls * 0.8, lerp(lerp(-0.2, 0.9, cockK), -0.4, sw), lerp(-0.4, 0.3, sw)];
      off = [h[0] - ls * spread - ls * 0.02, h[1], h[2]]; oPole = [-ls * 0.8, lerp(lerp(-0.2, 0.9, cockK), -0.4, sw), lerp(-0.4, 0.3, sw)];
      const kb = rise * (1 - sw);
      pitch += -0.55 * cockK * E + 0.6 * sw * E; cpitch = -0.25 * cockK + 0.15 * sw; yaw *= 0.3;
      head += -0.2 * cockK + 0.3 * sw;
      palmL = { normal: [0, lerp(0.2, -0.6, sw), 1], fingers: [0, lerp(1, 0.3, sw), 0.6 * sw], w: 0.9 };
      an.palm[tr] = { normal: [0, lerp(0.2, -0.6, sw), 1], fingers: [0, lerp(1, 0.3, sw), 0.6 * sw], w: 0.85 * up2 };
      set3(T, 'footL', 0.14, 0.25 + 0.52 * kb + 0.2 * sw, -0.12 - 0.4 * kb + 0.32 * sw);
      set3(T, 'footR', -0.14, 0.25 + 0.5 * kb + 0.2 * sw, -0.12 - 0.38 * kb + 0.32 * sw);
      set3(T, 'kneeL', 0.2, lerp(-0.3, 0.5, sw), 1); set3(T, 'kneeR', -0.2, lerp(-0.3, 0.5, sw), 1);
      T[P.pitchL] = 0.8; T[P.pitchR] = 0.8;
      break;
    }
    case 'bb_glass_pin': {
      // full extension: the arm straight out at it like a hurdler going over, the off arm straight back, the palm
      // pressed flat on the ball and held there (pinned on the glass) before the arm comes down
      const press = sm(0, 0.07, since) * (a.hit ? 1 : 0.5), hold = 1 - sm(0.34, 0.52, since);
      let h = L3(start, onBall(0), pre);
      h = [h[0] + ls * 0.04 * press, h[1] + (0.1 * press) * hold - 0.75 * (1 - hold) * press, h[2] + 0.16 * press * hold + 0.1 * (1 - hold) * press];
      hand = h; ePole = [ls * 0.6, -0.4, -0.5];
      off = L3(start2, [-ls * 0.34, lerp(1.0, 1.15, press), -0.64], up2); oPole = [-ls * 0.4, -0.3, -1];
      pitch += 0.22 * rise * E; cpitch = -0.12 * pre; yaw += -ls * 0.12 * pre; roll += 0.06 * pre;
      head += -0.1 * pre;
      palmL = { normal: [ls * 0.1, 0.25, 1], fingers: [0, 1, -0.15], w: 0.95 * pre };
      // the lead side's knee up in front, the other leg out straight behind him
      set3(T, 'foot' + ld, ls * 0.13, 0.32 + 0.24 * rise, 0.08 + 0.42 * rise);
      set3(T, 'foot' + tr, -ls * 0.12, 0.3 + 0.26 * rise, -0.08 - 0.56 * rise);
      set3(T, 'knee' + ld, ls * 0.16, 0.7, 1); set3(T, 'knee' + tr, -ls * 0.16, -0.6, 1);
      T[P['pitch' + ld]] = 0.5; T[P['pitch' + tr]] = 0.85;
      break;
    }
    case 'bb_spin_swat': {
      // a short cock, then swatted hard across his body as he spins round with it (blockSpin turns him), the knees
      // tucked tight and the other arm flung out wide to lead the turn
      const ck = [ls * 0.6, 1.98, -0.12];
      let h = reachTo(ck);
      h = [h[0] - ls * 1.15 * sw * E, h[1] - 0.6 * sw * E, h[2] + 0.38 * swp + 0.05 * sw];
      hand = h; ePole = [ls * lerp(0.8, 0.2, sw), lerp(0.2, -0.6, sw), lerp(-0.4, 0.6, sw)];
      off = L3(start2, [-ls * lerp(0.48, 0.78, sw), lerp(1.55, 1.42, sw), lerp(0.18, -0.22, sw)], up2); oPole = [-ls * 1, -0.1, -0.4];
      yaw += ls * 0.3 * cockK - ls * 0.65 * sw; pitch += 0.12 * sw; roll += -0.08 * sw;
      palmL = { normal: [-ls * lerp(0.2, 1, sw), 0.1, lerp(1, 0.3, sw)], fingers: [0, lerp(1, 0.4, sw), 0.2], w: 0.9 };
      set3(T, 'foot' + ld, ls * 0.07, 0.3 + 0.36 * rise, 0.14);
      set3(T, 'foot' + tr, -ls * 0.08, 0.3 + 0.3 * rise, 0.02);
      set3(T, 'knee' + ld, ls * 0.12, 0.6, 1); set3(T, 'knee' + tr, -ls * 0.12, 0.55, 1);
      T[P.pitchL] = 0.75; T[P.pitchR] = 0.75;
      break;
    }
    case 'bb_chase_cannon': {
      // flattened out going after it: the arm fired straight out in front at it, the other flung back high behind him,
      // the legs split wide front and back (the far leg forward, the lead side's kicked up behind), then the hand fires
      // on through and down
      let h = L3(start, onBall(0), pre);
      h = [h[0] - ls * 0.1 * sw, h[1] - 0.85 * sw * E, h[2] + 0.38 * sw + 0.1 * swp];
      hand = h; ePole = [ls * 0.5, -0.5, -0.6];
      off = L3(start2, [-ls * 0.26, 1.82, -0.7], up2); oPole = [-ls * 0.5, 0.6, -1];
      pitch += 0.5 * rise * E + 0.15 * sw; cpitch = 0.08 * rise; yaw += -ls * 0.12 * pre;
      head += -0.35 * rise;
      palmL = { normal: [ls * 0.1, lerp(0.1, -0.4, sw), 1], fingers: [0, lerp(1, 0.4, sw), 0.3], w: 0.92 * pre };
      set3(T, 'foot' + tr, -ls * 0.12, 0.32 + 0.2 * rise, 0.06 + 0.5 * rise);
      set3(T, 'foot' + ld, ls * 0.12, 0.35 + 0.36 * rise, -0.06 - 0.5 * rise);
      set3(T, 'knee' + tr, -ls * 0.16, 0.6, 1); set3(T, 'knee' + ld, ls * 0.16, -0.2, 1);
      T[P['pitch' + tr]] = 0.45; T[P['pitch' + ld]] = 0.85;
      break;
    }
    case 'bb_sledgehammer': {
      // both fists clasped and swung up and back over his head like a sledgehammer, the knees out wide, then brought
      // down through the ball and all the way to his belt, the trunk crunching over it
      const ck = [ls * spread / 2, 2.2, -0.4];
      let h = reachTo(ck);
      h = [h[0], h[1] - 1.5 * sw * E, h[2] + 0.55 * swp + 0.18 * sw];
      hand = h; ePole = [ls * 0.9, lerp(lerp(-0.2, 1.0, cockK), -0.5, sw), lerp(-0.4, 0.1, sw)];
      off = [h[0] - ls * spread - ls * 0.05, h[1] - 0.02, h[2] + 0.02]; oPole = [-ls * 0.9, lerp(lerp(-0.2, 1.0, cockK), -0.5, sw), lerp(-0.4, 0.1, sw)];
      pitch += -0.42 * cockK * E + 0.7 * sw * E; cpitch = -0.18 * cockK + 0.22 * sw; yaw *= 0.25;
      head += -0.2 * cockK + 0.35 * sw;
      palmL = { normal: [-ls * 0.8, -0.2, 0.4], fingers: [0, lerp(1, -0.2, sw), lerp(0.1, 0.9, sw)], w: 0.85 };
      an.palm[tr] = { normal: [ls * 0.8, -0.2, 0.4], fingers: [0, lerp(1, -0.2, sw), lerp(0.1, 0.9, sw)], w: 0.85 * up2 };
      // frog legs: knees out wide, the soles together
      set3(T, 'footL', 0.1, 0.28 + 0.32 * rise, 0.1 + 0.06 * rise); set3(T, 'footR', -0.1, 0.28 + 0.32 * rise, 0.1 + 0.06 * rise);
      set3(T, 'kneeL', 1, 0.35, 0.55); set3(T, 'kneeR', -1, 0.35, 0.55);
      T[P.pitchL] = 0.6; T[P.pitchR] = 0.6;
      break;
    }
    case 'bb_backhand': {
      // drawn in high over his head with the body turned away, then the back of the hand whipped out through the ball
      // and away to the side as the body turns back with it; the other hand straight up, a second wall; the legs split
      // out wide to the sides
      const ck = [ls * 0.12, 2.1, 0.12];
      let h = reachTo(ck);
      h = [h[0] + ls * 1.15 * sw * E, h[1] - 0.75 * sw * E, h[2] + 0.2 * swp - 0.05 * sw];
      hand = h; ePole = [ls * 0.9, lerp(0.4, -0.2, sw), lerp(-0.3, -0.5, sw)];
      off = L3(start2, [-ls * 0.2, 2.3, 0.3], up2); oPole = [-ls * 0.9, -0.1, -0.4];
      yaw += ls * 0.55 * cockK + ls * 0.45 * sw; roll += 0.12 * pre - 0.1 * sw; pitch += 0.05;
      palmL = { normal: [-ls, 0.1, 0.25], fingers: [0, 1, 0.1], w: 0.9 * pre };
      an.palm[tr] = { normal: [0, 0.1, 1], fingers: [0, 1, 0], w: 0.8 * up2 };
      set3(T, 'footL', 0.13 + 0.42 * rise, 0.3 + 0.3 * rise, 0.06); set3(T, 'footR', -0.13 - 0.42 * rise, 0.3 + 0.3 * rise, 0.06);
      set3(T, 'kneeL', 1, 0.4, 0.5); set3(T, 'kneeR', -1, 0.4, 0.5);
      T[P.pitchL] = 0.8; T[P.pitchR] = 0.8;
      break;
    }
    default: break;
  }
  // the late air: everything eases toward the landing (the legs down under him)
  if (late > 0 && !['bb_spin_swat'].includes(id)) {
    for (const f of ['footL', 'footR']) { const i = P[f]; T[i + 1] = lerp(T[i + 1], 0.22, late * 0.7); T[i + 2] = lerp(T[i + 2], f === 'foot' + ld ? 0.06 : -0.04, late * 0.6); T[i] = lerp(T[i], f === 'footL' ? 0.15 : -0.15, late * 0.6); }
  }
  // the trunk (a roll toward his left is a negative spine roll: Rig.solve's qeuler)
  T[P.spine] = pitch; T[P.spine + 2] = -ls * roll * E; T[P.chest] = cpitch; T[P.chest + 1] = yaw; T[P.chest + 2] = -ls * 0.05 * pre;
  T[P.head] = head;
  // the hands, then their reach from where the shoulders are in the lean
  put(T, 'hand' + ld, hand); put(T, 'elbow' + ld, ePole);
  if (off) { put(T, 'hand' + tr, off); put(T, 'elbow' + tr, oPole); }
  reachFrom(an, T, ld, shoulderAt(an, T, ld)); reachFrom(an, T, tr, shoulderAt(an, T, tr));
  an.palm[ld] = palmL;
}

// The landing gestures: q2 s since he landed (blockLanding; the action has 0.8 s more for it, and wanting to move or
// jump ends it at once). Each eases in over a fifth of a second, holds and eases out by the end.
export function bigBroLanding(an, T, a, q2) {
  const S = BLOCK_BY_ID[a.bstyle];
  const ld = a.ldUsed || (a.lead === 'R' ? 'R' : 'L'), ls = ld === 'L' ? 1 : -1, tr = ld === 'L' ? 'R' : 'L';
  const k = sm(0.03, 0.2, q2) * (1 - sm(0.8, 0.95, q2));
  const stance = (w, st = 0) => { set3(T, 'footL', w, 0.08, st); set3(T, 'footR', -w, 0.08, -st); set3(T, 'kneeL', 0.4, 0, 1); set3(T, 'kneeR', -0.4, 0, 1); };
  const mixH = (side, v, w = k) => { const i = P['hand' + side]; T[i] = lerp(T[i], v[0], w); T[i + 1] = lerp(T[i + 1], v[1], w); T[i + 2] = lerp(T[i + 2], v[2], w); };
  switch (S.land) {
    case 'thump': {
      // the lead fist pounds his chest twice, then both arms thrown out wide and down, chest out, and the roar
      const beat = q2 > 0.08 && q2 < 0.44 ? Math.abs(Math.sin(Math.PI * (q2 - 0.08) / 0.18)) : 0, roar = sm(0.44, 0.56, q2);
      mixH(ld, L3([ls * 0.07, 1.4, 0.2 + 0.16 * beat], [ls * 0.78, 1.5, -0.06], roar));
      mixH(tr, L3([-ls * 0.34, 1.05, 0.1], [-ls * 0.78, 1.5, -0.06], roar));
      set3(T, 'elbow' + ld, ls * 1, lerp(-0.2, -0.6, roar), lerp(0.1, -0.3, roar)); set3(T, 'elbow' + tr, -ls * 1, -0.6, -0.3);
      an.palm[ld] = { normal: [-ls * 0.3, 0, -1], fingers: [-ls * 0.4, 0.2, 0.5], w: 0.8 * k * (1 - roar) };
      T[P.spine] = lerp(T[P.spine], lerp(0.04, -0.26, roar) - 0.03 * beat, k); T[P.chest] = lerp(T[P.chest], -0.2 * roar, k);
      T[P.head] = lerp(T[P.head], lerp(0.08, -0.5, roar), k); T[P.root + 1] -= 0.06 * k;
      if (k > 0.1) stance(0.24, 0.03);
      break;
    }
    case 'shove': {
      // both palms shoved out at the shooter, then the lead hand waves it off to the side ("get that out of here"),
      // the shoulders turned away
      const push = sm(0.04, 0.16, q2) * (1 - sm(0.36, 0.5, q2)), wave = sm(0.38, 0.62, q2);
      const flick = Math.sin(Math.PI * clamp((q2 - 0.4) / 0.3, 0, 1));
      mixH(ld, L3(L3([ls * 0.17, 1.36, 0.2], [ls * 0.2, 1.46, 0.74], push), [ls * (0.6 + 0.3 * flick), 1.4 + 0.15 * flick, 0.25 - 0.1 * flick], wave));
      mixH(tr, L3([-ls * 0.17, 1.36, 0.2], [-ls * 0.2, 1.46, 0.74], push));
      if (wave > 0) mixH(tr, [-ls * 0.32, 1.05, 0.12], wave * k);
      set3(T, 'elbow' + ld, ls * 0.8, -0.5, -0.4); set3(T, 'elbow' + tr, -ls * 0.8, -0.5, -0.4);
      an.palm[ld] = { normal: wave > 0.3 ? [ls * 0.6, 0, 0.5] : [0, 0.1, 1], fingers: wave > 0.3 ? [ls * 0.3, 0.6, 0.6] : [0, 1, 0.1], w: 0.9 * k };
      an.palm[tr] = { normal: [0, 0.1, 1], fingers: [0, 1, 0.1], w: 0.9 * k * (1 - wave) };
      T[P.spine] = lerp(T[P.spine], 0.22 * push, k); T[P.chest + 1] = lerp(T[P.chest + 1], ls * 0.35 * wave, k);
      T[P.head] = lerp(T[P.head], 0.1 * push - 0.05, k); T[P.head + 1] = -ls * 0.3 * wave * k;
      if (k > 0.1) stance(0.2, 0.08);
      break;
    }
    case 'watching': {
      // two fingers to his eyes, then pointed out at the shooter, twice: Big Brother is watching
      const eyes = q2 < 0.3 || (q2 > 0.52 && q2 < 0.66) ? 1 : 0, ptK = sm(0.28, 0.36, q2) * (1 - sm(0.5, 0.56, q2)) + sm(0.64, 0.72, q2);
      mixH(ld, L3([ls * 0.08, 1.8, 0.2], [ls * 0.14, 1.72, 0.86], clamp(ptK, 0, 1)));
      set3(T, 'elbow' + ld, ls * 0.8, -0.6, -0.1);
      an.palm[ld] = ptK > 0.5 ? { normal: [0, -1, 0.1], fingers: [0, 0, 1], w: 0.9 * k } : { normal: [0, 0, -1], fingers: [0, 1, 0.15], w: 0.9 * k * (eyes || 1) };
      mixH(tr, [-ls * 0.3, 1.02, 0.1]);
      T[P.head] = lerp(T[P.head], 0.14, k); T[P.spine] = lerp(T[P.spine], -0.04, k);
      if (k > 0.1) stance(0.17, 0.1);
      break;
    }
    case 'shush': {
      // the finger to his lips as he comes round (blockSpin turns the rest of the way on the landing)
      mixH(ld, [ls * 0.03, 1.66, 0.26]);
      set3(T, 'elbow' + ld, ls * 0.6, -1, 0.3);
      an.palm[ld] = { normal: [-ls, 0, 0.1], fingers: [0, 1, 0.15], w: 0.9 * k };
      mixH(tr, [-ls * 0.36, 1.0, 0.04]);
      T[P.head] = lerp(T[P.head], 0.06, k); T[P.head + 1] = -ls * 0.2 * k;
      if (k > 0.1) stance(0.15, 0.04);
      break;
    }
    case 'standover': {
      // a step in, standing over the spot the shooter came down on, bent over it staring down, the arms out wide
      const lean = k;
      const sway = Math.sin(q2 * 9) * 0.04 * k;
      mixH(ld, [ls * 0.7, 1.15 + sway, -0.18]); mixH(tr, [-ls * 0.7, 1.15 - sway, -0.18]);
      set3(T, 'elbow' + ld, ls * 1, -0.2, -0.4); set3(T, 'elbow' + tr, -ls * 1, -0.2, -0.4);
      an.palm[ld] = { normal: [0, 0.3, 1], fingers: [ls * 0.4, 0.2, 0.8], w: 0.7 * k }; an.palm[tr] = { normal: [0, 0.3, 1], fingers: [-ls * 0.4, 0.2, 0.8], w: 0.7 * k };
      T[P.spine] = lerp(T[P.spine], 0.55, lean); T[P.chest] = lerp(T[P.chest], 0.12, lean); T[P.head] = lerp(T[P.head], 0.5, lean); T[P.root + 1] -= 0.08 * lean; T[P.root + 2] += 0.08 * lean;
      if (k > 0.1) { set3(T, 'foot' + ld, ls * 0.2, 0.08, 0.46); set3(T, 'foot' + tr, -ls * 0.18, 0.08, -0.2); set3(T, 'knee' + ld, ls * 0.3, 0.3, 1); set3(T, 'knee' + tr, -ls * 0.3, 0, 1); }
      break;
    }
    case 'crabflex': {
      // knees bent, hunched, both fists together in front of his belly and the elbows flared high: the crab flex, shaking
      const sh = Math.sin(q2 * 42) * 0.015 * k;
      mixH(ld, [ls * 0.1, 1.02 + sh, 0.42]); mixH(tr, [-ls * 0.1, 1.02 - sh, 0.42]);
      set3(T, 'elbow' + ld, ls * 1, 0.75, 0.25); set3(T, 'elbow' + tr, -ls * 1, 0.75, 0.25);
      T[P.clavL + 2] += 0.25 * k; T[P.clavR + 2] -= 0.25 * k;
      an.palm[ld] = { normal: [-ls, 0.1, 0.1], fingers: [-ls * 0.3, -0.2, 1], w: 0.8 * k }; an.palm[tr] = { normal: [ls, 0.1, 0.1], fingers: [ls * 0.3, -0.2, 1], w: 0.8 * k };
      T[P.spine] = lerp(T[P.spine], 0.42, k); T[P.chest] = lerp(T[P.chest], 0.2, k); T[P.head] = lerp(T[P.head], -0.45, k);
      T[P.root + 1] -= 0.22 * k;
      if (k > 0.1) { stance(0.36, 0.02); set3(T, 'kneeL', 0.7, 0, 1); set3(T, 'kneeR', -0.7, 0, 1); }
      break;
    }
    case 'raise': {
      // raising the roof: both palms up over his head, pumping, looking up at the crowd
      const pump = Math.abs(Math.sin(Math.PI * Math.max(0, q2 - 0.1) / 0.2)) * sm(0.1, 0.18, q2);
      mixH(ld, [ls * 0.34, 2.0 + 0.2 * pump, 0.14]); mixH(tr, [-ls * 0.34, 2.0 + 0.2 * pump, 0.14]);
      set3(T, 'elbow' + ld, ls * 1, -0.2, -0.3); set3(T, 'elbow' + tr, -ls * 1, -0.2, -0.3);
      an.palm[ld] = { normal: [0, 1, 0.1], fingers: [-ls * 0.5, 0, 0.8], w: 0.9 * k }; an.palm[tr] = { normal: [0, 1, 0.1], fingers: [ls * 0.5, 0, 0.8], w: 0.9 * k };
      T[P.spine] = lerp(T[P.spine], -0.12, k); T[P.head] = lerp(T[P.head], -0.42, k); T[P.root + 1] += 0.025 * pump * k;
      if (k > 0.1) stance(0.2, 0.0);
      break;
    }
    default: break;
  }
}
