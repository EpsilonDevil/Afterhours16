// v0.4.8.5 quick patch 7: "Let's change that so that AI can wear exclusives they've unlocked; since our game world is
// persistent and they will continue to grind level up and unlock things." The AI world's hoopers now unlock exclusives
// as they grind (sim/world.js): a Park Legend or an Elite good enough gets his archetype's Icon badge with his 7th Hall
// of Fame badge (career games: the ones this world has seen plus the ones he plays when you're away), everyone spins
// the Daily Spin on the days he plays (the wheel's own odds), and the event prizes they win in closed windows come from
// the server (cup.ai_prizes, GET /api/ai-world/unlocks: tests/test_ai_unlocks.py). They wear them (bots.js
// wearUnlocked): an Icon's package always, the rest by how flashy he is, sets together, on a stream of draws of their
// own, so with nothing unlocked every one of the 900 is exactly the makeBot hooper he always was.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AIWorld, ICON_GRIND, AI_WHEEL, AI_LADDER, PARKS, cupWindow, setEventVenue, CUP_EPOCH, CUP_WINDOW } from '../client/js/sim/world.js';
import { makeBot, wearUnlocked, WEAR, WEAR_SETS, WEAR_SLOTS, wearShow, wearChance, spreadGreens } from '../client/js/sim/bots.js';
import { ICON_FOR_ARCH, ICON_BADGES } from '../client/js/sim/badges.js';
import { Player } from '../client/js/sim/player.js';
import { Game } from '../client/js/sim/game.js';
import { clampFull } from '../client/js/sim/clamp.js';
import { RNG } from '../client/js/core/rng.js';
import { hofCapacity } from '../client/js/sim/builds.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const DAY = 86400000, NOW = Date.now();
const world = (seed, days, data = {}) => new AIWorld({ seed, born: NOW - days * DAY, ...data }, catalog);
const SEEDS = [4242, 777, 31337];
const EVENT_KINDS = ['cup', 'jungle', 'beat', 'monster'];
const iconItems = ic => list.filter(i => i.exclusive === 'icon' && i.icon === ic);

// the AI world's entry before quick patch 7, line for line (what everyone with nothing unlocked must still be)
function prePatch(w, id) {
  const gk = Math.round(w.growth(id) * 400), a = w.account(id), flash = Math.min(1, a.level * 0.6 + a.rep / 40);
  const bot = makeBot(w.rng(id, 'build'), { catalog, position: a.position, level: a.level, rep: a.rep, flash });
  if (gk > 0) {
    const up = makeBot(w.rng(id, 'build'), { catalog, position: a.position, level: Math.min(1, a.level + gk / 400), rep: a.rep, flash });
    bot.build.attributes = up.build.attributes; bot.build.overall = up.build.overall; bot.badges = up.badges; bot.badgeUse = up.badgeUse; bot.level = up.level;
  }
  return bot;
}
const who = e => { const { rep, ...build } = e.build; return JSON.stringify({ name: e.name, number: e.number, appearance: e.appearance, build, badges: e.badges, badgeUse: e.badgeUse, level: e.level }); };

test('nothing unlocked, nothing changes: every one of the 900 is exactly the makeBot hooper he was', () => {
  for (const seed of [4242, 123456789]) {
    // (some of them growing; qp8: fewer games tracked than any AI's climb past 90 takes, AI_LADDER.full90's least)
    const prog = {}; for (let i = 0; i < 900; i += 3) prog['ai-' + i] = { g: (i * 13) % 8, w: (i * 5) % 4 };
    const w = world(seed, 0, { prog });
    w.setUnlocks({ prizes: {}, through: cupWindow(NOW) - 1 });
    let grown = 0;
    for (const id of w.ids()) {
      const e = w.entry(id);
      assert.equal(who(e), who(prePatch(w, id)), `${seed} ${id}`);
      assert.equal(e.build.icon_badge, undefined); assert.equal(e.unlocked, undefined);
      if (e.gk) grown++;
    }
    assert.ok(grown > 100, `(some had grown: ${grown})`);
  }
  // and the bare makeBot still never picks an exclusive on its own beyond the wheel's old baseline hit (the event prizes and
  // the Icon items never; the 4-16% baseline of jumpshot / release / dunk and the wheel chains as before)
  const rng = new RNG(7);
  for (let n = 0; n < 300; n++) {
    const b = makeBot(rng, { catalog, level: (n % 10) / 10, rep: 20, flash: 1 });
    for (const [slot, id] of Object.entries(b.build.equipment)) {
      const x = catalog[id]?.exclusive;
      assert.ok(!x || (x === 'wheel' && ['jumpshot', 'release', 'dunk', 'chain'].includes(slot)), `bot ${n} ${slot}: ${id}`);
    }
  }
});

