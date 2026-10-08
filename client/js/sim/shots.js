// Shot model: classification, timing windows, make probability, physically-solved trajectories.
import { COURT, BALL_R, GRAVITY, isThree } from './constants.js';
import { Ball, cloneBall, predictShot } from './ball.js';

import { rk as n, rkRaw, proficient, SUB70_K } from './ratings.js';
import { bk, tierTable } from './badges.js';
// v0.4.5 badge tables: each tier step is 10% bigger than the one before
const DEADEYE_WIN = tierTable([0, 0.15, 0.25, 0.35, 0.45]);
const DEADEYE_CON = tierTable([0, 0.2, 0.35, 0.5, 0.6]);
const FINISHER_CON = tierTable([0, 0.15, 0.25, 0.35, 0.45]);

export const GRADE = {
  excellent: { label: 'Excellent Release', color: '#36e07a' },
  early: { label: 'Slightly Early', color: '#f7c948' },
  late: { label: 'Slightly Late', color: '#f7c948' },
  vearly: { label: 'Very Early', color: '#ff6b57' },
  vlate: { label: 'Very Late', color: '#ff6b57' },
  none: { label: '', color: '#ffffff' },
};

// Jumpshot timing package from equipment
// v0.4.3: each base has its own rhythm and window: Quick Flick is fastest, the high-set bases release higher
// but are a touch slower and tighter, the Push Shot is the most forgiving, the Lean Back the tightest.
export const BASE_FEEL = {
  standard: { speed: 1, win: 1 }, high: { speed: 1.03, win: 0.97 }, flick: { speed: 0.94, win: 1 },
  push: { speed: 0.98, win: 1.07 }, lean: { speed: 1.02, win: 0.95 },
  // v0.4.4
  kick: { speed: 1.0, win: 1.0 }, wide: { speed: 1.02, win: 1.04 }, sniper: { speed: 0.93, win: 1.04 },
  // v0.4.5 bases
  fade: { speed: 1.04, win: 0.94 }, hitch: { speed: 1.08, win: 1.06 }, sling: { speed: 0.9, win: 0.96 },
  scissor: { speed: 1.01, win: 1.02 }, tuck: { speed: 1.03, win: 1.03 }, sway: { speed: 0.97, win: 1.05 },
  // v0.4.5 stage 7: Silk has its own base now (it used to share the Skyline's), with the same feel it always had
  silk: { speed: 1.03, win: 0.97 },
};
export function jumpshotPackage(build, catalog) {
  const eq = build.equipment || {};
  const base = catalog?.[eq.jumpshot] || null;
  const rel = catalog?.[eq.release] || null;
  const relSec = rel?.release_seconds ?? 0.72;
  const style = base?.style || 'standard', feel = BASE_FEEL[style] || BASE_FEEL.standard;
  const setH = base?.set_height ?? 1.05;
  return {
    tRel: (0.36 + relSec * 0.36) * feel.speed, // seconds from shot start to ideal release
    arc: rel?.arc ?? (relSec < 0.65 ? 49 : relSec > 0.8 ? 56 : 52),
    setH, // ×H
    push: base?.push ?? 0.1,
    jumpK: base?.jump ?? 0.75,
    relK: 0.93 + (setH - 1.05) * 0.3, // release height ×reach: high-set bases let it go higher
    winK: feel.win,
    style,
    release: (rel?.id || 'release_classic').replace(/^(wheel_)?release_/, ''),
    hand: build.hand || 'R',
  };
}

// v0.4.4: the timing window follows the rating curve, so a weak shooter's green window is tiny (about 22 ms
// at 50 and 32 ms at 60), the 70-95 range climbs steadily, and a 99 gets a huge window (about 100 ms)
export function timingWindowMs(attr, badges = {}) {
  return 14 + 52 * Math.pow(rkRaw(attr), 1.25) + ((attr ?? 0) >= 99 ? 16 : 0) + bk(badges, 'green_machine') * 5;
}
// v0.4.5 quick patch: a shooting stat under 70 isn't proficient: that shot's green window is 10% smaller
const profK = attr => (proficient(attr) ? 1 : SUB70_K);

