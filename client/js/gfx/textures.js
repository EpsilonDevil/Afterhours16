// Procedural canvas textures. Every texture here is original, generated at load time.
import { RNG, makeNoise2D } from '../core/rng.js';
import { COURT } from '../sim/constants.js';

export function canvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return c;
}
const ctx2d = c => c.getContext('2d', { willReadFrequently: false });

function heightToNormal(height, w, h, strength = 2, wrap = true) {
  const out = new Uint8Array(w * h * 4);
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); }
    return height[y * w + x];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    out[i] = (-dx / l * 0.5 + 0.5) * 255; out[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out[i + 2] = (1 / l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

// Maple hardwood: planks along U. Returns {color, normal} where color is a canvas.
export function hardwood(opts = {}) {
  const S = opts.size || 1024, rng = new RNG(opts.seed || 11), noise = makeNoise2D(opts.seed || 11);
  const c = canvas(S, S), g = ctx2d(c);
  const img = g.createImageData(S, S), d = img.data;
  const H = new Float32Array(S * S);
  const planks = opts.planks || 36; // across V
  const pw = S / planks;
  const tone = opts.tone || [0.80, 0.60, 0.38];
  const plankInfo = [];
  for (let p = 0; p < planks; p++) {
    const segs = []; let u = -rng.next() * S * 0.6;
    while (u < S) { const len = S * (0.35 + rng.next() * 0.5); segs.push({ start: u, end: u + len, shade: 0.86 + rng.next() * 0.24, hue: rng.next() * 0.06 - 0.03, seed: rng.next() * 100 }); u += len; }
    plankInfo.push(segs);
  }
  for (let y = 0; y < S; y++) {
    const p = Math.floor(y / pw), inP = (y % pw) / pw;
    const segs = plankInfo[p];
    for (let x = 0; x < S; x++) {
      let seg = segs[0];
      for (const s of segs) if (x >= s.start && x < s.end) { seg = s; break; }
      const grain = noise.tile(x * 0.006, y * 0.09 + seg.seed, S * 0.006, 3);
      const fine = noise(x * 0.08 + seg.seed * 3, y * 0.9) * 0.5;
      const ring = Math.sin((y * 0.35 + grain * 18 + seg.seed) * 1.2) * 0.5 + 0.5;
      let v = seg.shade * (0.9 + grain * 0.22 + fine * 0.05 + ring * 0.04);
      const edge = Math.min(inP, 1 - inP) * pw;
      const joint = Math.min(Math.abs(x - seg.start), Math.abs(seg.end - x));
      let h = 1;
      if (edge < 0.9) { v *= 0.72; h = 0.6; }
      if (joint < 1.0) { v *= 0.78; h = 0.65; }
      const i = (y * S + x) * 4;
      d[i] = Math.min(255, (tone[0] + seg.hue) * v * 255);
      d[i + 1] = Math.min(255, tone[1] * v * 255);
      d[i + 2] = Math.min(255, (tone[2] - seg.hue) * v * 255);
      d[i + 3] = 255;
      H[y * S + x] = h + grain * 0.04;
    }
  }
  g.putImageData(img, 0, 0);
  return { color: c, normal: heightToNormal(H, S, S, 3) };
}

// v0.4.5: tiling water normal map (crossed swells + ripples) for the Harbor Point sea
export function waterNormal(opts = {}) {
  const S = opts.size || 512, noise = makeNoise2D(opts.seed || 41);
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * Math.PI * 2, v = y / S * Math.PI * 2;
    let h = Math.sin(u * 2 + Math.cos(v) * 0.6) * 0.6 + Math.sin(v * 3 - u * 0.5) * 0.35;
    h += noise.tile(x * 0.03, y * 0.03, S * 0.03, 4) * 0.5;
    h += noise.tile(x * 0.12, y * 0.12, S * 0.12, 2) * 0.18;
    H[y * S + x] = h;
  }
  return heightToNormal(H, S, S, opts.strength ?? 2.2);
}

export function asphalt(opts = {}) {
  const S = opts.size || 1024, rng = new RNG(opts.seed || 5), noise = makeNoise2D(opts.seed || 5);
  const c = canvas(S, S), g = ctx2d(c);
  const img = g.createImageData(S, S), d = img.data, H = new Float32Array(S * S);
  const base = opts.base || [0.24, 0.24, 0.25];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise.tile(x * 0.02, y * 0.02, S * 0.02, 5);
    const big = noise.tile(x * 0.003, y * 0.003, S * 0.003, 3);
    const speck = rng.next();
    let v = 0.85 + n * 0.35 + big * 0.25;
    let h = n * 0.5;
    if (speck > 0.985) { v *= 1.45; h += 0.6; } else if (speck < 0.02) { v *= 0.55; h -= 0.4; }
    const i = (y * S + x) * 4;
    d[i] = base[0] * v * 255; d[i + 1] = base[1] * v * 255; d[i + 2] = base[2] * v * 255; d[i + 3] = 255;
    H[y * S + x] = h;
  }
  // cracks
  for (let k = 0; k < (opts.cracks ?? 6); k++) {
    let x = rng.next() * S, y = rng.next() * S, a = rng.next() * Math.PI * 2;
    const len = 80 + rng.next() * 300;
    for (let s = 0; s < len; s++) {
      a += (rng.next() - 0.5) * 0.5; x += Math.cos(a); y += Math.sin(a);
      const xi = ((Math.floor(x) % S) + S) % S, yi = ((Math.floor(y) % S) + S) % S, i = (yi * S + xi) * 4;
      d[i] *= 0.45; d[i + 1] *= 0.45; d[i + 2] *= 0.45; H[yi * S + xi] -= 1.2;
    }
  }
  g.putImageData(img, 0, 0);
  return { color: c, normal: heightToNormal(H, S, S, 1.5) };
}

