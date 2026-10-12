// v0.4.7.5 qp3 perf: a player's lockstep input on the wire (session.js frameOnline, server/online.py relay).
//
// Every client sends its own input for every tick of a game, and everyone else in it (and everyone watching it) gets
// them all: at ~70 ticks a second that's the bulk of what an online game sends. Most ticks are just like the one before
// (the stick held the same way, nothing pressed), so an input goes out as
//   * normalized: the stick and angles rounded to 1/1000 (nothing anyone can feel), and every field left at its
//     blank value (Game.multiIntent fills those in) left out;
//   * as the change from the tick before: only the fields that changed (null = back to blank), or 0 for no change;
//   * a frame's ticks together, in one message: {t: 'in', g, k: first tick, b: [change, change...]}.
// The sender keeps the normalized input for its own player (session lk.mine), so its game runs on exactly what the
// others rebuild from the changes. An input is about 200 bytes as plain JSON; this way most ticks are one byte.
import { blankIntent } from './player.js';

const BLANK = blankIntent();
// (+ 0: no -0 on the wire or off it; Math.atan2 tells -0 from 0)
const q3 = v => Math.round(v * 1000) / 1000 + 0;

function quant(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? v + 0 : q3(v)) : 0;
  if (Array.isArray(v)) return v.map(quant);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) if (v[k] !== undefined) o[k] = quant(v[k]);
    return o;
  }
  return v;
}

// the input as it goes out (and as the sender's own game uses it)
export function normIntent(it) {
  const out = {};
  for (const k in it) {
    const v = it[k];
    if (v === undefined || v === null) continue; // (a blank null, or a one-off that isn't there)
    const q = quant(v);
    if (k in BLANK && q === BLANK[k]) continue;
    out[k] = q;
  }
  return out;
}

const same = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

// the change from prev to next (both normalized): 0 when there's none
export function intentDelta(prev, next) {
  let d = null;
  for (const k in next) if (!same(prev[k], next[k])) (d || (d = {}))[k] = next[k];
  for (const k in prev) if (!(k in next)) (d || (d = {}))[k] = null;
  return d || 0;
}

// the input after a change (the same object back when there's none)
export function applyDelta(prev, d) {
  if (!d || typeof d !== 'object') return prev;
  const o = { ...prev };
  for (const k in d) { if (d[k] === null) delete o[k]; else o[k] = d[k]; }
  return o;
}

// rebuilding one sender's inputs from his changes, in tick order (ticks already rebuilt are skipped: a bundle for
// watchers can overlap the game so far). put(tick, input) takes each one; returns false on a gap (never, in order)
export function takeInputs(dec, k, b, put) {
  for (let i = 0; i < b.length; i++) {
    const t = k + i;
    if (t <= dec.k) continue;
    if (t !== dec.k + 1) return false;
    dec.it = applyDelta(dec.it, b[i]);
    dec.k = t;
    put(t, dec.it);
  }
  return true;
}
