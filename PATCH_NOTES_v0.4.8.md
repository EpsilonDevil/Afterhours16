# Afterhours 16 — v0.4.8 Patch Notes

v0.4.8 is about playing online. Your copy of the game now connects to the game's own online server by itself, so a player only signs in. Online shot timing is graded on exactly what you saw when you let go: the green window can't shrink after the release and your meter stops where you let go. It also fixes name tags, offensive three seconds, Pro Run games that didn't count and badge progress, and it retunes layups and blocks.

Everyone has to be on v0.4.8 to play online together. Pull the update before you connect.

---

## Online: timing and accuracy

Every screen runs the same game in lockstep. Players and the ball are exactly where the game has them on every screen, tick for tick: nothing is predicted or smoothed. What separates online from offline is the input delay, the few ticks your input takes to reach everyone. This update makes sure that delay never costs you a shot. It also makes the delay itself as short as each game allows.

### Green windows stay what you saw
- **Graded on your screen:** a jumper or layup is graded against the window your meter showed when you let go, with the defense as it was then. A closeout that lands in the ticks your let-go takes to reach the game no longer shrinks the window after you've let go.
  - The contest %, Smothered and the make chance use the moment you let go too. Online, the shooter gets the benefit of the doubt.
  - A layup let go early in the gather comes out just after the takeoff, as before, and it's graded on the meter you saw for that tick.
- **Your meter stops where you let go.** It used to keep filling until your let-go reached the game, then jump back to where you'd let go. Now it holds still from the moment you let go, and the result (the grade colour) comes up on that same picture. In a two-PC test with 100 ms of round trip on one side, the meter held still on every shot until the result came up with the same fill and window, and both screens graded every shot the same way.
- **Exact timing after a hitch:** every tick of your input now says exactly how many ticks after your screen it lands. A release made during a hitch, while the game waited on someone, or while it caught up afterwards, is graded where you let go. It used to be graded up to about 160 ms late, which turned greens into "late".
- **Held too long:** a shot or free throw you never let go of comes out by itself at the same point on your screen as it does offline. Online, a very late let-go could be cut short before it arrived.
- **Alley-oops:** the alley-oop button is judged at the moment you pressed it. Online it was judged one tick late.

### The meter and the release read the same thing (online and offline)
- **Hooks out of the post now show their meter.** They were always timed, but no meter showed while you shot.
- **Fadeaways and turnarounds out of the post** show the window the release actually grades, with the shield from your man. The meter used to show the plain contest, so the window on screen could be smaller than the real one.

### Less input delay
- **Round trips measured to 5 ms** (they were rounded to 25 ms), and **25 ms to spare instead of 30** when a game picks its input delay. Many games now start a tick (about 15 ms) quicker.
- **One late connection doesn't freeze everyone:** a player whose inputs reach the others late starts sending his own further ahead sooner (after 60 ms of waiting in 2 seconds; it was 100 ms). The others see fewer "Waiting for…" freezes, and only his own delay goes up. It comes back down after a few quiet seconds, as before.

### The server
- **Straight out:** the server sends an input on to the other players immediately when nothing is waiting for that connection. It no longer hands every input to a separate sending thread first. On a load test with 20 players and 40 people watching, the server uses roughly 35–40% less CPU (about 43% of a core down to 27%). That leaves room for busy event courts like The Jungle Ballers.
- **Switching every 1 ms:** a hosted server switches between its connections every 1 ms instead of 5 ms. In the load test that made the slowest 1% of relays steadier: 12–13 ms in every run, where they ranged from 10 to 19 ms.
- A slow or frozen connection still never holds anyone else up: anything it can't take right away waits for it alone, and a connection that stops taking data is cut off as before.
- Windows hosts (host.cmd) keep the old sending path. Windows has no send that never waits, and that path was already fine for a few friends.

| Load test (tests/load_hub.py) | Before | v0.4.8 |
|---|---|---|
| 10 players, 10 watching: server CPU | 17% of a core | 12% |
| 20 players, 40 watching: server CPU | 40–47% of a core | 25–28% |
| 20 players, 40 watching: input relay, median / slowest 1% | 4.7 ms / 10–19 ms | 4.7 ms / 12–13 ms |

