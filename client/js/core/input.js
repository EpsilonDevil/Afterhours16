// Unified keyboard / mouse / gamepad input (v0.4).
// - Keyboard & mouse edges are kept until the frame ends; the match session buffers them further so a
//   press is never lost on high-refresh displays or while an animation is finishing.
// - Gamepads use the browser "standard" mapping (Xbox layout), radial deadzones, analog triggers,
//   pro-stick flick / hold / rotate detection, rumble, and controller-family detection for button glyphs.
// - Browser hygiene: no context menu, no Ctrl shortcuts in the bindings, stuck keys cleared on focus loss.

export const KEYMAP = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Space', 'Mouse0'],
  pass: ['KeyE'], bounce: ['KeyR'], lob: ['KeyT'], alley: ['KeyY'],
  icon1: ['Digit1'], icon2: ['Digit2'], icon3: ['Digit3'], icon4: ['Digit4'],
  stickUp: ['ArrowUp'], stickDown: ['ArrowDown'], stickLeft: ['ArrowLeft'], stickRight: ['ArrowRight'],
  spin: ['KeyQ'], btb: ['KeyF'],
  // defense (contextual: same physical keys as some offense actions)
  defense: ['KeyQ', 'Mouse2'], handsUp: ['KeyR'], steal: ['KeyF'], block: ['Space', 'Mouse0'],
  screen: ['KeyC'], camera: ['KeyV'], pause: ['Escape', 'KeyP'], assist: ['KeyH'], interact: ['KeyE'], help: ['Tab'],
  celebrate: ['KeyG'], fullscreen: ['F11'],
  social: ['KeyO'], // v0.4.4 social phone (LB + RB on a controller)
  dunk: ['KeyZ'], // v0.4.1: attack the rim (dunk if you can, else the best finish)
};

