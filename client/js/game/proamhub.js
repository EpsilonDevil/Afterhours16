// v0.4.8.8 The Pro-Am Overhaul, the Hub agent's part (docs/PROAM-OVERHAUL.md §8): the Pro-Am team's hub. An online
// space like the Crew HQ (game/crewhq.js): the team members in it see each other walk around and shoot.
//  * Ways in: the Pro-Am tab (from: 'menu') and the Pro-Am HUB building's doors in every park (from: 'park', park:
//    the park's id; game/park.js enterProamHub). A player with no team goes to the Pro-Am tab's create/join instead.
//  * The building is the team's tier's (world/proamhubs.js): Bronze a middle-school gym, Silver a high-school gym,
//    Gold (and Platinum, with its trim) the team's own clubhouse in its custom floor, walls, logo and colors.
//  * The office: the whiteboard (ProamUI.openOffice 'whiteboard', and the series drawn on the board itself), the
//    clipboard (the draft: 'draft'), the computer (team settings: 'settings') and "Queue the next game"
//    (ProamUI.queue). Only the session's Captain queues and drafts (the clipboard opens read-only for everyone else);
//    everyone can look at the whiteboard.
//  * The Captain: the service's host for this place when it names one (net.host), else the team member who has been
//    here longest (each screen sends its arrival stamp in a pos message: POS codes below), ties to the lowest id. He
//    hands over the moment he leaves, as park hosting did.
//  * Shootaround on the gym's court for everyone while they wait (several on one goal: SharedHoop). The others see you
//    shooting: while you shoot your screen sends a pos code with your goal, and theirs run you there as a background
//    shootaround (the way the Crew HQ shows its members getting shots up).
//  * Gold and up: the doors out to the team's home park (area 'park': the World agent's park builder, you come out of
//    its clubhouse door). The team members by the doors walk out with you. On its court: 3s against the AI, or with
//    and against the members there (a hosted game, kind 'hq'). These pay a small amount of VC and no Rep: the ticket
//    asks the service for that (pa_home: true; the Server/UI agent's rule); without it they're played for nothing.
// The place keys are 'hq:pa:<team id>' (the hub) and 'hq:pa:<team id>:out' (the home park): the 'hq:' prefix keeps the
// service's park director and court claims out of them, as for a Crew HQ.
import { Scene } from '../gfx/renderer.js';
import { buildVenue } from '../world/venues.js';
import { releaseScene } from '../world/release.js';
import { buildProamHub, hubTier, hubLook, homePark, whiteboardData, rosterData, customizable, HUB_NAMES, teamProgress, CLUB_MAX } from '../world/proamhubs.js';
import { proamInfo } from '../world/proamparks.js';
import { courtPlayRect } from '../world/themes.js';
import { Player } from '../sim/player.js';
import { resolveLook } from '../sim/bots.js';
import { PlayerVisual, MatchSession } from './session.js';
import { GAME_SPEED } from '../sim/game.js';
import { VisualPool } from './vispool.js';
import { badgeTiers, Peers } from './park.js';
import { personOf, setupEntry, seatPeople, inputDelay, newSeed, touchWhere } from '../ui/online.js';
import { promptGlyph } from '../core/input.js';
import { RNG, hashString } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { music, PROAM_MUSIC } from '../core/music.js';
import { settings } from '../core/settings.js';
import { boostedBuild } from '../sim/ratings.js';
import * as M from '../core/math.js';

// ---------------- the hub's pos codes ----------------
// A pos message carries x, z, f and m (the walking speed) and the service relays it to everyone at the place as it is.
// A negative m is never a speed: the hub uses it for what the others need to know (game/proamhub.js only):
//   -1 - slot (-1 … -10): I'm shooting around at this shootaround goal (sent every half second while I am)
//   -50: I'm walking out to the home park (Gold)
//   <= -1e12: my arrival stamp, -(1e12 + the server time I arrived here, ms): the Captain is the one here longest
export const POS = { SHOOT: -1, WALKOUT: -50, STAMP: -1e12 };
export const shootCode = slot => -1 - Math.max(0, Math.min(9, slot | 0));
export const stampCode = at => -1e12 - Math.max(0, Math.round(at));
export function posCode(m) {
  const v = +m;
  if (!Number.isFinite(v) || v >= 0) return null;
  if (v <= -1e12) return { kind: 'stamp', at: -v - 1e12 };
  if (v === POS.WALKOUT) return { kind: 'walkout' };
  if (v >= -10 && v <= -1 && Number.isInteger(v)) return { kind: 'shoot', slot: -v - 1 };
  return { kind: 'other' };
}
// the session's Captain: the service's host for this place when it names one of the people here; else whoever has
// been here longest (others: [{id, at}], at the arrival stamp), ties to the lowest id; just you when you're alone
export function pickCaptain(myId, myAt, others = [], host = null) {
  if (host != null && (host === myId || others.some(o => o.id === host))) return host;
  let best = { id: myId, at: Number.isFinite(myAt) ? myAt : Infinity };
  for (const o of others) {
    const at = Number.isFinite(o.at) ? o.at : Infinity;
    if (at < best.at || (at === best.at && String(o.id) < String(best.id))) best = { id: o.id, at };
  }
  return best.id;
}

// ---------------- one goal, several shootarounds ----------------
// Everyone's shootaround on the same goal is its own little game; the goal's net and rim are one. Each game hands the
// goal its ball; once a frame the net moves for the ball nearest the rim (instead of once per game: twice the speed)
export class SharedHoop {
  constructor(h) { this.h = h; this.balls = []; this.dt = 0; const self = this; this.proxy = Object.assign(Object.create(h), { update(dt, ball) { self.balls.push(ball); self.dt = Math.max(self.dt, dt); }, hit(s) { h.hit(s); } }); }
  step() {
    if (!this.balls.length) return;
    const r = this.h.rim; let best = null, bd = Infinity;
    for (const b of this.balls) { const d = b ? Math.hypot(b.x - r.x, b.y - r.y, b.z - r.z) : Infinity; if (d < bd) { bd = d; best = b; } }
    this.h.update(this.dt, best);
    this.balls.length = 0; this.dt = 0;
  }
}

function pushOut(p, b) {
  const r = p.phys.radius;
  if (p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r) return;
  const dl = p.x - (b.x0 - r), dr = (b.x1 + r) - p.x, dn = p.z - (b.z0 - r), df = (b.z1 + r) - p.z, m = Math.min(dl, dr, dn, df);
  if (m === dl) p.x = b.x0 - r; else if (m === dr) p.x = b.x1 + r; else if (m === dn) p.z = b.z0 - r; else p.z = b.z1 + r;
}
function separate(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), r = (a.phys.radius + (b.phys?.radius || 0.3)) * 0.9;
  if (d < r && d > 1e-4) { const k = (r - d) / d; a.x += dx * k; a.z += dz * k; }
}
const contrast = hex => { const c = M.hexToRgb(hex); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.55 ? '#1d2024' : '#f4f2ec'; };
const uniform = (color, trim, abbr) => ({ top: { family: 'jersey', color, trim, secondary: trim, pattern: 'panel', lettering: abbr, tucked: true }, bottom: { family: 'shorts', color, trim, stripe: trim } });
export const HOME_FORMAT = 3; // (3s on the home court)

// ---------------- qp12: the AI people in the HUB (docs/PROAM-OVERHAUL.md §11, scratchpad contract QP12 §2) ----------------
// Two kinds come in: your AI squad mates (offline your local squad, online the squad's AI mates as the park carries them:
// each real player's walk a step behind him), and the team's AI members who are on right now by their AI-world schedule
// (AIWorld.status, on the service's clock online). What each AI member does is a pure function of the team, his id and
// the time (aiPlan), so every screen in the HUB shows the same people doing the same things: standing around the court,
// shooting around (HUB_AI_SHOOTERS at most, the first by id), and, while a queue is on, gathered in the office.
export const HUB_AI_MAX = 8, HUB_AI_SHOOTERS = 2, HUB_AI_PERIOD = 45000, HUB_AI_SHOOT_PCT = 35;
// {ai_id: on now?} for the team's AI members: the HUB's world when it's the team's world (t: this PC's clock; the world
// applies the shared clock's skew itself), else the team view's own flag (the service's answer when the team was loaded)
export function aiOnline(team, world, t = Date.now()) {
  const out = {}, same = world && typeof world.status === 'function' && (!team?.world?.seed || team.world.seed === world.seed);
  for (const m of team?.members || []) {
    if (m?.kind !== 'ai' || typeof m.ai_id !== 'string') continue;
    let on = !!m.online;
    if (same) { try { on = !!world.status(m.ai_id, t); } catch { on = !!m.online; } }
    out[m.ai_id] = on;
  }
  return out;
}
// the AI members in the HUB now: on by their schedule, not off with someone's squad (exclude), by id, HUB_AI_MAX at most
export function hubAIMembers(team, world, t = Date.now(), exclude = new Set()) {
  const on = aiOnline(team, world, t);
  return Object.keys(on).filter(id => on[id] && !exclude.has(id)).sort().slice(0, HUB_AI_MAX);
}
// what each of them is doing at time t: ids (sorted), n: {shoot: the shootaround goals, hang: the places to stand}.
// -> Map id -> {kind: 'shoot' (shooting around: slot) | 'watch' (by a goal someone shoots at: slot) | 'hang' (spot i)}.
// Each changes what he's doing every HUB_AI_PERIOD, each at his own moment in it; the same answer on every screen.
export function aiPlan(teamId, ids, t, n = {}) {
  const out = new Map(), nS = Math.max(0, n.shoot | 0), nH = Math.max(1, n.hang | 0), taken = new Set();
  let shooters = 0;
  for (const id of [...ids].sort()) {
    const k = Math.floor((t + hashString(id + '|phase') % HUB_AI_PERIOD) / HUB_AI_PERIOD), h = hashString(`${teamId}|${id}|${k}`);
    if (nS && h % 100 < HUB_AI_SHOOT_PCT) {
      const slot = (h >>> 8) % nS;
      if (shooters < HUB_AI_SHOOTERS) { shooters++; out.set(id, { kind: 'shoot', slot, k }); continue; }
      out.set(id, { kind: 'watch', slot, k }); continue;
    }
    let i = (h >>> 4) % nH;
    for (let j = 0; j < nH && taken.has(i); j++) i = (i + 1) % nH;
    taken.add(i);
    out.set(id, { kind: 'hang', i, k });
  }
  return out;
}
// who's coming, as the HUB's ready-check view shows it (§3): the real players here, then the AI members here, then the
// AI squad mates who came, then the draft (its picks first; the clipboard fills the rest). server: the lineup op's answer
// ({members, squad, draft}: ids), when it's in: that is who plays.
export function hubLineup({ humans = [], members = [], squad = [], picks = [], server = null, name = id => id } = {}) {
  const H = humans.slice(0, 5);
  let open = 5 - H.length, m, sq, d;
  if (server) { m = server.members || []; sq = server.squad || []; d = server.draft || []; open = Math.max(0, open - m.length - sq.length - d.length); }
  else {
    m = members.slice(0, open); open -= m.length;
    sq = squad.filter(i => !m.includes(i)).slice(0, open); open -= sq.length;
    d = picks.filter(i => !m.includes(i) && !sq.includes(i)).slice(0, open); open -= d.length;
  }
  return { humans: H, members: m.map(name), squad: sq.map(name), draft: d.map(name), more: Math.max(0, open), final: !!server };
}

