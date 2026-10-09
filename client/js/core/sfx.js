// v0.4.7.5 quick patch: a small sample-level synthesizer for the green release sounds. A sound is rendered once into a
// buffer in plain JS (no samples, nothing to download) and then played from that buffer, so a recipe can do what
// Web Audio nodes can't do cheaply: a voice with real jitter and rasp, banks of ringing modes for bells, glass, coins
// and wood, plucked strings, bubbles, claps, and a reverb for the room the sound happens in. Every recipe works in
// "recipe seconds" (the Synth's time scale stretches them for each AI player's tempo); frequencies are real Hz (each
// AI player's pitch is applied on playback).
const TAU = Math.PI * 2;

export function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const midi = n => 440 * Math.pow(2, (n - 69) / 12);
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

// band-limited step correction (polyBLEP) for the saw and pulse oscillators
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// a phase-accumulating oscillator; call one method once per sample with the current frequency
export class Osc {
  constructor(sr, phase = 0) { this.sr = sr; this.p = phase; }
  adv(f) { this.p += f / this.sr; if (this.p >= 1 || this.p < 0) this.p -= Math.floor(this.p); }
  sin(f) { const v = Math.sin(TAU * this.p); this.adv(f); return v; }
  saw(f) { const p = this.p, v = 2 * p - 1 - blep(p, Math.abs(f) / this.sr); this.adv(f); return v; }
  pulse(f, duty = 0.5) {
    const p = this.p, dt = Math.abs(f) / this.sr;
    let v = p < duty ? 1 : -1;
    v += blep(p, dt);
    let q = p - duty; if (q < 0) q += 1;
    v -= blep(q, dt);
    this.adv(f);
    return v - (2 * duty - 1);
  }
  tri(f) { const p = this.p, v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; this.adv(f); return v; }
  // additive: amps[h] for harmonic h+1 (anything past ~20 kHz is left out)
  harm(f, amps) {
    const p = this.p, lim = this.sr * 0.45;
    let v = 0;
    for (let h = 0; h < amps.length; h++) { if (f * (h + 1) > lim) break; if (amps[h]) v += amps[h] * Math.sin(TAU * p * (h + 1)); }
    this.adv(f);
    return v;
  }
}

// a state-variable filter (topology-preserving): cheap to sweep. lp / bp (unity at the centre) / hp
export class Svf {
  constructor(sr, f = 1000, q = 0.707) { this.sr = sr; this.s1 = 0; this.s2 = 0; this.f0 = -1; this.q0 = -1; this.set(f, q); }
  set(f, q = this.q0) {
    if (f === this.f0 && q === this.q0) return this;
    this.f0 = f; this.q0 = q;
    const g = Math.tan(Math.PI * Math.max(5, Math.min(f, this.sr * 0.49)) / this.sr), k = 1 / q;
    this.k = k; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
    return this;
  }
  run(x) {
    const v3 = x - this.s2, v1 = this.a1 * this.s1 + this.a2 * v3, v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
    this.band = v1; this.hi = x - this.k * v1 - v2;
    return v2;
  }
  lp(x) { return this.run(x); }
  bp(x) { this.run(x); return this.band * this.k; }
  hp(x) { this.run(x); return this.hi; }
}