// Court markings + paint. Full-court overlay covering [-W/2-margin, W/2+margin] x [-L/2-margin, L/2+margin].
// spec: {surface:'wood'|'asphalt', court, paint, lines, apron, logo:{text, color, accent}, centerText, baseline, wear, halfOnly}
export function courtOverlay(spec) {
  const margin = spec.margin ?? 2.0;
  const W = COURT.width + margin * 2, L = COURT.length + margin * 2;
  const PX = spec.ppm || 110; // pixels per meter
  const cw = Math.round(W * PX), ch = Math.round(L * PX);
  const c = canvas(cw, ch), g = ctx2d(c);
  const noise = makeNoise2D(spec.seed || 3), rng = new RNG(spec.seed || 3);
  // coordinate transform: world x → canvas x, world z → canvas y
  g.setTransform(PX, 0, 0, PX, cw / 2, ch / 2);
  const wood = spec.surface === 'wood';
  const lineW = 0.051;
  g.clearRect(-W, -L, W * 2, L * 2);
  if (!wood) {
    g.fillStyle = spec.apron; g.fillRect(-W / 2, -L / 2, W, L);
    g.fillStyle = spec.court; g.fillRect(-COURT.width / 2, -COURT.length / 2, COURT.width, COURT.length);
  } else if (spec.apron) {
    // stained border on wood courts
    g.fillStyle = spec.apron;
    g.fillRect(-W / 2, -L / 2, W, margin); g.fillRect(-W / 2, L / 2 - margin, W, margin);
    g.fillRect(-W / 2, -L / 2, margin, L); g.fillRect(W / 2 - margin, -L / 2, margin, L);
  }
  const hoopZ = COURT.hoopZ;
  const ends = spec.halfOnly ? [1] : [-1, 1];
  for (const s of ends) {
    const bz = s * COURT.length / 2; // baseline
    const rz = s * hoopZ; // rim center
    // three-point area tint
    if (spec.arcTint) {
      g.fillStyle = spec.arcTint;
      g.beginPath();
      threePointPath(g, s);
      g.lineTo(-COURT.width / 2 + 0.0, bz); g.closePath();
      g.fill();
    }
    // key / paint
    g.fillStyle = spec.paint;
    const kw = COURT.keyWidth, kl = COURT.ftDist;
    g.fillRect(-kw / 2, s > 0 ? bz - kl : bz, kw, kl);
    // FT circle paint top half (outside the key)
    if (spec.paintCircle) { g.beginPath(); g.arc(0, bz - s * kl, COURT.ftRadius, s > 0 ? Math.PI : 0, s > 0 ? Math.PI * 2 : Math.PI); g.fill(); }
    // logo in the paint baseline
    if (spec.keyText) {
      g.save(); g.translate(0, bz - s * 1.0); g.rotate(s > 0 ? 0 : Math.PI);
      g.fillStyle = spec.lines; g.globalAlpha = 0.85;
      g.font = '900 0.55px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(spec.keyText, 0, 0); g.restore(); g.globalAlpha = 1;
    }
    g.strokeStyle = spec.lines; g.lineWidth = lineW;
    // key outline
    g.strokeRect(-kw / 2, s > 0 ? bz - kl : bz, kw, kl);
    // FT circle
    g.beginPath(); g.arc(0, bz - s * kl, COURT.ftRadius, 0, Math.PI * 2);
    g.stroke();
    // lane hash marks
    for (const off of [2.13, 3.05, 3.96, 4.88]) for (const sx of [-1, 1]) {
      g.beginPath(); g.moveTo(sx * kw / 2, bz - s * off); g.lineTo(sx * (kw / 2 + 0.2), bz - s * off); g.stroke();
    }
    // restricted arc
    g.beginPath(); g.arc(0, rz, COURT.restricted, s > 0 ? Math.PI : 0, s > 0 ? Math.PI * 2 : Math.PI); g.stroke();
    // three-point line
    g.beginPath(); threePointPath(g, s); g.stroke();
    // baseline backboard shadow mark
    g.beginPath(); g.moveTo(-0.9, bz - s * 1.22); g.lineTo(0.9, bz - s * 1.22); g.globalAlpha = 0.12; g.stroke(); g.globalAlpha = 1;
  }
  g.strokeStyle = spec.lines; g.lineWidth = lineW;
  // boundary: v0.4.5 the court measures to the inside edge of the lines (the lines are out of bounds), as in a
  // regulation game, so the stroke sits just outside the playing area
  g.strokeRect(-COURT.width / 2 - lineW / 2, -COURT.length / 2 - lineW / 2, COURT.width + lineW, COURT.length + lineW);
  // half courts: the half-court line is the back boundary, painted just outside the half in play
  if (spec.halfOnly) { g.beginPath(); g.moveTo(-COURT.width / 2 - lineW, -lineW / 2); g.lineTo(COURT.width / 2 + lineW, -lineW / 2); g.stroke(); }
  if (!spec.halfOnly) {
    g.beginPath(); g.moveTo(-COURT.width / 2, 0); g.lineTo(COURT.width / 2, 0); g.stroke();
    if (spec.centerFill) { g.fillStyle = spec.centerFill; g.beginPath(); g.arc(0, 0, COURT.centerRadius, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.arc(0, 0, COURT.centerRadius, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, 0.61, 0, Math.PI * 2); g.stroke();
  }
  // center logo (v0.4.5: logos marked inHalf sit inside a half court's play area instead of on its back line,
  // turned to face the hoop end)
  if (spec.logo) {
    const inHalf = spec.halfOnly && spec.logo.inHalf;
    drawLogo(g, inHalf ? { ...spec.logo, rotate: Math.PI } : spec.logo, 0, inHalf ? 2.7 : 0, spec.logo.size || 1.6);
  }
  if (spec.sideText) {
    g.save(); g.fillStyle = spec.sideTextColor || spec.lines; g.globalAlpha = 0.9;
    g.font = '900 0.7px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.translate(COURT.width / 2 + margin * 0.5, 0); g.rotate(Math.PI / 2); g.fillText(spec.sideText, 0, 0);
    g.restore();
    g.save(); g.fillStyle = spec.sideTextColor || spec.lines; g.globalAlpha = 0.9;
    g.font = '900 0.7px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.translate(-COURT.width / 2 - margin * 0.5, 0); g.rotate(-Math.PI / 2); g.fillText(spec.sideText, 0, 0);
    g.restore();
  }
  // baseline text
  if (spec.baselineText) for (const s of ends) {
    g.save(); g.fillStyle = spec.baselineColor || spec.lines; g.globalAlpha = 0.85;
    g.font = '900 0.5px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.translate(0, s * (COURT.length / 2 + margin * 0.5)); g.rotate(s > 0 ? 0 : Math.PI);
    g.fillText(spec.baselineText, 0, 0); g.restore();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  // wear: erode paint alpha with noise, more in high-traffic areas
  if (spec.wear) {
    const img = g.getImageData(0, 0, cw, ch), d = img.data;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      if (!d[i + 3]) continue;
      const wx = x / PX - W / 2, wz = y / PX - L / 2;
      const traffic = Math.exp(-((wx * wx) / 18 + ((Math.abs(wz) - hoopZ + 3) ** 2) / 20));
      const n = noise.fbm(x * 0.02, y * 0.02, 4) + noise(x * 0.25, y * 0.25) * 0.15;
      const erosion = spec.wear * (0.25 + traffic * 0.9) + n * 0.6;
      if (erosion > 0.6) {
        // faded paint: lighter, greyer, thinner
        const k = Math.min(1, (erosion - 0.6) * 2.2);
        d[i + 3] = d[i + 3] * (1 - k * (wood ? 0.25 : 0.35));
        const grey = (d[i] + d[i + 1] + d[i + 2]) / 3;
        d[i] = d[i] + (grey * 1.12 - d[i]) * k * 0.45; d[i + 1] = d[i + 1] + (grey * 1.12 - d[i + 1]) * k * 0.45; d[i + 2] = d[i + 2] + (grey * 1.12 - d[i + 2]) * k * 0.45;
      }
      // micro scuffs
      if (rng.next() < 0.004 * spec.wear) { d[i] *= 0.7; d[i + 1] *= 0.7; d[i + 2] *= 0.7; }
    }
    g.putImageData(img, 0, 0);
  }
  return { canvas: c, rect: [-W / 2, -L / 2, 1 / W, 1 / L], width: W, length: L };
}

function threePointPath(g, s) {
  const bz = s * COURT.length / 2, rz = s * COURT.hoopZ;
  const cx = COURT.cornerThree, R = COURT.threeRadius;
  const dz = Math.sqrt(R * R - cx * cx); // z offset from rim where arc meets corner line
  const zMeet = rz - s * dz;
  g.moveTo(-cx, bz); g.lineTo(-cx, zMeet);
  const a0 = Math.atan2(zMeet - rz, -cx), a1 = Math.atan2(zMeet - rz, cx);
  g.arc(0, rz, R, a0, a1, s > 0 ? false : true);
  g.lineTo(cx, bz);
}

// v0.4.5 King Tut Cup court logo: a recumbent sphinx in profile (lion body, paws out front, striped headdress,
// beard) on a plinth, inside a medallion. Drawn in unit space (radius 1). neon: outlines only, for the glowing
// overlay copy of the markings.
function sphinxPath(g) {
  g.beginPath();
  g.moveTo(-0.66, 0.3);
  g.bezierCurveTo(-0.7, 0.1, -0.62, -0.02, -0.48, -0.02); // haunch
  g.lineTo(0.02, -0.02); // back
  g.lineTo(0.1, -0.1); // shoulder into the headdress
  g.lineTo(0.12, -0.5);
  g.bezierCurveTo(0.14, -0.6, 0.22, -0.64, 0.3, -0.63); // top of the headdress
  g.lineTo(0.39, -0.59);
  g.lineTo(0.42, -0.65); g.lineTo(0.45, -0.58); // the cobra on the brow
  g.lineTo(0.44, -0.46); // forehead
  g.lineTo(0.48, -0.38); // nose
  g.lineTo(0.44, -0.35); g.lineTo(0.45, -0.31); g.lineTo(0.43, -0.28); // lips and chin
  g.lineTo(0.46, -0.18); g.lineTo(0.41, -0.16); g.lineTo(0.4, -0.25); // the beard
  g.lineTo(0.41, -0.02); // headdress falling onto the chest
  g.lineTo(0.43, 0.14); // chest
  g.lineTo(0.74, 0.15); // forelegs out front
  g.bezierCurveTo(0.8, 0.16, 0.81, 0.29, 0.75, 0.3); // paws
  g.closePath();
}
function drawSphinx(g, logo, size) {
  const neon = logo.color === '#000000', ink = logo.accent || '#e8c15a', dark = neon ? ink : logo.color;
  g.save(); g.scale(size, size);
  g.lineJoin = 'round'; g.lineCap = 'round';
  // medallion: filled disc, a ring and an inner ring
  g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2);
  // (the glowing copy blacks the disc out first, so the neon court lines don't run across the sphinx)
  if (!neon) { g.fillStyle = logo.color; g.globalAlpha = logo.alpha ?? 0.92; g.fill(); g.globalAlpha = 1; } else { g.fillStyle = '#000000'; g.fill(); }
  g.strokeStyle = ink; g.lineWidth = 0.06; g.stroke();
  g.beginPath(); g.arc(0, 0, 0.88, 0, Math.PI * 2); g.lineWidth = 0.025; g.stroke();
  // plinth
  g.beginPath(); g.rect(-0.72, 0.3, 1.46, 0.11);
  if (neon) { g.lineWidth = 0.03; g.stroke(); } else { g.fillStyle = ink; g.fill(); }
  // the sphinx
  g.save(); g.translate(-0.04, 0.0);
  sphinxPath(g);
  if (neon) { g.lineWidth = 0.035; g.stroke(); } else { g.fillStyle = ink; g.fill(); }
  // details: headdress stripes, eye, the line of the forelegs, the haunch and the tail
  g.strokeStyle = dark; g.lineWidth = neon ? 0.02 : 0.028;
  for (let i = 0; i < 6; i++) { const y = -0.5 + i * 0.075; g.beginPath(); g.moveTo(0.13 + (i < 1 ? 0.03 : 0), y); g.lineTo(i < 3 ? 0.34 : 0.39, y + 0.01); g.stroke(); }
  g.beginPath(); g.ellipse(0.4, -0.45, 0.03, 0.012, 0, 0, Math.PI * 2); if (neon) g.stroke(); else { g.fillStyle = dark; g.fill(); }
  g.beginPath(); g.moveTo(0.44, 0.22); g.lineTo(0.74, 0.22); g.stroke();
  g.beginPath(); g.moveTo(-0.44, 0.3); g.quadraticCurveTo(-0.46, 0.08, -0.3, 0.06); g.stroke();
  g.beginPath(); g.moveTo(-0.62, 0.27); g.quadraticCurveTo(-0.5, 0.2, -0.44, 0.27); g.stroke();
  g.restore();
  g.restore();
}

// v0.4.7.5 qp3 The Jungle Ballers court logo: a toco toucan in profile on a branch inside a medallion. The body is
// logo.color (black), the beak logo.accent (orange) with a yellow blaze and a black tip, a cream bib, a sky-blue eye
// ring, a red undertail and two leaves on the branch. Unit space (radius 1).
export function drawToucan(g, logo, size) {
  const body = logo.color || '#141414', beak = logo.accent || '#ff8a1f';
  g.save(); g.scale(size, size);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fillStyle = '#1d4a2e'; g.globalAlpha = logo.alpha ?? 0.92; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = beak; g.lineWidth = 0.06; g.stroke();
  g.beginPath(); g.arc(0, 0, 0.88, 0, Math.PI * 2); g.strokeStyle = '#f6efd8'; g.lineWidth = 0.02; g.stroke();
  // the branch, with two leaves
  g.strokeStyle = '#6b4a2a'; g.lineWidth = 0.09; g.beginPath(); g.moveTo(-0.78, 0.55); g.quadraticCurveTo(-0.1, 0.42, 0.72, 0.6); g.stroke();
  g.fillStyle = '#3f8a3a';
  for (const [lx, ly, a] of [[-0.55, 0.5, -0.5], [0.5, 0.55, 2.4]]) { g.save(); g.translate(lx, ly); g.rotate(a); g.beginPath(); g.ellipse(0.14, 0, 0.16, 0.07, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  // tail, body, wing
  g.fillStyle = body;
  g.beginPath(); g.moveTo(-0.3, 0.1); g.lineTo(-0.72, 0.3); g.lineTo(-0.66, 0.42); g.lineTo(-0.28, 0.3); g.closePath(); g.fill();
  g.fillStyle = '#d8302a'; g.beginPath(); g.moveTo(-0.42, 0.3); g.lineTo(-0.66, 0.42); g.lineTo(-0.5, 0.44); g.closePath(); g.fill(); // red undertail
  g.fillStyle = body; g.beginPath(); g.ellipse(-0.12, 0.08, 0.36, 0.3, -0.35, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(0.06, -0.3, 0.22, 0.2, 0, 0, Math.PI * 2); g.fill(); // head
  g.fillStyle = '#0a0a0a'; g.beginPath(); g.ellipse(-0.22, 0.12, 0.26, 0.14, -0.5, 0, Math.PI * 2); g.fill(); // wing
  // the bib: cream from the throat down the chest
  g.fillStyle = '#fff3d0'; g.beginPath(); g.moveTo(0.2, -0.3); g.quadraticCurveTo(0.3, 0.05, 0.08, 0.3); g.quadraticCurveTo(-0.02, 0.0, 0.1, -0.28); g.closePath(); g.fill();
  // the beak: a long banana curve, yellow on top, orange below, black tip
  g.fillStyle = beak; g.beginPath(); g.moveTo(0.22, -0.42); g.quadraticCurveTo(0.6, -0.5, 0.86, -0.25); g.quadraticCurveTo(0.9, -0.14, 0.8, -0.1); g.quadraticCurveTo(0.6, -0.1, 0.24, -0.22); g.closePath(); g.fill();
  g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(0.24, -0.42); g.quadraticCurveTo(0.6, -0.5, 0.84, -0.27); g.quadraticCurveTo(0.6, -0.34, 0.26, -0.33); g.closePath(); g.fill();
  g.fillStyle = '#0a0a0a'; g.beginPath(); g.moveTo(0.8, -0.3); g.quadraticCurveTo(0.9, -0.2, 0.8, -0.1); g.quadraticCurveTo(0.75, -0.15, 0.74, -0.27); g.closePath(); g.fill();
  g.strokeStyle = '#0a0a0a'; g.lineWidth = 0.015; g.beginPath(); g.moveTo(0.26, -0.33); g.quadraticCurveTo(0.55, -0.32, 0.78, -0.26); g.stroke();
  // eye: a sky-blue ring and a black eye
  g.fillStyle = '#2ec4ff'; g.beginPath(); g.arc(0.1, -0.33, 0.06, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0a0a0a'; g.beginPath(); g.arc(0.11, -0.33, 0.03, 0, Math.PI * 2); g.fill();
  // feet on the branch
  g.strokeStyle = '#2ec4ff'; g.lineWidth = 0.035; for (const fx of [-0.16, -0.04]) { g.beginPath(); g.moveTo(fx, 0.34); g.lineTo(fx - 0.03, 0.47); g.moveTo(fx, 0.34); g.lineTo(fx + 0.05, 0.47); g.stroke(); }
  g.restore();
}

export function drawLogo(g, logo, x, y, size) {
  g.save(); g.translate(x, y);
  const shape = logo.shape || 'circle';
  if (shape === 'sphinx') { if (logo.rotate) g.rotate(logo.rotate); drawSphinx(g, logo, size); g.restore(); return; }
  if (shape === 'toucan') { if (logo.rotate) g.rotate(logo.rotate); drawToucan(g, logo, size); g.restore(); return; }
  g.fillStyle = logo.color; g.strokeStyle = logo.accent || '#fff'; g.lineWidth = size * 0.06;
  g.beginPath();
  if (shape === 'circle') g.arc(0, 0, size, 0, Math.PI * 2);
  else if (shape === 'shield') { g.moveTo(-size * 0.85, -size * 0.9); g.lineTo(size * 0.85, -size * 0.9); g.lineTo(size * 0.85, size * 0.1); g.quadraticCurveTo(size * 0.6, size * 0.75, 0, size); g.quadraticCurveTo(-size * 0.6, size * 0.75, -size * 0.85, size * 0.1); g.closePath(); }
  else if (shape === 'diamond') { g.moveTo(0, -size); g.lineTo(size, 0); g.lineTo(0, size); g.lineTo(-size, 0); g.closePath(); }
  else if (shape === 'hex') { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; g.lineTo(Math.cos(a) * size, Math.sin(a) * size); } g.closePath(); }
  else if (shape === 'star') { for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? size * 0.5 : size; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); }
  else if (shape === 'crown') { g.moveTo(-size, size * 0.6); g.lineTo(-size, -size * 0.4); g.lineTo(-size * 0.5, size * 0.05); g.lineTo(0, -size * 0.8); g.lineTo(size * 0.5, size * 0.05); g.lineTo(size, -size * 0.4); g.lineTo(size, size * 0.6); g.closePath(); }
  else if (shape === 'bolt') { g.moveTo(size * 0.2, -size); g.lineTo(-size * 0.6, size * 0.15); g.lineTo(-size * 0.05, size * 0.15); g.lineTo(-size * 0.25, size); g.lineTo(size * 0.6, -size * 0.2); g.lineTo(size * 0.05, -size * 0.2); g.closePath(); }
  else { g.rect(-size, -size * 0.7, size * 2, size * 1.4); }
  g.globalAlpha = logo.alpha ?? 0.9; g.fill(); g.globalAlpha = 1; g.stroke();
  if (logo.text) {
    g.fillStyle = logo.accent || '#fff';
    const fs = size * (logo.text.length > 4 ? 0.42 : 0.62);
    g.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(logo.text, 0, size * 0.04);
  }
  g.restore();
}

export function chainlink(size = 256) {
  const c = canvas(size, size), g = ctx2d(c);
  g.clearRect(0, 0, size, size);
  g.strokeStyle = 'rgba(205,210,215,1)'; g.lineWidth = size / 40; g.lineCap = 'round';
  const n = 4, s = size / n;
  for (let i = -1; i <= n; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s + size, size); g.stroke();
    g.beginPath(); g.moveTo(i * s + size, 0); g.lineTo(i * s, size); g.stroke();
  }
  return c;
}

export function netTexture(w = 256, h = 256) {
  const c = canvas(w, h), g = ctx2d(c);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(250,250,250,1)'; g.lineWidth = w / 70; g.lineCap = 'round';
  const cols = 6, rows = 4;
  for (let r = 0; r <= rows; r++) for (let k = 0; k <= cols; k++) {
    const x = k / cols * w, y = r / rows * h, x2 = (k + 0.5) / cols * w, y2 = (r + 0.5) / rows * h;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.lineTo(x + w / cols, y); g.stroke();
    g.beginPath(); g.moveTo(x2, y2); g.lineTo(x, y + h / rows); g.stroke();
    g.beginPath(); g.moveTo(x2, y2); g.lineTo(x + w / cols, y + h / rows); g.stroke();
  }
  return c;
}

// Basketball: equirect color map with channels and pebble texture
export function ballTexture(opts = {}) {
  const W = 1024, Hh = 512, c = canvas(W, Hh), g = ctx2d(c);
  const img = g.createImageData(W, Hh), d = img.data;
  const noise = makeNoise2D(91);
  const base = opts.color || [0.80, 0.33, 0.10];
  const H = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) {
    const phi = (y + 0.5) / Hh * Math.PI;
    for (let x = 0; x < W; x++) {
      const th = (x + 0.5) / W * Math.PI * 2;
      const nx = -Math.cos(th) * Math.sin(phi), ny = Math.cos(phi), nz = Math.sin(th) * Math.sin(phi);
      // seams: two great circles + two curved "baseball" seams
      const s1 = Math.abs(ny), s2 = Math.abs(nx);
      const curve = Math.abs(nz - 0.62 * Math.sign(nz) * (1 - Math.abs(ny) * 0.25)) * 0.9 + Math.abs(ny) * 0.05;
      const s3 = Math.abs(Math.abs(nz) - (0.7 - 0.45 * ny * ny));
      const seam = Math.min(s1, s2, s3);
      const sw = 0.016;
      const pebble = noise(x * 0.9, y * 0.9) * 0.6 + noise(x * 0.35, y * 0.35) * 0.4;
      let v = 0.92 + pebble * 0.16;
      let r = base[0] * v, gg = base[1] * v, b = base[2] * v;
      let h = pebble * 0.5;
      if (seam < sw) { const k = 1 - seam / sw; r = gg = b = 0.05; h = -0.6 * k; }
      else if (seam < sw * 1.8) { const k = (seam - sw) / (sw * 0.8); r *= 0.6 + 0.4 * k; gg *= 0.6 + 0.4 * k; b *= 0.6 + 0.4 * k; h -= 0.3 * (1 - k); }
      const i = (y * W + x) * 4;
      d[i] = r * 255; d[i + 1] = gg * 255; d[i + 2] = b * 255; d[i + 3] = 255;
      H[y * W + x] = h;
    }
  }
  g.putImageData(img, 0, 0);
  if (opts.text) {
    g.fillStyle = 'rgba(15,10,8,0.85)'; g.font = '900 34px "Arial Black", sans-serif'; g.textAlign = 'center';
    g.fillText(opts.text, W * 0.375, Hh * 0.43);
  }
  return { color: c, normal: heightToNormal(H, W, Hh, 4) };
}

export function radialBlob(size = 128) {
  const c = canvas(size, size), g = ctx2d(c);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(30,30,30,1)'); gr.addColorStop(0.45, 'rgba(110,110,110,1)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}

// v0.4.7.5 qp3: a soft band (bright in the middle, gone at both edges, across v): the take-it-back glow on the arc
export function glowBand(size = 64) {
  const c = canvas(4, size), g = ctx2d(c);
  const gr = g.createLinearGradient(0, 0, 0, size);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, size);
  return c;
}