test('an unlock only ever changes what he wears: name, body, look, badges and the same draws as before', () => {
  for (const seed of [4242, 31337]) {
    // (qp8: both climb past 90 alike, so what's left between them is the wheel's items and the prizes, and what they wear)
    const w = world(seed, 365), bare = world(seed, 365);
    bare.wheelOf = () => ({ owned: [], spins: 0 });
    w.setUnlocks({ prizes: { 'ai-1': ['cup_band_scarab', 'cup_celly_pharaoh'], 'ai-2': ['jb_gorilla_top', 'jb_gorilla_legs'] }, through: 1 });
    let changed = 0;
    for (const id of w.ids()) {
      const e = w.entry(id), b = bare.entry(id);
      for (const k of ['name', 'number', 'appearance', 'level', 'badges']) assert.deepEqual(e[k], b[k], `${id} ${k}`);
      for (const k of ['height', 'weight', 'wingspan', 'archetype', 'position', 'hand', 'attributes', 'overall', 'tendencies', 'name', 'appearance', 'icon_badge', 'cap_breakers', 'legend', 'badges']) assert.deepEqual(e.build[k], b.build[k], `${id} build.${k}`);
      for (const [slot, id2] of Object.entries(e.build.equipment)) {
        if (id2 === b.build.equipment[slot]) continue;
        changed++;
        assert.ok(WEAR_SLOTS.includes(slot), `${id}: ${slot}`);
        assert.ok(catalog[id2].exclusive, `${id}: what changed is something he unlocked (${id2})`);
      }
      for (const slot of Object.keys(b.build.equipment)) assert.ok(slot in e.build.equipment, `${id} still wears a ${slot}`);
    }
    assert.ok(changed > 200, `a year in, plenty to see (${changed} slots)`);
  }
  // (the wear draws are a stream of their own: makeBot's are where they always were)
  const bots = src('client/js/sim/bots.js'), wo = src('client/js/sim/world.js');
  assert.ok(wo.includes("this.rng(id, 'wear')") && wo.includes("makeBot(this.rng(id, 'build')"));
  const mk = bots.slice(bots.indexOf('export function makeBot('), bots.indexOf('// v0.4.8.5 qp7: the exclusives an AI hooper'));
  assert.ok(!mk.includes('wearUnlocked') && !mk.includes('icon_badge') && mk.includes('!i.exclusive'));
});

// (qp8: the Icon badge is now the 7th Hall of Fame badge of the climb past 90, the way it is for you, and ICON status the
// 99 at the top of it: tests/v0485qp8ai.test.mjs counts both at every age)
test('Icon badges by grinding: the climb\'s 7th Hall of Fame badge, legends and the best elites only, never lost', () => {
  for (const seed of SEEDS) {
    let prev = new Set();
    for (const D of [30, 60, 180]) {
      const w = world(seed, D), ic = w.ids().filter(id => w.hasIcon(id, NOW));
      for (const id of prev) assert.ok(ic.includes(id), `${seed}: ${id} kept his Icon from day ${D}`);
      prev = new Set(ic);
      for (const id of ic) {
        const a = w.account(id), L = w.ladder(id, NOW), e = w.entry(id);
        assert.ok(['legend', 'elite'].includes(a.tier.id) && w.potential(id) >= AI_LADDER.icon, `${id} ${a.tier.id}`);
        assert.ok(L.h >= L.target && Object.values(e.badges).filter(t => t >= 4).length === hofCapacity(e.build), `${id}: his Icon at his ${L.target}th HOF, and then every HOF his build can reach (v0.4.8.7)`);
        assert.equal(e.build.icon_badge, ICON_FOR_ARCH[e.build.archetype]);
      }
    }
  }
  // below Elite: never, however much he plays
  const w = world(4242, 40), reg = w.ids().find(x => w.account(x).tier.id === 'hooper');
  w.prog[reg] = { g: 99999, w: 99999 }; assert.equal(w.hasIcon(reg), false);
  assert.equal(ICON_GRIND.perDay, 3);
});

