// v0.4.8.6 quick patch: the opening, every time the game starts (js/brandboot.js): the Silverback Studios logo (a gleam
// crosses the silver left to right, the cinematic ding and one flash as it reaches the right edge, a slow push in to
// black: ui/opening.js playStudioLogo), then the title song (core/titlemusic.js: "Tusk", from the top) with the RIMRIFT
// cinematic (playCutscene), then the loading screen while the game starts, then the title screen; entering fades the song
// and the soundtrack takes over (core/music.js waits for it).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const src = f => fs.readFileSync(new URL(f, root), 'utf8');
globalThis.localStorage ||= { getItem: () => null, setItem() {} };
const { STUDIO, studioFrame, playStudioLogo, playCutscene, CUTSCENE, skipper } = await import('../client/js/ui/opening.js');
const { TitleMusic, TITLE_SONG } = await import('../client/js/core/titlemusic.js');
const { settings } = await import('../client/js/core/settings.js');

// where a 'size'%-wide band image's centre sits (in logo widths) at background-position p% in a box from -a to 1+a
const centre = (p, size = 250, a = 0) => { const w = 1 + 2 * a, s = size / 100; return -a + (p / 100) * w * (1 - s) + 0.5 * s * w; };

test('the studio logo\'s timeline: fade in, the glare across to the right edge exactly at the flash and the ding, then the push in to black', () => {
  assert.equal(studioFrame(0).opacity, 0);
  assert.equal(studioFrame(STUDIO.fadeIn[1]).opacity, 1);
  // the band: a quarter-width left of the logo as the sweep starts, on its right edge at the flash, moving only rightwards
  assert.ok(Math.abs(centre(studioFrame(STUDIO.gleam[0]).bg) + 0.25) < 1e-3);
  assert.ok(Math.abs(centre(studioFrame(STUDIO.flash - 1).bg) - 1) < 0.002);
  assert.ok(Math.abs(centre(studioFrame(STUDIO.flash).bg) - 1) < 1e-9);
  let last = -Infinity;
  for (let ms = STUDIO.gleam[0]; ms <= STUDIO.flash; ms += 50) { const c = centre(studioFrame(ms).bg); assert.ok(c >= last - 1e-9); last = c; }
  // the flash: none before, full at the moment, gone within half a second; the metal dim until it, lit after
  assert.equal(studioFrame(STUDIO.flash - 1).flash, 0);
  assert.equal(studioFrame(STUDIO.flash).flash, 1);
  assert.ok(studioFrame(STUDIO.flash + 500).flash < 0.1);
  assert.deepEqual([studioFrame(STUDIO.flash - 1).lit, studioFrame(STUDIO.flash).lit], [0.72, 1]);
  assert.ok(studioFrame(STUDIO.flash - 200).glare > 0.9 && studioFrame(STUDIO.flash + 400).glare === 0);
  // then the slow push in as it fades to black
  assert.equal(studioFrame(STUDIO.flash).scale, 1);
  assert.ok(Math.abs(studioFrame(STUDIO.end).scale - (1 + STUDIO.zoom)) < 1e-9);
  for (let ms = STUDIO.flash; ms < STUDIO.end; ms += 100) assert.ok(studioFrame(ms + 100).scale >= studioFrame(ms).scale);
  assert.ok(studioFrame(STUDIO.fadeOut[1]).opacity < 0.001);
  assert.equal(studioFrame(STUDIO.end - 1).done, false); assert.equal(studioFrame(STUDIO.end).done, true);
  assert.ok(STUDIO.end >= 5500 && STUDIO.end <= 7000, 'about six seconds');
});

test('the halo and the streak ride on the band: their wider boxes have the image sizes that keep the same centre', () => {
  const css = src('client/css/brandintro.css');
  assert.match(css, /\.rr-studio-gleam \{[^}]*background-size: 250% 100%, 250% 100%;/);
  assert.match(css, /\.rr-studio-glare \{ position: absolute; left: -15%; right: -15%;[^}]*background-size: 215\.38% 100%;/);
  assert.match(css, /\.rr-studio-streak \{ position: absolute; left: -6%; right: -6%;[^}]*background-size: 233\.9% 100%;/);
  for (const p of [100, 50, 100 / 6, 0]) {
    assert.ok(Math.abs(centre(p, 215.38, 0.15) - centre(p)) < 0.001, `glare at ${p}`);
    assert.ok(Math.abs(centre(p, 233.9, 0.06) - centre(p)) < 0.001, `streak at ${p}`);
  }
  // masked to the logo, the glare and the flash; the logo's brightness from --rr-lit
  assert.match(css, /\.rr-studio-logo \{[^}]*filter: brightness\(var\(--rr-lit, \.72\)\)/);
  assert.match(src('client/js/ui/opening.js'), /el\.style\.webkitMaskImage = el\.style\.maskImage = `url\("\$\{logo\}"\)`/);
});

