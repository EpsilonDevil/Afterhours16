// v0.4.7.5 quick patch 3: The Jungle Ballers, the park event that takes over from the King Tut Cup on the schedule
// (server/events.json). The theme and its toucan courts, the rainforest props, the rain streak, the AI world
// following the active event, the UI being event-generic, and the seven prizes being the Jungle's own.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THEMES, EVENTS, parkInfo, PARK_COURTS } from '../client/js/world/themes.js';
import * as PR from '../client/js/world/props.js';
import { RNG } from '../client/js/core/rng.js';
import { streakLevel, RAIN } from '../client/js/world/streakfx.js';
import { AIWorld, cupWindow, cupEntrant, EVENT_PARKS, setEventVenue, PARK_NAMES } from '../client/js/sim/world.js';
import { GREEN_FX, GREEN_FX_IDS } from '../client/js/game/greenfx.js';
import { GREEN_SOUNDS, greenRecipe } from '../client/js/core/greensound.js';
import { paintGorilla } from '../client/js/char/looks.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const finite = parts => parts.every(p => p.geo.position.every(Number.isFinite) && (!p.matrix || p.matrix.every(Number.isFinite)));
const top = parts => Math.max(...parts.map(p => { let m = -1e9; for (let i = 1; i < p.geo.position.length; i += 3) m = Math.max(m, p.geo.position[i] + (p.matrix ? p.matrix[13] : 0)); return m; }));

test('the Jungle Ballers theme: a park event with toucan courts, rain for a streak, and its own event entry', () => {
  const t = THEMES.jungle;
  assert.ok(t && t.kind === 'park' && t.event && t.style === 'jungle' && t.streakFx === 'rain');
  assert.equal(t.court.logo.shape, 'toucan'); assert.equal(t.court.baselineText, 'JUNGLE BALLERS');
  assert.ok(!t.court.neon, 'no neon in the jungle');
  // every court in the park takes the theme's logo (the layout is shared); the small courts only shrink it
  assert.equal(PARK_COURTS.length, 6);
  assert.ok(src('client/js/gfx/textures.js').includes("if (shape === 'toucan')") && src('client/js/gfx/textures.js').includes('export function drawToucan'));
  const e = EVENTS.jungle;
  assert.ok(e && e.event && e.exclusive === 'jungle' && e.park === 'The Jungle Ballers' && e.enter && e.prize && e.eyebrow);
  assert.equal(parkInfo('jungle'), e);
  assert.equal(PARK_NAMES.jungle, 'The Jungle Ballers');
  // the King Tut Cup is all still here, just not on the schedule
  assert.ok(THEMES.kingtut && EVENTS.kingtut && EVENTS.kingtut.exclusive === 'cup');
  assert.deepEqual([...EVENT_PARKS].sort(), ['beat', 'favela', 'jungle', 'kingtut', 'monster']); // (v0.4.8.5 quick patches: And The Beat Goes On, the Monster Mash; v0.4.8.7: the Favelas)
});

test('rainforest props: giants with buttress roots over the light poles, canopy clusters, lianas, ferns, the far forest', () => {
  const rng = new RNG(11);
  const tree = PR.rainTree(3, -4, 1, rng);
  assert.ok(finite(tree) && tree.length > 12);
  assert.ok(top(tree) > 18, `a giant stands over the 10 m light poles (${top(tree).toFixed(1)} m)`);
  const small = PR.rainTree(0, 0, 0.45, rng); assert.ok(top(small) > 7 && top(small) < 16);
  const leaves = PR.canopyLeaves(0, 15, 0, 1, rng); assert.ok(finite(leaves) && leaves.length >= 4 && top(leaves) <= 16.2);
  const vine = PR.vine(0, 18, 0, 6, rng); assert.ok(finite(vine) && vine.length >= 1);
  let lowest = 1e9; for (let i = 1; i < vine[0].geo.position.length; i += 3) lowest = Math.min(lowest, vine[0].geo.position[i]);
  assert.ok(lowest < 6.2 && lowest > 5.5, 'the liana hangs down to the height asked');
  assert.ok(finite(PR.vineSwag([0, 15, 0], [20, 16, 5], rng)) && finite(PR.fern(0, 0, 1, rng)) && finite(PR.farTree(100, 50, 1, rng)) && finite(PR.bush(90, 10, 1, rng)));
  // the scenery places the hanging fringe low round the edges (what the game camera sees at the top of its frame)
  const v = src('client/js/world/venues.js');
  assert.ok(v.includes('function jungleScenery') && v.includes('the low fringe') && v.includes("theme.style === 'jungle'"));
  assert.ok(v.includes('function eventBoard') && v.includes("title: 'JUNGLE BALLERS'") && v.includes("title: 'KING TUT CUP'"), 'one leaderboard, two skins');
});

