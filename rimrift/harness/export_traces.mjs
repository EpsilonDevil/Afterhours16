// RIMRIFT parity harness — JS side. Runs the reference JS sim (client/js, read-only) under Node and writes bit-exact
// traces for the C# replay (Rimrift.Harness):
//   node harness/export_traces.mjs            → harness/out/traces.jsonl (+ summary.json): 1,000 pre-simulated shots
//   node harness/export_traces.mjs --math     → harness/out/math.jsonl: Math.* function samples (sin/cos/tan/exp/log/pow/hypot)
// Every double is written as its 64-bit pattern (16 hex digits), never as decimal text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ball } from '../../client/js/sim/ball.js';
import { planShot } from '../../client/js/sim/shots.js';
import { COURT, BALL_R, DT, rimPos } from '../../client/js/sim/constants.js';
import { RNG } from '../../client/js/core/rng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const dv = new DataView(new ArrayBuffer(8));
const hex = v => { dv.setFloat64(0, v); return dv.getBigUint64(0).toString(16).padStart(16, '0'); };

// ---------------------------------------------------------------------------------------------------------------
// End of a shot's flight, mirrored in Rimrift.Harness (Replay.FlightEnded): 10 s of flight, or the ball at rest on
// the floor (game.js's dead-ball condition), or long gone off the court, or a pile of floor bounces (settled/rolling).
export const MAX_TICKS = 600;
export function flightEnded(b, ticks) {
  if (ticks >= MAX_TICKS) return true;
  if (b.vy === 0 && b.y <= BALL_R + 0.001 && Math.hypot(b.vx, b.vz) < 0.05) return true;
  if (Math.abs(b.x) > 12 || Math.abs(b.z) > 20) return true;
  if (b.floorBounces >= 40) return true;
  return false;
}

