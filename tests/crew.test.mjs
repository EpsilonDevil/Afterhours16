// v0.4.5 Crews: the Crew HQ building on the park plaza, the HQ floor plan, crew colors and the crew run.
// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PARK_HQ, HQ, PARK_COURTS, courtPlayRect, squadSpots } from '../client/js/world/themes.js';
import { HQ_SIZE } from '../client/js/world/props.js';
import { CrewHQ, contrastColor, RUN_MIN } from '../client/js/game/crewhq.js';
import { inkFor } from '../client/js/ui/crew.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';

const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const inside = (b, x, z, m = 0) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;
const hqBox = { x0: PARK_HQ.x - HQ_SIZE.w / 2, x1: PARK_HQ.x + HQ_SIZE.w / 2, z0: PARK_HQ.z - HQ_SIZE.d / 2, z1: PARK_HQ.z + HQ_SIZE.d / 2 };

test('the Crew HQ building sits on the plaza clear of courts, shops, lamps and the sidewalks', () => {
  // the store, boosts kiosk and wheel (venues.js buildPark)
  const shops = [[0, -24], [6.2, -24]].map(([x, z]) => ({ x0: x - 2.9, x1: x + 2.9, z0: z - 1.75, z1: z + 1.75 })).concat([{ x0: -7.8, x1: -4.6, z0: -24.8, z1: -23.2 }]);
  for (const s of shops) assert.ok(!overlap(hqBox, s), 'overlaps a shop');
  for (const c of PARK_COURTS) {
    assert.ok(!overlap(hqBox, courtPlayRect(c, 2.6)), `overlaps ${c.name}`);
    for (const sp of squadSpots(c).flat()) assert.ok(!inside(hqBox, sp.x, sp.z, 1), 'covers a squad spot');
  }
  for (let i = 0; i < 10; i++) assert.ok(!inside(hqBox, -40 + i * 9, -27, 0.4), 'a street lamp stands in the building');
  assert.ok(hqBox.z0 > -30.5 + 1 + 0.3, 'the beach sidewalk runs through the back wall');
  assert.ok(!overlap(hqBox, { x0: -42.5, x1: -33.5, z0: -34, z1: -33 }), 'covers the Cup leaderboard');
  // the door is on the plaza side and you can stand in front of it
  const door = { x: PARK_HQ.x, z: hqBox.z1 + 1.1 };
  assert.ok(!inside(hqBox, door.x, door.z, 0.4));
  assert.ok(door.z > -30 && door.z < -21.5, 'door not on the plaza');
});

test('Crew HQ floor plan: courts apart, furniture off the courts, every prompt reachable', () => {
  const main = courtPlayRect({ origin: HQ.main, full: true }, 0.6), side = courtPlayRect({ origin: HQ.shoot, full: false }, 0.6);
  assert.ok(!overlap(main, side), 'the two courts overlap');
  const W = HQ.walls, B = HQ.bounds;
  for (const r of [main, side]) assert.ok(r.x0 > W.x0 && r.x1 < W.x1 && r.z0 > W.z0 && r.z1 < W.z1, 'a court runs into a wall');
  const furniture = [
    { x0: HQ.table.x - 0.5, x1: HQ.table.x + 0.5, z0: HQ.table.z - 3.05, z1: HQ.table.z + 3.05 },
    { x0: HQ.coffee.x - 0.4, x1: HQ.coffee.x + 0.4, z0: HQ.coffee.z - 0.95, z1: HQ.coffee.z + 0.95 },
    { x0: HQ.rack.x - 0.75, x1: HQ.rack.x + 0.75, z0: HQ.rack.z - 0.25, z1: HQ.rack.z + 0.25 },
    ...HQ.couches.map(([x, z]) => ({ x0: x - 0.5, x1: x + 0.5, z0: z - 1.45, z1: z + 1.45 })),
  ];
  for (const f of furniture) { assert.ok(!overlap(f, main) && !overlap(f, side), 'furniture on a court'); assert.ok(f.x0 > B.x0 && f.x1 < B.x1 && f.z0 > B.z0 && f.z1 < B.z1, 'furniture outside the room'); }
  // where you stand to use things: inside the room and not inside furniture
  const spots = [[HQ.spawn.x, HQ.spawn.z], [HQ.door.x, HQ.door.z + 0.9], [HQ.board.x - 1.7, HQ.board.z], [HQ.levels.x, HQ.levels.z + 1.5], [HQ.custom.x, HQ.custom.z + 2.2], [HQ.table.x - 1.3, HQ.table.z], [HQ.rack.x, HQ.rack.z - 1.2]];
  for (const [x, z] of spots) {
    assert.ok(inside(B, x, z), `prompt spot ${x},${z} outside the room`);
    for (const f of furniture) assert.ok(!inside(f, x, z, 0.3), `prompt spot ${x},${z} inside furniture`);
  }
  // you don't walk in already standing on the exit prompt
  assert.ok(Math.hypot(HQ.spawn.x - HQ.door.x, HQ.spawn.z - (HQ.door.z + 0.9)) > 1.9 + 0.3);
});

test('crew colors: readable ink and a contrasting jersey for the other side', () => {
  assert.equal(inkFor('#f4f2ec'), '#15171b');
  assert.equal(inkFor('#f2c14e'), '#15171b');
  assert.equal(inkFor('#111111'), '#ffffff');
  assert.equal(inkFor('#2457c5'), '#ffffff');
  assert.equal(contrastColor('#f4f2ec'), '#1d2024');
  assert.equal(contrastColor('#2457c5'), '#f4f2ec');
});

test('HQ: only online crew members show up, best players first; 5-on-5 needs four of them', () => {
  const online = new Set(['ai-1', 'ai-3', 'ai-4']), lvl = { 'ai-1': 0.4, 'ai-2': 0.9, 'ai-3': 0.8, 'ai-4': 0.6 };
  const fake = { crew: { members: ['ai-1', 'ai-2', 'ai-3', 'ai-4'].map(id => ({ id })) }, world: { online: id => online.has(id), account: id => ({ level: lvl[id] }) } };
  assert.deepEqual(CrewHQ.prototype.onlineIds.call(fake), ['ai-3', 'ai-4', 'ai-1']);
  assert.equal(RUN_MIN, 4);
});

test('a crew run (5-on-5, full court, first to 21) plays to the end', () => {
  const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
  const rng = new RNG(77);
  const g = new Game({ mode: 'park', full: true, seed: 77, rosters: [makeTeam(rng, 5, { catalog, level: 0.6 }), makeTeam(rng, 5, { catalog, level: 0.6 })], catalog, target: 21, difficulty: 0.6 });
  let steps = 0;
  while (!g.over && steps < 60 * 60 * 30) { g.step(1 / 60); steps++; }
  assert.ok(g.over, 'game never finished');
  assert.ok(Math.max(...g.score) >= 21);
  assert.equal(g.players.length, 10);
});
