// RIMRIFT — app bootstrap, account/session, screen router and the render loop.
import { Renderer, Camera } from './gfx/renderer.js';
import { Input, PAD } from './core/input.js';
import { lockin } from './core/lockin.js';
import { PadNav, modalOpen } from './ui/padnav.js';
import { audio } from './core/audio.js';
import { music } from './core/music.js';
import { API } from './core/api.js';
import { settings, saveSettings, autoQuality, volumeGain, SETTINGS_KEY } from './core/settings.js';
import { HUD } from './game/hud.js';
import { CameraRig } from './game/camera.js';
import { Showroom } from './game/showroom.js';
import { resolveLook } from './sim/bots.js';
import { refreshSlots, slotOpenedText } from './sim/builds.js';
import { initWorld, setEventVenue, setEventSchedule } from './sim/world.js';
import { watchEvents } from './ui/events.js';
import { $, toast, modal, closeModal, esc } from './ui/common.js';
import * as Screens from './ui/screens.js';
import { togglePhone, phoneOpen } from './ui/phone.js';
import { installErrorCapture, reportBug } from './ui/bugreport.js';
import { initOnline } from './ui/online.js';
import { watchSquads } from './ui/squadwatch.js';
import { watchSeasonReset } from './ui/seasonreset.js';

installErrorCapture(); // v0.4.7.5: errors go along with bug reports

const app = {
  settings, api: new API(), audio,
  profile: null, config: null, catalog: {}, screen: 'home', controller: null, scene: null, fps: 0,
};
window.__app = app;
// v0.4.7.5: F8 anywhere opens Report a bug
window.addEventListener('keydown', e => { if (e.code === 'F8' && app.config) { e.preventDefault(); reportBug(app); } });
window.__audio = audio; // debug handle (headless tests check the crowd bed)

function bootMsg(t, p) { const b = $('#boot'); if (!b) return; $('.boot-msg', b).textContent = t; if (p != null) $('.boot-bar i', b).style.width = `${p * 100}%`; }
// (v0.4.8.6 qp: rimrift:booted first, so brandboot.js puts the title screen up over the menus before the loading screen fades)
function bootDone() { window.dispatchEvent(new CustomEvent('rimrift:booted')); const b = $('#boot'); if (b) { b.classList.add('done'); setTimeout(() => b.remove(), 600); } }

async function boot() {
  bootMsg('Starting renderer…', 0.1);
  try {
    app.renderer = new Renderer($('#world'), settings.quality);
  } catch (e) {
    bootMsg(e.message || 'WebGL2 is required.');
    throw e;
  }
  if (!localStorage.getItem(SETTINGS_KEY)) { settings.quality = autoQuality(app.renderer); app.renderer.setQuality(settings.quality); saveSettings(); }
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
  // launched from RIMRIFT.exe (or lock-in enabled): go fullscreen + lock keys on the first click/key
  const wantLock = () => settings.lockIn && (LAUNCHER || window.matchMedia('(display-mode: fullscreen)').matches);
  const firstGesture = () => { if (wantLock() && !document.fullscreenElement) lockin.enter(); window.removeEventListener('pointerdown', firstGesture, true); window.removeEventListener('keydown', firstGesture, true); };
  window.addEventListener('pointerdown', firstGesture, true);
  window.addEventListener('keydown', firstGesture, true);
  app.hud = new HUD($('#hud'));
  audio.volume.sfx = volumeGain(settings.sfx); audio.volume.crowd = volumeGain(settings.crowd); audio.volume.music = volumeGain(settings.musicVol); // (qp3: perceptual sliders)
  bootMsg('Connecting to the local game service…', 0.3);
  try {
    app.config = await app.api.get('/api/config');
  } catch (e) {
    bootMsg(e.message);
    return;
  }
  app.catalog = Object.fromEntries(app.config.catalog.map(i => [i.id, i]));
  setEventVenue(app.config.event?.venue || null); // v0.4.7.5 qp3: which park event is on (the AI world sends its entrants there)
  // v0.4.8.5 qp4: and the whole schedule, so a game left running across a handover follows it (ui/events.js)
  setEventSchedule(app.config.event_schedule, app.config.server_time);
  app.eventWatch = watchEvents(app);
  app.resetWatch = watchSeasonReset(app, { say: text => toast(text, 'error') }); // (v0.4.8.6 qp: the season reset: warn, then reload onto the fresh account)
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
  initOnline(app).catch(e => console.error(e)); // v0.4.7.5 qp3: real friends, invites and online games (from your own copy too)
  // v0.4.8.6 qp: the ICON Squad event: a toast when a squad of ICONs shows up at a park, once a squad, looked at every 25 s
  // (never during a game). The first look waits for the sign-in toasts to go by
  if (!app.squadWatch) { app.squadWatch = watchSquads(app, { say: text => toast(text, 'squad') }); setTimeout(() => app.squadWatch.check(), 10000); }
  const chars = app.profile.characters;
  if (!chars.length) { app.selectedId = null; Screens.go(app, 'create'); return; }
  app.selectedId = chars.find(c => c.id === settings.character)?.id || chars[0].id;
  Screens.go(app, 'home');
  noteBadgeUpdates(app);
}

