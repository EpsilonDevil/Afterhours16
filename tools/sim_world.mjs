// v0.4.4 balance: games between persistent-world AI hoopers. node tools/sim_world.mjs mix 8 | tiers 6
import { runGame } from './sim_run.mjs';
const what = process.argv[2] || 'mix', N = +(process.argv[3] || 6), mode = process.argv[4] || 'park';
const line = (label, games) => {
  const a = { pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, blk: 0, stl: 0, tov: 0, ast: 0, dunks: 0 };
  let winsA = 0, margin = 0;
  for (const { g } of games) { for (const p of g.players) for (const k in a) a[k] += p.stats[k]; if (g.winner === 0) winsA++; margin += g.score[0] - g.score[1]; }
  const G = games.length;
  console.log(`${label}: A wins ${winsA}/${G}, avg margin ${(margin / G).toFixed(1)}; FG ${(a.fgm / a.fga * 100).toFixed(0)}% 3P ${(a.tpm / a.tpa * 100).toFixed(0)}% pts/g ${(a.pts / G).toFixed(1)} stl ${(a.stl / G).toFixed(1)} blk ${(a.blk / G).toFixed(1)} tov ${(a.tov / G).toFixed(1)} ast ${(a.ast / G).toFixed(1)} dunks ${(a.dunks / G).toFixed(1)}`);
};
if (what === 'mix') {
  const games = [];
  for (let s = 1; s <= N; s++) games.push(runGame(mode, s * 37, { world: true, quarterLen: 150, maxMinutes: 40 }));
  line('mixed world', games);
} else {
  for (const pair of [['hooper', 'regular'], ['elite', 'hooper'], ['legend', 'regular'], ['regular', 'casual']]) {
    const games = [];
    for (let s = 1; s <= N; s++) games.push(runGame(mode, s * 53 + pair[0].length, { tiers: pair, quarterLen: 150, maxMinutes: 40 }));
    line(pair.join(' vs '), games);
  }
}