test('every one of the eight: an AI Icon wears his Icon\'s package and plays it', () => {
  const found = {};
  for (const seed of [4242, 777, 31337, 99, 5, 6, 7]) {
    const w = world(seed, 365);
    for (const id of w.ids()) { const e = w.entry(id), ic = e.build.icon_badge; if (ic && !found[ic]) found[ic] = e; }
    if (Object.keys(found).length === 8) break;
  }
  assert.deepEqual(Object.keys(found).sort(), Object.keys(ICON_BADGES).sort());
  for (const [ic, e] of Object.entries(found)) {
    const items = iconItems(ic);
    for (const i of items) assert.equal(e.build.equipment[i.slot], i.id, `${ic}: ${i.id} on`);
    assert.equal(items.length, ic === 'sharp_eye' ? 2 : 1, ic); // (v0.4.8.7 qp7: Oprah's passes are an item now too, the Pass Package)
    if (ic === 'oprah') assert.equal(e.build.equipment.pass, 'pass_oprah');
    const p = new Player(0, 0, e, catalog), plain = new Player(1, 0, { ...e, build: { ...e.build, icon_badge: null } }, catalog);
    assert.equal(p.icon, ic);
    const stat = Object.keys(ICON_BADGES[ic].stats)[0] || (ICON_BADGES[ic].all ? 'speed' : null); // (Sharp Eye's is the green window)
    if (stat) assert.ok(p.ratings[stat] > plain.ratings[stat], `${ic} plays his Icon's % (${stat})`);
    if (ic === 'the_clamp') { assert.equal(p.stealPkg, 'steal_the_clamp'); assert.ok(clampFull(p), 'the whole Steal Package, not just the Vise'); }
    if (ic === 'open_arms') assert.equal(p.reboundPkg, 'reb_openarms');
    if (ic === 'big_brother') assert.equal(p.blockPkg, 'block_big_brother');
    if (ic === 'hash_slinging') assert.equal(p.dunkPkg, 'dunk_hash_slinging');
    if (ic === 'sexy_red') assert.equal(p.postPkg, 'post_sexy_red');
    if (ic === 'the_general') assert.equal(e.build.equipment.celebration, 'cel_general_salute');
    if (ic === 'sharp_eye') assert.deepEqual([e.build.equipment.jumpshot, e.build.equipment.release], ['js_base_sharpeye', 'release_sharpeye']);
  }
});

test('the Daily Spin: the wheel\'s odds, once a day he plays, only ever more, never past the sixteen', () => {
  // the odds are the server's (progression.py WHEEL_ODDS)
  const prog = src('server/progression.py');
  assert.ok(prog.includes(`"gear": ${AI_WHEEL.gear.toFixed(1)}`) && prog.includes(`"anim": ${AI_WHEEL.anim}`), 'gear 12, anim 9.8');
  const wheel = list.filter(i => i.exclusive === 'wheel').map(i => i.id);
  assert.equal(wheel.length, 16);
  // early on (nothing sold out yet) about 21.8% of spins land an item
  let spins = 0, items = 0, days = 0;
  for (const seed of SEEDS) { const w = world(seed, 12); for (const id of w.ids()) { const s = w.wheelOf(id, NOW); spins += s.spins; items += s.owned.length; days += 12; } }
  const rate = items / spins, often = spins / days;
  assert.ok(Math.abs(rate - 0.218) < 0.025, `item rate ${rate.toFixed(3)}`);
  assert.ok(often > 0.3 && often < 0.6, `spins a day ${often.toFixed(2)} (how often he plays × how keen he is)`);
  // deterministic, one go or day by day, and only ever more
  const a = world(4242, 200), b = world(4242, 200);
  for (const id of a.ids().slice(0, 300)) {
    const early = [...a.wheelOf(id, NOW - 120 * DAY).owned], mid = [...a.wheelOf(id, NOW - 50 * DAY).owned], late = a.wheelOf(id, NOW).owned;
    assert.deepEqual(late, b.wheelOf(id, NOW).owned, id);
    assert.deepEqual(late.slice(0, mid.length), mid); assert.deepEqual(mid.slice(0, early.length), early);
    assert.equal(new Set(late).size, late.length);
    assert.ok(late.length <= 16 && late.every(x => wheel.includes(x)));
  }
  // a year in, most have most of it, nobody more than all of it
  const y = world(777, 365), owned = y.ids().map(id => y.wheelOf(id).owned.length);
  assert.ok(Math.max(...owned) <= 16 && owned.reduce((s, n) => s + n, 0) / 900 > 12);
  // a brand-new world: nothing yet
  const n0 = world(777, 0); assert.ok(n0.ids().every(id => n0.wheelOf(id).owned.length === 0));
});