*(Measured on one machine. The relay times include the test's own clients, so the network between you and the server is the part that counts.)*

---

## Online: just sign in

- **The game's own server, by itself:** the game folder has an `online.json` with the server's address and join code. A copy that isn't hosting connects there when it starts, so nobody types an address or a join code.
- **A sign-in popup** the first time you're free on the home screen: sign in with your online account, or make one (the join code comes from online.json). Your game remembers it, so after that it signs in by itself.
- **Play offline** in the Online tab disconnects you. Your games are just yours, and the choice sticks when you restart. **Connect** brings you back, already signed in. You can sign in, or play on another server, at any time.
- **Setting it up:** while you're connected to your server from your own copy, the Online tab offers **Save to online.json** (with the join code). Push that file to GitHub and everyone who pulls it only has to sign in. The join code goes into the public repository with it.
- Hosting from your own PC (host.cmd) and typing another server's address both work as before.

---

## Fixes

- **Name tags:** Settings → Name tags now does what it says. With it off, the names over players are gone in games (the pass icons still show while you have the ball) and at the park.
- **Offensive three seconds:**
  - The count runs only while the offense has the ball. A pass in the air from the offense counts; a loose ball or a rebound doesn't.
  - The count starts again from nothing when the ball changes hands.
  - The call gives the ball to the other team right away, before play goes on. The team that committed it sees **3 SECONDS**, and the feed says whose ball it is.
- **Take it back:** in half-court games, a red glow pulses along the three-point line, corner to arc to corner, while the team with the ball has to take it back past the arc (after a defensive rebound or a steal). It fades out once the ball is cleared.
- **The Pro Run counts again:**
  - A build that was already past 80 OVR keeps its max OVR, and that max now goes up by 1 every 3 Pro Run games from where it is. Before, the progress meter cycled every 3 games without the +1.
  - A long Pro Run game with a big counting line (many fouls or rebounds, for example) used to be rejected whole, so it gave no OVR progress, no badge progress and no rewards. Those numbers are now limited to what fits the game's length and the game counts. Points and shooting are still checked strictly.

---

## Gameplay

- **Layups by contest:**
  - A green on a **wide-open** finish (10% guarded or less on the HUD) always goes in, with a solid window.
  - An **open** finish (20% or less) is a sure make too, solid, with a **Layup of 85 or better**.
  - Anything more guarded is outlined, and a green is a boost that shrinks with the coverage: the full boost when open, 80% of it lightly guarded, 55% contested, and none when smothered.
- **Blocks:** what a defender brings to a block (his ratings, his size and his badges) counts 3.75% more. Being shorter than the shooter doesn't count any more against him than it did.

---

## Quick patch (Oct 13)

- **Badge progress after a game** looks the way it always did, one line under the results. The fix is underneath it: every Pro Run game counts toward your badges, a long one with a big stat line included (see **The Pro Run counts again**). A new test plays two long Pro Run games through the game's service and checks that both land on the player's badges.
- **Hall of Fame sooner:**
  - **Handles for Days** at **115 games played** (was 160).
  - **Deadeye** at **135 contested makes** (was 220).
  - A player already past the new mark gets the upgrade (and its cap breakers) after his next game.
- **Soundtrack:** five new mixes, almost 8 hours in all. Each one is split into parts under 30 MB at a quiet moment, and the parts play back to back.

| Mix | Artist | Length | Parts |
|---|---|---|---|
| Family Tree Vol. 10 · OROSA (Live Mix) | The Family Tree | 56 min | 2 |
| Show #626 (Full Crate Takeover) | Soulection | 2 h | 5 |
| Show #631 (Olea Takeover) | Soulection | 2 h | 5 |
| Soulection Radio Show #611 (Keyrah Takeover) | Soulection | 2 h | 4 |
| The Playlist Finds You | djmaithai | 58 min | 2 |

---

## Technical (for the repository)

- Version 0.4.8 (`server/app.py`, `package.json`). Database schema 12 (`server/migrations/012_v0475_hub_offline.sql`: playing offline is remembered).
- New: `online.json` at the root; `tests/v048.test.mjs` (8 tests: release grading under a closeout for jumpers and layups, the meter stopping at the let-go, exact dl, lagged timing, meter/release parity, round trips, the server's send path); `tests/v0475qp15.test.mjs` (7: name tags, three seconds, the glow, Pro Run max OVR, layups, blocks, the online pieces); Python tests for the direct send path, a long Pro Run game, a climbing max OVR and online.json.
- Quick patch: `server/progression.py` (`BADGES` handles_for_days and deadeye tiers; `apply_progress` also moves up a badge whose progress already meets a lower requirement), `client/js/ui/modes.js` and `client/css/menus.css` (the results' badge line as before), `client/audio/music/` (18 new parts, `tracks.json`), tests (`test_server.py`: two Pro Run games through the service, the new Hall of Fame marks; `v048.test.mjs`: the new mixes).
- Tests: 241 Node and 75 Python.
