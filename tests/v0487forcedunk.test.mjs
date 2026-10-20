// v0.4.8.7 the forced dunk (David: "add the ability to force a dunk on any build by holding R2 + right stick down + Square
// in combination while driving"). Sprint + right stick down + shoot (RT + right stick down + X; keyboard: sprint + the
// step-back key + shoot, as bound): any build dunks it on a drive in range, through the usual dunk (his own package, or a
// basic one if he can't normally dunk), made or missed by the usual dunk make chance and contest. Never a dribble move or
// a jumper; two of the three do what they always did; out of range it's the usual drive; the AI never does it; it goes
// over the wire in the intent (forceDunk) so every screen plays it the same; and nothing changes when it isn't used.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shotTypeFor, finalChance, FORCE_DUNK } from '../client/js/sim/shots.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { blankIntent } from '../client/js/sim/player.js';
import { normIntent, intentDelta, applyDelta } from '../client/js/sim/wire.js';
import { RNG } from '../client/js/core/rng.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const catalog = Object.fromEntries(JSON.parse(src('server/catalog.json')).map(i => [i.id, i]));

// a practice game with one human: a poor dunker (40 Driving / Standing Dunk, a low vertical) with a better layup
function setup(seed = 4, { dunk = 40, layup = 80, vertical = 40, d = 3, speed = 5, human = true } = {}) {
  const rng = new RNG(seed), me = makeTeam(rng, 1, { catalog, level: 0.6 })[0];
  me.human = human;
  me.build.attributes = { ...me.build.attributes, driving_dunk: dunk, standing_dunk: dunk, layup, vertical };
  const g = new Game({ mode: 'practice', seed, rosters: [[me], []], catalog });
  const p = g.players[0], rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x, rim.z - side * d, side > 0 ? 0 : Math.PI); p.vz = side * speed; g.giveBall(p, 'dribble');
  return { g, p, rim, side };
}
const press = (g, side, extra) => { g.setInput({ ...blankIntent(), mx: 0, mz: side, sprint: true, shoot: 'press', attack: true, shootHeld: true, ...extra }); g.step(1 / 60); };

test('the combo dunks for a build that would lay it up; the same press without it still lays it up', () => {
  { const { g, p, side } = setup(); press(g, side, {}); assert.equal(p.action?.type, 'layup', 'the attack bind alone: his better finish'); }
  { const { g, p, side } = setup(); press(g, side, { forceDunk: true }); assert.equal(p.action?.type, 'dunk', 'forced'); assert.ok(['power', 'onehand'].includes(p.action.style), `a basic dunk (${p.action.style})`); }
  // any build: short, no bounce, no dunk rating at all
  { const { g, p, side } = setup(9, { dunk: 25, vertical: 25 }); p.phys.vertical = 0.35; press(g, side, { forceDunk: true }); assert.equal(p.action?.type, 'dunk'); assert.ok(p.action.jumpH >= 3.05 + 0.22 - p.phys.reach - 1e-6, 'he gets up to the rim'); }
  // a build that can dunk dunks it with his own package
  { const { g, p, side } = setup(5, { dunk: 95, layup: 99, vertical: 90 }); p.phys.vertical = Math.max(p.phys.vertical, 3.4 - p.phys.reach); press(g, side, { forceDunk: true }); assert.equal(p.action?.type, 'dunk'); }
  // right under the rim, slow: a standing dunk
  { const { g, p, side } = setup(6, { d: 1.0, speed: 0.4 }); press(g, side, { forceDunk: true }); assert.equal(p.action?.type, 'dunk'); assert.equal(p.action.standing, true); }
});

