// v0.4.7.5: gameplay rules (stage A). Harsher unbadged shots under a contest, hot +3%, takeovers 90 s / +6,
// wide-open dunks at 70+ never miss, Contact Finisher's push-offs, posting up stamina-neutral, the defensive
// X / Square fix, and Lock-In grades for every AI player.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../client/js/sim/shots.js';
import { Game, WIDE_OPEN } from '../client/js/sim/game.js';
import { TAKEOVERS, TAKEOVER_SECS } from '../client/js/sim/badges.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { MatchSession } from '../client/js/game/session.js';
import { Input, newStickState, PAD } from '../client/js/core/input.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const game = (n = 1, opts = {}) => {
  const rng = new RNG(opts.seed || 4), team = makeTeam(rng, n, { catalog, level: 0.8 }), opp = opts.opp ? makeTeam(rng, opts.opp, { catalog, level: 0.6 }) : [];
  team[0].human = true;
  return new Game({ mode: opts.mode || 'practice', seed: opts.seed || 4, rosters: [team, opp], catalog });
};

test('a shot without its badges needs a good, open look: the contest bites a fifth harder', () => {
  const a = { mid_range: 80, three_point: 80, layup: 80, close_shot: 80 };
  const fc = (badges, contest, type = 'jumper') => S.finalChance({ type, d: type === 'layup' ? 1.2 : 5, a, grade: 'none', contest, stamina: 1, badges });
  for (const c of [0.3, 0.6]) {
    assert.ok(Math.abs(fc({}, c) / fc({ clutch: 1 }, c) - (1 - 0.53 * c) / (1 - 0.44 * c)) < 1e-9, `jumper at ${c * 100}% guarded: the contest takes 0.53 instead of 0.44 per unit`);
    assert.ok(fc({}, c, 'layup') < fc({ acrobat: 1 }, c, 'layup'), `layup at ${c * 100}% guarded`);
    assert.ok(S.greenWindowMs(80, {}, { contest: c }) < S.greenWindowMs(80, { clutch: 1 }, { contest: c }), 'and a smaller green window');
  }
  assert.ok(Math.abs(fc({}, 0) - fc({ clutch: 1 }, 0)) < 1e-9, 'wide open, the badges don\'t matter here');
});

test('on fire is +3% now; takeovers last 90 seconds and add +6', () => {
  assert.equal(S.HOT_BOOST, 0.03);
  const fc = hot => S.finalChance({ type: 'jumper', d: 5, a: { mid_range: 75 }, grade: 'none', contest: 0.2, stamina: 1, badges: {}, hot });
  assert.ok(Math.abs(fc(true) / fc(false) - 1.03) < 1e-9);
  assert.equal(TAKEOVER_SECS, 90);
  for (const t of Object.values(TAKEOVERS)) assert.equal(t.boost, 6);
});

function dunkGame(rating, defender) {
  const rng = new RNG(4), me = makeTeam(rng, 1, { catalog, level: 0.9 })[0], d = makeTeam(rng, 1, { catalog, level: 0.9 })[0];
  me.human = true; me.build.attributes = { ...me.build.attributes, driving_dunk: rating, layup: 50, vertical: 95 };
  const g = new Game({ mode: 'practice', seed: 4, rosters: [[me], defender ? [d] : []], catalog });
  const p = g.players[0], rim = g.rimFor(0), side = g.sideFor(0);
  p.phys.vertical = Math.max(p.phys.vertical, 3.5 - p.phys.reach);
  p.setPos(rim.x, rim.z - side * 2.6, side > 0 ? 0 : Math.PI); p.vz = side * 5; g.giveBall(p, 'dribble');
  if (defender) { const q = g.players[1]; q.setPos(rim.x + 0.2, rim.z - side * 0.7, side > 0 ? Math.PI : 0); }
  return { g, p, side };
}
test('a wide-open dunk by anyone over 70 in that dunk rating never misses', () => {
  assert.equal(WIDE_OPEN, 0.1);
  let made = 0, n = 0;
  for (let s = 0; s < 30; s++) {
    const { g, p, side } = dunkGame(72);
    g.rng = new RNG(100 + s);
    g.setInput({ mx: 0, mz: side, sprint: true, shoot: 'press', attack: true, shootHeld: true }); g.step(1 / 60);
    if (p.action?.type !== 'dunk') continue;
    for (let i = 0; i < 150; i++) { g.setInput({ mx: 0, mz: side, sprint: true, shootHeld: true }); g.step(1 / 60); const e = g.events.find(x => x.type === 'slam'); if (e) { n++; if (e.made) made++; break; } }
  }
  assert.ok(n >= 20 && made === n, `${made} of ${n} wide-open dunks made`);
});

test('Contact Finisher: the push-off on layups, and a stopped dunk becomes his layup', () => {
  // a layup into a defender of equal strength: no push-off without the badge, a push-off with it
  const lay = cf => {
    const rng = new RNG(6), me = makeTeam(rng, 1, { catalog, level: 0.8 })[0], d = makeTeam(rng, 1, { catalog, level: 0.8 })[0];
    me.human = true;
    const g = new Game({ mode: 'practice', seed: 6, rosters: [[me], [d]], catalog });
    const p = g.players[0], q = g.players[1], rim = g.rimFor(0), side = g.sideFor(0);
    p.badges = cf ? { contact_finisher: 3 } : {}; p.phys.strength = q.phys.strength;
    p.setPos(rim.x, rim.z - side * 2.6, side > 0 ? 0 : Math.PI); p.vz = side * 4; g.giveBall(p, 'dribble');
    q.setPos(rim.x, rim.z - side * 1.3, side > 0 ? Math.PI : 0);
    g.setInput({ mx: 0, mz: side, shootHeld: true });
    const a = g.startLayup(p, rim, {});
    let badge = false;
    for (let i = 0; i < 90 && !a.released; i++) {
      // keep the defender planted in the lane until the leap
      if (!a.jumped) { q.setPos(p.x, p.z + side * 0.62, side > 0 ? Math.PI : 0); q.vx = 0; q.vz = 0; }
      g.setInput({ mx: 0, mz: side, shootHeld: true }); g.step(1 / 60);
      if (g.events.some(e => e.type === 'badge' && e.badge === 'contact_finisher')) badge = true;
    }
    return { pushed: !!a.pushed, cf: a.cfPush || 0, badge };
  };
  const off = lay(false), on = lay(true);
  assert.equal(off.pushed, false, 'no push-off on an equal-strength defender without the badge');
  assert.ok(on.pushed && on.cf > 0 && on.badge, 'Contact Finisher pushes off, and the banner shows');
  // forced into a layup: the dunk can't get to the rim, Contact Finisher finishes it
  const { g, p, side } = dunkGame(80);
  p.badges = { contact_finisher: 2 };
  g.setInput({ mx: 0, mz: side, sprint: true, shoot: 'press', attack: true, shootHeld: true }); g.step(1 / 60);
  const a = p.action;
  assert.equal(a?.type, 'dunk');
  let ev = null;
  for (let i = 0; i < 150 && !ev; i++) {
    if (a.t >= a.slam - 1 / 60) p.x += 1.2; // (stopped short of the rim)
    g.setInput({ mx: 0, mz: side, sprint: true, shootHeld: true }); g.step(1 / 60);
    ev = g.events.find(e => e.type === 'feed');
  }
  assert.ok(ev && /finishes through the contact/.test(ev.text), ev?.text);
});

