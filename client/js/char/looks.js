// Texture painters for athletes: skin/face atlas, hair, jerseys/tops, shorts. All original artwork.
import { canvas } from '../gfx/textures.js';
import { RNG, makeNoise2D } from '../core/rng.js';
import { hexToRgb } from '../core/math.js';
import { FACE } from './athlete.js';

const rgbStr = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const shade = (c, k) => c.map(v => Math.max(0, Math.min(1, v * k)));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bmp = (x, c, w) => { const d = Math.abs(x - c); return d >= w ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / w)); };
const bmp2 = (x, y, cx, cy, rx, ry) => { const d = Math.hypot((x - cx) / rx, (y - cy) / ry); return d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * d)); };
const lerp = (a, b, t) => a + (b - a) * t;
const lum = c => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;

// Face-space (fx = x/0.8, fy = y on the unit head) → texel in the 2:1 equirect head atlas
function faceToPix(fx, fy, W) {
  const nx = fx * FACE.sx, ny = fy, nz = Math.sqrt(Math.max(0.0001, 1 - nx * nx - ny * ny));
  const n = nrm([nx, ny, nz]);
  let th = Math.atan2(n[2], -n[0]); if (th < 0) th += Math.PI * 2;
  return [th / (Math.PI * 2) * W, Math.acos(Math.max(-1, Math.min(1, n[1]))) / Math.PI * (W / 2)];
}

const faceCache = new Map();
const maskCache = new Map();
const U8 = v => Math.max(0, Math.min(255, Math.round(v * 255)));

