// v0.4.8.8 The Pro-Am Overhaul, the Hub agent's part (docs/PROAM-OVERHAUL.md §8): the Pro-Am team's hub
// (game/proamhub.js) and its buildings (world/proamhubs.js). Every tier builds headless in its budgets with sane bounds,
// walls you can't walk through and doorways you can; the office's four interactables call the Server/UI agent's hooks
// (ProamUI.openOffice 'whiteboard' | 'draft' | 'settings', ProamUI.queue); only the session's Captain queues and drafts;
// a Gold clubhouse's floor, walls, logo and colors change its materials; its walk-out builds the team's home park.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x) * (h || y) * 4 || 4) }) : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };

const W = await import('../client/js/world/proamhubs.js');
const H = await import('../client/js/game/proamhub.js');
const { COURT } = await import('../client/js/sim/constants.js');
const { PROAM_IDS } = await import('../client/js/world/proamparks.js');
const { makeTeam } = await import('../client/js/sim/bots.js');
const { RNG } = await import('../client/js/core/rng.js');

const fakeScene = () => { const meshes = []; return { meshes, lights: [], add(m) { meshes.push(m); return m; }, remove(m) { const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); } }; };
let texN = 0;
const ctx = { geometry: g => ({ ...g, count: g.index ? g.index.length : g.position.length / 3, bounds: { center: [0, 0, 0], radius: 1 } }), texture: () => ({ id: ++texN }), disposeTexture() {}, updateTexture(t) { t.updated = (t.updated || 0) + 1; }, updateAttribute() {}, setInstances(g, d, n) { g.instances = n; }, disposeGeometry() {} };
const tris = scene => scene.meshes.reduce((a, m) => a + (m.geo.count / 3) * (m.geo.instances || 1), 0);
const TEAM = { id: 'team-1', name: 'Night Owls', abbr: 'OWL', primary: '#5a2f8a', secondary: '#f2c14e', logo: 'shield', court: 'longbeach', founder: 'acc-1', division: { tier: 0, label: 'Bronze 1', index: 0 }, members: [{ account_id: 'acc-1', username: 'me' }, { account_id: 'acc-2', username: 'ace' }, { account_id: 'acc-3', username: 'deuce' }], record: [3, 1], series: [1, 0] };
const tierTeam = (t, extra = {}) => ({ ...TEAM, division: { tier: W.tierRank(t), label: t, index: 0 }, ...extra });
const build = (tier, team = tierTeam(tier)) => { const scene = fakeScene(); const v = W.buildProamHub({ ctx }, scene, tier, { team }); return { scene, v }; };
const built = Object.fromEntries(W.HUB_TIERS.map(t => [t, build(t)]));

// ---------------- the buildings ----------------
test('the hub follows the team\'s tier: Bronze, Silver, Gold, then Platinum (Diamond and up get Platinum\'s building)', () => {
  assert.deepEqual(W.HUB_TIERS, ['bronze', 'silver', 'gold', 'platinum']);
  assert.equal(W.hubTier({ division: { tier: 0 } }), 'bronze');
  assert.equal(W.hubTier({ division: { tier: 1 } }), 'silver');
  assert.equal(W.hubTier({ division: { tier: 2 } }), 'gold');
  assert.equal(W.hubTier({ division: { tier: 3 } }), 'platinum');
  assert.equal(W.hubTier({ division: { tier: 6 } }), 'platinum');
  assert.equal(W.hubTier({ tier: 'Gold' }), 'gold');
  assert.equal(W.hubTier({ div: 8 }), 'gold'); // (the flat division index: Bronze 3 + Silver 5 = 8 is Gold 1)
  assert.equal(W.hubTier(null), 'bronze');
  assert.ok(!W.customizable('bronze') && !W.customizable('silver') && W.customizable('gold') && W.customizable('platinum'));
});