test('posting up neither drains nor recovers stamina, for the post player or his defender', () => {
  const g = game(1, { opp: 1, mode: 'park' }), p = g.players[0], d = g.players[1];
  for (const x of [p, d]) { x.stamina = 0.5; x.intent = { mx: 0, mz: 0 }; }
  p.posting = 1; d.postD = 1;
  for (let i = 0; i < 30; i++) { p.move(1 / 60, true); d.move(1 / 60, false); }
  assert.equal(p.stamina, 0.5); assert.equal(d.stamina, 0.5);
  p.posting = 0; d.postD = 0;
  for (let i = 0; i < 30; i++) { p.intent = { mx: 0, mz: 0 }; p.move(1 / 60, true); }
  assert.ok(p.stamina > 0.5, 'standing still recovers again');
});

test('on defense X / Square is a steal, not a jump, even while the possession flag lags', () => {
  const inp = Object.create(Input.prototype);
  Object.assign(inp, { down: new Set(), pressed: new Set(), released: new Set(), capturing: false, lastDevice: 'gamepad' });
  inp.applyBinds({});
  const btn = new Array(17).fill(false); btn[PAD.X] = true;
  inp.gp = { connected: true, family: 'ps', buttons: btn, prev: new Array(17).fill(false), values: [], axes: [0, 0, 0, 0], rs: newStickState() };
  const g = game(1, { opp: 1, mode: 'park' }), me = g.players[0], opp = g.players[1];
  g.giveBall(opp, 'dribble'); g.possession = me.team; // the flag still says it's ours
  const sess = Object.create(MatchSession.prototype);
  Object.assign(sess, { input: inp, game: g, pend: {}, rig: { inputBasis: () => ({ rx: 1, rz: 0, fx: 0, fz: 1 }) }, defHands: null });
  sess.captureInput();
  assert.equal(inp.ctx, 'defense');
  assert.ok(sess.pend.steal, 'a steal');
  assert.ok(!sess.pend.shoot, 'not a jump');
});

test('every AI player keeps a Lock-In grade, and it feeds his stamina', () => {
  const g = game(3, { opp: 3, mode: 'park', seed: 9 });
  for (let i = 0; i < 60 * 60 * 3 && !g.over; i++) g.step(1 / 60);
  const ai = g.players.filter(p => !p.human);
  assert.ok(ai.every(p => g.aiGrades.has(p.id)), 'one per AI player');
  assert.ok(ai.some(p => g.aiGrades.get(p.id).v !== 0), 'and they move with the play');
  g.step(1 / 60);
  for (const p of ai) assert.equal(p.stam.grade, g.aiGrades.get(p.id).index);
});

// ---------------- stage B: badge restrictions and badge art ----------------
import { badgeCaps, capBadges, hofCapacity, iconNeed, heightBand, BADGE_IDS } from '../client/js/sim/builds.js';
import { makeBot } from '../client/js/sim/bots.js';
import { Player } from '../client/js/sim/player.js';
import { badgeSVG, iconBadgeSVG, BADGE_GLYPHS, ICON_ART_IDS, HOF_COLORS } from '../client/js/ui/badgeart.js';
import { ICON_BADGES } from '../client/js/sim/badges.js';

test('badges are restricted by archetype and height, for you and the AI alike', () => {
  const ss = badgeCaps({ archetype: 'sharpshooter', height: 76 });
  assert.equal(ss.limitless, 4); assert.equal(ss.posterizer, 1); assert.equal(ss.rim_protector, 1);
  // height opens and closes doors
  assert.equal(heightBand(72), 'small'); assert.equal(heightBand(86), 'giant');
  assert.ok(badgeCaps({ archetype: 'playmaker', height: 70 }).ankle_breaker > badgeCaps({ archetype: 'playmaker', height: 86 }).ankle_breaker);
  assert.ok(badgeCaps({ archetype: 'glass_cleaner', height: 86 }).rebound_chaser > badgeCaps({ archetype: 'glass_cleaner', height: 72 }).rebound_chaser);
  assert.deepEqual(capBadges({ posterizer: 4, deadeye: 4 }, { archetype: 'sharpshooter', height: 76 }), { posterizer: 1, deadeye: 4 });
  // the sim plays a badge at its cap
  const rng = new RNG(3), bot = makeBot(rng, { position: 'PG', archetype: 'sharpshooter', level: 1 });
  const p = new Player(0, 0, { ...bot, badges: { posterizer: 4, deadeye: 4 } }, catalog);
  assert.equal(p.badges.posterizer, 1); assert.equal(p.badges.deadeye, 4);
  // AI hoopers never carry a badge above their build's cap
  for (let s = 0; s < 120; s++) {
    const r = new RNG(s), b = makeBot(r, { level: r.range(0.3, 1) }), cap = badgeCaps(b.build);
    for (const [k, t] of Object.entries(b.badges)) assert.ok(t <= cap[k], `${b.build.archetype} ${b.build.height}in ${k} ${t} > ${cap[k]}`);
  }
  // every build can still earn its Icon badge
  for (const a of Object.keys(ICON_BADGES).map(k => ICON_BADGES[k].archetype)) for (let h = 67; h <= 87; h++) {
    assert.ok(hofCapacity({ archetype: a, height: h }) >= 3); assert.equal(iconNeed({ archetype: a, height: h }), Math.min(7, hofCapacity({ archetype: a, height: h })));
  }
});