test('the rain streak: four layers that fall in the vertex shader, slanting more by the tier, lightning at the top', () => {
  assert.deepEqual([0, 3, 6, 9, 12].map(streakLevel), [0, 1, 2, 3, 4]);
  assert.equal(RAIN.drops.length, 4);
  for (let i = 1; i < 4; i++) { assert.ok(RAIN.speed[i] > RAIN.speed[i - 1] && RAIN.slant[i] > RAIN.slant[i - 1] && RAIN.len[i] > RAIN.len[i - 1]); }
  assert.ok(RAIN.bolt.every[0] >= 3 && RAIN.bolt.flashes >= 2);
  const sh = src('client/js/gfx/shaders.js'), rd = src('client/js/gfx/renderer.js'), fx = src('client/js/world/streakfx.js');
  assert.ok(sh.includes('#ifdef RAIN') && sh.includes('uniform vec4 uRain') && sh.includes('mod(aPos.y - uTime * uRain.y'));
  assert.ok(rd.includes('RAIN: !!this.rain') && rd.includes("c.set(p, 'uRain', m.rain)"));
  assert.ok(fx.includes("kind === 'rain'") && fx.includes('strike()') && fx.includes('audio.rumble') && fx.includes('this.level >= 4'));
  assert.ok(src('client/js/game/park.js').includes("this.theme?.streakFx || (this.cup ? 'laser' : 'flame')"));
});

test('the AI world sends the event entrants wherever the schedule says, and nowhere when nothing is on', () => {
  const t = Date.now(), w = cupWindow(t), ids = Array.from({ length: 900 }, (_, i) => 'ai-' + i);
  const world = new AIWorld({ seed: 4242, born: t }, {});
  const count = park => { let n = 0, wrong = 0; for (let h = 0; h < 24; h += 2) for (const id of ids) { const s = world.status(id, t + h * 3600000); if (s?.park === park) { n++; if (!cupEntrant(id, cupWindow(t + h * 3600000))) wrong++; } } return [n, wrong]; };
  setEventVenue('jungle');
  let [n, wrong] = count('jungle'); assert.ok(n > 20 && wrong === 0, `entrants at the Jungle (${n})`);
  assert.equal(count('kingtut')[0], 0, 'nobody at the closed Cup');
  assert.ok(world.onlineAt('jungle', t).every(id => cupEntrant(id, w)));
  setEventVenue(null);
  assert.equal(count('jungle')[0] + count('kingtut')[0], 0, 'no event: everyone stays home');
  setEventVenue('kingtut');
  assert.ok(count('kingtut')[0] > 20);
});

test('the UI is event-generic: the card, chip, board, ante, results and store labels come from the schedule', () => {
  const m = src('client/js/ui/modes.js');
  assert.ok(!m.includes('data-park="kingtut"') && m.includes('activeEvent(app)') && m.includes("isn't running right now"));
  assert.ok(m.includes('eventName(r.cup.event)') && m.includes('hub.event?.park'));
  assert.ok(src('client/js/ui/screens.js').includes('EVENTS[app.config.event.id]'));
  for (const f of ['client/js/ui/store.js', 'client/js/ui/inventory.js']) assert.ok(src(f).includes("'★ JUNGLE BALLERS'"), f);
  assert.ok(src('client/js/ui/store.js').includes('Win it in the Jungle Ballers'));
  assert.ok(src('client/js/main.js').includes('setEventVenue(app.config.event?.venue'));
  assert.ok(src('client/css/menus.css').includes('.event-card.off'));
});

