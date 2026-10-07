# Architecture (v0.4.4)

## Overview

```
 Afterhours16.exe (Go launcher) ─ starts ─┬─▶ Python service, hidden, --exit-when-idle
                                         └─▶ Edge/Chrome --app window, fullscreen, own profile

 Chrome / Edge app window                          Python service (stdlib only)
 ┌───────────────────────────────────────┐        ┌──────────────────────────────────┐
 │ ui/  menus, store, builder, results   │  JSON  │ app.py      HTTP + static files  │
 │ game/ park hub · match session · cams │◀──────▶│ builds.py   caps, costs, migrate │
 │ sim/  60 Hz rules, ball, shots, AI    │        │ progression rewards, Rep, badges │
 │ char/ athletes, rig, animator         │        │ database.py SQLite WAL, ledger,  │
 │ world/ parks, arena, gym, hoops, nets │        │             idempotency keys     │
 │ gfx/  WebGL2 renderer                 │        └──────────────────────────────────┘
 └───────────────────────────────────────┘                    data/afterhours.sqlite3
```

v0.2 ran the match on the server at 30 Hz and streamed state to the page. v0.3 moves the simulation into the client at a fixed 60 Hz step. Input reaches the sim on the next frame, the ball and players are interpolated, and there's no network jitter. The server still owns everything that matters for progression:

1. `POST /api/matches` issues a **ticket**: id, random seed, mode, target score or quarter length, difficulty, current park streak. Starting a new game forfeits any unfinished one.
2. The client plays the game with that seed and sends a **summary**: score, winner, duration, the user's stat line.
3. `POST /api/matches/<id>/complete` validates the summary (`progression.validate_summary`):
   - points must equal 2·FGM + 3PM + FTM
   - makes can't exceed attempts
   - the player can't outscore the team
   - park games must reach the target, and Pro-Am games must have a winner
   - the duration must be physically possible, and the reported game time can't be longer than the real time since the ticket was issued

   Only then does the server compute VC, Rep and badge progress itself and write everything in one transaction. Every mutation uses an idempotency key, so retries never double-pay.

This is a single-player game against AI on your own machine. The checks stop accidents and casual tampering, not a determined cheater, and nothing here needs anti-cheat.

## Launcher (`launcher/`)

`Afterhours16.exe` is about 480 lines of Go using only the standard library, cross-compiled with `-H windowsgui`. Icon and version resources come from a prebuilt `.syso`.

1. **Python:** finds Python 3.10+ in this order: `launcher.json` or `-python`, a bundled `python/` folder next to the game, `py -3`, `python`, `python3`, then the usual install folders. If none is found, it offers a per-user `winget install Python.Python.3.12` (or the python.org page).
2. **Service:** reuses a running Afterhours service on the port (`/api/health` returns `app: afterhours16`). Otherwise it picks a port, starts `python -m server.app --exit-when-idle 45` with no console window, and waits for it to be healthy. Output goes to `data/server.log`.
3. **Window:** opens Edge (preferred) or Chrome with `--app=<url>?launcher=1 --start-fullscreen` and a dedicated `--user-data-dir=data/browser-profile`, plus flags that stop background throttling.
4. **Running:** with `?launcher=1` the client pings `/api/ping` every 5 s.
5. **Shutdown:** the service stops once the pings have stopped for 45 s. A gap of more than 20 s between watchdog ticks counts as the PC sleeping, not as an idle window. **Quit to desktop** posts `/api/quit`, which is only accepted from loopback when the service was started by the launcher. The service then exits with code 3, and the launcher closes the browser window it opened.

## Input (`client/js/core/input.js`, `game/session.js`)

