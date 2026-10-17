// v0.4.8.5 qp5: Icon boosts reach the physics, and ratings past 99 keep paying off.
//  * Player.phys is built from the build's attributes with the Icon badge's % on them (only the Icon's: no no-badge
//    penalty, no takeover), so The General's +2.5% reaches his speed, burst, bounce, strength and stamina, and Oprah's
//    +5% Speed With Ball his top speed with the ball. Everybody else's physics are exactly what they were.
//  * The caps that stopped a stat paying off at 99 (the handle's chaining, snap and move speed, a pass's accuracy and
//    speed) go on past it, as far as a 105 takes them; nothing changes at 99 and below.
//  * The pass aim error only ever shrinks as Pass Accuracy rises (it went negative from ~96 and grew again).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, chainAt, moveSnapRate, passAcc, passAimErr, passQuick, moveHandleK, CHAIN_AT, PASS_ACC_K, PASS_ACC_BOOST } from '../client/js/sim/game.js';
import { Player, blankIntent, DRIBBLE_SPEED_K } from '../client/js/sim/player.js';
import { physical, rk, ATTRS, over99, RATING_MAX } from '../client/js/sim/ratings.js';
import { ICON_BADGES, iconAttributes, effectiveRatings } from '../client/js/sim/badges.js';
import { bodyDims } from '../client/js/char/skeleton.js';
import { INCH, DT } from '../client/js/sim/constants.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries((list.items || list).map(i => [i.id, i]));
const all = v => Object.fromEntries(ATTRS.map(a => [a, v]));
const PHYS = ['speed', 'acceleration', 'vertical', 'strength', 'stamina', 'speed_with_ball'];

// ---- the functions as they were before qp5 (kept here to prove nothing at 99 and below moved) ----
const n0 = v => { v = v ?? 60; return ((v - 25) / 74 + (v > 95 ? (v - 95) * 0.012 : 0) + (v >= 99 ? 0.03 : 0)) * (v < 70 ? 0.9 : 1); };
function physicalOld(build) {
  const a = build.attributes || {};
  const H = (build.height || 78) * INCH, W = (build.weight || 210) * 0.4536, WS = (build.wingspan || build.height + 3) * INCH, massK = Math.pow(95 / W, 0.22);
  const sprint = 6.0 + rk(a.speed) * 2.0;
  return {
    H, W, WS, radius: 0.25 + Math.min(0.08, Math.max(0, (W - 80) * 0.0016)) + (H - 1.9) * 0.08, sprint, jog: sprint * 0.62, walk: 1.6,
    ballSpeedK: 0.84 + rk(a.speed_with_ball) * 0.14, accel: (11 + rk(a.acceleration) * 6) * massK * 0.96, brake: (17 + rk(a.acceleration) * 6) * massK * 0.97, turn: 13 * massK * 0.93,
    vertical: 0.42 + n0(a.vertical) * 0.4, reach: bodyDims(build).reachStanding, strength: n0(a.strength) * 0.7 + Math.min(1, (W - 75) / 50) * 0.3,
    staminaRate: (0.055 - n0(a.stamina) * 0.03) * 1.35, recover: 0.022 + n0(a.stamina) * 0.032,
  };
}
const chainOld = bh => Math.max(0.4, Math.min(CHAIN_AT, CHAIN_AT - ((bh ?? 60) - 60) * 0.0052));
const snapOld = bh => 12 + 10 * Math.max(0, Math.min(1, ((bh ?? 60) - 50) / 49));
const handleOld = (bh, swb) => 1 + 0.4 * Math.min(1.25, rk(bh)) + 0.1 * Math.min(1.2, rk(swb));
const accOld = pa => Math.min(1.15, rk(pa) * PASS_ACC_BOOST);
const errOld = (pa, speed) => ((1 - rk(pa)) * 0.26 + Math.min(1, speed / 6) * 0.08) * PASS_ACC_K;
const quickOld = pa => 1.1 - 0.32 * rk(pa);
const grid = []; for (let v = 25; v <= 99; v += 0.5) grid.push(v);

const entry = (icon, v = 92, extra = {}) => ({ name: 'X', build: { position: 'SF', archetype: 'two_way', height: 78, weight: 210, wingspan: 82, attributes: typeof v === 'object' ? v : all(v), icon_badge: icon, ...extra }, badges: { brick_wall: 4, handles_for_days: 3, dimer: 3 } });

