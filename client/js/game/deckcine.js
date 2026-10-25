// v0.4.8.9 The Gauntlet, the Hub agent's part (docs/GAUNTLET.md §10): the cinematic court over the card table. Every
// engine event with an animation tag ({actor, anim, made, points, stops}, deck/index.js playCard / endTurn) plays the
// matching play on a real court with real athletes: your player against the opponents (and a teammate on each side,
// so a pass has somewhere to go). Nothing here runs the game sim: the plays are scripted, but they're played with the
// game's own pieces, so they look like the game:
//  * the athletes are PlayerVisuals posed by the game's animator (char/animator.js) from scripted actions with the
//    same data the sim gives them (shoot, layup, dunk, post, move, pass, steal, block, rebound, stumble, celebrate);
//  * the ball in a player's hands rides the sim's own hold point (Game.prototype.holdPoint), so the hands are on it;
//  * a shot flies as a real ball (sim/ball.js) on a plan from sim/shots.js planShot: a make goes in, a miss rims out;
//  * the court is a park's (world/venues.js) or, for bosses, one of the twelve Pro-Am parks (world/proamparks.js).
// The camera is a broadcast camera that cuts on the big plays (a dunk, a made three, a block, a steal), framed so the
// action sits in the top part of the screen above the card table. Plays queue (PlayQueue): each takes 1-2 s, a long
// queue plays faster, and the player can skip the current play or fast-forward. Pure parts (PLAYS, playFor,
// PlayQueue) have no renderer and are what tests/v0489gauntletui.test.mjs checks.
// v0.4.8.9 qp4, the Gauntlet in possessions (scratchpad contract QP4 §4): the engine's possession events play too:
// the tip-off, the run back the other way after a change of possession (and the fast break after a steal), each shot's
// outcome as the card combination decided it (made, assist, and-one, block, steal, contest and the rebound after it),
// fouls and free throws, and the defensive cards played against the offense. Within one possession the plays run on
// from one another without a cut (the men move to where the next play starts); tests/qp4hub.test.mjs drives them with
// hand-written event lists.
import { Scene, Material, Mesh } from '../gfx/renderer.js';
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { buildVenue } from '../world/venues.js';
import { cachedTexture } from '../world/court.js';
import { releaseScene } from '../world/release.js';
import { Player } from '../sim/player.js';
import { resolveLook, makeBot } from '../sim/bots.js';
import { Game } from '../sim/game.js';
import { Ball } from '../sim/ball.js';
import { planShot } from '../sim/shots.js';
import { COURT, BALL_R } from '../sim/constants.js';
import { RNG, hashString } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { PlayerVisual } from './session.js';
import * as M from '../core/math.js';
import { hypot2, hypot3 } from '../gfx/fastmath.js'; // (qp3: Math.hypot, without its per-call allocation)

const HZ = COURT.hoopZ, RIM = { x: 0, y: COURT.rimY, z: HZ }, G0 = 9.81;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const toRim = (x, z) => Math.atan2(RIM.x - x, RIM.z - z);

// ---------------- what each animation tag plays ----------------
// role: who the actor is in the play (offense: he has the ball; defense: he guards the man with it; solo: alone).
// big: a play the camera cuts for. base: its length at normal speed (s), before the outcome's few frames.
export const PLAYS = {
  jumper: { role: 'offense', shot: 'mid', base: 2.0, label: 'pull-up jumper' },
  three: { role: 'offense', shot: 'three', base: 2.3, big: 'made', label: 'three' },
  layup: { role: 'offense', shot: 'layup', base: 2.0, label: 'layup' },
  dunk: { role: 'offense', shot: 'dunk', base: 1.9, big: 'always', label: 'dunk' },
  floater: { role: 'offense', shot: 'floater', base: 2.1, label: 'floater' },
  post: { role: 'offense', shot: 'post', base: 2.1, label: 'post move' },
  crossover: { role: 'offense', move: 'cross', base: 1.2, label: 'crossover' },
  spin: { role: 'offense', move: 'spin', base: 1.25, label: 'spin move' },
  stepback: { role: 'offense', move: 'stepback', shot: 'mid', base: 2.3, label: 'step-back' },
  pass: { role: 'offense', pass: 'chest', base: 1.2, label: 'pass' },
  lob: { role: 'offense', pass: 'lob', base: 1.8, big: 'always', label: 'lob' },
  closeout: { role: 'defense', base: 1.3, label: 'closeout' },
  contest: { role: 'defense', base: 1.8, label: 'contest' },
  block: { role: 'defense', base: 1.9, big: 'always', label: 'block' },
  steal: { role: 'defense', base: 1.3, big: 'always', label: 'steal' },
  rebound: { role: 'defense', base: 2.1, label: 'rebound' },
  celebrate: { role: 'solo', base: 1.4, label: 'celebration' },
  gassed: { role: 'solo', base: 1.2, label: 'gassed' },
  foul: { role: 'defense', base: 1.5, label: 'foul' },
  // (qp4: the possession plays. solo here means the play picks its own men: offWho / defWho on the play)
  tipoff: { role: 'solo', base: 2.6, big: 'always', label: 'tip-off', long: true },
  transition: { role: 'solo', base: 1.5, label: 'brings it up', long: true },
  fastbreak: { role: 'solo', base: 1.7, big: 'always', label: 'fast break', long: true },
  assist: { role: 'offense', base: 3.0, label: 'assist', long: true },
  andone: { role: 'offense', base: 2.9, big: 'always', label: 'and-one', long: true },
  board: { role: 'solo', base: 1.6, label: 'rebound', long: true },
  freethrow: { role: 'solo', base: 2.3, label: 'free throw', long: true },
  guard: { role: 'defense', base: 1.1, label: 'on him' },
  protect: { role: 'defense', base: 1.1, label: 'protects the rim' },
  swipe: { role: 'defense', base: 1.1, label: 'swipes at it' },
  boxout: { role: 'defense', base: 1.0, label: 'boxes out' },
  sizeup: { role: 'offense', move: 'cross', base: 1.0, label: 'sizes him up' },
  charge: { role: 'defense', base: 1.8, big: 'always', label: 'takes the charge' },
};
// (qp4) a defensive card played in a possession is the defender getting into it, not a play of its own: the shot that
// meets it is the shot event's. A shot tag on a card is the shooter sizing his man up before it
const CARD_ANIM = { contest: 'guard', foul: 'guard', block: 'protect', steal: 'swipe', rebound: 'boxout', lob: 'pass', jumper: 'sizeup', three: 'sizeup', layup: 'sizeup', dunk: 'sizeup', floater: 'sizeup', post: 'sizeup' };
// the shots' own plays (the shot's tag) and how each outcome of the clash shows (QP4 §3; the engine decides which)
const SHOT_ANIMS = new Set(['jumper', 'three', 'layup', 'dunk', 'floater', 'post', 'stepback']);
// the event types only the possession engine sends (a batch with one of them plays as one possession: no cuts)
export const POSSESSION_TYPES = new Set(['jump', 'tip', 'tipoff', 'jump_ball', 'possession', 'rebound', 'foul', 'ft', 'clash', 'wall']);
// table-only events in a possession: their text goes to the log, nothing plays on the court (a Shot Clock violation's
// and a Fatigue card's foul tag, the banked Stops, the statuses, the draws)
const TABLE_ONLY = new Set(['clash', 'wall', 'rule', 'fatigue', 'status', 'stops', 'draw', 'turn', 'end', 'betray', 'energy', 'flow', 'combo', 'power', 'burn']);
const sideOf = who => (who === 'you' ? 'you' : 'them');
// which side has the ball in a play ('you' | 'them')
function playOffSide(p) {
  if (p.offWho !== undefined) return sideOf(p.offWho);
  if (p.role === 'defense') return p.actor === 'you' ? 'them' : 'you';
  return sideOf(p.actor);
}
// plays that set the floor up themselves (never run on from the last one), and the one that runs on from wherever the
// last play left everybody, whoever has the ball (the rebound off a miss)
const RESETS = new Set(['tipoff', 'transition', 'fastbreak', 'freethrow']);
const FROM_HERE = new Set(['board']);
// what a court event plays: the play, who does it, against whom, and whether the ball goes in. A shot the Stops ate
// (made, but no points) is a miss on the court: the defense got there. null: nothing to play (a text-only event)
export function playFor(ev, opts = {}) {
  if (!ev) return null;
  const v2 = possessionPlay(ev, opts);
  if (v2 !== undefined) return v2;
  if (ev.type === 'card' && CARD_ANIM[ev.anim]) ev = { ...ev, anim: CARD_ANIM[ev.anim], made: false, points: 0 };
  if (!ev.anim || !PLAYS[ev.anim]) return null;
  const P = PLAYS[ev.anim], nOpp = Math.max(1, opts.opps || 1);
  const you = ev.actor === 'you' || ev.actor == null;
  const actor = you ? 'you' : clamp(ev.actor | 0, 0, nOpp - 1);
  const versus = you ? clamp(ev.target ?? opts.target ?? 0, 0, nOpp - 1) : 'you';
  const scoring = !!P.shot && (ev.type === 'shot' || ev.points > 0 || ev.made);
  const made = scoring ? !!ev.made && (ev.points > 0 || !ev.stops) : false;
  const dur = clamp(P.base, 1.0, 2.4);
  return { anim: ev.anim, role: P.role, actor, versus, made, scoring, points: ev.points | 0, stops: ev.stops | 0, big: P.big === 'always' || (P.big === 'made' && made), dur, text: ev.text || '', ev };
}