export function ringTexture(size = 256) {
  const c = canvas(size, size), g = ctx2d(c);
  g.clearRect(0, 0, size, size);
  const r = size / 2;
  const gr = g.createRadialGradient(r, r, r * 0.55, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  return c;
}

// v0.4.7.5 quick patch: the defensive assignment arrow (a floor decal): a bold arrow with a dark rim,
// pointing down the canvas (+v, the plane's +z: the direction it's yawed to)
export function arrowTexture(size = 128) {
  const c = canvas(size, size), g = ctx2d(c), S = size;
  g.clearRect(0, 0, S, S);
  const path = () => { g.beginPath(); g.moveTo(S * 0.5, S * 0.9); g.lineTo(S * 0.88, S * 0.42); g.lineTo(S * 0.66, S * 0.42); g.lineTo(S * 0.66, S * 0.12); g.lineTo(S * 0.34, S * 0.12); g.lineTo(S * 0.34, S * 0.42); g.lineTo(S * 0.12, S * 0.42); g.closePath(); };
  // (drawn over the floor with alpha blending: a dark rim so it reads on light wood and on dark asphalt alike; the
  // material's colour tints the white fill)
  g.lineJoin = 'round'; g.lineWidth = S * 0.09; g.strokeStyle = 'rgba(0,0,0,0.75)'; path(); g.stroke();
  g.fillStyle = 'rgba(255,255,255,1)'; path(); g.fill();
  return c;
}

// v0.4.5 Hot / Cold floor icons under a player (additive decals): a flame and an ice crystal
export function flameTexture(size = 256) {
  const c = canvas(size, size), g = ctx2d(c), r = size / 2;
  g.clearRect(0, 0, size, size);
  const glow = g.createRadialGradient(r, r, r * 0.2, r, r, r);
  glow.addColorStop(0, 'rgba(255,150,40,0.55)'); glow.addColorStop(0.6, 'rgba(255,80,10,0.25)'); glow.addColorStop(1, 'rgba(255,40,0,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  // ring of flame tongues around the feet
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2, len = r * (0.3 + 0.12 * Math.sin(k * 2.7));
    g.save(); g.translate(r, r); g.rotate(a);
    const fg = g.createLinearGradient(0, -r * 0.58, 0, -r * 0.58 - len);
    fg.addColorStop(0, 'rgba(255,240,170,0.95)'); fg.addColorStop(0.45, 'rgba(255,140,30,0.85)'); fg.addColorStop(1, 'rgba(220,40,0,0)');
    g.fillStyle = fg; g.beginPath();
    g.moveTo(-r * 0.11, -r * 0.56);
    g.bezierCurveTo(-r * 0.12, -r * 0.7, -r * 0.03, -r * 0.62 - len * 0.7, 0, -r * 0.6 - len);
    g.bezierCurveTo(r * 0.03, -r * 0.62 - len * 0.7, r * 0.12, -r * 0.7, r * 0.11, -r * 0.56);
    g.closePath(); g.fill(); g.restore();
  }
  // center flame emblem
  g.save(); g.translate(r, r * 1.08);
  const cg = g.createLinearGradient(0, r * 0.3, 0, -r * 0.42);
  cg.addColorStop(0, 'rgba(255,90,10,0.95)'); cg.addColorStop(0.5, 'rgba(255,170,40,0.95)'); cg.addColorStop(1, 'rgba(255,250,200,0.95)');
  g.fillStyle = cg; g.beginPath();
  g.moveTo(0, r * 0.3); g.bezierCurveTo(-r * 0.32, r * 0.24, -r * 0.3, -r * 0.08, -r * 0.08, -r * 0.42);
  g.bezierCurveTo(-r * 0.06, -r * 0.18, r * 0.05, -r * 0.2, r * 0.06, -r * 0.3);
  g.bezierCurveTo(r * 0.34, -r * 0.02, r * 0.3, r * 0.24, 0, r * 0.3); g.fill(); g.restore();
  return c;
}
export function iceTexture(size = 256) {
  const c = canvas(size, size), g = ctx2d(c), r = size / 2;
  g.clearRect(0, 0, size, size);
  const glow = g.createRadialGradient(r, r, r * 0.15, r, r, r);
  glow.addColorStop(0, 'rgba(170,230,255,0.5)'); glow.addColorStop(0.65, 'rgba(90,170,255,0.2)'); glow.addColorStop(1, 'rgba(60,120,255,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(225,248,255,0.95)'; g.lineCap = 'round';
  g.translate(r, r);
  for (let k = 0; k < 6; k++) {
    g.save(); g.rotate(k * Math.PI / 3);
    g.lineWidth = size * 0.035; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r * 0.72); g.stroke();
    g.lineWidth = size * 0.022;
    for (const t of [0.32, 0.52]) { g.beginPath(); g.moveTo(0, -r * t); g.lineTo(-r * 0.14, -r * (t + 0.13)); g.moveTo(0, -r * t); g.lineTo(r * 0.14, -r * (t + 0.13)); g.stroke(); }
    g.restore();
  }
  g.fillStyle = 'rgba(240,252,255,0.95)'; g.beginPath(); g.arc(0, 0, r * 0.1, 0, Math.PI * 2); g.fill();
  return c;
}

export function brick(opts = {}) {
  const S = 512, c = canvas(S, S), g = ctx2d(c), rng = new RNG(opts.seed || 21), noise = makeNoise2D(opts.seed || 21);
  const base = opts.color || [0.48, 0.2, 0.14];
  g.fillStyle = opts.mortar || '#8c8378'; g.fillRect(0, 0, S, S);
  const bh = S / 16, bw = S / 4;
  for (let r = 0; r < 16; r++) for (let k = -1; k < 5; k++) {
    const x = k * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
    const v = 0.75 + rng.next() * 0.4;
    g.fillStyle = `rgb(${base[0] * v * 255 | 0},${base[1] * v * 255 | 0},${base[2] * v * 255 | 0})`;
    g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
  }
  const img = g.getImageData(0, 0, S, S), d = img.data, H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, n = noise.tile(x * 0.05, y * 0.05, S * 0.05, 4);
    const mortar = d[i] > 120 && Math.abs(d[i] - d[i + 2]) < 30;
    d[i] *= 0.9 + n * 0.25; d[i + 1] *= 0.9 + n * 0.25; d[i + 2] *= 0.9 + n * 0.25;
    H[y * S + x] = mortar ? -1 : n * 0.3;
  }
  g.putImageData(img, 0, 0);
  return { color: c, normal: heightToNormal(H, S, S, 2) };
}