// an AI person walking the HUB (a squad mate following someone, or an AI member going about the place)
class HubBot {
  constructor(hub, id, entry, kind) {
    this.hub = hub; this.id = id; this.kind = kind; this.entry = entry; this.name = entry.name;
    this.p = new Player(0, 0, { build: entry.build, name: entry.name }, hub.catalog);
    this.visual = new PlayerVisual(hub.r, hub.scene, entry.build, entry.look, { detail: 0.75, ...(hub.pool ? { pool: hub.pool } : {}) });
    this.path = []; this.face = null; this.owner = null; this.slot = 0; this.session = null; this.plan = null; this.leaving = false; this.gone = false;
  }
  setPos(x, z, f = 0) { this.p.setPos(x, z, f); }
  // to (x, z), through the office door when that's in another room; face: which way to stand once there
  goTo(x, z, face = null) {
    const hub = this.hub, p = this.p, R = r => hub.area === 'hub' ? hub.venue.roomAt?.(r.x, r.z)?.id || null : null;
    const from = R(p), to = R({ x, z }), o = hub.venue.office, path = [];
    if (o?.door && from !== to && (from === 'office' || to === 'office')) {
      const oz = (o.room && hub.venue.rooms?.find(r => r.id === o.room)) || null, s = oz ? Math.sign((oz.z0 + oz.z1) / 2 - o.door.z) || 1 : 1;
      const inside = { x: o.door.x, z: o.door.z + s * 0.9 }, outside = { x: o.door.x, z: o.door.z - s * 0.9 };
      path.push(...(from === 'office' ? [inside, outside] : [outside, inside]));
    }
    path.push({ x, z });
    this.path = path; this.face = face;
  }
  update(dt) {
    const p = this.p, it = p.intent, hub = this.hub;
    it.mx = 0; it.mz = 0; it.sprint = false; it.face = null;
    if (this.session) return; // (he walks while his look is still being built: he's just not drawn yet)
    if (this.owner) {
      // a step behind whoever he came with, fanned out to the sides (as squad mates walk in the parks)
      const o = this.owner, f = o.facing, slot = this.slot;
      const back = 1.5 + Math.floor(slot / 2) * 1.2, lat = (slot % 2 ? 1 : -1) * (0.85 + Math.floor(slot / 2) * 0.3);
      let tx = o.x - Math.sin(f) * back + Math.cos(f) * lat, tz = o.z - Math.cos(f) * back - Math.sin(f) * lat;
      if (!hub.walkable(tx, tz)) { tx = o.x - Math.sin(f) * 1.1; tz = o.z - Math.cos(f) * 1.1; if (!hub.walkable(tx, tz)) { tx = o.x; tz = o.z; } }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      // (left behind round a corner, through a door, or caught on something on the way: he catches up)
      this.fprog = this.fprog || { d: Infinity, t: 0 };
      if (d < this.fprog.d - 0.05 || d < 1.5) { this.fprog.d = d; this.fprog.t = 0; } else this.fprog.t += dt;
      if (d > 8 || this.fprog.t > 1.2) { p.setPos(tx, tz, f); this.fprog = null; }
      else if (d > 0.35) { const k = Math.min(1, d / 1.4) * (d > 3.5 ? 1 : 0.62); it.mx = dx / d * k; it.mz = dz / d * k; it.sprint = d > 4.5; }
      else it.face = f;
    } else if (this.path.length) {
      const w = this.path[0], dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
      this.prog = this.prog && this.prog.w === w ? this.prog : { w, d: Infinity, t: 0 };
      if (d < this.prog.d - 0.1) { this.prog.d = d; this.prog.t = 0; } else this.prog.t += dt;
      if (d < 0.3 || this.prog.t > 3) { if (this.prog.t > 3) p.setPos(w.x, w.z, p.facing); this.path.shift(); if (!this.path.length && this.leaving) this.gone = true; }
      else { const k = Math.min(1, d / 0.8) * (this.leaving || this.plan?.kind === 'office' ? 0.85 : 0.5); it.mx = dx / d * k; it.mz = dz / d * k; }
    } else if (this.face != null) it.face = this.face;
    const ox = p.x, oz = p.z;
    p.move(dt * GAME_SPEED, false, 0); p.stamina = 1;
    if (!hub.walkable(p.x, p.z)) { if (hub.walkable(p.x, oz)) p.z = oz; else if (hub.walkable(ox, p.z)) p.x = ox; else { p.x = ox; p.z = oz; } }
    for (const s of hub.venue.solids || []) pushOut(p, s);
    if (!hub.walkable(p.x, p.z)) { p.x = ox; p.z = oz; }
  }
  render(dt) {
    if (this.session || this.visual.pending) return;
    const p = this.p;
    this.visual.anim.update(dt, { x: p.x, y: 0, z: p.z, facing: p.facing }, p, null, null, {});
    this.visual.place(p.x, 0, p.z);
  }
  hide(h) { this.visual.view?.setVisible?.(!h); if (this.visual.blob) this.visual.blob.visible = !h; this.visual.setHidden?.(h); }
  dispose() { this.session?.dispose(); this.session = null; this.visual.dispose(); this.disposed = true; }
}

// ---------------- the hub ----------------
export class ProamHub {
  // opts: {team, season, from: 'menu'|'park', park (the park you came from), area: 'hub'|'park', at: 'walkout'
  // (coming back in through the home park's doors), officeUI (ui/proamui.js: openOffice, queue, load), pool}
  constructor(app, ui, opts = {}) {
    music.setPlaylist?.('main', { level: PROAM_MUSIC }); music.setSuppressed?.(false); // (v0.4.8.9 qp13: the soundtrack, at about 10%)
    this.app = app; this.ui = ui; this.r = app.renderer; this.opts = opts;
    this.team = opts.team || {}; this.season = opts.season || null;
    this.from = opts.from === 'park' ? 'park' : 'menu'; this.park = opts.park || null;
    this.area = opts.area === 'park' ? 'park' : 'hub';
    this.officeUI = opts.officeUI || null;
    this.tier = hubTier(this.team);
    this.look = hubLook(this.team);
    this.scene = new Scene();
    this.rng = new RNG((Date.now() & 0xffff) ^ 0x5a5a);
    this.world = app.ai; this.catalog = app.catalog;
    this.pool = opts.pool || new VisualPool(this.r, { maxFree: 10, budgetMs: 3 });
    this.ownPool = !opts.pool; // (qp3: a pool the caller handed in is the caller's to dispose)
    this.peers = new Peers(this);
    this.shooters = new Map(); // a team member's shootaround here, on his screen: id -> {slot, session, seen}
    this.arrivals = new Map(); // id -> {at, known}: when each one here arrived (the Captain is the one here longest)
    this.hoops = new Map();    // goal -> SharedHoop
    let spawn;
    if (this.area === 'hub') {
      this.venue = buildProamHub(this.r, this.scene, this.tier, { team: this.team });
      this.camSolids = this.venue.camSolids;
      spawn = this.venue.spawn;
      if (opts.at === 'walkout' && this.venue.walkout) { const w = this.venue.walkout; spawn = { x: w.x + 0.9, z: w.z, yaw: Math.PI / 2 }; }
    } else {
      this.parkId = homePark(this.team);
      this.venue = buildVenue(this.r, this.scene, 'proam_' + this.parkId, { home: { name: this.look.name, abbr: this.look.abbr, primary: this.look.primary, secondary: this.look.secondary, logo: this.look.logo }, seed: hashString('pahome|' + (this.team.id || this.look.name)) });
      this.camSolids = this.venue.solids || [];
      const d = this.venue.clubhouse?.door || this.venue.spawn || { x: 0, z: -20, yaw: 0 };
      spawn = { x: d.x + Math.sin(d.yaw || 0) * 0.6, z: d.z + Math.cos(d.yaw || 0) * 0.6, yaw: d.yaw || 0 };
      this.mainRect = courtPlayRect(this.venue.courts[0], 0.6);
    }
    this.theme = this.venue.theme;
    this.main = this.venue.courts[0];
    this.char = app.char();
    this.meEntry = { build: { ...this.char }, name: this.char.name, look: app.look(this.char), human: true, badges: badgeTiers(this.char) };
    this.me = new Player(0, 0, { build: this.char, name: this.char.name }, app.catalog);
    this.me.setPos(spawn.x, spawn.z, spawn.yaw || 0);
    this.meVisual = new PlayerVisual(this.r, this.scene, this.char, this.meEntry.look, { detail: 1, ...(opts.pool ? { pool: opts.pool } : {}) });
    this.meVisual.addRing?.(this.r, this.look.primary);
    this.mode = 'roam'; this.prompt = ''; this.near = null;
    this.practice = null; this.practiceSlot = -1; this.session = null; this.live = null; this.run = null;
    this.rig = app.cameraRig; if (this.rig) { this.rig.roamYaw = spawn.yaw || 0; this.rig.snap(); }
    audio.setCrowd?.(0); audio.setIndoor?.(this.area === 'hub' || !!proamInfo(this.parkId)?.indoor); audio.surface = this.area === 'hub' || proamInfo(this.parkId)?.indoor ? 'wood' : 'asphalt';
    this.arrivedAt = this.serverNow();
    this.stampAt = 0; this.shootAt = 0; this.boardT = 0; this.seeded = false;
    // (qp12) the AI people: your squad mates with you, the team's AI members on now; the others' AI squad mates walk with
    // them (Peers: the park's followers)
    this.bots = new Map(); this.crowdT = 1; this.queueing = null;
    this.peers.withAI = true;
    this.spots = this.area === 'hub' ? crowdSpots(this.venue, this.main) : null;
    this.offReady = this.net()?.on?.('pa-ready', m => this.onReady(m)) || null;
    this.syncCrowd(true);
    this.onArrivals();
    this.refreshBoards();
    this.pool.flush?.();
    this.r.prewarm?.(this.scene);
  }

