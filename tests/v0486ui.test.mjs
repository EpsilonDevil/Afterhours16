// v0.4.8.6, the RIMRIFT identity patch, the UI side: the title screen (ui/brandintro.js, before the game: brandboot.js
// imports main.js once it's entered), the palette (Ember #ff4d24 for the brand accent, Bone #f3eee4, Carbon #080a0d; gold
// kept where it means gold), the name on every visible string, and the favicon. The brand assets and the world's
// branding: tests/v0486brand.test.mjs.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const src = f => fs.readFileSync(new URL(f, root), 'utf8');

// ---- a stub page for the title screen: the body's children, window listeners, frames by hand, pads by hand ----
const winL = {}, events = [];
globalThis.window = globalThis;
globalThis.addEventListener = (t, f) => { (winL[t] ||= []).push(f); };
globalThis.removeEventListener = (t, f) => { winL[t] = (winL[t] || []).filter(x => x !== f); };
globalThis.dispatchEvent = e => { events.push(e); return true; };
globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; } observe() { this.on = true; } disconnect() { this.on = false; } };
function el(tag = 'div') {
  const kids = {};
  return { tagName: tag.toUpperCase(), attrs: {}, style: {}, inert: false, isConnected: false, focused: 0, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; },
    querySelector(s) { return (kids[s] ||= el(s === 'button' ? 'button' : 'div')); },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); },
    click() { for (const f of this.listeners.click || []) f({}); }, focus() { this.focused++; }, remove() { this.isConnected = false; body.list = body.list.filter(x => x !== this); } };
}
const body = { list: [], get children() { return this.list; }, append(n) { n.isConnected = true; this.list.push(n); } };
const ui = el('div'), canvas = el('canvas'); body.append(ui); body.append(canvas);
globalThis.document = { body, baseURI: 'http://127.0.0.1/', activeElement: canvas, getElementById: id => body.list.find(n => n.id === id) || null, createElement: el, querySelector: () => null };
const key = (type, k, repeat = false) => { const e = { type, key: k, repeat, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; for (const f of winL[type] || []) f(e); return e; };
let frames = [];
const step = () => { const q = frames; frames = []; q.forEach(f => f()); };
const pad = (index, a = false, start = false) => ({ index, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: (i === 0 && a) || (i === 9 && start) })) });
const { mountBrandIntro } = await import('../client/js/ui/brandintro.js');
function mount(pads = []) {
  const got = [];
  const list = { pads };
  const dismiss = mountBrandIntro({ base: 'brand/', onEnter: how => got.push(how), pads: () => list.pads, raf: f => { frames.push(f); return frames.length; }, caf: () => {} });
  const intro = body.list.find(n => n.id === 'rimrift-intro');
  return { got, list, dismiss, intro };
}

test('the title screen goes up over everything: the logo and key art from brand/, the copy, everything under it inert', () => {
  const { got, intro, dismiss } = mount();
  assert.ok(intro && intro.isConnected);
  assert.equal(intro.attrs.role, 'dialog'); assert.equal(intro.attrs['aria-modal'], 'true');
  for (const s of ['MAKE YOUR OWN<br>GRAVITY.', 'Own the air. Find your run.', 'ENTER THE COURT', 'EARLY BUILD', 'CONTROLLER A / START', 'THE NEXT RUN STARTS HERE.']) assert.ok(intro.html.includes(s), s);
  assert.equal(intro.querySelector('.rr-logo').src, 'http://127.0.0.1/brand/rimrift-logo.svg');
  assert.equal(intro.querySelector('.rr-backdrop').style.backgroundImage, 'url("http://127.0.0.1/brand/gravity-keyart.jpg")');
  assert.ok(ui.inert && canvas.inert, 'the game under it is inert');
  assert.ok(intro.querySelector('button').focused > 0, 'the button has the focus');
  assert.equal(mountBrandIntro(), dismiss, 'a second mount gives back the first one');
  // keys: everything is swallowed, a repeat (a key held from before) does nothing, Tab keeps the focus on the button
  const tab = key('keydown', 'Tab'); assert.ok(tab.prevented && tab.stopped);
  assert.ok(key('keydown', 'Enter', true).stopped); assert.equal(got.length, 0, 'a held key (only repeats) does not enter');
  assert.ok(key('keyup', 'Enter').stopped);
  key('keydown', 'Enter');
  assert.deepEqual(got, ['key'], 'a fresh Enter enters');
  assert.ok(!intro.isConnected && !ui.inert && !canvas.inert, 'gone, and the page is live again');
  assert.equal((winL.keydown || []).length, 0); assert.equal((winL.keyup || []).length, 0);
  assert.ok(canvas.focused > 0, 'the focus goes back where it was');
  assert.equal(events.at(-1).type, 'rimrift:enter'); assert.equal(events.at(-1).detail.how, 'key');
  key('keydown', 'Enter'); assert.deepEqual(got, ['key'], 'once');
});

