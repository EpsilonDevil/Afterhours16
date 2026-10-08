// v0.4.5 The Pro Run: the career league. Everything here is pure logic (no rendering), deterministic from the
// career's seed, and runs in node for the tests.
//
// A career: pick a college, play 3 college games, and your performance sets your draft slot (2 rounds x 32 picks).
// The team holding that pick takes you. The Afterhours Pro League has 32 original teams in two conferences of 16,
// 15-man rosters, an 82-game schedule (each team: 2 games against every team in the other conference, 4 against
// five conference rivals and 3 against the other ten), a play-in tournament, four playoff rounds and the Finals.
// Your games can be played (3D, through a server ticket) or simmed; every other game is simmed here.
import { RNG, hashString } from '../core/rng.js';
import { makeBot } from './bots.js';

export const LEAGUE = { name: 'Afterhours Pro League', abbr: 'APL' };
export const SEASON_GAMES = 82;
export const ROSTER = 15;
export const CONFS = ['East', 'West'];
const c = (id, city, name, abbr, c1, c2, logo, conf) => ({ id, city, name, abbr, c1, c2, logo, conf, full: `${city} ${name}` });
export const TEAMS = [
  c('hbv', 'Harborview', 'Gulls', 'HBV', '#1f6f8b', '#f2c14e', 'circle', 'East'),
  c('irv', 'Ironvale', 'Forge', 'IRV', '#2e3135', '#e8590c', 'hex', 'East'),
  c('ksp', 'Kingsport', 'Monarchs', 'KSP', '#5b2a86', '#e8c15a', 'crown', 'East'),
  c('ngh', 'Northgate', 'Huskies', 'NGH', '#22364f', '#c9d6df', 'shield', 'East'),
  c('mph', 'Maple Hollow', 'Lumberjacks', 'MPH', '#8a2b2b', '#f4f1ea', 'diamond', 'East'),
  c('sba', 'Seaboard', 'Admirals', 'SBA', '#0b2545', '#d9d4c8', 'star', 'East'),
  c('rvb', 'Riverbend', 'Otters', 'RVB', '#2f6b4a', '#f2c14e', 'circle', 'East'),
  c('grf', 'Granite Falls', 'Rams', 'GRF', '#5d636b', '#ffd84a', 'shield', 'East'),
  c('btn', 'Brickton', 'Brawlers', 'BTN', '#b5482f', '#1d1f24', 'bolt', 'East'),
  c('lsh', 'Lakeshore', 'Herons', 'LSH', '#0d8a8f', '#f4f1ea', 'diamond', 'East'),
  c('cph', 'Capitol Heights', 'Senators', 'CPH', '#1c3557', '#c8322f', 'star', 'East'),
  c('stp', 'Steelport', 'Smokestacks', 'STP', '#3a3f47', '#f28c28', 'hex', 'East'),
  c('pnc', 'Pinecrest', 'Owls', 'PNC', '#1f4d2e', '#e8e3d8', 'circle', 'East'),
  c('bay', 'Bayline', 'Barracudas', 'BAY', '#00577d', '#ff8a2a', 'bolt', 'East'),
  c('crp', 'Crown Point', 'Royals', 'CRP', '#3d1f6f', '#e8c15a', 'crown', 'East'),
  c('ewk', 'Eastwick', 'Comets', 'EWK', '#0a1a3a', '#ff4f3d', 'star', 'East'),
  c('svs', 'Sunvale', 'Scorchers', 'SVS', '#e8590c', '#2a1a4a', 'bolt', 'West'),
  c('dwd', 'Dust Wells', 'Devils', 'DWD', '#c8962f', '#3b2e1c', 'diamond', 'West'),
  c('rwe', 'Redwood', 'Elk', 'RWE', '#7a2e1f', '#d9c7a0', 'shield', 'West'),
  c('gcp', 'Gold Coast', 'Prospectors', 'GCP', '#c8961d', '#1d2024', 'crown', 'West'),
  c('mvr', 'Mesa Verde', 'Rattlers', 'MVR', '#8d6e3f', '#2f4f45', 'hex', 'West'),
  c('cas', 'Cascade Peaks', 'Climbers', 'CAS', '#2457c5', '#f4f1ea', 'shield', 'West'),
  c('pcs', 'Pacific Crest', 'Surf', 'PCS', '#0d8a8f', '#ffd84a', 'circle', 'West'),
  c('sbm', 'Silver Basin', 'Miners', 'SBM', '#8d98a6', '#1d2024', 'hex', 'West'),
  c('hps', 'High Plains', 'Stampede', 'HPS', '#7f1d1d', '#f2c14e', 'star', 'West'),
  c('ccc', 'Canyon City', 'Condors', 'CCC', '#e05a2f', '#2a2c31', 'diamond', 'West'),
  c('prb', 'Prairie', 'Bandits', 'PRB', '#1d3557', '#e63946', 'bolt', 'West'),
  c('nvv', 'Neon Valley', 'Voltage', 'NVV', '#7a2bd1', '#39ff88', 'bolt', 'West'),
  c('trr', 'Twin Rivers', 'Rapids', 'TRR', '#2f6b8a', '#e8e3d8', 'circle', 'West'),
  c('mtm', 'Monterra', 'Matadors', 'MTM', '#b8322f', '#f4d58d', 'crown', 'West'),
  c('sws', 'Saltwater', 'Sharks', 'SWS', '#3b5873', '#e8e3d8', 'shield', 'West'),
  c('hlf', 'Highland', 'Falcons', 'HLF', '#2b2f36', '#c8322f', 'star', 'West'),
];
const u = (id, school, name, abbr, c1, c2, logo) => ({ id, school, name, abbr, c1, c2, logo, full: `${school} ${name}` });
export const COLLEGES = [
  u('csu', 'Calder State', 'Cougars', 'CSU', '#8a1c2b', '#f4f1ea', 'shield'),
  u('nrt', 'North Ridge Tech', 'Engineers', 'NRT', '#1d3557', '#f2c14e', 'hex'),
  u('bfu', 'Bayfield', 'Mariners', 'BFU', '#0d6e8a', '#e8e3d8', 'circle'),
  u('saf', 'St. Albion', 'Friars', 'SAF', '#2f2f6b', '#c9cdd2', 'crown'),
  u('pam', 'Pinewood A&M', 'Aggies', 'PAM', '#4a2c1a', '#f4f1ea', 'diamond'),
  u('lkm', 'Lakemont', 'Loons', 'LKM', '#1f6f5c', '#f4f1ea', 'circle'),
  u('sfw', 'Southfield', 'Wasps', 'SFW', '#f2c14e', '#1d2024', 'bolt'),
  u('gmb', 'Grand Mesa', 'Broncos', 'GMB', '#e05a2f', '#1d3557', 'star'),
  u('eps', 'Eastport', 'Seawolves', 'EPS', '#3b5873', '#c8d6df', 'shield'),
  u('htr', 'Hollis Tech', 'Ravens', 'HTR', '#2a2c31', '#b14dff', 'hex'),
  u('krb', 'Kettle River', 'Bears', 'KRB', '#5b3a1e', '#e8c15a', 'crown'),
  u('vsv', 'Valleyview State', 'Vipers', 'VSV', '#2f8f4a', '#1d2024', 'bolt'),
];

