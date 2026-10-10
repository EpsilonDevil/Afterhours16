# Afterhours 16 — v0.4.7.5 Patch Notes

v0.4.7.5 is the clean-up before the v0.5 graphics and physics overhaul. Limbs collide with the body, poses move on springs and the jersey straps always show. Badges are restricted by build, contests mean more and your max OVR now grows through The Pro Run. Animations are doubled, the stick has a full move set and the AI plays smarter. The park gets two Got Next spots, a live court overview with streak bounties and a score ticker. Green releases now come with sounds and effects you can buy. There's a new Inventory, 19 new soundtrack tracks and an in-game bug reporter.

---

## Animation and the player model

### Limbs that collide
- **Arms stay out of the body:** elbows, forearms and hands are kept outside the torso (the model's real cross-section plus a little padding). Hands also stay out of the head and out of other players.
- **Legs stay apart:** feet keep at least 6% of body height between them and knees at least 6.6%, so legs no longer pass through each other.
- **Behind-the-back and through-the-legs moves** keep the dribbling and catching hands on their own side of the body.
- **Measured over two AI park games** (frames with a limb inside the body):

  | Clipping | Before | After |
  |---|---|---|
  | Elbow inside the torso | 139 | 1 |
  | Forearm inside the torso | 126 | 7 |
  | Hand inside the torso | 43 | 9 |
  | Hand inside the head | 18 | 0 |
  | Feet overlapping | 183 | 14 |
  | Knees touching | 384 | 92 (mostly legs passing in a stride) |

### Smoother, less rigid motion
- **Spring-smoothed poses:** everything that isn't planted or driving an explosive action eases in and out on a critically damped spring, instead of snapping from pose to pose.
  - The head and arms settle a beat after the body (secondary motion), and nothing overshoots.
  - The springs run at a fixed rate, so the feel is the same at any frame rate.
  - Shots and finishes keep their exact timing, since the release is measured off them.
- **Idle life:** players breathe and shift their weight when standing.
- **Natural reaching:** rebounds, blocks and contests reach up and out like a person does, with a landing recovery, instead of arms shooting straight up.

### The model
- **Jersey straps always show:** the straps, the binding and a band along the top edge of a jersey are drawn just over the skin under them. A shoulder or trap moving underneath can't poke through any more, even with arms up on a jumper.
- **Trapezius:** the neck now slopes into the shoulders instead of standing on them like a post.
- **Skin under the floodlights** wraps the light softly (with a warm scatter) and has a soft edge where it turns away from the camera, so limbs read as rounded rather than as a hard shell.

---

## Badges

### Restricted by archetype and height
- **Every badge has a highest tier your build can reach:**
  - Set by your **archetype** first. For example, a Sharpshooter's shooting badges go to Hall of Fame but Posterizer stops at Bronze, and a Glass Cleaner's rebounding and rim badges go to Hall of Fame while jump-shot badges stop at Bronze.
  - Then adjusted by **height** (five bands):
    - Small, 6'2" and under: one tier up on Ankle Breaker, Handles for Days, Acrobat and Pick Pocket; Rim Protector capped at Silver, and Rebound Chaser, Brick Wall, Posterizer and Chasedown at Gold.
    - Medium, 6'3"–6'6": Rim Protector capped at Gold.
    - Tall, 6'7"–6'9": no change.
    - Big, 6'10"–7'0": one tier up on Rim Protector, Rebound Chaser and Brick Wall; Ankle Breaker, Handles for Days and Limitless capped at Gold.
    - Giant, 7'1" and up: like Big plus Posterizer up, and the guard badges capped lower.
- **The same rules hold for you and the AI.**
- **MyPlayer shows each badge's cap** ("Max Gold", locked tiers greyed out) and how many badges can reach Hall of Fame on your build.
- **Your Icon badge** unlocks at your 7th Hall of Fame badge, or at every Hall of Fame your build can reach if that's fewer.

### Badge art
- **Every badge has its own glyph**, and the frame dresses up with each tier: Bronze, Silver, Gold, Hall of Fame.
- **Hall of Fame badges are vibrant everywhere:** one living, shifting color gradient in MyPlayer, the game intro, the badge pop-up, results and the social phone.
- **Icon badges:** each archetype has its own design, in white with gold and a full-spectrum color center.

---

## Progression: 80 OVR with VC, then The Pro Run takes you to 90

- **A new build upgrades to 80 OVR with VC.**
- **Every 3 Pro Run games you play to the end raise your max OVR by 1**, up to 90.
  - After the 3rd game, and each 3rd after it, a card says **"+1 MAX OVR Unlocked!"** before your results.
- **Cap breakers unlock at 90 max OVR.** They have their own **Cap Breakers** menu in MyPlayer → Attributes, so you can place them whenever you like after they're unlocked. Earned ones are banked until then.
- **Builds already past 80 keep their overall.**

---

## Shooting and finishing

- **Contests mean more without your badges:** for a shot with none of its badges, every bit of contest bites a fifth harder (and shrinks the green window more). Wide-open shots are unchanged, so a good look at base level needs to be open and needs a high rating.
- **On fire: +3%** make chance (down from +6%).
- **Takeovers last 90 seconds** (up from 60) and add **+6** (down from +8).
- **Wide-open dunks** (10% guarded or less) by anyone over 70 in that dunk rating never miss.
- **Contact Finisher:**
  - Works like Posterizer's push-off on layups: it shoves an equal or slightly stronger defender off you, bigger with every tier.
  - The space it makes takes 8% per tier off the contest.
  - When a dunk is stopped short and you're forced into a layup or a pull-up, Contact Finisher takes over instead of Posterizer and finishes through the contact.
- **Hustle shots** (rising up at full speed):
  - toward the rim, a **running pull-up**: the quickest release of all (10% quicker), with a slightly smaller window;
  - away from it, a **running fade**: 10% slower, with the tightest window;
  - a **pro hop** into the shot: a hop step first, so 16% slower, with a normal window.
  - Each has its own animation and timing, to add a skill gap for guards.

---

## Dribbling, passing and defense

### The stick
- **14 dribble moves in 4 families, plus spins:**
  - **Crossovers:** crossover, hang dribble, between the legs, in-and-out.
  - **Behind-the-backs:** behind the back, wrap.
  - **Escapes:** stepback, sidestep, retreat dribble.
  - **Momentum dribbles:** hesitation, stutter, momentum push.
  - **Spins:** spin, half spin.
- **Each stick combination calls its own move:**
  - **Sideways to the other hand:** a crossover. While sprinting it's between the legs, and a slow push is a hang dribble.
  - **Sideways to the ball's side:** in-and-out.
  - **Down:** a stepback standing, a behind-the-back on the move, and a retreat when you're pulling away from the rim.
  - **Down-diagonals:** a wrap to the other hand, or a sidestep to the ball's side.
  - **Up:** a hesitation, or a momentum push when you're sprinting.
  - **Up-diagonals:** a stutter.
  - **Rotate the stick:** a spin, or a half spin when you're standing still.
- **21 named combos** (killer crossover, hesi crossover, double crossover, cross into a stepback and more) bite harder and show in the feed.
- **Every size-up package plays the moves its own way:** speed, burst, ball height, width, flair and its own signature moves. There are 20 packages.
- **Snappier with a better handle:**
  - Moves come out instantly.
  - The burst snaps in faster.
  - The next move can cut in sooner: 60% of the way through at a 60 handle, 40% at 99.

### Passing
- **Passes go to the teammate closest to where you're aiming** (the left stick, or where you're facing without it).
- **You turn to him before the ball leaves your hands** if you need to. Direction comes first, and there's no extra bend on the pass.