test('Space and Esc enter, and a click on ENTER THE COURT', () => {
  for (const [k, how] of [[' ', 'key'], ['Escape', 'key']]) { const m = mount(); key('keydown', k); assert.deepEqual(m.got, [how]); }
  const m = mount(); m.intro.querySelector('button').click(); assert.deepEqual(m.got, ['pointer']);
  const n = mount(); key('keydown', 'a'); key('keydown', 'ArrowDown'); assert.deepEqual(n.got, [], 'other keys do nothing');
  n.dismiss();
});

test('a controller: only a fresh ✕ / A or Start enters (one held as it shows has to be let go first)', () => {
  // A already held on a pad that's there as it shows (the A that opened it from Settings)
  let m = mount([pad(0, true)]);
  step(); step(); assert.deepEqual(m.got, [], 'held: no');
  m.list.pads = [pad(0, false)]; step();
  m.list.pads = [pad(0, true)]; step();
  assert.deepEqual(m.got, ['pad'], 'let go and pressed again: yes');
  // Start, fresh
  m = mount([pad(1)]); step(); m.list.pads = [pad(1, false, true)]; step(); assert.deepEqual(m.got, ['pad']);
  // a pad the browser only reveals now, with the press that reveals it
  m = mount([]); step(); m.list.pads = [null, pad(1, true)]; step(); assert.deepEqual(m.got, ['pad'], 'a pad seen for the first time after it showed: its press is new');
  // other buttons do nothing
  m = mount([pad(0)]); step(); m.list.pads = [{ index: 0, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 1 || i === 3 })) }]; step();
  assert.deepEqual(m.got, []); m.dismiss();
  // no Gamepad API at all: fine
  const got = [];
  mountBrandIntro({ onEnter: h => got.push(h), pads: () => { throw new Error('no pads'); }, raf: f => { frames.push(f); return 1; }, caf: () => {} });
  step(); key('keydown', 'Enter'); assert.deepEqual(got, ['key']);
});

