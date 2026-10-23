# v0.4.8.9 "The Gauntlet": the working contract

**The Gauntlet** is a turn-based basketball deckbuilder roguelike in the mould of Slay the Spire, with a nemesis system. The game plays out on a court above the card table while you play your hand.

This contract is David's brief from Oct 22 plus his answers:
- **A sacrifice is real:** the build leaves the park.
- **Park cards** boost the sacrificed Icon's stats.
- **The 4 resources are the 4 player stats.**

Where the brief leaves a gap, the lead's decisions are marked **(lead)**. Ask the lead rather than guess.

## 1. A run
- **Starting a run:** choose one player.
  - **Starters:** three random players are offered every run. Each of their four stats is rolled at **1–5**.
  - **Converted players:** your sacrificed ICON builds (§9), always offered. They roll each stat each run in `[base−2, base+1]`, clamped to 1–10. Base is the build's own rating for that stat, mapped onto **6–10** (lead). Only converted players can reach stats above 5.
- **Structure:** three **phases** (acts), each a randomized **tournament bracket** map ending in a **boss**, then the **Final**. Beating the Final completes the run.
- **Health carries over:** your Health persists through the whole run. A run ends when Health reaches 0.
- **Length:** a run should take roughly 45–75 minutes for a completed run.

## 2. The four stats (the four resources)

| # | Stat | In a match | Base value from the stat (1–10) (lead) |
| --- | --- | --- | --- |
| 1 | **Stamina** | the energy you spend to play cards each turn | 3 energy at 1–4, 4 at 5–8, 5 at 9–10 |
| 2 | **Shooting** | how much your scoring cards score | +⌊stat/2⌋ points on every Shot card |
| 3 | **Defense** | the shield (Stops) your defensive cards give, absorbing points scored on you this turn | +⌊stat/2⌋ on every Defense card |
| 4 | **Health** | your life for the whole run; points scored on you take it away | max Health 30 + 6 × stat |

- **Cards change all four, in the match and permanently.** Examples:
  - "Second Wind" gives +1 energy now.
  - "Film Study" gives +1 Shooting for this match.
  - "Iron Lungs" (an ability) gives +1 Stamina for the run.
  - "Tape Job" heals 6.
- **Opponents:** each one has its own Health ("Heart"), Shooting and Defense, and shows its **intent** for the next turn (shoot for X, defend, buff, debuff, or a special).
- **Scoring:** points scored count as damage. The scoreboard over the court shows the game score: your points against theirs.

## 3. Cards, combinations and deck size
- **Starting deck:** 10 cards: 4 Jumper (Shot 6), 4 Closeout (Defense 5), 1 Crossover and 1 Outlet Pass.
- **Rarities:** about 90 cards across Common, Uncommon and Rare. Each card has an upgraded version (+).
- **Card types:**
  - **Shot:** scores.
  - **Defense:** gives Stops.
  - **Move:** dribble moves that set up combos.
  - **Play:** passing and set plays, for card draw and energy.
  - **Mentality:** lasts all match, like Powers.
  - **Fatigue:** junk cards added by opponents and events, like Status and Curse cards.
- **Combinations (the core skill):** cards carry tags (Handle, Drive, Post, Perimeter, Pass, Hustle).
  - **Combo X:** a bonus if the last card played this turn has tag X. For example, "Step-Back Three" scores +6 after a Handle card.
  - **Chains:** three different tags in one turn trigger the "Flow" bonus (+1 energy and draw 1) once per turn.
  - Abilities and Mentalities build on this.
- **Deck size matters:**
  - **Depth** cards get stronger with more cards in your deck (scaled by deck size).
  - **Tight** cards get stronger the thinner your deck is (bonus at ≤ 12 cards).
  - Fatigue cards clog the deck, card removal costs coins at the shop, and some events add or remove cards.
- **Keywords:** Burn (exhaust), Hold (retain), Hot (strength), Cold (weak), Gassed (frail), Exposed (vulnerable), Hustle (Stops that last a turn), Clutch (stronger at low Health).
- **Rewards:** after a won match, pick 1 of 3 cards (or skip). You also get coins, and sometimes an ability.

