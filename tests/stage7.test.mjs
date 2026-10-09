// v0.4.5 stage 7: the final pass before shipping. Out of bounds on the painted lines, alley-oops only for
// teammates who can get there, auto-play that stays on, AI that attacks after an ankle-breaker, every animation
// package visibly its own (store preview and games), 10% smaller green windows, and the hitch-free athlete pool.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { COURT, LINE_W, FOOT_R, ballOut, feetOut } from '../client/js/sim/constants.js';
import * as S from '../client/js/sim/shots.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

// ---------------- out of bounds ----------------
test('out of bounds is the painted line: on the line is out, for the ball and for a foot', () => {
  const W = COURT.width / 2, L = COURT.length / 2;
  assert.ok(Math.abs(LINE_W - 0.0508) < 1e-9, 'lines are 2 inches wide');
  // the court's measurements run to the inside edge of the lines, so the line itself is out
  assert.equal(ballOut(W - 0.001, 0), false, 'just inside the sideline');
  assert.equal(ballOut(W, 0), true, 'touching the line');
  assert.equal(ballOut(0, L), true, 'baseline');
  assert.equal(ballOut(0, -0.05, true), true, 'half court: past the half-court line is out');
  assert.equal(ballOut(0, 0.05, true), false);
  // a foot (FOOT_R from the player's center) on the line is out
  assert.equal(feetOut(W - FOOT_R - 0.001, 0), false);
  assert.equal(feetOut(W - FOOT_R + 0.001, 0), true);
  assert.equal(feetOut(0, L - FOOT_R + 0.001), true);
  assert.equal(feetOut(0, FOOT_R - 0.001, true), true, 'half court: a foot on the half-court line');
});

function liveGame(seed = 5, full = true, human = false) {
  const rng = new RNG(seed);
  const rosters = [makeTeam(rng, 3, { catalog, level: 0.7 }), makeTeam(rng, 3, { catalog, level: 0.7 })];
  if (human) rosters[0][0].human = true;
  const g = new Game({ mode: 'park', full, seed, rosters, catalog, target: 21, difficulty: 0.6 });
  for (let i = 0; i < 600 && g.phase !== 'live'; i++) g.step(1 / 60);
  assert.equal(g.phase, 'live');
  return g;
}

test('a ball handler with a foot on the sideline turns it over (yours: the AI never steps out on its own)', () => {
  const g = liveGame(5, true, true);
  const h = g.human;
  g.setInput({ mx: 0, mz: 0 });
  g.giveBall(h, 'held'); g.possession = 0;
  for (const p of g.players) if (p !== h) p.setPos(0, 0, 0);
  h.setPos(COURT.width / 2 - FOOT_R + 0.02, g.sideFor(0) * 5, 0);
  g.ai.think = () => {};
  let why = null;
  for (let i = 0; i < 5 && !why; i++) { g.step(1 / 60); for (const e of g.events) if (e.type === 'turnover') why = e.why; }
  assert.equal(why, 'Out of bounds');
});

// ---------------- alley-oops ----------------
test('alley-oops: a teammate near the paint gets one, one at half court gets a lob instead', () => {
  for (const [rx, rz, oopOk] of [[1.5, 3.5, true], [0, 13, false], [-5, 9, false]]) {
    const g = liveGame(7);
    const side = g.sideFor(0), rim = g.rimFor(0), [h, r] = g.teams[0];
    g.giveBall(h, 'held'); g.possession = 0;
    h.setPos(rim.x - 6, rim.z - side * 6, 0);
    r.setPos(rx, rim.z - side * rz, 0);
    for (const d of g.teams[1]) d.setPos(d.x, -rim.z * 0.9, 0);
    r.raw.driving_dunk = 95; r.phys.vertical = 0.85;
    assert.equal(g.oopReachable(h, r), oopOk, `reachable from (${rx}, ${rz})`);
    g.startPass(h, { target: r.id, type: 'alley' });
    assert.equal(h.action?.ptype, oopOk ? 'alley' : 'lob');
    let maxAir = 0, oop = false;
    for (let i = 0; i < 240; i++) { g.step(1 / 60); if (r.action?.type === 'oop') oop = true; if (r.airborne) maxAir = Math.max(maxAir, Math.hypot(r.vx, r.vz)); }
    assert.equal(oop, oopOk);
    // (a running catch-and-jump is ~4.6 m/s; flying in from half court was 8+)
    assert.ok(maxAir <= 5.0, `nobody flies in from far away (air speed ${maxAir.toFixed(3)} m/s from (${rx}, ${rz}))`);
  }
});

