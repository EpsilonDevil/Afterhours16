// The Gauntlet's opponents (GAUNTLET.md §2, §8): the styles a named AI player brings to a normal match or a Rival
// match, his Heart, Shooting and Defense, and the moves he shows as intents. Bosses are in bosses.js.
// Every move has an anim tag the court plays (§10).
//
// A move: { kind: 'shoot'|'defend'|'buff'|'debuff'|'special', pts, hits, stops, hot, you:{cold,exposed,gassed},
//           fatigue:{id, n}, anim, w (weight), name }
//
// Balance reasoning (tuned with tools/deck_sim.mjs; the run-length budget drives the Heart numbers):
//  * LENGTH: a completed run should be 45-75 minutes at 15 s a card and 30 s a non-match node. A path meets ~16
//    matches and ~3 Rivals besides the bosses, so a normal match gets ~6 cards (~1.6 turns), a Rival ~10, a boss ~22
//    and the Final ~40: ~240 cards, ~60 minutes, plus ~9 minutes of nodes. HEART = style base (32-40) x PHASE_HEART
//    (0.55 / 0.78 / 0.92: a Phase 1 match is ~20 Heart against a starter's ~13 points a turn; later phases grow less
//    than the deck does, since a grown deck also draws more) x ROUND_GROWTH.
//  * DAMAGE: short matches mean an opponent swings once or twice, so each swing has to matter: PHASE_DMG 2.0 makes a
//    Phase 1 shot 12-20 against a starter's 36-60 Health. Racing him (kill before his second swing) or blocking are
//    both real plans; a player who only blocks loses the race to attrition (the greedy policy dies in Phase 1).
//    3.1 / 4.1 in Phases 2 and 3 track the player's Stops growth (upgraded Defense, Mentalities, Defense stat).
//  * RIVALS: 1.6x Heart and 1.0x damage plus a style special that hits harder: ~2.5 turns, ~7 Health for a good
//    player, for an ability. (At 1.25x damage a Phase 1 Barrage was a third of a starter's Health in one swing.)
//  * RANK (Streetballer → Legend): +10% Heart and +1 Shooting a rank; a Legend is ~1.4x a Streetballer.

export const RANKS = ['Streetballer', 'Contender', 'Rival', 'Nemesis', 'Legend'];
export const PHASE_HEART = [0.55, 0.78, 0.92, 1.0];
export const PHASE_DMG = [2.0, 3.1, 4.1, 4.4];
export const ROUND_GROWTH = 0.025; // +2.5% Heart and damage per bracket round inside a phase: the bracket gets harder as you climb it
export const RIVAL = { heart: 1.6, dmg: 1.0 };
export const RANK_HEART = 0.1, RANK_SHOOT = 1;

const M = (kind, o) => ({ kind, w: 1, ...o });
export const STYLES = {
  sniper: {
    name: 'Shooter', heart: 32, moves: [
      M('shoot', { pts: 8, anim: 'three', w: 3, name: 'Pull-up three' }),
      M('shoot', { pts: 4, hits: 2, anim: 'jumper', w: 2, name: 'Two quick jumpers' }),
      M('defend', { stops: 6, anim: 'closeout', w: 1, name: 'Closes out' }),
      M('buff', { hot: 1, stops: 3, anim: 'celebrate', w: 1, name: 'Gets hot' }),
    ], rival: M('shoot', { pts: 5, hits: 3, anim: 'three', w: 2, name: 'Barrage' }),
  },
  slasher: {
    name: 'Slasher', heart: 34, moves: [
      M('shoot', { pts: 3, hits: 3, anim: 'layup', w: 2, name: 'Attacks the rim' }),
      M('shoot', { pts: 10, anim: 'dunk', w: 2, name: 'Dunk' }),
      M('debuff', { you: { exposed: 2 }, pts: 3, anim: 'crossover', w: 1, name: 'Crosses you up' }),
      M('defend', { stops: 5, anim: 'steal', w: 1, name: 'Gambles for a steal' }),
    ], rival: M('shoot', { pts: 7, hits: 2, anim: 'dunk', w: 2, name: 'Two-hand slam' }),
  },
  big: {
    name: 'Big', heart: 40, moves: [
      M('shoot', { pts: 7, stops: 5, anim: 'post', w: 3, name: 'Backs you down' }),
      M('defend', { stops: 10, anim: 'block', w: 2, name: 'Walls up' }),
      M('debuff', { you: { gassed: 2 }, pts: 4, anim: 'post', w: 1, name: 'Leans on you' }),
      M('shoot', { pts: 11, anim: 'dunk', w: 1, name: 'Putback slam' }),
    ], rival: M('shoot', { pts: 14, stops: 6, anim: 'dunk', w: 2, name: 'Bulldozes' }),
  },
  playmaker: {
    name: 'Playmaker', heart: 33, moves: [
      M('shoot', { pts: 6, anim: 'floater', w: 3, name: 'Floater' }),
      M('debuff', { you: { cold: 2 }, fatigue: { id: 'heavy_legs', n: 1 }, anim: 'pass', w: 1, name: 'Runs you ragged' }),
      M('buff', { hot: 2, anim: 'pass', w: 1, name: 'Sets the table' }),
      M('shoot', { pts: 4, hits: 2, anim: 'lob', w: 1, name: 'Lob to the roller' }),
    ], rival: M('debuff', { you: { cold: 2, exposed: 2 }, fatigue: { id: 'cramp', n: 1 }, pts: 6, anim: 'stepback', w: 2, name: 'Takes you apart' }),
  },
  lockdown: {
    name: 'Stopper', heart: 36, moves: [
      M('shoot', { pts: 5, stops: 6, anim: 'jumper', w: 3, name: 'Two-way possession' }),
      M('debuff', { you: { exposed: 2 }, stops: 4, anim: 'steal', w: 1, name: 'Hounds you' }),
      M('shoot', { pts: 9, anim: 'jumper', w: 1, name: 'Mid-range' }),
      M('defend', { stops: 12, anim: 'contest', w: 1, name: 'Locks in' }),
    ], rival: M('debuff', { you: { exposed: 2, gassed: 2 }, stops: 10, pts: 6, anim: 'block', w: 2, name: 'Clamps down' }),
  },
};
Object.setPrototypeOf(STYLES, null);
export const STYLE_IDS = Object.keys(STYLES);
// which style an AI player plays, from his archetype / position (his AIWorld entry)
export function styleFor(arch = '', pos = '') {
  const a = String(arch).toLowerCase();
  if (/sharp|shoot|spot|stretch|sniper|three/.test(a)) return 'sniper';
  if (/slash|athlet|finisher|dunk/.test(a)) return 'slasher';
  if (/post|glass|rim|paint|big|rebound|brother/.test(a)) return 'big';
  if (/play|maker|general|dimer|pass/.test(a)) return 'playmaker';
  if (/lock|defend|two_way|clamp|stopper/.test(a)) return 'lockdown';
  return { PG: 'playmaker', SG: 'sniper', SF: 'slasher', PF: 'lockdown', C: 'big' }[pos] || 'slasher';
}

