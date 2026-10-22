// v0.4.8.8: a GOT NEXT spot is held by whoever is standing on it. An AI group heading for a spot holds nothing yet: a
// real player who steps on it first claims it (the group goes to the other spot if it's free, else back to hanging out),
// and it isn't in the order for the next game. It holds the spot from the moment its first man stands on the spot's first
// circle, the way a real squad's is theirs the moment its man stands on it; a squad steps on court only with everyone on
// his circle. The park offline (game/park.js), the park host's copy (qp7 pop) and the park director (parkdirector.js:
// "on it" is the end of his path by its time, the same on every screen) alike.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ParkHub } from '../client/js/game/park.js';
import { ParkDirector } from '../client/js/game/parkdirector.js';
import { AIWorld } from '../client/js/sim/world.js';
import { PARK_COURTS, squadSpots, courtPlayRect } from '../client/js/world/themes.js';
import { RNG } from '../client/js/core/rng.js';

const HOUR = 3600000;
class World {
  constructor() { this.ids = Array.from({ length: 80 }, (_, i) => 'ai-' + i); this.squad = []; this.extra = new Map(); }
  iconSquad() { return null; } squadOf() { return null; }
  status(id, t = Date.now()) { return { park: 'harbor', until: t + HOUR }; }
  online() { return true; } onlineAt() { return this.ids.slice(); }
  entry(id) { return { aiId: id, name: 'Hooper ' + id.slice(3), build: { overall: 70, equipment: {} }, badges: {} }; }
  gameEntry(id) { const e = this.entry(id); return { ...e, build: { ...e.build } }; }
  account() { return { level: 0.6 }; } inSquad(id) { return this.squad.includes(id); } activeSquad() { return this.squad; }
  aiParty() { return []; } closestOffline() { return []; } playedGame() {} playingElsewhere() { return false; }
}
// a walker that walks: goTo sets where he's heading; step() moves him there (a few metres a step)
function walker(x, z, entry) {
  return { entry, p: { x, z, facing: 0, intent: { mx: 0, mz: 0, sprint: false }, setPos(a, b, f) { this.x = a; this.z = b; this.facing = f; } }, spot: null, follow: null, exit: false, state: 'idle', t: 99, to: null,
    goTo(a, b) { this.to = { x: a, z: b }; this.state = 'walk'; }, leave() { this.exit = true; }, dispose() { this.disposed = true; },
    step(d = 3) { if (!this.to) return; const dx = this.to.x - this.p.x, dz = this.to.z - this.p.z, n = Math.hypot(dx, dz); if (n <= d) { this.p.x = this.to.x; this.p.z = this.to.z; this.to = null; this.state = this.spot ? 'queued' : 'idle'; } else { this.p.x += dx / n * d; this.p.z += dz / n * d; } } };
}
function park() {
  const P = Object.create(ParkHub.prototype), world = new World();
  const cs = [0, 1].map(i => ({ id: 'c' + i, name: `Court ${i + 1}`, origin: [i * 26, 0, 0], format: 3, full: true, lines: [null, null], session: null, mine: false, kings: null, kingsStreak: 0,
    rows: [0, 1].map(r => Array.from({ length: 3 }, (_, s) => ({ x: i * 26 + 9.4, z: (r ? 1 : -1) * (1.8 + s * 2.2) }))) }));
  Object.assign(P, { app: { settings: {}, mode: 'park', hud: { show() {} }, profile: {}, char: () => ({}) }, themeId: 'harbor', world, rng: new RNG(5), walkers: [], myMates: [], myOpp: [], mode: 'roam',
    courts: cs, ui: { toast() {}, pickAnte() {} }, aff: { park: 'Harbor Point' }, venue: { courts: cs, solids: [] }, catalog: {}, char: { progression: {} }, me: { x: 0, z: -25, facing: 0, setPos() {} }, rig: { snap() {} }, icon: null, iconT: 2, claimT: 0 });
  P.spawnWalker = (x, z, e) => walker(x, z, e);
  P.bgSession = (c, rosters, teams) => ({ opts: { rosters, teams, seed: 1 }, teams, rate: 1, game: { tick: 0, over: false, winner: null, score: [0, 0], players: [], teams: rosters.map(r => r.map(() => ({ x: 0, z: 0 }))) }, dispose() {} });
  P.netHere = () => null;
  for (const c of cs) P.newBackgroundGame(c, null);
  // park-goers far off in the plaza
  for (let i = 0; i < 9; i++) P.walkers.push(P.spawnWalker(-40 + i, -30, P.entryFor(P.availableHere()[0])));
  return P;
}
const walk = (P, n = 1) => { for (let i = 0; i < n; i++) for (const w of P.walkers) w.step(); };
const stand = (P, c, r) => { const sp = c.rows[r][0]; P.me.x = sp.x; P.me.z = sp.z; for (let i = 0; i < 20; i++) { P.prompt = ''; P.gotNext(0.1); } };