test('wearing: the Icon\'s package always, the rest by flash, sets together, the rules still apply, one unlock moves one slot', () => {
  const base = () => makeBot(new RNG(5), { catalog, level: 0.9, position: 'SG', archetype: 'lockdown', rep: 15 }).build;
  const b0 = base(); b0.icon_badge = 'the_clamp';
  wearUnlocked(b0, [], catalog, new RNG(1), 0, 15);
  assert.equal(b0.equipment.steal, 'steal_the_clamp', 'an Icon\'s package goes on whatever his flash');
  // everything the events and the wheel hand out, owned: sets go on together, never half a costume
  const all = list.filter(i => [...EVENT_KINDS, 'wheel'].includes(i.exclusive)).map(i => i.id);
  let shown = 0, sets = 0;
  for (let s = 1; s <= 400; s++) {
    const b = base(), before = { ...b.equipment };
    wearUnlocked(b, all, catalog, new RNG(s), 1, 15);
    const eq = b.equipment;
    if (Object.keys(eq).some(k => eq[k] !== before[k])) shown++;
    for (const [top, bot] of WEAR_SETS) {
      assert.equal(eq.top === top, eq.bottom === bot, `seed ${s}: ${eq.top} / ${eq.bottom}`);
      if (eq.top === top) sets++;
    }
    for (const id of Object.values(eq)) assert.ok(!catalog[id]?.exclusive || all.includes(id) || catalog[id].exclusive === 'wheel', id);
  }
  assert.ok(Math.abs(shown / 400 - wearShow(1)) < 0.08, `a legend shows his stuff off ${shown / 400}`);
  assert.ok(sets > 20);
  // the rules still apply: an item he can't equip never goes on
  const strict = { ...catalog, wheel_shoes_lava: { ...catalog.wheel_shoes_lava, min_overall: 99 } };
  for (let s = 1; s <= 200; s++) { const b = base(); wearUnlocked(b, ['wheel_shoes_lava'], strict, new RNG(s), 1, 15); assert.notEqual(b.equipment.shoes, 'wheel_shoes_lava'); }
  // a new unlock only ever moves the slot it's for
  for (let s = 1; s <= 200; s++) {
    const own = ['cup_shoes_pharaoh', 'wheel_dunk_showtime', 'jb_celly_chestbeat', 'wheel_sleeve_frost'];
    const x = base(), y = base();
    wearUnlocked(x, own, catalog, new RNG(s), 0.8, 15); wearUnlocked(y, [...own, 'bg_band_terry'], catalog, new RNG(s), 0.8, 15);
    for (const k of new Set([...Object.keys(x.equipment), ...Object.keys(y.equipment)])) if (k !== 'headband') assert.equal(x.equipment[k], y.equipment[k], `${s} ${k}`);
  }
  // flash: legends far more than casuals
  assert.ok(wearShow(1) > 10 * wearShow(0.15) && wearShow(0.83) > 0.2 && wearShow(0.15) < 0.05);
  assert.ok(wearChance(0) === WEAR.slot[0] && wearChance(1) === WEAR.slot[0] + WEAR.slot[1]);
});

