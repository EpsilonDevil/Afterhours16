// Live match: fixed-step simulation + interpolated rendering + input + presentation (audio, HUD, camera).
import { Game } from '../sim/game.js';
import { DT, COURT, BALL_R } from '../sim/constants.js';
import { AthleteView } from '../char/view.js';
import { Animator } from '../char/animator.js';
import { resolveLook } from '../sim/bots.js';
import { Material, Mesh } from '../gfx/renderer.js';
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { cachedTexture } from '../world/court.js';
import { CameraRig, CAM_LABEL } from './camera.js';
import { GRADE, SMOTHER } from '../sim/shots.js';
import { promptGlyph, padGlyph } from '../core/input.js';
import { audio } from '../core/audio.js';
import { B } from '../char/skeleton.js';
import { LockedInGrade } from './grade.js';
import { TAKEOVERS, TAKEOVER_NEED } from '../sim/badges.js';
import { settings, saveSettings } from '../core/settings.js';
import { GameIntro } from './present.js';
import { visualKey } from './vispool.js';
import { meterLegendHTML } from './hud.js';

const fmtClock = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return s < 10 && s > 0 ? s.toFixed(1) : `${m}:${String(r).padStart(2, '0')}`; };

// v0.4.5: auto-play (H) carries over from one game to the next (park, Pro-Am, the Pro Run, crew runs) until you
// turn it off yourself; the shootaround always starts with you in control, and AI-only games use their own flag
// shot feedback: how guarded the shooter was at the release (contestFor's value, 1 = a full contest)
export function guardedText(contest) {
  const c = Math.max(0, contest || 0), pct = Math.round(Math.min(1, c) * 100);
  return `${pct}% guarded · ${c >= SMOTHER ? 'Smothered' : c > 0.45 ? 'Contested' : c > 0.2 ? 'Light contest' : c > 0.1 ? 'Open' : 'Wide open'}`;
}
export function startsOnAutoPlay(opts) { return opts.background ? !!opts.assist : (opts.assist ?? (opts.mode !== 'practice' && !!settings.autoPlay)); }
export function toggleAutoPlay(g) { g.assist = !g.assist; if (g.mode !== 'practice') { settings.autoPlay = g.assist; saveSettings(); } return g.assist; }

// stand-in while a pooled athlete is still being built (see vispool.js): animates nothing, draws nothing
const placeholderView = () => ({ H: 1.95, visible: true, model: null, pending: true, update() {}, setVisible(v) { this.visible = v; }, setShadow() {}, addTo() { return this; }, removeFrom() {}, dispose() {} });

export class PlayerVisual {
  // opts.pool (v0.4.5 stage 7): take the athlete from a VisualPool, reusing one that's free or building a new
  // one over the next frames; the player is invisible until it's ready (this.pending)
  constructor(r, scene, build, look, opts = {}) {
    this.scene = scene;
    this.ring = null;
    this.pending = false;
    const vopts = { detail: opts.detail ?? 1, faceRes: opts.faceRes };
    this.pool = opts.pool || null;
    if (this.pool) {
      this.key = visualKey(build, look, vopts);
      const v = this.pool.take(this.key);
      if (v) this.attach(v);
      else if (opts.now) this.attach(new AthleteView(r, build, look, vopts)); // needed right now: build it here
      else {
        this.pending = true;
        this.view = placeholderView();
        this.anim = new Animator(this.view);
        this.job = this.pool.request(this.key, build, look, vopts, view => { this.job = null; this.attach(view); });
      }
    } else this.attach(new AthleteView(r, build, look, vopts));
    const ctx = r.ctx;
    const blobTex = cachedTexture(ctx, 'blob', () => T.radialBlob(128), { wrap: 'clamp' });
    if (!PlayerVisual.blobMat) PlayerVisual.blobMat = new Material({ map: blobTex, shading: 'unlit', blend: 'multiply', depthWrite: false, fog: false });
    if (!PlayerVisual.blobGeo || PlayerVisual.blobCtx !== ctx) { PlayerVisual.blobGeo = ctx.geometry(G.plane(1, 1)); PlayerVisual.blobCtx = ctx; }
    this.blob = new Mesh(PlayerVisual.blobGeo, PlayerVisual.blobMat, { castShadow: false, reflect: false });
    this.blob.order = 3;
    scene.add(this.blob);
  }
  attach(view) {
    const visible = this.view ? this.view.visible !== false : true;
    this.pending = false;
    this.view = view.addTo(this.scene);
    view.setVisible(visible);
    this.anim = new Animator(view);
  }
  addRing(r, color) {
    const ctx = r.ctx;
    const tex = cachedTexture(ctx, 'ring', () => T.ringTexture(256), { wrap: 'clamp' });
    // (the shared unit plane: these used to make, and leak, a new plane every game)
    this.ring = new Mesh(PlayerVisual.blobGeo, new Material({ map: tex, color: M.hexLinear(color), shading: 'unlit', blend: 'add', depthWrite: false, fog: false, emissive: [0, 0, 0] }), { castShadow: false, reflect: false });
    this.ring.order = 4;
    this.scene.add(this.ring);
  }
  // v0.4.5 Hot / Cold: a flame or ice icon on the floor under the player (replaces the user's ring)
  addStatus(r) {
    const ctx = r.ctx;
    const mk = (key, fn) => { const m = new Mesh(PlayerVisual.blobGeo, new Material({ map: cachedTexture(ctx, key, () => fn(256), { wrap: 'clamp' }), color: [1, 1, 1], shading: 'unlit', blend: 'add', depthWrite: false, fog: false, emissive: [0, 0, 0] }), { castShadow: false, reflect: false }); m.order = 5; m.visible = false; this.scene.add(m); return m; };
    this.fire = mk('hotFlame', T.flameTexture);
    this.ice = mk('coldIce', T.iceTexture);
    this.statusT = 0;
  }
  setStatus(hot, cold, dt) {
    if (!this.fire) return;
    this.fire.visible = !!hot; this.ice.visible = !hot && !!cold;
    if (this.ring) this.ring.visible = !hot && !cold;
    this.statusT += dt;
  }
  place(x, y, z) {
    const s = this.pending ? 0 : 0.95 - Math.min(0.5, y * 0.4); // no floor shadow under somebody not there yet
    M.m4fromYaw(this.blob.matrix, x, 0.012, z, 0, s);
    if (this.ring) M.m4fromYaw(this.ring.matrix, x, 0.016, z, 0, 1.25);
    if (this.fire && this.fire.visible) M.m4fromYaw(this.fire.matrix, x, 0.018, z, this.statusT * 0.6, 1.45 + 0.08 * Math.sin(this.statusT * 9));
    if (this.ice && this.ice.visible) M.m4fromYaw(this.ice.matrix, x, 0.018, z, this.statusT * 0.15, 1.35 + 0.03 * Math.sin(this.statusT * 2));
  }
  // pooled: the athlete goes back to the pool for the next person who looks like this (or a build in progress is
  // cancelled); otherwise its meshes and textures are freed. Safe to call twice.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pool) { if (this.pending) this.pool.cancel(this.job); else this.pool.release(this.key, this.view); }
    else this.view.dispose();
    this.scene.remove(this.blob); if (this.ring) this.scene.remove(this.ring); if (this.fire) { this.scene.remove(this.fire); this.scene.remove(this.ice); }
  }
}

