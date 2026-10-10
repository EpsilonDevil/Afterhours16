// v0.4.7.5 quick patch 3 (defense and scale): transition defense varies with the man (speed, IQ), the occasional bad
// step on a moving dribbler, every player model stands exactly its height with exactly its wingspan, shot feedback for
// everyone, and the record scratch on every green that doesn't go in and every blocked dunk.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { TRANS, MISTAKE } from '../client/js/sim/ai.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { bodyDims, standingReach, OVERHEAD_LIFT } from '../client/js/char/skeleton.js';
import { ARM_LIFT } from '../client/js/sim/game.js';
import { physical } from '../client/js/sim/ratings.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const INCH = 0.0254;
const game = (seed, { full = true, size = 3, mode = 'park' } = {}) => {
  const rng = new RNG(seed);
  return new Game({ mode, full, seed, rosters: [makeTeam(rng, size, { catalog, level: 0.6 }), makeTeam(rng, size, { catalog, level: 0.6 })], catalog, target: 21, quarterLen: 150, quarters: 4, difficulty: 0.6 });
};
const src = f => fs.readFileSync(new URL('../client/js/' + f, import.meta.url), 'utf8');

test('every player model stands exactly its height, with exactly its wingspan, and taller builds are taller: a hard check', () => {
  const yRange = geo => { let lo = 1e9, hi = -1e9; const p = geo.position; for (let i = 1; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return [lo, hi]; };
  let last = 0, n = 0;
  for (const h of [67, 69, 70, 72, 74, 75, 76, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87]) {
    for (const [w, ws] of [[150 + (h - 67) * 5, h + 3], [220 + (h - 67) * 4, h + 7], [h > 78 ? 290 : 230, h - 1]]) {
      const build = { height: h, weight: w, wingspan: ws, hand: 'R' };
      const m = new AthleteModel(build, { top: { family: 'jersey' } }, 0.5), g = m.buildAll();
      const H = h * INCH;
      const [, crown] = yRange(g.head), [sole] = yRange(g.shoes), [bodyLo] = yRange(g.body);
      // the skull's crown (hair not counted) at the build's height, the shoes on the floor
      assert.ok(Math.abs(crown / H - 1) < 0.004, `${h}" ${w} lb: crown at ${(crown / H).toFixed(3)} H`);
      assert.ok(Math.abs(Math.min(sole, bodyLo)) < 0.012, `${h}": the feet are on the floor (${sole.toFixed(3)} m)`);
      // fingertip to fingertip, arms out level: the build's wingspan, whatever the weight
      const d = bodyDims(build), span = 2 * (d.shoulderX + d.upperLen + d.foreLen + d.handLen);
      assert.ok(Math.abs(span / (ws * INCH) - 1) < 0.002, `${h}"/${ws}" ${w} lb: wingspan ${(span / (ws * INCH)).toFixed(3)}`);
      // relative: taller is taller, in exact proportion
      if (w === 150 + (h - 67) * 5) { assert.ok(crown > last, 'taller build, taller model'); last = crown; }
      // the simulation's body (reach, radius) is sized from the same height and wingspan, and its standing reach is
      // the model's own: shoulder + overhead lift + arm to the fingertips (contests, blocks and finishes use it)
      const ph = physical({ ...build, attributes: {} });
      assert.ok(Math.abs(ph.H - H) < 1e-9 && Math.abs(ph.WS - ws * INCH) < 1e-9);
      const modelReach = d.hipY + d.spineLen + d.chestLen + d.clavY + 0.002 * H + OVERHEAD_LIFT * H + d.upperLen + d.foreLen + d.handLen;
      assert.ok(Math.abs(ph.reach - modelReach) < 1e-9 && Math.abs(ph.reach - standingReach(d)) < 1e-9, `${h}"/${ws}": reach ${ph.reach.toFixed(3)} vs the model's ${modelReach.toFixed(3)}`);
      assert.ok(ph.reach / H > 1.2 && ph.reach / H < 1.32, `reach ${(ph.reach / H).toFixed(3)} H`);
      n++;
    }
  }
  assert.ok(n >= 50);
  assert.equal(ARM_LIFT, OVERHEAD_LIFT, 'the animator/release lift and the reach use the same shoulder lift');
  // 5'7" vs 7'3": the models differ by exactly the 20 inches
  const a = new AthleteModel({ height: 67, weight: 160, wingspan: 70 }, {}, 0.5).buildAll(), b = new AthleteModel({ height: 87, weight: 260, wingspan: 92 }, {}, 0.5).buildAll();
  assert.ok(Math.abs((yRange(b.head)[1] - yRange(a.head)[1]) / (20 * INCH) - 1) < 0.005, 'a 20-inch difference in the builds is a 20-inch difference on the floor');
});

test('transition defense varies with the man: fast, smart defenders turn first; slow ones are a beat late and sometimes jog', () => {
  const g = game(21);
  g.possession = 1 - g.possession; g.ai.think(1 / 60); // (a change of possession draws every defender's traits)
  const traits = g.players.map(p => ({ p, o: g.ai.m(p) }));
  for (const { o } of traits) { assert.ok(o.transAt >= g.time + TRANS.delay0 - 1e-9, 'never before the base delay'); assert.ok(typeof o.transJog === 'boolean'); }
  // over many draws: a 99-speed, high-IQ man turns sooner than a 45-speed low-IQ man, and jogs less often
  const fast = g.players[0], slow = g.players[1];
  fast.ratings.speed = 99; slow.ratings.speed = 45; fast.iqV = 1; slow.iqV = 0.1;
  g.ai.iq = p => (p === fast ? 1 : p === slow ? 0.1 : 0.6);
  let dF = 0, dS = 0, jF = 0, jS = 0;
  for (let i = 0; i < 400; i++) {
    g.possession = 1 - g.possession; g.ai.think(1 / 60);
    const oF = g.ai.m(fast), oS = g.ai.m(slow);
    dF += oF.transAt - g.time; dS += oS.transAt - g.time; jF += oF.transJog ? 1 : 0; jS += oS.transJog ? 1 : 0;
  }
  assert.ok(dS / 400 > dF / 400 + 0.3, `slow and careless turns later: ${(dS / 400).toFixed(2)} s vs ${(dF / 400).toFixed(2)} s`);
  assert.ok(dF / 400 < 0.12, 'the fast, smart man goes almost at once');
  assert.ok(jS > jF + 20 && jF < 40, `jogging back: slow ${jS}/400, fast ${jF}/400`);
});

test('the bad step: now and then a defender on a moving dribbler anticipates the wrong way for a moment, less often the better he is', () => {
  const g = game(22);
  const h = g.players[0], d = g.players[3];
  g.phase = 'live'; g.possession = h.team; g.giveBall(h, 'dribble');
  const rim = g.rimFor(h.team), side = g.sideFor(h.team);
  h.setPos(0, rim.z - side * 6, side > 0 ? 0 : Math.PI); h.vx = 3; h.vz = 0; // dribbling across
  d.setPos(0, rim.z - side * 4.8, side > 0 ? Math.PI : 0);
  g.ai.matchups(h.team); g.ai.manOf = () => h; // (he guards the handler)
  const count = (skill, ticks = 3000) => {
    g.ai.skill = () => skill; let n = 0, inStep = 0;
    for (let i = 0; i < ticks; i++) { const o = g.ai.m(d); const before = o.badStep > 0; h.vx = 3; g.ai.defend(d, 1 / 60); if (!before && o.badStep > 0) n++; if (o.badStep > 0) inStep++; }
    return { n, inStep };
  };
  const bad = count(0.2), good = count(1.0);
  assert.ok(bad.n > 0, 'a poor defender takes bad steps');
  assert.ok(bad.n > good.n * 1.8, `the poor defender steps wrong more often (${bad.n} vs ${good.n} in 50 s)`);
  // the rate: about MISTAKE.rate × (1.3 − skill) per second
  const expect = 50 * MISTAKE.rate * (1.3 - 0.2);
  assert.ok(bad.n > expect * 0.5 && bad.n < expect * 1.6, `rate ${bad.n} vs ~${expect.toFixed(0)}`);
  // a standing dribbler draws none
  h.vx = 0; h.vz = 0; g.ai.skill = () => 0.2; let n0 = 0;
  for (let i = 0; i < 2000; i++) { const o = g.ai.m(d); o.badStep = 0; g.ai.defend(d, 1 / 60); if (o.badStep > 0) n0++; }
  assert.equal(n0, 0, 'no bad steps on a standing man');
  // each one lasts MISTAKE.dur and moves his aim by a step
  g.ai.skill = () => 0.2; h.vx = 3;
  for (let i = 0; i < 5000 && !(g.ai.m(d).badStep > 0); i++) { g.ai.defend(d, 1 / 60); }
  const o = g.ai.m(d);
  assert.ok(o.badStep > 0 && o.badStep <= MISTAKE.dur + 1e-9 && Math.abs(Math.hypot(o.badDir.x, o.badDir.z) - 1) < 1e-6);
});

test('shot feedback for everyone, scratches on missed greens and blocked dunks: wired', () => {
  const sess = src('game/session.js'), hud = src('game/hud.js'), scr = src('ui/screens.js'), set = src('core/settings.js'), gm = src('sim/game.js');
  assert.ok(set.includes('shotFeedbackAll: false'));
  assert.ok(scr.includes('data-k="shotFeedbackAll"') && scr.includes("'shotFeedbackAll', 'defArrows'"));
  assert.ok(hud.includes('releaseOther(x, y, text, color, sub)') && hud.includes('hud-fb3'));
  assert.ok(sess.includes('settings.shotFeedbackAll') && sess.includes('hud.releaseOther('));
  // any green that isn't going in (a layup, a deep one) scratches; a blocked dunk always does
  assert.ok(sess.includes("(e.scratch || (e.grade === 'excellent' && !e.made)) && P) this.greenScratch(P, mine)"));
  assert.ok(sess.includes("if (!wasGreen && e.kind === 'dunk')") && sess.includes('const wasGreen = this.cutGreen(e.shooter);'));
  assert.ok(gm.includes("this.emit({ type: 'block', player: d.id, shooter: shooter.id, chase, kind });"));
  // the block event says what was blocked
  const g = game(23, { full: false });
  const h = g.players[0], d = g.players[3];
  g.phase = 'live'; g.possession = h.team; g.giveBall(h, 'held');
  h.startAction('dunk', 1, { takeoff: 0, slam: 0.5, side: g.sideFor(h.team) });
  g.blockBall(d, h, false);
  const ev = g.events.find(e => e.type === 'block');
  assert.ok(ev && ev.kind === 'dunk', `block kind ${ev?.kind}`);
});
