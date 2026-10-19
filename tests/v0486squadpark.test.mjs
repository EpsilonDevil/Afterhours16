// v0.4.8.6 quick patch: the ICON Squad at the park (game/park.js). About every 9 hours three of the world's 99 OVR ICONs
// run together at one park for an hour, in one outfit. At the park they are one unit: never pulled one at a time, in
// together, holding a 3v3 court or on a Got Next spot as a group, winners stay and beaten they line up again until the
// hour is up, then out together; and no other AI team anywhere ever has three ICONs (MAX_ICONS_PER_AI_TEAM).
// A fake AI world and a fake clock; the park's own code (no renderer: the background games and the walkers are stubs).
// Run: node --test tests/
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ParkHub, Walker } from '../client/js/game/park.js';
import { RNG } from '../client/js/core/rng.js';
import { MAX_ICONS_PER_AI_TEAM, isIconEntry } from '../client/js/sim/iconsquad.js';

const MIN = 60000, HOUR = 60 * MIN, T0 = Date.UTC(2026, 9, 18, 18, 0), START = T0 + 10 * MIN, K = 7;
const realNow = Date.now;
const clock = { t: T0 };
const at = t => { clock.t = t; Date.now = () => clock.t; };
afterEach(() => { Date.now = realNow; }); // (the park reads the clock as Date.now: each test sets its own)

// the AIWorld calls the park makes, with AIWorld.iconSquad / squadOf / status as sim/world.js has them for the event
class FakeWorld {
  // preOff: the three are offline before their hour (they log on for it), so none of them is in a game at the park when it starts
  constructor({ n = 90, share = 0.45, seed = 1, squadPark = 'harbor', start = START, preOff = true } = {}) {
    const r = new RNG(seed);
    this.ids = Array.from({ length: n }, (_, i) => 'ai-' + i);
    this.icons = new Set(this.ids.filter(() => r.next() < share));
    const ic = [...this.icons];
    this.sq = { k: K, park: squadPark, start, end: start + HOUR, ids: ic.slice(0, 3), leader: ic[1], outfit: { top: 'tee_icon' }, roles: ['handler', 'wing', 'big'] };
    this.park = new Map(this.ids.map((id, i) => [id, i % 9 === 4 ? 'brick' : 'harbor']));
    this.squad = []; this.extra = new Map(); this.games = 0; this.preOff = preOff;
  }
  iconSquad(t = Date.now()) { const s = this.sq; return s && t >= s.start && t < s.end ? s : null; }
  squadOf(id, t = Date.now()) { const s = this.iconSquad(t); return s && s.ids.includes(id) ? s : null; }
  status(id, t = Date.now()) {
    const s = this.squadOf(id, t); if (s) return { park: s.park, until: s.end, iconSquad: s.k };
    const x = this.extra.get(id); if (x && x.until > t) return x;
    if (this.preOff && t < this.sq.start && this.sq.ids.includes(id)) return null;
    return { park: this.park.get(id), until: t + HOUR };
  }
  online(id, t) { return !!this.status(id, t); }
  onlineAt(park, t) { return this.ids.filter(id => this.status(id, t)?.park === park); }
  entry(id, t = Date.now()) {
    const s = this.squadOf(id, t), ic = this.icons.has(id);
    return { aiId: id, name: 'Hooper ' + id.slice(3), build: { overall: ic ? 99 : 82, icon_status: ic, equipment: s ? { ...s.outfit } : {} }, badges: {}, ...(s ? { iconSquad: s.k } : {}) };
  }
  gameEntry(id) { const e = this.entry(id); return { ...e, build: { ...e.build } }; }
  account(id) { return { level: this.icons.has(id) ? 0.99 : 0.6 }; }
  inSquad(id) { return this.squad.includes(id); }
  activeSquad(t = Date.now()) { this.squad = this.squad.filter(id => this.online(id, t) && !this.squadOf(id, t)); return this.squad; }
  aiParty() { return []; }
  closestOffline() { return []; }
  playedGame() { this.games++; }
  playingElsewhere() { return false; }
}

