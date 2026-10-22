// The Gauntlet's cards (GAUNTLET.md §3). Pure data plus the text each one shows.
// A card is referred to by its ref: its id, with a trailing '+' when upgraded ('jumper', 'jumper+'). Decks, piles and
// rewards are arrays of refs, so a run is plain JSON.
//
// The effect language (fx), resolved in this order by combat.js:
//   pts, hits      a Shot: pts per hit (Shooting's ⌊stat/2⌋ and Hot add to every hit)
//   stops, hustle  Defense: Stops (Defense's ⌊stat/2⌋ adds on Defense cards); hustle: they last into the next turn
//   draw, energy, heal, charge (energy next turn), hot (Hot on you), foe {cold, exposed, gassed}
//   next {tag?, add}   the next Shot this turn (of that tag) scores +add
//   cheap n        the next card this turn costs n less
//   combo {tag, ...}   extra fx (or mult) when the last card played this turn had that tag
//   depth {per, add, k}  +add to k ('pts' | 'stops') for every `per` cards in your deck past 10
//   tight {...}    extra fx when your deck has 12 cards or fewer
//   clutch {...}   extra fx (or mult) when you're at half Health or less
//   burn, hold, wild (counts as every tag for a Flow chain), power {id, n} (a Mentality), special (bespoke)
// Fatigue: unplayable (or a cost to burn), drawn {energy: -n}, inHand {dmg, cold, shot} at end of turn / while held.
//
// Balance reasoning (the numbers below):
//  * A starter Jumper is 6 points for 1 energy and a Closeout 5 Stops for 1: the genre's 6/5 baseline. With a 1-5
//    starter's Shooting (+0..2) that's 6-8 a shot, so 3 energy is ~20 points a turn when you swing at everything.
//  * Commons are ~1.3x a starter card per energy, uncommons ~1.6x with a condition (a combo, Tight, Clutch), rares
//    ~2x or a rule-bending effect. Combo bonuses are sized so the right sequence beats raw stats: +4..6 on a 6-7 base.
//  * 0-cost cards trade raw value for tempo (draw, setups), so a hand of them never out-damages a real Shot.
//  * Depth adds +2 per 4 cards past 10 (a 22-card deck: +6), Tight adds ~+60% at 12 or fewer: the two ends of the
//    deck-size choice pay about the same at their best.

export const TAGS = ['Handle', 'Drive', 'Post', 'Perimeter', 'Pass', 'Hustle'];
export const TYPES = ['shot', 'defense', 'move', 'play', 'mentality', 'fatigue'];
export const RARITIES = ['starter', 'common', 'uncommon', 'rare', 'fatigue', 'special'];
export const TIGHT_AT = 12; // §3: "bonus at ≤ 12 cards"
export const DEPTH_FROM = 10; // the starting deck's size: Depth counts the cards past it

const C = (id, name, type, rarity, cost, tags, anim, fx, up = {}, extra = {}) => ({ id, name, type, rarity, cost, tags, anim, fx, up, ...extra });

