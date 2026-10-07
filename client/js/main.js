// Afterhours 16 v0.4.4 — app bootstrap, account/session, screen router and the render loop.
import { Renderer, Camera } from './gfx/renderer.js';
import { Input, PAD } from './core/input.js';
import { lockin } from './core/lockin.js';
import { PadNav, modalOpen } from './ui/padnav.js';
import { audio } from './core/audio.js';
import { music } from './core/music.js';
import { API } from './core/api.js';
import { settings, saveSettings, autoQuality } from './core/settings.js';
import { HUD } from './game/hud.js';
import { CameraRig } from './game/camera.js';
import { Showroom } from './game/showroom.js';
import { resolveLook } from './sim/bots.js';
import { initWorld } from './sim/world.js';
import { $, toast, modal, closeModal, esc } from './ui/common.js';
import * as Screens from './ui/screens.js';
import { togglePhone, phoneOpen } from './ui/phone.js';

const app = {
  settings, api: new API(), audio,
  profile: null, config: null, catalog: {}, screen: 'home', controller: null, scene: null, fps: 0,
};
window.__app = app;
window.__audio = audio; // debug handle (headless tests check the crowd bed)

function bootMsg(t, p) { const b = $('#boot'); if (!b) return; $('.boot-msg', b).textContent = t; if (p != null) $('.boot-bar i', b).style.width = `${p * 100}%`; }
function bootDone() { const b = $('#boot'); if (b) { b.classList.add('done'); setTimeout(() => b.remove(), 600); } }

async function boot() {
  bootMsg('Starting renderer…', 0.1);
  try {
    app.renderer = new Renderer($('#world'), settings.quality);
  } catch (e) {
    bootMsg(e.message || 'WebGL2 is required.');
    throw e;
  }
  if (!localStorage.getItem('afterhours16.settings.v3')) { settings.quality = autoQuality(app.renderer); app.renderer.setQuality(settings.quality); saveSettings(); }
  app.camera = new Camera();
  app.cameraRig = new CameraRig(app.camera);
  app.cameraRig.mode = settings.camera;
  app.input = new Input();
  applyInputSettings();
  app.padnav = new PadNav(app);
  app.input.onFocusLost = () => { if (settings.pauseOnBlur && app.onFocusLost) app.onFocusLost(); };
  app.input.onPadChange = (on, gp) => toast(on ? `Controller connected (${gp.family === 'ps' ? 'PlayStation' : gp.family === 'switch' ? 'Switch Pro' : 'Xbox'} layout)` : 'Controller disconnected');
  // F11 = our own fullscreen + keyboard lock (the browser's F11 can't lock keys)
  window.addEventListener('keydown', e => { if (e.code === 'F11') { e.preventDefault(); lockin.toggle(); } });
  // launched from Afterhours16.exe (or lock-in enabled): go fullscreen + lock keys on the first click/key
  const wantLock = () => settings.lockIn && (LAUNCHER || window.matchMedia('(display-mode: fullscreen)').matches);
  const firstGesture = () => { if (wantLock() && !document.fullscreenElement) lockin.enter(); window.removeEventListener('pointerdown', firstGesture, true); window.removeEventListener('keydown', firstGesture, true); };
  window.addEventListener('pointerdown', firstGesture, true);
  window.addEventListener('keydown', firstGesture, true);
  app.hud = new HUD($('#hud'));
  audio.volume.sfx = settings.sfx; audio.volume.crowd = settings.crowd; audio.volume.music = settings.musicVol;
  bootMsg('Connecting to the local game service…', 0.3);
  try {
    app.config = await app.api.get('/api/config');
  } catch (e) {
    bootMsg(e.message);
    return;
  }
  app.catalog = Object.fromEntries(app.config.catalog.map(i => [i.id, i]));
  bootMsg('Building the studio…', 0.6);
  app.showroom = new Showroom(app);
  app.scene = app.showroom.scene;
  app.controller = app.showroom;
  requestAnimationFrame(loop);
  bootMsg('Checking your account…', 0.85);
  if (!app.config.signed_in) Screens.showAuth(app);
  else {
    try {
      app.profile = await app.api.get('/api/me');
      afterLogin();
    } catch (e) {
      if (e.status === 401) Screens.showAuth(app); else toast(e.message, 'error');
    }
  }
  bootDone();
  // music starts on first interaction
  // v0.4.4 soundtrack starts on the first interaction (browsers block audio before one)
  const startMusic = () => { music.start(); window.removeEventListener('pointerdown', startMusic); window.removeEventListener('keydown', startMusic); };
  window.addEventListener('pointerdown', startMusic); window.addEventListener('keydown', startMusic);
}