// ---------------- auto-play ----------------
test('auto-play stays on from one game to the next until you turn it off (not in the shootaround)', async () => {
  const { settings } = await import('../client/js/core/settings.js');
  const { startsOnAutoPlay, toggleAutoPlay } = await import('../client/js/game/session.js');
  settings.autoPlay = false;
  assert.equal(startsOnAutoPlay({ mode: 'park' }), false, 'off by default');
  const g = { mode: 'park', assist: false };
  toggleAutoPlay(g);
  assert.equal(g.assist, true);
  for (const mode of ['park', 'proam']) assert.equal(startsOnAutoPlay({ mode }), true, `${mode}: still on in the next game`);
  assert.equal(startsOnAutoPlay({ mode: 'practice' }), false, 'the shootaround always starts with you in control');
  assert.equal(startsOnAutoPlay({ mode: 'park', background: true }), false, 'AI-only games use their own flag');
  const pr = { mode: 'practice', assist: false };
  toggleAutoPlay(pr); toggleAutoPlay(pr);
  assert.equal(settings.autoPlay, true, 'toggling in the shootaround leaves the setting alone');
  toggleAutoPlay(g);
  assert.equal(startsOnAutoPlay({ mode: 'park' }), false, 'turned off: stays off');
});

// ---------------- AI after an ankle-breaker ----------------
test('after an ankle-breaker, slashers, playmakers and bigs attack the rim; shooters let it fly', () => {
  for (const [arch, want] of [['slasher', 'drive'], ['playmaker', 'drive'], ['glass_cleaner', 'drive'], ['post_scorer', 'drive'], ['sharpshooter', 'shoot'], ['stretch_big', 'shoot'], ['lockdown', 'shoot']]) {
    const g = liveGame(11);
    const side = g.sideFor(0), rim = g.rimFor(0), p = g.teams[0][1];
    p.entry.build.archetype = arch;
    g.giveBall(p, 'dribble'); g.possession = 0; g.needsClear[0] = false;
    p.setPos(rim.x + 2, rim.z - side * 6.4, 0);
    p.ankleT = g.time;
    g.ai.handler(p, 1 / 60);
    const o = g.ai.m(p);
    if (want === 'drive') assert.ok(o.plan === 'drive' && o.attack, `${arch}: drives it in (plan ${o.plan})`);
    else assert.equal(p.intent.shoot, 'press', `${arch}: shoots it`);
  }
});

// ---------------- green windows ----------------
test('every green window is 10% smaller (and 6.5% more since the quick patch)', () => {
  for (const v of [50, 70, 85, 99]) {
    const sub = v < 70 ? 0.9 : 1;
    assert.ok(Math.abs(S.greenWindowMs(v, {}, {}) - Math.max(9, S.timingWindowMs(v) * sub) * S.GREEN_K) < 1e-9, `jumper ${v}`);
    assert.ok(Math.abs(S.greenWindowMs(v, {}, { ft: true }) - S.timingWindowMs(v) * sub * 1.15 * S.GREEN_K) < 1e-9, `free throw ${v}`);
  }
  assert.ok(Math.abs(S.GREEN_K - 0.9 * 0.935 * 0.9) < 1e-12); // (v0.4.7.5 quick patch: 10% more off)
  assert.equal(S.greenWindowMs(90, {}, { contest: S.SMOTHER }), 0, 'smothered is still no window at all');
});

