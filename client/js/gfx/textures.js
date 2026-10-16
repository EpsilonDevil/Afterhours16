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
    if (spec.retro) retroApron(g, spec, W, L, margin); // (v0.4.8.5 quick patch: sunset stripes and Memphis confetti)
    else if (spec.horror) horrorApron(g, spec, W, L, margin); // (v0.4.8.5 quick patch 2: iron spikes, cobwebs, tombstones, bats)
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
    if (spec.retro) {
      // v0.4.8.5 quick patch: 80s lettering: italic, a dark outline and a cyan drop copy behind the cream
      g.globalAlpha = 1; g.font = 'italic 900 0.48px "Arial Black", Impact, sans-serif'; g.lineJoin = 'round';
      const tw = g.measureText(spec.baselineText).width; if (tw > 8.6) g.scale(8.6 / tw, 1);
      g.fillStyle = spec.retro.shadow || '#2fe0ff'; g.fillText(spec.baselineText, 0.05, 0.05);
      g.lineWidth = 0.07; g.strokeStyle = spec.retro.outline || '#1a1230'; g.strokeText(spec.baselineText, 0, 0);
      g.fillStyle = spec.baselineColor || spec.lines; g.fillText(spec.baselineText, 0, 0); g.restore(); continue;
    }
    if (spec.horror) { horrorLettering(g, spec.baselineText, spec.baselineColor || spec.lines, spec.horror, (spec.seed || 3) + s); g.restore(); continue; } // (v0.4.8.5 quick patch 2)
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

// v0.4.8.5 quick patch: And The Beat Goes On. The court logo is a synthwave sunset in a medallion: the striped sun going
// down behind a neon grid horizon between two palms, the text (BEAT) across it in chrome italics. Unit space (radius 1).
export function drawSunsetLogo(g, logo, size) {
  const bg = logo.color || '#1a1230', pink = logo.accent || '#ff3fa4', cyan = logo.cyan || '#2fe0ff', dusk = '#4a1a5e';
  g.save(); g.scale(size, size); g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fillStyle = bg; g.globalAlpha = logo.alpha ?? 0.96; g.fill(); g.globalAlpha = 1;
  g.save(); g.beginPath(); g.arc(0, 0, 0.9, 0, Math.PI * 2); g.clip();
  const hy = 0.12, sr = 0.6;
  const sky = g.createLinearGradient(0, -0.9, 0, hy); sky.addColorStop(0, bg); sky.addColorStop(1, dusk); g.fillStyle = sky; g.fillRect(-1, -1, 2, 1 + hy);
  // the sun: yellow at the top to pink at the horizon, bands of sky cut across its lower half
  const sg = g.createLinearGradient(0, hy - sr, 0, hy); sg.addColorStop(0, '#ffe45c'); sg.addColorStop(0.5, '#ff8a3c'); sg.addColorStop(1, pink);
  g.beginPath(); g.arc(0, hy, sr, Math.PI, 0); g.closePath(); g.fillStyle = sg; g.fill();
  g.fillStyle = dusk; for (let i = 0; i < 5; i++) { const y = hy - 0.3 + i * 0.066, h = 0.012 + i * 0.008; g.fillRect(-0.7, y, 1.4, h); }
  // the grid floor running to the horizon
  g.fillStyle = bg; g.fillRect(-1, hy, 2, 1);
  g.strokeStyle = cyan; g.lineWidth = 0.022;
  g.beginPath(); g.moveTo(-1, hy); g.lineTo(1, hy); g.stroke();
  g.lineWidth = 0.016; g.strokeStyle = pink;
  for (let k = -7; k <= 7; k++) { g.beginPath(); g.moveTo(k * 0.05, hy); g.lineTo(k * 0.32, 1); g.stroke(); }
  for (let j = 1; j < 7; j++) { const y = hy + 0.8 * (j / 6) ** 1.8; g.beginPath(); g.moveTo(-1, y); g.lineTo(1, y); g.stroke(); }
  // two palm silhouettes on the horizon
  g.fillStyle = '#120a20'; g.strokeStyle = '#120a20';
  for (const [px, s, lean] of [[-0.6, 1, 0.12], [0.66, 0.8, -0.1]]) {
    g.lineWidth = 0.035 * s; g.beginPath(); g.moveTo(px, hy + 0.02); g.quadraticCurveTo(px + lean * 0.5, hy - 0.3 * s, px + lean, hy - 0.55 * s); g.stroke();
    const tx = px + lean, ty = hy - 0.55 * s;
    for (let f = 0; f < 6; f++) { const a = -Math.PI * 0.95 + f * Math.PI * 0.38; g.lineWidth = 0.045 * s; g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + Math.cos(a) * 0.16 * s, ty + Math.sin(a) * 0.14 * s - 0.03, tx + Math.cos(a) * 0.26 * s, ty + Math.sin(a) * 0.1 * s + 0.08 * s); g.stroke(); }
  }
  g.restore();
  // the rings: pink outside, cyan inside
  g.beginPath(); g.arc(0, 0, 0.955, 0, Math.PI * 2); g.lineWidth = 0.07; g.strokeStyle = pink; g.stroke();
  g.beginPath(); g.arc(0, 0, 0.9, 0, Math.PI * 2); g.lineWidth = 0.022; g.strokeStyle = cyan; g.stroke();
  // the word, in chrome italics with a cyan drop and a dark outline
  if (logo.text) {
    g.save(); g.translate(0, 0.5); g.rotate(-0.08);
    g.font = 'italic 900 0.44px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(logo.text).width; if (tw > 1.5) g.scale(1.5 / tw, 1);
    g.fillStyle = cyan; g.fillText(logo.text, 0.035, 0.035);
    g.lineWidth = 0.07; g.strokeStyle = '#120a20'; g.strokeText(logo.text, 0, 0);
    const cg = g.createLinearGradient(0, -0.2, 0, 0.2); cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.45, '#bfefff'); cg.addColorStop(0.55, '#ff9fd0'); cg.addColorStop(1, pink);
    g.fillStyle = cg; g.fillText(logo.text, 0, 0); g.restore();
  }
  g.restore();
}

// v0.4.8.5 quick patch: the retro court apron: a frame of sunset stripes round its outer edge and Memphis-style confetti
// (squiggles, triangles, dots, zigzags, rings, crosses, half moons) between the stripes and the boundary line, kept
// clear of the baseline lettering and of the Got Next spots on the east side. spec.retro: {stripes, palette, count}
function retroApron(g, spec, W, L, margin) {
  const R = spec.retro, rng = new RNG((spec.seed || 3) * 7 + 1), cw = COURT.width / 2, cl = COURT.length / 2;
  const stripes = R.stripes || ['#ffe45c', '#ff8a3c', '#2fe0ff'];
  stripes.forEach((c, i) => { const d = 0.16 + i * 0.13; g.strokeStyle = c; g.lineWidth = 0.08; g.strokeRect(-W / 2 + d, -L / 2 + d, W - d * 2, L - d * 2); });
  const inner = 0.3, outer = margin - 0.16 - stripes.length * 0.13 - 0.12, spots = [];
  for (let tries = 0, n = 0; n < (R.count || 70) && tries < 3000; tries++) {
    const side = rng.int(0, 3), d = inner + rng.next() * (outer - inner);
    let x, z;
    if (side < 2) { x = (rng.next() * 2 - 1) * (cw + d); z = (side ? 1 : -1) * (cl + d); } else { z = (rng.next() * 2 - 1) * (cl + d); x = (side === 2 ? 1 : -1) * (cw + d); }
    if (Math.abs(z) > cl && Math.abs(x) < 4.9) continue;          // the baseline lettering
    if (x > cw && z > -10 && z < 12) continue;                     // the Got Next spots
    if (spots.some(([a, b]) => Math.hypot(a - x, b - z) < 0.62)) continue;
    spots.push([x, z]); n++;
    memphis(g, rng.int(0, 7), x, z, 0.13 + rng.next() * 0.12, rng.next() * Math.PI * 2, rng.pick(R.palette || ['#2fe0ff', '#ffe45c', '#1a1230', '#fff4e6', '#9b5cff']));
  }
}
function memphis(g, kind, x, y, s, rot, color) {
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = color; g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = s * 0.28;
  g.beginPath();
  if (kind === 0) { for (let i = 0; i <= 16; i++) { const t = i / 16; g.lineTo((t - 0.5) * s * 3.2, Math.sin(t * Math.PI * 3) * s * 0.35); } g.stroke(); } // squiggle
  else if (kind === 1) { g.moveTo(0, -s); g.lineTo(s * 0.9, s * 0.6); g.lineTo(-s * 0.9, s * 0.6); g.closePath(); g.fill(); } // triangle
  else if (kind === 2) { g.lineWidth = s * 0.2; g.moveTo(0, -s); g.lineTo(s * 0.9, s * 0.6); g.lineTo(-s * 0.9, s * 0.6); g.closePath(); g.stroke(); }
  else if (kind === 3) { for (let i = 0; i < 3; i++) { g.moveTo((i - 1) * s * 0.9 + s * 0.22, 0); g.arc((i - 1) * s * 0.9, (i % 2) * s * 0.4, s * 0.22, 0, Math.PI * 2); } g.fill(); } // dots
  else if (kind === 4) { for (let i = 0; i <= 6; i++) g.lineTo((i / 6 - 0.5) * s * 3, (i % 2 ? -1 : 1) * s * 0.3); g.stroke(); } // zigzag
  else if (kind === 5) { g.lineWidth = s * 0.22; g.arc(0, 0, s * 0.7, 0, Math.PI * 2); g.stroke(); } // ring
  else if (kind === 6) { g.lineWidth = s * 0.3; g.moveTo(-s * 0.6, 0); g.lineTo(s * 0.6, 0); g.moveTo(0, -s * 0.6); g.lineTo(0, s * 0.6); g.stroke(); } // cross
  else { g.arc(0, 0, s * 0.8, 0, Math.PI); g.closePath(); g.fill(); } // half moon
  g.restore();
}