app.afterLogin = afterLogin;
function afterLogin() {
  closeModal();
  initWorld(app); // v0.4.4: this account's persistent AI population (friends, squad, who you've played with)
  const chars = app.profile.characters;
  if (!chars.length) { app.selectedId = null; Screens.go(app, 'create'); return; }
  app.selectedId = chars.find(c => c.id === settings.character)?.id || chars[0].id;
  Screens.go(app, 'home');
}

app.char = () => app.profile?.characters.find(c => c.id === app.selectedId) || null;
app.look = (char, override = {}) => resolveLook({ ...char, name: char.name }, app.catalog, override);
app.refresh = async () => { app.profile = await app.api.get('/api/me'); Screens.updateTopbar(app); return app.profile; };
app.replaceChar = c => { const i = app.profile.characters.findIndex(x => x.id === c.id); if (i >= 0) app.profile.characters[i] = c; else app.profile.characters.push(c); };
app.setBalance = b => { if (app.profile && b != null) { app.profile.balance = b; Screens.updateTopbar(app); } };

// Switch what the main loop renders/updates
app.setController = (controller, scene) => {
  if (app.controller && app.controller !== controller && app.controller.deactivate) app.controller.deactivate();
  app.controller = controller;
  app.scene = scene;
};

app.applyInputSettings = applyInputSettings;
function applyInputSettings() {
  const inp = app.input;
  inp.vibration = settings.vibration; inp.deadzone = settings.deadzone; inp.proStickShoot = settings.proStickShoot;
  inp.applyBinds(settings.binds || {});
  inp.forceFamily = settings.prompts === 'auto' ? null : settings.prompts;
  if (app.cameraRig) app.cameraRig.invertY = settings.invertY;
}
app.modalOpen = modalOpen;
app.onFocusLost = () => { if (app.controller && app.controller.onFocusLost) app.controller.onFocusLost(); };

let last = performance.now(), fpsAcc = 0, fpsN = 0;
function loop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const inp = app.input;
  app.frames = (app.frames || 0) + 1;
  inp.pollGamepad(dt);
  if (inp.forceFamily && inp.gp.connected) inp.gp.family = inp.forceFamily;
  if (!audio.unlocked && inp.gp.connected && inp.gp.buttons.some(b => b)) { audio.unlocked = true; audio.ensure(); }
  try {
    // menus first: the controller drives the focus ring and consumes the buttons it uses
    app.padnav.update(dt);
    if (app.mode === 'menu' && !modalOpen()) inp.ctx = 'menu';
    // v0.4.4 social phone: LB + RB (L1 + R1) or O, anywhere outside a live game
    if (app.ai && inp.wasPressed('social') && app.mode !== 'match' && !(app.mode === 'park' && app.world?.mode !== 'roam') && (!modalOpen() || phoneOpen())) togglePhone(app);
    if (app.controller) app.controller.frame(dt);
    if (app.scene) app.renderer.render(app.scene, app.camera, dt);
  } catch (e) {
    console.error(e);
    if (!app._errShown) { app._errShown = true; toast('Render error: ' + e.message, 'error'); }
  }
  audio.update(dt);
  app.input.endFrame();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { app.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; if (settings.showFps) Screens.showFps(app); }
  requestAnimationFrame(loop);
}

// keep the local service alive while the game window is open (it exits on its own after the window closes)
const LAUNCHER = new URLSearchParams(location.search).has('launcher');
if (LAUNCHER) setInterval(() => { fetch('/api/ping', { cache: 'no-store' }).catch(() => {}); }, 5000);
window.addEventListener('beforeunload', e => { if (app.mode === 'match' || (app.mode === 'park' && app.world?.mode === 'match')) { e.preventDefault(); e.returnValue = ''; } });

window.addEventListener('error', e => { if (!app._errShown && e.message) { app._errShown = true; console.error(e.error || e.message); } });
boot();
