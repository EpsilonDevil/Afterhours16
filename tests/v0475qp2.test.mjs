// v0.4.7.5 quick patch (the last of it): twice the green releases (32 sounds, 28 effects), and every sound remade to
// sound like its name: rendered sample by sample (core/sfx.js) and checked here by what's in it (pitch, bands,
// rhythm), the same way they were tuned (spectrograms).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GREEN_SOUNDS, GREEN_SOUND_IDS, renderGreen, greenRecipe } from '../client/js/core/greensound.js';
import { GREEN_FX, GREEN_FX_IDS, GreenFxRunner } from '../client/js/game/greenfx.js';
import { Synth, reverb } from '../client/js/core/sfx.js';

const SR = 44100;
const cat = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url), 'utf8'));
const greens = cat.filter(i => i.category === 'green');

// ---- a little spectrum analysis ----
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const k = i + j + len / 2, vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - vr; im[k] = im[i + j] - vi; re[i + j] += vr; im[i + j] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// the power spectrum summed over t0..t1 seconds
function spectrum(x, t0, t1, N = 2048) {
  const P = new Float64Array(N / 2);
  for (let s = Math.round(t0 * SR); s + N <= Math.min(x.length, Math.round(t1 * SR)); s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  return P;
}
const hzOf = (k, N = 2048) => k * SR / N;
const band = (P, lo, hi) => { let a = 0, b = 0; P.forEach((p, k) => { const f = hzOf(k); if (f < 80) return; b += p; if (f >= lo && f < hi) a += p; }); return a / b; };
const peakHz = (P, lo = 80, hi = 20000) => { let best = 0, bk = 0; P.forEach((p, k) => { const f = hzOf(k); if (f >= lo && f < hi && p > best) { best = p; bk = k; } }); return hzOf(bk); };
const centroid = (P, lo = 300) => { let a = 0, b = 0; P.forEach((p, k) => { const f = hzOf(k); if (f >= lo) { a += f * p; b += p; } }); return a / b; };
const rms = (x, t0, t1) => { let s = 0, n = 0; for (let i = Math.round(t0 * SR); i < Math.min(x.length, Math.round(t1 * SR)); i++) { s += x[i] * x[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };

const R = {};
const sound = id => (R[id] || (R[id] = { x: renderGreen(id), st: renderGreen.stats }));

test('twice the green releases: 32 sounds and 28 effects, in the code and in the store', () => {
  assert.equal(GREEN_SOUND_IDS.length, 32);
  assert.equal(GREEN_FX_IDS.length, 28);
  const snd = greens.filter(i => i.slot === 'greensound'), fx = greens.filter(i => i.slot === 'greenfx');
  assert.equal(snd.length, 32); assert.equal(fx.length, 28);
  for (const i of snd) { assert.equal(GREEN_SOUNDS[i.id], i.name, i.id); assert.ok(greenRecipe(i.id), i.id); }
  for (const i of fx) assert.equal(GREEN_FX[i.id], i.name, i.id);
  const fresh = greens.filter(i => i.v0475qp);
  assert.equal(fresh.length, 30);
  assert.ok(fresh.every(i => i.price >= 3500 && i.price <= 12000 && !i.exclusive && i.description.length > 30 && i.original_2k_asset === false));
  assert.equal(new Set(greens.map(i => i.name.toLowerCase())).size, greens.length, 'every name its own');
  for (const i of greens) assert.doesNotMatch(i.name + i.description, /giant|\b2k\b|\bnba\b/i);
});

test('every green sound comes out at the same loudness, never clipping, and never runs long', () => {
  for (const id of GREEN_SOUND_IDS) {
    const { x, st } = sound(id);
    assert.ok(x.every(Number.isFinite), id);
    assert.ok(st.loud > 0.058 && st.loud < 0.095, `${id} loudness ${st.loud.toFixed(3)}`);
    assert.ok(st.peak <= 0.951, `${id} peak ${st.peak}`);
    assert.ok(st.dur >= 0.6 && st.dur <= 4.21, `${id} ${st.dur.toFixed(2)} s`);
  }
});

test('the eagle screams like a raptor: high and piercing, harsh, falling away at the end, and ringing off the canyon', () => {
  const { x } = sound('gsnd_eagle');
  const hold = spectrum(x, 0.1, 1.15), late = spectrum(x, 1.15, 1.42);
  assert.ok(band(hold, 1500, 7500) > 0.8, `the scream lives in 1.5-7.5 kHz (${band(hold, 1500, 7500).toFixed(2)})`);
  const f0 = peakHz(hold, 1500, 3500), f1 = peakHz(late, 900, 3500);
  assert.ok(f0 > 2100 && f0 < 2800, `held around 2.4 kHz (${f0.toFixed(0)})`);
  assert.ok(f1 < f0 * 0.88, `and it falls (${f0.toFixed(0)} -> ${f1.toFixed(0)})`);
  // harsh, not a whistle: plenty of energy between the harmonics of the held scream
  let between = 0, on = 0;
  hold.forEach((p, k) => { const f = hzOf(k); if (f < 1500 || f > 7500) return; const h = f / f0, d = Math.abs(h - Math.round(h)); if (d > 0.2 && d < 0.8) between += p; else on += p; });
  assert.ok(between / on > 0.04, `raspy (${(between / on).toFixed(3)})`);
  // the echoes keep it going after he's done
  assert.ok(rms(x, 1.6, 2.0) > rms(x, 0.2, 1.0) * 0.05, 'the canyon throws it back');
});

test('and the rest sound like what they are called', () => {
  // an owl hoots low (under 1 kHz), crickets aside
  { const P = spectrum(sound('gsnd_owl').x, 0.02, 0.15); assert.ok(band(P, 80, 1000) > 0.8, `owl ${band(P, 80, 1000).toFixed(2)}`); }
  // a wolf's howl climbs to ~700 Hz
  { const f = peakHz(spectrum(sound('gsnd_wolf').x, 0.6, 1.0), 300, 1200); assert.ok(f > 620 && f < 800, `wolf ${f}`); }
  // the sonar ping: one pure tone near 1.46 kHz
  { const P = spectrum(sound('gsnd_sonar').x, 0, 0.12), f = peakHz(P); assert.ok(Math.abs(f - 1460) < 40, `sonar ${f}`); assert.ok(band(P, 1350, 1580) > 0.85); }
  // the cuckoo: a high note, then a major third down
  { const x = sound('gsnd_cuckoo').x, a = peakHz(spectrum(x, 0.08, 0.18), 500, 1500), b = peakHz(spectrum(x, 0.26, 0.4), 500, 1500); assert.ok(Math.abs(a - 880) < 30 && Math.abs(b - 698) < 30, `cuckoo ${a} ${b}`); }
  // the slide whistle slides up
  { const x = sound('gsnd_slide').x, a = peakHz(spectrum(x, 0.0, 0.08), 300, 3000), b = peakHz(spectrum(x, 0.36, 0.44), 300, 3000); assert.ok(a < 800 && b > 1700, `slide ${a} -> ${b}`); }
  // the siren winds up
  { const x = sound('gsnd_siren').x, a = peakHz(spectrum(x, 0.05, 0.15), 100, 2000), b = peakHz(spectrum(x, 0.95, 1.3), 100, 2000); assert.ok(a < 500 && b > 850, `siren ${a} -> ${b}`); }
  // thunder rolls low after the crack
  { const P = spectrum(sound('gsnd_thunder').x, 0.5, 2.5); assert.ok(band(P, 80, 600) > 0.6, `thunder ${band(P, 80, 600).toFixed(2)}`); }
  // the bass drop drops: low end after the build
  { const P = spectrum(sound('gsnd_bassdrop').x, 0.9, 1.6); assert.ok(band(P, 80, 400) > 0.5, `drop ${band(P, 80, 400).toFixed(2)}`); }
  // the air horn: short, short, long (two gaps in the first half second)
  { const x = sound('gsnd_airhorn').x, lv = t => rms(x, t, t + 0.02), top = lv(0.08); assert.ok(lv(0.205) < top * 0.35 && lv(0.3) > top * 0.7 && lv(0.45) < top * 0.35 && lv(0.8) > top * 0.7, 'short, short, loooong'); }
  // the chant is voices (the band a crowd sings in)
  { const P = spectrum(sound('gsnd_chant').x, 0.1, 0.9); assert.ok(band(P, 120, 3500) > 0.75, `chant ${band(P, 120, 3500).toFixed(2)}`); }
  // knocks are sharp: the gavel and the rimshot hit hard and short
  for (const id of ['gsnd_gavel', 'gsnd_rimshot']) { const x = sound(id).x; let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); assert.ok(pk / rms(x, 0, x.length / SR) > 5, `${id} crest`); }
  // bells and gongs ring on
  for (const id of ['gsnd_gong', 'gsnd_bells', 'gsnd_ringbell']) { const x = sound(id).x; assert.ok(rms(x, 1.8, 2.2) > rms(x, 0, 0.4) * 0.08, `${id} rings`); }
  // glass, coins and cymbals live up high; a gong lives low
  assert.ok(band(spectrum(sound('gsnd_glass').x, 0, 0.6), 2500, 12000) > 0.6);
  assert.ok(centroid(spectrum(sound('gsnd_gong').x, 0, 1.5)) < centroid(spectrum(sound('gsnd_ringbell').x, 0, 1.5)));
});

test('the synth: each AI tempo stretches a sound, renders are deterministic per seed, the room decays', () => {
  const a = renderGreen('gsnd_cuckoo', { ts: 1 }), b = renderGreen('gsnd_cuckoo', { ts: 1.2 });
  assert.ok(b.length > a.length * 1.1, 'slower tempo, longer sound');
  const c1 = renderGreen('gsnd_duck', { seed: 7 }), c2 = renderGreen('gsnd_duck', { seed: 7 });
  assert.deepEqual(c1, c2);
  const imp = new Float32Array(100); imp[0] = 1;
  const w = reverb(imp, 100, SR, { decay: 1 });
  const e = (t0, t1) => { let s = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) s += w[i] * w[i]; return s; };
  assert.ok(e(0.55, 0.65) < e(0.05, 0.15) * 0.05, 'the room dies away');
  const D = new Synth({ seed: 3 }); D.maxLen = 1; D.modes(0, [[440, 1, 5]]); const x = D.render();
  assert.ok(x.length <= SR * 1.001, 'nothing runs past its longest');
});

test('sounds render off the main thread, ahead of the game; the new effects are light and follow him', () => {
  const wk = fs.readFileSync(new URL('../client/js/core/greenworker.js', import.meta.url), 'utf8');
  assert.ok(wk.includes("import { renderGreen } from './greensound.js'") && wk.includes('postMessage({ key, x }, x ? [x.buffer] : [])'));
  const gs = fs.readFileSync(new URL('../client/js/core/greensound.js', import.meta.url), 'utf8');
  assert.ok(gs.includes("new Worker(new URL('./greenworker.js', import.meta.url), { type: 'module' })"));
  const ss = fs.readFileSync(new URL('../client/js/game/session.js', import.meta.url), 'utf8');
  assert.ok(ss.includes('warmGreenSounds(audio, this.game.players'));
  for (const id of GREEN_FX_IDS) {
    let live = [], peak = 0;
    const ps = { emit(o) { const q = { ...o, age: 0 }; live.push(q); return q; }, burst(x, y, z, n, o) { for (let k = 0; k < n; k++) live.push({ x, y, z, life: o?.life || 0.8, age: 0 }); } };
    const r = new GreenFxRunner(ps, { view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    let hx = 0;
    const held = [];
    r.play(id, () => [hx, 2.1, 0], () => [hx, 0, 0], 1.22);
    held.push(...live.filter(q => q.hold));
    for (let f = 0; f < 180; f++) { r.tick(1 / 60); hx += 0.02; for (const q of live) q.age += 1 / 60; live = live.filter(q => q.age < q.life); peak = Math.max(peak, live.length); }
    assert.ok(peak < 1200, `${id} at most ${peak} at once`);
    assert.equal(r.jobs.length, 0, `${id} finishes`);
  }
});