// a walker that gets where he's going at once (arrive) and is gone when he walks out (sweep)
function fakeWalker(x, z, entry) {
  return {
    entry, p: { x, z, facing: 0, setPos(a, b, f) { this.x = a; this.z = b; this.facing = f; } }, spot: null, follow: null, exit: false, gone: false, state: 'idle', path: [], t: 1,
    goTo(a, b) { this.p.x = a; this.p.z = b; this.state = 'walk'; },
    leave() { this.spot = null; this.follow = null; this.exit = true; this.watch = null; this.state = 'walk'; },
    dispose() { this.disposed = true; },
  };
}
const arrive = P => { for (const w of P.walkers) if (w.state === 'walk' && !w.exit) w.state = w.spot ? 'queued' : 'idle'; };
const sweep = P => { P.walkers = P.walkers.filter(w => !w.exit); };

function park(world, { courts = 3, busy = true } = {}) {
  const toasts = [], P = Object.create(ParkHub.prototype);
  const cs = Array.from({ length: courts }, (_, i) => ({
    id: 'c' + i, name: `Court ${i + 1}`, origin: [(i - 1) * 26, 0, 0], format: 3, full: true, lines: [null, null], session: null, mine: false, kings: null, kingsStreak: 0,
    rows: [0, 1].map(r => Array.from({ length: 4 }, (_, s) => ({ x: (i - 1) * 26 + 8 + s, z: -14 - 2 * r }))),
  }));
  Object.assign(P, {
    app: { settings: {}, mode: 'park', hud: { show() {} }, profile: {}, char: () => ({}) }, themeId: 'harbor', world, rng: new RNG(11), walkers: [], myMates: [], myOpp: [], mode: 'roam',
    courts: cs, ui: { toast: s => toasts.push(s), backToRoam() {} }, aff: { park: 'Harbor Point' }, venue: { courts: cs, solids: [] }, catalog: {}, char: { progression: {} },
    me: { x: 0, z: -18, facing: 0, setPos() {} }, rig: { snap() {} }, icon: null, iconT: 2, toasts,
  });
  P.spawnWalker = (x, z, entry) => fakeWalker(x, z, entry);
  P.bgSession = (c, rosters, teams) => ({ opts: { rosters }, teams, born: Date.now(), game: { over: false, winner: null, score: [0, 0], players: [], teams: rosters.map(r => r.map((e, i) => ({ x: i - 1, z: 2 }))) }, dispose() {} });
  P.rebuildMe = () => {};
  P.startMyGame = (c, opp, streak) => { const li = c.lines.findIndex(l => l?.mine); P.myCourt = c; P.myOpp = opp; P.myOppStreak = streak; P.myMates = c.lines[li].members.map(w => w.entry); c.lines[li] = null; P.played = { c, opp, streak }; P.mySession = { game: { score: [0, 0], over: false, target: 21 }, dispose() {} }; P.mode = 'match'; };
  if (busy) for (const c of cs) P.newBackgroundGame(c, null);
  return P;
}
const finish = (P, c, winner) => { const g = c.session.game; g.over = true; g.winner = winner; P.rotateCourt(c); };
const ids = es => es.map(e => e.aiId).sort().join();
const unitKey = w => [...w.sq.ids].sort().join();
const unitWalkers = P => P.walkers.filter(w => w.unit === K && !w.exit);
const unitLine = P => { for (const c of P.courts) for (const l of c.lines) if (l?.icon === K) return { c, l }; return null; };
const unitCourt = P => { for (const c of P.courts) { const i = c.session ? c.session.opts.rosters.findIndex(r => P.isUnit(r)) : -1; if (i >= 0) return { c, i }; } return null; };
// every AI team in the park: both sides on every court, every park-goer group on a Got Next spot, your opponents
function teams(P) {
  const out = [];
  for (const c of P.courts) {
    if (c.session) c.session.opts.rosters.forEach((r, i) => out.push({ where: `${c.name} ${i ? 'challengers' : 'kings'}`, es: r, born: c.session.born }));
    c.lines.forEach((l, i) => { if (l && !l.mine) out.push({ where: `${c.name} spot ${i}`, es: l.members.map(w => w.entry), line: l }); });
  }
  if (P.myOpp?.length) out.push({ where: 'your opponents', es: P.myOpp });
  return out;
}
// where the three are: exactly one place, all together (a team, a spot, or walking about as one)
function unitPlace(P, w) {
  const sq = new Set(w.sq.ids), places = [];
  for (const t of teams(P)) { const n = t.es.filter(e => sq.has(e.aiId)).length; if (n) places.push({ where: t.where, n, unit: P.isUnit(t.es) }); }
  const ws = P.walkers.filter(x => sq.has(x.entry.aiId) && !x.exit && !x.spot); // (on a spot: counted with its line)
  if (ws.length) places.push({ where: 'walking', n: ws.length, unit: ws.length === 3 && ws.every(x => x.unit === K && !x.spot) });
  return places;
}

