// The Gauntlet's match rules (GAUNTLET.md §4): every match draws 1-2 from this pool, shown on the bracket before you
// pick the node. combat.js reads them through has(m, id) and the numbers here.
//
// Balance reasoning: each rule is a nudge worth roughly ±10% of a match's outcome, never a hard counter, so a deck
// that doesn't like tonight's rules still wins with care, and a deck that does gets a good night. Rules that are
// pure upside for you (Home Crowd, Make-It-Take-It) are paired with a downside draw half the time by pickRules.
// Called by: combat.js (what each rule does), map.js (pickRules for each match node).

export const RULES = [
  { id: 'make_it_take_it', name: 'Make-It-Take-It', text: 'Whoever scores keeps the ball; you draw 1 when you do.', good: true },
  { id: 'threes_double', name: 'Threes Count Double', text: 'Perimeter shots +50%, his threes too.' },
  { id: 'shot_clock', name: 'Shot Clock', text: 'On offense, put up a Shot or take 3 and lose the ball.', bad: true },
  { id: 'physical', name: 'Physical Night', text: 'Defense +2, Shots −1, both sides; every Drive or Post shot draws a foul.' },
  { id: 'win_by_2', name: 'Win By 2', text: 'The opponent heals once when he hits 1 Heart.', bad: true },
  { id: 'no_timeouts', name: 'No Timeouts', text: 'No healing in this match.', bad: true },
  { id: 'run_and_gun', name: 'Run & Gun', text: '+1 energy, and both sides\' shots +2.' },
  { id: 'old_school', name: 'Old School', text: 'No Mentalities.', bad: true },
  { id: 'home_crowd', name: 'Home Crowd', text: 'You start Hot 1.', good: true },
  { id: 'hostile_crowd', name: 'Hostile Crowd', text: 'You start Cold 1.', bad: true },
  { id: 'and_one_night', name: 'And-One Night', text: 'Your first Shot each possession scores +3.', good: true },
  { id: 'ball_movement', name: 'Ball Movement', text: 'Your first Pass card each turn costs 0.', good: true },
  { id: 'up_tempo', name: 'Up-Tempo', text: 'Draw 6 cards a turn; his shots +1.' },
  { id: 'short_game', name: 'Short Game', text: 'He has 25% less Heart, but his shots score +25%.' },
  { id: 'no_blood', name: 'No Blood, No Foul', text: 'Fatigue cards burn when drawn, and you draw another.', good: true },
  { id: 'windy', name: 'Windy Night', text: 'Perimeter shots −2, Drive shots +2.' },
  { id: 'king_court', name: 'King of the Court', text: 'He has +20% Heart; the match pays +50% coins.' },
  { id: 'overtime', name: 'Overtime', text: 'From the 9th possession, both sides\' shots +3.' },
  { id: 'tight_whistle', name: 'Tight Whistle', text: 'Nobody can be made Cold, Exposed or Gassed, and no fouls.' },
  { id: 'deep_bench', name: 'Deep Bench', text: 'Depth cards count 8 more cards; nothing is Tight.' },
  { id: 'half_court', name: 'Half Court', text: 'Tight always applies; Depth counts nothing.' },
  { id: 'trash_talk', name: 'Trash Talk', text: 'Whoever scores 12+ in one possession becomes Hot 1.' },
];
export const RULE_IDS = RULES.map(r => r.id);
export const RULE_BY_ID = Object.assign(Object.create(null), Object.fromEntries(RULES.map(r => [r.id, r])));
import { next, pick, chance } from './rng.js';
// rules that can't sit together
const CLASH = [['home_crowd', 'hostile_crowd'], ['deep_bench', 'half_court'], ['physical', 'run_and_gun']];
export const ruleView = id => { const r = RULE_BY_ID[id]; return r ? { id: r.id, name: r.name, text: r.text } : { id, name: id, text: '' }; };

// 1-2 rules for a match node (bosses always get 1, Rivals 2 half the time)
export function pickRules(st, kind = 'match') {
  const n = kind === 'boss' ? 1 : chance(st, kind === 'rival' ? 0.5 : 0.35) ? 2 : 1;
  const out = [pick(st, RULE_IDS)];
  while (out.length < n) {
    const pool = RULE_IDS.filter(id => !out.includes(id) && !CLASH.some(([a, b]) => (a === id && out.includes(b)) || (b === id && out.includes(a))));
    // a good rule pulls a downside in with it half the time
    const want = RULE_BY_ID[out[0]].good && next(st) < 0.5 ? pool.filter(id => RULE_BY_ID[id].bad) : pool;
    out.push(pick(st, want.length ? want : pool));
  }
  return out;
}
