// v0.4.7.5 green release animations: what goes off over a player when his green (Excellent) release goes in.
// Built from the renderer's glowing particles (renderer.js Particles), scheduled over real time so they play out the
// same at any frame rate. Shapes (crown, ankh, pixel star) face the camera.
//
// An effect is a function (fx) => void using:
//   fx.head()  where the top of his head is right now [x, y, z] (it follows him)   fx.feet()  the floor under him
//   fx.at(s, fn)  run fn in s seconds        fx.every(step, dur, fn(k, i))  run fn every step for dur (k: 0..1)
//   fx.emit(o)  one particle {x,y,z,vx,vy,vz,life,size,color,gravity,drag,grow,flick}
//   fx.burst(p, n, o)  a sphere of sparks      fx.basis()  [camera right, camera up] for flat shapes
//   fx.hold(n, dur, make(i), place(i, k, p))  n particles that live dur and that place() moves every frame (shapes
//     that turn and follow him: smooth at any frame rate)
//   fx.power  1 normally, more on threes and big shots (a bigger show)
import { hypot2, hypot3 } from '../gfx/fastmath.js'; // (qp3: Math.hypot, without its per-call allocation)
export const GREEN_FX = {
  gfx_basic: 'Green Burst',
  gfx_fireworks: 'Green Fireworks',
  gfx_splash: 'Green Splash',
  gfx_flame: 'Green Flame',
  gfx_lightning: 'Green Lightning',
  gfx_halo: 'Halo',
  gfx_crown: 'Crowned',
  gfx_confetti: 'Confetti Cannons',
  gfx_beam: 'Aurora Beam',
  gfx_smoke: 'Smoke Ring',
  gfx_pixel: 'Pixel Star',
  gfx_comet: 'Comet',
  gfx_tornado: 'Twister',
  cup_gfx_ankh: 'Golden Ankh',
  jb_gfx_banana: 'Banana Peel',
  bg_gfx_discoball: 'Disco Ball', // (v0.4.8.5 quick patch: And The Beat Goes On)
  mm_gfx_lantern: "Jack-o'-Lantern", // (v0.4.8.5 quick patch 2: The Monster Mash)
  fv_gfx_pipa: 'Pipa', // (v0.4.8.7: The Favelas)
  // v0.4.7.5 quick patch
  gfx_phoenix: 'Phoenix',
  gfx_cash: 'Make It Rain',
  gfx_shockwave: 'Shockwave',
  gfx_atom: 'Atomic',
  gfx_galaxy: 'Galaxy',
  gfx_frost: 'Ice Cold',
  gfx_firering: 'Fire Circle',
  gfx_wings: 'Angel Wings',
  gfx_dragon: 'Jade Dragon',
  gfx_meteor: 'Meteor Shower',
  gfx_lasers: 'Laser Show',
  gfx_clover: 'Lucky Clover',
  gfx_diamond: 'Diamond',
  gfx_supernova: 'Supernova',
};
export const GREEN_FX_IDS = Object.keys(GREEN_FX);

// (v0.4.8.5 quick patch: the Disco Ball's lights and its mirror)
const DISCO = { pink: [2.7, 0.45, 1.5], cyan: [0.35, 2.2, 2.8], purple: [1.5, 0.55, 2.9], yellow: [2.7, 2.25, 0.35], silver: [1.3, 1.37, 1.6] };
// (v0.4.8.5 quick patch 2: the Jack-o'-Lantern's pumpkin, its candle, its bats and its ghost smoke; the carved face in the
// pumpkin's own front view, x right and y up, -1..1 across it: two slanted triangle eyes, a nose, a jagged grin)
// (the shell's points overlap about three deep, so its colours are a third of what they add up to; and pumpkin orange
// stays orange through the tone curve only with very little green in it: more and it goes yellow, then white)
const LANTERN = { skin: [0.38, 0.047, 0.003], groove: [0.1, 0.01, 0.0008], chunk: [1.5, 0.26, 0.02], stem: [0.16, 0.3, 0.03], candle: [1.0, 0.36, 0.035], core: [1.15, 0.62, 0.12], halo: [0.07, 0.01, 0.001], bat: [0.42, 0.06, 0.7], batBody: [0.62, 0.14, 0.95], batEye: [3.0, 0.45, 0.1], ghost: [0.04, 0.3, 0.12], smoke: [0.13, 0.13, 0.15] };
const LANTERN_FACE = [
  [[-0.66, 0.1], [-0.14, -0.01], [-0.42, 0.46]], [[0.66, 0.1], [0.14, -0.01], [0.42, 0.46]], [[-0.11, -0.16], [0.11, -0.16], [0, 0.03]],
  [[-0.74, -0.24], [-0.5, -0.3], [-0.38, -0.25], [-0.26, -0.33], [-0.16, -0.33], [-0.16, -0.24], [0.02, -0.29], [0.24, -0.34], [0.38, -0.27], [0.52, -0.31], [0.75, -0.23],
    [0.6, -0.48], [0.36, -0.6], [0.16, -0.64], [0.16, -0.54], [0.04, -0.54], [0.04, -0.65], [-0.2, -0.64], [-0.46, -0.56], [-0.64, -0.44]],
];
// (v0.4.8.7 The Favelas: the Pipa's kite papers, bright tissue colours, each kite two of them split down its spine)
export const PIPA = {
  // (the kites' points overlap a couple deep: kept well under the bloom's white so each paper keeps its colour)
  papers: [[1.5, 0.22, 0.7], [1.5, 1.15, 0.12], [0.15, 1.0, 1.5], [0.3, 1.35, 0.25], [1.6, 0.55, 0.08], [0.75, 0.25, 1.55], [1.5, 0.15, 0.12]],
  spar: [0.22, 0.14, 0.06], bow: [2.3, 2.3, 2.2],
  // the kite in its own plane (x across, y up its spine, metres): the nose, the wing tips (high, a kite is widest above
  // its middle), the tail tip
  shape: [[0, 0.17], [0.13, 0.04], [0, -0.21], [-0.13, 0.04]], tail: 12, life: 1.8,
};
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const G = [0.35, 2.6, 0.9], GW = [1.4, 3.0, 1.5], GD = [0.12, 1.1, 0.35], GOLD = [2.6, 1.9, 0.45], WHITE = [2.2, 2.4, 2.2], ICE = [1.1, 2.6, 2.5], EMBER = [2.2, 2.6, 0.5];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const add = (p, x = 0, y = 0, z = 0) => [p[0] + x, p[1] + y, p[2] + z];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// a point on a flat shape that faces the camera: (gx, gy) in metres around c
const flat = (fx, c, gx, gy) => { const [r, u] = fx.basis(); return [c[0] + r[0] * gx + u[0] * gy, c[1] + r[1] * gx + u[1] * gy, c[2] + r[2] * gx + u[2] * gy]; };
// the camera's forward on the floor (toward the viewer), for shapes that sit behind a player
const toward = fx => { const [r, u] = fx.basis(), f = [u[1] * r[2] - u[2] * r[1], u[2] * r[0] - u[0] * r[2], u[0] * r[1] - u[1] * r[0]], l = hypot2(f[0], f[2]) || 1; return [f[0] / l, 0, f[2] / l]; };
const setP = (p, P) => { p.x = P[0]; p.y = P[1]; p.z = P[2]; };
function sphereDir() { const u = rnd(-1, 1), th = rnd(0, Math.PI * 2), s = Math.sqrt(1 - u * u); return [s * Math.cos(th), u, s * Math.sin(th)]; }

