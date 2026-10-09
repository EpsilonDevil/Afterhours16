// v0.4.5 Crews: the Crew HQ. Walk in from the HQ building on any park's plaza. Your crew members who are
// online right now hang out here: on the couches and the bleacher, around the lounge, or getting shots up on
// a free hoop. Shoot around on the side court, open the crew menu at the members board, and run a practice
// 5-on-5 on the main court once at least four crew members are on (you and four of them against the next ones
// on, topped up with regulars). Crew runs are practice: no VC, Rep or crew XP. Interior customization and
// level rewards are coming soon.
import { Scene } from '../gfx/renderer.js';
import { buildVenue } from '../world/venues.js';
import { HQ, courtPlayRect } from '../world/themes.js';
import { Player } from '../sim/player.js';
import { resolveLook } from '../sim/bots.js';
import { PlayerVisual, MatchSession } from './session.js';
import { GAME_SPEED } from '../sim/game.js';
import { VisualPool } from './vispool.js';
import { badgeTiers } from './park.js';
import { promptGlyph } from '../core/input.js';
import { RNG } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { music } from '../core/music.js';
import { settings } from '../core/settings.js';
import * as M from '../core/math.js';

export const RUN_MIN = 4;   // crew members online needed for a 5-on-5 (you make five)
const MAX_PEOPLE = 12;      // bodies on the floor (plus up to two shooters)
// where people stand around when they aren't sitting or shooting
const ZONES = [
  { x0: 12.5, x1: 22.5, z0: -18.6, z1: -6.5, w: 3 },   // the lounge
  { x0: 8.5, x1: 9.4, z0: -13, z1: 12, w: 1 },          // east sideline of the main court
  { x0: -9.5, x1: 8, z0: -19.6, z1: -16.8, w: 1.4 },    // behind the south baseline
  { x0: 11.4, x1: 12.4, z0: -1.5, z1: 12, w: 0.8 },     // west edge of the shootaround court
];
// seats: couch cushions (facing the members board) and the bleacher's front row (facing the main court)
const SEATS = [
  ...HQ.couches.flatMap(([x, z, yaw]) => [-0.85, 0, 0.85].map(dz => ({ x: x + 0.14 * Math.sin(yaw), z: z + dz, f: yaw }))),
  ...[-4.2, -2.6, -1, 1, 2.6, 4.2].map(z => ({ x: HQ.bleacher.x + 0.06, z: HQ.bleacher.z + z, f: Math.PI / 2 })),
];

const pickIn = (rng, z) => ({ x: rng.range(z.x0, z.x1), z: rng.range(z.z0, z.z1) });
function pushOut(p, b) {
  const r = p.phys.radius;
  if (p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r) return;
  const dl = p.x - (b.x0 - r), dr = (b.x1 + r) - p.x, dn = p.z - (b.z0 - r), df = (b.z1 + r) - p.z;
  const m = Math.min(dl, dr, dn, df);
  if (m === dl) p.x = b.x0 - r; else if (m === dr) p.x = b.x1 + r; else if (m === dn) p.z = b.z0 - r; else p.z = b.z1 + r;
}
function separate(a, b, staticB = false) {
  const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), r = (a.phys.radius + b.phys.radius) * 0.9;
  if (d < r && d > 1e-4) { const k = (r - d) / d; a.x += dx * k * (staticB ? 1 : 0.5); a.z += dz * k * (staticB ? 1 : 0.5); if (!staticB) { b.x -= dx * k * 0.5; b.z -= dz * k * 0.5; } }
}