// The shot mix game.js produces (releaseShot / releaseLayup / free throws): jumpers from mid-range and three (some
// deep), close shots (arc 58, bank allowed off-centre), layups (arc 64, spin halved, bank when |x| > 0.8), free throws
// (arc 54), from both ends, half-court (park) and full-court, wood and blacktop, made and missed, swish/guarantee
// and 'bad' misses.
function genShot(i) {
  const seed = 1000 + i;
  const rng = new RNG(seed);
  const side = rng.next() < 0.5 ? 1 : -1;
  const rim = rimPos(side);
  const halfOnly = side === 1 && rng.next() < 0.5; // park: only the +z hoop exists
  const surface = rng.next() < 0.75 ? 'wood' : 'blacktop';
  const u = rng.next();
  let kind, d, ang, arc, P, opts, y;
  const make = rng.next() < 0.5;
  const excellent = make && rng.next() < 0.4;
  if (u < 0.45) { // jumper (mid / three / deep)
    kind = 'jumper';
    const r = rng.next();
    d = r < 0.4 ? 2.6 + rng.next() * 4.4 : r < 0.9 ? 6.8 + rng.next() * 2.4 : 9.2 + rng.next() * 3.4;
    ang = (rng.next() - 0.5) * Math.PI * 0.95;
    arc = [49, 52, 56][Math.floor(rng.next() * 3)];
    y = 2.35 + rng.next() * 0.6;
    opts = { halfOnly, surface, swish: excellent, guarantee: excellent, bad: !make && rng.next() < 0.3, bank: false };
  } else if (u < 0.62) { // close shot
    kind = 'close';
    d = 0.6 + rng.next() * 1.3;
    ang = (rng.next() - 0.5) * Math.PI * 1.2;
    arc = 58; y = 2.2 + rng.next() * 0.6;
    opts = { halfOnly, surface, swish: excellent, guarantee: excellent, bad: !make && rng.next() < 0.3, bank: rng.next() < 0.7 };
  } else if (u < 0.88) { // layup
    kind = 'layup';
    d = 0.7 + rng.next() * 1.9;
    ang = (rng.next() - 0.5) * Math.PI * 1.3;
    arc = 64; y = 2.4 + rng.next() * 0.7;
    opts = { halfOnly, surface, bank: true, guarantee: excellent };
  } else { // free throw
    kind = 'ft';
    d = 4.19 + (rng.next() - 0.5) * 0.1; ang = (rng.next() - 0.5) * 0.05;
    arc = 54; y = 2.3 + rng.next() * 0.4;
    opts = { halfOnly, surface, swish: excellent, guarantee: excellent };
  }
  P = { x: rim.x + Math.sin(ang) * d, y, z: rim.z - side * Math.cos(ang) * d };
  if (kind === 'layup') opts.bank = Math.abs(P.x) > 0.8; // (game.js releaseLayup)
  const rngBefore = hex(rng.s);
  const plan = planShot(rng, P, rim, side, make, arc, opts);
  const rngAfter = hex(rng.s);
  const b = new Ball();
  b.halfOnly = !!opts.halfOnly; b.surface = opts.surface;
  b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, 'shot', null);
  b.wx = plan.wx; b.wy = plan.wy; b.wz = plan.wz;
  if (kind === 'layup') { b.wx = plan.wx * 0.5; b.wz = plan.wz * 0.5; }
  b.ghost = !!plan.ghost;
  const launch = snap(b);
  const ticks = [];
  let n = 0;
  while (!flightEnded(b, n)) {
    const ev = [];
    b.step(DT, ev);
    n++;
    ticks.push({ s: snap(b), e: ev.map(evHex), f: [b.touchedRim ? 1 : 0, b.touchedBoard ? 1 : 0, b.scoredFlag, b.floorBounces, b.netTouched ? 1 : 0] });
  }
  return {
    seed, kind, side, halfOnly, surface, arc, make,
    P: [hex(P.x), hex(P.y), hex(P.z)], rim: [hex(rim.x), hex(rim.y), hex(rim.z)],
    opts: { halfOnly: !!opts.halfOnly, surface: opts.surface, swish: !!opts.swish, guarantee: !!opts.guarantee, bad: !!opts.bad, bank: !!opts.bank },
    rngBefore, rngAfter,
    plan: { v: [hex(plan.vx), hex(plan.vy), hex(plan.vz), hex(plan.wx), hex(plan.wy), hex(plan.wz)], made: !!plan.made, bank: plan.bank === undefined ? null : !!plan.bank, rim: plan.rim === undefined ? null : !!plan.rim, ghost: !!plan.ghost },
    launch, ticks,
    end: { touchedRim: b.touchedRim, touchedBoard: b.touchedBoard, scoredFlag: b.scoredFlag, floorBounces: b.floorBounces, ticks: n },
  };
}
function snap(b) { return [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.wx, b.wy, b.wz].map(hex); }
function evHex(e) {
  const o = { t: e.type };
  if (e.side !== undefined) o.side = e.side;
  if (e.clean !== undefined) o.clean = !!e.clean;
  if (e.rim !== undefined) o.rim = !!e.rim;
  for (const k of ['v', 'x', 'y', 'z']) if (e[k] !== undefined) o[k] = hex(e[k]);
  return o;
}

function exportTraces(count = 1000) {
  const file = path.join(outDir, 'traces.jsonl');
  const fd = fs.openSync(file, 'w');
  const sum = { shots: 0, ticks: 0, made: 0, planMade: 0, scored: 0, rimTouch: 0, boardTouch: 0, ghost: 0, kinds: {}, events: {}, maxTicks: 0 };
  for (let i = 0; i < count; i++) {
    const s = genShot(i);
    fs.writeSync(fd, JSON.stringify(s) + '\n');
    sum.shots++; sum.ticks += s.ticks.length; sum.maxTicks = Math.max(sum.maxTicks, s.ticks.length);
    if (s.make) sum.made++;
    if (s.plan.made) sum.planMade++;
    if (s.end.scoredFlag) sum.scored++;
    if (s.end.touchedRim) sum.rimTouch++;
    if (s.end.touchedBoard) sum.boardTouch++;
    if (s.plan.ghost) sum.ghost++;
    sum.kinds[s.kind] = (sum.kinds[s.kind] || 0) + 1;
    for (const t of s.ticks) for (const e of t.e) sum.events[e.t] = (sum.events[e.t] || 0) + 1;
  }
  fs.closeSync(fd);
  sum.meanTicks = sum.ticks / sum.shots;
  sum.node = process.version; sum.v8 = process.versions.v8;
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(sum, null, 2));
  console.log(`wrote ${file}`);
  console.log(JSON.stringify(sum, null, 2));
}

