// v0.4.7.5 badge art: every badge has its own glyph, and its frame grows with the tier.
//   Bronze: a plain hex medallion. Silver: a bevelled rim with rivets. Gold: a laurel wreath, a crown gem and a shine.
//   Hall of Fame: a starburst, a crown and a living, colour-shifting frame. The same Hall of Fame look (the vibrant
//   gradient, the shimmer and the glow) is used everywhere a HOF badge is shown: menus, intros, the phone, results
//   and the in-game banner.
// Archetype Icon badges each have their own silhouette, on theme for the archetype: white, with gold trim and a
// full-spectrum design inside.
// Everything is inline SVG with its own gradient ids, so a badge can be dropped into any element.
import { esc, TIER_CLS } from './common.js';

let uid = 0;
const nid = p => `${p}${(++uid).toString(36)}`;
const hexPts = (cx, cy, r, rot = -90) => Array.from({ length: 6 }, (_, i) => { const a = (rot + i * 60) * Math.PI / 180; return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`; }).join(' ');
const starPts = (cx, cy, n, r1, r2, rot = -90) => Array.from({ length: n * 2 }, (_, i) => { const r = i % 2 ? r2 : r1, a = (rot + i * 180 / n) * Math.PI / 180; return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`; }).join(' ');

// glyphs on a 24 x 24 grid, stroked with currentColor
const G = {
  deadeye: '<path d="M1.5 12C5.5 5.2 18.5 5.2 22.5 12 18.5 18.8 5.5 18.8 1.5 12Z"/><circle cx="12" cy="12" r="3.6"/><circle cx="12" cy="12" r="1" fill="currentColor"/><path d="M12 1.5v3.2M12 19.3v3.2"/>',
  catch_shoot: '<circle cx="15" cy="7" r="4.6"/><path d="M10.4 7h9.2M15 2.4v9.2"/><path d="M3 21c1.5-4.5 4-7.2 7.2-8.6"/><path d="M6.5 11.6l3.9.7-.8 3.8"/>',
  corner_specialist: '<path d="M3.5 3v17.5H21"/><path d="M3.5 8.5h3.2c6.5 1 11 5.4 12 12"/><circle cx="9.2" cy="15" r="2.4" fill="currentColor"/>',
  limitless: '<path d="M12 12c-1.8-2.9-3.7-4.6-6.1-4.6S1.5 9.4 1.5 12s1.9 4.6 4.4 4.6 4.3-1.7 6.1-4.6 3.7-4.6 6.1-4.6 4.4 2 4.4 4.6-1.9 4.6-4.4 4.6-4.3-1.7-6.1-4.6Z"/>',
  green_machine: '<circle cx="12" cy="12" r="5.6"/><path d="M12 2.2v3M12 18.8v3M2.2 12h3M18.8 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M5.1 18.9l2.1-2.1M16.8 7.2l2.1-2.1" stroke-width="2.6"/><path d="M9.4 12.2l1.8 1.9 3.5-3.9"/>',
  clutch: '<circle cx="12" cy="13.6" r="7.6"/><path d="M12 13.6V9.2M12 13.6l3 2"/><path d="M9.5 2.5h5M12 2.5v3.5M18.4 6.4l1.6-1.6"/>',
  posterizer: '<circle cx="12" cy="5.4" r="3.6"/><path d="M12 10.2v2.4M9.3 9.6l-1 1.6M14.7 9.6l1 1.6"/><path d="M3.5 14h17"/><path d="M6 14l1.8 7h8.4L18 14M9.6 14l.9 7M14.4 14l-.9 7"/>',
  contact_finisher: '<path d="M12 2.5l1.9 5 5.1-1.7-2.9 4.6 4.6 2.9-5.4.6.5 5.4-3.8-3.8-3.8 3.8.5-5.4-5.4-.6 4.6-2.9-2.9-4.6 5.1 1.7Z"/><circle cx="12" cy="11.8" r="2.2" fill="currentColor"/>',
  acrobat: '<path d="M12 21.5c-5 0-8.5-3.7-8.5-8.3S7 5.3 11.3 5.3s6.9 3 6.9 6.6-2.6 5.3-5.2 5.3-4.1-1.9-4.1-3.9 1.5-3 3-3"/><circle cx="18.4" cy="4" r="2.2" fill="currentColor"/>',
  ankle_breaker: '<path d="M4 3.5l6.5 6-5 3.5 7 7.5"/><path d="M20 3.5l-5 5 4 3-5.5 5.5"/><path d="M9 21.5h6" stroke-width="2.4"/>',
  dimer: '<circle cx="7.5" cy="12" r="5.4"/><circle cx="7.5" cy="12" r="2.6"/><path d="M14.5 12h7.5M18.5 8.5L22 12l-3.5 3.5"/>',
  handles_for_days: '<circle cx="12" cy="7.5" r="5"/><path d="M7 7.5h10M12 2.5v10"/><path d="M2 19.5c2-2.4 4-2.4 6 0s4 2.4 6 0 4-2.4 6 0"/>',
  pick_pocket: '<path d="M6.5 21v-8.5a1.8 1.8 0 013.6 0V9.3a1.8 1.8 0 013.6 0v1a1.8 1.8 0 013.6 0V16c0 3-2.2 5-5.2 5Z"/><circle cx="19.5" cy="4.5" r="2.6" fill="currentColor"/><path d="M4 6.5l2.5 1.2"/>',
  interceptor: '<path d="M2 17c4.5-6.5 10.5-9.6 19.5-10" stroke-dasharray="2.2 2.6"/><path d="M13.5 2.5v19" stroke-width="2.8"/><path d="M18.5 4l3 3-3.6 2"/>',
  rim_protector: '<path d="M12 1.8l8.5 3.2v6.4c0 5.6-3.6 9.6-8.5 11.2-4.9-1.6-8.5-5.6-8.5-11.2V5Z"/><path d="M7.5 10.5h9M8.7 10.5l1.2 5.5h4.2l1.2-5.5M11 10.5l.5 5.5M13 10.5l-.5 5.5"/>',
  chasedown: '<path d="M2 9h5.5M1.5 13h6M3 17h4.5"/><path d="M11 21.5l2.2-6.5-2.5-3.5 2.4-6"/><path d="M13.1 5.5l4.4-1.5 1.3 3.5"/><circle cx="20" cy="2.8" r="1.8" fill="currentColor"/>',
  brick_wall: '<path d="M2.5 4.5h19v15h-19Z"/><path d="M2.5 9.5h19M2.5 14.5h19M9 4.5v5M15.5 4.5v5M5.8 9.5v5M12.2 9.5v5M18.6 9.5v5M9 14.5v5M15.5 14.5v5"/>',
  rebound_chaser: '<circle cx="12" cy="12" r="4"/><path d="M8 12h8"/><path d="M3.8 11A8.3 8.3 0 0117.9 6M20.2 13A8.3 8.3 0 016.1 18"/><path d="M18.4 2.4v3.9h-3.9M5.6 21.6v-3.9h3.9"/>',
};
export const BADGE_GLYPHS = G;