// sim customization (the Pro Run's "sim settings")
export const QUARTERS = [[180, '3 min'], [300, '5 min'], [480, '8 min'], [720, '12 min']];
export const DIFFS = [[0.35, 'Rookie'], [0.6, 'Pro'], [0.8, 'All-Star'], [0.95, 'Hall of Fame']];
export const PLAYOFF_FORMATS = { '7777': [7, 7, 7, 7], '5777': [5, 7, 7, 7], '3577': [3, 5, 7, 7], '1111': [1, 1, 1, 1] };
export const MINUTES = { auto: null, starter: 34, sixth: 26, bench: 16 };
export const UPSETS = { fewer: 8, normal: 11, more: 14 };
export const DEFAULT_SETTINGS = { quarterLen: 300, difficulty: 0.6, minutes: 'auto', playoffs: '7777', playIn: true, upsets: 'normal', homeCourt: true };

const FIRST = ['Aaron', 'Adrian', 'Alonzo', 'Amari', 'Andre', 'Ari', 'Bennett', 'Blake', 'Brandon', 'Bryce', 'Caleb', 'Calvin', 'Cameron', 'Carter', 'Cedric', 'Colin', 'Corey', 'Damon', 'Dante', 'Darius', 'Dashawn', 'Desmond', 'Devin', 'Dion', 'Dorian', 'Elijah', 'Emmett', 'Evan', 'Felix', 'Gavin', 'Grant', 'Hassan', 'Isaiah', 'Ivan', 'Jabari', 'Jace', 'Jalen', 'Jamal', 'Jaylen', 'Jerome', 'Joel', 'Jordan', 'Josiah', 'Julian', 'Kai', 'Kareem', 'Keon', 'Khalil', 'Lamar', 'Landon', 'Lance', 'Luca', 'Malik', 'Marcus', 'Mason', 'Mateo', 'Micah', 'Miles', 'Nico', 'Noah', 'Omar', 'Owen', 'Quentin', 'Rashad', 'Reggie', 'Rico', 'Roman', 'Rory', 'Samir', 'Silas', 'Terrence', 'Theo', 'Trey', 'Tyson', 'Victor', 'Wade', 'Xavier', 'Yusuf', 'Zach', 'Zion'];
const LAST = ['Abbott', 'Alvarez', 'Archer', 'Bishop', 'Blackwell', 'Booker', 'Bowman', 'Bradford', 'Calloway', 'Carver', 'Chandler', 'Coleman', 'Crawford', 'Dalton', 'Dawson', 'Delaney', 'Easton', 'Ellington', 'Fairbanks', 'Fletcher', 'Garrison', 'Goodwin', 'Graves', 'Hampton', 'Harlan', 'Hendrix', 'Hollins', 'Hudson', 'Ingram', 'Jennings', 'Kendall', 'Langston', 'Lawson', 'Lockhart', 'Maddox', 'Marlowe', 'McCall', 'Mercer', 'Norwood', 'Oakley', 'Odom', 'Pace', 'Palmer', 'Pierce', 'Quinlan', 'Ramsey', 'Redding', 'Rollins', 'Sampson', 'Sawyer', 'Sinclair', 'Sterling', 'Stokes', 'Sutton', 'Talbot', 'Thornton', 'Townsend', 'Underwood', 'Vance', 'Walker', 'Whitfield', 'Winslow', 'York', 'Young'];
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const rngFor = (career, ...salt) => new RNG(hashString(salt.join('|')) ^ (career.seed >>> 0));
export const teamIdx = id => TEAMS.findIndex(t => t.id === id);

