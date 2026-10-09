// v0.4.7.5 green release sounds: what plays when a green (Excellent) release goes in. All synthesized (no samples,
// nothing to download).
// v0.4.7.5 quick patch: twice as many (32), and every one remade to sound like what it's called. They're rendered
// sample by sample (core/sfx.js) instead of with live Web Audio nodes, which is what makes them believable: a raptor's
// scream with real rasp in it, bells and glass and coins that ring with their own partials, a choir in a cathedral,
// water made of bubbles, applause made of claps. A sound is rendered once per player (in the background when a game
// starts) and played from its buffer, at the same loudness as every other.
//   pitch: each AI player's own pitch (applied on playback), rate: his tempo (rendered in), power: threes and big
//   shots (louder, and the crowd goes up), pan, vol.
import { Synth, midi as NOTE, hashStr } from './sfx.js';

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
  // v0.4.7.5 quick patch
  gsnd_owl: 'Night Owl',
  gsnd_wolf: 'Wolf Howl',
  gsnd_whistle: 'Steam Whistle',
  gsnd_bells: 'Victory Bells',
  gsnd_ringbell: 'Knockout Bell',
  gsnd_glass: 'Shattered Glass',
  gsnd_bowling: 'Strike!',
  gsnd_rimshot: 'Rimshot',
  gsnd_bassdrop: 'Bass Drop',
  gsnd_sonar: 'Sonar Ping',
  gsnd_ovation: 'Standing Ovation',
  gsnd_siren: 'Five-Alarm',
  gsnd_boing: 'Boing',
  gsnd_cuckoo: 'Cuckoo',
  gsnd_fanfare: 'Royal Fanfare',
  gsnd_gavel: 'Case Closed',
};
export const GREEN_SOUND_IDS = Object.keys(GREEN_SOUNDS);

const TAU = Math.PI * 2;
// small building blocks
// a short noise burst through a band (clicks, knocks, slaps, snares)
function burst(D, t0, { f = 2000, q = 1, tau = 0.004, hp = 0, gain = 1, rev = 0 } = {}) {
  const s = D.svf(f, q), h = hp ? D.svf(hp, 0.7) : null;
  D.play(t0, tau * 7, t => { let x = s.bp(D.white()); if (h) x = h.hp(x); return x * Math.exp(-t / tau) * Math.min(1, t * 4000); }, gain, rev);
}
// a pitched thump: a sine dropping from f0 to f1 (kicks, toms, the body of a knock)
function thump(D, t0, f0, f1, tau, gain = 1, rev = 0, fall = 0.03) {
  const o = D.osc(0);
  D.play(t0, tau * 7, t => o.sin(f1 + (f0 - f1) * Math.exp(-t / fall)) * Math.exp(-t / tau) * Math.min(1, t * 1500), gain, rev);
}
// a bubble in water (it rings and rises as it closes: van den Doel's model)
function bubble(D, t0, f0, amp, rev = 0, rise = 0.1) {
  const d = 0.13 * f0 + 0.0072 * Math.pow(f0, 1.5), o = D.osc(0);
  D.play(t0, 6 / d, t => o.sin(f0 * (1 + rise * d * t)) * Math.exp(-d * t) * Math.min(1, t * f0 * 0.5), amp, rev);
}
// modes with a twin a hair apart, so they beat (a real bell or gong never rings perfectly round)
const twin = (D, list, split = 0.0035) => list.flatMap(([f, a, tau, att]) => [[f, a * 0.62, tau, att], [f * (1 + split * D.rnd(0.6, 1.4)), a * 0.45, tau * 0.92, att]]);
// a brass player: a saw whose brightness follows how hard he blows, a scoop up into each note, a little vibrato late
function brass(D, t0, len, f, { gain = 1, rev = 0, detune = 0, bright = 1, vib = 0.005, scoop = 0.035 } = {}) {
  const o = D.osc(), lp = D.svf(f * 2, 0.9), w = D.drift(9), F = f * Math.pow(2, detune / 1200);
  D.play(t0, len + 0.18, t => {
    const a = t < 0.03 ? t / 0.03 * 1.15 : t < 0.08 ? 1.15 - (t - 0.03) / 0.05 * 0.15 : t < len ? 1 - 0.1 * (t - 0.08) / Math.max(0.1, len) : Math.max(0, 0.9 * (1 - (t - len) / 0.18));
    const fr = F * (1 - scoop * Math.exp(-t / 0.025)) * (1 + (t > 0.18 ? vib * Math.sin(TAU * 5.6 * t) : 0) + 0.002 * w.next());
    lp.set(fr * (1.1 + 6.5 * bright * Math.pow(Math.max(0, a), 1.4)), 0.9);
    return lp.lp(o.saw(fr)) * a;
  }, gain, rev);
}
// a voice: a buzzing glottis (saw, with jitter and a breath) for the formant filters to shape
function glottis(D, jitter = 0.004) { const o = D.osc(), j = D.drift(180), tilt = D.svf(900, 0.6); return (f, br = 0.05) => tilt.lp(o.saw(f * (1 + jitter * j.next()))) + br * D.white(); }