const EFFECTS = {
  gfx_basic(fx) {
    fx.burst(add(fx.head(), 0, 0.25), 26 + 10 * (fx.power - 1), { color: G, speed: 2.4, life: 0.7, size: 0.035, gravity: -2 });
  },

  // three rockets climb off his head and break into green shells that crackle
  gfx_fireworks(fx) {
    const n = fx.power > 1.1 ? 4 : 3;
    for (let r = 0; r < n; r++) fx.at(r * 0.17, () => {
      const p0 = add(fx.head(), 0, 0.15), v = [rnd(-1.1, 1.1), rnd(6.2, 7.4), rnd(-1.1, 1.1)], up = 0.42;
      fx.every(0.02, up, k => {
        const t = k * up, p = add(p0, v[0] * t, v[1] * t - 4.9 * t * t, v[2] * t);
        fx.emit({ x: p[0], y: p[1], z: p[2], vx: rnd(-0.3, 0.3), vy: -0.6, vz: rnd(-0.3, 0.3), life: 0.32, size: 0.03, color: [2.2, 1.7, 0.8], gravity: -2 });
      });
      fx.at(up, () => {
        const t = up, c = add(p0, v[0] * t, v[1] * t - 4.9 * t * t, v[2] * t), col = r % 2 ? GW : G;
        for (let i = 0; i < 70; i++) { const d = sphereDir(), s = rnd(2.6, 3.4); fx.emit({ x: c[0], y: c[1], z: c[2], vx: d[0] * s, vy: d[1] * s, vz: d[2] * s, life: rnd(0.8, 1.15), size: 0.04, color: col, gravity: -2.4, drag: 1.7 }); }
        fx.at(0.5, () => { for (let i = 0; i < 26; i++) { const d = sphereDir(), s = rnd(0.5, 1.3); fx.emit({ x: c[0] + d[0] * s, y: c[1] + d[1] * s - 0.3, z: c[2] + d[2] * s, life: rnd(0.12, 0.3), size: 0.03, color: WHITE, flick: 30, gravity: -1 }); } });
      });
    });
  },

  // a splash of green water bursts up off his head: a crown of droplets, a spout, a ring of spray, then the drips
  gfx_splash(fx) {
    const c = add(fx.head(), 0, 0.12), col = [0.3, 2.3, 1.7], n = 90 * fx.power;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), out = rnd(1.4, 3), up = rnd(2.8, 4.8);
      fx.emit({ x: c[0], y: c[1], z: c[2], vx: Math.cos(a) * out, vy: up, vz: Math.sin(a) * out, life: rnd(0.8, 1.1), size: rnd(0.025, 0.045), color: col, gravity: -9.8, drag: 0.25 });
    }
    for (let i = 0; i < 22; i++) fx.emit({ x: c[0] + rnd(-0.04, 0.04), y: c[1], z: c[2] + rnd(-0.04, 0.04), vx: rnd(-0.3, 0.3), vy: rnd(5, 7), vz: rnd(-0.3, 0.3), life: 0.9, size: 0.035, color: [0.8, 2.8, 2.2], gravity: -9.8, drag: 0.2 });
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; fx.emit({ x: c[0], y: c[1], z: c[2], vx: Math.cos(a) * 3, vy: 0.4, vz: Math.sin(a) * 3, life: 0.45, size: 0.05, grow: 1.5, color: [0.4, 1.8, 1.4], gravity: 0, drag: 3 }); }
    fx.at(0.55, () => { const h = fx.head(); for (let i = 0; i < 24; i++) fx.emit({ x: h[0] + rnd(-0.5, 0.5), y: h[1] + rnd(0.3, 0.9), z: h[2] + rnd(-0.5, 0.5), vy: -1, life: 0.6, size: 0.025, color: col, flick: 18, gravity: -9.8 }); });
  },

  // a green flame ignites over his head and burns for a moment, embers rising off it
  gfx_flame(fx) {
    const dur = 1.3 + 0.3 * (fx.power - 1);
    fx.burst(add(fx.head(), 0, 0.2), 20, { color: [1.6, 3, 1.4], speed: 1.5, life: 0.3, size: 0.05, gravity: 0 });
    fx.every(1 / 60, dur, k => {
      const h = add(fx.head(), 0, 0.12), fade = k < 0.85 ? 1 : (1 - k) / 0.15;
      for (let i = 0; i < 4; i++) {
        const r = Math.sqrt(Math.random()) * 0.13 * fade, a = rnd(0, Math.PI * 2), core = r < 0.05;
        fx.emit({ x: h[0] + Math.cos(a) * r, y: h[1], z: h[2] + Math.sin(a) * r, vx: -Math.cos(a) * r * 1.5, vy: rnd(0.8, 1.5), vz: -Math.sin(a) * r * 1.5, life: rnd(0.35, 0.6), size: (core ? 0.06 : 0.09) * fade + 0.01, grow: -0.75, color: core ? [1.4, 3, 1.2] : [0.15, 1.9, 0.45], gravity: 2.5, drag: 1.5 });
      }
      if (Math.random() < 0.3) fx.emit({ x: h[0] + rnd(-0.1, 0.1), y: h[1] + 0.2, z: h[2] + rnd(-0.1, 0.1), vx: rnd(-0.4, 0.4), vy: rnd(1.5, 2.5), vz: rnd(-0.4, 0.4), life: 0.8, size: 0.018, color: [1, 3, 1], flick: 22, gravity: 1, drag: 0.8 });
    });
  },

  // a bolt comes down out of the night onto his head (twice), with branches, sparks and a ring on the floor
  gfx_lightning(fx) {
    const bolt = (end, life) => {
      const top = add(end, rnd(-1, 1), 6, rnd(-1, 1)), pts = [top];
      for (let i = 1; i <= 10; i++) { const t = i / 10, j = 0.45 * (1 - t); pts.push([top[0] + (end[0] - top[0]) * t + rnd(-j, j), top[1] + (end[1] - top[1]) * t, top[2] + (end[2] - top[2]) * t + rnd(-j, j)]); }
      pts[10] = end;
      const seg = (a, b, sz) => { const d = hypot3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.ceil(d / 0.07); for (let i = 0; i <= n; i++) { const t = i / n; fx.emit({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, life, size: sz, color: [1.5, 3, 1.8], gravity: 0, drag: 0 }); } };
      for (let i = 0; i < 10; i++) seg(pts[i], pts[i + 1], 0.055);
      for (const bi of [3, 6]) { const s = pts[bi], e = add(s, rnd(-0.9, 0.9), -rnd(0.6, 1.1), rnd(-0.9, 0.9)); seg(s, e, 0.03); }
    };
    const h = add(fx.head(), 0, 0.1);
    bolt(h, 0.2);
    fx.at(0.16, () => bolt(add(fx.head(), 0, 0.1), 0.24));
    fx.at(0.02, () => {
      fx.burst(add(fx.head(), 0, 0.1), 40, { color: [1.2, 3, 1.4], speed: 3.2, life: 0.45, size: 0.03, gravity: -4 });
      const f = fx.feet();
      for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; fx.emit({ x: f[0], y: f[1] + 0.05, z: f[2], vx: Math.cos(a) * 4, vy: 0, vz: Math.sin(a) * 4, life: 0.35, size: 0.045, color: G, gravity: 0, drag: 2.5 }); }
    });
  },

  // a halo spins up over his head (tipped a little toward the camera so it reads as a ring), then goes out in a
  // shockwave
  gfx_halo(fx) {
    const dur = 1.0, n = 40;
    const ringPt = (a, r) => {
      const [rt, up] = fx.basis(), h = add(fx.head(), 0, 0.24);
      const fw = [up[1] * rt[2] - up[2] * rt[1], up[2] * rt[0] - up[0] * rt[2], up[0] * rt[1] - up[1] * rt[0]]; // toward the camera
      const tip = 0.35, c = Math.cos(a) * r, d = Math.sin(a) * r;
      // a horizontal ring (right × forward-on-the-floor), tipped about the camera's right axis
      const fl = hypot2(fw[0], fw[2]) || 1, fx2 = fw[0] / fl, fz2 = fw[2] / fl;
      return [h[0] + rt[0] * c + fx2 * d * Math.cos(tip), h[1] + d * Math.sin(tip), h[2] + rt[2] * c + fz2 * d * Math.cos(tip)];
    };
    fx.hold(n, dur, i => ({ size: i % 8 === 0 ? 0.05 : 0.032, color: i % 8 === 0 ? WHITE : GW }), (i, k, p) => {
      const P = ringPt(i / n * Math.PI * 2 + k * 9, 0.27 + 0.025 * Math.sin(k * 18));
      p.x = P[0]; p.y = P[1]; p.z = P[2];
    });
    fx.at(dur, () => {
      for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2, P = ringPt(a, 0.27), Q = ringPt(a, 0.5), h = add(fx.head(), 0, 0.24); fx.emit({ x: P[0], y: P[1], z: P[2], vx: (Q[0] - P[0]) * 18, vy: (Q[1] - h[1]) * 4, vz: (Q[2] - P[2]) * 18, life: 0.5, size: 0.045, grow: 1, color: G, gravity: 0, drag: 2.2 }); }
    });
  },

  // a crown of green light sits on his head, turning, then sparkles away
  gfx_crown(fx) {
    const outline = [];
    const R = 0.2, spikes = 5;
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; outline.push([a, 0, 0.032]); outline.push([a, 0.06, 0.026]); }
    for (let s = 0; s < spikes; s++) {
      const a0 = s / spikes * Math.PI * 2, a1 = (s + 0.5) / spikes * Math.PI * 2, a2 = (s + 1) / spikes * Math.PI * 2;
      for (let i = 0; i <= 6; i++) { const t = i / 6; outline.push([a0 + (a1 - a0) * t, 0.06 + 0.16 * t, 0.024]); outline.push([a1 + (a2 - a1) * t, 0.22 - 0.16 * t, 0.024]); }
      outline.push([a1, 0.25, 0.05]); // the jewel on the point
    }
    const dur = 1.25;
    fx.hold(outline.length, dur, i => { const [, y, sz] = outline[i]; return { size: sz, color: sz >= 0.05 ? WHITE : y > 0.2 ? [1.2, 3, 0.9] : G }; }, (i, k, p) => {
      const [a, y] = outline[i], h = add(fx.head(), 0, 0.12 + 0.04 * Math.min(1, k * 8) - 0.04), turn = k * 2.4;
      p.x = h[0] + Math.cos(a + turn) * R; p.y = h[1] + y; p.z = h[2] + Math.sin(a + turn) * R;
    });
    fx.at(dur, () => { const h = add(fx.head(), 0, 0.12); for (const [a, y] of outline) fx.emit({ x: h[0] + Math.cos(a + 2.4) * R, y: h[1] + y, z: h[2] + Math.sin(a + 2.4) * R, vx: rnd(-0.4, 0.4), vy: rnd(0.6, 1.6), vz: rnd(-0.4, 0.4), life: rnd(0.4, 0.8), size: 0.025, flick: 20, color: GW, gravity: 0.5 }); });
  },

  // confetti cannons go off at both shoulders and it flutters down around him
  gfx_confetti(fx) {
    const cols = [G, WHITE, [2.4, 2.2, 0.5], [0.9, 2.8, 0.3], [0.2, 1.6, 1.2]];
    for (const side of [-1, 1]) {
      const h = fx.head(), [rx, , rz] = fx.basis()[0], base = [h[0] + rx * 0.3 * side, h[1] - 0.4, h[2] + rz * 0.3 * side];
      for (let i = 0; i < 70 * fx.power; i++) {
        const sp = rnd(4.5, 7), a = rnd(-0.35, 0.35);
        fx.emit({ x: base[0], y: base[1], z: base[2], vx: rx * side * sp * (0.35 + a) + rnd(-0.8, 0.8), vy: sp * rnd(0.75, 1), vz: rz * side * sp * (0.35 + a) + rnd(-0.8, 0.8), life: rnd(1.4, 2), size: rnd(0.025, 0.04), color: pick(cols), flick: rnd(8, 16), gravity: -2.2, drag: 2.4 });
      }
    }
  },

  // a pillar of green light rises from the floor through him into the sky, motes spiralling up it
  gfx_beam(fx) {
    const dur = 1.2 + 0.25 * (fx.power - 1);
    fx.every(0.02, dur, k => {
      const f = fx.feet(), fade = Math.min(1, k * 6, (1 - k) * 5);
      for (let i = 0; i < 7; i++) { const r = Math.sqrt(Math.random()) * 0.24, a = rnd(0, Math.PI * 2); fx.emit({ x: f[0] + Math.cos(a) * r, y: f[1] + rnd(0, 5.5), z: f[2] + Math.sin(a) * r, vy: 3, life: 0.35, size: 0.08 * fade + 0.01, grow: -0.5, color: r < 0.1 ? [1, 3, 1.6] : [0.1, 1.8, 0.9], gravity: 0, drag: 0 }); }
      for (let j = 0; j < 2; j++) { const a = k * 26 + j * Math.PI, y = f[1] + (k * 3.4 + j * 0.4) % 3.4; fx.emit({ x: f[0] + Math.cos(a) * 0.5, y, z: f[2] + Math.sin(a) * 0.5, vy: 1.2, life: 0.4, size: 0.04, color: WHITE, gravity: 0, drag: 0 }); }
    });
  },

  // a ring of glowing green smoke rolls out at his feet and another floats up off his head
  gfx_smoke(fx) {
    const f = fx.feet(), h = fx.head();
    for (let i = 0; i < 54; i++) { const a = i / 54 * Math.PI * 2 + rnd(-0.05, 0.05); fx.emit({ x: f[0] + Math.cos(a) * 0.3, y: f[1] + 0.12, z: f[2] + Math.sin(a) * 0.3, vx: Math.cos(a) * rnd(2, 2.8), vy: rnd(0.2, 0.6), vz: Math.sin(a) * rnd(2, 2.8), life: rnd(1.1, 1.5), size: 0.16, grow: 2.4, color: [0.05, 0.42, 0.15], gravity: 0.2, drag: 1.6 }); }
    for (let i = 0; i < 44; i++) {
      const a = i / 44 * Math.PI * 2, r = 0.25;
      fx.emit({ x: h[0] + Math.cos(a) * r, y: h[1] + 0.25, z: h[2] + Math.sin(a) * r, vx: Math.cos(a) * 0.5, vy: 1.3, vz: Math.sin(a) * 0.5, life: 1.4, size: 0.1, grow: 1.4, color: [0.12, 0.9, 0.35], gravity: 0, drag: 0.7 });
    }
  },

  // an 8-bit star pops up over him, blinks, and shatters into pixels
  gfx_pixel(fx) {
    const art = [
      '....#....',
      '....#....',
      '...###...',
      '#########',
      '.#######.',
      '..#####..',
      '.###.###.',
      '.##...##.',
      '#.......#',
    ];
    const cells = [];
    art.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') cells.push([x - 4, 4 - y]); }));
    const s = 0.065, dur = 0.75;
    const at = (cx, cy, pop = 1) => { const [r, u] = fx.basis(), c = add(fx.head(), 0, 0.6); return [c[0] + (r[0] * cx + u[0] * cy) * s * pop, c[1] + (r[1] * cx + u[1] * cy) * s * pop, c[2] + (r[2] * cx + u[2] * cy) * s * pop]; };
    fx.hold(cells.length, dur, i => ({ size: 0.042, color: cells[i][1] >= 3 ? WHITE : [0.3, 3, 0.6] }), (i, k, p) => {
      const pop = Math.min(1, k * 7) * (1 + 0.15 * Math.max(0, 1 - Math.abs(k * 7 - 1.2))), P = at(cells[i][0], cells[i][1], pop);
      p.x = P[0]; p.y = P[1]; p.z = P[2];
      p.size = Math.floor(k * 9) % 3 === 2 && k > 0.3 ? 0 : 0.042; // the blink
    });
    fx.at(dur, () => { for (const [cx, cy] of cells) { const p = at(cx, cy); fx.emit({ x: p[0], y: p[1], z: p[2], vx: cx * 0.4 + rnd(-0.6, 0.6), vy: rnd(1, 3), vz: rnd(-0.6, 0.6), life: rnd(0.6, 0.9), size: 0.04, color: [0.3, 3, 0.6], flick: 12, gravity: -7, drag: 0.3 }); } });
  },

  // a comet circles him twice on the way up, then shoots into the sky and bursts
  gfx_comet(fx) {
    const dur = 0.8;
    let last = null;
    fx.every(1 / 60, dur, k => {
      const f = fx.feet(), a = k * Math.PI * 4, r = 0.85 - 0.25 * k, y = f[1] + 0.7 + 1.7 * k;
      const p = [f[0] + Math.cos(a) * r, y, f[2] + Math.sin(a) * r];
      fx.emit({ x: p[0], y: p[1], z: p[2], life: 0.4, size: 0.07, grow: -0.85, color: GW, gravity: 0, drag: 0 });
      fx.emit({ x: p[0], y: p[1], z: p[2], vx: rnd(-0.3, 0.3), vy: rnd(-0.3, 0.3), vz: rnd(-0.3, 0.3), life: 0.25, size: 0.025, color: WHITE, flick: 25, gravity: -1 });
      last = p;
    });
    fx.at(dur, () => {
      const p0 = last || fx.head();
      fx.every(1 / 60, 0.3, k => fx.emit({ x: p0[0], y: p0[1] + k * 2.6, z: p0[2], life: 0.3, size: 0.06, grow: -0.8, color: GW, gravity: 0, drag: 0 }));
      fx.at(0.3, () => fx.burst(add(p0, 0, 2.6), 60 * fx.power, { color: G, speed: 3, life: 0.9, size: 0.04, gravity: -2, up: 0.5 }));
    });
  },

  // a green twister winds up around him from the floor, then throws its sparks out
  gfx_tornado(fx) {
    const dur = 1.25, arms = 3, per = 44;
    const pos = (i, k) => {
      const f = fx.feet(), arm = Math.floor(i / per), t = (i % per) / (per - 1), grow = Math.min(1, k * 3.5);
      const y = f[1] + t * 2.9 * grow, r = 0.16 + t * 0.8, a = k * 26 + arm * (Math.PI * 2 / arms) + t * 5.5;
      return [f[0] + Math.cos(a) * r, y, f[2] + Math.sin(a) * r, a, r];
    };
    fx.hold(arms * per, dur, i => { const t = (i % per) / (per - 1); return { size: 0.03 + t * 0.03, color: t > 0.85 ? WHITE : t > 0.4 ? GW : [0.25, 2, 0.7] }; }, (i, k, p) => {
      const P = pos(i, k); p.x = P[0]; p.y = P[1]; p.z = P[2];
    });
    fx.every(0.03, dur, k => { // debris whipping round it
      const P = pos(Math.floor(Math.random() * arms * per), k);
      fx.emit({ x: P[0], y: P[1], z: P[2], vx: -Math.sin(P[3]) * 3, vy: 0.5, vz: Math.cos(P[3]) * 3, life: 0.3, size: 0.02, color: WHITE, flick: 18, gravity: 0, drag: 2 });
    });
    fx.at(dur, () => { for (let i = 0; i < 60; i++) { const P = pos(Math.floor(Math.random() * arms * per), 1); fx.emit({ x: P[0], y: P[1], z: P[2], vx: -Math.sin(P[3]) * 4 + Math.cos(P[3]) * 2, vy: rnd(-0.5, 1), vz: Math.cos(P[3]) * 4 + Math.sin(P[3]) * 2, life: 0.6, size: 0.035, color: GW, gravity: -3, drag: 1.6 }); } });
  },

  // King Tut Cup exclusive: a golden ankh forms over his head out of swirling sand, glows, and rises away
  cup_gfx_ankh(fx) {
    const pts = [];
    for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2; pts.push([Math.cos(a) * 0.11, 0.3 + Math.sin(a) * 0.15]); } // the loop
    for (let i = -6; i <= 6; i++) pts.push([i * 0.035, 0.13]); // the bar
    for (let i = 0; i <= 10; i++) pts.push([0, 0.13 - i * 0.045]); // the stem
    const dur = 1.4;
    const place = (gx, gy, lift = 0) => { const [r, u] = fx.basis(), c = add(fx.head(), 0, 0.25 + lift); return [c[0] + r[0] * gx + u[0] * gy, c[1] + r[1] * gx + u[1] * gy, c[2] + r[2] * gx + u[2] * gy]; };
    // the sand swirl gathering in
    fx.every(1 / 45, 0.5, k => { const f = fx.feet(); for (let i = 0; i < 6; i++) { const a = rnd(0, Math.PI * 2) + k * 10, r = 1.1 * (1 - k) + 0.2, y = f[1] + rnd(0.2, 2.4); fx.emit({ x: f[0] + Math.cos(a) * r, y, z: f[2] + Math.sin(a) * r, vx: -Math.sin(a) * 2, vy: 0.8, vz: Math.cos(a) * 2, life: 0.35, size: 0.025, color: GOLD, flick: 14, gravity: 0, drag: 1 }); } });
    // the glyph: each grain flies in from the swirl to its place, holds, and rises away with the rest
    const from = pts.map(() => { const a = rnd(0, Math.PI * 2); return [Math.cos(a) * 1.1, rnd(-1.6, 0.4), Math.sin(a) * 1.1]; });
    fx.hold(pts.length, dur, () => ({ size: 0.04, color: GOLD }), (i, k, p) => {
      const lift = Math.max(0, k - 0.8) * 2, [gx, gy] = pts[i], P = place(gx, gy, lift), m = Math.min(1, Math.max(0, (k - 0.12) / 0.25)), e = m * m * (3 - 2 * m);
      const h = fx.head();
      p.x = P[0] + (h[0] + from[i][0] - P[0]) * (1 - e); p.y = P[1] + (h[1] + from[i][1] - P[1]) * (1 - e); p.z = P[2] + (h[2] + from[i][2] - P[2]) * (1 - e);
      p.size = 0.025 + 0.015 * e;
    });
    fx.every(0.04, dur, k => {
      if (k < 0.35) return;
      const lift = Math.max(0, k - 0.8) * 2;
      for (let i = 0; i < 6; i++) { const [gx, gy] = pick(pts), p = place(gx, gy, lift); fx.emit({ x: p[0], y: p[1], z: p[2], vx: rnd(-0.2, 0.2), vy: 0.4, vz: rnd(-0.2, 0.2), life: 0.3, size: 0.02, color: [0.6, 3, 1.1], flick: 20, gravity: 0 }); }
    });
    fx.at(dur, () => { for (const [gx, gy] of pts) { const p = place(gx, gy, 0.4); fx.emit({ x: p[0], y: p[1], z: p[2], vx: rnd(-0.5, 0.5), vy: rnd(0.5, 1.5), vz: rnd(-0.5, 0.5), life: 0.7, size: 0.025, color: GOLD, flick: 16, gravity: -1 }); } });
  },
  // v0.4.7.5 qp3 The Jungle Ballers exclusive: a banana hangs over his head from the release and peels open, four
  // ways, the moment the shot drops (fx.flight: the ball's time to the rim), showing the fruit; then it all drifts off
  jb_gfx_banana(fx) {
    const peelAt = Math.max(0.3, Math.min(1.8, fx.flight || 1.0)), dur = peelAt + 1.0;
    const SKIN = [2.4, 1.95, 0.35], TIP = [0.55, 0.32, 0.1], FRUIT = [2.2, 2.0, 1.5], STEM = [0.6, 0.45, 0.2];
    const N = 12, STRIPS = 4, R = 0.3;
    // the banana's crescent in the camera plane: s = 0 at the stem (top), 1 at the tip
    const arc = s => { const a = -0.55 + s * 1.5; return [Math.sin(a) * R - 0.15, 0.46 - (1 - Math.cos(a)) * R * 1.0 - s * 0.05]; };
    const place = (gx, gy, gz = 0, lift = 0) => { const [r, u] = fx.basis(), f = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]], c = add(fx.head(), 0, 0.2 + lift); return [c[0] + r[0] * gx + u[0] * gy + f[0] * gz, c[1] + r[1] * gx + u[1] * gy + f[1] * gz, c[2] + r[2] * gx + u[2] * gy + f[2] * gz]; };
    const sway = t => Math.sin(t * 2.6) * 0.03;
    // strips: four skins round the fruit (two beside it in the plane, two in depth); each peels outward from the stem
    const n = STRIPS * N + N + 3;
    fx.hold(n, dur, i => ({ size: i < STRIPS * N ? 0.055 : i < STRIPS * N + N ? 0.0 : 0.035, color: i < STRIPS * N ? (i % N >= N - 2 ? TIP : SKIN) : i < STRIPS * N + N ? FRUIT : STEM }), (i, k, p) => {
      const t = k * dur, peel = Math.max(0, Math.min(1, (t - peelAt) / 0.38)), e = peel * peel * (3 - 2 * peel), gone = Math.max(0, (t - peelAt - 0.55) / 0.45);
      const lift = gone * 0.9, sw = sway(t);
      const top = arc(0);
      if (i < STRIPS * N) {
        const j = Math.floor(i / N), s = (i % N) / (N - 1), [ax, ay] = arc(s);
        // the strip's own outward direction: left, right (in the plane), front, back (in depth)
        const o = j === 0 ? [-1, 0, 0] : j === 1 ? [1, 0, 0] : j === 2 ? [0, 0, 1] : [0, 0, -1];
        const off = 0.045;
        // the skin is wrapped round the fruit: offset the point off the crescent's centre line in its direction
        let gx = ax + o[0] * off, gy = ay, gz = o[2] * off;
        if (e > 0) {
          // peel: rotate the strip about the stem, outward and up, curling more toward the tip
          const phi = e * (1.6 + 1.2 * s), vx = gx - top[0], vy = gy - top[1];
          const along = hypot2(vx, vy) || 1e-6, dx = vx / along, dy = vy / along;
          const cx = Math.cos(phi), sx = Math.sin(phi);
          gx = top[0] + along * (dx * cx + o[0] * sx * 0.9) + o[0] * off * (1 + e);
          gy = top[1] + along * (dy * cx + 0.35 * sx);
          gz = along * o[2] * sx * 0.9 + o[2] * off * (1 + e);
        }
        const P = place(gx + sw, gy, gz, lift);
        p.x = P[0]; p.y = P[1]; p.z = P[2]; p.size = 0.055 * (1 - gone * 0.8);
      } else if (i < STRIPS * N + N) {
        const s = ((i - STRIPS * N) % N) / (N - 1), [ax, ay] = arc(s), P = place(ax + sw, ay, 0, lift);
        p.x = P[0]; p.y = P[1]; p.z = P[2]; p.size = 0.05 * e * (1 - gone * 0.8);
      } else {
        const q = (i - STRIPS * N - N) / 2, P = place(top[0] - 0.02 * q + sw, top[1] + 0.03 + 0.05 * q, 0, lift);
        p.x = P[0]; p.y = P[1]; p.z = P[2]; p.size = 0.035 * (1 - gone * 0.8);
      }
    });
    // a soft green shimmer round it while it hangs
    fx.every(0.05, peelAt, () => { const [ax, ay] = arc(rnd(0, 1)), P = place(ax + rnd(-0.08, 0.08), ay + rnd(-0.08, 0.08), rnd(-0.06, 0.06)); fx.emit({ x: P[0], y: P[1], z: P[2], vx: rnd(-0.1, 0.1), vy: 0.25, vz: rnd(-0.1, 0.1), life: 0.4, size: 0.018, color: G, flick: 16, gravity: 0 }); });
    // the peel: a pop of sparkle at the stem, and a few bits of skin falling
    fx.at(peelAt, () => {
      const P = place(arc(0)[0], arc(0)[1]);
      fx.burst(P, 26 * fx.power, { color: GW, speed: 1.6, life: 0.5, size: 0.03, gravity: -1.5, drag: 1.2 });
      for (let i = 0; i < 10; i++) { const [ax, ay] = arc(rnd(0.3, 1)), Q = place(ax, ay, rnd(-0.05, 0.05)); fx.emit({ x: Q[0], y: Q[1], z: Q[2], vx: rnd(-0.6, 0.6), vy: rnd(0.2, 0.9), vz: rnd(-0.6, 0.6), life: 0.9, size: 0.03, color: SKIN, gravity: -4, drag: 0.8 }); }
    });
    fx.at(dur - 0.05, () => { for (let i = 0; i < 30; i++) { const [ax, ay] = arc(rnd(0, 1)), P = place(ax, ay, rnd(-0.1, 0.1), 0.9); fx.emit({ x: P[0], y: P[1], z: P[2], vx: rnd(-0.4, 0.4), vy: rnd(0.6, 1.4), vz: rnd(-0.4, 0.4), life: 0.6, size: 0.025, color: i % 3 ? SKIN : FRUIT, flick: 12, gravity: -0.5 }); } });
  },
  // v0.4.8.5 quick patch And The Beat Goes On exclusive: a mirror ball. On the release it drops down over his head on its
  // line, bounces on it, and hangs there turning: rows of silver facets that flash in pink, cyan, purple and yellow as they
  // catch the light, throwing flecks of coloured light out all round and spots of colour that sweep round the floor at his
  // feet. The moment the shot drops (fx.flight) it bursts: every facet flies off in its colour, a shower of coloured light
  // rains down round him and the line whips back up out of sight.
  bg_gfx_discoball(fx) {
    const burstAt = Math.max(0.45, Math.min(1.8, fx.flight || 1.0)), R = 0.2, HANG = 0.5, DROP = 0.3, SPIN = 3.4, TOP = 3.2;
    // (held particles dim over the last fifth of their life: the ball and its line are held a quarter longer and hidden
    // at the burst, so they're at full brightness right up to it)
    const HOLD = burstAt * 1.25 + 0.05;
    const COLS = [DISCO.pink, DISCO.cyan, DISCO.purple, DISCO.yellow];
    // the facets: rows of latitude, fewer toward the poles, every other row staggered (the mirror tiles)
    const facets = [];
    for (let i = 0; i < 9; i++) {
      const lat = -Math.PI / 2 + (i + 0.5) / 9 * Math.PI, n = Math.max(4, Math.round(20 * Math.cos(lat)));
      for (let j = 0; j < n; j++) facets.push({ lat, lon: (j + (i % 2) * 0.5) / n * Math.PI * 2, c: COLS[(i * 7 + j * 3) % 4], ph: rnd(0, 6.3) });
    }
    // where the ball is: it falls in from above (easing out), overshoots, springs back on its line, then hangs
    const centre = t => {
      const h = fx.head(), q = Math.min(1, t / DROP), fall = 1 - Math.pow(1 - q, 3);
      const spring = t > DROP ? -0.07 * Math.exp(-(t - DROP) / 0.14) * Math.sin((t - DROP) * 21) : 0;
      return [h[0], h[1] + HANG + (1 - fall) * 2.4 + spring, h[2]];
    };
    const toCam = () => { const [r, u] = fx.basis(); return [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]]; };
    const facet = (f, t) => { const a = f.lon + t * SPIN, cl = Math.cos(f.lat); return [cl * Math.cos(a), Math.sin(f.lat), cl * Math.sin(a)]; };
    // the ball: each facet silver, brighter facing you, flashing its colour as it turns through the light; the far side hidden
    fx.hold(facets.length, HOLD, i => ({ size: 0.04, color: DISCO.silver.slice() }), (i, k, p) => {
      const t = k * HOLD, f = facets[i], d = facet(f, t), c = centre(t), cv = toCam(), face = d[0] * cv[0] + d[1] * cv[1] + d[2] * cv[2];
      setP(p, [c[0] + d[0] * R, c[1] + d[1] * R, c[2] + d[2] * R]);
      const glint = Math.pow(Math.max(0, Math.sin(t * SPIN * 2.3 + f.ph * 3 + f.lat * 2)), 9), lit = 0.25 + 0.75 * Math.max(0, face);
      for (let j = 0; j < 3; j++) p.color[j] = DISCO.silver[j] * lit * (1 - glint) + f.c[j] * 1.3 * glint;
      p.size = face < -0.12 || t >= burstAt ? 0 : 0.036 + 0.018 * glint;
    });
    // its body: a dim silver glow behind the facets, so it reads as a ball, not a cloud of dots
    fx.hold(3, HOLD, i => ({ size: [0.2, 0.15, 0.1][i], color: [0.16, 0.17, 0.21] }), (i, k, p) => { const t = k * HOLD; setP(p, centre(t)); p.size = t >= burstAt ? 0 : [0.2, 0.15, 0.1][i]; });
    // its line: from the cap on top of the ball straight up out of the frame, and the cap
    const NL = 40;
    fx.hold(NL + 3, HOLD, i => ({ size: i < NL ? 0.011 : 0.026, color: i < NL ? [0.7, 0.7, 0.8] : DISCO.silver.slice() }), (i, k, p) => {
      const t = k * HOLD, c = centre(t);
      if (i < NL) setP(p, [c[0], c[1] + R + 0.03 + (TOP - R) * i / (NL - 1), c[2]]);
      else setP(p, [c[0] + (i - NL - 1) * 0.02, c[1] + R + 0.015, c[2]]);
      p.size = t >= burstAt ? 0 : i < NL ? 0.011 : 0.026;
    });
    // flecks of light thrown off it while it turns (each from a facet facing you, out along its facet)
    fx.every(1 / 60, burstAt, k => {
      const t = k * burstAt; if (t < DROP * 0.8) return;
      const c = centre(t), cv = toCam();
      for (let n = 0; n < 3; n++) {
        const f = pick(facets), d = facet(f, t); if (d[0] * cv[0] + d[1] * cv[1] + d[2] * cv[2] < -0.2) continue;
        const s = rnd(2.4, 4.2);
        fx.emit({ x: c[0] + d[0] * R, y: c[1] + d[1] * R, z: c[2] + d[2] * R, vx: d[0] * s, vy: d[1] * s, vz: d[2] * s, life: rnd(0.3, 0.55), size: rnd(0.018, 0.03), grow: -0.5, color: f.c, gravity: 0, drag: 0.8 });
      }
    });
    // spots of colour sweeping round the floor at his feet (two rings turning opposite ways), fading in as it arrives
    const spots = Array.from({ length: 16 }, (_, i) => ({ r: [0.95, 1.55, 2.15][i % 3], a: i / 16 * Math.PI * 2 + rnd(-0.15, 0.15), c: COLS[i % 4], dir: i % 2 ? 1 : -0.7 }));
    const SPOTS = burstAt + 0.4;
    fx.hold(spots.length, SPOTS, i => ({ size: 0, color: spots[i].c }), (i, k, p) => {
      const t = k * SPOTS, sp = spots[i], f = fx.feet(), a = sp.a + t * sp.dir * SPIN * 0.45, on = Math.min(1, Math.max(0, (t - DROP * 0.7) / 0.2));
      setP(p, [f[0] + Math.cos(a) * sp.r, f[1] + 0.04, f[2] + Math.sin(a) * sp.r]); p.size = 0.11 * on * (t > burstAt ? 1 + 0.6 * Math.exp(-(t - burstAt) / 0.08) : 1);
    });
    // the make: the facets fly off in their colours, a flash, the shower, and the line whips up and away
    fx.at(burstAt, () => {
      const t = burstAt, c = centre(t);
      fx.burst(c, 24, { color: WHITE, speed: 0.8, life: 0.2, size: 0.085, gravity: 0 });
      for (const f of facets) { const d = facet(f, t), s = rnd(2.6, 4.6); fx.emit({ x: c[0] + d[0] * R, y: c[1] + d[1] * R, z: c[2] + d[2] * R, vx: d[0] * s, vy: d[1] * s + 0.6, vz: d[2] * s, life: rnd(0.6, 1.0), size: 0.034, color: f.c, flick: 14, gravity: -3, drag: 1.2 }); }
      const n = Math.round(150 * fx.power);
      for (let i = 0; i < n; i++) { const d = sphereDir(), s = rnd(0.8, 2.8); fx.emit({ x: c[0] + d[0] * 0.15, y: c[1] + d[1] * 0.15, z: c[2] + d[2] * 0.15, vx: d[0] * s, vy: d[1] * s + 1.4, vz: d[2] * s, life: rnd(1.0, 1.45), size: rnd(0.022, 0.034), color: pick(COLS), flick: rnd(8, 14), gravity: -5.5, drag: 0.9 }); }
      for (let i = 0; i < NL; i += 2) fx.emit({ x: c[0], y: c[1] + R + (TOP - R) * i / (NL - 1), z: c[2], vy: 7, life: 0.22, size: 0.011, color: [0.55, 0.55, 0.62], gravity: 0, drag: 0 });
    });
  },
  // v0.4.8.5 quick patch 2 The Monster Mash exclusive: a jack-o'-lantern. On the release a carved pumpkin rises off his
  // head and swells over it (ribbed, rocking a little on the way up), dark at first; then the candle catches and its face
  // lights up, eyes and grin flickering orange-yellow with the flame, a warm glow round it and a wisp of smoke curling up
  // out of the lid by the stem. It swells tighter as the ball flies. The moment the shot drops (fx.flight) it bursts: a
  // flash, the shell blown out in chunks, the stem popping up, a puff of ghost-green smoke, and a swarm of bats pouring out
  // of it in every direction, flapping, zig-zagging away into the night.
  mm_gfx_lantern(fx) {
    const burstAt = Math.max(0.45, Math.min(1.8, fx.flight || 1.0)), R = 0.24, RV = 0.195, HOLD = burstAt * 1.25 + 0.05, power = fx.power || 1;
    const lightAt = Math.min(0.3, burstAt * 0.45), L = LANTERN;
    // where it is and how big: up off his head (easing out, a bob), swelling to full with a little overshoot, then
    // straining bigger as the ball flies; it rocks side to side (a turn about its stem) as it comes up
    const centre = t => { const h = fx.head(), q = Math.min(1, t / 0.42), up = 1 - Math.pow(1 - q, 3); return [h[0], h[1] + 0.1 + 0.3 * up + 0.022 * Math.sin(t * 5.5) * q, h[2]]; };
    const size = t => { const q = Math.min(1, t / 0.4); return (0.3 + 0.7 * (1 - Math.pow(1 - q, 3)) + 0.1 * Math.sin(Math.PI * q)) * (1 + 0.12 * Math.pow(Math.min(1, t / burstAt), 3) + 0.03 * Math.sin(t * 13) * Math.min(1, t / burstAt)); };
    const rock = t => 0.32 * Math.sin(t * 4.2) * Math.exp(-t * 1.6);
    const frame = () => { const [r, u] = fx.basis(); return [r, u, [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]]]; };
    // a point on the pumpkin (x right, y up, z toward the camera, in its own size) turned by `a` about its stem, in the world
    const place = (c, F, s, x, y, z, a) => { const ca = Math.cos(a), sa = Math.sin(a), X = (x * ca + z * sa) * s, Z = (-x * sa + z * ca) * s, Y = y * s; return [c[0] + F[0][0] * X + F[1][0] * Y + F[2][0] * Z, c[1] + F[0][1] * X + F[1][1] * Y + F[2][1] * Z, c[2] + F[0][2] * X + F[1][2] * Y + F[2][2] * Z]; };
    // the flame's flicker: three wobbling sines and the odd gutter
    const flick = t => 0.78 + 0.1 * Math.sin(t * 17.3) + 0.07 * Math.sin(t * 29.1 + 1.1) + 0.05 * Math.sin(t * 46.7 + 2.3) - 0.18 * Math.max(0, Math.sin(t * 3.7)) * Math.max(0, Math.sin(t * 31));
    const lit = t => Math.min(1, Math.max(0, (t - lightAt) / 0.14)) * flick(t);
    // the shell: points over its front (a squat ribbed sphere seen from the front), each skin or a hole in the face; and
    // the rim round its outline, for its shape
    const shell = [], holes = [];
    for (let gy = -1; gy <= 1.001; gy += 0.093) for (let gx = -1; gx <= 1.001; gx += 0.093) {
      const d = gx * gx + gy * gy; if (d > 1) continue;
      const z = Math.sqrt(1 - d), lon = Math.asin(Math.max(-1, Math.min(1, gx / Math.max(0.05, Math.sqrt(1 - gy * gy))))), rib = Math.pow(Math.abs(Math.cos(4 * lon)), 0.5);
      const pt = { x: gx * R * (0.94 + 0.06 * rib), y: gy * RV, z: z * R * (0.94 + 0.06 * rib), rib, hole: LANTERN_FACE.some(P => inPoly(gx, gy, P)) };
      (pt.hole ? holes : shell).push(pt);
    }
    for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; shell.push({ x: Math.cos(a) * R * 0.98, y: Math.sin(a) * RV * 0.98, z: 0, rib: 0.5, rim: true }); }
    // (the holes are filled with candlelight a little inside the shell, so a rocking pumpkin shows it through its face)
    const parts = [];
    parts.push(...fx.hold(shell.length, HOLD, i => ({ size: 0.034, color: L.skin.slice() }), (i, k, p) => {
      const t = k * HOLD, q = shell[i], c = centre(t), F = frame(), s = size(t), a = rock(t), P = place(c, F, s, q.x, q.y + (q.y > 0.13 ? -0.02 : 0), q.z, a);
      setP(p, P);
      // (dark before the candle catches; lit, the skin warms a little with it)
      const on = lit(t), facing = q.rim ? 0.3 : Math.max(0, -q.x * Math.sin(a) + q.z * Math.cos(a)) / R, glow = 0.05 * on * (q.rim ? 0 : 1);
      for (let j = 0; j < 3; j++) p.color[j] = (L.groove[j] + (L.skin[j] - L.groove[j]) * q.rib) * (0.45 + 0.55 * facing) * (0.68 + 0.32 * Math.min(1, on)) + L.candle[j] * glow;
      p.size = t >= burstAt || (facing <= 0 && !q.rim) ? 0 : (q.rim ? 0.026 : 0.031) * s;
    }));
    parts.push(...fx.hold(holes.length, HOLD, i => ({ size: 0, color: L.candle.slice() }), (i, k, p) => {
      const t = k * HOLD, q = holes[i], c = centre(t), F = frame(), s = size(t), a = rock(t), P = place(c, F, s, q.x, q.y, q.z * 0.86, a), on = lit(t);
      setP(p, P);
      const mid = 1 - Math.min(1, hypot2(q.x / R, (q.y / RV + 0.15) * 0.8));
      for (let j = 0; j < 3; j++) p.color[j] = (L.candle[j] + (L.core[j] - L.candle[j]) * mid * 0.6) * on;
      p.size = t >= burstAt ? 0 : 0.032 * s * Math.min(1, on * 1.6);
    }));
    // its stem (curling over), and a warm glow round it once it's lit
    parts.push(...fx.hold(7, HOLD, i => ({ size: 0.03, color: L.stem }), (i, k, p) => {
      const t = k * HOLD, c = centre(t), F = frame(), s = size(t), a = rock(t), u = i / 6;
      setP(p, place(c, F, s, -0.02 * u * u, RV * 0.86 + 0.09 * u, -0.01 - 0.03 * u * u, a)); p.size = t >= burstAt ? 0 : (0.034 - 0.012 * u) * s;
    }));
    parts.push(...fx.hold(3, HOLD, i => ({ size: 0, color: L.halo }), (i, k, p) => {
      const t = k * HOLD; setP(p, centre(t)); p.size = t >= burstAt ? 0 : [0.55, 0.42, 0.3][i] * size(t) * lit(t);
    }));
    // the wisp of smoke out of the lid, curling as it rises
    fx.every(1 / 30, burstAt, k => {
      const t = k * burstAt; if (t < lightAt + 0.05) return;
      const c = centre(t), s = size(t), F = frame(), P = place(c, F, s, 0.035, RV * 0.75, -0.02, rock(t));
      fx.emit({ x: P[0], y: P[1], z: P[2], vx: 0.22 * Math.sin(t * 6.3), vy: 0.36, vz: 0.22 * Math.cos(t * 4.1), life: 0.8, size: 0.026, grow: 2.6, color: L.smoke, gravity: 0.25, drag: 0.5 });
    });
    // the burst
    fx.at(burstAt, () => {
      const t = burstAt, c = centre(t), F = frame(), s = size(t), a = rock(t);
      for (const q of parts) q.life = 0; // (the pumpkin itself is gone: its particles go now, not when their hold runs out)
      fx.burst(c, 22, { color: L.core, speed: 0.9, life: 0.22, size: 0.1, gravity: 0 });
      // the shell blown out in chunks (out from the middle, up a little, falling)
      for (const q of shell) {
        if (Math.random() < 0.45) continue;
        const P = place(c, F, s, q.x, q.y, q.z, a), d = [P[0] - c[0], P[1] - c[1], P[2] - c[2]], l = hypot3(d[0], d[1], d[2]) || 1, sp = rnd(2.2, 4.2);
        fx.emit({ x: P[0], y: P[1], z: P[2], vx: d[0] / l * sp, vy: d[1] / l * sp + 1.6, vz: d[2] / l * sp, life: rnd(0.55, 0.95), size: rnd(0.028, 0.045), color: Math.random() < 0.3 ? L.chunk.map(v => v * 0.45) : L.chunk, gravity: -7, drag: 0.6 });
      }
      for (let i = 0; i < 30; i++) { const d = sphereDir(), sp = rnd(1, 3); fx.emit({ x: c[0], y: c[1], z: c[2], vx: d[0] * sp, vy: d[1] * sp + 1, vz: d[2] * sp, life: rnd(0.3, 0.6), size: 0.022, color: L.candle, flick: 20, gravity: -2, drag: 1 }); }
      const st = place(c, F, s, 0, RV, 0, a);
      for (let i = 0; i < 4; i++) fx.emit({ x: st[0], y: st[1] + i * 0.02, z: st[2], vx: 0.3, vy: 3.2 - i * 0.1, vz: 0, life: 0.7, size: 0.03, color: L.stem, gravity: -8, drag: 0.3 });
      // the ghost-green puff
      for (let i = 0; i < Math.round(26 * power); i++) { const d = sphereDir(), sp = rnd(0.5, 1.6); fx.emit({ x: c[0] + d[0] * 0.1, y: c[1] + d[1] * 0.1, z: c[2] + d[2] * 0.1, vx: d[0] * sp, vy: d[1] * sp + 0.3, vz: d[2] * sp, life: rnd(0.7, 1.1), size: rnd(0.06, 0.1), grow: 1.8, color: L.ghost, gravity: 0.35, drag: 1.7 }); }
      // the bats: each a little flat bat (body, ears, red eyes, two wings of a leading edge and a scalloped trailing one),
      // flapping fast, pouring out every way (round the compass, low to high), slowing, zig-zagging, shrinking off
      const nb = Math.min(15, Math.round(12 * power)), bats = [];
      for (let b = 0; b < nb; b++) {
        const az = b / nb * Math.PI * 2 + rnd(-0.2, 0.2), el = rnd(-0.25, 0.85), ce = Math.cos(el);
        bats.push({ d: [Math.cos(az) * ce, Math.sin(el), Math.sin(az) * ce], sp: rnd(2.4, 3.6), rate: rnd(36, 46), ph: rnd(0, 6.3), zz: rnd(5, 8), zp: rnd(0, 6.3), sc: rnd(1.35, 1.7), life: rnd(1.15, 1.5) });
      }
      // a bat (wings level, x out along the wing 0 .. 1, y up): the body and head, two ears, the eyes; each wing's leading
      // edge (arm and finger) out to its tip, its trailing edge scalloped between the finger tips (three scallops), and
      // the membrane between
      const pts = [[0, 0, 'b', 0.03], [0, -0.028, 'b', 0.026], [0, 0.03, 'b', 0.024], [-0.011, 0.052, 'b', 0.011], [0.011, 0.052, 'b', 0.011], [-0.008, 0.033, 'e', 0.008], [0.008, 0.033, 'e', 0.008]];
      for (const sd of [-1, 1]) {
        for (const f of [0.2, 0.4, 0.6, 0.8, 1]) pts.push([sd, f, 'L', f === 1 ? 0.016 : 0.022]);
        for (const f of [0.26, 0.42, 0.56, 0.7, 0.84, 0.97]) pts.push([sd, f, 'T', 0.017]);
        for (const f of [0.3, 0.55, 0.78]) pts.push([sd, f, 'M', 0.02]);
      }
      const wing = (f, flap) => 0.012 + 0.035 * f + 0.11 * flap * Math.pow(f, 1.3);
      // (the trailing edge comes up to each finger tip, at .42, .7, .97, and sags between them)
      const trail = f => 0.06 * (1 - 0.6 * f) * (0.35 + 0.65 * Math.abs(Math.sin(Math.PI * (f - 0.14) / 0.28)));
      const BL = 1.6, n = pts.length;
      fx.hold(nb * n, BL, i => { const q = pts[i % n]; return { size: 0, color: q[2] === 'e' ? L.batEye : q[2] === 'b' ? L.batBody : L.bat }; }, (i, k, p) => {
        const bt = bats[Math.floor(i / n)], q = pts[i % n], tt = k * BL, [r, u] = fx.basis();
        if (tt > bt.life) { p.size = 0; return; }
        // flight: out fast and slowing, climbing, zig-zagging across its path
        const out = bt.sp * (1 - Math.exp(-tt * 1.4)) / 1.4, zig = 0.14 * Math.sin(tt * bt.zz + bt.zp) * Math.min(1, tt * 4);
        const cx = c[0] + bt.d[0] * out - bt.d[2] * zig, cy = c[1] + bt.d[1] * out + 0.35 * tt * tt, cz = c[2] + bt.d[2] * out + bt.d[0] * zig;
        const sc = bt.sc * Math.min(1, 0.3 + tt * 4.5) * (1 - 0.3 * tt / bt.life), flap = Math.sin(tt * bt.rate + bt.ph);
        let gx, gy;
        if (q[2] === 'b' || q[2] === 'e') { gx = q[0]; gy = q[1] + 0.008 * flap; }
        else { gx = q[0] * (0.02 + 0.16 * q[1]); gy = wing(q[1], flap) - (q[2] === 'T' ? trail(q[1]) : q[2] === 'M' ? trail(q[1]) * 0.5 : 0); }
        setP(p, [cx + (r[0] * gx + u[0] * gy) * sc, cy + (r[1] * gx + u[1] * gy) * sc, cz + (r[2] * gx + u[2] * gy) * sc]);
        p.size = q[3] * sc * Math.min(1, (bt.life - tt) / 0.25);
      });
    });
  },
  // ---- v0.4.7.5 quick patch: fourteen more ----

  // a phoenix of green fire rises off his head, beating its wings three times and shedding embers, then bursts
  // v0.4.8.7 The Favelas exclusive: pipas. On the release a few scraps of coloured kite paper flutter up round his head
  // like a handful being got ready; the moment the shot drops (fx.flight) a whole flight of paper kites launches off his
  // head with a pop of paper confetti: each a diamond of tissue in two colours split down its spine, its cross spars
  // dark across it, climbing and fanning out every way across the sky (out fast, then riding the wind: slowing, drifting
  // up, swaying), nose first, rocking as they go, each with a long tail of little bows streaming behind it and
  // fluttering in waves; they get smaller as they fly off and are gone in under two seconds.
  fv_gfx_pipa(fx) {
    const burstAt = Math.max(0.35, Math.min(1.8, fx.flight || 1.0)), power = fx.power || 1, K = PIPA;
    // the warm-up: scraps of paper twirling up round his head
    fx.every(1 / 30, burstAt, k => {
      const h = fx.head(), a = rnd(0, Math.PI * 2), r = rnd(0.15, 0.35);
      fx.emit({ x: h[0] + Math.cos(a) * r, y: h[1] + rnd(0.05, 0.3), z: h[2] + Math.sin(a) * r, vx: -Math.sin(a) * 0.6, vy: rnd(0.4, 0.9), vz: Math.cos(a) * 0.6, life: rnd(0.35, 0.6), size: rnd(0.02, 0.032), color: pick(K.papers), flick: 10, gravity: 0.2, drag: 1.2 });
    });
    fx.at(burstAt, () => {
      const c0 = add(fx.head(), 0, 0.3), [r0, u0] = fx.basis(), f0 = toward(fx);
      // the pop: a puff of paper confetti in every colour, and a flash
      fx.burst(c0, 16, { color: WHITE, speed: 0.7, life: 0.18, size: 0.07, gravity: 0 });
      for (let i = 0; i < Math.round(70 * power); i++) { const d = sphereDir(), s = rnd(1.5, 3.4); fx.emit({ x: c0[0], y: c0[1], z: c0[2], vx: d[0] * s, vy: d[1] * s + 1.2, vz: d[2] * s, life: rnd(0.7, 1.2), size: rnd(0.018, 0.03), color: pick(K.papers), flick: rnd(8, 14), gravity: -4, drag: 1.4 }); }
      // the kites: a fan across the sky (round the upper half of the screen, a little toward you and away), each its own speed
      const nk = Math.min(14, Math.round(10 * power)), kites = [];
      for (let i = 0; i < nk; i++) {
        const a = Math.PI * (0.08 + 0.84 * (i + rnd(0.2, 0.8)) / nk), dep = rnd(-0.45, 0.45), ca = Math.cos(a), sa = Math.sin(a);
        const d = [r0[0] * ca + u0[0] * sa + f0[0] * dep, r0[1] * ca + u0[1] * sa + f0[1] * dep, r0[2] * ca + u0[2] * sa + f0[2] * dep], l = hypot3(d[0], d[1], d[2]);
        const pa = Math.floor(rnd(0, K.papers.length));
        kites.push({ d: d.map(v => v / l), sp: rnd(3.6, 5.2), tau: rnd(0.45, 0.65), rise: rnd(0.3, 0.6), ph: rnd(0, 6.3), sc: rnd(0.95, 1.25), A: K.papers[pa], B: K.papers[(pa + 1 + Math.floor(rnd(0, K.papers.length - 1))) % K.papers.length], life: rnd(K.life - 0.3, K.life) });
      }
      // a kite's points: the paper (a grid over the diamond, each side its colour), the spars down the spine and across,
      // then the tail (a string of bows off the tail tip)
      const pts = [];
      for (let gy = -0.2; gy <= 0.165; gy += 0.03) for (let gx = -0.125; gx <= 0.126; gx += 0.03) if (inPoly(gx, gy, K.shape)) pts.push([gx, gy, gx < 0 ? 'A' : 'B']);
      for (let s = -0.19; s <= 0.16; s += 0.035) pts.push([0, s, 's']);
      for (let s = -0.11; s <= 0.111; s += 0.037) pts.push([s, 0.04, 's']);
      const NP = pts.length, NT = K.tail, N = NP + NT, BL = K.life + 0.05;
      fx.hold(nk * N, BL, i => { const q = i < nk * N ? pts[i % N] : null; return { size: 0, color: q ? (q[2] === 's' ? K.spar : q[2] === 'A' ? kites[Math.floor(i / N)].A : kites[Math.floor(i / N)].B) : K.bow }; }, (i, k, p) => {
        const kt = kites[Math.floor(i / N)], j = i % N, tt = k * BL, [r, u] = fx.basis();
        if (tt > kt.life) { p.size = 0; return; }
        // its flight: out fast along its line, slowing (riding the wind), drifting up, swaying across
        const go = kt.sp * kt.tau * (1 - Math.exp(-tt / kt.tau)), sway = 0.18 * Math.sin(2.6 * tt + kt.ph) * Math.min(1, tt * 2);
        const C = [c0[0] + kt.d[0] * go + r[0] * sway, c0[1] + kt.d[1] * go + kt.rise * tt + r[1] * sway, c0[2] + kt.d[2] * go + r[2] * sway];
        // nose first along its flight on the screen (its spine along where it's heading), rocking
        const vx = kt.d[0] * r[0] + kt.d[1] * r[1] + kt.d[2] * r[2], vy = kt.d[0] * u[0] + kt.d[1] * u[1] + kt.d[2] * u[2] + 0.25;
        const ang = Math.atan2(vy, vx) - Math.PI / 2 + 0.3 * Math.sin(6.5 * tt + kt.ph) * Math.exp(-tt * 0.8), ca = Math.cos(ang), sa = Math.sin(ang);
        const fade = Math.min(1, (kt.life - tt) / 0.35), s = kt.sc * (1 - 0.35 * Math.min(1, tt / kt.life)) * Math.min(1, tt / 0.08 + 0.3);
        let lx, ly, size;
        if (j < NP) { lx = pts[j][0]; ly = pts[j][1]; size = (pts[j][2] === 's' ? 0.016 : 0.03) * s * fade; }
        else {
          // the tail off the tail tip, streaming back and waving (the wave runs down it), its bows bigger every third
          const m = j - NP + 1, along = 0.045 * m;
          lx = 0.06 * Math.sin(13 * tt - m * 0.85 + kt.ph) * Math.min(1, m / 4); ly = K.shape[2][1] - along; size = (m % 3 === 0 ? 0.026 : 0.014) * s * fade;
        }
        const X = (lx * ca - ly * sa) * s, Y = (lx * sa + ly * ca) * s;
        setP(p, [C[0] + r[0] * X + u[0] * Y, C[1] + r[1] * X + u[1] * Y, C[2] + r[2] * X + u[2] * Y]);
        p.size = size;
      });
    });
  },

  gfx_phoenix(fx) {
    const dur = 1.3, pts = [];
    for (let i = 0; i <= 9; i++) pts.push(['body', 0, -0.16 + i * 0.035, 0.045]);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; pts.push(['body', Math.cos(a) * 0.045, 0.22 + Math.sin(a) * 0.045, 0.035]); }
    for (const sx of [-1, 0, 1]) for (let i = 1; i <= 8; i++) { const t = i / 8; pts.push(['tail', sx * 0.13 * t + Math.sin(t * 5) * 0.02 * sx, -0.16 - 0.32 * t - (sx ? 0 : 0.06 * t), 0.04 - 0.015 * t]); }
    for (const side of [-1, 1]) for (const edge of [0, 1]) for (let i = 1; i <= 16; i++) pts.push(['wing', side, i / 16, edge]);
    const wing = (side, s, edge, k) => {
      const flap = Math.sin(k * Math.PI * 6 - 0.6), tipY = 0.32 * flap;
      return [side * (0.04 + 0.6 * s), 0.05 + tipY * Math.pow(s, 1.4) + 0.1 * Math.sin(Math.PI * s) - edge * (0.07 + 0.06 * s)];
    };
    const centre = k => add(fx.head(), 0, 0.35 + 1.5 * k * k, 0);
    fx.hold(pts.length, dur, i => { const q = pts[i]; return { size: q[0] === 'wing' ? (q[3] ? 0.03 : 0.04) : q[3], color: q[0] === 'body' ? EMBER : q[0] === 'tail' ? mix(EMBER, G, i % 3 / 2) : q[3] ? G : GW }; }, (i, k, p) => {
      const q = pts[i], c = centre(k), grow = Math.min(1, k * 6);
      const [gx, gy] = q[0] === 'wing' ? wing(q[1], q[2], q[3], k) : [q[1], q[2]];
      setP(p, flat(fx, c, gx * grow, gy * grow));
    });
    fx.every(0.025, dur, k => {
      const c = centre(k);
      for (let j = 0; j < 4; j++) { const side = j % 2 ? 1 : -1, [gx, gy] = wing(side, Math.random(), 1, k), P = flat(fx, c, gx, gy); fx.emit({ x: P[0], y: P[1], z: P[2], vx: rnd(-0.3, 0.3), vy: rnd(-0.6, 0), vz: rnd(-0.3, 0.3), life: rnd(0.3, 0.6), size: 0.03, grow: -0.6, color: pick([EMBER, G, GW]), flick: 20, gravity: 1.2, drag: 1.5 }); }
    });
    fx.at(dur, () => fx.burst(centre(1), 80 * fx.power, { color: EMBER, speed: 3, life: 0.8, size: 0.04, gravity: -2 }));
  },

  // a "$" of green light pops up over him, turns once, and bursts into bills that flutter down around him
  gfx_cash(fx) {
    const glyph = [];
    for (let i = 0; i <= 14; i++) { const a = (35 + i / 14 * 235) * Math.PI / 180; glyph.push([Math.cos(a) * 0.1, 0.1 + Math.sin(a) * 0.1]); }
    for (let i = 0; i <= 14; i++) { const a = (90 - i / 14 * 235) * Math.PI / 180; glyph.push([Math.cos(a) * 0.1, -0.1 + Math.sin(a) * 0.1]); }
    for (let i = 0; i <= 10; i++) glyph.push([0, -0.27 + i * 0.054]);
    const dur = 0.75, c0 = () => add(fx.head(), 0, 0.55);
    fx.hold(glyph.length, dur, i => ({ size: 0.04, color: i > 29 ? WHITE : [0.4, 3, 0.7] }), (i, k, p) => {
      const pop = Math.min(1, k * 6) * (1 + 0.2 * Math.max(0, 1 - Math.abs(k * 6 - 1.3))), turn = Math.cos(Math.min(1, k * 2.6) * Math.PI * 2); // (one quick turn, then it faces you)
      setP(p, flat(fx, c0(), glyph[i][0] * pop * turn, glyph[i][1] * pop));
    });
    fx.at(dur, () => {
      const c = c0(), n = Math.round(36 * fx.power), bills = [];
      for (let i = 0; i < n; i++) bills.push({ a: rnd(0, Math.PI * 2), out: rnd(0.4, 1.5), up: rnd(0.2, 0.8), sway: rnd(4, 7), ph: rnd(0, 6), fall: rnd(0.9, 1.4) });
      fx.hold(n, 1.6, i => ({ size: 0.05, color: i % 5 ? [0.45, 2.4, 0.6] : GOLD, flick: rnd(5, 9) }), (i, k, p) => {
        const b = bills[i], t = k * 1.6, r = b.out * (1 - Math.exp(-t * 4)), s = 0.18 * Math.sin(t * b.sway + b.ph);
        p.x = c[0] + Math.cos(b.a) * r + Math.cos(b.a + 1.57) * s; p.z = c[2] + Math.sin(b.a) * r + Math.sin(b.a + 1.57) * s;
        p.y = Math.max(0.05, c[1] + b.up * Math.min(1, t * 5) - b.fall * Math.max(0, t - 0.2) * 1.2);
      });
      fx.burst(c, 30, { color: GOLD, speed: 2.2, life: 0.5, size: 0.03, gravity: -3 });
    });
  },

  // the release cracks the air: a flash, a column of light and three shock rings racing out across the floor
  gfx_shockwave(fx) {
    const f = fx.feet(), h = fx.head();
    fx.burst(add(h, 0, 0.1), 30, { color: WHITE, speed: 1.5, life: 0.25, size: 0.06, gravity: 0 });
    for (let i = 0; i < 40; i++) fx.emit({ x: h[0] + rnd(-0.05, 0.05), y: h[1] + 0.1, z: h[2] + rnd(-0.05, 0.05), vy: rnd(6, 11), life: 0.35, size: 0.05, grow: -0.5, color: GW, gravity: 0, drag: 2 });
    for (let r = 0; r < 3; r++) fx.at(r * 0.12, () => {
      const n = 72;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; fx.emit({ x: f[0] + Math.cos(a) * 0.2, y: f[1] + 0.06 + r * 0.02, z: f[2] + Math.sin(a) * 0.2, vx: Math.cos(a) * (9 - r * 2), vz: Math.sin(a) * (9 - r * 2), life: 0.6, size: 0.06 - r * 0.012, grow: 0.8, color: r ? G : WHITE, gravity: 0, drag: 2.6 }); }
      for (let i = 0; i < 18; i++) { const a = rnd(0, Math.PI * 2); fx.emit({ x: f[0] + Math.cos(a) * 0.4, y: f[1] + 0.05, z: f[2] + Math.sin(a) * 0.4, vx: Math.cos(a) * rnd(1, 3), vy: rnd(0.5, 1.5), vz: Math.sin(a) * rnd(1, 3), life: 0.8, size: 0.1, grow: 1.5, color: GD, gravity: -0.5, drag: 1.5 }); }
    });
    fx.at(0.05, () => { const c = add(fx.head(), 0, -0.5); for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; fx.emit({ x: c[0], y: c[1], z: c[2], vx: Math.cos(a) * 5, vy: 0, vz: Math.sin(a) * 5, life: 0.4, size: 0.035, color: GW, gravity: 0, drag: 3 }); } });
  },

  // an atom over his head: a glowing nucleus, three electrons on tilted orbits leaving trails, then it splits
  gfx_atom(fx) {
    const dur = 1.35, R = 0.42, tilts = [0, Math.PI / 3, -Math.PI / 3];
    // (the classic atom: three ellipses turned 60 degrees apart, facing the camera)
    const orbit = (o, a, c) => { const t = tilts[o], x = Math.cos(a) * R, y = Math.sin(a) * R * 0.36; return flat(fx, c, x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)); };
    const centre = () => add(fx.head(), 0, 0.55);
    fx.hold(14, dur, i => ({ size: i < 2 ? 0.09 : 0.05, color: i < 2 ? WHITE : i % 2 ? GW : G }), (i, k, p) => { const c = centre(), a = i * 2.4 + k * 30; setP(p, add(c, Math.cos(a) * 0.05 * (i % 3), Math.sin(a * 1.3) * 0.05 * (i % 3), Math.sin(a) * 0.05 * ((i + 1) % 3))); });
    fx.hold(3 * 30, dur, () => ({ size: 0.016, color: GD }), (i, k, p) => { const o = Math.floor(i / 30), a = (i % 30) / 30 * Math.PI * 2; setP(p, orbit(o, a, centre())); p.size = 0.016 * Math.min(1, k * 5); });
    const spot = (o, k) => orbit(o, k * 28 + o * 2.1, centre());
    fx.hold(3, dur, () => ({ size: 0.06, color: WHITE }), (i, k, p) => setP(p, spot(i, k)));
    fx.every(1 / 60, dur, k => { for (let o = 0; o < 3; o++) { const P = spot(o, k); fx.emit({ x: P[0], y: P[1], z: P[2], life: 0.22, size: 0.035, grow: -0.9, color: GW, gravity: 0, drag: 0 }); } });
    fx.at(dur, () => { const c = centre(); fx.burst(c, 70 * fx.power, { color: GW, speed: 3.4, life: 0.6, size: 0.035, gravity: -1 }); for (let o = 0; o < 3; o++) { const P = spot(o, 1), d = [P[0] - c[0], P[1] - c[1], P[2] - c[2]]; fx.emit({ x: P[0], y: P[1], z: P[2], vx: d[0] * 12, vy: d[1] * 12, vz: d[2] * 12, life: 0.5, size: 0.06, color: WHITE, gravity: 0, drag: 0.5 }); } });
  },

  // a spiral galaxy turns over his head (two arms of stars round a bright core), then falls into its core and flashes
  gfx_galaxy(fx) {
    const dur = 1.45, n = 150, stars = [];
    for (let i = 0; i < n; i++) { const arm = i % 2, t = Math.pow(Math.random(), 0.8); stars.push({ r: 0.05 + 0.6 * t, a: arm * Math.PI + t * 4.2 + rnd(-0.3, 0.3), y: rnd(-0.03, 0.03), c: Math.random() < 0.08 ? GOLD : t < 0.25 ? WHITE : pick([G, GW, GW, [0.6, 2.2, 2.0]]), s: rnd(0.015, 0.035) }); }
    const ringPt = (a, r, y) => { const [rt, up] = fx.basis(), h = add(fx.head(), 0, 0.75), fw = toward(fx), tip = 0.45, c = Math.cos(a) * r, d = Math.sin(a) * r; return [h[0] + rt[0] * c + fw[0] * d * Math.cos(tip), h[1] + d * Math.sin(tip) + y, h[2] + rt[2] * c + fw[2] * d * Math.cos(tip)]; };
    fx.hold(n, dur, i => ({ size: stars[i].s, color: stars[i].c }), (i, k, p) => {
      const st = stars[i], fall = Math.max(0, (k - 0.75) / 0.25), r = st.r * (1 - fall * fall) * Math.min(1, k * 5);
      setP(p, ringPt(st.a + k * (5 / (0.4 + st.r * 3)), r, st.y));
    });
    fx.hold(6, dur, () => ({ size: 0.08, color: WHITE }), (i, k, p) => { setP(p, ringPt(i, 0.02, 0)); p.size = 0.06 + 0.04 * Math.sin(k * 20 + i); });
    fx.at(dur, () => { const c = ringPt(0, 0, 0); fx.burst(c, 60 * fx.power, { color: WHITE, speed: 2.6, life: 0.5, size: 0.04, gravity: 0 }); for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, P = ringPt(a, 0.1, 0), d = [P[0] - c[0], P[1] - c[1], P[2] - c[2]]; fx.emit({ x: c[0], y: c[1], z: c[2], vx: d[0] * 40, vy: d[1] * 40, vz: d[2] * 40, life: 0.45, size: 0.04, color: GW, gravity: 0, drag: 2 }); } });
  },

  // ice cold: a snowflake crystal grows arm by arm over him, turns, shatters into falling ice, and frost rolls out
  gfx_frost(fx) {
    const pts = [];
    for (let arm = 0; arm < 6; arm++) {
      const a = arm / 6 * Math.PI * 2;
      for (let i = 1; i <= 9; i++) pts.push([a, i / 9 * 0.36, 0, i / 9]);
      for (const [at, len] of [[0.15, 0.1], [0.26, 0.07]]) for (const sd of [-1, 1]) for (let i = 1; i <= 3; i++) pts.push([a, at, sd * (i / 3) * len, at / 0.36]);
    }
    const dur = 1.2, centre = () => add(fx.head(), 0, 0.62);
    fx.hold(pts.length, dur, i => ({ size: pts[i][1] > 0.33 ? 0.045 : 0.028, color: pts[i][1] > 0.33 ? WHITE : ICE }), (i, k, p) => {
      const [a, r, side, when] = pts[i], grow = Math.min(1, Math.max(0, (k * 3.5 - when * 0.8) / 0.4)), turn = k * 1.2;
      const ax = a + turn, bx = [Math.cos(ax), Math.sin(ax)], sx = [Math.cos(ax + Math.PI / 3 * Math.sign(side || 1)), Math.sin(ax + Math.PI / 3 * Math.sign(side || 1))], sl = Math.abs(side);
      setP(p, flat(fx, centre(), (bx[0] * r + sx[0] * sl) * grow, (bx[1] * r + sx[1] * sl) * grow));
      p.size = grow > 0 ? (r > 0.33 ? 0.045 : 0.028) : 0;
    });
    fx.at(dur, () => { const c = centre(); for (let i = 0; i < 70; i++) { const a = rnd(0, Math.PI * 2), r = rnd(0, 0.36), P = flat(fx, c, Math.cos(a) * r, Math.sin(a) * r); fx.emit({ x: P[0], y: P[1], z: P[2], vx: Math.cos(a) * rnd(0.5, 1.5), vy: rnd(-0.5, 1.2), vz: rnd(-0.6, 0.6), life: rnd(0.7, 1.1), size: 0.03, color: pick([ICE, WHITE]), flick: 16, gravity: -6, drag: 0.6 }); } });
    const f = fx.feet();
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; fx.emit({ x: f[0] + Math.cos(a) * 0.25, y: f[1] + 0.08, z: f[2] + Math.sin(a) * 0.25, vx: Math.cos(a) * rnd(1.2, 1.8), vy: 0.15, vz: Math.sin(a) * rnd(1.2, 1.8), life: 1.4, size: 0.12, grow: 2, color: [0.25, 0.9, 0.9], gravity: 0, drag: 1.3 }); }
    fx.every(0.05, 1.6, () => { const h = fx.head(); fx.emit({ x: h[0] + rnd(-0.9, 0.9), y: h[1] + rnd(0.6, 1.2), z: h[2] + rnd(-0.9, 0.9), vx: rnd(-0.2, 0.2), vy: -0.6, vz: rnd(-0.2, 0.2), life: 1.4, size: 0.022, color: WHITE, flick: 6, gravity: 0, drag: 0 }); });
  },

  // a circle of green fire runs round him on the floor and burns, two tongues of it leap up round him and burst over
  // his head, and it dies down to embers
  gfx_firering(fx) {
    const dur = 1.35 + 0.25 * (fx.power - 1), R = 0.95;
    fx.every(1 / 60, dur, k => {
      const f = fx.feet(), lit = Math.min(1, k * 6), fade = k < 0.75 ? 1 : (1 - k) / 0.25;
      for (let i = 0; i < 9; i++) {
        const a = rnd(0, Math.PI * 2 * lit), r = R + rnd(-0.06, 0.06), tall = rnd(0.8, 1.8) * fade;
        fx.emit({ x: f[0] + Math.cos(a) * r, y: f[1] + 0.03, z: f[2] + Math.sin(a) * r, vx: rnd(-0.1, 0.1), vy: tall * 1.6, vz: rnd(-0.1, 0.1), life: rnd(0.3, 0.55), size: 0.09 * fade + 0.02, grow: -0.8, color: Math.random() < 0.3 ? [1.4, 3, 1.2] : [0.15, 1.9, 0.45], gravity: 2, drag: 1.4 });
      }
      if (Math.random() < 0.4) { const a = rnd(0, Math.PI * 2); fx.emit({ x: f[0] + Math.cos(a) * R, y: f[1] + 0.4, z: f[2] + Math.sin(a) * R, vx: rnd(-0.3, 0.3), vy: rnd(1.5, 2.6), vz: rnd(-0.3, 0.3), life: 0.9, size: 0.018, color: EMBER, flick: 22, gravity: 0.8, drag: 0.8 }); }
    });
    fx.every(1 / 60, 0.2, k => { const f = fx.feet(), a = k * Math.PI * 2; for (const s of [1, -1]) fx.emit({ x: f[0] + Math.cos(a * s) * R, y: f[1] + 0.05, z: f[2] + Math.sin(a * s) * R, life: 0.3, size: 0.08, color: WHITE, gravity: 0, drag: 0 }); });
    fx.at(0.3, () => fx.every(1 / 60, 0.45, k => {
      const f = fx.feet(), h = fx.head(), y = f[1] + (h[1] + 0.25 - f[1]) * k, r = R * (1 - k * 0.85);
      for (const s of [0, Math.PI]) { const a = k * 7 + s; for (let i = 0; i < 2; i++) fx.emit({ x: f[0] + Math.cos(a) * r + rnd(-0.04, 0.04), y, z: f[2] + Math.sin(a) * r + rnd(-0.04, 0.04), vy: 0.6, life: 0.35, size: 0.08, grow: -0.8, color: i ? [1.4, 3, 1.2] : [0.15, 1.9, 0.45], gravity: 1, drag: 1 }); }
    }));
    fx.at(0.75, () => fx.burst(add(fx.head(), 0, 0.3), 50 * fx.power, { color: [1.2, 3, 1.1], speed: 2.4, life: 0.6, size: 0.04, gravity: -1.5 }));
  },

  // angel wings unfold behind him, give one great beat, glow, and come apart into drifting feathers
  gfx_wings(fx) {
    const dur = 1.3, F = 10, P = 12, list = [];
    for (const side of [-1, 1]) for (let f = 0; f < F; f++) for (let i = 1; i <= P; i++) list.push([side, f, i / P]);
    const base = () => { const h = fx.head(), b = toward(fx); return add(h, -b[0] * 0.2, -0.45, -b[2] * 0.2); };
    const feather = (side, f, s, k) => {
      const open = Math.min(1, k * 3.5) - 0.25 * Math.max(0, Math.sin(Math.min(1, Math.max(0, (k - 0.35) / 0.3)) * Math.PI));
      const ang = (0.2 + (f / (F - 1)) * 1.55) * open + (1 - open) * 1.55, len = 1.15 - f * 0.065;
      return [side * (0.12 + Math.cos(Math.PI / 2 - ang) * len * s), 0.05 + Math.sin(Math.PI / 2 - ang) * len * s * 0.9 + 0.12 * Math.sin(Math.PI * s) * (1 - f / F)];
    };
    fx.hold(list.length, dur, i => { const [, f, s] = list[i]; return { size: s > 0.85 ? 0.04 : 0.028, color: s > 0.7 ? WHITE : f < 3 ? GW : mix(GW, WHITE, 0.5) }; }, (i, k, p) => {
      const [side, f, s] = list[i], [gx, gy] = feather(side, f, s, k);
      setP(p, flat(fx, base(), gx, gy));
    });
    fx.at(dur, () => { const b = base(); for (const [side, f, s] of list) { if (Math.random() < 0.5) continue; const [gx, gy] = feather(side, f, s, 1), Q = flat(fx, b, gx, gy); fx.emit({ x: Q[0], y: Q[1], z: Q[2], vx: rnd(-0.3, 0.3) + side * 0.2, vy: rnd(-0.1, 0.3), vz: rnd(-0.3, 0.3), life: rnd(0.9, 1.4), size: 0.03, flick: rnd(3, 6), color: WHITE, gravity: -0.6, drag: 1.4 }); } });
  },

  // a jade dragon winds up out of the floor around him, scales glinting, and soars off into the sky
  gfx_dragon(fx) {
    const dur = 1.6, N = 72, sp = 0.04;
    const path = s => { // s: distance along its flight, metres
      const f = fx.feet(), turns = s / 1.6, y = Math.min(2.6, s * 0.42), r = 0.85, a = turns * Math.PI * 2;
      const up = Math.max(0, s - 6.5);
      return [f[0] + Math.cos(a) * r * (1 + up * 0.15), f[1] + 0.2 + y + up * 1.6, f[2] + Math.sin(a) * r * (1 + up * 0.15)];
    };
    const head = k => k * 9.5;
    const thick = i => (i < 4 ? 0.11 : 0.095 * (1 - i / N) + 0.025);
    fx.hold(N, dur, i => ({ size: thick(i), color: i < 4 ? EMBER : i % 5 === 0 ? WHITE : i % 2 ? G : [0.3, 2.2, 1.2] }), (i, k, p) => {
      const s = head(k) - i * sp;
      if (s < 0) { p.size = 0; setP(p, path(0)); return; }
      setP(p, path(s));
      p.size = thick(i);
    });
    fx.hold(4, dur, () => ({ size: 0.02, color: WHITE }), (i, k, p) => { const s = head(k), a = path(s), b = path(Math.max(0, s - sp)), d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; setP(p, add(a, d[0] * (3 + i), d[1] * (3 + i) + (i % 2 ? 0.05 : -0.05) * (1 + i * 0.3), d[2] * (3 + i))); });
    fx.every(0.03, dur, k => { const s = head(k) - Math.floor(Math.random() * N) * sp; if (s < 0) return; const P = path(s); fx.emit({ x: P[0], y: P[1], z: P[2], vx: rnd(-0.3, 0.3), vy: rnd(-0.3, 0.3), vz: rnd(-0.3, 0.3), life: 0.4, size: 0.02, flick: 20, color: pick([WHITE, GOLD, GW]), gravity: -0.5 }); });
    fx.at(dur, () => fx.burst(path(head(1)), 50 * fx.power, { color: GW, speed: 2.4, life: 0.6, size: 0.035, gravity: -1.5 }));
  },

  // meteors streak down out of the sky and hit the floor all round him, each impact throwing up a ring and sparks
  gfx_meteor(fx) {
    const n = fx.power > 1.1 ? 8 : 6;
    for (let m = 0; m < n; m++) fx.at(m * 0.14 + rnd(0, 0.05), () => {
      const f = fx.feet(), a = rnd(0, Math.PI * 2), r = rnd(0.7, 2.2), hit = [f[0] + Math.cos(a) * r, f[1] + 0.02, f[2] + Math.sin(a) * r];
      const from = add(hit, rnd(-2.5, 2.5), rnd(5, 6.5), rnd(-2.5, 2.5)), T = 0.38;
      fx.every(1 / 60, T, k => {
        const P = [from[0] + (hit[0] - from[0]) * k, from[1] + (hit[1] - from[1]) * k, from[2] + (hit[2] - from[2]) * k];
        fx.emit({ x: P[0], y: P[1], z: P[2], life: 0.28, size: 0.07, grow: -0.9, color: EMBER, gravity: 0, drag: 0 });
        fx.emit({ x: P[0], y: P[1], z: P[2], vx: rnd(-0.4, 0.4), vy: rnd(-0.2, 0.4), vz: rnd(-0.4, 0.4), life: 0.3, size: 0.025, color: GW, flick: 25, gravity: 0 });
      });
      fx.at(T, () => {
        for (let i = 0; i < 28; i++) { const b = i / 28 * Math.PI * 2; fx.emit({ x: hit[0], y: hit[1] + 0.04, z: hit[2], vx: Math.cos(b) * 2.4, vy: 0.1, vz: Math.sin(b) * 2.4, life: 0.4, size: 0.04, grow: 0.6, color: G, gravity: 0, drag: 3 }); }
        fx.burst(hit, 22, { color: EMBER, speed: 2.2, life: 0.5, size: 0.03, gravity: -7, up: 1.2 });
      });
    });
  },

  // a laser show: beams fan out from a point over his head and sweep the sky, then pull back in
  gfx_lasers(fx) {
    const dur = 1.3, B = 8, P = 28, L = 4.2, cols = [G, WHITE, [0.4, 2.6, 2.4], GW];
    const src = () => add(fx.head(), 0, 0.5);
    const dir = (b, k) => { const yaw = b / B * Math.PI * 2 + Math.sin(k * 7 + b) * 0.6 + k * 3, el = 0.55 + 0.35 * Math.sin(k * 9 + b * 1.7); return [Math.cos(yaw) * Math.cos(el), Math.sin(el), Math.sin(yaw) * Math.cos(el)]; };
    fx.hold(B * P, dur, i => ({ size: 0.022, color: cols[Math.floor(i / P) % cols.length] }), (i, k, p) => {
      const b = Math.floor(i / P), t = (i % P + 1) / P, reach = Math.min(1, k * 5) * Math.min(1, (1 - k) * 5) * L, d = dir(b, k), s = src();
      setP(p, add(s, d[0] * reach * t, d[1] * reach * t, d[2] * reach * t));
      p.size = 0.022 * (1 + 0.6 * (1 - t));
    });
    fx.hold(5, dur, () => ({ size: 0.07, color: WHITE }), (i, k, p) => { setP(p, add(src(), Math.cos(i * 1.3) * 0.03, Math.sin(i * 2.1) * 0.03, 0)); p.size = 0.05 + 0.03 * Math.sin(k * 40 + i); });
    fx.every(0.04, dur, k => { const b = Math.floor(Math.random() * B), d = dir(b, k), s = src(), t = rnd(0.3, 1) * Math.min(1, k * 5) * L; fx.emit({ x: s[0] + d[0] * t, y: s[1] + d[1] * t, z: s[2] + d[2] * t, life: 0.2, size: 0.05, color: WHITE, flick: 30, gravity: 0, drag: 0 }); });
  },

  // a four-leaf clover pops up over him, spins, and bursts into gold: the luck of the green
  gfx_clover(fx) {
    const heart = t => [Math.pow(Math.sin(t), 3), (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16];
    const tip = heart(Math.PI), pts = [];
    for (let leaf = 0; leaf < 4; leaf++) {
      const rot = Math.PI / 4 + leaf * Math.PI / 2;
      for (let i = 0; i < 22; i++) {
        const [hx, hy] = heart(i / 22 * Math.PI * 2), x = hx * 0.11, y = (hy - tip[1]) * 0.11; // (the leaf's point at the middle)
        pts.push([x * Math.cos(rot - Math.PI / 2) - y * Math.sin(rot - Math.PI / 2), x * Math.sin(rot - Math.PI / 2) + y * Math.cos(rot - Math.PI / 2), 0]);
      }
    }
    for (let i = 1; i <= 7; i++) pts.push([Math.sin(i / 7 * 1.2) * 0.05, -i / 7 * 0.3, 1]);
    const dur = 1.15, centre = () => add(fx.head(), 0, 0.6);
    fx.hold(pts.length, dur, i => ({ size: pts[i][2] ? 0.03 : 0.036, color: pts[i][2] ? [0.2, 1.8, 0.4] : i % 22 < 3 ? WHITE : [0.3, 2.9, 0.6] }), (i, k, p) => {
      const pop = Math.min(1, k * 5) * (1 + 0.18 * Math.max(0, 1 - Math.abs(k * 5 - 1.2))) * (1 + 0.06 * Math.sin(k * 26)), spin = k * 3.2, [x, y] = pts[i];
      setP(p, flat(fx, centre(), (x * Math.cos(spin) - y * Math.sin(spin)) * pop, (x * Math.sin(spin) + y * Math.cos(spin)) * pop));
    });
    fx.every(0.05, dur, () => { const c = centre(), a = rnd(0, Math.PI * 2), P = flat(fx, c, Math.cos(a) * 0.45, Math.sin(a) * 0.45); fx.emit({ x: P[0], y: P[1], z: P[2], vy: 0.4, life: 0.5, size: 0.025, color: GOLD, flick: 18, gravity: 0 }); });
    fx.at(dur, () => { const c = centre(); for (const [x, y] of pts) { const P = flat(fx, c, x, y); fx.emit({ x: P[0], y: P[1], z: P[2], vx: x * 6 + rnd(-0.4, 0.4), vy: y * 6 + rnd(0, 1.5), vz: rnd(-0.5, 0.5), life: rnd(0.6, 1), size: 0.03, color: Math.random() < 0.5 ? GOLD : [0.3, 2.9, 0.6], flick: 14, gravity: -4, drag: 0.8 }); } });
  },

  // a cut diamond turns over his head, glinting at its corners, then shatters into sparks
  gfx_diamond(fx) {
    const ring = (r, y, n) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, y, Math.sin(i / n * Math.PI * 2) * r]);
    const table = ring(0.13, 0.11, 8), girdle = ring(0.24, 0, 8), apex = [0, -0.3, 0], edges = [];
    for (let i = 0; i < 8; i++) { edges.push([table[i], table[(i + 1) % 8], 4], [girdle[i], girdle[(i + 1) % 8], 6], [table[i], girdle[i], 4], [table[i], girdle[(i + 1) % 8], 4], [girdle[i], apex, 9]); }
    const pts = [];
    for (const [a, b, n] of edges) for (let j = 0; j < n; j++) { const t = j / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
    const dur = 1.2, centre = () => add(fx.head(), 0, 0.68);
    const place = (q, k) => { const c = centre(), turn = k * 4, pop = Math.min(1, k * 6), cs = Math.cos(turn), sn = Math.sin(turn); return [c[0] + (q[0] * cs - q[2] * sn) * pop, c[1] + q[1] * pop, c[2] + (q[0] * sn + q[2] * cs) * pop]; };
    fx.hold(pts.length, dur, i => ({ size: 0.022, color: pts[i][1] > 0.1 ? WHITE : pts[i][1] < -0.1 ? [0.3, 2.2, 1.6] : ICE }), (i, k, p) => setP(p, place(pts[i], k)));
    fx.every(0.06, dur, k => { const q = pick([...table, ...girdle, apex]), P = place(q, k); fx.emit({ x: P[0], y: P[1], z: P[2], life: 0.18, size: 0.1, grow: -0.9, color: WHITE, gravity: 0, drag: 0 }); });
    fx.at(dur, () => { for (const q of pts) { const P = place(q, 1); fx.emit({ x: P[0], y: P[1], z: P[2], vx: q[0] * 9 + rnd(-0.3, 0.3), vy: q[1] * 9 + rnd(0, 1.2), vz: q[2] * 9 + rnd(-0.3, 0.3), life: rnd(0.5, 0.9), size: 0.025, color: pick([WHITE, ICE, GW]), flick: 18, gravity: -5, drag: 0.6 }); } });
  },

  // a supernova: light rushes in to a point over his head, it flashes, and a shell of fire blows out with a ring
  // round its middle, leaving a glowing cloud
  gfx_supernova(fx) {
    const c0 = () => add(fx.head(), 0, 0.7), IN = 0.45;
    fx.every(1 / 60, IN, k => { const c = c0(); for (let i = 0; i < 6; i++) { const d = sphereDir(), r = 1.6 * (1 - k) + 0.3; fx.emit({ x: c[0] + d[0] * r, y: c[1] + d[1] * r, z: c[2] + d[2] * r, vx: -d[0] * r * 3, vy: -d[1] * r * 3, vz: -d[2] * r * 3, life: 0.25, size: 0.03, color: GW, gravity: 0, drag: 0 }); } });
    fx.at(IN, () => {
      const c = c0();
      fx.burst(c, 24, { color: WHITE, speed: 0.6, life: 0.3, size: 0.15, gravity: 0 });
      for (let i = 0; i < 160 * fx.power; i++) { const d = sphereDir(), s = rnd(3.2, 3.8); fx.emit({ x: c[0], y: c[1], z: c[2], vx: d[0] * s, vy: d[1] * s, vz: d[2] * s, life: rnd(0.7, 0.9), size: 0.04, color: i % 3 ? GW : EMBER, gravity: 0, drag: 2 }); }
      for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; fx.emit({ x: c[0], y: c[1], z: c[2], vx: Math.cos(a) * 6, vy: Math.sin(a) * 0.6, vz: Math.sin(a) * 6, life: 0.7, size: 0.05, color: WHITE, gravity: 0, drag: 2.2 }); }
      for (let i = 0; i < 40; i++) { const d = sphereDir(), r = rnd(0.2, 0.7); fx.emit({ x: c[0] + d[0] * r, y: c[1] + d[1] * r, z: c[2] + d[2] * r, vx: d[0] * 0.3, vy: d[1] * 0.3, vz: d[2] * 0.3, life: 1.2, size: 0.14, grow: 1.4, color: [0.1, 0.8, 0.45], gravity: 0, drag: 0.5 }); }
    });
  },
};