// ---------- players ----------
function uniqueName(rng, used) {
  for (let i = 0; i < 50; i++) { const n = `${rng.pick(FIRST)} ${rng.pick(LAST)}`; if (!used.has(n)) { used.add(n); return n; } }
  const n = `${rng.pick(FIRST)} ${rng.pick(LAST)} ${used.size}`; used.add(n); return n;
}
// one league player: the build is regenerated from the seed whenever he's needed in a 3D game
export function genPlayer(rng, id, pos, level, used, extra = {}) {
  const seed = rng.int(1, 2147483646), name = uniqueName(rng, used);
  const bot = makeBot(new RNG(seed), { position: pos, level, name });
  return { id, n: name, p: pos, o: bot.build.overall, s: seed, l: Math.round(level * 1000) / 1000, ...extra };
}
// the 3D-game entry for a league player (same attributes every time; gear from the catalog)
export function playerEntry(pl, catalog) {
  const bot = makeBot(new RNG(pl.s), { position: pl.p, level: pl.l, name: pl.n, catalog, rep: 12, flash: pl.l * 0.5 });
  return { ...bot, leagueId: pl.id };
}

// ---------- a new career ----------
// 32 teams x 13 veterans before the draft (two rookies each come with the draft)
export function newCareer({ seed, college, settings = {}, me }) {
  const career = { v: 1, seed: seed >>> 0, year: 1, phase: 'college', created: Date.now(), settings: { ...DEFAULT_SETTINGS, ...settings }, me: { name: me?.name || 'You', pos: me?.position || 'SF', ovr: me?.overall || 60 } };
  const rng = rngFor(career, 'league');
  const used = new Set();
  career.players = [];
  career.teamLevel = TEAMS.map(() => Math.round(rng.range(0.6, 0.84) * 1000) / 1000);
  TEAMS.forEach((t, ti) => {
    const order = rng.shuffle([...POS, ...POS, ...POS]).slice(0, 13);
    order.forEach((pos, i) => {
      const lvl = clamp(career.teamLevel[ti] + 0.16 - i * 0.025 + rng.range(-0.05, 0.05), 0.3, 1);
      career.players.push(genPlayer(rng, `p${career.players.length}`, pos, lvl, used, { t: ti, age: rng.int(21, 34) }));
    });
  });
  // college: your school and its 3-game slate
  const col = COLLEGES.find(x => x.id === college) || COLLEGES[0];
  const opps = rngFor(career, 'college').shuffle(COLLEGES.filter(x => x.id !== col.id)).slice(0, 3);
  career.college = { team: col.id, games: opps.map((o, i) => ({ opp: o.id, home: i !== 1, result: null })) };
  return career;
}
export const collegeOf = id => COLLEGES.find(x => x.id === id);
// college rosters for the 3D games: your four teammates and the opponent's five (college level, ~60-74 OVR)
export function collegeRoster(career, collegeId, n = 5, skip = null) {
  const rng = rngFor(career, 'colroster', collegeId), used = new Set();
  const pos = POS.filter(p => p !== skip).slice(0, n);
  const lvl = 0.3 + (hashString(collegeId) % 100) / 100 * 0.18;
  return pos.map((p, i) => genPlayer(rng, `${collegeId}-${i}`, p, clamp(lvl + rng.range(-0.06, 0.1), 0.2, 0.7), used));
}

// ---------- the draft ----------
// Game score (Hollinger), per 48 minutes of game clock, averaged over the college games, plus a bump for each
// win and for the Locked-In grade. Stock 32 or better goes first overall; every point under that is about two
// picks lower, down to the last pick of the second round.
export function gameScore(s) {
  return s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * (s.oreb || 0) + 0.3 * (s.reb - (s.oreb || 0)) + s.stl + 0.7 * s.ast + 0.7 * s.blk - 0.4 * (s.pf || 0) - s.tov;
}
export function draftStock(games) {
  const done = games.filter(g => g.result);
  if (!done.length) return 0;
  let sum = 0;
  for (const g of done) {
    const r = g.result, mins = Math.max(4, (r.quarterLen || 300) * 4 / 60);
    sum += gameScore(r.stats) * 48 / mins + (r.won ? 1.5 : 0) + (r.grade != null ? (r.grade - 5) * 0.6 : 0);
  }
  return Math.round(sum / done.length * 10) / 10;
}
export const pickForStock = stock => clamp(Math.round(1 + (32 - stock) * 2), 1, 64);
export function projectedRange(stock) { const p = pickForStock(stock); return [clamp(p - 4, 1, 64), clamp(p + 4, 1, 64)]; }
// draft order: weakest teams first (a lottery shuffles the top four), the same order in round 2
export function draftOrder(career) {
  const rng = rngFor(career, 'order', career.year);
  const order = TEAMS.map((t, i) => i).sort((a, b) => career.teamLevel[a] - career.teamLevel[b]);
  const top = rng.shuffle(order.slice(0, 6)).slice(0, 4);
  const rest = order.filter(i => !top.includes(i));
  const r1 = [...top, ...rest];
  return [...r1, ...r1];
}
// run the draft: you go at `pick`; every other pick is a generated prospect. Rosters grow from 13 to 15.
export function runDraft(career, pick) {
  const order = draftOrder(career), rng = rngFor(career, 'prospects', career.year);
  const used = new Set(career.players.map(p => p.n));
  const board = [];
  for (let i = 0; i < 64; i++) {
    const t = order[i];
    if (i + 1 === pick) { board.push({ pick: i + 1, t, id: 'me' }); continue; }
    const lvl = clamp(0.62 - i * 0.0055 + rng.range(-0.08, 0.08), 0.3, 0.85);
    const pl = genPlayer(rng, `r${career.year}-${i}`, rng.pick(POS), lvl, used, { t, age: rng.int(19, 22), rookie: career.year, pick: i + 1 });
    career.players.push(pl);
    board.push({ pick: i + 1, t, id: pl.id });
  }
  career.myTeam = order[pick - 1];
  career.draft = { pick, round: pick > 32 ? 2 : 1, team: career.myTeam, board, stock: draftStock(career.college.games) };
  career.phase = 'draft';
  return career.draft;
}

