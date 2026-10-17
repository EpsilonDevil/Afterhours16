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
  // (qp3 revision: every style has its own lead / off-hand / legs triple, and each package its own motif: Fundamentals
  // are upright and plain; Swatter cocks and fires one arm; Wiper swings big with a twist and a stare; Hammer is
  // overhead power on piked and scissored legs; Eraser is the whole body, arched back, with the gesture after.
  // reachX: how far out to the side the lead hand reaches (0 straight up); elbowOut: the lead elbow flared wide)
  // ---- tier 1, Fundamentals: upright, no wind-up, no gesture ----
  { id: 'reach', name: 'Reach', tier: 1, lead: 'one', cock: 0.0, swat: 'none', off: 'wide', lean: [0.1, 0], twist: 0.1, legs: 'split', land: 'none', emph: 0.9, reachZ: 0.12, situ: ['any', 'perim'] },
  { id: 'straight_up', name: 'Straight Up', tier: 1, lead: 'two', cock: 0.0, swat: 'none', off: 'mirror', lean: [0, 0], twist: 0, legs: 'straight', land: 'none', emph: 0.9, spread: 0.24, reachZ: -0.12, headUp: 0.35, situ: ['any', 'rim'] },
  { id: 'late_hand', name: 'Late Hand', tier: 1, lead: 'one', cock: 0.15, swat: 'tip', off: 'tuck', lean: [0.05, 0.12], twist: 0.2, legs: 'split', land: 'none', emph: 0.85, reachZ: 0.1, reachX: 0.15, situ: ['any', 'perim'] },
  { id: 'wall', name: 'Two-Hand Wall', tier: 1, lead: 'two', cock: 0.0, swat: 'push', off: 'mirror', lean: [0, 0.12], twist: 0, legs: 'kick', land: 'none', emph: 0.95, spread: 0.62, reachZ: 0.3, situ: ['any', 'rim'] },
  { id: 'side_reach', name: 'Side Reach', tier: 1, lead: 'one', cock: 0.0, swat: 'across', off: 'shield', lean: [0.4, 0], twist: 0.35, legs: 'straight', land: 'none', emph: 0.9, reachX: 0.3, situ: ['any', 'chase'] },
  { id: 'stand_tall', name: 'Stand Tall', tier: 1, lead: 'one', cock: 0.0, swat: 'none', off: 'tuck', lean: [0, -0.25], twist: 0, legs: 'straight', land: 'none', emph: 0.9, reachZ: -0.08, headUp: 0.25, situ: ['any', 'rim'] },
  // ---- tier 2, Swatter: the arm cocks and fires ----
  { id: 'volleyball', name: 'Volleyball', tier: 2, lead: 'one', cock: 0.35, swat: 'volley', off: 'back', lean: [0.1, 0.15], twist: 0.25, legs: 'kick', land: 'none', emph: 1.0, reachZ: 0.2, situ: ['any', 'perim'] },
  { id: 'chest_swat', name: 'Chest Swat', tier: 2, lead: 'one', cock: 0.1, swat: 'across', off: 'tuck', lean: [0.15, 0.1], twist: 0.3, legs: 'kick', land: 'none', emph: 1.0, reachZ: 0.25, elbowOut: 1, situ: ['any', 'rim'] },
  { id: 'cross_arm', name: 'Cross Arm', tier: 2, lead: 'cross', cock: 0.0, swat: 'wipe', off: 'wide', lean: [0.25, 0], twist: 0.45, legs: 'kick', land: 'none', emph: 1.0, situ: ['any', 'chase'] },
  { id: 'hook', name: 'Hook', tier: 2, lead: 'far', cock: 0.2, swat: 'chop', off: 'shield', lean: [0.35, 0.05], twist: 0.5, legs: 'split', land: 'none', emph: 1.0, situ: ['any', 'perim'] },
  { id: 'shield', name: 'Shield', tier: 2, lead: 'one', cock: 0.0, swat: 'pin', off: 'shield', lean: [0.1, 0.1], twist: 0.15, legs: 'tuck', land: 'none', emph: 0.95, reachZ: 0.3, elbowOut: 1, situ: ['any', 'rim'] },
  { id: 'lean_in', name: 'Lean In', tier: 2, lead: 'one', cock: 0.1, swat: 'none', off: 'back', lean: [0.2, 0.35], twist: 0.2, legs: 'pike', land: 'none', emph: 1.05, reachX: 0.1, situ: ['any', 'chase'] },
  // ---- tier 3, Wiper: big swings, a twist, and a stare after ----
  { id: 'wiper', name: 'Windshield Wiper', tier: 3, lead: 'one', cock: 0.3, swat: 'wipe', off: 'high', lean: [0.3, 0], twist: 0.45, legs: 'split', land: 'stare', emph: 1.1, reachX: 0.25, situ: ['any', 'perim'] },
  { id: 'spike', name: 'Spike', tier: 3, lead: 'one', cock: 0.45, swat: 'down', off: 'wide', lean: [0.1, 0.25], twist: 0.1, legs: 'tuck', land: 'none', emph: 1.1, reachZ: 0.15, situ: ['any', 'rim'] },
  { id: 'double_clutch', name: 'Double Clutch', tier: 3, lead: 'one', cock: 0.6, swat: 'volley', off: 'high', lean: [0.1, -0.05], twist: 0.25, legs: 'kick', land: 'stare', emph: 1.05, reachZ: -0.05, elbowOut: 1, situ: ['any', 'perim'] },
  { id: 'pin', name: 'Pin', tier: 3, lead: 'two', cock: 0.0, swat: 'pin', off: 'mirror', lean: [0, -0.05], twist: 0, legs: 'scissor', land: 'point', emph: 1.1, spread: 0.3, reachZ: 0.0, headUp: 0.25, situ: ['any', 'rim'] },
  { id: 'chase_swat', name: 'Chase Swat', tier: 3, lead: 'far', cock: 0.35, swat: 'sweep', off: 'wide', lean: [0.4, 0.2], twist: 0.6, legs: 'scissor', land: 'none', emph: 1.1, situ: ['chase'] },
  { id: 'twist', name: 'Twist', tier: 3, lead: 'cross', cock: 0.2, swat: 'down', off: 'back', lean: [0.3, -0.05], twist: 0.7, legs: 'scissor', land: 'stare', emph: 1.1, situ: ['any', 'chase'] },
  // ---- tier 4, Hammer: overhead power, piked and scissored legs, a roar or a point ----
  { id: 'hammer', name: 'Hammer', tier: 4, lead: 'one', cock: 0.8, swat: 'hammer', off: 'wide', lean: [0.1, -0.15], twist: 0.3, legs: 'pike', land: 'stare', emph: 1.2, reachZ: -0.1, headUp: 0.15, situ: ['any', 'rim'] },
  { id: 'spike_pro', name: 'Spike Pro', tier: 4, lead: 'one', cock: 0.55, swat: 'spike', off: 'tuck', lean: [0.2, 0.3], twist: 0.35, legs: 'pike', land: 'roar', emph: 1.2, reachX: 0.2, situ: ['any', 'chase', 'perim'] },
  { id: 'palm_snatch', name: 'Palm Snatch', tier: 4, lead: 'one', cock: 0.0, swat: 'snatch', off: 'shield', lean: [0.1, 0.1], twist: 0.1, legs: 'scissor', land: 'point', emph: 1.15, reachZ: 0.25, situ: ['any', 'rim', 'perim'] },
  { id: 'scissor', name: 'Scissor', tier: 4, lead: 'cross', cock: 0.5, swat: 'scissor', off: 'high', lean: [0.1, -0.1], twist: 0.45, legs: 'split', land: 'flex', emph: 1.25, headUp: 0.3, situ: ['any', 'chase'] },
  { id: 'superman', name: 'Superman', tier: 4, lead: 'two', cock: 0.0, swat: 'slam', off: 'mirror', lean: [0.15, 0.5], twist: 0.1, legs: 'pike', land: 'dust', emph: 1.25, spread: 0.4, reachZ: 0.45, situ: ['any', 'chase'] },
  { id: 'glass_pin', name: 'Backboard Pin', tier: 4, lead: 'one', cock: 0.0, swat: 'press', off: 'shield', lean: [0.2, 0.3], twist: 0.3, legs: 'kick', land: 'stare', emph: 1.2, reachZ: 0.4, reachX: 0.12, situ: ['rim'] },
  // ---- tier 5, Eraser: the whole body, arched back, and the gesture after ----
  { id: 'hammer_fist', name: 'Hammer Fist', tier: 5, lead: 'one', cock: 1.0, swat: 'hammer', off: 'wide', lean: [0.15, -0.3], twist: 0.4, legs: 'kick', land: 'roar', emph: 1.3, situ: ['any', 'rim'] },
  { id: 'sky_pin', name: 'Sky Pin', tier: 5, lead: 'far', cock: 0.0, swat: 'hold', off: 'high', lean: [0.1, -0.3], twist: 0.2, legs: 'pike', land: 'point', emph: 1.3, situ: ['rim', 'chase'] },
  { id: 'finger_wag', name: 'Finger Wag', tier: 5, lead: 'one', cock: 0.4, swat: 'flick', off: 'back', lean: [0.15, 0.05], twist: 0.3, legs: 'split', land: 'wag', emph: 1.25, reachZ: 0.1, reachX: 0.18, situ: ['any', 'rim'] },
  { id: 'eraser', name: 'Eraser', tier: 5, lead: 'one', cock: 0.5, swat: 'erase', off: 'back', lean: [0.35, 0.1], twist: 0.75, legs: 'scissor', land: 'stare', emph: 1.3, elbowOut: 1, situ: ['any', 'chase', 'perim'] },
  { id: 'thunder_clap', name: 'Thunder Clap', tier: 5, lead: 'two', cock: 0.3, swat: 'clap', off: 'mirror', lean: [0, 0.15], twist: 0, legs: 'tuck', land: 'roar', emph: 1.3, spread: 0.9, reachZ: 0.1, situ: ['any', 'rim'] },
  { id: 'launch', name: 'Launch', tier: 5, lead: 'one', cock: 0.7, swat: 'launch', off: 'wide', lean: [0.2, -0.4], twist: 0.35, legs: 'scissor', land: 'flex', emph: 1.3, reachX: 0.22, situ: ['any', 'perim', 'chase'] },
];

