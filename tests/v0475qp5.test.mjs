// v0.4.7.5 quick patch 3 (the break): the AI sees the man running the open floor and lobs it over the top first, an
// alley-oop when he can get up for it, to the human too; the human's alley-oop asks for a called face button while
// the ball is in the air (OOP_QTE), and a mistimed press puts the ball off his hands.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, OOP_QTE } from '../client/js/sim/game.js';
import { RUNNER } from '../client/js/sim/ai.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { Input, newStickState, PAD } from '../client/js/core/input.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const game = (seed = 9, { human = false } = {}) => {
  const rng = new RNG(seed);
  const a = makeTeam(rng, 3, { catalog, level: 0.7 }), b = makeTeam(rng, 3, { catalog, level: 0.7 });
  if (human) a[0].human = true;
  return new Game({ mode: 'park', full: true, seed, rosters: [a, b], catalog, target: 21, difficulty: 0.6 });
};
// a break: handler h with the ball in his backcourt, runner r free ahead near the rim, the defense parked
const breakSetup = (g, h, r, { runnerZ = 7.5, defAt = 'back', dunk = 85 } = {}) => {
  g.phase = 'live'; g.possession = h.team; g.half = false;
  const side = g.sideFor(h.team), rim = g.rimFor(h.team);
  g.giveBall(h, 'dribble'); h.setPos(0, -side * 2, side > 0 ? 0 : Math.PI); h.vx = 0; h.vz = side * 4;
  r.setPos(1.0, side * runnerZ, side > 0 ? 0 : Math.PI); r.vx = -0.3; r.vz = side * 5.5; r.action = null;
  r.raw.driving_dunk = dunk; r.ratings.driving_dunk = dunk;
  r.phys.vertical = Math.max(r.phys.vertical, 3.5 - r.phys.reach); // (he can get up to the rim)
  for (const m of g.mates(h)) if (m !== r) m.setPos(-5, -side * 6, 0);
  g.opponents(h).forEach((d, i) => {
    if (defAt === 'back') d.setPos(-4 + i * 4, -side * 9, 0);            // beaten: all behind the play
    else if (defAt === 'lane') d.setPos(i === 0 ? 0.6 : -6 + i * 6, i === 0 ? side * 10.5 : -side * 9, 0); // one man between the runner and the rim
    else d.setPos(-6 + i * 6, side * 3, 0);
    d.vx = d.vz = 0; d.action = null;
  });
  return { side, rim };
};

test('the AI reads the runner: free man at the rim on the break → alley-oop first; a man in his lane → nothing', () => {
  const g = game(9), h = g.players[0], r = g.players[1];
  breakSetup(g, h, r);
  const run = g.ai.runnerAhead(h);
  assert.ok(run && run.r === r, 'the runner is seen');
  assert.ok(run.canOop, 'and he can get up for it');
  // the pass call: lob-first with the roll on his side
  g.rng.next = () => 0; // (take the look)
  const it = { ...h.intent };
  assert.ok(g.ai.passToRunner(h, it, 0.8));
  assert.equal(it.pass.target, r.id); assert.equal(it.pass.type, 'alley');
  // can't get up for it from there (a long way out, no hops): a lob over the top, not a chest pass through traffic
  breakSetup(g, h, r, { runnerZ: 5.5 }); r.phys.vertical = 0.3;
  const it2 = { ...h.intent };
  g.ai.passToRunner(h, it2, 0.8);
  assert.ok(it2.pass && it2.pass.target === r.id && it2.pass.type !== 'alley', `far runner: ${it2.pass?.type}`);
  // a defender between the runner and the rim: no runner
  breakSetup(g, h, r, { defAt: 'lane' });
  assert.equal(g.ai.runnerAhead(h), null, 'lane shut');
  // a non-finisher far from the rim gets the lob; near the rim anyone who can reach it gets the alley
  breakSetup(g, h, r, { dunk: 40 });
  const run3 = g.ai.runnerAhead(h);
  assert.ok(run3 && (run3.canOop === (r.phys.reach + r.phys.vertical > 3.25)), 'finisher rule');
  assert.ok(RUNNER.chance0 + RUNNER.chanceIQ >= 0.95, 'a smart handler almost always takes the look');
});