// ---------- schedule ----------
// Each team: 2 vs each of the 16 other-conference teams (one home), 4 vs five conference rivals (two home),
// 3 vs the other ten (five with two home games, five with one) = 82 games, 41 at home.
export function makeSchedule(career) {
  const rng = rngFor(career, 'sched', career.year);
  const pairs = [];
  const conf = CONFS.map(cf => rng.shuffle(TEAMS.map((t, i) => i).filter(i => TEAMS[i].conf === cf)));
  for (const list of conf) {
    for (let a = 0; a < 16; a++) for (let d = 1; d < 16; d++) {
      const b = (a + d) % 16;
      if (d > 8 || (d === 8 && a >= 8)) continue; // each pair once, from the lower offset
      const A = list[a], B = list[b];
      if (d <= 2 || d === 8) { pairs.push([A, B], [A, B], [B, A], [B, A]); continue; } // 4 games: i±1, i±2, i+8
      pairs.push([A, B], [A, B], [B, A]); // offsets 3..7: A hosts two
    }
  }
  for (const a of conf[0]) for (const b of conf[1]) pairs.push([a, b], [b, a]);
  rng.shuffle(pairs);
  // days: nobody plays twice in a day or three days running; busier teams go first
  const left = new Array(32).fill(SEASON_GAMES), last = new Array(32).fill(-9), last2 = new Array(32).fill(-9);
  const sched = [];
  let pool = pairs, day = 0;
  while (pool.length && day < 400) {
    const busy = new Set(), next = [];
    pool.sort((x, y) => (left[y[0]] + left[y[1]]) - (left[x[0]] + left[x[1]]));
    let n = 0;
    for (const g of pool) {
      const [h, a] = g;
      const tired = t => last[t] === day - 1 && last2[t] === day - 2;
      if (n < 13 && !busy.has(h) && !busy.has(a) && !tired(h) && !tired(a) && rng.next() < 0.82) {
        busy.add(h); busy.add(a); sched.push([day, h, a]); n++;
        for (const t of [h, a]) { last2[t] = last[t]; last[t] = day; left[t]--; }
      } else next.push(g);
    }
    pool = next; day++;
  }
  sched.sort((x, y) => x[0] - y[0]);
  return sched;
}

export function startSeason(career) {
  career.sched = makeSchedule(career);
  career.res = career.sched.map(() => 0);
  career.stats = {}; career.pstats = {};
  career.log = [];
  career.phase = 'season';
  career.po = null; career.awards = null;
  return career;
}

// ---------- ratings ----------
export function roster(career, t) {
  const out = career.players.filter(p => p.t === t);
  if (career.myTeam === t) out.push({ id: 'me', n: career.me.name, p: career.me.pos, o: career.me.ovr, me: true });
  return out.sort((a, b) => b.o - a.o);
}
const ROT = [36, 34, 32, 30, 28, 22, 20, 16, 12, 10];
export function rotation(career, t) {
  const r = roster(career, t);
  const mins = r.map((p, i) => ROT[i] || 0);
  const mi = r.findIndex(p => p.me);
  // auto: your spot in the rotation by overall, but never less than 14 minutes
  let want = MINUTES[career.settings.minutes];
  if (mi >= 0 && want == null && mins[mi] < 14) want = 14;
  if (mi >= 0 && want != null) {
    // your minutes setting: take them from (or give them to) the rest of the rotation
    const diff = want - mins[mi];
    mins[mi] = want;
    const others = mins.map((m, i) => (i !== mi && m > 0 ? i : -1)).filter(i => i >= 0);
    let tot = others.reduce((s, i) => s + mins[i], 0);
    for (const i of others) mins[i] = Math.max(0, mins[i] - diff * mins[i] / tot);
    tot = mins.reduce((s, m) => s + m, 0);
    for (let i = 0; i < mins.length; i++) mins[i] *= 240 / tot;
  }
  return r.map((p, i) => ({ p, min: mins[i] }));
}
export function teamRating(career, t) {
  const rot = rotation(career, t);
  let s = 0, w = 0;
  for (const { p, min } of rot) { s += p.o * min; w += min; }
  return w ? s / w : 70;
}

