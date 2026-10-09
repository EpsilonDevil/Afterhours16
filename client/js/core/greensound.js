// v0.4.7.5 green release sounds: what plays when a green (Excellent) release goes in. All synthesized at play time
// with Web Audio (no samples, nothing to download). Every recipe takes:
//   pitch: a multiplier on every frequency, rate: a multiplier on the tempo (each AI player has his own pair, so no
//   two of them sound alike), power: weight for threes and big shots (louder, with an extra layer), pan, vol.
// Each play also varies a touch on its own, so the same sound never repeats exactly.
export const GREEN_SOUNDS = {
  gsnd_basic: 'Classic Chime',
  gsnd_eagle: 'Eagle Screech',
  gsnd_chant: 'Greeen Chant',
  gsnd_register: 'Cha-Ching',
  gsnd_airhorn: 'Air Horn',
  gsnd_jackpot: 'Jackpot',
  gsnd_duck: 'Rubber Duck',
  gsnd_laser: 'Laser Blast',
  gsnd_gong: 'Big Gong',
  gsnd_levelup: 'Level Up',
  gsnd_thunder: 'Thunderclap',
  gsnd_kazoo: 'Kazoo Charge',
  gsnd_choir: 'Heavenly Choir',
  gsnd_splash: 'Cannonball',
  gsnd_slide: 'Slide Whistle',
  cup_gsnd_pharaoh: "Pharaoh's Horn",
};
export const GREEN_SOUND_IDS = Object.keys(GREEN_SOUNDS);

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note → Hz
// loudness trims so every sound lands at about the same level (measured offline: rms of the rendered sound)
const TRIM = { gsnd_basic: 1.3, gsnd_eagle: 0.8, gsnd_chant: 2, gsnd_airhorn: 0.55, gsnd_jackpot: 1.6, gsnd_laser: 1.6, gsnd_gong: 1.5, gsnd_levelup: 0.85, gsnd_kazoo: 0.55, gsnd_choir: 3.6, gsnd_splash: 1.7, gsnd_slide: 0.7, cup_gsnd_pharaoh: 1.5 };

