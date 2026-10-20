// v0.4.8.7: one park for everyone in it. Online, the real players at a park see the same AI world (sim/world.js
// adoptSharedWorld); the park's host (the lowest account id there) runs who is where and the courts' games, and sends it
// out (pop); everyone else plays his park: the same games from the same seeds kept on his tick, the same lines, the same
// park-goers heading the same way, the same ICON Squad state and hop-ons. The AI squad mates a real player brought walk
// with him and are nobody else's. When the host goes, the next one runs the park from where it stands.
// A fake world (the same one on both screens), a fake hosted game, the park's own code (no renderer: stubs for the games
// and the walkers, as in v0486squadpark.test.mjs).
// Run: node --test tests/
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ParkHub } from '../client/js/game/park.js';
import { RNG } from '../client/js/core/rng.js';
import { DT } from '../client/js/sim/constants.js';

const MIN = 60000, HOUR = 60 * MIN, T0 = Date.UTC(2026, 9, 20, 18, 0);
const realNow = Date.now, realPerf = performance.now.bind(performance);
const clock = { t: T0, p: 1000 };
const at = t => { clock.p += t - clock.t; clock.t = t; Date.now = () => clock.t; performance.now = () => clock.p; };
afterEach(() => { Date.now = realNow; performance.now = realPerf; });

