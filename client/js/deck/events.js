// The Gauntlet's Mystery Stops (GAUNTLET.md §7): 26 events with choices, 9 of them driven by the nemesis system
// (helping or wronging a character counts toward the living world, §8). Every outcome is drawn from the run's seed.
// All text is original.
//
// Balance reasoning: each choice trades about one card reward's worth of value: ~25-60 coins, 5-12 Health, an
// upgrade, a removal or an ability against a Fatigue card. A gamble's expected value is a little above "leave",
// because the genre rewards risk. Nemesis choices cost a little now (coins, Health) for an ally later; wronging
// someone pays now and costs later (grudges, ambushes, betrayals).
// Called by: run.js (pickEvent when a Mystery Stop is entered, eventView, eventResolve from eventChoose).
import * as R from './rng.js';
import { POOL, cardDef } from './cards.js';
import { addCard, removeCardAt, upgradeAt, healRun, hurtRun, coinsRun, abilityRun, statRun, maxHpRun, outcome, worstCardIndex, bestCardIndex, upgradableIdx, nameOf } from './runlib.js';
import { randomAbility } from './rewards.js';
import { charLine } from './nemesis.js';

const pct = (run, p) => Math.max(1, Math.round(run.maxHp * p));
const W = run => ({ chars: run.wc || {} });
const nm = (run, id) => run.chars[id]?.name || 'Somebody';
function upgradeRandom(run, st, n) {
  const out = [];
  for (let k = 0; k < n; k++) { const ids = upgradableIdx(run); if (!ids.length) break; const i = R.pick(st, ids); out.push(nameOf(upgradeAt(run, i))); }
  return out;
}
const fxs = () => { const l = []; const f = (kind, o = {}) => { l.push({ kind, ...o }); return f; }; f.list = l; return f; };

// ctx.chars: the characters on stage. who(run, st, want) chooses them from the run's known characters and its
// sideline cast (both registered at newRun, with names and looks)
function who(run, st, want = 'any') {
  const wc = run.wc || {};
  const known = Object.keys(wc).filter(id => run.chars[id]);
  const pools = {
    any: [...known, ...run.sideline],
    fresh: run.sideline.slice(),
    grudge: known.filter(id => wc[id].grudge > 0),
    owed: known.filter(id => wc[id].owes > 0 && run.plot?.betray?.charId !== id),
    ranked: known.filter(id => wc[id].rank >= 1),
    grudgeFriend: known.filter(id => wc[id].grudge > 0 && Object.entries(wc[id].rel || {}).some(([o, k]) => (k === 'friend' || k === 'protege') && run.chars[o])),
  };
  const pool = (pools[want] || pools.any).filter(id => !(run.usedChars || []).includes(id));
  return pool.length ? R.pick(st, pool.sort()) : null;
}
const used = (run, ...ids) => { run.usedChars = [...(run.usedChars || []), ...ids.filter(Boolean)]; };

