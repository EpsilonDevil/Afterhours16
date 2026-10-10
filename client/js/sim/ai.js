// Basketball AI: spacing, drives, pick-and-roll, cuts, passing reads, man defense with help,
// contests, box-outs, rebounding and transition. Uses the same intent interface as the human.
import { COURT, GRAVITY, isThree } from './constants.js';
import { spotsFor, rimOf, spot } from './formation.js';
import { tendenciesFor } from './bots.js';

const ARC_SPOTS = ['top', 'wingL', 'wingR', 'cornerL', 'cornerR', 'slotL', 'slotR'];
import * as S from './shots.js';
import { cloneBall } from './ball.js';

import { rk as n } from './ratings.js';
import { bk } from './badges.js';
import { MOVE_IDS, MOVES as MOVE_DEF, MOVE_STYLE, COMBOS } from './moves.js';
const MOVE_FAM = Object.fromEntries(Object.entries(MOVE_DEF).map(([k, v]) => [k, v.fam]));
const hyp = Math.hypot;
// v0.4.7.5 qp3: runners in the open court (AI.runnerAhead / passToRunner): how far from the rim a runner still
// counts, how open he has to be, how wide the lane in front of him has to be clear, how fast he must be running at
// the rim (m/s), how close for an alley-oop and with what share of the sprint budget, the chance the handler takes
// the look each read (plus IQ), and the half-court alley-oop chance (was 0.25, AI receivers only)
export const RUNNER = { maxRim: 9.5, open: 2.0, lane: 2.0, recover: 2.5, run: 1.5, oopRim: 6.5, reachK: 0.7, lobRisk: 0.35, lobRiskMax: 0.9, lobOpen: 4.0, chance0: 0.7, chanceIQ: 0.3, setOop: 0.32 };

