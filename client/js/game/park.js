// The Park hub: free roam, park-goers, live AI games on every court, Got Next queues, winner stays.
// v0.4.4: everyone here is a persistent AI account from this player's world (sim/world.js). Who shows up
// depends on who is online at this park right now; people arrive and log off as you play, your squad
// follows you around and runs with you, and every game is remembered for the social phone.
import { playOutro } from '../ui/outro.js';
import { music } from '../core/music.js';
import { promptGlyph } from '../core/input.js';
import { Scene } from '../gfx/renderer.js';
import { buildVenue } from '../world/venues.js';
import { releaseScene } from '../world/release.js';
import { AFFILIATIONS, THEMES, EVENTS, courtPlayRect, SQUAD_ROWS, parkInfo } from '../world/themes.js';
import { StreakFX, streakLevel } from '../world/streakfx.js';
import { boostedBuild } from '../sim/ratings.js';
import { consumeBoostsLocal } from '../ui/rewards.js';
import { Player } from '../sim/player.js';
import { COURT, DT } from '../sim/constants.js';
import { RNG, hashString } from '../core/rng.js';
import { resolveLook, makeBot } from '../sim/bots.js';
import { capBadges } from '../sim/builds.js';
import { PlayerVisual, MatchSession } from './session.js';
import { GAME_SPEED } from '../sim/game.js';
import { VisualPool } from './vispool.js';
import { audio } from '../core/audio.js';
import * as M from '../core/math.js';
import { BOUNTY_MIN, bountyFor, worldNow } from '../sim/world.js';
import { myEntry, personOf, setupEntry, seatPeople, inputDelay, newSeed, crewMatesIn, reportCrewXP, squadAIPlayers } from '../ui/online.js';
import { endWinStreak } from './iconfx.js';
import { MAX_ICONS_PER_AI_TEAM, isIconEntry } from '../sim/iconsquad.js';
import { ParkLink } from './parklink.js';
import { validAI, stepCost, TICK_UNITS } from './parkdirector.js';
import { WORLD_CLOCK } from '../sim/world.js';
import { Game } from '../sim/game.js';
import { spreadGreens } from '../sim/bots.js';
import { blankIntent } from '../sim/player.js';
import { normIntent, intentDelta, takeInputs } from '../sim/wire.js';
import { RecordTags } from './recordtag.js';

// v0.4.8.6 the ICON Squad: after their hour, the three don't drift back in one by one for a while (they just walked out);
// their team on the scoreboard, the ticker and the court cards
const ICON_COOL = 30 * 60000, NO_IDS = new Set();
const SPOT_R = 0.75; // (v0.4.8.8: standing on a GOT NEXT circle: within this of it, you or an AI alike)
const ICON_TEAM = { name: 'ICON Squad', abbr: 'ICN', color: '#f4f2ec' };

// ---------- layout + geometry helpers ----------
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

export const OVERVIEW_NEAR = 3; // (m) the camera's near plane while the court overview is up (0.1 otherwise)

// ---------- park-goers: walkers, your squad, online peers ----------
export class Walker {
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
    // v0.4.7.5 qp3: straight there, with corner waypoints around the shops, the wheel and any court with a game on
    // it. It used to send everyone round through the south plaza whenever either end was anywhere near the courts,
    // so a squad standing next to you on a Got Next spot ran off to the edge of the park and back before it lined up
    const p = this.p;
    this.path = this.hub.routeAround(p.x, p.z, [{ x, z }], this.hub.blockers(this));
    this.state = 'walk';
    this.prog = { d: Infinity, t: 0 };
  }
  update(dt) {
    const p = this.p, it = p.intent;
    it.mx = 0; it.mz = 0; it.sprint = false; it.face = null;
    // (v0.4.8.7: a park-goer as the park's host has him, ParkHub.onPop: he goes where he is on the host's screen)
    const T = this.mirror;
    if (T) {
      if (this.visual.pending) { p.setPos(T.x, T.z, T.f); return; }
      const dx = T.x - p.x, dz = T.z - p.z, d = Math.hypot(dx, dz);
      if (d > (T.nj ? 22 : 6)) p.setPos(T.x, T.z, T.f); // (nj: one of the ICON Squad falling in behind his leader runs over)
      else if (d > 0.12) { const k = Math.min(1, Math.max(0.15, (T.m || 0) + (d - 0.4) * 0.6)); it.mx = dx / d * k; it.mz = dz / d * k; it.sprint = !!T.s && d > 0.4; } // (his pace there, a touch quicker to catch up)
      else it.face = T.f;
      p.move(dt * GAME_SPEED, false, 0); p.stamina = 1;
      return;
    }
    if (this.visual.pending) return; // still being built (a few frames): he walks in once he's there
    // (v0.4.8.6 ICON Squad: his leader walked out of the park: so does he, with him)
    if (this.lead && (this.lead.gone || this.lead.disposed)) { if (this.exit) { this.gone = true; return; } this.lead = null; }
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
    } else if (this.lead && !this.spot && !this.lead.spot) {
      // v0.4.8.6 ICON Squad: off a Got Next spot, the other two keep a step behind their leader (walking in, round the
      // park, and out of it), one to each side
      const L = this.lead.p, f = L.facing, lat = (this.unitSlot % 2 ? 1 : -1) * 0.95;
      const tx = L.x - Math.sin(f) * 1.35 + Math.cos(f) * lat, tz = L.z - Math.cos(f) * 1.35 - Math.sin(f) * lat;
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d > 22) p.setPos(tx, tz, f);
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
    // (qp3 perf: posed only when he can be seen, every other frame from far away: ParkHub.animDt)
    const k = this.hub.animDt ? this.hub.animDt(this, dt, p.x, p.z) : dt;
    this.visual.setCulled?.(k < 0);
    if (k < 0) return;
    if (k === 0) this.visual.view.move?.(p.x, 0, p.z, p.facing);
    else this.visual.anim.update(k, { x: p.x, y: 0, z: p.z, facing: p.facing }, p, null, null, {});
    this.visual.place(p.x, 0, p.z);
  }
  dispose() { this.disposed = true; this.visual.dispose(); }
}

// v0.4.7.5 qp3 online: a real player at this park (or Crew HQ), walking it on his own screen (his position comes ~5
// times a second through the hosted game)
export class FriendWalker extends Walker {
  constructor(hub, entry, x, z, id) {
    super(hub, entry, x, z);
    this.id = id; this.username = entry.username || ''; this.target = { x, z, f: 0, m: 0 }; this.seen = performance.now();
    // v0.4.8.5 quick patch 3: an ICON build walks with his Icon badge under him (a white ring round it) and his aura
    this.visual.addIcon?.(hub.r, '#f4f2ec');
  }
  update(dt) {
    const p = this.p, it = p.intent, T = this.target;
    it.mx = 0; it.mz = 0; it.sprint = false; it.face = null;
    if (this.visual.pending) { p.setPos(T.x, T.z, T.f); return; }
    const dx = T.x - p.x, dz = T.z - p.z, d = Math.hypot(dx, dz);
    if (d > 6) p.setPos(T.x, T.z, T.f);
    else if (d > 0.12) { const k = Math.min(1, d / 0.5); it.mx = dx / d * k; it.mz = dz / d * k; it.sprint = T.m > 4.5 && d > 0.4; }
    else it.face = T.f;
    p.move(dt * GAME_SPEED, false, 0);
    p.stamina = 1;
    // (v0.4.8.7 qp7: a celebration he started on his screen plays out here: Peers.emote)
    if (p.action) { p.action.t += dt; if (p.action.t > p.action.dur) p.action = null; }
  }
}

// v0.4.7.5 qp3 online: the real people walking around where you are (a park or the Crew HQ). world: the ParkHub or
// CrewHQ (it has app, r, scene, pool, rng and placeKey()); positions come in through the hosted game (ui/online.js)
// v0.4.7.5 qp3 online: an AI squad mate a real player brought from his own game, a step behind him on your screen (or
// on his squad's Got Next spot: world.followerSpot)
export class PeerFollower extends Walker {
  constructor(hub, entry, owner, slot, aiId) {
    super(hub, entry, owner.p.x - 1.2, owner.p.z - 1.2);
    this.owner = owner; this.slot = slot; this.aiId = aiId;
  }
  update(dt) {
    const p = this.p, it = p.intent, o = this.owner.p;
    it.mx = 0; it.mz = 0; it.sprint = false; it.face = null;
    if (this.visual.pending) return;
    const f = o.facing, slot = this.slot, spot = this.hub.followerSpot?.(this) || null;
    const back = 1.5 + Math.floor(slot / 2) * 1.2, lat = (slot % 2 ? 1 : -1) * (0.85 + Math.floor(slot / 2) * 0.3);
    const tx = spot ? spot.x : o.x - Math.sin(f) * back + Math.cos(f) * lat, tz = spot ? spot.z : o.z - Math.cos(f) * back - Math.sin(f) * lat;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 22) p.setPos(tx, tz, f);
    else if (d > 0.35) { const k = Math.min(1, d / 1.4) * (d > 3.5 ? 1 : 0.62); it.mx = dx / d * k; it.mz = dz / d * k; it.sprint = d > 4.5; }
    else it.face = spot && spot.face != null ? spot.face : f;
    p.move(dt * GAME_SPEED, false, 0);
    for (const s of this.hub.venue.solids || []) pushOut(p, s);
    p.stamina = 1;
  }
}

// v0.4.7.5 qp3 online: the real people walking around where you are (a park or the Crew HQ), and the AI squad mates
// each of them brought from his own game. world: the ParkHub or CrewHQ (it has app, r, scene, pool, rng and
// placeKey()); positions come in through the hosted game (ui/online.js)
export class Peers {
  constructor(world) {
    this.w = world; this.map = new Map(); this.fol = new Map(); this.withAI = !!world.parkList; // (AI squads walk with their owners in the parks)
    // (v0.4.8.7 qp7: their celebrations, as the service relays them: server/online.py emote)
    this.offEmote = world.app?.net?.on?.('emote', m => this.emote(m)) || null;
  }
  // someone here celebrated: he plays it where he stands (the animation the service named for the item he has on)
  emote(m) {
    const net = this.w.app.net, w = m && this.map.get(m.from);
    if (this.w.disposed || !w || !net || net.place !== this.w.placeKey?.() || typeof m.kind !== 'string') return false;
    w.p.startAction('celebrate', Math.max(0.5, Math.min(3, +m.dur || 1.6)), { kind: m.kind });
    return true;
  }
  detach() { this.offEmote?.(); this.offEmote = null; this.clear(); }
  get size() { return this.map.size; }
  list() { return [...this.map.values()]; }
  followers() { return [...this.fol.values()]; }
  pos(m) {
    const net = this.w.app.net;
    if (!net || net.place !== this.w.placeKey() || !m.from) return;
    let w = this.map.get(m.from);
    if (!w) {
      const person = net.people.get(m.from), e = person?.entry;
      if (!e?.build) return;
      const entry = { ...e, look: e.look || resolveLook({ ...e.build, name: e.name }, this.w.app.catalog) };
      w = new FriendWalker(this.w, entry, +m.x || 0, +m.z || 0, m.from);
      w.username = person.username || '';
      w.squad = !!net.squad?.members.some(x => x.id === m.from);
      this.map.set(m.from, w);
    }
    w.target = { x: +m.x || 0, z: +m.z || 0, f: +m.f || 0, m: +m.m || 0 };
    w.seen = performance.now();
    this.syncFollowers(m.from, w, net.people.get(m.from)?.ai || []);
  }
  // his AI squad mates walk with him (the ones he has now)
  syncFollowers(id, w, ai) {
    if (!this.withAI) return;
    const key = ai.map(a => a.id).join(',');
    if (w.aiKey === key) return;
    w.aiKey = key;
    for (const [k, f] of this.fol) if (f.owner === w && !ai.some(a => `${id}:${a.id}` === k)) { f.dispose(); this.fol.delete(k); }
    ai.forEach((a, i) => {
      const k = `${id}:${a.id}`;
      let f = this.fol.get(k);
      if (!f && a.entry?.build) {
        const entry = { ...a.entry, look: a.entry.look || resolveLook(a.entry.build, this.w.app.catalog) };
        f = new PeerFollower(this.w, entry, w, i, a.id);
        this.fol.set(k, f);
      }
      if (f) f.slot = i;
    });
  }
  // someone left (gone) or has a new look (pentry: he's rebuilt with his next position); 'here': whoever isn't here
  people(m) {
    if (m?.t === 'gone' || m?.t === 'pentry') { this.drop(m.id); return; }
    const net = this.w.app.net;
    for (const id of [...this.map.keys()]) if (!net?.people.has(id)) this.drop(id);
  }
  drop(id) {
    const w = this.map.get(id);
    if (!w) return;
    for (const [k, f] of this.fol) if (f.owner === w) { f.dispose(); this.fol.delete(k); }
    w.dispose(); this.map.delete(id);
  }
  clear() { for (const id of [...this.map.keys()]) this.drop(id); }
  frame(dt) {
    const now = performance.now();
    for (const [id, w] of this.map) {
      if (now - w.seen > 4000) { this.drop(id); continue; } // (gone quiet: in a game, a menu, or gone)
      w.update(dt); w.render(dt);
    }
    for (const f of this.fol.values()) { f.update(dt); f.render(dt); }
  }
}