// The toolkit a recipe plays with. Times are recipe seconds (scaled by rate), frequencies are pre-pitch (scaled by
// pitch); every node is started and stopped on its own schedule, so nothing is left running.
function kit(a, o, trim = 1) {
  const c = a.ctx, T0 = c.currentTime + 0.015;
  const P = (o.pitch || 1) * (1 + (Math.random() - 0.5) * 0.03), R = 1 / (o.rate || 1), W = Math.min(1.35, o.power || 1);
  const bus = c.createGain(); bus.gain.value = 0.85 * trim * (o.vol ?? 1) * (0.85 + 0.15 * W);
  bus.connect(a.out(o.pan || 0));
  const at = s => T0 + s * R;
  const hz = f => f * P;
  const end = t => at(t) + 0.05;
  // gain envelope: attack to peak, hold, then an exponential-like decay (setTarget) over dec seconds
  const env = (g, t0, att, peak, hold, dec) => {
    g.gain.setValueAtTime(0, at(t0));
    g.gain.linearRampToValueAtTime(peak, at(t0 + att));
    g.gain.setValueAtTime(peak, at(t0 + att + hold));
    g.gain.setTargetAtTime(0, at(t0 + att + hold), Math.max(0.005, dec * R / 4));
  };
  const curve = (param, t0, pts, scale = hz) => {
    param.setValueAtTime(scale(pts[0][1]), at(t0 + pts[0][0]));
    for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(Math.max(1, scale(pts[i][1])), at(t0 + pts[i][0]));
  };
  const filter = (type, f, q = 0.7, pts = null, t0 = 0) => {
    const n = c.createBiquadFilter(); n.type = type; n.frequency.value = hz(f); n.Q.value = q;
    if (pts) curve(n.frequency, t0, pts);
    return n;
  };
  const link = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[0]; };
  // an oscillator with a frequency curve, an envelope and optional filter / vibrato / detune
  const tone = (type, freq, t0, att, peak, hold, dec, x = {}) => {
    if (hz(Array.isArray(freq) ? Math.max(...freq.map(q => q[1])) : freq) > 17000) return null; // (nothing past hearing / Nyquist)
    const os = c.createOscillator(), g = c.createGain();
    os.type = type;
    if (Array.isArray(freq)) curve(os.frequency, t0, freq); else os.frequency.value = hz(freq);
    if (x.detune) os.detune.value = x.detune;
    if (x.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = x.vib[0]; lg.gain.value = hz(Array.isArray(freq) ? freq[0][1] : freq) * x.vib[1]; link(l, lg, os.frequency); l.start(at(t0)); l.stop(end(t0 + att + hold + dec)); }
    env(g, t0, att, peak * W, hold, dec);
    const chain = [os, ...(x.filt ? [x.filt] : []), ...(x.shape ? [x.shape] : []), g, x.dest || bus];
    link(...chain);
    os.start(at(t0)); os.stop(end(t0 + att + hold + dec));
    return os;
  };
  const noise = (t0, att, peak, hold, dec, x = {}) => {
    const s = a.noise(), g = c.createGain();
    const f = x.type ? filter(x.type, x.f || 1000, x.q || 1, x.pts || null, t0) : null;
    env(g, t0, att, peak * W, hold, dec);
    link(...[s, ...(f ? [f] : []), g, x.dest || bus]);
    s.start(at(t0)); s.stop(end(t0 + att + hold + dec));
    return s;
  };
  // a struck metal / bell: inharmonic partials, the high ones dying first
  const bell = (f0, parts, t0, peak, dec, x = {}) => {
    for (const [ratio, amp, dk = 1] of parts) tone('sine', f0 * ratio, t0, x.att || 0.002, peak * amp, 0, dec * dk / Math.sqrt(ratio), { dest: x.dest, detune: (Math.random() - 0.5) * 6 });
  };
  // a soft-clip shaper (buzz for horns and kazoos)
  const shaper = (amt = 3) => {
    const n = c.createWaveShaper(), N = 1024, cv = new Float32Array(N);
    for (let i = 0; i < N; i++) { const v = i / (N - 1) * 2 - 1; cv[i] = Math.tanh(v * amt) / Math.tanh(amt); }
    n.curve = cv; return n;
  };
  // a vowel: parallel formant band-passes summed (F1..F3 [hz, q, gain]); returns the input to feed voices into
  const vowel = (forms, t0 = 0, dest = bus) => {
    const inp = c.createGain(), sum = c.createGain(); sum.gain.value = 1; sum.connect(dest);
    for (const [f, q, gn, pts] of forms) { const bp = filter('bandpass', f, q, pts || null, t0), gg = c.createGain(); gg.gain.value = gn; link(inp, bp, gg, sum); }
    return inp;
  };
  return { c, T0, P, R, W, bus, at, hz, env, curve, filter, link, tone, noise, bell, shaper, vowel };
}

const rnd = (a, b) => a + Math.random() * (b - a);

