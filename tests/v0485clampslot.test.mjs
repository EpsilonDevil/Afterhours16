// v0.4.8.5 qp6 The Clamp's Steal Package (slot 'steal', the Inventory's Steals; like the Open Arms Rebound Package): the
// Icon's ten steal animations are the package's. Worn by the holder: all ten (the six reaches picked for the moment, the
// three pick-offs, the chest-up strip). The slot empty: the badge's basic steal, The Vise, on every reach, and no
// pick-off or strip. Anyone else, even wearing the item: none. The same game either way (steal odds unchanged, nothing
// gameplay reads it), deterministic online. The item comes from the table in sim/clamp.js; the store never shows it,
// the Inventory and MyPlayer only to the holder; the preview plays the ten in turn (The Vise with the slot empty).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../client/js/sim/clamp.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam, makeBot } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { Player } from '../client/js/sim/player.js';
import { inStore, forBuild } from '../client/js/sim/builds.js';
import { PreviewSim } from '../client/js/game/preview.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const PKG = C.CLAMP_STEAL_PKG;
const REACHES = C.CLAMP_REACHES.map(s => s.id), PICKS = C.CLAMP_PICKS.map(s => s.id), STRIPS = C.CLAMP_STRIPS.map(s => s.id);
const ZERO = { next: () => 0, range: a => a, int: a => a, chance: () => true, pick: arr => arr[0] };

// a park game with a lockdown on team 1: icon (the Clamp or not), wearing the package or not
function park(icon = 'the_clamp', wear = true, seed = 21) {
  const r = new RNG(seed), A = makeTeam(r, 3, { catalog, level: 0.8 }), Bt = makeTeam(r, 3, { catalog, level: 0.8 });
  const h = makeBot(r, { catalog, level: 0.95, position: 'SG', archetype: 'lockdown' });
  h.build.icon_badge = icon; h.name = 'LOCK'; Bt[0] = h;
  if (wear) h.build.equipment = { ...h.build.equipment, steal: PKG };
  const g = new Game({ mode: 'park', seed, rosters: [A, Bt], catalog, target: 21 });
  return { g, d: g.players.find(p => p.name === 'LOCK') };
}
// a pass he jumps / a driver who runs into him (as tests/v0485clamp.test.mjs): did he pick it off / strip it, and the overlay
function intercept(icon, wear) {
  const { g, d } = park(icon, wear), [passer, recv] = g.players;
  g.phase = 'live'; g.possession = 0; g.giveBall(passer, 'held');
  for (const q of g.players) q.setPos(-6, 9, 0);
  passer.setPos(0, 2, 0); recv.setPos(0, 9, Math.PI); d.setPos(0, 5, Math.PI); d.facing = Math.PI;
  d.ratings.steal = 99; passer.ratings.pass_accuracy = 40;
  g.startPass(passer, { target: recv.id, type: 'chest' });
  for (let i = 0; i < 60 && g.ball.mode !== 'flight'; i++) g.tickAction(passer, 1 / 60), g.updateBall(1 / 60);
  const b = g.ball; b.x = d.x + Math.sin(d.facing) * 0.25 + 0.15; b.z = d.z + Math.cos(d.facing) * 0.25; b.y = 1.25; b.flightTime = 0.5;
  const rng = g.rng; g.rng = ZERO; g.events.length = 0; g.interactions(1 / 60); g.rng = rng;
  return { got: g.events.some(e => e.type === 'steal' && e.intercept && e.player === d.id) && g.ball.holder === d.id, fx: d.clampFx || null, g, d };
}
function strip(icon, wear) {
  const { g, d } = park(icon, wear), h = g.players[0];
  g.phase = 'live'; g.possession = 0; g.giveBall(h, 'dribble');
  for (const q of g.players) if (q !== h && q !== d) q.setPos(-6, 9, 0);
  h.setPos(0, 3, 0); h.facing = 0; d.setPos(0, 3 + h.phys.radius + d.phys.radius - 0.05, Math.PI);
  h.vx = 0; h.vz = 4; d.vx = 0; d.vz = 0; h.bumpT = 0; d.bumpT = 0; h.ratings.ball_handle = 30;
  const rng = g.rng; g.rng = ZERO; g.events.length = 0; g.collide(1 / 60); g.rng = rng;
  return { got: g.events.some(e => e.type === 'steal' && e.bump && e.player === d.id), fx: d.clampFx || null, mode: g.ball.mode };
}
// the reaches a player's steal tries show, at the same moment over and over (a holder dealt from the moment's pool)
function reaches(icon, wear, n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const { g, d } = park(icon, wear), h = g.players[0];
    g.phase = 'live'; g.possession = 0; g.giveBall(h, 'dribble'); g.tick = i * 13; d.clampN = i;
    h.setPos(0, 3, 0); d.setPos(0.15, 3.8, Math.PI);
    const s0 = g.rng.s; g.startSteal(d, i % 3 ? null : { x: 1, z: 0 }, i % 4 === 1);
    assert.equal(g.rng.s, s0, 'no draw of the game\'s RNG');
    const a = d.action;
    out.push({ anim: a.clamp, icon: a.icon, hand: a.hand, low: a.low, aimed: a.aimed, checked: a.checked, dur: a.dur, cool: d.cool.steal });
  }
  return out;
}

