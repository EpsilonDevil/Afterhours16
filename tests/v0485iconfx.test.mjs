// v0.4.8.5 quick patch 3: ICON status, the visuals (game/iconfx.js). An ICON build's cursor is his own animated Icon badge
// (every mode, everyone's screen), and his dark aura shows from a 3-game win streak, stronger every 3 wins, all the way
// at 12+. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// (the floor shadow and the plain ring are canvas textures: a do-nothing canvas is enough here)
const fake2d = new Proxy({}, { get: (o, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'getImageData' || k === 'createImageData' ? (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fake2d; } };

const { IconFX, IconAura, IconCursor, iconFxState, auraGeometry, ICON_AURA, ICON_CURSOR, AURA_BONES, endWinStreak, iconDecalTexture, iconDecalState } = await import('../client/js/game/iconfx.js');
const { PlayerVisual } = await import('../client/js/game/session.js');
const { iconAuraLevel, winStreak, iconStatus } = await import('../client/js/sim/builds.js');
const { boostedBuild } = await import('../client/js/sim/ratings.js');
const { iconKey, setupEntry } = await import('../client/js/ui/online.js');
const T = await import('../client/js/gfx/textures.js');

const src = f => fs.readFileSync(new URL('../client/js/' + f, import.meta.url), 'utf8');
function rig() {
  const disposed = [];
  const ctx = { geometry: g => ({ ...g, bounds: g.bounds || { center: [0, 0, 0], radius: 1 } }), texture: (s, o) => ({ s, o }), disposeGeometry: g => disposed.push(g) };
  const scene = { meshes: [], add(m) { this.meshes.push(m); return m; }, remove(m) { const i = this.meshes.indexOf(m); if (i >= 0) this.meshes.splice(i, 1); } };
  return { r: { ctx, lodEye: [0, 6, 14] }, scene, disposed };
}
const pool = () => ({ take: () => null, request: () => ({}), cancel() {}, release() {} });
const icon = (streak = 0, extra = {}) => ({ name: 'Ike', icon_status: true, icon_badge: 'sharp_eye', win_streak: streak, progression: { win_streak: streak }, ...extra });
const plain = (streak = 0) => ({ name: 'Joe', icon_status: false, icon_badge: null, win_streak: streak });
const visual = (R, build) => new PlayerVisual(R.r, R.scene, build, {}, { pool: pool() });
const named = (R, n) => R.scene.meshes.filter(m => m.name === n);
const run = (fx, secs, x = 0, y = 0, z = 0, view = null) => { for (let i = 0; i < secs * 60; i++) fx.place(x, y, z, view, false, 1 / 60); };

test('the aura level by win streak: hidden to 2, then one step every 3 wins, ultimate from 12', () => {
  const want = { 0: 0, 1: 0, 2: 0, 3: 1, 5: 1, 6: 2, 8: 2, 9: 3, 11: 3, 12: 4, 15: 4, 30: 4 };
  for (const [s, lv] of Object.entries(want)) {
    assert.equal(iconAuraLevel(+s), lv, `streak ${s}`);
    assert.equal(iconFxState(icon(+s)).level, lv);
  }
  // only an ICON build has one (a streak alone is nothing)
  assert.deepEqual(iconFxState(plain(12)), { icon: false, badge: null, streak: 12, level: 0 });
  assert.equal(iconFxState(icon(4)).badge, 'sharp_eye');
  // the streak is the build's own, from the server's top-level copy or the progression
  assert.equal(winStreak({ progression: { win_streak: 7 } }), 7);
});

test('only an ICON build swaps the circular cursor for its Icon badge; everyone else keeps the ring', async () => {
  const R = rig();
  const a = visual(R, plain(9)); a.addRing(R.r, '#ffd84a');
  assert.ok(a.ring && !a.icon, 'a plain build: the ring');
  assert.equal(named(R, 'iconCursor').length + named(R, 'iconAura').length, 0, 'no badge, no aura (even on a streak)');
  const b = visual(R, icon(0)); b.addRing(R.r, '#4ac8ff');
  assert.equal(b.ring, null, 'an ICON build has no ring');
  assert.ok(b.icon?.cursor, 'his Icon badge instead');
  assert.equal(named(R, 'iconCursor').length, 1);
  assert.equal(b.icon.cursor.badge, 'sharp_eye');
  assert.equal(named(R, 'iconAura').length, 0, 'no streak yet: no aura built');
  // addIcon on its own (the other real people walking the park): nothing for a plain build
  const c = visual(R, plain(0));
  assert.equal(c.addIcon(R.r, '#f4f2ec'), false);
  assert.equal(c.icon, null);
  // the team colour stays on as a thin ring round the badge (vertex colour of the team quad)
  const { hexLinear } = await import('../client/js/core/math.js');
  const ring = (vis, hex) => { const col = vis.icon.cursor.mesh.geo.color, t = hexLinear(hex).map(x => x * 1.6); let n = 0; for (let i = 0; i < col.length; i += 4) if (t.every((x, k) => Math.abs(col[i + k] - x) < 1e-4)) n++; return n; };
  assert.equal(ring(b, '#4ac8ff'), 4, 'the team ring (one quad) is in the team colour');
  const d = visual(R, icon(0)); d.addRing(R.r, '#ff5a6a');
  assert.equal(ring(d, '#ff5a6a'), 4); assert.equal(ring(d, '#4ac8ff'), 0, 'an opponent: red, not blue');
});

test('the aura: hidden at level 0, shown from level 1, stronger at every level', () => {
  const R = rig();
  for (const s of [0, 1, 2]) { const v = visual(R, icon(s)); v.addRing(R.r, '#ffd84a'); run(v.icon, 1); assert.ok(!v.icon.aura || !v.icon.aura.visible, `streak ${s}: no aura`); v.dispose(); }
  const seen = [];
  for (const s of [3, 6, 9, 12, 30]) {
    const v = visual(R, icon(s)); v.addRing(R.r, '#ffd84a');
    v.place(1, 0, 2); run(v.icon, 3, 1, 0, 2);
    const a = v.icon.aura;
    assert.ok(a && a.visible, `streak ${s}: the aura shows`);
    assert.equal(a.level, iconAuraLevel(s));
    seen.push({ lv: a.level, op: a.mat.opacity, rim: a.mat.color[0], r: a.mesh.boundsOverride.radius });
    v.dispose();
  }
  for (const tab of ['width', 'rise', 'alpha', 'rim', 'speed', 'flicker']) for (let i = 1; i < 5; i++) assert.ok(ICON_AURA[tab][i] > ICON_AURA[tab][i - 1], `${tab} grows at level ${i}`);
  for (let i = 1; i < 4; i++) assert.ok(seen[i].rim > seen[i - 1].rim && seen[i].r > seen[i - 1].r, 'brighter-edged and bigger');
  assert.deepEqual(seen.slice(3).map(q => q.lv), [4, 4], 'ultimate at 12 and stays there');
  // the extras come in at the top: embers from 6, the outer layer from 9, crackles and the floor pulse at 12
  assert.equal(ICON_AURA.embers[1], 0); assert.equal(ICON_AURA.embers[2], 1);
  assert.equal(ICON_AURA.outer[2], 0); assert.ok(ICON_AURA.outer[3] > 0);
  assert.equal(ICON_AURA.pulse[3], 0); assert.equal(ICON_AURA.pulse[4], 1); assert.ok(ICON_AURA.crackle[4] > ICON_AURA.crackle[3]);
});

test('geometry, bones and uniforms are all finite and inside the renderer\'s limits', () => {
  const g = auraGeometry(), n = g.position.length / 3;
  assert.ok(AURA_BONES.n <= 24, 'MAX_BONES is 24');
  for (const k of ['position', 'normal', 'uv', 'color', 'weights']) assert.ok(g[k].every(Number.isFinite), k);
  assert.ok(g.joints.every(j => j >= 0 && j < AURA_BONES.n && Number.isInteger(j)));
  for (let i = 0; i < n; i++) { const s = g.weights[i * 4] + g.weights[i * 4 + 1] + g.weights[i * 4 + 2] + g.weights[i * 4 + 3]; assert.ok(Math.abs(s - 1) < 1e-5, `weights of ${i}`); }
  assert.ok(g.index.every(i => i < n) && g.index.length % 3 === 0);
  assert.ok(n < 2000 && g.index.length / 3 < 3000, `cheap: ${n} vertices, ${g.index.length / 3} triangles`);
  // the flames sample the flame strip, the crackles and the pulse the solid one
  const [f0, f1] = T.AURA_UV.flames, [e0, e1] = T.AURA_UV.embers;
  for (let i = 0; i < n; i++) { const u = g.uv[i * 2]; assert.ok((u >= f0 - 1e-6 && u <= f1 + 1e-6) || (u >= e0 && u <= e1) || Math.abs(u - T.AURA_UV.solid) < 1e-6, `u ${u}`); }
  const R = rig();
  for (const lv of [1, 2, 3, 4]) {
    const a = new IconAura(R.r, R.scene, lv);
    // standing, crouched, in the air, leaning: always finite
    for (const [foot, head] of [[[0, 0, 0], [0, 1.8, 0]], [[0, 0, 0], [0.1, 1.2, 0.1]], [[2, 0.8, 1], [2, 2.7, 1]], [[0, 0, 0], [0.5, 1.6, 0.2]]]) {
      for (let i = 0; i < 90; i++) a.update(1 / 60, foot, head, i * 0.07);
      assert.ok(a.mesh.bones.every(Number.isFinite), `level ${lv}: bones`);
      assert.ok(Number.isFinite(a.mat.opacity) && a.mat.opacity > 0 && a.mat.opacity <= 1, 'opacity');
      assert.ok(a.mat.color.every(Number.isFinite) && a.mat.uvOffset.every(v => Number.isFinite(v) && v >= 0 && v < 1), 'colour and scroll');
      assert.ok(Number.isFinite(a.mesh.boundsOverride.radius));
    }
    // it follows him: the bounds sit over the player, wherever he is
    assert.ok(Math.abs(a.mesh.boundsOverride.center[0] - 0.25) < 0.3);
    assert.equal(a.mesh.material.blend, 'alpha', 'alpha blended: additive light cannot make black');
    assert.equal(a.mesh.castShadow, false); assert.equal(a.mesh.material.depthWrite, false);
  }
  // the gated parts collapse while their level isn't reached (no stray triangles)
  const a1 = new IconAura(R.r, R.scene, 1); a1.update(1 / 60, [0, 0, 0], [0, 1.8, 0], 0);
  for (const b of [AURA_BONES.outer, AURA_BONES.emb, AURA_BONES.emb2, AURA_BONES.ringIn, AURA_BONES.crack]) assert.ok(a1.mesh.bones.subarray(b * 16, b * 16 + 16).every(v => v === 0), `bone ${b} collapsed at level 1`);
  const c = new IconCursor(R.r, R.scene, 'open_arms', '#ff5a6a'); c.update(1 / 60, 3, 0, 4, 1.2);
  assert.ok(c.mesh.bones.every(Number.isFinite) && c.mesh.geo.position.every(Number.isFinite));
  assert.ok(c.mesh.geo.joints.every(j => j < 4));
  assert.equal(c.mesh.order, ICON_CURSOR.order);
});

test('the badge faces whoever is looking, turns its rim, pulses; cold takes its place, hot sets it on fire; it hides with him', () => {
  const R = rig(), v = visual(R, icon(12)); v.addRing(R.r, '#ffd84a'); v.addStatus(R.r);
  v.pending = false; v.view = { visible: true, joint: null };
  v.place(0, 0, 0); run(v.icon, 1);
  const cur = v.icon.cursor, faceYaw = () => Math.atan2(cur.mesh.bones[48 + 8], cur.mesh.bones[48 + 10]);
  // the camera at +z: the face's +z (the top of the badge away from it) points at it, give or take its sway
  assert.ok(Math.abs(faceYaw()) < 0.1, `faces the camera (${faceYaw().toFixed(3)})`);
  R.r.lodEye = [10, 6, 0]; run(v.icon, 0.1);
  assert.ok(Math.abs(faceYaw() - Math.PI / 2) < 0.1, 'and turns with it');
  const rim0 = Math.atan2(cur.mesh.bones[16 + 8], cur.mesh.bones[16 + 10]); run(v.icon, 0.5);
  assert.notEqual(Math.atan2(cur.mesh.bones[16 + 8], cur.mesh.bones[16 + 10]), rim0, 'the spectrum rim turns');
  assert.equal(cur.mesh.visible, true);
  // (v0.4.8.5 qp5: hot no longer takes the badge's place for an ICON build: it stays and burns purple, see
  // v0485iconfire.test.mjs; cold still does)
  v.setStatus(true, false, 1 / 60); v.place(0, 0, 0);
  assert.equal(cur.mesh.visible, true, 'hot: the badge stays (and burns)');
  assert.equal(v.fire.visible, false, 'no flame icon for an ICON build');
  assert.equal(v.icon.aura.visible, true, 'the aura stays');
  v.setStatus(false, true, 1 / 60); v.place(0, 0, 0);
  assert.equal(cur.mesh.visible, false, 'cold: the ice takes the badge\'s place');
  assert.equal(v.ice.visible, true);
  v.setStatus(false, false, 1 / 60); v.place(0, 0, 0);
  assert.equal(cur.mesh.visible, true);
  // a team intro hides him (view.visible), the Crew HQ hides you in its games (setHidden), a culled player is left out
  v.view.visible = false; v.place(0, 0, 0);
  assert.ok(!cur.mesh.visible && !v.icon.aura.visible, 'hidden with him');
  v.view.visible = true; v.place(0, 0, 0); assert.ok(cur.mesh.visible && v.icon.aura.visible);
  v.setHidden(true); assert.ok(!cur.mesh.visible && !v.icon.aura.visible);
  v.setHidden(false); v.place(0, 0, 0); assert.ok(cur.mesh.visible);
  v.setCulled(true); assert.ok(cur.mesh.culled && v.icon.aura.mesh.culled);
  v.setCulled(false); assert.ok(!cur.mesh.culled && !v.icon.aura.mesh.culled);
  // not there yet (his athlete still being built): nothing under him
  const w = visual(R, icon(12)); w.addRing(R.r, '#fff'); w.place(0, 0, 0);
  assert.equal(w.pending, true); assert.ok(!w.icon.cursor.mesh.visible && !w.icon.aura.visible);
});

test('the aura follows his body: his hips and head, a jump', () => {
  const R = rig(), v = visual(R, icon(12)); v.addRing(R.r, '#ffd84a');
  const at = { x: 3, y: 0, z: 5 }, head = [3.3, 1.75, 5.1];
  v.pending = false;
  v.view = { visible: true, model: {}, joint: (b, out) => { const p = b === 0 ? [at.x + 0.1, at.y + 1.0, at.z] : [head[0], head[1] + at.y, head[2]]; out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; } };
  for (let i = 0; i < 60; i++) v.place(at.x, at.y, at.z);
  const B = v.icon.aura.mesh.bones, hb = AURA_BONES.head * 16;
  // the head bone carries the reference head (0, 1, 0) to his head
  const hx = B[hb] * 0 + B[hb + 4] * 1 + B[hb + 12], hy = B[hb + 5] + B[hb + 13];
  assert.ok(Math.abs(hx - head[0]) < 1e-4 && Math.abs(hy - head[1]) < 1e-4, `head (${hx.toFixed(3)}, ${hy.toFixed(3)})`);
  at.y = 0.8; for (let i = 0; i < 5; i++) v.place(at.x, at.y, at.z);
  assert.ok(Math.abs(B[AURA_BONES.low * 16 + 13] - 0.8) < 1e-6, 'in a jump the aura lifts off with him');
});

test('dispose takes away everything it added (and frees its geometry)', () => {
  const R = rig(), base = R.scene.meshes.length;
  const v = visual(R, icon(12)); v.addRing(R.r, '#ffd84a'); v.addStatus(R.r);
  v.pending = false; v.view = { visible: true }; v.place(0, 0, 0);
  assert.equal(named(R, 'iconCursor').length, 1); assert.equal(named(R, 'iconAura').length, 1);
  const geos = [v.icon.cursor.mesh.geo, v.icon.aura.mesh.geo];
  v.view = { dispose() {} }; v.pool = null;
  v.dispose(); v.dispose();
  assert.equal(R.scene.meshes.length, base, 'nothing left in the scene');
  for (const g of geos) assert.ok(R.disposed.includes(g), 'its geometry freed');
  assert.equal(v.icon, null);
  const fx = new IconFX(R.r, R.scene, icon(9), { color: '#fff' });
  assert.equal(R.scene.meshes.length, base + 2);
  fx.dispose(); assert.equal(R.scene.meshes.length, base);
});

test('in the roam the visual follows the build: a new streak, ICON made, a streak ended', () => {
  const R = rig(), v = visual(R, plain(5)); v.addRing(R.r, '#ff8a3c');
  assert.ok(v.ring && !v.icon);
  v.syncIcon(icon(4)); // (just made ICON, after a game)
  assert.equal(v.ring, null); assert.equal(R.scene.meshes.filter(m => m.order === 4 && !m.name).length, 0, 'the old ring is gone');
  assert.equal(v.icon.level, 1); assert.ok(v.icon.aura);
  v.syncIcon(icon(12)); assert.equal(v.icon.level, 4);
  v.syncIcon(icon(0)); assert.equal(v.icon.level, 0);
  v.pending = false; v.view = { visible: true }; run(v.icon, 4);
  assert.equal(v.icon.aura.visible, false, 'the streak ended: the aura fades out');
  const same = v.icon; v.syncIcon(v.build); assert.equal(v.icon, same, 'the same build: nothing to do');
  v.syncIcon({ ...icon(3), icon_badge: 'open_arms' }); assert.equal(v.icon.cursor.badge, 'open_arms');
  assert.equal(named(R, 'iconCursor').length, 1, 'one badge, not two');
  // (a build that isn't ICON gets its ring back)
  v.syncIcon(plain(3)); assert.ok(v.ring && !v.icon);
  assert.equal(named(R, 'iconCursor').length + named(R, 'iconAura').length, 0);
  // a game left: the server ends the streak, so does your copy of the build
  const chars = [icon(7)]; const app = { char: () => chars[0], replaceChar: c => { chars[0] = c; } };
  assert.equal(endWinStreak(app), true);
  assert.equal(winStreak(app.char()), 0); assert.equal(app.char().progression.win_streak, 0); assert.equal(app.char().icon_status, true);
  assert.equal(endWinStreak(app), false);
});

test('ICON status and the streak go into every game: boosts, online entries, the hub\'s copy of you', () => {
  const c = { ...icon(9), attributes: { three_point: 90 }, position: 'SG' };
  const bb = boostedBuild(c, ['shooting']);
  for (const k of ['icon_status', 'icon_badge', 'win_streak']) assert.deepEqual(bb[k], c[k], `boosted build keeps ${k}`);
  assert.equal(bb.progression.win_streak, 9);
  assert.equal(iconStatus(bb), true); assert.equal(iconFxState(bb).level, 3);
  const e = setupEntry({ catalog: {} }, { build: bb, name: 'Ike', look: {}, badges: {} }, true, 'ike');
  assert.equal(e.build, bb, 'an online setup carries the build as it came');
  // your entry goes out again when the people where you are would see something new: ICON made, a new aura level
  assert.equal(iconKey(plain(12)), '');
  assert.equal(iconKey(icon(3)), iconKey(icon(5)), 'not for every win');
  assert.notEqual(iconKey(icon(5)), iconKey(icon(6)));
  assert.notEqual(iconKey(icon(12)), iconKey({ ...icon(12), icon_badge: 'open_arms' }));
  assert.ok(src('ui/online.js').includes("JSON.stringify(c.boosts || {})}|${iconKey(c)}`"), 'the entry key includes it');
  // every path that builds a human's entry spreads the character (so the server's icon_status / win_streak ride along)
  assert.ok(src('ui/modes.js').includes('const mine = { build: { ...c }, name: c.name, human: true'));
  assert.ok(src('ui/prorun.js').includes('const meE = { build: boostedBuild(c, ticket.meta.boosts)'));
  assert.ok(src('game/park.js').includes('meEntry.build = boostedBuild(app.char(), ticket.meta.boosts);'));
  assert.ok(src('game/crewhq.js').includes('build: { ...app.char() }'));
});

test('every mode: humans get it in games (yours, teammates, opponents, watching), the roam, the other people, the Crew HQ', () => {
  const session = src('game/session.js'), park = src('game/park.js'), hq = src('game/crewhq.js');
  assert.ok(session.includes("if (p.human) pv.addRing(this.r, this.spectate ? '#f4f2ec' : this.isMe(p) ? '#ffd84a' : p.team === this.game.human?.team ? '#4ac8ff' : '#ff5a6a');"), 'every human in a game goes through addRing');
  assert.ok(session.includes('if (this.addIcon(r, color)) return;'), 'and addRing gives an ICON build his badge');
  assert.ok(park.includes("this.visual.addIcon?.(hub.r, '#f4f2ec');"), 'the real people walking the park (and the HQ)');
  assert.ok(park.includes('this.meVisual?.syncIcon?.(app.char());') && hq.includes('this.meVisual.syncIcon?.(app.char());'), 'your roam visual follows your build');
  assert.ok(hq.includes('this.meVisual.setHidden?.(hide);'), 'the HQ hides it with you');
  assert.ok(park.includes('endWinStreak(this.app)'), 'a forfeit ends your copy of the streak');
});

test('the textures: data (no DOM needed), seamless as they scroll, the badge art drawn in only in a browser', () => {
  const A = T.auraTexture(128), W = 128, H = 128, d = A.data;
  assert.equal(d.length, W * H * 4);
  for (let y = 0; y < H; y += 7) assert.equal(d[(y * W + 2) * 4 + 3], 255, 'the solid strip');
  // the flames repeat down the texture: the last row runs into the first as smoothly as any two rows
  const alpha = (x, y) => d[(y * W + x) * 4 + 3];
  let seam = 0, rows = 0; const x0 = Math.round(W * 0.3);
  for (let x = x0; x < W - 4; x++) { seam += Math.abs(alpha(x, H - 1) - alpha(x, 0)); rows += Math.abs(alpha(x, 40) - alpha(x, 41)); }
  assert.ok(seam < rows * 3 + 200, `no seam (${seam} vs ${rows})`);
  // every part of the flames about as dense as the rest (it only scrolls up: a dense column would stay dense)
  const cov = [0, 0, 0]; const fw = W - x0 - 8;
  for (let y = 0; y < H; y++) for (let x = x0 + 8; x < W - 8; x++) cov[Math.min(2, Math.floor((x - x0 - 8) / (fw / 3)))] += alpha(x, y) / 255;
  const m = cov.map(v => v / (H * fw / 3));
  assert.ok(Math.max(...m) - Math.min(...m) < 0.2, `even coverage ${m.map(v => v.toFixed(2))}`);
  // the cursor atlas: the spectrum rim is a ring of the Icon colours, the face quarter a stand-in medallion
  const D = T.iconDecalAtlas(128), Q = 64, px = (x, y) => D.data.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4);
  assert.ok(px(Q + Q / 2, Q / 2)[3] === 0 && px(Q + Q / 2, 3)[3] > 100, 'the rim: clear in the middle, coloured at the edge');
  assert.ok(px(Q / 2, Q / 2)[3] === 255, 'the stand-in face');
  assert.ok(T.iconSpectrum(0).every((v, i) => Math.abs(v - T.iconSpectrum(1)[i]) < 1e-9), 'the spectrum closes on itself');
  const R = rig(), tex = iconDecalTexture(R.r.ctx, 'sharp_eye');
  assert.equal(iconDecalState(tex), 'base', 'no DOM here: the stand-in face, no attempt to draw the SVG');
  const code = src('game/iconfx.js');
  assert.ok(code.includes("'data:image/svg+xml;charset=utf-8,'") && code.includes('xmlns="http://www.w3.org/2000/svg"') && code.includes('ctx.updateTexture(tex, c)'), 'in a browser the SVG is drawn into the texture');
});
