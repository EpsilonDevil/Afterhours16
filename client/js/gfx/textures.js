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

export function drawLogo(g, logo, x, y, size) {
  g.save(); g.translate(x, y);
  const shape = logo.shape || 'circle';
  if (shape === 'sphinx') { if (logo.rotate) g.rotate(logo.rotate); drawSphinx(g, logo, size); g.restore(); return; }
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

// Building facade with windows; lit ratio controls emissive look (returns color + emissive canvases)
export function facade(opts = {}) {
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
