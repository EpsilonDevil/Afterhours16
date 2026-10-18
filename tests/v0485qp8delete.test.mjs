// v0.4.8.5 quick patch 8: deleting a build, the client side. The hold rules (ui/hold.js: the full 5 seconds, letting go
// early starts over, a press already down when the screen opened doesn't count), the confirmation screen's wiring
// (ui/deletebuild.js: ✕ / A, Enter / Space, mouse / touch, on an injected clock and a stub DOM), what happens after the
// server deletes it, and the Players tab's Delete next to each name. The server side: tests/test_delete_build.py.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// (just enough of a browser: window listeners, frames stepped by hand, the toast, and a #modal whose card is stubbed)
const winL = {};
const toastEl = { textContent: '', className: '', hidden: true };
let rafQ = [];
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis; globalThis.matchMedia = () => ({ matches: false });
globalThis.addEventListener = (t, f) => { (winL[t] ||= []).push(f); };
globalThis.removeEventListener = (t, f) => { winL[t] = (winL[t] || []).filter(x => x !== f); };
globalThis.requestAnimationFrame = f => { rafQ.push(f); return rafQ.length; };
globalThis.cancelAnimationFrame = () => {};
let modalEl = null;
globalThis.document = { querySelector: s => (s === '#toast' ? toastEl : s === '#modal' ? modalEl : null), getElementById: () => null, addEventListener() {}, documentElement: {}, body: {}, createElement: () => ({ getContext: () => null, style: {} }) };

const H = await import('../client/js/ui/hold.js');
const D = await import('../client/js/ui/deletebuild.js');
const MP = await import('../client/js/ui/myplayer.js');
const { padGlyph } = await import('../client/js/core/input.js');
const C = await import('../client/js/ui/common.js');
const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const step = () => { const q = rafQ; rafQ = []; q.forEach(f => f()); };
const key = (type, code, repeat = false) => { const e = { type, code, repeat, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} }; for (const f of winL[type] || []) f(e); return e; };
const flush = () => new Promise(r => setTimeout(r, 0));

function fakeEl() {
  const ev = {};
  return { style: {}, innerHTML: '', textContent: '', isConnected: true, cls: new Set(),
    classList: { toggle(c, on) { on ? this.o.cls.add(c) : this.o.cls.delete(c); }, add() {}, remove() {}, o: null },
    addEventListener(t, f) { (ev[t] ||= []).push(f); }, emit(t) { for (const f of ev[t] || []) f({ preventDefault() {}, pointerId: 1 }); },
    focus() {}, setPointerCapture() {} };
}
// a stub #modal: setting its HTML "opens" a card with the hold button, the bar and the countdown; clearing it closes
function stubModal() {
  const btn = fakeEl(), fill = fakeEl(), label = fakeEl(), count = fakeEl(), cancel = fakeEl(), card = fakeEl();
  btn.classList.o = btn;
  btn.querySelector = s => ({ '.hold-fill': fill, '.hold-label': label, '.hold-count': count })[s];
  card.querySelector = s => ({ '[data-hold]': btn, '.hold-cancel': cancel })[s];
  modalEl = { hidden: true, html: '', set innerHTML(v) { this.html = v; card.isConnected = !!v; }, get innerHTML() { return this.html; }, get firstElementChild() { return card; } };
  return { btn, fill, label, count, cancel, card };
}
const build = (over = {}) => ({ id: 'b1', name: 'Big Stretch', overall: 88, position: 'PF', archetype: 'stretch_big', height: 83, rep: { label: 'Pro 1' }, proam_rank: { name: 'Silver', rp: 700 }, progression: { games: 10, wins: 7 }, icon_status: false, ...over });