test('the item: the table\'s, the holder\'s alone, never in the store, never on the AI', () => {
  assert.deepEqual(C.clampPackageItems(), [catalog[PKG]], 'server/catalog.json carries exactly the table\'s entry');
  const it = catalog[PKG];
  assert.equal(it.slot, 'steal'); assert.equal(it.category, 'animation'); assert.equal(it.name, 'Steal Package: The Clamp');
  assert.equal(it.exclusive, 'icon'); assert.equal(it.icon, 'the_clamp'); assert.equal(it.secret, true); assert.equal(it.price, 0);
  assert.equal(it.original_2k_asset, false); assert.equal(it.v0485qp6, true); assert.equal(it.v0485, undefined);
  assert.deepEqual(it.styles, [...REACHES, ...PICKS, ...STRIPS], 'all ten');
  assert.equal(it.styles.length, 10); assert.equal(it.signature, 'vise');
  for (const s of it.styles) assert.ok(it.description.includes(C.clampName(s)), `the description names ${C.clampName(s)}`);
  assert.deepEqual(list.filter(i => i.slot === 'steal').map(i => i.id), [PKG], 'the only item in the slot');
  assert.equal(inStore(it), false);
  assert.equal(forBuild(it, { icon_badge: 'the_clamp' }), true);
  for (const ic of [null, 'open_arms', 'big_brother', 'sharp_eye']) assert.equal(forBuild(it, { icon_badge: ic }), false);
  // the AI never wears it (its gear skips every exclusive item; it has no steal slot of its own)
  const r = new RNG(91);
  for (let i = 0; i < 200; i++) { const b = makeBot(r, { catalog, level: 1, rep: 20, flash: 1, position: 'SG', archetype: 'lockdown' }); assert.equal(b.build.equipment.steal, undefined); }
});

test('who plays it: the holder wearing it; nobody else, even wearing it', () => {
  const pl = (icon, eq) => new Player(0, 0, { build: { height: 76, weight: 195, wingspan: 79, attributes: {}, icon_badge: icon, equipment: eq }, name: 'X' }, catalog);
  const on = pl('the_clamp', { steal: PKG }), off = pl('the_clamp', {});
  assert.equal(on.stealPkg, PKG); assert.equal(C.clampFull(on), true); assert.deepEqual(C.clampPool(on), catalog[PKG].styles);
  assert.equal(off.stealPkg, null); assert.equal(C.clampFull(off), false); assert.deepEqual(C.clampPool(off), [C.CLAMP_BASIC]);
  assert.equal(C.CLAMP_BASIC, 'vise');
  for (const icon of [null, 'open_arms', 'big_brother', 'sharp_eye']) {
    const q = pl(icon, { steal: PKG });
    assert.equal(q.stealPkg, null, `${icon}: the item does nothing on him`); assert.equal(C.clampFull(q), false); assert.equal(C.clampPool(q), null);
    assert.equal(C.clampReach(q, { x: 0.2, z: 0.8, y: 0.8, mode: 'dribble' }, { hand: 'L', tick: 3 }), null);
  }
  // something else in the slot (an old save, a hand-edited one) is nothing either
  assert.equal(pl('the_clamp', { steal: 'reb_openarms' }).stealPkg, null);
});

