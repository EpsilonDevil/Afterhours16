// Player state + movement physics (momentum, braking, plant cuts, jumps, stamina).
import { physical } from './ratings.js';
import { DT, GRAVITY, COURT } from './constants.js';
import { jumpshotPackage } from './shots.js';

import { rk as pd } from './ratings.js';

export class Player {
  constructor(id, team, entry, catalog) {
    this.id = id;
    this.team = team;
    this.entry = entry; // {build, name, number, look, human, character_id}
    this.name = entry.name || 'Player';
    this.number = entry.number ?? 0;
    this.position = entry.build.position || 'SF';
    this.human = !!entry.human;
    this.ratings = { ...entry.build.attributes };
    this.badges = { ...(entry.badges || {}) };
    this.phys = physical(entry.build);
    this.shotPkg = jumpshotPackage(entry.build, catalog);
    this.dunkPkg = entry.build.equipment?.dunk || 'dunk_basic';
    // v0.4.3 size-up package: 0 basic, 1 quick, 2 elite (stat-locked); speeds up and dresses up dribble moves
    const su = entry.build.equipment?.sizeup || 'sizeup_basic';
    this.sizeupLvl = { sizeup_rhythm: 0, sizeup_quick: 1, sizeup_elite: 2, sizeup_ankle_taker: 2 }[su] ?? 0;
    this.moveSpeed = catalog?.[su]?.move_speed ?? [1, 1.12, 1.22][this.sizeupLvl];
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
    this.hot = 0;
    this.lastShotEnd = 0;
    this.ai = null;
    this.prevX = 0; this.prevZ = 0; this.prevY = 0; this.prevFacing = 0;
    this.bumpT = 0;
    this.calling = 0;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  dist(o) { return Math.hypot(this.x - o.x, this.z - o.z); }
  reachNow() { return this.phys.reach + this.y + (this.handsUp ? 0.05 : -0.25); }
  setPos(x, z, facing) { this.x = this.prevX = x; this.z = this.prevZ = z; this.vx = this.vz = 0; if (facing != null) this.facing = this.prevFacing = facing; this.y = this.prevY = 0; this.vy = 0; this.airborne = false; }
  startAction(type, dur, data = {}) { this.action = { type, t: 0, dur, ...data, id: (this.actionSeq = (this.actionSeq || 0) + 1) }; return this.action; }
  jump(h) { this.vy = Math.sqrt(2 * GRAVITY * Math.max(0.05, h)); this.airborne = true; }

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
    if (hasBall) top *= this.sprinting ? ph.ballSpeedK : 0.95;
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
    // stamina
    if (this.sprinting && spd > 3) this.stamina -= ph.staminaRate * dt;
    else this.stamina += ph.recover * dt * (spd < 1 ? 1.4 : 0.6);
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
