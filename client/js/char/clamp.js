// v0.4.8.5 The Clamp (the Lockdown Icon badge): the bodies of his steal animations (sim/clamp.js has what they are, how
// they're picked and the ball's path through them). The reaches are the 'steal' action's body (Animator.actionPose
// calls clampStealPose for a.icon 'clamp'); a pass he picks off and a ball he strips are an overlay (clampOverlay, from
// Animator.update after the ball hands), read from Player.clampFx. Where he has the ball the animator's ball hands are
// already on it (the sim carries it on the animation's path); the bodies here fit round that.
// Positions are the animator's: character space, reference units (a 2 m athlete), +z in front, +x his left.
import { P } from './pose.js';
import { BALL_R } from '../sim/constants.js';
import { CLAMP_HIT, clampStealBody, clampPickBody, clampJab } from '../sim/clamp.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const L3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const Q3 = (a, c, b, t) => { const u = 1 - t; return [0, 1, 2].map(i => u * u * a[i] + 2 * u * t * c[i] + t * t * b[i]); };
function set3(T, g, x, y, z) { const o = P[g]; T[o] = x; T[o + 1] = y; T[o + 2] = z; }
const put = (T, g, v) => set3(T, g, v[0], v[1], v[2]);
function mix3(T, g, v, w) { const o = P[g]; T[o] += (v[0] - T[o]) * w; T[o + 1] += (v[1] - T[o + 1]) * w; T[o + 2] += (v[2] - T[o + 2]) * w; }

