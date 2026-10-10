// Authoritative client-side basketball simulation (60 Hz fixed step).
// Park: halfcourt 21 by 2s/3s with check-ball and take-it-back. Pro-Am: full court 5v5 with quarters,
// shot clock, inbounds, fouls and free throws. Practice: shootaround with rebounder.
import { RNG } from '../core/rng.js';
import { COURT, BALL_R, GRAVITY, isThree, ballOut, feetOut, FOOT_R, DT } from './constants.js';
import { Ball } from './ball.js';
import { Player, toWorld, blankIntent } from './player.js';
import * as S from './shots.js';
import { spotsFor, CHECK_SPOT, rimOf } from './formation.js';
import { AI } from './ai.js';
import { statProfile } from './profile.js';

import { rk as n } from './ratings.js';
import { bk, TAKEOVERS, TAKEOVER_NEED, TAKEOVER_SECS, ICON_BADGES } from './badges.js';
// v0.4.5 defense: +3.75% contest range, positioning (blocks, contests, boards), block timing and lane pressure
import { DEF_K } from './shots.js';
import { LockedInGrade } from '../game/grade.js';
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
import { MOVES, moveProfile, switchesHand, comboName, moveStyle } from './moves.js';
// v0.4.5 quick patch: snappier dribble moves. Every move is 20% shorter, and a better Ball Handle and Speed With
// Ball make it quicker still (up to about a third quicker on top). The next move can start once the current one is
// 60% through (CHAIN_AT), and a different move started within COMBO_GAP of the last one is a combo: it costs no
// stamina and is a little more likely to break ankles. Spamming the same move still drains you harder.
// v0.4.7.5 quick patch: every dribble move 20% slower, for every package and rating (DRIBBLE_MOVE_SPEED: the move
// takes 1/0.8 as long and its burst is 0.8 as fast, so he covers the same ground in it, just less frantically);
// packages, the handle and the position still make some players quicker than others, in the same proportions
export const DRIBBLE_MOVE_SPEED = 0.8;
// (the burst eases off less than the timing slows, so a move still covers the ground it did: a stepback still makes
// its space. The velocity takes a moment to build in every move, so a straight 0.8 lost about a tenth of the ground)
export const MOVE_BURST_K = Math.sqrt(DRIBBLE_MOVE_SPEED);
export const MOVE_SNAP = 0.8 / DRIBBLE_MOVE_SPEED, CHAIN_AT = 0.6, COMBO_GAP = 0.4;
// v0.4.5 quick patch: how fast each position's dribble moves come out (bigs are 10% slower, wings 5%; PGs as they were),
// and then every move for everyone 5% slower on top (MOVE_SPEED_ALL)
export const POS_MOVE_SPEED = { PG: 1, SG: 0.95, SF: 0.95, PF: 0.9, C: 0.9 };
export const MOVE_SPEED_ALL = 0.95;
export const posMoveK = pos => (POS_MOVE_SPEED[pos] ?? 1) * MOVE_SPEED_ALL;
// v0.4.7.5: the better the handle, the sooner the next move can cut in (60% through at a 60 handle, 40% at 99) and the
// harder the burst snaps in (the velocity blend rate)
export const chainAt = p => Math.max(0.4, Math.min(CHAIN_AT, CHAIN_AT - ((p.ratings.ball_handle ?? 60) - 60) * 0.0052));
export const moveSnapRate = p => 12 + 10 * Math.max(0, Math.min(1, ((p.ratings.ball_handle ?? 60) - 50) / 49));
// v0.4.5: the ball travels 0.985% slower on passes
const PASS_K = 1 - 0.00985;
// v0.4.5 alley-oops: takeoff spot distance from the lob's aim point, and the most a receiver can drift in the air
const OOP_TAKEOFF = 1.25, OOP_DRIFT = 1.8;
const PASS = { chest: { dur: 0.3, rel: 0.13, speed: 12.5 * PASS_K }, bounce: { dur: 0.34, rel: 0.15, speed: 10 * PASS_K }, lob: { dur: 0.44, rel: 0.22 }, alley: { dur: 0.44, rel: 0.22 }, flick: { dur: 0.22, rel: 0.08, speed: 12 * PASS_K }, inbound: { dur: 0.4, rel: 0.2, speed: 11 * PASS_K } };
// v0.4.5 small stamina costs per action (sprinting still costs the most)
// v0.4.5 final: every stamina-draining action costs STAMINA_K times what it did: jumpers, layups, dunks, passes,
// reaching (steals), jumping, dribble moves and screens (sprinting follows it in player.js)
export const STAMINA_K = 2;
// v0.4.5 / v0.4.7.5 quick patch: repeating the same dribble move. More than 3 in a row: stamina drains twice as fast
// (+0.1x per repeat after the 4th); more than 6 in a row: that penalty doubles (4.6x at the 7th, up to 6x)
export const REPEAT_GAP = 3;
export function repeatMoveK(run) {
  if (run <= 3) return 1;
  const k = 2 + 0.1 * (run - 4);
  return +Math.min(6, run > 6 ? 2 * k : k).toFixed(2);
}
// v0.4.7.5 quick patch, reach-in fouls by contact (Game.reachContact): how far the hand goes (m), how close counts as
// touching (m), and how often a reach into the handler's body or arm (not the ball first) is called
export const REACH_FOUL = { len: 0.68, touch: 0.07, body: 0.8 };
// v0.4.7.5 quick patch: passing 10% more accurate across the board (aim error x0.9, in-flight accuracy x1.1)
export const PASS_ACC_K = 0.9, PASS_ACC_BOOST = 1.1;
// v0.4.7.5 quick patch 3: screens (Game.screenQuality / screenHit). q = base + spd·(run-in speed) + set·(planted)
// + face·(square to the defender) + called + size·(mass and height edge) + str·(Strength rating edge) + bw·tier
// − dbw·tier (tiers through badges.bk: 1 / 2.1 / 3.31 / 4.64). A screen takes stop0..1 of the defender's speed and slows him for slow0 + slow1·q seconds; q ≥ stunQ
// stops him dead (stun0..stun0+stun1 s); a Brick Wall screener's q ≥ fallQ0 − fallQk·tier + fallQd·(defender's tier) knocks him down for
// fall0 + fallk·tier (+ up to 0.4) seconds, if he ran into it at fallV m/s or more.
export const SCREEN = {
  base: 0.28, spd: 0.25, set: 0.12, face: 0.12, called: 0.06, size: 0.18, str: 0.12, bw: 0.06, dbw: 0.06,
  stop0: 0.35, slow0: 0.2, slow1: 0.7, stunQ: 0.5, stun0: 0.3, stun1: 0.35, fallQ0: 0.95, fallQk: 0.06, fallQd: 0.05, fallV: 1.5, fall0: 1.0, fallk: 0.2,
};
// v0.4.7.5 qp3: the alley-oop button press for your player. When a teammate lobs you an alley-oop, one of the four
// face buttons (pass / bounce / shoot / lob: A B X Y on an Xbox pad, their equivalents elsewhere, your keyboard keys)
// is called at random. Hit that button while the ball is in the air, from `open` of the way to the takeoff up to
// `grace` seconds after it, and you go up and finish. The wrong button, too early or no press is a mistimed jump
// (`lateBy` seconds late, `hopK` of the height): the ball comes off your hands or sails over you (loose ball).
export const OOP_QTE = { open: 0.25, grace: 0.05, hopK: 0.4, lateBy: 0.22 };
export const COST = { shot: 0.009 * STAMINA_K, layup: 0.012 * STAMINA_K, dunk: 0.018 * STAMINA_K, pass: 0.004 * STAMINA_K, steal: 0.009 * STAMINA_K, jump: 0.015 * STAMINA_K, move: 0.024 * STAMINA_K, screen: 0.004 * STAMINA_K };
export const GAME_SPEED = 1.15 * 1.0375 * (1 - 0.0185) * (1 - 0.0075) * (1 - 0.0375) * 1.025; // (v0.4.5 quick patch: −3.75%; v0.4.7.5 quick patch: +2.5%)
// v0.4.5 final: the user's rebound / block jump assist (reach toward the ball, mid-air steer) is 3.75% stronger
export const DEF_ASSIST_K = 1.0375;

// v0.4.5 stage 7: the ball's path into each jump-shot base. py: pocket height (×H); sx/sz: set point out to the
// shooting side / in front (m); ks: share of the shot spent getting to the set point; pause: a beat at the set
// point (Hitch); rz: release in front (+) or behind (−) the usual spot; drift: swings out toward the shooting
// side and back (Sway); line: no set point at all, one curving motion (Slingshot, Silk)
// back: how far the shoulders sit behind upright at the release (×H), from the base's lean in the air (animator)
export const SHOT_PATH = {
  standard: { py: 0.6, sx: 0.07, sz: 0.2, ks: 0.62, back: 0.014 },
  high: { py: 0.62, sx: 0.0, sz: 0.12, ks: 0.6, back: 0.022 },
  flick: { py: 0.56, sx: 0.09, sz: 0.25, ks: 0.52, back: 0 },
  push: { py: 0.57, sx: 0.11, sz: 0.31, ks: 0.6, back: 0 },
  lean: { py: 0.62, sx: 0.05, sz: 0.1, ks: 0.66, rz: -0.07, back: 0.067 },
  kick: { py: 0.6, sx: 0.14, sz: 0.2, ks: 0.62, back: 0.019 },
  wide: { py: 0.52, sx: 0.0, sz: 0.25, ks: 0.67, back: 0.008 },
  sniper: { py: 0.63, sx: 0.015, sz: 0.22, ks: 0.48, back: 0.014 },
  fade: { py: 0.6, sx: 0.06, sz: 0.09, ks: 0.6, rz: -0.13, back: 0.095 },
  hitch: { py: 0.6, sx: 0.07, sz: 0.18, ks: 0.42, pause: 0.26, back: 0.016 },
  sling: { py: 0.54, sx: 0.04, sz: 0.32, line: true, back: 0 },
  scissor: { py: 0.6, sx: 0.22, sz: 0.19, ks: 0.62, back: 0.014 },
  tuck: { py: 0.49, sx: 0.07, sz: 0.24, ks: 0.68, back: 0.024 },
  sway: { py: 0.6, sx: 0.07, sz: 0.2, ks: 0.6, drift: 0.14, back: 0.024 },
  silk: { py: 0.47, sx: -0.02, sz: 0.24, line: true, back: 0 },
  // v0.4.7.5 bases (each with its own ball path; the legs and the body are in the animator)
  pogo: { py: 0.58, sx: 0.05, sz: 0.17, ks: 0.56, back: 0.014 },
  stork: { py: 0.61, sx: 0.09, sz: 0.21, ks: 0.6, back: 0.02 },
  frog: { py: 0.5, sx: 0.04, sz: 0.27, ks: 0.66, back: 0.012 },
  corkscrew: { py: 0.57, sx: 0.16, sz: 0.14, ks: 0.6, drift: -0.1, back: 0.03 },
  heel: { py: 0.6, sx: 0.08, sz: 0.22, ks: 0.6, back: 0.016 },
  turbo: { py: 0.63, sx: 0.06, sz: 0.28, ks: 0.42, back: 0.006 },
  onestep: { py: 0.55, sx: 0.1, sz: 0.3, ks: 0.64, rz: 0.04, back: 0.004 },
  tilt: { py: 0.6, sx: 0.2, sz: 0.16, ks: 0.6, drift: 0.08, back: 0.082 },
  catapult: { py: 0.66, sx: 0.04, sz: -0.04, ks: 0.58, pause: 0.12, back: 0.048 },
  statue: { py: 0.64, sx: 0.03, sz: 0.12, ks: 0.5, pause: 0.18, back: 0.012 },
  bounce: { py: 0.54, sx: 0.12, sz: 0.26, ks: 0.62, back: 0.014 },
  whip: { py: 0.5, sx: -0.18, sz: 0.2, line: true, back: 0.01 },
  dip: { py: 0.4, sx: 0.08, sz: 0.3, ks: 0.7, back: 0.018 },
  leaner: { py: 0.6, sx: 0.06, sz: 0.3, ks: 0.6, rz: 0.02, back: 0 },
  bicycle: { py: 0.59, sx: 0.1, sz: 0.2, ks: 0.6, back: 0.02 },
};
// v0.4.7.5 ankle-breaker reactions (the victim's animation) and how long each keeps him out of the play
export const ANKLE_REACT = { sit: { dur: 1.4 }, slip: { dur: 1.3 }, tangle: { dur: 1.15 }, split: { dur: 1.5 }, lean: { dur: 1.0 }, stagger: { dur: 1.2 }, spun: { dur: 1.1 }, faceplant: { dur: 1.6 }, knee: { dur: 1.4 } };

// v0.4.7.5 dunk finishes: the ball's path, local to the dunker ([x right-negative, y up, z ahead]); t: share of the
// way to the slam, e: its smoothstep, H: height, topY: where the slam happens. The hands follow the ball.
const sstep = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const toTop = (x, y, z, f, topY) => { const ef = sstep(f); return [x * (1 - ef) - 0.04 * ef, y + (topY - y) * ef, z + (0.5 - z) * ef]; };
// v0.4.7.5 quick patch: the Eastbay's ball path, as keys [k (share of the way to the rim), x (m, + = his left), y (×H,
// up from his feet), z (m, + = in front)], eased between keys
export const EASTBAY_KEYS = [[0, -0.18, 0.7, 0.3], [0.22, -0.1, 0.5, 0.24], [0.35, -0.03, 0.39, 0.08], [0.43, 0.01, 0.36, 0.0], [0.51, 0.09, 0.38, -0.04], [0.6, 0.2, 0.47, 0.0], [0.8, 0.22, 0.86, 0.14], [1, 0.12, 1.1, 0.3]];
export function keyPath(keys, k, H) {
  let i = 1;
  while (i < keys.length - 1 && k > keys[i][0]) i++;
  const a = keys[i - 1], b = keys[i], u = Math.max(0, Math.min(1, (k - a[0]) / Math.max(1e-6, b[0] - a[0]))), e = u * u * (3 - 2 * u);
  return [a[1] + (b[1] - a[1]) * e, (a[2] + (b[2] - a[2]) * e) * H, a[3] + (b[3] - a[3]) * e];
}
// v0.4.7.5 quick patch: a windmill is the arm going round straight from the shoulder, so the ball's circle is centred
// on the shoulder joint (just outside it, so the arm swings past the hip and the head) with the arm's length plus the
// hand to the ball's centre as its radius, a touch short of locked out. (It used to circle a point above the
// shoulder, so the elbow folded at the bottom and the arm stretched past its length at the top.) p.arm: Player.arm.
export function millCircle(p, H, two = false) {
  const arm = p?.arm || { shoulderY: 0.806 * H, shoulderX: 0.1 * H, z: -0.012 * H, len: 0.33 * H };
  const reach = (arm.len + 0.055 * H) * 0.97;
  if (two) return { cx: 0, cy: arm.shoulderY + 0.01 * H, cz: arm.z + 0.03 * H, R: Math.sqrt(Math.max(0.01, reach * reach - arm.shoulderX * arm.shoulderX)) * 0.97 };
  return { cx: -(arm.shoulderX + 0.03 * H), cy: arm.shoulderY + ARM_LIFT * H * 0.5, cz: arm.z, R: reach };
}
export const DUNK_PATH2 = {
  // two hands go all the way round together in front of the body, then down through
  twomill: (t, e, H, topY, p) => { const k = sstep(t / 0.9), al = -1.67 * Math.PI * k, C = millCircle(p, H, true); return toTop(0, C.cy + C.R * Math.sin(al), C.cz + C.R * Math.cos(al), (t - 0.82) / 0.18, topY); },
  // a big circle out to the side: in at the shoulder, down past the hip, out wide, up over the top
  sidemill: (t, e, H, topY) => { const k = sstep(t / 0.88), al = Math.PI + 1.5 * Math.PI * k, R = 0.36 * H; return toTop(-0.26 - R * Math.cos(al) * 0.9, 0.92 * H + R * Math.sin(al) * -1, 0.16, (t - 0.8) / 0.2, topY); },
  // up over the head and dropped down the back between the shoulder blades, then whipped over the top
  backscratch: (t, e, H, topY) => { const up = sstep(t / 0.32), dn = sstep((t - 0.32) / 0.3), ov = (t - 0.66) / 0.34; const y = 0.62 * H + (1.02 * H - 0.62 * H) * up - 0.24 * H * dn, z = 0.3 - 0.22 * up - 0.34 * dn; return toTop(-0.08, y, z, ov, topY); },
  // held high over the head with both hands right through a reverse full turn
  rev360: (t, e, H, topY) => { const k = sstep(t / 0.3); return toTop(0, 0.62 * H + (1.0 * H - 0.62 * H) * k, 0.3 - 0.24 * k, (t - 0.8) / 0.2, topY); },
  // a full spin with the arm windmilling round through it
  spinmill: (t, e, H, topY, p) => { const k = sstep(t / 0.9), al = -1.67 * Math.PI * k, C = millCircle(p, H); return toTop(C.cx, C.cy + C.R * Math.sin(al), C.cz + C.R * Math.cos(al), (t - 0.84) / 0.16, topY); },
  // thrust out at eye level at arm's length, back, out again, then up and in
  pump: (t, e, H, topY) => { const k = Math.min(1, t / 0.74), z = 0.26 + 0.38 * Math.abs(Math.sin(2 * Math.PI * k)); return toTop(0, 0.84 * H, z, (t - 0.74) / 0.26, topY); },
  // carried low at the hip with the knee driving up, then thrown up at the last moment
  kneeup: (t, e, H, topY) => toTop(-0.2, 0.55 * H, 0.26, (t - 0.62) / 0.38, topY),
  // swung across the body from the far shoulder to the near side overhead
  crossleg: (t, e, H, topY) => { const k = sstep(t / 0.85); return toTop(0.28 - 0.4 * k, 0.86 * H + 0.14 * H * k, 0.2, (t - 0.85) / 0.15, topY); },
  // a full turn with the ball held out to the side at arm's length, like a rotor
  helicopter: (t, e, H, topY) => { const k = sstep(t / 0.25); return toTop(-0.2 - 0.36 * k, 0.86 * H, 0.06, (t - 0.8) / 0.2, topY); },
  // passed behind the head from the right hand to the left, slammed left-handed
  behindhead: (t, e, H, topY) => { const k = sstep(t / 0.8), ph = Math.PI * k; return toTop(-0.26 * Math.cos(ph), 0.9 * H + 0.05 * H * Math.sin(ph), 0.12 - 0.34 * Math.sin(ph), (t - 0.8) / 0.2, topY); },
  // tucked to the chest in a cannonball, then thrown down with both hands
  cannonball: (t, e, H, topY) => toTop(0, 0.7 * H, 0.26, (t - 0.78) / 0.22, topY),
  // up overhead early with both hands while the legs go out in a split
  splits: (t, e, H, topY) => { const k = sstep(t / 0.35); return toTop(0, 0.66 * H + 0.36 * H * k, 0.3 - 0.12 * k, (t - 0.82) / 0.18, topY); },
  // carried at the shoulder while the lead leg shoots out straight ahead
  hurdle: (t, e, H, topY) => toTop(-0.16, 0.78 * H, 0.18, (t - 0.72) / 0.28, topY),
  // folded over: the ball reaches long out in front over the piked legs
  jackknife: (t, e, H, topY) => { const k = sstep(t / 0.6); return toTop(-0.08, 0.7 * H + 0.08 * H * k, 0.3 + 0.32 * k, (t - 0.84) / 0.16, topY); },
};

// v0.4.5 quick patch: reaching up for the release, the shooting shoulder rises this much (×H; the animator lifts the
// collarbone to match), and the arm ends 97% straight
export const ARM_LIFT = 0.025, ARM_EXT = 0.97;
// v0.4.7.5: how far the shoulders sit back at the release of a running fade (it leans back the furthest)
export const RUNFADE_BACK = 0.135;
// v0.4.5 quick patch: how hard a made dunk is thrown down through the rim (m/s)
export const SLAM_V = 8.5;
// v0.4.7.5: "wide open": 10% guarded or less (the shot feedback's tier)
export const WIDE_OPEN = 0.1;
// where the finishing shoulder sits at the top of a layup, against upright (×H): [drop, back, out to the side, and a
// trim off the top where the pose also turns the arm away]. Measured off the animator's layup poses for each package
// and coverage across builds, rounded up a little
export const LAYUP_BODY = {
  basic: { open: [0.047, 0.022, 0], side: [0.07, 0.043, 0.038], front: [0.046, 0, 0], rim: [0.05, 0.087, 0, 0.005], trail: [0.054, 0.046, 0] },
  euro: { open: [0.023, 0.024, 0], side: [0.083, 0.045, 0.087], front: [0.023, 0, 0], rim: [0.085, 0.1, 0.064, 0.033], trail: [0.031, 0.05, 0] },
  finger: { open: [0.059, 0.037, 0], side: [0.084, 0.056, 0.038, 0.021], front: [0.055, 0, 0], rim: [0.048, 0.089, 0, 0.008], trail: [0.067, 0.046, 0, 0.054] },
  scoop: { open: [0.065, 0, 0], side: [0.084, 0, 0.042], front: [0.063, 0, 0], rim: [0.061, 0.072, 0], trail: [0.064, 0.028, 0, 0.076] },
  // v0.4.7.5 packages (fitted the same way: tools fit them against the rig for every build and coverage)
  reverse: { open: [0.05, 0.087, 0, 0.014], side: [0.07, 0.043, 0.038, 0.006], front: [0.046, 0, 0], rim: [0.05, 0.087, 0, 0.005], trail: [0.054, 0.046, 0, 0.036] },
  hop: { open: [0.047, 0.022, 0], side: [0.07, 0.043, 0.038], front: [0.046, 0, 0], rim: [0.05, 0.087, 0, 0.005], trail: [0.054, 0.046, 0] },
  floater: { open: [0.047, 0.022, 0, 0.034], side: [0.07, 0.043, 0.038, 0.034], front: [0.046, 0, 0], rim: [0.05, 0.087, 0, 0.005], trail: [0.054, 0.046, 0] },
  spin: { open: [0.047, 0.022, 0], side: [0.07, 0.043, 0.038], front: [0.046, 0, 0], rim: [0.05, 0.087, 0, 0.005], trail: [0.054, 0.046, 0] },
};

export class Game {
  constructor(cfg) {
    this.cfg = cfg;
    this.mode = cfg.mode || 'park';
    // v0.4.2: park 3v3 courts play full court (cfg.full); 2v2 / 1v1 park courts and practice stay half court
    this.half = this.mode === 'practice' || (this.mode === 'park' && !cfg.full);
    this.practice = this.mode === 'practice';
    this.rng = new RNG(cfg.seed || 1);
    // v0.4.2: the whole game runs 15% faster than real time (movement, animation, ball). Clocks still count
    // real seconds and the timing windows are widened in sim time so they feel the same in real time.
    this.speed = cfg.speed ?? GAME_SPEED; // v0.4.2 +15%, v0.4.4 +3.75%, v0.4.5 -1.85%, -0.75%, then -3.75%
    // v0.4.3: the user's green window is 10% wider with the shot meter turned off
    this.greenBonus = cfg.greenBonus || 1;
    this.catalog = cfg.catalog || {};
    this.ball = new Ball();
    this.ball.halfOnly = this.half;
    this.ball.surface = cfg.surface || 'wood';
    this.players = []; this.teams = [[], []];
    cfg.rosters.forEach((roster, t) => roster.forEach(entry => {
      const p = new Player(this.players.length, t, entry, this.catalog);
      this.players.push(p); this.teams[t].push(p);
    }));
    this.human = this.players.find(p => p.human) || null;
    // v0.4.4: the user's lifetime numbers drive how auto-play plays his player
    for (const p of this.players) if (p.human) p.profile = statProfile(p.entry.build, this.mode);
    this.score = [0, 0];
    this.target = cfg.target || 21;
    this.winBy2 = !!cfg.winBy2;
    this.quarterLen = cfg.quarterLen || 240;
    this.quarters = cfg.quarters || 4;
    this.quarter = 1;
    this.gameClock = this.quarterLen;
    this.shotClock = 24;
    this.time = 0; this.tick = 0;
    this.events = [];
    this.phase = 'pregame'; this.phaseT = 0;
    this.possession = 0;
    this.attackDir = this.half ? [1, 1] : [1, -1];
    this.needsClear = [false, false];
    this.teamFouls = [0, 0];
    this.lastPass = null;
    this.over = false; this.winner = -1;
    this.assist = !!cfg.assist;
    this.humanIntent = blankIntent();
    this.ftState = null;
    this.firstPossession = 0;
    this.difficulty = cfg.difficulty ?? 0.6;
    this.ai = new AI(this);
    this.shotLog = [];
    this.lastShot = null;
    this.buzzer = false;
    this.lockIn = null; // v0.4.5: {id, idx} the user's Lock-In grade (set by the session), drives his stamina
    this.aiGrades = new Map(); // v0.4.7.5: player id -> LockedInGrade, for every AI player
    this.setup();
  }

  // ---------- helpers ----------
  emit(e) { e.t = this.time; this.events.push(e); this.badgeTriggers(e); this.playTrack(e); return e; }

