// v0.4.8.6 qp: the season reset (server/reset.py). At midnight Eastern going into Oct 19 2026 every account starts over:
// builds, VC, items and event items, crews and the AI world are wiped, and everyone signs back in to a fresh account
// with 250,000 VC. The service resets its save the first time it's asked anything at or after that moment; a game left
// open says so 10 minutes and 1 minute ahead, then reloads a few seconds after it, onto the fresh account.
// (app.config.season_reset: {id, at (Unix s), vc, done}; app.config.server_time keeps a PC clock that's a little off on
// the server's time)
export const RESET_WARN = [10 * 60000, 60000], RESET_RELOAD = 4000;
export const vcText = vc => `${Number(vc || 0).toLocaleString('en-US')} VC`;
export function warnText(left, vc) {
  const when = left >= 120000 ? `in ${Math.round(left / 60000)} minutes` : 'in 1 minute';
  return `Season reset ${when}: every account starts over with ${vcText(vc)}. Builds, VC and items are wiped.`;
}
export function watchSeasonReset(app, { now = () => Date.now(), say, reload = () => location.reload(), setT = setTimeout } = {}) {
  const r = app?.config?.season_reset;
  if (!r || r.done || !Number.isFinite(r.at)) return null;
  const st = Number(app.config.server_time), skew = Number.isFinite(st) && Math.abs(st * 1000 - now()) < 6 * 3600000 ? st * 1000 - now() : 0;
  const at = r.at * 1000 - skew, left = at - now(); // (on this PC's clock)
  if (left < -60000 || left > 2 * 86400000) return null; // (long past: the service has reset already; days away: a later load sets it up)
  const timers = [];
  for (const w of RESET_WARN) if (left > w) timers.push(setT(() => say?.(warnText(w, r.vc)), left - w));
  timers.push(setT(() => { say?.('Season reset: starting over…'); setT(reload, 1500); }, Math.max(0, left) + RESET_RELOAD));
  return { at, timers };
}
