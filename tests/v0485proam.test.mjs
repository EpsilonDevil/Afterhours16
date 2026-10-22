// v0.4.8.5: Pro-Am ranks, Bronze to Grandmaster by RP: the client's table (sim/ranks.js) against the server's
// (server/progression.py), the friends rule (an online Pro-Am squad's real players within 2 ranks), the ratings the
// client sends with a Pro-Am ticket, and the wiring in the screens.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RANKS, RANK_SPAN, RATING_MAX, FORFEIT_RP, SEED_MAX, rankOf, tierOf, rpOf, entryRP, rankSpan, withinSpan, spanMessage, levelRating, teamRating } from '../client/js/sim/ranks.js';
import * as Online from '../client/js/ui/online.js';
import { rankEmblemSVG } from '../client/js/ui/badgeart.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const T = Object.fromEntries(RANKS.map((r, i) => [r.id, r.floor + (i * 37) % 300])); // an RP inside each rank

test('rankOf: seven ranks, no divisions, from 0 RP up with no cap', () => {
  assert.deepEqual(RANKS.map(r => r.name), ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster']);
  assert.deepEqual(RANKS.map(r => r.floor), [0, 400, 800, 1200, 1600, 2000, 2400]);
  for (const [rp, tier] of [[0, 0], [399, 0], [400, 1], [799, 1], [800, 2], [1199, 2], [1200, 3], [1600, 4], [1999, 4], [2000, 5], [2399, 5], [2400, 6], [12345, 6], [-30, 0], [null, 0], ['x', 0]]) assert.equal(rankOf(rp).tier, tier, String(rp));
  const g = rankOf(950);
  assert.deepEqual([g.name, g.floor, g.next, g.toNext, g.rp], ['Gold', 800, 1200, 250, 950]);
  assert.equal(g.pct, 150 / 400);
  const top = rankOf(3100);
  assert.deepEqual([top.next, top.pct, top.toNext], [null, 1, 0]);
  assert.equal(rpOf({ progression: { proam: { rp: 777 } } }), 777);
  assert.equal(rpOf({}), 0);
  assert.equal(entryRP({ proam_rp: 1300 }), 1300);
  assert.equal(entryRP({}), null);
  assert.equal(entryRP({ proam_rp: 'lots' }), null);
});

test('the friends rule: real teammates within 2 ranks (the owner\'s example)', () => {
  const pair = (a, b) => rankSpan([{ name: 'A', rp: T[a] }, { name: 'B', rp: T[b] }]);
  // Silver plays with Bronze and Gold, and with Platinum (2 apart)
  assert.equal(pair('silver', 'bronze'), null);
  assert.equal(pair('silver', 'gold'), null);
  assert.equal(pair('silver', 'platinum'), null);
  assert.equal(pair('silver', 'diamond')?.apart, 3);
  // Bronze and Platinum are 3 apart: blocked
  assert.equal(pair('bronze', 'platinum')?.apart, 3);
  assert.equal(pair('bronze', 'gold'), null);
  assert.equal(pair('grandmaster', 'diamond'), null);
  assert.equal(pair('grandmaster', 'platinum')?.apart, 3);
  assert.equal(withinSpan(T.silver, T.platinum), true);
  assert.equal(withinSpan(T.bronze, T.platinum), false);
  for (let a = 0; a < RANKS.length; a++) for (let b = 0; b < RANKS.length; b++) assert.equal(withinSpan(RANKS[a].floor, RANKS[b].floor), Math.abs(a - b) <= RANK_SPAN);
  // every pair counts: Bronze, Silver and Platinum together are out (Bronze and Platinum), whoever is in the middle
  const bad = rankSpan([{ name: 'Mike', rp: T.diamond }, { name: 'Ty', rp: T.gold }, { name: 'me', rp: T.bronze, you: true }]);
  assert.equal(bad.apart, 4);
  assert.equal(spanMessage(rankSpan([{ name: 'Mike', rp: T.diamond }, { name: 'me', rp: 120, you: true }])), 'Pro-Am squads must be within 2 ranks: Mike (Diamond) and you (Bronze) are 4 apart.');
  assert.equal(spanMessage(rankSpan([{ name: 'me', rp: T.diamond, you: true }, { name: 'Mike', rp: T.silver }])), 'Pro-Am squads must be within 2 ranks: you (Diamond) and Mike (Silver) are 3 apart.');
  // unknown RP (no entry yet) isn't checked; one player is always fine
  assert.equal(rankSpan([{ name: 'me', rp: T.grandmaster }, { name: 'X', rp: null }]), null);
  assert.equal(rankSpan([{ name: 'me', rp: 0 }]), null);
  assert.equal(spanMessage(null), '');
});

test('the squad check in an online squad: free real teammates only, AI never', () => {
  const app = (mine, mates) => ({
    char: () => ({ name: 'Me', progression: { proam: { rp: mine } } }),
    net: { myId: 'me', you: { username: 'me' }, squad: { leader: 'me', members: [{ id: 'me' }, ...mates.map(m => ({ id: m.id, name: m.name, inGame: !!m.busy, ai: [{ id: 'ai-1', name: 'Bot' }] }))] },
      entryOf: id => mates.find(m => m.id === id)?.entry || null },
  });
  assert.equal(Online.squadRankProblem(app(T.silver, [{ id: 'a', name: 'Al', entry: { proam_rp: T.bronze } }, { id: 'b', name: 'Bo', entry: { proam_rp: T.gold } }])), '');
  assert.equal(Online.squadRankProblem(app(T.silver, [{ id: 'b', name: 'Bo', entry: { proam_rp: T.platinum } }])), '');
  // every pair: the Bronze (Al) and the Platinum (Bo) both suit up with the Silver: blocked, though each is fine with him
  assert.equal(Online.squadRankProblem(app(T.silver, [{ id: 'a', name: 'Al', entry: { proam_rp: T.bronze } }, { id: 'b', name: 'Bo', entry: { proam_rp: T.platinum } }])), 'Pro-Am squads must be within 2 ranks: Bo (Platinum) and Al (Bronze) are 3 apart.');
  assert.equal(Online.squadRankProblem(app(T.bronze, [{ id: 'a', name: 'Mike', entry: { proam_rp: T.diamond } }])), 'Pro-Am squads must be within 2 ranks: Mike (Diamond) and you (Bronze) are 4 apart.');
  assert.match(Online.squadRankProblem(app(T.silver, [{ id: 'a', name: 'Al', entry: { proam_rp: T.bronze } }, { id: 'b', name: 'Bo', entry: { proam_rp: T.diamond } }])), /Bo \(Diamond\) and Al \(Bronze\) are 4 apart/);
  // a mate who's busy in a game doesn't suit up, so isn't checked
  assert.equal(Online.squadRankProblem(app(T.bronze, [{ id: 'a', name: 'Mike', busy: true, entry: { proam_rp: T.diamond } }])), '');
  // no squad: nothing to check
  assert.equal(Online.squadRankProblem({ char: () => ({}), net: { squad: null } }), '');
  assert.equal(Online.memberRank(app(T.gold, []), 'me').name, 'Gold');
  assert.match(Online.rankChip(rankOf(T.master)), /rk-chip r5[\s\S]*Master/);
});

test('ratings sent with a Pro-Am ticket: AI by level, real players by RP', () => {
  assert.equal(levelRating(0.5), 0);
  assert.equal(levelRating(0.61), 660);
  assert.equal(levelRating(0.95), 2700);
  assert.equal(levelRating(0.2), 0);
  assert.equal(levelRating(1.2), RATING_MAX);
  const ai = l => ({ human: false, level: l }), me = rp => ({ human: true, proam_rp: rp });
  assert.equal(teamRating([ai(0.6), ai(0.6), ai(0.6), ai(0.6), ai(0.6)]), 600);
  assert.equal(teamRating([me(2000), me(1000), ai(0.6), ai(0.7), { human: false }], 0.5), Math.round((2000 + 1000 + 600 + 1200 + 0) / 5));
  assert.equal(teamRating([me(99999)]), RATING_MAX);
  assert.equal(teamRating([], 0.64), levelRating(0.64));
  // the online setup keeps what rates a team: an AI player's level, a real player's RP
  const e = Online.setupEntry({ catalog: {} }, { build: { position: 'PG' }, name: 'X', look: {}, level: 0.71, proam_rp: 50 }, false);
  assert.equal(e.level, 0.71);
  assert.equal('proam_rp' in e, false);
  const h = Online.setupEntry({ catalog: {} }, { build: { position: 'PG' }, name: 'Y', look: {}, proam_rp: 1450, username: 'y' }, true);
  assert.equal(h.proam_rp, 1450);
});

test('the client\'s table is the server\'s', () => {
  const py = src('server/progression.py');
  const block = py.match(/PROAM_RANKS = \(([\s\S]*?)\)\n/)[1];
  const rows = [...block.matchAll(/\("(\w+)", "([\w ]+)", (\d+)\)/g)].map(m => ({ id: m[1], name: m[2], floor: +m[3] }));
  assert.deepEqual(rows, RANKS.map(({ id, name, floor }) => ({ id, name, floor })));
  const num = k => +py.match(new RegExp(`${k} = (\\d+)`))[1];
  assert.equal(num('PROAM_RANK_SPAN'), RANK_SPAN);
  assert.equal(num('PROAM_RATING_MAX'), RATING_MAX);
  assert.equal(num('PROAM_FORFEIT_RP'), FORFEIT_RP);
  assert.equal(num('PROAM_SEED_MAX'), SEED_MAX);
  // and the server's proam_rank agrees with rankOf, RP by RP
  const rps = [0, 1, 399, 400, 401, 799, 800, 1199, 1200, 1599, 1600, 1999, 2000, 2399, 2400, 2401, 5000];
  const out = spawnSync('python3', ['-c', `import json,sys; from server import progression as p; print(json.dumps([p.proam_rank(x) for x in json.loads(sys.argv[1])]))`, JSON.stringify(rps)], { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0 && /not found|ENOENT/.test(String(out.error || ''))) return; // (no Python here)
  assert.equal(out.status, 0, out.stderr);
  const server = JSON.parse(out.stdout);
  rps.forEach((rp, i) => { const c = rankOf(rp), s = server[i]; assert.deepEqual([s.tier, s.id, s.name, s.floor, s.next, s.rp], [c.tier, c.id, c.name, c.floor, c.next, c.rp], String(rp)); });
});

test('rank emblems: one per rank, in its colours', () => {
  for (let i = 0; i < RANKS.length; i++) {
    const svg = rankEmblemSVG(i, 40);
    assert.match(svg, new RegExp(`class="rank-em r${i}"`));
    assert.ok(svg.includes(RANKS[i].color) && svg.includes(RANKS[i].dark));
  }
  assert.match(rankEmblemSVG(rankOf(2500), 20), /rank-em r6/);
  assert.notEqual(tierOf(400), tierOf(399));
});

test('wiring: tickets carry the other team\'s rating, Forfeit & leave costs RP, online squads are checked', () => {
  const modes = src('client/js/ui/modes.js'), online = src('client/js/ui/online.js');
  // offline: the AI team's level; online: the other roster (real players by RP)
  assert.match(modes, /opp_rating: levelRating\(level\)/);
  assert.match(modes, /teamRating\(setup\.rosters\[1 - myTeam\], setup\.levels/);
  assert.match(modes, /opp_rating: myOpp \?\? oppRating/); // (v0.4.8.8: a series game: the server's rating of the other team, each team's own)
  // the pause menu's forfeit, Pro-Am only (a lost connection sends no flag)
  assert.match(modes, /cancel`, pa \? \{ forfeit: true \} : \{\}\)/);
  assert.match(modes, /onLost: async \(\) => \{ if \(ticket\) \{ try \{ await app\.api\.post\(`\/api\/matches\/\$\{ticket\.id\}\/cancel`, \{\}\)/);
  // the leader's start, a challenge sent and one accepted all check the squad
  assert.match(modes, /export function startProAmOnline[\s\S]{0,600}squadRankProblem\(app\)[\s\S]{0,80}if \(bad\) \{ toast\(bad, 'error'\); return; \}/);
  assert.match(online, /data-och[\s\S]{0,200}squadRankProblem\(app\)/);
  assert.match(online, /onYes: \(\) => \{ const bad = squadRankProblem\(app\); if \(bad\) toast\(bad, 'error'\); net\.send\(\{ t: 'challenge-reply', from: m\.from, ok: !bad \}\)/);
  // your RP goes with your online entry (and is sent again when it changes)
  assert.match(online, /proam_rp: rpOf\(c\) \};/);
  assert.match(online, /\$\{rpOf\(c\)\}\|/);
  // results: the RP tile, the breakdown and the promotion banner
  assert.match(modes, /r\.proam_rank \? `<div class="reward rp/);
  assert.match(modes, /PROMOTED TO \$\{esc\(ra\.name\.toUpperCase\(\)\)\}/);
  assert.match(modes, /\['Result', p\.result\], \['Competition', p\.competition\], \['Performance', p\.performance\]/);
});
