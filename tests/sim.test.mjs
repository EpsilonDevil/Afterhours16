// Headless simulation tests: shot planning, full park and Pro-Am games, stat-line consistency.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { planShot } from '../client/js/sim/shots.js';
import { rimPos } from '../client/js/sim/constants.js';
import { RNG } from '../client/js/core/rng.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));

function play(mode, seed, opts = {}) {
  const rng = new RNG(seed);
  const size = mode === 'proam' ? 5 : (opts.size || 3);
  const rosters = [makeTeam(rng, size, { catalog, level: 0.6 }), makeTeam(rng, size, { catalog, level: 0.6 })];
  rosters[0][0].human = true; // the "user" slot, driven by the assist AI here
  const g = new Game({ mode, seed, rosters, catalog, target: opts.target || 21, quarterLen: opts.quarterLen || 120, quarters: 4, difficulty: 0.6, assist: true });
  let steps = 0;
  const max = 60 * 60 * (opts.maxMinutes || 30);
  while (!g.over && steps < max) { g.step(1 / 60); steps++; }
  return g;
}

function checkLine(s, label) {
  assert.equal(s.pts, 2 * s.fgm + s.tpm + s.ftm, `${label}: points add up`);
  assert.ok(s.fgm <= s.fga && s.tpm <= s.tpa && s.tpa <= s.fga && s.ftm <= s.fta, `${label}: makes <= attempts`);
  assert.ok((s.oreb || 0) <= s.reb, `${label}: offensive boards <= rebounds`);
}

test('planned makes go in and planned misses stay out, from every spot on both ends', () => {
  const rng = new RNG(11);
  for (const side of [1, -1]) {
    const rim = rimPos(side);
    let made = 0, missed = 0;
    for (let i = 0; i < 60; i++) {
      const d = 0.8 + rng.next() * 7.8, a = (rng.next() - 0.5) * Math.PI * 0.95;
      const P = { x: rim.x + Math.sin(a) * d, y: 2.4 + rng.next() * 0.5, z: rim.z - side * Math.cos(a) * d };
      if (planShot(rng, P, rim, side, true, 50).made) made++;
      if (!planShot(rng, P, rim, side, false, 50).made) missed++;
    }
    assert.ok(made >= 59, `side ${side}: ${made}/60 makes resolved`);
    assert.ok(missed >= 59, `side ${side}: ${missed}/60 misses resolved`);
  }
});

test('park games (3v3 and 2v2) finish at the target with consistent box scores', () => {
  for (const [seed, size] of [[101, 3], [202, 3], [303, 2]]) {
    const g = play('park', seed, { size, target: 21 });
    assert.ok(g.over, `seed ${seed} finished`);
    assert.ok(Math.max(...g.score) >= 21, `seed ${seed} reached 21`);
    assert.ok(g.score[g.winner] > g.score[1 - g.winner]);
    for (let t = 0; t < 2; t++) {
      const pts = g.players.filter(p => p.team === t).reduce((n, p) => n + p.stats.pts, 0);
      assert.equal(pts, g.score[t], `seed ${seed} team ${t} score equals player points`);
    }
    for (const p of g.players) checkLine(p.stats, `${seed}/${p.name}`);
    const sum = g.summary();
    assert.ok(sum.me && sum.duration >= 40, 'summary carries the user line and a plausible duration');
  }
});

test('a Pro-Am game plays four quarters and produces a winner', () => {
  const g = play('proam', 404, { quarterLen: 120, maxMinutes: 40 });
  assert.ok(g.over, 'finished');
  assert.ok(g.quarter >= 4, 'played four quarters');
  assert.notEqual(g.score[0], g.score[1]);
  for (const p of g.players) checkLine(p.stats, p.name);
  // (v0.4.3: this seed now rolls a defense-heavy matchup — seven Lockdowns — so it's a low-scoring game)
  assert.ok(g.score[0] > 0 && g.score[1] > 0 && g.score[0] + g.score[1] > 12, 'both teams actually scored');
});

// ---- v0.4.1 ----
import { pickFinish, shotTypeFor } from '../client/js/sim/shots.js';
import { LockedInGrade, GRADES } from '../client/js/game/grade.js';