test('The General: +2.5% on every physical attribute reaches his physics, exactly', () => {
  for (const v of [70, 85, 92, 99]) {
    const p = new Player(0, 0, entry('the_general', v), catalog), q = new Player(0, 0, entry(null, v), catalog);
    const boosted = { ...entry(null, v).build, attributes: Object.fromEntries(ATTRS.map(a => [a, v * 1.025])) };
    assert.deepEqual(p.phys, physical(boosted), `${v}: phys = the build at ×1.025`);
    assert.ok(p.phys.sprint > q.phys.sprint && p.phys.accel > q.phys.accel && p.phys.vertical > q.phys.vertical && p.phys.strength > q.phys.strength, `${v}: quicker, springier, stronger`);
    assert.ok(p.phys.staminaRate < q.phys.staminaRate && p.phys.recover > q.phys.recover, `${v}: more stamina`);
    assert.ok(p.phys.ballSpeedK > q.phys.ballSpeedK, `${v}: and faster with the ball`);
    // (the same sizes: height, weight and reach come from the build, not the attributes)
    for (const k of ['H', 'W', 'WS', 'radius', 'reach', 'turn', 'walk']) assert.equal(p.phys[k], q.phys[k], k);
  }
  // the numbers at 99 across the board (before: 8.640 / 0.851 / 0.876, the same as without the badge)
  const g = new Player(0, 0, entry('the_general', 99), catalog).phys;
  assert.ok(Math.abs(g.sprint - 8.8306) < 1e-3 && Math.abs(g.vertical - 0.8765) < 1e-3 && Math.abs(g.strength - 0.9203) < 1e-3, JSON.stringify({ sprint: g.sprint, vertical: g.vertical, strength: g.strength }));
});

test('Oprah: +5% Speed With Ball reaches his top speed with the ball (and nothing else in his physics moves)', () => {
  for (const v of [80, 90, 99]) {
    const attrs = all(v);
    const p = new Player(0, 0, entry('oprah', attrs, { position: 'PG', archetype: 'playmaker' }), catalog), q = new Player(0, 0, entry(null, attrs, { position: 'PG', archetype: 'playmaker' }), catalog);
    assert.deepEqual(p.phys, physical({ ...q.entry.build, attributes: { ...attrs, speed_with_ball: v * 1.05 } }));
    for (const k of Object.keys(q.phys)) if (k !== 'ballSpeedK') assert.equal(p.phys[k], q.phys[k], k);
    assert.ok(Math.abs(p.phys.ballSpeedK - (0.84 + rk(v * 1.05) * 0.14)) < 1e-12);
    // flat out with the ball for three seconds: he gets there, and it's faster than without the badge by the same
    const top = (pl, hasBall) => { pl.vx = pl.vz = 0; for (let i = 0; i < 180; i++) { pl.intent = { ...blankIntent(), mx: 1, mz: 0, sprint: true }; pl.stamina = 1; pl.move(DT, hasBall); } return Math.hypot(pl.vx, pl.vz); };
    const tp = top(p, true), tq = top(q, true);
    assert.ok(Math.abs(tp - p.phys.sprint * p.phys.ballSpeedK * DRIBBLE_SPEED_K) < 1e-6, `${v}: reaches his top speed with the ball (${tp.toFixed(3)})`);
    assert.ok(Math.abs(tp / tq - p.phys.ballSpeedK / q.phys.ballSpeedK) < 1e-6 && tp > tq, `${v}: ${tq.toFixed(3)} → ${tp.toFixed(3)} m/s`);
    assert.equal(top(p, false), top(q, false), 'no faster without it');
  }
});