export function concrete(opts = {}) {
  const S = 512, c = canvas(S, S), g = ctx2d(c), noise = makeNoise2D(opts.seed || 31);
  const img = g.createImageData(S, S), d = img.data, H = new Float32Array(S * S);
  const base = opts.color || [0.55, 0.55, 0.53];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise.tile(x * 0.015, y * 0.015, S * 0.015, 5), f = noise(x * 0.3, y * 0.3) * 0.1;
    const v = 0.85 + n * 0.3 + f;
    const i = (y * S + x) * 4;
    d[i] = base[0] * v * 255; d[i + 1] = base[1] * v * 255; d[i + 2] = base[2] * v * 255; d[i + 3] = 255;
    H[y * S + x] = n + f;
  }
  // expansion joints
  g.putImageData(img, 0, 0);
  if (opts.joints) { g.strokeStyle = 'rgba(40,40,40,0.6)'; g.lineWidth = 3; g.strokeRect(0, 0, S, S); }
  return { color: c, normal: heightToNormal(H, S, S, 1) };
}

// v0.4.8.5: beach sand for Harbor Point's ground (one tile = opts.meters, 8 m by default). Fine grain with sparse
// shell and mineral specks, soft wind ripples that meander and fade where the sand has been walked over, a slow
// tileable colour drift so the repeat doesn't show, darker damp patches and a couple of trails of footprints.
// Returns {color, normal} (the normal map carries the ripples and the dimples).
export function sand(opts = {}) {
  const S = opts.size || 1024, seed = opts.seed || 61, rng = new RNG(seed), noise = makeNoise2D(seed), n2 = makeNoise2D(seed + 7);
  const c = canvas(S, S), g = ctx2d(c);
  const img = g.createImageData(S, S), d = img.data, H = new Float32Array(S * S);
  const base = opts.color || [0.84, 0.76, 0.62];
  const TAU = Math.PI * 2;
  // damp patches (toroidal blobs so the tile wraps) and footprint trails (pairs of ovals, alternating feet)
  const blobs = [];
  for (let i = 0; i < (opts.damp ?? 2); i++) blobs.push({ x: rng.next() * S, y: rng.next() * S, r: S * (0.04 + rng.next() * 0.05), k: 0.35 + rng.next() * 0.35 });
  // (one tile is opts.meters across: prints are ~27 cm long, ~65 cm apart, whatever the tile size)
  const ppm = S / (opts.meters || 12), prints = [];
  for (let t = 0; t < (opts.trails ?? 1); t++) {
    let x = rng.next() * S, y = rng.next() * S; let a = rng.next() * TAU; const step = ppm * 0.65, side = ppm * 0.12;
    for (let k = 0; k < 9; k++) {
      a += (rng.next() - 0.5) * 0.25;
      const ax = Math.cos(a), ay = Math.sin(a), sd = k % 2 ? 1 : -1;
      prints.push({ x: x - ay * side * sd, y: y + ax * side * sd, a, l: ppm * 0.14, w: ppm * 0.055, k: 0.5 + rng.next() * 0.4 });
      x += ax * step; y += ay * step;
    }
  }
  const wrapD = (a, b) => { let v = a - b; v -= Math.round(v / S) * S; return v; };
  // rasterise the patches and prints into two masks first (cheap: only around each one)
  const damp = new Float32Array(S * S), dimple = new Float32Array(S * S);
  for (const b of blobs) {
    const R = Math.ceil(b.r * 1.4);
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const xi = ((Math.floor(b.x) + ox) % S + S) % S, yi = ((Math.floor(b.y) + oy) % S + S) % S;
      const r = Math.hypot(ox, oy) / b.r, wob = 1 + 0.25 * noise(xi * 0.02, yi * 0.02);
      const v = Math.max(0, 1 - r * wob);
      damp[yi * S + xi] = Math.max(damp[yi * S + xi], v * v * (3 - 2 * v) * b.k);
    }
  }
  for (const p of prints) {
    const R = Math.ceil(p.l * 1.3), ca = Math.cos(p.a), sa = Math.sin(p.a);
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const u = (ox * ca + oy * sa) / p.l, v = (-ox * sa + oy * ca) / p.w;
      // a sole: a heel and a ball, slightly pinched between them
      const q = u * u + v * v * (1 + 0.35 * Math.cos(u * Math.PI * 1.6));
      if (q >= 1) continue;
      const xi = ((Math.floor(p.x) + ox) % S + S) % S, yi = ((Math.floor(p.y) + oy) % S + S) % S;
      dimple[yi * S + xi] = Math.max(dimple[yi * S + xi], Math.sqrt(1 - q) * p.k);
    }
  }
  // wind ripples: two sets at an angle (integer wave counts across the tile so they wrap), each meandering under a
  // warp and showing only in patches; between the patches the sand is soft and lumpy (trodden)
  const ka = opts.ripples?.[0] ?? 70, kb = opts.ripples?.[1] ?? 24, kc = 30, kd = -64;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const low = noise.tile(x * 3 / S, y * 3 / S, 3, 3);              // slow colour drift
    const mid = n2.tile(x * 14 / S, y * 14 / S, 14, 2);              // patchy texture
    const lump = noise.tile(x * 24 / S + 5, y * 24 / S, 24, 2);     // soft lumps a few dm across
    const warp = noise.tile(x * 6 / S, y * 6 / S, 6, 2) * 3.2 + mid * 1.5;
    const ph = TAU * (ka * x + kb * y) / S + warp, ph2 = TAU * (kc * x + kd * y) / S + warp * 1.3;
    const m1 = n2.tile(x * 4 / S, y * 4 / S, 4, 2), m2 = noise.tile(x * 5 / S + 11, y * 5 / S, 5, 2);
    const s1 = Math.max(0, Math.min(1, (m1 - 0.05) * 3)), s2 = Math.max(0, Math.min(1, (m2 - 0.15) * 3));
    // asymmetric ripple (gentle stoss, steeper lee); fades over trodden and damp ground
    const keep = (1 - dimple[i]) * (1 - damp[i] * 0.7);
    const rip = ((Math.sin(ph) + 0.28 * Math.sin(ph * 2 + 0.6)) * s1 + (Math.sin(ph2) + 0.25 * Math.sin(ph2 * 2 + 0.4)) * s2 * 0.7) * keep;
    const grain = rng.next();
    let v = 0.95 + low * 0.14 + mid * 0.05 + lump * 0.03 + rip * 0.012 + (grain - 0.5) * 0.14;
    let tint = low * 0.035;
    let h = rip * 0.45 + lump * 0.9 + (grain - 0.5) * 0.3 - dimple[i] * 1.3 + mid * 0.4;
    if (grain > 0.9965) { v *= 1.3; tint -= 0.05; h += 0.6; }       // shell fragments
    else if (grain < 0.006) { v *= 0.55; h += 0.3; }                  // dark mineral grains
    const wet = damp[i];
    v *= 1 - wet * 0.22 - dimple[i] * 0.07;
    const o = i * 4;
    d[o] = Math.min(255, base[0] * v * (1 + tint) * 255); d[o + 1] = Math.min(255, base[1] * v * 255); d[o + 2] = Math.min(255, base[2] * v * (1 - tint - wet * 0.05) * 255); d[o + 3] = 255;
    H[i] = h * (1 - wet * 0.5);
  }
  g.putImageData(img, 0, 0);
  return { color: c, normal: heightToNormal(H, S, S, opts.strength ?? 1.1) };
}