// a crew member on the floor: walking around the HQ, standing and talking, or sitting
class Member {
  constructor(hq, id, entry, x, z, seat = null) {
    this.hq = hq; this.id = id; this.entry = entry; this.seat = seat;
    this.p = new Player(0, 0, { build: entry.build, name: entry.name }, hq.app.catalog);
    this.p.setPos(seat ? seat.x : x, seat ? seat.z : z, seat ? seat.f : hq.rng.range(-3, 3));
    this.visual = new PlayerVisual(hq.r, hq.scene, entry.build, entry.look, { detail: 0.75, pool: hq.pool });
    this.target = null; this.t = hq.rng.range(1, 6); this.leaving = false; this.gone = false;
    this.prog = { d: Infinity, t: 0 };
    if (seat) { this.p.action = { type: 'celebrate', kind: 'sit', t: 0.3, dur: 1e6, id: 0 }; this.settle(); }
  }
  settle() { const p = this.p; for (let i = 0; i < 4; i++) this.visual.anim.update(0.1, { x: p.x, y: 0, z: p.z, facing: p.facing }, p, null, null, {}); this.visual.place(p.x, 0, p.z); }
  goTo(x, z) { this.target = { x, z }; this.prog = { d: Infinity, t: 0 }; }
  leave() { if (this.seat) { this.hq.freeSeat(this.seat); this.seat = null; this.p.action = null; } this.leaving = true; this.goTo(HQ.door.x + this.hq.rng.range(-0.6, 0.6), HQ.door.z + 0.3); }
  update(dt) {
    const p = this.p, it = p.intent;
    it.mx = 0; it.mz = 0; it.sprint = false; it.face = null;
    if (this.visual.pending) return; // still being built: he comes through the door once he's there
    if (this.seat) { p.action.t += dt; return; }
    if (this.target) {
      const dx = this.target.x - p.x, dz = this.target.z - p.z, d = Math.hypot(dx, dz);
      if (d < this.prog.d - 0.15) { this.prog.d = d; this.prog.t = 0; } else this.prog.t += dt;
      if (d < 0.4 || this.prog.t > 2.5) {
        this.target = null;
        if (this.leaving) { this.gone = true; return; }
        this.t = this.hq.rng.range(4, 12);
        this.look = this.hq.rng.next() < 0.5 ? { x: 0, z: 0 } : { x: HQ.board.x, z: HQ.board.z };
      } else { const k = Math.min(1, d / 0.8) * (this.leaving ? 0.7 : 0.42); it.mx = dx / d * k; it.mz = dz / d * k; }
    } else {
      this.t -= dt;
      if (this.look) it.face = Math.atan2(this.look.x - p.x, this.look.z - p.z);
      if (this.t <= 0) { const q = pickIn(this.hq.rng, this.hq.pickZone()); this.goTo(q.x, q.z); }
    }
    p.move(dt * GAME_SPEED, false, 0); // (v0.4.7.5: the same pace as in a game)
    for (const s of this.hq.venue.solids) pushOut(p, s);
    if (this.hq.session) pushOut(p, this.hq.mainRect);
    if (this.hq.practice) pushOut(p, this.hq.sideRect);
    const b = HQ.bounds; p.x = M.clamp(p.x, b.x0, b.x1); p.z = M.clamp(p.z, b.z0, b.z1);
    p.stamina = 1;
  }
  render(dt) {
    const v = this.visual, p = this.p;
    if (v.pending) return;
    if (v.settled !== v.view) { v.settled = v.view; if (this.seat) { this.settle(); return; } } // just arrived: sit straight down
    v.anim.update(dt, { x: p.x, y: 0, z: p.z, facing: p.facing }, p, null, null, {}); v.place(p.x, 0, p.z);
  }
  dispose() { this.visual.dispose(); }
}

