# RIMRIFT — v0.4.8.9

## New in v0.4.8.9: The Gauntlet

Full list in `PATCH_NOTES_v0.4.8.9.docx`. Design contract: `docs/GAUNTLET.md`.
- **The Gauntlet:** a turn-based basketball deckbuilder roguelike (Home → The Gauntlet). Four stats (Stamina = energy, Shooting, Defense = Stops, Health for the run), combos and Flow, Depth/Tight deck-size cards, 22 random match rules, three bracket phases (matches, Rivals, Coolers, Boost Shops, Mystery Stops) and a boss each, then the Final. The game plays out on a cinematic court above the cards. A nemesis system remembers the characters you meet across runs (grow, regress, remember, betray, ally). VC 140/300/900/2000 per match/Rival/boss/Final, capped at 8,000 per run and 180 per minute.
- **Park cards:** sacrifice up to three ICON 99 builds (after 1, 3 with 3 players, and 5 completed runs) to make them permanent Gauntlet players and earn Common +1%, Rare +3% and Legendary +5% account-wide park boosts to an attribute from the sacrificed Icon. Park games only.
- **Also:** a subtler ICON aura at levels 3 and 4; event park streak VC 75% smaller; the Favelas bandana no longer clips through the head.
- **Quick patch 3 (memory + performance):** fixes the GPU memory leak (every place you left kept its scene on the graphics card: about 77 MB per lap of park, Crew HQ, Pro-Am HUB, a match venue and the Gauntlet court; now flat). Shared caches are leased with idle budgets (`world/release.js`: venues 384 MB, athlete look textures 96 MB; a 400-look churn went from 1.2 GB to a flat 120 MB). Also: allocation-free hypot in render code, nets 70% cheaper, the score bug no longer rebuilds every frame, ground textures painted on a worker after sign-in and about 2× faster, a particle ring buffer, fewer sim allocations (bit-identical). Server: `RIMRIFT_DB_SYNC=normal` by default (WAL + a sync about every second; `full` restores per-commit sync), migration 019 indexes, a cached `/api/config` catalog, pruned parkdir tables, and two long-running Node replay workers (`docs/REPLAY-WORKER.md`, ready for park/Pro-Am checks after the port).
- **Quick patch 2 (QOL + Performance):** no gameplay change (identical seeded results in every mode; mixed qp1/qp2 players can play together). About 25% cheaper player posing, 28% fewer GL calls per frame, allocation-free particles, 2–5× faster park re-entry (cached court overlays and facades), shared hair textures, 2.2× faster AI player builds, ~9% faster Pro-Am sim, ~6× faster `/api/me` on the server, a pruned sign-in rate limiter, dead code removed, file headers and section maps throughout. `node tools/golden.mjs out.json` fingerprints every deterministic system for future refactors.
- **Quick patch 1:** the online server replays every Gauntlet run with an optional Node.js helper and pays only what the replay earned (✓ Verified on the summary); without Node it falls back to the count checks. The server installs Node itself (`deploy/`); player-hosted PCs need nothing.

## Earlier: v0.4.8.8

## New in v0.4.8.8: The Pro-Am Overhaul

Full list in `PATCH_NOTES_v0.4.8.8.docx`. Design contract: `docs/PROAM-OVERHAUL.md`.
- **Pro-Am teams and seasons:** create or join a Pro-Am team (search every team on the server, player and AI); 45-day seasons, Season 1 from the moment the server runs v0.4.8.8, everyone in Bronze.
- **Series:** Bronze 3 games (first to 2), Silver 5 (first to 3), Gold+ 7 (first to 5), each game matchmade (real teams within 2 divisions first, AI teams after ~45 s), alternating home and away at the 12 new Pro-Am parks. A series win promotes the team a division (3 to Silver, 5 to Gold, 7 to Platinum); a loss resets RP to 0 and demotes anyone already at 0.
- **GM draft:** the Captain drafts AI players from a clipboard (5 at a time, 3 free refreshes per series).
- **Pro-Am HUB:** a building in every park, or from the menu: Bronze middle-school gym, Silver high-school gym, Gold clubhouse (customizable, with a walk-out to the home park and 3s there), each with an office (whiteboard, clipboard, queue).
- **Rank rewards:** +2/+4/+5% VC and Rep in every mode (not stacking), rank icons by names, Gold/Platinum borderplates, the PRO-AM Chain, Gold Low-Top Canvas, Platinum PRO Watch and Headband, record over head, season banners.
- **Realism (Pro-Am only):** no Icon effects (animation packages stay), badges and the overall gap 10% smaller, 10% harder.
- **Got Next:** AI can't hold a spot until they're standing on it.

## Earlier: v0.4.8.7

## New in v0.4.8.7: the server runs the park

Full list in `PATCH_NOTES_v0.4.8.7.docx`.
- **One park online:** the online server keeps every park's time and order of events, and every player's game works the park out from them, so friends see the same courts, games, lines, ICON Squad and park-goers. No player hosts the park any more (no handover jumps, less work per PC). `RIMRIFT_PARK_DIRECTOR=0` on the server restores v0.4.8.6's host mode.
- **Results checked:** online park and Pro-Am results must match the other players' before anything pays; a mismatch voids the game for everyone in it and returns the ante. Offline and solo play are unchanged.
- **Quick patch 1:** Lockdowns' Hall of Fame badges are defensive: Deadeye, Catch & Shoot and Corner Specialist stop at Silver; Rebound Chaser reaches Hall of Fame, Chasedown and Brick Wall at every height, Rim Protector from 6'3" and Pick Pocket at 7'1"+. Lockdowns above the new caps are lowered to Silver on load (progress, earned cap breakers and an unlocked Icon badge kept).
- **Quick patch 2:** real players can't walk onto a court with a game in progress (an edge you stop at; anyone already on it when the game starts is walked off to the nearest sideline), like the park-goers.
- **Quick patch 3:** green layups go in: the shooter stays at the finishing distance while he has the ball (no drifting under the rim on a late one), shot planning never counts the rim's underside as a make and plans with the layup's real spin, and a green with no clean path goes through like a green jumper.
- **Quick patch 4:** everyone at a park sees other players' games in progress, with their models (late arrivals catch up; a player's own game is shown too); activated badges show the tier you really have (your badges go out online as soon as a tier changes).
- **Quick patch 5:** auto-play (H) in online Pro-Am, per seat, the same on every screen (AUTO by your name); still off in other online games.
- **Quick patch 6:** Pick Pocket and Interceptor need 30% fewer steals at every tier (Pick Pocket 11/35/84/175, Interceptor 14/42/105/210); steals already made count on the next profile load.

## New in v0.4.8.6: the RIMRIFT identity

