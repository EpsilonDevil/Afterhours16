// v0.4.5 quick patch: right-stick dribble moves. The gesture detector is frame-rate independent, nothing you push
// gets lost, moves chain, and a tired or triple-threat player still does the move.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stickGesture, newStickState, STICK, Input } from '../client/js/core/input.js';
import { MatchSession } from '../client/js/game/session.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));

// feed a stick path (one [x, y] per frame) at a frame rate; collect what fired
function run(path, hz) {
  const s = newStickState(), out = [];
  for (const [x, y] of path) { const g = stickGesture(s, x, y, 1 / hz); if (g.flick || g.push || g.spin) out.push(g); }
  return out;
}
// a push from the middle to full over `ms` milliseconds, sampled at `hz`
const ramp = (ms, hz, dx = 1, dy = 0) => { const n = Math.max(1, Math.round(ms / 1000 * hz)); return [[0, 0], ...Array.from({ length: n }, (_, i) => [dx * (i + 1) / n, dy * (i + 1) / n]), [dx, dy], [dx, dy]]; };

test('a normal flick registers at any frame rate (the old detector needed it in one frame)', () => {
  for (const hz of [30, 60, 120, 144, 240]) for (const ms of [16, 40, 80, 120]) {
    const r = run(ramp(ms, hz), hz);
    assert.equal(r.length, 1, `${ms} ms flick at ${hz} Hz fires once`);
    assert.equal(r[0].flick, 'right', `${ms} ms flick at ${hz} Hz is a flick`);
  }
  // the old rule (from under 0.45 to over 0.7 between two frames) misses a 40 ms flick at 144 Hz
  const old = path => path.some((p, i) => i && Math.hypot(...p) > 0.7 && Math.hypot(...path[i - 1]) < 0.45);
  assert.equal(old(ramp(40, 144)), false);
  assert.equal(run(ramp(40, 144), 144)[0].flick, 'right');
});

test('a slow push is still a move on offense, but not a defensive reach; holding it out fires once', () => {
  const r = run(ramp(450, 60, 0, -1), 60);
  assert.equal(r.length, 1); assert.equal(r[0].push, 'up'); assert.equal(r[0].flick, null);
  const held = run([...ramp(40, 60), ...Array(120).fill([1, 0])], 60);
  assert.equal(held.length, 1, 'held out: no repeats');
  // back to the middle and again: fires again
  const twice = run([...ramp(40, 60), [0.1, 0], ...ramp(40, 60, -1, 0).slice(1)], 60);
  assert.deepEqual(twice.map(g => g.push), ['right', 'left']);
});

test('a sweep straight across fires the new direction; a half turn while held out is a spin', () => {
  const sweep = run([...ramp(40, 60, -1, 0), [-0.9, 0.05], [0.9, -0.05], [1, 0]], 60);
  assert.deepEqual(sweep.map(g => g.push), ['left', 'right']);
  // rotate 180° through the top while held out, over a third of a second at 120 Hz
  const turn = [...ramp(30, 120, 1, 0)];
  for (let i = 1; i <= 40; i++) { const a = -Math.PI * i / 40; turn.push([Math.cos(a), Math.sin(a)]); }
  const r = run(turn, 120);
  assert.ok(r.some(g => g.spin), 'spin');
  assert.ok(STICK.SPIN < Math.PI, 'a little under a half turn is enough');
});

function handler(seed = 3) {
  const rng = new RNG(seed), me = makeTeam(rng, 1, { catalog, level: 0.7 })[0];
  me.human = true;
  const g = new Game({ mode: 'practice', seed, rosters: [[me], []], catalog });
  const p = g.players[0];
  g.giveBall(p, 'held'); p.dribble.used = false;
  return { g, p };
}

test('any move out of triple threat starts the dribble; an exhausted player still does it, just slower', () => {
  for (const move of ['hesi', 'inout', 'btb', 'btl', 'cross', 'spin', 'stepback']) {
    const { g, p } = handler();
    g.setInput({ mx: 0, mz: 0, move }); g.step(1 / 60);
    assert.equal(p.action?.type, 'move', `${move} from triple threat`);
    assert.equal(g.ball.mode, 'dribble');
  }
  const fresh = handler(), tired = handler();
  tired.p.stamina = 0.01;
  for (const h of [fresh, tired]) { h.g.giveBall(h.p, 'dribble'); h.g.setInput({ mx: 0, mz: 0, move: 'cross' }); h.g.step(1 / 60); }
  assert.equal(tired.p.action?.type, 'move', 'not refused at 1% stamina');
  assert.ok(tired.p.action.dur > fresh.p.action.dur * 1.15, 'but slower');
});

