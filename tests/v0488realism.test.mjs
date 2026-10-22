// v0.4.8.8 "The Pro-Am Overhaul": Pro-Am is the most realistic mode (David: "ICON aura and ICON badges will not have
// their effects in this gamemode; but animation packages related to said badges will still be active. Decrease badge
// effectiveness and disparity between build overall by 10%, and increase overall game difficulty and AI intelligence/
// difficulty by 10% as well"). Pro-Am only; the same on every screen (it comes with the game's config).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { BADGE_K, REALISM, bk } from '../client/js/sim/badges.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const catalog = Object.fromEntries(JSON.parse(src('server/catalog.json')).map(i => [i.id, i]));
function rosters(seed, icon = 'hash_slinging') {
  const rng = new RNG(seed), a = makeTeam(rng, 5, { catalog, level: 0.7 }), b = makeTeam(rng, 5, { catalog, level: 0.5 });
  a[0].build = { ...a[0].build, archetype: 'slasher', icon_badge: icon };
  a[0].badges = { ...(a[0].badges || {}), posterizer: 3, deadeye: 2 };
  return [a, b];
}
const game = (seed, cfg = {}) => new Game({ mode: 'proam', seed, rosters: rosters(seed), catalog, quarterLen: 60, quarters: 4, difficulty: 0.6, ...cfg });

test('Icon effects are off, the Icon\'s packages still play', () => {
  const on = game(3, { realism: true }), off = game(3);
  const p = on.players[0], q = off.players[0];
  assert.equal(p.icon, 'hash_slinging'); assert.equal(p.iconFx, false);
  assert.equal(p.dunkPkg, q.dunkPkg, 'the dunk package is the same');
  assert.equal(p.shotPkg?.id ?? p.shotPkg?.style, q.shotPkg?.id ?? q.shotPkg?.style);
  assert.ok(q.ratings.driving_dunk > q.raw.driving_dunk * 1.04, 'without realism the Icon adds 5%');
  assert.ok(p.ratings.driving_dunk < q.ratings.driving_dunk, 'with it, no Icon %');
  assert.equal(on.iconPopOk(p, 'hash_slinging'), false, 'no Icon pop');
  const se = game(4, { realism: true }); se.players[0].icon = 'sharp_eye';
  assert.equal(se.greenK(se.players[0]), 1, 'no Sharp Eye window');
});

test('badges play at 90% of their effect; the gap between builds is 10% smaller', () => {
  const on = game(5, { realism: true }), off = game(5);
  const p = on.players[0];
  assert.ok(Math.abs(bk(p.badges, 'posterizer') - BADGE_K[3] * REALISM.badgeK) < 1e-12);
  assert.equal(Object.keys(p.badges).includes('badgeK'), false, 'the strength is never a badge');
  assert.equal(bk(off.players[0].badges, 'posterizer'), BADGE_K[3]);
  for (const k of ['three_point', 'speed', 'block']) {
    const spread = g => { const v = g.players.map(x => (x.played || x.raw)[k]); return Math.max(...v) - Math.min(...v); };
    assert.ok(Math.abs(spread(on) - spread(off) * REALISM.spread) < 1e-9, k);
  }
  assert.deepEqual(on.players[0].raw, off.players[0].raw, 'the build itself (what gating reads) is untouched');
});

test('10% harder, Pro-Am only, and the same game on every screen', () => {
  assert.ok(Math.abs(game(6, { realism: true }).difficulty - 0.66) < 1e-12);
  const park = new Game({ mode: 'park', seed: 6, rosters: rosters(6).map(r => r.slice(0, 3)), catalog, target: 21, realism: true });
  assert.equal(park.realism, false); assert.equal(park.difficulty, 0.6);
  const play = () => { const g = game(7, { realism: true }); for (let i = 0; i < 60 * 60 * 3 && !g.over; i++) g.step(1 / 60); return [g.score.join('-'), g.tick, g.rng.s ?? g.rng.state ?? JSON.stringify(g.rng)]; };
  assert.deepEqual(play(), play());
});

test('the session passes it on and shows no ICON cursor or aura in Pro-Am; the Hash-Slinging poster is off', () => {
  const s = src('client/js/game/session.js'), g = src('client/js/sim/game.js');
  assert.match(s, /realism: !!opts\.realism/);
  assert.match(s, /if \(this\.game\.realism\) pv\.noIcon = true;/);
  assert.match(s, /if \(this\.noIcon\) return false;/);
  assert.match(g, /const hsFx = a\.hs && !this\.realism/);
  assert.match(g, /if \(a\.hs && !this\.realism\) \{/);
  assert.match(src('client/js/ui/modes.js'), /realism: true/);
});
