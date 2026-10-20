// v0.4.8.7: one AI world per online server. Two clients (separate processes: different PC clocks within the skew,
// different time zones, different accounts with their own saved worlds and games, different unlock answers from their own
// services) take the same world from the same server data and must show the same thing over a day: who's on at every park,
// their builds, levels, looks and unlocks, the ICON Squad, the event park. A client that stays offline keeps its own world.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOUR = 3600000, DAY = 24 * HOUR;
const S0 = Date.UTC(2026, 9, 20, 15, 7, 0); // (the server's clock at the start: a Tuesday afternoon in October)
const SW = { seed: 1357911, born: S0 - 210 * DAY, tz: -420, unlocks: { prizes: { 'ai-17': ['fv_band_bandana'], 'ai-40': ['jb_tee'] }, through: 140 },
  schedule: [{ event: 'monster', venue: 'monster', from: S0 / 1000 - 30 * 3600, until: S0 / 1000 + 9 * 3600 }, { event: 'favela', venue: 'favela', from: S0 / 1000 + 9 * 3600, until: null }] };

// ---- the client, run in a process of its own (env CLIENT: its clock offset, time zone, saved world, local unlocks) ----
async function client() {
  const C = JSON.parse(process.env.SHARED_WORLD_CLIENT);
  const W = await import('../client/js/sim/world.js');
  const CATALOG = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url), 'utf8')).map(i => [i.id, i]));
  let server = S0;
  const real = Date.now; Date.now = () => server + C.offset; void real;
  const saves = [];
  const app = { profile: { ai_world: C.saved }, config: {}, catalog: CATALOG,
    api: { mutate: async (p, b) => { saves.push(b.world); return { world: b.world }; }, get: async () => C.localUnlocks } };
  W.initWorld(app);
  await new Promise(r => setTimeout(r, 10)); // (its own service's unlock answer comes in first)
  if (C.prog) for (const [id, g] of Object.entries(C.prog)) for (let i = 0; i < g; i++) app.ai.playedGame([id], [id]);
  if (!C.offline) W.adoptSharedWorld(app, { ...SW, now: S0 + (C.lag || 0) }, S0 + C.offset + (C.lag || 0));
  // what he does himself: games with the AI, a friend, a squad mate: never changes the AI
  if (C.prog) for (const [id, g] of Object.entries(C.prog)) for (let i = 0; i < g; i++) app.ai.recordGame([id], ['ai-2'], true);
  app.ai.addFriend('ai-' + (C.offset & 63));
  const w = app.ai, out = [];
  for (let k = 0; k < 48; k++) {
    server = S0 + k * 30 * 60000 + 13000; // (every half hour, a little after the hour's turn)
    const t = Date.now(), at = {};
    for (const park of [...W.PARKS, 'monster', 'favela']) at[park] = w.onlineAt(park, t);
    const sq = w.iconSquad(t);
    const look = [...at.harbor.slice(0, 6), ...(sq ? sq.ids : []), 'ai-17', 'ai-40'].map(id => {
      const e = w.entry(id, t), b = e.build;
      return [id, e.name, b.overall, b.archetype, b.height, b.icon_badge || null, e.rep.level, e.tier, JSON.stringify(e.badges), JSON.stringify(b.equipment || {}), JSON.stringify(e.unlocked || null), e.gk];
    });
    const st = Array.from({ length: 40 }, (_, i) => { const s = w.status('ai-' + (i * 22), t); return s ? [s.park, Math.round(s.until - C.offset)] : null; }); // (until on the server's clock)
    out.push({ k, at, look, squad: sq ? [sq.k, sq.park, sq.ids, sq.leader, JSON.stringify(sq.outfit)] : null, ev: W.eventVenueAt(t), st, playing: Array.from({ length: 60 }, (_, i) => w.playingElsewhere('ai-' + (i * 15), t)) });
  }
  await new Promise(r => setTimeout(r, 900)); // (its save goes out)
  process.stdout.write(JSON.stringify({ seed: w.seed, born: w.born, shared: w.shared, out, saved: saves.at(-1) || null, prev: w.prev ? w.prev.seed : null }), () => process.exit(0));
}

