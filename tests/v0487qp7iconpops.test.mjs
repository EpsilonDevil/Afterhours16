// v0.4.8.7 quick patch 7: every Icon badge pops up on screen each time it does something, as Hash-Slinging's dunks always
// have (Game.iconTriggers / iconPop: the 'badge' event with icon: true), only when the badge is behind what happened, at
// most once every ICON_POP_GAP seconds of game per player and badge, and shown for everyone on the floor (the AI's ICONs,
// the other players online, anyone watching; with his name when it isn't yours). Display only: the games play out exactly
// the same with the pop-ups on or off (no rng drawn, nothing read back).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, ICON_POP_GAP } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { ICON_BADGES } from '../client/js/sim/badges.js';
import { HUD } from '../client/js/game/hud.js';

const catalog = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url))).map(i => [i.id, i]));
const KIT = { the_clamp: { steal: 'steal_the_clamp' }, big_brother: { block: 'block_big_brother' }, open_arms: { rebound: 'reb_openarms' }, sexy_red: { post: 'post_sexy_red' } };
const ICONS = Object.keys(ICON_BADGES);
// a Pro-Am game (5 on 5) with an ICON in eight of the ten spots, each with his Icon's own package on
function iconGame(seed, icons = ICONS, at = i => [i % 2, Math.floor(i / 2)]) {
  const rng = new RNG(seed), rosters = [makeTeam(rng, 5, { catalog, level: 0.9 }), makeTeam(rng, 5, { catalog, level: 0.9 })];
  icons.forEach((ic, i) => {
    const [tm, sl] = at(i), e = rosters[tm][sl];
    e.build = { ...e.build, icon_badge: ic, equipment: { ...(e.build.equipment || {}), ...(KIT[ic] || {}) } };
    // (the slasher dunks: a dunker's ratings, so three games are enough to see him throw some down)
    if (ic === 'hash_slinging') e.build.attributes = { ...e.build.attributes, driving_dunk: 97, standing_dunk: 95, layup: 70, close_shot: 60, mid_range: 40, three_point: 30 }, e.build.height = 80;
  });
  return new Game({ mode: 'proam', seed, rosters, catalog, target: 21, quarterLen: 150, quarters: 4, difficulty: 0.7 });
}
function play(g, maxMin = 18, each = null) {
  for (let s = 0; s < 60 * 60 * maxMin && !g.over; s++) { g.step(1 / 60); if (each) for (const e of g.events) each(e, g); }
  return g;
}
const snapshot = g => JSON.stringify({ score: g.score, tick: g.tick, rng: g.rng.s, stats: g.players.map(p => p.stats), ball: [g.ball.x, g.ball.y, g.ball.z].map(v => +v.toFixed(6)) });

test('every Icon badge pops up when it does its thing, for every player, never more than once a gap', () => {
  const seen = new Map(), last = new Map(), why = new Map();
  for (const seed of [11, 23, 37]) {
    const g = iconGame(seed);
    const prev = [];
    play(g, 18, (e, gm) => {
      if (e.type === 'badge' && e.icon) {
        const p = gm.players[e.player];
        assert.equal(e.badge, p.icon, 'only his own Icon badge');
        assert.equal(e.tier, 5);
        const k = `${seed}:${e.player}:${e.badge}`, t = last.get(k);
        assert.ok(t == null || e.t - t >= ICON_POP_GAP - 1e-9, `${e.badge}: ${e.t - t} s after the last one`);
        last.set(k, e.t);
        seen.set(e.badge, (seen.get(e.badge) || 0) + 1);
        // what set it off is in the same tick's events (or is the badge's own: a reach, a pick, a strip, a save)
        const cause = prev.filter(x => x.player === e.player && x.t === e.t).map(x => x.type);
        why.set(e.badge, new Set([...(why.get(e.badge) || []), ...cause]));
      }
      prev.push(e); if (prev.length > 40) prev.shift();
    });
  }
  // (dunks and post-ups are rare in an AI game: a few more games for a badge not seen yet, until it does its thing)
  for (const ic of ICONS) for (let seed = 41; !seen.get(ic) && seed < 41 + 10 * 13; seed += 13) {
    const prev = [];
    play(iconGame(seed, [ic], () => [1, 3]), 18, (e, gm) => { // (on a forward: he posts up, he dunks)
      if (e.type === 'badge' && e.icon && e.badge === ic) { seen.set(ic, 1); why.set(ic, new Set(prev.filter(x => x.player === e.player && x.t === e.t).map(x => x.type))); }
      prev.push(e); if (prev.length > 40) prev.shift();
    });
  }
  for (const ic of ICONS) assert.ok(seen.get(ic) > 0, `${ic} popped up (${seen.get(ic) || 0} times over three games)`);
  // and for the right reasons
  const has = (ic, types) => [...(why.get(ic) || [])].some(t => types.includes(t));
  assert.ok(has('oprah', ['pass'])); assert.ok(has('open_arms', ['snag'])); assert.ok(has('big_brother', ['block']));
  assert.ok(has('sexy_red', ['postmove', 'postfinish', 'release'])); assert.ok(has('the_general', ['score', 'block', 'steal']));
  assert.ok(has('hash_slinging', ['slam'])); assert.ok(has('sharp_eye', ['release']));
});

