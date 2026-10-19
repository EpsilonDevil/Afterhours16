// v0.4.8.7 The Favelas: the Passinho (the celebration item fv_celly_passinho, kind 'passinho'), kept out of the
// animator's body (it calls in: one entry in its CELEB2 table; nothing else there changes).
// Quick favela-funk footwork: he sinks low and loose and his feet fly. Eight steps a second, four to a figure, two
// figures in a celebration: the left heel flicks out in front (toe up), the right; the left toe taps back behind him,
// crossing a little; the right foot kicks out to the side, the knee snapping in. On every step the knees snap in and
// out (the "pernas"), the hips twist against the feet and bob on the beat, the shoulders bounce, the arms hang loose and
// swing easy, elbows soft, the head nodding along. (t: seconds; k: the blend in and out; an: the animator, for palms)
// Pose units are the animator's: character space for a 2.0 m athlete (x left, y up, z forward), angles in radians.
import { P } from './pose.js';

const TAU = Math.PI * 2;
const clamp01 = v => Math.max(0, Math.min(1, v));
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function set3(T, g, x, y, z) { const o = P[g]; T[o] = x; T[o + 1] = y; T[o + 2] = z; }
function mix3(T, g, x, y, z, w) { const o = P[g]; T[o] += (x - T[o]) * w; T[o + 1] += (y - T[o + 1]) * w; T[o + 2] += (z - T[o + 2]) * w; }

export const PASSINHO = { rate: 8, lead: 0.12 }; // (steps a second; a beat to get down into it)
// the four steps of a figure: which foot, where it goes (x out from its own side, z forward), how high it lifts on the
// way, its pitch there (+ toe down, - toe up: a heel flick), and the knee's snap (+ in, - out)
export const PASSINHO_STEPS = [
  { foot: 'L', x: 0.02, z: 0.3, lift: 0.07, pitch: -0.55, knee: -0.5 }, // left heel out in front
  { foot: 'R', x: 0.02, z: 0.3, lift: 0.07, pitch: -0.55, knee: -0.5 }, // right heel out in front
  { foot: 'L', x: -0.08, z: -0.26, lift: 0.09, pitch: 0.7, knee: 0.6 }, // left toe taps back behind, crossing
  { foot: 'R', x: 0.24, z: 0.04, lift: 0.12, pitch: 0.3, knee: 0.7 }, // right foot kicks out to the side, knee in
];

// where each foot is at time t: [x, y, z, pitch, knee] for the left and the right (the moving foot out and back inside
// its step, the other one planted under him)
export function passinhoFeet(t) {
  const u = Math.max(0, t - PASSINHO.lead) * PASSINHO.rate, i = Math.floor(u), q = u - i, s = PASSINHO_STEPS[i % 4];
  const out = Math.sin(Math.PI * Math.min(1, q / 0.85)), up = Math.sin(Math.PI * Math.min(1, q / 0.5)) * (q < 0.5 ? 1 : 0);
  const on = sm(0, PASSINHO.lead, t);
  const foot = side => {
    const base = side === 'L' ? 0.14 : -0.14, sg = side === 'L' ? 1 : -1;
    if (s.foot !== side) return [base, 0.08, 0.02, 0, 0];
    return [base + sg * s.x * out * on, 0.08 + s.lift * up * on, 0.02 + s.z * out * on, s.pitch * out * on, s.knee * out * on];
  };
  return { L: foot('L'), R: foot('R'), step: i, q, beat: Math.exp(-q / 0.18) * on };
}

export function passinhoPose(T, t, k, an) {
  const f = passinhoFeet(t), { beat } = f, on = sm(0, PASSINHO.lead, t), ph = Math.max(0, t - PASSINHO.lead) * PASSINHO.rate;
  mix3(T, 'footL', f.L[0], f.L[1], f.L[2], k); mix3(T, 'footR', f.R[0], f.R[1], f.R[2], k);
  T[P.pitchL] = f.L[3] * k; T[P.pitchR] = f.R[3] * k;
  // the knees snap in and out with the steps (the hint swings across), both a little in all along: low and loose
  set3(T, 'kneeL', 0.14 - 0.22 * f.L[4] - 0.04, 0.2, 1); set3(T, 'kneeR', -0.14 + 0.22 * f.R[4] + 0.04, 0.2, 1);
  // low, bobbing down on every step and back up
  T[P.root + 1] = (-0.1 * (0.4 + 0.6 * on) - 0.035 * beat + 0.012 * Math.sin(TAU * ph) * on) * k;
  // the hips twist against the feet (toward the side the moving foot went), the chest back the other way
  const tw = (f.L[2] - f.R[2]) * 0.6 + (f.R[0] + f.L[0]) * 0.8;
  T[P.pelvis + 1] = 0.32 * tw * k; T[P.chest + 1] = -0.4 * tw * k;
  T[P.spine] = (0.1 + 0.03 * beat) * k; T[P.chest] = 0.04 * k;
  // shoulders bounce on the beat, alternating; the head nods and bobs side to side
  const alt = f.step % 2 ? 1 : -1;
  T[P.clavL + 2] = 0.1 * beat * (alt > 0 ? 1 : 0.4) * k; T[P.clavR + 2] = -0.1 * beat * (alt < 0 ? 1 : 0.4) * k;
  T[P.head] = (0.06 + 0.1 * beat) * k; T[P.head + 2] = 0.08 * Math.sin(TAU * ph / 4) * k;
  // the arms hang loose and easy: low in front of the hips, swinging opposite to the feet, elbows soft, palms in
  const sw = Math.sin(TAU * ph / 2);
  mix3(T, 'handL', 0.3 + 0.04 * sw, 1.0 + 0.06 * beat, 0.12 + 0.16 * sw, k); mix3(T, 'handR', -0.3 + 0.04 * sw, 1.0 + 0.06 * beat, 0.12 - 0.16 * sw, k);
  set3(T, 'elbowL', 0.8, -0.6, -0.4); set3(T, 'elbowR', -0.8, -0.6, -0.4);
  an.palm.L = { normal: [-1, 0, 0], fingers: [0, -1, 0.3], w: 0.6 * k }; an.palm.R = { normal: [1, 0, 0], fingers: [0, -1, 0.3], w: 0.6 * k };
}