export class MatchSession {
  constructor(app, opts) {
    this.app = app;
    this.r = app.renderer; this.input = app.input; this.hud = app.hud;
    this.opts = opts;
    this.scene = opts.scene;
    this.venue = opts.venue;
    this.court = opts.court;
    this.origin = this.court.origin;
    this.catalog = app.catalog;
    this.teams = opts.teams;
    this.game = new Game({
      mode: opts.mode, full: !!opts.full, seed: opts.seed, rosters: opts.rosters, catalog: this.catalog, target: opts.target, winBy2: opts.winBy2,
      quarterLen: opts.quarterLen, quarters: opts.quarters, surface: this.venue.theme.court.surface === 'wood' ? 'wood' : 'asphalt',
      // v0.4.5: your auto-play choice carries over to every game you play (not the shootaround)
      difficulty: opts.difficulty ?? 0.6, assist: startsOnAutoPlay(opts),
      greenBonus: !opts.background && settings.shotMeter === false ? 1.1 : 1,
    });
    this.game.teamsMeta = this.teams;
    audio.surface = this.game.ball.surface;
    audio.setIndoor(this.venue.theme.kind !== 'park');
    this.visuals = this.game.players.map((p, i) => {
      const e = opts.rosters[p.team][this.game.teams[p.team].indexOf(p)];
      // full-res face for the user's player; background hub games use the lighter LOD
      // v0.4.5 stage 7: background games share the park's pool with the walkers (same detail), so the people
      // who step onto a court keep the athlete they walked over in, and new faces are built across frames
      // (your own games use the pool too, with athletes built ahead of time; see ParkHub.prebuild)
      const lod = opts.background ? { detail: 0.75, pool: opts.pool } : p.human ? { detail: 1, pool: opts.pool, now: true } : { detail: 1, faceRes: 512, pool: opts.pool, now: true };
      const pv = new PlayerVisual(this.r, this.scene, e.build, e.look || resolveLook(e.build, this.catalog), lod);
      if (p.human) pv.addRing(this.r, '#ffd84a');
      if (!opts.background) pv.addStatus(this.r);
      return pv;
    });
    // ball
    const bt = cachedTexture(this.r.ctx, 'ballC', () => T.ballTexture().color, {});
    const bn = cachedTexture(this.r.ctx, 'ballN', () => T.ballTexture().normal, { srgb: false });
    this.ballMesh = new Mesh(this.r.ctx.geometry(G.sphere(BALL_R, 28, 18)), new Material({ map: bt, normalMap: bn, normalScale: 0.8, roughness: 0.6, color: [1, 1, 1] }));
    this.scene.add(this.ballMesh);
    this.ballQ = M.q4();
    this.ballBlob = new Mesh(PlayerVisual.blobGeo, PlayerVisual.blobMat, { castShadow: false, reflect: false });
    this.ballBlob.order = 3;
    this.scene.add(this.ballBlob);
    this.rig = app.cameraRig || new CameraRig(app.camera);
    if (!opts.background) this.rig.snap();
    this.acc = 0;
    this.timeScale = 1; this.slowT = 0;
    this.highlight = null;
    this.ended = false; this.endT = 0;
    this.paused = false;
    this.meterFreeze = null; this.meterHold = 0;
    this.lastPlant = new Map();
    this.prevBall = { x: 0, y: 1, z: 0 };
    this.tagsOn = true;
    this.onEnd = opts.onEnd;
    this.statsHud = null;
    this.background = !!opts.background;
    if (!this.background) { this.hud.clear(); this.hud.show(true); }
    this.wasHumanOffense = null;
    if (!this.background) audio.setCrowd(this.venue.theme.kind === 'arena' ? 0.55 : this.venue.theme.kind === 'park' ? 0.16 : 0);
    this.pend = {};
    this.basis = null;
    // v0.4.1 Locked-In (teammate) grade for the user's player, every mode
    this.grade = !this.background && this.game.human ? new LockedInGrade(this.game, this.game.human.id) : null;
    // v0.4.3: team intros before park and Pro-Am games
    this.intro = !this.background && opts.intro !== false && (opts.mode === 'park' || opts.mode === 'proam') ? new GameIntro(this) : null;
    if (!this.background && this.game.assist && this.game.human) this.hud.pushFeed('Auto-play is ON (H to take over)');
  }
  get inIntro() { return !!(this.intro && !this.intro.done); }

  humanPlayer() { return this.game.human; }