// ---------- simulated games ----------
const STAT = ['gp', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];
export const STAT_KEYS = STAT;
function addLine(book, id, line) {
  const row = book[id] || (book[id] = new Array(STAT.length).fill(0));
  STAT.forEach((k, i) => { row[i] += line[k] || 0; });
}
const POS_K = {
  PG: { reb: 0.7, ast: 3.2, stl: 1.4, blk: 0.3, three: 0.42 }, SG: { reb: 0.8, ast: 1.5, stl: 1.3, blk: 0.4, three: 0.45 },
  SF: { reb: 1.2, ast: 1.1, stl: 1.1, blk: 0.7, three: 0.33 }, PF: { reb: 2.0, ast: 0.8, stl: 0.8, blk: 1.4, three: 0.18 },
  C: { reb: 2.6, ast: 0.7, stl: 0.6, blk: 2.2, three: 0.06 },
};
// split a team total among the rotation by weight, with noise
function spread(rng, total, weights) {
  const tot = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map(w => Math.max(0, total * w / tot * (0.6 + rng.next() * 0.8)));
  const sum = raw.reduce((s, x) => s + x, 0) || 1;
  const exact = raw.map(x => x * total / sum), out = exact.map(Math.floor);
  // largest remainders get the leftover units
  let rest = total - out.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => [x - Math.floor(x) + rng.next() * 0.3, i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length) { out[order[k][1]]++; rest--; }
  return out;
}
function boxScore(rng, career, t, pts) {
  const rot = rotation(career, t).filter(r => r.min > 0.5);
  // usage: minutes x talent (stars take the big shares); the game feeds you a little extra
  const usage = rot.map(({ p, min }) => min * Math.pow(Math.max(2, p.o - 45), 2.2) * (p.me ? 3 : 1));
  const share = spread(rng, pts, usage);
  const k = rot.map(({ p }) => POS_K[p.p] || POS_K.SF);
  const reb = spread(rng, Math.round(42 + rng.range(-5, 5)), rot.map((r, i) => r.min * k[i].reb));
  const ast = spread(rng, Math.round(pts * 0.22 + rng.range(-3, 3)), rot.map((r, i) => r.min * k[i].ast * (r.p.o / 80)));
  const stl = spread(rng, rng.int(5, 10), rot.map((r, i) => r.min * k[i].stl));
  const blk = spread(rng, rng.int(3, 7), rot.map((r, i) => r.min * k[i].blk));
  const tov = spread(rng, rng.int(10, 16), rot.map((r, i) => r.min * (k[i].ast * 0.5 + 0.6)));
  return rot.map(({ p, min }, i) => {
    let ftm = Math.min(share[i], Math.round(share[i] * rng.range(0.1, 0.24)));
    let rest = share[i] - ftm;
    const tpm = Math.max(0, Math.floor(rest * k[i].three * rng.range(0.6, 1.3) / 3));
    if ((rest - 3 * tpm) % 2) { ftm++; rest--; } // an odd point is a free throw
    const fgm2 = (rest - 3 * tpm) / 2;
    const fgm = fgm2 + tpm;
    const line = { gp: 1, min: Math.round(min), pts: 2 * fgm2 + 3 * tpm + ftm, reb: reb[i], ast: ast[i], stl: stl[i], blk: blk[i], tov: tov[i], fgm, tpm, ftm };
    // shooting: better players are more efficient (about 41% at 65 OVR to 52% at 90 from the field)
    const fgp = clamp(0.41 + (p.o - 65) * 0.0045 + rng.range(-0.06, 0.06), 0.3, 0.68), tpp = clamp(0.33 + (p.o - 70) * 0.002 + rng.range(-0.08, 0.08), 0.2, 0.5);
    line.tpa = tpm + Math.round(tpm * (1 / tpp - 1)) + (k[i].three > 0.3 && share[i] > 0 && rng.next() < 0.4 ? 1 : 0);
    line.fga = Math.max(line.tpa + fgm2, fgm + Math.round(fgm * (1 / fgp - 1)));
    line.fta = ftm + Math.round(ftm * rng.range(0.1, 0.4));
    return { id: p.id, line };
  });
}
// one game between teams h (home) and a: the final score and every player's line
export function simScore(career, h, a, rng) {
  const st = career.settings, sd = UPSETS[st.upsets] || 11;
  const diff = teamRating(career, h) - teamRating(career, a) + (st.homeCourt ? 1.4 : 0);
  let hs = Math.round(111 + diff * 0.65 + rng.normal() * sd), as = Math.round(111 - diff * 0.65 + rng.normal() * sd);
  hs = clamp(hs, 72, 158); as = clamp(as, 72, 158);
  while (hs === as) { hs += rng.int(4, 14); as += rng.int(4, 14); }
  return [hs, as];
}
export function simGame(career, gi, book = career.stats, games = career.sched, res = career.res) {
  const [, h, a] = games[gi];
  const rng = rngFor(career, 'g', career.year, book === career.stats ? 'rs' : 'po', gi);
  const [hs, as] = simScore(career, h, a, rng);
  const lines = [...boxScore(rng, career, h, hs), ...boxScore(rng, career, a, as)];
  for (const { id, line } of lines) addLine(book, id, line);
  res[gi] = [hs, as, 0];
  if (h === career.myTeam || a === career.myTeam) {
    const me = lines.find(l => l.id === 'me');
    logMine(career, gi, games, [hs, as], me ? me.line : null, false, book !== career.stats);
  }
  return res[gi];
}
function logMine(career, gi, games, score, line, played, playoffs) {
  const [day, h, a] = games[gi], home = h === career.myTeam;
  const us = home ? score[0] : score[1], them = home ? score[1] : score[0];
  career.log.push({ gi, day, po: playoffs ? 1 : 0, opp: home ? a : h, home: home ? 1 : 0, us, them, w: us > them ? 1 : 0, played: played ? 1 : 0, line: line ? STAT.map(k => line[k] || 0) : null });
}
// a game you played: the score and the ten players on the floor, from the 3D game's summary
export function recordPlayed(career, gi, summary, ids, playoffs = false) {
  const games = playoffs ? career.po.games : career.sched, res = playoffs ? career.po.res : career.res, book = playoffs ? career.pstats : career.stats;
  const [, h] = games[gi];
  const myHome = h === career.myTeam, mine = summary.score[0], theirs = summary.score[1];
  res[gi] = myHome ? [mine, theirs, 1] : [theirs, mine, 1];
  const mins = Math.round((summary.quarterLen || career.settings.quarterLen) * 4 / 60);
  let myLine = null;
  summary.players.forEach((p, i) => {
    const id = ids[i]; if (!id) return;
    const s = p.stats, line = { gp: 1, min: mins, pts: s.pts, reb: s.reb, ast: s.ast, stl: s.stl, blk: s.blk, tov: s.tov, fgm: s.fgm, fga: s.fga, tpm: s.tpm, tpa: s.tpa, ftm: s.ftm, fta: s.fta };
    addLine(book, id, line);
    if (id === 'me') myLine = line;
  });
  logMine(career, gi, games, res[gi], myLine, true, playoffs);
  return res[gi];
}

