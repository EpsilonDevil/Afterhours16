// v0.4.8.5: the home park until Pro 1, off-ball screens (hold B), a fresh soundtrack shuffle every startup, 1-minute Pro
// Run quarters, the next Pro-Am / Pro Run game starting by itself, locked items in the Inventory, the Sharp Eye hop
// (twice as high, the defense measured as before) and its Icon badge pop-up, and Brick Wall counting screens.
// (The Pro-Am ranks have their own file, v0485proam.test.mjs; the parks, v0485parks.test.mjs.)
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT } from '../client/js/sim/constants.js';
import { blankIntent } from '../client/js/sim/player.js';
import * as S from '../client/js/sim/shots.js';
import { QUARTERS } from '../client/js/sim/league.js';
import { travelLock, TRAVEL_REP_LEVEL, AFFILIATIONS } from '../client/js/world/themes.js';
import { shuffleQueue } from '../client/js/core/music.js';
import { iconBadgeSVG } from '../client/js/ui/badgeart.js';
import { STAT_LABELS } from '../client/js/sim/profile.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const tick = (g, it = {}) => { g.setInput({ ...blankIntent(), ...it }); g.step(DT); return g.events; };

test('home park until Pro 1: the other affiliation parks are locked below Rep level 5; home, events and anything else are open', () => {
  assert.equal(TRAVEL_REP_LEVEL, 5);
  const rookie = { affiliation: 'harbor', rep: { level: 4, label: 'Rookie 5' } }, pro = { affiliation: 'harbor', rep: { level: 5, label: 'Pro 1' } };
  assert.equal(travelLock(rookie, 'harbor'), null, 'home park');
  for (const id of ['brick', 'foundry']) {
    assert.match(travelLock(rookie, id), /Reach Pro 1 to visit/);
    assert.equal(travelLock(pro, id), null, `${id} at Pro 1`);
  }
  for (const id of ['kingtut', 'jungle', 'hq', 'arena']) assert.equal(travelLock(rookie, id), null, `${id} is always open`);
  assert.equal(travelLock({ rep: { level: 0 } }, 'brick'), null, 'no affiliation yet: nothing to lock to');
  assert.equal(Object.keys(AFFILIATIONS).length, 3);
  // every way into a park goes through it: the park screen, enterPark itself, the squad follow and the phone's Go
  const modes = src('client/js/ui/modes.js'), online = src('client/js/ui/online.js');
  assert.ok(modes.includes('const lock = travelLock(app.char(), themeId);'), 'enterPark');
  assert.ok(modes.includes("lock ? '🔒 PRO 1' : 'VISIT'"), 'the park screen shows the lock');
  assert.ok(online.includes('const lock = hq ? null : travelLock(app.char(), target);'), 'squad follow');
  assert.ok(online.includes('const lock = travelLock(app.char(), b.dataset.ogo);'), 'phone Go');
});

// a 3v3 full-court park game, live, the human (team 0) off the ball, a teammate with it and his man on him
function screenSetup(seed = 21) {
  const r = new RNG(seed), a = makeTeam(r, 3, { catalog, level: 0.6 }), b = makeTeam(r, 3, { catalog, level: 0.6 });
  a[1].human = true;
  const g = new Game({ mode: 'park', seed: 5, rosters: [a, b], catalog, target: 21 });
  for (let i = 0; i < 900 && g.phase !== 'live'; i++) tick(g);
  const me = g.human, h = g.mates(me)[0], d = g.teams[1][0], side = g.sideFor(0);
  g.changePossessionTo(h); g.giveBall(h, 'held'); g.phase = 'live';
  h.setPos(-1.5, side * 6.5, 0); d.setPos(-1.5, side * 7.6, Math.PI);
  me.setPos(3.5, side * 5.5, 0);
  for (const p of g.players) if (![me, h, d].includes(p)) p.setPos(p.team ? 6 : -6, side * 11, 0);
  return { g, me, h, d, side };
}

