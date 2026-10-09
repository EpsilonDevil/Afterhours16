// The Park hub: free roam, park-goers, live AI games on every court, Got Next queues, winner stays.
// v0.4.4: everyone here is a persistent AI account from this player's world (sim/world.js). Who shows up
// depends on who is online at this park right now; people arrive and log off as you play, your squad
// follows you around and runs with you, and every game is remembered for the social phone.
import { playOutro } from '../ui/outro.js';
import { music } from '../core/music.js';
import { promptGlyph } from '../core/input.js';
import { Scene } from '../gfx/renderer.js';
import { buildVenue } from '../world/venues.js';
import { AFFILIATIONS, THEMES, courtPlayRect, SQUAD_ROWS, parkInfo } from '../world/themes.js';
import { StreakFX, streakLevel } from '../world/streakfx.js';
import { boostedBuild } from '../sim/ratings.js';
import { consumeBoostsLocal } from '../ui/rewards.js';
import { Player } from '../sim/player.js';
import { COURT } from '../sim/constants.js';
import { RNG } from '../core/rng.js';
import { resolveLook, makeBot } from '../sim/bots.js';
import { capBadges } from '../sim/builds.js';
import { PlayerVisual, MatchSession } from './session.js';
import { GAME_SPEED } from '../sim/game.js';
import { VisualPool } from './vispool.js';
import { audio } from '../core/audio.js';
import * as M from '../core/math.js';
import { BOUNTY_MIN, bountyFor } from '../sim/world.js';

// v0.4.2 layout: full courts at x = -26, 0, 26; 2v2 annex at x = -52; 1v1 + practice annex at x = 52
const ZONES = [
  { x0: -46, x1: 46, z0: -30, z1: -21.5, w: 4 }, // south plaza
  { x0: 11, x1: 15, z0: -12, z1: 12, w: 1 }, // gap main/east
  { x0: -15, x1: -11, z0: -12, z1: 12, w: 1 }, // gap main/west
  { x0: 37.5, x1: 40.5, z0: -14, z1: 14, w: 1 }, // gap east court / 1v1 annex
  { x0: -40.5, x1: -37.5, z0: -14, z1: 14, w: 1 }, // gap west court / 2v2 annex
];
const pickIn = (rng, z) => ({ x: rng.range(z.x0, z.x1), z: rng.range(z.z0, z.z1) });
// v0.4.5: a box grown by a margin, and whether a point / a segment touches it
const grow = (b, m) => ({ x0: b.x0 - m, x1: b.x1 + m, z0: b.z0 - m, z1: b.z1 + m });
const inBox = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
function segHitsBox(b, ax, az, bx, bz) {
  // slab test on the segment a→b
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, b.x0, b.x1], [az, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p <= lo || p >= hi) return false; continue; }
    let u = (lo - p) / d, v = (hi - p) / d; if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 >= t1) return false;
  }
  return true;
}

class Walker {
  constructor(hub, entry, x, z) {
    this.hub = hub;
    this.entry = entry;
    this.p = new Player(0, 0, { build: entry.build, name: entry.name }, hub.app.catalog);
    this.p.setPos(x, z, hub.rng.range(-3, 3));
    this.visual = new PlayerVisual(hub.r, hub.scene, entry.build, entry.look, { detail: 0.75, pool: hub.pool });
    this.state = 'idle'; this.t = hub.rng.range(1, 6); this.path = [];
    this.spot = null;
    this.follow = null; // v0.4.4: squad slot when he's running with you
    this.exit = false; this.gone = false;
  }
  // log off: walk out of the park through the plaza, then disappear
  leave() {
    this.spot = null; this.follow = null; this.exit = true; this.watch = null;
    this.goTo(this.hub.rng.range(-40, 40), -31);
  }
  goTo(x, z) {
    // v0.4.5: never aim inside a shop, the wheel or another solid (walkers used to walk into them forever)
    const q = this.hub.freeSpot(x, z); x = q.x; z = q.z;
    // route through the south plaza so walkers never cross active courts
    const p = this.p, path = [];
    const inMid = (px, pz) => pz > -19.5 && Math.abs(px) < 63;
    if (inMid(p.x, p.z) || inMid(x, z)) { path.push({ x: p.x, z: -21.5 }); path.push({ x, z: -21.5 }); }
    path.push({ x, z });
    this.path = this.hub.routeAround(p.x, p.z, path.filter((w, i) => i === path.length - 1 || Math.hypot(w.x - p.x, w.z - p.z) > 0.5));
    this.state = 'walk';
    this.prog = { d: Infinity, t: 0 };
  }
  update(dt) {
    const p = this.p, it = p.intent;
    it.mx = 0; it.mz = 0; it.sprint = false; it.face = null;
    if (this.visual.pending) return; // still being built (a few frames): he walks in once he's there
    if (this.follow != null && !this.spot && !this.exit) {
      // squad: stay a step behind you, fanned out to the sides
      const me = this.hub.me, f = me.facing, slot = this.follow;
      const back = 1.5 + Math.floor(slot / 2) * 1.2, lat = (slot % 2 ? 1 : -1) * (0.85 + Math.floor(slot / 2) * 0.3);
      const tx = me.x - Math.sin(f) * back + Math.cos(f) * lat, tz = me.z - Math.cos(f) * back - Math.sin(f) * lat;
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d > 22) { p.setPos(tx, tz, f); }
      else if (d > 0.35) { const k = Math.min(1, d / 1.4) * (d > 3.5 ? 1 : 0.62); it.mx = dx / d * k; it.mz = dz / d * k; it.sprint = d > 4.5; }
      else it.face = f;
      this.state = 'follow';
    } else if (this.state === 'walk' && this.path.length) {
      const w = this.path[0];
      const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
      // stuck (pressed against something and not getting closer): give up on that spot and pick another
      if (this.prog) {
        if (d < this.prog.d - 0.15) { this.prog.d = d; this.prog.t = 0; } else this.prog.t += dt;
        if (this.prog.t > 2.5) {
          if (this.exit) { this.gone = true; return; }
          if (this.spot) { p.x = w.x; p.z = w.z; } // a queued player squeezes through to his spot
          else { const z = this.hub.pickZone(), q = pickIn(this.hub.rng, z); this.goTo(q.x, q.z); return; }
        }
      }
      if (d < 0.35) { this.path.shift(); if (!this.path.length) { if (this.exit) { this.gone = true; return; } this.state = this.spot ? 'queued' : 'idle'; this.t = this.hub.rng.range(3, 10); } }
      else { const k = Math.min(1, d / 0.8) * (this.spot || this.exit ? 0.75 : 0.42); it.mx = dx / d * k; it.mz = dz / d * k; }
    } else if (this.state === 'idle' || this.state === 'follow') {
      if (this.state === 'follow') { this.state = 'idle'; this.t = 1; }
      this.t -= dt;
      if (this.t <= 0) { const z = this.hub.pickZone(); const q = pickIn(this.hub.rng, z); this.goTo(q.x, q.z); }
      if (this.watch) it.face = Math.atan2(this.watch.x - p.x, this.watch.z - p.z);
    } else if (this.state === 'queued' && this.spot) {
      it.face = Math.atan2(this.spot.court.origin[0] - p.x, this.spot.court.origin[2] + 8 - p.z);
    }
    p.move(dt * GAME_SPEED, false, 0); // (v0.4.7.5: the same pace as in a game)
    for (const s of this.hub.venue.solids || []) pushOut(p, s);
    // v0.4.2: park-goers never wander onto a court while a game is on (walking off after a loss is fine)
    if (!(this.leaving > 0) && this.follow == null) for (const c of this.hub.courts) if (c.session || c.mine) pushOut(p, c.rect);
    if (this.leaving > 0) this.leaving -= dt;
    p.stamina = 1;
  }
  render(dt) {
    const p = this.p;
    if (this.visual.pending) return;
    this.visual.anim.update(dt, { x: p.x, y: 0, z: p.z, facing: p.facing }, p, null, null, {});
    this.visual.place(p.x, 0, p.z);
  }
  dispose() { this.visual.dispose(); }
}

