// v0.4.5 The Pro Run: the league (schedule, simulated games, standings, draft, playoffs). Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../client/js/sim/league.js';

const me = { name: 'Test Wing', position: 'SF', overall: 70 };
const fresh = (seed = 99, settings = {}) => {
  const c = L.newCareer({ seed, college: 'csu', me, settings });
  L.runDraft(c, 12);
  L.startSeason(c);
  return c;
};

test('32 original teams in two conferences of 16, 12 colleges', () => {
  assert.equal(L.TEAMS.length, 32);
  for (const cf of L.CONFS) assert.equal(L.TEAMS.filter(t => t.conf === cf).length, 16);
  assert.equal(new Set(L.TEAMS.map(t => t.abbr)).size, 32);
  assert.equal(L.COLLEGES.length, 12);
  const real = /\b(Lakers|Celtics|Knicks|Bulls|Warriors|Heat|Spurs|Nets|Suns|Kings|Hawks|Rockets|Jazz|Magic|Bucks|Pistons|Pacers|Raptors|Grizzlies|Pelicans|Thunder|Nuggets|Clippers|Mavericks|Wizards|Hornets|Cavaliers|Timberwolves|76ers|Blazers)\b/;
  for (const t of [...L.TEAMS, ...L.COLLEGES]) assert.ok(!real.test(t.full), t.full);
});

test('82-game schedule: 41 at home, the right opponents, no doubleheaders or three days running', () => {
  const c = fresh();
  assert.equal(c.sched.length, 32 * 82 / 2);
  const games = new Array(32).fill(0), home = new Array(32).fill(0), pair = new Map(), days = new Map();
  for (const [d, h, a] of c.sched) {
    games[h]++; games[a]++; home[h]++;
    const k = Math.min(h, a) + '-' + Math.max(h, a); pair.set(k, (pair.get(k) || 0) + 1);
    for (const t of [h, a]) { const s = days.get(t) || new Set(); assert.ok(!s.has(d), 'two games in a day'); s.add(d); days.set(t, s); }
  }
  assert.ok(games.every(g => g === 82)); assert.ok(home.every(g => g === 41));
  for (let t = 0; t < 32; t++) {
    const four = [], three = [];
    for (let o = 0; o < 32; o++) {
      if (o === t) continue;
      const n = pair.get(Math.min(t, o) + '-' + Math.max(t, o));
      if (L.TEAMS[o].conf !== L.TEAMS[t].conf) assert.equal(n, 2); else if (n === 4) four.push(o); else { assert.equal(n, 3); three.push(o); }
    }
    assert.equal(four.length, 5); assert.equal(three.length, 10);
    const ds = [...days.get(t)].sort((a, b) => a - b);
    for (let i = 2; i < ds.length; i++) assert.ok(!(ds[i] - ds[i - 2] === 2), 'three days running');
  }
});

test('simulated box scores add up', () => {
  const c = fresh(5);
  const book = {}, res = [];
  for (let gi = 0; gi < 40; gi++) {
    const before = JSON.parse(JSON.stringify(book));
    const [hs, as] = L.simGame(c, gi, book, c.sched, res);
    const [, h, a] = c.sched[gi];
    let sumH = 0, sumA = 0;
    for (const [id, row] of Object.entries(book)) {
      const prev = before[id] || row.map(() => 0), d = row.map((v, i) => v - prev[i]);
      const k = Object.fromEntries(L.STAT_KEYS.map((key, i) => [key, d[i]]));
      if (!k.gp) continue;
      assert.equal(k.pts, 2 * k.fgm + k.tpm + k.ftm, 'points add up');
      assert.ok(k.fgm <= k.fga && k.tpm <= k.tpa && k.tpa <= k.fga && k.ftm <= k.fta);
      const t = L.playerById(c, id).t;
      if (t === h) sumH += k.pts; else if (t === a) sumA += k.pts;
    }
    assert.equal(sumH, hs); assert.equal(sumA, as);
    assert.notEqual(hs, as);
  }
});

test('a whole season, the play-in, four rounds and a champion; the same seed gives the same league', () => {
  const run = seed => {
    const c = fresh(seed);
    L.simThrough(c, 1e9);
    assert.ok(L.seasonDone(c));
    const st = L.standings(c);
    let w = 0, l = 0; for (const cf of L.CONFS) for (const r of st[cf]) { w += r.w; l += r.l; assert.equal(r.w + r.l, 82); }
    assert.equal(w, 1312); assert.equal(l, 1312);
    L.startPlayoffs(c);
    let guard = 0; while (c.po.champ == null && guard++ < 300) L.simPlayoffDay(c, true);
    assert.notEqual(c.po.champ, null);
    assert.equal(c.phase, 'offseason');
    assert.equal(c.po.series.filter(s => s.round === 0).length, 6);
    assert.equal(c.po.series.filter(s => s.round === 1).length, 8);
    assert.equal(c.po.series.filter(s => s.round === 4).length, 1);
    for (const s of c.po.series) assert.equal(Math.max(...s.w), Math.ceil(s.bestOf / 2));
    // the 7 seed is the 7v8 winner; the 8 seed came through the second play-in game
    for (const cf of L.CONFS) { const A = c.po.series.find(s => s.round === 0 && s.conf === cf && s.tag === 'A'); assert.equal(c.po.seeds[cf][6], A.winner); }
    assert.ok(c.awards.mvp && c.awards.dpoy && c.awards.scoring);
    return JSON.stringify([c.res, c.po.series.map(s => s.w), c.po.champ]);
  };
  assert.equal(run(321), run(321));
  assert.notEqual(run(321), run(322));
});

