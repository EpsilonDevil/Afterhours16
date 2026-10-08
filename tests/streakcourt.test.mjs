// v0.4.5 quick patch: whose streak a court shows. Yours from the moment you step up to play on it until you walk off;
// otherwise its kings', and kings who beat you carry the right streak.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParkHub } from '../client/js/game/park.js';

// a park with just enough of itself for the streak bookkeeping (no renderer, no world)
function park(myStreak) {
  const noop = () => {};
  const courts = ['a', 'b'].map(id => ({ id, origin: [0, 0, 0], format: 3, lines: [null, null, null], session: null, kings: null, kingsStreak: 0, mine: false }));
  const P = Object.create(ParkHub.prototype);
  Object.assign(P, {
    courts, cup: false, mode: 'roam', myCourt: null, mySession: null, myMates: [], myOpp: [], walkers: [],
    app: { char: () => ({ progression: { park: { streak: myStreak } } }), api: { mutate: () => new Promise(noop) }, settings: {}, mode: 'park', hud: { show: noop }, setBalance: noop, profile: {} },
    char: { id: 'c1', progression: { park: { streak: myStreak } } }, ui: { toast: noop, backToRoam: noop },
    me: { setPos: noop }, rig: { snap: noop }, world: { inSquad: () => false },
    spawnWalker: () => ({ goTo: noop, leave: noop }), rebuildMe: noop, syncSquad: noop, stays: () => true, unclaim: noop,
  });
  P.newBackgroundGame = (c, kings) => { if (!kings) c.kingsStreak = 0; c.kings = kings; c.session = kings ? { opts: { rosters: [kings, []] } } : null; };
  return P;
}

test('your streak lights the court you\'re stepping onto from the start, and leaves with you', () => {
  const P = park(7), [a, b] = P.courts;
  // you claim court A: lit with your streak while the game is being set up, before the tip-off
  P.startMyGame(a, ['k1', 'k2', 'k3'], 4);
  assert.equal(P.courtStreak(a), 7, 'court A shows your streak as you step up');
  P.mySession = { game: { winner: 0 }, dispose() {} }; P.mode = 'match';
  assert.equal(P.courtStreak(a), 7);
  // you win and walk off: court A is not yours any more (fresh kings, no streak)
  P.leaveCourt(P.mySession, true);
  assert.equal(P.myCourt, null);
  assert.equal(P.courtStreak(a), 0, 'court A goes dark when you leave');
  // you step up on court B: B shows your streak right away, A stays dark
  P.startMyGame(b, ['x', 'y', 'z'], 0);
  assert.equal(P.courtStreak(b), 7, 'court B lights up before the game starts');
  assert.equal(P.courtStreak(a), 0, 'and court A doesn\'t light up with your streak');
});

test('kings who beat you carry the right streak; challengers who beat you start at one', () => {
  const P = park(5), [a] = P.courts;
  // challenge kings on a 4-game run and lose: they're on 5
  P.startMyGame(a, ['k1', 'k2', 'k3'], 4); P.mySession = { game: {}, dispose() {} };
  P.myOpp = ['k1', 'k2', 'k3'];
  P.leaveCourt(P.mySession, false);
  assert.equal(a.kingsStreak, 5);
  // you hold the court and lose to challengers: they're on 1, not whatever the court had before
  a.kingsStreak = 9;
  P.startMyGame(a, ['q1', 'q2', 'q3'], 0); P.mySession = { game: {}, dispose() {} }; P.myOpp = ['q1', 'q2', 'q3'];
  P.leaveCourt(P.mySession, false);
  assert.equal(a.kingsStreak, 1);
  // the court with no game on it shows nothing
  const b = P.courts[1];
  b.kingsStreak = 6; b.session = null;
  assert.equal(P.courtStreak(b), 0);
});