// v0.4.5: people watching the games from the benches and sidelines. They react to what happens on the court
// in front of them: a dunk, a poster or a deep three gets them up (or arms up on the bench), a block or an
// ankle-breaker gets hands on heads, ordinary buckets get a clap. They animate only when you're close.
class Spectator {
  constructor(hub, court, x, z, facing, sit) {
    this.hub = hub; this.court = court; this.sit = sit;
    const bot = makeBot(hub.rng, { level: hub.rng.range(0.2, 0.8) });
    this.p = new Player(0, 0, { build: bot.build, name: bot.name }, hub.app.catalog);
    this.p.setPos(x, z, facing);
    this.visual = new PlayerVisual(hub.r, hub.scene, bot.build, resolveLook(bot.build, hub.catalog), { detail: 0.6 });
    this.base = sit ? 'sit' : 'idle';
    this.react = null; this.reactT = 0; this.cool = hub.rng.range(0, 1);
    this.look = hub.rng.range(-0.35, 0.35); // where along the court he's looking
    this.setPose(this.base);
    this.render(0.25, true); // settle into the pose
  }
  setPose(kind) {
    const p = this.p;
    if (kind === 'idle') { p.action = null; return; }
    // start past the blend-in so a sitter never pops up between reactions; dur is managed here
    p.action = { type: 'celebrate', kind, t: p.action?.type === 'celebrate' ? Math.max(0.3, p.action.t) : (kind === 'sit' ? 0 : 0.3), dur: 1e6, id: 0 };
  }
  // ev: the court's events this frame
  onEvents(evs) {
    if (this.cool > 0 || !evs?.length) return;
    const rng = this.hub.rng;
    let kind = null, hype = 0;
    for (const e of evs) {
      if (e.type === 'score') {
        const big = e.kind === 'dunk' || e.poster >= 0 && e.poster != null || e.oop || (e.three && (e.d || 0) > 8.2) || e.clutch;
        if (big && hype < 2) { kind = this.sit ? (rng.next() < 0.6 ? 'sitcheer' : 'sitclap') : (rng.next() < 0.7 ? 'cheer' : 'clap'); hype = 2; }
        else if (!big && hype < 1 && rng.next() < 0.45) { kind = this.sit ? 'sitclap' : 'clap'; hype = 1; }
      } else if ((e.type === 'block' || e.type === 'ankle' || e.type === 'posterContact') && hype < 2) {
        kind = this.sit ? 'sitcheer' : 'ooh'; hype = 2;
      } else if (e.type === 'steal' && hype < 1 && rng.next() < 0.35) { kind = this.sit ? 'sitclap' : 'clap'; hype = 1; }
    }
    if (!kind) return;
    this.react = kind; this.reactT = hype >= 2 ? rng.range(1.8, 2.8) : rng.range(1.0, 1.6);
    this.cool = this.reactT + rng.range(0.5, 2);
    // a beat of reaction time, different for everybody
    this.delay = rng.range(0.05, 0.35);
  }
  update(dt, near, game) {
    this.cool -= dt;
    if (this.react && this.delay > 0) { this.delay -= dt; if (this.delay <= 0) this.setPose(this.react); }
    else if (this.react) { this.reactT -= dt; if (this.reactT <= 0) { this.react = null; this.setPose(this.base); } }
    // keep the eyes on the ball side of the court
    const c = this.court, p = this.p, b = game?.ball;
    const tx = b ? c.origin[0] + b.x : c.origin[0], tz = b ? c.origin[2] + b.z : c.origin[2] + this.look * 10;
    const want = Math.atan2(tx - p.x, tz - p.z), base = this.facing0 ?? (this.facing0 = p.facing);
    let d = M.wrapAngle(want - base);
    d = this.sit ? Math.max(-0.6, Math.min(0.6, d)) : Math.max(-1.3, Math.min(1.3, d)); // seated: shoulders, not the whole body
    p.facing = M.angleLerp(p.facing, base + d, 1 - Math.exp(-dt * 2.5));
    if (p.action) p.action.t += dt;
    if (near) this.render(dt);
  }
  render(dt, force = false) {
    const p = this.p;
    this.visual.anim.update(dt, { x: p.x, y: 0, z: p.z, facing: p.facing }, p, null, null, {});
    this.visual.place(p.x, 0, p.z);
    if (force) for (let i = 0; i < 3; i++) this.visual.anim.update(0.1, { x: p.x, y: 0, z: p.z, facing: p.facing }, p, null, null, {});
  }
  dispose() { this.visual.dispose(); }
}

// keep a roaming body outside an axis-aligned box
function pushOut(p, b) {
  const r = p.phys.radius;
  if (p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r) return;
  const dl = p.x - (b.x0 - r), dr = (b.x1 + r) - p.x, dn = p.z - (b.z0 - r), df = (b.z1 + r) - p.z;
  const m = Math.min(dl, dr, dn, df);
  if (m === dl) p.x = b.x0 - r; else if (m === dr) p.x = b.x1 + r; else if (m === dn) p.z = b.z0 - r; else p.z = b.z1 + r;
}

export class ParkHub {
  constructor(app, themeId, ui) {
    this.app = app; this.r = app.renderer; this.ui = ui;
    this.themeId = themeId;
    this.scene = new Scene();
    this.venue = buildVenue(this.r, this.scene, themeId);
    this.theme = THEMES[themeId];
    this.aff = parkInfo(themeId) || AFFILIATIONS.harbor;
    this.cup = themeId === 'kingtut'; // v0.4.5 The King Tut Cup: every game is an ante-up
    this.ante = null; this.cupState = null; this.cupT = 0;
    this.rng = new RNG((Date.now() & 0xffff) ^ 0x5a5a);
    this.mode = 'roam';
    this.catalog = app.catalog;
    const char = app.char();
    this.char = char;
    // my roaming player
    this.meEntry = { build: { ...char }, name: char.name, look: app.look(char), human: true, badges: badgeTiers(char) };
    this.me = new Player(0, 0, { build: char, name: char.name }, app.catalog);
    this.me.setPos(11.5, -18.5, 0);
    // v0.4.5 stage 7: park-goers and background players share athletes through a pool and new ones are built a
    // few milliseconds per frame (see vispool.js), so courts rotating and people arriving never hitch the frame
    this.pool = new VisualPool(this.r, { maxFree: 16, budgetMs: 3 });
    this.meVisual = new PlayerVisual(this.r, this.scene, char, this.meEntry.look, { detail: 1, pool: this.pool, now: true });
    this.meVisual.addRing(this.r, this.aff.color);
    // v0.4.4: the park's people come from this account's AI world: whoever is online here right now
    this.world = app.ai;
    this.walkers = [];
    this.myMates = []; this.myOpp = [];
    // live courts first (a quiet park can leave courts empty), then whoever is left hangs around
    // v0.4.7.5: every court has two GOT NEXT spots; c.lines[r] is the group standing on spot r, and a mine line is
    // the user's. The first line to fill up (l.fullAt) runs next; the other waits for that game to end.
    this.courts = this.venue.courts.map(c => ({ ...c, rect: courtPlayRect(c), session: null, lines: new Array(SQUAD_ROWS).fill(null), mine: false, kings: null, kingsStreak: 0 }));
    for (const c of this.courts) this.newBackgroundGame(c, null);
    for (const id of this.availableHere().slice(0, 9)) {
      const z = this.pickZone(), q = pickIn(this.rng, z);
      this.walkers.push(this.spawnWalker(q.x, q.z, this.entryFor(id)));
    }
    this.popT = 15;
    this.syncSquad(true);
    this.spectators = this.spawnSpectators();
    // v0.4.5 stage 7: every court's streak effect is built now (hidden until a 3-game streak) so its geometry
    // and shaders are ready, instead of being built in the middle of somebody's game
    for (const c of this.courts) c.fx = new StreakFX(this.r.ctx, this.scene, c, this.cup ? 'laser' : 'flame');
    this.pool.flush(); // (we're loading: everybody who's here at the start is here on the first frame)
    this.rig = app.cameraRig;
    this.rig.roamYaw = 0; this.rig.snap();
    this.claimT = 0; this.claimCourt = null;
    this.mySession = null; this.practice = null;
    this.prompt = '';
    audio.setCrowd(0.1); audio.setIndoor(false);
    audio.surface = 'asphalt';
    this.r.prewarm(this.scene); // v0.4.5 stage 7: compile every shader the park needs while it loads
  }

