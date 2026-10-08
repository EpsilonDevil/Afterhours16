// v0.4.5 balance check: box score rates plus the new systems (travels, hot/cold, takeovers, stamina, knockdowns)
import { runGame } from './sim_run.mjs';
const mode = process.argv[2] || 'park', N = +(process.argv[3] || 6), world = process.argv[4] === 'world';
const agg = { games: 0, pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, dunks: 0, blk: 0, stl: 0, tov: 0, ast: 0, reb: 0, oreb: 0 };
const ev = {}; let stam = 0, stamN = 0, minSt = 1, minutes = 0;
for (let s = 1; s <= N; s++) {
  const { g, counts, minutes: m } = runGame(mode, s * 101 + (world ? 7 : 0), { quarterLen: 150, maxMinutes: 40, world });
  minutes += m; agg.games++;
  for (const p of g.players) { for (const k in agg) if (k !== 'games') agg[k] += p.stats[k] || 0; stam += p.stamina; stamN++; minSt = Math.min(minSt, p.stamina); }
  for (const k of ['violation', 'hot', 'cold', 'takeover', 'posterContact', 'bump', 'ankle', 'block', 'feed']) ev[k] = (ev[k] || 0) + (counts[k] || 0);
}
const G = agg.games;
console.log(`${mode}${world ? ' (world)' : ''} x${G}: ${(minutes / G).toFixed(1)} min; FG ${(agg.fgm / agg.fga * 100).toFixed(1)}% 3P ${(agg.tpm / agg.tpa * 100).toFixed(1)}% (${(agg.tpa / G).toFixed(1)} 3PA/g) OREB% ${(agg.oreb / agg.reb * 100).toFixed(0)}; per game pts ${(agg.pts / G).toFixed(1)} dunks ${(agg.dunks / G).toFixed(1)} blk ${(agg.blk / G).toFixed(1)} stl ${(agg.stl / G).toFixed(1)} tov ${(agg.tov / G).toFixed(1)} ast ${(agg.ast / G).toFixed(1)}`);
console.log('events/game', Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, +(v / G).toFixed(2)])), 'end stamina avg', (stam / stamN).toFixed(2), 'min', minSt.toFixed(2));