// v0.4.8.5 Big Brother (the Glass Cleaner Icon badge): "unlocks exclusive ultra-flashy block animations". Seven blocks
// of the Icon's own, a tier above the Eraser (tier 6, emph 1.45..1.55), worn as the Icon's Block Package
// (BB_BLOCK_PKG, slot 'block': nobody else can wear it). They go at the ball the way the thirty do (blockPose: the reach
// follows the ball, the swat fires from the contact), only further: a wider reach, the body thrown at the ball, the arm
// at full extension (char/bigbro.js). Each has its own swat, off arm, legs and landing gesture (all new: none of them
// is any of the thirty's), and its own callout. spin: the 360 of the Spin Swat (blockSpin, the animator turns him)
export const BB_ICON = 'big_brother';
export const BB_BLOCK_PKG = 'block_big_brother';
export const BB_BLOCK_STYLES = [
  { id: 'bb_tomahawk', name: 'Tomahawk Swat', tier: 6, icon: BB_ICON, callout: 'NOT IN MY HOUSE!', lead: 'one', cock: 1.0, swat: 'tomahawk', off: 'fling', lean: [0.15, -0.45], twist: 0.45, legs: 'kneeup', land: 'thump', emph: 1.5, situ: ['any', 'rim', 'perim'], desc: 'The arm cocked all the way back behind the head, the back arched and a knee driven up, then whipped over the top through the ball and on down to the far hip. Lands thumping his chest and roars.' },
  { id: 'bb_volley_spike', name: 'Volley Spike', tier: 6, icon: BB_ICON, callout: 'GET THAT OUTTA HERE!', lead: 'two', cock: 0.85, swat: 'spike2', off: 'together', lean: [0, -0.5], twist: 0, legs: 'kickback', land: 'shove', emph: 1.5, spread: 0.16, situ: ['any', 'rim', 'perim'], desc: 'Bowed back like a volleyball hitter, both hands up behind the head and both heels kicked up behind him, then the two hands spiked down through the ball. Lands shoving it away with both palms and waves it off.' },
  { id: 'bb_glass_pin', name: 'Glass Eater', tier: 6, icon: BB_ICON, callout: 'BIG BROTHER IS WATCHING!', lead: 'one', cock: 0.0, swat: 'pinhold', off: 'trail', lean: [0.1, 0.2], twist: 0.2, legs: 'hurdle', land: 'watching', emph: 1.45, situ: ['rim', 'chase'], desc: 'Stretched out at full extension like a hurdler, the off arm straight back, the palm flat on the ball and held there, pinned. Lands with two fingers to his eyes and a point at the shooter: always watching.' },
  { id: 'bb_spin_swat', name: 'Spin Swat', tier: 6, icon: BB_ICON, callout: 'SHHH!', lead: 'one', cock: 0.3, swat: 'spinswat', off: 'wrap', lean: [0.25, 0.05], twist: 0.6, legs: 'spin', land: 'shush', emph: 1.5, spin: 1, situ: ['any', 'perim', 'chase'], desc: 'Swatted hard across his body and spun round with it, half a turn in the air with the knees tucked and the rest on the landing, finger to his lips.' },
  { id: 'bb_chase_cannon', name: 'Chase-Down Cannon', tier: 6, icon: BB_ICON, callout: 'RETURN TO SENDER!', lead: 'one', cock: 0.0, swat: 'cannon', off: 'flungback', lean: [0.2, 0.55], twist: 0.3, legs: 'stride', land: 'standover', emph: 1.55, situ: ['chase', 'any'], desc: 'Flattened out going after it, the arm fired out in front and the other flung back behind him, the legs split wide front and back. Lands standing over the shooter, staring down.' },
  { id: 'bb_sledgehammer', name: 'Sledgehammer', tier: 6, icon: BB_ICON, callout: 'SMASHED!', lead: 'two', cock: 0.95, swat: 'sledge', off: 'clasped', lean: [0, -0.4], twist: 0, legs: 'frog', land: 'crabflex', emph: 1.55, spread: 0.08, situ: ['rim', 'any'], desc: 'Both fists clasped and swung up back over his head like a sledgehammer, the knees out wide, then brought down through the ball all the way to the belt. Lands in a hunched, roaring crab flex.' },
  { id: 'bb_backhand', name: 'Backhand Swat', tier: 6, icon: BB_ICON, callout: 'BLOCK PARTY!', lead: 'one', cock: 0.4, swat: 'backhand', off: 'guard', lean: [0.35, 0.1], twist: 0.8, legs: 'straddle', land: 'raise', emph: 1.45, situ: ['perim', 'any', 'chase'], desc: 'The back of the hand whipped out through the ball and away to the side, the body turned with it and the legs split out wide to the sides, the other hand up as a second wall. Lands raising the roof.' },
];
export const BLOCK_BY_ID = Object.fromEntries([...BLOCK_STYLES, ...BB_BLOCK_STYLES].map(s => [s.id, s]));
// the Spin Swat's turn (radians, the animator turns his body by it, as for the 360 dunks and snags): half a turn in the
// air from the contact, the rest as he lands; nothing for a block that never got the ball
export function blockSpin(a) {
  const S = a && a.type === 'block' && a.hit ? BLOCK_BY_ID[a.bstyle] : null;
  if (!S || !S.spin) return 0;
  const sm5 = k => { k = Math.max(0, Math.min(1, k)); return k * k * k * (k * (k * 6 - 15) + 10); };
  const land = (a.jumpAt || 0.06) + (a.air || 0.6), dir = (a.ldUsed || a.lead) === 'L' ? -1 : 1; // (the way the swat goes: across him)
  return dir * Math.PI * (sm5((a.t - a.hitAt) / Math.max(0.22, Math.min(0.34, land - a.hitAt))) + sm5((a.t - Math.max(land, a.hitAt + 0.22)) / 0.36)) || 0;
}

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
// v0.4.8.5 the Icon's own Block Package (Big Brother): its seven, for the holder of the badge alone. Never in the store
// (secret), it comes with the badge (server/app.py grant_icon_items, and once on the profile load for a build that
// already held it); worn by anyone else it is as if he wore nothing (his tier's six)
export const ICON_BLOCK_PACKAGES = [
  {
    id: BB_BLOCK_PKG, icon: BB_ICON, name: 'Block Package: Big Brother', styles: BB_BLOCK_STYLES.map(s => s.id),
    desc: 'The Glass Cleaner Icon\'s own: seven ultra-flashy blocks that go at the ball harder and further than any other package, a different one every time (the Tomahawk Swat, Volley Spike, Glass Eater, Spin Swat, Chase-Down Cannon, Sledgehammer and Backhand Swat), each with its own landing gesture and callout. Comes with the Big Brother Icon badge, for that build only; it cannot be bought.',
  },
];
export const ICON_BLOCK_PKG_BY_ID = Object.fromEntries(ICON_BLOCK_PACKAGES.map(k => [k.id, k]));
export const blockPackageStyles = id => (ICON_BLOCK_PKG_BY_ID[id] ? ICON_BLOCK_PKG_BY_ID[id].styles.map(s => BLOCK_BY_ID[s]) : BLOCK_STYLES.filter(s => s.tier === (BLOCK_PKG_BY_ID[id]?.tier ?? 1)));
// the catalog entry (server/catalog.json carries exactly it; a test checks). The profile load puts it on once for a
// build that held the badge before it existed (server/app.py ICON_EQUIP_ONCE)
export function iconBlockPackageItems() {
  return ICON_BLOCK_PACKAGES.map(k => ({
    category: 'animation', min_overall: 0, rep_required: 0, original_2k_asset: false,
    id: k.id, name: k.name, slot: 'block', price: 0, min_attr: {},
    styles: [...k.styles], signature: k.styles[0], description: k.desc,
    exclusive: 'icon', icon: k.icon, secret: true, v0485qp5: true,
  }));
}
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
// the package a player blocks with: the one he wears (Player.blockPkg, from his equipment), else his tier's. (v0.4.8.5:
// an Icon's own package only for the holder of that Icon; the badge itself never changes what he blocks with)
export function blockPackageOf(p) {
  const id = p.blockPkg;
  if (ICON_BLOCK_PKG_BY_ID[id]) return ICON_BLOCK_PKG_BY_ID[id].icon === p.icon ? id : BLOCK_PKG_BY_TIER[blockTier(p)];
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
  // (v0.4.8.5: the Icon's package is a different one every block, never the same twice running; the same single draw
  // of the game's RNG, so online every screen picks the same one)
  if (ICON_BLOCK_PKG_BY_ID[blockPackageOf(p)]) {
    const opts = pool.length > 1 ? pool.filter(s => s.id !== p.lastBlock) : pool;
    return (p.lastBlock = opts[rng.int(0, opts.length - 1)].id);
  }
  return pool[rng.int(0, pool.length - 1)].id;
}
// what the block looks like, for the feed and the callout (v0.4.8.5: the Icon's blocks have callouts of their own)
export function blockCallout(id) {
  const s = BLOCK_BY_ID[id];
  if (!s) return null;
  if (s.callout) return s.callout;
  return s.tier >= 4 ? s.name.toUpperCase() + '!' : null;
}
