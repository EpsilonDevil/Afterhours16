// v0.4.8.6 quick patch: the title song (client/audio/title/tusk.mp3: Fleetwood Mac's "Tusk", David's file). It starts with
// the opening cinematic (js/brandboot.js, right after the studio logo), plays on through the loading screen and the title
// screen from the top (looping if you stay there), and fades out as you enter the court, where the soundtrack takes over
// (core/music.js waits for it: Soundtrack.start while it plays just queues the start). From Settings → Title screen it
// plays again from the beginning, the soundtrack paused under it (ui/screens.js showTitle).
// The game's launcher (Afterhours16.exe) opens the browser with autoplay allowed, so it starts at once; a plain browser
// window that blocks sound before the first click or key starts it on that click or key. Music off in Settings: silent.
// Its level is the music slider's (volumeGain).
// (A placeholder for private play: a commercial recording, not licensed for a public release.)
import { settings, volumeGain } from './settings.js';

export const TITLE_SONG = new URL('../../audio/title/tusk.mp3', import.meta.url).href;
export const TITLE_FADE = 1600; // (ms, the fade out as you enter the court)

export class TitleMusic {
  constructor({ make = () => new Audio(), win = globalThis, every = (f, ms) => setInterval(f, ms), stopEvery = id => clearInterval(id) } = {}) {
    this.make = make; this.win = win; this.every = every; this.stopEvery = stopEvery;
    this.el = null; this.active = false; this.waiting = new Set(); this.armed = null; this.fading = 0;
  }
  level() { return settings.music === false ? 0 : volumeGain(settings.musicVol ?? 0.65); }
  element() {
    if (!this.el) { this.el = this.make(); this.el.preload = 'auto'; this.el.loop = true; this.el.src = TITLE_SONG; }
    return this.el;
  }
  // get it loading early (the opening's first frame), without playing
  preload() { if (settings.music !== false) { try { this.element().load?.(); } catch { /* no audio */ } } return this; }
  // from the top (restart) or on from where it is; false when music is off
  play({ restart = true } = {}) {
    if (settings.music === false) return false;
    const el = this.element();
    if (this.fading) { this.stopEvery(this.fading); this.fading = 0; }
    this.active = true;
    el.volume = this.level();
    if (restart) { try { el.currentTime = 0; } catch { /* not loaded yet: it starts at 0 anyway */ } }
    const p = el.play?.();
    if (p && p.catch) p.catch(() => this.arm()); // (sound not allowed yet: the first click or key starts it)
    return true;
  }
  arm() {
    if (this.armed || !this.win?.addEventListener) return;
    const go = () => { this.disarm(); if (this.active) this.el?.play?.()?.catch?.(() => {}); };
    this.armed = go;
    this.win.addEventListener('pointerdown', go, true); this.win.addEventListener('keydown', go, true);
  }
  disarm() {
    if (!this.armed) return;
    this.win.removeEventListener('pointerdown', this.armed, true); this.win.removeEventListener('keydown', this.armed, true);
    this.armed = null;
  }
  // run fn once it's over (now, if it isn't playing): core/music.js starts the soundtrack this way
  whenDone(fn) { if (this.active) this.waiting.add(fn); else fn(); }
  // fade out (ms) and stop; resolves when it's quiet
  stop({ fade = TITLE_FADE } = {}) {
    const done = () => { const fns = [...this.waiting]; this.waiting.clear(); fns.forEach(f => { try { f(); } catch (e) { console.error(e); } }); };
    if (!this.active) { done(); return Promise.resolve(); }
    this.active = false; this.disarm();
    const el = this.el;
    return new Promise(resolve => {
      const finish = () => { if (this.fading) this.stopEvery(this.fading); this.fading = 0; try { el?.pause?.(); if (el) el.currentTime = 0; } catch { /* ignore */ } done(); resolve(); };
      if (!el || fade <= 0 || el.paused) { finish(); return; }
      const from = el.volume, steps = Math.max(1, Math.round(fade / 50));
      let k = 0;
      this.fading = this.every(() => { k++; el.volume = Math.max(0, from * (1 - k / steps)); if (k >= steps) finish(); }, 50);
    });
  }
}

export const titleMusic = new TitleMusic();