export const CARD_LIST = [
  // ---------- starters ----------
  C('jumper', 'Jumper', 'shot', 'starter', 1, ['Perimeter'], 'jumper', { pts: 6 }, { fx: { pts: 9 } }),
  C('closeout', 'Closeout', 'defense', 'starter', 1, ['Hustle'], 'closeout', { stops: 5 }, { fx: { stops: 8 } }),
  C('crossover', 'Crossover', 'move', 'starter', 1, ['Handle'], 'crossover', { foe: { exposed: 1 }, draw: 1 }, { fx: { foe: { exposed: 2 }, draw: 1 } }),
  C('outlet_pass', 'Outlet Pass', 'play', 'starter', 0, ['Pass'], 'pass', { draw: 1 }, { fx: { draw: 2 } }),

  // ---------- Shots: common ----------
  C('corner_three', 'Corner Three', 'shot', 'common', 1, ['Perimeter'], 'three', { pts: 7, combo: { tag: 'Pass', pts: 4 } }, { fx: { pts: 9, combo: { tag: 'Pass', pts: 5 } } }),
  C('layup', 'Layup', 'shot', 'common', 1, ['Drive'], 'layup', { pts: 6, combo: { tag: 'Handle', pts: 4 } }, { fx: { pts: 8, combo: { tag: 'Handle', pts: 5 } } }),
  C('putback', 'Putback', 'shot', 'common', 1, ['Hustle'], 'layup', { pts: 5, stops: 3 }, { fx: { pts: 7, stops: 4 } }),
  C('floater', 'Floater', 'shot', 'common', 1, ['Drive'], 'floater', { pts: 7, tight: { pts: 4 } }, { fx: { pts: 9, tight: { pts: 5 } } }),
  C('post_hook', 'Post Hook', 'shot', 'common', 1, ['Post'], 'post', { pts: 7, combo: { tag: 'Post', pts: 3 } }, { fx: { pts: 9, combo: { tag: 'Post', pts: 4 } } }),
  C('pull_up', 'Pull-Up', 'shot', 'common', 1, ['Handle'], 'jumper', { pts: 8 }, { fx: { pts: 11 } }),
  C('spot_up', 'Spot-Up', 'shot', 'common', 1, ['Perimeter'], 'jumper', { pts: 6, combo: { tag: 'Pass', pts: 2, draw: 1 } }, { fx: { pts: 8, combo: { tag: 'Pass', pts: 3, draw: 1 } } }),
  C('finger_roll', 'Finger Roll', 'shot', 'common', 0, ['Drive'], 'layup', { pts: 4 }, { fx: { pts: 6 } }),
  C('tip_in', 'Tip-In', 'shot', 'common', 0, ['Hustle'], 'layup', { pts: 3, combo: { tag: 'Hustle', pts: 3 } }, { fx: { pts: 4, combo: { tag: 'Hustle', pts: 4 } } }),
  C('bank_shot', 'Bank Shot', 'shot', 'common', 1, ['Post'], 'jumper', { pts: 7 }, { fx: { pts: 10 } }, { hold: true }),
  C('elbow_jumper', 'Elbow Jumper', 'shot', 'common', 1, ['Perimeter'], 'jumper', { pts: 5, draw: 1 }, { fx: { pts: 7, draw: 1 } }),
  C('logo_three', 'From the Logo', 'shot', 'common', 2, ['Perimeter'], 'three', { pts: 14 }, { fx: { pts: 18 } }),
  C('and_one', 'And-One', 'shot', 'common', 2, ['Drive'], 'layup', { pts: 10, stops: 4 }, { fx: { pts: 13, stops: 5 } }),
  C('leak_out', 'Leak Out', 'shot', 'common', 1, ['Drive'], 'layup', { pts: 5, special: 'first_card', bonus: 5 }, { fx: { pts: 6, special: 'first_card', bonus: 7 } }),
  C('pump_fake', 'Pump Fake', 'shot', 'common', 1, ['Drive'], 'layup', { pts: 5, foe: { cold: 1 } }, { fx: { pts: 7, foe: { cold: 2 } } }),

  // ---------- Shots: uncommon ----------
  C('step_back_three', 'Step-Back Three', 'shot', 'uncommon', 1, ['Perimeter'], 'stepback', { pts: 7, combo: { tag: 'Handle', pts: 6 } }, { fx: { pts: 9, combo: { tag: 'Handle', pts: 7 } } }),
  C('euro_step', 'Euro Step', 'shot', 'uncommon', 1, ['Drive'], 'layup', { pts: 6, combo: { tag: 'Handle', pts: 5, foe: { exposed: 1 } } }, { fx: { pts: 8, combo: { tag: 'Handle', pts: 6, foe: { exposed: 1 } } } }),
  C('tomahawk', 'Tomahawk', 'shot', 'uncommon', 2, ['Drive'], 'dunk', { pts: 13, combo: { tag: 'Drive', pts: 6 } }, { fx: { pts: 16, combo: { tag: 'Drive', pts: 7 } } }),
  C('alley_oop', 'Alley-Oop', 'shot', 'uncommon', 1, ['Drive'], 'lob', { pts: 6, combo: { tag: 'Pass', mult: 2 } }, { fx: { pts: 8, combo: { tag: 'Pass', mult: 2 } } }),
  C('drop_step', 'Drop Step', 'shot', 'uncommon', 1, ['Post'], 'post', { pts: 8, combo: { tag: 'Post', foe: { exposed: 2 } } }, { fx: { pts: 10, combo: { tag: 'Post', foe: { exposed: 2 } } } }),
  C('fadeaway', 'Fadeaway', 'shot', 'uncommon', 2, ['Post'], 'post', { pts: 13 }, { fx: { pts: 17 } }, { hold: true }),
  C('rain_check', 'Rain Check', 'shot', 'uncommon', 1, ['Perimeter'], 'three', { pts: 3, hits: 3 }, { fx: { pts: 4, hits: 3 } }),
  C('hesi_pull_up', 'Hesi Pull-Up', 'shot', 'uncommon', 1, ['Handle'], 'jumper', { pts: 7, combo: { tag: 'Handle', energy: 1 } }, { fx: { pts: 9, combo: { tag: 'Handle', energy: 1 } } }),
  C('bench_shooter', 'Bench Shooter', 'shot', 'uncommon', 1, ['Perimeter'], 'three', { pts: 5, depth: { per: 4, add: 2, k: 'pts' } }, { fx: { pts: 7, depth: { per: 4, add: 3, k: 'pts' } } }),
  C('coast_to_coast', 'Coast to Coast', 'shot', 'uncommon', 2, ['Drive'], 'dunk', { pts: 9, tight: { pts: 8, draw: 1 } }, { fx: { pts: 12, tight: { pts: 9, draw: 1 } } }),
  C('dagger', 'Dagger', 'shot', 'uncommon', 1, ['Perimeter'], 'three', { pts: 7, clutch: { mult: 2 } }, { fx: { pts: 9, clutch: { mult: 2 } } }),
  C('reverse_layup', 'Reverse Layup', 'shot', 'uncommon', 1, ['Drive'], 'layup', { pts: 7, special: 'draw_if_exposed' }, { fx: { pts: 9, special: 'draw_if_exposed' } }),
  C('offensive_board', 'Offensive Board', 'shot', 'uncommon', 1, ['Hustle'], 'rebound', { pts: 4, stops: 4, combo: { tag: 'Hustle', pts: 4, stops: 4 } }, { fx: { pts: 6, stops: 5, combo: { tag: 'Hustle', pts: 4, stops: 4 } } }),
  C('baseline_drive', 'Baseline Drive', 'shot', 'uncommon', 1, ['Drive'], 'dunk', { pts: 6, depth: { per: 4, add: 2, k: 'pts' } }, { fx: { pts: 8, depth: { per: 4, add: 3, k: 'pts' } } }),
  C('short_corner', 'Short Corner', 'shot', 'uncommon', 0, ['Post'], 'jumper', { pts: 5, tight: { pts: 4 } }, { fx: { pts: 7, tight: { pts: 4 } } }),

  // ---------- Shots: rare ----------
  C('high_hook', 'High Hook', 'shot', 'rare', 2, ['Post'], 'post', { pts: 18 }, { fx: { pts: 24 } }, { burn: true }),
  C('statement_dunk', 'Statement Dunk', 'shot', 'rare', 2, ['Drive'], 'dunk', { pts: 12, hot: 2 }, { fx: { pts: 15, hot: 2 } }),
  C('range_finder', 'Range Finder', 'shot', 'rare', 2, ['Perimeter'], 'three', { pts: 6, special: 'per_tag_played', tag: 'Perimeter', bonus: 5 }, { fx: { pts: 8, special: 'per_tag_played', tag: 'Perimeter', bonus: 6 } }),
  C('heat_check', 'Heat Check', 'shot', 'rare', 1, ['Perimeter'], 'three', { pts: 3, special: 'per_type_played', ptype: 'shot', bonus: 3 }, { fx: { pts: 5, special: 'per_type_played', ptype: 'shot', bonus: 4 } }),
  C('rim_rattler', 'Rim Rattler', 'shot', 'rare', 3, ['Drive'], 'dunk', { pts: 22, foe: { cold: 2 } }, { fx: { pts: 28, foe: { cold: 2 } } }),
  C('chain_reaction', 'Chain Reaction', 'shot', 'rare', 1, ['Pass'], 'three', { pts: 5, special: 'flow_triple' }, { fx: { pts: 7, special: 'flow_triple' } }),
  C('isolation', 'Isolation', 'shot', 'rare', 2, ['Handle'], 'stepback', { pts: 10, foe: { exposed: 1 }, combo: { tag: 'Handle', pts: 10 } }, { fx: { pts: 13, foe: { exposed: 1 }, combo: { tag: 'Handle', pts: 12 } } }),

  // ---------- Defense: common ----------
  C('hand_in_face', 'Hand in the Face', 'defense', 'common', 1, ['Hustle'], 'contest', { stops: 4, foe: { cold: 1 } }, { fx: { stops: 6, foe: { cold: 1 } } }),
  C('box_out', 'Box Out', 'defense', 'common', 1, ['Post'], 'rebound', { stops: 7 }, { fx: { stops: 10 } }),
  C('help_side', 'Help Side', 'defense', 'common', 1, ['Pass'], 'contest', { stops: 5, combo: { tag: 'Pass', stops: 4 } }, { fx: { stops: 7, combo: { tag: 'Pass', stops: 5 } } }),
  C('dig', 'Dig', 'defense', 'common', 0, ['Handle'], 'steal', { stops: 3, combo: { tag: 'Handle', stops: 3 } }, { fx: { stops: 4, combo: { tag: 'Handle', stops: 4 } } }),
  C('take_charge', 'Take the Charge', 'defense', 'common', 1, ['Hustle'], 'foul', { stops: 9, selfDmg: 2 }, { fx: { stops: 12, selfDmg: 2 } }),
  C('ice_screen', 'Ice the Screen', 'defense', 'common', 1, ['Hustle'], 'closeout', { stops: 6, hustle: true }, { fx: { stops: 8, hustle: true } }),
  C('pick_up_full', 'Pick Up Full', 'defense', 'common', 1, ['Hustle'], 'closeout', { stops: 4, foe: { gassed: 1 } }, { fx: { stops: 6, foe: { gassed: 2 } } }),
  C('block_shot', 'Swat', 'defense', 'common', 2, ['Post'], 'block', { stops: 12 }, { fx: { stops: 16 } }),
  C('swipe', 'Swipe', 'defense', 'common', 1, ['Handle'], 'steal', { stops: 4, draw: 1 }, { fx: { stops: 6, draw: 1 } }),

  // ---------- Defense: uncommon ----------
  C('wall_up', 'Wall Up', 'defense', 'uncommon', 1, ['Post'], 'contest', { stops: 5, depth: { per: 4, add: 2, k: 'stops' } }, { fx: { stops: 7, depth: { per: 4, add: 3, k: 'stops' } } }),
  C('trailer_block', 'Trailer Block', 'defense', 'uncommon', 1, ['Hustle'], 'block', { stops: 7, combo: { tag: 'Drive', stops: 6 } }, { fx: { stops: 9, combo: { tag: 'Drive', stops: 7 } } }),
  C('shut_down', 'Shut Down', 'defense', 'uncommon', 2, ['Hustle'], 'closeout', { stops: 12, hustle: true }, { fx: { stops: 16, hustle: true } }),
  C('ball_hawk', 'Ball Hawk', 'defense', 'uncommon', 1, ['Handle'], 'steal', { stops: 5, foe: { exposed: 1 } }, { fx: { stops: 7, foe: { exposed: 1 } } }),
  C('rotation', 'Rotation', 'defense', 'uncommon', 1, ['Pass'], 'contest', { stops: 6, draw: 1 }, { fx: { stops: 8, draw: 1 } }),
  C('stonewall', 'Stonewall', 'defense', 'uncommon', 1, ['Post'], 'contest', { stops: 5, tight: { stops: 6 } }, { fx: { stops: 7, tight: { stops: 7 } } }),
  C('hedge', 'Hedge', 'defense', 'uncommon', 0, ['Handle'], 'closeout', { stops: 4 }, { fx: { stops: 6 } }),
  C('board_man', 'Board Man', 'defense', 'uncommon', 1, ['Hustle'], 'rebound', { stops: 6, heal: 2 }, { fx: { stops: 8, heal: 3 } }),
  C('swat_party', 'Swat Party', 'defense', 'uncommon', 2, ['Post'], 'block', { stops: 9, pts: 5 }, { fx: { stops: 11, pts: 7 } }),
  C('last_line', 'Last Line', 'defense', 'uncommon', 1, ['Hustle'], 'block', { stops: 7, clutch: { mult: 2 } }, { fx: { stops: 9, clutch: { mult: 2 } } }),

  // ---------- Defense: rare ----------
  C('paint_patrol', 'Paint Patrol', 'defense', 'rare', 2, ['Post'], 'block', { stops: 15, foe: { cold: 2 } }, { fx: { stops: 20, foe: { cold: 2 } } }),
  C('strip_job', 'Strip Job', 'defense', 'rare', 1, ['Handle'], 'steal', { stops: 4, draw: 2, special: 'strip' }, { fx: { stops: 6, draw: 2, special: 'strip' } }),
  C('full_denial', 'Full Denial', 'defense', 'rare', 2, ['Hustle'], 'contest', { stops: 10, hustle: true, foe: { gassed: 2, cold: 1 } }, { fx: { stops: 13, hustle: true, foe: { gassed: 2, cold: 2 } } }),

  // ---------- Moves ----------
  C('hesitation', 'Hesitation', 'move', 'common', 0, ['Handle'], 'crossover', { next: { add: 3 } }, { fx: { next: { add: 5 } } }),
  C('between_legs', 'Between the Legs', 'move', 'common', 0, ['Handle'], 'crossover', { draw: 1 }, { fx: { draw: 1, stops: 3 } }),
  C('spin_move', 'Spin Move', 'move', 'common', 1, ['Drive'], 'spin', { draw: 2 }, { fx: { draw: 3 } }),
  C('jab_step', 'Jab Step', 'move', 'common', 0, ['Perimeter'], 'stepback', { stops: 2, next: { tag: 'Perimeter', add: 3 } }, { fx: { stops: 3, next: { tag: 'Perimeter', add: 5 } } }),
  C('drop_shoulder', 'Drop the Shoulder', 'move', 'common', 1, ['Post'], 'post', { stops: 4, next: { tag: 'Post', add: 5 } }, { fx: { stops: 6, next: { tag: 'Post', add: 6 } } }),
  C('hop_step', 'Hop Step', 'move', 'common', 0, ['Drive'], 'spin', { draw: 1, next: { tag: 'Drive', add: 2 } }, { fx: { draw: 1, next: { tag: 'Drive', add: 4 } } }),
  C('behind_back', 'Behind the Back', 'move', 'common', 1, ['Handle'], 'crossover', { stops: 4, draw: 1 }, { fx: { stops: 6, draw: 1 } }),
  C('size_up', 'Size-Up', 'move', 'common', 0, ['Handle'], 'crossover', { draw: 1 }, { fx: { draw: 2 } }, { hold: true }),
  C('snatch_back', 'Snatch-Back', 'move', 'uncommon', 1, ['Handle'], 'stepback', { draw: 1, cheap: 9 }, { fx: { draw: 2, cheap: 9 } }),
  C('shake_loose', 'Shake Loose', 'move', 'uncommon', 1, ['Handle'], 'crossover', { foe: { exposed: 2, cold: 1 }, combo: { tag: 'Handle', draw: 2 } }, { fx: { foe: { exposed: 2, cold: 1 }, draw: 1, combo: { tag: 'Handle', draw: 2 } } }),
  C('yo_yo', 'Yo-Yo Dribble', 'move', 'uncommon', 0, ['Handle'], 'crossover', { energy: 1, combo: { tag: 'Handle', draw: 1 } }, { fx: { energy: 1, draw: 1, combo: { tag: 'Handle', draw: 1 } } }, { burn: true }),
  C('up_and_under', 'Up-and-Under', 'move', 'uncommon', 1, ['Post'], 'post', { stops: 5, foe: { exposed: 2 } }, { fx: { stops: 7, foe: { exposed: 2 } } }),
  C('killer_cross', 'Killer Crossover', 'move', 'rare', 1, ['Handle'], 'crossover', { foe: { exposed: 3 }, hot: 1, draw: 1 }, { fx: { foe: { exposed: 3 }, hot: 2, draw: 1 } }),

  // ---------- Plays ----------
  C('skip_pass', 'Skip Pass', 'play', 'common', 1, ['Pass'], 'pass', { draw: 2 }, { fx: { draw: 3 } }),
  C('kick_out', 'Kick Out', 'play', 'common', 0, ['Pass'], 'pass', { next: { tag: 'Perimeter', add: 4 } }, { fx: { next: { tag: 'Perimeter', add: 6 } } }),
  C('give_and_go', 'Give-and-Go', 'play', 'common', 0, ['Pass'], 'pass', { draw: 1, combo: { tag: 'Drive', energy: 1 } }, { fx: { draw: 1, stops: 2, combo: { tag: 'Drive', energy: 1 } } }),
  C('tape_job', 'Tape Job', 'play', 'common', 1, [], 'celebrate', { heal: 6 }, { fx: { heal: 9 } }, { burn: true }),
  C('second_wind', 'Second Wind', 'play', 'common', 0, ['Hustle'], 'celebrate', { energy: 1 }, { fx: { energy: 2 } }, { burn: true }),
  C('film_study', 'Film Study', 'play', 'common', 1, [], 'celebrate', { special: 'stat_match', stat: 'shooting', n: 1 }, { cost: 0 }, { burn: true }),
  C('hand_off', 'Hand-Off', 'play', 'common', 1, ['Pass'], 'pass', { stops: 4, draw: 1 }, { fx: { stops: 6, draw: 1 } }),
  C('lob_pass', 'Lob Pass', 'play', 'common', 0, ['Pass'], 'lob', { next: { tag: 'Drive', add: 5 } }, { fx: { next: { tag: 'Drive', add: 7 } } }),
  C('inbounds', 'Inbounds Play', 'play', 'common', 1, ['Pass'], 'pass', { stops: 3, charge: 1 }, { fx: { stops: 5, charge: 1 } }, { hold: true }),
  C('pick_and_roll', 'Pick-and-Roll', 'play', 'uncommon', 1, ['Pass', 'Drive'], 'pass', { energy: 2, draw: 1 }, { fx: { energy: 2, draw: 2 } }),
  C('no_look', 'No-Look', 'play', 'uncommon', 0, ['Pass'], 'pass', { draw: 2, cheap: 1 }, { fx: { draw: 2, cheap: 1, energy: 1 } }, { burn: true }),
  C('extra_pass', 'Extra Pass', 'play', 'uncommon', 0, ['Pass'], 'pass', { draw: 1 }, { fx: { draw: 2 } }, { wild: true }),
  C('clear_out', 'Clear Out', 'play', 'uncommon', 1, ['Handle'], 'pass', { draw: 2, special: 'burn_fatigue' }, { cost: 0 }),
  C('film_session', 'Chalk Talk', 'play', 'uncommon', 1, [], 'celebrate', { special: 'stat_match', stat: 'defense', n: 2 }, { cost: 0 }, { burn: true }),
  C('motion_offense', 'Motion Offense', 'play', 'rare', 1, ['Pass'], 'pass', { draw: 3, energy: 1 }, { fx: { draw: 4, energy: 1 } }),
  C('timeout', 'Full Timeout', 'play', 'rare', 2, [], 'celebrate', { heal: 10, stops: 8 }, { fx: { heal: 14, stops: 10 } }, { burn: true }),

  // ---------- Mentalities (last all match) ----------
  C('green_light', 'Green Light', 'mentality', 'uncommon', 1, [], 'celebrate', { power: { id: 'tag_pts', tag: 'Perimeter', n: 2 } }, { fx: { power: { id: 'tag_pts', tag: 'Perimeter', n: 3 } } }),
  C('bully_ball', 'Bully Ball', 'mentality', 'uncommon', 1, [], 'celebrate', { power: { id: 'tag_pts', tag: 'Post', n: 3 } }, { fx: { power: { id: 'tag_pts', tag: 'Post', n: 4 } } }),
  C('attack_rim', 'Attack the Rim', 'mentality', 'common', 1, [], 'celebrate', { power: { id: 'tag_pts', tag: 'Drive', n: 2 } }, { fx: { power: { id: 'tag_pts', tag: 'Drive', n: 3 } } }),
  C('d_mindset', 'Defensive Mindset', 'mentality', 'uncommon', 1, [], 'celebrate', { power: { id: 'turn_stops', n: 3 } }, { fx: { power: { id: 'turn_stops', n: 5 } } }),
  C('quarterback', 'Quarterback', 'mentality', 'rare', 2, [], 'celebrate', { power: { id: 'flow_twice', n: 1 } }, { cost: 1 }),
  C('swagger', 'Swagger', 'mentality', 'common', 1, [], 'celebrate', { hot: 2 }, { fx: { hot: 3 } }),
  C('late_calm', 'Late-Game Calm', 'mentality', 'uncommon', 1, [], 'celebrate', { power: { id: 'always_clutch', n: 1 } }, { cost: 0 }),
  C('playmaker', 'Playmaker', 'mentality', 'uncommon', 1, [], 'celebrate', { power: { id: 'tag_stops', tag: 'Pass', n: 2 } }, { fx: { power: { id: 'tag_stops', tag: 'Pass', n: 3 } } }),
  C('handle_mastery', 'Handle Mastery', 'mentality', 'rare', 1, [], 'celebrate', { power: { id: 'tag_draw', tag: 'Handle', n: 1 } }, { cost: 0 }),
  C('next_play', 'Next Play', 'mentality', 'uncommon', 1, [], 'celebrate', { power: { id: 'turn_draw', n: 1 } }, { cost: 0 }),
  C('grit', 'Grit', 'mentality', 'rare', 2, [], 'celebrate', { power: { id: 'tag_stops', tag: 'Hustle', n: 3 } }, { cost: 1 }),
  C('deep_bench', 'Deep Bench', 'mentality', 'uncommon', 1, [], 'celebrate', { power: { id: 'depth_stops', n: 4 } }, { fx: { power: { id: 'depth_stops', n: 3 } } }),
  C('lean_rotation', 'Lean Rotation', 'mentality', 'rare', 1, [], 'celebrate', { power: { id: 'tight_energy', n: 1 } }, { cost: 0 }),
  C('trash_talker', 'Trash Talker', 'mentality', 'uncommon', 1, [], 'celebrate', { power: { id: 'turn_cold', n: 1 } }, { cost: 0 }),
  C('showman', 'Showman', 'mentality', 'rare', 2, [], 'celebrate', { power: { id: 'combo_hot', n: 1 } }, { cost: 1 }),

  // ---------- Fatigue (junk) ----------
  C('heavy_legs', 'Heavy Legs', 'fatigue', 'fatigue', null, [], 'gassed', {}, {}, { unplayable: true, temp: true }),
  C('cramp', 'Cramp', 'fatigue', 'fatigue', null, [], 'gassed', { inHand: { dmg: 2 } }, {}, { unplayable: true, temp: true }),
  C('ticky_tack', 'Ticky-Tack Foul', 'fatigue', 'fatigue', null, [], 'foul', { drawn: { energy: -1 } }, {}, { unplayable: true, temp: true }),
  C('blister', 'Blister', 'fatigue', 'fatigue', 1, [], 'gassed', {}, {}, { burn: true }),
  C('guilty', 'Guilty Conscience', 'fatigue', 'fatigue', null, [], 'gassed', {}, {}, { unplayable: true }),
  C('doubt', 'Doubt', 'fatigue', 'fatigue', null, [], 'gassed', { inHand: { cold: 1 } }, {}, { unplayable: true }),
  C('bad_knee', 'Bad Knee', 'fatigue', 'fatigue', null, [], 'gassed', { inHand: { shot: 1 } }, {}, { unplayable: true }),
  C('rust', 'Rust', 'fatigue', 'fatigue', 2, [], 'gassed', {}, {}, { burn: true }),
];