const RECIPES = {
  // two glassy chime notes a fifth apart: the green everybody starts with
  gsnd_basic(D) {
    const note = (t, f, a) => D.modes(t, [[f, a, 0.3], [f * 1.002, a * 0.4, 0.28], [f * 2.0, a * 0.16, 0.12], [f * 2.76, a * 0.12, 0.06], [f * 5.4, a * 0.05, 0.025]], 1, 0.3);
    note(0, 1568, 0.5); note(0.085, 2349, 0.55);
    D.room = { decay: 0.8, damp: 0.3, wet: 1 };
  },

  // the raptor's scream: a piercing "kee-eeee-arrr" that starts with a quick rise, holds high, and tears down into a
  // hoarse rasp at the end (cycle-to-cycle jitter, period doubling, a breath of noise riding each cycle), then rings
  // off the canyon walls
  gsnd_eagle(D) {
    const len = 1.45;
    const f0 = D.env([[0, 1700], [0.045, 2300], [0.13, 2600], [0.55, 2480], [0.95, 2200], [1.2, 1800], [len, 1250]], true);
    const amp = D.env([[0, 0], [0.02, 0.5], [0.08, 1], [0.85, 0.95], [1.15, 0.78], [1.35, 0.4], [len, 0]]);
    const rasp = D.env([[0, 0.45], [0.5, 0.5], [0.95, 0.7], [len, 1]]);
    const o = D.osc(), jit = D.drift(320), wob = D.drift(8), am = D.drift(160);
    const nz = D.svf(3000, 1.6), body = D.bq('peak', 3300, 0.9, 5), hp = D.bq('hp', 1200, 0.7), lp = D.bq('lp', 11000, 0.7);
    let odd = 1;
    D.play(0, len, t => {
      const r = rasp.at(t), f = f0.at(t) * (1 + 0.036 * jit.next() * (0.5 + r) + 0.014 * wob.next());
      const p0 = o.p;
      let s = o.harm(f, [1, 0.6, 0.3, 0.13, 0.05, 0.02]);
      if (o.p < p0) odd = -odd;
      s *= 1 + 0.45 * r * odd; // every other cycle louder: the subharmonic growl
      s *= 1 - 0.7 * r * (0.5 + 0.5 * am.next()); // the rattle
      const n = nz.set(f * 1.25, 1.1).bp(D.white()) * (0.5 + 1.2 * r) * (0.45 + 0.55 * Math.abs(s));
      return lp.run(hp.run(body.run(0.55 * s + 0.5 * n))) * amp.at(t);
    }, 1, 0.22);
    D.echo([[0.36, 0.26, 3600], [0.71, 0.12, 2600], [1.07, 0.05, 2000]]);
    D.room = { decay: 1.6, damp: 0.35, wet: 0.8, hp: 600 };
  },

  // a crowd chanting "GREEEEN!": 25 voices in 9 throats (men, women and a couple of kids, each throat its own size,
  // so its own vowel), each coming in on his own, through an "r" sliding into "ee" and closing to an "n", then the roar
  gsnd_chant(D) {
    const len = 1.0;
    for (let gi = 0; gi < 9; gi++) {
      const kind = gi < 4 ? 'm' : gi < 8 ? 'f' : 'k';
      const sc = kind === 'm' ? D.rnd(0.94, 1.05) : kind === 'f' ? D.rnd(1.12, 1.23) : D.rnd(1.28, 1.36);
      const lag = D.rnd(0, 0.05), L = len * D.rnd(0.9, 1.08), close = L - D.rnd(0.12, 0.2);
      const F1 = D.env([[0, 440 * sc], [0.09 + lag, 300 * sc]], true), F2 = D.env([[0, 1050 * sc], [0.13 + lag, 2250 * sc], [close, 2200 * sc], [L, 1250 * sc]], true);
      const F3 = D.env([[0, 1700 * sc], [0.13 + lag, 2950 * sc]], true), NS = D.env([[0, 3900 * sc], [close, 3900 * sc], [L, 460 * sc]], true);
      const vw = D.formants([[300 * sc, 5, 1], [1100 * sc, 8, 0.6], [1700 * sc, 9, 0.4]]), nasal = D.svf(3900 * sc, 0.75), br = D.svf(1400, 0.6);
      const voices = [];
      for (let i = 0; i < (kind === 'k' ? 1 : 3); i++) {
        const base = kind === 'm' ? D.rnd(150, 205) : kind === 'f' ? D.rnd(255, 345) : D.rnd(380, 440);
        const t0 = lag + D.rnd(0, 0.09), dur = Math.max(0.55, L - t0 + D.rnd(-0.06, 0.05)), det = Math.pow(2, D.rnd(-25, 25) / 1200);
        voices.push({ o: D.osc(), a: 0, da: 0, cf: 0, t0, dur, att: D.rnd(0.03, 0.07), pk: D.rnd(0.075, 0.12), vr: D.rnd(4, 7.5), vd: D.rnd(0.008, 0.02),
          f: D.env([[0, base * D.rnd(0.76, 0.86) * det], [D.rnd(0.09, 0.15), base * det], [dur * 0.75, base * D.rnd(1, 1.08) * det], [dur, base * D.rnd(0.84, 0.94) * det]], true) });
      }
      // (the formants, pitches and levels move at a control rate: every 16 samples, levels ramped in between)
      const K = 16, kdt = K / (D.sr * D.ts);
      D.play(0, L + 0.3, (t, i) => {
        if ((i & 15) === 0) {
          vw.set(0, F1.at(t)); vw.set(1, F2.at(t)); vw.set(2, F3.at(t)); nasal.set(NS.at(t));
          for (const v of voices) {
            const amp = u => (u < 0 || u > v.dur + 0.25 ? 0 : u < v.att ? u / v.att : u < v.att + v.dur * 0.66 ? 1 : Math.exp(-(u - v.att - v.dur * 0.66) / 0.05));
            const u = t - v.t0, a0 = amp(u);
            v.a = a0 * v.pk; v.da = (amp(u + kdt) - a0) * v.pk / K;
            v.cf = u < 0 ? 0 : v.f.at(u) * (1 + v.vd * Math.sin(TAU * v.vr * u));
          }
        }
        let x = 0;
        for (const v of voices) { if (v.a > 0 || v.da > 0) x += v.o.saw(v.cf) * v.a; v.a += v.da; }
        const b = t >= lag && t < lag + L * 0.6 + 0.25 ? br.hp(D.white()) * 0.03 * Math.min(1, (t - lag) / 0.04) * (t > lag + L * 0.6 ? Math.exp(-(t - lag - L * 0.6) / 0.05) : 1) : 0;
        return vw.run(nasal.lp(x) + b);
      }, 1.1, 0.12);
    }
    burst(D, 0, { f: 1500, q: 1.5, tau: 0.02, gain: 0.25 }); // the hard "g"
    // the roar after it: the crowd's "YEAAAH" (open-vowel voices sliding up and away) over the noise of the stands
    for (let v = 0; v < 12; v++) {
      const g = glottis(D, 0.012), base = D.rnd(170, 380), t0 = len - 0.05 + D.rnd(0, 0.15), L2 = D.rnd(0.7, 1.2);
      const fm = D.formants([[D.rnd(650, 850), 4, 1], [D.rnd(1100, 1400), 6, 0.55], [2600, 8, 0.25]]);
      const f = D.env([[0, base], [0.15, base * 1.25], [L2, base * 0.85]], true), A = D.env([[0, 0], [0.08, 1], [L2 * 0.5, 0.5], [L2, 0]]);
      let cf = base, ca = 0;
      D.play(t0, L2, (t, i) => { if ((i & 15) === 0) { cf = f.at(t); ca = A.at(t); } return fm.run(g(cf, 0.15)) * ca; }, 0.085, 0.35);
    }
    const roar = D.svf(1050, 0.6);
    D.play(len - 0.05, 1.5, t => roar.bp(D.white()) * (t < 0.15 ? t / 0.15 : t < 0.55 ? 1 : Math.exp(-(t - 0.55) / 0.22)), 0.08, 0.4);
    D.echo([[0.029, 0.3, 3400], [0.047, 0.22, 2600], [0.071, 0.16, 1900], [0.103, 0.1, 1400]]);
    D.room = { decay: 1.1, damp: 0.4, wet: 0.7 };
  },

  // the old register: the keys clunk ("cha"), the bell rings ("ching!"), the drawer rolls out and the coins jump
  gsnd_register(D) {
    for (const [t, a] of [[0, 0.9], [0.016, 0.6], [0.037, 1]]) {
      D.modes(t, [[D.rnd(3200, 3900), 0.5 * a, 0.012], [D.rnd(5200, 6400), 0.35 * a, 0.008], [D.rnd(1500, 1900), 0.4 * a, 0.015]], 1, 0.15);
      burst(D, t, { f: 3500, q: 0.8, tau: 0.0015, gain: 0.7 * a });
    }
    thump(D, 0.035, 240, 150, 0.035, 0.6);
    const f = 2580;
    D.modes(0.075, twin(D, [[f, 0.6, 0.36], [f * 2.71, 0.38, 0.18], [f * 4.93, 0.2, 0.08], [f * 7.45, 0.09, 0.04], [f * 0.505, 0.05, 0.22]], 0.0042), 1, 0.25);
    burst(D, 0.075, { f: 6000, q: 0.7, tau: 0.002, gain: 0.5 });
    // the drawer rolling out, and the bump at the end of its run
    const roll = D.svf(900, 0.8), rr = D.drift(45);
    D.play(0.16, 0.3, t => roll.bp(D.white()) * (0.6 + 0.4 * rr.next()) * Math.min(1, t / 0.05) * (t > 0.25 ? Math.max(0, 1 - (t - 0.25) / 0.05) : 1), 0.18);
    thump(D, 0.45, 160, 110, 0.05, 0.7);
    D.modes(0.45, [[420, 0.25, 0.04], [910, 0.15, 0.03]], 1);
    for (let i = 0; i < 16; i++) {
      const t = 0.455 + Math.pow(D.rand(), 1.6) * 0.32, x = D.rnd(4300, 7600), a = D.rnd(0.06, 0.16) * (1 - (t - 0.45) * 1.5);
      D.modes(t, [[x, a, D.rnd(0.02, 0.05)], [x * D.rnd(1.45, 1.75), a * 0.6, 0.02], [x * D.rnd(2.3, 2.7), a * 0.3, 0.012]], 1, 0.2);
    }
    D.room = { decay: 0.7, damp: 0.35, wet: 1 };
  },

  // short, short, loooong: a single reed horn blasting (and its octave), buzzy, scooping up into pitch every time
  gsnd_airhorn(D) {
    const f = 452, horn = D.bq('peak', 1700, 1.1, 7), horn2 = D.bq('peak', 3100, 1.4, 4), hp = D.bq('hp', 260, 0.7), lp = D.bq('lp', 6500, 0.7), air = D.svf(2600, 0.8);
    const layers = [[1, 1, 0.33], [1.006, 0.7, 0.3], [0.995, 0.7, 0.36], [0.5, 0.45, 0.4]].map(([m, g, d]) => ({ o: D.osc(), m, g, d }));
    const blasts = [[0, 0.16], [0.245, 0.16], [0.49, 0.78]], w = D.drift(14);
    D.play(0, 1.35, t => {
      let a = 0, sc = 1;
      for (const [t0, len] of blasts) {
        const u = t - t0;
        if (u < 0 || u > len + 0.05) continue;
        a = u < 0.012 ? u / 0.012 : u < len ? 1 : 1 - (u - len) / 0.05;
        sc = (1 - 0.1 * Math.exp(-u / 0.018)) * (u > len - 0.03 ? 1 - 0.03 * (u - len + 0.03) / 0.08 : 1);
      }
      if (a <= 0) { for (const l of layers) l.o.adv(f * l.m); return 0; }
      const fr = f * sc * (1 + 0.003 * w.next());
      let x = 0;
      for (const l of layers) x += l.o.pulse(fr * l.m, l.d) * l.g;
      x = Math.tanh(1.8 * x) + 0.08 * air.bp(D.white());
      return lp.run(hp.run(horn2.run(horn.run(x)))) * a;
    }, 1, 0.1);
    D.echo([[0.11, 0.08, 3500]]);
    D.room = { decay: 1.2, damp: 0.3, wet: 0.8 };
  },

  // a slot machine paying out: the reels clatter and clunk to a stop, then the alarm bell rings and rings while the
  // coins pour into the metal tray
  gsnd_jackpot(D) {
    let t = 0, k = 0;
    while (t < 0.55) {
      const a = 0.5 + 0.5 * D.rand();
      D.modes(t, [[D.rnd(2200, 2900), 0.12 * a, 0.006], [D.rnd(4200, 5000), 0.06 * a, 0.004]], 1);
      t += 1 / (30 - 26 * t); k++;
    }
    for (const s of [0.3, 0.42, 0.55]) { thump(D, s, 220, 140, 0.03, 0.45); D.modes(s, [[620, 0.2, 0.03], [1350, 0.12, 0.02]], 1); burst(D, s, { f: 2500, tau: 0.002, gain: 0.3 }); }
    // the bell: a steel gong struck 18 times a second by its clapper
    const bf = 1180, bell = twin(D, [[bf, 0.5, 0.35], [bf * 2.36, 0.4, 0.16], [bf * 2.92, 0.3, 0.12], [bf * 4.15, 0.22, 0.07], [bf * 5.9, 0.12, 0.04]], 0.004);
    for (let s = 0.62; s < 1.9; s += 1 / 18) D.modes(s + D.rnd(-0.004, 0.004), bell.map(([f, a, tau]) => [f, a * D.rnd(0.6, 1) * (s > 1.6 ? (1.9 - s) / 0.3 : 1), tau]), 0.55, 0.25);
    // the coins: each hits the tray (a dull steel bong) and rings for a moment itself
    for (let i = 0; i < 46; i++) {
      const s = 0.66 + Math.pow(D.rand(), 1.35) * 1.25, x = D.rnd(4000, 7800), a = D.rnd(0.05, 0.13) * (s > 1.6 ? 0.6 : 1);
      D.modes(s, [[x, a, D.rnd(0.03, 0.08)], [x * D.rnd(1.4, 1.8), a * 0.55, 0.025], [D.rnd(700, 1050), a * 0.5, 0.05]], 1, 0.15);
    }
    D.room = { decay: 1.1, damp: 0.3, wet: 1 };
  },

  // squee-squee: a rubber duck squeezed twice, the air whistling through its squeaker reed (rising as the squeeze
  // builds), and the wheezy little gasp each time it lets go
  gsnd_duck(D) {
    const squeeze = (t0, len, fb, g, gasp) => {
      const o = D.osc(), j = D.drift(70), d = D.drift(30), body = D.svf(2700, 2.2), reed = D.svf(fb * 2, 2), lp = D.bq('lp', 8000, 0.7);
      const P = gasp ? D.env([[0, 0], [0.025, 0.7], [len * 0.5, 0.5], [len, 0]]) : D.env([[0, 0], [0.018, 0.75], [0.05, 1], [len * 0.7, 0.8], [len, 0]]);
      D.play(t0, len, t => {
        const p = P.at(t), f = fb * (0.72 + 0.4 * p) * (1 + 0.018 * j.next()) * (1 + (gasp ? 0 : 0.12 * Math.exp(-t / 0.012)));
        const x = o.pulse(f, 0.16 + 0.05 * d.next()) * (gasp ? 0.35 : 1) + reed.bp(D.white()) * (gasp ? 0.9 : 0.25);
        return lp.run(0.55 * x + body.bp(x) * 0.9) * Math.pow(p, 1.4);
      }, g, 0.15);
    };
    squeeze(0, 0.17, 1500, 1); squeeze(0.18, 0.1, 1050, 0.45, true);
    squeeze(0.33, 0.19, 1650, 1.05); squeeze(0.53, 0.11, 1100, 0.45, true);
    D.room = { decay: 0.5, damp: 0.3, wet: 1 };
  },

  // pew, pew (blaster bolts: fast falling chirps with a metal twang), a charge-up whine, then the big shot
  gsnd_laser(D) {
    const pew = (t0, fa, fb, len, g, thick = 1) => {
      const os = Array.from({ length: thick }, () => D.osc()), tau = len / 4.2;
      D.play(t0, len, t => {
        const f = fb + (fa - fb) * Math.exp(-t / tau);
        let x = 0;
        os.forEach((o, i) => { x += o.harm(f * (1 + i * 0.013), [1, 0.5, 0.32, 0.12]); });
        return Math.tanh(1.4 * x / thick) * Math.exp(-t / (len * 0.45)) * Math.min(1, t / 0.0015);
      }, g, 0.25);
    };
    pew(0, 4200, 260, 0.2, 0.8); pew(0.15, 3900, 240, 0.2, 0.75);
    const c = D.osc(), cf = D.env([[0, 240], [0.4, 2600]], true);
    D.play(0.34, 0.42, t => c.harm(cf.at(t), [1, 0.25, 0.1]) * (0.35 + 0.65 * Math.abs(Math.sin(TAU * (8 + 50 * t) * t))) * Math.min(1, t / 0.1) * 0.5, 0.6, 0.2);
    pew(0.77, 5200, 110, 0.55, 1, 3);
    const n = D.svf(4000, 0.9), nf = D.env([[0, 5000], [0.45, 300]], true);
    D.play(0.77, 0.5, t => n.set(nf.at(t)).bp(D.white()) * Math.exp(-t / 0.12), 0.35, 0.3);
    thump(D, 0.77, 130, 45, 0.18, 0.7, 0.2, 0.06);
    D.room = { decay: 1.3, damp: 0.25, wet: 1 };
  },

  // a big gong struck once: the mallet's thump, the deep note, then the shimmer blooming up through the high
  // partials (they swell in after the strike) and the whole thing washing out over the courts
  gsnd_gong(D) {
    const f0 = 92, list = [[f0, 0.9, 0.85, 0.002], [f0 * 1.006, 0.5, 0.8, 0.002], [f0 * 1.52, 0.45, 0.7, 0.002], [f0 * 2.03, 0.35, 0.6, 0.003]];
    // the shimmer: a dense cloud of partials up to ~7 kHz that swell in after the strike (the bloom) and beat
    for (let i = 0; i < 84; i++) {
      const f = Math.exp(D.rnd(Math.log(230), Math.log(7200)));
      list.push([f, D.rnd(0.06, 0.16) * Math.pow(f / 600, -0.15), D.rnd(0.5, 1.1) * Math.pow(f / 600, -0.2), f > 600 ? D.rnd(0.12, 0.7) : 0.004]);
    }
    D.modes(0, list, 1, 0.3);
    const m = D.svf(260, 0.7);
    D.play(0, 0.15, t => m.lp(D.white()) * Math.exp(-t / 0.025), 0.9, 0.3);
    thump(D, 0, 110, 70, 0.1, 0.5);
    D.room = { decay: 2.4, damp: 0.25, wet: 0.9 };
  },

  // an 8-bit fanfare, the way an old console plays it: two pulse channels and a triangle bass, the volume stepping
  // down frame by frame
  gsnd_levelup(D) {
    const p1 = D.osc(0), p2 = D.osc(0), tr = D.osc(0), lp = D.bq('lp', 12000, 0.7), hp = D.bq('hp', 90, 0.7);
    const q = (v, steps = 15) => Math.round(v * steps) / steps;
    const frame = t => Math.floor(t * 60) / 60;
    const mel = [[72, 0, 0.065], [76, 0.065, 0.065], [79, 0.13, 0.065], [84, 0.195, 0.065], [88, 0.26, 0.07], [91, 0.33, 0.62]];
    const har = [[67, 0, 0.065], [72, 0.065, 0.065], [76, 0.13, 0.065], [79, 0.195, 0.065], [84, 0.26, 0.07], [88, 0.33, 0.62]];
    const at = (seq, t) => { for (const [n, t0, l] of seq) if (t >= t0 && t < t0 + l) return [NOTE(n), t - t0, l]; return null; };
    D.play(0, 0.98, t => {
      const tf = frame(t);
      let x = 0;
      const a = at(mel, t);
      if (a) { const [f, u, l] = a, uf = frame(u), vib = l > 0.3 && u > 0.12 ? 1 + 0.012 * Math.sin(TAU * 7 * t) : 1; x += p1.pulse(f * vib, 0.25) * q(l > 0.3 ? Math.max(0, 1 - uf * 1.4) : Math.max(0.4, 1 - uf * 4)) * 0.5; } else p1.adv(440);
      const b = at(har, t);
      if (b) { const [f, u, l] = b, uf = frame(u); x += p2.pulse(f, 0.125) * q(l > 0.3 ? Math.max(0, 0.7 - uf * 1.1) : Math.max(0.3, 0.7 - uf * 3)) * 0.4; } else p2.adv(440);
      const bf = tf < 0.33 ? NOTE(48) : NOTE(55);
      x += tr.tri(bf) * (t < 0.9 ? 0.55 : 0);
      return lp.run(hp.run(x));
    }, 1, 0.08);
    D.room = { decay: 0.6, damp: 0.3, wet: 1 };
  },

  // a strike right overhead: the air tearing open (a rip of sharp cracks), the boom, then the thunder rolling away
  // with its swells
  gsnd_thunder(D) {
    const cr = [];
    for (let i = 0; i < 70; i++) { const t = 0.22 * Math.pow(D.rand(), 2.2); cr.push([t, D.rnd(0.25, 1) * Math.exp(-t / 0.09), D.rnd(0.0003, 0.0022)]); }
    cr.push([0.008, 1.6, 0.004]);
    const hp = D.bq('hp', 70, 0.7), lp = D.bq('lp', 7500, 0.7);
    D.play(0, 0.32, t => {
      let x = 0;
      for (const [t0, a, w] of cr) { const u = t - t0; if (u >= 0 && u < w) x += a * Math.sin(TAU * u / w); }
      return lp.run(hp.run(x));
    }, 0.9, 0.5);
    const tear = D.svf(2200, 0.6);
    D.play(0, 0.35, t => tear.bp(D.white()) * Math.exp(-t / 0.07), 0.35, 0.4);
    // the boom and the roll: low noise with slow swells
    const sw = D.drift(2.6), sw2 = D.drift(7), low = D.svf(150, 0.9), mid = D.svf(420, 0.7);
    const E = D.env([[0, 0], [0.04, 1], [0.25, 0.75], [0.6, 0.5], [0.85, 0.62], [1.3, 0.35], [1.6, 0.42], [2.6, 0.08], [3.0, 0]]);
    D.play(0.02, 3.0, t => {
      const s = (0.75 + 0.25 * sw.next()) * (0.85 + 0.15 * sw2.next()), b = D.noise.brown();
      return (low.lp(b) * 1.4 + mid.bp(D.white()) * 0.35) * E.at(t) * s;
    }, 1.2, 0.25);
    D.room = { decay: 2.6, damp: 0.45, wet: 1, hp: 60, lp: 5000 };
  },

  // the bugle charge (G C E G, E G!) hummed through a kazoo: a voice, the paper membrane buzzing on it, "doo"s
  gsnd_kazoo(D) {
    const notes = [[67, 0, 0.11], [72, 0.13, 0.11], [76, 0.26, 0.11], [79, 0.39, 0.2], [76, 0.62, 0.1], [79, 0.74, 0.42]];
    const g = glottis(D, 0.005), rat = D.drift(220), f1 = D.bq('peak', 1150, 2.2, 8), f2 = D.bq('peak', 2700, 2.5, 6), hp = D.bq('hp', 280, 0.7), lp = D.bq('lp', 7200, 0.7);
    const cur = t => { let r = null; for (const n of notes) if (t >= n[1]) r = n; return r; };
    D.play(0, 1.24, t => {
      const [n, t0, len] = cur(t), u = t - t0;
      const a = u < 0.02 ? 0.25 + 0.75 * u / 0.02 : u < len ? 1 : Math.max(0, 1 - (u - len) / 0.04);
      const f = NOTE(n) * (1 - 0.035 * Math.exp(-u / 0.02)) * (1 + (len > 0.3 && u > 0.12 ? 0.012 * Math.sin(TAU * 6 * u) : 0));
      const v = g(f, 0.02) * a;
      // the membrane: it slaps shut on every cycle (clipping) and rattles (noise riding the waveform)
      const m = Math.tanh(3.2 * v) + 0.35 * D.white() * Math.abs(v) * (0.6 + 0.4 * rat.next());
      return lp.run(hp.run(f2.run(f1.run(m)))) * (u < 0.012 ? 1 + 0.25 * D.white() * (1 - u / 0.012) : 1);
    }, 1, 0.12);
    D.room = { decay: 0.6, damp: 0.3, wet: 1 };
  },

  // "aaaah": a choir (basses, tenors, altos, sopranos, each section with its own vowel) swells into one C major chord
  // in a cathedral, a harp running up under it
  gsnd_choir(D) {
    const sections = [
      [[48, 48, 48], [[600, 6, 1], [1040, 8, 0.45], [2250, 12, 0.2], [2450, 12, 0.15], [2750, 14, 0.1]], 0.9],
      [[55, 55, 60], [[650, 6, 1], [1080, 8, 0.5], [2650, 12, 0.25], [2900, 12, 0.2], [3250, 14, 0.1]], 0.8],
      [[64, 64, 67], [[800, 6, 1], [1150, 8, 0.6], [2800, 12, 0.15], [3500, 14, 0.1], [4950, 14, 0.05]], 0.75],
      [[72, 72, 76, 76], [[800, 6, 1], [1150, 8, 0.5], [2900, 12, 0.12], [3900, 14, 0.08], [4950, 14, 0.04]], 0.7],
    ];
    for (const [ns, forms, g] of sections) {
      const fm = D.formants(forms);
      const vs = ns.map(n => ({ g: glottis(D, 0.003), f: NOTE(n) * Math.pow(2, D.rnd(-9, 9) / 1200), t0: D.rnd(0, 0.08), vr: D.rnd(4.8, 6), vd: D.rnd(0.004, 0.007), vp: D.rnd(0, TAU), dr: D.drift(0.7) }));
      const K = 16, kdt = K / (D.sr * D.ts);
      const amp = u => (u < 0 ? 0 : u < 0.45 ? Math.pow(u / 0.45, 1.5) : u < 1.55 ? 1 - 0.1 * (u - 0.45) : Math.max(0, 0.89 * (1 - (u - 1.55) / 0.5)));
      D.play(0, 2.3, (t, i) => {
        if ((i & 15) === 0) {
          for (const v of vs) {
            const u = t - v.t0, a0 = amp(u);
            v.a = a0; v.da = (amp(u + kdt) - a0) / K;
            v.cf = v.f * (1 - 0.02 * Math.exp(-Math.max(0, u) / 0.08)) * (1 + v.vd * Math.min(1, Math.max(0, u) / 0.4) * Math.sin(TAU * v.vr * u + v.vp) + 0.002 * v.dr.next());
          }
        }
        let x = 0;
        for (const v of vs) { if (v.a > 0 || v.da > 0) x += v.g(v.cf, 0.06) * v.a; v.a += v.da; }
        return fm.run(x);
      }, g / ns.length * 1.6, 0.6);
    }
    [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96].forEach((n, i) => D.pluck(0.02 + i * 0.03, NOTE(n), 1.1, 0.16, 0.5, 0.75));
    D.room = { decay: 3.4, damp: 0.25, wet: 0.85, pre: 0.025, size: 1.15 };
  },

  // a cannonball into the deep end: the slap, the "kerplunk" of the cavity closing, the spray (hundreds of bubbles
  // and drops), and the drips falling back
  gsnd_splash(D) {
    burst(D, 0, { f: 1800, q: 0.5, tau: 0.018, gain: 0.8, rev: 0.2 });
    thump(D, 0, 140, 55, 0.07, 0.4, 0.1, 0.03);
    bubble(D, 0.12, 190, 0.9, 0.2, 0.25);
    bubble(D, 0.16, 260, 0.6, 0.2, 0.2);
    for (let i = 0; i < 520; i++) {
      const t = 0.01 + Math.pow(D.rand(), 1.7) * 0.85, big = D.rand() < 0.25;
      bubble(D, t, big ? D.rnd(350, 900) : Math.exp(D.rnd(Math.log(900), Math.log(4200))), D.rnd(0.05, 0.22) * (big ? 1.4 : 1) * Math.exp(-t / 0.5), 0.15, D.rnd(0.05, 0.3));
    }
    const sp = D.svf(2400, 0.6), sf = D.env([[0, 1500], [0.1, 3400], [0.7, 1700]], true), ss = D.drift(60);
    D.play(0.01, 1.0, t => sp.set(sf.at(t)).bp(D.white()) * (0.55 + 0.45 * ss.next()) * (t < 0.03 ? t / 0.03 : Math.exp(-(t - 0.03) / 0.3)), 0.8, 0.2);
    for (let i = 0; i < 26; i++) { const t = 0.55 + D.rand() * 0.9; bubble(D, t, D.rnd(1400, 3600), D.rnd(0.06, 0.16) * (1.5 - t * 0.6), 0.2, 0.25); burst(D, t, { f: 3000, q: 1, tau: 0.002, gain: 0.04 }); }
    D.room = { decay: 0.9, damp: 0.4, wet: 0.8 };
  },

  // fweeeee-oop! a slide whistle: a breathy, nearly pure pipe tone gliding all the way up, then a flick down and up
  gsnd_slide(D) {
    const f = D.env([[0, 520], [0.42, 1950], [0.47, 1950], [0.53, 1320], [0.62, 1720], [0.66, 1720]], true);
    const o = D.osc(), pb = D.svf(1000, 6), air = D.svf(2500, 0.7), w = D.drift(5.5), aj = D.drift(25);
    D.play(0, 0.7, t => {
      const fr = f.at(t) * (1 + 0.006 * w.next());
      const a = (t < 0.03 ? t / 0.03 : t < 0.63 ? 1 : Math.max(0, 1 - (t - 0.63) / 0.07)) * (1 + 0.04 * aj.next());
      const x = o.harm(fr, [1, 0.1, 0.05]) + 0.5 * pb.set(fr, 6).bp(D.white()) + 0.02 * air.hp(D.white());
      return x * a + (t < 0.025 ? 0.4 * air.bp(D.white()) * (1 - t / 0.025) : 0);
    }, 1, 0.15);
    D.room = { decay: 0.6, damp: 0.3, wet: 1 };
  },

  // King Tut Cup exclusive: two ceremonial horns climbing an old scale, a sistrum rattling, a gong under the top note
  cup_gsnd_pharaoh(D) {
    const notes = [[62, 0, 0.12], [63, 0.14, 0.12], [66, 0.28, 0.12], [67, 0.42, 0.14], [69, 0.58, 0.8]];
    for (const [n, t0, len] of notes) for (const d of [-7, 7]) brass(D, t0, len, NOTE(n), { gain: 0.5, rev: 0.4, detune: d, bright: 0.65, vib: n === 69 ? 0.009 : 0.003 });
    for (let i = 0; i < 7; i++) {
      const s = i * 0.11 + (i > 4 ? 0.1 : 0);
      for (let k = 0; k < 8; k++) { const x = D.rnd(4200, 8800); D.modes(s + D.rnd(0, 0.035), [[x, D.rnd(0.03, 0.07), D.rnd(0.02, 0.05)], [x * D.rnd(1.5, 2.2), 0.02, 0.015]], 1, 0.2); }
    }
    D.modes(0.58, twin(D, [[73.4, 0.5, 0.9], [73.4 * 1.47, 0.3, 0.7], [73.4 * 2.09, 0.22, 0.55], [73.4 * 2.56, 0.15, 0.45], [73.4 * 3.4, 0.08, 0.3, 0.1]]), 1, 0.35);
    D.room = { decay: 2.4, damp: 0.3, wet: 0.9 };
  },

  // ---- v0.4.7.5 quick patch: sixteen more ----

  // a great horned owl in the night: "hoo, h'hoo-hoo, hooo, hooo", soft and low, crickets behind him
  gsnd_owl(D) {
    const hoots = [[0, 0.17, 1], [0.27, 0.09, 0.7], [0.38, 0.13, 0.9], [0.62, 0.3, 1], [1.04, 0.32, 0.95]];
    for (const [t0, len, g] of hoots) {
      const o = D.osc(), br = D.svf(700, 4), lp = D.svf(1600, 0.7), f = 318 * D.rnd(0.98, 1.02);
      D.play(t0, len + 0.08, t => {
        const a = t < 0.035 ? Math.pow(t / 0.035, 2) : t < len ? 1 - 0.15 * (t - 0.035) / len : Math.max(0, 0.85 * (1 - (t - len) / 0.08));
        const fr = f * (1 + 0.04 * Math.min(1, t / 0.05) - 0.07 * Math.max(0, t / (len + 0.08)));
        return lp.lp(o.harm(fr, [1, 0.16, 0.05]) + 0.2 * br.set(fr, 4).bp(D.white())) * a;
      }, g, 0.35);
    }
    // crickets: 4.6 kHz chirps in trains of three
    for (let k = 0; k < 7; k++) {
      const t0 = 0.05 + k * 0.23 + D.rnd(0, 0.03), f = D.rnd(4400, 4800), o = D.osc();
      D.play(t0, 0.09, t => { const p = (t * 33) % 1; return o.sin(f) * (p < 0.55 ? Math.sin(Math.PI * p / 0.55) : 0); }, 0.05, 0.3);
    }
    D.room = { decay: 2.2, damp: 0.45, wet: 0.9, lp: 5000 };
  },

  // a wolf howling at the moon: sliding up into a long "oooo" with a waver in it, falling away at the end, and
  // another one joining in from further off
  gsnd_wolf(D) {
    const howl = (t0, sc, g, rev) => {
      const f0 = D.env([[0, 400], [0.26, 640], [0.5, 690], [1.1, 725], [1.42, 660], [1.75, 455]].map(([t, f]) => [t, f * sc]), true);
      const amp = D.env([[0, 0], [0.08, 0.55], [0.3, 1], [1.3, 0.95], [1.6, 0.55], [1.78, 0]]);
      const o = D.osc(), w = D.drift(4), j = D.drift(60), fm = D.svf(600, 2.5), br = D.svf(1200, 3);
      D.play(t0, 1.8, t => {
        const vib = 1 + 0.009 * Math.min(1, Math.max(0, t - 0.35) / 0.3) * Math.sin(TAU * 5.4 * t) + 0.004 * w.next() + 0.002 * j.next();
        const f = f0.at(t) * vib, x = o.harm(f, [1, 0.22, 0.09, 0.04]);
        fm.set(f * 1.05 + 120, 2.5);
        return (0.55 * x + 0.6 * fm.bp(x) + 0.06 * br.set(f * 2, 3).bp(D.white())) * amp.at(t);
      }, g, rev);
    };
    howl(0, 1, 1, 0.35);
    howl(0.55, 1.19, 0.4, 0.8);
    D.room = { decay: 2.8, damp: 0.4, wet: 0.9, lp: 6000 };
  },

  // a steam locomotive's chime whistle, two long, mournful blasts down the line (the pitch climbs as the steam comes
  // up, and the steam hisses through it)
  gsnd_whistle(D) {
    const chimes = [294, 349, 440, 523].map(f => ({ f, o: D.osc(), n: D.svf(f, 12) })), hiss = D.svf(4500, 0.6), w = D.drift(6);
    const blasts = [[0, 0.6], [0.78, 1.0]];
    D.play(0, 1.95, t => {
      let a = 0, rise = 1;
      for (const [t0, len] of blasts) { const u = t - t0; if (u >= 0 && u < len + 0.12) { a = u < 0.08 ? u / 0.08 : u < len ? 1 : 1 - (u - len) / 0.12; rise = 0.93 + 0.07 * (1 - Math.exp(-u / 0.06)) - (u > len ? 0.03 * (u - len) / 0.12 : 0); } }
      if (a <= 0) { for (const c of chimes) c.o.adv(c.f); return 0; }
      let x = 0;
      for (const c of chimes) { const f = c.f * rise * (1 + 0.003 * w.next()); x += c.o.harm(f, [1, 0.3, 0.12, 0.05]) * 0.7 + c.n.set(f, 12).bp(D.white()) * 0.9; }
      return (x * 0.3 + hiss.hp(D.white()) * 0.05) * a;
    }, 1, 0.3);
    D.echo([[0.45, 0.22, 2400], [0.95, 0.08, 1800]]);
    D.room = { decay: 2.0, damp: 0.4, wet: 0.8 };
  },

  // the church bells ring out: four bells down the scale and the first again, each with a real bell's partials
  // (the hum an octave under, the minor-third tierce, the quint, the nominal) and the wow of its beats
  gsnd_bells(D) {
    const P = [[0.5, 0.45, 1.0], [1.0, 0.42, 0.6], [1.183, 0.4, 0.5], [1.506, 0.2, 0.35], [2.0, 0.75, 0.38], [2.514, 0.28, 0.22], [2.662, 0.3, 0.2], [3.011, 0.22, 0.14], [4.166, 0.14, 0.09], [5.433, 0.07, 0.06]];
    const strike = (t0, prime, g) => {
      D.modes(t0, twin(D, P.map(([r, a, tau]) => [prime * r, a, tau * 1.3 * Math.pow(523 / prime, 0.4)]), 0.0025), g, 0.35);
      burst(D, t0, { f: prime * 3.2, q: 1.2, tau: 0.006, gain: 0.25 * g });
    };
    [[0, 659.3, 1], [0.27, 587.3, 1], [0.54, 523.3, 1], [0.81, 392, 1.1], [1.14, 659.3, 0.95]].forEach(([t, f, g]) => strike(t, f, g));
    D.room = { decay: 2.6, damp: 0.3, wet: 0.8 };
  },

  // the bell at ringside: ding, ding, ding! (a steel gong bell, hammered three times, ringing out over the arena)
  gsnd_ringbell(D) {
    const f = 820, M = [[f, 1, 0.6], [f * 2.32, 0.6, 0.32], [f * 4.25, 0.45, 0.17], [f * 6.45, 0.25, 0.1], [f * 8.9, 0.12, 0.06], [f * 11.6, 0.06, 0.035]];
    for (const [t, g] of [[0, 0.9], [0.17, 0.95], [0.34, 1]]) {
      D.modes(t, twin(D, M.map(([x, a, tau]) => [x, a * D.rnd(0.85, 1.1), tau]), 0.004), 0.5 * g, 0.3);
      burst(D, t, { f: 3500, q: 0.7, tau: 0.002, gain: 0.5 * g });
    }
    D.room = { decay: 1.8, damp: 0.3, wet: 0.9 };
  },

  // a pane of glass smashed: the crack, a crash of shards, then the pieces falling and bouncing, tinkling
  gsnd_glass(D) {
    const shard = (t, a, f) => D.modes(t, [[f, a, D.rnd(0.02, 0.07)], [f * D.rnd(1.6, 2.3), a * 0.7, D.rnd(0.012, 0.04)], [f * D.rnd(2.7, 3.9), a * 0.45, D.rnd(0.008, 0.025)]], 1, 0.2);
    burst(D, 0, { f: 4000, q: 0.5, tau: 0.004, gain: 1.2, rev: 0.3 });
    thump(D, 0, 380, 220, 0.02, 0.5);
    const cr = D.svf(5000, 0.5);
    D.play(0, 0.4, t => cr.hp(D.white()) * Math.exp(-t / 0.06) * (0.7 + 0.3 * Math.sin(t * 900)), 0.55, 0.3);
    for (let i = 0; i < 46; i++) shard(0.002 + 0.16 * Math.pow(D.rand(), 2), D.rnd(0.05, 0.18), Math.exp(D.rnd(Math.log(2400), Math.log(9500))));
    for (let i = 0; i < 26; i++) {
      let t = 0.2 + D.rand() * 0.75, gap = D.rnd(0.06, 0.12), a = D.rnd(0.06, 0.14);
      const f = Math.exp(D.rnd(Math.log(2800), Math.log(9000)));
      for (let b = 0; b < 4 && t < 1.5; b++) { shard(t, a, f * D.rnd(0.98, 1.02)); t += gap; gap *= 0.6; a *= 0.55; }
    }
    D.room = { decay: 0.9, damp: 0.3, wet: 1 };
  },

  // a strike: the ball rumbling down the lane, the crack into the pocket, and the pins clattering and spinning down
  gsnd_bowling(D) {
    const rum = D.svf(220, 0.8), lane = D.svf(520, 1.2), rot = D.osc();
    D.play(0, 0.74, t => {
      const a = 0.25 + 0.75 * Math.pow(t / 0.74, 1.6), r = 0.8 + 0.2 * rot.sin(6.5);
      return (rum.lp(D.noise.brown()) * 1.2 + lane.bp(D.white()) * 0.45) * a * r;
    }, 0.7, 0.2);
    const knock = (t, a, base) => {
      D.modes(t, [[base, a, D.rnd(0.008, 0.02)], [base * D.rnd(1.55, 1.7), a * 0.7, 0.01], [base * D.rnd(2.3, 2.6), a * 0.45, 0.007], [base * 0.42, a * 0.4, 0.025]], 1, 0.25);
      burst(D, t, { f: base * 2, q: 0.9, tau: 0.0015, gain: a * 0.6 });
    };
    knock(0.74, 0.9, 1150); thump(D, 0.74, 140, 80, 0.05, 0.9);
    for (let i = 0; i < 42; i++) { const t = 0.75 + Math.pow(D.rand(), 1.8) * 0.8; knock(t, D.rnd(0.12, 0.45) * (1.2 - (t - 0.74)), D.rnd(780, 1500)); }
    for (let i = 0; i < 9; i++) { const t = 0.9 + D.rand() * 0.6; thump(D, t, D.rnd(180, 260), 120, 0.035, 0.35); burst(D, t, { f: 1600, q: 0.8, tau: 0.003, gain: 0.15 }); }
    D.room = { decay: 1.4, damp: 0.35, wet: 0.9 };
  },

  // ba-dum, tss: the snare, the tom, then the kick and the cymbal (the punchline drum fill)
  gsnd_rimshot(D) {
    const snare = (t, g) => {
      thump(D, t, 230, 185, 0.06, 0.7 * g); D.modes(t, [[330, 0.25 * g, 0.04], [520, 0.12 * g, 0.03]], 1);
      const wires = D.svf(4200, 0.7), h = D.svf(1500, 0.7);
      D.play(t, 0.3, u => h.hp(wires.bp(D.white())) * Math.exp(-u / 0.06), 0.65 * g, 0.25);
      burst(D, t, { f: 3000, q: 0.8, tau: 0.001, gain: 0.6 * g });
    };
    const kick = t => { thump(D, t, 150, 50, 0.13, 1, 0.1, 0.025); burst(D, t, { f: 2500, q: 0.7, tau: 0.0012, gain: 0.35 }); };
    snare(0, 1);
    thump(D, 0.15, 165, 112, 0.2, 0.95, 0.2, 0.04); D.modes(0.15, [[235, 0.25, 0.1]], 1); burst(D, 0.15, { f: 1800, q: 0.8, tau: 0.002, gain: 0.35 });
    kick(0.42); snare(0.42, 0.55);
    // the cymbal: six square waves at clashing pitches, high-passed into a metallic wash, plus its sizzle
    const os = [205.3, 304.4, 369.6, 522.7, 540, 800].map(f => ({ o: D.osc(), f: f * 1.9 })), bp = D.svf(8000, 0.8), hp = D.svf(6000, 0.7), sz = D.svf(9000, 0.7);
    D.play(0.42, 1.3, t => {
      let x = 0;
      for (const v of os) x += v.o.pulse(v.f, 0.5);
      return (hp.hp(bp.bp(x)) * 0.28 + sz.hp(D.white()) * 0.55) * (t < 0.002 ? t / 0.002 : Math.exp(-(t - 0.002) / 0.3));
    }, 0.7, 0.3);
    D.room = { decay: 1.0, damp: 0.35, wet: 0.9 };
  },

  // the build-up (a noise riser and a snare roll that speeds up), one beat of nothing, then the drop: an 808 boom,
  // saturated so you hear it on any speaker, wobbling
  gsnd_bassdrop(D) {
    const rs = D.svf(400, 2), rf = D.env([[0, 400], [0.74, 8000]], true);
    D.play(0, 0.76, t => rs.set(rf.at(t), 2).bp(D.white()) * Math.pow(t / 0.76, 1.5), 0.6, 0.3);
    let t = 0.05, gap = 0.13;
    while (t < 0.72) { const g = 0.25 + 0.6 * t / 0.72; thump(D, t, 260 + 200 * t, 200, 0.03, 0.35 * g); burst(D, t, { f: 4000, q: 0.7, tau: 0.03, hp: 1500, gain: 0.45 * g, rev: 0.2 }); t += gap; gap = Math.max(0.028, gap * 0.82); }
    const o = D.osc(0), sub = D.env([[0, 160], [0.06, 52], [1.1, 41]], true), wob = D.svf(400, 3), lp = D.bq('lp', 3000, 0.7);
    D.play(0.82, 1.15, u => {
      const a = u < 0.004 ? u / 0.004 : Math.exp(-u / 0.75), x = o.sin(sub.at(u));
      const dist = Math.tanh(4.5 * x);
      wob.set(250 + 900 * (0.5 + 0.5 * Math.sin(TAU * 3.5 * u - Math.PI / 2)), 3);
      return lp.run(0.35 * x + 0.5 * dist + 0.6 * wob.lp(dist)) * a;
    }, 1);
    burst(D, 0.82, { f: 3000, q: 0.5, tau: 0.09, hp: 1000, gain: 0.5, rev: 0.5 });
    D.room = { decay: 1.4, damp: 0.3, wet: 1 };
  },

  // a submarine's sonar: one pure ping into the deep, the long dark ring of the water, and the echo coming back
  gsnd_sonar(D) {
    const ping = (t0, f, g) => {
      const o = D.osc(0), lp = D.bq('lp', 3500, 0.7);
      D.play(t0, 0.9, t => lp.run(o.harm(f * (1 - 0.006 * t), [1, 0.05])) * (t < 0.004 ? t / 0.004 : t < 0.11 ? 1 : Math.exp(-(t - 0.11) / 0.12)), g, 0.75);
    };
    ping(0, 1460, 1);
    ping(0.95, 1440, 0.22);
    D.room = { decay: 3.0, damp: 0.6, wet: 1, pre: 0.03, lp: 3000, size: 1.2 };
  },

  // a standing ovation: a gym full of people clapping (every clap its own hands), cheering, two finger whistles
  gsnd_ovation(D) {
    for (let p = 0; p < 75; p++) {
      const rate = D.rnd(3.6, 5.6), start = D.rnd(0, 0.3), stop = D.rnd(1.55, 2.1), a0 = D.rnd(0.25, 1), fc = D.rnd(700, 2300), q = D.rnd(1.5, 5);
      for (let t = start; t < stop; t += 1 / rate + D.rnd(-0.012, 0.012)) {
        const s = D.svf(fc * D.rnd(0.95, 1.05), q), tau = D.rnd(0.0025, 0.005), a = a0 * Math.min(1, (t - start) / 0.25 + 0.3) * (t > stop - 0.4 ? (stop - t) / 0.4 : 1);
        D.play(t, tau * 6, u => { const w = D.white(); return (s.bp(w) * 0.8 + w * 0.25) * Math.exp(-u / tau); }, a * 0.2, 0.25);
      }
    }
    for (let v = 0; v < 12; v++) {
      const g = glottis(D, 0.01), base = D.rnd(200, 420), t0 = D.rnd(0.05, 0.5), len = D.rnd(0.6, 1.2), fm = D.formants([[D.rnd(500, 750), 5, 1], [D.rnd(900, 1300), 7, 0.5], [2600, 9, 0.2]]);
      const f = D.env([[0, base * 0.85], [len * 0.3, base * 1.12], [len, base * 0.8]], true);
      D.play(t0, len, t => fm.run(g(f.at(t), 0.1)) * Math.sin(Math.PI * t / len), 0.06, 0.4);
    }
    for (const t0 of [0.3, 0.95]) {
      const o = D.osc(), f = D.env([[0, 2300], [0.16, 3300], [0.3, 3300], [0.5, 2200]], true), n = D.svf(3000, 4);
      D.play(t0, 0.5, t => (o.sin(f.at(t)) + 0.12 * n.set(f.at(t), 4).bp(D.white())) * (t < 0.03 ? t / 0.03 : t < 0.4 ? 1 : (0.5 - t) / 0.1), 0.04, 0.3);
    }
    D.room = { decay: 1.8, damp: 0.35, wet: 0.8 };
  },

  // a fire siren winding up: the rotor spinning up into its wail, holding, and growling back down
  gsnd_siren(D) {
    const f = D.env([[0, 170], [0.25, 520], [0.65, 860], [1.0, 980], [1.35, 975], [1.7, 720], [2.0, 470]], true);
    const o = D.osc(), chop = D.svf(1200, 1), horn = D.bq('peak', 1300, 0.9, 6), hp = D.bq('hp', 160, 0.7), lp = D.bq('lp', 6000, 0.7), w = D.drift(3);
    D.play(0, 2.0, t => {
      const fr = f.at(t) * (1 + 0.004 * w.next()), a = Math.min(1, t / 0.12) * (t > 1.75 ? Math.max(0, (2.0 - t) / 0.25) : 1);
      const p0 = o.p, x = o.pulse(fr, 0.35);
      const pulseNoise = chop.bp(D.white()) * (o.p < 0.2 || o.p < p0 ? 1 : 0.25);
      return lp.run(hp.run(horn.run(Math.tanh(1.5 * x) + 0.3 * pulseNoise))) * a;
    }, 1, 0.25);
    D.echo([[0.3, 0.2, 3000]]);
    D.room = { decay: 1.6, damp: 0.35, wet: 0.8 };
  },

  // boyoyoyoing: a door-stop spring flicked, wobbling in pitch as it shakes itself out, through a "b-OI-ng" mouth
  gsnd_boing(D) {
    const o = D.osc(), mouth = D.svf(450, 5), lp = D.svf(2500, 0.7), F = D.env([[0, 420], [0.12, 2100], [0.9, 1800]], true);
    D.play(0, 0.95, t => {
      const f = 225 * (1 + 0.13 * Math.exp(-t / 0.35) * Math.sin(TAU * 14 * t)) * (1 + 0.12 * Math.exp(-t / 0.03));
      const x = o.saw(f) * (t < 0.003 ? t / 0.003 : Math.exp(-t / 0.33));
      mouth.set(F.at(t), 5);
      return 0.75 * mouth.bp(x) + 0.35 * lp.lp(x);
    }, 1, 0.12);
    D.modes(0, [[2150, 0.05, 0.12], [3420, 0.03, 0.08]], 1);
    D.room = { decay: 0.6, damp: 0.3, wet: 1 };
  },

  // a cuckoo clock: the little door clacks open, "cu-ckoo, cu-ckoo" on its two wooden pipes, and it clacks shut
  gsnd_cuckoo(D) {
    const clack = t => { D.modes(t, [[D.rnd(850, 950), 0.3, 0.012], [1750, 0.2, 0.008], [2650, 0.12, 0.006]], 1, 0.2); burst(D, t, { f: 2500, q: 0.9, tau: 0.0015, gain: 0.3 }); };
    const pipe = (t0, f, len) => {
      const o = D.osc(), n = D.svf(f, 8), ch = D.svf(f * 2, 2), box = D.bq('peak', 1200, 1, 3);
      D.play(t0, len + 0.06, t => {
        const a = t < 0.015 ? t / 0.015 : t < len ? 1 - 0.25 * (t - 0.015) / len : Math.max(0, 0.75 * (1 - (t - len) / 0.06));
        return box.run(o.harm(f, [1, 0.2, 0.08]) + 0.35 * n.bp(D.white()) + (t < 0.02 ? 0.6 * ch.bp(D.white()) * (1 - t / 0.02) : 0)) * a;
      }, 0.8, 0.2);
    };
    clack(0);
    for (const t of [0.07, 0.6]) { pipe(t, 880, 0.12); pipe(t + 0.17, 698.5, 0.24); }
    clack(1.08);
    D.room = { decay: 0.7, damp: 0.35, wet: 1 };
  },

  // the royal fanfare: three trumpets (ta-ta-ta TAAAA, an octave leap into a C major chord) over a timpani hit
  gsnd_fanfare(D) {
    const parts = [[67, 79, 0], [64, 76, -5], [60, 72, 5]];
    for (const [lo, hi, det] of parts) {
      for (const t of [0, 0.095, 0.19]) for (const d of [-4, 4]) brass(D, t, 0.065, NOTE(lo), { gain: 0.28, rev: 0.35, detune: det + d, bright: 0.85, vib: 0 });
      for (const d of [-4, 4]) brass(D, 0.29, 0.85, NOTE(hi), { gain: 0.32, rev: 0.4, detune: det + d, bright: 1, vib: 0.006 });
    }
    D.modes(0.29, [[98, 0.55, 0.55], [98 * 1.5, 0.3, 0.4], [98 * 1.98, 0.2, 0.3], [98 * 2.44, 0.12, 0.2]], 1, 0.3);
    thump(D, 0.29, 120, 90, 0.08, 0.5);
    D.room = { decay: 2.0, damp: 0.3, wet: 0.9 };
  },

  // case closed: the judge's gavel on the sound block, bang, bang, BANG, in a wood-panelled courtroom
  gsnd_gavel(D) {
    for (const [t, g] of [[0, 0.75], [0.28, 0.82], [0.62, 1]]) {
      const k = D.rnd(0.97, 1.03);
      D.modes(t, [[480 * k, 1, 0.026], [1150 * k, 0.7, 0.018], [1830 * k, 0.5, 0.012], [2700 * k, 0.3, 0.008], [3900 * k, 0.15, 0.005], [1650, 0.4, 0.01], [3100, 0.25, 0.006]], 0.7 * g, 0.3);
      thump(D, t, 150, 105, 0.06, 0.7 * g, 0.2);
      burst(D, t, { f: 3200, q: 0.8, tau: 0.0012, gain: 0.8 * g });
    }
    D.room = { decay: 1.1, damp: 0.45, wet: 0.9 };
  },
};

