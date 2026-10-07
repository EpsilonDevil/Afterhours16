# Afterhours 16 — v0.4.4

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

**Lock-in.** Press **F11** (or turn on **Settings → Fullscreen lock-in**) and the game takes the whole screen *and* the keyboard: the right-click menu, Ctrl shortcuts and browser keys can't pull you out mid-game. If you do Alt+Tab away, the game pauses itself (**Pause on focus loss**, on by default).

Graphics quality is picked automatically from your GPU. To change it, open **⚙ Settings** and choose Low, Medium, High or Ultra. You can also turn on the FPS counter there.

## Modes

**MyPLAYER.** You create a player by picking a position, one of 8 archetypes (Sharpshooter, Slasher, Playmaker, Lockdown, Two-Way, Glass Cleaner, Stretch Big, Post Scorer), height, weight, wingspan, shooting hand and looks. Your build sets a cap for each of the 22 attributes, and you spend VC to raise attributes up to those caps. Badges (18 of them, Bronze → Hall of Fame) level up from what you do in games, for example contested makes, dunks, assists, ankle-breakers and blocks. You can save up to four players per account.

**The Park.** Pick your affiliation once: Harbor Kings, Old Brick Society or Foundry Rivets. Each one has its own park (seaside, downtown night, industrial), with its own background life: people walking and jogging past, traffic or sailboats, and random events every half minute or so. Depending on the park those are an elevated train, a helicopter with a searchlight, flocks of birds, a speedboat, a freight train, a container crane at work, welding sparks or steam. You walk around in third person while AI regulars play live games on **six courts**: three full courts for 3v3, two 2v2 half courts on the west side and a 1v1 court on the east side. Stand in a **Got Next** circle to claim the next game. Park-goers join your squad, and when the current game ends you play the winners. Park-goers never wander onto a court while a game is on.