test('package on: the six reaches for the moment, the pick-offs and the strip; slot empty: The Vise alone, no overlay', () => {
  const on = reaches('the_clamp', true), off = reaches('the_clamp', false), none = reaches(null, true);
  assert.ok(new Set(on.map(x => x.anim)).size >= 4, `varied: ${[...new Set(on.map(x => x.anim))]}`);
  for (const x of on) assert.ok(REACHES.includes(x.anim) && x.icon === 'clamp');
  for (const x of off) { assert.equal(x.anim, 'vise'); assert.equal(x.icon, 'clamp'); }
  for (const x of none) { assert.equal(x.anim, null); assert.equal(x.icon, null); }
  // the reach is the same reach whichever he plays (only the animator's fields differ)
  for (let i = 0; i < on.length; i++) for (const k of ['hand', 'low', 'aimed', 'checked', 'dur', 'cool']) { assert.equal(on[i][k], off[i][k], k); assert.equal(on[i][k], none[i][k], k); }
  // the pass he jumps and the driver who runs into him: picked off / stripped either way (the game's), the overlay only
  // with the package on
  const pi = intercept('the_clamp', true), po = intercept('the_clamp', false), pn = intercept(null, true);
  for (const r of [pi, po, pn]) assert.ok(r.got, 'picked off');
  assert.equal(pi.fx.kind, 'pick'); assert.ok(PICKS.includes(pi.fx.style));
  assert.equal(po.fx, null, 'no pick-off with the slot empty'); assert.equal(pn.fx, null, 'nor for anyone else');
  // the ball goes to the same place: an ordinary hold once the pick-off is over
  while (pi.d.clampFx) { pi.g.tickAction(pi.d, 1 / 60); }
  const a = pi.g.holdPoint(pi.d), b = po.g.holdPoint(po.d);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6);
  const si = strip('the_clamp', true), so = strip('the_clamp', false), sn = strip(null, true);
  for (const r of [si, so, sn]) { assert.ok(r.got, 'stripped'); assert.equal(r.mode, 'flight', 'loose, where the game sends it'); }
  assert.equal(si.fx.kind, 'strip'); assert.ok(STRIPS.includes(si.fx.style));
  assert.equal(so.fx, null, 'no strip with the slot empty'); assert.equal(sn.fx, null, 'nor for anyone else');
});