test('the seven prizes are the Jungle\'s own: gorilla fur, the Toucan kicks and band, the Chest Beat, the Banana Peel and the Bongos', () => {
  const jb = list.filter(i => i.exclusive === 'jungle');
  assert.equal(jb.length, 7);
  assert.deepEqual(jb.map(i => i.slot).sort(), ['bottom', 'celebration', 'greenfx', 'greensound', 'headband', 'shoes', 'top']);
  assert.ok(jb.every(i => i.price === 0 && i.original_2k_asset === false && i.description.includes('Jungle Ballers')));
  const cup = list.filter(i => i.exclusive === 'cup'); assert.equal(cup.length, 7);
  assert.equal(new Set(jb.map(i => i.name)).size, 7); assert.ok(jb.every(i => !cup.some(c => c.name === i.name || (i.anim && c.anim === i.anim))));
  // the costume: fur painted for the top and the legs, worn skin-tight; a feather on the band
  assert.equal(catalog.jb_gorilla_top.pattern, 'gorilla'); assert.equal(catalog.jb_gorilla_legs.pattern, 'gorilla'); assert.ok(catalog.jb_band_toucan.feather);
  const v = src('client/js/char/view.js'), a = src('client/js/char/athlete.js');
  assert.ok(v.includes("top.pattern === 'gorilla'") && v.includes("paintGorilla(top, 'top')") && v.includes("paintGorilla(bot, 'bottom')"));
  assert.ok(a.includes("bot.pattern === 'gorilla'") && a.includes('gear.headband.feather'));
  assert.ok(src('client/js/sim/bots.js').includes('feather: item(eq.headband).feather'));
  assert.equal(typeof paintGorilla, 'function');
  // the celebration, the effect and the sound are registered
  assert.equal(catalog.jb_celly_chestbeat.anim, 'chestbeat');
  assert.ok(src('client/js/char/animator.js').includes('  chestbeat: (T, t, k'));
  assert.equal(GREEN_FX.jb_gfx_banana, catalog.jb_gfx_banana.name); assert.ok(GREEN_FX_IDS.includes('jb_gfx_banana'));
  assert.ok(src('client/js/game/greenfx.js').includes('fx.flight') && src('client/js/game/session.js').includes('{ flight }'), 'the peel is timed to the make');
  assert.equal(GREEN_SOUNDS.jb_gsnd_bongos, catalog.jb_gsnd_bongos.name); assert.ok(greenRecipe('jb_gsnd_bongos'));
  // a bare bot never picks event exclusives (bots.js filters exclusives: nothing unlocked → nothing worn; the AI world's
  // hoopers wear the prizes they've won, v0.4.8.5 qp7: tests/v0485qp7ai.test.mjs); the server never sells them (test_server.py)
  assert.ok(src('client/js/sim/bots.js').includes('!i.exclusive'));
});

test('the server schedule: the Cup until the end of its last window, then the Jungle; the venues list has both', () => {
  const sched = JSON.parse(fs.readFileSync(new URL('../server/events.json', import.meta.url))).schedule;
  assert.deepEqual(sched.map(s => s.event ?? 'shuffle'), ['kingtut', 'jungle', 'beat', 'monster', 'favela', 'shuffle']); // (v0.4.8.7: the Favelas, then the park shuffle) // (v0.4.8.5 quick patches: the Beat follows the Jungle, the Monster Mash the Beat)
  assert.equal(sched[0].until, sched[1].from); assert.equal(sched[1].until, sched[2].from); assert.equal(sched[2].until, sched[3].from); assert.equal(sched[3].until, sched[4].from); assert.equal(sched[4].until, sched[5].from); assert.equal(sched[5].until, null);
  assert.equal((sched[0].until - 1767225600) % (48 * 3600), 0, 'the handover is on a window boundary');
  const venues = JSON.parse(fs.readFileSync(new URL('../server/venues.json', import.meta.url)));
  assert.ok(venues.some(v => v.id === 'jungle' && v.event) && venues.some(v => v.id === 'kingtut' && v.event));
});
