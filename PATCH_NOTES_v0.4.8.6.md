# RIMRIFT — v0.4.8.6 Patch Notes

v0.4.8.6 is the identity patch: Afterhours 16 is now **RIMRIFT**. The game opens on a new title screen, the menus wear the new Ember, Bone and Carbon colors, and the name and logo change everywhere you see them. Nothing about how the game plays has changed. Your account, players, VC and items carry over untouched.

Everyone has to be on v0.4.8.6 to play online together. Pull the update before you connect.

---

## The title screen
- **Before the game loads,** RIMRIFT opens on its own title screen: the key art, the logo and MAKE YOUR OWN GRAVITY.
- **To enter,** use ENTER THE COURT, click, press Enter, Space or Esc, or press A or Start on a controller.
- **A button already held when the screen appears doesn't count.** Let go and press it again.
- **Launched from Afterhours16.exe,** the click or key that enters the game also locks the window in (fullscreen and keyboard), the way your first click used to. A controller press can't do that (a browser rule), so then your first click or key in the game still does it.
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
  - The Afterhours jerseys, pullover and tees now carry the RIMRIFT name and lettering. A/H becomes R/R and AH16 becomes RR.
  - If you own one, you keep it; it just wears the new name.
  - The AH on every shoe heel is now RR.
- **Hosting online:** the router port mapping is labeled RIMRIFT.

## What stays the same for now
- **Folder, launcher and files:**
  - The game folder (C:\Afterhours16), Afterhours16.exe and its icon, and start/host/join.cmd keep their names. They change when RIMRIFT moves to its new engine (Stage 1 of the v0.5 roadmap).
  - The launcher's own setup messages still say Afterhours 16.
  - Your saves are untouched.
- **Bug reports** still go to Afterhours16_Bug_Reports.txt in the game folder.
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
- **From Afterhours16.exe** the sound starts right away. In an ordinary browser tab, the browser may hold all sound until your first click or key.
