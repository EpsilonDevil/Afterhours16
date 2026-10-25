// v0.4.8.8 The Pro-Am Overhaul: the Server/UI side of the Pro-Am HUB (game/proamhub.js) and the real-vs-real games.
//  - ui/proamui.js: the hub's entry point (openOffice, queue, load, render).
//  - The Pro-Am tab: "Go to the HUB"; view 'start' for a player with no team (the hub sends him there).
//  - Gold customization in the founder's settings (team.custom: floor, walls, logo, colors), the same choices as the hub's.
//  - "the Pro-Am HUB" for hq:pa: places.
//  - A real team against a real team: one online game the home Captain starts, each team's own series game in it.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
globalThis.window = globalThis; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, createElement: () => ({ style: {}, getContext: () => null }), documentElement: {}, body: {} };

const Online = await import('../client/js/ui/online.js');
const P = await import('../client/js/ui/proam.js');
const UI = await import('../client/js/ui/proamui.js');
const { HUB_FLOORS, HUB_LOGOS } = await import('../client/js/world/proamhubs.js');

test('ui/proamui.js is the hub\'s entry point', () => {
  for (const k of ['openOffice', 'queue', 'load', 'render']) assert.equal(typeof UI[k], 'function', k);
  assert.equal(UI.openOffice, P.openOffice); assert.equal(UI.queue, P.queue);
  const hub = src('client/js/game/proamhub.js');
  assert.match(hub, /import\('\.\.\/ui\/proamui\.js'\)/);
  assert.match(hub, /U\.openOffice\(this\.app, this\.team, panel, \{ captain, humans: [^}]*members: this\.membersHere\(\), onChange/);
});

test('the Pro-Am tab: Go to the HUB, and view start for a player with no team', () => {
  const p = src('client/js/ui/proam.js');
  assert.match(p, /data-hub>Go to the HUB<\/button>/);
  assert.match(p, /import\('\.\.\/game\/proamhub\.js'\)\.then\(m => m\.enterHub\(app, \{ from: 'menu' \}\)\)/);
  assert.match(p, /let view = params\.view \|\| \(st\.team \? 'team' : 'start'\)/);
  assert.match(p, /if \(view === 'team' && !st\.team\) view = 'start';/);
  assert.match(src('client/js/game/proamhub.js'), /S\.go\(app, 'proam', \{ view: 'start' \}\)/);
});

test('Gold customization: the same choices the hub paints, the founder\'s from Gold up', () => {
  assert.deepEqual(P.CUSTOM_FLOORS.map(x => x[0]).sort(), Object.keys(HUB_FLOORS).sort());
  const py = src('server/proam.py');
  assert.match(py, /CUSTOM_FLOORS = \("natural", "honey", "ebony", "whitewash", "slate"\)/);
  assert.match(py, /CUSTOM_WALLS = \("brick", "block", "panel", "concrete", "team"\)/);
  assert.deepEqual(P.CUSTOM_WALLS.map(x => x[0]), ['brick', 'block', 'panel', 'concrete', 'team']);
  assert.deepEqual(py.match(/^LOGOS = \(([^)]*)\)/m)[1].split(', ').map(s => s.replace(/"/g, '')), HUB_LOGOS);
  assert.equal(P.canCustomize({ division: { tier: 1 } }), false);
  assert.equal(P.canCustomize({ division: { tier: 2 } }), true);
  // the settings panel sends it with the rest, and the hub repaints on the save (opts.onChange)
  const p = src('client/js/ui/proam.js');
  assert.match(p, /team: \{ \.\.\.readSettings\(card\), \.\.\.readCustom\(card\) \} \}\); toast\('Team saved\.'\); closeModal\(\); opts\.onChange\?\.\(\);/);
});

test('"the Pro-Am HUB" for its places', () => {
  assert.equal(Online.parkName('hq:pa:abc'), 'the Pro-Am HUB');
  assert.equal(Online.parkName('hq:crew1'), 'a Crew HQ');
  assert.equal(Online.parkName(null), 'somewhere');
});

test('real vs real: one online game, the home Captain starts it, each team\'s own series game', () => {
  const p = src('client/js/ui/proam.js'), m = src('client/js/ui/modes.js');
  assert.match(p, /if \(g\.opponent\.kind === 'team' && g\.match && app\.net\?\.connected\) \{\s*const how = await realVsReal/);
  assert.match(p, /if \(g\.home\) \{[\s\S]*?Online\.paEntries\(app, ids\)[\s\S]*?Modes\.startProamVs\(app, ctx, r\.other, people\)/);
  // the setup carries both teams' series games and ratings; each screen's ticket takes its own team's
  // (qp6: each one the team's service's game, for players online through it; a screen whose own service keeps the series takes {series, n})
  assert.match(m, /pa: \[P\.paTicketGame\(app, series, game, team, null, true\), P\.paTicketGame\(app, \{ id: vs\.series,/);
  assert.match(m, /opp_ratings: \[paOppRating\(opponent\), paOppRating\(\{ div: series\.div \}\)\]/);
  assert.match(m, /const paGame = Array\.isArray\(setup\.pa\) \? setup\.pa\[myTeam\] : setup\.pa/);
  assert.match(m, /const myPa = paGame && !P\.paRemote\(app\) \? \{ series: paGame\.series, n: paGame\.n \} : paGame;/);
  assert.match(m, /\.\.\.\(myPa \? \{ pa_game: myPa \} : \{\}\)/);
  assert.match(src('server/online.py'), /elif t == "pa-entries":/);
});