test('driving finishes: the highest rating wins, the defense adjusts it', () => {
  const mk = r => ({ ratings: { driving_dunk: 80, layup: 75, mid_range: 70, block: 50, ...r }, phys: { reach: 2.65, vertical: 0.75 }, badges: {}, stamina: 1, x: 0, z: 0, vx: 0, vz: 5 });
  const open = { open: true, rimProtector: null, wall: null };
  assert.equal(pickFinish(mk({}), 3, open, true), 'dunk');
  assert.equal(pickFinish(mk({ driving_dunk: 60, layup: 90 }), 3, open, true), 'layup');
  assert.equal(pickFinish(mk({}), 3, open, false), 'layup'); // can't dunk
  const protector = { ratings: { block: 95 }, phys: { reach: 2.9 } };
  assert.equal(pickFinish(mk({ driving_dunk: 78, layup: 78 }), 3, { open: false, rimProtector: protector, wall: null }, true), 'layup');
  assert.equal(pickFinish(mk({ driving_dunk: 60, layup: 60, mid_range: 92 }), 4, { open: false, rimProtector: null, wall: { ratings: {} } }, true), 'jumper');
  // the dedicated attack bind takes the better finish (here the dunk), and does nothing out of range
  const p = mk({}); p.z = 0; const rim = { x: 0, z: 3 };
  assert.equal(shotTypeFor(p, rim, { attack: true, defs: [] }).type, 'dunk');
  assert.equal(shotTypeFor(p, { x: 0, z: 9 }, { attack: true, defs: [] }).type, 'none');
});

test('passes reach their receiver (no teammate pick-offs, few drops)', () => {
  let passes = 0, done = 0;
  for (const seed of [11, 12]) {
    const rng = new RNG(seed);
    const g = new Game({ mode: 'proam', seed, rosters: [makeTeam(rng, 5, { catalog, level: 0.6 }), makeTeam(rng, 5, { catalog, level: 0.6 })], catalog, quarterLen: 90, quarters: 4, difficulty: 0.6 });
    let open = null, steps = 0;
    while (!g.over && steps < 60 * 60 * 20) {
      g.step(1 / 60); steps++;
      for (const e of g.events) {
        if (e.type === 'pass' && e.ptype !== 'alley') { open = e.to; passes++; }
        else if (open != null && (e.type === 'catch' || e.type === 'oopCatch')) { if (e.player === open) done++; open = null; }
        else if (open != null && (e.type === 'steal' || e.type === 'recover' || e.type === 'oob' || e.type === 'turnover')) open = null;
      }
    }
  }
  assert.ok(passes > 100, `passes ${passes}`);
  assert.ok(done / passes > 0.95, `completion ${(done / passes * 100).toFixed(1)}%`);
});

test('Locked-In grade starts at C+ and moves with good and bad plays', () => {
  const rng = new RNG(5);
  const g = new Game({ mode: 'park', seed: 5, rosters: [makeTeam(rng, 3, { catalog, level: 0.6 }), makeTeam(rng, 3, { catalog, level: 0.6 })], catalog, target: 21 });
  const me = g.players[0];
  const gr = new LockedInGrade(g, me.id);
  assert.equal(gr.letter, 'C+');
  for (let i = 0; i < 6; i++) gr.onEvent({ type: 'assist', player: me.id });
  assert.ok(GRADES.indexOf(gr.letter) > GRADES.indexOf('C+'), gr.letter);
  const up = gr.v;
  for (let i = 0; i < 4; i++) gr.onEvent({ type: 'steal', player: g.players[3].id, victim: me.id });
  assert.ok(gr.v < up);
  for (let i = 0; i < 200; i++) gr.onEvent({ type: 'assist', player: me.id });
  assert.equal(gr.letter, 'A+');
});

