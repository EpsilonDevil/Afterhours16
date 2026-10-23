// The Gauntlet's abilities (GAUNTLET.md §6), the genre's relics. Data plus the one-time effect when you get one;
// everything they do during a match is read by combat.js (has(run, id)) and the run code (Coolers, Shops, coins).
//
// Balance reasoning:
//  * Commons are worth ~1 card upgrade over a run (a few points or Stops a match), uncommons ~a good card, rares bend
//    a rule (Flow, Clutch, Tight/Depth thresholds, death). Stat abilities (+1 to a stat) sit at uncommon: +1 Shooting
//    is +0.5 on every Shot hit (⌊stat/2⌋), +1 Stamina only matters at the 4→5 / 8→9 steps, so they're good, not wild.
//  * Boss abilities are +1 energy (≈ +30% output) with a real cost, as in the genre: the choice is which cost your
//    deck can live with.
//  * Shop abilities are economy: they pay back over the next 2-3 shops.
// Called by: combat.js (what they do in a match), run.js (Coolers, Shops, coins); the UI through index.js abilityInfo.

export const ABILITY_LIST = [
  // common
  { id: 'lucky_headband', name: 'Lucky Headband', rarity: 'common', text: 'The first Shot each match scores double.' },
  { id: 'wristbands', name: 'Wristbands', rarity: 'common', text: 'Start each match with 5 Stops (they wait for your first defense).' },
  { id: 'chalk_bag', name: 'Chalk Bag', rarity: 'common', text: 'On your first possession each match, your Shots score +3.' },
  { id: 'water_bottle', name: 'Water Bottle', rarity: 'common', text: 'Heal 4 after every match you win.' },
  { id: 'lucky_socks', name: 'Lucky Socks', rarity: 'common', text: '+10 max Health.' },
  { id: 'knee_pads', name: 'Knee Pads', rarity: 'common', text: 'Your first Defense card each turn gives +3 Stops.' },
  { id: 'pregame_meal', name: 'Pre-Game Meal', rarity: 'common', text: 'Heal 8 when a Rival or Boss match starts.' },
  { id: 'playbook', name: 'Playbook', rarity: 'common', text: 'Draw 2 more cards on turn 1.' },
  { id: 'tip_jar', name: 'Tip Jar', rarity: 'common', text: '+8 coins for every match you win.' },
  { id: 'jump_rope', name: 'Jump Rope', rarity: 'common', text: 'Every 3rd card you play in a turn gives 3 Stops.' },
  { id: 'sweatband', name: 'Sweatband', rarity: 'common', text: 'The first time each match you\'d be made Cold, you aren\'t.' },
  { id: 'mouthguard', name: 'Mouthguard', rarity: 'common', text: 'The first basket against you each match scores 0.' },
  // uncommon
  { id: 'scouting_report', name: 'Scouting Report', rarity: 'uncommon', text: 'Read hidden sets (against the Shadow, his total).' },
  { id: 'film_reel', name: 'Film Reel', rarity: 'uncommon', text: 'Your first Combo each turn gives +1 energy.' },
  { id: 'metronome', name: 'Metronome', rarity: 'uncommon', text: 'Flow also gives 4 Stops.' },
  { id: 'heavy_ball', name: 'Heavy Ball', rarity: 'uncommon', text: 'Post Shots score +2.' },
  { id: 'drive_lanes', name: 'Driving Lanes', rarity: 'uncommon', text: 'Your first Drive card each turn makes the opponent Exposed 1.' },
  { id: 'trainers_table', name: 'Trainer\'s Table', rarity: 'uncommon', text: 'Coolers also let you remove a card.' },
  { id: 'ice_bucket', name: 'Ice Bucket', rarity: 'uncommon', text: 'Coolers also offer an Ice Bath: +1 Stamina for the run (once).' },
  { id: 'iron_lungs', name: 'Iron Lungs', rarity: 'uncommon', text: '+1 Stamina for the run.' },
  { id: 'protein_shake', name: 'Protein Shake', rarity: 'uncommon', text: '+1 Health for the run.' },
  { id: 'game_tape', name: 'Game Tape', rarity: 'uncommon', text: '+1 Shooting for the run.' },
  { id: 'grip_gloves', name: 'Grip Gloves', rarity: 'uncommon', text: '+1 Defense for the run.' },
  { id: 'hustle_tape', name: 'Hustle Tape', rarity: 'uncommon', text: 'Hustle cards give +2 Stops.' },
  { id: 'assist_log', name: 'Assist Log', rarity: 'uncommon', text: 'Your 2nd Pass card each turn draws 1.' },
  // rare
  { id: 'sixth_man', name: 'Sixth Man', rarity: 'rare', text: 'The first time you\'d drop to 0 Health in a run, go to 25% instead.' },
  { id: 'second_gear', name: 'Second Gear', rarity: 'rare', text: 'Flow gives +2 energy instead of +1.' },
  { id: 'captains_band', name: 'Captain\'s Band', rarity: 'rare', text: 'On turn 1: +1 energy and Hot 1.' },
  { id: 'muscle_memory', name: 'Muscle Memory', rarity: 'rare', text: 'At the end of your turn, Hold one card.' },
  { id: 'deep_rotation', name: 'Deep Rotation', rarity: 'rare', text: 'Depth cards count 6 more cards.' },
  { id: 'minimalist', name: 'Minimalist', rarity: 'rare', text: 'Tight works at 15 cards or fewer.' },
  { id: 'clutch_chain', name: 'Clutch Chain', rarity: 'rare', text: 'Clutch works below 70% Health.' },
  { id: 'hot_hand', name: 'Hot Hand', rarity: 'rare', text: 'Whenever you score 15+ in one possession, gain Hot 1.' },
  { id: 'ankle_weights', name: 'Ankle Weights', rarity: 'rare', text: '+1 energy, but draw 1 fewer card on turn 1.' },
  // boss: strong, with a drawback
  { id: 'max_contract', name: 'Max Contract', rarity: 'boss', text: '+1 energy each turn. Won matches pay half coins.' },
  { id: 'superteam', name: 'Superteam', rarity: 'boss', text: 'Draw 1 more card each turn. Coolers can\'t heal.' },
  { id: 'signature_shoe', name: 'Signature Shoe', rarity: 'boss', text: '+1 energy each turn. Every match starts with a Ticky-Tack Foul in your draw pile.' },
  { id: 'franchise_tag', name: 'Franchise Tag', rarity: 'boss', text: '+1 energy each turn. You can\'t read their sets.' },
  { id: 'spotlight', name: 'Spotlight', rarity: 'boss', text: '+1 energy each turn. You can play only 6 cards a turn.' },
  // shop
  { id: 'sneaker_deal', name: 'Sneaker Deal', rarity: 'shop', text: 'Shops are 20% cheaper.' },
  { id: 'punch_card', name: 'Punch Card', rarity: 'shop', text: 'Removing a card at a shop always costs 50.' },
  { id: 'agent', name: 'Agent', rarity: 'shop', text: '+25% coins from matches.' },
  { id: 'ice_chest', name: 'Ice Chest', rarity: 'shop', text: 'Coolers heal 40% instead of 30%.' },
];
export const ABILITIES = Object.assign(Object.create(null), Object.fromEntries(ABILITY_LIST.map(a => [a.id, a])));
export const ABILITY_POOL = r => ABILITY_LIST.filter(a => a.rarity === r).map(a => a.id);
export const ENERGY_ABILITIES = ['max_contract', 'signature_shoe', 'franchise_tag', 'spotlight', 'ankle_weights'];
export const STAT_CAP = 10;