  // ---- input: edges are captured every rendered frame and buffered until a sim step consumes them ----
  // (on 120/144 Hz screens many frames run zero 60 Hz steps; presses made during the tail of an animation
  // are also kept for a short window, like a fighting-game input buffer)
  captureInput() {
    const inp = this.input, g = this.game, me = g.human;
    if (!me || g.assist) { inp.ctx = 'offball'; return; }
    const has = g.ball.holder === me.id;
    const offense = g.possession === me.team;
    inp.ctx = has ? 'offense' : offense ? 'offball' : 'defense';
    const P = this.pend;
    const mv = inp.moveVector();
    const basis = this.stickBasis();
    const wx = basis.rx * mv.x + basis.fx * mv.y, wz = basis.rz * mv.x + basis.fz * mv.y;
    const dir = Math.hypot(wx, wz) > 0.3 ? { x: wx, z: wz } : null;
    if (inp.wasPressed('shoot') || (inp.ctx === 'defense' && inp.wasPressed('block'))) P.shoot = { ttl: 0.26 };
    // v0.4.1: attack-the-rim bind (keyboard dunk key, or right stick down while sprinting). Held, it keeps
    // asking until you're in range, so you can press it early on a drive.
    const attackHeld = inp.isDown('dunk') || (inp.gp.dunkHeld && inp.ctx === 'offense');
    if (has && (inp.wasPressed('dunk') || attackHeld)) {
      const a = me.action;
      if (!(a && (a.type === 'dunk' || a.type === 'layup' || a.type === 'shoot'))) P.shoot = { ttl: inp.wasPressed('dunk') ? 0.3 : 0.1, attack: true };
    }
    if (has || offense) {
      const icons = ['icon1', 'icon2', 'icon3', 'icon4'];
      const mates = g.mates(me);
      let pass = null;
      icons.forEach((k, i) => { if (inp.wasPressed(k) && mates[i]) pass = { target: mates[i].id, type: 'chest' }; });
      if (!pass && inp.wasPressed('pass')) pass = { dir, type: 'chest' };
      if (inp.wasPressed('bounce')) pass = { ...(pass || { dir }), type: 'bounce' };
      if (inp.wasPressed('lob')) pass = { ...(pass || { dir }), type: 'lob' };
      if (inp.wasPressed('alley')) pass = { ...(pass || { dir }), type: 'alley' };
      if (pass) { if (has) P.pass = { ...pass, ttl: 0.3 }; else if (inp.wasPressed('pass')) P.call = { ttl: 0.05 }; }
      if (has) {
        const ps = inp.proStick();
        const btb = inp.wasPressed('btb');
        if (ps || btb) {
          let move = null, mx = null, mz = null;
          if (btb) move = 'btb';
          else if (ps === 'spin') move = 'spin';
          else if (ps === 'down') move = (inp.gp.connected && mv.m > 0.5) ? 'btb' : 'stepback';
          else if (ps === 'up') move = 'hesi';
          else {
            // left/right relative to the screen: crossover to that side, or in-and-out if the ball is already there
            const sx = ps === 'left' ? -1 : 1;
            const dx = basis.rx * sx, dz = basis.rz * sx;
            const leftX = Math.cos(me.facing), leftZ = -Math.sin(me.facing);
            const toLeft = dx * leftX + dz * leftZ > 0;
            const hand = me.dribble.hand;
            move = (toLeft && hand === 'R') || (!toLeft && hand === 'L') ? (inp.isDown('sprint') ? 'btl' : 'cross') : 'inout';
            if (mv.m < 0.2) { mx = dx; mz = dz; }
          }
          // v0.4.5 quick patch: a move called during another one waits for it to finish (it used to be dropped
          // after 0.22 s, so chaining needed frame-perfect timing); a spin replaces whatever was waiting
          const cur = me.action, left = cur && cur.type === 'move' ? Math.max(0, cur.dur - cur.t) : 0;
          if (!P.move || move === 'spin' || P.move.move !== 'spin') P.move = { move, mx, mz, ttl: Math.min(0.65, Math.max(0.22, left + 0.14)) };
        }
      }
      if (inp.wasPressed('screen')) this.callScreen(me);
    } else {
      if (inp.wasPressed('steal')) P.steal = { ttl: 0.16 };
      // v0.4.4: right-stick hands on defense (screen-relative → world)
      if (inp.ctx === 'defense') {
        const ds = inp.defStick();
        const w = v => { const x = basis.rx * v.x + basis.fx * v.y, z = basis.rz * v.x + basis.fz * v.y, l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };
        if (ds.flick) P.steal = { ttl: 0.16, dir: ds.low ? null : w(ds.flick), low: ds.low };
        this.defHands = { up: ds.up, side: ds.hold ? w(ds.hold) : null };
      }
    }
    if (inp.wasPressed('celebrate') && !me.action && (g.phase === 'dead' || g.phase === 'check')) me.startAction('celebrate', 1.6, { kind: this.celebrationKind(me) });
  }

  // Controls follow the camera as it is on screen (v0.4.3: no latching). The 2K cam swings round on a change of
  // possession; a held stick swings with it, so "up" stays up the screen and the player turns with the play
  // instead of running on in a direction that no longer matches the view.
  stickBasis() {
    this.basis = this.rig.inputBasis();
    return this.basis;
  }

  // Intent for one 60 Hz step: live stick/button state + any buffered presses.
  stepIntent() {
    const inp = this.input, g = this.game, me = g.human;
    if (!me || g.assist) return null;
    const has = g.ball.holder === me.id;
    const offense = g.possession === me.team;
    const mv = inp.moveVector();
    const basis = this.basis || this.rig.inputBasis();
    const wx = basis.rx * mv.x + basis.fx * mv.y, wz = basis.rz * mv.x + basis.fz * mv.y;
    // v0.4.5 quick patch: the attack bind (dunk key, or right stick held down) counts as holding the shot, so when
    // a drive turns into a layup you time it the same way: let go at the top (it used to come out on the gather)
    const attackHeld = inp.isDown('dunk') || (!!inp.gp.dunkHeld && inp.ctx === 'offense');
    const it = {
      mx: wx, mz: wz, sprint: inp.isDown('sprint'), defense: false, handsUp: false, face: null, stickFace: true,
      shoot: null, shootHeld: inp.isDown('shoot') || attackHeld, pass: null, move: null, steal: false, jump: false, call: false, screen: false,
    };
    const P = this.pend;
    if (P.shoot) {
      const b = g.ball;
      const incoming = b.mode === 'flight' && b.kind === 'pass' && b.info && b.info.to === me.id;
      if (has || g.phase === 'ft' || g.phase === 'tip') { it.shoot = 'press'; if (P.shoot.attack) it.attack = true; }
      else if (incoming) P.shoot.ttl = Math.max(P.shoot.ttl, 0.05); // catch-and-shoot: hold the press until the catch
      else it.jump = true;
    }
    if (P.pass && has) it.pass = { ...P.pass };
    if (P.move && has) { it.move = P.move.move; if (P.move.mx != null) { it.mx = P.move.mx; it.mz = P.move.mz; } }
    if (P.steal) { it.steal = true; if (P.steal.dir) it.stealDir = P.steal.dir; if (P.steal.low) it.stealLow = true; }
    if (P.call) it.call = true;
    if (!offense) {
      it.defense = inp.isDown('defense');
      it.handsUp = inp.isDown('handsUp') || !!this.defHands?.up;
      if (this.defHands?.side) it.handsSide = this.defHands.side;
      if (it.defense) { const h = g.holder(); if (h) it.face = Math.atan2(h.x - me.x, h.z - me.z); }
    }
    delete it.pass?.ttl;
    return it;
  }

