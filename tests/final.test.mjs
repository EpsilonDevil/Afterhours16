// v0.4.5 final touches: timed layups (each package its own timing), running / step-back / fadeaway / three-point
// release timings, every green window 10% smaller, fresh badge tiers, the ball and bodies colliding, AI +10%,
// game speed −0.75%, stamina drain ×2, the rebound/block assist +3.75%, and the sphinx on the Cup courts.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, COST, STAMINA_K, GAME_SPEED, DEF_ASSIST_K } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { BALL_R } from '../client/js/sim/constants.js';
import * as S from '../client/js/sim/shots.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

function practice(equip = {}, seed = 3) {
  const rng = new RNG(seed), me = makeTeam(rng, 1, { catalog, level: 0.8 })[0];
  me.human = true;
  me.build.equipment = { ...me.build.equipment, ...equip };
  const g = new Game({ mode: 'practice', seed, rosters: [[me], []], catalog });
  return { g, p: g.players[0] };
}

// ---------------- timed layups ----------------
test('layups are timed: every package has its own timing, and the Layup rating sets the window', () => {
  const feel = Object.values(S.LAYUP_FEEL);
  assert.equal(new Set(feel.map(f => f.rel)).size, feel.length, 'each package releases at its own point in the air');
  for (const i of list.filter(x => x.slot === 'layup')) assert.ok(S.LAYUP_FEEL[i.style], `${i.id} has a timing`);
  for (let v = 41; v <= 99; v++) assert.ok(S.layupWindowMs(v) >= S.layupWindowMs(v - 1), `window grows with Layup (${v})`);
  assert.ok(S.layupWindowMs(90, {}, { contest: 1 }) < S.layupWindowMs(90) * 0.7, 'traffic shrinks it');
  assert.ok(S.layupWindowMs(90, {}, { contest: 1.2 }) > 0, 'but never takes it away');
  assert.ok(Math.abs(S.layupWindowMs(80) - S.timingWindowMs(80) * S.LAYUP_WIN_K * 0.9) < 1e-9, 'including the 10% cut');
  // a green is a big boost, early/late a little worse than an untimed layup, way off much worse
  const fc = grade => S.finalChance({ type: 'layup', d: 1.2, a: { layup: 80 }, contest: 0.8, stamina: 1, badges: {}, grade });
  assert.ok(fc('excellent') > fc('none') + 0.15 && fc('excellent') < 0.97);
  assert.ok(fc('early') < fc('none') && fc('vlate') < fc('early'));
});

function layupFor(lstyle, timing) {
  const { g, p } = practice({ layup: 'layup_' + lstyle });
  const rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x, rim.z - side * 3.4, side > 0 ? 0 : Math.PI); p.vz = side * 4; g.giveBall(p, 'dribble');
  g.setInput({ mx: 0, mz: 0, shootHeld: true });
  const a = g.startLayup(p, rim, {});
  let grade = null;
  for (let i = 0; i < 120 && !grade; i++) {
    const held = timing === 'tap' ? false : a.t + 1 / 60 < a.tRel;
    g.setInput({ mx: 0, mz: side * 0.5, shootHeld: held });
    g.step(1 / 60);
    for (const e of g.events) if (e.type === 'release') grade = e.grade;
  }
  return { grade, a };
}

test('every layup is timed: let go at the top for a green; a tap during the gather is flipped up way early', () => {
  const rel = {};
  for (const ls of ['basic', 'euro', 'finger', 'scoop']) {
    const t = layupFor(ls, 'timed');
    assert.equal(t.grade, 'excellent', `${ls}: released at its own top`);
    rel[ls] = (t.a.tRel - t.a.takeoff) / (t.a.dur - 0.12 - t.a.takeoff);
    const tap = layupFor(ls, 'tap');
    assert.ok(tap.grade === 'vearly' || tap.grade === 'early', `${ls}: a tap is ${tap.grade}`);
    assert.ok(tap.a.released && !tap.a.untimed);
  }
  assert.ok(rel.scoop < rel.basic && rel.basic < rel.euro && rel.euro < rel.finger, 'scoop early, finger roll late');
});

