// v0.4.8.6 RIMRIFT: the page's entry point.
// v0.4.8.6 quick patch: every time the game starts, in this order (David: "This will be the very first thing you see
// everytime you start the game"):
//  1. the Silverback Studios logo: the gleam, the ding and the flash, the push in to black (ui/opening.js playStudioLogo);
//  2. the title song starts (core/titlemusic.js: "Tusk", from the top) and the RIMRIFT cinematic plays (playCutscene);
//  3. the loading screen (#boot: the logo and the ticker) while main.js, the game, starts up (index.html preloads it);
//  4. the title screen (ui/brandintro.js), up the moment the game is ready (main.js bootDone fires rimrift:booted), over the
//     menus that are already there underneath; the song goes on under it. Entering fades the song out and the soundtrack
//     takes over (core/music.js).
// The logo and the cinematic can be skipped (a click, Enter / Space / Esc, ✕ / A or Start); ?nointro skips all of it,
// straight into the game (automated browser checks, quick restarts while working on it).
// Launched from RIMRIFT.exe (?launcher): the local service's heartbeat (/api/ping every 5 s, which main.js takes over)
// keeps going until the game is up, or the service would think the window was gone. And the first click or key (skipping,
// or entering) is the window's first gesture, the one the browser allows to go fullscreen: lock-in (fullscreen and
// keyboard lock, core/lockin.js, as main.js does on the first click or key) starts right there. A pad press is no gesture
// to the browser: then main.js's first click or key does it, as before.
import { mountBrandIntro } from './ui/brandintro.js';
import { playStudioLogo, playCutscene } from './ui/opening.js';
import { titleMusic } from './core/titlemusic.js';
import { music } from './core/music.js';
import { settings, volumeGain } from './core/settings.js';
import { lockin } from './core/lockin.js';

const query = new URLSearchParams(location.search), launcher = query.has('launcher');
const ping = () => fetch('/api/ping', { cache: 'no-store' }).catch(() => {});
if (launcher) ping();
const keepAlive = launcher ? setInterval(ping, 5000) : null;
const intro = !query.has('nointro');
const brand = new URL('../brand/', import.meta.url).href;
const lock = how => { if (how !== 'pad' && how !== 'end' && how !== 'error' && settings.lockIn && (launcher || window.matchMedia('(display-mode: fullscreen)').matches) && !document.fullscreenElement) lockin.enter(); };

if (intro) {
  titleMusic.preload();
  // (the ding at the sound effects level)
  lock((await playStudioLogo({ base: brand, sound: new URL('../audio/title/ding.mp3', import.meta.url).href, volume: volumeGain(settings.sfx ?? 0.95) })).how);
  titleMusic.play();
  lock((await playCutscene({ base: brand })).how);
}
// (the title screen goes up the moment the game is ready: listening before main.js starts)
const booted = intro ? new Promise(resolve => window.addEventListener('rimrift:booted', resolve, { once: true })) : null;
try { await import('./main.js'); }
catch (error) {
  const message = document.querySelector('#boot .boot-msg');
  if (message) message.textContent = 'RIMRIFT could not start. Refresh to retry.';
  console.error(error);
  throw error;
}
finally { if (keepAlive !== null) clearInterval(keepAlive); }
if (booted) {
  await booted;
  // (the game's own input waits under it, as from Settings → Title screen: the A that enters doesn't press a menu button)
  const app = window.__app;
  if (app?.input) app.input.capturing = true;
  mountBrandIntro({
    base: brand,
    onEnter: how => {
      lock(how);
      if (app?.input) app.input.capturing = false;
      music.start(); // (queued behind the song: it starts once the song has faded, once, however many asked for it)
      titleMusic.stop();
    },
  });
}
