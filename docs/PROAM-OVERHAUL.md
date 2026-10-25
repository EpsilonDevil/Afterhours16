# v0.4.8.8 "The Pro-Am Overhaul": the working contract

This is the one design every agent builds against. David's brief (Oct 22) plus his answers:
- Build it in the live web game now, in phases. The port re-pins its baseline afterwards.
- The -10% badge/OVR tuning and the +10% difficulty apply to Pro-Am only.
- Season 1 is a fresh start in Bronze.
- Season 1 starts the moment the server first runs v0.4.8.8.

Where the brief leaves a gap, the lead's decisions are marked **(lead)**. Questions go to the lead; don't guess.

## 1. Seasons
- **Length:** a season runs 45 days.
- **Season 1 start and end:** it starts the first time a v0.4.8.8 server boots (stored once in the DB), and ends at 12:00 AM US Eastern on the 45th day after that.
- **Following seasons:** Season N+1 starts the moment Season N ends.
- **What the season covers:** Pro-Am teams, series, ranks and RP.
- **Fresh start:** every player and team starts Season 1 in Bronze 1 at 0 RP. A build's old Pro-Am RP and rank are kept on its profile as "Before Season 1" history only.
- **At a season's end (lead):**
  - every team and player starts the next season in Bronze 1 at 0 RP;
  - each player keeps a record of the season: highest rank reached, series won and lost, games won and lost;
  - each player receives that season's **season reward** for the highest rank reached (§6).
- **Display:** the Pro-Am tab shows "Season N · ends <date> (<countdown>)".

## 2. Ranks, divisions and RP
These are the old 7 tiers: Bronze, Silver, Gold, Platinum, Diamond, Master, GrandMaster.

**Divisions (lead)** reconcile "a series win promotes the whole team one rank" with "about 3 series wins from Bronze to Silver, 5 from Silver to Gold, 7 from Gold to Platinum":

| Tier | Divisions |
| --- | --- |
| Bronze | 3 (B1–B3) |
| Silver | 5 (S1–S5) |
| Gold | 7 (G1–G7) |
| Platinum | 7 (until Diamond+ is designed) |
| Diamond, Master, GrandMaster | 7 each, held for later |

- **A series win** promotes the whole team, and every player who played in it, one division. From the top division it promotes to the next tier's first division.
- **RP:** each player has RP within his division, 0–100.
  - Game RP uses today's formula (result, Elo vs opponent, performance; `progression.proam_rp`), rescaled so a typical win is about +12 to +25.
  - Reaching 100 RP between games promotes that player one division at once ("promotion can also happen in between games"), and his RP carries over the 100.
  - The team's division is the division of its series. When a team's series is won, everyone moves up from the team's division. A player who is already above it stays where he is.
  - **The team's own RP (qp9):** the team has RP too, moved by each of its series games. It never promotes the team by itself; only a series win does. It keeps counting past 100 while the series plays out (nothing earned is lost), and on the promotion the division's 100 is spent and only the excess over it starts the next division (130 → 30; a team promoted below 100 starts at 0). A series loss (qp10): a team with RP banked past 100 drops to 100, the division's max (a second loss from there resets it to 0 as ever); a team already at 0 is demoted one division; any other team goes to 0.
- **A series loss:** every player in the team goes to 0 RP in his current division, and the team does too.
  - A player who was **already at 0 RP** when the series was lost is demoted one division. A tier's first division drops to the previous tier's last division; Bronze 1 is the floor.
  - Individual RP otherwise only falls from game losses and poor performance, never below 0, and a game alone never demotes.
- **Forfeit:** forfeiting or abandoning a game counts as a loss with the current −20 RP, and the series continues.
- **Team rank:** the series' division decides what the series looks like (§3), what the matchmaker uses, and the hub building (§8).

