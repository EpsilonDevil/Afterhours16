// v0.4.7.5 quick patch (the very last of it): your line on the Locked-In grade (PTS REB AST / STL BLK TO), the AI
// reacting faster (off the catch, on the pass, after a move that made space, to open lanes and in transition),
// moving without sprint is stamina-neutral, and recovery is 1.2x.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { STAMINA_RECOVER_K, REST_RECOVER_K, MOVE_RECOVER_K } from '../client/js/sim/player.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url), 'utf8')).map(i => [i.id, i]));
const game = (seed, size = 3, mode = 'park') => {
  const rng = new RNG(seed);
  return new Game({ mode, seed, rosters: [makeTeam(rng, size, { catalog, level: 0.6 }), makeTeam(rng, size, { catalog, level: 0.6 })], catalog, target: 21, quarterLen: 120, quarters: 4, difficulty: 0.6 });
};

test('stamina: moving without sprint recovers a very little, sprinting drains, and standing recovers 2x (on top of the 1.2x)', () => {
  const g = game(3), p = g.players[0];
  p.stam.grade = null; p.hot = 0; p.cold = false;
  assert.equal(STAMINA_RECOVER_K, 1.2); assert.equal(REST_RECOVER_K, 2.8); assert.equal(MOVE_RECOVER_K, 0.1);
  // jog across the floor without the sprint button: a very small recovery (quick patch 3; it was neutral)
  p.intent = { ...p.intent, mx: 1, mz: 0, sprint: false };
  for (let i = 0; i < 60; i++) p.move(1 / 60, false, 0); // (up to speed)
  p.stamina = 0.6;
  for (let i = 0; i < 300; i++) p.move(1 / 60, false, 0);
  const jogWant = p.phys.recover * MOVE_RECOVER_K * STAMINA_RECOVER_K * 5;
  assert.ok(p.stamina > 0.6, `jogging recovers (${p.stamina})`);
  assert.ok(Math.abs((p.stamina - 0.6) - jogWant) < jogWant * 0.03, `jogging 5 s recovered ${(p.stamina - 0.6).toFixed(4)} vs ${jogWant.toFixed(4)}`);
  assert.ok(p.stamina - 0.6 < 0.05, 'but only a very little');
  // the same with the ball
  p.stamina = 0.6; for (let i = 0; i < 300; i++) p.move(1 / 60, true, 0);
  assert.ok(p.stamina > 0.6 && p.stamina - 0.6 < 0.05, `jogging with the ball ${p.stamina}`);
  // sprinting still costs
  p.stamina = 0.6; p.intent = { ...p.intent, sprint: true };
  for (let i = 0; i < 120; i++) p.move(1 / 60, false, 0);
  assert.ok(p.stamina < 0.55, `sprinting ${p.stamina}`);
  // standing still: 2x the quick-patch rest recovery (recover x 2.8 x 1.2 per second at rest; it was 1.4 x 1.2)
  p.intent = { ...p.intent, mx: 0, mz: 0, sprint: false };
  for (let i = 0; i < 60; i++) p.move(1 / 60, false, 0); // (come to a stop)
  const s0 = p.stamina; for (let i = 0; i < 60; i++) p.move(1 / 60, false, 0);
  const want = p.phys.recover * REST_RECOVER_K * STAMINA_RECOVER_K * p.recK;
  assert.ok(Math.abs((p.stamina - s0) - want) < want * 0.03, `recovered ${(p.stamina - s0).toFixed(4)} vs ${want.toFixed(4)}`);
  assert.ok(Math.abs(want / (p.phys.recover * 1.4 * STAMINA_RECOVER_K * p.recK) - 2) < 1e-9, 'exactly twice the old rest recovery');
  // standing recovers far more than walking: more than 15x
  assert.ok(want / (jogWant / 5) > 15, 'rest vs walk ratio');
});

test('stamina: contesting with the arms up while on the floor is neutral for the defender; sliding and jumping still cost', async () => {
  const g = game(4), d = g.players[0];
  d.stam.grade = null; d.hot = 0; d.cold = false;
  // hands up, standing: neither drains nor recovers
  d.intent = { ...d.intent, mx: 0, mz: 0, sprint: false, handsUp: true };
  d.stance = 'defense'; d.handsUp = true;
  for (let i = 0; i < 60; i++) d.move(1 / 60, false, 0);
  d.stamina = 0.5; for (let i = 0; i < 180; i++) d.move(1 / 60, false, 0);
  assert.equal(d.stamina, 0.5, `hands up standing ${d.stamina}`);
  // hands up out of the stance too (an off-ball defender with his arms up)
  d.stance = 'normal'; d.stamina = 0.5; for (let i = 0; i < 180; i++) d.move(1 / 60, false, 0);
  assert.equal(d.stamina, 0.5, `hands up out of stance ${d.stamina}`);
  // arms down again: the rest recovery comes back
  d.handsUp = false; d.stance = 'defense'; d.stamina = 0.5; for (let i = 0; i < 60; i++) d.move(1 / 60, false, 0);
  assert.ok(d.stamina > 0.5, 'standing without hands up recovers');
  // sliding in the stance (hands up or not) still costs a little
  d.handsUp = true; d.intent = { ...d.intent, mx: 1, mz: 0 };
  for (let i = 0; i < 60; i++) d.move(1 / 60, false, 0); // (up to slide speed)
  assert.ok(d.speed > 0.8, `sliding at ${d.speed.toFixed(2)} m/s`);
  d.stamina = 0.5; for (let i = 0; i < 180; i++) d.move(1 / 60, false, 0);
  assert.ok(d.stamina < 0.5, `sliding with hands up drains (${d.stamina})`);
  // jumping to contest spends COST.jump through the game, as before
  const { COST } = await import('../client/js/sim/game.js');
  const h = g.players[3]; h.stamina = 1; h.stam.grade = null; h.cold = false; h.intent = { ...h.intent, mx: 0, mz: 0 };
  g.startJump(h);
  assert.ok(Math.abs((1 - h.stamina) - COST.jump * h.drainK) < 1e-9, `a jump costs ${(1 - h.stamina).toFixed(3)}`);
});

