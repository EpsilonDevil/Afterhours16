// v0.4.8.7 the forced dunk and (quick patch 7) the forced layup. David, qp7: "get rid of the force dunk keybind, make
// 'attack the rim' force dunks, and make driving while holding the shoot button force layups".
//  * Attack the rim (the dunk bind: Z on the keyboard, or the right stick held down while sprinting) is the forced dunk:
//    any build dunks it on a drive in range (sim/shots.js FORCE_DUNK, about 4.2 m), through the usual dunk (his own
//    package, or a basic one- or two-hand dunk if he can't normally dunk), made or missed by the usual dunk make chance
//    and contest. Out of range it's still a drive to the rim (held, it keeps driving until it's in range).
//  * Shoot pressed while sprinting at the rim (FORCE_LAYUP: moving at it faster than 1.2 m/s inside the layup range, or
//    right under it) is the forced layup: never a dunk, a jumper or a pump fake, and timed with the button like any
//    layup. Anywhere else the press is the usual shot (jumpers and pump fakes as before).
//  * The old R2 + right stick down + Square combo is gone.
//  * Both are a person's alone (the AI never does either), both go over the wire in the intent (forceDunk, forceLayup)
//    so every screen plays them the same, and nothing changes when neither is used.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shotTypeFor, finalChance, FORCE_DUNK, FORCE_LAYUP } from '../client/js/sim/shots.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { blankIntent } from '../client/js/sim/player.js';
import { normIntent, intentDelta, applyDelta } from '../client/js/sim/wire.js';
import { RNG } from '../client/js/core/rng.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const catalog = Object.fromEntries(JSON.parse(src('server/catalog.json')).map(i => [i.id, i]));

// a practice game with one human: by default a poor dunker (40 Driving / Standing Dunk, a low vertical) with a better
// layup, driving at the rim from 3 m at 5 m/s
function setup(seed = 4, { dunk = 40, layup = 80, vertical = 40, mid = null, d = 3, speed = 5, human = true } = {}) {
  const rng = new RNG(seed), me = makeTeam(rng, 1, { catalog, level: 0.6 })[0];
  me.human = human;
  me.build.attributes = { ...me.build.attributes, driving_dunk: dunk, standing_dunk: dunk, layup, vertical, ...(mid != null ? { mid_range: mid } : {}) };
  const g = new Game({ mode: 'practice', seed, rosters: [[me], []], catalog });
  const p = g.players[0], rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x, rim.z - side * d, side > 0 ? 0 : Math.PI); p.vz = side * speed; g.giveBall(p, 'dribble');
  return { g, p, rim, side };
}
// the attack bind's press (forceDunk is what session.js puts on it), and the shoot button's press while sprinting
const attack = (g, side, extra) => { g.setInput({ ...blankIntent(), mx: 0, mz: side, sprint: true, shoot: 'press', attack: true, shootHeld: true, forceDunk: true, ...extra }); g.step(1 / 60); };
const shoot = (g, side, extra) => { g.setInput({ ...blankIntent(), mx: 0, mz: side, sprint: true, shoot: 'press', shootHeld: true, forceLayup: true, ...extra }); g.step(1 / 60); };
// a stand-in driver for shotTypeFor: d metres out, moving at the rim at `speed`
const dr = (d, speed, r = {}) => { const rt = { driving_dunk: 30, standing_dunk: 30, layup: 80, mid_range: 50, ...r }; return { entry: { build: { archetype: 'playmaker' } }, raw: rt, ratings: rt, phys: { reach: 2.5, vertical: r.vertical ?? 0.4 }, badges: {}, stamina: 1, x: 0, z: 0, vx: 0, vz: speed, _d: d }; };
const t = (p, ctx) => shotTypeFor(p, { x: 0, z: p._d }, { defs: [], ...ctx }).type;

