// v0.4.7.5 quick patch 3: the rule book (sim/game.js RULES). Every mode: offensive three seconds, reach-in and
// shooting fouls (the park: no free throws, the offense keeps the ball). Full court: backcourt, 8 seconds. Pro-Am /
// the Pro Run (NBA rules): defensive three seconds (a technical), the 5-second inbound, charges, goaltending. And the
// AI knows the rules: nobody crowds the box, paint defenders guard it from the edge.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, RULES } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { inLane, LANE, COURT } from '../client/js/sim/constants.js';
import { PAINT } from '../client/js/sim/ai.js';
import { spot } from '../client/js/sim/formation.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

const live = (mode, seed, opts = {}) => {
  const rng = new RNG(seed), size = mode === 'proam' ? 5 : 3;
  const rosters = [makeTeam(rng, size, { catalog, level: 0.7 }), makeTeam(rng, size, { catalog, level: 0.7 })];
  if (opts.human) rosters[0][0].human = true;
  const g = new Game({ mode, seed, rosters, catalog, target: 21, quarterLen: 120, quarters: 4, full: opts.full, difficulty: 0.6 });
  for (let i = 0; i < 900 && g.phase !== 'live'; i++) g.step(1 / 60);
  assert.equal(g.phase, 'live');
  g.ai.think = () => {}; // (the players stand where the test puts them)
  for (const p of g.players) { p.intent.mx = 0; p.intent.mz = 0; p.intent.shoot = null; p.intent.pass = null; }
  return g;
};
const park = (g, h, side) => { for (const p of g.players) p.setPos((p.team === h.team ? 1 : -1) * (3 + p.id % 3), side * 3, 0); };
const run = (g, secs, on) => { const ev = []; for (let i = 0; i < Math.round(secs * 60); i++) { g.step(1 / 60); for (const e of g.events) { ev.push(e); if (on) on(e); } } return ev; };

test('the lane and the rule table', () => {
  assert.equal(LANE.halfW, COURT.keyWidth / 2); assert.ok(Math.abs(LANE.zFar - LANE.zNear - COURT.ftDist) < 1e-9);
  assert.ok(inLane(0, 12, 1) && inLane(2.4, 9, 1) && !inLane(2.6, 12, 1) && !inLane(0, 8, 1) && !inLane(0, 12, -1) && inLane(0, -12, -1));
  assert.equal(RULES.three, 3); assert.equal(RULES.def3, 3); assert.equal(RULES.backcourt, 8); assert.equal(RULES.inbound5, 5);
  // the low block is outside the lane now (a spot in the paint was a three-second count waiting to happen)
  for (const side of [1, -1]) { const b = spot('blockL', side); assert.ok(!inLane(b.x, b.z, side, 0.1), 'block spot outside the lane'); assert.ok(!inLane(spot('dunkL', side).x, spot('dunkL', side).z, side, 0.1)); }
});

test('offensive three seconds: a man parked in the paint turns it over, in the park and in Pro-Am; a driver is exempt and a shot resets it', () => {
  for (const [mode, full] of [['park', false], ['park', true], ['proam', false]]) {
    const g = live(mode, 5, { full });
    const side = g.sideFor(g.possession), h = g.holder(); assert.ok(h);
    park(g, h, side);
    const camper = g.teams[h.team].find(p => p !== h);
    camper.setPos(0.5, side * (COURT.hoopZ - 2), 0); // in the paint
    h.setPos(5, side * 6, 0);
    // (the count runs on game time, dt / g.speed, like the shot clock)
    const ev = run(g, 2.4);
    assert.ok(!ev.some(e => e.type === 'violation'), `${mode}: nothing yet at 2.4 s (${(camper.paintT || 0).toFixed(2)})`);
    const ev2 = run(g, 1.6);
    const v = ev2.find(e => e.type === 'violation');
    assert.ok(v && v.what === 'Offensive 3 seconds' && v.player === camper.id, `${mode}${full ? ' full' : ''}: the call at three (${JSON.stringify(v)})`);
    assert.ok(ev2.some(e => e.type === 'turnover' && e.player === camper.id), 'a turnover');
  }
  // a driver through the lane is exempt; a shot going up resets the count
  const g = live('proam', 6);
  const side = g.sideFor(g.possession), h = g.holder(); park(g, h, side);
  h.setPos(0, side * (COURT.hoopZ - 3.6), side > 0 ? 0 : Math.PI); h.vx = 0; h.vz = side * 3.2; g.giveBall(h, 'dribble');
  // (intents are blanked every frame before the AI thinks, so the test drives him through a think stub)
  g.ai.think = () => { h.intent.mz = side; h.intent.sprint = true; };
  run(g, 0.7); assert.ok(h.speed > RULES.driveSpeed && inLane(h.x, h.z, side), 'driving through the lane');
  assert.equal(h.paintT || 0, 0, 'moving at speed in the lane: no count');
  g.ai.think = () => {}; h.vx = h.vz = 0; h.setPos(0.3, side * (COURT.hoopZ - 2.5), 0);
  run(g, 2.0); assert.ok((h.paintT || 0) > 1.5, `standing with it: the count runs (${(h.paintT || 0).toFixed(2)})`);
  g.ai.think = () => { h.intent.shoot = 'press'; }; run(g, 0.4);
  assert.equal(h.paintT || 0, 0, 'the shot resets it');
});

