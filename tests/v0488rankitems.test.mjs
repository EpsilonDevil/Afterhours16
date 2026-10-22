// v0.4.8.8 The Pro-Am Overhaul, milestone (c) (docs/PROAM-OVERHAUL.md §4): the rank and season items, the rank icon by
// a player's name in every mode, the introduction card's borderplates and banner, and the online entry's Pro-Am line.
//  - The Gold PRO-AM chain and Gold Low-Top Canvas, the Platinum PRO watch and headband: won, not bought (exclusive
//    "proam", never in the store, in the Inventory once won); the season banners are an Inventory-only category.
//  - The tier by the name and the borderplate follow the current tier: an online entry's (entry.proam), else the build's.
//  - entry.proam = {tier, div, record, showRecord, best} is sent again when any of it changes (entryKey).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const catalog = Object.fromEntries(JSON.parse(src('server/catalog.json')).map(i => [i.id, i]));
globalThis.window = globalThis; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, createElement: () => ({ style: {}, getContext: () => null }), documentElement: {}, body: {} };

const R = await import('../client/js/sim/ranks.js');
const B = await import('../client/js/sim/builds.js');
const Bots = await import('../client/js/sim/bots.js');
const { RNG } = await import('../client/js/core/rng.js');
const Art = await import('../client/js/ui/badgeart.js');
const Store = await import('../client/js/ui/store.js');
const Online = await import('../client/js/ui/online.js');
const { settings } = await import('../client/js/core/settings.js');
const { introCards, introHTML } = await import('../client/js/game/present.js');

const RANK_ITEMS = ['pa_chain_gold', 'pa_shoes_gold_canvas', 'pa_watch_platinum', 'pa_headband_platinum'];
const banner = (n, tier) => ({ id: `pa_banner_s${n}_${tier}`, name: `Season Banner: S${n} · ${tier}`, slot: 'banner', category: 'proam', price: 0, exclusive: 'proam', season: n, tier });
const plat = { pa: { index: R.divIndex(3, 2), rp: 30, record: [12, 4], best: 3 } };

test('the rank items: won, not bought, never in the store, and the server hands out exactly these', () => {
  for (const id of RANK_ITEMS) {
    const it = catalog[id];
    assert.ok(it, id);
    assert.equal(it.price, 0); assert.equal(it.exclusive, 'proam');
    assert.equal(B.inStore(it), false, `${id}: not in the store`);
    assert.equal(B.forBuild(it, { icon_badge: null }), true, `${id}: in every build's Inventory once won`);
  }
  assert.equal(B.inStore(banner(1, 'gold')), false);
  const py = src('server/proam.py');
  assert.match(py, /RANK_ITEMS = \{GOLD: \("pa_chain_gold", "pa_shoes_gold_canvas"\), PLATINUM: \("pa_watch_platinum", "pa_headband_platinum"\)\}/);
  assert.equal(catalog.pa_chain_gold.letters, 'PRO-AM');
  assert.equal(catalog.pa_watch_platinum.slot, 'wristband'); assert.equal(catalog.pa_watch_platinum.family, 'watch');
  assert.equal(catalog.pa_shoes_gold_canvas.cut, 'low'); assert.equal(catalog.pa_shoes_gold_canvas.model, 'canvas');
  // no real brands or 2K terms in what players read
  for (const id of RANK_ITEMS) assert.doesNotMatch(`${catalog[id].name} ${catalog[id].description}`, /chuck|taylor|converse|rolex|nike|jordan|2k/i, id);
});