// The reaches. a: the steal action (hand, low, clamp: the reach, t, dur); b: the ball (his frame, reference units).
// The hands go at the ball as it is until the contact (CLAMP_HIT, the sim's resolveSteal), then on the reach's own path
// from where it was then (a.cAim), whatever the ball does after (in his hands, poked away or still with the man).
export function clampStealPose(an, T, a, p, b) {
  const t = a.t, dur = a.dur || 0.46, hd = a.hand === 'L' ? 'L' : 'R', of = hd === 'L' ? 'R' : 'L', sg = hd === 'L' ? 1 : -1;
  const near = b && Math.hypot(b[0], b[2]) < 1.6;
  const live = near ? [clamp(b[0], -0.62, 0.62), b[1], clamp(b[2], 0.28, 0.95)] : [sg * 0.12, 0.95, 0.75];
  if (t >= CLAMP_HIT && !a.cAim) a.cAim = live;
  const aim = t >= CLAMP_HIT && a.cAim ? a.cAim : live;
  const inK = sm(0, CLAMP_HIT, t), g = t - CLAMP_HIT, out = sm(dur - 0.13, dur, t);
  const guardL = [sg * 0.4, 1.18, 0.3], guardO = [-sg * 0.4, 1.18, 0.3];
  const by = clamp(aim[1], 0.72, 1.3);
  let H1 = null, H2 = null, e1 = [sg * 0.7, -0.6, -0.3], e2 = [-sg * 0.7, -0.6, -0.3];
  let head = null;
  let fL = [0.26, 0.08, 0.04], fR = [-0.26, 0.08, -0.02], kL = [0.4, 0, 1], kR = [-0.4, 0, 1];
  const footHd = v => { if (hd === 'L') fL = v; else fR = v; }, footOf = v => { if (hd === 'L') fR = v; else fL = v; };
  switch (a.clamp) {
    case 'hip_rip': {
      // both hands on it at his hip, then ripped back across his own body to the far hip on a high arc, the shoulders
      // turning away with it and the lead foot dropping back
      const k2 = sm(0, 0.2, g), at = [aim[0], by, aim[2]], hip = [-sg * 0.3, 0.98, 0.1];
      const c = Q3(at, [lerp(at[0], hip[0], 0.3), by + 0.1, 0.5], hip, k2);
      H1 = g < 0 ? L3(guardL, [at[0] + sg * 0.12, at[1], at[2]], inK) : [c[0] + sg * 0.11, c[1], c[2] + 0.02 * (1 - k2)];
      H2 = g < 0 ? L3(guardO, [at[0] - sg * 0.12, at[1], at[2]], inK) : [c[0] - sg * 0.11, c[1] - 0.02, c[2] + 0.06 * k2];
      e1 = [sg * 0.9, -0.3, -0.4]; e2 = [-sg * 0.9, -0.3, -0.4];
      footHd([sg * 0.22, 0.08, lerp(0.34 * inK, -0.2, k2)]); footOf([-sg * 0.24, 0.08, -0.04]);
      an.palm[hd] = { normal: [-sg, 0.1, 0.2], fingers: [0, 0.5, 0.9], w: 0.85 * inK };
      an.palm[of] = { normal: [sg, 0.1, 0.2], fingers: [0, 0.5, 0.9], w: 0.85 * inK };
      break;
    }
    case 'dig': {
      // a deep lunge, the lead hand stabbing down at the low dribble palm-down and digging it out, the other arm
      // trailing straight back for balance, the head down over it
      const at = [aim[0], clamp(aim[1], 0.3, 0.72), aim[2] + 0.06], k2 = sm(0.04, 0.24, g);
      H1 = Q3(guardL, [lerp(guardL[0], at[0], 0.5), 1.0, (guardL[2] + at[2]) / 2 + 0.1], at, inK);
      if (g > 0) H1 = [at[0] + sg * 0.05 * k2, at[1] + 0.3 * k2, at[2] - 0.22 * k2];
      H2 = L3(guardO, [-sg * 0.42, 1.08, -0.52], inK); e1 = [sg * 0.5, -0.6, -0.2]; e2 = [-sg * 0.5, -0.2, -1];
      const lunge = inK * (1 - 0.6 * out);
      head = 0.18 * lunge;
      footHd([sg * 0.27, 0.08, 0.46 * lunge]); footOf([-sg * 0.18, 0.08, -0.4 * lunge]);
      if (hd === 'L') { kL = [0.3, 0.2, 1]; kR = [-0.3, -0.4, 1]; } else { kR = [-0.3, 0.2, 1]; kL = [0.3, -0.4, 1]; }
      an.palm[hd] = { normal: [0, -1, 0.35], fingers: [0, -0.35, 1], w: 0.9 * inK };
      break;
    }
    case 'slap_down': {
      // reaching across: the far hand comes up high over the top and slaps down across his body onto the ball, on
      // through to his knee; the near hand held out wide and low; the slapping shoulder turned through
      const at = [aim[0] + sg * 0.04, by, aim[2]], over = [lerp(guardL[0], at[0], 0.45), 1.95, 0.55], k2 = sm(0, 0.16, g);
      H1 = g < 0 ? Q3(guardL, over, at, inK) : [at[0] - sg * 0.1 * k2, at[1] - 0.55 * k2, at[2] - 0.02 * k2];
      H2 = L3(guardO, [-sg * 0.58, 0.96, 0.24], inK); e1 = [sg * 0.8, 0.4, -0.4]; e2 = [-sg * 1, -0.4, -0.3];
      footHd([sg * 0.16, 0.08, 0.3 * inK + 0.1 * k2]); footOf([-sg * 0.3, 0.08, -0.06]);
      an.palm[hd] = { normal: [0, -1, 0.25], fingers: [-sg * 0.3, -0.2, 1], w: 0.9 * inK };
      break;
    }
    case 'swipe_spin': {
      // a swipe straight through the ball from the outside, and the momentum spins him out a full turn (clampSpin), the
      // swiping arm flung out low as he comes round, the other tucked
      const at = [aim[0] + sg * 0.05, by, aim[2]], k2 = sm(0, 0.12, g);
      H1 = g < 0 ? Q3(guardL, [sg * 0.6, by + 0.08, 0.5], at, inK) : L3([at[0] - sg * 0.9 * k2, at[1] + 0.05 * k2, lerp(at[2], 0.32, k2)], [-sg * 0.5, 1.15, 0.12], sm(0.14, 0.3, g));
      H2 = L3(guardO, [-sg * 0.36, 1.04, 0.1], inK); e1 = [sg * 0.6, -0.3, -0.5]; e2 = [-sg * 0.8, -0.5, -0.4];
      fL = [0.15, 0.08, 0.02]; fR = [-0.15, 0.08, 0.0]; kL = [0.25, 0, 1]; kR = [-0.25, 0, 1];
      an.palm[hd] = { normal: [-sg, 0, 0.35], fingers: [0, 0.3, 1], w: 0.85 * inK };
      break;
    }
    case 'double_tap': {
      // two quick pokes at the ball, jab-jab, bouncing on his toes, the other hand up high as a decoy
      const jab = clampJab(t);
      const at = [aim[0], by, aim[2] + 0.12], home = [sg * 0.32, 1.25, 0.28];
      H1 = L3(home, at, jab);
      H2 = L3(guardO, [-sg * 0.26, 1.78, 0.32], inK * (1 - out)); e1 = [sg * 0.7, -0.6, -0.2]; e2 = [-sg * 0.9, -0.1, -0.4];
      const bounce = Math.abs(Math.sin(Math.PI * t / 0.22));
      fL = [0.24, 0.08, 0.06 + 0.06 * jab]; fR = [-0.24, 0.08, -0.02]; T[P.pitchL] = 0.3 * bounce; T[P.pitchR] = 0.3 * bounce;
      an.palm[hd] = { normal: [0, -0.4, 1], fingers: [0, 0.1, 1], w: 0.85 * jab };
      an.palm[of] = { normal: [0, 0.1, 1], fingers: [0, 1, 0], w: 0.7 * inK };
      break;
    }
    default: {
      // 'vise': both hands clamped on the ball from either side, low and square in a wide stance, then ripped in to his
      // chest, elbows out
      const at = [aim[0], by, aim[2] - 0.03], k2 = sm(0, 0.16, g), chestPt = [0, 1.22, 0.4];
      const c = L3(at, chestPt, k2);
      H1 = L3(guardL, [c[0] + sg * 0.12, c[1], c[2]], inK); H2 = L3(guardO, [c[0] - sg * 0.12, c[1], c[2]], inK);
      e1 = [sg * 1, -0.2, -0.3]; e2 = [-sg * 1, -0.2, -0.3];
      fL = [0.32, 0.08, 0.06]; fR = [-0.32, 0.08, 0.02]; kL = [0.55, 0, 1]; kR = [-0.55, 0, 1];
      an.palm[hd] = { normal: [-sg, 0, 0.25], fingers: [0, 0.4, 1], w: 0.85 * inK };
      an.palm[of] = { normal: [sg, 0, 0.25], fingers: [0, 0.4, 1], w: 0.85 * inK };
    }
  }
  // back to a ready stance by the end of the reach
  const r = 1 - out * 0.7;
  put(T, 'hand' + hd, L3(guardL, H1, r)); put(T, 'hand' + of, L3(guardO, H2, r));
  put(T, 'elbow' + hd, e1); put(T, 'elbow' + of, e2);
  // the trunk: the reach's own (sim/clamp.js clampStealBody: a ball he comes up with is held in front of it)
  const B = clampStealBody(a);
  T[P.root + 1] = B.c; T[P.spine] = B.sp; T[P.chest] = B.cp; T[P.chest + 1] = B.tw; T[P.spine + 2] = B.roll;
  if (head != null) T[P.head] = head * r;
  put(T, 'footL', fL); put(T, 'footR', fR); put(T, 'kneeL', kL); put(T, 'kneeR', kR);
  an.clampReach(T, 'L'); an.clampReach(T, 'R');
}

