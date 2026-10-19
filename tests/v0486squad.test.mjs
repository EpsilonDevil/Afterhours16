// v0.4.8.6 quick patch: the ICON Squad (sim/iconsquad.js, sim/world.js AIWorld.iconSquad). Every 9 hours, give or take 10-30
// minutes, a full squad of three real AI 99 OVR ICONs of your world shows up at one of the three parks for an hour, in
// one outfit, on builds that fit together; only ever one squad at a time. (The park side: v0486squadpark.test.mjs; the
// menus: v0486squadui.test.mjs.)
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AIWorld, PARKS } from '../client/js/sim/world.js';
import { ICON_SQUAD, squadWindow, squadWindowAt, nextSquadWindow, setSquadClock, pickTrio, trioFit, squadOutfit, FIT_SLOTS, MAX_ICONS_PER_AI_TEAM, isIconEntry } from '../client/js/sim/iconsquad.js';
import { iconStatus } from '../client/js/sim/builds.js';

const CATALOG = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../server/catalog.json', import.meta.url), 'utf8')).map(i => [i.id, i]));
const DAY = 86400000, MIN = 60000, H = 3600000;
const worldAt = (seed, t, days) => new AIWorld({ seed, born: t - days * DAY }, CATALOG);
const CLOTHES = ['top', 'bottom', 'shoes', 'socks', 'headband', 'sleeve', 'wristband', 'leg_sleeve', 'knee_pad', 'chain'];

test('the schedule: 9 hours apart give or take 10-30 minutes (early or late), an hour long, never the same park twice running', () => {
  assert.equal(ICON_SQUAD.first, Date.parse('2026-10-19T02:00:00Z')); // (Sun Oct 18 2026, 7 PM Pacific)
  assert.deepEqual(ICON_SQUAD.parks, PARKS);
  assert.equal(ICON_SQUAD.every, 9 * H);
  const n = 2200, count = { harbor: 0, brick: 0, foundry: 0 }, offs = new Set();
  let early = 0;
  let prev = squadWindow(0);
  count[prev.park]++;
  for (let k = 1; k < n; k++) {
    const w = squadWindow(k), gap = w.start - prev.start;
    const off = Math.abs(gap - 9 * H);
    assert.ok(off >= 10 * MIN && off <= 30 * MIN, `window ${k}: ${gap / MIN} min after the last`);
    assert.equal(w.shift, gap - 9 * H);
    if (gap < 9 * H) early++;
    assert.equal(w.end - w.start, 60 * MIN);
    assert.ok(w.start >= prev.end + 7.5 * H, 'windows never overlap');
    assert.notEqual(w.park, prev.park, `window ${k} at the same park as ${k - 1}`);
    count[w.park]++; offs.add(Math.round(w.shift / MIN));
    prev = w;
  }
  // every park gets its share (about a third each); early and late about half each; every minute from 10 to 30 either way
  for (const p of PARKS) assert.ok(count[p] > n * 0.28 && count[p] < n * 0.39, `${p}: ${count[p]}`);
  assert.ok(early > n * 0.45 && early < n * 0.55, `${early} early`);
  assert.equal(offs.size, 42);
  // it walks round the clock: the hour of day (Pacific) of its arrivals over two months covers the whole day
  const hours = new Set();
  for (let k = 0; k < 120; k++) hours.add(new Date(squadWindow(k).start).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }));
  assert.equal(hours.size, 24);
});

test('the window on at a moment, and the next one: one at a time, the same answer everywhere', () => {
  assert.equal(squadWindowAt(ICON_SQUAD.first - 1), null);
  assert.equal(nextSquadWindow(ICON_SQUAD.first - 1).k, 0);
  for (const k of [0, 1, 7, 100, 999]) {
    const w = squadWindow(k);
    assert.equal(squadWindowAt(w.start).k, k);
    assert.equal(squadWindowAt(w.end - 1).k, k);
    assert.equal(squadWindowAt(w.end), null);
    assert.equal(squadWindowAt(w.start - 1), null);
    assert.equal(nextSquadWindow(w.start).k, k + 1);
    assert.equal(nextSquadWindow(w.start - 1).k, k);
  }
  // random moments over a year: on in about 1/9 of them, and then inside the window it names
  let on = 0;
  for (let i = 0; i < 4000; i++) {
    const t = ICON_SQUAD.first + Math.random() * 365 * DAY, w = squadWindowAt(t);
    if (w) { on++; assert.ok(t >= w.start && t < w.end); }
  }
  assert.ok(on > 4000 * 0.09 && on < 4000 * 0.135, `${on}`);
  // the server's clock: a PC 3 minutes slow still sees the squad arrive when the server says (3 minutes earlier on its clock)
  const w = squadWindow(5);
  setSquadClock(3 * MIN);
  try { assert.equal(squadWindowAt(w.start - 3 * MIN).k, 5); assert.equal(squadWindow(5).start, w.start - 3 * MIN); } finally { setSquadClock(0); }
});