## 4. Randomized match rules
Every match draws 1–2 rules from a pool of about 20, shown before you pick that match on the bracket. Examples:
- **Make-It-Take-It:** draw 1 after you score.
- **Threes Count Double:** Perimeter shots +50%.
- **Shot Clock:** you must play a Shot card every 2 turns or take 3.
- **Physical Night:** Defense +2, Shots −1.
- **Win By 2:** the opponent heals once at 1 Health.
- **No Timeouts:** no healing in this match.
- **Run & Gun:** +1 energy, and both sides' shots +2.
- **Old School:** no Mentalities.
- **Home Crowd:** you start Hot 1.
- **Hostile Crowd:** you start Cold 1.

## 5. The bracket map (exploration)
- **Layout:** each phase is a branching bracket of about 13 rounds from bottom to top, with 2–4 choices of node per round. You see each node's opponent or type and, for matches, its rules before you choose.
- **Node types:**
  - **Match:** a normal opponent.
  - **Rival:** an elite. Harder, and pays an ability.
  - **Cooler:** heal 30% of max Health *or* upgrade a card. Some abilities add options, such as removing a card or "Ice Bath" (+1 permanent Stamina, once per run).
  - **Boost Shop:** buy cards and abilities, or remove a card, with coins.
  - **Mystery Stop:** a random event (§7).
  - **Boss:** the last node of the phase.
- **Rough mix per phase:** about 45% matches, 10% Rivals, 15% Coolers, 10% Shops and 20% Mystery Stops. There is always a Cooler right before the boss.

## 6. Abilities (artifacts)
- **The pool:** about 40 abilities across Common, Uncommon, Rare, Boss and Shop.
- **Examples:**
  - "Lucky Headband": the first Shot each match scores double.
  - "Ankle Weights": +1 energy, but draw 1 fewer on turn 1.
  - "Scouting Report": see enemy intents two turns ahead.
  - "Sixth Man": the first time you'd drop to 0 Health in a run, go to 25% instead.
  - "Sneaker Deal": shops are 20% cheaper.
- **Boss abilities** are strong with a drawback, as in the genre.

## 7. Mystery Stops (events)
- **The pool:** about 25 events with choices, in the genre's style. For example:
  - a street hustler's bet (coins against Health);
  - a hurt player on the sideline (help him, which is good for the nemesis system, or walk past);
  - an old coach (transform a card);
  - a sneaker plug (an ability for a Fatigue card);
  - a pickup run (a fight for a reward).
- **The nemesis system:** about a third of events involve **nemesis-system characters** (§8). Choices there count as *helping* or *wronging* them.

## 8. The nemesis system (a living AI world)
- **Who the characters are:** every opponent you face is a named AI player from the server's shared AI world (`sim/world.js`), with their real names and looks.
- **Per-account memory:** each account has its own **Gauntlet World** on the server, recording every character you've met.
- **Per character, the world remembers:**
  - **Record against you**, **memories** (the last 5 notable events: "you broke my ankles in Phase 2", "you helped me at the sideline"), **traits** and **rank**.
  - **Rank:** Streetballer → Contender → Rival → Nemesis → Legend. Rank raises their stats and the abilities they bring.
  - **Relationships with other characters:** rival, friend, mentor or protégé, and whom they owe.
- **How characters change:**
  - **Grow:** a character who beats you, or survives you, gains rank and a trait ("Learned your crossover: Handle cards cost +1 against him").
  - **Regress:** one who keeps losing, or sits out runs, can drop rank or lose a trait.
  - **Remember:** they bring up shared history before a match, in short generated lines, never real people's words.
  - **Betray and ally:** a character you helped may later show up as an **ally**, a Mystery Stop gift, or a card he lends you for a match. Or, if a rival of his got to him, he may **betray** you and switch sides at a bad moment. A character you wronged holds a **grudge**, recruits his friends and may come back stronger.
