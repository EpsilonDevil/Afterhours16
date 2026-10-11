# Status — v0.4.7.5 (complete, with its quick patch)

v0.4.7.5 was built in twelve stages (A–L), each committed with its own tests. The full player-facing list is in `PATCH_NOTES_v0.4.7.5.docx` (source: `PATCH_NOTES_v0.4.7.5.md`). Where things live:

| Area | Files | Notes |
|---|---|---|
| Contests, hot, takeovers, wide-open dunks, Contact Finisher, posting, defensive X, AI Lock-In | `sim/shots.js`, `sim/badges.js`, `sim/game.js`, `sim/player.js` | no-badge contest ×0.53 (was 0.44) per unit; HOT_BOOST 0.03; TAKEOVER_SECS 90, +6; WIDE_OPEN 0.1 |
| Badge caps by archetype and height, badge art, HOF vibrance, Icon designs | `server/builds.py` (BADGE_ARCH_CAPS, HEIGHT_BANDS), `sim/builds.js` (mirror), `ui/badgeart.js` | caps applied for the user, bots, park, intros and phone |
| 80 OVR VC cap, +1 per 3 Pro Run games to 90, banked cap breakers | `server/builds.py`, `server/progression.py`, `ui/myplayer.js`, `ui/modes.js` | builds already past 80 keep an ovr_floor |
| Stick moves, combos, packages, passing, box-outs, speed | `sim/moves.js`, `core/input.js`, `sim/game.js` | 14 moves, 21 combos, 20 size-up styles |
| AI moves, shot selection, screens, cuts, anti cherry-pick, calibration | `sim/ai.js` | AI_TIMING_COMP {mid 1.3, three 1.08, layup 1.32}: 36 park games → mid 34.6%, 3PT 31.9%, layup 53.0% |
| Doubled animations, movement styles, hustle shots, dunks, ankle reactions | `server/catalog.json`, `sim/game.js`, `sim/shots.js`, `char/animator.js` | uniqueness checked pairwise (tests) |
| Limb collisions, springs, straps, traps, skin | `char/rig.js`, `char/animator.js`, `char/athlete.js`, `char/view.js`, `gfx/shaders.js` | clipping audit in the patch notes |
| Green release sounds and effects | `core/greensound.js`, `game/greenfx.js`, `game/session.js`, `sim/bots.js` (spreadGreens) | Web Audio synthesis; particle effects with held shapes |
| Two Got Next spots, overview, bounties, ticker, AI growth, squads on close | `world/themes.js`, `world/venues.js`, `game/park.js`, `ui/modes.js`, `sim/world.js`, `server/progression.py` | bounty 2,500 + 750/win above 7, max 15,000 (server-paid) |
| Inventory, store split, menu/HUD polish | `ui/inventory.js`, `ui/store.js`, `ui/screens.js`, `css/*.css` | |
| Soundtrack, bug reports | `client/audio/music/`, `core/music.js`, `ui/bugreport.js`, `server/bugs.py` | parts play back to back; reports in `Afterhours16_Bug_Reports.txt` |

Tests: `node --test tests/*.test.mjs` (121) and `python -m unittest discover -s tests` (39).

## v0.4.7.5 quick patch

Player-facing list: the "Quick patch" part of `PATCH_NOTES_v0.4.7.5.md` / `.docx`. Where things live:

