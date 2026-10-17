// v0.4.8.5 quick patch 5: The General (the Two-Way Icon badge): "+2.5% to every attribute (can pass 99). Unlocks an
// exclusive salute celebration." The audit found the salute within 10 cm of the store's Celebration: Salute (a 0.3 s
// stomp and a pinned left arm apart), forced over whatever celebration he wore, with no item and no preview. Now it is an
// Icon item, The General's Salute (cel_general_salute, kind 'general'), unmistakably its own on the rig, and his
// celebrations are what he equips, everywhere (online the kind goes with the input).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam, makeBot } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { Player, blankIntent } from '../client/js/sim/player.js';
import { inStore, forBuild } from '../client/js/sim/builds.js';
import { PreviewSim } from '../client/js/game/preview.js';
import { MatchSession } from '../client/js/game/session.js';
import { Animator } from '../client/js/char/animator.js';
import { AthleteModel } from '../client/js/char/athlete.js';
import { Rig } from '../client/js/char/rig.js';
import { B } from '../client/js/char/skeleton.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const ID = 'cel_general_salute';

test('The General\'s Salute: an Icon celebration item, the holder\'s alone, free, never in the store', () => {
  const it = catalog[ID];
  assert.ok(it);
  assert.equal(it.slot, 'celebration'); assert.equal(it.category, 'animation'); assert.equal(it.anim, 'general');
  assert.deepEqual([it.exclusive, it.icon, it.secret, it.price, it.original_2k_asset], ['icon', 'the_general', true, 0, false]);
  assert.deepEqual([it.min_overall, it.rep_required, it.min_attr], [0, 0, {}]);
  assert.ok(it.name.includes("The General's Salute") && it.description.includes('The General Icon badge'));
  assert.deepEqual(list.filter(i => i.icon === 'the_general').map(i => i.id), [ID]);
  assert.equal(list.filter(i => i.anim === 'general').length, 1, 'the only item with that celebration');
  assert.equal(inStore(it), false);
  assert.equal(forBuild(it, { icon_badge: 'the_general' }), true);
  for (const ic of [null, 'sexy_red', 'clamp']) assert.equal(forBuild(it, { icon_badge: ic }), false);
  const r = new RNG(5);
  for (let i = 0; i < 200; i++) assert.notEqual(makeBot(r, { catalog, level: 1, rep: 20, flash: 1, archetype: 'two_way' }).build.equipment.celebration, ID);
  // the store salute is still on sale, as it was
  assert.equal(catalog.celly_salute.anim, 'salute'); assert.equal(catalog.celly_salute.price, 1170);
});

