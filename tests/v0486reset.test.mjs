// v0.4.8.6 quick patch: the season reset, the game's side (ui/seasonreset.js). A game left open warns 10 minutes and
// 1 minute before the reset (server/reset.py; app.config.season_reset {id, at, vc, done}) and reloads a few seconds after
// it, onto the fresh account; on the server's clock (app.config.server_time). The service side: tests/test_season_reset.py.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { watchSeasonReset, warnText, RESET_WARN, RESET_RELOAD } from '../client/js/ui/seasonreset.js';

const fake = () => { const q = []; return { q, setT: (f, ms) => { q.push({ f, ms }); return q.length; } }; };
const T0 = Date.UTC(2026, 9, 19, 2, 30);

test('warns 10 minutes and 1 minute ahead, then reloads a few seconds after the reset', () => {
  const at = Date.UTC(2026, 9, 19, 4, 0) / 1000, said = [], reloads = [];
  const { q, setT } = fake();
  const app = { config: { season_reset: { id: 'season-2026-10-19', at, vc: 250000, done: false }, server_time: T0 / 1000 } };
  const w = watchSeasonReset(app, { now: () => T0, setT, say: t => said.push(t), reload: () => reloads.push(1) });
  assert.equal(w.at, at * 1000);
  assert.deepEqual(q.map(x => x.ms), [90 * 60000 - RESET_WARN[0], 90 * 60000 - RESET_WARN[1], 90 * 60000 + RESET_RELOAD]);
  q.slice(0, 3).forEach(x => x.f());
  assert.deepEqual(said.slice(0, 2), ['Season reset in 10 minutes: every account starts over with 250,000 VC. Builds, VC and items are wiped.',
    'Season reset in 1 minute: every account starts over with 250,000 VC. Builds, VC and items are wiped.']);
  assert.equal(said[2], 'Season reset: starting over…');
  q[3].f();
  assert.equal(reloads.length, 1);
  assert.equal(warnText(600000, 250000), said[0]);
});

test('on the server\'s clock, and nothing when it\'s done, long past or days away', () => {
  const at = Date.UTC(2026, 9, 19, 4, 0) / 1000;
  // a PC clock 2 minutes fast still reloads when the server's clock says so
  let { q, setT } = fake();
  watchSeasonReset({ config: { season_reset: { at, vc: 250000 }, server_time: T0 / 1000 - 120 } }, { now: () => T0, setT });
  assert.equal(q[q.length - 1].ms, 90 * 60000 + 120000 + RESET_RELOAD);
  for (const cfg of [{ season_reset: { at, vc: 250000, done: true } }, { season_reset: null }, {}, { season_reset: { at: at - 3 * 3600, vc: 1 } }, { season_reset: { at: at + 5 * 86400, vc: 1 } }]) {
    ({ q, setT } = fake());
    assert.equal(watchSeasonReset({ config: { ...cfg, server_time: T0 / 1000 } }, { now: () => T0, setT }), null);
    assert.equal(q.length, 0);
  }
  // opened in the last few seconds before it: just the reload
  ({ q, setT } = fake());
  watchSeasonReset({ config: { season_reset: { at, vc: 250000 }, server_time: at - 30 } }, { now: () => (at - 30) * 1000, setT });
  assert.deepEqual(q.map(x => x.ms), [30000 + RESET_RELOAD]);
});

test('main.js starts the watch as soon as the config is in, on every screen', () => {
  const main = fs.readFileSync(new URL('../client/js/main.js', import.meta.url), 'utf8');
  assert.ok(main.includes("import { watchSeasonReset } from './ui/seasonreset.js';"));
  assert.ok(main.indexOf('watchSeasonReset(app') > main.indexOf("app.config = await app.api.get('/api/config')"));
  assert.ok(main.indexOf('watchSeasonReset(app') < main.indexOf('Checking your account'));
});
