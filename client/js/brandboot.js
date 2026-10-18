// v0.4.8.6 RIMRIFT: the page's entry point. The title screen (ui/brandintro.js) goes up first; main.js, the game, is
// imported once it's entered (index.html preloads it meanwhile, so the start isn't slower).
// Launched from Afterhours16.exe (?launcher): the local service's heartbeat (/api/ping every 5 s, which main.js takes
// over) keeps going while the title screen is up, or the service would think the window was gone. And the click or
// key that enters is the window's first gesture, the one the browser allows to go fullscreen: lock-in (fullscreen and
// keyboard lock, core/lockin.js, as main.js does on the first click or key) starts right there, not a click later.
import { mountBrandIntro } from './ui/brandintro.js';
import { settings } from './core/settings.js';
import { lockin } from './core/lockin.js';

const query = new URLSearchParams(location.search), launcher = query.has('launcher');
const ping = () => fetch('/api/ping', { cache: 'no-store' }).catch(() => {});
if (launcher) ping();
const keepAlive = launcher ? setInterval(ping, 5000) : null;
// (?nointro: straight into the game, for automated browser checks and quick restarts while working on it)
if (!query.has('nointro')) await new Promise(resolve => mountBrandIntro({
  base: new URL('../brand/', import.meta.url).href,
  onEnter: how => {
    // (a pad press is no gesture to the browser: then main.js's first click or key does it, as before)
    if (how !== 'pad' && settings.lockIn && (launcher || window.matchMedia('(display-mode: fullscreen)').matches) && !document.fullscreenElement) lockin.enter();
    resolve();
  },
}));
try { await import('./main.js'); }
catch (error) {
  const message = document.querySelector('#boot .boot-msg');
  if (message) message.textContent = 'RIMRIFT could not start. Refresh to retry.';
  console.error(error);
  throw error;
}
finally { if (keepAlive !== null) clearInterval(keepAlive); }
