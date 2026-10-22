// v0.4.8.9 The Gauntlet, the Server/UI side on the client (docs/GAUNTLET.md §12):
//  - Park cards: the account's (from Gauntlet sacrifices), on every build, in park games only (event parks too), the same on
//    every screen: in the entry (ui/online.js myEntry / setupEntry: parkCards; and on the build: park_cards) and applied
//    where the Player builds his ratings (sim/player.js applyParkCards), keyed on a park game at a park (Game
//    cfg.parkCards, the session's from its venue). Never Pro-Am, the Pro Run or the Crew HQ.
//  - MyPLAYER: the "Account Park Cards" row, and the sacrifice screen (ui/sacrifice.js): who can go, the warning, the tier
//    it brings, the 5-second hold; the card revealed after.
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

const { Game } = await import('../client/js/sim/game.js');
const { makeTeam } = await import('../client/js/sim/bots.js');
const { RNG } = await import('../client/js/core/rng.js');
const { ICON_BADGES } = await import('../client/js/sim/badges.js');
const { ATTRS } = await import('../client/js/sim/ratings.js');
const Online = await import('../client/js/ui/online.js');
const S = await import('../client/js/ui/sacrifice.js');
const { settings } = await import('../client/js/core/settings.js');

const CARDS = [{ attr: 'three_point', pct: 0.05 }, { attr: 'speed', pct: 0.03 }];
function game(mode, parkCards, cards = CARDS, where = 'entry') {
  const rng = new RNG(11);
  const t0 = makeTeam(rng, 3, { catalog, level: 0.7 }), t1 = makeTeam(rng, 3, { catalog, level: 0.7 });
  t0[0].human = true;
  if (where === 'entry') t0[0].parkCards = cards; else t0[0].build = { ...t0[0].build, park_cards: cards };
  const g = new Game({ mode, seed: 5, rosters: [t0, t1], catalog, parkCards, quarterLen: 120, quarters: 4 });
  return { g, me: g.players[0] };
}

test('park cards play in park games at a park, from the entry or the build, and nowhere else', () => {
  for (const where of ['entry', 'build']) {
    const { g, me } = game('park', true, CARDS, where);
    assert.equal(g.parkCards, true);
    assert.ok(me.ratings.three_point > game('park', false).me.ratings.three_point, where); // (what he plays with: up)
    assert.ok(Math.abs(me.played.three_point - me.raw.three_point * 1.05) < 1e-9);
    assert.ok(Math.abs(me.played.speed - me.raw.speed * 1.03) < 1e-9);
    assert.equal(me.raw.three_point, g.players[0].entry.build.attributes.three_point, 'raw (gating) untouched');
    assert.deepEqual(g.players.slice(1).map(p => p.played), g.players.slice(1).map(() => undefined), 'only his own cards');
  }
  // not a park game, or not at a park (the Crew HQ, a Pro-Am park): nothing
  for (const [mode, flag] of [['proam', true], ['park', false], ['practice', true]]) {
    const { g, me } = game(mode, flag);
    assert.equal(g.parkCards, false, `${mode} ${flag}`);
    assert.equal(me.played, undefined);
  }
  // the speed card reaches the physics (the same way an Icon's % does)
  const a = game('park', true).me, b = game('park', false).me;
  assert.ok(a.phys.maxSpeed > b.phys.maxSpeed || a.phys.speed > b.phys.speed || JSON.stringify(a.phys) !== JSON.stringify(b.phys));
});

test('the game checks the cards itself: a known attribute, 1, 3 or 5%, three at most', () => {
  const { me } = game('park', true, [{ attr: 'three_point', pct: 0.5 }, { attr: 'nonsense', pct: 0.05 }, null, { attr: 'steal', pct: 0.01 }]);
  assert.deepEqual(me.parkCards, [{ attr: 'steal', pct: 0.01 }]);
  const many = game('park', true, Array(5).fill({ attr: 'block', pct: 0.05 })).me;
  assert.equal(many.parkCards.length, 3);
  assert.equal(game('park', true, 'x').me.played, undefined);
});

test('the session turns them on for a park venue only; the watched local games too', () => {
  const ses = src('client/js/game/session.js'), park = src('client/js/game/park.js'), g = src('client/js/sim/game.js');
  assert.match(ses, /parkCards: opts\.mode === 'park' && this\.venue\?\.theme\?\.kind === 'park',/);
  assert.match(park, /multi: false, inputDelay: 0, parkCards: this\.venue\.theme\?\.kind === 'park' \}\);/);
  assert.match(g, /this\.parkCards = !!cfg\.parkCards && cfg\.mode === 'park';\n\s+if \(this\.parkCards\) for \(const p of this\.players\) p\.applyParkCards\(p\.entry\.parkCards \|\| p\.entry\.build\?\.park_cards\);/);
});

