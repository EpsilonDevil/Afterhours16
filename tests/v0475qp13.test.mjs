// v0.4.7.5 quick patch 3 (part 3): online play in the base game itself. The people at the same park, real squads, Got
// Next with real squads, Pro-Am with squads and challenges, online crews and their HQ runs, and watching games.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { DT } from '../client/js/sim/constants.js';
import { Net } from '../client/js/core/netplay.js';
import { seatPeople, setupEntry, inputDelay, crewMatesIn, reportCrewXP, whereNow } from '../client/js/ui/online.js';
import { MatchSession } from '../client/js/game/session.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url)));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));

test('online: where you are, its people, courts and games come from the hosted game; a game you watch gets its inputs (and the game so far)', () => {
  const n = new Net();
  const seen = [];
  n.on('people', m => seen.push('people:' + (m?.t || 'here')));
  n.on('courts', () => seen.push('courts'));
  n.receive({ t: 'here', place: 'harbor', players: [{ id: 'b', username: 'bee', name: 'Bo', entry: { name: 'Bo' }, rtt: 50 }], courts: { 2: { lines: [{ leader: 'b', members: ['b'], names: ['Bo'], at: 1 }, null], kings: null, busy: null } }, games: [] });
  assert.equal(n.place, 'harbor'); assert.ok(n.people.has('b')); assert.equal(n.court(2).lines[0].leader, 'b');
  n.receive({ t: 'pentry', id: 'c', username: 'cee', name: 'Cy', entry: { name: 'Cy' } });
  n.receive({ t: 'gone', id: 'b', place: 'harbor' });
  assert.deepEqual([...n.people.keys()], ['c']);
  n.receive({ t: 'courts', place: 'brick', courts: {} }); // (another park's: not ours)
  assert.ok(n.court(2));
  assert.deepEqual(seen, ['people:here', 'courts', 'people:pentry', 'people:gone']);
  // a game here starts while you walk around: its first inputs come before the watch, the rest after
  n.receive({ t: 'in', s: 0, k: 4, g: 7, i: { mx: 1 } });
  n.receive({ t: 'watch', setup: { game: 7 }, log: [[0, 2, {}], [0, 3, { mz: 1 }]] });
  n.receive({ t: 'in', s: 0, k: 5, g: 7, i: {} });
  const got = [];
  const off = n.attachWatch(7, m => got.push(m.k));
  n.receive({ t: 'in', s: 0, k: 6, g: 7, i: {} });
  assert.deepEqual(got.sort((a, b) => a - b), [2, 3, 4, 5, 6]);
  off();
  // your own game's messages still go to your game
  n.receive({ t: 'start', setup: { game: 8 } });
  n.receive({ t: 'in', s: 1, k: 4, g: 8, i: {} });
  assert.deepEqual(n.inbox.map(m => m.k), [4]);
  // squads and crews
  n.receive({ t: 'hello', you: { id: 'a', username: 'me' }, friends: [] });
  n.receive({ t: 'squad', squad: { id: 's', leader: 'c', members: [{ id: 'c', park: 'harbor', inGame: false }, { id: 'a', park: 'harbor', inGame: false }] } });
  assert.equal(n.isLeader(), false); assert.equal(n.squadLeader(), 'c');
  assert.deepEqual(n.squadHere().map(m => m.id), ['c']);
  n.receive({ t: 'squad', squad: null });
  assert.equal(n.isLeader(), true);
  n.receive({ t: 'crew', crew: { id: 'c', founder: 'c', members: [{ id: 'a' }, { id: 'c' }, { id: 'd' }] } });
  assert.equal(crewMatesIn({ net: n }, ['a', 'c', 'x']), 1, 'your crew mates on your side (not you)');
});

test('online setups: people seated by their roster entries, looks resolved the same everywhere, the input delay from their round trips', () => {
  const app = { catalog };
  const [a, b, c] = makeTeam(new RNG(5), 3, { catalog, level: 0.6 });
  const ea = setupEntry(app, { ...a, aiId: 'x1' }, true, 'andy'), eb = setupEntry(app, b, false), ec = setupEntry(app, c, true, 'cee');
  assert.equal(ea.aiId, undefined, 'no AI ids from one player\'s world in a setup');
  assert.ok(ea.look && eb.look, 'looks resolved');
  assert.equal(ea.username, 'andy'); assert.equal(eb.human, false);
  const people = new Map([[ea, { id: 'A', username: 'andy' }], [ec, { id: 'C', username: 'cee' }]]);
  const seats = seatPeople([[ea, eb], [ec]], people);
  assert.deepEqual(seats.slots, { A: 0, C: 2 });
  assert.deepEqual(seats.names, { 0: 'andy', 2: 'cee' });
  assert.ok(inputDelay([0, 150]) > inputDelay([0, 0]));
});