test('it doesn\'t fire away from the rim, or when not driving at it, and the AI never does it', () => {
  // too far out: the usual attack (keep driving), never a long-range teleport dunk or a jumper
  { const { g, p, side } = setup(4, { d: 7.5 }); press(g, side, { forceDunk: true }); assert.ok(!['dunk', 'layup', 'shoot'].includes(p.action?.type), `from 7.5 m: ${p.action?.type}`); assert.equal(g.ball.holder, p.id); }
  { const { g, p, side } = setup(4, { d: FORCE_DUNK.range + 0.4 }); press(g, side, { forceDunk: true }); assert.notEqual(p.action?.type, 'dunk'); }
  // standing still a few metres out (not a drive): the usual finish
  { const { g, p, side } = setup(4, { d: 3, speed: 0 }); press(g, side, { forceDunk: true }); assert.notEqual(p.action?.type, 'dunk'); }
  // the AI: the field is ignored
  { const { g, p, side } = setup(4, { human: false }); const it = { ...blankIntent(), mx: 0, mz: side, sprint: true, shoot: 'press', attack: true, forceDunk: true }; g.startShot(p, it); assert.equal(p.action?.type, 'layup'); }
  // shotTypeFor: the combo needs the attack (it's the attack bind's press) and the reach
  const dr = (d, speed) => ({ entry: { build: { archetype: 'playmaker' } }, raw: { driving_dunk: 30, standing_dunk: 30, layup: 80 }, ratings: { driving_dunk: 30, standing_dunk: 30, layup: 80 }, phys: { reach: 2.5, vertical: 0.4 }, badges: {}, stamina: 1, x: 0, z: 0, vx: 0, vz: speed, _d: d });
  const t = (p, ctx) => shotTypeFor(p, { x: 0, z: p._d }, { defs: [], ...ctx }).type;
  assert.equal(t(dr(3, 5), { attack: true, forceDunk: true }), 'dunk');
  assert.equal(t(dr(3, 5), { attack: true }), 'layup');
  assert.equal(t(dr(3, 5), { forceDunk: true }), 'layup', 'not without the attack press');
  assert.equal(t(dr(6, 5), { attack: true, forceDunk: true }), 'none');
  assert.equal(t({ ...dr(3, 5), vz: -5 }, { attack: true, forceDunk: true }), 'layup', 'running away from the rim');
});

test('made or missed by the dunk\'s own make chance and contest: a poor dunker misses more than a great one', () => {
  const rate = (dunk, n = 36) => {
    let made = 0, tried = 0;
    for (let s = 0; s < n; s++) {
      const { g, p, side } = setup(100 + s, { dunk, vertical: dunk });
      press(g, side, { forceDunk: true });
      if (p.action?.type !== 'dunk') continue;
      tried++;
      // (practice keeps no score: the slam says whether it went down; a blocked dunk never gets to the slam)
      let slam = null;
      for (let f = 0; f < 150 && !slam; f++) { g.setInput({ ...blankIntent() }); g.step(1 / 60); slam = g.events.find(e => e.type === 'slam' || e.type === 'block' || e.type === 'release') || null; }
      if (slam?.type === 'slam' && slam.made) made++; // (a block, or a release short of the rim, is no dunk)
    }
    return { made, tried };
  };
  const lo = rate(30), hi = rate(95);
  assert.ok(lo.tried > 30 && hi.tried > 30, `forced every time (${lo.tried}, ${hi.tried})`);
  // (open: no contest at all. A 95 never misses a wide-open dunk; a 30 does, some of the time. The seeds are fixed, so
  // this is the same every run. With a defender in the way the dunk is stopped or blocked by the usual drive and block
  // checks, the same as anyone's)
  assert.ok(hi.made === hi.tried && lo.made < lo.tried, `95 dunk ${hi.made}/${hi.tried} vs 30 dunk ${lo.made}/${lo.tried}`);
  // (the model itself: the dunk's chance from his rating)
  const a = r => ({ driving_dunk: r, standing_dunk: r, close_shot: 60, layup: 70 });
  assert.ok(finalChance({ type: 'dunk', d: 0.5, a: a(30), contest: 0.3, stamina: 1, badges: {}, traffic: 0.3 }) < finalChance({ type: 'dunk', d: 0.5, a: a(95), contest: 0.3, stamina: 1, badges: {}, traffic: 0.8 }));
  // deterministic: the same game and the same presses play out the same
  const play = () => { const { g, p, side } = setup(77); press(g, side, { forceDunk: true }); for (let f = 0; f < 200; f++) { g.setInput({ ...blankIntent() }); g.step(1 / 60); } return JSON.stringify([p.action?.type, g.score, g.ball.x.toFixed(4), g.ball.z.toFixed(4), p.stats]); };
  assert.equal(play(), play());
});