// Skin-tone-independent masks for the head atlas, computed once per resolution and cached as bytes.
function featureMasks(W) {
  const key = 'feat' + W;
  if (maskCache.has(key)) return maskCache.get(key);
  const Hh = W / 2, N = W * Hh, F = FACE, sc = W / 1024;
  const names = ['grain', 'warm', 'fore', 'under', 'lash', 'inside', 'crease', 'car', 'nos', 'alar', 'lip', 'lipGrad', 'mline', 'corner'];
  const M = Object.fromEntries(names.map(k => [k, new Uint8Array(N)]));
  const noise = makeNoise2D(211);
  const cT = new Float32Array(W), sT = new Float32Array(W);
  for (let x = 0; x < W; x++) { const th = (x + 0.5) / W * Math.PI * 2; cT[x] = Math.cos(th); sT[x] = Math.sin(th); }
  const aa = 5 / Hh;
  for (let y = 0; y < Hh; y++) {
    const phi = (y + 0.5) / Hh * Math.PI, sP = Math.sin(phi), cP = Math.cos(phi);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nx = -cT[x] * sP, ny = cP, nz = sT[x] * sP;
      const fx = nx / F.sx, fy = ny, front = nz, ax = Math.abs(fx);
      const ff = sm(0.2, 0.6, front);
      const g = noise(x * 0.012 / sc, y * 0.012 / sc) * 0.05 + noise(x * 0.09 / sc, y * 0.09 / sc) * 0.025 + noise(x * 0.5 / sc, y * 0.5 / sc) * 0.018;
      M.grain[i] = U8(0.5 + g * 4);
      const warm = front < -0.3 && Math.abs(nx) < 0.75 ? 0 : ff * (bmp2(ax, fy, 0.56, F.eyeY - 0.26, 0.3, 0.22) * 0.55 + bmp2(fx, fy, 0, F.noseTip, 0.12, 0.13) * 0.6) + bmp(Math.abs(nx), 1, 0.25) * bmp(fy, -0.05, 0.35) * 0.5;
      M.warm[i] = U8(warm);
      M.fore[i] = U8(ff * bmp(fy, 0.42, 0.2));
      if (!(front > 0.4 && fy < 0.45 && fy > -0.72)) continue;
      let under = 0, lash = 0, inside = 0, crease = 0, car = 0, nos = 0, alar = 0;
      for (const s of [1, -1]) {
        const ox = fx - s * F.eyeX;
        const ex = ox / F.eyeW, ey = (fy - F.eyeY - 0.05 * ox * s) / F.eyeH;
        const alm = ex * ex + ey * ey / Math.max(0.15, 1 - 0.55 * ex * ex);
        under = Math.max(under, 0.12 * bmp2(fx, fy, s * F.eyeX, F.eyeY - 0.075, 0.17, 0.055) * ff);
        if (alm < 1.6 && front > 0.55) {
          const upper = ey > 0 ? bmp(alm, 1.0, 0.24) : 0, lower = ey < 0 ? bmp(alm, 1.0, 0.16) : 0;
          const outer = 0.65 + 0.35 * Math.max(0, ex);
          lash = Math.max(lash, Math.min(1, upper * 0.92 * outer + lower * 0.3));
          if (alm < 0.85) inside = 0.5;
        }
        crease = Math.max(crease, 0.5 * bmp2(fx, fy, s * F.eyeX, F.eyeY + 0.075, 0.17, 0.035) * ff);
        car = Math.max(car, 0.35 * bmp2(fx, fy, s * (F.eyeX - F.eyeW * 0.95), F.eyeY, 0.025, 0.02));
        nos = Math.max(nos, 0.5 * bmp2(fx, fy, s * 0.07, F.noseBase - 0.004, 0.04, 0.016));
        alar = Math.max(alar, 0.16 * bmp2(ax, fy, 0.21, F.noseBase + 0.045, 0.04, 0.06) * ff);
      }
      M.under[i] = U8(under); M.lash[i] = U8(lash); M.inside[i] = U8(inside); M.crease[i] = U8(crease); M.car[i] = U8(car); M.nos[i] = U8(nos); M.alar[i] = U8(alar);
      // lips
      const mw = F.mouthW;
      const bow = 0.006 * bmp(ax, 0.055, 0.05) - 0.004 * bmp(ax, 0, 0.03);
      const uTop = F.lipU + 0.028 + bow, mid = F.mouth, lBot = F.lipL - 0.032;
      const wU = mw * (1 - 0.45 * Math.max(0, (fy - mid) / (uTop - mid)) ** 2);
      const wL = mw * 0.9 * Math.sqrt(Math.max(0, 1 - ((fy - (mid + lBot) / 2) / ((mid - lBot) / 2 + 0.004)) ** 2));
      const inU = Math.min(sm(-aa, aa, uTop - fy), sm(-aa, aa, fy - mid), sm(-aa * 2, aa * 2, wU - ax));
      const inL = Math.min(sm(-aa, aa, mid - fy), sm(-aa, aa, fy - lBot), sm(-aa * 2, aa * 2, wL - ax));
      const k = Math.max(inU, inL) * (front > 0.7 ? 1 : 0) * (1 - sm(mw * 0.82, mw, ax) * 0.55);
      M.lip[i] = U8(k * 0.62);
      const grad = inL > inU ? 1.05 - 0.12 * sm(mid, lBot, fy) : 0.95 + 0.08 * sm(uTop, mid, fy);
      M.lipGrad[i] = U8((grad - 0.7) / 0.6);
      M.mline[i] = U8(0.45 * bmp(fy, mid - 0.012 * Math.min(1, (ax / mw) ** 2), 0.008) * (1 - sm(mw * 0.8, mw * 1.02, ax)) * (front > 0.7 ? 1 : 0));
      M.corner[i] = U8(0.12 * bmp2(ax, fy, mw, mid, 0.03, 0.025));
    }
  }
  maskCache.set(key, M);
  return M;
}
function scalpMask(W, style, model) {
  const key = 'scalp' + W + style;
  if (maskCache.has(key)) return maskCache.get(key);
  const Hh = W / 2, m = new Uint8Array(W * Hh), sc = W / 1024, noise = makeNoise2D(97);
  if (style !== 'bald') for (let y = 0; y < Hh * 0.75; y++) {
    const phi = (y + 0.5) / Hh * Math.PI, sP = Math.sin(phi), cP = Math.cos(phi);
    for (let x = 0; x < W; x++) {
      const th = (x + 0.5) / W * Math.PI * 2;
      const n = [-Math.cos(th) * sP, cP, Math.sin(th) * sP];
      const cov = model.hairCoverage(style, n);
      if (cov <= -0.04) continue;
      const k = Math.min(1, (cov + 0.04) * 7);
      const density = style === 'fade' ? (n[1] > 0.55 ? 0.95 : 0.15 + 0.75 * Math.max(0, (n[1] - 0.05) / 0.5)) : 0.92;
      const speck = noise(x * 1.4 / sc, y * 1.4 / sc) * 0.5 + 0.5;
      m[y * W + x] = U8(k * density * (0.55 + speck * 0.45));
    }
  }
  maskCache.set(key, m);
  return m;
}
function beardMask(W, beard) {
  const key = 'beard' + W + beard;
  if (maskCache.has(key)) return maskCache.get(key);
  const Hh = W / 2, m = new Uint8Array(W * Hh), sc = W / 1024, noise = makeNoise2D(53), F = FACE;
  if (beard !== 'none') for (let y = Math.floor(Hh * 0.4); y < Hh; y++) {
    const phi = (y + 0.5) / Hh * Math.PI, sP = Math.sin(phi), cP = Math.cos(phi);
    for (let x = 0; x < W; x++) {
      const th = (x + 0.5) / W * Math.PI * 2;
      const nx = -Math.cos(th) * sP, fy = cP, front = Math.sin(th) * sP, fx = nx / F.sx;
      const cheekLine = -0.06 - 0.32 * Math.max(0, front) - 0.05 * Math.max(0, 0.6 - Math.abs(nx));
      const mouthOpen = Math.abs(fy - F.mouth) < 0.05 && Math.abs(fx) < F.mouthW * 0.95 && front > 0.75;
      const jaw = fy < cheekLine && front > -0.25 && !mouthOpen && fy > -0.99;
      const must = fy < F.noseBase - 0.03 && fy > F.lipU + 0.035 && Math.abs(fx) < F.mouthW + 0.02 && front > 0.8;
      const goatee = Math.abs(fx) < 0.26 && fy < F.lipL - 0.03 && front > 0.45;
      if (!(beard === 'goatee' ? (goatee || must) : (jaw || must))) continue;
      const hn = noise(x * 3.1 / sc, y * 3.1 / sc) * 0.5 + 0.5, hn2 = noise(x * 1.2 / sc + 40, y * 1.2 / sc) * 0.5 + 0.5;
      const soft = sm(-0.005, 0.07, cheekLine - fy) * 0.8 + 0.2;
      const dens = beard === 'stubble' ? 0.18 * soft * (0.4 + hn) * 2.2 : (0.45 + 0.4 * hn2) * soft * (0.55 + 0.45 * hn) * 1.15;
      m[y * W + x] = U8(Math.min(1, dens));
    }
  }
  maskCache.set(key, m);
  return m;
}

