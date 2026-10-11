// v0.4.7.5 quick patch 3: block animations. Thirty styles in five tiers, like the size-up and jump-shot packages, but
// nothing to buy: the tier comes from the Block rating and height, and each block picks a style from the tier that
// fits the moment (a chase-down, a rim protection, a perimeter closeout, or any). The higher the tier, the more
// emphatic and flashy the block. The animator reads the style's spec (char/animator.js blockPose).
//
// Spec fields (all read by blockPose):
//   lead   'one' | 'two' | 'cross' | 'far'   which hand(s) go for the ball (cross: the off hand crosses over the
//                                           lead side; far: the off hand reaches past the lead side)
//   cock   0..1   how far the swatting arm pulls back behind the shoulder before it fires
//   swat   'none' | 'down' | 'across' | 'wipe' | 'pin' | 'snatch' | 'clap' | 'hammer' | 'volley'
//   off    'wide' | 'tuck' | 'shield' | 'mirror' | 'high' | 'back'   the off hand
//   lean   [roll, pitch]   torso: roll toward the ball (× side), pitch (− arches back, + bends forward)
//   twist  0..1   chest turned toward the ball side
//   legs   'tuck' | 'split' | 'straight' | 'kick' | 'pike' | 'scissor'
//   land   'none' | 'wag' | 'stare' | 'flex' | 'point' | 'roar' | 'dust'   after the landing
//   spread two-hand styles: how far apart the hands are (m, reference units); reachZ: how far in front of the head
//          the hands reach (− straight overhead, + out front); headUp: how far the head tips back to watch it
//   emph   scale of everything (0.85 quiet .. 1.3 huge)
//   situ   ['chase' | 'rim' | 'perim' | 'any']   which moments it fits
export const BLOCK_TIER_MIN = [0, 0, 55, 70, 85, 95]; // tier 1..5 by Block rating
export const BLOCK_TALL = 83, BLOCK_SHORT = 73;        // inches: a +1 / −1 tier bump

