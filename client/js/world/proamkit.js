// v0.4.8.9 qp14: a Pro-Am team's kit and logo, the same everywhere they show. The team page's Jerseys pick (server/proam.py
// keys: classic, stripe, split, gradient) used to be saved and never worn: every Pro-Am game, the HUB's home-court runs and
// the Pro-Am menu put the team in the same side-panel jersey. Now each pick is its own kit, painted by char/looks.js:
//   Classic   the team's color with side panels and trim in the second color, a stripe down the shorts' sides
//   Stripe    a bold band of the second color round the waist between two pinlines, under the number; a band round
//             each leg of the shorts above the hem
//   Split     the wearer's right side in the team's color, the left in the second, front and back, the shorts too;
//             the letters in an ink that reads on both
//   Fade      the team's color at the shoulders melting into the second color at the hem; the shorts' legs fade the same
// The menus draw the same kit flat (drawKit) and the logo (logoURL) so what you pick is what you see in the game.
import { drawLogo, canvas } from '../gfx/textures.js';
import { PA_BAND } from '../char/looks.js';

export const JERSEYS = [['classic', 'Classic'], ['stripe', 'Stripe'], ['split', 'Split'], ['gradient', 'Fade']];
const PATTERN = { classic: 'panel', stripe: 'pa_stripe', split: 'pa_split', gradient: 'pa_fade' };
export const kitKey = j => (PATTERN[j] ? j : 'classic');