// Runs the effects for one renderer, on the same clock as the particles (the renderer's frame time, Particles.draw
// calls tick(dt)), so an effect plays out the same at any frame rate and pauses with the game's frames.
export class GreenFxRunner {
  constructor(particles, camera = null) {
    this.ps = particles; this.camera = camera;
    this.jobs = []; this.now = 0;
  }
  tick(dt = 0) {
    this.now += Math.min(0.25, Math.max(0, dt));
    // (a job may add jobs while running)
    for (let i = 0; i < this.jobs.length; i++) {
      const j = this.jobs[i];
      if (j.at > this.now) continue;
      if (j.frame) {
        const k = j.dur > 0 ? Math.min(1, (this.now - j.t0) / j.dur) : 1;
        try { j.frame(k); } catch { /* ignore */ }
        if (k >= 1) j.done = true;
      } else if (j.step) {
        while (j.at <= this.now && j.n * j.step <= j.dur + 1e-6) { try { j.fn(j.dur > 0 ? Math.min(1, j.n * j.step / j.dur) : 1, j.n); } catch { /* an effect never breaks the game */ } j.n++; j.at = j.t0 + j.n * j.step; }
        if (j.n * j.step > j.dur + 1e-6) j.done = true;
      } else { try { j.fn(); } catch { /* ignore */ } j.done = true; }
    }
    this.jobs = this.jobs.filter(j => !j.done);
  }
  // id: the effect; anchor(): the player's head [x, y, z]; feet(): the floor under him; power: show size
  // opts.flight: seconds until the ball reaches the rim (qp3: the banana peels on the make)
  play(id, anchor, feet, power = 1, opts = {}) {
    const run = EFFECTS[id] || EFFECTS.gfx_basic;
    const self = this, ps = this.ps;
    const fx = {
      power, flight: opts.flight || 0,
      head: () => anchor(),
      feet: () => (feet ? feet() : (p => [p[0], 0, p[2]])(anchor())),
      at(s, fn) { self.jobs.push({ at: self.now + s, fn }); },
      every(step, dur, fn) { const t0 = self.now; self.jobs.push({ at: t0, t0, step, dur, fn, n: 0 }); },
      emit(o) { return ps.emit(o); },
      hold(n, dur, make, place) {
        const list = [];
        for (let i = 0; i < n; i++) { const o = { ...make(i), life: dur + 0.02, hold: true, gravity: 0, drag: 0, vx: 0, vy: 0, vz: 0 }; list.push(ps.emit(o) || o); }
        const t0 = self.now;
        const job = { at: t0, t0, dur, frame: k => { for (let i = 0; i < n; i++) place(i, k, list[i]); } };
        self.jobs.push(job);
        job.frame(0);
        return list;
      },
      burst(p, n, o) { ps.burst(p[0], p[1], p[2], Math.round(n), o); },
      basis() {
        const v = self.camera?.view;
        if (!v) return [[1, 0, 0], [0, 1, 0]];
        return [[v[0], v[4], v[8]], [v[1], v[5], v[9]]];
      },
    };
    try { run(fx); } catch (e) { console.warn('green fx', id, e); }
    this.tick(0);
  }
}
const runners = new WeakMap();
export function greenFxFor(renderer, camera) {
  let r = runners.get(renderer);
  if (!r) { r = new GreenFxRunner(renderer.particles, camera); runners.set(renderer, r); if (renderer.particles) renderer.particles.preDraw = dt => r.tick(dt); }
  if (camera) r.camera = camera;
  return r;
}