// v0.4.1: remappable controller actions -> button names (Xbox layout names; the browser "standard" mapping)
export const PADMAP = {
  shoot: 'X', pass: 'A', bounce: 'B', lob: 'Y', alleyMod: 'RB', mod: 'LB', sprint: 'RT', defense: 'LT',
  steal: 'X', block: 'Y', celebrate: 'UP', camera: 'VIEW',
};
// what can be rebound, in the order the remap screen lists them
export const REMAP_KEYS = [
  ['up', 'Move up'], ['down', 'Move down'], ['left', 'Move left'], ['right', 'Move right'], ['sprint', 'Sprint'],
  ['shoot', 'Shoot / pump fake'], ['dunk', 'Attack the rim (dunk)'], ['pass', 'Pass'], ['bounce', 'Bounce pass'], ['lob', 'Lob pass'], ['alley', 'Alley-oop'],
  ['stickLeft', 'Move: cross left'], ['stickRight', 'Move: cross right'], ['stickUp', 'Move: hesitation'], ['stickDown', 'Move: step-back'], ['spin', 'Move: spin'], ['btb', 'Move: behind the back'],
  ['screen', 'Call screen'], ['defense', 'Defensive stance'], ['steal', 'Steal'], ['block', 'Block / rebound'], ['handsUp', 'Hands up'],
  ['camera', 'Camera'], ['celebrate', 'Celebrate'], ['help', 'Show controls'], ['social', 'Social phone'],
];
export const REMAP_PAD = [
  ['shoot', 'Shoot / pump fake'], ['pass', 'Pass'], ['bounce', 'Bounce pass'], ['lob', 'Lob pass'], ['alleyMod', 'Alley-oop modifier (+ lob)'],
  ['mod', 'Icon pass modifier / call screen'], ['sprint', 'Sprint'], ['defense', 'Defensive stance'], ['steal', 'Steal'], ['block', 'Block / rebound'],
  ['celebrate', 'Celebrate'], ['camera', 'Camera'],
];
export const PAD_BINDABLE = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'LS', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
const KEY_NAMES = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'R-Alt', Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\' };
export function keyName(code) {
  if (!code) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

// standard-mapping button indices
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F11', 'F5', 'F3', 'F7', 'Backquote']);
// browser shortcuts that would yank the player out of the game; blocked whenever the page can block them
const CTRL_BLOCK = new Set(['KeyS', 'KeyD', 'KeyF', 'KeyP', 'KeyR', 'KeyG', 'KeyH', 'KeyJ', 'KeyU', 'KeyO', 'KeyE', 'KeyK', 'KeyL', 'KeyB', 'KeyA', 'Equal', 'Minus', 'Digit0']);

export function padFamily(id = '') {
  const s = id.toLowerCase();
  if (/xbox|xinput|045e/.test(s)) return 'xbox'; // "Xbox Wireless Controller" must not read as a PlayStation pad
  if (/054c|dualsense|dualshock|playstation|wireless controller|ps4|ps5/.test(s)) return 'ps';
  if (/057e|pro controller|joy-con|nintendo/.test(s)) return 'switch';
  return 'xbox';
}

// v0.4.5 quick patch: right-stick gestures, independent of the frame rate. The old detector needed the stick to go
// from under 0.45 to over 0.7 between two consecutive frames, so a flick that took a few frames (any normal flick at
// 120/144 Hz, or a slightly slower one at 60) never registered, a sweep from one side straight to the other was
// missed, and the spin needed more than half a turn on top of that.
//  flick: a snap: from the middle (under ARM) past FIRE in under WINDOW s, however many frames that takes; or a
//         sweep across from one side to the other between two frames. Defense reads only these, so holding a hand
//         out isn't a reach.
//  push:  any push past FIRE that started in the middle, however slow (offense: every push is a move).
//  spin:  SPIN radians of rotation while held out (sweeps excluded).
// After a push the stick has to come back toward the middle (or sweep across) before it fires again.
// v0.4.7.5: fires a little earlier in the throw (FIRE 0.62 -> 0.56) so moves come out the instant you snap the stick,
// and reports diagonals (DIAG: within 22.5 degrees of one) and whether it was a slow push, for the stick combos
export const STICK = { REST: 0.3, ARM: 0.4, FIRE: 0.56, WINDOW: 0.08, SPIN: Math.PI * 0.95, HOLD: 0.55, DIAG: Math.tan(Math.PI / 8) * 1.0 };
export function newStickState() { return { armed: true, outT: 0, prev: [0, 0], rot: 0 }; }
const stickDir = (x, y) => (Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y < 0 ? 'up' : 'down'));
// the diagonal the stick points along, or null (within 22.5 degrees of one: the smaller axis over 41% of the larger)
export const stickDiag = (x, y) => (Math.min(Math.abs(x), Math.abs(y)) > Math.max(Math.abs(x), Math.abs(y)) * STICK.DIAG ? `${y < 0 ? 'up' : 'down'}-${x > 0 ? 'right' : 'left'}` : null);
export function stickGesture(s, rx, ry, dt) {
  const out = { flick: null, push: null, spin: false, diag: null, slow: false };
  const m = Math.hypot(rx, ry), [px, py] = s.prev, pm = Math.hypot(px, py);
  s.prev = [rx, ry];
  if (m < STICK.ARM) { s.armed = true; s.outT = 0; s.rot = 0; return out; }
  s.outT += dt;
  // angle moved since the last frame (a sweep across the middle jumps by more than ~110°)
  let d = 0;
  if (pm >= 0.2) { d = Math.atan2(ry, rx) - Math.atan2(py, px); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; }
  const sweep = pm >= STICK.ARM && Math.abs(d) > 1.9;
  if (m >= STICK.FIRE && (s.armed || sweep)) {
    const dir = stickDir(rx, ry);
    out.push = dir;
    out.diag = stickDiag(rx, ry);
    if (sweep || s.outT <= STICK.WINDOW) out.flick = dir;
    else out.slow = s.outT > STICK.WINDOW * 1.5; // a deliberate push (the hang dribble)
    s.armed = false; s.rot = 0;
    return out;
  }
  if (m >= STICK.HOLD && pm >= STICK.HOLD && !sweep) {
    s.rot += d;
    if (Math.abs(s.rot) >= STICK.SPIN) { out.spin = true; s.rot = 0; }
  } else if (sweep) s.rot = 0;
  return out;
}