- **Bosses:** each phase's boss pool includes your highest-ranked Nemesis when there is one, so your history shapes your runs.
- **Between runs:** the world ticks forward. Characters can train, feud and team up, and the menu shows a short "word on the street" feed.
- **Deterministic per run seed,** with the world state stored and updated server-side after each run.

## 9. Bosses
- **Difficulty:** comparable to the genre's: each needs a plan and a deck that works together.
- **Pools:** 3 per phase plus 3 Finals, each with its own mechanics. For example:
  - "The Wall": huge Defense, punishes single big shots, beaten by many small ones.
  - "Showtime": combos of his own every third turn.
  - "The Professor": copies your last card.
  - "Twin Towers": two opponents who share Health.
  - "Ref's Favorite": adds Fatigue cards.
  - Final: "The Undisputed", a multi-phase fight.
- Your highest-ranked Nemesis can replace a phase boss (§8).

## 10. On-screen: the cinematic court
- **Layout:** the top part of the screen is the 3D court, where the game plays out cinematically. The bottom is the card table: hand, energy, the four stats, the enemy intents and the scoreboard.
- **Cards drive the court:** every card has an **animation tag** that plays the matching play with your player and the opponents. Shots are jumpers, threes, layups and dunks, makes or blocked. Defense cards are a closeout, a contest or a block. Moves are crossovers and spins. Enemy intents play their own moves, so the court always matches the cards.
- **Rendering:** reuse the athletes, animator and courts, playing scripted actions rather than the full sim. The court for each match is a park, or for bosses one of the 12 Pro-Am parks.

## 11. Rewards
- **VC (lead):** VC scales with the time and success of a run, fair against the park's VC per hour.
  - **A won match:** about 140 VC; a Rival about 300; a phase boss about 900; the Final about 2,000.
  - **A completed run:** about 6,000–8,000 VC in all.
  - **A failed run:** keeps what it earned, with no completion bonus.
  - The server checks against the run's real time and progress, and caps each run.
- **Achievements:** tracked server-side for the sacrifice gates: runs completed, and distinct players completed with.

## 12. Sacrifices and Park cards
- **Who can be sacrificed:** only **ICON 99 OVR** park builds, and only the account's **first three** sacrifices ever.
- **The gates:**

  | Sacrifice | Needs | Brings |
  | --- | --- | --- |
  | 1st | 1 completed Gauntlet run | a **Common** park card |
  | 2nd | 3 completed runs with 3 different players | a **Rare** park card |
  | 3rd | 5 completed runs | a **Legendary** park card |

- **What a sacrifice does:**
  - The build **leaves the park for good**. Its build slot is freed.
  - It becomes a permanent Gauntlet player with its name and look; its stats come from its ratings (§1).
  - The confirmation is a clear warning plus a 5-second hold, like deleting a build.
- **Park card values:** Common **+1%**, Rare **+3%**, Legendary **+5%**, to one attribute chosen at random from the sacrificed build's **Icon badge stat list** (`sim/badges.js` ICON_BADGES stats). The General's "all" counts as any attribute. Examples:
  - Sharp Eye builds: Three Point or Mid-Range.
  - Big Brother builds: a rebound, Block or Interior D.
- **Where they work:**
  - On the **account**: every build, in **park games only**, event parks included. Never in Pro-Am or the Pro Run (lead: not in crew runs either).
  - Shown in MyPLAYER as an "Account Park Cards" row. They're applied in the sim the same way on every screen, through the entry the game already sends.

## 13. Other changes in v0.4.8.9
- **ICON aura levels 3 and 4:** made more subtle.
- **Event park streak VC:** the streak VC multiplier at every event park is cut by 75%: `mult = 1 + (mult − 1) × 0.25`.
- **The Favelas hillside bandana:** its hanging ends no longer clip through the head. They collide with the head, neck and shoulders.

## Ownership
**Deck agent** (new):
- Owns `client/js/deck/*`: the pure engine, with no DOM and no renderer. That covers cards, combat, the opponent AI and intents, match rules, the map generator, abilities, events, bosses, the nemesis world model (`deck/nemesis.js`, pure and seed-driven, with the server storing its state) and the per-run seeded RNG.
- Also a balance harness (`tools/deck_sim.mjs`, which plays thousands of runs with a scripted policy), and a short line of reasoning for every balance number.