// Head atlas (2:1 equirect): skin tone variation, warmth, eye area, lids & lashes, lips, nostrils,
// brows drawn hair-by-hair, stubble/beard and scalp hair. Original procedural artwork.
// Masks are shared; per player only a fast color composite runs.
export function paintFace(model, W = 1024) {
  const look = model.look;
  const key = [W, look.skin, look.hair, look.hair_color, look.beard].join('|');
  if (faceCache.has(key)) return faceCache.get(key);
  const Hh = W / 2, c = canvas(W, Hh), g = c.getContext('2d');
  const skin = hexToRgb(look.skin || '#a56945');
  const hair = hexToRgb(look.hair_color || '#201b19');
  const L = lum(skin);
  const M = featureMasks(W), S = scalpMask(W, look.hair || 'crop', model), Bm = beardMask(W, look.beard || 'none');
  const red = [skin[0] * 1.08 + 0.02, skin[1] * 0.9, skin[2] * 0.88];
  const lipBase = mix(shade(skin, 0.8 + L * 0.08), [0.5 * (0.45 + L), 0.24 * (0.45 + L), 0.24 * (0.45 + L)], 0.18 + L * 0.2);
  const crease = shade(skin, 0.84), lashC = [0.025, 0.02, 0.02], insideC = [0.45, 0.28, 0.28], carC = [0.72, 0.42, 0.42], nosC = [0.08, 0.04, 0.04];
  const stubble = look.beard === 'stubble';
  const warmK = 0.22 + 0.22 * L;
  const img = g.createImageData(W, Hh), d = img.data;
  const N = W * Hh, inv = 1 / 255;
  for (let i = 0; i < N; i++) {
    const gr = 1 + (M.grain[i] * inv - 0.5) / 4;
    let r = skin[0] * gr, gg = skin[1] * gr, b = skin[2] * gr;
    let k = M.warm[i] * inv * warmK; if (k) { r += (red[0] - r) * k; gg += (red[1] - gg) * k; b += (red[2] - b) * k; }
    k = 1 + 0.035 * M.fore[i] * inv; r *= k; gg *= k; b *= k;
    k = M.under[i] * inv; if (k) { r *= 1 - k; gg *= 1 - k; b *= 1 - k; }
    k = M.lash[i] * inv; if (k) { r += (lashC[0] - r) * k; gg += (lashC[1] - gg) * k; b += (lashC[2] - b) * k; }
    k = M.inside[i] * inv; if (k) { r += (insideC[0] - r) * k; gg += (insideC[1] - gg) * k; b += (insideC[2] - b) * k; }
    k = M.crease[i] * inv; if (k) { r += (crease[0] - r) * k; gg += (crease[1] - gg) * k; b += (crease[2] - b) * k; }
    k = M.car[i] * inv; if (k) { r += (carC[0] - r) * k; gg += (carC[1] - gg) * k; b += (carC[2] - b) * k; }
    k = M.nos[i] * inv; if (k) { r += (nosC[0] - r) * k; gg += (nosC[1] - gg) * k; b += (nosC[2] - b) * k; }
    k = M.alar[i] * inv; if (k) { r *= 1 - k; gg *= 1 - k; b *= 1 - k; }
    k = M.lip[i] * inv; if (k) { const gd = 0.7 + M.lipGrad[i] * inv * 0.6; r += (lipBase[0] * gd - r) * k; gg += (lipBase[1] * gd - gg) * k; b += (lipBase[2] * gd - b) * k; }
    k = M.mline[i] * inv; if (k) { r += (lipBase[0] * 0.5 - r) * k; gg += (lipBase[1] * 0.5 - gg) * k; b += (lipBase[2] * 0.5 - b) * k; }
    k = M.corner[i] * inv; if (k) { r *= 1 - k; gg *= 1 - k; b *= 1 - k; }
    k = S[i] * inv; if (k) { r += (hair[0] - r) * k; gg += (hair[1] - gg) * k; b += (hair[2] - b) * k; }
    k = Bm[i] * inv;
    if (k) {
      const tr = stubble ? r * 0.82 + (hair[0] - r * 0.82) * 0.35 : hair[0], tg = stubble ? gg * 0.82 + (hair[1] - gg * 0.82) * 0.35 : hair[1], tb = stubble ? b * 0.82 + (hair[2] - b * 0.82) * 0.35 : hair[2];
      r += (tr - r) * k; gg += (tg - gg) * k; b += (tb - b) * k;
    }
    const o = i * 4;
    d[o] = Math.min(255, r * 255); d[o + 1] = Math.min(255, gg * 255); d[o + 2] = Math.min(255, b * 255); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // eyebrows: individual hair strokes following the brow arc
  const rng = new RNG(97);
  const sc = W / 1024;
  const brow = mix(hair, shade(skin, 0.5), 0.15);
  g.lineCap = 'round';
  for (const s of [1, -1]) {
    for (let k = 0; k < 260; k++) {
      const t = Math.pow(rng.next(), 1.15);
      const fx = s * (FACE.eyeX - 0.2 + t * 0.42);
      const thick = 0.034 * (1 - t * 0.6);
      const fy = FACE.browY + Math.sin(Math.min(1, t * 1.2) * Math.PI) * 0.024 - t * 0.022 + (rng.next() - 0.5) * thick;
      const [px, py] = faceToPix(fx, fy, W);
      const ang = s > 0 ? lerp(1.15, 0.12, Math.min(1, t * 1.6)) + (rng.next() - 0.5) * 0.35 : Math.PI - lerp(1.15, 0.12, Math.min(1, t * 1.6)) + (rng.next() - 0.5) * 0.35;
      const len = (4 + rng.next() * 5) * sc;
      g.strokeStyle = rgbStr(brow, 0.18 + rng.next() * 0.32); g.lineWidth = (0.7 + rng.next() * 0.7) * sc;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(ang) * len, py - Math.sin(ang) * len * 0.55); g.stroke();
    }
  }
  faceCache.set(key, c);
  if (faceCache.size > 40) faceCache.delete(faceCache.keys().next().value);
  return c;
}

