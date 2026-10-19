// RIMRIFT Stage 0.5 parity traces for the procedural animator (Character agent).
// Drives the JS Animator (client/js/char/animator.js, read-only) through a scripted sequence for a given build and
// dumps, every tick, the inputs it was given (so the C# replay uses exactly the same ones) and what came out: the
// final pose handed to the rig, the smoothed pose, and the rig's joint positions and rotations.
// Run: node rimrift/harness/anim_traces.mjs [out.json] [height weight wingspan]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Animator } from '../../client/js/char/animator.js';
import { AthleteModel } from '../../client/js/char/athlete.js';
import { Rig } from '../../client/js/char/rig.js';
import { BONES } from '../../client/js/char/skeleton.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2] || path.join(here, 'traces', 'anim_77_215_80.json');
const build = { height: +(process.argv[3] || 77), weight: +(process.argv[4] || 215), wingspan: +(process.argv[5] || 80) };
const DT = 1 / 60, G = 9.81;

const model = new AthleteModel(build, {}, 1), rig = new Rig(model);
let captured = null;
const view = { H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; captured = { pose: Array.from(pose), x, y, z, yaw, lookW: o.lookW, look: o.look ? Array.from(o.look) : null, pinL: !!o.pinL, pinR: !!o.pinR }; } };
const anim = new Animator(view);

// the scripted player (the slice of sim/player.js the animator reads)
const p = { id: 0, vx: 0, vz: 0, facing: 0, stamina: 1, action: null, stance: 'normal', airborne: false, moveStyle: 'standard',
  dribble: { hand: 'R', phase: 0, xover: null }, shotPkg: { hand: 'R', style: 'standard', release: 'classic', relK: 0.93 },
  phys: { reach: model.d.reachStanding, H: model.d.H, radius: 0.3 }, sizeupLvl: 0, sizeupStyle: null, handsUp: false, contestHand: null, handsSide: null, screening: 0, posting: 0, backing: 0, boxOut: false, boxedOut: false };
const st = { x: 0, y: 0, z: 0, facing: 0 };
const ball = { x: 0, y: 0, z: 0 };
let has = false, ballMode = 'held';

// the sequence: stand 1 s, walk 2 s, jog 2 s, stop 1 s, dribble 2 s, jump shot (released at tRel) and land, stand, a block
const SHOT = { tRel: 0.6, takeoff: 0.22 }, shotVy = G * (SHOT.tRel - SHOT.takeoff), shotAir = 2 * shotVy / G;
const BLOCK = { jumpAt: 0.1, air: 0.6 };
const phases = [
  { name: 'stand', dur: 1.0 },
  { name: 'walk', dur: 2.0 },
  { name: 'jog', dur: 2.0 },
  { name: 'stop', dur: 1.0 },
  { name: 'dribble', dur: 2.0 },
  { name: 'shot', dur: SHOT.takeoff + shotAir + 0.4 },
  { name: 'stand2', dur: 1.0 },
  { name: 'block', dur: BLOCK.jumpAt + BLOCK.air + 0.5 },
  { name: 'stand3', dur: 0.5 },
];
const localToWorld = (lx, ly, lz) => { const c = Math.cos(st.facing), s = Math.sin(st.facing); return { x: st.x + c * lx + s * lz, y: st.y + ly, z: st.z - s * lx + c * lz }; };
const setBall = (lx, ly, lz) => { const w = localToWorld(lx, ly, lz); ball.x = w.x; ball.y = w.y; ball.z = w.z; };