// ---------------- animation packages ----------------
// Each package is traced through its store preview (the same code the Showroom draws) with the real animator
// and rig: hands, feet, forearms, head, hips and the ball every 3 frames. Two packages differ by how far apart
// the closest limb-or-ball pair gets during the distinctive part of the move (the biggest third of the moments).
async function tracer() {
  const { PreviewSim } = await import('../client/js/game/preview.js');
  const { Animator } = await import('../client/js/char/animator.js');
  const { AthleteModel } = await import('../client/js/char/athlete.js');
  const { Rig } = await import('../client/js/char/rig.js');
  const { B } = await import('../client/js/char/skeleton.js');
  const base = { height: 78, weight: 210, wingspan: 82, hand: 'R', attributes: {}, equipment: { jumpshot: 'js_base_standard', release: 'release_classic', dunk: 'dunk_basic', sizeup: 'sizeup_basic', layup: 'layup_basic', celebration: 'celly_flex' } };
  const J = ['handL', 'handR', 'footL', 'footR', 'head', 'hips', 'foreL', 'foreR'].map(k => B[k]);
  const rigFor = build => { const model = new AthleteModel(build, {}, 1), rig = new Rig(model); return { model, rig, view: { H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } } }; };
  const sample = (rig, y, ball) => [...J.map(j => [rig.pos[j][0], rig.pos[j][1] + y, rig.pos[j][2]]), ball ? [ball.x, ball.y, ball.z] : [0, -1, 0]];
  // the store preview
  const preview = (equip, kind, opts, dur) => {
    const build = { ...base, equipment: { ...base.equipment, ...equip } };
    const sim = new PreviewSim(); sim.setPlayer(build, catalog); sim.setPreview(kind, opts);
    const { view } = rigFor(build), anim = new Animator(view), out = [];
    for (let i = 0; i < Math.round(dur * 60); i++) {
      const o = sim.step(1 / 60, 0), p = sim.player;
      anim.update(1 / 60, { x: 0, y: p.y + 0.12, z: 0, facing: 0 }, p, null, o.ball, { hasBall: o.hasBall, ballMode: o.ballMode, floorY: 0.12 });
      if (i % 3 === 0) out.push(sample(view.rig, view.y, o.ball));
    }
    return out;
  };
  // a real game: a practice possession, the same action started the way the game starts it
  const game = (equip, start, dur) => {
    const rng = new RNG(3), me = makeTeam(rng, 1, { catalog, level: 0.8 })[0];
    Object.assign(me.build, { height: 78, weight: 210, wingspan: 82, hand: 'R' });
    me.build.equipment = { ...me.build.equipment, ...base.equipment, ...equip };
    me.human = true;
    const g = new Game({ mode: 'practice', seed: 3, rosters: [[me], []], catalog });
    const p = g.players[0], { view } = rigFor(me.build), anim = new Animator(view), out = [];
    start(g, p);
    for (let i = 0; i < Math.round(dur * 60); i++) {
      g.step(1 / 60);
      const b = g.ball;
      anim.update(1 / 60, { x: p.x, y: p.y, z: p.z, facing: p.facing }, p, g, { x: b.x, y: b.y, z: b.z });
      // character space: take the player's own position (and turn) out of the ball
      const c = Math.cos(p.facing), s = Math.sin(p.facing), dx = b.x - p.x, dz = b.z - p.z;
      if (i % 3 === 0) out.push(sample(view.rig, view.y, { x: c * dx - s * dz, y: b.y, z: s * dx + c * dz }));
    }
    return out;
  };
  const dist = (a, b) => {
    const ms = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) { let m = 0; for (let j = 0; j < a[i].length; j++) m = Math.max(m, Math.hypot(a[i][j][0] - b[i][j][0], a[i][j][1] - b[i][j][1], a[i][j][2] - b[i][j][2])); ms.push(m); }
    ms.sort((x, y) => y - x);
    const k = Math.max(1, Math.round(ms.length / 3));
    return ms.slice(0, k).reduce((x, y) => x + y, 0) / k;
  };
  const closest = traces => {
    let best = [Infinity];
    for (let i = 0; i < traces.length; i++) for (let j = i + 1; j < traces.length; j++) { const d = dist(traces[i][1], traces[j][1]); if (d < best[0]) best = [d, traces[i][0], traces[j][0]]; }
    return best;
  };
  return { preview, game, closest };
}
const anims = slot => list.filter(i => i.category === 'animation' && i.slot === slot);
const MIN = 0.17; // meters: some limb or the ball is at least this far from where the other package puts it

