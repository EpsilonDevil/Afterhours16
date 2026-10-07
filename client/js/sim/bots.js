// Seeded AI hooper generation (legal builds, cosmetics from the catalog, tendencies).
import { RNG } from '../core/rng.js';
import { POSITIONS, ARCHETYPES, ARCH_BONUS, caps } from './builds.js';
import { ATTRS, overall } from './ratings.js';

const FIRST = ['Milo', 'Jules', 'Rio', 'Dante', 'Ellis', 'Kai', 'Ari', 'Nico', 'Zion', 'Remy', 'Cole', 'Devon', 'Marcus', 'Theo', 'Andre', 'Isaiah', 'Quinn', 'Jalen', 'Omari', 'Tariq', 'Bryce', 'Malik', 'Reggie', 'Jace', 'Darius', 'Eli', 'Rashad', 'Kendrick', 'Luca', 'Mateo', 'Nate', 'Shawn', 'Tyrell', 'Victor', 'Wes', 'Xavier', 'Yusuf', 'Zeke', 'Caleb', 'Desmond'];
const LAST = ['Banks', 'Moss', 'Vega', 'Knox', 'Reed', 'Mercer', 'Stone', 'Wells', 'Hale', 'Park', 'Ash', 'Lake', 'Carter', 'Brooks', 'Hayes', 'Price', 'Gaines', 'Ford', 'Rowe', 'Shaw', 'Cruz', 'Dorsey', 'Ellison', 'Fields', 'Grant', 'Holloway', 'Irving', 'Jett', 'Kerr', 'Lyons', 'Monroe', 'Nash', 'Ortiz', 'Pruitt', 'Quarles', 'Rhodes', 'Sims', 'Tate', 'Vaughn', 'Webb'];
const HANDLES = ['Cash', 'Lefty', 'Smooth', 'Bucket', 'Skyline', 'Ghost', 'Flash', 'Ice', 'Tank', 'Splash', 'Dime', 'Glide', 'Hops', 'Truth', 'Silk', 'Rook', 'Static', 'Volt'];
export const SKIN = ['#efc5a2', '#d9a77c', '#bc865e', '#a56945', '#875332', '#69432e', '#513528', '#3d2b24'];
export const HAIR = ['crop', 'curls', 'buzz', 'bald', 'fade', 'twists', 'high_top', 'cornrows', 'waves'];
export const HAIR_COLORS = ['#201b19', '#493021', '#85502e', '#c39a58', '#c5c1b6'];
export const FACES = ['oval', 'square', 'angular', 'round'];
export const BEARDS = ['none', 'stubble', 'goatee', 'full'];
const POS_ARCH = { PG: ['playmaker', 'sharpshooter', 'slasher', 'lockdown'], SG: ['sharpshooter', 'slasher', 'two_way', 'lockdown'], SF: ['two_way', 'slasher', 'sharpshooter', 'lockdown'], PF: ['stretch_big', 'glass_cleaner', 'post_scorer', 'two_way'], C: ['glass_cleaner', 'post_scorer', 'stretch_big'] };