const glyph = (id, color, sw = 2) => `<g transform="translate(18.2 19.2) scale(1.15)" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" color="${color}">${G[id] || '<path d="M12 3l2.6 6 6.4.5-4.9 4.2 1.5 6.3L12 16.6 6.4 20l1.5-6.3L3 9.5 9.4 9Z"/>'}</g>`;

// the Hall of Fame palette, used for every HOF badge, chip and banner (and in CSS as --hof-*)
export const HOF_COLORS = ['#ff2fb3', '#a63bff', '#3d7bff', '#00e5ff', '#38ff9c', '#ff2fb3'];
const hofStops = () => HOF_COLORS.map((c, i) => `<stop offset="${(i / (HOF_COLORS.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
const spin = (dur = 6) => `<animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="${dur}s" repeatCount="indefinite"/>`;

const METAL = {
  1: ['#f0b47f', '#c27a43', '#7a4521', '#3a1f0c'],
  2: ['#ffffff', '#d5dce5', '#8794a3', '#1d232b'],
  3: ['#fff1a8', '#f2c14e', '#a7740f', '#2b1f04'],
};

// one regular badge: id, tier 0..4, size in px
export function badgeSVG(id, tier = 0, size = 48, opts = {}) {
  const t = Math.max(0, Math.min(4, tier | 0)), a = nid('bg');
  const cap = opts.cap != null && opts.cap < 4 && t <= opts.cap ? opts.cap : null;
  let body = '';
  if (t === 0) {
    body = `<polygon points="${hexPts(32, 32, 27)}" fill="#1f2329" stroke="#3a414b" stroke-width="1.5"/>${glyph(id, '#5d6672')}`;
  } else if (t < 4) {
    const [hi, mid, lo, ink] = METAL[t];
    const defs = `<defs><linearGradient id="${a}f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".45" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
      <linearGradient id="${a}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <clipPath id="${a}c"><polygon points="${hexPts(32, 32, 27)}"/></clipPath></defs>`;
    let back = '', front = '';
    if (t === 3) {
      // laurel wreath and a crown gem
      const leaves = side => Array.from({ length: 6 }, (_, i) => { const th = (side > 0 ? 112 + i * 21 : 68 - i * 21), r = 28.5, x = 32 + r * Math.cos(th * Math.PI / 180), y = 33 + r * Math.sin(th * Math.PI / 180); return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.3" ry="5.2" transform="rotate(${(th + side * 14).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${mid}" stroke="${lo}" stroke-width=".7"/>`; }).join('');
      back = leaves(1) + leaves(-1);
      front = `<polygon points="32,1.5 35.5,6 32,10.5 28.5,6" fill="${hi}" stroke="${lo}" stroke-width="1"/><polygon points="${hexPts(32, 32, 22.5)}" fill="none" stroke="#fff6c8" stroke-opacity=".75" stroke-width="1"/>
        <g clip-path="url(#${a}c)"><rect x="-10" y="20" width="84" height="7" fill="url(#${a}s)" transform="rotate(-35 32 32)"/></g>`;
    } else if (t === 2) {
      const rivets = hexPts(32, 32, 24.2).split(' ').map(p => { const [x, y] = p.split(','); return `<circle cx="${x}" cy="${y}" r="1.6" fill="#ffffff" stroke="${lo}" stroke-width=".6"/>`; }).join('');
      back = `<polygon points="${hexPts(32, 32, 30.5)}" fill="${lo}" stroke="${hi}" stroke-width="1.2"/>`;
      front = rivets + `<g clip-path="url(#${a}c)"><rect x="-10" y="18" width="84" height="5" fill="url(#${a}s)" transform="rotate(-35 32 32)" opacity=".7"/></g>`;
    } else {
      front = `<polygon points="${hexPts(32, 32, 23)}" fill="none" stroke="${lo}" stroke-width="1.5" opacity=".8"/>`;
    }
    body = `${defs}${back}<polygon points="${hexPts(32, 32, 27)}" fill="url(#${a}f)" stroke="${lo}" stroke-width="1.5"/>${front}${glyph(id, ink, 2.2)}`;
  } else {
    // Hall of Fame: starburst + crown + living spectrum frame + deep core, white glyph with a glow
    body = `<defs><linearGradient id="${a}v" x1="0" y1="0" x2="1" y2="1">${hofStops()}${spin(6)}</linearGradient>
        <radialGradient id="${a}k" cx=".5" cy=".42" r=".65"><stop offset="0" stop-color="#4a1380"/><stop offset=".7" stop-color="#1c0838"/><stop offset="1" stop-color="#0d0420"/></radialGradient>
        <filter id="${a}g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <polygon points="${starPts(32, 33, 12, 31.5, 24.5)}" fill="url(#${a}v)" opacity=".95"/>
      <polygon points="${hexPts(32, 33, 25)}" fill="url(#${a}k)" stroke="url(#${a}v)" stroke-width="2.6"/>
      <path d="M23 9.5l2.8-6.5 3.4 4 2.8-5.5 2.8 5.5 3.4-4 2.8 6.5Z" fill="#fff" stroke="url(#${a}v)" stroke-width="1.2" stroke-linejoin="round"/>
      <g filter="url(#${a}g)"><g transform="translate(0 1)">${glyph(id, '#ffffff', 2.3)}</g></g>
      <g fill="#fff">${[[8, 14], [56, 16], [10, 52], [54, 50]].map(([x, y], i) => `<path d="M${x} ${y - 3}l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z"><animate attributeName="opacity" values="0;1;0" dur="2.2s" begin="${(i * 0.55).toFixed(2)}s" repeatCount="indefinite"/></path>`).join('')}</g>`;
  }
  const lockMark = cap != null && t === cap ? `<g><circle cx="52" cy="52" r="8" fill="#0c0e12" stroke="#59616d" stroke-width="1.4"/><path d="M48.8 51.5h6.4v5h-6.4Z M50 51.5v-1.6a2 2 0 014 0v1.6" fill="none" stroke="#c9d1d9" stroke-width="1.3"/></g>` : '';
  return `<svg class="bart t${t}${t === 4 ? ' hof-vibe' : ''}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${body}${lockMark}</svg>`;
}

// ---------------- Archetype Icon badges: white, gold trim, full-spectrum design inside ----------------
const RAINBOW = n => Array.from({ length: n }, (_, i) => `hsl(${Math.round(i * 360 / n)},100%,55%)`);
// a conic-style spectrum as wedges (SVG has no conic gradient)
const conic = (cx, cy, r, n = 24, r0 = 0) => RAINBOW(n).map((c, i) => {
  const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1.04) / n) * 2 * Math.PI - Math.PI / 2;
  const p = (a, rr) => `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  return r0 ? `<path d="M${p(a0, r0)}L${p(a0, r)}A${r} ${r} 0 0 1 ${p(a1, r)}L${p(a1, r0)}A${r0} ${r0} 0 0 0 ${p(a0, r0)}Z" fill="${c}"/>` : `<path d="M${cx} ${cy}L${p(a0, r)}A${r} ${r} 0 0 1 ${p(a1, r)}Z" fill="${c}"/>`;
}).join('');
const rainbowLin = (id, x2 = 1, y2 = 0, animate = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${RAINBOW(7).concat('hsl(360,100%,55%)').map((c, i, l) => `<stop offset="${(i / (l.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('')}${animate ? spin(9) : ''}</linearGradient>`;
const GOLD = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".45" stop-color="#e9b638"/><stop offset="1" stop-color="#9c6b09"/></linearGradient>`;
const WHITE = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe5ee"/></linearGradient>`;

const ICON_ART = {
  // Sharpshooter: a scope. White lens body, gold reticle and range ticks, a spectrum iris.
  sharp_eye: a => `<circle cx="32" cy="32" r="29" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="3"/>
    ${[0, 90, 180, 270].map(d => `<rect x="30.5" y="1" width="3" height="9" rx="1" fill="url(#${a}g)" transform="rotate(${d} 32 32)"/>`).join('')}
    <circle cx="32" cy="32" r="19.5" fill="#fff" stroke="url(#${a}g)" stroke-width="1.6"/>
    <g>${conic(32, 32, 17, 30, 6.5)}<animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="14s" repeatCount="indefinite"/></g>
    <circle cx="32" cy="32" r="6.5" fill="#0f1116"/><circle cx="29.6" cy="29.6" r="1.9" fill="#fff"/>
    <path d="M32 9v9M32 46v9M9 32h9M46 32h9" stroke="url(#${a}g)" stroke-width="2" stroke-linecap="round"/>`,
  // Slasher: a kite-shaped blade with three spectrum slashes tearing through it and a gold ball at the tip.
  hash_slinging: a => `<path d="M32 2L58 30 32 62 6 30Z" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M32 9L51 30 32 54 13 30Z" fill="none" stroke="url(#${a}g)" stroke-width="1" opacity=".7"/>
    ${[-9, 0, 9].map((o, i) => `<path d="M${16 + o} ${44 - o * 0.2}L${42 + o} ${16 - o * 0.2}" stroke="url(#${a}r)" stroke-width="${4.6 - i * 0.6}" stroke-linecap="round"/>`).join('')}
    <circle cx="32" cy="8" r="4.2" fill="url(#${a}g)" stroke="#fff" stroke-width="1"/><path d="M27.8 8h8.4M32 3.8v8.4" stroke="#7a5208" stroke-width=".8"/>`,
  // Playmaker: a crowned medallion with spectrum passing lanes radiating from a gold star.
  oprah: a => `<path d="M14 16l4-12 7 7 7-9 7 9 7-7 4 12Z" fill="url(#${a}g)" stroke="#9c6b09" stroke-width="1" stroke-linejoin="round"/>
    <circle cx="32" cy="38" r="24" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="3"/>
    ${RAINBOW(8).map((c, i) => { const ang = i * 45; return `<g transform="rotate(${ang} 32 38)"><path d="M32 30V18" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/><path d="M28.5 21.5L32 16.5l3.5 5" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>`; }).join('')}
    <polygon points="${starPts(32, 38, 5, 7.5, 3.4)}" fill="url(#${a}g)" stroke="#9c6b09" stroke-width=".8"/>
    ${[18, 25, 32, 39, 46].map(x => `<circle cx="${x}" cy="${x === 32 ? 3 : x === 25 || x === 39 ? 9.5 : 12}" r="1.6" fill="#fff"/>`).join('')}`,
  // Lockdown: a shield held in a vise. Gold jaws and screw, spectrum bars squeezed between them.
  the_clamp: a => `<path d="M32 3l24 8v18c0 16-10 26-24 32C18 55 8 45 8 29V11Z" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="3" stroke-linejoin="round"/>
    <clipPath id="${a}cl"><path d="M32 8l19 6.5v14.5c0 13-8 21.5-19 26.5-11-5-19-13.5-19-26.5V14.5Z"/></clipPath>
    <g clip-path="url(#${a}cl)">${RAINBOW(7).map((c, i) => `<rect x="22" y="${12 + i * 6.4}" width="20" height="5.2" rx="1" fill="${c}"/>`).join('')}</g>
    <rect x="3" y="20" width="16" height="22" rx="2.5" fill="url(#${a}g)" stroke="#7a5208" stroke-width="1"/><rect x="45" y="20" width="16" height="22" rx="2.5" fill="url(#${a}g)" stroke="#7a5208" stroke-width="1"/>
    <path d="M7 24v14M11 24v14M15 24v14M49 24v14M53 24v14M57 24v14" stroke="#7a5208" stroke-width="1" opacity=".6"/>
    <rect x="26" y="0.5" width="12" height="5" rx="1.5" fill="url(#${a}g)" stroke="#7a5208" stroke-width=".8"/>`,
  // Two-Way: a general's star over three spectrum chevrons, framed by a gold wreath.
  the_general: a => `${[1, -1].map(side => Array.from({ length: 7 }, (_, i) => { const th = side > 0 ? 100 + i * 22 : 80 - i * 22, r = 27, x = 32 + r * Math.cos(th * Math.PI / 180), y = 34 + r * Math.sin(th * Math.PI / 180); return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.5" ry="5.6" transform="rotate(${(th + side * 16).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="url(#${a}g)" stroke="#9c6b09" stroke-width=".6"/>`; }).join('')).join('')}
    <polygon points="${starPts(32, 24, 5, 21, 9)}" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="2.6" stroke-linejoin="round"/>
    <polygon points="${starPts(32, 24, 5, 8, 3.6)}" fill="url(#${a}r)"/>
    ${[0, 1, 2].map(i => `<path d="M16 ${43 + i * 6.5}L32 ${36 + i * 6.5} 48 ${43 + i * 6.5}" fill="none" stroke="${['hsl(0,100%,55%)', 'hsl(130,100%,45%)', 'hsl(220,100%,58%)'][i]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 ${43 + i * 6.5}L32 ${36 + i * 6.5} 48 ${43 + i * 6.5}" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".7"/>`).join('')}`,
  // Glass Cleaner: a backboard in white glass with a spectrum shooter's square, gold rim and net, and a hand
  // owning the glass.
  big_brother: a => `<rect x="4" y="4" width="56" height="38" rx="5" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="3"/>
    <rect x="20" y="14" width="24" height="17" rx="1.5" fill="none" stroke="url(#${a}r)" stroke-width="3.4"/>
    <path d="M10 10l9 26M14 9l6 18" stroke="#fff" stroke-width="2" opacity=".85"/>
    <ellipse cx="32" cy="45" rx="12" ry="3.4" fill="none" stroke="url(#${a}g)" stroke-width="3"/>
    <path d="M21 46l4 15M27 47.5l1.6 13.5M37 47.5L35.4 61M43 46l-4 15M24 54h16" stroke="url(#${a}g)" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M47 33v-9a2 2 0 014 0v-2.5a2 2 0 014 0V24a2 2 0 014 0v9c0 4-3 7-7 7h-3" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="1.6" stroke-linejoin="round"/>`,
  // Stretch Big: wings spread wide around a spectrum range arc (the three-point line) with a gold ball at its heart.
  open_arms: a => `${[1, -1].map(s => [0, 1, 2, 3].map(i => `<path d="M32 30 C${32 + s * (10 + i * 3)} ${18 - i * 2} ${32 + s * (20 + i * 3)} ${14 + i * 4} ${32 + s * (30 - i)} ${12 + i * 7} C${32 + s * (22 + i * 2)} ${24 + i * 3} ${32 + s * (14 + i)} ${30 + i * 2} 32 ${34 + i}Z" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="${i === 0 ? 2.4 : 1.4}" stroke-linejoin="round"/>`).join('')).join('')}
    <path d="M10 56A22 22 0 0154 56" fill="none" stroke="url(#${a}r)" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M10 56A22 22 0 0154 56" fill="none" stroke="#fff" stroke-width="1" opacity=".6"/>
    <circle cx="32" cy="42" r="8" fill="url(#${a}g)" stroke="#fff" stroke-width="1.6"/><path d="M24.5 42h15M32 34.5v15M26.5 36.5c3 3 3 8 0 11M37.5 36.5c-3 3-3 8 0 11" fill="none" stroke="#7a5208" stroke-width="1"/>`,
  // Post Scorer: a heart-shaped shield with a spectrum rose blooming from the low block, gold trim and stem.
  sexy_red: a => `<path d="M32 59C14 46 4 35 4 21 4 11 11 4 20 4c5.5 0 9.5 2.8 12 7 2.5-4.2 6.5-7 12-7 9 0 16 7 16 17 0 14-10 25-28 38Z" fill="url(#${a}w)" stroke="url(#${a}g)" stroke-width="3" stroke-linejoin="round"/>
    ${RAINBOW(10).map((c, i) => { const ang = i * 36, r = 7.5; return `<ellipse cx="32" cy="${25 - r}" rx="5.2" ry="8" fill="${c}" opacity=".92" transform="rotate(${ang} 32 25)"/>`; }).join('')}
    ${RAINBOW(6).map((c, i) => `<ellipse cx="32" cy="21.5" rx="3" ry="4.6" fill="${c}" transform="rotate(${i * 60 + 30} 32 25)"/>`).join('')}
    <circle cx="32" cy="25" r="3" fill="url(#${a}g)" stroke="#fff" stroke-width=".8"/>
    <path d="M32 36v14" stroke="url(#${a}g)" stroke-width="2.6" stroke-linecap="round"/><path d="M32 44c-4-1-6.5-3.5-7-6.5 3.5 0 6 2 7 5M32 46c4-1 6.5-3.5 7-6.5-3.5 0-6 2-7 5" fill="url(#${a}g)"/>
    <rect x="25" y="50" width="14" height="5" rx="1" fill="url(#${a}g)" stroke="#7a5208" stroke-width=".8"/>`,
};
export const ICON_ART_IDS = Object.keys(ICON_ART);

export function iconBadgeSVG(id, size = 64, opts = {}) {
  const a = nid('ib'), art = ICON_ART[id] || ICON_ART.the_general;
  const locked = !!opts.locked;
  return `<svg class="bart icon-art${locked ? ' locked' : ''}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs>${GOLD(`${a}g`)}${WHITE(`${a}w`)}${rainbowLin(`${a}r`, 1, 1, !locked)}</defs>${art(a)}</svg>`;
}

// a badge chip (name with its mini icon) for lists: intros, the phone, results
export function badgeChip(id, tier, name, opts = {}) {
  return `<span class="ib ${TIER_CLS[tier] || 'none'}${opts.extra ? ` ${opts.extra}` : ''}">${badgeSVG(id, tier, opts.size || 15)}<span>${esc(name)}</span></span>`;
}