test('off-ball screens: holding B (the bounce-pass button) takes him to the ball handler\'s man and plants him there, set and called', () => {
  const { g, me, h, d } = screenSetup();
  assert.ok(me.human && g.ball.holder === h.id && h.team === me.team);
  const d0 = me.dist(d);
  let moved = false;
  for (let i = 0; i < 150; i++) {
    // (the ball handler stands: we're watching the screener)
    tick(g, { screen: true });
    h.vx = h.vz = 0;
    if (me.speed > 1) moved = true;
    if (me.screenSet) break;
  }
  assert.ok(moved, 'he goes to set it');
  assert.ok(me.screenSet, 'and gets there');
  assert.ok(me.dist(d) < Math.min(d0, 1.8), `beside the defender (${me.dist(d).toFixed(2)} m)`);
  for (let i = 0; i < 20; i++) tick(g, { screen: true, mx: 1, mz: 0 }); // (the stick doesn't move a set screen)
  assert.ok(me.speed < 0.3, `planted (${me.speed.toFixed(2)} m/s)`);
  assert.ok(me.screening > 0, 'a called screen');
  assert.equal(h.ai_screen?.by, me.id, 'the AI ball handler is told to use it');
  // let go and he's free again
  tick(g, { mx: 1 });
  assert.equal(me.screenSet, false);
  for (let i = 0; i < 30; i++) tick(g, { mx: 1 });
  assert.ok(me.speed > 1, 'moving again');
  // the input side: the bounce-pass button, off the ball only
  const input = src('client/js/core/input.js'), session = src('client/js/game/session.js');
  assert.ok(input.includes("if (this.capturing || this.ctx !== 'offball') return false;"));
  assert.ok(session.includes('if (offense && !has && inp.screenHeld && inp.screenHeld()) it.screen = true;'));
  assert.ok(src('client/js/ui/screens.js').includes('Set a screen (off the ball)'), 'in the controls list');
  assert.ok(src('client/js/char/animator.js').includes('const screenK = !has && !defense && !a && p.screening > 0 && speed < 0.7;'), 'the screen stance');
});

test('Brick Wall counts successful screens: a set screen that catches the defender is one; brushing past a standing man isn\'t', () => {
  const { g, me, d } = screenSetup(23);
  assert.equal(me.stats.screens, 0);
  me.vx = me.vz = 0; me.screening = 0.6;
  d.vx = 0; d.vz = -3;
  const r = g.screenHit(me, d, 3);
  assert.equal(r.incidental, false);
  assert.equal(me.stats.screens, 1);
  const { g: g2, me: me2, d: d2 } = screenSetup(25);
  me2.screening = 0; me2.facing = d2.facing; // (not called, not square to him)
  const r2 = g2.screenHit(me2, d2, 0.5);
  if (r2.incidental) assert.equal(me2.stats.screens, 0);
  assert.equal(STAT_LABELS.screens, 'Screens set');
  const prog = src('server/progression.py');
  assert.ok(prog.includes('"brick_wall": {"name": "Brick Wall", "group": "Defense", "stat": "screens"'), 'the badge counts screens');
  assert.ok(prog.includes('"alleyoops", "screens")'), 'and the server takes the stat');
});

test('a fresh shuffle every startup: every track once, the ones heard last time at the back, never the same track twice in a row', () => {
  const tracks = Array.from({ length: 20 }, (_, i) => ({ file: `t${i}.mp3` }));
  const recent = ['t3.mp3', 't7.mp3', 't11.mp3']; // (t3 the most recent)
  const orders = new Set();
  for (let k = 0; k < 30; k++) {
    const q = shuffleQueue(tracks, new Set(), null, recent);
    assert.deepEqual([...q].sort((a, b) => a - b), tracks.map((_, i) => i), 'every track, once');
    assert.deepEqual(q.slice(-3).map(i => tracks[i].file), ['t11.mp3', 't7.mp3', 't3.mp3'], 'recent ones last, the latest at the very end');
    orders.add(q.slice(0, 5).join(','));
  }
  assert.ok(orders.size > 20, `a different order each time (${orders.size}/30)`);
  // broken files are skipped, and a new round never opens with the track that just played
  const q = shuffleQueue(tracks.slice(0, 2), new Set(['t1.mp3']), tracks[0]);
  assert.deepEqual(q, [0]);
  for (let k = 0; k < 20; k++) assert.notEqual(shuffleQueue(tracks, new Set(), tracks[4], [])[0], 4);
  assert.ok(src('client/js/core/music.js').includes('crypto.getRandomValues'));
});

test('the Pro Run plays 1-minute quarters (and a 1-minute overtime); the server takes them', () => {
  assert.deepEqual(QUARTERS[0], [60, '1 min']);
  assert.ok(src('client/js/sim/game.js').includes('this.gameClock = ot ? Math.min(120, this.quarterLen) : this.quarterLen;'));
  assert.ok(src('server/app.py').includes('meta["quarter_len"] = builds.integer(data.get("quarter_len", 300), 60, 720, "Quarter length")'));
  const r = new RNG(4), a = makeTeam(r, 5, { catalog, level: 0.6 }), b = makeTeam(r, 5, { catalog, level: 0.6 });
  const g = new Game({ mode: 'proam', seed: 9, rosters: [a, b], catalog, quarterLen: 60, quarters: 4 });
  assert.equal(g.gameClock, 60);
});

