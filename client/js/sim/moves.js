// v0.4.7.5 dribble moves: four families (crossovers, behind-the-backs, escapes, momentum dribbles) plus spins, each
// called by its own right-stick combination, with named combos for the classic two-move sequences and a feel of its
// own in every size-up package.
//
//  fam:    the family (the AI and the feed use it)
//  dur:    base length (s) before the handle, package and position scale it (game.js startMove)
//  lat/fwd: the burst: sideways (toward the new hand) and forward (along the stick), as shares of the move burst
//  back:   straight away from the rim (m/s; escapes)
//  prof:   speed profile over the move [until, k] pairs: the burst is multiplied by k up to that point
//  sw:     the ball changes hands (at sw of the way through)
//  ankle:  how hard it bites on a defender (ankleCheck)
export const MOVES = {
  cross: { fam: 'crossover', dur: 0.4, lat: 0.75, fwd: 0.45, sw: 0.5, ankle: 1 },
  hang: { fam: 'crossover', dur: 0.5, lat: 0.88, fwd: 0.3, sw: 0.62, ankle: 1.28, prof: [[0.38, 0.18], [1, 1.25]] },
  btl: { fam: 'crossover', dur: 0.44, lat: 0.75, fwd: 0.45, sw: 0.5, ankle: 1 },
  inout: { fam: 'crossover', dur: 0.4, lat: -0.35, fwd: 0.7, ankle: 1 },
  btb: { fam: 'behind', dur: 0.44, lat: 0.75, fwd: 0.45, sw: 0.5, ankle: 1 },
  wrap: { fam: 'behind', dur: 0.48, lat: 1.05, fwd: 0.22, sw: 0.55, ankle: 1.12 },
  spin: { fam: 'spin', dur: 0.56, fwd: 0.8, ankle: 1 },
  halfspin: { fam: 'spin', dur: 0.48, fwd: 0.65, ankle: 1.05, prof: [[0.5, 0.6], [1, 1.1]] },
  stepback: { fam: 'escape', dur: 0.56, back: 4.4, ankle: 0.7, prof: [[0.45, 1], [1, 0.15]] },
  sidestep: { fam: 'escape', dur: 0.5, lat: 1.15, ankle: 0.7, prof: [[0.5, 1], [1, 0.12]] },
  retreat: { fam: 'escape', dur: 0.7, back: 3.9, ankle: 0.42, prof: [[0.7, 1], [1, 0.3]] },
  hesi: { fam: 'momentum', dur: 0.5, fwd: 0.9, ankle: 0.7, prof: [[0.6, 0.25], [1, 1.25]] },
  stutter: { fam: 'momentum', dur: 0.56, fwd: 0.95, ankle: 0.9, prof: [[0.62, 0.1], [1, 1.45]] },
  momentum: { fam: 'momentum', dur: 0.42, fwd: 1.18, ankle: 0.6, prof: [[1, 1.1]] },
  // v0.4.7.5 quick patch: the diagonals (latSide 'ball': the sideways part goes to the ball's side, not across)
  //   pushcross: the push-pull crossover: pushed out ahead with the ball hand, then pulled back across low
  //   jab:       a hard jab step to the ball's side with the ball held at the hip, then the go
  //   snatch:    the snatch-back: one hard dribble yanked back and a hop back to the ball's side
  //   btlback:   the pull-back: between the legs while stepping back the other way
  pushcross: { fam: 'crossover', dur: 0.5, lat: 0.85, fwd: 0.4, sw: 0.66, ankle: 1.18, prof: [[0.42, 0.55], [1, 1.2]] },
  jab: { fam: 'momentum', dur: 0.5, lat: -0.25, fwd: 0.85, ankle: 0.95, prof: [[0.45, 0.2], [1, 1.35]] },
  snatch: { fam: 'escape', dur: 0.56, back: 3.6, lat: 0.55, latSide: 'ball', ankle: 0.75, prof: [[0.5, 1], [1, 0.15]] },
  btlback: { fam: 'escape', dur: 0.56, back: 3.2, lat: 0.6, sw: 0.5, ankle: 0.8, prof: [[0.55, 1], [1, 0.2]] },
};
export const MOVE_IDS = Object.keys(MOVES);
export const FAMILIES = { crossover: 'Crossovers', behind: 'Behind-the-backs', escape: 'Escapes', momentum: 'Momentum dribbles', spin: 'Spins' };
export const switchesHand = m => MOVES[m]?.sw != null;
export function moveProfile(m, t) {
  const pr = MOVES[m]?.prof; if (!pr) return 1;
  for (const [until, k] of pr) if (t <= until) return k;
  return pr[pr.length - 1][1];
}

