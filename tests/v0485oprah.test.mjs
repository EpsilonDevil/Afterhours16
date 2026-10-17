// v0.4.8.5 qp5: Oprah (the Playmaker's Icon badge) throws his own passes: nine streetball styles nobody else has
// (sim/oprah.js: the pick, the ball's path, his body's facing; char/oprahpose.js: the bodies). Picked by the pass and
// where the man is, varied and the same on every peer, the ball leaving from where the pose has it, and the pass
// itself (when it goes, how fast, how true) exactly the sim's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { blankIntent, toWorld } from '../client/js/sim/player.js';
import { ATTRS } from '../client/js/sim/ratings.js';
import { DT } from '../client/js/sim/constants.js';
import { OP_STYLES, OP_IDS, opCandidates, pickOprahPass, oprahPlan, oprahBall, oprahFacing, opK } from '../client/js/sim/oprah.js';
import { OP_POSES, OP_FINISH } from '../client/js/char/oprahpose.js';
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries((list.items || list).map(i => [i.id, i]));
const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const all = v => Object.fromEntries(ATTRS.map(a => [a, v]));
const D = Math.PI / 180;
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

const passer = (icon, hand = 'R', h = 75) => ({ name: 'A', human: true, build: { position: 'PG', archetype: 'playmaker', height: h, weight: 185, wingspan: h + 4, hand, attributes: all(95), icon_badge: icon }, badges: { dimer: 4, handles_for_days: 4 } });
const mateE = { name: 'B', build: { position: 'SF', height: 79, weight: 210, attributes: all(80) }, badges: {} };
const game = (icon = 'oprah', seed = 3, hand = 'R') => new Game({ mode: 'practice', seed, rosters: [[passer(icon, hand), mateE], []], catalog });
// one pass: the man at ang degrees off his facing (+ = his left), dist away; returns the action
function throwAt(g, ang, type = 'chest', o = {}) {
  const [a, b] = g.players;
  a.setPos(0, 2, o.facing || 0); a.action = null;
  const A = (o.facing || 0) + ang * D;
  b.setPos(Math.sin(A) * (o.dist || 6), 2 + Math.cos(A) * (o.dist || 6), A + Math.PI);
  g.giveBall(a, o.held ? 'held' : 'dribble'); a.dribble.hand = o.hand || 'R'; a.dribble.used = !!o.held;
  if (o.moving) { a.vx = Math.sin(o.facing || 0) * o.moving; a.vz = Math.cos(o.facing || 0) * o.moving; }
  g.startPass(a, { target: b.id, type, quick: !!o.quick });
  return a.action;
}
const playOut = (g, a) => { let rel = null; for (let i = 0; i < 90 && g.players[0].action === a; i++) { g.setInput(blankIntent()); const before = g.ball.mode; g.step(DT); if (before !== 'flight' && g.ball.mode === 'flight' && rel == null) rel = { t: a.t, x: g.ball.px, y: g.ball.py, z: g.ball.pz, vx: g.ball.vx, vz: g.ball.vz, acc: g.ball.info.acc, eta: g.ball.info.eta }; } return rel; };

