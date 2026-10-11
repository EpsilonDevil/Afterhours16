// v0.4.5 park hub tests: squad spot rows, walking around shops and the wheel, the line queue, AI-game speed,
// and the "not in a game" squad rule. Run: node --test tests/
import test from 'node:test';
import { isHS } from '../client/js/sim/hashsling.js';
import assert from 'node:assert/strict';
import { squadSpots, gotNextSpots, gotNextMid, SQUAD_ROWS, courtPlayRect } from '../client/js/world/themes.js';
import { ParkHub } from '../client/js/game/park.js';

const H = ParkHub.prototype;
const box = { x0: 10, x1: 14.6, z0: -26, z1: -22.6 };

test('two GOT NEXT spots per court, one each side of the stencil, outside the court', () => {
  for (const [origin, format, full] of [[[0, 0, 0], 3, true], [[26, 0, 0], 3, true], [[-52, 0, -15], 2, false], [[-52, 0, 5], 2, false], [[52, 0, -10], 1, false]]) {
    const c = { origin, format, full };
    const rows = squadSpots(c);
    assert.equal(rows.length, SQUAD_ROWS);
    assert.equal(SQUAD_ROWS, 2);
    assert.deepEqual(gotNextSpots(c), rows[0]);
    for (const row of rows) assert.equal(row.length, format);
    // the stencil sits between the two spots, on the same line
    const m = gotNextMid(c);
    assert.ok(rows[0].every(p => p.z < m.z && p.x === m.x) && rows[1].every(p => p.z > m.z && p.x === m.x));
    const rect = courtPlayRect(c);
    const all = rows.flat();
    for (const p of all) assert.ok(!(p.x > rect.x0 && p.x < rect.x1 && p.z > rect.z0 && p.z < rect.z1), 'spot on the court');
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) > 1.2, 'spots overlap');
    for (const p of all) assert.ok(Math.abs(p.x) < 64, 'spot outside the park');
  }
});

test('walkers never aim inside a shop and route around it', () => {
  const hub = { venue: { solids: [box] } };
  const q = H.freeSpot.call(hub, 12, -24);
  assert.ok(!(q.x > box.x0 - 0.85 && q.x < box.x1 + 0.85 && q.z > box.z0 - 0.85 && q.z < box.z1 + 0.85), 'target still inside the shop');
  // a path straight through the shop gets corner waypoints
  const path = H.routeAround.call(hub, 7, -24, [{ x: 18, z: -24 }]);
  assert.ok(path.length >= 2);
  let ax = 7, az = -24;
  for (const w of path) {
    for (let k = 0; k <= 20; k++) {
      const x = ax + (w.x - ax) * k / 20, z = az + (w.z - az) * k / 20;
      assert.ok(!(x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1), `path crosses the shop at ${x.toFixed(2)},${z.toFixed(2)}`);
    }
    ax = w.x; az = w.z;
  }
  assert.deepEqual(path[path.length - 1], { x: 18, z: -24 });
});

test('whichever squad fills its spot first runs next; the other waits for that game', () => {
  const c = { format: 3, rows: squadSpots({ origin: [0, 0, 0], format: 3, full: true }), lines: [null, null] };
  const hub = Object.create(H); hub.walkers = []; hub.fillSeq = 0;
  const mk = (n, queued = true) => ({ mine: false, members: Array.from({ length: n }, (_, i) => ({ id: i, state: queued ? 'queued' : 'walking', entry: { aiId: 'ai-' + i }, dispose() {}, goTo(x, z) { this.to = { x, z }; } })) });
  // spot B fills first even though spot A had people standing on it earlier
  const a = mk(2), b = mk(3);
  c.lines = [a, b];
  hub.markFull(c, a); hub.markFull(c, b);
  assert.equal(hub.nextLine(c).l, b);
  a.members.push({ id: 9, state: 'queued', entry: { aiId: 'ai-9' }, dispose() {}, goTo() {} });
  hub.markFull(c, a);
  assert.equal(hub.nextLine(c).l, b, 'filling second does not jump the line');
  assert.equal(hub.upNext(c).i, 1);
  // B goes on court: its spot is free, A keeps its place and is next
  hub.takeLine(c, 1);
  assert.deepEqual(c.lines, [a, null]);
  assert.equal(hub.nextLine(c).l, a);
  // your squad: not ready yet, so an AI squad behind you that is standing ready can step on (nobody waits on walkers)
  const me = { mine: true, members: [], ready: false }, ai = mk(3);
  c.lines = [me, ai];
  me.members = mk(2, false).members; hub.markFull(c, me); hub.markFull(c, ai);
  assert.equal(hub.nextLine(c).l, me);
  assert.equal(hub.upNext(c).l, ai);
  me.ready = true;
  assert.equal(hub.upNext(c), null, 'once you are ready, you run next');
  hub.placeLine(c, 1);
  ai.members.forEach((w, i) => { assert.equal(w.spot.row, 1); assert.deepEqual(w.to, c.rows[1][i]); });
});