test('they walk in together and take a Got Next spot as one; the toast names them, the park and the hour', () => {
  const W = new FakeWorld(); at(T0);
  const P = park(W);
  P.squadTick();
  assert.equal(P.icon, null, 'nothing before their hour');
  at(START + 5000); P.squadTick();
  const ws = unitWalkers(P);
  assert.equal(ws.length, 3, 'all three walk in');
  assert.deepEqual(ws.map(w => w.entry.aiId).sort(), [...W.sq.ids].sort());
  assert.ok(ws.every(w => w.entry.build.equipment.top === 'tee_icon'), 'in the one outfit');
  const lead = ws.find(w => !w.lead);
  assert.equal(lead.entry.aiId, W.sq.leader, 'the leader walks first');
  assert.ok(ws.filter(w => w !== lead).every(w => w.lead === lead), 'the other two walk with him');
  assert.ok(ws.every(w => Math.abs(w.p.z - ws[0].p.z) < 0.01 || w.spot), 'in from the plaza side by side');
  const ul = unitLine(P);
  assert.ok(ul, 'every court has a game on: they take a Got Next spot');
  assert.equal(ul.c.format, 3);
  assert.equal(ids(ul.l.members.map(w => w.entry)), unitKey(W));
  assert.equal(P.toasts.length, 1);
  assert.match(P.toasts[0], /^ICON SQUAD at Harbor Point: Hooper \d+, Hooper \d+ and Hooper \d+ · here for the next hour$/);
  assert.ok(P.toasts[0].startsWith(`ICON SQUAD at Harbor Point: ${W.entry(W.sq.leader).name}, `));
  assert.equal(P.courtInfo(ul.c).icon, 'next');
  assert.ok(P.parkList().filter(x => W.sq.ids.includes(x.id)).every(x => x.where === `Got next on ${ul.c.name} · ICON Squad` && x.iconSquad === K));
  // nobody pulls one of them on his own: not for a court, not for a group, not as a park-goer
  for (let i = 0; i < 40; i++) { const e = P.takeEntries(3, { topUp: true }); assert.ok(!e || e.every(x => !W.sq.ids.includes(x.aiId))); for (const x of e || []) P.walkers.push(fakeWalker(0, 0, x)); }
  assert.ok(P.availableHere().every(id => !W.sq.ids.includes(id)));
  P.formAILine(P.courts.find(c => c.lines.some(l => !l)) || P.courts[0]);
  for (const t of teams(P)) if (!P.isUnit(t.es)) assert.ok(t.es.every(e => !W.sq.ids.includes(e.aiId)), `${t.where} has one of them`);
});

test('an empty 3v3 court waits while they walk up to it, then they hold it as kings ("ICON Squad")', () => {
  const W = new FakeWorld(); at(T0);
  const P = park(W);
  const free = P.courts[2]; free.session.dispose(); free.session = null;
  at(START + 1000); P.squadTick();
  const ul = unitLine(P);
  assert.equal(ul?.c, free, 'they head for the free court');
  P.populationTick(); P.newBackgroundGame(free, null);
  assert.equal(free.session, null, 'it waits for them (nobody else starts a game on it)');
  arrive(P); P.squadTick();
  const uc = unitCourt(P);
  assert.equal(uc?.c, free); assert.equal(uc.i, 0, 'they hold it: the kings');
  assert.equal(free.session.teams[0].name, 'ICON Squad');
  assert.ok(!P.isUnit(free.session.opts.rosters[1]) && free.session.opts.rosters[1].length === 3);
  assert.equal(P.courtInfo(free).icon, 'kings');
  assert.equal(P.courtInfo(free).teams[0], 'ICN');
  const mine = P.parkList().filter(x => W.sq.ids.includes(x.id));
  assert.equal(mine.length, 3);
  assert.ok(mine.every(x => x.where === `Playing on ${free.name} · ICON Squad`), mine.map(x => x.where).join(' | '));
});