test('in games: on or off the same game until a different animation is shown (steal odds unchanged), the same seed the same animations, The Vise alone off', () => {
  const anim = d => (d.action?.type === 'steal' && d.action.clamp) || d.clampFx?.style || '-';
  // the two side by side, tick for tick: the package on and off
  const pair = (icon, seed, wear = [true, false]) => {
    const G = wear.map(w => park(icon, w, seed)), logs = [[], []], fx = [0, 0];
    let split = null, steps = 0, other = 0;
    while (!G[0].g.over && !G[1].g.over && steps < 60 * 60 * 25) {
      steps++;
      G.forEach(({ g, d }, k) => {
        g.step(1 / 60);
        for (const e of g.events) if (e.type === 'steal' && e.player === d.id) logs[k].push(`${g.tick}:${e.intercept ? 'intercept' : e.bump ? 'bump' : 'reach'}:${anim(d)}`);
        if (d.clampFx) fx[k]++;
        if (d.action?.type === 'steal') assert.ok(wear[k] && icon ? REACHES.includes(d.action.clamp) : icon ? d.action.clamp === 'vise' : d.action.clamp == null, `${icon}/${wear[k]}: ${d.action.clamp}`);
        for (const q of g.players) if (q !== d && (q.clampFx || q.action?.clamp)) other++;
      });
      if (split == null && G[0].g.stateHash() !== G[1].g.stateHash()) {
        // (the only thing that can tell them apart: the ball in his hands riding the animation he shows; the game's RNG,
        // every steal and every player the same up to here)
        split = { tick: G[0].g.tick, rng: G[0].g.rng.s === G[1].g.rng.s, anims: G.map(x => anim(x.d)), held: G.map(x => x.g.ball.holder === x.d.id) };
      }
    }
    return { logs, fx, split, other, over: G.map(x => x.g.over) };
  };
  let splits = 0, steals = 0;
  for (const seed of [21, 47]) {
    const r = pair('the_clamp', seed), [on, off] = r.logs;
    steals += on.length;
    const before = l => r.split ? l.filter(x => +x.split(':')[0] <= r.split.tick) : l, kinds = l => l.map(x => x.split(':').slice(0, 2).join(':'));
    assert.deepEqual(kinds(before(off)), kinds(before(on)), `seed ${seed}: the same steals at the same ticks`);
    if (r.split) {
      splits++;
      assert.ok(r.split.rng, 'the game\'s RNG the same'); assert.notEqual(r.split.anims[0], r.split.anims[1], `parted by the animation shown: ${r.split.anims}`);
      assert.ok(r.split.held[0] && r.split.held[1], 'a steal he came up with, the ball in his hands');
    } else assert.deepEqual(r.over, [true, true], 'the whole game the same');
    assert.equal(r.fx[1], 0, 'no overlay with the slot empty');
    for (const l of off) { const [, k, an] = l.split(':'); if (k === 'reach') assert.equal(an, 'vise'); else assert.equal(an, '-'); }
    assert.equal(r.other, 0);
    if (seed === 21) { const again = pair('the_clamp', seed); assert.deepEqual(again.logs, r.logs, 'the same seed, the same animations'); assert.deepEqual(again.split, r.split); }
  }
  assert.ok(steals >= 2, `${steals} steals`);
  // the item on a Lockdown without the badge: the whole game the same as without it, and nothing shown
  const n = pair(null, 21);
  assert.equal(n.split, null, 'the same game tick for tick'); assert.deepEqual(n.over, [true, true]);
  assert.equal(n.fx[0], 0); for (const l of n.logs[0]) assert.equal(l.split(':')[2], '-');
});

test('the preview: the package\'s ten in turn, each its own moment; The Vise with the slot empty; it loops and stays finite', () => {
  const build = { height: 77, weight: 200, wingspan: 81, hand: 'R', attributes: {}, icon_badge: 'the_clamp' };
  const run = (eq, opts, secs) => {
    const sim = new PreviewSim(); sim.setPlayer({ ...build, equipment: eq }, catalog); sim.setPreview('steal', opts);
    const seen = [], kinds = { steal: new Set(), pick: new Set(), strip: new Set() };
    let bad = 0, held = 0, loose = 0;
    for (let i = 0; i < 60 * secs; i++) {
      const out = sim.step(1 / 60, 0.35 + i * 0.001), p = sim.player;
      if (seen[seen.length - 1] !== sim.stStyle) seen.push(sim.stStyle);
      for (const v of [p.x, p.y, p.z, ...(out.ball ? [out.ball.x, out.ball.y, out.ball.z] : [])]) if (!Number.isFinite(v)) bad++;
      if (out.ball && (out.ball.y < 0 || out.ball.y > 4 || Math.hypot(out.ball.x, out.ball.z) > 12)) bad++;
      if (p.action?.type === 'steal') kinds.steal.add(p.action.clamp);
      if (p.clampFx) kinds[p.clampFx.kind].add(p.clampFx.style);
      if (out.hasBall) held++; else if (out.ball) loose++;
    }
    return { seen, kinds, bad, held, loose, loops: sim.loopN };
  };
  const full = run({ steal: PKG }, { styles: catalog[PKG].styles }, 17.5);
  assert.deepEqual(full.seen.slice(0, 10), catalog[PKG].styles, 'all ten in order');
  assert.equal(full.seen[10], 'vise', 'and round again');
  assert.deepEqual([...full.kinds.steal].sort(), [...REACHES].sort(), 'each reach is the reach');
  assert.deepEqual([...full.kinds.pick].sort(), [...PICKS].sort(), 'each pick-off is the pick-off overlay');
  assert.deepEqual([...full.kinds.strip], STRIPS);
  assert.equal(full.bad, 0); assert.ok(full.held > 200 && full.loose > 200, `${full.held} held, ${full.loose} loose`);
  // the slot empty (MyPlayer's Basic Vise; opts.styles none): The Vise every time, no overlay
  for (const opts of [{}, { styles: [C.CLAMP_BASIC] }]) {
    const basic = run({}, opts, 6);
    assert.ok(basic.loops >= 3, `${basic.loops} loops`); assert.deepEqual(basic.seen, ['vise']);
    assert.deepEqual([...basic.kinds.steal], ['vise']); assert.equal(basic.kinds.pick.size + basic.kinds.strip.size, 0);
    assert.equal(basic.bad, 0);
  }
});