// fine loudness trims, on top of the automatic levelling (a piercing sound feels louder than its level says)
const LEVEL = { gsnd_eagle: 0.85, gsnd_siren: 0.85, gsnd_sonar: 0.9, gsnd_glass: 0.9, gsnd_ovation: 0.9 };
const SR = 44100;

// Render a green sound to samples (mono, 44.1 kHz, levelled). ts stretches its tempo (an AI player's).
export function renderGreen(id, { ts = 1, seed = null } = {}) {
  const r = RECIPES[id] || RECIPES.gsnd_basic;
  const D = new Synth({ sr: SR, seed: seed ?? hashStr(`${id}|${ts}`), ts });
  r(D);
  const out = D.render({ level: LEVEL[id] || 1 });
  renderGreen.stats = D.stats;
  return out;
}
export const greenRecipe = id => RECIPES[id] || null;

// The rendered buffers, per sound and tempo (a handful of players per game: kept small). Rendering happens on a
// worker thread when the browser has one (core/greenworker.js), so the game never stalls on it; a sound that isn't
// ready yet plays the moment it is (a fraction of a second), and without a worker it renders right there.
const cache = new Map(), waiting = new Map();
const tsFor = (pitch = 1, rate = 1) => Math.round(((pitch || 1) / (rate || 1)) / 0.02) * 0.02; // (pitch is applied on playback, which also speeds it up)
let worker = null, workerDead = false;
function toBuffer(c, key, x) {
  const buf = c.createBuffer(1, x.length, SR);
  if (buf.copyToChannel) buf.copyToChannel(x, 0); else buf.getChannelData(0).set(x);
  cache.set(key, { ctx: c, buf });
  while (cache.size > 40) cache.delete(cache.keys().next().value);
  return buf;
}
function cached(c, key) {
  const b = cache.get(key);
  if (!b || b.ctx !== c) return null;
  cache.delete(key); cache.set(key, b); // (most recently used last)
  return b.buf;
}
function renderNow(c, id, ts) { return toBuffer(c, `${id}|${ts}`, renderGreen(id, { ts })); }
function settle(key, x) {
  const w = waiting.get(key); if (!w) return;
  waiting.delete(key); clearTimeout(w.timer);
  let buf = null;
  try { buf = x ? toBuffer(w.c, key, x) : renderNow(w.c, w.id, w.ts); } catch (e) { console.warn('green sound', w.id, e); }
  for (const fn of w.then) if (buf) fn(buf);
}
function getWorker() {
  if (worker || workerDead || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./greenworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => settle(e.data.key, e.data.x);
    worker.onerror = () => { workerDead = true; worker = null; for (const key of [...waiting.keys()]) settle(key, null); };
  } catch { workerDead = true; worker = null; }
  return worker;
}
// Get the buffer for a sound to then(buf): right away when it's ready, else when the worker has it. False: no worker,
// render it here.
function request(c, id, ts, then) {
  const key = `${id}|${ts}`, buf = cached(c, key);
  if (buf) { if (then) then(buf); return true; }
  const w = waiting.get(key);
  if (w) { if (then) w.then.push(then); return true; }
  const wk = getWorker();
  if (!wk) return false;
  waiting.set(key, { c, id, ts, then: then ? [then] : [], timer: setTimeout(() => settle(key, null), 2500) });
  try { wk.postMessage({ key, id, ts }); } catch { settle(key, null); }
  return true;
}
// Render the sounds a game will need ahead of time, so a green never waits on its sound.
export function warmGreenSounds(audio, list = []) {
  if (!audio || !audio.ensure || !audio.ensure()) return;
  const c = audio.ctx, jobs = list.filter(v => v && v.id).map(v => [RECIPES[v.id] ? v.id : 'gsnd_basic', tsFor(v.pitch, v.rate)]);
  const next = () => {
    const j = jobs.shift(); if (!j) return;
    if (!request(c, j[0], j[1], null)) { try { if (!cached(c, `${j[0]}|${j[1]}`)) renderNow(c, j[0], j[1]); } catch { /* it'll render when it plays */ } }
    setTimeout(next, 40);
  };
  setTimeout(next, 40);
}