// ---------------- attack the rim: the forced dunk ----------------
test('attack the rim dunks for any build, even one that would lay it up; without the forced flag (the AI\'s attack) it is the better finish', () => {
  { const { g, p, side } = setup(); attack(g, side, { forceDunk: false }); assert.equal(p.action?.type, 'layup', 'the attack alone (as the AI plays it): his better finish'); }
  { const { g, p, side } = setup(); attack(g, side); assert.equal(p.action?.type, 'dunk', 'forced'); assert.ok(['power', 'onehand'].includes(p.action.style), `a basic dunk (${p.action.style})`); }
  // any build: short, no bounce, no dunk rating at all
  { const { g, p, side } = setup(9, { dunk: 25, vertical: 25 }); p.phys.vertical = 0.35; attack(g, side); assert.equal(p.action?.type, 'dunk'); assert.ok(p.action.jumpH >= 3.05 + 0.22 - p.phys.reach - 1e-6, 'he gets up to the rim'); }
  // a build that can dunk dunks it with his own package
  { const { g, p, side } = setup(5, { dunk: 95, layup: 99, vertical: 90 }); p.phys.vertical = Math.max(p.phys.vertical, 3.4 - p.phys.reach); attack(g, side); assert.equal(p.action?.type, 'dunk'); }
  // right under the rim, slow: a standing dunk
  { const { g, p, side } = setup(6, { d: 1.0, speed: 0.4 }); attack(g, side); assert.equal(p.action?.type, 'dunk'); assert.equal(p.action.standing, true); }
});

test('out of range it is still a drive to the rim: held, it keeps driving into range (no layup just outside it); the AI never forces it', () => {
  // too far out: keep driving, never a long-range teleport dunk, a layup or a jumper
  { const { g, p, side } = setup(4, { d: 7.5 }); attack(g, side); assert.ok(!['dunk', 'layup', 'shoot'].includes(p.action?.type), `from 7.5 m: ${p.action?.type}`); assert.equal(g.ball.holder, p.id); }
  { const { g, p, side } = setup(4, { d: FORCE_DUNK.range + 0.4 }); attack(g, side); assert.ok(!['dunk', 'layup', 'shoot'].includes(p.action?.type)); }
  // just outside the dunk's range, still driving at it: keep going (the old attack took the layup here, short of the dunk)
  assert.equal(t(dr(FORCE_DUNK.range + 0.1, 5), { attack: true, forceDunk: true }), 'none');
  assert.equal(t(dr(FORCE_DUNK.range + 0.1, 5), { attack: true }), 'layup', '(the attack without it, as before)');
  assert.equal(t(dr(FORCE_DUNK.range - 0.1, 5), { attack: true, forceDunk: true }), 'dunk');
  // a dunker's long-gather dunk from out there still goes
  const big = { ...dr(5.2, 5, { driving_dunk: 95, standing_dunk: 95, layup: 60, vertical: 0.9 }) };
  assert.equal(t(big, { attack: true, forceDunk: true }), 'dunk');
  // a held bind on a drive in from 7 m: driving, driving... the dunk once in range
  { const { g, p, side } = setup(8, { d: 7 }); let a = null; for (let f = 0; f < 120 && !a; f++) { attack(g, side); a = ['dunk', 'layup', 'shoot'].includes(p.action?.type) ? p.action : null; }
    assert.equal(a?.type, 'dunk', `held from 7 m: ${a?.type}`); }
  // standing still a few metres out (not a drive): the usual finish
  { const { g, p, side } = setup(4, { d: 3, speed: 0 }); attack(g, side); assert.notEqual(p.action?.type, 'dunk'); }
  // running away from the rim: no dunk
  assert.equal(t({ ...dr(3, 5), vz: -5 }, { attack: true, forceDunk: true }), 'layup');
  // the AI: the field is ignored
  { const { g, p, side } = setup(4, { human: false }); g.startShot(p, { ...blankIntent(), mx: 0, mz: side, sprint: true, shoot: 'press', attack: true, forceDunk: true }); assert.equal(p.action?.type, 'layup'); }
  // it's the attack bind's press: not a shot press's
  assert.equal(t(dr(3, 5), { forceDunk: true }), 'layup');
});