### Defense and the boards
- **Fixed:** X / Square on defense is a steal, not a jump to block, even in the moment the possession flag lags behind.
- **Box-outs physically stop the man sealed behind you.** He's held there and is late to the ball, the feed says who boxed out whom, and you win more boards.
- **Posting up is stamina-neutral** for the post player and his defender.

### Speed
- **Checked:** sprint speed is the same in every mode, with or without the ball, on offense, on defense and in transition.
- **Speed spreads players like every other rating**, so faster players feel faster.
- **The park roams at game pace.**

---

## Animations: doubled

- **Jump-shot bases: 30** (15 new). **Releases: 32** (16 new). **Dunk packages: 28** (14 new). **Size-ups: 20** (10 new). **Layup packages: 8** (4 new: reverse, hop, floater, spin). **Celebrations: 34** (17 new).
- **Spread across every category**, each with its own motion. Every pair is checked to be visibly different.
- **Movement styles (new):** 12 ways to walk, jog and run around the park and on the court, plus the standard one: Smooth, Bouncy, Swagger, Heavy, Shifty, Upright, Hunched, Loose, Strut, Glide, Sprinter and Laid Back. **Every AI player has his own.**
- **Dunks look like their names:**
  - a windmill's arm goes all the way round;
  - the 360s (and the spin-mill and helicopter) turn a full circle;
  - new finishes include the two-hand windmill, side-mill and back-scratcher.
- **Ankle-breaker victims go down 9 different ways,** depending on what got them: crossed up he slips, tangles or does the splits; spun out he gets turned right round; plus sit-downs, stumbles, leans, faceplants and going down to a knee.

---

## The AI

- **Every AI hooper has dribble habits of his own** and uses the whole bag of moves, with named combos, picking moves to fit the situation (blocked, shut off, probing, escaping, attacking).
- **Less dead dribbling:** dribbling in place is down by about a third, and handlers who stall look for something.
- **Smarter offense:**
  - wide-open shots in range get taken;
  - crowded shooters make space with an escape dribble;
  - handlers call for screens, and bigs come and set them on their own;
  - off-ball players cut into open lanes and relocate to open spots.