const d0 = (p, rim) => Math.hypot(rim.x - p.x, rim.z - p.z);
export const AI_SKILL_K = 1.1;
// v0.4.5 quick patch: on top of that, a basketball-IQ bump for every AI hooper that grows with how good he already is
export const AI_IQ_BONUS = [0.04, 0.08];
const aiIQ = x => Math.min(1, x + AI_IQ_BONUS[0] + AI_IQ_BONUS[1] * Math.min(1, x));
// v0.4.5 quick patch: the dribble move to call: the AI mixes them up (a different move right after the last one is a
// free combo) instead of repeating one; the smarter he is, the less he repeats and the more he strings combos.
// Tired, a smart player saves his legs for the shot.
// v0.4.7.5: every move in the game (moves.js), the situation sets what fits (SITU), and every AI hooper has moves of
// his own (moveTend): his archetype's families, his size-up package's signature moves and two personal favourites.
const MOVES = MOVE_IDS;
export const SITU = {
  // a defender squarely in the way of the drive
  block: { cross: 0.5, hang: 0.3, spin: 0.45, halfspin: 0.15, btb: 0.25, wrap: 0.2, inout: 0.25, momentum: 0.12, btl: 0.2, pushcross: 0.18, jab: 0.1 },
  // the lane's shut and he's leaning on you
  shut: { spin: 0.4, cross: 0.4, halfspin: 0.2, btb: 0.2, retreat: 0.25, hang: 0.15, snatch: 0.15, btlback: 0.12 },
  // sizing up: working the man to create something
  probe: { cross: 0.3, hang: 0.15, btb: 0.15, btl: 0.15, inout: 0.15, hesi: 0.12, stutter: 0.1, spin: 0.14, wrap: 0.1, momentum: 0.08, stepback: 0.08, sidestep: 0.06, pushcross: 0.1, jab: 0.1, btlback: 0.06 },
  // too tight to shoot: make space
  escape: { stepback: 0.4, sidestep: 0.3, retreat: 0.25, hang: 0.08, snatch: 0.22, btlback: 0.16 },
  // the man's on his heels or the lane is there: go
  attack: { momentum: 0.35, hesi: 0.25, stutter: 0.2, inout: 0.2, cross: 0.15, jab: 0.2, pushcross: 0.12 },
};
const FAM_TEND = {
  sharpshooter: { escape: 1.5, momentum: 1.2, crossover: 0.9, behind: 0.7, spin: 0.5 },
  slasher: { crossover: 1.2, spin: 1.3, momentum: 1.3, behind: 1, escape: 0.5 },
  playmaker: { crossover: 1.4, behind: 1.3, momentum: 1, escape: 1, spin: 0.8 },
  lockdown: { crossover: 1, momentum: 1, escape: 0.9, behind: 0.7, spin: 0.6 },
  two_way: { crossover: 1, momentum: 1, escape: 1, behind: 1, spin: 1 },
  glass_cleaner: { spin: 1.3, momentum: 1, crossover: 0.6, behind: 0.3, escape: 0.4 },
  stretch_big: { escape: 1.4, momentum: 0.9, spin: 0.8, crossover: 0.6, behind: 0.4 },
  post_scorer: { spin: 1.5, crossover: 0.6, behind: 0.3, escape: 0.6, momentum: 0.7 },
};
const FANCY = new Set(['btb', 'wrap', 'btl', 'halfspin', 'hang', 'pushcross', 'btlback']);
export function moveTend(p) {
  if (p._mt) return p._mt;
  if (!p.ratings) return {}; // (no player behind it: every move as it comes)
  const b = p.entry?.build || {}, arch = b.archetype || 'two_way', fam = FAM_TEND[arch] || FAM_TEND.two_way;
  const sig = (MOVE_STYLE[p.sizeupStyle] || MOVE_STYLE.basic).sig, handle = n(p.ratings.ball_handle);
  // two personal favourites, fixed per player (seeded by name and build)
  let h = 2166136261; for (const c of `${p.name}|${b.height}|${b.weight}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const fav = [MOVES[h % MOVES.length], MOVES[(h >>> 8) % MOVES.length]];
  const t = {};
  for (const m of MOVES) {
    let w = fam[MOVE_FAM[m]] ?? 1;
    if (sig.includes(m)) w *= 1.8;
    if (fav.includes(m)) w *= 2.2;
    if (FANCY.has(m)) w *= 0.45 + 0.75 * Math.min(1, handle); // a loose handle keeps it simple
    t[m] = w;
  }
  return (p._mt = t);
}
export function pickMove(p, rng, iq, weights) {
  const st = p.stam || {}, last = st.lastMove, run = st.moveRun || 0, tend = moveTend(p);
  const ws = MOVES.map(m => {
    let w = (weights[m] || 0) * (tend[m] ?? 1);
    if (m === last) w *= Math.max(0.03, 0.6 - 0.5 * iq - (run >= 2 ? 0.3 : 0));
    else if (last) w *= 1 + 0.6 * iq * (COMBOS[`${last}>${m}`] ? 1.8 : 1); // a combo (a named one most of all)
    return w;
  });
  const tot = ws.reduce((a, b) => a + b, 0);
  if (tot <= 0) return 'cross';
  let r = rng.next() * tot;
  for (let i = 0; i < MOVES.length; i++) { r -= ws[i]; if (r <= 0) return MOVES[i]; }
  return MOVES[0];
}


// v0.4.5 quick patch: a release outside the green window almost never goes in any more (shots.js OFF_TIMING). The AI
// used to make a good share of its near-misses, so its timing is now set to keep the make rate its old timing gave
// it, shot for shot: the same green rate, plus its near-misses (good) and bad misses as they used to count (offK,
// veryK of the untimed chance pNone), turned into greens. pEx: what a green is worth (1 for a sure make). Same
// shooters, same contests, same percentages; it just gets there by timing them.
const offK = attr => (attr ?? 0) >= 99 ? 0.97 : (attr ?? 0) > 95 ? 0.9 : 0.85;
// The timing is chosen when the shot starts, from the contest the AI expects; about half its jumpers end up smothered
// by the closeout, and a smothered shot has no green window to hit (it used to keep ~10% then). These make up for
// it on the rest, so its percentages by shot type stay where they were (measured in 24 AI park games each).
// v0.4.7.5: re-measured after the harsher no-badge contests and the new AI shot selection (36 AI park games at level
// 0.6): mid-range 34.6%, threes 31.9%, layups 53.0%, about 35 points a game to 21.
export const AI_TIMING_COMP = { mid: 1.65, three: 1.15, three_non: 1.8, layup: 1.98, ft: 1.05 }; // (v0.4.7.5 quick patch: mid 1.55 -> 1.65, layup 1.8 -> 1.98: the faster closeouts, recoveries and help took a little off)
function keepMakeRate(pGreen, good, pEx, pNone, nearK, veryK, fc) {
  const old = pGreen * pEx + (1 - pGreen) * (good * nearK + (1 - good) * veryK) * pNone;
  const eps = good * S.finalChance({ ...fc, grade: 'early' }) + (1 - good) * S.finalChance({ ...fc, grade: 'vearly' });
  return Math.max(0, Math.min(0.97, (old - eps) / Math.max(1e-3, pEx - eps)));
}

export class AI {
  constructor(game) {
    this.g = game;
    this.mem = new Map(); // per player memory
    this.match = [new Map(), new Map()]; // [offenseTeam] → Map(defenderId → offensive player)
    this.variant = [0, 0];
    this.lastPossession = -1;
    this.stats = {};
  }
  m(p) { let o = this.mem.get(p.id); if (!o) { o = { next: 0, target: null, role: null, cutT: 0, screenT: 0, rollT: 0, react: 0, plan: null, probe: null, wait: 0, jumpAt: -1 }; this.mem.set(p.id, o); } return o; }

  matchups(offTeam) {
    const g = this.g;
    const off = g.teams[offTeam], def = g.teams[1 - offTeam];
    const map = new Map();
    const rank = p => ({ PG: 0, SG: 1, SF: 2, PF: 3, C: 4 }[p.position] ?? 2);
    const o = [...off].sort((a, b) => rank(a) - rank(b) || a.phys.H - b.phys.H);
    const d = [...def].sort((a, b) => rank(a) - rank(b) || a.phys.H - b.phys.H);
    d.forEach((dp, i) => map.set(dp.id, o[i % o.length]));
    this.match[offTeam] = map;
    return map;
  }
  manOf(d) {
    const g = this.g, offTeam = 1 - d.team;
    let mp = this.match[offTeam];
    if (!mp.size) mp = this.matchups(offTeam);
    return mp.get(d.id) || g.teams[offTeam][0];
  }

  // v0.4.3: archetype tendencies (bots carry their own rolled copy; anyone else gets the archetype defaults)
  tend(p) {
    // v0.4.4: auto-play plays your player the way your career numbers say you do
    if (p.human && this.g.assist && p.profile) return p.profile.tend;
    if (!p._tend) { const b = p.entry.build || {}; p._tend = { ...tendenciesFor(b), ...(b.tendencies || {}) }; }
    return p._tend;
  }

  // v0.4.4: basketball IQ. World AI hoopers carry their own (casuals ~0.1-0.4, park legends ~0.85-1); the
  // difficulty setting nudges everyone. Players without one (practice dummies, the user) use the difficulty.
  // v0.4.5 final: every AI hooper, in every tier, plays 10% smarter (AI_SKILL_K; the user's own player isn't
  // touched). IQ drives reads, reaction times, defense, shot selection and the AI's green rate.
  // v0.4.5 quick patch: smarter again, every tier, the better ones more (AI_IQ_BONUS: +0.04 + 0.08×IQ)
  iq(p) {
    const g = this.g;
    if (p.iq == null) return p.human ? 0.6 : aiIQ(g.difficulty * AI_SKILL_K);
    const base = Math.max(0, Math.min(1, p.iq + (g.difficulty - 0.6) * 0.5));
    return p.human ? base : aiIQ(base * AI_SKILL_K);
  }
  skill(p) { return Math.min(1, this.iq(p) * 0.6 + 0.4 * (p.human ? 0.7 : n(p.ratings.perimeter_d) * 0.5 + 0.5)); }

  // delayed perception of an opponent (reaction time)
  seen(q, delay) {
    const h = q._hist;
    if (!h || !h.length) return { x: q.x, z: q.z, vx: q.vx, vz: q.vz };
    const k = Math.min(h.length - 1, Math.round(delay * 60));
    return h[h.length - 1 - k];
  }

  think(dt) {
    const g = this.g;
    for (const p of g.players) { const h = p._hist || (p._hist = []); h.push({ x: p.x, z: p.z, vx: p.vx, vz: p.vz }); if (h.length > 40) h.shift(); }
    // v0.4.7.5: how long each handler has had the ball (dead-dribble check); a new touch resets a screen call
    for (const p of g.players) { const o = this.m(p); if (g.ball.holder === p.id) { if (!o.ballT) o.fresh = true; o.ballT = (o.ballT || 0) + dt; } else { o.ballT = 0; o.screenAsk = false; o.fresh = false; o.inMove = false; } }
    if (g.possession !== this.lastPossession) { this.lastPossession = g.possession; this.matchups(g.possession); this.variant[g.possession] = g.rng.int(0, 2); for (const p of g.players) { const o = this.m(p); o.plan = null; o.cutT = 0; } }
    for (const p of g.players) {
      if (!g.isAI(p)) { this.humanAssistHints(p, dt); continue; }
      if (g.practice && p.team === 1) { this.practiceDefender(p, dt); continue; }
      if (g.phase === 'ft' || g.phase === 'ftflight') { this.ftLane(p, dt); continue; }
      if (g.phase === 'tip') continue;
      if (g.phase === 'dead' || g.over) { this.deadBallMove(p, dt); continue; }
      const b = g.ball;
      const loose = b.mode === 'flight' && (b.kind === 'loose' || (b.kind === 'shot' && (b.info?.missed || b.touchedRim || b.touchedBoard)));
      if (loose || (b.mode === 'flight' && b.kind === 'shot')) { this.rebound(p, dt, loose); continue; }
      if (g.phase === 'inbound') { this.inboundMove(p, dt); continue; }
      if (b.mode === 'flight' && b.kind === 'pass' && b.info.to === p.id && p.action?.type !== 'oop') { this.meetPass(p, b); continue; }
      if (p.team === g.possession) {
        if (b.holder === p.id) this.handler(p, dt); else this.offBall(p, dt);
      } else this.defend(p, dt);
    }
  }

  // ---------- movement helpers ----------
  seek(p, x, z, opts = {}) {
    // v0.4.7.5 quick patch: in play, nobody runs at a spot out of bounds, and nobody runs through a line (see lineBrake)
    const live = this.g.phase === 'live' && !opts.allowOut;
    if (live) [x, z] = this.clampCourt(x, z, this.g.half);
    const dx = x - p.x, dz = z - p.z, d = hyp(dx, dz);
    const slow = opts.arrive ?? 1.2;
    const k = d < 0.15 ? 0 : Math.min(1, d / slow);
    p.intent.mx = d > 0.01 ? dx / d * k : 0;
    p.intent.mz = d > 0.01 ? dz / d * k : 0;
    p.intent.sprint = opts.sprint ?? (d > 5.5);
    if (live && this.g.ball.holder !== p.id) this.lineBrake(p); // (the man with the ball is kept in bounds by the sim itself)
    return d;
  }
  // v0.4.7.5 quick patch: the AI used to carry its speed straight over a sideline or the baseline (cuts, closeouts,
  // chasing a pass). Near a line, the run toward it is eased off in time for him to stop on the right side of it,
  // given how hard he can brake.
  lineBrake(p) {
    const g = this.g, it = p.intent, brake = Math.max(6, (p.phys.brake || 17) * 0.55);
    const ease = (pos, vel, lo, hi, key) => {
      const dir = Math.sign(it[key]);
      if (!dir) return;
      const room = dir > 0 ? hi - pos : pos - lo, v = Math.max(0, vel * dir), stop = v * v / (2 * brake);
      if (room <= stop + 0.15) it[key] = -dir * Math.min(1, (stop + 0.15 - room) * 2 + 0.2); // brake now
      else if (room < 1.2) it[key] *= Math.max(0, (room - stop) / 1.2);                     // ease in
    };
    ease(p.x, p.vx, -COURT.width / 2 + 0.35, COURT.width / 2 - 0.35, 'mx');
    ease(p.z, p.vz, g.half ? 0.2 : -COURT.length / 2 + 0.35, COURT.length / 2 - 0.35, 'mz');
  }
  face(p, x, z) { p.intent.face = Math.atan2(x - p.x, z - p.z); }
  clampCourt(x, z, half) {
    x = Math.max(-COURT.width / 2 + 0.4, Math.min(COURT.width / 2 - 0.4, x));
    z = Math.max(half ? 0.5 : -COURT.length / 2 + 0.4, Math.min(COURT.length / 2 - 0.4, z));
    return [x, z];
  }

  // ---------- offense ----------
  shotValue(p, x, z, defenders) {
    const g = this.g, side = g.sideFor(p.team), rim = rimOf(side);
    const d = hyp(rim.x - x, rim.z - z);
    const three = isThree(x, z, side);
    let close = 9;
    for (const q of defenders) close = Math.min(close, hyp(q.x - x, q.z - z));
    const contest = Math.max(0, Math.min(1.2, (2.3 - close) / 1.6));
    const type = d < 1.8 ? 'close' : 'jumper';
    if (d > 8.6) return { val: 0.05, d, three, contest };
    const attr = three ? p.ratings.three_point : p.ratings.mid_range;
    const win = S.greenWindowMs(attr, p.badges, { contest, moving: 0, d, three, pkg: type === 'close' ? null : p.shotPkg });
    const gExp = type === 'close' ? 0 : Math.max(0.02, Math.min(attr >= 99 ? 0.88 : attr > 95 ? 0.72 : 0.65, 0.13 + 0.3 * n(attr) + (this.iq(p) - 0.6) * 0.24)) * Math.pow(win / S.timingWindowMs(attr, p.badges), 0.8) * (three ? 1.0 : 1);
    // (what a near-miss used to be worth: the AI's timing is set to keep that make rate, see keepMakeRate)
    const miss = type === 'close' ? S.finalChance({ type, d, a: p.ratings, three, grade: 'none', contest, stamina: p.stamina, badges: p.badges }) : S.finalChance({ type, d, a: p.ratings, three, grade: 'none', contest, stamina: p.stamina, badges: p.badges }) * offK(attr);
    const pct = gExp + (1 - gExp) * miss;
    return { val: pct * (three ? 3 : 2), d, three, contest, pct };
  }

  // contest the shooter would face if defenders put a hand up now
  // look: how far ahead (s) a closing defender is projected (v0.4.7.5 quick patch: shot decisions look 0.5 s ahead,
  // the time a jumper takes to get off, now that closeouts come on the pass)
  estimateContest(p, defs, rim, look = 0.3) {
    const cs = [];
    const fx = rim.x - p.x, fz = rim.z - p.z, fl = hyp(fx, fz) || 1;
    const relH = p.phys.reach * 0.93 + p.phys.vertical * p.shotPkg.jumpK * 0.5;
    for (const d of defs) {
      const dx = d.x - p.x, dz = d.z - p.z, d0 = hyp(dx, dz);
      // closeouts arrive while the shooter gathers: shrink distance by the relative closing speed
      const closing = d0 > 0.01 ? -(dx * ((d.vx || 0) - (p.vx || 0)) + dz * ((d.vz || 0) - (p.vz || 0))) / d0 : 0;
      const dist = Math.max(0.3, d0 - Math.max(0, closing) * look);
      if (dist > 2.6 || d.action?.type === 'stumble') continue;
      const front = (dx * fx + dz * fz) / (fl * (dist || 1));
      const ang = front > 0.35 ? 1 : front > -0.1 ? 0.55 : 0.18;
      const prox = Math.max(0, Math.min(1, (2.0 - dist) / 1.45));
      const pw = S.paintWeight(fl);
      // v0.4.3: a defender this close will leave his feet to contest at the release; count the jump
      const jump = dist < 1.6 && (d.cool?.block ?? 0) <= 0.3 ? d.phys.vertical * 0.55 : 0;
      const hk = Math.max(0.35, Math.min(1.25 + 0.08 * pw, 0.75 + (d.phys.reach + 0.12 + jump - relH) * (0.7 + 0.3 * pw)));
      cs.push(prox * ang * hk * S.defSkill(d, pw) * (jump ? 1.08 : 1));
    }
    cs.sort((a, b) => b - a);
    return (cs[0] || 0) + (cs[1] || 0) * 0.3;
  }

  laneOpen(p, tx, tz, width = 0.95) {
    const g = this.g;
    const lx = tx - p.x, lz = tz - p.z, L = hyp(lx, lz) || 1;
    for (const q of g.opponents(p)) {
      const qx = q.x - p.x, qz = q.z - p.z;
      const t = (qx * lx + qz * lz) / (L * L);
      if (t < 0.05 || t > 1.05) continue;
      const px = p.x + lx * t, pz = p.z + lz * t;
      if (hyp(q.x - px, q.z - pz) < width) return false;
    }
    return true;
  }

  passRisk(p, r) {
    const g = this.g;
    let risk = 0;
    const lx = r.x - p.x, lz = r.z - p.z, L = hyp(lx, lz) || 1;
    for (const q of g.opponents(p)) {
      const qx = q.x - p.x, qz = q.z - p.z;
      const t = Math.max(0, Math.min(1, (qx * lx + qz * lz) / (L * L)));
      const dd = hyp(q.x - (p.x + lx * t), q.z - (p.z + lz * t));
      if (dd < 1.4) risk += (1.4 - dd) * (0.3 + n(q.ratings.steal) * 0.5 + bk(q.badges, 'interceptor') * 0.06) * (t > 0.15 ? 1 : 0.3);
    }
    return risk + Math.max(0, L - 9) * 0.05;
  }

  openness(r) {
    let close = 9;
    for (const q of this.g.opponents(r)) close = Math.min(close, r.dist(q));
    return close;
  }

  // v0.4.7.5 qp3: a teammate running the open floor ahead of the handler: well ahead, headed for the rim (or already
  // near it), nobody on him and nobody between him and the rim. Returns {r, canOop} or null. The human counts too:
  // an alley to him asks for the button press (game.oopQte).
  runnerAhead(p) {
    const g = this.g, side = g.sideFor(p.team), rim = rimOf(side);
    let best = null, bv = -Infinity;
    for (const m of g.mates(p)) {
      if (m.airborne || (m.action && m.action.type !== 'catch')) continue;
      const ahead = (m.z - p.z) * side;
      if (ahead < 2.5) continue;
      const dr = hyp(m.x - rim.x, m.z - rim.z);
      if (dr > RUNNER.maxRim) continue;
      const toward = ((rim.x - m.x) * m.vx + (rim.z - m.z) * m.vz) / (dr || 1);
      if (toward < (dr > 3 ? RUNNER.run : RUNNER.run * 0.5)) continue; // he has to be running at it
      const open = this.openness(m);
      if (open < RUNNER.open) continue;
      const lane = g.opponents(p).some(q => {
        const t = ((q.x - m.x) * (rim.x - m.x) + (q.z - m.z) * (rim.z - m.z)) / (dr * dr || 1);
        if (t < -0.1 || t > 1) return false;
        return hyp(q.x - (m.x + (rim.x - m.x) * t), q.z - (m.z + (rim.z - m.z) * t)) < RUNNER.lane;
      });
      if (lane) continue;
      // open court means nobody back who can recover: any defender already level with him or deeper has to be
      // well away from him
      if (g.opponents(p).some(q => hyp(q.x - rim.x, q.z - rim.z) < dr + 1.5 && q.dist(m) < RUNNER.recover)) continue;
      const v = ahead + open * 0.5 - dr * 0.3 + (m.human ? 0.5 : 0);
      if (v > bv) { bv = v; best = m; }
    }
    if (!best) return null;
    const finisher = best.human || (best.ratings.driving_dunk ?? 0) > 55 || best.phys.reach + best.phys.vertical > 3.25;
    const dr = hyp(best.x - rim.x, best.z - rim.z);
    // an alley-oop only when he can really get there: inside oopRim of the rim and with time to spare (0.7 of
    // the full-sprint budget; game.oopReachable), so the lob isn't at the rim before he is
    return { r: best, canOop: finisher && dr <= RUNNER.oopRim && g.oopReachable(p, best, RUNNER.reachK), open: this.openness(best) };
  }
  // the lob-first pass to a runner: alley if he can get up for it, a lob over the defense when the chest lane is
  // crowded, a chest pass otherwise. Returns true when a pass was called
  passToRunner(p, it, IQ, lobOk = true) {
    const run = this.runnerAhead(p);
    if (!run) return false;
    const g = this.g;
    if (!run.canOop && !lobOk) return false; // (no numbers: only the alley-oop to a man who's clear is worth it)
    if (g.rng.next() > RUNNER.chance0 + RUNNER.chanceIQ * IQ) return false;
    // over the top only when a body is in the chest lane and the runner is clear enough to come down with it;
    // otherwise the fast pass ahead
    let type = 'alley';
    if (!run.canOop) {
      const risk = this.passRisk(p, run.r);
      if (risk < RUNNER.lobRisk) type = 'chest';
      else if (risk < RUNNER.lobRiskMax && run.open >= RUNNER.lobOpen) type = 'lob';
      else return false; // (no clean way to get it to him)
    }
    it.pass = { target: run.r.id, type, quick: type === 'lob' };
    const k = type === 'alley' ? 'breakOop' : type === 'lob' ? 'breakLob' : 'breakAhead';
    this.stats[k] = (this.stats[k] || 0) + 1;
    return true;
  }

  bestPassTarget(p, dir) {
    const g = this.g;
    let best = null, bv = -Infinity;
    for (const r of g.mates(p)) {
      if (r.action?.type === 'stumble') continue;
      const sv = this.shotValue(r, r.x, r.z, g.opponents(r)).val;
      let v = sv + Math.min(3, this.openness(r)) * 0.25 - this.passRisk(p, r) * 1.2 + (r.calling > 0 ? 0.35 : 0) + (r.human ? 0.25 : 0);
      const lp = g.lastPass;
      if (lp && lp.from === r.id && lp.to === p.id && g.time - lp.time < 3) v -= 0.6; // no instant give-backs
      if (dir && hyp(dir.x, dir.z) > 0.2) {
        const dx = r.x - p.x, dz = r.z - p.z, dl = hyp(dx, dz) || 1;
        v += ((dx * dir.x + dz * dir.z) / (dl * hyp(dir.x, dir.z))) * 3;
      }
      if (v > bv) { bv = v; best = r; }
    }
    return best;
  }

  inboundTarget(inb) {
    const g = this.g;
    let best = null, bv = -Infinity;
    for (const r of g.mates(inb)) {
      const v = Math.min(4, this.openness(r)) - hyp(r.x - inb.x, r.z - inb.z) * 0.15 + (r.position === 'PG' ? 1 : 0) + (r.human ? 1.5 : 0) - this.passRisk(inb, r);
      if (v > bv) { bv = v; best = r; }
    }
    return best;
  }

  // v0.4.5 timed layups for the AI (and auto-play): the same idea as jumpers. The chance of a green follows the
  // Layup rating, IQ and how much the window shrinks under the contest; the release moves to match the grade.
  layupTiming(p, a, rim) {
    const g = this.g, attr = p.ratings.layup;
    const contest = this.estimateContest(p, g.opponents(p), rim);
    const win = S.layupWindowMs(attr, p.badges, { contest, lstyle: a.lstyle }), base = S.layupWindowMs(attr, p.badges, { lstyle: a.lstyle });
    let pGreen = base > 0 ? Math.max(0.02, Math.min(0.6, 0.1 + 0.32 * n(attr) + (this.iq(p) - 0.6) * 0.2)) * Math.pow(win / base, 0.8) : 0;
    let good = 0.86;
    if (p.human && g.assist && p.profile) {
      // auto-play: finish like your career twos say you do
      const prior = 0.3 + 0.24 * n(attr), k = Math.max(0.35, Math.min(2.4, p.profile.fg2 / prior));
      pGreen = Math.max(0.01, Math.min(0.9, pGreen * Math.pow(k, 1.4)));
      good = Math.max(0.55, Math.min(0.97, 1 - 0.14 / k));
    }
    {
      const fc = { type: 'layup', d: hyp(rim.x - p.x, rim.z - p.z), a: p.ratings, three: false, contest, stamina: p.stamina, badges: p.badges, hot: p.hot };
      pGreen = Math.min(0.97, AI_TIMING_COMP.layup * keepMakeRate(pGreen, good, S.finalChance({ ...fc, grade: 'excellent' }), S.finalChance({ ...fc, grade: 'none' }), 0.92, 0.62, fc));
    }
    const r = g.rng.next();
    const grade = r < pGreen ? 'excellent' : r < pGreen + (1 - pGreen) * good ? (g.rng.next() < 0.5 ? 'early' : 'late') : (g.rng.next() < 0.5 ? 'vearly' : 'vlate');
    const w = Math.max(win, base * 0.4, 9) * g.speed / 1000;
    const err = grade === 'excellent' ? g.rng.range(-w, w) * 0.8
      : grade === 'early' ? -g.rng.range(w * 1.1, w * 2.2) : grade === 'late' ? g.rng.range(w * 1.1, w * 2.2)
      : grade === 'vearly' ? -g.rng.range(w * 2.8, w * 3.4) : g.rng.range(w * 2.8, w * 3.4);
    return { at: Math.max(a.takeoff + 0.02, a.release + err), grade, contest };
  }

  // AI shooters don't press a button: pick the release quality from skill, difficulty and how tough the
  // shot is (the same things that shrink a human's green window), then time the release to match.
  releaseTiming(p, tRel, ft, st) {
    const g = this.g;
    const side = g.sideFor(p.team), rim = rimOf(side);
    const three = !ft && isThree(p.x, p.z, side);
    const attr = ft ? p.ratings.free_throw : three ? p.ratings.three_point : p.ratings.mid_range;
    const d = hyp(rim.x - p.x, rim.z - p.z);
    const contest = ft ? 0 : this.estimateContest(p, g.opponents(p), rim);
    const act = p.action?.type === 'shoot' ? p.action : null;
    const nonShooter = !S.isShooterArch(p.archetype);
    const win = S.greenWindowMs(attr, p.badges, { ft, contest, moving: act ? act.moving : p.speed, fade: !!st?.fade || !!act?.fade, d, three, pkg: p.shotPkg, hustle: act?.hustle, nonShooter });
    const base = S.timingWindowMs(attr, p.badges);
    let pGreen = Math.max(0.02, Math.min(attr >= 99 ? 0.88 : attr > 95 ? 0.72 : 0.65, (ft ? 0.26 : 0.13) + 0.3 * n(attr) + (this.iq(p) - 0.6) * 0.24)) * Math.pow(win / base, 0.8) * (three ? 1.0 : 1);
    let good = 0.86;
    if (p.human && g.assist && p.profile) {
      // auto-play: shoot it as well (or as badly) as your career twos / threes / free throws say. The prior is
      // what the AI would shoot with this rating; k > 1 means you shoot better than that.
      const pr = p.profile, prior = ft ? 0.45 + 0.38 * Math.min(1.1, n(attr)) : three ? 0.18 + 0.22 * n(attr) : 0.3 + 0.24 * n(attr);
      const k = Math.max(0.35, Math.min(2.4, (ft ? pr.ft : three ? pr.tp : pr.fg2) / prior));
      pGreen = Math.max(0.01, Math.min(0.94, pGreen * Math.pow(k, 1.4)));
      good = Math.max(0.55, Math.min(0.97, 1 - 0.14 / k));
    }
    {
      const fc = { type: ft ? 'ft' : 'jumper', d, a: p.ratings, three, contest, moving: p.speed, fade: !!st?.fade, stamina: p.stamina, badges: p.badges };
      pGreen = Math.min(0.97, AI_TIMING_COMP[ft ? 'ft' : three ? (nonShooter ? 'three_non' : 'three') : 'mid'] * keepMakeRate(pGreen, good, ft || (d <= S.DEEP_D && !(nonShooter && three)) ? 1 : S.finalChance({ ...fc, grade: 'excellent' }), S.finalChance({ ...fc, grade: 'none' }), offK(attr), 0.38, fc));
    }
    const r = g.rng.next();
    const grade = r < pGreen ? 'excellent' : r < pGreen + (1 - pGreen) * good ? (g.rng.next() < 0.5 ? 'early' : 'late') : (g.rng.next() < 0.5 ? 'vearly' : 'vlate');
    const w = Math.max(win, base * 0.4) * g.speed / 1000;
    const err = grade === 'excellent' ? g.rng.range(-w, w) * 0.8
      : grade === 'early' ? -g.rng.range(w * 1.1, w * 2.4) : grade === 'late' ? g.rng.range(w * 1.1, w * 2.4)
      : grade === 'vearly' ? -g.rng.range(w * 2.8, w * 3.6) : g.rng.range(w * 2.8, w * 3.6);
    return { at: Math.max(0.05, tRel + err), grade, contest };
  }

  // the drive is there: my man beaten (not squarely between me and the rim, off balance, or a step behind) and
  // nobody else in the lane
  driveLane(p, myDef, defs, rim, d, defDist) {
    if (!myDef) return false;
    const rx = rim.x - p.x, rz = rim.z - p.z, rl = Math.hypot(rx, rz) || 1;
    const qx = myDef.x - p.x, qz = myDef.z - p.z;
    const along = (qx * rx + qz * rz) / rl, lat = Math.abs(qx * rz - qz * rx) / rl;
    const offBalance = myDef.action?.type === 'stumble' || myDef.action?.type === 'steal' || myDef.airborne || myDef.bumpT > 0 || myDef.plantT > 0;
    if (!(along < 0.25 || lat > 0.75 || offBalance || defDist > 2.6)) return false;
    return defs.every(q => { if (q === myDef) return true; const hx = q.x - p.x, hz = q.z - p.z; const al = (hx * rx + hz * rz) / rl; const la = Math.abs(hx * rz - hz * rx) / rl; return al < 1 || al > rl + 0.5 || la > 1.3; });
  }

  handler(p, dt) {
    const g = this.g, o = this.m(p);
    const side = g.sideFor(p.team), rim = rimOf(side);
    const it = p.intent;
    const defs = g.opponents(p);
    const myDef = defs.reduce((a, q) => (!a || q.dist(p) < a.dist(p) ? q : a), null);
    const defDist = myDef ? myDef.dist(p) : 9;
    // backcourt / transition (pro-am): bring it up
    const inFront = (p.z - 0) * side > 0;
    if (!g.half && !inFront) {
      // v0.4.7.5 quick patch: push it. With the numbers (no more of them back than of us ahead) he goes straight at
      // the rim, flat out; otherwise he sprints it up unless someone's right on him. A big who pulled the rebound
      // outlets it to a guard, and a man open up the floor gets it quickly
      const IQb = this.iq(p), back = defs.filter(q => (q.z - p.z) * side > 0.5).length, ahead = g.mates(p).filter(m => (m.z - p.z) * side > 1).length;
      const brk = back === 0 || back < ahead || (back === ahead && back <= 1);
      const tz = brk ? rim.z - side * 2.2 : side * 5, tx = brk ? p.x * 0.4 : p.x * 0.6;
      this.seek(p, tx, tz, { sprint: brk || defDist > 1.5 });
      it.face = Math.atan2(rim.x - p.x, rim.z - p.z);
      if (brk) o.fastBreak = g.time;
      o.next -= dt;
      if (o.next <= 0) {
        o.next = 0.12;
        // v0.4.7.5 qp3: first look is the man running the open floor: lob it over the top (an alley-oop if he can
        // get up for it). Only then the man open up the floor, then the big's outlet
        if (this.passToRunner(p, it, IQb)) return;
        const r = this.bestPassTarget(p);
        if (r && (r.z * side > p.z * side + 4) && this.openness(r) > 2.6 && this.passRisk(p, r) < 0.4 && g.rng.next() < 0.5 + 0.35 * IQb) it.pass = { target: r.id, type: 'chest' };
        else if ((p.position === 'C' || p.position === 'PF') && o.ballT < 1.5) {
          const gd = g.mates(p).filter(m => (m.position === 'PG' || m.position === 'SG') && this.openness(m) > 2.4 && this.passRisk(p, m) < 0.35).sort((a, b) => (b.z - a.z) * side)[0];
          if (gd && g.rng.next() < 0.4 + 0.4 * IQb) { it.pass = { target: gd.id, type: 'chest' }; this.stats.outlet = (this.stats.outlet || 0) + 1; }
        }
      }
      return;
    }
    if (g.needsClear[p.team]) {
      const sp = spotsFor(1, side)[0];
      this.seek(p, sp.x + (p.x > 0 ? 1.5 : -1.5), sp.z - side * 0.6, { sprint: true });
      it.face = Math.atan2(rim.x - p.x, rim.z - p.z);
      return;
    }
    if (p.action && p.action.type !== 'catch') { if (p.action.type === 'move' && !o.inMove) { o.inMove = true; o.moveGap = defDist; } return; }
    const IQ = this.iq(p);
    // v0.4.7.5 qp3: still in transition (the break was on, or the ball has just come over): a teammate running
    // free at the rim gets the lob before anything else
    if (!g.half && g.time - (o.fastBreak || -9) < 2.5 && g.rng.next() < dt * 10) {
      if (this.passToRunner(p, it, IQ)) return;
    }
    // v0.4.7.5 quick patch: quicker reads. Off the catch he reads the floor right away (not after a beat of holding
    // it), and when his own move has just made space (his man stumbling, planted, or left a step behind) he uses
    // it now: the shot, the drive or the pass
    if (o.fresh) { o.fresh = false; o.next = Math.min(o.next, 0.02 + (1 - IQ) * 0.1); o.target = null; }
    if (o.inMove) {
      o.inMove = false;
      const off = myDef && (myDef.action?.type === 'stumble' || myDef.plantT > 0 || myDef.bumpT > 0 || myDef.airborne);
      if (off || (defDist > 1.75 && defDist > (o.moveGap ?? 9) + 0.45)) { o.next = Math.min(o.next, 0.02); o.target = null; this.stats.moveSpace = (this.stats.moveSpace || 0) + 1; }
    }
    // v0.4.5: right after an ankle-breaker, make the defender pay. Slashers, playmakers and bigs take it to
    // the rim for a dunk or layup; shooters (sharpshooters, stretch bigs, lockdowns) rise up right there.
    if (p.ankleT != null && g.time - p.ankleT < 1.4 && o.ankleFor !== p.ankleT && !g.practice) {
      o.ankleFor = p.ankleT;
      const arch = p.entry?.build?.archetype || '', dR = hyp(rim.x - p.x, rim.z - p.z);
      const shooter = arch === 'sharpshooter' || arch === 'stretch_big' || arch === 'lockdown' || (arch === 'two_way' && dR > 6 && n(p.ratings.three_point) > 0.6);
      if (shooter && dR < 8.3) { it.shoot = 'press'; it.forceJumper = dR > 2.2; o.plan = null; this.stats.ankleShot = (this.stats.ankleShot || 0) + 1; return; }
      o.plan = 'drive'; o.attack = true; o.cutT = 0; this.stats.ankleDrive = (this.stats.ankleDrive || 0) + 1;
      if (shooter) { o.plan = 'pullup'; o.attack = false; } // too deep: a dribble or two in, then the pull-up
      this.seek(p, rim.x, rim.z, { sprint: true });
      return;
    }
    if (o.plan === 'pullup') {
      this.seek(p, rim.x, rim.z, { sprint: true });
      if (d0(p, rim) < 7.6 || g.time - p.ankleT > 1.6) { it.shoot = 'press'; it.forceJumper = true; o.plan = null; }
      return;
    }
    const reactBase = 0.42 - IQ * 0.28; // v0.4.4: sharp players read the floor about twice as fast as casuals
    // v0.4.2: a teammate calling for the ball gets it almost instantly when he's open and the lane is clean;
    // with a clogged lane the handler holds it (keeps probing) and throws as soon as it clears
    {
      const caller = g.mates(p).find(r => r.calling > 0 && r.action?.type !== 'stumble');
      // v0.4.5: ...unless I'm the one with the better look (an open shot in range, or the lane): a smart
      // handler doesn't give that up just because somebody is calling
      const myLook = caller && !p.human ? this.shotValue(p, p.x, p.z, defs).val * (1 - 0.5 * Math.min(1, this.estimateContest(p, defs, rim))) : 0;
      const callerLook = caller ? this.shotValue(caller, caller.x, caller.z, g.opponents(caller)).val : 0;
      if (caller && !(myLook > callerLook + 0.1 + (1 - IQ) * 0.3 && g.rng.next() < 0.4 + 0.5 * IQ)) {
        if (o.callFor !== caller.id || caller.calling > 1.12) { o.callFor = caller.id; o.callT0 = g.time; }
        const waited = g.time - o.callT0, risk = this.passRisk(p, caller), open = this.openness(caller);
        const react = 0.05 + (1 - IQ) * 0.14;
        if (waited > react && (risk < 0.32 || (risk < 0.7 && open > 2.4 && waited > 0.55))) {
          it.pass = { target: caller.id, type: risk > 0.18 ? 'bounce' : 'chest' };
          o.plan = null; caller.calling = 0; o.callFor = null;
          this.stats.callPass = (this.stats.callPass || 0) + 1;
          return;
        }
      } else o.callFor = null;
    }
    o.next -= dt;
    const sv = this.shotValue(p, p.x, p.z, defs);
    const d = sv.d;
    // v0.4.3: post-up in progress: back the defender down toward the block, then a hook / close shot, or kick
    // it out if a second defender comes
    if (o.plan === 'post') {
      o.postT -= dt; p.posting = 0.3;
      const bx = rim.x + o.postSide * 1.3, bz = rim.z - side * 1.05;
      this.seek(p, bx, bz, { sprint: false, arrive: 0.4 });
      it.mx *= 0.55; it.mz *= 0.55; // a slow, physical back-down
      it.face = Math.atan2(rim.x - p.x, rim.z - p.z);
      const dbl = defs.filter(q => q.dist(p) < 1.7).length >= 2;
      if (dbl) {
        const r = this.bestPassTarget(p);
        if (r && this.openness(r) > 1.8 && this.passRisk(p, r) < 0.45) { it.pass = { target: r.id, type: 'chest' }; o.plan = null; return; }
      }
      if (d < 1.85 || g.shotClock < 3 || (o.postT <= 0 && d < 2.8)) { it.shoot = 'press'; o.plan = null; this.stats.postShot = (this.stats.postShot || 0) + 1; }
      else if (o.postT <= 0) { o.plan = null; o.next = 0; } // stalled: go back to reading the floor
      return;
    }
    // drive in progress
    if (o.plan === 'drive') {
      // attack the defender's open shoulder instead of running into his chest
      let tx = rim.x, tz = rim.z - side * 0.9;
      const block = defs.filter(q => q.dist(p) < 2.4 && !q.airborne).map(q => {
        const qx = q.x - p.x, qz = q.z - p.z, al = (qx * (rim.x - p.x) + qz * (rim.z - p.z)) / d, la = (qx * (rim.z - p.z) - qz * (rim.x - p.x)) / d;
        return { q, al, la };
      }).filter(o2 => o2.al > 0.1 && Math.abs(o2.la) < 0.9).sort((a2, b2) => a2.al - b2.al)[0];
      if (block) {
        const px = (rim.z - p.z) / d, pz = -(rim.x - p.x) / d; // perpendicular (lateral) unit
        const go = block.la > 0 ? -1 : 1;
        tx = block.q.x + px * go * 1.1 + (rim.x - p.x) / d * 0.6;
        tz = block.q.z + pz * go * 1.1 + (rim.z - p.z) / d * 0.6;
        o.driveSide = go;
        if (block.al < 1.0 && Math.abs(block.la) < 0.5 && p.cool.move <= 0 && n(p.ratings.ball_handle) > 0.45 && g.rng.next() < 0.35) {
          const lx = Math.cos(p.facing), lz = -Math.sin(p.facing);
          it.move = pickMove(p, g.rng, this.iq(p), SITU.block);
          it.mx = px * go; it.mz = pz * go;
          return;
        }
      }
      this.seek(p, tx, tz, { sprint: true, arrive: 0.5 });
      const toward = p.speed > 0.1 ? ((rim.x - p.x) * p.vx + (rim.z - p.z) * p.vz) / (d * p.speed) : 0;
      if (d < 3.4 && p.speed > 2.3 && toward > 0.55) { it.shoot = 'press'; it.sprint = true; if (o.attack) it.attack = true; o.plan = null; o.attack = false; this.stats.finish = (this.stats.finish || 0) + 1; return; }
      // an ankle-breaker drive finishes at the rim (dunk if he can get up, otherwise a layup)
      if (o.attack && d < 3.6) { it.shoot = 'press'; it.sprint = true; it.attack = true; o.plan = null; o.attack = false; this.stats.finish = (this.stats.finish || 0) + 1; return; }
      // cut off only when a defender is squarely in the path just ahead
      const ahead = defs.find(q => { const qx = q.x - p.x, qz = q.z - p.z, al = (qx * (rim.x - p.x) + qz * (rim.z - p.z)) / d; const la = Math.abs(qx * (rim.z - p.z) - qz * (rim.x - p.x)) / d; return al > 0.2 && al < 0.9 && la < 0.35 && !q.airborne; });
      o.cutT = ahead ? (o.cutT || 0) + dt : 0;
      const cutOff = !!ahead && d > 2.6 && o.cutT > 0.45;
      if (cutOff || (d < 3.4 && p.speed <= 1.6)) {
        this.stats[cutOff ? 'cutoff' : 'slow'] = (this.stats[cutOff ? 'cutoff' : 'slow'] || 0) + 1;
        o.attack = false;
        if (d < 1.9) { it.shoot = 'press'; o.plan = null; return; }
        // v0.4.5: smarter than kicking it out every time: a short floater/pull-up when he has the space, and
        // only a pass to a teammate who is actually open with a better look
        const mine = this.shotValue(p, p.x, p.z, defs), myC = this.estimateContest(p, defs, rim);
        if (d < 4.2 && myC < 0.3 + IQ * 0.1) { it.shoot = 'press'; o.plan = null; return; }
        const r = this.bestPassTarget(p);
        if (r && this.openness(r) > 2.2 && this.passRisk(p, r) < 0.4 && this.shotValue(r, r.x, r.z, g.opponents(r)).val > mine.val * (1 - 0.5 * Math.min(1, myC)) + 0.05) { it.pass = { target: r.id, type: this.passRisk(p, r) > 0.2 ? 'bounce' : 'chest' }; o.plan = null; return; }
        if (mine.val > 0.95 && myC < 0.35) { it.shoot = 'press'; it.forceJumper = true; o.plan = null; return; }
        o.plan = null; o.next = 0.25;
        const sp = spotsFor(1, side)[0]; o.target = { x: p.x * 0.7, z: sp.z + side * 1.5 };
        return;
      }
      if (!this.laneOpen(p, rim.x, rim.z, 0.6) && defDist < 1.2 && p.cool.move <= 0 && g.rng.next() < 0.05 + n(p.ratings.ball_handle) * 0.08) it.move = pickMove(p, g.rng, this.iq(p), SITU.shut);
      return;
    }
    // shot clock emergency
    if (g.shotClock < 2.2 && g.mode !== 'practice') { it.shoot = 'press'; it.forceJumper = d > 3; this.stats.forced = (this.stats.forced || 0) + 1; return; }
    const T = this.tend(p);
    // v0.4.7.5: a wide-open look gets taken. Off the catch (or any time the closest man is nowhere near), a shooter
    // in his range lets it fly instead of putting it on the floor
    const estC0 = this.estimateContest(p, defs, rim, 0.5);
    const shotAttr = sv.three ? p.ratings.three_point : p.ratings.mid_range;
    if (estC0 < 0.16 && shotAttr >= 70 && sv.val > 1.0 - 0.08 * IQ && d > 1.9 && d < 8.2 && o.ballT > 0.12 && g.rng.next() < 0.5 + 0.4 * IQ) {
      it.shoot = 'press'; it.forceJumper = d > 2.4; o.plan = null; this.stats.openShot = (this.stats.openShot || 0) + 1; return;
    }
    // v0.4.7.5 quick patch: a lane that opens while he's probing gets attacked now, not at his next read
    if (o.next > 0 && d > 2 && d < 8.6 && this.driveLane(p, myDef, defs, rim, d, defDist)) { o.next = 0; o.target = null; this.stats.laneRead = (this.stats.laneRead || 0) + 1; }
    if (o.next > 0) {
      // keep probing toward the chosen spot (v0.4.7.5: a spot with space, away from the man, not a random one)
      if (o.target) {
        const left = this.seek(p, o.target.x, o.target.z, { sprint: o.target.burst || false, arrive: 0.8 });
        // (there: read the floor again now rather than standing on the spot)
        if (left < 0.6) { o.next = Math.min(o.next, 0.06); o.target = null; }
      }
      it.face = Math.atan2(rim.x - p.x, rim.z - p.z);
      if (p.ai_screen && p.ai_screen.until > g.time) { const s = g.players[p.ai_screen.by]; const away = Math.atan2(rim.x - s.x, rim.z - s.z); this.seek(p, s.x + Math.cos(away) * 1.2 * (p.x > s.x ? 1 : -1), s.z + side * 0.6, { sprint: true, arrive: 0.4 }); }
      return;
    }
    o.next = reactBase + g.rng.range(0, 0.18); // (v0.4.7.5 quick patch: 0.25 -> 0.18, a little less dead time between reads)
    // options
    const passTarget = this.bestPassTarget(p);
    let passVal = -1;
    if (passTarget) {
      const tsv = this.shotValue(passTarget, passTarget.x, passTarget.z, g.opponents(passTarget));
      // pass-first builds look for teammates; careful builds won't force a risky one
      passVal = tsv.val + (this.openness(passTarget) > 3 ? 0.25 : 0) - this.passRisk(p, passTarget) * (1.8 + T.safe * 1.0) * (0.45 + 0.75 * IQ) + (passTarget.human ? 0.15 : 0) + (passTarget.calling > 0 ? 0.3 : 0) - 0.25 + (T.pass - 0.5) * 0.8;
      const lp = g.lastPass;
      if (lp && lp.from === passTarget.id && g.time - lp.time < 3) passVal -= 0.6;
      // v0.4.5 quick patch: feed the man who's rolling (a takeover or on fire), more so the smarter the passer
      passVal += IQ * ((passTarget.takeover?.active ? 0.35 : 0) + (passTarget.hot ? 0.2 : 0) - (passTarget.stamina < 0.3 ? 0.15 : 0));
      // v0.4.7.5: a teammate wide open in his range is the read
      if (this.openness(passTarget) > 3.4 && tsv.val > 0.9) passVal += 0.25 * IQ;
      // v0.4.5: don't pass a good look to get a worse one
      const own = this.shotValue(p, p.x, p.z, defs).val * (1 - 0.5 * Math.min(1, this.estimateContest(p, defs, rim)));
      passVal -= Math.max(0, own - tsv.val) * (0.4 + 0.5 * IQ);
    }
    // blow-by: my defender is not squarely between me and the rim, or is off balance
    let laneOpen = false;
    if (myDef && d > 2) {
      laneOpen = this.driveLane(p, myDef, defs, rim, d, defDist);
      const offBalance = myDef.action?.type === 'stumble' || myDef.action?.type === 'steal' || myDef.airborne || myDef.bumpT > 0 || myDef.plantT > 0;
      if (!laneOpen && offBalance) laneOpen = g.rng.next() < 0.5;
    }
    const finisher = n(p.ratings.layup) * 0.5 + n(p.ratings.driving_dunk) * 0.4;
    // a rim protector waiting in the lane makes drives less attractive
    const anchor = defs.reduce((m, q) => q !== myDef && hyp(q.x - rim.x, q.z - rim.z) < 3 ? Math.max(m, n(q.ratings.interior_d) * 0.6 + n(q.ratings.block) * 0.4) : m, 0);
    let driveVal = laneOpen ? 1.15 + finisher + T.drive * 0.8 - anchor * 0.2 - Math.max(0, d - 8) * 0.1 : (defDist > 1.0 && d < 9 ? 0.3 + T.drive * 1.0 + finisher * 0.5 - (myDef ? n(myDef.ratings.perimeter_d) * 0.55 : 0) - anchor * 0.15 : 0.1);
    const estC = estC0;
    let shootVal = sv.val * (1 - 0.5 * Math.min(1, estC)) + (estC < 0.3 ? 0.3 : estC > 0.6 ? -0.5 * (0.3 + IQ) : 0) + (T.shoot - 0.5) * 0.7 + 0.1 - (g.shotClock > 16 ? 0.15 : 0);
    // v0.4.7.5: open is open: a clean look in range is worth a lot more to a smart shooter
    if (estC < 0.25 && sv.val > 0.95) shootVal += 0.2 + 0.3 * IQ;
    // v0.4.5 quick patch: better shots. A shot that's going to be smothered has no green window (next to no chance
    // now), so a smart shooter passes it up; a takeover or a hot hand is a reason to look for your own; tired legs
    // are a reason not to force a drive or a contested pull-up
    const to = p.takeover?.active ? p.takeover.kind : null;
    if (estC > 0.5) shootVal -= IQ * (estC - 0.5) * 2.2;
    if (to === 'shooting' || p.hot) shootVal += 0.25 * (0.5 + IQ);
    const tired = Math.max(0, 0.5 - p.stamina);
    shootVal -= IQ * tired * estC * 1.2;
    driveVal += (to === 'finishing' ? 0.3 * (0.5 + IQ) : 0) - IQ * tired * 1.4;
    // post scorers back down toward the block from the mid-post
    const postVal = T.post > 0.4 && myDef && d < 6.8 && d > 2.6 && !sv.three ? 0.25 + T.post * 0.9 + n(p.ratings.post_control) * 0.45 + (p.phys.strength - myDef.phys.strength) * 0.6 - n(myDef.ratings.interior_d) * 0.3 : -9;
    // v0.4.7.5: escape dribble. A shooter crowded inside his range makes the space himself (a stepback, a sidestep or
    // a retreat dribble) and gets the shot off the next read
    const handle = n(p.ratings.ball_handle);
    const escapeVal = myDef && defDist < 1.25 && sv.val > 0.78 && estC > 0.35 && p.cool.move <= 0 && d > 3 && d < 8.6 ? 0.35 + (sv.val - 0.78) * 2 + IQ * 0.45 + handle * 0.3 + (T.shoot - 0.5) * 0.5 : -9;
    // v0.4.7.5: a screen: smart handlers call for one when they're locked up and there's a teammate to set it
    const screener = g.mates(p).filter(m => !m.human && m.action?.type !== 'stumble' && !this.m(m).plan).sort((a, b) => a.dist(p) - b.dist(p))[0];
    const screenVal = screener && myDef && defDist < 1.6 && !laneOpen && o.screenAsk !== true ? 0.35 + IQ * 0.55 + (n(myDef.ratings.perimeter_d) - 0.5) * 0.5 - Math.max(0, screener.dist(p) - 6) * 0.08 : -9;
    // v0.4.4: low-IQ players misjudge their options (bad shots, forced passes); high-IQ ones rarely do
    const noise = 0.06 + (1 - IQ) * 0.3; // v0.4.5: fewer head-scratchers
    const rnd = () => g.rng.range(-noise, noise);
    // v0.4.7.5 less dead dribbling: probing is worth less, and less again the longer he's had it without doing
    // anything with it
    const stall = Math.max(0, o.ballT - (1.2 + (1 - IQ) * 1.6));
    const choices = [
      ['shoot', shootVal + rnd()],
      ['drive', driveVal + rnd() + stall * 0.25],
      ['pass', passVal + rnd() - 0.05 + stall * 0.45],
      ['probe', 0.6 + (T.dribble - 0.5) * 0.45 + (g.shotClock > 14 ? 0.15 : -0.4) - stall * 0.6 + rnd()],
      ['post', postVal + rnd()],
      ['escape', escapeVal + rnd()],
      ['screen', screenVal + rnd() + stall * 0.3],
    ];
    if (d > 8.4) choices[0][1] -= 2;
    choices.sort((a, b) => b[1] - a[1]);
    const pick = choices[0][0];
    if (pick === 'shoot' && ((sv.val > 0.9 - (1 - IQ) * 0.25 && estC < (sv.three ? 0.45 : 0.55) + (T.shoot - 0.5) * 0.08 + bk(p.badges, 'deadeye') * 0.03 + (1 - IQ) * 0.2) || g.shotClock < 5)) { it.shoot = 'press'; const k = g.shotClock < 5 ? 'lateClock' : 'chosen'; this.stats[k] = (this.stats[k] || 0) + 1; return; }
    if (pick === 'drive') { o.plan = 'drive'; this.stats.drives = (this.stats.drives || 0) + 1; this.seek(p, rim.x, rim.z, { sprint: true }); return; }
    if (pick === 'post') { o.plan = 'post'; o.postT = 2.6; o.postSide = p.x >= 0 ? 1 : -1; this.stats.posts = (this.stats.posts || 0) + 1; return; }
    if (pick === 'pass' && passTarget) {
      const lob = passTarget.position === 'C' || passTarget.position === 'PF';
      // (v0.4.7.5 qp3: the human can be thrown an alley too; he has to hit the button in the air, game.oopQte)
      const oop = hyp(passTarget.x - rim.x, passTarget.z - rim.z) < 5.5 && g.oopReachable(p, passTarget) && this.openness(passTarget) > 1.6 && (passTarget.human || ((passTarget.ratings.driving_dunk ?? 0) > 70 && passTarget.phys.reach + passTarget.phys.vertical > 3.3)) && g.rng.next() < RUNNER.setOop;
      const bounce = !oop && this.passRisk(p, passTarget) > 0.25 && hyp(passTarget.x - p.x, passTarget.z - p.z) < 7;
      it.pass = { target: passTarget.id, type: oop ? 'alley' : bounce ? 'bounce' : 'chest' };
      return;
    }
    if (pick === 'escape') {
      it.move = pickMove(p, g.rng, IQ, SITU.escape);
      if (it.move === 'sidestep') { const lx = Math.cos(p.facing), lz = -Math.sin(p.facing), dir = p.dribble.hand === 'R' ? -1 : 1; it.mx = lx * dir; it.mz = lz * dir; }
      o.next = 0.05; // read again right after: the space is there to shoot
      this.stats.escape = (this.stats.escape || 0) + 1;
      return;
    }
    if (pick === 'screen' && screener) {
      const mm = this.m(screener); mm.plan = 'screen'; mm.screenFor = p.id; mm.screenT = 3.2; o.screenAsk = true; o.next = 0.5;
      this.stats.screenCall = (this.stats.screenCall || 0) + 1;
      // set him up: a step or two away from the screen side so the defender gets caught on it
      o.target = { x: p.x + (screener.x > p.x ? -0.8 : 0.8), z: p.z };
      return;
    }
    // probe: dribble move or reposition, call a screen. Ball-dominant builds work the defender; bigs with
    // a loose handle don't dribble into traffic.
    const legs = 1 - IQ * Math.max(0, 0.45 - p.stamina) * 1.6; // (tired and smart: fewer moves)
    if (defDist < 1.7 && p.cool.move <= 0 && (handle > 0.42 || T.dribble > 0.6) && g.rng.next() < (0.3 + handle * 0.3) * (0.5 + 0.7 * T.dribble) * legs) {
      const shooter = n(p.ratings.mid_range) > 0.5;
      const w = { ...SITU.probe, stepback: shooter ? 0.14 : 0, sidestep: shooter ? 0.1 : 0, spin: shooter ? 0.14 : 0.28 };
      // a defender on his heels (backpedalling, off balance): attack moves
      const heels = myDef && (myDef.plantT > 0 || myDef.bumpT > 0 || ((myDef.vx * (p.x - myDef.x) + myDef.vz * (p.z - myDef.z)) < -1));
      it.move = pickMove(p, g.rng, IQ, heels ? SITU.attack : w);
      if (['cross', 'btb', 'btl', 'hang', 'wrap', 'pushcross'].includes(it.move)) {
        // cross toward open side
        const lx = Math.cos(p.facing), lz = -Math.sin(p.facing);
        const dir = p.dribble.hand === 'R' ? 1 : -1;
        it.mx = lx * dir; it.mz = lz * dir;
      }
      return;
    }
    // v0.4.7.5: reposition with purpose: toward the spot nearby with the most room and the best look, away from the
    // man (not a random spot on the perimeter), and briskly
    let best = null, bv = -1e9;
    for (let k = 0; k < 8; k++) {
      const ang = k * Math.PI / 4, r = 2.2;
      let [tx, tz] = this.clampCourt(p.x + Math.sin(ang) * r, p.z + Math.cos(ang) * r, g.half);
      if (g.half && (tz - rim.z) * side > -0.6) continue;
      let room = 9; for (const q of defs) room = Math.min(room, hyp(q.x - tx, q.z - tz));
      const look = this.shotValue(p, tx, tz, defs).val;
      const v = Math.min(3.5, room) * 0.5 + look * (0.6 + 0.6 * T.shoot) - (myDef ? Math.max(0, 2 - hyp(myDef.x - tx, myDef.z - tz)) * 0.4 : 0) + g.rng.range(0, 0.25);
      if (v > bv) { bv = v; best = { x: tx, z: tz, burst: room > 2.5 }; }
    }
    o.target = best || (() => { const spots = spotsFor(g.teams[p.team].length, side, this.variant[p.team]); const sp = spots[g.rng.int(0, spots.length - 1)]; return { x: sp.x, z: sp.z }; })();
    // ask a big for a screen sometimes (v0.4.7.5: the smarter he is, the more often)
    if (g.rng.next() < 0.3 + 0.3 * IQ) {
      const big = g.mates(p).filter(m => (m.position === 'C' || m.position === 'PF' || this.tend(m).pop > 0.5) && !m.human && !this.m(m).plan).sort((a, b) => a.dist(p) - b.dist(p))[0];
      if (big) { this.m(big).plan = 'screen'; this.m(big).screenFor = p.id; this.m(big).screenT = 3.2; }
    }
  }

  offBall(p, dt) {
    const g = this.g, o = this.m(p), it = p.intent;
    const side = g.sideFor(p.team), rim = rimOf(side);
    const h = g.holder();
    const team = g.teams[p.team];
    const idx = team.indexOf(p);
    // transition: run to frontcourt
    if (!g.half && h && (h.z * side) < 1) {
      const spots = spotsFor(team.length, side, this.variant[p.team]);
      const s = spots[idx % spots.length];
      this.seek(p, s.x, s.z, { sprint: true });
      return;
    }
    // oop runner keeps going
    if (p.action?.type === 'oop') return;
    // v0.4.7.5 qp3: a man running free at the rim on the break asks for the ball (the human handler sees the call)
    if (!g.half && h && h !== p && h.human) {
      const dr = hyp(rim.x - p.x, rim.z - p.z), ahead = (p.z - h.z) * side;
      if (ahead > 2.5 && dr < RUNNER.maxRim && this.openness(p) > RUNNER.open) it.call = true;
    }
    // v0.4.7.5 anti cherry-pick: someone on the other team is hanging back by his basket instead of defending. A
    // smart team keeps a safety home: between him and the rim, shaded toward the ball to pick off the outlet
    const lurk = this.lurker(p.team);
    if (lurk && this.safetyFor(p.team, lurk) === p) {
      const rD = rimOf(g.sideFor(lurk.team)), bx = g.ball.x - lurk.x, bz = g.ball.z - lurk.z, bl = hyp(bx, bz) || 1;
      const tx = lurk.x + (rD.x - lurk.x) * 0.3 + bx / bl * 1.3, tz = lurk.z + (rD.z - lurk.z) * 0.3 + bz / bl * 1.3;
      this.seek(p, tx, tz, { sprint: hyp(tx - p.x, tz - p.z) > 3, arrive: 0.6 });
      it.face = Math.atan2(g.ball.x - p.x, g.ball.z - p.z);
      this.stats.safety = (this.stats.safety || 0) + dt;
      return;
    }
    // v0.4.7.5: bigs (and smart players) come and set a screen on their own when the handler is locked up
    if (!o.plan && h && h !== p && !p.human) {
      const hd = g.opponents(h).reduce((a, q) => (!a || q.dist(h) < a.dist(h) ? q : a), null);
      const big = p.position === 'C' || p.position === 'PF' || this.tend(p).pop > 0.5;
      if (hd && hd.dist(h) < 1.4 && p.dist(h) < 7.5 && g.rng.next() < dt * (0.12 + 0.38 * this.iq(p)) * (big ? 1.4 : 0.6)) { o.plan = 'screen'; o.screenFor = h.id; o.screenT = 3; this.stats.screenSelf = (this.stats.screenSelf || 0) + 1; }
    }
    // screen plan
    if (o.plan === 'screen' && h && o.screenT > 0) {
      o.screenT -= dt;
      const hd = g.opponents(h).reduce((a, q) => (!a || q.dist(h) < a.dist(h) ? q : a), null);
      const sx = hd ? hd.x + (hd.x - rim.x) * 0.0 + (h.x - hd.x) * -0.15 : h.x, sz = hd ? hd.z + Math.sign(h.z - rim.z) * 0.0 - side * 0.55 : h.z;
      const dd = this.seek(p, sx + (h.x > 0 ? -0.6 : 0.6), sz, { sprint: true, arrive: 0.4 });
      if (dd < 0.7) { it.mx = 0; it.mz = 0; it.screen = true; h.ai_screen = { by: p.id, until: g.time + 0.8 };
        if (hd) it.face = Math.atan2(hd.x - p.x, hd.z - p.z); // (v0.4.7.5 qp3: chest to the defender; a square screen hits harder)
        if (h.dist(p) > 2.2 && o.screenT < 2.4) { const pop = g.rng.next() < this.tend(p).pop * (0.4 + 0.6 * n(p.ratings.three_point)); o.plan = pop ? 'pop' : 'roll'; o.rollT = pop ? 1.4 : 1.6; } }
      return;
    }
    if (o.plan === 'pop') {
      // v0.4.3: stretch bigs pop to the arc after the screen
      o.rollT -= dt;
      const dx = p.x - rim.x, dz = p.z - rim.z, dl = hyp(dx, dz) || 1;
      const [tx, tz] = this.clampCourt(rim.x + dx / dl * 7.6, rim.z + dz / dl * 7.6, g.half);
      this.seek(p, tx, tz, { sprint: true, arrive: 0.5 });
      it.face = h ? Math.atan2(h.x - p.x, h.z - p.z) : null;
      if (isThree(p.x, p.z, side) && this.openness(p) > 1.8) it.call = true;
      if (o.rollT <= 0) o.plan = null;
      return;
    }
    if (o.plan === 'roll') {
      o.rollT -= dt;
      this.seek(p, rim.x + (p.x > 0 ? 1.2 : -1.2), rim.z - side * 1.6, { sprint: true });
      if (this.openness(p) > 1.6) it.call = true;
      if (o.rollT <= 0) o.plan = null;
      return;
    }
    if (o.plan === 'cut') {
      o.cutT -= dt;
      this.seek(p, rim.x + (p.x > 0 ? 0.8 : -0.8), rim.z - side * 1.2, { sprint: true });
      if (this.openness(p) > 1.5) it.call = true;
      if (o.cutT <= 0) o.plan = null;
      return;
    }
    // base spacing spot (avoid the handler's area)
    const spots = spotsFor(team.length, side, this.variant[p.team]);
    let s = spots[idx % spots.length];
    if (h && hyp(s.x - h.x, s.z - h.z) < 3) {
      const free = spots.filter(q => hyp(q.x - h.x, q.z - h.z) > 3.2 && !team.some(m => m !== p && m !== h && hyp(m.x - q.x, m.z - q.z) < 1.5));
      if (free.length) s = free[0];
    }
    const T = this.tend(p);
    // v0.4.3: shooters relocate to the most open arc spot
    if (T.spot > 0.6 && h && h !== p) {
      if (!o.arc || g.time > o.arcT) {
        let best = null, bv = -1e9;
        for (const name of ARC_SPOTS) {
          const q = spot(name, side);
          if (hyp(q.x - h.x, q.z - h.z) < 3.2 || team.some(m => m !== p && hyp(m.x - q.x, m.z - q.z) < 2)) continue;
          let close = 9; for (const dq of g.opponents(p)) close = Math.min(close, hyp(dq.x - q.x, dq.z - q.z));
          const v = Math.min(5, close) - hyp(q.x - p.x, q.z - p.z) * 0.12 + (name.startsWith('corner') && p.badges.corner_specialist ? 0.6 : 0);
          if (v > bv) { bv = v; best = q; }
        }
        o.arc = best; o.arcT = g.time + 1.4 + g.rng.range(0, 0.8);
      }
      if (o.arc && g.rng.next() < 0.6 + 0.4 * T.spot) s = o.arc;
    } else if (o.arc && g.time < o.arcT) s = o.arc; // (v0.4.7.5: a relocation, see below)
    // handler driving: drift to corners / dunker spot
    if (h && this.m(h).plan === 'drive') {
      const corner = { x: (p.x >= 0 ? 1 : -1) * 6.6, z: side * (COURT.hoopZ - 0.4) };
      if ((p.position === 'C' || p.position === 'PF') && T.spot < 0.6 || T.crash > 0.8) { s = { x: (p.x >= 0 ? 1 : -1) * 2.9, z: side * (COURT.hoopZ + 0.3) }; } else s = corner;
    }
    this.seek(p, s.x + Math.sin(g.time * 0.7 + p.id) * 0.5, s.z + Math.cos(g.time * 0.5 + p.id * 2) * 0.4, { sprint: false, arrive: 1.0 });
    it.face = h ? Math.atan2(h.x - p.x, h.z - p.z) : null;
    // occasional backdoor cut when overplayed / ball-watching defender
    o.next -= dt;
    if (o.next <= 0) {
      o.next = 0.6 + g.rng.range(0, 0.6);
      const md = g.opponents(p).reduce((a, q) => (!a || q.dist(p) < a.dist(p) ? q : a), null);
      const IQ = this.iq(p);
      if (md && h && h !== p) {
        const denying = md.dist(p) < 1.2;
        // slashers live on cuts; spot-up shooters mostly stay home
        let cut = denying ? g.rng.next() < 0.35 + 0.65 * T.cut : g.rng.next() < 0.02 + 0.16 * T.cut;
        // v0.4.7.5: run into an open lane: the way to the rim is clear and his man is ball-watching or sagging off
        const dR = hyp(p.x - rim.x, p.z - rim.z);
        const watching = (Math.sin(md.facing) * (p.x - md.x) + Math.cos(md.facing) * (p.z - md.z)) < 0;
        if (!cut && dR > 4 && dR < 9.5 && (watching || md.dist(p) > 2.4) && this.laneOpen(p, rim.x, rim.z, 1.0)) cut = g.rng.next() < 0.2 + 0.55 * IQ * (0.5 + T.cut);
        if (cut && (p.position !== 'C' || T.cut > 0.45) && dR > 4) { o.plan = 'cut'; o.cutT = 1.5; this.stats.cuts = (this.stats.cuts || 0) + 1; }
        // v0.4.7.5: smothered off the ball: relocate to the most open spot on the floor (everyone, the smarter the more)
        if (!cut && this.openness(p) < 1.4 && T.spot <= 0.6 && g.rng.next() < 0.25 + 0.5 * IQ) {
          let best = null, bv = -1e9;
          for (const name of ARC_SPOTS) {
            const q = spot(name, side);
            if (hyp(q.x - h.x, q.z - h.z) < 3.2 || team.some(m => m !== p && hyp(m.x - q.x, m.z - q.z) < 2)) continue;
            let close = 9; for (const dq of g.opponents(p)) close = Math.min(close, hyp(dq.x - q.x, dq.z - q.z));
            const v = Math.min(5, close) - hyp(q.x - p.x, q.z - p.z) * 0.12;
            if (v > bv) { bv = v; best = q; }
          }
          if (best) { o.arc = best; o.arcT = g.time + 1.6; }
        }
      }
      if (this.openness(p) > 3 && isThree(p.x, p.z, side) && n(p.ratings.three_point) > 0.55) it.call = true;
      // pass-first ball handlers want it back
      else if (h && h !== p && T.dribble > 0.8 && this.tend(h).dribble < 0.6 && this.openness(p) > 2.2 && g.rng.next() < 0.35) it.call = true;
    }
  }

  startOop(r, T, ball) {
    const g = this.g;
    if (!g.isAI(r) && !(r.human)) return;
    // time jump so the apex meets the ball near T
    const flight = this.estimateArrival(ball, T);
    const reachNeed = T.y + 0.05 - r.phys.reach;
    const h = Math.max(0.3, Math.min(r.phys.vertical * 1.05, reachNeed + 0.1));
    const tUp = Math.sqrt(2 * h / GRAVITY);
    const jumpAt = Math.max(0.05, flight - tUp);
    r.action = null;
    // v0.4.5: he runs to a takeoff spot short of the rim first (game.drive), then rises for it
    r.startAction('oop', jumpAt + tUp * 2 + 0.2, { jumpAt, jumpH: h, tUp, T, spot: g.oopPoints(r).spot });
  }
  estimateArrival(ball, T) {
    // time when the lob is closest to T (simple ballistic)
    let x = ball.x, y = ball.y, z = ball.z, vx = ball.vx, vy = ball.vy, vz = ball.vz, best = 1, bd = 1e9;
    for (let t = 0; t < 2.5; t += 1 / 60) {
      vy -= GRAVITY / 60; x += vx / 60; y += vy / 60; z += vz / 60;
      const d = hyp(x - T.x, y - T.y, z - T.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  reactPumpFake(shooter) {
    const g = this.g;
    for (const d of g.opponents(shooter)) {
      if (!g.isAI(d) || d.dist(shooter) > 2.0 || d.airborne) continue;
      const bite = 0.62 - n(d.ratings.perimeter_d) * 0.3 - this.iq(d) * 0.3;
      if (g.rng.next() < bite) { d.action = null; d.startAction('block', 0.9, { jumpAt: 0.02, jumpH: d.phys.vertical * 0.9, jumped: false }); }
    }
  }

  meetPass(p, b) {
    // move to the closest point of the ball's path we can reach in time
    // (v0.4.7.5 quick patch: never by running out of bounds: a catch on or over a line is a turnover, so only the
    // part of the path that's in bounds is chased, and a pass heading out is met at the line, reaching for it)
    const g = this.g, inX = COURT.width / 2 - 0.45, inZ = COURT.length / 2 - 0.45;
    const inside = (x, z) => Math.abs(x) < inX && (g.half ? z > 0.3 && z < inZ : Math.abs(z) < inZ);
    let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz, best = null, bd = 1e9;
    const sp = p.phys.jog;
    for (let t = 0; t < 1.6; t += 1 / 30) {
      vy -= GRAVITY / 30; x += vx / 30; y += vy / 30; z += vz / 30;
      if (y < 0.2) { vy = -vy * 0.75; y = 0.2; }
      if (y > p.phys.reach + 0.1) continue;
      if (!inside(x, z)) continue;
      const need = Math.hypot(x - p.x, z - p.z) - 0.5;
      const slack = sp * t - need;
      if (slack >= 0) { best = { x, z }; break; }
      if (-slack < bd) { bd = -slack; best = { x, z }; }
    }
    if (!best) { const [cx, cz] = this.clampCourt(b.x + b.vx * 0.3, b.z + b.vz * 0.3, g.half); best = { x: cx, z: cz }; }
    this.seek(p, best.x, best.z, { sprint: Math.hypot(best.x - p.x, best.z - p.z) > 2, arrive: 0.45 });
    this.face(p, b.x, b.z);
  }

  // ---------- defense ----------
  defend(p, dt) {
    const g = this.g, o = this.m(p), it = p.intent;
    const side = g.sideFor(1 - p.team), rim = rimOf(side); // rim we protect
    const man = this.manOf(p);
    const h = g.holder();
    const skill = this.skill(p);
    if (p.action?.type === 'stumble') return;
    // v0.4.7.5 anti cherry-pick: a man hanging back by the rim we protect is picked up early by whoever is closest
    // (or was already the safety): between him and the rim, in the passing lane; a pass to him gets jumped
    const lurk = this.lurker(p.team);
    if (lurk && lurk !== h && this.guardFor(p.team, lurk) === p) {
      const b = g.ball;
      if (b.mode === 'flight' && b.kind === 'pass' && b.info?.to === lurk.id) { this.meetPass(p, b); return; }
      const bx = b.x - lurk.x, bz = b.z - lurk.z, bl = hyp(bx, bz) || 1;
      const tx = lurk.x + (rim.x - lurk.x) * 0.32 + bx / bl * 1.0, tz = lurk.z + (rim.z - lurk.z) * 0.32 + bz / bl * 1.0;
      this.seek(p, tx, tz, { sprint: hyp(tx - p.x, tz - p.z) > 1.5, arrive: 0.5 });
      this.face(p, b.x, b.z);
      return;
    }
    // transition defense: sprint back (v0.4.7.5 quick patch: the moment the ball changes hands, the outlet pass and a
    // loose ball included, not only once somebody's dribbling it up)
    const bz0 = h ? h.z : g.ball.z, theirs = h ? h.team !== p.team : g.possession !== p.team;
    if (!g.half && theirs && (p.z - rim.z) * side < -COURT.hoopZ - 2 + 14 && (bz0 * side) < 3 && (p.z * side) < (bz0 * side) - 1) {
      this.seek(p, rim.x * 0.5 + man.x * 0.3, rim.z - side * 4, { sprint: true });
      return;
    }
    // v0.4.7.5 quick patch: react to the pass, not the catch. When the ball is thrown to my man I close out on him
    // while it's in the air (the smarter, the sooner I read it), hands up as I get there; everyone else rotates to
    // where the ball is going rather than where it was
    const b = g.ball, passTo = b.mode === 'flight' && b.kind === 'pass' && b.info ? g.players[b.info.to] : null;
    const IQd0 = this.iq(p);
    if (passTo && passTo === man && passTo.team !== p.team && g.time - (g.lastPass?.time ?? -9) > 0.13 - 0.11 * IQd0) {
      const rx = rim.x - man.x, rz = rim.z - man.z, rl = hyp(rx, rz) || 1;
      const gap = rl > 9.5 ? 1.9 : 1.05 + (1 - n(man.ratings.three_point)) * 0.45;
      const tx = man.x + rx / rl * gap, tz = man.z + rz / rl * gap, far = hyp(tx - p.x, tz - p.z);
      this.seek(p, tx, tz, { sprint: far > 1.2, arrive: 0.5 });
      this.face(p, man.x, man.z);
      if (far < 2.2) it.handsUp = true;
      this.stats.closeout = (this.stats.closeout || 0) + dt;
      return;
    }
    const ballHandlerIsMan = h === man;
    let tx, tz;
    if (ballHandlerIsMan) {
      // (v0.4.7.5 quick patch: reads the handler a touch sooner, and sooner again on a dribble move)
      const seenM = this.seen(man, (0.22 - skill * 0.14) * (man.action?.type === 'move' ? 0.7 : 1));
      const dx = rim.x - seenM.x, dz = rim.z - seenM.z, dl = hyp(dx, dz) || 1;
      const threat = n(man.ratings.three_point);
      const T = this.tend(p);
      // lockdown builds press up; Perimeter D lets a defender play closer without getting blown by
      let gap = 1.05 + (1 - threat) * 0.6 - n(p.ratings.perimeter_d) * 0.25 - (T.press - 0.5) * 0.3;
      // v0.4.5 quick patch: a smart defender crowds a hot shooter or one in a shooting takeover, and sags off a
      // tired one who can't blow by him
      const dIQ = this.iq(p);
      if (man.hot || (man.takeover?.active && man.takeover.kind === 'shooting')) gap -= 0.25 * dIQ;
      if (man.stamina < 0.3) gap += 0.2 * dIQ;
      if (dl < 4) gap = 0.8;
      if (dl > 9.5) gap = 2.2;
      tx = seenM.x + dx / dl * gap; tz = seenM.z + dz / dl * gap;
      // anticipate the handler's movement (better defenders read it earlier)
      tx += seenM.vx * (0.08 + skill * 0.14); tz += seenM.vz * (0.08 + skill * 0.14);
      it.defense = true;
      this.face(p, man.x, man.z);
      // v0.4.7.5 quick patch: left a step behind (a move that made space, a blow-by): out of the stance and run to
      // recover instead of sliding after him
      if (hyp(tx - p.x, tz - p.z) > 1.5) { it.defense = false; o.recover = true; } else o.recover = false;
      // steal attempts
      o.next -= dt;
      if (o.next <= 0) {
        o.next = 0.35 + g.rng.range(0, 0.4);
        // v0.4.4: smart defenders wait for the exposed dribble (moves) and reach with the right hand; low-IQ
        // ones reach at random, often with the wrong hand (more fouls, fewer steals)
        const IQd = this.iq(p), moving = man.action?.type === 'move';
        const agg = (0.025 * (1.45 - IQd * 0.9) + n(p.ratings.steal) * 0.07 + (moving ? 0.02 + 0.05 * IQd : 0)) * (0.6 + 0.5 * T.press);
        // v0.4.7.5 quick patch: reach-ins are called on contact now, so a smart defender doesn't reach through the
        // handler's body or arm to a ball he's shielding (the dumber ones still do, and get called for it)
        let through = false;
        if (g.reachContact) {
          const f = Math.atan2(man.x - p.x, man.z - p.z), lx = Math.cos(f), lz = -Math.sin(f), b = g.ball;
          const pre = g.reachContact({ x: p.x, z: p.z, facing: f, phys: p.phys, action: { hand: (b.x - p.x) * lx + (b.z - p.z) * lz >= 0 ? 'L' : 'R' } }, man);
          through = pre.body && !pre.ballFirst;
        }
        if (p.dist(man) < 1.3 && p.cool.steal <= 0 && g.rng.next() < agg * (through ? 1 : 1.3) && !(through && g.rng.next() < 0.45 + 0.5 * IQd)) {
          it.steal = true;
          if (g.rng.next() < (1 - IQd) * 0.5) { const a = p.facing + (g.rng.next() < 0.5 ? 1 : -1) * Math.PI / 2; it.stealDir = { x: Math.sin(a), z: Math.cos(a) }; }
          it.stealLow = g.ball.mode === 'dribble' && g.ball.y < 0.7 && g.rng.next() < 0.3 + IQd * 0.5;
        }
      }
    } else {
      // help defense: handler beat his man?
      if (h && h.team !== p.team) {
        const hd = g.opponents(h).reduce((a, q) => (!a || q.dist(h) < a.dist(h) ? q : a), null);
        const hToRim = hyp(h.x - rim.x, h.z - rim.z);
        // (v0.4.7.5 quick patch: help comes earlier, and as soon as the lane to the rim is open, not only once his man
        // is behind him)
        const beaten = hd && hd !== p && hToRim < 7.2 && (hyp(hd.x - rim.x, hd.z - rim.z) > hToRim + 0.4 || (hToRim < 6.5 && this.laneOpen(h, rim.x, rim.z, 0.85)));
        const isHelper = beaten && this.closestHelper(h, rim) === p;
        const T = this.tend(p);
        if (isHelper && g.rng.next() < (0.6 + skill * 0.4) * (0.55 + 0.45 * T.help)) {
          // rim protectors meet the drive at the rim (verticality); others step up to stop the ball
          const dx = rim.x - h.x, dz = rim.z - h.z, dl = hyp(dx, dz) || 1;
          const prot = n(p.ratings.interior_d) * 0.6 + n(p.ratings.block) * 0.4;
          const stand = prot > 0.6 && T.help > 0.6 ? Math.max(0.7, Math.min(1.4, hToRim - 1.1)) : 1.0;
          tx = h.x + dx / dl * stand; tz = h.z + dz / dl * stand;
          it.defense = true; this.face(p, h.x, h.z);
          this.seek(p, tx, tz, { sprint: true, arrive: 0.4 });
          this.maybeContest(p, h, rim);
          return;
        }
      }
      // off-ball: between man and rim, shaded to ball. Paint anchors (glass cleaners, post bigs, stretch
      // bigs filling gaps) sag off non-shooters into the lane; everyone sags more off poor shooters.
      const bx = passTo ? passTo.x : g.ball.x, bz = passTo ? passTo.z : g.ball.z;
      const T = this.tend(p);
      const shooterThreat = n(man.ratings.three_point);
      let sag = 0.3 + (1 - shooterThreat) * 0.25 + T.help * 0.12 * (1 - shooterThreat);
      if (T.help > 0.7 && hyp(man.x - rim.x, man.z - rim.z) > 5.5 && shooterThreat < 0.6) sag = Math.max(sag, 0.45 + 0.12 * n(p.ratings.interior_d));
      tx = man.x + (rim.x - man.x) * sag + (bx - man.x) * 0.15;
      tz = man.z + (rim.z - man.z) * sag + (bz - man.z) * 0.15;
      if (p.dist(man) < 3) it.defense = p.speed < 3.5;
      this.face(p, (man.x + bx) / 2, (man.z + bz) / 2);
    }
    [tx, tz] = this.clampCourt(tx, tz, g.half);
    const urgent = hyp(tx - p.x, tz - p.z) > (ballHandlerIsMan && o.recover ? 1.5 : 2.2);
    this.seek(p, tx, tz, { sprint: urgent && !it.defense, arrive: 0.6 });
    if (it.defense && urgent) it.defense = false;
    if (h && h.team !== p.team) this.maybeContest(p, h, rim);
  }

  // v0.4.7.5 cherry-picking. lurker(team): one of `team`'s opponents hanging back near the basket his own team
  // attacks (the one `team` defends) while the ball is far away: 10+ m from it, within 9.5 m of that rim. On offense
  // that's a man not getting back on defense; on defense, a man who leaked out early. Full court only.
  lurker(team) {
    const g = this.g;
    if (g.half || g.phase !== 'live') return null;
    const b = g.ball, key = `${team}|${g.tick}`;
    if (this._lurkKey === key) return this._lurk;
    let best = null, bd = 9.5;
    for (const q of g.opponents(g.teams[team][0])) {
      if (b.holder === q.id) continue;
      const rq = rimOf(g.sideFor(q.team)), dr = hyp(q.x - rq.x, q.z - rq.z);
      if (dr < bd && hyp(q.x - b.x, q.z - b.z) > 10) { bd = dr; best = q; }
    }
    this._lurkKey = key; this._lurk = best;
    return best;
  }
  // the safety: on offense, the smart teammate (IQ 0.45+) best placed to stay home on a lurker; null if nobody fits
  safetyFor(team, lurk) {
    const g = this.g, h = g.holder();
    let best = null, bv = 1e9;
    for (const m of g.teams[team]) {
      if (m === h || m.human || this.iq(m) < 0.45) continue;
      const v = hyp(m.x - lurk.x, m.z - lurk.z) - this.iq(m) * 4 - n(m.ratings.perimeter_d) * 1.5;
      if (v < bv) { bv = v; best = m; }
    }
    return g.teams[team].length >= 3 ? best : null;
  }
  // on defense: whoever is closest to the lurker picks him up (if smart enough to see it)
  guardFor(team, lurk) {
    const g = this.g;
    let best = null, bd = 1e9;
    for (const m of g.teams[team]) { if (!g.isAI(m)) continue; const d = hyp(m.x - lurk.x, m.z - lurk.z); if (d < bd) { bd = d; best = m; } }
    return best && this.iq(best) >= 0.4 ? best : null;
  }

  // v0.4.3: the help defender: whoever is nearest the drive line, with rim protectors and help-first builds
  // preferred (they count as up to ~2 m closer)
  closestHelper(h, rim) {
    let best = null, bd = 1e9;
    for (const q of this.g.opponents(h)) {
      const d = hyp(q.x - (h.x + rim.x) / 2, q.z - (h.z + rim.z) / 2) - this.tend(q).help * 1.0 - n(q.ratings.interior_d) * 0.9;
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  maybeContest(p, h, rim) {
    const g = this.g, o = this.m(p), it = p.intent;
    const a = h.action;
    if (!a || p.airborne) return;
    const d = p.dist(h);
    if (a.type === 'shoot' && !a.released) {
      if (d < 2.3) it.handsUp = true;
      // jump to contest near release time
      if (d < 1.6 && p.cool.block <= 0) {
        const tUp = Math.sqrt(2 * p.phys.vertical * 0.9 / GRAVITY);
        const want = (a.releaseAt ?? a.tRel) - tUp * 0.9;
        const err = g.rng.normal() * (0.12 - this.skill(p) * 0.05 - n(p.ratings.block) * 0.04);
        if (a.t >= want + err) { if (!(p.human && g.assist && p.profile) || g.rng.next() < 0.35 + 0.65 * p.profile.tend.help) it.jump = true; p.cool.block = 1.0; }
      }
    } else if ((a.type === 'layup' || a.type === 'dunk') && !a.released && !a.slammed) {
      const toRim = hyp(p.x - rim.x, p.z - rim.z);
      // rim protectors challenge from further away and time it better
      const idk = n(p.ratings.interior_d), bk = n(p.ratings.block);
      if (d < 2.3 + 0.4 * idk && toRim < 3.0 + 0.6 * idk && p.cool.block <= 0) {
        const tUp = Math.sqrt(2 * p.phys.vertical * 0.95 / GRAVITY);
        const rel = a.type === 'layup' ? a.release : a.slam;
        if (a.t >= rel - tUp - 0.05 + g.rng.normal() * (0.11 - this.skill(p) * 0.045 - bk * 0.03)) { it.jump = true; p.cool.block = 1.2; }
      } else if (d < 2.6 + 0.4 * idk) it.handsUp = true;
    }
  }

  // ---------- rebounds / loose balls ----------
  rebound(p, dt, loose) {
    const g = this.g, b = g.ball, it = p.intent;
    // predict where the ball comes down to ~2.6m
    const land = this.predictLanding(b, 2.4);
    [land.x, land.z] = this.clampCourt(land.x, land.z, g.half);
    const myTeamShot = b.info && b.info.team === p.team;
    const rim = b.info ? rimOf(b.info.side ?? g.sideFor(b.info.team)) : rimOf(g.sideFor(p.team));
    const toBall = hyp(land.x - p.x, land.z - p.z);
    const T = this.tend(p);
    const big = T.crash > 0.55 || ((p.position === 'C' || p.position === 'PF') && T.crash > 0.4);
    // v0.4.1: defenders hold their box-out until the ball comes off the iron; shooters' teammates only
    // crash with their bigs (and whoever is already close), the rest get back
    if (!loose && b.kind === 'shot' && !b.touchedRim && !b.touchedBoard && (b.flightTime < 1.6 || !myTeamShot)) {
      // box out: get between man and the rim
      if (!myTeamShot) {
        const man = this.manOf(p);
        const dx = rim.x - man.x, dz = rim.z - man.z, dl = hyp(dx, dz) || 1;
        const tight = 0.62 - 0.22 * n(p.ratings.interior_d); // better interior defenders seal closer
        this.seek(p, man.x + dx / dl * tight, man.z + dz / dl * tight, { sprint: false, arrive: 0.3 });
        this.face(p, rim.x, rim.z);
      } else if (big || hyp(p.x - rim.x, p.z - rim.z) < 3) {
        this.seek(p, rim.x + (p.x - rim.x) * 0.4, rim.z + (p.z - rim.z) * 0.4, { sprint: true });
      } else if (!g.half) {
        // guards get back in transition
        const back = -g.sideFor(p.team);
        this.seek(p, p.x * 0.5, back * 4, { sprint: false });
      }
      return;
    }
    // crash toward the landing spot if among the closest of the team
    const team = g.teams[p.team];
    const order = [...team].sort((a, c) => hyp(land.x - a.x, land.z - a.z) - hyp(land.x - c.x, land.z - c.z));
    const rank = order.indexOf(p);
    if (rank <= (big || !myTeamShot ? 2 : 1) || toBall < 3.5 || (T.crash > 0.85 && toBall < 6.5) || loose && b.y < 1.2) {
      this.seek(p, land.x, land.z, { sprint: true, arrive: 0.3 });
      // jump timing for rebounds: go up so the hands meet the ball near the top of the jump
      const reach = p.phys.reach + p.phys.vertical * 0.8;
      const tUp = Math.sqrt(2 * p.phys.vertical * 0.8 / GRAVITY);
      const yAt = b.y + b.vy * tUp - 0.5 * GRAVITY * tUp * tUp;
      if (toBall < 1.3 && b.vy < 1 && yAt < reach + 0.25 && yAt > p.phys.reach - 0.15 && !p.airborne && !p.action) it.jump = true;
    } else {
      const s = spotsFor(team.length, g.sideFor(p.team), 0)[team.indexOf(p) % team.length];
      this.seek(p, s.x * 0.6, s.z * 0.8, { sprint: false });
    }
  }

  // v0.4.1: where the ball will come down to height h, simulated with the real ball physics (rim and glass
  // bounces included) instead of a plain parabola; cached per simulation tick.
  predictLanding(b, h) {
    if (b.mode !== 'flight') return { x: b.x, z: b.z };
    const t = this.g.time, c0 = this._land;
    if (c0 && c0.t === t && c0.h === h) return { x: c0.x, z: c0.z };
    const c = cloneBall(b);
    let x = c.x, z = c.z;
    for (let k = 0; k < 75; k++) {
      c.step(1 / 30, null);
      x = c.x; z = c.z;
      if (c.vy < 0 && c.y < h && c.y < COURT.rimY - 0.1) break;
      if (c.y < 0.3) break;
    }
    this._land = { t, h, x, z };
    return { x, z };
  }

  // ---------- dead balls / inbounds / ft ----------
  deadBallMove(p, dt) {
    const g = this.g;
    p.intent.mx *= 0; p.intent.mz *= 0;
    if (g.over) return;
    // drift back toward own spots slowly
    const side = g.sideFor(g.possession);
    const team = g.teams[p.team];
    const s = spotsFor(team.length, side, 0)[team.indexOf(p) % team.length];
    if (p.team === g.possession) this.seek(p, s.x, s.z, { sprint: false, arrive: 2 });
    else this.seek(p, s.x * 0.7, s.z + side * 1.5, { sprint: false, arrive: 2 });
    p.intent.mx *= 0.5; p.intent.mz *= 0.5;
  }

  inboundMove(p, dt) {
    const g = this.g;
    const inb = g.inbounder;
    if (p === inb) { this.face(p, 0, p.z * 0.5); return; }
    if (p.team === g.possession) {
      // guards come toward the ball to receive
      const team = g.teams[p.team];
      const i = team.indexOf(p);
      const tx = inb.x * 0.35 + (i % 2 ? 2.5 : -2.5), tz = inb.z - Math.sign(inb.z || 1) * (2.5 + (i % 3) * 1.8);
      this.seek(p, tx, tz, { sprint: false, arrive: 0.8 });
      this.face(p, inb.x, inb.z);
    } else {
      const man = this.manOf(p);
      this.seek(p, man.x + (inb.x - man.x) * 0.2, man.z + (inb.z - man.z) * 0.2, { arrive: 0.6 });
      p.intent.defense = true;
      this.face(p, man.x, man.z);
    }
  }

  ftLane(p) { p.intent.mx = 0; p.intent.mz = 0; }

  practiceDefender(p, dt) {
    const g = this.g, h = g.holder();
    if (!h || h.team === p.team) { p.intent.mx = 0; p.intent.mz = 0; return; }
    const rim = rimOf(1);
    const dx = rim.x - h.x, dz = rim.z - h.z, dl = hyp(dx, dz) || 1;
    this.seek(p, h.x + dx / dl * 1.4, h.z + dz / dl * 1.4, { arrive: 0.5 });
    p.intent.defense = true; this.face(p, h.x, h.z);
    this.maybeContest(p, h, rim);
  }

  humanAssistHints(p) { /* human controlled: nothing */ }
}