// v0.4: an Excellent ("green") release always goes in unless the shot is blocked. Difficulty therefore
// shrinks the green window instead of lowering the make chance of a green: a smothering contest, shooting
// on the move, fading, or pulling up from deep all make the green harder to hit (the meter shows it live).
// ctx: {contest 0..1.25, moving m/s, fade, d (m to rim), three, ft}
// v0.4.2: a smothered jumper (contest at or above SMOTHER, the HUD's "Smothered") has no green window at all
export const SMOTHER = 0.75;
export const DEF_K = 1.0375; // v0.4.5 defense pressure / range / positioning
// v0.4.5 final touch: every green window in the game is 10% smaller (jumpers, free throws, every badge and
// package bonus included; the AI's green rate follows the same windows); the quick patch takes another 6.5% off
export const GREEN_K = 0.9 * (1 - 0.065);
// v0.4.5 quick patch: the contest's bite on the green window is 5% bigger in every guarded tier (Open, Light contest,
// Contested; Smothered has no window at all), each on its own; a wide-open look (10% guarded or less) is untouched
export const CONTEST_TIER_BOOST = 0.05;
export const contestTierK = c => ((c || 0) > 0.1 ? 1 + CONTEST_TIER_BOOST : 1);
// v0.4.5 quick patch: a timed shot (jumper, free throw, layup) let go outside the green window very rarely goes in:
// slightly early or late keeps 5% of its chance, 3% at most; very early or late 1%, half a percent at most
export const OFF_TIMING = { early: { k: 0.05, cap: 0.03 }, late: { k: 0.05, cap: 0.03 }, vearly: { k: 0.01, cap: 0.005 }, vlate: { k: 0.01, cap: 0.005 } };
// v0.4.5 quick patch: really deep shots are luck. Past 35 ft (10.67 m from the rim) the make chance slides down to
// pure luck at the half-court line (12.73 m) and stays there beyond it: well under 1%, and 1% at the very most for
// a 99 three-point shooter. Limitless helps up to 35 ft, not past it. The green window closes over the same stretch
// (none at all past half court), and a green past 35 ft is a boost, not a sure make.
export const DEEP_D = 35 * 0.3048, HALF_D = COURT.hoopZ;
export const deepK = d => Math.max(0, Math.min(1, ((d || 0) - DEEP_D) / (HALF_D - DEEP_D)));
export const deepLuck = attr => 0.001 + 0.009 * Math.pow(Math.max(0, Math.min(1, n(attr))), 2);
export function greenWindowMs(attr, badges = {}, ctx = {}) {
  let w = timingWindowMs(attr, badges) * (ctx.greenK || 1) * profK(attr); // v0.4.5: Sharp Eye / shooting takeover
  if (ctx.ft) return w * 1.15 * GREEN_K;
  if (ctx.pkg?.winK) w *= ctx.pkg.winK;
  if ((ctx.contest || 0) >= SMOTHER) return 0;
  const b = badges || {};
  const c = Math.min(1, ctx.contest || 0) * (1 - DEADEYE_WIN[b.deadeye || 0]);
  // v0.4.4: every contested state (light contest and up, not open looks) bites 3.75% harder
  const ck = 1 + 0.0375 * Math.max(0, Math.min(1, ((ctx.contest || 0) - 0.15) / 0.05));
  w *= Math.max(0, 1 - 0.55 * ck * c * contestTierK(ctx.contest));
  w *= 1 - 0.28 * Math.min(1, (ctx.moving || 0) / 5);
  if (ctx.fade) w *= 0.82;
  if (ctx.three && (ctx.d || 0) > 7.9) w *= Math.max(0.3, 1 - ((ctx.d - 7.9) * 0.28) * (1 - Math.min(0.85, 0.18 * bk(b, 'limitless'))));
  if (ctx.catchShoot && b.catch_shoot) w *= 1 + 0.05 * bk(b, 'catch_shoot');
  if (ctx.corner && b.corner_specialist) w *= 1 + 0.05 * bk(b, 'corner_specialist');
  if ((ctx.d || 0) > DEEP_D) return Math.max(0, w * (1 - deepK(ctx.d))) * GREEN_K; // (no 9 ms floor out there)
  return Math.max(9, w) * GREEN_K;
}

// which hand finishes a layup: the far hand when a defender is on one side or at the rim (the animator draws it)
export function layupHand(a) { return (a.cov === 'side' || a.cov === 'rim') && (a.covSide || 1) > 0 ? 'L' : 'R'; }

// v0.4.5 quick patch, shot meter: a jumpshot base's window bonus counts as a boost, its penalty as part of the build
export const naturalPkg = pkg => (pkg ? { ...pkg, winK: Math.min(1, pkg.winK ?? 1) } : pkg);