const ticks = [];
let t = 0, phaseI = 0, phaseT = 0, dribT = 0;
const total = phases.reduce((s, ph) => s + ph.dur, 0);
const n = Math.round(total / DT);
for (let i = 0; i < n; i++) {
  while (phaseI < phases.length - 1 && phaseT >= phases[phaseI].dur - 1e-9) { phaseT -= phases[phaseI].dur; phaseI++; }
  const ph = phases[phaseI].name;
  // defaults each tick
  p.vx = 0; p.vz = 0; p.airborne = false; p.contestHand = null; st.y = 0;
  has = false; ballMode = 'held';
  let act = p.action;
  if (ph === 'walk') p.vz = 1.5;
  else if (ph === 'jog') p.vz = 3.5;
  if (ph === 'dribble') {
    has = true; ballMode = 'dribble'; dribT += DT;
    const bph = (dribT * 2.2) % 1; p.dribble.phase = bph;
    const by = 0.12 + 0.75 * Math.abs(Math.sin(bph * Math.PI));
    setBall(-0.28, by, 0.32);
  }
  if (ph === 'shot') {
    if (!act || act.type !== 'shoot') act = p.action = { type: 'shoot', t: 0, tRel: SHOT.tRel, takeoff: SHOT.takeoff, kind: 'mid', dRim: 5.2, released: false, releaseAt: undefined };
    else act.t += DT;
    const at = act.t;
    if (at >= SHOT.takeoff) { const u = at - SHOT.takeoff; st.y = Math.max(0, shotVy * u - 0.5 * G * u * u); p.airborne = u < shotAir; }
    if (at >= SHOT.tRel && !act.released) { act.released = true; act.releaseAt = SHOT.tRel; }
    has = !act.released; ballMode = 'held';
    if (!act.released) {
      // the ball rises from the chest to the release point over the shot (a smooth set)
      const k = Math.min(1, at / SHOT.tRel), e = k * k * (3 - 2 * k);
      const relY = model.d.reachStanding * 0.93, y0 = 1.25 * (model.d.H / 2);
      setBall(0.05 * (model.d.H / 2), y0 + (relY - y0) * e, (0.3 + 0.1 * e) * (model.d.H / 2));
    } else {
      const u = at - SHOT.tRel; const relY = model.d.reachStanding * 0.93;
      setBall(0, relY + 4.5 * u - 0.5 * G * u * u, 0.4 * model.d.H / 2 + 6 * u);
    }
    if (at > SHOT.takeoff + shotAir + 0.3) { p.action = act = null; }
  } else if (act && act.type === 'shoot') p.action = act = null;
  if (ph === 'block') {
    if (!act || act.type !== 'block') act = p.action = { type: 'block', t: 0, jumpAt: BLOCK.jumpAt, air: BLOCK.air, jumped: false, hit: false };
    else act.t += DT;
    const at = act.t;
    if (at >= BLOCK.jumpAt) { act.jumped = true; const u = at - BLOCK.jumpAt, vy = G * BLOCK.air / 2; st.y = Math.max(0, vy * u - 0.5 * G * u * u); p.airborne = u < BLOCK.air; }
    setBall(0.3, 2.6 + 0.2 * Math.sin(at * 5), 0.5);
    if (at > BLOCK.jumpAt + BLOCK.air + 0.4) p.action = act = null;
  } else if (act && act.type === 'block') p.action = act = null;
  if (ph === 'stand3') p.contestHand = 'R';
  if (ph === 'stand' || ph === 'stop' || ph === 'stand2') setBall(0.6, 0.12, 1.2);
  // integrate the placement (the sim would)
  st.x += p.vx * DT; st.z += p.vz * DT;
  const extra = { hasBall: has, ballMode, floorY: 0 };
  const inputs = {
    t: +t.toFixed(6), phase: ph, st: { ...st }, ball: { ...ball }, has, ballMode,
    p: { vx: p.vx, vz: p.vz, airborne: p.airborne, contestHand: p.contestHand, dribblePhase: p.dribble.phase },
    action: act ? { ...act } : null,
  };
  anim.update(DT, st, p, null, ball, extra);
  ticks.push({
    ...inputs,
    out: {
      fin: captured.pose, smooth: Array.from(anim.pose), target: Array.from(anim.target),
      lookW: captured.lookW, look: captured.look, pinL: captured.pinL, pinR: captured.pinR, yaw: captured.yaw,
      pos: rig.pos.map(v => Array.from(v)), rot: rig.rot.map(q => Array.from(q)), reach: [rig.reach.L, rig.reach.R],
    },
  });
  t += DT; phaseT += DT;
}
const trace = { build, dt: DT, bones: BONES, dims: model.d, bind: model.bind, off: model.off, n: ticks.length, phases, ticks };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(trace));
console.log(`anim trace: ${ticks.length} ticks, H=${model.d.H.toFixed(4)} -> ${outPath}`);