  // v0.4.5: nearest point outside every solid (with room to stand)
  freeSpot(x, z) {
    for (const s0 of this.venue.solids || []) {
      const b = grow(s0, 0.9);
      if (!inBox(b, x, z)) continue;
      const opts = [[b.x0, z], [b.x1, z], [x, b.z0], [x, b.z1]];
      opts.sort((a, c) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(c[0] - x, c[1] - z));
      x = opts[0][0]; z = opts[0][1];
    }
    return { x, z };
  }
  // v0.4.5: add corner waypoints so a path goes around the shops and the wheel instead of into them
  routeAround(x, z, path) {
    const out = [];
    let ax = x, az = z;
    for (const w of path) {
      for (let guard = 0; guard < 3; guard++) {
        const hit = (this.venue.solids || []).map(s0 => grow(s0, 0.7)).find(b => segHitsBox(b, ax, az, w.x, w.z));
        if (!hit) break;
        // corners we can reach in a straight line from here (not the one we're standing on), shortest detour first
        const corners = [[hit.x0 - 0.2, hit.z0 - 0.2], [hit.x1 + 0.2, hit.z0 - 0.2], [hit.x0 - 0.2, hit.z1 + 0.2], [hit.x1 + 0.2, hit.z1 + 0.2]]
          .filter(q => Math.hypot(q[0] - ax, q[1] - az) > 0.05 && !segHitsBox(hit, ax, az, q[0], q[1]));
        if (!corners.length) break;
        corners.sort((a, c) => (Math.hypot(a[0] - ax, a[1] - az) + Math.hypot(a[0] - w.x, a[1] - w.z)) - (Math.hypot(c[0] - ax, c[1] - az) + Math.hypot(c[0] - w.x, c[1] - w.z)));
        out.push({ x: corners[0][0], z: corners[0][1] });
        ax = corners[0][0]; az = corners[0][1];
      }
      out.push(w); ax = w.x; az = w.z;
    }
    return out;
  }

  // v0.4.5: bench sitters and sideline standers for every court
  spawnSpectators() {
    const out = [], W = COURT.width / 2 + 2.2;
    for (const c of this.courts) {
      const [ox, , oz] = c.origin, full = !!c.full, bx = ox - W + 0.9 + 0.04;
      const seats = [];
      for (const bz of full ? [oz - 9, oz - 3, oz + 3] : [oz + 4]) for (const dz of [-0.62, 0, 0.62]) seats.push(bz + dz);
      const n = full ? 4 : 2;
      for (const z of this.rng.shuffle(seats).slice(0, n)) out.push(new Spectator(this, c, bx, z, Math.PI / 2, true));
      const stand = full ? [[ox - W + 0.75, oz + 8.6, Math.PI / 2], [ox + W + 0.7, oz - 11.5, -Math.PI / 2]] : [[ox - 4.5, oz - 4.6, 0], [ox + 3.8, oz - 4.9, 0]];
      for (const [x, z, f] of stand.slice(0, full ? 2 : 1)) out.push(new Spectator(this, c, x, z, f, false));
    }
    return out;
  }
  // v0.4.5: AI-only games run faster than real time. A game you can see plays at normal speed while the ball is
  // live, and fast-forwards through checks and dead balls; games you can't see run about 2.6x. Over a whole
  // game that works out to roughly twice as fast as before, without anything looking sped up on the live ball.
  // ---------- v0.4.7.5 court overview ----------
  setOverview(on) {
    this.overview = on;
    const f = this.scene.fog;
    if (on) { this.fogKeep = f.density; f.density = Math.min(f.density, 0.004); } else if (this.fogKeep != null) { f.density = this.fogKeep; this.fogKeep = null; }
    this.ui.overview?.(this, on);
  }
  overviewCam(dt) {
    const b = this.venue.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2 - 1;
    const aspect = this.r.canvas.clientWidth / Math.max(1, this.r.canvas.clientHeight);
    const h = Math.max(84, 100 * 1.78 / Math.max(1, aspect) + 8); // (narrow screens pull back to fit every court)
    this.rig.apply(dt, [cx, h, cz + h * 0.27], [cx, 0, cz - 1], 50, 3.2);
    this.scene.shadowFocus = { center: [cx, 0, cz], radius: 70 };
  }
  // what the overview and the ticker show for a court: {name, score, target, streak, bounty, mine, next, live}
  courtInfo(c) {
    const s = c === this.myCourt && this.mySession ? this.mySession : c.session, g = s?.game;
    const streak = this.courtStreak(c), my = this.myLine(), mine = c === this.myCourt && !!this.mySession;
    return {
      name: c.name, live: !!g && !g.over, over: !!g?.over, score: g ? [g.score[0], g.score[1]] : null, target: g?.target || null,
      teams: s ? [s.teams?.[0]?.abbr || 'KNG', s.teams?.[1]?.abbr || 'CHL'] : null,
      streak, bounty: mine ? 0 : bountyFor(streak), myStreak: mine,
      waiting: c.lines.filter(Boolean).length,
      next: my && my.c === c ? (this.nextLine(c)?.l === my.l ? 'next' : this.nextLine(c) ? 'after' : 'filling') : null,
    };
  }

  courtWatched(c) {
    if (this.overview) return true; // (the overview is live: every court at normal speed)
    const cam = this.rig.pos, tgt = this.rig.tgt;
    if (!cam || !tgt) return true;
    const dx = c.origin[0] - cam[0], dz = c.origin[2] - cam[2], d = Math.hypot(dx, dz);
    if (d < 20) return true;
    if (d > 70) return false;
    const fx = tgt[0] - cam[0], fz = tgt[2] - cam[2], fl = Math.hypot(fx, fz) || 1;
    return (dx * fx + dz * fz) / (d * fl) > 0.45; // inside a ~125° view cone
  }
  courtRate(c) {
    const g = c.session?.game;
    if (!g) return 1;
    if (!this.courtWatched(c)) return 2.6;
    if (g.phase === 'check' || g.phase === 'inbound' || g.phase === 'pregame') return 3;
    if (g.phase === 'dead' || g.over) return 2;
    return 1;
  }

  pickZone() { const tot = ZONES.reduce((s, z) => s + z.w, 0); let r = this.rng.next() * tot; for (const z of ZONES) { r -= z.w; if (r <= 0) return z; } return ZONES[0]; }

