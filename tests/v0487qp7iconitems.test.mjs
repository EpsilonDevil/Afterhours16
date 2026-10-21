// v0.4.8.7 quick patch 7, Icon items (David: "make the 'Oprah' badge's exclusive pass animation package visible only in a
// playmaker archetypes inventory who has unlocked the Icon badge, still auto equipped like every other exclusive
// animation package; but viewable only by a build that has unlocked it in the inventory. Make sure that applies to all
// other badges with exclusive animations much like we did for Open-Arms and Glass Cleaner").
// Every Icon badge's own item (catalog "icon": <badge>): Oprah's new Pass Package, The Clamp's Steal Package, Big
// Brother's Block Package, Open Arms' Rebound Package, Sexy Red's Post Move Package, the Hash-Slinging dunk package,
// Sharp Eye's jumpshot base and release, The General's Salute. It shows in the Inventory, its category and the MyPlayer
// picker ONLY on the build that has unlocked that Icon badge (c.icon_badge: the server sets it from the archetype at the
// unlock); every other build doesn't see it at all (no locked card, no count, no tab of its own); it is never in the
// store; the account keeps it. The server side (equip refused, put on at the unlock): tests/test_oprahpass.py.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(src('server/catalog.json')), catalog = Object.fromEntries(list.map(i => [i.id, i]));
const ICON_ITEMS = list.filter(i => i.icon);

