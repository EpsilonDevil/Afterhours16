// The store / My Player animation preview as plain simulation, no graphics: what the player and the ball do on
// the podium. The Showroom draws it; tests drive it directly to check that every animation package looks
// different (v0.4.5 stage 7).
import { Player } from '../sim/player.js';
import { Game } from '../sim/game.js';
import { GRAVITY, BALL_R } from '../sim/constants.js';
import { advanceDribble, LAYUP_FEEL, LAYUP_COVER } from '../sim/shots.js';

const holdPoint = Game.prototype.holdPoint;

export class PreviewSim {
  constructor() {
    this.player = null;
    this.preview = 'idle'; this.previewOpts = {};
    this.pt = 0; this.loopT = 0; this.loopN = 0;
    this.ballFree = null;
  }
  setPlayer(build, catalog) {
    this.player = new Player(0, 0, { build: { ...build, attributes: build.attributes || {} }, name: build.name || 'Player' }, catalog);
    this.fake = { ball: { mode: 'dribble', holder: 0 }, phase: 'live', players: [this.player] };
    this.pt = 0;
  }
  setPreview(kind, opts = {}) { this.preview = kind; this.previewOpts = opts; this.pt = 0; this.loopT = 0; this.loopN = 0; this.ballFree = null; this.prng = 0; if (this.player) { this.player.action = null; this.player.y = 0; this.player.airborne = false; } }
  // v0.4.5: true once per loop, however slow the frame rate (the old `t < 0.05` test could be skipped over
  // entirely on a slow machine, and the preview would stop after one pass)
  loop(total, dt) { this.loopT = (this.loopT || 0) - dt; if (this.loopT > 0) return false; this.loopT = total; return true; }