export const BLOCK_STYLES = [
  // ---- tier 1: the basics ----
  { id: 'reach', name: 'Reach', tier: 1, lead: 'one', cock: 0.0, swat: 'none', off: 'wide', lean: [0.1, 0], twist: 0.1, legs: 'split', land: 'none', emph: 0.9, reachZ: 0.12, situ: ['any', 'perim'] },
  { id: 'straight_up', name: 'Straight Up', tier: 1, lead: 'two', cock: 0.0, swat: 'none', off: 'mirror', lean: [0, 0], twist: 0, legs: 'straight', land: 'none', emph: 0.9, spread: 0.24, reachZ: -0.12, headUp: 0.35, situ: ['any', 'rim'] },
  { id: 'late_hand', name: 'Late Hand', tier: 1, lead: 'one', cock: 0.15, swat: 'down', off: 'tuck', lean: [0.05, 0.1], twist: 0.2, legs: 'split', land: 'none', emph: 0.85, reachZ: 0.1, situ: ['any', 'perim'] },
  { id: 'wall', name: 'Two-Hand Wall', tier: 1, lead: 'two', cock: 0.0, swat: 'pin', off: 'mirror', lean: [0, 0.05], twist: 0, legs: 'tuck', land: 'none', emph: 0.95, spread: 0.62, reachZ: 0.28, situ: ['any', 'rim'] },
  { id: 'side_reach', name: 'Side Reach', tier: 1, lead: 'one', cock: 0.0, swat: 'across', off: 'shield', lean: [0.3, 0], twist: 0.35, legs: 'kick', land: 'none', emph: 0.9, situ: ['any', 'chase'] },
  { id: 'stand_tall', name: 'Stand Tall', tier: 1, lead: 'one', cock: 0.0, swat: 'none', off: 'high', lean: [0, -0.2], twist: 0, legs: 'tuck', land: 'none', emph: 0.9, reachZ: -0.08, headUp: 0.25, situ: ['any', 'rim'] },
  // ---- tier 2 ----
  { id: 'volleyball', name: 'Volleyball', tier: 2, lead: 'one', cock: 0.35, swat: 'volley', off: 'back', lean: [0.1, 0.15], twist: 0.25, legs: 'kick', land: 'none', emph: 1.0, reachZ: 0.2, situ: ['any', 'perim'] },
  { id: 'chest_swat', name: 'Chest Swat', tier: 2, lead: 'one', cock: 0.1, swat: 'across', off: 'tuck', lean: [0.15, 0.1], twist: 0.3, legs: 'straight', land: 'none', emph: 1.0, reachZ: 0.25, situ: ['any', 'rim'] },
  { id: 'cross_arm', name: 'Cross Arm', tier: 2, lead: 'cross', cock: 0.0, swat: 'wipe', off: 'wide', lean: [0.25, 0], twist: 0.45, legs: 'kick', land: 'none', emph: 1.0, situ: ['any', 'chase'] },
  { id: 'hook', name: 'Hook', tier: 2, lead: 'far', cock: 0.2, swat: 'down', off: 'shield', lean: [0.35, 0.05], twist: 0.5, legs: 'split', land: 'none', emph: 1.0, situ: ['any', 'perim'] },
  { id: 'shield', name: 'Shield', tier: 2, lead: 'one', cock: 0.0, swat: 'pin', off: 'shield', lean: [0.1, 0.1], twist: 0.15, legs: 'kick', land: 'none', emph: 0.95, reachZ: 0.3, situ: ['any', 'rim'] },
  { id: 'lean_in', name: 'Lean In', tier: 2, lead: 'one', cock: 0.1, swat: 'none', off: 'back', lean: [0.2, 0.35], twist: 0.2, legs: 'pike', land: 'none', emph: 1.05, situ: ['any', 'chase'] },
  // ---- tier 3 ----
  { id: 'wiper', name: 'Windshield Wiper', tier: 3, lead: 'one', cock: 0.3, swat: 'wipe', off: 'wide', lean: [0.2, 0], twist: 0.3, legs: 'split', land: 'stare', emph: 1.1, situ: ['any', 'perim'] },
  { id: 'spike', name: 'Spike', tier: 3, lead: 'one', cock: 0.45, swat: 'down', off: 'wide', lean: [0.1, 0.2], twist: 0.1, legs: 'split', land: 'none', emph: 1.1, reachZ: 0.15, situ: ['any', 'rim'] },
  { id: 'double_clutch', name: 'Double Clutch', tier: 3, lead: 'one', cock: 0.6, swat: 'volley', off: 'high', lean: [0.1, -0.05], twist: 0.25, legs: 'kick', land: 'stare', emph: 1.05, reachZ: -0.05, situ: ['any', 'perim'] },
  { id: 'pin', name: 'Pin', tier: 3, lead: 'two', cock: 0.0, swat: 'pin', off: 'mirror', lean: [0, -0.05], twist: 0, legs: 'split', land: 'point', emph: 1.1, spread: 0.3, reachZ: 0.0, headUp: 0.25, situ: ['any', 'rim'] },
  { id: 'chase_swat', name: 'Chase Swat', tier: 3, lead: 'far', cock: 0.35, swat: 'across', off: 'wide', lean: [0.4, 0.2], twist: 0.6, legs: 'scissor', land: 'none', emph: 1.1, situ: ['chase'] },
  { id: 'twist', name: 'Twist', tier: 3, lead: 'cross', cock: 0.2, swat: 'down', off: 'back', lean: [0.3, -0.05], twist: 0.7, legs: 'scissor', land: 'stare', emph: 1.1, situ: ['any', 'chase'] },
  // ---- tier 4 ----
  { id: 'hammer', name: 'Hammer', tier: 4, lead: 'one', cock: 0.8, swat: 'hammer', off: 'back', lean: [0.1, -0.15], twist: 0.3, legs: 'tuck', land: 'stare', emph: 1.2, reachZ: -0.1, headUp: 0.15, situ: ['any', 'rim'] },
  { id: 'spike_pro', name: 'Spike Pro', tier: 4, lead: 'one', cock: 0.55, swat: 'volley', off: 'wide', lean: [0.2, 0.3], twist: 0.35, legs: 'pike', land: 'roar', emph: 1.2, situ: ['any', 'chase', 'perim'] },
  { id: 'palm_snatch', name: 'Palm Snatch', tier: 4, lead: 'one', cock: 0.0, swat: 'snatch', off: 'shield', lean: [0.1, 0.1], twist: 0.1, legs: 'straight', land: 'point', emph: 1.15, reachZ: 0.25, situ: ['any', 'rim', 'perim'] },
  { id: 'scissor', name: 'Scissor', tier: 4, lead: 'cross', cock: 0.3, swat: 'wipe', off: 'high', lean: [0.25, 0], twist: 0.5, legs: 'scissor', land: 'flex', emph: 1.2, situ: ['any', 'chase'] },
  { id: 'superman', name: 'Superman', tier: 4, lead: 'two', cock: 0.0, swat: 'down', off: 'mirror', lean: [0.15, 0.5], twist: 0.1, legs: 'pike', land: 'dust', emph: 1.25, spread: 0.4, reachZ: 0.45, situ: ['any', 'chase'] },
  { id: 'glass_pin', name: 'Backboard Pin', tier: 4, lead: 'one', cock: 0.0, swat: 'pin', off: 'high', lean: [0.15, 0.25], twist: 0.3, legs: 'kick', land: 'stare', emph: 1.2, reachZ: 0.4, situ: ['rim'] },
  // ---- tier 5: the emphatic ----
  { id: 'hammer_fist', name: 'Hammer Fist', tier: 5, lead: 'one', cock: 1.0, swat: 'hammer', off: 'wide', lean: [0.15, -0.3], twist: 0.4, legs: 'kick', land: 'roar', emph: 1.3, situ: ['any', 'rim'] },
  { id: 'sky_pin', name: 'Sky Pin', tier: 5, lead: 'far', cock: 0.0, swat: 'pin', off: 'high', lean: [0.35, -0.1], twist: 0.6, legs: 'scissor', land: 'point', emph: 1.3, situ: ['rim', 'chase'] },
  { id: 'finger_wag', name: 'Finger Wag', tier: 5, lead: 'one', cock: 0.4, swat: 'across', off: 'back', lean: [0.15, 0.05], twist: 0.3, legs: 'tuck', land: 'wag', emph: 1.25, reachZ: 0.1, situ: ['any', 'rim'] },
  { id: 'eraser', name: 'Eraser', tier: 5, lead: 'one', cock: 0.5, swat: 'wipe', off: 'back', lean: [0.35, 0.1], twist: 0.75, legs: 'scissor', land: 'stare', emph: 1.3, situ: ['any', 'chase', 'perim'] },
  { id: 'thunder_clap', name: 'Thunder Clap', tier: 5, lead: 'two', cock: 0.3, swat: 'clap', off: 'mirror', lean: [0, 0.15], twist: 0, legs: 'pike', land: 'roar', emph: 1.3, spread: 0.9, reachZ: 0.1, situ: ['any', 'rim'] },
  { id: 'launch', name: 'Launch', tier: 5, lead: 'one', cock: 0.7, swat: 'volley', off: 'wide', lean: [0.2, -0.4], twist: 0.35, legs: 'pike', land: 'flex', emph: 1.3, situ: ['any', 'perim', 'chase'] },
];
export const BLOCK_BY_ID = Object.fromEntries(BLOCK_STYLES.map(s => [s.id, s]));