// ---- the controls: the combo read from the keyboard and a pad, as bound (game/session.js captureInput / stepIntent) ----
function session(binds) {
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, setAttribute() {} });
  globalThis.window = globalThis.window || { addEventListener() {}, matchMedia: () => ({ matches: false }), location: { search: '' } };
  globalThis.document = globalThis.document || { documentElement: el(), body: el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: el, getElementById: () => null, hidden: false };
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
  globalThis.location = globalThis.location || { search: '' };
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  return Promise.all([import('../client/js/game/session.js'), import('../client/js/core/input.js')]).then(([S, I]) => {
    const inp = new I.Input({ addEventListener() {} });
    if (binds) inp.applyBinds(binds);
    const { g, p } = setup(4);
    const basis = { rx: 1, rz: 0, fx: 0, fz: 1 };
    const s = Object.assign(Object.create(S.MatchSession.prototype), { input: inp, game: g, pend: {}, online: null, basis, rig: { inputBasis: () => basis }, hud: { setHint() {}, pushFeed() {} }, celebrateReq: null, defHands: null });
    s.stickBasis = () => basis;
    const frame = () => { s.captureInput(); const it = s.stepIntent(); inp.endFrame(); return it; };
    const key = (code, down = true) => { if (down) { inp.pressed.add(code); inp.down.add(code); } else inp.down.delete(code); };
    return { s, inp, g, p, frame, key, I };
  });
}

test('keyboard: sprint + step-back key + shoot is the forced dunk; two of the three do what they always did', async () => {
  // all three: the forced dunk press, no step-back move, no jumper
  { const { s, key, frame } = await session(); key('ShiftLeft'); key('ArrowDown'); key('Space'); const it = frame(); assert.equal(it.forceDunk, true); assert.equal(it.attack, true); assert.equal(it.shoot, 'press'); assert.equal(it.move, null); assert.ok(!s.pend.move); }
  // sprint + shoot, no stick: a normal shot press (no forced dunk)
  { const { key, frame } = await session(); key('ShiftLeft'); key('Space'); const it = frame(); assert.ok(!it.forceDunk); assert.equal(it.shoot, 'press'); assert.ok(!it.attack); }
  // sprint + the step-back key, no shoot: the step-back, as before
  { const { key, frame } = await session(); key('ShiftLeft'); key('ArrowDown'); const it = frame(); assert.ok(!it.forceDunk); assert.equal(it.move, 'stepback'); assert.equal(it.shoot, null); }
  // the stick and shoot without sprint: nothing new
  { const { key, frame } = await session(); key('ArrowDown'); key('Space'); const it = frame(); assert.ok(!it.forceDunk); }
  // rebound: shoot on J, sprint on Ctrl: the combo follows the binds
  { const { key, frame } = await session({ key: { shoot: 'KeyJ', sprint: 'ControlLeft' } }); key('ControlLeft'); key('ArrowDown'); key('KeyJ'); assert.equal(frame().forceDunk, true); }
  { const { key, frame } = await session({ key: { shoot: 'KeyJ' } }); key('ShiftLeft'); key('ArrowDown'); key('Space'); assert.ok(!frame().forceDunk, 'the old key no longer does it'); }
});