test('every tier builds headless: in budget, eight lights at most, the main court full at the origin, nothing broken', () => {
  for (const t of W.HUB_TIERS) {
    const { scene, v } = built[t], n = tris(scene);
    assert.ok(n > 5000 && n < (W.customizable(t) ? 120000 : 80000), `${t}: ${Math.round(n)} triangles`);
    assert.ok(scene.lights.length >= 4 && scene.lights.length <= 8, `${t}: ${scene.lights.length} lights`);
    assert.ok(scene.meshes.length < 120, `${t}: ${scene.meshes.length} draw calls`);
    for (const m of scene.meshes) assert.ok(m.geo.count > 0 && [...m.matrix].every(Number.isFinite), `${t}: an empty mesh or a bad matrix`);
    for (const l of scene.lights) assert.ok([...l.pos, l.range, l.intensity].every(Number.isFinite), `${t}: a light`);
    const c = v.courts[0];
    assert.ok(c.full && c.format === 5 && c.origin.every(x => x === 0) && c.hoops.length === 2, `${t}: the main court`);
    assert.equal(v.theme.kind, 'gym'); assert.equal(v.theme.court.surface, 'wood');
    assert.equal(v.tier, t);
    assert.equal(v.name, W.HUB_NAMES[t]);
  }
});

test('sane bounds: the room holds the court and its run-off, the office is its own room behind a doorway', () => {
  for (const t of W.HUB_TIERS) {
    const { v } = built[t], gym = v.rooms[0], office = v.rooms.find(r => r.id === 'office');
    assert.ok(gym.x0 < -COURT.width / 2 - 1.2 && gym.x1 > COURT.width / 2 + 1.2, `${t}: the gym's width`);
    assert.ok(gym.z0 < -COURT.length / 2 - 1.2 && gym.z1 > COURT.length / 2 + 1.2, `${t}: the gym's length`);
    assert.ok(gym.h >= 7, `${t}: the ceiling over the court`);
    assert.ok(office && office.h < gym.h, `${t}: the office`);
    const area = (office.x1 - office.x0) * (office.z1 - office.z0);
    assert.ok(t === 'bronze' ? area < 25 : t === 'silver' ? area > 40 && area < 80 : area > 100, `${t}: the office's size ${area}`);
    const b = v.bounds;
    assert.ok(b.x1 - b.x0 < 60 && b.z1 - b.z0 < 60 && b.x1 - b.x0 > 20, `${t}: bounds`);
    // the doorway into the office: walkable, and the wall beside it isn't
    const door = v.gaps.find(g => g.walk), mx = (door.x0 + door.x1) / 2, wz = gym.z0 === door.z0 + (door.z1 - door.z0) / 2 ? gym.z0 : (door.z0 + door.z1) / 2;
    assert.ok(v.walkable(mx, wz), `${t}: the office doorway`);
    assert.ok(!v.walkable(door.x1 + 1.0, wz), `${t}: the wall next to the doorway`);
    assert.ok(!v.walkable(b.x0 - 1, 0) && !v.walkable(0, b.z1 + 1), `${t}: outside the walls`);
    // the walls keep the roam camera in (one box a side at least, and none across the doorway)
    assert.ok(v.camSolids.length >= 8, `${t}: camera walls`);
    assert.ok(!v.camSolids.some(s => s.h > 50 && mx > s.x0 && mx < s.x1 && wz > s.z0 && wz < s.z1), `${t}: no camera wall across the doorway`);
    // everyone starts on the floor, and every interactable is somewhere you can stand
    assert.ok(v.walkable(v.spawn.x, v.spawn.z), `${t}: the spawn`);
    for (const it of v.interactables) assert.ok(v.walkable(it.x, it.z) && it.r > 0.5 && it.r < 5, `${t}: ${it.id} at ${it.x},${it.z}`);
    for (const s of v.solids) assert.ok(s.x1 > s.x0 && s.z1 > s.z0 && s.h > 0, `${t}: a solid`);
  }
});

