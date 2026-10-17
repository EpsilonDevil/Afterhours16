// v0.4.8.5 quick patch 5: the poses of two Icon badges' own animations, kept out of the animator's body (it calls in):
//  * Sexy Red's Post Move Package (sim/redpost.js has the data and the clock): the base back-down stance and its five
//    back-downs, the off arm's bar, and the flourishes on its signature turnaround and hook;
//  * The General's Salute (the celebration item cel_general_salute, kind 'general').
// Pose units are the animator's: character space for a 2.0 m athlete (x left, y up, z forward), angles in radians.
// The ball is never moved here: the dribble and the shots keep it where the sim puts it (Game.holdPoint) and the
// animator's ballHands keeps the hand on it; only the body around it and the free arm are posed.
import { P } from './pose.js';
import { redClock, redSeed, RED_POST_PKG } from '../sim/redpost.js';

const TAU = Math.PI * 2;
const clamp01 = v => Math.max(0, Math.min(1, v));
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function set3(T, g, x, y, z) { const o = P[g]; T[o] = x; T[o + 1] = y; T[o + 2] = z; }
function add3(T, g, x, y, z) { const o = P[g]; T[o] += x; T[o + 1] += y; T[o + 2] += z; }
function mix3(T, g, x, y, z, w) { const o = P[g]; T[o] += (x - T[o]) * w; T[o + 1] += (y - T[o + 1]) * w; T[o + 2] += (z - T[o + 2]) * w; }
// a quick hit that dies away: up in `a` s from t0, then decays over `d` s
const hit = (u, t0, a = 0.07, d = 0.18) => { const x = u - t0; return x < 0 ? 0 : x < a ? sm(0, a, x) : Math.exp(-(x - a) / d); };
// one step of the feet: q (0..1) through the step: the lift (0 on the floor) and how far through it the foot is
const stepK = q => (q > 0 && q < 1 ? Math.sin(Math.PI * q) : 0);

