// v0.4.8.5 quick patch 8: "make sure AI is able to grind past 90 ovr up to 99 like the rest of us, and ensure that the only
// icons are indeed 99 overalls; we do not want the AI abiding by different rules from the players. Keep in mind our
// scaling rarity of higher level players, ensure the number of AI above 90 ovr is lower than everything under 90; and
// anything above 95 overall being even rarer than that. With 99 OVR ICON AI Players being at the same established rate
// you currently stated, 5-10 in a two month old world, 40 at six months. and 80 after a year."
// The AI world's hoopers climb past 90 on your ladder (sim/world.js ladder / climb, AI_LADDER): a full 90 max OVR (30 Pro
// Run games, every attribute at its cap), Hall of Fame badges as they grind, 5 cap breakers for each of the first five,
// the Icon badge with the 7th, then Icon Legend +1 OVR every 2 Pro Run games (sim/builds.js legendRaise, the server's
// legend_raise: tests/test_ai_ladder.py) to 99, where iconStatus calls him an ICON the way it calls you one.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fake2d = new Proxy({}, { get: (o, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'getImageData' || k === 'createImageData' ? (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
globalThis.OffscreenCanvas = globalThis.OffscreenCanvas || class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fake2d; } };

const { AIWorld, AI_LADDER, climbBadges } = await import('../client/js/sim/world.js');
const { makeBot } = await import('../client/js/sim/bots.js');
const { RNG } = await import('../client/js/core/rng.js');
const B = await import('../client/js/sim/builds.js');
const { Player } = await import('../client/js/sim/player.js');
const { Game } = await import('../client/js/sim/game.js');
const { ICON_BADGES } = await import('../client/js/sim/badges.js');
const { levelRating, teamRating, RATING_MAX } = await import('../client/js/sim/ranks.js');
const { iconFxState } = await import('../client/js/game/iconfx.js');
const { PlayerVisual } = await import('../client/js/game/session.js');
const { topBadges } = await import('../client/js/game/present.js');
const { setupEntry } = await import('../client/js/ui/online.js');

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const DAY = 86400000, NOW = Date.now();
const world = (seed, days, data = {}) => new AIWorld({ seed, born: NOW - days * DAY, ...data }, catalog);
const SEEDS = [4242, 777, 31337];
const census = w => {
  const c = { low: 0, mid: 0, high: 0, icon: 0, holders: 0, max: {} };
  for (const id of w.ids()) {
    const e = w.entry(id, NOW), o = e.build.overall;
    if (o <= 90) c.low++; else if (o <= 95) c.mid++; else c.high++;
    if (o >= 99) c.icon++;
    if (e.build.icon_badge) c.holders++;
    c.max[e.tier] = Math.max(c.max[e.tier] || 0, o);
  }
  return c;
};

test('a world born now: every AI exactly as he was (nobody has climbed yet)', () => {
  for (const seed of [4242, 31337]) {
    const w = world(seed, 0);
    for (const id of w.ids()) {
      const e = w.entry(id), a = w.account(id), flash = Math.min(1, a.level * 0.6 + a.rep / 40);
      const bot = makeBot(w.rng(id, 'build'), { catalog, position: a.position, level: a.level, rep: a.rep, flash });
      const { rep, ...build } = e.build;
      assert.deepEqual({ ...build }, bot.build, `${seed} ${id}`);
      assert.deepEqual([e.name, e.badges, e.level], [bot.name, bot.badges, bot.level]);
      assert.equal(e.climb, undefined); assert.equal(w.ladder(id), null);
      assert.ok(e.build.overall <= 90 && !B.iconStatus(e.build));
    }
  }
});

test('rarity at every age: the 90-and-unders outnumber the 91-95s, who outnumber the 96-99s; ICONs 5-10, ~40, ~80', () => {
  const icons = {};
  for (const seed of SEEDS) for (const D of [0, 60, 180, 365, 730]) {
    const c = census(world(seed, D));
    (icons[D] ||= []).push(c.icon);
    assert.ok(c.low > c.mid, `${seed} ${D}d: ${c.low} > ${c.mid}`);
    assert.ok(c.mid > c.high || (c.mid === 0 && c.high === 0), `${seed} ${D}d: ${c.mid} 91-95 > ${c.high} 96-99`);
    assert.ok(c.holders >= c.icon, 'every ICON holds his Icon badge (and some holders are still on the way)');
    assert.ok(c.max.casual <= 90 && c.max.regular <= 90 && (c.max.hooper || 0) <= 95, JSON.stringify(c.max));
    if (D === 0) assert.equal(c.low, 900);
  }
  const within = (D, lo, hi) => assert.ok(icons[D].every(n => n >= lo && n <= hi), `${D} days: ${icons[D]}`);
  within(0, 0, 0); within(60, 4, 12); within(180, 35, 52); within(365, 70, 95); within(730, 100, 150);
});

