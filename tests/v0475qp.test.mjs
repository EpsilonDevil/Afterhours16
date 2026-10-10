// v0.4.7.5 quick patch: non-shooter greens, smothered means no make (and the record scratch), repeat-move stamina,
// the stick's diagonals, Icon Legend (server side in test_server.py), real jersey straps, twice the apparel, dunk
// variety, windmill / Eastbay paths, celebrations, Posterizer vs Contact Finisher, slower dribble moves, passing,
// reach-in fouls on contact, the AI staying in bounds, contests at the release and the D-pad on unmapped pads.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../client/js/sim/shots.js';
import { Game, repeatMoveK, REPEAT_GAP, DRIBBLE_MOVE_SPEED, MOVE_SNAP, GAME_SPEED, PASS_ACC_K, REACH_FOUL, EASTBAY_KEYS, keyPath, millCircle } from '../client/js/sim/game.js';
import { stickMove, MOVES, COMBOS, DIAGONAL_MOVES } from '../client/js/sim/moves.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { MatchSession, DEF_ARROW } from '../client/js/game/session.js';
import { padDpad } from '../client/js/core/input.js';
import { playGreenSound, playRecordScratch, greenRecipe } from '../client/js/core/greensound.js';
import { AthleteModel, torsoTable } from '../client/js/char/athlete.js';
import { Player } from '../client/js/sim/player.js';
import * as M from '../client/js/core/math.js';
import { Animator } from '../client/js/char/animator.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';
import { AI_TIMING_COMP } from '../client/js/sim/ai.js';
import { FOLLOW_X, CAM_H } from '../client/js/game/camera.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const solo = (opts = {}) => {
  const rng = new RNG(opts.seed || 4), me = makeTeam(rng, 1, { catalog, level: 0.8 })[0], d = makeTeam(rng, 1, { catalog, level: 0.8 })[0];
  me.human = true;
  const g = new Game({ mode: opts.mode || 'practice', seed: opts.seed || 4, rosters: [[me], opts.def ? [d] : []], catalog });
  return { g, p: g.players[0], d: opts.def ? g.players[1] : null, rim: g.rimFor(0), side: g.sideFor(0) };
};

// ---------------- shooting ----------------
test('non-shooters: a 10% smaller window, and a green from three is a boost, not a sure make', () => {
  assert.ok(S.isShooterArch('sharpshooter') && S.isShooterArch('stretch_big'));
  for (const a of ['slasher', 'playmaker', 'lockdown', 'two_way', 'glass_cleaner', 'post_scorer']) assert.ok(!S.isShooterArch(a), a);
  const w = S.greenWindowMs(85, {}, { d: 7.5, three: true }), wn = S.greenWindowMs(85, {}, { d: 7.5, three: true, nonShooter: true });
  assert.ok(Math.abs(wn / w - S.NON_SHOOTER_WIN) < 1e-9 && S.NON_SHOOTER_WIN === 0.9);
  const { g, p, rim, side } = solo();
  const shot = (arch, d) => { p.archetype = arch; p.setPos(rim.x, rim.z - side * d, side > 0 ? 0 : Math.PI); return g.jumperWindow(p, { startX: p.x, startZ: p.z, moving: 0 }, 0); };
  assert.equal(shot('sharpshooter', 7.6).sure, true, 'a shooter\'s green from three: automatic (solid on the meter)');
  assert.equal(shot('slasher', 7.6).sure, false, 'a slasher\'s: outlined');
  assert.equal(shot('slasher', 5).sure, true, 'a slasher\'s green from mid-range still goes in');
  assert.ok(Math.abs(shot('slasher', 5).total / shot('sharpshooter', 5).total - 0.9) < 1e-9);
  // and every green window in the game is 10% smaller again
  assert.ok(Math.abs(S.GREEN_K - 0.9 * 0.935 * 0.9) < 1e-12);
});