test('loading in during their hour: they\'re on a court already (no walk-in, no toast)', () => {
  const W = new FakeWorld(); at(START + 25 * MIN);
  const P = park(W, { busy: false });
  P.squadTick(Date.now(), true);
  for (const c of P.courts) if (!c.session) P.newBackgroundGame(c, null);
  const uc = unitCourt(P);
  assert.ok(uc && uc.i === 0, 'kings on a court from the first frame');
  assert.equal(unitWalkers(P).length, 0);
  assert.equal(P.toasts.length, 0);
  assert.ok(P.courts.every(c => c.session), 'every court has its game');
});

test('winners stay; beaten, they line up again on that court and keep playing the hour; you can get next and play them', () => {
  const W = new FakeWorld(); at(START + MIN);
  const P = park(W, { busy: false });
  P.squadTick(Date.now(), true);
  for (const c of P.courts) if (!c.session) P.newBackgroundGame(c, null);
  const home = unitCourt(P).c;
  finish(P, home, 0);
  assert.equal(unitCourt(P)?.c, home, 'won: they stay on');
  assert.equal(home.kingsStreak, 1);
  assert.ok(P.parkList().filter(x => W.sq.ids.includes(x.id)).every(x => x.where === `Playing on ${home.name} · ICON Squad · 1-game streak`));
  // beaten: back on that court's line, as one
  finish(P, home, 1);
  assert.equal(unitCourt(P), null);
  assert.equal(unitWalkers(P).filter(w => w.spot).length, 3);
  assert.equal(unitLine(P)?.c, home, 'back in line on the court they lost on');
  arrive(P);
  // and on again when it's their turn (a court turns over), never split, all hour
  let games = 0, lost = 0, onAgain = 0;
  for (let t = START + 2 * MIN; t < START + HOUR - 8 * MIN; t += 40000) {
    at(t);
    const c = P.rng.pick(P.courts.filter(x => x.session)), uc = unitCourt(P), before = !!uc;
    const w = uc && uc.c === c ? (P.rng.next() < 0.7 ? uc.i : 1 - uc.i) : P.rng.int(0, 1);
    if (uc && uc.c === c) { games++; if (w !== uc.i) lost++; }
    finish(P, c, w); P.populationTick(); P.squadTick(); arrive(P); P.squadTick(); sweep(P);
    if (!before && unitCourt(P)) onAgain++;
    const pl = unitPlace(P, W);
    assert.equal(pl.length, 1, `at ${(t - START) / MIN} min they're in ${pl.length} places: ${JSON.stringify(pl)}`);
    assert.ok(pl[0].unit, `split up: ${JSON.stringify(pl)}`);
  }
  assert.ok(games >= 8 && lost >= 2 && onAgain >= 2, `played ${games}, lost ${lost}, back on ${onAgain}`);
  // you get next on their court: you play them, with their streak, like any kings
  let uc = unitCourt(P);
  for (let i = 0; !uc && i < 40; i++) { const c = P.courts.find(x => x.session); finish(P, c, P.rng.int(0, 1)); arrive(P); P.squadTick(); uc = unitCourt(P); }
  assert.ok(uc);
  const c = uc.c;
  for (const [r, l] of c.lines.entries()) if (l) P.disperseLine(c, r);
  c.mine = true;
  const mates = P.takeEntries(2, { topUp: true }).map(e => { const w = fakeWalker(0, 0, e); w.state = 'queued'; return w; });
  c.lines[0] = { members: mates, mine: true, ready: true, readyAt: 0, realMates: [], fullAt: 0.5 };
  if (uc.i === 1) { finish(P, c, 1); uc = unitCourt(P); } // (they win it: now they're the kings)
  P.played = null;
  const streak = c.kingsStreak;
  finish(P, c, 0);
  assert.ok(P.played, 'your game starts');
  assert.ok(P.isUnit(P.played.opp), 'against them');
  assert.equal(P.played.streak, streak + 1, 'and they bring their streak');
  assert.equal(P.courtInfo(c).icon, 'you');
  assert.ok(P.parkList().filter(x => W.sq.ids.includes(x.id)).every(x => x.where === 'Across from you · ICON Squad'));
  // you beat them: they walk off as one and line up again
  const sess = P.mySession; P.leaveCourt(sess, true);
  assert.equal(unitWalkers(P).length, 3);
  P.squadTick();
  assert.ok(unitLine(P), 'back in line');
  assert.equal(unitLine(P).c, c, 'on your court first');
});

