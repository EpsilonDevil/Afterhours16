// v0.4.8.6, the RIMRIFT identity patch: the game is RIMRIFT now (MAKE YOUR OWN GRAVITY.). The brand kit's master logo is
// traced into vector paths in two flat fills, Ember #FF4D24 and Bone #F3EEE4 (client/brand/rimrift-logo.svg, -mark.svg,
// -wordmark.svg, -mark-small.svg), with icons, the key art and a logo PNG beside them; and the world wears the name:
// the arena's sidelines and centre-court mark, its LED ribbon and scorer's table, the jumbotron, the Pro Run's league,
// the store's branded gear, the soundtrack's album and the router's port-mapping description. Item ids never change.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THEMES } from '../client/js/world/themes.js';
import { LEAGUE } from '../client/js/sim/league.js';
import { drawLogo, drawRimriftLogo } from '../client/js/gfx/textures.js';
import { RIMRIFT_MARK, BRAND } from '../client/js/gfx/brandmark.js';

const root = new URL('../', import.meta.url);
const src = f => fs.readFileSync(new URL(f, root), 'utf8');
const bin = f => fs.readFileSync(new URL(f, root));
const COLORS = ['#FF4D24', '#F3EEE4'];

// the points a path passes through (M, L, C, Z only: what the tracer writes): every line end, and each cubic sampled
function pathPoints(d) {
  const toks = d.match(/[MLCZ]|-?\d*\.?\d+/g), out = [];
  let cmd = null, nums = [], cur = [0, 0];
  const flush = () => {
    if (cmd === 'C') for (let i = 0; i + 5 < nums.length; i += 6) {
      const [a, b, c] = [[nums[i], nums[i + 1]], [nums[i + 2], nums[i + 3]], [nums[i + 4], nums[i + 5]]];
      for (let k = 1; k <= 16; k++) { const t = k / 16, u = 1 - t; out.push([u * u * u * cur[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0], u * u * u * cur[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1]]); }
      cur = c;
    } else for (let i = 0; i + 1 < nums.length; i += 2) { cur = [nums[i], nums[i + 1]]; out.push(cur); }
    nums = [];
  };
  for (const t of toks) {
    if (/[MLCZ]/.test(t)) { flush(); cmd = t; } else nums.push(+t);
  }
  flush();
  return out;
}
function readSvg(f) {
  // a copy saved to the PC can carry a content-credentials (C2PA) manifest, added on save in a <metadata> block: that's
  // provenance, not drawing, so it's left out of the checks
  const t = src(f).replace(/ xmlns:c2pa="[^"]*"/, '').replace(/<metadata>[\s\S]*?<\/metadata>/, '');
  assert.match(t, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) (\d+)" width="\1" height="\2"/, f);
  const [, W, H] = t.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
  const tags = [...t.matchAll(/<\/?([a-zA-Z]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(tags)].sort(), ['path', 'svg', 'title'], `${f}: only paths (no raster, no styles)`);
  assert.ok(!/data:|<image|href=/.test(t), `${f}: no raster inside`);
  assert.equal((t.match(/<svg/g) || []).length, (t.match(/<\/svg>/g) || []).length);
  const paths = [...t.matchAll(/<path fill="(#[0-9A-F]{6})" fill-rule="evenodd" d="([MLCZ0-9 .\-]+)"\/>/g)].map(m => ({ fill: m[1], d: m[2] }));
  assert.equal(paths.length, (t.match(/<path/g) || []).length, `${f}: every path well formed`);
  return { W, H, paths, text: t };
}

test('the vector logo: three SVGs (and a small-size mark), two flat brand fills, tight viewBoxes, few nodes', () => {
  const want = { 'client/brand/rimrift-logo.svg': [2, 'RIMRIFT'], 'client/brand/rimrift-mark.svg': [2, 'RIMRIFT mark'], 'client/brand/rimrift-wordmark.svg': [2, 'RIMRIFT'], 'client/brand/rimrift-mark-small.svg': [2, 'RIMRIFT'] };
  const sizes = {};
  for (const [f, [n, title]] of Object.entries(want)) {
    const s = readSvg(f);
    assert.equal(s.paths.length, n, f);
    assert.deepEqual(s.paths.map(p => p.fill).sort(), [...COLORS].sort(), `${f}: Ember and Bone, nothing else`);
    assert.ok(s.text.includes(`<title>${title}</title>`));
    // tight: the drawn outline reaches within 3 units of every edge, and nothing runs outside
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.paths) for (const [x, y] of pathPoints(p.d)) {
      assert.ok(x >= -0.5 && y >= -0.5 && x <= s.W + 0.5 && y <= s.H + 0.5, `${f}: ${x},${y} outside 0 0 ${s.W} ${s.H}`);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    assert.ok(x0 <= 3 && y0 <= 3 && s.W - x1 <= 3 && s.H - y1 <= 3, `${f}: ${[x0, y0, s.W - x1, s.H - y1].map(v => v.toFixed(1))}`);
    const nodes = s.paths.reduce((n, p) => n + (p.d.match(/[MLC]/g) || []).length, 0);
    assert.ok(nodes < 400, `${f}: ${nodes} nodes`);
    assert.ok(s.text.length < 8000);
    sizes[f] = [s.W, s.H];
  }
  // the lockup is the mark over the wordmark; the small mark is the mark without its rim
  const [lw, lh] = sizes['client/brand/rimrift-logo.svg'], [mw, mh] = sizes['client/brand/rimrift-mark.svg'], [ww, wh] = sizes['client/brand/rimrift-wordmark.svg'];
  assert.ok(ww === lw && mw < lw && mh + wh <= lh + 4 && mh + wh > lh * 0.9);
  assert.ok(sizes['client/brand/rimrift-mark-small.svg'][0] < mw);
  // the textures' copy of the mark is the SVG's
  const mark = readSvg('client/brand/rimrift-mark.svg');
  assert.deepEqual([RIMRIFT_MARK.w, RIMRIFT_MARK.h], [mark.W, mark.H]);
  assert.equal(RIMRIFT_MARK.ember, mark.paths.find(p => p.fill === '#FF4D24').d);
  assert.equal(RIMRIFT_MARK.bone, mark.paths.find(p => p.fill === '#F3EEE4').d);
  assert.deepEqual(BRAND, { ember: '#FF4D24', bone: '#F3EEE4', carbon: '#080A0D' });
});

test('icons, the key art and the logo PNG: the right sizes', () => {
  const png = f => { const b = bin(f); assert.equal(b.toString('latin1', 1, 4), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20), b.length]; };
  for (const s of [180, 192, 512]) { const [w, h, n] = png(`client/brand/icon-${s}.png`); assert.deepEqual([w, h], [s, s]); assert.ok(n < 80000); }
  const [lw, lh, ln] = png('client/brand/rimrift-logo.png');
  assert.ok(lw > 1000 && lh > 600 && ln < 150000, `logo ${lw}x${lh} ${ln} B`);
  // favicon.ico: 16, 32 and 48
  const ico = bin('client/brand/favicon.ico');
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1]);
  const n = ico.readUInt16LE(4), dims = [];
  for (let i = 0; i < n; i++) dims.push(ico[6 + i * 16] || 256);
  assert.deepEqual(dims.sort((a, b) => a - b), [16, 32, 48]);
  // the key art: 1920 x 1080, 300-500 KB (its GENERATED CONCEPT ART corner label is kept: it's the kit's art, resized)
  const jpg = bin('client/brand/gravity-keyart.jpg');
  assert.deepEqual([jpg[0], jpg[1]], [0xff, 0xd8]);
  let i = 2, dim = null;
  while (i < jpg.length) { const m = jpg[i + 1], len = jpg.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) { dim = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)]; break; } i += 2 + len; }
  assert.deepEqual(dim, [1920, 1080]);
  assert.ok(jpg.length > 300000 && jpg.length < 500000, `${jpg.length} B`);
  // the server serves every one of them
  const app = src('server/app.py');
  for (const ext of ['.svg', '.png', '.jpg', '.ico']) assert.ok(app.includes(`"${ext}":`), ext);
});