// (qp4) the possession engine's events: a play, null (text only: the clash), or undefined (not one of them: the plain
// card and shot plays above take it). Who's who: 'you', an opponent's index, or for a side 'you' | 'them' (the lead
// opponent, opts.lead ?? 0, stands for them)
function possessionPlay(ev, opts) {
  const nOpp = Math.max(1, opts.opps || 1), lead = clamp(opts.lead ?? 0, 0, nOpp - 1);
  const who = w => (w === 'you' || w == null ? 'you' : w === 'them' ? lead : clamp(w | 0, 0, nOpp - 1));
  const vs = w => (w === 'you' ? clamp(opts.target ?? 0, 0, nOpp - 1) : 'you');
  const mk = (anim, o) => { const P = PLAYS[anim]; return { anim, role: P.role, actor: o.offWho ?? 'you', versus: o.defWho ?? null, made: false, scoring: false, points: 0, stops: 0, big: P.big === 'always', dur: P.base, text: ev.text || '', ev, ...o }; };
  if (TABLE_ONLY.has(ev.type)) return null;
  switch (ev.type) {
    case 'jump': { // (the engine's tip-off: actor is who won it)
      const win = ev.actor === 'you' ? 'you' : 'them';
      return mk('tipoff', { offWho: win === 'you' ? 'you' : who(ev.actor), defWho: win === 'you' ? lead : 'you', winner: win });
    }
    case 'tip': case 'tipoff': case 'jump_ball': {
      const win = sideOf(ev.winner ?? ev.to ?? 'you');
      return mk('tipoff', { offWho: win === 'you' ? 'you' : lead, defWho: win === 'you' ? lead : 'you', winner: win });
    }
    case 'possession': {
      const to = sideOf(ev.to), off = to === 'you' ? 'you' : lead;
      return mk(ev.turnType === 'fast_break' ? 'fastbreak' : 'transition', { offWho: off, defWho: off === 'you' ? lead : 'you', toSide: to, turnType: ev.turnType || null });
    }
    case 'rebound': { const r = who(ev.actor); return mk('board', { offWho: r, defWho: vs(r), offensive: !!ev.offensive }); }
    case 'foul': { const f = who(ev.actor); return mk('foul', { actor: f, offWho: vs(f), defWho: f, role: 'defense' }); }
    case 'ft': { const s = who(ev.actor), pts = ev.points | 0; return mk('freethrow', { offWho: s, defWho: vs(s), actor: s, made: pts > 0, scoring: true, points: pts }); }
    case 'shot': {
      if (!ev.how) return undefined; // (the engine before possessions: the plain shot play)
      // (the man guarding him: yours, the opponent your shot went at (the event's target); his, you)
      const s = who(ev.actor), d = ev.by != null ? who(ev.by) : s === 'you' ? clamp(ev.target ?? opts.target ?? 0, 0, nOpp - 1) : 'you';
      const anim0 = PLAYS[ev.anim] && SHOT_ANIMS.has(ev.anim) ? ev.anim : 'jumper', pts = ev.points | 0;
      const base = { offWho: s, defWho: d, actor: s, versus: d, shotAnim: anim0, points: pts, stops: ev.stops | 0, scoring: true };
      if (ev.how === 'block') return mk('block', { ...base, actor: d, made: false, role: 'defense' });
      if (ev.how === 'steal') return mk('steal', { ...base, actor: d, made: false, role: 'defense', scoring: false });
      if (ev.how === 'charge') return mk('charge', { ...base, actor: d, made: false, role: 'defense', scoring: false });
      const made = ev.how === 'made' || ev.how === 'assist' || ev.how === 'and_one';
      if (ev.how === 'assist') return mk('assist', { ...base, made, assistWho: ev.assist != null ? who(ev.assist) : s });
      if (ev.how === 'and_one') return mk('andone', { ...base, made });
      // made or contested: the shot's own play
      const P = PLAYS[anim0];
      return { ...mk(anim0, base), role: 'offense', made, big: P.big === 'always' || (P.big === 'made' && made), dur: clamp(P.base, 1.0, 2.4) };
    }
    default: return undefined;
  }
}

// ---------------- the queue ----------------
// Plays one after another. speed: 1, and up to 3 when the player fast-forwards; a queue that backs up plays a little
// faster on its own (more than 2 waiting: 1.5x, more than 5: 2.2x), so a burst of cards stays readable and doesn't lag
// behind the table. skip(): the current play ends now (its outcome still lands); skipAll(): everything waiting lands.
// (qp7 §2: a play whose length isn't a positive number would never end and keep the court busy: it gets a short one.
// begin() notes the wall-clock time a play started (now(), ms) for the watchdog: stuck() names a play that has run past
// its length and the margin, the speed it was played at taken into account)
const nowMs = () => (globalThis.performance?.now ? performance.now() : Date.now());
export class PlayQueue {
  constructor(o = {}) { this.items = []; this.cur = null; this.t = 0; this.fast = false; this.onStart = o.onStart || null; this.onEnd = o.onEnd || null; this.done = 0; this.wall = 0; this.now = o.now || nowMs; }
  push(...plays) { for (const p of plays.flat()) if (p) { if (!(Number.isFinite(p.dur) && p.dur > 0)) p.dur = 0.6; this.items.push(p); } return this; }
  get busy() { return !!this.cur || this.items.length > 0; }
  get pending() { return this.items.length + (this.cur ? 1 : 0); }
  speed() { const n = this.items.length; return (this.fast ? 3 : 1) * (n > 5 ? 2.2 : n > 2 ? 1.5 : 1); }
  // advance by dt (real seconds); returns the play on now (or null)
  update(dt) {
    if (!this.cur && this.items.length) this.begin();
    if (!this.cur) return null;
    this.t += dt * this.speed();
    if (this.t >= this.cur.dur) this.finish();
    return this.cur;
  }
  begin() { this.cur = this.items.shift(); this.t = 0; this.wall = this.now(); this.onStart?.(this.cur); }
  // the watchdog's question: the play on now, if it has run past its length (at the slowest speed) + margin ms
  stuck(margin = 4000, now = this.now()) { return this.cur && now - this.wall > this.cur.dur * 1000 + margin ? this.cur : null; }
  finish() { const c = this.cur; if (!c) return; this.cur = null; this.t = 0; this.done++; this.onEnd?.(c); }
  skip() { if (!this.cur && this.items.length) this.begin(); this.finish(); }
  skipAll() { while (this.busy) this.skip(); }
  clear() { this.items = []; if (this.cur) this.finish(); }
}

// ---------------- the court ----------------
// the PlayerVisual's hold point for the ball, from the sim's own (it reads only what it gets here)
const HOLD = { reachTop: Game.prototype.reachTop, phase: 'live' };
function holdPoint(p, ball) { HOLD.ball = { holder: p.id, mode: ball.mode === 'dribble' ? 'dribble' : 'held' }; try { return Game.prototype.holdPoint.call(HOLD, p, {}); } catch { return { x: p.x + Math.sin(p.facing) * 0.35, y: 1.1, z: p.z + Math.cos(p.facing) * 0.35 }; } }