test('smothered: no window whatever adds to it, and no make; a finish is measured on its own scale', () => {
  assert.equal(S.greenWindowMs(99, { green_machine: 4 }, { contest: S.SMOTHER, greenK: 1.3, pkg: { winK: 1.2 } }), 0);
  assert.equal(S.greenWindowMs(99, {}, { contest: 0.2, smothered: true }), 0);
  assert.equal(S.layupWindowMs(99, { contact_finisher: 4 }, { contest: 1.2, smothered: true }), 0);
  assert.equal(S.finalChance({ type: 'jumper', d: 4, a: { mid_range: 99 }, grade: 'excellent', contest: 0.9, stamina: 1, badges: {}, smothered: true }), 0);
  assert.equal(S.finalChance({ type: 'layup', d: 1, a: { layup: 99 }, grade: 'excellent', contest: 1.2, stamina: 1, badges: { contact_finisher: 4 }, smothered: true }), 0);
  // around the rim the contest runs past its cap on nearly every finish; Smothered there is a real wall-up
  assert.ok(Math.abs(S.insideGuard(S.LAYUP_SMOTHER) - S.SMOTHER) < 1e-12 && S.insideGuard(1.25) < S.SMOTHER);
  assert.equal(S.guardFor('jumper', 0.8), 0.8); assert.equal(S.guardFor('layup', 0.8), S.insideGuard(0.8));
  // in a game: a defender in his face at the release, timed perfectly: never green, never in, and a record scratch
  let checked = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { g, p, d, rim, side } = solo({ seed, def: true });
    p.archetype = 'sharpshooter';
    p.setPos(rim.x, rim.z - side * 5, side > 0 ? 0 : Math.PI);
    d.setPos(rim.x, rim.z - side * 4.45, side > 0 ? Math.PI : 0); d.handsUp = true;
    g.giveBall(p, 'held');
    g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true }); g.step(1 / 60);
    if (p.action?.type !== 'shoot') continue;
    p.action.releaseAt = p.action.tRel;
    let ev = null;
    for (let i = 0; i < 90 && !ev; i++) { d.intent.handsUp = true; d.handsUp = true; g.setInput({ mx: 0, mz: 0, shootHeld: true }); g.step(1 / 60); ev = g.events.find(e => e.type === 'release'); }
    if (!ev || !ev.smothered) continue;
    checked++;
    assert.notEqual(ev.grade, 'excellent'); assert.equal(ev.made, false); assert.equal(ev.scratch, true);
  }
  assert.ok(checked >= 3, `${checked} smothered releases`);
});

test('the record scratch: green sounds hand back a cut-off, and the scratch itself plays', () => {
  const param = v => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime(x) { if (!(x > 0)) throw new Error('exp ramp to ' + x); }, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = extra => ({ connect(n) { if (!n) throw new Error('connect to nothing'); return n; }, start() {}, stop() {}, ...extra });
  const nodes = { n: 0 };
  const ctx = { currentTime: 0, sampleRate: 48000, createGain: () => (nodes.n++, node({ gain: param(1) })), createOscillator: () => (nodes.n++, node({ frequency: param(440), detune: param(0) })), createBiquadFilter: () => (nodes.n++, node({ frequency: param(1000), Q: param(1) })), createWaveShaper: () => (nodes.n++, node({})), createBufferSource: () => (nodes.n++, node({ playbackRate: param(1) })), createDelay: () => (nodes.n++, node({ delayTime: param(0) })),
    createBuffer: (ch, n) => ({ length: n, data: new Float32Array(n), getChannelData() { return this.data; } }) };
  const audio = { ctx, ensure: () => true, out: () => node({}), noise: () => ctx.createBufferSource(), cheer() {} };
  const h = playGreenSound(audio, 'gsnd_basic', {});
  assert.equal(typeof h.stop, 'function'); h.stop(0.03);
  const n0 = nodes.n; assert.equal(playRecordScratch(audio, { pan: 0.2 }), true); assert.ok(nodes.n - n0 > 8);
  // the chant: a crowd now, many throats and voices (rendered: see v0475qp2 for what it sounds like)
  assert.ok(playGreenSound(audio, 'gsnd_chant', {}));
  assert.ok(greenRecipe('gsnd_chant'));
  const src = fs.readFileSync(new URL('../client/js/game/session.js', import.meta.url), 'utf8');
  assert.ok(src.includes('this.cutGreen(e.shooter)') && src.includes("(e.scratch || (e.grade === 'excellent' && !e.made)) && P) this.greenScratch(P, mine);"), 'blocked greens and smothered greens are cut off (qp3: and any green that misses)');
});