test('the arena wears it: RIMRIFT down the sidelines, the mark at centre court, the ribbon and the table in Ember on Carbon', () => {
  const c = THEMES.arena.court;
  assert.equal(THEMES.arena.name, 'RIMRIFT Arena');
  assert.equal(c.sideText, 'RIMRIFT'); assert.equal(c.sideTextColor, '#FF4D24');
  assert.deepEqual(c.logo, { shape: 'rimrift', color: '#080A0D', accent: '#FF4D24', ink: '#F3EEE4', size: 1.55, rotate: Math.PI / 2 }); // (upright from the broadcast sideline)
  // the mark is painted from its own paths where there's a Path2D (browsers), even-odd, Ember then Bone
  const calls = [];
  const g = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])), set: (o, k, v) => { calls.push(['set', k, v]); return true; } });
  const was = globalThis.Path2D;
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  try { drawLogo(g, c.logo, 0, 0, c.logo.size); } finally { globalThis.Path2D = was; }
  const fills = calls.filter(x => x[0] === 'fill' && x[1]?.d);
  assert.deepEqual(fills.map(x => [x[1].d, x[2]]), [[RIMRIFT_MARK.ember, 'evenodd'], [RIMRIFT_MARK.bone, 'evenodd']]);
  const styles = calls.filter(x => x[0] === 'set' && x[1] === 'fillStyle').map(x => x[2]);
  assert.deepEqual(styles, ['#080A0D', '#FF4D24', '#F3EEE4']);
  // without one (Node, a stand-in context): RR in Bone with an Ember slash, and nothing throws
  calls.length = 0;
  drawRimriftLogo(g, c.logo, 1.55);
  assert.ok(calls.some(x => x[0] === 'fillText' && x[1] === 'RR'));
  // a team's colours still take the floor over the brand's
  const v = src('client/js/world/venues.js');
  assert.ok(v.includes("(team.abbr || 'RR').slice(0, 4)") && v.includes("spec.sideText = (team.name || 'RIMRIFT').toUpperCase(); spec.sideTextColor = undefined;"));
  assert.ok(v.includes("team.name || 'RIMRIFT PRO-AM'") && v.includes("(team.abbr || 'RR').toUpperCase()") && v.includes("color: team.primary ? '#ffffff' : '#FF4D24'"));
  assert.ok(v.includes("?.toUpperCase() || 'RIMRIFT', { seed:"), 'the mural fallback');
  assert.ok(src('client/js/game/session.js').includes("(t[0].name ? 'PRO-AM' : 'RIMRIFT')"), 'the jumbotron');
  for (const f of ['client/js/world/venues.js', 'client/js/world/themes.js', 'client/js/game/session.js', 'client/js/sim/league.js', 'client/js/gfx/textures.js']) {
    assert.ok(!/AFTERHOURS|AH16|'AH'/.test(src(f).replace(/\/\/.*$/gm, '')), `${f}: no old name left in the code`);
  }
});