test('everybody else\'s physics are exactly what they were (non-holders, and Icons with no physical stat)', () => {
  const builds = [];
  for (const h of [70, 75, 80, 86]) for (const v of [30, 55, 69, 70, 84, 96, 99]) builds.push({ position: 'SF', height: h, weight: 140 + h * 1.1, wingspan: h + 3, attributes: Object.fromEntries(ATTRS.map((a, i) => [a, Math.max(25, Math.min(99, v - 9 + (i * 7) % 19))])) });
  builds.push({ position: 'C', height: 84, weight: 260, attributes: {} }, { position: 'PG', height: 72 });
  for (const b of builds) {
    assert.deepEqual(physical(b), physicalOld(b), 'physical() itself');
    for (const icon of [null, 'sharp_eye', 'hash_slinging', 'the_clamp', 'big_brother', 'open_arms', 'sexy_red']) {
      const p = new Player(0, 0, { name: 'Y', build: { ...b, icon_badge: icon }, badges: {} }, catalog);
      assert.deepEqual(p.phys, physicalOld(b), `${icon || 'no icon'} ${b.height}`);
    }
  }
  // the helper: the Icon's own % and nothing else; no Icon, the same object
  const raw = all(80);
  assert.equal(iconAttributes(raw, null), raw);
  assert.deepEqual(iconAttributes(raw, 'oprah'), { ...raw, ball_handle: 84, speed_with_ball: 84, pass_accuracy: 84 });
  assert.deepEqual(iconAttributes(raw, 'the_general'), Object.fromEntries(ATTRS.map(a => [a, 82]))); // (80 × 1.025)
  // (the no-badge penalty and the takeover stay out of the physics: a holder with no badges at all still gets just ×1.025)
  const bare = new Player(0, 0, { name: 'Z', build: { position: 'SF', height: 78, weight: 210, attributes: all(90), icon_badge: 'the_general' }, badges: {} }, catalog);
  assert.ok(bare.ratings.strength < 90 * 1.025, 'his sim Strength has the no-badge penalty');
  assert.deepEqual(bare.phys, physical({ position: 'SF', height: 78, weight: 210, attributes: Object.fromEntries(ATTRS.map(a => [a, 90 * 1.025])) }), 'his physics do not');
});

test('physical(): nothing stops at 99, and RATING_MAX bounds what goes in', () => {
  const ph = v => physical({ height: 78, weight: 210, attributes: Object.fromEntries(PHYS.map(a => [a, v])) });
  let prev = ph(99);
  for (const v of [100, 101.5, 103, 103.95, 105]) {
    const q = ph(v);
    assert.ok(q.sprint > prev.sprint && q.accel > prev.accel && q.vertical > prev.vertical && q.strength > prev.strength && q.ballSpeedK > prev.ballSpeedK && q.staminaRate < prev.staminaRate, `${v} beats the one below`);
    prev = q;
  }
  assert.deepEqual(ph(140), ph(RATING_MAX), 'past RATING_MAX it stops');
  assert.ok(ph(RATING_MAX).staminaRate > 0, 'the drain never goes negative');
});

test('ratings past 99 keep helping: chaining, snap, move speed, pass speed and accuracy', () => {
  const P = v => ({ ratings: { ball_handle: v, speed_with_ball: v, pass_accuracy: v } });
  // before qp5 every one of these was flat from 99 (or earlier) up
  for (const [a, b] of [[99, 101], [101, 103.95], [103.95, 105]]) {
    assert.ok(chainAt(P(b)) < chainAt(P(a)), `chain point ${a} → ${b}`);
    assert.ok(moveSnapRate(P(b)) > moveSnapRate(P(a)), `snap ${a} → ${b}`);
    assert.ok(moveHandleK(P(b)) > moveHandleK(P(a)), `move speed ${a} → ${b}`);
    assert.ok(passAcc(b) > passAcc(a), `pass accuracy ${a} → ${b}`);
    assert.ok(passQuick(b) < passQuick(a), `release ${a} → ${b}`);
  }
  // sane tops: as far as a 105 takes them, no further
  for (const f of [chainAt, moveSnapRate, moveHandleK]) assert.equal(f(P(130)), f(P(RATING_MAX)));
  assert.equal(passAcc(130), passAcc(RATING_MAX)); assert.equal(passQuick(130), passQuick(RATING_MAX));
  assert.ok(Math.abs(chainAt(P(105)) - (0.4 - 6 * 0.0052)) < 1e-12 && Math.abs(moveSnapRate(P(105)) - (12 + 10 * 55 / 49)) < 1e-12);
  assert.ok(Math.abs(passAcc(105) - (1.15 + (rk(105) - rk(99)) * 1.1)) < 1e-12 && passAcc(105) < 1.42);
  assert.equal(over99(99), 0); assert.equal(over99(80), 0); assert.ok(over99(104) > 0);
  // in the sim: an Oprah holder's (99 → 103.95) pass leaves quicker, flies faster and steers truer than a 99's
  const pass = pa => {
    const g = new Game({ mode: 'practice', seed: 3, rosters: [[{ name: 'A', human: true, build: { position: 'PG', height: 76, weight: 190, attributes: { ...all(80), pass_accuracy: pa } }, badges: { dimer: 4 } }, { name: 'B', build: { position: 'SF', height: 79, weight: 210, attributes: all(80) }, badges: {} }], []], catalog });
    const [a, b] = g.players; a.setPos(0, 3, 0); b.setPos(0, 9, Math.PI);
    g.startPass(a, { target: b.id, type: 'chest' });
    const rel = a.action.rel;
    for (let i = 0; i < 60 && g.ball.mode !== 'flight'; i++) { g.setInput(blankIntent()); g.step(DT); }
    return { rel, acc: g.ball.info.acc, speed: Math.hypot(g.ball.vx, g.ball.vz) };
  };
  const p99 = pass(99), p104 = pass(103.95);
  assert.ok(p104.rel < p99.rel && p104.acc > p99.acc && p104.speed > p99.speed, JSON.stringify({ p99, p104 }));
  assert.equal(p99.acc, 1.15);
  // and a dribble move out of a 103.95 handle is shorter than out of a 99
  const mv = bh => {
    const g = new Game({ mode: 'practice', seed: 3, rosters: [[{ name: 'A', human: true, build: { position: 'PG', height: 76, weight: 190, attributes: { ...all(85), ball_handle: bh, speed_with_ball: bh } }, badges: { handles_for_days: 4 } }], []], catalog });
    const a = g.players[0]; g.giveBall(a, 'dribble'); a.ratings.ball_handle = bh; a.ratings.speed_with_ball = bh; g.startMove(a, 'cross'); return a.action.dur;
  };
  assert.ok(mv(103.95) < mv(99), `${mv(99).toFixed(4)} → ${mv(103.95).toFixed(4)} s`);
});