**Hub agent:**
- Owns the Gauntlet's UI and the cinematic court: `client/js/ui/gauntlet*.js`, `client/js/game/deckcine.js` and its css. That covers run setup, the bracket map, the match screen with the court above, rewards, the Cooler, the Shop, Mystery Stops, the run summary, and the "word on the street" feed.
- It uses the Deck agent's engine API; agree the API through the lead.

**Server/UI agent:**
- Owns the server side: `server/gauntlet.py`, migration 017, and routes for run start and finish with VC checks and caps, achievements, the stored nemesis world (validated), sacrifices and park cards.
- It also owns the park-card effect in park games (entry → sim, park only), the MyPLAYER park-card row and the sacrifice flow UI, the event streak VC cut, and the version bump to 0.4.8.9.

**World agent:**
- Owns the subtle aura at levels 3 and 4 (`game/iconfx.js`) and the bandana collision (`char/sway.js`, `char/athlete.js`).

**Lead:** integration, patch notes, README, STATUS and commits.

**Rules:**
- data/ is untouched.
- Kill processes by PID only.
- `rm` only with literal paths.
- Don't edit a test to make it pass unless its rule changed.
- Nothing players see may name real brands or real people, or use 2K terms.

## 14. The engine API (Deck agent → Hub agent)

`client/js/deck/index.js` exports the functions below. Everything is pure and seeded.

Run state is plain serializable JSON, so the UI can save and resume a run from localStorage and send a summary to the server. The Deck agent publishes this surface first, with stubs, so the Hub agent can build against it. Changes go through the lead.

```js
newRun({ seed, player, world, unlocks }) -> run
// player: {id, name, look, stats:{stamina,shooting,defense,health}, converted}
// world: the stored nemesis world
rollStarters(seed, n = 3) -> [player]
rollConverted(seed, convertedPlayer) -> player              // 1–5 for starters; [base−2, base+1] for converted players
availableNodes(run) -> [nodeId]
enterNode(run, nodeId) -> { kind: 'match' | 'rival' | 'boss' | 'cooler' | 'shop' | 'event' }
// run.match: { turn, energy, maxEnergy, hand, drawPile, discard, burned, you:{hp, maxHp, stops, status},
//              opps:[{ id, charId, name, look, heart, maxHeart, stops, status, set:[move], intent:{kind, value, text} }],
//              rules:[{ id, name, text }], score:[you, them],
//              (qp4, §15) phase, ball, turnType, turnLabel, foeSet, preview, intro }
playCard(run, handIndex, target = 0) -> events      // the card's own effects now; a Shot is lined up for End Turn
endTurn(run) -> events                              // the whole possession, in order (§15.9)
// events: [{ t, actor: 'you' | oppIndex, anim, made, points, stops, text }]
// anim is one of: jumper, three, layup, dunk, floater, post, crossover, spin, stepback, pass, lob,
//   closeout, contest, block, steal, rebound, celebrate, gassed, foul
matchOver(run) -> null | { won, reward: { cards: [cardRef x3], coins, ability? } }
takeReward(run, { card: index | null, ability: bool })
cooler(run, 'heal' | 'upgrade' | 'remove' | ..., cardIndex?)
shopView(run) -> { cards:[{ref, price}], abilities:[{id, price}], removePrice }
shopBuy(run, kind, index)
shopRemove(run, cardIndex)
eventView(run) -> { id, title, text, choices:[{ text, hint }], chars:[charId] }
eventChoose(run, i) -> { text, effects }
runOver(run) -> null | { completed, phaseReached, nodesCleared, matchesWon, rivals, bosses, durationTurns, summary }
cardInfo(ref) -> { id, name, cost, type, rarity, tags, text, anim, upgraded }
abilityInfo(id) -> { id, name, rarity, text }
worldAfterRun(world, runSummary, seed) -> { world, feed: [line] }   // grow, regress, remember, betray, ally
worldTick(world, seed) -> { world, feed }                           // between runs
charLine(world, charId, situation, seed) -> string                  // generated, never real people's words
```