test('the squad: three real 99 OVR ICONs of your world, a handler, a wing and a big on three different archetypes', () => {
  const seen = new Set();
  for (const seed of [4242, 777, 31337]) for (const k of [3, 4, 5, 6]) {
    const w = squadWindow(k), t = w.start + 5 * MIN, W = worldAt(seed, w.start, 365), sq = W.iconSquad(t);
    assert.ok(sq, `seed ${seed} window ${k}`);
    assert.equal(sq.k, k); assert.equal(sq.park, w.park); assert.equal(sq.start, w.start); assert.equal(sq.end, w.end);
    assert.equal(new Set(sq.ids).size, 3);
    assert.ok(sq.ids.includes(sq.leader));
    assert.deepEqual(sq.roles, ['handler', 'wing', 'big']);
    const es = sq.ids.map(id => W.entry(id, t));
    for (const e of es) { assert.ok(iconStatus(e.build), `${e.name} is an ICON`); assert.equal(e.build.overall, 99); assert.ok(isIconEntry(e)); }
    const [hd, wg, bg] = es.map(e => e.build.position);
    assert.ok(['PG', 'SG'].includes(hd) && ['SG', 'SF'].includes(wg) && ['PF', 'C'].includes(bg), `${hd} ${wg} ${bg}`);
    assert.equal(new Set(es.map(e => e.build.archetype)).size, 3);
    assert.ok(sq.fit >= 15, `fit ${sq.fit}`);
    // the same world asks again: the same squad
    assert.deepEqual(worldAt(seed, w.start, 365).iconSquad(t + 20 * MIN).ids, sq.ids);
    seen.add(sq.ids.join());
  }
  assert.ok(seen.size >= 9, `${seen.size} different squads in 12 windows`); // (a different squad most times)
});

test('a world without three ICONs yet has no squad (the AI play by your rules: nobody is made an ICON for it)', () => {
  const w = squadWindow(4), t = w.start + MIN;
  const young = worldAt(4242, w.start, 25);
  assert.equal(young.iconPool(t).length, 0);
  assert.equal(young.iconSquad(t), null);
  for (let i = 0; i < 900; i += 7) assert.equal(young.status('ai-' + i, t)?.iconSquad, undefined);
  // two months in: six to nine ICONs, enough for a squad
  const older = worldAt(4242, w.start, 60), pool = older.iconPool(t);
  assert.ok(pool.length >= 3, `${pool.length}`);
  assert.ok(older.iconSquad(t));
});

test('one outfit on all three: the leader\'s clothes, only what all three can wear; their own names, numbers and animations', () => {
  for (const seed of [4242, 777]) for (const k of [3, 8, 13]) {
    const w = squadWindow(k), t = w.start + MIN, W = worldAt(seed, w.start, 365), sq = W.iconSquad(t);
    const es = sq.ids.map(id => W.entry(id, t));
    for (const slot of CLOTHES) {
      const v = es.map(e => e.build.equipment[slot] || null);
      assert.ok(v.every(x => x === v[0]), `${slot}: ${v}`);
      assert.equal(v[0], sq.outfit[slot] || null);
    }
    for (const slot of ['top', 'bottom', 'shoes']) assert.ok(sq.outfit[slot], slot);
    for (const id of Object.values(sq.outfit).filter(Boolean)) {
      const it = CATALOG[id];
      assert.ok(it && FIT_SLOTS.includes(it.slot));
      if (it.exclusive) for (const e of es) assert.ok([...(e.unlocked?.wheel || []), ...(e.unlocked?.prizes || [])].includes(id), `${e.name} owns ${id}`);
    }
    assert.equal(new Set(es.map(e => e.name)).size, 3);
    // the leader's own clothes are what they wear, where all three can (his top, at least, in most windows)
    const lead = W.entry(sq.leader, w.start - 2 * H); // (before the window: his own fit)
    assert.ok(CLOTHES.filter(s => (lead.build.equipment[s] || null) === (sq.outfit[s] || null)).length >= 6);
    // after the hour: back in their own clothes
    const after = sq.ids.map(id => W.entry(id, w.end + MIN));
    assert.ok(after.some((e, i) => CLOTHES.some(s => (e.build.equipment[s] || null) !== (es[i].build.equipment[s] || null))));
    for (const e of after) assert.equal(e.iconSquad, undefined);
    for (const e of es) assert.equal(e.iconSquad, k);
  }
});