// v0.4.5 layup timing: hold the shot button through the gather and let go at the top. Each layup package has its
// own timing (where in the air the ideal release is, and how forgiving it is) and the Layup rating sets the window
// the same way the shooting ratings do for jumpers. rel: share of the air time; win: window multiplier; gather:
// extra gather time (s) before the takeoff (the Euro's long second step).
export const LAYUP_FEEL = {
  basic: { rel: 0.48, win: 1.0, gather: 0 },
  euro: { rel: 0.56, win: 0.95, gather: 0.06 },
  finger: { rel: 0.6, win: 0.92, gather: 0 },
  scoop: { rel: 0.4, win: 1.06, gather: 0.02 },
};
// v0.4.5: how the defense is covering a layup, read at the gather, changes the finish: its animation, the ball's
// path and when it should come out (rel: extra share of the air time). side: +1 = away to the finisher's left.
//   open  - the package's own finish
//   side  - a defender on one side: the ball is carried on the far side and finished with the far hand, the
//           shoulder into the contact
//   front - a defender squarely in the path: he hangs and double-clutches (later)
//   rim   - a shot blocker at the rim: a reverse, carried under to the far side and flipped up (later)
//   trail - a chaser coming from behind: up high and quick off the glass (earlier)
export const LAYUP_COVER = { open: { rel: 0 }, side: { rel: 0.03 }, front: { rel: 0.1 }, rim: { rel: 0.07 }, trail: { rel: -0.06 } };
export function layupCoverage(p, rim, defs) {
  const d = Math.hypot(rim.x - p.x, rim.z - p.z) || 1, ux = (rim.x - p.x) / d, uz = (rim.z - p.z) / d;
  let best = { kind: 'open', side: 0, threat: 0, dist: 99 };
  for (const q of defs) {
    if (q.action?.type === 'stumble' || q.action?.type === 'hang') continue;
    const rx = q.x - p.x, rz = q.z - p.z, dist = Math.hypot(rx, rz);
    if (dist > 3.4) continue;
    const along = rx * ux + rz * uz, lat = rx * uz - rz * ux; // lat > 0: on the finisher's left
    const toRim = Math.hypot(q.x - rim.x, q.z - rim.z), chase = q.vx * ux + q.vz * uz;
    let kind = null, threat = 0;
    if (toRim < 1.8 && along > 0.4) { kind = 'rim'; threat = 3; }
    else if (along > 0.25 && along < 1.8 && Math.abs(lat) < 0.7) { kind = 'front'; threat = 2.5; }
    else if (along > -0.5 && along < 1.6 && Math.abs(lat) < 1.5) { kind = 'side'; threat = 2; }
    else if (along > -2.2 && along <= -0.3 && Math.abs(lat) < 1.3 && chase > 1.5) { kind = 'trail'; threat = 1.5; }
    if (kind && (threat > best.threat || (threat === best.threat && dist < best.dist))) best = { kind, side: lat > 0.05 ? -1 : lat < -0.05 ? 1 : 0, threat, dist };
  }
  return { kind: best.kind, side: best.side };
}

export const LAYUP_WIN_K = 1.2; // layups are a touch more forgiving than jumpers at the same rating
// Layups happen in traffic (there's nearly always somebody at the rim), so the contest shrinks the window (to
// about half against a wall of defenders, less with Contact Finisher) but never takes it away; and a green layup
// is a big boost, not a guaranteed make, since contact can still beat it (see finalChance).
// ctx: {contest, lstyle, greenK}
export function layupWindowMs(attr, badges = {}, ctx = {}) {
  const f = LAYUP_FEEL[ctx.lstyle] || LAYUP_FEEL.basic;
  // (ctx.natural: the shot meter's "ratings only" part keeps a package's penalty but not its bonus)
  let w = timingWindowMs(attr, badges) * LAYUP_WIN_K * (ctx.natural ? Math.min(1, f.win) : f.win) * (ctx.greenK || 1) * profK(attr);
  const c = Math.min(1.2, ctx.contest || 0) * (1 - FINISHER_CON[(badges || {}).contact_finisher || 0]);
  w *= Math.max(0.5, 1 - 0.4 * c * contestTierK(ctx.contest));
  return Math.max(9, w) * GREEN_K;
}

// v0.4.5: jumpers don't all come out at the same speed. A running jumper is quicker (the momentum does some of
// the work), a step-back and a fadeaway take a little longer (the gather back / the drift), and a three takes a
// touch longer to load than a mid-range jumper. Multiplies the base's release time (tRel).
export function jumperTimingK(o = {}) {
  let k = 1;
  if ((o.moving || 0) > 2) k *= 0.95;
  if (o.stepback) k *= 1.06;
  else if (o.fade) k *= 1.04;
  if (o.three) k *= 1.03;
  return k;
}

export function gradeFromWindow(errSec, windowMs) {
  const w = windowMs / 1000, a = Math.abs(errSec);
  if (w > 0 && a <= w) return 'excellent';
  if (a <= Math.max(w * 2.6, 0.075)) return errSec < 0 ? 'early' : 'late';
  return errSec < 0 ? 'vearly' : 'vlate';
}

export function gradeRelease(errSec, attr, badges) {
  const w = timingWindowMs(attr, badges) / 1000;
  const a = Math.abs(errSec);
  if (a <= w) return 'excellent';
  if (a <= w * 2.6) return errSec < 0 ? 'early' : 'late';
  return errSec < 0 ? 'vearly' : 'vlate';
}

// Base percentage for an open shot of `type` at distance d by a player with attributes a
export function baseChance(type, d, a, three) {
  switch (type) {
    case 'dunk': return 0.82 + 0.15 * n(Math.max(a.driving_dunk ?? 50, a.standing_dunk ?? 50));
    case 'layup': return 0.40 + 0.46 * n(a.layup) - Math.max(0, d - 2.2) * 0.05;
    case 'close': return 0.36 + 0.42 * n(a.close_shot) - Math.max(0, d - 1.5) * 0.05;
    case 'ft': return 0.42 + 0.5 * n(a.free_throw);
    default: {
      if (three) return Math.max(0.03, 0.21 + 0.33 * n(a.three_point) - Math.max(0, d - 7.6) * 0.075);
      return Math.max(0.05, 0.29 + 0.33 * n(a.mid_range) - Math.max(0, d - 3.2) * 0.012);
    }
  }
}
export function attrFor(type, three, a) {
  if (type === 'ft') return a.free_throw;
  if (type === 'layup') return a.layup;
  if (type === 'close') return a.close_shot;
  if (type === 'dunk') return Math.max(a.driving_dunk ?? 50, a.standing_dunk ?? 50);
  return three ? a.three_point : a.mid_range;
}