// Plays a green sound. Returns a handle ({stop(fade)}: cuts it off, v0.4.7.5 quick patch) or false.
export function playGreenSound(audio, id, o = {}) {
  if (!audio || !audio.ensure || !audio.ensure()) return false;
  id = RECIPES[id] ? id : 'gsnd_basic';
  const W = Math.min(1.35, o.power || 1), c = audio.ctx, ts = tsFor(o.pitch, o.rate);
  const h = { cut: false, node: null,
    stop(fade = 0.03) {
      if (!h.node) { h.cut = true; return; }
      try { const g = h.node.bus.gain, t = c.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + Math.max(0.005, fade)); h.node.src.stop(t + Math.max(0.005, fade) + 0.02); } catch { /* already gone */ }
    } };
  const start = buf => {
    if (h.cut) return;
    try {
      const src = c.createBufferSource(), bus = c.createGain();
      src.buffer = buf;
      if (src.playbackRate) src.playbackRate.value = (o.pitch || 1) * (1 + (Math.random() - 0.5) * 0.024); // (every play a touch different)
      bus.gain.value = 0.9 * (o.vol ?? 1) * (0.85 + 0.15 * W) * W;
      src.connect(bus); bus.connect(audio.out(o.pan || 0));
      src.start(c.currentTime + 0.01);
      h.node = { src, bus };
    } catch (e) { console.warn('green sound', id, e); }
  };
  if (!request(c, id, ts, start)) {
    try { start(renderNow(c, id, ts)); } catch (e) { console.warn('green sound', id, e); return false; }
    if (!h.node) return false;
  }
  // a big one gets the crowd going
  if (W > 1.1 && audio.cheer) audio.cheer(0.4);
  return h;
}