test('made or missed by the dunk\'s own make chance and contest: a poor dunker misses more than a great one', () => {
  const rate = (dunk, n = 36) => {
    let made = 0, tried = 0;
    for (let s = 0; s < n; s++) {
      const { g, p, side } = setup(100 + s, { dunk, vertical: dunk });
      attack(g, side);
      if (p.action?.type !== 'dunk') continue;
      tried++;
      // (practice keeps no score: the slam says whether it went down; a blocked dunk never gets to the slam)
      let slam = null;
      for (let f = 0; f < 150 && !slam; f++) { g.setInput({ ...blankIntent() }); g.step(1 / 60); slam = g.events.find(e => e.type === 'slam' || e.type === 'block' || e.type === 'release') || null; }
      if (slam?.type === 'slam' && slam.made) made++;
    }
    return { made, tried };
  };
  const lo = rate(30), hi = rate(95);
  assert.ok(lo.tried > 30 && hi.tried > 30, `forced every time (${lo.tried}, ${hi.tried})`);
  // (open: no contest. A 95 never misses a wide-open dunk; a 30 does, some of the time. Fixed seeds: the same every run)
  assert.ok(hi.made === hi.tried && lo.made < lo.tried, `95 dunk ${hi.made}/${hi.tried} vs 30 dunk ${lo.made}/${lo.tried}`);
  const a = r => ({ driving_dunk: r, standing_dunk: r, close_shot: 60, layup: 70 });
  assert.ok(finalChance({ type: 'dunk', d: 0.5, a: a(30), contest: 0.3, stamina: 1, badges: {}, traffic: 0.3 }) < finalChance({ type: 'dunk', d: 0.5, a: a(95), contest: 0.3, stamina: 1, badges: {}, traffic: 0.8 }));
  const play = () => { const { g, p, side } = setup(77); attack(g, side); for (let f = 0; f < 200; f++) { g.setInput({ ...blankIntent() }); g.step(1 / 60); } return JSON.stringify([p.action?.type, g.score, g.ball.x.toFixed(4), g.ball.z.toFixed(4), p.stats]); };
  assert.equal(play(), play());
});

