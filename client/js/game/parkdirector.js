// v0.4.8.7 the park director: one park for everyone in it, run the same on every screen.
// Online (server/online.py RIMRIFT_PARK_DIRECTOR), the park's AI life is a deterministic machine: a tick a second of the
// server's clock (tick k is server time t0 + k s), seeded per park epoch. Every client runs it from the same start (or the
// server's last agreed snapshot) with the same server-ordered events (the real players' claims and courts from the
// hosted game; their own moves as pacts: the AI they lend for a game or a Got Next spot, the AI they hand back), so every
// client has the same courts' games, kings and streaks, the same AI lines, hop-ons and park-goers walking the same paths,
// and the same ICON Squad. Nothing in here reads the wall clock, the frame time or Math.random (tests/v0487director.test.mjs
// greps for them): its time is the tick, its chance its own RNG, its state plain JSON (canonical(): sorted keys) with a
// 32-bit hash the server compares across clients.
// The courts' games are the real game (sim/game.js) stepped at a phase-only pace, the same everywhere: a live ball at 1x,
// dead balls and the final whistle at 2x, checks, inbounds and the tip at 3x (TICK_UNITS a tick: a step costs 6, 3 or 2
// units). A screen steps them toward its present between ticks (stepTo: never past the next tick nobody has decided yet),
// so a watched court plays smoothly; what happens on a court is decided only at tick boundaries, from the game itself, so
// the result never depends on who watches or how fast anybody's PC renders. A newcomer replays each game from its seed
// (catchUp, a slice per frame) and the director from the snapshot.
import { Game } from '../sim/game.js';
import { spreadGreens } from '../sim/bots.js';
import { DT } from '../sim/constants.js';
import { RNG, hashString } from '../core/rng.js';
import { MAX_ICONS_PER_AI_TEAM, isIconEntry, squadWindowAt } from '../sim/iconsquad.js';

