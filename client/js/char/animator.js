// Procedural animation driven by the simulation: velocity-matched gait with planted feet,
// stance blending, ball-hand IK, and timed action bodies (jumpshots, layups, dunks, passes, defense).
import { P, GROUP_SIZE, neutral, newPose } from './pose.js';
import { COURT, BALL_R } from '../sim/constants.js';
import { dunkSpin, layupHand } from '../sim/shots.js';
import { MOVE_STYLE } from '../sim/moves.js';

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const D = Math.PI / 180;
const TAU = Math.PI * 2;

// v0.4.5 stage 7: dunks finished with one hand, and which hand has it at a given moment
const ONE_HAND_DUNK = new Set(['onehand', 'tomahawk', 'windmill', 'cradle', 'reverse', 'hammer', 'liberty', 'scoop', 'switch', 'eastbay', 'hashsling', 'bully', 'aroundback', 'superman',
  'sidemill', 'backscratch', 'spinmill', 'kneeup', 'crossleg', 'helicopter', 'behindhead', 'hurdle', 'jackknife']);
// the hand a layup is finished with: the far hand when he takes it away from a defender (side) or around a shot
// blocker (rim); otherwise the right
export { layupHand }; // (shots.js: the sim needs it too, to keep the ball where that hand can reach)
// collarbone roll that raises the shoulder joint by ARM_LIFT (0.025H) over the 0.072H collarbone-to-shoulder span
const CLAV_LIFT = Math.asin(0.025 / 0.072);
export function dunkHand(a) {
  const q = a.t / Math.max(0.1, a.slam || 1);
  const air = (a.t - (a.takeoff || 0)) / Math.max(0.1, (a.slam || 1) - (a.takeoff || 0)); // (the Eastbay is timed on the flight)
  return (a.style === 'switch' && q > 0.57) || (a.style === 'eastbay' && air > 0.4) || (a.style === 'aroundback' && q > 0.5) || (a.style === 'behindhead' && q > 0.55) ? 'L' : 'R';
}

// v0.4.7.5 ankle-breaker victims (q: share of the stumble, dir: the side he's thrown to)
const ANKLE_POSE = {
  // straight down onto the seat of his pants, hands back to catch himself, then back up
  sit: (T, q) => { const down = sm(0.05, 0.3, q) * (1 - sm(0.72, 1, q)); T[P.root + 1] = -0.82 * down; T[P.root + 2] = -0.25 * down; set3(T, 'footL', 0.2, 0.08, 0.35 * down + 0.05); set3(T, 'footR', -0.22, 0.08, 0.5 * down); set3(T, 'handL', 0.35, 0.15 + 0.85 * (1 - down), -0.25 * down); set3(T, 'handR', -0.35, 0.15 + 0.85 * (1 - down), -0.25 * down); T[P.spine] = 0.1 - 0.2 * down; T[P.pelvis] = -0.4 * down; T[P.head] = -0.2 * down; },
  // the plant foot slips out sideways and he goes down on one hip with a hand on the floor
  slip: (T, q, d) => { const down = sm(0.04, 0.25, q) * (1 - sm(0.75, 1, q)), o = d > 0 ? 'L' : 'R', n = d > 0 ? 'R' : 'L'; T[P.root + 1] = -0.62 * down; T[P.root] = d * 0.25 * down; set3(T, 'foot' + o, d * (0.2 + 0.5 * down), 0.08, 0.1); set3(T, 'foot' + n, -d * 0.16, 0.08, -0.05); set3(T, 'hand' + o, d * (0.4 + 0.2 * down), 1.0 - 0.85 * down, 0.0); set3(T, 'hand' + n, -d * 0.5, 1.4, 0.1); T[P.spine + 2] = d * 0.4 * down; T[P.head + 2] = -d * 0.2 * down; },
  // ankles crossed: he wobbles on one leg, arms out for balance, hopping to stay up
  tangle: (T, q, d, t) => { const k = Math.sin(q * Math.PI), w = Math.sin(t * 16) * k; set3(T, 'footL', -0.04, 0.08 + Math.max(0, w) * 0.12, 0.04); set3(T, 'footR', 0.04, 0.08 + Math.max(0, -w) * 0.12, -0.02); T[P.root] = 0.08 * w; T[P.spine + 2] = 0.25 * w; set3(T, 'handL', 0.7, 1.4 + 0.2 * w, 0.0); set3(T, 'handR', -0.7, 1.4 - 0.2 * w, 0.0); set3(T, 'elbowL', 1, 0, -0.3); set3(T, 'elbowR', -1, 0, -0.3); T[P.root + 1] = -0.1 * k; },
  // the legs go out from under him in a split
  split: (T, q) => { const dn = sm(0.04, 0.28, q) * (1 - sm(0.72, 1, q)); T[P.root + 1] = -0.68 * dn; set3(T, 'footL', 0.2 + 0.45 * dn, 0.08, 0.02); set3(T, 'footR', -0.2 - 0.45 * dn, 0.08, 0.0); set3(T, 'kneeL', 1, 0, 0.3); set3(T, 'kneeR', -1, 0, 0.3); set3(T, 'handL', 0.3, 0.6 - 0.2 * dn, 0.3); set3(T, 'handR', -0.3, 0.6 - 0.2 * dn, 0.3); T[P.spine] = 0.3 * dn; },
  // leans hard the wrong way and has to throw out a step to stay up
  lean: (T, q, d) => { const k = Math.sin(q * Math.PI); T[P.root + 1] = -0.25 * k; T[P.spine + 2] = d * 0.4 * k; T[P.root] = d * 0.15 * k; set3(T, d > 0 ? 'footL' : 'footR', d * 0.42 * k + (d > 0 ? 0.12 : -0.12), 0.08, -0.1); set3(T, 'handL', 0.5, 1.1 + 0.3 * k, 0.1); set3(T, 'handR', -0.5, 1.1 + 0.3 * k, 0.1); },
  // staggers backwards three steps, arms windmilling
  stagger: (T, q, d, t) => { const k = Math.sin(q * Math.PI), st2 = Math.sin(t * 13); T[P.spine] = -0.28 * k; T[P.head] = 0.2 * k; T[P.root + 1] = -0.1 * k; set3(T, 'footL', 0.15, 0.08 + Math.max(0, st2) * 0.1 * k, -0.2 * k); set3(T, 'footR', -0.15, 0.08 + Math.max(0, -st2) * 0.1 * k, -0.05 * k); set3(T, 'handL', 0.5 + 0.2 * Math.cos(t * 9), 1.5 + 0.3 * Math.sin(t * 9), 0.0); set3(T, 'handR', -0.5 - 0.2 * Math.cos(t * 9 + 2), 1.5 + 0.3 * Math.sin(t * 9 + 2), 0.0); },
  // spun round (the sim turns him): arms flung out, low
  spun: (T, q) => { const k = Math.sin(q * Math.PI); T[P.root + 1] = -0.2 * k; T[P.spine] = 0.15 * k; set3(T, 'handL', 0.7, 1.3, -0.1); set3(T, 'handR', -0.7, 1.25, -0.1); set3(T, 'elbowL', 1, 0, -0.4); set3(T, 'elbowR', -1, 0, -0.4); set3(T, 'footL', 0.26, 0.08, 0.04); set3(T, 'footR', -0.26, 0.08, -0.04); },
  // lunges at the stepback and falls forward onto his hands
  faceplant: (T, q) => { const dn = sm(0.06, 0.3, q) * (1 - sm(0.75, 1, q)); T[P.root + 1] = -0.55 * dn; T[P.root + 2] = 0.2 * dn; T[P.spine] = 0.2 + 0.7 * dn; T[P.head] = -0.3 * dn; set3(T, 'handL', 0.3, 1.0 - 0.9 * dn, 0.3 + 0.35 * dn); set3(T, 'handR', -0.3, 1.0 - 0.9 * dn, 0.3 + 0.35 * dn); set3(T, 'footL', 0.16, 0.08, -0.3 * dn); set3(T, 'footR', -0.16, 0.08 + 0.1 * dn, -0.5 * dn); },
  // drops to one knee
  knee: (T, q, d) => { const dn = sm(0.05, 0.25, q) * (1 - sm(0.75, 1, q)), kn = d > 0 ? 'R' : 'L', up = d > 0 ? 'L' : 'R'; T[P.root + 1] = -0.48 * dn; set3(T, 'foot' + up, (up === 'L' ? 1 : -1) * 0.16, 0.08, 0.25 * dn); set3(T, 'foot' + kn, (kn === 'L' ? 1 : -1) * 0.16, 0.08, -0.35 * dn); set3(T, 'knee' + up, (up === 'L' ? 1 : -1) * 0.2, 0.5, 1); set3(T, 'hand' + up, (up === 'L' ? 1 : -1) * 0.25, 0.8, 0.3); set3(T, 'hand' + kn, (kn === 'L' ? 1 : -1) * 0.35, 0.3 + 0.7 * (1 - dn), 0.1); T[P.spine] = 0.2 * dn; },
};

// v0.4.7.5 movement styles: stride (step length), lift (swing-foot height), crouch/wide (stance), bounce (extra bob),
// sway (shoulder swing), lean (forward), chest (puffed out < 0), head (up < 0) and tilt, nod (head bob per step), arms
// (swing size) and armOut (how wide they hang)
const G0 = { stride: 1, lift: 1, crouch: 0, wide: 0, bounce: 0, sway: 0, lean: 0, chest: 0, head: 0, tilt: 0, nod: 0, arms: 1, armOut: 0 };
export const MOVE_GAIT = {
  standard: G0,
  smooth: { ...G0, stride: 1.1, lift: 0.8, arms: 0.8, sway: 0.06, head: -0.04 },
  bouncy: { ...G0, lift: 1.45, bounce: 0.07, nod: 0.08, arms: 1.15 },
  swagger: { ...G0, stride: 0.94, sway: 0.24, armOut: 0.1, arms: 1.25, lean: -0.06, tilt: 0.1 },
  heavy: { ...G0, stride: 0.88, crouch: -0.05, wide: 0.07, bounce: 0.035, lean: 0.08, arms: 0.75, armOut: 0.07 },
  shifty: { ...G0, stride: 0.78, lift: 0.75, crouch: -0.06, arms: 0.65, nod: 0.04, wide: 0.03 },
  upright: { ...G0, lean: -0.22, head: -0.22, chest: -0.08, arms: 0.8 },
  hunched: { ...G0, lean: 0.26, head: 0.22, chest: 0.12, arms: 0.75 },
  loose: { ...G0, arms: 1.9, armOut: 0.1, sway: 0.12, nod: 0.04 },
  strut: { ...G0, chest: -0.18, lean: -0.06, lift: 1.65, arms: 0.55, sway: 0.1, head: -0.1 },
  glide: { ...G0, stride: 1.22, lift: 0.7, bounce: -0.02, arms: 0.9, crouch: -0.02 },
  sprinter: { ...G0, lift: 1.75, arms: 1.75, lean: 0.11 },
  laidback: { ...G0, lean: -0.2, stride: 0.95, arms: 0.55, sway: 0.06, tilt: -0.1, head: 0.04 },
};

// v0.4.7.5 dunk legs in the air (up: share of the way to the slam) and the trunk [spine, chest, head]
const DUNK_LEGS2 = {
  twomill: T => { set3(T, 'footL', 0.26, 0.3, -0.12); set3(T, 'footR', -0.26, 0.3, -0.12); set3(T, 'kneeL', 0.6, 0, 1); set3(T, 'kneeR', -0.6, 0, 1); T[P.pitchL] = 0.75; T[P.pitchR] = 0.75; },
  sidemill: T => { set3(T, 'footR', -0.34, 0.56, 0.12); set3(T, 'kneeR', -1, 0.4, 0.4); set3(T, 'footL', 0.1, 0.16, -0.06); T[P.pitchL] = 0.85; T[P.pitchR] = 0.5; },
  backscratch: T => { set3(T, 'footL', 0.07, 0.12, -0.12); set3(T, 'footR', -0.07, 0.12, -0.14); set3(T, 'kneeL', 0.1, -0.4, 1); set3(T, 'kneeR', -0.1, -0.4, 1); T[P.pitchL] = 1; T[P.pitchR] = 1; },
  rev360: T => { set3(T, 'footR', -0.12, 0.42, 0.34); set3(T, 'kneeR', -0.12, 0.3, 1); set3(T, 'footL', 0.12, 0.3, -0.36); set3(T, 'kneeL', 0.12, -0.2, 1); T[P.pitchL] = 0.9; T[P.pitchR] = 0.5; },
  spinmill: T => { set3(T, 'footL', 0.12, 0.44, -0.04); set3(T, 'footR', -0.12, 0.42, -0.06); set3(T, 'kneeL', 0.25, 0, 1); set3(T, 'kneeR', -0.25, 0, 1); T[P.pitchL] = 0.75; T[P.pitchR] = 0.75; },
  pump: (T, up) => { const b = Math.abs(Math.sin(2 * Math.PI * Math.min(1, up / 0.74))); set3(T, 'footL', 0.14, 0.28 + 0.14 * b, 0.05 - 0.3 * b); set3(T, 'footR', -0.14, 0.28 + 0.12 * b, 0.05 - 0.28 * b); set3(T, 'kneeL', 0.3, 0, 1); set3(T, 'kneeR', -0.3, 0, 1); T[P.pitchL] = 0.75; T[P.pitchR] = 0.75; },
  kneeup: T => { set3(T, 'footR', -0.1, 0.78, 0.26); set3(T, 'kneeR', -0.1, 0.5, 1); set3(T, 'footL', 0.1, 0.1, -0.04); set3(T, 'kneeL', 0.1, -0.2, 1); T[P.pitchL] = 0.9; T[P.pitchR] = 0.4; },
  crossleg: T => { set3(T, 'footL', -0.1, 0.34, 0.04); set3(T, 'footR', 0.1, 0.36, 0.0); set3(T, 'kneeL', 0.3, 0.2, 1); set3(T, 'kneeR', -0.3, 0.2, 1); T[P.pitchL] = 0.8; T[P.pitchR] = 0.8; },
  helicopter: T => { set3(T, 'footL', 0.07, 0.16, -0.16); set3(T, 'footR', -0.07, 0.16, -0.18); set3(T, 'kneeL', 0.08, -0.4, 1); set3(T, 'kneeR', -0.08, -0.4, 1); T[P.pitchL] = 0.95; T[P.pitchR] = 0.95; },
  behindhead: T => { set3(T, 'footL', 0.08, 0.36, 0.06); set3(T, 'footR', -0.08, 0.36, 0.06); set3(T, 'kneeL', 1, 0.2, 0.4); set3(T, 'kneeR', -1, 0.2, 0.4); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; },
  cannonball: T => { set3(T, 'footL', 0.1, 0.58, 0.24); set3(T, 'footR', -0.1, 0.6, 0.24); set3(T, 'kneeL', 0.16, 0.6, 1); set3(T, 'kneeR', -0.16, 0.6, 1); T[P.pitchL] = 0.5; T[P.pitchR] = 0.5; },
  splits: T => { set3(T, 'footL', 0.52, 0.44, 0.04); set3(T, 'footR', -0.52, 0.44, 0.04); set3(T, 'kneeL', 1, 0.3, 0.2); set3(T, 'kneeR', -1, 0.3, 0.2); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; },
  hurdle: T => { set3(T, 'footR', -0.1, 0.52, 0.6); set3(T, 'kneeR', -0.1, 0.2, 1); set3(T, 'footL', 0.16, 0.36, -0.3); set3(T, 'kneeL', 0.4, -0.2, 1); T[P.pitchL] = 0.7; T[P.pitchR] = 0.3; },
  jackknife: T => { set3(T, 'footL', 0.08, 0.5, 0.5); set3(T, 'footR', -0.08, 0.52, 0.5); set3(T, 'kneeL', 0.1, 0.2, 1); set3(T, 'kneeR', -0.1, 0.2, 1); T[P.pitchL] = 0.3; T[P.pitchR] = 0.3; },
};
const SPINE2 = {
  twomill: [-0.1, -0.06, -0.15], sidemill: [-0.06, -0.04, -0.15], backscratch: [-0.28, -0.18, -0.05], rev360: [-0.12, -0.08, -0.3], spinmill: [0.06, 0, -0.15],
  pump: [0.12, 0.06, -0.1], kneeup: [0.08, 0.02, -0.2], crossleg: [-0.04, 0, -0.15], helicopter: [-0.04, -0.02, -0.12], behindhead: [-0.08, -0.06, 0.05],
  cannonball: [0.3, 0.14, 0.05], splits: [-0.1, -0.06, -0.2], hurdle: [0.14, 0.05, -0.2], jackknife: [0.42, 0.18, -0.05],
};

// v0.4.7.5 jump-shot bases in the air (u: seconds since takeoff; sh/sg: shooting hand and its side sign)
const off = sh => (sh === 'L' ? 'R' : 'L');
const AIR2 = {
  // Pogo: legs locked together, then both heels snap all the way up behind him at the top
  pogo: (T, u) => { const f = sm(0.04, 0.18, u); set3(T, 'footL', 0.06, 0.1 + 0.36 * f, -0.04 - 0.3 * f); set3(T, 'footR', -0.06, 0.1 + 0.36 * f, -0.04 - 0.3 * f); T[P.pitchL] = 0.9; T[P.pitchR] = 0.9; set3(T, 'kneeL', 0.05, -0.5, 1); set3(T, 'kneeR', -0.05, -0.5, 1); T[P.spine] = -0.03; },
  // Stork: flamingo: the off foot comes up against the inside of the shooting knee, that knee pointing ahead
  stork: (T, u, sh, sg) => { const k = sm(0, 0.18, u), o = off(sh); set3(T, 'foot' + o, -sg * (0.12 - 0.12 * k), 0.1 + 0.46 * k, 0.02 - 0.04 * k); set3(T, 'knee' + o, -sg * 0.5, 0.6 * k, 1); set3(T, 'foot' + sh, sg * 0.06, 0.08, 0.0); T[o === 'L' ? P.pitchL : P.pitchR] = 0.4; T[sh === 'L' ? P.pitchL : P.pitchR] = 0.8; T[P.spine] = -0.02; },
  // Frog: from a narrow stance, knees flared wide in the air, soles nearly together
  frog: (T, u) => { const k = sm(0, 0.16, u); set3(T, 'footL', 0.06, 0.16 + 0.16 * k, 0.04); set3(T, 'footR', -0.06, 0.16 + 0.16 * k, 0.04); set3(T, 'kneeL', 1, 0.2, 0.4); set3(T, 'kneeR', -1, 0.2, 0.4); T[P.pitchL] = 0.5; T[P.pitchR] = 0.5; T[P.spine] = 0.02; },
  // Corkscrew: ankles crossed and both feet kicked out toward the off side, hips wound one way and the shoulders the other
  corkscrew: (T, u, sh, sg) => { const k = sm(0, 0.22, u), o = -sg * 0.16 * k; set3(T, 'footL', -0.04 * k + 0.1 * (1 - k) + o, 0.1 + 0.14 * k, -0.08 * k); set3(T, 'footR', 0.04 * k - 0.1 * (1 - k) + o, 0.12 + 0.14 * k, -0.1 * k); set3(T, 'kneeL', 0.2, 0.2, 1); set3(T, 'kneeR', -0.2, 0.2, 1); T[P.pelvis + 1] = sg * 0.5 * k; T[P.chest + 1] = -sg * 0.32 * k; T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; T[P.spine] = -0.04; },
  // Heel: the off heel kicked up behind him, the shooting leg straight
  heel: (T, u, sh, sg) => { const k = sm(0, 0.2, u), o = off(sh); set3(T, 'foot' + o, -sg * 0.11, 0.1 + 0.38 * k, -0.06 - 0.3 * k); set3(T, 'knee' + o, -sg * 0.12, -0.4 * k, 1); set3(T, 'foot' + sh, sg * 0.11, 0.09, 0.04); T[P.spine] = -0.06; T[P.head] = -0.16; },
  // Turbo: barely off the floor, seated: knees well forward, feet tucked under
  turbo: (T, u) => { set3(T, 'footL', 0.13, 0.16, -0.16); set3(T, 'footR', -0.13, 0.17, -0.18); set3(T, 'kneeL', 0.2, 0.5, 1); set3(T, 'kneeR', -0.2, 0.5, 1); T[P.pitchL] = 0.4; T[P.pitchR] = 0.4; T[P.spine] = 0.12; T[P.chest] = 0.05; },
  // 1-2 Step: the shooting-side leg swings through high and straight out in front, the other trails
  onestep: (T, u, sh, sg) => { const k = sm(0, 0.22, u), o = off(sh); set3(T, 'foot' + sh, sg * 0.12, 0.1 + 0.3 * k, 0.1 + 0.34 * k); set3(T, 'knee' + sh, sg * 0.12, 0.1, 1); set3(T, 'foot' + o, -sg * 0.12, 0.12, -0.24 * k); T[P.spine] = 0.04; T[P.chest] = 0.02; },
  // Tilt: the whole body tips toward the shooting side, both feet drifting out that way
  tilt: (T, u, sh, sg) => { const k = sm(0, 0.24, u); set3(T, 'footL', 0.12 + sg * 0.22 * k, 0.1 + 0.08 * k, 0.02); set3(T, 'footR', -0.12 + sg * 0.22 * k, 0.12 + 0.04 * k, 0.0); T[P.spine + 2] = -sg * 0.26 * k; T[P.chest + 2] = -sg * 0.14 * k; T[P.head + 2] = sg * 0.2 * k; },
  // Catapult: back arched with the ball loaded behind the head, ankles crossed behind him
  catapult: (T, u) => { const k = sm(0, 0.2, u); set3(T, 'footL', -0.03, 0.12 + 0.12 * k, -0.06 - 0.06 * k); set3(T, 'footR', 0.03, 0.13 + 0.12 * k, -0.08 - 0.06 * k); set3(T, 'kneeL', 0.25, -0.1, 1); set3(T, 'kneeR', -0.25, -0.1, 1); T[P.spine] = -0.2 * k; T[P.chest] = -0.14 * k; T[P.head] = -0.04; },
  // Statue: a figure four: the shooting leg locked straight, the off foot tucked behind its calf, knee out to the side
  statue: (T, u, sh, sg) => { const o = off(sh), k = sm(0, 0.16, u); set3(T, 'foot' + sh, sg * 0.08, 0.08, 0.02); set3(T, 'knee' + sh, sg * 0.1, -0.3, 1); set3(T, 'foot' + o, sg * 0.02, 0.12 + 0.22 * k, -0.1 - 0.06 * k); set3(T, 'knee' + o, -sg * 0.9, 0.1, 0.4); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; T[P.spine] = 0.1; T[P.chest] = 0.04; T[P.head] = -0.2; },
  // Bounce: lands in it: knees deep, feet wide and tucked behind, like coming down off the step-in
  bounce: (T, u) => { const k = sm(0, 0.16, u); set3(T, 'footL', 0.2, 0.12 + 0.2 * k, -0.06 - 0.14 * k); set3(T, 'footR', -0.2, 0.12 + 0.2 * k, -0.06 - 0.14 * k); set3(T, 'kneeL', 0.4, 0.3, 1); set3(T, 'kneeR', -0.4, 0.3, 1); T[P.pitchL] = 0.55; T[P.pitchR] = 0.55; T[P.spine] = 0.06; },
  // Whip: hips swung toward the shooting side, legs together and trailing the other way
  whip: (T, u, sh, sg) => { const k = sm(0, 0.2, u); set3(T, 'footL', 0.07 - sg * 0.2 * k, 0.12 + 0.1 * k, -0.02); set3(T, 'footR', -0.07 - sg * 0.2 * k, 0.13 + 0.1 * k, -0.04); T[P.pelvis + 1] = -sg * 0.2 * k; T[P.chest + 1] = sg * 0.22 * k; T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; },
  // Dip: deep loaded knees carried into the air, feet split front and back
  dip: (T, u, sh, sg) => { const o = off(sh); set3(T, 'foot' + sh, sg * 0.12, 0.2, 0.18); set3(T, 'foot' + o, -sg * 0.12, 0.24, -0.2); set3(T, 'kneeL', 0.25, 0.35, 1); set3(T, 'kneeR', -0.25, 0.35, 1); T[P.spine] = 0.08; },
  // Leaner: falling forward into the shot, both legs trailing out behind
  leaner: (T, u) => { const k = sm(0, 0.22, u); set3(T, 'footL', 0.12, 0.16 + 0.12 * k, -0.22 - 0.16 * k); set3(T, 'footR', -0.12, 0.18 + 0.12 * k, -0.24 - 0.16 * k); set3(T, 'kneeL', 0.12, -0.3, 1); set3(T, 'kneeR', -0.12, -0.3, 1); T[P.pitchL] = 0.9; T[P.pitchR] = 0.9; T[P.spine] = 0.2 * k; T[P.chest] = 0.08 * k; T[P.head] = -0.3; },
  // Bicycle: the legs keep pedalling through the jump
  bicycle: (T, u) => { const ph = u * 11; set3(T, 'footL', 0.12, 0.2 + 0.14 * Math.sin(ph), 0.02 + 0.22 * Math.cos(ph)); set3(T, 'footR', -0.12, 0.2 - 0.14 * Math.sin(ph), 0.02 - 0.22 * Math.cos(ph)); set3(T, 'kneeL', 0.15, 0.3, 1); set3(T, 'kneeR', -0.15, 0.3, 1); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; },
};

