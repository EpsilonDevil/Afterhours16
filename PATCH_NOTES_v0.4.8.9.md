# RIMRIFT — v0.4.8.9 Patch Notes: The Gauntlet

v0.4.8.9 adds **The Gauntlet**, a turn-based basketball deckbuilder roguelike. You build a deck, fight your way through three tournament brackets and a Final, and watch every card play out on the court above you. The characters you meet remember you from run to run.

It also brings **Park cards**, permanent account-wide park boosts earned by sacrificing ICON builds to the Gauntlet, a subtler ICON aura at its top levels, smaller streak VC at event parks, and a fix for the Favelas bandana.

Everyone has to be on v0.4.8.9 to play online together. Pull the update before you connect.

---

## The Gauntlet

Find it on the Home screen ("The Gauntlet").

### Your player and the four stats
At the start of a run you pick one player: one of three random starters, or one of your converted ICON players (see Park cards below).

| Stat | What it does |
| --- | --- |
| **Stamina** | The energy you spend on cards each turn (3, 4 or 5) |
| **Shooting** | Adds points to every scoring card |
| **Defense** | Adds Stops to every defensive card. Stops soak up points scored on you this turn |
| **Health** | Your life for the whole run. Points scored on you take it away, and the run ends at 0 |

- **Starters** roll each stat from 1 to 5.
- **Converted players** roll from 6 to 10, based on their old build's ratings. Opponents raise their game against them, so it's still a fight.
- **Cards and abilities** change all four stats, for a match or for the rest of the run.

### Matches
- **Turns:** each turn you play cards with your energy. Scoring cards put up points, defensive cards build Stops, Moves set up combos, Plays draw cards and give energy, and Mentalities last the whole match.
- **Intents:** your opponents show what they'll do next turn, so you can plan around it.
- **The court above:** the game plays out on the court over the card table. Every card is a real play: jumpers, threes, layups, dunks, crossovers, closeouts, blocks, steals. The shots really go in or rim out, and the opponents' turns play out too. You can skip or fast-forward any play.
- **Combinations:** a card can be stronger right after a card with a certain tag (Handle, Drive, Post, Perimeter, Pass, Hustle). Play three different tags in one turn for **Flow**: +1 energy and a card.
- **Deck size matters:** **Depth** cards grow with a bigger deck, **Tight** cards with a thinner one. Fatigue cards clog it up. Cut cards at the shop to keep it lean.
- **Match rules:** every match has random rules, shown before you choose it, such as Make-It-Take-It, Threes Count Double, Shot Clock, Physical Night, Win By 2, No Timeouts and Run & Gun. There are 22 in all.

### The bracket
- **Structure:** each run is **three phases**, each a tournament bracket ending in a **boss**, then the **Final**. On every round you choose your next stop from the ones in front of you.
- **Matches and Rival matches.** Rivals are harder and pay an ability.
- **Coolers:** heal 30% of your Health, or upgrade a card. There's always a Cooler before the boss.
- **Boost Shops:** buy cards and **abilities** (permanent run bonuses, 43 of them), or pay to remove a card.
- **Mystery Stops:** 26 random events with choices. Some are nemesis encounters.
- **Rewards:** after each win, pick 1 of 3 new cards, or skip.

### Bosses
- **Phase bosses:** The Wall, Showtime, Ref's Favorite, The Professor, Twin Towers, The Closer, Full-Court Press, The Enforcer, The Phenom.
- **Finals:** The Dynasty, The Shadow, The Undisputed.
- **Venues:** each boss plays at its own Pro-Am park.
- **Difficulty:** bosses are tough. In testing, a well-played starter completes about one run in five.

### The nemesis system
- **Who you face:** every opponent is a named player from the server's world.
- **What they remember:** your record against them, what you did (you broke his ankles, you helped him on the sideline), their rank (Streetballer up to Legend), their traits, and their friends, rivals, mentors and debts.
- **How they change:** players who beat you **grow**, rank up and learn your tricks. Players who keep losing **regress**. They **remember** you before a match.
- **Help or wrong:** a player you helped may come back as an **ally**, or **betray** you at the worst moment if a rival got to him. A player you wronged holds a **grudge** and brings friends.
- **Your Nemesis:** your highest-ranked Nemesis can take a boss's place.
- **Between runs:** the world moves on, and the Gauntlet screen shows the word on the street.

### VC
- **What you earn:** 140 per match won, 300 per Rival, 900 per boss and 2,000 for the Final, paid by the server.
- **Limits:** a run pays at most 8,000 and no more than 180 VC per real minute.
- **Failed runs:** a run that ends early keeps everything it earned.