// v0.4.8.5: badges that caught up with the current requirements as the profile loaded (a lowered mark, Handles for
// Days counting games already played): said once, the way a game's results say it
function noteBadgeUpdates(app) {
  const ups = app.profile?.badge_updates || [];
  const names = ['', 'Bronze', 'Silver', 'Gold', 'Hall of Fame'];
  // (one line per build: the toast shows one message at a time)
  ups.forEach((u, k) => setTimeout(() => {
    const parts = (u.upgraded || []).map(b => `${b.name} is now ${names[b.tier] || 'up'}`);
    if (u.icon_unlocked) parts.push(`Icon badge unlocked: ${app.config.icon_badges?.[u.icon_unlocked]?.name || u.icon_unlocked}`);
    if (u.cap_breakers_awarded) parts.push(`+${u.cap_breakers_awarded} cap breakers`);
    if (parts.length) toast(`${u.name}: ${parts.join(' · ')}`, 'good');
  }, 900 + k * 4200));
  // v0.4.8.5 qp7: then the build slots this load opened (a build that was an ICON before the patch, or just became one)
  const opened = app.profile?.build_slot_unlocked;
  if (opened) setTimeout(() => toast(slotOpenedText(opened), 'good'), 900 + ups.length * 4200);
}

app.char = () => app.profile?.characters.find(c => c.id === app.selectedId) || null;
app.look = (char, override = {}) => resolveLook({ ...char, name: char.name }, app.catalog, override);
app.refresh = async () => { app.profile = await app.api.get('/api/me'); Screens.updateTopbar(app); return app.profile; };
// v0.4.8.5 qp7: every response that brings a build back comes through here, so this is where the account's build slots
// (profile.build_slots) stay current. When they go up (a build just became an ICON: a game, an upgrade, cap breakers)
// it says so once, a moment later so the action's own toast is read first (the results screen says it too)
app.replaceChar = c => {
  const p = app.profile, i = p.characters.findIndex(x => x.id === c.id);
  if (i >= 0) p.characters[i] = c; else p.characters.push(c);
  const up = refreshSlots(p);
  if (up) setTimeout(() => toast(slotOpenedText(up), 'good'), 1600);
};
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
window.addEventListener('beforeunload', e => { if (app.seasonResetting) return; if (app.mode === 'match' || (app.mode === 'park' && app.world?.mode === 'match')) { e.preventDefault(); e.returnValue = ''; } });

window.addEventListener('error', e => { if (!app._errShown && e.message) { app._errShown = true; console.error(e.error || e.message); } });
boot();