test('the hold: the full 5 seconds, letting go starts over, only a fresh press counts', () => {
  let t = 0;
  const g = new H.HoldGate({ now: () => t });
  assert.equal(H.HOLD_MS, 5000);
  assert.equal(g.progress(), 0);
  assert.ok(g.press('pad'));
  t = 2500; assert.equal(g.progress(), 0.5); assert.equal(g.secondsLeft(), 2.5); assert.equal(g.tick(), false);
  t = 4999; assert.equal(g.tick(), false);
  t = 5000; assert.equal(g.tick(), true, 'a full 5 seconds');
  assert.equal(g.tick(), true, 'and it stays done');
  // let go early: back to zero, and the next hold needs the whole 5 seconds again
  t = 0; const e = new H.HoldGate({ now: () => t });
  e.press('key:Enter'); t = 3000; e.release('key:Enter');
  assert.equal(e.progress(), 0); assert.equal(e.holding(), false);
  t = 3500; e.press('key:Enter');
  t = 8400; assert.equal(e.tick(), false, '4.9 s after the second press');
  t = 8500; assert.equal(e.tick(), true);
  // a source already down when it opened (the A that pressed Delete) is ignored until it's let go
  t = 0; const s = new H.HoldGate({ now: () => t, held: ['pad', 'key:Enter'] });
  s.set('pad', true); s.press('key:Enter');
  t = 9000; assert.equal(s.tick(), false); assert.equal(s.progress(), 0);
  s.set('pad', false); t = 9100; s.set('pad', true);
  t = 14099; assert.equal(s.tick(), false);
  t = 14100; assert.equal(s.tick(), true, 'counted from the fresh press');
  // another key pressed fresh counts while the stale one is still held
  t = 0; const k = new H.HoldGate({ now: () => t, held: ['key:Enter'] });
  assert.equal(k.press('key:Enter'), false); assert.ok(k.press('key:Space'));
  t = 5000; assert.equal(k.tick(), true);
  // two sources: the hold lasts while either one is down
  t = 0; const m = new H.HoldGate({ now: () => t });
  m.press('pointer'); t = 1000; m.press('key:Space'); t = 2000; m.release('pointer');
  assert.ok(m.holding()); t = 5000; assert.equal(m.tick(), true);
  // after a failed request: whatever is still down has to be let go first
  m.reset(); assert.equal(m.progress(), 0); assert.equal(m.press('key:Space'), false); m.release('key:Space'); assert.ok(m.press('key:Space'));
});

test('the prompt follows the device: Hold ✕ on PlayStation, Hold A on Xbox, Hold Enter (or click and hold) on a keyboard', () => {
  assert.match(H.holdPrompt({ usingPad: true, gp: { family: 'ps' } }, padGlyph).html, /^Hold <span class="pad-glyph ps b-a">✕<\/span> to delete$/);
  assert.match(H.holdPrompt({ usingPad: true, gp: { family: 'ps' } }, padGlyph).cancel, /○/);
  assert.match(H.holdPrompt({ usingPad: true, gp: { family: 'xbox' } }, padGlyph).html, /^Hold <span class="pad-glyph xbox b-a">A<\/span> to delete$/);
  assert.equal(H.holdPrompt({ usingPad: false, gp: { family: 'ps' } }, padGlyph).html, 'Hold <kbd>Enter</kbd> (or click and hold) to delete');
  assert.equal(H.holdPrompt(null, padGlyph).cancel, '<kbd>Esc</kbd> Cancel');
});

test('the confirmation screen says what goes and what stays (an ICON keeps its slot)', () => {
  const app = { config: { icon_badges: { open_arms: { name: 'Open Arms' } } }, profile: { balance: 1234567, build_slots: { unlocked: 5, max: 8 } }, input: { usingPad: false, gp: { family: 'xbox' } } };
  let html = D.deleteBuildHTML(app, build({ name: 'Big <B>' }));
  assert.ok(html.includes('Delete Big &lt;B&gt;?'));
  for (const s of ['Its attributes (88 OVR)', 'Its badges', 'Its progress: 10 games (7-3)', 'its Rep (Pro 1)', 'Its Pro-Am rank (Silver, 700 RP)', 'Its Pro Run career', 'Your VC (1,234,567)', 'Your locker', 'Its build slot, free for a new player', 'data-padhold', 'data-close>Cancel'])
    assert.ok(html.includes(s), s);
  assert.ok(!html.includes('stays open'));
  html = D.deleteBuildHTML(app, build({ overall: 99, icon_status: true, icon_slot: true, icon_badge: 'open_arms', cap_breakers: { earned: 25 } }));
  assert.ok(html.includes('<span class="icon-status">ICON</span> Stretch Big'), 'the ICON tag on the build');
  assert.ok(html.includes('and its Icon badge (Open Arms)') && html.includes('and cap breakers'));
  assert.ok(html.includes('Its build slot stays open: the slot this ICON build opened is your account&#39;s for good (5 of 8 open after this)') || html.includes("Its build slot stays open: the slot this ICON build opened is your account's for good (5 of 8 open after this)"));
});