// ---------- spectators ----------
// v0.4.5: people watching the games from the benches and sidelines. They react to what happens on the court
// in front of them: a dunk, a poster or a deep three gets them up (or arms up on the bench), a block or an
// ankle-breaker gets hands on heads, ordinary buckets get a clap. They animate only when you're close.
class Spectator {
  constructor(hub, court, x, z, facing, sit) {
    this.hub = hub; this.court = court; this.sit = sit;
    const R = this.rng = hub.specRng || hub.rng; // (v0.4.8.7: the same people on the benches on every screen)
    const bot = makeBot(R, { level: R.range(0.2, 0.8) });
    this.p = new Player(0, 0, { build: bot.build, name: bot.name }, hub.app.catalog);
    this.p.setPos(x, z, facing);
    this.visual = new PlayerVisual(hub.r, hub.scene, bot.build, resolveLook(bot.build, hub.catalog), { detail: 0.6 });
    this.base = sit ? 'sit' : 'idle';
    this.react = null; this.reactT = 0; this.cool = R.range(0, 1);
    this.look = R.range(-0.35, 0.35); // where along the court he's looking
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
    const rng = this.rng;
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
    // (qp3 perf: posed only when he can be seen, every other frame from far away)
    const k = this.hub.animDt ? this.hub.animDt(this, dt, p.x, p.z) : near ? dt : -1;
    if (this.hub.animDt) this.visual.setCulled?.(k < 0);
    if (k > 0) this.render(k);
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

// ---------- your own game, sent out to the park ----------
// v0.4.8.7 qp4: your own game at a park (you alone there when it began: the AI with you and against you), out to everyone
// else at the park as it's played (server/online.py local_*): its setup, then every tick's input as the change from the tick
// before (sim/wire.js: a byte or two a tick, sent ten times a second), with the auto-play switch and your Lock-In grade
// (the game reads both) and every 2 s its state hash. Your game gets the input exactly as it goes out (normIntent: the
// stick to 1/1000, as in an online game), so theirs (ParkHub.localWatch) is the same game, tick for tick. It costs your game
// nothing: no waiting on anyone, the sending is a few hundred bytes a second
const BLANK_IT = blankIntent();
export class LocalPub {
  constructor(net) { this.net = net; this.k = 0; this.last = {}; this.buf = []; this.at = 0; this.on = false; this.done = false; }
  begin(setup) { if (this.done || this.on) return; this.on = true; this.net.send({ t: 'lstart', setup }); }
  // every tick: the input the game gets (null: none this tick, the game keeps the last one: so does theirs)
  take(g, intent) {
    const n = intent ? normIntent(intent) : null, { _a, _l, _h, _k, ...was } = this.last;
    const rec = { ...(n || was), ...(n ? {} : { _k: 1 }), _a: g.assist ? 1 : 0, ...(g.lockIn ? { _l: g.lockIn.idx } : {}) };
    if (++this.k % 120 === 0) rec._h = g.stateHash();
    this.buf.push(intentDelta(this.last, rec)); this.last = rec;
    this.flush();
    return n && { ...BLANK_IT, ...n };
  }
  flush(force = false) {
    if (!this.on || !this.buf.length) return;
    const now = performance.now();
    if (!force && now - this.at < 100) return;
    this.net.send({ t: 'lin', k: this.k - this.buf.length + 1, b: this.buf });
    this.buf = []; this.at = now;
  }
  stop() { if (this.done) return; this.flush(true); if (this.on) this.net.send({ t: 'lstop' }); this.done = true; this.on = false; }
}

// ---------- director courts ----------
// v0.4.8.7 a court's game in the director's park (ParkHub.dirCourts): the director's own game (parkdirector.js CourtRunner,
// stepped by game/parklink.js), drawn by a background MatchSession only while the court can be seen (no athletes built for a
// court nobody's looking at: they go back to the pool 4 s after it's out of sight). It stands in for c.session: game, opts
// (rosters, teams, seed), teams, lastEvents for the spectators
class DirCourt {
  constructor(hub, c, run, g) {
    this.dir = true; this.hub = hub; this.c = c; this.run = run; this.game = run.game; this.seed = g.seed;
    const team = (u, d0) => (u ? { ...ICON_TEAM } : d0);
    this.teams = [team(g.tm?.[0], { name: 'Kings', abbr: 'KNG', color: '#ffd84a' }), team(g.tm?.[1], { name: 'Challengers', abbr: 'CHL', color: '#ff5a36' })];
    this.opts = { rosters: run.entries.map(r => r.map(e => ({ ...e, look: e.look || resolveLook(e.build, hub.catalog) }))), teams: this.teams, seed: g.seed };
    this.view = null; this.hidT = 0; this.rate = 1; this.lastEvents = null;
  }
  get ended() { return !!this.game.over; }
  frame(dt) {
    const hub = this.hub, run = this.run;
    if (hub.courtSeen(this.c) && run.u >= hub.link.dir.k * TICK_UNITS) this.hidT = 0; else this.hidT += dt; // (a game still replaying to the present: not yet)
    if (!this.view && this.hidT === 0) {
      const v = this.view = new MatchSession(hub.app, { background: true, hub: true, pool: hub.pool, mode: 'park', full: !!this.c.full, scene: hub.scene, venue: hub.venue, court: this.c, rosters: this.opts.rosters, teams: this.teams, seed: this.seed, target: 11, difficulty: 0.6, assist: true });
      v.game = this.game; v.game.teamsMeta = this.teams; // (its players drawn from the director's game: the same rosters, the same order)
      v.animDt = (o, d0, x, z, r) => hub.animDt(o, d0, x, z, r);
      run.keep = true; run.events.length = 0;
    } else if (this.view && this.hidT > 4) { this.view.dispose(); this.view = null; run.keep = false; run.events.length = 0; }
    const evs = run.keep ? run.take() : [];
    this.lastEvents = evs.length ? evs : null;
    const v = this.view;
    if (!v) return;
    v.backgroundEvents(evs); v.frameEvents = evs;
    v.acc = DT * hub.link.alpha(run);
    this.rate = 6 / stepCost(this.game); // (the pace it's played at: animated at its own pace)
    v.render(dt * this.rate);
  }
  dispose() { if (this.view) this.view.dispose(); this.view = null; this.run.keep = false; this.disposed = true; }
}

// ---------- the park hub (scene, population, courts, Got Next, input, per-frame update) ----------
export class ParkHub {
  constructor(app, themeId, ui) {
    this.app = app; this.r = app.renderer; this.ui = ui;
    this.themeId = themeId;
    this.peers = new Peers(this); // v0.4.7.5 qp3 online: the real people at this park
    this.scene = new Scene();
    this.theme = THEMES[themeId];
    music.setPlaylist(this.theme?.music || 'main'); // (v0.4.8.5 quick patch: an event park with a soundtrack of its own plays only that)
    // v0.4.7.5 qp3: the Event Park hall's sign names the running event (or, at an event park, your home park)
    const evOn = app.config?.event && EVENTS[app.config.event.id] ? EVENTS[app.config.event.id] : null, home = AFFILIATIONS[app.char()?.affiliation];
    this.venue = buildVenue(this.r, this.scene, themeId, { eventName: evOn?.park, eventColor: evOn?.color, eventAccent: evOn?.accent, homeName: home?.park, homeColor: home?.color });
    this.aff = parkInfo(themeId) || AFFILIATIONS.harbor;
    this.cup = !!this.theme?.event; // v0.4.5 The King Tut Cup / v0.4.7.5 qp3 any park event: every game is an ante-up
    this.event = this.cup ? (EVENTS[themeId] || null) : null;
    this.ante = null; this.cupState = null; this.cupT = 0;
    this.rng = new RNG((Date.now() & 0xffff) ^ 0x5a5a);
    // (v0.4.8.7: the people on the benches are the same on every screen: their own seed, from the park and the world)
    this.specRng = new RNG((hashString(`${themeId}|spectators`) ^ (app.ai?.seed || 1)) >>> 0);
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
    // (v0.4.8.6: you came in during the ICON Squad's hour here: they're on a court already)
    this.icon = null; this.iconT = 2;
    this.squadTick(Date.now(), true);
    for (const c of this.courts) if (!c.session) this.newBackgroundGame(c, null);
    for (const id of this.availableHere().slice(0, 9)) {
      const z = this.pickZone(), q = pickIn(this.rng, z);
      this.walkers.push(this.spawnWalker(q.x, q.z, this.entryFor(id)));
    }
    this.popT = 15;
    this.syncSquad(true);
    this.spectators = this.spawnSpectators();
    // v0.4.5 stage 7: every court's streak effect is built now (hidden until a 3-game streak) so its geometry
    // and shaders are ready, instead of being built in the middle of somebody's game
    for (const c of this.courts) c.fx = new StreakFX(this.r.ctx, this.scene, c, this.theme?.streakFx || (this.cup ? 'laser' : 'flame'));
    this.pool.flush(); // (we're loading: everybody who's here at the start is here on the first frame)
    this.rig = app.cameraRig;
    this.rig.roamYaw = 0; this.rig.snap();
    this.claimT = 0; this.claimCourt = null;
    this.mySession = null; this.practice = null;
    this.prompt = '';
    audio.setCrowd(0.1); audio.setIndoor(false);
    audio.surface = 'asphalt';
    this.r.prewarm(this.scene); // v0.4.5 stage 7: compile every shader the park needs while it loads
    this.dirListen(); // (v0.4.8.7: online with the park director on, the server's park: dirSync)
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
  // v0.4.7.5 qp3: what a walker has to go round: the solids, plus every court with a game on it (a squad mate of
  // yours, or a man walking off after a loss, may cross; the court his own Got Next spot is on is fine to skirt)
  blockers(w) {
    const out = [...(this.venue.solids || [])];
    if (w && (w.follow != null || w.leaving > 0)) return out;
    for (const c of this.courts) if (c.session || c.mine || c.live || this.realBusy?.(c)) out.push(c.rect);
    return out;
  }
  // v0.4.8.7 qp2: a court with a game in progress on it: an AI game (c.session, the director's DirCourt included), a game
  // you're watching live (c.live) or real players' hosted game (realBusy). Not a court you've only got next on.
  gameOn(c) { return !!(c.session || c.live || this.realBusy?.(c)); }
  // v0.4.8.7 qp2: real players can't walk onto a game in progress any more than the park-goers can (Walker.update). The
  // court's edge (the playing surface plus its 0.6 m apron, courtPlayRect) is a wall to anyone walking in. Someone already
  // standing on it when the game began is eased off to the nearest edge at a walk (3 m/s), never snapped across the
  // court, and can't go deeper. Your own position goes out to the others' screens, so everyone sees you stay off it.
  keepOffCourts(p, px, pz, dt) {
    const r = p.phys.radius, inside = (b, x, z) => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r;
    const depth = (b, x, z) => Math.min(x - (b.x0 - r), (b.x1 + r) - x, z - (b.z0 - r), (b.z1 + r) - z);
    for (const c of this.courts) {
      if (c === this.myCourt || !this.gameOn(c)) continue; // (your own game's court is yours to walk onto)
      const b = c.rect;
      if (!inside(b, p.x, p.z)) continue;
      if (!inside(b, px, pz)) { pushOut(p, b); continue; }
      if (depth(b, p.x, p.z) > depth(b, px, pz)) { p.x = px; p.z = pz; }
      const dl = p.x - (b.x0 - r), dr = (b.x1 + r) - p.x, dn = p.z - (b.z0 - r), df = (b.z1 + r) - p.z, m = Math.min(dl, dr, dn, df), step = Math.min(m, 3 * dt);
      if (m === dl) p.x -= step; else if (m === dr) p.x += step; else if (m === dn) p.z -= step; else p.z += step;
    }
  }
  // v0.4.5: add corner waypoints so a path goes around the shops and the wheel instead of into them
  // (v0.4.7.5 qp3: and around the live courts, so nobody needs the long way round through the plaza)
  routeAround(x, z, path, solids = this.venue.solids || []) {
    const out = [];
    let ax = x, az = z;
    for (const w of path) {
      for (let guard = 0; guard < 6; guard++) {
        const hit = solids.map(s0 => grow(s0, 0.7)).find(b => segHitsBox(b, ax, az, w.x, w.z));
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
      for (const z of this.specRng.shuffle(seats).slice(0, n)) out.push(new Spectator(this, c, bx, z, Math.PI / 2, true));
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
    // v0.4.7.5 qp3: from 100 m up, the depth buffer's 0.1 m near plane can't tell the court floor from the ground
    // (5 mm) or from the Cup's neon lines (6 mm) a hundred metres away, so they flickered against each other. With
    // nothing nearer than the courts, the near plane moves out to OVERVIEW_NEAR for the overview (30x the depth
    // precision) and back when it ends
    const cam = this.app.camera;
    if (cam) { if (on) { this.nearKeep = cam.near; cam.near = OVERVIEW_NEAR; } else if (this.nearKeep != null) { cam.near = this.nearKeep; this.nearKeep = null; } }
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
    const s = c === this.myCourt && this.mySession ? this.mySession : c.live || c.session, g = s?.game;
    const streak = this.courtStreak(c), my = this.myLine(), mine = c === this.myCourt && !!this.mySession;
    // v0.4.7.5 qp3 online: real people on it, holding it, or with next on it (a game you came too late to watch: its score)
    const ct = this.ct(c), busy = ct?.busy && !s ? ct.busy : null, sq = this.squadLine();
    const claims = c.lines.filter(l => l?.remote).map(l => l.remote.names.join(', '));
    return {
      name: c.name, live: !!g && !g.over || !!busy, over: !!g?.over, score: g ? [g.score[0], g.score[1]] : busy?.score || null, target: g?.target || null,
      teams: s ? [s.teams?.[0]?.abbr || 'KNG', s.teams?.[1]?.abbr || 'CHL'] : busy ? ['', ''] : null,
      streak, bounty: mine ? 0 : bountyFor(streak), myStreak: mine,
      waiting: c.lines.filter(Boolean).length,
      next: my && my.c === c ? this.myTurn(c, my) : sq && sq.c === c ? 'squad' : null,
      people: busy ? busy.names.join(', ') : c.liveSetup ? Object.values(c.liveSetup.names || {}).join(', ') : '',
      kings: ct?.kings && !mine ? ct.kings.names.join(', ') : '', claims,
      icon: this.unitAt(c), // (v0.4.8.6: the ICON Squad on it: 'kings', 'challengers', 'you' (your game) or 'next' (Got Next))
    };
  }
  // where your line stands: next, after the other squad, or still filling up
  myTurn(c, my) {
    const rc = this.remoteClaimLine(c), myAt = this.ct(c)?.lines?.[my.r]?.at;
    if (rc && myAt != null && rc.claim.at < myAt) return 'after';
    if (this.realKings(c) && !this.lineFull(c, my.l)) return 'filling';
    return this.nextLine(c)?.l === my.l ? 'next' : this.nextLine(c) ? 'after' : 'filling';
  }

  // ---------- v0.4.7.5 qp3 perf: animate only what the camera can see ----------
  // A park is sixty-odd people, and posing one (the animator and the skeleton) is the biggest thing the CPU does each
  // frame. Whoever is out of the camera's view isn't posed at all (his time adds up for when he's back in view: the
  // view is last frame's, close enough), and whoever is past the far-model distance (QUALITY lod) is posed every other
  // frame, half of them on each, and only moved on the frames between.
  viewTick() {
    const cam = this.app.camera;
    if (!cam?.viewProj) { this.vis = null; return; }
    const v = this.vis || (this.vis = { planes: new Float32Array(24), eye: [0, 0, 0], n: 0, far2: 0 });
    M.frustumPlanes(v.planes, cam.viewProj);
    v.eye = cam.pos; v.n++;
    const far = (this.r.q?.lod || 22) * (this.r.lodScale || 1);
    v.far2 = far * far;
  }
  // the time to pose o with this frame: > 0 pose him (all the time since the last), 0 just move him, -1 nothing (out of
  // view). x, z: where he is; r: how big he is (a court is a big one)
  animDt(o, dt, x, z, r = 1.3) {
    o.animAcc = Math.min(0.5, (o.animAcc || 0) + dt);
    const v = this.vis;
    if (v && !this.overview && o.animPosed) { // (anyone new is posed once first, wherever he is)
      if (!M.sphereInFrustum(v.planes, x, 1, z, r + 1.5)) return -1;
      const dx = x - v.eye[0], dz = z - v.eye[2];
      if (dx * dx + dz * dz > v.far2 + r * r && ((v.n + (o.animPhase ?? (o.animPhase = v.n & 1))) & 1)) return 0;
    }
    o.animPosed = true;
    const t = o.animAcc;
    o.animAcc = 0;
    return t;
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
    // (qp3 perf: while you play, the games you can't see barely move: your own game gets the PC, and online everyone
    // waits on the slowest screen)
    if (!this.courtWatched(c)) return this.mode === 'match' ? 0.35 : 2.6;
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
    for (const id of this.squadInGame || []) s.add(id); // (v0.4.7.5 qp3 online: your AI squad mates in a game with friends)
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
  // still on (v0.4.8.6: one of the ICON Squad goes where his squad runs, and once their hour here is up he's on his way
  // out with them)
  stays(e, t = Date.now()) {
    const id = e?.aiId;
    if (!id) return true;
    if (this.dirOn()) { const d = this.link.dir; return d.stays(id, d.tl(d.k)); }
    const sq = this.world.squadOf?.(id, t);
    if (sq) return sq.park === this.themeId;
    if (this.icon?.formed && this.iconIds(t).has(id)) return false;
    return this.world.online(id, t);
  }
  // online at this park and not already doing something here (v0.4.8.6: and never one of the ICON Squad on his own)
  availableHere(t = Date.now()) {
    if (this.dirOn()) { const d = this.link.dir, mine = new Set([...this.world.squad, ...this.dirHold.keys(), ...this.busyIds()]); return d.availableHere(d.tl(d.k)).filter(id => !mine.has(id)); } // (v0.4.8.7: the director's, less what you've just taken)
    const busy = this.busyIds(), squad = new Set(this.world.squad), icon = this.iconIds(t), theirs = this.peerAIIds();
    const ids = this.world.onlineAt(this.themeId, t);
    return ids.filter(id => !busy.has(id) && !squad.has(id) && !icon.has(id) && !theirs.has(id));
  }
  // n players for a court: people around first (closest to a wanted level when asked), then free park-goers;
  // topUp: if the park is too quiet, regulars who are about to come on "hop on early". v0.4.8.6: no AI team but the
  // ICON Squad ever has three ICONs: once this one has MAX_ICONS_PER_AI_TEAM (counting the teammates it has already:
  // opts.have) the next ICON is passed over; nobody is used up (a walker, an early hop-on) unless the team comes together
  takeEntries(n, opts = {}) {
    const t = Date.now(), ex = opts.exclude || new Set();
    let ids = this.rng.shuffle(this.availableHere(t).filter(id => !ex.has(id)));
    if (opts.level != null) ids = ids.map(id => [id, Math.abs(this.world.account(id).level - opts.level) + this.rng.range(0, 0.15)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const free = opts.walkers === false ? [] : this.walkers.filter(w => !w.spot && w.follow == null && !w.exit && w.unit == null && w.entry.aiId);
    if (!opts.topUp && ids.length + free.length < n) return null;
    let icons = (opts.have || []).filter(isIconEntry).length;
    const fits = e => { if (!isIconEntry(e)) return true; if (icons >= MAX_ICONS_PER_AI_TEAM) return false; icons++; return true; };
    const out = [], used = [], hop = [];
    for (const id of ids) { if (out.length >= n) break; if (fits(this.world.entry(id, t))) out.push(this.entryFor(id)); }
    for (const w of free) { if (out.length >= n) break; if (fits(w.entry)) { out.push(w.entry); used.push(w); } }
    if (out.length < n) {
      const ex2 = new Set([...ex, ...this.busyIds(), ...out.map(e => e.aiId), ...this.world.squad, ...this.iconIds(t), ...(this.dirOn() ? this.link.dir.busy() : [])]);
      for (const id of this.world.closestOffline(this.themeId, n - out.length + MAX_ICONS_PER_AI_TEAM + 1, t, ex2)) { if (out.length >= n) break; if (fits(this.world.entry(id, t))) { hop.push(id); out.push(this.entryFor(id)); } }
    }
    if (out.length < n) return null;
    for (const w of used) w.dispose();
    if (used.length) this.walkers = this.walkers.filter(x => !used.includes(x));
    for (const id of hop) this.world.extra.set(id, { park: this.themeId, until: t + 25 * 60000 });
    return out;
  }
  // people come and go: logged-off park-goers head out, idle courts fill up, new arrivals walk in
  populationTick() {
    const t = Date.now();
    for (const [id, x] of this.world.extra) if (x.until < t) this.world.extra.delete(id);
    for (const w of this.walkers) if (w.entry.aiId && !w.spot && w.follow == null && !w.exit && w.unit == null && !this.stays(w.entry, t)) w.leave(); // (the ICON Squad goes as one: unitDone)
    for (const c of this.courts) if (!c.session && !c.mine && !c.live) this.newBackgroundGame(c, null);
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
    // v0.4.8.6: a squad mate whose ICON Squad's hour has begun leaves you to run with them (wherever he is: following
    // you, on your spot, or in your game: he finishes that first)
    for (const id of this.lastActive || []) if (!active.includes(id) && this.world.squadOf?.(id) && !this.iconLeft?.has(id)) { (this.iconLeft ||= new Set()).add(id); this.ui.toast(`${this.world.entry(id).name} left to run with his ICON squad.`); }
    this.lastActive = active.slice();
    for (const w of this.walkers) if (w.follow != null && !active.includes(w.entry.aiId)) { w.follow = null; w.state = 'idle'; w.t = 1; }
    const busy = this.busyIds();
    active.forEach((id, i) => {
      let w = this.walkers.find(x => x.entry.aiId === id);
      if (w && w.unit != null) { for (const x of this.walkers) if (x.lead === w) { x.lead = null; if (x.exit) x.leave(); } w.unit = null; w.lead = null; } // (back in your squad after their hour)
      if (w) { if (!w.spot) { w.follow = i; w.exit = false; } return; }
      if (busy.has(id)) return; // finishing a game on one of the courts: he comes over when it ends
      const me = this.me, near = initial;
      w = this.spawnWalker(near ? me.x - 1.5 - i : this.rng.range(-30, 30), near ? me.z - 1.2 : -30.5, this.entryFor(id));
      w.follow = i;
      this.walkers.push(w);
      if (!initial) { const from = this.world.status(id)?.park; this.ui.toast(`${w.entry.name} is on his way${from && from !== this.themeId ? ' over from ' + (parkInfo(from)?.park || 'another park') : ''}.`); }
    });
    this.dirSquad(active); // (v0.4.8.7: the director's park keeps them out of everyone's games: they're with you)
  }
  // the social phone's park list: everyone online at this park, with what they're up to
  parkList() {
    const t = Date.now(), out = [], seen = new Set(), u = this.iconLive(t) ? this.icon : null;
    // (v0.4.8.6: the ICON Squad's three carry its window: iconSquad)
    const add = (e, where, extra = {}) => { if (!e?.aiId || seen.has(e.aiId)) return; seen.add(e.aiId); out.push({ id: e.aiId, entry: e, where, ...extra, ...(u?.ids.has(e.aiId) ? { iconSquad: u.k } : {}) }); };
    const tag = es => this.isUnit(es) ? ' · ICON Squad' : '';
    if (this.mode === 'match' && this.mySession) { (this.myMates || []).forEach(e => add(e, 'Running with you', { mine: 'mate' })); (this.myOpp || []).forEach(e => add(e, `Across from you${tag(this.myOpp)}`, { mine: 'opp' })); }
    for (const w of this.walkers) if (w.follow != null) add(w.entry, 'In your squad', { squad: true });
    for (const c of this.courts) {
      if (c.session) c.session.opts.rosters.forEach((r, ti) => r.forEach(e => add(e, `Playing on ${c.name}${tag(r)}${ti === 0 && c.kingsStreak ? ` · ${c.kingsStreak}-game streak` : ''}`)));
      c.lines.forEach(l => { if (l) l.members.forEach(w => add(w.entry, l.mine ? `Got next with you on ${c.name}` : `Got next on ${c.name}${l.icon != null ? ' · ICON Squad' : ''}`)); });
    }
    for (const w of this.walkers) if (!w.exit) add(w.entry, w.unit != null ? 'ICON Squad · looking for a game' : w.watch ? 'Watching the games' : 'Hanging out');
    for (const id of this.availableHere(t)) add(this.world.entry(id), 'On the sidelines');
    if (u) for (const id of u.ids) add(this.world.entry(id, t), 'ICON Squad · on the way'); // (one of them is finishing a game somewhere first)
    return out;
  }

  spawnWalker(x, z, entry) {
    entry = entry || this.takeEntries(1, { topUp: true, walkers: false })[0];
    entry.look = entry.look || resolveLook(entry.build, this.catalog);
    const w = new Walker(this, entry, x, z);
    if (this.rng.next() < 0.4) w.watch = { x: this.rng.pick(this.venue.courts).origin[0], z: 6 };
    return w;
  }

  newBackgroundGame(c, kings, force = false) {
    if (this.dirOn()) return; // (v0.4.8.7: the park director decides what's played on its courts)
    if (c.session) { c.session.dispose(); c.session = null; }
    // (v0.4.7.5 qp3 online: real people hold this court, a game or kings between games: no AI game of ours on it)
    if (!force && (this.realHeld(c) || c.live)) { this.unitOff(c, kings); c.kings = null; c.kingsStreak = 0; return; }
    const fmt = c.format, t = Date.now();
    // kings keep the court while they're all still on (and none of them left to run with you; v0.4.8.6: the ICON Squad
    // while their hour runs: after it, out they walk together)
    let home = kings && this.holds(kings, t) ? kings : null;
    if (kings && !home) this.unitOff(c, kings);
    // (v0.4.8.6: the ICON Squad is walking up to this empty court to hold it: it waits for them)
    const ul = !home && this.icon ? c.lines.find(l => l && l.icon === this.icon.k) : null;
    if (ul && !this.lineSet(c, ul) && !this.upNext(c, false)) { c.kings = null; c.kingsStreak = 0; return; }
    let away = null;
    const nx = this.upNext(c, false);
    if (nx) { away = nx.l.members.map(w => w.entry); this.takeLine(c, nx.i); }
    // (v0.4.8.6: nobody holds it and the ICON Squad steps on: they're the kings)
    if (!home && this.isUnit(away)) { home = away; away = null; c.kingsStreak = 0; }
    if (!home) { c.kingsStreak = 0; home = this.takeEntries(fmt, { exclude: new Set((away || []).map(e => e.aiId)) }); }
    if (home && !away) away = this.takeEntries(fmt, { exclude: new Set(home.map(e => e.aiId)) });
    if (!home || !away) {
      // not enough people around: the court sits empty for now; anyone pulled for it goes back to hanging out (v0.4.8.6:
      // the ICON Squad as one, and they give it a while before they look for a game again)
      if (this.icon && (this.isUnit(home) || this.isUnit(away))) this.icon.idle = t + 30000;
      for (const e of this.unitOff(c, [...(home || []), ...(away || [])])) if (this.walkers.length < 14 && this.stays(e, t)) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] + this.rng.range(-4, 4), e); w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); this.walkers.push(w); }
      c.kings = null; c.session = null;
      return;
    }
    for (const e of [...home, ...away]) { e.look = e.look || resolveLook(e.build, this.catalog); e.human = false; }
    // (v0.4.8.5 qp8: the kings' streak on this court is their win streak: an AI ICON among them shows his aura from 3 wins,
    // as your ICON does from yours)
    for (const e of home) if (e.build) e.build = { ...e.build, win_streak: c.kingsStreak || 0 };
    for (const e of away) if (e.build?.win_streak) e.build = { ...e.build, win_streak: 0 };
    c.kings = home;
    const team = (es, d) => this.isUnit(es) ? { ...ICON_TEAM } : d; // (v0.4.8.6: the ICON Squad plays under its own name)
    c.session = this.bgSession(c, [home, away], [team(home, { name: 'Kings', abbr: 'KNG', color: '#ffd84a' }), team(away, { name: 'Challengers', abbr: 'CHL', color: '#ff5a36' })]);
    c.bgStart = performance.now();
  }
  // the AI game on a court (v0.4.8.6: on its own, so the tests can play the park's rotations without a renderer)
  bgSession(c, rosters, teams, seed = this.rng.int(1, 1e9)) { // (v0.4.8.7: seed: the park host's game, played the same here)
    const s = new MatchSession(this.app, { background: true, hub: true, pool: this.pool, mode: 'park', full: !!c.full, scene: this.scene, venue: this.venue, court: c, rosters, teams, seed, target: 11, difficulty: 0.6, assist: true });
    s.animDt = (o, dt, x, z, r) => this.animDt(o, dt, x, z, r); // (qp3 perf: posed only when seen)
    return s;
  }

  // ---------- v0.4.8.6 the ICON Squad (sim/iconsquad.js, AIWorld.iconSquad) ----------
  // About every 9 hours three of this world's 99 OVR ICONs run together for an hour at one park, in one outfit, with
  // builds that fit (a handler, a wing and a big); there is only ever one such squad. Here they're one unit: nobody pulls
  // one of them on his own (availableHere, takeEntries, the free walkers, formAILine); they walk in together, hold a free
  // 3v3 court or line up for one as a group, stay on while they win and get back in line when they lose; when the hour
  // is up they finish the game they're in and walk out together. No other AI team anywhere has three ICONs: takeEntries
  // and formAILine pass an ICON over once a team has MAX_ICONS_PER_AI_TEAM. this.icon: the squad of this park's latest
  // window {k, sq, ids, formed (they've come in), over (when their hour ended), last (the court they last played on),
  // idle (no game to be had: when they look again)}
  iconLive(t = Date.now()) { const u = this.icon; return !!u && !u.over && this.world.iconSquad?.(t)?.k === u.k; }
  // the squad's ids while their hour runs here and for a while after it (nobody takes one of them on his own; their
  // hour just begun and not ticked yet: theirs too)
  iconIds(t = Date.now()) {
    if (this.dirOn()) { const d = this.link.dir; return d.iconIds(d.tl(d.k)); }
    const u = this.icon, sq = this.world.iconSquad?.(t), cool = !!u && t < (u.over || u.end) + ICON_COOL;
    if (sq && sq.park === this.themeId && u?.k !== sq.k) return new Set([...sq.ids, ...(cool ? u.ids : [])]);
    return cool ? u.ids : NO_IDS;
  }
  // the three of them, as one team (in any order)
  isUnit(es) { const u = this.icon; return !!u && es?.length === 3 && es.every(e => e?.aiId && u.ids.has(e.aiId)); }
  // kings who keep their court: all still on, none gone to run with you, none of them one of the ICON Squad playing on
  // his own while their hour runs (he goes to them when this game's over)
  holds(team, t = Date.now()) {
    if (!team?.length) return false;
    const unit = this.isUnit(team);
    if (!unit && this.iconLive(t) && team.some(e => this.icon.ids.has(e?.aiId))) return false;
    return team.every(e => this.stays(e, t) && (unit || !this.world.inSquad(e.aiId)));
  }
  // where they are on court c, for its card and the ticker: 'kings', 'challengers', 'you' (your game), 'next' or ''
  unitAt(c) {
    const u = this.icon;
    if (!u?.formed) return '';
    if (c === this.myCourt && (this.mySession || this.mode === 'starting') && this.isUnit(this.myOpp)) return 'you';
    const i = c.session ? c.session.opts.rosters.findIndex(r => this.isUnit(r)) : -1;
    if (i >= 0) return i ? 'challengers' : 'kings';
    return c.lines.some(l => l && l.icon === u.k) ? 'next' : '';
  }
  // every couple of seconds (and as courts turn over): their hour starting, where they are, their hour ending
  squadTick(t = Date.now(), initial = false) {
    if (this.dirOn()) return; // (v0.4.8.7: the director's ICON Squad)
    const sq = this.world.iconSquad?.(t) || null, u = this.icon;
    if (u && !u.over && sq?.k !== u.k) this.unitDone(u, t);
    if (!sq) return;
    if (sq.k !== this.iconK) { this.iconK = sq.k; this.iconLeft = new Set(); if (!initial) this.syncSquad(); } // (a squad mate of yours among them leaves you)
    const here = sq.park === this.themeId;
    if (here && this.icon?.k !== sq.k) this.icon = { k: sq.k, sq, ids: new Set(sq.ids), end: sq.end, formed: false, over: 0, last: null, idle: 0 };
    this.pullSingles(sq, here);
    if (!here) return;
    const v = this.icon;
    if (!v.formed) this.formUnit(v, t, initial);
    else if (t >= v.idle) this.placeUnit(t);
    // an empty court they've walked up to: on they go, and hold it
    for (const c of this.courts) if (!c.session && !c.mine && !c.live && c.lines.some(l => l && l.icon === v.k && this.lineSet(c, l))) this.newBackgroundGame(c, null);
  }
  // one of them here on his own (walking about, or on somebody's Got Next spot: a park-goer group's breaks up, yours
  // fills up again) when their hour begins: here he walks back in with the other two; for another park he heads off.
  // One in a game finishes it first (rotateCourt, leaveCourt, stayOnCourt)
  pullSingles(sq, here) {
    const ids = new Set(sq.ids);
    for (const w of [...this.walkers]) {
      const id = w.entry?.aiId;
      if (!id || !ids.has(id) || w.unit === sq.k || w.follow != null || w.exit) continue;
      if (w.spot) {
        const c = w.spot.court, r = c.lines.findIndex(l => l?.members.includes(w)), l = c.lines[r];
        if (l?.mine) {
          l.members = l.members.filter(x => x !== w); l.ready = false; w.spot = null; this.placeLine(c, r);
          if (!this.iconLeft.has(id)) { this.iconLeft.add(id); this.ui.toast(`${w.entry.name} left your spot to run with his ICON squad.`); }
        } else if (l) this.disperseLine(c, r);
        w.spot = null;
      }
      if (here) { w.dispose(); this.walkers = this.walkers.filter(x => x !== w); } else w.leave();
    }
  }
  // all three free (none of them in a game here): in they come. Loading in during their hour, they're on a court (or a
  // Got Next spot) already; otherwise they walk in from the plaza together and you hear about it
  formUnit(u, t, initial = false) {
    const busy = this.busyIds();
    if (u.sq.ids.some(id => busy.has(id))) return;
    const lead = u.sq.ids.includes(u.sq.leader) ? u.sq.leader : u.sq.ids[0];
    const es = [lead, ...u.sq.ids.filter(id => id !== lead)].map(id => this.entryFor(id));
    u.formed = true;
    if (initial) {
      const c = this.rng.shuffle(this.courts.filter(c => c.format === 3 && !c.session && !c.mine && !c.live && !this.realHeld(c)))[0];
      if (c) { this.newBackgroundGame(c, es); return; } // (no one to play them: they're about the park, as one: unitOff)
    }
    const q = initial ? pickIn(this.rng, this.pickZone()) : { x: this.rng.range(-24, 24), z: -30.5 };
    const ws = es.map((e, i) => { const w = this.spawnWalker(q.x + (i - 1) * 1.2, q.z, e); this.walkers.push(w); return w; });
    this.unitGroup(ws);
    const placed = this.placeUnit(t);
    if (initial) { for (const w of ws) if (w.spot) { const sp = w.spot.court.rows[w.spot.row][w.spot.slot]; w.p.setPos(sp.x, sp.z, Math.atan2(w.spot.court.origin[0] - sp.x, w.spot.court.origin[2] + 8 - sp.z)); w.path = []; w.state = 'queued'; } return; }
    if (!placed) ws[0].goTo(this.rng.range(-20, 20), -24); // (every spot's taken: they hang about by the courts till one opens up)
    const names = es.map(e => e.name), left = (u.sq.end - t) / 60000;
    this.ui.toast(`ICON SQUAD at ${this.aff?.park || parkInfo(this.themeId)?.park || 'the park'}: ${names.slice(0, -1).join(', ')} and ${names.at(-1)} · ${left > 50 ? 'here for the next hour' : `here for another ${Math.max(5, Math.round(left / 5) * 5)} min`}`);
  }
  // they walk as one: the leader first, the other two a step behind him
  unitGroup(ws) {
    const u = this.icon, lead = ws.find(w => w.entry.aiId === u.sq.leader) || ws[0];
    let n = 0;
    for (const w of ws) { w.unit = u.k; w.watch = null; w.lead = w === lead ? null : lead; w.unitSlot = w === lead ? -1 : n++; }
    return [lead, ...ws.filter(w => w !== lead)];
  }
  // free (off court, off a spot): a Got Next spot as a group. Back on the court they just played on first, then a free
  // 3v3 court (they'll hold it: it waits for them), then any open spot on a 3v3 court
  placeUnit(t = Date.now()) {
    const u = this.icon;
    if (!u?.formed || u.over) return false;
    const ws = this.walkers.filter(w => w.unit === u.k && !w.exit && !w.spot);
    if (ws.length !== 3) return false;
    const open = this.courts.filter(c => c.format === 3 && !c.live && !this.realHeld(c) && c.lines.some(l => !l));
    if (!open.length) return false;
    const free = open.filter(c => !c.session && !c.mine);
    const c = open.includes(u.last) ? u.last : free.length ? this.rng.pick(free) : this.rng.pick(open);
    return this.formAILine(c, this.unitGroup(ws), u.k);
  }
  // people coming off court c (at(i): where entries[i] is standing). The ICON Squad among them goes as one: back to a
  // Got Next spot while their hour runs (this court's first: the next squad tick), out of the park together after it.
  // One of them who was playing on his own while their hour runs just comes off (he walks in with the other two); after
  // it he's a regular again. → everyone else, for the usual walk-off
  unitOff(c, entries, at = null) {
    const u = this.icon, es = entries || [];
    if (!u || !es.length || this.dirOn()) return es; // (v0.4.8.7: with the director the squad goes as one there: dirFree)
    const mine = es.filter(e => e?.aiId && u.ids.has(e.aiId)), live = this.iconLive();
    if (!mine.length) return es;
    if (mine.length === 3 && u.formed) {
      const ws = mine.map((e, j) => { const q = at?.(es.indexOf(e)) || { x: c.origin[0] + 10.5, z: c.origin[2] - 1.2 + j * 1.2 }; const w = this.spawnWalker(q.x, q.z, e); w.leaving = 8; this.walkers.push(w); return w; });
      this.unitGroup(ws);
      u.last = c;
      if (live) this.iconT = 0; else this.unitLeave(ws);
    } else if (!live) return es;
    return es.filter(e => !mine.includes(e));
  }
  // out of the park together: the leader heads for the plaza, the other two a step behind him (gone when he is)
  unitLeave(ws) {
    const lead = ws.find(w => !w.lead) || ws[0];
    for (const w of ws) { w.spot = null; w.watch = null; w.exit = true; w.lead = w === lead ? null : lead; if (w !== lead) w.state = 'follow'; }
    lead.leave();
  }
  // their hour is over: off a Got Next spot, or wherever they're standing, and out together. In a game (a court's or
  // yours) they finish it first: rotateCourt, leaveCourt and stayOnCourt walk them out
  unitDone(u, t) {
    u.over = t;
    if (!u.formed) return;
    for (const c of this.courts) c.lines.forEach((l, r) => { if (l && l.icon === u.k) { for (const w of l.members) w.spot = null; c.lines[r] = null; } });
    const ws = this.walkers.filter(w => w.unit === u.k && !w.exit);
    if (ws.length) this.unitLeave(ws);
  }

  // ---------------- frame ----------------
  frame(dt) {
    if (this.disposed) return; // (QP3: left, its scene freed; the loop can still call it until the next controller is up)
    const app = this.app, inp = app.input;
    this.viewTick();
    // athletes being built: a small slice per frame (a bigger one while your own game is getting ready)
    // (v0.4.8.7 qp4: and a bigger one while a real player's game you're watching is still waiting on its people)
    if (this.pool.pending) this.pool.tick(this.mode === 'starting' || this.courts.some(c => c.live?.visuals?.some(v => v.pending)) ? 10 : 3);
    this.localPub?.flush(); // (qp4: your game's last few ticks out, even on a frame that played none)
    this.venue.update(dt);
    this.venue.practice.hoop.update(dt, this.practice ? null : null);
    // background courts
    const dir = this.dirFrame(dt); // (v0.4.8.7: the park director runs the park, the same on every screen here)
    const mirror = !dir && this.mirroring(); // (v0.4.8.7 qp7, the director off: the park's host runs its people; here they're played as he has them)
    for (const c of this.courts) {
      if (c.session?.dir) { c.session.frame(dt); if (c.live) { c.live.frame(dt); if ((c.live.ended && c.live.endT > 2.5) || (c.liveEndAt && performance.now() - c.liveEndAt > 6000)) this.dropWatch(c); } continue; }
      if (c.session && mirror) { this.mirrorCourt(c, dt); continue; }
      if (c.session) {
        c.session.rate = this.courtRate(c);
        c.session.frame(dt);
        const g = c.session.game;
        // my squad is waiting: wrap the current game up (sooner when real people are waiting on it too)
        const nx = this.nextLine(c);
        const realWait = nx?.l.mine && (nx.l.realMates?.length || this.remoteClaimLine(c)) ? 8000 : 25000;
        if (nx && nx.l.mine && nx.l.ready && !g.over && (performance.now() - nx.l.readyAt) > realWait && this.canStart(c)) { const lead = g.score[0] >= g.score[1] ? 0 : 1; g.finish(lead); }
        if (g.over && c.session.ended && c.session.endT > 2.2) this.rotateCourt(c);
      }
      // v0.4.7.5 qp3 online: a real game you're watching from the sideline
      if (c.live) {
        c.live.frame(dt);
        if ((c.live.ended && c.live.endT > 2.5) || (c.liveEndAt && performance.now() - c.liveEndAt > 6000)) this.dropWatch(c);
      }
    }
    if (!dir) this.holdLines(); // (v0.4.8.8: AI groups that have reached their GOT NEXT spot hold it now)
    // your squad is set on an open court: on you go (online, when it's yours to start)
    const my = this.myLine();
    if (my && my.l.ready && this.mode === 'roam' && !my.c.session && !my.c.live && this.canStart(my.c)) this.startNext(my.c);
    if (this.awaitStart && performance.now() - this.awaitStart.at > 8000) this.startFailed();
    this.updateSpectators(dt);
    for (const w of this.walkers) { w.update(dt); if (!w.gone) w.render(dt); }
    this.peers.frame(dt);
    this.recordTagsFrame(dt);
    this.courtReport(dt);
    if (this.walkers.some(w => w.gone)) { for (const w of this.walkers) if (w.gone) w.dispose(); this.walkers = this.walkers.filter(w => !w.gone); }
    this.updateStreakFX(dt);
    if (this.cup && (this.cupT -= dt) <= 0) { this.cupT = 60; this.refreshCup(); }
    this.popT -= dt;
    // (v0.4.8.7: online with others here, the park's host decides who comes and goes, and the ICON Squad's moves; the
    // rest of you play his park: popTick)
    if (this.world !== this.app.ai) this.rebaseWorld();
    if (this.popT <= 0) { this.popT = 20; if (mirror || dir) this.syncSquad(); else this.populationTick(); }
    if ((this.iconT -= dt) <= 0) { this.iconT = 2; if (!mirror && !dir) this.squadTick(); } // (v0.4.8.6 the ICON Squad: their hour, and where they are)
    this.popTick(dt);
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
    this.meVisual?.syncIcon?.(app.char()); // (v0.4.8.5 qp3: your ICON badge and aura follow your build: a new streak, ICON made)
    if (this.app.modalOpen()) {
      me.intent.mx = me.intent.mz = 0;
      me.move(dt * GAME_SPEED, false, 0);
      this.meVisual.anim.update(dt, { x: me.x, y: 0, z: me.z, facing: me.facing }, me, null, null, {});
      this.meVisual.place(me.x, 0, me.z);
      this.rig.updateRoam(dt, me, null, this.venue.bounds, this.venue.solids);
      return;
    }
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
    const px = me.x, pz = me.z;
    me.move(dt * GAME_SPEED, false, 0);
    me.stamina = Math.min(1, me.stamina + dt * 0.2);
    // stay in the park
    const b = this.venue.bounds;
    me.x = M.clamp(me.x, b.x0, b.x1); me.z = M.clamp(me.z, b.z0, b.z1);
    for (const s of this.venue.solids || []) pushOut(me, s);
    this.keepOffCourts(me, px, pz, dt); // (v0.4.8.7 qp2: like the park-goers, no walking onto a court with a game on)
    // bump into people
    for (const w of this.walkers) this.separate(me, w.p);
    // (QP3: the courts' games and the ones you watch, through one scratch body instead of a new object a player a frame)
    const sep = this._sepBody || (this._sepBody = { x: 0, z: 0, phys: null });
    for (const c of this.courts) for (let k = 0; k < 2; k++) { const s = k ? c.live : c.session; if (s) for (const p of s.game.players) { sep.x = p.x + c.origin[0]; sep.z = p.z + c.origin[2]; sep.phys = p.phys; this.separate(me, sep, true); } }
    for (const w of this.peers.list()) this.separate(me, w.p, true);
    this.meVisual.anim.update(dt, { x: me.x, y: 0, z: me.z, facing: me.facing }, me, null, null, {});
    this.meVisual.place(me.x, 0, me.z);
    this.rig.updateRoam(dt, me, inp, b, this.venue.solids);
    const sf = this._roamFocus || (this._roamFocus = { center: [0, 0, 0], radius: 16 }); // (QP3: one object, moved)
    sf.center[0] = me.x; sf.center[1] = 0; sf.center[2] = me.z + 2;
    this.scene.shadowFocus = sf;
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
    else if (this.venue.hall && Math.hypot(me.x - this.venue.hall.x, me.z - this.venue.hall.z) < 2.6) {
      // v0.4.7.5 qp3: the Event Park hall (or, at an event park, the Home Park hall)
      const hl = this.venue.hall;
      this.prompt = `${promptGlyph(inp, 'E', 'A')} ${hl.home ? `Home Park · ${hl.name || 'your home court'}` : hl.open ? `Event Park · ${hl.name}` : 'Event Park · no event running'}`;
      if (inp.wasPressed('interact')) this.ui.openHall(this);
    }
    else if (this.venue.proamHub && Math.hypot(me.x - this.venue.proamHub.x, me.z - this.venue.proamHub.z) < 2.6) {
      // v0.4.8.8 The Pro-Am Overhaul: the Pro-Am HUB's doors: your team's hub (game/proamhub.js, the Hub agent's)
      this.prompt = `${promptGlyph(inp, 'E', 'A')} Pro-Am HUB · your team`;
      if (inp.wasPressed('interact') && !this.hubOpening) this.enterProamHub();
    }
    else if (wheel && Math.hypot(me.x - wheel.x, me.z - wheel.z) < 2.6) {
      const ready = (this.app.profile.daily_spin?.next_at || 0) * 1000 <= Date.now();
      this.prompt = `${promptGlyph(inp, 'E', 'A')} Daily Spin${ready ? ' · ready!' : ''}`;
      if (inp.wasPressed('interact')) this.ui.openWheel(this);
    }
    const pr = this.venue.practice.origin;
    if (Math.hypot(me.x - (pr[0] - 4), me.z - (pr[2] - 2)) < 3 || Math.hypot(me.x - pr[0], me.z - pr[2]) < 4.5) { this.prompt = `${promptGlyph(inp, 'E', 'A')} Shoot around`; if (inp.wasPressed('interact')) this.startPractice(); }
    this.gotNext(dt);
    if (inp.wasPressed('celebrate') && !me.action) this.celebrate(me);
    if (me.action) { me.action.t += dt; if (me.action.t > me.action.dur) me.action = null; }
  }
  // v0.4.8.8 The Pro-Am Overhaul (§6, Platinum): the Pro-Am record over the head of everyone here who shows his (his
  // entry's proam: {tier, record, showRecord}), you too; while you roam (not in your own game). Yours is read again
  // every second (you can flip the toggle in your settings while you're here)
  recordTagsFrame(dt) {
    const tags = this.recordTags || (this.recordTags = new RecordTags(this.r, this.scene));
    if (this.mode !== 'roam') { tags.update([], null); return; }
    const now = performance.now();
    if (now - (this.myProamAt ?? -1e9) > 1000) { this.myProamAt = now; try { this.myProam = myEntry(this.app)?.proam || this.app.proam || null; } catch { this.myProam = null; } }
    const head = e => (+e?.build?.height || 76) * 0.0254 + 0.08, list = [];
    list.push({ key: 'me', x: this.me.x, z: this.me.z, h: head(this.meEntry), proam: this.myProam });
    for (const w of this.peers.list()) if (!w.visual?.pending) list.push({ key: 'p:' + w.id, x: w.p.x, z: w.p.z, h: head(w.entry), proam: w.entry?.proam });
    tags.update(list, this.app.camera?.pos || null);
  }
  // v0.4.8.8: through the Pro-Am HUB's doors (the hub is game/proamhub.js: until it's there, a word that it's coming)
  enterProamHub() {
    this.hubOpening = true;
    import('./proamhub.js').then(m => m.enterHub(this.app, { from: 'park', park: this.themeId }))
      .catch(e => { console.warn('[park] Pro-Am HUB', e?.message || e); this.ui.toast('The Pro-Am HUB opens soon.'); })
      .finally(() => { this.hubOpening = false; });
  }
  // your celebration in the park: here, and (v0.4.8.7 qp7) on the screens of the real people here (it used to play on yours
  // alone: nothing of it went out, their copy of you only had your walk)
  celebrate(me = this.me) {
    const item = this.char?.equipment?.celebration || null, anim = item ? this.app.catalog?.[item]?.anim : null;
    me.startAction('celebrate', 1.6, { kind: anim || 'flex' });
    const net = this.netHere?.() || null;
    if (net && net.people.size) net.emote(anim ? item : null, anim ? null : 'flex', 1.6);
  }

  separate(a, b, staticB = false) {
    const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), r = (a.phys.radius + b.phys.radius) * 0.9;
    if (d < r && d > 1e-4) { const k = (r - d) / d; a.x += dx * k * (staticB ? 1 : 0.5); a.z += dz * k * (staticB ? 1 : 0.5); if (!staticB && b.x !== undefined) { b.x -= dx * k * 0.5; b.z -= dz * k * 0.5; } }
  }

  // ---------- v0.4.7.5 GOT NEXT spots: two per court, the first squad to fill up runs next ----------
  myLine() { for (const c of this.courts) for (let r = 0; r < c.lines.length; r++) if (c.lines[r]?.mine) return { c, r, l: c.lines[r] }; return null; }
  lineFull(c, l) { return l.members.length + (l.mine ? 1 + (l.realMates?.length || 0) + this.mateAI(c, l).length : 0) >= c.format; }
  // v0.4.7.5 qp3 online: your squad's AI from your friends' games (each friend in your squad brings his AI squad mates)
  // on your Got Next line: the squad runs together, its real players first, then everyone's AI squad mates (yours
  // first: they're on the spot already), then park-goers. [{owner, id, name, entry}]
  mateAI(c, l) {
    if (!l?.mine || !l.realMates?.length) return [];
    const net = this.netHere();
    if (!net) return [];
    const own = this.walkers.filter(w => this.world.inSquad(w.entry.aiId) && (w.follow != null || l.members.includes(w))).length;
    const room = c.format - 1 - l.realMates.length - own;
    if (room <= 0) return [];
    const out = [];
    for (const id of l.realMates) for (const a of net.aiOf(id)) out.push({ owner: id, ...a });
    return out.slice(0, room);
  }
  // where a friend's AI squad mate stands on your screen: on his squad's Got Next spot (yours, or the other squad's
  // leader's), otherwise a step behind his owner
  followerSpot(f) {
    const ownerId = f.owner.id;
    for (const c of this.courts) for (let r = 0; r < c.lines.length; r++) {
      const l = c.lines[r];
      if (!l) continue;
      let slot = -1;
      if (l.mine) { const i = this.mateAI(c, l).findIndex(a => a.owner === ownerId && a.id === f.aiId); if (i >= 0) slot = 1 + l.members.length + i; }
      else if (l.remote && l.remote.leader === ownerId) slot = 1 + f.slot;
      if (slot >= 0 && c.rows[r][slot]) { const sp = c.rows[r][slot]; return { x: sp.x, z: sp.z, face: Math.atan2(c.origin[0] - sp.x, c.origin[2] + 8 - sp.z) }; }
    }
    return null;
  }
  lineSet(c, l) { return this.lineFull(c, l) && l.members.every(w => w.state === 'queued'); }
  // stamp the moment a line fills up (it's what decides who runs next). v0.4.8.8: an AI line only once it holds its spot
  // (its first man is standing on it: holdLines), as yours only exists once you've stood on it
  markFull(c, l) { if (l && !l.fullAt && !l.pending && this.lineFull(c, l)) l.fullAt = (this.fillSeq = (this.fillSeq || 0) + 1); }
  // ---------- v0.4.8.8: a GOT NEXT spot is held by whoever is standing on it ----------
  // An AI group heading for a spot (pending) holds nothing yet: you can step on it and claim it first (claim: they look
  // for the other spot, or go back to hanging out), and it isn't in the order for the next game. It's theirs the moment
  // their first man stands on the spot's first circle (SPOT_R, as close as you have to be to claim one), the way yours
  // is yours the moment you stand on it; a squad still steps on court only with everyone on his circle (lineSet)
  spotHeld(c, r, w) { const sp = c.rows[r]?.[0]; return !!sp && !!w && w.state === 'queued' && Math.hypot(w.p.x - sp.x, w.p.z - sp.z) < SPOT_R; }
  holdLines() {
    for (const c of this.courts || []) for (let r = 0; r < c.lines.length; r++) { const l = c.lines[r]; if (l?.pending && !l.dir && !l.mirror && this.spotHeld(c, r, l.members[0])) { l.pending = false; this.markFull(c, l); } }
  }
  // an AI group that was only on its way to spot r (someone stood on it first): to the other spot if it's free, else back
  // to hanging out
  rerouteLine(c, r) {
    const l = c.lines[r]; if (!l || l.mine || l.remote) return;
    c.lines[r] = null;
    if (l.dir || l.mirror) return; // (the director's / the park host's: it moves them, for everyone)
    if (l.pending && !c.lines[1 - r]) { c.lines[1 - r] = l; this.placeLine(c, 1 - r); return; }
    for (const w of l.members) { w.spot = null; w.state = 'idle'; w.t = this.rng.range(0.5, 3); }
  }
  // the line that runs next: the first one that filled up → {l, i} (null while neither spot is full)
  nextLine(c) {
    this.holdLines(); // (v0.4.8.8: who's standing on his spot by now)
    let out = null;
    c.lines.forEach((l, i) => { if (l && l.fullAt && (!out || l.fullAt < out.l.fullAt)) out = { l, i }; });
    return out;
  }
  // the AI line that can step on court now (mine = also yours): the first-filled one if it's standing ready; if
  // that one is still walking up, the other spot's squad when it is
  upNext(c, mine = false) {
    this.holdLines();
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
  // squad mates of yours who chose to keep running together line up as a group. v0.4.8.6: icon: the ICON Squad's window
  // when the group is the ICON Squad; never one of them in anybody else's group, nor more than MAX_ICONS_PER_AI_TEAM
  // ICONs in one
  formAILine(c, group = null, icon = null) {
    const r = c.lines.findIndex(l => !l);
    if (r < 0) return false;
    let members = group;
    if (!members) {
      const head = c.rows[r][0], party = new Set(this.world.aiParty ? this.world.aiParty() : []);
      let icons = 0;
      const free = this.walkers.filter(w => !w.spot && w.follow == null && !w.exit && w.unit == null && w.entry.aiId).sort((a, b) => (party.has(b.entry.aiId) - party.has(a.entry.aiId)) || (Math.hypot(a.p.x - head.x, a.p.z - head.z) - Math.hypot(b.p.x - head.x, b.p.z - head.z)))
        .filter(w => !isIconEntry(w.entry) || icons++ < MAX_ICONS_PER_AI_TEAM).slice(0, c.format);
      if (free.length < c.format) {
        const more = this.takeEntries(c.format - free.length, { walkers: false, have: free.map(w => w.entry) });
        if (!more) return false;
        for (const e of more) { const w = this.spawnWalker(this.rng.range(-30, 30), -30.5, e); this.walkers.push(w); free.push(w); }
      }
      members = free;
    }
    c.lines[r] = { members, mine: false, ready: false, readyAt: 0, pending: true, ...(icon != null ? { icon } : {}) }; // (v0.4.8.8: theirs once they're on it: holdLines)
    this.placeLine(c, r);
    return true;
  }

  gotNext(dt) {
    const me = this.me;
    const mine = this.myLine();
    if (!mine) {
      // v0.4.7.5 qp3 online: in a friend's squad, he calls next for all of you
      const net = this.netHere(), member = net?.squad && !net.isLeader(), sq = this.squadLine();
      let on = null;
      for (const c of this.courts) c.rows.forEach((row, r) => row.forEach((sp, i) => { if (Math.hypot(me.x - sp.x, me.z - sp.z) < SPOT_R) on = { c, r, i }; }));
      if (on) {
        const { c, r } = on, other = c.lines[1 - r];
        if (c.lines[r]?.remote) { this.prompt = c.lines[r].squad ? `Your squad has GOT NEXT on ${c.name}` : `${c.lines[r].remote.names[0]}'s squad has this GOT NEXT spot on ${c.name}`; this.claimT = 0; return; }
        if (member) { this.prompt = sq ? `Your squad has GOT NEXT on ${sq.c.name} · your squad leader calls it` : 'Your squad leader calls GOT NEXT for the squad'; this.claimT = 0; return; }
        // (v0.4.8.8: taken only by people standing on it: a group still on its way to it holds nothing)
        if (c.lines[r] && !c.lines[r].pending) { this.prompt = `This GOT NEXT spot on ${c.name} is taken · ${other && !other.pending ? 'both spots are full' : 'the other spot is open'}`; this.claimT = 0; return; }
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
      } else { this.claimT = 0; this.anteDeclined = null; if (sq && !this.prompt) this.prompt = `Your squad has GOT NEXT on ${sq.c.name}${this.realBusy(sq.c) || sq.c.session ? ' · after this game' : ''}`; }
      return;
    }
    const { c, r, l } = mine;
    const n = l.members.length + 1;
    const head = c.rows[r][0];
    if (Math.hypot(me.x - head.x, me.z - head.z) > 6) { this.unclaim(c); this.ui.toast('You left your spot.'); return; }
    const nx = this.nextLine(c), other = c.lines[1 - r], n2 = n + (l.realMates?.length || 0), turn = this.myTurn(c, mine);
    const kings = this.realKings(c), busy = this.realBusy(c);
    if (other?.remote && turn === 'after') this.prompt = `GOT NEXT on ${c.name} · ${other.remote.names[0]}'s squad called it first: you run after their game`;
    else if (n2 < c.format) this.prompt = `GOT NEXT on ${c.name} · waiting for teammates (${n2}/${c.format})${other && other.fullAt ? ' · the other squad filled first: they run next' : ' · fill up first to run next'}`;
    else if (other?.remote) this.prompt = `Squad ready on ${c.name} · you run next, against ${other.remote.names[0]}'s squad${c.session || busy ? ' · after this game' : ''}`;
    else if (kings) this.prompt = `Squad ready on ${c.name} · ${kings.names[0]}'s squad holds the court: you're up when they run it back`;
    else if (nx && nx.l === l) this.prompt = `Squad ready on ${c.name} · you run next${c.session || busy || c.live ? ' · after this game' : ''}`;
    else this.prompt = `Squad ready on ${c.name} · the other squad filled first: you're up after their game`;
    this.fillQueue(c, r, l, dt);
  }

  claim(c, r) {
    c.mine = true; this.claimT = 0;
    if (c.lines[r]) this.rerouteLine(c, r); // (v0.4.8.8: you got there first: the group on its way finds another spot)
    c.lines[r] = { members: [], mine: true, ready: false, readyAt: 0, realMates: [] };
    this.markFull(c, c.lines[r]);
    this.netHere()?.send({ t: 'claim', court: this.courts.indexOf(c), spot: r }); // (online: everyone here sees your squad on it)
    audio.ui('buy');
    const other = c.lines[1 - r];
    this.ui.toast(other && other.fullAt ? `Got next on ${c.name}! The squad on the other spot filled first: you run after their game.` : `Got next on ${c.name}! Teammates are on the way. Fill up first and you run next.`);
    this.fillT = 1.5;
  }
  unclaim(c, quiet = false) {
    if (!quiet) this.netHere()?.send({ t: 'unclaim' });
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
        this.dirPact('ready', { c: this.courts.indexOf(c) }); // (v0.4.8.7: the director wraps the game on it up for you)
        // v0.4.4: an empty court (quiet hours): the squad on the other spot, or whoever's around, runs against you
        if (!c.session && !c.live && this.canStart(c)) this.startNext(c);
      }
      // (online: a friend joined the squad, or his AI squad mates came with him: park-goers on the spot step off first)
      let trimmed = false;
      while (l.members.length && l.members.length + 1 + (l.realMates?.length || 0) + this.mateAI(c, l).length > c.format) {
        let i = l.members.map(w => this.world.inSquad(w.entry.aiId)).lastIndexOf(false);
        if (i < 0) i = l.members.length - 1;
        const [w] = l.members.splice(i, 1);
        w.spot = null; w.state = 'idle'; w.t = 1; trimmed = true;
        if (!this.world.inSquad(w.entry.aiId)) this.dirFree(c, [w.entry]); // (v0.4.8.7: a park-goer back to the director's park)
      }
      if (trimmed) { this.placeLine(c, r); this.syncSquad(); }
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
      const free = this.walkers.filter(x => !x.spot && x.follow == null && !x.exit && x.unit == null).sort((a, b) => Math.hypot(a.p.x - head.x, a.p.z - head.z) - Math.hypot(b.p.x - head.x, b.p.z - head.z)); // (v0.4.8.6: never one of the ICON Squad)
      w = free[0];
      if (!w || this.rng.next() < 0.35) { const e = this.takeEntries(1, { topUp: true, walkers: false }); if (e) { w = this.spawnWalker(this.rng.range(-20, 20), -29, e[0]); this.walkers.push(w); } }
      if (!w) return;
      this.dirLend(c, [w.entry], r); // (v0.4.8.7: on your spot on every screen, the director's park-goer no more)
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
    // (v0.4.8.6: where each of a team stood when the game ended, for the ICON Squad walking off it as one: unitOff)
    const at = team => i => { const p = g.teams[team]?.[i]; return p ? { x: p.x + c.origin[0], z: p.z + c.origin[2] } : null; };
    // losers are forced off the court: they walk off into the park (or log off and head home). v0.4.5: some
    // of them walk back around to the back of the line to run it again. v0.4.8.6: the ICON Squad always does, as one
    // (or, their hour up, walks out together)
    const off = [], lost = this.unitOff(c, losers, at(1 - g.winner));
    for (let i = 0; i < g.teams[1 - g.winner].length && this.walkers.length < 18; i++) {
      if (!lost.includes(losers[i])) continue;
      const p = g.teams[1 - g.winner][i];
      const w = this.spawnWalker(p.x + c.origin[0], p.z + c.origin[2], losers[i]);
      w.leaving = 8;
      if (this.stays(losers[i])) { w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); off.push(w); } else w.leave();
      this.walkers.push(w);
    }
    c.kingsStreak = g.winner === 0 ? (c.kingsStreak || 0) + 1 : 1;
    const nx = this.nextLine(c), l0 = nx?.l;
    if (l0 && l0.mine && l0.ready && this.canStart(c)) {
      s.dispose(); c.session = null;
      // kings who logged off (or left to join your squad) are replaced by whoever's around (v0.4.8.6: the ICON Squad
      // while their hour runs: you play them like any kings)
      const kept = this.holds(winners);
      if (!kept) this.unitOff(c, winners, at(g.winner));
      const opp = kept ? winners : this.takeEntries(c.format, { topUp: true, exclude: new Set(l0.members.map(w => w.entry.aiId)) });
      this.startMyGame(c, opp, kept ? c.kingsStreak : 0); // (the kings bring their streak; fill-ins don't)
      this.syncSquad();
      if (off.length === c.format && this.rng.next() < 0.45) this.formAILine(c, off);
      this.squadTick();
      return;
    }
    if (off.length === c.format && this.rng.next() < 0.45 && c.lines.some(l => !l)) this.formAILine(c, off);
    // winners stay on; anyone who just logged off walks out instead (v0.4.8.6: the ICON Squad stay on as one while their
    // hour runs, and walk out together after it; one of them who was playing on his own comes off to join them)
    const leaving = this.isUnit(winners) ? (this.holds(winners) ? [] : winners.slice()) : winners.filter(e => !this.stays(e) || this.world.inSquad(e.aiId) || (this.iconLive() && this.icon.ids.has(e.aiId)));
    if (leaving.length) {
      s.opts.rosters[g.winner] = []; // so they no longer count as busy on this court
      const go = this.unitOff(c, leaving, i => at(g.winner)(winners.indexOf(leaving[i])));
      winners.forEach((e, i) => { if (!go.includes(e)) return; const p = g.teams[g.winner][i]; const w = this.spawnWalker(p.x + c.origin[0], p.z + c.origin[2], e); w.leaving = 8; if (this.world.inSquad(e.aiId)) w.follow = 0; else w.leave(); this.walkers.push(w); });
    }
    this.newBackgroundGame(c, leaving.length ? null : winners);
    if (leaving.length) this.syncSquad();
    this.squadTick(); // (v0.4.8.6: the ICON Squad, beaten or waiting on a spot, gets back in line: this court's first)
  }

  // ---------------- v0.4.5 streaks you can see ----------------
  // the streak each court's holders are on: yours from the moment you step up to play on it (myCourt is set when your
  // game starts and cleared when you walk off), the AI kings' otherwise. v0.4.5 quick patch fixes: myCourt used to
  // stay set after you left, so starting a game on another court lit up the old one with your streak while the new
  // one stayed dark until the tip-off; and kings who beat you inherited whatever streak the court last had.
  myStreak() { const p = this.app.char()?.progression; return (this.cup ? p?.cup?.streak : p?.park?.streak) || 0; }
  courtStreak(c) {
    if (c === this.myCourt && (this.mySession || this.mode === 'starting')) return this.myStreak();
    const k = this.realKings(c); if (k) return k.streak || 0; // (online: real kings, their streak on this court)
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
    // v0.4.7.5 qp3 online: with other people at the park (or friends in your squad), the game goes through the hosted
    // game so they can play in it or watch it from the sideline
    if (this.useHub(c)) { this.startHubGame(c, opponents, oppStreak); return; }
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
    // (v0.4.8.5 qp8: kings you step up against bring their streak: an AI ICON's aura with it)
    for (const e of opponents || []) if (e?.build) e.build = { ...e.build, win_streak: this.myOppStreak };
    this.myOpp = opponents;
    this.dirLend(c, [...mates, ...(opponents || [])]); // (v0.4.8.7: in your game, for everyone here: the director's court is yours)
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
    await this.pool.prebuild([...mine, ...opp].filter(e => !e.human).map(e => ({ build: e.build, look: e.look, opts: { detail: 1, faceRes: 512, lod: true } })));
    if (this.disposed) return;
    this.lendMe();
    const teams = [{ name: this.aff.name, abbr: 'YOU', color: this.aff.color }, this.isUnit(opponents) ? { ...ICON_TEAM } : { name: 'Court Kings', abbr: 'KNG', color: '#e8e3d8' }]; // (v0.4.8.6: across from the ICON Squad)
    this.myCourt = c;
    this.myOpp = opponents;
    // (v0.4.8.7 qp4: online at the park, the others here see this game as it's played: LocalPub, LocalWatch)
    const net = this.netHere();
    this.localPub?.stop(); this.localPub = net ? new LocalPub(net) : null;
    this.mySession = new MatchSession(app, {
      mode: 'park', full: !!c.full, hub: true, pool: this.pool, scene: this.scene, venue: this.venue, court: c, rosters: [mine, opp], teams, seed: ticket.seed,
      target: ticket.meta.target, difficulty: ticket.meta.difficulty, publish: this.localPub,
      onEnd: (summary, session) => this.myGameOver(summary, session),
    });
    const g0 = this.mySession.game;
    this.localPub?.begin({ court: this.courts.indexOf(c), full: !!c.full, seed: ticket.seed, rosters: [mine, opp], teams, target: ticket.meta.target, difficulty: ticket.meta.difficulty, assist: !!g0.assist, greenBonus: g0.greenBonus, names: { [net?.myId]: this.char.name } });
    this.mode = 'match';
    app.mode = 'match';
    music.duck(true); // v0.4.4: the soundtrack keeps going under park games
    this.ui.matchStarted(this);
    this.reportCourt({ busy: true, score: [0, 0] }); // (online: the people here see the court in use, and its score)
    // (after the session: starting a game clears the feed)
    if (ticket.meta.ante) app.hud.pushFeed(`Ante-up: ${ticket.meta.ante.toLocaleString()} VC on the line`, 'good');
    if (ticket.meta.boosts?.length) app.hud.pushFeed(`Boosts active: ${ticket.meta.boosts.map(k => app.config.boosts?.categories?.[k]?.name || k).join(', ')} (+${app.config.boosts?.amount || 5})`, 'good');
  }

  async myGameOver(summary, session) {
    this.localPub?.stop(); this.localPub = null; // (v0.4.8.7 qp4: its last ticks, then it's over on the others' screens too)
    const app = this.app;
    // v0.4.4: remember who you ran with and against (social phone: recent players)
    const won0 = summary.winner === summary.me.team;
    this.reportCourt({ kings: won0 }); // (online: you hold the court now, for the people here)
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
    // v0.4.7.5 qp3 online: people here (another squad with next on this court, or anyone watching): through the hosted game
    if (this.useHub(c)) { this.runItBack(session); return; }
    session.dispose(); this.mySession = null;
    // new challengers walk up: the hotter your streak, the better the people who step up
    const old = this.myOpp || [];
    this.myOpp = [];
    // (v0.4.8.6: the ICON Squad you just beat walks off as one, back in line while their hour runs: unitOff)
    for (const e of this.unitOff(c, old)) if (this.walkers.length < 16) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] + this.rng.range(-4, 4), e); if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave(); this.walkers.push(w); }
    // (v0.4.8.6: a teammate whose ICON Squad's hour has begun goes to run with them: someone from around takes his place)
    const toSquad = (this.myMates || []).filter(e => this.world.squadOf?.(e.aiId));
    const fill = toSquad.length ? this.takeEntries(toSquad.length, { topUp: true, exclude: new Set([...this.myMates, ...old].map(e => e.aiId).filter(Boolean)) }) : null;
    if (fill) this.myMates = [...this.myMates.filter(e => !toSquad.includes(e)), ...fill];
    // v0.4.5: the group with next gets the shot at you; with nobody in line, whoever's around steps up
    const nx = this.upNext(c, false);
    let challengers;
    if (nx) { challengers = nx.l.members.map(w => w.entry); this.takeLine(c, nx.i); }
    else challengers = this.takeEntries(c.format, { topUp: true, level: Math.min(0.97, 0.5 + 0.06 * (this.char.progression?.park?.streak || 0)) });
    for (const e of challengers) e.look = e.look || resolveLook(e.build, this.catalog);
    this.myOpp = challengers; this.myOppStreak = 0; // (challengers have no streak; you're the one holding the court)
    this.dirFree(c, old); this.dirLend(c, [...(this.myMates || []), ...challengers]); // (v0.4.8.7: the director's park hears who's off and who's on)
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
    this.localPub?.stop(); this.localPub = null; // (v0.4.8.7 qp4: off the others' screens: a game left early too)
    this.reportCourt({ kings: false }); // (online: the court is free again)
    if (session) session.dispose();
    this.mySession = null;
    c.mine = false;
    // teammates become park-goers again (squad mates stay with you; anyone who logged off heads home; v0.4.8.6: one
    // whose ICON Squad's hour has begun goes to them: unitOff)
    const mates = this.unitOff(c, this.myMates || []);
    for (let i = 0; i < mates.length; i++) {
      const e = mates[i];
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
    // (v0.4.8.7: the director's park hears it: your teammates walk off; the kings who beat you hold the court with one more)
    this.dirFree(c, mates); this.dirFree(c, opp, session && !won ? 1 : 0, c.kingsStreak);
    // (v0.4.8.6: the ICON Squad you beat walks off as one: back in line while their hour runs, out together after it.
    // If they beat you they hold the court, as kings do, while their hour runs: newBackgroundGame, holds)
    if (won && opp) for (const e of this.unitOff(c, opp)) if (this.walkers.length < 16) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] - 4, e); if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave(); this.walkers.push(w); }
    this.newBackgroundGame(c, won ? null : opp, true);
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
    if (this.onlineGame) this.app.net?.send({ t: 'quit' }); // (online: you leave the game; the AI plays your player for the rest)
    // (v0.4.8.5 qp3: the server ends the build's win streak with it; so does your copy of it, for the ICON aura)
    if (this.ticket) { try { await this.app.api.post(`/api/matches/${this.ticket.id}/cancel`, {}); endWinStreak(this.app); } catch { /* ignore */ } }
    this.ui.toast('You left the game. Your win streak resets.');
    if (this.onlineGame) this.leaveOnlineCourt(s); else this.leaveCourt(s, false);
  }
  deactivate() { }
  updateSpectators(dt) {
    const cam = this.rig.pos || [this.me.x, 0, this.me.z];
    for (const sp of this.spectators) {
      const c = sp.court;
      // the court's game this frame: a background game, or yours when it's on this court
      const s = c.live || c.session || (this.mySession && this.myCourt === c ? this.mySession : null);
      if (s && s.lastEvents) sp.onEvents(s.lastEvents);
      sp.update(dt, Math.hypot(sp.p.x - cam[0], sp.p.z - cam[2]) < 45, s?.game);
    }
    for (const c of this.courts) { if (c.session) c.session.lastEvents = null; if (c.live) c.live.lastEvents = null; }
    if (this.mySession) this.mySession.lastEvents = null;
  }

  // ---------------- v0.4.7.5 qp3: the real people at this park (ui/online.js, server/online.py) ----------------
  // Everyone at the same park sees the others walk around (Peers), their Got Next claims on the courts (a squad's line
  // on a spot), the kings holding a court between games and the games real people play (watched from the sideline:
  // c.live). Games with people in them go through the hosted game (lockstep, session.js); whoever decides for a court
  // sets the game up: the leader of the squad that called it first, or the kings' leader when he runs it back.
  placeKey() { return this.themeId; }
  netHere() { const n = this.app.net; return n && n.connected && n.place === this.themeId ? n : null; }
  ct(c) { const n = this.netHere(); return n ? n.court(this.courts.indexOf(c)) : null; }
  realBusy(c) { return this.ct(c)?.busy || null; }
  realKings(c) { return this.ct(c)?.kings || null; }
  // a court real people hold right now (a game on it, or kings between games): no AI game of ours on it
  realHeld(c) { const ct = this.ct(c); return !!(ct && (ct.busy || ct.kings)); }
  // your squad's line, when your squad leader called it (you're one of its members)
  squadLine() {
    const net = this.netHere(); if (!net?.squad || net.isLeader()) return null;
    for (const c of this.courts) for (let r = 0; r < c.lines.length; r++) if (c.lines[r]?.remote?.members.includes(net.myId)) return { c, r, l: c.lines[r] };
    return null;
  }
  // another squad's claim on this court (the first one called, when there are two): {r, claim}
  remoteClaimLine(c) {
    const me = this.app.net?.myId; let best = null;
    c.lines.forEach((l, r) => { if (l?.remote && !l.remote.members.includes(me) && (!best || l.remote.at < best.claim.at)) best = { r, claim: l.remote }; });
    return best;
  }
  // is it yours to start the next game on this court? (offline: always)
  canStart(c) {
    const ct = this.ct(c); if (!ct) return true;
    const me = this.app.net.myId;
    if (ct.busy || (ct.kings && ct.kings.leader !== me)) return false; // (a game on it, or kings: their leader runs it back)
    const rc = this.remoteClaimLine(c), my = this.myLine(), myAt = my && my.c === c ? ct.lines?.[my.r]?.at : null;
    return !(rc && myAt != null && rc.claim.at < myAt); // (the other squad called it first: their leader sets it up)
  }
  // a game that goes through the hosted game: people here to watch it, friends in it, or another squad to play
  useHub(c) {
    const net = this.netHere(); if (!net) return false;
    const my = this.myLine();
    return net.people.size > 0 || !!(my && my.c === c && my.l.realMates?.length) || !!this.remoteClaimLine(c);
  }
  // your own game on a court, not through the hosted game: the people here see the court in use, its score, and you
  // holding it after a win (server/online.py court_state)
  reportCourt(o) { const net = this.app.net, c = this.myCourt; if (net?.connected && c && !this.onlineGame) net.send({ t: 'court', court: this.courts.indexOf(c), ...o }); }
  courtReport(dt) {
    if (this.mode !== 'match' || !this.mySession || this.onlineGame) return;
    if ((this.scoreT = (this.scoreT || 0) - dt) > 0) return;
    this.scoreT = 2;
    const g = this.mySession.game, k = g.score.join('-');
    if (k !== this.scoreKey && !g.over) { this.scoreKey = k; this.reportCourt({ busy: true, score: [g.score[0], g.score[1]] }); }
  }

  // ---- what the hosted game says about this park's courts ----
  onCourts() {
    const net = this.netHere(); if (!net) return;
    const me = net.myId;
    this.courts.forEach((c, ci) => {
      const ct = net.court(ci);
      for (let r = 0; r < c.lines.length; r++) {
        const claim = ct?.lines?.[r] || null, l = c.lines[r];
        if (claim && claim.leader === me) { if (l?.mine) l.realMates = claim.members.filter(id => id !== me); continue; }
        if (claim) {
          if (l?.mine) continue; // (both of you at once: the hosted game says who got it, see onClaimed)
          if (l && !l.remote) this.disperseLine(c, r);
          c.lines[r] = { remote: claim, members: [], mine: false, ready: false, readyAt: 0, squad: claim.members.includes(me) };
        } else if (l?.remote) c.lines[r] = null;
      }
      // real people took the court: the AI game we had on it gives way (their game comes in as a watch)
      if (ct && (ct.busy || (ct.kings && ct.kings.leader !== me)) && c.session && !(c.mine && c === this.myCourt)) this.vacate(c);
      // and gave it back: the park's own games start up on it again (v0.4.8.7: the park's host starts them, for everyone)
      if (!this.realHeld(c) && !c.session && !c.live && !c.mine && !this.disposed && !this.mirroring()) this.newBackgroundGame(c, null);
    });
  }
  onClaimed(m) {
    const c = this.courts[m.court];
    if (m.ok || !c) return;
    if (c.lines[m.spot]?.mine) { this.unclaim(c, true); this.ui.toast(m.text || 'That spot is taken.', 'error'); }
  }
  // park-goers on a spot step off it (a real squad has it now)
  disperseLine(c, r) {
    const l = c.lines[r]; if (!l) return;
    if (l.pending) { this.rerouteLine(c, r); return; } // (v0.4.8.8: a group only on its way: to the other spot if it's free)
    if (!l.dir) for (const w of l.members) { w.spot = null; w.state = 'idle'; w.t = this.rng.range(0.5, 3); } // (the director's line: it breaks up there, for everyone)
    c.lines[r] = null;
  }
  // the AI game on a court ends where it stands: everybody on it walks off
  vacate(c) {
    const s = c.session; if (!s) return;
    if (s.dir) { s.dispose(); c.session = null; return; } // (v0.4.8.7: the director walks them off, for everyone, when the court is taken)
    const g = s.game;
    // (v0.4.8.6: the ICON Squad on it walks off as one, and lines up somewhere else)
    const keep = s.opts.rosters.map((ro, ti) => this.unitOff(c, ro, i => { const p = g.teams[ti]?.[i]; return p ? { x: p.x + c.origin[0], z: p.z + c.origin[2] } : null; }));
    for (const p of g.players) {
      if (this.walkers.length >= 18) break;
      const e = s.opts.rosters[p.team][g.teams[p.team].indexOf(p)];
      if (!e?.aiId || !keep[p.team].includes(e)) continue;
      const w = this.spawnWalker(p.x + c.origin[0], p.z + c.origin[2], e);
      w.leaving = 8;
      if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave();
      this.walkers.push(w);
    }
    s.dispose(); c.session = null; c.kings = null; c.kingsStreak = 0;
  }

  // ---- the people walking around ----
  onPeerPos(m) { if (!this.inGameIds().has(m.from)) this.peers.pos(m); }
  onPeople(m) { this.peers.people(m); }
  clearPeers() { this.peers.clear(); }

  // ---------------- v0.4.8.7: one park for everyone in it ----------------
  // The AI world is the online server's (sim/world.js adoptSharedWorld), so everybody here has the same people online
  // at this park. Who of them is where (on which court, in which line, walking where) and how the courts' games go is
  // the park's own business, so one of the real players here runs it for everyone: the park's host (the lowest account
  // id here; the next one takes over from where it stands the moment he goes). The host plays the park as always and
  // sends it out (pop, twice a second: the courts' games by seed, rosters and tick, the AI lines, the park-goers and
  // where they're heading, the ICON Squad's state, the regulars who hopped on); everyone else plays it as he has it:
  // the same games from the same seeds, kept on his tick (mirrorCourt), the same people walking to the same places.
  // The real people's own claims, kings and games already go through the hosted game (onCourts, the lockstep games).
  popHostId() {
    const net = this.netHere();
    if (!net || !net.people.size || net.myId == null) return null;
    // (v0.4.8.7 qp7: the service picks the host, one answer for everyone: whoever has been here longest. Before it says,
    // the lowest id here)
    if (net.host != null && (net.host === net.myId || net.people.has(net.host))) return net.host;
    let best = net.myId;
    for (const id of net.people.keys()) if (String(id) < String(best)) best = id;
    return best;
  }
  // playing the host's park right now (he's someone else, and he has been heard from lately)
  mirroring() {
    if (this.dirOn()) { if (this.mirrorWas) this.leaveMirror(); this.mirrorWas = false; return false; } // (v0.4.8.7: the director's park: no host to mirror)
    const h = this.popHostId(), net = this.app.net;
    const on = h != null && h !== net?.myId && this.popLast?.from === h && performance.now() - this.popAt < 4000;
    if (!on && this.mirrorWas) this.leaveMirror();
    this.mirrorWas = on;
    return on;
  }
  // AI squad mates the real people here brought: they walk with them on everyone's screen, so they're nobody else's
  peerAIIds() {
    const net = this.netHere(), s = new Set();
    if (!net) return s;
    for (const id of net.people.keys()) for (const a of net.aiOf(id) || []) if (a?.id) s.add(a.id);
    for (const f of this.peers.followers()) if (f.aiId) s.add(f.aiId);
    return s;
  }
  // the host: his park out to the others twice a second
  popTick(dt) {
    if ((this.popSendT = (this.popSendT || 0) - dt) > 0) return;
    this.popSendT = 0.5;
    if (this.dirOn()) return; // (the director runs this park: no host)
    const net = this.netHere();
    if (!net || this.popHostId() !== net.myId) return;
    net.send(this.popSnapshot());
  }
  popSnapshot() {
    const t = Date.now(), u = this.icon, idx = c => this.courts.indexOf(c);
    const ids = es => (es || []).map(e => e?.aiId || null);
    return {
      t: 'pop', place: this.placeKey(), wt: worldNow(t),
      courts: this.courts.map(c => {
        const s = c.session;
        if (!s || c.live || (c === this.myCourt && (this.mySession || this.mode === 'starting'))) return null;
        // (p: how fast this game is going on the host's screen, ticks a millisecond, as he measures it between reports)
        const now = performance.now(), m = c.popMe && c.popMe.s === s.opts.seed ? c.popMe : null;
        const p = m && now - m.at > 100 ? (s.game.tick - m.k) / (now - m.at) : (s.rate || 1) / DT / 1000;
        c.popMe = { s: s.opts.seed, k: s.game.tick, at: now };
        return { s: s.opts.seed, r: s.opts.rosters.map(ids), tm: s.opts.teams.map(x => x.abbr), ks: c.kingsStreak || 0, k: s.game.tick, o: s.game.over ? 1 : 0, rt: s.rate || 1, p: Math.round(Math.max(0, p) * 1e5) / 1e5 };
      }),
      lines: this.courts.map(c => c.lines.map(l => (l && !l.mine && !l.remote ? { ids: l.members.map(w => w.entry.aiId), ...(l.icon != null ? { icon: l.icon } : {}), ...(l.pending ? { p: 1 } : {}) } : null))), // (v0.4.8.8 p: still on its way: holds nothing)
      walkers: this.walkers.filter(w => w.entry?.aiId && w.follow == null && !w.gone).map(w => {
        const p = w.p, sp = w.spot ? [idx(w.spot.court), w.spot.row, w.spot.slot] : null;
        return [w.entry.aiId, Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100, Math.round(p.facing * 100) / 100, Math.round(Math.hypot(p.intent.mx, p.intent.mz) * 100) / 100, p.intent.sprint ? 1 : 0, sp, w.exit ? 1 : 0, w.unit ?? null, w.watch ? 1 : 0];
      }),
      icon: u ? { k: u.k, ids: [...u.ids], formed: !!u.formed, over: u.over ? worldNow(u.over) : 0, end: u.end ? worldNow(u.end) : 0, park: u.park || this.themeId, last: u.last ? idx(u.last) : -1 } : null,
      extra: [...this.world.extra].filter(([, x]) => x.park === this.themeId).map(([id, x]) => [id, worldNow(x.until)]),
    };
  }
  onPop(m) {
    const net = this.netHere();
    if (!net || this.dirOn() || m?.place !== this.placeKey() || m.from == null || m.from !== this.popHostId() || m.from === net.myId) return;
    this.popLast = m; this.popAt = performance.now(); this.mirrorWas = true;
    this.applyPop(m);
  }
  // the host's park, here: his courts' games, his lines, his park-goers, the ICON Squad as he has it
  applyPop(m) {
    const t = Date.now(), skew = worldNow(t) - t, mine = c => c === this.myCourt && (this.mySession || this.mode === 'starting');
    // the park-goers first (the lines are made of them)
    const want = new Map((m.walkers || []).map(a => [a[0], a]));
    const keep = [];
    for (const w of this.walkers) {
      if (w.follow != null || !w.entry?.aiId) { keep.push(w); continue; } // (your own squad walks with you)
      const a = want.get(w.entry.aiId);
      if (!a) { w.dispose(); continue; }
      keep.push(w); want.delete(w.entry.aiId); w.target = null;
      this.mirrorWalker(w, a);
    }
    this.walkers = keep;
    const busy = new Set([...this.world.squad, ...this.peerAIIds()]);
    for (const [id, a] of want) {
      if (busy.has(id) || !/^ai-\d+$/.test(String(id))) continue;
      const w = this.spawnWalker(a[1], a[2], this.entryFor(id));
      this.mirrorWalker(w, a);
      this.walkers.push(w);
    }
    const byId = new Map(this.walkers.filter(w => w.mirror).map(w => [w.entry.aiId, w]));
    // the courts' games: the same game from the same seed, or none
    this.courts.forEach((c, i) => {
      const d = m.courts?.[i];
      if (c.live || mine(c)) return;
      if (!d) { if (c.session) { c.session.dispose(); c.session = null; } c.kings = null; c.kingsStreak = 0; c.popK = null; return; }
      c.kingsStreak = d.ks || 0;
      if (!c.session || c.session.opts.seed !== d.s) {
        if (c.session) c.session.dispose();
        const rosters = (d.r || []).map(r => r.map(id => (id ? this.entryFor(id) : null)).filter(Boolean));
        if (rosters.length !== 2 || rosters.some(r => r.length !== c.format)) { c.session = null; c.kings = null; return; }
        for (const e of [...rosters[0], ...rosters[1]]) e.human = false;
        for (const e of rosters[0]) if (e.build) e.build = { ...e.build, win_streak: c.kingsStreak };
        const team = (abbr, d0) => (abbr === ICON_TEAM.abbr ? { ...ICON_TEAM } : d0);
        c.session = this.bgSession(c, rosters, [team(d.tm?.[0], { name: 'Kings', abbr: 'KNG', color: '#ffd84a' }), team(d.tm?.[1], { name: 'Challengers', abbr: 'CHL', color: '#ff5a36' })], d.s);
        c.kings = rosters[0]; c.bgStart = performance.now();
      }
      // (his pace, as the last two reports show it: ticks a millisecond; a slow PC's game runs slow on his screen and here alike)
      const now = performance.now(), was = c.popK && c.popK.s === d.s ? c.popK : null, pace = Number.isFinite(d.p) ? d.p : (d.rt || 1) / DT / 1000;
      c.popK = { s: d.s, k: d.k, rt: d.rt || 1, at: now, o: d.o, pace: was ? was.pace * 0.5 + pace * 0.5 : pace };
    });
    // the AI lines (yours and the real squads' are the hosted game's)
    this.courts.forEach((c, i) => c.lines.forEach((l, r) => {
      if (l && (l.mine || l.remote)) return;
      const d = m.lines?.[i]?.[r];
      if (!d) { if (l) { for (const w of l.members) if (w.spot?.court === c) w.spot = null; c.lines[r] = null; } return; }
      const members = d.ids.map(id => byId.get(id)).filter(Boolean);
      c.lines[r] = { members, mine: false, ready: false, readyAt: 0, mirror: true, ...(d.icon != null ? { icon: d.icon } : {}), ...(d.p ? { pending: true } : {}) };
      members.forEach((w, slot) => { w.spot = { court: c, row: r, slot }; });
      this.markFull(c, c.lines[r]);
    }));
    // the ICON Squad as the host has it; the regulars who hopped on to fill his courts
    const u = m.icon;
    this.icon = u ? { ...(this.icon?.k === u.k ? this.icon : {}), k: u.k, ids: new Set(u.ids || []), formed: !!u.formed, over: u.over ? u.over - skew : 0, end: u.end ? u.end - skew : 0, park: u.park, last: u.last >= 0 ? this.courts[u.last] || null : null } : null;
    for (const [id, x] of this.world.extra) if (x.park === this.themeId) this.world.extra.delete(id);
    for (const [id, until] of m.extra || []) this.world.extra.set(id, { park: this.themeId, until: until - skew });
  }
  mirrorWalker(w, a) {
    w.mirror = { x: a[1], z: a[2], f: a[3], m: a[4], s: a[5] };
    w.exit = !!a[7]; w.unit = a[8] ?? null; w.follow = null; w.lead = null;
    w.spot = null; // (set again from the lines)
  }
  // a court's game kept on the host's tick: the same game runs here at his pace, a little quicker or slower to stay with
  // him, and caught up at once when it's far behind (a game just picked up, a hitch)
  mirrorCourt(c, dt) {
    const s = c.session, g = s.game, q = c.popK;
    if (!q) { s.rate = this.courtRate(c); s.frame(dt); return; }
    // (where his game is by now: his last report, on at his pace, for a second and a half at most: a host gone quiet for a
    // moment is waited for, not run past)
    const want = q.k + Math.min(1500, performance.now() - q.at) * (q.o ? 0 : q.pace), gap = want - g.tick;
    if (gap > 90 || (gap > 2 && s.visuals.some(v => v.pending))) { // (his players still being built here: the game goes on without them)
      for (let n = 0; n < Math.min(gap, 2400) && !g.over; n++) g.step(DT); // (no events: what happened while he caught up is history)
      g.events.length = 0;
    }
    s.rate = Math.max(1e-4, Math.min(4, (q.pace * 1000 + gap * 0.8) * DT)); // (his pace, closing half the gap in about a second; never 0: the session reads 0 as 1)
    s.frame(dt);
  }
  // leaving the host's park (he left, or went quiet): this one runs it from here, as it stands
  leaveMirror() {
    for (const w of this.walkers) if (w.mirror) { w.mirror = null; w.state = w.exit ? 'walk' : w.spot ? 'queued' : 'idle'; w.t = this.rng.range(0.5, 3); if (w.exit) w.leave(); else if (w.spot) { const sp = w.spot.court.rows[w.spot.row]?.[w.spot.slot]; if (sp) w.goTo(sp.x, sp.z); } }
    for (const c of this.courts) { c.popK = null; c.lines.forEach(l => { if (l?.mirror) delete l.mirror; }); }
    this.popLast = null;
  }
  // the AI world changed under the park (it went online: the server's world): its people go, the new world's come in
  rebaseWorld() {
    this.world = this.app.ai;
    for (const w of this.walkers) if (w.follow == null) w.dispose();
    this.walkers = this.walkers.filter(w => w.follow != null && !w.disposed);
    for (const c of this.courts) {
      c.lines.forEach((l, r) => { if (l && !l.mine && !l.remote) c.lines[r] = null; });
      if (c.session && !(c === this.myCourt && (this.mySession || this.mode === 'starting'))) { c.session.dispose(); c.session = null; c.kings = null; c.kingsStreak = 0; }
    }
    this.icon = null;
    this.specRng = new RNG((hashString(`${this.themeId}|spectators`) ^ (this.world?.seed || 1)) >>> 0);
    if (!this.mirroring()) { this.populationTick(); this.squadTick(); }
  }
  // the people in a game here right now (yours, or one you're watching): they're on the court, not walking about
  inGameIds() {
    const s = new Set();
    for (const c of this.courts) if (c.liveSetup) Object.keys(c.liveSetup.slots || {}).forEach(a => s.add(a));
    if (this.onlineGame) Object.keys(this.onlineGame.slots || {}).forEach(a => s.add(a));
    return s;
  }

  // ---------------- v0.4.8.7: the park director (game/parkdirector.js, game/parklink.js, server/online.py) ----------------
  // With the online server's park director on, nobody's PC hosts the park: the server sequences it (a tick a second, its
  // epoch's seed, the real players' events in one order) and every screen plays the same director from the same snapshot.
  // This screen is its view: the director's park-goers are walkers here going where it has them (dirWalker), its courts'
  // games are DirCourts (the director's own game, drawn only while the court can be seen), its lines, kings, streaks, ICON
  // Squad and hop-ons are this park's (dirCourts). What you do with its people goes back to it as pacts: the AI you take
  // for a game or your Got Next spot (dirLend), the AI you hand back (dirFree: walking off, or kings who beat you holding
  // the court), your squad's ready (dirPact ready), your own AI squad (dirSquad). Off (the flag off, an old server,
  // offline), the park runs here as it always has, and with others here the v0.4.8.7 qp7 host mode.
  dirListen() {
    const net = this.app.net; this.dirHold = new Map(); this.dirOff = [];
    if (!net?.on) return;
    // (the park as the server has it, if it has one: its state may have come before this park was made)
    if (net.connected && net.place === this.themeId) net.send({ t: 'pwant', place: this.themeId });
    // (v0.4.8.7 qp4: and the games on here right now: they may have been offered before this park was made)
    if (net.connected && net.place === this.themeId) net.send({ t: 'rewatch' });
    const st = m => this.onPState(m);
    this.dirOff = [net.on('pstate', st), net.on('presync', st), net.on('pepoch', st), net.on('pev', m => this.link?.event(m)), net.on('pt', m => this.link?.tick(m)),
      // (v0.4.8.7 qp4: another player's own game here, as he plays it)
      net.on('lwatch', m => this.localWatch(m)), net.on('lin', m => this.localIn(m)), net.on('lstop', m => this.localStop(m)),
      net.on('state', () => { if (net.state !== 'on' && this.link?.dir) this.dirLost = this.dirLost || performance.now(); }),
      // (back after the connection dropped, or the server restarted: hand it the park as it stands here)
      net.on('courts', () => {
        if (net.place !== this.themeId) return;
        if (this.link?.dir && this.dirLost) { this.dirLost = 0; this.link.net = net; this.link.resume(); }
        else if (!this.link?.dir && !this.dirAsked) { this.dirAsked = true; net.send({ t: 'pwant', place: this.themeId }); } // (just arrived: in case its state came first)
      })];
  }
  // the director runs this park now (a dropped connection keeps it for 20 s, waiting to hand the park back)
  dirOn() {
    const L = this.link;
    if (!L?.dir) return false;
    if (this.dirLost) return performance.now() - this.dirLost < 20000;
    return !!this.netHere() && L.heard != null && L.serverNow() - L.heard < 10000;
  }
  onPState(m) {
    const net = this.netHere();
    if (!m || !net || this.disposed || m.place !== this.themeId || !this.world?.shared) return;
    if (!this.link) this.link = new ParkLink(net, this.themeId, o => this.dirOpts(o), { out: evs => this.dirOut(evs), reset: () => { this.dirFresh = true; this.dirSqKey = null; } });
    this.link.net = net;
    if (this.link.state(m)) { this.dirLost = 0; this.dirSquad(this.world.activeSquad()); }
  }
  dirOpts({ epoch, t0, seed }) {
    return {
      world: this.world, park: this.themeId, catalog: this.catalog, epoch, t0, seed, surface: this.venue.theme?.court?.surface === 'wood' ? 'wood' : 'asphalt',
      layout: { courts: this.courts.map(c => ({ format: c.format, full: !!c.full, origin: c.origin, rows: c.rows, rect: c.rect })), solids: this.venue.solids || [] },
      toLocal: ms => ms - WORLD_CLOCK.skew, // (the world's functions take this PC's clock and add the skew back)
    };
  }
  dirFrame(dt) {
    const L = this.link;
    if (!L?.dir) return false;
    if (!this.dirOn()) { this.dirStop(); return false; }
    if (!this.dirLost) L.net = this.app.net;
    L.frame(dt);
    this.dirSync();
    return true;
  }
  // off the director (the server stopped answering): this park runs itself again, from a fresh start
  dirStop() {
    this.link = null; this.dirHold.clear(); this.dirLost = 0;
    for (const c of this.courts) if (c.session?.dir) { c.session.dispose(); c.session = null; }
    this.rebaseWorld();
  }
  dirPact(a, f) { return this.dirOn() ? this.link.pact(a, f) : false; }
  dirIds(es) { return [...new Set((es || []).map(e => (typeof e === 'string' ? e : e?.aiId)).filter(id => validAI(id) && !this.world.inSquad(id)))]; }
  dirLend(c, es, r = null) {
    if (!this.dirOn()) return;
    const ids = this.dirIds(es), at = performance.now(); if (!ids.length) return;
    for (const id of ids) this.dirHold.set(id, { a: 'lend', at });
    this.link.pact('lend', { c: this.courts.indexOf(c), ...(r != null ? { r } : {}), ids });
  }
  dirFree(c, es, kings = 0, ks = 0) {
    if (!this.dirOn() || !c) return;
    const ids = this.dirIds(es), at = performance.now(); if (!ids.length) return;
    for (const id of ids) this.dirHold.set(id, { a: 'free', at });
    this.link.pact('free', { c: this.courts.indexOf(c), ids, ...(kings ? { kings: 1, ks } : {}) });
  }
  dirSquad(ids) { const key = (ids || []).join(); if (!this.dirOn() || key === this.dirSqKey) return; this.dirSqKey = key; this.link.pact('squad', { ids: ids.slice(0, 4) }); }
  dirOut(evs) {
    const L = this.link, fresh = L.dir.k >= Math.floor(L.tau()) - 3; // (not while catching up: that's history)
    for (const e of evs) if (e.e === 'icon' && fresh && e.ids?.length === 3) {
      const names = e.ids.map(id => this.world.entry(id)?.name || id);
      this.ui.toast(`ICON SQUAD at ${this.aff?.park || parkInfo(this.themeId)?.park || 'the park'}: ${names.slice(0, -1).join(', ')} and ${names.at(-1)} · here for the next hour`);
    }
  }
  // can the camera see court c (or is it near enough to)? Its game is drawn only then
  courtSeen(c) {
    if (this.overview) return true;
    const cam = this.rig?.pos; if (!cam) return true;
    const d = Math.hypot(c.origin[0] - cam[0], c.origin[2] - cam[2]);
    if (d < 26) return true;
    if (d > 110) return false;
    return !this.vis || M.sphereInFrustum(this.vis.planes, c.origin[0], 1, c.origin[2], c.full ? 22 : 15);
  }
  // the director's park on this screen, every frame
  dirSync() {
    const d = this.link.dir, tau = this.link.tau(), now = performance.now(), me = this.app.net?.myId != null ? String(this.app.net.myId) : null;
    for (const [id, x] of this.dirHold) if (now - x.at > 6000) this.dirHold.delete(id);
    const sq = new Set(this.world.squad), inMine = new Set([...(this.myMates || []), ...(this.myOpp || [])].map(e => e?.aiId).filter(Boolean));
    for (const id of this.squadInGame || []) inMine.add(id);
    for (const c of this.courts) for (const r of c.liveSetup?.rosters || []) for (const e of r) if (e?.aiId) inMine.add(e.aiId);
    const my = this.myLine(), myLine = new Set(my ? my.l.members.map(w => w.entry?.aiId) : []);
    const lent = new Map(d.s.lent.map(l => [l[0], l]));
    // (one of yours on your spot the director never took (he was playing elsewhere): off your spot)
    if (my) for (const w of [...my.l.members]) { const id = w.entry?.aiId; if (id && !sq.has(id) && lent.get(id)?.[1] !== me && !this.dirHold.has(id)) { my.l.members = my.l.members.filter(x => x !== w); my.l.ready = false; my.l.fullAt = 0; myLine.delete(id); this.placeLine(my.c, my.r); } }
    const dw = new Map();
    for (const w of d.s.walkers) if (!sq.has(w.id) && !inMine.has(w.id) && !myLine.has(w.id) && this.dirHold.get(w.id)?.a !== 'lend') dw.set(w.id, w);
    // the AI another squad has on its Got Next spot: after its people and their own AI squad mates
    const onSpot = new Map(), seen = new Map(), net = this.netHere();
    for (const l of d.s.lent) {
      if (l[3] == null || l[1] === me || inMine.has(l[0])) continue;
      const key = `${l[1]}|${l[2]}|${l[3]}`, i = seen.get(key) || 0; seen.set(key, i + 1);
      const row = this.courts[l[2]]?.rows?.[l[3]], slot = 1 + (net?.aiOf(l[1])?.length || 0) + i;
      if (row && slot < row.length) onSpot.set(l[0], { c: l[2], r: l[3], slot, i });
    }
    const byId = new Map(), keep = [];
    for (const w of this.walkers) {
      const id = w.entry?.aiId;
      if (w.follow != null || !id) { keep.push(w); continue; }
      const ok = !byId.has(id) && (dw.has(id) || onSpot.has(id) || myLine.has(id) || (lent.get(id)?.[1] === me && !inMine.has(id)) || this.dirHold.get(id)?.a === 'free');
      if (!ok) { w.dispose(); continue; }
      byId.set(id, w); keep.push(w);
    }
    this.walkers = keep;
    for (const [id, x] of dw) {
      let w = byId.get(id);
      const p = d.posAt(x, tau);
      if (!w) { w = this.spawnWalker(p[0], p[1], this.entryFor(id)); this.walkers.push(w); byId.set(id, w); }
      this.dirWalker(w, x, p);
    }
    for (const [id, s] of onSpot) {
      const c = this.courts[s.c], sp = c.rows[s.r][s.slot];
      let w = byId.get(id);
      if (!w) { w = this.spawnWalker(sp.x, sp.z, this.entryFor(id)); this.walkers.push(w); byId.set(id, w); }
      w.mirror = { x: sp.x, z: sp.z, f: Math.atan2(c.origin[0] - sp.x, c.origin[2] + 8 - sp.z), m: 0.75 };
      w.spot = { court: c, row: s.r, slot: s.slot }; w.state = 'queued'; w.exit = false; w.unit = null; w.watch = null;
    }
    for (const w of this.walkers) { const id = w.entry?.aiId; if (w.follow == null && id && !dw.has(id) && !onSpot.has(id) && w.mirror) { w.mirror = null; w.state = w.exit ? 'walk' : w.spot ? 'queued' : 'idle'; w.t = 1; } }
    if (d.k !== this.dirK || this.dirFresh || this.dirCourtsAt !== this.dirCourtKey()) { this.dirK = d.k; this.dirFresh = false; this.dirCourts(d, byId, onSpot); this.dirCourtsAt = this.dirCourtKey(); }
  }
  // (what decides a court here besides the director: your game, a game you watch, the real people holding it)
  dirCourtKey() { return this.courts.map(c => `${c.mine ? 1 : 0}${c.live ? 1 : 0}${this.realHeld(c) ? 1 : 0}${c.lines.map(l => (l?.mine ? 'm' : l?.remote ? 'r' : l ? 'a' : '-')).join('')}`).join() + `|${this.mode}|${this.myCourt ? this.courts.indexOf(this.myCourt) : -1}`; }
  // one of the director's park-goers: where it has him right now (his leader's step, for the ICON Squad's other two)
  dirWalker(w, x, p) {
    const [px, pz, h, mv] = p;
    let tx = px, tz = pz;
    if (x.lead && x.st !== 'line') { const f = h ?? w.p.facing, lat = (x.slot % 2 ? 1 : -1) * 0.95; tx = px - Math.sin(f) * 1.35 + Math.cos(f) * lat; tz = pz - Math.cos(f) * 1.35 - Math.sin(f) * lat; }
    const c = x.st === 'line' ? this.courts[x.c] : null, wc = x.watch >= 0 ? this.courts[x.watch] : null;
    const face = mv ? h : c ? Math.atan2(c.origin[0] - tx, c.origin[2] + 8 - tz) : wc ? Math.atan2(wc.origin[0] - tx, 6 - tz) : h ?? w.p.facing;
    const top = (w.p.phys?.jog || 4.6) * GAME_SPEED;
    w.mirror = { x: tx, z: tz, f: face, m: mv ? Math.min(1, x.v / top) : 0, s: mv && x.v > top, nj: !!x.lead };
    w.exit = x.st === 'exit'; w.unit = x.unit; w.lead = null; w.follow = null;
    w.spot = c ? { court: c, row: x.r, slot: x.slot } : null;
    w.state = c ? (mv ? 'walk' : 'queued') : mv ? 'walk' : 'idle';
    w.watch = wc ? { x: wc.origin[0], z: 6 } : null;
  }
  dirCourts(d, byId, onSpot) {
    this.courts.forEach((c, ci) => {
      const dc = d.s.courts[ci], run = d.runners[ci], mine = c === this.myCourt && (this.mySession || this.mode === 'starting');
      const real = !!(c.live || c.mine || mine || this.realHeld(c));
      if (dc.g && run && !real) { if (!(c.session?.dir && c.session.seed === dc.g.seed)) { c.session?.dispose(); c.session = new DirCourt(this, c, run, dc.g); } }
      else if (c.session) { c.session.dispose(); c.session = null; }
      const kk = (dc.kings || []).join();
      if (kk !== c.dirKings) { c.dirKings = kk; c.kings = dc.kings ? dc.kings.map(id => this.entryFor(id)) : null; }
      c.kingsStreak = dc.ks || 0;
      dc.lines.forEach((l, r) => {
        const cur = c.lines[r];
        if (cur?.mine) return;
        if (cur?.remote) { cur.members = [...onSpot].filter(([, s]) => s.c === ci && s.r === r).sort((a, b) => a[1].i - b[1].i).map(([id]) => byId.get(id)).filter(Boolean); return; }
        if (l) c.lines[r] = { members: l.ids.map(id => byId.get(id)).filter(Boolean), mine: false, ready: false, readyAt: 0, fullAt: l.full != null ? l.full * 1024 + (l.n % 1024) : 0, dir: true, ...(l.full == null ? { pending: true } : {}), ...(l.icon != null ? { icon: l.icon } : {}) }; // (v0.4.8.8: pending: still on its way)
        else if (cur) c.lines[r] = null;
      });
    });
    // the ICON Squad (for the court cards, the ticker and the phone), the regulars who hopped on
    const u = d.s.icon, tl = d.tl(d.k), sq = u ? d.squadAt(tl) : null;
    this.icon = u ? { k: u.k, ids: new Set(u.ids), formed: !!u.formed, over: u.over ? d.tl(u.over) : 0, end: sq?.k === u.k ? sq.end : 0, last: u.last >= 0 ? this.courts[u.last] || null : null, idle: d.tl(u.idle || 0), park: this.themeId, sq } : null;
    for (const [id, x] of [...this.world.extra]) if (x.park === this.themeId) this.world.extra.delete(id);
    for (const [id, until] of d.s.extra) this.world.extra.set(id, { park: this.themeId, until: d.tl(until) });
  }

  // ---- starting a game ----
  // your squad is set and the court is yours: the squad on the other spot (real or not) or whoever's around runs against you
  startNext(c) {
    if (this.mode !== 'roam') return;
    if (this.netHere() && this.remoteClaimLine(c)) { this.startMyGame(c, null, 0); return; }
    const o = c.lines.findIndex(x => x && !x.mine && !x.remote && this.lineSet(c, x));
    let opp = null;
    // (v0.4.8.7: the director's kings, waiting on the court for you, with their streak)
    if (this.dirOn() && c.kings?.length === c.format && !c.session) { this.startMyGame(c, c.kings.map(e => ({ ...e })), c.kingsStreak || 0); return; }
    if (o >= 0) { opp = c.lines[o].members.map(w => w.entry); this.takeLine(c, o); }
    else if (c.aiKings && performance.now() - c.aiKings.at < 60000) { opp = c.aiKings.entries; c.aiKings = null; } // (the AI who won the game you watched hold the court)
    else { const streak = this.char.progression?.park?.streak || 0; opp = this.takeEntries(c.format, { topUp: true, level: Math.min(0.95, 0.5 + 0.05 * streak) }); }
    this.startMyGame(c, opp, 0);
  }
  // free people (in this park, not in a game) as setup players: {entry, person}
  people(ids) {
    const net = this.netHere(), out = [];
    for (const id of ids) {
      if (id !== net.myId && !net.people.has(id)) continue;
      const p = personOf(this.app, id);
      if (p?.entry) out.push({ entry: p.entry, person: p });
    }
    return out;
  }
  topUp(side, n, opts = {}) {
    if (side.length >= n) return side;
    const ex = new Set(side.map(x => x.entry.aiId).filter(Boolean));
    const more = this.takeEntries(n - side.length, { topUp: true, exclude: ex, have: side.map(x => x.entry), ...opts }) || []; // (v0.4.8.6: have: its ICONs count)
    return [...side, ...more.map(e => ({ entry: e }))];
  }
  // your squad's game: you, your friends in the squad and the park-goers on your spot, against the other squad with next
  // on this court (real people) or the AI opponents
  startHubGame(c, aiOpp, oppStreak = 0) {
    const net = this.netHere(), me = net.myId;
    const li = c.lines.findIndex(l => l?.mine), l0 = li >= 0 ? c.lines[li] : { members: [], realMates: [] };
    // the squad: its people, then everyone's AI squad mates (yours, then your friends' from their games), then park-goers
    const mates = li >= 0 ? this.mateAI(c, l0).map(a => ({ entry: { ...a.entry, sq: { owner: a.owner, id: a.id } } })) : [];
    const ownAI = l0.members.filter(w => this.world.inSquad(w.entry.aiId)), goers = l0.members.filter(w => !ownAI.includes(w));
    const home = this.people([me, ...(l0.realMates || [])]), used = new Set();
    const take = w => {
      if (home.length >= c.format) { w.spot = null; w.state = 'idle'; w.t = 1; return; }
      home.push({ entry: this.world.inSquad(w.entry.aiId) ? { ...w.entry, sq: { owner: me, id: w.entry.aiId } } : w.entry });
      used.add(w); w.dispose();
    };
    ownAI.forEach(take);
    for (const m of mates) if (home.length < c.format) home.push(m);
    goers.forEach(take);
    this.walkers = this.walkers.filter(w => !used.has(w));
    if (li >= 0) c.lines[li] = null;
    const rc = this.remoteClaimLine(c);
    let away;
    // (the other squad: its people and their AI squad mates)
    if (rc) { away = [...this.people(rc.claim.members), ...squadAIPlayers(this.app, rc.claim.members.filter(id => this.netHere().people.has(id)))].slice(0, c.format); this.walkOff(c, aiOpp); oppStreak = 0; }
    else away = (aiOpp || []).map(e => ({ entry: e }));
    const sides = [this.topUp(home, c.format), this.topUp(away, c.format, { exclude: new Set(home.map(x => x.entry.aiId).filter(Boolean)) })];
    this.sendParkGame(c, sides, { streaks: [0, oppStreak], names: [`${net.you.username}'s squad`, rc ? `${net.usernameOf(rc.claim.leader)}'s squad` : 'Court Kings'] });
  }
  // after a win (you hold the court): run it back against the next squad, real or not
  runItBack(session) {
    const net = this.netHere(), c = this.myCourt;
    if (!net || !c) { this.leaveCourt(session, true); return; }
    const me = net.myId, ct = this.ct(c), g = session.game, myTeam = g.human?.team ?? 0;
    const home = this.people([me, ...(ct?.kings?.members || []).filter(id => id !== me)]);
    // the AI who won it with you stay on with you (the squad's AI squad mates and the park-goers from the last game;
    // yours and your park's are themselves again, from your world)
    const byName = new Map((this.myMates || []).map(e => [e.name, e]));
    const aiMine = session.opts.rosters[myTeam].filter(e => !e.human).map(e => e.sq?.owner === me ? { ...this.entryFor(e.sq.id), sq: e.sq } : byName.get(e.name) || e);
    for (const e of aiMine) if (home.length < c.format && !this.world.squadOf?.(e.aiId)) home.push({ entry: e }); // (v0.4.8.6: not one whose ICON Squad's hour has begun)
    const oldOpp = this.onlineGame ? [] : this.myOpp || [];
    session.dispose(); this.mySession = null; this.onlineGame = null;
    if (this.dirOn()) { const keep = new Set(aiMine.map(e => e.aiId)); this.dirFree(c, [...(this.myMates || []), ...(this.myOpp || [])].filter(e => !keep.has(e?.aiId))); } // (v0.4.8.7: off the court in the director's park; the next game's are lent with it: sendParkGame)
    for (const e of this.unitOff(c, oldOpp)) if (this.walkers.length < 16) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] + this.rng.range(-4, 4), e); if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave(); this.walkers.push(w); }
    const rc = this.remoteClaimLine(c);
    let away, nm = 'Challengers';
    if (rc) { away = [...this.people(rc.claim.members), ...squadAIPlayers(this.app, rc.claim.members.filter(id => net.people.has(id)))].slice(0, c.format); nm = `${net.usernameOf(rc.claim.leader)}'s squad`; }
    else {
      const nx = this.upNext(c, false);
      if (nx) { away = nx.l.members.map(w => ({ entry: w.entry })); this.takeLine(c, nx.i); }
      else away = (this.takeEntries(c.format, { topUp: true, level: Math.min(0.97, 0.5 + 0.06 * this.myStreak()) }) || []).map(e => ({ entry: e }));
    }
    const sides = [this.topUp(home, c.format), this.topUp(away, c.format, { exclude: new Set(home.map(x => x.entry.aiId).filter(Boolean)) })];
    this.sendParkGame(c, sides, { streaks: [Math.max(ct?.kings?.streak || 0, this.myStreak()), 0], names: [`${net.you.username}'s squad`, nm] });
  }
  // AI who were going to play walk back into the park instead (v0.4.8.6: the ICON Squad as one)
  walkOff(c, entries) {
    this.dirFree(c, entries || []); // (v0.4.8.7: and in the director's park)
    for (const e of this.unitOff(c, entries || [])) if (this.walkers.length < 16 && e?.aiId) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] + this.rng.range(-4, 4), e); if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave(); this.walkers.push(w); }
  }
  // sides: [[{entry, person?}], [..]] (team 0 first). The game starts on everyone's screen when the hosted game says so
  sendParkGame(c, sides, { streaks = [0, 0], names = ['Squad', 'Court Kings'] } = {}) {
    const app = this.app, net = this.netHere(), people = new Map(), ci = this.courts.indexOf(c);
    const rosters = sides.map(side => side.slice(0, c.format).map(x => { const e = setupEntry(app, x.entry, !!x.person, x.person?.username); if (x.person) people.set(e, x.person); return e; }));
    const { slots, names: seatNames, meter } = seatPeople(rosters, people);
    const humans = [...people.values()];
    const hum = rosters.map(ro => ro.some(e => e.human));
    const abbr = s => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'SQD';
    const unit = sides.map((side, t) => !hum[t] && this.isUnit(side.map(x => x.entry))); // (v0.4.8.6: the ICON Squad plays under its own name)
    const teams = names.map((n, t) => ({ name: hum[t] ? n : unit[t] ? ICON_TEAM.name : t ? 'Court Kings' : n, abbr: hum[t] ? abbr(n) : unit[t] ? ICON_TEAM.abbr : t ? 'KNG' : abbr(n), color: hum[0] && hum[1] ? (t ? '#4ac8ff' : '#ffd84a') : t ? '#e8e3d8' : this.aff.color }));
    const setup = {
      kind: 'park', where: this.themeId, court: ci, format: c.format, full: !!c.full, seed: newSeed(), rosters, teams, slots, names: seatNames, meter,
      delay: humans.length > 1 ? inputDelay(humans.map(p => p.rtt)) : 1, target: app.settings.parkTarget || 21, difficulty: app.settings.difficulty ?? 0.6,
      ante: this.cup ? this.ante || this.cupState?.antes?.[0] || 500 : null, streaks,
    };
    // (the AI from your own park in it: remembered with you afterwards)
    this.myMates = sides[0].filter(x => !x.person && x.entry.aiId).map(x => x.entry);
    this.myOpp = sides[1].filter(x => !x.person && x.entry.aiId).map(x => x.entry);
    if (slots[net.myId] == null) { this.ui.toast('Could not set the game up.', 'error'); return; }
    this.dirLend(c, [...this.myMates, ...this.myOpp]); // (v0.4.8.7: in this game, on every screen: the director's park lends them)
    this.myCourt = c; c.mine = true; this.mode = 'starting';
    this.awaitStart = { at: performance.now(), c };
    net.send({ t: 'start', setup });
  }
  onError() { if (this.awaitStart) this.startFailed(); } // (the hosted game turned the game down: someone's busy)
  startFailed() {
    const c = this.awaitStart?.c; this.awaitStart = null;
    if (this.mode !== 'starting' || this.mySession) return;
    this.netHere()?.send({ t: 'unclaim' });
    this.ui.toast('The game didn\'t start (the hosted game didn\'t answer). Back to the park.', 'error');
    this.walkOff(c, [...(this.myMates || []), ...(this.myOpp || [])]);
    this.myMates = []; this.myOpp = [];
    if (c) { c.mine = false; this.newBackgroundGame(c, null, true); }
    this.myCourt = null; this.mode = 'roam'; this.app.mode = 'park';
    if (!this.meVisual) this.rebuildMe();
  }
  // can a game that comes in from the hosted game start for you now?
  readyForOnline() {
    if (this.mode === 'practice') this.endPractice();
    return this.mode === 'roam' || (this.mode === 'starting' && !!this.awaitStart) || (this.mode === 'match' && !!this.mySession?.ended);
  }

  // ---- your game with real people (or watched by them) ----
  // Every client builds the same game from the setup; local is your player in it. It counts for you like any park game
  // (your own ticket: your VC, Rep, streak and badges, in your own save)
  async startOnlineGame(setup, local) {
    const app = this.app, c = this.courts[setup.court];
    if (!c) throw new Error('That court is not at this park.');
    const decided = !!this.awaitStart;
    this.awaitStart = null;
    // still on the last game's results (the kings ran it back): off that game first
    if (this.mySession) { this.mySession.dispose(); this.mySession = null; }
    // your own Got Next line, if you weren't the one who started this: its park-goers step off
    for (const cc of this.courts) for (let r = 0; r < cc.lines.length; r++) {
      const l = cc.lines[r];
      if (l?.mine) { for (const w of l.members) { w.spot = null; w.state = 'idle'; w.t = 1; } this.dirFree(cc, l.members.map(w => w.entry).filter(e => !this.world.inSquad(e.aiId))); cc.lines[r] = null; cc.mine = false; }
    }
    if (!decided) { this.myMates = []; this.myOpp = []; }
    // your AI squad mates in it (your squad's game, or a friend's who set it up): off the park until it's over
    const me = app.net?.myId;
    this.squadInGame = new Set(setup.rosters.flat().filter(e => e.sq?.owner === me).map(e => e.sq.id));
    const away = this.walkers.filter(w => this.squadInGame.has(w.entry.aiId));
    for (const w of away) { if (w.spot) for (const cc of this.courts) for (const l of cc.lines) if (l) l.members = l.members.filter(x => x !== w); w.dispose(); }
    this.walkers = this.walkers.filter(w => !away.includes(w));
    if (c.session) this.vacate(c);
    if (c.live) this.dropWatch(c, true);
    for (const a of Object.keys(setup.slots || {})) this.peers.drop(a);
    c.mine = true;
    this.myCourt = c; this.mode = 'starting'; this.onlineGame = setup; this.myOppStreak = 0;
    const myTeam = local < setup.rosters[0].length ? 0 : 1, oppStreak = setup.streaks?.[1 - myTeam] || 0;
    let ticket = null;
    try {
      ticket = await app.api.mutate('/api/matches', { character_id: this.char.id, mode: 'park', venue: this.themeId, format: setup.format, target: setup.target, difficulty: setup.difficulty, ante: this.cup ? (this.ante || setup.ante) : undefined, ...(oppStreak >= BOUNTY_MIN ? { bounty_streak: Math.min(99, oppStreak) } : {}) });
      if (ticket.meta.ante) app.setBalance((app.profile.balance || 0) - ticket.meta.ante);
    } catch (e) { ticket = null; this.ui.toast(`This one won't count for you (${e.message}). Playing it anyway.`, 'error'); }
    this.ticket = ticket;
    if (ticket) consumeBoostsLocal(app, ticket);
    if (this.disposed) return;
    const rosters = structuredClone(setup.rosters);
    for (const r of rosters) for (const e of r) e.look = e.look || resolveLook({ ...e.build, name: e.name }, this.catalog);
    // (the same options the game asks for: the other people at full face, the AI at 512, everyone with a far model)
    await this.pool.prebuild(rosters.flat().filter((e, i) => i !== local).map(e => ({ build: e.build, look: e.look, opts: e.human ? { detail: 1, lod: true } : { detail: 1, faceRes: 512, lod: true } })));
    if (this.disposed || this.onlineGame !== setup) return;
    this.lendMe();
    const aids = Object.fromEntries(Object.entries(setup.slots).map(([a, s]) => [s, a]));
    this.mySession = new MatchSession(app, {
      mode: 'park', full: !!setup.full, hub: true, pool: this.pool, scene: this.scene, venue: this.venue, court: c, rosters, teams: setup.teams, seed: setup.seed,
      target: setup.target, difficulty: setup.difficulty,
      online: { net: app.net, local, delay: setup.delay, game: setup.game, meter: setup.meter, names: setup.names, aids, onLost: s => this.onlineLost(s) },
      onEnd: (summary, session) => this.onlineGameOver(summary, session),
    });
    this.mode = 'match'; app.mode = 'match';
    music.duck(true);
    this.ui.matchStarted(this);
    const others = Object.values(setup.names || {}).filter(n => n !== app.net?.you?.username);
    app.hud.pushFeed(others.length ? `Online game with ${others.join(', ')}` : 'Online game · the people here can watch it', 'good');
    if (ticket?.meta.ante) app.hud.pushFeed(`Ante-up: ${ticket.meta.ante.toLocaleString()} VC on the line`, 'good');
  }
  async onlineGameOver(summary, session) {
    const app = this.app, net = app.net, won = summary.winner === summary.me.team, setup = this.onlineGame;
    // (your crew mates in it, real ones, double your crew XP; a friend's crew gets its share from your game)
    const teamAids = Object.entries(setup?.slots || {}).filter(([, s]) => session.game.players[s]?.team === summary.me.team).map(([a]) => a);
    const crewMates = crewMatesIn(app, teamAids);
    // (the AI from your world who ran with you: your AI squad mates and, if you set it up, your park's)
    const mates = [...new Set([...(this.squadInGame || []), ...(this.myMates || []).map(e => e.aiId).filter(Boolean)])].slice(0, 4);
    this.world.recordGame(mates, (this.myOpp || []).map(e => e.aiId).filter(Boolean), won);
    const saving = this.ticket ? app.api.mutate(`/api/matches/${this.ticket.id}/complete`, { summary, mates, crew_mates: Math.min(4, crewMates) }).catch(e => {
      this.ui.toast('Result not saved: ' + e.message, 'error');
      if (e.status === 409 && Number.isFinite(e.data?.balance)) app.setBalance(e.data.balance); // (v0.4.8.7: a disputed game: your ante's back, at once)
      return null;
    }) : Promise.resolve(null);
    await playOutro(app, { summary, session, result: saving });
    const result = await saving;
    if (result) { app.replaceChar(result.character); app.setBalance(result.balance); this.char = app.char(); reportCrewXP(app, result, { mode: 'park', venue: this.themeId, mates: crewMates }); }
    if (this.cup) this.refreshCup();
    if (this.mySession !== session) return; // (the next one already started)
    // the people who won hold the court: their leader runs it back (or leaves it); the rest stay with him or walk off
    const kings = this.realKings(this.myCourt), me = net?.myId;
    const lead = won && kings?.leader === me, member = won && !lead && kings?.members?.includes(me);
    this.ui.results(this, summary, result, won, {
      online: true, players: [...(this.myMates || []), ...(this.myOpp || [])],
      stay: lead ? () => this.runItBack(session) : null,
      back: member ? () => this.leaveOnlineCourt(session, { release: false }) : null,
      leave: () => this.leaveOnlineCourt(session, { release: true }),
      note: lead ? 'You hold the court: run it back against the next squad.' : member ? `${kings.names[0]} holds the court for your squad: stay and he runs it back with you.` : '',
    });
  }
  leaveOnlineCourt(session, { release = true } = {}) {
    const c = this.myCourt, net = this.app.net;
    if (release && c) net?.send({ t: 'release', court: this.courts.indexOf(c) });
    // (v0.4.8.7: the director's park: AI who won it, all AI, hold the court with the streak they had plus this one)
    const g = session?.game, won = g?.over && g.winner != null ? session.opts.rosters[g.winner] : null;
    if (c && won && this.dirOn() && won.every(e => !e.human && e.aiId)) this.dirFree(c, won, 1, (this.onlineGame?.streaks?.[g.winner] || 0) + 1);
    if (session) session.dispose();
    this.mySession = null; this.onlineGame = null;
    this.walkOff(c, [...(this.myMates || []), ...(this.myOpp || [])]);
    this.myMates = []; this.myOpp = [];
    // your AI squad mates come off the court with you
    const back = [...(this.squadInGame || [])];
    this.squadInGame = null;
    if (c) back.forEach((id, i) => { if (!this.walkers.some(w => w.entry.aiId === id) && this.world.inSquad(id)) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] + 3 + i, this.entryFor(id)); w.follow = i; this.walkers.push(w); } });
    if (c) { c.mine = false; c.kingsStreak = 0; this.me.setPos(c.origin[0] + 10.8, c.origin[2] + 2, -Math.PI / 2); if (!this.realHeld(c) || release) this.newBackgroundGame(c, null); }
    this.rebuildMe();
    this.syncSquad();
    this.myCourt = null;
    this.mode = 'roam'; this.app.mode = 'park';
    this.rig.snap();
    this.app.hud.show(false);
    this.ui.backToRoam(this);
  }
  // the connection dropped mid-game: the others play on with the AI in your place; for you it's a forfeit
  async onlineLost(session) {
    if (this.mySession !== session) return;
    if (this.ticket) { try { await this.app.api.post(`/api/matches/${this.ticket.id}/cancel`, {}); endWinStreak(this.app); } catch { /* ignore */ } }
    this.ui.toast('Lost the connection to the game service: you left the game.', 'error');
    this.leaveOnlineCourt(session, { release: false });
  }

  // ---- watching a game from the sideline ----
  // The same game on your screen as on the players': their inputs as they come (and the game so far, when you came late)
  watchGame(setup) {
    const c = this.courts[setup.court];
    if (!c || setup.slots?.[this.app.net?.myId] != null) return;
    if (c.live) this.dropWatch(c, true);
    if (c.session) this.vacate(c);
    for (const a of Object.keys(setup.slots || {})) this.peers.drop(a);
    const rosters = structuredClone(setup.rosters);
    for (const r of rosters) for (const e of r) e.look = e.look || resolveLook({ ...e.build, name: e.name }, this.catalog);
    c.liveSetup = setup; c.liveEndAt = 0;
    c.live = new MatchSession(this.app, {
      background: true, hub: true, pool: this.pool, mode: 'park', full: !!setup.full, scene: this.scene, venue: this.venue, court: c, rosters, teams: setup.teams, seed: setup.seed,
      target: setup.target, difficulty: setup.difficulty,
      online: { net: this.app.net, local: -1, spectate: true, delay: setup.delay, game: setup.game, meter: setup.meter, names: setup.names, onLost: () => { c.liveEndAt = 1; } },
    });
    c.live.animDt = (o, dt, x, z, r) => this.animDt(o, dt, x, z, r); // (qp3 perf: posed only when seen)
  }
  endWatch(g) { for (const c of this.courts) if (c.liveSetup?.game === g && !c.liveEndAt) c.liveEndAt = performance.now(); }

  // ---- v0.4.8.7 qp4: another player's own game here (LocalPub on his screen), watched from the sideline ----
  // The same game as on his screen: built from his setup, played from his inputs a few ticks behind the newest (arriving
  // while it's on: the game so far first, played through quickly), with his models on the court. c.live like a hosted
  // game you watch (the court shows the game, nobody walks onto it, his own walking self steps aside: inGameIds)
  localWatch(m) {
    const setup = m?.setup, c = this.courts[setup?.court], net = this.netHere();
    if (!c || !net || m.from == null || m.from === net.myId || !Array.isArray(setup.rosters) || setup.rosters.length !== 2) return;
    if (c === this.myCourt && (this.mySession || this.mode === 'starting')) return;
    if (c.live) this.dropWatch(c, true);
    if (c.session) this.vacate(c);
    const rosters = structuredClone(setup.rosters);
    for (const r of rosters) for (const e of r) e.look = e.look || resolveLook({ ...e.build, name: e.name }, this.catalog);
    const s = new MatchSession(this.app, { background: true, hub: true, pool: this.pool, mode: 'park', full: !!setup.full, scene: this.scene, venue: this.venue, court: c, rosters, teams: setup.teams, seed: setup.seed, target: setup.target, difficulty: setup.difficulty, assist: !!setup.assist });
    // (his ring is a watched player's, white, not yours)
    s.game.players.forEach((p, i) => { const v = s.visuals[i]; if (!p.human || !v) return; v.ringColor = '#f4f2ec'; if (v.ring) v.ring.material.color = M.hexLinear('#f4f2ec'); });
    // (his game exactly as his screen made it: his auto-play and his green window, not this screen's settings)
    const g = new Game({ mode: 'park', full: !!setup.full, seed: setup.seed, rosters, catalog: this.catalog, target: setup.target, surface: this.venue.theme?.court?.surface === 'wood' ? 'wood' : 'asphalt', difficulty: setup.difficulty ?? 0.6, assist: !!setup.assist, greenBonus: setup.greenBonus || 1, multi: false, inputDelay: 0, parkCards: this.venue.theme?.kind === 'park' });
    g.teamsMeta = setup.teams; spreadGreens(g.players, this.catalog);
    s.game = g;
    s.animDt = (o, d0, x, z, r) => this.animDt(o, d0, x, z, r);
    s.lw = { from: m.from, dec: { k: 0, it: {} }, recs: new Map(), maxK: 0, checked: 0, bad: 0 };
    s.frame = dt => this.localWatchFrame(s, dt);
    c.live = s; c.liveEndAt = 0;
    c.liveSetup = { ...setup, rosters, local: true, from: m.from, slots: { [m.from]: 0 }, names: setup.names || {} };
    this.peers.drop?.(m.from);
    this.localIn({ from: m.from, k: m.k, b: m.b });
  }
  localIn(m) {
    for (const c of this.courts) {
      const s = c.live, lw = s?.lw;
      if (!lw || lw.from !== m?.from || !Number.isInteger(m.k) || !Array.isArray(m.b)) continue;
      takeInputs(lw.dec, m.k, m.b, (t, it) => { lw.recs.set(t, it); lw.maxK = t; });
    }
  }
  localStop(m) { for (const c of this.courts) if (c.live?.lw && c.live.lw.from === m?.from && !c.liveEndAt) c.liveEndAt = performance.now(); }
  // his game here: a few ticks behind his newest input at his pace; a long way behind (just arrived), through quickly
  localWatchFrame(s, dt) {
    const g = s.game, lw = s.lw, evs = s.frameEvents = [];
    let n = 0;
    if (lw.maxK - g.tick > 30) { while (n < 90 && g.tick < lw.maxK - 6) { this.localStep(s, evs); n++; } s.acc = 0; }
    else {
      s.acc = Math.min(s.acc + Math.min(0.1, dt) * (g.speed || 1), DT * 12);
      while (s.acc >= DT && g.tick < lw.maxK - 2 && n < 8) { this.localStep(s, evs); s.acc -= DT; n++; }
    }
    if (g.over && !s.ended) { s.ended = true; s.endT = 0; }
    if (s.ended) s.endT += dt;
    s.lastEvents = evs;
    s.render(dt);
  }
  localStep(s, evs) {
    const g = s.game, lw = s.lw, k = g.tick + 1, rec = lw.recs.get(k) || {};
    lw.recs.delete(k);
    const { _a, _l, _h, _k, ...it } = rec;
    if (_h != null) { lw.checked++; if (g.stateHash() !== _h && !lw.bad++) console.warn('[park] a game you watch went its own way at tick', k); }
    g.assist = !!_a; g.lockIn = _l == null ? null : { id: g.human?.id, idx: _l };
    if (!_k) g.setInput({ ...BLANK_IT, ...it }); // (_k: none that tick on his screen: the last one stands)
    g.step(DT);
    s.celebrationEffects(g.events); // (the part of the events that changes the game: as on his screen)
    s.backgroundEvents(g.events);
    for (const e of g.events) evs.push(e);
  }
  dropWatch(c, now = false) {
    const s = c.live; if (!s) return;
    const g = s.game, setup = c.liveSetup;
    // the AI won it: they hold the court (for the next squad to play), unless real people do
    if (!now && g.over && g.winner != null && !setup.rosters[g.winner].some(e => e.human)) c.aiKings = { entries: setup.rosters[g.winner].map(e => ({ ...e, human: false })), at: performance.now() };
    s.dispose(); c.live = null; c.liveSetup = null; c.liveEndAt = 0;
    if (!now && !this.realHeld(c) && !c.mine && !c.session) this.newBackgroundGame(c, null);
  }

  dispose() {
    this.disposed = true;
    this.peers.detach(); // (qp7: and stops listening for their emotes)
    this.recordTags?.dispose(); this.recordTags = null;
    for (const f of this.dirOff || []) f?.(); // (v0.4.8.7: and to the park director)
    this.localPub?.stop(); this.localPub = null;
    for (const c of this.courts) if (c.live) c.live.dispose();
    for (const c of this.courts) if (c.fx) c.fx.dispose();
    for (const sp of this.spectators || []) sp.dispose();
    for (const w of this.walkers) w.dispose();
    for (const c of this.courts) if (c.session) c.session.dispose();
    if (this.mySession) this.mySession.dispose();
    if (this.practice) this.practice.dispose();
    if (this.meVisual) this.meVisual.dispose();
    this.pool.dispose();
    releaseScene(this.r?.ctx, this.scene); // (QP3: the park's own geometry and textures; the caches keep theirs)
  }
}

// ---------- exported helpers ----------
// v0.4.7.5: tiers as they play on this build (a badge above the build's cap plays at the cap)
export function badgeTiers(char) { const o = {}; for (const [k, v] of Object.entries(char.badges || {})) if (v.tier) o[k] = v.tier; return capBadges(o, char.archetype || char.height ? char : null); }