The game's identity is **RIMRIFT** (full list in `PATCH_NOTES_v0.4.8.6.docx`).
- **Title screen:** the game opens on its own title screen (key art, logo, MAKE YOUR OWN GRAVITY). Enter with a click, Enter/Space/Esc or a fresh A/Start press; Settings → Title screen shows it again.
- **New look:** the menus use the new palette (Ember #FF4D24, Bone #F3EEE4, Carbon #080A0D), with gold kept where it means something (VC, Gold badges, Hall of Fame, ICON). The logo is vector.
- **New name:** RIMRIFT appears in the menus, the arena, the Pro Run league (RIMRIFT Pro League), the soundtrack and the branded store gear. Item ids are unchanged.
- **Unchanged:** gameplay and saves; mode names stay until the Godot rebuild (see the v0.5 roadmap).
- **Quick patch 5:** one shared AI world for everyone online; no Hall of Fame limit (builds already past a badge's requirements get it on load); every chain looks unique; quarters don't change possession in Pro-Am and the Pro Run; a solid green window on wide-open threes for 85+ three-point shooters; R2 + right stick down + Square forces a dunk on a drive with any build.
- **Quick patch 6:** ICON builds can respec their cap breakers from the Cap Breakers tab: the first respec on each build is free, every one after costs 250,000 VC, and the option only opens once that build has reached 99 OVR ICON status.
- **Quick patch 7:** smooth menus (the wheel never lags, lists keep their place, one click is enough); Attack the rim forces a dunk with any build and Sprint + Shoot at the rim forces a layup (the R2 + RS down + Square combo is gone); park and Crew HQ emotes show for other players; the server picks the park's host; Icon badge items show only on the build that unlocked them (new Pass Package: Oprah); every Icon badge pops on screen when it makes the play.
- **Quick patch 4: The Favelas and the park shuffle.** The Favelas take over from The Monster Mash at 8 PM ET on Oct 19: a hillside favela with stacked houses, alleys, people, animals, dirtbike riders and police chases, random events, a kite streak effect and seven new rewards (the Morro Kit, Ladeira hi-tops, the Passinho, Hillside Bandana, Pipa, Cuíca). From Oct 21 all five event parks play in a no-repeat shuffle, 48 hours each.
- **Quick patch 3: RIMRIFT everywhere.** The launcher is now **RIMRIFT.exe**, with the RIMRIFT icon (delete the old launcher file and remake any shortcut to it). The bug reports file, the save file, the start/host/join windows, the arena and the server console all carry the name; your save and settings move over by themselves.
- **Quick patch 2: the opening.** Every start now plays the Silverback Studios logo (a gleam across the silver, a cinematic ding and a flash, a push in to black), then "Tusk" over the RIMRIFT concept cinematic from the media kit, then the loading screen, then the title screen with Tusk still playing; entering fades it into the soundtrack. The logo and the cinematic can be skipped.
- **Quick patch: the season reset.** At 12:00 AM Eastern on Monday Oct 19 (9 PM Pacific on Sunday) every account starts over: builds, VC, every item (event items too), crews and the AI world are wiped, every locker code is retired, and everyone signs back in to a fresh account with 250,000 VC and the free basics. Accounts, sign-ins, real-player friends and the online link stay. New accounts start with 250,000 VC too. Each copy (and the online server) resets itself the first time it runs after that moment, after a backup copy of its save (`data/backups`). An open game warns 10 minutes and 1 minute ahead, then reloads. (Oct 19 fix: a game left open over the reset could save its old AI world, with its AI friends, back before reloading; that's refused now, and any that got back is cleared when the game next starts.)
- **Quick patch: the ICON Squad.** About every 9 hours (9 hours after the last one, 10 to 30 minutes early or late, a different amount each time), a full squad of three of your world's AI ICONs (99 OVR, by the same rules as yours) shows up at Harbor Point, the Old Brick Yard or Foundry Works for an hour. They wear one outfit, play a handler, a wing and a big on three different archetypes, hold a 3v3 court while they win and get back in line when they lose. There's only ever one squad across the three parks, and no other AI team has three ICONs. A toast, the Park screen and the phone tell you where they are. A world needs three ICONs first (about six to eight weeks). The same patch lowers Hall of Fame **Brick Wall** to 173 successful screens (45% fewer) and Hall of Fame **Posterizer** to 126 dunks (30% fewer). This is the last change to the baseline before the port.


An original street-and-arena basketball game inspired by the feel of the 2015-era sim-arcade basketball games: weighty movement, timed jumpers, size-ups, posters, and a social hub where you walk up to a court and call next. You get a 3D WebGL2 client built from scratch for this version and a small Python/SQLite service that saves your players, VC wallet, Rep, badges and Pro-Am team.

All art, names, courts, gear and animations are original and generated in code. There are no NBA or 2K assets, logos or trademarks, no accounts anywhere but on your own PC, and no real-money purchases. VC is fictional. Since v0.4.7.5 quick patch 3 friends can play together online, on the game's own online server or on a PC that hosts the game (see **Play online with friends**).

## New in v0.4.8.5

Parks, ranks and a lot of small things (full list in `PATCH_NOTES_v0.4.8.5.docx`):

- **Three parks rebuilt:** Harbor Point stands on sand among about 140 palms. The Old Brick Yard sits in a real street grid with crossings, signals, shopfronts, lit windows with people and blinds in them, taxis, a bus and police cruisers (with the odd chase). Foundry Works is surrounded by a power plant, an oil field, a refinery and a container port, under a low rolling fog.
- **Pro-Am ranks:** every build climbs from **Bronze** through Silver, Gold, Platinum, Diamond and Master to **Grandmaster** on RP (ranked points). Each game's RP comes from the result, how strong the other team was, and how you played. Online, friends run Pro-Am together if they're within **2 ranks** of each other.
- **Home park until Pro 1:** a new build plays at its own park until it reaches Pro 1, then every park is open. Park events, the Crew HQ and every other mode are open from the start.
- **Set a screen:** off the ball on offense, **hold B** (R on the keyboard). Your player goes to the ball handler's defender and plants until you let go. Brick Wall now levels up from **successful screens**.
- **Next game by itself:** Pro-Am and the Pro Run start the next game after 10 seconds, as the park does. The Pro Run also has **1-minute quarters**.
- **Badges:** Dimer and Chase-Down Artist need half as much, Rim Protector 35% less, Rebound Chaser 60% less, and Acrobat and Contact Finisher 40% less for Gold and Hall of Fame. A badge whose progress already meets a requirement (Handles for Days counts the games you've played) moves up as soon as you log in.
- **Sharp Eye:** the base hops twice as high (the defense is measured as before), and its pop-up is the same size, animation and length as Hash-Slinging's.
- **Also:** the soundtrack starts on a new shuffle every time the game starts, and the Inventory shows what a build can't equip yet and why.
- **Quick patch: And The Beat Goes On**, the next park event, takes over from The Jungle Ballers when the Jungle's leaderboard closes (Oct 14, 00:00 UTC). It's an 80s city at sundown with retro courts, neon, lowriders, dancers and a disco bar. It has all-new rewards (the Beat Goes On tracksuit, Boombox hi-tops, the Running Man, a terry headband, the Disco Ball green FX and the Eight-O-Eight green sound) and, for the first time, a soundtrack of its own that plays only at its park.
- **Quick patch 2: The Monster Mash**, the park event after that, takes over from And The Beat Goes On when the Beat's leaderboard closes (Oct 16, 00:00 UTC). It's a haunted town on Halloween night: a full moon behind a haunted mansion, graveyard courts, a cemetery, a church, a carnival with a haunted-house ride, a swamp and a witch's cottage, with zombies, ghosts, a werewolf, a vampire and a slasher on the loose, eleven random events and a haunted win streak. It has all-new rewards: the glow-in-the-dark Bone Suit, Coffin hi-tops, the Zombie Shuffle, a jack-o'-lantern headband, the Jack-o'-Lantern green FX and the Haunted Organ green sound.
- **Quick patch 3:** the **ICON status**, the endgame. Unlock every cap breaker, max every badge and reach 99 OVR, and the build gets ICON in front of its archetype everywhere (in the Icon badges' moving spectrum), its Icon badge in place of the ring under it in every mode, and a dark flame aura that appears at a 3-game win streak and grows every 3 wins to its ultimate form at 12. **Open Arms** now does what it says: every board its holder secures is a snag, and Stretch Bigs who unlocked it get a **Rebound Package** of six streetball snags in a new Rebounds category only they can equip. The **Sharp Eye** ball now leaves at the top of its doubled hop. **Y / Triangle** jumps for rebounds off the ball on offense, the park calls **half as many fouls**, and **The Monster Mash** has its own soundtrack (27 tracks from a Halloween party mix, only at its park).
- **Quick patch 4:** the AI keeps playing the park events across a handover. A game left running through a switch used to keep sending the event's players to the park that had just closed, so the new event park looked empty until a restart. The game now follows the whole event schedule, switches its event card and the AI by itself the moment one event hands over to the next, and tells you.
- **Quick patch 5:** every Icon badge now does what it says. **Big Brother** comes with its own Block Package of seven ball-tracking blocks with landing gestures and callouts, and no longer blocks him from his own styles. **The Clamp** has ten exclusive steal animations covering reaches, picked-off passes and strips. **Oprah** throws nine flashy passes (behind the back, no-look, wraparound, between the legs and more), with Speed with Ball reaching his top speed. **The General** has his own salute as an item, and his +2.5% now reaches speed, vertical, strength and stamina. **Sexy Red** gets a real Post Move Package with five back-downs and two signature finishes, and Post Control above 99 counts in the post. ICON builds on fire burn purple around their Icon badge, and passing accuracy above 96 no longer gets worse.
- **Quick patch 6:** Sexy Red's Post Move Package now hits a little harder than the best package in the store, and The Clamp's steal animations are a **Steal Package** in their own **Steals** slot (Inventory and MyPlayer), shown only to a Lockdown who has unlocked The Clamp; with the slot empty he keeps a basic Vise.
- **Quick patch 7:** the AI in your persistent world unlock exclusives as they grind, and wear them. Park Legends and the best Elites earn their archetype's **Icon badge** (and its package), everyone spins the **Daily Spin**, and the top 25 of every closed event leaderboard get that event's **prizes**. An AI who hasn't unlocked anything is unchanged. **Every ICON build opens one more build slot** on your account, from 4 up to **8**, for good.
- **Quick patch 8:** the AI climb past 90 by your rules (Hall of Fame badges, cap breakers, the Icon badge, Icon Legend) up to **99**, and the only ICONs are 99s, rarer the higher you go: about 6–9 AI ICONs in a world two months old, ~44 at six months, ~80 after a year. **Delete a build** from MyPlayer → Players by holding ✕ / A for 5 seconds (an ICON build's slot stays open). Results screens with news and the OVR increase cards move on after 30 seconds (the rest after 10), and **and-ones in the park** always give the fouled team the ball (the callout no longer fires without a foul).
- **Quick patch 9:** Dimer and Brick Wall need 30% less for every tier (Dimer 9/28/70/147 assists, Brick Wall 18/63/154/315 screens); progress you've already made counts as soon as you log in. Holding the **guard stance (L2 / LT)** with nothing else pressed now contests for you when your man shoots: a hand goes up and you step in at a gentle pace, but only if you were already in range and in front when he went up (it never closes out for you, and never jumps).

## New in v0.4.8

Online play, made simple and exact (full list in `PATCH_NOTES_v0.4.8.docx`):

- **Just sign in:** your copy connects to the game's own online server by itself (`online.json`) and asks you to sign in once. **Play offline** and **Connect** are in the Online tab.
- **Green windows stay what you saw:** online, a release is graded on the window and the defense your meter showed when you let go, so a late closeout can't shrink the green after the fact. Your meter stops where you let go, and a let-go during a hitch is still graded where you made it.
- **Less input delay:** round trips are measured finer and games keep less spare, so many start a tick quicker. A player whose inputs arrive late sends his own further ahead, so the others don't freeze. The server relays inputs with about a third less CPU.
- **Fixes:** Name tags off really hides them, offensive three seconds hands the ball over at once, and Pro Run games count toward your max OVR and your badges again (long ones aren't thrown out).
- **Quick patch:** Handles for Days is Hall of Fame at 115 games and Deadeye at 135 contested makes, and five new mixes (almost 8 hours) are on the soundtrack.
- **Quick patch 2:**
  - On 1v1 and 2v2 courts, every defensive rebound, steal and loose ball lights the arc, and nobody can shoot until the ball is taken back behind it.
  - **Sharp Eye** (the Sharpshooter Icon badge) brings its own jumpshot base and release, for that build alone: a quick hop higher than any other base and a crane release at the top. Every green that goes in gets a backflip.
- **The take-it-back glow:** in half-court games a red glow runs along the three-point line while you have to clear it.
- **Layups and blocks:** an open green layup is a sure make with an 85+ Layup, more coverage shrinks a green's boost, and blocks are 3.75% stronger.

## New in v0.4.7.5

The clean-up before the v0.5 graphics and physics overhaul (full list in `PATCH_NOTES_v0.4.7.5.docx`):

- **Cleaner animation:** limbs collide with the body (elbows, hands, head, feet, knees, other players), poses ease on springs with secondary motion, players breathe and shift their weight, and jersey straps always show over the skin.
- **Badges by build:** each badge has a highest tier set by your archetype and height (for you and the AI), new badge art per tier, vibrant Hall of Fame everywhere and Icon badge designs.
- **80 OVR with VC, then 90 through The Pro Run:** +1 max OVR for every 3 Pro Run games; cap breakers unlock at 90 and have their own menu.
- **Shooting:** contests bite harder without the shot's badges, on fire is +3%, takeovers last 90 s at +6, wide-open dunks over 70 never miss, Contact Finisher push-offs, and hustle shots (running pull-ups, running fades, pro hops) with their own timing.
- **The stick:** 14 dribble moves in crossover, behind-the-back, escape, momentum and spin families, each on its own stick combination, 21 named combos, and quicker chaining with a better handle. Aimed passes, physical box-outs, X/Square is a steal on defense.
- **Animations doubled** (30 bases, 32 releases, 28 dunk packages, 20 size-ups, 8 layup packages, 34 celebrations) and **12 movement styles**.
- **Smarter AI:** its own dribble habits, open shots taken, escape dribbles, screens, cuts and relocations, less dead dribbling, cherry-pickers read, Lock-In grades, and overalls that grow (slowly) as they play.
- **Green releases:** 14 sounds and 12 effects in the store (plus a Cup exclusive of each); every AI player has his own. (The quick patch doubles them.)
- **The park:** two GOT NEXT spots per court (first full squad runs next), a live **court overview** on View/Share (V), **bounties** on streaks above 6, a Got Next score ticker, and squads that break up when you close the game.
- **Inventory:** equip what you own away from the store; jump-shot bases and releases are separate categories. Menus and HUD polished.
- **19 new soundtrack tracks** (44 in all) and **Report a bug** (F8): reports go to `RIMRIFT_Bug_Reports.txt` next to `RIMRIFT.exe`.

**v0.4.7.5 quick patch** (the "Quick patch" part of the patch notes):

- **Shooting:**
  - Only Sharpshooters and Stretch Bigs get sure greens from three.
  - Non-shooters' windows are 10% smaller, and every window is 10% smaller again.
  - A smothered shot has no window and never goes in. Finishes are measured on their own scale.
  - A record scratch cuts off a green that's blocked, or timed right into a smother.
  - Contests count at the release, for the AI too.
- **Dribbling:**
  - Moves repeated more than 6 times cost double the stamina penalty.
  - Every stick diagonal does two things (4 new moves, 17 new combos).
  - Dribble moves are 20% slower, and the game is 2.5% quicker.
- **Passing and defense:**
  - Passes are 10% more accurate.
  - Reach-ins are called on contact only.
  - The AI stays in bounds.
  - Defensive assignment arrows show you who to guard.
  - The 2K Cam reads sprint speed evenly in every direction.
- **Icon Legend:** after the Icon badge, every 2 Pro Run games are +1 OVR, up to 99, placed by your build.
- **ICON status (v0.4.8.5 quick patch 3):** every cap breaker unlocked, every badge as high as the build allows (the Hall of Fame slots full, the rest at Gold) and 99 OVR make the build an ICON: ICON before its archetype everywhere, its Icon badge as its floor cursor in every mode, and a dark aura that shows at a 3-game win streak (every mode counts; a loss, forfeit or leaving a game ends it) and grows every 3 wins to its ultimate form at 12. MyPlayer → Badges shows what's left to get there.
- **The look:**
  - Real jersey straps over the shoulders.
  - Fewer repeated dunks across packages, a true windmill, and an Eastbay that really goes between the legs.
  - Celebrations work in games and none clip.
  - Posterizer only fires on a dunk that gets to the rim.
- **The AI reacts faster:** off the catch, on the pass (closeouts while the ball's in the air), after a move that makes space, to open lanes and in transition.
- **Threes:** the AI (and auto-play) takes fewer when the Three Point rating is under 70, fewer again at PF and C; a 60-rated big almost never fires an open one, an 80-rated guard still does.
- **Stamina:** recovery is 1.2× faster, and standing still recovers 2× on top of that. Moving without sprint recovers a very little, and contesting with the arms up (feet on the floor) is neutral for the defender.
- **Boosts:** stock up to 35 games per category (was 10).
- **Thirty block animations as five Block Packages** (Animations → Blocks: Fundamentals free, then Swatter, Wiper, Hammer, Eraser by Block rating, a tier easier for the tall): the higher the package, the more emphatic the block, from a plain reach to a hammer, a thunder clap, a finger wag.
- **The Hash-Slinging dunk package:** the Slasher's Icon badge unlocks six long streetball finishes nobody can buy (The Hash Sling, Lost Cause, Stinger, Double Dip, Backdoor Mill, Cradle Spin) that put most defenders flat on their back, with the Icon badge's own bigger, longer activation after every dunk.
- **Reach:** contests, blocks, rebounds and finishes measure against the model's own standing reach (shoulder + lift + the wingspan-sized arm), 4–8% less than before; dunks need a bit more Vertical.
- **Defense:** transition defense varies with each defender's speed and IQ, and defenders on a moving dribbler take the occasional bad step (a dribbler gets free about 2.75% more often). Every player model stands exactly its height with exactly its wingspan. Shot feedback can be shown for everyone's shots, the record scratch cuts off every green that misses and every blocked dunk, and the court overview no longer flickers.
- **Got Next:** your squad walks straight to the circles beside you when you step on a spot (no more detour round the park), and the Lock-In stat line fits inside the grade box.
- **The break:** the AI's first look in transition is the man running the open floor: an alley-oop if he can get up for it, a quick lob over the top, or the pass ahead. AI teammates throw **you** alley-oops too: hit the face button called over your head while the ball is in the air to finish; mistime it and the lob gets away.
- **Screens:** a screen's quality comes from the run-in, how set and square the screener is, the size and Strength of both men and Brick Wall on either side. Good screens visibly stop the defender, a set screener holds his ground, and a Brick Wall screener's perfect screen knocks the defender to the floor.
- **Green releases doubled and remade:** 32 sounds and 28 effects. Every sound is rebuilt to sound like its name, the Eagle Screech now a real raptor's scream, and they're made in the background so a green never waits.
- **Store, menus and HUD:**
  - Twice the apparel, Daily Spin exclusives included.
  - Readable dropdowns.
  - A crowd-sized Greeen Chant.
  - Volume sliders in the pause menus.
  - Your line (PTS REB AST / STL BLK TO) attached to the right of the Locked-In grade.

**v0.4.7.5 quick patch 3, Oct 12** (also in the patch notes):

- **Post moves:** hold **LT / L2** (X or right mouse on the keyboard) with the ball to post up. Back him down with the left stick, call a drop step, spin or up-and-under on the right stick, and shoot a hook, a fadeaway or a turnaround out of the post. Ten **Post Move Packages** are in the store (Animations → Post Moves) and the Inventory. They scale with Post Control, height and archetype, and Post Scorers get the most out of them.
- **Event Park hall** next to the Crew HQ at every park: walk through it to the running park event. At the event park it's the **Home Park** hall back to your own court.
- **Volume sliders** are perceptual: the first notch above silence is near-silent now.
- **A wide-open layup gets a solid green window** (a green goes in). With any coverage at all it stays outlined.
- **Play online with friends:** see the section below.

## Run it

**The soundtrack is large:** if you get the game as zips (the game and its music zips), extract them all into the same place. The music zips fill in `client/audio/music`. Without them the game still runs, just with no soundtrack.

You need **Python 3.10 or newer** and Microsoft Edge or Google Chrome (Firefox works through `start.sh` / the manual route). There is nothing to install with pip or npm, and you can play offline.

**Windows: double-click `RIMRIFT.exe`.** It starts the game service hidden, opens the game **fullscreen in its own window** (a separate Edge/Chrome profile, so no tabs, bookmarks or extensions), and shuts the service down by itself after you quit. If Python is missing it offers to install it for you with `winget`.

- **First launch:** the .exe isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**. You only have to do this once.
- **Quitting:** use the **⏻** button in the top bar or **Quit to desktop** in the park's pause menu. Alt+F4 also works. While the game is locked in, a quick **Esc** goes to the game (pause). To leave fullscreen without quitting, **hold Esc** or press **F11**.
- **Options:** put a `data/launcher.json` next to your save, for example `{"windowed": true}`. Keys: `windowed`, `kiosk` (no way out except Alt+F4), `port`, `browser` (path to a Chromium browser), `python` (path to python.exe), `idle_exit_seconds`. The same options work as flags, such as `RIMRIFT.exe -windowed`. Launcher problems are logged to `data/launcher.log` and `data/server.log`.
- **Still there:** `start.cmd` works like it did in v0.3 if you'd rather run the service in a visible window.

**macOS / Linux:** `sh start.sh` (Ctrl+C stops it).

**Manual:** `python -m server.app --open`, or run `python -m server.app` and open http://127.0.0.1:8765/. Opening `client/index.html` directly from disk won't work.

**Lock-in.** Press **F11** (or turn on **Settings → Fullscreen lock-in**) and the game takes the whole screen *and* the keyboard: the right-click menu, Ctrl shortcuts and browser keys can't pull you out mid-game. Since v0.4.5 the game keeps running when you click out of the window; turn **Pause on focus loss** on in Settings if you want it to pause.

Graphics quality is picked automatically from your GPU. To change it, open **⚙ Settings** and choose Low, Medium, High or Ultra. You can also turn on the FPS counter there.

## Play online with friends

**The game's own server (v0.4.8):** if the game folder's `online.json` names a server (its `server` address and `joinCode`), every copy that isn't hosting connects there by itself when it starts. The first time, a popup asks you to sign in to your online account or make one (the join code is filled in for you), and after that your game signs in by itself. **Play offline** in the Online tab disconnects you (it stays that way when you restart), and **Connect** brings you back, signed in. To set it up, connect to your server once from your own copy: the Online tab offers **Save to online.json** (type the join code). Then push that file to GitHub, and everyone who pulls the game only has to sign in. The join code is public in the repository from then on, so treat it as a light gate, not a password. Without a server in online.json, everything below works as before.

Since quick patch 3 a few friends can play together in the game itself: everyone at the same park sees the others walk around, call Got Next and play; friends make squads that go everywhere together, run Pro-Am as one team or challenge each other's squads, play in each other's crews and run 5-on-5 in the Crew HQ, and watch each other's games from the sideline. One PC hosts (it connects everyone). **Everyone plays from their own copy of the game and keeps their own save**: their players, VC, Rep, badges and rewards stay on their own PC, and every game they play online counts there, like any game. Friends without a copy can still join through the host's PC with `join.cmd` (with a new player made there).

**You (the host):**
1. Quit the game if it's running, then double-click **`host.cmd`**. The first time, it asks for a **join code**: your friends type it once, when they make their account. It's remembered in `%LocalAppData%\RIMRIFT\join_code.txt`. The script starts the service for everyone, shows the addresses your friends can use, and opens your game window. You can also play from `RIMRIFT.exe`, which uses the hosted service while it's running. Close the "RIMRIFT online service" window to stop hosting.
2. **The port opens itself:** the service asks your router to forward TCP port 8765 to this PC (UPnP, the way game consoles do it), keeps it open while you host, and closes it when you stop. host.cmd and your Online tab say whether it worked and give you the address for your friends. If your router has UPnP switched off (or another device already has the port), they say so: then **forward TCP 8765** on your router by hand to this PC's local address (host.cmd lists it, e.g. 192.168.1.20; TCP only). If it says there's another router or your internet provider's network in front of yours, friends outside your home can't reach you through it; use a VPN such as Tailscale instead (below).
3. **Windows Firewall:** the first time, Windows asks whether Python may communicate on networks. Allow it (Private, and Public if your network is set to Public). If you missed the prompt, run this in an administrator Command Prompt: `netsh advfirewall firewall add rule name="RIMRIFT online" dir=in action=allow protocol=TCP localport=8765`
4. Give your friends the address host.cmd shows (your **public IP**, read from the router) and the **join code**. Friends on your own Wi-Fi use the local address instead. host.cmd also shows the game's **version** (e.g. `0.4.8 a45c9d4e435a`): friends playing from their own copy need exactly that.

**Friends with their own copy (they keep their players):**
1. Their copy has to be **the same version as yours**, the same files. Every screen runs the same game, so even a small difference would make the screens disagree. The easiest way is for everyone to pull the same commit from GitHub. Their Online tab says so if it isn't the same, with both versions.
2. They start their game the usual way (`RIMRIFT.exe`), open the social phone's **Online** tab, type your address and press **Connect**. The game reloads once and comes back to that tab.
3. They **create an online account** on your game (username, password and your join code) or sign in to theirs. That's just their name for playing online; their players stay in their own save. Their game remembers it, so next time it connects by itself.
4. Only you need the open port; they don't open anything. **Disconnect** (or Change host) in the Online tab takes them back to playing alone.

**Friends without a copy** need only Chrome or Edge, not the game files. Send them **`join.cmd`**: it asks for your address once, remembers it, and opens the game in its own window. That window treats your address as secure, which controllers and full-screen keyboard lock need on a plain-http page. Or they can open `http://YOUR-IP:8765/` in Chrome or Edge. They create an account (username, password and your join code) and a player, both kept on your PC.

**In the game:** open the social phone (**O**, or **LB + RB** on a controller; the park's pause menu also has **Play online with friends**) and go to the **Online** tab.
- **Add friends** by username. Your own username is shown at the top; the local session's is `localplayer`. Requests show up there too, to accept or decline. Each friend shows where he is (in the menus, at which park, in a game) and, when he's online, buttons for what you can do together: **Squad** (invite him to your squad), **Pro-Am** (challenge his squad), **Crew** (bring him into your crew, once it's online) and **Go** (head to his park).
- **The park is shared.** Everyone at the same park sees the others walking around with their usernames over their heads (your squad's in gold). Their **Got Next** claims show on the courts' spots, the courts they hold show **KINGS** and their names, and a game they're playing shows live on its court: walk over and **watch it from the sideline**, the same game as on their screens (arrive in its first minute and it catches up; later than that, the court shows the live score). The court overview (hold **V** / View) shows it all too.
- **Squads** (up to 5): a squad goes everywhere together. Its **leader** calls Got Next for all of you (his friends in the squad count as teammates on the spot; park-goers fill the rest), starts Pro-Am, and when he goes to another park the others follow him there (unless they're busy: then they're told where the squad is). Kick and leave in the Online tab (and the Squad tab).
- **AI squad mates come too:** the AI friends each of you has in his own squad (from his own game) are part of the online squad. Everyone at the park sees them walking with their owner (and lined up on the squad's Got Next spot), they're listed with him in the squad, and they run with the squad: on its Got Next line after the real players (before any park-goers) and on its Pro-Am team. In those games they play like they do in their owner's game (their own IQ), and they're off the park on their owner's screen until the game is over.
- **Got Next with real squads:** two squads on the same court's spots play each other: the squad that called it first sets the game up as soon as both are there. Against the AI, your squad plays whoever holds the court, as always. **Winners stay on:** the people who won hold the court as kings, and their leader gets **Run it back** (against the next squad with next on that court, real or not) or **Leave court**; the rest of the winning squad can stay with him or leave. If the AI wins, the court goes back to the park.
- **Your own games are watchable too:** with anyone else at the park, your games go through the host's game so they can watch (on your own, nothing changes, and the court still shows as in use with its score).
- **Pro-Am with your squad:** the leader presses **Play Pro-Am game** on the Pro-Am screen and the whole squad goes to the arena as one team (open spots go to his squad mates and regulars from his park), in his team's colours. **Challenge** another squad (Pro-Am on a friend in the Online tab): when his leader accepts, both squads play each other in the arena. A friend without a Pro-Am team gets one made for him, so it counts.
- **Online crews:** bring your crew online from the Online tab (**Bring the crew online**) and invite friends into it. They play in it online: the **Crew HQ** door in any park takes them to its HQ, where crew members meet, shoot around and run **5-on-5** from the scorer's table (**together** against the next ones on, or **against each other**; your AI crew members who are on and regulars fill the spots). Their park, Pro-Am and event games add crew XP to it (the same share of their Rep as your own games, doubled when crew mates play together), and your game collects it into your save the next time you're online. Crew runs are practice, as always.
- **Results count** like any park or Pro-Am game, for everyone, in each player's own save (or, for join.cmd friends, on your PC), through each player's own game ticket: VC, Rep, badges, win streaks, bounties, crew XP and the event park's ante-up. If a ticket can't be issued (an ante he can't afford), that player plays the game for fun and the results screen says it wasn't recorded.
- **Leaving mid-game** (pause → Leave the game, a closed window or a lost connection) hands your player to the AI for the rest, on everyone's screen, and counts as a forfeit for you. Auto-play, slow motion and the team intros are off in games with other people, and pausing doesn't stop the game.

**How it works:** every screen runs the same simulation from the same start, in lockstep. Each player's input is sent a few ticks ahead (about 45 ms on a LAN, more when someone is far away), and your PC's service passes it on to the others and to everyone watching, so everyone sees the same game. Your PC only connects people: who's online and where, friends, squads, Got Next claims and kings, online crews, and the inputs during a game. Each player's game, from their own copy, keeps their players and records their results. A shot or layup release is graded at the moment you let go on your screen, on the window and the defense your meter showed then (v0.4.8), so the extra delay doesn't throw off your timing. Your meter also stops right where you let go. Every tick of your input says exactly how late it lands, so a let-go during a hitch or a catch-up is graded where you made it. Players and the ball are exactly where the game has them on every screen, tick for tick, with no prediction or smoothing. If someone's connection lags, the game holds for a moment and shows **Waiting for…**.

**Smooth online games:** an input goes out as only what changed since the tick before (usually nothing: a byte), so a game is about a tenth of the traffic it used to be, and the people watching get everyone's inputs in bundles ten times a second and play a fifth of a second behind, steadily. Your inputs keep going out on time while your game waits on someone else, so one late input doesn't make everybody late in turn. A PC whose frames run slow, or whose inputs keep reaching the others late (its Wi-Fi, say), sends its input a little further ahead by itself (and the release timing allows for it), and comes back down once nobody's waiting on it. The service sends each input straight on to every player whose connection is ready for it (v0.4.8) and keeps a queue for each one that isn't, so one bad connection never holds up anyone else (one that stops taking data altogether is cut off after 10 seconds, and the AI takes his player). At the park the game only animates the people you can see (the far ones every other frame, drawn with a lighter model), and while you play, the courts you can't see barely move. If your frames still run slow in an online game, it draws a little lighter for a while (Settings → **Online games: Keep them smooth**; **Full graphics** turns that off).

**Good to know:** the connection is plain HTTP, so use a password you don't use anywhere else. If you'd rather not open a port, a VPN such as Tailscale or ZeroTier works too: your friends use your VPN address. The local session (`Start local session`) is offered only on the host PC itself.

## Host on a server (DigitalOcean)

Instead of hosting on your PC (host.cmd and a forwarded port), you can rent a small server that hosts the online game around the clock: no router settings, nothing running on your PC, and the connection is encrypted (HTTPS). A $6/month DigitalOcean Droplet is plenty: the server only connects people and passes inputs on, and every game is still simulated on the players' own PCs. Everyone, you included, plays from their own copy and keeps their own save; the server keeps only the online accounts (and the players of friends who come in through join.cmd).

**Set it up (about 10 minutes):**
1. Push the game to GitHub (GitHub Desktop: Commit, then Push). The server installs the game from `github.com/EpsilonDevil/Afterhours16`, and follows it from then on.
2. Make a DigitalOcean account and add a card or PayPal.
3. **Create → Droplets.** Region: the one closest to the middle of where you and your friends live (the further the server, the more input delay). Image: **Ubuntu 24.04 (LTS) x64**. Size: **Basic → Regular, $6/mo** (1 GB / 1 CPU). Authentication: **Password** (a long one you don't use anywhere else).
4. **Advanced options → Add initialization scripts (Startup scripts):** paste all of [`deploy/digitalocean-startup.sh`](deploy/digitalocean-startup.sh), and change the join code on its `JOIN_CODE=` line.
5. Hostname: `rimrift`. **Create Droplet.**
6. Wait 5–20 minutes (a new server installs Ubuntu's own updates first; while it does, the setup log repeats "Waiting for…" lines, which is normal), then open the Droplet's **Console** (its page, top right) and type `afterhours16 status`. It shows the server's address, like **`https://203-0-113-7.sslip.io`**, and the join code. (The address is made from the server's IP by sslip.io, so it works with no domain; Let's Encrypt gives it a certificate, renewed by itself.)

**Playing:** connect to the server once from your own copy and press **Save to online.json** in the Online tab (see **Play online with friends**), then push. From then on everyone just starts their game (`RIMRIFT.exe`) and signs in. Before that, or for another server, players open the social phone's **Online** tab, type the server's address, press **Connect**, and make an online account there with the join code (once). Friends without a copy double-click `join.cmd` and type the same address. You don't need host.cmd any more (and you can remove the port forward from your router).

**Keeping it up to date:** the server checks GitHub every 10 minutes and installs a new version by itself, restarting only when no games are being played. Everyone's copy has to match the server's, so when you push an update, your friends pull it too (their Online tab says so when they're behind). To update the server straight away: `afterhours16 update` in the Droplet Console.

**In the Droplet Console** (the server's own command and files still carry its install-time name, `afterhours16`, until the server itself is renamed; everything it shows says RIMRIFT): `afterhours16 status` (address, join code, version, who's on, HTTPS), `afterhours16 update`, `afterhours16 joincode NEWCODE`, `afterhours16 autoupdate on|off`, `afterhours16 logs`, `afterhours16 restart`, `afterhours16 backup` (the database is also copied every night; the last 14 are kept in `/var/lib/afterhours16/backups`). If the setup itself went wrong: `cat /var/log/afterhours16-setup.log`, then run it again with `JOIN_CODE=yourcode bash /opt/afterhours16/deploy/install.sh`.

**What's on it:** Ubuntu with its automatic security updates, a firewall that lets in only SSH, HTTP and HTTPS, Caddy in front (HTTPS, with the certificate), and the game service (`python3 -m server.app --server`) on the server itself only, run as its own user, first in line for the CPU, with network settings for many small messages that can't wait (`deploy/sysctl-afterhours16.conf`, applied each time the service starts, so a server set up before gets them with its next update). `deploy/install.sh` sets it all up and can be run again at any time; it also works on any other Ubuntu 24.04 server (give it `PUBLIC_IP=` if it can't find its address, and `DOMAIN=game.example.com` for a domain of your own pointed at the server).

## Modes

**MyPLAYER.** You create a player by picking a position, one of 8 archetypes (Sharpshooter, Slasher, Playmaker, Lockdown, Two-Way, Glass Cleaner, Stretch Big, Post Scorer), height, weight, wingspan, shooting hand and looks. Your build sets a cap for each of the 22 attributes, and you spend VC to raise attributes up to those caps. Badges (18 of them, Bronze → Hall of Fame) level up from what you do in games, for example contested makes, dunks, assists, ankle-breakers and blocks. An account has 4 build slots, and every ICON build opens one more, up to 8 (since v0.4.8.5 quick patch 7); you can delete a build from MyPlayer → Players with a 5-second hold, and an ICON build's slot stays open (quick patch 8). Since v0.4.7.5 a new build upgrades to **80 OVR** with VC, and every 3 Pro Run games you play to the end raise its max by 1, up to **90 OVR**. Each of your first 5 Hall of Fame badges brings **5 cap breakers** (+1 each to a maxed-out attribute, past the cap); they unlock at 90 max OVR and are banked in MyPlayer → Attributes → Cap Breakers until then. A build holds up to **7** Hall of Fame badges, and the 7th (or every Hall of Fame the build can reach, if fewer) unlocks your archetype's **Icon badge**. Since v0.4.7.5 every badge has a highest tier your build can reach, set by your archetype and height. Each badge tier is a big step up from the last, and a stat with none of its badges plays 10% weaker.

**The Park.** Pick your affiliation once: Harbor Kings, Old Brick Society or Foundry Rivets. That park is your home: since v0.4.8.5 a build plays there until it reaches **Pro 1**, and then it can visit the other two whenever it likes (park events are open to everyone). Each one has its own park (a sand beach full of palms, a downtown street grid at night, an industrial sprawl under low fog), with its own background life: people walking and jogging past, traffic or sailboats, and random events every half minute or so. Depending on the park those are an elevated train, a helicopter with a searchlight, flocks of birds, a speedboat, a freight train, a container crane at work, welding sparks or steam. You walk around in third person while AI regulars play live games on **six courts**: three full courts for 3v3, two 2v2 half courts on the west side and a 1v1 court on the east side. Every court has two **GOT NEXT** spots, one each side of the GOT NEXT stencil (v0.4.7.5): stand on an open one with your squad, and whichever squad fills its spot first runs next while the other waits for that game. Hold **View/Share** (V) for the live court overview with every court's score, streak and bounty; while you're on a spot, the score of that court's game shows in the bottom right. Losers are put off the court and have to walk back around to the end of the line. Park-goers join your squad, and people sit on the benches and stand on the sidelines to watch, reacting to the big plays. AI-only games fast-forward through dead balls (and run faster when you can't see them). Park-goers never wander onto a court while a game is on.

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
  - **2v2 and 1v1 are half court:** check ball at the top. After any change of possession (a defensive rebound, a steal, a loose ball) the arc glows red: take it back past it before you shoot (until then the shot button only calls out TAKE IT BACK).
  - All park games are 2s and 3s, first to 11, 15 or 21.
  - **Park rules, with the contact calls kept:** reach-in and shooting fouls are called (no free throws; the offense keeps the ball; half as often as before since v0.4.8.5 quick patch 3) and offensive three seconds in the paint is a turnover; no backcourt rules in the park. Pro-Am and the Pro Run play under the full NBA book: defensive three seconds (a technical), charges, goaltending, the inbounder's 5 seconds and free throws on every shooting foul.
- **Win streaks:** win and you can **Run it back**. Each straight win multiplies the VC *and* Rep you earn: ×1.0 for the first win, then +0.15 per win, up to ×2.5 at an 11-game streak. The results card shows your multiplier.
- **Your Rep:** goes up from Rookie 1 through Pro, All-Star and Superstar to Legend.
- **The plaza:** three kiosks stand side by side.
  - **Daily Spin:** a prize wheel you can spin once every 24 hours. VC comes in five tiers (500, 2,500, 10,000, 50,000, and a very rare 250,000 jackpot), and some slices hold exclusive gear and animations you can't buy in the store. The odds are shown on the wheel.
  - **VC Store.**
  - **Boosts:** 2K17-style boosts by category (Shooting, Finishing, Playmaking, Defense, Rebounding, Athleticism). Each adds +5 to every attribute in its category, up to 99, for 1, 3 or 5 games, and you can stock up to 35 games per category. A boost game is used when a park or Pro-Am game tips off.
- **Shootaround:** hit the practice hoop by the 1v1 court.

**The Monster Mash (v0.4.8.5 quick patch 2 park event).** The park event after And The Beat Goes On: it goes live when the Beat's 48-hour window closes, Oct 16, 2026 at 00:00 UTC (the Beat's park, prizes, soundtrack and code all stay in the game, closed, like the Jungle's and the King Tut Cup's). The same park layout in a haunted town on Halloween night. A huge full moon hangs low in the north behind a haunted mansion on a hill, under a sky full of stars, with lightning now and then and fog over the town and the swamp. The courts are graveyard courts: mossy-green floors, purple aprons with tombstones, cobwebs, bats and pumpkins, orange keys, bone-white lines, a jack-o'-lantern under the moon at center court and "THE MONSTER MASH" in dripping slime letters along the baselines. Around them are Hollow Hill Cemetery (an iron gate, headstones, open graves and a mausoleum with a green-lit door), an old church with bats in its belfry, a broken stone tower, a carnival with a Ferris wheel, a carousel and a HAUNTED HOUSE ride, a pumpkin patch with scarecrows, a street of Halloween houses with a funeral home and a hearse, and a foggy swamp with will-o'-wisps and a witch's cottage. Zombies, a vampire, a werewolf, mummies, dancing skeletons, ghosts, black cats and trick-or-treaters are out, the Lantern Man walks the town, and a slasher in a yellow raincoat stalks the block (spooky, no gore). Random events include a thunderstorm, the dead rising from their graves, a zombie dance troupe, the slasher chasing screaming teenagers, a witch across the moon, bats bursting from the belfry, a ghost parade, a werewolf transformation, the haunted-house ride bursting open, fireworks and a hearse driving by, with quiet spooky sounds of their own (`client/js/core/spooky.js`). A win streak haunts your court: green ghost-fire at 3 wins, skeleton hands, fog and flickering green floodlights at 6, a ring of ghosts at 9, and at 12 a giant skull with a working jaw, wisps spiralling into the sky and lightning. Since v0.4.8.5 quick patch 3 it has a soundtrack of its own: 27 tracks cut from a Halloween party mix of horror movie themes and remixes in `client/audio/monster`, played only there (park games included) in a new shuffle every time you arrive. The rules and the prize ladder are the same as the other events, with all-new rewards. 1st place takes the **Bone Suit** (a black bodysuit, gloves and tights with an anatomical skeleton that glows ghost-green in the dark), the Coffin Hi / Graveyard shoes, the Zombie Shuffle celebration, the Jack-o'-Lantern headband, the **Jack-o'-Lantern** green release (a pumpkin lights up over your head and bursts into bats when the shot drops) and the **Haunted Organ** green sound, plus 150,000 VC. Top 3, top 10 and top 25 take the rest of the ladder.

**And The Beat Goes On (v0.4.8.5 quick patch park event; off the schedule from Oct 16, 2026).** The park event after The Jungle Ballers: it goes live when the Jungle's 48-hour window closes, Oct 14, 2026 at 00:00 UTC (the Jungle's park, prizes and code all stay in the game, closed, like the King Tut Cup's). The same park layout in an 80s city with the sun sitting on the horizon. A striped synthwave sun glows low in the west-north-west, and everything is washed in orange and pink. The courts are retro: violet floors, hot-pink aprons with Memphis confetti, teal keys and a sunset logo at center court. Around them are neon signs, pastel art-deco blocks and mirror-glass towers, a palm-lined Strip, a diner, a record store, an arcade, a roller rink, a motel and a disco bar. The disco bar has a mirror ball over the door, a light-up floor, searchlights and a line at the velvet rope. Candy-painted lowriders cruise and hop on their hydraulics, b-boys battle on cardboard, a boombox crew pops and locks, and skaters circle the block. Random events include a hop-off, a dance battle, a skate train, a neon blackout, a banner plane, a blimp, a light show, fireworks and a lowrider parade. A win streak turns your court into a disco: a mirror ball and sweeping spots at 3 wins, building to a full light show at 12. The park has a soundtrack of its own, 28 tracks cut from a 74-minute 80s R&B mix in `client/audio/beat`. It plays only there, park games included, in a new shuffle every time you arrive, and the main soundtrack picks up where it left off when you leave. The rules and the prize ladder are the same as the other events, with all-new rewards. 1st place takes the **Beat Goes On tracksuit** (a color-blocked shell-suit windbreaker and track pants), Boombox Hi / Neon shoes, the Running Man celebration, the Neon Terry headband, the **Disco Ball** green release and the **Eight-O-Eight** green sound, plus 150,000 VC. Top 3, top 10 and top 25 take the rest of the ladder.

**The Jungle Ballers (v0.4.7.5 qp3 park event; off the schedule since Oct 14, 2026).** The park event that took over from the King Tut Cup when the Cup's last 48-hour window closed (the schedule is `server/events.json`; the Cup's park, prizes and code are all still in the game, just closed, and go live again the moment they're put back on the schedule). The same park layout deep in a rainforest: giant trees with buttress roots ringing the courts, a canopy of leaves, lianas and vine swags overhead (the hanging fringe shows along the top of the screen during a game), a waterfall and its pool on the north edge, bamboo torches, ferns everywhere, a toucan medallion on every court, and animals on their rounds beyond the fences — a jaguar, a tapir, a troop of monkeys, a family of capybaras, a sloth on a liana — with toucans and macaws flying through, mist, fireflies and butterflies. The rules are the Cup's: every game is an ante-up (500 to 10,000 VC), 48-hour windows, a leaderboard of net VC won against the AI hoopers who entered, and prizes claimed when the window closes, with the same VC ladder and all-new cosmetics: 1st takes the **gorilla costume** (fur top and legs), the Canopy Hi / Toucan shoes, the Chest Beat celebration, the Toucan Feather headband, the **Banana Peel** green release (a banana hangs over your head on the release and peels open the moment the shot drops) and the **Jungle Bongos** green sound (four quick bongo taps under cicadas, a toucan and dripping leaves), plus 150,000 VC; top 3, top 10 and top 25 take the rest of the ladder as before. A win streak in the Jungle brings **rain** over your court instead of fire or lasers — a drizzle at 3 wins, heavier and slanting at 6 and 9, a downpour with lightning over the court at 12.

**The King Tut Cup (v0.4.5 park event; off the schedule since Oct 12, 2026).** A glow-in-the-dark park among the pyramids — neon court lines, sphinxes, obelisks, a mini-golf strip and laser-tag barriers — where every game is an ante-up. Pick a stake (500 to 10,000 VC) when you claim a spot: win and you take the other side's stake too, boosted by your Cup win streak, on top of the normal game VC; lose and the stake is gone. Each Cup runs for 48 hours and ranks the most VC won against the AI hoopers who entered it. The winner gets the glow-in-the-dark mo-cap suit, and the top finishers get exclusive shoes, a celebration, a headband and VC. In every park, a 3-game win streak lights a wall of fire around the court (it grows at 6, 9 and 12 wins); in the Cup it's green lasers instead. Since the v0.4.5 quick patch the fire is live and procedural: one continuous wall all the way round with no repeating picture, about 1.4 m tall at 3 wins, 2.2 m at 6, 3 m at 9 and 3.8 m at 12, brighter and fuller at each step, and it eases in as it grows.

**Crews and the Crew HQ (v0.4.5).** Start a crew with up to 39 of your friends (name, tag and color), from the Crew HQ building on any park's plaza or the social phone's Crew tab. Crews level from 1 to 40 (level rewards are coming soon). Every game you play earns crew XP — about 30% of the Rep it pays, ×1.1 in the park, ×1.3 in Pro-Am, ×1.5 in park events, and doubled when a crew member runs with you — and your members earn it too whenever they play, even while you're away. Inside the HQ: a full court and a shootaround court in your crew's colors, your online members hanging out and getting shots up, the members and level boards, and practice 5-on-5 runs once four members are on. Interior customization is coming soon. Since quick patch 3 the **Event Park** hall stands next door to the HQ on every park, with the running event's name on its sign: walk through its door and you come out of the same hall at the event park. At the event park it's the **Home Park** hall, back to the park you're loyal to.

**The Pro Run (v0.4.5).** A career in the RIMRIFT Pro League. Pick a college and play three games — how you play sets your draft slot (two rounds of 32), and the team holding it takes you. Then an 82-game season against 31 other teams with full rosters, a play-in, four playoff rounds and the Finals, with awards at the end. Play your games in the arena or sim them, and set the sim your way: quarter length (1 to 12 minutes for games you play), difficulty, your minutes, playoff series length, play-in on/off, upsets and home court. Games you play pay VC and badge progress at 1.5x the park rate. No music, like Pro-Am. After each game you play, the next one on your schedule starts by itself after 10 seconds (v0.4.8.5).

**Pro-Am.** The arena has announcers at the scorer's table who follow the ball and react to big plays, baseline photographers with flashes, a camera operator, subs on both benches and a courtside row. The crowd stands and throws its arms up on big plays, claps through dead balls and free throws, starts a wave now and then, and gives a standing ovation at the final buzzer. Your squad suits up with you, and open spots go to regulars from your AI world who fit the position. You build a team identity: name, abbreviation, colors, logo shape and floor wood. That branding is painted on the arena court, the LED boards, the jumbotron and your uniforms. You then play organized 5v5 with a tip-off, quarters of 2, 3 or 5 minutes, a shot clock, inbounds, fouls and free throws, and overtime if it's tied. Your team's record is saved, and the next game starts by itself 10 seconds after the results (v0.4.8.5).

**Pro-Am ranks (v0.4.8.5).** Each build has a Pro-Am rank: Bronze (0 RP), Silver (400), Gold (800), Platinum (1,200), Diamond (1,600), Master (2,000) and Grandmaster (2,400 and up). Every game you finish pays or costs RP, worked out by the game service from three things: the result (+10 for a win, −6 for a loss), how strong the other team was against your RP (Elo-style, up to about ±30, so beating a stronger team pays more and losing to a weaker one costs more), and how you played (your game score per 20 minutes, −8 to +12). A win always pays at least 5, and a loss costs 2 to 40. Forfeit & leave costs 20, as does leaving a Pro-Am game running to start another. The Pro-Am screen shows your rank, RP, the progress to the next rank and your best; the results show the RP and the breakdown, and a promotion or demotion. Online, friends can run Pro-Am as one squad if every two of them are within **2 ranks** of each other (Silver plays with Bronze, Gold and Platinum).

**VC Store.** The store has 407 original items (plus 16 Daily Spin exclusives, 7 King Tut Cup prizes, 7 Jungle Ballers prizes, 7 And The Beat Goes On prizes, 7 Monster Mash prizes and the Hash-Slinging Icon package): jerseys, tees, compression tops, hoodies, shorts, joggers, nine sneaker models (each with its own textured design), socks, headbands, sleeves, leg sleeves, knee pads, wristbands and chains. It also sells animations: jumpshot bases, releases, dunk packages, layup packages, size-up packages, block packages, post move packages, celebrations and movement styles, plus green release sounds and effects. Since v0.4.7.5 you equip what you own in the **Inventory**, a separate screen. You can try items on in the studio before buying. Some items need a certain overall, Rep tier or attribute, the way 2K16-era unlocks did (a windmill dunk package needs Driving Dunk 82, for example).

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
- **Icon badge animations** can't be bought at all: your archetype's Icon badge brings its own. Sharp Eye's own jumpshot base and crane release (with a backflip after every green that goes in; only the holder's build ever sees them), Hash-Slinging's six-finish dunk package, Oprah's nine streetball passes, The Clamp's ten steal animations (a Steal Package in their own Steals slot since quick patch 6), The General's Salute (an item since v0.4.8.5 quick patch 5), Big Brother's seven-block Block Package, Open Arms' rebound snags (every board its holder secures; with the six-snag Rebound Package in its own Rebounds category since v0.4.8.5 quick patch 3) and Sexy Red's Post Move Package with five back-downs (quick patch 5).

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

**Report a bug (v0.4.7.5).** Press **F8** anywhere (or use the button in Settings or a pause menu), say what happened, and the report is saved to `RIMRIFT_Bug_Reports.txt` next to `RIMRIFT.exe`, with where you were, recent errors and game events, and your system and settings attached. Send that file along to get the bugs fixed.

**Locker Codes (v0.4.4).** In the top bar (ticket icon) and on Home. Codes aren't case sensitive, and each one works a limited number of times per account. Every code so far (HELP-I-NEED-VC) was retired with the v0.4.8.6 season reset, so none can be redeemed right now; a retired code says it has expired.

**Soundtrack (v0.4.4, 49 tracks since v0.4.8; long mixes are split into parts that play back to back; And The Beat Goes On has its own, see above).** The tracks you supplied (in `client/audio/music`) play shuffled through the menus, the park, park games and practice. They sit a little lower under park games and fade out for Pro-Am, where the arena has its own sound, then pick up where they left off. A **Now Playing** ticker in the bottom-left corner shows the title for the first few seconds of each track. To fill in artist names, edit `client/audio/music/tracks.json`. Music on/off and volume are in Settings.

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
| Finish an alley-oop thrown to you: press the face button shown over your head while the ball is in the air (random each time; the wrong button or mistiming fails it) | E / R / Space / T, as called | A / B / X / Y, as called |
| Icon pass to a teammate (the input shows over each teammate's head) | 1–4 | LB + face button |
| Crossover · in-and-out / hesitation · step-back | ← → / ↑ ↓ | Flick right stick left/right / up/down |
| Spin / behind-the-back | Q / F | Rotate right stick / flick down while moving |
| Post up (with the ball): back to the basket, the left stick backs him down, sideways shuffles, away steps out | Hold X or right mouse | Hold LT (L2) |
| Post moves (while posting): drop step to that side / post spin / up-and-under | ← → / ↑ / ↓ | Right stick left/right / up (or rotate) / down |
| Shoot out of the post: stick toward the rim a hook, away a fadeaway, neutral a turnaround; right after a move it's a power finish at the rim (or a turnaround further out) | Space while posting | X while posting |
| Call screen / call for ball | C / E without the ball | Tap LB / A |
| Set a screen (off the ball, v0.4.8.5) | Hold R without the ball | Hold B without the ball |
| Defensive stance | Hold Q or right mouse | Hold LT |
| Steal / block or rebound / hands up | F / Space / R | X / Y / right stick up (Y off the ball on offense: jump for the rebound) |
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

**Settings → Shot meter / Shot feedback** (both on by default; *Shot feedback for → Everyone's shots* shows the grade over every player's release). Turn the meter off and your green window gets **10% wider**. With the meter on or off, and with any jumpshot base or release, the middle of the green window is the exact moment the ball leaves your hands. Shot feedback is the grade and percentage that pops up over your player after a shot.

**The shot meter** (v0.4.5 quick patch) is a slim bar next to your player that fills as you shoot. The window on it is drawn to scale from the same numbers that grade your release, so letting go anywhere inside it is an Excellent release and anywhere outside isn't, with the contest measured live:
- **Solid green** in the middle is the window your ratings give you on their own.
- **Fading out to yellow** around it is what boosts add: badges (Green Machine, Deadeye under a contest, Limitless Range from deep, Catch & Shoot, Corner Specialist, Contact Finisher on layups), your Icon badge, a Shooting Takeover and a forgiving jumpshot base or layup package. Releasing in the yellow is still a green.
- **Solid** means a green there always goes in (jumpers inside 35 ft, free throws, and since quick patch 3 wide-open layups and wide-open shots out of the post). **Outlined** means perfect timing, but not an automatic make: layups and post shots with anyone on you, and shots from past 35 ft.
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
  - **The King Tut Cup courts** have a sphinx at center court; the Jungle Ballers courts a toucan; And The Beat Goes On courts a synthwave sunset; the Monster Mash courts a jack-o'-lantern under the moon.
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
- **The open court (v0.4.7.5 quick patch 3):** in transition the AI handler reads the man running free ahead of him first: a teammate well ahead, running at the rim, nobody between him and the basket and nobody level with him who could recover. That man gets an alley-oop if he can get to the rim in time, a quick lob over a crowded lane, or the pass ahead. You can be that man: an AI teammate lobs it, a random face button is called over your head, and pressing it while the ball is in the air finishes the alley-oop. The wrong button, too early or no press is a mistimed jump and the ball gets away.
- **Screens (v0.4.7.5 quick patch 3):** a defender who runs into a set screen loses speed in proportion to the screen's quality: how hard he ran in, whether the screener was planted and chest-on, a called screen, the weight, strength and height of both men, their Strength ratings and Brick Wall on either side. A solid screen stops him dead for a moment; a Brick Wall screener's perfect screen puts him on the floor until he gets back up. Set screeners hold their ground, and brushing past a standing player isn't a screen.
- **Brick Wall (v0.4.4)** only fires where it should:
  - **Bumps:** on defense only.
  - **Screens:** on either end.
  - Never on a jump shot or a landing, so an open three can't set it off.
- **Shooting is timed, and greens are guaranteed.** An Excellent (green) release always goes in unless the shot is blocked. Difficulty doesn't lower that chance. It shrinks the green window instead: a hand in your face, shooting on the move, fading, or pulling up from deep all make the green harder to hit, and the meter shows the live window. When you're **smothered** (the meter outline turns red), there is no green at all, so pass out of it. Moving away from the hoop, your player turns and fades; otherwise he squares up to the rim before he rises. Early or late releases cost a lot, and Very Early or Very Late releases mostly miss. Every shot then flies as a real ball: drag, backspin, rim and backboard collisions, a cloth net, and bank shots near the glass. Makes and misses are decided first, then a matching trajectory is solved, so a miss rattles out and a make drops.
- **Movement and animation follow real measurements.** Jump-shot depth, release height and hang time, running stride, cadence and ground-contact time, and landing absorption use numbers from published basketball and running biomechanics (see `docs/FIDELITY.md`).
- **Blocks have styles (v0.4.7.5 quick patch 3):** thirty of them in five tiers set by your Block rating and height, picked for the moment (at the rim, a chase-down, a closeout), the swat firing from the contact, and the top tiers finishing with a gesture — a finger wag, a stare, a flex — that ends the moment you move.
- **Post moves (v0.4.7.5 quick patch 3):** inside about 5.4 m of the rim, hold the post-up trigger with the ball and he turns his back to the basket. How fast he backs the man down, how often a drop step, spin or up-and-under beats him (he's a step behind the finish), and how much a hook, fade or turnaround out of the post shields the shot and adds to it all come from his **post power**: the package (Fundamentals up to Low Post Legend and Backboard Bully, each with its own signature moves and shots), Post Control, height and the archetype. Post Scorers count 1.35×, Glass Cleaners 1.02×, Stretch Bigs 0.88×, down to Sharpshooters at 0.6×. Measured against a 72 Interior D defender, releases within ±70 ms: a 90 Post Control 6'10" Post Scorer with Low Post Legend hits 75% of his hooks and finishes 63–69% after a move (he beats the man 81–86% of the time). An 80 Post Control Post Scorer with Fundamentals hits 64% and 54%, an 80 Glass Cleaner 59% and 49%, an 80 Slasher at 6'5" 55% and 46% (beating his man 5% of the time), and a 60 Post Control Sharpshooter at 6'3" 29% of his hooks. The AI posts up too: it backs down a smaller man, uses its package's moves, kicks it out of a double team, and averages about one post move a game in Pro-Am and the park.
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
python -m unittest discover -s tests     # builds, caps parity with the client, save migration, rewards, launcher endpoints, full HTTP journey, online play
node --test tests/                        # every game test (post moves and online lockstep: tests/v0475qp12.test.mjs; online performance: v0475qp14; online timing: v048)
python tests/load_hub.py --players 10 --watchers 10   # the online service under a full park game: CPU, input latency, bytes
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
  online.py        online play: friends, presence, places, squads, Got Next claims and kings, online crews, the lockstep input relay and watching (a stdlib WebSocket)
  upnp.py          hosting: asks the router to forward the port (UPnP), renews it, closes it on the way out
host.cmd           host the game for friends (port 8765, join code); join.cmd: a friend's one-click way in
launcher/          RIMRIFT.exe source (Go, standard library only)
tests/             Python and Node test suites
tools/             simulation batch runner for balancing
data/              your save database (created on first launch)
```

See `docs/ARCHITECTURE.md` for how the pieces fit together, `docs/FIDELITY.md` for an honest list of what this is and isn't, and `docs/V0.5-PLAN.md` for the planned graphics and motion-capture overhaul.

To rebuild the .exe (needs Go 1.22+), run `cd launcher && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../RIMRIFT.exe .`. The icon and version info come from `launcher/rsrc_windows_amd64.syso`, built from `launcher/res/rimrift.rc` (`x86_64-w64-mingw32-windres --preprocessor=cpp --input-format=rc --output-format=coff -i rimrift.rc -o ../rsrc_windows_amd64.syso`, from `launcher/res`).