test('the green peak is the moment the ball leaves the hands, for every jump-shot base and release', async () => {
  const S = await import('../client/js/sim/shots.js');
  const bases = Object.values(catalog).filter(i => i.slot === 'jumpshot'), rels = Object.values(catalog).filter(i => i.slot === 'release');
  assert.ok(bases.length >= 5 && rels.length >= 5);
  for (const base of bases) for (const rel of rels) for (const bonus of [1, 1.1]) {
    const rng = new RNG(3);
    const me = makeTeam(rng, 1, { catalog, level: 0.7 })[0];
    me.human = true; me.build.equipment = { ...me.build.equipment, jumpshot: base.id, release: rel.id };
    const g = new Game({ mode: 'practice', seed: 3, rosters: [[me], []], catalog, greenBonus: bonus });
    const p = g.players[0];
    g.setInput({ mx: 0, mz: 0, shoot: 'press', shootHeld: true });
    let a = null;
    for (let i = 0; i < 30 && !a; i++) { g.step(1 / 60); g.setInput({ mx: 0, mz: 0, shootHeld: true }); if (p.action?.type === 'shoot') a = p.action; }
    assert.ok(a, `${base.id}/${rel.id}: shot started`);
    // the ball rises in the hands right up to tRel and is at the release point exactly then
    const save = a.t, hy = t => { a.t = t; return g.holdPoint(p).y - p.y; };
    const top = hy(a.tRel), relY = p.phys.reach * p.shotPkg.relK;
    assert.ok(Math.abs(top - relY) < 1e-6, `${base.id}/${rel.id}: at release point at tRel`);
    assert.ok(hy(a.tRel - 0.03) < top && hy(a.tRel - 0.1) < hy(a.tRel - 0.03), `${base.id}/${rel.id}: still rising before tRel`);
    a.t = save;
    // ...and the jump peaks just after it (release just before the apex)
    assert.ok(a.takeoff + Math.sqrt(2 * a.jumpH / 9.81) >= a.tRel - 1e-6, `${base.id}/${rel.id}: release before the apex`);
    // the window is centred on tRel: release a hair inside the (bonus-widened) window and it's green
    const win = S.greenWindowMs(p.ratings[a.kind === 'close' ? 'close_shot' : 'mid_range'], p.badges, { contest: 0, moving: a.moving, fade: a.fade, d: a.dRim, three: false, pkg: p.shotPkg }) * g.speed * bonus / 1000;
    // with the meter off (bonus 1.1) a release 5% outside the normal window is still green
    const off = bonus > 1 ? win / 1.1 * 1.05 : win * 0.95;
    a.releaseAt = a.tRel + off;
    let grade = null;
    for (let i = 0; i < 120 && !grade; i++) { g.setInput({ mx: 0, mz: 0, shootHeld: true }); g.step(1 / 60); for (const e of g.events) if (e.type === 'release') grade = e.grade; }
    assert.equal(grade, 'excellent', `${base.id}/${rel.id} bonus ${bonus}: off by ${off.toFixed(4)}s`);
  }
});

