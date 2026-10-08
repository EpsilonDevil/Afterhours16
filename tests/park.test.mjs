// v0.4.5 park hub tests: squad spot rows, walking around shops and the wheel, the line queue, AI-game speed,
// and the "not in a game" squad rule. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { squadSpots, gotNextSpots, SQUAD_ROWS, courtPlayRect } from '../client/js/world/themes.js';
import { ParkHub } from '../client/js/game/park.js';

const H = ParkHub.prototype;
const box = { x0: 10, x1: 14.6, z0: -26, z1: -22.6 };

test('three rows of squad spots per court, outside the court, row 0 is Got Next', () => {
  for (const [origin, format] of [[[0, 0, 0], 3], [[26, 0, 0], 3], [[-52, 0, 0], 2], [[52, 0, 0], 1]]) {
    const c = { origin, format, full: format === 3 };
    const rows = squadSpots(c);
    assert.equal(rows.length, SQUAD_ROWS);
    assert.deepEqual(gotNextSpots(c), rows[0]);
    for (const row of rows) assert.equal(row.length, format);
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

test('the line moves up a row when Got Next goes on court', () => {
  const c = { rows: squadSpots({ origin: [0, 0, 0], format: 3 }), lines: [] };
  const mk = n => ({ mine: false, members: Array.from({ length: n }, (_, i) => ({ id: i, goTo(x, z) { this.to = { x, z }; } })) });
  const a = mk(3), b = mk(3), d = mk(3);
  c.lines = [a, b, d];
  H.shiftLines.call(H, c);
  assert.deepEqual(c.lines, [b, d, null]);
  b.members.forEach((w, i) => { assert.equal(w.spot.row, 0); assert.deepEqual(w.to, c.rows[0][i]); });
  d.members.forEach((w, i) => { assert.equal(w.spot.row, 1); assert.deepEqual(w.to, c.rows[1][i]); });
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
  for (const i of anims.filter(x => x.slot === 'dunk')) {
    for (const st of i.styles) {
      assert.ok(S.STYLE_FLAIR[st] != null, `no flair for dunk style ${st}`);
      assert.ok(gameSrc.includes(`'${st}'`), `no ball path for dunk style ${st}`);
    }
    assert.ok(S.DUNK_TIER[i.id] != null, `no tier for ${i.id}`);
  }
  for (const i of anims.filter(x => x.slot === 'jumpshot')) assert.ok(S.BASE_FEEL[i.style], `no feel for base style ${i.style}`);
  for (const i of anims.filter(x => x.slot === 'release')) {
    const key = i.id.replace(/^(wheel_)?release_/, '');
    // (v0.4.5 stage 7: every release, Classic included, has its own row in the FOLLOW table)
    assert.ok(animSrc.includes(`  ${key}: { k:`), `no follow-through for release ${key}`);
  }
  for (const i of anims.filter(x => x.slot === 'celebration')) assert.ok(animSrc.includes(`kind === '${i.anim}'`), `no pose for celebration ${i.anim}`);
  for (const i of anims.filter(x => x.slot === 'layup' && x.style !== 'basic')) assert.ok(animSrc.includes(`ls === '${i.style}'`), `no pose for layup ${i.style}`);
  for (const i of anims.filter(x => x.slot === 'sizeup' && x.style !== 'basic')) assert.ok(animSrc.includes(`su === '${i.style}'`), `no pose for size-up ${i.style}`);
  // the Icon badges all have an exclusive animation wired up
  const B = await import('../client/js/sim/badges.js');
  const hooks = ['sharpeye', 'hashsling', 'oprah', 'clamp', 'general', 'bigbro', 'openarms', 'sexy_red'];
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