// v0.4.8.5: a soft, tileable wisp texture for the low rolling fog (white, the shape is in the alpha)
export function fogWisps(opts = {}) {
  const S = opts.size || 256, noise = makeNoise2D(opts.seed || 83);
  const c = canvas(S, S), g = ctx2d(c), img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise.tile(x * 4 / S, y * 4 / S, 4, 4), w = noise.tile(x * 9 / S + 3, y * 9 / S, 9, 2);
    // wisps with clear gaps between them (a smoothstep on the noise), soft edges
    let a = Math.max(0, Math.min(1, (n + w * 0.3 + 0.08) * 2.1));
    a = a * a * (3 - 2 * a);
    const o = (y * S + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// v0.4.8.5: city street asphalt for the Old Brick Yard (one tile = opts.meters, 16 m): aggregate with pale stones,
// a slow tone drift, repair patches with sealed seams round them, sinuous tar-sealed cracks (glossy), fine open
// cracks, oil stains and puddles. Returns {color, normal, rough}: rough is a roughness map (G channel, 128 = the
// material's roughness, lower = wetter) so the floodlights glint off the seams, stains and puddles.
export function street(opts = {}) {
  const S = opts.size || 1024, seed = opts.seed || 97, rng = new RNG(seed), noise = makeNoise2D(seed), n2 = makeNoise2D(seed + 3);
  const c = canvas(S, S), g = ctx2d(c), img = g.createImageData(S, S), d = img.data;
  const H = new Float32Array(S * S), R = new Float32Array(S * S), V = new Float32Array(S * S);
  const base = opts.base || [0.36, 0.36, 0.38];
  const ppm = S / (opts.meters || 16);
  const at = (x, y) => (((Math.floor(y) % S) + S) % S) * S + (((Math.floor(x) % S) + S) % S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const big = noise.tile(x * 3 / S, y * 3 / S, 3, 3), mid = n2.tile(x * 20 / S, y * 20 / S, 20, 3), fine = noise(x * 0.45, y * 0.45);
    const sp = rng.next();
    let v = 0.92 + big * 0.18 + mid * 0.1 + fine * 0.06, h = mid * 0.6 + fine * 0.12;
    if (sp > 0.988) { v *= 1.2 + rng.next() * 0.25; h += 0.22; } else if (sp < 0.03) { v *= 0.65; h -= 0.18; }
    V[i] = v; H[i] = h; R[i] = 0.62 + mid * 0.1 - Math.max(0, big) * 0.15; // (damper in the low hollows)
  }
  // repair patches: a rectangle of newer (darker, smoother) or older (paler) asphalt with a sealed seam round it
  for (let k = 0; k < (opts.patches ?? 4); k++) {
    const pw = ppm * (1.2 + rng.next() * 3.5), ph = ppm * (0.8 + rng.next() * 2.5), px = rng.next() * S, py = rng.next() * S;
    const tone = rng.next() < 0.6 ? 0.8 : 1.12, rr = tone < 1 ? 0.5 : 0.68;
    for (let y = -2; y < ph + 2; y++) for (let x = -2; x < pw + 2; x++) {
      const i = at(px + x, py + y), edge = x < 0 || y < 0 || x >= pw || y >= ph;
      if (edge) { V[i] *= 0.45; H[i] += 0.25; R[i] = 0.3; } else { V[i] = V[i] * tone + 0.02; H[i] *= 0.6; R[i] = rr; }
    }
  }
  // tar-sealed cracks: wandering glossy black bands, a few px wide, sometimes branching
  const walk = (x, y, a, len, wdt, fn, wiggle = 0.12) => {
    for (let s = 0; s < len; s++) {
      a += (rng.next() - 0.5) * wiggle + (rng.next() < 0.01 ? (rng.next() - 0.5) * 1.2 : 0); x += Math.cos(a); y += Math.sin(a);
      for (let oy = -wdt; oy <= wdt; oy++) for (let ox = -wdt; ox <= wdt; ox++) if (ox * ox + oy * oy <= wdt * wdt) fn(at(x + ox, y + oy), Math.hypot(ox, oy) / Math.max(1, wdt));
      if (wdt > 1 && rng.next() < 0.004) walk(x, y, a + (rng.next() < 0.5 ? 1 : -1) * rng.range(0.6, 1.2), len * 0.3, Math.max(1, wdt - 1), fn);
    }
  };
  for (let k = 0; k < (opts.seams ?? 6); k++) walk(rng.next() * S, rng.next() * S, rng.next() * Math.PI * 2, 200 + rng.next() * 500, 2 + (rng.next() < 0.4 ? 1 : 0), (i, q) => { V[i] = Math.min(V[i], 0.58 + q * 0.2); H[i] = 0.3 * (1 - q); R[i] = 0.25; });
  // fine open cracks (dark, rough)
  for (let k = 0; k < (opts.cracks ?? 10); k++) walk(rng.next() * S, rng.next() * S, rng.next() * Math.PI * 2, 60 + rng.next() * 220, 0, i => { V[i] *= 0.5; H[i] -= 1.1; }, 0.4);
  // oil stains and puddles (soft-edged blobs)
  const blob = (n, fn) => {
    for (let k = 0; k < n; k++) {
      const bx = rng.next() * S, by = rng.next() * S, r = ppm * (0.4 + rng.next() * 1.4), sx = 0.6 + rng.next() * 0.8;
      for (let y = -r * 1.3; y < r * 1.3; y++) for (let x = -r * 1.3 * sx; x < r * 1.3 * sx; x++) {
        const q = Math.hypot(x / sx, y) / r + noise((bx + x) * 0.03, (by + y) * 0.03) * 0.35;
        if (q < 1) fn(at(bx + x, by + y), 1 - q);
      }
    }
  };
  blob(opts.oil ?? 5, (i, k) => { const t = Math.min(1, k * 2.5); V[i] *= 1 - t * 0.25; R[i] = Math.min(R[i], 0.62 - t * 0.3); });
  blob(opts.puddles ?? 3, (i, k) => { const t = Math.min(1, k * 3); V[i] *= 1 - t * 0.1; R[i] = Math.min(R[i], 0.6 - t * 0.36); H[i] *= 1 - t; });
  const rough = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const v = V[i], o = i * 4;
    d[o] = Math.min(255, base[0] * v * 255); d[o + 1] = Math.min(255, base[1] * v * 255); d[o + 2] = Math.min(255, base[2] * v * 255); d[o + 3] = 255;
    rough[o] = rough[o + 1] = rough[o + 2] = Math.max(8, Math.min(255, R[i] * 128 / 0.6)); rough[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { color: c, normal: heightToNormal(H, S, S, 0.9), rough: { width: S, height: S, data: rough } };
}

// v0.4.8.5: road-marking decal atlas (1024 x 1024, alpha). Rows: v 0-0.125 worn line paint (white, tiles along u:
// lines map u = metres / 3); below it 128 px cells (see DECAL in world/street.js): manhole covers, a storm drain
// grate, oil stains, STOP / SLOW / PLAY STREET stencils, an arrow.
export function streetDecals() {
  const S = 1024, c = canvas(S, S), g = ctx2d(c), rng = new RNG(131), noise = makeNoise2D(131);
  g.clearRect(0, 0, S, S);
  // worn paint: white with an eroded alpha (tileable across u)
  const img = g.createImageData(S, 128), d = img.data;
  for (let y = 0; y < 128; y++) for (let x = 0; x < S; x++) {
    const n = noise.tile(x * 16 / S, y * 2 / 128, 16, 4), f = noise(x * 0.4, y * 0.4);
    const edge = Math.min(y, 127 - y) / 10;
    let a = Math.min(1, edge) * (0.92 - Math.max(0, n * 0.9 + f * 0.25 - 0.1));
    if (rng.next() < 0.02) a *= 0.3;
    const o = (y * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = 245; d[o + 3] = Math.max(0, Math.min(1, a)) * 255;
  }
  g.putImageData(img, 0, 0);
  const cell = (cx, cy, w = 1, h = 1) => { g.save(); g.translate(cx * 128, 128 + cy * 128); return { w: w * 128, h: h * 128 }; };
  // manhole covers (two patterns): cast iron, a raised grid or radial ribs, a rim
  for (let k = 0; k < 2; k++) {
    const { w } = cell(k, 0), r = w / 2 - 4;
    g.translate(w / 2, w / 2);
    g.fillStyle = '#24282c'; g.beginPath(); g.arc(0, 0, r + 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a3e42'; g.beginPath(); g.arc(0, 0, r - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#4c5156'; g.lineWidth = 2.2;
    if (k === 0) { g.save(); g.beginPath(); g.arc(0, 0, r - 4, 0, Math.PI * 2); g.clip(); for (let i = -r; i < r; i += 7) { g.beginPath(); g.moveTo(i, -r); g.lineTo(i + r * 0.3, r); g.stroke(); g.beginPath(); g.moveTo(-r, i); g.lineTo(r, i - r * 0.3); g.stroke(); } g.restore(); }
    else { for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * 9, Math.sin(a) * 9); g.lineTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5)); g.stroke(); } for (const rr of [9, r * 0.5, r - 5]) { g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.stroke(); } }
    g.strokeStyle = '#1a1d20'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, r - 1, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
  // storm drain: a kerb inlet grate (2 cells wide)
  {
    const { w, h } = cell(2, 0, 2, 1);
    g.fillStyle = '#2a2d30'; g.fillRect(6, 34, w - 12, h - 68);
    g.fillStyle = '#0c0d0e'; for (let x = 14; x < w - 14; x += 9) g.fillRect(x, 40, 5, h - 80);
    g.strokeStyle = '#4a4e52'; g.lineWidth = 3; g.strokeRect(6, 34, w - 12, h - 68);
    g.restore();
  }
  // oil stains (two): soft dark blots with a faint iridescent rim
  for (let k = 0; k < 2; k++) {
    const { w } = cell(4 + k, 0);
    const im = g.getImageData(0, 0, 1, 1); void im;
    for (let i = 0; i < 9; i++) {
      const x = w / 2 + rng.range(-22, 22), y = w / 2 + rng.range(-22, 22), r = rng.range(14, 34);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(8,8,10,0.3)'); gr.addColorStop(0.7, 'rgba(14,12,18,0.16)'); gr.addColorStop(0.92, 'rgba(60,40,80,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.restore();
  }
  // a straight-ahead arrow (cell 6, pointing to -v: the plane's -z before it is turned)
  {
    const { w } = cell(6, 0);
    g.fillStyle = 'rgba(245,245,245,0.92)';
    g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2 + 26, 46); g.lineTo(w / 2 + 9, 46); g.lineTo(w / 2 + 9, w - 6); g.lineTo(w / 2 - 9, w - 6); g.lineTo(w / 2 - 9, 46); g.lineTo(w / 2 - 26, 46); g.closePath(); g.fill();
    g.restore();
  }
  // stencils: STOP, SLOW and PLAY STREET (row 1: 4 cells wide each, text runs across u), worn like the lines
  const stencil = (row, col, cells, text) => {
    const { w, h } = cell(col, row, cells, 1);
    g.fillStyle = 'rgba(245,245,245,0.92)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${h * 0.86}px "Arial Narrow", "Arial Black", Impact, sans-serif`;
    g.save(); g.translate(w / 2, h / 2); g.scale(Math.min(1, (w - 12) / g.measureText(text).width), 1); g.fillText(text, 0, 4); g.restore();
    g.restore();
  };
  stencil(1, 0, 4, 'STOP'); stencil(1, 4, 4, 'SLOW');
  stencil(2, 0, 8, 'PLAY STREET');
  stencil(3, 0, 4, 'ONLY'); stencil(3, 4, 4, 'BUS');
  // wear on the stencils (and arrow): erode the alpha with noise
  const sim = g.getImageData(0, 256, S, 512), sd = sim.data;
  for (let y = 0; y < 512; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4; if (!sd[o + 3] || sd[o] < 200) continue;
    const n = noise.tile(x * 24 / S, y * 12 / 512, 24, 3);
    sd[o + 3] *= Math.max(0.15, 1 - Math.max(0, n * 1.1 - 0.05));
  }
  g.putImageData(sim, 0, 256);
  return c;
}

// v0.4.8.5: neon shop signs (1024 x 512 atlas, 2 x 4 cells of 512 x 128): glowing tubes on a transparent ground
export const NEON_WORDS = [['PIZZA', '#ff5a3c'], ['LIQUOR', '#43e8ff'], ['OPEN 24 HRS', '#ff3d9a'], ['HOTEL', '#ffd23f'], ['BAR & GRILL', '#7dff6a'], ['LAUNDROMAT', '#6a8cff'], ['NOODLES', '#ff8a2a'], ['RECORDS', '#d36bff']];
export function neonSigns() {
  const W = 1024, Hh = 512, c = canvas(W, Hh), g = ctx2d(c);
  g.clearRect(0, 0, W, Hh);
  NEON_WORDS.forEach(([text, color], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
    g.save(); g.translate(x + 256, y + 64);
    g.font = `700 ${text.length > 8 ? 58 : 76}px "Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const sc = Math.min(1, 470 / g.measureText(text).width); g.scale(sc, 1);
    g.lineJoin = 'round';
    // outer glow (wide, faint), the tube (bright), the hot core (white)
    for (const [lw, a] of [[22, 0.12], [12, 0.28]]) { g.globalAlpha = a; g.strokeStyle = color; g.lineWidth = lw; g.strokeText(text, 0, 2); }
    g.globalAlpha = 1; g.strokeStyle = color; g.lineWidth = 5; g.strokeText(text, 0, 2);
    g.strokeStyle = '#ffffff'; g.globalAlpha = 0.8; g.lineWidth = 1.6; g.strokeText(text, 0, 2);
    g.restore();
    // a frame tube round the sign
    g.save(); g.globalAlpha = 0.85; g.strokeStyle = color; g.lineWidth = 3; g.strokeRect(x + 14, y + 12, 484, 104); g.restore();
  });
  return c;
}

// v0.4.8.5: a lit shop window seen from the street (256 x 128): the room's light falling off toward the floor, a
// valance, shelves of goods, a counter and a figure or two, a door at one end; tinted per shop by vertex colour
export function shopWindow(seed = 5) {
  const W = 512, Hh = 256, c = canvas(W, Hh), g = ctx2d(c), rng = new RNG(seed);
  for (let k = 0; k < 2; k++) {
    const x0 = k * 256, gr = g.createLinearGradient(0, 0, 0, Hh);
    gr.addColorStop(0, 'rgb(255,236,200)'); gr.addColorStop(0.6, 'rgb(210,180,140)'); gr.addColorStop(1, 'rgb(120,96,70)');
    g.fillStyle = gr; g.fillRect(x0, 0, 256, Hh);
    // shelves along the back with goods on them
    for (let s = 0; s < 4; s++) {
      const sy = 40 + s * 38;
      g.fillStyle = 'rgba(70,50,35,0.85)'; g.fillRect(x0 + 10, sy + 26, 236, 4);
      for (let q = 0; q < 16; q++) { g.fillStyle = `hsl(${rng.range(0, 360) | 0},${rng.range(30, 70) | 0}%,${rng.range(30, 60) | 0}%)`; const w = rng.range(6, 13); g.fillRect(x0 + 12 + q * 14.5, sy + 26 - rng.range(10, 22), w, 30); }
    }
    // a counter, and people (dark against the light)
    g.fillStyle = 'rgba(40,28,20,0.92)'; g.fillRect(x0 + (k ? 20 : 120), 180, 116, 76);
    for (let p = 0; p < 1 + k; p++) { const px = x0 + rng.range(40, 220), s = rng.range(0.9, 1.1); g.fillStyle = 'rgba(14,10,9,0.92)'; g.beginPath(); g.arc(px, 120 * s, 13, 0, Math.PI * 2); g.fill(); g.fillRect(px - 22, 134 * s, 44, 140); }
    // the valance and the window frame: a door at one end
    g.fillStyle = 'rgba(20,16,14,0.95)'; g.fillRect(x0, 0, 256, 16); g.fillRect(x0, Hh - 8, 256, 8);
    g.fillRect(x0, 0, 5, Hh); g.fillRect(x0 + 251, 0, 5, Hh); g.fillRect(x0 + (k ? 190 : 60), 16, 5, Hh);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(x0 + 40, 16); g.lineTo(x0 + 90, 16); g.lineTo(x0 + 30, Hh); g.lineTo(x0 - 20, Hh); g.fill();
  }
  return c;
}

// v0.4.8.5: police cruiser door panel (512 x 128): "POLICE" over a stripe, on white (the generic livery; no crest)
export function policeDoor() {
  const c = canvas(512, 128), g = ctx2d(c);
  g.fillStyle = '#f2f2f0'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#1d3f8a'; g.fillRect(0, 92, 512, 14);
  g.fillStyle = '#c8202a'; g.fillRect(0, 108, 512, 6);
  g.fillStyle = '#101418'; g.font = '900 64px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('POLICE', 256, 50);
  return c;
}

// v0.4.8.5: a soft round glow (white centre falling to nothing), for light pools on the ground and lamp halos
export function glowSpot(size = 128, falloff = 2.2) {
  const c = canvas(size, size), g = ctx2d(c), img = g.createImageData(size, size), d = img.data, r = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const q = Math.min(1, Math.hypot(x + 0.5 - r, y + 0.5 - r) / r), a = Math.pow(1 - q, falloff);
    const o = (y * size + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Building facade with windows; lit ratio controls emissive look (returns color + emissive canvases)
export function facade(opts = {}) {
  if (opts.detail) return facadeDetail(opts);
  const S = 512, c = canvas(S, S), e = canvas(S, S), g = ctx2d(c), ge = ctx2d(e), rng = new RNG(opts.seed || 41);
  g.fillStyle = opts.wall || '#5a4a45'; g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const cols = opts.cols || 6, rows = opts.rows || 8;
  const cw = S / cols, rh = S / rows;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = k * cw + cw * 0.2, y = r * rh + rh * 0.2, w = cw * 0.6, h = rh * 0.6;
    const lit = rng.next() < (opts.lit ?? 0.35);
    g.fillStyle = lit ? (rng.next() < 0.5 ? '#f3d9a0' : '#e8e2c8') : (opts.glass || '#2a3540');
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + h - 3, w, 3);
    if (lit) { ge.fillStyle = rng.next() < 0.5 ? '#ffd890' : '#fff1d0'; ge.fillRect(x, y, w, h); }
  }
  return { color: c, emissive: e };
}

// v0.4.8.5: the Old Brick Yard's facades, drawn to scale (opts.detail.ppm px a metre; one tile is 6 bays of 3.2 m by 5
// floors of 3.4 m: map it in metres with the ground floor at the bottom of a texture row). Brick courses or stone
// blocks, lintels and sills, grime under the sills; every window sits in a recess (shadow under the lintel and down
// one side), has a frame and a meeting rail or mullion, and the lit ones show a room: warm, cool, dim or the blue of
// a TV, with blinds half down (light through the slats), curtains, a lamp, shelves, plants on the sill and now and
// then somebody standing at the window or sitting in it. AC units and fire escapes block the light like the frames.
// Returns {color, emissive, layout: {bays, floors, bayW, floorH, win: [x, sill, w, h] metres, lit[row][bay]}}.
function facadeDetail(opts) {
  const D = opts.detail, ppm = D.ppm || 40, bays = D.bays || 6, floors = D.floors || 5, bayW = 3.2, floorH = 3.4;
  const W = Math.round(bays * bayW * ppm), H = Math.round(floors * floorH * ppm), bw = W / bays, fh = H / floors;
  const c = canvas(W, H), e = canvas(W, H), g = ctx2d(c), ge = ctx2d(e), rng = new RNG(opts.seed || 41), noise = makeNoise2D((opts.seed || 41) + 5);
  const brick = D.kind !== 'stone';
  const wall = opts.wall || (brick ? '#6a4034' : '#5a5c62');
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgb = (a, k = 1, al = 1) => `rgba(${Math.min(255, a[0] * k) | 0},${Math.min(255, a[1] * k) | 0},${Math.min(255, a[2] * k) | 0},${al})`;
  const wc = hex(wall);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  // the wall: brick courses (staggered, each brick its own tone) or stone blocks with joints
  if (brick) {
    g.fillStyle = rgb(wc, 1.25); g.fillRect(0, 0, W, H); // mortar
    const ch = 0.075 * ppm, bl = 0.23 * ppm;
    for (let y = 0, row = 0; y < H; y += ch, row++) for (let x = -(row % 2) * bl / 2; x < W; x += bl) { g.fillStyle = rgb(wc, 0.82 + rng.next() * 0.32); g.fillRect(x + 0.5, y + 0.5, bl - 1, ch - 0.8); }
  } else {
    g.fillStyle = rgb(wc); g.fillRect(0, 0, W, H);
    const bh = 0.6 * ppm, bL = 1.2 * ppm;
    for (let y = 0, row = 0; y < H; y += bh, row++) for (let x = -(row % 2) * bL / 2; x < W; x += bL) { g.fillStyle = rgb(wc, 0.9 + rng.next() * 0.16); g.fillRect(x + 1, y + 1, bL - 2, bh - 2); }
    for (let r = 0; r < floors; r++) { g.fillStyle = rgb(wc, 1.18); g.fillRect(0, r * fh + fh - 0.22 * ppm, W, 0.18 * ppm); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, r * fh + fh - 0.04 * ppm, W, 0.04 * ppm); }
  }
  // grime: soft blotches
  const im = g.getImageData(0, 0, W, H), d = im.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = 1 + noise.tile(x * 6 / W, y * 5 / H, 6, 3) * 0.16; const o = (y * W + x) * 4; d[o] *= k; d[o + 1] *= k; d[o + 2] *= k; }
  g.putImageData(im, 0, 0);
  const win = [0.9, 0.95, 1.4, 1.85], lit = [];
  const hues = { warm: [[255, 206, 128], [196, 134, 72]], cool: [[222, 236, 255], [150, 170, 196]], dim: [[170, 112, 60], [96, 62, 36]], tv: [[34, 48, 96], [20, 26, 50]] };
  const frameCols = brick ? ['#d8d2c4', '#1c2422', '#2a3a30', '#e4ddd0'] : ['#2a2c30', '#d0d0cc', '#1e2024'];
  for (let r = 0; r < floors; r++) {
    lit.push([]);
    for (let b = 0; b < bays; b++) {
      const x = b * bw + win[0] * ppm, y = r * fh + fh - (win[1] + win[3]) * ppm, w = win[2] * ppm, h = win[3] * ppm;
      const on = rng.next() < (opts.lit ?? 0.38);
      lit[r].push(on);
      const R = { hue: on ? rng.pick(['warm', 'warm', 'warm', 'cool', 'dim', 'tv']) : null, blinds: rng.next() < 0.45 ? rng.range(0.15, 0.7) : 0, curtains: rng.next() < 0.35, ccol: hex(rng.pick(['#8a2a2a', '#d8c8a0', '#3a4a6a', '#5a6a3a', '#c89060'])), person: on && rng.next() < 0.28 ? { x: rng.range(0.25, 0.75), sit: rng.next() < 0.35, s: rng.range(0.9, 1.08) } : null, plant: rng.next() < 0.25, lamp: on && rng.next() < 0.3, shelf: on && rng.next() < 0.3, ac: rng.next() < 0.14, cat: on && rng.next() < 0.05, frame: rng.pick(frameCols), mull: rng.next() < 0.3, seed: (rng.next() * 1e9) | 0 };
      // lintel and sill
      g.fillStyle = brick ? rgb(wc, 0.72) : rgb(wc, 1.22); g.fillRect(x - 0.12 * ppm, y - 0.24 * ppm, w + 0.24 * ppm, 0.22 * ppm);
      if (brick) for (let k = 0; k < (w + 0.24 * ppm) / (0.075 * ppm); k++) { g.fillStyle = rgb(wc, 0.6 + rng.next() * 0.25); g.fillRect(x - 0.12 * ppm + k * 0.075 * ppm, y - 0.24 * ppm, 0.065 * ppm, 0.22 * ppm); }
      g.fillStyle = '#c8c0b0'; g.fillRect(x - 0.1 * ppm, y + h, w + 0.2 * ppm, 0.09 * ppm);
      // grime streaks under the sill
      for (let k = 0; k < 4; k++) { const gx = x + rng.next() * w, gl = rng.range(0.3, 1.2) * ppm; const gr = g.createLinearGradient(0, y + h, 0, y + h + gl); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(gx, y + h + 0.09 * ppm, rng.range(2, 5), gl); }
      // the opening: the frame, then the glass / the room inside, in both maps
      const fw = 0.06 * ppm, ix = x + fw, iy = y + fw, iw = w - fw * 2, ih = h - fw * 2;
      g.fillStyle = R.frame; g.fillRect(x, y, w, h);
      const draw = (gg, k, emit) => {
        const rr = new RNG(R.seed); // (the same furniture in both maps)
        // k scales the room's light (emissive: 1; colour map: dimmer); emit: whether this is the emissive map
        if (!on) {
          if (emit) return;
          const gr = gg.createLinearGradient(0, iy, 0, iy + ih); gr.addColorStop(0, '#34404c'); gr.addColorStop(0.5, '#1a2028'); gr.addColorStop(1, '#0e1216');
          gg.fillStyle = gr; gg.fillRect(ix, iy, iw, ih);
          gg.fillStyle = 'rgba(200,215,230,0.1)'; gg.beginPath(); gg.moveTo(ix + iw * 0.15, iy); gg.lineTo(ix + iw * 0.45, iy); gg.lineTo(ix + iw * 0.1, iy + ih); gg.lineTo(ix - iw * 0.2, iy + ih); gg.closePath(); gg.save(); gg.clip(); gg.fill(); gg.restore();
          if (R.curtains) { gg.fillStyle = rgb(R.ccol, 0.35, 0.8); gg.fillRect(ix, iy, iw * 0.3, ih); gg.fillRect(ix + iw * 0.7, iy, iw * 0.3, ih); }
          if (R.blinds) { for (let yy = iy; yy < iy + ih * R.blinds; yy += 3) { gg.fillStyle = 'rgba(150,150,140,0.35)'; gg.fillRect(ix, yy, iw, 2); } }
          return;
        }
        const [top, bot] = hues[R.hue];
        const gr = gg.createLinearGradient(0, iy, 0, iy + ih); gr.addColorStop(0, rgb(top, k)); gr.addColorStop(1, rgb(bot, k));
        gg.fillStyle = gr; gg.fillRect(ix, iy, iw, ih);
        gg.save(); gg.beginPath(); gg.rect(ix, iy, iw, ih); gg.clip();
        if (R.hue === 'warm' || R.hue === 'cool') { const rg = gg.createRadialGradient(ix + iw * 0.5, iy - ih * 0.1, 0, ix + iw * 0.5, iy - ih * 0.1, ih * 0.8); rg.addColorStop(0, rgb([255, 245, 225], k, 0.55)); rg.addColorStop(1, 'rgba(255,240,220,0)'); gg.fillStyle = rg; gg.fillRect(ix, iy, iw, ih); }
        if (R.hue === 'tv') { gg.fillStyle = rgb([120, 160, 255], k, 0.85); gg.fillRect(ix + iw * 0.3, iy + ih * 0.45, iw * 0.4, ih * 0.3); const rg = gg.createRadialGradient(ix + iw * 0.5, iy + ih * 0.6, 0, ix + iw * 0.5, iy + ih * 0.6, ih * 0.6); rg.addColorStop(0, rgb([90, 130, 255], k, 0.5)); rg.addColorStop(1, 'rgba(60,90,200,0)'); gg.fillStyle = rg; gg.fillRect(ix, iy, iw, ih); }
        if (R.shelf) { const sx = ix + (R.person && R.person.x < 0.5 ? iw * 0.6 : iw * 0.06), sw = iw * 0.34; gg.fillStyle = rgb(top, k * 0.35); gg.fillRect(sx, iy + ih * 0.2, sw, ih * 0.8); for (let s = 0; s < 4; s++) for (let q = 0; q < 6; q++) { gg.fillStyle = rgb([rr.range(80, 200), rr.range(60, 160), rr.range(50, 140)], k * 0.45); gg.fillRect(sx + 2 + q * sw / 6, iy + ih * (0.24 + s * 0.19), sw / 6 - 1, ih * 0.15); } }
        if (R.lamp) { const lx = ix + iw * (R.person && R.person.x > 0.5 ? 0.2 : 0.8); gg.fillStyle = 'rgba(10,8,6,0.9)'; gg.fillRect(lx - 1, iy + ih * 0.45, 2, ih * 0.55); gg.fillStyle = rgb([255, 225, 160], k * 1.1); gg.beginPath(); gg.moveTo(lx - ih * 0.1, iy + ih * 0.46); gg.lineTo(lx + ih * 0.1, iy + ih * 0.46); gg.lineTo(lx + ih * 0.06, iy + ih * 0.32); gg.lineTo(lx - ih * 0.06, iy + ih * 0.32); gg.closePath(); gg.fill(); }
        if (R.person) {
          // somebody at the window: head, neck and shoulders (standing) or seated lower, nearly black against the room
          const p = R.person, px = ix + iw * p.x, s = p.s * ppm, base = p.sit ? iy + ih * 0.72 : iy + ih * 0.98;
          gg.fillStyle = 'rgba(12,9,8,0.93)';
          gg.beginPath(); gg.ellipse(px, base - (p.sit ? 0.75 : 1.32) * s, 0.1 * s, 0.125 * s, 0, 0, Math.PI * 2); gg.fill();
          gg.fillRect(px - 0.04 * s, base - (p.sit ? 0.66 : 1.23) * s, 0.08 * s, 0.1 * s);
          gg.beginPath(); const sy = base - (p.sit ? 0.58 : 1.14) * s;
          gg.moveTo(px - 0.22 * s, sy + 0.06 * s); gg.quadraticCurveTo(px - 0.23 * s, sy, px - 0.12 * s, sy - 0.02 * s); gg.lineTo(px + 0.12 * s, sy - 0.02 * s); gg.quadraticCurveTo(px + 0.23 * s, sy, px + 0.22 * s, sy + 0.06 * s);
          gg.lineTo(px + 0.19 * s, base + 0.2 * s); gg.lineTo(px - 0.19 * s, base + 0.2 * s); gg.closePath(); gg.fill();
        }
        if (R.cat) { const cx2 = ix + iw * 0.7, cy2 = iy + ih - 2; gg.fillStyle = 'rgba(8,6,5,0.95)'; gg.beginPath(); gg.ellipse(cx2, cy2 - 0.1 * ppm, 0.13 * ppm, 0.1 * ppm, 0, 0, Math.PI * 2); gg.fill(); gg.beginPath(); gg.arc(cx2 + 0.1 * ppm, cy2 - 0.22 * ppm, 0.06 * ppm, 0, Math.PI * 2); gg.fill(); gg.beginPath(); gg.moveTo(cx2 + 0.06 * ppm, cy2 - 0.26 * ppm); gg.lineTo(cx2 + 0.07 * ppm, cy2 - 0.33 * ppm); gg.lineTo(cx2 + 0.1 * ppm, cy2 - 0.27 * ppm); gg.lineTo(cx2 + 0.13 * ppm, cy2 - 0.33 * ppm); gg.lineTo(cx2 + 0.15 * ppm, cy2 - 0.25 * ppm); gg.fill(); }
        if (R.curtains) {
          // side curtains: the fabric glows a little with the room behind it, darker in the folds
          for (const side of [0, 1]) { const cw = iw * 0.27, cx0 = side ? ix + iw - cw : ix; for (let q = 0; q < cw; q += 2) { const fold = 0.5 + 0.5 * Math.sin(q * 0.9 + side); gg.fillStyle = rgb(R.ccol, k * (0.25 + fold * 0.3)); gg.fillRect(cx0 + q, iy, 2, ih); } }
        }
        if (R.plant) { gg.fillStyle = 'rgba(8,14,8,0.92)'; const px = ix + iw * (R.person ? (R.person.x > 0.5 ? 0.22 : 0.78) : 0.5); gg.fillRect(px - 0.09 * ppm, iy + ih - 0.16 * ppm, 0.18 * ppm, 0.16 * ppm); for (let q = 0; q < 7; q++) { gg.beginPath(); gg.ellipse(px + rr.range(-0.18, 0.18) * ppm, iy + ih - rr.range(0.2, 0.42) * ppm, 0.06 * ppm, 0.12 * ppm, rr.range(-1, 1), 0, Math.PI * 2); gg.fill(); } }
        if (R.blinds) {
          // venetian blinds down to R.blinds: light comes through between the slats
          const by = iy + ih * R.blinds;
          for (let yy = iy; yy < by; yy += 4) { gg.fillStyle = rgb(top, k * 0.3); gg.fillRect(ix, yy, iw, 2.4); gg.fillStyle = rgb(top, k * 0.75); gg.fillRect(ix, yy + 2.4, iw, 1.6); }
          gg.fillStyle = 'rgba(10,10,10,0.9)'; gg.fillRect(ix, by - 1, iw, 2);
          gg.fillStyle = 'rgba(10,10,10,0.6)'; gg.fillRect(ix + iw * 0.8, by, 1, ih * 0.15);
        }
        gg.restore();
      };
      draw(g, 0.55, false); draw(ge, 1, true);
      // the recess: the lintel's shadow across the top and the reveal's down one side, then the frame bars
      for (const [gg, a] of [[g, 0.75], [ge, 0.92]]) {
        let gr = gg.createLinearGradient(0, iy, 0, iy + 0.28 * ppm); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); gg.fillStyle = gr; gg.fillRect(ix, iy, iw, 0.28 * ppm);
        gr = gg.createLinearGradient(ix, 0, ix + 0.16 * ppm, 0); gr.addColorStop(0, `rgba(0,0,0,${a * 0.8})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); gg.fillStyle = gr; gg.fillRect(ix, iy, 0.16 * ppm, ih);
        gg.fillStyle = gg === g ? R.frame : '#000';
        gg.fillRect(ix, iy + ih * 0.5 - 1.5, iw, 3); // meeting rail of the sashes
        if (R.mull) gg.fillRect(ix + iw / 2 - 1, iy, 2, ih);
      }
      if (R.ac) {
        // a window AC unit in the lower sash
        const ax = x + w * 0.2, aw = w * 0.6, ah = 0.4 * ppm, ay = y + h - ah - 0.02 * ppm;
        g.fillStyle = '#9a9a94'; g.fillRect(ax, ay, aw, ah); g.fillStyle = '#6a6a66'; for (let q = 2; q < ah - 2; q += 3) g.fillRect(ax + 3, ay + q, aw - 6, 1);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(ax, ay + ah, aw, 3);
        ge.fillStyle = '#000'; ge.fillRect(ax, ay, aw, ah);
      }
    }
  }
  // fire escapes (brick): over pairs of bays, a landing at each floor with a railing, a ladder-stair between them
  if (brick) for (let b = 0; b + 1 < bays; b += 3) {
    if (rng.next() > (D.fireEscape ?? 0.4) * 2) continue;
    const x0 = b * bw + 0.3 * ppm, x1 = (b + 2) * bw - 0.3 * ppm;
    for (const gg of [g, ge]) {
      gg.fillStyle = gg === g ? '#161616' : '#000'; gg.strokeStyle = gg.fillStyle;
      for (let r = 0; r < floors; r++) {
        const py = r * fh + fh - 0.85 * ppm;
        gg.fillRect(x0, py, x1 - x0, 0.1 * ppm);                   // landing
        gg.fillRect(x0, py - 0.95 * ppm, x1 - x0, 0.05 * ppm);     // top rail
        for (let q = x0; q <= x1; q += 0.16 * ppm) gg.fillRect(q, py - 0.95 * ppm, 1.2, 0.95 * ppm);
        // the stair down to the landing below
        gg.lineWidth = 0.1 * ppm; gg.beginPath(); gg.moveTo(x1 - 0.4 * ppm, py + 0.1 * ppm); gg.lineTo(x0 + 0.9 * ppm, py + fh); gg.stroke();
        gg.lineWidth = 1.2; for (let q = 0; q < 10; q++) { const t = q / 10, sx = x1 - 0.4 * ppm + (x0 + 0.9 * ppm - (x1 - 0.4 * ppm)) * t, sy = py + 0.1 * ppm + (fh - 0.1 * ppm) * t; gg.beginPath(); gg.moveTo(sx, sy - 0.1 * ppm); gg.lineTo(sx, sy + 0.1 * ppm); gg.stroke(); }
      }
    }
  }
  return { color: c, emissive: e, layout: { bays, floors, bayW, floorH, win, lit } };
}

// Equirectangular environment for reflections: sky gradient + light sources.
export function envMap(spec) {
  const W = 512, H = 256, c = canvas(W, H), g = ctx2d(c);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, spec.top); gr.addColorStop(0.48, spec.horizon); gr.addColorStop(0.52, spec.horizonLow || spec.horizon); gr.addColorStop(1, spec.ground);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (const L of spec.lights || []) {
    const x = L.u * W, y = L.v * H;
    const rg = g.createRadialGradient(x, y, 0, x, y, L.r * W);
    rg.addColorStop(0, L.color); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(x - L.r * W, y - L.r * W, L.r * W * 2, L.r * W * 2);
  }
  if (spec.bands) for (const b of spec.bands) { g.fillStyle = b.color; g.fillRect(0, b.v * H, W, b.h * H); }
  if (spec.skyline) {
    const rng = new RNG(5);
    g.fillStyle = spec.skyline;
    for (let x = 0; x < W; x += 6 + rng.next() * 18) { const h = 6 + rng.next() * 30; g.fillRect(x, H / 2 - h, 8 + rng.next() * 16, h + 2); }
  }
  return c;
}