// v0.4.7.5 follow-throughs (since: seconds after the release; k: blend-in; relY: release height; sh/sg: shooting hand
// and its side; gh: guide hand; H2/G2: their pose keys; F: the FOLLOW entry; an: the animator, for palms)
const q01 = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
const RELEASE2 = {
  // fingers snap up to the sky, palm to the rim
  flickup: (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { const q = q01(t, 0.05, 0.16); an.palm[sh] = { normal: [0, 0.2 - 0.6 * q, 1], fingers: [0, 0.2 + 0.8 * q, 0.6 - 0.6 * q], w: 0.9 }; set3(T, G2, -sg * 0.3, relY - 0.3, 0.2); },
  // closes into a fist and pumps it down to the chest
  fist: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.12, 0.3); set3(T, H2, sg * (0.05 + 0.12 * q), relY - 0.75 * q, 0.38 - 0.12 * q); set3(T, 'elbow' + sh, sg * 0.6, -1, -0.1); set3(T, G2, -sg * 0.3, relY - 0.5, 0.15); },
  // both arms open wide to the sides at shoulder height
  spread: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.1, 0.32); set3(T, H2, sg * (0.05 + 0.7 * q), relY - 0.42 * q, 0.42 - 0.3 * q); set3(T, G2, -sg * (0.26 + 0.5 * q), relY - 0.14 - 0.3 * q, 0.28 - 0.2 * q); set3(T, 'elbow' + sh, sg, -0.2, -0.2); set3(T, 'elbow' + gh, -sg, -0.2, -0.2); },
  // both arms fall straight to the sides at once
  drop: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.04, 0.16); set3(T, H2, sg * (0.05 + 0.22 * q), relY - (relY - 1.0) * q, 0.4 - 0.28 * q); set3(T, G2, -sg * 0.27, relY - 0.14 - (relY - 1.14) * q, 0.28 - 0.16 * q); set3(T, 'elbow' + sh, sg * 0.35, -1, -0.25); set3(T, 'elbow' + gh, -sg * 0.35, -1, -0.25); },
  // the shooting arm curls back to the shoulder
  curl: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.1, 0.3); set3(T, H2, sg * (0.05 + 0.15 * q), relY - 0.42 * q, 0.4 - 0.32 * q); set3(T, 'elbow' + sh, sg * 0.8, -0.3, 0.6); set3(T, G2, -sg * 0.3, relY - 0.45, 0.2); },
  // held out at full stretch toward the rim, the guide hand already down
  reach: (T, t, k, relY, sh, sg, gh, H2, G2) => { set3(T, 'elbow' + sh, sg * 0.05, -0.2, 1); set3(T, G2, -sg * 0.28, 1.05, 0.14); set3(T, 'elbow' + gh, -sg * 0.35, -1, -0.25); T[P.spine] += 0.08; },
  // the guide hand sweeps across in front of the chest
  swipe: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.08, 0.34); set3(T, G2, -sg * (0.4 - 0.75 * q), relY - 0.35 - 0.1 * Math.sin(q * Math.PI), 0.42); set3(T, 'elbow' + gh, -sg * 0.8, -0.6, 0.2); },
  // down to the brow and out: tipping the cap
  tip: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.14, 0.3), q2 = q01(t, 0.38, 0.52); set3(T, H2, sg * (0.05 + 0.04 * q + 0.3 * q2), relY - 0.36 * q + 0.04 * q2, 0.4 - 0.2 * q + 0.18 * q2); set3(T, 'elbow' + sh, sg * 0.9, 0.1, 0.4); set3(T, G2, -sg * 0.28, 1.05, 0.14); },
  // a big arc down past the hip and back
  swing: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.06, 0.4), al = q * Math.PI * 1.1; set3(T, H2, sg * 0.22, 1.2 + (relY - 1.2) * Math.cos(al), 0.4 * Math.sin(al + 0.3) - 0.1 * q); set3(T, 'elbow' + sh, sg * 0.5, -0.8, -0.2); set3(T, G2, -sg * 0.28, 1.05, 0.14); },
  // both arms locked straight up in a V
  lock: (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { const q = q01(t, 0.06, 0.2); set3(T, H2, sg * (0.05 + 0.18 * q), relY + 0.1 * q, 0.26); set3(T, G2, -sg * (0.26 + 0.0 * q), relY - 0.14 + 0.24 * q, 0.22); set3(T, 'elbow' + gh, -sg * 0.6, 0.2, -0.2); an.palm[gh] = { normal: [0, 0, 1], fingers: [0, 1, 0], w: 0.8 }; },
  // a karate chop down in front to the waist
  chop: (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { const q = q01(t, 0.08, 0.2); set3(T, H2, sg * 0.04, relY - 0.95 * q, 0.5 + 0.08 * q); set3(T, 'elbow' + sh, sg * 0.3, -0.5, 0.6); an.palm[sh] = { normal: [sg, 0, 0], fingers: [0, 0.6 - 0.6 * q, 0.8], w: 0.9 }; set3(T, G2, -sg * 0.3, relY - 0.4, 0.2); },
  // traces the ball's line on out and down, like threading a needle at the rim
  thread: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.08, 0.5); set3(T, H2, sg * 0.04, relY - 0.5 * q * q, 0.5 + 0.34 * q); set3(T, 'elbow' + sh, sg * 0.05, -0.4, 1); set3(T, G2, -sg * 0.3, relY - 0.5, 0.2); },
  // the wrist hooks right over and the hand drops behind the head
  hook: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.08, 0.26); set3(T, H2, sg * (0.05 - 0.02 * q), relY - 0.12 * q, 0.36 - 0.4 * q); set3(T, 'elbow' + sh, sg * 0.4, 0.4, 0.8); set3(T, G2, -sg * 0.3, relY - 0.42, 0.18); },
  // the guide hand wipes along the shooting forearm, elbow to wrist
  wipe: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.1, 0.5); set3(T, G2, sg * (0.05 - 0.02 * q), relY - 0.42 + 0.34 * q, 0.34 + 0.06 * q); set3(T, 'elbow' + gh, -sg * 0.7, -0.4, 0.4); },
  // the whole arm shakes loose from the shoulder
  shake: (T, t, k, relY, sh, sg, gh, H2, G2) => { const w = Math.sin(t * 15) * q01(t, 0.08, 0.2); T[P[H2]] += sg * 0.14 * w; T[P[H2] + 2] += 0.06 * w; set3(T, G2, -sg * (0.3 + 0.1 * w), relY - 0.45, 0.2); },
  // a big stretch: both arms up and back
  stretch: (T, t, k, relY, sh, sg, gh, H2, G2) => { const q = q01(t, 0.08, 0.36); set3(T, H2, sg * (0.05 + 0.2 * q), relY + 0.06 * q, 0.2 - 0.28 * q); set3(T, G2, -sg * (0.26 + 0.0 * q), relY - 0.14 + 0.2 * q, 0.28 - 0.4 * q); set3(T, 'elbow' + gh, -sg * 0.8, 0.4, -0.5); set3(T, 'elbow' + sh, sg * 0.8, 0.4, -0.5); T[P.chest] -= 0.1 * q; T[P.head] -= 0.12 * q; },
};

// v0.4.5 stage 7: jump-shot follow-throughs, one per release (see actionPose)
const FOLLOW = {
  classic: { k: 0.12, y: 0.04, z: 0.46, f: -0.8, hold: 0.5 },
  quick: { k: 0.08, y: -0.2, z: 0.4, f: -0.75, hold: 0.2, air: true },
  high: { k: 0.12, y: 0.15, z: 0.22, f: -0.62, hold: 0.75 },
  snap: { k: 0.05, y: 0.03, z: 0.46, f: -1.25, hold: 0.35, gx: 0.42 },
  float: { k: 0.16, y: 0.08, z: 0.48, f: -0.6, hold: 0.95 },
  butter: { k: 0.2, y: 0.05, z: 0.42, f: -0.62, hold: 0.75 },
  feather: { k: 0.17, y: 0.05, z: 0.44, f: -0.45, hold: 0.85 },
  dart: { k: 0.06, y: -0.13, z: 0.64, f: -0.42, hold: 0.3, air: true },
  rainbow: { k: 0.15, y: 0.14, z: 0.28, f: -0.66, hold: 1.0 },
  laser: { k: 0.05, y: 0.0, z: 0.48, f: -1.0, hold: 0.5 },
  wave: { k: 0.14, y: 0.06, z: 0.42, f: -0.75, hold: 1.1 },
  hold: { k: 0.13, y: 0.12, z: 0.34, f: -0.72, hold: 1.6 },
  snatch: { k: 0.07, y: 0.02, z: 0.44, f: -0.95, hold: 0.24, gx: 0.34, air: true },
  twohand: { k: 0.15, y: 0.03, z: 0.4, f: -0.7, hold: 0.6 },
  point: { k: 0.1, y: 0.05, z: 0.46, f: -0.8, hold: 0.9 },
  cobra: { k: 0.05, y: 0.19, z: 0.3, f: -1.32, hold: 0.55 },
  // v0.4.7.5 releases
  flickup: { k: 0.06, y: 0.1, z: 0.4, f: -0.2, hold: 0.45 },
  fist: { k: 0.07, y: -0.05, z: 0.38, f: -1.4, hold: 0.32, air: true },
  spread: { k: 0.1, y: 0.02, z: 0.44, f: -0.8, hold: 0.7 },
  drop: { k: 0.05, y: 0.0, z: 0.42, f: -0.7, hold: 0.12, air: true },
  curl: { k: 0.09, y: 0.0, z: 0.4, f: -0.9, hold: 0.6 },
  reach: { k: 0.14, y: -0.12, z: 0.72, f: -0.55, hold: 0.85 },
  swipe: { k: 0.08, y: 0.04, z: 0.46, f: -0.8, hold: 0.6 },
  tip: { k: 0.1, y: 0.0, z: 0.42, f: -0.8, hold: 0.8 },
  swing: { k: 0.08, y: 0.02, z: 0.44, f: -0.75, hold: 0.55, air: true },
  lock: { k: 0.12, y: 0.16, z: 0.26, f: -0.6, hold: 1.05 },
  chop: { k: 0.06, y: 0.0, z: 0.5, f: -0.5, hold: 0.45, air: true },
  thread: { k: 0.12, y: 0.0, z: 0.5, f: -0.5, hold: 0.75 },
  hook: { k: 0.08, y: 0.08, z: 0.36, f: -1.5, hold: 0.6 },
  wipe: { k: 0.1, y: 0.03, z: 0.42, f: -0.8, hold: 0.85 },
  shake: { k: 0.1, y: 0.06, z: 0.42, f: -0.7, hold: 1.0 },
  stretch: { k: 0.14, y: 0.14, z: 0.2, f: -0.6, hold: 1.2 },
};

function set3(p, g, x, y, z) { const o = P[g]; p[o] = x; p[o + 1] = y; p[o + 2] = z; }
function add3(p, g, x, y, z) { const o = P[g]; p[o] += x; p[o + 1] += y; p[o + 2] += z; }
function mix3(p, g, x, y, z, w) { const o = P[g]; p[o] += (x - p[o]) * w; p[o + 1] += (y - p[o + 1]) * w; p[o + 2] += (z - p[o + 2]) * w; }

export class Animator {
  constructor(view) {
    this.view = view;
    this.H = view.H;
    this.s = view.H / 2;
    this.pose = neutral();
    this.target = newPose();
    this.phase = 0;
    this.feet = [{ wx: null, wz: null, step: null }, { wx: null, wz: null, step: null }];
    this.lastFacing = 0;
    this.lean = { f: 0, s: 0 };
    this.prevV = { x: 0, z: 0 };
    this.time = 0;
    this.lastAction = null;
    this.follow = null;
    this.lookPt = [0, 1.7, 3];
    this.palm = { L: null, R: null };
    this.blink = 0;
    // landing absorption: a damped spring on hip height kicked by the touchdown speed
    this.land = { x: 0, v: 0 };
    this.prevY = 0; this.vyAir = 0; this.wasAir = false;
    this.outPose = newPose();
  }

  // local (character-space, meters) from world
  toLocal(x, y, z, out) {
    const c = Math.cos(this.f), s = Math.sin(this.f);
    const dx = x - this.x, dz = z - this.z;
    out[0] = c * dx - s * dz; out[1] = y - this.y; out[2] = s * dx + c * dz;
    return out;
  }

