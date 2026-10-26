// v0.4.8.9 qp15: the PC dragging with the game open.
//  * The main loop is paced (core/pacing.js): capped in front (60 by default), a trickle in the background (30 while a
//    game is on, 10 otherwise), unless Settings → In the background is Full speed. RIMRIFT.exe turns the browser's own
//    background throttling off, so this is the only thing that slows the game down when you click away.
//  * The renderer uploads a skeleton's bone palette once per program and frame, not once per mesh and pass.
//  * The graphics preset is picked for the PC on a first run (it never was), and once for saves left on High unchosen.
//  * Textures nobody's using are let go after 20 s in the background and cut to a small budget after 90 s in the menus.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Pacer, targetFps, FPS_CAPS, BG_IDLE_FPS, BG_LIVE_FPS } from '../client/js/core/pacing.js';
import { Renderer } from '../client/js/gfx/renderer.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the frame rate: the cap in front, a trickle in the background, full speed when asked', () => {
  assert.equal(targetFps({ cap: 60 }), 60);
  assert.equal(targetFps({ cap: 0 }), 0, 'match the display');
  assert.equal(targetFps({ cap: '144' }), 144);
  assert.equal(targetFps({ background: true, cap: 0 }), BG_IDLE_FPS);
  assert.equal(targetFps({ background: true, live: true, cap: 144 }), BG_LIVE_FPS, 'a game in progress keeps playing');
  assert.equal(targetFps({ background: true, bgMode: 'full', cap: 0 }), 0);
  assert.deepEqual(FPS_CAPS.map(c => c[0]), [0, 30, 60, 120, 144]);
});

const run = (hz, fps, secs = 10, p = new Pacer()) => { let n = 0; for (let t = 0; t < secs * 1000; t += 1000 / hz) if (p.due(t, fps)) n++; return n / secs; };
test('the pacer keeps the average on the cap at any refresh rate, and switching rates starts at once', () => {
  for (const hz of [60, 75, 120, 144, 165, 240]) {
    const got = run(hz, 60);
    assert.ok(Math.abs(got - Math.min(60, hz)) <= 2.5, `${hz} Hz → ${got}`);
  }
  assert.ok(Math.abs(run(144, 10) - 10) <= 1);
  assert.equal(run(144, 0), 144);
  const p = new Pacer();
  assert.ok(p.due(0, 10)); assert.ok(!p.due(50, 10));
  assert.ok(p.due(51, 60), 'back in front: the first frame runs now, not when the slow beat was due');
});

test('a bone palette goes up once per skeleton, program and frame; a new frame uploads again', () => {
  let bones = 0, models = 0, draws = 0;
  const uniforms = { uModel: { loc: 1 }, uBones: { loc: 2 } };
  const prog = { uniforms };
  const ctx = { use() {}, set(p, name) { if (name === 'uBones') bones++; if (name === 'uModel') models++; }, draw() { draws++; } };
  const gl = new Proxy({}, { get: () => () => {} });
  const r = Object.create(Renderer.prototype);
  Object.assign(r, { gl, ctx, programFor: () => prog, frameUniforms() {}, materialUniforms() {} });
  const mat = { depthWrite: true, depthTest: true }, skel = new Float32Array(24 * 16);
  const person = Array.from({ length: 12 }, () => ({ material: mat, bones: skel }));
  const prop = { material: mat, matrix: new Float32Array(16) };
  r.renderStamp = 1;
  r.drawList([...person, prop], {}, null, 'main');
  assert.equal(bones, 1, 'twelve meshes, one skeleton: one upload');
  assert.equal(models, 2, 'the skinned meshes share the identity model matrix; the prop has its own');
  assert.equal(draws, 13);
  r.drawList(person, {}, null, 'reflect');
  assert.equal(bones, 1, 'the same program later in the frame still has it');
  r.renderStamp = 2;
  r.drawList(person, {}, null, 'main');
  assert.equal(bones, 2, 'next frame: the pose moved, it goes up again');
  assert.match(src('client/js/gfx/renderer.js'), /this\.renderStamp = \(this\.renderStamp \|\| 0\) \+ 1;/);
});

test('the main loop is paced; the graphics are picked for the PC; textures are let go when nobody needs them', () => {
  const main = src('client/js/main.js');
  assert.match(main, /if \(!pacer\.due\(now, targetFps\(\{ background: bg, live: liveGame\(\), bgMode: settings\.bgMode, cap: settings\.fpsCap \}\)\)\) \{ requestAnimationFrame\(loop\); return; \}/);
  assert.match(main, /now - bgSince > 20000 && settings\.bgMode !== 'full'\) \{ bgTrimmed = true; try \{ trimCaches\(app\.renderer\.ctx, 0\);/);
  assert.match(main, /now - menuSince > 90000\) \{ menuTrimmed = true; try \{ trimCaches\(app\.renderer\.ctx, MENU_KEEP\);/);
  assert.match(main, /if \(FIRST_RUN\) \{ settings\.quality = autoQuality\(app\.renderer\);/);
  assert.match(main, /if \(!settings\.qualityChosen && settings\.quality === 'high' && pick !== 'high'\)/);
  const st = src('client/js/core/settings.js');
  assert.ok(st.indexOf('export const FIRST_RUN') < st.indexOf('if (!settings.v045)'), 'asked before the one-time switches save anything');
  assert.match(st, /fpsCap: 60, bgMode: 'save'/);
  assert.match(src('client/js/ui/screens.js'), /if \(k === 'quality'\) settings\.qualityChosen = true;/);
  assert.match(src('client/js/game/park.js'), /this\.app\?\.inBackground \? 1 : 2\.6/);
});

test('the graphics pick: built-in AMD graphics count as built-in', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  const { autoQuality } = await import('../client/js/core/settings.js');
  const pick = name => autoQuality({ gl: { getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }), getParameter: () => name } });
  assert.equal(pick('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'medium');
  assert.equal(pick('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'medium');
  assert.equal(pick('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.equal(pick('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.equal(pick('Google SwiftShader'), 'low');
});
