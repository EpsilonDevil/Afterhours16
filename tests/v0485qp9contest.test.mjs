// v0.4.8.5 quick patch 9: the guard stance's auto-contest. Holding the guard stance (L2 / LT) with nothing else pressed,
// in position when the man goes up (within contest range, not trailing him), your defender's hand goes up by itself and
// he steps in toward the shooter at a gentle pace until the shot is off. Out of range when the shot starts, or behind
// him, he gets nothing (it never closes out for you); any input of yours takes over; it never jumps for you.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, AUTO_CONTEST } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { blankIntent } from '../client/js/sim/player.js';
import { RNG } from '../client/js/core/rng.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

// a jumper from the top of the key by an AI shooter (team 1), your defender (team 0) set `dist` m away: in front of him
// (between him and the rim) or behind him. hold: the guard stance held; stick: your stick, held the whole time
function shot({ seed = 7, dist = 1.7, behind = false, hold = true, stick = null, walkIn = null, assist = false } = {}) {
  const rng = new RNG(seed);
  const rosters = [makeTeam(rng, 3, { catalog, level: 0.7 }), makeTeam(rng, 3, { catalog, level: 0.7 })];
  rosters[0][0].human = true;
  const g = new Game({ mode: 'park', seed, rosters, catalog, target: 21, difficulty: 0.6 });
  for (let i = 0; i < 900 && g.phase !== 'live'; i++) g.step(1 / 60);
  const me = g.teams[0][0], sh = g.teams[1][0];
  // (the AI stands still; the shooter presses shoot on the first tick and lets the AI time the release. Your intent goes
  // in through setInput, as the game's input does every tick)
  let tick = 0;
  g.ai.think = () => { if (tick === 0) sh.intent.shoot = 'press'; sh.intent.shootHeld = true; };
  if (assist) g.assist = true;
  const side = g.sideFor(1), rim = g.rimFor(1);
  for (const p of g.players) { p.setPos(p.team ? 6 : -6, rim.z - side * 1, 0); p.intent = blankIntent(); p.action = null; }
  sh.setPos(0.3, rim.z - side * 6.4, side > 0 ? 0 : Math.PI);
  g.giveBall(sh, 'held'); g.possession = 1; g.needsClear = [false, false];
  const toRim = side; // (+z toward the rim when side > 0)
  me.setPos(0.3, sh.z + (behind ? -1 : 1) * toRim * dist, side > 0 ? Math.PI : 0);
  const out = { hand: 0, airborne: false, release: null, start: me.dist(sh), atRelease: null, me, sh, g };
  for (let i = 0; i < 120 && !out.release; i++) {
    tick = i;
    g.setInput({ ...blankIntent(), defense: hold, face: Math.atan2(sh.x - me.x, sh.z - me.z), ...(stick ? { mx: stick[0], mz: stick[1] } : {}) });
    if (walkIn && i === walkIn.at) me.setPos(me.x, sh.z + toRim * walkIn.dist, me.facing);
    g.step(1 / 60);
    if (me.contestHand) out.hand++;
    if (me.airborne) out.airborne = true;
    const r = g.events.find(e => e.type === 'release' && e.player === sh.id);
    if (r) { out.release = r; out.atRelease = me.dist(sh); }
  }
  assert.ok(out.release, 'the shot went up');
  return out;
}

test('in range and in front, holding only the guard stance: a hand goes up and he steps in before the release', () => {
  const on = shot(), off = shot({ hold: false });
  assert.ok(on.hand >= 10, `a hand up through the windup (${on.hand} ticks)`);
  assert.equal(off.hand, 0, 'not without the guard stance');
  assert.ok(on.atRelease < on.start - 0.25 && on.atRelease >= AUTO_CONTEST.stop - 0.05, `closer at the release: ${on.start.toFixed(2)} → ${on.atRelease.toFixed(2)} m`);
  assert.ok(Math.abs(off.atRelease - off.start) < 0.05, 'standing still without it');
  assert.ok(on.release.contest > off.release.contest + 0.1, `a real contest: ${off.release.contest.toFixed(2)} → ${on.release.contest.toFixed(2)}`);
  assert.equal(on.airborne, false, 'it never jumps for you');
  // and the hand stays up a moment after the ball's out
  const g = on.g;
  let follow = 0; for (let i = 0; i < 40; i++) { g.setInput({ ...blankIntent(), defense: true }); g.step(1 / 60); if (on.me.contestHand) follow++; }
  assert.ok(follow > 5 && follow <= Math.ceil(AUTO_CONTEST.follow * 60) + 2, `follow-through (${follow} ticks)`);
});

test('a gentle push, not a closeout: it covers less ground than your own full slide would', () => {
  const on = shot({ dist: 2.0 });
  // the same windup with the stick pushed all the way at him: your own closeout
  const side = on.g.sideFor(1), own = shot({ dist: 2.0, stick: [0, -side] });
  const auto = on.start - on.atRelease, full = own.start - own.atRelease;
  assert.ok(auto > 0.2, `it steps in (${auto.toFixed(2)} m)`);
  assert.ok(auto < full, `less than a full slide (${auto.toFixed(2)} vs ${full.toFixed(2)} m)`);
  globalThis.__qp9 = { auto, full, contestOn: on.release.contest, contestOff: shot({ dist: 2.0, hold: false }).release.contest };
});

test('out of range when he goes up: nothing, even if you walk in during the shot', () => {
  const far = shot({ dist: 3.2 });
  assert.equal(far.hand, 0, 'no hand');
  assert.ok(Math.abs(far.atRelease - far.start) < 0.05, 'no closeout');
  // starting out of range and walking in mid-shot doesn't switch it on for that shot
  const late = shot({ dist: 3.2, walkIn: { at: 6, dist: 1.4 } });
  assert.equal(late.hand, 0, 'decided when the shot starts');
});

test('trailing behind him, moving the stick, or the hands on the right stick: nothing (your input wins)', () => {
  assert.equal(shot({ behind: true, dist: 1.2 }).hand, 0, 'behind the shooter');
  assert.equal(shot({ stick: [0.6, 0] }).hand, 0, 'the stick moved');
  // the right stick's hands are your own contest
  const s = shot({ hold: true });
  assert.ok(s.hand > 0);
  // and the assist is for the defender you control, never for the AI (assist mode has the AI playing you)
  assert.equal(shot({ assist: true }).hand, 0, 'assist mode: the AI plays you');
});

test('deterministic (lockstep): the same shot twice is the same to the tick', () => {
  const a = shot({ seed: 11 }), b = shot({ seed: 11 });
  assert.deepEqual([a.hand, a.atRelease, a.release.contest], [b.hand, b.atRelease, b.release.contest]);
});
