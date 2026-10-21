// v0.4.8.7 quick patch 7: the HUD and the game's own menus feel smooth. The HUD touches the page only when what it shows
// changes (a hint, the intro, the stamina bar), the showroom's wheel zoom only answers a wheel turned over the player
// himself (never one coming from a menu list over the canvas) and zooms by how far it turned, a drag on the showroom ends
// however the pointer goes, the controls overlay opens and closes on one press each, and the park's prompt never takes a
// click or the wheel.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HUD } from '../client/js/game/hud.js';
import { Showroom, wheelOverCanvas, wheelZoom } from '../client/js/game/showroom.js';
import { MatchSession } from '../client/js/game/session.js';

// an element that counts what's written to it
const el = () => {
  const e = { writes: 0, styleWrites: 0, hidden: false, _html: '', classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } } };
  Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; this.writes++; } });
  const style = {}; e.style = new Proxy(style, { set(t, k, v) { t[k] = v; e.styleWrites++; return true; } });
  return e;
};

test('the HUD writes a hint, the intro and the stamina bar only when they change', () => {
  const h = Object.create(HUD.prototype);
  h.hint = el(); h.introBox = el(); h.root = { classList: el().classList }; h.stamina = el(); h.stamina.firstChild = el();
  for (let i = 0; i < 60; i++) h.setHint('Press <kbd>G</kbd> to celebrate');
  assert.equal(h.hint.writes, 1, 'one write for sixty frames of the same hint');
  h.setHint(''); h.setHint(''); h.setHint(null);
  assert.equal(h.hint.writes, 2); assert.equal(h.hint.hidden, true);
  for (let i = 0; i < 30; i++) h.setIntro('<div class="intro">KINGS</div>');
  assert.equal(h.introBox.writes, 1);
  assert.ok(h.root.classList.set.has('intro-on'));
  h.setIntro(null); h.setIntro(null);
  assert.equal(h.introBox.writes, 2); assert.equal(h.introBox.hidden, true); assert.ok(!h.root.classList.set.has('intro-on'));
  for (let i = 0; i < 40; i++) h.setStamina(400.2, 300.1, 0.5, true);
  assert.equal(h.stamina.styleWrites + h.stamina.firstChild.styleWrites, 2, 'the bar is moved and sized once while it stays put');
  h.setStamina(410, 300, 0.4, true);
  assert.equal(h.stamina.styleWrites + h.stamina.firstChild.styleWrites, 4);
  h.setStamina(0, 0, 1, false);
  assert.equal(h.stamina.hidden, true);
});

test('the showroom zooms only on a wheel turned over the canvas, by how far it turned', () => {
  const cv = { id: 'canvas' }, list = { id: 'list' };
  const doc = (under) => ({ elementFromPoint: () => under });
  assert.ok(wheelOverCanvas({ target: cv, clientX: 10, clientY: 10 }, cv, doc(cv)));
  assert.ok(!wheelOverCanvas({ target: list, clientX: 10, clientY: 10 }, cv, doc(list)), 'from a menu list: no');
  assert.ok(!wheelOverCanvas({ target: cv, clientX: 10, clientY: 10 }, cv, doc(list)), 'something drawn over the canvas that lets the event through: no');
  assert.ok(!wheelOverCanvas({ target: cv, ctrlKey: true }, cv, doc(cv)), 'a pinch: no');
  // one notch (~100 px) is a third of a step; a trackpad's little deltas are little zooms; a burst is held to a notch
  assert.ok(Math.abs(wheelZoom(0, { deltaY: 100, deltaMode: 0 }) + 1 / 3) < 1e-9);
  assert.ok(Math.abs(wheelZoom(0, { deltaY: -6, deltaMode: 0 }) - 0.02) < 1e-9);
  assert.ok(Math.abs(wheelZoom(0, { deltaY: 3, deltaMode: 1 }) + 0.16) < 1e-9, 'lines are 16 px');
  assert.ok(Math.abs(wheelZoom(0, { deltaY: 5000, deltaMode: 0 }) + 0.4) < 1e-9);
  assert.equal(wheelZoom(2.4, { deltaY: -300 }), 2.5); assert.equal(wheelZoom(-0.9, { deltaY: 300 }), -1);
});

test('the showroom drag starts on the left button and ends however the pointer goes; the wheel from a list never zooms', () => {
  const on = {}, cv = { addEventListener(ev, fn) { (on[ev] ||= []).push(fn); }, setPointerCapture() {} };
  const fire = (ev, e = {}) => (on[ev] || []).forEach(fn => fn(e));
  const s = Object.create(Showroom.prototype);
  Object.assign(s, { app: { renderer: { canvas: cv } }, active: true, dragging: false, yaw: 0, yawVel: 0, zoom: 0 });
  const realDoc = globalThis.document;
  globalThis.document = { elementFromPoint: () => cv };
  try {
    s.bindDrag();
    fire('pointerdown', { button: 2, clientX: 5, pointerId: 1 });
    assert.equal(s.dragging, false, 'right button: no drag');
    fire('pointerdown', { button: 0, clientX: 5, pointerId: 1 }); assert.equal(s.dragging, true);
    fire('pointermove', { clientX: 25 }); assert.ok(s.yaw > 0);
    fire('lostpointercapture'); assert.equal(s.dragging, false, 'capture lost: the drag ends');
    fire('pointerdown', { button: 0, clientX: 5, pointerId: 1 }); fire('pointercancel'); assert.equal(s.dragging, false, 'cancelled: the drag ends');
    const y = s.yaw; fire('pointermove', { clientX: 300 }); assert.equal(s.yaw, y, 'no spinning after it ended');
    fire('wheel', { target: { id: 'list' }, deltaY: 100, clientX: 1, clientY: 1 }); assert.equal(s.zoom, 0, 'a wheel from a menu list: no zoom');
    fire('wheel', { target: cv, deltaY: -100, clientX: 1, clientY: 1 }); assert.ok(s.zoom > 0.3, 'over the player: zoom');
  } finally { globalThis.document = realDoc; }
});

test('the controls overlay: one press opens it, the next closes it, even before it has filled', async () => {
  const kids = [];
  const mkEl = () => { const e = { remove() { const i = kids.indexOf(e); if (i >= 0) kids.splice(i, 1); }, get isConnected() { return kids.includes(e); } }; return e; };
  const realDoc = globalThis.document;
  globalThis.document = { createElement: mkEl, getElementById: id => kids.find(k => k.id === id) || null, body: { appendChild: e => kids.push(e) } };
  try {
    const s = { app: {} };
    MatchSession.prototype.toggleHelp.call(s);
    assert.equal(kids.length, 1, 'open at once');
    MatchSession.prototype.toggleHelp.call(s);
    assert.equal(kids.length, 0, 'the second press closes it (it used to open a second one)');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(kids.length, 0, 'and it stays closed when the controls table loads');
  } finally { globalThis.document = realDoc; }
});

test('the park\'s prompt never takes a click or the wheel', () => {
  const css = fs.readFileSync(new URL('../client/css/app.css', import.meta.url), 'utf8');
  assert.match(css, /#prompt,\s*#prompt \*\s*\{\s*pointer-events:\s*none;\s*\}/);
  assert.ok(css.indexOf('#prompt, #prompt *') > css.indexOf('.layer > * { pointer-events: auto; }'), 'after the layers\' rule');
});