// v0.4.7.5 qp3 (revised): the thirty are sold as five Block Packages of six, one a tier, in the VC Store's Animations
// → Blocks (server/catalog.json mirrors this table: `blockPackageItems()` builds the entries). Fundamentals is free and
// on every build; the rest need the Block rating of their tier, a tier less for the tall (BLOCK_TALL) and a tier more
// for the small (BLOCK_SHORT), the way the styles used to be dealt out by rating and height.
export const BLOCK_PACKAGES = [
  { id: 'block_basic', tier: 1, name: 'Block Package: Fundamentals', price: 0, desc: 'The basics: a straight reach, a two-hand wall, a late hand, a side reach. Every build starts with it.' },
  { id: 'block_swatter', tier: 2, name: 'Block Package: Swatter', price: 3900, desc: 'The arm cocks and fires: a volleyball swat, a chest swat, a cross-arm wipe, a hook, a shield, a lean-in.' },
  { id: 'block_wiper', tier: 3, name: 'Block Package: Wiper', price: 7800, desc: 'Big swings with a stare after: the windshield wiper, a spike, a double clutch, a pin, a chase-down swat, a twist.' },
  { id: 'block_hammer', tier: 4, name: 'Block Package: Hammer', price: 13000, rep: 4, desc: 'Emphatic: the hammer, a spike with a roar, a palm snatch, a scissor, a superman chase-down, a backboard pin. Your name on the callout.' },
  { id: 'block_eraser', tier: 5, name: 'Block Package: Eraser', price: 19500, rep: 8, ovr: 85, desc: 'The flashiest blocks in the park: the hammer fist, a sky pin, the finger wag, the eraser, a thunder clap, a launch.' },
];
export const BLOCK_PKG_BY_ID = Object.fromEntries(BLOCK_PACKAGES.map(k => [k.id, k]));
export const BLOCK_PKG_BY_TIER = Object.fromEntries(BLOCK_PACKAGES.map(k => [k.tier, k.id]));
export const blockPackageStyles = id => BLOCK_STYLES.filter(s => s.tier === (BLOCK_PKG_BY_ID[id]?.tier ?? 1));
// the requirement to buy or wear a package: its tier's Block rating; the tall need the tier below's, the small the
// tier above's (tier 1 is free for everyone; the top tier stays the top for the tall)
export function blockPackageNeed(tier, height = 78) {
  if (tier <= 1) return 0;
  let t = tier;
  if (height >= BLOCK_TALL) t--;
  if (height <= BLOCK_SHORT) t++;
  return BLOCK_TIER_MIN[Math.max(1, Math.min(5, t))];
}
// the catalog entries (server/catalog.json carries exactly these; tests check)
export function blockPackageItems() {
  return BLOCK_PACKAGES.map(k => ({
    category: 'animation', min_overall: k.ovr || 0, rep_required: k.rep || 0, original_2k_asset: false,
    id: k.id, name: k.name, slot: 'block', price: k.price,
    min_attr: k.tier > 1 ? { block: BLOCK_TIER_MIN[k.tier] } : {},
    min_attr_tall: k.tier > 1 ? { block: blockPackageNeed(k.tier, BLOCK_TALL) } : {},
    min_attr_short: k.tier > 1 ? { block: blockPackageNeed(k.tier, BLOCK_SHORT) } : {},
    tall_height: BLOCK_TALL, short_height: BLOCK_SHORT,
    styles: blockPackageStyles(k.id).map(s => s.id), signature: blockPackageStyles(k.id)[0].id,
    tier: k.tier, description: k.desc, v0475qp3: true,
  }));
}

