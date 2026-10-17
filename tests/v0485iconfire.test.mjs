// v0.4.8.5 quick patch 5: an ICON build on fire. Where everybody else gets the flame icon under him (v0.4.5 Hot /
// Cold), an ICON build keeps his animated Icon badge on the floor and it burns: a ring of purple flame round its outside
// (game/iconfx.js IconFire, one skinned mesh). Cold is as it was (the ice takes the badge's place). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// (the floor shadow, the plain ring and the hot / cold icons are canvas textures: a do-nothing canvas is enough here)
const fake2d = new Proxy({}, { get: (o, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'getImageData' || k === 'createImageData' ? (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fake2d; } };

const { IconFX, IconFire, fireGeometry, ICON_FIRE, FIRE_BONES, ICON_CURSOR } = await import('../client/js/game/iconfx.js');
const { PlayerVisual } = await import('../client/js/game/session.js');
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
const named = (R, n) => R.scene.meshes.filter(m => m.name === n);
// a player in a game: his visual with his ring (ICON: the badge) and the hot / cold icons, there and posed
function player(R, build, color = '#ffd84a') {
  const v = new PlayerVisual(R.r, R.scene, build, {}, { pool: pool() });
  v.addRing(R.r, color); v.addStatus(R.r);
  v.pending = false; v.view = { visible: true, joint: null };
  return v;
}
// a game's frames: the status, then where he is (MatchSession.render: PlayerVisual.place), with a fixed step for the
// badge and its fire (PlayerVisual.place times them by the clock)
const frames = (v, secs, hot, cold = false, x = 0, z = 0) => {
  for (let i = 0; i < Math.max(1, Math.round(secs * 60)); i++) { v.setStatus(hot, cold, 1 / 60); v.place(x, 0, z); v.icon?.place(x, 0, z, v.view, v.pending || v.view?.visible === false, 1 / 60); }
};

test('an ICON build on fire: his badge stays, the purple flame burns round it, no flame icon', () => {
  const R = rig(), v = player(R, icon(0));
  frames(v, 0.5, false);
  assert.equal(named(R, 'iconFire').length, 0, 'not on fire: no flame built');
  frames(v, 0.6, true, false, 3, -2);
  const fire = v.icon.fire;
  assert.ok(fire instanceof IconFire, 'the purple flame');
  assert.equal(named(R, 'iconFire').length, 1);
  assert.equal(fire.visible, true, 'burning');
  assert.equal(v.icon.cursor.mesh.visible, true, 'the Icon badge stays under him');
  assert.equal(v.fire.visible, false, 'the regular on-fire icon is not shown');
  assert.equal(v.ice.visible, false);
  assert.ok(fire.mat.opacity > 0.85, `flared up (${fire.mat.opacity.toFixed(2)})`);
  // it's where he is (bone 0 carries the ring to him) and drawn over the badge
  const B = fire.mesh.bones;
  assert.ok(Math.abs(B[12] - 3) < 1e-6 && Math.abs(B[14] + 2) < 1e-6 && Math.abs(B[13]) < 1e-6, 'on the floor under him');
  assert.ok(fire.mesh.order > ICON_CURSOR.order, 'drawn after the badge');
  assert.equal(fire.mesh.material.blend, 'alpha'); assert.equal(fire.mesh.material.depthWrite, false);
  assert.equal(fire.mesh.castShadow, false); assert.equal(fire.mesh.reflect, false);
  // turned to the camera like the badge's face: its +z (the low front of the ring) points at the eye
  const yawOf = () => Math.atan2(B[8], B[10]);
  R.r.lodEye = [3, 6, 20]; frames(v, 0.1, true, false, 3, -2); assert.ok(Math.abs(yawOf()) < 1e-6, 'front toward the camera');
  R.r.lodEye = [13, 6, -2]; frames(v, 0.1, true, false, 3, -2); assert.ok(Math.abs(yawOf() - Math.PI / 2) < 1e-6, 'and round with it');
  // the flames rise: the texture scrolls
  const v0 = fire.mat.uvOffset[1]; frames(v, 0.2, true, false, 3, -2);
  assert.notEqual(fire.mat.uvOffset[1], v0, 'the flames move');
  // it follows him across the floor
  frames(v, 0.05, true, false, -4, 5);
  assert.ok(Math.abs(B[12] + 4) < 1e-6 && Math.abs(B[14] - 5) < 1e-6);
  assert.ok(Math.abs(fire.mesh.boundsOverride.center[0] + 4) < 1e-6 && Math.abs(fire.mesh.boundsOverride.center[2] - 5) < 1e-6, 'its bounds too');
});

test('cooling off: the flame dies down and is gone; not on fire, there is none', () => {
  const R = rig(), v = player(R, icon(3));
  frames(v, 2, false);
  assert.equal(v.icon.fire, null, 'never on fire: never built');
  frames(v, 1, true);
  assert.equal(v.icon.fire.visible, true);
  frames(v, 0.1, false);
  assert.equal(v.icon.fire.visible, true, 'dying down (a moment, not a cut)');
  assert.ok(v.icon.fire.show < 0.9 && v.icon.fire.mat.opacity < 0.98, 'fading'); // (the opacity also flickers: test the fade itself)
  frames(v, ICON_FIRE.fadeOut + 0.1, false);
  assert.equal(v.icon.fire.visible, false, 'out');
  assert.equal(v.icon.cursor.mesh.visible, true, 'the badge as it always is');
  assert.equal(v.fire.visible, false, 'and no flame icon');
});

test('an ICON build gone cold: as before, the ice takes the badge\'s place (no purple flame)', () => {
  const R = rig(), v = player(R, icon(6));
  frames(v, 0.5, false, true);
  assert.equal(v.icon.cursor.mesh.visible, false, 'the badge gives way to the ice');
  assert.equal(v.ice.visible, true);
  assert.equal(v.fire.visible, false);
  assert.ok(!v.icon.fire || !v.icon.fire.visible, 'no purple flame');
  assert.equal(v.icon.statusOn, true);
  // on fire, then cold (a miss ends the fire; more open misses make him cold): the flame never shows over the ice
  frames(v, 0.5, true); assert.equal(v.icon.fire.visible, true);
  frames(v, 1 / 60, false, true);
  assert.equal(v.icon.cursor.mesh.visible, false); assert.equal(v.ice.visible, true);
  frames(v, 1, false, true);
  assert.equal(v.icon.fire.visible, false);
});

test('everybody else on fire: the regular flame icon exactly as before, no purple flame', () => {
  for (const human of [true, false]) {
    const R = rig(), v = new PlayerVisual(R.r, R.scene, plain(12), {}, { pool: pool() });
    if (human) v.addRing(R.r, '#4ac8ff'); // (people get a ring; the AI none)
    v.addStatus(R.r); v.pending = false; v.view = { visible: true, joint: null };
    frames(v, 0.5, true, false, 1, 2);
    assert.equal(v.icon, null, 'not an ICON build');
    assert.equal(v.fire.visible, true, 'the flame icon');
    assert.equal(v.ice.visible, false);
    if (human) assert.equal(v.ring.visible, false, 'in place of his ring');
    assert.equal(named(R, 'iconFire').length + named(R, 'iconCursor').length, 0, 'no purple flame, no badge');
    // (placed and sized as it always was: under him, turning, 1.45 m give or take its flicker)
    const m = v.fire.matrix, s = Math.hypot(m[0], m[2]);
    assert.ok(Math.abs(m[12] - 1) < 1e-6 && Math.abs(m[14] - 2) < 1e-6 && Math.abs(m[13] - 0.018) < 1e-6);
    assert.ok(s > 1.36 && s < 1.54, `size ${s.toFixed(2)}`);
    assert.equal(v.fire.material.blend, 'add'); assert.equal(v.fire.order, 5);
    frames(v, 0.1, false, true);
    assert.equal(v.fire.visible, false); assert.equal(v.ice.visible, true);
    if (human) assert.equal(v.ring.visible, false);
    frames(v, 0.1, false, false);
    assert.equal(v.fire.visible, false); assert.equal(v.ice.visible, false);
    if (human) assert.equal(v.ring.visible, true, 'the ring back');
  }
});

test('the flame\'s geometry, bones and uniforms: finite, inside the renderer\'s limits, cheap', () => {
  const g = fireGeometry(), n = g.position.length / 3;
  assert.ok(FIRE_BONES.n <= 24, 'MAX_BONES is 24');
  for (const k of ['position', 'normal', 'uv', 'color', 'weights']) assert.ok(g[k].every(Number.isFinite), k);
  assert.ok(g.joints.every(j => j >= 0 && j < FIRE_BONES.n && Number.isInteger(j)));
  for (let i = 0; i < n; i++) { const s = g.weights[i * 4] + g.weights[i * 4 + 1] + g.weights[i * 4 + 2] + g.weights[i * 4 + 3]; assert.ok(Math.abs(s - 1) < 1e-5, `weights of ${i}`); }
  assert.ok(g.index.every(i => i < n) && g.index.length % 3 === 0);
  assert.ok(n < 2000 && g.index.length / 3 < 4000, `cheap: ${n} vertices, ${g.index.length / 3} triangles`);
  for (let i = 0; i < n; i++) assert.ok(g.color[i * 4 + 3] >= 0 && g.color[i * 4 + 3] <= 1, 'vertex alpha 0..1');
  // the flames sample the flame strip, the glow and the embers the solid one
  const [f0, f1] = T.FIRE_UV.flames;
  for (let i = 0; i < n; i++) { const u = g.uv[i * 2]; assert.ok((u >= f0 - 1e-6 && u <= f1 + 1e-6) || Math.abs(u - T.FIRE_UV.solid) < 1e-6, `u ${u}`); }
  // outside the badge: nothing of the flames inside its rim; behind it (away from the camera) they stand up tall, in
  // front of it they lie low over the floor (below the park camera's angle: they never rise over the badge)
  let backTop = 0, frontTop = 0, frontLean = 0;
  for (let i = 0; i < n; i++) {
    const x = g.position[i * 3], y = g.position[i * 3 + 1], z = g.position[i * 3 + 2], r = Math.hypot(x, z), u = g.uv[i * 2];
    if (u < f0 - 1e-6) continue; // (the glow, the embers)
    assert.ok(r >= ICON_FIRE.r0 - 0.02, `outside the rim (${r.toFixed(3)})`);
    if (z < -0.6 * r) backTop = Math.max(backTop, y);
    if (z > 0.7 * r) { frontTop = Math.max(frontTop, y); if (r > ICON_FIRE.r0 + 0.05) frontLean = Math.max(frontLean, Math.atan2(y - 0.021, r - ICON_FIRE.r0 + 0.015)); }
  }
  assert.ok(backTop > 0.45, `tall behind (${backTop.toFixed(2)} m)`);
  assert.ok(frontTop < 0.15 && frontLean < 0.3, `low in front (${frontTop.toFixed(2)} m, ${frontLean.toFixed(2)} rad)`);
  // updated every way round, igniting, burning, dying: everything finite
  const R = rig(), f = new IconFire(R.r, R.scene);
  for (let i = 0; i < 400; i++) {
    f.update(1 / 60, 2 + Math.sin(i * 0.05), i % 7 === 0 ? 0.8 : 0, -3, i * 0.11, i < 300);
    assert.ok(f.mesh.bones.every(Number.isFinite), 'bones');
    assert.ok(Number.isFinite(f.mat.opacity) && f.mat.opacity >= 0 && f.mat.opacity <= 1, 'opacity');
    assert.ok(f.mat.color.every(Number.isFinite) && f.mat.uvOffset.every(c => Number.isFinite(c) && c >= 0 && c < 1), 'colour and scroll');
  }
  assert.equal(f.visible, false, 'out a while after it stopped');
  // the embers come and go (each one's bone collapses between lives)
  const g2 = new IconFire(R.r, R.scene); let lit = 0, dark = 0;
  for (let i = 0; i < 180; i++) { g2.update(1 / 60, 0, 0, 0, 0, true); const m = g2.mesh.bones.subarray(FIRE_BONES.ember * 16, FIRE_BONES.ember * 16 + 16); if (m.some(x => x !== 0)) lit++; else dark++; }
  assert.ok(lit > 20 && dark > 0, `an ember lives and dies (${lit} lit, ${dark} dark)`);
});

test('it hides with him, is culled with him, and dispose takes it away; on and off again leaks nothing', () => {
  const R = rig(), base = R.scene.meshes.length;
  const v = player(R, icon(12));
  frames(v, 0.5, true);
  const fire = v.icon.fire, geo = fire.mesh.geo, count = R.scene.meshes.length;
  // a team intro hides him (view.visible), the Crew HQ hides you in its games (setHidden), a culled player is left out
  v.view.visible = false; frames(v, 1 / 60, true); assert.equal(fire.visible, false, 'hidden with him');
  v.view.visible = true; frames(v, 0.4, true); assert.equal(fire.visible, true);
  v.setHidden(true); assert.equal(fire.visible, false);
  v.setHidden(false); frames(v, 0.4, true); assert.equal(fire.visible, true);
  v.setCulled(true); assert.equal(fire.mesh.culled, true);
  v.setCulled(false); assert.equal(fire.mesh.culled, false);
  // not there yet (his athlete still being built): nothing under him, the flame neither
  const w = player(R, icon(0)); w.pending = true; frames(w, 0.3, true);
  assert.ok(!w.icon.cursor.mesh.visible && !w.icon.fire, 'nothing while he is not there');
  w.pending = false; w.view = { dispose() {} }; w.pool = null; w.dispose();
  // on and off and on again, a hundred times: the one flame, no more meshes
  for (let i = 0; i < 100; i++) frames(v, 1 / 60 * (1 + (i % 3)), i % 2 === 0);
  assert.equal(v.icon.fire, fire, 'the same flame');
  assert.equal(named(R, 'iconFire').length, 1);
  assert.equal(R.scene.meshes.length, count, 'nothing added');
  // a new badge mid-fire: still one flame
  v.icon.setBuild({ ...icon(12), icon_badge: 'open_arms' }); frames(v, 0.1, true);
  assert.equal(named(R, 'iconFire').length, 1); assert.equal(named(R, 'iconCursor').length, 1);
  // dispose: everything gone, its geometry freed
  v.view = { dispose() {} }; v.pool = null;
  v.dispose(); v.dispose();
  assert.equal(R.scene.meshes.length, base, 'nothing left in the scene');
  assert.ok(R.disposed.includes(geo), 'the flame\'s geometry freed');
  // IconFX on its own too
  const fx = new IconFX(R.r, R.scene, icon(0), { color: '#fff' });
  fx.onFire = true; for (let i = 0; i < 10; i++) fx.place(0, 0, 0, null, false, 1 / 60);
  assert.equal(named(R, 'iconFire').length, 1);
  fx.dispose(); assert.equal(R.scene.meshes.length, base);
  // an aura-only IconFX (no badge) has nothing to set on fire
  const bare = new IconFX(R.r, R.scene, icon(6), { cursor: false });
  bare.onFire = true; for (let i = 0; i < 10; i++) bare.place(0, 0, 0, null, false, 1 / 60);
  assert.equal(bare.fire, null); bare.dispose(); assert.equal(R.scene.meshes.length, base);
});

test('ICON made or lost mid-game: the right one of the two fires', () => {
  const R = rig(), v = player(R, icon(3));
  frames(v, 0.4, true);
  assert.ok(v.icon.fire.visible && !v.fire.visible);
  // (the roam's syncIcon: a build that isn't ICON gets its ring back, and with it the flame icon)
  v.syncIcon(plain(3)); frames(v, 0.1, true);
  assert.equal(v.icon, null); assert.equal(named(R, 'iconFire').length, 0, 'the purple flame went with the badge');
  assert.equal(v.fire.visible, true, 'the flame icon instead');
  v.syncIcon(icon(4)); frames(v, 0.4, true);
  assert.ok(v.icon.fire.visible && !v.fire.visible, 'and back');
  assert.equal(named(R, 'iconFire').length, 1);
});

test('who sees it: every player in your game is shown hot or cold; every human with ICON status has the badge, so burns purple', () => {
  const session = src('game/session.js'), fx = src('game/iconfx.js');
  assert.ok(session.includes('v.setStatus(p.hot, p.cold, dt);'), 'every player in a game gets his status each frame');
  assert.ok(session.includes('if (!opts.background) pv.addStatus(this.r);'), 'in every game on your screen (not the park\'s background games)');
  assert.ok(session.includes("if (p.human) pv.addRing(this.r, this.spectate ? '#f4f2ec' : this.isMe(p) ? '#ffd84a' : p.team === this.game.human?.team ? '#4ac8ff' : '#ff5a6a');"), 'every human (you, teammates, opponents online, watching) goes through addRing: an ICON build gets his badge');
  assert.ok(session.includes('this.fire.visible = !!hot && !burns;'), 'the flame icon only where there is no badge to burn');
  assert.ok(fx.includes("this.tex = cachedTexture(this.ctx, 'iconFire', () => T.iconFireTexture(256), {});"), 'one texture, shared by every flame');
});

test('the flame texture: data (no DOM needed), seamless round the ring and as it scrolls, about half flame', () => {
  const A = T.iconFireTexture(128), W = 128, H = 128, d = A.data;
  assert.equal(d.length, W * H * 4);
  for (let y = 0; y < H; y += 5) assert.equal(d[(y * W + 1) * 4 + 3], 255, 'the solid strip');
  const [u0, u1] = T.FIRE_UV.flames, x0 = Math.round(u0 * W - 0.5), x1 = Math.round(u1 * W - 0.5);
  // the strip's two ends are the same texels: the ring closes without a seam
  let diff = 0; for (let y = 0; y < H; y++) for (let k = 0; k < 4; k++) diff += Math.abs(d[(y * W + x0) * 4 + k] - d[(y * W + x1) * 4 + k]);
  assert.equal(diff, 0, 'no seam round the ring');
  // down the texture: the last row runs into the first as smoothly as any two rows
  const alpha = (x, y) => d[(y * W + x) * 4 + 3];
  let seam = 0, rows = 0; for (let x = x0; x < x1; x++) { seam += Math.abs(alpha(x, H - 1) - alpha(x, 0)); rows += Math.abs(alpha(x, 40) - alpha(x, 41)); }
  assert.ok(seam < rows * 3 + 200, `no seam as it scrolls (${seam} vs ${rows})`);
  let cov = 0; for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) cov += alpha(x, y) / 255;
  cov /= H * (x1 - x0);
  assert.ok(cov > 0.35 && cov < 0.65, `about half flame (${cov.toFixed(2)})`);
  // purple: blue the strongest channel wherever there's flame, and never orange
  for (let y = 0; y < H; y += 3) for (let x = x0; x < x1; x += 3) { const i = (y * W + x) * 4; if (d[i + 3] > 128) assert.ok(d[i + 2] >= d[i + 1] && d[i] > d[i + 1], 'violet'); }
});