export function abilityInfo(id) {
  const a = ABILITIES[id];
  return a ? { id: a.id, name: a.name, rarity: a.rarity, text: a.text } : { id, name: String(id), rarity: 'common', text: '' };
}
export const maxHpFor = health => 30 + 6 * health; // §2
export const energyFor = stamina => (stamina >= 9 ? 5 : stamina >= 5 ? 4 : 3); // §2

// a stat changes for the run: Health keeps the same damage taken, the others just move
export function bumpStat(run, stat, n) {
  const s = run.player.stats, before = s[stat];
  s[stat] = Math.max(1, Math.min(STAT_CAP, before + n));
  if (stat === 'health') {
    const old = run.maxHp; run.maxHp = maxHpFor(s.health) + (run.bonusHp || 0);
    run.hp = Math.max(1, Math.min(run.maxHp, run.hp + (run.maxHp - old)));
  }
  return s[stat] - before;
}
// the moment you get one
export function gainAbility(run, id) {
  if (!ABILITIES[id] || run.abilities.includes(id)) return false;
  run.abilities.push(id);
  if (id === 'lucky_socks') { run.bonusHp = (run.bonusHp || 0) + 10; run.maxHp += 10; run.hp += 10; }
  if (id === 'iron_lungs') bumpStat(run, 'stamina', 1);
  if (id === 'protein_shake') bumpStat(run, 'health', 1);
  if (id === 'game_tape') bumpStat(run, 'shooting', 1);
  if (id === 'grip_gloves') bumpStat(run, 'defense', 1);
  return true;
}