// v0.4.3: archetype tendencies (0..1) that drive how the AI plays a build on both ends.
//  shoot/drive/pass/dribble: what the handler looks for · cut: off-ball cuts · spot: relocating to open arc
//  spots · pop: pick-and-pop instead of roll · post: back down toward the block · crash: offensive glass ·
//  help: rotating to help and anchoring the paint · press: on-ball pressure · safe: avoiding risky plays
const TEND = {
  sharpshooter: { shoot: 0.88, drive: 0.28, pass: 0.4, dribble: 0.35, cut: 0.2, spot: 0.95, pop: 0.6, post: 0.02, crash: 0.12, help: 0.3, press: 0.45, safe: 0.6 },
  slasher: { shoot: 0.3, drive: 0.92, pass: 0.35, dribble: 0.55, cut: 0.85, spot: 0.2, pop: 0.1, post: 0.1, crash: 0.45, help: 0.35, press: 0.5, safe: 0.45 },
  playmaker: { shoot: 0.38, drive: 0.55, pass: 0.92, dribble: 0.92, cut: 0.25, spot: 0.45, pop: 0.3, post: 0.02, crash: 0.12, help: 0.35, press: 0.55, safe: 0.75 },
  lockdown: { shoot: 0.42, drive: 0.42, pass: 0.5, dribble: 0.35, cut: 0.4, spot: 0.55, pop: 0.3, post: 0.05, crash: 0.3, help: 0.6, press: 0.95, safe: 0.7 },
  two_way: { shoot: 0.55, drive: 0.55, pass: 0.5, dribble: 0.5, cut: 0.45, spot: 0.5, pop: 0.35, post: 0.2, crash: 0.4, help: 0.55, press: 0.65, safe: 0.6 },
  glass_cleaner: { shoot: 0.15, drive: 0.25, pass: 0.5, dribble: 0.08, cut: 0.4, spot: 0, pop: 0, post: 0.45, crash: 0.97, help: 0.97, press: 0.35, safe: 0.9 },
  stretch_big: { shoot: 0.72, drive: 0.3, pass: 0.5, dribble: 0.2, cut: 0.3, spot: 0.75, pop: 0.92, post: 0.25, crash: 0.5, help: 0.78, press: 0.4, safe: 0.7 },
  post_scorer: { shoot: 0.32, drive: 0.35, pass: 0.4, dribble: 0.2, cut: 0.5, spot: 0.05, pop: 0.05, post: 0.95, crash: 0.7, help: 0.72, press: 0.35, safe: 0.65 },
};
export function tendenciesFor(build, rng = null) {
  const arch = build.archetype || ({ outside: 'sharpshooter', inside: 'slasher' }[build.style]) || 'two_way';
  const base = TEND[arch] || TEND.two_way, out = {};
  for (const k in base) out[k] = Math.max(0, Math.min(1, base[k] + (rng ? rng.range(-0.08, 0.08) : 0)));
  return out;
}

// v0.4.3: AI hoopers carry badges that fit their archetype (shown in game intros, and they work in game)
const BADGE_POOL = {
  sharpshooter: ['deadeye', 'catch_shoot', 'corner_specialist', 'limitless', 'green_machine', 'clutch'],
  slasher: ['posterizer', 'contact_finisher', 'acrobat', 'ankle_breaker', 'chasedown'],
  playmaker: ['dimer', 'handles_for_days', 'ankle_breaker', 'catch_shoot', 'pick_pocket'],
  lockdown: ['pick_pocket', 'interceptor', 'chasedown', 'brick_wall', 'clutch'],
  two_way: ['deadeye', 'pick_pocket', 'contact_finisher', 'interceptor', 'clutch'],
  glass_cleaner: ['rebound_chaser', 'rim_protector', 'brick_wall', 'posterizer', 'chasedown'],
  stretch_big: ['catch_shoot', 'limitless', 'rim_protector', 'rebound_chaser', 'deadeye'],
  post_scorer: ['contact_finisher', 'brick_wall', 'rebound_chaser', 'posterizer', 'acrobat'],
};
export function botBadges(archetype, level, rng) {
  const pool = [...(BADGE_POOL[archetype] || BADGE_POOL.two_way)];
  // v0.4.4: badge count and tiers follow skill much more closely: casual hoopers carry zero to two
  // low-tier badges, park legends carry a full set with Hall of Fame signatures
  const count = Math.max(0, Math.min(pool.length, Math.round(level * 5.6 - 0.4 + rng.range(-0.7, 0.7))));
  const badges = {}, use = {};
  for (let i = 0; i < count; i++) {
    // earlier badges in the pool are the archetype's signature ones, so they tend to be the best and most used
    const k = pool.splice(i === 0 ? 0 : rng.int(0, pool.length - 1), 1)[0];
    const tier = Math.max(1, Math.min(4, Math.round(0.6 + level * 3.1 + rng.range(-0.75, 0.75) - i * 0.25 + (i === 0 ? 0.35 : 0))));
    badges[k] = tier; use[k] = Math.round((tier * 60 + rng.range(0, 80)) * (i === 0 ? 1.6 : 1) * (0.5 + level));
  }
  return { badges, use };
}