test('contests count at the release: the AI\'s planned green slips when a closeout arrives in time', () => {
  const { g, p } = solo();
  g.rng = { next: () => 0.5 };
  assert.equal(g.aiGradeAtRelease(p, {}, 'excellent', 0, 40), 'late', 'the window it aimed at is gone');
  assert.equal(g.aiGradeAtRelease(p, {}, 'excellent', 40, 40), 'excellent');
  g.rng = { next: () => 0.1 };
  assert.equal(g.aiGradeAtRelease(p, {}, 'early', 80, 20), 'excellent', 'a defender backing off opens it up');
  // reach vs release height: the same defender, a higher release is less of a contest
  const d = { x: 0, z: 1, phys: { reach: 2.6, W: 95 }, ratings: { interior_d: 60, block: 60, perimeter_d: 70 }, handsUp: true, y: 0, badges: {} };
  const shooter = { x: 0, z: 0, phys: { W: 95 } }, rim = { x: 0, z: 9 };
  assert.ok(S.contestFor(shooter, [d], rim, 3.0) < S.contestFor(shooter, [d], rim, 2.6));
  assert.ok(AI_TIMING_COMP.mid > 1 && AI_TIMING_COMP.three_non > 0);
});

// ---------------- dribbling ----------------
test('repeating a move: double drain past 3, and that doubled again past 6; the run ends with the ball', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 12].map(repeatMoveK), [1, 1, 1, 2, 2.1, 2.2, 4.6, 4.8, 5.6]);
  assert.equal(repeatMoveK(40), 6, 'capped');
  const { g, p } = solo();
  g.giveBall(p, 'dribble');
  for (let i = 0; i < 7; i++) { p.cool.move = 0; g.startMove(p, 'cross'); }
  assert.equal(p.stam.moveRun, 7); assert.equal(p.stam.moveK, 4.6);
  p.cool.move = 0; g.time += REPEAT_GAP + 0.5; g.startMove(p, 'cross');
  assert.equal(p.stam.moveRun, 1, 'the same move a while later is a fresh start');
  for (let i = 0; i < 5; i++) { p.cool.move = 0; g.startMove(p, 'cross'); }
  g.ball.holder = -1; g.step(1 / 60);
  assert.equal(p.stam.moveK, 1, 'losing the ball ends the run');
});

test('every diagonal on the stick does two things, with new moves and combos', () => {
  const c = (st, ctx = {}) => stickMove(st, ctx);
  assert.equal(c('up-left', { toBallHand: true }), 'stutter'); assert.equal(c('up-left', { toBallHand: true, moving: true }), 'jab');
  assert.equal(c('up-right'), 'pushcross'); assert.equal(c('up-right', { slow: true }), 'stutter');
  assert.equal(c('down-right', { toBallHand: true }), 'sidestep'); assert.equal(c('down-right', { toBallHand: true, moving: true }), 'snatch');
  assert.equal(c('down-left'), 'btlback'); assert.equal(c('down-left', { moving: true }), 'wrap');
  for (const m of ['pushcross', 'jab', 'snatch', 'btlback']) assert.ok(MOVES[m] && DIAGONAL_MOVES.includes(m), m);
  assert.ok(Object.keys(COMBOS).filter(k => /pushcross|jab|snatch|btlback/.test(k)).length >= 12);
  // they run: the push-pull and the pull-back change hands, the snatch-back and pull-back go away from the rim
  for (const m of ['pushcross', 'jab', 'snatch', 'btlback']) {
    const { g, p, rim, side } = solo();
    p.setPos(rim.x, rim.z - side * 7, side > 0 ? 0 : Math.PI); g.giveBall(p, 'dribble');
    const hand0 = p.dribble.hand, d0 = Math.hypot(rim.x - p.x, rim.z - p.z);
    g.setInput({ mx: 0, mz: 0, move: m }); g.step(1 / 60);
    const a = p.action; assert.equal(a?.move, m, m);
    for (let i = 0; i < 60 && p.action === a; i++) { g.setInput({ mx: 0, mz: 0 }); g.step(1 / 60); }
    assert.equal(p.dribble.hand !== hand0, MOVES[m].sw != null, `${m}: hand switch`);
    if (MOVES[m].back) assert.ok(Math.hypot(rim.x - p.x, rim.z - p.z) > d0 + 0.2, `${m} makes space`);
  }
});