  // ---------- v0.4.5: plays, streaks and takeovers ----------
  // Every event is read once for: positive / negative plays (stamina), going hot / cold, and takeover progress.
  playTrack(e) {
    const P = e.player != null ? this.players[e.player] : null;
    switch (e.type) {
      case 'release': if (P) { P.lastRel = { grade: e.grade, kind: e.kind, contest: e.contest || 0, closest: e.closest ?? -1 }; this.takeoverRelease(P, e); } break;
      case 'score': {
        if (!P || e.ft || P.team !== e.team) break;
        const r = P.lastRel || {};
        this.good(P, 'score');
        const inside = e.kind === 'layup' || e.kind === 'dunk';
        if (inside || ((e.kind === 'jumper' || e.kind === 'close') && r.grade === 'excellent')) this.hotStep(P); else P.hotStreak = 0;
        if (P.cold) { P.cold = false; this.emit({ type: 'cold', player: P.id, on: false }); }
        P.coldMisses = 0;
        if (inside && P.takeover.kind === 'finishing') this.takeoverStep(P);
        // a basket in the paint ends the other team's glass-and-rim takeover runs
        if (inside || e.kind === 'close' || (e.d || 9) < 2.5) for (const q of this.teams[1 - e.team]) if (q.takeover.kind === 'glass') q.takeover.prog = 0;
        // the closest defender gave up an open look
        if (r.closest >= 0 && r.contest < 0.3 && (e.kind === 'jumper' || e.kind === 'close')) { const d = this.players[r.closest]; if (d && d.team !== P.team) this.bad(d, 'openShot'); }
        break;
      }
      case 'miss': {
        if (!P) break;
        const r = P.lastRel || {};
        if (r.grade === 'vearly' || r.grade === 'vlate') this.bad(P, 'badShot');
        else if ((r.contest || 0) > 0.8) this.bad(P, 'forced');
        this.coldStep(P, (r.contest || 0) < 0.3 && r.kind !== 'ft');
        if (P.takeover.kind === 'finishing' && (r.kind === 'layup' || r.kind === 'dunk' || r.kind === 'close')) P.takeover.prog = 0;
        if (P.takeover.kind === 'shooting' && (r.kind === 'jumper')) P.takeover.prog = 0;
        if (r.closest >= 0 && (r.contest || 0) > 0.55) { const d = this.players[r.closest]; if (d && d.team !== P.team) this.good(d, 'contest'); }
        break;
      }
      case 'block': {
        if (P) { this.good(P, 'block'); if (P.takeover.kind === 'glass') this.takeoverStep(P); }
        const S0 = this.players[e.shooter];
        if (S0) { this.bad(S0, 'blocked'); this.coldStep(S0, false); if (S0.takeover.kind !== 'glass') S0.takeover.prog = 0; }
        break;
      }
      case 'rebound': if (P) { this.good(P, 'rebound'); if (P.takeover.kind === 'glass') this.takeoverStep(P); } break;
      case 'assist': if (P) this.good(P, 'assist'); break;
      case 'steal': if (P) this.good(P, 'steal'); if (e.victim != null) this.bad(this.players[e.victim], 'turnover'); break;
      case 'turnover': if (P) this.bad(P, 'turnover'); break;
      case 'foul': if (P) this.bad(P, 'foul'); break;
      case 'ankle': if (P) this.good(P, 'ankle'); if (e.victim != null) this.bad(this.players[e.victim], 'crossed'); break;
      case 'slam': if (e.poster >= 0 && e.poster != null) this.bad(this.players[e.poster], 'posterized'); break;
      case 'screen': if (P && !e.incidental) this.good(P, 'screen'); break; // (qp3: brushing past a standing man isn't a screen)
    }
  }
  // a play that helps the team: every second one gives back a little stamina and doubles recovery (no stacking)
  // until a negative play; it also clears the repeated-mistake drain
  good(p, kind) {
    const s = p.stam;
    s.negK = 1; s.lastNeg = null;
    s.goodRun++;
    if (s.goodRun % 2 === 0) { p.stamina = Math.min(1, p.stamina + 0.05); s.recBoost = true; }
  }
  // a play that hurts the team: ends the recovery bonus; the same mistake twice in a row (no positive play in
  // between) doubles stamina drain, +0.1x for each repeat after that
  bad(p, kind) {
    if (!p) return;
    const s = p.stam;
    s.recBoost = false; s.goodRun = 0;
    if (s.lastNeg === kind) s.negK = s.negK < 2 ? 2 : +(s.negK + 0.1).toFixed(2);
    s.lastNeg = kind;
  }
  // going hot: 3 straight Excellent-release makes or finishes at the rim
  hotStep(p) {
    p.hotStreak++;
    if (p.hotStreak >= 3 && !p.hot) { p.hot = 1; this.emit({ type: 'hot', player: p.id, on: true }); }
  }
  // going cold: more than 3 missed wide-open shots (resets on a make); any miss ends a hot streak
  coldStep(p, open) {
    p.hotStreak = 0;
    if (p.hot) { p.hot = 0; this.emit({ type: 'hot', player: p.id, on: false }); }
    if (open) { p.coldMisses++; if (p.coldMisses > 3 && !p.cold) { p.cold = true; this.emit({ type: 'cold', player: p.id, on: true }); } }
  }
  takeoverRelease(p, e) {
    if (p.takeover.kind !== 'shooting' || e.kind === 'ft' || e.kind === 'layup' || e.kind === 'dunk') return;
    if (e.kind === 'jumper' && e.grade === 'excellent') this.takeoverStep(p); // greens go in unless blocked
    else if (e.kind === 'jumper') p.takeover.prog = 0; // released off the green
  }
  takeoverStep(p) {
    const t = p.takeover;
    if (t.active || !t.kind) return;
    t.prog++;
    if (t.prog >= TAKEOVER_NEED) {
      t.active = true; t.left = TAKEOVER_SECS; t.prog = 0;
      p.refreshRatings();
      this.emit({ type: 'takeover', player: p.id, kind: t.kind, on: true, label: TAKEOVERS[t.kind].label });
    } else this.emit({ type: 'takeoverProg', player: p.id, kind: t.kind, prog: t.prog });
  }
  // extra green-window share for a player (Sharp Eye Icon badge, shooting takeover)
  greenK(p) { return 1 + (p.icon && ICON_BADGES[p.icon]?.green || 0) + (p.takeover.active && TAKEOVERS[p.takeover.kind].green || 0); }

  // v0.4.5 quick patch: the green window a release is graded against (ms of action time: ±total around the ideal
  // release), and the part of it the build earns with its own ratings alone (natural: the attributes as the build
  // shows them, with no badges, no Icon badge, no takeover and no animation bonus; it's never more than the real
  // window, so a stat playing under its rating for want of badges is all core). The shot meter draws both from these
  // same functions, so the green on screen is exactly the green that's graded. sure: an Excellent there is an
  // automatic make (jumpers inside 35 ft and free throws; a green layup or a green from deep is a boost).
  natural(p) { return p.raw || p.ratings; }
  jumperWindow(p, a, contest, ghost = false) {
    const rim = this.rimFor(p.team), side = this.sideFor(p.team);
    const three = !this.practiceFT && isThree(a.startX, a.startZ, side);
    const d = Math.hypot(rim.x - a.startX, rim.z - a.startZ);
    const corner = three && Math.abs(a.startX) > 6.2, key = three ? 'three_point' : 'mid_range';
    // v0.4.7.5 quick patch: a non-shooter (anyone but a Sharpshooter or a Stretch Big) has a 10% smaller window, and
    // his green from three isn't a sure make (outlined on the meter). smothered: no window at all, whatever adds to it.
    // ghost: ignore the smother (the window he'd have had a hair less guarded: a release in it gets a record scratch).
    const nonShooter = !S.isShooterArch(p.archetype), smothered = !ghost && S.isSmothered(contest);
    const ctx = { contest: ghost ? Math.min(contest, S.SMOTHER - 1e-3) : contest, moving: a.moving, fade: a.fade, d, three, catchShoot: a.catchShoot, corner, pkg: p.shotPkg, greenK: this.greenK(p), hustle: a.hustle, nonShooter };
    const k = this.speed * (p.human ? this.greenBonus : 1);
    const total = smothered ? 0 : S.greenWindowMs(p.ratings[key], p.badges, ctx) * k;
    const natural = smothered ? 0 : S.greenWindowMs(this.natural(p)[key], {}, { ...ctx, greenK: 1, pkg: S.naturalPkg(p.shotPkg) }) * k;
    return { total, natural: Math.min(total, natural), sure: d <= S.DEEP_D && !smothered && !(nonShooter && three), three, d, corner, smothered, nonShooter };
  }
  // guard: how guarded the finish is on the jumper scale (shots.js insideGuard); smothered at the rim = no window
  layupWindow(p, a, contest, guard = S.insideGuard(contest), ghost = false) {
    const smothered = !ghost && S.isSmothered(guard);
    const k = this.speed * (p.human ? this.greenBonus : 1), ctx = { contest, lstyle: a.lstyle, greenK: this.greenK(p), smothered };
    const total = S.layupWindowMs(p.ratings.layup, p.badges, ctx) * k;
    const natural = S.layupWindowMs(this.natural(p).layup, {}, { ...ctx, greenK: 1, natural: true }) * k;
    return { total, natural: Math.min(total, natural), sure: false, smothered };
  }
  // v0.4.7.5 quick patch: a finish's contest (as the make chance uses it) and how guarded it is (the HUD's %, and
  // Smothered), with the space a Contact Finisher push-off made taking 8% per tier off both
  layupContest(p, a, y) {
    const raw = S.contestRaw(p, this.opponents(p), this.rimFor(p.team), y), cf = 1 - 0.08 * (a.cfPush || 0);
    return { contest: Math.min(1.25, raw) * cf, guard: S.insideGuard(raw * cf) };
  }
  // the contest a release on the next step would be graded with: releaseShot / releaseLayup measure it at the ball
  // after that step's action tick, so the meter looks one tick ahead and matches the grade frame for frame
  contestIfReleased(p) { return S.contestFor(p, this.opponents(p), this.rimFor(p.team), this.releaseYNext(p)); }
  releaseYNext(p) {
    const a = p.action, t0 = a.t;
    a.t = t0 + DT;
    const y = this.holdPoint(p).gy;
    a.t = t0;
    return y;
  }
  ftWindow(p) {
    const k = this.speed * (p.human ? this.greenBonus : 1);
    const total = S.greenWindowMs(p.ratings.free_throw, p.badges, { ft: true, greenK: this.greenK(p) }) * k;
    const natural = S.greenWindowMs(this.natural(p).free_throw, {}, { ft: true }) * k;
    return { total, natural: Math.min(total, natural), sure: true };
  }

  // v0.4.2: which badges visibly mattered for this event -> 'badge' events (the HUD shows the user's)
  badgeTriggers(e) {
    if (e.type === 'badge' || e.player == null) return;
    const p = this.players[e.player];
    if (!p || !p.badges) return;
    const b = p.badges, fx = k => { if (b[k]) this.events.push({ type: 'badge', player: p.id, badge: k, tier: b[k], t: this.time }); };
    switch (e.type) {
      case 'release': if (e.grade === 'excellent' && e.kind !== 'ft') fx('green_machine'); break;
      case 'score': {
        if (e.ft) break;
        const c = e.contest || 0;
        if ((e.kind === 'jumper' || e.kind === 'close') && c > 0.55) fx('deadeye');
        if (e.kind === 'layup' && c > 0.4) fx('contact_finisher');
        if (e.kind === 'layup' && c > 0.6) fx('acrobat');
        if (e.catchShoot) fx('catch_shoot');
        if (e.corner) fx('corner_specialist');
        if (e.three && (e.d || 0) > 7.9) fx('limitless');
        if (e.clutch) fx('clutch');
        break;
      }
      case 'assist': fx('dimer'); break;
      case 'steal': fx(e.intercept ? 'interceptor' : 'pick_pocket'); break;
      case 'block': fx(e.chase ? 'chasedown' : 'rim_protector'); break;
      case 'ankle': fx('ankle_breaker'); break;
      case 'rebound': fx('rebound_chaser'); break;
      // v0.4.4: Brick Wall fires from the screen and bump code itself (offense or defense on screens, defense
      // only on bumps), never from incidental contact such as standing after a jumper
      case 'move': if (p.stamina < 0.5) fx('handles_for_days'); break;
    }
  }
  holder() { return this.ball.holder >= 0 ? this.players[this.ball.holder] : null; }
  rimFor(team) { return rimOf(this.attackDir[team]); }
  sideFor(team) { return this.attackDir[team]; }
  opponents(p) { return this.teams[1 - p.team]; }
  mates(p) { return this.teams[p.team].filter(q => q !== p); }
  isAI(p) { return !p.human || this.assist; }
  live() { return this.phase === 'live'; }

  setup() {
    if (this.practice) {
      const p = this.teams[0][0];
      p.setPos(0, COURT.hoopZ - 6.5, 0);
      if (this.teams[1][0]) this.teams[1][0].setPos(0, COURT.hoopZ - 5, Math.PI);
      this.giveBall(p, 'held');
      this.phase = 'live';
      this.possession = 0;
      return;
    }
    if (this.mode === 'park' && this.half) {
      const t = this.rng.next() < 0.5 ? 0 : 1;
      this.firstPossession = t;
      this.startCheck(t, 1.6);
    } else {
      this.startTip();
    }
  }

  giveBall(p, mode = 'held') {
    const b = this.ball;
    b.mode = mode; b.holder = p.id; b.kind = null; b.info = null;
    b.lastTouch = p.id; b.lastTeam = p.team;
    p.dribble.live = true; p.dribble.used = false; p.dribble.phase = 0.05;
    if (this.possession !== p.team) {
      this.possession = p.team;
      this.shotClock = 24;
    }
    const w = this.holdPoint(p);
    b.x = w.x; b.y = w.y; b.z = w.z; b.vx = b.vy = b.vz = 0;
  }

  placeFormation(team, side, opts = {}) {
    const offense = this.teams[team], defense = this.teams[1 - team];
    const spots = spotsFor(offense.length, side, opts.variant || 0);
    // ball handler first
    const order = [...offense].sort((a, b) => (opts.handler === b ? 1 : 0) - (opts.handler === a ? 1 : 0) || posRank(a.position) - posRank(b.position));
    const rim = rimOf(side);
    order.forEach((p, i) => {
      const s = i === 0 && opts.check ? opts.check : spots[i % spots.length];
      const f = Math.atan2(rim.x - s.x, rim.z - s.z);
      p.setPos(s.x + (i === 0 ? 0 : this.rng.range(-0.3, 0.3)), s.z + (i === 0 ? 0 : this.rng.range(-0.3, 0.3)), f);
    });
    const matches = this.ai.matchups(team);
    defense.forEach(d => {
      const m = matches.get(d.id) || order[0];
      const dx = rim.x - m.x, dz = rim.z - m.z, dl = Math.hypot(dx, dz) || 1;
      const gap = m === order[0] ? 1.35 : 1.9;
      d.setPos(m.x + dx / dl * gap, m.z + dz / dl * gap, Math.atan2(-dx, -dz));
    });
    for (const p of this.players) { p.action = null; p.stance = 'normal'; p.stamina = Math.min(1, p.stamina + 0.08); }
    return order[0];
  }

  startCheck(team, delay = 1.2) {
    const side = this.sideFor(team);
    const offense = this.teams[team];
    const handler = (this.human && this.human.team === team && !this.assist) ? this.human : [...offense].sort((a, b) => posRank(a.position) - posRank(b.position))[0];
    const check = CHECK_SPOT(side);
    this.placeFormation(team, side, { handler, check, variant: this.rng.int(0, 2) });
    this.giveBall(handler, 'held');
    this.possession = team;
    this.needsClear = [false, false];
    this.shotClock = 24;
    this.phase = 'check'; this.phaseT = delay;
    this.lastPass = null;
    this.emit({ type: 'check', team });
  }

  startInbound(team, spotPos, kind = 'baseline', delay = 1.4) {
    const side = this.sideFor(team);
    const offense = this.teams[team];
    // inbounder: bigs inbound after makes; human never forced to inbound unless alone
    const cands = [...offense].filter(p => p !== this.human || this.assist || offense.length === 1).sort((a, b) => posRank(b.position) - posRank(a.position));
    const inb = cands[0] || offense[0];
    const backcourt = kind === 'baseline';
    // formation: if baseline after a make, team sets up in their backcourt
    const ownSide = -side;
    offense.forEach((p, i) => {
      if (p === inb) return;
      let x, z;
      if (backcourt) { const k = i % 4; x = [-3.5, 3.5, -6, 6][k]; z = ownSide * ([8.5, 6.5, 2, 0.5][k]); }
      else { const s = spotsFor(offense.length, side, 0)[i % offense.length]; x = s.x; z = s.z; }
      p.setPos(x, z, Math.atan2(-x, (side * COURT.hoopZ) - z));
    });
    const sx = spotPos.x, sz = spotPos.z;
    inb.setPos(sx, sz, Math.atan2(-sx, -sz * 0.3));
    this.teams[1 - team].forEach((d, i) => {
      const m = offense[i % offense.length];
      const rim = rimOf(side);
      const dx = rim.x - m.x, dz = rim.z - m.z, dl = Math.hypot(dx, dz) || 1;
      if (m === inb) d.setPos(sx * 0.8, sz - Math.sign(sz) * 1.6, Math.atan2(sx, sz));
      else d.setPos(m.x + dx / dl * 1.6, m.z + dz / dl * 1.6, Math.atan2(-dx, -dz));
    });
    for (const p of this.players) { p.action = null; p.stance = 'normal'; }
    this.giveBall(inb, 'held');
    this.ball.lastTeam = team;
    this.possession = team;
    this.shotClock = 24;
    this.phase = 'inbound'; this.phaseT = delay;
    this.inbounder = inb;
    this.emit({ type: 'inbound', team });
  }

  startTip() {
    // centers at center circle
    const bigs = [0, 1].map(t => [...this.teams[t]].sort((a, b) => posRank(b.position) - posRank(a.position))[0]);
    this.players.forEach(p => {
      const t = p.team, side = this.attackDir[t];
      const i = this.teams[t].indexOf(p);
      if (p === bigs[t]) p.setPos(0, -side * 0.45, side > 0 ? 0 : Math.PI);
      else { const ang = (i + 0.5) / this.teams[t].length * Math.PI - Math.PI / 2; p.setPos(Math.sin(ang) * 3.4, -side * (1.5 + Math.abs(Math.cos(ang)) * 2.5), side > 0 ? 0 : Math.PI); }
    });
    const b = this.ball;
    b.mode = 'dead'; b.holder = -1; b.x = 0; b.y = 1.6; b.z = 0; b.vx = b.vy = b.vz = 0;
    this.phase = 'tip'; this.phaseT = 1.4;
    this.tipJumpers = bigs;
    this.emit({ type: 'tipoff' });
  }

  // ---------- main step ----------
  setInput(intent) { this.humanIntent = intent; }

  step(dt) {
    this.events.length = 0;
    for (const p of this.players) { p.prevX = p.x; p.prevZ = p.z; p.prevY = p.y; p.prevFacing = p.facing; p.landed = false; }
    this.ball.px = this.ball.x; this.ball.py = this.ball.y; this.ball.pz = this.ball.z;
    if (this.over) { this.overT = (this.overT || 0) + dt; for (const p of this.players) { p.intent = blankIntent(); p.move(dt, false, 1); this.tickAction(p, dt); } this.updateBall(dt); return; }
    this.time += dt; this.tick++;
    for (const p of this.players) {
      if (p.human && !this.assist) { p.intent = { ...this.humanIntent }; }
      else p.intent = blankIntent();
      // v0.4.5: the Lock-In grade feeds the user's stamina; takeovers run on real seconds. v0.4.7.5: every AI
      // player keeps a Lock-In grade of his own too (aiGrades), so good and bad play move their stamina as well
      p.stam.grade = this.lockIn && this.lockIn.id === p.id ? this.lockIn.idx : (this.aiGrades.get(p.id)?.index ?? null);
      // (v0.4.7.5 quick patch: a run of the same move ends when he loses the ball or stops repeating it)
      if (p.stam.moveRun && (this.ball.holder !== p.id || this.time - (p.stam.moveT ?? -99) > REPEAT_GAP)) this.endMoveChain(p);
      const t = p.takeover;
      if (t.active) { t.left -= dt / this.speed; if (t.left <= 0) { t.active = false; t.left = 0; p.refreshRatings(); this.emit({ type: 'takeover', player: p.id, kind: t.kind, on: false }); } }
    }
    this.ai.think(dt);
    this.updatePhase(dt);
    const hp = this.human, hpAct = hp && hp.action ? hp.action.id : 0;
    for (const p of this.players) this.applyIntent(p, dt);
    this.humanActed = !!hp && (hp.action ? hp.action.id : 0) !== hpAct;
    for (const p of this.players) this.tickAction(p, dt);
    for (const p of this.players) this.moveOne(p, dt);
    this.boxOuts(dt);
    this.collide(dt);
    this.updateBall(dt);
    this.interactions(dt);
    this.rules(dt);
    this.updateAIGrades(dt);
  }

  // v0.4.7.5: a Lock-In grade for every AI player, fed the same events the user's is
  updateAIGrades(dt) {
    if (this.practice) return;
    for (const p of this.players) {
      if (p.human && !this.assist) continue;
      if (!this.aiGrades.has(p.id)) this.aiGrades.set(p.id, new LockedInGrade(this, p.id));
    }
    for (const g of this.aiGrades.values()) {
      for (const e of this.events) g.onEvent(e);
      g.tick(dt);
    }
  }

  updatePhase(dt) {
    if (this.phase === 'check') {
      this.phaseT -= dt;
      // freeze positions roughly during check
      for (const p of this.players) { p.intent.mx *= 0.2; p.intent.mz *= 0.2; p.intent.shoot = null; p.intent.pass = null; p.intent.move = null; p.intent.steal = false; }
      if (this.phaseT <= 0) { this.phase = 'live'; this.emit({ type: 'live' }); }
    } else if (this.phase === 'inbound') {
      this.phaseT -= dt;
      for (const p of this.players) { if (p === this.inbounder) { p.intent.mx = 0; p.intent.mz = 0; } p.intent.shoot = null; p.intent.move = null; p.intent.steal = false; }
      const inb = this.inbounder;
      if (this.phaseT <= 0 && this.ball.holder === inb.id && !inb.action) {
        // auto inbound pass to best guard (human inbounder chooses with pass button)
        if (this.isAI(inb) || this.phaseT < -2.5) {
          const recv = this.ai.inboundTarget(inb);
          if (recv) this.startPass(inb, { target: recv.id, type: 'inbound' });
        }
      }
    } else if (this.phase === 'dead') {
      this.phaseT -= dt;
      for (const p of this.players) { p.intent.shoot = null; p.intent.pass = null; p.intent.move = null; p.intent.steal = false; p.intent.jump = false; }
      if (this.phaseT <= 0 && this.after) { const f = this.after; this.after = null; f(); }
    } else if (this.phase === 'tip') {
      this.phaseT -= dt;
      for (const p of this.players) { p.intent.mx = 0; p.intent.mz = 0; p.intent.shoot = null; }
      if (this.phaseT <= 0 && this.ball.mode === 'dead') {
        this.ball.setFlight(0, 2.0, 0, 0, 6.6, 0, 'tip', {});
        this.tipT = 0;
      }
      if (this.ball.kind === 'tip') {
        this.tipT += dt;
        for (const j of this.tipJumpers) {
          if (!j.airborne && !j.tipped && this.tipT > 0.32 - n(j.ratings.vertical) * 0.05 + (this.isAI(j) ? this.rng.range(-0.06, 0.08) : 0)) {
            if (this.isAI(j) || j.intent.jump || j.intent.shoot === 'press') { j.tipped = true; j.startAction('tipjump', 1.0); j.jump(j.phys.vertical * 0.95); }
          }
        }
        // whoever's hand is closest to the ball near the peak tips it
        if (this.ball.vy < 1.2) {
          let best = null, bs = -1;
          for (const j of this.tipJumpers) {
            const reach = j.phys.reach + j.y + 0.1;
            const s = reach - this.ball.y + this.rng.range(0, 0.18) + n(j.ratings.vertical) * 0.1;
            if (reach > this.ball.y - 0.1 && s > bs) { bs = s; best = j; }
          }
          if (best) {
            const mates = this.mates(best);
            const tgt = mates[this.rng.int(0, mates.length - 1)] || best;
            const dx = tgt.x - this.ball.x, dz = tgt.z - this.ball.z, dl = Math.hypot(dx, dz) || 1;
            this.ball.setFlight(this.ball.x, this.ball.y, this.ball.z, dx / dl * 4.5, 1.5, dz / dl * 4.5, 'loose', { tip: best.id });
            this.ball.lastTouch = best.id; this.ball.lastTeam = best.team;
            this.phase = 'live';
            this.emit({ type: 'tip', player: best.id });
          } else if (this.ball.y < 1.3 && this.ball.vy < 0) {
            this.ball.kind = 'loose'; this.phase = 'live';
          }
        }
      }
    } else if (this.phase === 'ft') {
      this.updateFT(dt);
    } else if (this.phase === 'ftflight') {
      this.updateFT(dt);
      for (const p of this.players) { p.intent.mx = 0; p.intent.mz = 0; p.intent.jump = false; }
    }
  }

  // ---------- intents → actions ----------
  canAct(p) { return !p.action || p.action.type === 'catch' || p.action.type === 'celebrate'; }

  applyIntent(p, dt) {
    const it = p.intent;
    const b = this.ball;
    const has = b.holder === p.id;
    p.stance = it.defense && !has ? 'defense' : 'normal';
    p.handsUp = !!it.handsUp && !has;
    p.handsSide = !has && !p.handsUp ? it.handsSide || null : null; // v0.4.4: a hand out to one side
    if (it.call) { p.calling = 1.2; }
    if (p.calling > 0) p.calling -= dt;
    if (p.screening > 0) p.screening -= dt; // (v0.4.7.5 qp3: a called screen is "set" for a moment, see screenHit)
    if (this.phase === 'ft' || this.phase === 'tip' || this.phase === 'dead') return;
    // v0.4.5 posting up: backing a defender down near the rim (walking pace). v0.4.7.5: stamina-neutral for both
    if (has && p.speed < 2.2) {
      const rim = this.rimFor(p.team), dr = Math.hypot(rim.x - p.x, rim.z - p.z);
      const postD = this.opponents(p).find(d => { const dd = d.dist(p); return dd < 1.4 && Math.hypot(rim.x - d.x, rim.z - d.z) < dr; });
      if (dr < 5 && postD) { p.posting = 0.25; postD.postD = 0.25; } // (both stamina-neutral, player.js)
    }
    // v0.4.5 defensive assist (user only): guarding a post-up, the stick is gently pulled toward the spot
    // between the post player and the rim, so you stay attached without perfect positioning
    if (!has && p.human && !this.assist && p.stance === 'defense') {
      const h = this.holder();
      if (h && h.team !== p.team && h.posting > 0 && h.dist(p) < 1.9) {
        const rim = this.rimFor(h.team), rx = rim.x - h.x, rz = rim.z - h.z, rl = Math.hypot(rx, rz) || 1;
        const tx = h.x + rx / rl * 0.85 - p.x, tz = h.z + rz / rl * 0.85 - p.z, tl = Math.hypot(tx, tz);
        if (tl > 0.12) { const k = Math.min(1, tl / 0.6) * 0.3; it.mx = it.mx * (1 - k) + tx / tl * k; it.mz = it.mz * (1 - k) + tz / tl * k; }
      }
    }
    if (has) {
      const a = p.action;
      if (a && a.type === 'shoot' && a.releaseAt == null && (it.shoot === 'release' || (p.human && !this.assist && !it.shootHeld && it.shoot !== 'press'))) a.releaseAt = a.t;
      // v0.4.5 timed layups: every layup is timed. Let go of the button at the top; let go during the gather and
      // it's flipped up early, right off the floor
      if (a && a.type === 'layup' && !a.released && a.releaseAt == null && !a.untimed && p.human && !this.assist && !it.shootHeld && it.shoot !== 'press') {
        a.releaseAt = a.t; a.timed = true;
      }
      // v0.4.2 bailout: pass out of a jumper any time before the release, on the floor or in the air
      if (a && a.type === 'shoot' && it.pass && !a.released && this.mates(p).length) { this.bailout(p, it.pass); return; }
      // v0.4.5 quick patch: chain the next dribble move once the current one is CHAIN_AT through
      if (it.move && a && a.type === 'move' && a.t >= a.dur * chainAt(p) && b.mode === 'dribble') { this.startMove(p, it.move); return; }
      if (!this.canAct(p)) return;
      if (this.phase === 'inbound') {
        if (it.pass && p === this.inbounder && this.phaseT <= 0) this.startPass(p, { ...it.pass, type: 'inbound' });
        return;
      }
      if (this.phase === 'check') return;
      if (it.shoot === 'press') { this.startShot(p, it); return; }
      if (it.pass) { this.startPass(p, it.pass); return; }
      if (it.move && b.mode === 'dribble') { this.startMove(p, it.move); return; }
      // (v0.4.5: any move out of triple threat starts the dribble, as long as he hasn't already picked it up)
      if (it.move && b.mode === 'held' && !p.dribble.used) { b.mode = 'dribble'; this.startMove(p, it.move); return; }
      // start dribbling when moving from triple threat
      if (b.mode === 'held' && Math.hypot(it.mx, it.mz) > 0.25 && !p.dribble.used) { b.mode = 'dribble'; p.dribble.phase = 0.0; }
      if (it.celebrate) { /* only after scores */ }
    } else {
      if (!this.canAct(p)) return;
      if (it.steal && p.cool.steal <= 0) { this.startSteal(p, it.stealDir, it.stealLow); return; }
      if (it.jump && !p.airborne) { this.startJump(p); return; }
      if (it.screen) { p.screening = 0.6; }
    }
  }

