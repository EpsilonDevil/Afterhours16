// v0.4.8.7 the park director on a screen (client/js/game/park.js dirSync / dirCourts / dirLend...): with the server's park
// state in, the park is the director's: its park-goers are the walkers here, its courts' games the courts' sessions (drawn
// only when seen), its lines, kings and hop-ons this park's, and what you do with its people goes back as pacts. The park's
// own decisions (new games, the population, the ICON Squad) stay out of it. No renderer: stubs for the walkers.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ParkHub } from '../client/js/game/park.js';
import { AIWorld, setWorldClock } from '../client/js/sim/world.js';
import { PARK_COURTS, squadSpots, courtPlayRect } from '../client/js/world/themes.js';
import { RNG } from '../client/js/core/rng.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
const T0 = Date.UTC(2026, 9, 21, 1, 0);
function fakeWalker(x, z, entry) {
  return { entry, p: { x, z, facing: 0, phys: { jog: 4.6 }, intent: { mx: 0, mz: 0 }, setPos(a, b, f) { this.x = a; this.z = b; this.facing = f; } }, spot: null, follow: null, exit: false, state: 'idle', path: [], t: 1, visual: { pending: false },
    goTo(a, b) { this.p.x = a; this.p.z = b; this.state = 'walk'; }, leave() { this.exit = true; }, dispose() { this.disposed = true; } };
}
function hub() {
  setWorldClock(T0, 0, T0);
  const world = new AIWorld({ seed: 4242, born: T0 - 300 * 86400000 }, catalog); world.shared = true; world.squadAsync = true;
  const sent = [], clock = { t: T0 + 4000 };
  const net = { connected: true, place: 'harbor', myId: 'u1', people: new Map(), state: 'on', send(m) { sent.push(m); return true; }, court: () => null, aiOf: () => [], on: () => () => {} };
  const courts = PARK_COURTS.filter(c => ['main', 'w2a', 'e1'].includes(c.id)).map(c => ({ ...c, rows: squadSpots(c), rect: courtPlayRect(c), session: null, lines: [null, null], mine: false, kings: null, kingsStreak: 0 }));
  const P = Object.create(ParkHub.prototype);
  Object.assign(P, {
    app: { net, ai: world, catalog, settings: {}, hud: { show() {} }, profile: {}, char: () => ({}) }, themeId: 'harbor', world, catalog, courts, walkers: [], myMates: [], myOpp: [], mode: 'roam',
    ui: { toast() {} }, aff: { park: 'Harbor Point' }, venue: { courts, solids: [], theme: { court: { surface: 'asphalt' } } }, rng: new RNG(3), me: { x: 0, z: -18, facing: 0, setPos() {} }, rig: { pos: [0, 10, -30] },
    peers: { followers: () => [], list: () => [] }, icon: null, dirHold: new Map(), dirOff: [],
  });
  P.spawnWalker = (x, z, e) => fakeWalker(x, z, e);
  P.entryFor = id => world.gameEntry(id);
  P.courtSeen = () => false; // (nobody's looking: no athletes built)
  P.bgSession = (c, rosters, teams, seed) => ({ opts: { rosters, teams, seed }, game: { over: false, players: [], teams: [[], []], score: [0, 0] }, frame() {}, dispose() {}, local: true }); // (the park's own game, once it's its own again)
  P.onPState({ t: 'pstate', place: 'harbor', epoch: 3, t0: T0, seed: 77, k: 4, w: 2, n: 0, snap: null, log: [] });
  P.link.serverNow = () => clock.t;
  const run = (secs, w = Infinity) => { const end = clock.t + secs * 1000; for (; clock.t < end; clock.t += 50) { if (P.link) P.link.w = Math.min(w, Math.floor((clock.t - T0) / 1000)); P.dirFrame(0.05); for (const c of P.courts) c.session?.frame?.(0.05); } };
  return { P, world, sent, clock, run, net };
}
const ids = ws => ws.map(w => w.entry.aiId).sort();