// ---------------- Sexy Red: the back-downs ----------------
// The base: lower and wider than any store package, sat back into the man, chin up, the knees out
function redBase(T, c) {
  T[P.root + 1] -= 0.12;
  T[P.root + 2] -= 0.03;
  T[P.spine] = -0.2; T[P.chest] = -0.07; T[P.head] = -0.03;
  T[P.pelvis + 1] = 0; T[P.pelvis + 2] = 0;
  const w = c.still;
  mix3(T, 'footL', 0.33, 0.08, -0.06, w); mix3(T, 'footR', -0.33, 0.08, -0.12, w);
  set3(T, 'kneeL', 0.55, 0, 1); set3(T, 'kneeR', -0.55, 0, 1);
  T[P.yawL] = lerp(T[P.yawL], 0.32, w); T[P.yawR] = lerp(T[P.yawR], -0.32, w);
}
// each style adds to the base (e: its envelope, 0 at the phrase's ends); c.still: 1 standing, 0 backing at a walk (the
// gait has the feet then), c.os: the off arm's side (+1 his left), sd: the way his feints and looks go this time
const RED = {
  // Shimmy Grind: the shoulders shimmy fast (4.4 a second), the hips grind round in a slow circle under them, and the feet
  // chip back at the man in turn, the knees giving with each
  red_grind(T, u, L, sd, e, c) {
    const sh = Math.sin(TAU * 4.4 * u), gr = Math.sin(TAU * 1.25 * u), gc = Math.cos(TAU * 1.25 * u);
    T[P.chest + 1] += 0.42 * sh * e;
    T[P.clavL + 2] += 0.18 * sh * e; T[P.clavR + 2] += 0.18 * sh * e;
    T[P.pelvis + 2] += 0.18 * gr * e; T[P.pelvis + 1] += 0.2 * gc * e;
    T[P.root] += 0.08 * gr * e; T[P.root + 2] -= 0.05 * (0.5 + 0.5 * gc) * e;
    T[P.root + 1] -= (0.02 + 0.05 * Math.abs(Math.sin(TAU * 2.5 * u))) * e;
    T[P.spine] += (-0.05 + 0.08 * Math.sin(TAU * 2.5 * u)) * e;
    T[P.spine + 2] -= 0.12 * gr * e;
    T[P.head + 1] -= 0.55 * 0.42 * sh * e; T[P.head] += (0.05 * sh - 0.02) * e;
    // the chips back: left in the first half of each grind, right in the second
    const ph = (u * 1.25) % 1, qL = ph / 0.3, qR = (ph - 0.5) / 0.3, w = e * c.still;
    add3(T, 'footL', 0.02 * stepK(qL) * w, 0.05 * stepK(qL) * w, -0.07 * sm(0, 1, qL) * (1 - sm(0.3, 0.5, ph)) * w);
    add3(T, 'footR', -0.02 * stepK(qR) * w, 0.05 * stepK(qR) * w, -0.07 * sm(0, 1, qR) * (1 - sm(0.8, 1, ph)) * w);
    c.arm = { kind: 'bar', jig: sh, e };
  },
  // Seal & Sit: two hard hip-checks back into his chest (a shoulder bump with each, the off arm barring him), then he
  // sits down on him like a chair, head up, and holds it
  red_seal(T, u, L, sd, e, c) {
    const b1 = hit(u, 0.1), b2 = 0.9 * hit(u, 0.5), b = b1 + b2, sit = sm(0.82, 1.08, u);
    T[P.root + 2] -= (0.17 * b + 0.07 * sit) * e;
    T[P.root + 1] -= (0.045 * b + 0.16 * sit) * e;
    T[P.spine] += (-0.22 * b + 0.34 * sit) * e;
    T[P.chest] += (-0.1 * b + 0.06 * sit) * e;
    T[P.chest + 1] += (0.42 * sd * b1 - 0.42 * sd * b2) * e;
    T[P.head + 1] += c.os * 0.75 * b * (1 - sit) * e; // (a look back over the bar at him with each check)
    T[P.head] += (-0.08 * sit - 0.02 * b) * e;
    const w = e * c.still, wide = 0.08 * sit;
    add3(T, 'footL', wide * w, 0, -0.04 * sit * w); add3(T, 'footR', -wide * w, 0, -0.04 * sit * w);
    set3(T, 'kneeL', 0.7, 0, 1); set3(T, 'kneeR', -0.7, 0, 1);
    T[P.pitchL] += 0.0; T[P.pitchR] += 0.0;
    c.arm = { kind: 'bar', push: b, sit, e };
  },
  // Slow-Walk Two-Step: two big deliberate steps back (0.9 s each), the knee up high, the foot swung out wide and set
  // down behind; the shoulders swing against the hips, and as each foot lands a snap of a head fake one way and back
  red_twostep(T, u, L, sd, e, c) {
    const first = u < 0.9, side = (first ? 1 : -1) * sd, q = (first ? u : u - 0.9) / 0.9;
    const lift = q < 0.55 ? Math.sin(Math.PI * q / 0.55) : 0, land = q >= 0.55 ? hit(q, 0.55, 0.05, 0.12) : 0;
    const foot = side > 0 ? 'footL' : 'footR', other = side > 0 ? 'footR' : 'footL', w = e * c.still;
    add3(T, foot, side * 0.08 * lift * w, 0.27 * lift * w, (-0.16 * sm(0, 0.55, q) * (1 - sm(0.6, 1, q)) + 0.07 * lift) * w);
    add3(T, other, 0, 0, 0.04 * sm(0, 0.55, q) * (1 - sm(0.6, 1, q)) * w);
    if (lift > 0.02) set3(T, side > 0 ? 'kneeL' : 'kneeR', side * 0.35, 0.7 * lift, 1);
    T[side > 0 ? P.pitchL : P.pitchR] += 0.45 * lift * w;
    // the weight goes over the standing foot as the knee comes up, then onto the new one with a dip
    T[P.root] += -side * 0.07 * lift * e;
    T[P.root + 1] += (0.035 * lift - 0.06 * land) * e;
    T[P.pelvis + 2] += side * 0.12 * lift * e;
    T[P.chest + 1] += -side * 0.32 * lift * e;
    T[P.spine + 2] += side * 0.08 * lift * e;
    // the head fake: snapped one way and back past the middle as the foot comes down
    const hf = sm(0.56, 0.62, q) - 1.6 * sm(0.72, 0.78, q) + 0.6 * sm(0.86, 0.94, q);
    T[P.head + 1] += 0.65 * side * hf * e; T[P.chest + 1] += 0.12 * side * hf * e;
    T[P.head] += (0.08 * land - 0.04) * e;
    c.arm = { kind: 'swing', ph: side * lift - side * 0.4 * hf, e };
  },
  // Rim Peek: bouncing with the dribble, he turns right round to look over one shoulder at the rim, holds it, then whips
  // round over the other shoulder, chin up at the rim, and back
  red_peek(T, u, L, sd, e, c) {
    const lk1 = sm(0.1, 0.3, u) * (1 - sm(0.72, 0.84, u)), lk2 = sm(0.84, 1.0, u) * (1 - sm(1.36, 1.52, u)), look = sd * lk1 - sd * lk2, al = Math.abs(look);
    T[P.chest + 1] += 0.4 * look * e; T[P.pelvis + 1] += 0.14 * look * e;
    T[P.neck + 1] += 0.45 * look * e; T[P.head + 1] += 0.62 * look * e;
    T[P.head] += (-0.07 * al) * e; T[P.spine + 2] -= 0.08 * look * e; T[P.spine] += 0.05 * al * e;
    // the bounce: the knees give with every dribble (down as the ball goes down)
    const db = c.db;
    T[P.root + 1] += (0.06 - 0.06 * db + 0.03) * e;
    // the foot on the look side opens back a little
    const w = e * c.still;
    add3(T, 'footL', 0, 0, -0.08 * Math.max(0, look) * w); add3(T, 'footR', 0, 0, -0.08 * Math.max(0, -look) * w);
    T[P.yawL] += 0.25 * Math.max(0, look) * w; T[P.yawR] -= 0.25 * Math.max(0, -look) * w;
    c.arm = { kind: 'feel', look, e };
  },
  // Spin-Fake Re-Seal: the hips and the swing leg start the spin off him, the head going with them, then he snaps back
  // and drops into a hard re-seal, the off arm slamming the bar back across, and gives a cocky nod
  red_feint(T, u, L, sd, e, c) {
    const f = sm(0.04, 0.24, u) * (1 - sm(0.34, 0.48, u)), seal = sm(0.42, 0.56, u), slam = hit(u, 0.44, 0.06, 0.2);
    T[P.pelvis + 1] += sd * 0.6 * f * e; T[P.chest + 1] += sd * 0.55 * f * e; T[P.head + 1] += sd * 0.55 * f * e;
    T[P.root + 1] += (0.05 * f - 0.1 * seal - 0.04 * slam) * e;
    T[P.root + 2] -= (0.1 * slam + 0.04 * seal) * e;
    T[P.spine] += (0.12 * f - 0.14 * slam - 0.04 * seal) * e;
    T[P.chest] += -0.08 * seal * e;
    // the nod: chin down and back up, twice
    const nd = u > 0.8 && u < 1.25 ? Math.abs(Math.sin(Math.PI * (u - 0.8) / 0.225)) : 0;
    T[P.head] += (0.16 * nd - 0.06 * seal) * e;
    // the swing foot comes round (the spin toward sd: his right foot for a spin to his left) and back down wide
    const sw = sd > 0 ? 'footR' : 'footL', w = e * c.still;
    add3(T, sw, sd * 0.2 * f * w, 0.12 * Math.sin(Math.PI * clamp01(u / 0.48)) * w, 0.3 * f * w);
    T[sd > 0 ? P.yawR : P.yawL] += sd * 0.5 * f * w;
    add3(T, 'footL', 0.05 * seal * w, 0, 0); add3(T, 'footR', -0.05 * seal * w, 0, 0);
    c.arm = { kind: 'feint', f, slam, e };
  },
};

