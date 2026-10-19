// v0.4.8.7 polish: the Favelas' event sounds, synthesized (no recordings): the police siren (two-tone, carried by the police
// bike in the chase and by the officers in the foot chase: distance-attenuated, panned, its pitch bent as it comes and
// goes and muffled with distance) and the bateria's drums (surdo, caixa, tamborim on a samba pattern, coming down the
// street with the drummers). WebAudio through the game's sfx bus, like the Monster Mash's ambience (spooky.js): the SFX
// slider and mute apply, nothing is made when SFX is off or before the page has been clicked (audio.ensure), and the
// level sits at or under the park ambience's (SPOOKY.level). Each sound is a handle the event moves every frame:
// update(dt, x, z) and stop(); a handle that stops being updated (the park was left) stops itself.
import { audio } from './audio.js';
import { SPOOKY } from './spooky.js';

export const FAVELA_SOUND = { level: Math.min(0.5, SPOOKY.level), ref: 14, far: 150, siren: { hi: 940, lo: 740, half: 0.46, peak: 0.12 }, bpm: 126, drums: { surdo: 0.2, caixa: 0.07, tamborim: 0.06 }, watchdog: 2.5 };
const FS = FAVELA_SOUND;
// the handles alive (the tests count their nodes)
export const live = new Set();
// can a sound play now: unlocked, a context, SFX on and not muted
export const ready = () => !!(audio.ensure?.() && audio.ctx && audio.sfx) && !audio.muted && (audio.volume?.sfx ?? 1) > 0;
// the listener: the player when roaming (the scene's shadow focus follows them), else the middle of what the camera shows
const ear = scene => scene?.shadowFocus?.center || [0, 0, 0];
// distance gain: 1 within ref, 1/d after it, gone past far (eased out over the last 30 m)
export function attenuation(d) { return d >= FS.far ? 0 : Math.min(1, FS.ref / Math.max(1e-3, d)) * Math.min(1, (FS.far - d) / 30); }
// the pan: the cameras look north (+z), so the listener's right is −x
export const panOf = (x, z, L) => { const dx = x - L[0], dz = z - L[2], d = Math.hypot(dx, dz) || 1; return Math.max(-0.85, Math.min(0.85, -dx / d * 0.85)); };
// the Doppler factor for a source closing (vr < 0) or going away (vr > 0) at vr m/s, held to a sensible range
export const doppler = vr => Math.max(0.86, Math.min(1.16, 343 / (343 + vr)));

// a positioned voice: out (what the sound feeds) → distance gain → muffle → pan → the sfx bus; the handle's plumbing
function voice(scene, kind) {
  const c = audio.ctx, nodes = [], made = n => (nodes.push(n), n);
  const lp = made(c.createBiquadFilter()), g = made(c.createGain()), pan = c.createStereoPanner ? made(c.createStereoPanner()) : null;
  lp.type = 'lowpass'; lp.frequency.value = 4000; g.gain.value = 0;
  lp.connect(g); if (pan) { g.connect(pan); pan.connect(audio.sfx); } else g.connect(audio.sfx);
  const sources = [];
  const h = {
    kind, nodes, sources, out: lp, stopped: false, d: null, vr: 0, gain: 0, last: performance.now(),
    made, src(n) { sources.push(made(n)); return n; },
    // place it: distance and pan from the listener, the radial speed for the Doppler bend (smoothed)
    place(dt, x, z, v = 1) {
      h.last = performance.now();
      const L = ear(scene), d = Math.hypot(x - L[0], z - L[2]), t = c.currentTime;
      if (h.d != null && dt > 0) h.vr += ((d - h.d) / dt - h.vr) * Math.min(1, dt * 4);
      h.d = d; h.gain = FS.level * v * attenuation(d);
      g.gain.setTargetAtTime(h.gain, t, 0.08);
      lp.frequency.setTargetAtTime(700 + 5200 * Math.min(1, FS.ref / Math.max(FS.ref, d)), t, 0.1);
      if (pan) pan.pan.setTargetAtTime(panOf(x, z, L), t, 0.08);
    },
    stop(fade = 0.6) {
      if (h.stopped) return; h.stopped = true; live.delete(h); clearInterval(h.dog);
      const t = c.currentTime; g.gain.cancelScheduledValues?.(t); g.gain.setTargetAtTime(0, t, fade / 4);
      for (const s of sources) { try { s.stop(t + fade + 0.05); } catch (e) { /* already stopped */ } }
    },
  };
  // (the watchdog: no update for a while — the park was left mid-event — and it fades out by itself)
  h.dog = setInterval(() => { if (performance.now() - h.last > FS.watchdog * 1000) h.stop(); }, 400); h.dog?.unref?.();
  live.add(h);
  return h;
}