// ---- v0.4.3 ----
test('defense: interior D and size own the paint, perimeter D the arc; box-outs scale with interior D', async () => {
  const S = await import('../client/js/sim/shots.js');
  const { physical } = await import('../client/js/sim/ratings.js');
  const mk = (r, h, x, z) => { const b = { height: h, weight: 180 + (h - 72) * 7, wingspan: h + 3, attributes: { interior_d: 60, block: 60, perimeter_d: 60, strength: 60, ...r } }; return { ratings: b.attributes, badges: {}, phys: physical(b), x, z, y: 0, handsUp: true }; };
  const rim = { x: 0, z: 12.7 };
  const shooterAt = d => ({ x: 0, z: 12.7 - d, ratings: {}, phys: { reach: 2.5 } });
  const big = (x, z) => mk({ interior_d: 95, block: 92, perimeter_d: 50 }, 85, x, z), guard = (x, z) => mk({ interior_d: 45, block: 40, perimeter_d: 50 }, 74, x, z);
  const paintBig = S.contestFor(shooterAt(1.5), [big(0, 12.7 - 0.6)], rim, 2.9), paintGuard = S.contestFor(shooterAt(1.5), [guard(0, 12.7 - 0.6)], rim, 2.9);
  assert.ok(paintBig > paintGuard * 1.25, `paint: big ${paintBig.toFixed(2)} vs guard ${paintGuard.toFixed(2)}`);
  const lock = (x, z) => mk({ perimeter_d: 95, interior_d: 45 }, 76, x, z), sieve = (x, z) => mk({ perimeter_d: 45, interior_d: 45 }, 76, x, z);
  const arcLock = S.contestFor(shooterAt(7.5), [lock(0, 12.7 - 6.4)], rim, 2.7), arcSieve = S.contestFor(shooterAt(7.5), [sieve(0, 12.7 - 6.4)], rim, 2.7);
  assert.ok(arcLock > arcSieve * 1.2, `arc: lockdown ${arcLock.toFixed(2)} vs ${arcSieve.toFixed(2)}`);
  // box-outs: an elite interior defender is much harder to move off his spot than a weak one
  const rng = new RNG(9);
  const g = new Game({ mode: 'park', seed: 9, rosters: [makeTeam(rng, 3, { catalog, level: 0.6 }), makeTeam(rng, 3, { catalog, level: 0.6 })], catalog, target: 21 });
  const [d, o] = [g.players[0], g.players[3]];
  d.facing = 0; d.x = 0; d.z = 0; o.x = 0; o.z = -0.5; // o is behind d
  g.ball.mode = 'flight'; g.ball.kind = 'shot'; g.ball.info = { team: o.team };
  d.ratings.interior_d = 95; o.ratings.interior_d = 50;
  const strong = g.anchorK(d, o);
  d.ratings.interior_d = 50;
  const weak = g.anchorK(d, o);
  assert.ok(strong > weak + 0.4, `box-out anchor ${strong.toFixed(2)} vs ${weak.toFixed(2)}`);
});

test('archetypes play to type, and dunk / size-up / jumpshot packages differ', async () => {
  const { tendenciesFor } = await import('../client/js/sim/bots.js');
  const S = await import('../client/js/sim/shots.js');
  const t = a => tendenciesFor({ archetype: a });
  assert.ok(t('sharpshooter').shoot > 0.8 && t('sharpshooter').spot > 0.8);
  assert.ok(t('slasher').drive > 0.85 && t('slasher').cut > t('sharpshooter').cut);
  assert.ok(t('playmaker').pass > 0.85 && t('playmaker').dribble > 0.85);
  assert.ok(t('stretch_big').pop > 0.85 && t('stretch_big').help > 0.7);
  assert.ok(t('glass_cleaner').help > 0.9 && t('glass_cleaner').crash > 0.9 && t('glass_cleaner').shoot < 0.25);
  // dunk packages: tiers rise with the stat requirement, flashy styles exist only higher up, 360s spin and finish square
  assert.deepEqual(['dunk_basic', 'dunk_tomahawk', 'dunk_windmill', 'dunk_flight'].map(k => S.DUNK_TIER[k]), [0, 1, 2, 3]);
  assert.ok(catalog.dunk_flight.styles.includes('360') && !catalog.dunk_basic.styles.includes('360'));
  const a = { type: 'dunk', style: '360', takeoff: 0.3, slam: 1.0, t: 0.65, spinDir: 1 };
  assert.ok(Math.abs(S.dunkSpin(a)) > 1);
  a.t = 1.2; assert.ok(Math.abs(S.dunkSpin(a) - Math.PI * 2) < 1e-6);
  // jumpshot bases feel different: flick is quickest, push most forgiving, high-set releases higher
  const pk = id => S.jumpshotPackage({ equipment: { jumpshot: id, release: 'release_classic' } }, catalog);
  assert.ok(pk('js_base_flick').tRel < pk('js_base_standard').tRel && pk('js_base_skyline').tRel > pk('js_base_standard').tRel);
  assert.ok(pk('js_base_push').winK > 1 && pk('js_base_leanback').winK < 1 && pk('js_base_skyline').relK > pk('js_base_push').relK);
  // size-up packages speed up moves
  const rng = new RNG(4);
  const entry = makeTeam(rng, 1, { catalog, level: 0.7 })[0];
  entry.build.equipment.sizeup = 'sizeup_elite';
  const g = new Game({ mode: 'practice', seed: 4, rosters: [[{ ...entry, human: true }], []], catalog });
  assert.equal(g.players[0].sizeupLvl, 2);
  assert.ok(g.players[0].moveSpeed > 1.2);
});