test('the Banners are the Inventory\'s alone; the store never shows them', () => {
  assert.equal(Store.catShown('banner'), false, 'not in the store');
  assert.equal(Store.catShown('banner', { icon_badge: null }), true, 'every build\'s Inventory');
  assert.doesNotMatch(Store.catTabs('top'), /data-cat="banner"/);
  assert.match(Store.catTabs('top', null, { icon_badge: null }), /data-cat="banner"/);
  assert.equal(Store.optionalSlot(banner(1, 'gold')), true, 'a banner comes off');
  assert.match(Store.swatch(banner(2, 'platinum')), /season-banner r3[^"]*"[^>]*><b>S2<\/b><small>PLATINUM<\/small>/);
});

test('the AI never wears a Pro-Am item, and the looks carry the nameplate and the watch', () => {
  for (let seed = 1; seed < 160; seed++) {
    const b = Bots.makeBot(new RNG(seed), { catalog, level: 0.95, position: ['PG', 'SG', 'SF', 'PF', 'C'][seed % 5] });
    for (const id of Object.values(b.build.equipment)) assert.notEqual(catalog[id]?.exclusive, 'proam', `seed ${seed}: ${id}`);
  }
  const season = { id: 'pa_chain_gold_s1', slot: 'chain', color: '#e8c15a', link: 'cuban', pendant: 'plate', letters: 'PRO-AM', stamp: 'S1' };
  const cs = Bots.chainSpec(season);
  assert.deepEqual([cs.pendant, cs.letters, cs.stamp, cs.link], ['plate', 'PRO-AM', 'S1', 'cuban']);
  assert.equal(Bots.chainSpec(catalog.chain_gold).letters, undefined, 'other chains as they were');
  const lk = Bots.resolveLook({ name: 'A B', hand: 'R', equipment: { wristband: 'pa_watch_platinum', chain: 'pa_chain_gold' } }, catalog);
  assert.deepEqual([lk.gear.wristband.watch, lk.gear.wristband.side], [true, 'L'], 'a right-hander wears it on the left');
  assert.equal(Bots.resolveLook({ name: 'A B', hand: 'L', equipment: { wristband: 'pa_watch_platinum' } }, catalog).gear.wristband.side, 'R');
  assert.equal(Bots.resolveLook({ name: 'A B', equipment: { wristband: 'wrist_white' } }, catalog).gear.wristband.watch, undefined);
  assert.equal(lk.gear.chain.pendant, 'plate');
});

test('the rank icon by a name: Silver and up, from the entry or the build; one per call (its own gradient ids)', () => {
  assert.equal(Art.nameRankIcon(0), '', 'Bronze: none');
  assert.equal(Art.nameRankIcon(null), '', 'unknown (the AI): none');
  for (const t of [1, 2, 3, 4, 5, 6]) assert.match(Art.nameRankIcon(t), new RegExp(`class="name-rank r${t}"[\\s\\S]*rank-em r${t}`), `tier ${t} (Diamond and up: the placeholders)`);
  const a = Art.nameRankIcon(3).match(/id="(rk\w+)f"/)[1], b = Art.nameRankIcon(3).match(/id="(rk\w+)f"/)[1];
  assert.notEqual(a, b);
  assert.equal(R.entryRankTier({ proam: { tier: 1, div: 4 }, build: plat }), 1, 'the entry says first');
  assert.equal(R.entryRankTier({ build: plat }), 3);
  // the game's name tags make one per player and keep it while the tier stays (the tags compare their text each frame)
  const ses = src('client/js/game/session.js');
  assert.match(ses, /rankTag\(p\) \{[\s\S]*?if \(!r \|\| r\.tier !== tier\) m\.set\(p\.id, r = \{ tier, html: nameRankIcon\(tier, 13\) \}\);/);
  assert.match(ses, /const rk = names \? this\.rankTag\(p\) : '';/);
});

test('the intro card: the rank icon, the borderplate by the current tier and the banner on', () => {
  const entry = (pa, eq = {}) => ({ build: { name: 'X', position: 'PG', overall: 80, height: 76, archetype: 'playmaker', pa, equipment: eq }, badges: {} });
  const players = [
    { name: 'Plat', human: true, entry: entry(plat.pa, { banner: 'pa_banner_s1_gold' }) },
    { name: 'Gold', entry: entry({ index: R.divIndex(2, 1) }) },
    { name: 'Silv', entry: entry({ index: R.divIndex(1, 5) }) },
    { name: 'AI', entry: { build: { name: 'AI', position: 'C', overall: 70 }, badges: {} } },
    { name: 'Online', entry: { ...entry({ index: 0 }), proam: { tier: 3, div: 1 } } },
  ];
  const session = { game: { mode: 'proam', teams: [players, []] }, teams: [{ name: 'Night Shift', color: '#123' }, { name: 'B' }], app: { config: {}, ai: null, catalog: { pa_banner_s1_gold: banner(1, 'gold') } } };
  const [card] = introCards(session);
  assert.deepEqual(card.players.map(p => p.rank), [3, 2, 1, null, 3]);
  const html = introHTML(card, 0, 2);
  const ps = html.split('class="intro-p ').slice(1);
  assert.match(ps[0], /^me plate-platinum has-banner"/); assert.match(ps[0], /season-banner r2 intro-banner/); assert.match(ps[0], /name-rank r3/);
  assert.match(ps[1], /^\s*plate-gold"/); assert.match(ps[1], /name-rank r2/);
  assert.match(ps[2], /^\s*"/, 'Silver: no plate'); assert.match(ps[2], /name-rank r1/);
  assert.doesNotMatch(ps[3], /name-rank|plate-/, 'the AI: nothing');
  assert.match(ps[4], /^\s*plate-platinum"/, 'an online player\'s entry says his tier');
  const css = src('client/css/menus.css');
  assert.match(css, /\.intro-p\.plate-gold::after[\s\S]*plateSheen/); assert.match(css, /\.intro-p\.plate-platinum::before[\s\S]*platePlat/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.intro-p\.plate-gold::after/);
});

test('the online entry carries the season rank and is sent again when it changes', () => {
  const c = { id: 'c1', name: 'Kaua Lima', overall: 80, equipment: {}, badges: {}, boosts: {}, progression: {}, pa: { ...plat.pa } };
  const app = { char: () => c, look: () => ({}), net: { you: { username: 'kaua' } } };
  settings.paRecord = false;
  assert.deepEqual(Online.myEntry(app).proam, { tier: 3, div: 2, record: [12, 4], showRecord: false, best: 3 });
  const k0 = Online.entryKey(c);
  settings.paRecord = true;
  assert.equal(Online.myEntry(app).proam.showRecord, true);
  assert.notEqual(Online.entryKey(c), k0, 'the record toggle: sent again');
  const k1 = Online.entryKey(c);
  c.pa.record = [13, 4];
  assert.notEqual(Online.entryKey(c), k1, 'a game played: sent again');
  settings.paRecord = false;
  // another player's line, kept to its fields and ranges, goes into the game's roster entry
  assert.deepEqual(Online.cleanProam({ tier: 99, div: -3, record: [-1, 1e9], showRecord: 'yes', best: 2, extra: 1 }), { tier: 6, div: 1, record: [0, 99999], showRecord: false, best: 6 });
  assert.equal(Online.cleanProam(null), null);
  const se = Online.setupEntry({ catalog }, { build: { name: 'P', equipment: {} }, name: 'P', look: {}, proam: { tier: 2, div: 3, record: [1, 2], showRecord: true } }, true, 'p');
  assert.deepEqual(se.proam, { tier: 2, div: 3, record: [1, 2], showRecord: true, best: 2 });
  assert.equal(Online.setupEntry({ catalog }, { build: { name: 'A', equipment: {} }, name: 'A', look: {}, proam: { tier: 3 } }, false).proam, undefined, 'AI entries carry none');
  // the setting
  const scr = src('client/js/ui/screens.js');
  assert.match(scr, /data-k="paRecord"/); assert.match(scr, /'adaptiveGfx', 'paRecord'\]\.includes\(k\)\) v = v === '1';/);
  assert.match(src('client/js/core/settings.js'), /paRecord: false,/);
});