// ---------------- shoot while driving: the forced layup ----------------
test('shoot while sprinting at the rim is a layup for every build: never the dunk, the pull-up or the standing dunk it would have been', () => {
  // a great dunker on a sprint drive: the shot press dunks it; the forced layup lays it in
  const hops = { dunk: 95, layup: 60, vertical: 95 };
  { const { g, p, side } = setup(5, hops); p.phys.vertical = Math.max(p.phys.vertical, 3.4 - p.phys.reach); shoot(g, side, { forceLayup: false }); assert.equal(p.action?.type, 'dunk', 'without it: his dunk'); }
  { const { g, p, side } = setup(5, hops); p.phys.vertical = Math.max(p.phys.vertical, 3.4 - p.phys.reach); shoot(g, side); assert.equal(p.action?.type, 'layup', 'forced'); }
  // a shooter walled off in the lane would pull up: forced, he lays it up
  const wall = { ratings: { block: 50 }, phys: { reach: 2.6 }, x: 0, z: 0.8, action: null };
  const sh = dr(3.6, 4, { mid_range: 99, layup: 50 });
  assert.equal(shotTypeFor(sh, { x: 0, z: sh._d }, { sprint: true, defs: [wall] }).type, 'jumper', 'without it: the pull-up');
  assert.equal(shotTypeFor(sh, { x: 0, z: sh._d }, { sprint: true, forceLayup: true, defs: [wall] }).type, 'layup');
  // right under the rim with sprint held, a big's standing dunk: forced, a layup
  const bigU = dr(1.0, 0.2, { standing_dunk: 95, vertical: 0.9 });
  assert.equal(t(bigU, { sprint: true }), 'dunk'); assert.equal(t(bigU, { sprint: true, forceLayup: true }), 'layup');
  // anywhere in the range, driving: a layup; just past it, or not driving, the usual shot
  for (const d of [1.0, 2.0, 3.0, 4.0, FORCE_LAYUP.range - 0.05]) assert.equal(t(dr(d, 3), { sprint: true, forceLayup: true }), 'layup', `${d} m`);
  assert.equal(t(dr(FORCE_LAYUP.range + 0.3, 5), { sprint: true, forceLayup: true }), 'jumper', 'out of range: a jumper as before');
  assert.equal(t(dr(3, 1.0), { sprint: true, forceLayup: true }), t(dr(3, 1.0), { sprint: true }), 'not driving (1 m/s): as before');
  assert.equal(t({ ...dr(3, 5), vz: -5 }, { sprint: true, forceLayup: true }), 'jumper', 'running away: a fade, as before');
  // a step-back is still a jumper
  assert.equal(t(dr(3, 5), { sprint: true, forceLayup: true, forceJumper: true }), 'jumper');
  // the AI: the field is ignored
  { const { g, p, side } = setup(5, { ...hops, human: false }); p.phys.vertical = Math.max(p.phys.vertical, 3.4 - p.phys.reach); g.startShot(p, { ...blankIntent(), mx: 0, mz: side, sprint: true, shoot: 'press', forceLayup: true }); assert.equal(p.action?.type, 'dunk'); }
});

test('the forced layup is timed with the button like any layup, and a tap is an early layup, never a pump fake', () => {
  const run = timing => {
    const { g, p, side } = setup(5, { dunk: 95, layup: 80, vertical: 95 }); p.phys.vertical = Math.max(p.phys.vertical, 3.4 - p.phys.reach);
    shoot(g, side);
    const a = p.action; assert.equal(a?.type, 'layup');
    let grade = null, pump = false;
    for (let i = 0; i < 150 && !grade; i++) {
      const held = timing === 'tap' ? false : a.t + 1 / 60 < a.tRel;
      g.setInput({ ...blankIntent(), mx: 0, mz: side * 0.5, sprint: true, shootHeld: held }); g.step(1 / 60);
      for (const e of g.events) { if (e.type === 'release') grade = e.grade; if (e.type === 'pumpfake') pump = true; }
    }
    return { grade, pump, untimed: a.untimed };
  };
  const timed = run('timed'), tap = run('tap');
  assert.ok(!timed.untimed);
  assert.equal(timed.grade, 'excellent', 'let go at the top: a green');
  assert.ok(tap.grade === 'vearly' || tap.grade === 'early', `let go on the gather: ${tap.grade}`);
  assert.ok(!timed.pump && !tap.pump, 'never a pump fake');
});

// ---- the controls (game/session.js captureInput / stepIntent), as bound ----
function session(binds, opts = {}) {
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, setAttribute() {} });
  globalThis.window = globalThis.window || { addEventListener() {}, matchMedia: () => ({ matches: false }), location: { search: '' } };
  globalThis.document = globalThis.document || { documentElement: el(), body: el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: el, getElementById: () => null, hidden: false };
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
  globalThis.location = globalThis.location || { search: '' };
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  return Promise.all([import('../client/js/game/session.js'), import('../client/js/core/input.js')]).then(([S, I]) => {
    const inp = new I.Input({ addEventListener() {} });
    if (binds) inp.applyBinds(binds);
    const { g, p } = setup(4, opts);
    const basis = { rx: 1, rz: 0, fx: 0, fz: 1 };
    const s = Object.assign(Object.create(S.MatchSession.prototype), { input: inp, game: g, pend: {}, online: null, basis, rig: { inputBasis: () => basis }, hud: { setHint() {}, pushFeed() {} }, celebrateReq: null, defHands: null });
    s.stickBasis = () => basis;
    const frame = () => { s.captureInput(); const it = s.stepIntent(); inp.endFrame(); return it; };
    const key = (code, down = true) => { if (down) { inp.pressed.add(code); inp.down.add(code); } else inp.down.delete(code); };
    return { s, inp, g, p, frame, key, I };
  });
}