  // ---------------- online: the team members here ----------------
  net() { return this.app.net || null; }
  serverNow() { const n = this.net(); return Date.now() + (Number.isFinite(n?.serverSkew) ? n.serverSkew : 0); }
  myId() { return this.net()?.myId ?? 'me'; }
  placeKey() { const id = this.team?.id; return id ? `hq:pa:${id}${this.area === 'park' ? ':out' : ''}` : null; }
  netHere() { const n = this.net(), k = this.placeKey(); return n && n.connected && k && n.place === k ? n : null; }
  teamIds() { const ms = this.team?.members; return Array.isArray(ms) && ms.length ? new Set(ms.map(m => m.account_id ?? m.id)) : null; }
  // the other real team members here right now: [{id, username, entry, rtt}]
  realHere() {
    const net = this.netHere(); if (!net) return [];
    const ids = this.teamIds();
    return [...net.people.keys()].filter(id => !ids || ids.has(id)).map(id => personOf(this.app, id)).filter(p => p?.entry);
  }
  // whoever was here when I came in (the first people list for this place) arrived before me; whoever comes later,
  // after me (until their stamps say exactly when)
  onArrivals() {
    const net = this.netHere(); if (!net) return;
    const first = !this.seeded; this.seeded = true;
    for (const id of net.people.keys()) if (!this.arrivals.has(id)) this.arrivals.set(id, { at: first ? this.arrivedAt - 1 : this.serverNow(), known: false });
    for (const id of [...this.arrivals.keys()]) if (!net.people.has(id)) this.arrivals.delete(id);
    this.stamp(); // (a newcomer hears my stamp straight away)
  }
  captainId() {
    const net = this.netHere();
    if (!net) return this.myId();
    const others = this.realHere().map(p => ({ id: p.id, at: this.arrivals.get(p.id)?.at ?? this.arrivedAt - 1 }));
    return pickCaptain(net.myId, this.arrivedAt, others, net.host ?? null);
  }
  isCaptain() { return this.captainId() === this.myId(); }
  captainName() {
    const id = this.captainId();
    if (id === this.myId()) return this.char?.name || 'You';
    const p = this.netHere()?.people.get(id);
    return p?.username || p?.name || 'your Captain';
  }
  isFounder() { const me = this.app.proam?.me ?? this.app.profile?.account?.id; return !!me && this.team?.founder === me; } // (qp6: online, your account on the team's service)
  // the team members in the hub for the ready check (the Captain first: ui/proam.js queue opts.members)
  membersHere() { return [{ id: this.myId(), name: this.app.net?.you?.username || this.char?.name || 'You' }, ...this.realHere().map(p => ({ id: p.id, name: p.username }))]; }
  onPeerPos(m) {
    if (this.liveSetup?.slots?.[m.from] != null || this.onlineGame?.slots?.[m.from] != null) return;
    const code = posCode(m.m);
    if (code) { this.onCode(m, code); return; }
    if (this.shooters.has(m.from)) this.stopShooter(m.from);
    this.peers.pos(m);
  }
  onCode(m, c) {
    if (c.kind === 'stamp') { this.arrivals.set(m.from, { at: c.at, known: true }); return; }
    if (c.kind === 'shoot' && this.area === 'hub') { this.peerShoot(m.from, c.slot); return; }
    if (c.kind === 'walkout' && this.area === 'hub') this.peerWalkedOut(m.from);
  }
  onPeople(m) { this.peers.people(m); this.onArrivals(); if (m?.t === 'gone' && m.id != null) this.stopShooter(m.id); }
  clearPeers() { this.peers.clear(); for (const id of [...this.shooters.keys()]) this.stopShooter(id); }
  onCrew() { }
  // my arrival stamp, to the people here (when someone arrives, and every few seconds: by the clock, not the frames)
  stamp() { if (this.sendPos(stampCode(this.arrivedAt))) this.stampAt = performance.now(); }
  sendPos(m) { const net = this.netHere(); if (!net || !net.people.size) return false; const me = this.me, r2 = v => Math.round(v * 100) / 100; net.send({ t: 'pos', x: r2(me.x), z: r2(me.z), f: r2(me.facing), m }); return true; }

  // a team member shooting around on his screen: here, he's at his goal getting shots up
  peerShoot(id, slot) {
    const s = this.venue.shootSlots?.[slot]; if (!s) return;
    const cur = this.shooters.get(id);
    if (cur && cur.slot === slot) { cur.seen = performance.now(); return; }
    if (cur) this.stopShooter(id);
    const person = this.netHere()?.people.get(id), e = person?.entry;
    if (!e?.build) return;
    this.peers.drop(id);
    const entry = { ...e, human: false, name: e.name || person.username, look: e.look || resolveLook({ ...e.build, name: e.name }, this.catalog) };
    const session = new MatchSession(this.app, { background: true, hub: true, pool: this.pool, mode: 'practice', scene: this.scene, venue: this.venue, court: this.slotCourt(slot), rosters: [[entry], []], teams: [{ name: entry.name, abbr: '', color: this.look.primary }, { name: '', abbr: '', color: '#888' }], seed: (hashString(String(id)) % 1e6) + 1 });
    this.shooters.set(id, { slot, session, seen: performance.now() });
  }
  stopShooter(id) { const s = this.shooters.get(id); if (!s) return; s.session.dispose(); this.shooters.delete(id); }
  slotCourt(slot) {
    const s = this.venue.shootSlots[slot];
    const hoops = s.court.hoops.map(h => { let sh = this.hoops.get(h); if (!sh) { sh = new SharedHoop(h); this.hoops.set(h, sh); } return sh.proxy; });
    return { ...s.court, hoops };
  }
  // someone walked out to the home park: the ones standing by the doors go with him
  peerWalkedOut(id) {
    if (this.mode !== 'roam' || this.walking || !this.venue.walkout) return;
    const p = this.netHere()?.people.get(id), who = p?.username || 'A team member', w = this.venue.walkout;
    const park = proamInfo(this.venue.park)?.name || 'the home court';
    if (Math.hypot(this.me.x - w.x, this.me.z - w.z) < 7 && !this.app.modalOpen?.()) {
      this.ui.toast(`Walking out with ${who} to ${park}…`);
      this.walking = true;
      setTimeout(() => { if (!this.disposed && this.mode === 'roam') this.walkOut(true); else this.walking = false; }, 700);
    } else this.ui.toast(`${who} walked out to ${park}. Go through the doors to join him.`);
  }

  // ---------------- the office ----------------
  async office() {
    if (this.officeUI) return this.officeUI;
    try { this.officeUI = await import('../ui/proamui.js'); } catch (e) { console.warn('[hub] ProamUI', e?.message || e); this.officeUI = null; }
    return this.officeUI;
  }
  // panel: 'whiteboard' | 'draft' | 'settings' (ui/proamui.js openOffice); the draft is read-only but for the Captain
  async openPanel(panel) {
    const U = await this.office();
    if (!U?.openOffice) { this.ui.toast('The office opens soon.', 'error'); return false; }
    const captain = this.isCaptain();
    if (panel === 'settings' && !this.isFounder()) { this.ui.toast('The team\'s founder owns its settings.', 'error'); return false; }
    if (panel === 'draft' && !captain) this.ui.toast(`Only the Captain picks: ${this.captainName()}. Here's the list.`);
    await U.openOffice(this.app, this.team, panel, { captain, humans: 1 + this.realHere().length, members: this.membersHere(), onChange: () => this.reloadTeam() });
    return true;
  }
  // only the Captain queues (the ready check goes to every team member here, then the matchmaker: ProamUI.queue)
  async queueNext() {
    if (!this.isCaptain()) { this.ui.toast(`Only the Captain queues the next game: ${this.captainName()}.`, 'error'); return false; }
    const U = await this.office();
    if (!U?.queue) { this.ui.toast('Queueing opens soon.', 'error'); return false; }
    // (qp12: the AI members the HUB shows and the AI squad mates here go in the lineup before the draft; meanwhile they
    // all go over to the office)
    this.queueStarted();
    await U.queue(this.app, this.team, { members: this.membersHere(), aiMembers: this.aiMembersHere(), squad: this.squadHere() });
    if (!this.disposed) this.queueEnded();
    return true;
  }
  // the team as the service has it now (after the office changed it): the whiteboard, and a Gold clubhouse's look
  async reloadTeam() {
    const U = await this.office();
    let st = null;
    try { st = U?.load ? await U.load(this.app) : null; } catch { st = null; }
    if (st?.team) { this.team = st.team; this.season = st.season || this.season; }
    const was = this.tier, now = hubTier(this.team);
    this.look = hubLook(this.team);
    if (this.area === 'hub' && customizable(this.tier)) this.venue.paint?.(this.team);
    if (now !== was && !this.tierNote) { this.tierNote = true; this.ui.toast(`Your team is ${now[0].toUpperCase() + now.slice(1)} now: its new building opens the next time you come in.`); }
    this.refreshBoards();
  }
  refreshBoards() {
    if (this.area !== 'hub') return;
    this.venue.boards?.whiteboard?.set(whiteboardData(this.team, this.season || this.app.proam?.season || null));
    this.venue.boards?.roster?.set(rosterData(this.team, aiOnline(this.team, this.world, Date.now()))); // (qp12: the Invite spot's roster)
  }
  // (qp12) the office's Invite spot: the club's invite dialog (ui/proam.js openInviteDialog: AI friends join at once,
  // players get an invite), from the office UI module, or the Pro-Am tab's, whichever has it
  async openInvite() {
    const U = await this.office();
    let f = U?.openInviteDialog || null;
    if (typeof f !== 'function') { try { f = (await import('../ui/proam.js')).openInviteDialog; } catch (e) { console.warn('[hub] invites', e?.message || e); f = null; } }
    if (typeof f !== 'function') { this.ui.toast('Invites open soon.', 'error'); return false; }
    try { await f(this.app, this.team, { onChange: () => this.reloadTeam() }); }
    catch (e) { console.warn('[hub] invites', e?.message || e); this.ui.toast('The invites couldn\'t open: ' + (e?.message || 'try again'), 'error'); return false; }
    return true;
  }

