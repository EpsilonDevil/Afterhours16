// v0.4.8.5 quick patch 2: The Monster Mash on the schedule and in the client's lists. It takes over from And The Beat
// Goes On at the end of the Beat's window (2026-10-16 00:00 UTC); the Beat, the Jungle and the King Tut Cup stay whole,
// just off the schedule. (The park itself: v0485monsterpark.test.mjs; the rewards: v0485monsteritems.test.mjs.)
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THEMES, EVENTS, parkInfo } from '../client/js/world/themes.js';
import { AIWorld, cupWindow, cupEntrant, EVENT_PARKS, PARK_NAMES, setEventVenue } from '../client/js/sim/world.js';
import { PLAYLISTS } from '../client/js/core/music.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const json = f => JSON.parse(src(f));
const HANDOVER = 1792108800; // 2026-10-16 00:00 UTC

test('the Monster Mash is an event park like the others, with its own card, colours and prize line', () => {
  const e = EVENTS.monster;
  assert.ok(e && e.event && e.exclusive === 'monster' && e.park === 'The Monster Mash' && e.enter && e.prize && e.eyebrow);
  assert.equal(e.prize, 'the Bone Suit'); assert.equal(e.enter, 'Enter the Mash');
  assert.equal(parkInfo('monster'), e);
  assert.ok(THEMES.monster.event && THEMES.monster.kind === 'park' && THEMES.monster.style === 'horror' && THEMES.monster.streakFx === 'haunt');
  assert.ok(EVENT_PARKS.has('monster'));
  assert.equal(PARK_NAMES.monster, 'The Monster Mash');
  // every style and streak an event park has is its own
  const events = Object.values(THEMES).filter(t => t.event);
  assert.equal(new Set(events.map(t => t.style)).size, events.length);
  assert.equal(new Set(events.map(t => t.streakFx)).size, events.length);
  // no mix was supplied for it: the main soundtrack plays there (only the Beat brings its own, and only at its park)
  assert.equal(THEMES.monster.music, undefined);
  assert.ok(!PLAYLISTS.monster);
  assert.deepEqual(Object.values(THEMES).filter(t => t.music).map(t => t.id), ['beat']);
});

test('the schedule: the Beat runs its full 48 hours, then the Mash; nothing of the Beat is deleted', () => {
  const sched = json('server/events.json').schedule;
  assert.deepEqual(sched.map(s => [s.event, s.from, s.until]), [['kingtut', null, 1791763200], ['jungle', 1791763200, 1791936000], ['beat', 1791936000, HANDOVER], ['monster', HANDOVER, null]]);
  assert.equal(HANDOVER - 1791936000, 48 * 3600);
  assert.equal((HANDOVER - 1767225600) % (48 * 3600), 0, 'the handover is on a window boundary');
  assert.equal(new Date(HANDOVER * 1000).toISOString(), '2026-10-16T00:00:00.000Z');
  const venues = json('server/venues.json');
  for (const id of ['kingtut', 'jungle', 'beat', 'monster']) assert.ok(venues.some(v => v.id === id && v.event && v.kind === 'park'), id);
  // the server knows the event and its prizes, and the store refuses to sell them
  const cup = src('server/cup.py');
  assert.ok(cup.includes('PRIZES_MONSTER = (') && cup.includes('"King of the Mash"') && cup.includes('"played": "Played the Mash"'));
  assert.ok(src('server/app.py').includes('Monster Mash exclusive. Win it at the Monster Mash.'));
  // the Beat is all still here: its theme, park, rewards and soundtrack
  assert.ok(THEMES.beat && EVENTS.beat && THEMES.beat.music === 'beat' && PLAYLISTS.beat);
  assert.ok(fs.existsSync(new URL('../client/js/world/retro.js', import.meta.url)));
  assert.equal(json('client/audio/beat/tracks.json').tracks.length, 28);
  assert.equal(json('server/catalog.json').filter(i => i.exclusive === 'beat').length, 7);
  for (const id of ['jungle', 'kingtut', 'beat']) assert.ok(THEMES[id] && EVENTS[id] && EVENT_PARKS.has(id) && PARK_NAMES[id], `${id} is still all there`);
});

test('the AI world sends the Mash\'s entrants to its park once it\'s on, and nobody to the closed Beat', () => {
  const t = Date.now(), ids = Array.from({ length: 900 }, (_, i) => 'ai-' + i);
  const world = new AIWorld({ seed: 4242, born: t }, {});
  const count = park => { let n = 0, wrong = 0; for (let h = 0; h < 24; h += 2) for (const id of ids) { const s = world.status(id, t + h * 3600000); if (s?.park === park) { n++; if (!cupEntrant(id, cupWindow(t + h * 3600000))) wrong++; } } return [n, wrong]; };
  setEventVenue('monster');
  const [n, wrong] = count('monster');
  assert.ok(n > 20 && wrong === 0, `entrants at the Mash (${n})`);
  assert.equal(count('beat')[0] + count('jungle')[0], 0, 'nobody at the closed parks');
  setEventVenue('beat');
  assert.equal(count('monster')[0], 0, 'before the handover the Mash is empty');
  setEventVenue(null);
});

test('the store and the locker say where its prizes come from', () => {
  for (const f of ['client/js/ui/store.js', 'client/js/ui/inventory.js']) assert.ok(src(f).includes("i.exclusive === 'monster' ? '★ MONSTER MASH'"), f);
  const s = src('client/js/ui/store.js');
  assert.ok(s.includes("'★ Monster Mash exclusive'") && s.includes('Win it at The Monster Mash'));
  const mm = json('server/catalog.json').filter(i => i.exclusive === 'monster');
  assert.equal(mm.length, 7);
  assert.ok(mm.every(i => i.price === 0 && i.original_2k_asset === false && i.description.includes('Monster Mash')));
});
