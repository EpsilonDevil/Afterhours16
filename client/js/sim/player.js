// Player state + movement physics (momentum, braking, plant cuts, jumps, stamina).
import { physical } from './ratings.js';
import { bodyDims } from '../char/skeleton.js';
import { DT, GRAVITY, COURT } from './constants.js';
import { jumpshotPackage } from './shots.js';

import { rk as pd } from './ratings.js';
import { effectiveRatings, TAKEOVER_FOR_POS, TAKEOVERS } from './badges.js';
import { capBadges } from './builds.js';
import { greenVoice } from '../core/greensound.js';
// v0.4.5 final: sprinting drains stamina twice as fast
export const SPRINT_DRAIN_K = 2;
// v0.4.7.5 quick patch: everyone gets their breath back 1.2x faster
export const STAMINA_RECOVER_K = 1.2;
// v0.4.7.5 quick patch 3: standing still recovers twice what it did (REST_RECOVER_K, was 1.4), and getting around
// without the sprint button (walking, jogging, drifting) now recovers a very little (MOVE_RECOVER_K; it was neutral
// above 2.1 m/s and 0.6 below it)
export const REST_RECOVER_K = 2.8;
export const MOVE_RECOVER_K = 0.1;

// v0.4.5 Lock-In grade -> stamina: A- 1.1x / A 1.25x / A+ 1.5x recovery, D+ 1.1x / D 1.25x / D- and F 1.5x drain
const GRADE_REC = { 10: 1.1, 11: 1.25, 12: 1.5 };
const GRADE_DRAIN = { 3: 1.1, 2: 1.25, 1: 1.5, 0: 1.5 };

export const DRIBBLE_SPEED_K = 1 - 0.0745;