// The back-down, from the animator's posting block. on: posting (his back to the man, the ball his, no action). Poses
// the body and returns the frame (null when the package's back-down isn't playing); mv: 0 standing to 1 backing at a
// walk. an.red is the player's stream (sim/redpost.js redClock)
export function redBackdown(an, T, p, g, dt, on, mv = 0) {
  if (!on && !an.red) { an.redF = null; return null; } // (nobody's back-down yet: nothing to keep)
  const st = an.red || (an.red = { k: 0, u: 0, off: 0 });
  if (on) { const gs = g?.cfg?.seed ?? 0, key = `${p.id}:${gs}`; if (st.key !== key) { st.key = key; st.seed = redSeed(p.id, gs); st.k = 0; st.u = 0; st.off = 0; st.on = false; } }
  const F = redClock(st, dt, on);
  an.redF = F;
  if (!F) return null;
  const os = p.dribble?.hand === 'L' ? -1 : 1, ph = p.dribble?.phase || 0;
  const c = { still: 1 - sm(0.25, 0.9, mv), os, db: Math.abs(Math.cos(Math.PI * ph)), arm: null };
  redBase(T, c);
  RED[F.id](T, F.u, F.len, F.side, F.env, c);
  F.arm = c.arm; F.os = os;
  return F;
}