// v0.4.2: how well a player finishes dunks through bodies (0..1): the matching dunk rating plus Close Shot
export function trafficSkill(p, standing = false) {
  const a = p.ratings;
  return 0.65 * n(standing ? (a.standing_dunk ?? 50) : (a.driving_dunk ?? 50)) + 0.35 * n(a.close_shot ?? 50);
}

export function finalChance(o) {
  // o: {type, d, a, three, grade, contest, moving, fade, stamina, badges, hot}
  let p = baseChance(o.type, o.d, o.a, o.three);
  const attr = attrFor(o.type, o.three, o.a);
  const b = o.badges || {};
  if (o.type === 'jumper' || o.type === 'ft') {
    if (o.grade === 'excellent') p = p + (1 - p) * (0.24 + 0.36 * n(attr) + 0.01 * bk(b, 'deadeye'));
    else if (o.grade === 'early' || o.grade === 'late') p *= (attr ?? 0) >= 99 ? 0.97 : (attr ?? 0) > 95 ? 0.9 : 0.85;
    else if (o.grade === 'vearly' || o.grade === 'vlate') p *= 0.38;
  }
  // v0.4.4: a 99 is close to automatic when it isn't badly mistimed; from here only the defense (the contest,
  // which scales with the defender's own ratings) and fatigue bring it down
  const deep = o.type === 'jumper' && (o.d || 0) > DEEP_D;
  const off = (o.type === 'jumper' || o.type === 'ft' || o.type === 'layup') ? OFF_TIMING[o.grade] : null;
  if ((attr ?? 0) >= 99 && !off && !deep) p = Math.max(p, o.type === 'jumper' ? (o.three ? 0.9 : 0.93) : 0.96);
  // contest
  const deadeye = Math.min(0.85, DEADEYE_CON[b.deadeye || 0]);
  const finisher = Math.min(0.75, FINISHER_CON[b.contact_finisher || 0]);
  let c = Math.min(1.2, o.contest || 0);
  if (o.type === 'jumper') c *= 1 - deadeye;
  if (o.type === 'layup' || o.type === 'close') c *= 1 - finisher;
  const cw = o.type === 'jumper' ? 0.44 : o.type === 'dunk' ? 0.58 - 0.5 * (o.traffic ?? 0.5) : 0.36;
  if (o.type !== 'ft') p *= 1 - cw * Math.min(1, c);
  if (o.type === 'jumper') {
    p *= 1 - 0.12 * Math.min(1, (o.moving || 0) / 5);
    if (o.fade) p *= 0.88;
    if (o.three && b.limitless && o.d > 7.6) p *= 1 + 0.08 * bk(b, 'limitless');
    if (o.catchShoot && b.catch_shoot) p *= 1 + 0.04 * bk(b, 'catch_shoot');
    if (o.corner && b.corner_specialist) p *= 1 + 0.05 * bk(b, 'corner_specialist');
  }
  if (o.type === 'layup' && b.acrobat && o.contest > 0.5) p *= 1 + 0.05 * bk(b, 'acrobat');
  // v0.4.5 timed layups (an untimed tap, grade 'none', plays like it always did)
  if (o.type === 'layup') {
    if (o.grade === 'excellent') p = p + (1 - p) * (0.45 + 0.2 * n(attr));
    else if (o.grade === 'early' || o.grade === 'late') p *= 0.92;
    else if (o.grade === 'vearly' || o.grade === 'vlate') p *= 0.62;
  }
  p *= 0.72 + 0.28 * Math.max(0, Math.min(1, o.stamina ?? 1));
  if (o.hot) p *= 1.06; // v0.4.5: on fire
  if (o.clutch && b.clutch) p *= 1 + 0.05 * bk(b, 'clutch');
  if (deep) {
    // past 35 ft: slide down to luck by the half-court line, and luck only beyond it (whatever the badges say)
    const k = deepK(o.d), luck = deepLuck(attr);
    p = p * (1 - k) * (1 - k) + luck * k;
    p = Math.max(0.0005, Math.min(o.d >= HALF_D ? luck : 0.97, p));
    return off ? Math.max(0.0005, Math.min(off.cap, p * off.k)) : p;
  }
  if (off) return Math.max(0.0005, Math.min(off.cap, p * off.k));
  return Math.max(0.01, Math.min(0.97, p));
}

// v0.4.3: 1 at the rim and in the restricted area / low lane, fading to 0 by about 4.4 m
export function paintWeight(distToRim) { return Math.max(0, Math.min(1, (4.4 - distToRim) / 1.9)); }