test('2K cam: a held stick stays up-screen and turns smoothly with the camera through a change of possession', async () => {
  const { CameraRig } = await import('../client/js/game/camera.js');
  const cam = { pos: { set() {} }, target: { set() {} }, fov: 0 };
  const rig = new CameraRig(cam);
  assert.equal(rig.mode, '2k');
  const ctx = side => ({ origin: [0, 0, 0], half: false, side, focus: { x: 1.5, z: side * 4 }, ball: { x: 1.5, y: 1, z: side * 4 }, me: null });
  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) rig.updateGame(dt, ctx(1));
  let b = rig.inputBasis();
  assert.ok(b.fz > 0.95, 'attacking +z: up is +z');
  assert.ok(rig.pos[2] < 4, 'camera sits behind the play');
  let prev = Math.atan2(b.fx, b.fz), maxStep = 0, minAlign = 1;
  for (let i = 0; i < 240; i++) {
    rig.updateGame(dt, ctx(-1)); // possession changes: the camera swings round to face -z
    b = rig.inputBasis();
    const a = Math.atan2(b.fx, b.fz);
    maxStep = Math.max(maxStep, Math.abs(Math.atan2(Math.sin(a - prev), Math.cos(a - prev))));
    prev = a;
    // where "stick up" sends the player vs. where the camera is actually looking right now
    const vx = rig.tgt[0] - rig.pos[0], vz = rig.tgt[2] - rig.pos[2], vl = Math.hypot(vx, vz);
    minAlign = Math.min(minAlign, (b.fx * vx + b.fz * vz) / vl);
  }
  assert.ok(b.fz < -0.95, `after the swing up is -z (fz ${b.fz.toFixed(2)})`);
  assert.ok(maxStep < 0.12, `basis turns smoothly (max ${(maxStep * 180 / Math.PI).toFixed(1)} deg/frame)`);
  assert.ok(minAlign > 0.9, `stick up stays up the screen during the swing (min alignment ${minAlign.toFixed(2)})`);
});

test('v0.4.4 rating curve: steep under 70, buffed past 95, near-automatic at 99 unless defended', async () => {
  const S = await import('../client/js/sim/shots.js');
  const { rk } = await import('../client/js/sim/ratings.js');
  const w = v => S.timingWindowMs(v);
  for (let v = 41; v <= 99; v++) assert.ok(w(v) >= w(v - 1), `window grows with the rating (${v})`);
  assert.ok(w(55) < w(70) * 0.7, 'a 55 shooter gets a much smaller green window than a 70');
  assert.ok(w(99) > w(95) * 1.5, '99 is a different class');
  assert.ok(rk(99) - rk(95) > rk(95) - rk(85), 'the step from 95 to 99 is bigger than 85 to 95');
  const a = v => ({ three_point: v, mid_range: v, layup: v, free_throw: v, close_shot: v, driving_dunk: v, standing_dunk: v });
  const fc = (v, o) => S.finalChance({ stamina: 1, badges: {}, a: a(v), ...o });
  assert.ok(fc(99, { type: 'jumper', three: true, d: 7.4, grade: 'early', contest: 0 }) >= 0.89, 'open 99 three, slightly off, still ~90%');
  assert.ok(fc(99, { type: 'layup', d: 1.4, contest: 0 }) >= 0.96, 'open 99 layup');
  assert.ok(fc(99, { type: 'layup', d: 1.4, contest: 1 }) < 0.8, 'a good contest still brings a 99 down');
  assert.ok(fc(99, { type: 'jumper', three: true, d: 7.4, grade: 'vlate', contest: 0 }) < 0.5, 'badly mistimed is still bad');
});