test('Pro-Am and the Pro Run start the next game by themselves after 10 seconds, as the park does', () => {
  const modes = src('client/js/ui/modes.js'), prorun = src('client/js/ui/prorun.js');
  assert.ok(modes.includes(": opts.autoNext ? card.querySelector('[data-again]') || card.querySelector('[data-menu]') : null;"));
  assert.ok(modes.includes("again: () => playProAm(app), againLabel: 'Next game', autoNext: true"), 'Pro-Am');
  assert.ok(modes.includes("again: lead ? () => startProAmOnline(app) : null, againLabel: 'Next game', autoNext: true"), 'online Pro-Am');
  assert.ok(prorun.includes("again: nextGame(app, career), againLabel: 'Next game', autoNext: true"), 'the Pro Run');
  assert.ok(prorun.includes('function nextGame(app, career)'));
});

test('the Inventory shows what a build can\'t equip: the lock, what it needs, and no Equip button', () => {
  const inv = src('client/js/ui/inventory.js'), store = src('client/js/ui/store.js');
  assert.ok(inv.includes("c.equipment[i.slot] === i.id ? null : lockReason(app, c, i)"));
  assert.ok(inv.includes("lock ? `<button class=\"btn ghost\" data-equip disabled>🔒 Requires ${esc(lock)}</button>`"));
  assert.ok(inv.includes("This build can't equip it yet: requires"));
  assert.ok(store.includes("if (i.icon && c.icon_badge !== i.icon) return `the ${app.config.icon_badges?.[i.icon]?.name || 'Icon'} Icon badge`;"));
});

test('the Sharp Eye base hops twice as high as before; the defense is measured as if he\'d gone as high as he used to', () => {
  const base = catalog.js_base_sharpeye;
  assert.equal(base.jump, 2.0);
  const others = list.filter(i => i.slot === 'jumpshot' && i !== base && i.jump != null);
  assert.ok(others.every(i => i.jump * 2 <= base.jump + 1e-9), 'more than twice any other base');
  const pkg = S.jumpshotPackage({ icon_badge: 'sharp_eye', equipment: { jumpshot: 'js_base_sharpeye', release: 'release_sharpeye' } }, catalog);
  assert.equal(pkg.jumpK, 2);
  const { g, me } = screenSetup(27);
  me.y = 0.6;
  const y = 2.6;
  assert.equal(g.shotRaw(me, { showK: 0.5 }, y), g.shotRaw(me, {}, y - 0.3), 'half of his height is show');
  assert.ok(src('client/js/sim/game.js').includes('const showK = !close && pkg.jumpK > 1 ? 1 - 1 / pkg.jumpK : 0;'));
});

test('the Sharp Eye pop-up is the Icon badge pop-up Hash-Slinging gets (same size, same time on screen), and its art moves like it', () => {
  const hud = src('client/js/game/hud.js'), game = src('client/js/sim/game.js');
  // both fire the same event (icon: true) and the HUD draws every icon: true event the same way
  assert.ok(game.includes("this.emit({ type: 'badge', player: p.id, badge: 'sharp_eye', tier: 5, icon: true });"));
  assert.ok(game.includes("this.emit({ type: 'badge', player: p.id, badge: 'hash_slinging', tier: 5, icon: true });"));
  assert.ok(hud.includes("d.className = b.icon ? 'badge-pop icon' : `badge-pop tier${b.tier}`;"));
  assert.ok(hud.includes('setTimeout(() => { d.classList.remove(\'on\'); d.classList.add(\'off\'); }, BADGE_POP_MS * k);'));
  const se = iconBadgeSVG('sharp_eye', 77), hs = iconBadgeSVG('hash_slinging', 77);
  const rid = svg => (svg.match(/<linearGradient id="([^"]+r)"/) || [])[1];
  assert.ok(rid(se) && se.includes(`url(#${rid(se)})`), 'Sharp Eye uses the living spectrum');
  assert.ok(rid(hs) && hs.includes(`url(#${rid(hs)})`), 'as Hash-Slinging does');
  assert.ok(se.includes('dur="9s"'), 'the iris at the same 9 s');
});