// The off arm, after ballHands has put the dribble hand on the ball: barred back against the man, elbow out (the
// base), and each back-down's own: the bar jigging with the shimmy, slammed back with the hip-checks, swinging with
// the two-step, feeling for him behind on the peek, flung round with the feint
export function redArms(an, T, F) {
  if (!F) return;
  const os = F.os, hand = os > 0 ? 'handL' : 'handR', elbow = os > 0 ? 'elbowL' : 'elbowR', A = F.arm || {}, e = A.e ?? F.env;
  // the bar: the forearm hooked back against the man at his hip, the elbow out wide (heights from the hips: he's low)
  const rY = T[P.root + 1];
  let x = 0.36, y = 1.22, z = -0.24, ex = 1, ey = 0.2, ez = 0.1;
  if (A.kind === 'bar') { y += 0.05 * (A.jig || 0) * e - 0.06 * (A.sit || 0) * e; z -= 0.1 * (A.push || 0) * e; x += 0.08 * (A.push || 0) * e; }
  else if (A.kind === 'swing') { x = lerp(0.36, 0.5, e); y = 1.24 + 0.12 * (A.ph || 0) * e; z = lerp(-0.24, 0.08 + 0.18 * (A.ph || 0), e); ez = lerp(0.1, -0.6, e); }
  else if (A.kind === 'feel') { const lk = Math.max(0, os * (A.look || 0)); x = 0.32 - 0.04 * lk; y = 1.16 - 0.04 * lk; z = -0.3 - 0.06 * lk; }
  else if (A.kind === 'feint') { const f = A.f || 0, sl = A.slam || 0; x = lerp(0.36, 0.6, f) + 0.08 * sl; y = 1.22 + 0.16 * f; z = lerp(-0.24, 0.16, f) - 0.12 * sl; ez = lerp(0.1, -0.5, f); }
  const w = Math.max(0.6, F.env);
  mix3(T, hand, os * x, y + rY, z, w);
  mix3(T, elbow, os * ex, ey, ez, w);
  an.palm[os > 0 ? 'L' : 'R'] = { normal: [0, 0, -1], fingers: [os * 0.2, 1, 0], w: 0.6 * w };
}