const bodyCache = new Map();
// Tileable body skin albedo (subtle mottling and grain)
export function paintBodySkin(skinHex, S = 256) {
  const key = skinHex + S;
  if (bodyCache.has(key)) return bodyCache.get(key);
  const skin = hexToRgb(skinHex || '#a56945');
  const noise = makeNoise2D(31);
  const c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n1 = noise.tile(x / S * 4, y / S * 4, 4, 3), n2 = noise.tile(x / S * 24, y / S * 24, 24, 2);
    const k = 1 + n1 * 0.06 + n2 * 0.03;
    const r = 1 + n1 * 0.02;
    const i = (y * S + x) * 4;
    d[i] = Math.min(255, skin[0] * k * r * 255); d[i + 1] = Math.min(255, skin[1] * k * 255); d[i + 2] = Math.min(255, skin[2] * k * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  bodyCache.set(key, c);
  return c;
}

function heightNormal(h, S, strength) {
  const out = new Uint8Array(S * S * 4);
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    out[i] = (-dx / l * 0.5 + 0.5) * 255; out[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out[i + 2] = (1 / l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return { width: S, height: S, data: out };
}
const detailCache = new Map();
// Tileable detail normal maps: 'skin' (pores + fine creases), 'mesh' (jersey perforations), 'knit' (tee/shorts weave), 'rib' (socks)
export function detailNormal(kind) {
  if (detailCache.has(kind)) return detailCache.get(kind);
  const S = kind === 'skin' ? 256 : 128;
  const h = new Float32Array(S * S), noise = makeNoise2D(kind.length * 13), rng = new RNG(kind.length * 7 + 3);
  if (kind === 'skin') {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = noise.tile(x / S * 16, y / S * 16, 16, 2) * 0.35 + noise.tile(x / S * 48, y / S * 48, 48, 1) * 0.2;
    for (let k = 0; k < 2600; k++) { // pores
      const px = rng.next() * S, py = rng.next() * S, r = 0.8 + rng.next() * 1.1;
      for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) {
        const dd = Math.hypot(xx, yy) / r; if (dd > 1) continue;
        const X = (Math.floor(px) + xx + S) % S, Y = (Math.floor(py) + yy + S) % S;
        h[Y * S + X] -= 0.5 * (1 - dd * dd);
      }
    }
  } else if (kind === 'mesh') {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const cx = (x % 8) - 3.5, cy = (y % 8) - 3.5 + ((Math.floor(x / 8) % 2) * 4 - 2) * 0;
      h[y * S + x] = Math.min(1, Math.hypot(cx, cy) / 2.6) * 0.8 + noise(x * 0.5, y * 0.5) * 0.08;
    }
  } else if (kind === 'knit') {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = Math.abs(Math.sin(x * Math.PI / 2)) * 0.25 + Math.abs(Math.sin((y + (x % 4 < 2 ? 1 : 0)) * Math.PI / 2)) * 0.25 + noise(x * 0.3, y * 0.3) * 0.12;
  } else { // rib
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = Math.abs(Math.sin(x * Math.PI / 4)) * 0.6 + noise(x * 0.4, y * 0.4) * 0.1;
  }
  const out = heightNormal(h, S, kind === 'skin' ? 1.2 : 1.6);
  detailCache.set(kind, out);
  return out;
}

const hairCache = new Map();
export function paintHair(look) {
  const key = (look.hair || 'crop') + (look.hair_color || '');
  if (hairCache.has(key)) return hairCache.get(key);
  const W = 256, c = canvas(W, W), g = c.getContext('2d');
  const col = hexToRgb(look.hair_color || '#201b19');
  const noise = makeNoise2D(17);
  const img = g.createImageData(W, W), d = img.data;
  const style = look.hair || 'crop';
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let k;
    if (style === 'cornrows') k = 0.7 + 0.45 * Math.abs(Math.sin(x / W * Math.PI * 14)) + noise(x * 0.5, y * 0.2) * 0.15;
    else if (style === 'twists') k = 0.75 + 0.35 * Math.abs(Math.sin((x + y * 0.4) * 0.35)) + noise(x * 0.4, y * 0.4) * 0.2;
    else if (style === 'waves') k = 0.8 + 0.3 * Math.sin(Math.hypot(x - 128, y - 40) * 0.5) + noise(x * 0.3, y * 0.3) * 0.15;
    else k = 0.8 + noise(x * 0.9, y * 0.12) * 0.35 + noise(x * 0.3, y * 0.3) * 0.15;
    // fine strands: brightness streaks + alpha that frays the hairline (alpha-tested against vertex alpha)
    const strand = noise(x * 1.6, y * 0.22) * 0.5 + 0.5;
    k *= 0.88 + strand * 0.24;
    const i = (y * W + x) * 4;
    d[i] = Math.min(255, col[0] * k * 255 + 4); d[i + 1] = Math.min(255, col[1] * k * 255 + 3); d[i + 2] = Math.min(255, col[2] * k * 255 + 3);
    d[i + 3] = Math.round(255 * Math.min(1, 0.4 + 0.6 * (noise(x * 2.3, y * 0.6) * 0.5 + 0.5)));
  }
  g.putImageData(img, 0, 0);
  hairCache.set(key, c);
  return c;
}

