// v0.4.8.6 quick patch, the ICON Squad park event, the menus' side (ui/squadwatch.js): the Park screen's tag on the park
// a squad of three 99 OVR ICONs is at ("ICON SQUAD HERE · 42 min left", their names, kept current every minute, gone
// when the hour's up), the toast when one shows up (once a squad, never during a game, not at their own park), and the
// phone's purple ICON SQUAD chip. Who, where and when: sim/iconsquad.js and sim/world.js (app.ai.iconSquad / squadOf),
// stood in for here by a fake world.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.window = globalThis; globalThis.addEventListener = () => {};
globalThis.document = { querySelector: () => null, getElementById: () => null, addEventListener() {} };
const S = await import('../client/js/ui/squadwatch.js');
const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const MIN = 60000, T0 = Date.UTC(2026, 9, 20, 12, 17);
const NAMES = { 'ai-3': 'Dre Vance', 'ai-41': 'Kofi Mensah', 'ai-88': 'Lu "Glass" Chen' };
// a fake AI world with one squad window [start, end) at a park
function world({ k = 7, park = 'foundry', start = T0, len = 60 * MIN, ids = ['ai-3', 'ai-41', 'ai-88'] } = {}) {
  const sq = { k, park, start, end: start + len, ids, leader: ids[0], outfit: 'icon_squad_fit', roles: ['handler', 'wing', 'big'] };
  return {
    sq, iconSquad: t => (t >= sq.start && t < sq.end ? sq : null), squadOf: (id, t) => (t >= sq.start && t < sq.end && sq.ids.includes(id) ? sq : null),
    entry: id => ({ name: NAMES[id] || id }),
  };
}

test('the squad on now, its minutes left, the names, who is in it (and nothing breaks without the event)', () => {
  const app = { ai: world() };
  assert.equal(S.squadNow(app, T0 - 1), null);
  assert.equal(S.squadNow(app, T0).park, 'foundry');
  assert.equal(S.minutesLeft(app.ai.sq, T0 + 18 * MIN), 42);
  assert.equal(S.minutesLeft(app.ai.sq, T0 + 60 * MIN - 5000), 1, 'never "0 min"');
  assert.deepEqual(S.squadNames(app, app.ai.sq), ['Dre Vance', 'Kofi Mensah', 'Lu "Glass" Chen']);
  assert.ok(S.inSquadNow(app, 'ai-41', T0 + MIN)); assert.ok(!S.inSquadNow(app, 'ai-2', T0 + MIN)); assert.ok(!S.inSquadNow(app, 'ai-41', T0 + 61 * MIN));
  // a world without squadOf: the squad's ids; no world, a world without the event, one that throws: nothing
  assert.ok(S.inSquadNow({ ai: { iconSquad: app.ai.iconSquad } }, 'ai-88', T0 + MIN));
  for (const a of [{}, { ai: {} }, { ai: { iconSquad: () => { throw new Error('x'); } } }, null]) { assert.equal(S.squadNow(a, T0), null); assert.equal(S.inSquadNow(a, 'ai-3', T0), false); }
  assert.equal(S.parkName('foundry'), 'Foundry Works'); assert.equal(S.parkName('harbor'), 'Harbor Point'); assert.equal(S.parkName('brick'), 'Old Brick Yard');
});

// a stub Park screen: the three park cards (.aff[data-park]); what the tag code adds to a card is kept on it
function parkScreen() {
  const wraps = [];
  const card = park => ({ park, cls: new Set(), added: [],
    classList: { add(c) { this.o.cls.add(c); }, remove(c) { this.o.cls.delete(c); }, o: null },
    insertAdjacentHTML(pos, html) { const w = { html, card: this, remove() { wraps.splice(wraps.indexOf(w), 1); this.card.added = this.card.added.filter(x => x !== w); } }; wraps.push(w); this.added.push(w); } });
  const cards = ['harbor', 'brick', 'foundry'].map(card); cards.forEach(c => { c.classList.o = c; });
  const root = { isConnected: true, cards,
    querySelector: s => cards.find(c => s === `.aff[data-park="${c.park}"]`) || null,
    querySelectorAll: s => (s === '[data-squad-wrap]' ? [...wraps] : s === '.aff.has-squad' ? cards.filter(c => c.cls.has('has-squad')) : []) };
  return root;
}

test('the Park screen: the park they are at says ICON SQUAD HERE · N min left, their names under it; kept current every minute, gone at the end', () => {
  const app = { ai: world() };
  const root = parkScreen();
  let t = T0 + 18 * MIN, tick = null, cleared = false;
  const stop = S.mountSquadTags(app, root, { now: () => t, setI: (f, ms) => { assert.equal(ms, 60000); tick = f; return 1; }, clearI: () => { cleared = true; } });
  const [harbor, brick, foundry] = root.cards;
  assert.equal(foundry.added.length, 1);
  assert.ok(foundry.cls.has('has-squad'));
  assert.ok(!harbor.added.length && !brick.added.length);
  const html = foundry.added[0].html;
  assert.ok(html.includes('<span class="squad-tag" data-squad-tag title="Dre Vance · Kofi Mensah · Lu &quot;Glass&quot; Chen">ICON SQUAD HERE · 42 min left</span>'), html);
  assert.ok(html.includes('<small class="squad-names">Dre Vance · Kofi Mensah · Lu &quot;Glass&quot; Chen</small>'), 'the names under it (escaped)');
  t += 5 * MIN; tick();
  assert.equal(foundry.added.length, 1, 'redrawn, not added twice');
  assert.ok(foundry.added[0].html.includes('ICON SQUAD HERE · 37 min left'));
  t = T0 + 60 * MIN; tick();
  assert.equal(foundry.added.length, 0, 'the hour is up: gone');
  assert.ok(!foundry.cls.has('has-squad'));
  // the screen gone: the minute ticker stops by itself
  root.isConnected = false; tick(); assert.ok(cleared);
  cleared = false; stop(); assert.ok(cleared);
  // no squad on: nothing drawn
  const r2 = parkScreen();
  S.mountSquadTags(app, r2, { now: () => T0 - MIN, setI: () => 1, clearI: () => {} });
  assert.ok(r2.cards.every(c => !c.added.length));
  // the Park screen mounts it (and only once, however often it redraws itself)
  assert.match(src('client/js/ui/modes.js'), /root\._squadStop\?\.\(\); root\._squadStop = Squad\.mountSquadTags\(app, root\);/);
});