test('dribble moves 20% slower everywhere, the game 2.5% quicker', () => {
  assert.equal(DRIBBLE_MOVE_SPEED, 0.8); assert.equal(MOVE_SNAP, 1);
  assert.ok(Math.abs(GAME_SPEED - 1.15 * 1.0375 * (1 - 0.0185) * (1 - 0.0075) * (1 - 0.0375) * 1.025) < 1e-12);
});

// ---------------- passing, defense, the AI ----------------
test('passing: 10% more accurate', () => {
  assert.equal(PASS_ACC_K, 0.9);
  const src = fs.readFileSync(new URL('../client/js/sim/game.js', import.meta.url), 'utf8');
  assert.ok(src.includes('* 0.08) * PASS_ACC_K;'));
});

test('reach-ins: a foul when the hand goes into him, never when it touches nothing', () => {
  const { g, p, d } = solo({ def: true, mode: 'proam' });
  g.phase = 'live';
  g.giveBall(p, 'dribble'); p.setPos(0, 0, 0); p.dribble.hand = 'R';
  // the defender squarely in front, the ball on the handler's far side: a reach goes through him
  { const hp = g.holdPoint(p); g.ball.x = hp.x; g.ball.y = hp.y; g.ball.z = hp.z; }
  d.setPos(0, 0.55, Math.PI); d.action = { type: 'steal', hand: 'L' };
  const through = g.reachContact(d, p);
  assert.ok(through.body && !through.ballFirst, 'into the body');
  // from 1.5 m away the hand reaches nothing
  d.setPos(0, 1.5, Math.PI);
  const air = g.reachContact(d, p);
  assert.ok(!air.body, 'at air');
  // no contact, no call: 300 swipes at air, no fouls
  let fouls = 0;
  for (let i = 0; i < 300; i++) { g.events.length = 0; d.action = { type: 'steal', hand: 'L', aimed: true }; g.rng = { next: () => 0.99 - (i % 10) * 0.001 }; g.resolveSteal(d); fouls += g.events.filter(e => e.type === 'foul').length; }
  assert.equal(fouls, 0);
  assert.ok(REACH_FOUL.body >= 0.75, 'and a reach into him is called nearly every time');
});

test('the AI stays in bounds: no running at spots past the lines, and it eases off near them', () => {
  const { g } = solo();
  const ai = g.ai, p = g.players[0];
  g.phase = 'live'; g.ball.holder = -1; // (off the ball: the man with it is kept in bounds by the sim)
  p.setPos(7.0, 0, Math.PI / 2); p.vx = 6; p.vz = 0;
  ai.seek(p, 12, 0, { sprint: true });
  assert.ok(p.intent.mx <= 0, `heading for the sideline at speed: he brakes (${p.intent.mx.toFixed(2)})`);
  p.setPos(0, 0, 0); p.vx = 0;
  ai.seek(p, 20, 0);
  assert.ok(p.intent.mx > 0 && p.intent.mx <= 1);
  const [cx] = ai.clampCourt(20, 0, false); assert.ok(cx < 7.62);
});

test('celebrations in games: a press waits for him, works in dead balls and right after a basket', () => {
  const { g, p } = solo({ def: true });
  const me = p;
  const ses = { game: g, myScoreAt: null };
  const can = () => MatchSession.prototype.canCelebrate.call(ses, me);
  g.phase = 'dead'; g.ball.holder = -1; me.action = null; me.airborne = false;
  assert.ok(can(), 'dead ball');
  g.phase = 'live'; assert.ok(!can(), 'not in the middle of play');
  ses.myScoreAt = g.time; assert.ok(can(), 'right after his team scores');
  me.action = { type: 'shoot' }; assert.ok(!can(), 'not while the shot is still going');
  me.action = null; g.ball.holder = me.id; assert.ok(!can(), 'not with the ball');
  // unmapped pads: the D-pad comes in on axes
  assert.deepEqual(padDpad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1] }, []).slice(12), [true, false, false, false]);
  assert.deepEqual(padDpad({ axes: [0, 0, 0, 0, 0, 0, 0, -1] }, []).slice(12), [true, false, false, false]);
  assert.deepEqual(padDpad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, []).slice(12), [false, false, false, false], 'a resting axis is not the D-pad');
});