  // st: {x,y,z,facing} render-interpolated; p: sim player; g: game (or null); ball: render ball {x,y,z}
  update(dt, st, p, g, ball, extra = {}) {
    this.time += dt;
    this.x = st.x; this.y = st.y; this.z = st.z; this.f = st.facing + dunkSpin(p.action); // v0.4.3: 360 dunks spin the body
    const s = this.s, H = this.H;
    const T = this.target;
    neutral(T);
    const c = Math.cos(this.f), sn = Math.sin(this.f);
    const vx = p.vx, vz = p.vz;
    const lvx = c * vx - sn * vz, lvz = sn * vx + c * vz;
    const speed = Math.hypot(vx, vz);
    // acceleration for lean
    const ax = (vx - this.prevV.x) / Math.max(dt, 1e-3), az = (vz - this.prevV.z) / Math.max(dt, 1e-3);
    this.prevV.x = vx; this.prevV.z = vz;
    const lax = c * ax - sn * az, laz = sn * ax + c * az;
    this.lean.f = lerp(this.lean.f, Math.max(-6, Math.min(8, laz)), 1 - Math.exp(-dt * 6));
    this.lean.s = lerp(this.lean.s, Math.max(-8, Math.min(8, lax)), 1 - Math.exp(-dt * 6));
    const a = p.action;
    const has = g ? g.ball.holder === p.id : !!extra.hasBall;
    const bmode = g ? g.ball.mode : extra.ballMode;
    const defense = p.stance === 'defense';
    const airborne = p.airborne || st.y - (extra.floorY || 0) > 0.02;
    {
      const vy = (st.y - this.prevY) / Math.max(dt, 1e-3);
      this.prevY = st.y;
      if (airborne) this.vyAir = vy;
      else if (this.wasAir) { this.land.v -= Math.min(5.5, Math.max(0, -this.vyAir)) * 1.7; this.vyAir = 0; }
      this.wasAir = airborne;
      const L = this.land, w = 13, z = 0.72, n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
      for (let i = 0; i < n; i++) { L.v += (-w * w * L.x - 2 * z * w * L.v) * h; L.x += L.v * h; }
      if (L.x < -0.2) { L.x = -0.2; if (L.v < 0) L.v = 0; }
      if (airborne) { L.x *= 0.8; L.v = 0; }
    }
    // ---- locomotion & stance ----
    // Gait parameters follow measured human running/walking data (scaled by height): step length grows
    // with speed (walk ≈0.26+0.33v m, run ≈0.62+0.17v m for a 1.8 m adult), stance share (duty factor)
    // falls from ~62% walking to ~40% jogging and ~28% sprinting, and the swing foot rises much higher
    // when running (heel recovery toward the glutes) than when walking.
    const runK = sm(1.9, 3.1, speed), sprintK = sm(5.0, 7.0, speed);
    const shuffle = (defense || (has && bmode === 'dribble' && speed < 3.4 && Math.abs(lvx) > Math.abs(lvz) * 0.9)) && speed < 4.5;
    const hs = H / 1.8;
    // v0.4.7.5 movement styles (equipped, AI included): how he walks and runs everywhere, park and court
    const MS = MOVE_GAIT[p.moveStyle] || MOVE_GAIT.standard, msK = defense ? 0.5 : 1;
    const stepM = lerp(Math.min(0.9, 0.26 + 0.33 * speed), 0.62 + 0.17 * speed, runK) * hs * MS.stride;
    let stride = shuffle ? Math.min(0.72, 0.4 + speed * 0.12) : (2 * stepM) / s;
    const duty = shuffle ? 0.6 : lerp(lerp(0.62, 0.36, runK), 0.26, sprintK);
    const lift = (shuffle ? 0.07 : lerp(0.11, 0.3, runK) + sprintK * 0.2) * MS.lift;
    const strideM = stride * s;
    this.phase = (this.phase + speed * dt / Math.max(0.3, strideM)) % 1;
    const dirL = speed > 0.05 ? [lvx / speed, lvz / speed] : [0, 1];
    const wGait = sm(0.18, 0.85, speed) * (airborne ? 0 : 1);
    this.gaitInfo = { runK, sprintK, duty, wGait, shuffle };
    // stance widths (reference units)
    let crouch = 0, stanceW = 0.125, stagger = 0;
    if (defense) { crouch = -0.2; stanceW = 0.3; }
    else if (has && bmode === 'dribble') { crouch = -0.08 - (speed < 1 ? 0.04 : 0); stanceW = 0.19; stagger = 0.05; }
    else if (has) { crouch = -0.07; stanceW = 0.2; stagger = 0.08; }
    if (p.stamina < 0.18 && !has && speed < 0.3 && !defense && !a) crouch -= 0.05;
    if (!defense) { crouch += MS.crouch; stanceW += MS.wide; }
    const restL = [stanceW, 0.08, stagger], restR = [-stanceW, 0.08, -stagger];
    // gait feet: [x, y, z, pitch, toeBend]
    const hp = lerp(0.85, 0.6, runK); // swing height peaks earlier when running (heel recovery)
    // runners touch down only a little ahead of the hips and push off well behind them
    const shift = shuffle ? 0 : 0.1 * runK * duty * stride;
    const gaitFoot = (side, off) => {
      const ph = (this.phase + off) % 1;
      let along, h = 0, pitch = 0, toe = 0;
      if (ph < duty) {
        // stance: heel strike (walk) or flat midfoot contact (run), heel-off, then toe-off on the ball of the foot
        const q = ph / duty;
        along = (0.5 - q) * duty * stride - shift;
        if (q < 0.15) pitch = -0.22 * (1 - runK) * (1 - q / 0.15);
        else if (q > 0.55) pitch = sm(0.55, 1, q) * (0.35 + 0.3 * runK);
        toe = -Math.max(0, pitch) * 0.95;
      } else {
        const q = (ph - duty) / (1 - duty), e = q * q * (3 - 2 * q);
        along = (-0.5 + e) * duty * stride - shift;
        h = Math.sin(Math.PI * Math.pow(q, hp)) * lift;
        // toes stay pointed after push-off, then the ankle dorsiflexes ready for contact
        pitch = lerp(0.62, -0.15 * (1 - runK), sm(0, 0.8, q)) * (0.4 + 0.6 * Math.max(runK, 0.35));
      }
      const base = shuffle ? (side > 0 ? 0.26 : -0.26) : side * (0.11 - runK * 0.025); // (v0.4.7.5: a touch wider at speed, the knees pass clear)
      let fx = base + dirL[0] * along, fz = dirL[1] * along;
      // crossover steps pass in front
      if (!shuffle && Math.abs(dirL[0]) > 0.5 && ph >= duty) fz += Math.sin((ph - duty) / (1 - duty) * Math.PI) * 0.12 * Math.abs(dirL[0]);
      return [fx, 0.08 + h, fz, pitch, toe];
    };
    const gL = gaitFoot(1, 0), gR = gaitFoot(-1, 0.5);
    // idle feet: world-locked plants that step when displaced
    const idle = [restL, restR];
    const gaits = [gL, gR];
    const tmp = [0, 0, 0];
    for (let k = 0; k < 2; k++) {
      const F = this.feet[k];
      const side = k === 0 ? 1 : -1;
      let local;
      if (wGait > 0.5 || F.wx == null || airborne) {
        // keep plant synced to where the foot is now
        const gl = wGait > 0.5 ? gaits[k] : idle[k];
        F.wx = this.x + (c * gl[0] * s + sn * gl[2] * s); F.wz = this.z + (-sn * gl[0] * s + c * gl[2] * s);
        F.step = null;
        local = idle[k].slice();
      } else {
        this.toLocal(F.wx, 0, F.wz, tmp);
        local = [tmp[0] / s, 0.08, tmp[2] / s];
        const dx = local[0] - idle[k][0], dz = local[2] - idle[k][2];
        const off = Math.hypot(dx, dz);
        if (!F.step && off > (defense ? 0.16 : 0.2) && !(this.feet[1 - k].step)) F.step = { t: 0, from: local.slice(), dur: 0.2 };
        if (F.step) {
          F.step.t += dt;
          const q = Math.min(1, F.step.t / F.step.dur), e = q * q * (3 - 2 * q);
          local = [lerp(F.step.from[0], idle[k][0], e), 0.08 + Math.sin(q * Math.PI) * 0.07, lerp(F.step.from[2], idle[k][2], e)];
          if (q >= 1) { F.step = null; F.wx = this.x + (c * idle[k][0] * s + sn * idle[k][2] * s); F.wz = this.z + (-sn * idle[k][0] * s + c * idle[k][2] * s); }
        }
      }
      const g2 = gaits[k];
      const fx = lerp(local[0], g2[0], wGait), fy = lerp(local[1], g2[1], wGait), fz = lerp(local[2], g2[2], wGait);
      set3(T, k === 0 ? 'footL' : 'footR', fx, fy, fz);
      T[k === 0 ? P.pitchL : P.pitchR] = g2[3] * wGait;
      T[k === 0 ? P.toeL : P.toeR] = g2[4] * wGait;
      T[k === 0 ? P.yawL : P.yawR] = side * (defense ? 18 : 8) * D + (shuffle ? 0 : Math.atan2(dirL[0], Math.max(0.3, Math.abs(dirL[1]))) * 0.3 * wGait);
      if (defense) set3(T, k === 0 ? 'kneeL' : 'kneeR', side * 0.45, 0, 1);
    }
    // hips & spine. Centre of mass: walking vaults over a stiff stance leg (highest at mid-stance, lowest in
    // double support, ~3-4 cm); running is spring-mass (lowest at mid-stance, highest in flight, ~5-8 cm).
    const ms = duty / 2; // phase of left mid-stance (right is +0.5)
    const c2 = Math.cos(4 * Math.PI * (this.phase - ms));
    const bobWalk = 0.035 * (c2 - 1) * 0.5, bobRun = -(0.075 - 0.025 * sprintK) * (0.5 + 0.5 * c2);
    const bob = wGait * (shuffle ? -0.012 * (0.5 + 0.5 * c2) : lerp(bobWalk, bobRun, runK) - 0.02 * runK);
    T[P.root + 1] = crouch + bob - (shuffle ? 0.03 : 0) + wGait * MS.bounce * (0.5 + 0.5 * c2) * msK;
    // lateral sway over the stance foot (walking), pelvis rotation with the swing leg, hip drop on the swing side
    const cs = Math.cos(TAU * (this.phase - ms));
    T[P.root] = wGait * (1 - runK) * cs * 0.025;
    T[P.pelvis + 1] = -wGait * Math.cos(this.phase * TAU) * (0.08 + 0.06 * runK);
    T[P.chest + 1] = -T[P.pelvis + 1] * 1.6 + wGait * MS.sway * Math.cos(this.phase * TAU) * msK;
    const roll = shuffle ? 0 : wGait * cs * (0.06 + 0.02 * runK);
    T[P.pelvis + 2] = roll;
    // trunk: ~3° walking, ~6° jogging, ~11° sprinting, plus up to ~16° more while accelerating hard
    const leanF = (defense ? 0.32 : has ? 0.16 : 0.04) + runK * 0.06 + sprintK * 0.09 + Math.max(-0.12, Math.min(0.28, this.lean.f * 0.035)) + MS.lean * msK;
    T[P.spine] = leanF * 0.6; T[P.chest] = leanF * 0.4 + MS.chest * msK;
    T[P.spine + 2] = -this.lean.s * 0.02 - roll * 0.9;
    T[P.chest + 2] = -this.lean.s * 0.012;
    T[P.head] = -leanF * 0.5 + MS.head * msK + wGait * MS.nod * Math.cos(4 * Math.PI * this.phase);
    T[P.head + 2] = MS.tilt * msK;
    // arms (free): counter-swing; running arms bend ~90° and the forward hand rises toward the chest/chin
    const armAmp = wGait * (0.1 + 0.2 * runK + sprintK * 0.1) * MS.arms;
    const swL = -Math.cos((this.phase) * TAU) * armAmp, swR = -Math.cos((this.phase + 0.5) * TAU) * armAmp;
    const armY = 1.0 + 0.06 * runK + 0.04 * sprintK + crouch * 0.85;
    const up = 0.4 + 0.5 * runK, back = 0.25 * runK;
    const armX = 0.26 + 0.02 * runK - crouch * 0.25 + MS.armOut; // crouching: hands hang outside the knees, not in the shorts
    set3(T, 'handL', armX - Math.max(0, swL) * 0.15 * runK, armY + Math.max(0, swL) * up + Math.max(0, -swL) * back, 0.08 + swL - crouch * 0.4);
    set3(T, 'handR', -armX + Math.max(0, swR) * 0.15 * runK, armY + Math.max(0, swR) * up + Math.max(0, -swR) * back, 0.08 + swR - crouch * 0.4);
    if (crouch < -0.04) { set3(T, 'elbowL', 0.5, -0.4, -0.8); set3(T, 'elbowR', -0.5, -0.4, -0.8); }
    if (runK > 0.3) { set3(T, 'elbowL', 0.2, -0.3, -1); set3(T, 'elbowR', -0.2, -0.3, -1); }
    if (defense) {
      const w = Math.sin(this.time * 7 + p.id) * 0.03;
      set3(T, 'handL', 0.5, 1.22 + w, 0.28); set3(T, 'handR', -0.5, 1.22 - w, 0.28);
      set3(T, 'elbowL', 0.8, -0.6, -0.4); set3(T, 'elbowR', -0.8, -0.6, -0.4);
    }
    // (v0.4.7.5: hands up stays alive: a little reach and sway, one hand a touch higher, elbows soft)
    if (p.handsUp && !a) { const hw = Math.sin(this.time * 4 + p.id); set3(T, 'handL', 0.22 + 0.03 * hw, 2.2 + 0.04 * hw, 0.22); set3(T, 'handR', -0.2 + 0.03 * hw, 2.28 - 0.04 * hw, 0.24); set3(T, 'elbowL', 0.7, -0.1, -0.5); set3(T, 'elbowR', -0.7, -0.1, -0.5); }
    else if (p.handsSide && !a) {
      // v0.4.4: a hand out on one side (right stick held left/right on defense)
      const c0 = Math.cos(this.f), s0 = Math.sin(this.f), lxs = p.handsSide.x * c0 - p.handsSide.z * s0;
      const hd = lxs >= 0 ? 'L' : 'R', sg = hd === 'L' ? 1 : -1;
      set3(T, 'hand' + hd, sg * 0.72, 1.3, 0.3); set3(T, 'elbow' + hd, sg * 1, -0.2, -0.3);
    }
    // v0.4.7.5 box-outs (game.js boxOuts): the boxer sits low and wide, backside into the man, arms out wide with the
    // elbows bent to feel and hold him; the man held off leans in, one hand on the boxer's back, the other reaching
    // over the top. Faded in and out (boxW) so it never pops.
    this.boxW = lerp(this.boxW || 0, (p.boxOut ? 1 : p.boxedOut ? -1 : 0), 1 - Math.exp(-dt * 10));
    const bw = this.boxW;
    if (bw > 0.02 && !a && !airborne) {
      T[P.root + 1] -= 0.13 * bw; T[P.spine] += (0.3 - T[P.spine]) * bw; T[P.chest] += (0.1 - T[P.chest]) * bw; T[P.head] += (-0.26 - T[P.head]) * bw;
      mix3(T, 'footL', 0.35, 0.08, 0.02, bw); mix3(T, 'footR', -0.35, 0.08, 0.02, bw);
      mix3(T, 'handL', 0.66, 1.18, -0.08, bw); mix3(T, 'handR', -0.66, 1.18, -0.08, bw);
      mix3(T, 'elbowL', 1, -0.2, -0.4, bw); mix3(T, 'elbowR', -1, -0.2, -0.4, bw);
    } else if (bw < -0.02 && !a && !airborne) {
      const w2 = -bw, reach = 0.5 + 0.5 * Math.sin(this.time * 3 + p.id);
      T[P.spine] += (0.24 - T[P.spine]) * w2; T[P.chest] += (0.12 - T[P.chest]) * w2; T[P.root + 1] -= 0.04 * w2;
      mix3(T, 'handL', 0.2, 1.22, 0.42, w2); mix3(T, 'handR', -0.24, 1.75 + 0.4 * reach, 0.42, w2);
      mix3(T, 'elbowL', 0.6, -0.4, -0.5, w2); mix3(T, 'elbowR', -0.5, 0, -0.5, w2);
    }
    // v0.4.7.5 idle life: breathing (faster when tired) and a slow weight shift from foot to foot, so a player
    // standing still is never a statue
    if (!a && !airborne) {
      const still = 1 - sm(0.2, 1.2, speed), br = this.time * (1.5 + (1 - p.stamina) * 1.6) + p.id;
      T[P.chest] -= 0.014 * Math.sin(br) * still; T[P.clavL + 2] += 0.012 * Math.sin(br) * still; T[P.clavR + 2] -= 0.012 * Math.sin(br) * still;
      const ws = Math.sin(this.time * 0.42 + p.id * 1.7) * still * (defense ? 0.3 : 1);
      T[P.root] += 0.014 * ws; T[P.pelvis + 2] += 0.03 * ws; T[P.spine + 2] -= 0.02 * ws; T[P.head + 2] += 0.015 * ws;
    }
    // exhausted: hands on knees
    if (p.stamina < 0.12 && !has && speed < 0.25 && !defense && !a) {
      T[P.spine] = 0.55; T[P.chest] = 0.25; T[P.root + 1] = -0.1;
      set3(T, 'handL', 0.15, 0.62, 0.28); set3(T, 'handR', -0.15, 0.62, 0.28);
    }
    // v0.4.3 size-up packages: holding the dribble in front of a defender, better packages sit lower and work
    // him with shoulder and head jabs
    // v0.4.5 stage 7: every package but Basic has its body language (Rhythm used to have none at all)
    if (has && bmode === 'dribble' && speed < 1.2 && !a && ((p.sizeupLvl || 0) > 0 || (p.sizeupStyle && p.sizeupStyle !== 'basic'))) {
      const lvl = p.sizeupLvl || 0, w = this.time * (5 + lvl * 1.8) + p.id;
      T[P.root + 1] -= 0.035 * lvl;
      T[P.chest + 1] += Math.sin(w) * 0.08 * lvl;
      T[P.spine + 2] += Math.sin(w * 0.5) * 0.05 * lvl;
      T[P.head] += Math.sin(w + 1.3) * 0.035 * lvl;
      // v0.4.5: each size-up package has its own body language on top of that
      const su = p.sizeupStyle;
      if (su === 'pound') { T[P.root + 1] -= 0.05; T[P.spine] += 0.12; T[P.head] += Math.sin(w * 0.9) * 0.08; set3(T, 'footL', 0.2, 0.08, 0.04); set3(T, 'footR', -0.2, 0.08, -0.02); }
      else if (su === 'crab') { T[P.root + 1] -= 0.07; set3(T, 'footL', 0.32, 0.08, 0.02); set3(T, 'footR', -0.32, 0.08, 0.02); set3(T, 'kneeL', 0.42, 0, 1); set3(T, 'kneeR', -0.42, 0, 1); T[P.root] += Math.sin(w * 0.45) * 0.05; }
      else if (su === 'snake') { const sn = Math.sin(w * 0.7); T[P.pelvis + 2] = sn * 0.14; T[P.spine + 2] += -sn * 0.1; T[P.root] += sn * 0.06; T[P.root + 1] -= 0.04; }
      else if (su === 'stutter') { const ch = Math.sin(w * 2.1); T[P.root + 1] += Math.abs(ch) * 0.025 - 0.03; set3(T, 'footL', 0.17, 0.08 + Math.max(0, ch) * 0.07, 0.06); set3(T, 'footR', -0.17, 0.08 + Math.max(0, -ch) * 0.07, 0.0); }
      else if (su === 'rhythm') { T[P.root + 1] -= 0.02 - 0.03 * Math.abs(Math.sin(Math.PI * (p.dribble?.phase || 0))); T[P.chest + 1] += Math.sin(w * 0.55) * 0.1; T[P.head + 2] = Math.sin(w * 0.55) * 0.08; }
      else if (su === 'quick') { T[P.root + 1] -= 0.045; set3(T, 'footL', 0.19, 0.08, 0.06); set3(T, 'footR', -0.19, 0.08, -0.02); T[P.head] += Math.sin(w * 1.3) * 0.05; }
      else if (su === 'elite') { const e2 = Math.sin(w * 0.9); T[P.root + 1] -= 0.06; T[P.spine + 2] += e2 * 0.1; T[P.chest + 1] += e2 * 0.18; T[P.root] += e2 * 0.04; }
      else if (su === 'ankle') { const an = Math.sin(w * 1.1); T[P.root + 1] -= 0.085; T[P.chest + 1] += an * 0.22; T[P.head + 1] = -an * 0.26; set3(T, 'footL', 0.26, 0.08 + Math.max(0, an) * 0.05, 0.08); set3(T, 'footR', -0.26, 0.08, -0.04); }
      else if (su === 'showtime') { const sh2 = Math.sin(w * 0.8); T[P.chest + 1] += sh2 * 0.16; T[P.head] += Math.sin(w * 0.8 + 1.9) * 0.1; T[P.head + 1] = -sh2 * 0.3; T[P.root + 1] -= 0.05; T[P.spine + 2] += sh2 * 0.08; }
      // v0.4.7.5 packages
      else if (su === 'yoyo') { const ph2 = p.dribble?.phase || 0; T[P.root + 1] += 0.02; T[P.spine] -= 0.06; T[P.head] += Math.sin(Math.PI * 2 * ph2) * 0.08; set3(T, 'footL', 0.14, 0.08, 0.03); set3(T, 'footR', -0.14, 0.08, 0.0); }
      else if (su === 'rocker') { const rk2 = Math.sin(w * 0.75); T[P.spine] += rk2 * 0.2; T[P.root + 1] -= 0.04 + Math.max(0, rk2) * 0.03; T[P.head] -= rk2 * 0.12; set3(T, 'footL', 0.18, 0.08, 0.12); set3(T, 'footR', -0.18, 0.08, -0.12); }
      else if (su === 'cradle') { const cr = Math.sin(w * 0.6); T[P.root + 1] -= 0.09; T[P.spine] += 0.16; T[P.pelvis + 2] = cr * 0.08; set3(T, 'footL', 0.3, 0.08, 0.0); set3(T, 'footR', -0.3, 0.08, 0.0); set3(T, 'kneeL', 0.7, 0, 1); set3(T, 'kneeR', -0.7, 0, 1); }
      else if (su === 'glide') { const gl = Math.sin(w * 0.4); T[P.root] += gl * 0.1; T[P.pelvis + 2] = -gl * 0.1; T[P.spine + 2] += gl * 0.06; T[P.root + 1] -= 0.05; set3(T, 'footL', 0.24 + Math.max(0, gl) * 0.08, 0.08, 0.02); set3(T, 'footR', -0.24 + Math.min(0, gl) * 0.08, 0.08, 0.02); }
      else if (su === 'jab') { const jb = Math.max(0, Math.sin(w * 0.9)); set3(T, 'footR', -0.16, 0.08 + 0.04 * jb, 0.04 + 0.3 * jb); T[P.spine] += 0.1 * jb; T[P.root + 1] -= 0.05 + 0.03 * jb; T[P.chest + 1] += 0.12 * jb; }
      else if (su === 'springs') { const sp2 = Math.abs(Math.sin(w * 1.6)); T[P.root + 1] += sp2 * 0.04 - 0.02; T[P.pitchL] = sp2 * 0.4; T[P.pitchR] = sp2 * 0.4; set3(T, 'footL', 0.15, 0.08 + sp2 * 0.03, 0.04); set3(T, 'footR', -0.15, 0.08 + sp2 * 0.03, 0.0); }
      else if (su === 'lowrider') { T[P.root + 1] -= 0.14; T[P.spine] += 0.24; T[P.head] -= 0.14; set3(T, 'footL', 0.28, 0.08, 0.1); set3(T, 'footR', -0.28, 0.08, -0.08); set3(T, 'kneeL', 0.5, 0, 1); set3(T, 'kneeR', -0.5, 0, 1); }
      else if (su === 'swagger') { const sw2 = Math.sin(w * 0.5); T[P.root + 1] += 0.02; T[P.spine] -= 0.08; T[P.chest + 1] += sw2 * 0.24; T[P.head + 1] = -sw2 * 0.18; T[P.head + 2] = sw2 * 0.1; set3(T, 'footL', 0.22, 0.08, 0.06); set3(T, 'footR', -0.22, 0.08, -0.04); }
      else if (su === 'blur') { const bl = Math.sin(w * 2.4); T[P.root + 1] -= 0.08; T[P.chest + 1] += bl * 0.1; T[P.root] += bl * 0.03; set3(T, 'footL', 0.2, 0.08 + Math.max(0, bl) * 0.04, 0.05); set3(T, 'footR', -0.2, 0.08 + Math.max(0, -bl) * 0.04, -0.03); }
      else if (su === 'pendulum') { const pd2 = Math.sin(w * 0.7); T[P.root + 1] -= 0.08; T[P.root] += pd2 * 0.06; set3(T, 'footL', 0.36, 0.08, 0.14); set3(T, 'footR', -0.36, 0.08, -0.1); set3(T, 'kneeL', 0.6, 0, 1); set3(T, 'kneeR', -0.6, 0, 1); T[P.spine] += 0.12; }
    }
    // v0.4.5: backing a defender down. Sexy Red (Icon badge) has its own low, wide back-down with shoulder bumps.
    if (p.posting > 0 && has && !a) {
      const sexy = p.icon === 'sexy_red', w2 = this.time * (sexy ? 4.2 : 3) + p.id;
      T[P.root + 1] -= sexy ? 0.11 : 0.07;
      T[P.spine] = (sexy ? -0.2 : -0.12) - 0.05 * Math.sin(w2);
      T[P.chest] = sexy ? -0.1 : -0.05;
      set3(T, 'footL', sexy ? 0.3 : 0.24, 0.08, -0.08); set3(T, 'footR', sexy ? -0.3 : -0.24, 0.08, -0.14);
      set3(T, 'kneeL', 0.4, 0, 1); set3(T, 'kneeR', -0.4, 0, 1);
      if (sexy) { T[P.chest + 1] = Math.sin(w2) * 0.26; T[P.pelvis + 2] = Math.sin(w2 * 0.5) * 0.1; T[P.head + 1] = -Math.sin(w2) * 0.3; }
    }
    // ---- actions ----
    const palm = this.palm; palm.L = null; palm.R = null;
    const lb = [0, 0, 0];
    if (ball) this.toLocal(ball.x, ball.y, ball.z, lb);
    const lbs = [lb[0] / s, lb[1] / s, lb[2] / s];
    let look = null, lookW = 0.6;
    if (ball) look = [lb[0], lb[1], lb[2]];
    const rim = g ? g.rimFor(p.team) : null;
    if (a) this.actionPose(T, a, p, g, lbs, lb, rim);
    // v0.4.5 stage 7: a released jumper's follow-through is held for the release's own time, even after the shot
    // action is over (until he does something else or gets the ball back)
    if (a && a.type === 'shoot' && a.released) { this.lastShot = a; this.lastShotT = a.t; }
    else if (a || has) this.lastShot = null;
    else if (this.lastShot) {
      this.lastShotT += dt;
      const ls = this.lastShot, st2 = ls.kind === 'close' ? 'standard' : (p.shotPkg?.style || 'standard');
      if (this.followThrough(T, ls, p, this.lastShotT, st2, false)) this.lastShot = null;
    }
    // ---- ball hands ----
    if (has && ball && !(a && (a.type === 'hang'))) this.ballHands(T, p, g, a, lbs, bmode);
    else if (ball && !has && g && g.ball.mode === 'flight') {
      // reach for an incoming pass / loose ball near the hands
      const dist = Math.hypot(lb[0], lb[1] - 1.3 * s, lb[2]);
      const coming = g.ball.kind === 'pass' && g.ball.info?.to === p.id;
      if ((coming && dist < 2.4) || (dist < 0.9 && (a?.type === 'rebound' || a?.type === 'block' || a?.type === 'catch'))) {
        const w = coming ? sm(2.4, 0.8, dist) : 1;
        mix3(T, 'handL', lbs[0] + 0.14, lbs[1] - 0.02, lbs[2] - 0.05, w);
        mix3(T, 'handR', lbs[0] - 0.14, lbs[1] - 0.02, lbs[2] - 0.05, w);
        palm.L = { normal: [-1, 0, 0.2], fingers: [0, 0.8, 0.6], w: w * 0.8 };
        palm.R = { normal: [1, 0, 0.2], fingers: [0, 0.8, 0.6], w: w * 0.8 };
      }
    }
    // look target
    if (rim && a && (a.type === 'shoot' || a.type === 'layup' || a.type === 'dunk' || a.type === 'ftshot')) { this.toLocal(rim.x, rim.y, rim.z, tmp); look = tmp.slice(); lookW = 0.9; }
    else if (defense && g) { const h = g.holder(); if (h) { this.toLocal(h.x, 1.4, h.z, tmp); look = tmp.slice(); lookW = 0.8; } }
    else if (has && g && rim && bmode === 'dribble') { this.toLocal(rim.x, 1.8, rim.z, tmp); look = tmp.slice(); lookW = 0.5; }
    if (extra.look) { this.toLocal(extra.look[0], extra.look[1], extra.look[2], tmp); look = tmp.slice(); lookW = 0.8; }
    // ---- smoothing ----
    const out = this.pose;
    const kFast = 1 - Math.exp(-dt * 26), kSlow = 1 - Math.exp(-dt * 12);
    const rawGroups = this.rawGroups(has, a, airborne);
    // explosive actions track their key poses tightly (a lagging hip makes takeoffs look floaty)
    const athletic = a && (a.type === 'shoot' || a.type === 'ftshot' || a.type === 'layup' || a.type === 'dunk' || a.type === 'block' || a.type === 'rebound' || a.type === 'tipjump');
    // v0.4.7.5: everything that isn't pinned (hands on the ball, planted feet) or driving an explosive action eases
    // in and out on a critically damped spring instead of a plain lag: no sudden starts or stops between poses, the
    // head and arms settle a beat after the body (secondary motion), and nothing overshoots
    const vel = this.poseVel || (this.poseVel = new Float32Array(out.length));
    // (sub-stepped at 60 Hz or finer, so the feel is the same at any frame rate and the spring stays stable on a slow frame)
    const wS = 15, nS = Math.min(4, Math.max(1, Math.ceil(dt * 60 - 1e-6))), dtS = Math.min(dt, 1 / 15) / nS;
    for (const [g2, o] of Object.entries(P)) {
      if (g2 === 'N') continue;
      const n = GROUP_SIZE[g2];
      const k = rawGroups.has(g2) ? 1 : (g2.startsWith('foot') || g2.startsWith('pitch') || g2.startsWith('toe') || g2.startsWith('yaw')) ? (wGait > 0.5 ? 1 : kFast) : (athletic && (g2 === 'root' || g2 === 'spine' || g2 === 'chest' || g2.startsWith('knee'))) ? kFast : kSlow;
      if (k === kSlow && !athletic) { // (shots and finishes keep their exact timing: the release is measured off them)
        const w = g2 === 'head' || g2 === 'neck' ? wS * 0.85 : wS;
        for (let i = 0; i < n; i++) { const j = o + i; for (let s2 = 0; s2 < nS; s2++) { vel[j] += (w * w * (T[j] - out[j]) - 2 * w * vel[j]) * dtS; out[j] += vel[j] * dtS; } }
      } else {
        for (let i = 0; i < n; i++) { const j = o + i, prev = out[j]; out[j] += (T[j] - out[j]) * k; vel[j] = (out[j] - prev) / Math.max(dt, 1e-4); }
      }
    }
    this.look = look; this.lookW = lookW;
    const fin = this.outPose;
    fin.set(out);
    const lx = this.land.x;
    if (lx < -1e-4) { fin[P.root + 1] += lx; fin[P.spine] -= lx * 0.9; fin[P.chest] -= lx * 0.3; fin[P.head] += lx * 0.5; }
    this.clearBody(fin);
    if (g && !has) this.clearOthers(fin, p, g);
    this.view.update(fin, st.x, st.y, st.z, st.facing, { look, lookW, palmL: palm.L, palmR: palm.R });
  }