test('keyboard: the dunk key (pressed or held) is the forced dunk; shoot while sprinting is the forced layup; the old combo is gone', async () => {
  { const { key, frame } = await session(); key('KeyZ'); const it = frame(); assert.equal(it.attack, true); assert.equal(it.forceDunk, true); assert.equal(it.shoot, 'press'); assert.ok(!it.forceLayup); }
  { const { inp, frame } = await session(); inp.down.add('KeyZ'); const it = frame(); assert.equal(it.forceDunk, true, 'held: still asking'); }
  { const { key, frame } = await session(); key('ShiftLeft'); key('Space'); const it = frame(); assert.equal(it.shoot, 'press'); assert.equal(it.forceLayup, true); assert.ok(!it.forceDunk); assert.ok(!it.attack); }
  // shoot without sprint: the usual shot press (a jumper, a pump fake...)
  { const { key, frame } = await session(); key('Space'); const it = frame(); assert.equal(it.shoot, 'press'); assert.ok(!it.forceLayup && !it.forceDunk); }
  // sprint + the step-back key + shoot, the old combo: no forced dunk any more (the step-back, and the shot press)
  { const { s, key, frame } = await session(); key('ShiftLeft'); key('ArrowDown'); key('Space'); const it = frame(); assert.ok(!it.forceDunk); assert.ok(!it.attack); assert.equal(it.move, 'stepback'); }
  // the binds: shoot on J, sprint on Ctrl, attack on V
  { const { key, frame } = await session({ key: { shoot: 'KeyJ', sprint: 'ControlLeft' } }); key('ControlLeft'); key('KeyJ'); assert.equal(frame().forceLayup, true); }
  { const { key, frame } = await session({ key: { dunk: 'KeyV' } }); key('KeyV'); assert.equal(frame().forceDunk, true); }
  // the input has no combo reader any more
  const { I } = await session();
  assert.equal(I.Input.prototype.forceDunkHeld, undefined);
  assert.ok(!src('client/js/core/input.js').includes('forceDunkHeld') && !src('client/js/game/session.js').includes('forceDunkHeld'));
});

test('controller: RT / R2 + right stick down is the forced dunk; X / Square while sprinting the forced layup; the shoot button no longer changes the stick', async () => {
  const pad = (inp, { rt, x, down }) => {
    const g = inp.gp; g.connected = true; g.buttons = Array(17).fill(false); g.prev = Array(17).fill(false);
    g.buttons[7] = !!rt; g.buttons[2] = !!x; g.axes = [0, 0, 0, down ? 0.95 : 0];
    g.dunkHeld = !!(rt && down); g.dunkEdge = false; g.flick = null; g.push = null; // (as pollGamepad leaves them)
  };
  { const { inp, frame } = await session(); inp.ctx = 'offense'; pad(inp, { rt: true, down: true }); const it = frame(); assert.equal(it.attack, true); assert.equal(it.forceDunk, true); }
  { const { inp, frame } = await session(); inp.ctx = 'offense'; pad(inp, { rt: true, x: true, down: true }); const it = frame(); assert.equal(it.forceDunk, true, 'the attack bind, with or without the shoot button'); assert.ok(!it.forceLayup); }
  { const { inp, frame } = await session(); inp.ctx = 'offense'; pad(inp, { rt: true }); inp.gp.prev[2] = false; inp.gp.buttons[2] = true; const it = frame(); assert.equal(it.shoot, 'press'); assert.equal(it.forceLayup, true); }
  { const { inp, frame } = await session(); inp.ctx = 'offense'; pad(inp, { x: true, down: true }); const it = frame(); assert.ok(!it.forceDunk && !it.forceLayup, 'no sprint: neither'); }
  // the controls list says so, with the binds; the combo's row is gone
  const sc = src('client/js/ui/screens.js');
  assert.ok(sc.includes("['Attack the rim — a dunk, any build, on a drive to the rim (it can still miss or get blocked; held, it keeps driving until you\\'re in range)', K('dunk'), `${G('RS')} down while sprinting, held`]"));
  assert.ok(sc.includes("['Layup — shoot while sprinting at the rim (never a dunk, a jumper or a pump fake; hold, release at the top)', `${K('sprint')} + ${K('shoot')}`, `${P('sprint')} + ${P('shoot')}`]"));
  assert.ok(!sc.includes('Force a dunk') && !sc.includes("K('stickDown')} + ${K('shoot')}"));
});