test('nine styles, each with its own ball path, body and finish; the badge text matches', () => {
  assert.ok(OP_IDS.length >= 6);
  assert.deepEqual(OP_IDS, ['btb', 'nolook', 'wrap', 'btl', 'shoulder', 'elbow', 'spin', 'bullet', 'overhead']);
  for (const id of OP_IDS) {
    const S = OP_STYLES[id];
    assert.ok(S.name && S.desc && S.callout && Object.keys(S.types).length, id);
    assert.ok(OP_POSES[id] && typeof OP_POSES[id].win === 'function' && typeof OP_POSES[id].fin === 'function', `${id}: a body`);
  }
  assert.equal(new Set(OP_IDS.map(i => OP_STYLES[i].name)).size, OP_IDS.length);
  // the release points are all different places on him (right hand, chest pass, the man where the style wants him)
  const H = 1.9, rel = {};
  for (const id of OP_IDS) {
    const a = { t: 1, rel: 0.1, ptype: id === 'overhead' ? 'lob' : id === 'wrap' || id === 'btl' ? 'bounce' : 'chest', op: oprahPlan({ hand: 'R' }, { id, hand: 'R' }, 0, { btb: 90, elbow: 110, spin: 80, btl: 175, shoulder: -140, wrap: -25, nolook: 50, bullet: 5, overhead: 5 }[id] * D, [-0.2, 0.9, 0.3]) };
    rel[id] = oprahBall(a, H);
  }
  for (const i of OP_IDS) for (const j of OP_IDS) if (i < j) assert.ok(Math.hypot(rel[i][0] - rel[j][0], rel[i][1] - rel[j][1], rel[i][2] - rel[j][2]) > 0.08, `${i} vs ${j}`);
  // and they are where the style says (body frame: + x his left, + z ahead; a right-handed throw)
  assert.ok(rel.btb[2] < -0.12 && rel.btb[0] > 0.15, 'behind the back, let go behind the far hip');
  assert.ok(rel.elbow[2] < -0.15 && rel.elbow[0] > 0.25, 'round the back to the far elbow');
  assert.ok(Math.abs(rel.btl[0]) < 0.05 && rel.btl[1] < 0.3 * H && Math.abs(rel.btl[2]) < 0.15, 'between the knees');
  assert.ok(rel.shoulder[1] > 0.9 * H && rel.shoulder[2] < -0.05 && rel.shoulder[0] < -0.1, 'up over the right shoulder, behind it');
  assert.ok(rel.wrap[0] < -0.4 && rel.wrap[1] < 0.5 * H && rel.wrap[2] > 0.3, 'out wide at arm\'s length, low, round the man');
  assert.ok(rel.spin[0] < -0.7, 'slung out at arm\'s length');
  assert.ok(rel.overhead[1] > 1.0 * H, 'over his head');
  assert.ok(rel.bullet[2] > 0.5 && rel.bullet[1] > 0.65 * H, 'fired out in front');
  assert.ok(rel.nolook[0] > 0.1 && rel.nolook[2] > 0.3, 'pushed out toward the man');
  const ic = src('client/js/sim/badges.js');
  assert.ok(ic.includes('Unlocks exclusive ultra-flashy passing animations.'));
});

test('they fire on his passes: at least six different ones over a game\'s worth, picked by the pass and where the man is', () => {
  const seen = {}, byType = {};
  let n = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const g = game('oprah', seed);
    for (const type of ['chest', 'bounce', 'lob', 'alley', 'inbound']) for (const ang of [0, 25, 50, 80, 110, 140, 170, -30, -60, -95, -125, -160]) for (const mv of [0, 4.5]) {
      for (let k = 0; k < 2; k++) { g.setInput(blankIntent()); g.step(DT); }
      const a = throwAt(g, ang, type, { moving: mv, hand: (n++ % 3) ? 'R' : 'L', held: n % 5 === 0 });
      assert.ok(a?.op, 'every pass of his is one of them');
      assert.equal(a.icon, 'oprah');
      const st = a.op.style, rk = a.ptype;
      seen[st] = (seen[st] || 0) + 1; (byType[rk] = byType[rk] || new Set()).add(st);
      const d = Math.abs(wrap(a.face - a.op.f0)) / D;
      // natural: each where it fits
      if (st === 'btl') assert.ok(d >= 115 && mv < 3.2, `btl to a man behind, from a set-up (${d.toFixed(0)}°, ${mv})`);
      if (st === 'shoulder') assert.ok(d >= 105, `the flip over the shoulder goes back (${d.toFixed(0)}°)`);
      if (st === 'btb' || st === 'elbow' || st === 'spin') {
        assert.ok(d >= 35 && d <= 150, `${st}: a man off to the side (${d.toFixed(0)}°)`);
        const left = wrap(a.face - a.op.f0) > 0;
        assert.equal(left, a.op.hand === 'R', `${st}: thrown to the side away from the ball hand`);
      }
      if (st === 'spin') assert.ok(mv > 2.2, 'the Spin Dish is thrown on the move');
      if (st === 'wrap' || st === 'bullet' || st === 'overhead') assert.ok(d <= 85, `${st}: a man ahead (${d.toFixed(0)}°)`);
      if (rk === 'lob' || rk === 'alley') assert.ok(['btb', 'nolook', 'shoulder', 'overhead'].includes(st), `a ${rk}: ${st}`);
      if (rk === 'inbound') assert.ok(['nolook', 'bullet', 'overhead', 'shoulder'].includes(st), `an inbound: ${st}`);
      if (rk === 'bounce') assert.ok(['btb', 'nolook', 'wrap', 'btl', 'spin', 'shoulder'].includes(st), `a bounce: ${st}`);
      if (a.op.hand !== (n % 5 === 0 ? a.op.hand : (n - 1) % 3 ? 'R' : 'L')) assert.fail('a dribbled ball is thrown with the hand it was in');
      g.players[0].action = null;
    }
  }
  const styles = Object.keys(seen);
  assert.ok(styles.length >= 6, `${styles.length} different: ${JSON.stringify(seen)}`);
  assert.equal(styles.length, OP_IDS.length, `all nine come up: ${JSON.stringify(seen)}`);
  for (const t of ['chest', 'bounce', 'lob']) assert.ok(byType[t].size >= 3, `${t}: ${[...byType[t]]}`);
  // in the air (a bailout out of a jumper) only what can be thrown off the floor
  for (const ang of [10, 60, 100, 150, -60]) for (const type of ['chest', 'bounce']) {
    const c = opCandidates({ type, bailout: true, air: true, d: ang * D, hand: 'R', moving: 0 });
    for (const x of c) assert.ok(!['wrap', 'btl', 'spin', 'elbow'].includes(x.id), `air bailout: ${x.id}`);
  }
});