test('layups react to the coverage: around a shot blocker, away from a side defender, a hang into a wall, quick ahead of a chaser', async () => {
  const p = { x: 0, z: 9, vx: 0, vz: 0 }, rim = { x: 0, z: 12.7 };
  const d = (x, z, extra = {}) => ({ x, z, vx: 0, vz: 0, action: null, ...extra });
  assert.equal(S.layupCoverage(p, rim, []).kind, 'open');
  assert.equal(S.layupCoverage(p, rim, [d(0.3, 12.2)]).kind, 'rim');
  assert.equal(S.layupCoverage(p, rim, [d(0, 10.1)]).kind, 'front');
  const side = S.layupCoverage(p, rim, [d(1.0, 9.6)]);
  assert.equal(side.kind, 'side');
  assert.equal(S.layupCoverage(p, rim, [d(-1.0, 9.6)]).side, -side.side, 'always away from him');
  assert.equal(S.layupCoverage(p, rim, [d(0.2, 8, { vz: 4 })]).kind, 'trail');
  assert.equal(S.layupCoverage(p, rim, [d(0.2, 8, { vz: 0 })]).kind, 'open', 'a defender left behind standing still is no threat');
  // each one finishes differently: when it comes out, where the ball goes, which hand
  const { layupHand } = await import('../client/js/char/animator.js');
  assert.equal(layupHand({ cov: 'side', covSide: 1 }), 'L'); assert.equal(layupHand({ cov: 'open' }), 'R');
  const rels = Object.values(S.LAYUP_COVER).map(c => c.rel);
  assert.equal(new Set(rels).size, rels.length, 'every coverage changes the timing');
  const { g, p: me } = practice();
  const path = cov => { const a = { type: 'layup', t: 0, release: 0.6, takeoff: 0.25, lstyle: 'basic', cov, covSide: 1 }; me.action = a; const pts = []; for (let i = 0; i <= 12; i++) { a.t = 0.6 * i / 12; const h = g.holdPoint(me); pts.push([h.x - me.x, h.y - me.y, h.z - me.z]); } return pts; };
  const ks = ['open', 'side', 'front', 'rim', 'trail'], P = Object.fromEntries(ks.map(k => [k, path(k)]));
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const m = Math.max(...P[ks[i]].map((q, n) => Math.hypot(q[0] - P[ks[j]][n][0], q[1] - P[ks[j]][n][1], q[2] - P[ks[j]][n][2])));
    assert.ok(m > 0.1, `${ks[i]} vs ${ks[j]}: the ball takes a different path (${(m * 100).toFixed(0)} cm)`);
  }
});

// ---------------- jumper timings ----------------
test('running jumpers come out quicker, step-backs and fadeaways slower, threes a touch slower than mid-range', () => {
  const k = S.jumperTimingK;
  assert.ok(k({ moving: 4 }) < k({}), 'running');
  assert.ok(k({ stepback: true }) > k({ fade: true }) && k({ fade: true }) > k({}), 'step-back > fade > set shot');
  assert.ok(k({ three: true }) > k({}), 'three vs mid-range');
  // in a game: the same base and release, shot from 5 m and from 7.6 m
  const tRelFrom = d => {
    const { g, p } = practice();
    const rim = g.rimFor(0); p.setPos(rim.x, rim.z - g.sideFor(0) * d, 0);
    g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true });
    for (let i = 0; i < 20 && p.action?.type !== 'shoot'; i++) { g.step(1 / 60); g.setInput({ mx: 0, mz: 0, shootHeld: true }); }
    return p.action.tRel;
  };
  assert.ok(tRelFrom(7.6) > tRelFrom(5) * 1.02, 'a three loads longer');
});

test('every green window in the game is 10% smaller (jumpers, free throws, layups)', () => {
  assert.equal(S.GREEN_K, 0.9);
  for (const v of [55, 75, 90]) {
    assert.ok(Math.abs(S.greenWindowMs(v) - Math.max(9, S.timingWindowMs(v)) * 0.9) < 1e-9);
    assert.ok(Math.abs(S.greenWindowMs(v, {}, { ft: true }) - S.timingWindowMs(v) * 1.15 * 0.9) < 1e-9);
    assert.ok(Math.abs(S.layupWindowMs(v) - Math.max(9, S.timingWindowMs(v) * S.LAYUP_WIN_K) * 0.9) < 1e-9);
  }
});