test('AI-only games: normal speed on a live ball you can see, fast otherwise', () => {
  const hub = { rig: { pos: [0, 8, -20], tgt: [0, 1, 0] }, courtWatched: H.courtWatched };
  const court = (x, phase) => ({ origin: [x, 0, 0], session: { game: { phase, over: false } } });
  assert.equal(H.courtRate.call(hub, court(0, 'live')), 1);
  assert.equal(H.courtRate.call(hub, court(0, 'check')), 3);
  assert.equal(H.courtRate.call(hub, court(0, 'dead')), 2);
  // behind the camera and far away: not watched
  hub.rig = { pos: [0, 8, -20], tgt: [0, 1, -40] };
  assert.equal(H.courtRate.call(hub, court(52, 'live')), 2.6);
});

test('v0.4.5 animation packages: 32 new ones, every style is implemented and reachable', async () => {
  const fs = await import('node:fs');
  const catalog = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
  const S = await import('../client/js/sim/shots.js');
  const anims = catalog.filter(i => i.category === 'animation');
  const added = anims.filter(i => i.v045);
  assert.equal(added.filter(i => i.price > 0).length, 32, '32 new paid animation packages');
  // every dunk style a package can roll has a flair value and a ball path; every base has a feel entry
  const animSrc = fs.readFileSync(new URL('../client/js/char/animator.js', import.meta.url), 'utf8');
  const gameSrc = fs.readFileSync(new URL('../client/js/sim/game.js', import.meta.url), 'utf8');
  const G = await import('../client/js/sim/game.js');
  for (const i of anims.filter(x => x.slot === 'dunk')) {
    for (const st of i.styles) {
      assert.ok(S.STYLE_FLAIR[st] != null, `no flair for dunk style ${st}`);
      assert.ok(gameSrc.includes(`'${st}'`) || G.DUNK_PATH2[st] || isHS(st), `no ball path for dunk style ${st}`); // (v0.4.7.5: DUNK_PATH2; qp3: hashsling.js)
    }
    assert.ok(S.DUNK_TIER[i.id] != null, `no tier for ${i.id}`);
  }
  for (const i of anims.filter(x => x.slot === 'jumpshot')) assert.ok(S.BASE_FEEL[i.style], `no feel for base style ${i.style}`);
  for (const i of anims.filter(x => x.slot === 'release')) {
    const key = i.id.replace(/^(wheel_)?release_/, '');
    // (v0.4.5 stage 7: every release, Classic included, has its own row in the FOLLOW table)
    assert.ok(animSrc.includes(`  ${key}: { k:`), `no follow-through for release ${key}`);
  }
  for (const i of anims.filter(x => x.slot === 'celebration')) assert.ok(animSrc.includes(`kind === '${i.anim}'`) || animSrc.includes(`  ${i.anim}: (T, t, k`), `no pose for celebration ${i.anim}`);
  for (const i of anims.filter(x => x.slot === 'layup' && x.style !== 'basic')) assert.ok(animSrc.includes(`ls === '${i.style}'`), `no pose for layup ${i.style}`);
  for (const i of anims.filter(x => x.slot === 'sizeup' && x.style !== 'basic')) assert.ok(animSrc.includes(`su === '${i.style}'`), `no pose for size-up ${i.style}`);
  // the Icon badges all have an exclusive animation wired up
  const B = await import('../client/js/sim/badges.js');
  const hooks = ['sharpeye', 'hashsling.js', 'oprah', 'clamp', 'general', 'bigbro', 'openarms', 'sexy_red']; // (qp3: Hash-Slinging is a whole package, sim/hashsling.js)
  assert.equal(Object.keys(B.ICON_BADGES).length, 8);
  for (const h of hooks) assert.ok(animSrc.includes(h) || gameSrc.includes(h), `Icon animation ${h} is not wired up`);
});

test('v0.4.5 the 180 dunk turns the body and the 360 still spins all the way round', async () => {
  const { dunkSpin } = await import('../client/js/sim/shots.js');
  const a = (style, t) => ({ type: 'dunk', style, takeoff: 0.3, slam: 0.9, spinDir: 1, t });
  assert.equal(dunkSpin(a('power', 0.6)), 0);
  assert.ok(Math.abs(dunkSpin(a('180', 0.78)) - Math.PI) < 0.02, 'half turn by the slam');
  assert.ok(Math.abs(dunkSpin(a('360', 0.84)) - Math.PI * 2) < 0.02, 'full turn by the slam');
  assert.ok(dunkSpin(a('180', 0.32)) < 0.2, 'still square at takeoff');
});