export const EVENTS = [
  // ---------- generic ----------
  { id: 'street_hustler', title: 'The Hustler', text: () => 'A man with a thick fold of bills leans on the fence. "One shot. Make it, I pay double. Miss it, I keep yours."',
    choices: (run) => [
      { text: 'Bet 25 coins', hint: '55%: win 50', ok: run.coins >= 25, go: (run, c, st) => {
        const f = fxs();
        coinsRun(run, -25);
        f('coins', { n: -25 });
        if (R.chance(st, 0.55)) { coinsRun(run, 50); f('coins', { n: 50 }); return { text: 'Wet. He peels off fifty without a word.', effects: f.list }; } return { text: 'Rims out. He pockets your coins and grins.', effects: f.list };
      } },
      { text: 'Bet your body', hint: 'Take 8, gain 45 coins', ok: true, go: (run) => { hurtRun(run, 8); coinsRun(run, 45); return { text: 'He makes you guard him for an hour. You earn every coin.', effects: [{ kind: 'hp', n: -8 }, { kind: 'coins', n: 45 }] }; } },
      { text: 'Walk away', hint: '', ok: true, go: () => ({ text: 'You keep your money and your legs.', effects: [] }) },
    ] },
  { id: 'old_coach', title: 'The Old Coach', text: () => 'A gray-haired coach in a folding chair watches you warm up. "Your fundamentals are a mess. Sit."',
    choices: (run) => [
      { text: 'Let him rework a basic', hint: 'Transform your weakest card', ok: run.deck.length > 0, go: (run, c, st) => {
        const i = worstCardIndex(run), old = run.deck[i], d = cardDef(old);
        const pool = POOL('uncommon').filter(id => cardDef(id).type === (d.type === 'fatigue' ? 'shot' : d.type));
        const nw = R.pick(st, pool.length ? pool : POOL('uncommon'));
        run.deck[i] = nw;
        return { text: `"Throw that ${nameOf(old)} away. Do this instead." You learn ${nameOf(nw)}.`, effects: [{ kind: 'transform', from: old, to: nw }] };
      } },
      { text: 'Listen to the lecture', hint: 'Upgrade a random card', ok: upgradableIdx(run).length > 0, go: (run, c, st) => { const n = upgradeRandom(run, st, 1); return { text: `It takes an hour. Your ${n[0]} is better for it.`, effects: [{ kind: 'upgrade', cards: n }] }; } },
      { text: 'Leave', hint: '', ok: true, go: () => ({ text: '"Your loss," he says to nobody.', effects: [] }) },
    ] },
  { id: 'sneaker_plug', title: 'The Plug', text: () => 'A guy with a duffel bag of shoeboxes waves you over. "Got something special. Costs you, though. Not money."',
    choices: (run) => [
      { text: 'Take the deal', hint: 'An ability, and a Guilty Conscience', ok: true, go: (run, c, st) => {
        const id = randomAbility(st, R.chance(st, 0.4) ? 'uncommon' : 'common', run.abilities);
        if (id) abilityRun(run, id);
        addCard(run, 'guilty');
        return { text: 'They fit perfectly. You try not to think about where they came from.', effects: [...(id ? [{ kind: 'ability', id }] : []), { kind: 'card', ref: 'guilty' }] };
      } },
      { text: 'No thanks', hint: '', ok: true, go: () => ({ text: 'He shrugs and zips the bag.', effects: [] }) },
    ] },
  { id: 'pickup_run', title: 'Pickup Run', text: () => 'A full-court run is short a man. "Winner takes the pot. You in?"',
    choices: (run) => [
      { text: 'Run with them', hint: 'A fight: a Rival\'s reward', ok: true, go: (run, c, st) => ({ text: 'You check in.', effects: [{ kind: 'fight' }], fight: { kind: 'rival', foes: [who(run, st, 'fresh')] } }) },
      { text: 'Watch from the bench', hint: 'Heal 5', ok: true, go: (run) => { const h = healRun(run, 5); return { text: 'You catch your breath and study their tendencies.', effects: [{ kind: 'hp', n: h }] }; } },
    ] },
  { id: 'free_throws', title: 'Midnight Free Throws', text: () => 'An empty court, one working light. Free throws until you can\'t feel your arms.',
    choices: (run) => [
      { text: 'Shoot until it\'s automatic', hint: 'Take 5, upgrade 2 random cards', ok: upgradableIdx(run).length > 0, go: (run, c, st) => {
        hurtRun(run, 5);
        const n = upgradeRandom(run, st, 2);
        return { text: `Hundreds of them. ${n.join(' and ')} feel different now.`, effects: [{ kind: 'hp', n: -5 }, { kind: 'upgrade', cards: n }] };
      } },
      { text: 'Go to bed', hint: 'Heal 4', ok: true, go: (run) => { const h = healRun(run, 4); return { text: 'Sleep is training too.', effects: [{ kind: 'hp', n: h }] }; } },
    ] },
  { id: 'lost_wallet', title: 'A Wallet Under the Bench', text: () => 'There\'s a wallet under the bleachers, fat with cash.',
    choices: () => [
      { text: 'Keep it', hint: '+60 coins, a Guilty Conscience', ok: true, go: (run) => { coinsRun(run, 60); addCard(run, 'guilty'); return { text: 'Sixty coins. It weighs more than it should.', effects: [{ kind: 'coins', n: 60 }, { kind: 'card', ref: 'guilty' }] }; } },
      { text: 'Turn it in at the desk', hint: 'Heal 10', ok: true, go: (run) => { const h = healRun(run, 10); return { text: 'The desk guy lets you use the cold tub. Good karma.', effects: [{ kind: 'hp', n: h }] }; } },
    ] },
  { id: 'open_gym', title: 'Open Gym', text: () => 'The rec center is open late, and the trainer owes the manager a favor.',
    choices: (run) => [
      { text: 'Drill out a bad habit', hint: `Take 6, remove ${nameOf(run.deck[worstCardIndex(run)])}`, ok: run.deck.length > 5, go: (run) => {
        hurtRun(run, 6);
        const r = removeCardAt(run, worstCardIndex(run));
        return { text: `It hurts. ${nameOf(r)} is gone from your game.`, effects: [{ kind: 'hp', n: -6 }, { kind: 'remove', ref: r }] };
      } },
      { text: 'Get reps in', hint: 'Upgrade a random card', ok: upgradableIdx(run).length > 0, go: (run, c, st) => { const n = upgradeRandom(run, st, 1); return { text: `Reps on reps. ${n[0]} is sharper.`, effects: [{ kind: 'upgrade', cards: n }] }; } },
      { text: 'Leave', hint: '', ok: true, go: () => ({ text: 'Another night.', effects: [] }) },
    ] },
  { id: 'rain_delay', title: 'Rain Delay', text: () => 'The sky opens up. Everybody runs for the overhang.',
    choices: (run) => [
      { text: 'Rest', hint: `Heal ${pct(run, 0.2)}`, ok: true, go: (run) => { const h = healRun(run, pct(run, 0.2)); return { text: 'You sit and listen to the rain on the backboard.', effects: [{ kind: 'hp', n: h }] }; } },
      { text: 'Talk shop', hint: 'Gain a random uncommon card', ok: true, go: (run, c, st) => { const r = R.pick(st, POOL('uncommon')); addCard(run, r); return { text: `An old head shows you ${nameOf(r)}.`, effects: [{ kind: 'card', ref: r }] }; } },
    ] },
  { id: 'mystery_box', title: 'The Mystery Box', text: () => 'A kid sells taped-up boxes off a folding table. "Could be anything. Forty coins."',
    choices: (run) => [
      { text: 'Buy one', hint: '40 coins: a random ability', ok: run.coins >= 40, go: (run, c, st) => {
        coinsRun(run, -40);
        const x = R.next(st);
        const id = randomAbility(st, x < 0.5 ? 'common' : x < 0.85 ? 'uncommon' : 'rare', run.abilities);
        if (id) abilityRun(run, id);
        return { text: id ? 'Inside, wrapped in a towel: something useful.' : 'It\'s empty. Of course it is.', effects: [{ kind: 'coins', n: -40 }, ...(id ? [{ kind: 'ability', id }] : [])] };
      } },
      { text: 'Walk on', hint: '', ok: true, go: () => ({ text: 'The kid is already yelling at the next guy.', effects: [] }) },
    ] },
  { id: 'food_truck', title: 'The Food Truck', text: () => 'A truck by the courts sells the best thing you\'ll eat this week.',
    choices: (run) => [
      { text: 'Grab a plate', hint: '15 coins: heal 12', ok: run.coins >= 15, go: (run) => { coinsRun(run, -15); const h = healRun(run, 12); return { text: 'Worth every coin.', effects: [{ kind: 'coins', n: -15 }, { kind: 'hp', n: h }] }; } },
      { text: 'The full meal plan', hint: '35 coins: +5 max Health', ok: run.coins >= 35, go: (run) => { coinsRun(run, -35); maxHpRun(run, 5); return { text: 'You eat like a pro for once.', effects: [{ kind: 'coins', n: -35 }, { kind: 'maxHp', n: 5 }] }; } },
      { text: 'Skip it', hint: '', ok: true, go: () => ({ text: 'Your stomach complains all the way to the next court.', effects: [] }) },
    ] },
  { id: 'trick_shot', title: 'Trick Shot', text: () => 'Somebody bets you can\'t make one from behind the backboard, off the light pole.',
    choices: () => [
      { text: 'Try it', hint: '50%: a rare card. 50%: take 10', ok: true, go: (run, c, st) => {
        if (R.chance(st, 0.5)) { const r = R.pick(st, POOL('rare')); addCard(run, r); return { text: `Off the pole, off the glass, in. You come away with ${nameOf(r)}.`, effects: [{ kind: 'card', ref: r }] }; } hurtRun(run, 10);
        return { text: 'You go up, slip, and land on your hip.', effects: [{ kind: 'hp', n: -10 }] };
      } },
      { text: 'Not a chance', hint: '', ok: true, go: () => ({ text: 'Smart.', effects: [] }) },
    ] },
  { id: 'midnight_run', title: 'Midnight Run', text: () => 'A run that starts at midnight and goes until sunrise. Shooters only.',
    choices: (run) => [
      { text: 'Shoot all night', hint: '-1 Health, +1 Shooting (for the run)', ok: run.player.stats.health > 1 && run.player.stats.shooting < 10, go: (run) => {
        statRun(run, 'health', -1);
        statRun(run, 'shooting', 1);
        return { text: 'Your legs are gone. Your stroke is perfect.', effects: [{ kind: 'stat', stat: 'health', n: -1 }, { kind: 'stat', stat: 'shooting', n: 1 }] };
      } },
      { text: 'Go home', hint: '', ok: true, go: () => ({ text: 'You need your sleep.', effects: [] }) },
    ] },
  { id: 'weight_room', title: 'The Weight Room', text: () => 'A basement weight room with one working fan and no rules.',
    choices: (run) => [
      { text: 'Max out', hint: 'Take 10, +1 Defense (for the run)', ok: run.player.stats.defense < 10, go: (run) => {
        hurtRun(run, 10);
        statRun(run, 'defense', 1);
        return { text: 'You can barely lift your arms tomorrow. Nobody\'s getting past you.', effects: [{ kind: 'hp', n: -10 }, { kind: 'stat', stat: 'defense', n: 1 }] };
      } },
      { text: 'Light session', hint: 'Heal 5', ok: true, go: (run) => { const h = healRun(run, 5); return { text: 'Stretch, foam roll, leave.', effects: [{ kind: 'hp', n: h }] }; } },
    ] },
  { id: 'mural_wall', title: 'The Mural', text: () => 'A painted wall of the park\'s greatest moments. You stare at one play for a long time.',
    choices: (run) => [
      { text: 'Study it', hint: `Copy ${nameOf(run.deck[bestCardIndex(run)])}`, ok: bestCardIndex(run) >= 0, go: (run) => { const r = run.deck[bestCardIndex(run)]; addCard(run, r); return { text: `You see it in your sleep: another ${nameOf(r)}.`, effects: [{ kind: 'card', ref: r }] }; } },
      { text: 'Move on', hint: '', ok: true, go: () => ({ text: 'History can wait.', effects: [] }) },
    ] },
  { id: 'solo_session', title: 'Solo Session', text: () => 'Just you, a ball and a cone. No fancy stuff.',
    choices: (run) => [
      { text: 'Strip it down', hint: 'Lose a random Move or Play card, upgrade 3 random cards', ok: run.deck.some(r => ['move', 'play'].includes(cardDef(r)?.type)), go: (run, c, st) => {
        const ids = run.deck.map((r, i) => [r, i]).filter(([r]) => ['move', 'play'].includes(cardDef(r)?.type)).map(([, i]) => i);
        const r = removeCardAt(run, R.pick(st, ids));
        const n = upgradeRandom(run, st, 3);
        return { text: `No more ${nameOf(r)}. Everything else gets cleaner.`, effects: [{ kind: 'remove', ref: r }, { kind: 'upgrade', cards: n }] };
      } },
      { text: 'Just get shots up', hint: 'Heal 6', ok: true, go: (run) => { const h = healRun(run, 6); return { text: 'Easy work.', effects: [{ kind: 'hp', n: h }] }; } },
    ] },
  { id: 'corner_store', title: 'The Corner Store', text: () => 'Cold drinks, athletic tape and the owner\'s opinions on your jumper.',
    choices: (run) => [
      { text: 'Energy drink', hint: '20 coins: Second Wind+', ok: run.coins >= 20, go: (run) => { coinsRun(run, -20); addCard(run, 'second_wind+'); return { text: 'Tastes like a battery. Works.', effects: [{ kind: 'coins', n: -20 }, { kind: 'card', ref: 'second_wind+' }] }; } },
      { text: 'A roll of tape', hint: '20 coins: Tape Job+', ok: run.coins >= 20, go: (run) => { coinsRun(run, -20); addCard(run, 'tape_job+'); return { text: 'You\'ll need it.', effects: [{ kind: 'coins', n: -20 }, { kind: 'card', ref: 'tape_job+' }] }; } },
      { text: 'Just browse', hint: '', ok: true, go: () => ({ text: 'The owner says your elbow flies out. He\'s not wrong.', effects: [] }) },
    ] },
  { id: 'scout_bleachers', title: 'A Scout in the Bleachers', text: () => 'A woman with a clipboard sits alone at the top of the bleachers, writing.',
    choices: () => [
      { text: 'Show off', hint: 'Start your next match Hot 2', ok: true, go: (run) => { run.flags.nextHot = 2; return { text: 'You catch her looking up. Good.', effects: [{ kind: 'flag', id: 'nextHot' }] }; } },
      { text: 'Ask her about the boss', hint: 'This phase\'s boss starts Exposed 2', ok: true, go: (run) => { run.flags.bossExposed = run.phase; return { text: 'She flips back a few pages. "He hates going left."', effects: [{ kind: 'flag', id: 'bossExposed' }] }; } },
    ] },

  // ---------- the nemesis system ----------
  { id: 'hurt_player', title: 'Down on the Sideline', nemesis: true, cast: 'any', text: (run, c) => `${nm(run, c.chars[0])} is sitting against the fence, holding his ankle. Nobody's stopping.`,
    choices: (run) => [
      { text: 'Help him out', hint: '15 coins or 4 Health: he owes you', ok: true, go: (run, c) => {
        const id = c.chars[0];
        const f = fxs();
        if (run.coins >= 15) { coinsRun(run, -15); f('coins', { n: -15 }); } else { hurtRun(run, 4); f('hp', { n: -4 }); } outcome(run, id, 'helped');
        f('nemesis', { charId: id, what: 'helped' });
        return { text: `You tape him up and get him a ride. "${charLine(W(run), id, 'help', run.seed)}"`, effects: f.list };
      } },
      { text: 'Walk past', hint: 'He\'ll remember', ok: true, go: (run, c) => { const id = c.chars[0]; outcome(run, id, 'wronged'); return { text: 'You keep your head down. You can feel him watching you go.', effects: [{ kind: 'nemesis', charId: id, what: 'wronged' }] }; } },
    ] },
  { id: 'courtside_challenge', title: 'Called Out', nemesis: true, cast: 'grudge', text: (run, c) => `${nm(run, c.chars[0])} is courtside, loud. "${charLine(W(run), c.chars[0], 'intro', run.seed)}"`,
    choices: () => [
      { text: 'Accept the challenge', hint: 'A fight: a Rival\'s reward, and you settle it', ok: true, go: (run, c) => ({ text: 'The crowd clears a lane.', effects: [{ kind: 'fight' }], fight: { kind: 'rival', foes: [c.chars[0]] } }) },
      { text: 'Ignore him', hint: 'His grudge grows', ok: true, go: (run, c) => { outcome(run, c.chars[0], 'wronged'); return { text: 'You walk off. He tells everyone you were scared.', effects: [{ kind: 'nemesis', charId: c.chars[0], what: 'wronged' }] }; } },
    ] },
  { id: 'ally_returns', title: 'An Old Friend', nemesis: true, cast: 'owed', text: (run, c) => `${nm(run, c.chars[0])} finds you between games. "${charLine(W(run), c.chars[0], 'ally', run.seed)}"`,
    choices: () => [
      { text: 'Take what he brought', hint: 'A random uncommon ability', ok: true, go: (run, c, st) => {
        const id = randomAbility(st, 'uncommon', run.abilities) || randomAbility(st, 'common', run.abilities);
        if (id) abilityRun(run, id);
        outcome(run, c.chars[0], 'lent');
        return { text: 'He presses it into your hands and walks off.', effects: [...(id ? [{ kind: 'ability', id }] : []), { kind: 'nemesis', charId: c.chars[0], what: 'lent' }] };
      } },
      { text: 'Take the cash', hint: '+60 coins', ok: true, go: (run, c) => { coinsRun(run, 60); outcome(run, c.chars[0], 'lent'); return { text: '"Don\'t spend it all in one place."', effects: [{ kind: 'coins', n: 60 }, { kind: 'nemesis', charId: c.chars[0], what: 'lent' }] }; } },
      { text: 'Just catch up', hint: 'Heal 15', ok: true, go: (run, c) => { const h = healRun(run, 15); outcome(run, c.chars[0], 'lent'); return { text: 'An hour of stories. You feel better.', effects: [{ kind: 'hp', n: h }, { kind: 'nemesis', charId: c.chars[0], what: 'lent' }] }; } },
    ] },
  { id: 'tip_off', title: 'The Tip-Off', nemesis: true, cast: 'any', text: (run, c) => `${nm(run, c.chars[0])} sidles up. "I know how this phase's boss plays. Information isn't free."`,
    choices: (run, c) => [
      { text: 'Pay him', hint: '30 coins: the boss starts Exposed 2. He owes you', ok: run.coins >= 30, go: (run, c) => {
        coinsRun(run, -30);
        run.flags.bossExposed = run.phase;
        outcome(run, c.chars[0], 'helped');
        return { text: 'He talks for ten minutes straight. It\'s good stuff.', effects: [{ kind: 'coins', n: -30 }, { kind: 'flag', id: 'bossExposed' }, { kind: 'nemesis', charId: c.chars[0], what: 'helped' }] };
      } },
      { text: 'Tell him to get lost', hint: 'He\'ll remember', ok: true, go: (run, c) => { outcome(run, c.chars[0], 'wronged'); return { text: '"Your funeral," he says.', effects: [{ kind: 'nemesis', charId: c.chars[0], what: 'wronged' }] }; } },
    ] },
  { id: 'borrowed_kicks', title: 'Borrowed Kicks', nemesis: true, cast: 'fresh', text: (run, c) => `${nm(run, c.chars[0])} blew out a shoe mid-game. He's looking at your bag.`,
    choices: () => [
      { text: 'Lend him your spare pair', hint: '25 coins: he owes you', ok: true, go: (run, c) => {
        coinsRun(run, -25);
        outcome(run, c.chars[0], 'helped');
        return { text: 'He laces them up. "I got you next time."', effects: [{ kind: 'coins', n: -25 }, { kind: 'nemesis', charId: c.chars[0], what: 'helped' }] };
      } },
      { text: 'Sell him the pair', hint: '+30 coins, he won\'t like it', ok: true, go: (run, c) => {
        coinsRun(run, 30);
        outcome(run, c.chars[0], 'wronged');
        return { text: 'He pays, slowly, staring at you the whole time.', effects: [{ kind: 'coins', n: 30 }, { kind: 'nemesis', charId: c.chars[0], what: 'wronged' }] };
      } },
    ] },
  { id: 'crew_beef', title: 'Pick a Side', nemesis: true, cast: 'pair', text: (run, c) => `${nm(run, c.chars[0])} and ${nm(run, c.chars[1])} are nose to nose by the water fountain. Both look at you.`,
    choices: (run, c) => [
      { text: `Back ${nm(run, c.chars[0])}`, hint: 'A card from him. The other one won\'t forget', ok: true, go: (run, c, st) => {
        const r = R.pick(st, POOL('uncommon'));
        addCard(run, r);
        outcome(run, c.chars[0], 'helped');
        outcome(run, c.chars[1], 'wronged');
        return { text: `${nm(run, c.chars[0])} shows you ${nameOf(r)} as thanks.`, effects: [{ kind: 'card', ref: r }, { kind: 'nemesis', charId: c.chars[0], what: 'helped' }, { kind: 'nemesis', charId: c.chars[1], what: 'wronged' }] };
      } },
      { text: `Back ${nm(run, c.chars[1])}`, hint: 'A card from him. The other one won\'t forget', ok: true, go: (run, c, st) => {
        const r = R.pick(st, POOL('uncommon'));
        addCard(run, r);
        outcome(run, c.chars[1], 'helped');
        outcome(run, c.chars[0], 'wronged');
        return { text: `${nm(run, c.chars[1])} shows you ${nameOf(r)} as thanks.`, effects: [{ kind: 'card', ref: r }, { kind: 'nemesis', charId: c.chars[1], what: 'helped' }, { kind: 'nemesis', charId: c.chars[0], what: 'wronged' }] };
      } },
      { text: 'Stay out of it', hint: '', ok: true, go: () => ({ text: 'Not your fight.', effects: [] }) },
    ] },
  { id: 'mentor_session', title: 'The Veteran', nemesis: true, cast: 'ranked', text: (run, c) => `${nm(run, c.chars[0])} has seen everything this park has to offer. "I'll show you a couple things. If you're serious."`,
    choices: (run) => [
      { text: 'Pay for the session', hint: '40 coins: upgrade 2 random cards. He owes you nothing, you owe him', ok: run.coins >= 40 && upgradableIdx(run).length > 0, go: (run, c, st) => {
        coinsRun(run, -40);
        const n = upgradeRandom(run, st, 2);
        outcome(run, c.chars[0], 'helped');
        return { text: `Two hours. ${n.join(' and ')} will never be the same.`, effects: [{ kind: 'coins', n: -40 }, { kind: 'upgrade', cards: n }, { kind: 'nemesis', charId: c.chars[0], what: 'helped' }] };
      } },
      { text: 'Decline', hint: '', ok: true, go: () => ({ text: '"Suit yourself."', effects: [] }) },
    ] },
  { id: 'grudge_ambush', title: 'Ambush', nemesis: true, cast: 'grudgeFriend', text: (run, c) => `${nm(run, c.chars[0])} brought ${nm(run, c.chars[1])}. "${charLine(W(run), c.chars[0], 'intro', run.seed)}"`,
    choices: (run) => [
      { text: 'Take them both on', hint: 'A two-on-one fight', ok: true, go: (run, c) => ({ text: 'Two of them, one of you.', effects: [{ kind: 'fight' }], fight: { kind: 'match', foes: [c.chars[0], c.chars[1]], ambush: true } }) },
      { text: 'Buy your way out', hint: '50 coins: his grudge cools', ok: run.coins >= 50, go: (run, c) => {
        coinsRun(run, -50);
        outcome(run, c.chars[0], 'helped');
        return { text: 'Money talks. They let you by.', effects: [{ kind: 'coins', n: -50 }, { kind: 'nemesis', charId: c.chars[0], what: 'helped' }] };
      } },
    ] },
  { id: 'rumor_mill', title: 'The Rumor Mill', nemesis: true, cast: 'pair', text: (run, c) => `Everybody's whispering that ${nm(run, c.chars[0])} and ${nm(run, c.chars[1])} are about to fall out. One word from you would do it.`,
    choices: () => [
      { text: 'Stir it up', hint: '+30 coins from the bettors. Both will know', ok: true, go: (run, c) => {
        coinsRun(run, 30);
        outcome(run, c.chars[0], 'wronged');
        outcome(run, c.chars[1], 'wronged');
        return { text: 'By the next game they aren\'t speaking. You\'re thirty coins richer.', effects: [{ kind: 'coins', n: 30 }, { kind: 'nemesis', charId: c.chars[0], what: 'wronged' }, { kind: 'nemesis', charId: c.chars[1], what: 'wronged' }] };
      } },
      { text: 'Squash it', hint: 'Take 4: they both owe you', ok: true, go: (run, c) => {
        hurtRun(run, 4);
        outcome(run, c.chars[0], 'helped');
        outcome(run, c.chars[1], 'helped');
        return { text: 'You catch an elbow breaking it up. They shake hands.', effects: [{ kind: 'hp', n: -4 }, { kind: 'nemesis', charId: c.chars[0], what: 'helped' }, { kind: 'nemesis', charId: c.chars[1], what: 'helped' }] };
      } },
    ] },
];
// the effect kinds a choice can report (eventChoose's `effects`), a fixed list:
//   coins {n}          coins gained (+) or spent (-)
//   hp {n}             Health healed (+) or lost (-)
//   maxHp {n}          max Health gained
//   card {ref}         a card added to your deck
//   remove {ref}       a card removed from your deck
//   transform {from, to}  a card in your deck turned into another
//   upgrade {cards: [name]}  cards upgraded (by name)
//   ability {id}       an ability gained
//   stat {stat, n}     a stat changed for the run
//   flag {id}          a run flag set ('nextHot': your next match starts Hot 2; 'bossExposed': this phase's boss starts Exposed 2)
//   nemesis {charId, what}  a character helped, wronged or repaid ('helped' | 'wronged' | 'lent')
//   fight {}           the stop became a match (eventChoose also returns fight: true)
export const EFFECT_KINDS = ['coins', 'hp', 'maxHp', 'card', 'remove', 'transform', 'upgrade', 'ability', 'stat', 'flag', 'nemesis', 'fight'];
export const EVENT_BY_ID = Object.assign(Object.create(null), Object.fromEntries(EVENTS.map(e => [e.id, e])));
export const NEMESIS_EVENTS = EVENTS.filter(e => e.nemesis).map(e => e.id);

