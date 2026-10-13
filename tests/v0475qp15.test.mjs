// v0.4.7.5 quick patch 3 (Oct 12, part 2): name tags, three seconds, the take-it-back glow, the Pro Run's max OVR and
// badge progress, layups by contest, blocks, and the game's own online server.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT, COURT, LANE } from '../client/js/sim/constants.js';
import * as S from '../client/js/sim/shots.js';
import * as G from '../client/js/gfx/geometry.js';
import { maxOvr } from '../client/js/sim/builds.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const halfCourt = seed => {
  const r = new RNG(seed), a = makeTeam(r, 3, { catalog, level: 0.6 }), b = makeTeam(r, 3, { catalog, level: 0.6 });
  return new Game({ mode: 'park', seed, rosters: [a, b], catalog, target: 21, assist: true });
};
const liveWith = (g, team) => { // (the ball live in a handler's hands at the top of the key)
  for (let i = 0; i < 600 && g.phase !== 'live'; i++) g.step(DT);
  const h = g.teams[team][0];
  g.changePossessionTo(h); g.giveBall(h, 'held'); g.needsClear = [false, false]; g.phase = 'live';
  h.setPos(0, 4, 0);
  return h;
};

test('Settings → Name tags hides the names over players in games (the pass icons stay while you have the ball) and at the park', () => {
  const ses = src('client/js/game/session.js');
  assert.match(ses, /const names = settings\.tags !== false;/);
  assert.match(ses, /if \(!names && icon < 0\) continue;/);
  assert.match(src('client/js/ui/modes.js'), /settings\.tags !== false \? hub\.peers\.list\(\) : \[\]/);
});

test('offensive three seconds: counted only while the offense has the ball, and the call hands it to the other team at once', () => {
  const g = halfCourt(5), side = g.sideFor(0);
  liveWith(g, 0);
  const camper = g.teams[0][1];
  const park = () => { camper.x = 0.4; camper.z = side * (LANE.zNear + 1.5); camper.vx = camper.vz = 0; };
  let call = null;
  for (let i = 0; i < 400 && !call; i++) {
    park(); g.teams[0][0].setPos(0, 4, 0);
    g.step(DT);
    call = g.events.find(e => e.type === 'violation' && e.what === 'Offensive 3 seconds');
  }
  assert.ok(call, 'called');
  assert.equal(call.player, camper.id);
  assert.equal(g.possession, 1, 'the other team\'s ball from the moment of the call');
  assert.ok(g.events.some(e => e.type === 'turnover' && e.team === 1));
  for (let i = 0; i < 200 && g.phase !== 'check'; i++) g.step(DT);
  assert.equal(g.phase, 'check'); assert.equal(g.holder()?.team, 1);
  // a loose ball (a rebound) is no team's: nobody's count runs
  const g2 = halfCourt(6), s2 = g2.sideFor(0);
  liveWith(g2, 0);
  const c2 = g2.teams[0][1];
  g2.ball.holder = -1; g2.ball.mode = 'dead';
  for (let i = 0; i < 300; i++) { c2.x = 0.4; c2.z = s2 * (LANE.zNear + 1.5); g2.laneRules(DT); }
  assert.equal(c2.paintT, 0);
  // a defender who was in the paint starts from nothing when his team gets the ball
  const g3 = halfCourt(7), s3 = g3.sideFor(1);
  liveWith(g3, 1);
  const big = g3.teams[0][2];
  big.paintT = 2.9; big.x = 0.4; big.z = s3 * (LANE.zNear + 1.5);
  g3.laneRules(DT);
  const h = g3.teams[0][0]; g3.changePossessionTo(h); g3.giveBall(h, 'held');
  assert.equal(g3.laneRules(DT), false);
  assert.ok(big.paintT < 0.1, String(big.paintT));
});