// the police siren: two tones alternating (hi, lo), a square through the muffle. Returns null when it can't play
export function siren(scene, v = 1) {
  if (!ready()) return null;
  const c = audio.ctx, S = FS.siren, h = voice(scene, 'siren');
  const o = h.src(c.createOscillator()), o2 = h.src(c.createOscillator()), tone = h.made(c.createGain());
  o.type = 'square'; o2.type = 'triangle'; o2.detune.value = 5; tone.gain.value = S.peak;
  o.connect(tone); o2.connect(tone); tone.connect(h.out);
  let next = c.currentTime, hi = true;
  const t0 = c.currentTime + 0.02; o.start(t0); o2.start(t0);
  const place = h.place;
  h.update = (dt, x, z) => {
    if (h.stopped) return;
    place(dt, x, z, v);
    // the tones, scheduled a little ahead; the Doppler bend as a detune over them
    const now = c.currentTime;
    if (next < now) next = now;
    while (next < now + 0.25) { const f = hi ? S.hi : S.lo; o.frequency.setValueAtTime(f, next); o2.frequency.setValueAtTime(f, next); hi = !hi; next += S.half; }
    const cents = 1200 * Math.log2(doppler(h.vr));
    o.detune.setTargetAtTime(cents, now, 0.05); o2.detune.setTargetAtTime(cents + 5, now, 0.05);
  };
  return h;
}

// the bateria: the surdo's low thump (the strong one on the 2, a lighter one on the 1, a pickup now and then), the caixa's
// sixteenths with their accents, the tamborim's syncopated line; three steady voices whose envelopes are scheduled a beat
// ahead. Returns null when it can't play
export const BATERIA = {
  // sixteenths in a bar of 2/4 (8): surdo (0 none, 1 light, 2 strong), caixa accents (0 ghost, 1 normal, 2 accent), tamborim (1 hit)
  surdo: [1, 0, 0, 0, 2, 0, 0, 0], surdoAlt: [1, 0, 0, 0, 2, 0, 1, 1],
  caixa: [2, 0, 1, 2, 1, 0, 2, 1],
  tamborim: [1, 0, 1, 1, 0, 1, 1, 0],
};
export function bateria(scene, v = 1) {
  if (!ready()) return null;
  const c = audio.ctx, D = FS.drums, h = voice(scene, 'bateria'), s16 = 60 / FS.bpm / 4;
  // the surdo: a sine with a falling pitch through its own envelope
  const so = h.src(c.createOscillator()), sg = h.made(c.createGain()); so.type = 'sine'; so.frequency.value = 62; sg.gain.value = 0; so.connect(sg); sg.connect(h.out);
  // the caixa: noise through a band (the snares) into its envelope; the tamborim: noise high up, short and bright
  const cn = h.src(audio.noise()), cb = h.made(c.createBiquadFilter()), cg = h.made(c.createGain()); cb.type = 'bandpass'; cb.frequency.value = 2600; cb.Q.value = 0.9; cg.gain.value = 0; cn.connect(cb); cb.connect(cg); cg.connect(h.out);
  const tn = h.src(audio.noise()), tb = h.made(c.createBiquadFilter()), tg = h.made(c.createGain()); tb.type = 'bandpass'; tb.frequency.value = 5200; tb.Q.value = 2.2; tg.gain.value = 0; tn.connect(tb); tb.connect(tg); tg.connect(h.out);
  const to = h.src(c.createOscillator()), tog = h.made(c.createGain()); to.type = 'triangle'; to.frequency.value = 880; tog.gain.value = 0; to.connect(tog); tog.connect(h.out);
  const t0 = c.currentTime + 0.05; for (const s of h.sources) s.start(t0);
  let next = t0, step = 0, bar = 0;
  const hit = (g, t, peak, decay) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.004); g.gain.setTargetAtTime(0.0001, t + 0.006, decay); };
  const place = h.place;
  h.steps = 0;
  h.update = (dt, x, z) => {
    if (h.stopped) return;
    place(dt, x, z, v);
    const now = c.currentTime; if (next < now) next = now + 0.01;
    while (next < now + 0.2) {
      const i = step % 8, sur = (bar % 4 === 3 ? BATERIA.surdoAlt : BATERIA.surdo)[i], cx = BATERIA.caixa[i], tm = BATERIA.tamborim[i];
      if (sur) { const t = next; so.frequency.setValueAtTime(sur === 2 ? 74 : 92, t); so.frequency.exponentialRampToValueAtTime(sur === 2 ? 46 : 60, t + 0.18); hit(sg, t, D.surdo * (sur === 2 ? 1 : 0.55), sur === 2 ? 0.16 : 0.09); }
      hit(cg, next, D.caixa * [0.35, 0.7, 1][cx], 0.025);
      if (tm && bar % 2 === 0) { hit(tg, next, D.tamborim, 0.018); hit(tog, next, D.tamborim * 0.5, 0.02); }
      next += s16; step++; h.steps++; if (step % 8 === 0) bar++;
    }
  };
  return h;
}
// everything still playing stops (the tests; a venue teardown)
export function stopAll() { for (const h of [...live]) h.stop(0.05); }
