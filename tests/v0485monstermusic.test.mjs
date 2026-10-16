// v0.4.8.5 quick patch 3: The Monster Mash's own soundtrack (client/audio/monster: a Halloween party mix split into 27
// cuts), played only at its park, a new shuffle on every arrival, the main soundtrack picked up where it was left, and
// never mixed with And The Beat Goes On's list. (The Beat's: v0485beat.test.mjs; the cuts themselves:
// tests/test_monster_music.py.)
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Soundtrack, PLAYLISTS, shuffleQueue } from '../client/js/core/music.js';
import { THEMES } from '../client/js/world/themes.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const json = f => JSON.parse(src(f));
const MAIN = json('client/audio/music/tracks.json').tracks, BEAT = json('client/audio/beat/tracks.json').tracks;
const MASH = json('client/audio/monster/tracks.json').tracks;
const N = 27;

// a browser just big enough for the Soundtrack: Audio elements that record what they're told to play
function fakeBrowser() {
  const played = [];
  globalThis.fetch = async url => ({ json: async () => ({ tracks: url.startsWith('audio/monster/') ? MASH : url.startsWith('audio/beat/') ? BEAT : url.startsWith('audio/music/') ? MAIN : [] }) });
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
const tick = () => new Promise(r => setTimeout(r, 0));

test('the Mash\'s soundtrack: 27 cuts of the mix in their own folder, on no other list', () => {
  assert.equal(MASH.length, N);
  assert.equal(PLAYLISTS.monster.dir, 'audio/monster/');
  assert.equal(PLAYLISTS.monster.album, 'The Monster Mash · Event Soundtrack');
  assert.notEqual(PLAYLISTS.monster.recent, PLAYLISTS.main.recent);
  assert.notEqual(PLAYLISTS.monster.recent, PLAYLISTS.beat.recent);
  const others = new Set([...MAIN, ...BEAT].flatMap(t => [t.file, ...(t.parts || [])]));
  MASH.forEach((t, i) => {
    assert.equal(t.file, `monster-${String(i + 1).padStart(2, '0')}.mp3`);
    assert.equal(t.title, `Halloween Party Mix · Cut ${i + 1} of ${N}`);
    assert.equal(t.album, 'The Monster Mash · Event Soundtrack');
    assert.ok(fs.existsSync(new URL('../client/audio/monster/' + t.file, import.meta.url)), t.file);
    assert.ok(!others.has(t.file));
    for (const dir of ['music', 'beat']) assert.ok(!fs.existsSync(new URL(`../client/audio/${dir}/${t.file}`, import.meta.url)), `not in audio/${dir}`);
  });
  assert.ok(!fs.readdirSync(new URL('../client/audio/monster/', import.meta.url)).some(f => f.endsWith('.done')), 'no leftover work files');
  for (const f of ['client/audio/music/tracks.json', 'client/audio/beat/tracks.json']) assert.ok(!src(f).includes('monster-'), `${f} never names them`);
  // only the Mash's park asks for it (park.js plays the theme's list); the Beat's park still asks for its own
  assert.equal(THEMES.monster.music, 'monster');
  assert.deepEqual(Object.values(THEMES).filter(t => t.music === 'monster').map(t => t.id), ['monster']);
  assert.equal(THEMES.beat.music, 'beat');
  assert.ok(src('client/js/game/park.js').includes("music.setPlaylist(this.theme?.music || 'main');"));
});

test('at the Mash only its cuts play, in a new order on every arrival; leaving picks the main soundtrack up where it was; the Beat\'s list and the Mash\'s never mix', async () => {
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
  // walk into the Mash: only its folder from here on, through every cut
  m.setPlaylist('monster');
  await tick();
  const at = played.length;
  for (let i = 0; i < 40; i++) m.el.end();
  const atMash = played.slice(at - 1);
  assert.ok(atMash.length > 40 && atMash.every(s => s.startsWith('audio/monster/')), 'nothing but the Mash\'s cuts at its park');
  assert.equal(new Set(atMash.slice(0, N)).size, N, 'every cut once before any repeats');
  // leave: the main soundtrack is back on the track it was playing
  m.setPlaylist('main');
  await tick();
  assert.equal(played.at(-1), mainFirst);
  for (let i = 0; i < 30; i++) { m.el.end(); assert.ok(played.at(-1).startsWith('audio/music/'), 'no Mash cut anywhere else'); }
  // a new shuffle on each arrival
  const firsts = new Set();
  for (let k = 0; k < 12; k++) {
    m.setPlaylist('monster'); await tick();
    firsts.add(played.at(-1));
    m.setPlaylist('main'); await tick();
  }
  assert.ok(firsts.size >= 5, `the first cut changes from visit to visit (${firsts.size} different in 12)`);
  // the Beat, then the Mash, then home: each event park plays only its own list, and main still resumes
  const mainNow = played.at(-1);
  m.setPlaylist('beat'); await tick();
  let from = played.length - 1;
  for (let i = 0; i < 10; i++) m.el.end();
  assert.ok(played.slice(from).every(s => s.startsWith('audio/beat/')), 'only the Beat\'s at the Beat');
  m.setPlaylist('monster'); await tick();
  from = played.length - 1;
  for (let i = 0; i < 10; i++) m.el.end();
  assert.ok(played.slice(from).every(s => s.startsWith('audio/monster/')), 'only the Mash\'s at the Mash, straight after the Beat');
  m.setPlaylist('main'); await tick();
  assert.equal(played.at(-1), mainNow, 'the main soundtrack picks up where it was');
  // each list remembers its own recent tracks
  assert.ok(store.has(PLAYLISTS.main.recent) && store.has(PLAYLISTS.beat.recent) && store.has(PLAYLISTS.monster.recent));
  assert.ok(JSON.parse(store.get(PLAYLISTS.main.recent)).every(f => !f.startsWith('monster-') && !f.startsWith('beat-')));
  assert.ok(JSON.parse(store.get(PLAYLISTS.beat.recent)).every(f => f.startsWith('beat-')));
  assert.ok(JSON.parse(store.get(PLAYLISTS.monster.recent)).every(f => f.startsWith('monster-')));
  assert.equal(shuffleQueue(MASH).length, N);
});
