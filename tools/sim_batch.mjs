import { runGame } from './sim_run.mjs';
const mode = process.argv[2] || 'park', N = +(process.argv[3] || 6);
const agg = { games: 0, over: 0, minutes: 0, pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, dunks: 0, blk: 0, stl: 0, tov: 0, ast: 0, ankles: 0, fta: 0 };
for (let s = 1; s <= N; s++) {
  const { g, minutes } = runGame(mode, s * 101, { quarterLen: 150, maxMinutes: 40 });
  agg.games++; agg.over += g.over ? 1 : 0; agg.minutes += minutes;
  for (const p of g.players) for (const k of ['pts', 'fga', 'fgm', 'tpa', 'tpm', 'dunks', 'blk', 'stl', 'tov', 'ast', 'ankles', 'fta']) agg[k] += p.stats[k];
  console.log('seed', s * 101, 'over', g.over, 'score', g.score.join('-'), 'q', g.quarter, 'min', minutes.toFixed(1));
}
const G = agg.games;
console.log(`finished ${agg.over}/${G}; avg minutes ${(agg.minutes / G).toFixed(1)}; FG ${(agg.fgm / agg.fga * 100).toFixed(0)}% 3P ${(agg.tpm / agg.tpa * 100).toFixed(0)}% (${(agg.tpa / G).toFixed(1)} 3PA/g); per game: pts ${(agg.pts / G).toFixed(1)} dunks ${(agg.dunks / G).toFixed(1)} blk ${(agg.blk / G).toFixed(1)} stl ${(agg.stl / G).toFixed(1)} tov ${(agg.tov / G).toFixed(1)} ast ${(agg.ast / G).toFixed(1)} ankles ${(agg.ankles / G).toFixed(1)} fta ${(agg.fta / G).toFixed(1)}`);
