// v0.4.8.5 quick patch 4: keeping the game's idea of the running park event in step with the server's schedule. Before,
// the event (and with it where the AI world sends the event's entrants) was read once, when the game started: a game
// left running across a handover kept sending them to the park that had just closed, and the new event park stood
// empty for everyone who'd been playing through the switch. Now the AI world follows the schedule itself
// (sim/world.js eventVenueAt) and this keeps app.config.event, the Park screen's card and the AI world's venue current.
import { setEventVenue, setEventSchedule, eventVenueAt, refreshUnlocks } from '../sim/world.js';
import { EVENTS, THEMES } from '../world/themes.js';
import { toast } from './common.js';

// st: an /api/cup state (event, event_schedule, now) or /api/config. Returns true when the running event changed.
export function syncEvent(app, st, { announce = true } = {}) {
  if (!st || !app?.config) return false;
  if (Array.isArray(st.event_schedule)) setEventSchedule(st.event_schedule, st.now ?? st.server_time ?? null);
  const was = app.config.event || null, now = st.event || null;
  if ((was?.id || null) === (now?.id || null)) return false;
  app.config.event = now;
  setEventVenue(now?.venue || null, true); // (the schedule, when known, stays in charge)
  if (announce) {
    const at = app.world?.themeId, closed = at && THEMES[at]?.event && at !== now?.venue;
    const next = now && EVENTS[now.id];
    if (closed) toast(`${THEMES[at].name} has closed: its leaderboard is final.${next ? ` ${next.park} is on now — find it on the Park screen.` : ''}`, 'good');
    else if (next) toast(`${next.park} is live now: ${next.enter || 'enter it'} from the Park screen.`, 'good');
  }
  return true;
}

// every few seconds: when the schedule says another event is on than the one the game shows, ask the server and
// switch (the server has the last word: an edited schedule, a clock that's off)
export function watchEvents(app, every = 15000) {
  let busy = false;
  const tick = async () => {
    if (busy || !app?.config || !app.api) return;
    // (v0.4.8.5 qp7: a window has closed: what the AI field won in it, for them to wear)
    if (app.ai?.unlocksDue?.()) refreshUnlocks(app);
    const want = eventVenueAt(Date.now()), have = app.config.event?.venue || null;
    if (want === have) return;
    busy = true;
    try { syncEvent(app, await app.api.get('/api/cup')); } catch { /* (signed out, or the service is away: next tick) */ }
    busy = false;
  };
  const h = setInterval(tick, every);
  return { tick, stop: () => clearInterval(h) };
}
