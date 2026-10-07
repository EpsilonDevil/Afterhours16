// "Lock-in" mode: true fullscreen plus Keyboard Lock, so Esc, Alt+Tab-style and browser shortcuts
// (Ctrl+W, Ctrl+T, …) reach the game instead of pulling you out of it. Holding Esc for ~2 s still exits,
// which is the browser's own safety valve. Requires a click or key press to start (browser rule).
export const lockin = {
  active: false,
  supported: !!(document.documentElement.requestFullscreen),
  async enter() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock();
      this.active = true;
    } catch { /* not allowed right now (needs a user gesture) */ }
  },
  async exit() {
    try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch { /* ignore */ }
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ }
    this.active = false;
  },
  toggle() { return document.fullscreenElement ? this.exit() : this.enter(); },
};
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { lockin.active = false; try { navigator.keyboard && navigator.keyboard.unlock && navigator.keyboard.unlock(); } catch { /* ignore */ } } });