export function solid(r, g, b, a = 255) { return { width: 1, height: 1, data: new Uint8Array([r, g, b, a]) }; }

// Text banner (signage, jumbotron)
export function banner(text, opts = {}) {
  const w = opts.w || 1024, h = opts.h || 256, c = canvas(w, h), g = ctx2d(c);
  g.fillStyle = opts.bg || '#111'; g.fillRect(0, 0, w, h);
  if (opts.stripe) { g.fillStyle = opts.stripe; g.fillRect(0, h * 0.82, w, h * 0.18); }
  g.fillStyle = opts.color || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${opts.weight || 900} ${opts.size || h * 0.5}px ${opts.font || '"Arial Black", Impact, sans-serif'}`;
  g.fillText(text, w / 2, h * (opts.stripe ? 0.42 : 0.52));
  if (opts.sub) { g.font = `700 ${h * 0.14}px Arial, sans-serif`; g.globalAlpha = 0.8; g.fillText(opts.sub, w / 2, h * 0.9); }
  return c;
}

// v0.4.5 floor stencil for the squad-spot rows (GOT NEXT / 2ND / 3RD): white paint with a transparent background
export function floorLabel(text) {
  const w = 512, h = 128, c = canvas(w, h), g = ctx2d(c);
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${h * 0.62}px "Arial Black", Impact, sans-serif`;
  g.fillText(text, w / 2, h * 0.54);
  return c;
}