test('the league, the store, the soundtrack: renamed, and every item id the same', () => {
  assert.deepEqual(LEAGUE, { name: 'RIMRIFT Pro League', abbr: 'RPL' });
  const list = JSON.parse(src('server/catalog.json')), byId = Object.fromEntries(list.map(i => [i.id, i]));
  assert.equal(list.length, new Set(list.map(i => i.id)).size);
  const want = {
    jersey_coral: ['RIMRIFT Coral Jersey', 'YARD'], jersey_ink: ['RIMRIFT Away Jersey', 'R/R'], hoodie_ink: ['RIMRIFT Pullover', 'R/R'],
    tee_graphic_ah: ['RIMRIFT Graphic Tee', 'RIMRIFT'], tee_black_ah16: ['RIMRIFT Night Tee', 'RIMRIFT'], jersey_royal: ['Royal Night Jersey', 'RIMRIFT'],
    hoodie_cobalt: ['Cobalt Fleece Hoodie', 'RIMRIFT'], hoodie_heather: ['Grey Heather Hoodie', 'RR'], tee_white: ['Baseline Cotton Tee', 'R/R'],
    tee_charcoal: ['Night Run Tee', 'R/R'], hoodie_sand: ['Sandstone Pullover', 'R/R'], tee_peach: ['Peach Fuzz Tee', 'R/R'], hoodie_cream: ['Oat Milk Hoodie', 'R/R'],
  };
  for (const [id, [name, lettering]] of Object.entries(want)) {
    assert.ok(byId[id], `${id} is still there (players own it by id)`);
    assert.deepEqual([byId[id].name, byId[id].lettering], [name, lettering], id);
  }
  assert.ok(!/Afterhours|AFTERHOURS|AH16|A\/H/.test(JSON.stringify(list)), 'no old name in the catalog');
  // the lettering still fits: the painters (char/looks.js paintTop) size it by length; nothing is wider than what the old
  // 'AFTERHOURS' took at its smaller size (chars x font size)
  const looks = src('client/js/char/looks.js');
  assert.ok(looks.includes('(spec.lettering.length > 7 ? 30 : 38) * S') && looks.includes('(spec.lettering.length > 8 ? 26 : 34) * S'));
  const width = (txt, fam) => txt.length * (fam === 'jersey' ? (txt.length > 7 ? 30 : 38) : (txt.length > 8 ? 26 : 34));
  for (const id of Object.keys(want)) assert.ok(width(byId[id].lettering, byId[id].family) <= width('AFTERHOURS', byId[id].family), id);
  // the soundtrack's album
  const tracks = JSON.parse(src('client/audio/music/tracks.json')).tracks;
  assert.ok(tracks.length > 20 && tracks.every(t => t.album === 'RIMRIFT Soundtrack'));
  // the router's port-mapping description (tests/test_upnp.py opens one)
  assert.ok(src('server/upnp.py').includes('description="RIMRIFT"'));
});