test('defensive three seconds (NBA rules): a defender loitering in the paint away from everyone is a technical: one free throw and the ball stays; not in the park', () => {
  const g = live('proam', 7);
  const side = g.sideFor(g.possession), h = g.holder(); park(g, h, side);
  h.setPos(5.5, side * 5, 0);
  const d = g.teams[1 - h.team][0]; d.setPos(-0.6, side * (COURT.hoopZ - 2.4), 0); // alone in the paint
  for (const q of g.teams[1 - h.team]) if (q !== d) q.setPos(-5, side * 2, 0);
  const ev = run(g, 4.0);
  const v = ev.find(e => e.type === 'violation' && e.what === 'Defensive 3 seconds');
  assert.ok(v && v.player === d.id, 'the call');
  assert.equal(d.stats.pf, 1, 'a personal on him');
  run(g, 1.6);
  assert.equal(g.phase, 'ft'); assert.equal(g.ftState.count, 1); assert.ok(g.ftState.tech); assert.equal(g.players[g.ftState.shooter].team, h.team, 'the offense shoots one');
  // guarding someone in the paint is fine
  const g2 = live('proam', 8);
  const side2 = g2.sideFor(g2.possession), h2 = g2.holder(); park(g2, h2, side2);
  h2.setPos(5.5, side2 * 5, 0);
  const att = g2.teams[h2.team].find(p => p !== h2); att.setPos(0.8, side2 * (COURT.hoopZ - 2), 0);
  const d2 = g2.teams[1 - h2.team][0]; d2.setPos(0.2, side2 * (COURT.hoopZ - 2.5), 0); // within arm's length of him
  const ev2 = run(g2, 4);
  assert.ok(!ev2.some(e => e.type === 'violation' && e.what === 'Defensive 3 seconds'), 'guarding a man in the paint is legal');
  assert.ok(ev2.some(e => e.type === 'violation' && e.what === 'Offensive 3 seconds'), '(the attacker parked there is the one who gets called)');
  // park: no defensive three seconds
  const g3 = live('park', 9);
  const side3 = g3.sideFor(g3.possession), h3 = g3.holder(); park(g3, h3, side3); h3.setPos(5.5, side3 * 5, 0);
  const d3 = g3.teams[1 - h3.team][0]; d3.setPos(-0.6, side3 * (COURT.hoopZ - 2.4), 0);
  assert.ok(!run(g3, 4).some(e => e.type === 'violation' && e.what === 'Defensive 3 seconds'));
});

