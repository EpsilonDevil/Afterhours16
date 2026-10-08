// v0.4.5 quick patch: picking the finish on a drive. The higher rating wins (Driving Dunk, or Standing Dunk right
// under the rim, against Layup), for the attack bind and the shoot button alike; on an exact tie the archetype
// decides: a slasher with 99/99 dunks, a playmaker with 99/99 lays it in.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shotTypeFor, pickFinish, betterFinish, FINISH_STYLE } from '../client/js/sim/shots.js';
import { ARCHETYPES } from '../client/js/sim/builds.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
const open = { open: true, rimProtector: null, wall: null };
// a driver at `d` metres from the rim, running at it
function driver(archetype, r, d = 3, speed = 5) {
  const ratings = { driving_dunk: 80, standing_dunk: 80, layup: 80, mid_range: 60, ...r };
  return { entry: { build: { archetype } }, raw: { ...ratings }, ratings: { ...ratings }, phys: { reach: 2.7, vertical: 0.9 }, badges: {}, stamina: 1, x: 0, z: 0, vx: 0, vz: speed, _d: d };
}
const attack = p => shotTypeFor(p, { x: 0, z: p._d }, { attack: true, defs: [] }).type;

test('every archetype has a finishing style', () => {
  for (const a of Object.keys(ARCHETYPES)) assert.ok(FINISH_STYLE[a] === 'dunk' || FINISH_STYLE[a] === 'layup', a);
  assert.equal(FINISH_STYLE.slasher, 'dunk'); assert.equal(FINISH_STYLE.playmaker, 'layup');
});

test('attack the rim: the higher rating wins; on a tie the archetype decides', () => {
  // the examples: 99 Driving Dunk and 99 Layup
  assert.equal(attack(driver('slasher', { driving_dunk: 99, layup: 99 })), 'dunk', 'slasher 99/99 dunks');
  assert.equal(attack(driver('playmaker', { driving_dunk: 99, layup: 99 })), 'layup', 'playmaker 99/99 lays it in');
  // not a tie: the better rating, whatever the archetype
  assert.equal(attack(driver('slasher', { driving_dunk: 90, layup: 95 })), 'layup', 'a slasher with the better Layup');
  assert.equal(attack(driver('playmaker', { driving_dunk: 95, layup: 90 })), 'dunk', 'a playmaker with the better Driving Dunk');
  assert.equal(attack(driver('slasher', { driving_dunk: 98, layup: 99 })), 'layup', 'one point is enough');
  // right under the rim it's Standing Dunk against Layup
  const under = (arch, r) => attack(driver(arch, { driving_dunk: 40, ...r }, 1.2, 0.5));
  assert.equal(under('glass_cleaner', { standing_dunk: 90, layup: 90 }), 'dunk');
  assert.ok(['layup', 'close'].includes(under('stretch_big', { standing_dunk: 90, layup: 90 })));
  // a dunk still has to be physically possible: a playmaker who can't get up lays it in, a slasher too
  const grounded = driver('slasher', { driving_dunk: 99, layup: 70 }); grounded.phys.vertical = 0.3;
  assert.equal(attack(grounded), 'layup');
  // a better layup on the attack bind doesn't take off from the long-dunk range: it keeps driving
  assert.equal(attack(driver('playmaker', { driving_dunk: 99, layup: 99 }, 5.2, 6)), 'none');
  assert.equal(attack(driver('slasher', { driving_dunk: 99, layup: 99 }, 5.2, 6)), 'dunk');
});

test('shoot-button drives: the highest rating wins, the defense adjusts it, an exact tie goes to the archetype', () => {
  assert.equal(pickFinish(driver('slasher', { driving_dunk: 99, layup: 99 }), 3, open, true), 'dunk');
  assert.equal(pickFinish(driver('playmaker', { driving_dunk: 99, layup: 99 }), 3, open, true), 'layup');
  // no more head start for the dunk: a better layup wins even when the dunk is close
  assert.equal(pickFinish(driver('slasher', { driving_dunk: 90, layup: 93 }), 3, open, true), 'layup');
  assert.equal(pickFinish(driver('playmaker', { driving_dunk: 93, layup: 90 }), 3, open, true), 'dunk');
  // a pull-up has to beat both
  assert.equal(pickFinish(driver('sharpshooter', { driving_dunk: 70, layup: 75, mid_range: 95 }), 4, open, true), 'jumper');
  // a shot blocker at the rim still favors the finesse finish on a tie, even for a slasher
  const protector = { ratings: { block: 95 }, phys: { reach: 2.95 } };
  assert.equal(pickFinish(driver('slasher', { driving_dunk: 90, layup: 90 }), 3, { open: false, rimProtector: protector, wall: null }, true), 'layup');
  assert.equal(betterFinish(driver('two_way', {}), 85, 85), 'layup');
});

test('in a game: the attack bind dunks for a 99/99 slasher and lays it in for a 99/99 playmaker', () => {
  for (const [arch, want] of [['slasher', 'dunk'], ['playmaker', 'layup']]) {
    const rng = new RNG(4), me = makeTeam(rng, 1, { catalog, level: 0.9 })[0];
    me.human = true; me.build.archetype = arch;
    me.build.attributes = { ...me.build.attributes, driving_dunk: 99, layup: 99, vertical: 95 };
    me.badges = { posterizer: 1, contact_finisher: 1 };
    const g = new Game({ mode: 'practice', seed: 4, rosters: [[me], []], catalog });
    const p = g.players[0], rim = g.rimFor(0), side = g.sideFor(0);
    p.phys.vertical = Math.max(p.phys.vertical, 3.4 - p.phys.reach);
    p.setPos(rim.x, rim.z - side * 3, side > 0 ? 0 : Math.PI); p.vz = side * 5; g.giveBall(p, 'dribble');
    g.setInput({ mx: 0, mz: side, sprint: true, shoot: 'press', attack: true, shootHeld: true }); g.step(1 / 60);
    assert.equal(p.action?.type, want, `${arch} 99/99`);
  }
});