test('badge art: a glyph per badge, a frame per tier, a living Hall of Fame look, and an Icon design per archetype', () => {
  assert.deepEqual(Object.keys(BADGE_GLYPHS).sort(), [...BADGE_IDS].sort());
  assert.equal(new Set(Object.values(BADGE_GLYPHS)).size, BADGE_IDS.length, 'every glyph is its own');
  const tiers = [0, 1, 2, 3, 4].map(t => badgeSVG('deadeye', t, 48));
  assert.equal(new Set(tiers.map(s => s.replace(/id="[^"]+"|url\(#[^)]+\)/g, ''))).size, 5, 'each tier looks different');
  assert.ok(tiers[3].includes('<ellipse') && !tiers[2].includes('<ellipse'), 'Gold adds the laurel wreath');
  assert.ok(tiers[4].includes('hof-vibe') && tiers[4].includes('animateTransform') && HOF_COLORS.every(c => tiers[4].includes(c)), 'Hall of Fame is vibrant and alive');
  // gradient ids are unique per badge, so any number can sit on one screen
  const ids = s => [...s.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids(tiers[3] + badgeSVG('deadeye', 3)).length, new Set(ids(tiers[3] + badgeSVG('deadeye', 3))).size);
  // Icon badges: one design per archetype, white with gold, full spectrum inside
  assert.deepEqual(ICON_ART_IDS.sort(), Object.keys(ICON_BADGES).sort());
  const arts = ICON_ART_IDS.map(k => iconBadgeSVG(k, 64));
  assert.equal(new Set(arts.map(s => s.replace(/id="[^"]+"|url\(#[^)]+\)/g, ''))).size, arts.length);
  for (const s of arts) { assert.ok(s.includes('#ffffff') && s.includes('#e9b638'), 'white and gold'); assert.ok(/hsl\(0,100%,55%\)/.test(s) && /hsl\(2\d\d,100%,5\d%\)/.test(s), 'spectrum'); }
});

// ---------------- stage D: dribbling, stick combos, passing, box-outs, speed ----------------
import { stickMove, MOVES, FAMILIES, comboName, MOVE_STYLE } from '../client/js/sim/moves.js';
import { stickGesture as sg2, stickDiag } from '../client/js/core/input.js';
import { chainAt, moveSnapRate, GAME_SPEED } from '../client/js/sim/game.js';
import { physical, rk } from '../client/js/sim/ratings.js';

function handler2(opts = {}) {
  const rng = new RNG(opts.seed || 3), me = makeTeam(rng, 1, { catalog, level: 0.7 })[0], d = makeTeam(rng, 1, { catalog, level: 0.7 })[0];
  me.human = true;
  const g = new Game({ mode: 'practice', seed: 3, rosters: [[me], opts.def ? [d] : []], catalog });
  const p = g.players[0];
  if (opts.style) p.sizeupStyle = opts.style;
  if (opts.handle) { p.ratings.ball_handle = opts.handle; }
  const rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x, rim.z - side * 7, side > 0 ? 0 : Math.PI);
  g.giveBall(p, 'dribble');
  return { g, p, rim, side };
}

test('stick combinations call crossovers, behind-the-backs, escapes, momentum dribbles and spins', () => {
  const fams = new Set(Object.values(MOVES).map(m => m.fam));
  assert.deepEqual([...fams].sort(), Object.keys(FAMILIES).sort());
  const c = (stick, ctx = {}) => stickMove(stick, ctx);
  assert.equal(c('left'), 'cross'); assert.equal(c('left', { slow: true }), 'hang'); assert.equal(c('left', { sprint: true }), 'btl'); assert.equal(c('left', { toBallHand: true }), 'inout');
  assert.equal(c('down'), 'stepback'); assert.equal(c('down', { moving: true }), 'btb'); assert.equal(c('down', { backward: true }), 'retreat');
  // (v0.4.7.5 quick patch: every diagonal does two things, by whether he's moving; see v0475qp.test.mjs)
  assert.equal(c('down-left', { moving: true }), 'wrap'); assert.equal(c('down-right', { toBallHand: true }), 'sidestep');
  assert.equal(c('up'), 'hesi'); assert.equal(c('up', { sprint: true }), 'momentum'); assert.equal(c('up-left', { toBallHand: true }), 'stutter');
  assert.equal(c('spin', { moving: true }), 'spin'); assert.equal(c('spin'), 'halfspin');
  // every family has at least two moves
  for (const f of Object.keys(FAMILIES)) assert.ok(Object.values(MOVES).filter(m => m.fam === f).length >= 2, f);
  // the stick: diagonals and slow pushes are read
  assert.equal(stickDiag(0.7, 0.7), 'down-right'); assert.equal(stickDiag(-0.7, -0.7), 'up-left'); assert.equal(stickDiag(1, 0.1), null);
  const s = newStickState(); let out = null;
  for (const [x, y] of [[0, 0], [0.2, 0.2], [0.35, 0.35], [0.5, 0.5], [0.7, 0.7]]) { const o = sg2(s, x, y, 1 / 60); if (o.push) out = o; }
  assert.equal(out.diag, 'down-right');
  const s2 = newStickState(); let slow = null;
  for (let i = 0; i <= 60; i++) { const o = sg2(s2, i / 60, 0, 1 / 60); if (o.push) slow = o; }
  assert.ok(slow && slow.slow && !slow.flick, 'a slow push');
});

test('every move runs: the right burst, the right hand, and each package plays it its own way', () => {
  const go = (move, opts = {}) => {
    const h = handler2(opts); h.g.setInput({ mx: 0, mz: 0, move }); h.g.step(1 / 60);
    const a = h.p.action, x0 = h.p.x, z0 = h.p.z, hand0 = h.p.dribble.hand, d0r = Math.hypot(h.rim.x - x0, h.rim.z - z0);
    for (let i = 0; i < 60 && h.p.action === a; i++) { h.g.setInput({ mx: 0, mz: 0 }); h.g.step(1 / 60); }
    return { a, moved: Math.hypot(h.p.x - x0, h.p.z - z0), switched: h.p.dribble.hand !== hand0, closer: d0r - Math.hypot(h.rim.x - h.p.x, h.rim.z - h.p.z) };
  };
  for (const m of Object.keys(MOVES)) {
    const r = go(m);
    assert.equal(r.a?.type, 'move', m); assert.equal(r.a.move, m);
    assert.equal(r.switched, MOVES[m].sw != null, `${m}: hand switch`);
    assert.ok(r.moved > 0.15, `${m} moves him (${r.moved.toFixed(2)} m)`);
  }
  assert.ok(go('retreat').closer < -0.5 && go('stepback').closer < -0.4, 'escapes go away from the rim');
  assert.ok(go('momentum').closer > go('hesi').closer, 'the momentum dribble eats the most ground');
  // packages: the elite hang is quicker than the basic one; a crab's sidestep goes wider
  assert.ok(go('hang', { style: 'elite' }).a.dur < go('hang', { style: 'basic' }).a.dur);
  assert.ok(go('sidestep', { style: 'crab' }).moved > go('sidestep', { style: 'basic' }).moved);
  assert.ok(Object.keys(MOVE_STYLE).length >= 10);
});

test('a better handle: the moves come out quicker, chain sooner and snap harder; named combos', () => {
  const lo = handler2({ handle: 60 }), hi = handler2({ handle: 99 });
  assert.ok(Math.abs(chainAt(lo.p) - 0.6) < 0.01 && chainAt(hi.p) < 0.42, `chain at ${chainAt(lo.p)} / ${chainAt(hi.p).toFixed(2)}`);
  assert.ok(moveSnapRate(hi.p) > moveSnapRate(lo.p) * 1.5);
  for (const h of [lo, hi]) { h.g.setInput({ mx: 0, mz: 0, move: 'cross' }); h.g.step(1 / 60); }
  assert.ok(hi.p.action.dur < lo.p.action.dur * 0.78, `${hi.p.action.dur.toFixed(3)} vs ${lo.p.action.dur.toFixed(3)} s`);
  // the next move cuts in sooner with the better handle
  const cut = h => { const a = h.p.action; let n = 0; while (h.p.action === a && n < 60) { h.g.setInput({ mx: 0, mz: 0, move: 'btb' }); h.g.step(1 / 60); n++; } return n; };
  assert.ok(cut(hi) < cut(lo));
  // in-and-out into a crossover: the killer crossover
  assert.equal(comboName('inout', 'cross'), 'Killer crossover');
  const k = handler2({ handle: 85 });
  k.g.setInput({ mx: 0, mz: 0, move: 'inout' }); k.g.step(1 / 60);
  let ev = null;
  for (let i = 0; i < 40 && !ev; i++) { k.g.setInput({ mx: 0, mz: 0, move: 'cross' }); k.g.step(1 / 60); ev = k.g.events.find(e => e.type === 'move' && e.combo); }
  assert.equal(ev?.combo, 'Killer crossover');
});

test('passes go to the teammate closest to where you aim, and you turn to him before it leaves your hands', () => {
  const rng = new RNG(8), team = makeTeam(rng, 3, { catalog, level: 0.7 });
  team[0].human = true;
  const g = new Game({ mode: 'park', seed: 8, rosters: [team, makeTeam(rng, 3, { catalog, level: 0.5 })], catalog });
  g.phase = 'live';
  const [me, a, b] = g.players;
  me.setPos(0, 6, 0); a.setPos(5, 6.3, 0); b.setPos(-5, 6, 0);
  for (const o of g.players.slice(3)) o.setPos(o.x, 12 + o.id, 0);
  g.giveBall(me, 'held');
  // aim left (−x): b, even though he's the same distance away
  assert.equal(g.passTargetByDir(me, { x: -1, z: 0 }), b);
  assert.equal(g.passTargetByDir(me, { x: 1, z: 0.1 }), a);
  // no stick: where he's looking. He faces +z, b is 100 degrees off, a 85: a
  me.facing = 0; assert.equal(g.passTargetByDir(me, null), a);
  // facing the other way from his target: he turns round before letting it go
  me.facing = Math.PI / 2; // facing +x, toward a
  g.setInput({ mx: 0, mz: 0, pass: { dir: { x: -1, z: 0 }, type: 'chest' } }); g.step(1 / 60);
  const act = me.action; assert.equal(act?.type, 'pass'); assert.equal(act.to, b.id);
  let rel = null;
  for (let i = 0; i < 60 && !rel; i++) { g.setInput({ mx: 0, mz: 0 }); g.step(1 / 60); if (act.released) rel = { facing: me.facing }; }
  const off = Math.abs(Math.atan2(Math.sin(rel.facing - (-Math.PI / 2)), Math.cos(rel.facing - (-Math.PI / 2))));
  assert.ok(off < 1.06, `faced him within 60 degrees at the release (${(off * 57.3).toFixed(0)})`);
  assert.equal(g.ball.info?.to, b.id);
});

test('box-outs physically stop the man sealed behind you, and win you the board', () => {
  const run = boxer => {
    const rng = new RNG(5), off = makeTeam(rng, 1, { catalog, level: 0.7 }), def = makeTeam(rng, 1, { catalog, level: 0.7 });
    const g = new Game({ mode: 'park', seed: 5, rosters: [off, def], catalog });
    g.phase = 'live';
    const crasher = g.players[0], d = g.players[1], rim = g.rimFor(0), side = g.sideFor(0);
    crasher.setPos(rim.x, rim.z - side * 3.4, side > 0 ? 0 : Math.PI);
    d.setPos(boxer ? rim.x : rim.x + 6, boxer ? rim.z - side * 2.82 : rim.z, side > 0 ? 0 : Math.PI);
    // a shot in the air
    g.ball.setFlight(rim.x + 3, 2.5, rim.z - side * 5, 0, 6, side * 2, 'shot', { team: 0, shooter: 99, side, time: 0 });
    g.ball.flightTime = 0.5;
    const z0 = Math.abs(crasher.z - rim.z);
    let flagged = false;
    for (let i = 0; i < 30; i++) {
      crasher.ai = null; g.ai.think = () => {};
      crasher.intent = { ...crasher.intent };
      for (const p of g.players) p.intent = { mx: 0, mz: 0 };
      crasher.intent.mz = side; crasher.intent.sprint = true; // charging the rim
      g.ball.y = 3; g.ball.vy = 1; g.ball.mode = 'flight'; g.ball.kind = 'shot';
      for (const p of g.players) { g.moveOne(p, 1 / 60); }
      g.boxOuts(1 / 60); g.collide(1 / 60);
      if (crasher.boxedOut) flagged = true;
    }
    return { gained: z0 - Math.abs(crasher.z - rim.z), flagged, d };
  };
  const free = run(false), boxed = run(true);
  assert.ok(free.gained > 1.5, `unboxed he gets ${free.gained.toFixed(2)} m to the rim`);
  assert.ok(boxed.flagged, 'boxed out');
  assert.ok(boxed.gained < free.gained * 0.35, `boxed out he gets ${boxed.gained.toFixed(2)} m`);
});

test('sprinting is the same pace in every mode, with or without the ball, and Speed spreads players like any stat', () => {
  const top = (mode, ball) => {
    const rng = new RNG(2), t = makeTeam(rng, 1, { catalog, level: 0.7 });
    t[0].human = true;
    const g = new Game({ mode, seed: 2, rosters: [t, makeTeam(rng, 1, { catalog, level: 0.5 })], catalog, full: mode === 'park' });
    g.phase = 'live';
    const p = g.players[0]; p.setPos(0, 0, 0); g.players[1].setPos(10, 12, 0);
    if (ball) g.giveBall(p, 'dribble'); else g.giveBall(g.players[1], 'held');
    let v = 0;
    for (let i = 0; i < 90; i++) { p.stamina = 1; p.intent = { ...p.intent }; p.move(1 / 60, ball, 0); p.intent = { mx: 0, mz: 1, sprint: true }; v = Math.max(v, p.speed); }
    return v;
  };
  const ref = top('park', false);
  for (const m of ['park', 'proam', 'practice']) {
    assert.ok(Math.abs(top(m, false) - ref) < 1e-6, `${m} without the ball`);
    assert.ok(Math.abs(top(m, true) - top('park', true)) < 1e-6, `${m} with the ball`);
  }
  // the speed spread follows the rating curve every other stat uses
  const sp = v => physical({ height: 76, weight: 200, attributes: { speed: v, acceleration: v, speed_with_ball: v } });
  for (const v of [50, 65, 80, 99]) assert.ok(Math.abs(sp(v).sprint - (6 + rk(v) * 2)) < 1e-9);
  assert.ok(sp(99).sprint / sp(60).sprint > 1.25, `a 99 is ${((sp(99).sprint / sp(60).sprint - 1) * 100).toFixed(0)}% faster than a 60`);
  assert.ok(GAME_SPEED > 1, 'and the park roam moves at game pace (GAME_SPEED)');
});

// ---------------- stage E: AI ----------------
import { moveTend, pickMove as aiPick, SITU } from '../client/js/sim/ai.js';

test('every AI hooper has dribble moves of his own, and the AI uses the whole bag', () => {
  const rng = new RNG(21), team = makeTeam(rng, 5, { catalog, level: 0.8 });
  const g = new Game({ mode: 'proam', seed: 21, rosters: [team, makeTeam(rng, 5, { catalog, level: 0.8 })], catalog });
  const favs = g.players.map(p => { const t = moveTend(p); return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(','); });
  assert.ok(new Set(favs).size >= 6, `different favourites: ${favs.join(' | ')}`);
  // the same situation, two players: different habits
  const dist = p => { const r = new RNG(5), c = {}; for (let i = 0; i < 400; i++) { const m = aiPick(p, r, 0.7, SITU.probe); c[m] = (c[m] || 0) + 1; } return c; };
  const a = dist(g.players[0]), b = dist(g.players[6]);
  const diff = Object.keys({ ...a, ...b }).reduce((s, k) => s + Math.abs((a[k] || 0) - (b[k] || 0)), 0) / 800;
  assert.ok(diff > 0.12, `habits differ (${(diff * 100).toFixed(0)}% of picks)`);
  // in real games: the whole bag gets used
  const used = new Set();
  for (let s = 1; s <= 3; s++) {
    const r = new RNG(s * 7), gg = new Game({ mode: 'park', seed: s * 7, rosters: [makeTeam(r, 3, { catalog, level: 0.7 }), makeTeam(r, 3, { catalog, level: 0.7 })], catalog, target: 21 });
    for (let i = 0; i < 60 * 60 * 6 && !gg.over; i++) { gg.step(1 / 60); for (const e of gg.events) if (e.type === 'move') used.add(e.move); }
  }
  assert.ok(used.size >= 11, `${used.size} different moves: ${[...used].join(', ')}`);
});

test('AI offense: open shots get taken, crowded shooters make space, screens and cuts happen, little dead dribbling', () => {
  // a wide-open 80 three-point shooter at the arc lets it fly
  const rng = new RNG(31), t = makeTeam(rng, 1, { catalog, level: 0.8 }), d = makeTeam(rng, 1, { catalog, level: 0.5 });
  t[0].build.attributes = { ...t[0].build.attributes, three_point: 85, mid_range: 82 };
  const g = new Game({ mode: 'park', seed: 31, rosters: [t, d], catalog });
  g.phase = 'live';
  const p = g.players[0], q = g.players[1], rim = g.rimFor(0), side = g.sideFor(0);
  p.setPos(rim.x + 0.5, rim.z - side * 7.4, side > 0 ? 0 : Math.PI); q.setPos(rim.x + 5, rim.z - side * 1, 0);
  g.giveBall(p, 'dribble'); g.possession = 0;
  let shot = false;
  for (let i = 0; i < 120 && !shot; i++) { q.setPos(rim.x + 5, rim.z - side * 1, 0); g.step(1 / 60); if (p.action?.type === 'shoot') shot = true; }
  assert.ok(shot, 'wide open: he shoots');
  // in games: escapes, screens, cuts; stationary dribbling stays rare
  const tot = {}; let dead = 0, mins = 0;
  for (let s = 1; s <= 4; s++) {
    const r = new RNG(s * 13), gg = new Game({ mode: 'park', seed: s * 13, rosters: [makeTeam(r, 3, { catalog, level: 0.7 }), makeTeam(r, 3, { catalog, level: 0.7 })], catalog, target: 21 });
    let st = 0;
    for (; st < 60 * 60 * 12 && !gg.over; st++) {
      gg.step(1 / 60);
      const h = gg.ball.holder;
      if (h >= 0 && gg.ball.mode === 'dribble' && gg.phase === 'live') { const hp = gg.players[h]; if (hp.speed < 0.8 && !hp.action && !(hp.posting > 0)) dead += 1 / 60; }
      for (const e of gg.events) if (e.type === 'screen') tot.screenEv = (tot.screenEv || 0) + 1;
    }
    mins += st / 3600;
    for (const [k, v] of Object.entries(gg.ai.stats)) tot[k] = (tot[k] || 0) + v;
  }
  assert.ok(tot.escape > 4, `escape dribbles: ${tot.escape}`);
  assert.ok((tot.screenCall || 0) + (tot.screenSelf || 0) > 20 && tot.screenEv > 8, `screens: ${tot.screenCall}+${tot.screenSelf} called, ${tot.screenEv} set`);
  assert.ok(tot.cuts > 10, `cuts: ${tot.cuts}`);
  // (qp3: 1.0 → 1.2; the figure swings 0.6-1.1 s/min between seed sets with or without the defensive changes, and
  // these four seeds moved from 0.88 to 1.08 when the defense started drawing random bad steps and transition traits)
  assert.ok(dead / mins < 1.2, `stationary dribbling ${(dead / mins).toFixed(2)} s a minute`);
});

test('cherry-picking gets read: a safety stays home, and the man who leaked out is picked up and his pass jumped', () => {
  const rng = new RNG(41), A = makeTeam(rng, 3, { catalog, level: 0.85 }), B = makeTeam(rng, 3, { catalog, level: 0.6 });
  B[0].human = true;
  const g = new Game({ mode: 'park', full: true, seed: 41, rosters: [A, B], catalog });
  g.phase = 'live';
  for (const p of g.players) p.iq = 0.85;
  const [a0, a1, a2, b0, b1, b2] = g.players;
  const rimA = g.rimFor(0), rimB = g.rimFor(1);
  // A attacks rimA; B's b0 hangs out by rimB (the basket A defends)
  a0.setPos(rimA.x, rimA.z - g.sideFor(0) * 6.5, 0); a1.setPos(rimA.x + 4, rimA.z - g.sideFor(0) * 5, 0); a2.setPos(rimA.x - 4, rimA.z - g.sideFor(0) * 4, 0);
  b1.setPos(rimA.x + 2, rimA.z - g.sideFor(0) * 5, 0); b2.setPos(rimA.x - 2, rimA.z - g.sideFor(0) * 3, 0);
  b0.setPos(rimB.x + 1, rimB.z - g.sideFor(1) * 3, 0);
  g.giveBall(a0, 'dribble'); g.possession = 0;
  assert.equal(g.ai.lurker(0), b0, 'the lurker is spotted');
  const safety = g.ai.safetyFor(0, b0);
  assert.ok(safety && safety !== a0, 'a safety is named');
  const d0 = Math.hypot(safety.x - b0.x, safety.z - b0.z);
  for (let i = 0; i < 300; i++) { b0.setPos(rimB.x + 1, rimB.z - g.sideFor(1) * 3, 0); g.setInput({ mx: 0, mz: 0 }); g.step(1 / 60); if (g.ball.holder !== a0.id) g.giveBall(a0, 'dribble'); }
  const d1 = Math.hypot(safety.x - b0.x, safety.z - b0.z);
  assert.ok(d1 < d0 - 5 && d1 < 6, `the safety drops back (${d0.toFixed(1)} -> ${d1.toFixed(1)} m from him)`);
  // he sits between the lurker and the basket
  assert.ok(Math.hypot(safety.x - rimB.x, safety.z - rimB.z) < Math.hypot(b0.x - rimB.x, b0.z - rimB.z) + 1.5);
  // the other way round: B rebounds at the far end while b0 has leaked out by his basket. The closest A defender
  // runs back to him, and goes for the outlet pass
  const r2 = new RNG(43), g2 = new Game({ mode: 'park', full: true, seed: 43, rosters: [makeTeam(r2, 3, { catalog, level: 0.85 }), makeTeam(r2, 3, { catalog, level: 0.6 })], catalog });
  g2.phase = 'live'; for (const p of g2.players) p.iq = 0.85;
  const [c0, c1, c2, e0, e1, e2] = g2.players, rA = g2.rimFor(0), rB = g2.rimFor(1), sA = g2.sideFor(0);
  c0.setPos(rA.x + 1, rA.z - sA * 3, 0); c1.setPos(rA.x - 2, rA.z - sA * 4, 0); c2.setPos(rA.x + 3, rA.z - sA * 6, 0);
  e1.setPos(rA.x, rA.z - sA * 2, 0); e2.setPos(rA.x - 3, rA.z - sA * 3, 0); e0.setPos(rB.x + 1.5, rB.z - g2.sideFor(1) * 3.5, 0);
  g2.giveBall(e1, 'held'); g2.possession = 1;
  const guard = g2.ai.guardFor(0, e0);
  assert.ok(guard, 'someone picks him up');
  const gd0 = guard.dist(e0);
  for (let i = 0; i < 240; i++) { e0.setPos(rB.x + 1.5, rB.z - g2.sideFor(1) * 3.5, 0); for (const p of [e1, e2]) p.vx = p.vz = 0; g2.step(1 / 60); if (g2.ball.holder !== e1.id) g2.giveBall(e1, 'held'); }
  assert.ok(guard.dist(e0) < gd0 - 8, `the guard gets back to him (${gd0.toFixed(1)} -> ${guard.dist(e0).toFixed(1)} m)`);
});

// ---------------- stage F: animations ----------------
import { HUSTLE_TIMING, dunkSpin as dunkSpin2 } from '../client/js/sim/shots.js';
import { ANKLE_REACT, millCircle } from '../client/js/sim/game.js';

test('animations doubled in every category, a dozen movement styles, and the AI wears them', () => {
  const n = slot => list.filter(i => i.category === 'animation' && i.slot === slot).length;
  assert.deepEqual([n('jumpshot'), n('release'), n('dunk'), n('sizeup'), n('layup'), n('celebration')], [30, 32, 29, 20, 8, 34]); // (qp3: + the Hash-Slinging Icon package, not for sale)
  assert.ok(n('movement') >= 13, 'standard plus at least 12 movement styles');
  const styles = new Set();
  for (let s = 0; s < 40; s++) { const b = makeBot(new RNG(s), { level: 0.7, catalog }); styles.add(b.build.equipment?.movement); }
  assert.ok(styles.size >= 8, `AI hoopers move ${styles.size} different ways`);
});

test('hustle shots: running pull-ups, running fades and pro hops, each with its own timing and window', () => {
  const run = (vx, vz) => {
    const { g, p, rim, side } = handler2();
    p.setPos(rim.x - (vx ? 1 : 0), rim.z - side * 5.8, side > 0 ? 0 : Math.PI); g.giveBall(p, 'dribble');
    p.vx = vx; p.vz = vz * side;
    g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true, forceJumper: true }); g.step(1 / 60);
    return p.action;
  };
  const still = run(0, 0), pull = run(0, 5.5), fade = run(0, -5.5), hop = run(5.5, 0);
  assert.equal(still.hustle, null); assert.equal(pull.hustle, 'pullup'); assert.equal(fade.hustle, 'runfade'); assert.equal(hop.hustle, 'prohop');
  assert.ok(pull.tRel < still.tRel && still.tRel < fade.tRel && fade.tRel < hop.tRel, 'quickest to latest: pull-up, set shot, fade, pro hop');
  assert.ok(HUSTLE_TIMING.pullup < 1 && HUSTLE_TIMING.prohop > HUSTLE_TIMING.runfade);
  // the pro hop is gathered: a bigger window than the pull-up at the same speed
  const w = act => S.greenWindowMs(85, {}, { moving: act.moving, fade: act.fade, hustle: act.hustle, d: 5.8 });
  assert.ok(w(hop) > w(pull) && w(pull) > w(fade));
});

test('360s turn all the way round, windmills go all the way round, and ankle-breakers drop people their own way', () => {
  for (const st of ['360', 'rev360', 'spinmill', 'helicopter']) assert.ok(Math.abs(dunkSpin2({ type: 'dunk', style: st, takeoff: 0.3, slam: 0.9, spinDir: 1, t: 0.86 }) - Math.PI * 2) < 0.03, st);
  // the windmill's ball (and the hand on it) sweeps through a full turn
  const { g, p } = handler2(); const a = { type: 'dunk', style: 'windmill', slam: 1, t: 0, takeoff: 0.2 }; p.action = a;
  let prev = null, turn = 0;
  // (v0.4.7.5 quick patch: the circle is centred on the shoulder (millCircle) and goes round in the air, to the slam)
  const C = millCircle(p, p.phys.H);
  for (let i = 0; i <= 100; i++) { a.t = i / 100; const w = g.holdPoint(p); const loc = { y: w.y - C.cy, z: (w.x - p.x) * Math.sin(p.facing) + (w.z - p.z) * Math.cos(p.facing) - C.cz }; const ang = Math.atan2(loc.y, loc.z); if (prev != null) { let d = ang - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn += d; } prev = ang; }
  assert.ok(Math.abs(turn) > Math.PI * 1.5, `the arm turns ${(Math.abs(turn) * 180 / Math.PI).toFixed(0)} degrees before the slam`);
  // reactions by move family
  const seen = {};
  for (const mv of ['cross', 'spin', 'stepback', 'hesi', 'btb']) { seen[mv] = new Set(); for (let i = 0; i < 200; i++) seen[mv].add(g.ankleReact(mv)); }
  assert.ok(seen.spin.has('spun') && !seen.stepback.has('spun'));
  assert.ok(seen.stepback.has('faceplant') && seen.cross.has('slip') && seen.hesi.has('stagger'));
  assert.ok(Object.keys(ANKLE_REACT).length >= 9);
});

// ---- stage G: clean limbs, fluid motion, straps on top ----
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel, torsoTable } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B as BONE } from '../client/js/char/skeleton.js';
import * as MM from '../client/js/core/math.js';
import { Material } from '../client/js/gfx/renderer.js';
import { STD_VS } from '../client/js/gfx/shaders.js';

const catG = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
function inTorsoG(rig, P) {
  const H = rig.d.H, g = rig.d.girth || 1, c = rig.pos[BONE.chest], hy = rig.pos[BONE.hips][1], ny = rig.pos[BONE.neck][1];
  if (P[1] < hy || P[1] > ny - 0.02 * H) return false;
  const inv = MM.qinvert(MM.q4(), rig.rot[BONE.chest]); const v = [0, 0, 0];
  MM.v3transformQuat(v, [P[0] - c[0], P[1] - c[1], P[2] - c[2]], inv);
  const tt = torsoTable((rig.bind[BONE.chest][1] + v[1]) / H);
  const rx = tt[0] * g * H, zz = v[2] - tt[3] * H, rz = (zz >= 0 ? tt[1] : tt[2]) * g * H;
  return (v[0] / rx) ** 2 + (zz / rz) ** 2 < 1;
}

test('limbs stay out of the body: elbows and hands clear the torso and head, feet and knees never cross', () => {
  const rng = new RNG(62);
  const g = new Game({ mode: 'park', seed: 62, rosters: [makeTeam(rng, 3, { catalog: catG, level: 0.7 }), makeTeam(rng, 3, { catalog: catG, level: 0.7 })], catalog: catG, target: 21 });
  const views = g.players.map(p => {
    const model = new AthleteModel(p.entry.build, {}, 0.5), rig = new Rig(model);
    const view = { H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } };
    return { rig, anim: new Animator(view) };
  });
  const c = { frames: 0, elbow: 0, hand: 0, head: 0, feet: 0, knees: 0 };
  for (let i = 0; i < 60 * 75 && !g.over; i++) {
    g.step(1 / 60);
    for (let k = 0; k < g.players.length; k++) {
      const p = g.players[k], v = views[k];
      v.anim.update(1 / 60, { x: p.x, y: p.y, z: p.z, facing: p.facing }, p, g, { x: g.ball.x, y: g.ball.y, z: g.ball.z });
      if (i % 5) continue;
      const r = v.rig, H = r.d.H; c.frames++;
      for (const s of ['L', 'R']) {
        const E = r.pos[BONE['fore' + s]], W = r.pos[BONE['hand' + s]], hd = r.pos[BONE.head];
        if (inTorsoG(r, E)) c.elbow++;
        if (inTorsoG(r, W)) c.hand++;
        if (Math.hypot(W[0] - hd[0], W[1] - hd[1] - 0.055 * H, W[2] - hd[2] - 0.01 * H) < 0.06 * H) c.head++;
      }
      const fl = r.pos[BONE.footL], fr = r.pos[BONE.footR], kl = r.pos[BONE.shinL], kr = r.pos[BONE.shinR];
      if (Math.hypot(fl[0] - fr[0], fl[1] - fr[1], fl[2] - fr[2]) < 0.05 * H) c.feet++;
      if (Math.hypot(kl[0] - kr[0], kl[1] - kr[1], kl[2] - kr[2]) < 0.06 * H) c.knees++;
    }
  }
  assert.ok(c.frames > 3000, `frames ${c.frames}`);
  const pct = n => n / c.frames;
  assert.ok(pct(c.elbow) < 0.002, `elbows in the torso ${c.elbow}/${c.frames}`);
  assert.ok(pct(c.hand) < 0.004, `hands in the torso ${c.hand}/${c.frames}`);
  assert.ok(pct(c.head) < 0.001, `hands in the head ${c.head}/${c.frames}`);
  assert.ok(pct(c.feet) < 0.005, `feet overlapping ${c.feet}/${c.frames}`);
  assert.ok(pct(c.knees) < 0.03, `knees touching ${c.knees}/${c.frames}`);
});

