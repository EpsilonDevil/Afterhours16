// v0.4.4 soundtrack: the player-supplied tracks in client/audio/music (listed in tracks.json) play
// shuffled through the menus, the park, park games and practice. They fade out for Pro-Am (the arena has its
// own crowd) and pick up where they left off afterwards. Each new track gets an early-2000s style
// "now playing" ticker in the bottom-left corner for its first few seconds.
import { settings } from './settings.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Soundtrack {
  constructor() {
    this.tracks = []; this.queue = []; this.current = null;
    this.el = null; this.loaded = null;
    this.suppressed = false; this.ducked = false; this.wanted = false;
    this.level = 0; this.fadeTimer = 0;
    this.tickerT = 0;
    this.bad = new Set(); // tracks that failed to load (e.g. the music download wasn't extracted)
    this.pendingTicker = null;
  }

  load() {
    if (!this.loaded) {
      this.loaded = fetch('audio/music/tracks.json').then(r => r.json()).then(j => { this.tracks = j.tracks || []; }).catch(() => { this.tracks = []; });
    }
    return this.loaded;
  }

  target() { return this.wanted && !this.suppressed ? (settings.musicVol ?? 0.35) * (this.ducked ? 0.65 : 1) : 0; }

  element() {
    if (!this.el) {
      this.el = new Audio();
      this.el.preload = 'auto';
      this.el.addEventListener('ended', () => this.next());
      // a missing or broken file is skipped for the rest of the session; if none of them load, the music
      // simply stays off (no ticker, no retry loop)
      this.el.addEventListener('error', () => {
        if (this.current) this.bad.add(this.current.file);
        this.pendingTicker = null;
        if (this.wanted && this.bad.size < this.tracks.length) setTimeout(() => this.next(), 300);
      });
      // the ticker shows once the track actually starts playing
      this.el.addEventListener('playing', () => { if (this.pendingTicker) { this.showTicker(this.pendingTicker); this.pendingTicker = null; } });
    }
    return this.el;
  }

  // start (or keep) playing when music is on; safe to call any time (it needs one user gesture first)
  async start() {
    if (!settings.music) return;
    this.wanted = true;
    await this.load();
    if (!this.tracks.length) return;
    const el = this.element();
    if (!this.current) this.next();
    else if (el.paused && !this.suppressed) { el.play().catch(() => {}); }
    this.fade();
  }

  stop() { this.wanted = false; this.fade(); }

  // Pro-Am: fade out and pause; afterwards resume the same track
  setSuppressed(on) {
    if (this.suppressed === on) return;
    this.suppressed = on;
    if (!on && this.wanted && this.current && this.el?.paused) this.el.play().catch(() => {});
    if (!on && this.current) this.showTicker(this.current, true);
    this.fade();
  }
  // park games: a little quieter under the game sounds
  duck(on) { this.ducked = on; this.fade(); }
  setVolume() { this.fade(); }

  next() {
    if (!this.tracks.length || this.bad.size >= this.tracks.length) return;
    this.queue = this.queue.filter(i => !this.bad.has(this.tracks[i].file));
    if (!this.queue.length) {
      // shuffle, never repeating the track that just played
      const q = this.tracks.map((_, i) => i).filter(i => !this.bad.has(this.tracks[i].file));
      for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
      if (this.current && q[0] === this.tracks.indexOf(this.current) && q.length > 1) q.push(q.shift());
      this.queue = q;
    }
    const t = this.tracks[this.queue.shift()];
    this.current = t;
    const el = this.element();
    el.src = 'audio/music/' + t.file;
    el.volume = this.level;
    if (this.wanted && !this.suppressed) el.play().catch(() => {});
    this.pendingTicker = t;
  }

  fade() {
    clearInterval(this.fadeTimer);
    const el = this.el;
    if (!el) return;
    this.fadeTimer = setInterval(() => {
      const goal = this.target();
      this.level += Math.sign(goal - this.level) * Math.min(Math.abs(goal - this.level), 0.025);
      el.volume = Math.max(0, Math.min(1, this.level));
      if (Math.abs(goal - this.level) < 0.001) {
        clearInterval(this.fadeTimer);
        if (goal === 0 && !el.paused) el.pause();
        else if (goal > 0 && el.paused && this.current) el.play().catch(() => {});
      }
    }, 40);
    if (this.target() > 0 && el.paused && this.current) el.play().catch(() => {});
  }

  // early-2000s sports-game ticker: slides in bottom-left, scrolls if the title is long, slides back out
  showTicker(t, resumed = false) {
    if (this.suppressed || !this.wanted) return;
    let box = document.getElementById('np-ticker');
    if (!box) { box = document.createElement('div'); box.id = 'np-ticker'; box.className = 'np-ticker'; document.body.appendChild(box); }
    const artist = t.artist ? esc(t.artist) : '';
    box.innerHTML = `<div class="np-k"><i>♪</i>${resumed ? 'BACK ON' : 'NOW PLAYING'}</div><div class="np-body"><div class="np-scroll"><b>${esc(t.title)}</b>${artist ? `<span>${artist}</span>` : ''}<em>${esc(t.album || 'Afterhours 16 Soundtrack')}</em></div></div>`;
    box.classList.remove('out'); box.classList.remove('on'); void box.offsetWidth; box.classList.add('on');
    const sc = box.querySelector('.np-scroll'), body = box.querySelector('.np-body');
    requestAnimationFrame(() => { if (sc.scrollWidth > body.clientWidth + 4) sc.classList.add('long'); });
    clearTimeout(this.tickerT);
    this.tickerT = setTimeout(() => { box.classList.remove('on'); box.classList.add('out'); }, 6500);
  }
}

export const music = new Soundtrack();