// ---------------- a small stand-in DOM (as in tests/v0487qp7menus.test.mjs) ----------------
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'source', 'wbr', 'col', 'link']);
const ROOTS = new Set();
class El {
  constructor(tag, attrs = {}) { this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.kids = []; this.parent = null; this.text = ''; this.scrollTop = 0; this.scrollLeft = 0; this.style = {}; this.disabled = 'disabled' in this.attrs; }
  get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = v; }
  get id() { return this.attrs.id || ''; }
  get dataset() { const d = {}; for (const k in this.attrs) if (k.startsWith('data-')) d[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = this.attrs[k]; return d; }
  get classList() { const me = this, l = () => me.className.split(/\s+/).filter(Boolean); return { contains: c => l().includes(c), add: c => { me.className = [...new Set([...l(), c])].join(' '); }, remove: c => { me.className = l().filter(x => x !== c).join(' '); }, toggle(c, on) { if (on ?? !l().includes(c)) this.add(c); else this.remove(c); } }; }
  get parentElement() { return this.parent; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return ROOTS.has(n); }
  get children() { return this.kids; }
  set innerHTML(h) { for (const k of this.kids) k.parent = null; this.kids = []; this.text = ''; parse(String(h), this); }
  get innerHTML() { return ''; }
  set textContent(t) { for (const k of this.kids) k.parent = null; this.kids = []; this.text = String(t); }
  get textContent() { return this.text + this.kids.map(k => k.textContent).join(''); }
  append(...ns) { for (const n of ns) { n.parent = this; this.kids.push(n); } }
  all() { const out = []; const w = n => { for (const k of n.kids) { out.push(k); w(k); } }; w(this); return out; }
  querySelectorAll(s) { return s === '*' ? this.all() : this.all().filter(n => matches(n, s)); }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  click() { if (!this.disabled) return this.onclick?.({ currentTarget: this, target: this, stopPropagation() {}, preventDefault() {} }); }
  focus() {}
}
const TOK = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
function parse(h, into) {
  const stack = [into];
  for (const m of h.matchAll(TOK)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { const i = stack.map(n => n.tagName).lastIndexOf(m[1].toUpperCase()); if (i > 0) stack.length = i; continue; }
    if (m[2]) { const a = {}; for (const x of (m[3] || '').matchAll(ATTR)) a[x[1]] = x[2] ?? x[3] ?? x[4] ?? ''; const el = new El(m[2], a); top.append(el); if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el); continue; }
    top.text += m[0];
  }
}
const PART = /([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
const one = (n, s) => [...s.matchAll(PART)].every(m => !((m[1] && m[1] !== '*' && n.tagName !== m[1].toUpperCase()) || (m[2] && n.id !== m[2]) || (m[3] && !n.classList.contains(m[3])) || (m[4] && (!(m[4] in n.attrs) || (m[5] != null && n.attrs[m[4]] !== m[5])))));
const matches = (n, sel) => sel.split(',').some(s => { const ch = s.trim().split(/\s+/); if (!one(n, ch.at(-1))) return false; let i = ch.length - 2; for (let p = n.parent; p && i >= 0; p = p.parent) if (one(p, ch[i])) i--; return i < 0; });

const html = new El('html'), body = new El('body'); ROOTS.add(html); html.append(body);
const ui = new El('div', { id: 'ui' }); body.append(ui, new El('div', { id: 'modal' }), new El('div', { id: 'toast' }));
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.document = { documentElement: html, scrollingElement: html, body, querySelector: s => html.querySelector(s), querySelectorAll: s => html.querySelectorAll(s), getElementById: id => html.querySelector('#' + id), createElement: t => new El(t), addEventListener() {} };
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame = () => 0;

const B = await import('../client/js/sim/builds.js');
const Store = await import('../client/js/ui/store.js');
const Inv = await import('../client/js/ui/inventory.js');
const { ICON_BADGES } = await import('../client/js/sim/badges.js');

// the account owns every Icon item (its Icon builds brought them in); a build of each kind
const ARCH = Object.fromEntries(Object.entries(ICON_BADGES).map(([k, v]) => [k, v.archetype]));
const build = (archetype, icon_badge = null) => ({ id: 'c_' + archetype + (icon_badge || ''), name: 'B', archetype, icon_badge, position: 'PG', overall: 99, height: 78, attributes: Object.fromEntries(['three_point', 'mid_range', 'layup', 'driving_dunk', 'standing_dunk', 'block', 'post_control', 'steal', 'pass_accuracy', 'ball_handle'].map(k => [k, 99])), rep: { level: 25, label: 'Legend' }, equipment: { top: 'yard_teal', bottom: 'yard_shorts', shoes: 'yard_shoes', release: 'release_classic', jumpshot: 'js_base_standard', dunk: 'dunk_basic', sizeup: 'sizeup_basic', layup: 'layup_basic', post: 'post_basic', block: 'block_basic' } });
const appFor = c => ({ char: () => c, catalog, profile: { inventory: list.filter(i => i.price === 0 || i.icon).map(i => i.id), balance: 0 }, config: { icon_badges: ICON_BADGES, rep_tiers: ['Rookie', 'Pro', 'All-Star', 'Superstar', 'Legend'] }, audio: { ui() {} }, showroom: { setCharacter() {}, setFocus() {}, setPreview() {} }, look: () => ({}) });
const screen = () => { ui.innerHTML = ''; const r = new El('div'); ui.append(r); return r; };
const shownIds = root => root.querySelectorAll('[data-item]').map(b => b.attrs['data-item']);
const tabs = root => Object.fromEntries(root.querySelectorAll('[data-cat]').map(b => [b.attrs['data-cat'], +(b.querySelector('em')?.textContent ?? -1)]));

// ---------------- the items ----------------
test('every Icon badge has its own item now, Oprah\'s Pass Package among them, and every one is an Icon secret', () => {
  assert.deepEqual([...new Set(ICON_ITEMS.map(i => i.icon))].sort(), Object.keys(ICON_BADGES).sort());
  const op = catalog.pass_oprah;
  assert.deepEqual([op.slot, op.category, op.icon, op.exclusive, op.secret, op.price], ['pass', 'animation', 'oprah', 'icon', true, 0]);
  assert.equal(ICON_BADGES.oprah.archetype, 'playmaker');
  for (const i of ICON_ITEMS) assert.ok(i.secret && i.exclusive === 'icon' && i.price === 0, i.id);
  // the Hash-Slinging dunk package was the one without the mark
  assert.equal(catalog.dunk_hash_slinging.secret, true);
});

test('the rule: never in the store; in the Inventory only for the build that has unlocked that Icon badge', () => {
  for (const i of ICON_ITEMS) {
    assert.equal(B.inStore(i), false, `${i.id}: never in the store`);
    const holder = build(ARCH[i.icon], i.icon);
    assert.equal(B.forBuild(i, holder), true, `${i.id}: its holder sees it`);
    assert.equal(B.forBuild(i, build(ARCH[i.icon])), false, `${i.id}: the same archetype without the badge doesn't`);
    for (const other of Object.keys(ICON_BADGES).filter(k => k !== i.icon)) assert.equal(B.forBuild(i, build(ARCH[other], other)), false, `${i.id}: ${other}'s holder doesn't`);
    assert.equal(B.forBuild(i, null), false);
    // (it doesn't hang on the secret mark: an Icon item without it is just as hidden)
    const unmarked = { ...i, secret: undefined };
    assert.equal(B.inStore(unmarked), false); assert.equal(B.forBuild(unmarked, build(ARCH[i.icon])), false); assert.equal(B.forBuild(unmarked, holder), true);
  }
  // everything else as before
  assert.equal(B.forBuild(catalog.dunk_basic, build('playmaker')), true);
  assert.equal(B.inStore(catalog.dunk_basic), true);
});

test('a category that holds nothing but one Icon\'s items is that Icon\'s tab: never in the store, only for its holder', () => {
  // (every such category carries its Icon in store.js CATS, so no other build ever gets an empty tab)
  for (const [cat] of Store.CATS) {
    const items = list.filter(i => Store.inCat(i, cat));
    const icons = [...new Set(items.map(i => i.icon || null))];
    if (items.length && icons.length === 1 && icons[0]) assert.equal(Store.CATS.find(c => c[0] === cat)[4], icons[0], `${cat} is ${icons[0]}'s alone`);
  }
  assert.deepEqual(Store.CATS.find(c => c[0] === 'pass'), ['pass', 'Passes', 'wide', 'Animations', 'oprah']);
  assert.equal(Store.catShown('pass'), false, 'not in the store');
  assert.equal(Store.catShown('pass', build('playmaker', 'oprah')), true);
  assert.equal(Store.catShown('pass', build('playmaker')), false);
  assert.equal(Store.catShown('pass', build('lockdown', 'the_clamp')), false);
  assert.equal(Store.optionalSlot(catalog.pass_oprah), false, 'the passes come with the badge: nothing to take off');
});

test('the Inventory: the holder sees his Icon\'s items and tab, counted; every other build sees no card, no count and no tab of them', () => {
  for (const icon of Object.keys(ICON_BADGES)) {
    const mine = ICON_ITEMS.filter(i => i.icon === icon);
    for (const [who, c] of [['holder', build(ARCH[icon], icon)], ['no badge', build(ARCH[icon])], ['another Icon', build(ARCH[icon === 'oprah' ? 'the_clamp' : 'oprah'], icon === 'oprah' ? 'the_clamp' : 'oprah')]]) {
      const app = appFor(c);
      for (const it of mine) {
        const cat = Store.catOf(it), root = screen();
        Inv.render(app, root, { cat });
        const t = tabs(root), sees = who === 'holder';
        if (sees) {
          assert.ok(shownIds(root).includes(it.id), `${it.id}: the holder's card`);
          assert.ok(t[cat] >= 1, `${it.id}: counted in ${cat}`);
          assert.ok(!root.querySelector(`[data-item="${it.id}"]`).classList.contains('locked'), 'and his to wear');
        } else {
          // the render falls back to Tops when the category isn't his; either way none of the Icon's cards anywhere
          for (const k of Object.keys(t)) { const r2 = screen(); Inv.render(app, r2, { cat: k }); assert.ok(!shownIds(r2).some(id => catalog[id].icon && catalog[id].icon !== c.icon_badge), `${who}: no other Icon's card in ${k}`); }
          const ownsCat = Store.CATS.find(x => x[0] === cat)[4];
          if (ownsCat) assert.ok(!(cat in t), `${who}: no ${cat} tab`);
          else assert.equal(t[cat], list.filter(i => app.profile.inventory.includes(i.id) && Store.inCat(i, cat) && B.forBuild(i, c)).length, `${who}: ${cat} count leaves it out`);
          // the header's item count leaves it out too
          const all = list.filter(i => app.profile.inventory.includes(i.id) && B.forBuild(i, c)).length;
          assert.match(root.querySelector('.eyebrow').textContent, new RegExp(`INVENTORY · ${all} ITEMS`));
        }
      }
    }
  }
});

test('the store: none of them, in any category, for any build', () => {
  for (const c of [build('playmaker', 'oprah'), build('slasher', 'hash_slinging'), build('two_way')]) {
    for (const [cat] of Store.catsFor()) {
      const root = screen();
      Store.render(appFor(c), root, { cat });
      assert.ok(!shownIds(root).some(id => catalog[id].icon), `${cat}: no Icon item`);
      assert.ok(!root.querySelector('[data-cat="pass"]') && !root.querySelector('[data-cat="steal"]') && !root.querySelector('[data-cat="rebound"]'));
    }
  }
});

test('MyPlayer\'s animation picker and the AI follow the same rule', () => {
  const mp = src('client/js/ui/myplayer.js');
  assert.match(mp, /\['pass', 'Pass package', null, 'oprah'\]/, 'a Pass package row, for Oprah\'s holder alone');
  assert.match(mp, /ANIM_SLOTS\.filter\(\(\[, , , icon\]\) => !icon \|\| c\.icon_badge === icon\)/);
  assert.match(mp, /inv\.has\(i\.id\) && forBuild\(i, c\)/);
  // an AI Icon wears his Icon's items, Oprah's Pass Package with them (sim/bots.js wearUnlocked)
  assert.match(src('client/js/sim/bots.js'), /i\.exclusive === 'icon' && i\.icon === build\.icon_badge/);
});