// ---------- the regular season ----------
export const myGames = career => career.sched.map((g, i) => i).filter(i => career.sched[i][1] === career.myTeam || career.sched[i][2] === career.myTeam);
export function nextMyGame(career) { for (const i of myGames(career)) if (!career.res[i]) return i; return -1; }
export const seasonDone = career => career.res.every(Boolean);
// sim everything before game `gi` (and the other games that day), leaving gi itself
export function simBefore(career, gi) {
  const day = career.sched[gi][0];
  career.sched.forEach((g, i) => { if (i !== gi && !career.res[i] && g[0] <= day && g[1] !== career.myTeam && g[2] !== career.myTeam) simGame(career, i); });
  career.sched.forEach((g, i) => { if (i !== gi && !career.res[i] && g[0] < day) simGame(career, i); });
}
// sim every game (yours included) up to and including `day`
export function simThrough(career, day) {
  let n = 0;
  career.sched.forEach((g, i) => { if (!career.res[i] && g[0] <= day) { simGame(career, i); n++; } });
  return n;
}
export const currentDay = career => { const i = career.res.findIndex(r => !r); return i < 0 ? career.sched[career.sched.length - 1][0] + 1 : career.sched[i][0]; };

export function records(career, games = career.sched, res = career.res) {
  const rec = TEAMS.map(() => ({ w: 0, l: 0, cw: 0, cl: 0, hw: 0, hl: 0, pf: 0, pa: 0, last: [] }));
  games.forEach(([, h, a], i) => {
    const r = res[i]; if (!r) return;
    const hw = r[0] > r[1], same = TEAMS[h].conf === TEAMS[a].conf;
    const H = rec[h], A = rec[a];
    H.pf += r[0]; H.pa += r[1]; A.pf += r[1]; A.pa += r[0];
    if (hw) { H.w++; A.l++; H.hw++; } else { A.w++; H.l++; H.hl++; }
    if (same) { if (hw) { H.cw++; A.cl++; } else { A.cw++; H.cl++; } }
    H.last.push(hw ? 1 : 0); A.last.push(hw ? 0 : 1);
  });
  return rec;
}
export function standings(career) {
  const rec = records(career);
  const pct = r => (r.w + r.l ? r.w / (r.w + r.l) : 0);
  const out = {};
  for (const cf of CONFS) {
    const list = TEAMS.map((t, i) => i).filter(i => TEAMS[i].conf === cf)
      .sort((a, b) => pct(rec[b]) - pct(rec[a]) || (rec[b].cw - rec[b].cl) - (rec[a].cw - rec[a].cl) || (rec[b].pf - rec[b].pa) - (rec[a].pf - rec[a].pa) || a - b);
    const lead = rec[list[0]];
    out[cf] = list.map((t, k) => {
      const r = rec[t], gb = ((lead.w - r.w) + (r.l - lead.l)) / 2;
      let streak = 0; const L = r.last; for (let j = L.length - 1; j >= 0 && L[j] === L[L.length - 1]; j--) streak++;
      return { t, seed: k + 1, ...r, pct: pct(r), gb, streak: L.length ? `${L[L.length - 1] ? 'W' : 'L'}${streak}` : '—', l10: L.slice(-10).reduce((s, x) => s + x, 0) };
    });
  }
  return out;
}