- **Cherry-picking gets read:** a smart team keeps a safety home, and the man who leaked out is picked up early and his pass jumped.
- **Lock-In grades for every AI player**, and they feed his stamina just like yours.
- **Shooting recalibrated** for the harsher contests (36 AI park games): mid-range 34.6%, threes 31.9%, layups 53.0%.
- **AI players get better as they play** (slowly, about +1 OVR for every dozen games), whether they play with you, against you or on another court. Their progress is saved with your AI world.

---

## Green releases: sounds and effects

- **Green release sounds:** when a green goes in, it plays your sound. Each one is synthesized live and changes a little every time:
  - **14 in the VC Store:** Eagle Screech, Greeen Chant (the crowd chants it), Cha-Ching, Air Horn, Jackpot, Rubber Duck, Laser Blast, Big Gong, Level Up, Thunderclap, Kazoo Charge, Heavenly Choir, Cannonball and Slide Whistle;
  - plus the free Classic Chime;
  - plus **Pharaoh's Horn**, a King Tut Cup exclusive (top 10).
- **Green release effects:** a show over your head when a green goes in.
  - **12 in the store:** Green Fireworks, Green Splash, Green Flame, Green Lightning, Halo, Crowned, Confetti Cannons, Aurora Beam, Smoke Ring, Pixel Star, Comet and Twister;
  - plus the free Green Burst;
  - plus the **Golden Ankh**, a King Tut Cup exclusive (top 3).
- **Threes and clutch greens** put on a bigger show.
- **Every AI player has his own sound and effect,** and plays the sound at his own pitch and tempo. No two players on a floor share one.
- **Preview** both in the store and the Inventory (with a "Hear it" button for sounds).
- **Settings → Green releases:** Everyone, Mine only or Off.

---

## The park

- **Two GOT NEXT spots per court,** one on each side of the GOT NEXT stencil on the ground. The 2nd and 3rd rows are gone.
  - **Whichever squad fills its spot first runs next.** The other squad waits for that game to end.
- **Court overview:** hold **View / Share** (V on the keyboard) for a live bird's-eye view of the whole park.
  - Every court shows its score, the game's target, the kings' streak and how many squads are waiting.
  - It also shows the **bounty** for breaking the streak.
- **Court bounties:** kings on a streak above 6 have a VC bounty on them:
  - 2,500 VC at 7 straight, +750 for each win after that, up to 15,000;
  - paid by the server to whoever breaks the streak, and shown on your results;
  - a bounty seal floats over the court as you walk around the park.
- **The Got Next ticker:** while you're on a spot, the score of the game on that court shows in the bottom right, with the kings' streak, whether you run next and any bounty.
- **Squads:** closing the game leaves your squad. Old squad mates who choose to keep running together stay a group at the park, and the phone tells you.

---

## Store, Inventory and menus

- **New Inventory:** everything you own, by category, with the 3D try-on. You equip things here, away from the store.
- **The store only sells:** buy, then "Equip now" or keep shopping.
- **Jump-shot bases and releases are separate categories** in both the store and the Inventory.
- **Categories are grouped:** Apparel, Animations and Green Releases.
- **Menu and HUD polish (same look, cleaner):**
  - the top bar fits on one line, with Stats and Locker Codes as icon buttons;
  - panels fit their content;
  - keyboard and controller focus rings;
  - sliders in the accent color;
  - tiles that wrap instead of cutting off;
  - name tags on soft plates in games;
  - cleaner feed and scoreboard edges.

---

## Soundtrack