  moveOne(p, dt) {
    const a = p.action;
    let lock = 0;
    const has = this.ball.holder === p.id;
    if (a) {
      switch (a.type) {
        case 'shoot': lock = 1; break;
        case 'pumpfake': lock = 0.85; break;
        case 'layup': case 'dunk': case 'oop': lock = 1; break;
        case 'pass': lock = a.ptype === 'flick' ? 0.2 : a.ptype === 'lob' || a.ptype === 'alley' || a.ptype === 'inbound' ? 0.55 : 0.32; break; // pass on the move
        case 'steal': lock = 0.5; break;
        case 'stumble': case 'hang': case 'ftshot': lock = 1; break;
        case 'block': case 'rebound': case 'tipjump': lock = p.airborne ? 1 : 0.5; break;
        case 'move': lock = 1; break;
        case 'catch': lock = 0.12; break;
        case 'celebrate': lock = 0.0; break;
      }
    }
    if (has && this.ball.mode === 'held' && p.dribble.used) lock = Math.max(lock, 0.92); // picked up dribble: pivot only
    if (this.phase === 'ft') lock = 1;
    if (a && (a.type === 'layup' || a.type === 'dunk' || a.type === 'oop' || a.type === 'move')) this.drive(p, a, dt);
    if (a && a.type === 'pass' && a.face != null && !a.released) p.intent.face = a.face; // (turning to the receiver)
    if (a && a.type === 'shoot' && a.hopVX != null && !a.jumped) { const on = a.t < a.hopEnd; p.vx = on ? a.hopVX : p.vx * 0.6; p.vz = on ? a.hopVZ : p.vz * 0.6; }
    if (a && a.type === 'hang') { p.vx = p.vz = 0; }
    p.move(dt, has, lock);
    if (a && a.type === 'hang') {
      const k = Math.min(1, dt * 16);
      p.x += (a.tx - p.x) * k; p.z += (a.tz - p.z) * k;
      p.y += (a.hangY - p.y) * Math.min(1, dt * 20); p.vy = 0; p.airborne = true;
    }
    if (a && a.type === 'move' && a.move === 'spin') p.facing = a.f0 + a.dir * Math.PI * 2 * Math.min(1, a.t / a.dur);
    // (v0.4.7.5 spin layup: a full turn through the gather steps, square to the rim at the takeoff)
    if (a && a.type === 'layup' && a.lstyle === 'spin' && a.t < a.takeoff) p.facing = (a.face0 ?? p.facing) + (a.spinDir || 1) * Math.PI * 2 * Math.min(1, a.t / Math.max(0.1, a.takeoff));
    // (v0.4.7.5: an ankle-breaker victim who got spun is turned right round)
    if (a && a.type === 'stumble' && a.react === 'spun') { const q = Math.min(1, a.t / (a.dur * 0.6)); p.facing = a.f0 + a.dir * Math.PI * 1.15 * q * q * (3 - 2 * q); }
    // (v0.4.7.5 half spin: round to face away from the defender and straight back)
    if (a && a.type === 'move' && a.move === 'halfspin') p.facing = a.f0 + a.dir * Math.PI * 0.85 * Math.sin(Math.PI * Math.min(1, a.t / a.dur));
    // AI ball handlers never wander out of bounds on their own
    if (has && this.isAI(p) && this.phase === 'live') {
      const mx = COURT.width / 2 - FOOT_R - 0.1, mz = COURT.length / 2 - FOOT_R - 0.1;
      if (Math.abs(p.x) > mx) { p.x = Math.sign(p.x) * mx; p.vx *= 0.3; }
      if (Math.abs(p.z) > mz) { p.z = Math.sign(p.z) * mz; p.vz *= 0.3; }
      if (this.half && p.z < FOOT_R + 0.1) { p.z = FOOT_R + 0.1; p.vz = Math.max(0, p.vz); }
    }
    // court bounds clamp (fences/stands), players may step OOB a little
    const lim = COURT.width / 2 + 1.6, limZ = COURT.length / 2 + 1.6;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(this.half ? -3 : -limZ, Math.min(limZ, p.z));
  }

  // velocity control during scripted moves (layups, dunks, dribble moves)
  drive(p, a, dt) {
    if (a.type === 'move') {
      const t = a.t / a.dur;
      const k = moveProfile(a.move, t);
      // v0.4.7.5: the burst snaps in faster with a better handle
      const r = Math.min(1, dt * (a.snap || 14));
      p.vx += (a.vx * k - p.vx) * r;
      p.vz += (a.vz * k - p.vz) * r;
      p.intent.mx = 0; p.intent.mz = 0;
      if (a.move !== 'spin' && a.move !== 'halfspin') p.intent.face = a.face;
      return;
    }
    // v0.4.5 alley-oop runner: sprint to the takeoff spot before leaving the floor
    if (a.type === 'oop') {
      if (!p.airborne && !a.jumped && a.spot) {
        const tx = a.spot.x - p.x, tz = a.spot.z - p.z, tl = Math.hypot(tx, tz);
        const sp = Math.min(p.phys.sprint, tl / Math.max(0.08, a.jumpAt - a.t));
        p.vx += ((tl > 0.05 ? tx / tl * sp : 0) - p.vx) * Math.min(1, dt * 9);
        p.vz += ((tl > 0.05 ? tz / tl * sp : 0) - p.vz) * Math.min(1, dt * 9);
        p.intent.face = Math.atan2(a.T.x - p.x, a.T.z - p.z);
      }
      p.intent.mx = 0; p.intent.mz = 0;
      return;
    }
    // layup/dunk steering
    const rim = this.rimFor(p.team);
    if (!p.airborne && a.t < a.takeoff) {
      const tx = a.spotX - p.x, tz = a.spotZ - p.z, tl = Math.hypot(tx, tz);
      const sp = Math.min(a.gatherSpeed, tl / Math.max(0.05, a.takeoff - a.t));
      p.vx += ((tl > 0.01 ? tx / tl * sp : 0) - p.vx) * Math.min(1, dt * 10);
      p.vz += ((tl > 0.01 ? tz / tl * sp : 0) - p.vz) * Math.min(1, dt * 10);
      p.intent.face = Math.atan2(rim.x - p.x, rim.z - p.z);
    }
    p.intent.mx = 0; p.intent.mz = 0;
  }

  // ---------- actions ----------
  startShot(p, it) {
    const rim = this.rimFor(p.team);
    const ctx = { sprint: it.sprint, forceJumper: it.forceJumper, attack: !!it.attack, defs: this.opponents(p) };
    if (p.action?.type === 'move' && p.action.move === 'stepback' && !it.attack) ctx.forceJumper = true;
    const st = S.shotTypeFor(p, rim, ctx);
    if (st.type === 'none') return; // attack-the-rim pressed out of range: keep driving
    this.endMoveChain(p);
    if (st.type === 'layup' || st.type === 'close' && it.sprint) return this.startLayup(p, rim, st);
    if (st.type === 'dunk') return this.startDunk(p, rim, st);
    const pkg = p.shotPkg;
    const close = st.type === 'close';
    p.spend(COST.shot);
    // v0.4.7.5: a drive forced into a pull-up (walled off): a Contact Finisher shoulders the man in front off him
    // to rise up (instead of Posterizer, which only ever works on the dunk)
    if (st.pullup && p.badges.contact_finisher) {
      const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
      const d = this.opponents(p).find(q => { const dx = q.x - p.x, dz = q.z - p.z, dd = Math.hypot(dx, dz); return dd < 1.25 && (dx * fx + dz * fz) / (dd || 1) > 0.4 && q.action?.type !== 'stumble'; });
      if (d) this.cfPushOff(p, d, rim);
    }
    const stepback = p.action?.type === 'move' && p.action.move === 'stepback';
    // v0.4.5: running jumpers come out quicker, step-backs and fadeaways a little slower, threes a touch slower
    // than mid-range jumpers (shots.js jumperTimingK); the ratings still set every green window
    const threeAtStart = isThree(p.x, p.z, this.sideFor(p.team));
    // v0.4.7.5 hustle shots: rising up at full speed. Toward the rim: a running pull-up; away: a running fade;
    // across: a pro hop (a two-foot hop sideways, then square and up)
    let hustle = null;
    if (!close && !stepback && p.speed > 3.6) {
      const dR = Math.hypot(rim.x - p.x, rim.z - p.z) || 1, tw = ((rim.x - p.x) * p.vx + (rim.z - p.z) * p.vz) / (dR * p.speed);
      hustle = tw > 0.45 ? 'pullup' : tw < -0.35 ? 'runfade' : 'prohop';
    }
    const tRel = close ? 0.42 : pkg.tRel * S.jumperTimingK({ moving: p.speed, stepback, fade: !!st.fade || hustle === 'runfade', three: threeAtStart, hustle });
    // Biomechanics (jump-shot kinematics literature): a jumper's centre of mass rises only ~15-31 cm, a bit
    // less from deep, and the ball leaves the hand just before the apex. So the jump height is a fraction of
    // max vertical and the takeoff is timed back from the release instead of being a fixed share of it.
    const dRim = Math.hypot(rim.x - p.x, rim.z - p.z);
    const jumpH = p.phys.vertical * (close ? 0.4 : pkg.jumpK * 0.52) * (dRim > 7 ? 0.9 : 1) * (0.85 + 0.15 * p.stamina);
    const tUp = Math.sqrt(2 * jumpH / GRAVITY);
    const a = p.startAction('shoot', tRel + 0.55, {
      icon: p.icon === 'sharp_eye' ? 'sharpeye' : null,
      tRel, takeoff: Math.max(close ? 0.1 : 0.2, tRel - tUp * 0.9), jumpH, dRim,
      kind: close ? 'close' : 'jumper', fade: !!st.fade || stepback || hustle === 'runfade', stepback, startX: p.x, startZ: p.z, moving: p.speed, hustle,
      catchShoot: this.lastPass && this.lastPass.to === p.id && this.time - this.lastPass.time < 1.2 && !p.dribble.used && this.ball.mode === 'held',
    });
    // momentum carry & fade
    if (st.fade) { const dx = p.x - rim.x, dz = p.z - rim.z, dl = Math.hypot(dx, dz) || 1; a.driftX = dx / dl * 0.8; a.driftZ = dz / dl * 0.8; }
    // hustle momentum: the pull-up carries on toward the rim in the air, the running fade drifts well back, and the
    // pro hop travels sideways on the hop (before the takeoff) and goes straight up
    if (hustle === 'pullup') { a.driftX = p.vx * 0.22; a.driftZ = p.vz * 0.22; }
    else if (hustle === 'runfade') { const dx = p.x - rim.x, dz = p.z - rim.z, dl = Math.hypot(dx, dz) || 1; a.driftX = dx / dl * 1.5; a.driftZ = dz / dl * 1.5; }
    else if (hustle === 'prohop') { const sp = p.speed || 1; a.hopVX = p.vx / sp * 2.8; a.hopVZ = p.vz / sp * 2.8; a.hopEnd = a.takeoff * 0.62; }
    // v0.4.2: square up on the gather. Moving away from the hoop the player turns and fades; otherwise he
    // turns to face the rim (the old code averaged angles and could leave him shooting with his back turned).
    a.faceRim = Math.atan2(rim.x - p.x, rim.z - p.z);
    p.facing += wrap(a.faceRim - p.facing) * 0.35;
    this.ball.mode = 'held';
    p.dribble.used = true;
    if (this.isAI(p)) { const r = this.ai.releaseTiming(p, tRel, false, st); a.releaseAt = r.at; a.aiGrade = r.grade; a.aiContest = r.contest; }
    this.emit({ type: 'shotStart', player: p.id, tRel, kind: a.kind });
  }

  startLayup(p, rim, st) {
    const d = Math.hypot(rim.x - p.x, rim.z - p.z);
    const takeoffDist = Math.min(d, 2.2 + this.rng.range(0, 0.5));
    const dx = (rim.x - p.x) / (d || 1), dz = (rim.z - p.z) / (d || 1);
    const travel = Math.max(0, d - takeoffDist);
    const gs = Math.max(2.5, Math.min(5.2, p.speed));
    // v0.4.5 layup packages: the equipped package decides how the finish looks (and the ball's path) and when the
    // ball should come out (shots.js LAYUP_FEEL). The gather and the jump vary from layup to layup, so the release
    // point moves with them: read the gather, don't count frames.
    const lstyle = p.layupStyle || 'basic', feel = S.LAYUP_FEEL[lstyle] || S.LAYUP_FEEL.basic;
    const takeoff = Math.max(0.24, Math.min(0.55, travel / gs)) + feel.gather;
    const air = 2 * Math.sqrt(2 * p.phys.vertical * 0.75 / GRAVITY);
    p.spend(COST.layup);
    // v0.4.5: the defense's coverage at the gather changes the finish (shots.js layupCoverage / LAYUP_COVER)
    const cov = S.layupCoverage(p, rim, this.opponents(p)), covSide = cov.side || (this.rng.next() < 0.5 ? 1 : -1);
    const release = takeoff + air * Math.min(0.85, feel.rel + S.LAYUP_COVER[cov.kind].rel);
    const a = p.startAction('layup', takeoff + air + 0.12, {
      cov: cov.kind, covSide,
      takeoff, release, tRel: release, spotX: p.x + dx * travel, spotZ: p.z + dz * travel, gatherSpeed: gs,
      jumpH: p.phys.vertical * 0.75, side: this.sideFor(p.team), reverse: false, euro: lstyle === 'euro' || p.intent.move === 'cross', lstyle,
      lsDir: cov.side || (this.rng.next() < 0.5 ? 1 : -1), // a Euro steps away from the defender
      face0: Math.atan2(rim.x - p.x, rim.z - p.z), spinDir: this.rng.next() < 0.5 ? 1 : -1,
    });
    this.ball.mode = 'held'; p.dribble.used = true;
    if (this.isAI(p)) { const r = this.ai.layupTiming(p, a, rim); a.releaseAt = r.at; a.aiGrade = r.grade; a.aiContest = r.contest; }
    this.emit({ type: 'gather', player: p.id, kind: 'layup' });
    return a;
  }

  startDunk(p, rim, st) {
    const d = Math.hypot(rim.x - p.x, rim.z - p.z);
    const dx = (rim.x - p.x) / (d || 1), dz = (rim.z - p.z) / (d || 1);
    const standing = !!st.standing;
    // v0.4.3: higher dunk packages take off from further out and get up higher (when the athlete has the
    // bounce for it), which buys air time for the flashier finishes
    const tier = S.dunkTier(p);
    const style = this.dunkStyle(p, standing);
    const flair = S.STYLE_FLAIR[style] ?? 0;
    const takeoffDist = standing ? Math.min(d, 0.9) : Math.min(d, 1.7 + tier * 0.12 + (st.long ? 0.35 * n(p.ratings.vertical) : 0) + this.rng.range(-0.2, 0.3));
    const travel = Math.max(0, d - takeoffDist);
    const gs = Math.max(3, Math.min(6.5, p.speed));
    // a long attack (v0.4.5) gets the gather steps it needs to reach the takeoff spot
    const takeoff = standing ? 0.28 : Math.max(0.24, Math.min(st.long ? 0.85 : 0.5, travel / gs));
    const need = COURT.rimY + 0.22 - p.phys.reach;
    const h = Math.max(need, Math.min(p.phys.vertical * (1.05 + 0.03 * tier), need + 0.25 + 0.05 * tier + (flair >= 2 ? 0.06 : 0)));
    const tUp = Math.sqrt(2 * h / GRAVITY);
    p.spend(COST.dunk);
    const a = p.startAction('dunk', takeoff + tUp + 1.2, {
      takeoff, slam: takeoff + tUp * 0.98, spotX: p.x + dx * travel, spotZ: p.z + dz * travel, gatherSpeed: gs,
      jumpH: h, standing, style, tUp, side: this.sideFor(p.team), tier, spinDir: this.rng.next() < 0.5 ? 1 : -1,
    });
    this.ball.mode = 'held'; p.dribble.used = true;
    this.emit({ type: 'gather', player: p.id, kind: 'dunk', style });
    return a;
  }