  // ---------------- qp12: the AI people ----------------
  // your AI squad mates (offline your local squad; online, yours as your game sends them with you)
  squadMine() { try { return (this.world?.activeSquad?.() || []).filter(id => typeof id === 'string').slice(0, 4); } catch { return []; } }
  // the AI squad mates the other people here brought (as the park carries them: each one's own, from the service)
  squadPeers() {
    const net = this.netHere(); if (!net) return [];
    const out = [];
    for (const [id, p] of net.people) for (const a of (p?.ai?.length ? p.ai : net.aiOf?.(id) || [])) if (typeof a?.id === 'string') out.push(a.id);
    return out;
  }
  squadHere() { return [...new Set([...this.squadMine(), ...this.squadPeers()])]; }
  aiMembersHere() { return [...this.bots.values()].filter(b => b.kind === 'member' && !b.leaving).map(b => b.id).sort(); }
  aiEntry(id) {
    try { const e = this.world?.gameEntry?.(id); if (!e?.build) return null; return { ...e, name: e.name || id, look: e.look || resolveLook({ ...e.build, name: e.name }, this.catalog) }; } catch { return null; }
  }
  aiName(id) { return this.bots.get(id)?.name || (this.team?.members || []).find(m => m?.ai_id === id)?.name || this.aiEntry(id)?.name || id; }
  // who should be here (once a second): the squad mates follow you; the AI members on now come in through the door
  // (first: already here when you come in) and walk out of it when they go off
  syncCrowd(first = false) {
    const t = Date.now(), mine = this.squadMine(); // (the AI world applies its shared clock itself: local time in)
    const exclude = new Set([...mine, ...this.squadPeers()]);
    const members = this.area === 'hub' ? hubAIMembers(this.team, this.world, t, exclude) : [];
    const want = new Map();
    mine.forEach((id, i) => want.set(id, { kind: 'squad', slot: i }));
    for (const id of members) if (!want.has(id)) want.set(id, { kind: 'member' });
    for (const [id, b] of [...this.bots]) {
      const w = want.get(id);
      if (w && w.kind === b.kind) { if (b.leaving) { b.leaving = false; b.planKey = null; } continue; }
      if (b.kind === 'member' && !first && this.spots?.door && !b.gone) {
        if (!b.leaving) { this.stopBotShoot(b); b.leaving = true; b.plan = null; b.planKey = null; b.goTo(this.spots.door.x, this.spots.door.z); }
        continue;
      }
      this.dropBot(id);
    }
    for (const [id, w] of want) {
      const b0 = this.bots.get(id);
      if (b0) { if (w.kind === 'squad') b0.slot = w.slot; continue; }
      const e = this.aiEntry(id); if (!e) continue;
      let b;
      try { b = new HubBot(this, id, e, w.kind); } catch (err) { console.warn('[hub] AI person', err?.message || err); continue; }
      if (w.kind === 'squad') {
        b.owner = this.me; b.slot = w.slot;
        const f = this.me.facing, x = this.me.x - Math.sin(f) * (1.4 + w.slot * 0.5), z = this.me.z - Math.cos(f) * (1.4 + w.slot * 0.5);
        if (this.walkable(x, z)) b.setPos(x, z, f); else b.setPos(this.me.x, this.me.z, f);
      } else { const d = this.spots?.door || this.venue.spawn || { x: 0, z: 0 }; b.setPos(d.x, d.z, 0); b.fresh = first; }
      this.bots.set(id, b);
    }
    this.planCrowd();
  }
  dropBot(id) { const b = this.bots.get(id); if (!b) return; b.dispose(); this.bots.delete(id); }
  // what the AI members do now (aiPlan: the same on every screen); while a queue is on, everyone gathers in the office
  planCrowd() {
    if (!this.spots) { for (const b of this.bots.values()) if (b.kind === 'squad' && !b.owner) b.owner = this.me; return; }
    const S = this.spots, members = [...this.bots.values()].filter(b => b.kind === 'member' && !b.leaving).sort((a, b) => (a.id < b.id ? -1 : 1));
    const squad = [...this.bots.values()].filter(b => b.kind === 'squad');
    const go = (b, key, sp, face = null) => {
      if (!sp || b.planKey === key) return;
      b.planKey = key;
      if (b.fresh) { b.fresh = false; b.setPos(sp.x, sp.z, face ?? sp.face ?? 0); b.path = []; b.face = face ?? sp.face ?? null; }
      else b.goTo(sp.x, sp.z, face ?? sp.face ?? null);
    };
    if (this.queueing && S.office.length) {
      const q = this.venue.office?.queue;
      [...members, ...squad].forEach((b, i) => {
        this.stopBotShoot(b); b.owner = null; b.plan = { kind: 'office', i };
        const sp = S.office[i % S.office.length];
        go(b, `office:${i}`, sp, q ? Math.atan2(q.x - sp.x, q.z - sp.z) : null);
      });
      return;
    }
    for (const b of squad) if (!b.owner) { b.owner = this.me; b.planKey = null; b.path = []; }
    const plan = aiPlan(this.team?.id || this.look.name, members.map(b => b.id), this.serverNow(), { shoot: this.venue.shootSlots?.length || 0, hang: S.hang.length });
    let watch = 0;
    for (const b of members) {
      const a = plan.get(b.id); if (!a) continue;
      const key = `${a.kind}:${a.slot ?? a.i}:${a.k}`;
      if (b.planKey === key) continue;
      if (b.plan?.kind === 'shoot' && (a.kind !== 'shoot' || a.slot !== b.plan.slot)) this.stopBotShoot(b);
      b.plan = a;
      let sp = null;
      if (a.kind === 'hang') sp = S.hang[a.i % S.hang.length];
      else if (a.kind === 'shoot') { const sl = this.venue.shootSlots[a.slot]?.spot; sp = sl ? { x: sl.x, z: sl.z, face: Math.PI } : null; }
      else { const g = S.goals[a.slot] || []; sp = g.length ? g[(watch++) % g.length] : S.hang[0]; }
      if (b.session && a.kind === 'shoot') { b.planKey = key; continue; }
      go(b, key, sp);
    }
  }
  // an AI member shooting around: a background shootaround on his goal (as the people here shooting on their screens)
  startBotShoot(b) {
    const slot = b.plan?.slot;
    if (b.session || !this.venue.shootSlots?.[slot]) return false;
    try {
      const entry = { ...b.entry, human: false };
      b.session = new MatchSession(this.app, { background: true, hub: true, pool: this.pool, mode: 'practice', scene: this.scene, venue: this.venue, court: this.slotCourt(slot), rosters: [[entry], []], teams: [{ name: entry.name, abbr: '', color: this.look.primary }, { name: '', abbr: '', color: '#888' }], seed: (hashString(String(b.id)) % 1e6) + 1 });
      b.hide(true);
      return true;
    } catch (e) { console.warn('[hub] AI shootaround', e?.message || e); b.session = null; b.plan = { ...b.plan, kind: 'watch' }; return false; }
  }
  stopBotShoot(b) {
    if (!b.session) return;
    const s = b.session, pl = s.game?.players?.[0], o = s.origin || [0, 0, 0];
    b.session = null;
    try { s.dispose(); } catch { /* gone */ }
    let x = pl ? pl.x + o[0] : b.p.x, z = pl ? pl.z + o[2] : b.p.z;
    if (!this.walkable(x, z)) { const sp = this.venue.shootSlots?.[b.plan?.slot]?.spot; if (sp) { x = sp.x; z = sp.z; } }
    b.setPos(x, z, Math.PI); b.hide(false);
  }
  // the queue (yours, or the Captain's ready check reaching you): the AI people go over to the office for it
  queueStarted(secs = 75) { this.queueing = { at: performance.now(), until: performance.now() + secs * 1000, lu: this.app.paLineup || null }; for (const b of this.bots.values()) b.planKey = null; this.planCrowd(); }
  queueEnded() { if (!this.queueing) return; this.queueing = null; for (const b of this.bots.values()) b.planKey = null; this.planCrowd(); }
  onReady(m) { if (this.disposed) return; if (m?.op === 'ask') this.queueStarted((+m.secs || 20) + 55); else if (m?.op === 'cancel') this.queueEnded(); }
  // the HUB's ready-check view: who's coming (hubLineup): the server's lineup once it's in, else the HUB's own reckoning
  lineupView() {
    const q = this.queueing; if (!q) return null;
    const lu = this.app.paLineup && this.app.paLineup !== q.lu ? this.app.paLineup : null;
    const picks = Object.values(this.team?.current?.picks || {}).filter(id => typeof id === 'string');
    return hubLineup({ humans: this.membersHere().map(m => m.name), members: this.aiMembersHere(), squad: this.squadHere(), picks, server: lu, name: id => this.aiName(id) });
  }