export class CrewHQ {
  constructor(app, ui, from) {
    this.app = app; this.ui = ui; this.from = from; this.r = app.renderer;
    this.crew = app.crew;
    this.scene = new Scene();
    this.venue = buildVenue(this.r, this.scene, 'hq', { crew: this.crew });
    // the walls keep the roam camera inside the building
    const Wl = HQ.walls;
    this.camSolids = [...this.venue.solids, { x0: Wl.x0 - 9, x1: Wl.x0, z0: Wl.z0 - 9, z1: Wl.z1 + 9, h: 99 }, { x0: Wl.x1, x1: Wl.x1 + 9, z0: Wl.z0 - 9, z1: Wl.z1 + 9, h: 99 }, { x0: Wl.x0 - 9, x1: Wl.x1 + 9, z0: Wl.z0 - 9, z1: Wl.z0, h: 99 }, { x0: Wl.x0 - 9, x1: Wl.x1 + 9, z0: Wl.z1, z1: Wl.z1 + 9, h: 99 }];
    this.theme = this.venue.theme;
    this.main = this.venue.courts[0]; this.side = this.venue.courts[1];
    this.mainRect = courtPlayRect(this.main, 0.8);
    this.sideRect = courtPlayRect({ ...this.side, full: false }, 0.6);
    this.rng = new RNG((Date.now() & 0xffff) ^ 0x3c3c);
    this.world = app.ai; this.catalog = app.catalog;
    this.pool = new VisualPool(this.r, { maxFree: 10, budgetMs: 3 }); // v0.4.5 stage 7 (see vispool.js)
    this.char = app.char();
    this.meEntry = { build: { ...this.char }, name: this.char.name, look: app.look(this.char), human: true, badges: badgeTiers(this.char) };
    this.me = new Player(0, 0, { build: this.char, name: this.char.name }, app.catalog);
    this.me.setPos(HQ.spawn.x, HQ.spawn.z, 0);
    this.meVisual = new PlayerVisual(this.r, this.scene, this.char, this.meEntry.look, { detail: 1 });
    this.meVisual.addRing(this.r, this.crew.color);
    this.mode = 'roam';
    this.members = [];   // Member on the floor
    this.shooters = [];  // { id, slot, session } AI crew members getting shots up
    this.seatsTaken = new Set();
    this.session = null; this.practice = null; this.run = null;
    this.rig = app.cameraRig; this.rig.roamYaw = 0; this.rig.snap();
    this.prompt = '';
    this.syncT = 15; this.boardT = 0;
    audio.setCrowd(0); audio.setIndoor(true); audio.surface = 'wood';
    this.sync(true);
    this.refreshBoards();
    this.pool.flush();
    this.r.prewarm(this.scene);
  }

  // ---------- who's here ----------
  // crew members online right now, best players first
  onlineIds(t = Date.now()) {
    return (this.crew?.members || []).map(m => m.id).filter(id => this.world.online(id, t))
      .sort((a, b) => this.world.account(b).level - this.world.account(a).level);
  }
  entryFor(id) { const e = this.world.gameEntry(id); e.look = resolveLook(e.build, this.catalog); return e; }
  here() { return new Set([...this.members.map(m => m.id), ...this.shooters.map(s => s.id)]); }
  pickZone() { const tot = ZONES.reduce((s, z) => s + z.w, 0); let r = this.rng.next() * tot; for (const z of ZONES) { r -= z.w; if (r <= 0) return z; } return ZONES[0]; }
  takeSeat() { const free = SEATS.filter(s => !this.seatsTaken.has(s)); if (!free.length) return null; const s = this.rng.pick(free); this.seatsTaken.add(s); return s; }
  freeSeat(s) { this.seatsTaken.delete(s); }
  slotFree(slot) {
    if (this.shooters.some(s => s.slot === slot)) return false;
    return slot === 'main' ? !this.session : !this.practice;
  }
  // people log on and off: whoever went offline walks out, new arrivals come in through the door
  sync(initial = false) {
    const on = new Set(this.onlineIds()), busy = new Set(this.run ? this.run.ids : []);
    for (const m of this.members) if (!on.has(m.id) && !m.leaving) m.leave();
    for (const s of [...this.shooters]) if (!on.has(s.id)) this.stopShooter(s, true);
    const here = this.here();
    for (const id of on) {
      if (here.has(id) || busy.has(id)) continue;
      if (this.members.filter(m => !m.leaving).length + this.shooters.length >= MAX_PEOPLE + 2) break;
      const slot = ['main', 'side'].find(s => this.slotFree(s));
      if (slot && (initial ? this.rng.next() < 0.6 : this.rng.next() < 0.35)) { this.startShooter(id, slot); continue; }
      const e = this.entryFor(id);
      if (initial) {
        const seat = this.rng.next() < 0.45 ? this.takeSeat() : null;
        const q = pickIn(this.rng, this.pickZone());
        this.members.push(new Member(this, id, e, q.x, q.z, seat));
      } else {
        const m = new Member(this, id, e, HQ.door.x + this.rng.range(-0.8, 0.8), HQ.door.z + 0.5);
        const q = pickIn(this.rng, ZONES[0]); m.goTo(q.x, q.z);
        this.members.push(m);
        this.ui.toast(`${e.name} walked into the HQ.`);
      }
    }
  }
  startShooter(id, slot) {
    const e = this.entryFor(id);
    const court = slot === 'main' ? { id: 'hq-main-n', origin: this.main.origin, hoops: [this.main.hoops[0]], format: 1 } : { id: 'hq-side', origin: this.side.origin, hoops: this.side.hoops, format: 1 };
    const session = new MatchSession(this.app, { background: true, hub: true, pool: this.pool, mode: 'practice', scene: this.scene, venue: this.venue, court, rosters: [[e], []], teams: [{ name: e.name, abbr: '', color: this.crew.color }, { name: '', abbr: '', color: '#888' }], seed: this.rng.int(1, 1e9) });
    this.shooters.push({ id, slot, session, entry: e });
  }
  // a shooter gives up the hoop: he walks off (or out, if he logged off)
  stopShooter(s, leaving = false) {
    const g = s.session.game, pl = g.players[0], [ox, , oz] = s.session.origin;
    s.session.dispose();
    this.shooters = this.shooters.filter(x => x !== s);
    if (this.run?.ids.includes(s.id)) return;
    const m = new Member(this, s.id, s.entry, pl.x + ox, pl.z + oz);
    if (leaving) m.leave(); else { const q = pickIn(this.rng, this.pickZone()); m.goTo(q.x, q.z); }
    this.members.push(m);
  }
  refreshBoards() {
    const cr = this.app.crew || this.crew;
    if (!cr) return;
    const rows = cr.members.map(m => { const e = this.world.entry(m.id); return { name: e.name, ovr: e.build.overall, pos: e.build.position, xp: m.xp, online: this.world.online(m.id) }; })
      .sort((a, b) => (b.online - a.online) || b.xp - a.xp);
    this.venue.boards.members.set({ rows, online: rows.filter(r => r.online).length });
    this.venue.boards.levels.set({ level: cr.level });
  }

