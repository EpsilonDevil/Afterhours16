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