// the tier a player blocks in with no package of his own (a park regular): by Block rating, bumped a tier for the
// tall and down one for the small
export function blockTier(p) {
  const r = p.ratings?.block ?? p.raw?.block ?? 50, h = p.entry?.build?.height ?? 78;
  let t = 1;
  for (let i = 5; i >= 1; i--) if (r >= BLOCK_TIER_MIN[i]) { t = i; break; }
  if (h >= BLOCK_TALL) t++;
  if (h <= BLOCK_SHORT) t--;
  return Math.max(1, Math.min(5, t));
}
// the package a player blocks with: the one he wears (Player.blockPkg, from his equipment), else his tier's
export function blockPackageOf(p) {
  const id = p.blockPkg;
  return BLOCK_PKG_BY_ID[id] ? id : BLOCK_PKG_BY_TIER[blockTier(p)];
}
// the styles a player can block with: his package's six, those that fit the moment first (a chase-down from behind,
// a rim protection, a perimeter closeout), the rest of the six if none does
export function blockPool(p, situ = 'any') {
  const six = blockPackageStyles(blockPackageOf(p));
  let pool = six.filter(s => s.situ.includes(situ));
  if (!pool.length) pool = six.filter(s => s.situ.includes('any'));
  if (!pool.length) pool = six;
  return pool;
}
export function pickBlockStyle(p, rng, situ = 'any') {
  const pool = blockPool(p, situ);
  return pool[rng.int(0, pool.length - 1)].id;
}
// what the block looks like, for the feed and the callout
export function blockCallout(id) {
  const s = BLOCK_BY_ID[id];
  if (!s) return null;
  return s.tier >= 4 ? s.name.toUpperCase() + '!' : null;
}