  // ---------- frame ----------
  frame(dt) {
    const inp = this.app.input;
    if (this.pool.pending) this.pool.tick();
    for (const s of this.shooters) s.session.frame(dt);
    for (const m of this.members) { m.update(dt); if (!m.gone) m.render(dt); }
    if (this.members.some(m => m.gone)) { for (const m of this.members) if (m.gone) m.dispose(); this.members = this.members.filter(m => !m.gone); }
    if ((this.syncT -= dt) <= 0) { this.syncT = 20; this.sync(); }
    if ((this.boardT -= dt) <= 0) { this.boardT = 30; this.refreshBoards(); }
    if (this.mode === 'roam') this.roam(dt);
    else if (this.mode === 'match' && this.session) {
      if (inp.wasPressed('pause') && !this.session.ended && !this.session.paused && !this.app.modalOpen()) this.ui.pauseGame(this);
      this.session.frame(dt);
    } else if (this.mode === 'practice' && this.practice) {
      this.practice.frame(dt);
      if (inp.wasPressed('pause')) this.endPractice();
    }
    this.ui.update(this);
  }

  roam(dt) {
    const app = this.app, inp = app.input, me = this.me;
    inp.ctx = 'roam';
    const place = () => { this.meVisual.anim.update(dt, { x: me.x, y: 0, z: me.z, facing: me.facing }, me, null, null, {}); this.meVisual.place(me.x, 0, me.z); };
    if (app.modalOpen()) { me.intent.mx = me.intent.mz = 0; me.move(dt * GAME_SPEED, false, 0); place(); this.rig.updateRoam(dt, me, null, HQ.bounds, this.camSolids); return; }
    if (inp.wasPressed('pause')) { this.ui.pause(this); return; }
    const mv = inp.moveVector(), basis = this.rig.inputBasis();
    me.intent.mx = basis.rx * mv.x + basis.fx * mv.y;
    me.intent.mz = basis.rz * mv.x + basis.fz * mv.y;
    me.intent.sprint = inp.isDown('sprint');
    me.intent.face = null; me.intent.stickFace = true;
    me.move(dt * GAME_SPEED, false, 0);
    me.stamina = Math.min(1, me.stamina + dt * 0.2);
    const b = HQ.bounds;
    me.x = M.clamp(me.x, b.x0, b.x1); me.z = M.clamp(me.z, b.z0, b.z1);
    for (const s of this.venue.solids) pushOut(me, s);
    for (const m of this.members) separate(me, m.p, !!m.seat);
    for (const s of this.shooters) { const p = s.session.game.players[0], [ox, , oz] = s.session.origin; separate(me, { x: p.x + ox, z: p.z + oz, phys: p.phys }, true); }
    place();
    this.rig.updateRoam(dt, me, inp, b, this.camSolids);
    this.scene.shadowFocus = { center: [me.x, 0, me.z + 2], radius: 16 };
    // interactions
    const E = promptGlyph(inp, 'E', 'A'), go = inp.wasPressed('interact');
    const near = (x, z, r) => Math.hypot(me.x - x, me.z - z) < r;
    this.prompt = '';
    const tb = HQ.table, on = this.onlineIds().length;
    if (near(HQ.door.x, HQ.door.z + 0.9, 1.9)) { this.prompt = `${E} Back to the park`; if (go) this.ui.exit(this); }
    else if (Math.abs(me.x - (HQ.board.x - 1.7)) < 1.6 && Math.abs(me.z - HQ.board.z) < 3.2) { this.prompt = `${E} Crew menu · members, levels, name and colors`; if (go) this.ui.openCrewMenu(this); }
    else if (near(HQ.levels.x, HQ.levels.z + 1.5, 2.2)) { this.prompt = `${E} Crew levels`; if (go) this.ui.openCrewMenu(this); }
    else if (near(HQ.custom.x, HQ.custom.z + 2.2, 2.8)) { this.prompt = `${E} Customize the HQ · coming soon`; if (go) this.ui.toast('Crew HQ interior customization is coming soon: furniture, trophies, lighting and more.'); }
    else if (Math.abs(me.x - tb.x) < 2 && Math.abs(me.z - tb.z) < 3.8) {
      this.prompt = on >= RUN_MIN ? `${E} Run 5-on-5 · ${on} crew member${on > 1 ? 's' : ''} on` : `5-on-5 needs ${RUN_MIN} crew members on · ${on} on now`;
      if (go) { if (on >= RUN_MIN) this.startRun(); else this.ui.toast(`You need ${RUN_MIN} crew members online to run 5-on-5 (${on} on now). Add more friends to the crew, or come back when more of them are on.`, 'error'); }
    } else if (near(HQ.rack.x, HQ.rack.z, 2.3) || near(this.side.origin[0], 6, 4)) { this.prompt = `${E} Shoot around`; if (go) this.startPractice(); }
    if (inp.wasPressed('celebrate') && !me.action) me.startAction('celebrate', 1.6, { kind: this.app.catalog[this.char.equipment?.celebration]?.anim || 'flex' });
    if (me.action) { me.action.t += dt; if (me.action.t > me.action.dur) me.action = null; }
  }