- **19 new tracks** from the files you sent.
- **Compression:** they were compressed losslessly (tags and embedded art stripped, audio untouched). MP3 is already compressed, so that only saved about 0.3 MB in total. Re-encoding would lose quality, so I didn't.
- **Long mixes in parts:** the three long mixes are split so every file stays under 25 MB (the most the transfer to your PC takes in one file, and well under GitHub's limits). Don Toliver – MIXTAPE is in three parts; Juice WRLD – On & On and chill carti songs pt. 2 are in two each. The splits are at a quiet moment where there is one (the freestyle has none). Each part plays straight after the last.
- **The soundtrack now has 44 tracks.**

---

## Report a bug

- **Press F8 anywhere** (or use **Report a bug** in Settings or the pause menus).
- **Say what happened.** A game in progress pauses while you write.
- **The report is saved to `Afterhours16_Bug_Reports.txt` in your Afterhours16 folder** (next to Afterhours16.exe). It includes:
  - where you were and the game state;
  - the last 25 errors and 40 game events;
  - your system and settings.
- **Send that file along** to get the bugs in it fixed. It stays out of the GitHub repo.

---

## Under the hood

- **Version 0.4.7.5.** Your save, players, VC and AI world carry over; nothing in `data/` is touched.
- **Tests:** 121 game tests and 39 service tests pass (new ones cover collisions, straps, badge caps, the OVR path, moves, passing, box-outs, AI, green releases, Got Next priority, bounties, AI growth, the Inventory, the soundtrack and bug reports).

---

# Quick patch

Everything below came after the first v0.4.7.5 build. Your save, players, VC and AI world carry over; nothing in `data/` is touched.

## Shooting

### Shooters and non-shooters
- **Only shooters get a sure green from three.** That means Sharpshooters and Stretch Bigs. For everyone else, a green from 3PT range and beyond is a big boost, not a guaranteed make. The meter draws that window outlined, not solid.
  - From mid-range, a green still goes in for everyone.
  - A non-shooter's green from three goes in about 50–70% of the time, depending on his 3PT rating and the contest.
- **Non-shooters' jumper windows are 10% smaller**, on top of everything else.

### Green windows
- **Every green window in the game is 10% smaller again.** That covers jumpers, layups and free throws, badge and animation bonuses included.

### Smothered means no make
- **A smothered shot never goes in.**
  - It shows no green window, and nothing can add one back: not a badge, an Icon badge, a takeover or a jumpshot base.
  - It used to keep up to 3% from slightly early or late timing.
- **Layups and close shots are measured on their own scale.**
  - Around the rim the old contest number topped out on nearly every finish, because somebody is always there. Four in five layups were labelled "Smothered" and still went in about half the time.
  - Now Smothered on a finish means a real wall-up: a defender squarely in front with his hands at the ball. That's about one finish in six in AI games, and those never go in.
  - A Contact Finisher's push-off can take you out of it.
- **The record scratch:**
  - If a green is blocked in flight, a record scratch cuts its green sound off.
  - If you time a release perfectly into a smothering contest, the green sound starts and the scratch cuts it off. That tells you the timing was right but the defense won.
  - The AI's green sounds get the same treatment.

### Contests count at the release
- **The AI's shots now answer to the defense at the release, not just at the start of the shot.**
  - The AI picks its timing when it rises, from the contest it expects then.
  - A closeout that arrives in time now shrinks the window it was aiming at, and its green slips to a near miss as often as the window shrank.
  - A defender who backs off can turn a near miss into a green.
  - Your own shots were already graded on the contest at the release; the meter shows it live.
- **Release height against reach counts for more out on the floor.** A high release over a shorter (or later) contest is less of a penalty; a long defender who gets a hand up at the release is more of one.
- **In the paint, weight matters:** a heavier defender walls off a little more of a finish (up to ±10%).
- **AI percentages were re-measured afterwards** over 72 AI park games:

  | Shot | v0.4.7.5 | Quick patch |
  |---|---|---|
  | Mid-range | 34.6% | 34.9% |
  | Layups | 53.0% | 51.5% |
  | Threes, all | 31.9% | 28.1% |
  | Threes, shooters | n/a | 35.6% |
  | Threes, non-shooters | n/a | 24.3% |

## Dribbling, passing and defense

### Repeated moves
- **Spamming a move costs more stamina.**
  - More than 3 of the same move in a row still doubles your stamina drain (+0.1× per repeat after that).
  - **More than 6 in a row doubles that penalty again:** 4.6× at the 7th, up to 6×.
  - A repeat is the same move again within 3 seconds while you still have the ball. Passing, shooting, picking it up or losing it ends the run.
  - Before, a run could carry over after a steal and keep draining you on defense.

### The stick's diagonals
**Every diagonal now does two things**, depending on whether you're moving with the left stick:

| Diagonal | Standing | On the move |
|---|---|---|
| Up, to the ball's side | Stutter-step | **Jab step** (new) |
| Up, to the other hand | **Push-pull crossover** (new); a slow push is a stutter | **Push-pull crossover** |
| Down, to the ball's side | Sidestep | **Snatch-back** (new) |
| Down, to the other hand | **Pull-back** (new: between the legs, stepping back) | Wrap |

- **17 new named combos**, for example: Jab crossover, Push-pull stepback, Snatch-back crossover, Pull-back and go and Hesi push-pull.
- A few size-up packages count the new moves as signatures: Jab, Rocker, Elite, Blur, Pound, Crab and Pendulum.
- The AI uses the new moves too.

### Dribble speed and game speed
- **Every dribble move is 20% slower**, in every package and at every rating. That covers stick moves and size-up combos in place.
  - Better packages and handles are still quicker, in the same proportions as before.
  - The burst eases off less than the timing slows, so moves still cover about the same ground. A stepback still makes its space.
- **The game as a whole runs 2.5% quicker** to meet it halfway.

### Passing
- **Every pass is 10% more accurate:** 10% less aim error, and the ball steers onto the receiver 10% better in flight.

### Reach-in fouls
- **Reach-ins are called on contact, not on chance.**
  - Where the reaching hand ends up decides the call.
  - Into the ball handler's body, or the arm he's dribbling with, without getting the ball first: a foul nearly every time (80%), more so reaching across his body.
  - Hand on the ball first: all ball. There's a rare call on the follow-through.
  - A reach that touches nothing is never a foul. Before, roughly 1 failed reach in 10 drew a foul, contact or not.
- **Smart AI defenders don't reach through you to a ball you're shielding.** The less smart ones still do, and get called for it.
- In AI Pro-Am games the number of reach-in fouls stayed about the same (about 3 a game), but every one of them now comes from real contact.

### The AI stays in bounds
- **Chasing a pass:** an AI player only chases the part of a pass that's in bounds. A pass heading out is met at the line.
- **No running through the lines:** AI players never run at a spot out of bounds, and they ease off near a sideline or baseline in time to stop.
- In AI park games, time spent standing out of bounds dropped from 1.4 to 0.1 seconds a game, and passes caught out of bounds went to zero.

### Defensive assignment arrows
- **On defense, an arrow at the edge of your ring points at the man you should be guarding.** That's your matchup, the one your AI teammates leave to you. A matching arrow at his feet points back at you.
  - They grow a little the further off him you are.
  - They fade out once you're on him (inside about 2 metres).
- You can turn them off in Settings (**Defense arrows**).

### Sprinting looked faster sideways
- **The speed was always the same in every direction.** I measured it in the game: 5.86 m/s up, down, sideways and diagonal alike.
- **Two things in the 2K Cam made it look different:**
  - The camera followed a run up the floor one-for-one, so you stayed put on screen. It followed only a third of a sideways run, so you streaked across the screen.
  - From a low angle, a run toward the basket is foreshortened.
- **The fix:** the 2K Cam now follows sideways runs much more closely and sits a little higher, so a sprint reads at the same pace whichever way you run.

### The AI reacts faster
**AI players (teammates, opponents and auto-play) now react quickly in the moments that decide a possession.**

- **Off the pass, on offense:** an AI player reads the floor the moment he catches it: the open shot, the drive or the next pass. Before, he held it for most of a second first.
- **Off the pass, on defense:** the man the ball is thrown to gets closed out while the pass is in the air, and the defender's hands come up as he gets there. Everyone else rotates to where the ball is going, not where it was.
- **Dribble moves that make space:**
  - When an AI handler's move leaves his man a step behind (or stumbling), he uses it right away.
  - AI defenders read a handler's dribble move sooner. One who is left a step behind runs to recover instead of sliding after him.
- **Open lanes:**
  - A lane that opens while an AI handler is probing gets attacked straight away, not at his next read.
  - Help comes earlier: as soon as the lane to the rim is open, from about 6.5 m out.
- **Fast breaks:**
  - Defenders sprint back the moment the ball changes hands, outlet passes and loose balls included.
  - With the numbers, the handler goes straight at the rim.
  - A big who pulls the rebound outlets it to a guard, and a man open up the floor gets the ball sooner.
- **Shot choices look ahead at closeouts.** They look 0.5 s ahead, the time a jumper takes to get off, so the quicker closeouts don't bait the AI into bad threes.
- **Measured in AI games** (24 park games, 8–10 Pro-Am games):

  | | Before | Now |
  |---|---|---|
  | Catch to the first real play (shot, pass, drive or move), park | 0.85 s | 0.32 s |
  | Same, Pro-Am | 0.97 s | 0.54 s |
  | Nearest defender when a pass is caught | 2.8 m | 2.2 m |
  | On-ball defender left 2 m behind, back on his man | 0.57 s | 0.48 s |
  | Help reaching a drive inside 6 m | 0.31 s | 0.26 s |
  | All five back after a turnover or long rebound (Pro-Am) | 2.4 s | 1.6 s |
  | Ball over half court after the change of possession (Pro-Am) | 3.6 s | 3.2 s |
  | Points in the first 7 s of a possession (Pro-Am) | 0.12 | 0.17 |

- **What it does to the scoring:**
  - The faster defense took a little off the AI's percentages, so its timing compensation was raised a touch: mid-range 1.55 → 1.65, layups 1.8 → 1.98.
  - Park rates: mid-range 38.3%, layups 52.5%, threes 26.9%. On the same test before, they were 35.6%, 52.2% and 24.5%.
  - Games move quicker. A park game to 21 takes about 4.5 minutes of game time instead of 6.2.
  - Pro-Am scores are about 15% higher, because there are more possessions.

### Stamina
- **Moving without the sprint button is stamina-neutral.** It used to cost a little at full jog.
  - Sprinting, sliding in a defensive stance and hands-up defense still cost.
  - Standing still and drifting recover.
- **Recovery is 1.2× faster** for everyone. That's on top of the Lock-In grade, hot-streak and good-play bonuses.

### Stamina, part 3 (Oct 10)
- **Standing still recovers twice as fast** as it did in the quick patch (and that was already 1.2× the original). Catch your breath at the top of the key and it comes back quickly: a few seconds from empty to full for a high-Stamina build, about ten for a low one.
- **Walking and jogging without the sprint button now recover a very little** instead of being neutral: about a thirtieth of the standing rate, so it takes a couple of minutes of jogging to refill from empty. Sprinting still drains as before.
- **Contesting with your arms up, feet on the floor, is neutral for the defender.** It used to drain like a defensive slide. Sliding in the stance still costs a little (with or without the hands up), and leaving your feet to contest still costs a jump.
- The AI lives by the same rules.

### Screens and Brick Wall (Oct 10)
- **Screens have a quality now,** and it decides what happens to the defender who runs into one. It comes from how hard he ran into it, whether the screener was planted and square to him (chest on, not a shoulder brushing past), whether the screen was called, **the size of both men** (weight, strength and height), the **Strength ratings** of both, and **Brick Wall** on either side (the screener's makes it hit harder, the defender's fights through it).
- **Good screens visibly stop the defender.** Every real screen takes speed out of him (a glancing one a third of it, a perfect one all of it) and slows him for up to a second. A solid screen stops him dead: he's shoved back off the screener's chest with his feet stuck for a third to two thirds of a second. A weak one is just a stagger.
- **Brick Wall's perfect screen puts him on the floor.** A set, square screen that a defender runs into at speed, from a screener with Brick Wall, knocks him down: thrown back off the chest, onto the floor, and he has to get back up before he can recover. The bar is lower at every tier (Hall of Fame needs about two thirds of a perfect screen; Bronze needs nearly all of it), it's higher against a defender with his own Brick Wall, and nobody is floored by a walk-in or while he's in the air or already going for a block or a steal.
- **The screener holds his ground.** A set screener's weight in the contact goes up with Strength and Brick Wall (and more when he called it), so the defender bounces off him instead of pushing him off the spot.
- **Brushing past a man standing in the corner isn't a screen.** Incidental contact with a standing teammate costs the defender a little speed and a stagger but never a stop or a knockdown, and it no longer counts as a screen for the Lock-In grade. A screen counts when it was called (yours or the AI's) or set square to a defender who was going for the ball.
- **The AI squares up** to the defender it's screening, so its screens hit harder too.
- In testing: about 23 real screens per park game, 10 of them stops and about one Brick Wall knockdown every other game; about 36 real screens, 28 stops and 1–2 knockdowns per Pro-Am game.