  // ---------------- frame ----------------
  frame(dt) {
    if (this.disposed) return; // (QP3: left, its scene freed; the loop can still call it until the next controller is up)
    const inp = this.app.input;
    if (this.pool.pending) this.pool.tick();
    this.venue.update?.(dt, {});
    for (const [id, s] of this.shooters) { s.session.frame(dt); if (performance.now() - s.seen > 4000) this.stopShooter(id); }
    this.peers.frame(dt);
    if (this.live) { this.live.frame(dt); if ((this.live.ended && this.live.endT > 2.5) || (this.liveEndAt && performance.now() - this.liveEndAt > 6000)) this.dropWatch(); }
    if (this.awaitStart && performance.now() - this.awaitStart > 8000) this.startFailed();
    // (online: my arrival stamp every few seconds; my goal twice a second while I shoot around)
    const now = performance.now();
    if (now - this.stampAt > 3000) { this.stampAt = now; this.stamp(); }
    if (this.mode === 'practice' && now - this.shootAt > 500) { this.shootAt = now; this.sendPracticePos(); }
    if ((this.boardT -= dt) <= 0) { this.boardT = 30; this.refreshBoards(); }
    // (qp12: who's here, once a second; the AI people walk, shoot around, follow)
    if (this.queueing && now > this.queueing.until) this.queueEnded();
    if ((this.crowdT -= dt) <= 0) { this.crowdT = 1; this.syncCrowd(); }
    const near = [...this.bots.values()].filter(b => !b.session);
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) { separate(near[i].p, near[j].p); if (!this.walkable(near[i].p.x, near[i].p.z)) separate(near[j].p, near[i].p); }
    for (const [id, b] of [...this.bots]) {
      if (b.gone) { this.dropBot(id); continue; }
      if (b.session) { b.session.frame(dt); continue; }
      if (this.mode === 'match') continue;
      b.update(dt); b.render(dt);
      if (b.plan?.kind === 'shoot' && !b.owner && !b.leaving && !b.path.length && this.mode !== 'starting') this.startBotShoot(b);
    }
    for (const f of this.peers.followers()) if (this.area === 'hub' && !this.walkable(f.p.x, f.p.z)) f.p.setPos(f.owner.p.x, f.owner.p.z, f.owner.p.facing);
    if (this.mode === 'roam') this.roam(dt);
    else if (this.mode === 'match' && this.session) {
      if (inp.wasPressed('pause') && !this.session.ended && !this.session.paused && !this.app.modalOpen()) this.ui.pauseGame(this);
      this.session.frame(dt);
    } else if (this.mode === 'practice' && this.practice) {
      this.practice.frame(dt);
      if (inp.wasPressed('pause')) this.endPractice();
    }
    for (const h of this.hoops.values()) h.step();
    this.ui.update?.(this);
  }
  sendPracticePos() {
    const net = this.netHere(); if (!net || !net.people.size || !this.practice) return;
    const p = this.practice.game.players[0], [ox, , oz] = this.practice.origin, r2 = v => Math.round(v * 100) / 100;
    net.send({ t: 'pos', x: r2(p.x + ox), z: r2(p.z + oz), f: r2(p.facing || 0), m: shootCode(this.practiceSlot) });
  }

  // can I stand here? (the hub's rooms and doorways; the home park inside its bounds)
  walkable(x, z) {
    if (this.area === 'hub') return this.venue.walkable(x, z, this.me.phys.radius);
    const b = this.venue.bounds; return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
  }
  roam(dt) {
    const app = this.app, inp = app.input, me = this.me;
    inp.ctx = 'roam';
    this.meVisual.syncIcon?.(app.char());
    const place = () => { this.meVisual.anim.update(dt, { x: me.x, y: 0, z: me.z, facing: me.facing }, me, null, null, {}); this.meVisual.place(me.x, 0, me.z); };
    if (app.modalOpen()) { me.intent.mx = me.intent.mz = 0; me.move(dt * GAME_SPEED, false, 0); place(); this.camera(dt, null); return; }
    if (inp.wasPressed('pause')) { this.ui.pause(this); return; }
    const mv = inp.moveVector(), basis = this.rig.inputBasis();
    me.intent.mx = basis.rx * mv.x + basis.fx * mv.y;
    me.intent.mz = basis.rz * mv.x + basis.fz * mv.y;
    me.intent.sprint = inp.isDown('sprint');
    me.intent.face = null; me.intent.stickFace = true;
    const ox = me.x, oz = me.z;
    me.move(dt * GAME_SPEED, false, 0);
    me.stamina = Math.min(1, me.stamina + dt * 0.2);
    this.collide(ox, oz);
    place();
    this.camera(dt, inp);
    this.scene.shadowFocus = { center: [me.x, 0, me.z + 2], radius: 16 };
    this.interact(inp);
    if (inp.wasPressed('celebrate') && !me.action) {
      const item = this.char.equipment?.celebration || null, anim = item ? this.catalog?.[item]?.anim : null;
      me.startAction('celebrate', 1.6, { kind: anim || 'flex' });
      const net = this.netHere();
      if (net && net.people.size) net.emote(anim ? item : null, anim ? null : 'flex', 1.6);
    }
    if (me.action) { me.action.t += dt; if (me.action.t > me.action.dur) me.action = null; }
  }
  // walls (sliding along them), the furniture, the people here
  collide(ox, oz) {
    const me = this.me;
    if (!this.walkable(me.x, me.z)) {
      if (this.walkable(me.x, oz)) me.z = oz;
      else if (this.walkable(ox, me.z)) me.x = ox;
      else { me.x = ox; me.z = oz; }
    }
    for (const s of this.venue.solids || []) pushOut(me, s);
    if (this.area === 'park' && (this.session || this.live) && this.mainRect) pushOut(me, this.mainRect);
    for (const w of this.peers.list()) separate(me, w.p);
    for (const b of this.bots.values()) if (!b.session && !b.owner) separate(me, b.p);
    for (const s of this.shooters.values()) { const p = s.session.game.players[0], [sx, , sz] = s.session.origin; separate(me, { x: p.x + sx, z: p.z + sz, phys: p.phys }); }
    if (this.live) for (const p of this.live.game.players) separate(me, { x: p.x + this.main.origin[0], z: p.z + this.main.origin[2], phys: p.phys });
    if (!this.walkable(me.x, me.z)) { me.x = ox; me.z = oz; }
  }
  // the roam camera: its boom stops at the walls; under a low ceiling (the office) it stays under it
  camera(dt, inp) {
    const rig = this.rig, R = this.area === 'hub' ? this.venue.roomAt?.(this.me.x, this.me.z) : null;
    if (R && R.h < 5) {
      const keep = rig.roamDist, cap = Math.max(2.2, (R.h - 1.7) / Math.max(0.12, Math.sin(rig.roamPitch)));
      rig.roamDist = Math.min(keep, cap);
      const before = rig.roamDist;
      rig.updateRoam(dt, this.me, inp, this.venue.bounds, this.camSolids);
      rig.roamDist = keep + (rig.roamDist - before);
    } else rig.updateRoam(dt, this.me, inp, this.venue.bounds, this.camSolids);
  }
  // the interactable you're at: the nearest one in reach
  nearest() {
    const me = this.me; let best = null, bd = Infinity;
    for (const it of this.interactables()) { const d = Math.hypot(me.x - it.x, me.z - it.z); if (d < it.r && d < bd) { bd = d; best = it; } }
    return best;
  }
  interactables() {
    if (this.area === 'hub') return this.venue.interactables;
    const d = this.venue.clubhouse?.door || this.venue.spawn, [ox, , oz] = this.main.origin, X = COURT_SIDE;
    return [{ id: 'walkin', x: d.x, z: d.z, r: 1.9 }, { id: 'home3s', x: ox + X, z: oz, r: 2.6 }, { id: 'home3s', x: ox - X, z: oz, r: 2.6 }];
  }
  interact(inp) {
    const E = promptGlyph(inp, 'E', 'A'), go = inp.wasPressed('interact');
    const it = this.near = this.nearest();
    this.prompt = it ? this.promptFor(it, E) : '';
    if (it && go) this.use(it);
  }
  promptFor(it, E = 'E') {
    const cap = this.isCaptain(), park = proamInfo(this.venue.park || this.parkId)?.name || 'your home court';
    switch (it.id) {
      case 'exit': return `${E} ${this.from === 'park' ? 'Back to the park' : 'Back to the Pro-Am menu'}`;
      case 'walkout': return `${E} Walk out to ${park} · your home court`;
      case 'whiteboard': return `${E} Whiteboard · the series, the record, the ranks`;
      case 'draft': return cap ? `${E} Draft clipboard · pick for the open spots` : `${E} Draft clipboard · the Captain picks`;
      case 'settings': return this.isFounder() ? `${E} Team settings${customizable(this.tier) ? ' · floor, walls, logo, colors' : ''}` : `${E} Team settings · the founder's`;
      case 'queue': return cap ? `${E} Queue the next game · ready check` : `Queue the next game · ${this.captainName()} (Captain) queues`;
      case 'invite': { const n = (this.team?.members || []).length; return `${E} Invite to the club · AI friends and players (${n}/${CLUB_MAX})`; }
      case 'shoot': return `${E} Shoot around`;
      case 'walkin': return `${E} Back into the clubhouse`;
      case 'home3s': { const n = this.realHere().length; return this.live ? 'A game is on · watch it from here' : `${E} Run 3s on the home court${n ? ` · ${n + 1} of you here` : ' · against the AI'}`; }
      default: return '';
    }
  }
  use(it) {
    switch (it.id) {
      case 'exit': this.ui.exit(this); return 'exit';
      case 'walkout': this.walkOut(); return 'walkout';
      case 'whiteboard': this.openPanel('whiteboard'); return 'whiteboard';
      case 'draft': this.openPanel('draft'); return 'draft';
      case 'settings': this.openPanel('settings'); return 'settings';
      case 'queue': this.queueNext(); return 'queue';
      case 'invite': this.openInvite(); return 'invite';
      case 'shoot': this.startPractice(it.slot || 0); return 'shoot';
      case 'walkin': this.walkIn(); return 'walkin';
      case 'home3s': if (this.live) return null; if (this.realHere().length) this.ui.pick3s(this); else this.startHome3s(); return 'home3s';
      default: return null;
    }
  }

  // ---------------- the walk-out (Gold) ----------------
  walkOut(following = false) {
    if (!this.venue.walkout) return false;
    if (!following) this.sendPos(POS.WALKOUT);
    this.walking = true;
    return (this.opts.enter || enterHub)(this.app, { team: this.team, season: this.season, from: this.from, park: this.park, area: 'park', officeUI: this.officeUI });
  }
  walkIn() { return (this.opts.enter || enterHub)(this.app, { team: this.team, season: this.season, from: this.from, park: this.park, area: 'hub', at: 'walkout', officeUI: this.officeUI }); }

  hideMe(hide) { this.meVisual.view?.setVisible?.(!hide); if (this.meVisual.blob) this.meVisual.blob.visible = !hide; if (this.meVisual.ring) this.meVisual.ring.visible = !hide; this.meVisual.setHidden?.(hide); }

  // ---------------- shootaround ----------------
  startPractice(slot = 0) {
    if (this.area !== 'hub' || !this.venue.shootSlots?.[slot]) return false;
    const app = this.app, char = app.char();
    this.hideMe(true);
    const entry = { ...this.meEntry, human: true, build: { ...char }, badges: badgeTiers(char) };
    this.practice = new MatchSession(app, { mode: 'practice', hub: true, pool: this.pool, scene: this.scene, venue: this.venue, court: this.slotCourt(slot), rosters: [[entry], []], teams: [{ name: 'You', abbr: 'YOU', color: this.look.primary }, { name: '', abbr: '', color: '#888' }], seed: 7 });
    this.practiceSlot = slot; this.mode = 'practice'; this.shootAt = 0;
    app.hud?.show(true);
    this.ui.toast('Shootaround: Esc to stop');
    return true;
  }
  endPractice() {
    if (!this.practice) return;
    const p = this.practice.game.players[0], [ox, , oz] = this.practice.origin;
    this.practice.dispose(); this.practice = null;
    this.hideMe(false);
    let x = p.x + ox, z = p.z + oz;
    if (!this.walkable(x, z)) { const s = this.venue.shootSlots[this.practiceSlot].spot; x = s.x; z = s.z; }
    this.me.setPos(x, z, Math.PI);
    this.practiceSlot = -1;
    this.mode = 'roam'; this.rig.snap(); this.app.hud?.show(false);
  }

  // ---------------- 3s on the home court (the walk-out) ----------------
  // a ticket for a home-court 3s game: a small amount of VC, no Rep (the service's rule: pa_home). null: not paid
  async homeTicket() {
    const app = this.app, c = app.char();
    try {
      return await app.api.mutate('/api/matches', { character_id: c.id, mode: 'park', venue: 'proam_' + this.parkId, format: HOME_FORMAT, target: settings.parkTarget || 11, difficulty: settings.difficulty ?? 0.6, pa_home: true });
    } catch (e) { console.warn('[hub] home-court ticket', e?.message || e); return null; }
  }
  // three AI players for a side: the team's draft picks for this series first (they're on the team), then regulars
  aiThree(n, exclude, key) {
    const picks = Object.values(this.team?.current?.picks || {}).filter(id => typeof id === 'string');
    const out = [];
    for (const id of picks) { if (out.length >= n || exclude.has(id)) continue; try { const e = this.world.gameEntry(id); if (e) { out.push(e); exclude.add(id); } } catch { /* not in this world */ } }
    while (out.length < n) { const id = this.world.pick({ level: 0.62, exclude, key: key + out.length }); exclude.add(id); out.push(this.world.gameEntry(id)); }
    return out;
  }
  async startHome3s() {
    if (this.area !== 'park' || this.mode !== 'roam') return false;
    const app = this.app;
    this.mode = 'starting';
    const ticket = await this.homeTicket();
    if (this.disposed) return false;
    this.ticket = ticket;
    const seed = ticket?.seed ?? this.rng.int(1, 1e9), used = new Set();
    const lk = this.look, other = contrast(lk.primary);
    const mates = this.aiThree(HOME_FORMAT - 1, used, `pahome${seed}m`), opp = [];
    while (opp.length < HOME_FORMAT) { const id = this.world.pick({ level: 0.62, exclude: used, key: `pahome${seed}o${opp.length}` }); used.add(id); opp.push(this.world.gameEntry(id)); }
    const char = app.char(), me = { ...this.meEntry, human: true, build: ticket ? boostedBuild(char, ticket.meta?.boosts) : { ...char }, badges: badgeTiers(char) };
    const mine = [me, ...mates.map(e => ({ ...e, human: false }))], them = opp.map(e => ({ ...e, human: false }));
    mine.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, this.catalog, { ...uniform(lk.primary, lk.secondary, lk.abbr), number: e.build.appearance?.number ?? (i * 7 + 3) % 50, name: e.name }); });
    them.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, this.catalog, { ...uniform(other, lk.primary, 'RUN'), number: e.build.appearance?.number ?? (i * 9 + 11) % 50, name: e.name }); });
    this.run = { mine, them, seed };
    this.hideMe(true);
    this.session = new MatchSession(app, {
      mode: 'park', full: true, hub: true, pool: this.pool, scene: this.scene, venue: this.venue, court: this.main, rosters: [mine, them], seed,
      teams: [{ name: lk.name, abbr: lk.abbr, color: lk.primary }, { name: 'Home Court Run', abbr: 'RUN', color: other }],
      target: ticket?.meta?.target ?? settings.parkTarget ?? 11, difficulty: ticket?.meta?.difficulty ?? settings.difficulty ?? 0.6,
      onEnd: (summary, s) => this.home3sOver(summary, s),
    });
    this.mode = 'match'; app.mode = 'match';
    music.duck?.(true);
    this.ui.matchStarted(this);
    return true;
  }
  async home3sOver(summary, session, opts = {}) {
    const app = this.app, won = summary.winner === summary.me.team;
    if (this.run?.mine) this.world.recordGame?.(this.run.mine.map(e => e.aiId).filter(Boolean), this.run.them.map(e => e.aiId).filter(Boolean), won);
    const mates = (this.run?.mine || []).map(e => e.aiId).filter(Boolean).slice(0, 2);
    const saving = this.ticket ? app.api.mutate(`/api/matches/${this.ticket.id}/complete`, { summary, mates }).catch(e => { this.ui.toast('Result not saved: ' + e.message, 'error'); return null; }) : Promise.resolve(null);
    this.ticket = null;
    await this.ui.results3s(this, summary, session, won, saving, opts);
  }
  // after the final: run it back, or back onto the court's sideline
  end3s(again = false) {
    if (this.session) { this.session.dispose(); this.session = null; }
    const wasOnline = !!this.onlineGame;
    this.run = null; this.onlineGame = null;
    this.app.mode = 'park';
    music.duck?.(false);
    this.hideMe(false);
    this.mode = 'roam';
    if (again && wasOnline && this.realHere().length) { this.startOnline3s(this.lastSplit); return; }
    if (again && !wasOnline) { this.startHome3s(); return; }
    const [ox, , oz] = this.main.origin;
    this.me.setPos(ox + COURT_SIDE, oz, -Math.PI / 2);
    this.rig.snap(); this.app.hud?.show(false);
    this.ui.backToRoam?.(this);
  }
  async forfeitMyGame() {
    if (this.onlineGame) this.app.net?.send({ t: 'quit' });
    if (this.ticket) { try { await this.app.api.post(`/api/matches/${this.ticket.id}/cancel`, {}); } catch { /* ignore */ } this.ticket = null; }
    this.ui.toast('You left the game.');
    this.end3s(false);
  }
  get mySession() { return this.session; }

  // ---------------- online 3s with the team members at the home park ----------------
  // split: real people on both sides; otherwise all of you together against the AI. Open spots: AI regulars.
  startOnline3s(split = false) {
    const app = this.app, net = this.netHere();
    if (!net || this.mode !== 'roam' || this.area !== 'park') return false;
    this.lastSplit = split;
    const people = [personOf(app, net.myId), ...this.realHere()].filter(p => p?.entry).slice(0, HOME_FORMAT * 2);
    const sides = [[], []];
    people.forEach((p, i) => { const t = split ? i % 2 : (sides[0].length < HOME_FORMAT ? 0 : 1); sides[t].push({ entry: p.entry, person: p }); });
    const seed = newSeed(), used = new Set();
    for (const t of [0, 1]) while (sides[t].length < HOME_FORMAT) { const id = this.world.pick({ level: 0.62, exclude: used, key: `pahol${seed}-${t}-${sides[t].length}` }); used.add(id); sides[t].push({ entry: this.world.gameEntry(id) }); }
    const lk = this.look, other = contrast(lk.primary);
    const map = new Map();
    const rosters = sides.map((side, t) => side.map((x, i) => {
      const e = setupEntry(app, x.entry, !!x.person, x.person?.username);
      e.look = resolveLook({ ...e.build, name: e.name }, this.catalog, { ...(t ? uniform(other, lk.primary, split ? lk.abbr : 'RUN') : uniform(lk.primary, lk.secondary, lk.abbr)), number: e.build.appearance?.number ?? (i * (t ? 9 : 7) + (t ? 11 : 3)) % 50, name: e.name });
      if (x.person) map.set(e, x.person);
      return e;
    }));
    const { slots, names, meter } = seatPeople(rosters, map);
    const nm = t => (split ? `${sides[t][0].person?.username || lk.abbr}'s three` : t ? 'Home Court Run' : lk.name);
    const setup = {
      kind: 'hq', where: this.placeKey(), court: null, format: HOME_FORMAT, full: true, seed, rosters, slots, names, meter,
      teams: [{ name: nm(0), abbr: lk.abbr, color: lk.primary }, { name: nm(1), abbr: 'RUN', color: other }],
      delay: inputDelay(people.map(p => p.rtt)), target: settings.parkTarget || 11, difficulty: settings.difficulty ?? 0.6,
    };
    this.mode = 'starting'; this.awaitStart = performance.now();
    net.send({ t: 'start', setup });
    return true;
  }
  startFailed() { this.awaitStart = null; if (this.mode === 'starting' && !this.session) { this.mode = 'roam'; this.ui.toast('The game didn\'t start (the hosted game didn\'t answer).', 'error'); } }
  onError() { if (this.awaitStart) this.startFailed(); }
  readyForOnline() {
    if (this.mode === 'practice') this.endPractice();
    return this.area === 'park' && (this.mode === 'roam' || (this.mode === 'starting' && !!this.awaitStart) || (this.mode === 'match' && !!this.session?.ended));
  }
  async startOnlineGame(setup, local) {
    const app = this.app;
    this.awaitStart = null;
    if (this.session) { this.session.dispose(); this.session = null; }
    if (this.live) this.dropWatch();
    for (const a of Object.keys(setup.slots || {})) this.peers.drop(a);
    const rosters = structuredClone(setup.rosters);
    for (const r of rosters) for (const e of r) e.look = e.look || resolveLook({ ...e.build, name: e.name }, this.catalog);
    this.onlineGame = setup; this.run = { online: true };
    this.mode = 'starting';
    this.ticket = await this.homeTicket(); // (each of us pays himself: the same small rule)
    if (this.disposed) return;
    this.hideMe(true);
    const aids = Object.fromEntries(Object.entries(setup.slots).map(([a, s]) => [s, a]));
    this.session = new MatchSession(app, {
      mode: 'park', full: true, hub: true, scene: this.scene, venue: this.venue, court: this.main, rosters, seed: setup.seed, teams: setup.teams,
      target: setup.target, difficulty: setup.difficulty,
      online: { net: app.net, local, delay: setup.delay, game: setup.game, meter: setup.meter, names: setup.names, aids, onLost: () => { this.ui.toast('Lost the connection to the game service: you left the game.', 'error'); this.end3s(false); } },
      onEnd: (summary, s) => this.home3sOver(summary, s, { online: true, again: this.realHere().length > 0 }),
    });
    this.mode = 'match'; app.mode = 'match';
    music.duck?.(true);
    this.ui.matchStarted(this);
  }
  watchGame(setup) {
    if (setup.slots?.[this.app.net?.myId] != null || this.session || this.area !== 'park') return;
    if (this.live) this.dropWatch();
    for (const a of Object.keys(setup.slots || {})) this.peers.drop(a);
    const rosters = structuredClone(setup.rosters);
    for (const r of rosters) for (const e of r) e.look = e.look || resolveLook({ ...e.build, name: e.name }, this.catalog);
    this.liveSetup = setup; this.liveEndAt = 0;
    this.live = new MatchSession(this.app, {
      background: true, hub: true, pool: this.pool, mode: 'park', full: true, scene: this.scene, venue: this.venue, court: this.main, rosters, seed: setup.seed, teams: setup.teams,
      target: setup.target, difficulty: setup.difficulty,
      online: { net: this.app.net, local: -1, spectate: true, delay: setup.delay, game: setup.game, meter: setup.meter, names: setup.names, onLost: () => { this.liveEndAt = 1; } },
    });
    this.ui.toast(`${Object.values(setup.names || {}).join(', ')} ${Object.keys(setup.slots || {}).length > 1 ? 'are' : 'is'} running 3s on the home court.`);
  }
  endWatch(g) { if (this.liveSetup?.game === g && !this.liveEndAt) this.liveEndAt = performance.now(); }
  dropWatch() { if (!this.live) return; this.live.dispose(); this.live = null; this.liveSetup = null; this.liveEndAt = 0; }

  onFocusLost() { if (this.mode === 'match' && this.session && !this.session.ended && !this.session.paused && !this.app.modalOpen()) this.ui.pauseGame(this); }
  deactivate() { }
  dispose() {
    this.disposed = true;
    this.offReady?.(); this.offReady = null;
    for (const id of [...this.bots.keys()]) this.dropBot(id);
    this.peers.detach();
    if (this.live) this.live.dispose();
    for (const id of [...this.shooters.keys()]) this.stopShooter(id);
    if (this.session) this.session.dispose();
    if (this.practice) this.practice.dispose();
    this.meVisual.dispose();
    if (this.ownPool) this.pool.dispose?.();
    releaseScene(this.r?.ctx, this.scene); // (QP3: the hub's own geometry and textures; the caches keep theirs)
  }
}
const COURT_SIDE = 9.6; // (m from the court's middle: where you start 3s on the home court, by either sideline)
// (qp12) where the AI people go in a HUB: places to stand along the court (hang), by each shootaround goal (goals[slot]),
// in the office (office, the nearest the queue first), and the door they come in by. Fixed by the building: the same
// list on every screen
export function crowdSpots(venue, main) {
  const solids = venue.solids || [], its = venue.interactables || [];
  const ok = (x, z) => venue.walkable(x, z, 0.5) && !solids.some(b => x > b.x0 - 0.55 && x < b.x1 + 0.55 && z > b.z0 - 0.55 && z < b.z1 + 0.55) && !its.some(i => Math.hypot(i.x - x, i.z - z) < Math.min(i.r, 1.2) + 0.35);
  const rc = courtPlayRect(main, 0), hang = [];
  for (let z = rc.z0 + 2; z <= rc.z1 - 2; z += 2.6) for (const x of [rc.x0 - 1.5, rc.x1 + 1.5]) if (ok(x, z)) hang.push({ x, z, face: x < (rc.x0 + rc.x1) / 2 ? Math.PI / 2 : -Math.PI / 2 });
  for (let x = rc.x0 + 2; x <= rc.x1 - 2; x += 2.8) if (ok(x, rc.z0 - 1.6)) hang.push({ x, z: rc.z0 - 1.6, face: 0 });
  const goals = (venue.shootSlots || []).map(sl => [[2.3, 1.4], [-2.3, 1.4], [3.2, -0.6], [-3.2, -0.6]].map(([dx, dz]) => ({ x: sl.spot.x + dx, z: sl.spot.z + dz })).filter(q => ok(q.x, q.z)).map(q => ({ ...q, face: Math.atan2(sl.spot.x - q.x, sl.spot.z - 2.5 - q.z) })));
  const R = (venue.rooms || []).find(r => r.id === venue.office?.room), q = venue.office?.queue, office = [];
  if (R && q) {
    // (in the office anywhere free but on the queue spot itself; then, the office full, just outside its door)
    const free = (x, z) => venue.walkable(x, z, 0.4) && !solids.some(b => x > b.x0 - 0.45 && x < b.x1 + 0.45 && z > b.z0 - 0.45 && z < b.z1 + 0.45) && Math.hypot(q.x - x, q.z - z) > 0.65;
    for (let x = R.x0 + 0.55; x <= R.x1 - 0.55; x += 0.75) for (let z = R.z0 + 0.55; z <= R.z1 - 0.55; z += 0.75) if (free(x, z)) office.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
    office.sort((a, b) => Math.hypot(a.x - q.x, a.z - q.z) - Math.hypot(b.x - q.x, b.z - q.z));
    const d = venue.office.door, s = Math.sign((R.z0 + R.z1) / 2 - d.z) || 1, out = [];
    for (const dx of [0, -1, 1, -2, 2, -3, 3]) for (const dz of [1.6, 2.6]) { const x = d.x + dx * 0.85, z = d.z - s * dz; if (free(x, z) && !venue.roomAt?.(x, z)?.id?.startsWith('office')) out.push({ x, z }); }
    office.splice(Math.min(office.length, 10), 0, ...out);
  }
  const door = venue.exit ? { x: venue.exit.x, z: venue.exit.z } : venue.spawn ? { x: venue.spawn.x, z: venue.spawn.z } : null;
  return { hang, goals, office: office.slice(0, 16), door };
}