- **A persistent AI world (v0.4.4):** every account has its own population of 900 AI hoopers. Each one keeps the same name, build, height, badges, Rep, animations and fit, plus a home park and playing habits: morning runs, lunch breaks, after school, evenings, night owls, weekend warriors and grinders. Who is at the park depends on who is online right now on your computer's clock. Evenings are packed. At 5 a.m. a court or two may sit empty. People log on and walk in from the plaza, and people who log off walk out. When the park is too quiet to fill your game, a regular who was about to come on hops on early.
- **Skill you can see:** AI hoopers come in five tiers: Casual, Regular, Hooper, Elite and Park Legend. The tier drives attributes (about 55 OVR for a typical casual, mid-80s for a legend), how many badges they carry and at what tier, their Rep, how flashy their gear and animations are, and their **basketball IQ**. IQ sets how fast they read the floor, how good their shots and passes are, when they reach for steals, and how often they hit green. In simulated games a Hooper team beat a Regular team 6 of 6 by about 8, and a Park Legend team beat Regulars by about 11.
- **Social phone: LB + RB (L1 + R1), or O on the keyboard.** It works in the park and in the menus (there's also a **Social** button in the top bar and in the pause menus). It has four tabs:
  - **Park:** everyone online at your park, with a small circle showing their **overall and position** and what they're doing ("Playing on Court 2 · 3-game streak", "Got next on Court 1", "Watching the games").
  - **Friends:** who's online now, and for the rest when they're usually on.
  - **Squad:** up to four friends.
  - **Recent:** everyone you've played with or against, with your record together.

  Tap anyone to see their card: build, tier, Rep, badges, habits, home park and your history together. **Add** players you enjoyed playing with, then **Invite** them to your squad whenever they're online. Squad mates follow you around the park, step into your Got Next line first, and suit up with you in Pro-Am. After every game the results screen lists everyone from that game so you can add them right there.

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

**Pro-Am.** The arena has announcers at the scorer's table who follow the ball and react to big plays, baseline photographers with flashes, a camera operator, subs on both benches and a courtside row. The crowd stands and throws its arms up on big plays, claps through dead balls and free throws, starts a wave now and then, and gives a standing ovation at the final buzzer. Your squad suits up with you, and open spots go to regulars from your AI world who fit the position. You build a team identity: name, abbreviation, colors, logo shape and floor wood. That branding is painted on the arena court, the LED boards, the jumbotron and your uniforms. You then play organized 5v5 with a tip-off, quarters of 2, 3 or 5 minutes, a shot clock, inbounds, fouls and free throws, and overtime if it's tied. Your team's record is saved.

**VC Store.** The store has 123 original items (plus 10 Daily Spin exclusives): jerseys, tees, compression tops, hoodies, shorts, joggers, nine sneaker models (each with its own textured design), socks, headbands, sleeves, leg sleeves, knee pads, wristbands and chains. It also sells animations: jumpshot bases, release timings, dunk packages, size-up packages and celebrations. You can try items on in the studio before buying. Some items need a certain overall, Rep tier or attribute, the way 2K16-era unlocks did (a windmill dunk package needs Driving Dunk 82, for example).

v0.4.4 adds 16 animation packages.
- **No requirements:** Kick Out and Wide Stance jumpshot bases, Feather, Dart and Rainbow releases, the Rim Rocker dunk package, the Rhythm size-up package, and Too Easy, Salute and Hand on Heart celebrations.
- **With requirements:**
  - Sniper base: 75 overall, 80 three point.
  - Laser release: 85 three point.
  - Contact Dunks: 80 driving dunk, 70 strength.
  - High Flyer: 85 overall, 90 driving dunk, 85 vertical, All-Star Rep.
  - Ankle Taker size-up: 80 overall, 90 ball handle.
  - Crown celebration: 80 overall.

The **gold chain** and the **iced-out chain** now have real textured links and a pendant (a "16" medallion, or rings of stones that catch the light).

**Stats (v0.4.4).** A new menu tab, also in every pause menu, shows **lifetime stats** for each player you've built:
- games, W-L and minutes;
- PPG, RPG, APG, SPG, BPG and turnovers;
- FG%, 3P%, FT%, eFG% and TS%;
- totals and highlights (greens, dunks, posters, ankle breakers…);
- a split for All games, Park and Pro-Am, and a table comparing all your builds.

**Auto-play** (H) now plays your player **the way your numbers say you play him**:
- shot volume and how many of those shots are threes;
- passing, steals, boards and blocks per game;
- how often his twos, threes and free throws go in.

With no games yet it plays like your build. After about 20 games it's mostly your numbers. The Stats screen shows this profile.

**Locker Codes (v0.4.4).** A new menu tab. Enter **HELP-I-NEED-VC** for 250,000 VC. It works 3 times per account. Codes aren't case sensitive.

**Soundtrack (v0.4.4).** The 20 tracks you supplied (in `client/audio/music`) play shuffled through the menus, the park, park games and practice. They sit a little lower under park games and fade out for Pro-Am, where the arena has its own sound, then pick up where they left off. A **Now Playing** ticker in the bottom-left corner shows the title for the first few seconds of each track. To fill in artist names, edit `client/audio/music/tracks.json`. Music on/off and volume are in Settings.

**Practice.** Shoot around in an indoor gym with a rebounder feeding you so you can learn your green window. Or play 1-on-1 against an AI defender to practice size-ups and step-backs. Practice pays no VC or Rep.

**About the starting VC:** like Milestone 1, every new account gets a one-time grant of **1,000,000 fictional VC**, enough to max any legal build. If you'd rather grind from nothing, start the service with `python -m server.app --welcome-vc 0` before creating your account. Existing wallets are never changed.

## Controls

Controllers are first-class in v0.4. Any controller Chrome/Edge sees with the standard layout works: Xbox, PlayStation (DualShock 4 / DualSense) or Switch Pro. Button prompts switch to your controller's symbols automatically, and the whole menu system works with the D-pad or left stick (**A** select, **B** back, **LB / RB** switch tabs). Plug in or press a button at any time and the game swaps over. Keyboard and mouse still work everywhere.

| Action | Keyboard / mouse | Controller (Xbox names) |
|---|---|---|
| Move / sprint | WASD / Shift | Left stick (analog: walk → jog) / RT |
| Shoot: hold, release at the top (a green always goes in; never while smothered) | Hold Space or left mouse | Hold X |
| Bailout: pass out of your jumper any time before the release | Pass key while shooting | A while shooting |
| Attack the rim: dunk if you can, otherwise your best finish | Z | Right stick down while sprinting |
| Pump fake | Tap Space | Tap X |
| Pass (aims with your stick) / bounce / lob / alley-oop | E / R / T / Y | A / B / Y / RB+Y |
| Icon pass to a teammate | 1–4 | LB + face button |
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

On offense the right stick is for dribble moves and attacking the rim. There's no stick shooting. On defense it's **your hands**, like older 2K games:
- **Flick left or right:** reach with that hand. The hand on the ball side has a much better chance. The wrong hand fouls more.
- **Flick down:** a low swipe at a low dribble.
- **Hold up:** hands up to contest.
- **Hold to a side:** keeps a hand in that passing lane, for more deflections.

**Settings → Controller & window** also has vibration on/off, stick deadzone, prompt style, inverted park camera, lock-in, the Locked-In grade display and pause-on-focus-loss.

**Settings → Shot meter / Shot feedback** (both on by default). Turn the meter off and your green window gets **10% wider**. With the meter on or off, and with any jumpshot base or release, the middle of the green window is the exact moment the ball leaves your hands. Shot feedback is the grade and percentage that pops up over your player after a shot.

## How it plays

- **Movement has weight.** Speed, acceleration, braking and turn rate come from height, weight and attributes. Hard cuts plant the foot, and bigger players move slower but bump harder.
- **Responsive by design.** Every button press is buffered until the simulation can use it, so nothing gets dropped on 120/144 Hz monitors or while an animation finishes. The stick is always relative to the camera as you see it: when the 2K cam swings round on a change of possession, a held stick swings with it, so up is always up the screen. Passes, catches and steals lock you out for less time than in v0.3.
- **Faster.** Movement, animation and the ball run 15% faster than v0.3, and v0.4.4 adds another 3.75% on top (×1.193 overall). Game and shot clocks still count real seconds, and timing windows are scaled so the green feels the same.
- **Ratings matter more at the ends (v0.4.4):**
  - **Under 70:** effectiveness drops off steeply. A 55 shooter's green window is about two thirds of a 70's (27 ms vs 42 ms), and it shrinks further below that.
  - **Over 95:** extra weight on top.
  - **99:** a different class. The green window is about 1.65× a 95's. An open 99 layup or free throw is about 97%, and an open 99 three that isn't badly mistimed is about 90%. Only the defense (whose contest scales with the defender's own ratings) or fatigue brings it down.
  - **Contested shots:** every contested state shrinks the green window 3.75% more than before (open shots are unchanged).
- **Brick Wall (v0.4.4)** only fires where it should:
  - **Bumps:** on defense only.
  - **Screens:** on either end.
  - Never on a jump shot or a landing, so an open three can't set it off.
- **Shooting is timed, and greens are guaranteed.** An Excellent (green) release always goes in unless the shot is blocked. Difficulty doesn't lower that chance. It shrinks the green window instead: a hand in your face, shooting on the move, fading, or pulling up from deep all make the green harder to hit, and the meter shows the live window. When you're **smothered** (the meter outline turns red), there is no green at all, so pass out of it. Moving away from the hoop, your player turns and fades; otherwise he squares up to the rim before he rises. Early or late releases cost a lot, and Very Early or Very Late releases mostly miss. Every shot then flies as a real ball: drag, backspin, rim and backboard collisions, a cloth net, and bank shots near the glass. Makes and misses are decided first, then a matching trajectory is solved, so a miss rattles out and a make drops.
- **Movement and animation follow real measurements.** Jump-shot depth, release height and hang time, running stride, cadence and ground-contact time, and landing absorption use numbers from published basketball and running biomechanics (see `docs/FIDELITY.md`).
- **Finishing:** layups, finger-rolls, dunks (tomahawk, windmill and flight packages), alley-oops, putbacks, posters and chase-down blocks. Driving at the rim with the shoot button **prefers a dunk** when you can dunk. If your layup or pull-up rating is clearly better, that's the finish you get. The defense matters too: a shot-blocker waiting at the rim favors a finesse layup, and a defender walling off the lane favors a pull-up. The separate **attack-the-rim** bind (Z, or right stick down while sprinting) always dunks when it's physically possible.
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