// a body on the court: a sim Player for the animator's input, moved by the play (not the sim)
class Actor {
  constructor(dc, id, entry, side, rest) {
    this.dc = dc; this.id = id; this.side = side; this.rest = rest; this.entry = entry;
    this.p = new Player(id, side === 'you' ? 0 : 1, { build: entry.build, name: entry.name }, dc.catalog);
    this.p.id = id;
    this.p.setPos(rest.x, rest.z, toRim(rest.x, rest.z));
    this.visual = dc.r ? new PlayerVisual(dc.r, dc.scene, entry.build, entry.look, { detail: 0.9, now: true }) : null;
    this.target = null; this.speed = 0; this.face = null; this.jump = null; this.look = null;
  }
  goTo(x, z, speed = 3.5) { this.target = { x, z }; this.speed = speed; }
  place(x, z, face = null) { this.p.setPos(x, z, face ?? toRim(x, z)); this.target = null; this.jump = null; this.p.action = null; this.p.stance = 'normal'; this.p.contestHand = null; this.p.handsUp = false; this.face = null; }
  act(type, dur, data = {}) { this.p.startAction(type, dur, data); return this.p.action; }
  // a jump: off the floor at `at` seconds from now, to height h
  hop(h, at = 0) { const tUp = Math.sqrt(2 * Math.max(0.05, h) / G0); this.jump = { t: -at, h, tUp }; }
  update(dt) {
    const p = this.p;
    let vx = 0, vz = 0;
    if (this.target) {
      const dx = this.target.x - p.x, dz = this.target.z - p.z, d = hypot2(dx, dz);
      if (d < 0.04) this.target = null;
      else { const sp = Math.min(this.speed, d / Math.max(dt, 1e-3), 1.2 + d * 3); vx = dx / d * sp; vz = dz / d * sp; }
    }
    p.x += vx * dt; p.z += vz * dt; p.vx = vx; p.vz = vz;
    const want = this.face != null ? this.face : p.speed > 0.4 ? Math.atan2(vx, vz) : null;
    if (want != null) p.facing += wrapA(want - p.facing) * (1 - Math.exp(-dt * 11));
    if (p.action) { p.action.t += dt; if (p.action.t >= p.action.dur) p.action = null; }
    if (this.jump) {
      const j = this.jump; j.t += dt;
      const k = (j.t - j.tUp) / j.tUp;
      p.y = j.t <= 0 ? 0 : Math.max(0, j.h * (1 - k * k)); p.airborne = p.y > 0.005;
      if (j.t > 2 * j.tUp) { this.jump = null; p.y = 0; p.airborne = false; }
    } else { p.y = 0; p.airborne = false; }
    const ball = this.dc.ball;
    if (ball.holder === this && ball.mode === 'dribble') p.dribble.phase = (p.dribble.phase + dt * (1.7 + p.speed * 0.3)) % 1;
  }
  render(dt) {
    const v = this.visual; if (!v || v.pending) return;
    const p = this.p, [ox, , oz] = this.dc.origin, b = this.dc.ball, has = b.holder === this;
    const bw = { x: b.x + ox, y: b.y, z: b.z + oz };
    const look = this.look ? [this.look.x + ox, this.look.y ?? 1.6, this.look.z + oz] : null;
    // (the animator works in the world: the court's origin added in, its rim too)
    const st = { x: p.x + ox, y: p.y, z: p.z + oz, facing: p.facing };
    const sx = p.x, sz = p.z; p.x += ox; p.z += oz;
    try { v.anim.update(dt, st, p, null, b.mode === 'dead' ? null : bw, { hasBall: has, ballMode: b.mode === 'dribble' ? 'dribble' : 'held', look }); } finally { p.x = sx; p.z = sz; }
    v.place(p.x + ox, p.y, p.z + oz);
  }
  dispose() { this.visual?.dispose(); }
}