test('they beat you and hold the court; when the hour is up they finish their game, then walk out together', () => {
  const W = new FakeWorld(); at(START + 50 * MIN);
  const P = park(W, { busy: false });
  P.squadTick(Date.now(), true);
  for (const c of P.courts) if (!c.session) P.newBackgroundGame(c, null);
  const c = unitCourt(P).c;
  // a game against you that they win: they hold the court, streak one up
  P.myCourt = c; c.mine = true; P.myOpp = c.session.opts.rosters[0]; P.myOppStreak = 2; P.myMates = []; c.session = null; P.mode = 'match';
  P.leaveCourt({ dispose() {} }, false);
  assert.equal(unitCourt(P)?.c, c); assert.equal(unitCourt(P).i, 0);
  assert.equal(c.kingsStreak, 3);
  // the hour runs out mid-game: the game goes on
  at(W.sq.end + 2 * MIN); P.squadTick();
  assert.ok(P.icon.over, 'their hour is over');
  assert.equal(unitCourt(P)?.c, c, 'still finishing the game they\'re in');
  finish(P, c, 0);
  assert.equal(unitCourt(P), null, 'won it, but they don\'t stay on');
  const out = P.walkers.filter(w => W.sq.ids.includes(w.entry.aiId));
  assert.equal(out.length, 3);
  assert.ok(out.every(w => w.exit), 'all three head out');
  const lead = out.find(w => !w.lead);
  assert.ok(lead && out.filter(w => w !== lead).every(w => w.lead === lead), 'together: the leader, the other two with him');
  assert.equal(unitLine(P), null);
  sweep(P);
  // and they don't drift back in one by one
  for (let i = 0; i < 6; i++) { at(W.sq.end + (5 + i * 4) * MIN); P.populationTick(); assert.ok(teams(P).every(t => t.es.every(e => !W.sq.ids.includes(e.aiId))) && P.walkers.every(w => !W.sq.ids.includes(w.entry.aiId))); }
  at(W.sq.end + 35 * MIN);
  assert.ok(W.sq.ids.some(id => P.availableHere().includes(id)), 'half an hour on, they\'re regulars again');
});

test('on a Got Next spot when the hour ends: they step off it and walk out together', () => {
  const W = new FakeWorld(); at(START + MIN);
  const P = park(W);
  P.squadTick();
  assert.ok(unitLine(P));
  at(W.sq.end + 1000); P.squadTick();
  assert.equal(unitLine(P), null);
  const out = P.walkers.filter(w => W.sq.ids.includes(w.entry.aiId));
  assert.ok(out.length === 3 && out.every(w => w.exit && !w.spot));
  assert.equal(out.filter(w => !w.lead).length, 1);
});

test('a squad mate of yours who\'s one of them leaves you for them (a toast), and walks in with the other two', () => {
  const W = new FakeWorld({ preOff: false }); at(T0);
  const P = park(W, { busy: false });
  const mate = W.sq.ids[2], goer = W.sq.ids[0];
  W.squad = [mate];
  P.syncSquad(true);
  assert.equal(P.walkers.find(w => w.entry.aiId === mate)?.follow, 0, 'he runs with you');
  // another of them is a park-goer on your Got Next spot
  const c = P.courts[0], gw = fakeWalker(0, 0, P.entryFor(goer)); P.walkers.push(gw);
  for (const [r, l] of c.lines.entries()) if (l) P.disperseLine(c, r);
  c.mine = true; c.lines[0] = { members: [gw], mine: true, ready: false, readyAt: 0, realMates: [] }; P.placeLine(c, 0);
  at(START + 1000); P.squadTick();
  assert.ok(P.toasts.includes(`${W.entry(mate).name} left to run with his ICON squad.`), P.toasts.join(' | '));
  assert.ok(P.toasts.includes(`${W.entry(goer).name} left your spot to run with his ICON squad.`), P.toasts.join(' | '));
  assert.equal(P.toasts.filter(s => s.includes('left')).length, 2, 'once each');
  assert.deepEqual(c.lines[0].members, [], 'off your spot');
  assert.ok(!W.squad.includes(mate));
  const ws = P.walkers.filter(w => W.sq.ids.includes(w.entry.aiId) && !w.disposed);
  assert.equal(ws.length, 3, 'one of each, no doubles');
  assert.ok(ws.every(w => w.unit === K && w.follow == null), 'all three as the unit');
  assert.ok(P.toasts.some(s => s.startsWith('ICON SQUAD at Harbor Point')));
});