### The break, and your alley-oops (Oct 10)
- **The AI sees the man running the open floor.** With the ball in transition (and for a couple of seconds after the break is on), the handler's first look is a teammate well ahead of him, running at the rim, with nobody between him and the basket and nobody level with him who could recover. He gets it before anything else happens: an **alley-oop** if he can get up to the rim in time, a quicker, flatter **lob over the top** when a body is in the chest lane and he's clear, or the fast pass ahead otherwise. Smart handlers take that look almost every time.
- **You get the lob too.** Beat your man down the floor (or get free at the rim in a set) and an AI teammate will throw you the alley-oop. When he does, **one of the four face buttons is called at random**, shown over your player's head: A, B, X or Y on an Xbox pad (✕ ○ □ △ on PlayStation, your own symbols on a Switch pad), or the keys they stand for (pass, bounce pass, shoot, lob) on a keyboard. **Hit that button while the ball is in the air** — the ring turns green when the window opens, about a quarter of the way to your takeoff — and you go up and finish it. **Miss it and the alley-oop fails:** the wrong button, pressing too early or not pressing at all is a mistimed jump — a beat late and short — and the ball comes off your hands or sails over your head as a loose ball.
- Runners free at the rim call for the ball, so you see the look when you have it.
- In testing (AI only): about one alley-oop a game in Pro-Am with nine in ten caught, ten lobs ahead, and points within a few percent of before; the open court is rarer in AI 3v3 park games, so most of the action there is the pass ahead. With you running the floor it comes up a lot more.