test('a busy park: some wear what they\'ve unlocked, not everyone, legends far more than casuals', () => {
  setEventVenue(null);
  const share = (seed, D, prizes = {}) => {
    const w = world(seed, D), bare = world(seed, D);
    bare.ladder = () => null; bare.wheelOf = () => ({ owned: [], spins: 0 }); // (qp8: the Icon's package comes with the climb)
    w.setUnlocks({ prizes, through: cupWindow(NOW) - 1 });
    const seen = new Set(), d0 = new Date(NOW); d0.setHours(19, 0, 0, 0);
    for (let k = 0; k < 7; k++) for (const h of [0, 1, 2]) for (const pk of PARKS) for (const id of w.onlineAt(pk, d0.getTime() + k * DAY + h * 3600000)) seen.add(id);
    const by = {}, items = {}; let any = 0;
    for (const id of seen) {
      const e = w.entry(id), b = bare.entry(id), t = (by[e.tier] ||= [0, 0]);
      const fresh = Object.entries(e.build.equipment).filter(([k, v]) => v !== b.build.equipment[k] && catalog[v]?.exclusive).map(([, v]) => v);
      t[1]++; if (fresh.length) { any++; t[0]++; }
      for (const i of fresh) items[i] = (items[i] || 0) + 1;
    }
    return { n: seen.size, any: any / seen.size, by, items };
  };
  for (const seed of [4242, 777]) for (const D of [60, 180]) {
    const s = share(seed, D);
    assert.ok(s.n > 500, `a busy park (${s.n})`);
    assert.ok(s.any > 0.08 && s.any < 0.3, `${seed} ${D} days: ${(s.any * 100).toFixed(1)}% in something they've unlocked`);
    const r = t => s.by[t][0] / s.by[t][1];
    assert.ok(r('legend') > 0.4 && r('legend') > 4 * r('casual') && r('elite') > 2 * r('regular'), JSON.stringify(s.by));
  }
  // with event prizes (here: every elite and legend has won the whole of the King Tut Cup): the costume goes on as a set,
  // and still not on everyone
  const w0 = world(4242, 180), prizes = {};
  for (const id of w0.ids()) if (['elite', 'legend'].includes(w0.account(id).tier.id)) prizes[id] = list.filter(i => i.exclusive === 'cup').map(i => i.id);
  const s = share(4242, 180, prizes);
  assert.ok(s.items.cup_mocap_top > 3 && s.items.cup_mocap_top === s.items.cup_mocap_tights, JSON.stringify(s.items));
  assert.ok(s.any < 0.35);
});

test('setUnlocks: the server\'s prizes dress the ones who won them; the same answer changes nothing; asked again as windows close', () => {
  const w = world(4242, 60), id = w.ids().find(x => w.account(x).tier.id === 'legend' && !w.hasIcon(x));
  const e0 = w.entry(id);
  assert.equal(w.entry(id), e0, '(kept)');
  const cupSet = list.filter(i => i.exclusive === 'cup').map(i => i.id);
  assert.equal(w.setUnlocks({ prizes: { [id]: cupSet, 'nope': ['x'], 'ai-3': 'bad' }, through: cupWindow(NOW) - 1 }), true);
  assert.deepEqual(Object.keys(w.prizes), [id]);
  const e1 = w.entry(id);
  assert.notEqual(e1, e0); assert.deepEqual(e1.unlocked.prizes, cupSet);
  assert.equal(e1.name, e0.name);
  assert.equal(w.setUnlocks({ prizes: { [id]: cupSet }, through: cupWindow(NOW) - 1 }), false);
  assert.equal(w.entry(id), e1, 'the same answer: nothing rebuilt');
  // when to ask again: a window closed past the last one the server told us about (a minute between asks)
  const v = world(1, 10);
  assert.equal(v.unlocksDue(NOW), true, 'never asked');
  v.unlockAsked = NOW; v.setUnlocks({ prizes: {}, through: cupWindow(NOW) - 1 }, NOW);
  assert.equal(v.unlocksDue(NOW + 30000), false); assert.equal(v.unlocksDue(NOW + 120000), cupWindow(NOW + 120000) - 1 > cupWindow(NOW) - 1);
  const next = CUP_EPOCH + (cupWindow(NOW) + 1) * CUP_WINDOW;
  assert.equal(v.unlocksDue(next + 61000), true, 'a window closed');
  v.unlockOk = false; assert.equal(v.unlocksDue(NOW + 61000), true, 'the last ask failed: again a minute on');
  // the plumbing
  assert.match(src('client/js/sim/world.js'), /refreshUnlocks\(app, w\);/);
  assert.match(src('client/js/sim/world.js'), /app\.api\.get\('\/api\/ai-world\/unlocks'\)/);
  assert.match(src('client/js/ui/events.js'), /if \(app\.ai\?\.unlocksDue\?\.\(\)\) refreshUnlocks\(app\)/);
  assert.match(src('server/app.py'), /if path == "\/api\/ai-world\/unlocks":/);
});

