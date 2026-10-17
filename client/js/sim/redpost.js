// v0.4.8.5 quick patch 5: Sexy Red (the Post Scorer Icon badge): "+5% Layup, Post Control and Close Shot (can pass 99).
// Unlocks exclusive post back-down animations." The Icon's own Post Move Package (sim/post.js POST_ICON_PACKAGES,
// 'post_sexy_red', slot 'post', body 'red'; the holder's alone) backs the man down with five back-downs nobody else
// has, one after another as he works the block, and finishes with two signature flourishes (the Shimmy Turnaround and
// the Leaning Hook). The poses are char/redpose.js; this is the data and the clock, for the animator, the preview and
// the tests. Nothing here imports the sim or the animator.
//
// Which back-down plays: a stream per player, seeded by the game's seed and his id. Every one of the five plays before
// any of them repeats (a shuffled bag each round, never the same one twice in a row, not even across bags), each for
// its own phrase (len, s), passing through the base stance between them; a new post-up picks up with the next one.
export const RED_ICON = 'sexy_red';
export const RED_POST_PKG = 'post_sexy_red';
export const RED_BACKDOWNS = [
  { id: 'red_grind', name: 'Shimmy Grind', len: 1.6, desc: 'Sat low into the man, the shoulders shimmying fast while the hips grind round in a slow circle and the feet chip back at him.' },
  { id: 'red_seal', name: 'Seal & Sit', len: 1.5, desc: 'Two hard hip-checks back into his chest, a shoulder bump with each and the off arm barring him, then he sits down on him like a chair.' },
  { id: 'red_twostep', name: 'Slow-Walk Two-Step', len: 1.8, desc: 'Two big, slow, deliberate steps back, knee up high on each, the shoulders swinging against the hips, with a snap of a head fake as each foot lands.' },
  { id: 'red_peek', name: 'Rim Peek', len: 1.7, desc: 'Bouncing with the dribble, he turns all the way round to look over one shoulder at the rim, then whips round to look over the other.' },
  { id: 'red_feint', name: 'Spin-Fake Re-Seal', len: 1.4, desc: 'Starts to spin off him, the hips and the swing leg going, then snaps back and drops into a hard re-seal with a nod.' },
];
export const RED_BY_ID = Object.fromEntries(RED_BACKDOWNS.map(s => [s.id, s]));
export const RED_IDS = RED_BACKDOWNS.map(s => s.id);
export const redName = id => RED_BY_ID[id]?.name || null;
// the signature finishes (the animator plays them on the post shots of the package)
export const RED_FINISHES = { turn: 'Shimmy Turnaround', hook: 'Leaning Hook' };

const mix32 = h => { h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return (h ^ (h >>> 16)) >>> 0; };
// the seed of a player's stream: his id and the game's seed (online every screen runs the same game: the same stream)
export const redSeed = (pid, gameSeed = 0) => mix32(((pid | 0) + 1) * 0x9e3779b1 ^ mix32((gameSeed | 0) + 0x632be5ab));
// bag b of the stream: the five in a seeded order (its first never the last of bag b - 1)
function shuffled(seed, b) {
  const ids = RED_IDS.slice();
  let s = mix32(seed ^ Math.imul(b + 1, 0x85ebca6b));
  for (let i = ids.length - 1; i > 0; i--) { s = mix32(s + i); const j = s % (i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids;
}
// (the fix-up only ever swaps a bag's first two, so the last of the bag before is its shuffle's own)
function bag(seed, b) {
  const ids = shuffled(seed, b);
  if (b > 0 && ids[0] === shuffled(seed, b - 1)[ids.length - 1]) [ids[0], ids[1]] = [ids[1], ids[0]];
  return ids;
}
// the k-th back-down of the stream: {id, len, side (±1, the way his feints and looks go: alternating, seeded)}
export function redStyleAt(seed, k) {
  const n = RED_IDS.length, b = Math.floor(k / n), id = bag(seed, b)[k - b * n];
  const side = ((mix32(seed + 7) & 1) ^ (k & 1)) ? 1 : -1;
  return { id, len: RED_BY_ID[id].len, side };
}
// the clock (the animator's, per player): advance by dt while the back-down plays (on), note the gaps; a new post-up
// after a break of `gap` s goes on to the next back-down. st: {k, u, off, seed}. Returns the style playing now with u
// (s into it) and env (0..1: in from the base stance and back out to it at the phrase's ends)
export const RED_GAP = 0.5, RED_EDGE = 0.2;
export function redClock(st, dt, on) {
  if (!on) { st.off = (st.off || 0) + dt; st.on = false; return null; }
  if (!st.on && (st.off || 0) > RED_GAP && (st.u || 0) > 0.25) { st.k = (st.k || 0) + 1; st.u = 0; }
  st.on = true; st.off = 0;
  st.u = (st.u || 0) + dt; st.k = st.k || 0;
  let cur = redStyleAt(st.seed || 0, st.k);
  while (st.u >= cur.len) { st.u -= cur.len; st.k++; cur = redStyleAt(st.seed || 0, st.k); }
  const u = st.u, e = Math.min(1, u / RED_EDGE, (cur.len - u) / RED_EDGE);
  return { ...cur, k: st.k, u, env: e * e * (3 - 2 * e) };
}
