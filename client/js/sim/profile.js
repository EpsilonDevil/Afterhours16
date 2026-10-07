// v0.4.4 lifetime stats helpers (Stats screen, results) and the auto-play profile: when auto-play takes over
// your player, the AI plays him the way your account's numbers say you play him — shot volume and shot mix,
// passing, steals, boards and blocks per game, and how often your twos, threes and free throws go in.
import { tendenciesFor } from './bots.js';

export const STAT_LABELS = { pts: 'PTS', reb: 'REB', oreb: 'OREB', ast: 'AST', stl: 'STL', blk: 'BLK', tov: 'TOV', pf: 'PF', fgm: 'FGM', fga: 'FGA', tpm: '3PM', tpa: '3PA', ftm: 'FTM', fta: 'FTA', dunks: 'Dunks', greens: 'Greens', ankles: 'Ankle breakers', contested_makes: 'Contested makes', posters: 'Posters', putbacks: 'Putbacks', chasedowns: 'Chase-down blocks', alleyoops: 'Alley-oops' };
// per-game averages the sim produces for a typical player in each mode (the "league average" the profile is
// measured against)
export const MODE_BASE = {
  park: { fga: 9, tpa: 3.2, ast: 2.8, stl: 1.4, reb: 4.2, blk: 0.9, tov: 1.8, fg2: 0.47, tp: 0.33, ft: 0.7 },
  proam: { fga: 7, tpa: 2.8, ast: 2.4, stl: 1.1, reb: 3.6, blk: 0.5, tov: 1.5, fg2: 0.45, tp: 0.34, ft: 0.7 },
};

// totals for one character: mode 'park' | 'proam' | 'all'
export function careerSplit(char, mode = 'all') {
  const prog = char?.progression || {};
  if (mode !== 'all') {
    const s = prog.career_modes?.[mode];
    if (s && s.gp) return { ...s };
    return { gp: 0, wins: 0, secs: 0 };
  }
  const c = { ...(prog.career || {}) };
  c.gp = prog.games || 0; c.wins = prog.wins || 0;
  c.secs = ['park', 'proam'].reduce((a, m) => a + (prog.career_modes?.[m]?.secs || 0), 0);
  return c;
}

const pct = (m, a) => (a > 0 ? m / a : null);
export const fmtPct = v => (v == null ? '—' : (v * 100).toFixed(1) + '%');
export const fmtAvg = (v, gp) => (gp > 0 ? (v / gp).toFixed(1) : '—');

// derived box-score line: per-game averages and shooting splits
export function careerLine(t) {
  const gp = t.gp || 0, g = k => t[k] || 0;
  const fg2a = g('fga') - g('tpa'), fg2m = g('fgm') - g('tpm');
  return {
    gp, wins: t.wins || 0, losses: Math.max(0, gp - (t.wins || 0)),
    ppg: gp ? g('pts') / gp : 0, rpg: gp ? g('reb') / gp : 0, apg: gp ? g('ast') / gp : 0, spg: gp ? g('stl') / gp : 0,
    bpg: gp ? g('blk') / gp : 0, tpg: gp ? g('tov') / gp : 0, orpg: gp ? g('oreb') / gp : 0,
    fga: gp ? g('fga') / gp : 0, tpa: gp ? g('tpa') / gp : 0,
    fg: pct(g('fgm'), g('fga')), tp: pct(g('tpm'), g('tpa')), ft: pct(g('ftm'), g('fta')), fg2: pct(fg2m, fg2a),
    efg: pct(g('fgm') + 0.5 * g('tpm'), g('fga')), ts: g('fga') + g('fta') ? g('pts') / (2 * (g('fga') + 0.44 * g('fta'))) : null,
    min: gp && t.secs ? t.secs / 60 / gp : null,
    totals: t,
  };
}

const clamp01 = x => Math.max(0, Math.min(1, x));
const ratioT = (v, base) => clamp01(0.5 + 0.38 * Math.log2(Math.max(0.15, v) / Math.max(0.15, base)));

// The auto-play profile. Few games → mostly the build's archetype tendencies; the more you play, the more the
// AI follows your numbers.
export function statProfile(char, mode) {
  const m = MODE_BASE[mode] ? mode : 'park';
  let t = careerSplit(char, m);
  if (!t.gp) t = careerSplit(char, 'all');
  const gp = t.gp || 0, base = MODE_BASE[m];
  const buildT = tendenciesFor(char || {});
  const w = gp / (gp + 4);
  const per = k => (gp ? (t[k] || 0) / gp : 0);
  const fga = per('fga'), tpa = per('tpa'), share3 = (t.fga || 0) > 0 ? (t.tpa || 0) / t.fga : buildT.spot * 0.5;
  const fromStats = {
    shoot: ratioT(fga, base.fga),
    spot: clamp01(share3 * 1.6),
    drive: clamp01((1 - share3) * 0.9 * ratioT(fga - tpa, base.fga - base.tpa) * 1.4),
    pass: ratioT(per('ast'), base.ast),
    dribble: clamp01(0.3 + 0.4 * ratioT(per('ast') + per('tov'), base.ast + base.tov)),
    press: ratioT(per('stl'), base.stl),
    crash: ratioT(per('reb'), base.reb),
    help: ratioT(per('blk'), base.blk),
    safe: clamp01(1 - ratioT(per('tov'), base.tov) + 0.25),
  };
  const tend = { ...buildT };
  for (const k in fromStats) tend[k] = buildT[k] * (1 - w) + fromStats[k] * w;
  // shooting targets, shrunk toward the mode average by a few attempts' worth of prior
  const shrink = (m2, a, prior, k) => (m2 + prior * k) / (a + k);
  const fg2a = (t.fga || 0) - (t.tpa || 0), fg2m = (t.fgm || 0) - (t.tpm || 0);
  return {
    gp, w, tend,
    fg2: shrink(fg2m, fg2a, base.fg2, 12), tp: shrink(t.tpm || 0, t.tpa || 0, base.tp, 10), ft: shrink(t.ftm || 0, t.fta || 0, base.ft, 8),
    base,
  };
}