test('the hard rules: 99 only with ICON status, every ICON exactly 99, never a step back, the same entry every time', () => {
  for (const seed of [4242, 777]) {
    const born = NOW - 760 * DAY, w = world(seed, 760), twin = world(seed, 760), last = {};
    const ids = w.ids().filter((id, i) => i % 3 === 0 || ['legend', 'elite'].includes(w.account(id).tier.id));
    for (let d = 0; d <= 760; d += 38) {
      const t = born + d * DAY;
      for (const id of ids) {
        const e = w.entry(id, t), b = e.build, o = b.overall, I = B.iconStatus(b);
        assert.equal(o >= 99, I, `${id} day ${d}: ${o} OVR, ICON ${I}`);
        if (I) assert.equal(o, 99);
        assert.equal(o, B.overall(b.attributes, b.position));
        const p = last[id];
        if (p) {
          assert.ok(o >= p.o, `${id} day ${d}: ${p.o} → ${o}`);
          for (const [k, v] of Object.entries(p.badges)) assert.ok((e.badges[k] || 0) >= v, `${id} ${k}`);
          for (const [k, v] of Object.entries(p.attrs)) assert.ok(b.attributes[k] >= v, `${id} ${k}`);
          if (p.holder) assert.ok(b.icon_badge, 'an Icon badge is never lost');
        }
        last[id] = { o, badges: { ...e.badges }, attrs: { ...b.attributes }, holder: !!b.icon_badge };
      }
    }
    // deterministic: another copy of the same world builds the same people
    for (const id of ids.slice(0, 120)) assert.deepEqual(JSON.stringify(twin.entry(id)), JSON.stringify(w.entry(id)));
  }
  // and nothing about it is random: no Math.random anywhere in building an entry
  const keep = Math.random;
  Math.random = () => { throw new Error('Math.random in an AI entry'); };
  try { const w = world(31337, 400); for (const id of w.ids()) w.entry(id); } finally { Math.random = keep; }
});

test('your rules: a full 90 max OVR, attributes within their caps, cap breakers from the first five HOFs, Icon with the 7th, Legend to 99', () => {
  const w = world(777, 730);
  let climbers = 0, icons = 0;
  for (const id of w.ids()) {
    const e = w.entry(id), b = e.build, L = w.ladder(id);
    if (!L) { assert.equal(e.climb, undefined); assert.ok(b.overall <= 90); continue; }
    climbers++;
    assert.equal(B.maxOvr(b), 90, 'his Pro Run games took his max OVR to 90');
    assert.ok(B.prorunCompleted(b) >= 30);
    const caps = B.caps(b);
    for (const [k, v] of Object.entries(b.attributes)) assert.ok(v <= caps[k], `${id} ${k} ${v} > cap ${caps[k]}`);
    const cap = B.badgeCaps(b), hof = Object.entries(e.badges).filter(([, t]) => t >= 4).length;
    for (const [k, t] of Object.entries(e.badges)) { assert.ok(t <= cap[k]); assert.equal(b.badges[k].tier, t); }
    assert.equal(hof, L.h); assert.ok(hof <= B.HOF_LIMIT);
    assert.equal(b.cap_breakers.earned, 5 * Math.min(5, hof));
    const placed = Object.values(b.cap_breakers.applied).reduce((s, n) => s + n, 0);
    assert.equal(placed + b.cap_breakers.available, b.cap_breakers.earned);
    assert.equal(!!b.icon_badge, hof >= B.iconNeed(b));
    if (!b.icon_badge) assert.equal(b.legend.upgrades, 0, 'Legend upgrades only with the Icon badge');
    else assert.ok(b.legend.upgrades <= Math.floor(b.legend.games / 2), 'every 2 Pro Run games, +1');
    const info = B.iconStatusInfo(b);
    if (info.active) { icons++; assert.ok(info.cap_breakers && info.badges && b.overall === 99 && hof === B.iconNeed(b)); assert.equal(info.badges_left, 0); }
  }
  assert.ok(climbers > 300 && icons > 100, `${climbers} climbing, ${icons} ICONs`);
  // the HOF badges come from his own set first, and the set fills out toward Gold as they do
  const b = makeBot(new RNG(7), { catalog, level: 0.95, position: 'SF', archetype: 'two_way' });
  const t3 = climbBadges(b.build, b.badges, 3, 7), t7 = climbBadges(b.build, b.badges, 7, 7), cap = B.badgeCaps(b.build);
  for (const [k, t] of Object.entries(B.capBadges(b.badges, b.build))) assert.ok(t3[k] >= t && t7[k] >= t3[k]);
  assert.equal(Object.values(t3).filter(t => t >= 4).length, 3);
  for (const k of B.BADGE_IDS) assert.ok((t7[k] || 0) >= Math.min(cap[k], 3), `${k} done at the Icon`);
});