export const CARDS = Object.assign(Object.create(null), Object.fromEntries(CARD_LIST.map(c => [c.id, c]))); // (no prototype: '__proto__' is just unknown)
export const STARTER_DECK = ['jumper', 'jumper', 'jumper', 'jumper', 'closeout', 'closeout', 'closeout', 'closeout', 'crossover', 'outlet_pass'];
export const FATIGUE_TEMP = CARD_LIST.filter(c => c.type === 'fatigue' && c.temp).map(c => c.id);
export const FATIGUE_CURSE = CARD_LIST.filter(c => c.type === 'fatigue' && !c.temp).map(c => c.id);
export const POOL = r => CARD_LIST.filter(c => c.rarity === r).map(c => c.id);

export const baseId = ref => String(ref || '').replace(/\+$/, '');
export const isUp = ref => /\+$/.test(String(ref || ''));
export const known = ref => !!CARDS[baseId(ref)];
export const canUpgrade = ref => known(ref) && !isUp(ref) && CARDS[baseId(ref)].type !== 'fatigue';
export const upgraded = ref => (canUpgrade(ref) ? baseId(ref) + '+' : ref);

// the definition with the upgrade merged in
const DEF_CACHE = new Map();
export function cardDef(ref) {
  let d = DEF_CACHE.get(ref);
  if (d) return d;
  const base = CARDS[baseId(ref)];
  if (!base) return null;
  if (!isUp(ref)) d = { ...base, upgraded: false, ref };
  else d = { ...base, cost: base.up.cost ?? base.cost, fx: base.up.fx ? { ...base.fx, ...base.up.fx } : base.fx, upgraded: true, ref, name: base.name + '+' };
  DEF_CACHE.set(ref, d);
  return d;
}