test('one of them playing on his own when the hour begins finishes his game, then comes in with the other two', () => {
  const W = new FakeWorld(); at(START - 3 * MIN);
  const P = park(W);
  const solo = W.sq.ids[1], c = P.courts[1];
  c.session.opts.rosters[1][0] = P.entryFor(solo); // (on the challengers of court 2)
  at(START + 1000); P.squadTick();
  assert.equal(unitWalkers(P).length, 0, 'they wait for him');
  assert.equal(P.icon.formed, false);
  finish(P, c, 1); // (his team wins: he doesn't stay on with them)
  assert.ok(teams(P).every(t => P.isUnit(t.es) || t.es.every(e => !W.sq.ids.includes(e.aiId))), 'he comes off');
  const pl = unitPlace(P, W);
  assert.equal(pl.length, 1); assert.ok(pl[0].unit, JSON.stringify(pl));
});

test('the 3-ICON guard: over thousands of random rotations no AI team but the ICON Squad ever has three ICONs', () => {
  const W = new FakeWorld({ n: 120, share: 0.5, seed: 5, start: T0 + 2 * HOUR, preOff: false }); // (some of them may be in a game when it starts)
  // (half the park are ICONs here: three random hoopers are all ICONs one time in eight without the guard)
  const r = new RNG(3), on = W.onlineAt('harbor', T0);
  let raw = 0; for (let i = 0; i < 4000; i++) { const tri = r.shuffle(on.slice()).slice(0, 3); if (tri.every(id => W.icons.has(id))) raw++; }
  assert.ok(raw > 300, `without the guard, ${raw} of 4000 random teams are three ICONs`);
  at(T0);
  const P = park(W);
  P.rng = new RNG(99);
  let checked = 0, capped = 0, unitGames = 0, mine = 0, worst = 0;
  const seenLines = new WeakSet(), lineBorn = new WeakMap();
  for (let step = 0; step < 3200; step++) {
    const t = T0 + step * 6000; at(t); // (5 h 20 min: before, through and after their hour)
    for (const c of P.courts) for (const l of c.lines) if (l && !seenLines.has(l)) { seenLines.add(l); lineBorn.set(l, t); }
    const live = P.courts.filter(c => c.session);
    if (live.length && P.rng.next() < 0.5) { const c = P.rng.pick(live); if (unitCourt(P)?.c === c) unitGames++; finish(P, c, P.rng.int(0, 1)); }
    if (step % 3 === 0) P.populationTick();
    if (step % 2 === 0) P.squadTick();
    // you, now and then: get next on a court and play whoever holds it, then win or lose and walk off
    if (P.mode === 'roam' && P.rng.next() < 0.02) {
      const c = P.rng.pick(P.courts.filter(x => x.session && x.lines.some(l => !l)) .concat([]));
      if (c) { const r2 = c.lines.findIndex(l => !l), ms = (P.takeEntries(2, { topUp: true }) || []).map(e => { const w = fakeWalker(0, 0, e); w.state = 'queued'; P.walkers.push(w); return w; }); if (ms.length === 2) { c.mine = true; c.lines[r2] = { members: ms, mine: true, ready: true, readyAt: 0, realMates: [], fullAt: -step }; P.placeLine(c, r2); for (const w of ms) w.state = 'queued'; } }
    }
    if (P.mode === 'match' && P.rng.next() < 0.25) { mine++; P.leaveCourt(P.mySession, P.rng.next() < 0.5); }
    arrive(P); sweep(P);
    for (const tm of teams(P)) {
      const n = tm.es.filter(isIconEntry).length;
      checked++; if (n === MAX_ICONS_PER_AI_TEAM) capped++; worst = Math.max(worst, P.isUnit(tm.es) ? 0 : n);
      if (!P.isUnit(tm.es)) assert.ok(n <= MAX_ICONS_PER_AI_TEAM, `${tm.where} at step ${step}: ${n} ICONs (${ids(tm.es)})`);
      // in their hour (and the half hour after it) none of them is on anybody else's team that was put together then
      const born = tm.line ? lineBorn.get(tm.line) ?? t : tm.born ?? t;
      if (!P.isUnit(tm.es) && born >= W.sq.start && born < W.sq.end + 30 * MIN) assert.ok(tm.es.every(e => !W.sq.ids.includes(e.aiId)), `${tm.where} at step ${step} has one of them on his own`);
    }
    if (t >= W.sq.start && t < W.sq.end && P.icon?.formed) { const pl = unitPlace(P, W); assert.equal(pl.length, 1, `step ${step}: ${JSON.stringify(pl)}`); assert.ok(pl[0].unit, `step ${step}: ${JSON.stringify(pl)}`); }
  }
  assert.ok(checked > 20000, `${checked} team checks`);
  assert.ok(capped > 1000, `teams at the cap: ${capped}`);
  assert.equal(worst, MAX_ICONS_PER_AI_TEAM);
  assert.ok(unitGames >= 5, `the ICON Squad played ${unitGames} games`);
  assert.ok(mine >= 3, `you played ${mine}`);
  console.log(`  (3-ICON guard: ${checked} team checks, ${capped} at ${MAX_ICONS_PER_AI_TEAM} ICONs, none above; ${raw}/4000 random triples were all-ICON; the squad played ${unitGames} games on the park's courts, you ${mine})`);
});

