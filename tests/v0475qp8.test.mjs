// v0.4.7.5 quick patch 3: the Hash-Slinging dunk package (sim/hashsling.js). The Slasher's Icon badge brings a package
// nobody can buy: six long streetball finishes, each unique against every other dunk in the game, slammed past the apex
// of a higher jump, putting most defenders flat on their back; the Icon badge's activation banner after every dunk is
// 20% bigger, carries the badge's full art with its animation running, and stays up twice as long.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HS_PKG, HS_IDS, HS_STYLES, HS_TIMING, HS_POSTER, isHS, hsHand, hsK, hsPath, hsSpin, hsName, hsCallout } from '../client/js/sim/hashsling.js';
import * as S from '../client/js/sim/shots.js';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { Animator, dunkHand } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B as BONE } from '../client/js/char/skeleton.js';
import { P, neutral } from '../client/js/char/pose.js';
import { BADGE_POP_MS, BADGE_POP_GAP, ICON_POP_K, ICON_POP_ART } from '../client/js/game/hud.js';

const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const item = catalog[HS_PKG];

const slasher = (seed, opts = {}) => {
  const rng = new RNG(seed), me = makeTeam(rng, 1, { catalog, level: 0.9 })[0];
  Object.assign(me.build, { height: 78, weight: 210, wingspan: 82, hand: 'R' });
  if (opts.icon !== false) me.build.icon_badge = 'hash_slinging';
  me.build.equipment = { ...me.build.equipment, dunk: opts.pkg === undefined ? HS_PKG : opts.pkg };
  if (opts.pkg === null) delete me.build.equipment.dunk;
  me.human = true;
  return me;
};
const attack = (g, p, style) => {
  const rim = g.rimFor(0), side = g.sideFor(0); p.setPos(rim.x, rim.z - side * 2.8, 0); p.facing = side > 0 ? 0 : Math.PI;
  p.vx = 0; p.vz = side * 4.5; g.giveBall(p, 'dribble');
  if (style) g.dunkStyle = () => style;
  p.raw.driving_dunk = 95; p.phys.vertical = 0.8;
  return g.startDunk(p, rim, {});
};

test('the package: six finishes, all its own, in the catalog as an Icon exclusive that cannot be bought', () => {
  assert.equal(HS_IDS.length, 6);
  assert.ok(item, 'catalog item');
  assert.equal(item.slot, 'dunk'); assert.equal(item.price, 0); assert.equal(item.exclusive, 'icon'); assert.equal(item.icon, 'hash_slinging');
  assert.deepEqual([...item.styles].sort(), [...HS_IDS].sort(), 'the catalog carries exactly the six');
  assert.equal(item.styles[0], item.signature);
  assert.equal(S.DUNK_TIER[HS_PKG], 5, 'the top tier: furthest takeoff, highest jump, hardest shove');
  for (const id of HS_IDS) {
    const s = HS_STYLES[id];
    assert.ok(isHS(id) && s.name && s.callout && s.desc, id);
    assert.ok((S.STYLE_FLAIR[id] ?? 0) >= 4.4, `${id}: flashier than anything else (${S.STYLE_FLAIR[id]})`);
  }
  assert.equal(new Set(HS_IDS.map(id => HS_STYLES[id].name)).size, 6);
  // nobody else's package has them
  for (const d of list.filter(i => i.slot === 'dunk' && i.id !== HS_PKG)) assert.ok(!d.styles.some(isHS), `${d.id} has no Hash-Slinging finish`);
  assert.ok(Math.max(...Object.entries(S.STYLE_FLAIR).filter(([k]) => !isHS(k)).map(([, v]) => v)) < Math.min(...HS_IDS.map(id => S.STYLE_FLAIR[id])));
  assert.equal(hsName('hs_sling'), 'The Hash Sling'); assert.equal(hsCallout('hs_stinger'), 'STINGER!'); assert.equal(hsName('windmill'), null);
  // (the v0.4.5 single Hash-Slinging finish is gone: the package replaced it)
  assert.equal(S.STYLE_FLAIR.hashsling, undefined);
});