test('offline: a group on its way holds nothing; it holds the spot once its first man is on it', () => {
  const P = park(), c = P.courts[0];
  assert.ok(P.formAILine(c));
  const l = c.lines[0];
  assert.equal(l.pending, true);
  assert.equal(P.nextLine(c), null, 'not in the order for the next game');
  assert.equal(P.upNext(c), null);
  walk(P, 3); // (still on the way)
  assert.equal(c.lines[0].pending, true);
  walk(P, 40);
  P.holdLines();
  assert.equal(l.pending, false, 'the first man is on the spot: theirs');
  assert.ok(l.fullAt > 0);
  assert.equal(P.upNext(c)?.l, l, 'all three on their circles: they step on next');
  // now it's taken: standing on it you only hear so
  stand(P, c, 0);
  assert.equal(c.lines[0], l);
  assert.match(P.prompt, /is taken/);
});

test('offline: you step on a spot a group is still walking to: it\'s yours; they take the other spot, or go back to hanging out', () => {
  const P = park(), c = P.courts[0];
  P.formAILine(c);
  const theirs = c.lines[0];
  walk(P, 2);
  stand(P, c, 0);
  assert.equal(c.lines[0]?.mine, true, 'you got there first');
  assert.equal(c.lines[1], theirs, 'they head for the other spot');
  assert.ok(theirs.members.every(w => w.spot?.row === 1));
  // both spots: you on one, a group walking to the other; another player... here: the group is beaten to that one too
  P.unclaim(c, true);
  const P2 = park(), c2 = P2.courts[1];
  P2.formAILine(c2); P2.formAILine(c2);
  const [a, b] = c2.lines;
  stand(P2, c2, 1);
  assert.equal(c2.lines[1]?.mine, true);
  assert.equal(c2.lines[0], a);
  assert.ok(b.members.every(w => !w.spot && w.state === 'idle'), 'nowhere to go: back to hanging out');
});

test('offline: the next game is played by who is there: a group still walking up doesn\'t step on', () => {
  const P = park(), c = P.courts[0];
  P.formAILine(c);
  const l = c.lines[0];
  const was = c.session.opts.rosters.map(r => r.map(e => e.aiId));
  c.session.game.over = true; c.session.game.winner = 0; P.rotateCourt(c);
  const now = c.session.opts.rosters.flat().map(e => e.aiId);
  assert.ok(l.members.every(w => !now.includes(w.entry.aiId)), 'they\'re still on their way: not in it');
  assert.deepEqual(c.session.opts.rosters[0].map(e => e.aiId), was[0], 'the kings stay on');
});

test('the park host\'s copy (qp7 pop): a group on its way is on its way on everyone\'s screen', () => {
  const P = park(), c = P.courts[0];
  P.formAILine(c);
  const m = P.popSnapshot();
  assert.equal(m.lines[0][0].p, 1);
});

// the director: on its spot = the end of his path by its time (the same on every screen)
const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
const T0 = Date.UTC(2026, 9, 21, 1, 0);
const layout = { courts: PARK_COURTS.filter(c => ['main', 'w2a'].includes(c.id)).map(c => ({ ...c, rows: squadSpots(c), rect: courtPlayRect(c) })), solids: [] };
const dir = () => { const w = new AIWorld({ seed: 4242, born: T0 - 300 * 86400000 }, catalog); w.shared = true; w.squadAsync = true; return new ParkDirector({ world: w, park: 'harbor', layout, catalog, epoch: 5, t0: T0 }); };

test('the director: a line holds its spot from the tick its first man is on it; a squad calling it before that gets it', () => {
  const A = dir(), B = dir();
  let k = 0, seen = null;
  for (k = 1; k <= 400 && !seen; k++) {
    A.step([]); B.step([]);
    A.s.courts.forEach((c, ci) => c.lines.forEach((l, r) => { if (l && l.full == null && !seen) seen = { ci, r, n: l.n }; }));
  }
  assert.ok(seen, 'an AI line forms and walks up');
  const lineOf = D => D.s.courts[seen.ci].lines.find(l => l?.n === seen.n);
  const lead = A.W(lineOf(A).ids[0]);
  assert.ok(A.arrive(lead) > A.k, 'its first man is still on his way');
  assert.equal(A.upNext(seen.ci), null);
  // a real squad calls that spot now: it's theirs; the group goes to the other spot if it's free
  const ev = [{ e: 'claim', c: seen.ci, r: seen.r, aid: 'u1' }];
  A.step(ev); B.step(ev);
  const c = A.s.courts[seen.ci], moved = lineOf(A);
  assert.equal(c.claim[seen.r], 'u1');
  assert.notEqual(c.lines[seen.r]?.n, seen.n, 'not on the called spot');
  if (moved) assert.equal(c.lines[1 - seen.r], moved);
  assert.equal(A.hash(), B.hash(), 'the same on two screens');
  // a line that gets there holds it from that tick
  for (let i = 0; i < 300; i++) { A.step([]); B.step([]); }
  for (const cc of A.s.courts) for (const l of cc.lines) if (l) {
    const w = A.W(l.ids[0]), there = w && A.arrive(w) <= A.k;
    assert.equal(l.full != null, !!there, 'held exactly when its first man is on it');
  }
  assert.equal(A.hash(), B.hash());
});
