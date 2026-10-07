// The Park hub: free roam, park-goers, live AI games on every court, Got Next queues, winner stays.
// v0.4.4: everyone here is a persistent AI account from this player's world (sim/world.js). Who shows up
// depends on who is online at this park right now; people arrive and log off as you play, your squad
// follows you around and runs with you, and every game is remembered for the social phone.
import { playOutro } from '../ui/outro.js';
import { music } from '../core/music.js';
import { promptGlyph } from '../core/input.js';
import { Scene } from '../gfx/renderer.js';
import { buildVenue } from '../world/venues.js';
import { AFFILIATIONS, THEMES, courtPlayRect } from '../world/themes.js';
import { boostedBuild } from '../sim/ratings.js';
import { consumeBoostsLocal } from '../ui/rewards.js';
import { Player } from '../sim/player.js';
import { COURT } from '../sim/constants.js';
import { RNG } from '../core/rng.js';
import { resolveLook } from '../sim/bots.js';
import { PlayerVisual, MatchSession } from './session.js';
import { audio } from '../core/audio.js';
import * as M from '../core/math.js';

// v0.4.2 layout: full courts at x = -26, 0, 26; 2v2 annex at x = -52; 1v1 + practice annex at x = 52
const ZONES = [
  { x0: -46, x1: 46, z0: -30, z1: -21.5, w: 4 }, // south plaza
  { x0: 11, x1: 15, z0: -12, z1: 12, w: 1 }, // gap main/east
  { x0: -15, x1: -11, z0: -12, z1: 12, w: 1 }, // gap main/west
  { x0: 37.5, x1: 40.5, z0: -14, z1: 14, w: 1 }, // gap east court / 1v1 annex
  { x0: -40.5, x1: -37.5, z0: -14, z1: 14, w: 1 }, // gap west court / 2v2 annex
];
const pickIn = (rng, z) => ({ x: rng.range(z.x0, z.x1), z: rng.range(z.z0, z.z1) });

class Walker {
  constructor(hub, entry, x, z) {
    this.hub = hub;
    this.entry = entry;
    this.p = new Player(0, 0, { build: entry.build, name: entry.name }, hub.app.catalog);
    this.p.setPos(x, z, hub.rng.range(-3, 3));
    this.visual = new PlayerVisual(hub.r, hub.scene, entry.build, entry.look, { detail: 0.75 });
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
    // route through the south plaza so walkers never cross active courts
    const p = this.p, path = [];
    const inMid = (px, pz) => pz > -19.5 && Math.abs(px) < 63;
    if (inMid(p.x, p.z) || inMid(x, z)) { path.push({ x: p.x, z: -21.5 }); path.push({ x, z: -21.5 }); }
    path.push({ x, z });
    this.path = path.filter((w, i) => i === path.length - 1 || Math.hypot(w.x - p.x, w.z - p.z) > 0.5);
    this.state = 'walk';
  }
  update(dt) {
    const p = this.p, it = p.intent;
    it.mx = 0; it.mz = 0; it.sprint = false; it.face = null;
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
    p.move(dt, false, 0);
    for (const s of this.hub.venue.solids || []) pushOut(p, s);
    // v0.4.2: park-goers never wander onto a court while a game is on (walking off after a loss is fine)
    if (!(this.leaving > 0) && this.follow == null) for (const c of this.hub.courts) if (c.session || c.mine) pushOut(p, c.rect);
    if (this.leaving > 0) this.leaving -= dt;
    p.stamina = 1;
  }
  render(dt) {
    const p = this.p;
    this.visual.anim.update(dt, { x: p.x, y: 0, z: p.z, facing: p.facing }, p, null, null, {});
    this.visual.place(p.x, 0, p.z);
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
    this.aff = AFFILIATIONS[themeId];
    this.rng = new RNG((Date.now() & 0xffff) ^ 0x5a5a);
    this.mode = 'roam';
    this.catalog = app.catalog;
    const char = app.char();
    this.char = char;
    // my roaming player
    this.meEntry = { build: { ...char }, name: char.name, look: app.look(char), human: true, badges: badgeTiers(char) };
    this.me = new Player(0, 0, { build: char, name: char.name }, app.catalog);
    this.me.setPos(11.5, -18.5, 0);
    this.meVisual = new PlayerVisual(this.r, this.scene, char, this.meEntry.look, { detail: 1 });
    this.meVisual.addRing(this.r, this.aff.color);
    // v0.4.4: the park's people come from this account's AI world: whoever is online here right now
    this.world = app.ai;
    this.walkers = [];
    this.myMates = []; this.myOpp = [];
    // live courts first (a quiet park can leave courts empty), then whoever is left hangs around
    this.courts = this.venue.courts.map(c => ({ ...c, rect: courtPlayRect(c), session: null, queue: [], mine: false, readyAt: 0, kings: null, kingsStreak: 0 }));
    for (const c of this.courts) this.newBackgroundGame(c, null);
    for (const id of this.availableHere().slice(0, 9)) {
      const z = this.pickZone(), q = pickIn(this.rng, z);
      this.walkers.push(this.spawnWalker(q.x, q.z, this.entryFor(id)));
    }
    this.popT = 15;
    this.syncSquad(true);
    this.rig = app.cameraRig;
    this.rig.roamYaw = 0; this.rig.snap();
    this.claimT = 0; this.claimCourt = null;
    this.mySession = null; this.practice = null;
    this.prompt = '';
    audio.setCrowd(0.1); audio.setIndoor(false);
    audio.surface = 'asphalt';
  }