// v0.4.3: how much a defender's contest is worth. Outside it is Perimeter D; in the paint it is mostly
// Interior D plus Block, with the Rim Protector badge on top.
export function defSkill(d, pw) {
  const r = d.ratings, b = d.badges || {};
  const perim = 0.74 + 0.5 * n(r.perimeter_d);
  const inside = 0.58 + 0.4 * n(r.interior_d) + 0.14 * n(r.block) + bk(b, 'rim_protector') * 0.02;
  return perim + (inside - perim) * pw;
}

// v0.4.3 dunk packages: higher packages (they need higher dunk ratings) are flashier and posterize harder
export const DUNK_TIER = {
  dunk_basic: 0, dunk_rimrocker: 1, dunk_tomahawk: 1, dunk_windmill: 2, dunk_contact: 2, dunk_flight: 3, dunk_highflyer: 3, wheel_dunk_showtime: 3,
  // v0.4.5 packages
  dunk_hammer: 1, dunk_liberty: 1, dunk_scoop: 2, dunk_switch: 2, dunk_180: 3, dunk_eastbay: 4,
};
export const STYLE_FLAIR = {
  power: 0, onehand: 0.3, tomahawk: 1, reverse: 1.5, double: 2, windmill: 2, cradle: 2.5, '360': 3,
  // v0.4.5 finishes
  hammer: 1.2, liberty: 1.3, scoop: 2.2, switch: 2.6, 180: 3, eastbay: 4, hashsling: 4,
  // v0.4.5 stage 7 signatures: Rim Rocker, Contact, Showtime, High Flyer
  rimrock: 1.1, bully: 0.8, aroundback: 3.1, superman: 3.3,
};
export const dunkTier = p => DUNK_TIER[p?.dunkPkg] ?? 0;

// v0.4.5 stage 7: size-up packages change the ball, not only the body: how low and how wide he keeps it, how fast
// it pounds, and which in-place combos he works the defender with (chance per dribble while he's sizing up).
// cross / btl / btb change hands; half (snake) slides it across and back; hesi holds it up at the hip for a beat.
export const SIZEUP = {
  basic: { hgt: 1, side: 1, freq: 1, combos: [], chance: 0 },
  rhythm: { hgt: 1.02, side: 1, freq: 0.86, combos: ['cross'], chance: 0.25 },
  pound: { hgt: 0.72, side: 0.9, freq: 1.42, combos: [], chance: 0 },
  quick: { hgt: 0.9, side: 0.9, freq: 1.16, combos: ['cross'], chance: 0.45 },
  snake: { hgt: 0.6, side: 1.25, freq: 1.1, combos: ['half', 'half', 'cross'], chance: 0.65 },
  crab: { hgt: 0.86, side: 1.5, freq: 0.94, combos: ['cross'], chance: 0.35 },
  stutter: { hgt: 0.9, side: 1, freq: 1.3, combos: ['hesi', 'hesi', 'cross'], chance: 0.55 },
  elite: { hgt: 0.82, side: 0.95, freq: 1.2, combos: ['cross', 'btl'], chance: 0.7 },
  ankle: { hgt: 0.74, side: 1.05, freq: 1.33, combos: ['btl', 'cross', 'btb'], chance: 0.78 },
  showtime: { hgt: 0.96, side: 1.12, freq: 1.12, combos: ['btb', 'btl', 'btb'], chance: 0.7 },
};
export const sizeupOf = p => (p.speed < 1.2 ? SIZEUP[p.sizeupStyle] || SIZEUP.basic : null);
// one dribble's worth of time; true when the ball hits the floor. The game and the store preview share it.
export function advanceDribble(p, dt, rnd, pressured) {
  const su = sizeupOf(p);
  const freq = (1.55 + Math.min(1.1, p.speed * 0.2) + (p.action?.type === 'move' ? 0.6 : 0)) * (p.dribble.xover ? 1 + 0.12 * (p.sizeupLvl || 0) : 1) * (p.dribbleStyle?.freqK || 1) * (su ? su.freq : 1);
  const prev = p.dribble.phase;
  p.dribble.phase = (p.dribble.phase + freq * dt) % 1;
  if (p.dribble.phase < prev) {
    // the ball is back in a hand: finish a size-up combo, then maybe start another
    const xo = p.dribble.xover;
    if (xo) { if (xo !== 'half' && xo !== 'hesi') p.dribble.hand = p.dribble.hand === 'R' ? 'L' : 'R'; p.dribble.xover = null; }
    if (su && su.chance > 0 && !p.action && pressured && rnd() < su.chance) p.dribble.xover = su.combos[Math.min(su.combos.length - 1, Math.floor(rnd() * su.combos.length))];
  }
  return prev < 0.5 && p.dribble.phase >= 0.5;
}
// extra body yaw during a 360 dunk (the sim's ball path and the animator both use it, so the ball stays in hand)
export function dunkSpin(a) {
  // v0.4.5: the 180 turns half a revolution on the way up and stays backward through the slam
  if (!a || a.type !== 'dunk' || !(a.slam > 0)) return 0;
  const turn = a.style === '360' ? Math.PI * 2 : a.style === '180' ? Math.PI : 0;
  if (!turn) return 0;
  const t0 = (a.takeoff || 0) + 0.03, t1 = a.slam - (a.style === '180' ? 0.12 : 0.06);
  const k = Math.max(0, Math.min(1, (a.t - t0) / Math.max(0.1, t1 - t0)));
  return (a.spinDir || 1) * turn * k * k * k * (k * (k * 6 - 15) + 10);
}