// cast an event: its characters, or null when the run has nobody who fits
function castEvent(run, e, st) {
  if (!e.nemesis) return { chars: [] };
  if (e.cast === 'pair') { const a = who(run, st, 'any'); if (!a) return null; used(run, a); const b = who(run, st, 'fresh') || who(run, st, 'any'); if (!b || b === a) return null; used(run, b); return { chars: [a, b] }; }
  if (e.cast === 'grudgeFriend') {
    const a = who(run, st, 'grudgeFriend'); if (!a) return null;
    const f = Object.entries(run.wc[a].rel || {}).filter(([o, k]) => (k === 'friend' || k === 'protege') && run.chars[o]).map(([o]) => o).sort()[0];
    used(run, a, f); return { chars: [a, f] };
  }
  const a = who(run, st, e.cast || 'any');
  if (!a) return null;
  used(run, a);
  return { chars: [a] };
}
// a Mystery Stop for a node: ~1/3 of them nemesis events (when the run has the cast for one), no repeats in a run
export function pickEvent(run, nodeId) {
  const st = R.stream(run.seed, 'event', nodeId);
  const seen = new Set(run.seenEvents || []);
  const nem = EVENTS.filter(e => e.nemesis && !seen.has(e.id)), gen = EVENTS.filter(e => !e.nemesis && !seen.has(e.id));
  for (let tries = 0; tries < 12; tries++) {
    const wantNem = R.chance(st, 0.36) && nem.length;
    const pool = wantNem ? nem : gen.length ? gen : nem;
    if (!pool.length) break;
    const e = R.pick(st, pool);
    const ctx = castEvent(run, e, st);
    if (!ctx) { nem.splice(nem.indexOf(e), 1); continue; }
    run.seenEvents = [...seen, e.id];
    return { id: e.id, ctx, rs: { s: st.s } };
  }
  return { id: 'rain_delay', ctx: { chars: [] }, rs: { s: st.s } };
}
export function eventView(run) {
  const ev = run.event;
  if (!ev) return { id: 'none', title: '', text: '', choices: [], chars: [] };
  const e = EVENT_BY_ID[ev.id];
  const ch = e.choices(run, ev.ctx);
  return { id: e.id, title: e.title, text: e.text(run, ev.ctx), nemesis: !!e.nemesis, choices: ch.map(c => ({ text: c.text, hint: c.hint, enabled: !!c.ok })), chars: ev.ctx.chars.slice() };
}
export function eventResolve(run, i) {
  const ev = run.event;
  if (!ev || ev.done) return null;
  const e = EVENT_BY_ID[ev.id];
  const ch = e.choices(run, ev.ctx)[i];
  if (!ch || !ch.ok) return { text: 'You can\'t do that.', effects: [], invalid: true };
  const st = ev.rs;
  const res = ch.go(run, ev.ctx, st);
  res.effects = (res.effects || []).filter(f => EFFECT_KINDS.includes(f.kind));
  ev.done = true; ev.choice = i;
  return res;
}