test('they beat you after their hour is up: they don\'t hold the court, they walk out; later on, one of them is a regular again', () => {
  const W = new FakeWorld(); at(START + 55 * MIN);
  const P = park(W, { busy: false });
  P.squadTick(Date.now(), true);
  for (const c of P.courts) if (!c.session) P.newBackgroundGame(c, null);
  const c = unitCourt(P).c, unit = c.session.opts.rosters[0];
  P.myCourt = c; c.mine = true; P.myOpp = unit; P.myOppStreak = 4; P.myMates = []; c.session = null; P.mode = 'match';
  at(W.sq.end + 3 * MIN); P.squadTick();
  P.leaveCourt({ dispose() {} }, false);
  assert.ok(!P.isUnit(c.session?.opts.rosters[0] || []), 'somebody else holds it');
  const out = P.walkers.filter(w => W.sq.ids.includes(w.entry.aiId));
  assert.ok(out.length === 3 && out.every(w => w.exit), 'out they go, together');
  sweep(P);
  // an hour on: one of them on a team of regulars comes off the court like anybody
  at(W.sq.end + 70 * MIN);
  const c2 = P.courts.find(x => x.session), solo = P.entryFor(W.sq.ids[0]);
  c2.session.opts.rosters[1][0] = solo;
  finish(P, c2, 0);
  assert.ok(P.walkers.some(w => w.entry === solo), 'he walks off the court like the rest (not held back for a squad that\'s gone)');
});

test('the other two walk a step behind their leader, and out of the park with him', () => {
  const lead = { p: { x: 0, z: 0, facing: 0 }, spot: null, gone: false };
  const w = Object.create(Walker.prototype);
  Object.assign(w, {
    hub: { venue: { solids: [] }, courts: [] }, visual: { pending: false }, lead, unitSlot: 0, spot: null, follow: null, exit: false, state: 'idle', t: 5, path: [],
    p: { x: 6, z: 6, facing: 0, intent: {}, phys: { radius: 0.3 }, stamina: 1, move() {}, setPos(x, z) { this.x = x; this.z = z; } },
  });
  w.update(0.016);
  assert.equal(w.state, 'follow');
  assert.ok(w.p.intent.mx < 0 && w.p.intent.mz < 0, 'he heads for his place behind the leader');
  w.p.x = -0.95; w.p.z = -1.35; w.update(0.016);
  assert.equal(w.p.intent.mx, 0); assert.equal(w.p.intent.face, 0, 'there: he faces the way his leader does');
  lead.gone = true; w.exit = true; w.update(0.016);
  assert.equal(w.gone, true, 'his leader walked out: so does he');
});