  // v0.4.2 anti-clipping: keep hand targets outside an elliptic torso/hip column (sized by girth and moved
  // with the crouch and forward lean), so idles, size-ups and dribble moves don't bury hands in the body.
  clearBody(f) {
    const g = this.view.model?.d?.girth || 1;
    const root = f[P.root + 1], lean = f[P.spine] + f[P.chest] * 0.6;
    for (const h of ['handL', 'handR']) {
      const o = P[h], side = h === 'handL' ? 1 : -1;
      const by = f[o + 1] - root; // height on the body (reference units)
      // (v0.4.7.5: all the way up the chest to the shoulders, where crossing arms used to pass through)
      if (by < 0.62 || by > 1.66) continue;
      const hips = by < 1.05, chest = by > 1.42;
      const rx = (hips ? 0.235 : chest ? 0.225 : 0.215) * g, rz = (hips ? 0.15 : chest ? 0.15 : 0.145) * g;
      const zc = Math.max(0, by - 0.9) * Math.sin(lean) * 0.9 + (hips ? -0.01 : 0.01);
      const ex = f[o] / rx, ez = (f[o + 2] - zc) / rz, e = Math.hypot(ex, ez);
      if (e >= 1) continue;
      if (e < 0.15) { f[o] = side * rx; continue; } // dead center: push to the hand's own side
      f[o] *= 1 / e; f[o + 2] = zc + (f[o + 2] - zc) / e;
    }
  }

  // v0.4.7.5 limb collisions between players: a reach, a contest or a hand on a man's back stops at his body (an
  // upright column from his hips to his shoulders) instead of going into it
  clearOthers(f, p, g) {
    const s = this.s, c = Math.cos(this.f), sn = Math.sin(this.f);
    for (const h of ['handL', 'handR']) {
      const o = P[h], lx = f[o] * s, ly = f[o + 1] * s, lz = f[o + 2] * s;
      let wx = this.x + c * lx + sn * lz, wz = this.z - sn * lx + c * lz;
      const wy = this.y + ly;
      let moved = false;
      for (const q of g.players) {
        if (q === p || Math.abs(q.x - this.x) > 1.6 || Math.abs(q.z - this.z) > 1.6) continue;
        const Hq = q.phys.H, y0 = q.y + 0.44 * Hq, y1 = q.y + 0.84 * Hq;
        if (wy < y0 || wy > y1) continue;
        const r = q.phys.radius * 0.92, dx = wx - q.x, dz = wz - q.z, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        const k = d > 1e-4 ? r / d : 1; wx = q.x + (d > 1e-4 ? dx : this.x - q.x) * k; wz = q.z + (d > 1e-4 ? dz : this.z - q.z) * k; moved = true;
      }
      if (!moved) continue;
      const dx = wx - this.x, dz = wz - this.z;
      f[o] = (c * dx - sn * dz) / s; f[o + 2] = (sn * dx + c * dz) / s;
    }
  }

  rawGroups(has, a, airborne) {
    const set = new Set();
    if (has) { set.add('handL'); set.add('handR'); }
    if (a && (a.type === 'hang')) { set.add('handL'); set.add('handR'); }
    return set;
  }

  // v0.4.5 quick patch: reaching up with the ball, the shoulder rises (the collarbone lifts), as real shooters' do:
  // ARM_LIFT×H at full height (game.js reachTop counts on it). by: ball height in reference units (H/2)
  liftShoulder(T, side, by) {
    const k = sm(1.9, 2.4, by), sg = side === 'L' ? 1 : -1;
    T[P['clav' + side] + 2] += sg * CLAV_LIFT * k;
  }

  // Hand targets for whoever is holding/dribbling the ball (positions in reference units)
  ballHands(T, p, g, a, b, mode) {
    const r = BALL_R / this.s;
    const palm = this.palm;
    const shootHand = (p.shotPkg?.hand || 'R') === 'L' ? 'L' : 'R';
    const sgn = side => side === 'L' ? 1 : -1;
    if (a && (a.type === 'shoot' || a.type === 'ftshot' || a.type === 'pumpfake')) {
      if (a.released) return;
      const sh = shootHand, gh = sh === 'L' ? 'R' : 'L';
      set3(T, 'hand' + sh, b[0] + sgn(sh) * 0.02, b[1] - r - 0.07, b[2] - 0.06);
      // shooting elbow: tucked for the high-set bases, flared on the push shot
      const est = a.type === 'shoot' && a.kind !== 'close' ? p.shotPkg?.style : 'standard';
      set3(T, 'elbow' + sh, sgn(sh) * (est === 'push' ? 0.6 : est === 'high' ? 0.04 : 0.15), -1, 0.5);
      palm[sh] = { normal: [0, 0.85, 0.5], fingers: [0, 0.75, -0.6], w: 0.9 };
      this.liftShoulder(T, sh, b[1]);
      set3(T, 'hand' + gh, b[0] + sgn(gh) * (r + 0.075), b[1] - 0.04, b[2] - 0.06);
      set3(T, 'elbow' + gh, sgn(gh) * 1, -0.4, 0.1);
      palm[gh] = { normal: [-sgn(gh), 0.1, 0.1], fingers: [0, 0.9, 0.3], w: 0.85 };
      return;
    }
    if (a && (a.type === 'layup' || a.type === 'dunk')) {
      // v0.4.5 stage 7: the one-handed finishes really are one-handed (the free arm does its own thing), and the
      // hand switch, the eastbay and the around-the-back finish in the other hand
      const one = (a.type === 'layup' && a.lstyle !== 'hop') || ONE_HAND_DUNK.has(a.style); // (v0.4.7.5: the hop layup is two-handed)
      const sh = a.type === 'dunk' ? dunkHand(a) : layupHand(a), oh = sh === 'L' ? 'R' : 'L', sg = sh === 'L' ? 1 : -1;
      set3(T, 'hand' + sh, b[0] + sg * 0.02, b[1] - r - 0.07, b[2] - 0.06);
      palm[sh] = { normal: [0, 0.8, 0.55], fingers: [0, 0.8, -0.5], w: 0.85 };
      if (a.type === 'layup') this.liftShoulder(T, sh, b[1]);
      set3(T, 'elbow' + sh, sg * 0.4, -1, 0.3);
      if (!one || (a.type === 'dunk' && a.t < a.takeoff * 0.8) || (a.type === 'layup' && a.t < a.takeoff)) {
        set3(T, 'hand' + oh, b[0] - sg * (r + 0.075), b[1] - 0.03, b[2] - 0.05);
        palm[oh] = { normal: [sg, 0.1, 0.1], fingers: [0, 0.9, 0.3], w: 0.85 };
      }
      return;
    }
    if (a && a.type === 'pass' && !a.released) {
      set3(T, 'handL', b[0] + r + 0.07, b[1] - 0.03, b[2] - 0.08);
      set3(T, 'handR', b[0] - r - 0.07, b[1] - 0.03, b[2] - 0.08);
      palm.L = { normal: [-1, 0, 0.25], fingers: [0, 0.6, 0.8], w: 0.85 };
      palm.R = { normal: [1, 0, 0.25], fingers: [0, 0.6, 0.8], w: 0.85 };
      set3(T, 'elbowL', 0.8, -0.6, -0.5); set3(T, 'elbowR', -0.8, -0.6, -0.5);
      return;
    }
    if (mode === 'dribble') {
      const hand = p.dribble.hand;
      const other = hand === 'L' ? 'R' : 'L';
      const pocket = 0.92;
      const top = b[1] + r + 0.02;
      const hy = Math.max(top, pocket - 0.2);
      // (v0.4.7.5: during a between-the-legs or behind-the-back the hand lets the ball go across rather than chasing
      // it past the middle, so the arm never wraps through the body)
      const mvA = p.action?.type === 'move' ? p.action.move : null, cross = mvA === 'btb' || mvA === 'wrap' || mvA === 'btl' || mvA === 'btlback';
      set3(T, 'hand' + hand, cross ? sgn(hand) * Math.max(sgn(hand) * b[0], 0.25) : b[0] - sgn(hand) * 0.0, hy, cross ? Math.max(b[2] - 0.06, -0.12) : b[2] - 0.06);
      set3(T, 'elbow' + hand, sgn(hand) * 0.6, -0.3, -0.8);
      palm[hand] = { normal: [0, -1, 0.15], fingers: [-sgn(hand) * 0.2, -0.25, 1], w: sm(pocket - 0.05, pocket - 0.25, hy) * 0.5 + 0.4 };
      // off arm: protective bar when a defender is close
      let near = false;
      if (g) for (const d of g.opponents(p)) if (d.dist(p) < 2.2) near = true;
      if (near) { set3(T, 'hand' + other, sgn(other) * 0.36, 1.18, 0.36); set3(T, 'elbow' + other, sgn(other) * 0.9, -0.5, -0.2); }
      else { set3(T, 'hand' + other, sgn(other) * 0.32, 0.98, 0.2); set3(T, 'elbow' + other, sgn(other) * 0.7, -0.5, -0.5); }
      // crossover-type moves: both hands participate around the ball
      if (p.action?.type === 'move') {
        const mv = p.action.move;
        if (mv === 'cross' || mv === 'btl' || mv === 'btb' || mv === 'inout' || mv === 'hang' || mv === 'wrap' || mv === 'pushcross' || mv === 'btlback') {
          const k = Math.sin(Math.min(1, p.action.t / p.action.dur) * Math.PI);
          // (the receiving hand meets the ball on its own side; v0.4.7.5: it never reaches across behind him for it)
          const ox = mv === 'btb' || mv === 'wrap' || mv === 'btl' || mv === 'btlback' ? sgn(other) * Math.max(sgn(other) * (b[0] + sgn(other) * 0.06), 0.25) : b[0] + sgn(other) * 0.06;
          mix3(T, 'hand' + other, ox, Math.max(top, 0.7), mv === 'btb' || mv === 'wrap' ? Math.max(b[2] - 0.05, -0.12) : b[2] - 0.05, k * (b[0] * sgn(other) > -0.05 ? 1 : 0.5));
        }
      } else if (p.dribble.xover && p.dribble.xover !== 'half' && p.dribble.xover !== 'hesi') {
        // size-up crossover: the dribble hand lets go, the other hand meets the ball on its side
        const ph = p.dribble.phase;
        mix3(T, 'hand' + hand, sgn(hand) * 0.3, 0.98, 0.2, sm(0.3, 0.55, ph));
        mix3(T, 'hand' + other, b[0], Math.max(top, 0.55), b[2] - 0.05, sm(0.5, 0.9, ph));
      }
      return;
    }
    // two-hand hold (triple threat / check / catch)
    set3(T, 'handL', b[0] + r + 0.075, b[1] - 0.03, b[2] - 0.07);
    set3(T, 'handR', b[0] - r - 0.075, b[1] - 0.03, b[2] - 0.07);
    set3(T, 'elbowL', 0.9, -0.7, -0.4); set3(T, 'elbowR', -0.9, -0.7, -0.4);
    palm.L = { normal: [-1, 0.05, 0.2], fingers: [0, 0.75, 0.65], w: 0.85 };
    palm.R = { normal: [1, 0.05, 0.2], fingers: [0, 0.75, 0.65], w: 0.85 };
  }

  // v0.4.5 stage 7: the jump-shot follow-through on its own, so it can outlast the shot action itself (a Statue
  // or a Wave is held well after he lands; the shot action ends ~0.55 s after the release). inAction: false when
  // it's being held after the action ended; returns true once the hold is over.
  followThrough(T, a, p, t, style, inAction) {
    const s = this.s, tR = a.tRel || 0.6;
    const relS = p.shotPkg?.release || 'classic';
    const sh = (p.shotPkg?.hand || 'R') === 'L' ? 'L' : 'R', sg = sh === 'L' ? 1 : -1;
    // follow-through: elbow locked above the eyes, wrist flexed, guide hand peels off and drops
    const gh = sh === 'L' ? 'R' : 'L';
    // v0.4.5 stage 7: every release has a follow-through of its own (shape, motion and how long it's held),
    // not just a different hold time. k: blend in (s), y: height over the release point, z: reach out in
    // front, f: wrist (finger pitch; more negative = more curled), hold: s after the release, air: the arm
    // comes down even while he's still in the air, gx: how wide the guide hand peels off
    const F = FOLLOW[relS] || FOLLOW.classic;
    const since = t - (a.releaseAt ?? tR);
    const k = Math.min(1, since / F.k);
    const relY = (p.phys.reach * (p.shotPkg?.relK ?? 0.93)) / s;
    set3(T, 'hand' + sh, sg * 0.05, relY + F.y - (1 - k) * 0.03, 0.36 + k * (F.z - 0.36));
    set3(T, 'elbow' + sh, sg * (style === 'push' ? 0.45 : 0.1), -0.6, 0.6);
    this.palm[sh] = { normal: [0, -0.45, 0.9], fingers: [0, F.f, 0.6], w: 0.9 };
    set3(T, 'hand' + gh, -sg * (F.gx || 0.26), relY - 0.14 - k * 0.12, 0.28);
    set3(T, 'elbow' + gh, -sg * 0.6, -0.6, 0.45);
    const H2 = 'hand' + sh, G2 = 'hand' + gh;
    if (relS === 'quick') {
      // compact: elbow stays bent, hand at the forehead, guide hand already on its way down
      set3(T, 'elbow' + sh, sg * 0.55, -0.9, 0.3);
      set3(T, G2, -sg * 0.3, relY - 0.14 - k * 0.6, 0.22);
    } else if (relS === 'high') {
      // straight up, the guide hand up beside the shooting arm
      set3(T, G2, -sg * 0.17, relY - 0.05, 0.24); this.palm[gh] = { normal: [sg, 0, 0.2], fingers: [0, 1, 0], w: 0.8 };
    } else if (relS === 'snap') {
      // the wrist snaps all the way down and the hand recoils back toward the head
      const q = Math.min(1, Math.max(0, since - F.k) / 0.12);
      T[P[H2] + 1] += 0.03 * q; T[P[H2] + 2] -= 0.17 * q; T[P.head] += -0.06 * q;
    } else if (relS === 'float') {
      // held up, then it floats slowly down out in front
      const d = Math.min(1, since / F.hold);
      T[P[H2] + 1] -= 0.46 * d * d; T[P[H2] + 2] += 0.16 * d;
      set3(T, G2, -sg * 0.26, relY - 0.17, 0.28);
    } else if (relS === 'butter') {
      // smooth: the wrist rolls through a slow circle while the guide hand eases down
      const ph = since * 5.5;
      T[P[H2]] += sg * 0.07 * (Math.cos(ph) - 1); T[P[H2] + 1] += 0.06 * Math.sin(ph);
      this.palm[sh] = { normal: [0, -0.45, 0.9], fingers: [sg * 0.3 * Math.sin(ph), F.f, 0.6], w: 0.9 };
      set3(T, G2, -sg * 0.26, relY - 0.14 - 0.34 * Math.min(1, since / F.hold), 0.28);
    } else if (relS === 'feather') {
      // soft wrist; the guide hand stays up, open, out to the side
      set3(T, G2, -sg * 0.44, relY - 0.05, 0.2); set3(T, 'elbow' + gh, -sg * 1, -0.2, 0.1);
      this.palm[gh] = { normal: [0, 0, 1], fingers: [-sg * 0.3, 1, 0], w: 0.8 };
    } else if (relS === 'dart') {
      // flat and straight at the rim: the arm thrown out in front at eye level, guide hand tucked
      set3(T, 'elbow' + sh, sg * 0.05, -0.25, 1);
      set3(T, G2, -sg * 0.16, 1.42, 0.3); set3(T, 'elbow' + gh, -sg * 0.7, -1, 0);
    } else if (relS === 'rainbow') {
      // the hand keeps tracing the arc up and over after the ball is gone
      const d = Math.min(1, since / 0.6);
      set3(T, H2, sg * 0.05, relY + F.y + 0.1 * Math.sin(Math.PI * d) - 0.12 * d, F.z + 0.36 * d);
    } else if (relS === 'laser') {
      // the guide hand comes up to the brow like a visor, eyes on the rim
      const q = Math.min(1, Math.max(0, since - 0.06) / 0.14);
      set3(T, G2, -sg * (0.26 - 0.22 * q), relY - 0.14 - 0.12 * k + q * (1.92 - (relY - 0.26)), 0.28 - 0.1 * q);
      set3(T, 'elbow' + gh, -sg * 1, 0.1, 0.1); this.palm[gh] = { normal: [0, -1, 0.1], fingers: [sg * 1, 0, 0.25], w: 0.85 * q };
    } else if (relS === 'wave') {
      const w = Math.sin(since * 9); T[P[H2]] += sg * 0.04 * w; this.palm[sh] = { normal: [0, -0.45, 0.9], fingers: [0.25 * w, F.f, 0.6], w: 0.9 };
    } else if (relS === 'hold') {
      // a statue: the arm frozen high, the guide hand dropped straight to his side
      set3(T, G2, -sg * 0.27, 1.04, 0.12); set3(T, 'elbow' + gh, -sg * 0.35, -1, -0.25); this.palm[gh] = null;
    } else if (relS === 'snatch' && since > F.k) {
      const q = Math.min(1, (since - F.k) / 0.14); set3(T, H2, sg * (0.05 + 0.2 * q), relY - q * 0.72, 0.36 - q * 0.1); set3(T, 'elbow' + sh, sg * 0.6, -1, -0.2);
    } else if (relS === 'twohand') {
      set3(T, G2, -sg * 0.12, relY + F.y - 0.02, 0.34 + k * 0.08); set3(T, 'elbow' + gh, -sg * 0.2, -0.6, 0.6); this.palm[gh] = { normal: [0, -0.4, 0.9], fingers: [0, -0.7, 0.6], w: 0.85 };
    } else if (relS === 'point' && since > 0.26) {
      const q = Math.min(1, (since - 0.26) / 0.16); set3(T, H2, sg * (0.05 - 0.05 * q), relY + F.y - q * 0.22, 0.36 + q * 0.3); this.palm[sh] = { normal: [0, -0.2, 1], fingers: [0, -0.3, 1], w: 0.9 };
    } else if (relS === 'cobra') { set3(T, 'elbow' + sh, sg * 0.02, -0.2, 0.8); T[P.head] = -0.22; }
    // v0.4.7.5 follow-throughs
    else if (RELEASE2[relS]) RELEASE2[relS](T, since, k, relY, sh, sg, gh, H2, G2, F, this);
    if (a.icon === 'sharpeye') {
      // hold the gooseneck high and fan the fingers out, off hand pointing at the rim
      set3(T, 'hand' + sh, sg * 0.03, relY + 0.12, 0.42);
      set3(T, 'elbow' + sh, sg * 0.02, -0.25, 0.85);
      this.palm[sh] = { normal: [0, -0.5, 0.86], fingers: [sg * 0.2, -1.05, 0.5], w: 0.95 };
      set3(T, 'hand' + gh, -sg * 0.34, relY - 0.08, 0.42); set3(T, 'elbow' + gh, -sg * 0.8, -0.3, 0.5);
      this.palm[gh] = { normal: [0, -0.2, 1], fingers: [0, -0.4, 1], w: 0.8 };
    }
    const hold = (a.releaseAt ?? tR) + (p.airborne && !F.air ? 9 : F.hold);
    if (t > hold) {
      if (!inAction) return true;
      // arms come down by the sides; elbow poles point down/back the whole way so they can't flip out
      set3(T, 'hand' + sh, sg * 0.27, 1.02, 0.12); set3(T, 'hand' + gh, -sg * 0.27, 1.02, 0.12);
      set3(T, 'elbow' + sh, sg * 0.35, -1, -0.25); set3(T, 'elbow' + gh, -sg * 0.35, -1, -0.25);
      this.palm[sh] = null; this.palm[gh] = null;
    }
    return t > hold;
  }