// ---- a stub page: elements by class, styles, listeners ----
function fakeDoc() {
  const made = [];
  const node = (tag = 'div') => {
    const kids = new Map(), n = { tagName: tag.toUpperCase(), style: { setProperty(k, v) { this[k] = v; } }, attrs: {}, listeners: {}, children: [], className: '', classes: new Set(), removed: false,
      classList: { add: c => n.classes.add(c), contains: c => n.classes.has(c) },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      set innerHTML(v) { this.html = v; for (const m of v.matchAll(/class="([^"]+)"/g)) { const c = m[1].split(' ')[0], k = node(/rr-cut-video/.test(c) ? 'video' : /logo/.test(c) ? 'img' : 'div'); kids.set(c, k); } },
      get innerHTML() { return this.html; },
      querySelector(sel) { if (sel === 'video') return [...kids.values()].find(k => k.tagName === 'VIDEO'); return kids.get(sel.replace(/^\./, '')) || null; },
      querySelectorAll(sel) { return sel === 'source' ? this.children.filter(c => c.tagName === 'SOURCE') : []; },
      append(c) { this.children.push(c); },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, fire(t) { for (const f of this.listeners[t] || []) f({}); },
      remove() { this.removed = true; }, pause() { this.paused = true; }, play() { this.played = (this.played || 0) + 1; return Promise.resolve(); } };
    made.push(n);
    return n;
  };
  const body = { list: [], append(n) { this.list.push(n); } };
  return { doc: { body, baseURI: 'http://127.0.0.1/', createElement: node }, made };
}
const fakeWin = () => { const L = {}; return { L, addEventListener(t, f) { (L[t] ||= []).push(f); }, removeEventListener(t, f) { L[t] = (L[t] || []).filter(x => x !== f); }, fire(t, e) { for (const f of [...(L[t] || [])]) f(e); } }; };

test('playStudioLogo: the ding exactly once, as the glare reaches the right edge; it ends on its own, or a press skips it (not in its first moment)', async () => {
  const { doc } = fakeDoc(), win = fakeWin();
  let t = 0, frames = [];
  const audio = { plays: [], load() {}, play() { this.plays.push(t); return Promise.resolve(); } };
  const done = playStudioLogo({ base: 'brand/', sound: 'audio/title/ding.mp3', doc, win, now: () => t, raf: f => { frames.push(f); return frames.length; }, caf: () => {}, pads: () => [], makeAudio: () => audio });
  const layer = doc.body.list[0];
  assert.ok(layer.className.includes('rr-studio'));
  assert.equal(layer.querySelector('.rr-studio-logo').src, 'http://127.0.0.1/brand/silverback-logo.svg');
  assert.equal(audio.src, 'audio/title/ding.mp3');
  const step = ms => { t = ms; const q = frames; frames = []; q.forEach(f => f()); };
  for (let ms = 0; ms < STUDIO.flash; ms += 16) step(ms);
  assert.deepEqual(audio.plays, []);
  step(STUDIO.flash + 3);
  assert.deepEqual(audio.plays, [STUDIO.flash + 3]);
  assert.equal(layer.querySelector('.rr-studio-flash').style.opacity, (Math.exp(-3 / STUDIO.flashTau)).toFixed(3));
  for (let ms = STUDIO.flash + 20; ms < STUDIO.end; ms += 16) step(ms);
  assert.equal(audio.plays.length, 1);
  step(STUDIO.end);
  assert.deepEqual(await done, { how: 'end' });
  assert.ok(layer.removed);
  // skipped: a key in its first moment does nothing, after it skips
  const two = fakeDoc(), w2 = fakeWin();
  t = 0; frames = [];
  const p2 = playStudioLogo({ doc: two.doc, win: w2, now: () => t, raf: f => { frames.push(f); return 1; }, caf: () => {}, pads: () => [] });
  w2.fire('keydown', { key: 'Enter', preventDefault() {} });
  t = STUDIO.skipAfter - 1; w2.fire('keydown', { key: 'Enter', preventDefault() {} });
  t = STUDIO.skipAfter + 1; w2.fire('keydown', { key: 'Enter', repeat: true, preventDefault() {} }); // (a held key's repeat)
  t = STUDIO.skipAfter + 2; w2.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(await p2, { how: 'key' });
});

test('skipper: fresh presses only (a pad button held when it shows doesn\'t count), clicks and keys; keys still reach the song\'s first-key start', () => {
  const win = fakeWin(), got = [];
  let pads = [{ index: 0, buttons: [{ pressed: true }] }], frames = [];
  skipper(how => got.push(how), { win, pads: () => pads, raf: f => { frames.push(f); return 1; }, caf: () => {} });
  const step = () => { const q = frames; frames = []; q.forEach(f => f()); };
  step(); assert.deepEqual(got, []); // (held from before)
  pads = [{ index: 0, buttons: [{ pressed: false }] }]; step();
  pads = [{ index: 0, buttons: [{ pressed: true }] }]; step();
  assert.deepEqual(got, ['pad']);
  const w2 = fakeWin(), g2 = [];
  skipper(how => g2.push(how), { win: w2, pads: () => [], raf: () => 1, caf: () => {} });
  const e = { key: ' ', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  w2.fire('keydown', e);
  assert.deepEqual(g2, ['key']); assert.equal(e.prevented, true); assert.equal(e.stopped, false);
  const w3 = fakeWin(), g3 = [];
  skipper(how => g3.push(how), { win: w3, pads: () => [], raf: () => 1, caf: () => {} });
  w3.fire('pointerdown', {}); assert.deepEqual(g3, ['pointer']);
});

test('playCutscene: the kit\'s cinematic (WebM, then MP4), muted, labeled; ends with a fade, never stuck on black', async () => {
  const { doc } = fakeDoc();
  let t = 0; const timers = [];
  const later = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  const run = () => { const q = timers.splice(0); q.forEach(x => x.f()); };
  const p = playCutscene({ base: 'brand/', doc, win: fakeWin(), now: () => t, raf: () => 1, caf: () => {}, pads: () => [], later, cancel: () => {} });
  const layer = doc.body.list[0], video = layer.querySelector('video');
  assert.ok(layer.className.includes('rr-cutscene'));
  assert.equal(video.muted, true); assert.equal(video.playsInline, true);
  assert.deepEqual(video.children.map(s => [s.src, s.type]), [['http://127.0.0.1/brand/intro-cinematic.webm', 'video/webm'], ['http://127.0.0.1/brand/intro-cinematic.mp4', 'video/mp4']]);
  assert.match(layer.innerHTML, /CONCEPT CINEMATIC/);
  assert.deepEqual(timers.map(x => x.ms), [CUTSCENE.stall, CUTSCENE.hintAfter]);
  video.currentTime = 3; timers.splice(0);
  video.fire('ended');
  assert.ok(layer.classes.has('rr-out'));
  assert.equal(timers.at(-1).ms, CUTSCENE.fade);
  run();
  assert.deepEqual(await p, { how: 'end' });
  assert.ok(layer.removed);
  // it can't play (no format, or nothing a few seconds in): straight on
  const two = fakeDoc(); timers.length = 0;
  const p2 = playCutscene({ doc: two.doc, win: fakeWin(), now: () => 0, raf: () => 1, caf: () => {}, pads: () => [], later, cancel: () => {} });
  timers[0].f(); // (the stall watchdog: currentTime still 0)
  run();
  assert.deepEqual(await p2, { how: 'error' });
});

test('the title song: from the top, looping, at the music slider\'s level; a blocked start waits for the first click or key; it fades out, then the soundtrack', async () => {
  assert.match(TITLE_SONG, /\/audio\/title\/tusk\.mp3$/);
  const win = fakeWin(), ticks = [];
  let blocked = true;
  const el = { plays: 0, paused: true, currentTime: 42, volume: 1, load() {}, play() { this.plays++; if (blocked) return Promise.reject(new Error('NotAllowedError')); this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  const tm = new TitleMusic({ make: () => el, win, every: f => { ticks.push(f); return ticks.length; }, stopEvery: () => {} });
  const was = { music: settings.music, musicVol: settings.musicVol };
  try {
    settings.music = true; settings.musicVol = 0.65;
    assert.equal(tm.play(), true);
    assert.equal(el.loop, true); assert.equal(el.currentTime, 0); assert.equal(el.volume, tm.level());
    await new Promise(r => setTimeout(r, 0));
    assert.ok(win.L.keydown?.length && win.L.pointerdown?.length, 'waiting for a gesture');
    blocked = false; win.fire('keydown', {});
    assert.equal(el.paused, false); assert.equal(win.L.keydown.length, 0);
    // the soundtrack waits for it; it fades out over TITLE_FADE in 50 ms steps, then the soundtrack starts
    const order = [];
    tm.whenDone(() => order.push('soundtrack'));
    const stopped = tm.stop({ fade: 200 });
    assert.equal(tm.active, false);
    while (ticks.length) { const f = ticks[0]; for (let i = 0; i < 4; i++) f(); ticks.shift(); }
    await stopped;
    assert.equal(el.paused, true); assert.equal(el.volume, 0); assert.deepEqual(order, ['soundtrack']);
    // music off: no song
    settings.music = false;
    assert.equal(new TitleMusic({ make: () => ({ play() { throw new Error('should not play'); } }) }).play(), false);
  } finally { Object.assign(settings, was); }
  // core/music.js: Soundtrack.start while the song plays queues itself (once) behind it
  assert.match(src('client/js/core/music.js'), /if \(titleMusic\.active\) \{ titleMusic\.whenDone\(this\.afterTitle \|\|= \(\) => this\.start\(\)\); return; \}/);
});

test('brandboot.js runs it in order: the studio logo, the song with the cinematic, the loading screen while main.js starts, the title screen', () => {
  const boot = src('client/js/brandboot.js');
  const at = s => { const i = boot.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('if (intro) {') < at('titleMusic.preload();'));
  assert.ok(at('titleMusic.preload();') < at('await playStudioLogo({'));
  assert.ok(at('await playStudioLogo({') < at('titleMusic.play();'));
  assert.ok(at('titleMusic.play();') < at('await playCutscene({'));
  assert.ok(at('await playCutscene({') < at("await import('./main.js')"));
  assert.ok(at("await import('./main.js')") < at('await booted;'));
  assert.ok(at('await booted;') < at('mountBrandIntro({'));
  assert.match(boot, /sound: new URL\('\.\.\/audio\/title\/ding\.mp3', import\.meta\.url\)\.href, volume: volumeGain\(settings\.sfx \?\? 0\.95\)/);
  // entering: the soundtrack queued behind the song, then the song fades
  assert.match(boot, /music\.start\(\);[^\n]*\n\s*titleMusic\.stop\(\);/);
  // main.js says when it's up, before the loading screen fades (the title screen goes up over the menus first)
  assert.match(src('client/js/main.js'), /function bootDone\(\) \{ window\.dispatchEvent\(new CustomEvent\('rimrift:booted'\)\); const b = \$\('#boot'\);/);
  // from Settings → Title screen: its song from the top, the soundtrack paused under it and back after
  assert.match(src('client/js/ui/screens.js'), /const song = titleMusic\.play\(\) && \(music\.setSuppressed\(true\), true\);/);
  assert.match(src('client/js/ui/screens.js'), /if \(song\) titleMusic\.stop\(\)\.then\(\(\) => music\.setSuppressed\(false\)\);/);
});

test('the files: the studio logo in vector strokes, the ding, the song, the cinematic in both formats; the service streams them', () => {
  const svg = src('client/brand/silverback-logo.svg');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 2920 580"/);
  assert.ok(!/<image|data:|<text/.test(svg), 'strokes only: no raster, no font');
  assert.equal((svg.match(/<path /g) || []).length, 5);
  assert.equal((svg.match(/<linearGradient /g) || []).length, 3);
  const size = f => fs.statSync(new URL(f, root)).size;
  assert.ok(size('client/audio/title/tusk.mp3') > 4e6);
  assert.ok(size('client/audio/title/ding.mp3') > 50e3 && size('client/audio/title/ding.mp3') < 400e3);
  assert.ok(size('client/brand/intro-cinematic.webm') > 2e6 && size('client/brand/intro-cinematic.webm') < 9e6);
  assert.ok(size('client/brand/intro-cinematic.mp4') > 5e6 && size('client/brand/intro-cinematic.mp4') < 16e6);
  const app = src('server/app.py');
  assert.match(app, /"\.webm": "video\/webm", "\.mp4": "video\/mp4"/);
  assert.match(app, /STATIC_MEDIA = \("\.mp3", "\.webm", "\.mp4"\)/);
  assert.match(app, /self\.send_header\("Content-Type", STATIC_EXT\[file\.suffix\.lower\(\)\]\)\n\s*self\.send_header\("Accept-Ranges", "bytes"\)/);
});