## Park cards

- **Sacrificing a build:** sacrifice an **ICON 99 OVR** build to the Gauntlet. It leaves the park for good and becomes a permanent Gauntlet player, with its name, look and stats.
- **What you get:** a **Park card**, a permanent boost for every build on your account in the park.

| Sacrifice | Unlocks after | Park card |
| --- | --- | --- |
| 1st | 1 completed Gauntlet run | **Common**: +1% |
| 2nd | 3 completed runs with 3 different players | **Rare**: +3% |
| 3rd | 5 completed runs | **Legendary**: +5% |

- **What gets boosted:** each card boosts one attribute picked at random from the sacrificed build's Icon badge. For example, Three Point or Mid-Range for Sharp Eye, Steal or Perimeter D for The Clamp, and any attribute for The General.
- **Where they count:** park games, event parks included. They never count in Pro-Am, the Pro Run or crew runs.
- **Only three:** you can only ever sacrifice three builds. A sacrificed build frees its build slot.
- **How to do it:** MyPLAYER → Players has a new **Account Park Cards** row showing your cards and your progress to the next sacrifice. The **Sacrifice** button is on every ICON build. It shows a clear warning and needs a 5-second hold to confirm.

## Other changes

- **ICON aura:** levels 3 and 4 are more subtle: fainter, lower and softer, with fewer crackles and a smaller floor pulse. They still step up from levels 1 and 2. Levels 1 and 2 are unchanged.
- **Event park streaks:** the streak VC multiplier at every event park is **75% smaller**. A 2× streak is now 1.25×, for VC and event winnings. Rep keeps the full streak.
- **The Favelas bandana:** its hanging ends drape over the head, neck and shoulders instead of passing through, in every animation and celebration.
- **The Cage (Pro-Am park):** its traffic no longer appears on the court for a moment when the park loads.

---

## Quick patch 1 (Oct 22): Gauntlet runs are replayed by the server

**The online server now replays every Gauntlet run before it pays.** When a run finishes, your game sends the server the list of choices you made. The server plays the run again from the same start, with the same game code, and pays VC only for what that replay earned.
- **If the replay doesn't match:** a run whose choices don't replay to the result it claims (an extra win, a card that wasn't in hand, a skipped boss) is refused. Honest runs always replay. Each verified run shows a small **✓ Verified** on its summary.
- **Speed:** a replay takes about a quarter of a second.
- **When it's off:** replay needs Node.js on the server, and the online server installs it by itself with this update. On a server without it, including a game hosted on your own PC, runs are checked by their counts as before. Nothing is needed on players' PCs.
- **Your opponents' names and looks** still come from your park's world. Who you face and how they play now come only from the run's start, so the server and your screen always get the same run.

---

## Quick patch 2 (Oct 22): QOL + Performance

**Nothing about how the game plays has changed.** Every game mode plays exactly as before, down to the last bounce. We checked that by replaying seeded park, Pro-Am, lockstep online, park director and Gauntlet games before and after the patch and getting identical results. Players on quick patch 1 and quick patch 2 can still play together.

### Smoother on your PC
- **Players:** posing and animating the players on court costs about **25% less** per frame.
- **Drawing the scene:** each frame makes about **28% fewer** graphics calls. Busy moments full of effect particles no longer allocate memory for every particle on every frame, so they stay smooth.
- **Going back to a park:** parks you've already visited this session load **2 to 5 times faster**: Old Brick Yard 0.8 s to 0.2 s, King Tut 0.19 s to 0.04 s. The courts' painted lines and the parks' brick and stone walls are made once and kept.
- **Fewer copies on the graphics card:** players with the same hair style and colour share one hair texture. A return visit to a park no longer uploads its court textures a second time (about 200 MB less).
- **Making players:** building AI players for the park, the AI world and the Gauntlet's cast is about **2.2 times faster**.
- **Pro-Am:** the simulation runs about 9% faster in Pro-Am games.

### Faster online server
- **Your profile:** the server answers the MyPLAYER and profile request about **6 times faster** (21 ms to 3 ms).
- **Park games:** starting and finishing a park game is about 1.6 times faster on the server.
- **Gauntlet:** the server's replay check of a finished Gauntlet run takes about 0.14 s instead of 0.23 s.
- **Memory:** the sign-in rate limiter now forgets old addresses instead of keeping every one forever.

### Cleaner code
- **Tidied:** unused code and imports removed throughout.
- **Easier to follow:** every major file now starts with a short note on what it does and who uses it, with clear section headings inside. The server's routes are grouped by feature (session, online, builds, store, AI world, games, crews and the Cup, Pro-Am, the Gauntlet).