test('for the hour they are at the squad\'s park, nowhere else; then back to their own day', () => {
  for (const seed of [4242, 31337]) {
    const w = squadWindow(6), t = w.start + 17 * MIN, W = worldAt(seed, w.start, 200), sq = W.iconSquad(t);
    for (const id of sq.ids) {
      assert.deepEqual(W.status(id, t), { park: sq.park, until: sq.end, iconSquad: 6 });
      assert.ok(W.onlineAt(sq.park, t).includes(id));
      for (const p of PARKS.filter(x => x !== sq.park)) assert.ok(!W.onlineAt(p, t).includes(id));
      assert.match(W.statusText(id, t).text, /^Online at .+ with his ICON squad · on for 45 more min$/);
      assert.match(W.statusText(id, t, sq.park).text, /^Online at this park with his ICON squad/);
      assert.equal(W.status(id, w.end + MIN)?.iconSquad, undefined);
    }
    // only ever one squad: over the hour and around it, exactly three AI (all at one park) are with an ICON squad, or none
    for (let m = -30; m < 90; m += 7) {
      const tt = w.start + m * MIN, with_ = [];
      for (let i = 0; i < 900; i++) { const s = W.status('ai-' + i, tt); if (s?.iconSquad != null) with_.push(s.park); }
      if (m >= 0 && m < 60) { assert.equal(with_.length, 3); assert.equal(new Set(with_).size, 1); } else assert.equal(with_.length, 0);
    }
  }
});

test('they are busy with it: no invites, they leave your squad, no Pro-Am fill-ins, not in your old squad\'s party', () => {
  const w = squadWindow(7), t = w.start + 10 * MIN, W = worldAt(4242, w.start, 365), sq = W.iconSquad(t);
  const [a, b] = sq.ids;
  W.addFriend(a); W.addFriend(b);
  const r = W.invite(a, t);
  assert.equal(r.ok, false);
  assert.match(r.msg, /is running with his ICON squad at (Harbor Point|Old Brick Yard|Foundry Works) until \d{1,2}:\d\d (AM|PM)\.$/);
  // one who was in your squad before the hour: he's gone to run with them
  W.squad = [b];
  assert.deepEqual(W.activeSquad(t), []);
  assert.deepEqual(W.squad, []);
  assert.equal(W.playingElsewhere(a, t), true);
  for (const id of sq.ids) {
    const e = W.entry(id, t);
    assert.notEqual(W.pick({ position: e.build.position, level: W.account(id).level, key: 'x' }, t), id);
  }
  W.exSquad = { ids: sq.ids.slice(), at: t - H };
  assert.ok(W.aiParty(t).every(id => !sq.ids.includes(id)));
  // after the hour: an invite goes through as before
  W.squad = [];
  const later = w.end + 5 * MIN;
  if (W.online(a, later) && !W.playingElsewhere(a, later)) assert.equal(W.invite(a, later).ok, true);
});