  // advance the preview by dt with the player facing `facing`; returns the ball (world, podium-top) and
  // whether he has it, for the animator
  step(dt, facing) {
    const p = this.player;
    this.pt += dt;
    p.facing = facing;
    p.vx = 0; p.vz = 0;
    this.run(dt);
    // vertical motion
    if (p.airborne) { p.vy -= GRAVITY * dt; p.y += p.vy * dt; if (p.y <= 0) { p.y = 0; p.vy = 0; p.airborne = false; } }
    if (p.action) { p.action.t += dt; }
    let bp = null;
    if (this.ballFree) {
      const b = this.ballFree;
      b.vy -= GRAVITY * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < BALL_R + 0.12 && Math.hypot(b.x, b.z) < 1.3) { b.y = BALL_R + 0.12; b.vy = -b.vy * 0.7; b.vx *= 0.8; b.vz *= 0.8; }
      else if (b.y < BALL_R) { b.y = BALL_R; b.vy = -b.vy * 0.7; b.vx *= 0.8; b.vz *= 0.8; }
      bp = { x: b.x, y: b.y, z: b.z };
    } else if (this.fake.ball.holder === 0) {
      const h = holdPoint.call(this.fake, p, {});
      bp = { x: h.x, y: h.y + 0.12, z: h.z };
    }
    return { ball: bp, hasBall: this.fake.ball.holder === 0 && !this.ballFree, ballMode: this.fake.ball.mode };
  }

  run(dt) {
    const p = this.player, fb = this.fake.ball;
    const kind = this.preview;
    if (kind === 'idle' || kind === 'dribble' || kind === 'moves') {
      fb.holder = 0; this.ballFree = null;
      const cycle = 7;
      const t = this.pt % cycle;
      const dribbling = kind !== 'idle' || t > 3.2;
      fb.mode = dribbling ? 'dribble' : 'held';
      if (kind !== 'moves') { if (dribbling) p.dribble.phase = (p.dribble.phase + 1.6 * dt) % 1; }
      else {
        // v0.4.5 stage 7: a size-up preview is what it looks like in a game: sizing the defender up in place with
        // the package's own rhythm, height, width and combos (the same code the game runs), then a couple of
        // moves at the package's speed
        const o = this.previewOpts || {};
        if (o.style) { p.sizeupStyle = o.style; p.sizeupLvl = o.lvl ?? p.sizeupLvl; }
        this.prng = this.prng || 12345;
        advanceDribble(p, dt, () => (this.prng = (this.prng * 16807) % 2147483647) / 2147483647, true);
        const ct = this.pt % 4.8, ms = o.speed || p.moveSpeed || 1;
        if (!p.action && ct > 2.9 && ct < 4.4 && this.pt > 0.6) {
          p.dribble.xover = null;
          const mv = ['cross', 'btl', 'btb', 'hesi', 'cross', 'spin'][Math.floor(this.pt / 0.6) % 6];
          const durs = { cross: 0.4, btl: 0.44, btb: 0.44, spin: 0.56, hesi: 0.5 };
          p.startAction('move', durs[mv] / ms, { move: mv, handFrom: p.dribble.hand, vx: 0, vz: 0, f0: p.facing, dir: 1 });
        }
      }
      if (p.action && p.action.type === 'move' && p.action.t >= p.action.dur) {
        if (['cross', 'btl', 'btb'].includes(p.action.move)) p.dribble.hand = p.dribble.hand === 'R' ? 'L' : 'R';
        p.action = null;
      }
      p.stance = 'normal';
      return;
    }
    if (kind === 'walk' || kind === 'jog' || kind === 'sprint') {
      // treadmill locomotion preview (the gait is velocity-driven, so the athlete runs in place)
      const v = { walk: 1.4, jog: 3.8, sprint: 6.8 }[kind];
      p.vx = Math.sin(p.facing) * v; p.vz = Math.cos(p.facing) * v;
      fb.holder = -1; fb.mode = 'dead'; this.ballFree = null; p.action = null;
      return;
    }
    if (kind === 'jumpshot') {
      const pkg = p.shotPkg;
      const tRel = pkg.tRel, jumpH = p.phys.vertical * pkg.jumpK * 0.52, tk = Math.max(0.2, tRel - Math.sqrt(2 * jumpH / 9.81) * 0.9), total = tRel + 1.9;
      if (this.loop(total, dt) && (!p.action || p.action.type !== 'shoot')) {
        fb.holder = 0; fb.mode = 'held'; this.ballFree = null; p.action = null;
        p.startAction('shoot', tRel + 0.6, { tRel, takeoff: tk, releaseAt: tRel, jumpH, dRim: 5, kind: 'jumper', icon: this.previewOpts?.icon || null });
      }
      const a = p.action;
      if (a && !a.jumped && a.t >= tk) { a.jumped = true; p.jump(a.jumpH); }
      if (a && !a.released && a.t >= tRel) {
        a.released = true;
        const bp = holdPoint.call(this.fake, p, {});
        const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
        // v0.4.5 stage 7: the ball leaves at the release's own launch angle (a Dart is flat, a Rainbow sky high),
        // aimed at a rim 5.2 m away, the same way it flies in a game
        const th = (pkg.arc || 52) * Math.PI / 180, dist = 5.2, dy = 3.05 - bp.y;
        const v = Math.sqrt(GRAVITY * dist * dist / (2 * Math.cos(th) ** 2 * Math.max(0.5, dist * Math.tan(th) - dy)));
        this.ballFree = { x: bp.x, y: bp.y + 0.12, z: bp.z, vx: fx * v * Math.cos(th), vy: v * Math.sin(th), vz: fz * v * Math.cos(th) };
        fb.holder = -1;
      }
      if (a && a.t > a.dur + 0.8) { p.action = null; }
      return;
    }
    if (kind === 'layup') {
      // v0.4.5 layup package preview: gather, one-foot takeoff and the finish, on a loop
      // v0.4.5: the package's own finish first, then how it changes against the defense: away from a side defender,
      // a reverse around a shot blocker, the hang into a wall, quick ahead of a chaser (one per loop, its own timing)
      const style = this.previewOpts?.style || 'basic', covs = ['open', 'side', 'rim', 'front', 'trail'];
      if (this.loop(2.6, dt) && (!p.action || p.action.type !== 'layup')) {
        const cov = this.previewOpts?.cov || covs[(this.loopN || 0) % covs.length]; this.loopN = (this.loopN || 0) + 1;
        const feel = LAYUP_FEEL[style] || LAYUP_FEEL.basic, release = 0.3 + 0.875 * Math.min(0.85, feel.rel + LAYUP_COVER[cov].rel);
        fb.holder = 0; fb.mode = 'held'; this.ballFree = null; p.action = null;
        p.startAction('layup', 1.5, { takeoff: 0.3, release, tRel: release, jumpH: p.phys.vertical * 0.75, lstyle: style, lsDir: 1, cov, covSide: 1, spotX: p.x, spotZ: p.z, gatherSpeed: 3.5 });
      }
      const a = p.action;
      if (a && !a.jumped && a.t >= a.takeoff) { a.jumped = true; p.jump(a.jumpH); }
      if (a && !a.released && a.t >= a.release) { a.released = true; const bp = holdPoint.call(this.fake, p, {}); this.ballFree = { x: bp.x, y: bp.y + 0.12, z: bp.z, vx: 0, vy: 1.6, vz: 0.6 }; fb.holder = -1; }
      if (a && a.t > a.dur) p.action = null;
      return;
    }
    if (kind === 'dunk') {
      // v0.4.5 stage 7: the package's signature finish every other loop, its other finishes in between
      const o = this.previewOpts || {}, list = o.styles?.length ? o.styles : [o.style || 'power'];
      const n = this.loopN || 0, style = n % 2 === 0 || list.length < 2 ? list[0] : list[1 + ((n >> 1) % (list.length - 1))];
      if (this.loop(2.6, dt) && (!p.action || p.action.type !== 'dunk')) { this.loopN = n + 1; fb.holder = 0; fb.mode = 'held'; this.ballFree = null; p.action = null; p.startAction('dunk', 1.6, { takeoff: 0.35, slam: 0.85, style, tUp: 0.5, jumpH: p.phys.vertical, spinDir: 1 }); }
      const a = p.action;
      if (a && !a.jumped && a.t >= a.takeoff) { a.jumped = true; p.jump(a.jumpH); }
      if (a && !a.slammed && a.t >= a.slam) { a.slammed = true; const bp = holdPoint.call(this.fake, p, {}); this.ballFree = { x: bp.x, y: bp.y + 0.12, z: bp.z, vx: 0, vy: -5, vz: 0 }; fb.holder = -1; }
      if (a && a.t > a.dur) p.action = null;
      return;
    }
    if (kind === 'celebrate') {
      fb.holder = -1; this.ballFree = null;
      if (!p.action) p.startAction('celebrate', 2.4, { kind: this.previewOpts?.kind || 'flex' });
      if (p.action && p.action.t > p.action.dur) p.action = null;
    }
  }
}