  // ---------- v0.4.4 population ----------
  entryFor(id) { const e = this.world.gameEntry(id); e.look = resolveLook(e.build, this.catalog); return e; }
  // everyone physically in the park (walkers, courts, lines, my game)
  busyIds() {
    const s = new Set(), add = e => { if (e?.aiId) s.add(e.aiId); };
    for (const w of this.walkers) add(w.entry);
    for (const c of this.courts) { if (c.session) for (const r of c.session.opts.rosters) r.forEach(add); for (const l of c.lines) if (l) l.members.forEach(w => add(w.entry)); }
    (this.myMates || []).forEach(add); (this.myOpp || []).forEach(add);
    return s;
  }
  // v0.4.5: who is in a game right now (a court here, or yours)
  playingIds() {
    const s = new Set(), add = e => { if (e?.aiId) s.add(e.aiId); };
    for (const c of this.courts) if (c.session && !c.session.game.over) for (const r of c.session.opts.rosters) r.forEach(add);
    if (this.mode === 'match' && this.mySession) { (this.myMates || []).forEach(add); (this.myOpp || []).forEach(add); }
    return s;
  }
  // in a game here, or (when he's at another park) by the world's schedule
  isPlaying(id, t = Date.now()) {
    const st = this.world.status(id, t);
    if (st && st.park === this.themeId) return this.playingIds().has(id);
    return this.world.playingElsewhere(id, t);
  }
  stays(e, t = Date.now()) { return !e?.aiId || this.world.online(e.aiId, t); }
  // online at this park and not already doing something here
  availableHere(t = Date.now()) {
    const busy = this.busyIds(), squad = new Set(this.world.squad);
    const ids = this.world.onlineAt(this.themeId, t);
    return ids.filter(id => !busy.has(id) && !squad.has(id));
  }
  // n players for a court: people around first (closest to a wanted level when asked), then free park-goers;
  // topUp: if the park is too quiet, regulars who are about to come on "hop on early"
  takeEntries(n, opts = {}) {
    const t = Date.now(), ex = opts.exclude || new Set();
    let ids = this.rng.shuffle(this.availableHere(t).filter(id => !ex.has(id)));
    if (opts.level != null) ids = ids.map(id => [id, Math.abs(this.world.account(id).level - opts.level) + this.rng.range(0, 0.15)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const free = opts.walkers === false ? [] : this.walkers.filter(w => !w.spot && w.follow == null && !w.exit && w.entry.aiId);
    if (!opts.topUp && ids.length + free.length < n) return null;
    const out = ids.slice(0, n).map(id => this.entryFor(id));
    for (const w of free) { if (out.length >= n) break; out.push(w.entry); w.dispose(); this.walkers = this.walkers.filter(x => x !== w); }
    if (out.length < n) {
      const ex2 = new Set([...ex, ...this.busyIds(), ...out.map(e => e.aiId), ...this.world.squad]);
      for (const id of this.world.closestOffline(this.themeId, n - out.length, t, ex2)) { this.world.extra.set(id, { park: this.themeId, until: t + 25 * 60000 }); out.push(this.entryFor(id)); }
    }
    return out.length >= n ? out : null;
  }
  // people come and go: logged-off park-goers head out, idle courts fill up, new arrivals walk in
  populationTick() {
    const t = Date.now();
    for (const [id, x] of this.world.extra) if (x.until < t) this.world.extra.delete(id);
    for (const w of this.walkers) if (w.entry.aiId && !w.spot && w.follow == null && !w.exit && !this.stays(w.entry, t)) w.leave();
    for (const c of this.courts) if (!c.session && !c.mine) this.newBackgroundGame(c, null);
    // v0.4.5: groups of park-goers line up on the squad spots of busy courts (one new group per tick)
    const busyCourts = this.rng.shuffle(this.courts.filter(c => c.session && c.lines.some(l => !l)));
    for (const c of busyCourts) { if (this.rng.next() < 0.45 && this.formAILine(c)) break; }
    let room = 10 - this.walkers.filter(w => !w.exit && w.follow == null).length;
    for (const id of this.availableHere(t)) {
      if (room-- <= 0) break;
      const w = this.spawnWalker(this.rng.range(-40, 40), -30.5, this.entryFor(id));
      const z = this.pickZone(), q = pickIn(this.rng, z); w.goTo(q.x, q.z);
      this.walkers.push(w);
    }
    this.syncSquad();
  }
  // squad mates who are online run with you; whoever left the squad goes back to hanging out
  syncSquad(initial = false) {
    const active = this.world.activeSquad();
    for (const w of this.walkers) if (w.follow != null && !active.includes(w.entry.aiId)) { w.follow = null; w.state = 'idle'; w.t = 1; }
    const busy = this.busyIds();
    active.forEach((id, i) => {
      let w = this.walkers.find(x => x.entry.aiId === id);
      if (w) { if (!w.spot) { w.follow = i; w.exit = false; } return; }
      if (busy.has(id)) return; // finishing a game on one of the courts: he comes over when it ends
      const me = this.me, near = initial;
      w = this.spawnWalker(near ? me.x - 1.5 - i : this.rng.range(-30, 30), near ? me.z - 1.2 : -30.5, this.entryFor(id));
      w.follow = i;
      this.walkers.push(w);
      if (!initial) { const from = this.world.status(id)?.park; this.ui.toast(`${w.entry.name} is on his way${from && from !== this.themeId ? ' over from ' + (parkInfo(from)?.park || 'another park') : ''}.`); }
    });
  }
  // the social phone's park list: everyone online at this park, with what they're up to
  parkList() {
    const t = Date.now(), out = [], seen = new Set();
    const add = (e, where, extra = {}) => { if (!e?.aiId || seen.has(e.aiId)) return; seen.add(e.aiId); out.push({ id: e.aiId, entry: e, where, ...extra }); };
    if (this.mode === 'match' && this.mySession) { (this.myMates || []).forEach(e => add(e, 'Running with you', { mine: 'mate' })); (this.myOpp || []).forEach(e => add(e, 'Across from you', { mine: 'opp' })); }
    for (const w of this.walkers) if (w.follow != null) add(w.entry, 'In your squad', { squad: true });
    for (const c of this.courts) {
      if (c.session) c.session.opts.rosters.forEach((r, ti) => r.forEach(e => add(e, `Playing on ${c.name}${ti === 0 && c.kingsStreak ? ` · ${c.kingsStreak}-game streak` : ''}`)));
      c.lines.forEach(l => { if (l) l.members.forEach(w => add(w.entry, l.mine ? `Got next with you on ${c.name}` : `Got next on ${c.name}`)); });
    }
    for (const w of this.walkers) if (!w.exit) add(w.entry, w.watch ? 'Watching the games' : 'Hanging out');
    for (const id of this.availableHere(t)) add(this.world.entry(id), 'On the sidelines');
    return out;
  }

  spawnWalker(x, z, entry) {
    entry = entry || this.takeEntries(1, { topUp: true, walkers: false })[0];
    entry.look = entry.look || resolveLook(entry.build, this.catalog);
    const w = new Walker(this, entry, x, z);
    if (this.rng.next() < 0.4) w.watch = { x: this.rng.pick(this.venue.courts).origin[0], z: 6 };
    return w;
  }

  newBackgroundGame(c, kings) {
    if (c.session) { c.session.dispose(); c.session = null; }
    const fmt = c.format, t = Date.now();
    // kings keep the court while they're all still on (and none of them left to run with you)
    let home = kings && kings.every(e => this.stays(e, t) && !this.world.inSquad(e.aiId)) ? kings : null;
    let away = null;
    const nx = this.upNext(c, false);
    if (nx) { away = nx.l.members.map(w => w.entry); this.takeLine(c, nx.i); }
    if (!home) { c.kingsStreak = 0; home = this.takeEntries(fmt, { exclude: new Set((away || []).map(e => e.aiId)) }); }
    if (home && !away) away = this.takeEntries(fmt, { exclude: new Set(home.map(e => e.aiId)) });
    if (!home || !away) {
      // not enough people around: the court sits empty for now; anyone pulled for it goes back to hanging out
      for (const e of [...(home || []), ...(away || [])]) if (this.walkers.length < 14 && this.stays(e, t)) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] + this.rng.range(-4, 4), e); w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); this.walkers.push(w); }
      c.kings = null; c.session = null;
      return;
    }
    for (const e of [...home, ...away]) { e.look = e.look || resolveLook(e.build, this.catalog); e.human = false; }
    c.kings = home;
    c.session = new MatchSession(this.app, { background: true, hub: true, pool: this.pool, mode: 'park', full: !!c.full, scene: this.scene, venue: this.venue, court: c, rosters: [home, away], teams: [{ name: 'Kings', abbr: 'KNG', color: '#ffd84a' }, { name: 'Challengers', abbr: 'CHL', color: '#ff5a36' }], seed: this.rng.int(1, 1e9), target: 11, difficulty: 0.6, assist: true });
    c.bgStart = performance.now();
  }

  // ---------------- frame ----------------
  frame(dt) {
    const app = this.app, inp = app.input;
    // athletes being built: a small slice per frame (a bigger one while your own game is getting ready)
    if (this.pool.pending) this.pool.tick(this.mode === 'starting' ? 10 : 3);
    this.venue.update(dt);
    this.venue.practice.hoop.update(dt, this.practice ? null : null);
    // background courts
    for (const c of this.courts) {
      if (c.session) {
        c.session.rate = this.courtRate(c);
        c.session.frame(dt);
        const g = c.session.game;
        // my squad is waiting: wrap the current game up
        const nx = this.nextLine(c);
        if (nx && nx.l.mine && nx.l.ready && !g.over && (performance.now() - nx.l.readyAt) > 25000) { const lead = g.score[0] >= g.score[1] ? 0 : 1; g.finish(lead); }
        if (g.over && c.session.ended && c.session.endT > 2.2) this.rotateCourt(c);
      }
    }
    this.updateSpectators(dt);
    for (const w of this.walkers) { w.update(dt); if (!w.gone) w.render(dt); }
    if (this.walkers.some(w => w.gone)) { for (const w of this.walkers) if (w.gone) w.dispose(); this.walkers = this.walkers.filter(w => !w.gone); }
    this.updateStreakFX(dt);
    if (this.cup && (this.cupT -= dt) <= 0) { this.cupT = 60; this.refreshCup(); }
    this.popT -= dt;
    if (this.popT <= 0) { this.popT = 20; this.populationTick(); }
    if (this.mode !== 'roam' && this.overview) this.setOverview(false);
    if (this.mode === 'roam') this.roam(dt);
    else if (this.mode === 'match' && this.mySession) {
      if (inp.wasPressed('pause') && !this.mySession.ended && !this.mySession.paused && !this.app.modalOpen()) this.ui.pauseGame(this);
      this.mySession.frame(dt);
    }
    else if (this.mode === 'practice' && this.practice) {
      this.practice.frame(dt);
      if (inp.wasPressed('pause')) this.endPractice();
    }
    this.ui.update(this);
  }

  roam(dt) {
    const app = this.app, inp = app.input, me = this.me;
    inp.ctx = 'roam';
    if (this.app.modalOpen()) { me.intent.mx = me.intent.mz = 0; me.move(dt * GAME_SPEED, false, 0); this.meVisual.anim.update(dt, { x: me.x, y: 0, z: me.z, facing: me.facing }, me, null, null, {}); this.meVisual.place(me.x, 0, me.z); this.rig.updateRoam(dt, me, null, this.venue.bounds, this.venue.solids); return; }
    if (inp.wasPressed('pause')) { this.ui.pause(this); return; }
    // v0.4.7.5 court overview: hold View / Share (V on the keyboard) for a live bird's-eye view of the whole park,
    // every court's score, streak and bounty on it
    this.viewHeld = inp.isDown('camera') ? (this.viewHeld || 0) + dt : 0;
    const over = this.viewHeld > 0.22;
    if (over !== !!this.overview) this.setOverview(over);
    if (over) {
      me.intent.mx = me.intent.mz = 0; me.intent.sprint = false;
      me.move(dt * GAME_SPEED, false, 0);
      this.meVisual.anim.update(dt, { x: me.x, y: 0, z: me.z, facing: me.facing }, me, null, null, {});
      this.meVisual.place(me.x, 0, me.z);
      this.overviewCam(dt);
      this.prompt = '';
      return;
    }
    const mv = inp.moveVector();
    const basis = this.rig.inputBasis();
    me.intent.mx = basis.rx * mv.x + basis.fx * mv.y;
    me.intent.mz = basis.rz * mv.x + basis.fz * mv.y;
    me.intent.sprint = inp.isDown('sprint');
    me.intent.face = null; me.intent.stickFace = true;
    me.move(dt * GAME_SPEED, false, 0);
    me.stamina = Math.min(1, me.stamina + dt * 0.2);
    // stay in the park
    const b = this.venue.bounds;
    me.x = M.clamp(me.x, b.x0, b.x1); me.z = M.clamp(me.z, b.z0, b.z1);
    for (const s of this.venue.solids || []) pushOut(me, s);
    // bump into people
    for (const w of this.walkers) this.separate(me, w.p);
    for (const c of this.courts) if (c.session) for (const p of c.session.game.players) this.separate(me, { x: p.x + c.origin[0], z: p.z + c.origin[2], phys: p.phys }, true);
    this.meVisual.anim.update(dt, { x: me.x, y: 0, z: me.z, facing: me.facing }, me, null, null, {});
    this.meVisual.place(me.x, 0, me.z);
    this.rig.updateRoam(dt, me, inp, b, this.venue.solids);
    this.scene.shadowFocus = { center: [me.x, 0, me.z + 2], radius: 16 };
    // interactions
    this.prompt = '';
    const store = this.venue.store, boosts = this.venue.boosts, wheel = this.venue.wheel;
    if (Math.hypot(me.x - store.x, me.z - store.z) < 2.9) { this.prompt = `${promptGlyph(inp, 'E', 'A')} VC Store`; if (inp.wasPressed('interact')) this.ui.openStore(this); }
    else if (boosts && Math.hypot(me.x - boosts.x, me.z - boosts.z) < 2.9) { this.prompt = `${promptGlyph(inp, 'E', 'A')} Boosts`; if (inp.wasPressed('interact')) this.ui.openBoosts(this); }
    else if (this.venue.hq && Math.hypot(me.x - this.venue.hq.x, me.z - this.venue.hq.z) < 2.6) {
      // v0.4.5 Crews: the Crew HQ door
      const cr = this.app.crew;
      this.prompt = `${promptGlyph(inp, 'E', 'A')} ${cr ? `Enter the Crew HQ · ${cr.tag}` : cr === null ? 'Crew HQ · start a crew' : 'Crew HQ'}`;
      if (inp.wasPressed('interact')) this.ui.openHQ(this);
    }
    else if (wheel && Math.hypot(me.x - wheel.x, me.z - wheel.z) < 2.6) {
      const ready = (this.app.profile.daily_spin?.next_at || 0) * 1000 <= Date.now();
      this.prompt = `${promptGlyph(inp, 'E', 'A')} Daily Spin${ready ? ' · ready!' : ''}`;
      if (inp.wasPressed('interact')) this.ui.openWheel(this);
    }
    const pr = this.venue.practice.origin;
    if (Math.hypot(me.x - (pr[0] - 4), me.z - (pr[2] - 2)) < 3 || Math.hypot(me.x - pr[0], me.z - pr[2]) < 4.5) { this.prompt = `${promptGlyph(inp, 'E', 'A')} Shoot around`; if (inp.wasPressed('interact')) this.startPractice(); }
    this.gotNext(dt);
    if (inp.wasPressed('celebrate') && !me.action) me.startAction('celebrate', 1.6, { kind: this.app.catalog[this.char.equipment?.celebration]?.anim || 'flex' });
    if (me.action) { me.action.t += dt; if (me.action.t > me.action.dur) me.action = null; }
  }

  separate(a, b, staticB = false) {
    const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), r = (a.phys.radius + b.phys.radius) * 0.9;
    if (d < r && d > 1e-4) { const k = (r - d) / d; a.x += dx * k * (staticB ? 1 : 0.5); a.z += dz * k * (staticB ? 1 : 0.5); if (!staticB && b.x !== undefined) { b.x -= dx * k * 0.5; b.z -= dz * k * 0.5; } }
  }

  // ---------- v0.4.7.5 GOT NEXT spots: two per court, the first squad to fill up runs next ----------
  myLine() { for (const c of this.courts) for (let r = 0; r < c.lines.length; r++) if (c.lines[r]?.mine) return { c, r, l: c.lines[r] }; return null; }
  lineFull(c, l) { return l.members.length + (l.mine ? 1 : 0) >= c.format; }
  lineSet(c, l) { return this.lineFull(c, l) && l.members.every(w => w.state === 'queued'); }
  // stamp the moment a line fills up (it's what decides who runs next)
  markFull(c, l) { if (l && !l.fullAt && this.lineFull(c, l)) l.fullAt = (this.fillSeq = (this.fillSeq || 0) + 1); }
  // the line that runs next: the first one that filled up → {l, i} (null while neither spot is full)
  nextLine(c) {
    let out = null;
    c.lines.forEach((l, i) => { if (l && l.fullAt && (!out || l.fullAt < out.l.fullAt)) out = { l, i }; });
    return out;
  }
  // the AI line that can step on court now (mine = also yours): the first-filled one if it's standing ready; if
  // that one is still walking up, the other spot's squad when it is
  upNext(c, mine = false) {
    const order = c.lines.map((l, i) => ({ l, i })).filter(x => x.l && x.l.fullAt).sort((a, b) => a.l.fullAt - b.l.fullAt);
    for (const x of order) { if (x.l.mine && !mine) { if (x.l.ready) return null; continue; } if (this.lineSet(c, x.l)) return x; }
    return null;
  }
  // a line steps on court (or walks off): its spot is free again; the other spot keeps its place
  takeLine(c, i) {
    const l = c.lines[i]; if (!l) return;
    if (!l.mine) { l.members.forEach(w => w.dispose()); this.walkers = this.walkers.filter(w => !l.members.includes(w)); }
    c.lines[i] = null;
  }
  // everyone in line r walks to his circle on that spot
  placeLine(c, r) {
    const l = c.lines[r]; if (!l) return;
    l.members.forEach((w, i) => { const slot = i + (l.mine ? 1 : 0), sp = c.rows[r][slot]; w.spot = { court: c, row: r, slot }; w.follow = null; w.goTo(sp.x, sp.z); });
  }
  // a group of park-goers (free walkers first, then new arrivals from the plaza) takes an open spot. v0.4.7.5: old
  // squad mates of yours who chose to keep running together line up as a group
  formAILine(c, group = null) {
    const r = c.lines.findIndex(l => !l);
    if (r < 0) return false;
    let members = group;
    if (!members) {
      const head = c.rows[r][0], party = new Set(this.world.aiParty ? this.world.aiParty() : []);
      const free = this.walkers.filter(w => !w.spot && w.follow == null && !w.exit && w.entry.aiId).sort((a, b) => (party.has(b.entry.aiId) - party.has(a.entry.aiId)) || (Math.hypot(a.p.x - head.x, a.p.z - head.z) - Math.hypot(b.p.x - head.x, b.p.z - head.z))).slice(0, c.format);
      if (free.length < c.format) {
        const more = this.takeEntries(c.format - free.length, { walkers: false });
        if (!more) return false;
        for (const e of more) { const w = this.spawnWalker(this.rng.range(-30, 30), -30.5, e); this.walkers.push(w); free.push(w); }
      }
      members = free;
    }
    c.lines[r] = { members, mine: false, ready: false, readyAt: 0 };
    this.markFull(c, c.lines[r]);
    this.placeLine(c, r);
    return true;
  }

  gotNext(dt) {
    const me = this.me;
    const mine = this.myLine();
    if (!mine) {
      let on = null;
      for (const c of this.courts) c.rows.forEach((row, r) => row.forEach((sp, i) => { if (Math.hypot(me.x - sp.x, me.z - sp.z) < 0.75) on = { c, r, i }; }));
      if (on) {
        const { c, r } = on, other = c.lines[1 - r];
        if (c.lines[r]) { this.prompt = `This GOT NEXT spot on ${c.name} is taken · ${other ? 'both spots are full' : 'the other spot is open'}`; this.claimT = 0; return; }
        if (this.anteDeclined === c) { this.prompt = `Step off and back on to claim the spot on ${c.name}`; return; }
        this.claimT += dt;
        this.prompt = `Claiming a GOT NEXT spot on ${c.name}… ${Math.max(0, 1.2 - this.claimT).toFixed(1)}s`;
        if (this.claimT > 1.2) {
          if (!this.cup) this.claim(c, r);
          else {
            // v0.4.5 King Tut Cup: name your ante before you take the spot
            this.claimT = 0;
            this.ui.pickAnte(this, ante => { if (ante) { this.ante = ante; this.claim(c, r); } else this.anteDeclined = c; });
          }
        }
      } else { this.claimT = 0; this.anteDeclined = null; }
      return;
    }
    const { c, r, l } = mine;
    const n = l.members.length + 1;
    const head = c.rows[r][0];
    if (Math.hypot(me.x - head.x, me.z - head.z) > 6) { this.unclaim(c); this.ui.toast('You left your spot.'); return; }
    const nx = this.nextLine(c), other = c.lines[1 - r];
    if (n < c.format) this.prompt = `GOT NEXT on ${c.name} · waiting for teammates (${n}/${c.format})${other && other.fullAt ? ' · the other squad filled first: they run next' : ' · fill up first to run next'}`;
    else if (nx && nx.l === l) this.prompt = `Squad ready on ${c.name} · you run next${c.session ? ' · after this game' : ''}`;
    else this.prompt = `Squad ready on ${c.name} · the other squad filled first: you're up after their game`;
    this.fillQueue(c, r, l, dt);
  }

  claim(c, r) {
    c.mine = true; this.claimT = 0;
    c.lines[r] = { members: [], mine: true, ready: false, readyAt: 0 };
    this.markFull(c, c.lines[r]);
    audio.ui('buy');
    const other = c.lines[1 - r];
    this.ui.toast(other && other.fullAt ? `Got next on ${c.name}! The squad on the other spot filled first: you run after their game.` : `Got next on ${c.name}! Teammates are on the way. Fill up first and you run next.`);
    this.fillT = 1.5;
  }
  unclaim(c) {
    c.mine = false;
    const r = c.lines.findIndex(l => l?.mine);
    if (r >= 0) {
      for (const w of c.lines[r].members) { w.spot = null; w.state = 'idle'; w.t = 1; }
      c.lines[r] = null;
    }
    this.syncSquad(); // squad mates fall back in behind you
  }
  fillQueue(c, r, l, dt) {
    if (this.lineFull(c, l)) {
      this.markFull(c, l);
      if (!l.ready && this.nextLine(c)?.l === l && l.members.every(w => w.state === 'queued')) {
        l.ready = true; l.readyAt = performance.now(); this.ui.toast('Squad is ready. You run next!');
        // v0.4.4: an empty court (quiet hours): the squad on the other spot, or whoever's around, runs against you
        if (!c.session) {
          const o = c.lines.findIndex(x => x && !x.mine && this.lineSet(c, x));
          let opp = null;
          if (o >= 0) { opp = c.lines[o].members.map(w => w.entry); this.takeLine(c, o); }
          else { const streak = this.char.progression?.park?.streak || 0; opp = this.takeEntries(c.format, { topUp: true, level: Math.min(0.95, 0.5 + 0.05 * streak) }); }
          this.startMyGame(c, opp, 0);
        }
      }
      return;
    }
    this.fillT -= dt;
    if (this.fillT > 0) return;
    // v0.4.4: your squad steps in first, then the nearest free park-goer (or a new arrival from the plaza)
    const squad = this.walkers.filter(w => w.follow != null && !w.spot).sort((a, b) => a.follow - b.follow);
    this.fillT = squad.length > 1 ? 0.2 : this.rng.range(2.5, 5);
    let w = squad[0];
    const head = c.rows[r][0];
    if (!w) {
      const free = this.walkers.filter(x => !x.spot && x.follow == null && !x.exit).sort((a, b) => Math.hypot(a.p.x - head.x, a.p.z - head.z) - Math.hypot(b.p.x - head.x, b.p.z - head.z));
      w = free[0];
      if (!w || this.rng.next() < 0.35) { const e = this.takeEntries(1, { topUp: true, walkers: false }); if (e) { w = this.spawnWalker(this.rng.range(-20, 20), -29, e[0]); this.walkers.push(w); } }
      if (!w) return;
    }
    l.members.push(w);
    this.markFull(c, l);
    this.placeLine(c, r);
  }

  rotateCourt(c) {
    const s = c.session, g = s.game;
    const winners = s.opts.rosters[g.winner];
    const losers = s.opts.rosters[1 - g.winner];
    // v0.4.7.5: everyone who played gets a game better (AI overalls grow slowly and are saved with the AI world)
    this.world.playedGame?.([...winners, ...losers].map(e => e.aiId).filter(Boolean), winners.map(e => e.aiId).filter(Boolean));
    // v0.4.5 stage 7: the finished game hands its athletes back to the pool first, so the losers walking off and
    // the next game on this court pick up the same ones instead of building new people mid-frame
    s.dispose();
    // losers are forced off the court: they walk off into the park (or log off and head home). v0.4.5: some
    // of them walk back around to the back of the line to run it again
    const off = [];
    for (let i = 0; i < g.teams[1 - g.winner].length && this.walkers.length < 18; i++) {
      const p = g.teams[1 - g.winner][i];
      const w = this.spawnWalker(p.x + c.origin[0], p.z + c.origin[2], losers[i]);
      w.leaving = 8;
      if (this.stays(losers[i])) { w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); off.push(w); } else w.leave();
      this.walkers.push(w);
    }
    c.kingsStreak = g.winner === 0 ? (c.kingsStreak || 0) + 1 : 1;
    const nx = this.nextLine(c), l0 = nx?.l;
    if (l0 && l0.mine && l0.ready) {
      s.dispose(); c.session = null;
      // kings who logged off (or left to join your squad) are replaced by whoever's around
      const kept = winners.every(e => this.stays(e) && !this.world.inSquad(e.aiId));
      const opp = kept ? winners : this.takeEntries(c.format, { topUp: true, exclude: new Set(l0.members.map(w => w.entry.aiId)) });
      this.startMyGame(c, opp, kept ? c.kingsStreak : 0); // (the kings bring their streak; fill-ins don't)
      this.syncSquad();
      if (off.length === c.format && this.rng.next() < 0.45) this.formAILine(c, off);
      return;
    }
    if (off.length === c.format && this.rng.next() < 0.45 && c.lines.some(l => !l)) this.formAILine(c, off);
    // winners stay on; anyone who just logged off walks out instead
    const leaving = winners.filter(e => !this.stays(e) || this.world.inSquad(e.aiId));
    if (leaving.length) {
      s.opts.rosters[g.winner] = []; // so they no longer count as busy on this court
      winners.forEach((e, i) => { if (!leaving.includes(e)) return; const p = g.teams[g.winner][i]; const w = this.spawnWalker(p.x + c.origin[0], p.z + c.origin[2], e); w.leaving = 8; if (this.world.inSquad(e.aiId)) w.follow = 0; else w.leave(); this.walkers.push(w); });
    }
    this.newBackgroundGame(c, leaving.length ? null : winners);
    if (leaving.length) this.syncSquad();
  }

  // ---------------- v0.4.5 streaks you can see ----------------
  // the streak each court's holders are on: yours from the moment you step up to play on it (myCourt is set when your
  // game starts and cleared when you walk off), the AI kings' otherwise. v0.4.5 quick patch fixes: myCourt used to
  // stay set after you left, so starting a game on another court lit up the old one with your streak while the new
  // one stayed dark until the tip-off; and kings who beat you inherited whatever streak the court last had.
  myStreak() { const p = this.app.char()?.progression; return (this.cup ? p?.cup?.streak : p?.park?.streak) || 0; }
  courtStreak(c) {
    if (c === this.myCourt && (this.mySession || this.mode === 'starting')) return this.myStreak();
    return c.session ? c.kingsStreak || 0 : 0;
  }
  updateStreakFX(dt) {
    for (const c of this.courts) {
      c.fx.setLevel(streakLevel(this.courtStreak(c)));
      c.fx.update(dt);
    }
  }

  // ---------------- v0.4.5 The King Tut Cup ----------------
  async refreshCup() {
    try {
      const st = await this.app.api.get('/api/cup');
      this.cupState = st;
      const name = id => id === 'me' ? this.char.name : (this.world.entry(id)?.name || id);
      const rows = [...st.board, ...(st.around || [])].map(r => ({ rank: r.rank, name: name(r.id), net: r.net, me: r.id === 'me' }));
      // the billboard shows the top five, plus you if you're further down
      const top = rows.slice(0, 5), mine = rows.find(r => r.me);
      this.venue.board?.set({ end: st.end * 1000, rows: mine && mine.rank > 5 ? [...top, mine] : rows.slice(0, 6) });
      this.ui.cupInfo?.(this, st);
    } catch (e) { /* offline: keep the last standings */ }
  }
  // ante for the next game (the server takes it when the game starts)
  anteFor() { return this.cup ? this.ante : undefined; }

  // ---------------- my games ----------------
  // oppStreak: the streak the opponents bring (the kings' when you challenge them, 0 for a fresh group)
  async startMyGame(c, opponents, oppStreak = 0) {
    const app = this.app;
    this.myCourt = c; this.myOppStreak = oppStreak || 0;
    this.mode = 'starting';
    let ticket;
    try {
      // (v0.4.7.5: kings on a streak above 6 bring their bounty: the server pays it if you break the streak)
      ticket = await app.api.mutate('/api/matches', { character_id: this.char.id, mode: 'park', venue: this.themeId, format: c.format, target: app.settings.parkTarget, difficulty: app.settings.difficulty, ante: this.anteFor(), ...(oppStreak >= BOUNTY_MIN ? { bounty_streak: Math.min(99, oppStreak) } : {}) });
      if (ticket.meta.ante) app.setBalance((app.profile.balance || 0) - ticket.meta.ante);
    } catch (e) {
      this.ui.toast(e.message, 'error'); this.mode = 'roam'; this.myCourt = null; this.unclaim(c); this.newBackgroundGame(c, opponents); return;
    }
    this.ticket = ticket;
    consumeBoostsLocal(app, ticket);
    const li = c.lines.findIndex(l => l?.mine), l0 = li >= 0 ? c.lines[li] : { members: [] };
    const mates = l0.members.map(w => w.entry);
    for (const w of l0.members) w.dispose();
    this.walkers = this.walkers.filter(w => !l0.members.includes(w));
    this.myMates = mates;
    this.myOpp = opponents;
    if (li >= 0) c.lines[li] = null;
    this.startSession(c, opponents, ticket);
  }

  async startSession(c, opponents, ticket) {
    const app = this.app;
    // v0.4.5 fix: your badges are read fresh for every game. "Run it back" used to reuse the badge tiers from when
    // you arrived at the park, so a badge upgraded in the last game still played (and showed) at its old tier.
    const meEntry = { ...this.meEntry, human: true, look: app.look(app.char()), badges: badgeTiers(app.char()) };
    meEntry.build = boostedBuild(app.char(), ticket.meta.boosts);
    const mine = [meEntry, ...this.myMates.map(e => ({ ...e, human: false }))];
    const opp = opponents.map(e => ({ ...e, human: false }));
    // v0.4.5 stage 7: everybody in your game is built over the next few frames (the park keeps running) and the
    // game starts when they're ready, instead of the whole park freezing while ten people are made at once
    for (const e of [...mine, ...opp]) e.look = e.look || resolveLook(e.build, this.catalog);
    this.mode = 'starting';
    // (you play in the athlete you walked over in: it's lent to the game, see lendMe)
    await this.pool.prebuild([...mine, ...opp].filter(e => !e.human).map(e => ({ build: e.build, look: e.look, opts: { detail: 1, faceRes: 512 } })));
    if (this.disposed) return;
    this.lendMe();
    const teams = [{ name: this.aff.name, abbr: 'YOU', color: this.aff.color }, { name: 'Court Kings', abbr: 'KNG', color: '#e8e3d8' }];
    this.myCourt = c;
    this.myOpp = opponents;
    this.mySession = new MatchSession(app, {
      mode: 'park', full: !!c.full, hub: true, pool: this.pool, scene: this.scene, venue: this.venue, court: c, rosters: [mine, opp], teams, seed: ticket.seed,
      target: ticket.meta.target, difficulty: ticket.meta.difficulty,
      onEnd: (summary, session) => this.myGameOver(summary, session),
    });
    this.mode = 'match';
    app.mode = 'match';
    music.duck(true); // v0.4.4: the soundtrack keeps going under park games
    this.ui.matchStarted(this);
    // (after the session: starting a game clears the feed)
    if (ticket.meta.ante) app.hud.pushFeed(`Ante-up: ${ticket.meta.ante.toLocaleString()} VC on the line`, 'good');
    if (ticket.meta.boosts?.length) app.hud.pushFeed(`Boosts active: ${ticket.meta.boosts.map(k => app.config.boosts?.categories?.[k]?.name || k).join(', ')} (+${app.config.boosts?.amount || 5})`, 'good');
  }

  async myGameOver(summary, session) {
    const app = this.app;
    // v0.4.4: remember who you ran with and against (social phone: recent players)
    const won0 = summary.winner === summary.me.team;
    this.world.recordGame((this.myMates || []).map(e => e.aiId).filter(Boolean), (this.myOpp || []).map(e => e.aiId).filter(Boolean), won0);
    // v0.4.3: the box-score outro shows while the result saves, then fills the Rep bar live
    // v0.4.5: who ran with you (a crew member on your team doubles the crew XP)
    const mates = (this.myMates || []).map(e => e.aiId).filter(Boolean).slice(0, 4);
    const saving = app.api.mutate(`/api/matches/${this.ticket.id}/complete`, { summary, mates }).catch(e => { this.ui.toast('Result not saved: ' + e.message, 'error'); return null; });
    await playOutro(app, { summary, session, result: saving });
    const result = await saving;
    if (result) { app.replaceChar(result.character); app.setBalance(result.balance); this.char = app.char(); }
    if (this.cup) this.refreshCup();
    const won = summary.winner === summary.me.team;
    this.ui.results(this, summary, result, won, {
      players: [...(this.myMates || []), ...(this.myOpp || [])],
      stay: () => this.stayOnCourt(session),
      leave: () => this.leaveCourt(session, won),
    });
  }

  stayOnCourt(session) {
    const c = this.myCourt;
    session.dispose(); this.mySession = null;
    // new challengers walk up: the hotter your streak, the better the people who step up
    const old = this.myOpp || [];
    this.myOpp = [];
    for (const e of old) if (this.walkers.length < 16) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] + this.rng.range(-4, 4), e); if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave(); this.walkers.push(w); }
    // v0.4.5: the group with next gets the shot at you; with nobody in line, whoever's around steps up
    const nx = this.upNext(c, false);
    let challengers;
    if (nx) { challengers = nx.l.members.map(w => w.entry); this.takeLine(c, nx.i); }
    else challengers = this.takeEntries(c.format, { topUp: true, level: Math.min(0.97, 0.5 + 0.06 * (this.char.progression?.park?.streak || 0)) });
    for (const e of challengers) e.look = e.look || resolveLook(e.build, this.catalog);
    this.myOpp = challengers; this.myOppStreak = 0; // (challengers have no streak; you're the one holding the court)
    this.mode = 'starting';
    this.app.api.mutate('/api/matches', { character_id: this.char.id, mode: 'park', venue: this.themeId, format: c.format, target: this.app.settings.parkTarget, difficulty: this.app.settings.difficulty, ante: this.anteFor() })
      .then(ticket => {
        this.ticket = ticket; consumeBoostsLocal(this.app, ticket);
        if (ticket.meta.ante) this.app.setBalance((this.app.profile.balance || 0) - ticket.meta.ante);
        this.startSession(c, challengers, ticket);
      })
      .catch(e => { this.ui.toast(e.message, 'error'); this.leaveCourt(null, false); });
  }

  leaveCourt(session, won) {
    const c = this.myCourt;
    const g = session ? session.game : null;
    if (session) session.dispose();
    this.mySession = null;
    c.mine = false;
    // teammates become park-goers again (squad mates stay with you; anyone who logged off heads home)
    for (let i = 0; i < (this.myMates || []).length; i++) {
      const e = this.myMates[i];
      const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] + 4 + i, e);
      if (this.world.inSquad(e.aiId)) w.follow = 0;
      else if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0])));
      else w.leave();
      this.walkers.push(w);
    }
    this.myMates = [];
    // court continues: whoever won keeps the court (if I won and left, fresh kings). Their streak: one more than they
    // brought if they beat you, nothing if you won and walked off (or no game was played)
    c.kingsStreak = session && !won ? (this.myOppStreak || 0) + 1 : 0;
    const opp = this.myOpp; this.myOpp = [];
    if (won && opp) for (const e of opp) if (this.walkers.length < 16) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] - 4, e); if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave(); this.walkers.push(w); }
    this.newBackgroundGame(c, won ? null : opp);
    // put me on the sideline
    this.me.setPos(c.origin[0] + 10.8, c.origin[2] + 2, -Math.PI / 2);
    // back in your roaming athlete (the one from the game, with any new gear)
    this.rebuildMe();
    this.syncSquad();
    this.myCourt = null; this.myOppStreak = 0; // you're off the court: it shows its kings' streak, not yours
    this.mode = 'roam';
    this.app.mode = 'park';
    this.rig.snap();
    this.app.hud.show(false);
    this.ui.backToRoam(this);
  }

  // v0.4.5 stage 7: your roaming athlete goes into the pool for your game or shootaround to pick up (no second
  // copy of you is built), and comes back out of it afterwards
  lendMe() { if (this.meVisual) { this.meVisual.dispose(); this.meVisual = null; } }
  rebuildMe() {
    const char = this.app.char();
    this.char = char;
    this.meEntry = { build: { ...char }, name: char.name, look: this.app.look(char), human: true, badges: badgeTiers(char) };
    if (this.meVisual) this.meVisual.dispose();
    // (usually the athlete you just played in, back from the pool)
    this.meVisual = new PlayerVisual(this.r, this.scene, char, this.meEntry.look, { detail: 1, pool: this.pool, now: true });
    this.meVisual.addRing(this.r, this.aff.color);
  }

  startPractice() {
    const app = this.app, char = app.char();
    const pr = this.venue.practice;
    const court = { id: 'practice', origin: [pr.origin[0], 0, pr.origin[2] - COURT.hoopZ + 4], hoops: [pr.hoop], format: 1 };
    this.lendMe();
    const entry = { ...this.meEntry, human: true, build: { ...char }, badges: badgeTiers(char) };
    this.practice = new MatchSession(app, { mode: 'practice', hub: true, pool: this.pool, scene: this.scene, venue: this.venue, court, rosters: [[entry], []], teams: [{ name: 'You', abbr: 'YOU', color: this.aff.color }, { name: '', abbr: '', color: '#888' }], seed: 7 });
    this.mode = 'practice';
    this.app.hud.show(true);
    this.ui.toast('Shootaround — Esc to stop');
  }
  endPractice() {
    this.practice.dispose(); this.practice = null;
    this.rebuildMe();
    this.mode = 'roam'; this.rig.snap(); this.app.hud.show(false);
  }

  onFocusLost() { if (this.mode === 'match' && this.mySession && !this.mySession.ended && !this.mySession.paused && !this.app.modalOpen()) this.ui.pauseGame(this); }
  async forfeitMyGame() {
    const s = this.mySession;
    if (!s) return;
    if (this.ticket) { try { await this.app.api.post(`/api/matches/${this.ticket.id}/cancel`, {}); } catch { /* ignore */ } }
    this.ui.toast('You left the game. Your win streak resets.');
    this.leaveCourt(s, false);
  }
  deactivate() { }
  updateSpectators(dt) {
    const cam = this.rig.pos || [this.me.x, 0, this.me.z];
    for (const sp of this.spectators) {
      const c = sp.court;
      // the court's game this frame: a background game, or yours when it's on this court
      const s = c.session || (this.mySession && this.myCourt === c ? this.mySession : null);
      if (s && s.lastEvents) sp.onEvents(s.lastEvents);
      sp.update(dt, Math.hypot(sp.p.x - cam[0], sp.p.z - cam[2]) < 45, s?.game);
    }
    for (const c of this.courts) if (c.session) c.session.lastEvents = null;
    if (this.mySession) this.mySession.lastEvents = null;
  }

  dispose() {
    this.disposed = true;
    for (const c of this.courts) if (c.fx) c.fx.dispose();
    for (const sp of this.spectators || []) sp.dispose();
    for (const w of this.walkers) w.dispose();
    for (const c of this.courts) if (c.session) c.session.dispose();
    if (this.mySession) this.mySession.dispose();
    if (this.practice) this.practice.dispose();
    if (this.meVisual) this.meVisual.dispose();
    this.pool.dispose();
  }
}

// v0.4.7.5: tiers as they play on this build (a badge above the build's cap plays at the cap)
export function badgeTiers(char) { const o = {}; for (const [k, v] of Object.entries(char.badges || {})) if (v.tier) o[k] = v.tier; return capBadges(o, char.archetype || char.height ? char : null); }
