// v0.4.8.7 the park director on this screen (game/parkdirector.js): the online server's park session for the park you're
// at (server/online.py, RIMRIFT_PARK_DIRECTOR) and the clock that plays it.
// The server keeps each park's epoch (its start t0 on the server's clock and its seed), the events of the real players in
// one order (pev: their claims and courts from the hosted game, their pacts: the AI they lend for a game or a Got Next
// spot and hand back, their AI squads), a tick watermark once a second (pt: every event for ticks up to k has been sent)
// and the latest snapshot the clients agree on (pcheck: every 10 ticks each client's hash, every 60 its state). Arriving,
// a client gets the snapshot and the events since (pstate) and plays on from there; a client whose hash differs from the
// others' gets the agreed state again (presync); after a restart of the server, the clients still running the park hand
// it back (presume) and it carries on where it was.
// This screen plays tick k once the watermark has passed it and the server's clock is PD_DELAY s past it (the slack for
// the network), and between ticks steps the courts' games toward the present (never past the next tick's boundary): what
// you see is the director as of PD_DELAY s ago, the same on every screen.
import { ParkDirector, TICK_MS, TICK_UNITS, hashState } from './parkdirector.js';
import { worldNow } from '../sim/world.js';

export const PD_DELAY = 1.5; // (s)
export const PD_CHECK = 10, PD_SNAP = 60; // (ticks: a hash every 10, the state every 60)
const CATCHUP_MS = 20, JOIN_MS = 300, FRAME_STEPS = 160, RENDER_STEPS = 40;
const clock = () => (globalThis.performance ? performance.now() : Date.now()); // (only how much catching up fits in a frame: never what happens)