// Math.* samples: the C# JsMath must reproduce every one of these bit for bit (harness --math).
function exportMath(n = 200000) {
  const rng = new RNG(77);
  const file = path.join(outDir, 'math.jsonl');
  const fd = fs.openSync(file, 'w');
  const put = (fn, args, r) => fs.writeSync(fd, JSON.stringify({ fn, a: args.map(hex), r: hex(r) }) + '\n');
  for (let i = 0; i < n; i++) {
    const k = i % 8;
    // trig over the ranges the sim uses: launch angles, [0, 2π), the rim hash (|v| up to ~5e3), and some big ones
    const t = k < 2 ? (rng.next() - 0.5) * 3 : k < 4 ? rng.next() * Math.PI * 2 : k < 7 ? (rng.next() - 0.5) * 1.2e4 : (rng.next() - 0.5) * 1e9;
    put('sin', [t], Math.sin(t)); put('cos', [t], Math.cos(t)); put('tan', [t], Math.tan(t));
    const e = k < 4 ? (rng.next() - 0.5) * 2 : k < 6 ? -rng.next() * 0.05 : (rng.next() - 0.5) * 40;
    put('exp', [e], Math.exp(e));
    const l = k < 4 ? rng.next() : k < 6 ? rng.next() * 1e3 : rng.next() * 1e-6;
    put('log', [l], Math.log(l));
    const px = k < 2 ? rng.next() : k < 4 ? rng.next() * 2 : k < 6 ? rng.next() * 100 : 1.1;
    const py = k < 2 ? 1.4 : k < 3 ? 1.25 : k < 4 ? 0.22 : k < 6 ? (rng.next() - 0.5) * 6 : Math.floor(rng.next() * 5);
    put('pow', [px, py], Math.pow(px, py));
    const h1 = (rng.next() - 0.5) * 30, h2 = (rng.next() - 0.5) * 30, h3 = (rng.next() - 0.5) * 30;
    put('hypot2', [h1, h2], Math.hypot(h1, h2)); put('hypot3', [h1, h2, h3], Math.hypot(h1, h2, h3));
  }
  // the four exp() constants the ball uses every sub-step, and exact edge values
  const h = DT / 4;
  for (const v of [-0.15 * h, -5.5 * h, -2.2 * h, -0.6 * h, 0, 1, -1, 1e-300, 709.7, -745]) put('exp', [v], Math.exp(v));
  for (const v of [0, Math.PI / 4, Math.PI / 2, Math.PI, 2 * Math.PI, 1e-9, 1e22, -0]) { put('sin', [v], Math.sin(v)); put('cos', [v], Math.cos(v)); put('tan', [v], Math.tan(v)); }
  for (const [x, y] of [[COURT.threeRadius, 2], [COURT.cornerThree, 2], [0, 0], [2, 0.5], [-8, 3], [-8, 0.5], [0.5, -1], [1.1, 3]]) put('pow', [x, y], Math.pow(x, y));
  fs.closeSync(fd);
  console.log(`wrote ${file}`);
}

const args = process.argv.slice(2);
if (args.includes('--math')) exportMath();
else exportTraces(Number(args.find(a => /^\d+$/.test(a)) || 1000));
