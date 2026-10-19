// v0.4.8.5 quick patch 4: the AI keeps playing the park events across a handover. The game used to read which event
// was on once, at startup: left running through a switch (the Jungle → the Beat at 5 PM Pacific), its AI world kept
// sending the event's entrants to the park that had just closed, and the new event park stood empty. Now the AI world
// follows the server's schedule (eventVenueAt), and the client switches its event the moment the schedule does.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AIWorld, setEventVenue, setEventSchedule, eventVenueAt, nextEventChange, EVENT_VENUE } from '../client/js/sim/world.js';
import { syncEvent, watchEvents } from '../client/js/ui/events.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// (v0.4.8.7: the shipped schedule now ends in the park shuffle, which the server sends as plain windows; these tests
// check the client's handling of a schedule, so they keep the qp4-era rows with an open-ended last event)
const SCHED = [{ event: 'kingtut', from: null, until: 1791763200 }, { event: 'jungle', from: 1791763200, until: 1791936000 }, { event: 'beat', from: 1791936000, until: 1792108800 }, { event: 'monster', from: 1792108800, until: null }];
const VENUES = { kingtut: 'kingtut', jungle: 'jungle', beat: 'beat', monster: 'monster' };
const rows = SCHED.map(r => ({ ...r, venue: VENUES[r.event] }));
const JUNGLE_TO_BEAT = 1791936000 * 1000; // 2026-10-14 00:00 UTC = 5 PM Pacific, Oct 13

test('a game started before a handover sends the AI to the new event park after it, with nothing else said', () => {
  const w = new AIWorld({ seed: 4242, born: JUNGLE_TO_BEAT - 30 * 86400000 }, {});
  const times = []; for (let t = JUNGLE_TO_BEAT - 3600000; t < JUNGLE_TO_BEAT + 3 * 3600000; t += 600000) times.push(t);
  times.push(JUNGLE_TO_BEAT + 60000);
  // what a game started at each moment would show (the venue it read at startup was right for that moment)
  const fresh = times.map(t => { setEventVenue(t < JUNGLE_TO_BEAT ? 'jungle' : 'beat'); return [w.onlineAt('jungle', t).length, w.onlineAt('beat', t).length]; });
  // a game started before the switch and left running: the schedule alone, no other call
  setEventSchedule(rows, null);
  const kept = times.map(t => [w.onlineAt('jungle', t).length, w.onlineAt('beat', t).length]);
  assert.deepEqual(kept, fresh, 'the same people at the same parks as a game just started');
  const after = kept.filter((_, i) => times[i] >= JUNGLE_TO_BEAT), before = kept.filter((_, i) => times[i] < JUNGLE_TO_BEAT);
  assert.ok(after.every(([j]) => j === 0) && after.reduce((a, [, b]) => a + b, 0) > 40, `the Beat fills, the closed Jungle empties (${JSON.stringify(after)})`);
  assert.ok(before.every(([, b]) => b === 0) && before.reduce((a, [j]) => a + j, 0) > 10, `before: the Jungle (${JSON.stringify(before)})`);
  // a status taken just before the switch ends at it (nobody "stays on" at the closed park past the handover)
  for (let i = 0; i < 900; i++) {
    const s = w.status('ai-' + i, JUNGLE_TO_BEAT - 120000);
    if (s?.park === 'jungle') assert.ok(s.until <= JUNGLE_TO_BEAT, `ai-${i} leaves the Jungle at the handover`);
  }
  // the old way (one venue, fixed when the game started) is what left the Beat empty
  setEventVenue('jungle');
  assert.equal(times.filter(t => t >= JUNGLE_TO_BEAT).reduce((a, t) => a + w.onlineAt('beat', t).length, 0), 0, '(the bug: a fixed venue keeps them at the Jungle)');
  setEventSchedule(rows, null);
});

// (at 5 PM Pacific, the evening of the switch: busy, as it should be)
test('at the 5 PM Pacific switch the new event park has a crowd', { skip: Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Los_Angeles' && 'Pacific time only' }, () => {
  setEventSchedule(rows, null);
  const w = new AIWorld({ seed: 4242, born: JUNGLE_TO_BEAT - 30 * 86400000 }, {});
  assert.ok(w.onlineAt('beat', JUNGLE_TO_BEAT + 60000).length >= 15);
  assert.ok(w.onlineAt('beat', JUNGLE_TO_BEAT + 3 * 3600000).length >= 15);
});