test('over the wire: both fields go out, come back and are cleared once used; blank when not pressed', () => {
  for (const f of ['forceDunk', 'forceLayup']) {
    const it = { ...blankIntent(), mx: 0.3, mz: 0.9, sprint: true, shoot: 'press', attack: f === 'forceDunk', shootHeld: true, [f]: true, seq: { shoot: 7 } };
    const n = normIntent(it);
    assert.equal(n[f], true);
    assert.ok(!(f in normIntent({ ...it, [f]: false })), 'blank is left out');
    const prev = normIntent(blankIntent()), d = intentDelta(prev, n);
    assert.equal(d[f], true);
    assert.deepEqual(applyDelta(prev, d), n);
    assert.equal(applyDelta(n, intentDelta(n, normIntent({ ...it, [f]: false })))[f], undefined, 'and back off');
    assert.equal(blankIntent()[f], false);
    // online: a press already used is dropped from the ticks after (multiIntent), the forced finish with it
    const { g, p } = setup(4);
    g.humanIntents = new Map([[p.id, n]]); p.usedSeq = 7;
    const m = g.multiIntent(p);
    assert.equal(m.shoot, null); assert.equal(m[f], false);
    p.usedSeq = 6; assert.equal(g.multiIntent(p)[f], true);
  }
});

test('with neither used nothing changes: the finish picked for every drive is the same as before', () => {
  // (both fields are only read when true: every kind of driver, near and far, fast and slow, with and without the
  // attack bind and sprint, gets the same answer with them off as with no fields at all. The AI never sets them, so
  // sim_batch (park and Pro-Am) comes out identical with and without this change)
  const r = new RNG(12);
  for (let i = 0; i < 600; i++) {
    const rt = { driving_dunk: r.int(25, 99), standing_dunk: r.int(25, 99), layup: r.int(25, 99), mid_range: r.int(25, 99), close_shot: r.int(25, 99) };
    const ang = r.range(-1, 1) * Math.PI, sp = r.range(0, 7), d = r.range(0.3, 9);
    const p = { entry: { build: { archetype: ['slasher', 'playmaker', 'glass_cleaner', 'sharpshooter'][i % 4] } }, raw: { ...rt }, ratings: { ...rt }, phys: { reach: r.range(2.4, 2.8), vertical: r.range(0.3, 1.1) }, badges: {}, stamina: r.range(0.1, 1), x: 0, z: 0, vx: Math.sin(ang) * sp, vz: Math.cos(ang) * sp };
    const ctx = { attack: i % 3 === 0, sprint: i % 2 === 0, defs: [] };
    assert.deepEqual(shotTypeFor(p, { x: 0, z: d }, { ...ctx, forceDunk: false, forceLayup: false }), shotTypeFor(p, { x: 0, z: d }, ctx));
  }
  const ai = src('client/js/sim/ai.js');
  assert.ok(!ai.includes('forceDunk') && !ai.includes('forceLayup'), 'the AI\'s intents never carry them');
});