test('greens: an unlocked sound or effect on two AI in one game still plays once; online, his unlocks travel in his entry', async () => {
  const r = new RNG(3), bots = Array.from({ length: 6 }, () => makeBot(r, { catalog, level: 0.9 }));
  for (const b of bots) { b.build.equipment.greensound = 'cup_gsnd_pharaoh'; b.build.equipment.greenfx = 'jb_gfx_banana'; }
  const ps = bots.map((b, i) => new Player(i, i % 2, b, catalog));
  spreadGreens(ps, catalog);
  assert.equal(new Set(ps.map(p => p.greenSound)).size, 6); assert.equal(new Set(ps.map(p => p.greenFx)).size, 6);
  assert.equal(ps[0].greenSound, 'cup_gsnd_pharaoh', 'the first keeps his');
  // online: the entry carries the build (Icon badge and gear) and nothing filters it; your AI squad is sent again when
  // what they wear changes
  const { setupEntry, myAISquad } = await import('../client/js/ui/online.js');
  const w = world(777, 365), id = w.ids().find(x => w.hasIcon(x) && w.entry(x).build.icon_badge === 'the_clamp') || w.ids().find(x => w.hasIcon(x));
  const e = w.gameEntry(id), out = setupEntry({ catalog }, e, false);
  assert.equal(out.build.icon_badge, e.build.icon_badge); assert.deepEqual(out.build.equipment, e.build.equipment);
  const mine = myAISquad({ ai: { activeSquad: () => [id], gameEntry: () => w.gameEntry(id) } });
  assert.equal(mine[0].entry.build.icon_badge, e.build.icon_badge);
  assert.ok(src('client/js/ui/online.js').includes("a.entry.build.icon_badge || ''}:${Object.values(a.entry.build.equipment || {}).join('.')}"));
  // and a lockstep game plays the same on every screen: everything comes from the entries and the game's seed (an
  // entry is built without Math.random)
  const keep = Math.random;
  Math.random = () => { throw new Error('Math.random in an AI entry'); };
  let ents;
  try { const v = world(777, 365); ents = v.ids().filter(x => v.hasIcon(x)).slice(0, 6).map(x => v.gameEntry(x)); } finally { Math.random = keep; }
  const sig = () => {
    const g = new Game({ mode: 'park', seed: 77, rosters: [ents.slice(0, 3).map(x => JSON.parse(JSON.stringify(x))), ents.slice(3, 6).map(x => JSON.parse(JSON.stringify(x)))], catalog, target: 21 });
    for (let i = 0; i < 60 * 40; i++) g.step(1 / 60);
    return JSON.stringify([g.score, g.tick, g.players.map(p => [p.x.toFixed(4), p.z.toFixed(4), p.stats.pts, p.stats.stl])]);
  };
  assert.equal(sig(), sig());
});

test('the phone shows the AI Icons, and the old "never on the AI" tests now say nothing unlocked, nothing worn', () => {
  const ph = src('client/js/ui/phone.js');
  assert.ok(ph.includes('iconBadgeSVG(ic, 18)') && ph.includes('const ic = e.build.icon_badge') && ph.includes('${iconChip(e)}'));
  assert.ok(ph.includes("'Daily Spin item'") && ph.includes("'event prize'"));
  for (const f of ['tests/v0485beatitems.test.mjs', 'tests/v0485monsteritems.test.mjs']) assert.ok(src(f).includes('nothing unlocked → nothing worn'), f);
});