test('backcourt and 8 seconds (full court): over and back is a turnover, so is eight seconds in the backcourt; half court has neither', () => {
  const g = live('proam', 10);
  const h = g.holder(), side = g.sideFor(h.team); park(g, h, side);
  h.setPos(0, side * 2, 0); g.giveBall(h, 'dribble'); // in the frontcourt
  run(g, 0.3); assert.ok(g.frontcourt, 'frontcourt established');
  h.setPos(0, -side * 1.5, 0); // back over the line
  const ev = run(g, 0.3);
  assert.ok(ev.some(e => e.type === 'violation' && e.what === 'Backcourt' && e.player === h.id), 'over and back');
  const g2 = live('proam', 11);
  const h2 = g2.holder(), side2 = g2.sideFor(h2.team); park(g2, h2, side2);
  h2.setPos(0, -side2 * 6, 0); g2.giveBall(h2, 'dribble'); g2.frontcourt = false; g2.backcourtT = 0; g2._bcPoss = g2.possession;
  const ev2 = run(g2, 10.5);
  assert.ok(ev2.some(e => e.type === 'violation' && e.what === '8 seconds'), 'eight seconds');
  const g3 = live('park', 12);
  const h3 = g3.holder(); h3.setPos(0, 2, 0); g3.giveBall(h3, 'dribble'); run(g3, 0.3); h3.setPos(0, 0.6, 0);
  assert.ok(!run(g3, 11).some(e => e.type === 'violation' && (e.what === 'Backcourt' || e.what === '8 seconds')), 'half court: no backcourt rules');
});

test('fouls in the park: shooting fouls and reach-ins are called, with no free throws: the offense keeps the ball (an and-one counts)', () => {
  const src = fs.readFileSync(new URL('../client/js/sim/game.js', import.meta.url), 'utf8');
  assert.ok(src.includes("if (!(this.mode === 'proam' || this.mode === 'park') || this.phase !== 'live') return null;"), 'shooting fouls in the park');
  assert.ok(src.includes("(this.mode === 'proam' || this.mode === 'park') && pf > 0 && this.rng.next() < pf * (this.mode === 'park' ? RULES.parkFoulK : 1)"), 'reach-ins in the park');
  assert.ok(src.includes("if (this.mode === 'park') { this.deadBall(1.3, () => this.restartFor(victim.team, vx, vz)); return; }"), 'no free throws: their ball');
  // a missed shot with the foul goes to the line (Pro-Am): the foul rides on the ball now, not only on a make
  assert.ok(src.includes("if (this.ball.mode === 'flight' && this.ball.info) this.ball.info.foul = foul;"));
  // in games: park fouls happen, free throws never do, and after one the fouled team has the ball
  let fouls = 0, fta = 0, keeps = 0, n = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const rng = new RNG(seed);
    const g = new Game({ mode: 'park', seed, rosters: [makeTeam(rng, 3, { catalog, level: 0.6 }), makeTeam(rng, 3, { catalog, level: 0.6 })], catalog, target: 21, difficulty: 0.6 });
    let pend = null, steps = 0;
    while (!g.over && steps < 60 * 60 * 10) {
      g.step(1 / 60); steps++;
      for (const e of g.events) { if (e.type === 'foul') { fouls++; pend = g.players[e.victim].team; } if (e.type === 'check' && pend != null) { n++; if (e.team === pend) keeps++; pend = null; } }
      assert.notEqual(g.phase, 'ft');
    }
    for (const p of g.players) fta += p.stats.fta;
  }
  assert.ok(fouls >= 6, `fouls called in the park (${fouls} in 4 games)`);
  assert.equal(fta, 0, 'no free throws in the park');
  assert.ok(keeps / Math.max(1, n) > 0.8, `the fouled team keeps the ball (${keeps}/${n})`);
});

