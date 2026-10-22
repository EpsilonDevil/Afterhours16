// v0.4.8.8 The Pro-Am Overhaul, the game's side of the meta layer (docs/PROAM-OVERHAUL.md): the season ladder in
// sim/ranks.js is the server's (server/proam.py: divisions, boosts, series, the playable top), and the AI teams' league
// identities on the server are the league's (sim/league.js TEAMS). The server's rules themselves: tests/test_v0488_proam.py.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../client/js/sim/ranks.js';
import { TEAMS } from '../client/js/sim/league.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const py = JSON.parse(execFileSync('python3', ['-c', `import json
from server import proam as P
print(json.dumps({"tiers": [list(t) for t in P.TIERS], "boost": list(P.BOOST), "top": P.TOP, "playable": P.PLAYABLE_TOP,
  "labels": [P.div_info(i)["label"] for i in range(len(P.DIVS))], "shapes": [list(P.series_shape(i)) for i in range(len(P.DIVS))],
  "league": [list(x) for x in P.LEAGUE], "rp_max": P.RP_MAX, "parks": list(P.PARKS)}))`], { cwd: root }).toString());

test('the twelve home courts are the World agent\'s parks, and venues the server takes', async () => {
  const { PROAM_IDS } = await import('../client/js/world/proamparks.js');
  assert.deepEqual(py.parks, PROAM_IDS);
  const fs = await import('node:fs');
  const venues = JSON.parse(fs.readFileSync(new URL('../server/venues.json', import.meta.url), 'utf8')).map(v => v.id);
  for (const p of py.parks) assert.ok(venues.includes('proam_' + p), p);
});

test('the ladder is the server\'s: tiers, divisions, labels, boosts, series, the playable top', () => {
  assert.deepEqual(R.DIV_TIERS, py.tiers);
  assert.equal(R.DIV_TOP, py.top);
  assert.equal(R.PLAYABLE_TOP, py.playable);
  assert.deepEqual(R.BOOST, py.boost);
  assert.equal(R.RP_MAX, py.rp_max);
  assert.deepEqual(R.DIVS.map((_, i) => R.divInfo(i).label), py.labels);
  assert.deepEqual(R.DIVS.map((_, i) => R.seriesShape(i)), py.shapes);
  assert.equal(R.divInfo(R.divIndex(2, 4)).label, 'Gold 4');
  assert.equal(R.divInfo(-3).label, 'Bronze 1'); assert.equal(R.divInfo(999).index, R.DIV_TOP);
  // the old tiers' colors carry on
  assert.equal(R.divInfo(R.divIndex(2, 1)).color, R.RANKS[2].color);
});

test('a build\'s season rank, its name icon, its borderplate and the online entry line', () => {
  const gold = { pa: { index: R.divIndex(2, 3), rp: 140, record: [9, 4], series: [3, 1] } };
  const s = R.seasonRank(gold);
  assert.deepEqual([s.label, s.rp, s.boost, s.record], ['Gold 3', 100, 0.04, [9, 4]]);
  assert.equal(R.seasonRank({}).label, 'Bronze 1', 'a build with none yet: Bronze 1');
  assert.deepEqual([0, 1, 2, 3, 4].map(R.showsIcon), [false, true, true, true, true]);
  assert.deepEqual([0, 1, 2, 3, 6].map(R.borderplate), [null, null, 'gold', 'platinum', 'platinum']);
  assert.deepEqual(R.entryProam(gold, true), { tier: 2, div: 3, record: [9, 4], showRecord: true, best: 2 });
  assert.equal(R.entryProam(gold).showRecord, false);
  // (best: the highest tier reached, this season or an old one, never below the tier now)
  assert.equal(R.entryProam({ pa: { ...gold.pa, best: 3 } }).best, 3, 'reached Platinum once: the record toggle stays his');
  assert.equal(R.entryProam({ pa: { ...gold.pa, best: 0 } }).best, 2);
  // the tier by a player's name: an online entry's, else his build's; none for the AI's players
  assert.equal(R.entryRankTier({ proam: { tier: 3, div: 1 } }), 3);
  assert.equal(R.entryRankTier({ build: gold }), 2);
  assert.equal(R.entryRankTier({ build: { name: 'AI' } }), null);
  assert.deepEqual(R.bannerInfo({ slot: 'banner', season: 2, tier: 'platinum' }), { season: 2, tier: 3, tier_name: 'Platinum', label: 'S2 · Platinum' });
  assert.equal(R.bannerInfo({ slot: 'chain' }), null);
});

test('the AI teams\' league identities on the server are the league\'s', () => {
  assert.ok(py.league.length >= 24);
  for (const [id, full, abbr, c1, c2, logo] of py.league) {
    const t = TEAMS.find(x => x.id === id);
    assert.ok(t, id);
    assert.deepEqual([t.full, t.abbr, t.c1, t.c2, t.logo], [full, abbr, c1, c2, logo], id);
  }
});