test('a 99 plays like one: higher attributes, his Icon % on top, a full badge set, rated past every 90', () => {
  const w = world(4242, 365), id = w.ids().find(x => B.iconStatus(w.entry(x).build));
  assert.ok(id);
  const top = w.entry(id), L = w.ladder(id);
  // the same man the day he reached a full 90 (career games back to his g90)
  let lo = 0, hi = 365;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (w.ladder(id, NOW - m * DAY)) lo = m; else hi = m; }
  const at90 = w.entry(id, NOW - lo * DAY + 1);
  assert.ok(at90.build.overall >= 90 && at90.build.overall <= 92 && top.build.overall === 99, `${at90.build.overall} → ${top.build.overall}`);
  const p99 = new Player(0, 0, top, catalog), p90 = new Player(1, 0, at90, catalog);
  let up = 0; for (const k of Object.keys(p99.raw)) { assert.ok(p99.raw[k] >= p90.raw[k], k); up += p99.raw[k] - p90.raw[k]; }
  assert.ok(up >= 25, `+${up} attribute points from 90 to 99`);
  assert.equal(p99.icon, top.build.icon_badge);
  const ic = ICON_BADGES[p99.icon], stat = Object.keys(ic.stats)[0];
  if (stat) assert.ok(p99.ratings[stat] > p99.raw[stat], 'the Icon % plays on top');
  assert.ok(Object.values(top.badges).filter(t => t >= 4).length === L.target && Object.keys(top.badges).length > Object.keys(at90.badges).length);
  // Pro-Am rates him as the strongest there is; the intro shows ICON and his Hall of Fame badges
  assert.equal(levelRating(top.level), RATING_MAX);
  assert.ok(teamRating([top, top, top]) > teamRating([at90, at90, at90]));
  assert.ok(B.iconStatus(top.build) && !B.iconStatus(at90.build));
  assert.ok(topBadges(top, 3).every(x => x.tier === 4));
  assert.ok(src('client/js/game/present.js').includes('icon: iconStatus(b)'));
});

test('ICON AI on the floor: his Icon badge cursor, the purple flame on fire, his aura from a 3-game streak; on the phone, the ICON tag', () => {
  const w = world(4242, 365), ids = w.ids();
  const icon = w.entry(ids.find(x => B.iconStatus(w.entry(x).build))), climber = w.entry(ids.find(x => { const e = w.entry(x); return e.build.overall > 90 && e.build.overall < 99; }));
  const ctx = { geometry: g => ({ ...g, bounds: g.bounds || { center: [0, 0, 0], radius: 1 } }), texture: (s, o) => ({ s, o }), disposeGeometry() {} };
  const scene = { meshes: [], add(m) { this.meshes.push(m); return m; }, remove(m) { const i = this.meshes.indexOf(m); if (i >= 0) this.meshes.splice(i, 1); } };
  const r = { ctx, lodEye: [0, 6, 14] }, pool = { take: () => null, request: () => ({}), cancel() {}, release() {} };
  const pv = new PlayerVisual(r, scene, icon.build, {}, { pool }), pc = new PlayerVisual(r, scene, climber.build, {}, { pool });
  assert.equal(pv.addIcon(r, '#ff5a6a'), true); assert.ok(pv.icon.cursor);
  assert.equal(pc.addIcon(r, '#ff5a6a'), false, 'a 96 is not an ICON');
  assert.equal(iconFxState(icon.build).badge, icon.build.icon_badge);
  pv.addStatus(r); pv.setStatus(true, false, 1 / 60); assert.equal(pv.icon.onFire, true); assert.equal(pv.fire.visible, false, 'his badge burns purple instead');
  assert.equal(iconFxState({ ...icon.build, win_streak: 6 }).level, 2);
  assert.equal(iconFxState({ ...climber.build, win_streak: 6 }).level, 0);
  // every AI on the floor goes through addIcon (it does nothing for anyone but an ICON); kings bring their streak
  const s = src('client/js/game/session.js'), park = src('client/js/game/park.js');
  assert.ok(s.includes("else pv.addIcon(this.r, opts.background || this.spectate || !this.game.human ? null"));
  assert.ok(park.includes('e.build = { ...e.build, win_streak: c.kingsStreak || 0 }') && park.includes('e.build = { ...e.build, win_streak: this.myOppStreak }'));
  // the phone: archHTML(e.build) puts the ICON tag on him (iconStatus), and his climb shows on the OVR line
  assert.ok(src('client/js/ui/common.js').includes('export const archHTML = b => (iconStatus(b) ? ICON_TAG'));
  assert.ok(src('client/js/ui/phone.js').includes('e.climb.hof') && src('client/js/ui/phone.js').includes('>= 99 ?'));
});

test('online: the climb travels in his entry, and a lockstep game of ICONs plays the same on every screen', () => {
  const w = world(777, 500), ents = w.ids().filter(x => B.iconStatus(w.entry(x).build)).slice(0, 6).map(x => w.gameEntry(x));
  assert.equal(ents.length, 6);
  const out = setupEntry({ catalog }, ents[0], false);
  assert.ok(B.iconStatus(out.build) && out.build.overall === 99 && out.level > 1);
  const copy = x => JSON.parse(JSON.stringify(x));
  const sig = () => {
    const g = new Game({ mode: 'park', seed: 99, rosters: [ents.slice(0, 3).map(copy), ents.slice(3).map(copy)], catalog, target: 21 });
    for (let i = 0; i < 60 * 30; i++) g.step(1 / 60);
    return JSON.stringify([g.score, g.players.map(p => [p.x.toFixed(4), p.z.toFixed(4), p.stats.pts])]);
  };
  assert.equal(sig(), sig());
});