test('brandboot.js: the title screen first, then main.js; the launcher heartbeat while it is up, and lock-in on the entering click or key', () => {
  const boot = src('client/js/brandboot.js'), html = src('client/index.html');
  assert.ok(html.includes('<script type="module" src="js/brandboot.js"></script>') && !html.includes('src="js/main.js"></script>'), 'the page starts with brandboot.js');
  assert.ok(html.includes('<link rel="modulepreload" href="js/main.js">'), 'main.js loads while the title screen is up');
  assert.ok(html.includes('<link rel="stylesheet" href="css/brandintro.css">'));
  assert.match(boot, /import \{ mountBrandIntro \} from '\.\/ui\/brandintro\.js';/);
  assert.match(boot, /const query = new URLSearchParams\(location\.search\), launcher = query\.has\('launcher'\);/);
  assert.match(boot, /if \(!query\.has\('nointro'\)\) await new Promise\(resolve => mountBrandIntro\(\{/, '?nointro skips it (automated checks)');
  assert.match(boot, /fetch\('\/api\/ping', \{ cache: 'no-store' \}\)/);
  assert.match(boot, /const keepAlive = launcher \? setInterval\(ping, 5000\) : null;/);
  assert.match(boot, /if \(how !== 'pad' && settings\.lockIn && \(launcher \|\| window\.matchMedia\('\(display-mode: fullscreen\)'\)\.matches\) && !document\.fullscreenElement\) lockin\.enter\(\);\s*resolve\(\);/);
  assert.ok(boot.indexOf("await import('./main.js')") > boot.indexOf('await new Promise(resolve => mountBrandIntro('), 'main.js only after it is entered');
  assert.match(boot, /finally \{ if \(keepAlive !== null\) clearInterval\(keepAlive\); \}/, 'main.js takes the heartbeat over');
  assert.match(src('client/js/main.js'), /if \(LAUNCHER\) setInterval\(\(\) => \{ fetch\('\/api\/ping'/);
  // again from Settings → Title screen (in the menus): the game's input waits under it
  const scr = src('client/js/ui/screens.js');
  assert.ok(scr.includes("app.mode === 'menu' ? '<button class=\"btn ghost small\" data-title title=\"See the title screen again\">Title screen</button>' : ''"));
  assert.match(scr, /export function showTitle\(app\) \{\s*closeModal\(\);\s*if \(app\.input\) app\.input\.capturing = true;\s*mountBrandIntro\(\{ onEnter: \(\) => \{ if \(app\.input\) app\.input\.capturing = false; \} \}\);/);
  for (const f of ['client/brand/gravity-keyart.jpg', 'client/brand/rimrift-logo.svg', 'client/brand/rimrift-wordmark.svg']) assert.ok(fs.existsSync(new URL(f, root)), f);
});

// ---- the palette ----
const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lum = h => { const c = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the root tokens: Ember, Bone, Carbon; text on Ember is Carbon (it reads), gold kept as its own token', () => {
  const css = src('client/css/app.css'), rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const tok = n => (rootBlock.match(new RegExp(`--${n}: (#[0-9a-f]{6})`)) || [])[1];
  assert.equal(tok('accent'), '#ff4d24'); assert.equal(tok('accent2'), '#f3eee4'); assert.equal(tok('bg'), '#080a0d');
  assert.equal(tok('text'), '#f3eee4'); assert.equal(tok('on-accent'), '#080a0d'); assert.equal(tok('gold'), '#ffd84a');
  assert.ok(contrast(tok('on-accent'), tok('accent')) >= 4.5, 'Carbon on Ember');
  assert.ok(contrast(tok('accent'), tok('bg')) >= 4.5, 'Ember text on Carbon');
  assert.ok(contrast('#f3eee4', '#ff4d24') < 3, '(Bone on Ember would not: why the buttons keep dark text)');
  // every button, tab and chip on Ember has dark text
  const menus = src('client/css/menus.css');
  for (const sel of ['.tab.on', '.chip.on', '.btn.primary', '.tag.hot', '.icon-btn.on', '.ob-you', '.pr-tabs button.on', '.seg-n', '.bind.listening'])
    assert.match(menus, new RegExp(sel.replace(/[.()[\]]/g, '\\$&') + ' \\{[^}]*color: var\\(--on-accent\\)'), sel);
  const intro = src('client/css/brandintro.css');
  assert.ok(intro.includes('--rr-ember: #ff4d24; --rr-bone: #f3eee4; --rr-carbon: #080a0d;'));
});

test('the old yellow is gone from the UI except where it means gold (VC, the OVR tile, a C grade, MVP, jackpot, ICON)', () => {
  const css = src('client/css/app.css') + '\n' + src('client/css/menus.css');
  const left = css.split('\n').filter(l => /#ffd84a|255, *216, *74|#ffe27a/i.test(l));
  const kept = [/--gold: #ffd84a/, /^\.hud-grade \{/, /\.hud-grade\[data-tier="c"\] \{ --gc: #ffd84a; \}/, /^\.badge-pop\.icon \{/, /^\.ovr \{.*#ffe27a, #e6a923/, /^\.lg-final \{.*--gc: #ffd84a/, /^\.wheel-prize b\.jackpot/, /\.ob-mvp \{[^}]*#ffe27a/, /^\.legend-line \{/];
  for (const l of left) assert.ok(kept.some(r => r.test(l)), `still yellow: ${l.slice(0, 120)}`);
  assert.ok(left.length <= kept.length + 1, `${left.length} yellow lines left`);
  assert.match(src('client/css/menus.css'), /\.pill\.vc i \{[^}]*background: var\(--gold\)/, 'the VC chip stays gold');
  assert.match(src('client/css/menus.css'), /\.price \{[^}]*color: var\(--gold\)/, 'so do VC prices');
  // the UI's own yellow fallbacks are Ember now (team colours and the world's art keep theirs)
  for (const [f, s] of [['client/js/ui/screens.js', "AFFILIATIONS[char.affiliation].color : '#ff4d24'"], ['client/js/ui/rewards.js', "app.affColor || '#ff4d24'"], ['client/js/ui/outro.js', "teams[t]?.color || '#ff4d24'"], ['client/js/game/present.js', "team.color || '#ff4d24'"], ['client/js/game/showroom.js', "this.accent = M.hexLinear('#ff4d24');"]])
    assert.ok(src(f).includes(s), f);
});

// ---- the name ----
function walk(dir, out = []) {
  for (const e of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(p + '/', out); else if (/\.(js|css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');

test('no "Afterhours 16" left in anything the player sees (the save keys, the bug-report file and the exe keep their names)', () => {
  const files = [...walk('client/js/'), ...walk('client/css/'), 'client/index.html'];
  assert.ok(files.length > 60);
  for (const f of files) {
    const t = noComments(src(f));
    assert.ok(!/Afterhours 16|AFTERHOURS<b>16|AFTERHOURS ARENA|Afterhours16 folder/i.test(t) && !/AH16/.test(t), `${f}: the old name`); // (the 'ah16.' storage keys stay)
  }
  const html = src('client/index.html');
  assert.ok(html.includes('<title>RIMRIFT</title>') && html.includes('RIMRIFT — Make your own gravity.') && html.includes('RIMRIFT needs JavaScript and WebGL2.'));
  assert.ok(html.includes('<img class="boot-logo" src="brand/rimrift-logo.svg" alt="RIMRIFT"'), 'the boot screen logo');
  const scr = src('client/js/ui/screens.js');
  assert.ok(scr.includes('<img src="brand/rimrift-wordmark.svg" alt="RIMRIFT" width="1270" height="221"><small>v${esc(app.config.version)}</small>'), 'the top bar');
  assert.ok(scr.includes('<h1 class="logo-big"><img src="brand/rimrift-logo.svg" alt="RIMRIFT"'), 'the welcome card');
  assert.ok(scr.includes('Quit RIMRIFT?') && scr.includes('RIMRIFT has stopped.'));
  assert.ok(src('client/js/ui/modes.js').includes('PRO-AM · 5V5 · RIMRIFT ARENA'));
  assert.ok(src('client/js/core/music.js').includes("album: 'RIMRIFT Soundtrack'"));
  const bug = src('client/js/ui/bugreport.js');
  assert.ok(bug.includes('<b>Afterhours16_Bug_Reports.txt</b> in the game\'s folder (next to the launcher, Afterhours16.exe)'), 'the file and the exe keep their names');
  assert.ok(src('client/js/core/settings.js').includes("const KEY = 'afterhours16.settings.v3';"), 'settings are not lost');
});

test('the favicon and the home-screen icon', () => {
  const html = src('client/index.html');
  assert.ok(!html.includes('href="data:,"'));
  assert.ok(html.includes('<link rel="icon" href="brand/favicon.ico" sizes="any">'));
  assert.ok(html.includes('<link rel="icon" type="image/png" sizes="192x192" href="brand/icon-192.png">'));
  assert.ok(html.includes('<link rel="apple-touch-icon" sizes="180x180" href="brand/icon-180.png">'));
  assert.ok(html.includes('<meta name="theme-color" content="#080a0d">'));
  for (const f of ['favicon.ico', 'icon-192.png', 'icon-180.png']) assert.ok(fs.statSync(new URL('client/brand/' + f, root)).size > 500, f);
  assert.match(src('server/app.py'), /"\.ico": "image\/x-icon"/, 'the service serves .ico');
});