test('the screens: a Steals category for the holder alone (never in the store), a MyPlayer row with Basic Vise, the previews', () => {
  const store = src('client/js/ui/store.js'), inv = src('client/js/ui/inventory.js'), mp = src('client/js/ui/myplayer.js'), sr = src('client/js/game/showroom.js');
  assert.ok(store.includes("['steal', 'Steals', 'wide', 'Animations', 'the_clamp']"));
  assert.ok(store.includes('export const catsFor = (build = null) => CATS.filter(x => !x[4] || (!!build && build.icon_badge === x[4]));'));
  // (the categories, as the screens filter them: the store has none of the Icon ones; the Inventory the build's own)
  const CATS = new Function(`return ${store.match(/export const CATS = (\[[\s\S]*?\n\]);/)[1]}`)();
  const catsFor = (build = null) => CATS.filter(x => !x[4] || (!!build && build.icon_badge === x[4]));
  const has = (b, k) => catsFor(b).some(x => x[0] === k);
  assert.equal(has(null, 'steal'), false, 'never in the store');
  assert.equal(has({ icon_badge: 'the_clamp' }, 'steal'), true, 'the holder\'s Inventory');
  for (const ic of [null, 'open_arms', 'big_brother', 'sharp_eye']) assert.equal(has({ icon_badge: ic, archetype: 'lockdown' }, 'steal'), false, `${ic}`);
  assert.equal(CATS.find(x => x[0] === 'steal')[3], 'Animations');
  assert.equal(CATS.findIndex(x => x[0] === 'steal'), CATS.findIndex(x => x[0] === 'rebound') + 1, 'after the Rebounds');
  assert.ok(inv.includes('catTabs(cat, count, c)') && inv.includes('if (!catShown(cat, c)) cat = \'top\';'));
  assert.ok(store.includes('if (!catShown(cat)) cat = \'top\';'), 'the store falls back off it');
  assert.ok(store.includes("else if (item.slot === 'steal') app.showroom.setPreview('steal', { styles: item.styles });"), 'the try-on');
  assert.ok(store.includes("i.slot === 'steal' ? 'STL'") && store.includes("i.slot === 'steal' ? 'Steals'"));
  // MyPlayer: the row for the holder alone, Basic Vise to empty the slot, the preview
  assert.ok(mp.includes("['steal', 'Steal package', 'steal', 'the_clamp']") && mp.includes('.filter(([, , , icon]) => !icon || c.icon_badge === icon)'));
  assert.ok(mp.includes('data-equip="${slot}" data-id="" title="No package: The Clamp badge\'s own basic steal, The Vise">Basic Vise</button>'));
  assert.ok(mp.includes("kind === 'steal' ? (stl?.styles || [CLAMP_BASIC])"));
  assert.ok(/this\.preview === 'steal'\) return null/.test(sr), 'the showroom: he looks at the ball');
  // the sim plays it by the slot
  const gs = src('client/js/sim/game.js'), ps = src('client/js/sim/player.js');
  assert.ok(ps.includes('this.stealPkg = stealPackageOf(entry.build, this.icon);'));
  assert.ok(gs.includes('const clampAnim = clampReach(p, this.ball,') && gs.includes('if (clampFull(p)) clampPickStart(') && gs.includes('if (clampFull(def)) clampStripStart('));
});