test('jersey straps are their own mesh drawn over the skin; other tops have none', () => {
  const build = { height: 78, weight: 210, wingspan: 82, hand: 'R' };
  const tank = new AthleteModel(build, { top: { family: 'jersey' } }, 0.5).buildAll();
  assert.ok(tank.straps && tank.straps.index.length > 0, 'a tank top has its straps');
  const tee = new AthleteModel(build, { top: { family: 'tee' } }, 0.5).buildAll();
  assert.equal(tee.straps, null);
  const m = new Material({ color: [0.5, 0.5, 0.5], layer: 3, viewBias: 0.018 });
  assert.equal(new Material({ ...m }).viewBias, 0.018);
  assert.match(STD_VS, /uViewBias/);
  assert.match(fs.readFileSync(new URL('../client/js/char/view.js', import.meta.url), 'utf8'), /geo\.straps[^\n]*viewBias/);
});

// ---- stage H: green release sounds and effects ----
import { GREEN_SOUNDS, GREEN_SOUND_IDS, greenRecipe, playGreenSound, greenVoice } from '../client/js/core/greensound.js';
import { GREEN_FX, GREEN_FX_IDS, GreenFxRunner } from '../client/js/game/greenfx.js';
import { spreadGreens } from '../client/js/sim/bots.js';