test('store preview: every package in every animation category is visibly different from the rest', async () => {
  const { preview, closest } = await tracer();
  const cats = {
    jumpshot: anims('jumpshot').map(i => [i.id, preview({ jumpshot: i.id }, 'jumpshot', {}, 2.4)]),
    release: anims('release').map(i => [i.id, preview({ release: i.id }, 'jumpshot', {}, 2.4)]),
    dunk: anims('dunk').map(i => [i.id, preview({ dunk: i.id }, 'dunk', { style: i.signature, styles: [i.signature] }, 2.5)]),
    layup: anims('layup').map(i => [i.id, preview({ layup: i.id }, 'layup', { style: i.style }, 2.5)]),
    sizeup: anims('sizeup').map(i => [i.id, preview({ sizeup: i.id }, 'moves', { style: i.style, lvl: i.lvl, speed: i.move_speed }, 4.8)]),
    celebration: anims('celebration').map(i => [i.id, preview({ celebration: i.id }, 'celebrate', { kind: i.anim }, 2.4)]),
  };
  for (const [cat, traces] of Object.entries(cats)) {
    const [d, a, b] = closest(traces);
    assert.ok(d >= MIN, `${cat}: ${a} and ${b} are only ${(d * 100).toFixed(1)} cm apart`);
  }
});

test('in games: jump-shot bases, releases, dunk signatures and layups are just as different', async () => {
  const { game, closest } = await tracer();
  const shoot = (g, p) => {
    const rim = g.rimFor(0); p.setPos(rim.x, rim.z - g.sideFor(0) * 5, 0);
    g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true });
    for (let i = 0; i < 30 && p.action?.type !== 'shoot'; i++) { g.step(1 / 60); g.setInput({ mx: 0, mz: 0, shootHeld: true }); }
    p.action.releaseAt = p.action.tRel;
  };
  const finish = kind => (g, p) => {
    const rim = g.rimFor(0), side = g.sideFor(0); p.setPos(rim.x, rim.z - side * 2.6, 0); p.facing = side > 0 ? 0 : Math.PI;
    p.vx = 0; p.vz = side * 4.5; g.giveBall(p, 'dribble');
    if (kind === 'dunk') g.startDunk(p, rim, {}); else g.startLayup(p, rim, {});
  };
  const cats = {
    jumpshot: anims('jumpshot').map(i => [i.id, game({ jumpshot: i.id }, shoot, 1.6)]),
    release: anims('release').map(i => [i.id, game({ release: i.id }, shoot, 1.6)]),
    layup: anims('layup').map(i => [i.id, game({ layup: i.id }, finish('layup'), 1.5)]),
  };
  // dunks: the package's signature finish, the one that's about half of its dunks in a game
  cats.dunk = anims('dunk').map(i => [i.id, game({ dunk: i.id }, (g, p) => { g.dunkStyle = () => i.signature; p.raw.driving_dunk = 99; finish('dunk')(g, p); }, 1.6)]);
  for (const [cat, traces] of Object.entries(cats)) {
    const [d, a, b] = closest(traces);
    assert.ok(d >= MIN, `${cat} in a game: ${a} and ${b} are only ${(d * 100).toFixed(1)} cm apart`);
  }
});