// ---- the record scratch (live Web Audio nodes) ----
// The toolkit the scratch plays with. Times are recipe seconds (scaled by rate), frequencies are pre-pitch (scaled by
// pitch); every node is started and stopped on its own schedule, so nothing is left running.
function kit(a, o, trim = 1) {
  const c = a.ctx, T0 = c.currentTime + 0.015;
  const P = (o.pitch || 1) * (1 + (Math.random() - 0.5) * 0.03), R = 1 / (o.rate || 1), W = Math.min(1.35, o.power || 1);
  const bus = c.createGain(); bus.gain.value = 0.85 * trim * (o.vol ?? 1) * (0.85 + 0.15 * W);
  bus.connect(a.out(o.pan || 0));
  const at = s => T0 + s * R;
  const hz = f => f * P;
  const end = t => at(t) + 0.05;
  const env = (g, t0, att, peak, hold, dec) => {
    g.gain.setValueAtTime(0, at(t0));
    g.gain.linearRampToValueAtTime(peak, at(t0 + att));
    g.gain.setValueAtTime(peak, at(t0 + att + hold));
    g.gain.setTargetAtTime(0, at(t0 + att + hold), Math.max(0.005, dec * R / 4));
  };
  const filter = (type, f, q = 0.7) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = hz(f); n.Q.value = q; return n; };
  const link = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[0]; };
  const tone = (type, freq, t0, att, peak, hold, dec, x = {}) => {
    const os = c.createOscillator(), g = c.createGain();
    os.type = type;
    os.frequency.setValueAtTime(hz(freq[0][1]), at(t0 + freq[0][0]));
    for (let i = 1; i < freq.length; i++) os.frequency.exponentialRampToValueAtTime(Math.max(1, hz(freq[i][1])), at(t0 + freq[i][0]));
    env(g, t0, att, peak * W, hold, dec);
    link(os, g, x.dest || bus);
    os.start(at(t0)); os.stop(end(t0 + att + hold + dec));
    return os;
  };
  const noise = (t0, att, peak, hold, dec, x = {}) => {
    const s = a.noise(), g = c.createGain();
    env(g, t0, att, peak * W, hold, dec);
    link(s, g, x.dest || bus);
    s.start(at(t0)); s.stop(end(t0 + att + hold + dec));
    return s;
  };
  const shaper = (amt = 3) => {
    const n = c.createWaveShaper(), N = 1024, cv = new Float32Array(N);
    for (let i = 0; i < N; i++) { const v = i / (N - 1) * 2 - 1; cv[i] = Math.tanh(v * amt) / Math.tanh(amt); }
    n.curve = cv; return n;
  };
  return { c, T0, P, R, W, bus, at, hz, env, filter, link, tone, noise, shaper };
}