// a stand-in Web Audio context: enough of the API for every recipe to build its graph
function mockAudio() {
  const param = v => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime(x) { if (!(x > 0)) throw new Error('exp ramp to ' + x); }, setTargetAtTime() {} });
  const node = extra => ({ connect(n) { if (!n) throw new Error('connect to nothing'); return n; }, start() {}, stop() {}, ...extra });
  const nodes = { n: 0 };
  const ctx = {
    currentTime: 0,
    createGain: () => (nodes.n++, node({ gain: param(1) })),
    createOscillator: () => (nodes.n++, node({ type: 'sine', frequency: param(440), detune: param(0) })),
    createBiquadFilter: () => (nodes.n++, node({ type: 'lowpass', frequency: param(1000), Q: param(1) })),
    createWaveShaper: () => (nodes.n++, node({ curve: null })),
    createBufferSource: () => (nodes.n++, node({ buffer: null, loop: false })),
    createDelay: () => (nodes.n++, node({ delayTime: param(0) })), // (v0.4.7.5 quick patch: the chant's stands)
    // (v0.4.7.5 quick patch: green sounds are rendered into a buffer and played from it)
    sampleRate: 48000,
    createBuffer: (ch, n, sr) => { const b = { numberOfChannels: ch, length: n, sampleRate: sr, data: new Float32Array(n), getChannelData() { return this.data; }, copyToChannel(x) { this.data.set(x); } }; buffers.push(b); return b; },
  };
  const buffers = [];
  ctx.createBufferSource = () => (nodes.n++, node({ buffer: null, loop: false, playbackRate: param(1) }));
  return { nodes, buffers, audio: { ctx, ensure: () => true, out: () => node({}), noise: () => ctx.createBufferSource(), cheer() {} } };
}

