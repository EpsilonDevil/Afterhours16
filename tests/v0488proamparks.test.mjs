// v0.4.8.8 The Pro-Am Overhaul, the World agent's part (docs/PROAM-OVERHAUL.md §6-§8): the twelve Pro-Am parks
// (world/proamparks.js), the Pro-Am HUB building on every park's plaza, and the Platinum record over a player's head.
// Every park builds headless with one regulation full court in the home team's colours, inside the triangle and light
// budgets, the same look from the same seed (and nothing from outside it), a clubhouse beside the court with a door you
// can walk out of, nothing standing in the game cameras' way; the HUB's door gives its prompt and opens the hub.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROAM_PARKS, PROAM_IDS, PROAM_THEMES, proamLook, proamLighting, buildProamPark, homeCourtSpec, proamInfo } from '../client/js/world/proamparks.js';
import { THEMES, PARK_PROAM, PARK_HQ, PARK_HALL, PARK_COURTS, plazaLampOff } from '../client/js/world/themes.js';
import * as PR from '../client/js/world/props.js';
import { camClear, onSomething } from '../client/js/world/harbor.js';
import { COURT } from '../client/js/sim/constants.js';
import { recordText, tierIndex, tagTier, RecordTags, PROAM_TIERS } from '../client/js/game/recordtag.js';
import { ParkHub } from '../client/js/game/park.js';

const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x) * (h || y) * 4 || 4) }) : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
const fakeScene = () => { const meshes = []; return { meshes, lights: [], add(m) { meshes.push(m); return m; }, remove(m) { const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); } }; };
let texN = 0;
const ctx = { geometry: g => ({ ...g, count: g.index ? g.index.length : g.position.length / 3, bounds: { center: [0, 0, 0], radius: 1 } }), texture: () => ({ id: ++texN }), disposeTexture() {}, updateTexture() {}, updateAttribute() {}, setInstances(g, d, n) { g.instances = n; g.idata = d; } };
const HOME = { name: 'Night Owls', abbr: 'OWL', primary: '#5a2f8a', secondary: '#f2c14e', logo: 'shield' };
const build = (id, seed = 777, home = HOME) => { const scene = fakeScene(); const v = buildProamPark({ ctx }, scene, id, { seed, home }); return { scene, v }; };
const tris = scene => scene.meshes.reduce((a, m) => a + (m.geo.count / 3) * (m.geo.instances || 1), 0);
const finite = (...v) => v.every(Number.isFinite);
const W2 = COURT.width / 2, L2 = COURT.length / 2;
const inBox = (x, z, s, m = 0) => x > s.x0 - m && x < s.x1 + m && z > s.z0 - m && z < s.z1 + m;
const built = Object.fromEntries(PROAM_IDS.map(id => [id, build(id)]));

test('the twelve parks of §7, each a theme proam_<id> (kind proam) on the client and a venue on the server', () => {
  assert.equal(PROAM_IDS.length, 12);
  assert.deepEqual(PROAM_PARKS.map(p => p.name), ['Under the Overpass', 'Long Beach', 'AAU Gym', 'Rooftop', 'Projects', 'Riverside', 'Old Warehouse', 'Schoolyard', 'The Cage', 'Suburban Rec Center', 'Desert Dusk', 'Night Market']);
  assert.deepEqual(PROAM_PARKS.filter(p => p.indoor).map(p => p.id), ['aau', 'warehouse', 'rec']);
  const venues = JSON.parse(fs.readFileSync(new URL('../server/venues.json', import.meta.url)));
  for (const p of PROAM_PARKS) {
    const t = THEMES['proam_' + p.id];
    assert.ok(t && t.kind === 'proam' && t.proam === p.id && t.name === p.name, p.id);
    const v = venues.find(x => x.id === 'proam_' + p.id);
    assert.ok(v && v.kind === 'proam' && v.name === p.name && v.affiliation === null && !v.event, `venues.json proam_${p.id}`);
  }
  assert.equal(PROAM_THEMES.length, 12);
  // (the other venues are where they were)
  for (const id of ['harbor', 'brick', 'foundry', 'kingtut', 'jungle', 'beat', 'monster', 'favela', 'arena', 'gym']) assert.ok(venues.some(v => v.id === id), id);
});