test('the schedule: each event in its window, open ends, unknown events, a PC clock that\'s off', () => {
  setEventSchedule(rows, null);
  assert.equal(eventVenueAt(JUNGLE_TO_BEAT - 1), 'jungle');
  assert.equal(eventVenueAt(JUNGLE_TO_BEAT), 'beat');
  assert.equal(eventVenueAt(1792108800 * 1000), 'monster');
  assert.equal(eventVenueAt(1792108800 * 1000 + 400 * 86400000), 'monster', 'open-ended');
  assert.equal(eventVenueAt(0), 'kingtut', 'open start');
  assert.equal(nextEventChange(JUNGLE_TO_BEAT - 5000), JUNGLE_TO_BEAT);
  assert.equal(nextEventChange(1792108800 * 1000 + 1), null, 'nothing after the last handover');
  // an event this copy of the game doesn't know yet: nobody is sent anywhere for it
  setEventSchedule([{ event: 'future', venue: 'future', from: 100, until: 200 }, { event: 'beat', venue: 'beat', from: 200, until: null }], null);
  assert.equal(eventVenueAt(150000), null);
  assert.equal(eventVenueAt(250000), 'beat');
  // nothing scheduled
  setEventSchedule([], null);
  assert.equal(eventVenueAt(), null);
  // a PC clock 3 minutes slow switches when the server does
  const now = Date.now();
  setEventSchedule([{ event: 'jungle', venue: 'jungle', from: null, until: Math.floor(now / 1000) + 60 }, { event: 'beat', venue: 'beat', from: Math.floor(now / 1000) + 60, until: null }], now / 1000 + 180);
  assert.equal(eventVenueAt(now), 'beat', 'the server is already past the switch');
  // a wild clock (a time-zone mix-up) is ignored
  setEventSchedule(rows, now / 1000 + 9 * 3600);
  assert.equal(eventVenueAt(JUNGLE_TO_BEAT), 'beat');
  // a venue set on its own (no schedule) still pins it, as before
  setEventVenue('kingtut');
  assert.equal(eventVenueAt(JUNGLE_TO_BEAT), 'kingtut');
  setEventSchedule(rows, null);
});

test('the client switches its event the moment the schedule does: the card, the AI world, a word to the player', async () => {
  setEventSchedule(rows, null);
  const toasts = [];
  globalThis.document = { querySelector: () => null };
  const app = {
    config: { event: { id: 'jungle', venue: 'jungle' } }, world: { themeId: 'jungle' },
    api: { get: async () => ({ event: { id: 'beat', venue: 'beat', name: 'And The Beat Goes On' }, event_schedule: rows, now: Date.now() / 1000 }) },
  };
  // (toast() needs the page: count calls through a stand-in element)
  const el = { hidden: true, set textContent(v) { toasts.push(v); }, set className(v) {} };
  globalThis.document = { querySelector: s => (s === '#toast' ? el : null) };
  assert.equal(syncEvent(app, await app.api.get(), { announce: true }), true);
  assert.equal(app.config.event.id, 'beat');
  assert.match(toasts.at(-1), /The Jungle Ballers has closed.*And The Beat Goes On is on now/);
  assert.equal(syncEvent(app, await app.api.get()), false, 'nothing new the second time');
  // the watcher asks the server only when the schedule and the game disagree
  let calls = 0;
  const app2 = { config: { event: { id: 'beat', venue: 'beat' } }, api: { get: async () => { calls++; return { event: { id: 'monster', venue: 'monster' }, event_schedule: rows }; } } };
  setEventSchedule([{ event: 'beat', venue: 'beat', from: null, until: null }], null);
  const wtch = watchEvents(app2, 1e9);
  await wtch.tick();
  assert.equal(calls, 0, 'in step: no request');
  setEventSchedule([{ event: 'monster', venue: 'monster', from: null, until: null }], null);
  await wtch.tick();
  assert.equal(calls, 1);
  assert.equal(app2.config.event.id, 'monster');
  wtch.stop();
  setEventSchedule(rows, null);
});

test('wired in: startup reads the schedule and starts the watch; the Park screen and the leaderboard sync through it', () => {
  const main = src('client/js/main.js');
  assert.ok(main.includes('setEventSchedule(app.config.event_schedule, app.config.server_time);'));
  assert.ok(main.includes('app.eventWatch = watchEvents(app);'));
  const modes = src('client/js/ui/modes.js');
  assert.ok(modes.includes('if (syncEvent(app, st, { announce: false })) { parkEntry(app, root); return; }'));
  assert.ok(modes.includes('if (st.event) syncEvent(app, st, { announce: false });'));
  assert.ok(!modes.includes('app.config.event = st.event'), 'nothing sets the event behind the AI world\'s back');
  assert.ok(src('client/js/sim/world.js').includes('const ev = eventVenueAt(t);'));
});