// ---------- playoffs ----------
// seeds 1-6 go straight in; 7-10 play in (7v8: the winner is the 7 seed; the loser hosts the 9v10 winner for the
// 8 seed). Then 1v8, 4v5, 3v6, 2v7 in each conference, conference semis and finals, and the Finals.
export function startPlayoffs(career) {
  const st = standings(career), fmt = PLAYOFF_FORMATS[career.settings.playoffs] || PLAYOFF_FORMATS['7777'];
  const po = { fmt, round: career.settings.playIn ? 0 : 1, games: [], res: [], series: [], seeds: {}, champ: null, day: 0 };
  for (const cf of CONFS) po.seeds[cf] = st[cf].map(r => r.t);
  career.po = po; career.phase = 'playoffs';
  if (po.round === 0) {
    for (const cf of CONFS) {
      const s = po.seeds[cf];
      po.series.push(newSeries(po, 0, cf, s[6], s[7], 1, 'A'), newSeries(po, 0, cf, s[8], s[9], 1, 'B'));
    }
  } else openRound(career, 1);
  return po;
}
function newSeries(po, round, conf, hi, lo, bestOf, tag = '') { return { round, conf, hi, lo, bestOf, w: [0, 0], games: [], tag, winner: null }; }
function openRound(career, round) {
  const po = career.po;
  po.round = round;
  if (round === 1) {
    for (const cf of CONFS) {
      const s = po.seeds[cf];
      for (const [a, b] of [[0, 7], [3, 4], [2, 5], [1, 6]]) po.series.push(newSeries(po, 1, cf, s[a], s[b], po.fmt[0]));
    }
  } else if (round <= 3) {
    for (const cf of CONFS) {
      const prev = po.series.filter(x => x.round === round - 1 && x.conf === cf);
      for (let i = 0; i < prev.length; i += 2) {
        const [x, y] = [prev[i].winner, prev[i + 1].winner];
        const sx = po.seeds[cf].indexOf(x), sy = po.seeds[cf].indexOf(y);
        po.series.push(newSeries(po, round, cf, sx <= sy ? x : y, sx <= sy ? y : x, po.fmt[round - 1]));
      }
    }
  } else {
    const [e, w] = CONFS.map(cf => po.series.find(x => x.round === 3 && x.conf === cf).winner);
    const rec = records(career), pct = t => rec[t].w / Math.max(1, rec[t].w + rec[t].l);
    po.series.push(newSeries(po, 4, 'Finals', pct(e) >= pct(w) ? e : w, pct(e) >= pct(w) ? w : e, po.fmt[3]));
  }
}
const need = s => Math.ceil(s.bestOf / 2);
export const activeSeries = career => (career.po ? career.po.series.filter(s => !s.winner && s.round === career.po.round) : []);
// the next game of a series (2-2-1-1-1 home pattern: the higher seed hosts games 1, 2, 5 and 7)
function scheduleGame(career, s) {
  const po = career.po, g = s.w[0] + s.w[1];
  const hiHome = s.bestOf === 1 || [0, 1, 4, 6].includes(g) || (s.bestOf === 3 && g === 2) || (s.bestOf === 5 && g === 4);
  const gi = po.games.length;
  po.games.push([po.day, hiHome ? s.hi : s.lo, hiHome ? s.lo : s.hi]);
  po.res.push(0);
  s.games.push(gi);
  return gi;
}
// the game you play next in the playoffs: the other series play their game for the day first
export function prepareMyPlayoffGame(career) {
  const s = mySeries(career);
  if (!s) return -1;
  const open = s.games.find(gi => !career.po.res[gi]);
  if (open != null) return open;
  simPlayoffDay(career, false);
  return mySeries(career) ? scheduleGame(career, mySeries(career)) : -1;
}
export function mySeries(career) { return activeSeries(career).find(s => s.hi === career.myTeam || s.lo === career.myTeam) || null; }
// the playoff game you'd play next (scheduling it if needed), or -1
export function nextMyPlayoffGame(career) {
  const s = mySeries(career);
  if (!s) return -1;
  const open = s.games.find(gi => !career.po.res[gi]);
  return open != null ? open : scheduleGame(career, s);
}
function finishGame(career, s, gi) {
  const r = career.po.res[gi], [, h] = career.po.games[gi];
  const hiWon = (r[0] > r[1]) === (h === s.hi);
  s.w[hiWon ? 0 : 1]++;
  if (s.w[0] >= need(s)) s.winner = s.hi; else if (s.w[1] >= need(s)) s.winner = s.lo;
}
// results of a game you played or simmed in the playoffs count toward the series
export function afterPlayoffGame(career, gi) {
  const s = career.po.series.find(x => x.games.includes(gi));
  if (s && !s.winner) finishGame(career, s, gi);
  advance(career);
}
// one playoff "day": every active series except yours plays a game (yours only if includeMine)
export function simPlayoffDay(career, includeMine = false) {
  const po = career.po;
  if (!po || po.champ != null) return false;
  for (const s of activeSeries(career)) {
    const mine = s.hi === career.myTeam || s.lo === career.myTeam;
    if (mine && !includeMine) continue;
    const gi = s.games.find(g => !po.res[g]) ?? scheduleGame(career, s);
    simGame(career, gi, career.pstats, po.games, po.res);
    finishGame(career, s, gi);
  }
  po.day++;
  advance(career);
  return true;
}
function advance(career) {
  const po = career.po;
  if (activeSeries(career).length) return;
  if (po.round === 0) {
    // play-in second games: loser of 7v8 hosts the winner of 9v10
    const pending = CONFS.filter(cf => !po.series.some(x => x.round === 0 && x.tag === 'C' && x.conf === cf));
    if (pending.length) {
      for (const cf of pending) {
        const A = po.series.find(x => x.round === 0 && x.conf === cf && x.tag === 'A'), B = po.series.find(x => x.round === 0 && x.conf === cf && x.tag === 'B');
        po.series.push(newSeries(po, 0, cf, A.winner === A.hi ? A.lo : A.hi, B.winner, 1, 'C'));
      }
      return;
    }
    for (const cf of CONFS) {
      const A = po.series.find(x => x.round === 0 && x.conf === cf && x.tag === 'A'), C = po.series.find(x => x.round === 0 && x.conf === cf && x.tag === 'C');
      const s = po.seeds[cf];
      po.seeds[cf] = [...s.slice(0, 6), A.winner, C.winner, ...s.slice(6).filter(t => t !== A.winner && t !== C.winner)];
    }
    openRound(career, 1);
    return;
  }
  if (po.round < 4) { openRound(career, po.round + 1); return; }
  po.champ = po.series.find(x => x.round === 4).winner;
  career.phase = 'offseason';
  career.awards = seasonAwards(career);
}
export function myPlayoffStatus(career) {
  const po = career.po; if (!po) return null;
  const mine = po.series.filter(s => s.hi === career.myTeam || s.lo === career.myTeam);
  const inPO = po.seeds && CONFS.some(cf => po.seeds[cf].slice(0, career.settings.playIn ? 10 : 8).includes(career.myTeam));
  if (!inPO) return { out: true, text: 'Missed the playoffs' };
  const last = mine[mine.length - 1];
  if (!last) return { alive: true, text: `In as the ${CONFS.map(cf => po.seeds[cf].indexOf(career.myTeam) + 1).find(n => n > 0)} seed · your first-round series starts after the play-in` };
  if (!last.winner) return { alive: true, series: last };
  if (last.round === 0 && last.tag === 'A' && last.winner !== career.myTeam && !po.series.some(x => x.tag === 'C' && x.conf === last.conf)) return { alive: true, text: 'One more play-in game', series: last };
  if (last.winner === career.myTeam) return last.round === 4 ? { champ: true, text: 'Champions!' } : { alive: true, series: last };
  return { out: true, text: last.round === 0 ? 'Out in the play-in' : ['', 'Out in the first round', 'Out in the conference semifinals', 'Out in the conference finals', 'Lost in the Finals'][last.round], series: last };
}
export const ROUND_NAMES = ['Play-in', 'First round', 'Conference semifinals', 'Conference finals', 'The Finals'];