// ---------------- the way in ----------------
// opts: {from: 'menu'|'park', park, area, at, team, season} (and for the tests: officeUI, modes, ui, toCreate, toast)
export async function enterHub(app, opts = {}) {
  if (enterHub.busy) return null;
  enterHub.busy = true;
  try {
    let U = opts.officeUI || null;
    if (!U) { try { U = await import('../ui/proamui.js'); } catch (e) { console.warn('[hub] ProamUI', e?.message || e); U = null; } }
    let st = null;
    if (!opts.team) { try { st = U?.load ? await U.load(app) : null; } catch (e) { console.warn('[hub] team', e?.message || e); st = null; } }
    const team = opts.team || st?.team || app.proam?.team || null;
    const season = opts.season || st?.season || app.proam?.season || null;
    const say = opts.toast || (async (t, k) => (await import('../ui/common.js')).toast(t, k));
    if (!team) {
      await say('Create a Pro-Am team or join one: your team\'s hub opens with it.');
      await (opts.toCreate || toCreateJoin)(app);
      return null;
    }
    const Modes = opts.modes || await import('../ui/modes.js');
    Modes.leaveWorld(app);
    const ui = opts.ui || new HubUI(app);
    ui.mount?.();
    let hub;
    try { hub = new ProamHub(app, ui, { ...opts, team, season, officeUI: U }); }
    catch (e) {
      console.error(e); await say(e.message || 'The hub could not open.', 'error');
      if (opts.from === 'park' && opts.park) Modes.enterPark(app, opts.park); else (await import('../ui/screens.js')).go(app, 'proam');
      return null;
    }
    app.world = hub; app.mode = 'park';
    app.setController(hub, hub.scene);
    ui.intro?.(hub);
    touchWhere(app);
    return hub;
  } finally { enterHub.busy = false; }
}
// no team: the Pro-Am tab's first screen (create a team or join one: ui/proam.js render, view 'start')
async function toCreateJoin(app) { const S = await import('../ui/screens.js'); S.go(app, 'proam', { view: 'start' }); }