test('varied and deterministic: the same game gives the same passes on every peer; never the same twice running when another fits', () => {
  const run = seed => {
    const g = game('oprah', seed), out = [];
    for (let i = 0; i < 40; i++) {
      for (let k = 0; k < 3; k++) { g.setInput(blankIntent()); g.step(DT); }
      const a = throwAt(g, [90, 60, 20, -45, 130][i % 5], ['chest', 'bounce', 'lob'][i % 3], { moving: i % 4 === 0 ? 4.5 : 0 });
      out.push(a.op.style + ':' + a.op.hand); g.players[0].action = null;
    }
    return out;
  };
  const a1 = run(7), a2 = run(7), b = run(8);
  assert.deepEqual(a1, a2, 'two peers, the same game: the same passes');
  assert.notDeepEqual(a1, b, 'another game: other passes');
  // the pick itself uses no rng (the game's random stream is untouched) and avoids a repeat
  const ctx = { type: 'chest', d: 90 * D, hand: 'R', moving: 0 };
  let last = null, repeats = 0;
  for (let s = 1; s < 300; s++) { const p = pickOprahPass(ctx, s, 0, s * 13, last); if (p.id === last) repeats++; last = p.id; }
  assert.equal(repeats, 0, 'never the same twice running here (four fit)');
  // the same game with and without the badge draws the same random numbers through its passes
  const draws = icon => { const gg = game(icon, 11); const seq = []; for (let i = 0; i < 6; i++) { const a = throwAt(gg, 70 + i * 10, 'chest'); playOut(gg, a); seq.push(gg.rng.next()); } return seq; };
  assert.deepEqual(draws('oprah'), draws(null));
});

test('the pass itself is the sim\'s: the same release time, speed and accuracy as anyone with his ratings', () => {
  for (const [type, ang] of [['chest', 90], ['bounce', 175], ['lob', 5], ['chest', -140], ['bounce', -25], ['chest', 110]]) {
    const res = icon => {
      const g = game(icon, 5), p = g.players[0];
      p.ratings = { ...g.players[0].ratings, pass_accuracy: 103.95 };
      const a = throwAt(g, ang, type);
      const out = { rel: a.rel, dur: a.dur, face: a.face, ptype: a.ptype };
      const r = playOut(g, a);
      return { ...out, t: r.t, acc: r.acc };
    };
    const o = res('oprah'), n = res(null);
    assert.deepEqual(o, n, `${type} at ${ang}°`);
  }
});