test('sim settings: single-game playoffs without a play-in, your minutes', () => {
  const c = fresh(8, { playoffs: '1111', playIn: false, minutes: 'starter' });
  const mine = L.rotation(c, c.myTeam).find(r => r.p.me);
  assert.equal(Math.round(mine.min), 34);
  assert.equal(Math.round(L.rotation(c, c.myTeam).reduce((s, r) => s + r.min, 0)), 240);
  L.simThrough(c, 1e9); L.startPlayoffs(c);
  assert.equal(c.po.series.filter(s => s.round === 0).length, 0);
  let g = 0; while (c.po.champ == null && g++ < 50) L.simPlayoffDay(c, true);
  assert.ok(c.po.series.every(s => s.w[0] + s.w[1] === 1));
});

test('college games set the draft slot; the team holding it takes you', () => {
  assert.equal(L.pickForStock(40), 1);
  assert.equal(L.pickForStock(-20), 64);
  for (let s = -10; s < 40; s++) assert.ok(L.pickForStock(s) >= L.pickForStock(s + 1));
  const c = L.newCareer({ seed: 77, college: 'nrt', me });
  assert.equal(c.college.games.length, 3);
  assert.ok(!c.college.games.some(g => g.opp === 'nrt'));
  const line = { pts: 24, fgm: 9, fga: 15, ftm: 3, fta: 4, tpm: 3, tpa: 6, reb: 6, oreb: 1, ast: 5, stl: 2, blk: 1, tov: 2, pf: 1 };
  const bad = { pts: 2, fgm: 1, fga: 9, ftm: 0, fta: 2, tpm: 0, tpa: 4, reb: 1, oreb: 0, ast: 0, stl: 0, blk: 0, tov: 4, pf: 3 };
  c.college.games.forEach(g => { g.result = { won: true, quarterLen: 300, grade: 10, stats: line }; });
  const good = L.pickForStock(L.draftStock(c.college.games));
  c.college.games.forEach(g => { g.result = { won: false, quarterLen: 300, grade: 2, stats: bad }; });
  const poor = L.pickForStock(L.draftStock(c.college.games));
  assert.ok(good < 6, `good college games went #${good}`);
  assert.ok(poor > 40, `poor college games went #${poor}`);
  const d = L.runDraft(c, 17);
  const order = L.draftOrder(c);
  assert.equal(d.team, order[16]);
  assert.equal(c.myTeam, order[16]);
  assert.equal(d.board.length, 64);
  for (let t = 0; t < 32; t++) assert.equal(L.roster(c, t).length, 15);
  assert.ok(L.roster(c, c.myTeam).some(p => p.me));
});

test('a game you played counts: the score, the ten players and your log', () => {
  const c = fresh(11);
  const gi = L.nextMyGame(c);
  L.simBefore(c, gi);
  const [, h] = c.sched[gi], home = h === c.myTeam;
  const five = L.startingFive(c, c.myTeam, true), them = L.startingFive(c, home ? c.sched[gi][2] : h, false);
  assert.equal(five[0].id, 'me'); assert.equal(five.length, 5); assert.equal(them.length, 5);
  const st = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
  const players = [...five, ...them].map((p, i) => ({ id: i, team: i < 5 ? 0 : 1, stats: { ...st, pts: i === 0 ? 14 : 2, fgm: i === 0 ? 7 : 1, fga: 12 } }));
  const ids = [...five, ...them].map(p => p.id);
  const r = L.recordPlayed(c, gi, { score: [58, 51], winner: 0, players, quarterLen: 300 }, ids);
  assert.deepEqual(r, home ? [58, 51, 1] : [51, 58, 1]);
  const log = c.log[c.log.length - 1];
  assert.equal(log.played, 1); assert.equal(log.w, 1); assert.equal(log.line[2], 14);
  assert.equal(L.perGame(c.stats, 'me').pts, 14);
  assert.equal(L.records(c)[c.myTeam].w, L.standings(c)[L.TEAMS[c.myTeam].conf].find(x => x.t === c.myTeam).w);
});