// opts: { venue: theme id ('harbor', 'proam_rooftop', ...), home: {name, abbr, primary, secondary, logo}, seed,
//         you: entry, opps: [entry], mates: [entry, entry] (optional), frameTop: share of the screen the court has (0-1),
//         onLand(play, score): a play's outcome landed (the score moves); onStart(play): a play begins (its caption);
//         onFrame(dt): every frame, before the court moves (the screen's gamepad keys) }. Without app.renderer (tests) nothing is drawn.
export class DeckCourt {
  constructor(app, opts = {}) {
    this.app = app; this.r = app?.renderer || null; this.catalog = app?.catalog || {}; this.opts = opts;
    this.scene = opts.scene || new Scene();
    this.rng = new RNG((opts.seed >>> 0) || 7);
    this.venueId = opts.venue || 'harbor';
    this.venue = this.r ? buildVenue(this.r, this.scene, this.venueId, { home: opts.home, seed: opts.seed >>> 0, team: opts.home }) : null;
    const court = this.venue?.courts?.[0];
    this.origin = court?.origin || [0, 0, 0];
    this.hoops = court?.hoops || [];
    this.full = court ? (court.full ?? (court.format || 0) >= 5) : true; // (qp4: a full court tips off at centre court)
    this.frameTop = opts.frameTop ?? 0.52;
    const bot = (k, lvl) => { const b = makeBot(new RNG(hashString(`${opts.seed}|${k}`)), { level: lvl }); return { build: b.build, name: b.name, look: resolveLook(b.build, this.catalog) }; };
    const youE = opts.you || bot('you', 0.5), oppE = (opts.opps && opts.opps.length ? opts.opps : [bot('opp', 0.6)]).slice(0, 3);
    const mates = opts.mates || [bot('mate0', 0.5), bot('mate1', 0.55)];
    let id = 0;
    this.you = new Actor(this, id++, youE, 'you', { x: 0, z: HZ - 9 });
    this.opps = oppE.map((e, i) => new Actor(this, id++, e, 'opp', { x: [0, -2.6, 2.6][i], z: HZ - 7.2 }));
    this.mates = [new Actor(this, id++, mates[0], 'you', { x: -6.2, z: HZ - 5.5 }), new Actor(this, id++, mates[1], 'opp', { x: 6.2, z: HZ - 5.0 })];
    this.actors = [this.you, ...this.opps, ...this.mates];
    this.ball = { x: 0, y: 1, z: HZ - 8.6, mode: 'held', holder: this.you, sim: null };
    this.ballMesh = null;
    if (this.r) {
      const ctx = this.r.ctx;
      let ball = null; // (one painting for both maps)
      const bt = cachedTexture(ctx, 'ballC', () => (ball ||= T.ballTexture()).color, {}), bn = cachedTexture(ctx, 'ballN', () => (ball ||= T.ballTexture()).normal, { srgb: false });
      this.ballMesh = new Mesh(ctx.geometry(G.sphere(BALL_R, 24, 16)), new Material({ map: bt, normalMap: bn, normalScale: 0.8, roughness: 0.6, color: [1, 1, 1] }));
      this.scene.add(this.ballMesh);
      this.ballQ = M.q4();
    }
    this.cam = { pos: [0, 8, -8], tgt: [0, 1, HZ - 4], fov: 40, want: null, cut: true, shot: 'broadcast', shake: 0 };
    this.queue = new PlayQueue({ onStart: p => this.startPlay(p), onEnd: p => this.endPlay(p) });
    this.bornAt = nowMs();
    this.steps = []; this.play = null; this.score = [0, 0];
    this.resetAll();
    if (this.r) { this.pool?.flush?.(); this.r.prewarm?.(this.scene); }
  }
  // ---------- the queue ----------
  // events from the engine: the ones with an animation tag become plays; the rest are text (onText)
  // (qp4: a batch from the possession engine is one possession: its plays run on from one another without a cut while
  // the same side has the ball; the tip-off, the run back and a fast break end where the next play starts)
  enqueue(events, opts = {}) {
    const out = [], evs = events || [];
    const chain = evs.some(e => e && (POSSESSION_TYPES.has(e.type) || e.how));
    for (const e of evs) {
      const p = playFor(e, { opps: this.opps.length, target: opts.target, lead: opts.lead });
      if (!p) continue;
      p.offSide = playOffSide(p);
      if (chain) { const prev = out[out.length - 1] || (this.lastPlay?.chain ? this.lastPlay : null); p.chain = true; p.cont = !!prev && !RESETS.has(p.anim) && (FROM_HERE.has(p.anim) || prev.offSide === p.offSide); }
      this.queue.push(p); out.push(p);
    }
    return out;
  }
  skip() { this.queue.skip(); }
  skipAll() { this.queue.skipAll(); }
  setFast(on) { this.queue.fast = !!on; }
  get busy() { return this.queue.busy; }
  // ---------- a play ----------
  actorOf(who) { return who === 'you' ? this.you : this.opps[who] || this.opps[0]; }
  mateOf(a) { return this.mates.find(m => m.side === a.side); }
  resetAll() {
    for (const a of this.actors) a.place(a.rest.x, a.rest.z);
    this.ball.sim = null; this.ball.mode = 'held'; this.ball.holder = this.you;
  }
  // a step on the play's clock (kept in order: a step can schedule more)
  at(t, fn) { t += this.base || 0; const s = { t, fn }; let i = this.steps.length; while (i > 0 && this.steps[i - 1].t > t) i--; this.steps.splice(i, 0, s); }
  startPlay(play) {
    this.play = play; this.steps = []; this.landed = false; this.playT = 0; this.base = 0;
    let off, def;
    if (play.offWho !== undefined) { off = this.actorOf(play.offWho); def = play.defWho == null ? null : this.actorOf(play.defWho); }
    else {
      off = play.role === 'defense' ? (play.actor === 'you' ? this.opps[play.versus === 'you' ? 0 : play.versus] || this.opps[0] : this.you) : this.actorOf(play.actor);
      def = play.role === 'defense' ? this.actorOf(play.actor) : play.role === 'solo' ? null : this.actorOf(play.versus);
    }
    play.off = off; play.def = def;
    const fn = SCRIPTS[play.anim] || SCRIPTS.celebrate;
    if (play.cont && FROM_HERE.has(play.anim)) fn(this, play, off, def);
    else if (play.cont && off && def) {
      // (qp4: on from the last play: the two men run to where this one starts, then it plays from there)
      const lead = this.leadIn(play);
      play.dur += lead;
      this.at(lead, () => { this.base = this.playT; try { this.setupMen(play, true); fn(this, play, off, def); } finally { this.base = 0; } });
    } else {
      this.setup(play);
      fn(this, play, off, def);
    }
    this.camShot(play.anim === 'tipoff' ? 'center' : play.big ? (play.anim === 'dunk' || play.anim === 'block' ? 'baseline' : 'broadcast') : 'broadcast', !play.cont);
    this.lastPlay = play;
    this.opts.onStart?.(play);
  }
  endPlay(play) {
    // everything the play still had to do happens now (a skip lands the outcome too)
    while (this.steps.length) this.steps.shift().fn();
    this.land(play);
    this.play = null;
    // the ball goes back to the next ball handler; the court settles
    if (this.ball.sim) this.ball.sim = null;
    this.ball.mode = 'held';
  }
  land(play) {
    if (this.landed) return;
    this.landed = true;
    if (play.scoring && play.made) this.score[play.actor === 'you' ? 0 : 1] += play.points;
    this.opts.onLand?.(play, this.score.slice());
  }
  // where a play starts: the man with the ball at his spot facing up, his defender between him and the rim, the
  // others off to the side. A cut, so the jump in place doesn't show
  // the spot a play starts from: how far out the man with the ball is (by the shot it builds to), at a random angle
  spotFor(play) {
    const P = PLAYS[play.shotAnim || play.anim] || PLAYS[play.anim], sh = P.shot;
    const dist = sh === 'three' ? 7.6 : sh === 'mid' ? 5.4 : sh === 'post' ? 3.1 : sh === 'floater' ? 5.2 : sh === 'layup' ? 5.6 : sh === 'dunk' ? 6.8 : play.anim === 'block' || play.anim === 'foul' ? 5.6 : 6.8;
    const ang = this.rng.range(-0.9, 0.9);
    return { x: Math.sin(ang) * dist, z: HZ - Math.cos(ang) * dist, dist, post: sh === 'post' };
  }
  setup(play) {
    const off = play.off, def = play.def, P = PLAYS[play.anim];
    if (SETUPS[play.anim]) { SETUPS[play.anim](this, play, off, def); return; }
    const sp = this.spotFor(play); play.spot = sp;
    const sx = sp.x;
    for (const a of this.actors) if (a !== off && a !== def) {
      const mate = this.mates.includes(a);
      const side = a.side === off?.side ? -Math.sign(sx || 1) : Math.sign(sx || 1);
      a.place(mate ? side * 6.4 : side * 3.2 + this.rng.range(-0.6, 0.6), mate ? HZ - 4.6 : HZ - 3.6 + this.rng.range(-1, 1));
      if (a.side !== off?.side) a.p.stance = 'defense';
    }
    this.setupMen(play, false);
    if (play.role === 'solo' && play.offWho === undefined) { const a = this.actorOf(play.actor); a.place(a.side === 'you' ? -1.2 : 1.2, HZ - 6.5, Math.PI); this.ball.mode = 'dead'; this.ball.holder = null; this.ball.y = BALL_R; this.ball.x = 2.5; this.ball.z = HZ - 4; }
    void P;
  }
  // the man with the ball at the play's spot facing up, his defender between him and the rim (cut: placed there; on
  // from the last play: snapped onto the spot the lead-in ran them to)
  setupMen(play, cont) {
    const off = play.off, def = play.def, P = PLAYS[play.shotAnim || play.anim] || PLAYS[play.anim];
    const sp = play.spot || (play.spot = this.spotFor(play));
    if (!off) return;
    const sx = sp.x, sz = sp.z, dist = hypot2(sx, sz - HZ) || 1;
    off.place(sx, sz, toRim(sx, sz));
    if (!cont || this.ball.holder !== off) this.give(off, P.shot === 'post' || play.role === 'defense' && play.anim === 'rebound' ? 'held' : 'dribble');
    if (def) {
      const ux = (RIM.x - sx) / dist, uz = (RIM.z - sz) / dist, gap = play.anim === 'closeout' ? 3.6 : P.shot === 'post' ? 0.85 : 1.25;
      def.place(sx + ux * gap, sz + uz * gap, Math.atan2(sx - (sx + ux * gap), sz - (sz + uz * gap)));
      def.p.stance = 'defense';
    }
  }
  // (qp4) the run to the next play's spot: drives and setup moves start from wherever the man already is (inside the
  // arc), set shots from their own range; the ball comes to him if a teammate has it. Returns the lead-in's length
  leadIn(play) {
    const off = play.off, def = play.def, P = PLAYS[play.shotAnim || play.anim] || PLAYS[play.anim];
    const here = { x: off.p.x, z: off.p.z }, dr = hypot2(here.x, here.z - HZ);
    const fixed = P.shot === 'three' || P.shot === 'mid' || P.shot === 'post';
    let sp;
    if (!fixed && dr > 1.4 && dr < 8.5) sp = { x: here.x, z: here.z, dist: dr };
    else sp = this.spotFor(play);
    play.spot = sp;
    const d = hypot2(sp.x - here.x, sp.z - here.z), lead = clamp(d / 6.5, 0.25, 0.8);
    off.goTo(sp.x, sp.z, 6.5);
    if (def) { const ux = (RIM.x - sp.x) / (sp.dist || 1), uz = (RIM.z - sp.z) / (sp.dist || 1); def.goTo(sp.x + ux * 1.25, sp.z + uz * 1.25, 6.5); def.p.stance = 'defense'; }
    const h = this.ball.holder;
    if (h && h !== off && h.side === off.side && this.ball.mode !== 'flight') this.passTo(h, off, false, Math.min(0.4, lead));
    else if (!h || h.side !== off.side) { if (this.ball.mode !== 'flight' || !this.ball.sim) this.give(off, 'dribble'); }
    return lead;
  }
  give(a, mode = 'held') { this.ball.holder = a; this.ball.mode = mode; this.ball.sim = null; }
  // ---------- the ball ----------
  // a shot from the shooter's hand: a real flight on a plan that makes it or rims it out
  shoot(a, made, arc = 52, opts = {}) {
    const P = holdPoint(a.p, this.ball);
    const plan = planShot(this.rng, { x: P.x, y: P.y, z: P.z }, RIM, 1, made, arc, { halfOnly: true, surface: 'wood', swish: made && opts.swish, guarantee: made, bank: false });
    const b = new Ball(); b.halfOnly = true; b.surface = 'wood';
    b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, 'shot', null);
    b.wx = plan.wx || 0; b.wy = plan.wy || 0; b.wz = plan.wz || 0;
    if (plan.ghost) b.ghost = true;
    this.ball.sim = b; this.ball.arc = null; this.ball.mode = 'flight'; this.ball.holder = null;
    this.ball.x = P.x; this.ball.y = P.y; this.ball.z = P.z;
    return b;
  }
  // a pass (or a lob) from one man to another: a straight arc through the air, caught at the end
  passTo(from, to, lob = false, dur = 0.45) {
    const P = holdPoint(from.p, this.ball), Q = { x: to.p.x + Math.sin(to.p.facing) * 0.3, y: lob ? 2.8 : 1.25, z: to.p.z + Math.cos(to.p.facing) * 0.3 };
    this.ball.mode = 'flight'; this.ball.holder = null; this.ball.sim = null;
    this.ball.arc = { P, Q, t: 0, dur: lob ? dur * 1.6 : dur, h: lob ? 1.6 : 0.25, to };
  }
  stepBall(dt) {
    const b = this.ball;
    if (b.holder && b.mode !== 'flight') { const w = holdPoint(b.holder.p, b); b.x = w.x; b.y = w.y; b.z = w.z; return; }
    if (b.arc) {
      const A = b.arc; A.t += dt; const k = Math.min(1, A.t / A.dur);
      b.x = lerp(A.P.x, A.Q.x, k); b.z = lerp(A.P.z, A.Q.z, k); b.y = lerp(A.P.y, A.Q.y, k) + 4 * A.h * k * (1 - k);
      if (k >= 1) { b.arc = null; if (A.to) { this.give(A.to, 'held'); if (A.to.p && !A.to.p.action) A.to.act('catch', 0.25); } else { b.mode = 'dead'; } }
      return;
    }
    if (b.sim) {
      const evs = [];
      b.sim.step(dt, evs);
      b.x = b.sim.x; b.y = b.sim.y; b.z = b.sim.z;
      for (const e of evs) {
        if (e.type === 'rim') { this.hoops[0]?.hit?.(Math.min(1.5, e.v || 1) * 0.6); audio.rim?.(Math.min(1, e.v || 1)); }
        else if (e.type === 'board') audio.board?.(Math.min(1, e.v || 1));
        else if (e.type === 'through') { audio.swish?.(!!e.clean); if (this.play) this.land(this.play); audio.cheer?.(0.6); }
        else if (e.type === 'bounce') audio.bounce?.(Math.min(1, e.v || 1));
      }
      return;
    }
    if (b.mode === 'dead') { b.y = Math.max(BALL_R, b.y); }
  }
  // ---------- the camera ----------
  // broadcast: up in the stands on the sideline, following the ball; baseline: behind the basket, looking out at the
  // play (the dunks, the blocks); low: down by the shooter's shoulder (a three in the air); tight: on one man
  camShot(kind, cut = false) { this.cam.shot = kind; if (cut) this.cam.cut = true; }
  updateCamera(dt) {
    const C = this.cam, b = this.ball, [ox, , oz] = this.origin;
    const fx = clamp(b.x, -6, 6), fz = clamp(b.z, HZ - 10, HZ + 0.5);
    let pos, tgt, fov;
    if (C.shot === 'center') { const bz = clamp(b.z, -4, HZ); pos = [-14.5, 6.6, bz - 2.2]; tgt = [b.x * 0.4, 1.4, bz + 0.4]; fov = 44; } // (qp4: the tip-off, at centre court)
    else if (C.shot === 'baseline') { pos = [fx * 0.35 + 4.1, 3.2, HZ + 2.3]; tgt = [fx * 0.6, 1.7, HZ - 5]; fov = 54; } // (inside the baseline: a park's fence is just behind it; wide of the board, so a play at the rim isn't behind it)
    else if (C.shot === 'low') { pos = [fx - 2.6, 1.9, fz - 3.6]; tgt = [RIM.x, 2.6, RIM.z]; fov = 50; }
    else if (C.shot === 'tight') { const a = this.play?.off || this.play?.def || this.you; pos = [a.p.x - 3.6, 2.4, a.p.z - 3.4]; tgt = [a.p.x, 1.3, a.p.z]; fov = 38; }
    else { const mz = fz * 0.45 + (HZ - 1.5) * 0.55; pos = [-15.5, 7.4, mz - 2.6]; tgt = [fx * 0.4, 1.2, mz + 0.6]; fov = 42; }
    // (the court has the top of the screen: aim a little under the play so it sits up there, over the cards)
    const d = hypot3(pos[0] - tgt[0], pos[1] - tgt[1], pos[2] - tgt[2]);
    tgt[1] -= d * Math.tan((fov * M.DEG) / 2) * (1 - this.frameTop) * 0.9;
    pos = [pos[0] + ox, pos[1], pos[2] + oz]; tgt = [tgt[0] + ox, tgt[1], tgt[2] + oz];
    if (C.cut) { C.pos = pos; C.tgt = tgt; C.fov = fov; C.cut = false; }
    else { const k = 1 - Math.exp(-dt * 3.2); for (let i = 0; i < 3; i++) { C.pos[i] = lerp(C.pos[i], pos[i], k); C.tgt[i] = lerp(C.tgt[i], tgt[i], k * 1.3); } C.fov = lerp(C.fov, fov, k); }
    let sx = 0, sy = 0;
    if (C.shake > 0) { C.shake = Math.max(0, C.shake - dt); sx = (Math.random() - 0.5) * C.shake * 0.5; sy = (Math.random() - 0.5) * C.shake * 0.5; }
    const cam = this.app?.camera;
    if (cam) { cam.pos.set([C.pos[0] + sx, C.pos[1] + sy, C.pos[2]]); cam.target.set([C.tgt[0], C.tgt[1], C.tgt[2]]); cam.fov = C.fov * M.DEG; }
  }
  // ---------- the frame ----------
  frame(dt) {
    this.opts.onFrame?.(dt);
    if (this.disposed) return;
    this.lastFrameAt = nowMs();
    const play = this.queue.update(dt);
    const sp = this.queue.speed(), d = dt * (play ? sp : 1);
    if (play) {
      this.playT += d;
      while (this.steps.length && this.steps[0].t <= this.playT) this.steps.shift().fn();
    }
    for (const a of this.actors) a.update(d);
    this.stepBall(d);
    for (const h of this.hoops) h.update?.(d, { x: this.ball.x + this.origin[0], y: this.ball.y, z: this.ball.z + this.origin[2] });
    try { this.venue?.update?.(dt, {}); } catch { /* (a park's own life: not needed here) */ }
    for (const a of this.actors) a.render(d);
    if (this.ballMesh) {
      const b = this.ball, [ox, , oz] = this.origin;
      if (b.sim) { const w = b.sim; M.qmul?.(this.ballQ, this.ballQ, M.qaxis(M.q4(), 1, 0, 0, -d * 9)); void w; }
      M.m4compose(this.ballMesh.matrix, [b.x + ox, b.y, b.z + oz], this.ballQ, [1, 1, 1]);
    }
    this.updateCamera(dt);
  }
  // qp7 §2, the watchdog (the Gauntlet screen asks every second, on a timer of its own, so it works when frames don't):
  // why the court is stuck, or null. 'disposed': plays are waiting on a court that will never play again (QP3: a
  // disposed court's frame() returns at once); 'no frames': the app's loop has stopped calling frame() (another
  // controller, or frame() throwing every time) for more than the margin while the page is visible; 'overrun': the play
  // on now has run past its length + margin. visible false (the window hidden: no frames by design) pushes the clocks on.
  watchdog(visible = true, margin = 4000, now = nowMs()) {
    const q = this.queue;
    if (!q.busy) { this.wdAt = now; return null; }
    if (this.disposed) return 'disposed';
    if (!visible) { const gap = now - (this.wdAt ?? now); q.wall += gap; if (this.lastFrameAt) this.lastFrameAt += gap; this.wdAt = now; return null; }
    this.wdAt = now;
    if (this.lastFrameAt != null && now - this.lastFrameAt > margin) return 'no frames';
    if (q.cur && q.stuck(margin, now)) return 'overrun';
    if (!q.cur && this.lastFrameAt == null && now - (this.bornAt ?? now) > margin) return 'no frames';
    return null;
  }
  // what the app's loop calls (app.setController): a menu screen with this court under it
  deactivate() { this.dispose(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const a of this.actors) a.dispose();
    // (QP3: the court's venue and ball, in a scene of its own (none passed in), are freed with it: world/release.js)
    if (!this.opts.scene) releaseScene(this.r?.ctx, this.scene);
  }
}

