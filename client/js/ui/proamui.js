// v0.4.8.8 The Pro-Am Overhaul: the Pro-Am menu and office UI as the hub's interactables call it (game/proamhub.js).
// The code is in ui/proam.js (the Pro-Am tab, the office panels, the ready check and the queue); this is its entry point:
//   openOffice(app, team = null, panel = 'whiteboard', opts = {}) -> Promise
//     panel: 'whiteboard' (the series game by game, records, ranks, RP bars, the season countdown) | 'draft' (the GM
//     clipboard) | 'settings' (the founder's team settings). team: optional; the player's own team is loaded from the
//     server (GET /api/proam) and wins. opts.captain: false when the player isn't the session's Captain (the draft is
//     read-only for him).
//   queue(app, team = null, opts = {}) -> Promise
//     the ready check (the connected teammates, 20 s), then the matchmaker (a real team within 2 divisions, else the
//     nearest AI team after 45 s), then the series game at the home team's park (Modes.proamGame). opts.members: the
//     team members in the hub ([{id, name}], the Captain first); opts.ready(done, secs): the hub's own ready check, which
//     calls done({humans, members}) when it's over.
export { openOffice, queue, render, load } from './proam.js';