test('the ball leaves his hand where the pose has it (every style, both hands, on the rig), and his body is finite throughout', () => {
  const geo = { btb: [90, 'chest'], nolook: [50, 'chest'], wrap: [-25, 'bounce'], btl: [175, 'bounce'], shoulder: [-140, 'chest'], elbow: [110, 'chest'], spin: [80, 'chest', 4.5], bullet: [5, 'chest'], overhead: [5, 'alley'] };
  for (const st of OP_IDS) for (const hand of ['R', 'L']) for (const h of [72, 80]) {
    const [ang0, type, mv] = geo[st], ang = hand === 'L' ? -ang0 : ang0;
    const g = game('oprah', 3, hand), [a] = g.players;
    const model = new AthleteModel(a.entry.build, {}, 0.5), rig = new Rig(model);
    const view = { H: model.d.H, model, rig, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.x = x; this.y = y; this.z = z; this.yaw = yaw; } };
    const anim = new Animator(view);
    const toW = q => { const c = Math.cos(view.yaw), s = Math.sin(view.yaw); return [view.x + q[2] * s + q[0] * c, view.y + q[1], view.z + q[2] * c - q[0] * s]; };
    const frame = ball => anim.update(DT, { x: a.x, y: a.y, z: a.z, facing: a.facing }, a, g, ball);
    for (let i = 0; i < 12; i++) { g.setInput(blankIntent()); g.step(DT); frame(g.ball); }
    let launch = null; const sf = g.ball.setFlight.bind(g.ball); g.ball.setFlight = (...args) => { launch = { x: args[0], y: args[1], z: args[2] }; return sf(...args); };
    const f0 = a.facing, act = throwAt(g, ang, type, { hand, moving: mv });
    act.op = oprahPlan({ type: act.ptype, d: 0, hand }, { id: st, hand }, f0, act.face, act.op.b0);
    const tag = `${st} ${hand} ${h}"`;
    let bad = 0, held = 0, far = 0, released = null, lastHold = null, sawFinish = false;
    for (let i = 0; i < 70; i++) {
      // where the sim holds it this tick (the path), before the step
      const hp = g.ball.holder === a.id ? g.holdPoint(a) : null;
      g.setInput(blankIntent()); g.step(DT);
      const fly = g.ball.mode === 'flight' && !released;
      const ball = fly ? launch : g.ball;
      frame(ball);
      for (const bn of ['hips', 'chest', 'head', 'handL', 'handR', 'foreL', 'foreR', 'footL', 'footR']) for (const c of rig.pos[B[bn]]) if (!Number.isFinite(c)) bad++;
      for (const v of anim.pose) if (!Number.isFinite(v)) bad++;
      if (a.action === act && !act.released && g.ball.holder === a.id && act.t > 2 * DT) {
        // the ball in his hand: the wrist the palm's width off it
        const k = opK(act), w = toW(rig.pos[B['hand' + hand]]), dd = Math.hypot(w[0] - g.ball.x, w[1] - g.ball.y, w[2] - g.ball.z);
        held++; if (!(st === 'elbow' && k > 0.8) && dd > 0.27) far++;
      }
      if (hp) lastHold = hp;
      if (fly) {
        released = { from: ball, hold: lastHold };
        // the flight starts exactly where the sim has it in his hand at the release: the end of the style's path, in the
        // frame his body faces (and the tick before, it was on the way there, in his hand)
        const end = oprahBall({ ...act, t: Math.max(act.t, act.rel) }, a.phys.H), vf = oprahFacing({ ...act, t: Math.max(act.t, act.rel) });
        const ew = toWorld({ x: a.prevX, z: a.prevZ, y: a.prevY, facing: vf }, end[0], end[1], end[2]);
        assert.ok(Math.hypot(ew.x - ball.x, ew.y - ball.y, ew.z - ball.z) < 1e-9, `${tag}: from the style's release point`);
        assert.ok(lastHold && Math.hypot(lastHold.x - ball.x, lastHold.y - ball.y, lastHold.z - ball.z) < 0.45, `${tag}: no jump at the release`);
        // ...and that is where the pose has his hand (or, the elbow pass, the point of his other elbow)
        const w = toW(rig.pos[B[st === 'elbow' ? (hand === 'R' ? 'foreL' : 'foreR') : 'hand' + hand]]);
        const dd = Math.hypot(w[0] - ball.x, w[1] - ball.y, w[2] - ball.z);
        assert.ok(dd < (st === 'elbow' ? 0.2 : 0.25), `${tag}: ${st === 'elbow' ? 'elbow' : 'wrist'} ${dd.toFixed(3)} m from the ball as it goes`);
      }
      if (released && anim._op && !anim._op.done && anim._op.relAt != null) sawFinish = true;
    }
    assert.equal(bad, 0, `${tag}: finite`);
    assert.ok(released, `${tag}: thrown`);
    assert.ok(held >= 1, `${tag}: held on the way`);
    assert.equal(far, 0, `${tag}: the ball stays in his hand up to the release`);
    assert.ok(sawFinish, `${tag}: and the finish plays after it`);
    assert.ok(anim._op.done && anim._opF == null, `${tag}: and is over, his body back on the sim's facing`);
  }
});

