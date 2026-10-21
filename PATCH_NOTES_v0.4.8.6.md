# RIMRIFT — v0.4.8.6 Patch Notes

v0.4.8.6 is the identity patch: the game is now **RIMRIFT**. The game opens on a new title screen, the menus wear the new Ember, Bone and Carbon colors, and the name and logo change everywhere you see them. Nothing about how the game plays has changed. Your account, players, VC and items carry over untouched.

Everyone has to be on v0.4.8.6 to play online together. Pull the update before you connect.

---

## The title screen
- **Before the game loads,** RIMRIFT opens on its own title screen: the key art, the logo and MAKE YOUR OWN GRAVITY.
- **To enter,** use ENTER THE COURT, click, press Enter, Space or Esc, or press A or Start on a controller.
- **A button already held when the screen appears doesn't count.** Let go and press it again.
- **Launched from RIMRIFT.exe,** the click or key that enters the game also locks the window in (fullscreen and keyboard), the way your first click used to. A controller press can't do that (a browser rule), so then your first click or key in the game still does it.
- **Settings → Title screen** brings it back any time.
- **No music** plays on the title screen.

## The new look
- **New colors:**
  - **Ember** (#FF4D24) for buttons, tabs, highlights, progress bars and "YOU" tags;
  - **Bone** (#F3EEE4) for headline text;
  - **Carbon** (#080A0D) for backgrounds.
- **Text on Ember buttons stays dark,** for contrast (about 6:1).
- **Still gold, on purpose:**
  - VC and prices, your OVR tile, Gold badges, Hall of Fame and ICON colors;
  - the C grade, the MVP tag, the Daily Spin jackpot, bounties;
  - event and team colors.
- **The ring under your own player stays yellow,** so it can't be mistaken for an opponent's red ring.
- **The shot clock is Bone,** so its low-clock red stands out.
- **The logo:**
  - the RIMRIFT wordmark in the top bar;
  - the full logo on the welcome card and the boot screen;
  - a new browser-tab and app icon.

  All of them are vector, so they stay sharp at any size.

## The name, everywhere
- **In the menus:** the window title, boot screen, menus, quit dialog and the phone's header now say RIMRIFT.
- **The arena:** RIMRIFT on the sidelines and the mark at center court, and RIMRIFT PRO-AM on the LED ribbon and the scorer's table. With a Pro-Am team, your team's own colors and logo still take over.
- **The Pro Run league** is now the **RIMRIFT Pro League** (RPL). Saved careers carry on.
- **The soundtrack** is now the RIMRIFT Soundtrack.
- **Branded gear in the store:**
  - The branded jerseys, pullover and tees now carry the RIMRIFT name and the RR lettering.
  - If you own one, you keep it; it just wears the new name.
  - Every shoe heel says RR.
- **Hosting online:** the router port mapping is labeled RIMRIFT.

## What stays the same
- **Your saves** are untouched.
- *(The launcher, its icon and the game's files took the RIMRIFT name in quick patch 3, below.)*
- **Mode names** (Pro-Am, badges, the player builder) stay as they are. The proposed renames come with the menu rebuild.
- **The title screen's key art is labeled GENERATED CONCEPT ART.** It shows where the game is heading, not today's graphics.

---

*(Tests: 179 Python and 462 node tests. Browser checks covered the title screen (mouse, keyboard and controller, fresh presses only, the launcher heartbeat and lock-in), the welcome card, home, MyPlayer, the store, Settings, the Park screen, Pro-Am, a park and a game HUD, and the results screen. They also covered the arena from four cameras, a team arena (unchanged), the rebranded gear on a player, and the logo and icons at 16, 32 and 64 px. The traced logo matches the original artwork at an overlap of 0.99 for each color.)*

---

## Quick patch (Oct 18): The season reset, the ICON Squad, Brick Wall and Posterizer

### The season reset: Monday Oct 19, 12:00 AM Eastern
Every account starts over at midnight Eastern going into Monday, October 19 (9:00 PM Pacific on Sunday, 04:00 UTC).
- **Wiped:**
  - every build, with its games, its Pro Run career and its Pro-Am team;
  - all your VC;
  - every item: store, Daily Spin and event items;
  - crews, which are disbanded and start over with no XP;
  - event leaderboard entries, Daily Spin timers and ICON build slots.
- **Locker codes are retired.** Every code, HELP-I-NEED-VC included, stops working as soon as you update (it says the code has expired).
- **A new AI world:** every account gets a brand-new world of AI hoopers, all starting from scratch. AI ICONs, and with them the ICON Squad, come back as the world grows, in about six to eight weeks.
- **Kept:**
  - your account (username and password), so you sign in as before, and you stay signed in;
  - your friends list of real players;
  - your link to the online server.
- **You start with 250,000 VC** and the free basics every new account gets. New accounts made from now on start with 250,000 VC too (it was 1,000,000).
- **When it happens:**
  - If the game is open, it warns you 10 minutes and 1 minute ahead, then reloads onto your fresh account.
  - Otherwise your copy resets the first time it runs after midnight. A copy updated later resets the first time it starts.
  - The online server resets at the same moment.
- **Update before midnight Eastern.** You need this update to reset with everyone and to keep playing online.
- **A copy of your old save** is kept in the game folder, in data\backups.
- **Fixed (Oct 19): AI friends now reset too.** A game left open over midnight saved its old AI world (your AI friends and squad, and every AI hooper's progress) back after the reset, before it reloaded. A game in the middle of a match didn't reload at all. Now:
  - the old world can't be saved back;
  - any that got back in is cleared the next time the game starts;
  - an open game stops saving and reloads even mid-match.

  Update and restart, and your AI world starts fresh like everything else.

### The ICON Squad
The rarest thing in the park. About every 9 hours, a full squad of three AI ICONs (99 OVR) shows up at one of the three parks and runs there for an hour.

### When and where
- **Every 9 hours, give or take 10 to 30 minutes.** Each squad arrives about 9 hours after the last one did, 10 to 30 minutes early or late, a different amount every time. Nine hours doesn't divide a day, so it comes round at every hour of the day.
- **Harbor Point, Old Brick Yard or Foundry Works,** never the same park twice in a row.
- **Only ever one.** There is one ICON Squad at a time across the three parks, and no other AI team in the parks ever has three ICONs on it.
- **The same schedule for everyone.** It runs on the server's clock, so every copy of the game sees the squad arrive at the same moment, at the same park.
- **There's no countdown.** You find out when they show up.

### Who they are
- **Three real ICONs of your world:** AI hoopers who got to 99 by the same rules you do. Nobody is made an ICON for the occasion.
- **Builds that fit together:** a ball handler, a wing and a big, on three different archetypes that cover playmaking, shooting, inside scoring and defense between them. Most squads are a new mix of ICONs.
- **One outfit:** the squad leader's clothes, worn by all three. An exclusive only goes on if all three have unlocked it. Each keeps his own name, number, animations and Icon package.
- **A young world has to wait.** A world needs three ICONs before a squad can form, which takes about six to eight weeks. Until then, the hour passes with no squad.

### At the park
- **They walk in together** and take a 3v3 court, or a GOT NEXT spot as a group.
- **Winners stay.** They keep the court while they win. Beat them and they get back in line to run it again.
- **To play them,** get next on their court.
- **When the hour is up,** they finish the game they're in and walk out together.
- **They're busy for the hour.** You can't invite one of them to your squad. One who's in your squad leaves to run with them, and you can ask him back when their hour is over.

### Where you'll see it
- **A toast** when they show up, wherever you are in the menus or at another park.
- **The Park screen** tags their park ICON SQUAD HERE with the time left and their names.
- **The phone** shows an ICON SQUAD chip on each of them, and where they are.
- **On the court and the scoreboard,** they play as the ICON Squad.

### Badges
- **Brick Wall:** Hall of Fame takes **173 successful screens** (was 315, 45% fewer). Bronze, Silver and Gold are unchanged (18, 63 and 154).
- **Posterizer:** Hall of Fame takes **126 dunks** (was 180, 30% fewer). Bronze, Silver and Gold are unchanged (8, 30 and 80).
- **Progress you've already made counts.** A build already past the new mark moves up to Hall of Fame as soon as you log in, if the badge can reach Hall of Fame on that build and it has a Hall of Fame slot free.

*(Tests: 186 Python and 490 node tests. The reset was checked on a real save through the game's own service, with the time moved up: builds, VC and items wiped, 250,000 VC, still signed in, a new AI world and the backup written. A browser check covered a year-old world with the clock moved into a squad's hour at the Old Brick Yard: the real pick, the toast, the Park screen tag, the squad holding a court in one outfit and the phone list, with no page errors. The one-squad rule was checked over 3,200 random park steps with half the AI as ICONs: no other team ever had more than two.)*

---

## Quick patch 2 (Oct 18): The opening

Every time you start the game, it now opens like this:

1. **Silverback Studios.** The studio's silver logo on black. A gleam crosses it from left to right, like sunlight off metal. When it reaches the far edge, a deep cinematic ding plays and the logo flashes once. Then it slowly pushes in as it fades to black.
2. **The cinematic.** "Tusk" starts from the top, over the RIMRIFT cinematic from the media kit: a player drives and dunks on a night court, with a close-up at the rim. It's labeled CONCEPT CINEMATIC, because it shows where the game is heading, not today's graphics.
3. **The loading screen,** while the game starts.
4. **The title screen,** with Tusk still playing. When you enter the court, it fades out and the soundtrack takes over.

- **Skipping:** a click, Enter, Space, Esc, or A / Start skips the logo and the cinematic. A button you were already holding doesn't count.
- **Settings → Title screen** plays Tusk again from the start, with the soundtrack paused underneath.
- **Volume:** Tusk follows the music slider, and turning music off silences it. The ding follows the sound effects slider.
- **From RIMRIFT.exe** the sound starts right away. In an ordinary browser tab, the browser may hold all sound until your first click or key.

---

## Quick patch 3 (Oct 19): RIMRIFT everywhere

The last of the old name is gone. Everything you see, and every file the game makes, now says RIMRIFT.

- **RIMRIFT.exe starts the game.** It has the RIMRIFT icon: the mark on a Carbon tile, sharp from the taskbar to the desktop. Its window, its one-time Python setup and its file properties all say RIMRIFT (by Silverback Studios).
  - Delete the old launcher .exe, the one with the old name.
  - Remake any desktop or taskbar shortcut so it points at RIMRIFT.exe.
- **Your save moves over by itself.** The first time RIMRIFT starts, the save becomes data\rimrift.sqlite3, with nothing lost. Your settings carry over too.
- **Bug reports** go to RIMRIFT_Bug_Reports.txt in the game folder. The old reports file can be deleted.
- **host.cmd, join.cmd and start.cmd:** their windows and messages say RIMRIFT. Hosting still remembers your join code, and nobody has to sign in again.
- **The arena** is the RIMRIFT Arena, and the game service's own window says RIMRIFT.
- **The welcome card** says new accounts get 250,000 VC, the amount since the season reset.

## Quick patch 4 (Oct 19): The Favelas and the park shuffle

**The Favelas take over from The Monster Mash at 8 PM Eastern on Monday Oct 19 (00:00 UTC Oct 20)** for their own 48-hour window. Ante-ups and the leaderboard work like every event park; the Monster Mash's last window still pays Mash prizes.

**The place.** The same park and courts on a hillside favela at golden hour turning to dusk: more than a thousand brightly painted brick and concrete houses stacked up the slopes, flat roofs with water tanks, satellite dishes, laundry lines and string lights, stairways and narrow alleys between them, overhead wires and small shops with Portuguese signs. Windows light up and go dark, TVs flicker, laundry sways, and doors swing open as neighbours step out to chat and go back in. The ground is packed red earth and broken concrete, with paved streets, kerbs and gutters round the park. The park plays the regular park playlist.

**Life round the park.** People walk the streets and stairways with real walk cycles, neighbours chat at their doors and on the roofs, and kids fly kites from the rooftops. Stray dogs trot and sniff, cats sit on the roofs, chickens peck by a door and a flock of pigeons lifts off and settles. Three dirtbike riders circle the streets, pulling wheelies on the straights, and a police car sits at the edge with its lights on.

**Random events.**
- **Police chase:** a police bike, lights flashing and siren wailing, chases a dirtbike rider round the streets until the rider cuts up a stairway and gets away.
- **Foot chase:** two officers chase a lad on foot; he's gone up the steps and they stop, hands on knees.
- **Kite fight:** two kites duel over the roofs until one string is cut and the loose kite tumbles away across the sky.
- **Bateria:** a samba drum group with a flag comes down one stairway, along the street and up another, drums playing.
- **Power cut:** a block's lights flicker out and come back.
- **Tropical shower:** a quick downpour over the roofs.

Nobody gets hurt and no weapons are shown; the chases always end with the rider getting away. The siren and the drums are synthesized (no recordings) and follow the SFX slider.

**Court and streaks.** A teal community court with a yellow apron framed in blue-and-white tiles with kites, suns and flowers, a terracotta key, a kite-over-the-hill crest at centre court and THE FAVELAS on the baselines. On a streak, kites rise and circle the court at 3 wins; at 6, more kites and bunting across the court; at 9, a painted-tile pattern washes over the floor in changing colours; at 12, confetti falls and the kites spiral higher.

**Rewards** (same tiers as every event park; none can be bought):

| Finish | VC | Items |
| --- | --- | --- |
| 1st, King of the Favelas | 150,000 | All seven |
| Top 3 | 60,000 | Ladeira hi-tops, Passinho, Hillside Bandana, Pipa, Cuíca |
| Top 10 | 25,000 | Passinho, Hillside Bandana, Cuíca |
| Top 25 | 10,000 | Hillside Bandana |

- **The Morro Kit** (jersey and shorts): a football-style shirt and shorts in sun-faded green, yellow and blue stripes with a band of painted tiles at the hem; MORRO on the front, your name and number on the back.
- **Ladeira hi-tops:** cream uppers with a painted-tile panel down each side and grippy gum soles.
- **The Passinho:** a celebration of quick favela-funk footwork, eight steps a second.
- **Hillside Bandana:** a red patterned bandana knotted at the back; its ends swing as you move.
- **Pipa** (green release): a burst of paper kites flies up and out on a made green.
- **Cuíca** (green sound): a synthesized cuíca's whoops and long sliding call.

Headbands in the store are now tried on at head-and-shoulders distance.

**Follow-up (Oct 20):** the streak's bunting used to hang across the court level with the 2K cam and covered the top of the screen. It now runs along both sidelines at fence height, out of bounds, so it never blocks the court, the rim or the players in the 2K cam or the broadcast cam.

**The park shuffle.** When The Favelas end at 8 PM Eastern on Wednesday Oct 21, the event park starts a shuffle of all five event parks: the King Tut Cup, the Jungle Ballers, And The Beat Goes On, The Monster Mash and The Favelas, 48 hours each. Every park plays once before any park repeats, and no park ever plays twice in a row. The first round is the four parks the Favelas haven't been: the King Tut Cup (from Oct 21), And The Beat Goes On (Oct 23), the Jungle Ballers (Oct 25) and The Monster Mash (Oct 27); then the parks reshuffle for the next round, and so on with no end date. The order is fixed in advance, so every game shows the same park and switches over on time on its own.

## Quick patch 5 (Oct 20): One AI world online, Hall of Fame for every badge, chains, possession, open threes, the forced dunk

**One AI world for everyone online.** Every player on the same online server now sees the same AI world: the same AI hoopers with the same builds, looks, unlocks and ICONs, online at the same times, at the same parks. Friends in the same park see the same games on every court, the same lines and the same park-goers. The server keeps one world (its seed and start time), and every game follows the server's clock and time zone, so different PC clocks and time zones no longer make a difference. When several players are in a park, the first one there keeps its games, lines and ICON Squad in step for the others; if he leaves, the next one carries on. Your own games no longer change the AI. Offline play keeps its own world, as before.
- **Heads-up:** an account's AI friends and squad from its old world don't carry into the shared world (the same names are different people there). Nothing is deleted; the old world is kept on the save.
- **Still per screen:** the background extras, like pedestrians, animals and the event parks' townsfolk, still wander on their own on each screen.

**Hall of Fame for every badge.** There's no Hall of Fame limit any more. The 7 Hall of Fame badges are only what your archetype's Icon badge needs; every badge your build can take to Hall of Fame can now get there, and ICON status needs every badge at its max. **A build already past a badge's requirements gets it the next time the game loads your profile** (its progress kept counting while it was held at Gold). Cap breakers still come with the first 5 Hall of Fame badges. The AI's ICONs follow the same rule.

**Every chain looks like itself.** The four chains used to come out as only two looks (gold or iced). Now:

| Chain | Links | Metal and stones | Length | Pendant |
| --- | --- | --- | --- | --- |
| Gold Chain | Cuban, thickest | yellow gold | collarbone | gold medallion with RR |
| Silver Rope Chain | rope | sterling silver | longest | none |
| Iced Out Chain | tennis | white gold, clear stones | mid-chest | big iced disc |
| Rose Ice Chain | box, finest | rose gold, pink stones | shortest | iced heart |

Chains now show over a jersey's neckline, the store tries chains on at head-and-shoulders distance, and the medallion and the retro shoe's side mark say RR.

**Quarters don't change possession** (Pro-Am and the Pro Run). The team with the ball when a quarter ends starts the next quarter with it. A basket on the buzzer hands it to the other team, like any make. It used to alternate whoever had the ball.

**A solid green window on wide-open threes for 85+ shooters.** A wide-open three (guarded 10% or less) by a build with an 85 or higher three-point rating now has a solid green window whatever the archetype: a green goes in, and the non-shooter's 10% smaller window doesn't apply to it.

**Force a dunk with any build.** Hold R2 + right stick down + Square (Xbox: RT + right stick down + X; keyboard: sprint + the step-back key + shoot) while driving at the rim, within about 4 m, and any build dunks it, whatever its dunk rating or height. A build that can't normally dunk uses a basic one- or two-hand dunk. Makes, misses and blocks still come from the dunk's usual chances, so a poor dunker misses more. Further out it's a normal drive. Any two of the three still do what they did before. The combo is listed in the controls.

## Quick patch 6 (Oct 20): Cap breaker respec for ICON builds

**Respec your cap breakers once a build is ICON.** A build that has reached 99 OVR ICON status can now take back every cap breaker it placed and place them again wherever you like. Open the build's Cap Breakers tab (next to Upgrades) and press **Respec** at the top, then **Confirm respec**.
- **The first respec on each build is free.** Every respec after that costs **250,000 VC**. If you don't have the VC, nothing changes.
- **Only ICON builds can respec.** The button shows on every build, but stays closed with a note until that build reaches ICON status (99 OVR, every cap breaker placed, every badge maxed). Once a build has been ICON, the option stays open to it for good.
- **What it does:** every attribute goes back to its cap without the breakers (the upgrades you paid VC for stay), and all the build's cap breakers return to it, ready to place. Until you place them again the build sits below 99 and its ICON status waits for them; its ICON build slot is kept.

## Quick patch 7 (Oct 21): Smooth menus, new finishing controls, emotes online, Icon badges on show

**Menus scroll and click the way they should.**
- **The mouse wheel no longer lags or gets ignored.** Before, menus waited on the 3D showroom before they could scroll, and that's fixed.
- **Lists stay where you scrolled them.** Buying, equipping, upgrading, timers ticking, or the phone and countdowns refreshing used to jump a list back to the top. Now it stays put. Switching to a new tab or category still starts at the top.
- **One click is enough.** Countdowns (the Daily Spin, the phone, the events) no longer swap buttons out from under the cursor, so a click never needs a second try.
- **No more doubled requests.** Buy, Equip, Save, Add and the other slow buttons can't be sent twice.
- **Builder sliders drag in one smooth motion.** They no longer cut out mid-drag.
- **The wheel stays in the box you're scrolling.** Reaching the end of a list or dialog no longer scrolls the page behind it, and short windows can scroll the home hub.
- **Keyboard keys work in menus again.** The arrows, Space and Tab scroll lists, press the focused button and move between fields.
- **Controller:** turning the mouse wheel hides the controller's focus ring, and a menu that redraws no longer pulls the page back to it.
- **In the park and in games**, a click or wheel over a panel, the pause menu or the phone belongs to that menu. It no longer zooms the camera, shoots or passes. The showroom zooms only with the wheel over the player, smoothly on a trackpad, and stops turning if a menu opens mid-drag. The button prompt no longer catches clicks.

**Finishing at the rim.** The R2 + right stick down + Square combo is gone.
- **Attack the rim now forces a dunk, with any build.** That's Z on the keyboard, or the right stick down while sprinting. The make, miss and block chances are the dunk's usual ones, and a build that can't normally dunk uses a basic dunk. Starting a little too far out, you keep driving until you're in range.
- **Sprint + Shoot at the rim forces a layup.** It's never a dunk, jumper or pump fake. The layup is timed like a shot: a quick tap is an early layup. Anywhere else, Shoot works as before.

**Emotes reach other players.** A celebration in the park or at the Crew HQ used to play only on your own screen. Now everyone there sees it on your player. The server checks that it's the celebration you actually have on. Games already showed them.

**One park for everyone online.**
- **The server picks the park's host:** whoever has been at the park longest. A new arrival no longer takes over and resets the park.
- **Only that host's updates go out**, so two players can't both drive the park.
- **A player who walks in sees the park as it is straight away.**

**Icon badge items belong to their Icon.** Each Icon badge's own animation items now show only on a build that has unlocked that badge. Other builds don't see them at all: no card, no count and no tab. They're never in the store, and they go on automatically when the badge unlocks. The items:
- Sharp Eye's jumpshot and release
- Hash-Slinging's dunk package (it used to show as a locked card on every build and in the store)
- The Clamp's Steal Package
- Big Brother's Block Package
- Open Arms' Rebound Package
- Sexy Red's Post Move Package
- The General's Salute
- **New:** Oprah's **Pass Package: Oprah**, under a Passes tab that only a Playmaker with Oprah unlocked has.

**Icon badges show on screen when they make the play.** Each Icon badge now pops up on screen, the way Hash-Slinging does, whenever it's behind the play:

| Badge | Pops when |
| --- | --- |
| Sharp Eye | A made jumper with its own jumpshot or release, or a green only its bigger window gave |
| Hash-Slinging | A made dunk |
| Oprah | A pass (every one of his passes is an Oprah pass) |
| The Clamp | One of its steal reaches, pick-offs or strips |
| The General | A made basket, a block or a steal |
| Big Brother | A block from his Block Package |
| Open Arms | A rebound snag |
| Sexy Red | A post move, post finish or post shot with her Post Move Package on |

The pop shows for every player in the game, AI ICONs and other players included, with the player's name when it isn't you. Each badge pops at most once every 1.5 s per player.