v0.4.8.9 qp4 additions (possessions, §15). Every name below is the contract's (QP4 §4); nothing was renamed.

```js
ENGINE_VERSION                 // 2. newRun records it as run.engine; a replay start must carry engine: 2 (§15.10)
canPlay(run | match, handIndex) -> { ok, why, cost }    // phase-aware: "Shots can't be played on defense"
run.match.phase                // 'jump' (inside startMatch only) | 'offense' | 'defense': which side of the ball you're on
run.match.ball                 // 'you' | 'them'
run.match.turnType             // 'offense' | 'defense' | 'fast_break' | 'second_chance' (whoever has the ball: see .ball)
run.match.turnLabel            // the banner: "Your ball", "Fast break: you stole it", "Make-it, take-it: your ball again", ...
run.match.foeSet               // { side: 'offense' | 'defense' (the side their cards play), hidden: bool,
                               //   cards: [{ name, kind: 'shot'|'stops'|'buff'|'debuff'|'special', value, anim, tags, text, actor }
                               //          | { hidden: true, actor }], total: number | null, why?: string }
run.match.preview              // { o, d, result: 'score' | 'stopped' | '?', points }: live, as you play cards (null = hidden)
run.match.intro                // the tip-off and the match's opening events: play them before the first turn
run.match.opps[i].set          // his committed cards this possession (the engine's; hidden ones too: the UI shows foeSet)
run.match.opps[i].intent       // kept: his first card this possession ({ kind: 'unknown', value: null, text: '?' } when hidden)
handView(run)[i].offPhase      // true: this card waits for the other side of the ball (the dead-hand rule, §15.7)
handView(run)[i].points        // a Shot's points now (before the defense); Stops for a Defense card as before
```
New event types: `jump` (the tip: actor = who won it, anim rebound), `possession` { to, turnType, text }, `clash`
{ o, d, winner: 'offense' | 'defense' }, `rebound` { offensive }, `foul`, `ft` { points }, `wall` (The Wall's cap). A `shot`
event now carries `how` ('made' | 'assist' | 'and_one' | 'block' | 'steal' | 'contest' | 'charge') and, when assisted,
`assist` (the passer: 'you' or an opponent index). `free_throws` is never a turn of its own: free throws are `foul` + `ft`
events inside the possession that drew them (there is no choice to make, so there is no turn to show). playCard's
events carry anim: null (table text only); endTurn's are the possession on the court.

## 15. Possessions (v0.4.8.9 qp4): how a match plays

David's brief: turn based, like a real game; every match opens with a jump ball; the side with the ball plays its
offense with its energy while the other side commits its defense; End Turn plays both out together; what you see
(score, steal, block, assist) comes from the two sides' cards; you can read the opponent's cards unless something
stops you; the higher number always wins (defense wins ties). Heart and Health stay: your baskets take his Heart,
his take your run Health. Everything else (stats, cards and their numbers, combos, Flow, Depth / Tight, the bracket,
rewards, abilities, bosses, the nemesis world, VC) is as it was, read per possession instead of per turn.

### 15.1 A match is possessions
1. **Tip-off.** A seeded coin from the match's own stream (run seed, node, match count), 50/50: whoever wins it has
   the ball first (`jump` event, then `possession`). The same start replays to the same tip.
2. **A turn is one possession.** At its start: your energy refills (Stamina, abilities, Charge), you draw to 5 as
   ever, and every opponent still standing **commits** his set for it: his offense card when he has the ball, his
   defense card when you do. You see his set (`foeSet`) and the live clash (`preview`) before you play.
3. You play cards with your energy. Card effects (Stops, draws, energy, statuses, Flow) happen as you play; Shots are
   lined up. **End Turn** plays the possession: the defense's cards, the offense's setup, each shot in order, the
   clash, then who has the ball next.
4. A match ends the moment his Heart (or your Health) is gone, even mid-possession; `end` is its last event.

### 15.2 Turn types
| Turn (`turnType`) | When | You play | They play |
| --- | --- | --- | --- |
| tip-off (`phase` 'jump', only inside startMatch) | the start of every match | nothing: the coin | nothing |
| `offense` | you have the ball | Shots, Moves, Plays, Mentalities | one defensive card (+ maybe a rider) |
| `defense` | they have the ball | Defense cards, Plays, Mentalities | one offensive card each (+ maybe a rider) |
| `fast_break` (yours) | you stole it | as offense | only the first opponent gets back, one card, his Stops count half (`BREAK_STOPS` 0.5) |
| `fast_break` (theirs) | they stole it | one Defense card at most; your Stops count half | as offense |
| `second_chance` | the shots were stopped but the offense won the boards | as offense / defense, again | a new set |
| make-it-take-it (`offense` / `defense`, its own label) | Make-It-Take-It: the scorer keeps the ball | as offense / defense | as ever |
| free throws (inside the possession: `foul` + `ft`) | a fouled shot | nothing | nothing |

Plays and Mentalities are the two-way cards. Fatigue is as ever (unplayable, burns, bites from your hand).

### 15.3 Their set
* Every opponent has both sides: his moves split into **scoring** cards (points), **Stops** cards and **riders** (pure
  buffs / debuffs: Hot, Cold, Exposed, Gassed, Screened, Fatigue). Each possession he commits one card from the side he's
  on (a cycle in order for a boss, a weighted pick that never repeats a card three times for everyone else) and, 35% of
  the time (`RIDER_P`), a rider that fits that side. A style with no card for a side gets a plain one (`DEFAULT_OFF`
  "Takes what's there", `DEFAULT_DEF` "Stays in front", at the phase's scale). foes.js `splitMoves`.
* A scoring card that also gives Stops (a post-up, The Wall's "Swats and runs") scores now; its Stops wait for his next
  defense, as yours do.
* Bosses commit from their own hooks: `offense(m, o, X, k)` / `defense(...)` on his k-th possession on that side
  (Showtime, the Professor, the Shadow), else their cycle split the same way.
* His riders land after the possession (your new Cold, Exposed, Screened: the next possessions).

### 15.4 The clash: the higher number wins
* **O** (the offense's number) = the points of its Shots this possession, each worked out exactly as a Shot always
  was (Shooting's ⌊stat/2⌋, Hot / Cold / Exposed, combos, Tight / Depth / Clutch, Mentalities, abilities, rules). His
  O: his cards' points (his Shooting, Hot, the rules, Cold / Exposed, boss multipliers), times hits.
* **D** (the defense's number) = its Stops pool: Stops from this possession's Defense cards (Defense's ⌊stat/2⌋, ...),
  plus the Stops it gained with the ball last time (a Putback, a post-up), plus Hustle Stops kept from its last
  defense. Halved on a fast break (rounded down).
* **O > D: the offense scores O − D** (off his Heart, or your Health). **O ≤ D: stopped.** Nothing random touches it;
  the only randomness is which animation variant the court plays.
* Shots resolve **in play order** against what's left of the pool, so an early shot can be stopped and a later one go
  in; the total is always exactly max(0, O − D).
* One exception, The Wall: a basket that beats his Stops counts at most 10 (`hitCap`); the rest becomes his Stops for
  his next defense. The winner is still whoever has the higher number; the cap only trims how much a winning basket
  counts. `preview.points` shows the capped total.
* Free throws come on top and never flip a clash: the first fouled shot of a possession (Physical Night: every Drive or
  Post shot; a card that `foul`s: Ref's Favorite's drives) is an **and-one** if it went in (`FT_AND_ONE`, a quarter of
  its points, at least 1) or **two shots** if it didn't (`FT_MISSED`, a third, at least 1), uncontested. Tight Whistle:
  no fouls.

### 15.5 What it looks like: the outcome table (combat.js `stopHow`, pinned by tests/v0489deck_possession.test.mjs)
| Shot | Condition (checked in this order) | `how` | anim |
| --- | --- | --- | --- |
| made | it was fouled | `and_one` | the shot's, then `foul`, `ft` |
| made | a Pass card came before it this possession (yours), or his set has a Pass card (his) | `assist` | the shot's |
| made | otherwise | `made` | the shot's (jumper / three / layup / dunk / floater / post / lob / stepback) |
| stopped | you defended with Take the Charge and the shot went inside | `charge` | the shot's |
| stopped | the defense's biggest card is a block (anim block, or a Post Defense card) and the shot went inside (a Drive or Post shot, or a layup / dunk / floater / post / lob) | `block` | the shot's, the defender's block |
| stopped | the defense played a steal card (anim steal) and the offense leaned on Handle or Pass this possession | `steal` | |
| stopped | otherwise | `contest` | then the boards |

Who has the ball next (the **last** shot of the possession decides):
| What happened | Next |
| --- | --- |
| Shot Clock violation (your offense with no Shot) | take 3, their ball |
| no shot at all | turnover: the other side; a `fast_break` for the defense if it went for the ball (a steal card) and the offense handled it (Handle or Pass: "Picked off") |
| the last shot went in (fouled or not) | the other side; Make-It-Take-It: the scorer again (and you draw 1 when it's you) |
| a fouled miss | the other side, after the free throws |
| the last shot was a steal | `fast_break` for the stealer |
| a charge | the defense's ball |
| a contest | the boards: the offense played more Hustle cards this possession than the defense → `second_chance`; else the defense's ball |

### 15.6 Statuses, Stops and the rest, per possession
* **Stops last until you next defend:** whatever you gain with the ball is there on your next defense; after a
  defense what's left is gone, except Hustle Stops (`hustle` cards), which last one more defense. Wristbands' 5 Stops
  wait for your first defense. His leftover Stops go the same way.
* **Statuses count down where they matter:** Exposed and Gassed at the end of a possession where their owner defended,
  Cold where their owner had the ball, Screened after any possession. Hot lasts the match.
* Points on a Defense card (Swat Party's "Score 5") become an **outlet**: + that much on your first Shot of your next
  offense.
* A "turn" in a card's or ability's text is a possession (draws, Flow once a turn, Spotlight's 6 cards, first card this
  turn, Charge "next turn", Captain's Band and Playbook's first turn).

### 15.7 The dead-hand rule
A card you can't play on this side of the ball stays in your hand for the next possession (up to the hand cap of 10);
on-phase cards you didn't play are discarded as ever (Hold and Muscle Memory as ever). So a defense draw full of Shots
isn't wasted: they're waiting when you get the ball. Measured with tools/deck_sim.mjs (`m.log.dead`: possessions that
open with nothing playable): 0.3-0.6% of possessions across the four configurations.

### 15.8 Hidden sets: who and why
Hiding changes only what you see (`foeSet.cards` face down, `total` / `preview` "?"), never the result (tested: the same
possession hidden and open plays out the same).
| Who | What's hidden | Why |
| --- | --- | --- |
| The Shadow (Final) | everything, every possession | he plays your own deck back at you: you can't scout yourself |
| The Professor (P2 boss) | his cards; the total shows | he copies your last card: you know the grade, not the question |
| Showtime (P1 boss) | everything, on his fast breaks only | in transition he's all flash |
| the `poker_face` nemesis trait (new; grown like the other traits) | his cards; the total shows | a rival who's learned not to tip his hand |
| **Screened** (a debuff on you) | everything, for your next possession | the Playmaker style's "Sets the table" and the Full-Court Press's "Trap and score" screen you |
| Franchise Tag (boss ability) | everything, all run | its drawback was "can't see enemy intents" |
| Scouting Report (ability) | reads all of these; against the Shadow or Showtime, the total only | it was "see intents two turns ahead" |

### 15.9 endTurn's events for one possession, in order
the Fatigue in your hand · the defense's cards (`card`) · the offense's setup cards (`card`) · for each shot in play order:
`shot` { how, made, points, stops, assist? } (+ `foul`, `ft` on the first fouled one; `down` / `heal` as Heart moves;
`wall`) · "Picked off" (`shot` how steal) when there was no shot · `clash` { o, d, winner } · Hot Hand / Trash Talk /
Shot Clock · banked Stops · his riders (`status`, `fatigue`) · a betrayal · `rebound` { offensive } · `possession`
{ to, turnType, text } · the next turn's draws and its `turn` · or, when the match ended, `end` last.

### 15.10 Versions and replays
`deck/index.js` exports `ENGINE_VERSION = 2`; newRun records it (`run.engine`). A replay start is
`{ engine, seed, player, world, unlocks }`; `replay()` refuses a start whose `engine` isn't 2 (missing = 1) with
"old engine (1, this is 2)" at -1 before anything else runs. A run started on the old rules can't be continued by this
engine: the client tells the player and lets them end it, and the server pays it by its count checks (`verified:
false`), never 409 (server/gauntlet.py, the Server agent). The server must store `engine: 2` in the start it records
at `/api/gauntlet/start` for new runs (or take it from the client), and the client must send it.

### 15.11 Balance (tools/deck_sim.mjs, 200 runs per row; the policies read foeSet / preview, never a hidden set: a hidden
set is guessed from what that opponent usually brings, the Shadow's from your own deck)
A possession is one end of the floor, so at the old Heart a match took about twice the turns and cards. combat.js
`POSS` scales every opponent's Heart and damage (the tables in foes.js / bosses.js are unchanged): normal matches
and Rivals Heart ×0.4, damage ×0.85; bosses Heart ×0.55, damage ×1.35 (bosses stay the walls). `REPUTATION` for a
converted player: Heart ×1.15, damage ×1.2 (was 1.25 / 1.25). Free throws: and-one ¼, two shots ⅓. Ref's Favorite:
only his drives draw fouls (a foul every possession of his was a third of a starter's Health a match).

| | before (turns) | after (possessions) |
| --- | --- | --- |
| smart, starters: Final won | 20.0% | 20.0% |
| smart, starters: minutes a completed run | 70 | 76 |
| smart, converted: Final won | 42.0% | 50.0% |
| smart, converted: minutes a completed run | 71 | 70 |
| greedy, starters / converted: Final won | 0.5% / 3.5% | 1.5% / 12.5% |
| VC a completed run (smart, starters / converted) | 8000 / 7974 | 7980 / 7967 |
| turns (possessions) a completed run, smart starters | 59 | 72 |
| dead hands | n/a | 0.3-0.6% of possessions |

### 15.12 What was reinterpreted for possessions
Rules: **Make-It-Take-It** (was "draw 1 after you score"): whoever scores keeps the ball, and you draw 1 when you do.
**Shot Clock** (was "a Shot every 2 turns or take 3"): on offense, put up a Shot or take 3 and lose the ball.
**Physical Night**: also every Drive or Post shot draws a foul. **Overtime** (was "from turn 5"): from the 9th
possession. **Trash Talk**, **And-One Night**: per possession. **Tight Whistle**: also no fouls.
Abilities: **Chalk Bag** (turn 1 → your first possession with the ball). **Wristbands**: the 5 Stops wait for your
first defense. **Mouthguard**: the first basket against you. **Scouting Report** (intents two turns ahead → reads hidden
sets). **Franchise Tag** (no intents → no sets). **Hot Hand**: 15+ in one possession.
Bosses: **The Wall**'s cap applies to a basket after his Stops (it used to cut each hit before them). **Showtime**:
his combo every third time he has the ball; hidden on his fast breaks. **Ref's Favorite**: a Ticky-Tack Foul each
time he gets the ball; his drives draw free throws. **The Professor**: copies your last card on both ends; hides his
card. **The Phenom**: Hot each time he has the ball. **The Shadow**: his set is five of your cards, their points on his
offense, their Stops on his defense; hidden. The Press's "Trap and score" and the Playmaker's "Sets the table" now
Screen you.
Cards: Swat Party's points are an outlet for your next offense. Events: unchanged (they act on the run, not the match).
