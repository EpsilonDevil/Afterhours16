// v0.4.4 soundtrack: the player-supplied tracks in client/audio/music (listed in tracks.json) play
// shuffled (v0.4.8.5: a new shuffle every startup, see shuffleQueue) through the menus, the park, park games and practice. They fade out for Pro-Am (the arena has its
// own crowd) and pick up where they left off afterwards. Each new track gets an early-2000s style
// "now playing" ticker in the bottom-left corner for its first few seconds.
import { settings, volumeGain } from './settings.js';

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

  target() { return this.wanted && !this.suppressed ? volumeGain(settings.musicVol ?? 0.35) * (this.ducked ? 0.65 : 1) : 0; } // (qp3: the perceptual curve)

  element() {
    if (!this.el) {
      this.el = new Audio();
      this.el.preload = 'auto';
      // v0.4.7.5: a long mix split into parts plays its parts back to back (the next part is preloaded)
      this.el.addEventListener('ended', () => { if (!this.nextPart()) this.next(); });
      this.el.addEventListener('timeupdate', () => this.preloadPart());
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
    if (!this.queue.length) this.queue = shuffleQueue(this.tracks, this.bad, this.current, recentTracks());
    const t = this.tracks[this.queue.shift()];
    rememberTrack(t, this.tracks.length);
    this.current = t; this.part = 0; this.preloaded = null;
    const el = this.element();
    el.src = 'audio/music/' + (t.parts ? t.parts[0] : t.file);
    el.volume = this.level;
    if (this.wanted && !this.suppressed) el.play().catch(() => {});
    this.pendingTicker = t;
  }

  // v0.4.7.5 multi-part tracks: {file: first part, parts: [...]}
  nextPart() {
    const t = this.current;
    if (!t?.parts || this.part >= t.parts.length - 1) return false;
    this.part++;
    const el = this.element();
    el.src = 'audio/music/' + t.parts[this.part];
    el.volume = this.level;
    if (this.wanted && !this.suppressed) el.play().catch(() => {});
    return true;
  }
  preloadPart() {
    const t = this.current, el = this.el;
    if (!t?.parts || !el || this.part >= t.parts.length - 1 || !(el.duration - el.currentTime < 8)) return;
    const f = t.parts[this.part + 1];
    if (this.preloaded === f) return;
    this.preloaded = f;
    const pre = new Audio(); pre.preload = 'auto'; pre.src = 'audio/music/' + f; // (warms the cache so the part change is quick)
    this.preEl = pre;
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

// v0.4.8.5: a fresh shuffle on every startup that also remembers what played last time. The order is drawn with
// crypto randomness, and the tracks heard most recently (in this session or the last ones, kept in localStorage)
// go to the back of the new order, so a new session never opens with the same songs in the same order.
const RECENT_KEY = 'ah16.music.recent';
export function recentTracks() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(f => typeof f === 'string') : []; } catch { return []; }
}
function rememberTrack(t, total) {
  try {
    const keep = Math.max(1, Math.floor(total / 2));
    const list = [t.file, ...recentTracks().filter(f => f !== t.file)].slice(0, keep);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* private window: the shuffle still works, it just can't remember */ }
}
const rand = n => {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; } catch { return Math.floor(Math.random() * n); }
};
export function shuffleQueue(tracks, bad = new Set(), current = null, recent = []) {
  const q = tracks.map((_, i) => i).filter(i => !bad.has(tracks[i].file));
  for (let i = q.length - 1; i > 0; i--) { const j = rand(i + 1); [q[i], q[j]] = [q[j], q[i]]; }
  // (recent ones last, the most recent at the very end; never the track that just played first)
  const age = new Map(recent.map((f, k) => [f, recent.length - k]));
  const fresh = q.filter(i => !age.has(tracks[i].file)), old = q.filter(i => age.has(tracks[i].file)).sort((a, b) => age.get(tracks[a].file) - age.get(tracks[b].file));
  const out = [...fresh, ...old];
  if (current && out[0] === tracks.indexOf(current) && out.length > 1) out.push(out.shift());
  return out;
}

export const music = new Soundtrack();