test('the screen\'s wiring: ✕ / A held for 5 s (a fresh press), Enter / Space and the mouse too, and the delete after it', async () => {
  let t = 0, calls = [], went = null;
  const app = { config: {}, profile: { balance: 10, characters: [build(), build({ id: 'b2', name: 'Two' })], build_slots: { unlocked: 4, max: 8 } }, selectedId: 'b1',
    input: { usingPad: true, gp: { connected: true, family: 'ps', buttons: [true] }, down: new Set(['Enter']) },
    api: { mutate: async (path, body) => { calls.push([path, body]); return { deleted: { id: 'b1' }, characters: [build({ id: 'b2', name: 'Two' })], build_slots: { unlocked: 4, max: 8, used: 1 } }; } } };
  const base = (winL.keydown || []).length; // (other modules' own listeners)
  // opened with A (and Enter) still down from pressing Delete
  let ui = stubModal();
  D.openDeleteBuild(app, app.profile.characters[0], { now: () => t, go: (a, s, p) => { went = [s, p]; } });
  step();
  assert.match(ui.label.innerHTML, /Hold <span class="pad-glyph ps b-a">✕<\/span> to delete/);
  assert.equal(ui.count.textContent, '5');
  t = 6000; step(); assert.equal(calls.length, 0, 'the A that opened it does not count');
  assert.equal(key('keydown', 'Enter', true).prevented, true, 'Enter never clicks whatever has focus');
  key('keyup', 'Enter');
  app.input.gp.buttons[0] = false; t = 7000; step();
  app.input.gp.buttons[0] = true; t = 8000; step();
  t = 10500; step();
  assert.equal(ui.fill.style.width, '50%'); assert.equal(ui.count.textContent, '2.5'); assert.ok(ui.btn.cls.has('holding'));
  app.input.gp.buttons[0] = false; t = 11000; step();
  assert.equal(ui.fill.style.width, '0%', 'let go early: back to empty'); assert.equal(ui.count.textContent, '5'); assert.ok(!ui.btn.cls.has('holding'));
  app.input.gp.buttons[0] = true; t = 12000; step();
  t = 16990; step(); assert.equal(calls.length, 0);
  t = 17000; step(); assert.equal(calls.length, 1, 'a full 5-second hold deletes');
  assert.deepEqual(calls[0], ['/api/characters/b1/delete', {}]);
  await flush();
  assert.equal(modalEl.innerHTML, '', 'closed');
  assert.deepEqual(app.profile.characters.map(c => c.id), ['b2']);
  assert.deepEqual(app.profile.build_slots, { unlocked: 4, max: 8, used: 1 });
  assert.equal(app.selectedId, 'b2', 'the build that is left is picked');
  assert.equal(toastEl.textContent, 'Deleted Big Stretch.');
  assert.deepEqual(went, ['myplayer', { tab: 'players' }]);
  assert.equal((winL.keydown || []).length, base, 'its key listeners are gone');
  // keyboard: Space held 5 s; mouse: press and hold (a release at 2 s starts over)
  for (const how of ['key', 'pointer']) {
    calls = []; t = 0;
    app.input = { usingPad: false, gp: { connected: false, buttons: [] }, down: new Set() };
    app.profile.characters = [build({ id: 'b3', name: 'Three' })]; app.selectedId = 'b3';
    app.api.mutate = async (path, body) => { calls.push([path, body]); return { deleted: { id: 'b3' }, characters: [], build_slots: { unlocked: 4, max: 8, used: 0 } }; };
    ui = stubModal();
    D.openDeleteBuild(app, app.profile.characters[0], { now: () => t, go: (a, s, p) => { went = [s, p]; } });
    step();
    assert.equal(ui.label.innerHTML, 'Hold <kbd>Enter</kbd> (or click and hold) to delete');
    const down = () => (how === 'key' ? key('keydown', 'Space') : ui.btn.emit('pointerdown'));
    const up = () => (how === 'key' ? key('keyup', 'Space') : ui.btn.emit('pointerup'));
    down(); step(); t = 2000; up(); step(); t = 2100; down(); step();
    t = 7000; step(); assert.equal(calls.length, 0, how + ': 4.9 s since the second press');
    t = 7100; step(); assert.equal(calls.length, 1, how);
    await flush();
    assert.deepEqual(went, ['create', undefined], 'the last build: off to the creator');
    assert.equal(app.selectedId, null);
  }
  // a failed request: the error says why, and it takes a new full hold (the press still down is stale)
  t = 0; calls = [];
  app.profile.characters = [build({ id: 'b4' })]; app.selectedId = 'b4';
  app.api.mutate = async () => { calls.push(1); throw new Error('Big Stretch is in a game that\'s still running. Finish it or leave it first, then delete the build.'); };
  ui = stubModal();
  D.openDeleteBuild(app, app.profile.characters[0], { now: () => t });
  key('keydown', 'Enter'); step(); t = 5000; step(); await flush();
  assert.equal(calls.length, 1); assert.match(toastEl.textContent, /still running/); assert.match(toastEl.className, /error/);
  t = 11000; step(); assert.equal(calls.length, 1, 'Enter still down: stale');
  key('keyup', 'Enter'); key('keydown', 'Enter'); step(); t = 16000; step(); await flush();
  assert.equal(calls.length, 2);
  // closing it (Cancel, ○ / B, Esc, a click outside: common.js closeModal) lets go of the keys at once, not a frame later,
  // so an Enter meant for the screen under it is never held up
  assert.equal((winL.keydown || []).length, base + 1);
  C.closeModal();
  assert.equal((winL.keydown || []).length, base);
  ui = stubModal();
  D.openDeleteBuild(app, app.profile.characters[0], { now: () => t });
  modalEl.innerHTML = ''; // (replaced without closeModal: the next key event or frame lets go)
  assert.equal(key('keydown', 'Enter').prevented, false);
  assert.equal((winL.keydown || []).length, base);
});

