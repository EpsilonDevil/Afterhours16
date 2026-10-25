// v0.4.8.9 quick patch 12, the Hub agent's part (scratchpad contract QP12_CLUB.md §2, §5): AI friends in your squad walk
// into the Pro-Am HUB with you; the club's AI members who are on by their AI-world schedule are there (standing around,
// shooting around, gathering in the office when a queue starts), the same people doing the same things on every screen;
// every tier's office has an Invite spot (a sign-up sheet, a roster board, a desk phone by a roster screen) that opens
// the club's invite dialog (ui/proam.js openInviteDialog); the roster shows the AI members, tagged; the HUB's
// ready-check view says who's coming (players, AI members, squad mates, the draft), then the lineup the service gave.
import test from 'node:test';
import assert from 'node:assert/strict';

const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x) * (h || y) * 4 || 4) }) : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };

const W = await import('../client/js/world/proamhubs.js');
const H = await import('../client/js/game/proamhub.js');
const { makeTeam } = await import('../client/js/sim/bots.js');
const { RNG, hashString } = await import('../client/js/core/rng.js');

const fakeScene = () => { const meshes = []; return { meshes, lights: [], add(m) { meshes.push(m); return m; }, remove(m) { const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); } }; };
let texN = 0;
const ctx = { geometry: g => ({ ...g, count: g.index ? g.index.length : g.position.length / 3, bounds: { center: [0, 0, 0], radius: 1 } }), texture: () => ({ id: ++texN }), disposeTexture() {}, updateTexture(t) { t.updated = (t.updated || 0) + 1; }, updateAttribute() {}, setInstances(g, d, n) { g.instances = n; }, disposeGeometry() {} };
const CHAR = { ...makeTeam(new RNG(5), 1, { catalog: {}, level: 0.6 })[0].build, id: 'c-1', name: 'Hub Tester' };
const pool = () => ({ take: () => null, request: () => ({}), cancel() {}, release() {}, flush() {}, tick() {}, dispose() {}, pending: 0 });
const AI = ['ai-0100', 'ai-0200', 'ai-0300', 'ai-0400', 'ai-0500'];
const TEAM = {
  id: 'team-12', name: 'Night Owls', abbr: 'OWL', primary: '#5a2f8a', secondary: '#f2c14e', logo: 'shield', court: 'longbeach', founder: 'acc-1',
  division: { tier: 0, label: 'Bronze 1', index: 0 }, record: [3, 1], series: [1, 0],
  members: [{ kind: 'player', account_id: 'acc-1', username: 'me', founder: true }, { kind: 'player', account_id: 'acc-2', username: 'ace' },
    ...AI.map((id, i) => ({ kind: 'ai', ai_id: id, name: `Bot ${i}`, build: { position: 'SG', overall: 70 + i }, online: i === 4 }))],
  current: { picks: { 0: 'ai-draft1', 1: 'ai-draft2' } },
};
const tierTeam = (t, extra = {}) => ({ ...TEAM, division: { tier: W.tierRank(t), label: t, index: 0 }, ...extra });
// an AI world: who's on by its schedule (on: the ids on now), your squad, the people in it
function fakeWorld(on = AI.slice(0, 3), squad = []) {
  return { seed: 77, on: new Set(on), squad: squad.slice(), gameEntry: id => ({ build: CHAR, name: `Bot ${id}`, aiId: id }), pick: ({ key }) => 'ai-' + key, recordGame() {},
    status(id) { return this.on.has(id) ? { park: 'harbor', until: Infinity } : null; }, activeSquad() { return this.squad.slice(); } };
}
function office() {
  const calls = [];
  return { calls, openOffice: async (app, team, panel, opts) => { calls.push({ fn: 'openOffice', team, panel, opts }); }, queue: async (app, team, opts) => { calls.push({ fn: 'queue', team, opts }); }, load: async () => ({ team: null }), openInviteDialog: async (app, team, opts) => { calls.push({ fn: 'invite', app, team, opts }); } };
}
function fakeNet(people = [], skew = 0) {
  const subs = {};
  return { connected: true, myId: 'acc-1', you: { username: 'me' }, place: 'hq:pa:team-12', host: null, serverSkew: skew,
    people: new Map(people.map(p => [p.id, { id: p.id, username: p.username, entry: { build: CHAR, name: p.username }, ai: p.ai || [] }])),
    sent: [], send(m) { this.sent.push(m); }, entryOf(id) { return this.people.get(id)?.entry || null; }, usernameOf(id) { return this.people.get(id)?.username || '?'; }, aiOf(id) { return this.people.get(id)?.ai || []; },
    on(k, f) { (subs[k] ||= []).push(f); return () => { subs[k] = subs[k].filter(x => x !== f); }; }, emit(k, m) { for (const f of subs[k] || []) f(m); }, emote() {} };
}
function makeHub(o = {}) {
  const toasts = [], U = o.officeUI || office();
  const app = {
    renderer: { ctx, prewarm() {}, project: () => ({ visible: false }) }, catalog: {}, char: () => CHAR, look: () => ({}),
    ai: o.world || fakeWorld(), cameraRig: { snap() {}, updateRoam() {}, inputBasis: () => ({ fx: 0, fz: 1, rx: 1, rz: 0 }), roamPitch: 0.32, roamDist: 6 },
    hud: { show() {} }, net: o.net || null, profile: { account: { id: 'acc-1' } }, modalOpen: () => false,
    input: { wasPressed: () => false, isDown: () => false, moveVector: () => o.move || ({ x: 0, y: 0 }), usingPad: false },
  };
  const ui = { toast: t => toasts.push(t), exit: () => toasts.push('EXIT'), update() {}, pick3s() {}, matchStarted() {} };
  const hub = new H.ProamHub(app, ui, { team: o.team || TEAM, from: 'menu', area: o.area, officeUI: U, pool: pool() });
  return { hub, app, U, toasts };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const step = (hub, s = 1, dt = 1 / 30) => { for (let i = 0; i < s / dt; i++) hub.frame(dt); };

// ---------------- §5: the Invite spot in every office ----------------
test('every tier\'s office has an Invite spot that opens the club\'s invite dialog with the HUB\'s team', async () => {
  for (const t of W.HUB_TIERS) {
    const team = tierTeam(t);
    const { hub, U } = makeHub({ team });
    const it = hub.interactables().find(i => i.id === 'invite');
    assert.ok(it, `${t}: an Invite spot`);
    assert.ok(hub.venue.walkable(it.x, it.z, 0.35), `${t}: you can stand at it`);
    assert.equal(hub.venue.roomAt(it.x, it.z)?.id, 'office', `${t}: in the office`);
    hub.me.setPos(it.x, it.z, 0);
    assert.equal(hub.nearest()?.id, 'invite', `${t}: standing there, it's the one in reach`);
    assert.match(hub.promptFor(it, 'E'), /^E Invite to the club · AI friends and players \(7\/10\)$/);
    // and the others are still each their own (no spot swallowed by the new one)
    for (const id of ['whiteboard', 'draft', 'settings', 'queue']) { const o = hub.interactables().find(i => i.id === id); hub.me.setPos(o.x, o.z, 0); assert.equal(hub.nearest()?.id, id, `${t}: ${id}`); }
    assert.equal(hub.use(it), 'invite'); await tick();
    const c = U.calls.find(x => x.fn === 'invite');
    assert.ok(c, `${t}: the dialog opened`); assert.equal(c.team, team); assert.equal(c.app, hub.app); assert.equal(typeof c.opts.onChange, 'function');
    // the roster on the spot's board: the AI members tagged
    const b = hub.venue.boards.roster;
    assert.ok(b && b.draws >= 2 && b.data.members.some(m => m.ai), `${t}: the roster board`);
  }
  // Gold and Platinum: a phone on the desk; Bronze and Silver: a sign-up sheet / a roster board on the wall
  for (const t of ['gold', 'platinum']) assert.ok(W.hubPlan(t).office.invite.phone, `${t}: the desk phone`);
  for (const t of ['bronze', 'silver']) assert.ok(!W.hubPlan(t).office.invite.phone && W.hubPlan(t).office.invite.at, `${t}: the board`);
});

test('the Invite spot without the dialog yet: says so, nothing breaks', async () => {
  const U = office(); delete U.openInviteDialog;
  const { hub, toasts } = makeHub({ officeUI: U });
  const ok = await hub.openInvite();
  if (!ok) assert.match(toasts.at(-1), /Invites open soon|invites couldn't open/);
});

test('the roster: real members first, then the AI ones tagged, online by their schedule, 10 at most', () => {
  const d = W.rosterData(TEAM, { 'ai-0100': true, 'ai-0200': false });
  assert.equal(d.count, 7); assert.equal(d.max, 10); assert.equal(d.ai, 5);
  assert.deepEqual(d.members.map(m => m.ai), [false, false, true, true, true, true, true]);
  assert.equal(d.members[0].founder, true);
  assert.equal(d.members[2].online, true); assert.equal(d.members[3].online, false);
  assert.equal(d.members[6].online, true, 'no clock answer: the team view\'s flag');
  const big = { ...TEAM, members: Array.from({ length: 14 }, (_, i) => ({ kind: 'ai', ai_id: 'ai-x' + i, name: 'X' + i })) };
  assert.equal(W.rosterData(big).members.length, 10);
  for (const t of W.HUB_TIERS) { const c = new OffscreenCanvas(512, 400); W.drawRoster(c, d, t); W.drawRoster(c, null, t); }
  // the whiteboard's member list tags them too
  assert.deepEqual(W.whiteboardData(TEAM).members.map(m => !!m.ai), [false, false, true, true, true, true, true]);
});

// ---------------- §2: who's in the HUB ----------------
test('the AI members on by their schedule are in the HUB; off ones aren\'t; a squad mate isn\'t there twice', () => {
  const w = fakeWorld(['ai-0100', 'ai-0300', 'ai-0500']);
  assert.deepEqual(H.hubAIMembers(TEAM, w, 0), ['ai-0100', 'ai-0300', 'ai-0500']);
  assert.deepEqual(H.hubAIMembers(TEAM, w, 0, new Set(['ai-0300'])), ['ai-0100', 'ai-0500']);
  // the HUB's world isn't the team's: the team view's flags (the service's schedule)
  assert.deepEqual(H.hubAIMembers({ ...TEAM, world: { seed: 5 } }, w, 0), ['ai-0500']);
  assert.deepEqual(H.hubAIMembers(TEAM, null, 0), ['ai-0500']);
  const { hub } = makeHub({ world: w });
  assert.deepEqual(hub.aiMembersHere(), ['ai-0100', 'ai-0300', 'ai-0500']);
  for (const b of hub.bots.values()) assert.ok(hub.walkable(b.p.x, b.p.z), `${b.id} stands somewhere you can stand`);
  // the ones here when you came in are already at their places (not walking in from the door)
  const door = hub.spots.door;
  assert.ok([...hub.bots.values()].every(b => Math.hypot(b.p.x - door.x, b.p.z - door.z) > 1 || b.path.length === 0));
  // one comes on: he walks in through the door; one goes off: he walks out of it, then he's gone
  w.on.add('ai-0200'); w.on.delete('ai-0100');
  hub.syncCrowd();
  const nb = hub.bots.get('ai-0200');
  assert.ok(Math.hypot(nb.p.x - door.x, nb.p.z - door.z) < 0.01 && nb.path.length > 0, 'in through the door');
  assert.ok(hub.bots.get('ai-0100').leaving, 'out through the door');
  assert.deepEqual(hub.aiMembersHere(), ['ai-0200', 'ai-0300', 'ai-0500']);
  step(hub, 40);
  assert.ok(!hub.bots.has('ai-0100'), 'gone');
});

test('what each AI member does is the same on every screen (the team, his id, the time) and changes over time', () => {
  const ids = AI.slice(), n = { shoot: 2, hang: 9 };
  for (let t = 0; t < 20 * H.HUB_AI_PERIOD; t += 7919) {
    const a = H.aiPlan('team-12', ids, t, n), b = H.aiPlan('team-12', ids.slice().reverse(), t, n);
    assert.deepEqual([...a], [...b], 'the same plan whatever order they come in');
    assert.ok([...a.values()].filter(x => x.kind === 'shoot').length <= H.HUB_AI_SHOOTERS);
    const hang = [...a.values()].filter(x => x.kind === 'hang').map(x => x.i);
    assert.equal(new Set(hang).size, hang.length, 'two never pick the same place to stand');
  }
  const kinds = new Set(); for (let t = 0; t < 40 * H.HUB_AI_PERIOD; t += H.HUB_AI_PERIOD) for (const v of H.aiPlan('team-12', ids, t, n).values()) kinds.add(v.kind);
  assert.ok(kinds.has('shoot') && kinds.has('hang'), 'they shoot around and stand around');
  // two screens (online): the same people in the same places
  const w = fakeWorld(['ai-0100', 'ai-0200', 'ai-0400']);
  const A = makeHub({ world: w, net: fakeNet([], 1234) }).hub, B = makeHub({ world: w, net: fakeNet([], 1234) }).hub;
  assert.deepEqual(A.aiMembersHere(), B.aiMembersHere());
  assert.deepEqual([...A.bots.values()].map(b => [b.id, b.planKey]), [...B.bots.values()].map(b => [b.id, b.planKey]));
  assert.deepEqual([...A.bots.values()].map(b => [Math.round(b.p.x * 10), Math.round(b.p.z * 10)]), [...B.bots.values()].map(b => [Math.round(b.p.x * 10), Math.round(b.p.z * 10)]));
});

test('your AI squad mates walk into the HUB with you and follow you around; online, the others\' walk with them', () => {
  const w = fakeWorld([], ['ai-sq1', 'ai-sq2']);
  const mv = { x: 0, y: 0 };
  const { hub } = makeHub({ world: w, move: mv });
  const sq = [...hub.bots.values()].filter(b => b.kind === 'squad');
  assert.deepEqual(sq.map(b => b.id), ['ai-sq1', 'ai-sq2']);
  for (const b of sq) assert.ok(Math.hypot(b.p.x - hub.me.x, b.p.z - hub.me.z) < 3.5, 'right behind you as you come in');
  mv.y = 1; step(hub, 2.5); mv.y = 0; step(hub, 2);
  for (const b of sq) assert.ok(Math.hypot(b.p.x - hub.me.x, b.p.z - hub.me.z) < 4, `${b.id} kept up`);
  assert.deepEqual(hub.squadHere(), ['ai-sq1', 'ai-sq2']);
  // he leaves your squad: he's gone from the HUB
  w.squad = ['ai-sq2']; hub.syncCrowd();
  assert.deepEqual([...hub.bots.values()].filter(b => b.kind === 'squad').map(b => b.id), ['ai-sq2']);
  // a squad mate who's also an AI member of the club is there once (with you)
  const w2 = fakeWorld(['ai-0100', 'ai-0200'], ['ai-0100']);
  const h2 = makeHub({ world: w2 }).hub;
  assert.equal(h2.bots.get('ai-0100').kind, 'squad'); assert.deepEqual(h2.aiMembersHere(), ['ai-0200']);
  // online: the others' AI squad mates walk with them (the park's followers), and count as squad mates here
  const net = fakeNet([{ id: 'acc-2', username: 'ace', ai: [{ id: 'ai-peer1', entry: { build: CHAR, name: 'Peer One' } }] }]);
  const h3 = makeHub({ world: fakeWorld(['ai-peer1']), net }).hub;
  assert.equal(h3.peers.withAI, true);
  h3.onPeerPos({ from: 'acc-2', x: 1, z: 2, f: 0, m: 0 });
  assert.equal(h3.peers.followers().length, 1, 'ace\'s AI mate walks with him');
  assert.deepEqual(h3.squadHere(), ['ai-peer1']); assert.deepEqual(h3.aiMembersHere(), [], 'not also standing around on his own');
});

test('the queue: the AI people gather in the office, the lineup gets them, the ready-check view says who\'s coming', async () => {
  const w = fakeWorld(['ai-0100', 'ai-0300'], ['ai-sq1']);
  const { hub, U } = makeHub({ world: w });
  const q = hub.interactables().find(i => i.id === 'queue');
  assert.equal(hub.use(q), 'queue'); await tick(); await tick();
  const c = U.calls.find(x => x.fn === 'queue');
  assert.deepEqual(c.opts.aiMembers, ['ai-0100', 'ai-0300']); assert.deepEqual(c.opts.squad, ['ai-sq1']);
  assert.deepEqual(c.opts.members.map(m => m.id), ['me']);
  // (the queue's modal closed: they go back to what they were doing; again, held open, they walk to the office)
  assert.equal(hub.queueing, null);
  hub.queueStarted();
  for (const b of hub.bots.values()) { assert.equal(b.plan.kind, 'office'); const end = b.path.at(-1) || b.p; assert.equal(hub.venue.roomAt(end.x, end.z)?.id, 'office', `${b.id} heads for the office`); }
  step(hub, 30);
  for (const b of hub.bots.values()) assert.equal(hub.venue.roomAt(b.p.x, b.p.z)?.id, 'office', `${b.id} got to the office`);
  // the HUB's ready-check view: you, the AI members, the squad mate, the draft's picks
  let v = hub.lineupView();
  assert.deepEqual(v, { humans: ['Hub Tester'], members: ['Bot ai-0100', 'Bot ai-0300'], squad: ['Bot ai-sq1'], draft: ['Bot ai-draft1'], more: 0, final: false });
  // the service's lineup comes in: that's who plays
  hub.app.paLineup = { ai: ['ai-0100', 'ai-d9', 'ai-d8', 'ai-d7'], humans: 1, members: ['ai-0100'], squad: [], draft: ['ai-d9', 'ai-d8', 'ai-d7'] };
  v = hub.lineupView();
  assert.equal(v.final, true); assert.deepEqual(v.members, ['Bot ai-0100']); assert.deepEqual(v.squad, []); assert.equal(v.draft.length, 3);
  const h = new H.HubUI(hub.app).lineupHTML(v);
  assert.match(h, /THE LINEUP/); assert.match(h, /AI MEMBERS[^]*Bot ai-0100[^]*>AI</); assert.match(h, /DRAFT/);
  hub.queueEnded();
  assert.equal(hub.lineupView(), null);
  for (const b of hub.bots.values()) if (b.kind === 'squad') assert.equal(b.owner, hub.me, 'the squad mate follows you again');
  // online: the Captain's ready check reaching you starts it on your screen too, and his cancel ends it
  const net = fakeNet();
  const h2 = makeHub({ world: w, net }).hub;
  net.emit('pa-ready', { op: 'ask', secs: 20 });
  assert.ok(h2.queueing); net.emit('pa-ready', { op: 'cancel' }); assert.equal(h2.queueing, null);
  h2.dispose(); net.emit('pa-ready', { op: 'ask' }); assert.equal(h2.queueing, null, 'a left HUB hears nothing');
});

test('hubLineup: players, then AI members, then squad mates, then the draft; 5 on the floor', () => {
  const L = H.hubLineup({ humans: ['a', 'b'], members: ['m1', 'm2'], squad: ['m2', 's1', 's2'], picks: ['d1'] });
  assert.deepEqual(L, { humans: ['a', 'b'], members: ['m1', 'm2'], squad: ['s1'], draft: [], more: 0, final: false });
  const F = H.hubLineup({ humans: ['a'], members: [], squad: ['s1'], picks: ['d1', 'd2'] });
  assert.deepEqual(F, { humans: ['a'], members: [], squad: ['s1'], draft: ['d1', 'd2'], more: 1, final: false });
  assert.equal(H.hubLineup({ humans: ['a', 'b', 'c', 'd', 'e', 'f'], members: ['m1'] }).members.length, 0, 'a full five of players');
});

test('the AI people are freed with the HUB', () => {
  const { hub } = makeHub({ world: fakeWorld(AI, ['ai-sq1']) });
  const bots = [...hub.bots.values()];
  assert.ok(bots.length >= 5);
  hub.dispose();
  assert.equal(hub.bots.size, 0); assert.ok(bots.every(b => b.disposed));
  void hashString;
});