// the same AI world on every screen (what sim/world.js gives two clients on the same online server)
class SharedWorld {
  constructor(seed = 5) {
    const r = new RNG(seed);
    this.seed = seed; this.ids = Array.from({ length: 120 }, (_, i) => 'ai-' + i);
    this.home = new Map(this.ids.map(id => [id, r.next() < 0.7 ? 'harbor' : 'brick']));
    this.squad = []; this.extra = new Map();
  }
  iconSquad() { return null; } squadOf() { return null; }
  status(id, t = Date.now()) { const x = this.extra.get(id); if (x && x.until > t) return x; return { park: this.home.get(id), until: t + HOUR }; }
  online(id, t) { return !!this.status(id, t); }
  onlineAt(park, t) { return this.ids.filter(id => this.status(id, t)?.park === park); }
  entry(id) { return { aiId: id, name: 'Hooper ' + id.slice(3), build: { overall: 70 + (+id.slice(3) % 25), equipment: {} }, badges: {} }; }
  gameEntry(id) { const e = this.entry(id); return { ...e, build: { ...e.build } }; }
  account(id) { return { level: 0.5 + (+id.slice(3) % 10) / 25 }; }
  inSquad(id) { return this.squad.includes(id); }
  activeSquad() { return this.squad; }
  aiParty() { return []; } closestOffline() { return []; } playedGame() {} playingElsewhere() { return false; }
}
function fakeWalker(x, z, entry) {
  return {
    entry, p: { x, z, facing: 0, intent: { mx: 0, mz: 0, sprint: false }, setPos(a, b, f) { this.x = a; this.z = b; this.facing = f; } }, spot: null, follow: null, exit: false, gone: false, state: 'idle', path: [], t: 1, visual: { pending: false },
    goTo(a, b) { this.p.x = a; this.p.z = b; this.state = 'walk'; },
    leave() { this.spot = null; this.follow = null; this.exit = true; this.state = 'walk'; },
    dispose() { this.disposed = true; },
  };
}
// a background game that only counts its ticks (the real one is the same game from the same seed: game/session.js)
const bgSession = (c, rosters, teams, seed) => {
  const s = { opts: { rosters, teams, seed }, rate: 1, acc: 0, visuals: [], game: { over: false, winner: null, tick: 0, score: [0, 0], players: [], events: [], teams: rosters.map(r => r.map((e, i) => ({ x: i - 1, z: 2 }))), step() { this.tick++; } }, dispose() { this.gone = true; } };
  s.frame = dt => { s.acc += dt * s.rate; while (s.acc >= DT) { s.game.step(DT); s.acc -= DT; } };
  return s;
};
// a real player's park: me (account id), the people here (id → their AI squad mates), the messages he sends
function park(world, me, people) {
  const P = Object.create(ParkHub.prototype), sent = [];
  const cs = Array.from({ length: 3 }, (_, i) => ({ id: 'c' + i, name: `Court ${i + 1}`, origin: [(i - 1) * 26, 0, 0], format: 3, full: true, lines: [null, null], session: null, mine: false, kings: null, kingsStreak: 0,
    rows: [0, 1].map(r => Array.from({ length: 4 }, (_, s) => ({ x: (i - 1) * 26 + 8 + s, z: -14 - 2 * r }))) }));
  const net = { connected: true, place: 'harbor', myId: me, people: new Map(Object.entries(people).map(([id, ai]) => [id, { id, ai: ai.map(a => ({ id: a })) }])),
    aiOf(id) { return this.people.get(id)?.ai || []; }, send(m) { sent.push(m); return true; }, court() { return null; } };
  Object.assign(P, {
    app: { settings: {}, mode: 'park', hud: { show() {} }, profile: {}, char: () => ({}), net, ai: world }, themeId: 'harbor', world, rng: new RNG(me.charCodeAt(me.length - 1) * 101 + 7), walkers: [], myMates: [], myOpp: [], mode: 'roam',
    courts: cs, ui: { toast() {}, backToRoam() {} }, aff: { park: 'Harbor Point' }, venue: { courts: cs, solids: [] }, catalog: {}, char: { progression: {} },
    me: { x: 0, z: -18, facing: 0, setPos() {} }, rig: { snap() {} }, icon: null, iconT: 2, peers: { followers: () => [], list: () => [] }, sent, net,
  });
  P.spawnWalker = (x, z, entry) => fakeWalker(x, z, entry);
  P.entryFor = id => world.gameEntry(id);
  P.bgSession = (c, r, t, seed = P.rng.int(1, 1e9)) => bgSession(c, r, t, seed);
  P.courtRate = () => 1;
  for (const c of cs) P.newBackgroundGame(c, null);
  for (const id of P.availableHere().slice(0, 9)) P.walkers.push(P.spawnWalker(0, 0, P.entryFor(id)));
  return P;
}
const courtsOf = P => P.courts.map(c => (c.session ? [c.session.opts.seed, c.session.opts.rosters.map(r => r.map(e => e.aiId).join()).join('|'), c.kingsStreak] : null));
const walkersOf = P => P.walkers.filter(w => w.follow == null && !w.disposed).map(w => w.entry.aiId).sort();
const linesOf = P => P.courts.map(c => c.lines.map(l => (l && !l.mine ? l.members.map(w => w.entry.aiId).join() : null)));
// the host's message, as the hosted game hands it on (from: his id)
const relay = (H, F) => { const m = H.sent.at(-1); assert.ok(m && m.t === 'pop', 'the host sends his park'); F.onPop(JSON.parse(JSON.stringify({ ...m, from: H.net.myId }))); };