test('v0.4.5 King Tut Cup: streak visuals step every 3 wins up to 12; entrants show up at the Cup', async () => {
  const { streakLevel } = await import('../client/js/world/streakfx.js');
  assert.deepEqual([0, 2, 3, 5, 6, 9, 12, 20].map(streakLevel), [0, 0, 1, 1, 2, 3, 4, 4]);
  const { AIWorld, cupWindow, cupEntrant, CUP_EPOCH, CUP_WINDOW } = await import('../client/js/sim/world.js');
  const t = Date.now(), w = cupWindow(t);
  assert.ok(t >= CUP_EPOCH + w * CUP_WINDOW && t < CUP_EPOCH + (w + 1) * CUP_WINDOW);
  const ids = Array.from({ length: 900 }, (_, i) => 'ai-' + i);
  const n = ids.filter(id => cupEntrant(id, w)).length;
  assert.ok(n > 150 && n < 250, `about 22% enter (${n})`);
  // over a day, some online entrants are at the Cup and nobody who didn't enter ever is
  const world = new AIWorld({ seed: 4242, born: t }, {});
  let atCup = 0, wrong = 0;
  for (let h = 0; h < 24; h += 2) for (const id of ids) {
    const s = world.status(id, t + h * 3600000);
    if (s?.park === 'kingtut') { atCup++; if (!cupEntrant(id, cupWindow(t + h * 3600000))) wrong++; }
  }
  assert.ok(atCup > 20, `entrants play the Cup (${atCup})`);
  assert.equal(wrong, 0);
  assert.ok(world.onlineAt('kingtut', t).every(id => cupEntrant(id, w)));
});

// ---- v0.4.7.5 qp3: no more long way round through the plaza ----
import { Walker } from '../client/js/game/park.js';

test('a squad mate next to you on a Got Next spot walks straight to his circle; a walker across a live court goes round it, not through the plaza', () => {
  const c = { origin: [0, 0, 0], format: 3, full: true };
  const rect = courtPlayRect(c);
  const courts = [{ ...c, rect, session: {}, mine: false }, { origin: [26, 0, 0], format: 3, full: true, rect: courtPlayRect({ origin: [26, 0, 0], format: 3, full: true }), session: null, mine: false }];
  const hub = { venue: { solids: [box] }, courts, freeSpot: (x, z) => H.freeSpot.call({ venue: { solids: [box] } }, x, z), routeAround: H.routeAround, blockers: H.blockers };
  const rows = squadSpots(c), sp = rows[0][1];
  // standing a step from the spot (next to you), with the spot assigned: one leg, straight there
  const w = Object.create(Walker.prototype);
  w.hub = hub; w.p = { x: sp.x + 1.2, z: sp.z + 0.8 }; w.spot = { court: courts[0], row: 0, slot: 1 }; w.follow = null; w.exit = false;
  Walker.prototype.goTo.call(w, sp.x, sp.z);
  assert.equal(w.path.length, 1, `one leg, not ${w.path.length}`);
  assert.ok(w.path.every(q => q.z > -19.5), 'never through the south plaza');
  assert.ok(Math.hypot(w.path[0].x - sp.x, w.path[0].z - sp.z) < 0.01);
  // from the far side of a live court: round its corners, never across it
  w.p = { x: rect.x1 + 2, z: 3 }; w.spot = null;
  Walker.prototype.goTo.call(w, rect.x0 - 2, -3);
  let ax = w.p.x, az = w.p.z;
  for (const q of w.path) {
    for (let k = 0; k <= 30; k++) { const x = ax + (q.x - ax) * k / 30, z = az + (q.z - az) * k / 30; assert.ok(!(x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1), `crosses the live court at ${x.toFixed(1)},${z.toFixed(1)}`); }
    ax = q.x; az = q.z;
  }
  assert.ok(w.path.every(q => q.z > -19.5), 'and still not through the plaza');
  // a court with no game on it is not in the way
  w.p = { x: 26 + rect.x1 + 2, z: 3 };
  Walker.prototype.goTo.call(w, 26 + rect.x0 - 2, -3);
  assert.equal(w.path.length, 1, 'straight across an empty court');
  // a squad mate following you (or a man walking off) may cross
  w.follow = 0; w.p = { x: rect.x1 + 2, z: 3 };
  Walker.prototype.goTo.call(w, rect.x0 - 2, -3);
  assert.equal(w.path.length, 1);
});

test('the court overview moves the near plane out (no flicker between the court floor, the ground and the neon lines from 100 m up) and puts it back', async () => {
  const { OVERVIEW_NEAR } = await import('../client/js/game/park.js');
  const cam = { near: 0.1 }, hub = { scene: { fog: { density: 0.02 } }, app: { camera: cam }, ui: {} };
  assert.ok(OVERVIEW_NEAR >= 2 && OVERVIEW_NEAR <= 8);
  H.setOverview.call(hub, true);
  assert.equal(cam.near, OVERVIEW_NEAR); assert.ok(hub.scene.fog.density <= 0.004);
  H.setOverview.call(hub, false);
  assert.equal(cam.near, 0.1); assert.equal(hub.scene.fog.density, 0.02);
  // the 5-6 mm gaps are resolvable from the overview camera's height (84+ m) with the new near plane
  const dist = 110, bits = 2 ** 24, prec = n => dist * dist / (n * bits); // (perspective depth: ~d² / (near · 2^24))
  assert.ok(prec(0.1) > 0.005, `0.1 m near: ${(prec(0.1) * 1000).toFixed(1)} mm steps at 110 m (worse than the 5 mm gap)`);
  assert.ok(prec(OVERVIEW_NEAR) < 0.001, `${OVERVIEW_NEAR} m near: ${(prec(OVERVIEW_NEAR) * 1000).toFixed(2)} mm steps`);
});