test('controller: R2 / RT + right stick down + Square / X is the forced dunk; without the shoot button it\'s the attack bind as before', async () => {
  const pad = (inp, { rt, x, down }) => {
    const g = inp.gp; g.connected = true; g.buttons = Array(17).fill(false); g.prev = Array(17).fill(false);
    g.buttons[7] = !!rt; g.buttons[2] = !!x; g.axes = [0, 0, 0, down ? 0.95 : 0];
    g.dunkHeld = !!(rt && down); g.dunkEdge = false; g.flick = null; g.push = null; // (as pollGamepad leaves them: RS down while sprinting is the attack bind)
  };
  { const { inp, frame } = await session(); inp.ctx = 'offense'; pad(inp, { rt: true, x: true, down: true }); const it = frame(); assert.equal(it.forceDunk, true); assert.equal(it.move, null); }
  { const { inp, frame } = await session(); inp.ctx = 'offense'; pad(inp, { rt: true, down: true }); const it = frame(); assert.ok(!it.forceDunk); assert.equal(it.attack, true, 'the attack bind, as before'); }
  { const { inp, frame } = await session(); inp.ctx = 'offense'; pad(inp, { rt: true, x: true }); const it = frame(); assert.ok(!it.forceDunk); }
  { const { inp, frame } = await session(); inp.ctx = 'offense'; pad(inp, { x: true, down: true }); const it = frame(); assert.ok(!it.forceDunk); }
  // rebound: shoot on A (and pass on X): the combo follows
  { const { inp, frame } = await session({ pad: { shoot: 'A', pass: 'X' } }); inp.ctx = 'offense'; const g = inp.gp; pad(inp, { rt: true, down: true }); g.buttons[0] = true; assert.equal(frame().forceDunk, true); }
  // the controls list shows it
  const sc = src('client/js/ui/screens.js');
  assert.ok(sc.includes("['Force a dunk — any build, on a drive to the rim (the dunk can still miss or get blocked)', `${K('sprint')} + ${K('stickDown')} + ${K('shoot')}, held`, `${P('sprint')} + ${G('RS')} down + ${P('shoot')}, held`]"));
});

test('over the wire: the field goes out, comes back and is cleared once used; blank when not pressed', () => {
  const it = { ...blankIntent(), mx: 0.3, mz: 0.9, sprint: true, shoot: 'press', attack: true, shootHeld: true, forceDunk: true, seq: { shoot: 7 } };
  const n = normIntent(it);
  assert.equal(n.forceDunk, true);
  assert.ok(!('forceDunk' in normIntent({ ...it, forceDunk: false })), 'blank is left out');
  const prev = normIntent(blankIntent()), d = intentDelta(prev, n);
  assert.equal(d.forceDunk, true);
  assert.deepEqual(applyDelta(prev, d), n);
  assert.deepEqual(applyDelta(n, intentDelta(n, normIntent({ ...it, forceDunk: false }))).forceDunk, undefined, 'and back off');
  assert.equal(blankIntent().forceDunk, false);
  // online: a press already used is dropped from the ticks after (multiIntent), the forced dunk with it
  const { g, p } = setup(4);
  g.humanIntents = new Map([[p.id, n]]); p.usedSeq = 7;
  const m = g.multiIntent(p);
  assert.equal(m.shoot, null); assert.equal(m.forceDunk, false);
  p.usedSeq = 6; assert.equal(g.multiIntent(p).forceDunk, true);
});

test('without the combo nothing changes: the finish picked for every drive is the same as before', () => {
  // (the field is only read inside the attack's choice, and only when it's true: here every kind of driver, near and far,
  // fast and slow, with and without the attack bind and sprint, gets the same answer with it off as with no field at all.
  // sim_batch's FG% and dunks per game, park and Pro-Am, came out identical with and without this change)
  const r = new RNG(12);
  for (let i = 0; i < 600; i++) {
    const rt = { driving_dunk: r.int(25, 99), standing_dunk: r.int(25, 99), layup: r.int(25, 99), mid_range: r.int(25, 99), close_shot: r.int(25, 99) };
    const ang = r.range(-1, 1) * Math.PI, sp = r.range(0, 7), d = r.range(0.3, 9);
    const p = { entry: { build: { archetype: ['slasher', 'playmaker', 'glass_cleaner', 'sharpshooter'][i % 4] } }, raw: { ...rt }, ratings: { ...rt }, phys: { reach: r.range(2.4, 2.8), vertical: r.range(0.3, 1.1) }, badges: {}, stamina: r.range(0.1, 1), x: 0, z: 0, vx: Math.sin(ang) * sp, vz: Math.cos(ang) * sp };
    const ctx = { attack: i % 3 === 0, sprint: i % 2 === 0, defs: [] };
    assert.deepEqual(shotTypeFor(p, { x: 0, z: d }, { ...ctx, forceDunk: false }), shotTypeFor(p, { x: 0, z: d }, ctx));
  }
  // and the AI's intents never carry it
  assert.ok(!src('client/js/sim/ai.js').includes('forceDunk'));
});
