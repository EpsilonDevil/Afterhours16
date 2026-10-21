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
