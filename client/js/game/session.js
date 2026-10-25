// Live match: fixed-step simulation + interpolated rendering + input + presentation (audio, HUD, camera).
// MatchSession runs one Game (sim/game.js) for every mode that plays basketball (park games, Pro-Am, practice, the
// Pro Run, background games at the park) and PlayerVisual is one player on screen. Made by game/park.js, ui/modes.js
// and ui/prorun.js; online it feeds the lockstep (only the inputs it hands the sim matter for the shared hash).
import { Game } from '../sim/game.js';
import { DT, COURT, BALL_R, GRAVITY } from '../sim/constants.js';
import { AthleteView } from '../char/view.js';
import { Animator } from '../char/animator.js';
import { resolveLook, spreadGreens } from '../sim/bots.js';
import { Material, Mesh } from '../gfx/renderer.js';
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { cachedTexture } from '../world/court.js';
import { releaseScene } from '../world/release.js';
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
import { stickMove } from '../sim/moves.js';
import { meterLegendHTML } from './hud.js';
import { playGreenSound, playRecordScratch, warmGreenSounds } from '../core/greensound.js';
import { BLOCK_BY_ID, blockCallout } from '../sim/blocks.js';
import { hsName, hsCallout } from '../sim/hashsling.js';
import { greenFxFor } from './greenfx.js';
import { logGameEvent } from '../ui/bugreport.js';
import { normIntent, intentDelta, takeInputs } from '../sim/wire.js';
import { IconFX, iconFxState } from './iconfx.js';
import { nameRankIcon } from '../ui/badgeart.js';
import { entryRankTier } from '../sim/ranks.js';

const esc2 = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtClock = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return s < 10 && s > 0 ? s.toFixed(1) : `${m}:${String(r).padStart(2, '0')}`; };