// a celebration on the rig: every frame's joints (character space, m) for t in (0, dur]
function play(kind, dur = 1.6, build = { height: 78, weight: 215, wingspan: 82, hand: 'R', archetype: 'two_way', icon_badge: 'the_general', attributes: {}, equipment: {} }) {
  const p = new Player(0, 0, { build, name: 'Gen', human: true }, catalog), model = new AthleteModel(build, {}, 0.5), rig = new Rig(model);
  const anim = new Animator({ H: model.d.H, model, rig, y: 0, update(pose, x, y, z, yaw, o) { rig.solve(pose, o); } });
  for (let i = 0; i < 30; i++) anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
  p.startAction('celebrate', dur, { kind });
  const out = [];
  for (let i = 0; i < Math.round(dur * 60); i++) {
    p.action.t += 1 / 60; anim.update(1 / 60, { x: 0, y: 0, z: 0, facing: 0 }, p, null, null);
    const pos = Object.fromEntries(['hips', 'head', 'chest', 'handL', 'handR', 'foreL', 'foreR', 'footL', 'footR', 'thighL', 'thighR'].map(b => [b, rig.pos[B[b]].slice()]));
    const L = [pos.thighL[0] - pos.thighR[0], pos.thighL[2] - pos.thighR[2]];
    out.push({ t: p.action.t, pos, yaw: Math.atan2(-L[1], L[0]) });
  }
  return out;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('on the rig it is nothing like the store Salute: different arm path, body turn, legs and timing, by a clear margin', () => {
  const G = play('general'), S = play('salute'), parts = ['handR', 'foreR', 'handL', 'foreL', 'footL', 'footR', 'head'];
  // (measured like the audit: the joints frame by frame; the old one was within 10 cm of the store's)
  const per = parts.map(b => G.reduce((s, f, i) => s + dist(f.pos[b], S[i].pos[b]), 0) / G.length);
  const mean = per.reduce((a, b) => a + b) / per.length, maxR = Math.max(...G.map((f, i) => dist(f.pos.handR, S[i].pos.handR)));
  assert.ok(mean > 0.12, `mean joint distance ${mean.toFixed(3)} m`);
  assert.ok(per[0] > 0.25, `the saluting hand: ${per[0].toFixed(3)} m on average`);
  assert.ok(maxR > 0.6, `and ${maxR.toFixed(2)} m apart at most`);
  assert.ok(per[2] > 0.08, `the other hand: ${per[2].toFixed(3)} m`);
  assert.ok(Math.max(...G.map((f, i) => Math.max(dist(f.pos.footL, S[i].pos.footL), dist(f.pos.footR, S[i].pos.footR)))) > 0.2, 'the legs');
  // the beats: the stomp, the slow salute up through a wide arm, the turn to the crowd, the cut, the march
  const at = t => G[Math.min(G.length - 1, Math.round(t * 60) - 1)];
  assert.ok(at(0.2).pos.footR[1] - at(0.08).pos.footR[1] > 0.15, 'the right knee comes up for the stomp');
  assert.ok(Math.abs(at(0.38).pos.footR[1] - at(0.08).pos.footR[1]) < 0.03, 'and stamps down');
  assert.ok(at(0.5).pos.handR[0] < -0.5, 'the arm swings out wide first');
  const brow = at(0.85).pos.handR, head = at(0.85).pos.head;
  assert.ok(brow[1] > head[1] - 0.06 && dist(brow, head) < 0.35, 'then the hand is at the brow');
  assert.ok(Math.max(...G.filter(f => f.t > 0.6 && f.t < 1.1).map(f => f.yaw)) > 0.7, 'turned with it to the crowd');
  assert.ok(Math.max(...S.map(f => Math.abs(f.yaw))) < 0.15, '(the store salute never turns)');
  assert.ok(Math.abs(at(1.45).yaw) < 0.15, 'square again for the march');
  assert.ok(at(1.4).pos.handR[2] > 0.45 && at(1.4).pos.handR[1] > at(1.4).pos.chest[1], 'forward, march: the arm thrown out upcourt');
  assert.ok(at(1.4).pos.footL[2] - at(1.0).pos.footL[2] > 0.15, 'with a step forward');
  assert.ok(Math.abs(at(1.4).pos.handL[1] - at(1.4).pos.hips[1]) < 0.2 && at(1.4).pos.handL[0] > 0.2, 'the other fist on his hip');
  // (and the AI's dead-ball 1.5 s holds the march too)
  const A15 = play('general', 1.5); assert.ok(A15[Math.round(1.32 * 60)].pos.handR[2] > 0.45);
  // (the store salute just holds the hand up at the brow: its right hand stays put after the first half second)
  const sHold = S.find(f => f.t > 0.8).pos.handR, sMove = Math.max(...S.filter(f => f.t > 0.5 && f.t < 1.25).map(f => dist(f.pos.handR, sHold)));
  assert.ok(sMove < 0.12, `${sMove.toFixed(3)}`);
  // a celebration's length: the in-game 1.5-1.6 s holds every beat; the store preview's 2.4 s holds the march
  const P24 = play('general', 2.4);
  assert.ok(P24[Math.round(2.0 * 60)].pos.handR[2] > 0.45, 'held to the end of a longer one');
  for (const f of [...G, ...P24]) for (const v of Object.values(f.pos)) for (const c of v) assert.ok(Number.isFinite(c));
});

test('his celebration is what he equips, The General or not (the forced salute is gone), online too', () => {
  assert.ok(!src('client/js/game/session.js').includes("if (p.icon === 'the_general') return 'general';"));
  const kind = (icon, celebration, id = 0) => MatchSession.prototype.celebrationKind.call({ catalog }, { id, icon, entry: { build: { equipment: celebration ? { celebration } : {} } } });
  assert.equal(kind('the_general', ID), 'general');
  assert.equal(kind('the_general', 'celly_flex'), 'flex');
  assert.equal(kind('the_general', 'celly_salute'), 'salute');
  assert.equal(kind('the_general', null, 1), 'chest', 'nothing on: the default, as for anyone');
  assert.equal(kind(null, 'celly_shimmy'), 'shimmy');
  // online the kind goes with the input (session P.celebrate → it.celebrate) and the game plays it as sent
  const s = src('client/js/game/session.js');
  assert.ok(s.includes('P.celebrate = { kind: this.celebrationKind(me), ttl: 0.1 }') && s.includes('if (P.celebrate) it.celebrate = P.celebrate.kind;'));
  const r = new RNG(3), a = makeTeam(r, 2, { catalog, level: 0.7 }), b = makeTeam(r, 2, { catalog, level: 0.7 });
  a[0].human = true; a[0].build.icon_badge = 'the_general'; a[0].build.equipment = { ...a[0].build.equipment, celebration: ID };
  const g = new Game({ mode: 'park', seed: 3, rosters: [a, b], catalog, target: 21 }), me = g.players[0];
  g.phase = 'dead'; g.ball.holder = -1; me.action = null; me.airborne = false;
  me.intent = { ...blankIntent(), celebrate: 'general' };
  g.multiPresses();
  assert.equal(me.action?.type, 'celebrate'); assert.equal(me.action.kind, 'general');
});

test('the preview: MyPlayer\'s Celebration row and the Inventory play it in the showroom', () => {
  const build = { height: 78, weight: 215, wingspan: 82, hand: 'R', archetype: 'two_way', icon_badge: 'the_general', attributes: {}, equipment: { celebration: ID } };
  const sim = new PreviewSim(); sim.setPlayer(build, catalog); sim.setPreview('celebrate', { kind: catalog[ID].anim });
  sim.step(1 / 60, 0);
  assert.equal(sim.player.action?.type, 'celebrate'); assert.equal(sim.player.action.kind, 'general');
  const mp = src('client/js/ui/myplayer.js'), store = src('client/js/ui/store.js'), inv = src('client/js/ui/inventory.js');
  assert.ok(mp.includes("['celebration', 'Celebration', 'celebrate']") && mp.includes("kind: cel?.anim || 'flex'"));
  assert.ok(mp.includes('inv.has(i.id) && forBuild(i, c)'));
  assert.ok(store.includes("else if (item.slot === 'celebration') app.showroom.setPreview('celebrate', { kind: item.anim });"));
  assert.ok(inv.includes('tryOn(app, c, item, cat)'));
  assert.ok(src('client/js/char/animator.js').includes("kind === 'general'"));
});
