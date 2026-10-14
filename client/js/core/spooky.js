// v0.4.8.5 quick patch 2: The Monster Mash's ambience: a few quiet procedural sounds for its park life and events (thunder
// with the lightning, a wolf's howl, an owl, the cemetery gate creaking, the church bell, a ghost's moan, distant screams,
// an organ chord, a witch's cackle, the zombie troupe's little groove). WebAudio through the game's sfx bus (so the sfx
// volume and mute apply), kept low and rare so they never get in the way of the game's own sounds. Nothing plays until
// the page has been clicked (audio.ensure).
import { audio } from './audio.js';

export const SPOOKY = { level: 0.55, min: { owl: 35, creak: 25, howl: 18, moan: 12 } };
const last = {};
// rate-limit the ambient ones (seconds between two of the same kind)
const ok = (kind, gap = SPOOKY.min[kind] || 0) => { const t = performance.now() / 1000; if (last[kind] && t - last[kind] < gap) return false; last[kind] = t; return audio.ensure?.() && !!audio.ctx; };
const bus = (pan = 0, v = 1) => { const c = audio.ctx, g = c.createGain(); g.gain.value = SPOOKY.level * v; const p = c.createStereoPanner ? c.createStereoPanner() : null; if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(audio.sfx); } else g.connect(audio.sfx); return g; };
const env = (g, t, a, peak, d, hold = 0) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); if (hold) g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d); };