// two-move sequences with a name (the second inside COMBO_GAP of the first): they bite harder and the feed calls them
export const COMBOS = {
  'inout>cross': 'Killer crossover', 'inout>hang': 'Killer hang', 'cross>cross': 'Double crossover', 'hesi>cross': 'Hesi crossover',
  'cross>btb': 'Cross into behind-the-back', 'btl>btb': 'Through the legs, around the back', 'btl>btl': 'Double between-the-legs',
  'hesi>momentum': 'Hesi and go', 'stutter>momentum': 'Stutter and go', 'hang>momentum': 'Hang and go', 'cross>stepback': 'Cross into a stepback',
  'btb>stepback': 'Behind-the-back stepback', 'spin>stepback': 'Spin into a stepback', 'cross>spin': 'Cross into a spin', 'halfspin>cross': 'Half-spin crossover',
  'btl>sidestep': 'Through the legs, sidestep', 'wrap>stepback': 'Wrap into a stepback', 'inout>wrap': 'In-and-out wrap', 'stutter>cross': 'Stutter crossover',
  'retreat>cross': 'Retreat crossover', 'retreat>momentum': 'Retreat and burst',
  // v0.4.7.5 quick patch: the diagonal moves
  'pushcross>stepback': 'Push-pull stepback', 'pushcross>btb': 'Push-pull into behind-the-back', 'hesi>pushcross': 'Hesi push-pull',
  'inout>pushcross': 'In-and-out push-pull', 'sidestep>pushcross': 'Sidestep push-pull', 'jab>cross': 'Jab crossover', 'jab>momentum': 'Jab and go',
  'jab>stepback': 'Jab stepback', 'stutter>jab': 'Stutter jab', 'wrap>jab': 'Wrap into a jab', 'cross>snatch': 'Cross into a snatch-back',
  'snatch>cross': 'Snatch-back crossover', 'snatch>momentum': 'Snatch-back and burst', 'btlback>cross': 'Pull-back crossover',
  'btlback>momentum': 'Pull-back and go', 'btl>btlback': 'Through the legs and out', 'btlback>jab': 'Pull-back jab',
};
export const comboName = (prev, next) => COMBOS[`${prev}>${next}`] || null;