test('venues.js builds a Pro-Am park through buildVenue', () => {
  const src = fs.readFileSync(new URL('../client/js/world/venues.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ buildProamPark \} from '\.\/proamparks\.js'/);
  assert.match(src, /if \(theme\.kind === 'proam'\) return buildProamPark\(r, scene, theme\.proam, opts\)/);
});

test('every park builds headless: one regulation full court with two hoops, in budget (triangles, lights), the home team on it', () => {
  for (const id of PROAM_IDS) {
    const { scene, v } = built[id];
    assert.equal(v.courts.length, 1, id);
    const c = v.courts[0];
    assert.ok(c.full && c.format === 5 && c.origin.every(n => n === 0), `${id} full court at the origin`);
    assert.equal(v.hoops.length, 2, `${id} two hoops`);
    assert.ok(c.floor, `${id} court floor`);
    const n = tris(scene);
    assert.ok(n > 8000 && n < 120000, `${id}: ${Math.round(n)} triangles`);
    assert.ok(scene.lights.length <= 8, `${id}: ${scene.lights.length} lights`);
    assert.ok(scene.meshes.length < 90, `${id}: ${scene.meshes.length} draw calls`);
    assert.ok(v.banners.length >= 3, `${id}: the home team's banners`);
    assert.equal(v.home.name, 'Night Owls');
    for (const m of scene.meshes) assert.ok(m.geo.count > 0 && [...m.matrix].every(Number.isFinite), `${id}: a mesh with nothing in it or a bad matrix`);
    for (const l of scene.lights) assert.ok(finite(...l.pos, l.range, l.intensity), `${id}: light`);
  }
  // (the court spec: the home team's paint, logo and name)
  const spec = homeCourtSpec(proamInfo('cage'), HOME);
  assert.equal(spec.paint, HOME.primary); assert.equal(spec.logo.text, 'OWL'); assert.equal(spec.logo.shape, 'shield'); assert.equal(spec.baselineText, 'NIGHT OWLS');
});

test('the look comes from the park and the game seed only: the same seed, the same look and the same park; seeds vary it', () => {
  for (const id of PROAM_IDS) {
    assert.deepEqual(proamLook(id, 4242), proamLook(id, 4242), id);
    const a = build(id, 31337), b = build(id, 31337);
    assert.deepEqual(a.v.look, b.v.look, id);
    assert.equal(a.scene.meshes.length, b.scene.meshes.length, id);
    assert.equal(tris(a.scene), tris(b.scene), id);
    assert.deepEqual(a.scene.lights, b.scene.lights, id);
    const ca = a.scene.meshes.find(m => m.geo.idata), cb = b.scene.meshes.find(m => m.geo.idata);
    assert.ok(ca && cb, `${id}: a crowd`);
    assert.deepEqual([...ca.geo.idata], [...cb.geo.idata], `${id}: the same crowd`);
    const looks = Array.from({ length: 60 }, (_, s) => proamLook(id, s * 7919 + 1));
    const P = proamInfo(id);
    assert.ok(new Set(looks.map(l => l.tod)).size >= Math.min(2, new Set(P.tods).size), `${id}: times of day`);
    assert.ok(looks.every(l => P.tods.includes(l.tod)), `${id}: its own times of day`);
    assert.ok(new Set(looks.map(l => l.crowd)).size > 10 && looks.every(l => l.crowd >= 0.35 && l.crowd <= 1), `${id}: crowds`);
    if (P.indoor) assert.ok(looks.every(l => l.weather === 'indoor'), `${id} indoor`);
    else assert.ok(new Set(looks.map(l => l.weather)).size >= 3, `${id}: weathers`);
    for (const l of looks.slice(0, 6)) { const L = proamLighting(id, l); assert.ok(L.sky && L.sun && L.fog && finite(L.exposure), id); }
  }
  assert.ok(Array.from({ length: 200 }, (_, s) => proamLook('desert', s)).every(l => l.weather !== 'rain'), 'no rain in the desert');
  assert.ok(Array.from({ length: 200 }, (_, s) => proamLook('market', s)).every(l => l.tod !== 'day'), 'the night market is never by day');
  // (nothing random from outside the seed: no clock, no Math.random in the parks)
  const src = fs.readFileSync(new URL('../client/js/world/proamparks.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/Math\.random|Date\.now|performance\.now|new Date/.test(src), 'proamparks.js draws everything from the seed');
});

test('each park has its own clubhouse beside the court: a door to walk out of (in bounds, clear of everything) and its interior', () => {
  const styles = new Set();
  for (const id of PROAM_IDS) {
    const { v } = built[id], ch = v.clubhouse, d = ch.door, a = ch.anchor, b = v.bounds;
    assert.ok(finite(d.x, d.z, d.yaw) && finite(a.x, a.y, a.z, a.yaw, a.w, a.d), id);
    assert.ok(typeof ch.style === 'string' && ch.style, id); styles.add(ch.style);
    assert.ok(inBox(d.x, d.z, b), `${id}: the door's spot inside the bounds`);
    for (const s of v.solids) assert.ok(!inBox(d.x, d.z, s, 0.3), `${id}: the door's spot is clear of ${JSON.stringify(s)}`);
    assert.ok(Math.abs(d.x) > W2 + 1.5 || Math.abs(d.z) > L2 + 1.5, `${id}: the door is off the court`);
    assert.ok(Math.abs(a.x) > W2 + 2 || Math.abs(a.z) > L2 + 2, `${id}: the clubhouse is beside the court, not on it`);
    assert.ok(Math.hypot(a.x, a.z) < 40, `${id}: and near it`);
    // (it faces you: the door's spot is in front of the door, toward its side)
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    assert.ok((d.x - d.at.x) * fx + (d.z - d.at.z) * fz > 1, `${id}: the spot in front of the door`);
    const sp = v.spawn; assert.ok(finite(sp.x, sp.z), id);
  }
  assert.equal(styles.size, 12, 'twelve different clubhouses');
});

test('nothing solid on the court or in the game cameras\' way (the 2K end views, the broadcast sideline)', () => {
  for (const id of PROAM_IDS) {
    const { v } = built[id];
    for (const s of v.solids) {
      assert.ok(!(s.x0 < W2 + 0.6 && s.x1 > -W2 - 0.6 && s.z0 < L2 + 0.6 && s.z1 > -L2 - 0.6), `${id}: a solid on the court ${JSON.stringify(s)}`);
      // the 2K camera: up to 28.5 m behind center, 8.5 m up, following the play 4.4 m either way
      for (let z = 13; z <= 28.5; z += 1.5) for (const x of [-4.4, 0, 4.4]) for (const sz of [-1, 1]) assert.ok(!(inBox(x, sz * z, s, 0.4) && s.h > 7.5), `${id}: in the 2K camera's path at ${x},${sz * z}: ${JSON.stringify(s)}`);
      // the broadcast camera: 19 m out on the west side, 8.2 m up, sliding along with the ball
      for (let z = -11; z <= 11; z += 1) assert.ok(!(inBox(-19, z, s, 0.4) && s.h > 7), `${id}: on the broadcast camera at ${z}`);
      // and between it and the court nothing tall
      for (let x = -18; x <= -W2 - 1; x += 1) for (let z = -10; z <= 10; z += 2) assert.ok(!(inBox(x, z, s) && s.h > 4), `${id}: tall in the broadcast view at ${x},${z}: ${JSON.stringify(s)}`);
    }
    // the indoor halls have room for both cameras inside (their walls are the bounds, a metre in)
    if (proamInfo(id).indoor) assert.ok(v.bounds.x0 < -18.5 && v.bounds.z0 < -27.5 && v.bounds.z1 > 27.5, `${id}: the cameras inside the hall`);
  }
});

test('paintHome: a Gold team\'s new colours and logo go on the court and every banner', () => {
  for (const id of ['overpass', 'aau', 'market']) {
    const { scene, v } = build(id, 5);
    const before = v.courts[0].floor, maps = new Set(v.banners.map(b => b.material.map));
    v.paintHome({ name: 'Harbor Hawks', abbr: 'HWK', primary: '#1e6a8a', secondary: '#ffffff', logo: 'circle' });
    assert.equal(v.home.name, 'Harbor Hawks');
    assert.notEqual(v.courts[0].floor, before, `${id}: the court relaid`);
    for (const b of v.banners) assert.ok(!maps.has(b.material.map), `${id}: a banner kept the old team`);
    assert.ok(scene.meshes.length > 10);
  }
});

test('names a player sees in the parks: none of the real world\'s (brands, leagues, places)', () => {
  const src = fs.readFileSync(new URL('../client/js/world/proamparks.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, ''); // (the code, not its comments)
  for (const w of ['NBA', '2K', 'Nike', 'Adidas', 'Jordan', 'Rucker', 'West 4th', 'Subway', 'SUBWAY', 'Starbucks', 'Coca', 'Pepsi', 'Gatorade', 'Zumba', 'Venice', 'Brooklyn', 'Harlem']) assert.ok(!src.includes(w), w);
});

test('the Pro-Am HUB on every park\'s plaza: clear of the courts, the cameras, the kiosks, the HQ, the hall and the lamps', () => {
  const S = PR.PROAM_HUB_SIZE, x0 = PARK_PROAM.x - S.w / 2, x1 = PARK_PROAM.x + S.w / 2, z0 = PARK_PROAM.z - S.d / 2, z1 = PARK_PROAM.z + S.d / 2;
  for (let x = x0; x <= x1; x += 0.5) for (let z = z0; z <= z1 + 2.2; z += 0.5) assert.ok(camClear(x, z, 0), `a game camera's path at ${x},${z}`);
  for (const c of PARK_COURTS) { const [ox, , oz] = c.origin; assert.ok(x1 < ox - W2 - 3 || x0 > ox + W2 + 3 || z1 < oz - L2 - 3 || (!c.full && z0 > oz + L2 + 3), c.id); }
  assert.ok(x0 > 9.6 + 0.2, 'east of the kiosks'); assert.ok(Math.abs(PARK_PROAM.x - PARK_HQ.x) > 10 && Math.abs(PARK_PROAM.x - PARK_HALL.x) > 10, 'nowhere near the HQ and the hall');
  assert.ok(z0 > -30.5 + 0.9, 'in front of the plaza walkers\' lane');
  for (let i = 0; i < 10; i++) { const lx = -40 + i * 9; if (lx > x0 - 0.5 && lx < x1 + 0.5) assert.ok(plazaLampOff(lx), `the lamp at ${lx} is gone`); else assert.ok(!plazaLampOff(lx), `the lamp at ${lx} stays`); }
  assert.ok(onSomething(PARK_PROAM.x, PARK_PROAM.z, 0) && onSomething(PARK_PROAM.x, z1 + 1.5, 0), 'the walkers keep off it and its carpet');
  const hub = PR.proamHub(PARK_PROAM.x, PARK_PROAM.z);
  assert.ok(hub.parts.length > 20 && hub.glow.length > 10);
  for (const p of [...hub.parts, ...hub.glow]) { const [x, , z] = [p.matrix[12], p.matrix[13], p.matrix[14]]; assert.ok(x > x0 - 0.5 && x < x1 + 0.5 && z > z0 - 0.5 && z < z1 + 2.6, `a piece outside the footprint at ${x},${z}`); }
  const src = fs.readFileSync(new URL('../client/js/world/venues.js', import.meta.url), 'utf8');
  assert.match(src, /proamHub: \{ x: PARK_PROAM\.x, z: PARK_PROAM\.z \+ PH\.d \/ 2 \+ 1\.1 \}/, 'the door spot');
  assert.match(src, /x0: PARK_PROAM\.x - PH\.w \/ 2 - 0\.1, x1: PARK_PROAM\.x \+ PH\.w \/ 2 \+ 0\.1/, 'its solid');
});

test('the HUB door: within reach it prompts, and the button opens the Pro-Am hub (game/proamhub.js enterHub, from the park)', async () => {
  const src = fs.readFileSync(new URL('../client/js/game/park.js', import.meta.url), 'utf8');
  assert.match(src, /this\.venue\.proamHub && Math\.hypot\(me\.x - this\.venue\.proamHub\.x, me\.z - this\.venue\.proamHub\.z\) < 2\.6/);
  assert.match(src, /Pro-Am HUB · your team/);
  assert.match(src, /if \(inp\.wasPressed\('interact'\) && !this\.hubOpening\) this\.enterProamHub\(\)/);
  assert.match(src, /import\('\.\/proamhub\.js'\)\.then\(m => m\.enterHub\(this\.app, \{ from: 'park', park: this\.themeId \}\)\)/);
  const hubThere = fs.existsSync(new URL('../client/js/game/proamhub.js', import.meta.url));
  const toasts = [], P = Object.assign(Object.create(ParkHub.prototype), { app: {}, themeId: 'harbor', ui: { toast: t => toasts.push(t) } });
  if (!hubThere) {
    const warn = console.warn; console.warn = () => {};
    try { P.enterProamHub(); assert.equal(P.hubOpening, true, 'one at a time'); await new Promise(r => setTimeout(r, 50)); } finally { console.warn = warn; }
    assert.deepEqual(toasts, ['The Pro-Am HUB opens soon.']);
    assert.equal(P.hubOpening, false);
  }
});

test('the Platinum record over the head: only with the toggle on, Platinum or above (now or at his best), as W–L', () => {
  assert.equal(recordText({ tier: 'Platinum', div: 2, record: [12, 4], showRecord: true }), '12–4');
  assert.equal(recordText({ tier: 'Platinum', record: [12, 4], showRecord: false }), null, 'toggle off');
  assert.equal(recordText({ tier: 'Gold', record: [12, 4], showRecord: true }), null, 'below Platinum');
  assert.equal(recordText({ tier: 'Gold', best: 'Platinum', record: [3, 9], showRecord: true }), '3–9', 'rank items keep working after a demotion');
  assert.equal(recordText({ tier: 'GrandMaster', record: [40, 2], showRecord: true }), '40–2');
  assert.equal(recordText({ tier: 4, record: ['7', '1'], showRecord: true }), '7–1');
  assert.equal(recordText({ tier: 'Diamond', showRecord: true }), null, 'no record');
  assert.equal(recordText(null), null); assert.equal(recordText(undefined), null);
  assert.equal(recordText({ tier: 'Master', record: [-3, 1e9], showRecord: true }), '0–9999');
  assert.deepEqual(PROAM_TIERS.map(tierIndex), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(tierIndex('Grand Master'), 6); assert.equal(tierIndex('nope'), -1);
  assert.equal(tagTier({ tier: 'Gold' }), 'platinum'); assert.equal(tagTier({ tier: 'Diamond' }), 'diamond');
});

test('RecordTags: a tag over each head that shows one, facing the camera, rebuilt when the record changes, gone when switched off', () => {
  const scene = fakeScene(), tags = new RecordTags({ ctx }, scene);
  const plat = { tier: 'Platinum', record: [5, 2], showRecord: true };
  assert.equal(tags.update([{ key: 'me', x: 1, z: 2, h: 2, proam: plat }, { key: 'p:a', x: 5, z: 5, h: 2, proam: { tier: 'Silver', record: [1, 1], showRecord: true } }, { key: 'p:b', x: -3, z: 0, proam: { ...plat, showRecord: false } }], [0, 8, -20]), 1);
  assert.equal(scene.meshes.length, 1);
  const m = scene.meshes[0], tex = m.material.map;
  assert.ok(Math.abs(m.matrix[13] - 2.42) < 1e-6 && m.matrix[12] === 1 && m.matrix[14] === 2, 'over his head');
  const yaw = Math.atan2(0 - 1, -20 - 2); assert.ok(Math.abs(m.matrix[8] - Math.sin(yaw)) < 1e-6, 'facing the camera');
  tags.update([{ key: 'me', x: 1.5, z: 2, h: 2, proam: plat }], [0, 8, -20]);
  assert.equal(m.material.map, tex, 'the same record: the same texture');
  tags.update([{ key: 'me', x: 1.5, z: 2, h: 2, proam: { ...plat, record: [6, 2] } }], [0, 8, -20]);
  assert.notEqual(m.material.map, tex, 'a new record: redrawn');
  tags.update([{ key: 'me', x: 1.5, z: 2, h: 2, proam: { ...plat, showRecord: false } }], [0, 8, -20]);
  assert.equal(scene.meshes.length, 0, 'switched off: gone');
  tags.update([{ key: 'me', x: 0, z: 0, proam: plat }, { key: 'p:c', x: 0, z: 1, proam: plat }], null);
  assert.equal(scene.meshes.length, 2); tags.dispose(); assert.equal(scene.meshes.length, 0);
});

test('in the park: your record and the real players\' over their heads while you roam, none in your own game', () => {
  const scene = fakeScene();
  const plat = { tier: 'Diamond', record: [9, 3], showRecord: true };
  const peer = { id: 'u2', p: { x: 4, z: 6 }, entry: { build: { height: 80 }, proam: { tier: 'Platinum', record: [2, 8], showRecord: true } }, visual: {} };
  const shy = { id: 'u3', p: { x: -4, z: 6 }, entry: { build: { height: 74 }, proam: { tier: 'Master', record: [30, 1], showRecord: false } }, visual: {} };
  const P = Object.assign(Object.create(ParkHub.prototype), { r: { ctx }, scene, mode: 'roam', me: { x: 1, z: -2 }, meEntry: { build: { height: 76 } }, peers: { list: () => [peer, shy] }, app: { char: () => null, proam: plat, camera: { pos: [0, 8, -25] } } });
  P.recordTagsFrame(0.016);
  assert.equal(scene.meshes.length, 2, 'you and the one with his toggle on');
  const ys = scene.meshes.map(m => m.matrix[13]).sort();
  assert.ok(Math.abs(ys[1] - (80 * 0.0254 + 0.08 + 0.42)) < 1e-6, 'at his height');
  P.mode = 'match'; P.recordTagsFrame(0.016);
  assert.equal(scene.meshes.length, 0, 'not in your game');
  P.mode = 'roam'; P.recordTagsFrame(0.016); assert.equal(scene.meshes.length, 2);
  P.dispose ? P.recordTags.dispose() : null; assert.equal(scene.meshes.length, 0);
});
