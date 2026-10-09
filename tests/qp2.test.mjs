// v0.4.5 quick patch, second round: off-window releases very rarely go in, the release point is where the ball leaves
// his hand for every build and animation, windows 6.5% smaller, game −3.75%, dribbling −7.45%, icon pass inputs over
// heads, "% guarded" feedback, no slow motion on dunks (a harder slam instead), smarter AI, and stats under 70 aren't
// proficient (10% less effective; a shooting stat's green window 10% smaller).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../client/js/sim/shots.js';
import { Game, GAME_SPEED, SLAM_V } from '../client/js/sim/game.js';
import { DRIBBLE_SPEED_K } from '../client/js/sim/player.js';
import { rk, rkRaw, SUB70_K, physical } from '../client/js/sim/ratings.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { pickMove, AI_IQ_BONUS } from '../client/js/sim/ai.js';
import { MatchSession, guardedText } from '../client/js/game/session.js';
import { Input, newStickState } from '../client/js/core/input.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

test('a release outside the green window very rarely goes in: 3% at most slightly off, half a percent badly off', () => {
  const a = v => ({ three_point: v, mid_range: v, layup: v, free_throw: v, close_shot: v });
  for (const v of [60, 80, 99]) for (const [type, extra] of [['jumper', { d: 5 }], ['jumper', { d: 7.4, three: true }], ['ft', { d: 4.19 }], ['layup', { d: 1.2 }]]) {
    const fc = grade => S.finalChance({ type, a: a(v), grade, contest: 0, stamina: 1, badges: { deadeye: 4, limitless: 4 }, hot: true, ...extra });
    for (const g of ['early', 'late']) assert.ok(fc(g) <= 0.03, `${type} ${v} ${g}: ${(fc(g) * 100).toFixed(2)}%`);
    for (const g of ['vearly', 'vlate']) assert.ok(fc(g) <= 0.005, `${type} ${v} ${g}`);
    assert.ok(fc('excellent') > 0.3, `${type} ${v}: a green is still a green`);
  }
});

test('windows 6.5% smaller, the game 3.75% slower, everyone 7.45% slower with the ball', () => {
  assert.ok(Math.abs(S.GREEN_K - 0.9 * 0.935) < 1e-12);
  assert.ok(Math.abs(GAME_SPEED - 1.15 * 1.0375 * (1 - 0.0185) * (1 - 0.0075) * (1 - 0.0375)) < 1e-12);
  assert.ok(Math.abs(DRIBBLE_SPEED_K - (1 - 0.0745)) < 1e-12);
  // a handler and the same player without the ball, running flat out for two seconds
  const top = hasBall => {
    const rng = new RNG(5), me = makeTeam(rng, 1, { catalog, level: 0.8 })[0];
    const g = new Game({ mode: 'practice', seed: 5, rosters: [[me], []], catalog }), p = g.players[0];
    p.intent = { mx: 1, mz: 0, sprint: true }; p.stamina = 1;
    for (let i = 0; i < 120; i++) { p.intent = { mx: 1, mz: 0, sprint: true }; p.stamina = 1; p.move(1 / 60, hasBall); }
    return Math.hypot(p.vx, p.vz) / (p.phys.sprint * (hasBall ? p.phys.ballSpeedK : 1));
  };
  assert.ok(Math.abs(top(true) / top(false) - DRIBBLE_SPEED_K) < 0.01, `with the ball: ×${(top(true) / top(false)).toFixed(4)}`);
});

test('stats under 70 aren\'t proficient: 10% less effective across the board, a shooting stat\'s window 10% smaller', () => {
  // the rating curve itself: 69 plays 10% below its curve, 70 plays at it
  for (const v of [40, 55, 69]) assert.ok(Math.abs(rk(v) - rkRaw(v) * SUB70_K) < 1e-12, `skill ${v}`);
  for (const v of [70, 85, 99]) assert.equal(rk(v), rkRaw(v));
  assert.ok(rk(69) < rk(70) * 0.9, `a clear step down under 70 (${rk(69).toFixed(3)} vs ${rk(70).toFixed(3)})`);
  // shooting: the green window for that shot type, exactly 10% off
  for (const v of [50, 60, 69]) {
    const raw = S.timingWindowMs(v);
    assert.ok(Math.abs(S.greenWindowMs(v) - Math.max(9, raw * 0.9) * S.GREEN_K) < 1e-9, `jumper window ${v}`);
    assert.ok(Math.abs(S.greenWindowMs(v, {}, { ft: true }) - raw * 0.9 * 1.15 * S.GREEN_K) < 1e-9, `free throw window ${v}`);
    assert.ok(Math.abs(S.layupWindowMs(v) - Math.max(9, raw * S.LAYUP_WIN_K * 0.9) * S.GREEN_K) < 1e-9, `layup window ${v}`);
  }
  assert.ok(S.greenWindowMs(69) < S.greenWindowMs(70) * 0.9, 'a 69 shooter\'s window is clearly smaller than a 70\'s');
  // physical attributes too: a 69-speed build is slower than a 70 by more than the one point
  const ph = v => physical({ height: 78, weight: 210, wingspan: 82, attributes: { speed: v, acceleration: v, vertical: v, strength: v, stamina: v } });
  const a69 = ph(69), a70 = ph(70), a71 = ph(71);
  assert.ok(a70.sprint - a69.sprint > (a71.sprint - a70.sprint) * 3, 'speed');
  assert.ok(a70.vertical - a69.vertical > (a71.vertical - a70.vertical) * 3, 'vertical');
  assert.ok(a69.staminaRate > a70.staminaRate, 'stamina drains faster');
  // and the game itself: base chances, the AI's reads, everything that uses the curve
  const fc = v => S.finalChance({ type: 'jumper', d: 5, a: { mid_range: v }, grade: 'none', contest: 0, stamina: 1, badges: {} });
  assert.ok(fc(70) - fc(69) > (fc(71) - fc(70)) * 3, 'base chance');
});