// Contest from defenders: returns 0 (open) .. 1.2 (smothered)
export function contestFor(shooter, defenders, rim, releaseH) {
  const cs = [];
  const fx = rim.x - shooter.x, fz = rim.z - shooter.z, fl = Math.hypot(fx, fz) || 1;
  const pw = paintWeight(fl);
  for (const d of defenders) {
    const dx = d.x - shooter.x, dz = d.z - shooter.z, dist = Math.hypot(dx, dz);
    // v0.4.3: rim protectors cover more ground in the paint
    const range = (2.6 + pw * 0.35 * n(d.ratings.interior_d)) * DEF_K;
    if (dist > range) continue;
    const front = (dx * fx + dz * fz) / (fl * (dist || 1));
    const ang = front > 0.35 ? 1 : front > -0.1 ? 0.55 : 0.18 + pw * 0.22 * n(d.ratings.block);
    const prox = Math.max(0, Math.min(1, ((2.0 + pw * 0.3 * n(d.ratings.interior_d)) * DEF_K - dist) / 1.45));
    // v0.4.5: hands up on a shot puts 3.75% more pressure on it
    const up = d.handsUp || d.action?.type === 'contest' || d.action?.type === 'block';
    const reach = d.phys.reach + (d.y || 0) + (up ? 0.12 * DEF_K : -0.35);
    // height and length count for more around the rim
    const hk = Math.max(0.35, Math.min(1.25 + 0.08 * pw, 0.75 + (reach - releaseH) * (0.7 + 0.3 * pw)));
    const timing = d.airborne && d.action && d.action.type === 'block' ? (1.1 + 0.15 * n(d.ratings.block)) * DEF_K : 1;
    cs.push(prox * ang * hk * timing * defSkill(d, pw) * (up ? DEF_K : 1));
  }
  cs.sort((a, b) => b - a);
  return Math.min(1.25, (cs[0] || 0) + (cs[1] || 0) * 0.3);
}

// Solve launch velocity from P to aim point T with launch angle (deg), accounting for drag by iteration.
export function solveLaunch(P, T, angleDeg) {
  const dx = T.x - P.x, dz = T.z - P.z, d = Math.hypot(dx, dz), h = T.y - P.y;
  const th = angleDeg * Math.PI / 180;
  const ux = dx / (d || 1), uz = dz / (d || 1);
  let denom = 2 * Math.cos(th) ** 2 * (d * Math.tan(th) - h);
  if (denom <= 0.01) denom = 0.01;
  let v = Math.sqrt(GRAVITY * d * d / denom);
  // refine for drag: integrate flight (no collisions) and scale speed to land on target distance
  for (let it = 0; it < 4; it++) {
    const b = new Ball(); b.halfOnly = true;
    let x = 0, y = P.y, vx = v * Math.cos(th), vy = v * Math.sin(th);
    const kd = 0.0185, dt = 1 / 240;
    let reached = null;
    for (let s = 0; s < 1200; s++) {
      const sp = Math.hypot(vx, vy);
      vx += -kd * sp * vx * dt; vy += (-GRAVITY - kd * sp * vy) * dt;
      const px = x, py = y;
      x += vx * dt; y += vy * dt;
      if (vy < 0 && py >= T.y && y < T.y) { const k = (py - T.y) / (py - y); reached = px + (x - px) * k; break; }
    }
    if (reached == null) { v *= 1.05; continue; }
    v *= Math.sqrt(d / Math.max(0.05, reached));
  }
  return { vx: ux * v * Math.cos(th), vy: v * Math.sin(th), vz: uz * v * Math.cos(th), v };
}

