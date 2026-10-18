// v0.4.8.5 quick patch 8: and-ones in the park. "AND ONE!" used to fire on any basket made while a shooting foul from
// an earlier shot was still pending (a fouled shot that missed and was already called, or one that was blocked, left
// its foul behind). A teammate's next basket then got the whistle and the callout with no foul behind it, and since
// nothing was called the ball went to the other team: "and-ones get called but the fouled team doesn't get the ball".
// Now an and-one is only the foul on that very shot by the man who scored it; a new shot, a miss, a block or a dead
// ball ends the last shot's foul.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, RULES } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const src = fs.readFileSync(new URL('../client/js/sim/game.js', import.meta.url), 'utf8');

// every "AND ONE" in a run of games: was a foul called on a defender against the scorer, and who got the ball next
function andOnes(mode, { size = 3, full = false, seeds = 12, foulK = 3 } = {}) {
  const old = RULES.parkFoulK; RULES.parkFoulK = foulK; // (more fouls, so plenty of and-ones to look at)
  const out = { calls: 0, kept: 0, lost: 0, noFoul: 0, wrongFoul: 0, ftOne: 0, stale: 0 };
  try {
    for (let seed = 1; seed <= seeds; seed++) {
      const rng = new RNG(seed);
      const g = new Game({ mode, full, seed, rosters: [makeTeam(rng, size, { catalog, level: 0.6 }), makeTeam(rng, size, { catalog, level: 0.6 })], catalog, target: 21, quarterLen: 120, quarters: 4, difficulty: 0.6 });
      let pend = null, steps = 0;
      while (!g.over && steps < 60 * 60 * 12) {
        g.step(1 / 60); steps++;
        // (a foul still pending after play has stopped is the old bug's leftover)
        if (g.phase !== 'live' && g.pendingFoul) out.stale++;
        for (const e of g.events) {
          if (e.type === 'score' && e.andOne) { out.calls++; pend = { team: e.team, scorer: e.player, foul: false }; }
          else if (e.type === 'foul' && pend) { pend.foul = true; if (e.victim !== pend.scorer || g.players[e.player].team === pend.team) out.wrongFoul++; }
          else if (e.type === 'ftStart' && pend) { if (e.player === pend.scorer && e.count === 1) out.ftOne++; }
          else if ((e.type === 'check' || e.type === 'inbound' || e.type === 'ftStart') && pend) { if (e.type !== 'ftStart') { if (e.team === pend.team) out.kept++; else out.lost++; } if (!pend.foul) out.noFoul++; pend = null; }
        }
      }
    }
  } finally { RULES.parkFoulK = old; }
  return out;
}

test('park, half court: every AND ONE is a real foul on the scorer, and the fouled team keeps the ball', () => {
  const r = andOnes('park');
  assert.ok(r.calls >= 30, `enough and-ones to judge (${r.calls})`);
  assert.equal(r.noFoul, 0, `no callout without a foul (${JSON.stringify(r)})`);
  assert.equal(r.wrongFoul, 0, 'the foul is a defender\'s, on the man who scored');
  assert.equal(r.lost, 0, `the ball never goes to the team that fouled (${JSON.stringify(r)})`);
  assert.ok(r.kept >= r.calls * 0.85, 'they keep it (the rest are game winners)');
  assert.equal(r.stale, 0, 'no foul is left pending once play stops');
});

test('park, full court 5v5: the same, with a sideline inbound to the fouled team', () => {
  const r = andOnes('park', { size: 5, full: true, seeds: 6 });
  assert.ok(r.calls >= 10, `and-ones (${r.calls})`);
  assert.deepEqual([r.noFoul, r.wrongFoul, r.lost, r.stale], [0, 0, 0, 0], JSON.stringify(r));
});

test('Pro-Am: an and-one is the foul and one free throw for the scorer, never a callout on its own', () => {
  const r = andOnes('proam', { size: 5, full: true, seeds: 4, foulK: RULES.parkFoulK });
  assert.ok(r.calls >= 3, `and-ones (${r.calls})`);
  assert.equal(r.noFoul, 0, JSON.stringify(r));
  assert.equal(r.ftOne, r.calls, 'one shot each, by the scorer');
});

test('the rule in the code: the and-one is the foul on this shot, and every way a shot ends clears it', () => {
  assert.ok(src.includes("const andOne = !info.ft && shooter && shooter.team === team && own && own.shooter === shooter.id ? own : null;"));
  assert.ok(src.includes("andOne: !!andOne,"), 'the callout follows the call');
  assert.ok(!src.includes('andOne: !!this.pendingFoul'), 'not just any pending foul');
  assert.equal(src.split('this.pendingFoul = foul || null;').length - 1, 3, 'jumpers, layups and dunks: a new shot replaces the last one\'s foul');
  assert.ok(src.includes("this.pendingFoul = null; // (qp8: whatever stops play"), 'dead balls');
  assert.ok(src.includes("this.pendingFoul = null; // (qp8: a blocked shot's foul"), 'blocks');
});