test('the pass aim error only ever shrinks as Pass Accuracy rises, to nothing (it used to grow again past ~96)', () => {
  for (const spd of [0, 3, 7]) {
    let prev = Infinity;
    for (let v = 25; v <= 110; v += 0.25) { const e = passAimErr(v, spd); assert.ok(e <= prev + 1e-15, `${v} at ${spd} m/s`); assert.ok(e >= 0); prev = e; }
  }
  assert.equal(passAimErr(97, 0), 0); assert.equal(passAimErr(99, 0), 0); assert.equal(passAimErr(104, 0), 0);
  assert.ok(Math.abs(errOld(99, 0)) * 100 > 7, 'the old one: 7.5 cm the wrong side of zero at 99');
  // and where the old one was right (under ~96, where it was still positive) nothing changed
  for (const v of grid) for (const spd of [0, 2.5, 6]) if (1 - rk(v) >= 0) assert.equal(passAimErr(v, spd), errOld(v, spd), `${v}`);
});

test('every rating at 99 and below plays exactly as it did (the caps, the pass, the physics)', () => {
  for (const v of grid) {
    const p = { ratings: { ball_handle: v, speed_with_ball: v, pass_accuracy: v } };
    assert.equal(chainAt(p), chainOld(v), `chain ${v}`);
    assert.equal(moveSnapRate(p), snapOld(v), `snap ${v}`);
    assert.equal(passAcc(v), accOld(v), `acc ${v}`);
    assert.equal(passQuick(v), quickOld(v), `quick ${v}`);
    for (const w of [40, 70, 95, 99]) assert.equal(moveHandleK({ ratings: { ball_handle: v, speed_with_ball: w } }), handleOld(v, w), `handle ${v}/${w}`);
    const b = { height: 77, weight: 205, wingspan: 81, attributes: Object.fromEntries(ATTRS.map(a => [a, v])) };
    assert.deepEqual(physical(b), physicalOld(b), `physical ${v}`);
  }
  // (missing ratings default the same way)
  assert.equal(chainAt({ ratings: {} }), chainOld(undefined)); assert.equal(moveSnapRate({ ratings: {} }), snapOld(undefined));
  assert.equal(passQuick(undefined), quickOld(undefined));
  // the sim ratings themselves are untouched (the Icon's % was already in them)
  assert.deepEqual(effectiveRatings(all(90), { dimer: 1 }, 'oprah').pass_accuracy, 94.5);
});
