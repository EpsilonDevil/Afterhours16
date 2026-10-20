// Texture painters for athletes: skin/face atlas, hair, jerseys/tops, shorts. All original artwork.
import { canvas } from '../gfx/textures.js';
import { RNG, makeNoise2D } from '../core/rng.js';
import { hexToRgb } from '../core/math.js';
import { FACE, SHOE_STRAP, torsoTable } from './athlete.js';

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
// v0.4.5 stage 7: `spec.res` paints at a lower resolution for far-away players (256 = a quarter of the
// pixels), and the cut-edge trim reads a precomputed keep-mask instead of calling keep() six times a pixel
// v0.4.8.7 The Favelas: the Morro Kit's stripes round the body (u 0..1 all the way round: green, a sunflower stripe,
// green, a sky-blue one, twelve times round), faded by the sun (paler toward the shoulders, and unevenly: n is noise)
export function morroStripe(u, base, st, yf, n) {
  const q = ((u * 12) % 1 + 1) % 1, c = q < 0.16 ? st[0] : q > 0.5 && q < 0.62 ? st[1] : base;
  return mix(c, [0.96, 0.93, 0.85], Math.max(0, 0.1 + 0.14 * (1 - yf) + 0.06 * n));
}
// and its painted tiles (lx, ly 0..1 across one): a blue border, a four-petal flower round a cream eye in the middle,
// quarter rings and a dot in the corners (four tiles meet in a ring round a dot), the rest bare cream glaze
export function morroTile(lx, ly, glaze, ink) {
  const dx = lx - 0.5, dy = ly - 0.5, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
  const border = Math.min(lx, 1 - lx, ly, 1 - ly) < 0.05;
  const petal = r > 0.07 && r < 0.13 + 0.19 * Math.pow(Math.abs(Math.cos(2 * a)), 1.5);
  const cr = Math.min(Math.hypot(lx, ly), Math.hypot(1 - lx, ly), Math.hypot(lx, 1 - ly), Math.hypot(1 - lx, 1 - ly));
  return border || petal || (cr > 0.17 && cr < 0.25) || cr < 0.08 ? ink : glaze;
}

