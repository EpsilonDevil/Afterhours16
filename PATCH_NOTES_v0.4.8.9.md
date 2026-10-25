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

---

## Quick patch 3 (Oct 23): Memory leak fix + performance

### Fixed: the game kept using more graphics memory the longer you played
Every time you left a place, the game kept its whole scene on your graphics card: the park, Crew HQ, the Pro-Am HUB, a match's venue, the Gauntlet court. Each round of the park, HQ, HUB, a Pro-Am game and the Gauntlet added about **77 MB** that never came back, so long sessions got slower and could run out of graphics memory.
- **Now:** leaving a place frees everything it built. In testing, graphics memory stays flat after the first lap at under 500 MB; before, it passed 1 GB after five laps and kept climbing.
- **Walking between places:** the park, Crew HQ and the Pro-Am HUB stay ready together, so going back and forth between them doesn't rebuild anything. Places you haven't visited for a while are freed first when the game needs room.
- **Player looks:** every hair, shoe, chain, bandana and skin look used to keep its own texture on the graphics card forever, so a long session meeting lots of different players kept growing. Looks nobody is wearing are now kept up to a limit (96 MB) and the least recently seen are freed; a look that comes back is painted again, identically. In testing, 400 different looks used to take about 1.2 GB; now it holds at about 120 MB.

### Smoother on your PC
- **Nets:** a park's nets cost about **70% less** per frame.
- **Players:** posing and animating them costs about 10% less again, with a third less memory churned every frame.
- **Score bug:** the score display no longer redraws 60 times a second during live play; it updates when something on it changes.
- **Effects:** busy moments with lots of particles do less work per frame.
- **Ground textures:** the park asphalt and the Harbor sand are painted in the background right after you sign in, so entering the park no longer waits on them. Painting them is also up to **twice as fast** when it does happen.
- **Court lines:** each court's line texture now frees its 30 MB painting copy as soon as it's on the graphics card. The texture itself stays the same size, because shrinking it would have changed what you see.
- **Simulation:** it churns 7–10% less memory every tick, with identical results.

### Faster online server
- **Saving:** the server no longer waits for the disk on every save. Saves are written to disk about once a second instead, so the server answers saves up to **3 times faster** on a typical cloud disk. If the server program crashes, nothing is lost. Only a power cut or a crash of the whole machine could lose about the last second of saves. A server owner can set `RIMRIFT_DB_SYNC=full` to go back to waiting on every save.
- **Database lookups:** looking up a build's games, crew members, sign-ins and Pro-Am requests uses an index now, instead of reading the whole table.
- **Game setup:** it's sent about 1.7 times faster. The server keeps the store catalog ready instead of rebuilding it for every player.
- **Gauntlet checks:** two helpers stay running to check finished Gauntlet runs, so a check takes about **0.03 s instead of 0.15 s**. The same helpers will check park and Pro-Am results once the new engine is in.
- **Park memory:** the park's per-player records are tidied up, so they no longer grow forever on a long-running server.

---

## Quick patch 4 (Oct 23): The Gauntlet plays like a real game

**The Gauntlet has its own tab** at the top of the menu, between PRO-AM and PRACTICE. The Home tile is still there.

### Matches are played in possessions
- **Tip-off:** every match starts with a jump ball. Whoever wins it has the ball first.
- **Your ball:** you spend your energy on your offense: Shots, Moves, Plays and Mentalities. At the same moment your opponent commits his defense.
- **Their ball:** he commits his play and you pick your defense: Defense cards, Plays and Mentalities.
- **End Turn** plays the whole possession out on the court: both sides' cards, every shot, then who has the ball next.
- **Held cards:** cards you can't use on this side of the ball stay in your hand for your next possession (up to 10), so a hand full of Shots on defense isn't wasted.

### You can read his cards
- **Before you play,** you see the cards your opponent has committed and their total, next to a live **You vs Them** number.
- **Some players can't be read:**
  - The Shadow hides everything.
  - The Professor hides his cards but not his total.
  - Showtime hides his fast breaks.
  - Rivals who learn to keep a poker face hide their cards but not their total.
  - Some players can **Screen** you, so you can't see their next set.

### The higher number wins
- **Your number vs his:** the offense's number is its Shots' points, worked out exactly as before. The defense's number is its Stops.
- **Scoring:** if the offense's number is higher, it scores the difference. If not, the shot is stopped. **Ties go to the defense.** No hidden luck can change it.
- **How it plays out comes from the cards on both sides:**
  - a pass before the shot is an **assist**;
  - a block card against a drive or a post shot is a **block**;
  - a steal card against a ball handler is a **steal**, and the stealer gets a **fast break** against a defense caught out of position;
  - otherwise a stopped shot is a contested miss, and whoever played more Hustle wins the rebound; winning it on offense is a **second chance**;
  - Physical Night and some drives draw fouls: an **and-one** or free throws.

### What stays the same
Heart and Health work as before. Your baskets take away your opponent's Heart, his take away your run Health, and you win the match when his Heart is gone. The stats, the cards, combos and Flow, the brackets, bosses, rewards, abilities, the rivals who remember you and the VC are all unchanged. A good run with a starter still wins about one time in five.

### Runs from before this update
A Gauntlet run you started before this update can't continue under the new rules. When you open the Gauntlet, you can end it and get paid what it earned. To start a run, your game has to be up to date; an old version is told to update.

---

## Quick patch 5 (Oct 25): Auto-play on a controller

- **Auto-play has a controller button:** **D-pad down** turns auto-play on and off, just like **H** on the keyboard, anywhere auto-play works. That's offline games and online Pro-Am.
- **Remapping:** you can change the button on the controls screen, under Controller ("Auto-play on / off").
- **Showing the right button:** the on-screen messages name the button for the device you're using ("Auto-play ON (D-pad down)"), and the controls list shows both.

---

## Quick patch 6 (Oct 25): Pro-Am teams with your friends online

**Friends can now be on the same Pro-Am team online.** Before, each player's Pro-Am team stayed on their own PC, so a friend could never find it or join it, even while you were playing online together.
- **Your team lives where you meet:** while you're connected, your Pro-Am team lives on the online server you're both on (or on the host's PC when a friend hosts). Friends find it in the team search and join it: straight in if it's open, or by request if it's invite-only. They stay on it through reloads, reconnects and server restarts.
- **One HUB:** teammates walk into the same HUB and see each other. Whoever has been there longest is the Captain.
- **Series games together:** when the Captain queues, everyone on the team in the HUB gets the ready check, and only the empty spots are filled with your drafted or AI players. You play one shared game, all on the same side.
- **Your progress stays yours:** each of you keeps your own build, rank, RP, VC and items in your own save. A series game counts for each player's RP. When a series ends, each member moves up or down a division once and gets the series bonus.
- **Still your choice:** you can still make separate teams, or play on your own team with AI teammates, online and offline.
- **Teams made offline:** a team you made while playing offline stays offline. Online, create a team or join one there.