test('v0.4.4 AI world: persistent accounts, clear skill tiers, schedules through the day, squad rules', async () => {
  const { AIWorld, PARKS } = await import('../client/js/sim/world.js');
  const a = new AIWorld({ seed: 4242, born: Date.now() }, catalog), b = new AIWorld({ seed: 4242, born: Date.now() }, catalog);
  for (const id of ['ai-0', 'ai-17', 'ai-333', 'ai-899']) {
    const x = a.entry(id), y = b.entry(id);
    assert.equal(x.name, y.name); assert.equal(x.build.height, y.build.height); assert.equal(x.build.overall, y.build.overall);
    assert.deepEqual(x.build.equipment, y.build.equipment); assert.deepEqual(x.badges, y.badges);
  }
  const by = {};
  for (const id of a.ids()) { const e = a.entry(id); (by[e.tier] = by[e.tier] || []).push(e); }
  const med = t => { const v = by[t].map(e => e.build.overall).sort((p, q) => p - q); return v[v.length >> 1]; };
  assert.ok(med('casual') + 6 < med('regular') && med('regular') + 5 < med('hooper') && med('hooper') + 4 < med('elite') && med('elite') <= med('legend'), 'tiers are clearly apart in overall');
  const badgeAvg = t => by[t].reduce((s, e) => s + Object.keys(e.badges).length, 0) / by[t].length;
  assert.ok(badgeAvg('legend') > badgeAvg('casual') + 2.5, 'better players carry more badges');
  const iqAvg = t => by[t].reduce((s, e) => s + e.iq, 0) / by[t].length;
  assert.ok(iqAvg('legend') > iqAvg('casual') + 0.4, 'and read the game better');
  // every account keeps to the item rules a player has to follow
  for (const e of by.casual.concat(by.legend)) for (const id of Object.values(e.build.equipment)) {
    const it = catalog[id]; if (!it || it.exclusive) continue;
    assert.ok((it.min_overall || 0) <= e.build.overall, `${e.name} meets ${id} overall`);
    for (const [k, v] of Object.entries(it.min_attr || {})) assert.ok(e.build.attributes[k] >= v, `${e.name} meets ${id} ${k}`);
  }
  // who is online changes with the hour: evenings busy, early morning quiet
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const at = h => PARKS.reduce((s, p) => s + a.onlineAt(p, day.getTime() + h * 3600000).length, 0);
  assert.ok(at(20) > at(5) * 4, `evening ${at(20)} vs dawn ${at(5)}`);
  // friends and squad
  const t = day.getTime() + 20 * 3600000;
  const on = a.ids().find(id => a.online(id, t)), off = a.ids().find(id => !a.online(id, t));
  assert.equal(a.invite(on, t).ok, false, 'must be a friend first');
  a.addFriend(on); a.addFriend(off);
  assert.equal(a.invite(off, t).ok, false, 'offline friends cannot join');
  // v0.4.5: nobody can be pulled out of a game
  assert.equal(a.invite(on, t, true).ok, false, 'players in a game cannot join');
  assert.equal(a.invite(on, t, false).ok, true);
  assert.deepEqual(a.toJSON().squad, [on]);
  a.recordGame([on], [off], true, t);
  assert.deepEqual([a.met[on].with, a.met[on].wins, a.met[off].vs], [1, 1, 1]);
});

test('v0.4.4 auto-play follows your career numbers', async () => {
  const { statProfile } = await import('../client/js/sim/profile.js');
  const char = (k) => ({ archetype: 'two_way', progression: { games: 20, career_modes: { park: { gp: 20, wins: 10, fga: 20 * 14 * k, tpa: 20 * 8 * k, fgm: 20 * 6 * k, tpm: 20 * 3.4 * k, ast: 20 * 1, stl: 20 * 2.5, reb: 20 * 3, blk: 20 * 0.2, tov: 20 * 1.5, fta: 20, ftm: 18 } } } });
  const vol = statProfile(char(1.2), 'park'), low = statProfile(char(0.4), 'park'), none = statProfile({ archetype: 'two_way', progression: {} }, 'park');
  assert.ok(vol.w > 0.8, 'twenty games mostly decide it');
  assert.ok(vol.tend.shoot > none.tend.shoot && low.tend.shoot < none.tend.shoot, 'shot volume follows your attempts');
  assert.ok(vol.tend.spot > 0.6, 'a three-heavy diet shows up');
  assert.ok(vol.tend.press > none.tend.press && vol.tend.pass < none.tend.pass, 'steals up, assists down');
  assert.ok(Math.abs(vol.tp - 0.42) < 0.03 && vol.ft > 0.8, 'shooting targets come from your percentages');
});

