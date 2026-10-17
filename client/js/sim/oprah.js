// v0.4.8.5 qp5: Oprah, the Playmaker's Icon badge: a set of streetball passes nobody else throws. Nothing here imports
// the sim, so game.js (the pick, the ball's path in his hand, where it's let go) and the animator (char/oprahpose.js:
// the body) both read from it, and online peers, who all run the same sim, see the same pass.
//
// Gameplay doesn't move: the release comes when the sim says (PASS rel × his quickness, the same turn to the man), at
// the speed and accuracy the sim gives it. What changes is where the ball is on the way to the release and where it
// leaves his hand (behind his back, between his legs, over his shoulder...), and which way his body faces while he does
// it (he doesn't have to square up to throw a behind-the-back: `vf`, his body's facing, is the sim facing turned by
// the style, and the ball's path is in that frame).
//
// The windup is short (a pass leaves an Oprah holder's hand 50-170 ms after the press), so every style is mostly in
// where the ball goes and the finish after it (the animator holds each style's own follow-through a moment longer).
//
// Paths are keys [k, x (m, + = his left), y (× H), z (m, + = ahead)] in the body frame, for a RIGHT-handed throw (a left
// hand mirrors x); k is the share of the windup (0 at the press, 1 at the release); the ball starts where it was.

export const OP_ICON = 'oprah';
const D = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clamp01 = x => clamp(x, 0, 1);
const sstep = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const LOB = t => t === 'lob' || t === 'alley';

// Each style: name, what it looks like, the pass types it's thrown on (w: how often it comes up there), and when it
// fits (a: the receiver's angle off where he faces at the press, degrees; side: 'off' = the side away from the ball
// hand, 'ball' = the ball hand's side, null = either)
export const OP_STYLES = {
  btb: {
    name: 'Behind the Back', callout: 'BEHIND THE BACK!',
    desc: 'Whipped round his waist with one hand and let go from behind the far hip, to a man on his off-hand side; the throwing arm stays wrapped round his back.',
    types: { chest: 1.2, flick: 1.3, bounce: 1, lob: 0.8, alley: 0.8, bailout: 1 }, a: [35, 130], side: 'off',
  },
  nolook: {
    name: 'No-Look', callout: 'NO LOOK!',
    desc: 'A one-hand dish while his head and eyes are snapped the other way, the free hand pointing the lie.',
    types: { chest: 1, flick: 1, bounce: 1, lob: 1.2, alley: 1.4, inbound: 1.2, bailout: 1.2 }, a: [0, 120], side: null,
  },
  wrap: {
    name: 'Wraparound', callout: 'WRAPAROUND!',
    desc: 'The ball swung out wide at arm\'s length round the defender\'s hip in a deep lunge and bounced in from the side.',
    types: { bounce: 1.6, chest: 0.8, flick: 0.9 }, a: [0, 70], side: 'ball',
  },
  btl: {
    name: 'Between the Legs', callout: 'THROUGH THE LEGS!',
    desc: 'Down in a wide straddle, the ball whipped back between his knees to the man behind him without turning round.',
    types: { bounce: 1.8, chest: 1, flick: 1 }, a: [115, 180], side: null,
  },
  shoulder: {
    name: 'Over the Shoulder', callout: 'OVER THE SHOULDER!',
    desc: 'A blind flip back over his shoulder to the trailer, eyes still ahead, the free arm still out in front.',
    types: { chest: 1.3, flick: 1.4, lob: 1.2, alley: 1.2, bailout: 1.2 }, a: [105, 180], side: null,
  },
  elbow: {
    name: 'Elbow Pass', callout: 'ELBOW PASS!',
    desc: 'The behind-the-back fake: the ball goes round his back, rolls off his fingers and he bumps it off the point of his other elbow.',
    types: { chest: 0.9, flick: 0.9 }, a: [60, 150], side: 'off',
  },
  spin: {
    name: 'Spin Dish', callout: 'SPIN DISH!',
    desc: 'On the move: a full turn with the ball slung out at arm\'s length, let go as he comes round to the man, still spinning after it.',
    types: { chest: 1, flick: 1.5, bounce: 0.8 }, a: [35, 125], side: 'off',
  },
  bullet: {
    name: 'Dribble Bullet', callout: 'BULLET!',
    desc: 'Straight off the bounce with one hand, no gather: cocked by the ear and fired with a long step, the arm thrown out after it.',
    types: { chest: 1, flick: 1.5, inbound: 1.2, bailout: 0.8 }, a: [0, 85], side: 'ahead',
  },
  overhead: {
    name: 'Behind the Head', callout: 'BEHIND THE HEAD!',
    desc: 'Taken up and back behind his head in one hand and flicked over the top, the off hand pointing the way.',
    types: { lob: 1.5, alley: 1.6, chest: 0.6, inbound: 0.9, bailout: 1 }, a: [0, 75], side: null,
  },
};
export const OP_IDS = Object.keys(OP_STYLES);

