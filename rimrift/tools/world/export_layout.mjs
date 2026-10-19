// RIMRIFT World spike: export the Harbor Point park layout from the live JS game (read-only imports) to JSON.
// Everything that venues.js buildPark + coastScenery + harbor.js place for the 'harbor' theme, in sim metres
// (y up, court long axis Z). The C# generators (game/scripts/world) re-derive the deterministic parts (courts,
// fences, poles, benches) from the same maths and check themselves against this file; the RNG-driven parts
// (beach houses, palm spots) are taken from here verbatim, so they are the game's own numbers.
//   node rimrift/tools/world/export_layout.mjs  (run from the repo root /home/claude/ah)
import { writeFileSync } from 'node:fs';
import { COURT, BALL_R } from '../../../client/js/sim/constants.js';
import { THEMES, PARK_COURTS, PARK_HQ, PARK_HALL, squadSpots, gotNextMid, parkInfo } from '../../../client/js/world/themes.js';
import { SHORE, waterlineZ, harborPalmSpots } from '../../../client/js/world/harbor.js';
import { HQ_SIZE, HALL_SIZE } from '../../../client/js/world/props.js';
import { RNG } from '../../../client/js/core/rng.js';

const theme = THEMES.harbor;
const out = { source: 'client/js (v0.4.8.6) themes.js / venues.js buildPark+coastScenery / harbor.js / court.js / props.js', units: 'metres, y up, court long axis Z, +X = left when facing +Z' };
out.court = { ...COURT, ballR: BALL_R };
out.theme = { court: theme.court, ground: theme.ground, sky: theme.sky, sun: theme.sun, ambient: theme.ambient, fog: theme.fog, exposure: theme.exposure, bloom: theme.bloom, grade: theme.grade };
out.hoopColors = { rim: '#d8431c', pole: '#2f5f63', net: '#f4f4f0' };
out.shore = { ...SHORE, waterline: waterlineZ(), sea: { width: 700, depth: 160, z: 115, y: -0.6, color: '#15566e', color2: '#2b7f92' }, surf: { z: waterlineZ() + 1.6, depth: 5 } };

// courts: venues.js buildPark loop
out.courts = PARK_COURTS.map(c => {
  const full = !!c.full, [ox, , oz] = c.origin;
  const W = COURT.width / 2 + 2.2, L = COURT.length / 2 + 2.6;
  const zf = full ? oz - L : oz - 3.2;
  const runs = [[ox - W, oz + L, ox + W, oz + L], [ox - W, zf, ox - W, oz + L], [ox + W, oz + 6, ox + W, oz + L]];
  if (full) runs.push([ox - W, oz - L, ox + W, oz - L], [ox + W, oz - L, ox + W, oz - 9]);
  const corners = full ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 1], [1, 1], [-1, -0.05], [1, -0.05]];
  const poles = corners.map(([sx, sz]) => {
    const lx = ox + sx * (W + 0.3), lz = sz > 0 ? oz + sz * (L - 1.5) : (full ? oz + sz * (L - 1.5) : zf + 1.2);
    const yaw = Math.atan2(ox - lx, (full ? oz : oz + 7) - lz);
    return { x: lx, z: lz, yaw, h: full ? 10 : 8 };
  });
  const benches = [];
  const nb = full ? 3 : 1;
  for (let k = 0; k < nb; k++) benches.push({ x: ox - W + 0.9, z: (full ? oz - 9 : oz + 4) + k * 6, yaw: Math.PI / 2, wood: '#b58a5c', metal: '#30363b' });
  benches.push({ x: ox + W + 1.6, z: oz + (full ? -6 : 0), yaw: -Math.PI / 2, wood: '#9a6b42', metal: '#30363b' });
  const rows = squadSpots(c), mid = gotNextMid(c);
  return {
    id: c.id, name: c.name, format: c.format, full, origin: c.origin,
    hoops: (full ? [1, -1] : [1]).map(side => ({ side, rim: [ox, COURT.rimY, oz + side * COURT.hoopZ] })),
    logoSize: c.format === 2 ? 1.1 : c.format === 1 ? 0.9 : theme.court.logo.size,
    overlayZ: full ? [-COURT.length / 2 - 2, COURT.length / 2 + 2] : [-2.2, COURT.length / 2 + 2], // local z extent of the floor plane
    fence: { h: 3.8, runs, halfW: W, halfL: L },
    poles, benches,
    trash: { x: ox + W + 1.4, z: oz + 12 },
    gotNext: { mid, rows },
  };
});
out.practice = { origin: [52, 0, 16], hoopOrigin: [52, 0, 16 - COURT.hoopZ + 4], rim: [52, COURT.rimY, 20], slab: { x: 52, z: 16.5, w: 10, d: 9, h: 0.04 }, rack: { x: 48, z: 14, yaw: Math.PI / 2 } };
const affColor = parkInfo('harbor').color;
out.plaza = { store: { x: 0, z: -24 }, wheel: { x: -6.2, z: -24 }, boost: { x: 6.2, z: -24 }, kiosk: { w: 5.2, d: 3.4, h: 3.2 }, affColor,
  hq: { x: PARK_HQ.x, z: PARK_HQ.z, ...HQ_SIZE }, hall: { x: PARK_HALL.x, z: PARK_HALL.z, ...HALL_SIZE },
  lamps: Array.from({ length: 10 }, (_, i) => ({ x: -40 + i * 9, z: -27, h: 5.5 })),
  mural: { x: -66, y: 3, z: -4, w: 18, h: 6, t: 0.6, yaw: Math.PI / 2 } };
out.railing = { z: 33.5, x0: -66, x1: 66, step: 2.5, h: 1.1, color: '#e8e3d8' };

// beach houses: coastScenery's rng is buildPark's rng (seed theme.id.length * 977 + 13) after the two kiosks each
// drew one rng.int(0, 3) for their worker's skin (props.js kiosk)
const rng = new RNG(theme.id.length * 977 + 13);
rng.int(0, 3); rng.int(0, 3);
out.houses = [];
for (let i = 0; i < 6; i++) {
  const x = -70 + i * 28, z = -46 - rng.range(0, 8);
  const h = 7 + rng.range(0, 6);
  const color = rng.pick(['#e9d8c0', '#f2c6a8', '#c9e0dd', '#f5e6b8']);
  const roofY = 8 + rng.range(0, 6);
  out.houses.push({ x, z, w: 14, h, d: 10, y: 4, color, roof: { w: 15, h: 0.6, d: 11, y: roofY, color: '#b65c3a' } });
}
out.palms = harborPalmSpots(new RNG(4242), out.houses.map(h => ({ x: h.x, z: h.z, w: 15, d: 11 })));
out.palmCounts = { full: out.palms.filter(p => p.tier === 'full').length, mid: out.palms.filter(p => p.tier === 'mid').length, lite: out.palms.filter(p => p.tier === 'lite').length };
out.net = { cols: 12, rows: 6, depth: 0.44, bottomR: 0.13, strandR: 0.0045 };

const path = new URL('../../game/assets/world/harbor_layout.json', import.meta.url).pathname;
writeFileSync(path, JSON.stringify(out, null, 1));
console.log('wrote', path, 'courts', out.courts.length, 'palms', out.palms.length, out.palmCounts, 'houses', out.houses.length);