test('online: a game watched from the sideline is the same game as the players\' (celebrations included)', () => {
  // the part of the events that changes the game runs the same for a player and for a watcher
  const R = [makeTeam(new RNG(3), 3, { catalog, level: 0.7 }), makeTeam(new RNG(4), 3, { catalog, level: 0.7 })];
  R[0][0].human = true; R[1][0].human = true;
  const mk = () => new Game({ mode: 'park', seed: 77, rosters: structuredClone(R), catalog, target: 11, multi: true, inputDelay: 3 });
  const g1 = mk(), g2 = mk();
  const run = (g, spectate) => {
    const s = Object.create(MatchSession.prototype);
    s.game = g; s.catalog = catalog; s.spectate = spectate;
    for (let k = 1; k <= 3000; k++) {
      for (const p of g.players) if (p.human) g.humanIntents.set(p.id, {});
      g.step(DT);
      MatchSession.prototype.celebrationEffects.call(s, g.events);
    }
    return g.stateHash();
  };
  assert.equal(run(g1, false), run(g2, true));
  // and the watcher's events path calls it
  assert.match(src('client/js/game/session.js'), /backgroundEvents\(events\) \{\s*const g = this\.game, \[ox, , oz\] = this\.origin;\s*if \(this\.spectate\) this\.celebrationEffects\(events\);/);
  assert.doesNotMatch(src('client/js/game/session.js').split('handleEvents(events) {')[1].split('celebrationEffects(events) {')[0], /g\.rng\.next\(\)/, 'no rng in the screen-only part');
});

test('online crews: a member\'s game sends its crew XP (the crew share of its Rep, doubled with crew mates)', () => {
  const sent = [];
  const net = { connected: true, myId: 'b', crew: { id: 'a', founder: 'a', members: [{ id: 'a' }, { id: 'b' }] }, send: m => { sent.push(m); return true; } };
  assert.equal(reportCrewXP({ net }, { rep: 100 }, { mode: 'park', venue: 'harbor', mates: 0 }), 33);
  assert.equal(reportCrewXP({ net }, { rep: 100 }, { mode: 'proam', venue: 'arena', mates: 1 }), 78);
  assert.deepEqual(sent.map(m => m.xp), [33, 78]);
  net.myId = 'a'; // (the founder's own crew gets his XP in his own save)
  assert.equal(reportCrewXP({ net }, { rep: 100 }, { mode: 'park', venue: 'harbor' }), 0);
});

test('online: presence says where you are (a park, a crew HQ) and your round trip; the pieces are wired', () => {
  const app = { char: () => ({ name: 'Me', overall: 70, position: 'PG' }), world: { placeKey: () => 'hq:abc', mode: 'roam' }, net: { rtt: 61 } };
  assert.deepEqual(whereNow(app), { name: 'Me', park: 'hq:abc', status: 'park', char: '70 PG', rtt: 50 });
  const park = src('client/js/game/park.js');
  for (const f of ['onCourts()', 'canStart(c)', 'startHubGame(c, aiOpp', 'runItBack(session)', 'watchGame(setup)', 'sendParkGame(c, sides', 'export class Peers']) assert.ok(park.includes(f), f);
  const hq = src('client/js/game/crewhq.js');
  for (const f of ['startOnlineRun(split', 'watchGame(setup)', 'placeKey()']) assert.ok(hq.includes(f), f);
  const modes = src('client/js/ui/modes.js');
  for (const f of ['export function proAmOnlineSetup', 'export function startProAmOnline', 'export async function playProAmOnline', 'pickRun(hq)']) assert.ok(modes.includes(f), f);
  const on = src('client/js/ui/online.js');
  assert.doesNotMatch(on, /net\.room|isHost\(\)|data-ocreate/, 'no more rooms');
  for (const t of ["'sq-invite'", "'challenge'", "'crew-invite'", "'crew-sync'", "'crewxp'", "'crew-ack'"]) assert.ok(on.includes(t) || src('client/js/ui/modes.js').includes(t), t);
  const hub = src('server/online.py');
  for (const t of ['"claim"', '"court"', '"release"', '"challenge"', '"crew-sync"', '"crewxp"', 'def offer_watch']) assert.ok(hub.includes(t), t);
  assert.match(src('server/migrations/011_v0475_online_crews.sql'), /CREATE TABLE online_crews/);
});

test('online server: an https:// address is reached over wss (a friend\'s PC stays ws on its port)', async () => {
  const { hubSocketUrl } = await import('../client/js/core/netplay.js');
  assert.equal(hubSocketUrl('https://203-0-113-7.sslip.io'), 'wss://203-0-113-7.sslip.io/api/ws');
  assert.equal(hubSocketUrl('https://game.example.com:8443'), 'wss://game.example.com:8443/api/ws');
  assert.equal(hubSocketUrl('203.0.113.7:8765'), 'ws://203.0.113.7:8765/api/ws');
  assert.match(src('client/js/core/netplay.js'), /new WebSocket\(this\.hub \? hubSocketUrl\(this\.hub\)/);
});