  pickZone() { const tot = ZONES.reduce((s, z) => s + z.w, 0); let r = this.rng.next() * tot; for (const z of ZONES) { r -= z.w; if (r <= 0) return z; } return ZONES[0]; }

  // ---------- v0.4.4 population ----------
  entryFor(id) { const e = this.world.gameEntry(id); e.look = resolveLook(e.build, this.catalog); return e; }
  // everyone physically in the park (walkers, courts, lines, my game)
  busyIds() {
    const s = new Set(), add = e => { if (e?.aiId) s.add(e.aiId); };
    for (const w of this.walkers) add(w.entry);
    for (const c of this.courts) { if (c.session) for (const r of c.session.opts.rosters) r.forEach(add); c.queue.forEach(w => add(w.entry)); }
    (this.myMates || []).forEach(add); (this.myOpp || []).forEach(add);
    return s;
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
      if (!initial) { const from = this.world.status(id)?.park; this.ui.toast(`${w.entry.name} is on his way${from && from !== this.themeId ? ' over from ' + (AFFILIATIONS[from]?.park || 'another park') : ''}.`); }
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
      c.queue.forEach(w => add(w.entry, c.mine ? `Got next with you on ${c.name}` : `Got next on ${c.name}`));
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
    if (c.queue.length === fmt && !c.mine) { away = c.queue.map(w => w.entry); c.queue.forEach(w => w.dispose()); this.walkers = this.walkers.filter(w => !c.queue.includes(w)); c.queue = []; }
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
    c.session = new MatchSession(this.app, { background: true, hub: true, mode: 'park', full: !!c.full, scene: this.scene, venue: this.venue, court: c, rosters: [home, away], teams: [{ name: 'Kings', abbr: 'KNG', color: '#ffd84a' }, { name: 'Challengers', abbr: 'CHL', color: '#ff5a36' }], seed: this.rng.int(1, 1e9), target: 11, difficulty: 0.6, assist: true });
    c.bgStart = performance.now();
  }