// ---------------- the plays ----------------
// each one schedules its steps on the play's clock (dc.at(t, fn)); an offense play's man starts with the ball at his
// spot (setup), his defender in front. Times are at normal speed; the queue speeds them up as a whole.
const ACT = {
  // a jumper: up off the floor, the ball set and let go at tRel, a real flight. kind: 'jumper' | 'close' (hook)
  jumper(dc, a, at, made, o = {}) {
    dc.at(at, () => {
      const tRel = o.tRel ?? 0.52, h = o.h ?? 0.5, tUp = Math.sqrt(2 * h / G0), takeoff = Math.max(0.1, tRel - tUp * 0.9);
      dc.ball.mode = 'held';
      a.face = toRim(a.p.x, a.p.z); a.target = null;
      a.act('shoot', tRel + 0.6, { tRel, takeoff, jumpH: h, kind: o.kind || 'jumper', dRim: hypot2(a.p.x, a.p.z - HZ), fade: !!o.fade, stepback: !!o.fade, post: o.post || null, hookShape: o.post ? 'jump' : undefined, startX: a.p.x, startZ: a.p.z, moving: 0, hustle: null });
      a.hop(h, takeoff);
      dc.at(dc.playT + tRel, () => { if (dc.play?.cancel) return; a.p.action && (a.p.action.released = true); dc.shoot(a, made, o.arc ?? 52, { swish: o.swish }); });
    });
  },
  // a drive to the rim and a layup (style: basic | floater | finger | euro | spin | reverse | hop)
  layup(dc, a, at, made, lstyle = 'basic', from = 5.2) {
    const sx = a.p.x, sz = a.p.z, ang = Math.atan2(sx, sz - HZ), dl = hypot2(sx, sz - HZ);
    const gx = Math.sin(ang) * Math.min(dl, from > 3 ? 1.6 : 2.6), gz = HZ + Math.cos(ang) * Math.min(dl, from > 3 ? 1.6 : 2.6);
    dc.at(at, () => { dc.ball.mode = 'dribble'; a.goTo(gx, gz, 7); });
    const tArrive = at + hypot2(gx - sx, gz - sz) / 7;
    dc.at(tArrive, () => {
      const takeoff = 0.16, release = lstyle === 'floater' ? 0.36 : 0.48;
      dc.ball.mode = 'held'; a.target = null; a.face = toRim(gx, gz);
      a.act('layup', release + 0.4, { takeoff, release, tRel: release, lstyle, cov: 'open', covSide: 1, lsDir: 1, jumpH: 0.62, spotX: gx, spotZ: gz, gatherSpeed: 4, side: 1 });
      a.hop(0.62, takeoff);
      dc.at(dc.playT + release, () => { if (dc.play?.cancel) return; a.p.action && (a.p.action.released = true); dc.shoot(a, made, lstyle === 'floater' ? 62 : 58); });
    });
    return tArrive;
  },
  // a drive and a dunk: the ball on the dunk's own path, slammed through at `slam`
  dunk(dc, a, at, made, style = 'power') {
    const sx = a.p.x, sz = a.p.z, ang = Math.atan2(sx, sz - HZ);
    const gx = Math.sin(ang) * 1.7, gz = HZ + Math.cos(ang) * 1.7;
    dc.at(at, () => { dc.ball.mode = 'dribble'; a.goTo(gx, gz, 7.4); });
    const tArrive = at + hypot2(gx - sx, gz - sz) / 7.4;
    dc.at(tArrive, () => {
      const takeoff = 0.18, tUp = 0.42, slam = takeoff + tUp + 0.05;
      dc.ball.mode = 'held'; a.face = toRim(gx, gz);
      a.goTo(gx * 0.45, HZ + (gz - HZ) * 0.45, 3.2);
      a.act('dunk', slam + 0.9, { takeoff, slam, tUp, jumped: false, style, side: 1, spotX: gx, spotZ: gz, gatherSpeed: 5 });
      a.hop(Math.max(0.75, a.p.phys.vertical * 0.95), takeoff);
      dc.at(dc.playT + slam, () => {
        if (a.p.action) a.p.action.slammed = true;
        if (made) { const b = new Ball(); b.halfOnly = true; b.setFlight(RIM.x, RIM.y + 0.12, RIM.z, 0, -2.5, 0, 'shot', null); b.ghost = true; dc.ball.sim = b; dc.ball.mode = 'flight'; dc.ball.holder = null; dc.hoops[0]?.hit?.(1.4); dc.cam.shake = 0.35; audio.rim?.(0.9); dc.land(dc.play); }
        else { const b = new Ball(); b.halfOnly = true; b.setFlight(RIM.x, RIM.y + 0.3, RIM.z - 0.15, 0.6, 3.2, -2.6, 'shot', null); dc.ball.sim = b; dc.ball.mode = 'flight'; dc.ball.holder = null; dc.hoops[0]?.hit?.(1.2); audio.rim?.(1); }
      });
    });
    return tArrive;
  },
  move(dc, a, at, move, dur = 0.55) {
    dc.at(at, () => {
      dc.ball.mode = 'dribble';
      const f = a.p.facing, lx = Math.cos(f), lz = -Math.sin(f), side = a.p.dribble.hand === 'R' ? 1 : -1;
      const act = a.act('move', dur, { move, vx: 0, vz: 0, f0: f, dir: side, face: toRim(a.p.x, a.p.z), handFrom: a.p.dribble.hand, switched: false, checked: false, lvl: 0, snap: 1, sty: 'basic' });
      if (move === 'spin') act.dir = side > 0 ? -1 : 1;
      if (move === 'stepback') { const bx = -Math.sin(toRim(a.p.x, a.p.z)) * 1.4, bz = -Math.cos(toRim(a.p.x, a.p.z)) * 1.4; a.goTo(a.p.x + bx, a.p.z + bz, 4.2); }
      else a.goTo(a.p.x + lx * side * 1.1 + Math.sin(f) * 0.9, a.p.z + lz * side * 1.1 + Math.cos(f) * 0.9, 4.6);
      dc.at(dc.playT + dur * 0.5, () => { a.p.dribble.hand = a.p.dribble.hand === 'R' ? 'L' : 'R'; });
    });
  },
  // the defender beaten by a move: his feet go (an ankle-breaker's stumble), or he just bites
  bite(dc, d, at, hard = false) { dc.at(at, () => { if (!d) return; d.act('stumble', hard ? 0.9 : 0.55, { fall: false, back: true, dir: dc.rng.next() < 0.5 ? 1 : -1, react: hard ? 'stagger' : undefined }); d.goTo(d.p.x - Math.sin(d.p.facing) * 0.6, d.p.z - Math.cos(d.p.facing) * 0.6, 2); }); },
  contest(dc, d, at, off, jump = 0.35) { dc.at(at, () => { if (!d) return; d.face = Math.atan2(off.p.x - d.p.x, off.p.z - d.p.z); const dd = hypot2(off.p.x - d.p.x, off.p.z - d.p.z), k = dd > 1.05 ? Math.min(0.6, (dd - 0.95) / dd) : 0; d.goTo(lerp(d.p.x, off.p.x, k), lerp(d.p.z, off.p.z, k), 5.5); d.p.contestHand = 'R'; if (jump) { d.act('block', 0.8, { jumpAt: 0.05, jumpH: jump, jumped: true, air: 0.5 }); d.hop(jump, 0.05); } }); },
  celebrate(dc, a, at, kind = 'flex', dur = 1.3) { dc.at(at, () => { a.target = null; a.act('celebrate', dur, { kind }); }); },
};

