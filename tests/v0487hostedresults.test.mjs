// v0.4.8.7: hosted games' results, checked on the server (server/app.py judge_hosted, server/online.py Hub.results;
// the Python side: tests/test_hosted_results.py). The game's side: every real player's own end of an online game goes
// to the online server with the final score (game/session.js), and a result the server voids comes back as the game's
// usual "Result not saved: <why>" (core/api.js: the server's own words).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the end of an online game carries the final score, from every real player (not only the first)', () => {
  const s = src('client/js/game/session.js');
  assert.match(s, /net\.send\(\{ t: 'end', g: this\.online\.game, winners: this\.winnersOnline\(\), score: \[g\.score\[0\], g\.score\[1\]\] \}\)/);
  // (sent once a game, when it's over on this screen: every client ends on the same tick)
  assert.match(s, /if \(g\.over && !this\.ended\) \{\n\s+this\.ended = true;/);
  // the online server keeps every one of them, and a spectator's screen sends none
  assert.match(s, /if \(!spec && !lk\.offline\) net\.send\(\{ t: 'end'/);
  const py = src('server/online.py');
  assert.match(py, /rec\["reports"\]\[conn\.aid\] = \{"winners": /);
});

test('a voided result says why, in the server\'s words', async () => {
  globalThis.crypto ??= { randomUUID: () => '0123456789abcdef0123456789abcdef' };
  const { API } = await import('../client/js/core/api.js');
  const msg = "This game's result didn't match what the other players' games reported, so it wasn't counted (your 5,000 VC ante is back). It's been logged.";
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: msg, disputed: true }) });
  await assert.rejects(new API().mutate('/api/matches/x/complete', { summary: {} }), e => e.status === 409 && e.message === msg);
  // and every place an online game's result is saved shows that message to the player
  for (const f of ['client/js/game/park.js', 'client/js/ui/modes.js']) assert.match(src(f), /\/complete`, \{ summary, mates[^)]*\)\.catch\(e => \{ [^}]*'Result not saved: ' \+ e\.message/);
});