export function paintTop(spec) {
  const W = spec.res || 512, S = W / 512, c = canvas(W, W), g = c.getContext('2d');
  const base = hexToRgb(spec.color || '#2a6fdb'), trim = hexToRgb(spec.trim || '#ffffff'), sec = hexToRgb(spec.secondary || spec.trim || '#ffffff');
  const fam = spec.family || 'jersey';
  const noise = makeNoise2D(5);
  const img = g.createImageData(W, W), d = img.data;
  const TH = Math.round(384 * S), hem = spec.hem, top = spec.neckTop;
  const keep = spec.keep || (() => true);
  // v0.4.8.7 The Favelas: the Morro Kit (pattern 'morro'): sun-faded stripes and a band of painted tiles round the hem; a
  // football shirt's open mesh
  const morro = spec.pattern === 'morro', mst = morro ? (spec.stripes || ['#efc64a', '#2f6fb3']).map(hexToRgb) : null;
  const cream = hexToRgb(spec.trim || '#f3ead2'), tileInk = hexToRgb(spec.tile || '#2453a6');
  const mesh = fam === 'jersey' || morro, E = Math.max(2, Math.round(7 * S)), hole = Math.max(2, Math.round(4 * S));
  // keep-mask for rows -E .. TH-1 (the trim looks E pixels up and to either side)
  const K = new Uint8Array((TH + E) * W);
  for (let r = 0; r < TH + E; r++) {
    const yf = top - ((r - E) / TH) * (top - hem);
    for (let x = 0; x < W; x++) K[r * W + x] = keep(yf, (x / W) * Math.PI * 2 - Math.PI / 2) ? 1 : 0;
  }
  const kAt = (x, y) => K[(y + E) * W + ((x % W) + W) % W];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W;
    let col = base;
    if (y < TH) {
      // trims near cut edges
      const edge = kAt(x, y) && (!kAt(x, y - E) || !kAt(x + E, y) || !kAt(x - E, y) || !kAt(x + E, y - E) || !kAt(x - E, y - E));
      if (spec.pattern === 'panel' && (Math.abs(u - 0.5) < 0.055 || u < 0.055 || u > 0.945)) col = sec;
      if (spec.pattern === 'stripes' && Math.floor(y / (22 * S)) % 2 === 0) col = mix(base, sec, 0.35);
      if (spec.pattern === 'gradient') col = mix(base, sec, Math.pow(y / TH, 1.6) * 0.8);
      if (spec.pattern === 'sash') { const k = (u - 0.18) * 1.6 - (y / TH) * 0.9; if (Math.abs(k) < 0.06 && u < 0.4) col = sec; }
      if (morro) { col = morroStripe(u, base, mst, y / TH, noise(x * 0.02 / S, y * 0.03 / S)); if (y > TH - 52 * S && y < TH - 8 * S) col = morroTile((u * 24) % 1, ((y - (TH - 52 * S)) / (22 * S)) % 1, cream, tileInk) || col; }
      if (edge) col = trim;
      if (fam === 'jersey' && y > TH - 10 * S) col = trim;
      if (fam === 'hoodie') {
        // kangaroo pocket on the front
        const pu = Math.abs(u - 0.25), pv = y / TH;
        if (pv > 0.62 && pv < 0.86 && pu < 0.085 + (pv - 0.62) * 0.15) col = shade(base, 0.9);
        if (pv > 0.86 && pv < 0.9) col = shade(base, 0.82);
      }
    } else {
      col = morro ? morroStripe(u, base, mst, 0, noise(x * 0.02 / S, y * 0.03 / S)) : base;
      if (fam !== 'jersey') {
        const v = y / W;
        if ((v > 0.86 && v < 0.88) || v > 0.985) col = fam === 'hoodie' ? shade(base, 0.85) : trim;
      }
    }
    // fabric weave / mesh holes for jerseys
    let k = 1 + noise(x * 0.8 / S, y * 0.8 / S) * 0.04;
    if (mesh && ((x + y) % hole === 0 && (x - y) % hole === 0)) k *= 0.86;
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
  if (morro) {
    // (a football shirt: the name across the chest and a small number over the heart; the big number on the back)
    const num = String(spec.number ?? 0);
    if (spec.lettering) outlineText(spec.lettering, W * 0.25, yOf(0.735), 30 * S, trim, sec);
    outlineText(num, W * 0.33, yOf(0.775), 26 * S, trim, sec);
    if (spec.name) outlineText(spec.name.toUpperCase().slice(0, 12), W * 0.75, yOf(0.775), 24 * S, trim, sec);
    outlineText(num, W * 0.75, yOf(0.705), 92 * S, trim, sec);
  } else if (fam === 'jersey') {
    const num = String(spec.number ?? 0);
    if (spec.lettering) outlineText(spec.lettering, W * 0.25, yOf(0.752), (spec.lettering.length > 7 ? 30 : 38) * S, numFill, numStroke);
    outlineText(num, W * 0.25, yOf(0.69), 74 * S, numFill, numStroke);
    if (spec.name) outlineText(spec.name.toUpperCase().slice(0, 12), W * 0.75, yOf(0.775), 26 * S, numFill, numStroke);
    outlineText(num, W * 0.75, yOf(0.705), 96 * S, numFill, numStroke);
  } else if (fam === 'tee' || fam === 'hoodie') {
    if (spec.lettering) outlineText(spec.lettering, W * 0.25, yOf(fam === 'hoodie' ? 0.735 : 0.73), (spec.lettering.length > 8 ? 26 : 34) * S, numFill, null);
    if (spec.graphic) {
      g.save(); g.translate(W * 0.25, yOf(0.69)); g.scale(aspect, 1);
      g.strokeStyle = rgbStr(numFill); g.lineWidth = 5 * S; g.beginPath(); g.arc(0, 0, 26 * S, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(-26 * S, 0); g.lineTo(26 * S, 0); g.moveTo(0, -26 * S); g.lineTo(0, 26 * S); g.stroke();
      g.restore();
    }
  }
  return c;
}

// v0.4.5 King Tut Cup mo-cap suit: glowing seams and tracking markers drawn over a black suit. With
// `mask` the same marks are drawn alone on black — that canvas is the suit's emissive (glow) map.
function mocapMarks(g, W, spec, kind, mask) {
  const glow = mask ? '#ffffff' : (spec.glow || spec.trim || '#39ff88');
  g.save();
  g.strokeStyle = glow; g.fillStyle = glow; g.lineCap = 'round';
  const line = (x0, y0, x1, y1, w = 5) => { g.lineWidth = w; g.beginPath(); g.moveTo(x0 * W, y0 * W); g.lineTo(x1 * W, y1 * W); g.stroke(); };
  const dot = (x, y, r = 9) => {
    if (!mask) { g.fillStyle = '#d8dde4'; g.beginPath(); g.arc(x * W, y * W, r + 3, 0, Math.PI * 2); g.fill(); g.fillStyle = glow; }
    g.beginPath(); g.arc(x * W, y * W, r, 0, Math.PI * 2); g.fill();
  };
  if (kind === 'top') {
    // torso (v 0..0.75): front center u .25, back center u .75, sides u 0 / .5
    for (const u of [0.19, 0.31]) line(u, 0.02, u, 0.74);              // front seams
    line(0.75, 0.02, 0.75, 0.74, 6);                                   // spine
    for (const u of [0.005, 0.5, 0.995]) line(u, 0.08, u, 0.74, 4);   // side seams
    line(0, 0.2, 1, 0.2, 4); line(0, 0.5, 1, 0.5, 4);                   // chest and waist bands
    for (const [u, v] of [[0.25, 0.12], [0.25, 0.36], [0.25, 0.6], [0.75, 0.1], [0.75, 0.32], [0.75, 0.58], [0.1, 0.05], [0.4, 0.05], [0.6, 0.05], [0.9, 0.05], [0.04, 0.66], [0.46, 0.66]]) dot(u, v);
    // sleeves (v .78-1.0, left half then right half): a seam down each arm, markers at elbow and wrist
    for (const h of [0, 0.5]) { line(h + 0.25, 0.78, h + 0.25, 0.995, 5); for (const v of [0.8, 0.87, 0.97]) dot(h + 0.25, v, 7); }
  } else {
    // waist (v 0..0.5) and legs (v .5-1, left half then right half)
    line(0, 0.06, 1, 0.06, 5);
    for (const [u, v] of [[0.25, 0.2], [0.75, 0.2], [0.02, 0.3], [0.48, 0.3]]) dot(u, v);
    for (const h of [0, 0.5]) {
      line(h + 0.25, 0.5, h + 0.25, 0.995, 5); line(h + 0.03, 0.5, h + 0.03, 0.995, 4);
      for (const v of [0.56, 0.72, 0.84, 0.97]) dot(h + 0.25, v, 8);
    }
  }
  g.restore();
}
export function paintMocap(spec, kind, mask = false) {
  const W = 512, c = canvas(W, W), g = c.getContext('2d');
  if (mask) { g.fillStyle = '#000'; g.fillRect(0, 0, W, W); }
  else {
    // black technical fabric with a faint knit grain
    const base = hexToRgb(spec.color || '#0c0e12'), noise = makeNoise2D(13);
    const img = g.createImageData(W, W), d = img.data;
    for (let i = 0, y = 0; y < W; y++) for (let x = 0; x < W; x++, i += 4) {
      const k = 1 + noise(x * 0.9, y * 0.9) * 0.18;
      d[i] = Math.min(255, base[0] * k * 255); d[i + 1] = Math.min(255, base[1] * k * 255); d[i + 2] = Math.min(255, base[2] * k * 255); d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  mocapMarks(g, W, spec, kind, mask);
  return c;
}

// v0.4.7.5 qp3 The Jungle Ballers gorilla costume: shaggy black-brown fur painted as thousands of short hair strokes
// over a dark base, with longer tufts, a silver saddle across the back of the top (spec.trim, lighter), and a bare
// leather chest panel (spec.chest) down the front. The legs are all fur. The same UV layout as the mo-cap suit.
export function paintGorilla(spec, kind) {
  const W = 512, c = canvas(W, W), g = c.getContext('2d');
  const base = hexToRgb(spec.color || '#1d1715'), noise = makeNoise2D(31), rng = new RNG(kind === 'top' ? 77 : 78);
  const img = g.createImageData(W, W), d = img.data;
  for (let i = 0, y = 0; y < W; y++) for (let x = 0; x < W; x++, i += 4) {
    const k = 0.8 + noise(x * 0.35, y * 0.35) * 0.4 + noise(x * 3, y * 3) * 0.12;
    d[i] = Math.min(255, base[0] * k * 255); d[i + 1] = Math.min(255, base[1] * k * 255); d[i + 2] = Math.min(255, base[2] * k * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // fur: short strokes, all leaning the way the hair lies (down the body, down the arms and legs), lit and shaded
  const hair = (n, x0, y0, x1, y1, len, w, light) => {
    for (let i = 0; i < n; i++) {
      const x = x0 + rng.next() * (x1 - x0), y = y0 + rng.next() * (y1 - y0), a = Math.PI / 2 + (rng.next() - 0.5) * 0.9, l = len * (0.6 + rng.next() * 0.8);
      const t = rng.next();
      g.strokeStyle = t < 0.35 ? `rgba(0,0,0,${0.25 + rng.next() * 0.3})` : t < 0.7 ? `rgba(${light},${light * 0.8 | 0},${light * 0.65 | 0},${0.12 + rng.next() * 0.2})` : `rgba(90,70,55,${0.1 + rng.next() * 0.2})`;
      g.lineWidth = w * (0.6 + rng.next() * 0.8); g.lineCap = 'round';
      g.beginPath(); g.moveTo(x * W, y * W); g.lineTo(x * W + Math.cos(a) * l, y * W + Math.sin(a) * l); g.stroke();
    }
  };
  if (kind === 'top') {
    hair(9000, 0, 0, 1, 0.76, 11, 1.6, 120);     // torso
    hair(5000, 0, 0.78, 1, 1.0, 10, 1.5, 120);   // sleeves
    // the silver saddle: a band of pale, longer hair across the back (u .5-1 is the back half)
    g.save(); g.beginPath(); g.rect(0.52 * W, 0.2 * W, 0.46 * W, 0.34 * W); g.clip();
    const sg = g.createLinearGradient(0, 0.2 * W, 0, 0.54 * W); sg.addColorStop(0, 'rgba(150,140,125,0.0)'); sg.addColorStop(0.3, 'rgba(165,155,140,0.75)'); sg.addColorStop(0.75, 'rgba(165,155,140,0.75)'); sg.addColorStop(1, 'rgba(150,140,125,0.0)');
    g.fillStyle = sg; g.fillRect(0.52 * W, 0.2 * W, 0.46 * W, 0.34 * W);
    hair(3600, 0.52, 0.2, 0.98, 0.54, 14, 1.8, 225);
    g.restore();
    // the bare chest: a leather panel down the front centre (u ~.25), lighter at the top, no fur over it
    const chest = spec.chest || '#5a4a40';
    g.save(); g.translate(0.25 * W, 0.06 * W);
    g.beginPath(); g.moveTo(-0.075 * W, 0); g.quadraticCurveTo(-0.1 * W, 0.26 * W, -0.05 * W, 0.5 * W); g.lineTo(0.05 * W, 0.5 * W); g.quadraticCurveTo(0.1 * W, 0.26 * W, 0.075 * W, 0); g.closePath();
    const grd = g.createLinearGradient(0, 0, 0, 0.5 * W); grd.addColorStop(0, chest); grd.addColorStop(1, '#2a221e');
    g.fillStyle = grd; g.fill();
    // the pecs and the belly's crease, drawn soft
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0.08 * W); g.lineTo(0, 0.46 * W); g.stroke();
    g.beginPath(); g.moveTo(-0.06 * W, 0.16 * W); g.quadraticCurveTo(-0.02 * W, 0.2 * W, 0, 0.17 * W); g.quadraticCurveTo(0.02 * W, 0.2 * W, 0.06 * W, 0.16 * W); g.stroke();
    g.restore();
    // a fringe of longer hair round the panel's edge
    g.save(); g.beginPath(); g.rect(0.14 * W, 0.04 * W, 0.22 * W, 0.56 * W); g.clip(); hair(900, 0.14, 0.04, 0.36, 0.6, 16, 1.4, 70); g.restore();
  } else {
    hair(4000, 0, 0, 1, 0.5, 11, 1.6, 120);      // waist
    hair(9000, 0, 0.5, 1, 1.0, 12, 1.6, 120);    // legs
    // the fur thins to skin at the ankles (the bottom 4% of each leg)
    g.fillStyle = 'rgba(40,30,26,0.55)'; g.fillRect(0, 0.965 * W, W, 0.035 * W);
  }
  return c;
}

// v0.4.8.5 quick patch And The Beat Goes On: the shell suit (the windbreaker, family 'shell', and the track pants), shiny
// nylon colour-blocked the 80s way: a cyan yoke with a zig-zag edge and a yellow zig-zag under it, a hot-pink diagonal slash
// across the front and a pink chevron on the back, scattered triangles, dark piping between the blocks, a rib-knit collar,
// cuffs and waistband (trim, tipped pink), a silver zip down the front and the event's name across the back. The pants:
// colour-blocked side panels (cyan, pink zig-zag edges, a yellow pinstripe), a drawcord waistband, rib cuffs.
// spec: color (the body), secondary (cyan), accent (pink), stripe (yellow), trim (the rib).
// Top uv: round the body u 0..1 (.25 the front, .75 the back, 0 and .5 his right and left side seams), v 0 neck .. .75 hem;
// the collar v .752-.778; the sleeves v .78-1 (his right arm u 0-.5, left .5-1; a sleeve's front at a quarter of its
// half, its outside at u .25 / 1, the cuff v .955-1). Pants: waist v 0 (the band) .. .5, thighs .5-.78, shins .78-.955,
// cuffs .955-1 (athlete.js buildTop / buildBottom).
export function paintShell(spec, kind, W = 512) {
  const c = canvas(W, W), g = c.getContext('2d'), S = W / 512;
  const base = spec.color || '#4a1f8c', cyan = spec.secondary || '#2fe0ff', pink = spec.accent || '#ff3fa4', yel = spec.stripe || '#ffe23f', trim = spec.trim || '#1a0f2e';
  const pipe = rgbStr(shade(hexToRgb(trim), 0.8));
  const X = u => u * W, Y = v => v * W;
  // a shape drawn three times across the wrap (u -1, 0, +1), so anything at a seam closes up
  const wrap = fn => { for (const o of [-1, 0, 1]) { g.save(); g.translate(o * W, 0); fn(); g.restore(); } };
  const poly = (pts, fill, edge = 0) => wrap(() => {
    g.beginPath(); pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v)))); g.closePath();
    g.fillStyle = fill; g.fill(); if (edge) { g.lineJoin = 'miter'; g.strokeStyle = pipe; g.lineWidth = edge * S; g.stroke(); }
  });
  const line = (pts, stroke, w) => wrap(() => { g.beginPath(); pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v)))); g.strokeStyle = stroke; g.lineWidth = w * S; g.lineJoin = 'miter'; g.stroke(); });
  // rib knit: the trim with fine vertical ribs and a pink tipping line
  const rib = (v0, v1, tip) => {
    g.fillStyle = trim; g.fillRect(0, Y(v0), W, Y(v1) - Y(v0));
    g.fillStyle = 'rgba(255,255,255,0.07)'; for (let x = 0; x < W; x += 4 * S) g.fillRect(x, Y(v0), 1.5 * S, Y(v1) - Y(v0));
    if (tip != null) { g.fillStyle = pink; g.fillRect(0, Y(tip) - 1.5 * S, W, 3 * S); }
  };
  // a zig-zag edge along u (teeth points at u0 + k*per, depth amp): points from u 0 to 1
  const zig = (v, amp, per, u0, n = 1) => { const pts = []; for (let u = u0 - per * Math.ceil(u0 / per); u <= 1 + per; u += per / 2) { const k = Math.round((u - u0) / (per / 2)); pts.push([u, v + (k % 2 === 0 ? amp : 0) * n]); } return pts; };
  g.fillStyle = base; g.fillRect(0, 0, W, W);
  if (kind === 'top') {
    // the front slash: a hot-pink band from his right shoulder down across to his left hip, the zip crossing it
    poly([[0.0, 0.3], [0.13, 0.3], [0.5, 0.64], [0.5, 0.71], [0.42, 0.71], [0.0, 0.42]], pink, 2.5);
    poly([[0.0, 0.47], [0.13, 0.71], [0.0, 0.71]], cyan, 2.5);                                   // a cyan corner low on his right
    poly([[0.39, 0.33], [0.47, 0.33], [0.43, 0.42]], yel, 2);                                    // confetti on his left chest
    poly([[0.12, 0.52], [0.17, 0.6], [0.08, 0.6]], yel, 2);
    poly([[0.33, 0.47], [0.36, 0.42], [0.39, 0.47]], cyan, 2);
    // the back: a pink chevron pointing down between the shoulder blades, a yellow one inside it, cyan triangles at the sides
    poly([[0.55, 0.3], [0.62, 0.3], [0.75, 0.5], [0.88, 0.3], [0.95, 0.3], [0.75, 0.62]], pink, 2.5);
    line([[0.58, 0.36], [0.75, 0.585], [0.92, 0.36]], yel, 5);
    poly([[0.52, 0.5], [0.62, 0.71], [0.52, 0.71]], cyan, 2.5); poly([[0.98, 0.5], [0.88, 0.71], [0.98, 0.71]], cyan, 2.5);
    poly([[0.71, 0.66], [0.79, 0.66], [0.75, 0.71]], yel, 2);
    // the yoke: cyan over the shoulders, front and back, its lower edge a zig-zag (points at the front and back centres)
    // with a yellow zig-zag just under it
    const edge = zig(0.18, 0.06, 0.1, 0.25);
    poly([[-0.1, 0], ...edge, [1.1, 0]], cyan, 2.5);
    line(zig(0.215, 0.06, 0.1, 0.25), yel, 5);
    // the event's name across the back yoke, in the body colour with a pink drop
    g.save(); g.font = `italic 900 ${Math.round(17 * S)}px "Arial Black", Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = pink; g.fillText('BEAT GOES ON', X(0.75) + 1.5 * S, Y(0.1) + 1.5 * S); g.fillStyle = base; g.fillText('BEAT GOES ON', X(0.75), Y(0.1));
    g.font = `italic 900 ${Math.round(11 * S)}px "Arial Black", Impact, sans-serif`; g.fillStyle = '#ffffff'; g.fillText('BEAT', X(0.355), Y(0.275)); g.restore();
    // the sleeves: the yoke's cyan over the shoulder (zig-zag edge), a pink band slanting round the elbow, a yellow
    // pinstripe down the outside
    for (const h of [0, 0.5]) {
      const L = (lu, v) => [h + lu * 0.5, v];
      poly([L(0, 0.78), L(1, 0.78), ...Array.from({ length: 9 }, (_, i) => L(1 - i / 8, 0.83 + (i % 2 ? 0.018 : 0)))], cyan, 2);
      poly([L(0, 0.872), L(1, 0.892), L(1, 0.918), L(0, 0.898)], pink, 2);
      // (his left arm's outside is at both ends of its half, his right arm's at the middle; each kept to its own half)
      g.save(); g.beginPath(); g.rect(X(h), 0, X(0.5), W); g.clip(); g.fillStyle = yel;
      for (const o of h ? [0, 1] : [0.5]) g.fillRect(X(h + o * 0.5) - 2.5 * S, Y(0.78), 5 * S, Y(0.955) - Y(0.78));
      g.restore();
    }
    // rib: the waistband, the cuffs, the collar
    rib(0.715, 0.751, 0.718); rib(0.955, 1.0, 0.958); rib(0.751, 0.78, 0.772);
    // the zip down the front: dark tape, silver teeth, the pull at the top of the collar
    g.fillStyle = trim; g.fillRect(X(0.25) - 6 * S, 0, 12 * S, Y(0.78));
    g.fillStyle = '#c9ccd4'; for (let y = 0; y < Y(0.78); y += 3 * S) g.fillRect(X(0.25) - (Math.round(y / (3 * S)) % 2 ? 2.5 : 0.5) * S, y, 3 * S, 1.6 * S);
    g.fillStyle = '#e4e7ee'; g.fillRect(X(0.25) - 3 * S, Y(0.756), 6 * S, Y(0.776) - Y(0.756)); g.fillStyle = pink; g.fillRect(X(0.25) - 2 * S, Y(0.768), 4 * S, Y(0.777) - Y(0.768));
  } else {
    // the side panels: down his hips (the waist's side seams, u 0/1 and .5) and on down the outside of each leg
    const side = (u, v0, v1, half) => {
      poly([[u - half - 0.025, v0], [u + half + 0.025, v0], [u + half + 0.025, v1], [u - half - 0.025, v1]], pink, 0);
      const n = Math.max(2, Math.round((v1 - v0) / 0.03));
      for (const s of [-1, 1]) poly([[u + s * (half + 0.025), v0], ...Array.from({ length: n + 1 }, (_, i) => [u + s * (half + (i % 2 ? 0.025 : 0.004)), v0 + (v1 - v0) * i / n]), [u + s * (half + 0.025), v1]], base, 0);
      poly([[u - half, v0], [u + half, v0], [u + half, v1], [u - half, v1]], cyan, 2);
      g.fillStyle = yel; g.fillRect(X(u) - 2 * S, Y(v0), 4 * S, Y(v1) - Y(v0));
    };
    const clip = (u0, u1, fn) => { g.save(); g.beginPath(); g.rect(X(u0), Y(0.5), X(u1) - X(u0), W); g.clip(); fn(); g.restore(); };
    for (const u of [0, 0.5, 1]) side(u, 0.06, 0.5, 0.03);
    // (his right leg's outside at u .25, his left's at both ends of its half; each leg kept to its own half)
    clip(0, 0.5, () => side(0.25, 0.5, 0.955, 0.04)); clip(0.5, 1, () => { side(0.5, 0.5, 0.955, 0.04); side(1, 0.5, 0.955, 0.04); });
    // a pink triangle on the outer front of each thigh, echoing the jacket's slash (mirrored: a left-leg u is .5 - the right's)
    poly([[0.11, 0.515], [0.21, 0.515], [0.21, 0.64]], pink, 2); poly([[0.64, 0.515], [0.54, 0.515], [0.54, 0.64]], pink, 2);
    rib(0, 0.06, 0.058); rib(0.955, 1.0, 0.958);
    // the drawcord: two white cords hanging from the front of the band
    g.strokeStyle = '#f4f2ee'; g.lineWidth = 3 * S; g.lineCap = 'round';
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(0.25 + s * 0.012), Y(0.03)); g.quadraticCurveTo(X(0.25 + s * 0.02), Y(0.08), X(0.25 + s * 0.016), Y(0.13)); g.stroke(); }
  }
  // the nylon: a faint crinkle in the weave
  const img = g.getImageData(0, 0, W, W), d = img.data, noise = makeNoise2D(41);
  for (let i = 0, y = 0; y < W; y++) for (let x = 0; x < W; x++, i += 4) {
    const k = 1 + noise(x * 0.6 / S, y * 0.6 / S) * 0.03 + noise(x * 0.05 / S, y * 0.12 / S) * 0.04;
    d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// v0.4.8.5 quick patch 2 The Monster Mash: the Bone Suit, a skeleton on a skin-tight black bodysuit, drawn as anatomy
// (bones, not the mo-cap suit's lines and dots). Top: the collarbones, the sternum, twelve pairs of ribs round to the
// spine (the costal arch under the sternum, two floating ribs at the back), the lumbar vertebrae through the belly; the
// spine (each vertebra with its wings) and the shoulder blades down the back; the top of the pelvis; the humerus, radius and
// ulna down the sleeves (front and back). Tights: the pelvis (the iliac wings, the sacrum and its holes, the pubic ring
// round each obturator hole, the hip sockets), the femurs, the kneecaps, the tibia and fibula. The gloves (paintBoneGlove):
// the carpals, the metacarpals and every finger bone. Bone-white, rimmed and shaded round so they read as bones; with
// `mask` the same bones are drawn alone on black, pale with a soft ghost-green halo: the emissive map (view.js), so they
// glow at night. Every bone is laid out in the body's own measurements (H) and drawn through the uv mapping the mesh uses
// (athlete.js: the torso u = the angle round it, 0 the front ... v from the neck down; the limbs' u round them, their front
// a quarter of the way round, the wrong way round from the front: +u is toward his right), so it lands where it belongs
// on any build.
const BONE_R0 = 0.09; // the torso chart: arc length per radian round the body (H), so a rib's width reads true
// the angle round the torso (0 the front centre, π/2 his left side, π the back) of a point x (H, + his left) across the
// front or the back at height yf (the torso's sections are superellipses: athlete.js torsoPoint)
function torsoAng(x, yf, back) {
  const [rx, , , , e] = torsoTable(yf), s = Math.sign(x) * Math.min(1, Math.pow(Math.abs(x) / rx, e / 2)), a = Math.asin(s);
  return back ? Math.PI - a : a;
}
// outlines in a 2D space: an ellipse; a polyline thickened (width wd, or wd(s) along it) with round ends
function bEll(cx, cy, rx, ry, rot = 0, n = 28) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * c - y * s, cy + x * s + y * c]; });
}
function bCap(pts, wd) {
  const n = pts.length, L = [], R = [], d = [], wv = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; d.push([dx, dy]);
    const w = (typeof wd === 'function' ? wd(i / Math.max(1, n - 1)) : wd) / 2; wv.push(w);
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]); R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  // a round end: from one side round the tip to the other (angle a0 down by π)
  const cap = (p, [dx, dy], w, a0) => Array.from({ length: 7 }, (_, k) => { const a = a0 - (k + 1) / 8 * Math.PI, c = Math.cos(a), s = Math.sin(a); return [p[0] + (dx * c - dy * s) * w, p[1] + (dy * c + dx * s) * w]; });
  return [...L, ...cap(pts[n - 1], d[n - 1], wv[n - 1], Math.PI / 2), ...R.reverse(), ...cap(pts[0], d[0], wv[0], -Math.PI / 2)];
}
// The bone painter: bone(pieces, holes, map, o) draws one bone: `pieces` outlines (they merge into one bone), `holes` cut
// through it (foramina, the gaps in the pelvis), in a 2D space that map() takes to the canvas (finely subdivided first, so
// a curved map bends the outlines with it); o.wrap draws it a canvas width either side too (round the torso's seam);
// o.clip keeps it in a rectangle of the canvas (a limb's own share); o.shade: darker hollows inside it.
function boneArt(g, W, spec, mask) {
  const k = W / 1024;
  const ivory = spec.trim || '#efe7d2', glow = spec.glow || '#8dffa8', base = spec.color || '#0b0b0e';
  const sub = (poly, map, step) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j < n; j++) out.push(map([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]));
    }
    return out;
  };
  const trace = (c2, pp, ox, oy = 0) => { c2.beginPath(); for (const pts of pp) { pts.forEach(([x, y], i) => (i ? c2.lineTo(x + ox, y + oy) : c2.moveTo(x + ox, y + oy))); c2.closePath(); } };
  // (the rounding: a scratch canvas the size of the bone takes its outline blurred, and what the blur pulled in from the
  // edges is laid back over the bone as shadow, so each bone is lit in its middle and turns away at its edges)
  let scratch = null;
  const round = (P, ox) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const pts of P) for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const m = 10, w = Math.ceil(x1 - x0) + 2 * m, h = Math.ceil(y1 - y0) + 2 * m;
    if (w < 3 || h < 3 || w > 4 * W || h > 4 * W) return;
    if (!scratch || scratch.width < w || scratch.height < h) scratch = canvas(Math.max(w, scratch?.width || 0), Math.max(h, scratch?.height || 0));
    const s2 = scratch.getContext('2d'), dx = m - x0, dy = m - y0;
    s2.save(); s2.setTransform(1, 0, 0, 1, 0, 0); s2.globalCompositeOperation = 'source-over'; s2.clearRect(0, 0, scratch.width, scratch.height);
    s2.fillStyle = 'rgba(78,64,44,0.62)'; s2.fillRect(0, 0, w, h);
    s2.globalCompositeOperation = 'destination-out'; s2.filter = `blur(${(3.2 * k + 0.6).toFixed(1)}px)`; s2.fillStyle = '#fff';
    for (const pts of P) { trace(s2, [pts], dx, dy); s2.fill(); }
    s2.filter = 'none'; s2.globalCompositeOperation = 'destination-in'; for (const pts of P) { trace(s2, [pts], dx, dy); s2.fill(); }
    s2.restore();
    g.drawImage(scratch, 0, 0, w, h, x0 - m + ox, y0 - m, w, h);
  };
  return function bone(pieces, holes, map, o = {}) {
    const step = o.step || 0.0015, P = pieces.map(p => sub(p, map, step)), Hh = (holes || []).map(p => sub(p, map, step)), Sh = (o.shade || []).map(p => sub(p, map, step));
    let x0 = 1e9, x1 = -1e9; for (const pts of P) for (const [x] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    g.save();
    if (o.clip) { g.beginPath(); g.rect(...o.clip); g.clip(); }
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const ox of o.wrap ? [-W, 0, W] : [0]) {
      if (x1 + ox < -40 || x0 + ox > W + 40) continue; // (a copy that lands off the canvas)
      if (mask) {
        // a ghost-green halo, then the bone itself pale (it glows near white, tinted green)
        g.strokeStyle = glow;
        for (const [w, al] of [[30, 0.07], [19, 0.12], [10, 0.2]]) { g.globalAlpha = al; g.lineWidth = w * k; for (const pts of P) { trace(g, [pts], ox); g.stroke(); } }
        g.globalAlpha = 1; g.fillStyle = '#c9f7d2'; for (const pts of P) { trace(g, [pts], ox); g.fill(); }
        if (Sh.length) { g.fillStyle = 'rgba(0,0,0,0.14)'; trace(g, Sh, ox); g.fill(); }
        g.fillStyle = '#000'; for (const pts of Hh) { trace(g, [pts], ox); g.fill(); }
      } else {
        // the dark rim round every piece, the bone over them all (so the pieces merge), rounded, the hollows, then the
        // holes with a rim of their own
        g.strokeStyle = '#4a443b'; g.lineWidth = 5 * k; for (const pts of P) { trace(g, [pts], ox); g.stroke(); }
        g.fillStyle = ivory; for (const pts of P) { trace(g, [pts], ox); g.fill(); }
        round(P, ox);
        if (Sh.length) { g.fillStyle = 'rgba(110,96,74,0.2)'; for (const pts of Sh) { trace(g, [pts], ox); g.fill(); } }
        g.fillStyle = base; g.strokeStyle = '#4a443b'; g.lineWidth = 4 * k; for (const pts of Hh) { trace(g, [pts], ox); g.fill(); g.stroke(); }
      }
    }
    g.restore();
  };
}
// the suit's black knit (a faint grain), or black for the glow mask
// (painted once at 256 and laid over the canvas: a fraction of the cost of a pass over every pixel)
const clothCache = new Map();
function boneCloth(g, W, spec, mask) {
  if (mask) { g.fillStyle = '#000'; g.fillRect(0, 0, W, W); return; }
  const key = spec.color || '#0b0b0e';
  if (!clothCache.has(key)) {
    const S = 256, c = canvas(S, S), cg = c.getContext('2d'), base = hexToRgb(key), noise = makeNoise2D(29), img = cg.createImageData(S, S), d = img.data;
    for (let i = 0, y = 0; y < S; y++) for (let x = 0; x < S; x++, i += 4) {
      const kk = 1 + noise(x * 1.1, y * 1.1) * 0.2 + noise(x * 0.12, y * 0.12) * 0.1;
      d[i] = Math.min(255, base[0] * kk * 255); d[i + 1] = Math.min(255, base[1] * kk * 255); d[i + 2] = Math.min(255, base[2] * kk * 255); d[i + 3] = 255;
    }
    cg.putImageData(img, 0, 0); clothCache.set(key, c);
  }
  g.drawImage(clothCache.get(key), 0, 0, W, W);
}
// the pelvis (front: the iliac wings, the sacrum seen between them, the hip sockets with the head of the femur in each,
// the pubic bones and the sit bones round each obturator hole; back: the wings with the deep notch under them, the sacrum
// and the tail bone, the sit bones), into a torso map. (Nothing under yf .468: the torso's own section runs out into the
// crotch there; the thighs carry on.)
function bonePelvis(bone, F, K, o) {
  const sac = (top, y1, tip, w) => [[-w, top], [w, top], [w * 0.62, y1], [w * 0.28, tip + 0.007], [0, tip], [-w * 0.28, tip + 0.007], [-w * 0.62, y1]];
  const holes = (x, ys, r) => ys.flatMap(y => [bEll(-x, y, r, r * 0.85), bEll(x, y, r, r * 0.85)]);
  bone([sac(0.556, 0.522, 0.492, 0.022), bCap([[0, 0.495], [0, 0.483]], 0.006)], holes(0.0085, [0.545, 0.534, 0.524, 0.514], 0.0024), F, o);
  bone([sac(0.562, 0.526, 0.493, 0.026), bCap([[0, 0.496], [0, 0.48]], 0.0068), bEll(0, 0.478, 0.0038, 0.0036)], holes(0.0095, [0.552, 0.541, 0.53, 0.519], 0.0026), K, o);
  for (const s of [-1, 1]) {
    const m = pts => pts.map(([x, y]) => [x * s, y]);
    // (front) the wing, the socket with the femur's head in it, the pubic bone and the sit bone round the obturator hole
    bone([m([[0.02, 0.551], [0.029, 0.569], [0.044, 0.58], [0.061, 0.581], [0.073, 0.573], [0.079, 0.559], [0.0745, 0.55], [0.0725, 0.539], [0.067, 0.524], [0.055, 0.518], [0.041, 0.527], [0.028, 0.54]])], [], F, { ...o, shade: [m([[0.036, 0.556], [0.05, 0.572], [0.066, 0.57], [0.07, 0.558], [0.06, 0.556], [0.048, 0.55]])] });
    bone([m([[0.054, 0.5], [0.03, 0.493], [0.012, 0.488], [0.004, 0.487], [0.004, 0.471], [0.017, 0.469], [0.032, 0.47], [0.047, 0.472], [0.056, 0.478], [0.062, 0.49]])], [m(bEll(0.032, 0.4795, 0.0115, 0.0052, -0.12))], F, o);
    bone([m(bEll(0.058, 0.506, 0.0125, 0.0125))], [], F, { ...o, shade: [m(bEll(0.058, 0.506, 0.0125, 0.0125).map(([x, y]) => [x, y]).filter((_, i) => i < 15))] });
    bone([m(bEll(0.058, 0.506, 0.0082, 0.0082))], [], F, o);
    // (back) the wing, its lower edge cut away by the sciatic notch; the sit bone under it
    bone([m([[0.024, 0.553], [0.03, 0.569], [0.045, 0.58], [0.063, 0.581], [0.076, 0.572], [0.081, 0.556], [0.078, 0.54], [0.072, 0.524], [0.066, 0.511], [0.057, 0.508], [0.049, 0.513], [0.043, 0.524], [0.037, 0.536], [0.03, 0.544]])], [], K, { ...o, shade: [m([[0.04, 0.562], [0.055, 0.574], [0.07, 0.568], [0.072, 0.556], [0.06, 0.556], [0.048, 0.552]])] });
    bone([bCap(m([[0.062, 0.506], [0.056, 0.49], [0.05, 0.478]]), 0.0095), m(bEll(0.049, 0.475, 0.0078, 0.0065))], [], K, o);
  }
}
// the lumbar vertebrae (L1-L5): through the belly from the front (the bodies, with their side wings), or down the back
function boneLumbar(bone, sp, back, o, y0 = 0.655, n = 5) {
  for (let i = 0; i < n; i++) {
    const y = y0 - i * 0.02, w = 0.017 + 0.002 * i;
    if (back) bone([bEll(0, y, 0.0085, 0.0075), bCap([[-0.027, y + 0.001], [0, y + 0.002], [0.027, y + 0.001]], 0.0062)], [], sp, o);
    else bone([bCap([[-w + 0.006, y], [w - 0.006, y]], 0.014), bCap([[-0.03, y + 0.002], [0.03, y + 0.002]], 0.0045)], [], sp, o);
  }
}
// a long bone down a limb (in its own space: x across, + his left; y down it from the joint above), the shaft from a
// to b, `w` wide, and its ends (outlines) merged in
const bLong = (a, b, w, ends = []) => [bCap([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b], s => w * (1 - 0.12 * Math.sin(Math.PI * s))), ...ends];
export function paintBones(spec, kind, mask = false, W = 1024) {
  const c = canvas(W, W), g = c.getContext('2d');
  boneCloth(g, W, spec, mask);
  const bone = boneArt(g, W, spec, mask), TAU = Math.PI * 2;
  // the torso's uv: u from the angle, v from the height (the top: v 0 at the neck .. .75 at the hem, yf .843 .. .5; the
  // tights' waist: v 0 at yf .6 .. .5 at the crotch, yf .452)
  const vOf = kind === 'top' ? yf => (0.843 - yf) / 0.343 * 0.75 : yf => 0.5 - (yf - 0.452) / 0.148 * 0.5;
  const at = (phi, yf) => [(phi / TAU + 0.25) * W, vOf(yf) * W];
  const F = ([x, y]) => at(torsoAng(x, y, false), y), K = ([x, y]) => at(torsoAng(x, y, true), y), C = ([q, y]) => at(q / BONE_R0, y);
  const torso = { wrap: true, clip: kind === 'top' ? [-W, 0, 3 * W, 0.752 * W] : [-W, 0, 3 * W, 0.5 * W] };
  // a limb's share of the canvas: u0 its half, v0 .. v0 + dv for t0 .. t1 of a bone `len` long, `circ` round
  const limb = (u0, back, v0, dv, t0, t1, len, circ) => {
    const map = ([x, y]) => [(u0 + (back ? 0.75 + x / circ : 0.25 - x / circ) * 0.5) * W, (v0 + (y / len - t0) / (t1 - t0) * dv) * W];
    return { map, clip: [u0 * W, v0 * W, 0.5 * W, dv * W] };
  };
  if (kind === 'top') {
    // ribs, round from the sternum (or the costal arch) to the spine on each side, in the chart (angle × R0, height):
    // [front end x, its height, lowest point, the angle there, height at the spine]; the floating ribs start at the spine
    const RIBS = [[0.0125, 0.815, 0.79, 1.0, 0.828], [0.0125, 0.801, 0.773, 1.02, 0.815], [0.0125, 0.787, 0.756, 1.04, 0.802], [0.0125, 0.772, 0.738, 1.06, 0.789],
      [0.0125, 0.757, 0.721, 1.08, 0.776], [0.0125, 0.742, 0.704, 1.1, 0.763], [0.011, 0.727, 0.687, 1.14, 0.75], [0.03, 0.7, 0.67, 1.2, 0.737], [0.05, 0.683, 0.653, 1.28, 0.724], [0.068, 0.664, 0.637, 1.36, 0.711]];
    for (const s of [-1, 1]) {
      for (const [x0, yS, yL, aL, yB] of RIBS) {
        const aF = torsoAng(x0, yS, false), aB = torsoAng(0.014, yB, true), pts = [];
        for (let i = 0; i <= 40; i++) {
          const a = aF + (aB - aF) * i / 40, y = a <= aL ? yL + (yS - yL) * Math.pow((aL - a) / (aL - aF), 2.3) : yL + (yB - yL) * Math.pow((a - aL) / (aB - aL), 1.8);
          pts.push([s * a * BONE_R0, y]);
        }
        bone([bCap(pts, q => 0.006 + 0.0024 * Math.sin(Math.PI * Math.min(1, q * 1.25)))], [], C, torso);
      }
      for (const [yB, a1, y1] of [[0.698, 1.75, 0.655], [0.685, 2.15, 0.662]]) { // the floating ribs
        const aB = torsoAng(0.014, yB, true), pts = [];
        for (let i = 0; i <= 20; i++) { const q = i / 20, a = aB + (a1 - aB) * q; pts.push([s * a * BONE_R0, yB + (y1 - yB) * Math.pow(q, 1.4)]); }
        bone([bCap(pts, q => 0.0085 * (1 - 0.45 * q))], [], C, torso);
      }
      // the costal arch: the cartilage of the lower ribs, up to the foot of the sternum
      bone([bCap([[0.08, 0.652], [0.068, 0.664], [0.05, 0.683], [0.03, 0.7], [0.011, 0.716]].map(([x, y]) => [s * x, y]), 0.0072)], [], F, torso);
    }
    // the sternum: the manubrium (a notch at the top), the body, the xiphoid tip; then the collarbones over its top corners
    const st = [[0.006, 0.825], [0.017, 0.826], [0.013, 0.804], [0.0105, 0.799], [0.0125, 0.775], [0.0125, 0.745], [0.0105, 0.722], [0.006, 0.713], [0.003, 0.701]];
    bone([[[0, 0.821], ...st, [0, 0.696], ...st.slice().reverse().map(([x, y]) => [-x, y])]], [], F, { ...torso, shade: [[[-0.009, 0.8005], [0.009, 0.8005], [0.009, 0.7975], [-0.009, 0.7975]]] });
    for (const s of [-1, 1]) bone([bCap([[0.015, 0.825], [0.035, 0.82], [0.06, 0.817], [0.092, 0.815]].map(([x, y]) => [s * x, y]), q => 0.0125 - 0.003 * Math.sin(Math.PI * q) + 0.001 * q)], [], F, torso);
    boneLumbar(bone, F, false, torso);
    // the back: the spine (C7 to L5: each vertebra's spinous process and its wings), the shoulder blades over the ribs
    for (let i = 0; i < 13; i++) { const y = 0.838 - i * 0.0145; bone([bEll(0, y, 0.0058, 0.0062), bCap([[-0.015, y + 0.0015], [0, y + 0.002], [0.015, y + 0.0015]], 0.0046)], [], K, torso); }
    boneLumbar(bone, K, true, torso, 0.648);
    for (const s of [-1, 1]) {
      const m = pts => pts.map(([x, y]) => [s * x, y]);
      bone([m([[0.03, 0.816], [0.058, 0.82], [0.082, 0.81], [0.091, 0.795], [0.084, 0.778], [0.074, 0.756], [0.06, 0.728], [0.046, 0.704], [0.038, 0.718], [0.033, 0.752], [0.03, 0.79]])], [], K, { ...torso, shade: [m([[0.04, 0.785], [0.075, 0.795], [0.07, 0.765], [0.055, 0.735], [0.046, 0.722], [0.04, 0.75]])] });
      bone([bCap(m([[0.034, 0.789], [0.06, 0.8], [0.088, 0.812]]), q => 0.0062 + 0.003 * q), m(bEll(0.093, 0.813, 0.0085, 0.0065))], [], K, torso);
    }
    bonePelvis(bone, F, K, torso);
    // the sleeves: the humerus (its head, the tubercle, the flare and condyles at the elbow), then the radius (on his
    // thumb side) and the ulna with its elbow hook, front and back. Upper arm: t -.07 .. 1.07 -> v .78 .. .88; forearm:
    // t -.08 .. .93 -> v .88 .. 1 (on into the glove's cuff)
    const UP = 0.172, FO = 0.148;
    for (const side of ['L', 'R']) {
      const u0 = side === 'L' ? 0.5 : 0, lat = side === 'L' ? 1 : -1;
      for (const back of [false, true]) {
        const ua = limb(u0, back, 0.78, 0.1, -0.07, 1.07, UP, 0.19), fa = limb(u0, back, 0.88, 0.12, -0.08, 0.93, FO, 0.13);
        bone(bLong([lat * 0.002, 0.014], [lat * 0.001, 0.158], 0.0125, [bEll(-lat * 0.002, 0.008, 0.0145, 0.012), bEll(lat * 0.011, 0.012, 0.0075, 0.009),
          [[-0.016, 0.152], [0.016, 0.152], [0.019, 0.165], [0.008, 0.172], [0, 0.17], [-0.008, 0.172], [-0.02, 0.165]].map(([x, y]) => [x * lat, y]), bEll(-lat * 0.019, 0.164, 0.0055, 0.006), bEll(lat * 0.017, 0.165, 0.005, 0.0055)]),
        back ? [bEll(0, 0.159, 0.0045, 0.006)] : [], ua.map, { clip: ua.clip, step: 0.002 });
        bone(bLong([lat * 0.009, 0.008], [lat * 0.01, 0.13], 0.0068, [bEll(lat * 0.009, 0.004, 0.0072, 0.005), [[lat * 0.003, 0.118], [lat * 0.017, 0.118], [lat * 0.019, 0.142], [lat * 0.001, 0.142]]]), [], fa.map, { clip: fa.clip, step: 0.002 });
        bone(bLong([-lat * 0.006, 0.006], [-lat * 0.007, 0.132], 0.007, [bCap([[-lat * 0.004, -0.012], [-lat * 0.006, 0.0], [-lat * 0.007, 0.014]], 0.012), bEll(-lat * 0.0075, 0.136, 0.005, 0.0055)]), [], fa.map, { clip: fa.clip, step: 0.002 });
      }
    }
  } else {
    // the waist: the pelvis and the last of the lumbar spine (under the top when it's worn, there when it isn't)
    boneLumbar(bone, F, false, torso, 0.595, 2); boneLumbar(bone, K, true, torso, 0.588, 2);
    bonePelvis(bone, F, K, torso);
    // the legs: thigh t -.16 .. 1.04 -> v .5 .. .76 (the femur from its trochanter to the condyles, the kneecap in front);
    // shin t -.02 .. .95 -> v .76 .. 1 (the tibia's plateau, shaft and inner ankle knob; the fibula outside it)
    const TH = 0.235, SH = 0.23;
    for (const side of ['L', 'R']) {
      const u0 = side === 'L' ? 0.5 : 0, lat = side === 'L' ? 1 : -1;
      for (const back of [false, true]) {
        const th = limb(u0, back, 0.5, 0.26, -0.16, 1.04, TH, 0.3), sh = limb(u0, back, 0.76, 0.24, -0.02, 0.95, SH, 0.2);
        bone(bLong([lat * 0.02, 0.012], [lat * 0.003, 0.214], 0.0165, [bEll(lat * 0.03, 0.006, 0.013, 0.016), bCap([[lat * 0.022, 0.0], [lat * 0.006, -0.012], [-lat * 0.006, -0.02]], 0.013),
          [[-0.019, 0.208], [0.021, 0.208], [0.024, 0.226], [0.014, 0.236], [0.002, 0.231], [-0.012, 0.236], [-0.022, 0.226]].map(([x, y]) => [x * lat, y])]), [], th.map, { clip: th.clip, step: 0.002 });
        if (!back) bone([[[0, 0.212], [0.0105, 0.218], [0.011, 0.23], [0.006, 0.241], [0, 0.245], [-0.006, 0.241], [-0.011, 0.23], [-0.0105, 0.218]]], [], th.map, { clip: th.clip, step: 0.002, shade: [bEll(0.001, 0.229, 0.005, 0.007)] });
        bone(bLong([-lat * 0.004, 0.016], [-lat * 0.006, 0.198], 0.0135, [[[-0.024, 0.0], [0.024, 0.0], [0.022, 0.011], [0.008, 0.024], [-0.01, 0.024], [-0.022, 0.011]].map(([x, y]) => [x * lat, y]),
          bEll(0, 0.022, 0.006, 0.006), [[-lat * 0.017, 0.192], [lat * 0.004, 0.192], [lat * 0.003, 0.208], [-lat * 0.009, 0.212], [-lat * 0.019, 0.207]]]), [], sh.map, { clip: sh.clip, step: 0.002 });
        bone(bLong([lat * 0.019, 0.016], [lat * 0.017, 0.2], 0.0058, [bEll(lat * 0.019, 0.011, 0.0068, 0.0065), bEll(lat * 0.018, 0.206, 0.0055, 0.0085)]), [], sh.map, { clip: sh.clip, step: 0.002 });
      }
    }
  }
  return c;
}
// the gloves (athlete.js buildGloves): the back of the hand, u 0 - .5 round the palm (its back round u .375), v 0 at the
// wrist .. .5 just past the knuckles (palm t -.06 .. 1.07); the fingers u .5 - 1 (an eighth each, index first; the back of each at the middle of its eighth), v 0 at the
// palm .. .5 at the tip; the thumb u 0 - .25, v .5 - .75; the cuff u .25 - 1 round the wrist (its front u .4375, its back
// .8125), v .78 - .98 (forearm t .84 - 1.07). The carpals, the metacarpals fanning out from them, three bones down each finger, two and the
// metacarpal on the thumb, the ends of the radius and ulna on the cuff.
export function paintBoneGlove(spec, mask = false, W = 512) {
  const c = canvas(W, W), g = c.getContext('2d');
  boneCloth(g, W, spec, mask);
  const bone = boneArt(g, W, spec, mask), TAU = Math.PI * 2;
  // the back of the hand in its own space: x across it (H, + the thumb side), y down it from the wrist (H); the palm's
  // cross-section is a superellipse (athlete.js buildHand), so x goes to the angle round it the same way
  const palmW = 0.044, palmLen = 0.104 * 0.47, ws = t => (0.62 + 0.38 * Math.min(1, Math.max(0, (t + 0.06) / 0.51))) * palmW * 0.5;
  const hand = ([x, y]) => { const t = y / palmLen, sx = Math.max(-1, Math.min(1, x / ws(t))), cs = Math.sign(sx) * Math.pow(Math.abs(sx), 1.5); return [(TAU - Math.acos(cs)) / TAU * 0.5 * W, (t + 0.06) / 1.13 * 0.5 * W]; };
  const box = [0, 0, 0.5 * W, 0.5 * W];
  // the carpals: eight pebbles in two rows at the wrist
  for (const [x, y, r] of [[0.009, 0.001, 0.0034], [0.003, 0.0012, 0.003], [-0.003, 0.0012, 0.003], [-0.009, 0.001, 0.003], [0.01, 0.0075, 0.0034], [0.0035, 0.008, 0.0033], [-0.003, 0.008, 0.0033], [-0.009, 0.0075, 0.0034]])
    bone([bEll(x, y, r, r * 0.9)], [], hand, { clip: box, step: 0.0006 });
  // the metacarpals, from the carpals to the knuckles (index to pinky)
  [0.36, 0.12, -0.12, -0.35].forEach((o, f) => {
    const x0 = o * palmW * 0.42, x1 = o * palmW * (f === 3 ? 0.92 : 0.96), y0 = 0.013, y1 = palmLen * 0.93;
    bone(bLong([x0, y0], [x1, y1], 0.0042, [bEll(x1, y1, 0.0034, 0.0032), bEll(x0, y0 - 0.001, 0.003, 0.0025)]), [], hand, { clip: box, step: 0.0006 });
  });
  // the fingers: the back of each finger runs down the middle of its column; phalanges between the joints
  const ph = (cx, s0, s1, w, n) => bCap([[cx, s0], [cx, s1]], s => w * (n ? 1 - 0.25 * Math.sin(Math.PI * s) : 1));
  for (let f = 0; f < 4; f++) {
    const cx = (0.5625 + f * 0.125) * W, sw = 0.125 * W * 0.23, py = s => s * 0.5 * W, map = ([x, y]) => [x, y];
    const segs = [[1 / 7 + 0.012, 3 / 7 - 0.016], [3 / 7 + 0.016, 5 / 7 - 0.016], [5 / 7 + 0.016, 0.96]];
    for (const [s0, s1] of segs) bone([ph(cx, py(s0), py(s1), sw, true), bEll(cx, py(s0) + sw * 0.25, sw * 0.6, sw * 0.45), bEll(cx, py(s1) - sw * 0.25, sw * 0.6, sw * 0.45)], [], map, { clip: [(0.5 + f * 0.125) * W, 0, 0.125 * W, 0.5 * W], step: 2 });
  }
  { // the thumb: its metacarpal and two phalanges
    const cx = 0.125 * W, sw = 0.25 * W * 0.2, py = s => (0.5 + s * 0.25) * W, map = ([x, y]) => [x, y];
    for (const [s0, s1] of [[0.03, 0.31], [0.36, 0.64], [0.69, 0.95]]) bone([ph(cx, py(s0), py(s1), sw, true), bEll(cx, py(s0) + sw * 0.2, sw * 0.6, sw * 0.4), bEll(cx, py(s1) - sw * 0.2, sw * 0.6, sw * 0.4)], [], map, { clip: [0, 0.5 * W, 0.25 * W, 0.25 * W], step: 2 });
  }
  // the cuff: the wrist ends of the radius and the ulna, front and back (forearm t .84 .. 1.07)
  for (const back of [false, true]) {
    const FO = 0.148, map = ([x, y]) => [(0.25 + (back ? 0.75 + x / 0.13 : 0.25 - x / 0.13) * 0.75) * W, (0.78 + (y / FO - 0.84) / 0.23 * 0.2) * W];
    for (const lat of [1]) {
      bone([bCap([[lat * 0.0105, 0.118], [lat * 0.011, 0.136]], 0.0125), [[lat * 0.003, 0.128], [lat * 0.018, 0.128], [lat * 0.02, 0.142], [lat * 0.012, 0.146], [lat * 0.002, 0.143]]], [], map, { clip: [0.25 * W, 0.78 * W, 0.75 * W, 0.2 * W], step: 0.002 });
      bone([bCap([[-lat * 0.007, 0.118], [-lat * 0.0075, 0.134]], 0.0065), bEll(-lat * 0.0075, 0.137, 0.005, 0.0055)], [], map, { clip: [0.25 * W, 0.78 * W, 0.75 * W, 0.2 * W], step: 0.002 });
    }
  }
  return c;
}

export function paintShorts(spec) {
  const W = spec.res || 512, S = W / 512, c = canvas(W, W), g = c.getContext('2d');
  const base = hexToRgb(spec.color || '#202833'), trim = hexToRgb(spec.trim || '#ffffff'), stripe = hexToRgb(spec.stripe || spec.trim || '#ffffff');
  const noise = makeNoise2D(9);
  const img = g.createImageData(W, W), d = img.data;
  const jog = spec.family === 'joggers';
  // v0.4.8.7 The Favelas: the Morro Kit shorts (pattern 'morro'): the jersey's sun-faded stripes, a cream waistband, the
  // painted tiles round both hems
  const morro = spec.pattern === 'morro', mst = morro ? (spec.stripes || ['#efc64a', '#2f6fb3']).map(hexToRgb) : null, tileInk = hexToRgb(spec.tile || '#2453a6');
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W;
    let col = morro ? morroStripe(u * 0.5, base, mst, v < 0.5 ? 0.6 : 1, noise(x * 0.02 / S, y * 0.03 / S)) : base;
    if (v < 0.5) {
      if (v < 0.045) col = jog ? shade(base, 0.8) : trim;
      if (spec.stripe && (u < 0.03 || u > 0.97 || Math.abs(u - 0.5) < 0.03)) col = stripe;
    } else {
      const lu = u < 0.5 ? u * 2 : (u - 0.5) * 2; // local leg u
      const lateral = u < 0.5 ? Math.abs(lu - 0.5) : Math.min(lu, 1 - lu);
      if (morro) col = morroStripe(lu * 0.5, base, mst, 1, noise(x * 0.02 / S, y * 0.03 / S));
      if (morro && v > 0.875 && v <= 0.955) col = morroTile((lu * 10) % 1, (v - 0.875) / 0.08, trim, tileInk);
      if (spec.stripe && lateral < 0.06 && !jog) col = stripe;
      if (spec.stripe && lateral < 0.03 && jog) col = stripe;
      if (!jog && v > 0.955) col = trim;
      if (jog && v > 0.97) col = shade(base, 0.8);
    }
    const k = 1 + noise(x * 0.7 / S, y * 0.7 / S) * 0.05 + (jog ? noise(x * 0.05 / S, y * 0.2 / S) * 0.06 : 0);
    const i = (y * W + x) * 4;
    d[i] = Math.min(255, col[0] * k * 255); d[i + 1] = Math.min(255, col[1] * k * 255); d[i + 2] = Math.min(255, col[2] * k * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (spec.logo) {
    g.fillStyle = rgbStr(trim); g.font = `900 ${Math.round(22 * S)}px "Arial Black", sans-serif`; g.textAlign = 'center';
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
  const outsole = spec.outsole || (model === 'retro' ? '#b98a4e' : model === 'coffin' ? '#1b181f' : model === 'ladeira' ? rgbStr(shade(hexToRgb(sole), 0.78)) : lum(hexToRgb(sole)) > 0.5 ? rgbStr(shade(hexToRgb(sole), 0.62)) : '#141518');
  const midsole = model === 'coffin' ? '#141116' : sole; // (v0.4.8.5 quick patch 2: the Coffin Hi's black midsole, slime dripping down it)
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
    rect(half, 0, 0.245, 1, 0.505, midsole);
    if (model === 'strata') { const gr = g.createLinearGradient(0, Y(0.5), 0, Y(0.25)); gr.addColorStop(0, sole); gr.addColorStop(1, accent); g.fillStyle = gr; g.fillRect(X(half, 0), Y(0.505), X(half, 1) - X(half, 0), Y(0.245) - Y(0.505)); }
    line(half, [[0, 0.45], [1, 0.45]], model === 'legend' || model === 'basic' ? accent : 'rgba(0,0,0,0.22)', model === 'legend' || model === 'basic' ? 5 : 2);
    if (model === 'kinetic' || model === 'vanta') rect(half, 0.04, 0.3, 0.3, 0.42, 'rgba(255,255,255,0.18)'); // cushioning window
    // toe cap and heel counter
    poly(half, [...curve(t => 0.5 + 0.28 * Math.sqrt(Math.max(0, (t - 0.8) / 0.2)), 0.8, 1), [1, 1], [1, 0.5]], panel);
    const heelCol = model === 'basic' || model === 'kinetic' || model === 'legend' || model === 'rise' || model === 'coffin' ? accent : model === 'boombox' ? trim : panel;
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
        g.fillStyle = accent; g.font = `900 ${Math.round(26 * k)}px "Arial Black", sans-serif`; g.textAlign = 'center'; g.fillText('RR', X(half, 0.12), Y(0.62)); break; // (v0.4.8.7: RIMRIFT's mark; it said 16, the old name's)
      }
      case 'boombox': {
        // v0.4.8.5 quick patch And The Beat Goes On: an 80s white leather hi-top. A perforated toe box, a cyan padded collar,
        // a pink zig-zag bolt down the side with a cyan shadow, a cyan midsole stripe, and the velcro strap over the ankle
        // (athlete.js SHOE_STRAP: the strap's mesh lies right over this): pink, stitched round its edge, a cyan band down
        // its middle and the hook-and-loop grain
        dots(half, 0.8, 0.97, 0.6, 0.8, 0.026, 'rgba(0,0,0,0.28)', 2.4);
        rect(half, 0, 0.88, 0.36, 0.93, trim);
        const bolt = [[0.17, 0.6], [0.3, 0.74], [0.4, 0.6], [0.52, 0.74], [0.62, 0.6], [0.73, 0.72]];
        line(half, bolt.map(([t, v]) => [t + 0.014, v - 0.026]), trim, 15 * k); line(half, bolt, accent, 15 * k);
        line(half, [[0, 0.46], [1, 0.46]], trim, 6); line(half, [[0, 0.4], [1, 0.4]], accent, 3);
        const st = SHOE_STRAP, q = [[st.t0 - st.slant, st.v0], [st.t1 - st.slant, st.v0], [st.t1, 1], [st.t0, 1]];
        poly(half, q, accent);
        line(half, [[st.t0 + 0.035 - st.slant, st.v0], [st.t0 + 0.035, 1]], trim, 5);
        g.save(); g.beginPath(); q.forEach(([t, v], i) => (i ? g.lineTo(X(half, t), Y(v)) : g.moveTo(X(half, t), Y(v)))); g.closePath(); g.clip();
        g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = Y(1); y < Y(st.v0); y += 3) for (let x = X(half, st.t0 - st.slant); x < X(half, st.t1); x += 3) if ((x + y) % 6 < 3) g.fillRect(x, y, 1.5, 1.5);
        g.restore();
        line(half, [[st.t0 - st.slant + 0.008, st.v0 + 0.01], [st.t0 + 0.008, 1]], 'rgba(255,255,255,0.75)', 1.5, [4, 3]);
        line(half, [[st.t1 - st.slant - 0.008, st.v0 + 0.01], [st.t1 - 0.008, 1]], 'rgba(255,255,255,0.75)', 1.5, [4, 3]);
        line(half, [[st.t0 - st.slant + 0.006, st.v0 + 0.012], [st.t1 - st.slant - 0.006, st.v0 + 0.012]], 'rgba(255,255,255,0.75)', 1.5, [4, 3]);
        break;
      }
      case 'coffin': coffinShoe(g, X, Y, half, spec, false); break; // (v0.4.8.5 quick patch 2: The Monster Mash)
      case 'ladeira': ladeiraShoe(g, X, Y, half, spec, poly, line); break; // (v0.4.8.7: The Favelas)
      case 'legend': {
        for (const v of [0.58, 0.61]) line(half, [[0.18, v], [0.8, v + 0.04]], accent, 3);
        const cx = X(half, 0.36), cy = Y(0.72), R = 26 * k; g.fillStyle = accent; g.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? R * 0.45 : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        g.closePath(); g.fill(); break;
      }
    }
    // stitching along the toe cap and the eyestay, and a small original "RR" tab on the heel (v0.4.8.6: RIMRIFT; was "AH")
    line(half, curve(t => 0.5 + 0.28 * Math.sqrt(Math.max(0, (t - 0.8) / 0.2)) - 0.015, 0.8, 1), 'rgba(0,0,0,0.3)', 1.5, [4, 4]);
    line(half, [[0.38, 0.84], [0.82, 0.84]], 'rgba(0,0,0,0.25)', 1.5, [4, 4]);
    if (lat) { g.fillStyle = lum(hexToRgb(heelCol.startsWith('#') ? heelCol : upper)) > 0.5 ? '#16171a' : '#f4f2ec'; g.font = '900 16px "Arial Black", sans-serif'; g.textAlign = 'center'; g.fillText('RR', X(half, 0.05), Y(0.7)); }
  }
  // (v0.4.8.5 quick patch 2: the Coffin Hi's skull charm reads two swatches between the halves: bone white, and black)
  if (model === 'coffin') { g.fillStyle = upper; g.fillRect(0.493 * W, 0, 0.014 * W, Hh); g.fillStyle = trim; g.fillRect(0.493 * W, Hh / 2, 0.014 * W, Hh / 2); }
  // fine leather / mesh grain
  const img = g.getImageData(0, 0, W, Hh), d = img.data, noise = makeNoise2D(17);
  for (let y = 0; y < Hh; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4, k = 1 + noise(x * 0.9, y * 0.9) * 0.035;
    d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
  }
  g.putImageData(img, 0, 0);
  return c;
}
// v0.4.8.7 The Favelas: the Ladeira hi-top. Down each side a hand-painted panel of azulejo tiles (two rows, blue on
// cream glaze: a border, a four-petal flower, quarter rings meeting at the corners) framed in the trim colour; a gum
// sole whose lugs wrap up over the toe and the heel (dark gum blocks climbing the midsole), and a toe bumper
export const LADEIRA_TILES = { t0: 0.15, t1: 0.75, v0: 0.545, v1: 0.835, cols: 4, rows: 2 };
function ladeiraShoe(g, X, Y, half, spec, poly, line) {
  const T = LADEIRA_TILES, ink = spec.accent || '#2453a6', glaze = '#f7f1e2', frame = spec.trim || '#2fb8b0', sole = hexToRgb(spec.sole || '#c98b4b');
  const lug = rgbStr(shade(sole, 0.62)), dt = (T.t1 - T.t0) / T.cols, dv = (T.v1 - T.v0) / T.rows;
  poly(half, [[T.t0 - 0.012, T.v0 - 0.016], [T.t1 + 0.012, T.v0 - 0.016], [T.t1 + 0.012, T.v1 + 0.016], [T.t0 - 0.012, T.v1 + 0.016]], frame);
  for (let i = 0; i < T.cols; i++) for (let j = 0; j < T.rows; j++) {
    const a = T.t0 + i * dt, b = T.v0 + j * dv, x0 = X(half, a), x1 = X(half, a + dt), y0 = Y(b + dv), y1 = Y(b), w = x1 - x0, h = y1 - y0, cx = x0 + w / 2, cy = y0 + h / 2;
    g.fillStyle = glaze; g.fillRect(x0 + 1, y0 + 1, w - 2, h - 2);
    g.save(); g.beginPath(); g.rect(x0 + 1, y0 + 1, w - 2, h - 2); g.clip();
    g.strokeStyle = ink; g.lineWidth = Math.max(2, w * 0.07); g.strokeRect(x0 + w * 0.06, y0 + h * 0.06, w * 0.88, h * 0.88);
    g.fillStyle = ink;
    for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + Math.cos(k * Math.PI / 2) * w * 0.17, cy + Math.sin(k * Math.PI / 2) * h * 0.17, w * 0.13, h * 0.08, k * Math.PI / 2, 0, 7); g.fill(); }
    g.fillStyle = glaze; g.beginPath(); g.ellipse(cx, cy, w * 0.07, h * 0.07, 0, 0, 7); g.fill();
    g.strokeStyle = ink; g.lineWidth = Math.max(1.5, w * 0.06);
    for (const [ex, ey] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) { g.beginPath(); g.ellipse(ex, ey, w * 0.22, h * 0.22, 0, 0, 7); g.stroke(); g.fillStyle = ink; g.beginPath(); g.ellipse(ex, ey, w * 0.07, h * 0.07, 0, 0, 7); g.fill(); }
    g.restore();
  }
  // the gum lugs: chunky blocks all along the sole's sidewall (dark gum, the light gum between them showing as deep
  // grooves), climbing high up the toe and the heel (big enough to read from across a court), and a stitched toe bumper
  const deep = rgbStr(shade(sole, 0.34)), lip = rgbStr(shade(sole, 1.25));
  for (let t = 0.01; t < 0.99; t += 0.05) poly(half, [[t, 0.03], [t + 0.034, 0.03], [t + 0.034, 0.235], [t, 0.235]], deep);
  for (let k = 0; k < 4; k++) { const t = 0.845 + k * 0.038, h = 0.43 - 0.02 * Math.abs(k - 1.5); poly(half, [[t, 0.235], [t + 0.026, 0.235], [t + 0.026, h], [t, h]], deep); line(half, [[t, h], [t + 0.026, h]], lip, 2); }
  for (let k = 0; k < 4; k++) { const t = 0.012 + k * 0.034, h = 0.41 - 0.015 * k; poly(half, [[t, 0.235], [t + 0.024, 0.235], [t + 0.024, h], [t, h]], deep); line(half, [[t, h], [t + 0.024, h]], lip, 2); }
  line(half, [[0, 0.24], [1, 0.24]], lug, 4);
  poly(half, [[0.84, 0.5], [1, 0.5], [1, 0.6], [0.9, 0.57]], rgbStr(sole));
  line(half, [[0.84, 0.52], [0.99, 0.585]], 'rgba(0,0,0,0.3)', 1.5, [4, 3]);
}

function smoothT(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// v0.4.8.5 quick patch 2 The Monster Mash: the Coffin Hi / Graveyard. On each side a coffin lying heel to toe (deep purple,
// its lid inset darker, bone-white stitching round it, nail heads at its corners, a skull and crossbones on the lid); bone-white
// stitching along the toe cap, the eyestay and the collar; and slime: an ooze of green over the top of the black midsole,
// dripping down it in runs of every length, and a line of it round the sole's edge. With `mask` only the slime is drawn
// (the glow map, paintShoeGlow). X(half, t) / Y(v): paintShoe's layout.
function coffinShoe(g, X, Y, half, spec, mask) {
  const slime = spec.sole || '#7dff4f', bone = spec.trim || '#ece4cc', rng = new RNG(71 + half);
  const P = pts => { g.beginPath(); pts.forEach(([t, v], i) => (i ? g.lineTo(X(half, t), Y(v)) : g.moveTo(X(half, t), Y(v)))); g.closePath(); };
  const dash = (pts, w = 2.2) => { g.beginPath(); pts.forEach(([t, v], i) => (i ? g.lineTo(X(half, t), Y(v)) : g.moveTo(X(half, t), Y(v)))); g.strokeStyle = bone; g.lineWidth = w; g.setLineDash([7, 5]); g.stroke(); g.setLineDash([]); };
  if (!mask) {
    // the coffin: head end toward the heel, its shoulders, the long taper to its foot
    const vc = 0.68, cof = [[0.2, vc + 0.06], [0.32, vc + 0.13], [0.76, vc + 0.055], [0.76, vc - 0.055], [0.32, vc - 0.13], [0.2, vc - 0.06]];
    P(cof); g.fillStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 7; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
    g.fillStyle = spec.accent || '#4a1a72'; g.fill();
    const lid = cof.map(([t, v]) => [0.47 + (t - 0.47) * 0.86, vc + (v - vc) * 0.72]);
    P(lid); g.fillStyle = 'rgba(0,0,0,0.28)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.stroke();
    dash([...cof.map(([t, v]) => [0.47 + (t - 0.47) * 0.94, vc + (v - vc) * 0.86]), [0.47 + (0.2 - 0.47) * 0.94, vc + 0.06 * 0.86]]);
    g.fillStyle = bone; for (const [t, v] of cof) { g.beginPath(); g.arc(X(half, 0.47 + (t - 0.47) * 0.94), Y(vc + (v - vc) * 0.86), 3.4, 0, 7); g.fill(); }
    // a skull on the lid (upright and the same both ways round, so it reads right on either side of either shoe), crossed
    // bones under it
    g.save(); g.translate(X(half, 0.46), Y(vc + 0.012)); g.lineCap = 'round';
    for (const sx of [-1, 1]) { g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 9; g.beginPath(); g.moveTo(-sx * 30, 22); g.lineTo(sx * 30, -8); g.stroke(); g.strokeStyle = bone; g.lineWidth = 6; g.stroke(); g.fillStyle = bone; for (const [x, y] of [[-sx * 30, 22], [sx * 30, -8]]) for (const o of [-1, 1]) { g.beginPath(); g.arc(x + o * 3.2 * sx * 0.45, y + o * 3.2, 4.2, 0, 7); g.fill(); } }
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(1.5, -9, 19, 0, 7); g.fill(); g.fillRect(-9.5, 2, 22, 16);
    g.fillStyle = bone; g.beginPath(); g.arc(0, -11, 19, 0, 7); g.fill(); g.beginPath(); g.roundRect ? g.roundRect(-11, 0, 22, 16, 4) : g.rect(-11, 0, 22, 16); g.fill();
    g.fillStyle = '#1a1220'; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * 7.5, -10, 5.6, 6.4, sx * 0.25, 0, 7); g.fill(); }
    g.beginPath(); g.moveTo(0, -3.5); g.lineTo(-3, 2); g.lineTo(3, 2); g.closePath(); g.fill();
    g.fillRect(-8, 8.5, 16, 1.6); for (const x of [-4, 0, 4]) g.fillRect(x - 0.7, 5.5, 1.4, 8);
    g.restore();
    // bone-white stitching: the toe cap, the eyestay, the collar, the heel counter
    dash(Array.from({ length: 13 }, (_, i) => { const t = 0.8 + 0.2 * i / 12; return [t, 0.5 + 0.28 * Math.sqrt(Math.max(0, (t - 0.8) / 0.2)) - 0.022]; }));
    dash([[0.38, 0.828], [0.82, 0.828]]); dash([[0, 0.912], [0.3, 0.912], [0.42, 0.86]]); dash([[0.205, 0.5], [0.165, 0.735], [0.08, 0.85], [0, 0.865]]);
  }
  // the slime: over the top of the midsole (a lumpy edge), its runs down the side, the line round the sole's edge
  g.fillStyle = slime;
  g.beginPath(); g.moveTo(X(half, 0), Y(0.512));
  for (let i = 0; i <= 60; i++) { const t = i / 60; g.lineTo(X(half, t), Y(0.512 + 0.006 * Math.sin(t * 47 + half))); }
  for (let i = 60; i >= 0; i--) { const t = i / 60; g.lineTo(X(half, t), Y(0.468 + 0.008 * Math.sin(t * 31 + 1.3 * half) + 0.005 * Math.sin(t * 83))); }
  g.closePath(); g.fill();
  for (let t = 0.02 + rng.next() * 0.03; t < 0.98; t += 0.045 + rng.next() * 0.06) {
    const len = 0.03 + Math.pow(rng.next(), 1.4) * 0.17, w = 5 + rng.next() * 6, x = X(half, t), y0 = Y(0.475), y1 = Y(0.475 - len);
    g.beginPath(); g.moveTo(x - w, y0 - 2); g.quadraticCurveTo(x - w * 0.45, (y0 + y1) / 2, x - w * 0.55, y1); g.arc(x, y1, w * 0.55, Math.PI, 0, true); g.quadraticCurveTo(x + w * 0.45, (y0 + y1) / 2, x + w, y0 - 2); g.closePath(); g.fill();
  }
  g.fillRect(X(half, 0), Y(0.262), X(half, 1) - X(half, 0), Y(0.247) - Y(0.262));
  if (!mask) { // a wet sheen on it
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2;
    g.beginPath(); for (let i = 0; i <= 60; i++) { const t = i / 60; const y = Y(0.503 + 0.006 * Math.sin(t * 47 + half)); i ? g.lineTo(X(half, t), y) : g.moveTo(X(half, t), y); } g.stroke();
  }
}
// the Coffin Hi's glow map (view.js): the slime on both sides, and the skull charm's eye sockets (its black swatch)
export function paintShoeGlow(spec = {}) {
  if (spec.model !== 'coffin') return null;
  const W = 1024, Hh = 512, c = canvas(W, Hh), g = c.getContext('2d');
  const X = (half, t) => (half ? 0.508 : 0.008) * W + t * 0.484 * W, Y = v => (1 - v) * Hh;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh);
  for (const half of [0, 1]) coffinShoe(g, X, Y, half, spec, true);
  g.fillStyle = spec.sole || '#7dff4f'; g.fillRect(0.493 * W, 0, 0.014 * W, Hh / 2);
  return c;
}

// v0.4.8.5 quick patch 2 The Monster Mash: the Jack-o'-Lantern headband's texture (athlete.js buildLantern). The band
// (u 0-.5 round the head, v top to bottom): pumpkin orange, ribbed like a pumpkin's skin, a dark green piping along both
// edges. The pumpkin (u .5-1, v 0-1: straight on from the front, its middle at .75, .5): speckled skin, and the carved
// face: triangle eyes slanted mean, a triangle nose and a jagged grin with two teeth, each hole cut through to the pale
// flesh at its rim and dark inside. The stem: a swatch at u .505 v .03. With `mask` the glow map: the holes alone, lit
// candle-yellow at their middle to orange at their rims, a little of it spilling out over the skin round them.
export function paintLantern(spec = {}, mask = false) {
  const W = 512, Hh = 256, c = canvas(W, Hh), g = c.getContext('2d');
  const orange = spec.color || '#ff7a1a', candle = spec.glow || '#ffc23a', o = hexToRgb(orange);
  const PX = (x, y) => [W * (0.75 + x * 0.25), Hh * (0.5 - y * 0.5)]; // the pumpkin's front: x, y -1..1 across it
  const holes = [
    [[-0.66, 0.1], [-0.14, -0.01], [-0.42, 0.46]], [[0.66, 0.1], [0.14, -0.01], [0.42, 0.46]], // the eyes
    [[-0.11, -0.16], [0.11, -0.16], [0, 0.03]],                                              // the nose
    [[-0.74, -0.24], [-0.5, -0.3], [-0.38, -0.25], [-0.26, -0.33], [-0.16, -0.33], [-0.16, -0.24], [0.02, -0.29], [0.24, -0.34], [0.38, -0.27], [0.52, -0.31], [0.75, -0.23], // the grin's top edge (a tooth hangs down at -.16)
      [0.6, -0.48], [0.36, -0.6], [0.16, -0.64], [0.16, -0.54], [0.04, -0.54], [0.04, -0.65], [-0.2, -0.64], [-0.46, -0.56], [-0.64, -0.44]], // its bottom edge (a tooth stands up at .1)
  ];
  const trace = pts => { g.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = PX(x, y); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); };
  g.lineJoin = 'round';
  if (mask) {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh);
    // the light spilling out over the rims, then each hole lit from its middle
    g.save(); g.filter = 'blur(5px)'; g.fillStyle = 'rgba(255,120,20,0.45)'; for (const h of holes) { trace(h); g.fill(); } g.restore();
    for (const h of holes) {
      const cx = h.reduce((a, p) => a + p[0], 0) / h.length, cy = h.reduce((a, p) => a + p[1], 0) / h.length, [px, py] = PX(cx, cy);
      const gr = g.createRadialGradient(px, py, 1, px, py, W * 0.1);
      gr.addColorStop(0, '#fff6c8'); gr.addColorStop(0.45, candle); gr.addColorStop(1, '#ff7a14');
      g.fillStyle = gr; trace(h); g.fill();
    }
    return c;
  }
  // the band: orange, ribbed, the piping
  g.fillStyle = orange; g.fillRect(0, 0, W / 2, Hh);
  for (let x = 0; x < W / 2; x += W / 2 / 40) {
    const gr = g.createLinearGradient(x, 0, x + W / 2 / 40, 0);
    gr.addColorStop(0, 'rgba(120,40,0,0.35)'); gr.addColorStop(0.18, 'rgba(120,40,0,0)'); gr.addColorStop(0.5, 'rgba(255,220,160,0.18)'); gr.addColorStop(0.82, 'rgba(120,40,0,0)'); gr.addColorStop(1, 'rgba(120,40,0,0.35)');
    g.fillStyle = gr; g.fillRect(x, 0, W / 2 / 40, Hh);
  }
  g.fillStyle = '#2f4a14'; g.fillRect(0, 0, W / 2, Hh * 0.09); g.fillRect(0, Hh * 0.91, W / 2, Hh * 0.09);
  g.fillStyle = 'rgba(160,210,90,0.5)'; for (let x = 2; x < W / 2; x += 9) { g.fillRect(x, Hh * 0.04, 4, 2); g.fillRect(x + 4, Hh * 0.95, 4, 2); }
  // the pumpkin's skin, speckled
  const noise = makeNoise2D(83), img = g.createImageData(W / 2, Hh), d = img.data;
  for (let i = 0, y = 0; y < Hh; y++) for (let x = 0; x < W / 2; x++, i += 4) {
    const k = 0.9 + noise(x * 0.09, y * 0.09) * 0.12 + noise(x * 0.6, y * 0.6) * 0.05;
    d[i] = Math.min(255, o[0] * k * 255); d[i + 1] = Math.min(255, o[1] * k * 255); d[i + 2] = Math.min(255, o[2] * k * 255); d[i + 3] = 255;
  }
  g.putImageData(img, W / 2, 0);
  // the carved holes: the pale flesh round the cut, the dark inside
  for (const h of holes) { trace(h); g.strokeStyle = '#f6dc96'; g.lineWidth = 5; g.stroke(); g.fillStyle = '#3a1604'; g.fill(); }
  for (const h of holes) { trace(h); g.strokeStyle = 'rgba(150,70,10,0.8)'; g.lineWidth = 1.2; g.stroke(); }
  // the stem's swatch
  g.fillStyle = '#5b6b2b'; g.fillRect(W / 2, 0, 12, 16);
  return c;
}

// v0.4.8.7 The Favelas: the Hillside Bandana's print (athlete.js buildBandana: the band u 0 - .8 all the way round, v
// top to bottom; the knot and the ends u .8 - 1). A dyed cotton ground (the item's colour) printed in its trim colour:
// a border down each folded edge (a line and a row of dots), and between them a repeat of teardrops (curled at the
// tip, a dot and a ring inside), little four-petal flowers and scattered dots, the ink a touch uneven
export function paintBandana(spec = {}) {
  // (1024 x 96: round the head the band is about ten times as long as it is tall, so a 32 px cell comes out square)
  const W = 1024, Hh = 96, c = canvas(W, Hh), g = c.getContext('2d');
  const ground = spec.color || '#c4342b', ink = spec.trim || '#f6eedf', dark = rgbStr(shade(hexToRgb(ground), 0.55));
  g.fillStyle = ground; g.fillRect(0, 0, W, Hh);
  const cell = 32, rows = Hh / cell;
  const tear = (x, y, s, a) => {
    g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s);
    g.fillStyle = ink; g.beginPath(); g.moveTo(0, -16); g.bezierCurveTo(14, -12, 15, 8, 0, 14); g.bezierCurveTo(-15, 8, -12, -8, -4, -14); g.quadraticCurveTo(2, -22, 8, -20); g.quadraticCurveTo(2, -18, 0, -16); g.fill();
    g.fillStyle = ground; g.beginPath(); g.ellipse(0, 3, 6.5, 7.5, 0, 0, 7); g.fill();
    g.fillStyle = ink; g.beginPath(); g.ellipse(0, 3, 2.6, 3, 0, 0, 7); g.fill();
    g.fillStyle = dark; g.beginPath(); g.ellipse(-1, -8, 2, 2, 0, 0, 7); g.fill();
    g.restore();
  };
  const flower = (x, y, s) => { g.fillStyle = ink; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x + Math.cos(k * Math.PI / 2) * 5 * s, y + Math.sin(k * Math.PI / 2) * 5 * s, 4 * s, 2.6 * s, k * Math.PI / 2, 0, 7); g.fill(); } g.fillStyle = dark; g.beginPath(); g.arc(x, y, 1.8 * s, 0, 7); g.fill(); };
  const dot = (x, y, r) => { g.fillStyle = ink; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  // the field between the borders (the borders take the top and bottom 18%)
  g.save(); g.beginPath(); g.rect(0, Hh * 0.18, W, Hh * 0.64); g.clip();
  for (let x = -cell; x < W + cell; x += cell) for (let r = 0; r < rows + 1; r++) {
    const y = r * cell + (Math.round(x / cell) % 2 ? cell / 2 : 0), flip = (Math.round(x / cell) + r) % 2;
    tear(x + cell * 0.5, y + cell * 0.25, 0.55, flip ? 0.6 : -0.6 + Math.PI);
    flower(x + cell * 0.1, y + cell * 0.75, 0.6);
    dot(x + cell * 0.82, y + cell * 0.7, 1.3); dot(x + cell * 0.28, y + cell * 0.95, 1); dot(x + cell * 0.9, y + cell * 0.12, 1);
  }
  g.restore();
  // the borders: a solid line, a row of dots, a thin line, on each folded edge
  for (const [y0, sg] of [[0, 1], [Hh, -1]]) {
    g.fillStyle = ink; g.fillRect(0, Math.min(y0, y0 + sg * Hh * 0.05), W, Hh * 0.05);
    for (let x = 4; x < W; x += 9) dot(x, y0 + sg * Hh * 0.1, 1.7);
    g.fillRect(0, Math.min(y0 + sg * Hh * 0.15, y0 + sg * Hh * 0.165), W, Hh * 0.015);
  }
  // the ink a little uneven, the cotton's weave
  const img = g.getImageData(0, 0, W, Hh), d = img.data, noise = makeNoise2D(29);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, k = 0.94 + noise(x * 0.05, y * 0.05) * 0.05 + ((x + y) % 3 === 0 ? -0.025 : 0);
    d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// v0.4.4 chain textures. paintChain: one tile of 4 links (u repeats along the chain, v goes round the tube).
// Gold: polished Cuban links with bright edges and dark gaps. Iced: white-gold links paved with stones. The
// iced version also returns an emissive "glint" map so the stones sparkle under the bloom.
// v0.4.8.7: each chain its own (sim/bots.js chainSpec: link, metal, stone). Before this there were two textures, 'gold'
// and 'ice', and every chain was one of them. A tile is 4 links (or 4 stones, or a few turns of the rope) along u; v goes
// round the tube. The metal shades from the item's colour (yellow gold, sterling, white gold, rose gold); stones glint
// (the emissive map). An old caller passing 'gold' or 'ice' gets the Gold Chain's or the Iced Out Chain's look.
const LEGACY_CHAIN = { gold: { link: 'cuban', metal: '#e8c15a', stone: null }, ice: { link: 'tennis', metal: '#dfeaf5', stone: '#ffffff' } };
const metalRamp = hex => { const m = hexToRgb(hex || '#e8c15a'); return { hi: rgbStr(mix(m, [1, 1, 1], 0.7)), lt: rgbStr(mix(m, [1, 1, 1], 0.3)), mid: rgbStr(m), dk: rgbStr(shade(m, 0.6)), deep: rgbStr(shade(m, 0.32)) }; };
export function paintChain(spec) {
  const s = typeof spec === 'string' ? LEGACY_CHAIN[spec] || LEGACY_CHAIN.gold : spec || LEGACY_CHAIN.gold;
  const link = s.link || 'cuban', M = metalRamp(s.metal || s.color), W = 256, Hh = 64, c = canvas(W, Hh), g = c.getContext('2d');
  const st = s.stone ? hexToRgb(s.stone) : null, e = st ? canvas(W, Hh) : null, ge = e && e.getContext('2d');
  if (ge) { ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hh); }
  const stone = (x, y, rad, glint = true) => {
    const gr = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, rgbStr(mix(st, [1, 1, 1], 0.35))); gr.addColorStop(1, rgbStr(shade(st, 0.62)));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - rad * 0.6, y); g.lineTo(x + rad * 0.6, y); g.moveTo(x, y - rad * 0.6); g.lineTo(x, y + rad * 0.6); g.stroke(); // (the facets)
    if (glint) { ge.fillStyle = rgbStr(mix(st, [1, 1, 1], 0.6)); ge.beginPath(); ge.arc(x - rad * 0.25, y - rad * 0.25, Math.max(1.4, rad * 0.35), 0, 7); ge.fill(); }
  };
  if (link === 'rope') {
    // a rope: strands twisted in a tight spiral, each a bright ridge with a dark groove beside it, running diagonally
    g.fillStyle = M.deep; g.fillRect(0, 0, W, Hh);
    const n = 8, step = W / n;
    for (let i = -2; i < n + 2; i++) {
      const x0 = i * step, gr = g.createLinearGradient(x0, 0, x0 + step, 0);
      gr.addColorStop(0, M.dk); gr.addColorStop(0.35, M.hi); gr.addColorStop(0.6, M.mid); gr.addColorStop(1, M.deep);
      g.fillStyle = gr; g.beginPath(); g.moveTo(x0, Hh); g.lineTo(x0 + step * 0.85, Hh); g.lineTo(x0 + step * 0.85 + Hh * 0.9, 0); g.lineTo(x0 + Hh * 0.9, 0); g.closePath(); g.fill();
    }
  } else if (link === 'tennis') {
    // a tennis chain: one unbroken row of round stones, each in a square setting with a prong at every corner
    g.fillStyle = M.dk; g.fillRect(0, 0, W, Hh);
    const n = 4, lw = W / n;
    for (let i = 0; i < n; i++) {
      const cx = lw * (i + 0.5), cy = Hh / 2;
      g.fillStyle = M.mid; g.fillRect(cx - lw * 0.46, cy - Hh * 0.46, lw * 0.92, Hh * 0.92);
      g.fillStyle = M.lt; g.fillRect(cx - lw * 0.46, cy - Hh * 0.46, lw * 0.92, Hh * 0.08);
      stone(cx, cy, Math.min(lw, Hh) * 0.38);
      g.fillStyle = M.hi; for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.arc(cx + dx * lw * 0.33, cy + dy * Hh * 0.33, 2.6, 0, 7); g.fill(); }
    }
  } else if (link === 'box') {
    // a box chain: square links seen end on (a hollow square, its inner walls in shadow), each face set with small stones
    // (bright overall: from a few metres a fine chain is its average colour, and too much shadow reads as black)
    g.fillStyle = M.dk; g.fillRect(0, 0, W, Hh);
    const n = 4, lw = W / n;
    for (let i = 0; i < n; i++) {
      const cx = lw * (i + 0.5), cy = Hh / 2, a = lw * 0.47, b = Hh * 0.47;
      const gr = g.createLinearGradient(0, cy - b, 0, cy + b); gr.addColorStop(0, M.hi); gr.addColorStop(0.5, M.lt); gr.addColorStop(1, M.mid);
      g.fillStyle = gr; g.fillRect(cx - a, cy - b, a * 2, b * 2);
      g.fillStyle = M.dk; g.fillRect(cx - a * 0.32, cy - b * 0.32, a * 0.64, b * 0.64);
      if (st) for (const [dx, dy] of [[-0.72, -0.72], [0, -0.72], [0.72, -0.72], [-0.72, 0], [0.72, 0], [-0.72, 0.72], [0, 0.72], [0.72, 0.72]]) stone(cx + dx * a, cy + dy * b, Math.min(a, b) * 0.2, (dx + dy) % 2 === 0);
    }
  } else {
    // Cuban: flat, tight, interlocking oval links, alternately tilted, a bright bevel on each and dark gaps between
    g.fillStyle = M.deep; g.fillRect(0, 0, W, Hh);
    const n = 4, lw = W / n;
    for (let i = 0; i < n; i++) {
      const cx = lw * (i + 0.5), tilt = i % 2 ? 0.35 : -0.35;
      g.save(); g.translate(cx, Hh / 2); g.rotate(tilt);
      const grd = g.createLinearGradient(0, -Hh * 0.45, 0, Hh * 0.45);
      grd.addColorStop(0, M.hi); grd.addColorStop(0.35, M.lt); grd.addColorStop(0.7, M.mid); grd.addColorStop(1, M.dk);
      g.fillStyle = grd; g.beginPath(); g.ellipse(0, 0, lw * 0.66, Hh * 0.47, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = M.deep; g.beginPath(); g.ellipse(0, 0, lw * 0.3, Hh * 0.13, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = M.hi; g.lineWidth = 3; g.beginPath(); g.ellipse(0, 0, lw * 0.58, Hh * 0.4, 0, Math.PI * 1.1, Math.PI * 1.75); g.stroke();
      g.restore();
      if (st) for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; stone(cx + Math.cos(a) * lw * 0.42, Hh / 2 + Math.sin(a) * Hh * 0.3, 2.6, k % 3 === 0); }
    }
  }
  return { color: c, emissive: e };
}

// a pendant's face (v0.4.8.7: from the chain's own spec, sim/bots.js chainSpec): the medallion in the chain's metal with a
// raised rim and an original RR mark (it said "16", the old name's); the iced disc paved with the chain's stones; the heart
// in the chain's metal, paved edge to edge with its stones (the heart's outline is the mesh's, athlete.js buildChain)
export function paintPendant(spec) {
  const s = typeof spec === 'string' ? { ...(LEGACY_CHAIN[spec] || LEGACY_CHAIN.gold), pendant: spec === 'ice' ? 'iced' : 'medallion' } : spec || {};
  const kind = s.pendant || (s.stone ? 'iced' : 'medallion'), M = metalRamp(s.metal || s.color);
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  const iced = kind === 'iced' || kind === 'heart', st = hexToRgb(s.stone || '#ffffff');
  const e = iced ? canvas(S, S) : null, ge = e && e.getContext('2d');
  if (ge) { ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S); }
  const grd = g.createRadialGradient(S * 0.38, S * 0.32, 10, S / 2, S / 2, S * 0.55);
  grd.addColorStop(0, M.hi); grd.addColorStop(0.5, M.mid); grd.addColorStop(1, M.dk);
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  if (kind === 'heart') {
    // stones in rows across the whole face (the mesh cuts the heart out of it), a bright metal rim round the outline
    for (let y = 14; y < S; y += 22) for (let x = 14 + ((y / 22) % 2) * 11; x < S; x += 22) {
      g.fillStyle = rgbStr(mix(st, [1, 1, 1], 0.4)); g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
      g.strokeStyle = rgbStr(shade(st, 0.6)); g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x - 3, y - 3, 2.6, 0, 7); g.fill();
      if ((x + y) % 3 === 0) { ge.fillStyle = rgbStr(mix(st, [1, 1, 1], 0.6)); ge.beginPath(); ge.arc(x - 2, y - 2, 3.4, 0, 7); ge.fill(); }
    }
    g.strokeStyle = M.hi; g.lineWidth = 10; g.beginPath();
    for (let k = 0; k <= 64; k++) { const t = k / 64 * Math.PI * 2, ox = 16 * Math.pow(Math.sin(t), 3) / 17 * 0.97, oy = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5) / 15 * 0.97; const X = S * (0.5 + ox * 0.5), Y = S * (0.5 - oy * 0.5); k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.stroke();
    return { color: c, emissive: e };
  }
  g.lineWidth = 16; g.strokeStyle = M.lt; g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4; g.strokeStyle = M.dk; g.beginPath(); g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2); g.stroke();
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
    // (the mark raised out of the face: its shadow, then the bright metal)
    g.fillStyle = M.deep; g.font = '900 96px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('RR', S / 2 + 4, S / 2 + 6);
    g.fillStyle = M.hi; g.fillText('RR', S / 2, S / 2);
  }
  return { color: c, emissive: e };
}