// The signature finishes: the Shimmy Turnaround (two quick shoulder shimmies and a head fake before he rises and turns)
// and the Leaning Hook (leaned right away from the man into the sweep, the lead knee driven up higher). Called from the
// shot's pose for a post shot of the package (a.pkg); sg: +1 shooting left-handed
export function redShot(T, a, p, t, sg) {
  if (a.pkg !== RED_POST_PKG) return;
  const tk = a.takeoff || 0.25;
  if (a.post === 'turn' && !a.released) {
    const pre = 1 - sm(tk * 0.75, tk + 0.04, t), sh = Math.sin(TAU * t / 0.13);
    T[P.chest + 1] += 0.34 * sh * pre; T[P.clavL + 2] += 0.14 * sh * pre; T[P.clavR + 2] += 0.14 * sh * pre;
    T[P.head + 1] += -sg * 0.5 * Math.sin(Math.PI * clamp01(t / Math.max(0.12, tk))) * pre;
    T[P.root + 1] -= 0.05 * pre;
  } else if (a.post === 'hook') {
    const k = Math.min(1, t / (a.tRel || 0.5)), off = sg > 0 ? 'R' : 'L';
    T[P.spine + 2] += sg * 0.2 * k; T[P.chest + 2] += sg * 0.1 * k; T[P.spine] -= 0.06 * k;
    add3(T, 'foot' + off, -sg * 0.04 * k, 0.12 * k * (p.airborne ? 1 : 0.4), 0.06 * k);
  }
}