  actionPose(T, a, p, g, b, bm, rim) {
    const t = a.t;
    const s = this.s;
    const tmp = [0, 0, 0];
    switch (a.type) {
      case 'shoot': case 'ftshot': {
        // Jump-shot phases from shooting kinematics: countermovement (knees to ~110-120°, trunk inclines
        // ~10°), triple extension (hip/knee/ankle) with the heels lifting just before takeoff, a near-
        // straight-legged flight with pointed toes, release just before the apex, then a held follow-through
        // ("gooseneck" wrist) until the landing absorbs.
        const ft = a.type === 'ftshot';
        const tR = a.tRel || 0.6, tk = ft ? tR * 0.92 : (a.takeoff ?? tR * 0.36);
        const deep = Math.max(0, Math.min(1, ((a.dRim ?? 5) - 4) / 4));
        // v0.4.3: each jump-shot base has its own body language (dip, legs in the air, lean) and each release
        // its own follow-through
        const style = ft || a.kind === 'close' ? 'standard' : (p.shotPkg?.style || 'standard'), relS = p.shotPkg?.release || 'classic';
        // v0.4.5 bases dip differently too: the slingshot loads deep, the hitch is tall, the fade barely dips
        const DIP = { push: 0.035, flick: -0.025, high: 0.01, wide: 0.045, sniper: -0.02, fade: -0.015, hitch: 0.02, sling: 0.06, scissor: 0.005, tuck: 0.015, sway: 0, silk: 0.03,
          pogo: -0.03, stork: 0.01, frog: 0.06, corkscrew: 0.02, heel: 0.0, turbo: -0.05, onestep: 0.03, tilt: 0.01, catapult: 0.04, statue: -0.04, bounce: 0.02, whip: 0.035, dip: 0.08, leaner: 0.02, bicycle: 0.01 };
        const dip = ft ? 0.1 : a.kind === 'close' ? 0.11 : 0.15 + 0.04 * deep + (DIP[style] || 0);
        const sh = (p.shotPkg?.hand || 'R') === 'L' ? 'L' : 'R', sg = sh === 'L' ? 1 : -1;
        if (t < 0) { T[P.root + 1] = -0.05; T[P.spine] = 0.14; } // free-throw routine dribbles
        else if (!p.airborne && !(a.released && t > tk + 0.1)) {
          const tDown = tk * 0.58;
          let y, heel = 0;
          if (t < tDown) { const q = t / Math.max(0.05, tDown); y = -dip * Math.sin(q * Math.PI / 2) ** 1.4; }
          else { const q = Math.min(1, (t - tDown) / Math.max(0.04, tk - tDown)); y = lerp(-dip, 0.025, q * q); heel = sm(0.55, 1, q); }
          T[P.root + 1] = y - 0.03 * (1 - sm(0, 0.15, t));
          // v0.4.7.5 pro hop: the two-foot hop sideways before he sets and rises
          if (a.hustle === 'prohop' && a.hopEnd && t < a.hopEnd) { const hq = Math.sin(Math.PI * t / a.hopEnd); T[P.root + 1] += 0.12 * hq; set3(T, 'footL', 0.12, 0.08 + 0.12 * hq, 0.02); set3(T, 'footR', -0.12, 0.08 + 0.12 * hq, 0.02); T[P.pitchL] = 0.5 * hq; T[P.pitchR] = 0.5 * hq; }
          // shooting-side foot slightly ahead, toes turned a touch toward the off side
          set3(T, 'foot' + sh, sg * 0.13, 0.08, 0.06); set3(T, 'foot' + (sh === 'L' ? 'R' : 'L'), -sg * 0.13, 0.08, -0.03);
          T[P.pitchL] = heel * 0.42; T[P.pitchR] = heel * 0.42; T[P.toeL] = -heel * 0.38; T[P.toeR] = -heel * 0.38;
          set3(T, 'kneeL', 0.12, 0, 1); set3(T, 'kneeR', -0.12, 0, 1);
          // v0.4.4 bases: wide stance sets with the feet well outside the hips; sniper squares up, feet under him
          if (style === 'wide') { set3(T, 'footL', 0.27, 0.08, 0.02); set3(T, 'footR', -0.27, 0.08, 0.0); set3(T, 'kneeL', 0.4, 0, 1); set3(T, 'kneeR', -0.4, 0, 1); }
          else if (style === 'sniper') { set3(T, 'footL', 0.11, 0.08, 0.02); set3(T, 'footR', -0.11, 0.08, 0.02); }
          // v0.4.7.5 bases on the floor: the Pogo double-bounces, the 1-2 Step and the Bounce step into it, the Frog
          // sits wide, the Dip sinks the deepest
          else if (style === 'pogo') { const b2 = Math.abs(Math.sin(t / Math.max(0.05, tk) * Math.PI * 2)); T[P.root + 1] = y * 0.6 - 0.04 * b2; }
          else if (style === 'onestep' || style === 'bounce') { const st2 = sm(0, 0.6, t / Math.max(0.05, tk)); set3(T, 'foot' + sh, sg * 0.13, 0.08 + 0.1 * Math.sin(st2 * Math.PI), 0.06 + 0.22 * st2); }
          else if (style === 'frog') { set3(T, 'footL', 0.07, 0.08, 0.02); set3(T, 'footR', -0.07, 0.08, 0.0); set3(T, 'kneeL', 0.8, 0, 1); set3(T, 'kneeR', -0.8, 0, 1); }
          else if (style === 'dip') { T[P.spine] = 0.18; }
          else if (style === 'whip') { T[P.chest + 1] = -sg * 0.2 * (1 - sm(0, 1, t / Math.max(0.05, tk))); }
          const inc = -y / dip; // trunk follows the dip
          T[P.spine] = 0.04 + inc * 0.12; T[P.chest] = 0.02 + inc * 0.05;
        } else if (p.airborne) {
          T[P.root + 1] = 0.0;
          // near-straight legs hang under the hips, toes pointed; a slight tuck at the top of the jump
          const tuck = a.released ? 0.006 : 0.016;
          set3(T, 'footL', 0.12, 0.085 + tuck, 0.03); set3(T, 'footR', -0.12, 0.085 + tuck * 1.3, -0.01);
          T[P.pitchL] = 0.62; T[P.pitchR] = 0.66; T[P.toeL] = 0; T[P.toeR] = 0;
          set3(T, 'kneeL', 0.1, 0, 1); set3(T, 'kneeR', -0.1, 0, 1);
          T[P.spine] = -0.02; T[P.chest] = -0.03;
          if (style === 'high') { set3(T, 'footL', 0.08, 0.08, 0.0); set3(T, 'footR', -0.08, 0.08, -0.01); T[P.pitchL] = 0.72; T[P.pitchR] = 0.72; T[P.spine] = -0.05; T[P.head] = -0.16; }
          else if (style === 'flick') { set3(T, 'footL', 0.13, 0.13, -0.09); set3(T, 'footR', -0.13, 0.14, -0.11); T[P.spine] = 0.04; }
          else if (style === 'push') { set3(T, 'foot' + sh, sg * 0.13, 0.1, 0.13); set3(T, 'foot' + (sh === 'L' ? 'R' : 'L'), -sg * 0.13, 0.12, -0.12); T[P.spine] = 0.03; }
          // (stage 7: both legs kick well out in front, so it reads differently from the Fadeaway's split)
          else if (style === 'lean') { const ko = sm(0, 0.2, t - tk); set3(T, 'footL', 0.13, 0.12 + ko * 0.12, 0.13 + ko * 0.16); set3(T, 'footR', -0.13, 0.11 + ko * 0.1, 0.11 + ko * 0.15); set3(T, 'kneeL', 0.12, 0.2, 1); set3(T, 'kneeR', -0.12, 0.2, 1); T[P.spine] = -0.17; T[P.chest] = -0.08; }
          // v0.4.4: kick out = the off-side leg swings forward with a bent knee at the top of the jump
          else if (style === 'kick') { const off = sh === 'L' ? 'R' : 'L', k2 = sm(0, 0.18, t - tk); set3(T, 'foot' + off, -sg * 0.15, 0.1 + 0.2 * k2, 0.02 + 0.3 * k2); set3(T, 'knee' + off, -sg * 0.15, 0.3 * k2, 1); T[off === 'L' ? P.pitchL : P.pitchR] = 0.45; T[P.spine] = -0.04; }
          else if (style === 'wide') { set3(T, 'footL', 0.27, 0.09, 0.02); set3(T, 'footR', -0.27, 0.09, 0.0); set3(T, 'kneeL', 0.4, 0, 1); set3(T, 'kneeR', -0.4, 0, 1); T[P.spine] = 0.0; }
          else if (style === 'sniper') { set3(T, 'footL', 0.1, 0.08, 0.02); set3(T, 'footR', -0.1, 0.08, 0.02); T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; T[P.spine] = -0.02; T[P.head] = -0.1; }
          // v0.4.5 bases
          // (stage 7: the legs really split, front and back, with the shoulders opened up)
          else if (style === 'fade') { set3(T, 'foot' + sh, sg * 0.17, 0.14, 0.24); set3(T, 'foot' + (sh === 'L' ? 'R' : 'L'), -sg * 0.17, 0.12, -0.16); T[P.spine] = -0.24; T[P.chest] = -0.12; T[P.chest + 1] = sg * 0.16; T[P.head] = 0.06; T[P.pitchL] = 0.5; T[P.pitchR] = 0.5; }
          else if (style === 'hitch') { const h = sm(0, 0.16, t - tk) * (1 - sm(0.3, 0.52, t - tk)); set3(T, 'footL', 0.11, 0.09 + h * 0.3, 0.04 + h * 0.22); set3(T, 'footR', -0.11, 0.09 + h * 0.3, 0.02 + h * 0.2); set3(T, 'kneeL', 0.2, h * 0.5, 1); set3(T, 'kneeR', -0.2, h * 0.5, 1); T[P.spine] = -0.03; }
          else if (style === 'sling') { set3(T, 'footL', 0.14, 0.1, -0.2); set3(T, 'footR', -0.14, 0.11, -0.24); set3(T, 'kneeL', 0.2, -0.3, 1); set3(T, 'kneeR', -0.2, -0.3, 1); T[P.pitchL] = 0.85; T[P.pitchR] = 0.85; T[P.spine] = 0.06; T[P.head] = -0.18; }
          else if (style === 'scissor') { const sc = Math.sin(Math.min(1, (t - tk) / 0.3) * Math.PI); set3(T, 'footL', 0.12, 0.1 + sc * 0.2, 0.05 + sc * 0.42); set3(T, 'footR', -0.12, 0.1 + sc * 0.16, -0.03 - sc * 0.4); set3(T, 'kneeL', 0.15, sc * 0.4, 1); set3(T, 'kneeR', -0.15, -sc * 0.3, 1); T[P.pitchL] = 0.5; T[P.pitchR] = 0.8; }
          else if (style === 'tuck') { const tu = sm(0, 0.2, t - tk); set3(T, 'footL', 0.13, 0.09 + tu * 0.4, 0.04 + tu * 0.3); set3(T, 'footR', -0.13, 0.09 + tu * 0.42, 0.02 + tu * 0.3); set3(T, 'kneeL', 0.26, tu * 0.5, 1); set3(T, 'kneeR', -0.26, tu * 0.5, 1); T[P.pitchL] = 0.55; T[P.pitchR] = 0.55; T[P.spine] = -0.02 - tu * 0.04; }
          // Silk: feet together, drifting forward under him through the whole jump, shoulders level
          else if (style === 'silk') { const dr = sm(0, 0.32, t - tk); set3(T, 'footL', 0.075, 0.1 + dr * 0.05, 0.05 + dr * 0.16); set3(T, 'footR', -0.075, 0.1 + dr * 0.08, 0.03 + dr * 0.15); set3(T, 'kneeL', 0.1, 0.15, 1); set3(T, 'kneeR', -0.1, 0.15, 1); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; T[P.spine] = 0.02; T[P.chest] = -0.02; T[P.head] = -0.13; }
          else if (style === 'sway') { const off = sh === 'L' ? 'R' : 'L', sy = sm(0, 0.2, t - tk); set3(T, 'foot' + off, -sg * (0.14 + sy * 0.3), 0.1 + sy * 0.12, 0.02); set3(T, 'knee' + off, -sg * (0.3 + sy * 0.5), 0.1, 1); set3(T, 'foot' + sh, sg * 0.1, 0.09, 0.03); T[P.spine + 2] = sg * 0.12 * sy; T[P.chest + 2] = sg * 0.08 * sy; T[P.spine] = -0.06; }
          else if (AIR2[style]) AIR2[style](T, t - tk, sh, sg);
          if (a.fade) { T[P.spine] = -0.16; T[P.chest] = -0.08; set3(T, 'footL', 0.12, 0.11, 0.12); set3(T, 'footR', -0.12, 0.12, 0.1); }
          // v0.4.7.5 hustle shots: the run carries into the air
          if (a.hustle === 'pullup') { const o2 = sh === 'L' ? 'R' : 'L'; set3(T, 'foot' + sh, sg * 0.12, 0.2, 0.26); set3(T, 'knee' + sh, sg * 0.12, 0.3, 1); set3(T, 'foot' + o2, -sg * 0.12, 0.22, -0.28); set3(T, 'knee' + o2, -sg * 0.14, -0.2, 1); T[P.spine] = 0.06; T[P.chest] = 0.02; T[sh === 'L' ? P.pitchL : P.pitchR] = 0.4; T[o2 === 'L' ? P.pitchL : P.pitchR] = 0.85; }
          else if (a.hustle === 'runfade') { const o2 = sh === 'L' ? 'R' : 'L'; set3(T, 'foot' + sh, sg * 0.16, 0.18, 0.32); set3(T, 'foot' + o2, -sg * 0.14, 0.14, -0.1); set3(T, 'knee' + sh, sg * 0.16, 0.25, 1); T[P.spine] = -0.3; T[P.chest] = -0.14; T[P.head] = 0.08; T[P.chest + 1] = sg * 0.12; }
          else if (a.hustle === 'prohop') { set3(T, 'footL', 0.13, 0.13, 0.03); set3(T, 'footR', -0.13, 0.13, 0.03); set3(T, 'kneeL', 0.25, 0.1, 1); set3(T, 'kneeR', -0.25, 0.1, 1); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; T[P.spine] = 0.0; }
        } else { T[P.spine] = 0.08; T[P.chest] = 0.02; }
        T[P.head] = -0.12;
        // v0.4.5 Sharp Eye (Icon badge): an exaggerated high set with the off hand flared, and the legs
        // kicked together under him — the flashiest jumper in the game
        if (a.icon === 'sharpeye' && p.airborne) {
          set3(T, 'footL', 0.07, 0.11, 0.06); set3(T, 'footR', -0.07, 0.12, 0.04);
          T[P.pitchL] = 0.85; T[P.pitchR] = 0.85; T[P.spine] = -0.1; T[P.chest] = -0.05; T[P.head] = -0.22;
          T[P.chest + 1] = sg * 0.12;
        }
        if (a.released) this.followThrough(T, a, p, t, style, true);
        break;
      }
      case 'pumpfake': {
        const k = Math.sin(Math.min(1, t / a.dur) * Math.PI);
        T[P.root + 1] = -0.06 + k * 0.05; T[P.spine] = 0.05 - k * 0.1; T[P.head] = -0.15 * k;
        break;
      }
      case 'layup': {
        const tk = a.takeoff;
        if (!p.airborne && t < tk) {
          // gather steps: last step long, low
          const q = t / Math.max(0.05, tk);
          T[P.root + 1] = -0.06 - Math.sin(q * Math.PI) * 0.14;
          T[P.spine] = 0.25;
          // v0.4.7.5: the hop gathers off both feet with a little jump; the spin keeps the elbows in and the ball tight
          if (a.lstyle === 'hop') { const h = Math.sin(Math.min(1, q / 0.6) * Math.PI); T[P.root + 1] += 0.1 * h; set3(T, 'footL', 0.14, 0.08 + 0.12 * h, 0.06); set3(T, 'footR', -0.14, 0.08 + 0.12 * h, 0.06); }
          if (a.lstyle === 'spin') { T[P.spine] = 0.32; T[P.root + 1] -= 0.04; }
        } else if (p.airborne) {
          // one-foot takeoff: right knee drives up, left leg trails
          set3(T, 'footR', -0.1, 0.55, 0.32); set3(T, 'kneeR', -0.1, 0.3, 1); T[P.pitchR] = 0.5;
          set3(T, 'footL', 0.1, 0.18, -0.22); set3(T, 'kneeL', 0.1, 0, 1); T[P.pitchL] = 0.8;
          T[P.spine] = -0.05; T[P.chest] = -0.05; T[P.head] = -0.2;
          // v0.4.5 layup packages
          const ls = a.lstyle || 'basic', sw = a.lsDir || 1;
          if (ls === 'euro') {
            // long step across, body leaning away from the contact
            const q = Math.min(1, (t - tk) / 0.3);
            set3(T, 'footR', -0.1 + sw * 0.3 * q, 0.42, 0.42); set3(T, 'footL', 0.1 + sw * 0.1, 0.2, -0.3);
            T[P.spine + 2] = -sw * 0.22; T[P.chest + 2] = -sw * 0.12; T[P.root] = sw * 0.08 * q;
          } else if (ls === 'finger') {
            // stretched out tall, the off hand tucked in
            set3(T, 'footR', -0.1, 0.42, 0.42); T[P.spine] = -0.12; T[P.head] = -0.3;
            set3(T, 'handL', 0.28, 1.4, 0.1); set3(T, 'elbowL', 0.9, -0.6, -0.2);
          } else if (ls === 'scoop') {
            // low and underneath: shoulders dip, the ball comes up from the hip
            set3(T, 'footR', -0.1, 0.5, 0.42); set3(T, 'kneeR', -0.1, 0.45, 1);
            T[P.spine] = 0.16; T[P.chest] = 0.1; T[P.head] = -0.34;
            set3(T, 'elbowR', -1, -0.9, -0.1);
          } else if (ls === 'reverse') {
            // under the rim: the chest turns away, the head looks back up over the right shoulder, knees up together
            const q = Math.min(1, (t - tk) / 0.32);
            set3(T, 'footL', 0.12, 0.34, 0.16); set3(T, 'footR', -0.12, 0.36, 0.18); set3(T, 'kneeL', 0.2, 0.3, 1); set3(T, 'kneeR', -0.2, 0.3, 1);
            T[P.chest + 1] = -0.5 * q; T[P.spine + 1] = -0.2 * q; T[P.head + 1] = -0.6 * q; T[P.spine] = -0.14; T[P.head] = -0.3;
            set3(T, 'handL', 0.42, 1.35, 0.1); set3(T, 'elbowL', 1, -0.4, -0.3);
          } else if (ls === 'hop') {
            // two-foot takeoff: both knees up evenly, square to the rim
            set3(T, 'footL', 0.14, 0.36, 0.14); set3(T, 'footR', -0.14, 0.36, 0.14); set3(T, 'kneeL', 0.3, 0.3, 1); set3(T, 'kneeR', -0.3, 0.3, 1);
            T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; T[P.spine] = 0.04; T[P.head] = -0.2;
          } else if (ls === 'floater') {
            // a soft, upright float: legs together kicking out in front a touch, head back
            set3(T, 'footL', 0.08, 0.2, 0.22); set3(T, 'footR', -0.08, 0.24, 0.26); set3(T, 'kneeL', 0.1, 0.2, 1); set3(T, 'kneeR', -0.1, 0.2, 1);
            T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; T[P.spine] = -0.16; T[P.chest] = -0.08; T[P.head] = -0.32;
            set3(T, 'handL', 0.3, 1.5, 0.3); set3(T, 'elbowL', 0.9, -0.5, 0);
          } else if (ls === 'spin') {
            // out of the spin: the trail leg still swinging round, elbows in
            set3(T, 'footL', 0.2, 0.3, -0.2); set3(T, 'kneeL', 0.4, -0.1, 1); T[P.chest + 1] = (a.spinDir || 1) * 0.25; T[P.spine] = 0.02;
          }
          // v0.4.5 coverage: how the defense is playing it changes the finish (see shots.js LAYUP_COVER)
          const cv = a.cov || 'open', cs = a.covSide || 1, fh = layupHand(a), fs = fh === 'L' ? 1 : -1, oh = fh === 'L' ? 'R' : 'L';
          const up = Math.min(1, Math.max(0, (t - tk) / Math.max(0.1, a.release - tk)));
          if (cv === 'side') {
            // lean away, shoulder into the contact, the near arm up as a shield
            T[P.spine + 2] = -cs * 0.2; T[P.chest + 1] = cs * 0.24; T[P.head + 1] = -cs * 0.12;
            set3(T, 'hand' + oh, -fs * 0.34, 1.52, 0.32); set3(T, 'elbow' + oh, -fs * 1, -0.2, 0.3);
          } else if (cv === 'front') {
            // the hang: knees tucked up together, body curled around the ball, then it goes back up
            const tuck = Math.sin(Math.min(1, up) * Math.PI);
            set3(T, 'footL', 0.11, 0.3 + 0.24 * tuck, 0.1 + 0.18 * tuck); set3(T, 'footR', -0.11, 0.34 + 0.24 * tuck, 0.12 + 0.18 * tuck);
            set3(T, 'kneeL', 0.2, 0.4, 1); set3(T, 'kneeR', -0.2, 0.4, 1); T[P.spine] = 0.04 + 0.16 * tuck; T[P.chest] = 0.08 * tuck; T[P.head] = -0.1;
          } else if (cv === 'rim') {
            // the reverse: shoulders turn away from the shot blocker, head back over the shoulder at the rim
            T[P.chest + 1] = cs * 0.5 * up; T[P.spine + 1] = cs * 0.2 * up; T[P.head + 1] = cs * 0.55 * up; T[P.spine] = -0.12; T[P.head] = -0.28;
            set3(T, 'hand' + oh, -fs * 0.4, 1.35, 0.05); set3(T, 'elbow' + oh, -fs * 1, -0.4, -0.3);
          } else if (cv === 'trail') {
            // up high and away from the chaser: stretched tall, legs long under him
            set3(T, 'footR', -0.1, 0.36, 0.24); set3(T, 'footL', 0.1, 0.12, -0.08); T[P.pitchL] = 0.9; T[P.pitchR] = 0.8;
            T[P.spine] = -0.16; T[P.head] = -0.36;
          }
          if (a.released) {
            const P2 = 'hand' + fh;
            if (cv === 'rim') { set3(T, P2, fs * 0.12, 2.36, 0.02); this.palm[fh] = { normal: [-fs * 0.3, 0.6, -0.7], fingers: [0, 0.9, 0.2], w: 0.85 }; }
            else if (ls === 'scoop') { set3(T, P2, fs * 0.08, 2.2, 0.5); this.palm[fh] = { normal: [0, 0.95, 0.2], fingers: [0, 0.4, 0.9], w: 0.85 }; }
            else if (ls === 'finger') { set3(T, P2, fs * 0.05, 2.58, 0.36); this.palm[fh] = { normal: [0, 0.1, 1], fingers: [0, 0.85, -0.5], w: 0.9 }; }
            else if (ls === 'reverse') { set3(T, P2, fs * 0.3, 2.05, -0.1); this.palm[fh] = { normal: [0, 0.6, -0.8], fingers: [0, 0.8, 0.2], w: 0.85 }; }
            else { set3(T, P2, fs * 0.06, 2.45, 0.32); this.palm[fh] = { normal: [0, 0.3, 0.95], fingers: [0, 0.95, -0.2], w: 0.8 }; }
          }
          if (ls !== 'finger' && ls !== 'scoop' && ls !== 'hop' && ls !== 'reverse' && ls !== 'floater' && cv !== 'side' && cv !== 'rim') { set3(T, 'hand' + oh, -fs * 0.35, 1.7, 0.2); set3(T, 'elbow' + oh, -fs * 1, -0.3, 0); }
        } else { T[P.root + 1] = -0.12; T[P.spine] = 0.2; }
        break;
      }
      case 'dunk': case 'oop': {
        const tk = a.takeoff ?? 0;
        if (!p.airborne && t < tk) {
          const q = t / Math.max(0.05, tk);
          T[P.root + 1] = -0.08 - Math.sin(q * Math.PI) * 0.2;
          T[P.spine] = 0.3;
        } else if (p.airborne) {
          const st = a.style, two = st === 'power' || st === 'double' || st === '360';
          const up = a.slam ? Math.min(1, Math.max(0, (t - tk) / Math.max(0.1, a.slam - tk))) : 1;
          if (st === '360') {
            // tight tuck through the spin
            set3(T, 'footL', 0.12, 0.42, -0.02); set3(T, 'footR', -0.12, 0.4, -0.04); T[P.pitchL] = 0.75; T[P.pitchR] = 0.75; set3(T, 'kneeL', 0.25, 0, 1); set3(T, 'kneeR', -0.25, 0, 1);
          } else if (st === 'cradle') {
            // knees driven up together while the ball swings out wide
            set3(T, 'footL', 0.1, 0.5, 0.18); set3(T, 'footR', -0.1, 0.52, 0.2); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6; set3(T, 'kneeL', 0.2, 0.4, 1); set3(T, 'kneeR', -0.2, 0.4, 1);
          } else if (st === 'windmill') {
            // split legs, lead knee high, trail leg kicked back
            set3(T, 'footR', -0.1, 0.62, 0.34); set3(T, 'kneeR', -0.1, 0.3, 1); set3(T, 'footL', 0.12, 0.34, -0.42); set3(T, 'kneeL', 0.1, -0.2, 1); T[P.pitchL] = 0.9; T[P.pitchR] = 0.5;
          } else if (st === 'double') {
            // legs kick back as the ball comes down, then snap forward for the slam
            const back = Math.sin(Math.min(1, up / 0.75) * Math.PI);
            set3(T, 'footL', 0.14, 0.3 + back * 0.15, 0.05 - back * 0.3); set3(T, 'footR', -0.14, 0.3 + back * 0.12, 0.05 - back * 0.28); T[P.pitchL] = 0.75; T[P.pitchR] = 0.75; set3(T, 'kneeL', 0.3, 0, 1); set3(T, 'kneeR', -0.3, 0, 1);
          } else if (st === 'hammer') {
            // trail leg kicked back hard, chest open, and the shoulders twisted toward the ball cocked over his shoulder
            set3(T, 'footR', -0.12, 0.3, -0.5); set3(T, 'kneeR', -0.12, -0.3, 1); set3(T, 'footL', 0.12, 0.5, 0.22); set3(T, 'kneeL', 0.14, 0.3, 1); T[P.pitchL] = 0.6; T[P.pitchR] = 0.9;
            T[P.chest + 1] = -0.38 * Math.sin(Math.min(1, (a.t / Math.max(0.1, a.slam)) / 0.72) * Math.PI);
          } else if (st === 'rimrock') {
            // both heels kicked up behind him, back arched while the ball is behind the head
            const bk2 = Math.sin(Math.min(1, (a.t / Math.max(0.1, a.slam)) / 0.76) * Math.PI);
            set3(T, 'footL', 0.13, 0.42 + 0.12 * bk2, -0.3 - 0.12 * bk2); set3(T, 'footR', -0.13, 0.44 + 0.12 * bk2, -0.32 - 0.12 * bk2);
            set3(T, 'kneeL', 0.2, -0.3, 1); set3(T, 'kneeR', -0.2, -0.3, 1); T[P.pitchL] = 0.95; T[P.pitchR] = 0.95;
          } else if (st === 'bully') {
            // lead shoulder turned into the defender, lead knee up, legs braced for the contact
            set3(T, 'footL', 0.18, 0.56, 0.24); set3(T, 'kneeL', 0.3, 0.35, 1); set3(T, 'footR', -0.2, 0.26, -0.12); set3(T, 'kneeR', -0.28, 0, 1);
            T[P.pitchL] = 0.55; T[P.pitchR] = 0.75; T[P.chest + 1] = 0.36 * (1 - up * 0.6); T[P.spine + 2] = -0.14;
          } else if (st === 'aroundback') {
            // knees up together while the ball wraps around his back, the shoulders turning with it
            const k = Math.min(1, (a.t / Math.max(0.1, a.slam)) / 0.72);
            set3(T, 'footL', 0.11, 0.46, 0.12); set3(T, 'footR', -0.11, 0.48, 0.12); set3(T, 'kneeL', 0.2, 0.35, 1); set3(T, 'kneeR', -0.2, 0.35, 1);
            T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; T[P.chest + 1] = -0.32 * Math.sin(Math.PI * k);
          } else if (st === 'superman') {
            // laid out flat toward the rim: legs straight back, toes pointed, the free arm stretched back
            set3(T, 'footL', 0.12, 0.42, -0.58); set3(T, 'footR', -0.12, 0.44, -0.56); set3(T, 'kneeL', 0.1, -0.4, 1); set3(T, 'kneeR', -0.1, -0.4, 1);
            T[P.pitchL] = 1.0; T[P.pitchR] = 1.0;
          } else if (st === 'liberty') {
            // a long still stretch: legs split front and back, body arched
            set3(T, 'footR', -0.11, 0.46, 0.4); set3(T, 'kneeR', -0.11, 0.25, 1); set3(T, 'footL', 0.12, 0.26, -0.4); set3(T, 'kneeL', 0.1, -0.15, 1); T[P.pitchL] = 0.9; T[P.pitchR] = 0.45;
          } else if (st === 'scoop') {
            // knees driven up and together while the ball swings under
            const sc = Math.sin(Math.min(1, up / 0.7) * Math.PI);
            set3(T, 'footL', 0.1, 0.4 + sc * 0.2, 0.22 + sc * 0.2); set3(T, 'footR', -0.1, 0.42 + sc * 0.2, 0.24 + sc * 0.2);
            set3(T, 'kneeL', 0.18, 0.4, 1); set3(T, 'kneeR', -0.18, 0.4, 1); T[P.pitchL] = 0.6; T[P.pitchR] = 0.6;
          } else if (st === 'switch') {
            set3(T, 'footL', 0.16, 0.34, -0.1); set3(T, 'footR', -0.16, 0.44, 0.2); set3(T, 'kneeL', 0.3, -0.1, 1); set3(T, 'kneeR', -0.3, 0.25, 1); T[P.pitchL] = 0.8; T[P.pitchR] = 0.55;
            T[P.chest + 1] = (a.spinDir || 1) * 0.3 * Math.sin(Math.min(1, up / 0.75) * Math.PI);
          } else if (st === '180') {
            // half turn: legs together and tucked, shoulders counter-rotating into the turn
            set3(T, 'footL', 0.11, 0.4, 0.02); set3(T, 'footR', -0.11, 0.38, 0.0); set3(T, 'kneeL', 0.22, 0.1, 1); set3(T, 'kneeR', -0.22, 0.1, 1); T[P.pitchL] = 0.8; T[P.pitchR] = 0.8;
            T[P.chest + 1] = -(a.spinDir || 1) * 0.25 * (1 - up);
          } else if (st === 'eastbay') {
            // between the legs: the legs split wide open while the ball goes through, then snap closed
            const thr = Math.sin(Math.min(1, up / 0.66) * Math.PI);
            set3(T, 'footR', -0.12 - thr * 0.14, 0.52 + thr * 0.22, 0.34 + thr * 0.24); set3(T, 'kneeR', -0.2 - thr * 0.5, 0.35, 1);
            set3(T, 'footL', 0.12 + thr * 0.1, 0.26 - thr * 0.04, -0.4 - thr * 0.2); set3(T, 'kneeL', 0.14 + thr * 0.3, -0.2, 1);
            T[P.pitchL] = 0.9; T[P.pitchR] = 0.5; T[P.pelvis] = -0.1 * thr;
          } else if (st === 'hashsling') {
            // Hash-Slinging (Icon badge only): legs scissor wide open while the arm whips all the way around
            const wh = Math.sin(Math.min(1, up / 0.8) * Math.PI);
            set3(T, 'footR', -0.1 - wh * 0.16, 0.58 + wh * 0.2, 0.36 + wh * 0.3); set3(T, 'kneeR', -0.2 - wh * 0.4, 0.3, 1);
            set3(T, 'footL', 0.14 + wh * 0.14, 0.3, -0.46 - wh * 0.22); set3(T, 'kneeL', 0.12, -0.25, 1);
            T[P.pitchL] = 0.95; T[P.pitchR] = 0.45; T[P.chest + 1] = (a.spinDir || 1) * 0.35 * wh; T[P.pelvis] = -0.08 * wh;
          } else if (DUNK_LEGS2[st]) { DUNK_LEGS2[st](T, up, a);
          } else if (two || a.type === 'oop') { set3(T, 'footL', 0.14, 0.32, 0.05); set3(T, 'footR', -0.14, 0.3, 0.05); T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; set3(T, 'kneeL', 0.3, 0, 1); set3(T, 'kneeR', -0.3, 0, 1); }
          else { set3(T, 'footR', -0.1, 0.6, 0.3); set3(T, 'kneeR', -0.1, 0.3, 1); set3(T, 'footL', 0.1, 0.2, -0.2); T[P.pitchL] = 0.8; T[P.pitchR] = 0.5; }
          T[P.spine] = st === 'tomahawk' || st === 'hammer' ? -0.2 : st === 'rimrock' ? -0.3 : st === 'liberty' ? -0.26 : st === 'windmill' || st === 'cradle' ? -0.12 * Math.sin(up * Math.PI) - 0.04 : st === '360' ? 0.08 : st === 'eastbay' ? 0.1 : st === 'scoop' ? 0.06 : st === 'superman' ? 0.34 : st === 'bully' ? 0.1 : st === 'aroundback' ? 0.12 : -0.05;
          T[P.chest] = st === 'tomahawk' || st === 'hammer' ? -0.15 : st === 'rimrock' ? -0.16 : st === 'liberty' ? -0.12 : st === 'windmill' ? -0.08 : st === 'superman' ? 0.1 : 0;
          T[P.head] = st === 'superman' ? -0.42 : -0.15;
          if (SPINE2[st]) { const [sp, ch, hd] = SPINE2[st]; T[P.spine] = sp; T[P.chest] = ch; T[P.head] = hd; }
          // the free arm balances flashy dunks out wide (on the other side once the ball has changed hands)
          const fh = dunkHand(a) === 'L' ? 'R' : 'L', fs = fh === 'L' ? 1 : -1;
          if (!a.slammed && (st === 'windmill' || st === 'cradle' || st === 'tomahawk' || st === 'hammer' || st === 'liberty' || st === '180' || st === 'eastbay' || st === 'hashsling' || st === 'switch' || st === 'aroundback' || st === 'sidemill' || st === 'spinmill' || st === 'helicopter' || st === 'crossleg' || st === 'hurdle')) { set3(T, 'hand' + fh, fs * 0.55, 1.75, 0.05); set3(T, 'elbow' + fh, fs * 1, -0.2, -0.3); }
          // v0.4.7.5: the free arm's own job in the new finishes
          if (!a.slammed && st === 'kneeup') { set3(T, 'hand' + fh, fs * 0.3, 1.25, 0.42); set3(T, 'elbow' + fh, fs * 0.8, -0.6, 0.2); }
          if (!a.slammed && st === 'jackknife') { set3(T, 'hand' + fh, fs * 0.2, 0.9, 0.55); set3(T, 'elbow' + fh, fs * 0.6, -0.6, 0.5); }
          if (!a.slammed && st === 'backscratch') { set3(T, 'hand' + fh, fs * 0.6, 1.5, 0.2); set3(T, 'elbow' + fh, fs * 1, -0.3, 0); }
          if (!a.slammed && st === 'scoop') { set3(T, 'handL', 0.5, 1.3, -0.1); set3(T, 'elbowL', 1, -0.5, -0.4); }
          // contact: the forearm comes up as a shield; superman: the free arm stretched back like a flyer
          if (!a.slammed && st === 'bully') { set3(T, 'handL', 0.2, 1.62, 0.38); set3(T, 'elbowL', 1, -0.5, 0.2); }
          if (!a.slammed && st === 'superman') { set3(T, 'handL', 0.34, 1.25, -0.5); set3(T, 'elbowL', 1, -0.3, -0.6); }
          if (a.type === 'oop') { set3(T, 'handL', 0.15, 2.5, 0.35); set3(T, 'handR', -0.15, 2.5, 0.35); }
          if (a.slammed) {
            // v0.4.5 quick patch: an emphatic finish: the slamming arm keeps driving down through the rim, the chest
            // crunches over it and the knees snap up (it used to freeze with the hands up)
            const k = sm(0, 0.16, t - (a.slamAt ?? a.slam ?? t)), dh = dunkHand(a), ds = dh === 'L' ? 1 : -1, oh = dh === 'L' ? 'R' : 'L';
            set3(T, 'hand' + dh, ds * (0.08 - 0.02 * k), 2.3 - 0.62 * k, 0.45 + 0.12 * k);
            set3(T, 'elbow' + dh, ds * 0.5, -0.3 - 0.5 * k, 0.6);
            set3(T, 'hand' + oh, -ds * (0.25 + 0.15 * k), 2.1 - 0.75 * k, 0.3 - 0.05 * k);
            T[P.spine] += 0.22 * k; T[P.chest] += 0.16 * k; T[P.head] += 0.12 * k;
            T[P.pitchL] = Math.max(T[P.pitchL], 0.7); T[P.pitchR] = Math.max(T[P.pitchR], 0.7);
            set3(T, 'kneeL', 0.25, 0.35 * k, 1); set3(T, 'kneeR', -0.25, 0.35 * k, 1);
          }
          if (!a.slammed && a.style === 'reverse') { T[P.chest + 1] = 0.3; }
        } else { T[P.root + 1] = -0.18; T[P.spine] = 0.25; }
        break;
      }
      case 'hang': {
        // hands on the rim, legs dangle and swing
        if (rim) {
          const l1 = [0, 0, 0], l2 = [0, 0, 0];
          const fx = Math.sin(p.facing), fz = Math.cos(p.facing), lx = Math.cos(p.facing), lz = -Math.sin(p.facing);
          this.toLocal(rim.x + lx * 0.16 - fx * 0.12, rim.y + 0.02, rim.z + lz * 0.16 - fz * 0.12, l1);
          this.toLocal(rim.x - lx * 0.16 - fx * 0.12, rim.y + 0.02, rim.z - lz * 0.16 - fz * 0.12, l2);
          set3(T, 'handL', l1[0] / s, l1[1] / s - 0.02, l1[2] / s - 0.05); set3(T, 'handR', l2[0] / s, l2[1] / s - 0.02, l2[2] / s - 0.05);
          this.palm.L = { normal: [0, -1, 0], fingers: [0, 0, 1], w: 0.8 }; this.palm.R = { normal: [0, -1, 0], fingers: [0, 0, 1], w: 0.8 };
        }
        const sw = Math.sin(t * 7) * 0.12 * Math.exp(-t * 2);
        set3(T, 'footL', 0.12, 0.25 + Math.max(0, sw) * 0.4, 0.1 + sw); set3(T, 'footR', -0.12, 0.22, 0.05 + sw);
        T[P.pitchL] = 0.7; T[P.pitchR] = 0.7; T[P.spine] = -0.08; T[P.head] = -0.15;
        set3(T, 'elbowL', 0.8, 0, -0.6); set3(T, 'elbowR', -0.8, 0, -0.6);
        break;
      }
      case 'land': T[P.root + 1] = -0.05 * Math.sin(Math.min(1, t / a.dur) * Math.PI); T[P.spine] = 0.12; break;
      case 'pass': {
        const q = Math.min(1, t / a.dur);
        const step = Math.sin(q * Math.PI);
        set3(T, 'footL', 0.13, 0.08, 0.05 + step * 0.22);
        T[P.spine] = 0.1 + step * (a.ptype === 'bounce' ? 0.3 : 0.15); T[P.root + 1] = -0.06 - step * 0.06;
        if (a.released) {
          const tgt0 = g?.players[a.to];
          const tgt = tgt0 && g.worldOf ? g.worldOf(tgt0) : tgt0;
          let dx = 0, dz = 1;
          if (tgt) { const lt = [0, 0, 0]; this.toLocal(tgt.x, 1.2, tgt.z, lt); const l = Math.hypot(lt[0], lt[2]) || 1; dx = lt[0] / l; dz = lt[2] / l; }
          const y = a.ptype === 'bounce' ? 0.9 : a.ptype === 'lob' || a.ptype === 'alley' ? 1.9 : 1.32;
          set3(T, 'handL', 0.14 + dx * 0.55, y, 0.2 + dz * 0.5); set3(T, 'handR', -0.14 + dx * 0.55, y, 0.2 + dz * 0.5);
          this.palm.L = { normal: [0, -0.3, 1], fingers: [0.2, 0.3, 0.9], w: 0.7 }; this.palm.R = { normal: [0, -0.3, 1], fingers: [-0.2, 0.3, 0.9], w: 0.7 };
          // v0.4.5 Oprah (Icon badge): a one-handed flick with the whole body behind it and the off arm swept wide
          if (a.icon === 'oprah') {
            set3(T, 'handR', -0.1 + dx * 0.95, y + 0.14, 0.2 + dz * 0.85); set3(T, 'elbowR', -0.3, -0.5, 0.6);
            set3(T, 'handL', 0.8 - dx * 0.2, y - 0.2, -0.1); set3(T, 'elbowL', 1, -0.2, -0.5);
            this.palm.R = { normal: [0, -0.2, 1], fingers: [-0.5, 0.2, 0.85], w: 0.9 }; this.palm.L = null;
            T[P.chest + 1] = -0.34; T[P.spine] += 0.1; T[P.head + 1] = 0.18;
          }
        }
        break;
      }
      case 'catch': T[P.root + 1] -= 0.05; T[P.spine] += 0.08; break;
      case 'steal': {
        // v0.4.4: reach with the chosen hand (left/right), or a low swipe at the dribble
        const k = Math.sin(Math.min(1, t / a.dur) * Math.PI);
        const hd = a.hand === 'L' ? 'L' : 'R', sg = hd === 'L' ? 1 : -1;
        T[P.spine] = 0.2 + k * (a.low ? 0.55 : 0.4); T[P.chest + 1] = sg * 0.25 * k; T[P.root + 1] = -0.1 - k * (a.low ? 0.2 : 0.12);
        set3(T, 'foot' + hd, sg * 0.18, 0.08, 0.1 + k * 0.38);
        const reach = b && Math.hypot(b[0], b[2]) < 1.6 ? [b[0], Math.max(a.low ? 0.35 : 0.6, b[1]), b[2]] : [sg * 0.1, a.low ? 0.55 : 0.95, 0.8];
        set3(T, 'hand' + hd, lerp(sg * 0.25, reach[0], k), lerp(1.0, reach[1], k), lerp(0.2, reach[2], k));
        set3(T, 'elbow' + hd, sg * 0.5, -1, 0);
        this.palm[hd] = { normal: [-sg * 0.3, -0.6, 0.6], fingers: [0, -0.2, 1], w: 0.6 * k };
        // v0.4.5 The Clamp (Icon badge): a two-hand clamp on the ball, body low and square
        if (a.icon === 'clamp') {
          const off = hd === 'L' ? 'R' : 'L';
          T[P.root + 1] = -0.2 - k * 0.14; T[P.spine] = 0.34 + k * 0.3; T[P.chest + 1] = 0;
          set3(T, 'hand' + off, lerp(-sg * 0.25, reach[0] - sg * 0.2, k), lerp(1.0, reach[1] + 0.06, k), lerp(0.2, reach[2] - 0.04, k));
          set3(T, 'elbow' + off, -sg * 0.5, -1, 0);
          this.palm[off] = { normal: [sg * 0.6, -0.4, 0.6], fingers: [0, -0.2, 1], w: 0.7 * k };
          set3(T, 'footL', 0.3, 0.08, 0.06); set3(T, 'footR', -0.3, 0.08, 0.02);
        }
        break;
      }
      case 'block': case 'rebound': case 'tipjump': {
        if (p.airborne) {
          // v0.4.7.5: a natural reach. The arms swing up from the sides as he leaves the floor, the lead arm (the
          // ball's side) going for the ball and the other a beat behind, lower and wider with the elbow soft; the
          // trunk bends toward the ball and the eyes follow it. A board he's got is ripped down to the chest.
          const u = Math.max(0, t - (a.jumpAt || 0)), air = a.air || 0.6, up = sm(0, air * 0.42, u), up2 = sm(0.05, air * 0.52, u);
          const own = a.type === 'rebound' && g && g.ball.holder === p.id;
          let tx = 0.05, ty = 2.5, tz = 0.25;
          if (b) { tx = Math.max(-0.6, Math.min(0.6, b[0])); ty = Math.max(1.7, Math.min(2.75, b[1])); tz = Math.max(-0.05, Math.min(0.55, b[2])); }
          const ld = tx >= 0 ? 'L' : 'R', tr = ld === 'L' ? 'R' : 'L', ls = ld === 'L' ? 1 : -1;
          set3(T, 'footL', 0.13, 0.2 + 0.05 * up, 0.06); set3(T, 'footR', -0.13, 0.25, -0.03); T[P.pitchL] = 0.55; T[P.pitchR] = 0.65;
          set3(T, 'kneeL', 0.22, 0.1, 1); set3(T, 'kneeR', -0.18, 0, 1);
          if (own) {
            const r = sm(0, 0.18, u - (a.gotAt ?? u)); set3(T, 'handL', 0.17, 1.48 + 0.2 * (1 - r), 0.38); set3(T, 'handR', -0.17, 1.48 + 0.2 * (1 - r), 0.38);
            set3(T, 'elbowL', 1, -0.3, -0.2); set3(T, 'elbowR', -1, -0.3, -0.2); T[P.spine] = 0.12; T[P.head] = -0.05;
          } else {
            // (both hands stay out in front of the chest when they cross toward the ball's side)
            const lz2 = Math.max(tz, 0.18), tz2 = Math.max(tz - 0.06, Math.abs(tx - ls * 0.3) < 0.3 ? 0.34 : 0.12);
            set3(T, 'hand' + ld, lerp(ls * 0.42, tx + ls * 0.05, up), lerp(1.05, ty, up), lerp(0.12, lz2, up));
            set3(T, 'hand' + tr, lerp(-ls * 0.42, tx - ls * (a.type === 'block' ? 0.4 : 0.24), up2), lerp(1.05, ty - (a.type === 'block' ? 0.5 : 0.26), up2), lerp(0.12, tz2, up2));
            set3(T, 'elbow' + ld, ls * 0.75, -0.25, -0.45); set3(T, 'elbow' + tr, -ls * 0.95, -0.45, -0.35);
            if (a.type === 'block') this.palm[ld] = { normal: [0, 0.1, 1], fingers: [0, 1, 0.1], w: 0.8 * up };
            T[P.spine + 2] = ls * 0.1 * up; T[P.chest + 2] = ls * 0.06 * up; T[P.chest + 1] = -ls * 0.12 * up;
            T[P.spine] = -0.05; T[P.head] = -0.22 - 0.1 * up;
          }
          // v0.4.5 Icon badges: Big Brother swats with one arm cocked all the way back; Open Arms snatches the
          // board in with both arms and rips it down to the chest
          if (a.icon === 'bigbro') {
            const sw = sm(0, 0.18, t - (a.jumpAt || 0));
            set3(T, 'handR', -0.1 - sw * 0.3, 2.74, 0.26 + sw * 0.2); set3(T, 'elbowR', -1, 0.4, -0.2);
            set3(T, 'handL', 0.5, 1.9, -0.05); set3(T, 'elbowL', 1, -0.1, -0.4);
            this.palm.R = { normal: [0, 0.2, 1], fingers: [0, 1, -0.2], w: 0.9 };
            T[P.chest + 1] = -0.3 * sw; T[P.spine] = -0.14; T[P.pitchL] = 0.75; T[P.pitchR] = 0.75;
            set3(T, 'footL', 0.1, 0.3, -0.12); set3(T, 'footR', -0.1, 0.3, -0.12);
          } else if (a.icon === 'openarms') {
            const rip = sm(0.1, 0.42, t - (a.jumpAt || 0));
            set3(T, 'handL', 0.28 - rip * 0.1, 2.62 - rip * 1.1, 0.24 - rip * 0.02);
            set3(T, 'handR', -0.28 + rip * 0.1, 2.62 - rip * 1.1, 0.24 - rip * 0.02);
            set3(T, 'elbowL', 1, 0.2 - rip, -0.3); set3(T, 'elbowR', -1, 0.2 - rip, -0.3);
            this.palm.L = { normal: [-1, 0, 0.2], fingers: [0, 0.9, 0.2], w: 0.85 };
            this.palm.R = { normal: [1, 0, 0.2], fingers: [0, 0.9, 0.2], w: 0.85 };
            T[P.spine] = -0.1 + rip * 0.28; T[P.head] = -0.2 + rip * 0.2;
            set3(T, 'kneeL', 0.34, 0, 1); set3(T, 'kneeR', -0.34, 0, 1);
          }
        } else if (a.jumped || t > (a.jumpAt || 0.06) + 0.1) {
          // back on the floor: absorbing the landing, the arms coming down at his sides
          const q = sm(0, 0.2, t - (a.jumpAt || 0.06) - (a.air || 0.6));
          T[P.root + 1] = -0.12 * (1 - q); T[P.spine] = 0.18 * (1 - q) + 0.06;
          set3(T, 'handL', 0.3, 1.25 - 0.2 * q, 0.16); set3(T, 'handR', -0.3, 1.25 - 0.2 * q, 0.16);
          set3(T, 'elbowL', 0.7, -0.6, -0.4); set3(T, 'elbowR', -0.7, -0.6, -0.4);
        } else {
          // loading the jump: hips sit back, arms swing down and back
          const q = Math.min(1, t / Math.max(0.05, a.jumpAt || 0.06));
          T[P.root + 1] = -0.16 * Math.sin(q * Math.PI * 0.5 + 0.5); T[P.spine] = 0.25;
          set3(T, 'handL', 0.32, 1.0 + 0.4 * (1 - q), -0.12 * q); set3(T, 'handR', -0.32, 1.0 + 0.4 * (1 - q), -0.12 * q);
          set3(T, 'elbowL', 0.5, -0.6, -0.6); set3(T, 'elbowR', -0.5, -0.6, -0.6);
        }
        break;
      }
      case 'stumble': {
        const q = Math.min(1, t / a.dur);
        if (a.react && ANKLE_POSE[a.react]) { ANKLE_POSE[a.react](T, q, a.dir || 1, t); break; }
        if (a.fall && a.screen) {
          // v0.4.7.5 qp3: ran into a Brick Wall screen. Thrown back off the chest, down onto the backside with the
          // legs out in front and the arms catching the floor behind, then rolls up to the feet to recover
          const hit = Math.sin(Math.min(1, q / 0.18) * Math.PI) * (1 - sm(0.12, 0.3, q));
          const down = sm(0.08, 0.32, q) * (1 - sm(0.7, 1, q));
          const up = sm(0.7, 1, q);
          T[P.root + 1] = -0.86 * down - 0.1 * hit; T[P.root + 2] = -0.42 * down - 0.2 * hit;
          T[P.spine] = -0.45 * hit + (0.35 - 0.2 * up) * down; T[P.chest] = -0.2 * hit; T[P.head] = 0.3 * hit - 0.15 * down;
          T[P.pelvis] = -0.5 * down;
          set3(T, 'footL', 0.22, 0.08, 0.55 * down + 0.08 - 0.15 * hit); set3(T, 'footR', -0.2, 0.08, 0.4 * down - 0.1 * hit);
          set3(T, 'handL', 0.42, 1.3 * hit + 0.12 * down + 0.4 * (1 - down - hit), -0.42 * down + 0.1 * hit);
          set3(T, 'handR', -0.42, 1.25 * hit + 0.12 * down + 0.4 * (1 - down - hit), -0.4 * down + 0.1 * hit);
          set3(T, 'elbowL', 0.7, -0.1, -0.5); set3(T, 'elbowR', -0.7, -0.1, -0.5);
        } else if (a.fall) {
          const down = sm(0.05, 0.3, q) * (1 - sm(0.72, 1, q));
          T[P.root + 1] = -0.82 * down; T[P.root + 2] = -0.25 * down;
          set3(T, 'footL', 0.2, 0.08, 0.35 * down + 0.05); set3(T, 'footR', -0.22, 0.08, 0.5 * down);
          set3(T, 'handL', 0.35, 0.15 + 0.85 * (1 - down), -0.25 * down); set3(T, 'handR', -0.35, 0.15 + 0.85 * (1 - down), -0.25 * down);
          T[P.spine] = 0.1 - 0.2 * down; T[P.pelvis] = -0.4 * down; T[P.head] = -0.2 * down;
        } else if (a.back) {
          // shoved backward (posterized / bumped off the line): torso snaps back, arms flail, quick back-steps
          const k = Math.sin(q * Math.PI), st = Math.sin(Math.min(1, q * 1.6) * Math.PI);
          T[P.root + 1] = -0.12 * k; T[P.root + 2] = -0.18 * k;
          T[P.spine] = -0.32 * k; T[P.chest] = -0.18 * k; T[P.head] = 0.25 * k;
          set3(T, 'footL', 0.16, 0.08 + st * 0.06, -0.22 * k); set3(T, 'footR', -0.16, 0.08, 0.1 - 0.3 * k);
          set3(T, 'handL', 0.5, 1.45 + 0.3 * k, 0.15); set3(T, 'handR', -0.5, 1.4 + 0.35 * k, 0.12);
          set3(T, 'elbowL', 0.8, -0.2, -0.4); set3(T, 'elbowR', -0.8, -0.2, -0.4);
        } else {
          const k = Math.sin(q * Math.PI);
          T[P.root + 1] = -0.25 * k; T[P.spine + 2] = a.dir * 0.4 * k; T[P.root] = a.dir * 0.15 * k;
          set3(T, a.dir > 0 ? 'footL' : 'footR', a.dir * 0.42 * k + (a.dir > 0 ? 0.12 : -0.12), 0.08, -0.1);
          set3(T, 'handL', 0.5, 1.1 + 0.3 * k, 0.1); set3(T, 'handR', -0.5, 1.1 + 0.3 * k, 0.1);
        }
        break;
      }
      case 'bump': { const k = Math.sin(Math.min(1, t / a.dur) * Math.PI); T[P.spine] -= 0.18 * k; T[P.root + 2] -= 0.06 * k; break; }
      case 'move': {
        // v0.4.7.5: every move has its own body, and the size-up package decides how hard it's sold (flair) and how
        // low he gets (low)
        const sty = MOVE_STYLE[a.sty] || MOVE_STYLE.basic;
        const q = Math.min(1, t / a.dur), k = Math.sin(q * Math.PI) * (1 + 0.25 * (a.lvl || 0)) * sty.flair; // better packages sell it harder
        const side = a.handFrom === 'R' ? 1 : -1, low = 0.5 + 0.5 * (2 - sty.low);
        const mv = a.move;
        if (mv === 'cross' || mv === 'btl' || mv === 'btb' || mv === 'inout') {
          T[P.root + 1] -= 0.08 * k * low; T[P.spine + 2] = -side * 0.25 * Math.sin(q * Math.PI * 2) * (mv === 'inout' ? 1 : 0.6);
          T[P.chest + 1] = side * 0.2 * k;
          // plant & push: wide step
          set3(T, side > 0 ? 'footR' : 'footL', -side * 0.34 * sty.wide, 0.08, 0.1);
        } else if (mv === 'hang') {
          // hang dribble: up tall with the ball hanging at the hip, a shoulder fake, then the snap down and across
          const hang = q < 0.38, s2 = hang ? Math.sin(q / 0.38 * Math.PI) : Math.sin((q - 0.38) / 0.62 * Math.PI);
          T[P.root + 1] += hang ? 0.03 * s2 : -0.13 * s2 * low * sty.flair;
          T[P.spine] = hang ? -0.06 * s2 : 0.18 * s2;
          T[P.chest + 1] = hang ? -side * 0.22 * s2 * sty.flair : side * 0.24 * s2;
          T[P.head + 1] = hang ? -side * 0.18 * s2 : 0;
          if (!hang) set3(T, side > 0 ? 'footR' : 'footL', -side * 0.4 * sty.wide, 0.08, 0.12);
        } else if (mv === 'wrap') {
          // behind-the-back wrap going sideways: the chest turns away, a long lateral step
          T[P.root + 1] -= 0.1 * k * low; T[P.chest + 1] = -side * 0.3 * k; T[P.spine + 2] = side * 0.18 * k;
          set3(T, side > 0 ? 'footL' : 'footR', side * 0.46 * sty.wide * Math.min(1, q * 2), 0.08, 0.02);
        } else if (mv === 'hesi') {
          T[P.root + 1] += q < 0.5 ? 0.04 * Math.sin(q * 2 * Math.PI) : -0.08 * Math.sin((q - 0.5) * 2 * Math.PI);
          T[P.spine] = q < 0.55 ? -0.08 : 0.3;
        } else if (mv === 'stutter') {
          // choppy feet: quick little taps in place, chest up, then the lean and the go
          if (q < 0.62) {
            const tap = Math.sin(q / 0.62 * Math.PI * 7), up = Math.max(0, tap) * 0.07, dn = Math.max(0, -tap) * 0.07;
            set3(T, 'footL', 0.16, 0.08 + up, 0.04); set3(T, 'footR', -0.16, 0.08 + dn, -0.02);
            T[P.spine] = -0.1; T[P.root + 1] += 0.02 * Math.sin(q / 0.62 * Math.PI * 14);
          } else { const g2 = Math.sin((q - 0.62) / 0.38 * Math.PI); T[P.spine] = 0.34 * g2; T[P.root + 1] -= 0.1 * g2 * low; }
        } else if (mv === 'momentum') {
          // push-ahead speed dribble: long stride, deep forward lean
          T[P.spine] = 0.3 * k; T[P.root + 1] -= 0.06 * k * low; T[P.head] = -0.12 * k;
          set3(T, 'footL', 0.14, 0.08 + 0.1 * Math.max(0, Math.sin(q * Math.PI * 2)), 0.32 * Math.sin(q * Math.PI * 2));
          set3(T, 'footR', -0.14, 0.08 + 0.1 * Math.max(0, -Math.sin(q * Math.PI * 2)), -0.32 * Math.sin(q * Math.PI * 2));
        } else if (mv === 'stepback') {
          const hop = Math.sin(Math.min(1, q / 0.55) * Math.PI);
          set3(T, 'footL', 0.18, 0.08 + hop * 0.12, -0.05 - hop * 0.15); set3(T, 'footR', -0.18, 0.08 + hop * 0.12, -0.12 - hop * 0.15);
          T[P.root + 1] = -0.1 - 0.06 * k * low; T[P.spine] = 0.05;
        } else if (mv === 'sidestep') {
          // a hop to the side: feet come together in the air and land wide, the body leaning away from the man
          const hop = Math.sin(Math.min(1, q / 0.5) * Math.PI), wide = 0.18 + 0.16 * (1 - hop) * sty.wide;
          set3(T, 'footL', wide, 0.08 + hop * 0.14, -0.04); set3(T, 'footR', -wide, 0.08 + hop * 0.14, -0.04);
          T[P.root + 1] = -0.08 - 0.08 * (1 - hop) * low; T[P.spine + 2] = side * 0.16 * k; T[P.spine] = -0.04;
        } else if (mv === 'retreat') {
          // two hops straight back, low, the ball dribbled hard and low
          const hop = Math.abs(Math.sin(q * Math.PI * 2)) * (q < 0.7 ? 1 : 0.4);
          set3(T, 'footL', 0.17, 0.08 + hop * 0.09, -0.06 - hop * 0.12); set3(T, 'footR', -0.17, 0.08 + hop * 0.09, -0.14 - hop * 0.12);
          T[P.root + 1] = -0.12 * low; T[P.spine] = 0.14;
        } else if (mv === 'spin' || mv === 'halfspin') {
          T[P.root + 1] = -0.12 * k * low; T[P.spine] = 0.25 * k;
          set3(T, 'handL', 0.45, 1.15, 0.0); set3(T, 'handR', -0.45, 1.15, 0.0);
        } else if (mv === 'pushcross') {
          // v0.4.7.5 quick patch, the push-pull: a lean in and a step ahead with the ball, then the plant and the
          // wide step across as it comes back
          if (q < 0.42) { const u = Math.sin(q / 0.42 * Math.PI / 2); T[P.spine] = 0.22 * u; T[P.root + 1] -= 0.05 * u * low; set3(T, side > 0 ? 'footL' : 'footR', side * 0.16, 0.08, 0.26 * u); }
          else { const u = Math.sin((q - 0.42) / 0.58 * Math.PI); T[P.spine] = 0.16; T[P.root + 1] -= 0.09 * u * low; T[P.chest + 1] = side * 0.22 * u; T[P.spine + 2] = -side * 0.18 * u; set3(T, side > 0 ? 'footR' : 'footL', -side * 0.36 * sty.wide * u, 0.08, 0.12); }
        } else if (mv === 'jab') {
          // the jab: a hard step out to the ball's side, shoulders down, chest toward the man; then he goes
          if (q < 0.45) { const j = Math.sin(q / 0.45 * Math.PI); set3(T, side > 0 ? 'footL' : 'footR', side * (0.17 + 0.2 * j * sty.wide), 0.08 + 0.05 * Math.max(0, Math.sin(q / 0.45 * Math.PI * 2)), 0.06 + 0.24 * j); T[P.spine] = 0.18 * j; T[P.root + 1] -= 0.1 * j * low; T[P.chest + 1] = -side * 0.14 * j; T[P.head + 1] = side * 0.1 * j; }
          else { const g2 = Math.sin((q - 0.45) / 0.55 * Math.PI); T[P.spine] = 0.3 * g2; T[P.root + 1] -= 0.08 * g2 * low; }
        } else if (mv === 'snatch') {
          // the snatch-back: a hop back and to the side, chest up, the ball ripped to the hip
          const hop = Math.sin(Math.min(1, q / 0.55) * Math.PI);
          set3(T, 'footL', 0.18 + (side > 0 ? 0.08 * hop : 0), 0.08 + hop * 0.12, -0.06 - hop * 0.14); set3(T, 'footR', -0.18 - (side < 0 ? 0.08 * hop : 0), 0.08 + hop * 0.12, -0.12 - hop * 0.14);
          T[P.root + 1] = -0.1 - 0.05 * k * low; T[P.spine] = -0.02; T[P.spine + 2] = side * 0.12 * k;
        } else if (mv === 'btlback') {
          // the pull-back: legs split front to back for the ball to go through, a hop back off it
          const hop = Math.sin(Math.min(1, q / 0.6) * Math.PI);
          set3(T, side > 0 ? 'footL' : 'footR', side * 0.16, 0.08 + hop * 0.06, 0.18 - 0.3 * q); set3(T, side > 0 ? 'footR' : 'footL', -side * 0.18, 0.08 + hop * 0.08, -0.16 - 0.12 * hop);
          T[P.root + 1] = -0.12 * low - 0.04 * k; T[P.spine] = 0.12; T[P.chest + 1] = side * 0.16 * k;
        }
        break;
      }
      case 'celebrate': this.celebrate(T, a, p); break;
    }
  }

