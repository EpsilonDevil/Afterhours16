// v0.4.8.7 the chains (David: "The cosmetic chains in the shop are still bugged and do not look unique to each other").
// Every chain item is drawn as itself: its link (Cuban, rope, tennis, box), its metal, its stones, how thick and how long
// it is and its pendant, from its own catalog entry, the same on a player, in the store and on the AI. Before: the look
// was reduced to 'gold' or 'ice' by the item's id (sim/bots.js) and the textures were shared by those two words (view.js),
// so the Silver Rope Chain was the Gold Chain and the Rose Ice Chain was the Iced Out Chain; and on a sleeveless jersey
// most of every chain was hidden under the neckline's binding.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AthleteModel } from '../client/js/char/athlete.js';
import { resolveLook, chainSpec, makeBot } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { hexToRgb } from '../client/js/core/math.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(src('server/catalog.json'));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const CHAINS = list.filter(i => i.slot === 'chain').map(i => i.id);
const BUILD = { height: 78, weight: 210, wingspan: 82 };
const built = id => { const look = resolveLook({ ...BUILD, equipment: { chain: id } }, catalog), m = new AthleteModel(BUILD, look, 1); m.buildGear(look.gear); return { look, m, g: m.chainGeo }; };
// what view.js keys a chain's textures by (its link, metal and stones), and the pendant's
const texKey = c => ['chain:' + [c.link, c.metal || c.color, c.stone].join('|'), 'pendant:' + [c.pendant, c.metal || c.color, c.stone].join('|')];
const sig = g => { const P = g.chain.position; let y0 = 1e9, x1 = 0; for (let i = 0; i < P.length; i += 3) { y0 = Math.min(y0, P[i + 1]); x1 = Math.max(x1, Math.abs(P[i])); } return { n: P.length / 3, y0, x1, pn: g.pendant ? g.pendant.position.length / 3 : 0, pend: g.pendantKind, link: g.link }; };

test('every chain in the catalog is its own: different geometry and different textures from every other chain, by item id', () => {
  assert.ok(CHAINS.length >= 4, CHAINS.join());
  const all = CHAINS.map(id => ({ id, ...built(id) }));
  for (const a of all) {
    assert.equal(a.look.gear.chain.id, a.id, 'the look carries the item itself');
    assert.ok(a.g && a.g.chain.position.every(Number.isFinite));
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const A = all[i], Bb = all[j], sa = sig(A.g), sb = sig(Bb.g);
    const geoDiffers = sa.n !== sb.n || Math.abs(sa.y0 - sb.y0) > 0.005 || sa.pn !== sb.pn || sa.link !== sb.link;
    const [ca, pa] = texKey(A.look.gear.chain), [cb, pb] = texKey(Bb.look.gear.chain);
    assert.ok(geoDiffers, `${A.id} and ${Bb.id}: the same shape`);
    assert.notEqual(ca, cb, `${A.id} and ${Bb.id}: the same chain texture`);
    if (A.g.pendant && Bb.g.pendant) assert.notEqual(pa, pb, `${A.id} and ${Bb.id}: the same pendant`);
  }
  // four looks, not two
  assert.equal(new Set(all.map(a => a.g.link)).size, all.length, 'a link style each');
  assert.equal(new Set(all.map(a => a.look.gear.chain.metal)).size, all.length, 'a metal each');
});

