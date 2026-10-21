// v0.4.8.7 quick patch 7: real players see each other's emotes. A celebration in the park (or the Crew HQ) used to play on
// the sender's screen alone: nothing of it went out (the others' copy of him only had his walk: 'pos'). Now it goes to the
// service (Net.emote: the item worn, or a default), which checks it and names its animation (server/online.py emote), and
// everyone else there plays it on him (Peers.emote, FriendWalker plays it out). In games the celebration already goes with
// the lockstep input (it.celebrate, the animation's name) and plays on every screen. Also: the park's host is the service's
// pick (Net.host, 'host' / 'here'), and a newcomer gets the park as the host had it a moment ago (the pop in 'here').
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { Peers, FriendWalker, ParkHub } from '../client/js/game/park.js';
import { Net } from '../client/js/core/netplay.js';
import { intentDelta, applyDelta, normIntent } from '../client/js/sim/wire.js';

const fakeNet = (place = 'harbor') => {
  const subs = new Map(), sent = [];
  return { place, connected: true, people: new Map([['acc-2', { id: 'acc-2' }]]), myId: 'acc-1', sent,
    on(t, fn) { subs.set(t, fn); return () => subs.delete(t); }, fire(t, m) { subs.get(t)?.(m); }, has: t => subs.has(t),
    emote(item, kind, dur) { sent.push({ t: 'emote', ...(item ? { item } : { kind }), dur }); return true; } };
};
// a remote player's walker: the real class, without a renderer
function friend(x = 0, z = 0) {
  const w = Object.create(FriendWalker.prototype);
  w.visual = { pending: false, dispose() {} };
  w.target = { x, z, f: 0, m: 0 };
  w.p = { x, z, facing: 0, intent: {}, action: null, stamina: 1, setPos(a, b) { this.x = a; this.z = b; }, move() {},
    startAction(type, dur, data = {}) { this.action = { type, t: 0, dur, ...data, id: 1 }; return this.action; } };
  return w;
}

test('an emote from someone here plays on his walker, with the animation the service named, and plays out', () => {
  const net = fakeNet(), world = { app: { net }, placeKey: () => 'harbor', parkList: true };
  const peers = new Peers(world), w = friend();
  peers.map.set('acc-2', w);
  assert.ok(net.has('emote'), 'listening for emotes');
  net.fire('emote', { t: 'emote', from: 'acc-2', kind: 'passinho', item: 'fv_celly_passinho', dur: 1.6 });
  assert.equal(w.p.action?.type, 'celebrate'); assert.equal(w.p.action.kind, 'passinho');
  for (let i = 0; i < 10; i++) w.update(0.1);
  assert.ok(w.p.action && w.p.action.t > 0.9, 'it plays while he stands there');
  for (let i = 0; i < 10; i++) w.update(0.1);
  assert.equal(w.p.action, null, 'and ends');
  // somebody not here, another place, nonsense: nothing
  assert.equal(peers.emote({ from: 'acc-9', kind: 'flex' }), false);
  net.place = 'brick'; assert.equal(peers.emote({ from: 'acc-2', kind: 'flex' }), false); net.place = 'harbor';
  assert.equal(peers.emote({ from: 'acc-2', kind: 7 }), false);
  peers.detach(); assert.ok(!net.has('emote'), 'the park gone: no longer listening');
});

test('a celebration in the park goes out to the people here: the item worn, or the default with nothing on', () => {
  const net = fakeNet();
  const hub = Object.create(ParkHub.prototype);
  const me = { action: null, startAction(type, dur, d) { this.action = { type, dur, ...d }; } };
  Object.assign(hub, { me, char: { equipment: { celebration: 'fv_celly_passinho' } }, app: { catalog: { fv_celly_passinho: { anim: 'passinho', slot: 'celebration' } } }, netHere: () => net });
  hub.celebrate(me);
  assert.equal(me.action.kind, 'passinho', 'on your own screen');
  assert.deepEqual(net.sent.at(-1), { t: 'emote', item: 'fv_celly_passinho', dur: 1.6 }, 'and to the others');
  hub.char = { equipment: {} }; me.action = null; hub.celebrate(me);
  assert.equal(me.action.kind, 'flex'); assert.deepEqual(net.sent.at(-1), { t: 'emote', kind: 'flex', dur: 1.6 });
  // alone here: nothing to send
  net.people.clear(); const n = net.sent.length; me.action = null; hub.celebrate(me); assert.equal(net.sent.length, n);
});

test('in a game the celebration rides the lockstep input, so every screen plays the same one', () => {
  const it = normIntent({ mx: 0.5, celebrate: 'general' }), d = intentDelta({}, it);
  assert.equal(applyDelta({}, d).celebrate, 'general', 'the animation\'s name goes on the wire as it is');
  assert.equal(applyDelta(applyDelta({}, d), intentDelta(it, normIntent({ mx: 0.5 }))).celebrate, undefined, 'and is gone the tick after');
});

test('the park\'s host is the service\'s pick, and a newcomer gets the park as the host had it', () => {
  const net = new Net(), pops = [], hosts = [];
  net.on('pop', m => pops.push(m)); net.on('host', m => hosts.push(m));
  net.receive({ t: 'here', place: 'harbor', players: [{ id: 'acc-3' }], courts: {}, games: [], host: 'acc-3', pop: { t: 'pop', place: 'harbor', from: 'acc-3', courts: [] } });
  assert.equal(net.host, 'acc-3'); assert.equal(pops.length, 1);
  net.receive({ t: 'host', place: 'harbor', id: 'acc-1' }); assert.equal(net.host, 'acc-1'); assert.equal(hosts.length, 1);
  net.receive({ t: 'host', place: 'brick', id: 'acc-9' }); assert.equal(net.host, 'acc-1', 'another park\'s host isn\'t ours');
  // the park asks the service's pick first
  const hub = Object.create(ParkHub.prototype);
  const n2 = { connected: true, place: 'harbor', myId: 'acc-1', host: 'acc-5', people: new Map([['acc-5', {}], ['acc-0', {}]]) };
  Object.assign(hub, { themeId: 'harbor', app: { net: n2 } });
  assert.equal(hub.popHostId(), 'acc-5', 'the service\'s pick, not the lowest id');
  n2.host = 'acc-7'; assert.equal(hub.popHostId(), 'acc-0', 'a pick who isn\'t here (yet): the lowest id');
});