## 3. Series
- **Length by tier:**
  - Bronze: 3 games, first to 2 wins.
  - Silver: 5 games, first to 3.
  - Gold and above: 7 games, first to 5 (David's numbers: "7 total, 5 to win").
- **When a series ends:** as soon as one side's result is certain. Either the team reaches the wins it needs, or too few games are left to get there.
- **Opponents:** each game in a series is matchmade on its own, so the opponent changes from game to game.
- **Home and away:** games alternate home and away, starting at home.
- **Matchmaking:**
  1. First, the server pairs the queued team with another real Pro-Am team in queue whose team division is within 2 divisions, waiting up to 45 s.
  2. If none turns up, it falls back to the AI Pro-Am team nearest the team's division.
- **Venue:** the game is played at the home team's home court (§7). Against an AI team that is away, it's the AI team's home court.
- **Rewards (lead):**
  - Pro-Am games pay their usual VC, Rep and badge progress (with the rank boost, §6).
  - A series win pays a bonus: Bronze 1,500 VC, Silver 3,000 VC, Gold+ 5,000 VC.
- **Draft refreshes:** they reset when a series ends, whether it was won or lost (§5).

## 4. Pro-Am teams
- **First visit:** the first time a player opens the Pro-Am tab, he's asked to **Create a Pro-Am team** or **Join one**.
- **Search:** the search covers every team on this server by name or abbreviation, real and AI, with its division, record and members.
- **Create:**
  - the team name, abbreviation and colors;
  - a logo and jerseys from the ones the game already has (`proam_teams` today, plus the league teams' looks);
  - a home court (§7).
- **Roster:**
  - up to 10 real players, with 5 on the floor;
  - one Pro-Am team per account at a time;
  - leaving a team keeps your own RP and division.
- **Joining:** a team is open by default, so anyone can join. The founder can switch it to invite-only, where players ask to join and the founder accepts (lead).
- **Who's in charge:**
  - The **founder** owns settings: name, colors, home court, open or closed, and kicking members. He can hand ownership on.
  - The **Team Captain** for a session is whoever is hosting it, as David's brief says: the first team member in the hub, handing over the way park hosting did. He queues games, picks the draft and leads the ready check.
- **AI Pro-Am teams:**
  - At least 24 AI teams per server, spread across every division.
  - Their rosters are real AI players from the server's shared AI world (`sim/world.js`), keeping their names, builds and looks.
  - They use league-team identities and jerseys.
  - Their records and RP move with their games against real teams. Their divisions move only by winning or losing series, by exactly the same rules as player teams (qp11: `team_series_won` / `team_series_lost`; before, an AI team promoted at 100 RP and one lost game at 0 demoted it). Between AI teams the server plays out series every 6 hours, so the standings feel alive (lead).

## 5. The GM draft (clipboard)
- **Where it is:** a clipboard in the hub office, which only the Captain can use (anyone can look).
- **What it offers:** for the open spots on the roster, a list of **5 randomized real AI players** from this server's world. They are drawn from AI players near the team's division, with a spread of positions, and none of them in another AI Pro-Am team's starting five.
- **Refreshes:** up to **3 free refreshes** per series. The count resets when the series ends.
- **What a pick means:** a drafted player fills an empty spot for this whole series and shows on the team's sheet.
- **Ready check:** before a game, any spot that's still empty at the ready check is filled from the current list in order.

## 6. Rank rewards (non-stacking)
**Boosts:** a player's VC and Rep boost in **every mode** is the one for his **current tier**. Each one replaces the previous tier's boost; they never stack.

| Tier | VC and Rep boost | Rank icon by his name (every mode) | Introduction borderplate | Items |
| --- | --- | --- | --- | --- |
| Bronze | none | none | – | – |
| Silver | +2% | Silver rank icon | – | – |
| Gold | +4% | Gold rank icon | Gold, with a sheen | Gold "PRO-AM" chain with iced-out letters; Gold low-top canvas sneakers. Never name a real brand: "Gold Low-Top Canvas" is fine, "Chuck Taylor" isn't. |
| Platinum | +5% | Platinum rank icon | Platinum, animated | Platinum "PRO" watch; Platinum headband; a toggle to show the player's record over his head in the park |
| Diamond, Master, GrandMaster | for later | for later | for later | for later; the icons should exist as placeholders |

- **Rank items:** reaching a tier unlocks its items for good. They're "won, not bought" (like event items): never in the store, and they keep working after a demotion. They are equipped from the Inventory.
- **Following the current tier:** the boost, the name icon and the borderplate follow the player's **current** tier.
- **Season reward (lead's creative fill):**
  - at the season's end, each player gets a season-stamped banner (an item for the introduction card) for the highest tier he reached, for example "S1 · Gold";
  - the Gold+ chain gets a season-stamped variant;
  - each is exclusive to that season, so a later season never awards it again.

## 7. The 12 Pro-Am parks (home courts)
Twelve casual park environments for Pro-Am games, any of which a team can choose as its home court:
1. **Under the Overpass:** a busy elevated highway overhead, traffic noise, pillars and graffiti.
2. **Long Beach:** courts on the sand by the boardwalk, ocean, palms.
3. **AAU Gym:** an indoor multi-court gym with bleachers and banners.
4. **Rooftop:** a court on a city rooftop with a skyline view.
5. **Projects:** a court among brick towers, with a chain-link fence.
6. **Riverside:** a court by a river, bridges and city lights.
7. **Old Warehouse:** an indoor converted warehouse, industrial.
8. **Schoolyard:** an outdoor elementary or middle school court with murals.
9. **Cage:** an enclosed fenced court (the "West 4th" type, with no real names) in a dense downtown.
10. **Suburban Rec Center:** an indoor wood court with a community bulletin board.
11. **Desert Dusk:** an outdoor court with a mountain backdrop and a sunset.
12. **Night Market:** a court beside food stalls, lanterns and crowds.

- **The court:** every park has one full court with regulation markings.
- **Home team look:** each park can wear the home team's colors and logo at center court and on the banners.
- **Gold teams' clubhouse:** each park has its own **unique clubhouse** beside the court, used by Gold teams (§8).
- **Randomized:** a game whose home team has no chosen court gets one of the 12 at random. Each park randomizes its time of day, weather and crowd too.

## 8. The Pro-Am hub
**Ways in:**
- the Pro-Am tab, which goes straight to your team's hub;
- a **Pro-Am HUB building** in every park: walk up to its door to go in.

It's an online space like the Crew HQ (`game/crewhq.js`): the team members in it see each other. Everyone can do a shootaround while they wait.

| Team tier | Building | Office |
| --- | --- | --- |
| Bronze | a small one-court middle-school gym | a small office door in the wall behind one hoop |
| Silver | a modest high-school gym | a bigger office |
| Gold | a custom clubhouse with an indoor full court | a large office |

**Gold extras:**
- the floor, walls, logo and colors can be changed in the office;
- a door out leads to the team's **home park** (§7), with its unique clubhouse beside the court;
- outside, team members can play 3s on the home court. These games pay a small amount of VC and no Rep.

**Platinum and above:** for later. Until then they get the Gold clubhouse with the Platinum trim (lead).

**The office:**
- **Whiteboard:** the current series (game by game: opponent, home or away, result), the record, the team and players' ranks, RP bars, and the season countdown.
- **Clipboard:** the draft (§5).
- **Queue for next game (Captain):** sends a ready check to every team member in the hub. When everyone is ready, or after 20 s with those who are, the empty spots fill from the draft and the matchmaker runs (§3).
- **Team settings (founder).**

## 9. Pro-Am gameplay realism (Pro-Am games only)
- **No ICON effects:** the ICON aura and Icon badge effects don't apply. The animation packages that come with Icon badges still play.
- **Badges:** badge effects are 10% weaker.
- **Overall gap:** the gap between builds' overall ratings is 10% smaller. Each rating is pulled 10% of the way toward its population mean.
- **Difficulty:** overall difficulty and AI intelligence are 10% higher.
- **Determinism:** all of this is set from the game's own config (`mode === 'proam'` plus a `realism` flag), so lockstep stays deterministic.

## 10. Pro-Am teams online (v0.4.8.9 qp6)
Players who play together online each play from their own copy of the game and keep their own save. A Pro-Am team they share is therefore kept by the service they meet on:
- the host's PC when one of them hosts (`host.cmd`, `--online`);
- the online server when they use one (`--server`, the one in `online.json`).

**Where each thing lives:**

| Kept by the team's service (the hub) | Kept by each player's own service |
| --- | --- |
| the team, its members and join requests | his builds |
| the team's series, draft, division and record | his own Pro-Am rank and RP |
| the matchmaker and the HUB place (`hq:pa:<team id>`) | VC, rank items and season rewards |
| a **card** for each member's build: name, position, overall and rank, for the roster | |

**How a player's game talks to it:**
- **Offline** (no hub, or "Play offline"), the Pro-Am tab uses his own service, as before.
- **Online**, every team call goes to the hub over the online socket, as his online account there:
  - the message is `{"t": "pa", "req", "op", "args"}`, handled by `server/online.py` `pa_call` and then `server/proam.py` `ProAm.online_call`;
  - the ops are status, search, team, create, join, answer, update, kick, handon, leave, draft, queue, lineup and report;
  - the client side is `ui/proam.js` `paReq` and `ui/online.js` `paCall`.
- The host himself uses his own service, which *is* the hub.

**A series game:**
- Each player's ticket on his own service carries the hub's game: `pa_game: {series, n, online: {team, div, opp_div, opp, venue, home}}`.
- His RP is worked out there, as for any series game.
- The ticket's result (`pa.report`, or `pa_report` for a forfeit) goes to the hub's `report`. The first report of a game counts.
- A forfeit counts only when he was the team's only real player in that game.
- When a series ends, the hub's status lists it under `settle` for each member who played in it. His own service then moves his build up or down once (`POST /api/proam/settle`) and pays the series bonus. The VC reference is `pa_series:<id>`, so it's paid once.

**The rest works as on one service:**
- the HUB: same place, the Captain is whoever has been there longest;
- the ready check (`pa-ready`);
- the draft and the lineup: only the open spots are filled;
- the one shared online game for the team (`Modes.proamGame` with members);
- real vs real (`side`).

Each member's game sends his card with every status.

## Ownership (who edits what)
- **Server/UI agent:**
  - New server files: `server/proam.py`, migration `016_v0488_proam.sql`.
  - Server edits: `server/app.py` routes, `server/progression.py` (boosts and rank RP), `server/catalog.json` (rank and season items).
  - Client: `client/js/sim/ranks.js`, and `client/js/ui/*` (the Pro-Am tab, create/join/search, the office UI: whiteboard, clipboard, ready check, team settings), the rank icon by names, the borderplates in the intro cards (`game/present.js`, coordinated with the lead), and `ui/online.js` entry fields.
  - Online matchmaking messages go in `server/online.py`, after telling the World agent.
- **World agent:**
  - New world files: `client/js/world/proamparks.js` (the 12 parks) and the venues/themes entries.
  - The Pro-Am HUB building in the existing parks (`world/*`, `game/park.js` door hook).
  - The record-over-head toggle's rendering in `park.js`.
- **Hub agent:**
  - New files: `client/js/game/proamhub.js` and `client/js/world/proamhubs.js`.
  - The three hub buildings and the Gold clubhouse, the office interiors with their interactables, which call the Server/UI agent's office UI, and the shootaround.
  - The Gold walk-out to the home park (using the World agent's park builder) and the 3s game there.
- **Lead:**
  - The §9 Pro-Am realism in `sim/` (`game.js`, `shots.js`, `ai.js`, `builds.js`);
  - patch notes, README and STATUS, the version bump to 0.4.8.8, and commits.

**Shared contracts:**
- A Pro-Am game is started by `Modes.proamGame(app, { team, opponent, venue, home, series })`, which the Server/UI agent defines in `ui/modes.js`.
- Venues are `proam_<id>` in `server/venues.json` and `world/venues.js`.
- The hub tells the UI to open the office panels with `ProamUI.openOffice(app, team, panel)` (`'whiteboard' | 'draft' | 'settings'`), and starts the ready check with `ProamUI.queue(app, team)`.

**Rules (as always):**
- data/ is untouched;
- kill processes by PID only;
- `rm` only with literal paths;
- don't edit a test to make it pass unless its rule changed;
- no real brands, real people or 2K terms in anything players see.