const RECIPES = {
  // the original green blip, a little sweeter
  gsnd_basic(k) {
    k.tone('sine', [[0, 1560], [0.12, 2340]], 0, 0.003, 0.2, 0.02, 0.32);
    k.tone('sine', [[0, 3120], [0.12, 4680]], 0.01, 0.003, 0.05, 0, 0.2);
  },

  // two calls: a short "kee" and a long, raspy, falling "keeeerrr", with a fast warble and air in it
  gsnd_eagle(k) {
    const bp = k.filter('bandpass', 2900, 0.9);
    bp.connect(k.bus);
    for (const [t0, len, f0, f1, f2, pk] of [[0, 0.2, 2300, 2900, 2500, 0.22], [0.3, 0.75, 2600, 3200, 1500, 0.3]]) {
      const pts = [[0, f0], [len * 0.18, f1], [len, f2]];
      k.tone('sawtooth', pts, t0, 0.02, pk * 0.55, len * 0.35, len * 0.65, { vib: [rnd(34, 42), 0.035], dest: bp });
      k.tone('sine', pts, t0, 0.02, pk, len * 0.35, len * 0.65, { vib: [rnd(34, 42), 0.03] });
      k.tone('triangle', pts.map(([t, f]) => [t, f * 2]), t0, 0.02, pk * 0.18, len * 0.3, len * 0.5, { vib: [38, 0.03] });
      k.noise(t0, 0.02, pk * 0.35, len * 0.4, len * 0.6, { type: 'bandpass', f: 3400, q: 2.5 });
    }
  },

  // a crowd chanting "GREEEEN!": a dozen voices (low and high) through the formants of an "r" sliding into "ee",
  // closing to an "n", then the crowd roars
  gsnd_chant(k) {
    const len = 1.05;
    const vw = k.vowel([[300, 5, 1, [[0, 420], [0.1, 290]]], [1150, 8, 0.6, [[0, 1150], [0.12, 2250], [len - 0.12, 2250], [len, 1300]]], [1650, 9, 0.4, [[0, 1650], [0.12, 2950]]]]);
    const nasal = k.filter('lowpass', 3500, 0.7, [[0, 3500], [len - 0.16, 3500], [len, 420]]);
    nasal.connect(vw);
    for (let i = 0; i < 12; i++) {
      const base = i < 7 ? rnd(118, 150) : rnd(200, 260), t0 = rnd(0, 0.07);
      k.tone('sawtooth', [[0, base * 0.82], [0.14, base], [len * 0.8, base * 1.02], [len, base * 0.9]], t0, 0.05, 0.11, len * 0.7, 0.22, { detune: rnd(-18, 18), vib: [rnd(4.5, 6.5), 0.012], dest: nasal });
    }
    k.noise(0, 0.01, 0.12, 0.03, 0.05, { type: 'bandpass', f: 1300, q: 1.5 }); // the hard "g"
    k.noise(len - 0.05, 0.15, 0.18 * k.W, 0.5, 0.9, { type: 'bandpass', f: 900, q: 0.6 }); // the roar after
  },

  // the drawer clunk, two register bells and coins
  gsnd_register(k) {
    k.noise(0, 0.002, 0.3, 0.02, 0.05, { type: 'bandpass', f: 2400, q: 1.2 });
    k.tone('sine', [[0, 160], [0.08, 70]], 0, 0.002, 0.45, 0, 0.09);
    k.noise(0.05, 0.03, 0.08, 0.12, 0.08, { type: 'lowpass', f: 1800, pts: [[0, 600], [0.2, 2400]] }); // drawer slide
    const parts = [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]];
    k.bell(2093, parts, 0.14, 0.24, 1.3);
    k.bell(2637, parts, 0.17, 0.18, 1.2);
    for (let i = 0; i < 9; i++) k.tone('sine', rnd(3600, 6200), 0.28 + i * rnd(0.03, 0.06), 0.001, rnd(0.03, 0.06), 0, 0.06);
  },

  // short, short, long: three detuned saws through a buzz, each blast scooping up into pitch
  gsnd_airhorn(k) {
    const sh = k.shaper(2.5), hp = k.filter('highpass', 280, 0.7), lp = k.filter('lowpass', 3200, 0.8);
    k.link(sh, hp, lp, k.bus);
    for (const [t0, len] of [[0, 0.16], [0.22, 0.16], [0.44, 0.62]]) {
      for (const [f, d] of [[466, 0], [470, 8], [587, -6], [698, 4]]) k.tone('sawtooth', [[0, f * 0.93], [0.035, f]], t0, 0.012, 0.075, len, 0.07, { detune: d, dest: sh });
    }
  },

  // the reels: alternating bells, a rain of coins, then the jackpot arpeggio
  gsnd_jackpot(k) {
    const bp = k.filter('bandpass', 2200, 1.4); bp.connect(k.bus);
    for (let i = 0; i < 10; i++) k.tone('square', i % 2 ? 1568 : 2093, i * 0.055, 0.002, 0.08, 0.02, 0.05, { dest: bp });
    for (let i = 0; i < 22; i++) k.tone('sine', rnd(3200, 6400), 0.1 + rnd(0, 0.95), 0.001, rnd(0.025, 0.05), 0, rnd(0.05, 0.12));
    [84, 88, 91, 96].forEach((n, i) => k.bell(NOTE(n), [[1, 1], [2, 0.3], [3.01, 0.12]], 0.6 + i * 0.07, 0.13, 0.7));
  },

  // squee-squee: a rubber toy squeezed twice
  gsnd_duck(k) {
    for (const [t0, f] of [[0, 1], [0.24, 1.12]]) {
      k.tone('triangle', [[0, 820 * f], [0.05, 1650 * f], [0.11, 1500 * f], [0.17, 1050 * f]], t0, 0.01, 0.22, 0.09, 0.07, { vib: [55, 0.04] });
      k.tone('sine', [[0, 1640 * f], [0.05, 3300 * f], [0.17, 2100 * f]], t0, 0.01, 0.05, 0.09, 0.06);
      k.noise(t0, 0.01, 0.05, 0.1, 0.05, { type: 'bandpass', f: 2600, q: 2 });
    }
  },

  // pew, pew, then a charged-up big shot
  gsnd_laser(k) {
    const lp = k.filter('lowpass', 4000, 5); lp.connect(k.bus);
    for (const t0 of [0, 0.13]) k.tone('square', [[0, 2400], [0.16, 190]], t0, 0.002, 0.12, 0.02, 0.14, { dest: lp });
    k.tone('sine', [[0, 220], [0.28, 1900]], 0.26, 0.02, 0.07, 0.24, 0.02);
    k.tone('sawtooth', [[0, 3000], [0.45, 110]], 0.55, 0.002, 0.16, 0.05, 0.4, { dest: lp, vib: [30, 0.05] });
    k.noise(0.55, 0.002, 0.12, 0.04, 0.3, { type: 'bandpass', f: 1800, q: 0.8, pts: [[0, 4000], [0.4, 300]] });
  },

  // a temple gong: a low thump, then inharmonic partials that bloom and beat
  gsnd_gong(k) {
    k.noise(0, 0.002, 0.25, 0.01, 0.12, { type: 'lowpass', f: 500 });
    const f0 = 98;
    for (const [r, amp, dk] of [[1, 1, 1], [1.47, 0.6, 0.9], [2.09, 0.45, 0.8], [2.56, 0.35, 0.75], [3.14, 0.28, 0.7], [4.1, 0.2, 0.6], [5.21, 0.14, 0.5], [6.6, 0.08, 0.4]]) {
      k.tone('sine', f0 * r, 0, r > 2 ? 0.12 : 0.004, 0.13 * amp, 0.1, 2.6 * dk, { detune: rnd(-7, 7) });
      k.tone('sine', f0 * r * 1.004, 0.01, 0.15, 0.05 * amp, 0.1, 2.2 * dk);
    }
  },

  // 8-bit fanfare: a fast arpeggio up and a held, warbling top
  gsnd_levelup(k) {
    [72, 76, 79, 84, 88].forEach((n, i) => k.tone('square', NOTE(n), i * 0.065, 0.002, 0.09, 0.04, 0.03));
    k.tone('square', NOTE(91), 0.33, 0.002, 0.1, 0.32, 0.18, { vib: [9, 0.012] });
    k.tone('square', NOTE(84), 0.33, 0.002, 0.05, 0.32, 0.18, { detune: 5 });
    k.tone('triangle', [[0, NOTE(48)], [0.3, NOTE(48)], [0.31, NOTE(55)]], 0, 0.002, 0.16, 0.6, 0.15);
  },

  // a crack overhead, then the roll of the thunder
  gsnd_thunder(k) {
    k.noise(0, 0.001, 0.4, 0.015, 0.05, { type: 'highpass', f: 1800 });
    k.noise(0.01, 0.002, 0.35, 0.04, 0.25, { type: 'bandpass', f: 900, q: 0.7, pts: [[0, 1600], [0.3, 300]] });
    for (const [t0, pk, dur] of [[0.08, 0.42, 1.4], [0.45, 0.3, 1.1], [0.9, 0.22, 1.2]]) k.noise(t0, 0.08, pk, dur * 0.3, dur, { type: 'lowpass', f: 180, q: 0.9 });
    k.tone('sine', [[0, 55], [1.5, 38]], 0.06, 0.1, 0.18, 0.4, 1.2);
  },

  // the bugle "charge" call on a kazoo: G C E G ... E G!
  gsnd_kazoo(k) {
    const sh = k.shaper(4), bp = k.filter('bandpass', 1250, 1.6), lp = k.filter('lowpass', 4200);
    k.link(sh, bp, lp, k.bus);
    const notes = [[67, 0, 0.11], [72, 0.13, 0.11], [76, 0.26, 0.11], [79, 0.39, 0.2], [76, 0.62, 0.1], [79, 0.74, 0.42]];
    for (const [n, t0, len] of notes) {
      const f = NOTE(n);
      k.tone('sawtooth', [[0, f * 0.94], [0.03, f]], t0, 0.01, 0.2, len, 0.05, { vib: [6.5, 0.012], dest: sh });
      k.noise(t0, 0.01, 0.05, len, 0.04, { type: 'bandpass', f: 2500, q: 3, dest: sh });
    }
  },

  // "aaaah": a C major chord sung by a small choir, with a shimmer on top
  gsnd_choir(k) {
    const vw = k.vowel([[730, 6, 1], [1090, 8, 0.55], [2440, 10, 0.3]]);
    for (const n of [48, 60, 64, 67, 72]) for (let v = 0; v < 3; v++) k.tone('sawtooth', NOTE(n), rnd(0, 0.05), 0.2, n === 48 ? 0.06 : 0.045, 0.75, 0.6, { detune: rnd(-14, 14), vib: [rnd(4.8, 6), 0.006], dest: vw });
    k.tone('sine', NOTE(96), 0.15, 0.25, 0.03, 0.5, 0.6, { vib: [7, 0.01] });
  },

  // a cannonball into a pool: the plop, the splash and the droplets
  gsnd_splash(k) {
    k.tone('sine', [[0, 950], [0.07, 260]], 0, 0.002, 0.3, 0, 0.09);
    k.noise(0.02, 0.01, 0.35, 0.05, 0.55, { type: 'bandpass', f: 2600, q: 0.6, pts: [[0, 1400], [0.1, 3600], [0.6, 1800]] });
    k.noise(0.02, 0.01, 0.2, 0.08, 0.35, { type: 'lowpass', f: 700 });
    for (let i = 0; i < 16; i++) { const t0 = 0.12 + rnd(0, 0.7), f = rnd(900, 2400); k.tone('sine', [[0, f], [0.04, f * 1.6]], t0, 0.002, rnd(0.03, 0.07), 0, 0.04); }
  },

  // fweeeee-oop!
  gsnd_slide(k) {
    k.tone('sine', [[0, 480], [0.38, 1900], [0.44, 1750], [0.58, 2100]], 0, 0.02, 0.22, 0.48, 0.1, { vib: [5, 0.008] });
    k.noise(0, 0.03, 0.03, 0.5, 0.1, { type: 'bandpass', f: 1600, q: 1.2, pts: [[0, 600], [0.38, 2200]] });
  },

  // King Tut Cup exclusive: a ceremonial horn rising through an old scale, a sistrum rattle and a gong under the
  // last note
  cup_gsnd_pharaoh(k) {
    const lp = k.filter('lowpass', 900, 1.2, [[0, 700], [0.3, 2600], [1.4, 1600]]); lp.connect(k.bus);
    const notes = [[62, 0, 0.12], [63, 0.14, 0.12], [66, 0.28, 0.12], [67, 0.42, 0.14], [69, 0.58, 0.75]];
    for (const [n, t0, len] of notes) for (const d of [-6, 6]) k.tone('sawtooth', [[0, NOTE(n) * 0.97], [0.04, NOTE(n)]], t0, 0.03, 0.09, len, 0.12, { detune: d, vib: [5.5, n === 69 ? 0.01 : 0.004], dest: lp });
    for (let i = 0; i < 6; i++) { const t0 = i * 0.11; k.noise(t0, 0.002, 0.06, 0.02, 0.06, { type: 'highpass', f: 5200 }); k.tone('sine', rnd(5200, 7400), t0, 0.002, 0.025, 0, 0.08); }
    for (const [r, amp] of [[1, 1], [1.47, 0.5], [2.09, 0.35], [2.56, 0.25]]) k.tone('sine', 73.4 * r, 0.58, 0.01, 0.1 * amp, 0.1, 1.8);
  },
};

// Play a green release sound. Returns false when audio isn't available (no user gesture yet, or no Web Audio).
export function playGreenSound(audio, id, o = {}) {
  if (!audio || !audio.ensure || !audio.ensure()) return false;
  const r = RECIPES[id] || RECIPES.gsnd_basic;
  try { r(kit(audio, o, TRIM[id] || 1)); } catch (e) { console.warn('green sound', id, e); return false; }
  // a big one gets the crowd going
  if ((o.power || 1) > 1.1 && audio.cheer) audio.cheer(0.4);
  return true;
}
export const greenRecipe = id => RECIPES[id] || null;

// Each AI player's own take on his sound: a pitch and a tempo from his name (stable across games and sessions).
export function greenVoice(key = '') {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const a = (h & 0xffff) / 0xffff, b = (h >>> 16) / 0xffff;
  return { pitch: +(0.86 + a * 0.3).toFixed(3), rate: +(0.9 + b * 0.2).toFixed(3) };
}
