# RIMRIFT — v0.4.8.7 Patch Notes

v0.4.8.7 is the online park patch: **the online server now runs the park itself**. No player's game is the park's "host" any more, so everyone at a park sees the same park, and it takes less work on each PC. Online park and Pro-Am results are also checked by the server before they pay out.

Everyone has to be on v0.4.8.7 to play online together. Pull the update before you connect.

---

## The server runs the park

**One park, the same on every screen.** When you play online, the server keeps time for every park and puts everything that happens there in a single order. Every player's game then works out the park from the same starting point and the same events. That covers:
- who's playing on each court, every game's result, the kings and their streaks;
- the lines and who has Got Next, and the AI who hop on;
- the ICON Squad;
- the park-goers walking in, around and out.

Friends at the same park see the same games on every court, the same lines and the same people in the same places.

**No more host handovers.** Before, the first player at a park ran it for everyone. When he left, the park jumped while the next player took over, and his PC carried the extra work. Now no player runs the park.

**Lighter on your PC.** In testing with two players at a busy park, each PC used about 25–30% less of its main processor thread than before. Courts you can't see no longer build their players, and the games on them run at the same pace whether anyone's watching or not.

**Walking into a park.** You see the park as it is at once: the people, lines and kings. Each court's game appears a moment later, once your game has caught up with it (a few seconds at most).

**Self-correcting.** Every PC regularly checks its park against everyone else's. If one ever drifts out of step, the server puts it back in line. If the server restarts, the players already in the park hand it back, so it carries on where it was.

**What you do counts for everyone.** Taking park-goers for your game or your Got Next spot, handing them back, kings holding the court and your AI squad all go through the server, so they look the same on every screen. The server checks each one: you can only take players onto your own spot or court, and only hand back AI you took.

**Unchanged:** offline and solo play (your own park, as before), your movement and the shot meter (still instant on your own PC), and your own games against real players.

## Online results are checked

When you play park or Pro-Am games online, your result has to match what the other players' games saw before any VC, Rep, badge progress or event winnings are paid.
- **If the results don't match,** the game isn't counted for anyone in it. Any ante you put up is returned, and the mismatch is logged for review. That means a player whose game reports a false result voids the game for the other side too, and their honest result isn't counted either. That's a known trade-off for now.
- **If the other players disconnect before the end,** your result still counts, as long as it fits what the server saw of the game.
- **Unchanged:** offline games, solo play and games on your own PC.
- A results screen can occasionally take a few seconds longer while the server waits for the other players' results.

## For the server owner

- The park director is on by default. Setting `RIMRIFT_PARK_DIRECTOR=0` (or `false`, `off`, `no`) in the server's environment goes back to v0.4.8.6's host mode.
- An account that ends up in disputed results with 3 or more different players within 24 hours gets a `[results] WARNING` line on the server console.

---

## Quick patch 1 (Oct 21): Lockdowns get defensive Hall of Fame badges

**A Lockdown's shooting badges stop at Silver.** Deadeye, Catch & Shoot and Corner Specialist now top out at Silver on a Lockdown, the same as Green Machine; Limitless stays at Bronze.

**Defensive Hall of Fame badges take their place:**
- **Rebound Chaser** now reaches Hall of Fame on a Lockdown.
- **The height limits are lifted for a Lockdown's defense:**
  - Chasedown and Brick Wall reach Hall of Fame at every height.
  - Rim Protector reaches it from 6'3" up.
  - Pick Pocket reaches it at 7'1" and up.

| Lockdown height | Hall of Fame badges |
| --- | --- |
| 6'2" and under | Handles for Days, Pick Pocket, Interceptor, Chasedown, Brick Wall |
| 6'3"–6'9" | Handles for Days, Pick Pocket, Interceptor, Rim Protector, Chasedown, Brick Wall, Rebound Chaser |
| 6'10" and up | Pick Pocket, Interceptor, Rim Protector, Chasedown, Brick Wall, Rebound Chaser |

Every Lockdown can still earn all 25 cap breakers. The Icon badge needs 7 Hall of Fame badges, or every one the build can reach if that's fewer.

**Lockdowns that already had Gold or Hall of Fame shooting badges** have them lowered to Silver the next time the game loads your profile. It says so when you sign in. Your progress on those badges is kept, and:
- the cap breakers you've already earned stay yours;
- an Icon badge you've already unlocked stays unlocked;
- your new defensive Hall of Fame badges never pay cap breakers twice: 25 is still the most a build earns.

AI Lockdowns follow the same caps.

---

## Quick patch 2 (Oct 21): No walking onto a game in progress

**Real players can't walk onto a court while a game is being played there**, just as the park-goers can't. That covers AI games, the game you're watching, and other real players' games. Walking toward one, you stop at the court's edge. If you're standing on a court when a game starts, you're walked off to the nearest sideline at a walking pace, without a jump across the court. You can still walk onto an empty court, stand on your Got Next spot, and go onto the court of your own game. Your position goes out to everyone else's screen too, so nobody wanders through anyone's game.

---

## Quick patch 3 (Oct 21): Green layups go in

**A perfectly timed open layup no longer hits the underside of the rim.** Before, a layup started right at the end of a drive (under the rim), or let go late, could carry the shooter in under the rim. The ball then came out below the front of the rim and hit its underside, even on a green.
- **While you still have the ball in the air, you stay at the finishing distance from the rim.** You no longer drift in under it.
- **A layup started right under the rim** glides on through and finishes from the other side, like a reverse.
- **The game no longer counts a ball that hits the rim from underneath as a make** when it plans a shot's path. It also plans with the spin the ball really has, so the path it plans is the path the ball takes.
- **A green with no clean path goes through the rim** the way a green jumper does.

In testing, 960 out of 960 open green layups went in, from every distance out to 2.6 m, at every speed and with every release timing.

## Quick patch 4 (Oct 21): Watch other players' games, and the right badge tiers

**You can see other players' park games while they're being played**, models and all.
- **Arriving after the first minute:** before, anyone arriving at the park after a game's first minute saw an empty court until it ended. Now you see the game from wherever it's got to: your screen catches up in a few seconds, then plays along live.
- **A player's own game:** a player's own game (with AI teammates, against AI) now shows on everyone else's screen too, even if he started it before they arrived.
- **No extra delay:** watching never affects the game, its result or its players' delay.

**Activated badges show your real tier.** Online, your badges were only sent again when something else about your build changed. So after a badge upgrade, the next games could still show (and play) your old tier. Now a badge tier change goes out at once, for you and your AI squad mates.

## Quick patch 5 (Oct 21): Auto-play in online Pro-Am

**Auto-play now works in online Pro-Am**, so you can take a break in a long Pro-Am grind and keep playing.
- **Turning it on and off:** press H to turn it on, and H again to take back control.
- **Everyone sees it:** your player is played by the AI the same way on every screen, and your name shows **AUTO** to the others.
- **Next game:** auto-play stays on for your next online Pro-Am game, as it does offline. H always turns it off.
- **Rewards:** it pays exactly the same as offline auto-play.
- **Other online games:** online park and other online games still don't allow it ("Auto-play is only in online Pro-Am").