test('pickTrio: the best fit, a different pick per window among equals, and a new ICON only changes it when he fits better', () => {
  assert.equal(pickTrio([], 1), null);
  assert.equal(pickTrio([{ id: 'a', position: 'PG', archetype: 'playmaker' }, { id: 'b', position: 'C', archetype: 'glass_cleaner' }], 1), null);
  assert.equal(trioFit({ position: 'PG', archetype: 'playmaker' }, { position: 'SF', archetype: 'sharpshooter' }, { position: 'C', archetype: 'glass_cleaner' }), 16);
  assert.equal(trioFit({ position: 'PG', archetype: 'playmaker' }, { position: 'PG', archetype: 'playmaker' }, { position: 'PG', archetype: 'playmaker' }), 1);
  const pool = [
    { id: 'g1', position: 'PG', archetype: 'playmaker' }, { id: 'g2', position: 'PG', archetype: 'sharpshooter' },
    { id: 'w1', position: 'SF', archetype: 'lockdown' }, { id: 'w2', position: 'SF', archetype: 'sharpshooter' },
    { id: 'b1', position: 'C', archetype: 'glass_cleaner' }, { id: 'b2', position: 'PF', archetype: 'stretch_big' },
    { id: 'x1', position: 'PG', archetype: 'lockdown' }, { id: 'x2', position: 'PG', archetype: 'slasher' },
  ];
  const picks = new Set();
  for (let k = 0; k < 40; k++) {
    const p = pickTrio(pool, k), es = p.ids.map(id => pool.find(x => x.id === id));
    assert.ok(p.fit >= 15);
    assert.equal(trioFit(...es), p.fit);
    assert.ok(['PG', 'SG'].includes(es[0].position) && ['PF', 'C'].includes(es[2].position));
    picks.add(p.ids.join());
    // one more guard who can't make a good trio better: the same squad, unless his draw this window is the lower one
    const more = pickTrio([...pool, { id: 'x3', position: 'PG', archetype: 'playmaker' }], k);
    assert.ok(more.fit >= 15 && (more.ids.join() === p.ids.join() || more.ids.includes('x3')));
  }
  assert.ok(picks.size >= 5, `${picks.size}`);
  // three guards only: still a squad (the best they can do)
  const g = pickTrio(pool.filter(x => x.position === 'PG'), 3);
  assert.ok(g && g.fit < 15 && new Set(g.ids).size === 3);
});

test('squadOutfit: an exclusive goes on only when all three have it; a slot the leader leaves empty stays empty', () => {
  const W = worldAt(4242, squadWindow(3).start, 365), t = squadWindow(3).start;
  const base = W.iconPool(t).slice(0, 3).map(p => W.entry(p.id, t));
  const mk = (e, eq, owned = []) => ({ build: { ...e.build, equipment: { ...e.build.equipment, ...eq } }, owned });
  const jersey = 'wheel_jersey_aurora';
  assert.equal(CATALOG[jersey].exclusive, 'wheel');
  const store = Object.values(CATALOG).find(i => i.slot === 'top' && !i.exclusive && !i.min_overall && !i.rep_required).id;
  // the leader's wheel jersey: one of the others doesn't have it → the next member's top
  let o = squadOutfit([mk(base[0], { top: jersey, headband: undefined }, [jersey]), mk(base[1], { top: store }, []), mk(base[2], {}, [jersey])], CATALOG, 3);
  assert.equal(o.top, store);
  assert.equal(o.headband, null);
  // all three have it → on all three
  o = squadOutfit([mk(base[0], { top: jersey }, [jersey]), mk(base[1], { top: store }, [jersey]), mk(base[2], {}, [jersey])], CATALOG, 3);
  assert.equal(o.top, jersey);
  // nobody's top fits all three: a store top they all can wear
  o = squadOutfit([mk(base[0], { top: jersey }, [jersey]), mk(base[1], { top: jersey }, []), mk(base[2], { top: jersey }, [])], CATALOG, 3);
  assert.ok(o.top && !CATALOG[o.top].exclusive && CATALOG[o.top].slot === 'top');
});

test('the 3-ICON rule\'s numbers, and the pick in the game: a slice at a time off the frame, the same squad as the one at once', async () => {
  assert.equal(MAX_ICONS_PER_AI_TEAM, 2);
  assert.equal(isIconEntry(null), false);
  const w = squadWindow(9), t = w.start + 3 * MIN;
  const sync = worldAt(777, w.start, 365).iconSquad(t);
  const W = worldAt(777, w.start, 365);
  W.squadAsync = true;
  assert.equal(W.iconSquad(t), null); // (picking: not there yet)
  assert.equal(W.status(sync.ids[0], t)?.iconSquad, undefined);
  const s = await W.prepareSquad(squadWindowAt(t), 2);
  assert.deepEqual(s.ids, sync.ids);
  assert.deepEqual(W.iconSquad(t).ids, sync.ids);
  assert.equal(W.status(sync.ids[0], t).iconSquad, 9);
  // warmed up before its hour: ready the moment it starts
  const nx = squadWindow(10), V = worldAt(777, nx.start, 365);
  V.squadAsync = true;
  await V.prepareSquad(nextSquadWindow(nx.start - 3 * MIN));
  assert.ok(V.iconSquad(nx.start));
});