// Graffiti / mural with original shapes and lettering
export function mural(text, opts = {}) {
  const w = 1024, h = 512, c = canvas(w, h), g = ctx2d(c), rng = new RNG(opts.seed || 77);
  g.fillStyle = opts.bg || '#3b3a40'; g.fillRect(0, 0, w, h);
  const pal = opts.palette || ['#ff6b4a', '#ffd25e', '#41c6b9', '#7d5cff', '#f4f1e8'];
  for (let i = 0; i < 26; i++) {
    g.fillStyle = pal[i % pal.length]; g.globalAlpha = 0.25 + rng.next() * 0.35;
    g.beginPath(); g.arc(rng.next() * w, rng.next() * h, 30 + rng.next() * 160, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  g.save(); g.translate(w / 2, h / 2); g.rotate(-0.06);
  g.font = '900 150px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 26; g.strokeStyle = '#141418'; g.strokeText(text, 0, 0);
  const tg = g.createLinearGradient(0, -80, 0, 80); tg.addColorStop(0, pal[1]); tg.addColorStop(1, pal[0]);
  g.fillStyle = tg; g.fillText(text, 0, 0);
  g.lineWidth = 5; g.strokeStyle = pal[4]; g.strokeText(text, 0, 0);
  g.restore();
  return c;
}