test('each building is its own: the old gym\'s goals hang from the wall and ceiling, the high school\'s roll out, the clubhouse has the walk-out', () => {
  const b = built.bronze.v, s = built.silver.v, g = built.gold.v, p = built.platinum.v;
  assert.ok(b.hoops.every(h => h.meshes.length === 6), 'Bronze: no roll-out stanchions');
  assert.ok(s.hoops.every(h => h.meshes.length === 9), 'Silver: portable stanchions');
  assert.ok(b.solids.some(x => x.z1 < -15 && x.h > 0.9 && x.h < 1.2), 'Bronze: the stage');
  assert.equal(b.walkout, null); assert.equal(s.walkout, null);
  assert.ok(g.walkout && p.walkout && g.interactables.some(i => i.id === 'walkout'), 'Gold and Platinum: the doors out');
  assert.equal(g.courts.length, 2, 'Gold: the shootaround court'); assert.equal(g.shootSlots.length, 2);
  assert.equal(b.shootSlots.length, 1); assert.equal(s.shootSlots.length, 1);
  assert.equal(b.office.room, 'office');
  // the Bronze office door is in the wall behind the north goal
  const bd = b.gaps.find(x => x.walk), gym = b.rooms[0];
  assert.ok(Math.abs((bd.z0 + bd.z1) / 2 - gym.z1) < 0.01 && Math.abs((bd.x0 + bd.x1) / 2) < 6, 'Bronze: the office door behind the north goal');
  // Platinum is Gold with the Platinum trim
  assert.notDeepEqual(p.mats.trim.color, g.mats.trim.color);
  assert.ok(built.platinum.scene.meshes.length > built.gold.scene.meshes.length, 'Platinum: its crests');
  // the names on the walls are fictional schools: nothing real
  const src = fs.readFileSync(new URL('../client/js/world/proamhubs.js', import.meta.url), 'utf8');
  assert.match(src, /EASTSIDE MIDDLE/); assert.match(src, /NORTHGATE/);
  assert.doesNotMatch(src, /\b(NBA|2K|Nike|Adidas|Jordan|Spalding|Wilson|Gatorade)\b/);
});

test('the whiteboard: the team, the series game by game, the record and the next opponent, drawn on a canvas in the office', () => {
  const team = { ...TEAM, current: { division: { label: 'Silver 2' }, wins: 1, losses: 1, need: 3, length: 5, games: [{ n: 1, opponent: { name: 'Harbor Kings', kind: 'ai' }, home: true, result: 'W', score: [21, 15] }, { n: 2, opponent: { name: 'Rust Belt', kind: 'team' }, home: false, result: 'L', score: [18, 21] }, { n: 3, opponent: { name: 'Night Shift', kind: 'ai' }, home: true }] } };
  const d = W.whiteboardData(team, { n: 1, end: 1000 + 3 * 86400 + 7200 }, 1000);
  assert.equal(d.name, 'Night Owls'); assert.deepEqual(d.record, [3, 1]);
  assert.deepEqual([d.series.wins, d.series.losses, d.series.need, d.series.length], [1, 1, 3, 5]);
  assert.equal(d.games.length, 3); assert.equal(d.games[0].result, 'W'); assert.deepEqual(d.games[1].score, [18, 21]);
  assert.equal(d.next.n, 3); assert.equal(d.next.opponent, 'Night Shift'); assert.equal(d.next.home, true);
  assert.equal(d.season, 'Season 1 · 3d 2h left');
  assert.equal(W.whiteboardData({ ...TEAM }).series, null, 'no series on');
  // the board in every office redraws its texture
  for (const t of W.HUB_TIERS) {
    const wb = built[t].v.boards.whiteboard, before = wb.draws;
    wb.set(d);
    assert.equal(wb.draws, before + 1); assert.equal(wb.data, d); assert.ok(wb.tex.updated >= 1, `${t}: texture updated`);
  }
});