// ---------------- the hub's overlay ----------------
// the top badge (the team, the building, the Captain), the prompt, the names over the team members, the pause menu, the
// home-court results. The DOM pieces load with it (ui/common.js); the menus and the park on demand (ui/modes.js).
export class HubUI {
  constructor(app) { this.app = app; this.lastPrompt = null; this.tags = new Map(); this.tmpP = {}; this.lastTop = null; }
  async dom() { if (!this.C) this.C = await import('../ui/common.js'); return this.C; }
  mount() {
    const ui = document.querySelector('#ui');
    ui.innerHTML = '<div class="park-top" id="park-top"></div><div class="friend-tags" id="friend-tags"></div><div id="pa-lineup" class="pa-lineup" hidden style="position:absolute;right:18px;top:84px;max-width:340px;padding:12px 14px;border-radius:12px;background:rgba(12,14,18,.88);border:1px solid rgba(255,255,255,.12);color:#eef1f4;font-size:13px;line-height:1.45;pointer-events:none;z-index:5"></div>';
    ui.className = 'layer';
    this.tags = new Map(); this.lastTop = null; this.lastPrompt = null;
    this.dom();
  }
  topHTML(hub) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const lk = hub.look, where = hub.area === 'park' ? `${proamInfo(hub.parkId)?.name || 'Home court'} · home court` : HUB_NAMES[hub.tier];
    const n = hub.realHere().length, cap = hub.isCaptain() ? 'You\'re the Captain' : `Captain: ${hub.captainName()}`;
    const nAI = hub.aiMembersHere?.().length || 0, nSq = hub.squadHere?.().length || 0; // (qp12: the AI members on, the squad mates who came)
    const tp = teamProgress(hub.team); // (qp8: the team's own rank, apart from each player's)
    return `<div class="park-badge pa-hub-badge" style="--c:${esc(lk.primary)}"><b>${esc(lk.name)} <span class="crew-tag sm">${esc(lk.abbr)}</span></b><small>${esc(where)} · ${n ? `${n + 1} of the team here` : 'just you here'}${nAI ? ` · ${nAI} AI member${nAI > 1 ? 's' : ''} on` : ''}${nSq ? ` · ${nSq} squad mate${nSq > 1 ? 's' : ''}` : ''} · ${esc(cap)}</small>${tp ? `<small class="pa-hub-rank">Team ${esc(tp.label)} · ${tp.raw} RP · ${esc(tp.text)}</small>` : ''}</div><div class="park-keys muted small" id="park-keys"></div>`;
  }
  intro(hub) {
    this.lastTop = null; this.update(hub);
    const lk = hub.look;
    if (hub.area === 'park') this.toast(`${proamInfo(hub.parkId)?.name || 'Your home court'}: your team's home court. Run 3s on it from either sideline; the clubhouse door takes you back in.`);
    else this.toast(`Welcome to the ${lk.name} hub. The office has the whiteboard, the draft and the queue; shoot around while you wait.`);
  }
  toast(t, k) { this.dom().then(C => C.toast(t, k)); }
  update(hub) {
    const p = hub.mode === 'roam' ? hub.prompt : '';
    if (p !== this.lastPrompt) { this.lastPrompt = p; const el = document.querySelector('#prompt'); if (el) el.innerHTML = p ? `<div class="prompt">${p}</div>` : ''; }
    const top = document.querySelector('#park-top');
    if (top) {
      const h = this.topHTML(hub);
      if (h !== this.lastTop) { this.lastTop = h; top.innerHTML = h; const k = document.querySelector('#park-keys'); if (k) k.innerHTML = '<kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · right-drag look · <kbd>E</kbd> use · <kbd>Esc</kbd> menu'; }
      top.hidden = hub.mode !== 'roam';
    }
    this.friendTags(hub);
    this.lineupCard(hub);
  }
  // (qp12) the HUB's ready-check view: who's coming to the game while a queue is on (hub.lineupView)
  lineupHTML(v) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const row = (k, list, tag) => (list.length ? `<div><b style="color:#9aa4ae;font-size:11px;letter-spacing:.08em">${k}</b><br>${list.map(n => `${esc(n)}${tag ? ` <span style="font-size:10px;padding:0 5px;border-radius:5px;background:${tag[1]};color:#fff">${tag[0]}</span>` : ''}`).join(', ')}</div>` : '');
    return `<div style="font-size:11px;letter-spacing:.1em;color:#ff8a5c;font-weight:800">${v.final ? 'THE LINEUP' : 'READY CHECK · WHO\'S COMING'}</div>
      ${row('PLAYERS', v.humans)}${row('AI MEMBERS', v.members, ['AI', '#2b6cb0'])}${row('SQUAD MATES', v.squad, ['SQUAD', '#1f8a4c'])}${row('DRAFT', v.draft, ['DRAFT', '#6b4a30'])}
      ${v.more ? `<div style="color:#9aa4ae">${v.more} more from the draft clipboard</div>` : ''}`;
  }
  lineupCard(hub) {
    const el = document.querySelector('#pa-lineup'); if (!el) return;
    const v = hub.mode === 'roam' ? hub.lineupView?.() : null;
    const h = v ? this.lineupHTML(v) : '';
    if (h !== this.lastLineup) { this.lastLineup = h; el.innerHTML = h; el.hidden = !h; }
  }
  friendTags(hub) {
    const box = document.querySelector('#friend-tags'); if (!box) return;
    const bots = [...(hub.bots?.values() || [])].filter(b => !b.session && !b.disposed).map(b => ({ id: 'ai:' + b.id, p: b.p, visual: b.visual, username: `${b.name} · ${b.kind === 'squad' ? 'squad' : 'AI'}` }));
    // (qp12: the AI people too: the HUB's own, and the AI squad mates the others brought, with whose they are)
    const fol = hub.peers.followers().map(f => ({ id: 'fol:' + (f.owner?.id || '') + ':' + f.aiId, p: f.p, visual: f.visual, username: `${f.entry?.name || 'AI'} · ${f.owner?.username ? `${f.owner.username}'s squad` : 'squad'}` }));
    const ws = hub.mode === 'roam' && settings.tags !== false ? [...hub.peers.list(), ...bots, ...fol] : [];
    for (const [id, el] of this.tags) if (!ws.some(w => w.id === id)) { el.remove(); this.tags.delete(id); }
    for (const w of ws) {
      let el = this.tags.get(w.id);
      if (!el) { el = document.createElement('div'); el.className = 'friend-tag'; el.textContent = w.username || w.entry.name; box.appendChild(el); this.tags.set(w.id, el); }
      const cap = hub.captainId() === w.id;
      if (el._cap !== cap) { el._cap = cap; el.textContent = (cap ? '★ ' : '') + (w.username || w.entry.name); el.classList.toggle('sq', cap); }
      const p = hub.r.project(this.app.camera, [w.p.x, (w.visual.view?.H || 1.95) + 0.3, w.p.z], this.tmpP);
      el.hidden = !p.visible || p.depth > 60 || !!w.visual.pending;
      if (!el.hidden) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
  async pause(hub) {
    const C = await this.dom(), Screens = await import('../ui/screens.js'), Phone = await import('../ui/phone.js');
    const cap = hub.isCaptain(), park = hub.area === 'park';
    const card = C.modal(`<h2>${C.esc(hub.look.name)} · ${park ? 'home court' : 'Pro-Am hub'}</h2><div class="col gap">
      <button class="btn primary" data-close>Resume</button>
      ${park ? '' : `<button class="btn" data-wb>Whiteboard</button><button class="btn" data-draft>Draft clipboard${cap ? '' : ' (the Captain picks)'}</button>
      <button class="btn" data-queue ${cap ? '' : 'disabled'}>Queue the next game${cap ? '' : ` · ${C.esc(hub.captainName())} queues`}</button>
      ${hub.isFounder() ? '<button class="btn" data-settings>Team settings</button>' : ''}<button class="btn" data-invite>Invite to the club</button>`}
      <button class="btn" data-phone>Social</button>
      <button class="btn" data-opts>Settings & controls</button>
      ${park ? '<button class="btn" data-in>Back into the clubhouse</button>' : `<button class="btn" data-out>${hub.from === 'park' ? 'Back to the park' : 'Back to the Pro-Am menu'}</button>`}
      <button class="btn ghost" data-home>Main menu</button></div>`);
    const on = (sel, f) => { const b = card.querySelector(sel); if (b) b.onclick = () => { C.closeModal(); f(); }; };
    on('[data-wb]', () => hub.openPanel('whiteboard'));
    on('[data-draft]', () => hub.openPanel('draft'));
    on('[data-queue]', () => hub.queueNext());
    on('[data-settings]', () => hub.openPanel('settings'));
    on('[data-invite]', () => hub.openInvite());
    on('[data-phone]', () => Phone.openPhone(this.app));
    on('[data-opts]', () => Screens.openSettings(this.app));
    on('[data-in]', () => hub.walkIn());
    on('[data-out]', () => this.exit(hub));
    on('[data-home]', () => Screens.go(this.app, 'home'));
  }
  async pauseGame(hub) {
    const C = await this.dom(), s = hub.mySession; if (!s) return;
    s.paused = true;
    const card = C.modal('<h2>Paused</h2><div class="col gap"><button class="btn primary" data-close>Resume</button><button class="btn ghost" data-quit>Leave the game</button></div>');
    C.closeModal.onClose = () => { s.paused = false; };
    card.querySelector('[data-quit]').onclick = () => { C.closeModal.onClose = null; C.closeModal(); hub.forfeitMyGame(); };
  }
  // back where you came from: the park's Pro-Am HUB doors, or the Pro-Am tab
  async exit(hub) {
    if (hub.from === 'park' && hub.park) { const Modes = await import('../ui/modes.js'); Modes.enterPark(this.app, hub.park, { at: 'proam' }); return; }
    const S = await import('../ui/screens.js'); S.go(this.app, 'proam');
  }
  matchStarted() { const el = document.querySelector('#prompt'); if (el) el.innerHTML = ''; this.app.hud?.show(true); }
  backToRoam() { audio.setCrowd?.(0); music.duck?.(false); }
  async pick3s(hub) {
    const C = await this.dom(), real = hub.realHere();
    const card = C.modal(`<h2>3s on the home court</h2><p class="muted">${C.esc(real.map(p => p.username).join(', '))} ${real.length > 1 ? 'are' : 'is'} here. Open spots go to regulars. Home-court games pay a little VC and no Rep.</p>
      <div class="col gap"><button class="btn primary" data-tog>Run together · against the AI</button><button class="btn" data-split>Run against each other</button><button class="btn ghost" data-solo>Just me · against the AI</button></div>`);
    card.querySelector('[data-tog]').onclick = () => { C.closeModal(); hub.startOnline3s(false); };
    card.querySelector('[data-split]').onclick = () => { C.closeModal(); hub.startOnline3s(true); };
    card.querySelector('[data-solo]').onclick = () => { C.closeModal(); hub.startHome3s(); };
  }
  async results3s(hub, summary, session, won, saving, opts = {}) {
    const C = await this.dom(), { playOutro } = await import('../ui/outro.js'), app = this.app, me = summary.me.stats;
    await playOutro(app, { summary, session, result: saving });
    const r = await saving;
    if (r) { if (r.character) app.replaceChar?.(r.character); if (r.balance != null) app.setBalance?.(r.balance); }
    const pct = (a, b) => `${a}/${b}`;
    const card = C.modal(`<div class="results ${won ? 'win' : 'loss'}">
      <div class="eyebrow">${C.esc((proamInfo(hub.parkId)?.name || 'HOME COURT').toUpperCase())} · 3S · FINAL</div>
      <h1>${won ? 'Victory' : 'Defeat'} <span class="score">${summary.score[summary.me.team]}–${summary.score[1 - summary.me.team]}</span></h1>
      <div class="stat-strip">${[['PTS', me.pts], ['REB', me.reb], ['AST', me.ast], ['STL', me.stl], ['BLK', me.blk], ['FG', pct(me.fgm, me.fga)], ['3PT', pct(me.tpm, me.tpa)], ['TO', me.tov]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div>
      ${r ? `<div class="reward-row"><div class="reward"><b>+${C.money(r.vc || 0)}</b><small>VC EARNED</small></div><div class="reward"><b>—</b><small>NO REP · HOME COURT</small></div></div>` : '<p class="muted">Home-court games pay a little VC and no Rep. This one wasn\'t recorded.</p>'}
      <div class="row gap end"><button class="btn ghost" data-back>Back to the court</button><button class="btn primary" data-again ${opts.online && !opts.again ? 'disabled' : ''}>Run it back</button></div></div>`, { close: false, cls: 'results-card' });
    card.querySelector('[data-back]').onclick = () => { C.closeModal(); hub.end3s(false); };
    card.querySelector('[data-again]').onclick = () => { C.closeModal(); hub.end3s(true); };
    if (won) audio.ui?.('buy');
  }
}
