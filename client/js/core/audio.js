// Synthesized court audio (no samples): dribbles, squeaks, rim/glass/net, whistle, buzzer, crowd, beat.
export class Audio {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false;
    this.volume = { master: 0.8, sfx: 0.9, crowd: 0.6, music: 0.35 };
    this.crowdLevel = 0; this.crowdTarget = 0; // v0.4.3: silent until a venue asks for a crowd
    this.surface = 'wood';
    this.musicOn = false;
  }
  ensure() {
    if (!this.unlocked) return false;
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.volume.master; this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = this.volume.sfx; this.sfx.connect(this.comp);
    this.crowdBus = c.createGain(); this.crowdBus.gain.value = 0; this.crowdBus.connect(this.comp);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.volume.music; this.musicBus.connect(this.comp);
    // reverb-ish feedback delay for indoor ambience
    this.verb = c.createDelay(0.5); this.verb.delayTime.value = 0.09;
    const fb = c.createGain(); fb.gain.value = 0.28; this.verb.connect(fb); fb.connect(this.verb);
    this.verbOut = c.createGain(); this.verbOut.gain.value = 0.25; this.verb.connect(this.verbOut); this.verbOut.connect(this.comp);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume.master; }
  setIndoor(indoor) { if (this.verbOut) this.verbOut.gain.value = indoor ? 0.35 : 0.06; }
  out(pan = 0) {
    const c = this.ctx;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(this.sfx); p.connect(this.verb); return p; }
    return this.sfx;
  }
  noise(dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loopStart = Math.random(); s.loop = true; return s; }
  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

  bounce(v = 1, pan = 0) {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    const wood = this.surface === 'wood';
    o.type = 'sine'; o.frequency.setValueAtTime(wood ? 150 : 120, t); o.frequency.exponentialRampToValueAtTime(wood ? 70 : 60, t + 0.09);
    this.env(g, t, 0.003, 0.5 * Math.min(1.2, v), wood ? 0.13 : 0.09);
    o.connect(g); g.connect(this.out(pan)); o.start(t); o.stop(t + 0.25);
    const n = this.noise(), f = c.createBiquadFilter(), ng = c.createGain();
    f.type = 'bandpass'; f.frequency.value = wood ? 1800 : 900; f.Q.value = 1.2;
    this.env(ng, t, 0.001, 0.18 * v * (wood ? 1 : 1.6), 0.04);
    n.connect(f); f.connect(ng); ng.connect(this.out(pan)); n.start(t); n.stop(t + 0.1);
  }
  squeak(pan = 0) {
    if (!this.ensure() || this.surface !== 'wood') return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    const f0 = 1800 + Math.random() * 1500;
    o.type = 'triangle'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1.1 + Math.random() * 0.3), t + 0.06); o.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.12);
    this.env(g, t, 0.005, 0.06, 0.12);
    o.connect(g); g.connect(this.out(pan)); o.start(t); o.stop(t + 0.2);
  }
  rim(v = 1, pan = 0) {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime;
    const amp = Math.min(1, 0.15 + v * 0.18);
    for (const [f, a, d] of [[440, 1, 0.35], [1036, 0.6, 0.25], [1708, 0.45, 0.18], [2420, 0.3, 0.12], [3150, 0.2, 0.08]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f * (0.98 + Math.random() * 0.04);
      this.env(g, t, 0.002, amp * a * 0.4, d * (0.7 + v * 0.2));
      o.connect(g); g.connect(this.out(pan)); o.start(t); o.stop(t + d + 0.1);
    }
    const n = this.noise(), f = c.createBiquadFilter(), ng = c.createGain();
    f.type = 'highpass'; f.frequency.value = 2500; this.env(ng, t, 0.001, amp * 0.3, 0.05);
    n.connect(f); f.connect(ng); ng.connect(this.out(pan)); n.start(t); n.stop(t + 0.1);
  }
  board(v = 1, pan = 0) {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(130, t + 0.12);
    this.env(g, t, 0.002, 0.35 * Math.min(1, v * 0.4 + 0.3), 0.16);
    o.connect(g); g.connect(this.out(pan)); o.start(t); o.stop(t + 0.3);
    const n = this.noise(), f = c.createBiquadFilter(), ng = c.createGain();
    f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 0.8; this.env(ng, t, 0.002, 0.25, 0.1);
    n.connect(f); f.connect(ng); ng.connect(this.out(pan)); n.start(t); n.stop(t + 0.2);
  }
  swish(clean = true, pan = 0) {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime, n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.setValueAtTime(clean ? 4200 : 2600, t); f.frequency.exponentialRampToValueAtTime(clean ? 1400 : 900, t + 0.3);
    this.env(g, t, 0.02, clean ? 0.42 : 0.24, 0.3);
    n.connect(f); f.connect(g); g.connect(this.out(pan)); n.start(t); n.stop(t + 0.45);
  }
  whistle() {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime;
    for (const f of [2750, 2950]) {
      const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'sine'; o.frequency.value = f; lfo.frequency.value = 28; lg.gain.value = 60; lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.setValueAtTime(0.12, t + 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g); g.connect(this.out(0)); o.start(t); lfo.start(t); o.stop(t + 0.65); lfo.stop(t + 0.65);
    }
  }
  buzzer() {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 196; o2.type = 'square'; o2.frequency.value = 392;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.setValueAtTime(0.16, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.out(0)); o.start(t); o2.start(t); o.stop(t + 1.35); o2.stop(t + 1.35);
  }
  ui(kind = 'click') {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    const f = { click: 880, back: 520, buy: 1320, error: 220, green: 1560, tick: 1250 }[kind] || 880;
    o.type = kind === 'error' ? 'square' : 'sine'; o.frequency.setValueAtTime(f, t);
    if (kind === 'buy' || kind === 'green') o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.12);
    this.env(g, t, 0.003, kind === 'green' ? 0.18 : kind === 'tick' ? 0.025 : 0.08, kind === 'green' ? 0.3 : kind === 'tick' ? 0.03 : 0.08);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.4);
  }
  // Crowd bed. v0.4.3: the old bed was a 2-second loop of white noise that ran from the first click at a
  // constant 0.2 level, so menus and every mode had a steady "air / rummaging" hiss (frozen noise repeating
  // every 2 s is heard as a texture). Now it is silent unless a venue sets a crowd level, uses 9 s of pink
  // noise split into three murmur bands whose loudness drifts independently, and the sources stop when the
  // crowd is off.
  startCrowd() {
    const c = this.ctx, len = c.sampleRate * 9;
    if (!this.pinkBuf) {
      this.pinkBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.pinkBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
      // fade the loop seam
      for (let i = 0; i < 2000; i++) { const k = i / 2000; d[i] *= k; d[len - 1 - i] *= k; }
    }
    this.crowdNodes = [];
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700; lp.connect(this.crowdBus);
    [[320, 0.9, 0.11], [720, 1.1, 0.17], [1500, 1.3, 0.29]].forEach(([fq, q, rate], i) => {
      const n = c.createBufferSource(); n.buffer = this.pinkBuf; n.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0.55;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = rate; lg.gain.value = 0.25; lfo.connect(lg); lg.connect(g.gain);
      n.connect(f); f.connect(g); g.connect(lp);
      n.start(c.currentTime, (i * 3.1) % 9); lfo.start();
      this.crowdNodes.push(n, lfo);
      if (i === 1) this.crowdFilter = f;
    });
  }
  stopCrowd() { for (const n of this.crowdNodes || []) { try { n.stop(); } catch { /* already stopped */ } } this.crowdNodes = null; this.crowdFilter = null; }
  // distant low rumble (trains, rotor wash) for park background events
  rumble(v = 0.2) {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime, n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 110;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.35); g.gain.linearRampToValueAtTime(0.0001, t + 1.5);
    n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 1.6);
  }
  setCrowd(level) { this.crowdTarget = Math.max(0, level); }
  cheer(strength = 1) { if (this.crowdTarget <= 0) return; this.crowdLevel = Math.min(1.6, this.crowdLevel + 0.6 * strength); }
  ooh() { if (this.crowdTarget <= 0) return; this.crowdLevel = Math.min(1.4, this.crowdLevel + 0.4); if (this.crowdFilter) { const t = this.ctx.currentTime; this.crowdFilter.frequency.setValueAtTime(500, t); this.crowdFilter.frequency.linearRampToValueAtTime(900, t + 0.6); } }
  update(dt) {
    if (!this.ctx) return;
    this.crowdLevel += (this.crowdTarget - this.crowdLevel) * Math.min(1, dt * 0.8);
    if (this.crowdTarget > 0 && !this.crowdNodes) this.startCrowd();
    if (this.crowdTarget <= 0 && this.crowdLevel < 0.004) { this.crowdLevel = 0; if (this.crowdNodes) this.stopCrowd(); }
    this.crowdBus.gain.value = Math.max(0, this.crowdLevel) * this.volume.crowd * 0.5;
    if (this.musicOn) this.tickMusic();
  }
  // tiny lo-fi beat sequencer for menus / park ambience (original pattern)
  startMusic() { if (!this.ensure()) return; this.musicOn = true; this.nextBeat = this.ctx.currentTime + 0.1; this.step = 0; }
  stopMusic() { this.musicOn = false; }
  tickMusic() {
    const c = this.ctx, bpm = 86, sp = 60 / bpm / 4;
    while (this.nextBeat < c.currentTime + 0.15) {
      const t = this.nextBeat, s = this.step % 32;
      const kick = [0, 10, 16, 22, 26], snare = [8, 24], hat = s % 2 === 0;
      if (kick.includes(s)) this.drum(t, 'kick');
      if (snare.includes(s)) this.drum(t, 'snare');
      if (hat) this.drum(t, 'hat', s % 4 === 2 ? 0.5 : 0.3);
      if (s % 8 === 0) this.chord(t, [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [-2, 2, 5, 9]][Math.floor(this.step / 8) % 4]);
      this.nextBeat += sp; this.step++;
    }
  }
  drum(t, kind, v = 1) {
    const c = this.ctx;
    if (kind === 'kick') { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); this.env(g, t, 0.002, 0.55, 0.22); o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.3); return; }
    const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    if (kind === 'snare') { f.type = 'bandpass'; f.frequency.value = 1800; this.env(g, t, 0.002, 0.3, 0.14); }
    else { f.type = 'highpass'; f.frequency.value = 7000; this.env(g, t, 0.001, 0.08 * v, 0.03); }
    n.connect(f); f.connect(g); g.connect(this.musicBus); n.start(t); n.stop(t + 0.2);
  }
  chord(t, notes) {
    const c = this.ctx, base = 220 * Math.pow(2, -9 / 12);
    for (const k of notes) {
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = base * Math.pow(2, k / 12); f.type = 'lowpass'; f.frequency.value = 1200;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 1.5);
    }
  }
}
export const audio = new Audio();
if (typeof window !== 'undefined') {
  const unlock = () => { audio.unlocked = true; audio.ensure(); };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}