// ---------- season leaders and awards ----------
export function perGame(book, id) {
  const r = book[id]; if (!r || !r[0]) return null;
  const o = {}; STAT.forEach((k, i) => { o[k] = r[i]; });
  const g = r[0];
  return { ...o, ppg: o.pts / g, rpg: o.reb / g, apg: o.ast / g, spg: o.stl / g, bpg: o.blk / g, mpg: o.min / g, fgp: o.fga ? o.fgm / o.fga : 0, tpp: o.tpa ? o.tpm / o.tpa : 0, ftp: o.fta ? o.ftm / o.fta : 0 };
}
export function playerById(career, id) { return id === 'me' ? { id: 'me', n: career.me.name, p: career.me.pos, o: career.me.ovr, t: career.myTeam, me: true, rookie: career.year === 1 ? 1 : 0 } : career.players.find(p => p.id === id); }
export function leaders(career, key = 'ppg', n = 10, book = career.stats) {
  const minG = Math.max(1, Math.floor(Math.max(...Object.values(book).map(r => r[0]), 1) * 0.5));
  return Object.keys(book).map(id => ({ id, s: perGame(book, id) })).filter(x => x.s && x.s.gp >= minG).sort((a, b) => b.s[key] - a.s[key]).slice(0, n);
}
export function seasonAwards(career) {
  const rec = records(career), pct = t => rec[t].w / Math.max(1, rec[t].w + rec[t].l);
  const score = (id, s) => s.ppg + 1.2 * s.rpg + 1.5 * s.apg + 2 * (s.spg + s.bpg) + 18 * pct(playerById(career, id)?.t ?? 0);
  const minG = 41;
  const pool = Object.keys(career.stats).map(id => ({ id, s: perGame(career.stats, id), p: playerById(career, id) })).filter(x => x.s && x.p && x.s.gp >= Math.min(minG, Math.max(...Object.values(career.stats).map(r => r[0])) * 0.5));
  const best = (f, filter = () => true) => pool.filter(filter).sort((a, b) => f(b) - f(a))[0]?.id || null;
  const out = {
    mvp: best(x => score(x.id, x.s)),
    roy: best(x => score(x.id, x.s), x => x.p.rookie === career.year || x.id === 'me' && career.year === 1),
    dpoy: best(x => x.s.spg * 2 + x.s.bpg * 2.2 + x.s.rpg * 0.35),
    scoring: best(x => x.s.ppg),
    champ: career.po?.champ ?? null,
  };
  if (career.po?.champ != null) {
    // Finals MVP: the champion's best performer over the playoffs
    const ids = Object.keys(career.pstats).filter(id => playerById(career, id)?.t === career.po.champ);
    out.fmvp = ids.map(id => ({ id, s: perGame(career.pstats, id) })).sort((a, b) => score(b.id, b.s) - score(a.id, a.s))[0]?.id || null;
  }
  return out;
}

// the next season: same teams and players (a year older), new schedule, records cleared
export function nextSeason(career) {
  career.history = career.history || [];
  const st = standings(career), me = perGame(career.stats, 'me'), ps = myPlayoffStatus(career);
  const conf = TEAMS[career.myTeam].conf, row = st[conf].find(r => r.t === career.myTeam);
  career.history.push({ year: career.year, team: career.myTeam, w: row.w, l: row.l, seed: row.seed, po: ps?.text || '', champ: career.po?.champ ?? null, me: me ? STAT.map(k => me[k]) : null, awards: career.awards });
  career.year++;
  for (const p of career.players) p.age = (p.age || 24) + 1;
  // the league moves on: team strength drifts a little
  const rng = rngFor(career, 'drift', career.year);
  career.teamLevel = career.teamLevel.map(l => Math.round(clamp(l + rng.range(-0.04, 0.04), 0.58, 0.86) * 1000) / 1000);
  return startSeason(career);
}

// the 3D game's two lineups: you and the best player at each other position on your team; their best five
export function startingFive(career, t, withMe) {
  const r = roster(career, t).filter(p => withMe ? true : !p.me);
  const out = [];
  if (withMe) out.push(r.find(p => p.me));
  for (const pos of POS) {
    if (out.length >= 5) break;
    if (withMe && pos === career.me.pos) continue;
    const pick = r.find(p => !out.includes(p) && p.p === pos);
    if (pick) out.push(pick);
  }
  for (const p of r) { if (out.length >= 5) break; if (!out.includes(p)) out.push(p); }
  return out.slice(0, 5);
}

// keep a saved career small: drop derived fields
export function pack(career) { return JSON.parse(JSON.stringify(career)); }