// Build a shot trajectory consistent with the predetermined outcome.
// rng: RNG; rim: {x,y,z}; side: hoop side; make: bool; P: release point; arc: deg
export function planShot(rng, P, rim, side, make, arc, opts = {}) {
  const b = new Ball(); b.halfOnly = !!opts.halfOnly; b.surface = opts.surface || 'wood';
  const tryAim = (ox, oz, oy = 0, arcUse = arc) => {
    const T = { x: rim.x + ox, y: rim.y + oy, z: rim.z + oz };
    const L = solveLaunch(P, T, arcUse);
    b.x = P.x; b.y = P.y; b.z = P.z; b.vx = L.vx; b.vy = L.vy; b.vz = L.vz;
    // backspin about axis perpendicular to travel in horizontal plane
    const hx = L.vx, hz = L.vz, hl = Math.hypot(hx, hz) || 1;
    b.wx = -hz / hl * 0; b.wz = 0; b.wy = 0;
    b.wx = (hz / hl) * -14; b.wz = (hx / hl) * 14; // backspin
    b.mode = 'flight'; b.touchedRim = false; b.touchedBoard = false; b.floorBounces = 0;
    const r = predictShot(b, 4);
    return { r, vel: { vx: b.vx, vy: b.vy, vz: b.vz, wx: b.wx, wy: b.wy, wz: b.wz } };
  };
  // direction from release toward rim (for front/back misses)
  const fx = rim.x - P.x, fz = rim.z - P.z, fl = Math.hypot(fx, fz) || 1;
  const ux = fx / fl, uz = fz / fl, px = -uz, pz = ux;
  const bankOK = opts.bank && Math.abs(P.x) > 1 && fl < 4.5;
  if (make) {
    const tries = [];
    // bank shot candidates (aim at mirror image of rim behind the glass)
    if (bankOK && rng.next() < 0.6) {
      const mirrorZ = 2 * side * COURT.boardZ - rim.z;
      for (let k = 0; k < 8; k++) {
        const oy = 0.18 + rng.next() * 0.3;
        tries.push([rim.x * 0.6 + (rng.next() - 0.5) * 0.12, mirrorZ - rim.z + (rng.next() - 0.5) * 0.06, oy]);
      }
    }
    for (let k = 0; k < 10; k++) {
      const mag = (opts.swish ? 0.035 : 0.075) * (1 - k / 12) * Math.sqrt(rng.next());
      const a = rng.next() * Math.PI * 2;
      // bias slightly long: shooters aim to the back half of the rim
      tries.push([Math.cos(a) * mag + ux * 0.02, Math.sin(a) * mag + uz * 0.02, 0]);
    }
    tries.push([ux * 0.02, uz * 0.02, 0]);
    const arcs = fl < 1.6 ? [arc, arc + 8, arc + 14, arc - 6] : [arc, arc + 5, arc - 4];
    for (const arcUse of arcs) {
      for (const [ox, oz, oy] of tries) {
        const res = tryAim(ox, oz, oy, arcUse);
        if (res.r.made) return { ...res.vel, made: true, bank: oy > 0, rim: res.r.rim };
      }
    }
    const res = tryAim(0, 0, 0);
    // a green must go in: if no clean physical solution was found, send it dead-center and let it drop
    if (!res.r.made && opts.guarantee) return { ...res.vel, made: true, ghost: true, rim: false };
    return { ...res.vel, made: res.r.made, rim: res.r.rim };
  }
  // miss: choose a style
  for (let k = 0; k < 14; k++) {
    const style = rng.next();
    let ox, oz;
    const m = 0.12 + rng.next() * 0.16 + k * 0.012 + (opts.bad ? 0.2 * rng.next() : 0);
    if (style < 0.35) { ox = ux * -m; oz = uz * -m; } // short / front rim
    else if (style < 0.7) { ox = ux * m; oz = uz * m; } // long / back rim
    else { const s = rng.next() < 0.5 ? -1 : 1; ox = px * s * m * 0.9 + ux * 0.03; oz = pz * s * m * 0.9 + uz * 0.03; }
    const res = tryAim(ox, oz, 0);
    if (!res.r.made) return { ...res.vel, made: false, rim: res.r.rim };
  }
  const res = tryAim(ux * -0.45, uz * -0.45, 0);
  return { ...res.vel, made: res.r.made };
}

// v0.4.1 shot selection. Driving to the rim with the shoot button prefers a dunk, unless the player's layup
// or pull-up is clearly the better option: ratings decide first, then what the defense allows (a rim
// protector waiting at the rim favours a finesse layup, a defender walling off the lane favours a pull-up).
// ctx: {sprint, forceJumper, attack (dedicated dunk bind), defs (defenders)}
export function shotTypeFor(player, rim, ctx = {}) {
  const d = Math.hypot(rim.x - player.x, rim.z - player.z);
  const speed = Math.hypot(player.vx, player.vz);
  const toward = speed > 0.1 ? ((rim.x - player.x) * player.vx + (rim.z - player.z) * player.vz) / (d * speed) : 0;
  const a = player.ratings;
  if (ctx.forceJumper) return { type: 'jumper', d };
  const lift = player.phys.reach + player.phys.vertical;
  const raw = player.raw || a; // gating uses the build's real ratings
  const canDunk = (raw.driving_dunk ?? 0) >= 55 && player.stamina > 0.12 && lift > 3.2;
  const canStand = (raw.standing_dunk ?? 0) >= 65 && lift > 3.25;
  const cover = coverage(player, rim, d, ctx.defs || []);
  if (ctx.attack) {
    // dedicated bind: the finish you're better at, Driving Dunk (Standing Dunk right under the rim) or Layup, and on
    // an exact tie the one your archetype plays (v0.4.5 quick patch; it used to dunk whenever it physically could).
    // A dunk still has to be physically possible.
    const dunkOver = dunkAttr => betterFinish(player, dunkAttr, raw.layup) === 'dunk';
    if (d < 1.6 && canStand && dunkOver(raw.standing_dunk)) return { type: 'dunk', d, standing: true, cover };
    if (d < 4.2 && canDunk && (speed > 1.2 || d < 2.4) && dunkOver(raw.driving_dunk)) return { type: 'dunk', d, cover };
    // v0.4.5: with an empty lane ahead the bind takes off from further out (long gather), at full speed
    if (d < 5.8 && canDunk && speed > 3 && toward > 0.7 && cover.open && dunkOver(raw.driving_dunk)) return { type: 'dunk', d, cover, long: true };
    if (d < 4.4) return { type: d < 1.6 && speed < 1 ? 'close' : 'layup', d, cover };
    return { type: 'none', d };
  }
  if (d < 1.4 && canStand && ctx.sprint) return { type: 'dunk', d, standing: true, cover };
  if (d < 4.4 && speed > 2.2 && toward > 0.55) {
    const pick = pickFinish(player, d, cover, canDunk);
    if (pick === 'jumper') return { type: 'jumper', d, pullup: true, cover };
    return { type: pick, d, cover };
  }
  if (d < 1.8) return { type: 'close', d };
  const fade = speed > 1.2 && toward < -0.5;
  return { type: 'jumper', d, fade };
}

