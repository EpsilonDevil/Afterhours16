// v0.4.8.7 quick patch 7, the menus: scroll wheels that "randomly" ignored input and jumped back to the top. Every
// menu redraw (a purchase, an equip, a pick, a filter, a timer tick, a Screens.go to the screen you're on) used to
// rebuild its panel, and a new panel starts at the top. Now: a redraw keeps every list where it was (keepScroll in
// ui/common.js), a tab change inside a screen starts that tab at the top, countdown ticks change text only (a hovered
// or half-pressed button is never swapped out from under the pointer), slow requests can't be sent twice (busy()),
// a slider being dragged in the builder is never rebuilt, and the CSS lets the wheel scroll the home hub at short
// window heights and keeps a scroller's wheel to itself.
// The page is a small stand-in DOM (below): enough HTML parsing and selectors for the real menu code to draw into it,
// with scrollTop starting at 0 on every new node, as a browser's does.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---------------- the stand-in DOM ----------------
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'source', 'wbr', 'col', 'link']);
const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const ROOTS = new Set();
class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.kids = []; this.parent = null; this.text = '';
    this.scrollTop = 0; this.scrollLeft = 0; this.style = {}; this.listeners = {}; this.hidden = false; this.focusOpts = null;
    this.disabled = 'disabled' in this.attrs; this.value = this.attrs.value ?? ''; this.min = this.attrs.min; this.max = this.attrs.max;
  }
  get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = v; }
  get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = v; }
  get dataset() { const d = {}; for (const k in this.attrs) if (k.startsWith('data-')) d[camel(k.slice(5))] = this.attrs[k]; return d; }
  get classList() {
    const me = this, list = () => me.className.split(/\s+/).filter(Boolean);
    return { contains: c => list().includes(c), add: (...cs) => { me.className = [...new Set([...list(), ...cs])].join(' '); },
      remove: (...cs) => { me.className = list().filter(x => !cs.includes(x)).join(' '); },
      toggle(c, on = !list().includes(c)) { if (on) this.add(c); else this.remove(c); return on; } };
  }
  get parentElement() { return this.parent; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return ROOTS.has(n); }
  get children() { return this.kids; } get childNodes() { return this.kids; } get firstElementChild() { return this.kids[0] || null; }
  getAttribute(k) { return this.attrs[k] ?? null; } setAttribute(k, v) { this.attrs[k] = String(v); } hasAttribute(k) { return k in this.attrs; } removeAttribute(k) { delete this.attrs[k]; }
  set innerHTML(h) { this.detachKids(); this.text = ''; this.src = String(h); parse(this.src, this); }
  get innerHTML() { return this.src ?? ''; }
  set textContent(t) { this.detachKids(); this.text = String(t); this.src = this.text; }
  get textContent() { return this.text + this.kids.map(k => k.textContent).join(''); }
  detachKids() { for (const k of this.kids) k.parent = null; this.kids = []; }
  append(...ns) { for (const n of ns) { if (typeof n === 'string') { this.text += n; continue; } n.parent?.kids.splice(n.parent.kids.indexOf(n), 1); n.parent = this; this.kids.push(n); } }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...ns) { this.detachKids(); this.text = ''; this.append(...ns); }
  remove() { if (this.parent) { this.parent.kids.splice(this.parent.kids.indexOf(this), 1); this.parent = null; } }
  insertAdjacentHTML(pos, h) { const t = new El('div'); t.innerHTML = h; this.append(...[...t.kids]); }
  all() { const out = []; const walk = n => { for (const k of n.kids) { out.push(k); walk(k); } }; walk(this); return out; }
  querySelectorAll(sel) { return sel === '*' ? this.all() : this.all().filter(n => matches(n, sel, this)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  matches(sel) { return matches(this, sel, null); }
  closest(sel) { for (let n = this; n; n = n.parent) if (matches(n, sel, null)) return n; return null; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  fire(t, ev = {}) { for (const f of this.listeners[t] || []) f(ev); }
  // a click as a browser sends it: nothing on a disabled button, and the event's currentTarget is gone once the handler
  // has returned (an async handler that reads it after an await gets null)
  click() { if (this.disabled) return; const ev = { type: 'click', target: this, currentTarget: this, stopPropagation() {}, preventDefault() {} }; const r = this.onclick?.(ev); ev.currentTarget = null; return r; }
  focus(opts) { this.focusOpts = opts || {}; }
  getContext() { return new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true }); }
}
// HTML: tags, attributes (quoted or not), text; no entities beyond what the tests read
const TOK = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
function parse(h, into) {
  const stack = [into];
  for (const m of h.matchAll(TOK)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { const t = m[1].toUpperCase(); const i = stack.map(n => n.tagName).lastIndexOf(t); if (i > 0) stack.length = i; continue; }
    if (m[2]) {
      const attrs = {}; for (const a of (m[3] || '').matchAll(ATTR)) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
      const el = new El(m[2], attrs); top.append(el);
      if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el);
      continue;
    }
    top.text += m[0];
  }
}
// selectors: compound parts (tag, #id, .class, [attr], [attr="v"], :last-child, :first-child, *) joined by descendant
// spaces, in comma lists
const PART = /([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:(last-child|first-child)/g;
const compound = s => [...s.matchAll(PART)].map(m => m);
function one(n, parts) {
  for (const m of parts) {
    if (m[1] && m[1] !== '*' && n.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && n.id !== m[2]) return false;
    if (m[3] && !n.classList.contains(m[3])) return false;
    if (m[4] && (!(m[4] in n.attrs) || (m[5] != null && n.attrs[m[4]] !== m[5]))) return false;
    if (m[6] === 'last-child' && n.parent?.kids.at(-1) !== n) return false;
    if (m[6] === 'first-child' && n.parent?.kids[0] !== n) return false;
  }
  return true;
}
function matches(n, sel, scope) {
  return sel.split(',').some(s => {
    const chain = s.trim().split(/\s+(?![^[]*\])/).map(compound);
    if (!one(n, chain.at(-1))) return false;
    let i = chain.length - 2;
    for (let p = n.parent; p && i >= 0; p = p.parent) { if (one(p, chain[i])) i--; }
    return i < 0;
  });
}

// the page: <html><body><div id="ui"></div><div id="modal" hidden></div><div id="toast"></div></body></html>
const html = new El('html'), body = new El('body'); ROOTS.add(html); html.append(body);
const ui = new El('div', { id: 'ui' }), modalEl = new El('div', { id: 'modal' }), toastEl = new El('div', { id: 'toast' });
modalEl.hidden = true; body.append(ui, modalEl, toastEl);
const winL = {};
globalThis.window = globalThis;
globalThis.addEventListener = (t, f) => { (winL[t] ||= []).push(f); };
globalThis.removeEventListener = (t, f) => { winL[t] = (winL[t] || []).filter(x => x !== f); };
globalThis.document = { documentElement: html, scrollingElement: html, body, activeElement: null, hidden: false,
  querySelector: s => html.querySelector(s), querySelectorAll: s => html.querySelectorAll(s), getElementById: id => html.querySelector('#' + id),
  createElement: t => new El(t), addEventListener() {}, removeEventListener() {} };
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
// frames by hand; timers: setInterval is caught (the tests run the ticks), setTimeout never holds the run open
let frames = [];
globalThis.requestAnimationFrame = f => { frames.push(f); return frames.length; };
const flush = () => { const q = frames; frames = []; q.forEach(f => f()); };
const realST = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => { const h = realST(f, ms, ...a); h?.unref?.(); return h; };
let intervals = [];
globalThis.setInterval = (f, ms) => { intervals.push({ f, ms }); return intervals.length; };
globalThis.clearInterval = h => { if (intervals[h - 1]) intervals[h - 1].f = null; };
const ticks = ms => intervals.filter(t => t.ms === ms && t.f);

const C = await import('../client/js/ui/common.js');
const Screens = await import('../client/js/ui/screens.js');
const Stats = await import('../client/js/ui/stats.js');
const Codes = await import('../client/js/ui/codes.js');
const Builder = await import('../client/js/ui/builder.js');
const Phone = await import('../client/js/ui/phone.js');
const Rewards = await import('../client/js/ui/rewards.js');
const Modes = await import('../client/js/ui/modes.js');
await import('../client/js/ui/crew.js'); // (it parses: a comment once swallowed the end of its try block)

const screenRoot = () => { ui.innerHTML = ''; const r = new El('div', { class: 'screen' }); ui.append(r); return r; };
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };
const CHAR = { id: 'c1', name: 'Rook Ie', position: 'SG', archetype: 'sharpshooter', overall: 72, height: 77, weight: 205, wingspan: 81, rep: { label: 'Rookie 1' }, progression: {}, attributes: {}, badges: {} };

// ---------------- what counts as the same view ----------------
test('Screens.sameView: the same tab, view, category and mode is a refresh (kept in place); any other is a new view (its top)', () => {
  assert.ok(Screens.sameView({}, {}));
  assert.ok(Screens.sameView({ tab: 'badges' }, { tab: 'badges', item: 'x' }), 'what is picked inside a view is not a new view');
  assert.ok(!Screens.sameView({ tab: 'badges' }, { tab: 'attributes' }));
  assert.ok(!Screens.sameView({}, { cat: 'shoes' }));
  assert.ok(!Screens.sameView({ view: 'capbreakers' }, {}));
  assert.ok(Screens.sameView(undefined, null));
  const g = src('client/js/ui/screens.js');
  assert.match(g, /const refresh = app\.screen === name && sameView\(app\.screenParams, params\)/);
  assert.match(g, /refresh \? keepScroll\(ui, \(\) => drawScreen\(app, name, params, ui\)\) : drawScreen\(app, name, params, ui\)/);
});

// ---------------- a redraw keeps its place ----------------
test('stats: picking another mode or build redraws the panel where you were scrolled (the screen and the pause-menu modal)', () => {
  const app = { char: () => CHAR, profile: { characters: [CHAR] } };
  const root = screenRoot();
  Stats.render(app, root);
  const p0 = root.querySelector('.stats-panel');
  assert.ok(p0 && root.querySelectorAll('[data-mode]').length === 4);
  p0.scrollTop = 420;
  root.querySelector('[data-mode="park"]').click();
  const p1 = root.querySelector('.stats-panel');
  assert.notEqual(p1, p0, 'the panel was redrawn');
  assert.equal(p1.scrollTop, 420, 'and is where it was, not at the top');
  assert.ok(root.querySelector('[data-mode="park"]').classList.contains('on'));
  flush(); assert.equal(p1.scrollTop, 420, 'the late pass leaves it be');
  // the modal: its card is the scroller
  Stats.openStatsModal(app);
  const card = modalEl.querySelector('.modal-card');
  card.scrollTop = 260;
  modalEl.querySelector('[data-mode="proam"]').click();
  assert.equal(modalEl.querySelector('.modal-card'), card, 'the modal redraws in place');
  assert.equal(card.scrollTop, 260);
  C.closeModal();
});

test('locker codes: a code that pays out grows the list in place, and Enter again while it checks sends nothing', async () => {
  const d = deferred(); let sent = 0;
  const app = { profile: { locker_codes: [] }, setBalance() {}, api: { mutate: () => { sent++; return d.p; } } };
  const root = screenRoot();
  Codes.render(app, root);
  const input = root.querySelector('[data-code]');
  assert.deepEqual(input.focusOpts, { preventScroll: true }, 'focusing the box never scrolls the panel up to it');
  root.querySelector('.codes-panel').scrollTop = 250;
  input.value = 'ABCD-1';
  const form = root.querySelector('[data-form]');
  const ev = () => ({ preventDefault() {} });
  const first = form.onsubmit(ev());
  form.onsubmit(ev()); form.onsubmit(ev());
  assert.equal(sent, 1, 'one request, however many times Enter is pressed');
  d.res({ balance: 10, code: 'ABCD-1', used: 1, max: 1, label: '+500 VC', vc: 500 });
  await first;
  const p = root.querySelector('.codes-panel');
  assert.equal(p.scrollTop, 250);
  assert.match(root.querySelector('.code-list').textContent, /ABCD-1/);
  assert.match(root.querySelector('[data-result]').textContent, /UNLOCKED/);
});

// ---------------- the builder ----------------
const CFG = { skin: ['#a56945', '#7a4a30'], faces: ['oval', 'square'], hair: ['fade', 'bald'], hair_colors: ['#201b19'], beards: ['stubble', 'none'], eyes: ['#3a2418'], default_equipment: {} };
const builderApp = () => ({ config: CFG, profile: { characters: [CHAR], build_slots: { unlocked: 4 } }, showroom: { setCharacter() {}, setFocus() {} }, look: () => ({}), api: {}, replaceChar() {} });

test('builder: a slider being dragged is never rebuilt under the pointer; its readout, the wingspan range and the side panel follow it', () => {
  const root = screenRoot();
  Builder.create(builderApp(), root, {});
  const panel = root.querySelector('.builder');
  panel.scrollTop = 380;
  const h = root.querySelector('[data-num="height"]'), ws = root.querySelector('[data-num="wingspan"]');
  const side0 = root.querySelector('.builder-side'), ovr0 = side0.querySelector('.ovr b').textContent;
  h.value = String(+h.min); h.oninput(); // (all the way down)
  assert.ok(h.isConnected && root.querySelector('[data-num="height"]') === h, 'the same slider: the drag goes on');
  assert.equal(root.querySelector('.builder'), panel, 'the builder was not redrawn');
  assert.equal(panel.scrollTop, 380);
  assert.equal(h.parentElement.querySelector('b').textContent, C.heightStr(+h.min), 'its readout');
  assert.equal(+ws.min, +h.min - 1, 'the wingspan range moves with the height'); assert.equal(+ws.max, +h.min + 8);
  assert.equal(root.querySelector('.builder-side'), side0, 'the side panel is kept');
  assert.ok(side0.querySelectorAll('.attr-row').length > 10, 'and refilled');
  assert.notEqual(side0.querySelector('.ovr b').textContent + '|' + side0.textContent, ovr0 + '|', 'with the new numbers');
  // a pick (archetype, position, hand, look) redraws, where you were
  root.querySelector('[data-arch="two_way"]').click();
  assert.notEqual(root.querySelector('.builder'), panel);
  assert.equal(root.querySelector('.builder').scrollTop, 380);
  assert.ok(root.querySelector('[data-arch="two_way"]').classList.contains('on'));
});

test('builder: the appearance editor\'s Save comes back after the request (it used to stay greyed out), and a look pick keeps the place', async () => {
  const d = deferred(); let sent = 0;
  const app = { ...builderApp(), api: { mutate: () => { sent++; return d.p; } } };
  const root = screenRoot();
  const panel = new El('section', { class: 'panel mp' }); root.append(panel);
  const box = new El('div'); panel.append(box);
  Builder.appearanceEditor(app, box, { ...CHAR, appearance: { skin: '#a56945', hair: 'fade', hair_color: '#201b19', face: 'oval', beard: 'stubble', eyes: '#3a2418', number: 16 } });
  panel.scrollTop = 200;
  box.querySelector('[data-look="face"][data-val="square"]').click();
  assert.equal(panel.scrollTop, 200);
  const save = box.querySelector('[data-save]');
  const p = save.click(); save.click();
  assert.equal(sent, 1);
  d.res({ character: CHAR });
  await p;
  assert.equal(save.disabled, false, 'Save is back');
});

// ---------------- the phone ----------------
function phoneWorld() {
  const on = { harbor: ['a1', 'a2', 'a3'], brick: ['a4'], foundry: [] };
  const w = {
    on, friends: [], squad: [], met: {}, ch: [],
    onChange: f => { w.ch.push(f); return () => {}; },
    onlineAt: pk => on[pk] || [], account: () => ({ level: 3, home: 'harbor' }), onlineCount: () => Object.values(on).flat().length,
    isFriend: id => w.friends.includes(id), inSquad: () => false, playingElsewhere: () => false, habitText: () => 'Evenings',
    statusText: () => ({ online: true, park: 'harbor', text: 'Online · Harbor Point' }),
    entry: id => ({ name: 'Player ' + id, tier: 'regular', tierLabel: 'Regular', rep: { label: 'Pro 1' }, badges: {}, build: { overall: 80, position: 'SF', archetype: 'two_way', height: 79, weight: 210 } }),
    addFriend: id => { w.friends.push(id); return true; }, removeFriend() {},
  };
  return w;
}
test('the phone: its 5 s tick changes the clock and the count in place, redraws the list only when it changed (kept where it was), never under a press', () => {
  intervals = [];
  const w = phoneWorld(), app = { ai: w, config: {}, mode: 'menu', input: {} };
  Phone.openPhone(app, { tab: 'park' });
  const host = modalEl.querySelector('[data-phone]');
  const list = host.querySelector('.ph-body'), btn = host.querySelector('[data-add="a2"]');
  assert.ok(list && btn);
  list.scrollTop = 300;
  host.phoneTick();
  assert.equal(host.querySelector('.ph-body'), list, 'nothing changed: nothing redrawn');
  assert.equal(host.querySelector('[data-add="a2"]'), btn, 'the button under your pointer is the same one');
  assert.equal(list.scrollTop, 300);
  assert.equal(ticks(5000).length, 1, 'one 5 s tick');
  // someone came on: the list is redrawn, where it was
  w.on.foundry.push('a9');
  host.phoneTick();
  const list2 = host.querySelector('.ph-body');
  assert.notEqual(list2, list); assert.equal(list2.scrollTop, 300);
  assert.match(host.querySelector('.ph-status').textContent, /5 online/);
  // mouse down on a button, the tick comes, mouse up: the button is still there to take the click
  const b2 = host.querySelector('[data-add="a3"]');
  host.fire('pointerdown');
  w.on.brick.push('a8');
  host.phoneTick();
  assert.equal(host.querySelector('[data-add="a3"]'), b2, 'no redraw mid-press');
  (winL.pointerup || []).forEach(f => f({}));
  host.phoneTick();
  assert.notEqual(host.querySelector('[data-add="a3"]'), b2, 'after the press the change comes through');
  C.closeModal();
});

test('the phone: back from a profile puts the list where you left it, once; a new tab starts at its top; the same tab does nothing', () => {
  intervals = [];
  const w = phoneWorld(), app = { ai: w, config: {}, mode: 'menu', input: {} };
  Phone.openPhone(app, { tab: 'park' });
  const host = modalEl.querySelector('[data-phone]');
  host.querySelector('.ph-body').scrollTop = 340;
  host.querySelector('[data-who="a2"]').click();
  assert.equal(host.querySelector('.ph-body').scrollTop, 0, 'the profile opens at its top');
  assert.ok(host.querySelector('[data-back]'));
  host.querySelector('[data-back]').click();
  assert.equal(host.querySelector('.ph-body').scrollTop, 340, 'back where you were');
  // you scroll on; the next redraw keeps your new place (the old one is not forced on it again)
  host.querySelector('.ph-body').scrollTop = 120;
  w.on.foundry.push('a9'); host.phoneTick();
  assert.equal(host.querySelector('.ph-body').scrollTop, 120);
  // the same tab: nothing; another tab: its top
  const b = host.querySelector('.ph-body');
  host.querySelector('[data-tab="park"]').click();
  assert.equal(host.querySelector('.ph-body'), b);
  host.querySelector('[data-tab="friends"]').click();
  assert.equal(host.querySelector('.ph-body').scrollTop, 0);
  C.closeModal();
});

// ---------------- countdowns touch text only ----------------
test('the Daily Spin countdown: the Spin button is left alone every second (a hover or a press lives through it); the text changes in place', () => {
  intervals = [];
  const app = { config: { wheel: { segments: [], odds: {} } }, profile: { daily_spin: { next_at: Date.now() / 1000 + 3600 } }, affColor: '#ff4d24' };
  Rewards.openWheel(app, () => {});
  const btn = modalEl.querySelector('[data-spin]'), st = modalEl.querySelector('[data-status]');
  assert.equal(btn.disabled, true);
  let writes = 0; let dis = btn.disabled;
  Object.defineProperty(btn, 'disabled', { get: () => dis, set: v => { writes++; dis = v; }, configurable: true });
  const [t] = ticks(1000);
  const realNow = Date.now, T = realNow();
  Date.now = () => T;
  t.f();
  const kid = st.querySelector('b');
  t.f(); t.f();
  assert.equal(modalEl.querySelector('[data-spin]'), btn);
  assert.equal(writes, 0, 'the button was not touched');
  assert.match(st.textContent, /Next spin in/);
  assert.equal(st.querySelector('b'), kid, 'the same text: the status is not rewritten either');
  Date.now = () => T + 1000; t.f();
  assert.notEqual(st.querySelector('b'), kid, 'a new second: the text moves on');
  Date.now = realNow;
  // the spin comes ready: the button changes, once
  app.profile.daily_spin.next_at = 0; t.f(); t.f();
  assert.equal(writes, 1); assert.equal(dis, false);
  assert.match(st.textContent, /ready/);
  C.closeModal();
});

test('results countdowns (autoPress): the same button, only its label changes, and it presses itself at 0', () => {
  intervals = [];
  const btn = new El('button'); btn.textContent = 'Continue'; body.append(btn);
  let pressed = 0; btn.onclick = () => { pressed++; };
  Modes.autoPress(btn, 2);
  assert.equal(btn.textContent, 'Continue · 2');
  const [t] = ticks(1000);
  t.f(); assert.equal(btn.textContent, 'Continue · 1');
  t.f();
  assert.equal(pressed, 1);
  assert.equal(t.f, null, 'and stops');
  btn.remove();
});

// ---------------- the other redraws, by their code ----------------
test('store, inventory, MyPlayer, Pro Run, Pro-Am, crew: action redraws keep their place, tab changes start at the top, slow buttons are busy()', () => {
  const st = src('client/js/ui/store.js'), inv = src('client/js/ui/inventory.js'), mp = src('client/js/ui/myplayer.js'),
    pr = src('client/js/ui/prorun.js'), md = src('client/js/ui/modes.js'), cr = src('client/js/ui/crew.js');
  for (const [n, s] of [['store', st], ['inventory', inv]]) {
    assert.match(s, /const draw = \(fresh = false\) => \(fresh \? paint\(\) : keepScroll\(root, paint\)\)/, n + ': an action redraw keeps the place');
    assert.match(s, /draw\(true\)/, n + ': a category starts at its top');
  }
  assert.match(st, /busy\(buyBtn, true\)/, 'a purchase is sent once');
  assert.match(inv, /busy\(eq, true\)/, 'an equip is sent once');
  assert.match(mp, /const draw = \(\) => keepScroll\(root, paint\)/, 'attributes and badges');
  assert.match(mp, /const draw = \(\) => keepScroll\(body, paint\)/, 'the cap breakers');
  assert.match(mp, /keepScroll\(scr, \(\) => render\(app, scr, \{ tab: 'animations' \}\)\)/, 'equipping an animation');
  assert.match(pr, /keepScroll\(root, paint\)/);
  assert.match(md, /const draw = \(\) => keepScroll\(root, paint\);\n\s+const paint = \(\) => \{\n\s+const roster = proamRoster/, 'Pro-Am: colors, logo, floor, new teammates, the phone closing');
  assert.match(md, /\[data-save\]', root\)\.onclick = async ev => \{ const b = ev\.currentTarget; if \(b\.disabled\) return; busy\(b, true\)/);
  assert.match(md, /busy\(b, true\); \/\/ \(qp7: one game per click/);
  assert.match(cr, /await keepScroll\(\$\('#modal'\), \(\) => openCrew\(app, opts, closeModal\)\)/, 'the crew card reopens where it was');
  assert.match(cr, /busy\(btn, true\)/);
  const line = cr.split('\n').find(l => l.includes("mc.style.animation = 'none'"));
  assert.ok(!/\/\/[^\n]*opts\.onChange/.test(line), 'onChange and the sync are code, not a comment');
});

test('menus.css: the home hub scrolls when it must, the main scrollers keep the wheel, the filter screens keep their scrollbar space', () => {
  const css = src('client/css/menus.css');
  const last = css.slice(css.lastIndexOf('v0.4.8.7 qp7'));
  assert.match(last, /\.home-hub \{ overflow-x: hidden; overflow-y: auto; \}/);
  assert.match(last, /\.panel, \.modal-card, \.ph-body, \.help-overlay \{ overscroll-behavior: contain; \}/);
  assert.match(last, /\.panel\.store, \.panel\.mp, \.panel\.stats-panel \{ scrollbar-gutter: stable; \}/);
  assert.ok(!/\.crew-add[^{]*\{[^}]*overscroll-behavior/.test(css), 'the small lists inside a card chain on to it (no trapped wheel)');
});