// ---------------- The General's Salute ----------------
// 0-0.25 s: snaps to attention, heels together, arms pinned, chest out, and the right knee comes up and stamps down (the
// stomp); 0.26-0.58: the salute goes up, the arm swung out wide to shoulder height first, then in to the brow, the elbow
// high and out; 0.54-0.98: held while he turns with it to face the crowd (a quarter turn to his left, the feet stepping
// round); 0.96-1.06: cut down sharp as he turns back; 1.04-: "forward, march": the right arm thrown out straight upcourt,
// the left fist on the hip, a step forward, chin up, held to the end (the store preview's 2.4 s too). Its own blend: a
// snap in (0.1 s) and a quick release at the very end (0.15 s), so the march holds through an in-game 1.5-1.6 s.
// a: the celebration action (t, dur); an: the animator (palms)
export const GENERAL_TURN = 0.95;
export function generalSalute(T, a, an) {
  const t = a.t, dur = a.dur || 1.6, S = (x, y) => sm(x, y, t);
  const stompUp = S(0.08, 0.18) * (1 - S(0.2, 0.25)), stomp = hit(t, 0.25, 0.03, 0.12);
  const up = S(0.26, 0.58), side = Math.sin(Math.PI * up), turn = S(0.54, 0.86) * (1 - S(0.98, 1.12)), cut = S(0.96, 1.06), march = S(1.04, 1.18);
  const w = Math.min(1, t / 0.1) * (1 - sm(dur - 0.15, dur, t));
  // the body: at attention, chest out, chin up; the stomp drops him a touch; the march leans him into it
  T[P.spine] = lerp(T[P.spine], -0.12 + 0.1 * march, w); T[P.chest] = lerp(T[P.chest], -0.12, w); T[P.head] = lerp(T[P.head], -0.14 + 0.06 * stomp, w);
  T[P.root + 1] = lerp(T[P.root + 1], 0.015 - 0.05 * stomp - 0.03 * march, w);
  // feet: together at attention; the right one up and stamped down; on the march the left steps out in front
  mix3(T, 'footL', 0.075, 0.08, 0.27 * march, w);
  mix3(T, 'footR', -0.075, 0.08 + 0.3 * stompUp, 0.1 * stompUp - 0.05 * march, w);
  if (stompUp > 0.02) set3(T, 'kneeR', -0.12, 0.8 * stompUp, 1);
  T[P.pitchR] = lerp(T[P.pitchR], 0.4 * stompUp, w); T[P.pitchL] = lerp(T[P.pitchL], 0, w);
  T[P.yawL] = lerp(T[P.yawL], 0.12, w); T[P.yawR] = lerp(T[P.yawR], -0.12, w);
  // the right arm: pinned, then out wide at the shoulder and up to the brow (blade of the hand at the eyebrow, palm out,
  // elbow high and out), cut down to the side, then thrown straight out upcourt
  const brow = [-0.17, 1.79, 0.12], wide = [-0.86, 1.62, 0.08], pin = [-0.21, 0.98, 0.0], point = [-0.18, 1.78, 0.84];
  let R = pin;
  if (t < 0.58) { const q = up; R = q < 0.5 ? [lerp(pin[0], wide[0], q / 0.5), lerp(pin[1], wide[1], q / 0.5), lerp(pin[2], wide[2], q / 0.5)] : [lerp(wide[0], brow[0], (q - 0.5) / 0.5), lerp(wide[1], brow[1], (q - 0.5) / 0.5), lerp(wide[2], brow[2], (q - 0.5) / 0.5)]; R = [R[0] - 0.08 * side, R[1], R[2]]; }
  else if (t < 1.04) R = [lerp(brow[0], pin[0], cut), lerp(brow[1], pin[1], cut), lerp(brow[2], pin[2], cut)];
  else R = [lerp(pin[0], point[0], march), lerp(pin[1], point[1], march), lerp(pin[2], point[2], march)];
  mix3(T, 'handR', R[0], R[1], R[2], w);
  if (t < 1.0 && up > 0.4) set3(T, 'elbowR', -1, 0.3, 0.05); else if (t >= 1.04) set3(T, 'elbowR', -0.6, -0.3, -0.4); else set3(T, 'elbowR', -0.4, -0.3, -1);
  an.palm.R = t < 1.0 && up > 0.4 ? { normal: [0.2, -0.45, -1], fingers: [0.75, 0.6, 0.1], w: w } : t >= 1.04 ? { normal: [-1, 0, 0], fingers: [0, 0.25, 1], w: w * march } : { normal: [1, 0, 0], fingers: [0, -1, 0], w: w * 0.7 };
  // the left: pinned to his side at attention, then the fist on the hip, elbow out, for the march
  const L = [lerp(0.21, 0.36, march), lerp(0.98, 1.08, march), lerp(0.0, -0.04, march)];
  mix3(T, 'handL', L[0], L[1], L[2], w);
  if (march > 0.05) set3(T, 'elbowL', 1, 0.15, -0.6); else set3(T, 'elbowL', 0.35, -0.3, -1);
  an.palm.L = march > 0.05 ? { normal: [1, 0, 0], fingers: [0, -1, 0.4], w: w * march } : { normal: [-1, 0, 0], fingers: [0, -1, 0], w: w * 0.7 };
  // the head: turned with the salute to the crowd, then square upcourt for the march
  T[P.head + 1] = lerp(T[P.head + 1], 0.25 * turn, w);
  // the turn: the whole stance turned to his left about his feet (pelvis, both feet and their poles, both hands)
  const th = GENERAL_TURN * turn * w;
  if (th) turnPose(T, th);
}
// turn the whole pose about the vertical through his feet by th (to his left +): the hips, the feet and the hands
const TURNED = ['handL', 'handR', 'elbowL', 'elbowR', 'footL', 'footR', 'kneeL', 'kneeR'];
export function turnPose(T, th) {
  const c = Math.cos(th), s = Math.sin(th);
  for (const g of TURNED) { const o = P[g], x = T[o], z = T[o + 2]; T[o] = x * c + z * s; T[o + 2] = -x * s + z * c; }
  { const x = T[P.root], z = T[P.root + 2]; T[P.root] = x * c + z * s; T[P.root + 2] = -x * s + z * c; }
  T[P.pelvis + 1] += th; T[P.yawL] += th; T[P.yawR] += th;
}