// a D-pad reported as axes: a hat switch on axis 9 (-1 up, going clockwise in 2/7 steps; past 1 = centred) or a
// pair of axes (6/7 on most pads). Fills in buttons 12-15 (up, down, left, right) when they're missing.
export function padDpad(p, buttons) {
  const ax = p.axes || [];
  let up = false, down = false, left = false, right = false;
  const hat = ax.length > 9 ? ax[9] : null;
  const step = hat == null ? -1 : Math.round((hat + 1) / (2 / 7));
  // (only a value sitting on one of the hat's eight steps counts: an ordinary axis resting at 0 is not "down")
  if (hat != null && Math.abs(hat) > 0.05 && step >= 0 && step <= 7 && Math.abs(hat - (-1 + step * 2 / 7)) < 0.04) {
    const i = step % 8; // 0 up, 1 up-right, 2 right, ... 7 up-left
    up = i === 7 || i === 0 || i === 1; right = i >= 1 && i <= 3; down = i >= 3 && i <= 5; left = i >= 5 && i <= 7;
  } else if (ax.length >= 8 && (Math.abs(ax[6]) > 0.5 || Math.abs(ax[7]) > 0.5)) {
    up = ax[7] < -0.5; down = ax[7] > 0.5; left = ax[6] < -0.5; right = ax[6] > 0.5;
  }
  buttons[12] = !!buttons[12] || up; buttons[13] = !!buttons[13] || down; buttons[14] = !!buttons[14] || left; buttons[15] = !!buttons[15] || right;
  return buttons;
}

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, buttons: 0, wheel: 0, locked: false };
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.deadzone = 0.15;
    this.vibration = true;
    this.proStickShoot = true;
    this.onFocusLost = null;
    this.ctx = 'menu'; // 'offense' | 'offball' | 'defense' | 'roam' | 'menu' (set by the active controller)
    this.capturing = false; // remap screen is listening for a key/button: gameplay & menu nav ignore input
    this.applyBinds({});
    this.gp = {
      index: -1, id: '', family: 'xbox', connected: false,
      buttons: [], prev: [], values: [], axes: [0, 0, 0, 0],
      flick: null, push: null, rs: newStickState(), stickPrev: [0, 0], rsShoot: false, rsShootEdge: false,
      lbDownT: 0, lbUsed: false, lbTap: false, menuRepeat: { dir: null, t: 0 },
    };
    const typing = e => e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range';
    const kd = e => {
      if (!this.enabled) return;
      if (typing(e)) return;
      if (e.ctrlKey || e.metaKey) { if (CTRL_BLOCK.has(e.code)) e.preventDefault(); return; }
      if (GAME_KEYS.has(e.code) || (this.ctx !== 'menu' && this.keyCodes.has(e.code))) e.preventDefault();
      if (e.altKey && e.code !== 'AltLeft' && e.code !== 'AltRight') return;
      if (!e.repeat && !this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
    };
    const ku = e => {
      if (GAME_KEYS.has(e.code) && !typing(e)) e.preventDefault();
      this.down.delete(e.code); this.released.add(e.code);
    };
    target.addEventListener('keydown', kd);
    target.addEventListener('keyup', ku);
    const lost = () => {
      for (const k of this.down) this.released.add(k);
      this.down.clear(); this.mouse.buttons = 0;
      if (this.onFocusLost) this.onFocusLost();
    };
    window.addEventListener('blur', lost);
    document.addEventListener('visibilitychange', () => { if (document.hidden) lost(); });
    window.addEventListener('mousemove', e => {
      this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0; this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.lastDevice === 'gamepad' && Math.abs(e.movementX) + Math.abs(e.movementY) > 3) this.lastDevice = 'mouse';
    });
    window.addEventListener('mousedown', e => {
      this.mouse.buttons = e.buttons;
      if (e.button === 1) e.preventDefault(); // no autoscroll
      const onUI = e.target && e.target.closest && e.target.closest('button, a, input, select, textarea, label, .modal, .panel, .topbar');
      if (!onUI || this.ctx !== 'menu') { this.pressed.add('Mouse' + e.button); this.down.add('Mouse' + e.button); }
      this.lastDevice = 'mouse';
    });
    window.addEventListener('mouseup', e => { this.mouse.buttons = e.buttons; this.down.delete('Mouse' + e.button); this.released.add('Mouse' + e.button); });
    window.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); return; } this.mouse.wheel += Math.sign(e.deltaY); }, { passive: false });
    window.addEventListener('contextmenu', e => { if (!typing(e)) e.preventDefault(); });
    window.addEventListener('dragstart', e => { if (!typing(e)) e.preventDefault(); });
    window.addEventListener('gamepadconnected', e => { this.gp.connected = true; this.gp.index = e.gamepad.index; this.gp.id = e.gamepad.id; this.gp.family = padFamily(e.gamepad.id); if (this.onPadChange) this.onPadChange(true, this.gp); });
    window.addEventListener('gamepaddisconnected', e => { if (e.gamepad.index === this.gp.index) { this.gp.connected = false; this.gp.index = -1; this.gp.buttons = []; if (this.onPadChange) this.onPadChange(false, this.gp); } });
  }

  // ---------------- bindings (v0.4.1) ----------------
  // binds: {key: {action: code}, pad: {action: 'X'}}; only overrides are stored
  applyBinds(binds = {}) {
    const isMouse = c => c.startsWith('Mouse');
    this.keymap = {};
    for (const [a, codes] of Object.entries(KEYMAP)) this.keymap[a] = codes.slice();
    for (const [a, code] of Object.entries(binds.key || {})) {
      if (!KEYMAP[a] || typeof code !== 'string') continue;
      // a new key replaces the primary key; a mouse button replaces the mouse alternate
      this.keymap[a] = isMouse(code) ? [...KEYMAP[a].filter(c => !isMouse(c)), code] : [code, ...KEYMAP[a].filter(isMouse)];
    }
    this.padmap = { ...PADMAP };
    for (const [a, b] of Object.entries(binds.pad || {})) if (PADMAP[a] && PAD[b] != null) this.padmap[a] = b;
    this.keyCodes = new Set(Object.values(this.keymap).flat().filter(k => !isMouse(k)));
  }
  pb(action) { return PAD[this.padmap[action]]; }
  keyLabel(action) { return (this.keymap[action] || []).map(keyName).join(' / '); }
  padLabel(action) { return this.padmap[action] || ''; }

  // ---------------- generic queries ----------------
  isDown(action) { if (this.capturing) return false; return (this.keymap[action] || [action]).some(k => this.down.has(k)) || this.gpDown(action); }
  wasPressed(action) { if (this.capturing) return false; return (this.keymap[action] || [action]).some(k => this.pressed.has(k)) || this.gpPressed(action); }
  wasReleased(action) { return (this.keymap[action] || [action]).some(k => this.released.has(k)); }
  get usingPad() { return this.lastDevice === 'gamepad' && this.gp.connected; }

  // ---------------- gamepad ----------------
  pollGamepad(dt = 1 / 60) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = this.gp;
    let p = pads && g.index >= 0 ? pads[g.index] : null;
    if (!p || !p.connected) {
      // adopt whichever pad is being used
      p = null;
      for (const q of pads || []) if (q && q.connected && (q.buttons.some(b => b.pressed) || q.axes.some(a => Math.abs(a) > 0.5))) { p = q; break; }
      if (!p) for (const q of pads || []) if (q && q.connected) { p = q; break; }
      if (p) { g.index = p.index; g.id = p.id; g.family = padFamily(p.id); }
    }
    if (!p) { g.connected = false; g.buttons = []; g.prev = []; return; }
    g.connected = true;
    g.prev = g.buttons;
    g.values = p.buttons.map(b => b.value);
    g.buttons = p.buttons.map((b, i) => (i === 6 || i === 7) ? b.value > 0.3 : (b.pressed || b.value > 0.5));
    g.axes = [p.axes[0] || 0, p.axes[1] || 0, p.axes[2] || 0, p.axes[3] || 0];
    // v0.4.7.5 quick patch: pads the browser doesn't map to the standard layout (some PlayStation, Switch and
    // third-party pads) report the D-pad as axes, not buttons 12-15, so D-pad up (celebrate) never fired on them
    if (p.mapping !== 'standard') padDpad(p, g.buttons);
    const lsm = Math.hypot(g.axes[0], g.axes[1]), rsm = Math.hypot(g.axes[2], g.axes[3]);
    if (g.buttons.some((b, i) => b && !g.prev[i]) || lsm > 0.45 || rsm > 0.45) this.lastDevice = 'gamepad';
    // ---- right stick: flick / push (dribble moves, reaches) and rotation (spin), see stickGesture ----
    const rx = g.axes[2], ry = g.axes[3];
    g.rsShootEdge = false;
    const gs = stickGesture(g.rs || (g.rs = newStickState()), rx, ry, dt);
    g.flick = gs.spin ? 'spin' : gs.flick; // fast flicks (defense reads only these, so a held hand isn't a reach)
    g.push = gs.spin ? null : gs.push;     // any deliberate push out of the middle (offense: every one is a move)
    g.diag = gs.spin ? null : gs.diag;     // v0.4.7.5: diagonal stick combos (wraps, sidesteps, stutters)
    g.slow = !gs.spin && gs.slow;
    // pro-stick shooting: keep the stick pushed (not a quick flick) to rise up, let go to release
    // v0.4.2: the right stick is for dribble moves and attacking the rim only (no stick shooting)
    g.rsShoot = false;
    // v0.4.1: right stick DOWN while sprinting = attack the rim (dunk), never a step-back or pro-stick jumper
    const downward = ry > 0.6 && Math.abs(ry) > Math.abs(rx);
    const sprinting = !!g.buttons[PAD[this.padmap.sprint]];
    g.dunkEdge = false;
    if (downward && sprinting && this.ctx === 'offense') {
      if (!g.dunkHeld) g.dunkEdge = true;
      g.dunkHeld = true;
      if (g.flick === 'down') g.flick = null;
      if (g.push === 'down') g.push = null;
      g.diag = null;
      g.rsShoot = false;
    } else if (!downward) g.dunkHeld = false;
    g.stickPrev = [rx, ry];
    // ---- LB: tap = call screen, hold + face button = icon pass ----
    g.lbTap = false;
    const MOD = this.pb('mod'), faces = ['pass', 'bounce', 'shoot', 'lob'].map(a => this.pb(a));
    // v0.4.4: LB + RB together = social phone (the second bumper going down is the press)
    const bothNow = g.buttons[PAD.LB] && g.buttons[PAD.RB], bothBefore = g.prev[PAD.LB] && g.prev[PAD.RB];
    g.socialEdge = !!(bothNow && !bothBefore);
    if (bothNow) g.lbUsed = true;
    if (g.buttons[MOD]) { if (!g.prev[MOD]) { g.lbDownT = 0; g.lbUsed = !!g.buttons[PAD.RB]; } g.lbDownT += dt; if (faces.some(i => g.buttons[i] && !g.prev[i])) g.lbUsed = true; if (g.buttons[PAD.RB]) g.lbUsed = true; }
    else if (g.prev[MOD]) { if (!g.lbUsed && g.lbDownT < 0.35) g.lbTap = true; }
  }
  // v0.4.7.5 qp3: which of the four face buttons (pass / bounce / shoot / lob, or their keys) went down this frame,
  // whatever the context: the alley-oop press (game.oopInput). 0..3, or null
  facePressed() {
    if (this.capturing) return null;
    const faces = ['pass', 'bounce', 'shoot', 'lob'];
    for (let i = 0; i < 4; i++) {
      const a = faces[i];
      if ((this.keymap[a] || []).some(k => this.pressed.has(k))) return i;
      if (this.gp.connected && this.gpEdge(this.pb(a))) return i;
    }
    return null;
  }
  faceGlyph(i) {
    const a = ['pass', 'bounce', 'shoot', 'lob'][i];
    if (this.usingPad) return padGlyph(this.gp.family, this.padLabel(a));
    return `<kbd>${String(this.keyLabel(a)).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</kbd>`;
  }
  gpBtn(i) { return !!this.gp.buttons[i]; }
  gpEdge(i) { return !!this.gp.buttons[i] && !this.gp.prev[i]; }
  gpUp(i) { return !this.gp.buttons[i] && !!this.gp.prev[i]; }
  trigger(i) { return this.gp.values[i] || 0; }

  gpDown(action) {
    if (!this.gp.connected || this.capturing) return false;
    const def = this.ctx === 'defense', B = a => this.gpBtn(this.pb(a));
    switch (action) {
      case 'sprint': return B('sprint');
      case 'shoot': return !def && B('shoot');
      case 'block': return def && B('block');
      case 'defense': return B('defense');
      case 'camera': return B('camera'); // (v0.4.7.5: held in the park for the court overview)
      // v0.4.4: on defense the right stick is your hands: hold up = hands up (flicks/holds sideways reach, see defStick)
      case 'handsUp': return def && this.gp.axes[3] < -0.55 && Math.abs(this.gp.axes[3]) > Math.abs(this.gp.axes[2]);
      default: return false;
    }
  }
  gpPressed(action) {
    if (!this.gp.connected || this.capturing) return false;
    const g = this.gp, def = this.ctx === 'defense', lb = this.gpBtn(this.pb('mod'));
    const E = a => this.gpEdge(this.pb(a));
    switch (action) {
      case 'shoot': return !def && E('shoot') && !lb;
      case 'dunk': return !!g.dunkEdge;
      case 'block': return (def || this.ctx === 'offball') && E('block');
      case 'pass': return E('pass') && !lb;
      case 'bounce': return E('bounce') && !def && !lb;
      case 'lob': return E('lob') && !def && !lb && !this.gpBtn(this.pb('alleyMod'));
      case 'alley': return E('lob') && !def && this.gpBtn(this.pb('alleyMod'));
      case 'steal': return def && E('steal');
      case 'screen': return g.lbTap && !def;
      case 'camera': return E('camera');
      case 'pause': return this.gpEdge(PAD.MENU);
      case 'icon1': return lb && E('pass');
      case 'icon2': return lb && E('bounce');
      case 'icon3': return lb && E('shoot');
      case 'icon4': return lb && E('lob');
      case 'interact': return this.gpEdge(PAD.A);
      case 'celebrate': return E('celebrate');
      case 'help': return this.gpEdge(PAD.RS) && this.ctx !== 'menu';
      case 'social': return !!g.socialEdge;
      case 'assist': return false;
      default: return false;
    }
  }

  // radial deadzone with rescale; returns {x, y, m}
  stick(ix, iy, dz = this.deadzone) {
    const x = this.gp.axes[ix] || 0, y = this.gp.axes[iy] || 0, m = Math.hypot(x, y);
    if (m < dz) return { x: 0, y: 0, m: 0 };
    const k = Math.min(1, (m - dz) / (0.95 - dz));
    return { x: x / m * k, y: y / m * k, m: k };
  }

  // left stick / WASD: {x: right, y: forward, m}
  moveVector() {
    let x = 0, y = 0;
    if (this.capturing) return { x: 0, y: 0, m: 0 };
    const K = a => this.keymap[a].some(k => this.down.has(k));
    if (K('up')) y += 1; if (K('down')) y -= 1;
    if (K('right')) x += 1; if (K('left')) x -= 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    if (this.gp.connected) {
      const s = this.stick(0, 1);
      if (s.m > 0) { x = s.x; y = -s.y; }
    }
    return { x, y, m: Math.min(1, Math.hypot(x, y)) };
  }
  // v0.4.4 defensive hands, like the older 2K games: right stick (or the arrow keys) on defense.
  //  flick left/right = reach with that hand · flick down = low swipe at the dribble · hold up = hands up ·
  //  hold left/right = hand out on that side (in the passing lane / on the ball side)
  // Directions are screen-relative: {flick: {x, y} | null, low, hold: {x, y} | null, up}
  defStick() {
    const out = { flick: null, low: false, hold: null, up: false };
    if (this.capturing || this.ctx !== 'defense') return out;
    const K = a => this.keymap[a].some(k => this.pressed.has(k)), H = a => this.keymap[a].some(k => this.down.has(k));
    if (K('stickLeft')) out.flick = { x: -1, y: 0 };
    else if (K('stickRight')) out.flick = { x: 1, y: 0 };
    else if (K('stickDown')) { out.flick = { x: 0, y: -1 }; out.low = true; }
    if (H('stickUp')) out.up = true;
    else if (H('stickLeft')) out.hold = { x: -1, y: 0 };
    else if (H('stickRight')) out.hold = { x: 1, y: 0 };
    const g = this.gp;
    if (g.connected) {
      const rx = g.axes[2], ry = g.axes[3], m = Math.hypot(rx, ry);
      if (g.flick === 'left' || g.flick === 'right') out.flick = { x: rx / (m || 1), y: -ry / (m || 1) };
      else if (g.flick === 'down') { out.flick = { x: 0, y: -1 }; out.low = true; }
      if (m > 0.55) {
        if (-ry > Math.abs(rx)) out.up = true;
        else if (Math.abs(rx) > Math.abs(ry)) out.hold = { x: rx / m, y: -ry / m };
      }
    }
    return out;
  }

  // pro stick for dribble moves: keyboard arrows / Q, or right-stick flicks
  // v0.4.7.5: the right stick with its combination: { stick (a direction, a diagonal, or 'spin'), slow }. Keyboard:
  // a stick key pressed while another is held is the diagonal (hold Down, press Left = down-left)
  proStickInfo() {
    if (this.capturing) return null;
    const K = a => this.keymap[a].some(k => this.pressed.has(k)), D = a => this.keymap[a].some(k => this.down.has(k));
    const kb = K('stickLeft') ? 'left' : K('stickRight') ? 'right' : K('stickUp') ? 'up' : K('stickDown') ? 'down' : null;
    if (kb) {
      const v = kb === 'left' || kb === 'right' ? (D('stickDown') ? 'down' : D('stickUp') ? 'up' : null) : (D('stickLeft') ? 'left' : D('stickRight') ? 'right' : null);
      if (v) return { stick: kb === 'left' || kb === 'right' ? `${v}-${kb}` : `${kb}-${v}`, slow: false };
      return { stick: kb, slow: false };
    }
    if (K('spin') && this.ctx === 'offense') return { stick: 'spin', slow: false };
    const g = this.gp;
    if (g.flick === 'spin') return { stick: 'spin', slow: false };
    const dir = g.flick || (this.ctx === 'offense' ? g.push : null);
    if (!dir) return null;
    return { stick: (this.ctx === 'offense' && g.diag) || dir, slow: !g.flick && !!g.slow };
  }

  proStick() {
    if (this.capturing) return null;
    const K = a => this.keymap[a].some(k => this.pressed.has(k));
    if (K('stickLeft')) return 'left';
    if (K('stickRight')) return 'right';
    if (K('stickUp')) return 'up';
    if (K('stickDown')) return 'down';
    if (K('spin') && this.ctx === 'offense') return 'spin';
    if (this.gp.flick) return this.gp.flick;
    if (this.gp.push && this.ctx === 'offense') return this.gp.push; // v0.4.5: no push gets lost
    return null;
  }

  // ---------------- rumble ----------------
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    if (!this.vibration || !this.gp.connected) return;
    try {
      const p = navigator.getGamepads()[this.gp.index];
      const act = p && p.vibrationActuator;
      if (act && act.playEffect) act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) }).catch(() => {});
    } catch { /* unsupported */ }
  }

  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    if (this.gp.connected) this.gp.prev = this.gp.buttons.slice();
    this.gp.flick = null; this.gp.push = null; this.gp.rsShootEdge = false; this.gp.lbTap = false; this.gp.dunkEdge = false;
  }
}


// ---------------- button glyphs ----------------
const GLYPH = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', VIEW: '⧉', MENU: '≡', LS: 'LS', RS: 'RS', UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶' },
  ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', VIEW: 'Create', MENU: 'Options', LS: 'L3', RS: 'R3', UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶' },
  switch: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', VIEW: '−', MENU: '+', LS: 'LS', RS: 'RS', UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶' },
};
export function padGlyph(family, btn) {
  const t = (GLYPH[family] || GLYPH.xbox)[btn] || btn;
  return `<span class="pad-glyph ${family} b-${btn.toLowerCase()}">${t}</span>`;
}
// Prompt for an action on the current device: prompt(input, {key: 'E', pad: 'A'})
export function promptGlyph(input, key, pad, family) {
  if (input && input.usingPad && pad) return padGlyph(family || input.gp.family, pad);
  return `<kbd>${key}</kbd>`;
}