- **Buffering:** keyboard, mouse and gamepad edges are collected per render frame. `MatchSession.captureInput()` keeps them in a small buffer with a time-to-live, and `stepIntent()` hands each 60 Hz simulation step one consolidated intent. A press is consumed when the simulation acts on it (`game.humanActed`), so render frames with zero sim steps (high-refresh displays) or a busy animation never drop it.
- **Stick basis (v0.4.3):** in games, movement is relative to the camera's current framing of the play (`CameraRig.updateLiveBasis`), ignoring highlight punch-ins and shake and damped exactly like the camera. When the 2K cam swings round on a change of possession, a held stick turns with it and "up" stays up the screen. Earlier versions latched a rest basis while the stick was held, so after a possession swing the stick pointed the old way, which is what ran players off the court. In the park roam the basis is the roam camera's yaw.
- **Gamepads:** the standard mapping with radial deadzones and analog triggers. Right-stick gestures are classified into flicks (dribble moves), rotations (spin) and down-while-sprinting (attack the rim); v0.4.2 removed stick shooting. LB tap and LB+face are told apart. Rumble uses `vibrationActuator` dual-rumble, the controller family is detected from the id string for glyphs, and `ui/padnav.js` provides spatial focus navigation for menus.
- **Social combo and defensive hands (v0.4.4):** `pollGamepad` raises `socialEdge` when LB and RB are both down (the second bumper's press), and marks LB as used so it doesn't also call a screen. `ui/padnav.js` switches menu tabs on bumper *release*, so the combo doesn't flip tabs. On defense, `Input.defStick()` turns right-stick flicks into reaches (left, right, low), and holds into hands up or a hand in a lane. The arrow keys do the same. `MatchSession` maps them through the live stick basis into `intent.stealDir`, `stealLow`, `handsUp` and `handsSide`.
- **Lock-in:** `core/lockin.js` combines `requestFullscreen({navigationUI: 'hide'})` with `navigator.keyboard.lock()`. The context menu and Ctrl shortcuts are suppressed, and focus loss auto-pauses.

## Rendering (`client/js/gfx`)

The renderer is written from scratch (no Three.js or other libraries) and forward-renders in HDR.

- **Shading:** GGX/Smith PBR with a hemisphere ambient term and a prefiltered environment map. Skin uses wrapped diffuse with subsurface tint, cloth uses a sheen lobe, and the floor shader blends planks or asphalt with the painted court overlay.
- **Shadows:** a directional shadow map that follows the action, with texel snapping and 10-tap PCF.
- **Reflections:** planar reflections for hardwood and the showroom floor (mirrored camera with a clip plane).
- **Post-processing:** a multisampled RGBA16F target, then bloom (13-tap down, tent up), ACES tonemap, vignette, grade and FXAA.
- **Draw-call savings:** instancing for the arena crowd, static geometry batched by material, and GPU skinning with 24 bones per character.
- **Quality tiers:** Low to Ultra set resolution scale, MSAA, shadow size, reflections and bloom. `autoQuality` picks a tier from the GPU string.
- **Procedural textures:** every texture is drawn on canvas at load time (`textures.js`): wood, asphalt, court paint and logos, chain-link, brick, concrete, facades, murals, LED boards and jerseys. The download contains no image files.

## Characters (`client/js/char`)

- **Model:** a 21-bone skeleton sized from height, wingspan and weight.
  - The torso is a superellipse loft with anatomical bump fields: pecs, deltoids, scapulae, abdomen and glutes.
  - Limbs use anthropometric radius profiles that overlap at the joints, and hands have five articulated fingers.
  - The head is a face-weighted spherical grid sculpted through a `FACE` layout, with carved eye openings, separate eyeballs, ears and a natural hairline. Hair is alpha-tested strands.
  - Clothing meshes follow cut rules.
  - Textures are painted procedurally: a face atlas built from cached feature masks, per-tone body skin, and tiling detail normal maps for skin, jersey mesh and knit.
  - Faces are 1024² for your player and 512² for everyone else.
- **Rig:** forward kinematics for the spine, analytic two-bone IK for arms and legs, palm orientation and look-at.
- **Animator:**
  - a gait whose step length, cadence and duty factor follow measured walking and running data
  - world-locked planted feet; walking (inverted-pendulum) and running (spring-mass) centre-of-mass motion
  - pelvis rotation and drop, and lean that follows acceleration
  - a defensive shuffle
  - ball-hand IK that follows the simulated ball
  - procedural bodies for every action: jumpers in phases (dip, triple extension, flight, release just before the apex, follow-through), layups, four dunk packages, rim hang, passes, steals, blocks, rebounds, stumbles and ankle-breaks, size-ups and celebrations
  - a landing spring-damper on hip height, kicked by the touchdown speed
  - the measured ranges are listed in `FIDELITY.md`

## Simulation (`client/js/sim`)

- **`ball.js`:** a rigid ball with gravity, drag and Magnus lift from spin. It collides with a torus rim, the box backboard, the connector and the floor, slows when passing through the net, and detects scores.
- **`shots.js`:**
  - grades the release from timing error against an attribute- and badge-dependent window
  - computes a contest value from defender distance, angle, height and reach
  - `finalChance` combines base percentage, grade, contest, movement, fatigue, badges and hot streaks
  - `planShot` pre-simulates candidate trajectories (aims, arcs, bank shots) until the physical outcome matches the rolled make or miss
- **`player.js`:** momentum-based locomotion. A sharp cut plants the foot, and turn rate, acceleration and stamina come from the build.
- **`game.js`:** the park rules (check ball, take-it-back, first to N), Pro-Am rules (tip, quarters, shot clock, inbounds, fouls, FTs, OT), plus actions, blocks, steals, rebounds, interceptions, collisions, screens and the stat book.
- **`ai.js`:** per-player utility decisions on a perception delay that scales with difficulty. Handlers weigh shoot, drive, pass, probe and (v0.4.3) post-up. Drives attack the defender's open shoulder and react to help. Off-ball players space, screen, roll or pop, cut and relocate. Defenders mirror the ball, help, contest, box out and chase rebounds. v0.4.3: every choice is weighted by archetype tendencies (`bots.js tendenciesFor`).
- **Defense weighting (v0.4.3):**
  - `shots.paintWeight(d)` blends perimeter and interior rules: 1 at the rim, 0 beyond about 4.4 m.
  - `shots.defSkill` uses Perimeter D outside and Interior D + Block (+ Rim Protector) in the paint.
  - `game.anchorK` scales collision mass for box-outs and paint anchors.
  - `startJump` stores a lunge toward the ball for blocks and rebounds.
- **Packages (v0.4.3):**
  - `shots.BASE_FEEL` / `jumpshotPackage` (speed, window, release height, release style per base).
  - `shots.DUNK_TIER` / `STYLE_FLAIR` / `dunkSpin` (dunk tiers, flashy styles, the 360 spin shared by the sim's ball path and the animator).
  - `player.sizeupLvl` / `moveSpeed` (size-up packages: move speed, chaining, ankle odds, size-up dribble rhythm in `updateBall` / `holdPoint`).

- **Rating curve (v0.4.4):** `ratings.rk(v)` is the effect curve every system uses (imported as `n` in shots/game/ai and `pd` in player). It's linear through the middle, drops off steeply under 70, adds weight over 95 and jumps at 99 (0.95 → 1.32). Physical attributes use a gentler local version. `shots.timingWindowMs` follows it, and `finalChance` puts a floor under 99-rated shots that aren't badly mistimed, before the contest is applied.
- **Basketball IQ (v0.4.4):** `AI.iq(p)` uses the player's own IQ (world accounts) nudged by difficulty, or the difficulty for anyone without one. It drives reaction time, option-value noise, pass-risk weighting, contested-shot discipline, green odds, closeout reads (`skill`), pump-fake bites, steal timing and hand choice.
- **Auto-play profile (v0.4.4, `sim/profile.js`):** `statProfile(char, mode)` blends archetype tendencies with tendencies derived from the player's per-mode career numbers (weight gp/(gp+4)). It also gives shrunk 2P/3P/FT targets. `Game` attaches it to the human player, `AI.tend` uses it under auto-play, and `releaseTiming` scales green odds so the percentages land near the targets.

## AI world and social (v0.4.4)

- **`sim/world.js`, `AIWorld`:** one per account (`app.ai`), seeded from the server's `ai_world` row.
  - **Accounts:** `account(id)` is a cheap header: tier, habit, position, level, IQ, home park, Rep and session shape. `entry(id)` generates the full player with `bots.makeBot`, deterministically per seed and id. Gear goes through `canEquip`, the server's own rules.
  - **Schedules:** `sessions(id, day)` gives the account's sessions for a local day, cached. `status`, `online`, `onlineAt(park)`, `nextOnline` and `statusText` answer who is on and where. `extra` holds regulars who "hopped on early".
  - **Social state:** friends, squad (online friends only, max 4), `met` (with/vs/wins/last) and `recordGame`. Changes are saved through `/api/ai-world` with a short debounce (`initWorld`).
- **`game/park.js`, `ParkHub`:**
  - **Filling the park:** `availableHere` (online here, not busy, not squad) and `takeEntries(n, {level, exclude, topUp})` fill courts, lines and challengers. `newBackgroundGame` leaves a court empty when there aren't enough people.
  - **Coming and going:** `populationTick` (every 20 s) sends logged-off walkers out and brings arrivals in.
  - **Squad:** `syncSquad` keeps followers (Walker `follow` slot) in step with the squad, and squad followers fill Got Next first.
  - **Phone data:** `parkList` builds the phone's park list with what each person is doing.
  - **Records:** `myGameOver` and Pro-Am's `onEnd` call `recordGame`.
- **`ui/phone.js`:** the phone modal: Park/Online, Friends, Squad and Recent tabs, player cards, add, invite and kick. `main.js` toggles it on the `social` action outside live games. The top bar and pause menus have buttons for it.
- **`core/music.js`, `Soundtrack`:** reads `audio/music/tracks.json` and plays a shuffled queue on one `<audio>` element.
  - **Volume:** fades follow `settings.musicVol`. `duck(true)` sits at 65% under park games, and `setSuppressed(true)` fades out and pauses for Pro-Am, resuming the same track afterwards.
  - **Ticker:** `showTicker` draws the bottom-left now-playing ticker.
  - **Streaming:** the server serves mp3s with Range support.

## Presentation and world life (v0.4.3)

- **`game/present.js`:** the `GameIntro` used by `MatchSession`. It saves positions, lines up one team at a time in front of a sideline dolly camera, plays celebrations and shows the lower-third cards (`hud.setIntro`), then restores everything exactly. The simulation doesn't step during the intro, and shoot or pass skips ahead.
- **`ui/outro.js`:** `playOutro` shows the box score as a modal while `/api/matches/:id/complete` is in flight, then animates the Rep bar from `rep_before` to `rep_after` (using `config.rep_thresholds` for rank-ups) before the results card.
- **`world/parklife.js`:** per-theme background population (instanced-geometry walkers, vehicles, boats, a crane) and a random-event scheduler (trains, helicopter with a temporary spot light, birds, boats, sparks, steam, planes). Event geometry is cached, and meshes are removed from the scene when an event ends.
- **Arena crew** (`venues.js arenaCrew`): announcers, photographers and the camera operator are driven by `venue.update(dt, {ball, phase, over, events})`. The crowd's moods go to the instanced crowd shader through the `uCrowd` uniform (`scene.crowdFx`: wave, clap, wave speed, ovation).
- **Sneakers:** `AthleteModel.buildShoe` builds a separate UV-mapped `shoes` mesh. `looks.paintShoe` paints a per-design texture, shared by everyone wearing the same shoe.
- **Clothing clearance and chains (v0.4.4):**
  - **Drape:** `torsoPoint` separates positive body bulges from grooves. Garments (hang ≥ 0.5) get all the bulges and none of the grooves, so the body can't poke through.
  - **Tops and shorts:** `buildTop` keeps untucked hems outside the shorts' profile and tucked hems inside it (hang can vary with height). Shorts and joggers are clamped to at least the thigh's radius.
  - **Gear:** `buildGear` drops gear a garment fully covers and lifts worn-over gear above the fabric.
  - **Chains:** `buildChain` lays a link tube and pendant over the top's fabric. `looks.paintChain` / `paintPendant` texture them.
  - **Depth bias:** `Material.layer` adds a small polygon offset per layer outside the shadow pass (shorts 2, top 3, gear 4, shoes and chain 5).

## Server (`server/`)

- **Dependencies:** none beyond the Python standard library. The service serves static files from `client/` (never `dev/`, never outside `client/`) with explicit MIME types.
- **Requests:** JSON-only POSTs with a same-origin check and rate-limited login and registration.
- **Accounts:** scrypt password hashes and HttpOnly, SameSite=Strict session cookies.
- **Wallet:** each change runs in one transaction with an append-only ledger row, so the balance always equals the sum of the ledger.
- **Migrations:** `001` creates the schema, `002` adds court selection (v0.2), `003` adds modes, match metadata and Pro-Am teams, `004` (v0.4.2) adds the daily spin table, and `005` (v0.4.4) adds `locker_redemptions` and `ai_world`. Characters are converted to the current schema when the service starts (`builds.normalize`, idempotent).
- **v0.4.4 endpoints:**
  - `/api/locker-codes/redeem` checks the per-account limit, credits the wallet in the same transaction and is idempotent per request key.
  - `/api/ai-world` saves the sanitised social state. `progression.ai_world` validates the seed, ids, squad ⊆ friends and caps met at 400.
  - `apply_progress` now also writes per-mode `career_modes` splits.
- **Build rules:** `builds.py` mirrors `client/js/sim/builds.js` and `ratings.js`. A test runs both and checks that they agree.
