// v0.4.8.7 quick patch 2: real players can't walk onto a court with a game in progress, just like the park-goers.
// Walking in, the court's edge is a wall; someone already standing on it when the game began is eased off at a walk;
// an empty court, a court you only have next on, and your own game's court are free to walk onto.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ParkHub } from '../client/js/game/park.js';
import { courtPlayRect } from '../client/js/world/themes.js';

const court = (extra = {}) => { const c = { origin: [0, 0, 0], full: true, format: 3 }; return { ...c, rect: courtPlayRect(c), ...extra }; };
const hub = courts => Object.assign(Object.create(ParkHub.prototype), { courts, myCourt: null, realBusy: c => c.busy || null });
const body = (x, z) => ({ x, z, phys: { radius: 0.35 } });
const walk = (h, p, vx, vz, secs = 3, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) { const px = p.x, pz = p.z; p.x += vx * dt; p.z += vz * dt; h.keepOffCourts(p, px, pz, dt); } return p; };

test('walking onto a court with a game on: the edge is a wall (AI game, live game, real players\' game)', () => {
  for (const flag of [{ session: {} }, { live: {} }, { busy: { a: 1 } }]) {
    const c = court(flag), h = hub([c]), p = body(-12, 0);
    walk(h, p, 4, 0);
    assert.ok(p.x <= c.rect.x0 - 0.35 + 1e-9, `${Object.keys(flag)[0]}: stopped at the edge (${p.x.toFixed(2)})`);
  }
});

test('no game on, only got next, or your own court: walk right on', () => {
  for (const [c, mine] of [[court(), false], [court({ mine: true }), false], [court({ session: {} }), true]]) {
    const h = hub([c]); if (mine) h.myCourt = c;
    const p = walk(h, body(-12, 0), 4, 0, 3);
    assert.ok(p.x > 0, `crossed (${p.x.toFixed(2)})`);
  }
});

test('standing on it when a game starts: eased off to the nearest edge at a walk, never deeper, never snapped', () => {
  const c = court({ session: {} }), h = hub([c]), p = body(c.rect.x1 - 1.5, 3);
  const px = p.x; h.keepOffCourts(p, p.x, p.z, 1 / 60);
  assert.ok(p.x - px <= 3 / 60 + 1e-9 && p.x > px, 'one frame: a step toward the right sideline, not a jump');
  walk(h, p, -2, 0, 1); // (trying to walk deeper in doesn't work)
  assert.ok(p.x > px, 'never deeper');
  walk(h, p, 0, 0, 2);
  assert.ok(p.x >= c.rect.x1 + 0.35 - 1e-9, `off the court (${p.x.toFixed(2)} vs ${(c.rect.x1 + 0.35).toFixed(2)})`);
});

test('the roam movement uses it, and a game on means the same thing the park-goers go round', () => {
  const src = fs.readFileSync(new URL('../client/js/game/park.js', import.meta.url), 'utf8');
  assert.match(src, /const px = me\.x, pz = me\.z;\s*\n\s*me\.move\(dt \* GAME_SPEED, false, 0\);/);
  assert.match(src, /this\.keepOffCourts\(me, px, pz, dt\)/);
  assert.match(src, /gameOn\(c\) \{ return !!\(c\.session \|\| c\.live \|\| this\.realBusy\?\.\(c\)\); \}/);
});
