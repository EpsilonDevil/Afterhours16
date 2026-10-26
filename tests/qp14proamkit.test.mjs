// v0.4.8.9 qp14: Pro-Am jerseys and logos are what their names say, in the game and in the menus.
//  * The Jerseys pick (Classic, Stripe, Split, Fade) is worn: every Pro-Am game and the HUB's home-court runs dress the
//    team in its kit (world/proamkit.js paKit, painted by char/looks.js); it used to be saved and never shown.
//  * Every logo is drawn: the flame, wolf, eagle, skull and wave used to be a plain roundel in the HUB and a rectangle on
//    a Pro-Am park's court; the bolt sits in a roundel now, where the letters no longer hide it.
//  * The menus show the real logo and a preview of the kit; the create form's logo and jersey picks take (they didn't).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let put = null;
const calls = [];
const fake2d = new Proxy({}, { get: (o, k) => (k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : k === 'putImageData' ? img => { put = img; } : k === 'measureText' ? t => ({ width: String(t).length * 10 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => { calls.push(k); }), set: () => true });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fake2d; } };
const K = await import('../client/js/world/proamkit.js');
const L = await import('../client/js/char/looks.js');
const T = await import('../client/js/gfx/textures.js');
const W = await import('../client/js/world/proamhubs.js');
const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const near = (px, h, tol = 40) => hex(h).every((v, i) => Math.abs(px[i] - v) <= tol);
const B = { primary: '#1f4fbf', secondary: '#f2c14e', abbr: 'NS' };

test('the four jerseys are the server\'s four, and Classic is exactly the uniform Pro-Am wore before', () => {
  assert.deepEqual(K.JERSEYS.map(j => j[0]), ['classic', 'stripe', 'split', 'gradient']);
  assert.match(src('server/proam.py'), /if j not in \("classic", "stripe", "split", "gradient"\)/);
  assert.deepEqual(K.JERSEYS.map(j => j[1]), ['Classic', 'Stripe', 'Split', 'Fade']);
  const old = { top: { family: 'jersey', color: B.primary, trim: B.secondary, secondary: B.secondary, pattern: 'panel', lettering: 'NS', tucked: true }, bottom: { family: 'shorts', color: B.primary, trim: B.secondary, stripe: B.secondary }, number: 7 };
  assert.deepEqual(K.paKit({ ...B, jersey: 'classic' }, 7), old);
  assert.deepEqual(K.paKit({ ...B }, 7), old, 'no pick (an AI team, an old team): Classic');
  assert.deepEqual(K.paKit({ ...B, jersey: 'zebra' }, 7), old);
  assert.equal(K.paKit({ ...B, jersey: 'stripe' }).top.pattern, 'pa_stripe');
  assert.equal(K.paKit({ ...B, jersey: 'split' }).bottom.pattern, 'pa_split');
  assert.equal(K.paKit({ ...B, jersey: 'gradient' }).top.pattern, 'pa_fade');
});

test('the Split\'s letters read on both halves: an ink for both colors, edged in the other', () => {
  const k = K.paKit({ ...B, jersey: 'split' }, 23).top;
  assert.ok(Math.min(K.contrast(k.numInk, B.primary), K.contrast(k.numInk, B.secondary)) >= 2.4);
  assert.notEqual(k.numEdge, k.numInk);
  assert.equal(K.bothInk('#c8322f', '#ffffff'), '#111317');
});

const W2 = 128; // (a small paint: res 128)
const paint = (fn, spec) => { put = null; fn({ ...spec, res: W2 }); return (u, f) => { const x = Math.floor(u * W2), y = Math.floor(f * W2); const i = (y * W2 + x) * 4; return [put.data[i], put.data[i + 1], put.data[i + 2]]; }; };
const TH = 0.75; // (the jersey body is the top 384 of 512 rows)

test('the jersey textures: Stripe\'s band under the number, Split\'s left side, Fade\'s melt to the hem', () => {
  const st = paint(L.paintTop, { ...K.paKit({ ...B, jersey: 'stripe' }, 23).top, hem: 0.47, neckTop: 0.86 });
  assert.ok(near(st(0.1, 0.65 * TH), B.secondary), 'in the band');
  assert.ok(near(st(0.1, 0.45 * TH), B.primary), 'above it, round the number');
  const sp = paint(L.paintTop, { ...K.paKit({ ...B, jersey: 'split' }, 23).top, hem: 0.47, neckTop: 0.86 });
  assert.ok(near(sp(0.4, 0.5 * TH), B.secondary) && near(sp(0.6, 0.5 * TH), B.secondary), 'the left side, front and back');
  assert.ok(near(sp(0.1, 0.5 * TH), B.primary) && near(sp(0.9, 0.5 * TH), B.primary), 'the right side');
  const fd = paint(L.paintTop, { ...K.paKit({ ...B, jersey: 'gradient' }, 23).top, hem: 0.47, neckTop: 0.86 });
  assert.ok(near(fd(0.1, 0.2 * TH), B.primary), 'the shoulders: the team color');
  assert.ok(near(fd(0.1, 0.94 * TH), B.secondary, 60), 'the hem: the second color');
  const cl = paint(L.paintTop, { ...K.paKit({ ...B, jersey: 'classic' }, 23).top, hem: 0.47, neckTop: 0.86 });
  assert.ok(near(cl(0.5, 0.5 * TH), B.secondary) && near(cl(0.25, 0.5 * TH), B.primary), 'Classic: side panels');
});

