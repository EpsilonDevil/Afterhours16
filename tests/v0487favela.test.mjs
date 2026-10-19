// v0.4.8.7 The Favelas in the client's lists and the AI world: an event park like the others (its own card, colours,
// style, streak and prize line), the regular park playlist (no soundtrack of its own), the court's look, and the AI
// world sending the event's entrants there once it's on. (The park itself: v0487favelapark.test.mjs.)
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THEMES, EVENTS, parkInfo } from '../client/js/world/themes.js';
import { AIWorld, cupWindow, cupEntrant, EVENT_PARKS, PARK_NAMES, setEventVenue, setEventSchedule, eventVenueAt } from '../client/js/sim/world.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const json = f => JSON.parse(src(f));

test('the Favelas is an event park like the others, with its own card, colours, style, streak and prize line', () => {
  const e = EVENTS.favela;
  assert.ok(e && e.event && e.exclusive === 'favela' && e.park === 'The Favelas' && e.name === 'The Favelas');
  assert.equal(e.prize, 'the Morro Kit'); assert.equal(e.enter, 'Enter the Favelas'); assert.equal(e.eyebrow, 'THE FAVELAS');
  assert.match(e.blurb, /hillside/); assert.match(e.blurb, /48-hour leaderboard/);
  assert.equal(parkInfo('favela'), e);
  const t = THEMES.favela;
  assert.ok(t.event && t.kind === 'park' && t.style === 'favela' && t.streakFx === 'pipa');
  assert.equal(t.music, undefined, 'the regular park playlist: no soundtrack of its own');
  assert.ok(!fs.existsSync(new URL('../client/audio/favela', import.meta.url)), 'and no audio folder');
  // every style and streak an event park has is its own
  const events = Object.values(THEMES).filter(x => x.event);
  assert.equal(new Set(events.map(x => x.style)).size, events.length);
  assert.equal(new Set(events.map(x => x.streakFx)).size, events.length);
  // the court: a painted community court, the kite crest, the name on the baselines, the tile frame
  const c = t.court;
  assert.equal(c.surface, 'asphalt'); assert.equal(c.logo.shape, 'pipa'); assert.equal(c.baselineText, 'THE FAVELAS'); assert.ok(c.favela && c.favela.count > 20 && c.favela.tiles.length === 2);
  // golden hour: the sun low in the west, warm; no floodlights
  assert.ok(t.sunset.el > 2 && t.sunset.el < 12 && t.sun.dir[0] < -0.6 && !t.floodlights);
  assert.ok(t.sun.color[0] > t.sun.color[2] * 1.5, 'warm light');
});

test('the AI world knows the park, and sends the entrants there once it\'s on (and nobody before)', () => {
  assert.ok(EVENT_PARKS.has('favela')); assert.equal(PARK_NAMES.favela, 'The Favelas');
  for (const id of ['kingtut', 'jungle', 'beat', 'monster']) assert.ok(EVENT_PARKS.has(id) && PARK_NAMES[id], `${id} is still there`);
  const t = Date.now(), ids = Array.from({ length: 900 }, (_, i) => 'ai-' + i), world = new AIWorld({ seed: 4242, born: t }, {});
  const count = park => { let n = 0, wrong = 0; for (let h = 0; h < 24; h += 2) for (const id of ids) { const s = world.status(id, t + h * 3600000); if (s?.park === park) { n++; if (!cupEntrant(id, cupWindow(t + h * 3600000))) wrong++; } } return [n, wrong]; };
  setEventVenue('favela');
  const [n, wrong] = count('favela');
  assert.ok(n > 20 && wrong === 0, `entrants at the Favelas (${n})`);
  assert.equal(count('monster')[0], 0, 'nobody at the closed Mash');
  setEventVenue('monster');
  assert.equal(count('favela')[0], 0, 'before the handover the Favelas is empty');
  // on the server's schedule: the Mash until the handover, the Favelas from it
  const H = Date.UTC(2026, 9, 20) / 1000;
  setEventSchedule([{ event: 'monster', venue: 'monster', from: H - 48 * 3600, until: H }, { event: 'favela', venue: 'favela', from: H, until: null }], Date.now() / 1000);
  assert.equal(eventVenueAt(H * 1000 - 60000), 'monster'); assert.equal(eventVenueAt(H * 1000 + 60000), 'favela');
  setEventVenue(null);
});

test('the server knows the venue (a park, an event, no affiliation)', () => {
  const v = json('server/venues.json').find(x => x.id === 'favela');
  assert.deepEqual(v, { id: 'favela', kind: 'park', name: 'The Favelas', affiliation: null, event: true });
});

test('the park is built additively: the other parks\' branches are untouched and the Favelas has its own', () => {
  const v = src('client/js/world/venues.js'), p = src('client/js/world/parklife.js'), s = src('client/js/world/streakfx.js'), tx = src('client/js/gfx/textures.js');
  assert.ok(v.includes("theme.style === 'favela') favelaGround(") && v.includes("theme.style === 'favela') ({ board, scenery } = favelaScenery(") && v.includes("T.favelaMural()"));
  assert.ok(p.includes("theme.style === 'favela'") && p.includes('favelaEvents(') && p.includes('get favela()'));
  assert.ok(s.includes("kind === 'pipa') this.buildPipa(court)") && s.includes("this.kind === 'pipa') return this.updatePipa(dt)"));
  assert.ok(tx.includes("shape === 'pipa'") && tx.includes('favelaApron(') && tx.includes('favelaLettering('));
  // the Mash, the Beat and the rest keep theirs
  for (const k of ["horrorGround(ctx, scene, theme)", "retroGround(ctx, scene, theme)", "horrorScenery(", "retroScenery("]) assert.ok(v.includes(k), k);
});