### Got Next, and the Lock-In line (Oct 10)
- **Your squad lines up next to you.** Step on a Got Next spot and your squad mates walk straight to their circles beside you. They used to run off to the edge of the park and come back the long way round before filing in: every walk in the park was routed through the south plaza whenever either end was near the courts. Now everyone walks straight to where he's going, around the shops, the wheel and any court with a game on it.
- **The stat line fits the Lock-In box.** PTS REB AST / STL BLK TO are smaller (16 px values, 9 px labels like the grade's own caption) and sit inside the grade's height instead of spilling past it.

## Progression: Icon Legend, up to 99

- **Once a build has its Icon badge, every 2 Pro Run games you play to the end raise its overall by 1, up to 99.**
  - Simmed games, forfeits and other modes don't count.
  - The game that unlocks the Icon doesn't count either.
- **No stat picking:** the build system places each +1 itself.
  - It raises the attributes your build leans on most: the shape its caps come from (archetype, size and weight) and what your position's overall counts most.
  - It goes a point at a time across the top half of that list until the overall is up by one.
  - Attributes at 99 are never touched, and your caps rise with the upgrades.
  - Example: a Sharpshooter's shooting reaches 99 first, and a Glass Cleaner's rebounding and interior defense do.
- **After a game that earns one, a card shows the new overall and every attribute that went up.**
- **Where to see it:**
  - MyPlayer → Attributes, under the max OVR track, shows your progress to the next +1.
  - The Pro Run screen shows it too.

## The look

### Jersey straps (fixed properly this time)
- **Why they never showed:** the strap mesh added in v0.4.7.5 was built, but never drawn. Players in the game and the menus are built in stages, and the staged build never passed the straps on. That's why jerseys still looked strapless.
- **What a strap is now:** a real band of fabric. It carries on from the top of the front panel, goes up over the trapezius (midway between the neck and the point of the shoulder) and comes down into the top of the back panel.
  - It has a rolled binding down both edges.
  - It moves with the shoulders.
  - It's drawn just over the skin, so a shrug never shows through it.
  - The fabric's mesh weave runs true to size along it.

### Dunks
- **Less repetition across packages.** Every package now has its signature finish plus one other (High Flyer has two).
  - No generic finish is shared by more than 4 packages. Before, reverse slams showed up in 15 packages and double clutches in 14.
  - Every signature belongs to one package only. The Spin Mill no longer borrows the Eastbay.
- **Windmills:** the arm now goes round straight from the shoulder, at full length, through the jump.
  - Before, the circle sat above the shoulder, so the elbow folded at the bottom, the arm over-stretched at the top and most of the circle happened during the gather.
  - It comes over the top and down at the rim with the ball still in the hand.
- **The Eastbay really goes between the legs, in the air.**
  - The right hand takes the ball down in front and through the gap under the pelvis between the split legs.
  - The left hand takes it on the far side and carries it up to the rim.
  - Before, it was timed from the gather, so most of it happened on the floor, and the ball dipped in front of the right thigh instead of going through.

### Celebrations
- **They work in games now.**
  - Before, they only worked if you pressed G / D-pad up during the second and a half of dead ball after a basket while your player was doing nothing, and the check then cut them off.
  - Now a press waits up to 2.5 seconds for your player to be free (follow-through, landing, hanging on the rim).
  - They play in any dead ball, check or inbound (unless you have the ball) and for 3 seconds after your team scores.
  - Whoever has the ball stops for the check; everyone else finishes.
- **Controllers:** pads the browser doesn't map to the standard layout send the D-pad as axes. The game now reads those too, so D-pad up works on them.
- **No more arms through the body:** Chest Thump, Heart, Dust Off, Archer and Sleep put a hand or forearm through the chest. Each was fixed and every celebration was re-checked on three builds: none clip now.

### Posterizer and Contact Finisher
- **Posterizer only fires on a dunk that gets to the rim.**
  - Winning the contact on the way up now waits for the slam.
  - The knockdown happens if he throws it down. If he rims it out, it's a bump.
  - If he never gets to the rim and has to flip it up, it's a layup, and a Contact Finisher's push-off (or a plain bump) takes over instead of a poster.
  - Before, the poster fired at the contact, even when the dunk then turned into a layup.

## Store, menus and HUD
- **Twice the apparel**, Daily Spin exclusives included. 95 new items, all original:

  | Item | Before | Now |
  |---|---|---|
  | Tops | 31 | 62 |
  | Bottoms | 18 | 36 |
  | Shoes | 18 | 36 |
  | Headbands | 8 | 16 |
  | Sleeves | 6 | 12 |
  | Socks | 5 | 10 |
  | Wristbands | 4 | 8 |
  | Leg sleeves | 2 | 4 |
  | Knee pads | 1 | 2 |
  | Chains | 2 | 4 |
  | Daily Spin wearables | 6 | 12 |

  The new Daily Spin wearables are the Solstice Jersey and Shorts, Aurora Glow Headband, Rose Ice Chain, Frostbite Shooting Sleeve and Kinetic Hi / Aurora.
- **The bug report's "Kind of bug" list is readable.** An open dropdown is drawn by the system (light on Windows), and its options had inherited the menus' light text. Every dropdown in the game now opens dark with light text.
- **Your line beside the Locked-In grade:** PTS, REB, AST on top and STL, BLK, TO underneath, in a panel attached to the right of the grade.
  - The panel is 1.2× the grade's width, at the same height.
  - The grade itself keeps its size and moves left to make room.
  - A number that goes up pulses once.
  - It shows whenever the grade does (Settings → Lock-In grade).
- **Volume in the pause menu:** Music, Effects and Crowd sliders. They're in the park's pause menu, your park game's, Pro-Am / Pro Run and the Crew HQ. They apply as you drag and are saved.
- **The Greeen Chant is a real crowd now.**
  - About a third higher in pitch.
  - 25 voices in 9 different throats (men, women and a couple of kids), each with its own vowel, pitch, rise, wobble, timing and length.
  - A breath in each throat, and the stands throwing it back.

## Green releases: doubled and remade
- **Twice as many:** 32 sounds and 28 effects. That's 16 new sounds and 14 new effects, all original, in the VC Store under Green Sounds and Green FX.
  - **New sounds** (3,500–9,500 VC): Night Owl, Wolf Howl, Steam Whistle, Victory Bells, Knockout Bell, Shattered Glass, Strike!, Rimshot, Bass Drop, Sonar Ping, Standing Ovation, Five-Alarm, Boing, Cuckoo, Royal Fanfare and Case Closed.
  - **New effects** (6,000–12,000 VC): Phoenix, Make It Rain, Shockwave, Atomic, Galaxy, Ice Cold, Fire Circle, Angel Wings, Jade Dragon, Meteor Shower, Laser Show, Lucky Clover, Diamond and Supernova.
  - The AI picks from all of them, still with no two alike on a floor.
- **Every sound remade to sound like its name.**
  - **Why they didn't before:** each sound was a few plain synth tones, which is why the Eagle Screech sounded like a whistle rather than a bird.
  - **What changed:** each sound is now built sample by sample, the way the real thing makes its sound.
  - **Eagle Screech:** a raptor's scream.
    - A quick rise into a long, high "kee-eeee-arrr" around 2.5 kHz.
    - Harsh, the way a real one is: the pitch jitters from cycle to cycle, every other cycle is louder, and there's breath riding on each one.
    - It tears downward at the end, then rings off the canyon walls.
  - **Bells, gongs, glass, coins and wood** ring with their own partials. A church bell has its hum an octave under, its minor-third tierce and its nominal. The gong blooms up into its shimmer after the strike.
  - **Voices:**
    - The choir is four sections, each with its own vowel, singing in a cathedral with a harp under it.
    - The kazoo is a hummed voice with the paper buzzing on it.
    - The roar after the Greeen Chant is now crowd voices, not noise.
  - **Squeaks, water and weather:**
    - The rubber duck is a squeaker reed, wheezing in between squeezes.
    - The cannonball is a slap, a kerplunk and hundreds of bubbles and drops.
    - Thunder tears the air open before the boom and the roll.
- **Every sound comes out equally loud** (it's measured automatically), and none runs past 4.2 seconds.
- **No hitches.** When a game starts, the sounds everyone on the floor will need are made in the background, so a green never waits on its sound. In the store, the first "Hear it" on a sound takes a split second.
- **How they were checked:**
  - Every sound was tuned against its spectrogram.
  - Tests check what each is made of: the eagle's pitch, band, rasp and fall, the owl's low hoots, the cuckoo's two notes, the siren winding up, the air horn's short-short-long and more.
  - Every new effect was captured frozen in time over a player in the studio.

## Under the hood (quick patch)
- **Tests:** 160 game tests and 40 service tests pass. The new ones cover non-shooter windows, smothered shots, the record scratch, repeat moves, diagonal moves, the straps being drawn, the apparel counts, dunk variety, the windmill and Eastbay paths, celebrations (input and clipping), reach-in contact, the AI staying in bounds, the D-pad fallback, Icon Legend, the green release counts and what each sound is made of, the AI's reaction times, stamina and the line beside the grade.
- **Judgment calls I made without asking:**
  - "Shooters" are Sharpshooters and Stretch Bigs. The 10% smaller window for non-shooters applies to jump shots only, not layups or free throws.
  - "Career mode games" for Icon Legend are Pro Run games, the same as the 80 → 90 climb.
  - The smothered rule applies to every shot that can be labelled Smothered: jumpers, close shots and layups. Dunks are left to Posterizer and Contact Finisher.
  - The record scratch also plays for the AI's green sounds near you.
  - "Double apparel" covers clothing, shoes and accessories (everything you wear); King Tut Cup prizes weren't doubled.
  - "Double the green animations and sounds" means twice as many of each, counting the King Tut Cup's (16 → 32 sounds, 14 → 28 effects). The Cup prizes themselves weren't doubled.
  - "Walking without sprint" means any movement without the sprint button. Defensive slides still cost a little; since stamina part 3, hands-up defense on the floor is neutral.
  - Stamina part 3: "very minimally positive" for walking and jogging is a tenth of the old resting rate (so about a thirtieth of the new one). Hands up while *sliding* still costs the slide; only hands up with the feet planted is neutral.
  - The alley-oop press: the four face buttons are read raw (whatever your context) only while a lob to you is in the air, and that press is used for nothing else, so the shoot button can't also jump you. The window opens a quarter of the way to the takeoff and closes 0.05 s after it. A mistimed one is 0.22 s late at 40% of the height.
  - Screens: "perfect" means the screen's quality clears a bar that drops with the Brick Wall tier and rises with the defender's own tier, and the defender came in at 1.5 m/s or more. A screen is only a screen when it was called or set square to a defender going for the ball; the rest is incidental contact.
  - The faster AI reactions apply to every AI player: teammates, opponents and your own player on auto-play.