test('the script: each finish has its own ball path, hand changes and turn; the two-pass finishes really go through and round', () => {
  const H = 2.0, topY = 1.3 * H, arm = { shoulderY: 0.806 * H, shoulderX: 0.2, z: -0.024, len: 0.66 };
  const paths = {};
  for (const id of HS_IDS) {
    const pts = []; for (let i = 0; i <= 50; i++) pts.push(hsPath(id, i / 50, H, topY, arm));
    paths[id] = pts;
    const end = pts[pts.length - 1];
    assert.ok(Math.abs(end[1] - topY) < 1e-6, `${id} ends at the slam height`);
    assert.ok(Math.abs(Math.abs(end[2]) - 0.5) < 1e-6, `${id} ends at the rim (ahead, or behind the head after the half turn)`);
    assert.ok(pts.every(([x, y, z]) => Math.hypot(x, z) < 0.95 && y > 0.3 * H && y <= topY * 1.01), `${id} stays within reach`);
  }
  // between the legs: under the pelvis (y < 0.4 H, |x| small), once for Lost Cause and the Sling, twice for the Double Dip
  const dips = id => { let n = 0, under = false; for (const [x, y] of paths[id]) { const u = y < 0.4 * H && Math.abs(x) < 0.08; if (u && !under) n++; under = u; } return n; };
  assert.equal(dips('hs_lostcause'), 1); assert.equal(dips('hs_sling'), 1); assert.equal(dips('hs_doubledip'), 2);
  assert.equal(dips('hs_stinger'), 0); assert.equal(dips('hs_cradlespin'), 0);
  // round the back: behind the body (z < -0.2) at waist height, for Lost Cause and the Backdoor Mill (the Stinger takes it
  // behind the back too, over the head)
  const behind = id => paths[id].some(([, y, z]) => z < -0.2 && y < 0.7 * H);
  assert.ok(behind('hs_lostcause') && behind('hs_backdoormill') && behind('hs_stinger'));
  assert.ok(!behind('hs_cradlespin') && !behind('hs_doubledip'), 'the others do not');
  // the mill: a full-ish circle: the ball passes the hip low, goes behind and over the top before the rim
  const mill = paths.hs_backdoormill; assert.ok(mill.some(([, y, z]) => y < 0.45 * H && z > 0) && mill.some(([, y]) => y > 1.15 * H), 'low in front, then over the top');
  // hands: both for the Stinger, two changes for the two-pass finishes, one for the rest
  const changes = id => { let n = 0, last = hsHand(id, 0); for (let i = 0; i <= 100; i++) { const h = hsHand(id, i / 100); if (h !== last) n++; last = h; } return n; };
  assert.equal(hsHand('hs_stinger', 0.5), 'B'); assert.equal(changes('hs_stinger'), 0);
  assert.equal(changes('hs_lostcause'), 2); assert.equal(changes('hs_doubledip'), 2);
  assert.equal(changes('hs_backdoormill'), 1); assert.equal(changes('hs_cradlespin'), 1); assert.equal(changes('hs_sling'), 1);
  assert.equal(hsHand('hs_backdoormill', 1), 'L'); assert.equal(hsHand('hs_lostcause', 1), 'R');
  // turns: a half for the Stinger, a full one for the Cradle Spin and the Sling, none for the rest
  assert.ok(Math.abs(hsSpin('hs_stinger', 1) - Math.PI) < 1e-9); assert.ok(Math.abs(hsSpin('hs_cradlespin', 1) - 2 * Math.PI) < 1e-9); assert.ok(Math.abs(hsSpin('hs_sling', 1) - 2 * Math.PI) < 1e-9);
  assert.equal(hsSpin('hs_lostcause', 1), 0); assert.equal(hsSpin('hs_doubledip', 0.5), 0); assert.equal(hsSpin('hs_backdoormill', 1), 0);
  assert.equal(hsSpin('hs_sling', 0.04), 0, 'the turn starts in the air, not in the gather');
  // (the sim's spin reads the same script)
  assert.ok(Math.abs(S.dunkSpin({ type: 'dunk', style: 'hs_sling', takeoff: 0.3, slam: 0.9, spinDir: -1, t: 0.9 }) + 2 * Math.PI) < 1e-9);
  // the ball paths are all different from each other
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    let worst = 0; for (let k = 0; k < paths[HS_IDS[i]].length; k++) { const a = paths[HS_IDS[i]][k], b = paths[HS_IDS[j]][k]; worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
    assert.ok(worst > 0.3, `${HS_IDS[i]} vs ${HS_IDS[j]}: the balls are at most ${worst.toFixed(2)} m apart`);
  }
});