test('the AI throws the human an alley-oop, and the right button in the window finishes it', () => {
  const g = game(10, { human: true }), me = g.players[0], h = g.players[1];
  breakSetup(g, h, me);
  g.startPass(h, { target: me.id, type: 'alley' });
  assert.equal(h.action?.type, 'pass'); assert.equal(h.action.ptype, 'alley', 'an alley-oop, not downgraded to a lob');
  let prompt = null;
  for (let i = 0; i < 60 && !prompt; i++) { g.step(1 / 60); prompt = g.events.find(e => e.type === 'oopPrompt'); }
  assert.ok(prompt && prompt.player === me.id, 'the prompt is up');
  assert.ok(me.oopQte && me.oopQte.btn >= 0 && me.oopQte.btn <= 3 && !me.oopQte.result);
  assert.equal(me.action?.type, 'oop', 'he runs for it');
  const q = me.oopQte;
  assert.ok(q.open > 0 && q.close > q.open && Math.abs(q.close - (me.action.jumpAt + OOP_QTE.grace)) < 1e-9, 'window: from a quarter of the way to the takeoff');
  // too early: the press before the window opens is a miss
  assert.equal(g.oopInput(me, q.btn), 'early');
  // (a second press changes nothing)
  assert.equal(g.oopInput(me, q.btn), null);
  // run a fresh one and hit it inside the window
  const g2 = game(10, { human: true }), me2 = g2.players[0], h2 = g2.players[1];
  breakSetup(g2, h2, me2);
  g2.startPass(h2, { target: me2.id, type: 'alley' });
  let hit = null, caught = null, scored = null;
  for (let i = 0; i < 60 * 4 && !scored; i++) {
    g2.step(1 / 60);
    const q2 = me2.oopQte;
    if (q2 && !q2.result && g2.time - q2.t0 >= q2.open + 0.02) hit = g2.oopInput(me2, q2.btn);
    for (const e of g2.events) { if (e.type === 'oopCatch' && e.player === me2.id) caught = e; if (e.type === 'score' && e.player === me2.id) scored = e; }
  }
  assert.equal(hit, 'hit');
  assert.ok(caught, 'he catches it in the air');
  assert.ok(scored && scored.oop, `and finishes the alley-oop (${scored?.kind})`);
});

test('the wrong button, or no press, is a mistimed jump: the ball comes off his hands, a loose ball, no finish', () => {
  for (const mode of ['wrong', 'late']) {
    const g = game(11, { human: true }), me = g.players[0], h = g.players[1];
    breakSetup(g, h, me);
    g.startPass(h, { target: me.id, type: 'alley' });
    let res = null, miss = null, caught = null, failedJump = false;
    for (let i = 0; i < 60 * 4 && !miss; i++) {
      g.step(1 / 60);
      const q = me.oopQte;
      if (mode === 'wrong' && q && !q.result && g.time - q.t0 >= q.open + 0.02) res = g.oopInput(me, (q.btn + 1) % 4);
      if (me.action?.type === 'oop' && me.action.failed) failedJump = true;
      for (const e of g.events) { if (e.type === 'oopMiss' && e.player === me.id) miss = e; if (e.type === 'oopCatch' && e.player === me.id) caught = e; if (mode === 'late' && e.type === 'oopQte') res = e.result; }
    }
    assert.equal(res, mode, `${mode}: result`);
    assert.ok(failedJump, `${mode}: the jump is marked mistimed`);
    assert.ok(miss && miss.why === mode, `${mode}: off the hands (or over his head)`);
    assert.equal(me.oopQte, null, 'the press is cleared');
    // it comes down as a loose ball: nobody catches it as a pass
    for (let i = 0; i < 60 * 2 && g.ball.kind !== 'loose' && g.ball.mode === 'flight'; i++) { g.step(1 / 60); for (const e of g.events) if (e.type === 'oopCatch' && e.player === me.id) caught = e; }
    assert.equal(caught, null, `${mode}: no catch`);
    assert.ok(g.ball.kind === 'loose' || g.ball.holder !== me.id, `${mode}: a loose ball (${g.ball.kind}, holder ${g.ball.holder})`);
  }
  // an AI receiver has no press to make: the alley-oop runs as before
  const g = game(12), h = g.players[0], r = g.players[1];
  breakSetup(g, h, r);
  g.startPass(h, { target: r.id, type: 'alley' });
  let caught = null;
  for (let i = 0; i < 60 * 4 && !caught; i++) { g.step(1 / 60); caught = g.events.find(e => e.type === 'oopCatch' && e.player === r.id); }
  assert.ok(caught && !r.oopQte, 'AI receiver catches it without a prompt');
});