test('the toast: once a squad, "just showed up" at first and how long after that, never during a game, not at their own park', () => {
  store.clear();
  const said = [];
  const app = { ai: world(), profile: {}, mode: 'menu', world: null };
  let t = T0 + 2 * MIN, tick = null;
  const watch = S.watchSquads(app, { now: () => t, say: (text, sq) => said.push([text, sq.k]), setI: (f, ms) => { assert.equal(ms, 25000); tick = f; return 1; }, clearI: () => {} });
  tick();
  assert.deepEqual(said, [['An ICON squad just showed up at Foundry Works', 7]]);
  t += MIN; tick(); t += 20 * MIN; tick();
  assert.equal(said.length, 1, 'once a squad');
  // the next squad (another window, another park), seen only after its first 5 minutes: how long they're on for
  app.ai = world({ k: 8, park: 'harbor', start: T0 + 12 * 60 * MIN });
  t = T0 + 12 * 60 * MIN + 18 * MIN; tick();
  assert.deepEqual(said.at(-1), ['An ICON squad is running at Harbor Point · on for 42 more min', 8]);
  // during a game: not looked at, and said once the game's over (still on)
  app.ai = world({ k: 9, park: 'brick', start: T0 + 24 * 60 * MIN });
  t = T0 + 24 * 60 * MIN + MIN;
  for (const [mode, w] of [['match', null], ['park', { mode: 'match', themeId: 'harbor' }], ['park', { mode: 'starting', themeId: 'harbor' }]]) { app.mode = mode; app.world = w; assert.equal(watch.check(), null); }
  assert.equal(said.length, 2);
  app.mode = 'park'; app.world = { mode: 'roam', themeId: 'harbor' }; // (back walking around another park)
  assert.equal(watch.check(), 'An ICON squad just showed up at Old Brick Yard');
  // at their park already: the park shows them arriving; no toast (and none later for that squad)
  app.ai = world({ k: 10, park: 'foundry', start: T0 + 36 * 60 * MIN });
  t = T0 + 36 * 60 * MIN + MIN; app.world = { mode: 'roam', themeId: 'foundry' };
  assert.equal(watch.check(), null);
  app.mode = 'menu'; app.world = null; assert.equal(watch.check(), null, 'not said later either');
  assert.equal(said.length, 3);
  // a reload in the same hour doesn't say it again (kept in the browser), and no world / no profile: nothing
  const again = S.watchSquads(app, { now: () => t, say: text => said.push([text]), setI: () => 1, clearI: () => {} });
  app.ai = world({ k: 9, park: 'brick', start: T0 + 24 * 60 * MIN }); t = T0 + 24 * 60 * MIN + 30 * MIN;
  assert.equal(again.check(), null);
  assert.equal(S.watchSquads({ profile: {}, mode: 'menu' }, { setI: () => 1 }).check(), null);
  assert.equal(S.watchSquads({ ai: world(), mode: 'menu' }, { now: () => T0, setI: () => 1 }).check(), null, 'not signed in yet');
  assert.equal(S.arrivalText(world().sq, T0 + 4 * MIN), 'An ICON squad just showed up at Foundry Works');
});

test('wired in: main.js starts the watcher once after sign-in (a purple toast); the phone has the chip; the styles are ICON purple', () => {
  const main = src('client/js/main.js');
  assert.match(main, /import \{ watchSquads \} from '\.\/ui\/squadwatch\.js';/);
  assert.match(main, /if \(!app\.squadWatch\) \{ app\.squadWatch = watchSquads\(app, \{ say: text => toast\(text, 'squad'\) \}\); setTimeout\(\(\) => app\.squadWatch\.check\(\), 10000\); \}/);
  assert.match(src('client/js/ui/squadwatch.js'), /export function watchSquads\(app, \{ every = 25000,/, 'a light ticker: every 25 s');
  const phone = src('client/js/ui/phone.js');
  assert.ok(phone.includes("${Squad.inSquadNow(app, id) ? ' ' + Squad.SQUAD_CHIP : ''}</b><small>${sub(e)}</small>"), 'the chip on a member\'s row');
  assert.ok(phone.includes('row(m.id, Squad.inSquadNow(app, m.id) ? statusOf(m.id).text :'), 'Recent: his squad status instead of the history');
  assert.ok(phone.includes("${Squad.inSquadNow(app, id) ? ' ' + Squad.SQUAD_CHIP : ''}</h3>"), 'and on his profile');
  assert.equal(S.SQUAD_CHIP, '<i class="ph-chip squad" title="Running with this hour\'s ICON squad">ICON SQUAD</i>');
  const css = src('client/css/menus.css');
  for (const sel of ['.squad-tag', '.toast.squad', '.ph-chip.squad', '.aff.has-squad']) assert.match(css, new RegExp(sel.replace(/\./g, '\\.') + ' \\{[^}]*166,59,255'), sel);
  assert.match(css, /\.toast\.squad::before \{ content: 'ICON SQUAD';/);
});