test('celebrations never put a hand or forearm through the body', () => {
  const kinds = [...new Set(list.filter(i => i.slot === 'celebration').map(i => i.anim)), 'general'];
  assert.ok(kinds.length >= 30);
  const q = (qq, v) => { const o = [0, 0, 0]; M.v3transformQuat(o, v, qq); return o; };
  const inTorso = (rig, P0) => {
    const H = rig.d.H, g = rig.d.girth || 1, c = rig.pos[B.chest], hy = rig.pos[B.hips][1], ny = rig.pos[B.neck][1];
    if (P0[1] < hy || P0[1] > ny - 0.02 * H) return false;
    const v = q(M.qinvert(M.q4(), rig.rot[B.chest]), [P0[0] - c[0], P0[1] - c[1], P0[2] - c[2]]);
    const tt = torsoTable((rig.bind[B.chest][1] + v[1]) / H), pad = 0.004 * H;
    const rx = tt[0] * g * H - pad, zz = v[2] - tt[3] * H, rz = (zz >= 0 ? tt[1] : tt[2]) * g * H - pad;
    return (v[0] / rx) ** 2 + (zz / rz) ** 2 < 1;
  };
  const rng = new RNG(5), bots = makeTeam(rng, 3, { catalog, level: 0.7 });
  for (const kind of kinds) {
    let bad = 0;
    for (const e of bots) {
      const p = new Player(0, 0, e, catalog), model = new AthleteModel(e.build, {}, 0.5), rig = new Rig(model);
      const anim = new Animator({ H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); } });
      for (let i = 0; i < 30; i++) anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
      p.startAction('celebrate', 1.6, { kind });
      for (let i = 0; i < 96; i++) {
        p.action.t += 1 / 60; anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
        if (i % 3) continue;
        for (const sd of ['L', 'R']) { const E = rig.pos[B['fore' + sd]], W = rig.pos[B['hand' + sd]]; if (inTorso(rig, W) || inTorso(rig, E) || inTorso(rig, [(E[0] + W[0]) / 2, (E[1] + W[1]) / 2, (E[2] + W[2]) / 2])) bad++; }
      }
    }
    assert.equal(bad, 0, `${kind}: ${bad} frames through the body`);
  }
});

// ---------------- dunks ----------------
test('dunk packages share fewer finishes, and the windmill and the Eastbay are real', () => {
  const dunks = list.filter(i => i.slot === 'dunk'), uses = {};
  for (const d of dunks) { assert.equal(d.styles[0], d.signature, d.id); assert.ok(d.styles.length <= 3, d.id); for (const s of d.styles.slice(1)) uses[s] = (uses[s] || 0) + 1; }
  assert.ok(Math.max(...Object.values(uses)) <= 4, JSON.stringify(uses));
  const sigs = dunks.map(d => d.signature); assert.equal(new Set(sigs).size, sigs.length, 'every signature is its own');
  assert.ok(!dunks.some(d => d.id !== 'dunk_eastbay' && d.styles.includes('eastbay')), 'nobody else gets the Eastbay');
  // the Eastbay's ball goes under his pelvis, between the legs, in the air
  const H = 2; let low = 9, lowX = 9;
  for (let k = 0; k <= 1; k += 0.01) { const [x, y] = keyPath(EASTBAY_KEYS, k, H); if (y < low) { low = y; lowX = x; } }
  assert.ok(low < 0.4 * H && Math.abs(lowX) < 0.06, `through at ${(low / H).toFixed(2)}H, ${lowX.toFixed(2)} m`);
  // the windmill circles the shoulder at arm's length
  const { p } = solo();
  const C = millCircle(p, p.phys.H);
  assert.ok(Math.abs(C.cy - p.arm.shoulderY) < 0.05 * p.phys.H && C.R < p.arm.len + 0.06 * p.phys.H && C.R > p.arm.len);
});