// How each size-up package plays the moves. durK: length, burstK: burst, low: ball height in the move, wide: how far
// the ball and the body travel sideways, flair: how much the body sells it (animator), and its signature moves
// (sig: those come out a touch quicker and bite a touch harder in this package).
export const MOVE_STYLE = {
  basic: { durK: 1, burstK: 1, low: 1, wide: 1, flair: 1, sig: [] },
  quick: { durK: 0.94, burstK: 1, low: 0.95, wide: 0.9, flair: 0.9, sig: ['cross', 'momentum'] },
  elite: { durK: 0.92, burstK: 1.06, low: 0.9, wide: 1.05, flair: 1.2, sig: ['hang', 'btb', 'stepback', 'pushcross'] },
  rhythm: { durK: 1, burstK: 1, low: 1.05, wide: 1, flair: 1.1, sig: ['hesi', 'inout'] },
  ankle: { durK: 0.95, burstK: 1.08, low: 0.85, wide: 1.15, flair: 1.25, sig: ['cross', 'hang', 'halfspin'] },
  pound: { durK: 1.02, burstK: 1.05, low: 1.15, wide: 1, flair: 1.1, sig: ['momentum', 'retreat', 'snatch'] },
  snake: { durK: 0.97, burstK: 0.98, low: 0.8, wide: 1.2, flair: 1.15, sig: ['inout', 'wrap'] },
  crab: { durK: 1, burstK: 1, low: 0.9, wide: 1.3, flair: 1, sig: ['sidestep', 'stepback', 'snatch'] },
  stutter: { durK: 1, burstK: 1.02, low: 1, wide: 1, flair: 1.2, sig: ['stutter', 'hesi'] },
  showtime: { durK: 0.96, burstK: 1, low: 1.05, wide: 1.1, flair: 1.4, sig: ['btl', 'btb', 'spin', 'wrap'] },
  // v0.4.7.5 packages
  yoyo: { durK: 1, burstK: 1, low: 1.12, wide: 0.95, flair: 1.15, sig: ['hesi', 'momentum'] },
  rocker: { durK: 0.98, burstK: 1.02, low: 1, wide: 1, flair: 1.15, sig: ['stutter', 'hesi', 'jab'] },
  cradle: { durK: 0.96, burstK: 1, low: 0.8, wide: 1.25, flair: 1.1, sig: ['hang', 'wrap'] },
  glide: { durK: 0.97, burstK: 1.03, low: 0.92, wide: 1.2, flair: 1, sig: ['sidestep', 'btl'] },
  jab: { durK: 1, burstK: 1.06, low: 0.95, wide: 1, flair: 1.1, sig: ['inout', 'retreat', 'jab'] },
  springs: { durK: 0.93, burstK: 1, low: 1, wide: 0.9, flair: 1.05, sig: ['cross', 'stutter'] },
  lowrider: { durK: 0.92, burstK: 1.05, low: 0.72, wide: 1.1, flair: 1.3, sig: ['btl', 'btb', 'hang'] },
  swagger: { durK: 1.04, burstK: 1, low: 1.1, wide: 1.2, flair: 1.35, sig: ['halfspin', 'wrap'] },
  blur: { durK: 0.88, burstK: 1.04, low: 0.85, wide: 0.85, flair: 1.2, sig: ['cross', 'inout', 'btl', 'pushcross'] },
  pendulum: { durK: 0.95, burstK: 1, low: 0.82, wide: 1.35, flair: 1.25, sig: ['btl', 'sidestep', 'wrap', 'btlback'] },
};
export const moveStyle = p => MOVE_STYLE[p?.sizeupStyle] || MOVE_STYLE.basic;

// The right stick with the ball (offense). stick: 'left' | 'right' | 'up' | 'down' | 'down-left' | 'down-right' |
// 'up-left' | 'up-right' | 'spin'. ctx: { toBallHand: the stick points to the ball's side (left/right and the
// diagonals), sprint, moving (left stick pushed), backward (left stick pulled away from the rim), slow (a slow
// push rather than a snap) }.
//   sideways, to the other hand:  crossover · while sprinting, between the legs · a slow push, a hang-dribble crossover
//   sideways, to the ball's side: in-and-out
//   down:  standing, a stepback · on the move, behind the back · pulling away from the rim, a retreat dribble
//   up:    hesitation · while sprinting, a momentum push-ahead
//   rotate: spin · standing still, a half spin
// v0.4.7.5 quick patch: every diagonal does two things, by whether he's moving (left stick) and which side it's on:
//   up, to the ball's side:     standing, a stutter-step · on the move, a jab step
//   up, to the other hand:      the push-pull crossover · a slow push, a stutter-step
//   down, to the ball's side:   standing, a sidestep escape · on the move, a snatch-back
//   down, to the other hand:    standing, the pull-back (between the legs, stepping back) · on the move, a wrap
export const DIAGONAL_MOVES = ['stutter', 'jab', 'pushcross', 'sidestep', 'snatch', 'btlback', 'wrap'];
export function stickMove(stick, ctx = {}) {
  if (stick === 'spin') return ctx.moving ? 'spin' : 'halfspin';
  if (stick === 'up') return ctx.sprint ? 'momentum' : 'hesi';
  if (stick === 'up-left' || stick === 'up-right') {
    if (ctx.toBallHand) return ctx.moving || ctx.sprint ? 'jab' : 'stutter';
    return ctx.slow ? 'stutter' : 'pushcross';
  }
  if (stick === 'down') return ctx.backward ? 'retreat' : ctx.moving ? 'btb' : 'stepback';
  if (stick === 'down-left' || stick === 'down-right') {
    if (ctx.toBallHand) return ctx.moving ? 'snatch' : 'sidestep';
    return ctx.moving ? 'wrap' : 'btlback';
  }
  if (stick === 'left' || stick === 'right') {
    if (ctx.toBallHand) return 'inout';
    if (ctx.sprint) return 'btl';
    return ctx.slow ? 'hang' : 'cross';
  }
  return null;
}