// ---------------- badges ----------------
test('your badge tiers come from your character, so an upgrade shows (and plays) right away', async () => {
  const { rankedBadges } = await import('../client/js/game/present.js');
  // an entry made before the upgrade, with the character's record already at Gold
  const entry = { badges: { deadeye: 1 }, build: { badges: { deadeye: { tier: 3, progress: 40 } } } };
  assert.equal(rankedBadges(entry).find(b => b.key === 'deadeye').tier, 3);
  const src = fs.readFileSync(new URL('../client/js/game/park.js', import.meta.url), 'utf8');
  assert.ok(/const meEntry = \{[^\n]*badges: badgeTiers\(app\.char\(\)\)/.test(src), 'each park game reads your badges fresh');
});

// ---------------- collision ----------------
test('nobody dribbles inside anybody: the ball and the bodies stay apart in AI games', () => {
  let frames = 0, ballIn = 0, bodies = 0;
  for (const seed of [4, 9]) {
    const rng = new RNG(seed);
    const g = new Game({ mode: 'park', full: true, seed, rosters: [makeTeam(rng, 3, { catalog, level: 0.7 }), makeTeam(rng, 3, { catalog, level: 0.7 })], catalog, target: 11, difficulty: 0.6 });
    for (let s = 0; s < 60 * 60 * 6 && !g.over; s++) {
      g.step(1 / 60);
      if (g.phase !== 'live') continue;
      frames++;
      const ps = g.players, b = g.ball;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        if (Math.abs(a.y - c.y) > 1.2 || a.action?.type === 'hang' || c.action?.type === 'hang') continue;
        if (a.phys.radius + c.phys.radius - Math.hypot(a.x - c.x, a.z - c.z) > 0.03) bodies++;
      }
      if (b.holder >= 0 && (b.mode === 'dribble' || b.mode === 'held')) for (const q of ps) {
        if (q.id === b.holder || Math.abs(q.y - ps[b.holder].y) > 1.2 || b.y > q.y + q.phys.H * 0.9) continue;
        if (q.phys.radius + BALL_R - Math.hypot(b.x - q.x, b.z - q.z) > 0.03) ballIn++;
      }
    }
  }
  assert.ok(ballIn / frames < 0.006, `ball inside a body in ${(ballIn / frames * 100).toFixed(2)}% of frames`);
  assert.ok(bodies / frames < 0.002, `bodies overlapping in ${(bodies / frames * 100).toFixed(2)}% of frames`);
});

// ---------------- tuning ----------------
test('AI +10% in every tier, game speed −0.75%, stamina drain ×2 from every source, rebound/block assist +3.75%', async () => {
  const { AI_SKILL_K } = await import('../client/js/sim/ai.js');
  const { SPRINT_DRAIN_K } = await import('../client/js/sim/player.js');
  assert.equal(AI_SKILL_K, 1.1);
  const { g } = practice();
  const ai = g.ai;
  for (const iq of [0.2, 0.5, 0.8]) {
    assert.ok(Math.abs(ai.iq({ iq, human: false }) - iq * 1.1) < 1e-9, `AI at IQ ${iq}`);
    assert.equal(ai.iq({ iq, human: true }), iq, 'your own player is untouched');
  }
  assert.equal(ai.iq({ iq: 0.98 }), 1, 'capped at 1');
  assert.ok(Math.abs(GAME_SPEED - 1.15 * 1.0375 * (1 - 0.0185) * 0.9925) < 1e-12);
  assert.equal(g.speed, GAME_SPEED);
  assert.equal(STAMINA_K, 2); assert.equal(SPRINT_DRAIN_K, 2);
  assert.ok(Math.abs(COST.shot - 0.018) < 1e-12 && Math.abs(COST.layup - 0.024) < 1e-12 && Math.abs(COST.dunk - 0.036) < 1e-12);
  assert.ok(Math.abs(COST.steal - 0.018) < 1e-12 && Math.abs(COST.jump - 0.03) < 1e-12 && COST.screen > 0);
  assert.ok(Math.abs(COST.move - 0.048) < 1e-12 && Math.abs(COST.pass - 0.008) < 1e-12, 'dribble moves and passes doubled too');
  assert.equal(DEF_ASSIST_K, 1.0375);
  // sprinting really drains twice as fast
  const { p } = practice();
  p.stamina = 1; p.intent = { ...p.intent, mx: 1, mz: 0, sprint: true };
  for (let i = 0; i < 120; i++) p.move(1 / 60, false, 0);
  const used = 1 - p.stamina;
  assert.ok(used > p.phys.staminaRate * 1.5 * 1.6, `two seconds of sprinting used ${(used * 100).toFixed(1)}%`);
});

// ---------------- King Tut Cup ----------------
test('every King Tut Cup court has the sphinx, not the KTC placeholder', async () => {
  const { THEMES } = await import('../client/js/world/themes.js');
  const logo = THEMES.kingtut.court.logo;
  assert.equal(logo.shape, 'sphinx');
  assert.ok(!logo.text, 'no placeholder text');
  assert.ok(logo.inHalf, 'inside the play area on the half courts');
  const src = fs.readFileSync(new URL('../client/js/gfx/textures.js', import.meta.url), 'utf8');
  assert.ok(src.includes("if (shape === 'sphinx')") && src.includes('function sphinxPath('));
});