// Jersey / tee / hoodie texture. spec: {family,color,trim,secondary,pattern,lettering,number,name,keep(yf,phi),hem,neckTop}
export function paintTop(spec) {
  const W = 512, c = canvas(W, W), g = c.getContext('2d');
  const base = hexToRgb(spec.color || '#2a6fdb'), trim = hexToRgb(spec.trim || '#ffffff'), sec = hexToRgb(spec.secondary || spec.trim || '#ffffff');
  const fam = spec.family || 'jersey';
  const noise = makeNoise2D(5);
  const img = g.createImageData(W, W), d = img.data;
  const TH = 384, hem = spec.hem, top = spec.neckTop;
  const keep = spec.keep || (() => true);
  const mesh = fam === 'jersey';
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W;
    let col = base;
    if (y < TH) {
      const yf = top - (y / TH) * (top - hem), phi = u * Math.PI * 2 - Math.PI / 2;
      // trims near cut edges
      const dy = (top - hem) / TH * 7, dp = Math.PI * 2 / W * 7;
      const edge = keep(yf, phi) && (!keep(yf + dy, phi) || !keep(yf, phi + dp) || !keep(yf, phi - dp) || !keep(yf + dy, phi + dp) || !keep(yf + dy, phi - dp));
      if (spec.pattern === 'panel' && (Math.abs(u - 0.5) < 0.055 || u < 0.055 || u > 0.945)) col = sec;
      if (spec.pattern === 'stripes' && Math.floor(y / 22) % 2 === 0) col = mix(base, sec, 0.35);
      if (spec.pattern === 'gradient') col = mix(base, sec, Math.pow(y / TH, 1.6) * 0.8);
      if (spec.pattern === 'sash') { const k = (u - 0.18) * 1.6 - (y / TH) * 0.9; if (Math.abs(k) < 0.06 && u < 0.4) col = sec; }
      if (edge) col = trim;
      if (fam === 'jersey' && y > TH - 10) col = trim;
      if (fam === 'hoodie') {
        // kangaroo pocket on the front
        const pu = Math.abs(u - 0.25), pv = y / TH;
        if (pv > 0.62 && pv < 0.86 && pu < 0.085 + (pv - 0.62) * 0.15) col = shade(base, 0.9);
        if (pv > 0.86 && pv < 0.9) col = shade(base, 0.82);
      }
    } else {
      col = base;
      if (fam !== 'jersey') {
        const v = y / W;
        if ((v > 0.86 && v < 0.88) || v > 0.985) col = fam === 'hoodie' ? shade(base, 0.85) : trim;
      }
    }
    // fabric weave / mesh holes for jerseys
    let k = 1 + noise(x * 0.8, y * 0.8) * 0.04;
    if (mesh && ((x + y) % 4 === 0 && (x - y) % 4 === 0)) k *= 0.86;
    const i = (y * W + x) * 4;
    d[i] = Math.min(255, col[0] * k * 255); d[i + 1] = Math.min(255, col[1] * k * 255); d[i + 2] = Math.min(255, col[2] * k * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const aspect = spec.aspect || 0.88;
  const yOf = yf => (top - yf) / (top - hem) * TH;
  const font = n => `900 ${n}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
  const outlineText = (txt, x, y, size, fill, stroke, sx = aspect) => {
    g.save(); g.translate(x, y); g.scale(sx, 1);
    g.font = font(size); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (stroke) { g.lineJoin = 'round'; g.lineWidth = size * 0.14; g.strokeStyle = rgbStr(stroke); g.strokeText(txt, 0, 0); }
    g.fillStyle = rgbStr(fill); g.fillText(txt, 0, 0);
    g.restore();
  };
  const numFill = fam === 'jersey' ? trim : (spec.printColor ? hexToRgb(spec.printColor) : trim);
  const numStroke = fam === 'jersey' ? sec : null;
  if (fam === 'jersey') {
    const num = String(spec.number ?? 0);
    if (spec.lettering) outlineText(spec.lettering, W * 0.25, yOf(0.752), spec.lettering.length > 7 ? 30 : 38, numFill, numStroke);
    outlineText(num, W * 0.25, yOf(0.69), 74, numFill, numStroke);
    if (spec.name) outlineText(spec.name.toUpperCase().slice(0, 12), W * 0.75, yOf(0.775), 26, numFill, numStroke);
    outlineText(num, W * 0.75, yOf(0.705), 96, numFill, numStroke);
  } else if (fam === 'tee' || fam === 'hoodie') {
    if (spec.lettering) outlineText(spec.lettering, W * 0.25, yOf(fam === 'hoodie' ? 0.735 : 0.73), spec.lettering.length > 8 ? 26 : 34, numFill, null);
    if (spec.graphic) {
      g.save(); g.translate(W * 0.25, yOf(0.69)); g.scale(aspect, 1);
      g.strokeStyle = rgbStr(numFill); g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(-26, 0); g.lineTo(26, 0); g.moveTo(0, -26); g.lineTo(0, 26); g.stroke();
      g.restore();
    }
  }
  return c;
}

export function paintShorts(spec) {
  const W = 512, c = canvas(W, W), g = c.getContext('2d');
  const base = hexToRgb(spec.color || '#202833'), trim = hexToRgb(spec.trim || '#ffffff'), stripe = hexToRgb(spec.stripe || spec.trim || '#ffffff');
  const noise = makeNoise2D(9);
  const img = g.createImageData(W, W), d = img.data;
  const jog = spec.family === 'joggers';
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W;
    let col = base;
    if (v < 0.5) {
      if (v < 0.045) col = jog ? shade(base, 0.8) : trim;
      if (spec.stripe && (u < 0.03 || u > 0.97 || Math.abs(u - 0.5) < 0.03)) col = stripe;
    } else {
      const lu = u < 0.5 ? u * 2 : (u - 0.5) * 2; // local leg u
      const lateral = u < 0.5 ? Math.abs(lu - 0.5) : Math.min(lu, 1 - lu);
      if (spec.stripe && lateral < 0.06 && !jog) col = stripe;
      if (spec.stripe && lateral < 0.03 && jog) col = stripe;
      if (!jog && v > 0.955) col = trim;
      if (jog && v > 0.97) col = shade(base, 0.8);
    }
    const k = 1 + noise(x * 0.7, y * 0.7) * 0.05 + (jog ? noise(x * 0.05, y * 0.2) * 0.06 : 0);
    const i = (y * W + x) * 4;
    d[i] = Math.min(255, col[0] * k * 255); d[i + 1] = Math.min(255, col[1] * k * 255); d[i + 2] = Math.min(255, col[2] * k * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (spec.logo) {
    g.fillStyle = rgbStr(trim); g.font = '900 22px "Arial Black", sans-serif'; g.textAlign = 'center';
    g.fillText(spec.logo, W * 0.62, W * 0.62);
  }
  return c;
}

// v0.4.3 sneaker textures. Layout (see AthleteModel.buildShoe): x = lateral half then medial half, each
// heel → toe; y = top centre (laces) at the top, midsole top edge halfway down, sole centre at the bottom.
// Every model has its own original design language; colours come from the catalog item.
export function paintShoe(spec = {}) {
  const W = 1024, Hh = 512, c = canvas(W, Hh), g = c.getContext('2d');
  const model = spec.model || 'basic';
  const hex = (h, d) => h || d;
  const upper = hex(spec.color, '#f2f2f2'), accent = hex(spec.accent, '#d64933'), sole = hex(spec.sole, '#f5f5f0');
  const trim = hex(spec.trim, accent), lace = hex(spec.lace, lum(hexToRgb(upper)) > 0.55 ? '#f7f6f2' : '#1c1d21');
  const up = hexToRgb(upper), dark = lum(up) < 0.35;
  const panel = rgbStr(shade(up, dark ? 1.35 : 0.88)), lining = rgbStr(shade(up, dark ? 0.6 : 0.45));
  const outsole = spec.outsole || (model === 'retro' ? '#b98a4e' : lum(hexToRgb(sole)) > 0.5 ? rgbStr(shade(hexToRgb(sole), 0.62)) : '#141518');
  // (t, v) on one half → pixel
  const X = (half, t) => (half ? 0.508 : 0.008) * W + t * 0.484 * W, Y = v => (1 - v) * Hh;
  const poly = (half, pts, fill) => { g.beginPath(); pts.forEach(([t, v], i) => (i ? g.lineTo(X(half, t), Y(v)) : g.moveTo(X(half, t), Y(v)))); g.closePath(); g.fillStyle = fill; g.fill(); };
  const rect = (half, t0, v0, t1, v1, fill) => poly(half, [[t0, v0], [t1, v0], [t1, v1], [t0, v1]], fill);
  const line = (half, pts, stroke, w, dash) => { g.beginPath(); pts.forEach(([t, v], i) => (i ? g.lineTo(X(half, t), Y(v)) : g.moveTo(X(half, t), Y(v)))); g.strokeStyle = stroke; g.lineWidth = w; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); };
  const curve = (f, t0, t1, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const t = t0 + (t1 - t0) * i / n; return [t, f(t)]; });
  const dots = (half, t0, t1, v0, v1, step, col, r = 2.2) => { g.fillStyle = col; for (let t = t0; t <= t1; t += step) for (let v = v0; v <= v1; v += step * 1.7) { g.beginPath(); g.arc(X(half, t), Y(v), r, 0, 7); g.fill(); } };
  g.fillStyle = upper; g.fillRect(0, 0, W, Hh);
  for (const half of [0, 1]) { // 0 = lateral, 1 = medial
    const lat = half === 0, k = lat ? 1 : 0.8; // medial graphics are a touch smaller
    // sole unit: outsole with herringbone tread, midsole with a foxing line
    rect(half, 0, 0, 1, 0.245, outsole);
    g.save(); g.beginPath(); g.rect(X(half, 0), Y(0.22), X(half, 1) - X(half, 0), Y(0) - Y(0.22)); g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 3;
    for (let t = -0.2; t < 1.2; t += 0.035) { g.beginPath(); g.moveTo(X(half, t), Y(0.22)); g.lineTo(X(half, t + 0.06), Y(0.11)); g.lineTo(X(half, t), Y(0)); g.stroke(); }
    g.restore();
    rect(half, 0, 0.245, 1, 0.505, sole);
    if (model === 'strata') { const gr = g.createLinearGradient(0, Y(0.5), 0, Y(0.25)); gr.addColorStop(0, sole); gr.addColorStop(1, accent); g.fillStyle = gr; g.fillRect(X(half, 0), Y(0.505), X(half, 1) - X(half, 0), Y(0.245) - Y(0.505)); }
    line(half, [[0, 0.45], [1, 0.45]], model === 'legend' || model === 'basic' ? accent : 'rgba(0,0,0,0.22)', model === 'legend' || model === 'basic' ? 5 : 2);
    if (model === 'kinetic' || model === 'vanta') rect(half, 0.04, 0.3, 0.3, 0.42, 'rgba(255,255,255,0.18)'); // cushioning window
    // toe cap and heel counter
    poly(half, [...curve(t => 0.5 + 0.28 * Math.sqrt(Math.max(0, (t - 0.8) / 0.2)), 0.8, 1), [1, 1], [1, 0.5]], panel);
    const heelCol = model === 'basic' || model === 'kinetic' || model === 'legend' || model === 'rise' ? accent : panel;
    poly(half, [[0, 0.5], [0.19, 0.5], [0.15, 0.74], [0.07, 0.86], [0, 0.88]], heelCol);
    // collar lining and padded collar edge
    rect(half, 0, 0.93, 0.42, 1, lining);
    line(half, curve(t => 0.93 - 0.06 * smoothT(0.3, 0.42, t), 0, 0.42), panel, 6);
    // eyestay, tongue and laces across the top
    rect(half, 0.38, 0.84, 0.82, 1, panel);
    rect(half, 0.4, 0.89, 0.8, 1, model === 'retro' || model === 'rise' ? trim : rgbStr(shade(up, dark ? 1.15 : 0.95)));
    for (let t = 0.42; t < 0.79; t += 0.052) { line(half, [[t, 0.9], [t + 0.012, 1]], lace, 7); g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(X(half, t), Y(0.875), 3.2, 0, 7); g.fill(); }
    // model graphics on the side panel (v 0.52..0.86)
    switch (model) {
      case 'basic': { g.fillStyle = accent; g.beginPath(); g.arc(X(half, 0.3), Y(0.68), 13 * k, 0, 7); g.fill(); line(half, [[0.2, 0.56], [0.62, 0.56]], accent, 3); break; }
      case 'lateshift': {
        poly(half, [...curve(t => 0.62 + 0.05 * Math.sin(t * 9), 0.12, 0.76), ...curve(t => 0.69 + 0.05 * Math.sin(t * 9) + 0.02, 0.76, 0.12)], accent);
        rect(half, 0.8, 0.5, 1, 0.56, trim); break;
      }
      case 'rise': {
        poly(half, [[0, 0.5], [0.36, 0.5], [0.3, 0.8], [0.12, 0.9], [0, 0.9]], trim);
        poly(half, [[0.72, 0.5], [1, 0.5], [1, 0.7], [0.8, 0.82]], trim);
        poly(half, [[0.2, 0.72], [0.27, 0.72], [0.31, 1], [0.23, 1]], accent); // ankle strap
        line(half, [[0.36, 0.52], [0.3, 0.79], [0.12, 0.88]], 'rgba(0,0,0,0.35)', 2, [6, 5]); break;
      }
      case 'cutlow': {
        poly(half, [[0.14, 0.58], [0.58, 0.68], [0.6, 0.73], [0.14, 0.64]], accent);
        poly(half, [[0.14, 0.67], [0.56, 0.76], [0.57, 0.79], [0.14, 0.7]], accent);
        rect(half, 0.38, 0.82, 0.82, 0.86, trim); break;
      }
      case 'vanta': {
        poly(half, [...curve(t => 0.55 + 0.32 * Math.pow(t / 0.66, 1.6), 0.06, 0.66), [0.72, 0.86], ...curve(t => 0.55 + 0.12 * Math.pow(t / 0.72, 2.2), 0.72, 0.06)], accent);
        line(half, [[0.06, 0.53], [0.98, 0.53]], 'rgba(0,0,0,0.35)', 3); break;
      }
      case 'strata': {
        for (const [v, w] of [[0.57, 7], [0.63, 5], [0.68, 3.5]]) line(half, curve(t => v + 0.03 * t, 0.06, 0.88), accent, w * k);
        break;
      }
      case 'kinetic': {
        poly(half, [[0.06, 0.58], [0.3, 0.74], [0.36, 0.64], [0.66, 0.82], [0.62, 0.7], [0.36, 0.56], [0.3, 0.64]], accent);
        dots(half, 0.84, 0.97, 0.58, 0.74, 0.03, 'rgba(0,0,0,0.35)');
        rect(half, 0, 0.88, 0.4, 0.93, accent); break;
      }
      case 'retro': {
        poly(half, [[0.08, 0.6], [0.4, 0.84], [0.6, 0.84], [0.32, 0.6]], trim === upper ? accent : trim);
        line(half, [[0.08, 0.6], [0.4, 0.84]], 'rgba(0,0,0,0.3)', 2, [5, 4]);
        dots(half, 0.82, 0.97, 0.6, 0.78, 0.028, 'rgba(0,0,0,0.3)', 2.6);
        g.fillStyle = accent; g.font = `900 ${Math.round(26 * k)}px "Arial Black", sans-serif`; g.textAlign = 'center'; g.fillText('16', X(half, 0.12), Y(0.62)); break;
      }
      case 'legend': {
        for (const v of [0.58, 0.61]) line(half, [[0.18, v], [0.8, v + 0.04]], accent, 3);
        const cx = X(half, 0.36), cy = Y(0.72), R = 26 * k; g.fillStyle = accent; g.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? R * 0.45 : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        g.closePath(); g.fill(); break;
      }
    }
    // stitching along the toe cap and the eyestay, and a small original "AH" tab on the heel
    line(half, curve(t => 0.5 + 0.28 * Math.sqrt(Math.max(0, (t - 0.8) / 0.2)) - 0.015, 0.8, 1), 'rgba(0,0,0,0.3)', 1.5, [4, 4]);
    line(half, [[0.38, 0.84], [0.82, 0.84]], 'rgba(0,0,0,0.25)', 1.5, [4, 4]);
    if (lat) { g.fillStyle = lum(hexToRgb(heelCol.startsWith('#') ? heelCol : upper)) > 0.5 ? '#16171a' : '#f4f2ec'; g.font = '900 16px "Arial Black", sans-serif'; g.textAlign = 'center'; g.fillText('AH', X(half, 0.05), Y(0.7)); }
  }
  // fine leather / mesh grain
  const img = g.getImageData(0, 0, W, Hh), d = img.data, noise = makeNoise2D(17);
  for (let y = 0; y < Hh; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4, k = 1 + noise(x * 0.9, y * 0.9) * 0.035;
    d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
  }
  g.putImageData(img, 0, 0);
  return c;
}
function smoothT(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// v0.4.4 chain textures. paintChain: one tile of 4 links (u repeats along the chain, v goes round the tube).
// Gold: polished Cuban links with bright edges and dark gaps. Iced: white-gold links paved with stones. The
// iced version also returns an emissive "glint" map so the stones sparkle under the bloom.
export function paintChain(kind) {
  const W = 256, Hh = 64, c = canvas(W, Hh), g = c.getContext('2d');
  const iced = kind === 'ice';
  const e = iced ? canvas(W, Hh) : null, ge = e && e.getContext('2d');
  g.fillStyle = iced ? '#6f7680' : '#4a3209'; g.fillRect(0, 0, W, Hh);
  if (ge) { ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hh); }
  const n = 4, lw = W / n;
  for (let i = 0; i < n; i++) {
    const cx = lw * (i + 0.5), tilt = i % 2 ? 0.35 : -0.35;
    g.save(); g.translate(cx, Hh / 2); g.rotate(tilt);
    const grd = g.createLinearGradient(0, -Hh * 0.45, 0, Hh * 0.45);
    if (iced) { grd.addColorStop(0, '#f4f7fb'); grd.addColorStop(0.5, '#c9d0d8'); grd.addColorStop(1, '#8c949e'); }
    else { grd.addColorStop(0, '#fff1b0'); grd.addColorStop(0.35, '#f2c650'); grd.addColorStop(0.7, '#c9902a'); grd.addColorStop(1, '#7c560f'); }
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(0, 0, lw * 0.62, Hh * 0.46, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = iced ? '#5a616b' : '#5a3d0a';
    g.beginPath(); g.ellipse(0, 0, lw * 0.34, Hh * 0.17, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = iced ? 'rgba(255,255,255,0.7)' : 'rgba(255,248,210,0.85)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(0, 0, lw * 0.55, Hh * 0.39, 0, Math.PI * 1.1, Math.PI * 1.75); g.stroke();
    g.restore();
    if (iced) {
      // pavé stones over the link
      for (let k = 0; k < 26; k++) {
        const a = (k / 26) * Math.PI * 2, rr = 0.48 + 0.12 * ((k * 7) % 3);
        const x = cx + Math.cos(a) * lw * 0.5 * rr, y = Hh / 2 + Math.sin(a) * Hh * 0.36 * rr;
        const sz = 2.6 + (k % 3) * 0.6;
        g.fillStyle = ['#ffffff', '#e8f4ff', '#f6f9ff', '#dfe9ff'][k % 4];
        g.beginPath(); g.arc(x, y, sz, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(120,140,170,0.6)'; g.beginPath(); g.arc(x + 0.8, y + 0.8, sz * 0.45, 0, Math.PI * 2); g.fill();
        if (k % 3 === 0) { ge.fillStyle = k % 2 ? '#ffffff' : '#bfe2ff'; ge.beginPath(); ge.arc(x - 0.5, y - 0.5, 1.6, 0, Math.PI * 2); ge.fill(); }
      }
    }
  }
  return { color: c, emissive: e };
}

// medallion face: gold with a raised rim and an original "16" mark, or an iced-out stone pattern
export function paintPendant(kind) {
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  const iced = kind === 'ice';
  const e = iced ? canvas(S, S) : null, ge = e && e.getContext('2d');
  if (ge) { ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S); }
  const grd = g.createRadialGradient(S * 0.38, S * 0.32, 10, S / 2, S / 2, S * 0.55);
  if (iced) { grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.6, '#cfd6df'); grd.addColorStop(1, '#7d8692'); }
  else { grd.addColorStop(0, '#fff3b8'); grd.addColorStop(0.5, '#e9b94a'); grd.addColorStop(1, '#8d6414'); }
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.lineWidth = 16; g.strokeStyle = iced ? '#e9eef5' : '#f7d777'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4; g.strokeStyle = iced ? '#7c8591' : '#8a5f12'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2); g.stroke();
  if (iced) {
    for (let ring = 0; ring < 6; ring++) {
      const rr = S * (0.06 + ring * 0.065), cnt = Math.max(1, Math.round(ring * 7.5));
      for (let k = 0; k < cnt; k++) {
        const a = (k / cnt) * Math.PI * 2 + ring * 0.3, x = S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr, sz = 9 - ring * 0.6;
        g.fillStyle = ['#ffffff', '#eaf6ff', '#f9fbff'][k % 3]; g.beginPath(); g.arc(x, y, sz, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(110,130,160,0.7)'; g.lineWidth = 1.5; g.stroke();
        if ((k + ring) % 3 === 0) { ge.fillStyle = '#ffffff'; ge.beginPath(); ge.arc(x - 2, y - 2, 3, 0, Math.PI * 2); ge.fill(); }
      }
    }
  } else {
    g.fillStyle = '#7a520c'; g.font = '900 104px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('16', S / 2 + 4, S / 2 + 6);
    g.fillStyle = '#ffe59a'; g.fillText('16', S / 2, S / 2);
  }
  return { color: c, emissive: e };
}
