// v0.4.8.5 quick patch: And The Beat Goes On. Its own soundtrack (client/audio/beat), played only at its park, a new
// shuffle on every arrival, and the main soundtrack picked up where it was left; the event on the schedule and in the
// client's lists. (The park itself: v0485beatpark.test.mjs; the rewards: v0485beatitems.test.mjs.)
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Soundtrack, PLAYLISTS, shuffleQueue } from '../client/js/core/music.js';
import { THEMES, EVENTS, parkInfo } from '../client/js/world/themes.js';
import { EVENT_PARKS, PARK_NAMES } from '../client/js/sim/world.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const json = f => JSON.parse(src(f));
const MAIN = json('client/audio/music/tracks.json').tracks, BEAT = json('client/audio/beat/tracks.json').tracks;

// a browser just big enough for the Soundtrack: Audio elements that record what they're told to play
function fakeBrowser() {
  const played = [];
  globalThis.fetch = async url => ({ json: async () => ({ tracks: url.startsWith('audio/beat/') ? BEAT : url.startsWith('audio/music/') ? MAIN : [] }) });
  globalThis.Audio = class {
    constructor() { this.paused = true; this.currentTime = 0; this.listeners = {}; this._src = ''; }
    set src(v) { this._src = v; played.push(v); }
    get src() { return this._src; }
    addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this._src = ''; }
    load() {}
    end() { for (const f of this.listeners.ended || []) f(); }
  };
  globalThis.document = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => ({ classList: { add() {} }, scrollWidth: 0, clientWidth: 0 }), set innerHTML(v) {} }), body: { appendChild() {} } };
  globalThis.requestAnimationFrame = () => 0;
  return played;
}

test('the event soundtrack: 28 cuts of the mix in their own folder, none of them on the main soundtrack', () => {
  assert.equal(BEAT.length, 28);
  assert.deepEqual(PLAYLISTS.beat.dir, 'audio/beat/');
  const mainFiles = new Set(MAIN.flatMap(t => [t.file, ...(t.parts || [])]));
  for (const t of BEAT) {
    assert.ok(fs.existsSync(new URL('../client/audio/beat/' + t.file, import.meta.url)), t.file);
    assert.ok(!mainFiles.has(t.file));
    assert.ok(!fs.existsSync(new URL('../client/audio/music/' + t.file, import.meta.url)), 'not in the main folder');
  }
  assert.ok(!src('client/audio/music/tracks.json').includes('beat-'), 'the main list never names them');
  // only the Beat's park asks for it; menus, the Crew HQ, Pro-Am and the Pro Run ask for the main soundtrack
  assert.equal(THEMES.beat.music, 'beat');
  assert.deepEqual(Object.values(THEMES).filter(t => t.music).map(t => t.id), ['beat']);
  assert.ok(src('client/js/game/park.js').includes("music.setPlaylist(this.theme?.music || 'main');"));
  assert.ok(src('client/js/ui/screens.js').includes("music.setPlaylist('main');"));
  assert.ok(src('client/js/game/crewhq.js').includes("music.setPlaylist('main');"));
  assert.equal((src('client/js/ui/modes.js').match(/music\.setPlaylist\('main'\); music\.setSuppressed\(true\)/g) || []).length, 2, 'both Pro-Am kinds');
  assert.ok(src('client/js/ui/prorun.js').includes("music.setPlaylist('main'); music.setSuppressed(true);"));
});

test('at the event park only its tracks play, in a new order on every arrival; back elsewhere the main soundtrack picks up where it was', async () => {
  const played = fakeBrowser();
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { settings } = await import('../client/js/core/settings.js');
  settings.music = true;
  const m = new Soundtrack();
  await m.start();
  const mainFirst = played.at(-1);
  assert.ok(mainFirst.startsWith('audio/music/'), mainFirst);
  m.el.currentTime = 42;
  // walk into the Beat: only its folder from here on, through every track
  m.setPlaylist('beat');
  await new Promise(r => setTimeout(r, 0));
  const at = played.length;
  for (let i = 0; i < 40; i++) m.el.end();
  const atBeat = played.slice(at - 1);
  assert.ok(atBeat.length > 30 && atBeat.every(s => s.startsWith('audio/beat/')), 'nothing from the main soundtrack at the event park');
  assert.equal(new Set(atBeat.slice(0, 28)).size, 28, 'every cut once before any repeats');
  // leave: the main soundtrack is back on the track it was playing
  m.setPlaylist('main');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(played.at(-1), mainFirst);
  for (let i = 0; i < 30; i++) { m.el.end(); assert.ok(played.at(-1).startsWith('audio/music/'), 'no event track anywhere else'); }
  // a new shuffle on each arrival at the event park
  const firsts = new Set();
  for (let k = 0; k < 12; k++) {
    m.setPlaylist('beat'); await new Promise(r => setTimeout(r, 0));
    firsts.add(played.at(-1));
    m.setPlaylist('main'); await new Promise(r => setTimeout(r, 0));
  }
  assert.ok(firsts.size >= 5, `the first track changes from visit to visit (${firsts.size} different in 12)`);
  // each list remembers its own recent tracks
  assert.ok(store.has(PLAYLISTS.main.recent) && store.has(PLAYLISTS.beat.recent));
  assert.ok(JSON.parse(store.get(PLAYLISTS.main.recent)).every(f => !f.startsWith('beat-')));
  assert.ok(JSON.parse(store.get(PLAYLISTS.beat.recent)).every(f => f.startsWith('beat-')));
  assert.equal(shuffleQueue(BEAT).length, 28);
});

test('And The Beat Goes On is an event park like the others (and the Jungle and the Cup are kept, just off the schedule)', () => {
  assert.equal(EVENTS.beat.park, 'And The Beat Goes On');
  assert.equal(EVENTS.beat.exclusive, 'beat');
  assert.equal(parkInfo('beat'), EVENTS.beat);
  assert.ok(THEMES.beat.event && THEMES.beat.style === 'retro' && THEMES.beat.streakFx === 'disco');
  assert.ok(EVENT_PARKS.has('beat') && EVENT_PARKS.has('jungle') && EVENT_PARKS.has('kingtut'));
  assert.equal(PARK_NAMES.beat, 'And The Beat Goes On');
  for (const id of ['jungle', 'kingtut']) assert.ok(THEMES[id] && EVENTS[id], `${id} is still all there`);
  const sched = json('server/events.json').schedule;
  assert.deepEqual(sched.map(s => [s.event, s.from, s.until]), [['kingtut', null, 1791763200], ['jungle', 1791763200, 1791936000], ['beat', 1791936000, null]]);
  assert.ok(json('server/venues.json').some(v => v.id === 'beat' && v.event));
  // the store and the locker say where it comes from
  assert.ok(src('client/js/ui/store.js').includes("i.exclusive === 'beat' ? '★ BEAT GOES ON'"));
  assert.ok(src('client/js/ui/inventory.js').includes("i.exclusive === 'beat' ? '★ BEAT GOES ON'"));
});