test('the online entry carries them (and goes out again when they change)', () => {
  const c = { id: 'c1', name: 'Kaua', overall: 90, equipment: {}, badges: {}, boosts: {}, progression: {}, park_cards: [{ attr: 'steal', pct: 0.03 }, { attr: 'x', pct: 0.2 }] };
  const app = { char: () => c, look: () => ({}), net: { you: { username: 'k' } } };
  assert.deepEqual(Online.myEntry(app).parkCards, [{ attr: 'steal', pct: 0.03 }]);
  const k0 = Online.entryKey(c);
  c.park_cards = [...c.park_cards, { attr: 'block', pct: 0.05 }];
  assert.notEqual(Online.entryKey(c), k0);
  const e = Online.setupEntry({ catalog }, { build: { name: 'P', equipment: {} }, name: 'P', look: {}, parkCards: [{ attr: 'block', pct: 0.05 }, { attr: 'y', pct: 9 }] }, true, 'p');
  assert.deepEqual(e.parkCards, [{ attr: 'block', pct: 0.05 }]);
  assert.equal(Online.setupEntry({ catalog }, { build: { name: 'A', equipment: {} }, name: 'A', look: {}, parkCards: CARDS }, false).parkCards, undefined, 'never on an AI player');
});

test('the attributes a park card can land on: the Icon badge\'s list, the same as the server\'s', () => {
  const py = src('server/gauntlet.py');
  for (const icon of Object.keys(ICON_BADGES)) {
    const mine = S.parkCardStats(icon);
    if (icon === 'the_general') { assert.deepEqual(mine.sort(), [...ATTRS].sort()); assert.match(py, /"the_general": tuple\(builds\.ATTRIBUTES\)/); continue; }
    const m = py.match(new RegExp(`"${icon}": \\(([^)]*)\\)`));
    assert.ok(m, icon);
    assert.deepEqual(mine, m[1].split(',').map(x => x.trim().replace(/"/g, '')).filter(Boolean), icon);
    if (icon !== 'sharp_eye') assert.deepEqual(mine, Object.keys(ICON_BADGES[icon].stats));
  }
  assert.deepEqual(S.parkCardStats('sharp_eye'), ['three_point', 'mid_range']);
});

const icon99 = (over = {}) => ({ id: 'b1', name: 'Big Kaua', overall: 99, position: 'PG', archetype: 'playmaker', height: 75, icon_badge: 'oprah', icon_status: true, rep: { label: 'Legend' }, ...over });
const appWith = (unlocks, cards = [], chars = [icon99()]) => ({ profile: { characters: chars, gauntlet_unlocks: unlocks, park_cards: cards, balance: 1000 }, config: { icon_badges: { oprah: { name: 'Oprah' } } }, input: { usingPad: false } });

test('MyPLAYER: the Account Park Cards row', () => {
  const ready = { completed: 1, distinctCompleted: 1, sacrificesDone: 0, next: { n: 1, tier: 'common', pct: 0.01, needs: { completed: 1, distinct: 0 }, have: { completed: 1, distinct: 1 }, ready: true } };
  let h = S.parkCardsRowHTML(appWith(ready));
  assert.match(h, /ACCOUNT PARK CARDS/); assert.match(h, /None yet/); assert.match(h, /NEXT SACRIFICE · COMMON \+1%/); assert.match(h, /1\/1 completed Gauntlet run</); assert.match(h, /Ready/);
  const later = { completed: 2, distinctCompleted: 1, sacrificesDone: 1, next: { n: 2, tier: 'rare', pct: 0.03, needs: { completed: 3, distinct: 3 }, have: { completed: 2, distinct: 1 }, ready: false } };
  h = S.parkCardsRowHTML(appWith(later, [{ n: 1, tier: 'common', attr: 'pass_accuracy', pct: 0.01, name: 'Big Kaua' }]));
  assert.match(h, /park-card t-common[^>]*><b>\+1%<\/b><span>Pass Accuracy<\/span>/);
  assert.match(h, /2\/3 completed Gauntlet runs · 1\/3 different players/);
  assert.doesNotMatch(h, /Ready/);
  h = S.parkCardsRowHTML(appWith({ completed: 9, distinctCompleted: 4, sacrificesDone: 3, next: null }, [1, 2, 3].map(n => ({ n, tier: ['common', 'rare', 'legendary'][n - 1], attr: 'steal', pct: [0.01, 0.03, 0.05][n - 1] }))));
  assert.match(h, /All three done/); assert.equal((h.match(/class="park-card /g) || []).length, 3);
  const mp = src('client/js/ui/myplayer.js');
  assert.match(mp, /<p class="muted small">Your players share one VC wallet and locker\.<\/p>\$\{parkCardsRowHTML\(app\)\}/);
  assert.match(mp, /\$\{canSacrifice\(ch\) \? `<button class="pc-sac" data-sac="\$\{ch\.id\}"/);
});

test('the sacrifice screen: who can go, the warning, the tier it brings, the hold', () => {
  const ready = { completed: 3, distinctCompleted: 3, sacrificesDone: 1, next: { n: 2, tier: 'rare', pct: 0.03, needs: { completed: 3, distinct: 3 }, have: { completed: 3, distinct: 3 }, ready: true } };
  let h = S.sacrificeHTML(appWith(ready), icon99());
  assert.match(h, /Sacrifice Big Kaua\?/);
  assert.match(h, /leaves the park for good\.<\/b> The build is gone from your players and its slot is freed/);
  assert.match(h, /park-card t-rare"><b>\+3%<\/b><span>Ball Handle or Speed w\/ Ball or Pass Accuracy<\/span><small>RARE PARK CARD/);
  assert.match(h, /data-hold/); assert.match(h, /Hold <kbd>Enter<\/kbd> \(or click and hold\) to sacrifice/); assert.match(h, />5<\/b>/);
  // not ready: no hold, what's missing
  const notYet = { ...ready, next: { ...ready.next, have: { completed: 3, distinct: 2 }, ready: false } };
  h = S.sacrificeHTML(appWith(notYet), icon99());
  assert.doesNotMatch(h, /data-hold/); assert.match(h, /Not yet: the next sacrifice needs 3\/3 completed Gauntlet runs · 2\/3 different players/);
  // not an ICON
  h = S.sacrificeHTML(appWith(ready), icon99({ icon_status: false, overall: 92 }));
  assert.doesNotMatch(h, /data-hold/); assert.match(h, /isn't an ICON 99 build/);
  assert.equal(S.canSacrifice(icon99()), true); assert.equal(S.canSacrifice(icon99({ icon_status: false })), false); assert.equal(S.canSacrifice(icon99({ icon_badge: null })), false);
  // all three done
  h = S.sacrificeHTML(appWith({ ...ready, sacrificesDone: 3, next: null }), icon99());
  assert.match(h, /All three sacrifices are done/); assert.doesNotMatch(h, /data-hold/);
  // The General: any attribute
  h = S.sacrificeHTML(appWith(ready), icon99({ icon_badge: 'the_general', archetype: 'two_way' }));
  assert.match(h, /<span>any attribute<\/span>/);
  // the other builds that can go are named
  h = S.sacrificeHTML(appWith(ready, [], [icon99(), icon99({ id: 'b2', name: 'Second Icon' })]), icon99());
  assert.match(h, /Your other builds that can go: Second Icon/);
  // the reveal
  h = S.revealHTML({ tier: 'legendary', attr: 'three_point', pct: 0.05 }, 'Big Kaua');
  assert.match(h, /NEW PARK CARD/); assert.match(h, /<h2>Legendary<\/h2>/); assert.match(h, /<b>\+5%<\/b><span>Three-Point<\/span>/);
  // the hold is ui/hold.js's, posting the server's sacrifice
  const sac = src('client/js/ui/sacrifice.js');
  assert.match(sac, /new HoldGate\(/); assert.match(sac, /app\.api\.mutate\('\/api\/gauntlet\/sacrifice', \{ character_id: c\.id \}\)/);
});

test('after the sacrifice: the profile from the server\'s answer, the card revealed', () => {
  const app = appWith({ next: null }, [], [icon99(), icon99({ id: 'b2', name: 'Two' })]);
  app.selectedId = 'b1'; app.api = {};
  const went = [];
  const shown = [];
  globalThis.document.querySelector = () => null;
  const res = { characters: [icon99({ id: 'b2', name: 'Two' })], build_slots: { unlocked: 5, used: 1 }, unlocks: { sacrificesDone: 1, next: null }, card: { n: 1, tier: 'common', attr: 'steal', pct: 0.01 } };
  try { S.afterSacrifice(app, icon99(), res, { go: (a, s, p) => went.push([s, p]) }); } catch (e) { shown.push(String(e)); }
  assert.deepEqual(app.profile.characters.map(c => c.id), ['b2']);
  assert.equal(app.selectedId, 'b2'); assert.equal(settings.character, 'b2');
  assert.deepEqual(app.profile.park_cards.map(k => k.attr), ['steal']);
  assert.deepEqual(went[0], ['myplayer', { tab: 'players' }]);
});