  // ---------------- frame ----------------
  frame(dt) {
    const app = this.app, inp = app.input;
    this.venue.update(dt);
    this.venue.practice.hoop.update(dt, this.practice ? null : null);
    // background courts
    for (const c of this.courts) {
      if (c.session) {
        c.session.frame(dt);
        const g = c.session.game;
        // my squad is waiting: wrap the current game up
        if (c.queueReady && !g.over && (performance.now() - c.readyAt) > 25000) { const lead = g.score[0] >= g.score[1] ? 0 : 1; g.finish(lead); }
        if (g.over && c.session.ended && c.session.endT > 2.2) this.rotateCourt(c);
      }
    }
    for (const w of this.walkers) { w.update(dt); if (!w.gone) w.render(dt); }
    if (this.walkers.some(w => w.gone)) { for (const w of this.walkers) if (w.gone) w.dispose(); this.walkers = this.walkers.filter(w => !w.gone); }
    this.popT -= dt;
    if (this.popT <= 0) { this.popT = 20; this.populationTick(); }
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
    if (this.app.modalOpen()) { me.intent.mx = me.intent.mz = 0; me.move(dt, false, 0); this.meVisual.anim.update(dt, { x: me.x, y: 0, z: me.z, facing: me.facing }, me, null, null, {}); this.meVisual.place(me.x, 0, me.z); this.rig.updateRoam(dt, me, null, this.venue.bounds, this.venue.solids); return; }
    if (inp.wasPressed('pause')) { this.ui.pause(this); return; }
    const mv = inp.moveVector();
    const basis = this.rig.inputBasis();
    me.intent.mx = basis.rx * mv.x + basis.fx * mv.y;
    me.intent.mz = basis.rz * mv.x + basis.fz * mv.y;
    me.intent.sprint = inp.isDown('sprint');
    me.intent.face = null; me.intent.stickFace = true;
    me.move(dt, false, 0);
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

  gotNext(dt) {
    const me = this.me;
    let on = null;
    for (const c of this.courts) for (let i = 0; i < c.spots.length; i++) if (Math.hypot(me.x - c.spots[i].x, me.z - c.spots[i].z) < 0.75) on = { c, i };
    const mineCourt = this.courts.find(c => c.mine);
    if (on && !mineCourt) {
      if (on.c.queue.length && !on.c.mine) { this.prompt = `Court taken — ${on.c.queue.length}/${on.c.format} already have next`; return; }
      this.claimT += dt; this.claimCourt = on.c;
      this.prompt = `Claiming Got Next on ${on.c.name}… ${Math.max(0, 1.2 - this.claimT).toFixed(1)}s`;
      if (this.claimT > 1.2) this.claim(on.c, on.i);
    } else this.claimT = 0;
    if (mineCourt) {
      const n = mineCourt.queue.length + 1;
      if (Math.hypot(me.x - mineCourt.spots[0].x, me.z - mineCourt.spots[0].z) > 6) { this.unclaim(mineCourt); this.ui.toast('You left the Got Next line.'); return; }
      this.prompt = n < mineCourt.format ? `You've got next on ${mineCourt.name} · waiting for teammates (${n}/${mineCourt.format})` : `Squad ready on ${mineCourt.name} · next game starts after this one`;
      this.fillQueue(mineCourt, dt);
    }
  }

  claim(c, slot) {
    c.mine = true; c.queue = []; this.claimT = 0;
    audio.ui('buy');
    this.ui.toast(`Got next on ${c.name}! Teammates are on the way.`);
    this.fillT = 1.5;
  }
  unclaim(c) {
    c.mine = false; c.queueReady = false;
    for (const w of c.queue) { w.spot = null; w.state = 'idle'; w.t = 1; }
    c.queue = [];
    this.syncSquad(); // squad mates fall back in behind you
  }
  fillQueue(c, dt) {
    if (c.queue.length + 1 >= c.format) {
      if (!c.queueReady && c.queue.every(w => w.state === 'queued')) {
        c.queueReady = true; c.readyAt = performance.now(); this.ui.toast('Squad is ready. You run next!');
        // v0.4.4: an empty court (quiet hours): whoever is around steps up to run against you
        if (!c.session) {
          const streak = this.char.progression?.park?.streak || 0;
          const opp = this.takeEntries(c.format, { topUp: true, level: Math.min(0.95, 0.5 + 0.05 * streak) });
          this.startMyGame(c, opp);
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
    if (!w) {
      const free = this.walkers.filter(x => !x.spot && x.follow == null && !x.exit).sort((a, b) => Math.hypot(a.p.x - c.spots[0].x, a.p.z - c.spots[0].z) - Math.hypot(b.p.x - c.spots[0].x, b.p.z - c.spots[0].z));
      w = free[0];
      if (!w || this.rng.next() < 0.35) { const e = this.takeEntries(1, { topUp: true, walkers: false }); if (e) { w = this.spawnWalker(this.rng.range(-20, 20), -29, e[0]); this.walkers.push(w); } }
      if (!w) return;
    }
    const idx = c.queue.length + 1;
    w.spot = { court: c, slot: idx };
    w.goTo(c.spots[idx].x, c.spots[idx].z);
    c.queue.push(w);
  }

  rotateCourt(c) {
    const s = c.session, g = s.game;
    const winners = s.opts.rosters[g.winner];
    const losers = s.opts.rosters[1 - g.winner];
    // losers walk off into the park (or log off and head home)
    for (let i = 0; i < g.teams[1 - g.winner].length && this.walkers.length < 16; i++) {
      const p = g.teams[1 - g.winner][i];
      const w = this.spawnWalker(p.x + c.origin[0], p.z + c.origin[2], losers[i]);
      w.leaving = 8;
      if (this.stays(losers[i])) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave();
      this.walkers.push(w);
    }
    c.kingsStreak = g.winner === 0 ? (c.kingsStreak || 0) + 1 : 1;
    if (c.mine && c.queueReady) {
      s.dispose(); c.session = null;
      // kings who logged off (or left to join your squad) are replaced by whoever's around
      const opp = winners.every(e => this.stays(e) && !this.world.inSquad(e.aiId)) ? winners : this.takeEntries(c.format, { topUp: true, exclude: new Set(c.queue.map(w => w.entry.aiId)) });
      this.startMyGame(c, opp);
      this.syncSquad();
      return;
    }
    // winners stay on; anyone who just logged off walks out instead
    const leaving = winners.filter(e => !this.stays(e) || this.world.inSquad(e.aiId));
    if (leaving.length) {
      s.opts.rosters[g.winner] = []; // so they no longer count as busy on this court
      winners.forEach((e, i) => { if (!leaving.includes(e)) return; const p = g.teams[g.winner][i]; const w = this.spawnWalker(p.x + c.origin[0], p.z + c.origin[2], e); w.leaving = 8; if (this.world.inSquad(e.aiId)) w.follow = 0; else w.leave(); this.walkers.push(w); });
    }
    this.newBackgroundGame(c, leaving.length ? null : winners);
    if (leaving.length) this.syncSquad();
  }

  // ---------------- my games ----------------
  async startMyGame(c, opponents, streakRetry = false) {
    const app = this.app;
    this.mode = 'starting';
    let ticket;
    try {
      ticket = await app.api.mutate('/api/matches', { character_id: this.char.id, mode: 'park', venue: this.themeId, format: c.format, target: app.settings.parkTarget, difficulty: app.settings.difficulty });
    } catch (e) {
      this.ui.toast(e.message, 'error'); this.mode = 'roam'; this.unclaim(c); this.newBackgroundGame(c, opponents); return;
    }
    this.ticket = ticket;
    consumeBoostsLocal(app, ticket);
    const mates = c.queue.map(w => w.entry);
    for (const w of c.queue) w.dispose();
    this.walkers = this.walkers.filter(w => !c.queue.includes(w));
    this.myMates = mates;
    this.myOpp = opponents;
    c.queue = []; c.queueReady = false;
    this.startSession(c, opponents, ticket);
  }

  startSession(c, opponents, ticket) {
    const app = this.app;
    this.meVisual.view.setVisible(false); this.meVisual.blob.visible = false; if (this.meVisual.ring) this.meVisual.ring.visible = false;
    const meEntry = { ...this.meEntry, human: true, look: app.look(app.char()) };
    meEntry.build = boostedBuild(app.char(), ticket.meta.boosts);
    const mine = [meEntry, ...this.myMates.map(e => ({ ...e, human: false }))];
    const opp = opponents.map(e => ({ ...e, human: false }));
    const teams = [{ name: this.aff.name, abbr: 'YOU', color: this.aff.color }, { name: 'Court Kings', abbr: 'KNG', color: '#e8e3d8' }];
    this.myCourt = c;
    this.myOpp = opponents;
    this.mySession = new MatchSession(app, {
      mode: 'park', full: !!c.full, hub: true, scene: this.scene, venue: this.venue, court: c, rosters: [mine, opp], teams, seed: ticket.seed,
      target: ticket.meta.target, difficulty: ticket.meta.difficulty,
      onEnd: (summary, session) => this.myGameOver(summary, session),
    });
    this.mode = 'match';
    app.mode = 'match';
    music.duck(true); // v0.4.4: the soundtrack keeps going under park games
    this.ui.matchStarted(this);
    if (ticket.meta.boosts?.length) app.hud.pushFeed(`Boosts active: ${ticket.meta.boosts.map(k => app.config.boosts?.categories?.[k]?.name || k).join(', ')} (+${app.config.boosts?.amount || 5})`, 'good');
  }

  async myGameOver(summary, session) {
    const app = this.app;
    // v0.4.4: remember who you ran with and against (social phone: recent players)
    const won0 = summary.winner === summary.me.team;
    this.world.recordGame((this.myMates || []).map(e => e.aiId).filter(Boolean), (this.myOpp || []).map(e => e.aiId).filter(Boolean), won0);
    // v0.4.3: the box-score outro shows while the result saves, then fills the Rep bar live
    const saving = app.api.mutate(`/api/matches/${this.ticket.id}/complete`, { summary }).catch(e => { this.ui.toast('Result not saved: ' + e.message, 'error'); return null; });
    await playOutro(app, { summary, session, result: saving });
    const result = await saving;
    if (result) { app.replaceChar(result.character); app.setBalance(result.balance); this.char = app.char(); }
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
    const challengers = this.takeEntries(c.format, { topUp: true, level: Math.min(0.97, 0.5 + 0.06 * (this.char.progression?.park?.streak || 0)) });
    for (const e of challengers) e.look = e.look || resolveLook(e.build, this.catalog);
    this.myOpp = challengers;
    this.mode = 'starting';
    this.app.api.mutate('/api/matches', { character_id: this.char.id, mode: 'park', venue: this.themeId, format: c.format, target: this.app.settings.parkTarget, difficulty: this.app.settings.difficulty })
      .then(ticket => { this.ticket = ticket; consumeBoostsLocal(this.app, ticket); this.startSession(c, challengers, ticket); })
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
    // court continues: whoever won keeps the court (if I won and left, fresh kings)
    const opp = this.myOpp; this.myOpp = [];
    if (won && opp) for (const e of opp) if (this.walkers.length < 16) { const w = this.spawnWalker(c.origin[0] + 10.5, c.origin[2] - 4, e); if (this.stays(e)) w.goTo(...Object.values(pickIn(this.rng, ZONES[0]))); else w.leave(); this.walkers.push(w); }
    this.newBackgroundGame(c, won ? null : opp);
    // put me on the sideline
    this.me.setPos(c.origin[0] + 10.8, c.origin[2] + 2, -Math.PI / 2);
    this.meVisual.view.setVisible(true); this.meVisual.blob.visible = true; if (this.meVisual.ring) this.meVisual.ring.visible = true;
    // refresh my visual with any new gear
    this.rebuildMe();
    this.syncSquad();
    this.mode = 'roam';
    this.app.mode = 'park';
    this.rig.snap();
    this.app.hud.show(false);
    this.ui.backToRoam(this);
  }

  rebuildMe() {
    const char = this.app.char();
    this.char = char;
    this.meEntry = { build: { ...char }, name: char.name, look: this.app.look(char), human: true, badges: badgeTiers(char) };
    this.meVisual.dispose();
    this.meVisual = new PlayerVisual(this.r, this.scene, char, this.meEntry.look, { detail: 1 });
    this.meVisual.addRing(this.r, this.aff.color);
  }

  startPractice() {
    const app = this.app, char = app.char();
    const pr = this.venue.practice;
    const court = { id: 'practice', origin: [pr.origin[0], 0, pr.origin[2] - COURT.hoopZ + 4], hoops: [pr.hoop], format: 1 };
    this.meVisual.view.setVisible(false); this.meVisual.blob.visible = false; if (this.meVisual.ring) this.meVisual.ring.visible = false;
    const entry = { ...this.meEntry, human: true, build: { ...char } };
    this.practice = new MatchSession(app, { mode: 'practice', hub: true, scene: this.scene, venue: this.venue, court, rosters: [[entry], []], teams: [{ name: 'You', abbr: 'YOU', color: this.aff.color }, { name: '', abbr: '', color: '#888' }], seed: 7 });
    this.mode = 'practice';
    this.app.hud.show(true);
    this.ui.toast('Shootaround — Esc to stop');
  }
  endPractice() {
    this.practice.dispose(); this.practice = null;
    this.meVisual.view.setVisible(true); this.meVisual.blob.visible = true; if (this.meVisual.ring) this.meVisual.ring.visible = true;
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
  dispose() {
    for (const w of this.walkers) w.dispose();
    for (const c of this.courts) if (c.session) c.session.dispose();
    if (this.mySession) this.mySession.dispose();
    if (this.practice) this.practice.dispose();
    this.meVisual.dispose();
  }
}

export function badgeTiers(char) { const o = {}; for (const [k, v] of Object.entries(char.badges || {})) if (v.tier) o[k] = v.tier; return o; }