test('in games: the Icon holder rolls the six evenly, nobody else can roll them, and the flight is long', () => {
  const me = slasher(3), g = new Game({ mode: 'practice', seed: 3, rosters: [[me], []], catalog }), p = g.players[0];
  assert.equal(p.dunkPkg, HS_PKG); assert.equal(S.dunkTier(p), 5);
  const cnt = {}; for (let k = 0; k < 6000; k++) { const s = g.dunkStyle(p); cnt[s] = (cnt[s] || 0) + 1; }
  assert.deepEqual(Object.keys(cnt).sort(), [...HS_IDS].sort(), 'only the six');
  for (const id of HS_IDS) assert.ok(cnt[id] > 6000 / 6 * 0.8 && cnt[id] < 6000 / 6 * 1.2, `${id} ${cnt[id]} of 6000 (even, no signature half)`);
  // standing: the plain power dunk (the six are all driving finishes)
  for (let k = 0; k < 50; k++) assert.equal(g.dunkStyle(p, true), 'power');
  // an Icon holder with no dunk package of his own (a legend) carries the Icon's; a build without the badge does not
  const legend = new Game({ mode: 'practice', seed: 4, rosters: [[slasher(4, { pkg: null })], []], catalog }).players[0];
  assert.equal(legend.dunkPkg, HS_PKG);
  const plain = new Game({ mode: 'practice', seed: 5, rosters: [[slasher(5, { icon: false, pkg: null })], []], catalog }).players[0];
  assert.equal(plain.dunkPkg, 'dunk_basic');
  for (let k = 0; k < 200; k++) assert.ok(!isHS(new Game({ mode: 'practice', seed: 6, rosters: [[slasher(6, { icon: false, pkg: 'dunk_eastbay' })], []], catalog }).dunkStyle(plain)));
  // the flight: the slam comes past the apex (HS_TIMING.hang of the time above the rim), ~0.6 s after the takeoff
  // against ~0.45 for every other finish from the same spot; he gets to the rim and hangs on it
  const air = style => { const g2 = new Game({ mode: 'practice', seed: 7, rosters: [[slasher(7)], []], catalog }), q = g2.players[0]; const a = attack(g2, q, style); let slam = null, hang = 0; for (let i = 0; i < 150; i++) { g2.step(1 / 60); for (const e of g2.events) if (e.type === 'slam') slam = e; if (q.action?.type === 'hang') hang++; } return { air: a.slam - a.takeoff, slam, hang, hs: a.hs }; };
  const ref = air('eastbay');
  assert.ok(!ref.hs && ref.air < 0.5, `eastbay air ${ref.air.toFixed(2)}`);
  for (const id of HS_IDS) {
    const r = air(id);
    assert.ok(r.hs && r.air > 0.55 && r.air > ref.air + 0.1, `${id}: air ${r.air.toFixed(2)} s`);
    assert.ok(r.slam && r.slam.made && r.slam.hs && r.slam.style === id, `${id} slammed`);
    assert.ok(r.hang >= 30, `${id} hangs on the rim (${r.hang} frames)`);
  }
  assert.equal(hsK({ t: 0.3 - HS_TIMING.pre, takeoff: 0.3, slam: 0.9 }), 0); assert.equal(hsK({ t: 0.9, takeoff: 0.3, slam: 0.9 }), 1);
});

test('the poster: a Hash-Slinging finish goes over the man in the lane and puts most of them flat on their back; the Icon badge fires on every dunk', () => {
  let made = 0, posters = 0, flat = 0, fall = 0, badges = 0, long = 0, N = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = new RNG(seed), me = slasher(seed), opp = makeTeam(rng, 1, { catalog, level: 0.9 })[0];
    const g = new Game({ mode: 'practice', seed, rosters: [[me], [opp]], catalog }), p = g.players[0], d = g.players[1];
    g.ai.think = () => {};
    const rim = g.rimFor(0), side = g.sideFor(0);
    d.setPos(rim.x + 0.1, rim.z - side * 1.0, 0);
    attack(g, p, HS_IDS[seed % 6]); N++;
    let got = false;
    for (let i = 0; i < 150; i++) {
      g.step(1 / 60);
      for (const e of g.events) {
        if (e.type === 'slam' && e.made) { made++; if (e.poster >= 0) posters++; }
        if (e.type === 'posterContact' && e.flat) flat++;
        if (e.type === 'posterContact' && e.fall) { fall++; if (!got) { got = true; assert.ok(d.action?.type === 'stumble' && d.action.flat && d.action.hs, 'knocked flat'); if (d.action.dur >= HS_POSTER.dur0) long++; } }
        if (e.type === 'badge' && e.icon && e.badge === 'hash_slinging') badges++;
      }
    }
  }
  assert.ok(made >= 0.85 * N, `made ${made}/${N}`);
  assert.ok(posters >= 0.85 * N, `posters ${posters}/${N}: he goes over the man in the lane`);
  assert.ok(flat >= 0.7 * N && flat === fall, `flat on his back ${flat}/${N} (fall ${fall})`);
  assert.equal(long, fall, 'and down there for a good three seconds');
  assert.equal(badges, made, 'the Icon badge activates after every dunk he throws down');
  // the same man against a plain package: no knockdown without Posterizer
  let plainFlat = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rng = new RNG(seed), me = slasher(seed, { icon: false, pkg: 'dunk_tomahawk' }), opp = makeTeam(rng, 1, { catalog, level: 0.9 })[0];
    me.badges = {};
    const g = new Game({ mode: 'practice', seed, rosters: [[me], [opp]], catalog }), p = g.players[0], d = g.players[1];
    g.ai.think = () => {};
    const rim = g.rimFor(0), side = g.sideFor(0); d.setPos(rim.x + 0.1, rim.z - side * 1.0, 0);
    attack(g, p, 'tomahawk');
    for (let i = 0; i < 150; i++) { g.step(1 / 60); for (const e of g.events) if (e.type === 'posterContact' && e.flat) plainFlat++; }
  }
  assert.equal(plainFlat, 0);
});