test('green release sounds: thirty to buy, a Cup exclusive, every one plays, and every AI player has his own', () => {
  const shop = Object.values(catG).filter(i => i.slot === 'greensound' && !i.exclusive && i.price > 0);
  const cup = Object.values(catG).filter(i => i.slot === 'greensound' && i.exclusive === 'cup');
  assert.ok(shop.length >= 30, `shop sounds ${shop.length}`); // (v0.4.7.5 quick patch: twice as many)
  assert.ok(cup.length >= 1);
  for (const i of Object.values(catG).filter(x => x.slot === 'greensound')) {
    assert.ok(GREEN_SOUNDS[i.id] && greenRecipe(i.id), `recipe for ${i.id}`);
    assert.doesNotMatch(i.name + i.description, /giant/i); // (original names only)
  }
  for (const id of GREEN_SOUND_IDS) {
    const m = mockAudio();
    const h = playGreenSound(m.audio, id, { pitch: 0.9, rate: 1.1, power: 1.22, pan: 0.3, vol: 0.6 });
    assert.ok(h && typeof h.stop === 'function', id); // (v0.4.7.5 quick patch: a handle that can cut it off)
    assert.equal(m.buffers.length, 1, `${id} is rendered once`);
    const x = m.buffers[0].data;
    let pk = 0; for (const v of x) { assert.ok(Number.isFinite(v)); pk = Math.max(pk, Math.abs(v)); }
    assert.ok(pk > 0.1 && pk <= 0.96, `${id} peak ${pk}`);
    assert.ok(x.length > 0.4 * 44100 && x.length <= 4.25 * 44100, `${id} runs ${(x.length / 44100).toFixed(2)} s`);
    // and the second play comes straight from the cache
    playGreenSound(m.audio, id, { pitch: 0.9, rate: 1.1 }); assert.equal(m.buffers.length, 1);
  }
  // the AI: everyone has a sound of his own (not the starter chime), and his own pitch and tempo on it
  const rng = new RNG(5), bots = Array.from({ length: 40 }, () => makeBot(rng, { catalog: catG, level: 0.6 }));
  assert.ok(bots.every(b => b.build.equipment.greensound && b.build.equipment.greensound !== 'gsnd_basic'));
  assert.ok(new Set(bots.map(b => b.build.equipment.greensound)).size >= 10, 'the park plays lots of different sounds');
  assert.ok(bots.every(b => !catG[b.build.equipment.greensound].exclusive && !catG[b.build.equipment.greenfx].exclusive));
  const voices = new Set(bots.map(b => JSON.stringify(greenVoice(b.name + '|x'))));
  assert.ok(voices.size >= 38, 'and plays it his own way');
  // in one game no two AI players share a sound or an effect (you keep yours)
  const team = Array.from({ length: 10 }, (_, i) => new Player(i, i % 2, bots[i % 3], catG)); // (lots of duplicates on purpose)
  team[0].human = true;
  spreadGreens(team, catG);
  assert.equal(new Set(team.map(p => p.greenSound)).size, 10);
  assert.equal(new Set(team.map(p => p.greenFx)).size, 10);
  assert.equal(team[0].greenSound, bots[0].build.equipment.greensound);
});