test('the director\'s park on this screen: its park-goers, courts, kings and lines', () => {
  try {
    const { P, run } = hub();
    assert.ok(P.dirOn(), 'the server\'s park state is in: the director runs this park');
    run(70);
    const d = P.link.dir;
    assert.ok(d.k >= 60);
    P.dirSync(); // (as of now)
    assert.deepEqual(ids(P.walkers.filter(w => w.follow == null)), d.s.walkers.map(w => w.id).sort(), 'the director\'s park-goers, and nobody else');
    for (const w of P.walkers) { const x = d.s.walkers.find(v => v.id === w.entry.aiId); assert.ok(w.mirror, 'walking where the director has him'); const p = d.posAt(x, P.link.tau()); if (!x.lead || x.st === 'line') assert.ok(Math.hypot(w.mirror.x - p[0], w.mirror.z - p[1]) < 1e-6); }
    P.courts.forEach((c, i) => {
      const g = d.s.courts[i].g;
      if (g) { assert.equal(c.session?.dir, true); assert.equal(c.session.seed, g.seed); assert.equal(c.session.game, d.runners[i].game, 'its game is the director\'s'); assert.equal(c.session.view, null, 'not drawn: nobody can see it'); }
      else assert.equal(c.session, null);
      assert.deepEqual((c.kings || []).map(e => e.aiId), d.s.courts[i].kings || []);
      assert.equal(c.kingsStreak, d.s.courts[i].ks);
      c.lines.forEach((l, r) => { const dl = d.s.courts[i].lines[r]; assert.deepEqual(l ? ids(l.members) : null, dl ? dl.ids.slice().sort() : null); });
    });
    // the park's own decisions stay out of it
    const before = P.courts.map(c => c.session);
    for (const c of P.courts) P.newBackgroundGame(c, null);
    P.squadTick();
    assert.deepEqual(P.courts.map(c => c.session), before);
    // hop-ons are the director's
    for (const [id, until] of d.s.extra) assert.equal(P.world.extra.get(id)?.until, d.tl(until));
  } finally { setWorldClock(null); }
});

test('what you do with its people goes back to it: pacts', () => {
  try {
    const { P, sent, run, net } = hub();
    run(30);
    const d = P.link.dir, c = P.courts[0], w = P.walkers.find(x => x.follow == null && !x.spot);
    sent.length = 0;
    P.dirLend(c, [w.entry], 1);
    P.dirFree(c, [{ aiId: 'ai-3' }, { aiId: 'ai-3' }, { name: 'a person' }], 1, 5);
    P.dirPact('ready', { c: 0 });
    P.dirSquad(['ai-1', 'ai-2']); P.dirSquad(['ai-1', 'ai-2']);
    assert.deepEqual(sent.map(m => [m.t, m.a, m.c, m.r ?? null, m.ids ?? null, m.kings ?? null, m.ks ?? null, m.place, m.epoch]), [
      ['pact', 'lend', 0, 1, [w.entry.aiId], null, null, 'harbor', 3],
      ['pact', 'free', 0, null, ['ai-3'], 1, 5, 'harbor', 3],
      ['pact', 'ready', 0, null, null, null, null, 'harbor', 3],
      ['pact', 'squad', undefined, null, ['ai-1', 'ai-2'], null, null, 'harbor', 3],
    ]);
    // another squad's Got Next spot: the park-goers it took stand on it here too
    const id2 = P.walkers.find(x => x.follow == null && !x.spot && x !== w).entry.aiId;
    c.lines[0] = { remote: { leader: 'u2', members: ['u2'], names: ['U2'], at: 1 }, members: [], mine: false, ready: false, readyAt: 0 };
    net.court = ci => (ci === 0 ? { lines: [c.lines[0].remote, null] } : null);
    P.link.take({ k: d.k + 1, n: 1, ev: { e: 'claim', c: 0, r: 0, aid: 'u2' } });
    P.link.take({ k: d.k + 1, n: 2, ev: { e: 'lend', from: 'u2', c: 0, r: 0, ids: [id2] } });
    P.link.n = 2;
    run(4);
    assert.deepEqual(ids(c.lines[0].members), [id2]);
    const m = c.lines[0].members[0];
    assert.deepEqual([m.mirror.x, m.mirror.z], [c.rows[0][1].x, c.rows[0][1].z], 'on his spot, after its leader');
    // the server goes quiet: the park waits; after a while without it, it's this screen's own again
    const k = d.k;
    run(5, k);
    assert.equal(P.link.dir.k, k, 'no tick past the server\'s word');
    P.link.heard = P.link.serverNow() - 11000;
    run(0.1, k);
    assert.equal(P.link, null);
    assert.equal(P.dirOn(), false);
    assert.ok(P.courts.every(c => !c.session || c.session.local), 'the park\'s own games from here');
  } finally { setWorldClock(null); }
});

test('a disputed hosted game: the 409 carries the refunded balance and the park shows it at once', async () => {
  const { API } = await import('../client/js/core/api.js');
  const keep = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'Not counted (your 500 VC ante is back).', disputed: true, balance: 12345 }) });
  try {
    await assert.rejects(new API().mutate('/api/matches/x/complete', {}), e => e.status === 409 && e.data?.balance === 12345 && /ante is back/.test(e.message));
  } finally { globalThis.fetch = keep; }
  const src = fs.readFileSync(new URL('../client/js/game/park.js', import.meta.url), 'utf8');
  assert.match(src, /e\.status === 409 && Number\.isFinite\(e\.data\?\.balance\)\) app\.setBalance\(e\.data\.balance\)/);
});