// ---------------- v0.4.5 ----------------
test('v0.4.5 badges: tier steps grow 10% each, a stat with none of its badges plays 10% weaker, Icon badges pass 99', async () => {
  const B = await import('../client/js/sim/badges.js');
  const { rk } = await import('../client/js/sim/ratings.js');
  assert.deepEqual(B.BADGE_K.map(x => +x.toFixed(3)), [0, 1, 2.1, 3.31, 4.641]);
  const t = B.tierTable([0, 0.15, 0.25, 0.35, 0.45]);
  assert.ok(Math.abs(t[4] - (0.15 + 0.1 * 1.1 + 0.1 * 1.21 + 0.1 * 1.331)) < 1e-9);
  const raw = { three_point: 85, layup: 85, speed: 85 };
  const none = B.effectiveRatings(raw, {});
  const shooter = B.effectiveRatings(raw, { catch_shoot: 1 });
  assert.equal(shooter.three_point, 85);
  assert.ok(Math.abs(rk(none.three_point) / rk(85) - 0.9) < 0.03, 'about 10% less effective without a badge');
  assert.equal(none.speed, 85, 'stats no badge works through are untouched');
  const icon = B.effectiveRatings({ ...raw, driving_dunk: 99 }, { posterizer: 4 }, 'hash_slinging');
  assert.ok(icon.driving_dunk > 99 && rk(icon.driving_dunk) > rk(99), 'Icon badge scales past 99');
  // the AI world gives every archetype its Icon badge only through the 7th HOF badge (server side), so here
  // just check every archetype has one
  for (const a of ['sharpshooter', 'slasher', 'playmaker', 'lockdown', 'two_way', 'glass_cleaner', 'stretch_big', 'post_scorer']) assert.ok(B.ICON_FOR_ARCH[a]);
});

function testGame(mode = 'park', seed = 5) {
  const rng = new RNG(seed);
  const rosters = [makeTeam(rng, 3, { catalog, level: 0.6 }), makeTeam(rng, 3, { catalog, level: 0.6 })];
  return new Game({ mode, seed, rosters, catalog, target: 21, quarterLen: 120, quarters: 4, difficulty: 0.6 });
}

test('v0.4.5 stamina: repeated moves and repeated mistakes drain faster, good plays and grades give it back', () => {
  const g = testGame();
  const p = g.players[0];
  // same move 4+ times in a row: 2x drain, then +0.1x per repeat; a different move resets it
  for (let i = 0; i < 6; i++) { p.cool.move = 0; p.stamina = 1; g.startMove(p, 'cross'); }
  assert.equal(p.stam.moveK, 2.2);
  p.cool.move = 0; g.startMove(p, 'spin');
  assert.equal(p.stam.moveK, 1);
  // the same negative play twice in a row: 2x, then +0.1x; a positive play resets it
  g.bad(p, 'turnover'); assert.equal(p.stam.negK, 1);
  g.bad(p, 'turnover'); assert.equal(p.stam.negK, 2);
  g.bad(p, 'turnover'); assert.equal(p.stam.negK, 2.1);
  g.good(p, 'assist'); assert.equal(p.stam.negK, 1);
  // every second positive play: stamina back and 2x recovery (never more), until a negative play
  assert.equal(p.stam.recBoost, false);
  p.stamina = 0.5; g.good(p, 'rebound');
  assert.ok(p.stamina > 0.5 && p.stam.recBoost);
  g.good(p, 'steal'); g.good(p, 'block');
  assert.equal(p.recK, 2);
  g.bad(p, 'foul'); assert.equal(p.stam.recBoost, false);
  // Lock-In grade and going hot / cold stack on top
  p.stam.grade = 12; assert.equal(p.recK, 1.5);
  p.hot = 1; assert.equal(p.recK, 2.25);
  p.hot = 0; p.stam.grade = 2; p.cold = true;
  assert.equal(+p.drainK.toFixed(4), 1.875);
  // jogging now costs a little; standing still recovers
  const q = g.players[1]; q.stamina = 0.8; q.stam.grade = null;
  q.intent = { ...q.intent, mx: 1, mz: 0, sprint: false }; for (let i = 0; i < 120; i++) q.move(1 / 60, false, 0);
  assert.ok(q.stamina < 0.8, 'jogging drains');
  const s1 = q.stamina; q.intent = { ...q.intent, mx: 0, mz: 0 }; for (let i = 0; i < 240; i++) q.move(1 / 60, false, 0);
  assert.ok(q.stamina > s1, 'standing recovers');
});