// thunder: a crack (for a near strike) and a long low roll; delay: seconds after the flash (distance / 340)
export function thunder(delay = 1, near = 0.5, pan = 0) {
  if (!ok('thunder', 0.5)) return;
  const c = audio.ctx, t = c.currentTime + delay, out = bus(pan, 0.9);
  const n = audio.noise(), lp = c.createBiquadFilter(), g = c.createGain();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(240 + near * 500, t); lp.frequency.exponentialRampToValueAtTime(70, t + 3.5);
  env(g, t, 0.05 + (1 - near) * 0.4, 0.5, 3.6);
  n.connect(lp); lp.connect(g); g.connect(out); n.start(t); n.stop(t + 4.4);
  if (near > 0.4) { const n2 = audio.noise(), hp = c.createBiquadFilter(), g2 = c.createGain(); hp.type = 'bandpass'; hp.frequency.value = 1400; hp.Q.value = 0.6; env(g2, t, 0.004, 0.32 * near, 0.25); n2.connect(hp); hp.connect(g2); g2.connect(out); n2.start(t); n2.stop(t + 0.4); }
  // a second, softer rumble a little later
  const n3 = audio.noise(), lp3 = c.createBiquadFilter(), g3 = c.createGain(); lp3.type = 'lowpass'; lp3.frequency.value = 110; env(g3, t + 1.1, 0.4, 0.28, 2.4); n3.connect(lp3); lp3.connect(g3); g3.connect(out); n3.start(t + 1.1); n3.stop(t + 4.2);
}
// a wolf's howl: a breathy tone rising, holding with vibrato, falling away
export function howl(dist = 1, pan = 0) {
  if (!ok('howl')) return;
  const c = audio.ctx, t = c.currentTime, out = bus(pan, 0.5 / Math.max(1, dist));
  for (const [mul, v] of [[1, 1], [2.01, 0.25], [3.02, 0.08]]) {
    const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(330 * mul, t); o.frequency.exponentialRampToValueAtTime(560 * mul, t + 0.9); o.frequency.setValueAtTime(560 * mul, t + 1.9); o.frequency.exponentialRampToValueAtTime(380 * mul, t + 2.9);
    lfo.frequency.value = 5.5; lg.gain.value = 9 * mul; lfo.connect(lg); lg.connect(o.frequency);
    env(g, t, 0.5, 0.16 * v, 1.9, 0.9);
    o.connect(g); g.connect(out); o.start(t); lfo.start(t); o.stop(t + 3.4); lfo.stop(t + 3.4);
  }
  const n = audio.noise(), bp = c.createBiquadFilter(), ng = c.createGain(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 3; env(ng, t, 0.5, 0.04, 2.2, 0.6); n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 3.4);
}
// an owl: two soft hoots
export function owl(pan = 0) {
  if (!ok('owl')) return;
  const c = audio.ctx, out = bus(pan, 0.35);
  [[0, 0.32], [0.55, 0.6]].forEach(([dt, len]) => { const t = c.currentTime + dt, o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(400, t); o.frequency.linearRampToValueAtTime(370, t + len); env(g, t, 0.06, 0.2, len); o.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.2); });
}
// a creaking gate: a slow scratchy glide
export function creak(pan = 0, v = 0.5) {
  if (!ok('creak')) return;
  const c = audio.ctx, t = c.currentTime, out = bus(pan, v), o = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(140, t + 0.7); o.frequency.linearRampToValueAtTime(70, t + 1.4);
  const am = c.createOscillator(), ag = c.createGain(); am.type = 'square'; am.frequency.value = 23; ag.gain.value = 0.5; am.connect(ag); ag.connect(g.gain);
  bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 4; env(g, t, 0.15, 0.12, 1.2, 0.2);
  o.connect(bp); bp.connect(g); g.connect(out); o.start(t); am.start(t); o.stop(t + 1.7); am.stop(t + 1.7);
}
// the church bell: n slow tolls (inharmonic partials, long decay)
export function bell(n = 3, pan = 0) {
  if (!ok('bell', 4)) return;
  const c = audio.ctx, out = bus(pan, 0.45);
  for (let k = 0; k < n; k++) { const t = c.currentTime + k * 2.2; for (const [f, a, d] of [[196, 1, 4.5], [392 * 1.19, 0.5, 3], [196 * 2.76, 0.32, 2.2], [196 * 5.4, 0.12, 1.2]]) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; env(g, t, 0.01, 0.2 * a, d); o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.1); } }
}
// a ghost's moan: a hollow "oooo" sliding up and down
export function moan(pan = 0, v = 0.4) {
  if (!ok('moan')) return;
  const c = audio.ctx, t = c.currentTime, out = bus(pan, v), o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
  o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(330, t + 1.2); o.frequency.exponentialRampToValueAtTime(200, t + 2.8);
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 4.2; lg.gain.value = 7; lfo.connect(lg); lg.connect(o.frequency);
  lp.type = 'lowpass'; lp.frequency.value = 900; env(g, t, 0.6, 0.18, 1.8, 0.6);
  o.connect(lp); lp.connect(g); g.connect(out); o.start(t); lfo.start(t); o.stop(t + 3.2); lfo.stop(t + 3.2);
}
// distant screams (the teens in the chase): a few short high glides, far off
export function screams(n = 3, pan = 0) {
  if (!ok('scream', 2)) return;
  const c = audio.ctx, out = bus(pan, 0.22);
  for (let k = 0; k < n; k++) { const t = c.currentTime + k * 0.38 + Math.random() * 0.15, f = 900 + Math.random() * 500, o = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.35, t + 0.12); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.6); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2; env(g, t, 0.03, 0.12, 0.5); o.connect(bp); bp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.7); }
}
// a haunted organ: a minor chord swelling and dying away
export function organ(pan = 0) {
  if (!ok('organ', 3)) return;
  const c = audio.ctx, t = c.currentTime, out = bus(pan, 0.35), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.connect(out);
  for (const k of [0, 3, 7, 12, -12]) for (const det of [-3, 3]) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = 146.8 * Math.pow(2, k / 12); o.detune.value = det; env(g, t, 0.25, 0.035, 2.2, 1.0); o.connect(g); g.connect(lp); o.start(t); o.stop(t + 3.6); }
}
// a witch's cackle: quick "ha"s falling in pitch
export function cackle(pan = 0) {
  if (!ok('cackle', 4)) return;
  const c = audio.ctx, out = bus(pan, 0.3);
  for (let k = 0; k < 7; k++) { const t = c.currentTime + k * 0.13, f = 980 - k * 60, o = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter(); o.type = 'square'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.1); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 3; env(g, t, 0.01, 0.12, 0.09); o.connect(bp); bp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.14); }
}
// a groan from the graves
export function groan(pan = 0) {
  if (!ok('groan', 3)) return;
  const c = audio.ctx, t = c.currentTime, out = bus(pan, 0.3), o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(75, t + 1.6);
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(600, t + 0.6); lp.frequency.linearRampToValueAtTime(250, t + 1.6);
  env(g, t, 0.3, 0.2, 1.3); o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + 1.8);
}
// the zombie troupe's groove: a walking bass and finger snaps at bpm for dur seconds (quiet; the park's own sounds win)
export function groove(bpm = 112, dur = 18) {
  if (!ok('groove', 10)) return;
  const c = audio.ctx, beat = 60 / bpm, t0 = c.currentTime + 0.05, out = bus(0, 0.5), notes = [0, 0, 3, 5, 7, 5, 3, -2];
  for (let i = 0; i * beat < dur; i++) {
    const t = t0 + i * beat, f = 55 * Math.pow(2, notes[i % 8] / 12), o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'square'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 420; env(g, t, 0.01, 0.16, beat * 0.8); o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + beat);
    if (i % 2) { const n = audio.noise(), bp = c.createBiquadFilter(), ng = c.createGain(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.5; env(ng, t, 0.002, 0.14, 0.06); n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.1); }
    if (i % 8 === 0) { for (const k of [0, 3, 7]) { const o2 = c.createOscillator(), g2 = c.createGain(); o2.type = 'triangle'; o2.frequency.value = 220 * Math.pow(2, k / 12); env(g2, t, 0.02, 0.05, beat * 3); o2.connect(g2); g2.connect(out); o2.start(t); o2.stop(t + beat * 3.2); } }
  }
}