export class ParkLink {
  // net: the socket (core/netplay.js); place: this park; makeOpts({epoch, t0, seed}) → the director's options (world,
  // layout, catalog, toLocal...); hooks: {out(events, link), reset(link)}
  constructor(net, place, makeOpts, hooks = {}) {
    this.net = net; this.place = place; this.makeOpts = makeOpts; this.hooks = hooks;
    this.dir = null; this.pend = new Map(); this.w = -1; this.n = 0; this.epoch = null; this.t0 = 0; this.seed = 0;
    this.stats = { ticks: 0, resync: 0, late: 0, gaps: 0, steps: 0, catchup: 0 };
  }
  get on() { return !!this.dir; }
  serverNow() { return worldNow(Date.now()); }
  // the director's present: seconds since t0, PD_DELAY behind the server's clock
  tau() { return this.dir ? (this.serverNow() - this.t0) / TICK_MS - PD_DELAY : 0; }
  // ---- from the server ----
  // pstate / presync / pepoch: {place, epoch, t0, seed, k, w, n, snap: {k, s} | null, log: [{k, n, ev}]}
  state(m) {
    if (!m || m.place !== this.place || !Number.isFinite(m.t0)) return false;
    this.heard = this.serverNow(); this.stats.states = (this.stats.states || 0) + 1; this.stats.lastState = m.t;
    // (the same park again, not a correction (a pstate asked for, or one that crossed with it): what's new in it, on top)
    // (a new series of events, after the server restarted: every one of them is new to us)
    const fresh = m.sid !== this.sid; if (fresh) { this.sid = m.sid; this.n = 0; }
    const missed = (m.log || []).some(x => x && x.n > this.n && x.k <= this.dir?.k); // (one we never had, for a tick played: start again)
    if (this.dir && m.t === 'pstate' && m.epoch === this.epoch && (!m.snap || m.snap.k <= this.dir.k) && !missed) {
      for (const x of m.log || []) if (x && Number.isInteger(x.n) && x.n > this.n && x.k > this.dir.k) this.take(x);
      if (Number.isInteger(m.n)) this.n = Math.max(this.n, m.n);
      if (Number.isFinite(m.w)) this.w = Math.max(this.w, m.w);
      return true;
    }
    const same = this.dir && this.epoch === m.epoch && m.snap && m.snap.k === this.dir.k && hashState(m.snap.s) === hashState(this.dir.s);
    this.epoch = m.epoch; this.t0 = m.t0; this.seed = m.seed >>> 0;
    if (!same) {
      const opts = this.makeOpts({ epoch: m.epoch, t0: m.t0, seed: this.seed });
      this.dir = m.snap && m.snap.s ? new ParkDirector(opts, m.snap.s) : new ParkDirector(opts);
      this.hooks.reset?.(this);
      this.stats.joinAt = this.serverNow(); this.stats.readyMs = null; // (how long until it's playing the present: readyMs)
      // (a newcomer: a good first slice of its courts' replay at once, while it's arriving anyway; the rest a frame at a time)
      const t0 = clock(), U0 = this.dir.k * TICK_UNITS;
      while (this.dir.behind(U0) > 0 && clock() - t0 < JOIN_MS) this.stats.catchup += this.dir.catchUp(60, U0);
    }
    this.pend = new Map(); this.w = Number.isFinite(m.w) ? m.w : -1;
    for (const x of m.log || []) if (x && x.k > this.dir.k) this.take(x);
    this.n = Number.isInteger(m.n) ? m.n : 0; // (the last event the server had sent: the next one is n + 1)
    return true;
  }
  take(x) {
    if (!x || !Number.isInteger(x.k)) return;
    if (x.k <= this.dir.k) { this.stats.late++; this.want(); return; } // (an event for a tick already played here: out of step)
    const l = this.pend.get(x.k) || []; l.push(x.ev); this.pend.set(x.k, l);
  }
  // pev: one event, {place, epoch, k, n, ev}
  event(m) {
    if (!this.dir || m?.place !== this.place || m.epoch !== this.epoch) return;
    if (m.sid !== this.sid) { this.want(); return; } // (a series we haven't had the start of)
    this.heard = this.serverNow();
    if (Number.isInteger(m.n)) { if (m.n <= this.n) return; if (m.n !== this.n + 1) { this.stats.gaps++; this.want(); } this.n = m.n; }
    this.take(m);
  }
  // pt: every event up to tick k is out
  tick(m) { if (this.dir && m?.place === this.place && m.epoch === this.epoch && Number.isFinite(m.k)) { this.w = Math.max(this.w, m.k); this.heard = this.serverNow(); } }
  want() { if (this.wantAt && this.serverNow() - this.wantAt < 3000) return; this.wantAt = this.serverNow(); this.stats.resync++; this.net?.send({ t: 'pwant', place: this.place }); }
  // ---- to the server ----
  pact(a, fields = {}) { return this.dir ? !!this.net?.send({ t: 'pact', place: this.place, epoch: this.epoch, a, ...fields }) : false; }
  resume() { if (this.dir) this.net?.send({ t: 'presume', place: this.place, epoch: this.epoch, t0: this.t0, seed: this.seed, k: this.dir.k, h: this.dir.hash(), s: this.dir.snapshot() }); }
  check() {
    const d = this.dir, k = d.k;
    if (k % PD_CHECK) return;
    this.lastHash = { k, h: d.hash() };
    this.net?.send({ t: 'pcheck', place: this.place, epoch: this.epoch, k, h: this.lastHash.h, ...(k % PD_SNAP === 0 ? { s: d.snapshot() } : {}) });
  }
  // ---- every frame ----
  // plays the ticks that are due, its courts' games stepped up to each one within a budget of steps a frame (a long way
  // behind, after a hidden tab, it catches up over the next frames without a hitch), then steps the games toward the
  // present. Returns the director's events (toasts) of the ticks played
  frame(dt = 1 / 60) {
    const d = this.dir; if (!d) return [];
    const now = this.serverNow(); dt = this.lastF ? Math.max(dt, (now - this.lastF) / 1000) : dt; this.lastF = now; // (the time since the last frame, unclamped)
    const out = [];
    // (a newcomer's courts replaying from their start up to the director's tick: a slice a frame first)
    const U0 = d.k * TICK_UNITS;
    if (d.behind(U0) > 0) {
      const t0 = clock();
      do this.stats.catchup += d.catchUp(40, U0); while (d.behind(U0) > 0 && clock() - t0 < CATCHUP_MS);
      if (d.behind(U0) > 0) return out;
    }
    const tau = this.tau(), due = Math.min(this.w, Math.floor(tau));
    let budget = FRAME_STEPS + Math.ceil(900 * Math.min(1, dt)); // (a slow PC's long frames get more: the park never falls behind)
    while (d.k < due) {
      const U1 = (d.k + 1) * TICK_UNITS;
      const n = d.catchUp(budget, U1); budget -= n; this.stats.steps += n;
      if (d.behind(U1) > 0) break; // (the rest next frame)
      const k = d.k + 1, evs = this.pend.get(k) || [];
      this.pend.delete(k);
      for (const e of d.step(evs)) out.push(e);
      this.stats.ticks++;
      this.check();
    }
    if (this.stats.readyMs == null && d.k >= due - 1) this.stats.readyMs = this.serverNow() - this.stats.joinAt;
    const U = Math.min(Math.floor(tau * TICK_UNITS), (d.k + 1) * TICK_UNITS);
    for (const r of d.runners) if (r) this.stats.steps += r.stepTo(U, RENDER_STEPS + Math.ceil(300 * Math.min(1, dt)));
    if (out.length) this.hooks.out?.(out, this);
    return out;
  }
  // how far into its next step a court's game is at the present (0..1, for the view's interpolation)
  alpha(r) { const U = Math.min(this.tau() * TICK_UNITS, (this.dir.k + 1) * TICK_UNITS); return r.u > r.uPrev ? Math.max(0, Math.min(1, (U - r.uPrev) / (r.u - r.uPrev))) : 1; }
  stop() { this.dir = null; this.pend = new Map(); }
}