test('the AI reacts faster: reads off the catch, closes out on the pass, and gets back in transition', () => {
  const catchDecide = [], closeAtCatch = [], back = [];
  for (const seed of [11, 22, 33]) {
    const g = game(seed, seed === 33 ? 5 : 3, seed === 33 ? 'proam' : 'park');
    let c = null, chg = null, lastPoss = g.possession;
    for (let s = 0; s < 60 * 150 && !g.over; s++) {
      g.step(1 / 60);
      const t = g.time, h = g.holder();
      for (const e of g.events) if (e.type === 'catch' && g.phase === 'live' && g.lastPass?.to === e.player && t - g.lastPass.time < 2.5) {
        const p = g.players[e.player]; c = { p, t };
        let d = 9; for (const q of g.opponents(p)) d = Math.min(d, Math.hypot(q.x - p.x, q.z - p.z));
        closeAtCatch.push(d);
      }
      if (c) {
        const p = c.p, a = p.action?.type, o = g.ai.m(p), dt = t - c.t;
        if (h !== p || a === 'shoot' || a === 'layup' || a === 'dunk' || a === 'move' || o.plan === 'drive' || o.plan === 'post' || dt > 4) { catchDecide.push(Math.min(4, dt)); c = null; }
      }
      if (!g.half) {
        if (g.possession !== lastPoss && g.phase === 'live') { lastPoss = g.possession; const side = g.sideFor(g.possession); chg = g.ball.z * side < -3 ? { t, off: g.possession } : null; }
        if (chg) {
          const side = g.sideFor(chg.off), defs = g.teams[1 - chg.off];
          if (defs.every(q => (q.z - g.ball.z) * side > 0.5)) { back.push(t - chg.t); chg = null; } else if (t - chg.t > 7) { back.push(7); chg = null; }
        }
      }
    }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length, med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  assert.ok(catchDecide.length > 60 && med(catchDecide) < 0.35, `catch to a decision: median ${med(catchDecide).toFixed(2)} s (was ~0.77)`);
  assert.ok(mean(closeAtCatch) < 2.55, `the closest defender at the catch ${mean(closeAtCatch).toFixed(2)} m (was ~2.8)`);
  assert.ok(back.length >= 8 && mean(back) < 2.1, `all back in transition ${mean(back).toFixed(2)} s (was ~2.4)`);
});

test('the AI: the decisions behind it are in place', () => {
  const src = fs.readFileSync(new URL('../client/js/sim/ai.js', import.meta.url), 'utf8');
  assert.ok(src.includes('if (o.fresh) { o.fresh = false; o.next = Math.min(o.next, 0.02 + (1 - IQ) * 0.1)'), 'a quick read off the catch');
  assert.ok(src.includes('this.driveLane(p, myDef, defs, rim, d, defDist)) { o.next = 0;'), 'an opening lane gets attacked now');
  assert.ok(src.includes("passTo && passTo === man && passTo.team !== p.team"), 'closeouts start on the pass');
  assert.ok(src.includes('const brk = back === 0 || back < ahead'), 'the break gets pushed');
  assert.ok(src.includes("defDist > (o.moveGap ?? 9) + 0.45"), 'space from a move gets used');
});

test('the Locked-In grade carries your line, attached on its right, 1.2x its width, the grade itself unchanged', () => {
  const css = fs.readFileSync(new URL('../client/css/app.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.hud-grade { position: absolute; right: 22px; top: 18px; width: 132px;'), 'the grade keeps its size');
  assert.ok(css.includes('.lg-stats { position: absolute; left: 100%;') && css.includes('width: 158px;'), 'the line: 1.2 x 132 = 158 px, to its right');
  assert.ok(css.includes('.hud-grade.with-stats { right: calc(22px + 158px);'));
  const hud = fs.readFileSync(new URL('../client/js/game/hud.js', import.meta.url), 'utf8');
  assert.ok(hud.includes("const LINE = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO']];"));
  const ss = fs.readFileSync(new URL('../client/js/game/session.js', import.meta.url), 'utf8');
  assert.ok(ss.includes('hud.setGrade(this.grade && settings.gradeHud !== false ? this.grade : null, me ? me.stats : null)'));
});