// the traits a character can carry (nemesis.js grows them); combat applies them when he's on the floor
export const TRAITS = {
  read_handle: { name: 'Learned your handle', text: 'Handle cards cost +1 against him.', tag: 'Handle' },
  read_drive: { name: 'Walls off the paint', text: 'Your Drive Shots score 3 less against him.', tag: 'Drive' },
  read_post: { name: 'Fronts the post', text: 'Your Post Shots score 3 less against him.', tag: 'Post' },
  read_perimeter: { name: 'Runs you off the line', text: 'Your Perimeter Shots score 2 less against him.', tag: 'Perimeter' },
  read_pass: { name: 'Jumps your passing lanes', text: 'Pass cards cost +1 against him.', tag: 'Pass' },
  read_hustle: { name: 'Matches your motor', text: 'Your Hustle cards give 3 fewer Stops against him.', tag: 'Hustle' },
  iron_man: { name: 'Iron man', text: '+15% Heart.' },
  hot_start: { name: 'Hot starter', text: 'Starts every match Hot 1.' },
  trash_mouth: { name: 'Trash mouth', text: 'Makes you Cold 1 on his first turn.' },
  vengeful: { name: 'Vengeful', text: 'His Shots score +2 against you.' },
  closer: { name: 'Closer', text: 'His Shots score +50% when he\'s below half Heart.' },
  film_junkie: { name: 'Film junkie', text: 'His defend moves give +4 Stops.' },
};
Object.setPrototypeOf(TRAITS, null);
export const TRAIT_IDS = Object.keys(TRAITS);
export const READ_TRAIT = { Handle: 'read_handle', Drive: 'read_drive', Post: 'read_post', Perimeter: 'read_perimeter', Pass: 'read_pass', Hustle: 'read_hustle' };

const scaleMove = (mv, d) => {
  const o = { ...mv };
  if (o.pts) o.pts = Math.max(1, Math.round(o.pts * d));
  if (o.stops) o.stops = Math.max(1, Math.round(o.stops * Math.sqrt(d)));
  if (o.you) o.you = { ...o.you };
  return o;
};
// a normal or Rival opponent for a node: { style, heart, shooting, defense, moves }
export function foeStats({ style, phase = 1, round = 0, rival = false, rank = 0, traits = [] }) {
  const S = STYLES[style] || STYLES.slasher, p = Math.max(1, Math.min(4, phase)) - 1;
  const grow = 1 + ROUND_GROWTH * round;
  let heart = S.heart * PHASE_HEART[p] * grow * (1 + RANK_HEART * rank) * (rival ? RIVAL.heart : 1);
  if (traits.includes('iron_man')) heart *= 1.15;
  const d = PHASE_DMG[p] * grow * (rival ? RIVAL.dmg : 1);
  const moves = S.moves.map(mv => scaleMove(mv, d));
  if (rival) moves.push(scaleMove(S.rival, d));
  return { style, styleName: S.name, heart: Math.round(heart), shooting: RANK_SHOOT * rank + (traits.includes('vengeful') ? 2 : 0), defense: traits.includes('film_junkie') ? 4 : 0, moves };
}