  celebrate(T, a, p) {
    const t = a.t, k = Math.min(1, t / 0.25) * (1 - Math.max(0, (t - a.dur + 0.3) / 0.3));
    const kind = a.kind || 'flex';
    if (kind === 'flex') {
      mix3(T, 'handL', 0.38, 1.78, 0.02, k); mix3(T, 'handR', -0.38, 1.78, 0.02, k);
      set3(T, 'elbowL', 1, -0.3, 0); set3(T, 'elbowR', -1, -0.3, 0); T[P.spine] = -0.12 * k; T[P.head] = -0.2 * k;
      T[P.chest + 2] = Math.sin(t * 10) * 0.05 * k;
    } else if (kind === 'shimmy') {
      // (stage 7: fists low by the hips, knees dipped, the shoulders doing all the work)
      const sw = Math.sin(t * 22);
      T[P.chest + 1] = sw * 0.32 * k; T[P.clavL + 2] = sw * 0.2 * k; T[P.clavR + 2] = sw * 0.2 * k;
      T[P.root + 1] = -0.07 * k; T[P.spine] = 0.08 * k;
      mix3(T, 'handL', 0.24 + 0.05 * sw, 1.04, 0.16, k); mix3(T, 'handR', -0.24 + 0.05 * sw, 1.04, 0.16, k);
    } else if (kind === 'point') {
      mix3(T, 'handR', -0.12, 2.55, 0.3, k); T[P.head] = -0.4 * k;
    } else if (kind === 'chest') {
      const hit = Math.abs(Math.sin(t * 9));
      mix3(T, 'handR', -0.06, 1.45, 0.19 + hit * 0.12, k); set3(T, 'elbowR', -1, -0.35, 0.1); T[P.spine] = -0.1 * k; // (v0.4.7.5 quick patch: the fist off the chest, elbow out: the forearm went through the chest)
    } else if (kind === 'shush') {
      mix3(T, 'handR', -0.02, 1.86, 0.18, k); this.palm.R = { normal: [1, 0, 0], fingers: [0, 1, 0], w: k };
    } else if (kind === 'too_small') {
      mix3(T, 'handR', -0.3, 0.75, 0.35, k); T[P.spine] = 0.2 * k; this.palm.R = { normal: [0, -1, 0], fingers: [0, 0, 1], w: k };
    } else if (kind === 'shrug') { // v0.4.4: palms up, shoulders up, head tilted
      const up = 0.04 * Math.min(1, t / 0.3);
      mix3(T, 'handL', 0.58, 1.3 + up, 0.24, k); mix3(T, 'handR', -0.58, 1.3 + up, 0.24, k);
      set3(T, 'elbowL', 1, -0.6, 0.2); set3(T, 'elbowR', -1, -0.6, 0.2);
      this.palm.L = { normal: [0, 1, 0], fingers: [0.3, 0, 1], w: k }; this.palm.R = { normal: [0, 1, 0], fingers: [-0.3, 0, 1], w: k };
      T[P.head + 2] = 0.18 * k; T[P.spine] = -0.04 * k;
    } else if (kind === 'pharaoh') { // King Tut Cup exclusive: arms crossed over the chest like a pharaoh in his tomb,
      // head lifted, then he opens up into the crook-and-flail pose
      if (t < 1.0) {
        mix3(T, 'handL', -0.14, 1.66, 0.2, k); mix3(T, 'handR', 0.14, 1.66, 0.2, k);
        set3(T, 'elbowL', 0.9, -0.6, 0.5); set3(T, 'elbowR', -0.9, -0.6, 0.5);
        this.palm.L = { normal: [0, 0, -1], fingers: [-0.4, 0.9, 0], w: k }; this.palm.R = { normal: [0, 0, -1], fingers: [0.4, 0.9, 0], w: k };
        T[P.spine] = -0.12 * k; T[P.head] = -0.18 * k;
        set3(T, 'footL', 0.07, 0.08, 0.0); set3(T, 'footR', -0.07, 0.08, 0.0);
      } else {
        const q = Math.min(1, (t - 1.0) / 0.35);
        mix3(T, 'handL', 0.5 + 0.1 * q, 1.5 + 0.35 * q, 0.22, k); mix3(T, 'handR', -0.5 - 0.1 * q, 1.5 + 0.35 * q, 0.22, k);
        set3(T, 'elbowL', 1, -0.5, -0.2); set3(T, 'elbowR', -1, -0.5, -0.2);
        T[P.spine] = -0.15 * k; T[P.head] = -0.12 * k; T[P.chest] = -0.06 * k;
      }
    } else if (kind === 'general') { // The General (Icon badge): a full stand-to-attention salute with a stomp
      const st2 = Math.sin(Math.min(1, t / 0.3) * Math.PI);
      mix3(T, 'handR', -0.04, 1.86, 0.16, k); set3(T, 'elbowR', -1.1, 0.3, 0.3);
      this.palm.R = { normal: [0, -0.3, -1], fingers: [0.75, 0.5, 0], w: k };
      mix3(T, 'handL', 0.3, 0.92, -0.06, k); set3(T, 'elbowL', 0.4, -1, -0.6);
      set3(T, 'footL', 0.1, 0.08 + st2 * 0.16, 0.0); set3(T, 'footR', -0.1, 0.08, 0.0);
      T[P.spine] = -0.1 * k; T[P.chest] = -0.05 * k; T[P.head] = -0.06 * k;
    } else if (kind === 'salute') {
      mix3(T, 'handR', -0.06, 1.8, 0.2, k); set3(T, 'elbowR', -1, 0.15, 0.2);
      this.palm.R = { normal: [0, -0.4, -1], fingers: [0.6, 0.6, 0], w: k }; T[P.spine] = -0.06 * k; T[P.head] = -0.06 * k;
    } else if (kind === 'heart') {
      if (t < 0.85) { const tap = Math.abs(Math.sin(t * 11)); mix3(T, 'handR', 0.05, 1.5, 0.18 + tap * 0.07, k); set3(T, 'elbowR', -1, -0.4, 0.1); this.palm.R = { normal: [0, 0, -1], fingers: [1, 0.3, 0], w: k }; }
      else { const q = Math.min(1, (t - 0.85) / 0.3); mix3(T, 'handR', -0.12, 1.5 + 1.05 * q, 0.14 + 0.16 * q, k); T[P.head] = -0.42 * q * k; }
    } else if (kind === 'sit' || kind === 'sitcheer' || kind === 'sitclap') { // v0.4.5 park spectators on a bench
      T[P.root + 1] = -0.47 * k; T[P.root + 2] = -0.04 * k; T[P.spine] = 0.1 * k; T[P.pelvis] = 0.5 * k;
      set3(T, 'footL', 0.17, 0.08, 0.42 * k); set3(T, 'footR', -0.17, 0.08, 0.44 * k);
      if (kind === 'sitcheer') {
        const pump = Math.abs(Math.sin(t * 7));
        mix3(T, 'handL', 0.3, 1.85 + 0.2 * pump, 0.12, k); mix3(T, 'handR', -0.3, 1.85 + 0.2 * (1 - pump), 0.12, k);
        T[P.spine] = -0.05 * k; T[P.head] = -0.2 * k;
      } else if (kind === 'sitclap') {
        const g = Math.abs(Math.sin(t * 11));
        mix3(T, 'handL', 0.03 + 0.1 * g, 1.08, 0.36, k); mix3(T, 'handR', -0.03 - 0.1 * g, 1.08, 0.36, k);
        this.palm.L = { normal: [-1, 0, 0], fingers: [0, 0.6, 0.8], w: k }; this.palm.R = { normal: [1, 0, 0], fingers: [0, 0.6, 0.8], w: k };
      } else { mix3(T, 'handL', 0.2, 0.6, 0.3, k); mix3(T, 'handR', -0.2, 0.6, 0.3, k); }
    } else if (kind === 'cheer') { // standing: both arms up, pumping, a little bounce
      const pump = Math.abs(Math.sin(t * 7));
      mix3(T, 'handL', 0.32, 2.05 + 0.15 * pump, 0.1, k); mix3(T, 'handR', -0.32, 2.05 + 0.15 * (1 - pump), 0.1, k);
      T[P.root + 1] += 0.03 * Math.abs(Math.sin(t * 7)) * k; T[P.head] = -0.25 * k;
    } else if (kind === 'clap') {
      const g = Math.abs(Math.sin(t * 11));
      mix3(T, 'handL', 0.03 + 0.1 * g, 1.3, 0.3, k); mix3(T, 'handR', -0.03 - 0.1 * g, 1.3, 0.3, k);
      this.palm.L = { normal: [-1, 0, 0], fingers: [0, 0.6, 0.8], w: k }; this.palm.R = { normal: [1, 0, 0], fingers: [0, 0.6, 0.8], w: k };
    } else if (kind === 'ooh') { // hands on head: "did you see that?"
      mix3(T, 'handL', 0.12, 1.98, 0.02, k); mix3(T, 'handR', -0.12, 1.98, 0.02, k);
      set3(T, 'elbowL', 1, 0.2, 0); set3(T, 'elbowR', -1, 0.2, 0); T[P.spine] = -0.12 * k; T[P.head] = -0.1 * k;
    } else if (kind === 'goggles') { // three-point goggles over the eyes, head rocking
      const w = Math.sin(t * 6);
      mix3(T, 'handL', 0.15, 1.95, 0.22, k); mix3(T, 'handR', -0.15, 1.95, 0.22, k);
      set3(T, 'elbowL', 1, -0.1, 0.1); set3(T, 'elbowR', -1, -0.1, 0.1);
      this.palm.L = { normal: [0, 0, -1], fingers: [-0.6, 0.6, 0], w: k }; this.palm.R = { normal: [0, 0, -1], fingers: [0.6, 0.6, 0], w: k };
      T[P.head + 1] = w * 0.22 * k; T[P.spine] = -0.04 * k;
    } else if (kind === 'dust') { // brushes the dirt off both shoulders
      const q = (t * 1.6) % 2, side = q < 1 ? 'R' : 'L', sg = side === 'L' ? 1 : -1, ph = q % 1;
      const sweep = Math.sin(ph * Math.PI);
      // (v0.4.7.5 quick patch: the brushing hand stays off the chest as it crosses, elbow up and forward)
      // (and as each hand comes across to start its stroke it comes round the front, not through the chest)
      // (the brush goes one way, across and off, so the hand finishes on its own side rather than back across him)
      const across = ph * ph * (3 - 2 * ph);
      mix3(T, 'hand' + side, -sg * (0.34 - across * 0.62), 1.62 + sweep * 0.1, 0.17 + 0.17 * sweep + 0.24 * Math.max(0, 1 - ph / 0.3), k);
      set3(T, 'elbow' + side, -sg * 0.7, 0.1, 0.7);
      this.palm[side] = { normal: [0, -0.3, -0.9], fingers: [-sg, 0.2, 0], w: k };
      T[P.chest + 1] = sg * 0.18 * k; T[P.head] = -0.1 * k;
    } else if (kind === 'airplane') { // arms out, banking side to side
      const b = Math.sin(t * 2.4);
      mix3(T, 'handL', 0.95, 1.3 + b * 0.35, 0.0, k); mix3(T, 'handR', -0.95, 1.3 - b * 0.35, 0.0, k);
      set3(T, 'elbowL', 1, 0.1, -0.1); set3(T, 'elbowR', -1, 0.1, -0.1);
      T[P.spine + 2] = -b * 0.22 * k; T[P.chest + 2] = -b * 0.1 * k; T[P.head] = -0.12 * k;
    } else if (kind === 'mic') { // holds the mic up, then drops it and walks it off
      if (t < 1.0) { mix3(T, 'handR', -0.1, 2.0, 0.34, k); this.palm.R = { normal: [0, 0, -1], fingers: [0, 1, 0], w: k }; set3(T, 'elbowR', -0.9, 0.1, 0.2); T[P.head] = -0.18 * k; }
      else { const q = Math.min(1, (t - 1.0) / 0.5); mix3(T, 'handR', -0.42 * q - 0.1, 2.0 - q * 0.95, 0.34 - q * 0.22, k); this.palm.R = { normal: [0, -1, 0], fingers: [0, 0, 1], w: k * (1 - q) }; T[P.chest + 1] = -0.2 * q * k; T[P.head + 1] = -0.25 * q * k; }
    } else if (kind === 'bow') { // one arm across the waist, a deep bow
      const q = Math.min(1, t / 0.6) * (1 - Math.max(0, (t - 1.5) / 0.5));
      T[P.spine] = 0.5 * q * k; T[P.chest] = 0.25 * q * k; T[P.head] = 0.1 * q * k; T[P.root + 1] = -0.05 * q * k;
      mix3(T, 'handL', 0.08, 1.12, 0.3, k); set3(T, 'elbowL', 0.9, -0.5, -0.1);
      mix3(T, 'handR', -0.62, 1.1, -0.12, k); set3(T, 'elbowR', -1, -0.3, -0.4);
      this.palm.L = { normal: [0, -0.2, -1], fingers: [-1, 0, 0], w: k };
    } else if (kind === 'roar') { // arms flexed down at the sides, chest out
      const sh = Math.sin(t * 16) * 0.03;
      mix3(T, 'handL', 0.46, 0.92 + sh, -0.1, k); mix3(T, 'handR', -0.46, 0.92 - sh, -0.1, k);
      set3(T, 'elbowL', 1, -0.7, -0.5); set3(T, 'elbowR', -1, -0.7, -0.5);
      T[P.spine] = -0.2 * k; T[P.chest] = -0.1 * k; T[P.head] = -0.3 * k; T[P.root + 1] = -0.03 * k;
    } else if (kind === 'crown') { // both hands set a crown on the head, then frame it
      // (stage 7: once it's on, the hands open out wide above the head to present it, chest up)
      const down = 0.14 * Math.min(1, t / 0.7), open = Math.min(1, Math.max(0, t - 0.8) / 0.3);
      mix3(T, 'handL', 0.14 + 0.32 * open, 2.22 - down + 0.06 * open, 0.04, k); mix3(T, 'handR', -0.14 - 0.32 * open, 2.22 - down + 0.06 * open, 0.04, k);
      T[P.chest] = -0.1 * open * k;
      set3(T, 'elbowL', 1, 0.3, 0); set3(T, 'elbowR', -1, 0.3, 0);
      this.palm.L = { normal: [0, -1, 0], fingers: [-0.4, 0, 1], w: k }; this.palm.R = { normal: [0, -1, 0], fingers: [0.4, 0, 1], w: k };
      T[P.spine] = -0.08 * k; T[P.head] = 0.05 * k;
    } else if (CELEB2[kind]) CELEB2[kind](T, t, k, this);
  }
}

