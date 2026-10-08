# Afterhours 16 — v0.4.5

An original street-and-arena basketball game inspired by the feel of the 2015-era sim-arcade basketball games: weighty movement, timed jumpers, size-ups, posters, and a social hub where you walk up to a court and call next. You get a 3D WebGL2 client built from scratch for this version and a small Python/SQLite service that saves your players, VC wallet, Rep, badges and Pro-Am team.

All art, names, courts, gear and animations are original and generated in code. There are no NBA or 2K assets, logos or trademarks, no online accounts and no real-money purchases. VC is fictional.

## Run it

**v0.4.4 comes in five zips because the soundtrack is large:** `Afterhours16-v0.4.4.zip` (the game) and `Afterhours16-v0.4.4-music-1of4.zip` to `-4of4.zip`. Extract all five into the same place. The music zips fill in `Afterhours16/client/audio/music`. Without them the game still runs, just with no soundtrack.

You need **Python 3.10 or newer** and Microsoft Edge or Google Chrome (Firefox works through `start.sh` / the manual route). There is nothing to install with pip or npm, and you can play offline.

**Windows: double-click `Afterhours16.exe`.** It starts the game service hidden, opens the game **fullscreen in its own window** (a separate Edge/Chrome profile, so no tabs, bookmarks or extensions), and shuts the service down by itself after you quit. If Python is missing it offers to install it for you with `winget`.

- **First launch:** the .exe isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**. You only have to do this once.
- **Quitting:** use the **⏻** button in the top bar or **Quit to desktop** in the park's pause menu. Alt+F4 also works. While the game is locked in, a quick **Esc** goes to the game (pause). To leave fullscreen without quitting, **hold Esc** or press **F11**.
- **Options:** put a `data/launcher.json` next to your save, for example `{"windowed": true}`. Keys: `windowed`, `kiosk` (no way out except Alt+F4), `port`, `browser` (path to a Chromium browser), `python` (path to python.exe), `idle_exit_seconds`. The same options work as flags, such as `Afterhours16.exe -windowed`. Launcher problems are logged to `data/launcher.log` and `data/server.log`.
- **Still there:** `start.cmd` works like it did in v0.3 if you'd rather run the service in a visible window.

**macOS / Linux:** `sh start.sh` (Ctrl+C stops it).

**Manual:** `python -m server.app --open`, or run `python -m server.app` and open http://127.0.0.1:8765/. Opening `client/index.html` directly from disk won't work.

**Lock-in.** Press **F11** (or turn on **Settings → Fullscreen lock-in**) and the game takes the whole screen *and* the keyboard: the right-click menu, Ctrl shortcuts and browser keys can't pull you out mid-game. Since v0.4.5 the game keeps running when you click out of the window; turn **Pause on focus loss** on in Settings if you want it to pause.

Graphics quality is picked automatically from your GPU. To change it, open **⚙ Settings** and choose Low, Medium, High or Ultra. You can also turn on the FPS counter there.

## Modes

**MyPLAYER.** You create a player by picking a position, one of 8 archetypes (Sharpshooter, Slasher, Playmaker, Lockdown, Two-Way, Glass Cleaner, Stretch Big, Post Scorer), height, weight, wingspan, shooting hand and looks. Your build sets a cap for each of the 22 attributes, and you spend VC to raise attributes up to those caps. Badges (18 of them, Bronze → Hall of Fame) level up from what you do in games, for example contested makes, dunks, assists, ankle-breakers and blocks. You can save up to four players per account. Since v0.4.5 every build tops out at **90 OVR**; each of your first 5 Hall of Fame badges brings **5 cap breakers** (+1 each to a maxed-out attribute, past the cap), a build holds up to **7** Hall of Fame badges, and the 7th unlocks your archetype's **Icon badge**. Each badge tier is a big step up from the last, and a stat with none of its badges plays 10% weaker.