// ---------- text ----------
const ST = { cold: 'Cold', exposed: 'Exposed', gassed: 'Gassed' };
const POWER_TEXT = {
  tag_pts: p => `${p.tag} Shots score +${p.n} this match.`,
  tag_stops: p => `Whenever you play a ${p.tag} card, gain ${p.n} Stops.`,
  tag_draw: p => `Whenever you play a ${p.tag} card, draw ${p.n} (up to 3 a turn).`,
  turn_stops: p => `At the start of each turn, gain ${p.n} Stops.`,
  turn_draw: p => `At the start of each turn, draw ${p.n} more.`,
  turn_cold: p => `At the start of each turn, the opponent is Cold ${p.n}.`,
  flow_twice: () => 'Flow can trigger twice each turn.',
  always_clutch: () => 'Clutch is always on.',
  depth_stops: p => `At the start of each turn, gain 1 Stop for every ${p.n} cards in your deck.`,
  tight_energy: p => `While your deck is Tight, +${p.n} energy each turn.`,
  combo_hot: p => `Whenever a Combo triggers, gain Hot ${p.n}.`,
};
function fxText(fx, def, top = true) {
  const out = [];
  if (fx.pts != null) out.push(fx.hits > 1 ? `Score ${fx.pts} ×${fx.hits}.` : `Score ${fx.pts}.`);
  if (fx.stops) out.push(`${fx.hustle ? 'Hustle: ' : ''}${fx.stops} Stops.`);
  if (fx.selfDmg) out.push(`Take ${fx.selfDmg}.`);
  if (fx.heal) out.push(`Heal ${fx.heal}.`);
  if (fx.energy) out.push(`+${fx.energy} energy.`);
  if (fx.charge) out.push(`+${fx.charge} energy next turn.`);
  if (fx.draw) out.push(`Draw ${fx.draw}.`);
  if (fx.hot) out.push(def?.type === 'mentality' && top ? `You are Hot ${fx.hot} for the match.` : `Hot ${fx.hot}.`);
  if (fx.foe) for (const [k, n] of Object.entries(fx.foe)) out.push(`${ST[k]} ${n}.`);
  if (fx.next) out.push(`Your next ${fx.next.tag ? fx.next.tag + ' ' : ''}Shot this turn scores +${fx.next.add}.`);
  if (fx.cheap) out.push(fx.cheap >= 9 ? 'Your next card this turn costs 0.' : `Your next card this turn costs ${fx.cheap} less.`);
  if (fx.mult) out.push(`Double it.`);
  if (fx.special === 'first_card') out.push(`If it's your first card this turn, +${fx.bonus}.`);
  if (fx.special === 'draw_if_exposed') out.push('If the opponent is Exposed, draw 1.');
  if (fx.special === 'per_tag_played') out.push(`+${fx.bonus} for each other ${fx.tag} card played this turn.`);
  if (fx.special === 'per_type_played') out.push(`+${fx.bonus} for each Shot played before it this turn.`);
  if (fx.special === 'flow_triple') out.push('Hits 3 times if Flow triggered this turn.');
  if (fx.special === 'strip') out.push('The opponent loses all his Stops.');
  if (fx.special === 'burn_fatigue') out.push('Burn a Fatigue card in your hand.');
  if (fx.special === 'stat_match') out.push(`+${fx.n} ${fx.stat[0].toUpperCase() + fx.stat.slice(1)} for this match.`);
  if (fx.power) out.push(POWER_TEXT[fx.power.id] ? POWER_TEXT[fx.power.id](fx.power) : '');
  if (fx.depth) out.push(`Depth: +${fx.depth.add} ${fx.depth.k === 'pts' ? 'points' : 'Stops'} for every ${fx.depth.per} cards past ${DEPTH_FROM} in your deck.`);
  if (fx.tight) out.push(`Tight: ${fxText(fx.tight, def, false).replace(/Score (\d+)\./, '+$1 points.').replace(/(\d+) Stops\./, '+$1 Stops.')}`);
  if (fx.clutch) out.push(`Clutch: ${fx.clutch.mult ? 'double it' : fxText(fx.clutch, def, false)}.`.replace('..', '.'));
  if (fx.combo) {
    const c = fx.combo, rest = { ...c }; delete rest.tag;
    out.push(`Combo ${c.tag}: ${c.mult ? 'double it.' : fxText(rest, def, false).replace(/Score (\d+)\./, '+$1 points.').replace(/^(\d+) Stops\./, '+$1 Stops.')}`);
  }
  if (fx.inHand?.dmg) out.push(`At the end of your turn, if it's in your hand, take ${fx.inHand.dmg}.`);
  if (fx.inHand?.cold) out.push(`At the end of your turn, if it's in your hand, Cold ${fx.inHand.cold}.`);
  if (fx.inHand?.shot) out.push(`While it's in your hand, your Shots score ${fx.inHand.shot} less.`);
  if (fx.drawn?.energy) out.push(`When drawn, lose ${-fx.drawn.energy} energy.`);
  return out.join(' ');
}
export function cardText(ref) {
  const d = cardDef(ref);
  if (!d) return '';
  const kw = [];
  if (d.unplayable) kw.push('Unplayable.');
  if (d.hold) kw.push('Hold.');
  if (d.wild) kw.push('Counts as every tag for Flow.');
  const t = fxText(d.fx, d);
  if (d.burn) kw.push('Burn.');
  return [kw.filter(k => k !== 'Burn.').join(' '), t, d.burn ? 'Burn.' : ''].filter(Boolean).join(' ').trim();
}
export function cardInfo(ref) {
  const d = cardDef(ref);
  if (!d) return { id: baseId(ref), name: String(ref), cost: null, type: 'fatigue', rarity: 'fatigue', tags: [], text: 'Unknown card.', anim: 'gassed', upgraded: false };
  return { id: d.id, ref, name: d.name, cost: d.unplayable ? null : d.cost, type: d.type, rarity: d.rarity, tags: d.tags.slice(), text: cardText(ref), anim: d.anim, upgraded: d.upgraded,
    burn: !!d.burn, hold: !!d.hold, unplayable: !!d.unplayable };
}