test('each chain matches its name and description', () => {
  const c = id => built(id), lum = h => { const [r, g, b] = hexToRgb(h); return { r, g, b }; };
  const gold = c('chain_gold'), silver = c('chain_silver'), ice = c('wheel_chain_ice'), rose = c('wheel_chain_ice_rose');
  // the Gold Chain: a heavy yellow-gold Cuban with a medallion
  { const s = gold.look.gear.chain, m = lum(s.metal); assert.equal(s.link, 'cuban'); assert.ok(m.r > m.b + 0.3 && m.g > m.b, 'yellow gold'); assert.equal(gold.g.pendantKind, 'medallion'); assert.equal(s.stone, null); }
  // the Silver Rope Chain: sterling (no warm cast), a rope, the longest, no pendant
  { const s = silver.look.gear.chain, m = lum(s.metal); assert.equal(s.link, 'rope'); assert.ok(Math.abs(m.r - m.b) < 0.06, 'silver'); assert.equal(silver.g.pendant, null); assert.ok(sig(silver.g).y0 < Math.min(sig(gold.g).y0, sig(ice.g).y0, sig(rose.g).y0), 'worn longest'); }
  // the Iced Out Chain: a tennis chain of clear stones, an iced disc, the biggest pendant
  { const s = ice.look.gear.chain; assert.equal(s.link, 'tennis'); assert.equal(s.stone, '#ffffff'); assert.equal(ice.g.pendantKind, 'iced'); assert.ok(sig(ice.g).pn > 0); }
  // the Rose Ice Chain: rose gold, pink stones, a box chain, short, a heart
  { const s = rose.look.gear.chain, m = lum(s.metal), st = lum(s.stone); assert.equal(s.link, 'box'); assert.ok(m.r > m.g && m.g > m.b * 0.9 && m.r - m.b > 0.2, 'rose gold'); assert.ok(st.r > st.g, 'pink stones'); assert.equal(rose.g.pendantKind, 'heart'); assert.ok(sig(rose.g).y0 > Math.max(sig(gold.g).y0, sig(ice.g).y0, sig(silver.g).y0), 'worn shortest'); }
  // their thickness: the Cuban the heaviest, the box the finest
  assert.ok(gold.look.gear.chain.thick > ice.look.gear.chain.thick && ice.look.gear.chain.thick > silver.look.gear.chain.thick && silver.look.gear.chain.thick > rose.look.gear.chain.thick);
  for (const id of CHAINS) assert.ok(catalog[id].description.length > 60, `${id} says what it looks like`);
  // a chain added later without the style fields still gets a look of its own (from its id and colour), not gold or ice
  const later = chainSpec({ id: 'chain_onyx_box', color: '#222428' });
  assert.equal(later.link, 'box'); assert.equal(later.metal, '#222428');
  for (const id of CHAINS) assert.notEqual(texKey(later)[0], texKey(built(id).look.gear.chain)[0]);
});

test('the store tries on the item\'s own chain, close up; the AI wear theirs; the textures and the medallion', async () => {
  const seen = [];
  // (store.js's imports touch the page when they load: a bare stand-in for it)
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, setAttribute() {} });
  globalThis.document = globalThis.document || { documentElement: el(), body: el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: el, getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, matchMedia: () => ({ matches: false }), location: { search: '' } };
  globalThis.location = globalThis.location || { search: '' };
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
  const { tryOn } = await import('../client/js/ui/store.js');
  const c = { ...BUILD, name: 'Shop Guy', equipment: { top: 'yard_teal', bottom: 'yard_shorts', chain: 'chain_gold' }, attributes: {}, overall: 60, rep: { level: 0 } };
  const app = { catalog, look: (ch, o = {}) => resolveLook(ch, catalog, o), showroom: { setCharacter: (b, look) => seen.push({ b, look }), setFocus: f => seen.push({ focus: f }), setPreview: () => {} } };
  for (const id of CHAINS) {
    seen.length = 0;
    tryOn(app, c, catalog[id], 'accessory');
    const put = seen.find(s => s.look);
    assert.equal(put.look.gear.chain.id, id, `the store's preview of ${id} wears ${put.look.gear.chain.id}`);
    assert.equal(seen.find(s => s.focus).focus, 'upper', 'close enough to see it');
  }
  // the AI: a bot in a chain wears that chain's own look
  let n = 0;
  for (let s = 0; s < 400 && n < 6; s++) {
    const b = makeBot(new RNG(s), { catalog, level: 0.95 });
    const id = b.build.equipment?.chain; if (!id) continue;
    n++; assert.equal(resolveLook(b.build, catalog).gear.chain.id, id);
  }
  assert.ok(n > 0, 'some bots wear chains');
  // the textures are keyed by the look, not by 'gold' / 'ice'; the medallion says RR (it said 16, the old name's);
  // and the chain is drawn over a jersey's binding (that binding sits 1.8 cm toward the camera)
  const v = src('client/js/char/view.js'), l = src('client/js/char/looks.js');
  assert.ok(!v.includes("'chain:' + kind") && v.includes("'chain:' + [cs.link || geo.chain.link, cs.metal || cs.color, cs.stone].join('|')"));
  assert.ok(/layer: 5, viewBias: 0\.035/.test(v) && v.includes('viewBias: 0.018'));
  assert.ok(l.includes("g.fillText('RR'") && !l.includes("g.fillText('16'"));
  for (const k of ["link === 'rope'", "link === 'tennis'", "link === 'box'"]) assert.ok(l.includes(k), k);
});