const SCRIPTS = {
  jumper(dc, pl, o, d) { ACT.jumper(dc, o, 0.08, pl.made, { tRel: 0.42, arc: 50 }); ACT.contest(dc, d, 0.22, o, pl.made ? 0 : 0.3); if (pl.made) ACT.celebrate(dc, o, 1.75, 'point', 0.25); },
  three(dc, pl, o, d) {
    ACT.jumper(dc, o, 0.08, pl.made, { arc: 48, swish: pl.made, h: 0.48, tRel: 0.45 });
    ACT.contest(dc, d, 0.25, o, pl.made ? 0 : 0.32);
    dc.at(0.8, () => dc.camShot(pl.made ? 'baseline' : 'broadcast', pl.made));
    if (pl.made) ACT.celebrate(dc, o, 2.0, 'flex', 0.3);
  },
  layup(dc, pl, o, d) { const t = ACT.layup(dc, o, 0.1, pl.made, 'basic'); dc.at(0.3, () => d && d.goTo(lerp(d.p.x, 0, 0.5), HZ - 1.6, 5.2)); ACT.contest(dc, d, t + 0.1, o, pl.made ? 0 : 0.55); },
  floater(dc, pl, o, d) { const t = ACT.layup(dc, o, 0.08, pl.made, 'floater', 2.6); ACT.contest(dc, d, t, o, 0.4); },
  dunk(dc, pl, o, d) { const t = ACT.dunk(dc, o, 0.15, pl.made, pl.made ? (dc.rng.next() < 0.5 ? 'tomahawk' : 'power') : 'power'); dc.at(t + 0.1, () => dc.camShot('baseline', true)); if (d) dc.at(0.35, () => d.goTo(lerp(d.p.x, 0, 0.6), HZ - 1.3, 5.6)); if (pl.made) { ACT.bite(dc, d, t + 0.75, true); ACT.celebrate(dc, o, t + 1.3, 'roar', 0.6); } },
  post(dc, pl, o, d) {
    dc.at(0.08, () => { o.face = Math.atan2(o.p.x, o.p.z - HZ) + Math.PI; o.act('post', 0.55, { move: 'drop', side: 1, beat: 0.4, dirX: 0, dirZ: 1, step: 0.5, f0: o.p.facing, faceRim: toRim(o.p.x, o.p.z), body: 1, emph: 1, fakeAt: 0 }); o.goTo(o.p.x * 0.6, lerp(o.p.z, HZ - 1.4, 0.5), 2.4); });
    ACT.jumper(dc, o, 0.62, pl.made, { kind: 'close', post: 'hook', h: 0.36, tRel: 0.42, arc: 56 });
    ACT.contest(dc, d, 0.7, o, 0.4);
  },
  crossover(dc, pl, o, d) { ACT.move(dc, o, 0.2, 'cross', 0.5); ACT.move(dc, o, 0.72, 'cross', 0.45); ACT.bite(dc, d, 0.7, false); dc.at(0.3, () => dc.camShot('tight')); },
  spin(dc, pl, o, d) { ACT.move(dc, o, 0.2, 'spin', 0.62); ACT.bite(dc, d, 0.55, false); dc.at(0.3, () => dc.camShot('tight')); },
  stepback(dc, pl, o, d) { ACT.move(dc, o, 0.08, 'stepback', 0.48); ACT.bite(dc, d, 0.3, pl.made); if (pl.scoring) { ACT.jumper(dc, o, 0.56, pl.made, { fade: true, h: 0.46, tRel: 0.4, arc: 48 }); ACT.contest(dc, d, 0.66, o, 0); } },
  pass(dc, pl, o, d) {
    const mate = dc.mates.find(m => m.side === o.side);
    dc.at(0.2, () => { mate.face = Math.atan2(o.p.x - mate.p.x, o.p.z - mate.p.z); o.face = Math.atan2(mate.p.x - o.p.x, mate.p.z - o.p.z); dc.ball.mode = 'held'; o.act('pass', 0.42, { ptype: 'chest', rel: 0.18, to: mate.id }); });
    dc.at(0.38, () => dc.passTo(o, mate, false, 0.42));
    dc.at(0.95, () => { o.goTo(lerp(o.p.x, 0, 0.5), HZ - 4, 5); });
    dc.at(1.0, () => { mate.face = Math.atan2(o.p.x - mate.p.x, o.p.z - mate.p.z); mate.act('pass', 0.36, { ptype: 'chest', rel: 0.14, to: o.id }); });
    dc.at(1.12, () => dc.passTo(mate, o, false, 0.4));
  },
  lob(dc, pl, o, d) {
    const mate = dc.mates.find(m => m.side === o.side);
    dc.at(0.1, () => { mate.goTo(Math.sign(mate.p.x || 1) * 1.6, HZ - 1.5, 7.5); o.face = Math.atan2(mate.p.x - o.p.x, mate.p.z - o.p.z); });
    dc.at(0.3, () => { dc.ball.mode = 'held'; o.act('pass', 0.5, { ptype: 'lob', rel: 0.2, to: mate.id }); });
    dc.at(0.5, () => dc.passTo(o, mate, true, 0.36));
    dc.at(0.62, () => { mate.face = toRim(mate.p.x, mate.p.z); mate.hop(0.85, 0.12); mate.act('dunk', 1.1, { takeoff: 0.1, slam: 0.62, tUp: 0.42, jumped: true, style: 'onehand', side: 1, spotX: mate.p.x, spotZ: mate.p.z, gatherSpeed: 4 }); });
    dc.at(1.2, () => { dc.camShot('baseline', true); dc.ball.arc = null; const b = new Ball(); b.halfOnly = true; b.setFlight(RIM.x, RIM.y + 0.12, RIM.z, 0, -2.5, 0, 'shot', null); b.ghost = true; dc.ball.sim = b; dc.ball.mode = 'flight'; dc.ball.holder = null; dc.hoops[0]?.hit?.(1.3); dc.cam.shake = 0.3; audio.rim?.(0.9); });
  },
  closeout(dc, pl, o, d) { dc.at(0.15, () => { d.goTo(lerp(d.p.x, o.p.x, 0.78), lerp(d.p.z, o.p.z, 0.78), 6.8); d.face = Math.atan2(o.p.x - d.p.x, o.p.z - d.p.z); }); dc.at(0.55, () => { d.p.contestHand = 'L'; d.p.handsUp = true; }); dc.at(0.7, () => { dc.ball.mode = 'held'; o.act('pumpfake', 0.42, {}); }); },
  contest(dc, pl, o, d) { ACT.jumper(dc, o, 0.1, false, { tRel: 0.45 }); ACT.contest(dc, d, 0.2, o, 0.45); },
  block(dc, pl, o, d) {
    const t = ACT.layup(dc, o, 0.15, false, 'basic');
    dc.at(0.25, () => d.goTo(lerp(d.p.x, 0, 0.6), HZ - 1.4, 6.5));
    dc.at(t + 0.08, () => { d.face = Math.atan2(o.p.x - d.p.x, o.p.z - d.p.z); d.act('block', 0.9, { jumpAt: 0.04, jumpH: 0.75, jumped: true, air: 0.6, hit: true }); d.hop(Math.max(0.7, d.p.phys.vertical * 0.9), 0.04); });
    dc.at(t + 0.44, () => { pl.cancel = true; const b = new Ball(); b.halfOnly = true; const B = dc.ball; b.setFlight(B.x, B.y, B.z, (o.p.x - d.p.x) * 2 + 2.5, 1.5, -5.5, 'loose', null); B.sim = b; B.mode = 'flight'; B.holder = null; audio.ooh?.(1); audio.cheer?.(1); dc.cam.shake = 0.25; });
    ACT.celebrate(dc, d, t + 1.2, 'wag', 0.5);
  },
  steal(dc, pl, o, d) {
    dc.at(0.15, () => { dc.ball.mode = 'dribble'; o.goTo(o.p.x + Math.cos(o.p.facing) * 1.4, o.p.z - Math.sin(o.p.facing) * 1.4 + 0.6, 3.6); });
    dc.at(0.45, () => { d.face = Math.atan2(o.p.x - d.p.x, o.p.z - d.p.z); d.act('steal', 0.46, { checked: false, hand: 'R', low: true, aimed: true }); d.goTo(lerp(d.p.x, o.p.x, 0.6), lerp(d.p.z, o.p.z, 0.6), 4.5); });
    dc.at(0.68, () => { dc.give(d, 'dribble'); audio.cheer?.(0.6); dc.camShot('tight', true); ACT.bite(dc, o, dc.playT, false); });
    dc.at(0.95, () => d.goTo(d.p.x - Math.sin(d.p.facing) * -2.5, d.p.z - 3, 6.5));
  },
  rebound(dc, pl, o, d) {
    ACT.jumper(dc, o, 0.08, false, { tRel: 0.42 });
    dc.at(0.4, () => { d.goTo(0.6, HZ - 2.2, 5); d.face = toRim(0.6, HZ - 2.2); });
    dc.at(1.45, () => { d.face = toRim(d.p.x, d.p.z); d.act('rebound', 0.8, { jumpAt: 0.05, jumpH: 0.6, jumped: true, air: 0.55 }); d.hop(0.6, 0.05); });
    dc.at(1.7, () => { dc.give(d, 'held'); });
  },
  foul(dc, pl, o, d) {
    // the actor is the one fouling: he reaches through the man driving at him; a whistle
    const t = ACT.layup(dc, o, 0.15, false, 'basic');
    dc.at(0.3, () => d.goTo(lerp(d.p.x, 0, 0.6), HZ - 1.6, 6));
    dc.at(t + 0.05, () => { d.act('steal', 0.46, { checked: false, hand: 'L', low: false, aimed: true }); o.act('stumble', 0.7, { fall: false, back: true, dir: 1 }); audio.whistle?.(); pl.cancel = true; dc.give(o, 'held'); });
  },
  celebrate(dc, pl) { const a = dc.actorOf(pl.actor); ACT.celebrate(dc, a, 0.1, dc.rng.next() < 0.5 ? 'flex' : 'roar', 1.2); dc.at(0.1, () => dc.camShot('tight', true)); },
  gassed(dc, pl) {
    const a = dc.actorOf(pl.actor);
    dc.at(0.05, () => { a.p.stamina = 0.05; a.act('bump', 0.45, {}); dc.camShot('tight', true); });
    dc.at(1.15, () => { a.p.stamina = 1; });
  },
};
// ---------------- qp4: the possession plays ----------------
// the floor each sets up for itself (a cut): the jump ball at centre court (the top of the key on a half court), the
// new offense bringing it up from the back, a fast break with the defense behind the play, the free-throw line
const SETUPS = {
  tipoff(dc) {
    const cz = dc.full ? 0 : HZ - 7.6;
    dc.you.place(-0.55, cz, Math.PI / 2); dc.opps[0].place(0.55, cz, -Math.PI / 2);
    dc.mates[0].place(-2.7, cz + 2.4); dc.mates[1].place(2.7, cz + 2.4);
    dc.opps.slice(1).forEach((o, i) => o.place(i % 2 ? 2.7 : -2.7, cz - 2.4));
    dc.ball.holder = null; dc.ball.mode = 'dead'; dc.ball.sim = null; dc.ball.arc = null; dc.ball.x = 0; dc.ball.y = 1.35; dc.ball.z = cz;
  },
  transition(dc, pl, off, def) {
    const x = dc.rng.range(-2, 2);
    off.place(x, HZ - 14.5, 0); dc.give(off, 'dribble');
    if (def) { def.place(x * 0.5, HZ - 10.5, Math.PI); def.p.stance = 'defense'; }
    for (const a of dc.actors) if (a !== off && a !== def) {
      const same = a.side === off.side, sx = (dc.mates.includes(a) ? 1 : 0.6) * (a.p.x >= 0 ? 1 : -1) || 1;
      a.place(same ? sx * 5.2 : sx * 3, same ? HZ - 13 : HZ - 7.5);
    }
  },
  fastbreak(dc, pl, off, def) {
    const x = dc.rng.range(-1.5, 1.5);
    off.place(x, HZ - 12, 0); dc.give(off, 'dribble');
    if (def) def.place(x + 1.4, HZ - 14.6, 0);
    for (const a of dc.actors) if (a !== off && a !== def) a.place((a.p.x >= 0 ? 1 : -1) * 3.5, HZ - 16 + dc.rng.range(-0.8, 0.8), 0);
  },
  freethrow(dc, pl, off) {
    const ftz = COURT.boardZ - COURT.ftDist, lane = [[-2.15, HZ - 1.3], [2.15, HZ - 1.3], [-2.15, HZ - 2.7], [2.15, HZ - 2.7], [-2.15, HZ - 4.1]];
    off.place(0, ftz, 0); dc.give(off, 'dribble');
    let k = 0;
    for (const a of dc.actors) if (a !== off) { const [x, z] = lane[k++ % lane.length]; a.place(x, z, x < 0 ? Math.PI / 2 : -Math.PI / 2); }
  },
};
const DRIVES = new Set(['layup', 'dunk', 'floater']);
const faceTo = (a, b) => { if (a && b) a.face = Math.atan2(b.p.x - a.p.x, b.p.z - a.p.z); };
// a play's script from `t` on (dc.base: the clock its steps are scheduled on)
function playAt(dc, t, fn, ...args) { dc.base = (dc.base || 0) + t; try { fn(dc, ...args); } finally { dc.base -= t; } }
Object.assign(SCRIPTS, {
  // the jump ball: the ball tossed up between the two, both go up (the winner a beat sooner and higher), tipped back to
  // the winner's teammate, who gives it to him; he brings it up and the other one picks him up
  tipoff(dc, pl) {
    const A = dc.you, B = dc.opps[0], win = pl.winner === 'them' ? B : A, lose = win === A ? B : A, recv = dc.mateOf(win), cz = A.p.z;
    dc.at(0.2, () => { const b = dc.ball; b.holder = null; b.mode = 'flight'; b.sim = null; b.arc = { P: { x: 0, y: 1.35, z: cz }, Q: { x: 0, y: 3.15, z: cz }, t: 0, dur: 0.55, h: 0.45, to: null }; });
    dc.at(0.42, () => { win.act('tipjump', 1.0); win.hop(0.72, 0); });
    dc.at(0.47, () => { lose.act('tipjump', 1.0); lose.hop(0.62, 0); });
    dc.at(0.76, () => { const b = dc.ball; b.arc = { P: { x: b.x, y: b.y, z: b.z }, Q: { x: recv.p.x, y: 1.3, z: recv.p.z }, t: 0, dur: 0.5, h: 0.35, to: recv }; b.mode = 'flight'; audio.bounce?.(0.4); faceTo(recv, win); });
    dc.at(1.45, () => { faceTo(recv, win); recv.act('pass', 0.36, { ptype: 'chest', rel: 0.14, to: win.id }); });
    dc.at(1.6, () => dc.passTo(recv, win, false, 0.38));
    dc.at(2.05, () => { dc.camShot('broadcast'); win.face = null; if (dc.ball.holder === win) dc.ball.mode = 'dribble'; win.goTo(0.4, HZ - 8, 5.5); recv.goTo(win === A ? -6.2 : 6.2, HZ - 5.5, 5); lose.goTo(0.2, HZ - 6.6, 5); lose.p.stance = 'defense'; });
  },
  // a change of possession: the new offense brings it up the floor, the defense gets back and picks him up
  transition(dc, pl, o, d) {
    dc.at(0.05, () => o.goTo(o.p.x * 0.4, HZ - 8, 5.6));
    dc.at(0.1, () => { if (!d) return; d.goTo(o.p.x * 0.3, HZ - 6.8, 4.4); d.p.stance = 'defense'; d.face = Math.PI; });
    dc.at(0.15, () => { for (const a of dc.actors) if (a !== o && a !== d) { const same = a.side === o.side, sx = a.p.x >= 0 ? 1 : -1; a.goTo(same ? sx * 6.2 : sx * 3.2, same ? HZ - 5.2 : HZ - 3.6, same ? 5 : 4.5); if (!same) a.p.stance = 'defense'; } });
    dc.at(1.15, () => { if (d) faceTo(d, o); });
  },
  // after a steal: he's gone, the defense chasing from behind; he gets to the rim (the fast break's shot plays next)
  fastbreak(dc, pl, o, d) {
    const side = o.p.x >= 0 ? 1 : -1;
    dc.at(0.02, () => { dc.ball.mode = 'dribble'; o.goTo(side * 1.2, HZ - 2.6, 7.6); });
    dc.at(0.1, () => d && d.goTo(side * 0.5, HZ - 3.6, 7.0));
    dc.at(0.15, () => { for (const a of dc.actors) if (a !== o && a !== d) a.goTo(a.p.x * 0.6, HZ - 8.5, 5.2); });
    dc.at(0.95, () => dc.camShot('baseline', true));
  },
  // a pass to the open man, and his shot from the catch (the shot's own play): the receiver scores, the passer assists
  assist(dc, pl, o, d) {
    let passer = dc.actorOf(pl.assistWho ?? pl.offWho);
    if (passer === o) passer = dc.mateOf(o);
    dc.give(passer, 'held'); faceTo(passer, o); faceTo(o, passer);
    dc.at(0.15, () => passer.act('pass', 0.42, { ptype: 'chest', rel: 0.18, to: o.id }));
    dc.at(0.33, () => dc.passTo(passer, o, false, 0.4));
    dc.at(0.8, () => { o.face = toRim(o.p.x, o.p.z); });
    playAt(dc, 0.85, SCRIPTS[pl.shotAnim] || SCRIPTS.jumper, pl, o, d);
  },
  // a make through contact: hit on the way up, the whistle, and it goes in anyway
  andone(dc, pl, o, d) {
    (SCRIPTS[pl.shotAnim] || SCRIPTS.jumper)(dc, pl, o, d);
    dc.at(DRIVES.has(pl.shotAnim) ? 0.75 : 0.35, () => { if (!d) return; faceTo(d, o); d.act('steal', 0.46, { checked: false, hand: 'L', low: false, aimed: true }); audio.whistle?.(); });
    ACT.celebrate(dc, o, 2.35, 'flex', 0.5);
  },
  // off the rim: he gets there first, goes up and takes it; an offensive board is kicked back out, a defensive one goes
  // the other way (the possession that follows plays next)
  board(dc, pl, o, d) {
    const side = dc.rng.next() < 0.5 ? 1 : -1, bx = side * 0.9, bz = HZ - 1.9;
    dc.at(0.05, () => {
      const b = new Ball(); b.halfOnly = true; b.setFlight(RIM.x + side * 0.15, RIM.y + 0.1, RIM.z - 0.12, side * 0.9, 2.6, -1.6, 'loose', null);
      dc.ball.sim = b; dc.ball.arc = null; dc.ball.mode = 'flight'; dc.ball.holder = null; dc.hoops[0]?.hit?.(0.6);
      o.goTo(bx, bz, 6); if (d) d.goTo(bx * 0.4, bz + 0.5, 5.5);
    });
    dc.at(0.55, () => { o.face = toRim(o.p.x, o.p.z); o.act('rebound', 0.8, { jumpAt: 0.05, jumpH: 0.6, jumped: true, air: 0.55 }); o.hop(0.6, 0.05); if (d) { d.act('rebound', 0.8, { jumpAt: 0.05, jumpH: 0.45, jumped: true, air: 0.5 }); d.hop(0.45, 0.08); } });
    dc.at(0.85, () => dc.give(o, 'held'));
    dc.at(1.2, () => { o.face = null; dc.ball.mode = 'dribble'; if (pl.offensive) o.goTo(bx * 2.5, HZ - 5.5, 4.5); else o.goTo(bx * 2, HZ - 9, 6); });
  },
  // at the line: a couple of bounces, the shot (made: it scores the event's points)
  freethrow(dc, pl, o) {
    dc.at(0.2, () => dc.camShot('low', true));
    dc.at(0.45, () => { o.face = toRim(o.p.x, o.p.z); dc.ball.mode = 'held'; o.act('ftshot', 1.4, { tRel: 0.62, t0: 0 }); });
    dc.at(1.07, () => { if (o.p.action) o.p.action.released = true; dc.shoot(o, pl.made, 52, { swish: pl.made }); });
  },
  // the defensive cards, played against the man with the ball
  guard(dc, pl, o, d) {
    dc.at(0.1, () => { if (!d) return; d.goTo(lerp(d.p.x, o.p.x, 0.35), lerp(d.p.z, o.p.z, 0.35), 4); d.p.stance = 'defense'; d.p.handsUp = true; d.p.contestHand = 'R'; faceTo(d, o); });
    dc.at(0.35, () => { dc.ball.mode = 'held'; o.act('pumpfake', 0.42, {}); });
    dc.at(0.85, () => { if (d) { d.p.handsUp = false; d.p.contestHand = null; } dc.ball.mode = 'dribble'; });
  },
  protect(dc, pl, o, d) {
    dc.at(0.1, () => { if (!d) return; d.goTo(lerp(d.p.x, 0, 0.6), HZ - 1.8, 5); d.p.stance = 'defense'; });
    dc.at(0.7, () => { if (!d) return; faceTo(d, o); d.p.handsUp = true; });
  },
  swipe(dc, pl, o, d) {
    dc.at(0.15, () => { dc.ball.mode = 'dribble'; if (!d) return; faceTo(d, o); d.act('steal', 0.46, { checked: false, hand: 'R', low: true, aimed: true }); d.goTo(lerp(d.p.x, o.p.x, 0.4), lerp(d.p.z, o.p.z, 0.4), 4); });
    ACT.move(dc, o, 0.3, 'cross', 0.5);
  },
  boxout(dc, pl, o, d) {
    dc.at(0.1, () => { if (!d) return; d.goTo(lerp(d.p.x, 0, 0.5), HZ - 2.4, 4.5); d.p.stance = 'defense'; });
    dc.at(0.7, () => d && faceTo(d, o));
  },
  sizeup(dc, pl, o, d) { ACT.move(dc, o, 0.15, 'cross', 0.5); ACT.bite(dc, d, 0.5, false); },
  // the drive into a man who's planted: the contact, he goes down, the whistle, the ball the other way
  charge(dc, pl, o, d) {
    const t = ACT.layup(dc, o, 0.15, false, 'basic');
    dc.at(0.25, () => { if (!d) return; d.goTo(lerp(d.p.x, o.p.x, 0.35), lerp(d.p.z, HZ - 2.4, 0.6), 6.2); d.p.stance = 'defense'; });
    dc.at(t + 0.06, () => { pl.cancel = true; if (!d) return; faceTo(d, o); o.target = null; d.target = null; d.act('stumble', 0.9, { fall: true, back: true, dir: 1, react: 'stagger' }); o.act('stumble', 0.5, { fall: false, back: false, dir: -1 }); audio.whistle?.(); dc.cam.shake = 0.2; dc.give(o, 'held'); });
    dc.at(t + 0.95, () => { if (d) dc.give(d, 'held'); });
  },
});
export const SCRIPTED = Object.keys(SCRIPTS);