// v0.4.7.5 quick patch: the record scratch that cuts a green off (blocked in flight, or timed right into a smothering
// contest). A record pushed forward and dragged back twice: the pitch and the level follow the speed of the platter,
// dropping out at each turnaround, with the needle's hiss riding along.
export function playRecordScratch(audio, o = {}) {
  if (!audio || !audio.ensure || !audio.ensure()) return false;
  try { RECORD_SCRATCH(kit(audio, { pitch: o.pitch || 1, rate: 1, power: 1, pan: o.pan || 0, vol: o.vol ?? 1 }, SCRATCH_TRIM)); } catch (e) { console.warn('record scratch', e); return false; }
  return true;
}
const SCRATCH_TRIM = 2.1;
export function RECORD_SCRATCH(k) {
  const c = k.c;
  // platter speed through the scratch: forward, back, forward, back (0 at each turnaround)
  const spd = [[0, 0.05], [0.035, 1], [0.08, 0.04], [0.125, 0.85], [0.185, 0.04], [0.215, 0.7], [0.255, 0.04], [0.31, 0.55], [0.4, 0.02]];
  const level = c.createGain(); level.gain.value = 0;
  level.gain.setValueAtTime(0, k.at(0));
  for (const [t, v] of spd) level.gain.linearRampToValueAtTime(Math.min(1, v * 1.15), k.at(t));
  const tone = k.filter('bandpass', 1600, 3.2), hiss = k.filter('bandpass', 2600, 2.2), grit = k.shaper(1.6);
  const sweep = (param, base, floor) => {
    param.setValueAtTime(Math.max(floor, base * spd[0][1]) * k.P, k.at(0));
    for (const [t, v] of spd) param.exponentialRampToValueAtTime(Math.max(floor, base * v) * k.P, k.at(t));
  };
  sweep(tone.frequency, 3400, 260); sweep(hiss.frequency, 5200, 500);
  k.link(tone, grit, level); hiss.connect(level); level.connect(k.bus);
  // the "music" on the record: a few detuned saws (a chord) riding the platter speed
  for (const [f, g] of [[196, 0.16], [247, 0.12], [294, 0.1], [392, 0.07]]) {
    const os = c.createOscillator(), gg = c.createGain(); os.type = 'sawtooth'; gg.gain.value = g;
    sweep(os.frequency, f * 2.2, 30);
    k.link(os, gg, tone); os.start(k.at(0)); os.stop(k.at(0.45));
  }
  // the needle: hiss that rides the same speed
  k.noise(0, 0.005, 0.22, 0.36, 0.04, { dest: hiss });
  // and the stop: a thump as the hand catches the platter
  k.tone('sine', [[0, 120], [0.06, 55]], 0.33, 0.002, 0.25, 0.01, 0.08);
}

// Each AI player's own take on his sound: a pitch and a tempo from his name (stable across games and sessions).
export function greenVoice(key = '') {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const a = (h & 0xffff) / 0xffff, b = (h >>> 16) / 0xffff;
  return { pitch: +(0.86 + a * 0.3).toFixed(3), rate: +(0.9 + b * 0.2).toFixed(3) };
}