// ---------------- the hub ----------------
const CHAR = { ...makeTeam(new RNG(5), 1, { catalog: {}, level: 0.6 })[0].build, id: 'c-1', name: 'Hub Tester' };
const pool = () => ({ take: () => null, request: () => ({}), cancel() {}, release() {}, flush() {}, tick() {}, dispose() {}, pending: 0 });
function office() {
  const calls = [];
  return { calls, openOffice: async (app, team, panel, opts) => { calls.push({ fn: 'openOffice', team, panel, opts }); }, queue: async (app, team, opts) => { calls.push({ fn: 'queue', team, opts }); }, load: async () => ({ team: null }) };
}
// a fake online service: you (acc-1) at the hub with these people
function fakeNet(people = [], host = null) {
  const subs = {};
  return { connected: true, myId: 'acc-1', you: { username: 'me' }, place: 'hq:pa:team-1', host, serverSkew: 0, people: new Map(people.map(p => [p.id, { id: p.id, username: p.username, entry: { build: CHAR, name: p.username } }])), sent: [], send(m) { this.sent.push(m); }, entryOf(id) { return this.people.get(id)?.entry || null; }, usernameOf(id) { return this.people.get(id)?.username || '?'; }, on(k, f) { (subs[k] ||= []).push(f); return () => {}; }, emote() {} };
}
function makeHub(o = {}) {
  const toasts = [], U = o.officeUI || office();
  const app = {
    renderer: { ctx, prewarm() {}, project: () => ({ visible: false }) }, catalog: {}, char: () => CHAR, look: () => ({}),
    ai: { gameEntry: id => ({ build: CHAR, name: id, aiId: id }), pick: ({ key }) => 'ai-' + key, recordGame() {} },
    cameraRig: { snap() {}, updateRoam() {}, inputBasis: () => ({ fx: 0, fz: 1, rx: 1, rz: 0 }), roamPitch: 0.32, roamDist: 6 },
    hud: { show() {} }, net: o.net || null, profile: { account: { id: o.me || 'acc-1' } }, modalOpen: () => false,
    input: { wasPressed: () => false, isDown: () => false, moveVector: () => ({ x: 0, y: 0 }), usingPad: false },
  };
  const ui = { toast: (t, k) => toasts.push(t), exit: h => toasts.push('EXIT'), update() {}, pick3s() {}, matchStarted() {} };
  const hub = new H.ProamHub(app, ui, { team: o.team || TEAM, from: o.from || 'park', park: 'harbor', area: o.area, officeUI: U, pool: pool(), enter: o.enter });
  return { hub, app, U, toasts };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('the office\'s interactables are all there and call the Server/UI agent\'s hooks', async () => {
  const { hub, U, toasts } = makeHub();
  const ids = hub.interactables().map(i => i.id);
  for (const id of ['exit', 'whiteboard', 'draft', 'settings', 'queue', 'shoot']) assert.ok(ids.includes(id), id);
  const at = id => hub.interactables().find(i => i.id === id);
  // standing at each one gives its prompt
  for (const id of ['whiteboard', 'draft', 'settings', 'queue']) { const it = at(id); hub.me.setPos(it.x, it.z, 0); assert.equal(hub.nearest()?.id, id, `standing at ${id}`); assert.ok(hub.promptFor(it).length > 5); }
  assert.equal(hub.use(at('whiteboard')), 'whiteboard'); await tick();
  assert.equal(hub.use(at('draft')), 'draft'); await tick();
  assert.equal(hub.use(at('settings')), 'settings'); await tick(); // (acc-1 is the founder)
  assert.equal(hub.use(at('queue')), 'queue'); await tick();
  assert.deepEqual(U.calls.map(c => c.panel || c.fn), ['whiteboard', 'draft', 'settings', 'queue']);
  assert.ok(U.calls.every(c => c.team === TEAM));
  assert.equal(U.calls[1].opts.captain, true, 'alone, you\'re the Captain: the draft is yours');
  assert.deepEqual(U.calls[3].opts.members.map(m => m.id), ['me'], 'the ready check gets the members here, the Captain first');
  assert.equal(hub.use(at('exit')), 'exit'); assert.ok(toasts.includes('EXIT'));
  // the team settings are the founder's
  const other = makeHub({ me: 'acc-2' });
  await other.hub.openPanel('settings');
  assert.equal(other.U.calls.length, 0); assert.match(other.toasts.at(-1), /founder/);
});

test('only the session\'s Captain queues and drafts; everyone can look at the whiteboard; he hands over when he leaves', async () => {
  // ace was here before you (his stamp says so)
  const net = fakeNet([{ id: 'acc-2', username: 'ace' }]);
  const { hub, U, toasts } = makeHub({ net });
  hub.onPeerPos({ from: 'acc-2', x: 0, z: 0, f: 0, m: H.stampCode(hub.arrivedAt - 60000) });
  assert.equal(hub.captainId(), 'acc-2'); assert.equal(hub.isCaptain(), false); assert.equal(hub.captainName(), 'ace');
  assert.equal(await hub.queueNext(), false);
  assert.equal(U.calls.filter(c => c.fn === 'queue').length, 0, 'not the Captain: no queue');
  assert.match(toasts.at(-1), /Only the Captain queues the next game: ace/);
  await hub.openPanel('draft');
  assert.equal(U.calls.at(-1).panel, 'draft'); assert.equal(U.calls.at(-1).opts.captain, false, 'the clipboard opens read-only');
  await hub.openPanel('whiteboard');
  assert.equal(U.calls.at(-1).panel, 'whiteboard');
  assert.match(hub.promptFor({ id: 'queue' }), /ace \(Captain\) queues/);
  // he leaves: you're the Captain now
  net.people.delete('acc-2'); hub.onPeople({ t: 'gone', id: 'acc-2' });
  assert.equal(hub.isCaptain(), true);
  assert.equal(await hub.queueNext(), true);
  assert.equal(U.calls.at(-1).fn, 'queue');
  // the one here longest is the Captain; a newcomer isn't; the service's host wins when it names one
  assert.equal(H.pickCaptain('a', 100, [{ id: 'b', at: 200 }, { id: 'c', at: 300 }]), 'a');
  assert.equal(H.pickCaptain('a', 100, [{ id: 'b', at: 50 }]), 'b');
  assert.equal(H.pickCaptain('b', 100, [{ id: 'a', at: 100 }]), 'a', 'ties to the lowest id');
  assert.equal(H.pickCaptain('a', 100, [{ id: 'b', at: 50 }], 'a'), 'a', 'the host');
  assert.equal(H.pickCaptain('a', 100, [], 'zzz'), 'a', 'a host who isn\'t here doesn\'t count');
  // whoever was here when you arrived counts as before you, until his stamp comes
  const net2 = fakeNet([{ id: 'acc-3', username: 'deuce' }]);
  const h2 = makeHub({ net: net2 }).hub;
  assert.equal(h2.captainId(), 'acc-3');
});

test('the hub\'s pos codes: shooting around, walking out, arrival stamps; never a speed', () => {
  assert.equal(H.posCode(2.4), null); assert.equal(H.posCode(0), null); assert.equal(H.posCode(undefined), null);
  assert.deepEqual(H.posCode(H.shootCode(0)), { kind: 'shoot', slot: 0 });
  assert.deepEqual(H.posCode(H.shootCode(1)), { kind: 'shoot', slot: 1 });
  assert.deepEqual(H.posCode(H.POS.WALKOUT), { kind: 'walkout' });
  const at = 1792382400123;
  assert.deepEqual(H.posCode(H.stampCode(at)), { kind: 'stamp', at });
  assert.ok(Number.isSafeInteger(H.stampCode(at)));
  // the stamp goes out to the people here, with the place's own key ('hq:': no park director, no court claims)
  const net = fakeNet([{ id: 'acc-2', username: 'ace' }]);
  const { hub } = makeHub({ net });
  assert.equal(hub.placeKey(), 'hq:pa:team-1');
  hub.frame(0.3);
  const m = net.sent.find(x => x.t === 'pos');
  assert.ok(m && H.posCode(m.m).kind === 'stamp');
  // a team member's shootaround code doesn't make him a walker
  hub.onPeerPos({ from: 'acc-2', x: 0, z: 9, f: 0, m: 3.1 });
  assert.equal(hub.peers.size, 1);
});

test('one goal, several shootarounds: the net moves once a frame, for the ball nearest the rim', () => {
  const steps = [];
  const goal = { rim: { x: 0, y: 3.05, z: 12.7 }, update(dt, b) { steps.push([dt, b]); }, hit(s) { this.hits = (this.hits || 0) + s; } };
  const sh = new H.SharedHoop(goal);
  const far = { x: 0, y: 1, z: 0 }, near = { x: 0, y: 3, z: 12.5 };
  sh.proxy.update(1 / 60, far); sh.proxy.update(1 / 60, near);
  assert.equal(steps.length, 0);
  sh.step();
  assert.equal(steps.length, 1); assert.equal(steps[0][1], near);
  sh.step(); assert.equal(steps.length, 1, 'nothing new, no step');
  sh.proxy.hit(2); assert.equal(goal.hits, 2);
  assert.equal(sh.proxy.rim, goal.rim);
});

test('a Gold clubhouse\'s floor, walls, logo and colors change its materials; Bronze and Silver keep theirs', () => {
  const A = { floor: 'ebony', walls: 'concrete', logo: 'crown', colors: ['#c8322f', '#f4f2ec'] }, B = { floor: 'whitewash', walls: 'panel', logo: 'star', colors: ['#0d8a8f', '#f2c14e'] };
  const a = build('gold', tierTeam('gold', { custom: A })), b = build('gold', tierTeam('gold', { custom: B }));
  assert.equal(a.v.mats.wall.wallStyle, 'concrete'); assert.equal(b.v.mats.wall.wallStyle, 'panel');
  assert.notEqual(a.v.mats.wall.map, b.v.mats.wall.map);
  assert.notDeepEqual(a.v.mats.wall.uvScale, b.v.mats.wall.uvScale);
  assert.equal(a.v.mats.slab.floorStyle, 'ebony'); assert.equal(b.v.mats.slab.floorStyle, 'whitewash');
  assert.notDeepEqual(a.v.mats.teamA.color, b.v.mats.teamA.color);
  assert.equal(a.v.look.logo, 'crown'); assert.equal(a.v.look.primary, '#c8322f');
  assert.equal(W.hubCourtSpec('gold', a.v.look).logo.shape, 'crown');
  assert.deepEqual(W.hubCourtSpec('gold', a.v.look).woodTone, W.HUB_FLOORS.ebony.tone);
  // repainting in the office: the same clubhouse, the new look
  const v = a.v, floorsBefore = v.courts[0].floor, n = a.scene.meshes.length, wallMat = v.mats.wall;
  assert.equal(v.paint(tierTeam('gold', { custom: B })), true);
  assert.equal(v.mats.wall, wallMat, 'the same material, a new look');
  assert.equal(v.mats.wall.wallStyle, 'panel'); assert.equal(v.mats.slab.floorStyle, 'whitewash');
  assert.deepEqual(v.mats.teamA.color, b.v.mats.teamA.color);
  assert.notEqual(v.courts[0].floor, floorsBefore, 'the court floor painted again');
  assert.equal(a.scene.meshes.length, n, 'nothing left over');
  assert.equal(v.look.logo, 'star');
  // the choices are the ones the settings panel offers
  for (const k of Object.keys(W.HUB_FLOORS)) assert.ok(W.HUB_FLOORS[k].label && W.HUB_FLOORS[k].tone.length === 3);
  for (const k of Object.keys(W.HUB_WALLS)) assert.ok(W.HUB_WALLS[k].label);
  assert.ok(W.HUB_LOGOS.includes('wolf') && W.logoShape('wolf') === 'circle' && W.logoShape('bolt') === 'bolt');
  // junk falls back; Bronze and Silver ignore a custom look
  const junk = W.hubLook({ ...TEAM, custom: { floor: 'lava', walls: 'gold leaf', logo: 'x', colors: ['red', 7] } });
  assert.deepEqual([junk.floor, junk.walls, junk.logo, junk.primary], ['natural', 'brick', 'shield', '#2457c5']);
  const br = build('bronze', tierTeam('bronze', { custom: A }));
  assert.equal(br.v.look.floor, 'natural'); assert.equal(br.v.paint(tierTeam('bronze', { custom: B })), false);
  // the team's colors come from team.custom.colors, then team.colors, then primary/secondary
  assert.equal(W.hubLook({ colors: ['#111111', '#eeeeee'] }).primary, '#111111');
  assert.equal(W.hubLook({ primary: '#123456', secondary: '#123456' }).secondary, '#f6f2ea', 'a second color that reads');
});

test('the walk-out (Gold): the team\'s home park, built with the World agent\'s builder; you come out of its clubhouse door', () => {
  const entered = [];
  const gold = tierTeam('gold');
  const { hub, app } = makeHub({ team: gold, enter: (a, o) => { entered.push(o); return o; } });
  assert.ok(hub.venue.walkout);
  const wo = hub.interactables().find(i => i.id === 'walkout');
  hub.me.setPos(wo.x, wo.z, 0);
  assert.equal(hub.nearest().id, 'walkout'); assert.match(hub.promptFor(wo), /Long Beach/);
  hub.use(wo);
  assert.equal(entered.length, 1); assert.equal(entered[0].area, 'park'); assert.equal(entered[0].team, gold); assert.equal(entered[0].from, 'park');
  // the home park itself
  const out = makeHub({ team: gold, area: 'park', enter: (a, o) => { entered.push(o); return o; } }).hub;
  assert.equal(out.area, 'park'); assert.equal(out.parkId, 'longbeach'); assert.equal(out.venue.proam, 'longbeach');
  assert.equal(out.placeKey(), 'hq:pa:team-1:out');
  assert.equal(out.venue.home.name, 'Night Owls', 'the park wears the team\'s colors');
  const d = out.venue.clubhouse.door;
  assert.ok(Math.hypot(out.me.x - d.x, out.me.z - d.z) < 1.2, 'out of the clubhouse door');
  const ids = out.interactables().map(i => i.id);
  assert.ok(ids.includes('walkin') && ids.includes('home3s'));
  assert.equal(out.nearest()?.id, 'walkin');
  out.use(out.interactables().find(i => i.id === 'walkin'));
  assert.equal(entered.at(-1).area, 'hub'); assert.equal(entered.at(-1).at, 'walkout');
  // back inside, you're by the doors
  const back = makeHub({ team: gold, area: 'hub' }).hub;
  void back;
  const inside = new H.ProamHub(app, { toast() {}, update() {} }, { team: gold, area: 'hub', at: 'walkout', officeUI: office(), pool: pool() });
  assert.ok(Math.hypot(inside.me.x - inside.venue.walkout.x, inside.me.z - inside.venue.walkout.z) < 1.5);
  // a team with no home court of its own still has one to walk out to (the same for everyone on it)
  const p1 = W.homePark({ id: 'abc', court: null }), p2 = W.homePark({ id: 'abc' });
  assert.equal(p1, p2); assert.ok(PROAM_IDS.includes(p1));
  assert.equal(W.homePark({ court: 'proam_cage' }), 'cage');
  // Bronze has no doors out
  const br = makeHub().hub;
  assert.equal(br.walkOut(), false);
});

test('home-court 3s ask the service for a small-VC, no-Rep ticket (pa_home) and play unpaid without it', async () => {
  const posts = [];
  const { hub, app } = makeHub({ team: tierTeam('gold'), area: 'park' });
  app.api = { mutate: async (url, body) => { posts.push([url, body]); throw new Error('Unsupported fields in request.'); } };
  const t = await hub.homeTicket();
  assert.equal(t, null);
  assert.equal(posts[0][0], '/api/matches');
  assert.deepEqual({ ...posts[0][1], character_id: undefined, target: undefined, difficulty: undefined }, { character_id: undefined, mode: 'park', venue: 'proam_longbeach', format: 3, target: undefined, difficulty: undefined, pa_home: true });
  assert.equal(H.HOME_FORMAT, 3);
});

test('no team: the hub sends you to the Pro-Am tab\'s create/join instead', async () => {
  let toCreate = 0, toasted = '';
  const app = { proam: null };
  const r = await H.enterHub(app, { from: 'park', park: 'harbor', officeUI: { load: async () => ({ team: null, season: { n: 1 } }) }, toCreate: async () => { toCreate++; }, toast: t => { toasted = t; }, modes: { leaveWorld() { throw new Error('left the park'); } } });
  assert.equal(r, null); assert.equal(toCreate, 1); assert.match(toasted, /Create a Pro-Am team or join one/);
  assert.equal(app.world, undefined);
});

test('the ways in and out are wired: the park\'s HUB doors import this module, leaving puts you back at them', () => {
  const park = fs.readFileSync(new URL('../client/js/game/park.js', import.meta.url), 'utf8');
  assert.match(park, /import\('\.\/proamhub\.js'\)\.then\(m => m\.enterHub\(this\.app, \{ from: 'park', park: this\.themeId \}\)\)/);
  const modes = fs.readFileSync(new URL('../client/js/ui/modes.js', import.meta.url), 'utf8');
  assert.match(modes, /opts\.at === 'proam' && hub\.venue\.proamHub/);
  const hub = fs.readFileSync(new URL('../client/js/game/proamhub.js', import.meta.url), 'utf8');
  assert.match(hub, /Modes\.enterPark\(this\.app, hub\.park, \{ at: 'proam' \}\)/);
  assert.match(hub, /S\.go\(app, 'proam', \{ view: 'start' \}\)/);
  assert.doesNotMatch(hub, /\b(NBA|2K|Nike|Adidas|Jordan)\b/);
});