test('v0.4.5 hot and cold, and position takeovers', () => {
  const g = testGame();
  const p = g.players.find(q => q.takeover.kind === 'shooting') || g.players[0];
  p.takeover.kind = 'shooting';
  const fire = (grade, made) => { g.emit({ type: 'release', player: p.id, grade, kind: 'jumper', contest: 0.1, closest: -1 }); if (made) g.emit({ type: 'score', player: p.id, team: p.team, kind: 'jumper', pts: 2 }); else g.emit({ type: 'miss', player: p.id, team: p.team }); };
  fire('excellent', true); fire('excellent', true); assert.equal(p.hot, 0);
  fire('excellent', true); assert.equal(p.hot, 1, '3 straight greens: on fire');
  fire('late', false); assert.equal(p.hot, 0, 'a miss puts the fire out');
  for (let i = 0; i < 4; i++) fire('early', false);
  assert.equal(p.cold, true, 'more than 3 open misses: cold');
  fire('excellent', true); assert.equal(p.cold, false);
  // shooting takeover: 6 Excellent releases without a miss, block or off-green release
  p.takeover.prog = 0;
  for (let i = 0; i < 5; i++) fire('excellent', true);
  fire('early', true); assert.equal(p.takeover.prog, 0, 'an off-green release resets it');
  const before = p.ratings.three_point;
  for (let i = 0; i < 6; i++) fire('excellent', true);
  assert.equal(p.takeover.active, true);
  assert.ok(p.ratings.three_point > before);
  assert.ok(g.greenK(p) > 1);
  for (let i = 0; i < 60 * 70 * g.speed && p.takeover.active; i++) g.step(1 / 60);
  assert.equal(p.takeover.active, false, 'takeovers wear off');
  assert.equal(p.ratings.three_point, before);
});

test('v0.4.5 rules: traveling, knockdowns only with Posterizer, long attack-the-rim takeoffs', async () => {
  const S = await import('../client/js/sim/shots.js');
  // traveling: moving with a held ball after the gather
  const g = testGame('park', 9);
  while (g.phase !== 'live') g.step(1 / 60);
  const h = g.holder();
  g.ball.mode = 'held'; h.dribble.used = true; h.action = null;
  let travel = false;
  for (let i = 0; i < 240 && !travel; i++) {
    h.x += 0.012; g.rules(1 / 60); h.prevX = h.x;
    travel = g.events.some(e => e.type === 'violation' && e.what === 'Traveling');
  }
  assert.ok(travel, 'walking with a picked-up dribble is a travel');
  // knockdowns: only players with the Posterizer badge ever knock a defender down
  for (const seed of [3, 4, 5, 6]) {
    const gg = testGame('park', seed);
    for (let i = 0; i < 60 * 60 * 8 && !gg.over; i++) {
      gg.step(1 / 60);
      for (const e of gg.events) if (e.type === 'posterContact') assert.ok(gg.players[e.player].badges.posterizer, 'posterize needs the badge');
    }
  }
  // attack the rim from further out with an open lane
  const p = testGame().players[0];
  p.raw.driving_dunk = 85; p.ratings.driving_dunk = 85; p.raw.layup = Math.min(p.raw.layup, 80); p.stamina = 1; p.phys.vertical = Math.max(p.phys.vertical, 3.4 - p.phys.reach);
  const rim = { x: 0, y: 3.05, z: 12.725 };
  p.x = 0; p.z = rim.z - 5.3; p.vx = 0; p.vz = 6;
  const st = S.shotTypeFor(p, rim, { attack: true, defs: [] });
  assert.equal(st.type, 'dunk'); assert.ok(st.long);
});