test('Pro-Am: charges, goaltending and the inbounder\'s five seconds are in the book', () => {
  const g = live('proam', 13);
  const h = g.holder(), side = g.sideFor(h.team); park(g, h, side);
  // a charge: a driver into a set, square defender outside the restricted area
  const d = g.teams[1 - h.team][0];
  h.setPos(0, side * 6, side > 0 ? 0 : Math.PI); g.giveBall(h, 'dribble'); d.setPos(0, side * 8, side > 0 ? Math.PI : 0); d.vx = d.vz = 0;
  let charges = 0; for (let i = 0; i < 200; i++) if (g.isCharge(h, d, 4)) charges++;
  assert.ok(charges > 200 * RULES.charge.p * 0.6 && charges < 200 * RULES.charge.p * 1.4, `about ${RULES.charge.p * 100}% of such collisions (${charges}/200)`);
  d.vx = 2; d.vz = 0; assert.equal(g.isCharge(h, d, 4), false, 'a moving defender is no charge');
  d.vx = d.vz = 0; d.setPos(0, side * (COURT.hoopZ - 0.8), d.facing); let c2 = 0; for (let i = 0; i < 100; i++) if (g.isCharge(h, d, 4)) c2++; assert.equal(c2, 0, 'none in the restricted area');
  d.setPos(0, side * 8, side > 0 ? 0 : Math.PI); let c3 = 0; for (let i = 0; i < 100; i++) if (g.isCharge(h, d, 4)) c3++; assert.equal(c3, 0, 'none with his back turned');
  // goaltending: the in-flight block, on the way down above the rim over the basket, counts the basket
  const src = fs.readFileSync(new URL('../client/js/sim/game.js', import.meta.url), 'utf8');
  assert.ok(src.includes("this.mode === 'proam' && b.vy < 0 && b.y > COURT.rimY && Math.hypot(b.x - rim.x, b.z - rim.z) < 1.2") && src.includes("what: 'Goaltending'"));
  // five seconds: a human inbounder who holds it
  const g2 = live('proam', 14);
  g2.startInbound(0, { x: COURT.width / 2 + 0.45, z: 3 }, 'sideline', 1.0);
  assert.equal(g2.phase, 'inbound');
  const hu = g2.inbounder; hu.human = true; g2.human = hu; // (the user takes the inbounder, and never passes)
  assert.ok(!g2.isAI(hu));
  const ev = run(g2, 7.5);
  const v = ev.find(e => e.type === 'violation' && e.what === '5 seconds');
  assert.ok(v && v.player === hu.id, 'the call'); assert.equal(hu.stats.tov, 1);
  run(g2, 1.5); assert.equal(g2.possession, 1 - hu.team, 'their ball');
});

test('the AI knows the rules: it does not crowd the box, paint defenders guard it from the edge, and the calls are rare', () => {
  assert.ok(PAINT.out < RULES.three && PAINT.cutOut < RULES.three && PAINT.handlerOut < RULES.three && PAINT.defOut < RULES.def3);
  const what = {}; let frames = 0, offIn = 0, defIn = 0, pts = 0, games = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const rng = new RNG(seed);
    const g = new Game({ mode: 'proam', seed, rosters: [makeTeam(rng, 5, { catalog, level: 0.6 }), makeTeam(rng, 5, { catalog, level: 0.6 })], catalog, quarterLen: 120, quarters: 4, difficulty: 0.6 });
    let steps = 0;
    while (!g.over && steps < 60 * 60 * 30) {
      g.step(1 / 60); steps++;
      for (const e of g.events) if (e.type === 'violation') what[e.what] = (what[e.what] || 0) + 1;
      if (g.phase !== 'live' || g.ball.mode === 'flight') continue;
      frames++;
      const side = g.sideFor(g.possession), h = g.holder();
      for (const p of g.players) { if (!inLane(p.x, p.z, side, 0)) continue; if (p.team === g.possession) { if (p !== h) offIn++; } else defIn++; }
    }
    games++; pts += g.score[0] + g.score[1];
  }
  assert.ok((what['Offensive 3 seconds'] || 0) / games < 1.0, `offensive three seconds ${((what['Offensive 3 seconds'] || 0) / games).toFixed(2)} a game`);
  assert.ok((what['Defensive 3 seconds'] || 0) / games < 1.5, `defensive three seconds ${((what['Defensive 3 seconds'] || 0) / games).toFixed(2)} a game`);
  assert.ok((what['Backcourt'] || 0) / games < 1.0 && (what['8 seconds'] || 0) / games < 0.5, 'backcourt calls rare');
  assert.ok(offIn / frames < 0.8, `off-ball attackers in the lane ${(offIn / frames).toFixed(2)} on average (was 0.75)`);
  assert.ok(defIn / frames < 1.8, `defenders in the lane ${(defIn / frames).toFixed(2)} on average (was 2.4)`);
  assert.ok(pts / games / 2 > 18, `scoring holds up (${(pts / games / 2).toFixed(1)} a team)`);
});
