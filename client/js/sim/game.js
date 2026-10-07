// Authoritative client-side basketball simulation (60 Hz fixed step).
// Park: halfcourt 21 by 2s/3s with check-ball and take-it-back. Pro-Am: full court 5v5 with quarters,
// shot clock, inbounds, fouls and free throws. Practice: shootaround with rebounder.
import { RNG } from '../core/rng.js';
import { COURT, BALL_R, GRAVITY, isThree } from './constants.js';
import { Ball } from './ball.js';
import { Player, toWorld, blankIntent } from './player.js';
import * as S from './shots.js';
import { spotsFor, CHECK_SPOT, rimOf } from './formation.js';
import { AI } from './ai.js';
import { statProfile } from './profile.js';

import { rk as n } from './ratings.js';
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const MOVE_DUR = { cross: 0.4, btl: 0.44, btb: 0.44, spin: 0.56, hesi: 0.5, stepback: 0.56, inout: 0.4 };
const PASS = { chest: { dur: 0.3, rel: 0.13, speed: 12.5 }, bounce: { dur: 0.34, rel: 0.15, speed: 10 }, lob: { dur: 0.44, rel: 0.22 }, alley: { dur: 0.44, rel: 0.22 }, flick: { dur: 0.22, rel: 0.08, speed: 12 }, inbound: { dur: 0.4, rel: 0.2, speed: 11 } };

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
    this.speed = cfg.speed ?? 1.15 * 1.0375; // v0.4.2 +15%, v0.4.4 another +3.75%
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
    this.setup();
  }

  // ---------- helpers ----------
  emit(e) { e.t = this.time; this.events.push(e); this.badgeTriggers(e); return e; }

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
    }
    this.ai.think(dt);
    this.updatePhase(dt);
    const hp = this.human, hpAct = hp && hp.action ? hp.action.id : 0;
    for (const p of this.players) this.applyIntent(p, dt);
    this.humanActed = !!hp && (hp.action ? hp.action.id : 0) !== hpAct;
    for (const p of this.players) this.tickAction(p, dt);
    for (const p of this.players) this.moveOne(p, dt);
    this.collide(dt);
    this.updateBall(dt);
    this.interactions(dt);
    this.rules(dt);
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
    if (this.phase === 'ft' || this.phase === 'tip' || this.phase === 'dead') return;
    if (has) {
      const a = p.action;
      if (a && a.type === 'shoot' && a.releaseAt == null && (it.shoot === 'release' || (p.human && !this.assist && !it.shootHeld && it.shoot !== 'press'))) a.releaseAt = a.t;
      // v0.4.2 bailout: pass out of a jumper any time before the release, on the floor or in the air
      if (a && a.type === 'shoot' && it.pass && !a.released && this.mates(p).length) { this.bailout(p, it.pass); return; }
      if (!this.canAct(p)) return;
      if (this.phase === 'inbound') {
        if (it.pass && p === this.inbounder && this.phaseT <= 0) this.startPass(p, { ...it.pass, type: 'inbound' });
        return;
      }
      if (this.phase === 'check') return;
      if (it.shoot === 'press') { this.startShot(p, it); return; }
      if (it.pass) { this.startPass(p, it.pass); return; }
      if (it.move && b.mode === 'dribble') { this.startMove(p, it.move); return; }
      if (it.move && b.mode === 'held' && !p.dribble.used && (it.move === 'stepback' || it.move === 'cross' || it.move === 'spin')) { b.mode = 'dribble'; this.startMove(p, it.move); return; }
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
    if (a && a.type === 'hang') { p.vx = p.vz = 0; }
    p.move(dt, has, lock);
    if (a && a.type === 'hang') { p.y = a.hangY; p.vy = 0; p.airborne = true; }
    if (a && a.type === 'move' && a.move === 'spin') p.facing = a.f0 + a.dir * Math.PI * 2 * Math.min(1, a.t / a.dur);
    // AI ball handlers never wander out of bounds on their own
    if (has && this.isAI(p) && this.phase === 'live') {
      const mx = COURT.width / 2 - 0.12, mz = COURT.length / 2 - 0.12;
      if (Math.abs(p.x) > mx) { p.x = Math.sign(p.x) * mx; p.vx *= 0.3; }
      if (Math.abs(p.z) > mz) { p.z = Math.sign(p.z) * mz; p.vz *= 0.3; }
      if (this.half && p.z < -0.6) { p.z = -0.6; p.vz = Math.max(0, p.vz); }
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
      let vx = a.vx, vz = a.vz;
      const k = a.move === 'stepback' ? (t < 0.45 ? 1 : 0.15) : a.move === 'hesi' ? (t < 0.6 ? 0.25 : 1.25) : 1;
      p.vx += (vx * k - p.vx) * Math.min(1, dt * 14);
      p.vz += (vz * k - p.vz) * Math.min(1, dt * 14);
      p.x += p.vx * dt * 0; // integration happens in move()
      p.intent.mx = 0; p.intent.mz = 0;
      if (a.move !== 'spin') p.intent.face = a.face;
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
    if (st.type === 'layup' || st.type === 'close' && it.sprint) return this.startLayup(p, rim, st);
    if (st.type === 'dunk') return this.startDunk(p, rim, st);
    const pkg = p.shotPkg;
    const close = st.type === 'close';
    const tRel = close ? 0.42 : pkg.tRel * (p.speed > 2 ? 0.94 : 1);
    const stepback = p.action?.type === 'move' && p.action.move === 'stepback';
    // Biomechanics (jump-shot kinematics literature): a jumper's centre of mass rises only ~15-31 cm, a bit
    // less from deep, and the ball leaves the hand just before the apex. So the jump height is a fraction of
    // max vertical and the takeoff is timed back from the release instead of being a fixed share of it.
    const dRim = Math.hypot(rim.x - p.x, rim.z - p.z);
    const jumpH = p.phys.vertical * (close ? 0.4 : pkg.jumpK * 0.52) * (dRim > 7 ? 0.9 : 1) * (0.85 + 0.15 * p.stamina);
    const tUp = Math.sqrt(2 * jumpH / GRAVITY);
    const a = p.startAction('shoot', tRel + 0.55, {
      tRel, takeoff: Math.max(close ? 0.1 : 0.2, tRel - tUp * 0.9), jumpH, dRim,
      kind: close ? 'close' : 'jumper', fade: !!st.fade || stepback, stepback, startX: p.x, startZ: p.z, moving: p.speed,
      catchShoot: this.lastPass && this.lastPass.to === p.id && this.time - this.lastPass.time < 1.2 && !p.dribble.used && this.ball.mode === 'held',
    });
    // momentum carry & fade
    if (st.fade) { const dx = p.x - rim.x, dz = p.z - rim.z, dl = Math.hypot(dx, dz) || 1; a.driftX = dx / dl * 0.8; a.driftZ = dz / dl * 0.8; }
    // v0.4.2: square up on the gather. Moving away from the hoop the player turns and fades; otherwise he
    // turns to face the rim (the old code averaged angles and could leave him shooting with his back turned).
    a.faceRim = Math.atan2(rim.x - p.x, rim.z - p.z);
    p.facing += wrap(a.faceRim - p.facing) * 0.35;
    this.ball.mode = 'held';
    p.dribble.used = true;
    if (this.isAI(p)) { const r = this.ai.releaseTiming(p, tRel, false, st); a.releaseAt = r.at; a.aiGrade = r.grade; }
    this.emit({ type: 'shotStart', player: p.id, tRel, kind: a.kind });
  }

  startLayup(p, rim, st) {
    const d = Math.hypot(rim.x - p.x, rim.z - p.z);
    const takeoffDist = Math.min(d, 2.2 + this.rng.range(0, 0.5));
    const dx = (rim.x - p.x) / (d || 1), dz = (rim.z - p.z) / (d || 1);
    const travel = Math.max(0, d - takeoffDist);
    const gs = Math.max(2.5, Math.min(5.2, p.speed));
    const takeoff = Math.max(0.24, Math.min(0.55, travel / gs));
    const air = 2 * Math.sqrt(2 * p.phys.vertical * 0.75 / GRAVITY);
    const a = p.startAction('layup', takeoff + air + 0.12, {
      takeoff, release: takeoff + air * 0.48, spotX: p.x + dx * travel, spotZ: p.z + dz * travel, gatherSpeed: gs,
      jumpH: p.phys.vertical * 0.75, side: this.sideFor(p.team), reverse: false, euro: p.intent.move === 'cross',
    });
    this.ball.mode = 'held'; p.dribble.used = true;
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
    const takeoffDist = standing ? Math.min(d, 0.9) : Math.min(d, 1.7 + tier * 0.12 + this.rng.range(-0.2, 0.3));
    const travel = Math.max(0, d - takeoffDist);
    const gs = Math.max(3, Math.min(6.5, p.speed));
    const takeoff = standing ? 0.28 : Math.max(0.24, Math.min(0.5, travel / gs));
    const need = COURT.rimY + 0.22 - p.phys.reach;
    const h = Math.max(need, Math.min(p.phys.vertical * (1.05 + 0.03 * tier), need + 0.25 + 0.05 * tier + (flair >= 2 ? 0.06 : 0)));
    const tUp = Math.sqrt(2 * h / GRAVITY);
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
    if (standing) { styles = styles.filter(s => (S.STYLE_FLAIR[s] ?? 0) <= 1.5); if (!styles.length) styles = ['power']; }
    const tier = S.dunkTier(p);
    const traffic = this.opponents(p).some(d => d.dist(p) < 1.6);
    const ws = styles.map(s => { const f = S.STYLE_FLAIR[s] ?? 0; return traffic ? (f <= 1 ? 2.5 : 0.6) : 1 + f * (0.2 + 0.45 * tier); });
    let r = this.rng.next() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < styles.length; i++) { r -= ws[i]; if (r <= 0) return styles[i]; }
    return styles[styles.length - 1];
  }

  startPass(p, spec) {
    const type = spec.type || 'chest';
    const P = PASS[type] || PASS.chest;
    let target = spec.target != null ? this.players[spec.target] : this.ai.bestPassTarget(p, spec.dir);
    if (!target || target.team !== p.team || target === p) target = this.ai.bestPassTarget(p, spec.dir);
    if (!target) return;
    const flick = type === 'chest' && p.speed > 3.5;
    // v0.4.1: better passers get the ball out quicker (release up to ~25% faster)
    const quick = 1.1 - 0.32 * n(p.ratings.pass_accuracy);
    const a = p.startAction('pass', (flick ? PASS.flick.dur : P.dur) * quick, { ptype: flick ? 'flick' : type, rel: (flick ? PASS.flick.rel : P.rel) * quick, to: target.id });
    p.facing = Math.atan2(target.x - p.x, target.z - p.z) * 0.7 + p.facing * 0.3;
    this.ball.mode = 'held';
    if (type === 'alley') { target.oopCall = this.time; }
    this.emit({ type: 'passStart', player: p.id, to: target.id, ptype: type });
  }

  releasePass(p, a) {
    const target = this.players[a.to];
    const b = this.ball;
    const type = a.ptype;
    const from = this.holdPoint(p);
    const acc = n(p.ratings.pass_accuracy);
    let err = (1 - acc) * 0.26 + Math.min(1, p.speed / 6) * 0.08;
    if (a.bailout) err += a.air ? 0.14 : 0.06; // passing out of a shot is less precise, more so from the air
    let eta = 0.5;
    let T, vx, vy, vz;
    if (type === 'alley') {
      const rim = this.rimFor(target.team);
      // lob to the front of the rim along the receiver's approach
      const ax = target.x - rim.x, az = target.z - rim.z, al = Math.hypot(ax, az) || 1;
      T = { x: rim.x + ax / al * 0.55, y: COURT.rimY + 0.35, z: rim.z + az / al * 0.55 };
      const L = S.solveLaunch(from, T, 52);
      vx = L.vx; vy = L.vy; vz = L.vz;
      a.oopTarget = T;
    } else if (type === 'lob') {
      const tt = 0.9;
      T = { x: target.x + target.vx * tt, y: 2.1, z: target.z + target.vz * tt };
      const L = S.solveLaunch(from, T, 40);
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
    this.emit({ type: 'pass', player: p.id, to: target.id, ptype: type });
    if (this.phase === 'inbound') { this.phase = 'live'; this.emit({ type: 'live' }); }
  }

  startMove(p, move) {
    if (p.cool.move > 0 || p.stamina < 0.04) return;
    // v0.4.3: size-up packages (stat-locked) make moves quicker, chain faster and bite harder
    const dur = (MOVE_DUR[move] || 0.45) / (p.moveSpeed || 1);
    const handle = n(p.ratings.ball_handle);
    const fwdX = Math.sin(p.facing), fwdZ = Math.cos(p.facing), leftX = Math.cos(p.facing), leftZ = -Math.sin(p.facing);
    const hand = p.dribble.hand;
    const toward = hand === 'R' ? 1 : -1; // crossing from right hand moves ball to the left (+left)
    let vx = 0, vz = 0;
    const it = p.intent, il = Math.hypot(it.mx, it.mz);
    const burst = (3.2 + handle * 1.6 + n(p.ratings.speed_with_ball) * 0.8) * (1 + ((p.moveSpeed || 1) - 1) * 0.5);
    const dirX = il > 0.2 ? it.mx / il : fwdX, dirZ = il > 0.2 ? it.mz / il : fwdZ;
    switch (move) {
      case 'cross': case 'btl': case 'btb':
        vx = leftX * toward * burst * 0.75 + dirX * burst * 0.45; vz = leftZ * toward * burst * 0.75 + dirZ * burst * 0.45; break;
      case 'inout': vx = fwdX * burst * 0.7 - leftX * toward * 1.2; vz = fwdZ * burst * 0.7 - leftZ * toward * 1.2; break;
      case 'spin': vx = dirX * burst * 0.8; vz = dirZ * burst * 0.8; break;
      case 'hesi': vx = dirX * burst * 0.9; vz = dirZ * burst * 0.9; break;
      case 'stepback': {
        const rim = this.rimFor(p.team); const rx = p.x - rim.x, rz = p.z - rim.z, rl = Math.hypot(rx, rz) || 1;
        vx = rx / rl * 3.8; vz = rz / rl * 3.8; break;
      }
    }
    const rim = this.rimFor(p.team);
    p.dribble.xover = null;
    const a = p.startAction('move', dur, { move, vx, vz, f0: p.facing, dir: toward, face: Math.atan2(rim.x - p.x, rim.z - p.z), handFrom: hand, switched: false, checked: false, lvl: p.sizeupLvl || 0 });
    if (move === 'spin') { a.dir = hand === 'R' ? -1 : 1; }
    p.stamina -= 0.025 * (p.badges.handles_for_days ? 0.6 : 1);
    p.cool.move = dur * 0.75 / (p.moveSpeed || 1);
    this.ball.mode = 'dribble';
    this.emit({ type: 'move', player: p.id, move });
  }

  // v0.4.4: a reach can be aimed. dir (world) picks the hand: the one on that side of the body; low = a swipe
  // down at the dribble. Without a direction the defender reaches with the hand on the ball's side.
  startSteal(p, dir = null, low = false) {
    const h = this.holder();
    if (h) p.facing = Math.atan2(h.x - p.x, h.z - p.z);
    const lx = Math.cos(p.facing), lz = -Math.sin(p.facing); // the defender's left
    let hand;
    if (dir) hand = dir.x * lx + dir.z * lz >= 0 ? 'L' : 'R';
    else { const b = this.ball; hand = (b.x - p.x) * lx + (b.z - p.z) * lz >= 0 ? 'L' : 'R'; }
    p.startAction('steal', 0.46, { checked: false, hand, low, aimed: !!dir || low });
    p.cool.steal = 0.85 - (p.badges.pick_pocket || 0) * 0.08;
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
    const act = p.startAction(type, air + 0.2, { jumpAt: 0.06, jumpH: hgt, jumped: false, triedBlock: false, air });
    p.stamina -= 0.01;
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
      const maxL = type === 'block'
        ? (jumper ? 0 : 0.18 + 0.36 * n(p.ratings.block) + pw * (0.26 * n(p.ratings.interior_d) + size * 0.8))
        : 0.18 + 0.38 * n(p.ratings[b.info && b.info.team === p.team ? 'off_rebound' : 'def_rebound']) + pw * 0.15 * n(p.ratings.interior_d);
      const len = Math.min(dl - 0.4, maxL);
      if (len > 0.05) act.lunge = { x: dx / dl * len, z: dz / dl * len };
    }
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
        if (!a.released && a.t >= a.release && b.holder === p.id) this.releaseLayup(p, a);
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
        // v0.4.2: contact on the way up -> posterizer (shove / knock down) or the dunker is stopped
        if (a.jumped && !a.slammed && a.posterOn == null && !a.stopped) {
          const ux = rim.x - p.x, uz = rim.z - p.z, ul = Math.hypot(ux, uz) || 1;
          for (const d of this.opponents(p)) {
            const dx = d.x - p.x, dz = d.z - p.z, dd = Math.hypot(dx, dz);
            const along = (dx * ux + dz * uz) / ul, lat = Math.abs(dx * uz - dz * ux) / ul;
            if (dd > p.phys.radius + d.phys.radius + 0.06 || along < 0 || lat > 0.6 || along > ul + 0.3) continue;
            if (d.action?.type === 'stumble') continue;
            // finishing through contact: dunk ratings + Close Shot vs the defender's size and interior D
            const tier = p.badges.posterizer || 0, traffic = S.trafficSkill(p, !!a.standing), pkT = a.tier || 0;
            const pc = Math.max(0.12, Math.min(0.96, 0.45 + 0.44 * traffic + 0.07 * tier + 0.04 * pkT + (p.phys.strength - d.phys.strength) * 0.3 - 0.22 * n(d.ratings.interior_d) - Math.max(0, d.phys.H - p.phys.H) * 0.3 + (d.airborne ? 0.05 : 0)));
            if (this.rng.next() < pc) {
              if (tier > 0 || this.rng.next() < 0.3 + 0.3 * traffic + 0.15 * pkT) this.posterize(p, d, a, rim, true);
              else this.shoulderThrough(p, d, a, rim);
            } else { a.stopped = d.id; p.vx *= 0.45; p.vz *= 0.45; this.emit({ type: 'bump', player: p.id, defender: d.id, v: 2 }); }
            break;
          }
        }
        if (!a.slammed && a.t >= a.slam && b.holder === p.id) {
          // you can only dunk with your hands at the rim: if the body never got there it's a flip at the rim
          const reachFront = a.style === 'reverse' ? 0.2 : 0.42;
          const hx = p.x + Math.sin(p.facing) * reachFront, hz = p.z + Math.cos(p.facing) * reachFront;
          if (Math.hypot(hx - rim.x, hz - rim.z) > 0.62 && Math.hypot(p.x - rim.x, p.z - rim.z) > 0.75) {
            a.slammed = true; a.hang = 0; a.release = a.t;
            this.emit({ type: 'feed', text: `${p.name} couldn't get to the rim` });
            this.releaseLayup(p, a);
          } else this.slam(p, a, rim);
        }
        if (a.slammed && a.hang > 0 && p.action === a) {
          // transition to hang
          p.action = null;
          const hangY = COURT.rimY + 0.06 - p.phys.reach * 0.98;
          p.startAction('hang', a.hang, { hangY: Math.max(0.2, hangY), side: a.side });
          p.x = rim.x + Math.sin(p.facing + Math.PI) * 0.42; p.z = rim.z + Math.cos(p.facing + Math.PI) * 0.42;
          p.x = rim.x - Math.sin(p.facing) * 0.4; p.z = rim.z - Math.cos(p.facing) * 0.4;
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
        if (!a.released && a.t >= a.rel) { a.released = true; if (b.holder === p.id) this.releasePass(p, a); }
        if (a.t >= a.dur) p.action = null;
        break;
      }
      case 'move': {
        if (!a.switched && a.t >= a.dur * 0.5 && (a.move === 'cross' || a.move === 'btl' || a.move === 'btb')) { a.switched = true; p.dribble.hand = p.dribble.hand === 'R' ? 'L' : 'R'; }
        if (!a.checked && a.t >= a.dur * 0.55) { a.checked = true; this.ankleCheck(p, a); }
        if (a.t >= a.dur) { p.action = null; if (a.move === 'hesi') { p.vx *= 1.1; p.vz *= 1.1; } }
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
        if (a.t >= a.dur && !p.airborne) p.action = null;
        break;
      }
      case 'oop': {
        if (!a.jumped && a.t >= a.jumpAt) { a.jumped = true; p.jump(a.jumpH); const dx = a.T.x - p.x, dz = a.T.z - p.z, dl = Math.hypot(dx, dz) || 1; const go = Math.max(0, dl - 0.35); p.vx = dx / dl * go / a.tUp; p.vz = dz / dl * go / a.tUp; }
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
    const attr = a.kind === 'close' ? p.ratings.close_shot : null;
    const three = !this.practiceFT && isThree(a.startX, a.startZ, side);
    const d = Math.hypot(rim.x - a.startX, rim.z - a.startZ);
    const shotAttr = a.kind === 'close' ? attr : (three ? p.ratings.three_point : p.ratings.mid_range);
    const P = this.holdPoint(p);
    const contest = S.contestFor(p, this.opponents(p), rim, P.y);
    const corner = three && Math.abs(a.startX) > 6.2;
    const win = S.greenWindowMs(shotAttr, p.badges, { contest, moving: a.moving, fade: a.fade, d, three, catchShoot: a.catchShoot, corner, pkg: a.kind === 'close' ? null : p.shotPkg }) * this.speed * (p.human ? this.greenBonus : 1);
    let grade = a.kind === 'close' ? 'none' : (a.aiGrade && this.isAI(p) ? a.aiGrade : S.gradeFromWindow(err, win));
    if (grade === 'excellent' && contest >= S.SMOTHER) grade = err < 0 ? 'early' : 'late'; // no greens while smothered
    const clutch = this.isClutch(p.team);
    let chance = S.finalChance({ type: a.kind === 'close' ? 'close' : 'jumper', d, a: p.ratings, three, grade, contest, moving: a.moving, fade: a.fade, stamina: p.stamina, badges: p.badges, catchShoot: a.catchShoot, corner, hot: p.hot, clutch });
    if (grade === 'excellent') chance = 1; // greens always go in (unless blocked in flight)
    const foul = this.checkShootingFoul(p, contest, 'jumper');
    const made = grade === 'excellent' || this.rng.next() < chance;
    const plan = S.planShot(this.rng, P, rim, side, made, a.kind === 'close' ? 58 : p.shotPkg.arc, { halfOnly: this.half, surface: b.surface, swish: grade === 'excellent', guarantee: grade === 'excellent', bad: grade === 'vearly' || grade === 'vlate', bank: a.kind === 'close' });
    b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, 'shot', { shooter: p.id, team: p.team, three, type: a.kind, made: plan.made, grade, chance, side, contest, foul, released: this.time, d, putback: false, catchShoot: !!a.catchShoot, corner, clutch: clutch && !!p.badges.clutch });
    b.wx = plan.wx; b.wy = plan.wy; b.wz = plan.wz;
    b.ghost = !!plan.ghost;
    b.lastTouch = p.id; b.lastTeam = p.team;
    p.stats.fga++; if (three) p.stats.tpa++;
    if (grade === 'excellent') p.stats.greens++;
    this.lastShot = { shooter: p.id, team: p.team, time: this.time, three };
    this.shotLog.push({ x: a.startX, z: a.startZ, team: p.team, player: p.id, three, made: plan.made, grade });
    this.emit({ type: 'release', player: p.id, grade, chance, contest, three, made: plan.made, kind: a.kind });
    if (foul) this.pendingFoul = foul;
  }

  releaseLayup(p, a) {
    a.released = true;
    const b = this.ball;
    const rim = this.rimFor(p.team), side = this.sideFor(p.team);
    const P = this.holdPoint(p);
    const d = Math.hypot(rim.x - p.x, rim.z - p.z);
    const contest = S.contestFor(p, this.opponents(p), rim, P.y);
    const blocker = this.checkBlockAtRelease(p, P, 'layup');
    if (blocker) return;
    const chance = S.finalChance({ type: 'layup', d, a: p.ratings, three: false, contest, stamina: p.stamina, badges: p.badges, hot: p.hot });
    const foul = this.checkShootingFoul(p, contest, 'layup');
    const made = this.rng.next() < chance;
    const plan = S.planShot(this.rng, P, rim, side, made, 64, { halfOnly: this.half, surface: b.surface, bank: Math.abs(p.x) > 0.8 });
    b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, 'shot', { shooter: p.id, team: p.team, three: false, type: 'layup', made: plan.made, chance, side, contest, foul, released: this.time, d });
    b.wx = plan.wx * 0.5; b.wz = plan.wz * 0.5;
    b.lastTouch = p.id; b.lastTeam = p.team;
    p.stats.fga++;
    this.lastShot = { shooter: p.id, team: p.team, time: this.time, three: false };
    this.shotLog.push({ x: p.x, z: p.z, team: p.team, player: p.id, three: false, made: plan.made, grade: 'none' });
    this.emit({ type: 'release', player: p.id, grade: 'none', chance, contest, three: false, made: plan.made, kind: 'layup' });
    if (foul) this.pendingFoul = foul;
  }

  slam(p, a, rim) {
    a.slammed = true;
    const b = this.ball;
    const P = this.holdPoint(p);
    const blocker = this.checkBlockAtRelease(p, P, 'dunk');
    if (blocker) { a.hang = 0; return; }
    const contest = S.contestFor(p, this.opponents(p), rim, COURT.rimY + 0.3);
    const traffic = S.trafficSkill(p, !!a.standing);
    let chance = S.finalChance({ type: 'dunk', d: 0.5, a: p.ratings, contest: contest * 0.8, stamina: p.stamina, badges: p.badges, traffic });
    if (a.posterOn != null) chance = Math.min(0.97, chance + 0.12);
    const made = this.rng.next() < chance;
    let poster = a.posterOn != null ? this.players[a.posterOn] : null;
    if (!poster && made) {
      // a contest in the air at the rim: the dunker goes through him -> knock him back as he comes down
      poster = this.opponents(p).find(d => d.dist(p) < 1.1 && (d.airborne || d.action?.type === 'block')) || null;
      if (poster) this.posterize(p, poster, a, rim, false);
    }
    if (made) {
      b.setFlight(rim.x + (this.rng.next() - 0.5) * 0.04, COURT.rimY + 0.22, rim.z + (this.rng.next() - 0.5) * 0.04, 0, -5.5, 0, 'shot', { shooter: p.id, team: p.team, three: false, type: 'dunk', made: true, chance, side: a.side, contest, released: this.time, poster: poster ? poster.id : -1, style: a.style });
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
    a.hang = made && (a.style === 'power' || a.style === 'tomahawk' || a.style === 'double' || this.rng.next() < 0.35 + 0.1 * (a.tier || 0)) ? 0.45 + 0.12 * (a.tier || 0) + this.rng.range(0, 0.35) : 0;
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
    const fall = this.rng.next() < 0.45 + 0.1 * (p.badges.posterizer || 0) + 0.13 * pkT;
    d.startAction('stumble', fall ? 2.4 + 0.3 * pkT + this.rng.range(0, 0.8) : 1.0 + 0.15 * pkT, { fall, back: !fall, dir: this.rng.next() < 0.5 ? 1 : -1, poster: true, hard: pkT });
    d.vx = nx / nl * push; d.vz = nz / nl * push;
    if (!d.airborne) { d.x += nx / nl * 0.22; d.z += nz / nl * 0.22; }
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
    d.vx = lx * 2.2 + ux / ul * 0.8; d.vz = lz * 2.2 + uz / ul * 0.8;
    if (!d.airborne) { d.x += lx * 0.18; d.z += lz * 0.18; }
    if (!d.action || d.action.type !== 'block') { d.action = null; d.startAction('stumble', 0.6, { fall: false, back: true, dir: sx }); }
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
      const env = 0.88 + 0.1 * n(d.ratings.block) + pw * (0.15 * n(d.ratings.interior_d) + Math.max(0, d.phys.WS - 2.05) * 0.4);
      if (dist > env || dy > 0.3 + 0.12 * n(d.ratings.block)) continue;
      d.action.triedBlock = true;
      const behind = ((p.x - d.x) * Math.sin(p.facing) + (p.z - d.z) * Math.cos(p.facing)) > 0; // defender behind shooter
      const size = Math.max(-0.25, Math.min(0.3, d.phys.H - p.phys.H));
      let pb = 0.07 + 0.24 * n(d.ratings.block) + pw * (0.12 * n(d.ratings.interior_d) + size * 0.25) - (kind === 'dunk' ? 0.26 * S.trafficSkill(p, !!p.action?.standing) : 0.15 * n(p.ratings.layup)) + (hy - P.y) * 0.3 - dist / env * 0.14;
      pb += (d.badges.rim_protector || 0) * 0.025 + (behind ? (d.badges.chasedown || 0) * 0.04 : 0);
      if (kind === 'dunk') pb -= (p.badges.posterizer || 0) * 0.05;
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
    if (kind !== 'jumper' && p.badges.contact_finisher) pf += 0.02;
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
      let pk = 0.002 + 0.03 * n(p.ratings.ball_handle) - 0.03 * n(d.ratings.perimeter_d) + (p.badges.ankle_breaker || 0) * 0.015 + ((p.moveSpeed || 1) - 1) * 0.06;
      if (dv > 2.5 && moveDir < -0.4) pk += 0.05;
      if (d.action?.type === 'steal') pk += 0.12;
      if (a.move === 'hesi' || a.move === 'stepback') pk *= 0.7;
      if (this.rng.next() < Math.max(0, pk)) {
        d.action = null;
        d.startAction('stumble', 1.35 + this.rng.range(0, 0.4), { fall: this.rng.next() < 0.55, dir: this.rng.next() < 0.5 ? 1 : -1 });
        d.vx *= 0.3; d.vz *= 0.3;
        p.stats.ankles++;
        this.emit({ type: 'ankle', player: p.id, victim: d.id });
        return;
      }
    }
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
    let pc = 0.012 + 0.2 * n(p.ratings.steal) + 0.015 * n(p.ratings.perimeter_d) - 0.15 * n(h.ratings.ball_handle) + (p.badges.pick_pocket || 0) * 0.02;
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
      if (this.mode === 'proam' && this.rng.next() < (0.1 + (dist < 0.8 ? 0.08 : 0)) * foulK) this.callFoul(p, h, false);
    }
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
  holdPoint(p, out = {}) {
    const H = p.phys.H, a = p.action, b = this.ball;
    const hs = p.dribble.hand === 'R' ? -1 : 1;
    let lx = hs * 0.12, ly = 0.53 * H, lz = 0.3;
    if (a && a.type === 'shoot') {
      const sh = p.shotPkg.hand === 'L' ? 1 : -1;
      const t = a.t, T = a.tRel;
      const pocket = [sh * 0.06, 0.6 * H, 0.32], set = [sh * 0.07, p.shotPkg.setH * H, 0.2], rel = [sh * 0.05, p.phys.reach * (p.shotPkg.relK ?? 0.93), 0.3 + p.shotPkg.push];
      const k1 = Math.min(1, t / (T * 0.62)), k2 = Math.max(0, Math.min(1, (t - T * 0.62) / (T * 0.38)));
      const e1 = k1 * k1 * (3 - 2 * k1), e2 = k2 * k2;
      lx = pocket[0] + (set[0] - pocket[0]) * e1 + (rel[0] - set[0]) * e2;
      ly = pocket[1] + (set[1] - pocket[1]) * e1 + (rel[1] - set[1]) * e2;
      lz = pocket[2] + (set[2] - pocket[2]) * e1 + (rel[2] - set[2]) * e2;
    } else if (a && a.type === 'layup') {
      const t = Math.min(1, a.t / a.release), e = t * t * (3 - 2 * t);
      const sh = -1;
      lx = sh * 0.1 * (1 - e) + sh * 0.05; ly = 0.62 * H + (p.phys.reach * 0.97 - 0.62 * H) * e; lz = 0.3 + e * 0.08;
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
        const k = Math.min(1, t / 0.9), ek = k * k * (3 - 2 * k);
        const al = -0.35 * Math.PI - 1.32 * Math.PI * ek, R = 0.37 * H, cy = 0.9 * H;
        const cx = st === 'cradle' ? -0.18 - 0.16 * Math.sin(Math.PI * k) : -0.14;
        const cyy = cy + R * Math.sin(al), czz = (st === 'cradle' ? 0.08 : 0.02) + R * Math.cos(al) * (st === 'cradle' ? 0.8 : 1);
        const f = Math.max(0, (t - 0.82) / 0.18), ef = f * f * (3 - 2 * f);
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
      } else if (st === 'reverse') {
        ly = 0.65 * H + (topY * 0.99 - 0.65 * H) * e; lz = 0.3 + e * 0.05 - Math.sin(Math.PI * t) * 0.18; lx = 0;
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
        ly = 0.6 * H + (p.phys.reach * 0.88 - 0.6 * H) * e; lz = 0.3 + e * 0.1; lx = -0.05;
      }
    } else if (b.mode === 'dribble' && b.holder === p.id) {
      const sp = p.speed;
      const ph = p.dribble.phase;
      const hgt = (0.47 - Math.min(0.08, sp * 0.012)) * H;
      let side = hs * (0.26 + Math.min(0.08, sp * 0.012));
      lz = 0.24 + Math.min(0.32, sp * 0.06);
      ly = BALL_R + (hgt - BALL_R) * Math.abs(Math.cos(Math.PI * ph));
      if (a && a.type === 'move') {
        const t = a.t / a.dur;
        const from = a.handFrom === 'R' ? -1 : 1;
        if (a.move === 'cross' || a.move === 'btl' || a.move === 'btb') {
          const e = t * t * (3 - 2 * t);
          side = from * 0.28 * (1 - 2 * e);
          if (a.move === 'btl') lz = 0.05 + Math.abs(0.5 - e) * 0.4;
          if (a.move === 'btb') lz = -0.22 + Math.abs(0.5 - e) * 0.8;
          ly = BALL_R + (hgt - BALL_R) * Math.abs(Math.cos(Math.PI * e)) * (a.move === 'btl' ? 0.8 : 1);
        } else if (a.move === 'inout') {
          side = from * (0.28 - Math.sin(t * Math.PI) * 0.26);
        } else if (a.move === 'spin') {
          side = from * 0.2; lz = 0.18; ly = 0.5 * H * (0.85 + Math.sin(t * Math.PI) * 0.15);
        } else if (a.move === 'hesi') {
          ly = BALL_R + (0.55 * H - BALL_R) * Math.abs(Math.cos(Math.PI * Math.min(1, t * 1.5)));
        }
      } else if (p.dribble.xover) {
        // v0.4.3 size-up rhythm (Quick / Elite packages): in-place crossovers and between-the-legs
        const e = ph * ph * (3 - 2 * ph);
        side = side * (1 - 2 * e);
        if (p.dribble.xover === 'btl') lz = 0.04 + Math.abs(0.5 - e) * 0.4;
      }
      lx = side;
    } else if (b.holder === p.id && b.mode === 'held') {
      if (this.phase === 'check' || this.phase === 'inbound') { lx = 0; ly = 0.64 * H; lz = 0.32; }
      else { lx = hs * 0.14; ly = 0.56 * H; lz = 0.3; }
    }
    return toWorld(p, lx, ly, lz, out);
  }

  updateBall(dt) {
    const b = this.ball;
    if (b.holder >= 0 && (b.mode === 'held' || b.mode === 'dribble')) {
      const p = this.players[b.holder];
      if (b.mode === 'dribble') {
        const freq = (1.55 + Math.min(1.1, p.speed * 0.2) + (p.action?.type === 'move' ? 0.6 : 0)) * (p.dribble.xover ? 1 + 0.12 * (p.sizeupLvl || 0) : 1);
        const prev = p.dribble.phase;
        p.dribble.phase = (p.dribble.phase + freq * dt) % 1;
        if (p.dribble.phase < prev) {
          // the ball is back in a hand: finish a size-up crossover, then maybe start another
          if (p.dribble.xover) { p.dribble.hand = p.dribble.hand === 'R' ? 'L' : 'R'; p.dribble.xover = null; }
          const lvl = p.sizeupLvl || 0;
          if (lvl > 0 && !p.action && p.speed < 1.2 && this.opponents(p).some(d => d.dist(p) < 2.6) && this.rng.next() < [0, 0.45, 0.7][lvl])
            p.dribble.xover = lvl >= 2 && this.rng.next() < 0.45 ? 'btl' : 'cross';
        }
        if (prev < 0.5 && p.dribble.phase >= 0.5) { const w = this.holdPoint(p); this.emit({ type: 'dribble', x: w.x, z: w.z, player: p.id }); }
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
        shooter.hot = Math.min(3, shooter.hot + 1);
        // assist
        const lp = this.lastPass;
        if (lp && lp.to === shooter.id && this.players[lp.from].team === team && (info.released ?? this.time) - lp.time < 3.2 && !info.ft) {
          this.players[lp.from].stats.ast++;
          this.emit({ type: 'assist', player: lp.from, to: shooter.id });
        }
      }
      for (const p of this.teams[1 - team]) p.hot = Math.max(0, p.hot - 0.5);
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
        if (dd < 0.56 + 0.08 * n(d.ratings.block) && dy < 0.15 && dy > -0.9) {
          d.action.triedBlock = true;
          const shooter = this.players[b.info.shooter];
          // v0.4.3: Perimeter D outside, Interior D and size in the paint
          const pw = S.paintWeight(b.info.d ?? 6), size = Math.max(-0.25, Math.min(0.3, d.phys.H - shooter.phys.H));
          const pb = 0.1 + 0.26 * n(d.ratings.block) + (1 - pw) * 0.06 * n(d.ratings.perimeter_d) + pw * (0.12 * n(d.ratings.interior_d) + size * 0.3) - 0.1 * n(shooter.ratings.three_point) + (d.badges.rim_protector || 0) * 0.02 - dd * 0.25;
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
          let pi = 0.05 + 0.2 * n(p.ratings.steal) - 0.15 * n(info.from >= 0 ? this.players[info.from].ratings.pass_accuracy : 80) + (p.badges.interceptor || 0) * 0.03 - dist * 0.25;
          if (p.handsUp || p.stance === 'defense') pi += 0.05;
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
    }
    // rebounds & loose ball recovery
    if (reboundable || kind === 'loose' || kind === 'tip') {
      const cands = [];
      const wasShotBall = kind === 'shot' || (b.info && b.info.shooter != null && !b.info.poke && !b.info.blocked);
      for (const p of this.players) {
        if (p.action?.type === 'stumble' || p.action?.type === 'hang') continue;
        if (b.info && b.info.shooter === p.id && b.flightTime < 0.6) continue;
        if (p.fumbleUntil && this.time < p.fumbleUntil) continue;
        if (this.isOut(p.x, p.z, 0.05) && !p.airborne) continue;
        const dist = Math.hypot(b.x - p.x, b.z - p.z);
        // v0.4.1: slightly bigger hands-on-ball radius (rebound rating helps), so fewer balls squirt free
        const off = b.info && b.info.team === p.team;
        const rr = n(off ? p.ratings.off_rebound : p.ratings.def_rebound);
        const grabR = 0.62 + rr * 0.08 + Math.max(0, p.phys.WS - 2) * 0.25 + (p.airborne ? 0.14 : 0);
        if (dist > grabR) continue;
        if (b.y > p.reachNow() + 0.15) continue;
        if (b.y > 2.2 && b.vy > 0.5) continue;
        if (b.y < 1.1 && dist > 0.85) continue;
        // position beats luck: being closer, airborne at the right time, and sealing an opponent behind you
        let score = this.rng.next() * 0.4 + (1 - dist / grabR) * 1.0 + (p.airborne ? 0.35 : 0) + p.phys.strength * 0.25;
        // v0.4.3: the rebound rating and size weigh more
        score += rr * 1.25 + Math.max(-0.15, Math.min(0.2, (p.phys.H - 1.98) * 0.7)) + (p.badges.rebound_chaser || 0) * 0.08;
        if (!off && wasShotBall) score += 0.3; // defenders start with inside position
        // box-outs: sealing an opponent behind you is worth more the stronger your Interior D is than his
        let seal = 0;
        for (const q of this.opponents(p)) {
          const dq = Math.hypot(b.x - q.x, b.z - q.z);
          if (Math.hypot(q.x - p.x, q.z - p.z) < 1.4 && dq > dist + 0.2) {
            const edge = (n(p.ratings.interior_d) - n(q.ratings.interior_d)) * 0.8 + (p.phys.strength - q.phys.strength) * 0.5 + (p.phys.H - q.phys.H) * 0.4;
            seal = Math.max(seal, 0.24 + 0.22 * n(p.ratings.interior_d) + Math.max(-0.15, Math.min(0.4, edge)));
          }
        }
        score += seal;
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
    b.mode = 'held'; b.holder = p.id; b.kind = null;
    b.lastTouch = p.id; b.lastTeam = p.team;
    p.dribble.live = true; p.dribble.used = false;
    if (!p.action || p.action.type === 'catch' || p.action.type === 'rebound' || p.action.type === 'block') {
      if (!p.airborne) { p.action = null; p.startAction('catch', 0.18, {}); }
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
    b.mode = 'held'; b.holder = p.id; b.kind = null;
    b.lastTouch = p.id; b.lastTeam = p.team;
    const canDunk = (p.ratings.driving_dunk ?? 50) >= 58 && p.phys.reach + p.y > COURT.rimY + 0.05;
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
      const a = p.startAction('layup', 0.5, { takeoff: 0, release: 0.1, jumped: true, jumpH: 0, spotX: p.x, spotZ: p.z, gatherSpeed: 0, side: this.sideFor(p.team) });
      a.oop = true;
      this.emit({ type: 'oopCatch', player: p.id });
    }
  }

  // ---------- collisions ----------
  // v0.4.3: how hard a player is to move off his spot by opponent q. Boxing out (back to him, ball in the air)
  // scales with Interior D and rebounding plus the Interior D edge; defenders in the paint anchor with Interior D.
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
      if ((a.action?.through === c.id) || (c.action?.through === a.id)) continue; // dunker already went through that contact
      const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
      const r = a.phys.radius + c.phys.radius;
      if (d >= r || d < 1e-5) continue;
      if (Math.abs(a.y - c.y) > 1.2) continue;
      const nx = dx / d, nz = dz / d, pen = r - d;
      let ma = a.phys.W * (0.7 + 0.6 * a.phys.strength), mc = c.phys.W * (0.7 + 0.6 * c.phys.strength);
      if (a.team !== c.team) { ma *= this.anchorK(a, c); mc *= this.anchorK(c, a); }
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
          handler.vx *= 0.5; handler.vz *= 0.5;
          if (!handler.action) handler.startAction('bump', 0.32, {});
          this.emit({ type: 'bump', player: handler.id, defender: def.id, v: -rv });
          // v0.4.4: Brick Wall on bumps is a defensive badge: the defender stops the drive harder
          if (def.badges.brick_wall) { handler.bumpT += 0.06 * def.badges.brick_wall; handler.vx *= 1 - 0.08 * def.badges.brick_wall; handler.vz *= 1 - 0.08 * def.badges.brick_wall; this.badgeFx(def, 'brick_wall'); }
          const pwB = S.paintWeight(Math.hypot(def.x - this.rimFor(handler.team).x, def.z - this.rimFor(handler.team).z));
          const strip = (0.012 + Math.max(0, def.phys.strength - handler.phys.strength) * 0.08 - n(handler.ratings.ball_handle) * 0.02 + (def.badges.brick_wall || 0) * 0.015) * (1 - 0.5 * pwB);
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
          if (s.team === this.possession && s !== h && s.speed < 0.8 && d2.team !== this.possession && d2.bumpT <= 0) {
            if (shotUp || (this.ball.info && this.ball.info.shooter === s.id) || ['shoot', 'layup', 'dunk', 'land', 'celebrate'].includes(s.action?.type)) continue;
            if (d2.speed < 1.0) continue; // he has to be moving into it
            // Brick Wall: the screener's makes the screen hit harder (offense); a defender's fights through it (defense)
            const bw = s.badges.brick_wall || 0, dbw = d2.badges.brick_wall || 0;
            d2.bumpT = Math.max(0.12, 0.3 + bw * 0.08 - dbw * 0.05);
            this.emit({ type: 'screen', player: s.id, victim: d2.id });
            if (bw) this.badgeFx(s, 'brick_wall');
            if (dbw) this.badgeFx(d2, 'brick_wall');
          }
        }
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
      // out of bounds: ball handler
      if (h && !h.airborne && this.isOut(h.x, h.z, 0.05)) { this.turnover(h, 'Out of bounds'); return; }
      // ball out of bounds
      if (b.mode === 'flight' && b.y < BALL_R + 0.02 && this.isOut(b.x, b.z, 0)) {
        const team = 1 - (b.lastTeam >= 0 ? b.lastTeam : this.possession);
        this.emit({ type: 'oob' });
        this.feedMsg('Out of bounds');
        this.deadBall(1.2, () => this.restartFor(team, b.x, b.z));
        return;
      }
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

  isOut(x, z, pad) {
    if (Math.abs(x) > COURT.width / 2 + pad) return true;
    if (Math.abs(z) > COURT.length / 2 + pad) return true;
    if (this.half && z < -1.0) return true;
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
          const win = S.greenWindowMs(p.ratings.free_throw, p.badges, { ft: true }) * this.speed * (p.human ? this.greenBonus : 1);
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
          this.emit({ type: 'release', player: p.id, grade, chance, contest: 0, three: false, made: plan.made, kind: 'ft' });
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