// a steal he came up with: both hands on it either side, turned with the chest (the reach turns him a long way: the
// animator's own two-hand hold is square to his hips)
function stealHands(an, T, a, b) {
  const tw = clampStealBody(a).tw, r = BALL_R / an.s, c = Math.cos(tw), s = Math.sin(tw);
  const side = (x, z) => [b[0] + x * c + z * s, b[1] - 0.03, b[2] - x * s + z * c];
  put(T, 'handL', side(r + 0.075, -0.07)); put(T, 'handR', side(-r - 0.075, -0.07));
  set3(T, 'elbowL', 0.9 * c, -0.6, -0.9 * s - 0.3); set3(T, 'elbowR', -0.9 * c, -0.6, 0.9 * s - 0.3);
  an.palm.L = { normal: [-c, 0.05, s + 0.2], fingers: [0, 0.75, 0.65], w: 0.85 }; an.palm.R = { normal: [c, 0.05, -s + 0.2], fingers: [0, 0.75, 0.65], w: 0.85 };
}

// The overlays: a pass he picks off and a ball he strips off a driver. Full body when he's free (no action, or the
// catch or the stagger the sim gives him); just the arms and the trunk in the air or through a stumble. The legs give
// way to his stride when he runs off with it.
export function clampOverlay(an, T, p, a, b, airborne, has) {
  if (a && a.type === 'steal') { if (a.clamp && has && b) stealHands(an, T, a, b); return; }
  const fx = p.clampFx;
  if (!fx) return;
  const busy = airborne || (a && !['catch', 'bump', 'celebrate'].includes(a.type));
  const legsW = busy ? 0 : 1 - (an.gaitInfo?.wGait || 0);
  const t = fx.t, sd = fx.side || 1, s = an.s, r = BALL_R / s;
  const sdS = sd > 0 ? 'L' : 'R', otS = sd > 0 ? 'R' : 'L';
  const legs = (fl, fr, kl, kr) => { if (legsW <= 0) return; mix3(T, 'footL', fl, legsW); mix3(T, 'footR', fr, legsW); mix3(T, 'kneeL', kl, legsW); mix3(T, 'kneeR', kr, legsW); };
  if (fx.kind === 'strip') {
    // chest up and square into the contact, then both hands down on the ball and ripping it out and away to his hip
    const hit = Math.sin(Math.PI * clamp(t / 0.18, 0, 1)), down = sm(0.04, 0.12, t), rip = sm(0.12, 0.3, t), fin = 1 - sm(0.36, 0.52, t);
    const from = fx.from ? [clamp(fx.from[0] / s, -0.55, 0.55), clamp(fx.from[1] / s, 0.6, 1.25), clamp(fx.from[2] / s, 0.3, 0.75)] : [sd * 0.25, 0.9, 0.5];
    const hip = [-sd * 0.3, 0.96, 0.12], c = Q3(from, [lerp(from[0], hip[0], 0.4), from[1] - 0.12, 0.42], hip, rip);
    T[P.spine] = lerp(T[P.spine], -0.16 * hit + 0.3 * rip * (1 - rip * 0.4), fin); T[P.chest] = lerp(T[P.chest], -0.12 * hit, fin);
    T[P.chest + 1] = lerp(T[P.chest + 1], sd * 0.55 * rip, fin); T[P.head] = lerp(T[P.head], -0.12 * hit + 0.2 * rip, fin);
    if (!has) {
      const w = down * fin;
      mix3(T, 'handL', [c[0] + 0.11, c[1], c[2]], w); mix3(T, 'handR', [c[0] - 0.11, c[1], c[2]], w);
      mix3(T, 'elbowL', [1, 0.1, -0.2], w); mix3(T, 'elbowR', [-1, 0.1, -0.2], w);
      an.palm.L = { normal: [-1, -0.2, 0.2], fingers: [0, 0.2, 1], w: 0.85 * w }; an.palm.R = { normal: [1, -0.2, 0.2], fingers: [0, 0.2, 1], w: 0.85 * w };
      an.clampReach(T, 'L'); an.clampReach(T, 'R');
    }
    if (legsW > 0) T[P.root + 1] -= 0.14 * fin * legsW;
    legs([0.3, 0.08, 0.05], [-0.3, 0.08, -0.02], [0.5, 0, 1], [-0.5, 0, 1]);
    return;
  }
  // a pass picked off: the trunk is the pick's own (sim/clamp.js clampPickBody: the ball in his hands is held in front
  // of it), less of it as he runs off with it
  const fin = 1 - sm(fx.dur - 0.16, fx.dur, t), B = clampPickBody(fx);
  if (!busy) {
    const w = fin * (1 - 0.6 * (an.gaitInfo?.wGait || 0));
    T[P.root + 1] = lerp(T[P.root + 1], B.c, w); T[P.spine] = lerp(T[P.spine], B.sp, w); T[P.chest] = lerp(T[P.chest], B.cp, w);
    T[P.chest + 1] = lerp(T[P.chest + 1], B.tw, w); T[P.pelvis + 1] = lerp(T[P.pelvis + 1], B.yaw, w); T[P.root + 2] = lerp(T[P.root + 2], B.z, w);
  }
  switch (fx.style) {
    case 'tip_self': {
      // up on his toes, one hand under it tipping it up, his eyes on it, then both hands up to take it as it drops
      const tip = 1 - sm(0.12, 0.2, t), catchK = sm(0.16, 0.3, t);
      if (has && b) {
        if (tip > 0) {
          mix3(T, 'hand' + sdS, [b[0] + sd * 0.02, b[1] - r - 0.07, b[2] - 0.05], tip);
          an.palm[sdS] = { normal: [0, 1, 0.1], fingers: [0, 0.4, 1], w: 0.9 * tip };
          mix3(T, 'hand' + otS, [-sd * 0.3, 1.3, 0.34], tip);
        }
        // (dropping into his hands: the hands under it a touch, open)
        const drop = catchK * (1 - sm(0.36, 0.44, t));
        if (drop > 0) { T[P['handL'] + 1] -= 0.05 * drop; T[P['handR'] + 1] -= 0.05 * drop; }
      }
      T[P.head] = lerp(T[P.head], -0.3 * (1 - catchK) - 0.1, fin * 0.8);
      if (legsW > 0) { T[P.pitchL] = 0.45 * tip * legsW; T[P.pitchR] = 0.45 * tip * legsW; }
      legs([0.16, 0.08, 0.04], [-0.16, 0.08, -0.02], [0.25, 0, 1], [-0.25, 0, 1]);
      break;
    }
    case 'pick_go': {
      // picked with one hand and swung to the hip on that side, the other arm swinging out, the hips and shoulders turned
      // upcourt with a step across
      const turn = sm(0.1, 0.3, t) * (1 - sm(0.4, fx.dur, t)), up = clamp(fx.up ?? sd * 0.6, -1, 1);
      if (has && b) {
        mix3(T, 'hand' + sdS, [b[0] + sd * (r + 0.05), b[1] - 0.02, b[2] - 0.05], fin);
        an.palm[sdS] = { normal: [-sd, 0.1, 0.1], fingers: [0, 0.7, 0.7], w: 0.9 * fin };
        mix3(T, 'hand' + otS, [-sd * 0.5, 1.32, 0.1], fin); mix3(T, 'elbow' + otS, [-sd * 1, -0.2, -0.4], fin);
        an.palm[otS] = null;
      }
      const step = Math.sin(Math.PI * clamp((t - 0.12) / 0.24, 0, 1));
      legs([0.2 + (up > 0 ? 0.08 * turn : 0), 0.08 + (up < 0 ? 0.08 * step : 0), 0.06 + (up < 0 ? 0.18 * turn : 0)], [-0.2 - (up < 0 ? 0.08 * turn : 0), 0.08 + (up > 0 ? 0.08 * step : 0), 0.0 + (up > 0 ? 0.18 * turn : 0)], [0.35, 0, 1], [-0.35, 0, 1]);
      break;
    }
    default: {
      // 'lane_dive': lunging into the lane after it, low and stretched out, both hands snatching it out of the air and
      // pulling it in (the ball hands have it; the body goes after it), then up out of the lunge
      const lunge = sm(0, 0.04, t) * (1 - sm(0.22, fx.dur, t));
      T[P.head] = lerp(T[P.head], -0.2 * lunge, fin);
      if (has) { mix3(T, 'elbowL', [1, -0.1, -0.3], fin); mix3(T, 'elbowR', [-1, -0.1, -0.3], fin); }
      const lead = [sd * 0.3, 0.08, 0.55 * lunge], trail = [-sd * 0.16, 0.08, -0.32 * lunge];
      if (sd > 0) legs(lead, trail, [0.3, 0.2, 1], [-0.3, -0.3, 1]); else legs(trail, lead, [0.3, -0.3, 1], [-0.3, 0.2, 1]);
    }
  }
}