test('the windup turns his body only as far as the style needs, and the finish hands him back to the sim smoothly', () => {
  const g = game('oprah', 4), [a] = g.players;
  const model = new AthleteModel(a.entry.build, {}, 0.5), rig = new Rig(model);
  const view = { H: model.d.H, model, rig, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.yaw = yaw; } };
  const anim = new Animator(view);
  const f0 = a.facing, act = throwAt(g, 90, 'chest');
  act.op = oprahPlan({ type: 'chest', d: 0, hand: 'R' }, { id: 'btb', hand: 'R' }, f0, act.face, act.op.b0);
  let prevYaw = null, maxJump = 0;
  for (let i = 0; i < 60; i++) {
    g.setInput(blankIntent()); g.step(DT); anim.update(DT, { x: a.x, y: a.y, z: a.z, facing: a.facing }, a, g, g.ball);
    if (prevYaw != null) maxJump = Math.max(maxJump, Math.abs(wrap(view.yaw - prevYaw)));
    prevYaw = view.yaw;
    if (!act.released) assert.ok(Math.abs(wrap(view.yaw - f0)) < 0.05, 'a behind-the-back to a man at 90°: he doesn\'t square up to him');
  }
  assert.ok(maxJump < 0.2, `no snap in his facing (${maxJump.toFixed(3)} rad a frame at most)`);
  assert.ok(Math.abs(wrap(view.yaw - a.facing)) < 1e-6, 'back on the sim\'s facing');
  // the Spin Dish goes all the way round (after the ball's gone) and ends on the sim's facing too
  const g2 = game('oprah', 4), [b2] = g2.players, anim2 = new Animator({ H: model.d.H, model, rig, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.yaw = yaw; } });
  const sp = throwAt(g2, 80, 'chest', { moving: 4.5 }); sp.op = oprahPlan({ type: sp.ptype, d: 0, hand: 'R' }, { id: 'spin', hand: 'R' }, sp.op.f0, sp.face, sp.op.b0);
  let turned = 0, last = sp.op.f0;
  for (let i = 0; i < 60; i++) { g2.setInput(blankIntent()); g2.step(DT); anim2.update(DT, { x: b2.x, y: b2.y, z: b2.z, facing: b2.facing }, b2, g2, g2.ball); const f = anim2.f; turned += wrap(f - last); last = f; }
  assert.ok(turned > 2 * Math.PI - 0.05, `a full turn (${(turned / D).toFixed(0)}°)`);
  assert.ok(OP_FINISH.hold + OP_FINISH.out < 0.7, 'and it is over in well under a second');
});

test('nobody else throws them: a non-holder\'s passes carry no Oprah plan and his ball goes where it always went', () => {
  for (const icon of [null, 'sharp_eye', 'the_general', 'big_brother', 'open_arms', 'hash_slinging', 'the_clamp', 'sexy_red']) {
    const g = game(icon, 2);
    for (const [ang, type] of [[90, 'chest'], [175, 'bounce'], [5, 'lob'], [-140, 'chest'], [40, 'inbound']]) {
      const a = throwAt(g, ang, type);
      assert.equal(a.op, undefined, `${icon || 'none'} ${type}`);
      assert.equal(a.icon, null);
      assert.equal(g.players[0].opSeq, undefined);
      g.players[0].action = null;
    }
  }
  // the AI's passes too (an AI Oprah holder throws them; an AI without the badge never does)
  const g = new Game({ mode: 'practice', seed: 2, rosters: [[{ ...passer(null), human: false }, mateE], []], catalog });
  const a = throwAt(g, 90, 'chest'); assert.equal(a.op, undefined);
  const g2 = new Game({ mode: 'practice', seed: 2, rosters: [[{ ...passer('oprah'), human: false }, mateE], []], catalog });
  assert.ok(throwAt(g2, 90, 'chest').op);
  // the animator's hook only ever runs on a pass that carries the plan
  const anim = src('client/js/char/animator.js');
  assert.ok(anim.includes("if (a.op) { oprahPose(this, T, a, p, g, b); break; }"));
  assert.ok(anim.includes("if (a && a.type === 'pass' && a.op && !a.released) { oprahHands(this, T, p, a, b); return; }"));
  assert.ok(!anim.includes("a.icon === 'oprah'"), 'the old single flick is gone');
});