  hideMe(hide) { this.meVisual.view.setVisible(!hide); this.meVisual.blob.visible = !hide; if (this.meVisual.ring) this.meVisual.ring.visible = !hide; }

  // ---------- shootaround on the side court ----------
  startPractice() {
    const app = this.app, char = app.char();
    for (const s of this.shooters.filter(x => x.slot === 'side')) this.stopShooter(s);
    this.hideMe(true);
    const entry = { ...this.meEntry, human: true, build: { ...char }, badges: badgeTiers(char) };
    const court = { id: 'hq-side-me', origin: this.side.origin, hoops: this.side.hoops, format: 1 };
    this.practice = new MatchSession(app, { mode: 'practice', hub: true, scene: this.scene, venue: this.venue, court, rosters: [[entry], []], teams: [{ name: 'You', abbr: 'YOU', color: this.crew.color }, { name: '', abbr: '', color: '#888' }], seed: 7 });
    this.mode = 'practice';
    app.hud.show(true);
    this.ui.toast('Shootaround — Esc to stop');
  }
  endPractice() {
    this.practice.dispose(); this.practice = null;
    this.hideMe(false);
    this.me.setPos(HQ.rack.x, HQ.rack.z - 1.2, 0);
    this.mode = 'roam'; this.rig.snap(); this.app.hud.show(false);
  }