export class Player {
  constructor(id, team, entry, catalog) {
    this.id = id;
    this.team = team;
    this.entry = entry; // {build, name, number, look, human, character_id}
    this.name = entry.name || 'Player';
    this.number = entry.number ?? 0;
    this.position = entry.build.position || 'SF';
    // (v0.4.7.5 quick patch: shooters and non-shooters have different green windows, shots.js isShooterArch)
    this.archetype = entry.build.archetype || ({ outside: 'sharpshooter', inside: 'slasher', balanced: 'two_way' }[entry.build.style]) || null;
    this.human = !!entry.human;
    // v0.4.5: `raw` is the build as shown in menus; `ratings` is what the sim plays with (the no-badge
    // penalty, Icon badge and takeover boosts applied). Gating checks (can he dunk at all) use raw.
    this.raw = { ...entry.build.attributes };
    // v0.4.7.5: every badge plays at most at the tier the build allows (archetype and height)
    this.badges = capBadges(entry.badges || {}, entry.build.archetype || entry.build.height ? entry.build : null);
    this.icon = entry.icon || entry.build.icon_badge || null;
    this.ratings = effectiveRatings(this.raw, this.badges, this.icon);
    // takeover: which kind this position can earn, progress toward it, seconds left while active
    this.takeover = { kind: TAKEOVER_FOR_POS[entry.build.position || 'SF'] || null, prog: 0, left: 0, active: false };
    // stamina modifiers (see staminaMods): repeated dribble moves, repeated negative plays, positive-play bonus,
    // going hot / cold, and the Lock-In grade
    this.stam = { lastMove: null, moveRun: 0, moveK: 1, lastNeg: null, negK: 1, goodRun: 0, recBoost: false, grade: null };
    this.hotStreak = 0; this.coldMisses = 0; this.cold = false;
    this.phys = physical(entry.build);
    // v0.4.5 quick patch: the body model's real shoulder and arm (char/skeleton.js), so a ball held at the top of a
    // shot is somewhere the hands can actually be (see Game.reachTop)
    { const d = bodyDims(entry.build); this.arm = { H: d.H, shoulderY: 0.806 * d.H, shoulderX: d.shoulderX, z: -0.012 * d.H, len: d.upperLen + d.foreLen }; }
    this.shotPkg = jumpshotPackage(entry.build, catalog);
    this.dunkPkg = entry.build.equipment?.dunk || 'dunk_basic';
    // v0.4.3 size-up package: 0 basic, 1 quick, 2 elite (stat-locked); speeds up and dresses up dribble moves
    const su = entry.build.equipment?.sizeup || 'sizeup_basic';
    // v0.4.5: a package's own lvl (from the catalog) decides how hard it sells the handle; `style` is its look
    this.sizeupLvl = catalog?.[su]?.lvl ?? ({ sizeup_rhythm: 0, sizeup_quick: 1, sizeup_elite: 2, sizeup_ankle_taker: 2 }[su] ?? 0);
    // v0.4.7.5 movement style (how he walks and runs: animator MOVE_GAIT)
    this.moveStyle = catalog?.[entry.build.equipment?.movement]?.style || 'standard';
    this.sizeupStyle = catalog?.[su]?.style || ({ sizeup_quick: 'quick', sizeup_elite: 'elite', sizeup_ankle_taker: 'ankle', sizeup_rhythm: 'rhythm' }[su] || 'basic');
    this.moveSpeed = catalog?.[su]?.move_speed ?? [1, 1.12, 1.22][this.sizeupLvl];
    // v0.4.5 layup packages: the finish style used on drives
    this.layupPkg = entry.build.equipment?.layup || 'layup_basic';
    this.layupStyle = catalog?.[this.layupPkg]?.style || 'basic';
    // v0.4.7.5 green releases: his sound and his effect, and (AI) his own pitch and tempo on the sound
    this.greenSound = entry.build.equipment?.greensound || 'gsnd_basic';
    this.greenFx = entry.build.equipment?.greenfx || 'gfx_basic';
    this.greenVoice = this.human ? { pitch: 1, rate: 1 } : greenVoice(`${this.name}|${entry.build.archetype || ''}|${entry.build.height || ''}`);
    this.hand = entry.build.hand || 'R';
    this.iq = entry.iq ?? null; // v0.4.4 basketball IQ (world AI hoopers)
    this.x = 0; this.z = 0; this.y = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.facing = 0;
    this.stamina = 1;
    this.action = null;
    this.stance = 'normal';
    this.handsUp = false;
    this.sprinting = false;
    this.dribble = { hand: this.hand, phase: 0, live: true, used: false };
    this.cool = { steal: 0, block: 0, move: 0, pass: 0, call: 0 };
    this.intent = blankIntent();
    this.stats = { pts: 0, reb: 0, oreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, pf: 0, dunks: 0, greens: 0, ankles: 0, contested_makes: 0, posters: 0, putbacks: 0, chasedowns: 0, alleyoops: 0 };
    this.plantT = 0;
    this.airborne = false;
    this.hot = 0; // v0.4.5: 0 or 1 (on fire)
    this.lastShotEnd = 0;
    this.ai = null;
    this.prevX = 0; this.prevZ = 0; this.prevY = 0; this.prevFacing = 0;
    this.bumpT = 0;
    this.calling = 0;
    // v0.4.5 dribble style by build: tight, low and quick for elite handles and small guards; higher, wider and
    // slower for bigs and weak handles; quicker legs dribble a touch faster
    {
      const h = pd(this.raw.ball_handle ?? 60), sp = pd(this.raw.speed ?? 60), H = this.phys.H;
      const seed = ((entry.build.height || 78) * 31 + (entry.build.weight || 200) * 7 + (this.name.length * 13)) % 17 / 17 - 0.5;
      this.dribbleStyle = {
        freqK: Math.max(0.8, Math.min(1.3, 1 + 0.2 * (h - 0.6) + 0.08 * (sp - 0.6) - 0.35 * (H - 1.96) + seed * 0.06)),
        hgtK: Math.max(0.8, Math.min(1.2, 1 - 0.14 * (h - 0.6) + 0.25 * (H - 1.96) + seed * 0.04)),
        sideK: Math.max(0.85, Math.min(1.25, 1 - 0.18 * (h - 0.6) + 0.3 * (H - 1.96))),
      };
    }
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  dist(o) { return Math.hypot(this.x - o.x, this.z - o.z); }
  reachNow() { return this.phys.reach + this.y + (this.handsUp ? 0.05 : -0.25); }
  setPos(x, z, facing) { this.x = this.prevX = x; this.z = this.prevZ = z; this.vx = this.vz = 0; if (facing != null) this.facing = this.prevFacing = facing; this.y = this.prevY = 0; this.vy = 0; this.airborne = false; }
  startAction(type, dur, data = {}) { this.action = { type, t: 0, dur, ...data, id: (this.actionSeq = (this.actionSeq || 0) + 1) }; return this.action; }
  jump(h) { this.vy = Math.sqrt(2 * GRAVITY * Math.max(0.05, h)); this.airborne = true; }
  refreshRatings() { this.ratings = effectiveRatings(this.raw, this.badges, this.icon, this.takeover.active ? this.takeover.kind : null); }
  // v0.4.5 stamina multipliers. Drain: repeated moves × repeated negative plays × cold (1.5) × low grade.
  // Recovery: positive-play bonus (2x, doesn't stack) × hot (1.5) × high grade. All of them stack.
  get drainK() { const s = this.stam; return s.moveK * s.negK * (this.cold ? 1.5 : 1) * (GRADE_DRAIN[s.grade] || 1); }
  get recK() { const s = this.stam; return (s.recBoost ? 2 : 1) * (this.hot ? 1.5 : 1) * (GRADE_REC[s.grade] || 1); }
  spend(amount) { this.stamina = Math.max(0, this.stamina - amount * this.drainK); }

  // Movement integration. lock: 0 free .. 1 fully locked (momentum decays)
  move(dt, hasBall, lock = 0) {
    const it = this.intent, ph = this.phys;
    let mx = it.mx, mz = it.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const mag = Math.min(1, ml);
    const defense = this.stance === 'defense';
    this.sprinting = !!it.sprint && mag > 0.3 && this.stamina > 0.04 && !defense;
    let top = this.sprinting ? ph.sprint : ph.jog;
    // v0.4.5 quick patch: everyone moves 7.45% slower with the ball (DRIBBLE_SPEED_K)
    if (hasBall) top *= (this.sprinting ? ph.ballSpeedK : 0.95) * DRIBBLE_SPEED_K;
    // v0.4.3: Perimeter D sets how fast a defender slides (and Lateral Quickness via speed, through jog)
    if (defense) top = ph.jog * (0.76 + 0.16 * pd(this.ratings.perimeter_d));
    if (this.handsUp) top *= 0.7;
    top *= 0.78 + 0.22 * Math.min(1, this.stamina * 1.6);
    if (this.bumpT > 0) top *= 0.55;
    let tvx = mx * top * mag, tvz = mz * top * mag;
    if (lock > 0) { tvx *= 1 - lock; tvz *= 1 - lock; }
    const sp = Math.hypot(this.vx, this.vz);
    // plant & cut: only a real reversal at speed forces a plant step (short, so control stays crisp)
    if (sp > 4.0 && mag > 0.5) {
      const cos = (this.vx * mx + this.vz * mz) / (sp * mag);
      if (cos < -0.45 && this.plantT <= 0) { this.plantT = 0.09 + (sp - 4) * 0.025; this.planted = true; }
    }
    let rate;
    const dvx = tvx - this.vx, dvz = tvz - this.vz;
    const along = sp > 0.01 ? (dvx * this.vx + dvz * this.vz) / sp : 1;
    rate = along < 0 ? ph.brake : ph.accel;
    if (defense) rate *= 1.2 + 0.3 * pd(this.ratings.perimeter_d);
    if (this.plantT > 0) { this.plantT -= dt; rate = ph.brake * 1.15; tvx = 0; tvz = 0; }
    if (this.airborne) rate *= 0.08;
    const dvl = Math.hypot(tvx - this.vx, tvz - this.vz);
    const maxDv = rate * dt;
    if (dvl > maxDv) { this.vx += (tvx - this.vx) / dvl * maxDv; this.vz += (tvz - this.vz) / dvl * maxDv; }
    else { this.vx = tvx; this.vz = tvz; }
    this.x += this.vx * dt; this.z += this.vz * dt;
    // facing
    const spd = Math.hypot(this.vx, this.vz);
    let want = null;
    if (it.face != null) want = it.face;
    else if (it.stickFace && mag > 0.35 && lock < 0.5) want = Math.atan2(mx, mz); // human: body follows the stick
    else if (spd > 0.4) want = Math.atan2(this.vx, this.vz);
    if (want != null && !this.airborne) {
      let d = want - this.facing; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const tr = ph.turn * (it.face != null ? 1.3 : 1) / (1 + spd * 0.12);
      const step = Math.max(-tr * dt, Math.min(tr * dt, d));
      this.facing += step;
      if (this.facing > Math.PI) this.facing -= 2 * Math.PI; if (this.facing < -Math.PI) this.facing += 2 * Math.PI;
    }
    // vertical
    if (this.airborne) {
      this.vy -= GRAVITY * dt; this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.airborne = false; this.landed = true; }
    }
    // stamina (v0.4.5): sprinting drains the most; jogging, sliding on defense and hands-up defense drain a
    // little; standing and walking recover. v0.4.7.5: posting up is neutral, for the post player and the man
    // guarding him: it neither drains nor recovers.
    // v0.4.7.5 quick patch: recovery is 1.2x what it was (STAMINA_RECOVER_K); sliding in a defensive stance still
    // costs a little.
    // v0.4.7.5 quick patch 3: standing still recovers 2x what it did (REST_RECOVER_K), getting around without the
    // sprint button recovers a very little at any speed (MOVE_RECOVER_K; it used to be neutral), and contesting with
    // the arms up without leaving the floor is neutral for the defender (it used to drain like a slide). Jumping to
    // contest still costs through COST.jump.
    const posting = this.posting > 0 || this.postD > 0;
    if (this.sprinting && spd > 3) this.stamina -= ph.staminaRate * SPRINT_DRAIN_K * dt * this.drainK; // v0.4.5 final: ×2
    else if (posting) { /* neutral */ }
    else if (!this.airborne && defense && spd > 0.8) this.stamina -= ph.staminaRate * 0.2 * dt * this.drainK;
    else if (!this.airborne && this.handsUp) { /* hands up, feet on the floor: neutral */ }
    else this.stamina += ph.recover * STAMINA_RECOVER_K * dt * (spd < 1 ? REST_RECOVER_K : MOVE_RECOVER_K) * this.recK;
    if (this.posting > 0) this.posting -= dt;
    if (this.postD > 0) this.postD -= dt;
    this.stamina = Math.max(0, Math.min(1, this.stamina));
    if (this.bumpT > 0) this.bumpT -= dt;
    for (const k in this.cool) if (this.cool[k] > 0) this.cool[k] -= dt;
  }
}

export function blankIntent() {
  return { mx: 0, mz: 0, sprint: false, defense: false, handsUp: false, face: null, stickFace: false, shoot: null, shootHeld: false, pass: null, move: null, steal: false, jump: false, call: false, screen: false, lob: false, pumpFake: false, celebrate: null, stealDir: null, stealLow: false, handsSide: null };
}

// Local (player-facing) → world offset
export function toWorld(p, lx, ly, lz, out = {}) {
  const c = Math.cos(p.facing), s = Math.sin(p.facing);
  out.x = p.x + lz * s + lx * c;
  out.z = p.z + lz * c - lx * s;
  out.y = p.y + ly;
  return out;
}