export function drawLogo(g, logo, x, y, size) {
  g.save(); g.translate(x, y);
  const shape = logo.shape || 'circle';
  if (shape === 'sphinx') { if (logo.rotate) g.rotate(logo.rotate); drawSphinx(g, logo, size); g.restore(); return; }
  if (shape === 'toucan') { if (logo.rotate) g.rotate(logo.rotate); drawToucan(g, logo, size); g.restore(); return; }
  if (shape === 'sunset') { if (logo.rotate) g.rotate(logo.rotate); drawSunsetLogo(g, logo, size); g.restore(); return; } // (v0.4.8.5 quick patch)
  if (shape === 'jack') { if (logo.rotate) g.rotate(logo.rotate); drawJackLogo(g, logo, size); g.restore(); return; } // (v0.4.8.5 quick patch 2)
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

// ---------------- v0.4.8.5 quick patch: And The Beat Goes On ----------------
// neon tubes: a wide faint glow, the tube, the white-hot core (draw() strokes the shape; additive over a dark board)
function neonStroke(g, draw, color, w = 1) {
  for (const [lw, a] of [[24 * w, 0.1], [13 * w, 0.26]]) { g.globalAlpha = a; g.strokeStyle = color; g.lineWidth = lw; draw(); }
  g.globalAlpha = 1; g.strokeStyle = color; g.lineWidth = 5.5 * w; draw();
  g.strokeStyle = '#ffffff'; g.globalAlpha = 0.85; g.lineWidth = 1.9 * w; draw(); g.globalAlpha = 1;
}
// the city's neon signs (1024 x 1024 atlas): twelve words in 512 x 128 cells (rows 0-5), the event's name across a whole
// row (row 6) and eight 128 x 128 icons (row 7). retroSignUV(key) gives a cell's [u0, v0, uw, vh].
export const RETRO_WORDS = [['DISCO', '#ff3fa4'], ['ARCADE', '#2fe0ff'], ['VIDEO', '#ffe45c'], ['ROLLER RINK', '#c77dff'], ['RECORDS', '#ff8a3c'], ['DINER', '#ff4a6a'],
  ['MOTEL', '#3dffb0'], ['VACANCY', '#ff4a6a'], ['COCKTAILS', '#2fe0ff'], ['LIVE MUSIC', '#ff3fa4'], ['PIZZA', '#ffb03c'], ['DANCE', '#ffe45c']];
export const RETRO_ICONS = ['cocktail', 'record', 'skate', 'cassette', 'palm', 'bolt', 'note', 'star'];
export function retroSignUV(key) {
  const i = RETRO_WORDS.findIndex(w => w[0] === key);
  if (i >= 0) return [(i % 2) * 0.5, Math.floor(i / 2) * 0.125, 0.5, 0.125];
  if (key === 'BEAT') return [0, 0.75, 1, 0.125];
  const j = RETRO_ICONS.indexOf(key);
  return [j * 0.125, 0.875, 0.125, 0.125];
}
export function retroSigns() {
  const S = 1024, c = canvas(S, S), g = ctx2d(c);
  g.clearRect(0, 0, S, S); g.lineJoin = 'round'; g.lineCap = 'round';
  const word = (text, color, cx, cy, maxW, px, italic = true) => {
    g.save(); g.translate(cx, cy);
    g.font = `${italic ? 'italic ' : ''}800 ${px}px "Trebuchet MS", "Arial Rounded MT Bold", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const sc = Math.min(1, maxW / g.measureText(text).width); g.scale(sc, 1);
    neonStroke(g, () => g.strokeText(text, 0, 2), color);
    g.restore();
  };
  RETRO_WORDS.forEach(([text, color], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
    word(text, color, x + 256, y + 62, 440, text.length > 8 ? 62 : 80);
    // an underline swoosh
    g.save(); neonStroke(g, () => { g.beginPath(); g.moveTo(x + 70, y + 108); g.quadraticCurveTo(x + 256, y + 96, x + 442, y + 108); g.stroke(); }, color, 0.55); g.restore();
  });
  // the event's name: AND THE in cyan, BEAT GOES ON in pink
  word('AND THE', '#2fe0ff', 150, 768 + 64, 250, 64);
  word('BEAT GOES ON', '#ff3fa4', 610, 768 + 62, 640, 92);
  // icons
  const icon = (j, fn) => { g.save(); g.translate(j * 128 + 64, 896 + 64); fn(); g.restore(); };
  const P = (pts, close) => () => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); if (close) g.closePath(); g.stroke(); };
  icon(0, () => { neonStroke(g, P([[-36, -34], [36, -34], [0, 4], [-36, -34]]), '#2fe0ff', 0.5); neonStroke(g, P([[0, 4], [0, 34], [-20, 40], [20, 40]]), '#2fe0ff', 0.5); neonStroke(g, () => { g.beginPath(); g.arc(-8, -20, 7, 0, Math.PI * 2); g.stroke(); }, '#ff3fa4', 0.5); });
  icon(1, () => { neonStroke(g, () => { g.beginPath(); g.arc(0, 0, 46, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, 30, 0.3, 2.2); g.stroke(); }, '#c77dff', 0.5); neonStroke(g, () => { g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.stroke(); }, '#ff8a3c', 0.5); });
  icon(2, () => { neonStroke(g, P([[-30, -40], [-6, -40], [-4, -6], [34, 4], [36, 22], [-34, 22]], true), '#ff3fa4', 0.5); neonStroke(g, () => { for (const x of [-22, 0, 22]) { g.beginPath(); g.arc(x, 34, 9, 0, Math.PI * 2); g.stroke(); } }, '#ffe45c', 0.5); });
  icon(3, () => { neonStroke(g, () => { g.beginPath(); g.rect(-46, -30, 92, 60); g.stroke(); g.beginPath(); g.arc(-20, -4, 10, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(20, -4, 10, 0, Math.PI * 2); g.stroke(); }, '#ffe45c', 0.5); neonStroke(g, P([[-26, 30], [-18, 16], [18, 16], [26, 30]]), '#ff3fa4', 0.5); });
  icon(4, () => { neonStroke(g, () => { g.beginPath(); g.moveTo(-6, 44); g.quadraticCurveTo(2, 4, -2, -26); g.stroke(); }, '#ff8a3c', 0.5); neonStroke(g, () => { for (let k = 0; k < 6; k++) { const a = -Math.PI + 0.15 + k * 0.56; g.beginPath(); g.moveTo(-2, -26); g.quadraticCurveTo(-2 + Math.cos(a) * 26, -26 + Math.sin(a) * 24 - 8, -2 + Math.cos(a) * 44, -26 + Math.sin(a) * 18 + 14); g.stroke(); } }, '#3dffb0', 0.5); });
  icon(5, () => neonStroke(g, P([[10, -46], [-24, 6], [0, 6], [-10, 46], [26, -10], [2, -10]], true), '#ffe45c', 0.55));
  icon(6, () => { neonStroke(g, () => { for (const x of [-22, 18]) { g.beginPath(); g.ellipse(x - 8, 30, 12, 9, -0.4, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(x + 3, 28); g.lineTo(x + 3, -32); g.stroke(); } g.beginPath(); g.moveTo(-19, -32); g.lineTo(21, -40); g.stroke(); g.beginPath(); g.moveTo(-19, -20); g.lineTo(21, -28); g.stroke(); }, '#ff3fa4', 0.5); });
  icon(7, () => neonStroke(g, () => { g.beginPath(); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = k % 2 ? 12 : 46; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.stroke(); }, '#bff6ff', 0.5));
  return c;
}

// pastel art-deco facades drawn to scale: one tile is 4 bays of 3.2 m by 4 floors of 3.4 m (map it in metres, ground floor
// at the bottom of a texture row). kind 'stucco': white stucco (tint it by vertex colour) with framed windows under
// "eyebrow" sunshades and three racing stripes at every floor line; 'glass': an 80s mirror-glass curtain wall, dark
// spandrels at every floor. Returns {color, emissive} canvases (the emissive one: the rooms lit at sundown).
export const DECO_TILE = { bays: 4, floors: 4, bayW: 3.2, floorH: 3.4 };
export function decoFacade(opts = {}) {
  const ppm = opts.ppm || 40, { bays, floors, bayW, floorH } = DECO_TILE;
  const W = Math.round(bays * bayW * ppm), H = Math.round(floors * floorH * ppm), bw = W / bays, fh = H / floors;
  const c = canvas(W, H), e = canvas(W, H), g = ctx2d(c), ge = ctx2d(e), rng = new RNG(opts.seed || 83), noise = makeNoise2D((opts.seed || 83) + 2);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const lit = opts.lit ?? 0.32, glows = ['#ffcf8a', '#ffcf8a', '#ffb0d8', '#bcd8ff', '#ffe2b0', '#7fa6ff'];
  if (opts.kind === 'glass') {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#3a6a8a'); gr.addColorStop(0.45, '#24486a'); gr.addColorStop(0.7, '#4a5a8a'); gr.addColorStop(1, '#1e3a5a');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let r = 0; r < floors; r++) {
      const y0 = H - (r + 1) * fh;
      for (let k = 0; k < bays * 2; k++) {
        const x = k * bw / 2, on = rng.next() < lit;
        if (on) { ge.fillStyle = rng.pick(glows); ge.globalAlpha = 0.55 + rng.next() * 0.45; ge.fillRect(x + 2, y0 + 0.5 * ppm, bw / 2 - 4, fh - 1.2 * ppm); ge.globalAlpha = 1; }
      }
      g.fillStyle = '#161a2e'; g.fillRect(0, y0 + fh - 0.7 * ppm, W, 0.7 * ppm); // spandrel
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y0 + fh - 0.72 * ppm, W, 2);
    }
    g.fillStyle = 'rgba(210,220,235,0.55)'; for (let k = 0; k <= bays * 2; k++) g.fillRect(k * bw / 2 - 1, 0, 2, H); // mullions
    ge.fillStyle = '#000'; for (let k = 0; k <= bays * 2; k++) ge.fillRect(k * bw / 2 - 1.5, 0, 3, H);
    return { color: c, emissive: e };
  }
  // stucco with a little trowel texture
  g.fillStyle = '#f4efe7'; g.fillRect(0, 0, W, H);
  const im = g.getImageData(0, 0, W, H), d = im.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = 0.95 + noise.tile(x * 8 / W, y * 8 / H, 8, 3) * 0.08 + (rng.next() - 0.5) * 0.03; const o = (y * W + x) * 4; d[o] *= k; d[o + 1] *= k; d[o + 2] *= k; }
  g.putImageData(im, 0, 0);
  const accent = opts.accent || '#2bb3b1', accent2 = opts.accent2 || '#ff6fae';
  for (let r = 0; r < floors; r++) {
    const y0 = H - (r + 1) * fh, ry = m => y0 + fh - m * ppm; // m metres above this floor
    // racing stripes along the floor line, then the windows: framed, recessed, under an eyebrow sunshade
    [accent, accent2, accent].forEach((col, i) => { g.fillStyle = col; g.fillRect(0, ry(0.32 - i * 0.11), W, 0.06 * ppm); });
    for (let b = 0; b < bays; b++) {
      const ribbon = (r + b) % 3 !== 1, x = b * bw + (ribbon ? 0.25 : 0.7) * ppm, w = bw - (ribbon ? 0.5 : 1.4) * ppm, y = ry(2.4), h = (2.4 - 0.95) * ppm;
      const on = rng.next() < lit, glow = rng.pick(glows);
      g.fillStyle = '#e6ded2'; g.fillRect(x - 0.08 * ppm, y - 0.08 * ppm, w + 0.16 * ppm, h + 0.16 * ppm); // frame
      const gg = g.createLinearGradient(0, y, 0, y + h); gg.addColorStop(0, on ? '#8a6a58' : '#2a4656'); gg.addColorStop(1, on ? '#c89870' : '#4a7080');
      g.fillStyle = gg; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.moveTo(x + w * 0.1, y); g.lineTo(x + w * 0.35, y); g.lineTo(x + w * 0.15, y + h); g.lineTo(x - w * 0.1, y + h); g.closePath(); g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fill(); g.restore();
      for (let m = 1; m < (ribbon ? 3 : 2); m++) { g.fillStyle = '#d8d0c4'; g.fillRect(x + w * m / (ribbon ? 3 : 2) - 2, y, 4, h); }
      if (on) { ge.fillStyle = glow; ge.globalAlpha = 0.6 + rng.next() * 0.4; ge.fillRect(x, y, w, h); ge.globalAlpha = 1; ge.fillStyle = '#000'; for (let m = 1; m < (ribbon ? 3 : 2); m++) ge.fillRect(x + w * m / (ribbon ? 3 : 2) - 2, y, 4, h); if (rng.next() < 0.4) { ge.fillStyle = 'rgba(0,0,0,0.7)'; ge.fillRect(x, y, w, h * rng.range(0.2, 0.5)); } }
      // the eyebrow and its shadow over the glass
      g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(x - 0.1 * ppm, y, w + 0.2 * ppm, 0.28 * ppm);
      ge.fillStyle = 'rgba(0,0,0,0.5)'; ge.fillRect(x, y, w, 0.2 * ppm);
      g.fillStyle = '#fbf8f2'; g.fillRect(x - 0.3 * ppm, y - 0.2 * ppm, w + 0.6 * ppm, 0.14 * ppm);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - 0.3 * ppm, y - 0.06 * ppm, w + 0.6 * ppm, 0.05 * ppm);
    }
  }
  return { color: c, emissive: e };
}

// the boombox-and-cassette mural (1536 x 512, for the 18 x 6 m wall): a synthwave sky over a neon grid, the striped sun
// between two palms, a giant silver boombox and a pink cassette, notes flying out of the speakers, Memphis confetti
// and the event's name in chrome across the top
export function boomboxMural() {
  const W = 1536, H = 512, c = canvas(W, H), g = ctx2d(c), rng = new RNG(808);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62); sky.addColorStop(0, '#1b0f3a'); sky.addColorStop(0.55, '#7a1f74'); sky.addColorStop(1, '#ff6f61');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const hy = H * 0.62;
  // the sun
  const sg = g.createLinearGradient(0, hy - 230, 0, hy); sg.addColorStop(0, '#ffe45c'); sg.addColorStop(0.6, '#ff8a3c'); sg.addColorStop(1, '#ff3fa4');
  g.fillStyle = sg; g.beginPath(); g.arc(W / 2, hy, 230, Math.PI, 0); g.fill();
  g.fillStyle = '#9a2a7a'; for (let i = 0; i < 6; i++) g.fillRect(W / 2 - 240, hy - 120 + i * 21, 480, 3 + i * 2.2);
  // the grid floor
  g.fillStyle = '#160b2a'; g.fillRect(0, hy, W, H - hy);
  g.strokeStyle = '#ff3fa4'; g.lineWidth = 3;
  for (let k = -16; k <= 16; k++) { g.beginPath(); g.moveTo(W / 2 + k * 28, hy); g.lineTo(W / 2 + k * 190, H); g.stroke(); }
  for (let j = 1; j < 8; j++) { const y = hy + (H - hy) * (j / 7) ** 1.9; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = '#2fe0ff'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, hy); g.lineTo(W, hy); g.stroke();
  // palms
  g.fillStyle = '#12081f'; g.strokeStyle = '#12081f'; g.lineCap = 'round';
  for (const [px, s, lean] of [[110, 1.1, 40], [250, 0.8, -30], [1290, 0.9, 30], [1430, 1.15, -45]]) {
    g.lineWidth = 16 * s; g.beginPath(); g.moveTo(px, hy + 6); g.quadraticCurveTo(px + lean * 0.4, hy - 150 * s, px + lean, hy - 270 * s); g.stroke();
    for (let f = 0; f < 7; f++) { const a = -Math.PI + 0.1 + f * 0.48; g.lineWidth = 14 * s; g.beginPath(); g.moveTo(px + lean, hy - 270 * s); g.quadraticCurveTo(px + lean + Math.cos(a) * 70 * s, hy - 270 * s + Math.sin(a) * 60 * s - 20, px + lean + Math.cos(a) * 120 * s, hy - 270 * s + Math.sin(a) * 40 * s + 50 * s); g.stroke(); }
  }
  // Memphis confetti in the sky
  for (let i = 0; i < 40; i++) memphis(g, rng.int(0, 7), rng.range(20, W - 20), rng.range(110, hy - 30), rng.range(9, 18), rng.range(0, 6.3), rng.pick(['#2fe0ff', '#ffe45c', '#fff4e6', '#c77dff']));
  // the boombox: a silver body, two big speakers, the tape deck, buttons, a handle and an aerial
  const bx = 560, by = 330, bw = 520, bh = 250;
  g.save(); g.translate(bx, by); g.rotate(-0.05);
  g.strokeStyle = '#c9ced6'; g.lineWidth = 14; g.beginPath(); g.moveTo(-bw * 0.34, -bh / 2); g.lineTo(-bw * 0.3, -bh / 2 - 60); g.lineTo(bw * 0.3, -bh / 2 - 60); g.lineTo(bw * 0.34, -bh / 2); g.stroke();
  g.lineWidth = 5; g.beginPath(); g.moveTo(bw * 0.4, -bh / 2); g.lineTo(bw * 0.62, -bh / 2 - 150); g.stroke();
  const body = g.createLinearGradient(0, -bh / 2, 0, bh / 2); body.addColorStop(0, '#f4f6f8'); body.addColorStop(0.5, '#b8bec8'); body.addColorStop(1, '#7c8490');
  g.fillStyle = body; g.beginPath(); g.roundRect ? g.roundRect(-bw / 2, -bh / 2, bw, bh, 22) : g.rect(-bw / 2, -bh / 2, bw, bh); g.fill();
  g.strokeStyle = '#2a2d36'; g.lineWidth = 5; g.stroke();
  for (const sx of [-1, 1]) {
    const cx = sx * bw * 0.31, cy = 18;
    for (const [r, col] of [[92, '#1d1f26'], [80, '#ff3fa4'], [72, '#2a2d36'], [50, '#3a3e48'], [30, '#1d1f26'], [12, '#9aa3ad']]) { g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#2fe0ff'; g.fillRect(cx - 40, -bh / 2 + 16, 80, 10);
  }
  g.fillStyle = '#20232b'; g.fillRect(-82, -40, 164, 100); // the tape deck
  g.fillStyle = '#ff9fd0'; g.fillRect(-66, -26, 132, 60);
  g.fillStyle = '#20232b'; for (const x of [-30, 30]) { g.beginPath(); g.arc(x, 4, 14, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#fff4e6'; g.fillRect(-46, -20, 92, 12);
  for (let i = 0; i < 6; i++) { g.fillStyle = i === 2 ? '#ff4a6a' : '#3a3e48'; g.fillRect(-84 + i * 28, -bh / 2 + 18, 22, 14); }
  g.fillStyle = '#ffe45c'; for (let i = 0; i < 10; i++) g.fillRect(-80 + i * 16, 74, 10, 6 + (i * 7) % 18);
  g.restore();
  // notes flying out of the speakers
  g.fillStyle = '#fff4e6';
  for (let i = 0; i < 9; i++) { const x = 300 + i * 70 + rng.range(-15, 15), y = 200 - Math.sin(i * 0.8) * 60 - rng.range(0, 40); g.beginPath(); g.ellipse(x, y, 11, 8, -0.4, 0, Math.PI * 2); g.fill(); g.fillRect(x + 8, y - 44, 4, 44); if (i % 2) g.fillRect(x + 8, y - 44, 22, 6); }
  // the cassette, tilted, off to the right
  g.save(); g.translate(1110, 330); g.rotate(0.16);
  g.fillStyle = '#ff3fa4'; g.beginPath(); g.roundRect ? g.roundRect(-190, -120, 380, 240, 16) : g.rect(-190, -120, 380, 240); g.fill();
  g.strokeStyle = '#1b0f3a'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#fff4e6'; g.fillRect(-160, -96, 320, 120);
  ['#ffe45c', '#ff8a3c', '#2fe0ff'].forEach((col, i) => { g.fillStyle = col; g.fillRect(-160, -96 + 84 + i * 10, 320, 8); });
  g.fillStyle = '#1b0f3a'; g.font = 'italic 900 30px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BEAT GOES ON', 0, -62);
  g.fillStyle = '#2a2d36'; g.fillRect(-100, -30, 200, 50);
  for (const x of [-60, 60]) { g.fillStyle = '#fff4e6'; g.beginPath(); g.arc(x, -5, 20, 0, Math.PI * 2); g.fill(); g.fillStyle = '#2a2d36'; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g.fillRect(x + Math.cos(a) * 12 - 3, -5 + Math.sin(a) * 12 - 3, 6, 6); } }
  g.fillStyle = '#c9306f'; g.beginPath(); g.moveTo(-120, 120); g.lineTo(-90, 60); g.lineTo(90, 60); g.lineTo(120, 120); g.closePath(); g.fill();
  g.restore();
  // the name across the top: chrome italics, a cyan drop, a dark outline
  g.save(); g.translate(W / 2, 74); g.rotate(-0.025);
  g.font = 'italic 900 92px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.fillStyle = '#2fe0ff'; g.fillText('AND THE BEAT GOES ON', 7, 7);
  g.lineWidth = 12; g.strokeStyle = '#12081f'; g.strokeText('AND THE BEAT GOES ON', 0, 0);
  const tg = g.createLinearGradient(0, -46, 0, 46); tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.48, '#bfefff'); tg.addColorStop(0.52, '#ff9fd0'); tg.addColorStop(1, '#ff3fa4');
  g.fillStyle = tg; g.fillText('AND THE BEAT GOES ON', 0, 0);
  g.restore();
  return c;
}

// the sun on the horizon (512 x 512, transparent ground): a soft halo, then the disc, yellow at the top through orange
// to hot pink, with the synthwave bands cut out of its lower half (they show the sky behind)
export function synthSun() {
  const S = 512, c = canvas(S, S), g = ctx2d(c), r = S * 0.34, cx = S / 2, cy = S / 2;
  g.clearRect(0, 0, S, S);
  const halo = g.createRadialGradient(cx, cy, r * 0.9, cx, cy, S / 2);
  halo.addColorStop(0, 'rgba(255,170,90,0.55)'); halo.addColorStop(0.35, 'rgba(255,110,120,0.22)'); halo.addColorStop(1, 'rgba(255,90,140,0)');
  g.fillStyle = halo; g.fillRect(0, 0, S, S);
  const gr = g.createLinearGradient(0, cy - r, 0, cy + r);
  gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.35, '#ffd24a'); gr.addColorStop(0.62, '#ff8a3c'); gr.addColorStop(1, '#ff3f8a');
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) { const y = cy + r * (0.02 + i * 0.14), h = r * (0.025 + i * 0.016); g.fillRect(cx - r, y, r * 2, h); }
  g.restore();
  return c;
}

// the disco's light-up dance floor: 8 x 8 tiles of neon colours (some dark), each with a hot centre and a grout edge;
// the floor scrolls it a whole tile at a time so the tiles change colour on the beat
export function danceFloor(seed = 19) {
  const S = 512, n = 8, t = S / n, c = canvas(S, S), g = ctx2d(c), rng = new RNG(seed);
  const cols = ['#ff3fa4', '#2fe0ff', '#ffe45c', '#c77dff', '#3dffb0', '#ff8a3c', '#fff4e6', '#1a1230', '#1a1230'];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const col = rng.pick(cols), gr = g.createRadialGradient(x * t + t / 2, y * t + t / 2, 2, x * t + t / 2, y * t + t / 2, t * 0.75);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, col); gr.addColorStop(1, col);
    g.fillStyle = col === '#1a1230' ? col : gr; g.fillRect(x * t, y * t, t, t);
    g.strokeStyle = 'rgba(10,6,20,0.9)'; g.lineWidth = 6; g.strokeRect(x * t + 1, y * t + 1, t - 2, t - 2);
  }
  return c;
}

// a long, soft synthwave cloud streak (512 x 128, white on transparent: tint it by vertex colour)
export function cloudStreak(seed = 4) {
  const W = 512, H = 128, c = canvas(W, H), g = ctx2d(c), rng = new RNG(seed);
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 14; i++) {
    const x = rng.range(60, W - 60), y = H * 0.5 + rng.range(-14, 14), rx = rng.range(60, 190), ry = rng.range(5, 16);
    const gr = g.createRadialGradient(x, y, 0, x, y, rx); gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rx, 0, Math.PI * 2); g.fill(); g.restore();
  }
  return c;
}

// an LED message board (1024 x 128): text in lit dots on black, for the blimp (scroll it along u)
export function ledBoard(text, color = '#ff3fa4', color2 = '#ffe45c') {
  const W = 1024, H = 128, c = canvas(W, H), g = ctx2d(c);
  g.fillStyle = '#05040a'; g.fillRect(0, 0, W, H);
  g.font = '900 86px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const parts = text.split('★');
  let x = 0; const ws = parts.map(p => g.measureText(p).width), star = 70, total = ws.reduce((a, b) => a + b, 0) + star * (parts.length - 1), sc = W / total;
  g.save(); g.scale(sc, 1);
  parts.forEach((p, i) => { g.fillStyle = i % 2 ? color2 : color; g.fillText(p, x + ws[i] / 2, 68); x += ws[i]; if (i < parts.length - 1) { g.fillStyle = '#2fe0ff'; g.fillText('★', x + star / 2, 66); x += star; } });
  g.restore();
  g.fillStyle = 'rgba(5,4,10,0.75)'; for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2); for (let k = 0; k < W; k += 6) g.fillRect(k, 0, 2, H);
  return c;
}

// ---------------- v0.4.8.5 quick patch 2: The Monster Mash ----------------
// small silhouettes shared by the court apron, the logo, the mural and the leaderboard (canvas units: s = overall size)
const BAT_R = [[0, -0.1], [0.06, -0.27], [0.11, -0.12], [0.3, -0.24], [0.55, -0.3], [0.8, -0.24], [1, -0.04], [0.88, 0.04], [0.8, 0.16], [0.7, 0.07], [0.56, 0.17], [0.44, 0.08], [0.3, 0.2], [0.18, 0.1], [0.08, 0.2], [0, 0.3]];
export function batShape(g, x, y, s, rot = 0, flap = 1) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s / 2, s / 2 * flap);
  g.beginPath(); BAT_R.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); for (let i = BAT_R.length - 2; i > 0; i--) g.lineTo(-BAT_R[i][0], BAT_R[i][1]);
  g.closePath(); g.fill(); g.restore();
}
// a pumpkin (w wide): ribbed, a stem; face: carve a jack-o'-lantern (the cuts filled with candlelight)
export function pumpkinShape(g, x, y, w, face = false, body = '#ff7a1a', glow = '#ffd23f') {
  g.save(); g.translate(x, y); g.scale(w / 2, w / 2);
  g.fillStyle = '#4a6a1a'; g.beginPath(); g.moveTo(-0.08, -0.62); g.quadraticCurveTo(0.02, -0.95, 0.22, -0.98); g.lineTo(0.24, -0.88); g.quadraticCurveTo(0.1, -0.84, 0.08, -0.6); g.closePath(); g.fill();
  for (const [ox, rx, k] of [[-0.5, 0.52, 0.72], [0.5, 0.52, 0.72], [-0.22, 0.5, 0.86], [0.22, 0.5, 0.86], [0, 0.42, 1]]) {
    g.fillStyle = body; g.beginPath(); g.ellipse(ox, 0, rx, 0.74, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(0,0,0,${(1 - k) * 0.9})`; g.fill();
  }
  if (face) {
    g.fillStyle = glow;
    g.beginPath(); g.moveTo(-0.52, -0.1); g.lineTo(-0.16, -0.12); g.lineTo(-0.32, -0.4); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(0.52, -0.1); g.lineTo(0.16, -0.12); g.lineTo(0.32, -0.4); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-0.08, 0.08); g.lineTo(0.08, 0.08); g.lineTo(0, -0.06); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-0.62, 0.2); g.quadraticCurveTo(0, 0.7, 0.62, 0.2); g.lineTo(0.44, 0.26); g.lineTo(0.36, 0.38); g.lineTo(0.26, 0.28); g.lineTo(0.08, 0.32); g.lineTo(0, 0.46); g.lineTo(-0.1, 0.32); g.lineTo(-0.26, 0.28); g.lineTo(-0.36, 0.38); g.lineTo(-0.44, 0.26); g.closePath(); g.fill();
  }
  g.restore();
}
function tombShape(g, x, y, w, h, stone = '#6a6478', ink = '#2a2430', crack = true) {
  g.save(); g.translate(x, y);
  g.fillStyle = stone; g.beginPath(); g.moveTo(-w / 2, h / 2); g.lineTo(-w / 2, -h / 2 + w / 2); g.arc(0, -h / 2 + w / 2, w / 2, Math.PI, 0); g.lineTo(w / 2, h / 2); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(w * 0.18, -h / 2 + w / 2, w * 0.32, h - w / 2);
  g.fillStyle = ink; g.font = `900 ${w * 0.3}px Georgia, "Times New Roman", serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RIP', 0, -h * 0.08);
  if (crack) { g.strokeStyle = ink; g.lineWidth = w * 0.05; g.beginPath(); g.moveTo(w * 0.32, -h / 2 + w * 0.2); g.lineTo(w * 0.08, -h * 0.05); g.lineTo(w * 0.2, h * 0.08); g.lineTo(-w * 0.06, h * 0.3); g.stroke(); }
  g.fillStyle = '#2f4a2a'; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * w * 0.22 - w * 0.06, h / 2); g.lineTo(i * w * 0.22, h / 2 - w * 0.22); g.lineTo(i * w * 0.22 + w * 0.06, h / 2); g.fill(); }
  g.restore();
}
function ghostShape(g, x, y, s, body = '#e8f4ee', eye = '#14081e') {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = body; g.beginPath(); g.moveTo(-0.4, 0.5); g.lineTo(-0.4, -0.1); g.arc(0, -0.1, 0.4, Math.PI, 0); g.lineTo(0.4, 0.5);
  for (let i = 0; i < 4; i++) { const a = 0.4 - i * 0.2; g.quadraticCurveTo(a - 0.05, 0.36, a - 0.1, 0.5); g.quadraticCurveTo(a - 0.15, 0.62, a - 0.2, 0.5); }
  g.closePath(); g.fill();
  g.fillStyle = eye; for (const sx of [-0.14, 0.14]) { g.beginPath(); g.ellipse(sx, -0.12, 0.07, 0.11, 0, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.ellipse(0, 0.12, 0.08, 0.1, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}
// a quarter cobweb in the corner (cx, cy), opening toward angle a0..a1, radius r
function cobwebShape(g, cx, cy, r, a0, a1, color, lw) {
  g.save(); g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
  const n = 6, rad = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; rad.push(a); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke(); }
  for (let k = 1; k <= 5; k++) {
    const rr = r * k / 5.4; g.beginPath();
    for (let i = 0; i < n; i++) { const p = [cx + Math.cos(rad[i]) * rr, cy + Math.sin(rad[i]) * rr], q = [cx + Math.cos(rad[i + 1]) * rr, cy + Math.sin(rad[i + 1]) * rr], m = (rad[i] + rad[i + 1]) / 2, sag = rr * 0.86;
      if (!i) g.moveTo(p[0], p[1]); g.quadraticCurveTo(cx + Math.cos(m) * sag, cy + Math.sin(m) * sag, q[0], q[1]); }
    g.stroke();
  }
  g.restore();
}

// the court logo: a jack-o'-lantern in front of a full moon on a graveyard hill, bats across the moon, inside a medallion
// with a pumpkin-orange ring and a slime-green one inside it. Unit space (radius 1)
export function drawJackLogo(g, logo, size) {
  const bg = logo.color || '#1a1026', orange = logo.accent || '#ff7a1a', green = logo.green || '#7cff4f', moon = logo.moon || '#f4efd6';
  g.save(); g.scale(size, size); g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fillStyle = bg; g.globalAlpha = logo.alpha ?? 0.97; g.fill(); g.globalAlpha = 1;
  g.save(); g.beginPath(); g.arc(0, 0, 0.9, 0, Math.PI * 2); g.clip();
  const sky = g.createLinearGradient(0, -0.9, 0, 0.6); sky.addColorStop(0, '#2e1a4e'); sky.addColorStop(1, bg); g.fillStyle = sky; g.fillRect(-1, -1, 2, 2);
  // the moon and its glow
  const mx = -0.16, my = -0.34, mr = 0.42;
  const gl = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 1.9); gl.addColorStop(0, 'rgba(240,236,200,0.45)'); gl.addColorStop(1, 'rgba(240,236,200,0)');
  g.fillStyle = gl; g.fillRect(-1, -1, 2, 2);
  g.fillStyle = moon; g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(160,150,130,0.35)'; for (const [a, b, r] of [[-0.12, -0.08, 0.13], [0.14, 0.06, 0.09], [0.04, -0.2, 0.07], [-0.2, 0.16, 0.06]]) { g.beginPath(); g.arc(mx + a, my + b, r, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#0e0812'; for (const [x, y, s, r] of [[-0.42, -0.46, 0.22, -0.2], [0.02, -0.56, 0.16, 0.15], [0.3, -0.3, 0.13, 0.3]]) batShape(g, x, y, s, r);
  // the hill with its graves
  g.fillStyle = '#120a1a'; g.beginPath(); g.moveTo(-1, 0.2); g.quadraticCurveTo(-0.4, -0.06, 0.2, 0.1); g.quadraticCurveTo(0.6, 0.18, 1, 0.02); g.lineTo(1, 1); g.lineTo(-1, 1); g.closePath(); g.fill();
  for (const [x, y, w, h] of [[-0.7, 0.08, 0.1, 0.16], [-0.52, 0.02, 0.08, 0.13], [0.62, 0.06, 0.09, 0.15]]) { g.beginPath(); g.moveTo(x - w / 2, y + h / 2); g.lineTo(x - w / 2, y - h / 2 + w / 2); g.arc(x, y - h / 2 + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w / 2, y + h / 2); g.fill(); }
  g.fillRect(0.76, -0.12, 0.025, 0.2); g.fillRect(0.72, -0.07, 0.1, 0.025); // a cross
  // the jack-o'-lantern, glowing from inside
  const glow = g.createRadialGradient(0, 0.1, 0.05, 0, 0.1, 0.8); glow.addColorStop(0, '#fff0a0'); glow.addColorStop(1, '#ff9a1a'); // (in the pumpkin's own frame)
  pumpkinShape(g, 0.02, 0.36, 1.1, true, orange, glow);
  g.restore();
  g.beginPath(); g.arc(0, 0, 0.955, 0, Math.PI * 2); g.lineWidth = 0.07; g.strokeStyle = orange; g.stroke();
  g.beginPath(); g.arc(0, 0, 0.9, 0, Math.PI * 2); g.lineWidth = 0.022; g.strokeStyle = green; g.stroke();
  g.restore();
}

// the apron: an iron-spike fence round its outer edge, cobwebs in its corners, and tombstones, bats, pumpkins and little
// ghosts scattered between the fence and the boundary line, standing "up" away from the court; clear of the baseline
// lettering and of the Got Next spots on the east side. spec.horror: {spikes, web, stone, bat, pumpkin, count}
function horrorApron(g, spec, W, L, margin) {
  const H = spec.horror, rng = new RNG((spec.seed || 3) * 13 + 5), cw = COURT.width / 2, cl = COURT.length / 2;
  // the fence: a rail and spikes pointing in, every 0.34 m
  const d = 0.2; g.fillStyle = H.spikes || '#120a18'; g.strokeStyle = H.spikes || '#120a18';
  for (const [x0, y0, x1, y1, nx, ny] of [[-W / 2, -L / 2 + d, W / 2, -L / 2 + d, 0, 1], [-W / 2, L / 2 - d, W / 2, L / 2 - d, 0, -1], [-W / 2 + d, -L / 2, -W / 2 + d, L / 2, 1, 0], [W / 2 - d, -L / 2, W / 2 - d, L / 2, -1, 0]]) {
    g.lineWidth = 0.05; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.lineWidth = 0.025; g.beginPath(); g.moveTo(x0 - nx * 0.1, y0 - ny * 0.1); g.lineTo(x1 - nx * 0.1, y1 - ny * 0.1); g.stroke();
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / 0.34), tx = (x1 - x0) / len, ty = (y1 - y0) / len;
    for (let i = 1; i < n; i++) {
      const px = x0 + tx * i * 0.34, py = y0 + ty * i * 0.34;
      g.beginPath(); g.moveTo(px - nx * 0.14, py - ny * 0.14); g.lineTo(px + nx * 0.12, py + ny * 0.12); g.stroke();
      g.beginPath(); g.moveTo(px + nx * 0.22, py + ny * 0.22); g.lineTo(px + nx * 0.12 + tx * 0.05, py + ny * 0.12 + ty * 0.05); g.lineTo(px + nx * 0.12 - tx * 0.05, py + ny * 0.12 - ty * 0.05); g.closePath(); g.fill();
    }
  }
  // cobwebs in the four outer corners
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const a0 = sx > 0 ? (sy > 0 ? Math.PI : Math.PI / 2) : (sy > 0 ? -Math.PI / 2 : 0); cobwebShape(g, sx * W / 2, sy * L / 2, 1.5, a0, a0 + Math.PI / 2, H.web || '#d8d4e8', 0.018); }
  // the scatter
  const inner = 0.3, outer = margin - 0.62, spots = [];
  for (let tries = 0, n = 0; n < (H.count || 40) && tries < 3000; tries++) {
    const side = rng.int(0, 3), dd = inner + rng.next() * (outer - inner);
    let x, y, nx = 0, ny = 0;
    if (side < 2) { x = (rng.next() * 2 - 1) * (cw + dd); y = (side ? 1 : -1) * (cl + dd); ny = side ? 1 : -1; } else { y = (rng.next() * 2 - 1) * (cl + dd); x = (side === 2 ? 1 : -1) * (cw + dd); nx = side === 2 ? 1 : -1; }
    if (Math.abs(y) > cl && Math.abs(x) < 4.9) continue;            // the baseline lettering
    if (x > cw && y > -10 && y < 12) continue;                       // the Got Next spots
    if (Math.abs(x) > W / 2 - 1.2 && Math.abs(y) > L / 2 - 1.2) continue; // the cobwebs
    if (spots.some(([a, b]) => Math.hypot(a - x, b - y) < 0.7)) continue;
    spots.push([x, y]); n++;
    g.save(); g.translate(x, y); g.rotate(Math.atan2(nx, -ny) + rng.range(-0.3, 0.3));
    const k = rng.int(0, 5);
    if (k < 2) tombShape(g, 0, 0, rng.range(0.24, 0.32), rng.range(0.34, 0.44), H.stone || '#6a6478', '#2a2430', rng.next() < 0.7);
    else if (k === 2) { g.fillStyle = H.bat || '#0e0812'; batShape(g, 0, 0, rng.range(0.38, 0.52), rng.range(-0.3, 0.3)); }
    else if (k === 3) pumpkinShape(g, 0, 0, rng.range(0.22, 0.3), rng.next() < 0.5, H.pumpkin || '#ff7a1a', '#ffd23f');
    else if (k === 4) ghostShape(g, 0, 0, rng.range(0.3, 0.4));
    else { g.fillStyle = H.web || '#d8d4e8'; g.beginPath(); g.arc(0, 0, 0.12, 0.6, Math.PI * 2 - 0.6); g.arc(0.08, 0, 0.1, Math.PI * 2 - 0.9, 0.9, true); g.fill(); } // a crescent moon
    g.restore();
  }
}

// baseline lettering for the Monster Mash: heavy letters in slime green with a dark outline and a pumpkin-orange drop
// shadow, slime dripping off the bottom of each letter. Drawn in the baseline's own frame (text centred on 0, 0)
function horrorLettering(g, text, color, H, seed) {
  const rng = new RNG(seed * 97 + 11);
  g.globalAlpha = 1; g.font = '900 0.52px Impact, "Arial Black", sans-serif'; g.lineJoin = 'round';
  const tw = g.measureText(text).width, sc = tw > 8.6 ? 8.6 / tw : 1; g.scale(sc, 1);
  g.fillStyle = H.shadow || '#ff7a1a'; g.fillText(text, 0.05, 0.05);
  // the drips first (under the outline), then the letters
  const drips = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' || rng.next() < 0.35) continue;
    const x0 = -tw / 2 + g.measureText(text.slice(0, i)).width, w = g.measureText(text[i]).width;
    drips.push([x0 + w * rng.range(0.25, 0.75), rng.range(0.08, 0.32), rng.range(0.035, 0.06)]);
  }
  for (const [x, len, w] of drips) { g.strokeStyle = H.outline || '#14081e'; g.lineWidth = w + 0.06; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, 0.1); g.lineTo(x, 0.18 + len); g.stroke(); }
  g.lineWidth = 0.08; g.strokeStyle = H.outline || '#14081e'; g.strokeText(text, 0, 0);
  g.fillStyle = color; g.fillText(text, 0, 0);
  for (const [x, len, w] of drips) { g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, 0.1); g.lineTo(x, 0.18 + len); g.stroke(); g.fillStyle = color; g.beginPath(); g.arc(x, 0.18 + len + w * 0.4, w * 0.85, 0, Math.PI * 2); g.fill(); }
}

// the full moon (512 x 512, transparent round it): a soft rim glow, the disc pale and creamy, darker seas, ringed craters
export function moonDisc(seed = 13) {
  const S = 512, c = canvas(S, S), g = ctx2d(c), rng = new RNG(seed), noise = makeNoise2D(seed), r = S * 0.4, cx = S / 2, cy = S / 2;
  g.clearRect(0, 0, S, S);
  const halo = g.createRadialGradient(cx, cy, r * 0.96, cx, cy, S / 2); halo.addColorStop(0, 'rgba(230,236,255,0.5)'); halo.addColorStop(1, 'rgba(200,215,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r, q = dx * dx + dy * dy;
    if (q > 1) continue;
    const sea = noise.fbm(dx * 2.2 + 3, dy * 2.2, 4), fine = noise(dx * 18, dy * 18) * 0.05;
    let v = 0.94 + fine - Math.max(0, sea + 0.05) * 0.55, limb = Math.sqrt(1 - q);
    v *= 0.8 + 0.2 * limb;
    const o = (y * S + x) * 4, a = Math.min(1, (1 - Math.sqrt(q)) * r * 0.9);
    d[o] = 255 * Math.min(1, v * 1.0); d[o + 1] = 255 * Math.min(1, v * 0.985); d[o + 2] = 255 * Math.min(1, v * 0.92); d[o + 3] = Math.max(d[o + 3], 255 * a);
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * r * 0.85, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr, s = rng.range(4, i < 4 ? 26 : 12);
    g.fillStyle = 'rgba(120,115,110,0.28)'; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,250,0.35)'; g.lineWidth = Math.max(1, s * 0.18); g.beginPath(); g.arc(x, y, s, Math.PI * 0.1, Math.PI * 1.1); g.stroke();
  }
  return c;
}

// the haunted town's ground (one tile = 6 m): dark earth, dry grass in tufts, fallen leaves, a few stones. {color, normal}
export function spookyGround(opts = {}) {
  const S = opts.size || 512, seed = opts.seed || 31, rng = new RNG(seed), noise = makeNoise2D(seed);
  const c = canvas(S, S), g = ctx2d(c), img = g.createImageData(S, S), d = img.data, Hh = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, n = noise.tile(x * 6 / S, y * 6 / S, 6, 4), m = noise.tile(x * 24 / S, y * 24 / S, 24, 2), gr = rng.next();
    const grass = Math.max(0, Math.min(1, (n + 0.1) * 2.4));
    const r = 0.25 + m * 0.05 + (gr - 0.5) * 0.06, v = [r * (1 - grass * 0.3) + grass * 0.27, r * 0.92 * (1 - grass * 0.2) + grass * 0.3, r * 0.78 * (1 - grass * 0.3) + grass * 0.16];
    const o = i * 4; d[o] = v[0] * 255; d[o + 1] = v[1] * 255; d[o + 2] = v[2] * 255; d[o + 3] = 255; Hh[i] = m * 0.6 + (gr - 0.5) * 0.3;
  }
  g.putImageData(img, 0, 0);
  // dry grass blades and fallen leaves (drawn over the base, wrapped at the edges)
  const wrapDo = (x, y, fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) if (x + ox > -40 && x + ox < S + 40 && y + oy > -40 && y + oy < S + 40) fn(x + ox, y + oy); };
  g.lineCap = 'round';
  for (let i = 0; i < 1600; i++) {
    const x = rng.next() * S, y = rng.next() * S, a = -Math.PI / 2 + rng.range(-0.9, 0.9), l = rng.range(5, 14);
    if (noise.tile(x * 6 / S, y * 6 / S, 6, 4) < -0.12) continue;
    g.strokeStyle = rng.pick(['#5a5a32', '#6a6438', '#4a5228', '#7a6c40', '#3e4626']); g.lineWidth = rng.range(1, 2.2);
    wrapDo(x, y, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
  for (let i = 0; i < 220; i++) {
    const x = rng.next() * S, y = rng.next() * S, a = rng.range(0, Math.PI), s = rng.range(3, 7);
    g.fillStyle = rng.pick(['#8a3a12', '#a85a1a', '#6a2a14', '#9a7a2a', '#5a3a1a', '#b8461a']);
    wrapDo(x, y, (px, py) => { g.save(); g.translate(px, py); g.rotate(a); g.beginPath(); g.ellipse(0, 0, s, s * 0.5, 0, 0, Math.PI * 2); g.fill(); g.restore(); });
  }
  for (let i = 0; i < 40; i++) { const x = rng.next() * S, y = rng.next() * S, s = rng.range(2, 5); g.fillStyle = rng.pick(['#6a6660', '#58544e']); wrapDo(x, y, (px, py) => { g.beginPath(); g.arc(px, py, s, 0, Math.PI * 2); g.fill(); }); }
  // (the normal: the base's lumps plus whatever got drawn on top, from its brightness)
  const top = g.getImageData(0, 0, S, S).data;
  for (let i = 0; i < S * S; i++) Hh[i] += (top[i * 4] + top[i * 4 + 1]) / 510 * 1.2;
  return { color: c, normal: heightToNormal(Hh, S, S, 1.4) };
}

// the town's walls, drawn to scale (one tile: 3 bays of 2.8 m by 2 floors of 3.4 m; map it in metres). kind 'siding':
// clapboard (white: tint it by vertex colour) with tall shuttered windows, some lit amber and orange behind; 'stone':
// coursed stone with pointed lancet windows, stained glass glowing in some. Returns {color, emissive}
export const HFACADE = { bays: 3, floors: 2, bayW: 2.8, floorH: 3.4 };
export function horrorFacade(opts = {}) {
  const ppm = opts.ppm || 44, { bays, floors, bayW, floorH } = HFACADE;
  const W = Math.round(bays * bayW * ppm), H = Math.round(floors * floorH * ppm), bw = W / bays, fh = H / floors;
  const c = canvas(W, H), e = canvas(W, H), g = ctx2d(c), ge = ctx2d(e), rng = new RNG(opts.seed || 66), noise = makeNoise2D((opts.seed || 66) + 1);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const lit = opts.lit ?? 0.4;
  const stone = opts.kind === 'stone';
  if (stone) {
    g.fillStyle = '#8a8892'; g.fillRect(0, 0, W, H);
    const course = 0.42 * ppm;
    for (let y = 0, row = 0; y < H; y += course, row++) {
      let x = -(row % 2) * 0.4 * ppm;
      while (x < W) { const w = rng.range(0.6, 1.25) * ppm, k = 0.78 + rng.next() * 0.3; g.fillStyle = `rgb(${138 * k},${136 * k},${146 * k})`; g.fillRect(x + 1.5, y + 1.5, w - 3, course - 3); x += w; }
    }
    // moss and damp streaks running down
    for (let i = 0; i < 60; i++) { const x = rng.next() * W, l = rng.range(0.4, 2.2) * ppm; g.fillStyle = rng.next() < 0.5 ? 'rgba(40,60,30,0.22)' : 'rgba(20,20,26,0.18)'; g.fillRect(x, H - l, rng.range(3, 12), l); }
  } else {
    g.fillStyle = '#ece6da'; g.fillRect(0, 0, W, H);
    const board = 0.2 * ppm;
    for (let y = 0; y < H; y += board) { g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(0, y, W, 2); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, y + 2, W, 1.5); }
    const im = g.getImageData(0, 0, W, H), dd = im.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = 0.9 + noise.tile(x * 6 / W, y * 6 / H, 6, 3) * 0.12 + (rng.next() - 0.5) * 0.04; const o = (y * W + x) * 4; dd[o] *= k; dd[o + 1] *= k; dd[o + 2] *= k; }
    g.putImageData(im, 0, 0);
  }
  const glows = ['#ffb050', '#ffb050', '#ff8a2a', '#ffd890', '#ffc070', '#9aff7a'], glass = ['#5a2a8a', '#2a8a4a', '#c87a1a', '#2a4a9a', '#8a1a3a'];
  for (let r = 0; r < (stone ? 1 : floors); r++) {
    const y0 = stone ? 0 : H - (r + 1) * fh, fh2 = stone ? H : fh; // (stone: one tall lancet per bay, the whole tile high)
    if (!stone) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y0, W, 0.16 * ppm); g.fillStyle = 'rgba(255,255,255,0.18)'; for (let x = 0; x < W; x += 0.22 * ppm) { g.beginPath(); g.arc(x + 0.11 * ppm, y0 + 0.16 * ppm, 0.08 * ppm, 0, Math.PI); g.fill(); } } // the frieze
    for (let b = 0; b < bays; b++) {
      const cx = b * bw + bw / 2, ww = (stone ? 1.1 : 1.0) * ppm, wh = (stone ? 4.0 : 1.8) * ppm, wy = y0 + fh2 - (stone ? 1.4 : 0.95) * ppm - wh, on = rng.next() < lit;
      const shape = gg => { gg.beginPath(); if (stone) { gg.moveTo(cx - ww / 2, wy + wh); gg.lineTo(cx - ww / 2, wy + ww * 0.6); gg.quadraticCurveTo(cx - ww / 2, wy, cx, wy - ww * 0.15); gg.quadraticCurveTo(cx + ww / 2, wy, cx + ww / 2, wy + ww * 0.6); gg.lineTo(cx + ww / 2, wy + wh); gg.closePath(); } else gg.rect(cx - ww / 2, wy, ww, wh); };
      // frame (and shutters on the clapboard)
      g.fillStyle = stone ? '#5a5862' : '#f4f0e8'; g.save(); g.translate(cx, wy + wh / 2); g.scale(1.16, 1.06); g.translate(-cx, -wy - wh / 2); shape(g); g.fill(); g.restore();
      if (!stone) for (const s of [-1, 1]) { g.fillStyle = '#2a2430'; g.fillRect(cx + s * (ww / 2 + 0.08 * ppm) - (s < 0 ? 0.36 * ppm : 0), wy, 0.36 * ppm, wh); g.fillStyle = 'rgba(255,255,255,0.08)'; for (let k = 1; k < 9; k++) g.fillRect(cx + s * (ww / 2 + 0.08 * ppm) - (s < 0 ? 0.36 * ppm : 0) + 3, wy + k * wh / 9, 0.36 * ppm - 6, 2); }
      const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, on ? '#5a3a20' : '#141824'); gr.addColorStop(1, on ? '#a0602a' : '#283040');
      g.fillStyle = gr; shape(g); g.fill();
      if (on) {
        ge.fillStyle = stone ? glass[rng.int(0, glass.length - 1)] : rng.pick(glows); ge.globalAlpha = 0.65 + rng.next() * 0.35; shape(ge); ge.fill(); ge.globalAlpha = 1;
        if (stone) { ge.strokeStyle = '#000'; ge.lineWidth = 3; for (let k = 1; k < 4; k++) { ge.beginPath(); ge.moveTo(cx - ww / 2, wy + k * wh / 4); ge.lineTo(cx + ww / 2, wy + k * wh / 4 - 8); ge.stroke(); } ge.beginPath(); ge.moveTo(cx, wy); ge.lineTo(cx, wy + wh); ge.stroke(); }
        else if (rng.next() < 0.45) { ge.fillStyle = 'rgba(0,0,0,0.75)'; ge.fillRect(cx - ww / 2, wy, ww * rng.range(0.3, 0.5), wh); } // a drawn curtain
        else if (rng.next() < 0.5) { ge.fillStyle = '#000'; ge.beginPath(); ge.ellipse(cx, wy + wh * 0.82, ww * 0.24, ww * 0.18, 0, 0, Math.PI * 2); ge.fill(); ge.fillStyle = '#ffb000'; ge.beginPath(); ge.moveTo(cx - ww * 0.12, wy + wh * 0.8); ge.lineTo(cx - ww * 0.04, wy + wh * 0.8); ge.lineTo(cx - ww * 0.08, wy + wh * 0.74); ge.fill(); ge.beginPath(); ge.moveTo(cx + ww * 0.12, wy + wh * 0.8); ge.lineTo(cx + ww * 0.04, wy + wh * 0.8); ge.lineTo(cx + ww * 0.08, wy + wh * 0.74); ge.fill(); } // a jack-o'-lantern on the sill
      }
      // the glazing bars
      g.fillStyle = stone ? '#3a3840' : '#e8e4dc'; g.fillRect(cx - 2, wy, 4, wh); g.fillRect(cx - ww / 2, wy + wh * 0.5 - 2, ww, 4);
      ge.fillStyle = '#000'; ge.fillRect(cx - 2.5, wy, 5, wh); ge.fillRect(cx - ww / 2, wy + wh * 0.5 - 2.5, ww, 5);
      g.fillStyle = stone ? '#6a6872' : '#f4f0e8'; g.fillRect(cx - ww / 2 - 0.12 * ppm, wy + wh, ww + 0.24 * ppm, 0.1 * ppm); // the sill
    }
  }
  return { color: c, emissive: e };
}

// the signs round the town (1024 x 1024 atlas, eight 1024 x 128 rows; horrorSignUV(key) → [u0, v0, uw, vh]). Each is a
// whole board: draw it on a quad (vertex colour sets how bright; the HAUNTED HOUSE one glows)
export const HORROR_SIGNS = ['HAUNTED HOUSE', 'FUNERAL HOME', 'PUMPKIN PATCH', 'CORN MAZE', 'HOLLOW HILL CEMETERY', 'TICKETS', 'TRICK OR TREAT', 'MONSTER MASH'];
export function horrorSignUV(key) { const i = Math.max(0, HORROR_SIGNS.indexOf(key)); return [0, i / 8, 1, 1 / 8]; }
export function horrorSigns() {
  const W = 1024, R = 128, c = canvas(W, R * 8), g = ctx2d(c), rng = new RNG(404);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const row = (i, fn) => { g.save(); g.translate(0, i * R); g.beginPath(); g.rect(0, 0, W, R); g.clip(); fn(); g.restore(); };
  const drip = (text, y, px, fill, out, dripCol, font = 'Impact, "Arial Black", sans-serif') => {
    g.font = `900 ${px}px ${font}`; const tw = Math.min(W - 60, g.measureText(text).width); g.save(); g.translate(W / 2, y); g.scale(Math.min(1, (W - 60) / g.measureText(text).width), 1);
    g.lineWidth = px * 0.14; g.strokeStyle = out; g.strokeText(text, 0, 0); g.fillStyle = fill; g.fillText(text, 0, 0);
    g.fillStyle = dripCol; for (let k = 0; k < 14; k++) { const x = rng.range(-tw / 2 + 10, tw / 2 - 10), l = rng.range(8, 26), w = rng.range(4, 8); g.fillRect(x - w / 2, px * 0.3, w, l); g.beginPath(); g.arc(x, px * 0.3 + l, w * 0.75, 0, Math.PI * 2); g.fill(); }
    g.restore();
  };
  row(0, () => { g.fillStyle = '#120818'; g.fillRect(0, 0, W, R); g.fillStyle = '#ffe9a0'; for (let x = 14; x < W; x += 28) for (const y of [8, R - 8]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); } drip('HAUNTED HOUSE', 62, 86, '#ff7a1a', '#3a0a0a', '#7cff4f'); });
  row(1, () => { g.fillStyle = '#10140f'; g.fillRect(0, 0, W, R); g.strokeStyle = '#c8b88a'; g.lineWidth = 4; g.strokeRect(10, 10, W - 20, R - 20); g.fillStyle = '#e8dcb8'; g.font = '700 70px Georgia, "Times New Roman", serif'; g.fillText('FUNERAL HOME', W / 2, R / 2 + 4); });
  row(2, () => { for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#5a3a22' : '#644228'; g.fillRect(0, k * 32, W, 31); } g.fillStyle = '#ff8a1a'; g.font = '900 78px "Comic Sans MS", "Trebuchet MS", Arial, sans-serif'; g.lineWidth = 8; g.strokeStyle = '#2a1408'; g.strokeText('PUMPKIN PATCH', W / 2, R / 2 + 4); g.fillText('PUMPKIN PATCH', W / 2, R / 2 + 4); });
  row(3, () => { for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#4a3a22' : '#54402a'; g.fillRect(0, k * 32, W, 31); } g.fillStyle = '#f0e0a0'; g.font = '900 64px "Comic Sans MS", "Trebuchet MS", Arial, sans-serif'; g.fillText('CORN MAZE', W * 0.3, R / 2 + 4); g.fillStyle = '#ff4a2a'; g.font = '900 40px "Comic Sans MS", "Trebuchet MS", Arial, sans-serif'; g.fillText('ENTER IF YOU DARE', W * 0.72, R / 2 + 4); });
  row(4, () => { g.fillStyle = '#0e0c12'; g.fillRect(0, 0, W, R); g.fillStyle = '#d8d0c0'; g.font = '700 64px Georgia, "Times New Roman", serif'; g.fillText('HOLLOW HILL CEMETERY', W / 2, R / 2 + 2); });
  row(5, () => { g.fillStyle = '#2a0a1a'; g.fillRect(0, 0, W, R); for (let x = 0; x < W; x += 64) { g.fillStyle = (x / 64) % 2 ? '#ff7a1a' : '#f4efd6'; g.fillRect(x, 0, 64, 18); } drip('TICKETS', 74, 76, '#f4efd6', '#14081e', '#ff7a1a'); });
  row(6, () => { g.fillStyle = '#1a0e24'; g.fillRect(0, 0, W, R); drip('TRICK OR TREAT', 62, 84, '#ff7a1a', '#14081e', '#ff7a1a'); });
  row(7, () => { g.fillStyle = '#0c0610'; g.fillRect(0, 0, W, R); drip('THE MONSTER MASH', 60, 86, '#7cff4f', '#14081e', '#7cff4f'); });
  return c;
}

// a quarter cobweb (256 x 256, white threads on transparent; its corner at the texture's top-left): draw it additive
export function cobweb() {
  const S = 256, c = canvas(S, S), g = ctx2d(c);
  g.clearRect(0, 0, S, S);
  cobwebShape(g, 0, 0, S * 0.98, 0, Math.PI / 2, 'rgba(255,255,255,0.95)', 2.2);
  return c;
}

// dry corn (256 x 512, transparent): three stalks with their long leaves, the tassels and an ear or two. Alpha-tested
export function cornStalks(seed = 8) {
  const W = 256, H = 512, c = canvas(W, H), g = ctx2d(c), rng = new RNG(seed);
  g.clearRect(0, 0, W, H); g.lineCap = 'round';
  for (const x0 of [52, 128, 204]) {
    const top = rng.range(20, 60), lean = rng.range(-14, 14), col = rng.pick(['#a8985a', '#9a8a4a', '#b8a868']);
    g.strokeStyle = col; g.lineWidth = 7; g.beginPath(); g.moveTo(x0, H); g.quadraticCurveTo(x0 + lean * 0.3, H * 0.5, x0 + lean, top); g.stroke();
    for (let k = 0; k < 7; k++) {
      const t = 0.15 + k * 0.11, y = H - (H - top) * t, x = x0 + lean * t * t, s = k % 2 ? 1 : -1, len = rng.range(50, 90);
      g.strokeStyle = rng.pick(['#8a7a40', '#a0904e', '#7a6a38', '#b4a462']); g.lineWidth = rng.range(5, 8);
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * len * 0.6, y - rng.range(20, 50), x + s * len, y + rng.range(10, 50)); g.stroke();
    }
    g.strokeStyle = '#c8b070'; g.lineWidth = 3; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x0 + lean, top); g.lineTo(x0 + lean + k * 9, top - 22 + Math.abs(k) * 6); g.stroke(); }
    g.fillStyle = '#c8a850'; g.beginPath(); g.ellipse(x0 + lean * 0.5 + 8, H * 0.55, 7, 20, 0.3, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// the mural on the west wall (1536 x 512): a monster-movie poster. A purple night, a huge moon, the haunted house on its
// hill, bats; a line of monster silhouettes dancing across the moon (a zombie, a mummy, a caped vampire, a sheet ghost, a
// skeleton, a werewolf howling); pumpkins along the bottom; THE MONSTER MASH dripping slime across the top
export function monsterMural() {
  const W = 1536, H = 512, c = canvas(W, H), g = ctx2d(c), rng = new RNG(1031);
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0c0618'); sky.addColorStop(0.6, '#3a1658'); sky.addColorStop(1, '#5a2a4a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,240,${rng.range(0.3, 0.9)})`; g.fillRect(rng.next() * W, rng.next() * H * 0.6, 2, 2); }
  const mx = W * 0.5, my = H * 0.6, mr = 210;
  const halo = g.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 1.6); halo.addColorStop(0, 'rgba(255,240,190,0.5)'); halo.addColorStop(1, 'rgba(255,240,190,0)');
  g.fillStyle = halo; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f6eec8'; g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(170,160,120,0.35)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(mx + rng.range(-150, 150), my + rng.range(-150, 100), rng.range(14, 50), 0, Math.PI * 2); g.fill(); }
  // the hills and the house on the left, a dead tree on the right
  g.fillStyle = '#12081a';
  g.beginPath(); g.moveTo(0, H * 0.72); g.quadraticCurveTo(W * 0.15, H * 0.45, W * 0.32, H * 0.7); g.quadraticCurveTo(W * 0.6, H * 0.86, W, H * 0.68); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
  const hx = W * 0.15, hy = H * 0.5;
  g.fillRect(hx - 70, hy - 60, 140, 70); g.beginPath(); g.moveTo(hx - 84, hy - 58); g.lineTo(hx, hy - 120); g.lineTo(hx + 84, hy - 58); g.fill();
  g.fillRect(hx + 40, hy - 150, 34, 100); g.beginPath(); g.moveTo(hx + 34, hy - 148); g.lineTo(hx + 57, hy - 200); g.lineTo(hx + 80, hy - 148); g.fill();
  g.fillStyle = '#ffb040'; for (const [x, y] of [[-40, -40], [-10, -40], [20, -40], [-40, -15], [20, -15], [50, -110]]) g.fillRect(hx + x, hy + y, 14, 18);
  g.strokeStyle = '#12081a'; g.lineCap = 'round';
  const branch = (x, y, a, l, w, d) => { const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); if (d > 0) { branch(x2, y2, a - rng.range(0.3, 0.7), l * 0.7, w * 0.65, d - 1); branch(x2, y2, a + rng.range(0.3, 0.7), l * 0.68, w * 0.65, d - 1); } };
  branch(W * 0.86, H * 0.74, -Math.PI / 2 - 0.1, 90, 18, 4);
  g.fillStyle = '#0e0812'; for (let i = 0; i < 9; i++) batShape(g, rng.range(W * 0.3, W * 0.75), rng.range(60, H * 0.45), rng.range(30, 60), rng.range(-0.4, 0.4));
  // the dancers: limbs are thick round strokes from joint to joint
  const fig = (x, y, s, P, extra) => {
    g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = '#0a0610'; g.fillStyle = '#0a0610'; g.lineCap = 'round'; g.lineJoin = 'round';
    const L = (pts, w) => { g.lineWidth = w; g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.stroke(); };
    L([[0, -60], [P.hip || 0, 0]], 22); // body
    for (const leg of P.legs) L(leg, 13);
    for (const arm of P.arms) L(arm, 10);
    g.beginPath(); g.arc(P.head?.[0] || 0, P.head?.[1] || -80, 16, 0, Math.PI * 2); g.fill();
    if (extra) extra(g);
    g.restore();
  };
  const base = H * 0.86;
  fig(W * 0.3, base, 1.15, { arms: [[[-4, -55], [26, -66], [52, -64]], [[4, -55], [30, -58], [56, -52]]], legs: [[[0, 0], [-14, 34], [-18, 66]], [[0, 0], [18, 30], [12, 66]]], head: [8, -80] }); // zombie
  fig(W * 0.39, base, 1.1, { arms: [[[-4, -55], [26, -55], [56, -56]], [[4, -50], [30, -46], [58, -46]]], legs: [[[0, 0], [-6, 34], [-8, 66]], [[0, 0], [10, 34], [12, 66]]] }, gg => { gg.strokeStyle = '#2a2030'; gg.lineWidth = 3; for (let k = 0; k < 8; k++) { gg.beginPath(); gg.moveTo(-12, -70 + k * 9); gg.lineTo(12, -64 + k * 9); gg.stroke(); } }); // mummy
  fig(W * 0.48, base, 1.2, { arms: [[[-4, -55], [-40, -70], [-70, -60]], [[4, -55], [40, -72], [70, -62]]], legs: [[[0, 0], [-10, 34], [-14, 66]], [[0, 0], [10, 34], [14, 66]]] }, gg => { gg.beginPath(); gg.moveTo(-70, -60); gg.lineTo(-20, -70); gg.lineTo(0, 40); gg.lineTo(-56, 20); gg.closePath(); gg.fill(); gg.beginPath(); gg.moveTo(70, -62); gg.lineTo(20, -70); gg.lineTo(0, 40); gg.lineTo(56, 20); gg.closePath(); gg.fill(); gg.beginPath(); gg.moveTo(-22, -74); gg.lineTo(-30, -104); gg.lineTo(-8, -80); gg.fill(); gg.beginPath(); gg.moveTo(22, -74); gg.lineTo(30, -104); gg.lineTo(8, -80); gg.fill(); }); // vampire
  g.fillStyle = '#e8f4ee'; ghostShape(g, W * 0.58, base - 70, 120, '#e8f4ee', '#0a0610'); // ghost
  fig(W * 0.67, base, 1.1, { arms: [[[-4, -55], [-24, -80], [-14, -108]], [[4, -55], [30, -40], [44, -64]]], legs: [[[0, 0], [-22, 26], [-14, 66]], [[0, 0], [26, 22], [30, 60]]] }, gg => { gg.strokeStyle = '#f0ece0'; gg.lineWidth = 3; for (let k = 0; k < 5; k++) { gg.beginPath(); gg.moveTo(-10, -52 + k * 9); gg.lineTo(10, -52 + k * 9); gg.stroke(); } gg.fillStyle = '#f0ece0'; for (const sx of [-6, 6]) { gg.beginPath(); gg.arc(sx, -82, 4, 0, Math.PI * 2); gg.fill(); } }); // skeleton
  fig(W * 0.77, base, 1.25, { arms: [[[-4, -55], [-26, -40], [-36, -20]], [[4, -55], [28, -42], [38, -24]]], legs: [[[0, 0], [-16, 30], [-6, 66]], [[0, 0], [16, 30], [22, 66]]], head: [8, -86] }, gg => { gg.beginPath(); gg.moveTo(0, -96); gg.lineTo(6, -126); gg.lineTo(16, -98); gg.fill(); gg.beginPath(); gg.moveTo(14, -86); gg.lineTo(40, -100); gg.lineTo(22, -76); gg.fill(); }); // werewolf, howling
  for (let i = 0; i < 9; i++) pumpkinShape(g, 60 + i * (W - 120) / 8 + rng.range(-20, 20), H - 30, rng.range(46, 70), i % 2 === 0, '#ff7a1a', '#ffd23f');
  // the title
  g.save(); g.translate(W / 2, 78); g.rotate(-0.02); g.font = '900 96px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.fillStyle = '#ff7a1a'; g.fillText('THE MONSTER MASH', 6, 6); g.lineWidth = 14; g.strokeStyle = '#14081e'; g.strokeText('THE MONSTER MASH', 0, 0); g.fillStyle = '#7cff4f'; g.fillText('THE MONSTER MASH', 0, 0);
  const tw = g.measureText('THE MONSTER MASH').width; g.fillStyle = '#7cff4f';
  for (let k = 0; k < 16; k++) { const x = rng.range(-tw / 2 + 20, tw / 2 - 20), l = rng.range(14, 50), w = rng.range(6, 11); g.fillRect(x - w / 2, 30, w, l); g.beginPath(); g.arc(x, 30 + l, w * 0.8, 0, Math.PI * 2); g.fill(); }
  g.restore();
  return c;
}