test('icon pass inputs over teammates\' heads, for the device you\'re using', () => {
  const inp = Object.create(Input.prototype);
  Object.assign(inp, { down: new Set(), pressed: new Set(), released: new Set(), capturing: false, ctx: 'offense', lastDevice: 'keyboard' });
  inp.applyBinds({ key: { icon3: 'KeyJ' } });
  inp.gp = { connected: false, family: 'xbox', buttons: [], prev: [], axes: [0, 0, 0, 0], rs: newStickState() };
  inp.padmap = { ...inp.padmap };
  const sess = { input: inp };
  const glyph = i => MatchSession.prototype.iconPassGlyph.call(sess, i);
  assert.match(glyph(0), /<kbd>1<\/kbd>/);
  assert.match(glyph(2), /<kbd>J<\/kbd>/, 'your own binding');
  inp.gp.connected = true; inp.lastDevice = 'gamepad';
  assert.match(glyph(0), /pad-glyph xbox b-lb[^>]*>LB<\/span><span class="pad-glyph xbox b-a">A</, 'LB + A');
  assert.match(glyph(3), /b-y">Y</);
  inp.gp.family = 'ps';
  assert.match(glyph(1), /L1<\/span>.*○/, 'PlayStation symbols');
});

test('shot feedback shows how guarded you were: the exact contest the release was graded with', () => {
  assert.equal(guardedText(0), '0% guarded · Wide open');
  assert.equal(guardedText(0.42), '42% guarded · Light contest');
  assert.equal(guardedText(0.6), '60% guarded · Contested');
  assert.equal(guardedText(S.SMOTHER), '75% guarded · Smothered');
  assert.equal(guardedText(1.2), '100% guarded · Smothered', 'capped at a full contest');
  const src = fs.readFileSync(new URL('../client/js/game/session.js', import.meta.url), 'utf8');
  assert.ok(src.includes("e.kind === 'ft' ? 'Free throw' : guardedText(e.contest)"), 'the release event\'s own contest');
});

test('dunks: no slow motion, thrown down hard out of his hand through the rim', () => {
  const src = fs.readFileSync(new URL('../client/js/game/session.js', import.meta.url), 'utf8');
  const slam = src.slice(src.indexOf("case 'slam': {"), src.indexOf("case 'hang':"));
  assert.ok(!/this\.slow\(/.test(slam), 'no slow motion on a slam');
  assert.ok(!/POSTERIZED!'[^\n]*this\.slow\(/.test(src), 'or a poster');
  const rng = new RNG(4), me = makeTeam(rng, 1, { catalog, level: 0.9 })[0];
  me.human = true; me.build.attributes = { ...me.build.attributes, driving_dunk: 95, layup: 70, vertical: 95 };
  const g = new Game({ mode: 'practice', seed: 4, rosters: [[me], []], catalog });
  const p = g.players[0], rim = g.rimFor(0), side = g.sideFor(0);
  p.phys.vertical = Math.max(p.phys.vertical, 3.5 - p.phys.reach);
  p.setPos(rim.x, rim.z - side * 2.6, side > 0 ? 0 : Math.PI); p.vz = side * 5; g.giveBall(p, 'dribble');
  g.setInput({ mx: 0, mz: side, sprint: true, shoot: 'press', attack: true, shootHeld: true }); g.step(1 / 60);
  assert.equal(p.action?.type, 'dunk');
  let hand = null, ev = null;
  for (let i = 0; i < 120 && !ev; i++) {
    if (!p.action?.slammed) hand = g.holdPoint(p);
    g.setInput({ mx: 0, mz: side, sprint: true, shootHeld: true }); g.step(1 / 60);
    ev = g.events.find(e => e.type === 'slam');
  }
  assert.ok(ev, 'slammed'); assert.ok(ev.made, 'and it went down');
  const b = g.ball;
  if (ev.made) {
    assert.ok(b.vy <= -SLAM_V + 0.5, `thrown down hard (${b.vy.toFixed(1)} m/s)`);
    assert.ok(Math.hypot(b.x - hand.x, b.y - hand.y, b.z - hand.z) < 0.6, 'from his hand, not from a spot above the rim');
  }
});

test('the AI mixes its dribble moves up, the smarter the more; every tier reads the game better', () => {
  const rng = new RNG(9), count = (iq, run) => {
    let same = 0;
    for (let i = 0; i < 4000; i++) same += pickMove({ stam: { lastMove: 'cross', moveRun: run } }, rng, iq, { cross: 0.3, btb: 0.15, btl: 0.15, hesi: 0.12, stepback: 0.14, spin: 0.14 }) === 'cross' ? 1 : 0;
    return same / 4000;
  };
  const dumb = count(0.2, 1), smart = count(0.95, 1), spam = count(0.95, 3);
  assert.ok(dumb < 0.3 && smart < dumb * 0.4 && spam < 0.02, `repeats: ${(dumb * 100).toFixed(0)}% low IQ, ${(smart * 100).toFixed(1)}% high IQ, ${(spam * 100).toFixed(1)}% after three in a row`);
  const g = new Game({ mode: 'practice', seed: 1, rosters: [[makeTeam(new RNG(1), 1, { catalog, level: 0.7 })[0]], []], catalog });
  const lo = g.ai.iq({ iq: 0.2 }), hi = g.ai.iq({ iq: 0.8 });
  assert.ok(lo > 0.2 * 1.1 && hi - 0.8 * 1.1 > lo - 0.2 * 1.1, 'smarter in every tier, more so at the top');
  assert.deepEqual(AI_IQ_BONUS, [0.04, 0.08]);
});

test('the contest bites 5% harder on the green window in every guarded tier, each on its own', () => {
  assert.equal(S.CONTEST_TIER_BOOST, 0.05);
  const pen = (attr, c) => 1 - S.greenWindowMs(attr, {}, { contest: c }) / S.greenWindowMs(attr, {}, {});
  // what the penalty was: 0.55 × contest (× 1.0375 once contested), now ×1.05 for every tier past wide open
  for (const [c, tier] of [[0.15, 'Open'], [0.3, 'Light contest'], [0.6, 'Contested']]) {
    const ck = 1 + 0.0375 * Math.max(0, Math.min(1, (c - 0.15) / 0.05));
    // (v0.4.7.5: 0.66 per unit of contest without a shooting badge, 0.55 with one; layups 0.48 / 0.4)
    assert.ok(Math.abs(pen(85, c) - 0.66 * ck * c * 1.05) < 1e-9, `${tier}: penalty ${(pen(85, c) * 100).toFixed(1)}%`);
    const pb = 1 - S.greenWindowMs(85, { deadeye: 1 }, { contest: c }) / S.greenWindowMs(85, { deadeye: 1 }, {});
    assert.ok(pb < pen(85, c), `${tier}: smaller with a shooting badge`);
    const lay = 1 - S.layupWindowMs(85, {}, { contest: c }) / S.layupWindowMs(85, {}, {});
    assert.ok(Math.abs(lay - 0.48 * c * 1.05) < 1e-9, `${tier}: layup penalty`);
  }
  assert.ok(Math.abs(pen(85, 0.08) - 0.66 * 0.08) < 1e-9, 'wide open: no tier boost');
  assert.equal(S.greenWindowMs(85, {}, { contest: S.SMOTHER }), 0, 'smothered: still no window');
});

test('bigs\' dribble moves are 10% slower, wings\' 5%, point guards\' as they were; then everyone\'s 5% slower', async () => {
  const { POS_MOVE_SPEED, MOVE_SPEED_ALL, MOVE_SNAP } = await import('../client/js/sim/game.js');
  assert.deepEqual(POS_MOVE_SPEED, { PG: 1, SG: 0.95, SF: 0.95, PF: 0.9, C: 0.9 });
  assert.equal(MOVE_SPEED_ALL, 0.95);
  const dur = pos => {
    const rng = new RNG(3), me = makeTeam(rng, 1, { catalog, level: 0.7 })[0];
    me.build.position = pos; me.human = true;
    const g = new Game({ mode: 'practice', seed: 3, rosters: [[me], []], catalog }), p = g.players[0];
    p.ratings.ball_handle = 80; p.ratings.speed_with_ball = 80; p.moveSpeed = 1; p.stamina = 1;
    g.giveBall(p, 'dribble'); g.setInput({ mx: 0, mz: 0, move: 'cross' }); g.step(1 / 60);
    return p.action.dur;
  };
  const pg = dur('PG');
  // a PG's crossover at 80/80 with a plain size-up: the snappy base, then 5% slower for everyone
  const n = v => (v - 25) / 74;
  // (v0.4.7.5: the handle counts for more, 0.4 per unit instead of 0.22)
  assert.ok(Math.abs(pg - 0.4 * MOVE_SNAP / (1 + 0.4 * n(80) + 0.1 * n(80)) / 0.95) < 0.02, `PG crossover ${(pg * 1000).toFixed(0)} ms`);
  for (const [pos, k] of [['SG', 0.95], ['SF', 0.95], ['PF', 0.9], ['C', 0.9]]) assert.ok(Math.abs(dur(pos) - pg / k) < 1e-9, `${pos}: a crossover takes ${(dur(pos) * 1000).toFixed(0)} ms vs ${(pg * 1000).toFixed(0)} ms for a PG`);
});