// v0.4.4: the attributes an archetype is built around (its two biggest bonuses)
export function signatureAttrs(archetype) {
  return Object.entries(ARCH_BONUS[archetype] || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
}
// can this build equip the item (same rules the server applies to a player's purchases)
export function canEquip(item, attributes, ovr, rep) {
  if (!item) return false;
  if ((item.rep_required || 0) > rep || (item.min_overall || 0) > ovr) return false;
  for (const [k, v] of Object.entries(item.min_attr || {})) if ((attributes[k] ?? 0) < v) return false;
  return true;
}

// level: 0..1 overall strength (0.15 ≈ 60 OVR casual, 0.5 ≈ 72, 0.8 ≈ 82, 1 ≈ maxed build)
// opts.rep: rep level 0..20 (unlocks gear); opts.flash: how much he spends on flashy gear and animations
export function makeBot(rng, opts = {}) {
  const position = opts.position || rng.pick(['PG', 'SG', 'SF', 'PF', 'C']);
  const [lo, hi] = POSITIONS[position];
  const height = rng.int(lo, hi);
  const weight = Math.round(150 + (height - 67) * 6.2 + rng.range(-15, 30));
  const wingspan = height + rng.int(0, 7);
  const archetype = opts.archetype || rng.pick(POS_ARCH[position]);
  const build = { position, height, weight, wingspan, archetype };
  const c = caps(build);
  const level = Math.max(0, Math.min(1, opts.level ?? 0.55));
  const sig = signatureAttrs(archetype);
  const attributes = {};
  // v0.4.4: a much wider spread. Low-level hoopers sit near the floor of their build, high-level ones near the
  // caps, and everyone is noticeably better at the things his archetype is built around.
  for (const k of ATTRS) {
    const top = c[k], low = Math.max(30, Math.round(top * 0.6));
    let f = level + rng.range(-0.16, 0.1);
    if (sig.includes(k)) f += 0.1 + level * 0.12;
    attributes[k] = Math.max(30, Math.min(top, Math.round(low + (top - low) * Math.max(0, Math.min(1, f)))));
  }
  build.attributes = attributes;
  const ovr = overall(attributes, position);
  const rep = opts.rep ?? 8, flash = Math.max(0, Math.min(1, opts.flash ?? level));
  const cat = opts.catalog || {};
  const items = Object.values(cat);
  const bySlot = slot => items.filter(i => i.slot === slot && !i.exclusive && canEquip(i, attributes, ovr, rep));
  // pricier (flashier) gear and animations are more likely the more he plays and spends
  const pick = (slot, fallback) => {
    const l = bySlot(slot);
    if (!l.length) return fallback;
    const w = l.map(i => 1 + Math.pow((i.price || 0) / 8000, 0.8) * flash * 2.2 + (i.rep_required || 0) * 0.08 * flash);
    let r = rng.next() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < l.length; i++) { r -= w[i]; if (r <= 0) return l[i].id; }
    return l[l.length - 1].id;
  };
  const eq = {
    top: pick('top', 'yard_teal'), bottom: pick('bottom', 'yard_shorts'), shoes: pick('shoes', 'yard_shoes'),
    release: pick('release', 'release_classic'), jumpshot: pick('jumpshot', 'js_base_standard'), dunk: pick('dunk', 'dunk_basic'),
    sizeup: pick('sizeup', 'sizeup_basic'),
  };
  // wheel exclusives: a few of the regulars have hit on the wheel
  const wheel = items.filter(i => i.exclusive === 'wheel' && ['jumpshot', 'release', 'dunk'].includes(i.slot));
  if (wheel.length && rng.next() < 0.04 + flash * 0.12) { const w = rng.pick(wheel); eq[w.slot] = w.id; }
  if (rng.next() < 0.6) eq.socks = pick('socks', 'socks_white');
  if (rng.next() < 0.35) eq.headband = pick('headband', 'band_lime');
  if (rng.next() < 0.3) eq.sleeve = pick('sleeve', 'sleeve_ink');
  if (rng.next() < 0.25) eq.wristband = pick('wristband', 'wrist_white');
  if (rng.next() < 0.12) eq.leg_sleeve = pick('leg_sleeve', 'leg_sleeve_black');
  if (rng.next() < 0.08) eq.knee_pad = 'knee_black';
  const chains = items.filter(i => i.slot === 'chain');
  if (chains.length && rng.next() < 0.05 + flash * 0.3) eq.chain = rng.pick(chains).id;
  if (rng.next() < 0.5) eq.celebration = pick('celebration', 'celly_flex');
  build.equipment = eq;
  build.hand = rng.next() < 0.12 ? 'L' : 'R';
  build.tendencies = tendenciesFor(build, rng);
  const first = rng.pick(FIRST), last = rng.pick(LAST);
  const name = opts.name || (rng.next() < 0.25 ? rng.pick(HANDLES) : `${first} ${last}`);
  const appearance = {
    skin: rng.pick(SKIN), hair: rng.pick(HAIR), hair_color: rng.next() < 0.85 ? HAIR_COLORS[rng.int(0, 1)] : rng.pick(HAIR_COLORS),
    face: rng.pick(FACES), beard: rng.pick(BEARDS), number: rng.int(0, 55),
  };
  build.name = name;
  build.appearance = appearance;
  build.overall = ovr;
  const bb = botBadges(archetype, level, rng);
  return { build, name, number: appearance.number, appearance, badges: bb.badges, badgeUse: bb.use, level };
}