test('moves come out quicker, more so with a better handle; they chain at 60%; combos are free, spam isn\'t', () => {
  const durFor = (handle, swb) => {
    const { g, p } = handler();
    p.ratings.ball_handle = handle; p.ratings.speed_with_ball = swb; p.moveSpeed = 1;
    g.giveBall(p, 'dribble'); g.setInput({ mx: 0, mz: 0, move: 'cross' }); g.step(1 / 60);
    return p.action.dur;
  };
  const slow = durFor(55, 55), fast = durFor(99, 99);
  assert.ok(slow < 0.4 * 0.85, `every move is quicker than v0.4.5's 0.4 s crossover (${slow.toFixed(3)} s)`);
  assert.ok(fast < slow * 0.8, `a 99 handle is quicker still (${fast.toFixed(3)} vs ${slow.toFixed(3)} s)`);
  // chain: a different move called 60% into the current one starts right away, and costs no stamina
  const { g, p } = handler();
  g.giveBall(p, 'dribble'); p.stamina = 1;
  g.setInput({ mx: 0, mz: 0, move: 'cross' }); g.step(1 / 60);
  const first = p.action, afterFirst = p.stamina;
  while (p.action === first && first.t < first.dur * 0.6) { g.setInput({ mx: 0, mz: 0 }); g.step(1 / 60); }
  g.setInput({ mx: 0, mz: 0, move: 'btb' }); g.step(1 / 60);
  assert.notEqual(p.action, first, 'the next move cancels into the current one');
  assert.equal(p.action.move, 'btb'); assert.equal(p.action.combo, 2);
  assert.ok(afterFirst - p.stamina < 0.005, 'a combo move is free');
  // spam: the same move over and over costs every time, and doubles the drain after three
  const s = handler();
  s.g.giveBall(s.p, 'dribble'); s.p.stamina = 1;
  for (let i = 0; i < 5; i++) {
    s.g.setInput({ mx: 0, mz: 0, move: 'cross' }); s.g.step(1 / 60);
    const a = s.p.action; while (s.p.action === a && a.t < a.dur * 0.6) { s.g.setInput({ mx: 0, mz: 0 }); s.g.step(1 / 60); }
  }
  assert.ok(1 - s.p.stamina > 0.2, `five crossovers in a row cost ${((1 - s.p.stamina) * 100).toFixed(0)}% stamina`);
  assert.ok(s.p.stam.moveK >= 2, 'and the drain doubles');
});

// the controls without a window: an Input with no listeners, driven by hand
function fakeInput() {
  const inp = Object.create(Input.prototype);
  Object.assign(inp, { down: new Set(), pressed: new Set(), released: new Set(), capturing: false, ctx: 'offense', deadzone: 0.15 });
  inp.applyBinds({});
  inp.gp = { connected: false, buttons: [], prev: [], values: [], axes: [0, 0, 0, 0], rs: newStickState(), dunkHeld: false };
  return inp;
}

// a drive that has to end in a layup (no dunk in the build), started with the attack bind and timed with it
function attackLayup(how, timing) {
  const { g, p } = handler(5);
  p.raw = { ...(p.raw || p.ratings), driving_dunk: 30, standing_dunk: 30 };
  const rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x, rim.z - side * 3.4, side > 0 ? 0 : Math.PI); p.vz = side * 4; g.giveBall(p, 'dribble');
  const inp = fakeInput(), sess = { input: inp, game: g, basis: { rx: 1, rz: 0, fx: 0, fz: 1 }, pend: { shoot: { ttl: 0.3, attack: true } }, defHands: null };
  const hold = on => { if (how === 'key') { if (on) inp.down.add('KeyZ'); else inp.down.delete('KeyZ'); } else { inp.gp.connected = true; inp.gp.dunkHeld = on; } };
  let grade = null, a = null;
  hold(true);
  for (let i = 0; i < 120 && !grade; i++) {
    if (a) hold(timing === 'tap' ? false : a.t + 1 / 60 < a.tRel);
    const it = MatchSession.prototype.stepIntent.call(sess);
    it.mz = side * 0.5;
    g.setInput(it); g.step(1 / 60);
    sess.pend = {};
    if (!a && p.action?.type === 'layup') a = p.action;
    for (const e of g.events) if (e.type === 'release') grade = e.grade;
  }
  return { grade, a };
}

test('attack bind: when a drive can only be a layup, holding the bind (key or right stick down) times it like the shoot button', () => {
  // holding the bind is holding the shot
  const inp = fakeInput(), sess = { input: inp, game: handler().g, basis: { rx: 1, rz: 0, fx: 0, fz: 1 }, pend: {}, defHands: null };
  const held = () => MatchSession.prototype.stepIntent.call(sess).shootHeld;
  assert.equal(held(), false);
  inp.down.add('KeyZ'); assert.equal(held(), true, 'dunk key held');
  inp.down.clear(); inp.gp.connected = true; inp.gp.dunkHeld = true; assert.equal(held(), true, 'right stick held down');
  inp.ctx = 'defense'; assert.equal(held(), false, 'not on defense');
  for (const how of ['key', 'stick']) {
    const t = attackLayup(how, 'timed');
    assert.equal(t.a?.type, 'layup', `${how}: no dunk in the build, so it's a layup`);
    assert.ok(!t.a.untimed);
    assert.equal(t.grade, 'excellent', `${how}: let go at the top for a green`);
    const tap = attackLayup(how, 'tap');
    assert.ok(tap.grade === 'vearly' || tap.grade === 'early', `${how}: let go on the gather comes out ${tap.grade}`);
  }
});