test('input: the face buttons are read raw for the press (pad in any context, and the keys), with the right glyph', () => {
  const inp = Object.create(Input.prototype);
  Object.assign(inp, { down: new Set(), pressed: new Set(), released: new Set(), capturing: false, lastDevice: 'gamepad' });
  inp.applyBinds({});
  const btn = new Array(17).fill(false); btn[PAD.Y] = true;
  inp.gp = { connected: true, family: 'xbox', buttons: btn, prev: new Array(17).fill(false), values: [], axes: [0, 0, 0, 0], rs: newStickState() };
  inp.ctx = 'defense'; // (the context never matters for the press)
  assert.equal(inp.facePressed(), 3, 'Y = lob = 3');
  assert.match(inp.faceGlyph(3), /pad-glyph xbox b-y/);
  inp.gp.family = 'ps'; assert.match(inp.faceGlyph(0), /△|✕|○|□/);
  // keyboard: the pass key
  inp.lastDevice = 'keyboard'; inp.gp.connected = false;
  inp.pressed.add(inp.keymap.pass[0]);
  assert.equal(inp.facePressed(), 0);
  assert.match(inp.faceGlyph(0), /<kbd>/);
  // a captured (remapping) input reads nothing
  inp.capturing = true; assert.equal(inp.facePressed(), null);
});

test('in play: full-court park games now have lobs and alley-oops ahead on the break', () => {
  let oops = 0, lobs = 0, ahead = 0, games = 0, scoresOop = 0;
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const g = game(seed);
    for (let i = 0; i < 60 * 300 && !g.over; i++) { g.step(1 / 60); for (const e of g.events) if (e.type === 'score' && e.oop) scoresOop++; }
    oops += g.ai.stats.breakOop || 0; lobs += g.ai.stats.breakLob || 0; ahead += g.ai.stats.breakAhead || 0; games++;
  }
  assert.ok(oops + lobs + ahead > games, `${oops} alley-oops, ${lobs} lobs and ${ahead} passes ahead to runners in ${games} games (${scoresOop} alley-oop scores)`);
  // Pro-Am (ten men, longer floor): some of them go over the top
  let over = 0;
  for (const seed of [51, 52, 53]) {
    const rng = new RNG(seed);
    const g = new Game({ mode: 'proam', seed, rosters: [makeTeam(rng, 5, { catalog, level: 0.6 }), makeTeam(rng, 5, { catalog, level: 0.6 })], catalog, quarterLen: 150, quarters: 4, difficulty: 0.6 });
    for (let i = 0; i < 60 * 60 * 20 && !g.over; i++) g.step(1 / 60);
    over += (g.ai.stats.breakOop || 0) + (g.ai.stats.breakLob || 0);
  }
  assert.ok(over > 3, `${over} lobs and alley-oops over the top in 3 Pro-Am games`);
});