test('only when the badge did it: a Sharp Eye build\'s layup, a Big Brother block without his package, nobody else\'s plays', () => {
  const g = iconGame(5, ['sharp_eye', 'big_brother']), se = g.players.find(p => p.icon === 'sharp_eye'), bb = g.players.find(p => p.icon === 'big_brother');
  const pops = () => g.events.filter(e => e.type === 'badge' && e.icon).map(e => `${e.player}:${e.badge}`);
  g.events = [];
  g.emit({ type: 'release', player: se.id, kind: 'layup', made: true, grade: 'none' }); assert.deepEqual(pops(), [], 'a layup: no Sharp Eye');
  g.emit({ type: 'release', player: se.id, kind: 'jumper', made: false, grade: 'good' }); assert.deepEqual(pops(), [], 'a missed jumper: no');
  g.emit({ type: 'release', player: se.id, kind: 'jumper', made: true, grade: 'good' }); assert.deepEqual(pops(), [`${se.id}:sharp_eye`], 'a jumper made with his package: yes');
  bb.blockPkg = null; g.events = []; g.time += 5;
  g.emit({ type: 'block', player: bb.id, shooter: se.id }); assert.deepEqual(pops(), [], 'a block with his tier\'s package: no Big Brother');
  bb.blockPkg = 'block_big_brother'; g.emit({ type: 'block', player: bb.id, shooter: se.id }); assert.deepEqual(pops(), [`${bb.id}:big_brother`]);
  const plain = g.players.find(p => !p.icon); g.events = []; g.time += 5;
  for (const t of ['pass', 'snag', 'block', 'steal', 'postmove']) g.emit({ type: t, player: plain.id, kind: 'dunk' });
  g.emit({ type: 'score', player: plain.id, kind: 'dunk', pts: 2 }); assert.deepEqual(pops(), [], 'nobody without an Icon badge');
  // the gap: the same badge again a moment later stays quiet, a gap later pops again
  g.events = []; g.time += 5;
  assert.ok(g.iconPop(se)); assert.ok(!g.iconPop(se)); g.time += ICON_POP_GAP - 0.01; assert.ok(!g.iconPop(se)); g.time += 0.02; assert.ok(g.iconPop(se));
  assert.ok(!g.iconPop(se, 'oprah'), 'never another badge than his own');
});

test('display only: with the pop-ups on or off, the games play out exactly the same', () => {
  for (const seed of [11, 29]) {
    const a = play(iconGame(seed), 12);
    const g = iconGame(seed); g.iconPop = () => false; // (no Icon pop-ups at all)
    const b = play(g, 12);
    assert.equal(snapshot(a), snapshot(b), `seed ${seed}: the same game`);
  }
});

test('the HUD shows an Icon pop-up for anyone on the floor, with his name when it isn\'t yours', () => {
  const h = Object.create(HUD.prototype); h.badgeQ = []; h.badgeT = 0;
  h.badge({ key: 'oprah', tier: 5, name: 'Oprah', icon: true, who: 'Ty Banks' });
  h.badge({ key: 'oprah', tier: 5, name: 'Oprah', icon: true, who: 'Dre Holloway' });
  h.badge({ key: 'oprah', tier: 5, name: 'Oprah', icon: true, who: 'Dre Holloway' });
  assert.equal(h.badgeQ.length, 2, 'two players\' pop-ups both show; the same one twice in a play once');
  const kids = [];
  globalThis.requestAnimationFrame = fn => fn();
  h.badgeBox = { appendChild: d => kids.push(d) };
  const realDoc = globalThis.document;
  globalThis.document = { createElement: () => { const d = { classList: { add() {}, remove() {} }, remove() {} }; return d; } };
  try { h.showNextBadge(); } finally { globalThis.document = realDoc; }
  assert.match(kids[0].innerHTML, /ICON BADGE ACTIVATED · Ty Banks/);
  const src = fs.readFileSync(new URL('../client/js/game/session.js', import.meta.url), 'utf8');
  assert.ok(src.includes("if (e.type === 'badge' && (mine || e.icon))"), 'the game shows anyone\'s Icon pop-up, your own badges as before');
});