test('the shorts match: Split\'s left leg, Stripe\'s leg bands, Fade\'s legs', () => {
  const sp = paint(L.paintShorts, K.paKit({ ...B, jersey: 'split' }).bottom);
  assert.ok(near(sp(0.75, 0.7), B.secondary) && near(sp(0.25, 0.7), B.primary), 'left leg / right leg');
  assert.ok(near(sp(0.4, 0.3), B.secondary) && near(sp(0.1, 0.3), B.primary), 'the waist split the same way');
  const st = paint(L.paintShorts, K.paKit({ ...B, jersey: 'stripe' }).bottom);
  assert.ok(near(st(0.3, 0.885), B.secondary) && near(st(0.3, 0.7), B.primary));
  const fd = paint(L.paintShorts, K.paKit({ ...B, jersey: 'gradient' }).bottom);
  assert.ok(near(fd(0.3, 0.52), B.primary) && near(fd(0.3, 0.94), B.secondary, 60));
});

test('every logo the server offers has its own drawing (none falls back to a box or a plain roundel)', () => {
  const LOGOS = src('server/proam.py').match(/^LOGOS = \(([^)]*)\)/m)[1].match(/"(\w+)"/g).map(s => s.slice(1, -1));
  assert.deepEqual(LOGOS, W.HUB_LOGOS);
  for (const l of LOGOS) {
    assert.equal(W.logoShape(l), l, l);
    calls.length = 0;
    T.drawLogo(fake2d, { shape: l, color: B.primary, accent: B.secondary, text: 'NS' }, 0, 0, 50);
    assert.ok(!calls.includes('rect'), `${l}: not the fallback box`);
    if (T.EMBLEM_SHAPES.includes(l)) assert.ok(calls.filter(c => c === 'lineTo' || c === 'bezierCurveTo').length >= 5, `${l}: a picture`);
  }
  assert.deepEqual(T.EMBLEM_SHAPES.sort(), ['bolt', 'eagle', 'flame', 'skull', 'wave', 'wolf']);
});

test('the game dresses Pro-Am teams in their kit; the HUB\'s runs too, in the team\'s own colors', () => {
  const modes = src('client/js/ui/modes.js');
  assert.match(modes, /const PA_UNIFORM = \(b, n\) => paKit\(b, n\);/);
  assert.match(modes, /jersey: kitKey\(t\?\.jersey\) \}\);/);
  const hub = src('client/js/game/proamhub.js');
  assert.match(hub, /const teamKit = \(team, number\) => \{ const b = hubLook\(\{ \.\.\.\(team \|\| \{\}\), custom: null \}\); return paKit\(\{ \.\.\.b, jersey: team\?\.jersey \}, number\); \};/);
  assert.equal((hub.match(/teamKit\(this\.team/g) || []).length, 2);
});

test('the menus: the real logo, a kit preview, logo pickers that show each logo; Honey gloss shines', () => {
  const ui = src('client/js/ui/proam.js');
  assert.match(ui, /const logoTag = t => \{ const u = logoURL\(t, 96\);/);
  assert.match(ui, /data-preview><img data-prev-logo alt=""><canvas data-prev-kit/);
  assert.match(ui, /if \(create\) bindPicks\(root\);/);
  assert.match(ui, /Clubhouse logo \(its court, logo wall, banners and rug\)/);
  const look = f => ({ ...W.hubLook({ name: 'X', abbr: 'X', primary: '#123456', secondary: '#abcdef', custom: { floor: f } }) });
  assert.ok(W.hubCourtSpec('gold', look('honey')).gloss < W.hubCourtSpec('gold', look('natural')).gloss);
  assert.ok(W.hubCourtSpec('gold', look('honey')).reflectStrength > W.hubCourtSpec('gold', look('natural')).reflectStrength);
  // the flat preview draws without a page (a stand-in context)
  for (const [k] of K.JERSEYS) K.drawKit(fake2d, 150, 195, { ...B, jersey: k }, 23);
});