// a small integer hash (the same on every peer): the pass's own number for this player, his id and the tick
export function opHash(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) { h ^= (x | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; }
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// which styles fit, with their weights. ctx: {type ('chest'|'bounce'|'lob'|'alley'|'flick'|'inbound'), bailout, air,
// d (the receiver's angle off his facing, radians, + = his left), hand ('L'|'R': the ball's hand when dribbling; null:
// held in both, either hand can throw), moving (m/s), drove (just out of a dribble move or at speed)}
export function opCandidates(ctx) {
  const out = [];
  const a = Math.abs(ctx.d) / D, left = ctx.d >= 0;
  const kind = ctx.bailout ? 'bailout' : ctx.type;
  for (const id of OP_IDS) {
    const S = OP_STYLES[id];
    let w = S.types[kind] || 0;
    if (!w) continue;
    if (a < S.a[0] || a > S.a[1]) continue;
    // the hands it can be thrown with: off = the receiver on the side away from the throwing hand
    const hands = ctx.hand ? [ctx.hand] : left ? ['L', 'R'] : ['R', 'L'];
    let hand = null;
    for (const h of hands) {
      const hl = h === 'L';
      if (S.side === 'off' && left === hl) continue;
      if (S.side === 'ball' && a > 18 && left !== hl) continue;
      if (S.side === 'ahead' && a > 55 && left !== hl) continue;
      hand = h; break;
    }
    if (!hand) continue;
    // in the air (a bailout out of a jumper), only what can be thrown off the floor
    if (ctx.air && (id === 'wrap' || id === 'btl' || id === 'spin' || id === 'elbow')) continue;
    if (id === 'btl' && ctx.moving > 3.2) continue; // (the straddle is a set-up: not at a run)
    if (id === 'spin') { if (!(ctx.moving > 2.2 || ctx.drove)) continue; w *= ctx.moving > 4 ? 1.6 : 1; }
    if (id === 'wrap' && ctx.drove) w *= 1.4;
    if (id === 'bullet' && ctx.hand) w *= 1.3; // (straight off the bounce is the point)
    out.push({ id, w, hand });
  }
  return out;
}

// the pick: deterministic (seq: his Oprah passes so far; tick: the game's; salt: the game's own, its random stream's state
// read without drawing from it, so every game goes its own way), never the same style twice running when
// there's another that fits; the No-Look (or the flip over the shoulder, to a man behind) when nothing else does
export function pickOprahPass(ctx, seq = 0, id = 0, tick = 0, last = null, salt = 0) {
  const c = opCandidates(ctx);
  if (!c.length) {
    const a = Math.abs(ctx.d) / D;
    const hand = ctx.hand || (ctx.d >= 0 ? 'L' : 'R');
    return { id: a > 105 && !LOB(ctx.type) ? 'shoulder' : 'nolook', hand };
  }
  if (c.length > 1 && last) for (const x of c) if (x.id === last) x.w = 0;
  const tot = c.reduce((s, x) => s + x.w, 0);
  let r = opHash(seq, id, tick, salt, 7) * tot;
  for (const x of c) { if (!x.w) continue; r -= x.w; if (r <= 0) return { id: x.id, hand: x.hand }; }
  const z = c.filter(x => x.w).pop() || c[0];
  return { id: z.id, hand: z.hand };
}

// the plan the action carries (a.op): style, hand, the receiver's side, where his body faces at the press (f0) and at
// the release (fRel), the spin, where the ball was (b0, body frame at f0), and the no-look's lie (look)
export function oprahPlan(ctx, pick, f0, face, b0) {
  const st = pick.id, hand = pick.hand, d = wrap(face - f0), a = Math.abs(d), sg = d >= 0 ? 1 : -1;
  // th: the receiver's angle off his BODY at the release (+ = left); his body faces face - th then
  let th;
  if (st === 'btb') th = sg * clamp(a, 55 * D, 100 * D);
  else if (st === 'elbow') th = sg * clamp(a, 80 * D, 135 * D);
  else if (st === 'wrap') th = sg * clamp(a, 12 * D, 40 * D);
  else if (st === 'btl') th = sg * clamp(a, 168 * D, 180 * D);
  else if (st === 'shoulder') th = sg * clamp(a, 125 * D, 165 * D);
  else if (st === 'nolook') th = (a < 8 * D ? (hand === 'L' ? 1 : -1) : sg) * clamp(a, 35 * D, 70 * D);
  else if (st === 'bullet') th = clamp(d, -22 * D, 22 * D);
  else if (st === 'overhead') th = clamp(d, -18 * D, 18 * D);
  else th = 0; // (the spin dish lets go square to him)
  const plan = { style: st, hand, th, f0, fRel: face - th, face, b0, spin: 0, two: !ctx.hand };
  if (st === 'spin') plan.spin = sg; // (toward the man: the ball hand's side swings round to him)
  if (st === 'nolook') plan.look = -Math.sign(th) || 1; // the side his head goes to: away from the man
  return plan;
}

// k: share of the windup done (a.t over the release time; held at 1 if the turn to the man holds the release back)
export const opK = a => clamp01(a.t / Math.max(1e-3, a.rel));

// the body's facing (radians, absolute) up to the release: from where he faced to the style's facing; the Spin Dish
// turns toward the man and lets go as it reaches him (the animator carries the turn on round after the ball is gone)
export function oprahFacing(a) {
  const o = a.op;
  if (!o) return null;
  const k = opK(a);
  if (o.spin) { const sweep = wrap(o.face - o.f0); return o.f0 + sweep * Math.pow(k, 1.6); }
  return o.f0 + wrap(o.fRel - o.f0) * sstep(k);
}

// the style's keys (right hand; the first key is where the ball was) for this pass type and receiver angle
function opKeys(o, type) {
  const lob = LOB(type), bnc = type === 'bounce', inb = type === 'inbound';
  const sth = Math.sin(o.th), cth = Math.cos(o.th), R = o.hand === 'R' ? 1 : -1; // (th is mirrored for a left hand below)
  switch (o.style) {
    case 'btb': return lob
      ? [[0.34, -0.33, 0.52, -0.02], [0.68, -0.07, 0.52, -0.29], [1, 0.27, 0.58, -0.17]]
      : [[0.34, -0.33, 0.5, -0.02], [0.68, -0.07, bnc ? 0.47 : 0.49, -0.29], [1, 0.27, bnc ? 0.44 : 0.49, -0.18]];
    case 'elbow': return [[0.3, -0.33, 0.52, -0.02], [0.6, -0.06, 0.56, -0.3], [0.8, 0.2, 0.6, -0.31], [1, 0.4, 0.64, -0.26]];
    case 'wrap': return [[0.3, -0.42, 0.5, -0.06], [0.65, -0.68, bnc ? 0.43 : 0.46, 0.16], [1, -0.58, bnc ? 0.38 : 0.43, 0.42]];
    case 'btl': return [[0.3, -0.24, 0.47, 0.28], [0.65, -0.06, 0.33, 0.27], [1, 0.0, 0.25, 0.1]];
    case 'shoulder': return lob
      ? [[0.35, -0.22, 0.74, 0.2], [0.7, -0.24, 0.92, 0.04], [1, -0.18, 1.02, -0.12]]
      : [[0.35, -0.22, 0.72, 0.2], [0.7, -0.24, 0.88, 0.04], [1, -0.2, 0.97, -0.14]];
    case 'spin': return [[0.45, -0.46, 0.6, 0.14], [1, -0.8, bnc ? 0.56 : 0.66, 0.12]];
    case 'bullet': {
      const x = -0.08 + R * 0.3 * sth; // (fired along th)
      return [[0.35, -0.24, 0.56, 0.2], [0.62, -0.19, 0.7, 0.04], [1, x, inb ? 0.74 : 0.72, 0.6 * Math.max(0.6, cth)]];
    }
    case 'overhead': return [[0.35, -0.16, 0.86, 0.14], [0.68, -0.1, 1.04, -0.16], [1, -0.06 + R * 0.12 * sth, 1.08, 0.14]];
    case 'nolook': default: {
      // a one-hand dish out toward the man (th): to the ball hand's side, flicked out at arm's length; across, swept over
      // in front of his belt; a lob off the top of the shoulder; a bounce from the hip
      const tha = o.th * R, sa = Math.sin(tha), ca = Math.max(0.2, Math.cos(tha));
      if (lob) return [[0.45, -0.2, 0.82, 0.18], [1, -0.16 + 0.14 * sa, 0.95, 0.2]];
      const y = bnc ? 0.47 : inb ? 0.66 : 0.6;
      if (tha < 0) return [[0.45, -0.32, y, 0.2], [1, -0.18 + 0.34 * sa, y, 0.2 + 0.3 * ca]];
      return [[0.45, -0.06, y - 0.06, 0.3], [1, 0.02 + 0.3 * sa, y - 0.08, 0.24 + 0.22 * ca]];
    }
  }
}

// the ball in his hand(s) in the body frame (the facing oprahFacing gives) at a.t, meters: [x, y, z]
export function oprahBall(a, H) {
  const o = a.op, k = opK(a), keys = opKeys(o, a.ptype), m = o.hand === 'L' ? -1 : 1;
  const b0 = o.b0 || [m * -0.2, 0.55 * H, 0.3];
  let prev = [0, b0[0], b0[1], b0[2]], i = 0;
  while (i < keys.length - 1 && k > keys[i][0]) { prev = [keys[i][0], m * keys[i][1], keys[i][2] * H, keys[i][3]]; i++; }
  const nx = keys[i], nxt = [nx[0], m * nx[1], nx[2] * H, nx[3]];
  const u = clamp01((k - prev[0]) / Math.max(1e-6, nxt[0] - prev[0]));
  // (picked up from where it was, then on at speed through the keys and into the release: the ball doesn't stop there)
  const e = i === 0 ? u * (0.4 + 0.6 * u) : u;
  return [prev[1] + (nxt[1] - prev[1]) * e, prev[2] + (nxt[2] - prev[2]) * e, prev[3] + (nxt[3] - prev[3]) * e];
}

// which hand has the ball at k ('R', 'L', or null: off the fingers, on its way to the elbow)
export function oprahHand(a, k = opK(a)) {
  const o = a.op;
  if (o.style === 'elbow' && k > 0.8) return null;
  return o.hand;
}
// the release point (the end of the path), body frame, meters
export function oprahRelease(a, H) { const t = a.t; a.t = Math.max(t, a.rel); const r = oprahBall(a, H); a.t = t; return r; }