test('take it back: the red glow runs along the three-point line (corner, arc, corner) while the team with the ball has to clear it', () => {
  const geo = G.threeLineRibbon(0.7), P = geo.position;
  let zMin = 99, zMax = -99, off = 0;
  for (let i = 0; i < P.length; i += 6) {
    const x = (P[i] + P[i + 3]) / 2, z = (P[i + 2] + P[i + 5]) / 2;
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
    const corner = Math.abs(x) >= COURT.cornerThree - 1e-6 && z > 9.9;
    if (!corner && Math.abs(Math.hypot(x, z - COURT.hoopZ) - COURT.threeRadius) > 1e-6) off++;
  }
  assert.equal(off, 0);
  assert.ok(Math.abs(zMin - (COURT.hoopZ - COURT.threeRadius)) < 1e-6 && Math.abs(zMax - COURT.length / 2) < 1e-6);
  const ses = src('client/js/game/session.js');
  assert.match(ses, /clearGlow\(dt\) \{/);
  assert.match(ses, /g\.needsClear\[team\] && \(g\.phase === 'live' \|\| g\.phase === 'dead'\)/);
});

test('the Pro Run: a kept max OVR climbs every 3 games from where it is (client mirror); the results list every badge that moved', () => {
  assert.equal(maxOvr({ ovr_floor: 86, ovr_floor_at: 6, progression: { prorun_completed: 8 } }), 86);
  assert.equal(maxOvr({ ovr_floor: 86, ovr_floor_at: 6, progression: { prorun_completed: 9 } }), 87);
  assert.equal(maxOvr({ ovr_floor: 86, ovr_floor_at: 6, progression: { prorun_completed: 30 } }), 90);
  assert.equal(maxOvr({ progression: { prorun_completed: 7 } }), 82);
  const modes = src('client/js/ui/modes.js');
  assert.match(modes, /function badgeProgressHTML\(app, r\)/);
  assert.doesNotMatch(modes, /Object\.entries\(r\.badge_progress\)\.slice\(0, 6\)/, 'not only the first six');
});

test('layups by contest: wide open greens are makes, open ones too with an 85+ Layup; anything more and a green is a smaller boost', () => {
  assert.equal(S.layupState(0.05), 'wide'); assert.equal(S.layupState(0.15), 'open'); assert.equal(S.layupState(0.3), 'light'); assert.equal(S.layupState(0.6), 'contested'); assert.equal(S.layupState(0.8), 'smothered');
  assert.equal(S.layupSure(0.08, 60), true);
  assert.equal(S.layupSure(0.15, 85), true); assert.equal(S.layupSure(0.15, 84), false);
  assert.equal(S.layupSure(0.3, 99), false);
  const rng = new RNG(4), t = makeTeam(rng, 1, { catalog, level: 0.7 }), o = makeTeam(rng, 1, { catalog, level: 0.7 });
  t[0].human = true;
  const g = new Game({ mode: 'park', seed: 3, rosters: [t, o], catalog, target: 11 });
  const p = g.players[0], a = { lstyle: 'normal' }, raw = c => c / S.insideGuard(1);
  p.raw.layup = 86;
  assert.equal(g.layupWindow(p, a, raw(0.09)).sure, true, 'wide open as the HUD says it');
  assert.equal(g.layupWindow(p, a, raw(0.18)).sure, true, 'open, 86 Layup');
  p.raw.layup = 80;
  assert.equal(g.layupWindow(p, a, raw(0.18)).sure, false, 'open, 80 Layup: a boost');
  assert.equal(g.layupWindow(p, a, raw(0.3)).sure, false);
  // a green's lift shrinks with the contest
  const base = { type: 'layup', d: 1, a: p.ratings, three: false, stamina: 1, badges: {}, grade: 'excellent' };
  const lift = (guard) => { const c = S.finalChance({ ...base, contest: guard / S.insideGuard(1), guard }), n = S.finalChance({ ...base, contest: guard / S.insideGuard(1), guard, grade: 'none' }); return (c - n) / (1 - n); };
  assert.ok(lift(0.15) > lift(0.3) && lift(0.3) > lift(0.6), `${lift(0.15)} ${lift(0.3)} ${lift(0.6)}`);
});

test('blocks: what the defender brings counts 3.75% more (his size against a taller shooter isn\'t made worse)', () => {
  assert.equal(S.BLOCK_K, 1.0375);
  assert.ok(Math.abs(S.blockUp(0.2) - 0.2075) < 1e-12);
  assert.equal(S.blockUp(-0.05), -0.05);
  const game = src('client/js/sim/game.js');
  assert.equal((game.match(/S\.blockUp\(/g) || []).length, 6); // (ratings, size and badges, in both block checks)
});

test('online: the game\'s own server (online.json) by itself, a sign-in popup, play offline and back', () => {
  const on = src('client/js/ui/online.js');
  for (const f of ['function maybePromptSignIn(app)', 'async function goOffline(app)', 'async function goOnline(app)', 'function offlineForm(app)', 'function shareServerNote(app)', "app.config?.online?.server"]) assert.ok(on.includes(f), f);
  const app = src('server/app.py');
  for (const f of ['def load_online_default', 'def save_online_default', '"/api/online-default"', '"server_code"']) assert.ok(app.includes(f), f);
  const cfg = JSON.parse(src('online.json'));
  assert.deepEqual(Object.keys(cfg).sort(), ['_', 'joinCode', 'server']);
  assert.match(src('server/migrations/012_v0475_hub_offline.sql'), /ADD COLUMN offline/);
});