test('MyPlayer → Players: a Delete next to each name, its own control (never the card\'s pick), reachable on a controller', () => {
  const chars = [build(), build({ id: 'b2', name: 'Two', icon_status: true, icon_slot: true, overall: 99 })];
  const body = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const root = { innerHTML: '', querySelector: s => (s === '#mp-body' ? body : null), querySelectorAll: () => [] };
  MP.render({ profile: { characters: chars, build_slots: { unlocked: 5, base: 4, max: 8, icons: 1, kept: 0, used: 2 } }, selectedId: 'b1', config: {}, char() { return chars[0]; } }, root, { tab: 'players' });
  const html = body.innerHTML;
  assert.ok(html.includes('<div class="player-card on" data-pick="b1" role="button" tabindex="0">'), 'the card is a div: the button can sit inside it');
  assert.ok(html.includes('<span class="pc-name">Big Stretch<button class="pc-del" data-del="b1" title="Delete Big Stretch" aria-label="Delete Big Stretch">Delete</button></span>'));
  assert.ok(html.includes('data-del="b2"'));
  assert.ok(!/<button[^>]*player-card[^>]*data-pick/.test(html), 'no button inside a button');
  const mp = src('client/js/ui/myplayer.js');
  assert.match(mp, /b\.onclick = e => \{ if \(e\.target\.closest\('\[data-del\]'\)\) return;/, 'a click on Delete never picks the card');
  assert.match(mp, /\$\$\('\[data-del\]', root\)\.forEach\(b => b\.onclick = e => \{ e\.stopPropagation\(\);[^}]*openDeleteBuild\(app, ch\)/);
  // a deleted ICON's slot shows where it came from
  assert.equal(MP.slotsLine({ unlocked: 5, base: 4, max: 8, icons: 1, kept: 1 }), 'Build slots: 5 of 8 open — 4 base + 1 ICON (1 kept from a deleted ICON build). Every ICON build opens one more, up to 8.');
  // padnav: the card and its Delete are both stops (data-pick, button), A never clicks inside the hold screen (it's the
  // hold), and the hold button is where focus starts there
  const pn = src('client/js/ui/padnav.js');
  assert.match(pn, /const holdA = modalOpen\(\) && \$\('#modal \[data-padhold\]'\);\s*if \(inp\.gpEdge\(PAD\.A\)\) \{ if \(!holdA\) this\.activate\(\); inp\.gp\.prev\[PAD\.A\] = true; \}/);
  assert.match(pn, /pick = list\.find\(el => el\.matches\('\[data-padhold\]'\)\) \|\|/);
  assert.ok(pn.includes("[data-pick]") && pn.includes("button:not([disabled])"));
  assert.match(src('client/css/menus.css'), /\.pc-name \{ display: flex; align-items: center; justify-content: space-between;/);
});