test('dunk packages: every one has its own signature finish, shown first in the store and about half of its dunks', () => {
  const pk = anims('dunk');
  const sigs = pk.map(i => i.signature);
  assert.equal(new Set(sigs).size, pk.length, 'no two packages share a signature');
  for (const i of pk) {
    assert.equal(i.styles[0], i.signature, `${i.id}: the store shows the signature first`);
    assert.ok(S.STYLE_FLAIR[i.signature] != null, `${i.id}: ${i.signature} has a flair value`);
  }
  const rng = new RNG(9), me = makeTeam(rng, 1, { catalog, level: 0.9 })[0];
  const g = new Game({ mode: 'practice', seed: 9, rosters: [[me], []], catalog });
  const p = g.players[0];
  for (const i of pk) {
    p.dunkPkg = i.id;
    let n = 0;
    for (let k = 0; k < 600; k++) if (g.dunkStyle(p) === i.signature) n++;
    assert.ok(n / 600 > 0.4, `${i.id}: signature ${(n / 6).toFixed(0)}% of open-court dunks`);
  }
});

test('releases: each has its own release time and launch angle; size-ups each change the dribble', () => {
  const rel = anims('release');
  assert.equal(new Set(rel.map(i => i.release_seconds)).size, rel.length, 'release times are all different');
  assert.equal(new Set(rel.map(i => i.arc)).size, rel.length, 'launch angles are all different');
  const su = anims('sizeup');
  const sig = s => JSON.stringify(S.SIZEUP[s.style]);
  for (const s of su) assert.ok(S.SIZEUP[s.style], `${s.id}: profile`);
  assert.equal(new Set(su.map(sig)).size, su.length, 'every size-up has its own dribble profile');
  const bases = anims('jumpshot');
  assert.equal(new Set(bases.map(i => i.style)).size, bases.length, 'every base has its own style');
});

// ---------------- the athlete pool ----------------
test('athlete pool: reuse by look, builds a slice per frame, cancels cleanly, never keeps too many', async () => {
  const { AthleteView } = await import('../client/js/char/view.js');
  const { VisualPool, visualKey } = await import('../client/js/game/vispool.js');
  const made = [], orig = AthleteView.staged;
  AthleteView.staged = () => {
    const v = { disposed: false, scene: 1, removeFrom() { this.scene = null; }, setVisible(x) { this.visible = x; }, dispose() { this.disposed = true; } };
    made.push(v);
    return { view: v, steps: (function* () { for (let i = 0; i < 4; i++) yield; })() };
  };
  try {
    const pool = new VisualPool({}, { maxFree: 2 });
    const b = { height: 78, weight: 200, wingspan: 80 }, look = { skin: '#a56945' };
    const k = visualKey(b, look, { detail: 0.75 });
    assert.notEqual(k, visualKey(b, look, { detail: 1 }), 'detail is part of the key');
    let got = null;
    pool.request(k, b, look, { detail: 0.75 }, v => { got = v; });
    pool.tick(0); assert.equal(got, null, 'one step per tick at the least');
    for (let i = 0; i < 6 && !got; i++) pool.tick(0);
    assert.ok(got, 'built over a few frames');
    pool.release(k, got);
    assert.equal(pool.take(k), got, 'the same person gets the same athlete back');
    assert.equal(pool.take(k), null);
    // cancel: unstarted builds are dropped, started ones finish into the pool
    const j1 = pool.request('a', b, look, {}, () => assert.fail('cancelled'));
    pool.cancel(j1); pool.flush();
    assert.equal(pool.free.size, 0, 'an unstarted build is just dropped');
    const j2 = pool.request('c', b, look, {}, () => assert.fail('cancelled'));
    pool.tick(0); pool.cancel(j2); pool.flush();
    assert.equal(pool.take('c'), made.at(-1), 'a half-built one finishes into the pool');
    // at most maxFree kept; the oldest are freed
    for (const key of ['x', 'y', 'z']) pool.release(key, { removeFrom() {}, setVisible() {}, dispose() { this.disposed = true; } });
    assert.equal(pool.lru.length, 2);
    // urgent builds go ahead of the queue
    const order = [];
    pool.request('n1', b, look, {}, () => order.push('n1'));
    pool.request('u', b, look, {}, () => order.push('u'), true);
    pool.flush();
    assert.deepEqual(order, ['u', 'n1']);
  } finally { AthleteView.staged = orig; }
});