// ---------------- v0.4.8.5 quick patch 3: ICON status (game/iconfx.js) ----------------
// Plain pixel data ({width, height, data}), not canvases, so they build anywhere (the tests run without a DOM).
// The Icon badges' spectrum, round the colour wheel: the Hall of Fame pink, violet, blue, cyan and green, then a gold
// on the way back to pink (straight from green to pink the blend goes grey)
const ICON_SPECTRUM = [[255, 47, 179], [166, 59, 255], [61, 123, 255], [0, 229, 255], [56, 255, 156], [255, 214, 64], [255, 47, 179]];
export function iconSpectrum(t) {
  t = ((t % 1) + 1) % 1;
  const n = ICON_SPECTRUM.length - 1, f = t * n, i = Math.min(n - 1, Math.floor(f)), k = f - i, a = ICON_SPECTRUM[i], b = ICON_SPECTRUM[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
// value noise that wraps every px cells across and py cells down (so a strip of it scrolls without a seam)
function wrapNoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const h = (i, j) => { i = ((i % px) + px) % px; j = ((j % py) + py) % py; let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 1442695041); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function wrapFbm(x, y, px, py, seed, oct) {
  let v = 0, a = 0.5, n = 0;
  for (let k = 0; k < oct; k++) { v += a * wrapNoise(x, y, px, py, seed + k * 17); n += a; x *= 2; y *= 2; px *= 2; py *= 2; a *= 0.5; }
  return v / n;
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The ICON aura's atlas (u ranges): a solid white strip (the crackles and the floor pulse take their shape from their
// vertex colours), a strip of embers (violet glints in dark halos) and the flames: tongues of value noise three times
// taller than wide, warped, near-black in the heart, deep violet, a bright violet edge where a tongue meets the air.
// Everything repeats down the texture, so the aura scrolls it upward without a seam.
export const AURA_UV = { solid: 1 / 32, embers: [0.125, 0.25], flames: [0.3, 0.97] };
export function auraTexture(S = 256) {
  const W = S, H = S, d = new Uint8Array(W * H * 4), rng = new RNG(1616);
  const set = (x, y, r, g, b, a) => { const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 16; x++) set(x, y, 255, 255, 255, 255);
  const e0 = Math.round(W * 0.125), e1 = Math.round(W * 0.25), dots = [];
  for (let i = 0; i < 14; i++) dots.push({ x: rng.range(e0 + 5, e1 - 5), y: rng.range(0, H), r: rng.range(1.4, 2.6) * W / 256, dark: i % 4 === 3 });
  for (let y = 0; y < H; y++) for (let x = e0; x < e1; x++) {
    let a = 0, r = 0, g = 0, b = 0;
    for (const p of dots) {
      let dy = Math.abs(y + 0.5 - p.y); dy = Math.min(dy, H - dy);
      const dd = Math.hypot(x + 0.5 - p.x, dy * 0.7) / p.r;
      if (dd > 2.2) continue;
      if (p.dark) { const k = 1 - sstep(0.6, 1.6, dd); if (k * 0.9 > a) { a = k * 0.9; r = 18; g = 2; b = 34; } continue; }
      const core = 1 - sstep(0.2, 1.0, dd), ka = Math.max(core, (1 - sstep(0.9, 2.2, dd)) * 0.55);
      if (ka > a) { a = ka; const m = core / Math.max(ka, 1e-3); r = 30 + 200 * m; g = 6 + 150 * m; b = 60 + 195 * m; }
    }
    set(x, y, r, g, b, Math.round(a * 255));
  }
  const f0 = Math.round(W * 0.28), D = new Float32Array(W * H), colMean = new Float32Array(W);
  for (let y = 0; y < H; y++) for (let x = f0; x < W; x++) {
    const u = (x - f0) / (W - f0), v = y / H;
    const w = wrapFbm(u * 3, v * 2, 1e4, 2, 71, 3);
    const n = wrapFbm(u * 7 + (w - 0.5) * 3.2, v * 3 + (w - 0.5) * 0.8, 1e4, 3, 29, 4);
    D[y * W + x] = n * 0.82 + wrapFbm(u * 18 + w * 2, v * 8, 1e4, 8, 53, 2) * 0.18;
    colMean[x] += D[y * W + x] / H;
  }
  // (every column as dense as the next, on the whole: the texture only scrolls up, so a denser column would keep one
  // side of the aura heavier than the other for good)
  const mean = colMean.slice(f0).reduce((s, m) => s + m, 0) / (W - f0);
  for (let y = 0; y < H; y++) for (let x = f0; x < W; x++) {
    const u = (x - f0) / (W - f0), dens = D[y * W + x] - colMean[x] + mean;
    const a = sstep(0.43, 0.5, dens) * sstep(0, 0.05, u) * sstep(1, 0.95, u);
    const rim = 1 - sstep(0.46, 0.56, dens), core = sstep(0.52, 0.7, dens);
    set(x, y, Math.max(0, 12 + 150 * rim ** 1.6 - 8 * core), Math.max(0, 2 + 70 * rim ** 2.2), Math.max(0, 26 + 225 * rim ** 1.4 - 16 * core), Math.round(a * 255));
  }
  return { width: W, height: H, data: d };
}

// The ICON floor cursor's atlas, in quarters: top left the badge face (a stand-in medallion until the build's own Icon
// badge art is drawn in over it: game/iconfx.js), top right the spectrum rim (eight notches, so its turning shows),
// bottom left a soft glow (the cursor's vertex colours tint it), bottom right a thin ring (the team colour)
export function iconDecalAtlas(S = 512) {
  const Q = S / 2, d = new Uint8Array(S * S * 4);
  const set = (x, y, c, a) => { const i = (y * S + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = Math.max(0, Math.min(255, Math.round(a * 255))); };
  const GOLD = [233, 182, 56], WHITE = [246, 248, 252], INK = [12, 4, 26], W1 = [255, 255, 255];
  for (let y = 0; y < Q; y++) for (let x = 0; x < Q; x++) {
    const dx = (x + 0.5 - Q / 2) / (Q / 2), dy = (y + 0.5 - Q / 2) / (Q / 2), r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
    const spec = iconSpectrum(ang);
    if (r < 0.9) set(x, y, r > 0.8 ? GOLD : r > 0.42 ? WHITE : r > 0.36 ? GOLD : spec, sstep(0.9, 0.88, r));
    else set(x, y, INK, 0.55 * sstep(1.0, 0.9, r));
    const notch = Math.abs(((ang * 8) % 1) - 0.5) < 0.06 ? 0.25 : 1;
    const band = sstep(0.74, 0.8, r) * sstep(0.97, 0.91, r), line = sstep(0.7, 0.72, r) * sstep(0.745, 0.725, r);
    set(x + Q, y, line > band ? W1 : spec, Math.max(band * notch, line * 0.9));
    set(x, y + Q, W1, Math.max(0, 1 - r) ** 1.8);
    set(x + Q, y + Q, W1, sstep(0.86, 0.9, r) * sstep(0.98, 0.94, r));
  }
  return { width: S, height: S, data: d };
}