export function makeTeam(rng, size, opts = {}) {
  const order = size >= 5 ? ['PG', 'SG', 'SF', 'PF', 'C'] : size === 4 ? ['PG', 'SG', 'SF', 'PF'] : size === 3 ? ['PG', 'SF', 'C'] : size === 2 ? ['PG', 'PF'] : ['SF'];
  return order.map(position => makeBot(rng, { ...opts, position }));
}

// v0.4.3: which original sneaker model a shoe item is (picks its texture design)
export function shoeModel(id) {
  id = id || '';
  if (id.includes('vanta')) return 'vanta';
  if (id.includes('strata')) return 'strata';
  if (id.includes('kinetic') || id.includes('lava')) return 'kinetic';
  if (id.includes('retro')) return 'retro';
  if (id.includes('legend')) return 'legend';
  if (id.includes('high')) return 'rise';
  if (id.includes('low')) return 'cutlow';
  if (id.includes('coral') || id.includes('lime')) return 'lateshift';
  return 'basic';
}

// Resolve visual look from appearance + equipment ids
export function resolveLook(build, catalog, override = {}) {
  const ap = build.appearance || {};
  const eq = build.equipment || {};
  const item = id => (id && catalog[id]) || null;
  const top = override.top || item(eq.top) || { family: 'jersey', color: '#46aaa4', trim: '#ede4d3', pattern: 'panel', lettering: 'YARD' };
  const bottom = override.bottom || item(eq.bottom) || { family: 'shorts', color: '#26303a', trim: '#ede4d3' };
  const shoes = item(eq.shoes) || { color: '#f2f2f2', accent: '#3fb6a8', sole: '#f5f5f0', cut: 'mid' };
  const g = { shoes: { color: shoes.color, accent: shoes.accent, sole: shoes.sole, cut: shoes.cut || 'mid', lace: shoes.lace, trim: shoes.trim, model: shoeModel(shoes.id || eq.shoes) } };
  if (item(eq.socks)) g.socks = { color: item(eq.socks).color, style: item(eq.socks).style };
  if (item(eq.headband)) g.headband = { color: item(eq.headband).color };
  if (item(eq.sleeve)) g.sleeve = { color: item(eq.sleeve).color, side: build.hand === 'L' ? 'L' : 'R' };
  if (item(eq.wristband)) g.wristband = { color: item(eq.wristband).color };
  if (item(eq.leg_sleeve)) g.legSleeve = { color: item(eq.leg_sleeve).color, side: 'L' };
  if (item(eq.knee_pad)) g.kneePad = { color: item(eq.knee_pad).color, side: 'R' };
  if (item(eq.chain)) g.chain = { kind: /ice/.test(eq.chain) ? 'ice' : 'gold', color: item(eq.chain).color };
  return {
    skin: ap.skin, hair: ap.hair, hair_color: ap.hair_color, face: ap.face, beard: ap.beard,
    number: override.number ?? ap.number ?? 0, name: (override.name ?? build.name ?? '').split(' ').slice(-1)[0],
    top: { ...top, tucked: override.tucked }, bottom, gear: g,
  };
}