// v0.4.7.5 celebrations (t: seconds in; k: blend in/out; an: the animator, for palms)
const CELEB2 = {
  // swings a big hammer down overhead, twice
  hammer: (T, t, k) => { const ph = (t * 1.6) % 1, sw = ph < 0.6 ? ph / 0.6 : 1 - (ph - 0.6) / 0.4, y = 2.3 - 1.3 * sw * sw; mix3(T, 'handR', -0.1, y, 0.2 + 0.4 * sw, k); mix3(T, 'handL', -0.02, y - 0.12, 0.2 + 0.4 * sw, k); T[P.spine] = (0.35 * sw - 0.15) * k; T[P.root + 1] = -0.08 * sw * k; },
  // holds up three fingers, shaking them at the crowd
  scorekeeper: (T, t, k, an) => { const sh = Math.sin(t * 14) * 0.03; mix3(T, 'handR', -0.42 + sh, 2.1, 0.3, k); mix3(T, 'handL', 0.42 - sh, 2.1, 0.3, k); an.palm.R = { normal: [0, 0, 1], fingers: [0, 1, 0], w: k }; an.palm.L = { normal: [0, 0, 1], fingers: [0, 1, 0], w: k }; T[P.head] = -0.2 * k; },
  // the sprinkler: one hand behind the head, the other arm ticking round in front
  sprinkler: (T, t, k) => { const tick = Math.floor(t * 6) % 6 / 5, a = -0.6 + 1.2 * tick; mix3(T, 'handL', 0.12, 1.85, -0.12, k); set3(T, 'elbowL', 1, 0.3, 0); mix3(T, 'handR', -0.1 + Math.sin(a) * 0.55, 1.5, 0.3 + Math.cos(a) * 0.3, k); T[P.chest + 1] = a * 0.3 * k; T[P.root + 1] = -0.05 * k; },
  // pull-start a lawnmower: low reach and a big pull back
  lawnmower: (T, t, k) => { const ph = (t * 1.2) % 1, pull = ph < 0.35 ? 0 : Math.min(1, (ph - 0.35) / 0.25); mix3(T, 'handR', -0.15 - 0.3 * pull, 0.75 + 0.75 * pull, 0.45 - 0.55 * pull, k); mix3(T, 'handL', 0.25, 0.95, 0.35, k); T[P.spine] = (0.45 - 0.5 * pull) * k; T[P.root + 1] = -0.1 * k; T[P.chest + 1] = -0.35 * pull * k; },
  // the chef's kiss: fingers to the lips, then flung open
  chef: (T, t, k, an) => { const o = Math.max(0, Math.min(1, (t - 0.55) / 0.2)); mix3(T, 'handR', -0.05 - 0.4 * o, 1.88 + 0.1 * o, 0.16 + 0.3 * o, k); an.palm.R = { normal: [0, -0.2, 1], fingers: [0, 0.4 + 0.6 * o, 0.2], w: k }; T[P.head] = (0.1 - 0.25 * o) * k; },
  // flapping wings, up on the toes
  wings: (T, t, k) => { const f = Math.sin(t * 9); mix3(T, 'handL', 0.62, 1.45 + 0.3 * f, -0.04, k); mix3(T, 'handR', -0.62, 1.45 + 0.3 * f, -0.04, k); set3(T, 'elbowL', 1, 0, -0.3); set3(T, 'elbowR', -1, 0, -0.3); T[P.pitchL] = 0.4 * k; T[P.pitchR] = 0.4 * k; T[P.root + 1] = 0.03 * k; },
  // palms down, patting the air: calm down
  calm: (T, t, k, an) => { const pat = Math.abs(Math.sin(t * 6)) * 0.12; mix3(T, 'handL', 0.35, 1.15 + pat, 0.3, k); mix3(T, 'handR', -0.35, 1.15 + pat, 0.3, k); an.palm.L = { normal: [0, -1, 0], fingers: [0, 0, 1], w: k }; an.palm.R = { normal: [0, -1, 0], fingers: [0, 0, 1], w: k }; T[P.root + 1] = -0.06 * k; T[P.spine] = 0.08 * k; },
  // swimming: front crawl strokes
  swim: (T, t, k) => { const a = t * 6; mix3(T, 'handL', 0.25, 1.4 + 0.5 * Math.sin(a), 0.2 + 0.4 * Math.cos(a), k); mix3(T, 'handR', -0.25, 1.4 + 0.5 * Math.sin(a + Math.PI), 0.2 + 0.4 * Math.cos(a + Math.PI), k); T[P.chest + 1] = Math.sin(a) * 0.25 * k; T[P.spine] = 0.2 * k; },
  // air guitar: strumming low, fretting out to the side, head banging
  guitar: (T, t, k) => { const st = Math.sin(t * 16); mix3(T, 'handR', -0.1, 1.05 + 0.08 * st, 0.28, k); mix3(T, 'handL', 0.55, 1.35, 0.3, k); set3(T, 'elbowL', 1, -0.4, -0.1); T[P.head] = (0.15 + 0.15 * Math.sin(t * 8)) * k; T[P.root + 1] = -0.1 * k; set3(T, 'footL', 0.24, 0.08, 0.16); set3(T, 'footR', -0.24, 0.08, -0.1); },
  // drumming: both hands beating fast in front of the waist
  drum: (T, t, k) => { const b = Math.sin(t * 20); mix3(T, 'handL', 0.22, 1.1 + 0.12 * b, 0.35, k); mix3(T, 'handR', -0.22, 1.1 - 0.12 * b, 0.35, k); T[P.head] = 0.1 * Math.abs(b) * k; T[P.root + 1] = -0.05 * k; },
  // the robot: stiff, square, one joint at a time
  robot: (T, t, k) => { const st = Math.floor(t * 4) % 4; const L = [[0.4, 1.4, 0.3], [0.4, 1.0, 0.3], [0.6, 1.4, 0.0], [0.4, 1.8, 0.0]][st], R = [[-0.4, 1.0, 0.3], [-0.4, 1.4, 0.3], [-0.4, 1.8, 0.0], [-0.6, 1.4, 0.0]][st]; mix3(T, 'handL', ...L, k); mix3(T, 'handR', ...R, k); set3(T, 'elbowL', 1, -0.5, 0); set3(T, 'elbowR', -1, -0.5, 0); T[P.head + 1] = [0.3, 0, -0.3, 0][st] * k; },
  // shadow boxing: jab, jab, cross
  boxer: (T, t, k) => { const ph = (t * 3) % 3, j = ph < 1 ? Math.sin(ph * Math.PI) : 0, c = ph >= 2 ? Math.sin((ph - 2) * Math.PI) : 0; mix3(T, 'handL', 0.14, 1.6, 0.18 + 0.5 * j, k); mix3(T, 'handR', -0.14, 1.6, 0.18 + 0.5 * c, k); T[P.chest + 1] = (0.2 * c - 0.15 * j) * k; T[P.root + 1] = -0.07 * k; set3(T, 'footL', 0.18, 0.08, 0.16); set3(T, 'footR', -0.18, 0.08, -0.12); },
  // ice cold: arms hugged round, shivering
  cold: (T, t, k) => { const sh = Math.sin(t * 40) * 0.02; mix3(T, 'handL', -0.18 + sh, 1.42, 0.16, k); mix3(T, 'handR', 0.18 - sh, 1.38, 0.18, k); set3(T, 'elbowL', 1, -0.6, 0.4); set3(T, 'elbowR', -1, -0.6, 0.4); T[P.spine] = 0.12 * k; T[P.head] = 0.15 * k; T[P.chest + 1] = sh * 2 * k; },
  // taps the wrist: it's my time
  clock: (T, t, k) => { const tap = Math.abs(Math.sin(t * 8)) * 0.05; mix3(T, 'handL', 0.12, 1.3, 0.34, k); set3(T, 'elbowL', 1, -0.6, 0.2); mix3(T, 'handR', 0.06, 1.36 + tap, 0.36, k); T[P.head] = 0.25 * k; },
  // goodnight: hands together under a tilted head
  sleep: (T, t, k) => { mix3(T, 'handL', 0.13, 1.72, 0.16, k); mix3(T, 'handR', 0.06, 1.7, 0.17, k); set3(T, 'elbowR', -0.8, -0.4, 0.3); set3(T, 'elbowL', 0.8, -0.4, 0.3); T[P.head + 2] = 0.4 * k; T[P.head] = 0.1 * k; T[P.spine + 2] = 0.08 * k; },
  // stirring the pot
  stir: (T, t, k) => { const a = t * 7; mix3(T, 'handR', -0.1 + 0.2 * Math.cos(a), 1.05, 0.35 + 0.2 * Math.sin(a), k); mix3(T, 'handL', 0.3, 1.15, 0.25, k); T[P.chest + 1] = Math.cos(a) * 0.12 * k; T[P.root + 1] = -0.06 * k; },
  // the archer: draws the bow back and lets it fly at the crowd
  archer: (T, t, k) => { const dr = Math.min(1, t / 0.6), rel = t > 0.9 ? Math.min(1, (t - 0.9) / 0.12) : 0; mix3(T, 'handL', 0.62, 1.6, 0.25, k); set3(T, 'elbowL', 1, 0, 0); mix3(T, 'handR', 0.5 - 0.5 * dr + 0.2 * rel, 1.62, 0.27 - 0.04 * dr - 0.08 * rel, k); set3(T, 'elbowR', -1, 0.25, -0.3); T[P.chest + 1] = 0.5 * k; T[P.head + 1] = 0.5 * k; set3(T, 'footL', 0.26, 0.08, 0.1); set3(T, 'footR', -0.22, 0.08, -0.12); },
};