test('green release effects: twenty-six to buy, a Cup exclusive, each puts on its show and cleans up after', () => {
  const shop = Object.values(catG).filter(i => i.slot === 'greenfx' && !i.exclusive && i.price > 0);
  assert.ok(shop.length >= 26, `shop effects ${shop.length}`); // (v0.4.7.5 quick patch: twice as many)
  assert.ok(Object.values(catG).some(i => i.slot === 'greenfx' && i.exclusive === 'cup'));
  for (const i of Object.values(catG).filter(x => x.slot === 'greenfx')) assert.ok(GREEN_FX[i.id], i.id);
  for (const id of GREEN_FX_IDS) {
    const out = [];
    const ps = { emit(o) { const q = { ...o }; out.push(q); return q; }, burst(x, y, z, n) { for (let k = 0; k < n; k++) out.push({ x, y, z }); } };
    const r = new GreenFxRunner(ps, { view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    let hx = 3;
    r.play(id, () => [hx, 2.2, -1], () => [hx, 0, -1], 1.22);
    for (let f = 0; f < 60 * 3; f++) { r.tick(1 / 60); hx += 0.01; } // (he keeps moving: the effect follows)
    assert.ok(out.length >= 20, `${id} shows (${out.length} particles)`);
    assert.ok(out.length < 6000, `${id} stays light (${out.length})`);
    assert.equal(r.jobs.length, 0, `${id} finishes`);
    assert.ok(out.every(o => [o.x, o.y, o.z].every(Number.isFinite)), `${id} no NaN`);
    assert.ok(out.some(o => Math.abs(o.x - 3) < 4 && o.y > 1.5), `${id} is over his head`);
  }
});

// ---- stage I: the park ----
import { AIWorld, bountyFor, BOUNTY_MIN } from '../client/js/sim/world.js';
import { ParkHub } from '../client/js/game/park.js';

test('AI hoopers get better as they play (slowly), stay who they are, and it is saved', () => {
  const w = new AIWorld({ seed: 777, born: Date.now() }, catG);
  const id = w.ids().find(i => w.account(i).tier.id === 'regular');
  const before = w.entry(id);
  const ovr0 = before.build.overall, name = before.name, eq = JSON.stringify(before.build.equipment), h = before.build.height;
  for (let k = 0; k < 12; k++) w.playedGame([id], k % 2 ? [id] : []);
  const mid = w.entry(id);
  assert.ok(mid.build.overall >= ovr0 && mid.build.overall <= ovr0 + 2, `a dozen games: ${ovr0} -> ${mid.build.overall}`);
  for (let k = 0; k < 60; k++) w.playedGame([id], [id]);
  const after = w.entry(id);
  assert.ok(after.build.overall > ovr0, `${ovr0} -> ${after.build.overall}`);
  assert.ok(after.build.overall <= ovr0 + 6, 'slowly');
  assert.equal(after.name, name); assert.equal(after.build.height, h); assert.equal(JSON.stringify(after.build.equipment), eq);
  // your own games count too, and it all goes into the save
  w.recordGame([id], [], true);
  const saved = JSON.parse(JSON.stringify(w.toJSON()));
  assert.equal(saved.prog[id].g, 73);
  assert.equal(new AIWorld(saved, catG).entry(id).build.overall, w.entry(id).build.overall);
});

test('closing the game leaves your squad; the ones who choose to keep running together stay a group', () => {
  const w = new AIWorld({ seed: 99, born: Date.now() - 86400000, friends: ['ai-1', 'ai-2', 'ai-3'], squad: ['ai-1', 'ai-2', 'ai-3'] }, catG);
  w.online = () => true;
  assert.equal(w.leaveSquadOnStart(), true);
  assert.deepEqual(w.squad, []);
  assert.deepEqual(w.exSquad.ids, ['ai-1', 'ai-2', 'ai-3']);
  assert.ok(w.aiParty().every(id => w.exSquad.ids.includes(id)));
  assert.equal(w.leaveSquadOnStart(), false, '(nothing to leave the second time)');
  assert.deepEqual(new AIWorld(w.toJSON(), catG).exSquad.ids, ['ai-1', 'ai-2', 'ai-3']);
});

test('court bounties above six straight; the overview is live; View / Share held is read', () => {
  assert.equal(BOUNTY_MIN, 7);
  assert.equal(bountyFor(6), 0); assert.equal(bountyFor(7), 2500); assert.equal(bountyFor(9), 4000); assert.equal(bountyFor(40), 15000);
  const H = ParkHub.prototype;
  const hub = { overview: true, rig: { pos: [0, 80, 30], tgt: [0, 0, 0] } };
  assert.equal(H.courtWatched.call(hub, { origin: [52, 0, -10] }), true);
  // the card for a court: kings on 8 straight carry a bounty, and the court you're in line for says when you run
  const c = { name: 'Court 2', origin: [26, 0, 0], full: true, format: 3, lines: [null, null], session: { teams: [{ abbr: 'KNG' }, { abbr: 'CHL' }], game: { score: [7, 5], target: 11, over: false } }, kingsStreak: 8 };
  const me = { mine: true, members: [], fullAt: 1 };
  c.lines = [me, null];
  const hub2 = Object.assign(Object.create(H), { courts: [c], myCourt: null, mySession: null, cup: false, app: { char: () => ({ progression: {} }) } });
  const info = hub2.courtInfo(c);
  assert.deepEqual(info.score, [7, 5]);
  assert.equal(info.streak, 8);
  assert.equal(info.bounty, 3250);
  assert.equal(info.next, 'next');
  // the controller's View / Share button held
  const inp = Object.create(Input.prototype);
  Object.assign(inp, { down: new Set(), pressed: new Set(), released: new Set(), capturing: false, lastDevice: 'gamepad' });
  inp.applyBinds({});
  const btn = new Array(17).fill(false); btn[PAD.VIEW] = true;
  inp.gp = { connected: true, family: 'xbox', buttons: btn, prev: new Array(17).fill(false), values: [], axes: [0, 0, 0, 0], rs: newStickState() };
  assert.equal(inp.isDown('camera'), true);
  btn[PAD.VIEW] = false; inp.down.add('KeyV');
  assert.equal(inp.isDown('camera'), true, 'V on the keyboard');
});

// ---- stage J: store, inventory, menus ----
test('store and inventory: jumpshot bases and releases are their own categories; equipping lives in the Inventory', () => {
  const src = f => fs.readFileSync(new URL('../client/js/ui/' + f, import.meta.url), 'utf8');
  const store = src('store.js'), inv = src('inventory.js'), screens = src('screens.js');
  assert.match(store, /\['jumpshot', 'Jumpshot Bases'/);
  assert.match(store, /\['release', 'Releases'/);
  assert.doesNotMatch(store, /data-equip>|data-unequip>/, 'the store only sells');
  assert.match(inv, /data-equip>/); assert.match(inv, /data-unequip>/);
  assert.match(screens, /case 'inventory': return Inventory\.render/);
  assert.match(screens, /\['inventory', 'Inventory'\]/);
  // every equippable item in the catalog has a home in both screens
  const cats = [...store.matchAll(/\['(\w+)', '[^']+', '\w+', '[^']+'\]/g)].map(m => m[1]);
  const acc = new Set(['socks', 'headband', 'sleeve', 'leg_sleeve', 'wristband', 'knee_pad', 'chain']);
  for (const i of Object.values(catG)) assert.ok(cats.includes(acc.has(i.slot) ? 'accessory' : i.slot), `${i.id} (${i.slot}) has a category`);
});

// ---- stage K: soundtrack and bug reports ----
test('the new tracks are on the soundtrack; long mixes play their parts back to back', async () => {
  const dir = new URL('../client/audio/music/', import.meta.url);
  const list = JSON.parse(fs.readFileSync(new URL('tracks.json', dir))).tracks;
  assert.ok(list.length >= 44, `${list.length} tracks`);
  for (const t of list) for (const f of t.parts || [t.file]) {
    const st = fs.statSync(new URL(f, dir));
    assert.ok(st.size > 100000 && st.size < 30e6, `${f} ${st.size}`); // (every file under 30 MB: it fits through the PC transfer and GitHub)
  }
  for (const want of ['friends.mp3', 'back-in-black.mp3', 'soda-city-funk.mp3', 'tity-boi.mp3', 'do-i-wanna-know-instrumental.mp3']) assert.ok(list.some(t => t.file === want), want);
  assert.ok(list.filter(t => t.parts).length >= 3);
  const { Soundtrack } = await import('../client/js/core/music.js');
  const m = new Soundtrack(); const plays = [];
  m.el = { set src(v) { plays.push(v); }, play: () => Promise.resolve(), volume: 0 };
  m.wanted = true; m.current = list.find(t => t.parts); m.part = 0;
  assert.equal(m.nextPart(), true);
  assert.equal(plays.at(-1), 'audio/music/' + m.current.parts[1]);
  while (m.nextPart());
  assert.equal(m.part, m.current.parts.length - 1, 'then the next track');
});

test('Report a bug: F8 and the menus, with where you were and what the game was doing', () => {
  const src = f => fs.readFileSync(new URL('../client/js/' + f, import.meta.url), 'utf8');
  assert.match(src('main.js'), /e\.code === 'F8'/);
  assert.match(src('ui/screens.js'), /data-bug/);
  assert.match(src('ui/modes.js'), /Report a bug \(F8\)/);
  assert.match(src('game/session.js'), /logGameEvent\(e, g\)/);
  const py = fs.readFileSync(new URL('../server/bugs.py', import.meta.url), 'utf8');
  assert.match(py, /BUG_FILE = "Afterhours16_Bug_Reports.txt"/);
});