// What the defense is doing about a drive from `p` to the rim
export function coverage(p, rim, d, defs) {
  const ux = (rim.x - p.x) / (d || 1), uz = (rim.z - p.z) / (d || 1);
  let rimProtector = null, wall = null;
  for (const q of defs) {
    if (q.action?.type === 'stumble') continue;
    const rx = q.x - p.x, rz = q.z - p.z;
    const along = rx * ux + rz * uz, lat = Math.abs(rx * uz - rz * ux);
    if (along < -0.2 || along > d + 0.6 || lat > 1.15) continue;
    const toRim = Math.hypot(q.x - rim.x, q.z - rim.z);
    const blk = q.ratings.block ?? 50;
    if (toRim < 2.0 && (!rimProtector || blk > (rimProtector.ratings.block ?? 50))) rimProtector = q;
    if (along > 0.3 && along < 1.3 && lat < 0.6 && toRim > 1.2) wall = q;
  }
  return { rimProtector, wall, open: !rimProtector && !wall };
}

// v0.4.5 quick patch: which finish an archetype plays when its dunk and layup ratings are exactly the same. Slashers
// and the bigs who live in the paint dunk; the guards, shooters, stretch bigs and two-way wings lay it in.
export const FINISH_STYLE = {
  slasher: 'dunk', glass_cleaner: 'dunk', post_scorer: 'dunk',
  playmaker: 'layup', sharpshooter: 'layup', stretch_big: 'layup', lockdown: 'layup', two_way: 'layup',
};
export function archetypeOf(p) {
  const b = p.entry?.build || {};
  return b.archetype || ({ outside: 'sharpshooter', inside: 'slasher' }[b.style]) || 'two_way';
}
// The higher rating wins (the build's own ratings, as its card shows them); an exact tie goes to the archetype's style
export function betterFinish(p, dunk, layup) {
  if ((dunk ?? 0) !== (layup ?? 0)) return (dunk ?? 0) > (layup ?? 0) ? 'dunk' : 'layup';
  return FINISH_STYLE[archetypeOf(p)] || 'layup';
}

// 'dunk' | 'layup' | 'jumper' for a driving shot press: the finish with the highest rating, adjusted for the defense
// (a rim protector favors a finesse layup, a defender walling off the lane a pull-up); an exact tie between the dunk
// and the layup goes to the archetype (betterFinish). v0.4.5 quick patch: no more flat +8 (+4 more in an open lane)
// head start for the dunk, so a better layup or pull-up wins even when the dunk is close.
export function pickFinish(p, d, cover, canDunk) {
  const a = p.raw || p.ratings;
  let dunk = canDunk && d < 3.8 ? (a.driving_dunk ?? 0) : -1e9;
  let layup = (a.layup ?? 0);
  let pull = d > 3.0 ? (a.mid_range ?? 0) - 10 : -1e9; // pulling up off a drive is harder than a set jumper
  const rp = cover.rimProtector;
  if (rp) {
    const prot = ((rp.ratings.block ?? 50) - 60) * 0.3 + (rp.phys.reach - p.phys.reach) * 10;
    dunk -= Math.min(10, Math.max(0, prot)) * (p.badges?.posterizer ? 0.4 : 1) * (1.3 - trafficSkill(p));
    layup += 3 + (p.badges?.acrobat ? 2 : 0); // finesse finish around length
  }
  if (cover.wall) { pull += 6; dunk -= 4; } // cut off in front: stop and pop
  if (cover.open) pull -= 4; // an open lane: take it all the way
  const rim = dunk > -1e8 ? betterFinish(p, dunk, layup) : 'layup';
  return pull > Math.max(dunk, layup) ? 'jumper' : rim;
}
