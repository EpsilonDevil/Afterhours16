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
//              opps:[{ id, charId, name, look, heart, maxHeart, stops, status, intent:{kind, value, text} }],
//              rules:[{ id, name, text }], score:[you, them] }
playCard(run, handIndex, target = 0) -> events
endTurn(run) -> events
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