  // after each step: drop what was used, age the rest
  ageInput(dt) {
    const P = this.pend, g = this.game;
    if (g.humanActed) { for (const k in P) delete P[k]; return; }
    for (const k in P) { P[k].ttl -= dt; if (P[k].ttl <= 0) delete P[k]; }
    delete P.call;
  }

  celebrationKind(p) {
    // v0.4.5: The General (Icon badge) unlocks its own salute, which beats whatever is equipped
    if (p.icon === 'the_general') return 'general';
    const id = p.entry.build.equipment?.celebration;
    const item = id && this.catalog[id];
    return item?.anim || ['flex', 'chest', 'point'][p.id % 3];
  }

  callScreen(me) {
    const g = this.game;
    const big = g.mates(me).filter(m => !m.human).sort((a, b) => (b.phys.H - a.phys.H) || (a.dist(me) - b.dist(me)))[0];
    if (big) { const m = g.ai.m(big); m.plan = 'screen'; m.screenFor = me.id; m.screenT = 3.5; this.hud.pushFeed(`${big.name}: setting a screen`); }
  }

  frame(dt) {
    const g = this.game, inp = this.input;
    if (!this.background) {
      if (inp.wasPressed('camera')) this.hud.showCam(CAM_LABEL[this.rig.cycle()]);
      if (inp.wasPressed('assist')) {
        toggleAutoPlay(g); this.hud.pushFeed(g.assist ? 'Auto-play ON (H) · stays on for your next games' : 'Auto-play OFF (H)');
      }
      if (inp.wasPressed('help')) this.toggleHelp();
    }
    if (this.paused) { this.render(0); return; }
    // a background game whose players are still being built waits at the check (nobody plays invisible)
    if (this.background && this.visuals.some(v => v.pending)) { this.render(0); return; }
    if (this.inIntro && g.over) this.intro.finish();
    if (this.inIntro) {
      if (!this.background && (inp.wasPressed('shoot') || inp.wasPressed('pass'))) this.intro.skip();
      if (this.inIntro) this.intro.update(Math.min(0.1, dt));
      this.render(dt);
      return;
    }
    // slow motion for highlights
    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = M.damp(this.timeScale, 0.35, 10, dt); } else this.timeScale = M.damp(this.timeScale, 1, 6, dt);
    // v0.4.5: background (AI-only) park games can run faster than real time; the park sets this.rate per court
    const rate = this.background ? (this.rate || 1) : 1;
    const sdt = Math.min(0.1, dt) * this.timeScale * (g.speed || 1) * rate;
    this.acc += sdt;
    let steps = 0;
    if (!this.background) this.captureInput();
    const evs = this.frameEvents = [];
    while (this.acc >= DT && steps < (this.background ? 18 : 6)) {
      const intent = this.background ? null : this.stepIntent();
      if (intent) g.setInput(intent);
      g.step(DT);
      if (!this.background) this.ageInput(DT);
      if (this.background) this.backgroundEvents(g.events); else this.handleEvents(g.events);
      for (const e of g.events) evs.push(e);
      if (this.grade) { for (const e of g.events) this.grade.onEvent(e); this.grade.tick(DT); g.lockIn = { id: this.grade.me, idx: this.grade.index }; }
      this.acc -= DT; steps++;
    }
    if (g.over && !this.ended) { this.ended = true; this.endT = 0; if (this.grade) this.app.lastGrade = this.grade.result(); }
    if (this.background && this.acc > DT * 2) this.acc = DT * 2;
    this.lastEvents = evs; // v0.4.5: park spectators read these after the frame
    if (this.ended) { this.endT += dt * rate; if (this.endT > 3.2 && this.onEnd) { const f = this.onEnd; this.onEnd = null; f(g.summary(), this); } }
    this.render(dt * rate); // a sped-up background game animates at its own pace (no foot sliding)
  }

  render(dt) {
    const g = this.game, r = this.r;
    const alpha = Math.min(1, this.acc / DT);
    const [ox, oy, oz] = this.origin;
    const b = g.ball;
    const bx = M.lerp(b.px ?? b.x, b.x, alpha) + ox, by = M.lerp(b.py ?? b.y, b.y, alpha), bz = M.lerp(b.pz ?? b.z, b.z, alpha) + oz;
    // ball spin
    const w = Math.hypot(b.wx, b.wy, b.wz);
    if (w > 1e-3) { const q = M.qaxis(M.q4(), b.wx / w, b.wy / w, b.wz / w, w * dt * this.timeScale); M.qmul(this.ballQ, q, this.ballQ); M.qnorm(this.ballQ, this.ballQ); }
    M.m4compose(this.ballMesh.matrix, [bx, by, bz], this.ballQ);
    this.ballMesh.visible = this.ballBlob.visible = !this.inIntro;
    M.m4fromYaw(this.ballBlob.matrix, bx, 0.011, bz, 0, Math.max(0.12, 0.42 - by * 0.06));
    const ballW = { x: bx, y: by, z: bz };
    for (let i = 0; i < g.players.length; i++) {
      const p = g.players[i], v = this.visuals[i];
      const x = M.lerp(p.prevX, p.x, alpha) + ox, z = M.lerp(p.prevZ, p.z, alpha) + oz, y = M.lerp(p.prevY, p.y, alpha);
      const f = M.angleLerp(p.prevFacing, p.facing, alpha);
      v.anim.update(dt * this.timeScale, { x, y, z, facing: f }, p, this.gameProxy(), ballW);
      v.setStatus(p.hot, p.cold, dt);
      v.place(x, y, z);
      // squeaks on hard plants
      if (p.plantT > 0 && !this.lastPlant.get(p.id)) audio.squeak(this.pan(x));
      this.lastPlant.set(p.id, p.plantT > 0);
    }
    // hoops (rim shake + nets) — pass ball in world coords
    for (const h of this.court.hoops) h.update(dt * this.timeScale, ballW);
    if (this.venue.update && !this.opts.hub) this.venue.update(dt, { ball: ballW, phase: g.phase, over: g.over, events: this.frameEvents || [] });
    this.frameEvents = null;
    if (this.background) return;
    // camera
    const me = g.human;
    const meW = me ? { x: me.x + ox, z: me.z + oz, facing: me.facing } : null;
    const side = g.attackDir[g.possession];
    const focus = me && !g.assist && g.possession === me.team && g.ball.holder !== me.id ? { x: (b.x * 0.7 + me.x * 0.3), z: (b.z * 0.7 + me.z * 0.3) } : { x: b.x, z: b.z };
    let hl = null;
    if (this.highlight) { this.highlight.t -= dt; const k = Math.min(1, this.highlight.t / 0.4) * Math.min(1, (this.highlight.dur - this.highlight.t) / 0.25); hl = { x: this.highlight.x, y: this.highlight.y, z: this.highlight.z, k: Math.max(0, k) * 0.6 }; if (this.highlight.t <= 0) this.highlight = null; }
    if (this.inIntro) this.intro.camera(dt);
    else this.rig.updateGame(dt, { origin: this.origin, half: g.half, side, focus, ball: { x: b.x, y: b.y, z: b.z }, me: meW, highlight: hl });
    // shadows follow the action
    this.scene.shadowFocus = { center: [ox + b.x * 0.6, 0, oz + (g.half ? Math.max(5, b.z) * 0.8 + 1 : b.z * 0.8)], radius: g.half ? 15 : 19 };
    this.scene.hype = Math.max(0, (this.scene.hype || 0) - dt * 0.4);
    if (this.venue.jumbotron && (this.jumboT = (this.jumboT || 0) - dt) <= 0) { this.jumboT = 0.5; this.venue.jumbotron.draw(this.jumboInfo()); }
    this.updateHUD(dt);
  }

  gameProxy() {
    const g = this.game, o = this.origin;
    if (!this._proxy) {
      const self = this;
      this._proxy = {
        get ball() { return g.ball; },
        holder: () => g.holder(),
        opponents: p => g.opponents(p),
        players: g.players,
        rimFor: t => { const rr = g.rimFor(t); return { x: rr.x + self.origin[0], y: rr.y, z: rr.z + self.origin[2] }; },
        worldOf: q => ({ x: q.x + self.origin[0], z: q.z + self.origin[2] }),
      };
      // opponents/holder positions are court-local; animator only uses relative distances/look targets
      this._proxy.holder = () => { const h = g.holder(); return h ? { x: h.x + o[0], z: h.z + o[2], dist: q => h.dist(q) } : null; };
    }
    return this._proxy;
  }

  pan(x) { return M.clamp((x - this.rig.pos[0]) / 14, -0.8, 0.8); }
  vol(x, z) { const d = Math.hypot(x - this.rig.pos[0], z - this.rig.pos[2]); return M.clamp(1.4 - d / 30, 0.25, 1); }

  // controller feedback for plays involving the user
  rumbleFor(e) {
    const g = this.game, me = g.human, inp = this.input;
    if (!me || !inp.usingPad) return;
    const mine = e.player === me.id;
    switch (e.type) {
      case 'release': if (mine && e.grade === 'excellent') inp.rumble(0.15, 0.55, 70); break;
      case 'slam': if (mine) inp.rumble(1, 0.8, 230); else if (e.poster === me.id) inp.rumble(1, 1, 380); break;
      case 'block': if (mine) inp.rumble(0.75, 0.5, 160); else if (e.shooter === me.id) inp.rumble(0.55, 0.3, 140); break;
      case 'steal': if (mine) inp.rumble(0.3, 0.6, 90); else if (e.victim === me.id) inp.rumble(0.65, 0.4, 150); break;
      case 'ankle': if (mine) inp.rumble(0.5, 0.85, 200); else if (e.victim === me.id) inp.rumble(1, 0.6, 420); break;
      case 'bump': if (mine || e.defender === me.id) inp.rumble(0.3, 0.2, 70); break;
      case 'catch': if (mine) inp.rumble(0.05, 0.18, 40); break;
      case 'score': if (mine) inp.rumble(0.2, 0.45, 100); break;
      case 'gameOver': inp.rumble(0.6, 0.6, 400); break;
    }
  }

  handleEvents(events) {
    const g = this.game, hud = this.hud, [ox, , oz] = this.origin;
    for (const e of events) {
      const P = e.player != null ? g.players[e.player] : null;
      const mine = P && P.human;
      const myTeam = g.human ? g.human.team : 0;
      this.rumbleFor(e);
      if (e.type === 'badge' && mine) { const bd = this.app.config.badges?.[e.badge]; hud.badge({ key: e.badge, tier: e.tier, name: bd?.name || e.badge, group: bd?.group }); continue; }
      // v0.4.5 hot / cold / takeovers
      if (e.type === 'hot' && e.on && P) { if (mine) { hud.callout('ON FIRE', 'hot'); audio.cheer(0.9); } else hud.pushFeed(`${P.name} is on fire`); continue; }
      if (e.type === 'cold' && e.on && P) { if (mine) hud.callout('GOING COLD', 'cold'); else hud.pushFeed(`${P.name} went cold`); continue; }
      if (e.type === 'takeover' && P) { if (e.on) { if (mine) { hud.callout(e.label.toUpperCase(), 'hot'); audio.cheer(1.1); this.rig.shake(0.12, 0.3); } else hud.pushFeed(`${P.name}: ${e.label}`); } continue; }
      switch (e.type) {
        case 'dribble': audio.bounce(0.55 * this.vol(e.x + ox, e.z + oz), this.pan(e.x + ox)); break;
        case 'bounce': audio.bounce(Math.min(1, e.v / 5), this.pan(e.x + ox)); break;
        case 'rim': audio.rim(e.v, this.pan(e.x + ox)); this.hoopFor(e.side)?.hit(Math.min(1.5, e.v * 0.25)); break;
        case 'board': audio.board(e.v); break;
        case 'through': audio.swish(e.clean); { const h = this.hoopFor(e.side); if (h) h.net.energy = 1; } break;
        case 'release': {
          // (v0.4.5: timed layups get the same feedback; an untimed tap doesn't)
          if (mine && (e.kind !== 'layup' || e.grade !== 'none')) {
            const gr = GRADE[e.grade] || GRADE.none;
            this.meterHold = 0.7;
            this.meterFreeze = e.win != null ? this.meterOf(e.win, e.nat, e.tRel, e.err, e.sure, e.kind !== 'layup' && e.kind !== 'ft' && e.contest >= SMOTHER, e.grade) : null;
            const pos = this.screenOf(P, 2.4);
            // v0.4.5 quick patch: the % is how guarded you were at the release: the exact contest the release was
            // graded with (who was where, facing which way, hands up or not, their length and their defensive
            // ratings, help defense), 100% being a full contest
            if (settings.shotFeedback !== false) hud.release(pos.x, pos.y, (e.kind === 'layup' && gr.label ? 'Layup: ' : '') + (gr.label || (e.kind === 'ft' ? 'Free Throw' : 'Shot')), gr.color, e.kind === 'ft' ? 'Free throw' : guardedText(e.contest));
            if (e.grade === 'excellent') { audio.ui('green'); this.r.particles.burst(P.x + ox, 2.6 + P.y, P.z + oz, 26, { color: [0.3, 2.2, 0.8], speed: 2.4, life: 0.7, size: 0.035, gravity: -2 }); }
          }
          break;
        }
        case 'score': {
          const shooter = P;
          const big = e.pts === 3 || e.kind === 'dunk' || e.andOne;
          audio.cheer(big ? 1 : 0.5);
          this.scene.hype = big ? 1 : 0.5;
          const who = shooter ? shooter.name : 'Tip-in';
          hud.pushFeed(`${e.team === myTeam ? '▲' : '▼'} ${who} +${e.pts}${e.kind === 'dunk' ? ' · dunk' : e.three ? ' · three' : e.kind === 'layup' ? ' · layup' : ''}`, e.team === myTeam ? 'good' : 'bad');
          if (e.poster >= 0 && e.poster != null) hud.callout('POSTERIZED!', 'hot'); // (v0.4.5 quick patch: no slow motion; play goes on)
          else if (e.oop) hud.callout('ALLEY-OOP!', 'hot');
          else if (e.kind === 'dunk' && (mine || shooter?.team === myTeam)) hud.callout({ '360': 'THREE-SIXTY!', windmill: 'WINDMILL!', cradle: 'CRADLE JAM!', double: 'DOUBLE CLUTCH!', reverse: 'REVERSE JAM!', tomahawk: 'TOMAHAWK!' }[this.lastDunkStyle] || ['SLAM!', 'JAM!', 'FLUSHED!'][g.tick % 3], 'hot');
          else if (e.three && mine) hud.callout('SPLASH!', 'good');
          if (e.andOne) { audio.whistle(); hud.callout('AND ONE!', 'hot'); }
          // celebrations on big plays
          if (shooter && (big || e.swish) && !shooter.human && g.rng.next() < 0.6) shooter.pendingCelly = this.celebrationKind(shooter);
          if (shooter && shooter.human && big) hud.setHint(`Press ${promptGlyph(this.input, 'G', 'UP')} to celebrate`);
          break;
        }
        case 'slam': {
          const h = this.hoopFor(e.side);
          // v0.4.3: flashier packages land harder. v0.4.5 quick patch: no slow motion on dunks any more (the game flows
          // straight through the rise and the finish); every slam hits harder instead: a bigger rim shake, camera
          // kick, sparks and sound, more for the flashier packages and posters
          const tier = e.tier || 0, flash = (e.flair || 0) >= 2, poster = e.poster >= 0 && e.poster != null;
          this.lastDunkStyle = e.style;
          if (e.made && h) {
            h.hit(4.2 + tier * 0.5 + (poster ? 0.8 : 0)); audio.rim(3 + tier * 0.3); audio.board(1 + tier * 0.15);
            this.rig.shake(0.26 + tier * 0.05 + (poster ? 0.08 : 0), 0.34 + tier * 0.06);
            this.r.particles.burst(h.rim.x, h.rim.y, h.rim.z, 26 + tier * 10, { color: [1.7, 1.45, 1.0], speed: 2.6 + tier * 0.45, life: 0.5, size: 0.022 });
            if (flash || poster) audio.cheer(1.1);
          }
          if (P && (P.human || poster || (flash && e.made))) this.highlightAt(P, 0.9);
          break;
        }
        case 'hang': { const h = this.hoopFor(e.side); if (h) h.hang = 1; break; }
        case 'hangRelease': { const h = this.hoopFor(e.side); if (h) { h.hang = 0; h.hit(1.5); } break; }
        case 'block': {
          audio.board(1.2); audio.ooh(); this.rig.shake(0.1, 0.25);
          const blk = g.players[e.player];
          hud.pushFeed(`${blk.name} blocks ${g.players[e.shooter].name}`, blk.team === myTeam ? 'good' : 'bad');
          if (blk.human || g.players[e.shooter].human) { hud.callout(e.chase ? 'CHASE-DOWN!' : 'REJECTED!', blk.human ? 'good' : 'bad'); this.slow(0.5); }
          break;
        }
        case 'steal': {
          const st = g.players[e.player], vic = g.players[e.victim];
          hud.pushFeed(`${st.name} ${e.intercept ? 'picks off the pass' : e.bump ? 'strips' : 'steals from'} ${e.intercept ? '' : vic.name}`.trim(), st.team === myTeam ? 'good' : 'bad');
          if (st.human) hud.callout('PICKPOCKET!', 'good');
          audio.ooh();
          break;
        }
        case 'ankle': {
          const vic = g.players[e.victim];
          hud.callout('ANKLE BREAKER!', g.players[e.player].team === myTeam ? 'hot' : 'bad');
          audio.ooh(); audio.cheer(0.6);
          this.highlightAt(vic, 1.2); this.slow(1.0);
          hud.pushFeed(`${g.players[e.player].name} broke ${vic.name}'s ankles`, g.players[e.player].team === myTeam ? 'good' : 'bad');
          break;
        }
        case 'pumpfake': break;
        case 'bump': audio.board(0.4); break;
        case 'turnover': case 'violation':
          if (e.type === 'violation' && e.what === 'Traveling') { if (P && P.team === myTeam) hud.callout('TRAVELING', 'bad'); break; } // the turnover event that follows whistles and posts it
          audio.whistle(); hud.pushFeed(e.why || e.what || 'Turnover', 'neutral'); break;
        case 'oob': audio.whistle(); break;
        case 'foul': audio.whistle(); break;
        case 'feed': hud.pushFeed(e.text, 'neutral'); break;
        case 'check': hud.pushFeed(e.team === myTeam ? 'Your ball — check it up' : 'Defense — check ball', 'neutral'); this.rig.snap(); this.checkCelebrations(); break;
        case 'inbound': this.rig.snap(); this.checkCelebrations(); break;
        case 'cleared': if (e.team === myTeam) hud.pushFeed('Ball cleared', 'neutral'); break;
        case 'possession': if (g.mode === 'park' && g.half && e.team === myTeam && e.reason !== 'check') hud.pushFeed('Take it back past the arc!', 'neutral'); break;
        case 'noCount': audio.whistle(); break;
        case 'buzzer': audio.buzzer(); break;
        case 'period': hud.callout(g.quarter > g.quarters ? 'OVERTIME' : ['', '1ST', '2ND', '3RD', '4TH'][g.quarter] + ' QUARTER', ''); break;
        case 'ftStart': hud.callout(`FREE THROW${e.count > 1 ? 'S' : ''}`, ''); break;
        case 'tipoff': hud.callout('TIP-OFF', ''); break;
        case 'gameOver': {
          audio.buzzer(); audio.cheer(1.2);
          const won = e.winner === myTeam;
          hud.callout(won ? 'YOU WIN' : 'GAME OVER', won ? 'good' : 'bad');
          break;
        }
        case 'live': this.hud.setHint(''); break;
      }
    }
    // celebrations during dead balls
    if (g.phase === 'dead') for (const p of g.players) if (p.pendingCelly && !p.action) { p.startAction('celebrate', 1.5, { kind: p.pendingCelly }); p.pendingCelly = null; }
  }

  // distant courts: only positional sounds and hoop reactions
  backgroundEvents(events) {
    const g = this.game, [ox, , oz] = this.origin;
    const cam = this.rig.pos;
    const d = Math.hypot(ox - cam[0], oz + 8 - cam[2]);
    const near = d < 30, k = Math.max(0, 1 - d / 34);
    for (const e of events) {
      if (e.type === 'rim') { this.hoopFor(e.side)?.hit(Math.min(1.5, e.v * 0.25)); if (near) audio.rim(e.v * k, this.pan(ox)); }
      else if (e.type === 'through') { const h = this.hoopFor(e.side); if (h) h.net.energy = 1; if (near) audio.swish(e.clean, this.pan(ox)); }
      else if (e.type === 'slam') { const h = this.hoopFor(e.side); if (e.made && h) h.hit(3); }
      else if (e.type === 'hang') { const h = this.hoopFor(e.side); if (h) h.hang = 1; }
      else if (e.type === 'hangRelease') { const h = this.hoopFor(e.side); if (h) { h.hang = 0; h.hit(1.2); } }
      else if (e.type === 'dribble' && near && Math.random() < 0.5) audio.bounce(0.3 * k, this.pan(e.x + ox));
      else if (e.type === 'score' && near) audio.cheer(0.15);
    }
  }

  // v0.4.5 quick patch: the icon pass input over a teammate's head, for whatever you're playing with right now: the
  // key on a keyboard (your binding), the modifier + face button on a controller (your binding, your pad's symbols)
  iconPassGlyph(i) {
    const inp = this.input, esc = t => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    if (inp.usingPad) {
      const fam = inp.gp.family, face = ['pass', 'bounce', 'shoot', 'lob'][i];
      return `<span class="tag-in pad">${padGlyph(fam, inp.padLabel('mod'))}${padGlyph(fam, inp.padLabel(face))}</span>`;
    }
    return `<span class="tag-in"><kbd>${esc(inp.keyLabel('icon' + (i + 1)))}</kbd></span>`;
  }

  toggleHelp() {
    const el = document.getElementById('help-overlay');
    if (el) { el.remove(); return; }
    const d = document.createElement('div');
    d.id = 'help-overlay'; d.className = 'help-overlay';
    import('../ui/screens.js').then(S => { d.innerHTML = `<h3>Controls</h3>${S.controlsTable(this.app)}${meterLegendHTML()}<p class="muted small">Tab / RS click to close</p>`; document.body.appendChild(d); });
  }

  checkCelebrations() { for (const p of this.game.players) { p.pendingCelly = null; if (p.action?.type === 'celebrate') p.action = null; } }

  hoopFor(side) {
    const hs = this.court.hoops;
    return hs.find(h => h.side === side) || hs[0];
  }

  slow(t) { this.slowT = Math.max(this.slowT, t); }
  highlightAt(p, dur) { const [ox, , oz] = this.origin; this.highlight = { x: p.x + ox, y: 1.2 + p.y, z: p.z + oz, t: dur, dur }; }

  screenOf(p, h = 2.2) { const [ox, , oz] = this.origin; return this.r.project(this.app.camera, [p.x + ox, p.y + h, p.z + oz]); }

  jumboInfo() {
    const g = this.game, t = this.teams;
    return { title: this.opts.jumboTitle || (t[0].name ? 'PRO-AM' : 'AFTERHOURS'), home: g.score[0], away: g.score[1], homeName: t[0].abbr, awayName: t[1].abbr, homeColor: t[0].color, awayColor: t[1].color, clock: fmtClock(g.gameClock), period: g.quarter > g.quarters ? 'OT' : `Q${g.quarter}` };
  }

  // v0.4.5 quick patch: the live shot meter, from the very functions that grade the release (Game.jumperWindow /
  // layupWindow / ftWindow), with the contest measured the way the release measures it (at the ball), so the window
  // on screen is the window you get if you let go now. null: no timed shot in progress (close shots aren't timed).
  liveMeter(me, a) {
    const g = this.game;
    if (!a || g.assist || a.released || !a.tRel) return null;
    let W, contest = 0;
    if (a.type === 'ftshot') W = g.ftWindow(me);
    else if (a.type === 'shoot' && a.kind !== 'close') {
      contest = g.contestIfReleased(me);
      W = g.jumperWindow(me, a, contest);
    } else if (a.type === 'layup' && !a.oop && !a.untimed && a.releaseAt == null && a.t > 0.04) {
      contest = g.contestIfReleased(me);
      W = g.layupWindow(me, a, contest);
    } else return null;
    return this.meterOf(W.total, W.natural, a.tRel, (a.releaseAt ?? a.t) - a.tRel, W.sure, a.type === 'shoot' && contest >= SMOTHER, '');
  }
  // windows (ms of action time, ± around the ideal) and the release error (s) → the meter's units (1 = ideal release)
  meterOf(total, natural, tRel, err, sure, smothered, grade) {
    return { fill: 1 + err / tRel, half: total / 1000 / tRel, nat: natural / 1000 / tRel, sure, smothered, grade };
  }

  updateHUD(dt) {
    const g = this.game, hud = this.hud, me = g.human;
    if (this.background) return;
    hud.update(dt);
    // the shot-meter setting can change mid-game (pause → settings): keep the +10% green window in step
    g.greenBonus = settings.shotMeter === false ? 1.1 : 1;
    // score bug
    let clock, sub;
    if (g.mode === 'park') { clock = `FIRST TO ${g.target}`; sub = g.needsClear[g.possession] ? 'CLEAR IT' : '2s & 3s'; }
    else if (g.mode === 'practice') { const s = me ? me.stats : null; clock = 'PRACTICE'; sub = s ? `${s.fgm}/${s.fga} FG · ${s.tpm}/${s.tpa} 3PT` : ''; }
    else { clock = fmtClock(g.gameClock); sub = g.quarter > g.quarters ? 'OT' : `Q${g.quarter}`; }
    hud.setGrade(this.grade && settings.gradeHud !== false ? this.grade : null);
    if (g.mode !== 'practice') hud.setScore({ teams: this.teams, score: g.score, clock, sub, shot: g.phase === 'live' || g.phase === 'inbound' ? g.shotClock : null, poss: g.over ? -1 : g.possession });
    else {
      // shootaround: right side tracks green releases (or the 1-on-1 defender's points)
      const def = g.teams[1] && g.teams[1][0];
      const right = def ? { abbr: 'DEF', color: '#9aa3ad' } : { abbr: 'GRN', color: '#3ddc84' };
      hud.setScore({ teams: [this.teams[0], right], score: [me?.stats.pts ?? 0, def ? def.stats.pts : (me?.stats.greens ?? 0)], clock, sub, shot: null, poss: -1 });
    }
    // shot meter
    if (me) {
      const a = me.action;
      const pos = this.screenOf(me, me.phys.H * 0.62);
      const live = this.liveMeter(me, a);
      if (live) hud.setMeter(settings.shotMeter === false ? null : { x: pos.x, y: pos.y, ...live });
      else if (this.meterHold > 0 && this.meterFreeze && settings.shotMeter !== false) {
        // after the release: frozen where you let go, on the exact window the release was graded against
        this.meterHold -= dt;
        hud.setMeter({ x: pos.x, y: pos.y, ...this.meterFreeze });
      } else hud.setMeter(null);
      hud.setStamina(pos.x, pos.y + 70, me.stamina, me.sprinting || me.stamina < 0.5);
      const to = me.takeover, TO = TAKEOVERS[to.kind];
      hud.setStatus(this.inIntro ? null : { hot: !!me.hot, cold: !!me.cold, takeover: TO && (to.active || to.prog > 0) ? { label: TO.label, active: to.active, left: Math.ceil(to.left), prog: to.prog, need: TAKEOVER_NEED } : null });
    }
    // tags: names + icon numbers for passing
    if (this.inIntro) hud.setTags([]);
    else if (this.tagsOn) {
      const list = [];
      const mates = me ? g.mates(me) : [];
      const showIcons = me && g.ball.holder === me.id;
      for (const p of g.players) {
        const s = this.screenOf(p, p.phys.H + 0.32 + p.y);
        const icon = showIcons ? mates.indexOf(p) : -1;
        const team = this.teams[p.team];
        const txt = p.human ? `<b>YOU</b>` : icon >= 0 ? `${this.iconPassGlyph(icon)}${p.name.split(' ').slice(-1)[0]}` : `${p.name.split(' ').slice(-1)[0]}`;
        list.push({ id: p.id, x: s.x, y: s.y, text: txt, cls: (p.human ? 'me ' : '') + (p.team === (me ? me.team : 0) ? 'mate' : 'opp') + (p.calling > 0 ? ' calling' : ''), visible: s.visible && s.depth < 45 });
      }
      hud.setTags(list);
    }
  }

  dispose() {
    if (this.disposed) return; // the park can finish a court's game from two places in one frame
    this.disposed = true;
    for (const v of this.visuals) v.dispose();
    this.scene.remove(this.ballMesh);
    this.scene.remove(this.ballBlob);
    this.r.ctx.disposeGeometry(this.ballMesh.geo);
    if (!this.background) { this.hud.clear(); const h = document.getElementById('help-overlay'); if (h) h.remove(); }
  }
}