test('the host (lowest id) sends his park; the other plays it: the same games, lines and park-goers', () => {
  at(T0);
  const A = park(new SharedWorld(), 'acc-1', { 'acc-2': [] }), B = park(new SharedWorld(), 'acc-2', { 'acc-1': [] });
  assert.equal(A.popHostId(), 'acc-1'); assert.equal(B.popHostId(), 'acc-1');
  // before: each made his own park (their own Math.random-ish picks)
  assert.notDeepEqual(courtsOf(A).map(c => c && c[0]), courtsOf(B).map(c => c && c[0]));
  A.popTick(1); B.popTick(1);
  assert.equal(B.sent.length, 0, 'only the host sends');
  relay(A, B);
  assert.ok(B.mirroring());
  assert.deepEqual(courtsOf(B), courtsOf(A), 'the same games on the same courts, from the same seeds');
  assert.deepEqual(walkersOf(B), walkersOf(A), 'the same park-goers');
  assert.deepEqual(linesOf(B), linesOf(A), 'the same lines');
  for (const w of B.walkers) { const h = A.walkers.find(x => x.entry.aiId === w.entry.aiId); assert.ok(w.mirror && Math.abs(w.mirror.x - h.p.x) < 0.01 && Math.abs(w.mirror.z - h.p.z) < 0.01, 'heading where he is on the host\'s screen'); }
  // a while of play: rotations, people coming and going on the host; the other stays with him
  for (let step = 0; step < 240; step++) {
    at(T0 + step * 500);
    for (const P of [A, B]) { const mirror = P.mirroring(); for (const c of P.courts) if (c.session) { if (mirror) P.mirrorCourt(c, 0.5); else c.session.frame(0.5); } }
    if (step % 40 === 39) { const c = A.courts[step % 3]; if (c.session) { c.session.game.over = true; c.session.game.winner = step % 2; A.rotateCourt(c); } }
    if (step % 20 === 0) A.populationTick();
    A.popTick(0.5); relay(A, B);
    assert.deepEqual(courtsOf(B), courtsOf(A), `step ${step}: the same games`);
    assert.deepEqual(walkersOf(B), walkersOf(A), `step ${step}: the same park-goers`);
    assert.deepEqual(linesOf(B), linesOf(A), `step ${step}: the same lines`);
    for (let i = 0; i < 3; i++) { const a = A.courts[i].session, b = B.courts[i].session; if (a && b) assert.ok(Math.abs(a.game.tick - b.game.tick) <= 40, `step ${step} court ${i}: the same moment of the game (${a.game.tick} / ${b.game.tick})`); }
  }
});

test('a game picked up late is caught up to the host\'s tick at once', () => {
  at(T0);
  const A = park(new SharedWorld(), 'acc-1', { 'acc-2': [] }), B = park(new SharedWorld(), 'acc-2', { 'acc-1': [] });
  for (const c of A.courts) c.session.game.tick = 3000;
  A.popTick(1); relay(A, B);
  for (let f = 0; f < 3; f++) for (const c of B.courts) B.mirrorCourt(c, 1 / 60); // (a few frames at most)
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(B.courts[i].session.game.tick - 3000) < 10, `court ${i} caught up: ${B.courts[i].session.game.tick}`);
});

test('the AI squad mates a real player brought are his: nobody else\'s park-goers or players', () => {
  at(T0);
  const w = new SharedWorld(), mates = w.onlineAt('harbor', T0).slice(0, 4);
  const A = park(w, 'acc-1', { 'acc-2': mates });
  const used = new Set([...walkersOf(A), ...A.courts.flatMap(c => (c.session ? c.session.opts.rosters.flat().map(e => e.aiId) : []))]);
  for (const id of mates) assert.ok(!used.has(id), `${id} walks with his player only`);
  assert.ok(!A.availableHere().some(id => mates.includes(id)));
});

test('when the host goes, the next one runs the park from where it stands', () => {
  at(T0);
  const A = park(new SharedWorld(), 'acc-1', { 'acc-2': [] }), B = park(new SharedWorld(), 'acc-2', { 'acc-1': [] });
  A.popTick(1); relay(A, B);
  const before = courtsOf(B), people = walkersOf(B);
  B.net.people.delete('acc-1');
  at(T0 + 5000);
  assert.equal(B.popHostId(), null, 'alone now');
  assert.ok(!B.mirroring());
  assert.deepEqual(courtsOf(B), before, 'the same games go on');
  assert.deepEqual(walkersOf(B), people, 'the same people');
  assert.ok(B.walkers.every(x => !x.mirror), 'walking on their own again');
  B.net.people.set('acc-0', { id: 'acc-0', ai: [] });
  assert.equal(B.popHostId(), 'acc-0', 'a lower id arrives: he hosts');
});