if (process.env.SHARED_WORLD_CLIENT) await client();
else {
  const self = fileURLToPath(import.meta.url);
  const run = c => {
    const r = spawnSync(process.execPath, [self], { env: { ...process.env, TZ: c.tz, SHARED_WORLD_CLIENT: JSON.stringify(c) }, encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error(r.stderr || 'client failed');
    return JSON.parse(r.stdout);
  };
  const A = { tz: 'America/Los_Angeles', offset: -2400, saved: { seed: 4242, born: S0 - 40 * DAY, friends: ['ai-3', 'ai-9'], squad: ['ai-3'], met: {}, prog: { 'ai-10': { g: 900, w: 700 } } },
    localUnlocks: { prizes: { 'ai-5': ['kt_crown'] }, through: 130 }, prog: { 'ai-17': 40, 'ai-40': 25 } };
  const B = { tz: 'Asia/Tokyo', offset: 3100, lag: 180, saved: null, localUnlocks: { prizes: {}, through: null } };

  test('two clients on the same online server see the same AI world over a day: people, builds, looks, unlocks, the ICON Squad', () => {
    const a = run(A), b = run(B);
    assert.equal(a.seed, SW.seed); assert.equal(b.seed, SW.seed); assert.ok(a.shared && b.shared);
    assert.equal(a.out.length, 48);
    let people = 0, squads = 0;
    for (let k = 0; k < 48; k++) {
      const x = a.out[k], y = b.out[k];
      assert.deepEqual(x.at, y.at, `step ${k}: the same people at every park`);
      assert.deepEqual(x.look, y.look, `step ${k}: the same builds, levels, looks and unlocks`);
      assert.deepEqual(x.squad, y.squad, `step ${k}: the same ICON Squad`);
      assert.equal(x.ev, y.ev, `step ${k}: the same event park`);
      assert.deepEqual(x.playing, y.playing, `step ${k}: the same people busy in games elsewhere`);
      for (let i = 0; i < x.st.length; i++) if (x.st[i] || y.st[i]) { assert.equal(x.st[i]?.[0], y.st[i]?.[0]); assert.ok(Math.abs(x.st[i][1] - y.st[i][1]) < 5, 'online until the same moment'); }
      people += Object.values(x.at).reduce((s, l) => s + l.length, 0); if (x.squad) squads++;
    }
    assert.ok(people > 48 * 40, `${people} park-goers over the day`);
    assert.ok(squads > 0, 'an ICON Squad hour in the day');
    assert.ok(a.out.some(o => o.ev === 'monster') && a.out.some(o => o.ev === 'favela'), 'the event handover inside the day');
    // the prizes are the server's (nobody's own service's), and nothing either account did changed anyone
    assert.ok(a.out[0].look.some(r => r[0] === 'ai-17' && r[10].includes('fv_band_bandana')));
    assert.ok(!a.out[0].look.some(r => r[10].includes('kt_crown')));
    // A's own world is kept aside in its save; B had none
    assert.equal(a.prev, 4242); assert.equal(b.prev, null);
    assert.equal(a.saved.seed, SW.seed); assert.equal(a.saved.shared, true); assert.equal(a.saved.prev.seed, 4242);
  });

  test('offline, a client keeps its own world on its own clock', () => {
    const o = run({ ...A, offline: true });
    assert.equal(o.seed, 4242); assert.equal(o.shared, false);
    const a = run(A);
    assert.notDeepEqual(o.out[0].at, a.out[0].at);
  });

  test('an account already on the server\'s world keeps its friends there', () => {
    const c = run({ ...B, saved: { seed: SW.seed, born: SW.born, shared: true, friends: ['ai-1', 'ai-2'], squad: [], met: {}, prog: {} } });
    assert.equal(c.prev, null); assert.ok(!c.saved || c.saved.friends.includes('ai-1'));
  });
}