  // v0.4.3: the package decides the repertoire; higher packages lean on their flashiest finishes, traffic
  // pushes toward power dunks, and standing dunks stay simple
  dunkStyle(p, standing = false) {
    const pk = p.dunkPkg || 'dunk_basic';
    const item = this.catalog[pk];
    let styles = item?.styles || ['power', 'onehand'];
    // v0.4.5: the Hash-Slinging Icon badge unlocks a finish nobody else has
    if (p.icon === 'hash_slinging' && !standing) styles = [...styles, 'hashsling', 'hashsling'];
    if (standing) { styles = styles.filter(s => (S.STYLE_FLAIR[s] ?? 0) <= 1.5); if (!styles.length) styles = ['power']; }
    const tier = S.dunkTier(p);
    const traffic = this.opponents(p).some(d => d.dist(p) < 1.6);
    const ws = styles.map(s => { const f = S.STYLE_FLAIR[s] ?? 0; return traffic ? (f <= 1 ? 2.5 : 0.6) : 1 + f * (0.2 + 0.45 * tier); });
    // v0.4.5 stage 7: the package's signature finish (nobody else's package has it) is about half of its dunks,
    // so two packages never look alike in a game
    const si = styles.indexOf(item?.signature);
    if (si >= 0) { const rest = ws.reduce((a, b, i) => a + (i === si ? 0 : b), 0); ws[si] = Math.max(ws[si], rest); }
    let r = this.rng.next() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < styles.length; i++) { r -= ws[i]; if (r <= 0) return styles[i]; }
    return styles[styles.length - 1];
  }

  startPass(p, spec) {
    let type = spec.type || 'chest';
    // v0.4.7.5: your passes go to the teammate closest to the direction you're aiming (the left stick, or where
    // you're looking without it): direction first, whoever is open or not. The AI still reads the floor.
    const aimed = p.human && !this.assist;
    const pick = () => (aimed ? this.passTargetByDir(p, spec.dir) : this.ai.bestPassTarget(p, spec.dir));
    let target = spec.target != null ? this.players[spec.target] : pick();
    if (!target || target.team !== p.team || target === p) target = pick();
    if (!target) return;
    // v0.4.5: an alley-oop needs a receiver who can actually get to the rim in time: run to a takeoff spot and
    // rise for the ball. Anyone further out gets a regular lob instead (no more flying in from half court).
    if (type === 'alley' && !this.oopReachable(p, target)) {
      type = 'lob';
      if (p.human && !this.assist) this.feedMsg('Too far out for an alley-oop: lob pass');
    }
    const flick = type === 'chest' && p.speed > 3.5;
    const P = PASS[type] || PASS.chest;
    p.spend(COST.pass); this.endMoveChain(p);
    // v0.4.1: better passers get the ball out quicker (release up to ~25% faster)
    const quick = 1.1 - 0.32 * n(p.ratings.pass_accuracy);
    const a = p.startAction('pass', (flick ? PASS.flick.dur : P.dur) * quick, { ptype: flick ? 'flick' : type, rel: (flick ? PASS.flick.rel : P.rel) * quick, to: target.id, icon: p.icon === 'oprah' ? 'oprah' : null, quick: !!spec.quick });
    // turn to the receiver: part of it at once, the rest through the throw (the ball isn't let go until he's
    // facing within 60 degrees of him, so it always leaves toward the man it's meant for)
    const face = Math.atan2(target.x - p.x, target.z - p.z);
    p.facing += wrap(face - p.facing) * 0.4;
    a.face = face;
    this.ball.mode = 'held';
    if (type === 'alley') { target.oopCall = this.time; }
    this.emit({ type: 'passStart', player: p.id, to: target.id, ptype: type });
  }

  // v0.4.7.5: the teammate closest to a direction (the left stick, or where he's facing without it); distance only
  // breaks near-ties
  passTargetByDir(p, dir) {
    const d = dir && Math.hypot(dir.x, dir.z) > 0.2 ? dir : { x: Math.sin(p.facing), z: Math.cos(p.facing) };
    const dl = Math.hypot(d.x, d.z) || 1;
    let best = null, bv = Infinity;
    for (const r of this.mates(p)) {
      const dx = r.x - p.x, dz = r.z - p.z, rl = Math.hypot(dx, dz) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * d.x + dz * d.z) / (rl * dl))));
      const v = ang + rl * 0.004;
      if (v < bv) { bv = v; best = r; }
    }
    return best;
  }

  // the lob's aim point at the front of the rim along the receiver's approach, and where he takes off from
  oopPoints(target) {
    const rim = this.rimFor(target.team);
    const ax = target.x - rim.x, az = target.z - rim.z, al = Math.hypot(ax, az) || 1;
    const T = { x: rim.x + ax / al * 0.55, y: COURT.rimY + 0.35, z: rim.z + az / al * 0.55 };
    const td = Math.min(OOP_TAKEOFF, Math.max(0.35, al - 0.55));
    return { T, spot: { x: T.x + ax / al * td, z: T.z + az / al * td } };
  }
  // can he run to the takeoff spot before he has to leave the floor? (lob flight from the passer, minus the rise)
  oopReachable(passer, target, k = 0.85) {
    if (target.airborne || target.action?.type === 'shoot') return false;
    const { T, spot } = this.oopPoints(target);
    const from = { x: passer.x, y: passer.phys.H * 0.9, z: passer.z };
    const L = S.solveLaunch(from, T, 52);
    const vh = Math.hypot(L.vx, L.vz) || 1, flight = Math.hypot(T.x - from.x, T.z - from.z) / vh + PASS.alley.rel;
    const h = Math.min(target.phys.vertical * 1.05, Math.max(0.3, T.y + 0.15 - target.phys.reach)), tUp = Math.sqrt(2 * h / GRAVITY);
    const run = Math.hypot(spot.x - target.x, spot.z - target.z);
    return target.phys.reach + target.phys.vertical * 1.05 >= T.y - 0.05 && run <= target.phys.sprint * Math.max(0, flight - tUp) * k + 0.5;
  }

  releasePass(p, a) {
    const target = this.players[a.to];
    const b = this.ball;
    const type = a.ptype;
    const from = this.holdPoint(p);
    // (v0.4.7.5 quick patch: every pass is 10% more accurate: PASS_ACC_K takes 10% off the aim error, and the
    // accuracy the ball steers onto the receiver with in flight is 10% better)
    const acc = Math.min(1.15, n(p.ratings.pass_accuracy) * PASS_ACC_BOOST);
    let err = ((1 - n(p.ratings.pass_accuracy)) * 0.26 + Math.min(1, p.speed / 6) * 0.08) * PASS_ACC_K;
    if (a.bailout) err += (a.air ? 0.14 : 0.06) * PASS_ACC_K; // passing out of a shot is less precise, more so from the air
    let eta = 0.5;
    let T, vx, vy, vz;
    if (type === 'alley') {
      // lob to the front of the rim along the receiver's approach
      T = this.oopPoints(target).T;
      const L = S.solveLaunch(from, T, 52);
      vx = L.vx; vy = L.vy; vz = L.vz;
      a.oopTarget = T;
    } else if (type === 'lob') {
      // (qp3: the lob ahead to a runner on the break is flatter and quicker, over the defense but not floated)
      const tt = a.quick ? 0.75 : 0.9;
      T = { x: target.x + target.vx * tt, y: a.quick ? 2.0 : 2.1, z: target.z + target.vz * tt };
      const L = S.solveLaunch(from, T, a.quick ? 30 : 40);
      vx = L.vx; vy = L.vy; vz = L.vz;
    } else {
      // v0.4.1: pass speed scales with Pass Accuracy (chest ~12.5-17 m/s), leading the receiver's run
      const speed = (PASS[type] || PASS.chest).speed + acc * (type === 'bounce' ? 3 : 4.5);
      const d0 = Math.hypot(target.x - from.x, target.z - from.z);
      const tt = d0 / speed;
      const lead = Math.min(1.0, tt * 0.95);
      T = { x: target.x + target.vx * lead, y: 1.15 + (target.phys.H - 1.95) * 0.3, z: target.z + target.vz * lead };
      const ex = this.rng.normal() * err, ez = this.rng.normal() * err;
      T.x += ex; T.z += ez;
      if (type === 'bounce') {
        const Bx = from.x + (T.x - from.x) * 0.6, Bz = from.z + (T.z - from.z) * 0.6;
        const t1 = Math.hypot(Bx - from.x, Bz - from.z) / 9.5;
        vx = (Bx - from.x) / t1; vz = (Bz - from.z) / t1; vy = (BALL_R - from.y) / t1 - 0.5 * -GRAVITY * t1;
        vy = (BALL_R - from.y + 0.5 * GRAVITY * t1 * t1) / t1;
        eta = t1 / 0.6;
      } else {
        const dist = Math.hypot(T.x - from.x, T.z - from.z), t = Math.max(0.12, dist / speed);
        vx = (T.x - from.x) / t; vz = (T.z - from.z) / t; vy = (T.y - from.y + 0.5 * GRAVITY * t * t) / t;
        eta = t;
      }
    }
    b.setFlight(from.x, from.y, from.z, vx, vy, vz, 'pass', { from: p.id, to: target.id, team: p.team, type, time: this.time, oop: a.oopTarget || null, tried: new Set(), eta, acc, turned: 0 });
    b.lastTouch = p.id; b.lastTeam = p.team;
    b.wx = 0; b.wy = 0; b.wz = 0;
    this.lastPass = { from: p.id, to: target.id, time: this.time };
    p.dribble.used = false;
    if (type === 'alley') this.ai.startOop(target, a.oopTarget, b);
    if (type === 'alley' && target.human && !this.assist && target.action?.type === 'oop') {
      const oa = target.action;
      oa.qte = target.oopQte = { btn: this.rng.int(0, 3), t0: this.time, open: oa.jumpAt * OOP_QTE.open, close: oa.jumpAt + OOP_QTE.grace, result: null, at: null };
      this.emit({ type: 'oopPrompt', player: target.id, btn: oa.qte.btn, open: this.time + oa.qte.open, close: this.time + oa.qte.close });
    }
    this.emit({ type: 'pass', player: p.id, to: target.id, ptype: type });
    if (this.phase === 'inbound') { this.phase = 'live'; this.emit({ type: 'live' }); }
  }

  startMove(p, move) {
    if (p.cool.move > 0) return;
    const M = MOVES[move]; if (!M) return;
    // v0.4.5 quick patch: an exhausted player still does the move you called (it used to be silently refused under
    // 4% stamina, which felt like the stick wasn't working); he's just slower and it bites less
    const gassed = p.stamina < 0.12 ? 1 - p.stamina / 0.12 : 0;
    const handle = n(p.ratings.ball_handle);
    const sty = moveStyle(p), sig = sty.sig.includes(move);
    // v0.4.3: size-up packages (stat-locked) make moves quicker, chain faster and bite harder. v0.4.7.5: the handle
    // counts for more (a 99 handle's moves are about a quarter shorter than a 60's), and every package plays each move its own way
    const handleK = 1 + 0.4 * Math.min(1.25, handle) + 0.1 * Math.min(1.2, n(p.ratings.speed_with_ball));
    const dur = M.dur * MOVE_SNAP * sty.durK * (sig ? 0.95 : 1) / (p.moveSpeed || 1) / handleK / posMoveK(p.position) * (1 + 0.25 * gassed);
    // a different move straight out of the last one is a combo (a crossover straight back the other way counts once:
    // the double crossover; a third in a row is spam again)
    const prev = p.lastMove, quick = !!prev && this.time <= prev.end + COMBO_GAP;
    const dbl = (move === 'cross' || move === 'btl') && prev?.move === move && prev.hand !== p.dribble.hand && (p.stam.moveRun || 0) === 1;
    const combo = quick && (prev.move !== move || dbl);
    const named = combo ? comboName(prev.move, move) : null;
    p.combo = combo ? (p.combo || 1) + 1 : 1;
    p.lastMove = { move, end: this.time + dur, hand: p.dribble.hand };
    const fwdX = Math.sin(p.facing), fwdZ = Math.cos(p.facing), leftX = Math.cos(p.facing), leftZ = -Math.sin(p.facing);
    const hand = p.dribble.hand;
    const toward = hand === 'R' ? 1 : -1; // crossing from right hand moves ball to the left (+left)
    const it = p.intent, il = Math.hypot(it.mx, it.mz);
    const burst = (3.2 + handle * 1.6 + n(p.ratings.speed_with_ball) * 0.8) * (1 + ((p.moveSpeed || 1) - 1) * 0.5) * (1 - 0.25 * gassed) * sty.burstK * MOVE_BURST_K;
    const dirX = il > 0.2 ? it.mx / il : fwdX, dirZ = il > 0.2 ? it.mz / il : fwdZ;
    const rim = this.rimFor(p.team);
    let vx = 0, vz = 0;
    if (M.back) {
      // escapes: straight away from the rim (v0.4.7.5 quick patch: the diagonal ones angle off to a side too: the
      // snatch-back to the ball's side, the pull-back toward the new hand)
      const rx = p.x - rim.x, rz = p.z - rim.z, rl = Math.hypot(rx, rz) || 1;
      const bk2 = M.back * sty.burstK * MOVE_BURST_K;
      vx = rx / rl * bk2; vz = rz / rl * bk2;
      if (M.lat) { const s2 = (M.latSide === 'ball' ? -toward : toward) * M.lat * sty.wide * bk2; vx += leftX * s2; vz += leftZ * s2; }
    } else if (move === 'sidestep') {
      // a hop to the ball's side (the stick's side), a little back off the defender
      const s2 = -toward * sty.wide;
      vx = leftX * s2 * burst * M.lat - fwdX * 0.9 * MOVE_BURST_K; vz = leftZ * s2 * burst * M.lat - fwdZ * 0.9 * MOVE_BURST_K;
    } else {
      const lat = (M.lat || 0) * sty.wide, fwd = M.fwd || 0;
      // crossovers and wraps carry him toward the new hand; the in-and-out leans back toward the ball
      vx = leftX * toward * burst * lat + dirX * burst * fwd; vz = leftZ * toward * burst * lat + dirZ * burst * fwd;
    }
    p.dribble.xover = null;
    const a = p.startAction('move', dur, { move, vx, vz, f0: p.facing, dir: toward, face: Math.atan2(rim.x - p.x, rim.z - p.z), handFrom: hand, switched: false, checked: false, lvl: p.sizeupLvl || 0, snap: moveSnapRate(p), sty: p.sizeupStyle || 'basic', named });
    if (move === 'spin' || move === 'halfspin') { a.dir = hand === 'R' ? -1 : 1; }
    // v0.4.5: the same move more than 3 times in a row doubles stamina drain, +0.1x per repeat after that.
    // v0.4.7.5 quick patch: more than 6 in a row doubles that again (repeatMoveK); a repeat is the same move again
    // within REPEAT_GAP seconds, with the ball still in his hands (a pass, a shot, a pickup or losing it ends the run)
    const st = p.stam;
    if (st.lastMove === move && this.time - (st.moveT ?? -99) <= REPEAT_GAP) st.moveRun++; else { st.lastMove = move; st.moveRun = 1; }
    st.moveT = this.time;
    st.moveK = repeatMoveK(st.moveRun);
    if (!combo) p.spend(COST.move * Math.max(0.35, 1 - 0.12 * bk(p.badges, 'handles_for_days'))); // combos are free
    p.cool.move = dur * (chainAt(p) - 0.05); // (below the chain point, so a move can chain into the next)
    a.combo = p.combo;
    this.ball.mode = 'dribble';
    this.emit({ type: 'move', player: p.id, move, combo: named });
  }

  closestDef(p) { let best = -1, bd = 9; for (const d of this.opponents(p)) { const dd = d.dist(p); if (dd < bd) { bd = dd; best = d.id; } } return best; }

  // a different action (shot, pass, pickup) breaks a chain of the same dribble move
  endMoveChain(p) { const st = p.stam; st.lastMove = null; st.moveRun = 0; st.moveK = 1; st.moveT = null; }

  // v0.4.4: a reach can be aimed. dir (world) picks the hand: the one on that side of the body; low = a swipe
  // down at the dribble. Without a direction the defender reaches with the hand on the ball's side.
  startSteal(p, dir = null, low = false) {
    const h = this.holder();
    if (h) p.facing = Math.atan2(h.x - p.x, h.z - p.z);
    const lx = Math.cos(p.facing), lz = -Math.sin(p.facing); // the defender's left
    let hand;
    if (dir) hand = dir.x * lx + dir.z * lz >= 0 ? 'L' : 'R';
    else { const b = this.ball; hand = (b.x - p.x) * lx + (b.z - p.z) * lz >= 0 ? 'L' : 'R'; }
    p.startAction('steal', 0.46, { checked: false, hand, low, aimed: !!dir || low, icon: p.icon === 'the_clamp' ? 'clamp' : null });
    p.spend(COST.steal);
    p.cool.steal = 0.85 - bk(p.badges, 'pick_pocket') * 0.08;
    this.emit({ type: 'reach', player: p.id, hand });
  }

  startJump(p) {
    const b = this.ball;
    const h = this.holder();
    let type = 'block';
    if (b.mode === 'flight' && (b.kind === 'shot' || b.kind === 'loose') && !(b.kind === 'shot' && b.flightTime < 0.35 && !b.touchedRim)) type = 'rebound';
    if (h && h.team !== p.team) type = 'block';
    if (b.holder >= 0 && this.players[b.holder].team === p.team) type = 'rebound';
    const hgt = p.phys.vertical * (type === 'block' ? 0.95 : 0.9) * (0.8 + 0.2 * p.stamina);
    const air = 2 * Math.sqrt(2 * hgt / GRAVITY);
    // v0.4.5 Icon badges: Big Brother blocks and Open Arms rebound snags have their own animations
    const iconAnim = (type === 'block' && p.icon === 'big_brother') ? 'bigbro' : (type === 'rebound' && p.icon === 'open_arms') ? 'openarms' : null;
    const act = p.startAction(type, air + 0.2, { jumpAt: 0.06, jumpH: hgt, jumped: false, triedBlock: false, air, icon: iconAnim });
    p.spend(COST.jump);
    if (type === 'block' && h) p.facing = Math.atan2(h.x - p.x, h.z - p.z);
    // v0.4.3: go *at* the ball. Shot blockers and rebounders travel toward it while airborne; how far they
    // can cover depends on Block / Rebounding, and in the paint on Interior D and size.
    const tgt = type === 'block' ? (h ? this.holdPoint(h) : b) : b;
    const dx = tgt.x - p.x, dz = tgt.z - p.z, dl = Math.hypot(dx, dz);
    if (dl > 0.45 && dl < 3.2) {
      const rim = this.rimFor(1 - p.team);
      const pw = S.paintWeight(Math.hypot(tgt.x - rim.x, tgt.z - rim.z));
      const size = Math.max(0, Math.min(0.3, p.phys.H - 1.95));
      // a closeout on a jump shot goes straight up (no lunge into the shooter); at the rim a shot blocker
      // attacks the ball
      const jumper = h && h.action?.type === 'shoot' && h.action.kind !== 'close';
      // v0.4.5: +3.75% positioning reach, and a slight assist for the user so he needn't be pixel-perfect
      const assist = p.human && !this.assist ? 0.22 * DEF_ASSIST_K : 0;
      const maxL = (type === 'block'
        ? (jumper ? 0 : 0.18 + 0.36 * n(p.ratings.block) + pw * (0.26 * n(p.ratings.interior_d) + size * 0.8) + assist)
        : 0.18 + 0.38 * n(p.ratings[b.info && b.info.team === p.team ? 'off_rebound' : 'def_rebound']) + pw * 0.15 * n(p.ratings.interior_d) + assist) * DEF_K;
      const len = Math.min(dl - 0.4, maxL);
      if (len > 0.05) act.lunge = { x: dx / dl * len, z: dz / dl * len };
    }
    if (p.human && !this.assist) act.steer = true; // gentle mid-air curve toward the ball (see tickAction)
  }

  // ---------- action timeline ----------
  tickAction(p, dt) {
    const a = p.action;
    if (!a) return;
    a.t += dt;
    const b = this.ball;
    switch (a.type) {
      case 'shoot': {
        if (!a.jumped && a.t >= a.takeoff) { a.jumped = true; p.jump(a.jumpH); if (a.driftX) { p.vx = a.driftX; p.vz = a.driftZ; } }
        if (a.faceRim != null && !a.released) { const r0 = this.rimFor(p.team); a.faceRim = Math.atan2(r0.x - p.x, r0.z - p.z); p.facing += wrap(a.faceRim - p.facing) * Math.min(1, dt * (p.airborne ? 10 : 16)); }
        // AI bailout: smothered at the top of a jumper and a teammate is open -> kick it out
        if (a.jumped && !a.bailChecked && !a.released && this.isAI(p) && a.kind !== 'close') {
          a.bailChecked = true;
          const c = S.contestFor(p, this.opponents(p), this.rimFor(p.team), p.phys.reach * 0.93 + (a.jumpH || 0));
          if (c >= 0.95 && this.mates(p).length && this.rng.next() < 0.3 + 0.25 * n(p.ratings.pass_accuracy)) {
            const t = this.ai.bestPassTarget(p, null);
            if (t && this.ai.openness(t) > 1.6) { this.bailout(p, { target: t.id, type: 'chest' }); return; }
          }
        }
        if (!a.released) {
          if (p.human && !this.assist && a.releaseAt == null && a.t > a.tRel + 0.3) a.releaseAt = a.t;
          if (a.releaseAt != null && a.t >= a.releaseAt) {
            // pump fake: released very early before leaving the floor
            if (a.releaseAt < Math.min(0.16, a.takeoff * 0.8) && !a.jumped && p.human && !this.assist) {
              p.action = null; p.startAction('pumpfake', 0.42, {});
              this.emit({ type: 'pumpfake', player: p.id });
              this.ai.reactPumpFake(p);
              return;
            }
            if (b.holder === p.id) this.releaseShot(p, a); else a.released = true;
          }
        }
        if (a.released && p.landed) a.t = Math.max(a.t, a.dur - 0.12);
        if (a.t >= a.dur && !p.airborne) p.action = null;
        break;
      }
      case 'layup': {
        if (!a.jumped && a.t >= a.takeoff) {
          a.jumped = true; p.jump(a.jumpH);
          const rim = this.rimFor(p.team); const dx = rim.x - p.x, dz = rim.z - p.z, dl = Math.hypot(dx, dz) || 1;
          const air = 2 * Math.sqrt(2 * a.jumpH / GRAVITY);
          const carry = Math.max(0, dl - 1.05) / (air * 0.5);
          p.vx = dx / dl * Math.min(4.5, carry); p.vz = dz / dl * Math.min(4.5, carry);
        }
        // v0.4.5: a stronger finisher can push off a defender in his path on the way up (a bump, never a knockdown).
        // v0.4.7.5: Contact Finisher works like Posterizer's push-off on layups: with it even an equal or slightly
        // weaker finisher creates the space, the shove is bigger with every tier, and the space it makes takes more
        // off the contest at the release (cfPush, releaseLayup)
        if (a.jumped && !a.released && !a.pushed && p.airborne) {
          const cf = bk(p.badges, 'contact_finisher');
          for (const d of this.opponents(p)) {
            if (d.action?.type === 'stumble' || d.dist(p) > p.phys.radius + d.phys.radius + 0.06 + 0.04 * cf) continue;
            if (p.phys.strength - d.phys.strength < 0.08 - 0.05 * cf) continue;
            a.pushed = true;
            const ux = d.x - p.x, uz = d.z - p.z, ul = Math.hypot(ux, uz) || 1, f = (1.4 + 2 * Math.max(0, p.phys.strength - d.phys.strength)) * (1 + 0.15 * cf);
            d.vx = ux / ul * f; d.vz = uz / ul * f;
            if (!d.action || d.action.type !== 'block') { d.action = null; d.startAction('stumble', 0.45 + 0.05 * cf, { fall: false, back: true, dir: 1 }); }
            this.emit({ type: 'bump', player: p.id, defender: d.id, v: 2.5 });
            if (cf) { a.cfPush = cf; this.badgeFx(p, 'contact_finisher'); }
            break;
          }
        }
        if (!a.released && b.holder === p.id) {
          // you're still holding it past the top: it comes out late
          const timing = p.human && !this.assist && !a.untimed && a.releaseAt == null;
          if (timing && a.t > a.release + 0.3) { a.releaseAt = a.t; a.timed = true; }
          // (the ball can't leave before he's off the floor: an early let-go comes out just after the takeoff)
          const at = a.releaseAt != null ? Math.max(a.releaseAt, Math.min(a.release, a.takeoff + 0.06)) : (timing ? Infinity : a.release);
          if (a.t >= at) this.releaseLayup(p, a);
        }
        if (a.t >= a.dur && !p.airborne) p.action = null;
        break;
      }
      case 'dunk': {
        const rim = this.rimFor(p.team);
        if (!a.jumped && a.t >= a.takeoff) {
          a.jumped = true; p.jump(a.jumpH);
          const dx = rim.x - p.x, dz = rim.z - p.z, dl = Math.hypot(dx, dz) || 1;
          const reachFront = a.style === 'reverse' ? 0.2 : 0.42;
          const go = Math.max(0, dl - reachFront);
          p.vx = dx / dl * go / a.tUp; p.vz = dz / dl * go / a.tUp;
          if (a.style === 'reverse') a.revFacing = Math.atan2(-dx, -dz);
        }
        if (a.style === 'reverse' && a.jumped && !a.slammed) p.facing += wrap(a.revFacing - p.facing) * Math.min(1, dt * 6);
        // v0.4.2: contact on the way up -> posterizer (shove / knock down) or the dunker is stopped.
        // v0.4.7.5 quick patch: Posterizer is for dunks only. Winning the contact on the way up now waits for the
        // slam (posterPending): the knockdown happens if he gets his hands to the rim and throws it down; if he
        // never gets there and has to flip it up instead, it's a layup, and a Contact Finisher's push-off (or a plain
        // bump) instead of a poster
        if (a.jumped && !a.slammed && a.posterOn == null && a.posterPending == null && !a.stopped) {
          const ux = rim.x - p.x, uz = rim.z - p.z, ul = Math.hypot(ux, uz) || 1;
          for (const d of this.opponents(p)) {
            const dx = d.x - p.x, dz = d.z - p.z, dd = Math.hypot(dx, dz);
            const along = (dx * ux + dz * uz) / ul, lat = Math.abs(dx * uz - dz * ux) / ul;
            if (dd > p.phys.radius + d.phys.radius + 0.06 || along < 0 || lat > 0.6 || along > ul + 0.3) continue;
            if (d.action?.type === 'stumble') continue;
            // finishing through contact: dunk ratings + Close Shot vs the defender's size and interior D
            const tier = bk(p.badges, 'posterizer'), traffic = S.trafficSkill(p, !!a.standing), pkT = a.tier || 0;
            const pc = Math.max(0.12, Math.min(0.96, 0.45 + 0.44 * traffic + 0.07 * tier + 0.04 * pkT + (p.phys.strength - d.phys.strength) * 0.3 - 0.22 * n(d.ratings.interior_d) - Math.max(0, d.phys.H - p.phys.H) * 0.3 + (d.airborne ? 0.05 : 0)));
            if (this.rng.next() < pc) {
              // v0.4.5: the shove-and-knockdown is the Posterizer badge's alone; without it the dunker finishes
              // through the contact and bumps the defender off the line (no knockdown)
              if (tier > 0) { a.posterPending = d.id; a.through = d.id; }
              else this.shoulderThrough(p, d, a, rim);
            } else if (p.badges.contact_finisher) {
              // v0.4.7.5: stopped short of the dunk, a Contact Finisher (not Posterizer) takes over: he pushes off
              // the contact and finishes it as a layup at the rim instead
              a.stopped = d.id; p.vx *= 0.6; p.vz *= 0.6;
              this.cfPushOff(p, d, rim);
              a.cfPush = bk(p.badges, 'contact_finisher');
            } else { a.stopped = d.id; p.vx *= 0.45; p.vz *= 0.45; this.emit({ type: 'bump', player: p.id, defender: d.id, v: 2 }); }
            break;
          }
        }
        if (!a.slammed && a.t >= a.slam && b.holder === p.id) {
          // you can only dunk with your hands at the rim: if the body never got there it's a flip at the rim
          const reachFront = a.style === 'reverse' ? 0.2 : 0.42;
          const hx = p.x + Math.sin(p.facing) * reachFront, hz = p.z + Math.cos(p.facing) * reachFront;
          if (a.cfPush || (Math.hypot(hx - rim.x, hz - rim.z) > 0.62 && Math.hypot(p.x - rim.x, p.z - rim.z) > 0.75)) {
            a.slammed = true; a.hang = 0; a.release = a.t;
            // (forced into a layup: a Contact Finisher finishes it through the contact; the poster he'd won on the
            // way up is gone, since he never got to the rim: it's a push-off with the badge, a bump without)
            const pend = a.posterPending != null ? this.players[a.posterPending] : null;
            a.posterPending = null;
            if (pend && p.badges.contact_finisher && !a.cfPush) { this.cfPushOff(p, pend, rim); a.cfPush = bk(p.badges, 'contact_finisher'); }
            else if (pend && pend.action?.type !== 'stumble') this.shoulderThrough(p, pend, a, rim);
            if (!a.cfPush && p.badges.contact_finisher) { a.cfPush = bk(p.badges, 'contact_finisher'); this.badgeFx(p, 'contact_finisher'); }
            this.emit({ type: 'feed', text: a.cfPush ? `${p.name} finishes through the contact` : `${p.name} couldn't get to the rim` });
            this.releaseLayup(p, a);
          } else this.slam(p, a, rim);
        }
        if (a.slammed && a.hang > 0 && p.action === a) {
          // transition to hang
          p.action = null;
          const hangY = COURT.rimY + 0.06 - p.phys.reach * 0.98;
          // v0.4.5: glide onto the rim over a few frames instead of snapping there
          p.startAction('hang', a.hang, { hangY: Math.max(0.2, hangY), side: a.side, tx: rim.x - Math.sin(p.facing) * 0.4, tz: rim.z - Math.cos(p.facing) * 0.4 });
          this.emit({ type: 'hang', player: p.id, side: a.side });
          return;
        }
        if (a.t >= a.dur && !p.airborne) p.action = null;
        break;
      }
      case 'hang': {
        if (a.t >= a.dur) { p.action = null; p.vy = 0; p.airborne = true; p.startAction('land', 0.5, {}); this.emit({ type: 'hangRelease', player: p.id, side: a.side }); }
        break;
      }
      case 'land': if (a.t >= a.dur && !p.airborne) p.action = null; break;
      case 'pass': {
        const turned = a.face == null || Math.abs(wrap(a.face - p.facing)) < 1.05 || a.t >= a.rel + 0.22;
        if (!a.released && a.t >= a.rel && turned) { a.released = true; if (b.holder === p.id) this.releasePass(p, a); }
        if (!a.released && a.t >= a.dur) a.dur = a.t + 1 / 60; // (still turning: hold the action until the release)
        if (a.t >= a.dur) p.action = null;
        break;
      }
      case 'move': {
        if (!a.switched && switchesHand(a.move) && a.t >= a.dur * MOVES[a.move].sw) { a.switched = true; p.dribble.hand = p.dribble.hand === 'R' ? 'L' : 'R'; }
        if (!a.checked && a.t >= a.dur * 0.55) { a.checked = true; this.ankleCheck(p, a); }
        if (a.t >= a.dur) { p.action = null; if (a.move === 'hesi' || a.move === 'stutter') { p.vx *= 1.1; p.vz *= 1.1; } }
        break;
      }
      case 'steal': {
        if (!a.checked && a.t >= 0.13) { a.checked = true; this.resolveSteal(p); }
        if (a.t >= a.dur) p.action = null;
        break;
      }
      case 'block': case 'rebound': case 'tipjump': {
        if (!a.jumped && a.t >= (a.jumpAt || 0)) {
          a.jumped = true;
          if (a.type !== 'tipjump') p.jump(a.jumpH);
          if (a.lunge) {
            // travel so the hands get to the ball near the top of the jump
            const k = 1 / Math.max(0.3, (a.air || 0.7) * 0.62);
            let vx = p.vx * 0.4 + a.lunge.x * k, vz = p.vz * 0.4 + a.lunge.z * k;
            const vl = Math.hypot(vx, vz), cap = 3.4;
            if (vl > cap) { vx *= cap / vl; vz *= cap / vl; }
            p.vx = vx; p.vz = vz;
          }
        }
        // v0.4.5 defensive assist: the user's block / rebound jump bends slightly toward the ball in the air
        if (a.steer && p.airborne && a.type !== 'tipjump') {
          const h = this.holder();
          const tgt = a.type === 'block' && h && h.team !== p.team ? this.holdPoint(h) : (b.mode === 'flight' ? b : null);
          if (tgt) {
            const dx = tgt.x - p.x, dz = tgt.z - p.z, dl = Math.hypot(dx, dz);
            if (dl > 0.3 && dl < 2.2 * DEF_ASSIST_K) { const k = Math.min(1, dt * 2.2), sk = 0.35 * DEF_ASSIST_K; p.vx += (dx / dl * 1.6 - p.vx) * k * sk; p.vz += (dz / dl * 1.6 - p.vz) * k * sk; }
          }
        }
        if (a.t >= a.dur && !p.airborne) p.action = null;
        break;
      }
      case 'oop': {
        // v0.4.5: a real jump from where he is: he carries his run-up into it, but the drift toward the ball
        // through the rise is capped (about 1.8 m), so nobody glides in from the perimeter
        // v0.4.7.5 qp3: your own alley-oop needs the button (OOP_QTE). No press by the takeoff, the wrong one or
        // too early, and the jump is mistimed: a beat late and a short hop that doesn't get up to the ball
        if (!a.jumped && !a.failed && a.qte && a.qte.result !== 'hit' && a.t >= a.jumpAt) {
          if (!a.qte.result) { a.qte.result = 'late'; a.qte.at = a.t; this.emit({ type: 'oopQte', player: p.id, result: 'late', t: +a.t.toFixed(2) }); }
          a.failed = true; a.jumpAt += OOP_QTE.lateBy; a.jumpH *= OOP_QTE.hopK; a.dur += OOP_QTE.lateBy;
        }
        if (!a.jumped && a.t >= a.jumpAt) {
          a.jumped = true; p.jump(a.jumpH);
          const dx = a.T.x - p.x, dz = a.T.z - p.z, dl = Math.hypot(dx, dz) || 1;
          const go = Math.min(OOP_DRIFT, Math.max(0, dl - 0.35)), v = Math.min(go / a.tUp, 4.5);
          p.vx = dx / dl * v; p.vz = dz / dl * v;
        }
        if (a.t >= a.dur && !p.airborne && a.qte) p.oopQte = null;
        if (a.t >= a.dur && !p.airborne) p.action = null;
        break;
      }
      case 'stumble': case 'pumpfake': case 'catch': case 'celebrate': case 'bump': case 'ftwait':
        if (a.t >= a.dur) p.action = null;
        break;
      case 'ftshot': break;
      default: if (a.t >= a.dur) p.action = null;
    }
  }

  bailout(p, spec) {
    const air = p.airborne;
    p.action = null;
    this.startPass(p, { ...spec, bailout: true });
    if (p.action && p.action.type === 'pass') { p.action.bailout = true; p.action.air = air; p.action.rel = Math.min(p.action.rel, 0.07); p.action.dur = Math.max(p.action.rel + 0.1, air ? 0.5 : p.action.dur); }
    this.emit({ type: 'bailout', player: p.id, air });
  }

  releaseShot(p, a) {
    a.released = true;
    const b = this.ball;
    const rim = this.rimFor(p.team), side = this.sideFor(p.team);
    const err = a.releaseAt - a.tRel;
    const P = this.holdPoint(p);
    const raw = S.contestRaw(p, this.opponents(p), rim, P.gy), contest = Math.min(1.25, raw);
    // (v0.4.7.5 quick patch: guard is how guarded it was on the HUD's scale; a close shot is measured like a finish)
    const guard = S.guardFor(a.kind, raw), smothered = S.isSmothered(guard);
    // (a close shot isn't timed: no window, no Excellent)
    const W = this.jumperWindow(p, a, contest), { three, d, corner } = W, win = W.total;
    let grade = a.kind === 'close' ? 'none' : (a.aiGrade && this.isAI(p) ? this.aiGradeAtRelease(p, a, a.aiGrade, win, a.aiContest != null ? this.jumperWindow(p, a, a.aiContest).total : win) : S.gradeFromWindow(err, win));
    // no greens while smothered, and no makes: a release that would have been green gets a record scratch
    let scratch = false;
    if (smothered && a.kind !== 'close') {
      scratch = grade === 'excellent' || Math.abs(err) <= this.jumperWindow(p, a, contest, true).total / 1000;
      if (grade === 'excellent') grade = err < 0 ? 'early' : 'late';
    }
    const clutch = this.isClutch(p.team);
    let chance = S.finalChance({ type: a.kind === 'close' ? 'close' : 'jumper', d, a: p.ratings, three, grade, contest, moving: a.moving, fade: a.fade, stamina: p.stamina, badges: p.badges, catchShoot: a.catchShoot, corner, hot: p.hot, clutch, smothered });
    // greens always go in (unless blocked in flight), except past 35 ft, where it's mostly luck (shots.js DEEP_D),
    // and (v0.4.7.5 quick patch) a non-shooter's green from three, which is a boost
    const sure = grade === 'excellent' && W.sure;
    if (sure) chance = 1;
    const foul = this.checkShootingFoul(p, contest, 'jumper');
    const made = !smothered && (sure || this.rng.next() < chance);
    const plan = S.planShot(this.rng, P, rim, side, made, a.kind === 'close' ? 58 : p.shotPkg.arc, { halfOnly: this.half, surface: b.surface, swish: sure, guarantee: sure, bad: grade === 'vearly' || grade === 'vlate', bank: a.kind === 'close' });
    b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, 'shot', { shooter: p.id, team: p.team, three, type: a.kind, made: plan.made, grade, chance, side, contest, foul, released: this.time, d, putback: false, catchShoot: !!a.catchShoot, corner, clutch: clutch && !!p.badges.clutch });
    b.wx = plan.wx; b.wy = plan.wy; b.wz = plan.wz;
    b.ghost = !!plan.ghost;
    b.lastTouch = p.id; b.lastTeam = p.team;
    p.stats.fga++; if (three) p.stats.tpa++;
    if (grade === 'excellent') p.stats.greens++;
    this.lastShot = { shooter: p.id, team: p.team, time: this.time, three };
    this.shotLog.push({ x: a.startX, z: a.startZ, team: p.team, player: p.id, three, made: plan.made, grade });
    this.emit({ type: 'release', player: p.id, grade, chance, contest, guard, smothered, scratch, three, made: plan.made, kind: a.kind, closest: this.closestDef(p), ...(a.kind === 'close' ? {} : { err, tRel: a.tRel, win, nat: W.natural, sure: W.sure }) });
    if (foul) this.pendingFoul = foul;
  }

  // v0.4.7.5 quick patch: the defense at the release, for the AI too. The AI picks its timing when the shot starts,
  // from the contest it expects then; what it actually gets is graded against the window at the release. A closeout
  // that arrives in time shrinks the window it was aiming at, and the green slips to a near miss as often as the
  // window shrank (and a defender who backs off can turn a near miss into a green). plan / now: the window (ms) it
  // planned for and the one at the release.
  aiGradeAtRelease(p, a, grade, now, plan) {
    if (!(plan > 0)) return grade;
    if (grade === 'excellent' && now < plan) {
      if (this.rng.next() > Math.pow(Math.max(0, now / plan), 0.8)) return this.rng.next() < 0.5 ? 'early' : 'late';
    } else if ((grade === 'early' || grade === 'late') && now > plan) {
      if (this.rng.next() < 0.5 * (1 - plan / now)) return 'excellent';
    }
    return grade;
  }

  releaseLayup(p, a) {
    a.released = true;
    const b = this.ball;
    const rim = this.rimFor(p.team), side = this.sideFor(p.team);
    const P = this.holdPoint(p);
    const d = Math.hypot(rim.x - p.x, rim.z - p.z);
    // (v0.4.7.5: the space a Contact Finisher push-off made takes 8% per tier off the contest)
    const { contest, guard } = this.layupContest(p, a, P.gy), smothered = S.isSmothered(guard);
    const blocker = this.checkBlockAtRelease(p, { x: P.x, y: P.gy, z: P.z }, 'layup');
    if (blocker) return;
    // v0.4.5 timed layups: graded like a jumper against the layup window (shots.js layupWindowMs); a green is a big
    // boost that contact can still beat. v0.4.7.5 quick patch: a smothered finish has no window and doesn't go in.
    let grade = 'none', W = null, scratch = false;
    const err = a.releaseAt != null && a.tRel != null ? a.releaseAt - a.tRel : 0;
    if (a.type === 'layup' && !a.oop) {
      if (this.isAI(p) && a.aiGrade) grade = this.aiGradeAtRelease(p, a, a.aiGrade, this.layupWindow(p, a, contest, guard).total, a.aiContest != null ? this.layupWindow(p, a, Math.min(1.25, a.aiContest), S.insideGuard(a.aiContest)).total : null);
      else if (a.timed) {
        W = this.layupWindow(p, a, contest, guard);
        grade = S.gradeFromWindow(err, W.total);
      }
      if (smothered && (a.timed || a.aiGrade)) {
        scratch = grade === 'excellent' || Math.abs(err) <= this.layupWindow(p, a, contest, guard, true).total / 1000;
        if (grade === 'excellent') grade = err < 0 ? 'early' : 'late';
      }
    }
    const chance = S.finalChance({ type: 'layup', d, a: p.ratings, three: false, contest, stamina: p.stamina, badges: p.badges, hot: p.hot, grade, smothered });
    const foul = this.checkShootingFoul(p, contest, 'layup');
    const made = !smothered && this.rng.next() < chance;
    const plan = S.planShot(this.rng, P, rim, side, made, 64, { halfOnly: this.half, surface: b.surface, bank: Math.abs(p.x) > 0.8 });
    b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, 'shot', { shooter: p.id, team: p.team, three: false, type: 'layup', made: plan.made, chance, side, contest, foul, released: this.time, d, oop: !!a.oop });
    b.wx = plan.wx * 0.5; b.wz = plan.wz * 0.5;
    b.lastTouch = p.id; b.lastTeam = p.team;
    p.stats.fga++;
    this.lastShot = { shooter: p.id, team: p.team, time: this.time, three: false };
    if (grade === 'excellent') p.stats.greens++;
    this.shotLog.push({ x: p.x, z: p.z, team: p.team, player: p.id, three: false, made: plan.made, grade });
    this.emit({ type: 'release', player: p.id, grade, chance, contest, guard, smothered, scratch, three: false, made: plan.made, kind: 'layup', closest: this.closestDef(p), ...(W ? { err, tRel: a.tRel, win: W.total, nat: W.natural, sure: W.sure } : {}) });
    if (foul) this.pendingFoul = foul;
  }

  slam(p, a, rim) {
    a.slammed = true;
    const b = this.ball;
    const P = this.holdPoint(p);
    p.lastRel = { grade: 'none', kind: 'dunk', contest: 0, closest: this.closestDef(p) };
    const blocker = this.checkBlockAtRelease(p, P, 'dunk');
    if (blocker) { a.hang = 0; return; }
    const contest = S.contestFor(p, this.opponents(p), rim, COURT.rimY + 0.3);
    const traffic = S.trafficSkill(p, !!a.standing);
    let chance = S.finalChance({ type: 'dunk', d: 0.5, a: p.ratings, contest: contest * 0.8, stamina: p.stamina, badges: p.badges, traffic });
    const pend = a.posterPending != null ? this.players[a.posterPending] : null;
    a.posterPending = null;
    if (a.posterOn != null || pend) chance = Math.min(0.97, chance + 0.12);
    // v0.4.7.5: a wide-open dunk (10% guarded or less) by anyone over 70 in that dunk rating never misses
    const sure = contest <= WIDE_OPEN && ((p.raw || p.ratings)[a.standing ? 'standing_dunk' : 'driving_dunk'] ?? 0) > 70;
    if (sure) chance = 1;
    const made = sure || this.rng.next() < chance;
    let poster = a.posterOn != null ? this.players[a.posterOn] : null;
    // (v0.4.7.5 quick patch: the contact he won on the way up: thrown down = a poster; rimmed out = just a bump)
    if (pend && !poster) {
      if (made && pend.dist(p) < 1.6 && pend.action?.type !== 'stumble') { this.posterize(p, pend, a, rim, false); poster = pend; }
      else if (pend.action?.type !== 'stumble') this.shoulderThrough(p, pend, a, rim);
    }
    if (!poster && made) {
      // a contest in the air at the rim: the dunker goes through him -> knock him back as he comes down
      poster = this.opponents(p).find(d => d.dist(p) < 1.1 && (d.airborne || d.action?.type === 'block')) || null;
      if (poster && p.badges.posterizer) this.posterize(p, poster, a, rim, false);
      else if (poster) { this.shoulderThrough(p, poster, a, rim); poster = null; }
    }
    a.slamAt = a.t;
    if (made) {
      // v0.4.5 quick patch: thrown down hard, straight out of his hand through the middle of the rim (it used to appear
      // above the rim and drop at 5.5 m/s); from too far off, the old way
      const info = { shooter: p.id, team: p.team, three: false, type: 'dunk', made: true, chance, side: a.side, contest, released: this.time, poster: poster ? poster.id : -1, style: a.style, oop: !!a.oop };
      const tx = rim.x + (this.rng.next() - 0.5) * 0.04, tz = rim.z + (this.rng.next() - 0.5) * 0.04, h = P.y - COURT.rimY;
      if (h > 0.03 && Math.hypot(P.x - tx, P.z - tz) < 0.5) {
        const v0 = SLAM_V, tt = (-v0 + Math.sqrt(v0 * v0 + 2 * GRAVITY * h)) / GRAVITY;
        b.setFlight(P.x, P.y, P.z, (tx - P.x) / tt, -v0, (tz - P.z) / tt, 'shot', info);
      } else b.setFlight(tx, COURT.rimY + 0.22, tz, 0, -SLAM_V, 0, 'shot', info);
      b.ghost = true;
    } else {
      // rimmed out / stuffed by the rim
      const dx = p.x - rim.x, dz = p.z - rim.z, dl = Math.hypot(dx, dz) || 1;
      b.setFlight(rim.x + dx / dl * 0.25, COURT.rimY + 0.12, rim.z + dz / dl * 0.25, dx / dl * 2.5 + this.rng.range(-1, 1), 3.2, dz / dl * 2.5, 'shot', { shooter: p.id, team: p.team, three: false, type: 'dunk', made: false, chance, side: a.side, released: this.time });
      b.touchedRim = true;
    }
    b.lastTouch = p.id; b.lastTeam = p.team;
    p.stats.fga++;
    const foul = this.checkShootingFoul(p, contest, 'dunk');
    if (foul) this.pendingFoul = foul;
    this.lastShot = { shooter: p.id, team: p.team, time: this.time, three: false };
    this.shotLog.push({ x: p.x, z: p.z, team: p.team, player: p.id, three: false, made, grade: 'none' });
    a.hang = made && (a.style === 'power' || a.style === 'tomahawk' || a.style === 'double' || a.style === 'rimrock' || a.style === 'bully' || this.rng.next() < 0.35 + 0.1 * (a.tier || 0)) ? 0.45 + 0.12 * (a.tier || 0) + this.rng.range(0, 0.35) : 0;
    this.emit({ type: 'slam', player: p.id, made, style: a.style, side: a.side, poster: poster ? poster.id : -1, tier: a.tier || 0, flair: S.STYLE_FLAIR[a.style] ?? 0 });
  }

  // Dunker `p` posterizes defender `d`: the defender is shoved back along the dunk line (and often knocked
  // down for a few seconds), so the dunker never passes through him.
  posterize(p, d, a, rim, early) {
    a.posterOn = d.id; a.through = d.id;
    const dx = d.x - p.x, dz = d.z - p.z, dl = Math.hypot(dx, dz) || 1;
    const ux = rim.x - p.x, uz = rim.z - p.z, ul = Math.hypot(ux, uz) || 1;
    const nx = (dx / dl) * 0.6 + (ux / ul) * 0.4, nz = (dz / dl) * 0.6 + (uz / ul) * 0.4, nl = Math.hypot(nx, nz) || 1;
    // v0.4.3: higher dunk packages hit harder: a bigger shove, more knockdowns, longer on the floor
    const pkT = a.tier || 0;
    const push = (2.6 + 1.6 * Math.max(0, p.phys.strength - d.phys.strength + 0.3)) * (1 + 0.18 * pkT);
    d.action = null;
    const fall = this.rng.next() < 0.45 + 0.1 * bk(p.badges, 'posterizer') + 0.13 * pkT;
    d.startAction('stumble', fall ? 2.4 + 0.3 * pkT + this.rng.range(0, 0.8) : 1.0 + 0.15 * pkT, { fall, back: !fall, dir: this.rng.next() < 0.5 ? 1 : -1, poster: true, hard: pkT });
    // v0.4.5: the shove is all velocity (no position jump), so you see him get moved
    d.vx = nx / nl * push * 1.15; d.vz = nz / nl * push * 1.15;
    if (early) { p.vx *= 0.8; p.vz *= 0.8; }
    if (p.badges.posterizer) this.badgeFx(p, 'posterizer');
    this.emit({ type: 'posterContact', player: p.id, victim: d.id, fall });
  }

  // finishing through lighter contact: the defender is bumped off the line (no fall), never passed through
  shoulderThrough(p, d, a, rim) {
    a.through = d.id;
    const ux = rim.x - p.x, uz = rim.z - p.z, ul = Math.hypot(ux, uz) || 1;
    const sx = (d.x - p.x) * uz - (d.z - p.z) * ux > 0 ? 1 : -1; // which side of the line he is on
    const lx = uz / ul * sx, lz = -ux / ul * sx;
    d.vx = lx * 2.6 + ux / ul * 0.9; d.vz = lz * 2.6 + uz / ul * 0.9; // v0.4.5: velocity only, no position jump
    if (!d.action || d.action.type !== 'block') { d.action = null; d.startAction('stumble', 0.6, { fall: false, back: true, dir: sx }); }
    this.emit({ type: 'bump', player: p.id, defender: d.id, v: 3 });
  }

  // v0.4.7.5 Contact Finisher push-off: Posterizer's shove without the knockdown, bigger with every tier. Used when a
  // dunk attempt is forced into a layup, and when a drive is forced into a pull-up (the space to rise up)
  cfPushOff(p, d, rim) {
    const cf = bk(p.badges, 'contact_finisher');
    const dx = d.x - p.x, dz = d.z - p.z, dl = Math.hypot(dx, dz) || 1;
    const f = (1.8 + 1.4 * Math.max(0, p.phys.strength - d.phys.strength + 0.3)) * (1 + 0.15 * cf);
    d.vx = dx / dl * f; d.vz = dz / dl * f;
    if (!d.action || d.action.type !== 'block') { d.action = null; d.startAction('stumble', 0.5 + 0.05 * cf, { fall: false, back: true, dir: 1 }); }
    this.badgeFx(p, 'contact_finisher');
    this.emit({ type: 'bump', player: p.id, defender: d.id, v: 3 });
  }

  // a badge visibly changed an outcome (drives the in-game badge banner)
  badgeFx(p, key) {
    const tier = p.badges?.[key] || 0;
    if (tier > 0) this.emit({ type: 'badge', player: p.id, badge: key, tier });
  }

  // v0.4.3: every airborne defender in range used to get his own roll, so three bigs in the lane stacked
  // up to near-certain blocks. Now the best-placed defender gets one try.
  checkBlockAtRelease(p, P, kind) {
    let best = null, bestPb = 0, bestBehind = false;
    for (const d of this.opponents(p)) {
      if (!(d.airborne && (d.action?.type === 'block' || d.action?.type === 'rebound'))) continue;
      if (d.action.triedBlock) continue;
      const hx = d.x + Math.sin(d.facing) * 0.25, hz = d.z + Math.cos(d.facing) * 0.25, hy = d.reachNow() + 0.15;
      const dist = Math.hypot(P.x - hx, P.z - hz), dy = P.y - hy;
      // v0.4.3: rim protectors cover more space around the rim (Interior D, Block, length)
      const rim = this.rimFor(p.team), pw = S.paintWeight(Math.hypot(P.x - rim.x, P.z - rim.z));
      const env = (0.88 + 0.1 * n(d.ratings.block) + pw * (0.15 * n(d.ratings.interior_d) + Math.max(0, d.phys.WS - 2.05) * 0.4)) * DEF_K;
      if (dist > env || dy > (0.3 + 0.12 * n(d.ratings.block)) * DEF_K) continue;
      d.action.triedBlock = true;
      const behind = ((p.x - d.x) * Math.sin(p.facing) + (p.z - d.z) * Math.cos(p.facing)) > 0; // defender behind shooter
      const size = Math.max(-0.25, Math.min(0.3, d.phys.H - p.phys.H));
      let pb = 0.07 + 0.24 * n(d.ratings.block) + pw * (0.12 * n(d.ratings.interior_d) + size * 0.25) - (kind === 'dunk' ? 0.26 * S.trafficSkill(p, !!p.action?.standing) : 0.15 * n(p.ratings.layup)) + (hy - P.y) * 0.3 - dist / env * 0.14;
      pb += bk(d.badges, 'rim_protector') * 0.025 + (behind ? bk(d.badges, 'chasedown') * 0.04 : 0);
      if (kind === 'dunk') pb -= bk(p.badges, 'posterizer') * 0.05;
      if (pb > bestPb) { bestPb = pb; best = d; bestBehind = behind; }
    }
    if (best && this.rng.next() < bestPb) { this.blockBall(best, p, bestBehind); return best; }
    return null;
  }

  blockBall(d, shooter, chase, countFga = true) {
    const b = this.ball;
    const fx = Math.sin(d.facing), fz = Math.cos(d.facing);
    const P = b.mode === 'flight' ? { x: b.x, y: b.y, z: b.z } : this.holdPoint(shooter);
    b.setFlight(P.x, P.y, P.z, fx * this.rng.range(3, 6) + this.rng.range(-2, 2), this.rng.range(-1, 2.5), fz * this.rng.range(3, 6) + this.rng.range(-2, 2), 'loose', { blocked: d.id, shooter: shooter.id });
    b.lastTouch = d.id; b.lastTeam = d.team;
    d.stats.blk++;
    if (chase) d.stats.chasedowns++;
    if (shooter.action && (shooter.action.type === 'layup' || shooter.action.type === 'dunk')) { shooter.action.released = true; shooter.action.slammed = true; shooter.action.hang = 0; }
    if (countFga) shooter.stats.fga++;
    this.emit({ type: 'block', player: d.id, shooter: shooter.id, chase });
  }

  checkShootingFoul(p, contest, kind) {
    if (this.mode !== 'proam' || this.phase !== 'live') return null;
    let best = null, bd = 9;
    for (const d of this.opponents(p)) { const dd = d.dist(p); if (dd < bd) { bd = dd; best = d; } }
    if (!best || bd > 1.15) return null;
    let pf = 0.02 + (best.airborne ? 0.08 : 0.02) + (kind !== 'jumper' ? 0.06 : 0) + Math.max(0, 1 - bd) * 0.1 - n(best.ratings.interior_d) * 0.04;
    if (kind !== 'jumper' && p.badges.contact_finisher) pf += 0.01 * bk(p.badges, 'contact_finisher');
    if (this.rng.next() < pf) return { fouler: best.id, shooter: p.id, three: kind === 'jumper' && isThree(p.x, p.z, this.sideFor(p.team)) };
    return null;
  }

  ankleCheck(p, a) {
    for (const d of this.opponents(p)) {
      const dist = d.dist(p);
      if (dist > 2.2) continue;
      const fx = p.x - d.x, fz = p.z - d.z;
      const front = (fx * Math.sin(d.facing) + fz * Math.cos(d.facing)) / (dist || 1);
      if (front < 0.3) continue;
      // defender committed in the wrong direction
      const dv = Math.hypot(d.vx, d.vz);
      const moveDir = Math.hypot(a.vx, a.vz) > 0.1 ? (d.vx * a.vx + d.vz * a.vz) / ((dv || 1) * Math.hypot(a.vx, a.vz)) : 0;
      let pk = 0.002 + 0.03 * n(p.ratings.ball_handle) - 0.03 * n(d.ratings.perimeter_d) + bk(p.badges, 'ankle_breaker') * 0.015 + ((p.moveSpeed || 1) - 1) * 0.06;
      if (dv > 2.5 && moveDir < -0.4) pk += 0.05;
      if (d.action?.type === 'steal') pk += 0.12;
      // v0.4.7.5: every move bites its own amount (moves.js), a package's signature moves a touch more, and a named
      // combo (a killer crossover, a hesi-cross...) harder still
      pk *= MOVES[a.move]?.ankle ?? 1;
      if (moveStyle(p).sig.includes(a.move)) pk *= 1.08;
      if (a.named) pk *= 1.2;
      // v0.4.5 quick patch: moves are quicker now, so each one is a touch less likely to break ankles on its own (about
      // the same ankle-breakers per minute as before); combos bite a little harder
      pk *= 0.78;
      if ((a.combo || 1) > 1) pk += 0.008 * Math.min(4, a.combo - 1);
      if (this.rng.next() < Math.max(0, pk)) {
        d.action = null;
        // v0.4.7.5: how he goes down depends on what got him: crossed up he slips, tangles or splits; spun out he gets
        // turned all the way round; a stepback leaves him lunging onto his hands or a knee; a hesitation sends him
        // staggering; and any of them can put him on the seat of his pants
        const react = this.ankleReact(a.move);
        d.startAction('stumble', ANKLE_REACT[react].dur + this.rng.range(0, 0.35), { fall: react === 'sit', react, dir: this.rng.next() < 0.5 ? 1 : -1, f0: d.facing });
        d.vx *= 0.3; d.vz *= 0.3;
        p.stats.ankles++;
        p.ankleT = this.time; // v0.4.5: the AI attacks right after an ankle-breaker (ai.js handler)
        this.emit({ type: 'ankle', player: p.id, victim: d.id });
        return;
      }
    }
  }

  ankleReact(move) {
    const fam = MOVES[move]?.fam || 'crossover';
    const w = { crossover: { sit: 3, slip: 3, tangle: 2, split: 2, lean: 1, stagger: 1 }, behind: { sit: 2, slip: 2, tangle: 3, spun: 1, split: 1 },
      spin: { spun: 5, sit: 2, stagger: 1 }, escape: { faceplant: 3, knee: 3, sit: 1, lean: 1 }, momentum: { stagger: 3, knee: 2, sit: 2, faceplant: 1 } }[fam];
    let r = this.rng.next() * Object.values(w).reduce((x, y) => x + y, 0);
    for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; }
    return 'sit';
  }

  resolveSteal(p) {
    const b = this.ball;
    const h = this.holder();
    if (!h || h.team === p.team) return;
    const dist = p.dist(h);
    const reachX = p.x + Math.sin(p.facing) * 0.7, reachZ = p.z + Math.cos(p.facing) * 0.7;
    const ballDist = Math.hypot(b.x - reachX, b.z - reachZ);
    if (dist > 1.6 || ballDist > 1.0) {
      p.plantT = 0.22; // lunged at air
      return;
    }
    let pc = 0.012 + 0.2 * n(p.ratings.steal) + 0.015 * n(p.ratings.perimeter_d) - 0.15 * n(h.ratings.ball_handle) + bk(p.badges, 'pick_pocket') * 0.02;
    if (b.mode === 'dribble') pc += b.y < 0.6 ? 0.05 : -0.02; else pc -= 0.04;
    if (h.action?.type === 'move') pc += 0.05;
    if (h.action?.type === 'shoot' || h.action?.type === 'layup') pc -= 0.03;
    pc -= Math.max(0, ballDist - 0.4) * 0.15;
    // v0.4.4: the right hand at the right time. Reaching with the ball-side hand (or swiping low while the
    // ball is near the floor) is much better than reaching across the body, which also draws more fouls.
    const a = p.action || {};
    let foulK = 1;
    if (a.hand) {
      const lx = Math.cos(p.facing), lz = -Math.sin(p.facing), ballLeft = (b.x - p.x) * lx + (b.z - p.z) * lz >= 0;
      const right = (a.hand === 'L') === ballLeft;
      if (a.low) { pc *= b.mode === 'dribble' && b.y < 0.7 ? 1.35 : 0.7; }
      else if (a.aimed) { pc *= right ? 1.3 : 0.55; if (!right) foulK = 1.8; }
    }
    if (this.rng.next() < pc) {
      const clean = this.rng.next() < 0.42;
      h.stats.tov++; p.stats.stl++;
      h.action = null;
      if (clean) { this.changePossessionTo(p); this.giveBall(p, 'held'); p.dribble.used = false; }
      else this.pokeOut(p, h);
      this.emit({ type: 'steal', player: p.id, victim: h.id, clean });
    } else {
      p.plantT = 0.25;
      // v0.4.7.5 quick patch: a reach-in foul is called on contact, not on chance. Where the reaching hand ends up
      // decides it: into the ball handler's body or arm without getting the ball first is a foul nearly every time
      // (more so reaching across his body), a hand that gets the ball first is all ball (a rare call on the follow
      // through), and a reach that touches nothing is never a foul.
      const c = this.reachContact(p, h);
      const pf = c.body ? (c.ballFirst ? 0.06 : REACH_FOUL.body * Math.min(1.5, foulK)) : 0;
      if (this.mode === 'proam' && pf > 0 && this.rng.next() < pf) this.callFoul(p, h, false);
    }
  }
  // v0.4.7.5 quick patch: where a reach lands. The hand goes out along the defender's facing on the side of the hand
  // he reached with; body: it ends up inside the ball handler (his torso, or the arm that's dribbling); ballFirst: it
  // got to the ball before it got to him.
  reachContact(d, h) {
    const a = d.action || {}, b = this.ball;
    const fx = Math.sin(d.facing), fz = Math.cos(d.facing), lx = Math.cos(d.facing), lz = -Math.sin(d.facing);
    const sd = a.hand === 'R' ? -1 : 1, reach = Math.min(REACH_FOUL.len, d.phys.WS ? d.phys.WS * 0.36 : 0.66);
    const hx = d.x + fx * reach + lx * sd * 0.17, hz = d.z + fz * reach + lz * sd * 0.17;
    const toBody = Math.hypot(hx - h.x, hz - h.z) - (h.phys.radius || 0.27) * 0.62; // (the torso, not the space round him)
    // the dribbling arm: from his shoulder on the ball's side out to the ball
    const hl = Math.cos(h.facing), hlz = -Math.sin(h.facing), bs = (b.x - h.x) * hl + (b.z - h.z) * hlz >= 0 ? 1 : -1;
    const sx = h.x + hl * bs * 0.2, sz = h.z + hlz * bs * 0.2;
    const ex = b.x - sx, ez = b.z - sz, el = ex * ex + ez * ez || 1e-6;
    const t = Math.max(0, Math.min(1, ((hx - sx) * ex + (hz - sz) * ez) / el));
    const toArm = Math.hypot(hx - (sx + ex * t), hz - (sz + ez * t)) - 0.06;
    const toBall = Math.hypot(hx - b.x, hz - b.z) - BALL_R;
    const body = Math.min(toBody, toArm) < REACH_FOUL.touch;
    // the ball first: it's nearer the hand than he is (the hand's path goes through it before his body or arm)
    const ballFirst = toBall < REACH_FOUL.touch + 0.06 && toBall <= Math.min(toBody, toArm) + 0.04;
    return { body, ballFirst, toBody, toArm, toBall };
  }

  // v0.4.2 poke-out: the ball is knocked away from the dribbler (sideways/behind him, low and skipping),
  // and the dribbler is a beat late to react, so a good reach doesn't just bounce back into his hands.
  pokeOut(d, h) {
    const b = this.ball;
    const ax = h.x - d.x, az = h.z - d.z, al = Math.hypot(ax, az) || 1;
    const side = this.rng.next() < 0.5 ? 1 : -1, ang = side * this.rng.range(0.55, 1.6);
    const c = Math.cos(ang), s = Math.sin(ang);
    const ux = (ax / al) * c - (az / al) * s, uz = (ax / al) * s + (az / al) * c;
    const sp = this.rng.range(3.2, 5.6);
    b.setFlight(b.x, Math.max(0.45, Math.min(0.9, b.y)), b.z, ux * sp, this.rng.range(0.3, 1.4), uz * sp, 'loose', { poke: d.id });
    b.wx = -uz * 20; b.wz = ux * 20;
    b.lastTouch = d.id; b.lastTeam = d.team;
    h.fumbleUntil = this.time + 0.55;
    if (!h.action) h.startAction('bump', 0.35, {});
    this.emit({ type: 'poke', player: d.id, victim: h.id });
  }

  // ---------- ball ----------
  // World position where `p` holds the ball, consistent with animation targets.
  // v0.4.5 quick patch: the highest the ball can be held at (bx, bz) in character space (metres from the feet) with
  // the `side` hand: the wrist within ARM_EXT of the arm's length from the shoulder, the shoulder raised by ARM_LIFT and
  // sitting `back`×H behind upright (a lean). The hand grips the ball BALL_R + 0.035H under its centre, 0.03H behind it
  // and 0.01H to the outside (animator ballHands). Above this the ball would float out of the hand before the release.
  // body: [drop, back, out] (×H) where the pose moves the shoulder from upright; otherwise back alone (a jumper's lean)
  reachTop(p, side, bx, bz, back = 0, body = null) {
    const A = p.arm;
    if (!A) return Infinity;
    const H = A.H, sg = side === 'L' ? 1 : -1, L = A.len * ARM_EXT;
    const [drop, bk, out, trim = 0] = body || [1.85 * back * back, back, 0];
    const dx = bx + sg * 0.01 * H - sg * (A.shoulderX + out * H), dz = bz - 0.03 * H - (A.z - bk * H);
    const up = Math.sqrt(Math.max(0, L * L - dx * dx - dz * dz));
    return A.shoulderY + (ARM_LIFT - drop - trim) * H + up + BALL_R + 0.035 * H;
  }

  holdPoint(p, out = {}) {
    const H = p.phys.H, a = p.action, b = this.ball;
    const hs = p.dribble.hand === 'R' ? -1 : 1;
    let lx = hs * 0.12, ly = 0.53 * H, lz = 0.3, gdy = 0;
    if (a && a.type === 'shoot') {
      const sh = p.shotPkg.hand === 'L' ? 1 : -1;
      const t = a.t, T = a.tRel;
      // v0.4.5 stage 7: every jump-shot base carries the ball on its own path (where it starts, where it sets,
      // how long it sits there, where it's let go), so the bases differ in ball travel and not only in the legs
      const sp = SHOT_PATH[a.kind === 'close' ? 'standard' : p.shotPkg.style] || SHOT_PATH.standard;
      const rel = [sh * 0.05, 0, 0.3 + p.shotPkg.push + (sp.rz || 0) - (a.hustle === 'runfade' ? 0.12 : 0)]; // (falling away: let go closer in)
      // the release point: as high as the base lets it go, but never out of the shooting hand's reach (so the top of
      // the ball's travel, the middle of the green window, is where it leaves his hand, whatever his build)
      rel[1] = Math.min(p.phys.reach * (p.shotPkg.relK ?? 0.93), this.reachTop(p, p.shotPkg.hand === 'L' ? 'L' : 'R', rel[0], rel[2], a.hustle === 'runfade' ? Math.max(sp.back, RUNFADE_BACK) : a.fade ? Math.max(sp.back, 0.065) : sp.back));
      const pocket = [sh * 0.06, sp.py * H, 0.32], set = [sh * sp.sx, Math.min(p.shotPkg.setH * H, rel[1] - 0.04 * H), sp.sz];
      // (gameplay still measures the contest at the height the build's reach gives the release, as it always has:
      // relU/setU, the uncapped points; the cap is the body model's, it doesn't move the defense)
      const relU = p.phys.reach * (p.shotPkg.relK ?? 0.93), setU = p.shotPkg.setH * H;
      if (sp.line) {
        // one motion from the pocket to the release, curving through the set point without stopping there
        const k = Math.min(1, t / T), e = k * k * (3 - 2 * k), u = 1 - e;
        lx = u * u * pocket[0] + 2 * u * e * set[0] + e * e * rel[0];
        ly = u * u * pocket[1] + 2 * u * e * set[1] + e * e * rel[1];
        gdy = 2 * u * e * (setU - set[1]) + e * e * (relU - rel[1]);
        lz = u * u * pocket[2] + 2 * u * e * set[2] + e * e * rel[2];
      } else {
        const ks = sp.ks, ps = sp.pause || 0;
        const k1 = Math.min(1, t / (T * ks)), k2 = Math.max(0, Math.min(1, (t - T * (ks + ps)) / (T * (1 - ks - ps))));
        const e1 = k1 * k1 * (3 - 2 * k1), e2 = k2 * k2;
        lx = pocket[0] + (set[0] - pocket[0]) * e1 + (rel[0] - set[0]) * e2;
        ly = pocket[1] + (set[1] - pocket[1]) * e1 + (rel[1] - set[1]) * e2;
        gdy = (setU - set[1]) * e1 + ((relU - setU) - (rel[1] - set[1])) * e2;
        lz = pocket[2] + (set[2] - pocket[2]) * e1 + (rel[2] - set[2]) * e2;
        if (sp.drift) lx += sh * sp.drift * Math.sin(Math.PI * Math.min(1, t / T));
      }
    } else if (a && a.type === 'layup') {
      const t = Math.min(1, a.t / a.release), e = t * t * (3 - 2 * t), ls = a.lstyle || 'basic';
      const sh = -1;
      const cv = a.cov || 'open', cs = a.covSide || 1;
      // v0.4.5 quick patch: the top of each finish (where the ball leaves his hand, the middle of the green window) is
      // kept within the finishing hand's reach: work out where the ball ends up (package, then coverage) and cap it
      const end = { scoop: [-0.12, 0.56], finger: [-0.06, 0.5], euro: [-0.05, 0.38], reverse: [-0.3, 0.1], hop: [0, 0.42], floater: [-0.05, 0.42], spin: [-0.05, 0.38] }[ls] || [-0.05, 0.38];
      const body = (LAYUP_BODY[ls] || LAYUP_BODY.basic)[cv] || LAYUP_BODY.basic.open, hand = S.layupHand(a);
      // (and never so far out in front that a shorter arm can't get there: at most 80% of the arm out from the shoulder)
      const A = p.arm, zMax = A ? A.z - body[1] * H + 0.03 * H + 0.8 * A.len : Infinity;
      const ex = cv === 'side' ? cs * 0.28 : cv === 'rim' ? cs * 0.32 : end[0], ez = Math.min(zMax, end[1] + (cv === 'rim' ? -0.3 : cv === 'trail' ? 0.06 : 0));
      const cap = this.reachTop(p, hand, ex, ez, 0, body) - (cv === 'trail' ? 0.07 * H : 0);
      const top = k => Math.min(p.phys.reach * k, cap);
      const ue = ls === 'scoop' ? e * e : ls === 'finger' || ls === 'floater' ? Math.pow(e, 0.8) : e, uk = ls === 'scoop' ? 0.88 : ls === 'finger' ? 1.02 : ls === 'floater' ? 1.0 : ls === 'reverse' ? 0.95 : 0.97;
      gdy = (p.phys.reach * uk - top(uk)) * ue; // (the uncapped finish, for the contest and blocks, as before)
      if (ls === 'scoop') {
        // underhand: the ball dips to the hip, swings out to the side, then rolls up off the palm
        const dip = Math.sin(Math.min(1, t / 0.55) * Math.PI);
        lx = sh * (0.12 + 0.2 * dip); ly = 0.5 * H - 0.08 * H * dip + (top(0.88) - 0.5 * H) * e * e; lz = 0.34 + e * 0.22 + dip * 0.1;
      } else if (ls === 'finger') {
        // high and late: full extension, the ball carried out in front off the fingertips
        lx = sh * 0.06; ly = 0.64 * H + (top(1.02) - 0.64 * H) * Math.pow(e, 0.8); lz = 0.3 + e * 0.2;
      } else if (ls === 'euro') {
        // swept across the body on the long second step, then up on the far side
        const sw = a.lsDir || 1, cross = Math.sin(Math.min(1, t / 0.7) * Math.PI);
        lx = sh * 0.1 * (1 - e) + sw * 0.26 * cross + sh * 0.05 * e; ly = 0.56 * H + (top(0.97) - 0.56 * H) * e; lz = 0.3 + e * 0.08;
      } else if (ls === 'reverse') {
        // under the rim and up behind on the right: the arm reaches back up over the shoulder
        lx = sh * (0.1 * (1 - e) + 0.3 * e); ly = 0.6 * H + (top(0.95) - 0.6 * H) * e; lz = 0.3 - 0.2 * e * e;
      } else if (ls === 'hop') {
        // both hands on it at the chest through the two-foot hop, then pushed up two-handed
        const k = Math.max(0, (t - 0.35) / 0.65), ek = k * k * (3 - 2 * k);
        lx = 0; ly = 0.62 * H + (top(0.97) - 0.62 * H) * ek; lz = 0.3 + 0.12 * ek;
      } else if (ls === 'floater') {
        // up early and high out in front, a soft one-hand push
        lx = sh * 0.05; ly = 0.66 * H + (top(1.0) - 0.66 * H) * Math.pow(e, 0.8); lz = 0.36 + e * 0.06;
      } else if (ls === 'spin') {
        // protected at the chest through the spin, then up like a regular finish
        const k = Math.max(0, (t - 0.4) / 0.6), ek = k * k * (3 - 2 * k);
        lx = sh * 0.05; ly = 0.6 * H + (top(0.97) - 0.6 * H) * ek; lz = 0.18 + 0.2 * ek;
      } else { lx = sh * 0.1 * (1 - e) + sh * 0.05; ly = 0.62 * H + (top(0.97) - 0.62 * H) * e; lz = 0.3 + e * 0.08; }
      // v0.4.5 coverage variants on top of the package's path
      if (cv === 'side') { const k = Math.sin(Math.min(1, t / 0.8) * Math.PI * 0.5); lx = lx * (1 - k) + cs * 0.28 * k; } // carried on the far side
      else if (cv === 'front') { const dip = Math.sin(Math.min(1, Math.max(0, (t - 0.3) / 0.5)) * Math.PI); ly -= 0.17 * H * dip; lz -= 0.1 * dip; } // the double clutch
      else if (cv === 'rim') { lx = lx * (1 - e) + cs * 0.32 * e; lz -= 0.3 * e * e; } // under and around to the far side
      else if (cv === 'trail') { ly += 0.07 * H * Math.min(1, t * 1.8); lz += 0.06; } // up high, early
      lz = Math.min(lz, zMax);
    } else if (a && a.type === 'dunk') {
      const t = Math.min(1, a.t / a.slam);
      const e = t * t * (3 - 2 * t);
      const topY = p.phys.reach * 1.0, st = a.style;
      // v0.4.3: each style carries the ball on its own path (the hands follow the ball in the animator)
      if (st === 'tomahawk') {
        const wind = Math.sin(Math.min(1, t * 1.15) * Math.PI);
        ly = 0.65 * H + (p.phys.reach * 0.98 - 0.65 * H) * e + wind * 0.15; lz = 0.3 + e * 0.15 - wind * 0.45; lx = -0.12;
      } else if (st === 'windmill' || st === 'cradle') {
        // full arm circle: front-low, down past the hip, back, up over the top, then down into the rim.
        // The cradle swings it out to the side, tucked against the forearm.
        // (v0.4.7.5: a true windmill: the arm goes all the way round from shoulder height in front, a full turn
        // with the slam. Quick patch: the windmill's circle starts just before the takeoff and goes round in the
        // air, instead of most of the way round during the gather on the floor)
        const mill = st === 'windmill', C = mill ? millCircle(p, H) : null;
        const t0 = mill ? Math.max(0, (a.takeoff || 0) - 0.12) : 0, k = mill ? Math.max(0, Math.min(1, (a.t - t0) / Math.max(0.1, a.slam - t0))) : Math.min(1, t / 0.9), ek = k * k * (3 - 2 * k);
        // (the windmill stays on its circle right to the slam, coming over the top and down in front at the rim, so the
        // arm is straight the whole way: it used to leave the circle for a point no arm could reach)
        const al = (mill ? 0 : -0.35 * Math.PI) - (mill ? 1.6 : 1.32) * Math.PI * ek, R = mill ? C.R : 0.37 * H, cy = mill ? C.cy : 0.9 * H;
        const cx = mill ? C.cx : -0.18 - 0.16 * Math.sin(Math.PI * k);
        const cyy = cy + R * Math.sin(al), czz = (mill ? C.cz : 0.08) + R * Math.cos(al) * (mill ? 1 : 0.8);
        const f = mill ? 0 : Math.max(0, (t - 0.82) / 0.18), ef = f * f * (3 - 2 * f);
        lx = cx * (1 - ef) - 0.08 * ef; ly = cyy + (topY - cyy) * ef; lz = czz + (0.5 - czz) * ef;
      } else if (st === 'double') {
        // double clutch: up, back down to the waist, then up and in
        const up1 = Math.sin(Math.min(1, t / 0.38) * Math.PI * 0.5), down = Math.max(0, Math.min(1, (t - 0.38) / 0.27)), up2 = Math.max(0, (t - 0.65) / 0.35);
        const y1 = 0.6 * H + (0.98 * H - 0.6 * H) * up1, y2 = y1 + (0.62 * H - y1) * Math.sin(down * Math.PI * 0.5);
        ly = up2 > 0 ? 0.62 * H + (topY - 0.62 * H) * (up2 * up2 * (3 - 2 * up2)) : y2; lz = 0.3 + 0.25 * Math.max(0, up2); lx = 0;
      } else if (st === '360') {
        // tucked at the chest through the spin, then up and through
        const f = Math.max(0, (t - 0.72) / 0.28), ef = f * f * (3 - 2 * f);
        ly = 0.72 * H + (topY - 0.72 * H) * ef; lz = 0.24 + 0.28 * ef; lx = -0.02;
      } else if (st === 'hammer') {
        // v0.4.5 stage 7: cocked back over the shoulder, out wide on the ball side (the tomahawk goes straight back
        // behind the head), then swung down and across
        const back = Math.sin(Math.min(1, t / 0.72) * Math.PI);
        ly = 0.68 * H + (topY * 1.02 - 0.68 * H) * e + back * 0.06; lz = 0.26 + e * 0.2 - back * 0.3; lx = -0.14 - back * 0.34;
      } else if (st === 'rimrock') {
        // Rim Rocker: both hands take it back behind the head, then a two-hand hammer straight down
        const back = Math.sin(Math.min(1, t / 0.76) * Math.PI);
        ly = 0.7 * H + (topY * 1.02 - 0.7 * H) * e + back * 0.12; lz = 0.28 + e * 0.2 - back * 0.56; lx = 0;
      } else if (st === 'bully') {
        // Contact: carried high and away from the defender on the far side, then thrown down through him
        const k = Math.min(1, t / 0.8), ek = k * k * (3 - 2 * k), f = Math.max(0, (t - 0.8) / 0.2), ef = f * f * (3 - 2 * f);
        lx = -0.4 * (1 - ef) - 0.08 * ef; ly = 0.74 * H + (0.97 * H - 0.74 * H) * ek + (topY - 0.97 * H) * ef; lz = 0.1 + 0.42 * ef;
      } else if (st === 'aroundback') {
        // Showtime: wrapped around the waist behind his back (right hand to left), then up and slammed left-handed
        const k = Math.min(1, t / 0.72), ek = k * k * (3 - 2 * k), phi = -Math.PI / 3 - (4 * Math.PI / 3) * ek, R = 0.36;
        const f = Math.max(0, (t - 0.72) / 0.28), ef = f * f * (3 - 2 * f), wx = R * Math.sin(phi), wz = R * Math.cos(phi);
        lx = wx + (0.08 - wx) * ef; ly = 0.53 * H + (topY - 0.53 * H) * ef; lz = wz + (0.5 - wz) * ef;
      } else if (st === 'superman') {
        // High Flyer: stretched out flat, the ball held out in front at arm's length all the way in
        ly = 0.84 * H + (topY - 0.84 * H) * e; lz = 0.64 - 0.14 * Math.pow(e, 3); lx = -0.06;
      } else if (st === 'liberty') {
        // held straight up and back at full extension, hanging there before it goes down
        const k = Math.min(1, t / 0.85), ek = k * k * (3 - 2 * k), f = Math.max(0, (t - 0.85) / 0.15);
        ly = 0.66 * H + (topY * 1.1 - 0.66 * H) * ek; lz = 0.26 - 0.2 * ek + 0.42 * f; lx = -0.1;
      } else if (st === 'scoop') {
        // scooped from the hip, rocked in underhand
        const k = Math.min(1, t / 0.8), ek = k * k * (3 - 2 * k);
        const dip = Math.sin(Math.min(1, t / 0.5) * Math.PI);
        ly = 0.5 * H - 0.1 * H * dip + (topY * 0.98 - 0.5 * H) * ek * ek; lz = 0.3 + 0.28 * ek + dip * 0.14; lx = -0.16 - 0.1 * dip;
      } else if (st === 'switch') {
        // one hand out to the side, switched across to the other at the top
        const sw = Math.max(0, Math.min(1, (t - 0.42) / 0.3)), esw = sw * sw * (3 - 2 * sw);
        ly = 0.66 * H + (topY - 0.66 * H) * e; lz = 0.3 + e * 0.22; lx = -0.26 + 0.52 * esw;
      } else if (st === '180') {
        // carried low and wide through the half turn, then thrown down backward
        const k = Math.min(1, t / 0.8), ek = k * k * (3 - 2 * k);
        ly = 0.62 * H + (topY * 0.99 - 0.62 * H) * ek; lz = 0.3 - 0.3 * Math.sin(Math.PI * k) - 0.06 * ek; lx = -0.22 + 0.14 * ek;
      } else if (st === 'eastbay') {
        // between the legs in the air. v0.4.7.5 quick patch: it really goes through now (it used to dip in front of
        // the right thigh and come back up). The right hand takes it down in front, through the gap under the
        // pelvis between the split legs (the right knee driven up in front, the left leg back), the left hand takes
        // it on the far side, and carries it up the left side to the rim (EASTBAY_KEYS: [k, x, y×H, z])
        // (timed on the flight, takeoff to slam: it used to be timed from the gather, so most of it happened on the floor)
        const air = Math.max(0, Math.min(1, (a.t - (a.takeoff || 0)) / Math.max(0.1, a.slam - (a.takeoff || 0))));
        [lx, ly, lz] = keyPath(EASTBAY_KEYS, Math.min(1, air / 0.9), H);
        const f = Math.max(0, (air - 0.9) / 0.1), ef = f * f * (3 - 2 * f);
        if (ef > 0) { lx += (0.08 - lx) * ef; ly += (topY * 1.02 - ly) * ef; lz += (0.5 - lz) * ef; }
      } else if (st === 'hashsling') {
        // Hash-Slinging (Icon badge only): a full wind-up behind the back, around the body, then slung over the top
        const k = Math.min(1, t / 0.9), ek = k * k * (3 - 2 * k);
        const al = 0.2 * Math.PI - 2.1 * Math.PI * ek, R = 0.4 * H, cy = 0.92 * H;
        const cyy = cy + R * Math.sin(al), czz = 0.04 + R * Math.cos(al) * 0.9;
        const f = Math.max(0, (t - 0.84) / 0.16), ef = f * f * (3 - 2 * f);
        lx = (-0.22 + 0.3 * Math.sin(Math.PI * k)) * (1 - ef) - 0.04 * ef;
        ly = cyy + (topY * 1.04 - cyy) * ef; lz = czz + (0.52 - czz) * ef;
      } else if (st === 'reverse') {
        ly = 0.65 * H + (topY * 0.99 - 0.65 * H) * e; lz = 0.3 + e * 0.05 - Math.sin(Math.PI * t) * 0.18; lx = 0;
      } else if (DUNK_PATH2[st]) {
        [lx, ly, lz] = DUNK_PATH2[st](t, e, H, topY, p);
      } else { ly = 0.65 * H + (topY - 0.65 * H) * e; lz = 0.3 + e * 0.25; lx = st === 'onehand' ? -0.1 : 0; }
      const spin = S.dunkSpin(a);
      if (spin) { const c = Math.cos(spin), s2 = Math.sin(spin), x0 = lx; lx = x0 * c + lz * s2; lz = -x0 * s2 + lz * c; }
    } else if (a && a.type === 'pass' && !a.released) {
      const t = Math.min(1, a.t / a.rel);
      if (a.ptype === 'lob' || a.ptype === 'alley') { ly = 0.66 * H + t * 0.42 * H; lz = 0.25 + t * 0.1; lx = 0; }
      else if (a.ptype === 'bounce') { ly = 0.6 * H - t * 0.12 * H; lz = 0.3 + t * 0.35; lx = 0; }
      else if (a.ptype === 'flick') { lx = hs * 0.25; ly = 0.6 * H; lz = 0.35 + t * 0.2; }
      else { ly = 0.66 * H; lz = 0.28 + t * 0.4; lx = 0; }
    } else if (a && a.type === 'pumpfake') {
      const t = Math.sin(Math.min(1, a.t / a.dur) * Math.PI);
      ly = 0.6 * H + t * 0.42 * H; lz = 0.3 - t * 0.08; lx = -0.06;
    } else if (a && a.type === 'ftshot') {
      const t = a.t, T = a.tRel;
      if (t < 0) { // pre-shot dribbles
        const ph = (-t * 1.6) % 1; ly = BALL_R + (0.5 * H - BALL_R) * Math.abs(Math.cos(Math.PI * ph)); lz = 0.32; lx = -0.12;
      } else {
        const k = Math.min(1, t / T), e = k * k * (3 - 2 * k);
        const top = Math.min(p.phys.reach * 0.88, this.reachTop(p, p.shotPkg?.hand === 'L' ? 'L' : 'R', -0.05, 0.4));
        ly = 0.6 * H + (top - 0.6 * H) * e; lz = 0.3 + e * 0.1; lx = -0.05;
      }
    } else if (b.mode === 'dribble' && b.holder === p.id) {
      const sp = p.speed;
      const ph = p.dribble.phase;
      const ds = p.dribbleStyle || { hgtK: 1, sideK: 1 }, su = S.sizeupOf(p);
      const hgt = (0.47 - Math.min(0.08, sp * 0.012)) * H * ds.hgtK * (su ? su.hgt : 1);
      let side = hs * (0.26 + Math.min(0.08, sp * 0.012)) * ds.sideK * (su ? su.side : 1);
      lz = 0.24 + Math.min(0.32, sp * 0.06);
      ly = BALL_R + (hgt - BALL_R) * Math.abs(Math.cos(Math.PI * ph));
      if (a && a.type === 'move') {
        const t = a.t / a.dur;
        const from = a.handFrom === 'R' ? -1 : 1;
        const sty = moveStyle(p), mv = a.move;
        if (mv === 'cross' || mv === 'btl' || mv === 'btb' || mv === 'hang' || mv === 'wrap') {
          // (the hang dribble holds the ball up at the hip for a beat, then snaps it low and across)
          const tt = mv === 'hang' ? Math.max(0, (t - 0.38) / 0.62) : t;
          const e = tt * tt * (3 - 2 * tt);
          side = from * 0.28 * sty.wide * (1 - 2 * e);
          if (mv === 'btl') lz = 0.05 + Math.abs(0.5 - e) * 0.4;
          if (mv === 'btb' || mv === 'wrap') lz = -0.22 + Math.abs(0.5 - e) * 0.8;
          ly = BALL_R + (hgt * sty.low - BALL_R) * Math.abs(Math.cos(Math.PI * e)) * (mv === 'btl' ? 0.8 : 1);
          if (mv === 'hang' && t < 0.38) ly = hgt * (1.04 + 0.06 * Math.sin(t / 0.38 * Math.PI));
        } else if (mv === 'inout') {
          side = from * (0.28 - Math.sin(t * Math.PI) * 0.26 * sty.wide);
        } else if (mv === 'spin' || mv === 'halfspin') {
          side = from * 0.2; lz = 0.18; ly = 0.5 * H * (0.85 + Math.sin(t * Math.PI) * 0.15);
        } else if (mv === 'hesi') {
          ly = BALL_R + (0.55 * H - BALL_R) * Math.abs(Math.cos(Math.PI * Math.min(1, t * 1.5)));
        } else if (mv === 'stutter') {
          // quick little pounds at the hip while the feet chop, then the long one on the go
          ly = t < 0.62 ? BALL_R + (0.42 * H * sty.low - BALL_R) * Math.abs(Math.cos(Math.PI * t / 0.62 * 3)) : BALL_R + (hgt - BALL_R) * Math.abs(Math.cos(Math.PI * (t - 0.62) / 0.38));
        } else if (mv === 'momentum') {
          // pushed out ahead of him, one long dribble
          lz = 0.34 + Math.sin(t * Math.PI) * 0.42; ly = BALL_R + (hgt * 1.1 - BALL_R) * Math.abs(Math.cos(Math.PI * t));
        } else if (mv === 'sidestep') {
          // gathered to the hip through the hop
          side = from * 0.24; lz = 0.12; ly = 0.5 * H * (0.9 + 0.1 * Math.sin(t * Math.PI));
        } else if (mv === 'retreat') {
          // two hard, low dribbles on the way back
          ly = BALL_R + (hgt * 0.78 * sty.low - BALL_R) * Math.abs(Math.cos(Math.PI * t * 2)); lz = 0.2;
        } else if (mv === 'pushcross') {
          // v0.4.7.5 quick patch, the push-pull: one long dribble pushed out ahead on the ball's side, then pulled
          // back in and across, low
          if (t < 0.42) { const u = t / 0.42; side = from * 0.27; lz = 0.24 + 0.36 * Math.sin(u * Math.PI / 2); ly = BALL_R + (hgt * 1.04 - BALL_R) * Math.abs(Math.cos(Math.PI * u)); }
          else { const u = (t - 0.42) / 0.58, e = u * u * (3 - 2 * u); side = from * 0.27 * sty.wide * (1 - 2 * e); lz = 0.6 - 0.36 * e; ly = BALL_R + (hgt * sty.low - BALL_R) * Math.abs(Math.cos(Math.PI * e)); }
        } else if (mv === 'jab') {
          // held at the hip on the ball's side through the jab, then one long dribble on the go
          if (t < 0.45) { side = from * 0.3; lz = 0.16; ly = 0.47 * H * (1 + 0.03 * Math.sin(t / 0.45 * Math.PI)); }
          else { const u = (t - 0.45) / 0.55; side = from * 0.27; lz = 0.18 + 0.3 * u; ly = BALL_R + (0.47 * H - BALL_R) * Math.abs(Math.cos(Math.PI * u)); }
        } else if (mv === 'snatch') {
          // one hard dribble, yanked back to the hip as he hops back
          side = from * 0.3; lz = 0.24 - 0.14 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2);
          ly = t < 0.6 ? BALL_R + (hgt * 0.85 * sty.low - BALL_R) * Math.abs(Math.cos(Math.PI * t / 0.6)) : 0.46 * H * (0.96 + 0.04 * Math.sin((t - 0.6) / 0.4 * Math.PI));
        } else if (mv === 'btlback') {
          // between the legs while stepping back: low, from the front of one leg to behind the other
          const e = t * t * (3 - 2 * t);
          side = from * 0.27 * sty.wide * (1 - 2 * e); lz = 0.02 + Math.abs(0.5 - e) * 0.36;
          ly = BALL_R + (hgt * 0.78 * sty.low - BALL_R) * Math.abs(Math.cos(Math.PI * e));
        }
      } else if (p.dribble.xover) {
        // size-up combos in place: crossovers, between the legs, behind the back, the snake's slide across and
        // back, and the stutter's hesitation (held up at the hip for a beat)
        const e = ph * ph * (3 - 2 * ph), xo = p.dribble.xover;
        if (xo === 'half') side = side * (1 - 1.3 * Math.sin(Math.PI * e));
        else if (xo === 'hesi') ly = BALL_R + (hgt * 1.12 - BALL_R) * Math.min(1, Math.abs(Math.cos(Math.PI * ph)) * 2.4);
        else {
          side = side * (1 - 2 * e);
          if (xo === 'btl') lz = 0.04 + Math.abs(0.5 - e) * 0.4;
          if (xo === 'btb') lz = -0.22 + Math.abs(0.5 - e) * 0.8;
        }
      }
      lx = side;
    } else if (b.holder === p.id && b.mode === 'held') {
      if (this.phase === 'check' || this.phase === 'inbound') { lx = 0; ly = 0.64 * H; lz = 0.32; }
      else { lx = hs * 0.14; ly = 0.56 * H; lz = 0.3; }
    }
    const w = toWorld(p, lx, ly, lz, out);
    w.gy = w.y + gdy; // gameplay height of the ball (contests and blocks); y is where it's drawn, in his hand
    return w;
  }

  updateBall(dt) {
    const b = this.ball;
    if (b.holder >= 0 && (b.mode === 'held' || b.mode === 'dribble')) {
      const p = this.players[b.holder];
      if (b.mode === 'dribble') {
        // v0.4.5 stage 7: the size-up package sets the rhythm and the in-place combos (shots.js SIZEUP)
        if (S.advanceDribble(p, dt, () => this.rng.next(), this.opponents(p).some(d => d.dist(p) < 2.6))) {
          const w = this.holdPoint(p); this.emit({ type: 'dribble', x: w.x, z: w.z, player: p.id });
          // v0.4.5: a dribble that comes down on or over a line is out
          if (this.phase === 'live' && !this.practice && ballOut(w.x, w.z, this.half)) this.dribbleOut = p.id;
        }
      }
      const w = this.holdPoint(p);
      const vx = (w.x - b.x) / dt, vy = (w.y - b.y) / dt, vz = (w.z - b.z) / dt;
      b.x = w.x; b.y = w.y; b.z = w.z;
      b.vx = vx; b.vy = vy; b.vz = vz;
      if (b.mode === 'dribble') { b.wx = -vz / BALL_R * 0.4; b.wz = vx / BALL_R * 0.4; } else { b.wx *= 0.9; b.wz *= 0.9; }
      return;
    }
    if (b.mode === 'flight') {
      if (b.kind === 'pass') this.guidePass(b, dt);
      const ev = [];
      b.step(dt, ev);
      for (const e of ev) {
        this.emit(e);
        if (e.type === 'rim' || e.type === 'board') {
          if (b.kind === 'shot') { b.info.hitIron = true; if (!this.half) this.shotClockReset = true; }
        }
        if (e.type === 'through') this.onThrough(e);
      }
    } else if (b.mode === 'dead') {
      // dead ball drifts/rolls under physics if loose
      if (b.vy !== 0 || b.y > BALL_R + 0.001 || Math.hypot(b.vx, b.vz) > 0.05) { const ev = []; b.step(dt, ev); for (const e of ev) if (e.type === 'rim' || e.type === 'net' || e.type === 'bounce') this.emit(e); }
    }
  }

  // v0.4.1: a thrown pass bends a little toward where its receiver actually is (players adjust their throw
  // to a cutting teammate), but only within a turn-rate and total-angle budget set by the passer's accuracy,
  // so it is no heat-seeker: a hard reversal or a jumped lane still beats it.
  guidePass(b, dt) {
    const info = b.info;
    if (!info || (info.type !== 'chest' && info.type !== 'flick' && info.type !== 'inbound' && !(info.type === 'bounce' && b.floorBounces > 0))) return;
    if (b.flightTime > (info.eta || 0.5) * 0.92 || b.flightTime < 0.03) return;
    const r = this.players[info.to];
    if (!r) return;
    const left = Math.max(0.05, (info.eta || 0.5) - b.flightTime);
    const tx = r.x + r.vx * left * 0.85 + Math.sin(r.facing) * 0.2, tz = r.z + r.vz * left * 0.85 + Math.cos(r.facing) * 0.2;
    const hv = Math.hypot(b.vx, b.vz);
    if (hv < 1) return;
    const want = Math.atan2(tx - b.x, tz - b.z), cur = Math.atan2(b.vx, b.vz);
    let da = want - cur; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const acc = info.acc ?? 0.5;
    const budget = 0.12 + 0.26 * acc - (info.turned || 0);
    if (Math.abs(da) < 1e-3 || budget <= 0) return;
    const turn = Math.sign(da) * Math.min(Math.abs(da), (0.9 + 1.6 * acc) * dt, budget);
    info.turned = (info.turned || 0) + Math.abs(turn);
    const na = cur + turn;
    // keep the same speed, but re-time it so it arrives with the receiver
    const dist = Math.hypot(tx - b.x, tz - b.z);
    const sp = Math.max(hv * 0.9, Math.min(hv * 1.12, dist / left));
    b.vx = Math.sin(na) * sp; b.vz = Math.cos(na) * sp;
    // and arrive at catching height (chest) rather than at the feet or over the head
    if (info.type !== 'bounce') {
      const ty = 1.1 + (r.phys.H - 1.95) * 0.3, tl = Math.max(0.05, dist / sp);
      const vyWant = (ty - b.y + 0.5 * GRAVITY * tl * tl) / tl;
      b.vy += Math.max(-3 * dt, Math.min(3 * dt, vyWant - b.vy));
    }
  }

  onThrough(e) {
    const b = this.ball;
    const info = b.info || {};
    if (this.phase === 'dead' || this.over) return;
    // which team attacks this side
    let team = info.team ?? b.lastTeam;
    if (this.attackDir[team] !== e.side && !this.half) team = 1 - team;
    if (b.kind === 'shot' || b.kind === 'loose' || b.kind === 'pass') {
      const shooter = info.shooter != null ? this.players[info.shooter] : this.players[b.lastTouch] || null;
      let pts = info.three ? 3 : 2;
      if (info.ft) pts = 1;
      if (this.mode === 'park' && this.half && this.needsClear[team] && !info.ft) {
        // not cleared: basket doesn't count, possession over
        this.emit({ type: 'noCount', team });
        this.feedMsg('Take it back! Basket waved off.');
        b.kind = 'dead';
        this.deadBall(1.4, () => this.startCheck(1 - team));
        return;
      }
      if (this.practice) {
        this.emit({ type: 'score', team, pts, player: shooter?.id, kind: info.type, three: !!info.three, swish: e.clean });
        if (shooter) { shooter.stats.pts += pts; if (!info.ft) shooter.stats.fgm++; if (info.three) shooter.stats.tpm++; }
        b.kind = 'dead';
        this.practiceReturn(1.0);
        return;
      }
      this.score[team] += pts;
      if (shooter && shooter.team === team) {
        shooter.stats.pts += pts;
        if (info.ft) shooter.stats.ftm++; else { shooter.stats.fgm++; if (info.three) shooter.stats.tpm++; }
        if (info.type === 'dunk') shooter.stats.dunks++;
        if (info.contest > 0.55 && !info.ft) shooter.stats.contested_makes++;
        if (info.poster >= 0 && info.poster != null) shooter.stats.posters++;
        if (info.oop) shooter.stats.alleyoops++;
        // assist
        const lp = this.lastPass;
        if (lp && lp.to === shooter.id && this.players[lp.from].team === team && (info.released ?? this.time) - lp.time < 3.2 && !info.ft) {
          this.players[lp.from].stats.ast++;
          this.emit({ type: 'assist', player: lp.from, to: shooter.id });
        }
      }
      this.emit({ type: 'score', team, pts, player: shooter?.id, kind: info.type || 'tip', three: !!info.three, swish: e.clean, andOne: !!this.pendingFoul, poster: info.poster, style: info.style, oop: !!info.oop, ft: !!info.ft, contest: info.contest || 0, catchShoot: !!info.catchShoot, corner: !!info.corner, d: info.d || 0, clutch: !!info.clutch });
      this.lastPass = null;
      b.kind = 'dead';
      const andOne = this.pendingFoul && this.pendingFoul.shooter === shooter?.id ? this.pendingFoul : null;
      this.pendingFoul = null;
      if (this.checkGameOver()) return;
      if (info.ft) { this.ftMade(); return; }
      if (andOne) { this.callFoul(this.players[andOne.fouler], shooter, true, 1); return; }
      if (this.half) this.deadBall(1.9, () => this.startCheck(1 - team));
      else {
        const inbTeam = 1 - team;
        const bz = this.attackDir[team] * (COURT.length / 2 + 0.45);
        this.deadBall(1.5, () => this.startInbound(inbTeam, { x: this.rng.range(-1.2, 1.2), z: bz }, 'baseline'));
      }
    }
  }

  deadBall(t, after) {
    this.phase = 'dead'; this.phaseT = t; this.after = after;
    const b = this.ball;
    if (b.holder >= 0) { b.holder = -1; b.mode = 'dead'; }
    else if (b.mode === 'flight') { b.mode = 'dead'; }
  }

  changePossessionTo(p, reason) {
    const prev = this.possession;
    if (p.team !== prev) {
      this.possession = p.team;
      this.shotClock = 24;
      if (this.mode === 'park' && this.half) this.needsClear[p.team] = true;
      this.emit({ type: 'possession', team: p.team, reason });
    }
  }

  // ---------- interactions ----------
  interactions(dt) {
    const b = this.ball;
    if (b.mode !== 'flight') return;
    if (this.phase === 'dead' || this.over) return;
    const kind = b.kind;
    // blocks on jumpers early in flight
    if (kind === 'shot' && b.flightTime < 0.4 && b.vy > -1.5 && !b.info.blocked) {
      for (const d of this.teams[1 - b.info.team]) {
        if (!d.airborne || d.action?.type !== 'block' || d.action.triedBlock) continue;
        const hx = d.x + Math.sin(d.facing) * 0.3, hz = d.z + Math.cos(d.facing) * 0.3, hy = d.reachNow() + 0.12;
        const dd = Math.hypot(b.x - hx, b.z - hz), dy = b.y - hy;
        if (dd < (0.56 + 0.08 * n(d.ratings.block)) * DEF_K && dy < 0.15 * DEF_K && dy > -0.9 * DEF_K) {
          d.action.triedBlock = true;
          const shooter = this.players[b.info.shooter];
          // v0.4.3: Perimeter D outside, Interior D and size in the paint
          const pw = S.paintWeight(b.info.d ?? 6), size = Math.max(-0.25, Math.min(0.3, d.phys.H - shooter.phys.H));
          const pb = 0.1 + 0.26 * n(d.ratings.block) + (1 - pw) * 0.06 * n(d.ratings.perimeter_d) + pw * (0.12 * n(d.ratings.interior_d) + size * 0.3) - 0.1 * n(shooter.ratings.three_point) + bk(d.badges, 'rim_protector') * 0.02 - dd * 0.25;
          if (this.rng.next() < pb) { b.info.blocked = true; this.blockBall(d, shooter, false, false); return; }
        }
      }
    }
    // shot becomes rebound-able once it can't score anymore
    const reboundable = kind === 'loose' || (kind === 'shot' && (b.touchedRim || b.touchedBoard || b.floorBounces > 0 || (b.flightTime > 0.5 && b.y < COURT.rimY - 0.3 && b.vy < 0)) && b.scoredFlag === 0);
    if (kind === 'shot' && b.info && !b.info.missed && reboundable && (b.y < COURT.rimY - 0.15 || b.floorBounces > 0) && b.scoredFlag === 0) {
      b.info.missed = true;
      this.emit({ type: 'miss', player: b.info.shooter, team: b.info.team });
      if (this.shotClockReset && !this.half) { this.shotClock = 24; this.shotClockReset = false; }
      if (this.half) this.shotClock = 24;
      if (b.info.foul) { const f = b.info.foul; b.info.foul = null; this.callFoul(this.players[f.fouler], this.players[f.shooter], true, f.three ? 3 : 2); return; }
      if (this.practice) { this.practiceReturn(1.6); return; }
      if (b.info.ft) { this.ftMissed(); return; }
    }
    // pass catches / interceptions
    if (kind === 'pass') {
      const info = b.info;
      const target = this.players[info.to];
      for (const p of this.players) {
        if (p.id === info.from && b.flightTime < 0.35) continue;
        if (p.action?.type === 'stumble') continue;
        const hand = { x: p.x + Math.sin(p.facing) * 0.25, z: p.z + Math.cos(p.facing) * 0.25 };
        const isT = p.id === info.to;
        if (isT && info.type === 'alley' && p.action?.type === 'oop' && p.action.failed) {
          // (qp3) mistimed: within reach of his stretched fingers it comes off his hands and drops, a loose ball for
          // anyone; higher than that it sails over his head (and lands as a loose ball too)
          if (!info.oopFail && Math.hypot(b.x - p.x, b.z - p.z) < 1.0 && b.y <= p.phys.reach + p.y + 0.5) {
            const sp = Math.hypot(b.vx, b.vz) || 1;
            b.vx = b.vx / sp * 1.2 + this.rng.range(-0.8, 0.8); b.vz = b.vz / sp * 1.2 + this.rng.range(-0.8, 0.8); b.vy = -1.2;
            b.kind = 'loose'; info.oopFail = true;
            p.oopQte = null;
            this.emit({ type: 'oopMiss', player: p.id, from: info.from, why: p.action.qte?.result || 'late', over: false });
            return;
          }
          if (!info.oopFail && Math.hypot(b.x - p.action.T.x, b.z - p.action.T.z) < 0.6 && b.y <= p.action.T.y + 0.3) {
            info.oopFail = true; p.oopQte = null;
            this.emit({ type: 'oopMiss', player: p.id, from: info.from, why: p.action.qte?.result || 'late', over: true });
          }
          continue;
        }
        // teammates leave a live pass alone for its receiver (they used to pick off each other's passes)
        if (!isT && p.team === info.team && b.flightTime < (info.eta || 0.5) + 0.3 && b.floorBounces <= (info.type === 'bounce' ? 1 : 0)) continue;
        // the intended receiver turns to the ball, so his hands can be on either side of his body
        const dist = isT ? Math.min(Math.hypot(b.x - hand.x, b.z - hand.z), Math.hypot(b.x - p.x, b.z - p.z) + 0.05) : Math.hypot(b.x - hand.x, b.z - hand.z);
        const r = isT ? 0.9 + (p.phys.WS - 2) * 0.2 : 0.42 + (p.phys.WS - 2) * 0.2;
        if (dist > r) continue;
        if (b.y < 0.25 || b.y > p.reachNow() + 0.15) continue;
        if (p.team !== info.team) {
          if (info.tried.has(p.id)) continue;
          info.tried.add(p.id);
          let pi = 0.05 + 0.2 * n(p.ratings.steal) - 0.15 * n(info.from >= 0 ? this.players[info.from].ratings.pass_accuracy : 80) + bk(p.badges, 'interceptor') * 0.03 - dist * 0.25;
          if (p.handsUp || p.stance === 'defense') pi = (pi + 0.05) * DEF_K; // v0.4.5 lane pressure +3.75%
          // v0.4.4: a hand held out on the side the pass goes by
          if (p.handsSide && (b.x - p.x) * p.handsSide.x + (b.z - p.z) * p.handsSide.z > 0.1) pi += 0.08;
          if (info.type === 'lob' || info.type === 'alley') pi += b.y < p.reachNow() - 0.2 ? 0.1 : -0.15;
          if (this.rng.next() < pi) {
            const passer = this.players[info.from];
            passer.stats.tov++; p.stats.stl++;
            this.emit({ type: 'steal', player: p.id, victim: passer.id, intercept: true });
            this.catchBall(p);
            this.changePossessionTo(p, 'steal');
            return;
          }
          continue;
        }
        if (isT && info.type === 'alley' && p.action?.type === 'oop' && p.airborne) {
          this.catchOop(p);
          return;
        }
        this.catchBall(p);
        if (this.phase === 'inbound') { this.phase = 'live'; this.emit({ type: 'live' }); }
        return;
      }
      // pass sailed out / hit floor and stopped
      if (b.floorBounces > 1 || b.flightTime > 3) { b.kind = 'loose'; }
      if (info.oopFail && (b.floorBounces > 0 || b.touchedRim || b.touchedBoard)) { b.kind = 'loose'; } // (qp3: a lob that got away)
    }
    // rebounds & loose ball recovery
    if (reboundable || kind === 'loose' || kind === 'tip') {
      const cands = [];
      const wasShotBall = kind === 'shot' || (b.info && b.info.shooter != null && !b.info.poke && !b.info.blocked);
      for (const p of this.players) {
        if (p.action?.type === 'stumble' || p.action?.type === 'hang') continue;
        if (b.info && b.info.shooter === p.id && b.flightTime < 0.6) continue;
        if (p.fumbleUntil && this.time < p.fumbleUntil) continue;
        if (this.isOut(p.x, p.z) && !p.airborne) continue;
        const dist = Math.hypot(b.x - p.x, b.z - p.z);
        // v0.4.1: slightly bigger hands-on-ball radius (rebound rating helps), so fewer balls squirt free
        const off = b.info && b.info.team === p.team;
        const rr = n(off ? p.ratings.off_rebound : p.ratings.def_rebound);
        const grabR = (0.62 + rr * 0.08 + Math.max(0, p.phys.WS - 2) * 0.25 + (p.airborne ? 0.14 : 0)) * DEF_K;
        if (dist > grabR) continue;
        if (b.y > p.reachNow() + 0.15) continue;
        if (b.y > 2.2 && b.vy > 0.5) continue;
        if (b.y < 1.1 && dist > 0.85) continue;
        // position beats luck: being closer, airborne at the right time, and sealing an opponent behind you
        let score = this.rng.next() * 0.4 + (1 - dist / grabR) * 1.0 + (p.airborne ? 0.35 : 0) + p.phys.strength * 0.25;
        // v0.4.3: the rebound rating and size weigh more
        score += rr * 1.25 + Math.max(-0.15, Math.min(0.2, (p.phys.H - 1.98) * 0.7)) + bk(p.badges, 'rebound_chaser') * 0.08;
        if (!off && wasShotBall) score += 0.3; // defenders start with inside position
        // box-outs: sealing an opponent behind you is worth more the stronger your Interior D is than his
        let seal = 0;
        for (const q of this.opponents(p)) {
          const dq = Math.hypot(b.x - q.x, b.z - q.z);
          if (Math.hypot(q.x - p.x, q.z - p.z) < 1.4 && dq > dist + 0.2) {
            const edge = (n(p.ratings.interior_d) - n(q.ratings.interior_d)) * 0.8 + (p.phys.strength - q.phys.strength) * 0.5 + (p.phys.H - q.phys.H) * 0.4;
            seal = Math.max(seal, (0.24 + 0.22 * n(p.ratings.interior_d) + Math.max(-0.15, Math.min(0.4, edge))) * DEF_K);
          }
        }
        score += seal;
        // v0.4.7.5: an active box-out pays off at the glass; the man held behind it is late to the ball
        if (p.boxOut) score += 0.3 * p.boxOut.s;
        if (p.boxedOut) score -= 0.45 * p.boxedOut.s;
        cands.push({ p, score });
      }
      if (cands.length) {
        cands.sort((a, c) => c.score - a.score);
        const w = cands[0].p;
        const wasShot = kind === 'shot' || (b.info && b.info.shooter != null && !b.info.poke);
        const offensive = b.info && b.info.team === w.team;
        this.catchBall(w);
        if (wasShot && !(b.info && b.info.ft)) {
          w.stats.reb++; if (offensive) w.stats.oreb++;
          this.emit({ type: 'rebound', player: w.id, offensive });
        } else {
          this.emit({ type: 'recover', player: w.id });
        }
        if (w.team !== this.possession) this.changePossessionTo(w, 'rebound');
        else if (!this.half && offensive) this.shotClock = Math.max(this.shotClock, 14);
        if (this.phase === 'tip' || this.phase === 'inbound') this.phase = 'live';
        return;
      }
    }
  }

  catchBall(p) {
    const b = this.ball;
    if (p.action && p.action.type === 'rebound' && p.action.gotAt == null) p.action.gotAt = p.action.t - (p.action.jumpAt || 0); // (the animator rips it down)
    b.mode = 'held'; b.holder = p.id; b.kind = null;
    b.lastTouch = p.id; b.lastTeam = p.team;
    p.dribble.live = true; p.dribble.used = false;
    this.endMoveChain(p);
    p.heldDist = 0; p.heldT = 0;
    if (!p.action || p.action.type === 'catch' || p.action.type === 'rebound' || p.action.type === 'block') {
      if (!p.airborne) { p.action = null; p.startAction('catch', 0.2, {}); }
    }
    if (this.possession !== p.team) { this.possession = p.team; this.shotClock = 24; }
    if ((this.phase === 'inbound' && p !== this.inbounder) || this.phase === 'tip') { this.phase = 'live'; this.emit({ type: 'live' }); }
    if (this.practice && p.team === 1) this.practiceReturn(0.9);
    if (this.isAI(p)) { const m = this.ai.m(p); m.next = Math.max(m.next, 0.35 + this.rng.range(0, 0.45)); m.plan = null; }
    this.emit({ type: 'catch', player: p.id });
  }

  catchOop(p) {
    const b = this.ball;
    const rim = this.rimFor(p.team);
    p.oopQte = null; // (qp3: the press is done with)
    b.mode = 'held'; b.holder = p.id; b.kind = null;
    b.lastTouch = p.id; b.lastTeam = p.team;
    const canDunk = (p.raw.driving_dunk ?? 50) >= 58 && p.phys.reach + p.y > COURT.rimY + 0.05;
    const passer = this.lastPass ? this.players[this.lastPass.from] : null;
    if (canDunk) {
      p.action = null;
      const a = p.startAction('dunk', 1.4, { takeoff: 0, slam: 0.12, jumped: true, style: this.rng.next() < 0.5 ? 'power' : 'onehand', side: this.sideFor(p.team), tUp: 0.2, spotX: p.x, spotZ: p.z, gatherSpeed: 0 });
      this.pendingOop = true;
      this.emit({ type: 'oopCatch', player: p.id });
      // mark for scoring info
      a.oop = true;
    } else {
      p.action = null;
      const a = p.startAction('layup', 0.5, { takeoff: 0, release: 0.1, tRel: 0.1, untimed: true, jumped: true, jumpH: 0, spotX: p.x, spotZ: p.z, gatherSpeed: 0, side: this.sideFor(p.team) });
      a.oop = true;
      this.emit({ type: 'oopCatch', player: p.id });
    }
  }

  // v0.4.7.5 qp3: the human's alley-oop press. btn: 0..3 (pass / bounce / shoot / lob). Resolved once per lob.
  oopInput(p, btn) {
    const q = p.oopQte;
    if (!q || q.result) return null;
    const t = this.time - q.t0;
    q.at = t;
    q.result = btn !== q.btn ? 'wrong' : t < q.open ? 'early' : t > q.close ? 'late' : 'hit';
    this.emit({ type: 'oopQte', player: p.id, result: q.result, t: +t.toFixed(2) });
    return q.result;
  }

  // ---------- collisions ----------
  // v0.4.3: how hard a player is to move off his spot by opponent q. Boxing out (back to him, ball in the air)
  // scales with Interior D and rebounding plus the Interior D edge; defenders in the paint anchor with Interior D.
  // v0.4.7.5 box-outs: with a shot (or a loose ball) up, a player who has an opponent sealed behind him (between that
  // man and the rim, bodies touching) physically holds him there. The man's way to the rim is mostly shut (how much
  // depends on Interior D, rebounding, strength and size, both ways) and he's eased back off the paint, his sideways
  // slide to get round is slowed too, and the boxer wins the scramble for the board more often. Both are flagged
  // (boxOut / boxedOut) so the animator can show it: the boxer low and wide with his arms out, the man held off.
  boxOuts(dt) {
    const b = this.ball;
    for (const p of this.players) { if (p.boxOut) p.boxOutPrev = p.boxOut.on; else p.boxOutPrev = null; p.boxOut = null; p.boxedOut = null; }
    const up = b.mode === 'flight' && ((b.kind === 'shot' && b.flightTime > 0.2) || b.kind === 'loose') && (b.y > 1.2 || b.vy > 0);
    if (!up || this.phase === 'dead') return;
    const shooterTeam = b.info?.team ?? this.possession;
    const rim = rimOf(b.info?.side ?? this.sideFor(shooterTeam));
    const busy = q => q.airborne || ['stumble', 'shoot', 'layup', 'dunk', 'hang', 'celebrate'].includes(q.action?.type);
    for (const p of this.players) {
      if (busy(p) || (b.info && b.info.shooter === p.id)) continue;
      const rx = p.x - rim.x, rz = p.z - rim.z, rl = Math.hypot(rx, rz);
      if (rl > 6.5 || rl < 0.5) continue;
      const ux = rx / rl, uz = rz / rl;
      let best = null, bs = 0;
      for (const q of this.opponents(p)) {
        if (busy(q) || q.boxedOut) continue;
        const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
        if (d > p.phys.radius + q.phys.radius + 0.28 || d < 1e-4) continue;
        if ((dx * ux + dz * uz) / d < 0.5) continue; // he has to be behind, on the far side from the rim
        const own = r => n(r.ratings[r.team === shooterTeam ? 'off_rebound' : 'def_rebound']);
        const edge = 0.35 * (n(p.ratings.interior_d) - n(q.ratings.interior_d)) + 0.3 * (own(p) - own(q)) + 0.6 * (p.phys.strength - q.phys.strength)
          + 0.4 * (p.phys.H - q.phys.H) + 0.06 * bk(p.badges, 'brick_wall') + 0.04 * bk(p.badges, 'rebound_chaser');
        const sv = Math.max(0.2, Math.min(0.95, (0.62 + edge + (p.team !== shooterTeam ? 0.08 : 0)) * DEF_K));
        if (sv > bs) { bs = sv; best = q; }
      }
      if (!best) continue;
      const q = best;
      p.boxOut = { on: q.id, s: bs }; q.boxedOut = { by: p.id, s: bs };
      // his way to the rim (−u) is shut by s; the slide round him slowed; and he's eased back off the paint
      const toward = -(q.vx * ux + q.vz * uz);
      if (toward > 0) { q.vx += ux * toward * bs; q.vz += uz * toward * bs; q.x += ux * toward * bs * dt; q.z += uz * toward * bs * dt; }
      const lat = q.vx * -uz + q.vz * ux;
      q.vx -= -uz * lat * bs * 0.45; q.vz -= ux * lat * bs * 0.45;
      const push = 0.45 * bs * dt;
      q.x += ux * push; q.z += uz * push;
      // the boxer sits into him: he holds his ground (no drifting under the rim or out)
      p.vx *= 1 - Math.min(1, dt * 6); p.vz *= 1 - Math.min(1, dt * 6);
      if (p.boxOutPrev !== q.id) this.emit({ type: 'boxout', player: p.id, victim: q.id, s: bs });
    }
  }

  // v0.4.7.5 quick patch 3: screens.
  // A set offensive player without the ball is a screener. When a defender runs into him the screen's quality
  // (screenQuality, 0..1) comes from how hard he ran into it, how set and square the screener was, whether the
  // screen was called, the size of both men (mass from weight and strength, plus height), the Strength ratings and
  // Brick Wall on either side. The quality decides how much of the defender's speed the screen takes, how long he
  // is slowed (bumpT), whether he is stopped outright (a short shoved-back stumble, lock 1) and, for a screener with
  // Brick Wall, whether a perfect screen puts him on the floor.
  isSetScreener(s, h) {
    return s.team === this.possession && s !== h && s.speed < 0.8 && !s.airborne && !['shoot', 'layup', 'dunk', 'land', 'celebrate', 'stumble', 'bump'].includes(s.action?.type);
  }
  screenAnchor(s) { return 1 + 0.9 * s.phys.strength + 0.3 * bk(s.badges, 'brick_wall') + (s.screening > 0 ? 0.4 : 0); }
  screenQuality(s, d, approach) {
    const ms = s.phys.W * (0.7 + 0.6 * s.phys.strength), md = d.phys.W * (0.7 + 0.6 * d.phys.strength);
    const size = (ms - md) / (ms + md) * 1.6 + 0.35 * (s.phys.H - d.phys.H); // both men: weight, strength and height
    const str = n(s.ratings.strength) - n(d.ratings.strength);
    const bw = bk(s.badges, 'brick_wall'), dbw = bk(d.badges, 'brick_wall');
    const set = s.speed < 0.3 ? 1 : Math.max(0, 1 - (s.speed - 0.3) / 0.5); // planted, or still settling
    const ax = d.x - s.x, az = d.z - s.z, al = Math.hypot(ax, az) || 1;
    const face = Math.max(0, (ax * Math.sin(s.facing) + az * Math.cos(s.facing)) / al); // chest to the defender
    const called = s.screening > 0 ? 1 : 0;
    const spd = Math.min(1, Math.max(0, (approach - 0.8) / 2.7)); // a walk into it 0, a hard run (3.5 m/s) 1
    const q = SCREEN.base + SCREEN.spd * spd + SCREEN.set * set + SCREEN.face * face + SCREEN.called * called
      + SCREEN.size * size + SCREEN.str * str + SCREEN.bw * bw - SCREEN.dbw * dbw;
    return { q: Math.max(0, Math.min(1, q)), bw, dbw, size, str, set, face, spd, called };
  }
  screenHit(s, d, closing = null) {
    const ux = (s.x - d.x), uz = (s.z - d.z), ul = Math.hypot(ux, uz) || 1, nx = ux / ul, nz = uz / ul;
    // (collide() passes the closing speed from before its own velocity exchange; that is how hard he ran into it)
    const approach = Math.max(0, closing != null ? closing : (d.vx - s.vx) * nx + (d.vz - s.vz) * nz);
    const r = this.screenQuality(s, d, approach);
    // A real screen is one that was called (the screener set it on purpose) or set square to the defender near
    // the ball. Anything else (a defender brushing past a man standing in the corner) is incidental: it costs a
    // little speed and a stagger, never a stop or a knockdown, and it isn't a screen for the Lock-In grade.
    const h = this.holder();
    let onBall = false; // the defender was going for the ball handler (closing out on the screener himself isn't a screen)
    if (h && h !== s && h.dist(s) < 3.5) {
      const hx = h.x - d.x, hz = h.z - d.z, hl = Math.hypot(hx, hz) || 1, dl = d.speed || 1;
      const aim = (d.vx * hx + d.vz * hz) / (hl * dl);
      const nearest = this.opponents(h).reduce((a, q) => (!a || q.dist(h) < a.dist(h) ? q : a), null);
      onBall = aim > 0.5 || nearest === d;
    }
    const incidental = !(s.screening > 0 || (r.face > 0.5 && onBall));
    const q = incidental ? Math.min(r.q, SCREEN.stunQ - 0.01) * 0.7 : r.q;
    const busy = d.airborne || ['block', 'rebound', 'tipjump', 'steal', 'shoot', 'layup', 'dunk', 'hang', 'stumble', 'oop'].includes(d.action?.type);
    // the screen takes speed: a glancing one a third of it, a perfect one all of it
    const keep = 1 - (SCREEN.stop0 + (1 - SCREEN.stop0) * q);
    d.vx *= keep; d.vz *= keep;
    d.bumpT = SCREEN.slow0 + SCREEN.slow1 * q;
    s.vx *= 0.3; s.vz *= 0.3; // the screener holds
    s.spend(COST.screen); d.spend(COST.screen * 0.75); // (v0.4.5: screens cost stamina, both ways)
    let knock = false, stun = false;
    const fallQ = SCREEN.fallQ0 - SCREEN.fallQk * r.bw + SCREEN.fallQd * r.dbw; // (his own Brick Wall keeps him up)
    if (!busy && !incidental && r.bw > 0 && q >= fallQ && approach >= SCREEN.fallV) {
      // Brick Wall's perfect screen: the defender goes down and has to get up before he can recover
      knock = true;
      d.action = null;
      d.startAction('stumble', SCREEN.fall0 + SCREEN.fallk * r.bw + this.rng.range(0, 0.4), { fall: true, back: true, screen: true, dir: this.rng.next() < 0.5 ? 1 : -1, hard: s.badges.brick_wall || 0 });
      d.vx = -nx * 1.1; d.vz = -nz * 1.1; // (knocked back off the screen)
      d.bumpT = Math.max(d.bumpT, 0.9);
    } else if (!busy && q >= SCREEN.stunQ && (!d.action || d.action.type === 'bump' || d.action.type === 'catch')) {
      // stopped dead: shoved back, feet stuck for a moment
      stun = true;
      d.action = null;
      d.startAction('stumble', SCREEN.stun0 + SCREEN.stun1 * (q - SCREEN.stunQ) / (1 - SCREEN.stunQ), { fall: false, back: true, screen: true, dir: 1 });
      d.vx = -nx * 0.4; d.vz = -nz * 0.4;
    } else if (!busy && !d.action) {
      d.startAction('bump', 0.3, {}); // (a stagger)
    }
    this.emit({ type: 'screen', player: s.id, victim: d.id, q: +q.toFixed(2), v: +approach.toFixed(2), knock, stun, called: !!r.called, incidental });
    if (!incidental && r.bw) this.badgeFx(s, 'brick_wall');
    if (!incidental && r.dbw) this.badgeFx(d, 'brick_wall');
    return { q, knock, stun, incidental };
  }

  anchorK(p, q) {
    const b = this.ball;
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    const behind = (q.x - p.x) * fx + (q.z - p.z) * fz < -0.1;
    if (b.mode === 'flight' && (b.kind === 'shot' || b.kind === 'loose') && behind) {
      const rr = n(b.info && b.info.team === p.team ? p.ratings.off_rebound : p.ratings.def_rebound);
      return 1 + 0.7 * n(p.ratings.interior_d) + 0.3 * rr + 0.6 * Math.max(0, n(p.ratings.interior_d) - n(q.ratings.interior_d));
    }
    if (p.team !== this.possession) {
      const rim = this.rimFor(q.team), pw = S.paintWeight(Math.hypot(p.x - rim.x, p.z - rim.z));
      if (pw > 0) return 1 + pw * (0.55 * n(p.ratings.interior_d) + 0.4 * Math.max(0, n(p.ratings.interior_d) - n(q.ratings.strength)));
    }
    return 1;
  }

  collide(dt) {
    const ps = this.players;
    const h = this.holder();
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      if (a.action?.type === 'hang' || c.action?.type === 'hang') continue;
      // v0.4.5: no passing through bodies. A dunker who beats the contact shoves the defender out of his path
      // (velocity), so the two are kept apart here like everyone else
      const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
      const r = a.phys.radius + c.phys.radius;
      if (d >= r || d < 1e-5) continue;
      if (Math.abs(a.y - c.y) > 1.2) continue;
      const nx = dx / d, nz = dz / d, pen = r - d;
      let ma = a.phys.W * (0.7 + 0.6 * a.phys.strength), mc = c.phys.W * (0.7 + 0.6 * c.phys.strength);
      if (a.team !== c.team) { ma *= this.anchorK(a, c); mc *= this.anchorK(c, a); }
      // v0.4.7.5 qp3: a set screener holds his ground (strength and Brick Wall), so the defender bounces off him
      // instead of pushing him off the spot
      if (a.team !== c.team) { if (this.isSetScreener(a, h)) ma *= this.screenAnchor(a); if (this.isSetScreener(c, h)) mc *= this.screenAnchor(c); }
      const ka = mc / (ma + mc), kc = ma / (ma + mc);
      a.x -= nx * pen * ka; a.z -= nz * pen * ka;
      c.x += nx * pen * kc; c.z += nz * pen * kc;
      const rv = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
      if (rv < 0) {
        a.vx += nx * rv * ka * 0.9; a.vz += nz * rv * ka * 0.9;
        c.vx -= nx * rv * kc * 0.9; c.vz -= nz * rv * kc * 0.9;
      }
      if (a.team !== c.team && this.phase === 'live') {
        // ball handler driving into a defender → bump
        const handler = h === a ? a : h === c ? c : null;
        if (handler && -rv > 1.6 && handler.bumpT <= 0) {
          const def = handler === a ? c : a;
          handler.bumpT = 0.4; def.bumpT = 0.15;
          const set = def.speed < 1.2 ? DEF_K : 1; // v0.4.5: waiting in the lane for the drive stops it 3.75% harder
          handler.vx *= 0.5 / set; handler.vz *= 0.5 / set;
          if (!handler.action) handler.startAction('bump', 0.32, {});
          this.emit({ type: 'bump', player: handler.id, defender: def.id, v: -rv });
          // v0.4.4: Brick Wall on bumps is a defensive badge: the defender stops the drive harder
          if (def.badges.brick_wall) { const k = bk(def.badges, 'brick_wall'); handler.bumpT += 0.06 * k; handler.vx *= Math.max(0.3, 1 - 0.08 * k); handler.vz *= Math.max(0.3, 1 - 0.08 * k); this.badgeFx(def, 'brick_wall'); }
          const pwB = S.paintWeight(Math.hypot(def.x - this.rimFor(handler.team).x, def.z - this.rimFor(handler.team).z));
          const strip = (0.012 + Math.max(0, def.phys.strength - handler.phys.strength) * 0.08 - n(handler.ratings.ball_handle) * 0.02 + bk(def.badges, 'brick_wall') * 0.015) * (1 - 0.5 * pwB) * set;
          if (this.ball.mode === 'dribble' && this.rng.next() < strip) {
            handler.stats.tov++; def.stats.stl++;
            const b = this.ball;
            this.pokeOut(def, handler);
            this.emit({ type: 'steal', player: def.id, victim: handler.id, bump: true });
          } else if (this.mode === 'proam' && def.speed > 2.5 && this.rng.next() < 0.18) {
            this.callFoul(def, handler, false);
          }
        }
        // screens: a stationary offensive player without the ball slows a defender running into him. Contact
        // while a shot is up (or from the shooter himself) is not a screen.
        const shotUp = this.ball.mode === 'flight' && this.ball.kind === 'shot';
        for (const [s, d2] of [[a, c], [c, a]]) {
          if (this.isSetScreener(s, h) && d2.team !== this.possession && d2.bumpT <= 0) {
            if (shotUp || (this.ball.info && this.ball.info.shooter === s.id)) continue;
            if (d2.speed < 1.0 && -rv < 1.0) continue; // he has to be moving into it
            if (d2.screened && d2.screened.id === s.id && this.time - d2.screened.t < 1.5) continue; // (one screen, one hit)
            d2.screened = { id: s.id, t: this.time };
            this.screenHit(s, d2, -rv);
          }
        }
      }
    }
    this.settleBodies();
  }

  // v0.4.5: the ball has a body too: a dribble (or a ball held out in front) can't go through anybody's legs or
  // chest. The handler and whoever he's leaning on are moved apart, weighted by size and strength like any other
  // contact. Then two more position-only passes over the bodies, so a crowd (a drive into help, a scrum for a
  // rebound) doesn't leave anyone half inside someone else.
  settleBodies() {
    const ps = this.players, mass = p => p.phys.W * (0.7 + 0.6 * p.phys.strength);
    const h = this.holder(), b = this.ball;
    if (h && (b.mode === 'dribble' || b.mode === 'held') && h.action?.type !== 'hang') {
      const bp = this.holdPoint(h, this._ballProbe || (this._ballProbe = {}));
      for (const q of ps) {
        if (q === h || q.action?.type === 'hang' || Math.abs(q.y - h.y) > 1.2 || bp.y > q.y + q.phys.H * 0.95) continue;
        const dx = bp.x - q.x, dz = bp.z - q.z, d = Math.hypot(dx, dz), r = q.phys.radius + BALL_R * 0.9;
        if (d >= r || d < 1e-5) continue;
        let mh = mass(h), mq = mass(q);
        if (q.team !== h.team) { mh *= this.anchorK(h, q); mq *= this.anchorK(q, h); }
        const pen = r - d, nx = dx / d, nz = dz / d, kh = mq / (mh + mq), kq = 1 - kh;
        h.x += nx * pen * kh; h.z += nz * pen * kh;
        q.x -= nx * pen * kq; q.z -= nz * pen * kq;
        // no more closing speed into the ball
        const rv = (h.vx - q.vx) * nx + (h.vz - q.vz) * nz;
        if (rv < 0) { h.vx -= nx * rv * kh; h.vz -= nz * rv * kh; q.vx += nx * rv * kq; q.vz += nz * rv * kq; }
      }
    }
    // (after the ball, so nobody it moved is left inside someone else)
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        if (a.action?.type === 'hang' || c.action?.type === 'hang' || Math.abs(a.y - c.y) > 1.2) continue;
        const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz), r = a.phys.radius + c.phys.radius;
        if (d >= r || d < 1e-5) continue;
        let ma = mass(a), mc = mass(c);
        if (a.team !== c.team) { ma *= this.anchorK(a, c); mc *= this.anchorK(c, a); }
        const pen = r - d, ka = mc / (ma + mc), kc = 1 - ka;
        a.x -= dx / d * pen * ka; a.z -= dz / d * pen * ka;
        c.x += dx / d * pen * kc; c.z += dz / d * pen * kc;
      }
    }
  }

  // ---------- rules ----------
  rules(dt) {
    const b = this.ball;
    if (this.phase === 'live') {
      // clocks
      if (!this.practice) {
        if (b.holder >= 0 || (b.mode === 'flight' && b.kind === 'pass')) this.shotClock -= dt / this.speed;
        if (this.mode === 'proam') this.gameClock -= dt / this.speed;
      }
      // clear the ball (take it back)
      const h = this.holder();
      if (h && this.needsClear[h.team] && isThree(h.x, h.z, this.sideFor(h.team))) { this.needsClear[h.team] = false; this.emit({ type: 'cleared', team: h.team }); }
      // v0.4.5 traveling (every mode): after the gather (about two steps), moving with a held ball that isn't
      // being dribbled is a travel
      if (h && b.mode === 'held' && !h.airborne && !this.practice) {
        const act = h.action?.type;
        if (!act || act === 'catch' || act === 'pumpfake' || act === 'bump') {
          h.heldT = (h.heldT || 0) + dt / this.speed;
          if (h.heldT > 0.45) h.heldDist = (h.heldDist || 0) + Math.hypot(h.x - h.prevX, h.z - h.prevZ);
          if (h.heldDist > 0.9) { h.heldT = 0; h.heldDist = 0; this.emit({ type: 'violation', what: 'Traveling', player: h.id }); this.turnover(h, 'Traveling'); return; }
        }
      } else if (h) { h.heldT = 0; h.heldDist = 0; }
      // out of bounds (v0.4.5, on the painted lines): the ball handler with a foot on or over a line, or a
      // dribble that comes down on or over one
      if (h && !h.airborne && feetOut(h.x, h.z, this.half)) { this.turnover(h, 'Out of bounds'); return; }
      if (h && this.dribbleOut === h.id) { this.dribbleOut = null; this.turnover(h, 'Out of bounds'); return; }
      this.dribbleOut = null;
      // a loose, passed or shot ball that touches the floor on or past a line
      if (b.mode === 'flight' && b.y < BALL_R + 0.02 && ballOut(b.x, b.z, this.half)) { this.ballOutOfBounds('Out of bounds'); return; }
      // over the top of a backboard, either way
      if (b.mode === 'flight' && this.overBackboard(b)) { this.ballOutOfBounds('Over the backboard'); return; }
      if (!this.practice && this.shotClock <= 0 && !(b.mode === 'flight' && b.kind === 'shot')) {
        this.emit({ type: 'violation', what: 'Shot clock' });
        this.feedMsg('Shot clock violation');
        const team = 1 - this.possession;
        if (h) h.stats.tov++;
        this.deadBall(1.3, () => this.restartFor(team, h ? h.x : 0, h ? h.z : 0));
        return;
      }
      if (this.mode === 'proam' && this.gameClock <= 0) {
        this.gameClock = 0;
        if (!(b.mode === 'flight' && b.kind === 'shot' && !b.info.missed && b.info.released <= this.time)) this.endPeriod();
      }
    }
    if (this.mode === 'proam' && this.phase !== 'live' && this.phase !== 'dead' && this.gameClock <= 0 && this.phase !== 'ft') this.endPeriod();
  }

  isOut(x, z) { return feetOut(x, z, this.half); }
  ballOutOfBounds(msg) {
    const b = this.ball;
    const team = 1 - (b.lastTeam >= 0 ? b.lastTeam : this.possession);
    // a shot that goes out is still a miss for the shooter's line (it already counted as an attempt)
    this.emit({ type: 'oob' });
    this.feedMsg(msg);
    this.deadBall(1.2, () => this.restartFor(team, b.x, b.z));
  }
  // the ball crossing the plane of a backboard above its top edge (and within its width)
  overBackboard(b) {
    if (b.px == null) return false;
    for (const s of this.half ? [1] : [1, -1]) {
      const plane = s * (COURT.boardZ + COURT.boardT / 2), before = (b.pz - plane) * s, after = (b.z - plane) * s;
      if ((before < 0) === (after < 0)) continue;
      if (b.y - BALL_R > COURT.boardBottom + COURT.boardH && Math.abs(b.x) < COURT.boardW / 2 + BALL_R) return true;
    }
    return false;
  }

  restartFor(team, x, z) {
    if (this.over) return;
    if (this.half || this.practice) { if (this.practice) this.practiceReturn(0.2); else this.startCheck(team); return; }
    // sideline inbound at nearest point
    const sx = Math.sign(x || 1) * (COURT.width / 2 + 0.45);
    const sz = Math.max(-COURT.length / 2 + 2, Math.min(COURT.length / 2 - 2, z));
    this.startInbound(team, { x: sx, z: sz }, 'sideline', 1.2);
  }

  turnover(p, why) {
    p.stats.tov++;
    this.emit({ type: 'turnover', player: p.id, why });
    this.feedMsg(why);
    const team = 1 - p.team;
    const x = p.x, z = p.z;
    this.deadBall(1.3, () => this.restartFor(team, x, z));
  }

  callFoul(fouler, victim, shooting, shots = 0) {
    if (this.mode !== 'proam' || this.over) return;
    fouler.stats.pf++;
    this.teamFouls[fouler.team]++;
    this.emit({ type: 'foul', player: fouler.id, victim: victim.id, shooting });
    this.feedMsg(`Foul on ${fouler.name}${shooting ? ' (shooting)' : ''}`);
    const b = this.ball;
    if (b.holder >= 0) { b.holder = -1; }
    b.mode = 'dead';
    if (shooting) { this.deadBall(1.3, () => this.startFT(victim, shots)); return; }
    if (this.teamFouls[fouler.team] >= 5) { this.deadBall(1.3, () => this.startFT(victim, 2)); return; }
    const vx = victim.x, vz = victim.z;
    this.deadBall(1.3, () => this.restartFor(victim.team, vx, vz));
  }

  startFT(shooter, count) {
    const side = this.sideFor(shooter.team);
    const rim = rimOf(side);
    const ftz = rim.z - side * 4.19;
    this.phase = 'ft';
    this.ftState = { shooter: shooter.id, count, idx: 0, made: 0, side, wait: 1.1 };
    // lane positions
    const lane = [[2.6, 2.1], [-2.6, 2.1], [2.6, 3.0], [-2.6, 3.0], [2.6, 3.9], [-2.6, 3.9], [3.6, 6.5], [-3.6, 6.5]];
    let k = 0;
    for (const p of this.players) {
      p.action = null; p.vx = p.vz = 0;
      if (p === shooter) { p.setPos(0, ftz, side > 0 ? 0 : Math.PI); continue; }
      const L = lane[k++ % lane.length];
      p.setPos(L[0], rim.z - side * L[1], Math.atan2(-L[0], side * L[1]) + 0);
      p.facing = Math.atan2(rim.x - p.x, rim.z - p.z);
    }
    this.giveBall(shooter, 'held');
    shooter.dribble.used = true;
    this.emit({ type: 'ftStart', player: shooter.id, count });
  }

  updateFT(dt) {
    const f = this.ftState;
    if (!f) return;
    const p = this.players[f.shooter];
    for (const q of this.players) { q.intent.mx = 0; q.intent.mz = 0; q.intent.move = null; q.intent.steal = false; q.intent.pass = null; }
    const b = this.ball;
    if (b.holder === p.id && !p.action) {
      f.wait -= dt;
      if (f.wait <= 0 && (this.isAI(p) || p.intent.shoot === 'press' || f.wait < -6)) {
        const tRel = 0.62;
        const a = p.startAction('ftshot', 1.4, { tRel, t0: 0 });
        a.t = 0;
        if (this.isAI(p)) { const r = this.ai.releaseTiming(p, tRel, true); a.releaseAt = r.at; a.aiGrade = r.grade; }
        this.emit({ type: 'shotStart', player: p.id, tRel, kind: 'ft' });
      }
    }
    const a = p.action;
    if (a && a.type === 'ftshot') {
      if (!a.released) {
        if (p.human && !this.assist && a.releaseAt == null && (p.intent.shoot === 'release' || !p.intent.shootHeld)) a.releaseAt = a.t;
        if (p.human && !this.assist && a.releaseAt == null && a.t > a.tRel + 0.35) a.releaseAt = a.t;
        if (a.releaseAt != null && a.t >= a.releaseAt) {
          a.released = true;
          const W = this.ftWindow(p), win = W.total;
          const grade = a.aiGrade && this.isAI(p) ? a.aiGrade : S.gradeFromWindow(a.releaseAt - a.tRel, win);
          let chance = S.finalChance({ type: 'ft', d: 4.19, a: p.ratings, grade, stamina: p.stamina, badges: p.badges, clutch: this.isClutch(p.team) });
          if (grade === 'excellent') chance = 1;
          const made = grade === 'excellent' || this.rng.next() < chance;
          const P = this.holdPoint(p);
          const rim = rimOf(f.side);
          const plan = S.planShot(this.rng, P, rim, f.side, made, 54, { halfOnly: this.half, surface: b.surface, swish: grade === 'excellent', guarantee: grade === 'excellent' });
          b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, 'shot', { shooter: p.id, team: p.team, ft: true, type: 'ft', made: plan.made, grade, chance, side: f.side, released: this.time });
          b.wx = plan.wx; b.wz = plan.wz; b.ghost = !!plan.ghost;
          p.stats.fta++;
          this.emit({ type: 'release', player: p.id, grade, chance, contest: 0, three: false, made: plan.made, kind: 'ft', err: a.releaseAt - a.tRel, tRel: a.tRel, win, nat: W.natural, sure: W.sure });
          this.phase = 'ftflight';
          this.phaseFlightGuard = true;
        }
      }
      if (a.t >= a.dur) p.action = null;
    }
  }

  ftMade() {
    const f = this.ftState;
    f.idx++; f.made++;
    if (f.idx < f.count) { this.phase = 'ft'; f.wait = 1.0; this.giveBall(this.players[f.shooter], 'held'); this.players[f.shooter].dribble.used = true; this.players[f.shooter].action = null; return; }
    const shooter = this.players[f.shooter];
    this.ftState = null;
    const inbTeam = 1 - shooter.team;
    const bz = this.attackDir[shooter.team] * (COURT.length / 2 + 0.45);
    this.deadBall(1.3, () => this.startInbound(inbTeam, { x: this.rng.range(-1.2, 1.2), z: bz }, 'baseline'));
  }
  ftMissed() {
    const f = this.ftState;
    f.idx++;
    if (f.idx < f.count) {
      this.deadBall(1.0, () => { this.phase = 'ft'; f.wait = 0.8; this.giveBall(this.players[f.shooter], 'held'); this.players[f.shooter].dribble.used = true; });
      return;
    }
    // last free throw missed: live rebound
    this.ftState = null;
    this.phase = 'live';
    this.ball.info.ft = false;
    this.ball.kind = 'loose';
  }

  isClutch(team) {
    if (this.mode === 'park') return Math.max(...this.score) >= this.target - 3;
    return this.quarter >= this.quarters && this.gameClock < 60 && Math.abs(this.score[0] - this.score[1]) <= 5;
  }

  endPeriod() {
    if (this.over || this.phase === 'quarterBreak') return;
    this.emit({ type: 'buzzer', quarter: this.quarter });
    if (this.quarter >= this.quarters && this.score[0] !== this.score[1]) { this.finish(this.score[0] > this.score[1] ? 0 : 1); return; }
    this.phase = 'quarterBreak';
    const q = this.quarter;
    this.deadBall(2.5, () => {
      this.quarter++;
      const ot = this.quarter > this.quarters;
      this.gameClock = ot ? 120 : this.quarterLen;
      this.teamFouls = [0, 0];
      if (this.quarter === Math.floor(this.quarters / 2) + 1 && !ot) this.attackDir = [-this.attackDir[0], -this.attackDir[1]];
      const team = (this.firstPossession + q) % 2;
      const bz = -this.attackDir[team] * (COURT.length / 2 + 0.45);
      this.startInbound(team, { x: 0, z: bz * 0 + -this.attackDir[team] * 1, }, 'sideline', 1.6);
      // inbound from midcourt sideline
      this.inbounder.setPos(COURT.width / 2 + 0.45, 0, -Math.PI / 2);
      this.giveBall(this.inbounder, 'held');
      this.emit({ type: 'period', quarter: this.quarter });
    });
    this.phase = 'dead';
  }

  checkGameOver() {
    if (this.mode === 'park') {
      const [a, c] = this.score;
      const lead = Math.abs(a - c);
      if (Math.max(a, c) >= this.target && (!this.winBy2 || lead >= 2)) { this.finish(a > c ? 0 : 1); return true; }
    }
    return false;
  }

  finish(winner) {
    this.over = true; this.winner = winner;
    this.phase = 'over';
    const b = this.ball;
    if (b.holder >= 0) { b.holder = -1; b.mode = 'dead'; }
    this.emit({ type: 'gameOver', winner, score: [...this.score] });
  }

  practiceReturn(delay) {
    this.phase = 'dead'; this.phaseT = delay;
    this.after = () => {
      const p = this.teams[0][0];
      const rim = this.rimFor(0);
      const b = this.ball;
      const from = { x: rim.x + this.rng.range(-1, 1), y: 1.2, z: rim.z - 0.8 };
      const T = { x: p.x, y: 1.25, z: p.z };
      const d = Math.hypot(T.x - from.x, T.z - from.z), t = Math.max(0.4, d / 9);
      b.setFlight(from.x, from.y, from.z, (T.x - from.x) / t, (T.y - from.y + 0.5 * GRAVITY * t * t) / t, (T.z - from.z) / t, 'pass', { from: -1, to: p.id, team: 0, type: 'chest', time: this.time, tried: new Set() });
      this.phase = 'live';
    };
  }

  feedMsg(text) { this.emit({ type: 'feed', text }); }

  // Result summary for the backend
  summary() {
    const me = this.human;
    return {
      mode: this.mode, score: [...this.score], winner: this.winner, duration: Math.round(this.time / this.speed),
      quarter: this.quarter,
      players: this.players.map(p => ({ id: p.id, team: p.team, name: p.name, human: p.human, stats: { ...p.stats } })),
      me: me ? { team: me.team, stats: { ...me.stats } } : null,
    };
  }
}

function posRank(pos) { return { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 }[pos] ?? 2; }