// a fixed biquad (RBJ cookbook): 'lp' 'hp' 'bp' 'peak' 'ls' 'hs'
export class Biquad {
  constructor(sr, type, f, q = 0.707, db = 0) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, db); }
  set(type, f, q = 0.707, db = 0) {
    const w = TAU * Math.min(f, this.sr * 0.49) / this.sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q), A = Math.pow(10, db / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    else {
      const s = 2 * Math.sqrt(A) * al;
      if (type === 'ls') { b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; }
      else { b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// parallel formant band-passes: [[hz, q, gain], ...]; set(i, hz) moves one
export class Formants {
  constructor(sr, list) { this.b = list.map(([f, q, g]) => ({ s: new Svf(sr, f, q), g, q })); }
  set(i, f, q) { const b = this.b[i]; b.s.set(f, q ?? b.q); }
  run(x) { let y = 0; const B = this.b; for (let i = 0; i < B.length; i++) y += B[i].s.bp(x) * B[i].g; return y; }
}

// white / pink / brown noise from the Synth's own seeded generator
export class Noise {
  constructor(rand) { this.r = rand; this.b0 = this.b1 = this.b2 = 0; this.br = 0; }
  white() { return this.r() * 2 - 1; }
  pink() { const w = this.white(); this.b0 = 0.99765 * this.b0 + w * 0.099046; this.b1 = 0.963 * this.b1 + w * 0.2965164; this.b2 = 0.57 * this.b2 + w * 1.0526913; return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.22; }
  brown() { this.br = (this.br + 0.02 * this.white()) / 1.02; return this.br * 3.5; }
}

// a smooth random wander in -1..1, new targets hz times a second (jitter, wobble, flutter)
export class Drift {
  constructor(sr, rand, hz) { this.r = rand; this.sr = sr; this.hz = hz; this.a = 0; this.b = rand() * 2 - 1; this.k = 1; }
  next() {
    this.k += this.hz / this.sr;
    if (this.k >= 1) { this.k -= Math.floor(this.k); this.a = this.b; this.b = this.r() * 2 - 1; }
    const m = 0.5 - 0.5 * Math.cos(Math.PI * this.k);
    return this.a + (this.b - this.a) * m;
  }
}

// a breakpoint envelope over recipe time: [[t, v], ...]; exp interpolates in ratio (for frequencies)
export class Env {
  constructor(pts, exp = false) {
    this.T = pts.map(q => q[0]); this.V = pts.map(q => q[1]); this.e = exp; this.i = 0; this.last = pts.length - 1;
    this.L = this.V.map((v, i) => (i < this.last && exp && v > 0 && this.V[i + 1] > 0 ? Math.log(this.V[i + 1] / v) : NaN));
  }
  at(t) {
    const T = this.T, V = this.V;
    if (t <= T[0]) return V[0];
    if (t >= T[this.last]) return V[this.last];
    let i = this.i;
    if (t < T[i]) i = 0;
    while (t > T[i + 1]) i++;
    this.i = i;
    const d = T[i + 1] - T[i], k = d > 0 ? (t - T[i]) / d : 1, L = this.L[i];
    return L === L ? V[i] * Math.exp(L * k) : V[i] + (V[i + 1] - V[i]) * k;
  }
}

function grow(buf, n) {
  if (buf && buf.length >= n) return buf;
  const b = new Float32Array(Math.max(n, buf ? buf.length * 1.5 | 0 : 0, 1024));
  if (buf) b.set(buf);
  return b;
}

// a Freeverb-style room (8 damped combs, 4 all-passes), mono. decay: seconds to -60 dB
export function reverb(input, n, sr, o = {}) {
  const decay = o.decay ?? 1.2, damp = o.damp ?? 0.3, size = o.size ?? 1, P = Math.round((o.pre ?? 0.012) * sr);
  const N = Math.min(o.max || Infinity, n + P + Math.ceil(sr * decay * 1.05)), out = new Float32Array(N);
  const sc = sr / 44100 * size;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(L => { L = Math.max(8, Math.round(L * sc)); return { L, b: new Float32Array(L), i: 0, fb: Math.pow(10, -3 * L / (sr * decay)), z: 0 }; });
  const aps = [556, 441, 341, 225].map(L => { L = Math.max(4, Math.round(L * sc)); return { L, b: new Float32Array(L), i: 0 }; });
  const hp = new Svf(sr, o.hp ?? 120, 0.7), lp = new Svf(sr, o.lp ?? 7500, 0.7), g = 0.07 / Math.sqrt(size);
  const M = Math.min(n, input.length);
  for (let i = 0; i < N; i++) {
    const j = i - P;
    const x = hp.hp(j >= 0 && j < M ? input[j] : 0);
    let s = 0;
    for (let k = 0; k < 8; k++) { const c = combs[k], y = c.b[c.i]; c.z = y * (1 - damp) + c.z * damp; c.b[c.i] = x + c.z * c.fb; if (++c.i >= c.L) c.i = 0; s += y; }
    for (let k = 0; k < 4; k++) { const a = aps[k], b = a.b[a.i], v = b - s; a.b[a.i] = s + b * 0.5; if (++a.i >= a.L) a.i = 0; s = v; }
    out[i] = lp.lp(s) * g;
  }
  return out;
}

export class Synth {
  constructor({ sr = 44100, seed = 1, ts = 1 } = {}) {
    this.sr = sr; this.ts = ts; this.rand = prng(seed); this.noise = new Noise(this.rand);
    this.main = new Float32Array(sr * 2); this.verb = null; this.n = 0;
    this.room = { decay: 1.2, damp: 0.3, pre: 0.012, wet: 1, size: 1, lp: 7500, hp: 120 };
    this.taps = null;
    this.maxLen = 4.2; // (seconds: the longest a green sound runs, its tail faded into it)
  }
  rnd(a = 0, b = 1) { return a + this.rand() * (b - a); }
  pick(a) { return a[Math.floor(this.rand() * a.length)]; }
  S(t) { return Math.max(0, Math.round(t * this.ts * this.sr)); }
  osc(phase) { return new Osc(this.sr, phase ?? this.rand()); }
  svf(f, q) { return new Svf(this.sr, f, q); }
  bq(type, f, q, db) { return new Biquad(this.sr, type, f, q, db); }
  drift(hz) { return new Drift(this.sr, this.rand, hz); }
  formants(list) { return new Formants(this.sr, list); }
  env(pts, exp) { return new Env(pts, exp); }
  white() { return this.noise.white(); }

  // render fn(t, i) into the mix for dur recipe seconds from t0 (t: recipe seconds since t0); rev: send to the room
  play(t0, dur, fn, gain = 1, rev = 0) {
    const i0 = this.S(t0), n = this.S(dur), end = i0 + n;
    this.main = grow(this.main, end);
    if (rev) this.verb = grow(this.verb, end);
    const m = this.main, v = this.verb, dt = 1 / (this.sr * this.ts);
    for (let i = 0; i < n; i++) { const x = fn(i * dt, i); m[i0 + i] += gain * x; if (rev) v[i0 + i] += rev * gain * x; }
    if (end > this.n) this.n = end;
  }
  // a bank of ringing modes: [[hz, amp, tau (recipe s to 1/e), attack (s)], ...] (bells, bars, glass, coins, wood)
  modes(t0, list, gain = 1, rev = 0) {
    const sr = this.sr, i0 = this.S(t0), top = Math.max(...list.map(md => Math.abs(md[1])));
    for (const md of list) {
      const [f, amp, tau, att = 0.0008] = md;
      if (!(f > 20 && f < sr * 0.45) || !amp) continue;
      // (each mode runs until it's 60 dB under the loudest one in the bank)
      const T = tau * this.ts, life = Math.max(1, Math.min(6.9, Math.log(Math.abs(amp) / (top * 0.001)))), n = Math.max(0, Math.min(Math.ceil(T * sr * life), Math.ceil(this.maxLen * sr) - i0)), end = i0 + n;
      this.main = grow(this.main, end);
      if (rev) this.verb = grow(this.verb, end);
      const m = this.main, v = this.verb;
      const w = TAU * f / sr, c = Math.cos(w), s = Math.sin(w), d = Math.exp(-1 / (T * sr)), A = Math.max(1, att * this.ts * sr), Aend = A * 6;
      const ph = this.rnd(0, TAU);
      let re = Math.cos(ph), im = Math.sin(ph), g = amp * gain;
      for (let i = 0; i < n; i++) {
        const r2 = re * c - im * s; im = re * s + im * c; re = r2;
        const x = i < Aend ? im * g * (1 - Math.exp(-i / A)) : im * g;
        m[i0 + i] += x; if (rev) v[i0 + i] += x * rev;
        g *= d;
      }
      if (end > this.n) this.n = end;
    }
  }
  // a plucked string (Karplus-Strong): bright 0..1
  pluck(t0, f, dur, gain = 1, rev = 0, bright = 0.6) {
    const sr = this.sr, D = sr / f - 0.5, N = Math.ceil(D) + 3, line = new Float32Array(N);
    const lp = new Svf(sr, 800 + bright * 9000, 0.6);
    for (let i = 0; i < N; i++) line[i] = lp.lp(this.white());
    let w = 0;
    const loss = Math.pow(0.001, 1 / (f * Math.max(0.05, dur * this.ts)));
    this.play(t0, dur, () => {
      let r = w - D; while (r < 0) r += N;
      const i0 = Math.floor(r), fr = r - i0, a = line[i0 % N], b = line[(i0 + 1) % N], c = line[(i0 + N - 1) % N];
      const y = a + (b - a) * fr;
      const out = y;
      line[w] = loss * 0.5 * (y + (c + (a - c) * fr));
      w = (w + 1) % N;
      return out;
    }, gain, rev);
  }
  // echoes of everything so far: [[delay s, gain, lowpass hz], ...] (a canyon, a gym wall)
  echo(taps) { this.taps = taps; }

  // finish: echoes, the room, trim the tail, and level it (every green sound comes out equally loud)
  render({ level = 1, target = 0.085, peak = 0.95 } = {}) {
    const sr = this.sr;
    let n = this.n, out = this.main;
    if (this.taps) {
      const dry = out.slice(0, n);
      for (const [d, g, f] of this.taps) {
        const o = Math.round(d * this.ts * sr), lp = new Svf(sr, f || 6000, 0.6), hp = new Svf(sr, 150, 0.6);
        out = grow(out, n + o);
        if (this.verb) this.verb = grow(this.verb, n + o);
        for (let i = 0; i < n; i++) { const x = hp.hp(lp.lp(dry[i])) * g; out[i + o] += x; if (this.verb) this.verb[i + o] += x * 0.5; }
        if (n + o > this.n) this.n = n + o;
      }
      n = this.n;
    }
    if (this.verb) {
      const w = reverb(this.verb, n, sr, { ...this.room, decay: this.room.decay * this.ts, max: Math.ceil(this.maxLen * sr) });
      out = grow(out, w.length);
      const wet = this.room.wet;
      for (let i = 0; i < w.length; i++) out[i] += w[i] * wet;
      n = Math.max(n, w.length);
    }
    let pk = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > pk) pk = a; }
    if (!(pk > 0)) return new Float32Array(Math.round(sr * 0.05));
    // past the longest a green runs: fade it out over its last half second
    const maxN = Math.ceil(this.maxLen * sr);
    if (n > maxN) { n = maxN; const F0 = Math.round(sr * 0.5); for (let i = 0; i < F0; i++) out[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / F0); }
    // the tail: cut where it falls under -56 dB of the peak, fading the last 40 ms
    let last = n - 1; const floor = pk * 0.0016;
    while (last > 0 && Math.abs(out[last]) < floor) last--;
    n = Math.min(n, last + Math.round(sr * 0.01));
    const res = out.slice(0, n), F = Math.min(n, Math.round(sr * 0.04));
    for (let i = 0; i < F; i++) res[n - 1 - i] *= i / F;
    // loudness (K-weighted, 50 ms blocks, gated to the blocks within 20 dB of the loudest)
    const hp = new Biquad(sr, 'hp', 100, 0.6), hs = new Biquad(sr, 'hs', 1500, 0.7, 4);
    const B = Math.round(sr * 0.05), pw = [];
    let acc = 0, c = 0;
    for (let i = 0; i < n; i++) { const y = hs.run(hp.run(res[i])); acc += y * y; if (++c === B || i === n - 1) { pw.push(acc / c); acc = 0; c = 0; } }
    const top = Math.max(...pw), live = pw.filter(p => p >= top * 0.01);
    const loud = Math.sqrt(live.reduce((a, b) => a + b, 0) / live.length);
    let peak2 = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(res[i]); if (a > peak2) peak2 = a; }
    // (peaks may run up to 1.6x over the ceiling: a soft limiter rounds them off, the way a hit sounds through a PA)
    const g = Math.min(target * level / loud, 1.6 * peak / peak2), knee = 0.62 * peak, room = peak - knee;
    let pk3 = 0;
    for (let i = 0; i < n; i++) {
      let v = res[i] * g;
      const a = Math.abs(v);
      if (a > knee) v = Math.sign(v) * (knee + room * Math.tanh((a - knee) / room));
      res[i] = v;
      if (Math.abs(v) > pk3) pk3 = Math.abs(v);
    }
    this.stats = { loud: loud * g, peak: pk3, dur: n / sr, gain: g };
    return res;
  }
}