// v0.4.5: auto-play (H) carries over from one game to the next (park, Pro-Am, the Pro Run, crew runs) until you
// turn it off yourself; the shootaround always starts with you in control, and AI-only games use their own flag
// shot feedback: how guarded the shooter was at the release (contestFor's value, 1 = a full contest)
export function guardedText(contest) {
  const c = Math.max(0, contest || 0), pct = Math.round(Math.min(1, c) * 100);
  return `${pct}% guarded · ${c >= SMOTHER ? 'Smothered' : c > 0.45 ? 'Contested' : c > 0.2 ? 'Light contest' : c > 0.1 ? 'Open' : 'Wide open'}`;
}
// v0.4.7.5 quick patch, defensive assignment arrows (MatchSession.defArrows): shown past `on` m from your man, gone
// inside `off` m (you're guarding him); `out`: how far from each player's feet the arrow sits (the edge of the ring);
// size (m) plus `perM` per metre apart, up to `grow` more
export const DEF_ARROW = { on: 2.6, off: 1.9, out: 1.0, size: 0.62, perM: 0.016, grow: 0.22 };
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
    this.r = r; this.build = build; this.icon = null; // (v0.4.8.5 qp3: an ICON build's cursor and aura: iconfx.js)
    this.pending = false;
    const vopts = { detail: opts.detail ?? 1, faceRes: opts.faceRes, lod: opts.lod };
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
    if (!PlayerVisual.blobGeo || PlayerVisual.blobCtx !== ctx) { PlayerVisual.blobGeo = ctx.geometry(G.plane(1, 1)); if (PlayerVisual.blobGeo && typeof PlayerVisual.blobGeo === 'object') PlayerVisual.blobGeo.shared = true; PlayerVisual.blobCtx = ctx; } // (QP3: shared by every ring and floor shadow: world/release.js)
    this.blob = new Mesh(PlayerVisual.blobGeo, PlayerVisual.blobMat, { castShadow: false, reflect: false });
    this.blob.order = 3;
    scene.add(this.blob);
  }
  attach(view) {
    const visible = this.view ? this.view.visible !== false : true;
    this.pending = false;
    this.view = view.addTo(this.scene);
    view.setVisible(visible);
    view.setCulled?.(!!this.culled);
    this.animPosed = false; // (a new athlete: posed the first time he's asked for, wherever he is)
    this.anim = new Animator(view);
  }
  // v0.4.7.5 qp3 perf: out of the camera's view and not being posed (ParkHub.animDt): him, his floor shadow and rings
  // are left out of the frame until he's back in view
  setCulled(c) {
    if (this.culled === c) return;
    this.culled = c;
    this.view?.setCulled?.(c);
    for (const m of [this.blob, this.ring, this.fire, this.ice]) if (m) m.culled = c;
    this.icon?.setCulled(c);
  }
  addRing(r, color) {
    // v0.4.8.5 quick patch 3: an ICON build's cursor is his own Icon badge, animated, in every mode (and his aura
    // comes with it): game/iconfx.js
    this.ringColor = color;
    if (this.addIcon(r, color)) return;
    const ctx = r.ctx;
    const tex = cachedTexture(ctx, 'ring', () => T.ringTexture(256), { wrap: 'clamp' });
    // (the shared unit plane: these used to make, and leak, a new plane every game)
    this.ring = new Mesh(PlayerVisual.blobGeo, new Material({ map: tex, color: M.hexLinear(color), shading: 'unlit', blend: 'add', depthWrite: false, fog: false, emissive: [0, 0, 0] }), { castShadow: false, reflect: false });
    this.ring.order = 4;
    this.scene.add(this.ring);
  }
  // v0.4.8.5 quick patch 3: the ICON cursor (his Icon badge on the floor, color: the team ring round it) and the aura
  // (shown from a 3-game win streak). Nothing for a build without ICON status: false
  addIcon(r, color = null) {
    if (this.icon) return true;
    if (this.noIcon) return false;
    if (!iconFxState(this.build).icon) return false;
    this.icon = new IconFX(r, this.scene, this.build, { color });
    this.icon.setCulled(!!this.culled);
    return true;
  }
  // the build again, when it may have changed under him (the park roam: a game played, an upgrade bought): his streak
  // moves the aura, and a build that has just made ICON swaps its ring for the badge
  syncIcon(build) {
    if (!build || build === this.build) return;
    this.build = build;
    const on = iconFxState(build).icon && !this.noIcon;
    if (this.icon && !on) { this.icon.dispose(); this.icon = null; if (this.ringColor != null && !this.ring) this.addRing(this.r, this.ringColor); }
    else if (this.icon) this.icon.setBuild(build);
    else if (on && (this.ring || this.ringColor != null)) { if (this.ring) { this.scene.remove(this.ring); this.ring = null; } this.addIcon(this.r, this.ringColor ?? null); }
  }
  setHidden(h) { this.icon?.setHidden(h); }
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
    // (v0.4.8.5 qp5: an ICON build on fire keeps his Icon badge, and it burns with a purple flame round it, in place of
    // the flame icon everybody else gets: iconfx.js IconFire. Cold still takes the badge's place, while it lasts)
    const burns = !!this.icon?.cursor;
    if (this.icon) { this.icon.onFire = !!hot; this.icon.statusOn = burns ? !hot && !!cold : !!(hot || cold); }
    this.fire.visible = !!hot && !burns; this.ice.visible = !hot && !!cold;
    if (this.ring) this.ring.visible = !hot && !cold;
    this.statusT += dt;
  }
  place(x, y, z) {
    const s = this.pending ? 0 : 0.95 - Math.min(0.5, y * 0.4); // no floor shadow under somebody not there yet
    M.m4fromYaw(this.blob.matrix, x, 0.012, z, 0, s);
    if (this.ring) M.m4fromYaw(this.ring.matrix, x, 0.016, z, 0, 1.25);
    if (this.fire && this.fire.visible) M.m4fromYaw(this.fire.matrix, x, 0.018, z, this.statusT * 0.6, 1.45 + 0.08 * Math.sin(this.statusT * 9));
    if (this.ice && this.ice.visible) M.m4fromYaw(this.ice.matrix, x, 0.018, z, this.statusT * 0.15, 1.35 + 0.03 * Math.sin(this.statusT * 2));
    // (ICON: the badge and the aura follow him; hidden with him: not there yet, a team intro, the Crew HQ's games)
    if (this.icon) this.icon.place(x, y, z, this.view, this.pending || this.view?.visible === false);
  }
  // pooled: the athlete goes back to the pool for the next person who looks like this (or a build in progress is
  // cancelled); otherwise its meshes and textures are freed. Safe to call twice.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pool) { if (this.pending) this.pool.cancel(this.job); else this.pool.release(this.key, this.view); }
    else this.view.dispose();
    this.scene.remove(this.blob); if (this.ring) this.scene.remove(this.ring); if (this.fire) { this.scene.remove(this.fire); this.scene.remove(this.ice); }
    if (this.icon) { this.icon.dispose(); this.icon = null; }
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
    // v0.4.7.5 qp3 online play (lockstep): {net, local, delay, game, meter, names, aids, onLost, spectate}. Every client
    // runs this same game; each one sends its own player's input for a few ticks ahead (delay) and waits for everyone
    // else's. spectate: watching it from the sideline (the same inputs, none of your own: local is -1)
    this.online = opts.online || null;
    this.spectate = !!this.online?.spectate;
    this.game = new Game({
      mode: opts.mode, full: !!opts.full, seed: opts.seed, rosters: opts.rosters, catalog: this.catalog, target: opts.target, winBy2: opts.winBy2,
      quarterLen: opts.quarterLen, quarters: opts.quarters, surface: this.venue.theme.court.surface === 'wood' ? 'wood' : 'asphalt',
      // v0.4.5: your auto-play choice carries over to every game you play (not the shootaround)
      difficulty: opts.difficulty ?? 0.6, assist: this.online ? false : startsOnAutoPlay(opts),
      greenBonus: !opts.background && settings.shotMeter === false ? 1.1 : 1,
      multi: !!this.online, inputDelay: this.online?.delay || 0,
      realism: !!opts.realism, // (v0.4.8.8: Pro-Am's realism: no Icon effects, badges and the overall gap 10% smaller, +10% difficulty)
      // (v0.4.8.9: the account park cards play in park games at a park only: not the Crew HQ, the Pro-Am parks or arenas)
      parkCards: opts.mode === 'park' && this.venue?.theme?.kind === 'park',
    });
    this.game.teamsMeta = this.teams;
    if (this.online) {
      // (this.human is the player on this screen; every human's green window follows his own shot-meter setting)
      this.game.human = this.spectate ? null : this.game.players[this.online.local] || this.game.human;
      for (const p of this.game.players) if (p.human) p.greenBonus = this.online.meter?.[p.id] ? 1.1 : 1;
    }
    spreadGreens(this.game.players, this.catalog); // (v0.4.7.5: every AI player on the floor has his own green release)
    // (v0.4.7.5 quick patch: their sounds get rendered now, in the background, so no green ever waits on its sound)
    if (!opts.background && (settings.greens || 'all') !== 'off') warmGreenSounds(audio, this.game.players.filter(p => settings.greens !== 'mine' || this.isMe(p)).map(p => ({ id: p.greenSound || 'gsnd_basic', ...(p.greenVoice || {}) })));
    audio.surface = this.game.ball.surface;
    audio.setIndoor(this.venue.theme.kind !== 'park');
    this.visuals = this.game.players.map((p, i) => {
      const e = opts.rosters[p.team][this.game.teams[p.team].indexOf(p)];
      // full-res face for the user's player; background hub games use the lighter LOD
      // v0.4.5 stage 7: background games share the park's pool with the walkers (same detail), so the people
      // who step onto a court keep the athlete they walked over in, and new faces are built across frames
      // (your own games use the pool too, with athletes built ahead of time; see ParkHub.prebuild)
      // (qp3 perf: everyone in your game but you has a far model too, for the far end of the floor: AthleteView)
      const lod = opts.background ? { detail: 0.75, pool: opts.pool } : p.human ? { detail: 1, pool: opts.pool, now: true, lod: !this.isMe(p) } : { detail: 1, faceRes: 512, pool: opts.pool, now: true, lod: true };
      const pv = new PlayerVisual(this.r, this.scene, e.build, e.look || resolveLook(e.build, this.catalog), lod);
      // (online: your ring is gold; the other people playing get blue rings with you, red against you)
      // (watching: the people playing get a white ring)
      if (this.game.realism) pv.noIcon = true; // (v0.4.8.8: no ICON cursor or aura in Pro-Am: the plain ring)
      if (p.human) pv.addRing(this.r, this.spectate ? '#f4f2ec' : this.isMe(p) ? '#ffd84a' : p.team === this.game.human?.team ? '#4ac8ff' : '#ff5a6a');
      // (v0.4.8.5 qp8: an AI ICON, a 99 of the AI world with everything maxed, carries the ICON cursor too, in the team's
      // colour as a person would: blue with you, red against you, white when nobody of yours is on the floor)
      else pv.addIcon(this.r, opts.background || this.spectate || !this.game.human ? null : p.team === this.game.human.team ? '#4ac8ff' : '#ff5a6a');
      if (!opts.background) pv.addStatus(this.r);
      return pv;
    });
    // ball
    // (the ball's colour and normal maps come from one painting: painted at most once, only if neither is cached yet)
    let ball = null;
    const bt = cachedTexture(this.r.ctx, 'ballC', () => (ball ||= T.ballTexture()).color, {});
    const bn = cachedTexture(this.r.ctx, 'ballN', () => (ball ||= T.ballTexture()).normal, { srgb: false });
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
    this.tagsOn = true; // (qp3: Settings → Name tags is read every frame: settings.tags)
    this.onEnd = opts.onEnd;
    this.statsHud = null;
    this.background = !!opts.background;
    if (!this.background) { this.hud.clear(); this.hud.show(true); }
    this.wasHumanOffense = null;
    if (!this.background) audio.setCrowd(this.venue.theme.kind === 'arena' ? 0.55 : this.venue.theme.kind === 'park' ? 0.16 : 0);
    this.pend = {};
    this.basis = null;
    // v0.4.1 Locked-In (teammate) grade for the user's player, every mode
    // (online: the game grades every player itself, the people included; the HUD shows yours from there: see frameOnline)
    this.grade = !this.background && this.game.human && !this.online ? new LockedInGrade(this.game, this.game.human.id) : null;
    // v0.4.3: team intros before park and Pro-Am games (not online: nobody waits on anybody's skip)
    this.intro = !this.background && !this.online && opts.intro !== false && (opts.mode === 'park' || opts.mode === 'proam') ? new GameIntro(this) : null;
    if (this.online) this.initOnline();
    // v0.4.8.7 qp5: online Pro-Am has auto-play of your own seat (for the breaks in a long grind): it rides in your inputs
    // (it.auto), so every screen plays your player with the AI from the same tick. Your choice carries over from game to
    // game as offline (settings.autoPlay). Online park and the other online games don't have it
    this.autoOnline = !!(this.online && this.autoAllowed() && settings.autoPlay);
    if (!this.background && this.game.human && (this.game.assist || this.autoOnline)) this.hud.pushFeed('Auto-play is ON (H to take over)');
  }
  // qp5: online, auto-play is for Pro-Am alone (a player of yours on the floor, not watching)
  autoAllowed() { return !!this.online && !this.spectate && !!this.game.human && this.game.mode === 'proam'; }
  // whether the AI is playing your player right now: offline auto-play, or your seat's online (as the game has applied it)
  meAuto() { const g = this.game; return !!g.assist || !!(this.online && g.human?.auto); }
  get inIntro() { return !!(this.intro && !this.intro.done); }
  // the user's own player (online, there are other people playing: p.human is true for them too)
  isMe(p) { return !!p && (this.online ? p === this.game.human : !!p.human); }

  humanPlayer() { return this.game.human; }

  // ---- input: edges are captured every rendered frame and buffered until a sim step consumes them ----
  // (on 120/144 Hz screens many frames run zero 60 Hz steps; presses made during the tail of an animation
  // are also kept for a short window, like a fighting-game input buffer)
  captureInput() {
    const inp = this.input, g = this.game, me = g.human;
    if (!me || g.assist || this.autoOnline) { inp.ctx = 'offball'; return; } // (qp5: or your seat on auto-play, online)
    const P = this.pend;
    const has = g.ball.holder === me.id;
    // v0.4.7.5 fix: you're on defense whenever an opponent has the ball, whatever the possession flag says (it lags
    // a change of possession, and X / Square then read as "shoot" = jump instead of steal)
    const holder = g.holder ? g.holder() : null;
    const offense = holder ? holder.team === me.team : g.possession === me.team;
    inp.ctx = has ? 'offense' : offense ? 'offball' : 'defense';
    // v0.4.7.5 qp3: an alley-oop is in the air for you: the called face button decides it, and nothing else is read
    // from that press (so the shoot button doesn't also jump you)
    if (me.oopQte && !me.oopQte.result) {
      const f = inp.facePressed();
      if (f != null) { if (this.online) P.oop = { f, ttl: 0.25 }; else g.oopInput(me, f); return; }
    }
    const mv = inp.moveVector();
    const basis = this.stickBasis();
    const wx = basis.rx * mv.x + basis.fx * mv.y, wz = basis.rz * mv.x + basis.fz * mv.y;
    const dir = Math.hypot(wx, wz) > 0.3 ? { x: wx, z: wz } : null;
    if (inp.wasPressed('shoot') || (inp.ctx === 'defense' && inp.wasPressed('block'))) P.shoot = { ttl: 0.26 };
    // v0.4.8.5 quick patch 3: off the ball on offense, Y / Triangle (the block / rebound button) jumps for the board too
    // (just a jump: it never turns into a catch-and-shoot the way the shoot button does with a pass on its way)
    else if (inp.ctx === 'offball' && inp.wasPressed('block')) P.shoot = { ttl: 0.26, jump: true };
    // v0.4.1: attack-the-rim bind (keyboard dunk key, or right stick down while sprinting). Held, it keeps
    // asking until you're in range, so you can press it early on a drive.
    const attackHeld = inp.isDown('dunk') || (inp.gp.dunkHeld && inp.ctx === 'offense');
    // (v0.4.8.7 qp7: this bind is the forced dunk now, for any build, on a drive in range: stepIntent marks its press
    // forceDunk. The old sprint + right stick down + shoot combo is gone)
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
      if (has && inp.isDown('post')) {
        // v0.4.7.5 qp3 post moves: with the post-up trigger held the right stick calls the post moves instead of
        // dribble moves: left/right a drop step round that side, up a spin to the rim, down the up-and-under
        const ps = inp.proStickInfo ? inp.proStickInfo() : (inp.proStick() ? { stick: inp.proStick(), slow: false } : null);
        if (ps && !ps.slow && ps.stick !== 'spin') {
          const st = ps.stick, horiz = st.endsWith('left') ? -1 : st.endsWith('right') ? 1 : 0;
          let move = null, side = 1;
          if (horiz) {
            // the stick's side, in the court: which way round the man (his left or right, as he faces away from the rim)
            const dx = basis.rx * horiz, dz = basis.rz * horiz, rim = g.rimFor(me.team), rx = rim.x - me.x, rz = rim.z - me.z, rl = Math.hypot(rx, rz) || 1;
            const lat = (-dx * rz + dz * rx) / rl; // (+: to the left of the rim line)
            move = 'dropstep'; side = lat >= 0 ? 1 : -1;
          } else if (st === 'up') move = 'postspin';
          else if (st === 'down') move = 'upunder';
          if (move) P.post = { move, side, ttl: 0.4 };
        }
        if (ps && ps.stick === 'spin') P.post = { move: 'postspin', side: 1, ttl: 0.4 };
        delete P.move;
      } else if (has) {
        const ps = inp.proStickInfo ? inp.proStickInfo() : (inp.proStick() ? { stick: inp.proStick(), slow: false } : null);
        const btb = inp.wasPressed('btb');
        if (ps || btb) {
          let move = null, mx = null, mz = null;
          if (btb) move = 'btb';
          else {
            // v0.4.7.5 stick combinations (moves.js stickMove): the direction, sprint, the left stick and how the stick
            // was thrown pick between crossovers, behind-the-backs, escapes, momentum dribbles and spins
            const st = ps.stick, horiz = st.endsWith('left') ? -1 : st.endsWith('right') ? 1 : 0;
            const dx = basis.rx * horiz, dz = basis.rz * horiz;
            const leftX = Math.cos(me.facing), leftZ = -Math.sin(me.facing);
            const hand = me.dribble.hand, toLeft = dx * leftX + dz * leftZ > 0;
            const toBallHand = horiz !== 0 && ((toLeft && hand === 'L') || (!toLeft && hand === 'R'));
            const rim = g.rimFor(me.team), rl = Math.hypot(rim.x - me.x, rim.z - me.z) || 1;
            const lw = Math.hypot(wx, wz), backward = lw > 0.5 && ((rim.x - me.x) * wx + (rim.z - me.z) * wz) / (rl * lw) < -0.5;
            move = stickMove(st, { toBallHand, sprint: inp.isDown('sprint'), moving: st === 'down' ? inp.gp.connected && mv.m > 0.5 : mv.m > 0.2, backward, slow: ps.slow });
            if ((st === 'left' || st === 'right') && mv.m < 0.2) { mx = dx; mz = dz; }
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
    // v0.4.7.5 quick patch: celebrations in games. It used to work only if you pressed it in the second and a half of
    // dead ball after a basket while your player stood doing nothing, and the check then cut it off. Now a press waits
    // up to 2.5 s for him to be free (the follow-through, the landing, the hang on the rim), and it plays in any dead
    // ball, check or inbound (unless he's the one with the ball) and in play for 3 s after a basket by your team.
    if (inp.wasPressed('celebrate')) this.celebrateReq = performance.now();
    if (this.celebrateReq != null) {
      if (performance.now() - this.celebrateReq > 2500) this.celebrateReq = null;
      else if (this.canCelebrate(me)) {
        if (this.online) P.celebrate = { kind: this.celebrationKind(me), ttl: 0.1 }; // (online: it goes with your input)
        else me.startAction('celebrate', 1.6, { kind: this.celebrationKind(me) });
        this.celebrateReq = null; this.hud.setHint('');
      }
    }
  }
  canCelebrate(me) {
    const g = this.game;
    if ((me.action && me.action.type !== 'catch') || me.airborne || g.over) return false;
    if (g.ball.holder === me.id || (g.phase === 'inbound' && g.inbounder === me)) return false;
    if (g.phase === 'dead' || g.phase === 'check' || g.phase === 'inbound' || g.phase === 'tip') return true;
    return g.phase === 'live' && this.myScoreAt != null && g.time - this.myScoreAt < 3;
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
    if (!me || g.assist || this.autoOnline) return null;
    const has = g.ball.holder === me.id;
    const holder = g.holder ? g.holder() : null;
    const offense = holder ? holder.team === me.team : g.possession === me.team; // (as in captureInput)
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
      // (v0.4.8.7 qp7: the attack bind's press is the forced dunk (sim/shots.js FORCE_DUNK: any build, on a drive in
      // range); the shoot button's press while sprinting is the forced layup (FORCE_LAYUP: on a drive at the rim it's a
      // layup, never a dunk, a jumper or a pump fake; anywhere else it's the usual shot). Both are a person's alone: the
      // sim ignores them on the AI, and they go over the wire in the intent)
      if (has || g.phase === 'ft' || g.phase === 'tip') {
        it.shoot = 'press';
        if (P.shoot.attack) it.attack = true;
        if (P.shoot.attack && has) it.forceDunk = true;
        else if (has && it.sprint && !P.shoot.jump) it.forceLayup = true;
      }
      else if (incoming && !P.shoot.jump) P.shoot.ttl = Math.max(P.shoot.ttl, 0.05); // catch-and-shoot: hold the press until the catch
      else it.jump = true;
    }
    if (P.pass && has) it.pass = { ...P.pass };
    if (P.move && has) { it.move = P.move.move; if (P.move.mx != null) { it.mx = P.move.mx; it.mz = P.move.mz; } }
    // qp3: the post-up trigger with the ball; the stick (before the post-up rescales it) picks the shot out of the post
    if (has && inp.isDown('post')) { it.post = true; it.postStick = [wx, wz]; if (P.post) { it.postMove = { move: P.post.move, side: P.post.side }; } }
    if (P.steal) { it.steal = true; if (P.steal.dir) it.stealDir = P.steal.dir; if (P.steal.low) it.stealLow = true; }
    if (P.call) it.call = true;
    if (offense && !has && inp.screenHeld && inp.screenHeld()) it.screen = true; // (v0.4.8.5: hold B off the ball to set a screen)
    if (this.online) {
      // online: the one-off calls go with the input, and every press carries its number (Game.multiIntent drops it on
      // the ticks after it was used)
      if (P.oop) it.oop = P.oop.f;
      if (P.celebrate) it.celebrate = P.celebrate.kind;
      if (P.callScreen) it.callScreen = true;
      const sq = {};
      if (P.shoot && (it.shoot || it.jump)) sq.shoot = P.shoot.seq;
      if (it.pass) sq.pass = P.pass.seq;
      if (it.move) sq.move = P.move.seq;
      if (it.steal) sq.steal = P.steal.seq;
      if (it.postMove) sq.post = P.post.seq;
      if (Object.keys(sq).length) it.seq = sq;
    }
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
    // (v0.4.8.5 qp5: what he has on, always. The General's own salute is an item now, The General's Salute
    // (cel_general_salute, anim 'general'), put on when the Icon unlocks; it no longer beats whatever else he equips.
    // Online the kind goes with the input: P.celebrate / it.celebrate)
    const id = p.entry.build.equipment?.celebration;
    const item = id && this.catalog[id];
    return item?.anim || ['flex', 'chest', 'point'][p.id % 3];
  }

  callScreen(me) {
    if (this.online) { this.pend.callScreen = { ttl: 0.02 }; return; } // (online: it goes with your input; see 'screenCall')
    const big = this.game.callScreenFor(me);
    if (big) this.hud.pushFeed(`${big.name}: setting a screen`);
  }

  frame(dt) {
    if (this.disposed) return; // (QP3: over and freed; the loop can still call it until the next controller is up)
    const g = this.game, inp = this.input;
    if (!this.background) {
      if (inp.wasPressed('camera')) this.hud.showCam(CAM_LABEL[this.rig.cycle()]);
      if (inp.wasPressed('assist')) {
        const ak = inp.actionText?.('assist') || 'H'; // (qp5: H, or the pad button: D-pad down by default)
        // (v0.4.8.7 qp5: online Pro-Am: your seat's own auto-play, from your next input on every screen; elsewhere online
        // there's none)
        if (this.online && !this.autoAllowed()) this.hud.pushFeed(this.spectate ? 'Auto-play is for the players in the game' : 'Auto-play is only in online Pro-Am');
        else if (this.online) {
          this.autoOnline = !this.autoOnline;
          for (const k in this.pend) delete this.pend[k]; // (nothing you'd pressed goes after it)
          settings.autoPlay = this.autoOnline; saveSettings();
          this.hud.pushFeed(this.autoOnline ? `Auto-play ON (${ak}) · stays on for your next games` : `Auto-play OFF (${ak})`);
        } else { toggleAutoPlay(g); this.hud.pushFeed(g.assist ? `Auto-play ON (${ak}) · stays on for your next games` : `Auto-play OFF (${ak})`); }
      }
      if (inp.wasPressed('help')) this.toggleHelp();
    }
    if (this.online) { this.frameOnline(dt); return; }
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
      // (v0.4.8.7 qp4: your own game at a park online, for the others there: each tick's input as it plays: park.js LocalPub)
      const it = this.opts.publish ? this.opts.publish.take(g, intent) : intent; // (a tick with none, auto-play: it goes out too)
      if (it) g.setInput(it);
      g.step(DT);
      if (!this.background) this.ageInput(DT);
      if (this.background) this.backgroundEvents(g.events); else { this.handleEvents(g.events); for (const e of g.events) logGameEvent(e, g); }
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

  // ---------------- v0.4.7.5 qp3 online play: lockstep ----------------
  // Tick k is simulated once every human's input for it is here. Each client sends its own for tick k + delay when it
  // gets to tick k (so ticks 1..delay are blank for everybody), the service passes them on in order, and the game waits
  // ("Waiting for ...") when one hasn't arrived. Everyone simulates the same thing; nothing else crosses the network.
  // qp3 perf: the inputs go out as changes, a frame's ticks in one message (sim/wire.js); they keep going out on time while
  // the game waits on someone (so one late input doesn't make everybody else late in turn), a game catches up on a
  // wait over a few frames instead of in one jump, and a PC whose frames come slowly sends its input that much further
  // ahead itself (extra, carried in its input as dl: the release timing allows for it) instead of making the others
  // wait for it every frame. Watchers play a moment behind, steadily (their inputs come in bundles). And every screen
  // tells the others, with its state check every 2 s, how long it waited on each of them (w): a player whose inputs
  // keep arriving late (his Wi-Fi, or someone else's) sends them further ahead too, back down once nobody waits.
  initOnline() {
    const o = this.online, g = this.game;
    this.lk = { D: Math.max(1, o.delay | 0), sent: 0, mine: new Map(), theirs: new Map(), drops: new Map(), hashes: new Map(), peerHash: new Map(), waitT: 0, waiting: null, warned: false, lost: false, seq: 0, maxK: 0, scoreT: 0, scoreKey: '',
      last: {}, dec: new Map(), extra: 0, frameExtra: 0, netExtra: 0, fms: [], lowFor: 0, buf: null, stalls: 0,
      waitBy: new Map(), lateWin: new Map(), raisedAt: 0, calm: 0 };
    this.lk.humans = g.players.filter(p => p.human).map(p => p.id);
    if (!this.spectate) this.r?.resetGovern?.(); // (qp3 perf: every game starts at full graphics)
    // (your own game takes its messages; a game you watch gets the same ones, and the game so far when you came late)
    this.offNet = this.spectate ? o.net.attachWatch(o.game, m => this.netMessage(m)) : o.net.attachGame(o.game, m => this.netMessage(m));
  }
  // the other people still playing (not the AI's yet)
  othersIn() { return this.lk.humans.filter(id => id !== this.online.local && this.game.players[id].human); }
  netMessage(m) {
    const lk = this.lk, g = this.game;
    if (m.t === 'in') {
      if (typeof m.k === 'number' && Array.isArray(m.b)) this.takeInputs(m.s, m.k, m.b);
    } else if (m.t === 'inw') { // (watching: a bundle of everyone's)
      for (const r of Array.isArray(m.m) ? m.m : []) if (Array.isArray(r) && typeof r[1] === 'number' && Array.isArray(r[2])) this.takeInputs(r[0], r[1], r[2]);
    } else if (m.t === 'left') {
      // he's the AI's from the tick after the last input of his that went round (never inside the blank first ticks)
      if (typeof m.slot === 'number' && g.players[m.slot]?.human && m.slot !== this.online.local) lk.drops.set(m.slot, Math.max(m.last | 0, lk.D) + 1);
    } else if (m.t === 'hash') {
      if (m.w && typeof m.w === 'object') this.lateReport(m.k, +m.w[this.online.local] || 0);
      const mine = lk.hashes.get(m.k);
      if (mine == null) lk.peerHash.set(m.k, m);
      else if (mine !== m.h) this.desync(m);
    } else if (m.t === 'closed') {
      // (a game of your own with nobody else in it just carries on without the connection: nobody's waiting on you,
      // and nobody else can be watched waiting either)
      if (this.spectate || this.othersIn().length || [...lk.drops.keys()].length) lk.lost = true;
      else lk.offline = true;
    }
  }
  // a player's inputs from tick k on (each the change from the one before: sim/wire.js), into the ticks they're for
  takeInputs(s, k, b) {
    const lk = this.lk;
    if (s === this.online.local || !this.game.players[s]) return;
    let dec = lk.dec.get(s);
    if (!dec) lk.dec.set(s, dec = { k: 0, it: {} });
    const ok = takeInputs(dec, k, b, (t, it) => {
      let tm = lk.theirs.get(t);
      if (!tm) lk.theirs.set(t, tm = new Map());
      tm.set(s, it);
      if (t > lk.maxK) lk.maxK = t;
      // (the tick the game is waiting on: how late his came, for the next state check's report)
      if (t === lk.needK) lk.waitBy.set(s, (lk.waitBy.get(s) || 0) + performance.now() - lk.needAt);
    });
    if (!ok && !lk.gapWarned) { lk.gapWarned = true; console.warn('[online] inputs out of order from seat', s, 'at tick', k); }
  }
  desync(m) {
    if (this.lk.warned) return;
    this.lk.warned = true;
    console.warn('[online] out of sync with', m.name || m.from, 'at tick', m.k);
    this.hud.pushFeed(`Out of sync with ${m.name || 'a player'}: your screens may not match from here`, 'bad');
    logGameEvent?.({ type: 'feed', text: `online desync at tick ${m.k}` }, this.game);
  }
  // the input for tick t: yours (blank while the pause menu is up), normalized as it goes out (sim/wire.js)
  onlineIntent(t) {
    const P = this.pend, lk = this.lk;
    for (const k in P) if (P[k].seq == null) P[k].seq = ++lk.seq;
    const it = this.paused || this.ended ? null : this.stepIntent();
    // (how many ticks later than the game's delay this one lands after what your screen showed as it was read: a release
    // in it is graded at the moment you let go, whatever your frames, a wait or a catch-up did in between. v0.4.8: exact
    // for every tick, where it used to be the send-ahead alone; sent while a shot or an alley-oop could use it)
    if (it && this.timingNow()) { const dl = t - lk.D - 1 - (lk.seen ?? this.game.tick); if (dl > 0) it.dl = Math.min(24, dl); }
    // (v0.4.8.7 qp5: your seat on auto-play: that's all your input says, every tick, until H takes it off; the pause menu
    // doesn't take it off. Every screen's game plays you with the AI from the tick it lands: Game.setAuto)
    if (this.autoOnline) return normIntent({ auto: true });
    return it ? normIntent(it) : {};
  }
  // whether your input could be timing something: the shot button (or the attack bind) down or just pressed, a timed
  // shot or a free throw of yours up, or an alley-oop coming to you
  timingNow() {
    const me = this.game.human, inp = this.input, a = me?.action;
    if (!me) return false;
    if (this.pend?.shoot || this.pend?.oop || me.oopQte) return true;
    if (inp?.isDown?.('shoot') || inp?.isDown?.('dunk') || inp?.gp?.dunkHeld) return true;
    return !!a && !a.released && (a.type === 'shoot' || a.type === 'layup' || a.type === 'ftshot' || a.type === 'dunk');
  }
  // v0.4.8 online: the moment you let go of a timed shot on your screen, the meter there is kept as it is (updateHUD)
  noteLetGo() {
    const g = this.game, me = g.human, a = me?.action, inp = this.input;
    if (!a || a.released || this.meAuto() || (this.letGo && this.letGo.a === a)) return;
    if (inp.isDown('shoot') || inp.isDown('dunk') || (inp.gp?.dunkHeld && inp.ctx === 'offense')) return;
    const m = this.liveMeter(me, a);
    if (m) this.letGo = { a, m };
  }
  // send your input up to tick upTo: every tick once, in order, one message for all of them
  sendOnline(upTo) {
    const lk = this.lk;
    if (lk.sent >= upTo) return;
    const k0 = lk.sent + 1, b = [];
    while (lk.sent < upTo) {
      const t = ++lk.sent, it = this.onlineIntent(t);
      lk.mine.set(t, it);
      b.push(intentDelta(lk.last, it));
      lk.last = it;
      this.ageOnline(DT);
    }
    if (!lk.offline) this.online.net.send({ t: 'in', k: k0, g: this.online.game, b });
  }
  // how much further ahead than the game's delay your input goes out: the more your frames or your connection need
  setExtra() { const lk = this.lk; lk.extra = Math.min(6, Math.max(lk.frameExtra, lk.netExtra)); }
  // a PC whose frames come slowly (the slowest one in ten over the last second) sends its input further ahead: up at
  // once, back down after a few steady seconds
  paceOnline(dt) {
    const lk = this.lk, g = this.game;
    lk.fms.push(dt * 1000);
    if (lk.fms.length < 60) return;
    const s = lk.fms.sort((a, b) => a - b), p90 = s[Math.floor(s.length * 0.9)];
    lk.fms = [];
    const tickMs = DT * 1000 / (g.speed || 1);
    const want = Math.max(0, Math.min(4, Math.ceil((p90 - 25) / tickMs)));
    if (want > lk.frameExtra) { lk.frameExtra = want; lk.lowFor = 0; }
    else if (want < lk.frameExtra) { if (++lk.lowFor >= 3) { lk.frameExtra--; lk.lowFor = 0; } }
    else lk.lowFor = 0;
    this.setExtra();
  }
  // another screen waited ms on your inputs in the 2 s up to tick k: past 60 ms (3% of the time; v0.4.8, it was 100),
  // yours go out a tick further ahead (once a window, however many screens say so; 4 at most): a late input freezes
  // everyone's screen for a moment, which is worse for the timing than a tick more delay for you alone. See calmOnline
  // for the way back down
  lateReport(k, ms) {
    const lk = this.lk;
    if (typeof k !== 'number') return;
    lk.lateWin.set(k, Math.max(lk.lateWin.get(k) || 0, ms));
    if (ms > 60 && k > lk.raisedAt) { lk.raisedAt = k; lk.netExtra = Math.min(4, lk.netExtra + 1); lk.calm = 0; this.setExtra(); }
  }
  // at each state check: a window nobody waited on you for more than a blink in (the one before last: everyone's said by
  // then) counts toward coming back down a tick, three in a row (6 s): the delay is never more than it has to be
  calmOnline(k) {
    const lk = this.lk, v = lk.lateWin.get(k - 240) || 0;
    for (const t of lk.lateWin.keys()) if (t <= k - 240) lk.lateWin.delete(t);
    if (v > 25) { lk.calm = 0; return; }
    if (++lk.calm >= 3) { lk.calm = 0; if (lk.netExtra > 0) { lk.netExtra--; this.setExtra(); } }
  }
  // after a tick's input is sent: presses the game has used are gone, the rest age (as ageInput)
  ageOnline(dt) {
    const P = this.pend, used = this.game.human?.usedSeq || 0;
    for (const k in P) { if (P[k].seq <= used) { delete P[k]; continue; } P[k].ttl -= dt; if (P[k].ttl <= 0) delete P[k]; }
    delete P.call; delete P.callScreen; delete P.celebrate;
  }
  missingFor(k) {
    const lk = this.lk, out = [];
    if (k <= lk.D) return out;
    const t = lk.theirs.get(k);
    for (const id of lk.humans) {
      if (id === this.online.local || !this.game.players[id].human) continue;
      if (!t || !t.has(id)) out.push(id);
    }
    return out;
  }
  // the people on the winning side (their accounts), for the court they now hold
  winnersOnline() {
    const g = this.game, aids = this.online.aids || {};
    return Object.entries(aids).filter(([s]) => g.players[s] && g.players[s].team === g.winner).map(([, a]) => a);
  }
  frameOnline(dt) {
    const g = this.game, lk = this.lk, net = this.online.net, spec = this.spectate;
    if (this.visuals.some(v => v.pending)) { this.render(0); return; } // (everyone's athlete is built before the tip)
    this.timeScale = 1; this.slowT = 0;
    const fdt = Math.min(0.1, dt) * (g.speed || 1);
    let cap;
    if (spec) {
      // watching: a steady few ticks behind the newest input (they come in bundles, ten a second), a little faster or
      // slower to stay there; a game you came to late plays through quickly until you're with everyone else
      const ahead = lk.maxK - g.tick;
      lk.buf = lk.buf == null ? ahead : lk.buf * 0.92 + ahead * 0.08;
      if (ahead > 30 && !g.over) { cap = Math.min(90, ahead - 12); this.acc = Math.max(this.acc, cap * DT); }
      else { cap = 8; this.acc = Math.min(this.acc + fdt * Math.max(0.9, Math.min(1.15, 1 + (lk.buf - 13) * 0.02)), DT * 12); }
    } else {
      this.acc = Math.min(this.acc + fdt, DT * 12); // (after a wait: catch up, a couple of ticks more a frame)
      cap = Math.min(8, Math.ceil(fdt / DT) + 2);
      this.paceOnline(dt);
      // (slow frames hold everyone up: lighter graphics until they're quick again, unless you'd rather not)
      if (settings.adaptiveGfx !== false && this.r?.govern?.(dt)) this.hud.pushFeed('Frames running slow: lighter graphics for now to keep the game smooth');
    }
    // (v0.4.8: the tick on your screen as your input is read: every tick of it carries how much later it lands, dl)
    lk.seen = g.tick;
    if (!this.paused && !spec) { this.captureInput(); this.noteLetGo(); }
    // your input goes out first: up to the tick this frame gets to, plus the delay (on time even while we wait)
    if (!spec && !g.over && !lk.lost) this.sendOnline(g.tick + Math.floor(this.acc / DT + 1e-9) + lk.D + lk.extra);
    let steps = 0;
    const evs = this.frameEvents = [];
    let waiting = null;
    while (this.acc >= DT && steps < cap && !lk.lost) {
      if (g.over) { // (after the final buzzer nobody's input counts: everyone just plays out the end on his own)
        g.step(DT); if (this.background) this.backgroundEvents(g.events); else this.handleEvents(g.events); for (const e of g.events) evs.push(e);
        this.acc -= DT; steps++; continue;
      }
      const k = g.tick + 1;
      if (!spec && lk.sent < k + lk.D) this.sendOnline(k + lk.D); // (never short: the game can't run past what's gone out)
      for (const [id, at] of lk.drops) if (k >= at) { g.dropHuman(id); lk.drops.delete(id); }
      const miss = this.missingFor(k);
      if (miss.length) { waiting = miss; if (!steps) lk.stalls++; if (lk.needK !== k) { lk.needK = k; lk.needAt = performance.now(); } break; }
      const theirs = lk.theirs.get(k);
      for (const id of lk.humans) {
        if (!g.players[id].human) continue;
        g.humanIntents.set(id, k <= lk.D ? {} : id === this.online.local ? lk.mine.get(k) || {} : theirs.get(id));
      }
      lk.theirs.delete(k); lk.mine.delete(k);
      g.step(DT);
      if (this.background) this.backgroundEvents(g.events); else { this.handleEvents(g.events); for (const e of g.events) logGameEvent(e, g); }
      for (const e of g.events) evs.push(e);
      if (!spec) {
        if (!this.grade && g.human) this.grade = g.aiGrades.get(g.human.id) || null;
        // every 2 s of game: compare the state with everyone else's
        if (k % 120 === 0 && !lk.offline) {
          const h = g.stateHash();
          lk.hashes.set(k, h);
          if (lk.hashes.size > 30) lk.hashes.delete(lk.hashes.keys().next().value);
          // (with how long this screen waited on each of the others since the last one: lateReport)
          const w = {};
          for (const [id, ms] of lk.waitBy) if (ms >= 1) w[id] = Math.round(ms);
          lk.waitBy.clear();
          net.send({ t: 'hash', k, h, w });
          this.calmOnline(k);
          const ph = lk.peerHash.get(k);
          if (ph) { lk.peerHash.delete(k); if (ph.h !== h) this.desync(ph); }
        }
        // the score for the people around the court (whoever has the lowest seat of those still playing reports it)
        if (k % 60 === 0 && !lk.offline && this.online.local === Math.min(...lk.humans.filter(id => g.players[id].human))) {
          const key = g.score.join('-');
          if (key !== lk.scoreKey) { lk.scoreKey = key; net.send({ t: 'score', score: [g.score[0], g.score[1]] }); }
        }
      }
      this.acc -= DT; steps++;
    }
    if (!spec) {
      // waiting on somebody's input: say who after a moment (a slow connection, or still loading in)
      if (waiting) lk.waitT += dt; else lk.waitT = 0;
      const who = lk.lost ? 'Connection to the host lost' : waiting && lk.waitT > 0.35 ? `Waiting for ${waiting.map(id => this.online.names?.[id] || g.players[id].name).join(', ')}…` : '';
      if (who !== (lk.waiting || '')) { lk.waiting = who; this.hud.setHint(who); }
    }
    if (lk.lost && !this.lostHandled) {
      this.lostHandled = true;
      if (!spec) this.hud.callout('CONNECTION LOST', 'bad');
      setTimeout(() => this.online.onLost?.(this), spec ? 0 : 1800);
    }
    if (g.over && !this.ended) {
      this.ended = true; this.endT = 0;
      if (this.grade) this.app.lastGrade = this.grade.result();
      // (whoever finishes first ends it on the service: the people who won hold the court)
      // (v0.4.8.7: with the final score: every real player's end goes on the game's record for the results check)
      if (!spec && !lk.offline) net.send({ t: 'end', g: this.online.game, winners: this.winnersOnline(), score: [g.score[0], g.score[1]] });
    }
    this.lastEvents = evs;
    if (this.ended) { this.endT += dt; if (this.endT > 3.2 && this.onEnd) { const f = this.onEnd; this.onEnd = null; f(g.summary(), this); } }
    this.render(dt);
  }

  render(dt) {
    const g = this.game, r = this.r;
    const alpha = Math.min(1, this.acc / DT);
    const [ox, oy, oz] = this.origin;
    const b = g.ball;
    const bx = M.lerp(b.px ?? b.x, b.x, alpha) + ox, by = M.lerp(b.py ?? b.y, b.y, alpha), bz = M.lerp(b.pz ?? b.z, b.z, alpha) + oz;
    // ball spin
    const w = Math.hypot(b.wx, b.wy, b.wz);
    // (qp3: the frame's scratch, reused: the spin's quaternion, the ball's position, each player's place for the animator)
    const fs = this._fs || (this._fs = { q: M.q4(), p: [0, 0, 0], st: { x: 0, y: 0, z: 0, facing: 0 } });
    if (w > 1e-3) { const q = M.qaxis(fs.q, b.wx / w, b.wy / w, b.wz / w, w * dt * this.timeScale); M.qmul(this.ballQ, q, this.ballQ); M.qnorm(this.ballQ, this.ballQ); }
    fs.p[0] = bx; fs.p[1] = by; fs.p[2] = bz;
    M.m4compose(this.ballMesh.matrix, fs.p, this.ballQ);
    this.ballMesh.visible = this.ballBlob.visible = !this.inIntro;
    M.m4fromYaw(this.ballBlob.matrix, bx, 0.011, bz, 0, Math.max(0.12, 0.42 - by * 0.06));
    const ballW = { x: bx, y: by, z: bz };
    // (qp3 perf: a background game at the park poses its players only when they can be seen: ParkHub.animDt)
    const cull = this.background && this.animDt;
    for (let i = 0; i < g.players.length; i++) {
      const p = g.players[i], v = this.visuals[i];
      const x = M.lerp(p.prevX, p.x, alpha) + ox, z = M.lerp(p.prevZ, p.z, alpha) + oz, y = M.lerp(p.prevY, p.y, alpha);
      const f = M.angleLerp(p.prevFacing, p.facing, alpha);
      const k = cull ? this.animDt(v, dt * this.timeScale, x, z) : dt * this.timeScale;
      if (cull) { v.setCulled(k < 0); if (k < 0) continue; }
      if (k > 0) { const st = fs.st; st.x = x; st.y = y; st.z = z; st.facing = f; v.anim.update(k, st, p, this.gameProxy(), ballW); }
      else v.view.move?.(x, y, z, f);
      v.setStatus(p.hot, p.cold, dt);
      v.place(x, y, z);
      // squeaks on hard plants
      if (p.plantT > 0 && !this.lastPlant.get(p.id)) audio.squeak(this.pan(x));
      this.lastPlant.set(p.id, p.plantT > 0);
    }
    if (!this.background) { this.defArrows(dt, alpha); this.clearGlow(dt); }
    // hoops (rim shake + nets) — pass ball in world coords (a background court's only while it can be seen)
    const hk = cull ? this.animDt(this.court, dt * this.timeScale, this.court.origin[0], this.court.origin[2], this.court.full ? 17 : 14) : dt * this.timeScale;
    if (hk > 0) for (const h of this.court.hoops) h.update(hk, ballW);
    if (this.venue.update && !this.opts.hub) this.venue.update(dt, { ball: ballW, phase: g.phase, over: g.over, events: this.frameEvents || [] });
    this.frameEvents = null;
    if (this.background) return;
    // camera
    const me = g.human;
    const meW = me ? { x: me.x + ox, z: me.z + oz, facing: me.facing } : null;
    const side = g.attackDir[g.possession];
    const focus = me && !this.meAuto() && g.possession === me.team && g.ball.holder !== me.id ? { x: (b.x * 0.7 + me.x * 0.3), z: (b.z * 0.7 + me.z * 0.3) } : { x: b.x, z: b.z };
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

  // v0.4.7.5 qp3: take it back. In a half-court park game the team that gets the ball off a miss (a shot off the board
  // or the rim) or a steal has to take it out past the arc before it can score: the three-point line glows red, pulsing,
  // until they do (the 'cleared' event), for both sides to see.
  clearGlow(dt) {
    const g = this.game;
    if (!(g.mode === 'park' && g.half)) return;
    if (!this.glowArc) {
      const tex = cachedTexture(this.r.ctx, 'glowBand', () => T.glowBand(64), { wrap: 'clamp' });
      const mat = new Material({ map: tex, color: M.hexLinear('#ff2a1a').map(v => v * 2.2), shading: 'unlit', blend: 'add', depthWrite: false, fog: false, emissive: [0, 0, 0], doubleSided: true, opacity: 0 });
      this.glowArc = new Mesh(this.r.ctx.geometry(G.threeLineRibbon(0.7)), mat, { castShadow: false, reflect: false });
      this.glowArc.order = 4; this.glowArc.visible = false; this.glowArc.k = 0;
      this.scene.add(this.glowArc);
    }
    const A = this.glowArc, team = g.possession;
    const want = !this.inIntro && !g.over && g.needsClear[team] && (g.phase === 'live' || g.phase === 'dead') ? 1 : 0;
    A.k += (want - A.k) * Math.min(1, dt * (want ? 8 : 5));
    A.visible = A.k > 0.02;
    if (!A.visible) return;
    const [ox, , oz] = this.origin, side = g.sideFor(team);
    M.m4fromYaw(A.matrix, ox, 0.018, oz, side > 0 ? 0 : Math.PI, 1);
    this.glowT = (this.glowT || 0) + dt;
    this.glowFlash = Math.max(0, (this.glowFlash || 0) - dt * 1.6);
    A.material.opacity = Math.min(1, A.k * (0.62 + 0.38 * Math.sin(this.glowT * 7)) + 0.6 * this.glowFlash);
  }

  // v0.4.7.5 quick patch: defensive assignment arrows. On defense, an arrow at the edge of your ring points at the man
  // you should be guarding (your matchup, the one the AI teammates leave to you), and one at his feet points back at
  // you. They grow a little the further off him you are, and fade out once you're on him.
  defArrows(dt, alpha) {
    const g = this.game, me = g.human;
    if (!this.arrows) {
      if (!me) return;
      const tex = cachedTexture(this.r.ctx, 'defArrow', () => T.arrowTexture(128), { wrap: 'clamp' });
      const mk = col => { const m = new Mesh(PlayerVisual.blobGeo, new Material({ map: tex, color: M.hexLinear(col), shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false, emissive: [0, 0, 0] }), { castShadow: false, reflect: false }); m.order = 6; m.visible = false; this.scene.add(m); return m; };
      this.arrows = { mine: mk('#ffd84a'), his: mk('#ff7a45'), k: 0, base: { mine: M.hexLinear('#ffd84a'), his: M.hexLinear('#ff7a45') } };
    }
    const A = this.arrows;
    const holder = g.holder ? g.holder() : null;
    const onD = me && !this.meAuto() && !g.over && !this.inIntro && settings.defArrows !== false && (holder ? holder.team !== me.team : g.possession !== me.team) && (g.phase === 'live' || g.phase === 'inbound' || g.phase === 'check');
    const man = onD ? g.ai.manOf(me) : null;
    const [ox, , oz] = this.origin;
    const pos = q => [M.lerp(q.prevX, q.x, alpha) + ox, M.lerp(q.prevZ, q.z, alpha) + oz];
    let want = 0, d = 0, P = null, Q = null;
    if (man && man.team !== me.team) {
      P = pos(me); Q = pos(man);
      d = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
      want = d > DEF_ARROW.on ? 1 : d < DEF_ARROW.off ? 0 : (d - DEF_ARROW.off) / (DEF_ARROW.on - DEF_ARROW.off);
    }
    A.k += (want - A.k) * Math.min(1, dt * 8);
    const vis = A.k > 0.02 && P;
    A.mine.visible = A.his.visible = !!vis;
    if (!vis) return;
    const ux = (Q[0] - P[0]) / (d || 1), uz = (Q[1] - P[1]) / (d || 1), yaw = Math.atan2(ux, uz);
    const sc = (DEF_ARROW.size + Math.min(DEF_ARROW.grow, d * DEF_ARROW.perM)) * (0.6 + 0.4 * A.k);
    M.m4fromYaw(A.mine.matrix, P[0] + ux * DEF_ARROW.out, 0.02, P[1] + uz * DEF_ARROW.out, yaw, sc);
    M.m4fromYaw(A.his.matrix, Q[0] - ux * DEF_ARROW.out, 0.02, Q[1] - uz * DEF_ARROW.out, yaw + Math.PI, sc);
    const pulse = 0.88 + 0.12 * Math.sin(performance.now() / 160);
    A.mine.material.opacity = A.his.material.opacity = Math.min(1, A.k) * 0.95;
    A.mine.material.color = A.base.mine.map(c => c * 1.4 * pulse);
    A.his.material.color = A.base.his.map(c => c * 1.4 * pulse);
  }

  // v0.4.7.5 green releases: the shooter's own sound (the AI at his own pitch and tempo) and effect over his head.
  // A three, or a clutch shot, puts on a bigger show. far: a background game's volume (0..1).
  greenRelease(P, e, mine, far = null) {
    const mode = settings.greens || 'all';
    if (mode === 'off' || (mode === 'mine' && !mine)) return;
    const g = this.game, big = e.three || (g.isClutch && g.isClutch(P.team));
    const power = big ? 1.22 : 1;
    const o = this.origin, head = () => [P.x + o[0], P.y + P.phys.H + 0.1, P.z + o[2]], feet = () => [P.x + o[0], 0, P.z + o[2]];
    // (qp3: the ball's time to the rim, for effects timed to the make: a jumper ~1 s, a layup ~0.4 s)
    const b = g.ball, flight = b.mode === 'flight' ? (b.vy + Math.sqrt(Math.max(0, b.vy * b.vy + 2 * GRAVITY * (b.y - COURT.rimY)))) / GRAVITY : 0;
    greenFxFor(this.r, this.app.camera).play(P.greenFx || 'gfx_basic', head, feet, power, { flight });
    const x = P.x + o[0], z = P.z + o[2];
    const vol = far != null ? far * 0.5 : mine ? 1 : 0.62 * this.vol(x, z);
    const h = playGreenSound(audio, P.greenSound || 'gsnd_basic', { ...(P.greenVoice || {}), power, pan: this.pan(x), vol });
    if (h) (this.greenNow || (this.greenNow = new Map())).set(P.id, { h, t: performance.now(), pan: this.pan(x), vol });
  }
  // v0.4.7.5 quick patch: the record scratch. A green blocked in flight cuts its sound off; a release timed for a green
  // into a smothering contest starts the green sound and gets cut off the same way (no effect: it isn't going in).
  cutGreen(id) {
    const g = this.greenNow?.get(id);
    if (!g) return false;
    this.greenNow.delete(id);
    if (performance.now() - g.t > 1600) return false;
    g.h.stop(0.03);
    playRecordScratch(audio, { pan: g.pan, vol: g.vol });
    return true;
  }
  greenScratch(P, mine) {
    const mode = settings.greens || 'all';
    const x = P.x + this.origin[0], z = P.z + this.origin[2];
    const vol = mine ? 1 : 0.62 * this.vol(x, z);
    // (green sounds off: just the scratch, on your own shots)
    if (mode === 'off' || (mode === 'mine' && !mine)) { if (mine) playRecordScratch(audio, { pan: this.pan(x), vol }); return; }
    const h = playGreenSound(audio, P.greenSound || 'gsnd_basic', { ...(P.greenVoice || {}), pan: this.pan(x), vol });
    if (!h) return;
    (this.greenNow || (this.greenNow = new Map())).set(P.id, { h, t: performance.now(), pan: this.pan(x), vol });
    setTimeout(() => this.cutGreen(P.id), 140);
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
      case 'boxout': if (mine || e.victim === me.id) inp.rumble(0.35, 0.15, 90); break;
      case 'catch': if (mine) inp.rumble(0.05, 0.18, 40); break;
      case 'score': if (mine) inp.rumble(0.2, 0.45, 100); break;
      case 'gameOver': inp.rumble(0.6, 0.6, 400); break;
    }
  }

  handleEvents(events) {
    const g = this.game, hud = this.hud, [ox, , oz] = this.origin;
    for (const e of events) {
      const P = e.player != null ? g.players[e.player] : null;
      const mine = this.isMe(P);
      const myTeam = g.human ? g.human.team : 0;
      this.rumbleFor(e);
      // (qp3: an Icon badge's activation, the Hash-Slinging dunks, is the big one: hud.badge shows it 20% larger, with the
      // badge's full art running, for twice as long)
      // (v0.4.8.7 qp7: an Icon badge's pop-up shows for everyone on the floor, the AI's ICONs and the other players online
      // too, and for you watching a game: with his name when it isn't yours. Ordinary badges stay yours alone)
      if (e.type === 'badge' && (mine || e.icon)) { const bd = e.icon ? this.app.config.icon_badges?.[e.badge] : this.app.config.badges?.[e.badge]; hud.badge({ key: e.badge, tier: e.tier, name: bd?.name || e.badge, group: bd?.group, icon: !!e.icon, who: mine ? null : P?.name || null }); continue; }
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
            this.meterFreeze = e.win != null ? this.meterOf(e.smothered ? 0 : e.win, e.smothered ? 0 : e.nat, e.tRel, e.err, e.sure, !!e.smothered, e.grade) : null;
            const pos = this.screenOf(P, 2.4);
            // v0.4.5 quick patch: the % is how guarded you were at the release: the exact contest the release was
            // graded with (who was where, facing which way, hands up or not, their length and their defensive
            // ratings, help defense), 100% being a full contest
            if (settings.shotFeedback !== false) hud.release(pos.x, pos.y, (e.kind === 'layup' && gr.label ? 'Layup: ' : '') + (gr.label || (e.kind === 'ft' ? 'Free Throw' : 'Shot')), gr.color, e.kind === 'ft' ? 'Free throw' : guardedText(e.guard ?? e.contest));
          } else if (!mine && P && settings.shotFeedback !== false && settings.shotFeedbackAll && (e.kind !== 'layup' || e.grade !== 'none') && e.kind !== 'close') {
            // v0.4.7.5 qp3: everyone's shot feedback (Settings → Shot feedback for → Everyone's shots)
            const gr = GRADE[e.grade] || GRADE.none, pos = this.screenOf(P, 2.4);
            hud.releaseOther(pos.x, pos.y, `${P.name.split(' ').slice(-1)[0]}: ${(e.kind === 'layup' && gr.label ? 'Layup ' : '')}${gr.label || (e.kind === 'ft' ? 'Free Throw' : 'Shot')}`, gr.color, e.kind === 'ft' ? 'Free throw' : guardedText(e.guard ?? e.contest));
          }
          // v0.4.7.5: a green that goes in plays the shooter's green release sound and effect (everyone's, the AI too)
          if (e.grade === 'excellent' && e.made && P) this.greenRelease(P, e, mine);
          // v0.4.7.5 quick patch: timed right, but smothered: the green sound starts and a record scratch cuts it off.
          // qp3: and any green that isn't going in (a green layup that misses, a green from past 35 ft) gets the same
          else if ((e.scratch || (e.grade === 'excellent' && !e.made)) && P) this.greenScratch(P, mine);
          break;
        }
        case 'score': {
          const shooter = P;
          if (e.team === myTeam) this.myScoreAt = g.time;
          const big = e.pts === 3 || e.kind === 'dunk' || e.andOne;
          audio.cheer(big ? 1 : 0.5);
          this.scene.hype = big ? 1 : 0.5;
          const who = shooter ? shooter.name : 'Tip-in';
          const hsN = e.kind === 'dunk' ? hsName(this.lastDunkStyle) : null; // (qp3: a Hash-Slinging finish is named in the feed)
          hud.pushFeed(`${e.team === myTeam ? '▲' : '▼'} ${who} +${e.pts}${e.kind === 'dunk' ? ' · ' + (hsN || 'dunk') : e.three ? ' · three' : e.kind === 'layup' ? ' · layup' : ''}`, e.team === myTeam ? 'good' : 'bad');
          if (e.poster >= 0 && e.poster != null) hud.callout(this.lastDunkFlat ? 'FLATTENED!' : 'POSTERIZED!', 'hot'); // (v0.4.5 quick patch: no slow motion; play goes on)
          else if (e.oop) hud.callout('ALLEY-OOP!', 'hot');
          else if (e.kind === 'dunk' && (mine || shooter?.team === myTeam)) hud.callout(hsCallout(this.lastDunkStyle) || { '360': 'THREE-SIXTY!', windmill: 'WINDMILL!', cradle: 'CRADLE JAM!', double: 'DOUBLE CLUTCH!', reverse: 'REVERSE JAM!', tomahawk: 'TOMAHAWK!' }[this.lastDunkStyle] || ['SLAM!', 'JAM!', 'FLUSHED!'][g.tick % 3], 'hot');
          else if (e.three && mine) hud.callout('SPLASH!', 'good');
          if (e.andOne) { audio.whistle(); hud.callout('AND ONE!', 'hot'); }
          // (celebrations on big plays: celebrationEffects)
          if (this.isMe(shooter) && big) hud.setHint(`Press ${promptGlyph(this.input, 'G', 'UP')} to celebrate`);
          break;
        }
        case 'slam': {
          const h = this.hoopFor(e.side);
          // v0.4.3: flashier packages land harder. v0.4.5 quick patch: no slow motion on dunks any more (the game flows
          // straight through the rise and the finish); every slam hits harder instead: a bigger rim shake, camera
          // kick, sparks and sound, more for the flashier packages and posters
          const tier = e.tier || 0, flash = (e.flair || 0) >= 2, poster = e.poster >= 0 && e.poster != null;
          this.lastDunkStyle = e.style; this.lastDunkFlat = !!e.flat;
          if (e.made && h) {
            h.hit(4.2 + tier * 0.5 + (poster ? 0.8 : 0)); audio.rim(3 + tier * 0.3); audio.board(1 + tier * 0.15);
            this.rig.shake(0.26 + tier * 0.05 + (poster ? 0.08 : 0), 0.34 + tier * 0.06);
            this.r.particles.burst(h.rim.x, h.rim.y, h.rim.z, 26 + tier * 10, { color: [1.7, 1.45, 1.0], speed: 2.6 + tier * 0.45, life: 0.5, size: 0.022 });
            if (flash || poster) audio.cheer(1.1);
            if (e.hs) { audio.cheer(1.4); this.rig.shake(0.12, 0.5); } // (qp3: the park loses it for a Hash-Slinging finish)
          }
          if (P && (this.isMe(P) || poster || (flash && e.made))) this.highlightAt(P, 0.9);
          break;
        }
        case 'hang': { const h = this.hoopFor(e.side); if (h) h.hang = 1; break; }
        case 'hangRelease': { const h = this.hoopFor(e.side); if (h) { h.hang = 0; h.hit(1.5); } break; }
        case 'block': {
          // v0.4.7.5 quick patch: a green blocked in flight: the record scratch cuts the green sound off.
          // qp3: every blocked dunk gets the record scratch, green or not
          const wasGreen = this.cutGreen(e.shooter);
          if (!wasGreen && e.kind === 'dunk') { const S0 = g.players[e.shooter], sx = S0.x + ox; playRecordScratch(audio, { pan: this.pan(sx), vol: this.isMe(S0) ? 1 : 0.7 * this.vol(sx, S0.z + oz) }); }
          audio.board(1.2); audio.ooh(); this.rig.shake(0.1, 0.25);
          const blk = g.players[e.player];
          const bst = e.style ? BLOCK_BY_ID[e.style] : null;
          hud.pushFeed(`${blk.name} blocks ${g.players[e.shooter].name}${bst ? ' · ' + bst.name : ''}`, blk.team === myTeam ? 'good' : 'bad');
          // (v0.4.8.5: a Big Brother block's own callout comes first, chase-down or not)
          if (this.isMe(blk) || this.isMe(g.players[e.shooter])) { hud.callout((this.isMe(blk) && bst?.icon && blockCallout(e.style)) || (e.chase ? 'CHASE-DOWN!' : (this.isMe(blk) && blockCallout(e.style)) || 'REJECTED!'), this.isMe(blk) ? 'good' : 'bad'); this.slow(0.5); }
          break;
        }
        case 'steal': {
          const st = g.players[e.player], vic = g.players[e.victim];
          hud.pushFeed(`${st.name} ${e.intercept ? 'picks off the pass' : e.bump ? 'strips' : 'steals from'} ${e.intercept ? '' : vic.name}`.trim(), st.team === myTeam ? 'good' : 'bad');
          if (this.isMe(st)) hud.callout('PICKPOCKET!', 'good');
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
        // v0.4.7.5: box-outs you're part of, and the named dribble combos you pull off
        case 'boxout': {
          const bx = g.players[e.player], vc = g.players[e.victim];
          if (this.isMe(bx)) { hud.pushFeed(`You box out ${vc.name}`, 'good'); audio.board(0.25); }
          else if (this.isMe(vc)) { hud.pushFeed(`${bx.name} boxes you out`, 'bad'); audio.board(0.25); }
          break;
        }
        case 'move': if (e.combo && this.isMe(g.players[e.player])) hud.pushFeed(`${e.combo}!`, 'good'); break;
        case 'turnover': case 'violation':
          if (e.type === 'violation' && e.what === 'Traveling') { if (P && P.team === myTeam) hud.callout('TRAVELING', 'bad'); break; } // the turnover event that follows whistles and posts it
          // (qp3: three seconds in the lane is called like traveling; the turnover says whose ball it is now)
          if (e.type === 'violation' && e.what === 'Offensive 3 seconds') { if (P && P.team === myTeam) hud.callout('3 SECONDS', 'bad'); break; }
          audio.whistle(); hud.pushFeed(`${e.why || e.what || 'Turnover'}${e.type === 'turnover' && e.team != null ? (e.team === myTeam ? ' · your ball' : ' · their ball') : ''}`, 'neutral'); break;
        case 'oob': audio.whistle(); break;
        case 'foul': audio.whistle(); break;
        case 'feed': hud.pushFeed(e.text, 'neutral'); break;
        case 'oopPrompt': if (mine) { audio.cheer?.(0.3); this.rig.shake?.(0.04, 0.15); this.oopShow = null; } break; // (qp3) the prompt itself is drawn in updateHUD
        case 'oopQte': if (mine) this.oopShow = { t: 0.8, state: e.result === 'hit' ? 'hit' : 'miss', text: e.result === 'hit' ? 'OOP!' : e.result === 'wrong' ? 'WRONG BUTTON' : e.result === 'early' ? 'TOO EARLY' : 'TOO LATE' }; break;
        case 'oopMiss': { const P2 = g.players[e.player]; if (this.isMe(P2)) hud.callout('OFF THE HANDS', 'bad'); else if (P2) hud.pushFeed(`${P2.name} can't handle the lob`, P2.team === myTeam ? 'bad' : 'good'); break; }
        case 'check': hud.pushFeed(e.team === myTeam ? 'Your ball — check it up' : 'Defense — check ball', 'neutral'); this.rig.snap(); break;
        case 'inbound': this.rig.snap(); break;
        case 'cleared': if (e.team === myTeam) hud.pushFeed('Ball cleared', 'neutral'); break;
        case 'possession': if (g.mode === 'park' && g.half && e.team === myTeam && e.reason !== 'check') hud.pushFeed('Take it back past the arc!', 'neutral'); break;
        // (v0.4.8 the Sharp Eye backflip after a green: the crowd goes)
        case 'backflip': audio.cheer(mine ? 1.2 : 0.8); if (mine) this.rig.shake?.(0.05, 0.25); break;
        // (v0.4.8: a shot asked for before the ball's been taken back: the call, and the arc flares up)
        case 'mustClear': if (P && P === g.human) { hud.callout('TAKE IT BACK', 'bad'); if (this.glowArc) this.glowFlash = 1; } break;
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
        // qp3 online: a teammate's big answers your screen call; someone dropped out and the AI has his player
        case 'screenCall': if (P === g.human) hud.pushFeed(`${g.players[e.big].name}: setting a screen`); break;
        case 'dropped': if (P) hud.pushFeed(`${this.online?.names?.[e.player] || P.name} left · the AI has his player`, 'neutral'); break;
        // v0.4.8.7 qp5: a seat's auto-play, on every screen (his tag says AUTO while it's on)
        case 'autoplay': if (P) hud.pushFeed(this.isMe(P) ? (e.on ? `You're on auto-play: the AI has your player (${this.input?.actionText?.('assist') || 'H'} to take over)` : 'You\'re back in control') : `${this.online?.names?.[e.player] || P.name} ${e.on ? 'is on auto-play' : 'is back from auto-play'}`, 'neutral'); break;
      }
    }
    this.celebrationEffects(events);
  }

  // The part of the events that changes the game itself: who celebrates a big play (the game's rng decides), when he
  // does, and who stops for a check. v0.4.7.5 qp3: every screen of an online game runs it the same way, the ones
  // watching from the sideline too (it used to sit inside handleEvents, so a watcher's game drifted from the players')
  celebrationEffects(events) {
    const g = this.game;
    for (const e of events) {
      if (e.type === 'score') {
        const shooter = e.player != null ? g.players[e.player] : null, big = e.pts === 3 || e.kind === 'dunk' || e.andOne;
        if (shooter && (big || e.swish) && !shooter.human && g.rng.next() < 0.6) shooter.pendingCelly = this.celebrationKind(shooter);
      } else if (e.type === 'check' || e.type === 'inbound') this.checkCelebrations();
    }
    // celebrations during dead balls
    if (g.phase === 'dead' || g.phase === 'check' || g.phase === 'inbound') for (const p of g.players) if (p.pendingCelly && !p.action && !p.airborne && g.ball.holder !== p.id && !(g.phase === 'inbound' && g.inbounder === p)) { p.startAction('celebrate', 1.5, { kind: p.pendingCelly }); p.pendingCelly = null; }
    if (g.phase === 'live') for (const p of g.players) p.pendingCelly = null;
  }

  // distant courts: only positional sounds and hoop reactions
  backgroundEvents(events) {
    const g = this.game, [ox, , oz] = this.origin;
    if (this.spectate) this.celebrationEffects(events); // (watching an online game: the same game as the players')
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
      else if (e.type === 'release' && near && e.grade === 'excellent' && e.made && g.players[e.player]) this.greenRelease(g.players[e.player], e, false, k);
      else if (e.type === 'block' && near) this.cutGreen(e.shooter);
    }
  }

  // v0.4.5 quick patch: the icon pass input over a teammate's head, for whatever you're playing with right now: the
  // key on a keyboard (your binding), the modifier + face button on a controller (your binding, your pad's symbols)
  // v0.4.8.8: the rank icon by a player's name (his entry's tier: sim/ranks.js entryRankTier), made once per player and
  // tier (the tags are compared by their text every frame: the same string while nothing changes)
  rankTag(p) {
    const m = this._rankTags || (this._rankTags = new Map()), tier = entryRankTier(p.entry);
    let r = m.get(p.id);
    if (!r || r.tier !== tier) m.set(p.id, r = { tier, html: nameRankIcon(tier, 13) });
    return r.html;
  }

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
    // (v0.4.8.7 qp7: in the page at once, filled when the controls table has loaded: a quick second Tab closes it instead of
    // opening a second one on top, and one closed before it filled stays closed)
    document.body.appendChild(d);
    import('../ui/screens.js').then(S => { if (d.isConnected) d.innerHTML = `<h3>Controls</h3>${S.controlsTable(this.app)}${meterLegendHTML()}<p class="muted small">Tab / RS click to close</p>`; }).catch(() => d.remove());
  }

  // (a check or an inbound: whoever has the ball stops celebrating; everyone else gets to finish)
  checkCelebrations() {
    const g = this.game;
    for (const p of g.players) {
      const ball = g.ball.holder === p.id || (g.phase === 'inbound' && g.inbounder === p);
      if (ball) p.pendingCelly = null;
      if (ball && p.action?.type === 'celebrate') p.action = null;
    }
  }

  hoopFor(side) {
    const hs = this.court.hoops;
    return hs.find(h => h.side === side) || hs[0];
  }

  slow(t) { if (!this.online) this.slowT = Math.max(this.slowT, t); } // (online: no slow motion; it would hold up everyone)
  highlightAt(p, dur) { const [ox, , oz] = this.origin; this.highlight = { x: p.x + ox, y: 1.2 + p.y, z: p.z + oz, t: dur, dur }; }

  screenOf(p, h = 2.2) { const [ox, , oz] = this.origin; return this.r.project(this.app.camera, [p.x + ox, p.y + h, p.z + oz]); }

  jumboInfo() {
    const g = this.game, t = this.teams;
    return { title: this.opts.jumboTitle || (t[0].name ? 'PRO-AM' : 'RIMRIFT'), home: g.score[0], away: g.score[1], homeName: t[0].abbr, awayName: t[1].abbr, homeColor: t[0].color, awayColor: t[1].color, clock: fmtClock(g.gameClock), period: g.quarter > g.quarters ? 'OT' : `Q${g.quarter}` };
  }

  // v0.4.5 quick patch: the live shot meter, from the very functions that grade the release (Game.jumperWindow /
  // layupWindow / ftWindow), with the contest measured the way the release measures it (at the ball), so the window
  // on screen is the window you get if you let go now. null: no timed shot in progress (close shots aren't timed).
  liveMeter(me, a) {
    const g = this.game;
    if (!a || g.assist || (this.online && me?.auto) || a.released || !a.tRel) return null; // (qp5: none on auto-play, yours online too)
    let W;
    if (a.type === 'ftshot') W = g.ftWindow(me);
    else if (a.type === 'layup' && (a.releaseAt != null || a.t <= 0.04)) return null;
    else {
      // (v0.4.7.5 quick patch: a finish can be smothered too: no window, measured the way the release measures it.
      // v0.4.8: one reading for the meter and the release (Game.meterRead): a shot out of the post with the shield the
      // release gives it, and the hook, which is timed, with its meter)
      const r = g.meterRead(me, a);
      if (!r) return null;
      W = r.W;
    }
    return this.meterOf(W.total, W.natural, a.tRel, (a.releaseAt ?? a.t) - a.tRel, W.sure, !!W.smothered, '');
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
    if (!this.online) g.greenBonus = settings.shotMeter === false ? 1.1 : 1; // (online: fixed for the game, the same on every screen)
    // score bug
    let clock, sub;
    if (g.mode === 'park') { clock = `FIRST TO ${g.target}`; sub = g.needsClear[g.possession] ? 'CLEAR IT' : '2s & 3s'; }
    else if (g.mode === 'practice') { const s = me ? me.stats : null; clock = 'PRACTICE'; sub = s ? `${s.fgm}/${s.fga} FG · ${s.tpm}/${s.tpa} 3PT` : ''; }
    else { clock = fmtClock(g.gameClock); sub = g.quarter > g.quarters ? 'OT' : `Q${g.quarter}`; }
    hud.setGrade(this.grade && settings.gradeHud !== false ? this.grade : null, me ? me.stats : null); // (v0.4.7.5 quick patch: with your line)
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
      // (v0.4.8 online: from the moment you let go, the meter stays where you let go, on the window you let go on: the
      // release is graded right there when it lands a few ticks later, and the result comes up on that same picture)
      const held = this.letGo && a && this.letGo.a === a && !a.released ? this.letGo.m : null;
      if (live || held) hud.setMeter(settings.shotMeter === false ? null : { x: pos.x, y: pos.y, ...(held || live) });
      else if (this.meterHold > 0 && this.meterFreeze && settings.shotMeter !== false) {
        // after the release: frozen where you let go, on the exact window the release was graded against
        this.meterHold -= dt;
        hud.setMeter({ x: pos.x, y: pos.y, ...this.meterFreeze });
      } else hud.setMeter(null);
      hud.setStamina(pos.x, pos.y + 70, me.stamina, me.sprinting || me.stamina < 0.5);
      // v0.4.7.5 qp3: the alley-oop button prompt while the lob is in the air, then the result for a moment
      const q = me.oopQte;
      if (q && !q.result) {
        const t = g.time - q.t0, open = t >= q.open;
        hud.setOop({ x: pos.x, y: pos.y, html: this.input.faceGlyph(q.btn), frac: Math.max(0, Math.min(1, (q.close - t) / q.close)), state: open ? 'open' : 'wait' });
      } else if (this.oopShow && this.oopShow.t > 0) {
        this.oopShow.t -= dt;
        hud.setOop({ x: pos.x, y: pos.y, html: this.oopShow.text, frac: 0, state: this.oopShow.state });
      } else hud.setOop(null);
      const to = me.takeover, TO = TAKEOVERS[to.kind];
      hud.setStatus(this.inIntro ? null : { hot: !!me.hot, cold: !!me.cold, takeover: TO && (to.active || to.prog > 0) ? { label: TO.label, active: to.active, left: Math.ceil(to.left), prog: to.prog, need: TAKEOVER_NEED } : null });
    }
    // tags: names + icon numbers for passing. (qp3: Settings → Name tags used to change nothing here; hidden, only the
    // pass icons over your teammates stay up while you have the ball, without the names)
    const names = settings.tags !== false;
    if (this.inIntro || !this.tagsOn) hud.setTags([]);
    else {
      const list = [];
      const mates = me ? g.mates(me) : [];
      const showIcons = me && g.ball.holder === me.id;
      for (const p of g.players) {
        const icon = showIcons ? mates.indexOf(p) : -1;
        if (!names && icon < 0) continue;
        const s = this.screenOf(p, p.phys.H + 0.32 + p.y);
        const team = this.teams[p.team];
 const mine = this.isMe(p), friend = !mine && p.human; // (online: the other people in the game, by their username)
        const nm = friend ? (this.online?.names?.[p.id] || p.name.split(' ').slice(-1)[0]) : p.name.split(' ').slice(-1)[0];
        // (v0.4.8.7 qp5: a person's player on auto-play says so by his name)
        const auto = names && p.human && g.multi && p.auto ? ' <em class="ptag-auto">AUTO</em>' : '';
        // (v0.4.8.8: and the rank icon of his current Pro-Am tier by the name, from Silver up: rankTag)
        const rk = names ? this.rankTag(p) : '';
        const txt = (!names ? this.iconPassGlyph(icon) : mine ? `${rk}<b>YOU</b>` : icon >= 0 ? `${this.iconPassGlyph(icon)}${rk}${esc2(nm)}` : rk + esc2(nm)) + auto;
        list.push({ id: p.id, x: s.x, y: s.y, text: txt, cls: (mine ? 'me ' : friend ? 'friend ' : '') + (p.team === (me ? me.team : 0) ? 'mate' : 'opp') + (p.calling > 0 ? ' calling' : ''), visible: s.visible && s.depth < 45 });
      }
      hud.setTags(list);
    }
  }

  dispose() {
    if (this.disposed) return; // the park can finish a court's game from two places in one frame
    this.disposed = true;
    if (this.online && !this.spectate) this.r?.resetGovern?.(); // (qp3 perf: the next game starts at full graphics)
    for (const v of this.visuals) v.dispose();
    this.scene.remove(this.ballMesh);
    this.scene.remove(this.ballBlob);
    if (this.arrows) { this.scene.remove(this.arrows.mine); this.scene.remove(this.arrows.his); }
    if (this.glowArc) { this.scene.remove(this.glowArc); this.r.ctx.disposeGeometry(this.glowArc.geo); }
    this.r.ctx.disposeGeometry(this.ballMesh.geo);
    if (!this.background) { this.hud.clear(); const h = document.getElementById('help-overlay'); if (h) h.remove(); }
    if (this.offNet) { this.offNet(); this.offNet = null; }
    // (QP3: a game with a scene of its own, its venue built for it by ui/modes.js or ui/prorun.js, frees it with itself; a
    // hub's games (opts.hub) are drawn in the hub's scene, which the hub frees: world/release.js)
    if (!this.opts?.hub) releaseScene(this.r?.ctx, this.scene);
  }
}