| Area | Files | Notes |
|---|---|---|
| Non-shooters, green windows | `sim/shots.js` (SHOOTER_ARCH, NON_SHOOTER_WIN 0.9, GREEN_K ×0.9), `sim/game.js` jumperWindow | `sure` excludes a non-shooter's three |
| Smothered = no make, finish scale, record scratch | `sim/shots.js` (LAYUP_SMOTHER 1.72, insideGuard, guardFor, contestRaw), `sim/game.js` releaseShot/releaseLayup/layupContest, `core/greensound.js` (playRecordScratch, stop handles), `game/session.js` (cutGreen, greenScratch) | release events carry guard, smothered, scratch |
| Contests at the release | `sim/game.js` aiGradeAtRelease, `sim/ai.js` (timing returns the planned contest), `sim/shots.js` contestRaw (0.9/m release height, paint weight ±10%) | AI_TIMING_COMP {mid 1.55, three 1.15, three_non 1.8, layup 1.8, ft 1.05}: 72 park games → mid 34.9%, layup 51.5%, 3PT 28.1% (shooters 35.6%, others 24.3%) |
| Repeat moves, diagonals, dribble/game speed | `sim/game.js` (repeatMoveK, REPEAT_GAP 3 s, DRIBBLE_MOVE_SPEED 0.8, MOVE_BURST_K √0.8, GAME_SPEED ×1.025), `sim/moves.js` (pushcross, jab, snatch, btlback; 17 combos), `char/animator.js`, `sim/ai.js` SITU | size-up combos in place ×0.8 too |
| Passing, reach-ins, AI in bounds | `sim/game.js` (PASS_ACC_K 0.9, reachContact, REACH_FOUL), `sim/ai.js` (seek clamp + lineBrake, meetPass in bounds, no reaching through) | Pro-Am: ~3 reach fouls a game, all from contact |
| Defense arrows, camera, volume | `game/session.js` defArrows (DEF_ARROW), `gfx/textures.js` arrowTexture, `game/camera.js` (FOLLOW_X, CAM_H), `ui/screens.js` volumeSliders/bindVolume, `ui/modes.js` pause menus | Settings → Defense arrows |
| Icon Legend to 99 | `server/builds.py` (LEGEND_*, legend_raise, legend_info, caps floor), `server/progression.py`, `server/app.py`, `sim/builds.js` (caps floor), `ui/modes.js` legendUnlocked, `ui/myplayer.js`, `ui/prorun.js` | +1 per 2 completed Pro Run games after the Icon badge |
| Straps, dunks, celebrations, Posterizer | `char/athlete.js` (buildStraps, TANK_STRAP; buildSteps now passes straps), `sim/game.js` (millCircle, EASTBAY_KEYS/keyPath, posterPending), `char/animator.js`, `game/session.js` (canCelebrate), `core/input.js` padDpad | the staged build never drew the v0.4.7.5 strap mesh |
| Apparel ×2, dunk styles, dropdowns, chant | `server/catalog.json` (95 new items `v0475qp`, dunk `styles`), `sim/bots.js` (shoe `model`), `css/app.css`, `core/greensound.js` | wearables per slot exactly doubled; 12 Daily Spin wearables |
| Green releases ×2, sounds remade | `core/sfx.js` (sample synth: Osc, Svf, Biquad, Formants, Noise, Drift, Env, modes, pluck, reverb, levelling + soft limiter), `core/greensound.js` (32 recipes, renderGreen, cache per sound and tempo, worker + warmGreenSounds), `core/greenworker.js`, `game/greenfx.js` (14 new effects), `server/catalog.json` (30 new items `v0475qp`) | AI pitch on playback, tempo rendered in; record scratch still on live nodes |
| AI reactions | `sim/ai.js` (o.fresh catch read, moveGap/inMove, driveLane, closeouts on the pass, rotations to the pass target, recovery sprint, help on an open lane, transition from the change of hands, fast-break push + outlets, estimateContest look 0.5 s for shot decisions) | AI_TIMING_COMP mid 1.65, layup 1.98; 24 park games → mid 38.3%, layup 52.5%, 3PT 26.9% |
| Thirty block styles as five Block Packages (qp3, revised Oct 11) | `sim/blocks.js` (`BLOCK_STYLES` 30 specs: lead/cock/swat/off/lean/twist/legs/land/emph/spread/reachZ/headUp/situ; `BLOCK_PACKAGES` 5 × 6 with `blockPackageItems()` → `server/catalog.json` slot `block` (`min_attr` by tier [55,70,85,95], `min_attr_tall`/`min_attr_short` at 83"/73"); `blockPackageOf(p)` = `Player.blockPkg` (equipment.block) else the tier by rating ± height; `blockPool`/`pickBlockStyle` from the package by situ; `blockCallout`), `sim/bots.js` (`minAttrFor(item, height)` shared with `ui/store.js` lockReason; bots pick a block package), `server/builds.py` (`EQUIP_SLOTS` + block, `DEFAULT_EQUIPMENT.block = block_basic`), `server/app.py` (`min_attr_for` by height in `eligible`), `ui/store.js` (Blocks tab, try-on → `preview.js` 'block': a floating shot swatted away with each of the six), `ui/inventory.js`, `char/animator.js` (`blockPose` from the spec through rise → cock → swat; `blockLanding` gestures; `a.ldUsed`), `sim/game.js` (`startJump` picks `act.bstyle` by situ rim/chase/perim/any; `blockBall` sets `hit`/`hitAt` and +0.8 s for a gesture; the gesture is cancelled in `applyIntent` on any move/jump/steal intent; block events carry `style`), `game/session.js` (feed names the style; tier ≥ 4 callout for the user) | Contact sheet `/tmp/claude-0/stick.mjs` → `blocks_sheet.png` (stick figures, 4 moments × 30). Tests `tests/v0475qp7.test.mjs` (5): counts/tiers/specs unique, tier and pool rules, pairwise pose distance ≥ 0.1 RMS (min 0.108: side_reach vs shield), rig sanity for all 30, the interruptible gesture |
| Hash-Slinging dunk package (qp3) | `sim/hashsling.js` (`HS_STYLES` 6 scripts: ball keys in the body frame, hands by k, turn; `hsPath`/`hsHand`/`hsSpin`/`hsK`; `HS_TIMING` pre .15 / hang .6 / hang on the rim; `HS_POSTER` pc .88 / fall .85 ± strength / 3.1–3.8 s), `sim/shots.js` (`DUNK_TIER[HS_PKG]` 5, flair 4.4–4.8, `dunkSpin` reads the script), `sim/game.js` (`startDunk`: slam past the apex for `a.hs`; `dunkStyle`: no signature half for an `icon` package; the contact on the way up posterizes at once; `slam`: contest poster within 1.4 m ahead, hang, the `badge` event with `icon: true` on every made dunk; `posterize`: `flat` stumble), `sim/player.js` (an Icon holder without a package carries `HS_PKG`), `char/animator.js` (`HS_BODY` 6 bodies, `dunkHand`/ballHands by `hsHand`; the flat-on-the-back stumble pose), `game/hud.js` (`.badge-pop.icon`: `ICON_POP_K` 2, `ICON_POP_ART` 77, `iconBadgeSVG` with its animation), `css/app.css`, `game/session.js` (Icon activation, FLATTENED!, named callouts/feed), `game/preview.js`, `ui/store.js`/`inventory.js` (Icon exclusive), `ui/modes.js` (results card), `server/catalog.json` (`dunk_hash_slinging`, `exclusive: icon`), `server/app.py` (`grant_icon_items` on unlock + profile backfill, `eligible` by Icon, purchase refused) | Contact sheet `docs/renders/hashsling_sheet_v0475qp3.png`. Tests `tests/v0475qp8.test.mjs` (8): catalog/exclusive, the scripts (dips/wraps/hands/turns), even rolls + long flight, posters/flat/badge over 60 attempts, body traces vs all 38 styles ≥ 0.17 m (closest 0.37), the flat pose on the rig, the HUD window, hands; `tests/test_server.py` +2 |
| Reach from the model (qp3) | `char/skeleton.js` (`OVERHEAD_LIFT` 0.025, `standingReach(d)`, `bodyDims().reachStanding`), `sim/ratings.js` (`reach: bodyDims(build).reachStanding`, was `H·1.315·(WS/H/1.04)`), `sim/game.js` (`ARM_LIFT = OVERHEAD_LIFT`) | 48 games before → after: FG 40.1 → 41.1%, 3P 31.4 → 34.7%, layup 55.1 → 52.2%, blk 3.75 → 3.85, dunks 1.79 → 0.85, pts 45.1 → 45.9. Not re-tuned. Test in `v0475qp6.test.mjs` |
| Boost stock (qp3) | `server/progression.py` (`BOOST_MAX_GAMES` 35, was 10; the client reads `config.boosts.max_games`) | `tests/test_server.py` boost block covers 33 → 35 → refused |
| Transition D, bad steps, scale, feedback, scratch, overview (qp3) | `sim/ai.js` (`TRANS` traits drawn per possession in `think`: `o.transAt`, `o.transJog`; used in `defend`'s transition block; `MISTAKE` bad step in the on-ball block: `o.badStep`/`o.badDir`), `char/skeleton.js` (armScale solved from the wingspan and shoulder width), `char/athlete.js` (head centre +0.005 H, crown scale 1.08), `sim/game.js` (`ARM_EXT` 0.955, jumper release kept within 80% of the arm horizontally, layup cap lateral-aware, euro sweep by arm, `block` events carry `kind`), `sim/player.js` (`arm.armScale`), `game/session.js` (feedback for everyone via `hud.releaseOther`, scratch on any missed green and on blocked dunks; `cutGreen` returns whether it scratched), `game/hud.js` (`releaseOther`, 3 slots), `ui/screens.js` + `core/settings.js` (`shotFeedbackAll`), `css/app.css`, `game/park.js` (`OVERVIEW_NEAR` 3 m in `setOverview`) | Escape harness `/tmp/claude-0/esc.mjs`: base 7.35% (40 g); rate 0 → 6.6%, rate 1.0 → 7.2% (120 g each); shipped 0.3. Back-to-defense time sd 1.05 → ~1.2 s. Tests `tests/v0475qp6.test.mjs` (4), `park.test.mjs` (+1), `release.test.mjs` 8 mm tolerance for the WS<H build's layups |
| Got Next walk-up, Lock-In line size (qp3) | `game/park.js` (`Walker.goTo` routes straight with `routeAround(..., blockers)`; `ParkHub.blockers(w)` = solids + live courts, except for squad followers and men walking off; `routeAround` takes a solids list, 6 corner hops; `Walker` exported), `css/app.css` (`.lg-st b` 16 px, labels 9 px, row-gap 5, padding 5/8, overflow hidden) | The plaza detour (`inMid` → z −21.5) is gone. Test in `tests/park.test.mjs` (1 new) |
| The break and the alley-oop press (qp3) | `sim/ai.js` (`RUNNER`, `runnerAhead`, `passToRunner`: alley if `oopReachable(p, r, 0.7)` inside 6.5 m, quick lob when lane risk 0.35–0.9 and open ≥ 4 m, chest when risk < 0.35; read every 0.12 s in the backcourt and for 2.5 s after a break in the frontcourt; half-court `setOop` 0.32 and the human allowed; runners call for it), `sim/game.js` (`OOP_QTE`, the press set in `releasePass` for a human receiver, `oopInput`, the mistimed hop in the `oop` tick, off-the-hands / over-the-head in the catch loop, quick lobs at 30°), `core/input.js` (`facePressed`, `faceGlyph`), `game/session.js` (the press consumed first in `captureInput`, prompt and result in `updateHUD`), `game/hud.js` (`setOop`), `css/app.css` (`.hud-oop`) | AI-only, 8 Pro-Am: 1.1 alleys/g (0.9 caught), 10 lobs, pts 67.6 vs 70.4 base; 12 full-court park: 0.2 alleys, 3.3 passes ahead. Tests `tests/v0475qp5.test.mjs` (5) |
| Screens (qp3) | `sim/game.js` (`SCREEN`, `isSetScreener`, `screenAnchor`, `screenQuality`, `screenHit`; `collide` passes the pre-exchange closing speed; one hit per pair per 1.5 s; `screen` events carry `q`, `v`, `knock`, `stun`, `incidental`; the Lock-In grade ignores incidental ones), `sim/ai.js` (screener faces the defender), `char/animator.js` (stumble `fall`+`screen` pose) | 12 park games: ~23 real screens/g, 10 stops, 0.6 knockdowns; 4 Pro-Am: ~36, 28, 1.75. Tests `tests/v0475qp4.test.mjs` (5) |
| Stamina, HUD line | `sim/player.js` (STAMINA_RECOVER_K 1.2; part 3: REST_RECOVER_K 2.8 (was 1.4), MOVE_RECOVER_K 0.1 for any non-sprint movement (was neutral above 2.1 m/s, 0.6 below), hands up on the floor neutral, defensive slide still drains 0.2×), `game/hud.js` (LINE, setLine), `css/app.css` (.lg-stats 158 px = 1.2 × 132), `game/session.js` | the grade keeps its 132 px and moves left. Part 3 batch (12 park games): FG 43% / 3P 24% / 35.6 pts vs 40% / 30% / 36.4 before, within noise |

Tests: `node --test tests/*.test.mjs` (178; new: `tests/v0475qp.test.mjs`, `v0475qp2.test.mjs`, `v0475qp3.test.mjs`, `v0475qp4.test.mjs`, `v0475qp5.test.mjs`, `v0475qp6`–`qp8`) and `python -m unittest discover -s tests` (42).

**Known limits:** the model is still the v0.4 low-poly athlete (faces and hands are next in the v0.5 overhaul); knees can still brush in some strides; the Juice WRLD freestyle has no pause to split at, so its part change is mid-verse (it plays straight through).

---

# v0.4.5 (complete: seven stages, the final touches and a quick patch)

## v0.4.5 quick patch: right-stick dribble moves, deep shots, attack-bind layups, finish selection, the shot meter, the streak fire, and a second round (timing, release point, tuning, AI)

### Right stick: responsiveness

- **Why it felt unresponsive:**
  - **Flick detection.** A flick only counted if the stick went from under 0.45 to over 0.7 between two consecutive frames. At 120/144 Hz almost no real flick does that, and at 60 Hz a slightly slower one didn't either. A sweep straight from one side to the other was missed, and a spin needed more than half a turn.
  - **Chaining.** A move called during another one was thrown away after 0.22 s, so combos needed frame-perfect timing.
  - **Triple threat.** Only the step-back, crossover and spin worked from a held ball.
  - **Stamina.** Under 4% stamina, moves were silently refused. With the doubled stamina drain that happened a lot more often.
- **Fixes:**
  - **New gesture detector** (`stickGesture` in `core/input.js`), timed in seconds rather than frames. On offense, every deliberate push out of the middle is a move. A quick snap counts as a flick, as does a sweep straight across between frames. A spin is ~170° of rotation while held out. Holding the stick out fires once. Defense still reads only quick snaps as reaches, so holding a hand out doesn't reach.
  - **Moves chain:** a move called during another one waits for it (up to 0.65 s), and a spin replaces whatever move was waiting.
  - **Any move from triple threat** starts the dribble, unless you've already picked it up.
  - **Exhausted players still do the move**, up to 25% slower and with up to 25% less burst near empty.

### Right stick: snappy moves and combos

- **Every move is quicker** (`MOVE_SNAP` 0.8 in `sim/game.js`), and quicker still with a better handle: the duration is divided by `1 + 0.22·Ball Handle + 0.1·Speed with Ball` (each normalized, capped at 1.2), on top of the size-up package's speed. A crossover:

  | Build (Ball Handle / Speed with Ball, size-up) | Crossover before | Crossover now |
  |---|---|---|
  | 55 / 55, Basic | 400 ms | 289 ms (−28%) |
  | 75 / 75, Basic | 400 ms | 263 ms (−34%) |
  | 90 / 85, Quick Handle | 357 ms | 224 ms (−37%) |
  | 99 / 99, Elite Handle | 328 ms | 190 ms (−42%) |

- (The second round slows these by position and then 5% for everyone: a point guard's crossover at 75/75 Basic ends up at 277 ms, see "Dribble moves by position" below.)
- **Moves cancel into each other:** a different move called once the current one is 60% through (`CHAIN_AT`) starts right away instead of waiting for the end. The move cooldown is 55% of the move.
- **Combos are free:** a different move called during the last one or within 0.4 s of it ending (`COMBO_GAP`) costs no stamina, and each step of a combo adds a little to the ankle-breaker chance (+0.8% per step, up to four).
- **Spam is still punished:** the same move again costs stamina every time, and the repeat penalty (drain doubles after three) is unchanged.
- **Balance:** quicker moves alone pushed ankle-breakers and FG up (20 games: FG 38.0% → 44.3%, ankles 6.1 → 7.8 a game), so the base ankle-breaker chance is ×0.78. Over 40 headless games: FG 38.4% → 38.3%, ankle-breakers 6.0 → 6.75 a game.

### Deep shots

- **Past 35 ft it's luck.** From the 35 ft mark (`DEEP_D`) to the half-court line (`HALF_D`, 41.7 ft from the rim), the make chance fades from the normal value down to a luck floor, and the green window shrinks to nothing. Limitless Range fades out with it (it still helps a little before half court), a green there is no longer a guaranteed make, and the 99-rating floor doesn't apply.
- **Past half court:** at most 1% (`deepLuck`: 0.1% + 0.9% × 3PT²). A 99 three-point shooter has 1.00%, an 85 has 0.69% and a 60 has 0.27%. There's no green window.
- **38 ft, 99 three-pointer with Hall of Fame Limitless Range:** 15% without a green and 35% with one (it was a near-certain make). Without the badge: 11% and 26%.

### Attack-bind layups are timed

- **The problem:** holding the attack bind (Z, or the right stick held down) didn't count as holding the shot. When a drive turned into a layup (no dunk in the build, or out of dunk range), it was let go on the first frame and always flipped up very early.
- **The fix:** the attack bind counts as holding the shot (`stepIntent` in `game/session.js`). Hold it through the gather and let go at the top, exactly like the shoot button. On the stick: keep it pushed down and let it come back to release. You can let go of sprint once the layup has started.
- Dunks are unchanged (untimed).

### Finish selection: the highest rating wins, ties go to the archetype

- **Double-checked the old rule, and it didn't quite prioritize the highest rating:**
  - Shoot-button drives (`pickFinish`) gave the dunk a flat +8 head start, plus +4 more with an open lane, so a layup had to be 9–13 points better to win.
  - The attack bind ignored the ratings: it dunked whenever a dunk was physically possible.
- **Now** (`betterFinish` and `FINISH_STYLE` in `shots.js`):
  - Both compare the build's own ratings (as its card shows them): **Driving Dunk vs Layup**, and **Standing Dunk vs Layup** right under the rim. The higher one wins.
  - On an **exact tie**, the archetype decides: Slasher, Glass Cleaner and Post Scorer dunk; Playmaker, Sharpshooter, Stretch Big, Lockdown and Two-Way lay it in. So a 99/99 Slasher dunks and a 99/99 Playmaker lays it in.
  - A dunk still has to be physically possible (Driving Dunk 55+, enough lift, stamina). When the layup wins, the attack bind doesn't take off from the long-dunk range; it keeps driving until it's in layup range.
  - Shoot-button drives still weigh the pull-up (Mid-Range − 10, from 3 m out) and the defense: a rim protector favors the layup, a wall favors the pull-up. An open lane no longer adds to the dunk (it still takes 4 off the pull-up).
- **Balance** (40 AI park games, same seeds): FG 34.9% → 33.7%, dunks 1.4 → 0.5 a game, blocks 2.8 → 3.4. Fewer dunks because most AI guards and wings have a higher Layup than Driving Dunk, and the head start used to hide that.

### Shot meter redesign

- **One slim bar** (10 × 128 px, glass track) beside the player. The fill rises to the ideal release at 77% of the height (`METER_SCALE` 1.3), and a bright marker shows "now".
- **The window is drawn to scale from the grading code itself.** New `Game.jumperWindow`, `layupWindow` and `ftWindow` return the exact window the release is graded against, plus its `natural` part. `releaseShot`, `releaseLayup` and the free throw now grade with these functions (same numbers as before), and the meter draws them (`MatchSession.liveMeter`). The contest is measured exactly as the release measures it, at the ball one tick ahead (`Game.contestIfReleased`), and the distance from where the shot started.
- **Natural vs boosted:**
  - **Solid green core** = the window from the build's own ratings with no badges, no Icon badge, no takeover and no animation bonus (`natural`, never more than the real window).
  - **Gradient out to yellow** = everything the boosts add: Green Machine, Deadeye (under a contest), Limitless Range (from deep), Catch & Shoot, Corner Specialist, Contact Finisher (layups), the Icon badge's green bonus (Sharp Eye) and its rating boosts, the Shooting Takeover (+8 and +12% window), and a jumpshot base or layup package whose window multiplier is above 1. A base or package below 1 is part of the core, not a negative boost.
  - A hairline marks the edges of the core. A stat that plays under its rating for want of badges is all core, with nothing yellow.
- **Solid vs outlined:** solid where an Excellent is an automatic make (jumpers inside 35 ft, free throws). Outlined (a gradient ring over a faint fill) where it's perfect timing but not automatic: layups, and shots from past 35 ft.
- **No window:** smothered (the bar turns red), past half court, or a close shot (not timed, so no meter at all; the old meter showed a window there that could never be green).
- **After the release:** the bar is frozen where you let go, on the exact window that was graded (the release event now carries `err`, `tRel`, `win`, `nat`, `sure`), with the marker green, orange or red by grade. The old meter jumped to the top with a fixed, made-up window.
- **Legend:** the Tab controls overlay has a "Shot meter" legend (`meterLegendHTML`).
- **Accuracy:** the old live window disagreed with the grade on 1 release in 226 in the test sweep. The new one matches on every frame (`tests/meter.test.mjs`).

### Streak fire

- **What was wrong:** the wall was a 256 px flame picture (`flameWallTexture`) tiled every 2.4 m along each side, two copies scrolling upward with wrap. The tiling read as a repeating image, the wrap brought the glowing base round to the top of the wall, and the whole wall was rescaled every frame for "flicker", so it jittered. Each side also restarted the picture, leaving seams at the corners.
- **Now:** procedural fire in the shader (`FLAME` in `gfx/shaders.js`, `Material.flame` / `flameT` in `gfx/renderer.js`):
  - one strip all the way round the court (`StreakFX.buildFlames`), with u in metres along the edge, so the fire is continuous through the corners;
  - domain-warped value noise rising through the wall: tongues stretched upward, finer flicker inside them, tongue heights drifting slowly along the edge; hottest (yellow-white) low down, cooling to orange and red at the tips;
  - the noise wraps after a whole number of cells round the court (a multiple of 4, for the coarser octaves) and its motion loops every 240 s, so there's no seam anywhere and no jump in time;
  - no texture at all, so nothing repeats; `flameWallTexture` is gone.
- **Growth:** 1.4 m at 3 wins, 2.2 m at 6, 3.0 m at 9, 3.8 m at 12 (it was 1.55 / 2.5 / 3.45 / 4.4 m), and brighter and fuller at each step. The level eases in (no frame grows more than a few centimetres), and the mesh isn't touched while a level holds.
- The King Tut Cup's lasers are unchanged.
- **Whose streak a court shows, fixed** (`park.js`):
  - **Your court didn't light up until the tip-off, and the last court you played on could light up instead.** `myCourt` was only set once your game had loaded and was never cleared when you walked off, so while a new game was being set up the old court showed your streak and the new one stayed dark. It's now set the moment you step up (`startMyGame`) and cleared when you leave (`leaveCourt`).
  - **Kings who beat you could show a streak they didn't have.** Your games don't run through the AI court bookkeeping, so the winners inherited whatever streak the court last had (another group's). Now kings you challenged and lost to go up by one, challengers who beat you start at one, and a court you won and left starts fresh (`myOppStreak`).
  - A court with no game on it shows nothing; an AI court shows its kings' streak only while they're playing on it.

### Second round

- **Timing is everything.** A jumper, free throw or layup let go outside the green window very rarely goes in: slightly early or late keeps 5% of its chance and 3% at most; very early or late keeps 1% and half a percent at most (`OFF_TIMING` in `shots.js`). That holds whatever the rating (the 99 floor no longer covers a mistimed shot), the badges or a hot hand. A green is unchanged.
- **The green window is centred on the ball leaving his hand, for every build and animation.**
  - **What was wrong:** the ball's release point came from the sim's reach (`reach × relK`), which grows 2.5× faster with wingspan than the body model's arm does. For most builds the model's hand couldn't get there, so the ball floated up out of the hand and the visual release came as much as 0.1 s before the middle of the window (0.15–0.5 m above the fingers at the top, worst for long arms, finger rolls and contested layups).
  - **Now:** `Game.reachTop` works out the highest the ball can be held from the body model's own shoulder and arm (`char/skeleton.js bodyDims`, on `Player.arm`), with the arm 97% straight, the shoulder raised 2.5% of height (the animator now lifts the collarbone when reaching up: `Animator.liftShoulder`) and the torso's lean per jump-shot base (`SHOT_PATH.back`) or per layup package and coverage (`LAYUP_BODY`, measured off the animator's poses). The release point, the set point, the free throw and every layup finish are kept under it, and layups don't reach out further than 80% of the arm. The layup grip now matches the jumper's.
  - **Checked on the real rig** (`tests/release.test.mjs`, and a 3,000-trace sweep): every jump-shot base × the fastest and slowest release × set shot, three, fade × short, average and tall/long builds, free throws, and all 4 layup packages × 7 coverages: at the ideal release the hand is on the ball (under 5 mm short; it was up to 51 cm) and the ball and the hand both top out within one frame of it.
  - **Gameplay unchanged:** the contest and the layup block check still use the release height the build's reach gives (`holdPoint().gy`), so wingspan keeps its value and the balance doesn't move; only where the ball is drawn changed.
- **Windows 6.5% smaller across the board** (`GREEN_K` 0.9 × 0.935): jumpers, free throws, layups, every badge and package included.
- **Contest tiers bite 5% harder, each on its own** (`CONTEST_TIER_BOOST`): the contest's cut to the green window is ×1.05 in the Open, Light contest and Contested tiers (jumpers and layups); wide open (10% guarded or less) is untouched and smothered still has no window.
- **Stats under 70 aren't proficient** (`SUB70_K` 0.9, `proficient` in `ratings.js`):
  - every skill rating under 70 plays 10% below its curve (`rk`), and so does every physical one (speed, acceleration, vertical, strength, stamina): base chances, finishing, handles, passing, defense, boards, speed, bounce, stamina drain;
  - a shooting stat under 70 gets exactly a 10% smaller green window for that shot type (mid-range, three, free throw, layup), counted once (the window uses the raw curve, then ×0.9);
  - a 69 sits clearly below a 70 everywhere (the step from 69 to 70 is more than three times the step from 70 to 71).
- **Game speed −3.75%** (`GAME_SPEED`, now ×1.1187 overall) and **everyone moves 7.45% slower with the ball** (`DRIBBLE_SPEED_K`, jogging and sprinting).
- **Dribble moves by position** (`POS_MOVE_SPEED` in `game.js`, also in the store preview): PF and C moves come out 10% slower, SF and SG 5% slower, PG unchanged; then **every move for everyone 5% slower** on top (`MOVE_SPEED_ALL` 0.95). A crossover at 75 Ball Handle / 75 Speed with Ball with the Basic size-up: PG 277 ms, SG/SF 292 ms, PF/C 308 ms (it was 400 ms for everyone before the quick patch).
- **Icon pass inputs over teammates' heads** for the device in use: your key on a keyboard (your binding), the modifier + face button on a controller in your pad's symbols (`MatchSession.iconPassGlyph`).
- **Shot feedback shows % guarded:** the exact contest the release was graded with (positions, angle, hands up, length, the defender's ratings, help), as "62% guarded · Contested" (`guardedText`). It used to show the make chance.
- **Dunks:** no slow motion on slams or posters any more; every slam hits harder instead (bigger rim shake, camera kick, sparks and sound). A made dunk is thrown straight out of his hand down through the rim at 8.5 m/s (`SLAM_V`) instead of appearing above the rim and dropping at 5.5, and the dunker follows through: the arm drives down, the chest crunches over it and the knees snap up.
- **Smarter AI** (`ai.js`):
  - a basketball-IQ bump in every tier that grows with the player's IQ (+0.04 + 0.08 × IQ, `AI_IQ_BONUS`);
  - dribble moves are mixed up (`pickMove`): repeats get rarer the smarter he is, combos are favoured, and after three in a row the same move is almost never called; tired smart players dribble less;
  - shot selection knows the new timing rules: a shot that's going to be smothered is passed up, a takeover or hot hand is a reason to look for your own, tired legs a reason not to force a drive or a contested shot;
  - passers feed a teammate in a takeover or on fire (and not one who's out of gas); defenders crowd a hot shooter or one in a shooting takeover and sag off a tired handler. All of it scales with IQ.
- **The AI's timing, recalibrated:** its near-misses used to keep 85% of their chance; now they'd be worth almost nothing, so its green rate is set to keep the make rate its old timing gave it, shot for shot (`keepMakeRate`), with a per-type factor for shots that get smothered after they're chosen (`AI_TIMING_COMP`).
- **Balance** (24 AI park games, same seeds, by shot type, before → after everything above): mid-range 30.0% → 28.8%, threes 29.6% → 31.3%, layups 54.5% → 54.3%, points per game 36.5 → 35.0, game length 8.3 → 8.2 min. 40 park games: FG 33.7% → 35.1%, 3P 29.0% → 32.4%, dunks 0.5 a game either way, blocks 3.4 either way, steals 4.4 → 4.2.

### Verified

- 90 Node tests and 32 Python tests pass; lint is clean.
- `tests/streakcourt.test.mjs`: your streak lights the court you step up on from the start and leaves with you; kings who beat you carry the right streak (it fails on the old code).
- `tests/qp2.test.mjs`: off-window caps for every shot type and rating, the new constants, sub-70 (curve, windows, physicals, base chances), icon pass glyphs for keyboard, Xbox and PlayStation, % guarded, a dunk thrown down hard from the hand with no slow motion, the AI's move variety and IQ bump, the contest tier boost, dribble-move speed by position and overall.
- `tests/release.test.mjs`: the release-point sweep above.
- In the browser (headless Chromium): the feedback reads "0% guarded · Wide open" on an open green; no console errors.
- `tests/streakfx.test.mjs`: one continuous strip that closes where it started, a whole number of noise cells round the court, the four heights, smooth growth, no per-frame rescaling, a procedural shader with no texture lookups.
- In the browser (headless Chromium, Harbor Point): the fire at 3, 6, 9 and 12 wins, animating between frames, with no console errors. The seam and the 240 s loop also check out numerically (differences around 1e-13).
- `tests/meter.test.mjs`:
  - jumpers released on every frame from 10 to 60 (open, and with a defender closing out), and layups of all four packages with and without a rim protector: Excellent exactly when the meter showed the marker inside the window;
  - the frozen meter is the graded window; badges, Sharp Eye, a Shooting Takeover and a bigger-window base only grow the yellow part;
  - outlined past 35 ft and on layups, nothing past half court or when smothered, no meter on close shots.
- `tests/finish.test.mjs`: the 99/99 Slasher dunks and the 99/99 Playmaker lays it in (bind and shoot button, and in a game); the higher rating wins either way; Standing Dunk under the rim; a rim protector still favors the layup.
- In the browser (headless Chromium): the live meter, the frozen meter after a green, an outlined layup window and the legend render with no console errors.
- `tests/stick.test.mjs`:
  - flicks register at 30–240 Hz; a slow push is a move but not a defensive reach; holding out fires once; sweeps and spins;
  - moves from triple threat and when exhausted;
  - quicker moves with a better handle, cancelling at 60%, free combos, spam still costs;
  - an attack-bind layup from the Z key and from the stick: let go at the top is a green, let go on the gather is early. (It fails without the fix.)
- `tests/final.test.mjs`: past 35 ft is luck, past half court at most 1%, no green window there.
- In the browser, with a simulated gamepad: a 30 ms flick at 144 Hz and a two-frame flick at 60 Hz fire, and a slow push on defense holds a hand out without reaching.

## v0.4.5 final touches

The player-facing patch notes for all of v0.4.5 are in `PATCH_NOTES_v0.4.5.docx` (a Word document) in the project folder.

- **Timed layups.**
  - **Every layup is timed.** Hold the shot button (or the attack button) through the gather and let go at the top of the layup. Let go during the gather and it's flipped up right after takeoff, graded by when you let go (very early).
  - The shot meter shows the layup's window and fills to its top. The release feedback reads "Layup: Excellent Release" and so on.
  - The **Layup** rating sets the window the same way the shooting ratings do for jumpers. The window is 20% more forgiving than a jumper's at the same rating. The contest shrinks it, to about half against a wall of defenders (less with Contact Finisher), but never takes it away.
  - **Each layup package has its own timing** (`LAYUP_FEEL` in `shots.js`):
    - Scoop comes out early (40% of the way through the air).
    - Basic comes out at 48%.
    - Euro Step comes out at 56%, after a longer gather for the second step.
    - Finger Roll comes out late (60%) with a slightly tighter window.
  - The release point moves with every gather and jump, so you read the layup rather than count frames.
  - A green layup is a big boost (it takes 45–65% of the remaining miss chance away), not a guaranteed make, since contact can still beat it. Early or late is a touch worse than untimed (×0.92), and way off is much worse (×0.62).
  - The AI and auto-play time their layups the same way. AI layup FG% is unchanged overall (about 55%).
  - **Coverage-aware finishes** (`layupCoverage` / `LAYUP_COVER` in `shots.js`). How the defense covers the layup at the gather changes the animation, the ball's path, the finishing hand and the ideal release:
    - A shot blocker at the rim → a **reverse**: shoulders turn away, the ball is carried under to the far side and flipped up with the far hand (+7% of the air time later).
    - A defender on one side → the ball is **carried and finished away** from him with the far hand, shoulder and near arm into the contact (+3%). A Euro Step steps away from him.
    - A defender squarely in the path → the **hang and double-clutch**: knees tucked, ball pulled down to the chest and back up (+10%).
    - A chaser coming from behind → **up high and quick** off the glass (−6%).
    - Otherwise → the package's own finish.
  - In AI park games about 85% of layups get a coverage variant (mostly reverses around the rim protector).
  - The store preview of a layup package plays its own finish, then each variant in turn.
- **Jumper timings:**
  - Running jumpers come out 5% quicker.
  - Step-backs come out 6% slower and fadeaways 4% slower.
  - Threes come out 3% slower than mid-range jumpers.
  - These stack on the base's speed and the release's own time, and the ratings still set every green window (`jumperTimingK` in `shots.js`).
- **Green windows −10%, confirmed across the board:** jumpers, free throws and the new layup windows, with every badge and package bonus. The AI's green rate follows the same windows. A test checks all three.
- **Badge tiers:** confirmed and fixed (not an anomaly).
  - **Run it back** reused the badge tiers from when you arrived at the park, so a badge upgraded in the previous game still played, and showed in the team intro, at its old tier until you left the court.
  - Your badges are now read fresh for every park game and shootaround, and in the Crew HQ.
  - The team intro reads tiers from your character's record.
- **Collision:** a dribble, or a ball held out in front, could go straight through a defender's legs or chest. That happened in about 12% of live frames in AI games.
  - The ball now has a body: the handler and the player he's leaning on are moved apart, weighted by size and strength.
  - Two extra settling passes keep crowds from overlapping.
  - Measured in AI games: the ball inside a body went from 116 to 1 per 1,000 live frames, and bodies overlapping by more than 3 cm went to zero.
- **Tuning:**
  - **AI skill +10% in every tier** (IQ ×1.1, capped at 1, for AI players only): reads, reaction time, defense, shot selection and green rate.
  - **Game speed −0.75%** (×1.162 of real time overall).
  - **Stamina drain ×2 from every source:** sprinting, jumpers, layups, dunks, passes, dribble moves, reaching (steals) and jumping (`STAMINA_K` / `SPRINT_DRAIN_K`). **Screens now cost stamina** too, for the screener and for the defender fighting through.
    - The rule was: if doubling didn't bring at least a slight drop in shooting, go to ×3. It did, so it stays at ×2.
    - Shooting figures, 60 paired-seed AI park games each, same build otherwise:

      | Stamina drain | FG% | Expected make at release | Shooter stamina | 3P% |
      |---|---|---|---|---|
      | ×1 (before any doubling) | 40.2 ±1.0 | 40.9% | 0.95 | 33.0 |
      | ×2, the listed sources only | 38.4 | 39.4% | 0.87 | 32.5 |
      | ×2, every source (shipped) | 38.2 | 37.9% | 0.79 | 32.8 |
      | ×3, every source (not used) | 38.5 | 38.4% | 0.59 | 35.3 |

    - Players under half stamina go from 0.8% of the time at ×1 to 12% at ×2 and 33% at ×3.
  - **Rebound/block assist +3.75%** (the user's reach toward the ball and the mid-air steer).
- **The King Tut Cup courts** have a sphinx medallion at center court instead of the KTC placeholder: a recumbent sphinx with a striped headdress, beard and forepaws, on a plinth, in gold. On the 2v2 and 1v1 courts it sits inside the half, facing the hoop end. The neon copy of the lines glows its outline and stays off the medallion.
- **Balance (AI world, final build, 60 park games):** FG 38.2%, 3P 32.8%, shooter stamina 0.79. With the stamina doubling switched off, the same build shoots 40.2% (see the table above). These count every field goal in the box score, putbacks and tips included, so they read a little lower than the release-event counts in the stage 7 notes.
- **Verified:**
  - 56 Node tests. New `tests/final.test.mjs`: layup timing per package, green at the top and untimed taps, jumper timings in a game, the 10% windows, fresh badge tiers, the ball and bodies staying apart, AI/speed/stamina/assist values, and the sphinx.
  - 32 Python tests.
  - Headless browser: the sphinx on full and half Cup courts, and a timed layup in the shootaround with the meter and "Layup: Excellent Release".

## v0.4.5 stage 7: performance and the final touches

- **Hitching and freezes in the parks, fixed.** The cause was building people in the middle of a frame. When a background game ended, the losers walked off and the next group stepped on; a group of park-goers arrived; you started or left a game. Each time, every athlete involved had its meshes and its painted face, jersey and shorts made at once. In the headless benchmark (software rendering) at the King Tut Cup, a full-court rotation stalled the frame for about a second and a population update for about two. A gaming PC is several times faster, but those were still visible freezes, and the Cup's three full courts rotate all night.
  - **New athlete pool** (`client/js/game/vispool.js`):
    - People who step onto a court keep the athlete they walked over in, and the ones walking off keep theirs.
    - Anyone new is built a few milliseconds per frame and appears when ready. A background game waits at the check until all its players are there, and new arrivals walk in once they're built.
    - Your own game's players are built over the frames before it starts, while the park keeps running. You play in the athlete you walked over in, and the shootaround uses it too, so no second copy of you is built.
  - **Lighter far-away people:** walkers and background players get smaller textures (384 face, 256 jersey and shorts), and jersey trim paints about 6× faster.
  - **Shaders:**
    - They compile in the background where the browser supports it.
    - Each venue's shaders are compiled when it loads.
    - The set your PC has used is remembered and compiled up front next time.
  - **Less mid-game work:** the renderer reuses its per-frame lists, so there's less garbage collection. Every court's streak effect (flames, or the Cup's lasers) is built when the park loads.
  - **Result, same benchmark:**

    | | Before | After |
    |---|---|---|
    | Full-court rotation | 1,020 ms | 2 ms |
    | Population update | 2,120 ms | 6 ms |
    | Starting your game | 900 ms | spread over about 30 frames |
    | Leaving the court | 1,040 ms | 3 ms |

    No frame went over 6 ms of game work while new people were being built.
- **Out of bounds on the painted lines,** like a regulation game, on every court: full, half, 2v2, 1v1, the arena and the HQ.
  - The court's measurements run to the inside edge of the 2-inch lines, and the lines themselves are out.
  - The ball is out when it touches the floor on or past a line (a dribble included). A player is out with a foot on or over one.
  - In half-court games the half-court line is the back line.
  - A ball that goes over the top of a backboard is out.
  - The boundary lines are now painted just outside the playing area, so what you see is the rule.
  - AI ball handlers never step out on their own.
- **Auto-play (H) stays on** from one game to the next until you turn it off: park, Pro-Am, the Pro Run and crew runs. A game that starts with it on says so. The shootaround always starts with you in control.
- **Alley-oops:** an AI teammate only goes up for one if he can run to a takeoff spot short of the rim in time and get up to the ball. Anyone further out gets a regular lob instead (yours too, with a message), so nobody flies in from half court any more. Alley-oop dunks now count in the stats.
- **Smarter AI:**
  - After breaking a defender's ankles, slashers, playmakers and bigs take it straight to the rim for a dunk or layup. Sharpshooters, stretch bigs and lockdowns rise up right there, or take a dribble or two in first if they're too deep.
  - Fewer pointless kick-outs. A driver who's cut off takes the floater or pull-up when it's there, and only passes to a teammate who's open and has a better look.
  - A handler doesn't give up a better shot just because someone is calling for the ball.
  - Fewer head-scratchers: decisions have less random noise.
- **Every animation package is its own,** checked one by one in the store preview and in games. A new test traces each package with the real animator and rig (hands, forearms, feet, head, hips and the ball). It requires at least 17 cm between any two packages in the same category during the move, in the store and in games.
  - **Jump-shot bases:**
    - Each carries the ball on its own path: pocket, set point and timing. The Hitch pauses at the top, the Slingshot and Silk go up in one motion, and the Sway drifts out.
    - Silk (Daily Spin) has its own base; it used to share Skyline's.
    - Wide Stance, Lean Back, Fadeaway and Scissor Kick were exaggerated so they read clearly.
  - **Releases:**
    - Every one has its own follow-through, held for its full time even after he lands, so the Statue really holds. Some examples: Quick finishes at the forehead and drops while still in the air, Dart throws the arm out flat, Float drifts down, Butter rolls the wrist, Feather keeps the guide hand up wide, Rainbow keeps tracing the arc, Laser brings the guide hand up like a visor, Snap recoils, and High keeps both hands up.
    - Each release also has its own release time and launch angle.
    - The store preview now launches the ball at the release's angle.
  - **Dunk packages:**
    - Each has a signature finish that no other package has. The store shows it first (then on every other loop), and it's about half of the package's dunks in games.
    - New signatures:
      - Rim Rocker: a two-hand hammer from behind the head, heels kicked up.
      - Contact Dunks: shoulder into the defender, ball high and away.
      - Showtime: wraps the ball around his back in mid-air.
      - High Flyer: the Superman, stretched out with the ball held out front.
    - The Hammer now cocks the ball over his shoulder (the tomahawk goes straight back).
    - One-hand finishes really are one-handed. The hand switch, the Eastbay and Showtime finish in the other hand.
  - **Size-ups change the ball too:**
    - Each has its own dribble height, width, rhythm and in-place combos. The Snake slides it across and back, Stutter hesitates, Showtime goes behind the back and through the legs, and Pound has no combos at all.
    - Rhythm finally has its own body language.
    - The store preview shows a real size-up at the package's speed.
  - **Celebrations:** Shimmy (fists low, knees dipped), Shrug and Crown (opens up to present it) were made more distinct.
- **Green windows are 10% smaller everywhere:** jumpers and free throws, with every badge and package bonus. The AI's green rate follows the same windows.
- **Also fixed:** the Ante-up message at the start of a Cup game was wiped as the game started; it now shows.
- **Verified:**
  - 48 Node tests. New `tests/stage7.test.mjs`: the line rules, a foot on the sideline, alley-oop reach, auto-play carrying over, the AI after an ankle-breaker, the 10% windows, distinct packages in the store and in games, dunk signatures, and the athlete pool.
  - 32 Python tests.
  - Headless browser:
    - the King Tut Cup hitch benchmark (rotations, arrivals, starting and leaving your own game);
    - store preview screenshots of the new animations;
    - Pro-Am with auto-play carried over;
    - the Crew HQ shootaround;
    - the park shootaround handing your athlete over and back.
  - AI balance with the final build, 60 park games: FG 42.7% and 3P 34.7%. Stage 6 ran about 41–44% FG in the same batches, so the change is within the noise even with the smaller greens and fewer bogus alley-oop dunks.

## v0.4.5 stage 6: The Pro Run

- **The mode:** a career in the **Afterhours Pro League** (APL), from the new **The Pro Run** tile on the main menu (and the top bar). One career per player; it's saved on the local server after every step.
- **College:** pick one of 12 original colleges and play **3 games** (5-on-5, four quarters, in the arena dressed in the home school's colors). Scouts rate each game from your line (Hollinger game score, scaled to a full 48 minutes), the win and your Locked-In grade; the college screen shows your projected draft range after each game.
- **The draft:** two rounds of 32. Draft stock 32 or better goes first overall and every point below that is about two picks later, down to #64. The order runs weakest team first (a lottery shuffles the top four). Draft Night lists all 64 picks — the other 63 are generated prospects — and the team holding your slot takes you.
- **The league:** 32 original teams in two conferences of 16, each with a full 15-man roster (13 veterans from about 67 to 90 OVR plus two rookies from the draft). An **82-game season**: 2 games against every team in the other conference, 4 against five conference rivals and 3 against the other ten — 41 at home, nobody plays twice in a day or three days running.
- **Your games:** **Play** them in the arena (you and the best player at each other position on your team against their best five; home team in white, visitors in color; the jumbotron and LED boards say APL) or **Sim** them. Every other game is simulated from the teams' rotations, with full box scores. Sim a week or to the end of the regular season at any time.
- **Standings, stats and awards:** conference standings (W-L, PCT, GB, conference record, last 10, streak), your schedule and game log, your team's roster and rotation, league leaders, then MVP, Finals MVP, Rookie of the Year, Defensive Player of the Year and the scoring title.
- **Playoffs:** seeds 1–6 in, 7–10 in the **play-in** (7v8 for the 7 seed; the loser hosts the 9v10 winner for the 8 seed), then four rounds — first round, conference semifinals, conference finals and **the Finals** (2-2-1-1-1 home court). Play or sim your games; sim day by day or to the end once you're out. After the Finals, start the next season (same teams, a new schedule).
- **Sim settings** (any time): quarter length for games you play (3, 5, 8 or 12 minutes), difficulty, your minutes in simmed games (auto, starter, sixth man, bench), playoff series (best of 7, 5-7-7-7, 3-5-7-7 or single games), play-in on/off, upsets (fewer, normal, more) and home-court advantage.
- **Rewards:** games you play pay **VC and badge progress at 1.5x the park rate** (the park formula without a streak). There's no Rep or crew XP in the Pro Run, and simmed games pay nothing. **No music** in Pro Run games, like Pro-Am. Pro Run games get their own split on the Stats screen.
- **Server:** mode `prorun` for `/api/matches` (arena only, quarters 2–12 minutes), migration `008_v045_prorun.sql` (`prorun_careers`), `GET /api/prorun?character_id=…` and `POST /api/prorun` (save, or reset with `career: null`; saves up to 2 MB).
- **Verified:** 32 Python tests (new: the 1.5x VC and badge rule, no Rep, a clock game needs a winner, a big career save round-trip, Pro Run tickets) and 37 Node tests (new `tests/prorun.test.mjs`: original names, the 82-game schedule rules, box scores add up to the final, a full season through the play-in and Finals and the same seed giving the same league, sim settings, the draft slot from college games, and a played game counting). Headless browser: the new career screen, three college games, Draft Night, the season hub and its tabs, a simmed and a played pro game, the playoffs and the offseason.

## v0.4.5 stage 5: Crews and the Crew HQ

- **Crews:** start one from the Crew HQ door in any park, the social phone's new **Crew** tab, or the park pause menu (**Crew**). Pick a name (3–24 characters), a 2–4 letter tag and one of 12 colors; you can change them later. Up to **39 members** (40 with you), added only from your friends and removable any time. Anyone you unfriend leaves the crew; what he earned stays with it.
- **40 crew levels.** Level *n* needs 2,500 × (*n* − 1)^1.75 crew XP in total (level 2 at 2,500, level 10 at about 117k, level 40 at about 1.5M). Each level's reward shows **Coming soon**.
- **Crew XP from your games:** about 30% of the Rep a game pays, weighted by mode (park ×1.1, Pro-Am ×1.3, park events such as the King Tut Cup ×1.5), and **doubled** when a crew member ran on your team (park squads and Pro-Am rosters both count). The results screen shows the crew XP, the ×2 when it applied, and crew level-ups.
- **Crew XP from your members, even while you're away:** each AI member earns crew XP for every hour he's online on his normal schedule (the same schedules that decide who is at the parks), at the rate of the park games he'd play in it, so better players and higher Rep earn more. The server settles it whenever the crew is read, so the totals only grow and can't be edited from the game. A full crew of 39 regulars earns roughly 25–30k crew XP a day.
- **The Crew HQ:** the clubhouse building on every park's plaza (west of the Daily Spin wheel, door facing the courts). Inside: a full 5-on-5 court and a shootaround half court in your crew's colors (paint, center logo with your tag, wordmarks), crew banners, a bleacher, a lounge with couches facing the **members board** (who's on, overall, position and crew XP), the **crew level board**, and a taped-off corner for **interior customization — coming soon**. Crew members who are online hang out there: on the couches and the bleacher, around the lounge, or getting shots up on a free hoop. Walk to the members board for the crew menu, the ball rack for a shootaround, the scorer's table for 5-on-5, and the door to go back to the park.
- **5-on-5 crew runs** need at least **4 crew members online** (you make five): you and your four best members on, against the next crew members on, topped up with regulars. Crew jerseys in your color against a contrasting side, full court, first to 21. Runs are practice — no VC, Rep or crew XP — and you can run it back from the results.
- **Server:** `server/crew.py` (levels, XP rules, a port of the client's AI schedules, settling), migration `007_v045_crews.sql` (`crews`), `GET /api/crew`, `POST /api/crew` (create / update / add / remove), and crew XP in `/api/matches/{id}/complete` (which now also takes the AI teammates who ran with you).
- **Verified:** 30 Python tests (new: the schedule port matches the client exactly, the level curve and XP weights, and an API run — create, add friends only, the 39 cap, remove keeps the XP, AI members earn over time, ×2 with a crew mate, idempotent completes) and 30 Node tests (new: the HQ building is clear of courts, shops, lamps and sidewalks in every park, the HQ floor plan, crew colors, who shows up at the HQ, and a full 5-on-5 to 21). Headless browser: crew creation, the phone tab, the crew menu, the HQ door, the HQ interior and boards, a 5-on-5 run with its results, the shootaround, walking back out, and the crew XP line on the results screen.
- **Also fixed (stage 4 hotfix):** Pro-Am and Practice crashed while building the arena and the gym (a stray line from the Cup's neon pass). Fixed in commit `2ce5cd0`; every venue now gets a build check.

## v0.4.5 stage 4: The King Tut Cup

- **The event:** a fourth park with the same layout as the others, under a black-light night: neon court lines, purple keys, pyramids with glowing edges and gold capstones on the skyline, two sphinxes guarding the plaza, obelisks with glowing bands, green-fire braziers, a glow-in-the-dark mini-golf strip along the north edge and laser-tag barriers (with dark gaps between them) around the outside. Lanterns drift overhead, and the random events are laser shows from the pyramid tops and green and purple fireworks. Enter it from the event card on the Park screen. The music ducks during games there exactly as in the parks.
- **Ante-ups:** every game in the Cup is played for VC. When you claim a spot you pick a stake (500, 1,000, 2,500, 5,000 or 10,000 VC); it comes out of your wallet when the game starts. A win pays it back plus the other side's stake, boosted by your Cup win streak with the park's multiplier (+0.30 per straight win up to 4x), on top of the normal game VC and Rep (also streak-boosted). A loss — or leaving the game — keeps nothing of the stake. Run it back keeps the same ante. The Cup has its own streak and record; your park streak is untouched.
- **48-hour leaderboard:** the Cup runs in back-to-back 48-hour windows. The board ranks net VC won in the Cup (everything the games paid, minus every stake) against the AI hoopers from your AI world who entered that window (about 200 of them; they play during their own online hours and their totals grow through the 48 hours). The board is computed on the server from the AI world's seed, using the same RNG and tier rules as the client, so it can't be edited from the game. A neon billboard on the plaza shows the top five and you.
- **Prizes** (claimed once from the Park screen or the leaderboard when the window closes): 1st — the glow-in-the-dark **mo-cap suit** (top and tights, with glowing seams and tracking markers), Pharaoh shoes, the Pharaoh celebration, the Scarab glow headband and 150,000 VC; top 3 — shoes, celebration, headband, 60,000 VC; top 10 — celebration, headband, 25,000 VC; top 25 — headband, 10,000 VC; top half — 3,000 VC; anyone who played — 1,000 VC. Cup gear can't be bought.
- **Streak visuals (every park):** after 3 straight wins a wall of fire rises around the court of whoever holds it — you or an AI team — and grows at 6, 9 and 12 wins (it stops growing at 12; the streak doesn't). In the Cup the same steps bring green lasers that slide up and down the court sides and phase in and out, more of them and brighter every 3 wins.
- **Server:** `server/cup.py` (windows, AI field, standings, prizes), migration `006_v045_cup.sql` (`cup_entries`), `GET /api/cup`, `POST /api/cup/claim`, ante handling in `/api/matches` (start, complete, cancel).
- **Verified:** 27 Python tests (new: the RNG port matches the client, the board is deterministic and fills in over the window, the prize table, and an API run: ante taken at start, pot and streak multiplier on a win, nothing back on a loss or a quit, Cup streak separate from the park streak, the running Cup can't be claimed, prizes pay out exactly once, the ledger reconciles) and 25 Node tests (streak levels, Cup entrants and who shows up at the Cup). Headless browser: the event card, leaderboard, ante picker, the Cup park, lasers and the flame wall.


## v0.4.5 stage 3: visuals and animations

- **32 new animation packages** (on top of v0.4.4's 16), each with its own body language, ball path and sound of its own kind:
  - **Jumpshot bases (6):** Fadeaway, Hitch, Slingshot, Scissor Kick, Knee Tuck, Sway.
  - **Releases (6):** Wave, Statue, Snatch Back, Old School, Point, Cobra.
  - **Dunk packages (6):** Hammer, Liberty, Scoop, Hand Switch, Half Spin (the body turns 180° in the air) and **Eastbay** (between the legs), which needs 87 overall, 92 driving dunk, 90 vertical and Superstar rep.
  - **Size-ups (5):** Pound, Snake, Crab, Stutter, Showtime. Every older size-up package got its own stance too.
  - **Celebrations (6):** Goggles, Dust Off, Airplane, Mic Drop, Take a Bow, Roar.
  - **Layup packages (4, a new slot):** Basic (free), Euro Step, Finger Roll, Scoop. Your package decides how every drive finishes.
  - The packages with the most requirements (High Flyer, Eastbay, Showtime, Cobra) are the flashiest and are gated by overall, attributes and Rep.
- **Icon badge animations** (unlocked with the archetype's Icon badge, and nobody else can get them): Sharp Eye's exaggerated high-set jumper and fanned follow-through; Hash-Slinging's six-finish dunk package (qp3, `sim/hashsling.js`); Oprah's one-handed whip pass; The Clamp's two-hand clamp steal; The General's stand-to-attention salute; Big Brother's cocked-arm swat; Open Arms' two-hand rebound rip; Sexy Red's low, wide post back-down (and backing anyone down now has a pose of its own).
- **Clothing:** jerseys are cut on curves now — a U-shaped scoop in front, a shallower one in back, wide straps and deep armholes — with a rolled binding around the neck and armholes, so they no longer look strapless or sit inside the chest. Shorts got a rolled hem that folds back to the leg, so a driven knee can't show the inside of the shorts. The body is slightly slimmer through the chest and waist and the tops hang closer to it.
- **World:** shops are real buildings now (walls, a serving window and counter on each side, striped awning, stocked shelves and a worker inside) instead of boxes with a sign. New trees (tapered leaning trunk, branches, layered canopy), palms (ringed trunk, arching fronds with midribs, coconuts), park benches (slatted, with armrests), bins and lantern street lamps. Harbor Point has real water: two scrolling swell layers over a deep base with a surf line at the beach, and proper sailboats with hulls, keels, cabins and bellied sails.
- **Verified:** 26 Node and 23 Python tests (new: every package's style has a pose, a ball path, a tier and a flair value; the 180 and 360 dunk turns). Headless browser: every new package previewed in the showroom, and the park shops, trees and water.


## v0.4.5 stage 2: park life and UI fixes

- **Squad spots and the line (`world/themes.js` `squadSpots`, `game/park.js`):** every court has three rows of squad spots by its east sideline, with GOT NEXT, 2ND and 3RD painted on the ground. Row 0 has next. When a game ends the losers are forced off the court and have to walk back around to the back of the line themselves (about half of losing AI groups do), the Got Next group plays the winners, and every row behind moves up one. You claim the first open row with your squad; the row you're in and your place in line show in the prompt and on the phone.
- **AI-only games run faster:** a background game you can see plays at normal speed while the ball is live and fast-forwards checks, inbounds and dead balls (2–3x). Games you can't see run 2.6x. Over a whole game that comes to about twice as fast. Players and the ball animate at the game's own pace, so nothing slides. (The spec asked for "normal speed on screen, but delayed behind real time"; a game can't be both behind real time and finished sooner, so this is how we read it: normal speed where it counts, fast everywhere else.)
- **Squad joining:** you can only invite friends who are online and not in a game. At your park that means not on a court or in your game; at other parks, a player is in a game about 45% of the time (in ~6-minute blocks). The phone shows "In a game" instead of the Invite button.
- **Spectators:** 4 people sit on the benches and 2 stand on the sidelines of every full court; half courts get 2 sitters and 1 stander. They follow the ball, clap ordinary buckets and steals, get up (or throw their arms up on the bench) for dunks, posters, alley-oops, deep threes and clutch shots, and grab their heads for blocks and ankle-breakers. They react to your games too, and only animate when you're within 45 m.
- **Walking fixes:** park-goers never aim for a spot inside a shop or the Daily Spin wheel, route around them with corner waypoints, and give up and repick a spot after 2.5 s of no progress.
- **Bleachers:** the two small bleachers between the main court and the stores are gone.
- **Main menu:** a tile hub (The Park, 5v5 Arena, MyPLAYER, Store, The Gym, Lifetime stats, Codes, Social) that fits the screen at 720p and up with no scrolling.
- **Phone:** the close X no longer moves when it gets controller focus.
- **Music:** park games already duck the music. The King Tut Cup event courts (stage 4) will use the same ducking; The Pro Run (stage 6) will have no music, like Pro-Am.
- **Verified:** 23 Python and 22 Node tests (new `tests/park.test.mjs`: squad spot rows, routing around shops, line shifting, the AI-game speed rule; squad invites reject players in a game). Headless browser: park hub with spectators, rows and labels.

## v0.4.5 stage 1: gameplay core

v0.4.5 ships in six stages. This first one is the gameplay and progression core. Still to come: visuals and 32 animation packages, The King Tut Cup, Crews and the Crew HQ, and The Pro Run.

- **Badges (`sim/badges.js`):**
  - Each tier step is 10% bigger than the one before (Bronze 1.00, Silver 2.10, Gold 3.31, Hall of Fame 4.64 in effect units, instead of 1-2-3-4). Every badge effect in shots, game and AI goes through `bk()` or a rescaled tier table.
  - **No-badge penalty:** a stat that one or more badges work through plays 10% weaker (rk ≈ 0.9×) when the player has none of those badges. Menus still show the real rating; gating checks (can he dunk at all) use the real rating.
- **Stamina overhaul:**
  - Sprinting drains the most (35% faster than v0.4.4). Jogging, defensive slides and hands-up defense drain a little. Standing, walking and posting up recover (more slowly than before). Every action has a small cost (shot, layup, dunk, pass, reach, jump, dribble move).
  - The same dribble move more than 3 times in a row doubles drain, then +0.1x per extra repeat. A different move, a pass, a shot or a catch resets it.
  - Every second positive play (score, assist, board, steal, block, good contest, ankle-breaker, screen) gives back 5% stamina and turns on 2x recovery (never more than 2x) until a negative play.
  - The same negative play twice in a row with no positive play between (turnover, forced or badly timed shot, foul, got blocked, posterized, gave up an open shot, got crossed) doubles drain, then +0.1x per repeat, until the next positive play.
  - Lock-In grade (user): A+ 1.5x / A 1.25x / A- 1.1x recovery; D+ 1.1x / D 1.25x / D- and F 1.5x drain.
  - Going cold puts 1.5x on drain until it ends; going hot gives 1.5x recovery. Every multiplier stacks.
- **Hot and cold:** 3 straight Excellent-release makes or finishes at the rim puts a player on fire (+6% make chance, 1.5x stamina recovery, ends on a miss). More than 3 missed wide-open shots (contest under 0.3) makes him cold (ends on a make). A flame or an ice crystal shows on the floor under the player, replacing the user's ring, and the HUD shows ON FIRE / COLD.
- **Takeovers:** PG/SG shooting (6 Excellent-release jumpers with no miss, block or off-green release in between), SF/PF finishing (6 made layups or dunks with no miss or block), C glass and rim (6 blocks or rebounds before the other team scores in the paint). They last 60 real seconds: +8 to the group's attributes, and the shooting one also widens the green window 12%. The HUD shows progress and time left.
- **Defense:** contest range +3.75%; positioning +3.75% on blocks (reach envelope, lunge), contests and rebounds (grab radius, seals); block timing +3.75%; hands up on a shot, a hand in the passing lane and a defender set in the driving lane all add 3.75% pressure. The user gets a slight assist: block and rebound jumps curve toward the ball in the air, and guarding a post-up gently holds you between the post player and the rim.
- **Posterizer:** the shove-and-knockdown happens only on dunks, and only for players with the badge. Without it, a dunker who wins the contact bumps the defender off his line (no knockdown). A strong finisher can push off a defender on a layup (a short stumble, never a knockdown). Shoves are velocity only (no position jumps), dunkers no longer pass through bodies, and the rim hang glides into place instead of snapping.
- **Rules:** traveling is called in every mode (moving more than 0.9 m with a held, undribbled ball after a 0.45 s gather). Taking it back past the arc after a change of possession was already enforced in half-court park games; the full-court park no longer shows the take-it-back hint.
- **Dribbling:** cadence, height and width vary by Ball Handle, speed and height (tight, low and quick for elite small guards; higher, wider and slower for bigs).
- **Attack the rim:** with an open lane and full speed, the bind now takes off from up to 5.8 m (it was 4.2 m), with longer gather steps.
- **Speed and feel:** game speed −1.85% (×1.171 of real time overall); pass speed −0.985%; starts, stops and turns slightly softer.
- **90 OVR cap, cap breakers, Icon badges:**
  - Caps are scaled so every legal build tops out at exactly 90 OVR (checked for all 61,440 position, archetype, height, weight and wingspan combinations). Existing players keep any attributes already above their new caps.
  - Each of a build's first 5 Hall of Fame badges brings 5 cap breakers (25 max). A cap breaker adds +1 to a maxed-out attribute below 99, past the 90 cap. The menu opens after the game that earned them and from MyPLAYER → Attributes. Builds that already had HOF badges are credited once.
  - A build holds at most 7 HOF badges (others stop at Gold). The 7th unlocks the archetype's Icon badge: Sharp Eye, Hash-Slinging, Oprah, The Clamp, The General, Big Brother, Open Arms or Sexy Red. Their stat boosts can pass 99 in the sim. Their exclusive animations come with the animation stage.
- **Economy:** store prices, attribute upgrades and boost packs cost 35% less; every game pays 35% more VC; the park streak bonus is doubled (+0.30 per straight win, up to 4x VC and Rep).
- **Results:** in the park, the results screen continues by itself after 10 seconds (run it back after a win, back to the park after a loss), unless you're placing new cap breakers.
- **Focus:** the game no longer pauses when you click out of the window (Settings → Pause on focus loss turns it back on).
- **Soundtrack:** 25 tracks (added RIP Aaliyah, Groove of the Streets (Instrumental), Root-Beer Float, Discord Notis and Gone).
- **Balance (AI world, 80 park games / 16 Pro-Am):** park FG 37.1% and 3P 36.1% (v0.4.4: 39.8 / 35.9); Pro-Am FG 35.8% and 3P 31.0%. About half a takeover and half an on-fire run per park game; 0.1 travels per game.
- **Verified:** 23 Python and 17 Node tests (new: 90 OVR for every build, costs and VC, HOF limit, cap breakers, the Icon badge, badge tiers and the no-badge penalty, stamina rules, hot/cold, takeovers, traveling, Posterizer-only knockdowns, long attack-the-rim takeoffs). Headless browser: cap breaker menu, badges tab with the Icon badge, results countdown, Pro-Am intro with flame and ice decals and the takeover HUD.


## v0.4.4

- **Brick Wall:** bump contact only triggers it for the defender. Screen contact triggers it on either end, for the screener or the defender fighting through. Screen contact is skipped while a shot is up, for the shooter, and during shoot, layup, dunk, landing and celebration actions, and it needs a moving defender. An open three can no longer set it off.
- **Speed and contests:**
  - Game speed is ×1.0375 on top of v0.4.2's ×1.15 (×1.193 overall). Clocks still count real seconds.
  - Every contested state shrinks the green window 3.75% more. Open looks are unchanged.
- **Archetypes:** strengths and weaknesses are trimmed about 20% (×1.4 → ×1.12, the same on client and server).
- **Rating curve (`ratings.rk`):** used for every attribute effect in shots, game and AI.
  - **Under 70:** falls off steeply. The green window is about 22 ms at 50, 32 at 60 and 42 at 70.
  - **Over 95:** extra weight.
  - **99:** a big step (rk 1.32 vs 0.95 at 95). The green window is about 104 ms vs 62.5 at 95. Open 99 shots that aren't badly mistimed have a floor of 90–96%, which only the defense's contest (scaled by its own ratings) and fatigue reduce.
  - **AI green odds** follow the same curve: capped at 0.65 normally, 0.72 above 95 and 0.88 at 99.
- **Lifetime stats:**
  - The server now keeps per-mode splits (`career_modes`: park and Pro-Am, with games, seconds, wins and every box-score stat).
  - The new **Stats** tab and the pause-menu modal show averages, shooting splits (FG, 3P, FT, eFG, TS), totals and highlights, and compare every build.
- **Auto-play profile (`sim/profile.js`):**
  - With auto-play on, the AI's tendencies for your player blend from your archetype to your stat-derived numbers as games pile up (weight gp / (gp + 4)): shot volume, three share, drives, passing, dribbling, steals, boards, blocks, ball security.
  - His green odds are scaled so his twos, threes and free throws land near your career percentages (shrunk toward the mode average for small samples).
- **Defensive hands (right stick on defense):**
  - **Reaches:** flick left or right for that hand, and a ball-side reach has much better odds. Flick down for a low swipe.
  - **Holds:** hold up for hands up. Hold to a side to keep a hand in that passing lane, which adds deflection odds on passes that way.
  - **Keyboard:** the arrow keys do the same.
  - **Animation:** the animator mirrors the reach per hand and extends the held-out hand.
- **Chains:** the gold and iced-out chains are real meshes:
  - a tube of links that rests on the traps and dips to the chest over whatever top is worn;
  - a textured link pattern (gold, or pavé stones with glints);
  - a pendant: an original "16" medallion, or iced rings.
- **Clothing clearance:**
  - **Tops:** garments now drape over every body bulge but skip the grooves. Untucked tops always clear the shorts by 7 mm or more (measured over builds from 6'0" 170 to 7'0" 280). Tucked Pro-Am jerseys sit inside the waistband. Hoodie and compression sleeves overlap through the elbow.
  - **Shorts and joggers:** never tighter than the thigh.
  - **Headbands:** sit on the hairstyle's real outer surface.
  - **Gear:** offsets are larger. Arm sleeves go over compression and are hidden under hoodies. Leg sleeves are hidden under joggers and socks tuck under them. Knee pads go over joggers. Wristbands go over hoodie cuffs.
  - **Depth bias:** a small polygon offset per material layer settles near-ties (shorts 2, top 3, worn-over gear 4, shoes and chain 5).
  - The showroom now rebuilds when only an animation package changes. Store previews of jumpshots and releases were showing the old package.
- **Persistent AI world (`sim/world.js`):**
  - **The pool:** 900 accounts per player account, seeded from a value saved on the server (`ai_world` table). Each account has a skill tier (Casual 20%, Regular 33%, Hooper 26%, Elite 16%, Park Legend 5%) with a level, IQ and Rep range, a position, a home park (14% drift between parks), and a habit with daily sessions in local time plus random extra sessions.
  - **Builds:** each account's build, gear and look are generated deterministically. Gear respects the same overall, attribute and Rep requirements as a player's, and flashier, pricier items show up more on better and higher-Rep players. Badge count and tiers scale with level (Casuals 0–2 low-tier, Legends a full set with Hall of Fame signatures). Attributes spread wider, and each archetype's two signature attributes stand out.
  - **Skill separation:** overall medians run about 56 / 66 / 74 / 80 / 84 by tier. In simulated park games, Hooper vs Regular was 6-0 (avg +8.3), Park Legend vs Regular 6-0 (+10.8), Elite vs Hooper 4-2 and Regular vs Casual 4-2.
  - **IQ in the AI:** reaction time (about 0.39 s at IQ 0.1 down to 0.14 s at 1), option-value noise, how heavily pass risk counts, contested-shot discipline, green odds, closeout reads, pump-fake bites, steal timing and correct-hand reaches. The difficulty setting nudges everyone.
  - **Park population:** courts and park-goers come from accounts online at this park now. Empty courts are possible at quiet hours. A population tick every 20 s sends logged-off people walking out and brings arrivals in from the plaza. Kings who log off leave their court. When a game needs bodies, a regular who was about to come on "hops on early".
  - **What's saved:** friends, squad and met (games with and against, wins together, last played; the most recent 400), saved to the server with a short debounce.
- **Social phone** (LB+RB / L1+R1, O on the keyboard, a top-bar button, and in the pause menus):
  - **Tabs:** Park (everyone online at your park, with an OVR + position circle ringed in their tier colour, and what they're doing), Friends (online status, or when they're usually on), Squad (up to 4 online friends) and Recent.
  - **Player cards:** build, tier, Rep, habit, home park, badges and your record together.
  - **Squad:** squad mates follow you around the park, fill your Got Next line first, and play with you in Pro-Am. Pro-Am fill-ins are regulars matched by position and level.
  - **In games:** intro cards tag SQUAD and FRIEND and show Rep. The results screen lists everyone from the game with an Add button.
  - **Menus:** bumpers switch tabs on release, so LB+RB can open the phone.
- **Soundtrack:**
  - The 20 supplied tracks play shuffled with no immediate repeats. They're ducked to 65% under park games and fade out for Pro-Am, then resume with a "BACK ON" ticker.
  - An early-2000s style now-playing ticker sits in the bottom-left corner (it scrolls long titles and hides after 6.5 s).
  - The server streams the mp3s with byte ranges. Music on/off and volume are in Settings.
- **Locker Codes tab:** HELP-I-NEED-VC pays 250,000 VC, 3 times per account. Codes are case and space insensitive, redemptions are idempotent per request key, and the account keeps a redemption ledger.
- **Animation packages:** 16 new packages, 10 with no requirements and 6 locked behind overall, attribute or Rep requirements. Details are in the README. Each new base, release and celebration has its own pose and follow-through in the animator, and DUNK_TIER, BASE_FEEL and the size-up levels know the new ones.
- **Verified:**
  - 18 Python tests and 14 Node tests pass. The new tests cover the rating curve and the 99 floor, AI-world determinism, tier separation, legal gear, the online-by-hour spread, the friend and squad rules, the auto-play profile, and locker codes plus AI-world validation on the server.
  - Headless runs:
    - the Stats tab;
    - Locker Codes: 3 redemptions then refused, bad code refused;
    - the soundtrack: ticker, next track, a byte-range request, Pro-Am suppress and resume;
    - the park: a squad mate followed into Got Next, pause → Lifetime stats keeps the game paused and resumes on close, auto-play profile present, results Add friend, Recent tab, back to roam with the follower;
    - the Pro-Am roster with the squad mate;
    - the gamepad suite;
    - frame-by-frame shots of the new jumpshots, releases and celebrations, and clothing views (jersey, tee, hoodie with joggers, compression, high-top and curls hair) from the front, side and back and through a jumpshot.
  - Balance (small, noisy batches):
    - `tools/sim_batch.mjs park 16` (fixed-level bots): FG 41%, 3P 34%, about 3 blocks and 3 steals a game. v0.4.4's first curve pass had FG 34% and 3P 27%.
    - `tools/sim_world.mjs mix 12` (mixed-tier world accounts): FG 41% and 3P 41%. The higher three-point rate comes from Elite and Legend shooters.
    - `sim_batch proam 6`: FG 39% and 3P about 42%.

## v0.4.3

- **Defense:**
  - **Contests:** in the paint, a contest is weighted mostly by Interior D and Block (plus Rim Protector), and height and length count for more. Rim protectors also cover a little more ground in the lane. On the perimeter, Perimeter D carries the contest. Defenders in the air at the release add more with a higher Block rating.
  - **Blocks:**
    - Shot blockers travel toward the ball when they jump. How far depends on Block, and in the paint on Interior D and height too.
    - Rim protectors challenge drives from further out and time their jumps better.
    - Block odds at the rim use Block, Interior D and the height difference. On jumpers they use Block and Perimeter D.
    - Only the best-placed defender gets a block attempt (three bigs in the lane no longer stack rolls).
    - Jump-shot closeouts go straight up, so they don't lunge into the shooter.
  - **Box-outs:** a sealing player is heavier to push the higher his Interior D and rebounding, plus his Interior D edge over the opponent. The rebound winner depends more on the rebound rating, size and that seal. Defenders anchored in the paint are harder to move.
  - **Perimeter D** sets the defensive slide speed and adds to steals. Interior D also stops more dunks through contact.
- **Build disparity:** archetype attribute bonuses and penalties are ×1.4, the same on client and server. AI tendencies per archetype (shoot, drive, pass, dribble, cut, spot-up, pop, post, crash, help, press, safe):
  - **Slashers** drive and cut.
  - **Sharpshooters** relocate to the most open arc spot.
  - **Playmakers** dribble, pass first and call for the ball back.
  - **Stretch bigs** pick-and-pop and fill gaps as help defenders.
  - **Glass cleaners** anchor the paint, help first, crash the boards and make safe plays.
  - **Post scorers** back their man down to the block, and kick it out when doubled.
  - **Lockdowns** press the ball.
  - AI hoopers carry archetype badges (2–5, mostly Bronze/Silver). The AI's contest estimate now counts a close defender's jump, which cut down forced, smothered jumpers.
- **Shooting settings:** Shot meter and Shot feedback toggles (on by default). With the meter off, your green window is 10% wider. A new Node test checks that, for every jumpshot base × release, the ball reaches its release point exactly at the centre of the green window.
- **Controller / camera fix:** the cause of running off the court was the stick mapping, not the camera. The 2K cam swings round on a change of possession, but the stick stayed on the old direction while held and flipped to the new one 2.5 s later or on release, so "up" stopped meaning up the screen. The 2K cam is unchanged in every mode. The stick now follows the camera's current framing, damped exactly like the camera, so a held stick stays up-screen and the player turns with the play through the swing, as in NBA 2K. A Node test drives a full-court possession swing and checks that the stick follows the view to within a few degrees, that it turns smoothly, and that "up" points at the new basket afterwards.
- **Presentation:**
  - Team intros (park: OVR, build and top 3 badges; Pro-Am: five per team with the most-used badge).
  - A post-game box score for every player with a live Rep bar that handles rank-ups. Results are saved while it plays.
- **Sneakers:** shoes were vertex-coloured with sRGB values treated as linear (washed out, nearly white) and details too fine for the mesh. They now use a UV-mapped shoe shell with closed heel and toe, painted textures, and nine distinct original models. All gear colours are linearised.
- **Animation packages:**
  - **Jumpshot bases** have their own speed, window, set point, release height, leg action and lean.
  - **Releases** have their own follow-through.
  - **Dunk packages** have tiers 0–3: longer takeoffs, more lift and hang, style weighting toward flashier finishes, and new 360, cradle and double-clutch paths. Higher tiers make contact finishes and posterizers hit harder (shove, knockdown odds and duration). Flashy dunks get extra rim shake, slow-motion and named callouts.
  - **Size-up packages** give faster moves and chains and more ankles, plus in-place crossover and between-the-legs rhythm with shoulder jabs.
- **Audio bug:** the "air / rummaging" sound was the crowd bed, a 2-second loop of white noise that played from the first click at a constant level in every menu and mode. It is now off in menus and the gym, built from 9 s of pink-noise murmur bands, and its sources stop when the crowd is off.
- **Park life:** people walking and jogging on the sidewalks (some with dogs, some stopping to watch), plus a scheduler that fires a random event every 15–35 s:
  - **Downtown:** taxis and cars, an elevated train line with passing trains, and a helicopter with a real sweeping searchlight.
  - **Seaside:** sailboats, speedboats with a wake, and gulls.
  - **Industrial:** a forklift, a container crane at work, freight trains, welding sparks and steam.
  - **Everywhere:** birds and planes.
- **Pro-Am arena:**
  - Announcers follow the ball, nod, and react to threes and dunks.
  - Photographers' flashes fire on shots, dunks and blocks, and a camera operator pans with the play.
  - Subs sit on the benches and there's a courtside VIP row.
  - Crowd shader: excitable fans stand and raise their arms on big plays, clap on dead balls and free throws, start an occasional stadium wave, and give an ovation at the end.
- **Verified:**
  - 17 Python tests and 11 Node tests pass. New tests cover release timing, defense weighting and box-outs, archetype tendencies, package differences, and the stick following the 2K cam.
  - Headless runs: the Pro-Am and park intros and outros through results, the gamepad suite, remapping, Daily Spin and boosts. The crowd bed is off in menus.
  - Balance (`tools/sim_batch.mjs`, park 16 games and Pro-Am 6 games, noisy): park FG about 36–39% and 3P about 31–33%, with about 4 blocks a game, mostly by bigs (guards' block share fell). Pro-Am FG about 38–39% and 3P about 35–45%. Steals rose in park games (Lockdowns press). Archetypes now differ clearly in shot mix: sharpshooters take most threes, glass cleaners and post scorers rebound and score inside.

## v0.4.2

- **Shooting and controls:**
  - **Bailout:** pass out of a jumper any time before the release, on the floor or in the air. Bailouts are a bit less accurate, especially from the air. AI shooters smothered at the top of a jumper kick it out to an open teammate.
  - **No greens when smothered:** at a contest of 0.75 or more (the HUD's "Smothered"), the green window is zero and the meter outline turns red. This applies to the AI too.
  - **The right stick is only for dribble moves and attack-the-rim** (down while sprinting). Pro Stick shooting is removed.
  - **15% faster game:** the simulation runs at 1.15× real time. Clocks and the reported game duration stay in real seconds, and timing windows are scaled so the green feels the same.
  - **Turn and fade:** shooters square up to the rim on the gather, turning in the air if needed. Moving away from the hoop gives a fade. This also fixes an angle-averaging bug that could leave a shooter facing away.
- **Dunks:**
  - You have to reach the rim with your hands, otherwise the dunk becomes a flip at the rim.
  - Contact on the way up resolves from dunk rating plus Close Shot against the defender's size, strength and Interior D. The outcome is to finish through it, posterize, or get stopped.
  - **Posterizer** shoves the defender back or knocks him down for 2.4–3.2 s with a shove/fall animation. Collisions with the posterized defender are skipped, so no one passes through anyone.
  - Traffic finishing, block odds and the dunk-or-layup choice all scale with Driving or Standing Dunk plus Close Shot.
- **Ball dynamics:**
  - Rim contacts get a small deterministic deflection and variable bounce, so made/missed pre-simulation stays exact.
  - **Poke-outs** send the ball sideways or behind the dribbler, low and skipping. The dribbler can't recover it for 0.55 s.
- **AI passing:** a teammate calling for the ball gets it in about 0.06–0.14 s when he's open and the lane is clean. The handler holds it only while the lane is clogged. Base AI reaction time is faster too.
- **Parks:**
  - Every park has **six courts:** three full courts (3v3 played full court with tip-off, inbounds and a shot clock), two 2v2 half courts and a 1v1 half court.
  - The practice hoop moved beside the 1v1 court.
  - Roaming park-goers are kept off any court with a game on.
- **Shootaround gym:** both sideline bleachers now sit against the walls with the seats facing the court.
- **Daily Spin:**
  - A wheel next to the VC Store, one spin per account every 24 hours, rolled on the server.
  - Five VC tiers: 500 (34%), 2,500 (26%), 10,000 (14%), 50,000 (4%) and 250,000 (0.2%).
  - Exclusive gear (12%) and animations (9.8%): 10 new wheel-only items. If you already own every exclusive of a kind, that roll pays VC instead.
- **Boosts:**
  - A kiosk on the other side of the store sells six categories, each +5 to every attribute in the category (capped at 99).
  - Packs are 1, 3 or 5 games (600, 1,500 or 2,250 VC), up to 10 games stocked per category.
  - A boost game is used when a park or Pro-Am game tips off.
- **Streak multipliers:** park wins pay VC and Rep ×(1 + 0.15 per straight win after the first), up to ×2.5. The results card shows it.
- **Badge banner:** your badges show at the top of the screen when they change a play, queued in activation order.
- **Animation and models:**
  - The jump-shot follow-through brings the arms down by the sides without elbows flipping out.
  - Relaxed hands follow the crouch, and the dribbler's off hand sits in a guard position.
  - A body-clearance pass keeps hands out of the torso and hips in idles, size-ups and dribble moves.
  - Character meshes are about 25% denser, and their seam normals are welded, so the hard "blocky" seam lines are gone.
- **Server:** migration `004` (daily spins), `/api/daily-spin`, `/api/boosts/purchase`, wheel and boost config in `/api/config`. Park formats are now 1, 2 or 3.
- **Verified:**
  - 17 Python tests and 7 Node tests pass.
  - Headless flows: a full-court 3v3 park game through results with server rewards, 2v2, practice, Pro-Am, the gamepad suite, remapping, the Daily Spin spin and boost purchase.
  - Simulated balance: park FG about 39% and 3P about 33%; Pro-Am FG about 37%. Pro-Am pass completion is about 98%.

## v0.4.1 (quick patch)

- **Button remapping:** every keyboard/mouse and controller action can be rebound in **Settings → Remap buttons…**. It flags conflicts, resets to defaults, and the controls lists follow your bindings.
- **Dunks:**
  - a dedicated attack-the-rim bind (Z, or right stick down while sprinting) dunks whenever the player physically can, otherwise it takes the best finish
  - driving with the shoot button now prefers a dunk, unless layup or pull-up ratings are clearly higher; then the highest rating wins, adjusted for the defense (a rim protector favors a layup, a defender walling off the lane favors a pull-up)
- **Passing:**
  - release speed and ball speed scale with Pass Accuracy, with a tighter error spread
  - passes lead the receiver, with a limited in-flight correction (turn-rate and total-angle budget), so they aren't heat-seeking
  - a bigger catch radius for the intended receiver
  - teammates no longer intercept each other's passes
  - in simulated Pro-Am games, pass completion went from about 89% to 98%, and interceptions held at 1–2%
- **Rebounding:**
  - AI predicts the landing spot with the real ball physics (rim and glass bounces)
  - rebound jumps are timed to meet the ball
  - defenders hold box-outs until the ball comes off the iron and get inside position
  - only bigs (and anyone already close) crash the offensive glass
  - who wins a rebound now depends more on position and the rebound rating than on luck
  - OREB% fell from about 50% to about 33%
- **Locked-In grade:** a teammate grade from F to A+ in the top-right of every mode (park, Pro-Am, practice), with live +/− callouts and a final grade on the results card. You can hide it in Settings.
- **Fix:** Xbox controllers were being shown PlayStation button prompts ("Xbox Wireless Controller" matched the PlayStation pattern).
- **Verified:**
  - 14 Python tests and 7 Node tests pass (new: finish selection, pass completion, grade)
  - headless remap test: keyboard key, mouse button and controller button, plus reset
  - the dunk gesture in practice, the gamepad suite, and the park and Pro-Am flows
  - balance: park FG about 40%, Pro-Am about 38%
- `Afterhours16.exe` rebuilt as version 0.4.1.

## v0.4.0

## New in v0.4

- **Afterhours16.exe:** a small Windows launcher (Go, standard library only, about 6 MB). It finds Python (or offers to install it), starts the service hidden, opens the game fullscreen in its own Edge/Chrome window and profile, and stops everything when you quit. A **Quit to desktop** button appears in launcher mode. The service also stops by itself if the window is closed, and it tolerates the PC sleeping.
- **Lock-in:** fullscreen plus the Keyboard Lock API (F11 or a setting), so the browser can't steal keys. The right-click menu and Ctrl shortcuts are blocked in game, and the game auto-pauses when it loses focus.
- **Controls and responsiveness:**
  - every press is buffered until the 60 Hz simulation consumes it, so nothing is dropped on high-refresh monitors or during animations
  - stick input stays relative to the camera's rest direction and is latched while the camera swings
  - analog walk-to-jog speed
  - retuned acceleration, braking and turning
  - shorter lockouts after passes, catches and steals
- **Native controller support:**
  - Xbox, PlayStation and Switch Pro controllers through the standard mapping, with auto-detected button glyphs
  - full menu navigation (D-pad or stick, A/B, LB/RB tabs)
  - radial deadzones, analog triggers, Pro Stick shooting (hold RS; removed in v0.4.2), flick and rotate moves
  - rumble on green releases, makes, dunks and posters, blocks, steals, ankle-breakers and bumps
  - settings for vibration, deadzone, prompt style and inverted camera
- **Greens always go in** unless blocked. Contest, movement, fades and range now shrink the green window instead of lowering the make chance, and the shot meter shows the live window. The AI can hit greens too, at rates tied to its ratings.
- **Player models:**
  - anthropometric proportions instead of cartoon proportions
  - a sculpted torso (chest, shoulder blades, abdomen) and anatomical limb profiles
  - five-finger hands
  - real eyeballs set in carved lids, ears and a natural hairline
  - alpha-strand hair
  - detail normal maps for skin pores and jersey mesh or knit
  - two-lobe skin specular
  - full-resolution faces for your player, lighter ones for everyone else
- **Animation and physics:** jump shots, running and landings are driven by published biomechanics:
  - jump shots: dip depth, triple extension, jump height, release just before the apex, release height
  - running: stride length, cadence, contact time, walk and run center-of-mass motion, pelvis and trunk motion
  - landings: absorption scaled by the touchdown speed
- **Showroom:** walk, jog and sprint treadmill previews.

## Verified

- `python -m unittest discover -s tests`: 14 tests, including the new launcher-only quit and ping checks.
- `node --test tests/geometry.test.mjs tests/sim.test.mjs`: mesh winding, shot planning, and full park and Pro-Am games.
- Headless Chromium run-throughs:
  - home, Park hub → Got Next → game → results, Pro-Am → results, practice
  - a scripted gamepad test: menu navigation, LS/RT movement, RS flick moves, X shot timing
- Launcher, tested on Linux with a stand-in browser:
  - start, health check, window heartbeat
  - idle shutdown
  - **Quit to desktop** stopping the service (exit code 3) and closing the window
- The Windows .exe was cross-compiled and checked as a valid PE32+ GUI binary with icon and version resources. **It hasn't been run on a real Windows PC yet.**
- Animation checked frame by frame from the side: knee angle at the bottom of the jump-shot dip about 115°, about 155° in flight and about 128° at landing.
- Balance (`tools/sim_batch.mjs`): park AI FG is about 41–46% and 3P about 37–40%. Pro-Am FG is about 38% and 3P about 36%. Batches are small and noisy.

## Known limits and next steps

- Animation is still procedural (pose targets plus IK), not motion-captured. v0.5 plans to bring in real capture data; see `docs/V0.5-PLAN.md`.
- Faces are better but still read as sculpted masks up close. v0.5 plans to replace the procedural mesh with a CC0 base mesh and blendshapes.
- Single player only: teammates and opponents are AI. Since v0.4.4 they're persistent AI accounts with schedules, so the park is quiet in the early morning.
- AI accounts' builds and gear are fixed per world; only their Rep creeps up over time (up to +4 levels). Friends' online times follow your computer's clock.
- On integrated GPUs, use Medium or Low if the Park drops frames.