export const PD_V = 1;
export const TICK_MS = 1000, TICK_UNITS = 360;
// a step's cost in units: checks, inbounds and the tip 3x; dead balls and the end 2x; a live ball 1x (game/park.js courtRate)
export const stepCost = g => (g.phase === 'check' || g.phase === 'inbound' || g.phase === 'pregame' ? 2 : g.phase === 'dead' || g.over ? 3 : 6);
const POP_EVERY = 20, SQUAD_EVERY = 2, ROTATE_AFTER = 2, WRAP_AFTER = 15, HOP_TICKS = 25 * 60, ICON_COOL = 30 * 60000, KINGS_TAKE = 15;
const VW = 2.2, VF = 3.8; // (m/s: strolling about; heading for a spot or the exit)
const MAX_WALKERS = 18;
// v0.4.2 layout (game/park.js ZONES): where the park-goers hang out
export const ZONES = [
  { x0: -46, x1: 46, z0: -30, z1: -21.5, w: 4 }, { x0: 11, x1: 15, z0: -12, z1: 12, w: 1 }, { x0: -15, x1: -11, z0: -12, z1: 12, w: 1 },
  { x0: 37.5, x1: 40.5, z0: -14, z1: 14, w: 1 }, { x0: -40.5, x1: -37.5, z0: -14, z1: 14, w: 1 },
];
const grow = (b, m) => ({ x0: b.x0 - m, x1: b.x1 + m, z0: b.z0 - m, z1: b.z1 + m });
const inBox = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
function segHitsBox(b, ax, az, bx, bz) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, b.x0, b.x1], [az, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p <= lo || p >= hi) return false; continue; }
    let u = (lo - p) / d, v = (hi - p) / d; if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 >= t1) return false;
  }
  return true;
}
const dist = (ax, az, bx, bz) => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz)); // (sqrt: the same bits on every engine)
// the state as one string: object keys sorted, so two equal states are the same text everywhere
export function canonical(v) {
  if (v === null || typeof v !== 'object') return typeof v === 'number' ? (Number.isFinite(v) ? JSON.stringify(v) : 'null') : JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export const hashState = s => hashString(canonical(s));
const AI_ID = /^ai-\d{1,4}$/;
export const validAI = id => typeof id === 'string' && AI_ID.test(id);

// One court's game: the real game from its seed and rosters, stepped by units (see stepCost). fin: a game the director
// wrapped up early (a real squad was waiting on it) ends at that unit count, the same on a replay
export class CourtRunner {
  constructor(dir, ci, g) {
    this.dir = dir; this.ci = ci; this.seed = g.seed; this.fin = g.fin ? { u: g.fin[0], w: g.fin[1] } : null;
    const c = dir.layout.courts[ci], tl = dir.tl(g.k0);
    this.entries = g.r.map((ids, t) => ids.map(id => dir.gameEntryAt(id, tl, t === 0 ? g.ws || 0 : 0)));
    this.game = new Game({ mode: 'park', full: !!c.full, seed: g.seed, rosters: this.entries, catalog: dir.catalog, target: 11, surface: dir.surface, difficulty: 0.6, assist: true, greenBonus: 1, multi: false, inputDelay: 0 });
    spreadGreens(this.game.players, dir.catalog); // (game/session.js does the same to every game it makes)
    this.u = g.k0 * TICK_UNITS; this.uPrev = this.u; this.steps = 0; this.events = [];
    this.keep = false; // (a screen is watching: keep its events for the view)
  }
  // step on until u reaches U (or max steps): the same steps, the same game, whenever and in however many calls they run
  stepTo(U, max = Infinity) {
    const g = this.game; let n = 0;
    while (this.u < U && n < max) {
      if (this.fin && !this.fin.done && this.u >= this.fin.u) { this.fin.done = true; if (!g.over) g.finish(this.fin.w); }
      const c = stepCost(g);
      g.step(DT);
      if (this.keep) for (const e of g.events) this.events.push(e);
      this.uPrev = this.u; this.u += c; this.steps++; n++;
    }
    if (this.fin && !this.fin.done && this.u >= this.fin.u && n < max) { this.fin.done = true; if (!g.over) g.finish(this.fin.w); }
    return n;
  }
  take() { const e = this.events; this.events = []; return e; }
}

export class ParkDirector {
  // opts: {world, park, layout: {courts: [{format, full, origin, rows, rect}], solids}, catalog, epoch, t0 (server ms), seed,
  // surface, toLocal(serverMs) → this PC's clock for the world's functions}
  constructor(opts, snap = null) {
    this.world = opts.world; this.park = opts.park; this.layout = opts.layout; this.catalog = opts.catalog || {};
    this.surface = opts.surface || 'asphalt'; this.t0 = opts.t0; this.toLocal = opts.toLocal || (ms => ms);
    this.runners = []; this.out = []; this.avail = null; this.xm = new Map();
    if (snap) { this.s = JSON.parse(JSON.stringify(snap)); this.rng = new RNG(1); this.rng.s = this.s.rng >>> 0; this.syncExtra(); this.s.courts.forEach((c, i) => { this.runners[i] = c.g ? new CourtRunner(this, i, c.g) : null; }); return; }
    const seed = (opts.seed >>> 0) || hashString(`${opts.park}|${opts.epoch}`);
    this.rng = new RNG(seed);
    this.s = { v: PD_V, park: opts.park, epoch: opts.epoch, k: 0, rng: 0, seq: 0, sq: 0, iconK: null, icon: null, extra: [], lent: [], players: [], walkers: [],
      courts: this.layout.courts.map(() => ({ g: null, kings: null, ks: 0, lines: [null, null], real: 0, claim: [null, null], ready: null, rb: null })) };
    this.begin();
    this.s.rng = this.rng.s >>> 0;
  }
  get k() { return this.s.k; }
  tl(k) { return this.toLocal(this.t0 + k * TICK_MS); }
  // ---------- the world, as of a tick (its hop-ons are this park's: the director's own, not this PC's) ----------
  syncExtra() { this.xm = new Map(this.s.extra.map(([id, until]) => [id, { park: this.park, until: this.tl(until) }])); this.avail = null; }
  withExtra(fn) { const w = this.world, keep = w.extra; w.extra = this.xm; try { return fn(); } finally { w.extra = keep; } }
  squadAt(tl) {
    const w = this.world; if (!w.iconSquad) return null;
    const win = squadWindowAt(tl); if (!win) return null;
    if (w.squadAsync && !(w.squads?.has(win.k) && w.preparing?.k !== win.k)) { const a = w.squadAsync; w.squadAsync = false; try { if (w.squads?.get(win.k) == null) w.squads?.delete(win.k); return w.iconSquad(tl); } finally { w.squadAsync = a; } }
    return w.iconSquad(tl);
  }
  status(id, tl) { return this.withExtra(() => this.world.status(id, tl)); }
  online(id, tl) { return !!this.status(id, tl); }
  gameEntryAt(id, tl, ws = 0) { this.squadAt(tl); const e = this.withExtra(() => this.world.entry(id, tl)); return { ...e, build: { ...e.build, win_streak: ws }, badges: { ...e.badges }, human: false }; }
  entryAt(id, tl) { return this.withExtra(() => this.world.entry(id, tl)); }
  // ---------- who is where ----------
  W(id) { return this.s.walkers.find(w => w.id === id) || null; }
  squads() { const s = new Set(); for (const [, ids] of this.s.players) for (const id of ids) s.add(id); return s; }
  lentSet() { return new Set(this.s.lent.map(l => l[0])); }
  busy() {
    const s = new Set();
    for (const w of this.s.walkers) s.add(w.id);
    for (const c of this.s.courts) { if (c.g) c.g.r.forEach(r => r.forEach(id => s.add(id))); if (c.kings) c.kings.forEach(id => s.add(id)); for (const l of c.lines) if (l) l.ids.forEach(id => s.add(id)); }
    for (const l of this.s.lent) s.add(l[0]);
    for (const id of this.squads()) s.add(id);
    return s;
  }
  iconLive(tl) { const u = this.s.icon; return !!u && !u.over && this.squadAt(tl)?.k === u.k; }
  iconIds(tl) {
    const u = this.s.icon, sq = this.squadAt(tl);
    const end = u ? (u.over ? this.tl(u.over) : sq?.k === u.k ? sq.end : this.tl(u.k0 || 0) + 3600000) : 0, cool = !!u && tl < end + ICON_COOL;
    if (sq && sq.park === this.park && u?.k !== sq.k) return new Set([...sq.ids, ...(cool ? u.ids : [])]);
    return cool ? new Set(u.ids) : new Set();
  }
  isUnit(ids) { const u = this.s.icon; return !!u && ids?.length === 3 && ids.every(id => u.ids.includes(id)); }
  stays(id, tl) {
    const sq = this.squadAt(tl);
    if (sq && sq.ids.includes(id)) return sq.park === this.park;
    if (this.s.icon?.formed && this.iconIds(tl).has(id)) return false;
    return this.online(id, tl);
  }
  holds(team, tl) {
    if (!team?.length) return false;
    const unit = this.isUnit(team), sqs = this.squads();
    if (!unit && this.iconLive(tl) && team.some(id => this.s.icon.ids.includes(id))) return false;
    return team.every(id => this.stays(id, tl) && (unit || !sqs.has(id)));
  }
  // online here and not doing anything here (the world's answer is kept for the tick: the rest is asked fresh)
  availableHere(tl) {
    if (!this.avail || this.avail.tl !== tl) this.avail = { tl, ids: this.withExtra(() => this.world.onlineAt(this.park, tl)) };
    const busy = this.busy(), icon = this.iconIds(tl);
    return this.avail.ids.filter(id => !busy.has(id) && !icon.has(id));
  }
  touch() { }
  // n people for a game or a line: those about first, then free park-goers, then regulars hopping on early (a quiet park)
  takeEntries(n, opts = {}) {
    const k = this.s.k, tl = this.tl(k), ex = opts.exclude || new Set();
    const ids = this.rng.shuffle(this.availableHere(tl).filter(id => !ex.has(id)));
    const free = opts.walkers === false ? [] : this.s.walkers.filter(w => this.freeW(w) && !ex.has(w.id));
    if (!opts.topUp && ids.length + free.length < n) return null;
    let icons = (opts.have || []).filter(id => isIconEntry(this.entryAt(id, tl))).length;
    const fits = id => { if (!isIconEntry(this.entryAt(id, tl))) return true; if (icons >= MAX_ICONS_PER_AI_TEAM) return false; icons++; return true; };
    const out = [], used = [], hop = [];
    for (const id of ids) { if (out.length >= n) break; if (fits(id)) out.push(id); }
    for (const w of free) { if (out.length >= n) break; if (fits(w.id)) { out.push(w.id); used.push(w); } }
    if (out.length < n) {
      const ex2 = new Set([...ex, ...this.busy(), ...out, ...this.iconIds(tl)]);
      const cands = this.withExtra(() => this.world.closestOffline(this.park, n - out.length + MAX_ICONS_PER_AI_TEAM + 1, tl, ex2));
      for (const id of cands) { if (out.length >= n) break; if (fits(id)) { hop.push(id); out.push(id); } }
    }
    if (out.length < n) return null;
    if (used.length) { this.s.walkers = this.s.walkers.filter(w => !used.includes(w)); this.touch(); }
    if (hop.length) { for (const id of hop) { this.s.extra = this.s.extra.filter(x => x[0] !== id); this.s.extra.push([id, k + HOP_TICKS]); } this.syncExtra(); }
    return out;
  }
  // ---------- park-goers: where they walk (positions are a function of the tick: the same on every screen) ----------
  freeW(w) { return w.st !== 'line' && w.st !== 'exit' && w.unit == null; }
  pathLen(w) { let d = 0, x = w.a[0], z = w.a[1]; for (const [px, pz] of w.p) { d += dist(x, z, px, pz); x = px; z = pz; } return d; }
  arrive(w) { return w.p.length ? w.s0 + this.pathLen(w) / w.v : w.s0; }
  // where he is at time tau (seconds since t0) and which way he's heading: [x, z, heading, moving]
  posAt(w, tau) {
    const L = w.lead && w.st !== 'line' ? this.W(w.lead) : null;
    if (L && L !== w) return this.posAt(L, tau);
    let x = w.a[0], z = w.a[1], left = Math.max(0, tau - w.s0) * w.v, h = null;
    for (const [px, pz] of w.p) {
      const d = dist(x, z, px, pz);
      if (d > 1e-9) h = Math.atan2(px - x, pz - z);
      if (left < d) { const f = left / d; return [x + (px - x) * f, z + (pz - z) * f, h, 1]; }
      left -= d; x = px; z = pz;
    }
    return [x, z, h, 0];
  }
  // stop him where he is right now (before his leader or his path changes)
  settle(w) { const k = this.s.k, [x, z] = this.posAt(w, k); w.a = [x, z]; w.p = []; w.s0 = k; }
  freeSpot(x, z) {
    for (const s0 of this.layout.solids || []) {
      const b = grow(s0, 0.9);
      if (!inBox(b, x, z)) continue;
      const o = [[b.x0, z], [b.x1, z], [x, b.z0], [x, b.z1]];
      o.sort((a, c) => dist(a[0], a[1], x, z) - dist(c[0], c[1], x, z));
      x = o[0][0]; z = o[0][1];
    }
    return [x, z];
  }
  blockers(w) {
    const out = [...(this.layout.solids || [])];
    if (w && w.lv > this.s.k) return out;
    this.s.courts.forEach((c, i) => { if (c.g || c.real) out.push(this.layout.courts[i].rect); });
    return out;
  }
  route(ax, az, bx, bz, solids) {
    const out = [];
    for (let guard = 0; guard < 6; guard++) {
      const hit = solids.map(s0 => grow(s0, 0.7)).find(b => segHitsBox(b, ax, az, bx, bz));
      if (!hit) break;
      const cs = [[hit.x0 - 0.2, hit.z0 - 0.2], [hit.x1 + 0.2, hit.z0 - 0.2], [hit.x0 - 0.2, hit.z1 + 0.2], [hit.x1 + 0.2, hit.z1 + 0.2]].filter(q => dist(q[0], q[1], ax, az) > 0.05 && !segHitsBox(hit, ax, az, q[0], q[1]));
      if (!cs.length) break;
      cs.sort((a, c) => (dist(a[0], a[1], ax, az) + dist(a[0], a[1], bx, bz)) - (dist(c[0], c[1], ax, az) + dist(c[0], c[1], bx, bz)));
      out.push(cs[0]); ax = cs[0][0]; az = cs[0][1];
    }
    out.push([bx, bz]);
    return out;
  }
  goTo(w, x, z, fast = false) {
    const [qx, qz] = this.freeSpot(x, z), k = this.s.k, [px, pz] = this.posAt(w, k);
    w.a = [px, pz]; w.s0 = k; w.v = fast ? VF : VW;
    w.p = this.route(px, pz, qx, qz, this.blockers(w));
  }
  pickZone() { const tot = ZONES.reduce((s, z) => s + z.w, 0); let r = this.rng.next() * tot; for (const z of ZONES) { r -= z.w; if (r <= 0) return z; } return ZONES[0]; }
  pickIn(z) { return [this.rng.range(z.x0, z.x1), this.rng.range(z.z0, z.z1)]; }
  spawn(id, x, z) {
    const k = this.s.k, w = { id, st: 'idle', a: [x, z], p: [], s0: k, v: VW, wt: k + this.rng.range(1, 6), watch: -1, unit: null, lead: null, c: -1, r: -1, slot: -1, lv: 0 };
    if (this.rng.next() < 0.4) w.watch = this.rng.int(0, this.layout.courts.length - 1);
    this.s.walkers.push(w); this.touch();
    return w;
  }
  wander(w) { const [x, z] = this.pickIn(this.pickZone()); w.st = 'walk'; this.goTo(w, x, z); }
  leave(w) { w.c = w.r = w.slot = -1; w.st = 'exit'; w.watch = -1; this.goTo(w, this.rng.range(-40, 40), -31, true); }
  // off a court (walking off after a game): stays → round to the plaza, else out of the park
  walkOff(id, x, z, tl) {
    if (this.s.walkers.length >= MAX_WALKERS || this.W(id)) return null;
    const w = this.spawn(id, x, z); w.lv = this.s.k + 8;
    if (this.stays(id, tl)) { const [px, pz] = this.pickIn(ZONES[0]); w.st = 'walk'; this.goTo(w, px, pz); } else this.leave(w);
    return w;
  }
  sideline(ci, j = 0) { const o = this.layout.courts[ci].origin; return [o[0] + 10.5, o[2] - 1.2 + j * 1.2]; }
  // where each player of team t stands on court ci's game right now (for those walking off it)
  atOf(ci, t) { const g = this.runners[ci]?.game, o = this.layout.courts[ci].origin; return i => { const p = g?.teams[t]?.[i]; return p ? [p.x + o[0], p.z + o[2]] : null; }; }
  // ---------- Got Next lines ----------
  lineFull(ci, l) { return l.ids.length >= this.layout.courts[ci].format; }
  lineSet(ci, l) { return this.lineFull(ci, l) && l.ids.every(id => { const w = this.W(id); return w && w.st === 'line' && this.arrive(w) <= this.s.k; }); }
  // the AI line that can step on now: the first to fill, if it's standing ready (else the other one, if it is). A real squad
  // ready on this court (ready) goes before any AI line that filled after it
  upNext(ci) {
    const c = this.s.courts[ci];
    const order = c.lines.map((l, i) => ({ l, i })).filter(x => x.l && x.l.full != null).sort((a, b) => a.l.full - b.l.full || a.l.n - b.l.n);
    for (const x of order) { if (c.ready != null && c.ready < x.l.full) return null; if (this.lineSet(ci, x.l)) return x; }
    return null;
  }
  takeLine(ci, i) {
    const l = this.s.courts[ci].lines[i]; if (!l) return;
    this.s.walkers = this.s.walkers.filter(w => !l.ids.includes(w.id)); this.s.courts[ci].lines[i] = null; this.touch();
  }
  placeLine(ci, r) {
    const l = this.s.courts[ci].lines[r]; if (!l) return;
    l.ids.forEach((id, slot) => { const w = this.W(id); if (!w) return; const sp = this.layout.courts[ci].rows[r][slot]; w.st = 'line'; w.c = ci; w.r = r; w.slot = slot; w.watch = -1; this.goTo(w, sp.x, sp.z, true); });
  }
  disperse(ci, r) {
    const c = this.s.courts[ci], l = c.lines[r]; if (!l) return;
    for (const id of l.ids) { const w = this.W(id); if (w) { w.st = 'idle'; w.c = w.r = w.slot = -1; w.wt = this.s.k + this.rng.range(0.5, 3); w.a = this.posAt(w, this.s.k).slice(0, 2); w.p = []; w.s0 = this.s.k; } }
    c.lines[r] = null;
  }
  // a group of park-goers takes an open spot (never one a real squad has called); icon: the ICON Squad's window
  formAILine(ci, group = null, icon = null) {
    const c = this.s.courts[ci], r = c.lines.findIndex((l, i) => !l && !c.claim[i]);
    if (r < 0) return false;
    const L = this.layout.courts[ci], tl = this.tl(this.s.k);
    let ids = group;
    if (!ids) {
      const head = L.rows[r][0]; let icons = 0;
      const free = this.s.walkers.filter(w => this.freeW(w)).map(w => [w, this.posAt(w, this.s.k)]).sort((a, b) => dist(a[1][0], a[1][1], head.x, head.z) - dist(b[1][0], b[1][1], head.x, head.z))
        .map(x => x[0]).filter(w => !isIconEntry(this.entryAt(w.id, tl)) || icons++ < MAX_ICONS_PER_AI_TEAM).slice(0, L.format);
      if (free.length < L.format) {
        const more = this.takeEntries(L.format - free.length, { walkers: false, have: free.map(w => w.id) });
        if (!more) return false;
        for (const id of more) free.push(this.spawn(id, this.rng.range(-30, 30), -30.5));
      }
      ids = free.map(w => w.id);
    }
    c.lines[r] = { ids: ids.slice(), icon: icon ?? null, full: null, n: ++this.s.seq }; // (v0.4.8.8: held once they're on it: holdLines)
    this.placeLine(ci, r);
    this.holdLine(ci, r);
    this.touch();
    return true;
  }
  // v0.4.8.8: a GOT NEXT spot is held by whoever stands on it. An AI line holds its spot (full: the tick it did, its place
  // in the order for the next game) once its first man has walked onto the spot's first circle: his path's end, by its time
  // (arrive), the same on every screen. Before that it holds nothing: a real squad calling the spot gets it (claim)
  holdLine(ci, r) {
    const l = this.s.courts[ci].lines[r], w = l && l.full == null ? this.W(l.ids[0]) : null;
    if (w && w.st === 'line' && w.c === ci && w.r === r && this.arrive(w) <= this.s.k) l.full = this.s.k;
  }
  holdLines() { this.s.courts.forEach((c, ci) => c.lines.forEach((l, r) => { if (l && l.full == null) this.holdLine(ci, r); })); }
  // ---------- the courts ----------
  endGame(ci) { const c = this.s.courts[ci]; c.g = null; this.runners[ci] = null; this.touch(); }
  newGame(ci, kings, force = false) {
    const c = this.s.courts[ci], L = this.layout.courts[ci], k = this.s.k, tl = this.tl(k);
    if (c.g) this.endGame(ci);
    if (!force && c.real) { this.offCourt(ci, this.unitOff(ci, kings || [])); c.kings = null; c.ks = 0; return; }
    let home = kings && this.holds(kings, tl) ? kings : null;
    if (kings && !home) this.offCourt(ci, this.unitOff(ci, kings));
    const ul = !home && this.s.icon ? c.lines.find(l => l && l.icon === this.s.icon.k) : null;
    if (ul && !this.lineSet(ci, ul) && !this.upNext(ci)) { c.kings = null; c.ks = 0; return; }
    let away = null;
    const nx = this.upNext(ci);
    if (nx) { away = nx.l.ids.slice(); this.takeLine(ci, nx.i); }
    if (!home && this.isUnit(away)) { home = away; away = null; c.ks = 0; }
    if (!home) { c.ks = 0; home = this.takeEntries(L.format, { exclude: new Set(away || []) }); }
    if (home && !away) away = this.takeEntries(L.format, { exclude: new Set(home) });
    if (!home || !away) {
      if (this.s.icon && (this.isUnit(home) || this.isUnit(away))) this.s.icon.idle = k + 30;
      for (const id of this.unitOff(ci, [...(home || []), ...(away || [])])) if (this.s.walkers.length < 14 && this.stays(id, tl)) { const o = L.origin, w = this.spawn(id, o[0] + 10.5, o[2] + this.rng.range(-4, 4)); w.st = 'walk'; const [x, z] = this.pickIn(ZONES[0]); this.goTo(w, x, z); }
      c.kings = null;
      return;
    }
    c.kings = home.slice();
    c.g = { seed: this.rng.int(1, 1e9), r: [home.slice(), away.slice()], tm: [this.isUnit(home) ? 1 : 0, this.isUnit(away) ? 1 : 0], k0: k, ws: c.ks || 0, fin: null, end: null, win: null };
    this.runners[ci] = new CourtRunner(this, ci, c.g);
    this.touch();
  }
  // people coming off a court who aren't the ICON Squad: walk off (or log off)
  offCourt(ci, ids, at = null) { const tl = this.tl(this.s.k); ids.forEach((id, j) => { const q = at?.(j) || this.sideline(ci, j); this.walkOff(id, q[0], q[1], tl); }); }
  rotate(ci) {
    const c = this.s.courts[ci], g = c.g, tl = this.tl(this.s.k);
    const win = g.win ?? 0, winners = g.r[win].slice(), losers = g.r[1 - win].slice();
    const atW = this.atOf(ci, win), atL = this.atOf(ci, 1 - win);
    this.endGame(ci);
    const off = [], lost = this.unitOff(ci, losers, atL);
    losers.forEach((id, i) => { if (!lost.includes(id)) return; const q = atL(i) || this.sideline(ci, i); const w = this.walkOff(id, q[0], q[1], tl); if (w && w.st !== 'exit') off.push(w.id); });
    c.ks = win === 0 ? (c.ks || 0) + 1 : 1;
    if (c.ready != null) {
      // a real squad is ready on this court: the kings wait for them (theirs to play: the squad's client lends them)
      const kept = this.holds(winners, tl);
      if (!kept) { const rest = this.unitOff(ci, winners, atW); rest.forEach(id => { const q = atW(winners.indexOf(id)) || this.sideline(ci); this.walkOff(id, q[0], q[1], tl); }); }
      c.kings = kept ? winners : null; if (!kept) c.ks = 0;
      if (off.length === this.layout.courts[ci].format && this.rng.next() < 0.45) this.formAILine(ci, off);
      this.squadTick();
      return;
    }
    if (off.length === this.layout.courts[ci].format && this.rng.next() < 0.45 && c.lines.some((l, i) => !l && !c.claim[i])) this.formAILine(ci, off);
    const sqs = this.squads();
    const leaving = this.isUnit(winners) ? (this.holds(winners, tl) ? [] : winners.slice()) : winners.filter(id => !this.stays(id, tl) || sqs.has(id) || (this.iconLive(tl) && this.s.icon.ids.includes(id)));
    if (leaving.length) {
      const go = this.unitOff(ci, leaving, i => atW(winners.indexOf(leaving[i])));
      winners.forEach((id, i) => { if (!go.includes(id) || sqs.has(id)) return; const q = atW(i) || this.sideline(ci, i); this.walkOff(id, q[0], q[1], tl); });
    }
    c.kings = null;
    this.newGame(ci, leaving.length ? null : winners);
    this.squadTick();
  }
  // the AI game on a court ends where it stands (real people took the court): everybody on it walks off
  vacate(ci) {
    const c = this.s.courts[ci]; if (!c.g) return;
    const g = c.g; const ats = [this.atOf(ci, 0), this.atOf(ci, 1)];
    this.endGame(ci);
    g.r.forEach((ro, t) => { const keep = this.unitOff(ci, ro, ats[t]); ro.forEach((id, i) => { if (keep.includes(id)) { const q = ats[t](i) || this.sideline(ci, i); this.walkOff(id, q[0], q[1], this.tl(this.s.k)); } }); });
    c.kings = null; c.ks = 0;
  }
  // ---------- the ICON Squad (game/park.js squadTick and friends, as one machine) ----------
  squadTick(initial = false) {
    const k = this.s.k, tl = this.tl(k), sq = this.squadAt(tl), u = this.s.icon;
    this.s.sq = k + SQUAD_EVERY;
    if (u && !u.over && sq?.k !== u.k) this.unitDone(u);
    if (!sq) return;
    if (sq.k !== this.s.iconK) this.s.iconK = sq.k;
    const here = sq.park === this.park;
    if (here && this.s.icon?.k !== sq.k) this.s.icon = { k: sq.k, ids: sq.ids.slice(), lead: sq.ids.includes(sq.leader) ? sq.leader : sq.ids[0], formed: false, over: 0, last: -1, idle: 0, k0: k };
    this.pullSingles(sq, here);
    if (!here) return;
    const v = this.s.icon;
    if (!v.formed) this.formUnit(v, initial);
    else if (k >= v.idle) this.placeUnit();
    this.s.courts.forEach((c, ci) => { if (!c.g && !c.real && c.ready == null && c.lines.some(l => l && l.icon === v.k && this.lineSet(ci, l))) this.newGame(ci, null); });
  }
  pullSingles(sq, here) {
    for (const w of this.s.walkers.slice()) {
      if (!sq.ids.includes(w.id) || w.unit === sq.k || w.st === 'exit') continue;
      if (w.st === 'line') { const c = this.s.courts[w.c]; if (c?.lines[w.r]) this.disperse(w.c, w.r); }
      if (here) { this.s.walkers = this.s.walkers.filter(x => x !== w); this.touch(); } else this.leave(w);
    }
    // (one of them on a real squad's spot: he steps off it to run with them)
    if (here) { const n = this.s.lent.length; this.s.lent = this.s.lent.filter(l => !(sq.ids.includes(l[0]) && l[3] != null)); if (this.s.lent.length !== n) this.touch(); }
  }
  formUnit(u, initial = false) {
    const busy = this.busy();
    if (u.ids.some(id => busy.has(id))) return;
    const es = [u.lead, ...u.ids.filter(id => id !== u.lead)];
    u.formed = true;
    if (initial) {
      const free = this.s.courts.map((c, ci) => ci).filter(ci => this.layout.courts[ci].format === 3 && !this.s.courts[ci].g && !this.s.courts[ci].real && this.s.courts[ci].ready == null);
      const ci = this.rng.shuffle(free)[0];
      if (ci != null) { this.newGame(ci, es); if (this.s.courts[ci].g) return; }
    }
    const q = initial ? this.pickIn(this.pickZone()) : [this.rng.range(-24, 24), -30.5];
    const ws = es.map((id, i) => this.spawn(id, q[0] + (i - 1) * 1.2, q[1]));
    this.unitGroup(ws);
    const placed = this.placeUnit();
    if (initial) { for (const w of ws) if (w.st === 'line') { const sp = this.layout.courts[w.c].rows[w.r][w.slot]; w.a = [sp.x, sp.z]; w.p = []; w.s0 = this.s.k; } return; }
    if (!placed) { ws[0].st = 'walk'; this.goTo(ws[0], this.rng.range(-20, 20), -24); }
    this.out.push({ e: 'icon', ids: es, k: u.k });
  }
  unitGroup(ws) {
    const u = this.s.icon, lead = ws.find(w => w.id === u.lead) || ws[0];
    let n = 0;
    for (const w of ws) { w.unit = u.k; w.watch = -1; w.lead = w === lead ? null : lead.id; w.slot = w === lead ? -1 : n++; }
    return [lead, ...ws.filter(w => w !== lead)];
  }
  placeUnit() {
    const u = this.s.icon;
    if (!u?.formed || u.over) return false;
    const ws = this.s.walkers.filter(w => w.unit === u.k && w.st !== 'exit' && w.st !== 'line');
    if (ws.length !== 3) return false;
    const open = this.s.courts.map((c, ci) => ci).filter(ci => { const c = this.s.courts[ci]; return this.layout.courts[ci].format === 3 && !c.real && c.lines.some((l, i) => !l && !c.claim[i]); });
    if (!open.length) return false;
    const free = open.filter(ci => !this.s.courts[ci].g && this.s.courts[ci].ready == null);
    const ci = open.includes(u.last) ? u.last : free.length ? this.rng.pick(free) : this.rng.pick(open);
    const grp = this.unitGroup(ws);
    for (const w of grp) { this.settle(w); w.lead = null; }
    return this.formAILine(ci, grp.map(w => w.id), u.k);
  }
  // people coming off court ci: the ICON Squad among them goes as one (back in line while their hour runs, out together
  // after it); → everyone else
  unitOff(ci, ids, at = null) {
    const u = this.s.icon; ids = ids || [];
    if (!u || !ids.length) return ids;
    const mine = ids.filter(id => u.ids.includes(id)), tl = this.tl(this.s.k), live = this.iconLive(tl);
    if (!mine.length) return ids;
    if (mine.length === 3 && u.formed) {
      const ws = mine.map((id, j) => { const q = at?.(ids.indexOf(id)) || this.sideline(ci, j); const old = this.W(id); if (old) return old; const w = this.spawn(id, q[0], q[1]); w.lv = this.s.k + 8; return w; });
      this.unitGroup(ws);
      u.last = ci;
      if (live) this.s.sq = this.s.k + 1; else this.unitLeave(ws);
    } else if (!live) return ids;
    return ids.filter(id => !mine.includes(id));
  }
  unitLeave(ws) {
    const lead = ws.find(w => !w.lead) || ws[0];
    for (const w of ws) { w.c = w.r = w.slot = -1; w.watch = -1; w.st = 'exit'; w.lead = w === lead ? null : lead.id; }
    this.leave(lead);
  }
  unitDone(u) {
    u.over = this.s.k;
    if (!u.formed) return;
    this.s.courts.forEach(c => c.lines.forEach((l, r) => { if (l && l.icon === u.k) c.lines[r] = null; }));
    const ws = this.s.walkers.filter(w => w.unit === u.k && w.st !== 'exit');
    if (ws.length) this.unitLeave(ws);
  }
  // ---------- the population (game/park.js populationTick) ----------
  populationTick() {
    const k = this.s.k, tl = this.tl(k);
    const n = this.s.extra.length; this.s.extra = this.s.extra.filter(x => x[1] > k); if (this.s.extra.length !== n) this.syncExtra();
    for (const w of this.s.walkers) if (this.freeW(w) && !this.stays(w.id, tl)) this.leave(w);
    this.s.courts.forEach((c, ci) => { if (!c.g && !c.real && c.ready == null) this.newGame(ci, c.kings); });
    const busy = this.rng.shuffle(this.s.courts.map((c, ci) => ci).filter(ci => this.s.courts[ci].g && this.s.courts[ci].lines.some((l, i) => !l && !this.s.courts[ci].claim[i])));
    for (const ci of busy) { if (this.rng.next() < 0.45 && this.formAILine(ci)) break; }
    let room = 10 - this.s.walkers.filter(w => w.st !== 'exit').length;
    for (const id of this.availableHere(tl)) {
      if (room-- <= 0) break;
      const w = this.spawn(id, this.rng.range(-40, 40), -30.5); this.wander(w);
    }
  }
  // the park as it is when its epoch begins
  begin() {
    const tl = this.tl(0);
    this.squadTick(true);
    this.s.courts.forEach((c, ci) => { if (!c.g) this.newGame(ci, null); });
    for (const id of this.availableHere(tl).slice(0, 9)) { const [x, z] = this.pickIn(this.pickZone()); this.spawn(id, x, z); }
  }
  // ---------- the real players (events the server put in order) ----------
  lend(aid, ci, r, ids) {
    const c = this.s.courts[ci]; if (!c) return;
    const inGame = new Set(), sqs = this.squads(); this.s.courts.forEach((cc, j) => { if (cc.g && j !== ci) cc.g.r.forEach(ro => ro.forEach(id => inGame.add(id))); });
    for (const id of ids) {
      if (!validAI(id) || inGame.has(id) || sqs.has(id)) continue; // (playing on another court, or someone's own squad mate: not his to lend; the same answer everywhere)
      const prev = this.s.lent.find(l => l[0] === id);
      if (prev && prev[1] !== aid && prev[2] !== ci) continue; // (someone else's, on another court; on this one the court changed hands: run it back)
      for (const f of this.s.walkers) if (f.lead === id && f.st !== 'line') { this.settle(f); f.lead = null; f.st = f.st === 'exit' ? 'exit' : 'idle'; f.wt = this.s.k + 1; }
      this.s.walkers = this.s.walkers.filter(w => w.id !== id);
      this.s.courts.forEach((cc, j) => { cc.lines.forEach((l, i) => { if (l && l.ids.includes(id)) this.disperse(j, i); }); if (cc.kings?.includes(id) && !cc.g) { cc.kings = null; cc.ks = 0; } });
      if (c.g && c.g.r.some(ro => ro.includes(id))) this.vacate(ci);
      this.s.lent = this.s.lent.filter(l => l[0] !== id);
      this.s.lent.push([id, aid, ci, r ?? null]);
    }
    if (r == null) c.ready = c.rb = null; // (their game is on)
    this.touch();
  }
  free(aid, ci, ids, kings = 0, ks = 0) {
    const c = this.s.courts[ci]; if (!c) return;
    const k = this.s.k, tl = this.tl(k), mine = ids.filter(id => this.s.lent.some(l => l[0] === id && l[1] === aid));
    this.s.lent = this.s.lent.filter(l => !mine.includes(l[0]));
    this.touch();
    if (kings && mine.length === this.layout.courts[ci].format) {
      // the AI beat them: they hold the court (a fresh game somebody else started on it a moment ago gives way)
      if (c.g && k - c.g.k0 <= KINGS_TAKE) this.vacate(ci);
      if (!c.g) { c.ks = Math.max(1, ks | 0); if (!c.real && c.ready == null) this.newGame(ci, mine); else c.kings = mine.slice(); return; }
      // (an older game on it: they line up for it, as a group, if there's a spot)
      if (c.lines.some((l, i) => !l && !c.claim[i]) && mine.every(id => !this.W(id))) { mine.forEach((id, j) => { const q = this.sideline(ci, j); this.spawn(id, q[0], q[1]); }); if (this.formAILine(ci, mine)) return; }
    }
    const o = this.layout.courts[ci].origin;
    this.unitOff(ci, mine, j => [o[0] + 10.5, o[2] + 3 + j]).forEach((id, j) => { if (!this.W(id)) this.walkOff(id, o[0] + 10.5, o[2] + 3 + j, tl); });
  }
  apply(ev) {
    const e = ev?.e, aid = ev?.from == null ? null : String(ev.from), ci = ev?.c;
    const okC = Number.isInteger(ci) && ci >= 0 && ci < this.s.courts.length;
    if (e === 'squad' && aid) {
      const ids = (Array.isArray(ev.ids) ? ev.ids : []).filter(validAI).slice(0, 4);
      this.s.players = this.s.players.filter(p => p[0] !== aid); this.s.players.push([aid, ids]); this.s.players.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (const id of ids) { const w = this.W(id); if (w && this.freeW(w)) this.s.walkers = this.s.walkers.filter(x => x !== w); this.s.courts.forEach((cc, j) => cc.lines.forEach((l, i) => { if (l && l.ids.includes(id)) this.disperse(j, i); })); }
      this.touch();
    } else if (e === 'gone' && aid) {
      this.s.players = this.s.players.filter(p => p[0] !== aid);
      const lent = this.s.lent.filter(l => l[1] === aid), tl = this.tl(this.s.k);
      this.s.lent = this.s.lent.filter(l => l[1] !== aid);
      lent.forEach((l, j) => { const q = this.sideline(l[2], j); this.walkOff(l[0], q[0], q[1], tl); });
      this.s.courts.forEach((c, j) => { if (!c.claim.includes(aid) && c.rb !== aid) return; c.claim = c.claim.map(a => (a === aid ? null : a)); if (c.rb === aid) { c.ready = c.rb = null; if (!c.g && !c.real) this.newGame(j, c.kings); } });
      this.touch();
    } else if (e === 'court' && okC) {
      const c = this.s.courts[ci], on = ev.real ? 1 : 0;
      if (c.real === on) return;
      c.real = on;
      if (on) { this.vacate(ci); if (c.kings && !c.g && !c.ready) { this.offCourt(ci, this.unitOff(ci, c.kings)); c.kings = null; c.ks = 0; } }
      else if (!c.g && c.ready == null) this.newGame(ci, c.kings);
      this.touch();
    } else if (e === 'claim' && okC && (ev.r === 0 || ev.r === 1)) {
      const c = this.s.courts[ci], who = ev.aid == null ? null : String(ev.aid), was = c.claim[ev.r];
      c.claim[ev.r] = who;
      // (v0.4.8.8: a group only on its way there: to the other spot if it's free; one standing on it breaks up)
      const l = who ? c.lines[ev.r] : null, o = 1 - ev.r;
      if (l && l.full == null && !c.lines[o] && !c.claim[o]) { c.lines[ev.r] = null; c.lines[o] = l; this.placeLine(ci, o); }
      else if (l) this.disperse(ci, ev.r);
      if (was && was !== who) {
        // the squad that had it stepped off: the park-goers they had on it go back to hanging out; nobody's ready here now
        const tl = this.tl(this.s.k), off = this.s.lent.filter(l => l[1] === was && l[2] === ci && l[3] === ev.r);
        this.s.lent = this.s.lent.filter(l => !off.includes(l));
        const row = this.layout.courts[ci].rows[ev.r];
        off.forEach((l, j) => { const sp = row[Math.min(row.length - 1, j + 1)]; const w = this.walkOff(l[0], sp.x, sp.z, tl); if (w && w.st !== 'exit') w.lv = 0; });
        if (c.rb === was && !c.claim.includes(was)) { c.ready = c.rb = null; if (!c.g && !c.real) this.newGame(ci, c.kings); }
      }
      this.touch();
    } else if (e === 'ready' && okC && aid && this.s.courts[ci].claim.includes(aid)) {
      const c = this.s.courts[ci]; if (c.ready == null) { c.ready = this.s.k; c.rb = aid; }
    } else if (e === 'lend' && okC && aid && Array.isArray(ev.ids)) {
      this.lend(aid, ci, ev.r === 0 || ev.r === 1 ? ev.r : null, ev.ids.slice(0, 10));
    } else if (e === 'free' && okC && aid && Array.isArray(ev.ids)) {
      this.free(aid, ci, ev.ids.slice(0, 10), ev.kings ? 1 : 0, Number.isFinite(ev.ks) ? Math.min(99, ev.ks) : 0);
    }
  }
  // ---------- the tick ----------
  // how far the courts' games are from unit count U (the next tick's boundary unless told): 0 when they're all there
  behind(U = (this.s.k + 1) * TICK_UNITS) { let n = 0; for (const r of this.runners) if (r && r.u < U) n += U - r.u; return n; } // (units still to step)
  // a slice of catching up (a newcomer's courts replaying from their start): at most max steps across the courts
  catchUp(max = 200, U = (this.s.k + 1) * TICK_UNITS) {
    let left = max;
    for (const r of this.runners) { if (!r || left <= 0) continue; left -= r.stepTo(U, left); }
    return max - left;
  }
  // tick k+1 with the events the server put on it (in its order)
  step(events = []) {
    const k = this.s.k + 1, U = k * TICK_UNITS;
    for (const r of this.runners) if (r) r.stepTo(U);
    this.s.k = k; this.out.length = 0; this.syncExtra(); // (this PC's clock may have been set again: the hop-ons' ends with it)
    for (const ev of events) this.apply(ev);
    this.holdLines(); // (v0.4.8.8: AI lines that reached their spot hold it from this tick)
    this.s.courts.forEach((c, ci) => {
      const g = c.g, run = this.runners[ci];
      if (!g || !run) return;
      if (c.ready != null && g.end == null && !run.game.over && k - c.ready >= WRAP_AFTER) { const w = run.game.score[0] >= run.game.score[1] ? 0 : 1; g.fin = [run.u, w]; run.fin = { u: run.u, w, done: true }; run.game.finish(w); }
      if (g.end == null && run.game.over) { g.end = k; g.win = run.game.winner ?? 0; }
    });
    this.s.courts.forEach((c, ci) => { if (c.g && c.g.end != null && k >= c.g.end + ROTATE_AFTER) this.rotate(ci); });
    for (const w of this.s.walkers.slice()) this.think(w);
    if (k >= this.s.sq) this.squadTick();
    if (k % POP_EVERY === 0) this.populationTick();
    this.s.rng = this.rng.s >>> 0;
    return this.out;
  }
  think(w) {
    const k = this.s.k;
    if (w.lead && w.st !== 'line') { const L = this.W(w.lead); if (!L) { if (w.st === 'exit') { this.drop(w); return; } w.lead = null; w.st = 'idle'; w.a = this.posAt(w, k).slice(0, 2); w.p = []; w.s0 = k; w.wt = k + 1; } return; }
    if (w.st === 'exit') { if (this.arrive(w) <= k) this.drop(w); return; }
    if (w.st === 'walk' && this.arrive(w) <= k) { const ta = this.arrive(w); w.a = w.p.length ? w.p.at(-1).slice() : w.a; w.p = []; w.s0 = ta; w.st = 'idle'; w.wt = ta + this.rng.range(3, 10); return; }
    if (w.st === 'idle' && w.unit == null && k >= w.wt) this.wander(w);
  }
  drop(w) { this.s.walkers = this.s.walkers.filter(x => x !== w && x.lead !== w.id); this.touch(); }
  // ---------- agreement ----------
  // the state plus a digest of every court's game (its units, score and where everybody is), canonical
  digest() { return this.layout.courts.map((_, i) => this.runners[i]).map(r => (r ? [r.u, r.game.score[0], r.game.score[1], r.game.over ? 1 : 0, Math.round(r.game.players.reduce((s, p) => s + p.x * 3 + p.z, 0) * 1000)] : null)); }
  hash() { return hashState({ s: this.s, g: this.digest() }); }
  snapshot() { return JSON.parse(JSON.stringify(this.s)); }
}