const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255); };
const lumin = h => { const [r, g, b] = rgb(h).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const x = lumin(a), y = lumin(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// the ink that reads on both of the team's colors (the Split's letters cross from one to the other)
export function bothInk(c1, c2) {
  const inks = ['#ffffff', '#111317'];
  const score = k => Math.min(contrast(k, c1), contrast(k, c2));
  return score(inks[0]) >= score(inks[1]) ? inks[0] : inks[1];
}

const otherInk = k => (k === '#ffffff' ? '#111317' : '#ffffff');
// the look's top and bottom for a team (brand: {primary, secondary, abbr, jersey}) and a jersey number. Classic is
// exactly the uniform every Pro-Am game wore before (pattern 'panel', the second color for trim, panels and numbers)
export function paKit(b, number) {
  const j = kitKey(b?.jersey), c1 = b?.primary || '#2457c5', c2 = b?.secondary || '#f2c14e';
  const top = { family: 'jersey', color: c1, trim: c2, secondary: c2, pattern: PATTERN[j], lettering: b?.abbr, tucked: true };
  const bottom = { family: 'shorts', color: c1, trim: c2, stripe: c2 };
  if (j === 'split') { const ink = bothInk(c1, c2); top.numInk = ink; top.numEdge = otherInk(ink); } // (edged in the other ink: sharp on both halves)
  if (j !== 'classic') { bottom.pattern = PATTERN[j]; bottom.secondary = c2; delete bottom.stripe; }
  return { top, bottom, ...(number !== undefined ? { number } : {}) };
}

// ---------------- the menus ----------------
// the team's logo as an image (a data URL, kept per look), for the team rows, the page heads and the pickers
const urls = new Map();
export function logoURL(t, px = 96) {
  const shape = t?.logo || 'circle', key = [shape, t?.primary, t?.secondary, t?.abbr, px].join('|');
  if (urls.has(key)) return urls.get(key);
  let url = '';
  try {
    // (a page canvas: an OffscreenCanvas has no toDataURL)
    const c = typeof document !== 'undefined' && document.createElement ? Object.assign(document.createElement('canvas'), { width: px, height: px }) : canvas(px, px), g = c.getContext('2d');
    drawLogo(g, { shape, color: t?.primary || '#2457c5', accent: t?.secondary || '#f2c14e', text: String(t?.abbr || '').slice(0, 4).toUpperCase(), alpha: 1 }, px / 2, px / 2, px * 0.46);
    url = c.toDataURL ? c.toDataURL() : '';
  } catch { url = ''; }
  if (urls.size > 200) urls.delete(urls.keys().next().value);
  urls.set(key, url);
  return url;
}

// the kit drawn flat, front on (a jersey over shorts), the same patterns the game paints on the player
export function drawKit(g, W, H, b, number = 23) {
  const j = kitKey(b?.jersey), c1 = b?.primary || '#2457c5', c2 = b?.secondary || '#f2c14e';
  g.clearRect(0, 0, W, H);
  const s = Math.min(W / 200, H / 260), ox = W / 2;
  const X = x => ox + x * s, Y = y => y * s;
  // the jersey: a tank top, x -60..60, the collar at 18, the hem at 150 (the front's middle at x 0; the wearer's left
  // side is the viewer's right)
  const tank = () => { g.beginPath(); g.moveTo(X(-26), Y(14)); g.quadraticCurveTo(X(0), Y(44), X(26), Y(14)); g.lineTo(X(44), Y(14)); g.quadraticCurveTo(X(46), Y(52), X(62), Y(64)); g.lineTo(X(60), Y(150)); g.lineTo(X(-60), Y(150)); g.lineTo(X(-62), Y(64)); g.quadraticCurveTo(X(-46), Y(52), X(-44), Y(14)); g.closePath(); };
  const shorts = () => { g.beginPath(); g.moveTo(X(-58), Y(150)); g.lineTo(X(58), Y(150)); g.lineTo(X(66), Y(240)); g.lineTo(X(6), Y(240)); g.lineTo(X(0), Y(196)); g.lineTo(X(-6), Y(240)); g.lineTo(X(-66), Y(240)); g.closePath(); };
  const T0 = 14, T1 = 150, ty = f => Y(T0 + (T1 - T0) * f);
  // shorts first (the jersey hangs over their waistband)
  g.save(); shorts(); g.clip();
  g.fillStyle = c1; g.fillRect(0, Y(150), W, H);
  if (j === 'split') { g.fillStyle = c2; g.fillRect(X(0), Y(150), W, H); }
  if (j === 'gradient') { const gr = g.createLinearGradient(0, Y(196), 0, Y(240)); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, Y(190), W, H); }
  if (j === 'stripe') { g.fillStyle = c2; g.fillRect(0, Y(222), W, Y(7) - Y(0)); g.fillRect(0, Y(217), W, Y(2) - Y(0)); }
  if (j === 'classic') { g.fillStyle = c2; for (const x of [-62, 54]) { g.save(); g.translate(X(x), 0); g.fillRect(0, Y(150), 8 * s, Y(90)); g.restore(); } }
  // the hems (the Split's in the other side's color) and the waistband
  g.fillStyle = c2; g.fillRect(0, Y(234), X(0), Y(6)); g.fillStyle = j === 'split' ? c1 : c2; g.fillRect(X(0), Y(234), W, Y(6));
  g.fillStyle = c2; g.fillRect(0, Y(150), X(0), Y(5)); g.fillStyle = j === 'split' ? c1 : c2; g.fillRect(X(0), Y(150), W, Y(5));
  g.restore();
  g.save(); tank(); g.clip();
  g.fillStyle = c1; g.fillRect(0, 0, W, H);
  if (j === 'classic') { g.fillStyle = c2; g.fillRect(X(-62), 0, 9 * s, H); g.fillRect(X(53), 0, 9 * s, H); }
  if (j === 'split') { g.fillStyle = c2; g.fillRect(X(0), 0, W, H); }
  if (j === 'gradient') { const gr = g.createLinearGradient(0, ty(0.32), 0, ty(0.96)); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, ty(0.32), W, H); }
  if (j === 'stripe') { g.fillStyle = c2; g.fillRect(0, ty(PA_BAND[0]), W, ty(PA_BAND[1]) - ty(PA_BAND[0])); for (const f of [PA_BAND[0] - 0.035, PA_BAND[1] + 0.035]) g.fillRect(0, ty(f) - 1.2 * s, W, 2.4 * s); }
  g.restore();
  // the trim round the collar, arms and hem (the Split's in the other side's color)
  g.lineWidth = 4 * s; g.lineJoin = 'round';
  const trimOn = left => (j === 'split' && left ? c1 : c2);
  for (const left of [false, true]) {
    g.save(); g.beginPath(); g.rect(left ? X(0) : 0, 0, left ? W : X(0), H); g.clip();
    g.strokeStyle = trimOn(left); tank(); g.stroke();
    g.restore();
  }
  // the letters and the number (the Split's in the ink for both colors)
  const ink = j === 'split' ? bothInk(c1, c2) : c2, edge = j === 'split' ? otherInk(ink) : c2;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink; g.strokeStyle = edge; g.lineJoin = 'round';
  const abbr = String(b?.abbr || '').slice(0, 4).toUpperCase();
  const word = (txt, px, y) => { g.font = `900 ${px * s}px "Arial Black", Impact, sans-serif`; if (edge !== ink) { g.lineWidth = px * s * 0.14; g.strokeText(txt, X(0), y); } g.fillText(txt, X(0), y); };
  // (where the game's jersey puts them: the letters high on the chest, the number under them, above the Stripe's band)
  if (abbr) word(abbr, 14, ty(0.2));
  word(String(number), 32, ty(0.37));
}