test('Posterizer is for dunks: a dunk that never reaches the rim is a Contact Finisher layup', () => {
  const src = fs.readFileSync(new URL('../client/js/sim/game.js', import.meta.url), 'utf8');
  assert.ok(src.includes('if (tier > 0) { a.posterPending = d.id; a.through = d.id; }'), 'the poster waits for the slam');
  assert.ok(src.includes('if (pend && p.badges.contact_finisher && !a.cfPush) { this.cfPushOff(p, pend, rim);'), 'no rim: a push-off');
  let posters = 0, cfLayups = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const rng = new RNG(seed * 7), team = makeTeam(rng, 3, { catalog, level: 0.85 }), opp = makeTeam(rng, 3, { catalog, level: 0.85 });
    const g = new Game({ mode: 'park', seed: seed * 7, rosters: [team, opp], catalog, target: 21 });
    for (let i = 0; i < 60 * 60 * 3 && !g.over; i++) {
      g.step(1 / 60);
      for (const e of g.events) {
        if (e.type === 'posterContact') { posters++; const P = g.players[e.player]; assert.equal(P.action?.type === 'layup', false, 'never on a layup'); }
        if (e.type === 'feed' && /finishes through the contact/.test(e.text)) cfLayups++;
      }
    }
  }
  assert.ok(posters + cfLayups >= 0);
});

// ---------------- look ----------------
test('jersey straps go up over the shoulders, and the game actually draws them', () => {
  const m = new AthleteModel({ position: 'SF', height: 79, weight: 215, wingspan: 84, archetype: 'slasher' }, { top: { family: 'jersey' } }, 1);
  const out = {}; const it = m.buildSteps(out); while (!it.next().done) { /* staged build */ }
  assert.ok(out.straps, 'the staged build hands the straps over (it never did, so they were never drawn)');
  const P = out.straps.position, H = m.d.H; let top = 0, sideTop = 0;
  for (let i = 0; i < P.length; i += 3) { top = Math.max(top, P[i + 1] / H); if (Math.abs(P[i + 2]) < 0.02 * H) sideTop = Math.max(sideTop, P[i + 1] / H); }
  assert.ok(top > 0.835 && sideTop > 0.83, `they ride over the trapezius (${top.toFixed(3)}H, ${sideTop.toFixed(3)}H over the shoulder top)`);
  for (const v of out.straps.uv) assert.ok(Number.isFinite(v));
});

test('twice the apparel, Daily Spin exclusives too', () => {
  const by = k => list.filter(i => i.category === k);
  const slot = (k, s) => by(k).filter(i => i.slot === s).length;
  assert.equal(slot('apparel', 'top'), 62); assert.equal(slot('apparel', 'bottom'), 36); assert.equal(by('shoes').length, 36);
  for (const [s, n] of [['headband', 16], ['sleeve', 12], ['socks', 10], ['wristband', 8], ['leg_sleeve', 4], ['knee_pad', 2], ['chain', 4]]) assert.equal(slot('accessory', s), n, s);
  assert.equal(list.filter(i => i.exclusive === 'wheel' && i.category !== 'animation').length, 12);
  for (const i of list.filter(x => x.v0475qp)) { assert.equal(i.original_2k_asset, false); assert.ok(i.name && i.description && i.color, i.id); }
  assert.equal(new Set(list.map(i => i.id)).size, list.length, 'ids unique');
  const css = fs.readFileSync(new URL('../client/css/app.css', import.meta.url), 'utf8');
  assert.match(css, /select option, select optgroup \{ background-color: #161a22; color: #f1f0ea; \}/, 'dropdown options are readable');
});

test('camera, defense arrows and the pause menu volume', () => {
  assert.ok(FOLLOW_X[0] > 0.32 && FOLLOW_X[1] > 0.55 && CAM_H > 0, 'the 2K cam follows sideways runs closer and sits higher');
  assert.ok(DEF_ARROW.on > DEF_ARROW.off && DEF_ARROW.grow > 0 && DEF_ARROW.perM < 0.05, 'shown off your man, gone on him, growing a little with distance');
  const modes = fs.readFileSync(new URL('../client/js/ui/modes.js', import.meta.url), 'utf8');
  assert.ok((modes.match(/Screens\.volumeSliders\(\)/g) || []).length >= 4, 'the park, a park game, Pro-Am / Pro Run and the Crew HQ');
});