test('the bodies: each of the six is its own, apart from every other dunk in the game and from each other', async () => {
  // the same trace the v0.4.5 stage 7 test uses for packages: 8 joints + the ball through a practice possession, the
  // worst third of the frames averaged; every pair of styles at least MIN apart
  const MIN = 0.17;
  const J = ['handL', 'handR', 'footL', 'footR', 'head', 'hips', 'foreL', 'foreR'].map(k => BONE[k]);
  const styles = [...new Set(list.filter(i => i.slot === 'dunk').flatMap(i => i.styles))];
  assert.ok(styles.length > 30 && HS_IDS.every(id => styles.includes(id)), `${styles.length} dunk styles in the game`);
  const trace = style => {
    const me = slasher(3, { pkg: HS_PKG }), g = new Game({ mode: 'practice', seed: 3, rosters: [[me], []], catalog }), p = g.players[0];
    const model = new AthleteModel(me.build, {}, 1), rig = new Rig(model), view = { H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); this.y = y; } };
    const anim = new Animator(view), out = [];
    attack(g, p, style);
    for (let i = 0; i < 96; i++) {
      g.step(1 / 60);
      const b = g.ball;
      anim.update(1 / 60, { x: p.x, y: p.y, z: p.z, facing: p.facing }, p, g, { x: b.x, y: b.y, z: b.z });
      const c = Math.cos(p.facing), s = Math.sin(p.facing), dx = b.x - p.x, dz = b.z - p.z;
      if (i % 3 === 0) out.push([...J.map(j => [rig.pos[j][0], rig.pos[j][1] + view.y, rig.pos[j][2]]), [c * dx - s * dz, b.y, s * dx + c * dz]]);
    }
    return out;
  };
  const dist = (a, b) => {
    const ms = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) { let m = 0; for (let j = 0; j < a[i].length; j++) m = Math.max(m, Math.hypot(a[i][j][0] - b[i][j][0], a[i][j][1] - b[i][j][1], a[i][j][2] - b[i][j][2])); ms.push(m); }
    ms.sort((x, y) => y - x);
    const k = Math.max(1, Math.round(ms.length / 3));
    return ms.slice(0, k).reduce((x, y) => x + y, 0) / k;
  };
  const T = Object.fromEntries(styles.map(s => [s, trace(s)]));
  let worst = [Infinity];
  for (const id of HS_IDS) for (const other of styles) {
    if (other === id) continue;
    const d = dist(T[id], T[other]);
    if (d < worst[0]) worst = [d, id, other];
    assert.ok(d >= MIN, `${id} vs ${other}: only ${(d * 100).toFixed(1)} cm apart`);
  }
  assert.ok(worst[0] >= MIN, worst.join(' '));
});

