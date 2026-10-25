// v0.4.8.9 qp5: auto-play on a controller (D-pad down by default, remappable), alongside H on the keyboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Input, PADMAP, REMAP_PAD, PAD } from '../client/js/core/input.js';

const fakeTarget = { addEventListener() {}, removeEventListener() {} };
globalThis.window ??= fakeTarget;
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, pointerLockElement: null };
const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

function padInput(binds = {}) {
  const inp = new Input(fakeTarget);
  inp.applyBinds(binds);
  inp.gp.connected = true; inp.lastDevice = 'gamepad'; inp.ctx = 'offense';
  return inp;
}
const press = (inp, btn) => { inp.gp.prev = []; inp.gp.buttons = []; inp.gp.buttons[PAD[btn]] = true; };

test('auto-play has a controller button: D-pad down by default, listed on the remap screen', () => {
  assert.equal(PADMAP.assist, 'DOWN');
  assert.ok(REMAP_PAD.some(([a]) => a === 'assist'));
});

test('pressing it toggles like H: an edge on the bound button, and a remap moves it', () => {
  const inp = padInput();
  press(inp, 'DOWN');
  assert.equal(inp.gpPressed('assist'), true);
  inp.gp.prev = inp.gp.buttons.slice();
  assert.equal(inp.gpPressed('assist'), false); // held, not a new press
  const re = padInput({ pad: { assist: 'LEFT' } });
  press(re, 'DOWN');
  assert.equal(re.gpPressed('assist'), false);
  press(re, 'LEFT');
  assert.equal(re.gpPressed('assist'), true);
});

test('the feed names the button on the device in use, and the controls table lists it', () => {
  const inp = padInput();
  assert.equal(inp.actionText('assist'), 'D-pad down');
  inp.lastDevice = 'keyboard';
  assert.equal(inp.actionText('assist'), 'H');
  assert.match(src('client/js/ui/screens.js'), /Auto-play on \/ off[^\n]*K\('assist'\), P\('assist'\)/);
  assert.match(src('client/js/game/session.js'), /inp\.actionText\?\.\('assist'\) \|\| 'H'/);
});
