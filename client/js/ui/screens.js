// Screen router, top bar, auth, home, settings and FPS overlay.
import { $, $$, esc, money, toast, modal, closeModal, heightStr, title } from './common.js';
import { padGlyph, promptGlyph, KEYMAP, PADMAP, REMAP_KEYS, REMAP_PAD, PAD, PAD_BINDABLE } from '../core/input.js';
import { lockin } from '../core/lockin.js';
import { settings, saveSettings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { music } from '../core/music.js';
import { QUALITY } from '../gfx/renderer.js';
import { AFFILIATIONS } from '../world/themes.js';
import { ARCHETYPES } from '../sim/builds.js';
import * as Builder from './builder.js';
import * as MyPlayer from './myplayer.js';
import * as Store from './store.js';
import * as Modes from './modes.js';
import * as Phone from './phone.js';
import * as Stats from './stats.js';
import * as Codes from './codes.js';

const NAV = [['home', 'Home'], ['myplayer', 'MyPlayer'], ['store', 'VC Store'], ['park', 'The Park'], ['proam', 'Pro-Am'], ['practice', 'Practice'], ['stats', 'Stats'], ['codes', 'Locker Codes']];

export function go(app, name, params = {}) {
  app.screen = name;
  audio.ui('click');
  const ui = $('#ui');
  if (app.mode === 'park' || app.mode === 'match') { if (name !== 'park-hub') Modes.leaveWorld(app); }
  app.mode = 'menu';
  $('#hud').hidden = true;
  $('#prompt').innerHTML = '';
  app.setController(app.showroom, app.showroom.scene);
  if (audio.unlocked) music.start();
  music.setSuppressed(false); music.duck(false);
  ui.className = 'layer menu-layer';
  ui.innerHTML = `${topbar(app)}<main class="screen screen-${name}" id="screen"></main>`;
  bindTopbar(app);
  const root = $('#screen');
  const char = app.char();
  if (char) { app.showroom.setCharacter(char, app.look(char)); app.showroom.setAccent(char.affiliation ? AFFILIATIONS[char.affiliation].color : '#ffd84a'); }
  app.showroom.setFocus('full'); app.showroom.setPreview('idle');
  switch (name) {
    case 'home': return home(app, root);
    case 'create': return Builder.create(app, root, params);
    case 'myplayer': return MyPlayer.render(app, root, params);
    case 'store': return Store.render(app, root, params);
    case 'park': return Modes.parkEntry(app, root, params);
    case 'proam': return Modes.proam(app, root, params);
    case 'practice': return Modes.practice(app, root, params);
    case 'stats': return Stats.render(app, root, params);
    case 'codes': return Codes.render(app, root, params);
    default: return home(app, root);
  }
}

function topbar(app) {
  const c = app.char();
  return `<header class="topbar">
    <div class="brand" data-go="home">AFTERHOURS<b>16</b><small>v${esc(app.config.version)}</small></div>
    <nav class="tabs">${NAV.map(([id, label]) => `<button class="tab ${app.screen === id || (id === 'myplayer' && app.screen === 'create') ? 'on' : ''}" data-go="${id}" ${!c && id !== 'home' ? 'disabled' : ''}>${label.replace(/^(Locker |The |VC )/, '<span class="tab-lg">$1</span>')}</button>`).join('')}</nav>
    <div class="tb-right">
      ${c ? `<button class="pill rep" data-go="myplayer" title="Park Rep">${esc(c.rep.label)}</button>` : ''}
      <span class="pill vc" id="vc-pill" title="Virtual Currency (fictional)"><i>VC</i>${money(app.profile?.balance)}</span>
      ${c ? `<button class="pill who" data-switch title="Switch player"><b>${c.overall}</b>${esc(c.name)}</button>` : ''}
      ${c && app.ai ? `<button class="pill social" data-phone title="Social phone (O, or LB + RB)"><i class="ph-dot on"></i>Social</button>` : ''}
      <button class="icon-btn" data-settings title="Settings">⚙</button>
      ${LAUNCHED ? '<button class="icon-btn quit" data-quit title="Quit to desktop">⏻</button>' : ''}
    </div>
  </header>`;
}
export function updateTopbar(app) { const el = $('#vc-pill'); if (el) el.innerHTML = `<i>VC</i>${money(app.profile?.balance)}`; }
function bindTopbar(app) {
  $$('[data-go]').forEach(b => b.onclick = () => go(app, b.dataset.go));
  const s = $('[data-settings]'); if (s) s.onclick = () => openSettings(app);
  const ph = $('[data-phone]'); if (ph) ph.onclick = () => Phone.openPhone(app);
  const sw = $('[data-switch]'); if (sw) sw.onclick = () => MyPlayer.switcher(app);
  const q = $('[data-quit]'); if (q) q.onclick = () => confirmQuit();
}

// Launched from Afterhours16.exe: a real "quit to desktop" (Esc is captured while the window is locked in)
export const LAUNCHED = new URLSearchParams(location.search).has('launcher');
export function confirmQuit() {
  if (!LAUNCHED) return;
  const card = modal(`
    <h2>Quit Afterhours 16?</h2>
    <p class="muted">Your progress is saved after every game.</p>
    <div class="col gap"><button class="btn primary" data-yes>Quit to desktop</button><button class="btn" data-no>Cancel</button></div>`);
  card.querySelector('[data-no]').onclick = () => closeModal();
  card.querySelector('[data-yes]').onclick = async () => {
    closeModal();
    try { await lockin.exit(); } catch {}
    try { await fetch('/api/quit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch {}
    window.close();
    setTimeout(() => { document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;color:#ccc;font:16px system-ui">Afterhours 16 has stopped. You can close this window.</div>'; }, 600);
  };
}

export function showAuth(app, mode = 'login') {
  const card = modal(`
    <div class="auth">
      <div class="eyebrow">WELCOME TO</div>
      <h1 class="logo-big">AFTERHOURS<b>16</b></h1>
      <p class="muted">An original basketball game: run The Park, build a Pro-Am squad, and spend your VC. New accounts get <b>1,000,000 fictional VC</b> once.</p>
      ${app.config.dev_accounts ? `<button class="btn primary wide" data-local>Start local session</button><div class="divider">or use an account</div>` : ''}
      <div class="seg"><button data-mode="login" class="${mode === 'login' ? 'on' : ''}">Sign in</button><button data-mode="register" class="${mode === 'register' ? 'on' : ''}">Create account</button></div>
      <form id="auth-form" class="form">
        <label>Username<input name="username" required minlength="3" maxlength="24" autocomplete="username"></label>
        <label>Password<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}"></label>
        <button class="btn wide" type="submit">${mode === 'register' ? 'Create account' : 'Sign in'}</button>
        <div class="form-error" id="auth-err"></div>
      </form>
    </div>`, { close: false, cls: 'auth-card' });
  const local = card.querySelector('[data-local]');
  if (local) local.onclick = async () => { local.disabled = true; try { app.profile = await app.api.post('/api/dev-account', {}); app.afterLogin(); } catch (e) { $('#auth-err').textContent = e.message; local.disabled = false; } };
  card.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => showAuth(app, b.dataset.mode));
  card.querySelector('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { app.profile = await app.api.post(mode === 'register' ? '/api/register' : '/api/login', { username: f.get('username'), password: f.get('password') }); app.afterLogin(); }
    catch (err) { $('#auth-err').textContent = err.message; }
  };
}

function home(app, root) {
  const c = app.char();
  if (!c) return Builder.create(app, root);
  const aff = c.affiliation ? AFFILIATIONS[c.affiliation] : null;
  const pr = c.progression || {};
  const rep = c.rep;
  const repPct = rep.next ? Math.round((rep.points - rep.floor) / (rep.next - rep.floor) * 100) : 100;
  const team = app.profile.proam_team;
  const career = pr.career || {};
  const games = pr.games || 0;
  root.innerHTML = `
    <section class="panel home-left">
      <div class="eyebrow">${esc(c.position)} · ${esc(ARCHETYPES[c.archetype]?.label || title(c.archetype))} · ${heightStr(c.height)} · ${c.weight} lb</div>
      <h1 class="player-name">${esc(c.name)}</h1>
      <div class="ovr-row"><div class="ovr"><b>${c.overall}</b><small>OVR</small></div>
        <div class="ovr-side"><div class="muted small">MAX POTENTIAL ${c.max_overall}</div>
        <div class="rep-line"><span>${esc(rep.label)}</span><span class="muted">${money(rep.points)} REP</span></div>
        <span class="bar rep-bar"><i style="width:${repPct}%"></i></span></div></div>
      <div class="stat-strip">
        <div><b>${pr.wins || 0}-${(pr.games || 0) - (pr.wins || 0)}</b><small>RECORD</small></div>
        <div><b>${games ? ((career.pts || 0) / games).toFixed(1) : '0.0'}</b><small>PPG</small></div>
        <div><b>${games ? ((career.ast || 0) / games).toFixed(1) : '0.0'}</b><small>APG</small></div>
        <div><b>${games ? ((career.reb || 0) / games).toFixed(1) : '0.0'}</b><small>RPG</small></div>
        <div><b>${pr.park?.best_streak || 0}</b><small>BEST STREAK</small></div>
      </div>
      <div class="tiles">
        <button class="tile big park" data-go="park" style="--c:${aff ? aff.color : '#ffd84a'}"><span class="tile-k">THE PARK</span><b>${aff ? esc(aff.park) : 'Choose your affiliation'}</b><small>${aff ? esc(aff.name) + ' · 2v2 & 3v3 · Got Next' : 'Harbor Kings · Old Brick Society · Foundry Rivets'}</small></button>
        <button class="tile proam" data-go="proam"><span class="tile-k">PRO-AM</span><b>${team ? esc(team.name) : 'Build your team'}</b><small>${team ? `${team.wins}-${team.losses} · 5v5 arena` : '5v5 · your court, your colors'}</small></button>
        <button class="tile store" data-go="store"><span class="tile-k">VC STORE</span><b>Apparel · Shoes · Animations</b><small>${Object.keys(app.catalog).length} items</small></button>
        <button class="tile practice" data-go="practice"><span class="tile-k">PRACTICE</span><b>Union Fieldhouse</b><small>Shootaround · 1-on-1</small></button>
        <button class="tile mp" data-go="myplayer"><span class="tile-k">MYPLAYER</span><b>Attributes & Badges</b><small>Max cost ${money(c.max_upgrade_cost)} VC</small></button>
      </div>
      <div class="controls-hint muted small">Tip: hold ${promptGlyph(app.input, 'Space', 'X')} to shoot and let go at the top of your jump — a green release always goes in unless it's blocked. ${app.input.usingPad ? `${padGlyph(app.input.gp.family, 'RS')} click` : '<kbd>Tab</kbd>'} in-game shows all controls.</div>
    </section>`;
  $$('[data-go]', root).forEach(b => b.onclick = () => go(app, b.dataset.go));
  app.showroom.setPreview('dribble');
}

export function openSettings(app) {
  const card = modal(`
    <h2>Settings</h2>
    <div class="settings-grid">
      <label>Graphics<select data-k="quality">${Object.entries(QUALITY).map(([k, v]) => `<option value="${k}" ${settings.quality === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label>Default camera<select data-k="camera"><option value="2k" ${settings.camera === '2k' ? 'selected' : ''}>2K Cam</option><option value="broadcast" ${settings.camera === 'broadcast' ? 'selected' : ''}>Broadcast</option><option value="player" ${settings.camera === 'player' ? 'selected' : ''}>Player Lock</option></select></label>
      <label>AI difficulty<select data-k="difficulty">${[[0.35, 'Rookie'], [0.6, 'Pro'], [0.8, 'All-Star'], [0.95, 'Hall of Fame']].map(([v, l]) => `<option value="${v}" ${Math.abs(settings.difficulty - v) < 0.01 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Music<select data-k="music"><option value="1" ${settings.music ? 'selected' : ''}>On</option><option value="0" ${!settings.music ? 'selected' : ''}>Off</option></select></label>
      <label>Effects volume<input type="range" min="0" max="1" step="0.05" data-k="sfx" value="${settings.sfx}"></label>
      <label>Crowd volume<input type="range" min="0" max="1" step="0.05" data-k="crowd" value="${settings.crowd}"></label>
      <label>Music volume<input type="range" min="0" max="1" step="0.05" data-k="musicVol" value="${settings.musicVol}"></label>
      <label>Name tags<select data-k="tags"><option value="1" ${settings.tags ? 'selected' : ''}>Show</option><option value="0" ${!settings.tags ? 'selected' : ''}>Hide</option></select></label>
      <label>FPS counter<select data-k="showFps"><option value="0" ${!settings.showFps ? 'selected' : ''}>Off</option><option value="1" ${settings.showFps ? 'selected' : ''}>On</option></select></label>
    </div>
    <h3>Controller & window</h3>
    <div class="settings-grid">
      <label>Vibration<select data-k="vibration"><option value="1" ${settings.vibration ? 'selected' : ''}>On</option><option value="0" ${!settings.vibration ? 'selected' : ''}>Off</option></select></label>
      <label>Stick deadzone<input type="range" min="0.06" max="0.32" step="0.01" data-k="deadzone" value="${settings.deadzone}"></label>
      <label>Button prompts<select data-k="prompts">${[['auto', 'Auto-detect'], ['xbox', 'Xbox'], ['ps', 'PlayStation'], ['switch', 'Switch Pro']].map(([v, l]) => `<option value="${v}" ${settings.prompts === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Park camera Y<select data-k="invertY"><option value="0" ${!settings.invertY ? 'selected' : ''}>Normal</option><option value="1" ${settings.invertY ? 'selected' : ''}>Inverted</option></select></label>
      <label>Fullscreen lock-in<select data-k="lockIn"><option value="1" ${settings.lockIn ? 'selected' : ''}>On (F11)</option><option value="0" ${!settings.lockIn ? 'selected' : ''}>Off</option></select></label>
      <label>Shot meter<select data-k="shotMeter"><option value="1" ${settings.shotMeter !== false ? 'selected' : ''}>On</option><option value="0" ${settings.shotMeter === false ? 'selected' : ''}>Off (+10% green window)</option></select></label>
      <label>Shot feedback<select data-k="shotFeedback"><option value="1" ${settings.shotFeedback !== false ? 'selected' : ''}>On</option><option value="0" ${settings.shotFeedback === false ? 'selected' : ''}>Off</option></select></label>
      <label>Locked-In grade<select data-k="gradeHud"><option value="1" ${settings.gradeHud !== false ? 'selected' : ''}>Show</option><option value="0" ${settings.gradeHud === false ? 'selected' : ''}>Hide</option></select></label>
      <label>Pause on focus loss<select data-k="pauseOnBlur"><option value="1" ${settings.pauseOnBlur ? 'selected' : ''}>On</option><option value="0" ${!settings.pauseOnBlur ? 'selected' : ''}>Off</option></select></label>
    </div>
    <div class="row gap" style="align-items:center;justify-content:space-between"><h3>Controls</h3><button class="btn small" data-remap>Remap buttons…</button></div>${controlsTable(app)}
    <div class="row gap end"><button class="btn ghost" data-logout>Sign out</button><button class="btn primary" data-close>Done</button></div>`, { wide: true });
  card.querySelectorAll('[data-k]').forEach(el => el.onchange = el.oninput = () => {
    const k = el.dataset.k;
    let v = el.value;
    if (['sfx', 'crowd', 'musicVol', 'difficulty', 'deadzone'].includes(k)) v = +v;
    if (['music', 'tags', 'showFps', 'vibration', 'proStickShoot', 'invertY', 'lockIn', 'pauseOnBlur', 'gradeHud', 'shotMeter', 'shotFeedback'].includes(k)) v = v === '1';
    settings[k] = v; saveSettings();
    if (k === 'quality') app.renderer.setQuality(v);
    if (k === 'camera') app.cameraRig.mode = v;
    if (k === 'sfx') audio.volume.sfx = v; if (k === 'crowd') audio.volume.crowd = v; if (k === 'musicVol') { audio.volume.music = v; if (audio.musicBus) audio.musicBus.gain.value = v; }
    if (k === 'music') { if (v) music.start(); else music.stop(); }
    if (k === 'musicVol') music.setVolume(v);
    if (k === 'showFps' && !v) { const f = $('#fps'); if (f) f.remove(); }
    if (['vibration', 'deadzone', 'proStickShoot', 'invertY', 'prompts'].includes(k)) app.applyInputSettings();
    if (k === 'vibration' && v) app.input.rumble(0.4, 0.4, 150);
    if (k === 'lockIn') { if (v) lockin.enter(); else lockin.exit(); }
    if (audio.sfx) audio.sfx.gain.value = audio.volume.sfx;
  });
  card.querySelector('[data-remap]').onclick = () => openRemap(app);
  card.querySelector('[data-logout]').onclick = async () => { try { await app.api.post('/api/logout', {}); } catch { /* ignore */ } location.reload(); };
}

export function controlsTable(app) {
  const inp = app?.input;
  const fam = inp?.gp?.connected ? inp.gp.family : 'xbox';
  const G = b => b.split('+').map(x => padGlyph(fam, x.trim())).join('+');
  const P = a => G(inp ? inp.padLabel(a) : a);
  const K = (...acts) => acts.map(a => inp ? inp.keyLabel(a) : a).join(' · ');
  const rows = [
    ['Offense', null, null],
    ['Move / sprint', `${K('up', 'left', 'down', 'right')} / ${K('sprint')}`, `${G('LS')} / ${P('sprint')}`],
    ['Shoot — hold, release at the top (green = guaranteed make; never while smothered)', K('shoot'), P('shoot')],
    ['Bailout — pass out of your jumper before the release', `${K('pass')} while shooting`, `${P('pass')} while shooting`],
    ['Attack the rim — dunk if you can, otherwise your best finish', K('dunk'), `${G('RS')} down while sprinting`],
    ['Pump fake', `Tap ${K('shoot')}`, `Tap ${P('shoot')}`],
    ['Pass (aims with your stick) / bounce / lob', K('pass', 'bounce', 'lob'), `${P('pass')} / ${P('bounce')} / ${P('lob')}`],
    ['Alley-oop', K('alley'), `${P('alleyMod')}+${P('lob')}`],
    ['Icon pass to a teammate', '1 2 3 4', `${P('mod')} + ${P('pass')}/${P('bounce')}/${P('shoot')}/${P('lob')}`],
    ['Crossover · in-and-out', K('stickLeft', 'stickRight'), `Flick ${G('RS')} left / right`],
    ['Hesitation · step-back', K('stickUp', 'stickDown'), `Flick ${G('RS')} up / down`],
    ['Spin · behind-the-back', K('spin', 'btb'), `Rotate ${G('RS')} / flick down while moving`],
    ['Call screen · call for the ball', `${K('screen')} · ${K('pass')} (no ball)`, `Tap ${P('mod')} · ${P('pass')} (no ball)`],
    ['Defense', null, null],
    ['Defensive stance (slide)', `Hold ${K('defense')}`, `Hold ${P('defense')}`],
    ['Steal · block / rebound jump · hands up', K('steal', 'block', 'handsUp'), `${P('steal')} · ${P('block')} · ${G('RS')} up`],
    ['Hands: reach left / right · low swipe', `${K('stickLeft')} / ${K('stickRight')} · ${K('stickDown')}`, `Flick ${G('RS')} left / right · down`],
    ['Hands: hold up = contest · hold to a side = hand in the lane', `Hold ${K('stickUp')} · hold ${K('stickLeft')} / ${K('stickRight')}`, `Hold ${G('RS')} up · left / right`],
    ['Game', null, null],
    ['Celebrate · camera · controls', K('celebrate', 'camera', 'help'), `${P('celebrate')} · ${P('camera')} · ${G('RS')} click`],
    ['Pause · fullscreen lock-in', 'Esc · F11', `${G('MENU')} · —`],
    ['Social phone (park and menus)', K('social'), `${G('LB')} + ${G('RB')}`],
    ['Menus', 'Mouse', `${G('LS')}/D-pad move · ${G('A')} select · ${G('B')} back · ${G('LB')}/${G('RB')} tabs`],
  ];
  return `<table class="controls"><thead><tr><th>Action</th><th>Keyboard / mouse</th><th>Controller</th></tr></thead><tbody>${rows.map(r => r[1] == null ? `<tr class="sec"><td colspan="3">${r[0]}</td></tr>` : `<tr><td>${r[0]}</td><td><kbd>${esc(r[1])}</kbd></td><td>${r[2]}</td></tr>`).join('')}</tbody></table>`;
}

// ---- v0.4.1: button remapping ----
const NO_BIND = new Set(['Escape', 'F11', 'MetaLeft', 'MetaRight', 'ContextMenu', 'F5']);
export function openRemap(app) {
  const inp = app.input;
  if (!settings.binds) settings.binds = { key: {}, pad: {} };
  const B = settings.binds; B.key = B.key || {}; B.pad = B.pad || {};
  let stop = null;
  const done = () => { if (stop) { stop(); stop = null; } inp.capturing = false; };
  const save = () => { saveSettings(); app.applyInputSettings(); render(); };
  const render = () => {
    const fam = inp.gp.connected ? inp.gp.family : 'xbox';
    const kRows = REMAP_KEYS.map(([a, label]) => `<tr><td>${esc(label)}</td><td><button class="bind ${B.key[a] ? 'custom' : ''}" data-bk="${a}">${esc(inp.keyLabel(a))}</button></td></tr>`).join('');
    // flag two actions that would fight over one button in the same situation
    const OFF = ['shoot', 'pass', 'bounce', 'lob', 'alleyMod', 'mod', 'sprint', 'camera', 'celebrate'], DEF = ['defense', 'steal', 'block', 'sprint', 'camera', 'celebrate'];
    const clash = a => [OFF, DEF].some(set => set.includes(a) && set.some(o => o !== a && inp.padmap[o] === inp.padmap[a]));
    const pRows = REMAP_PAD.map(([a, label]) => `<tr><td>${esc(label)}${clash(a) ? ' <span class="clash" title="Another action in the same situation uses this button">⚠ shared</span>' : ''}</td><td><button class="bind ${B.pad[a] ? 'custom' : ''}" data-bp="${a}">${padGlyph(fam, inp.padmap[a])}</button></td></tr>`).join('');
    const card = modal(`
      <h2>Remap buttons</h2>
      <p class="muted small">Pick an action, then press the new key or controller button. To use a mouse button, click it on the highlighted binding. Esc cancels. Offense and defense actions may share a button, as they do by default. Changes save automatically.</p>
      <div class="remap-cols">
        <div><h3>Keyboard &amp; mouse</h3><table class="controls remap">${kRows}</table></div>
        <div><h3>Controller</h3><table class="controls remap">${pRows}</table>
          <p class="muted small">Always the same: left stick moves, the right stick is only for dribble moves and (down while sprinting) attacking the rim, ${padGlyph(fam, 'MENU')} pauses, and menus use the D-pad, ${padGlyph(fam, 'A')} and ${padGlyph(fam, 'B')}.</p></div>
      </div>
      <div class="row gap end"><button class="btn ghost" data-reset>Reset to defaults</button><button class="btn primary" data-close>Done</button></div>`, { wide: true });
    closeModal.onClose = done;
    card.querySelector('[data-reset]').onclick = () => { done(); B.key = {}; B.pad = {}; settings.binds = B; save(); toast('Controls reset to defaults'); };
    card.querySelectorAll('[data-bk]').forEach(btn => btn.onclick = () => listenKey(btn, btn.dataset.bk));
    card.querySelectorAll('[data-bp]').forEach(btn => btn.onclick = () => listenPad(btn, btn.dataset.bp));
  };
  const listenKey = (btn, action) => {
    done();
    inp.capturing = true;
    btn.textContent = 'Press a key (or click here)…'; btn.classList.add('listening');
    const finish = code => {
      done();
      if (code) { if (code === (KEYMAP_DEFAULT(action))) delete B.key[action]; else B.key[action] = code; }
      save();
    };
    const kd = e => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code === 'Escape') return finish(null);
      if (NO_BIND.has(e.code)) return;
      finish(e.code);
    };
    // mouse buttons bind by clicking them on the highlighted button; clicking anywhere else cancels
    const md = e => {
      if (e.target !== btn) { done(); render(); return; }
      e.preventDefault(); e.stopImmediatePropagation();
      finish('Mouse' + e.button);
    };
    window.addEventListener('keydown', kd, true);
    setTimeout(() => window.addEventListener('mousedown', md, true), 0);
    stop = () => { window.removeEventListener('keydown', kd, true); window.removeEventListener('mousedown', md, true); };
  };
  const listenPad = (btn, action) => {
    done();
    if (!inp.gp.connected) { toast('Connect a controller (press any button on it) first'); return; }
    inp.capturing = true;
    btn.textContent = 'Press a button…'; btn.classList.add('listening');
    const names = PAD_BINDABLE.map(nm => [nm, PAD[nm]]);
    let armed = false, raf = 0, alive = true;
    const t0 = performance.now();
    const kd = e => { if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(); render(); } };
    const tick = () => {
      if (!alive) return;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const p = pads && pads[inp.gp.index];
      const pressed = p ? names.filter(([, i]) => p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5)) : [];
      if (!armed) { if (!pressed.length) armed = true; }
      else if (pressed.length) {
        const nm = pressed[0][0];
        done();
        if (nm === PADMAP_DEFAULT(action)) delete B.pad[action]; else B.pad[action] = nm;
        save(); return;
      }
      if (performance.now() - t0 > 8000) { done(); render(); return; }
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('keydown', kd, true);
    raf = requestAnimationFrame(tick);
    stop = () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('keydown', kd, true); };
  };
  render();
}
const KEYMAP_DEFAULT = a => (KEYMAP[a] || []).find(c => !c.startsWith('Mouse'));
const PADMAP_DEFAULT = a => PADMAP[a];

export function showFps(app) {
  let el = $('#fps');
  if (!el) { el = document.createElement('div'); el.id = 'fps'; el.className = 'fps'; document.body.appendChild(el); }
  const s = app.renderer.ctx.stats;
  el.textContent = `${app.fps} FPS · ${s.draws} draws · ${Math.round(s.tris / 1000)}k tris · ${app.renderer.qualityName}`;
}