test('the knockdown: flat on his back, the trunk along the floor, then up again', () => {
  const me = slasher(9), g = new Game({ mode: 'practice', seed: 9, rosters: [[me], []], catalog }), d = g.players[0];
  const model = new AthleteModel(me.build, {}, 1), rig = new Rig(model), H = model.d.H;
  const view = { H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); } };
  const anim = new Animator(view);
  const a = d.startAction('stumble', 3.3, { fall: true, flat: true, back: false, dir: 1, poster: true, hs: true });
  const at = {}, snap = () => ({ head: rig.pos[BONE.head][1], hips: rig.pos[BONE.hips][1], chest: rig.pos[BONE.chest][1], headZ: rig.pos[BONE.head][2], footZ: Math.max(rig.pos[BONE.footL][2], rig.pos[BONE.footR][2]) });
  for (let i = 0; i < 200; i++) {
    a.t = i / 60;
    anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, d, g, null);
    const q = a.t / a.dur;
    if (i === 2) at.up = snap();
    if (Math.abs(q - 0.5) < 1 / 120) at.down = snap();
    if (Math.abs(q - 0.99) < 1 / 120) at.end = snap();
    for (const j of [BONE.head, BONE.hips, BONE.footL, BONE.footR, BONE.handL, BONE.handR]) for (const c of rig.pos[j]) assert.ok(Number.isFinite(c));
  }
  const { up, down, end } = at;
  assert.ok(down.hips < 0.3 && down.head < 0.35, `flat: hips ${down.hips.toFixed(2)} m, head ${down.head.toFixed(2)} m off the floor`);
  assert.ok(Math.abs(down.head - down.hips) < 0.2 && Math.abs(down.chest - down.hips) < 0.15, `the trunk lies level (head ${down.head.toFixed(2)}, chest ${down.chest.toFixed(2)}, hips ${down.hips.toFixed(2)})`);
  assert.ok(down.headZ < -0.4 && down.footZ > 0.3, `head behind (${down.headZ.toFixed(2)}), feet out in front (${down.footZ.toFixed(2)})`);
  assert.ok(up.head > 0.7 * H && end.head > 0.65 * H, `standing before (${up.head.toFixed(2)}) and after (${end.head.toFixed(2)})`);
});

test('the Icon badge activation: 20% bigger, the badge\'s full art animating, twice as long', () => {
  assert.equal(ICON_POP_K, 2); assert.equal(ICON_POP_ART, 77); assert.equal(BADGE_POP_MS, 1700); assert.equal(BADGE_POP_GAP, 1.9);
  const css = fs.readFileSync(new URL('../client/css/app.css', import.meta.url), 'utf8');
  const base = css.match(/^\.badge-pop \{[^\n]*/m)[0], icon = css.match(/^\.badge-pop\.icon \{[^\n]*/m)[0];
  assert.ok(base.includes('gap: 12px') && base.includes('padding: 7px 18px 7px 8px'));
  assert.ok(icon.includes('gap: 14.4px') && icon.includes('padding: 8.4px 21.6px 8.4px 9.6px'), 'every measure x1.2');
  assert.ok(css.includes('.badge-pop.icon .bp-art { width: 77px; height: 77px; }'), 'the full 64 px art x1.2 (the miniature is 42)');
  assert.ok(css.includes('.badge-pop.icon .bp-text b { font-size: 19.2px') && css.includes('.badge-pop.icon .bp-text small { font-size: 12px'));
  const hud = fs.readFileSync(new URL('../client/js/game/hud.js', import.meta.url), 'utf8');
  assert.ok(hud.includes("iconBadgeSVG(b.key, ICON_POP_ART)") && hud.includes('ICON BADGE ACTIVATED'), 'the Icon art, not the miniature');
  assert.ok(hud.includes('BADGE_POP_MS * k') && hud.includes('this.badgeT = BADGE_POP_GAP * k'), 'the timers scale with ICON_POP_K');
  const session = fs.readFileSync(new URL('../client/js/game/session.js', import.meta.url), 'utf8');
  assert.ok(session.includes("icon: !!e.icon") && session.includes("this.app.config.icon_badges?.[e.badge]"), 'the session passes the Icon activation through');
  // the badge art animates on its own (the spectrum gradient turns)
  return import('../client/js/ui/badgeart.js').then(({ iconBadgeSVG }) => {
    const svg = iconBadgeSVG('hash_slinging', ICON_POP_ART);
    assert.ok(svg.includes('animateTransform') && svg.includes(`width="${ICON_POP_ART}"`));
  });
});

test('hands and the free arm follow the script in the animator', () => {
  const a = { type: 'dunk', style: 'hs_doubledip', takeoff: 0.3, slam: 0.9, t: 0.3 };
  const at = k => { a.t = 0.3 - HS_TIMING.pre + k * (0.9 - 0.3 + HS_TIMING.pre); return dunkHand(a); };
  assert.equal(at(0.1), 'R'); assert.equal(at(0.4), 'L'); assert.equal(at(0.9), 'R');
  a.style = 'hs_stinger'; assert.equal(at(0.5), 'R', 'both hands: the right leads');
  assert.ok(!neutral().some(Number.isNaN) && P.N === 60);
});