**The Park.** Pick your affiliation once: Harbor Kings, Old Brick Society or Foundry Rivets. Each one has its own park (seaside, downtown night, industrial), with its own background life: people walking and jogging past, traffic or sailboats, and random events every half minute or so. Depending on the park those are an elevated train, a helicopter with a searchlight, flocks of birds, a speedboat, a freight train, a container crane at work, welding sparks or steam. You walk around in third person while AI regulars play live games on **six courts**: three full courts for 3v3, two 2v2 half courts on the west side and a 1v1 court on the east side. Every court has three rows of squad spots (**GOT NEXT**, **2ND**, **3RD**): stand in the first open row with your squad to get in line, and everyone moves up a row when the Got Next group goes on. Losers are put off the court and have to walk back around to the end of the line. Park-goers join your squad, and people sit on the benches and stand on the sidelines to watch, reacting to the big plays. AI-only games fast-forward through dead balls (and run faster when you can't see them). Park-goers never wander onto a court while a game is on.

- **A persistent AI world (v0.4.4):** every account has its own population of 900 AI hoopers. Each one keeps the same name, build, height, badges, Rep, animations and fit, plus a home park and playing habits: morning runs, lunch breaks, after school, evenings, night owls, weekend warriors and grinders. Who is at the park depends on who is online right now on your computer's clock. Evenings are packed. At 5 a.m. a court or two may sit empty. People log on and walk in from the plaza, and people who log off walk out. When the park is too quiet to fill your game, a regular who was about to come on hops on early.
- **Skill you can see:** AI hoopers come in five tiers: Casual, Regular, Hooper, Elite and Park Legend. The tier drives attributes (about 55 OVR for a typical casual, mid-80s for a legend), how many badges they carry and at what tier, their Rep, how flashy their gear and animations are, and their **basketball IQ**. IQ sets how fast they read the floor, how good their shots and passes are, when they reach for steals, and how often they hit green. In simulated games a Hooper team beat a Regular team 6 of 6 by about 8, and a Park Legend team beat Regulars by about 11.
- **Social phone: LB + RB (L1 + R1), or O on the keyboard.** It works in the park and in the menus (there's also a **Social** button in the top bar and in the pause menus). It has four tabs:
  - **Park:** everyone online at your park, with a small circle showing their **overall and position** and what they're doing ("Playing on Court 2 · 3-game streak", "Got next on Court 1", "Watching the games").
  - **Friends:** who's online now, and for the rest when they're usually on.
  - **Squad:** up to four friends.
  - **Recent:** everyone you've played with or against, with your record together.

  Tap anyone to see their card: build, tier, Rep, badges, habits, home park and your history together. **Add** players you enjoyed playing with, then **Invite** them to your squad whenever they're online and not in a game. Squad mates follow you around the park, step into your Got Next line first, and suit up with you in Pro-Am. After every game the results screen lists everyone from that game so you can add them right there.

- **Rules:**
  - **3v3 is full court:** a jump ball, inbounds after scores, a 24-second shot clock.
  - **2v2 and 1v1 are half court:** check ball at the top, take it back past the arc after a change of possession.
  - All park games are 2s and 3s, first to 11, 15 or 21.
- **Win streaks:** win and you can **Run it back**. Each straight win multiplies the VC *and* Rep you earn: ×1.0 for the first win, then +0.15 per win, up to ×2.5 at an 11-game streak. The results card shows your multiplier.
- **Your Rep:** goes up from Rookie 1 through Pro, All-Star and Superstar to Legend.
- **The plaza:** three kiosks stand side by side.
  - **Daily Spin:** a prize wheel you can spin once every 24 hours. VC comes in five tiers (500, 2,500, 10,000, 50,000, and a very rare 250,000 jackpot), and some slices hold exclusive gear and animations you can't buy in the store. The odds are shown on the wheel.
  - **VC Store.**
  - **Boosts:** 2K17-style boosts by category (Shooting, Finishing, Playmaking, Defense, Rebounding, Athleticism). Each adds +5 to every attribute in its category, up to 99, for 1, 3 or 5 games. A boost game is used when a park or Pro-Am game tips off.
- **Shootaround:** hit the practice hoop by the 1v1 court.

**The King Tut Cup (v0.4.5 park event).** A glow-in-the-dark park among the pyramids — neon court lines, sphinxes, obelisks, a mini-golf strip and laser-tag barriers — where every game is an ante-up. Pick a stake (500 to 10,000 VC) when you claim a spot: win and you take the other side's stake too, boosted by your Cup win streak, on top of the normal game VC; lose and the stake is gone. Each Cup runs for 48 hours and ranks the most VC won against the AI hoopers who entered it. The winner gets the glow-in-the-dark mo-cap suit, and the top finishers get exclusive shoes, a celebration, a headband and VC. In every park, a 3-game win streak lights a wall of fire around the court (it grows at 6, 9 and 12 wins); in the Cup it's green lasers instead. Since the v0.4.5 quick patch the fire is live and procedural: one continuous wall all the way round with no repeating picture, about 1.4 m tall at 3 wins, 2.2 m at 6, 3 m at 9 and 3.8 m at 12, brighter and fuller at each step, and it eases in as it grows.

**Crews and the Crew HQ (v0.4.5).** Start a crew with up to 39 of your friends (name, tag and color), from the Crew HQ building on any park's plaza or the social phone's Crew tab. Crews level from 1 to 40 (level rewards are coming soon). Every game you play earns crew XP — about 30% of the Rep it pays, ×1.1 in the park, ×1.3 in Pro-Am, ×1.5 in park events, and doubled when a crew member runs with you — and your members earn it too whenever they play, even while you're away. Inside the HQ: a full court and a shootaround court in your crew's colors, your online members hanging out and getting shots up, the members and level boards, and practice 5-on-5 runs once four members are on. Interior customization is coming soon.

**The Pro Run (v0.4.5).** A career in the Afterhours Pro League. Pick a college and play three games — how you play sets your draft slot (two rounds of 32), and the team holding it takes you. Then an 82-game season against 31 other teams with full rosters, a play-in, four playoff rounds and the Finals, with awards at the end. Play your games in the arena or sim them, and set the sim your way: quarter length, difficulty, your minutes, playoff series length, play-in on/off, upsets and home court. Games you play pay VC and badge progress at 1.5x the park rate. No music, like Pro-Am.

**Pro-Am.** The arena has announcers at the scorer's table who follow the ball and react to big plays, baseline photographers with flashes, a camera operator, subs on both benches and a courtside row. The crowd stands and throws its arms up on big plays, claps through dead balls and free throws, starts a wave now and then, and gives a standing ovation at the final buzzer. Your squad suits up with you, and open spots go to regulars from your AI world who fit the position. You build a team identity: name, abbreviation, colors, logo shape and floor wood. That branding is painted on the arena court, the LED boards, the jumbotron and your uniforms. You then play organized 5v5 with a tip-off, quarters of 2, 3 or 5 minutes, a shot clock, inbounds, fouls and free throws, and overtime if it's tied. Your team's record is saved.

**VC Store.** The store has 156 original items (plus 10 Daily Spin exclusives and 5 King Tut Cup prizes): jerseys, tees, compression tops, hoodies, shorts, joggers, nine sneaker models (each with its own textured design), socks, headbands, sleeves, leg sleeves, knee pads, wristbands and chains. It also sells animations: jumpshot bases, release timings, dunk packages, layup packages, size-up packages and celebrations. You can try items on in the studio before buying. Some items need a certain overall, Rep tier or attribute, the way 2K16-era unlocks did (a windmill dunk package needs Driving Dunk 82, for example).

v0.4.4 adds 16 animation packages.
- **No requirements:** Kick Out and Wide Stance jumpshot bases, Feather, Dart and Rainbow releases, the Rim Rocker dunk package, the Rhythm size-up package, and Too Easy, Salute and Hand on Heart celebrations.
- **With requirements:**
  - Sniper base: 75 overall, 80 three point.
  - Laser release: 85 three point.
  - Contact Dunks: 80 driving dunk, 70 strength.
  - High Flyer: 85 overall, 90 driving dunk, 85 vertical, All-Star Rep.
  - Ankle Taker size-up: 80 overall, 90 ball handle.
  - Crown celebration: 80 overall.

**v0.4.5 adds 32 more animation packages** and a new **layup** slot, so every drive finishes the way you picked.
- **Jumpshot bases:** Fadeaway, Hitch, Slingshot, Scissor Kick, Knee Tuck, Sway.
- **Releases:** Wave, Statue, Snatch Back, Old School, Point, Cobra.
- **Dunk packages:** Hammer, Liberty, Scoop, Hand Switch, Half Spin (a full 180° turn in the air) and **Eastbay** (between the legs), which needs 87 overall, 92 driving dunk, 90 vertical and Superstar Rep.
- **Size-ups:** Pound, Snake, Crab, Stutter, Showtime.
- **Celebrations:** Goggles, Dust Off, Airplane, Mic Drop, Take a Bow, Roar.
- **Layups:** Basic (free), Euro Step, Finger Roll, Scoop.
- **Every package is its own** (the v0.4.5 final pass). Each jump-shot base carries the ball on its own path (Silk, the Daily Spin base, no longer shares Skyline's). Each release has its own follow-through, release time and launch angle, held for its full time even after you land. Each dunk package has a signature finish no other package has: the store shows it first and it's about half of the package's dunks in games. Rim Rocker, Contact Dunks, Showtime and High Flyer got new signature finishes. Each size-up has its own dribble height, width, rhythm and in-place combos.
- **Icon badge animations** can't be bought at all: your archetype's Icon badge brings its own. Sharp Eye's jumper and fanned follow-through, Hash-Slinging's wind-up dunk, Oprah's one-handed whip pass, The Clamp's two-hand clamp, The General's salute, Big Brother's cocked-arm swat, Open Arms' two-hand rebound rip and Sexy Red's post back-down.

**v0.4.5 look.** Jerseys are cut on curves — a U-shaped scoop in front, a shallower one in back, wide straps and deep armholes — with a rolled binding around the neck and armholes, so they no longer look strapless. Shorts have a rolled hem that folds back to the leg, so a driven knee can't show the inside of them. Players are a touch slimmer through the chest and waist. In the parks the shops are real buildings with a counter, stocked shelves, an awning and a worker inside; the trees, palms, benches, bins and street lamps were all rebuilt; and the sea at Harbor Point has moving swells, a surf line and sailboats with real hulls and sails.

The **gold chain** and the **iced-out chain** now have real textured links and a pendant (a "16" medallion, or rings of stones that catch the light).

**Stats (v0.4.4).** A new menu tab, also in every pause menu, shows **lifetime stats** for each player you've built:
- games, W-L and minutes;
- PPG, RPG, APG, SPG, BPG and turnovers;
- FG%, 3P%, FT%, eFG% and TS%;
- totals and highlights (greens, dunks, posters, ankle breakers…);
- a split for All games, Park and Pro-Am, and a table comparing all your builds.

**Auto-play** (H) now plays your player **the way your numbers say you play him** (since v0.4.5 it also stays on from one game to the next until you press H again):
- shot volume and how many of those shots are threes;
- passing, steals, boards and blocks per game;
- how often his twos, threes and free throws go in.

With no games yet it plays like your build. After about 20 games it's mostly your numbers. The Stats screen shows this profile.

**Locker Codes (v0.4.4).** A new menu tab. Enter **HELP-I-NEED-VC** for 250,000 VC. It works 3 times per account. Codes aren't case sensitive.

**Soundtrack (v0.4.4, 25 tracks since v0.4.5).** The tracks you supplied (in `client/audio/music`) play shuffled through the menus, the park, park games and practice. They sit a little lower under park games and fade out for Pro-Am, where the arena has its own sound, then pick up where they left off. A **Now Playing** ticker in the bottom-left corner shows the title for the first few seconds of each track. To fill in artist names, edit `client/audio/music/tracks.json`. Music on/off and volume are in Settings.

**Practice.** Shoot around in an indoor gym with a rebounder feeding you so you can learn your green window. Or play 1-on-1 against an AI defender to practice size-ups and step-backs. Practice pays no VC or Rep.

**About the starting VC:** like Milestone 1, every new account gets a one-time grant of **1,000,000 fictional VC**, enough to max any legal build. If you'd rather grind from nothing, start the service with `python -m server.app --welcome-vc 0` before creating your account. Existing wallets are never changed.

## Controls

Controllers are first-class in v0.4. Any controller Chrome/Edge sees with the standard layout works: Xbox, PlayStation (DualShock 4 / DualSense) or Switch Pro. Button prompts switch to your controller's symbols automatically, and the whole menu system works with the D-pad or left stick (**A** select, **B** back, **LB / RB** switch tabs). Plug in or press a button at any time and the game swaps over. Keyboard and mouse still work everywhere.

| Action | Keyboard / mouse | Controller (Xbox names) |
|---|---|---|
| Move / sprint | WASD / Shift | Left stick (analog: walk → jog) / RT |
| Shoot: hold, release at the top (a green always goes in inside 35 ft; outside the window it almost never does; never while smothered) | Hold Space or left mouse | Hold X |
| Bailout: pass out of your jumper any time before the release | Pass key while shooting | A while shooting |
| Attack the rim: your better finish, dunk or layup (a layup is timed: hold, let go at the top) | Hold Z | Right stick down while sprinting, held |
| Pump fake | Tap Space | Tap X |
| Pass (aims with your stick) / bounce / lob / alley-oop | E / R / T / Y | A / B / Y / RB+Y |
| Icon pass to a teammate (the input shows over each teammate's head) | 1–4 | LB + face button |
| Crossover · in-and-out / hesitation · step-back | ← → / ↑ ↓ | Flick right stick left/right / up/down |
| Spin / behind-the-back | Q / F | Rotate right stick / flick down while moving |
| Call screen / call for ball | C / E without the ball | Tap LB / A |
| Defensive stance | Hold Q or right mouse | Hold LT |
| Steal / block or rebound / hands up | F / Space / R | X / Y / right stick up |
| Defensive hands: reach left or right · low swipe · hand in the lane | ← → · ↓ · hold ← → | Flick right stick left/right · down · hold left/right |
| Celebrate / camera / all controls | G / V / Tab | D-pad up / View / click right stick |
| Pause / fullscreen lock-in | Esc / F11 | Menu / — |
| Social phone (park and menus) | O | LB + RB (L1 + R1) |
| Park: look around / interact | Right-drag / E | Right stick / A |

**Remap anything:** open **Settings → Remap buttons…**, pick an action, then press the new key, mouse button or controller button. Keyboard and controller bindings are separate, offense and defense actions can share a button (like the defaults do), a ⚠ marks two actions fighting over one button, and **Reset to defaults** undoes it all. The controls list in Settings and the in-game Tab overlay always show your current bindings.

On offense the right stick is for dribble moves and attacking the rim. There's no stick shooting. Since the v0.4.5 quick patch, every push out of the middle is a move at any frame rate and sweeping straight across works. Moves come out quickly, and quicker with a better Ball Handle and Speed with Ball; call the next one and it cuts in once the current move is 60% done. Mixing moves in quick succession costs no stamina, while repeating the same one does. When a drive with the stick held down ends in a layup, keep holding and let the stick come back at the top to time it. On defense it's **your hands**, like older 2K games:
- **Flick left or right:** reach with that hand. The hand on the ball side has a much better chance. The wrong hand fouls more.
- **Flick down:** a low swipe at a low dribble.
- **Hold up:** hands up to contest.
- **Hold to a side:** keeps a hand in that passing lane, for more deflections.

**Settings → Controller & window** also has vibration on/off, stick deadzone, prompt style, inverted park camera, lock-in, the Locked-In grade display and pause-on-focus-loss.

**Settings → Shot meter / Shot feedback** (both on by default). Turn the meter off and your green window gets **10% wider**. With the meter on or off, and with any jumpshot base or release, the middle of the green window is the exact moment the ball leaves your hands. Shot feedback is the grade and percentage that pops up over your player after a shot.

**The shot meter** (v0.4.5 quick patch) is a slim bar next to your player that fills as you shoot. The window on it is drawn to scale from the same numbers that grade your release, so letting go anywhere inside it is an Excellent release and anywhere outside isn't, with the contest measured live:
- **Solid green** in the middle is the window your ratings give you on their own.
- **Fading out to yellow** around it is what boosts add: badges (Green Machine, Deadeye under a contest, Limitless Range from deep, Catch & Shoot, Corner Specialist, Contact Finisher on layups), your Icon badge, a Shooting Takeover and a forgiving jumpshot base or layup package. Releasing in the yellow is still a green.
- **Solid** means a green there always goes in (jumpers inside 35 ft, free throws). **Outlined** means perfect timing, but not an automatic make: layups, and shots from past 35 ft.
- **Outside the window** a shot almost never goes in: 3% at most slightly early or late, half a percent badly off, whatever your rating.
- **No window:** you're smothered (the bar turns red) or you're past half court. Close shots aren't timed, so they get no meter.
- The middle of the window is the moment the ball leaves your player's hand, for every jump-shot base, release, layup package and build: the ball never floats up out of his hand.
- After the release, the bar stays for a moment, frozen where you let go, with the marker colored by the grade. The Tab overlay has a legend.

## How it plays

- **Movement has weight.** Speed, acceleration, braking and turn rate come from height, weight and attributes. Hard cuts plant the foot, and bigger players move slower but bump harder.
- **Responsive by design.** Every button press is buffered until the simulation can use it, so nothing gets dropped on 120/144 Hz monitors or while an animation finishes. The stick is always relative to the camera as you see it: when the 2K cam swings round on a change of possession, a held stick swings with it, so up is always up the screen. Passes, catches and steals lock you out for less time than in v0.3.
- **Faster.** Movement, animation and the ball run 15% faster than v0.3, and v0.4.4 adds another 3.75% on top (×1.193 overall). Game and shot clocks still count real seconds, and timing windows are scaled so the green feels the same.
- **v0.4.5 game feel:** game speed is 1.85% lower than v0.4.4 (×1.171 overall) and passes travel about 1% slower, with softer starts and turns. Stamina now matters: sprinting drains the most, every action costs a little, and standing, walking or posting up recovers. Repeating the same dribble move or the same mistake drains you faster; good plays and a high Lock-In grade give it back. Go **on fire** (3 straight greens or finishes at the rim: a flame under your feet) or **cold** (4 missed open shots: an ice crystal), and earn a position **takeover** (PG/SG shooting, SF/PF finishing, C boards and blocks) with 6 clean plays in a row. Traveling is called in every mode, the defense contests and blocks from 3.75% further, and only the Posterizer badge knocks defenders down.
- **v0.4.5 final touches:**
  - **Out of bounds is called on the painted lines,** like a regulation game, on every court. A ball touching the floor on or past a line is out, and so is a player with a foot on or over one. The half-court line is the back line in half-court games, and over the top of a backboard is out.
  - **Green windows are 10% smaller** everywhere: jumpers, free throws and layups.
  - **Every layup is timed.** Hold the shot button through the gather and let go at the top; the meter shows the window. Each layup package has its own timing (Scoop early, Basic, Euro Step after its long second step, Finger Roll late), and your Layup rating sets the window. A green layup is a big boost, not a sure thing.
  - **Layups react to the defense:** a reverse around a shot blocker at the rim, carried and finished away from a defender on your side, a hang and double-clutch into a defender in your path, and quick and high ahead of a chaser. Each has its own timing.
  - **Jumpers have different timings:** running jumpers come out quicker, step-backs and fadeaways a little slower, and threes a touch slower than mid-range jumpers.
  - **Better collision:** the ball can't be dribbled through anybody any more, and bodies don't overlap in a crowd.
  - **Tuning:**
    - AI players are 10% smarter in every tier.
    - The game runs 0.75% slower.
    - Everything that drains stamina costs twice as much: sprinting, jumpers, layups, dunks, passes, dribble moves, reaching and jumping. Screens now cost some too.
    - The rebound and block assist is 3.75% stronger.
  - **The King Tut Cup courts** have a sphinx at center court.
  - **Alley-oops only go to teammates who can get there.** Anyone further out gets a regular lob.
  - **AI that attacks after an ankle-breaker:** slashers, playmakers and bigs go to the rim; shooters rise up. Fewer pointless kick-outs.
  - **No more hitching in the parks.** People arriving and courts rotating used to build new players mid-frame, worst at the King Tut Cup; they're now reused or built a slice at a time.
- **v0.4.5 quick patch:**
  - **Snappier dribble moves:** every move is quicker, more so with a better handle (a point guard's crossover: 400 → 304 ms at 55 with the Basic size-up, 328 → 200 ms at 99 with Elite Handle; wings' moves are 5% slower than that, bigs' 10%). The next move cuts in 60% of the way through the current one. Combos of different moves are free; spamming the same move still costs stamina.
  - **Deep shots are luck:** past 35 ft the make chance fades fast, Limitless Range included, and the green window shrinks away. Past half court it's at most 1% (a 99 three-point shooter), with no green window.
  - **Attack-bind layups are timed:** hold Z or the right stick down through the gather and let go at the top, same as the shoot button.
  - **Finishing follows your best rating:** the attack bind no longer dunks whenever it can, and shoot-button drives no longer give the dunk a head start. The higher of Driving Dunk and Layup wins; on an exact tie your archetype decides.
  - **A new shot meter** that shows your exact green window: solid green for what your ratings give, fading to yellow for what boosts add, outlined where a green isn't an automatic make.
  - **Timing is everything:** a release outside the green window almost never goes in, and every window is another 6.5% smaller. The contest bites 5% harder on the window in every guarded tier.
  - **The release point is where the ball leaves his hand**, on the body model, for every build and animation, so the middle of the green window is the release you see.
  - **Stats under 70 aren't proficient:** 10% less effective across the board, and a 10% smaller green window for a shooting stat under 70.
  - **The game runs 3.75% slower**, and everyone moves 7.45% slower with the ball. Dribble moves come out 10% slower for PFs and Cs and 5% slower for SFs and SGs, and then 5% slower for everyone.
  - **Icon pass inputs over teammates' heads** for whatever you're playing with, and **shot feedback shows how guarded you were** ("62% guarded · Contested").
  - **Dunks don't go into slow motion any more:** the slam hits harder instead, thrown straight down through the rim, with a follow-through.
  - **Smarter AI in every tier:** better shot selection, mixed-up dribble moves, aware of stamina, takeovers and hot hands.
  - **Streak effects show on the right court:** yours from the moment you step up to play (it used to wait for the tip-off, and could light up the last court you played on instead), and kings who beat you show their real streak.
  - **Streak fire redone:** an animated, procedural wall of fire all the way round the court that grows at each milestone (3, 6, 9, 12 wins). The old one was a flame picture repeated every couple of metres, and it glitched as it scrolled.
- **Ratings matter more at the ends (v0.4.4):**
  - **Under 70:** effectiveness drops off steeply. A 55 shooter's green window is about two thirds of a 70's, and it shrinks further below that. Since the v0.4.5 quick patch a stat under 70 isn't proficient: it plays 10% less effective across the board (skills and physical attributes alike), and a shooting stat under 70 has a 10% smaller green window for that shot.
  - **Over 95:** extra weight on top.
  - **99:** a different class. The green window is about 1.65× a 95's. An open 99 layup or free throw is about 97%, and an open 99 three that isn't badly mistimed is about 90%. Only the defense (whose contest scales with the defender's own ratings) or fatigue brings it down.
  - **Contested shots:** every contested state shrinks the green window 3.75% more than before (open shots are unchanged).
- **Brick Wall (v0.4.4)** only fires where it should:
  - **Bumps:** on defense only.
  - **Screens:** on either end.
  - Never on a jump shot or a landing, so an open three can't set it off.
- **Shooting is timed, and greens are guaranteed.** An Excellent (green) release always goes in unless the shot is blocked. Difficulty doesn't lower that chance. It shrinks the green window instead: a hand in your face, shooting on the move, fading, or pulling up from deep all make the green harder to hit, and the meter shows the live window. When you're **smothered** (the meter outline turns red), there is no green at all, so pass out of it. Moving away from the hoop, your player turns and fades; otherwise he squares up to the rim before he rises. Early or late releases cost a lot, and Very Early or Very Late releases mostly miss. Every shot then flies as a real ball: drag, backspin, rim and backboard collisions, a cloth net, and bank shots near the glass. Makes and misses are decided first, then a matching trajectory is solved, so a miss rattles out and a make drops.
- **Movement and animation follow real measurements.** Jump-shot depth, release height and hang time, running stride, cadence and ground-contact time, and landing absorption use numbers from published basketball and running biomechanics (see `docs/FIDELITY.md`).
- **Finishing:** layups, finger-rolls, dunks (tomahawk, windmill and flight packages), alley-oops, putbacks, posters and chase-down blocks. Driving at the rim with the shoot button takes **the finish you're best at**: Driving Dunk, Layup, or a pull-up (Mid-Range) from a little further out. The defense adjusts it: a shot-blocker waiting at the rim favors a finesse layup, and a defender walling off the lane favors a pull-up. The separate **attack-the-rim** bind (Z, or right stick down while sprinting) takes the better of your dunk (Standing Dunk right under the rim) and your layup, as long as a dunk is physically possible. On an **exact tie**, your archetype decides: Slashers, Glass Cleaners and Post Scorers dunk; Playmakers, Sharpshooters, Stretch Bigs, Lockdowns and Two-Way players lay it in.
- **Dunks are physical.** Your hands have to actually reach the rim. If a body stops you short, it becomes a flip at the rim instead of a teleport-dunk.
  - Finishing through contact depends on Driving or Standing Dunk plus Close Shot, against the defender's size, strength and Interior D.
  - A **Posterizer** shoves the defender back or knocks him to the floor for a few seconds, and the dunker never passes through him.
- **Ball physics:** rim contacts deflect a little differently each time, so rebounds come off the iron unpredictably (the made/missed result stays exact). A good reach **pokes the ball away** from the dribbler, sideways and low, and he's a beat late to recover it.
- **Badges you can see:** when one of your badges changes a play, a banner at the top of the screen shows the badge and its tier. Several in a row queue in the order they fired.
- **Passing:** passes leave the hand faster and fly faster the better your Pass Accuracy. They lead the receiver and bend slightly toward where he really is, within a small limit, so they're not heat-seeking and a hard cut or a jumped lane still beats them. Teammates no longer pick off each other's passes. In simulated Pro-Am games, about 98% of passes now reach their target.
- **Rebounding:** players read where the ball will really come off the rim and glass, time their jumps to meet it, and box out. Defenders hold the box-out until the ball comes off the iron and start with inside position, so the offensive rebound share fell from about 50% to the low-to-mid 30s.
- **Defense, especially in the paint (v0.4.3):**
  - In the lane, a contest is weighted mostly by **Interior D and Block**, and size and length count for more there. Outside, **Perimeter D** carries it.
  - Shot blockers **travel at the ball** when they leave their feet. How far they get depends on Block, and in the paint on Interior D and height too. Rim protectors also challenge from further out and time their jumps better. On jump shots the closeout goes straight up.
  - **Box-outs:** a player boxing out is harder to move the higher his Interior D is, and harder still against someone with lower Interior D. Winning the rebound depends more on the rebound rating, size and that seal.
  - Perimeter D also speeds up your defensive slide and adds to steal chances.
- **Builds play to type:** each archetype's strengths and weaknesses now apply at 1.12× (v0.4.4 trimmed them 20% from 1.4×), and the AI plays its archetype.
  - Slashers attack the rim and cut. Sharpshooters relocate to the open spot on the arc. Playmakers dribble and pass first, and want the ball back.
  - Stretch bigs pop to the arc off screens and rotate to fill gaps on defense. Glass cleaners anchor the paint, help first and crash the glass. Post scorers back their man down. Lockdowns press the ball.
  - AI hoopers now carry badges that fit their archetype, and AI shooters judge closeouts better, so there are fewer forced, smothered jumpers.
- **Animation packages look and play differently:**
  - **Jumpshot bases:** each has its own set point, legs in the air, lean and feel (the Quick Flick is fastest, the Push Shot most forgiving, Skyline and Silk release highest, the Lean Back has the tightest window).
  - **Releases:** each has its own follow-through (Snap, Float, High, Quick, Butter and Classic).
  - **Dunk packages:** higher packages need higher dunk ratings and are much flashier. They take off from further out, hang longer and add 360s, cradle jams and double clutches. They also **posterize harder**: a bigger shove, more knockdowns and a longer time on the floor.
  - **Size-up packages:** Quick and Elite make moves faster and chain them quicker, add in-place crossover and between-the-legs combos with shoulder jabs while you size up, and break more ankles.
- **Clothes and accessories never clip (v0.4.4):** tops are built to drape over the body (chest, back, glutes) and to hang outside the shorts. Pro-Am jerseys tuck in cleanly. Shorts and joggers never sit tighter than the thigh. Headbands sit on top of any hairstyle, including high tops and curls. Wristbands, arm sleeves over compression, and knee pads over joggers sit on top of the fabric. An arm sleeve under a hoodie, or a leg sleeve under joggers, is left out instead of poking through. A small per-layer depth bias settles the rest.
- **Game presentation:**
  - **Intros:** park games open with each team in turn, every player with his build, overall and top 3 badges. Pro-Am intros show all five players per team with their most-used badge. Press shoot or pass to skip ahead.
  - **Outro:** after every park and Pro-Am game, a full box score for every player, then a **Rep bar** that fills in real time (rank-ups included) before the results / Run it back screen.
- **Locked-In grade:** a teammate grade (F to A+, starting at C+) in the top-right of every game mode. Smart plays raise it: assists, good contests, rebounds, steals, blocks, screens and good shots. Costly ones lower it: turnovers, forced or badly timed shots, leaving your man open, fouls and holding the ball too long. Each change pops up under the grade, and the results card shows your final grade.
- **AI:** the AI reads the floor on a short reaction delay. When you **call for the ball** while open, it passes almost instantly. It only holds the ball, and keeps probing, when the passing lane is clogged. AI shooters smothered in the air will bail out to an open teammate. It attacks the open shoulder on drives, kicks out when help comes, runs screens and rolls, cuts and boxes out. Defenders contest, help and gamble on steals.

## Keep your save

1. Stop the old version and back up its `data` folder.
2. Copy that `data` folder into this version's folder, replacing the empty one.
3. Start v0.4.4.

On first launch v0.4.4 adds two small tables: locker code redemptions, and your AI world's seed, friends, squad and recent players. It also starts per-mode stat splits from your next game on. Lifetime totals from earlier games still show under "All games". Everything else carries over as-is: players, VC, items and streaks. A v0.2 save still works too: its players are converted to the 22-attribute schema, with old ratings mapped onto the new attributes and capped to your build. Items you already bought stay owned and equipped. No extra VC is granted. Any game still in progress at upgrade time is cancelled with no reward, as before.

## Tests and tools

```sh
python -m unittest discover -s tests     # builds, caps parity with the client, save migration, rewards, launcher endpoints, full HTTP journey
node --test tests/geometry.test.mjs tests/sim.test.mjs   # mesh winding, shot planning, full park and Pro-Am games
node tools/sim_batch.mjs park 6          # balance report: FG%, 3P%, dunks, blocks, steals, turnovers per game
node tools/sim_world.mjs tiers 6         # v0.4.4: skill-tier matchups from a persistent AI world (win rates, margins)
```

## Project layout

```
client/            WebGL2 game (ES modules, no dependencies)
  js/gfx/          renderer: PBR shading, shadows, reflections, HDR bloom, ACES, FXAA, instancing, GPU skinning
  js/char/         procedural athletes, clothing, skeleton, IK rig, animator
  js/sim/          60 Hz game simulation, ball physics, shot model, AI, builds and ratings
  js/world/        parks, Pro-Am arena, gym, hoops and nets
  js/game/         match session, park hub, cameras, HUD, showroom
  js/ui/           menus: home, builder, MyPLAYER, VC Store, Park, Pro-Am, Practice, Stats, Locker Codes, social phone
  audio/music/     the soundtrack (tracks.json lists titles / artists)
server/            Python stdlib HTTP service + SQLite (accounts, wallet, store, progression, match tickets)
launcher/          Afterhours16.exe source (Go, standard library only)
tests/             Python and Node test suites
tools/             simulation batch runner for balancing
data/              your save database (created on first launch)
```

See `docs/ARCHITECTURE.md` for how the pieces fit together, `docs/FIDELITY.md` for an honest list of what this is and isn't, and `docs/V0.5-PLAN.md` for the planned graphics and motion-capture overhaul.

To rebuild the .exe (needs Go 1.22+), run `cd launcher && GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui -s -w" -o ../Afterhours16.exe .`. The icon and version info come from `launcher/rsrc_windows_amd64.syso`.