  // ---------- the crew run: 5-on-5 on the main court ----------
  startRun() {
    const app = this.app, on = this.onlineIds();
    if (on.length < RUN_MIN) return;
    const seed = this.rng.int(1, 1e9);
    // you and the four best crew members on; the next ones on take the other side, topped up with regulars
    const mates = on.slice(0, 4), others = on.slice(4, 9), used = new Set([...on]);
    const lvl = mates.reduce((s, id) => s + this.world.account(id).level, 0) / mates.length;
    while (others.length < 5) { const id = this.world.pick({ level: lvl, exclude: used, key: 'hqrun' + seed }); used.add(id); others.push(id); }
    const ids = [...mates, ...others];
    this.run = { ids, mates, others, seed };
    // everybody in the run leaves the floor (and any hoop they were on)
    for (const s of [...this.shooters]) if (s.slot === 'main' || ids.includes(s.id)) this.stopShooter(s);
    for (const m of this.members) if (ids.includes(m.id)) { if (m.seat) this.freeSeat(m.seat); m.dispose(); m.gone = true; }
    this.members = this.members.filter(m => !m.gone);
    const cc = this.crew.color, other = contrastColor(cc);
    const uni = (color, trim, abbr) => ({ top: { family: 'jersey', color, trim, secondary: trim, pattern: 'panel', lettering: abbr, tucked: true }, bottom: { family: 'shorts', color, trim, stripe: trim } });
    const myU = uni(cc, other, this.crew.tag), opU = uni(other, cc, 'RUN');
    const meE = { ...this.meEntry, human: true, build: { ...app.char() }, badges: badgeTiers(app.char()) };
    const mine = [meE, ...mates.map(id => this.world.gameEntry(id))], opp = others.map(id => this.world.gameEntry(id));
    mine.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, this.catalog, { ...myU, number: e.build.appearance?.number ?? (i * 7 + 3) % 50, name: e.name }); });
    opp.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, this.catalog, { ...opU, number: e.build.appearance?.number ?? (i * 9 + 11) % 50, name: e.name }); e.human = false; });
    for (const e of mine.slice(1)) e.human = false;
    this.run.rosters = [mine, opp];
    this.hideMe(true);
    this.session = new MatchSession(app, {
      mode: 'park', full: true, hub: true, scene: this.scene, venue: this.venue, court: this.main, rosters: [mine, opp], seed,
      teams: [{ name: this.crew.name, abbr: this.crew.tag, color: cc }, { name: 'Crew Run', abbr: 'RUN', color: other }],
      target: 21, difficulty: settings.difficulty,
      onEnd: (summary, s) => this.runOver(summary, s),
    });
    this.mode = 'match'; app.mode = 'match';
    music.duck(true);
    this.ui.matchStarted(this);
  }
  async runOver(summary, session) {
    const won = summary.winner === summary.me.team;
    this.world.recordGame(this.run.mates, this.run.others, won);
    await this.ui.runResults(this, summary, session, won);
  }
  // after the final: run it back with whoever's still on, or back to the floor
  endRun(again = false) {
    if (this.session) { this.session.dispose(); this.session = null; }
    const ids = this.run?.ids || [];
    this.run = null;
    this.app.mode = 'park';
    music.duck(false);
    if (again && this.onlineIds().length >= RUN_MIN) { this.startRun(); return; }
    // the crew members who played walk off the court; regulars head home
    const crewIds = new Set((this.crew.members || []).map(m => m.id));
    ids.filter(id => crewIds.has(id) && this.world.online(id)).forEach((id, i) => {
      const m = new Member(this, id, this.entryFor(id), 8.8, -6 + i * 1.3);
      const q = pickIn(this.rng, this.pickZone()); m.goTo(q.x, q.z);
      this.members.push(m);
    });
    this.hideMe(false);
    this.me.setPos(tableSide(), HQ.table.z, -Math.PI / 2);
    this.mode = 'roam'; this.rig.snap();
    this.app.hud.show(false);
    this.ui.backToRoam(this);
  }
  async forfeitMyGame() { this.ui.toast('You left the run.'); this.endRun(false); }
  get mySession() { return this.session; }

  onFocusLost() { if (this.mode === 'match' && this.session && !this.session.ended && !this.session.paused && !this.app.modalOpen()) this.ui.pauseGame(this); }
  deactivate() { }
  dispose() {
    for (const m of this.members) m.dispose();
    for (const s of this.shooters) s.session.dispose();
    if (this.session) this.session.dispose();
    if (this.practice) this.practice.dispose();
    this.meVisual.dispose();
    this.pool.dispose();
  }
}

const tableSide = () => HQ.table.x - 1.3;
// a jersey color that reads against the crew's
export function contrastColor(hex) {
  const c = M.hexToRgb(hex), l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return l > 0.55 ? '#1d2024' : '#f4f2ec';
}
