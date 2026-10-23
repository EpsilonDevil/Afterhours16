// v0.4.8.9 qp4, the Hub agent's round 1 (scratchpad contract QP4: the Gauntlet in possessions): the Gauntlet tab, the
// court's possession plays (tip-off, transition, fast break, each shot outcome, rebounds, fouls, free throws, the
// defensive cards) from hand-written event lists shaped as the contract's §4, and the match screen's new pieces
// (turn banner, their committed set, the clash bar). The engine itself is the Deck agent's (not used here).
// Run: node --test tests/qp4hub.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fake2d = new Proxy({}, { get: (o, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'getImageData' || k === 'createImageData' ? (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fake2d; } };
const C = await import('../client/js/game/deckcine.js');
const V = await import('../client/js/ui/gauntletview.js');
const D = await import('../client/js/deck/index.js');
const GX = await import('../client/js/ui/gauntlet.js');
const src = f => fs.readFileSync(new URL('../client/js/' + f, import.meta.url), 'utf8');

test('the Gauntlet has its own tab, between Pro-Am and Practice, and keeps its Home tile', () => {
  const s = src('ui/screens.js');
  const nav = s.match(/const NAV = (\[.*?\]\]);/)[1];
  const ids = [...nav.matchAll(/\['(\w+)'/g)].map(m => m[1]);
  assert.deepEqual(ids.slice(ids.indexOf('proam'), ids.indexOf('proam') + 3), ['proam', 'gauntlet', 'practice']);
  assert.match(s, /case 'gauntlet': return import\('\.\/gauntlet\.js'\)/);
  assert.match(s, /class="tile t-gauntlet" data-go="gauntlet"/);
  // (like every tab: disabled without a player, and the pad's bumpers walk the strip's enabled buttons)
  assert.match(s, /\$\{!c && id !== 'home' \? 'disabled' : ''\}/);
});

// a possession sequence shaped as the engine sends it (GAUNTLET.md §14-§15)
const SEQ = [
  { type: 'jump', actor: 'you', anim: 'rebound', text: 'Tip-off: you win it.' },
  { type: 'possession', to: 'you', turnType: 'offense' },
  { type: 'card', actor: 'you', anim: 'crossover' }, { type: 'card', actor: 0, anim: 'contest' }, { type: 'card', actor: 'you', anim: 'pass' },
  { type: 'shot', actor: 'you', anim: 'three', made: true, points: 6, stops: 3, how: 'assist', assist: 'you' },
  { type: 'clash', o: 9, d: 3, winner: 'offense' },
  { type: 'possession', to: 'them', turnType: 'defense' },
  { type: 'card', actor: 0, anim: 'spin' }, { type: 'card', actor: 'you', anim: 'block' },
  { type: 'shot', actor: 0, anim: 'layup', made: false, points: 0, stops: 7, how: 'block' },
  { type: 'rebound', actor: 'you', offensive: false },
  { type: 'clash', o: 4, d: 7, winner: 'defense' },
  { type: 'possession', to: 'you', turnType: 'offense' },
  { type: 'shot', actor: 'you', anim: 'jumper', made: false, points: 0, stops: 5, how: 'contest' },
  { type: 'rebound', actor: 'you', offensive: true },
  { type: 'possession', to: 'you', turnType: 'second_chance' },
  { type: 'shot', actor: 'you', anim: 'layup', made: true, points: 4, how: 'and_one' }, { type: 'foul', actor: 0 }, { type: 'ft', actor: 'you', points: 1 },
  { type: 'possession', to: 'them', turnType: 'defense' },
  { type: 'card', actor: 'you', anim: 'steal' }, { type: 'shot', actor: 0, anim: 'jumper', made: false, how: 'steal' },
  { type: 'possession', to: 'you', turnType: 'fast_break', text: 'Fast break: you stole it' },
  { type: 'shot', actor: 'you', anim: 'dunk', made: true, points: 8, how: 'made' },
  { type: 'possession', to: 'them', turnType: 'offense' },
  { type: 'shot', actor: 0, anim: 'post', made: true, points: 3, how: 'made' },
  { type: 'end', won: true },
];

test('every possession event plays the right thing (or nothing: the clash is the bar\'s)', () => {
  const P = e => C.playFor(e, { opps: 2, target: 0 });
  const tip = P({ type: 'tip', winner: 'them' });
  assert.deepEqual([tip.anim, tip.winner, tip.offWho, tip.defWho], ['tipoff', 'them', 0, 'you']);
  assert.equal(P({ type: 'possession', to: 'you', turnType: 'defense' }).anim, 'transition');
  const fb = P({ type: 'possession', to: 'you', turnType: 'fast_break' });
  assert.deepEqual([fb.anim, fb.offWho], ['fastbreak', 'you']);
  const reb = P({ type: 'rebound', actor: 1, offensive: true });
  assert.deepEqual([reb.anim, reb.offWho, reb.offensive], ['board', 1, true]);
  assert.equal(P({ type: 'foul', actor: 0 }).anim, 'foul');
  const ft = P({ type: 'ft', actor: 'you', points: 2 });
  assert.deepEqual([ft.anim, ft.made, ft.points, ft.scoring], ['freethrow', true, 2, true]);
  assert.equal(P({ type: 'ft', actor: 'you', points: 0 }).made, false);
  assert.equal(P({ type: 'clash', o: 3, d: 9, winner: 'defense' }), null);
  const shot = (how, extra = {}) => P({ type: 'shot', actor: 'you', anim: 'layup', points: 5, stops: 2, how, ...extra });
  assert.deepEqual([shot('made').anim, shot('made').made], ['layup', true]);
  const ast = shot('assist', { assist: 'you' });
  assert.deepEqual([ast.anim, ast.made, ast.shotAnim, ast.assistWho], ['assist', true, 'layup', 'you']);
  assert.deepEqual([shot('and_one').anim, shot('and_one').made], ['andone', true]);
  const blk = shot('block');
  assert.deepEqual([blk.anim, blk.made, blk.offWho, blk.defWho], ['block', false, 'you', 0]);
  const stl = shot('steal');
  assert.deepEqual([stl.anim, stl.scoring, stl.defWho], ['steal', false, 0]);
  const miss = shot('contest', { points: 0 });
  assert.deepEqual([miss.anim, miss.made, miss.scoring], ['layup', false, true]);
  // their shot: on you
  const theirs = P({ type: 'shot', actor: 1, anim: 'three', points: 4, how: 'made' });
  assert.deepEqual([theirs.offWho, theirs.defWho, theirs.made, theirs.big], [1, 'you', true, true]);
  // a defensive card is the defender getting into it (no shot of its own); a shot tag on a card is a size-up
  for (const [anim, want] of [['contest', 'guard'], ['block', 'protect'], ['steal', 'swipe'], ['rebound', 'boxout'], ['foul', 'guard'], ['jumper', 'sizeup'], ['lob', 'pass']]) {
    const p = P({ type: 'card', actor: 'you', anim });
    assert.equal(p.anim, want, anim); assert.equal(p.scoring, false, anim);
  }
  for (const a of ['tipoff', 'transition', 'fastbreak', 'assist', 'andone', 'board', 'freethrow', 'guard', 'protect', 'swipe', 'boxout', 'sizeup']) assert.ok(C.SCRIPTED.includes(a) && C.PLAYS[a], a);
});

test('a whole sequence plays on the court as possessions: run on within one, every make scores, nothing breaks', () => {
  const landed = [];
  const dc = new C.DeckCourt({ catalog: {} }, { seed: 4, opps: [], onLand: (p, s) => landed.push([p.anim, s.slice()]) });
  const plays = dc.enqueue(SEQ);
  assert.equal(plays.length, SEQ.filter(e => e.type !== 'clash' && e.type !== 'end').length);
  const names = plays.map(p => p.anim);
  assert.deepEqual(names.slice(0, 6), ['tipoff', 'transition', 'crossover', 'guard', 'pass', 'assist']);
  // the tip-off, the run back, a fast break and the free throws set the floor up; the plays after them run on
  for (const p of plays) if (['tipoff', 'transition', 'fastbreak', 'freethrow'].includes(p.anim)) assert.ok(!p.cont, p.anim);
  assert.ok(plays.filter(p => p.cont).length >= 10, 'most plays run on from the last');
  assert.ok(plays.find(p => p.anim === 'board').cont, 'a rebound runs on from the miss, whoever gets it');
  let t = 0;
  while (dc.busy && t < 120) {
    dc.frame(1 / 30); t += 1 / 30;
    assert.ok([dc.ball.x, dc.ball.y, dc.ball.z].every(Number.isFinite), 'the ball');
    for (const a of dc.actors) assert.ok([a.p.x, a.p.z, a.p.y, a.p.facing].every(Number.isFinite), 'the players');
  }
  assert.ok(!dc.busy, 'the queue played out');
  assert.equal(landed.length, plays.length);
  assert.deepEqual(dc.score, [6 + 4 + 1 + 8, 3], 'the makes and the free throw score, nothing else does');
  // skip and fast-forward still work in the middle of a possession
  const dc2 = new C.DeckCourt({ catalog: {} }, { seed: 6 });
  dc2.enqueue(SEQ.slice(0, 7)); dc2.setFast(true);
  for (let i = 0; i < 40; i++) dc2.frame(1 / 30);
  dc2.skip(); dc2.skipAll();
  assert.ok(!dc2.busy); assert.deepEqual(dc2.score, [6, 0]);
});

test('the tip-off goes to the winner: his side has the ball when it ends', () => {
  for (const winner of ['you', 'them']) {
    const dc = new C.DeckCourt({ catalog: {} }, { seed: 12 });
    dc.enqueue([{ type: 'tip', winner }]);
    let t = 0; while (dc.busy && t < 10) { dc.frame(1 / 60); t += 1 / 60; }
    assert.equal(dc.ball.holder?.side, winner === 'you' ? 'you' : 'opp', winner);
  }
});

test('the turn banner, their committed set (face up and face down) and the clash bar', () => {
  assert.match(V.turnBannerHTML({ turnType: 'fast_break', turnLabel: 'Fast break: you stole it', ball: 'you' }), /tt-fast_break side-you[^]*Fast break[^]*you stole it/);
  assert.match(V.turnBannerHTML({ phase: 'jump' }), /Jump ball/);
  assert.match(V.turnBannerHTML({ ball: 'them' }), /side-them[^]*Defense/);
  const open = V.foeSetHTML({ hidden: false, total: 9, cards: [{ name: 'Closeout', kind: 'defense', value: 5, anim: 'closeout', tags: ['Hustle'], text: '5 Stops.' }, { name: 'Wall Up', kind: 'defense', value: 4, anim: 'block', text: 'Rim protection.' }] }, { side: 'defense', who: 'Big Dre' });
  assert.match(open, /Big Dre · THEIR DEFENSE/); assert.match(open, /9<em>Stops/); assert.match(open, /Closeout[^]*CLS/); assert.match(open, /BLK/);
  assert.equal((open.match(/gx-fcard /g) || []).length, 2); assert.doesNotMatch(open, /down/);
  const shut = V.foeSetHTML({ hidden: true, total: null, cards: [{ hidden: true }, { hidden: true }], why: 'The Shadow can\'t be read.' }, { side: 'offense' });
  assert.match(shut, /THEIR PLAY/); assert.match(shut, />\?<em>pts/); assert.equal((shut.match(/gx-fcard down/g) || []).length, 2); assert.match(shut, /can&#39;t be read/);
  assert.match(V.foeSetHTML({ cards: [], total: 0 }), /Nothing committed/);
  // the bar: yours on the left (O on offense, D on defense), defense wins ties, ? when hidden
  const off = V.clashBarHTML({ ball: 'you', preview: { o: 14, d: 9, result: 'score', points: 5 } });
  assert.match(off, /YOU · O<\/small><b>14[^]*<b>9<\/b><small>D · THEM[^]*You score 5/);
  const def = V.clashBarHTML({ ball: 'them', preview: { o: 7, d: 7, result: 'stopped', points: 0 } });
  assert.match(def, /YOU · D<\/small><b>7[^]*You stop them/);
  const hid = V.clashBarHTML({ ball: 'you', preview: { o: 11, d: null, result: '?', points: 0 } });
  assert.match(hid, /<b>\?<\/b>/); assert.match(hid, /unknown/);
  assert.equal(V.clashBarHTML({ ball: 'you' }), '');
  // swapped in place as cards are played
  const box = { el: { outerHTML: '' }, querySelector() { return this.el; } };
  assert.equal(V.updateClash(box, { ball: 'you', preview: { o: 3, d: 9, result: 'stopped', points: 0 } }), true);
  assert.match(box.el.outerHTML, /Stopped/);
});

test('the engine\'s own possessions play on the court: the tip-off, every shot outcome, the possession changes', () => {
  // (a seeded run, a match, possessions played with whatever's playable: the events exactly as endTurn makes them)
  for (const seed of [11, 4242, 90210]) {
    const run = D.newRun({ seed, player: D.rollStarters(seed)[0] });
    D.enterNode(run, D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match'));
    const m = run.match, evs = [...m.intro];
    const jump = m.intro.find(e => e.type === 'jump');
    assert.ok(jump, 'the tip-off is in the intro');
    for (let k = 0; k < 40 && !D.matchOver(run); k++) {
      for (let g = 0; g < 8; g++) { const i = D.handView(run).findIndex(h => h.playable); if (i < 0) break; evs.push(...D.playCard(run, i, 0)); }
      evs.push(...D.endTurn(run));
    }
    const dc = new C.DeckCourt({ catalog: {} }, { seed, opps: [] });
    const plays = dc.enqueue(evs, { target: 0 });
    assert.equal(plays[0].anim, 'tipoff'); assert.equal(plays[0].winner, jump.actor === 'you' ? 'you' : 'them');
    const shots = evs.filter(e => e.type === 'shot');
    assert.ok(shots.length >= 1, `${seed}: shots`);
    for (const e of shots) assert.ok(['made', 'assist', 'and_one', 'block', 'steal', 'contest', 'charge'].includes(e.how), e.how);
    assert.equal(plays.filter(p => ['transition', 'fastbreak'].includes(p.anim)).length, evs.filter(e => e.type === 'possession').length, 'every possession change runs the floor');
    for (const p of plays) assert.ok(C.PLAYS[p.anim] && C.SCRIPTED.includes(p.anim), p.anim);
    // their shots are on you; yours on the opponent you shot at
    for (const p of plays.filter(x => x.ev.type === 'shot')) assert.ok(p.ev.actor === 'you' ? p.defWho !== 'you' : p.defWho === 'you');
    dc.skipAll();
    const want = [0, 0];
    for (const e of evs) if ((e.type === 'shot' && e.made) || (e.type === 'ft' && e.points > 0)) want[e.actor === 'you' ? 0 : 1] += e.points;
    assert.deepEqual(dc.score, want, `${seed}: the court's score is the makes and free throws`);
  }
});

// a controller over a fake app (no screen): what the Gauntlet screen does with the server's answers
function fakeApp(over = {}) {
  const sent = [];
  return { sent, app: { profile: { account: { id: 'acc-qp4' } }, catalog: {}, ai: null, setBalance() {},
    api: { get: async () => ({ converted: [], world: null, unlocks: { completed: 0, next: null }, stats: {}, feed: [] }),
      mutate: async (path, body) => { sent.push([path, JSON.parse(JSON.stringify(body))]); if (over[path]) return over[path](body); return path.endsWith('/start') ? { run_id: 'ab'.repeat(16), seed: body.seed, player: body.player, world: D.emptyWorld(5), unlocks: null } : { vc: 140, vc_parts: { matches: 140, raw: 140 }, cap: 8000, balance: 1, verified: false, world: null, feed: [] }; } } } };
}
test('the start carries the engine version; a server on another one says "Update the game" on the screen', async () => {
  const mem = new Map(), hadLS = 'localStorage' in globalThis;
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  try {
    const f = fakeApp({ '/api/gauntlet/start': () => { const e = new Error('Update the game to play the Gauntlet.'); e.status = 400; throw e; } });
    const g = await GX.render(f.app, null, { seed: 77 });
    let shown = '';
    g.html = h => { shown = h; };
    await g.start(0);
    assert.equal(f.sent[0][1].engine, D.ENGINE_VERSION);
    assert.equal(g.run, null, 'no run started');
    assert.match(shown, /data-notice="update"[^]*Update the game to play the Gauntlet/);
    // a run is started on this engine: its start says so (the replay needs it)
    const ok = fakeApp(), g2 = await GX.render(ok.app, null, { seed: 78 });
    await g2.start(0);
    assert.equal(g2.run.engine, D.ENGINE_VERSION); assert.equal(g2.meta.start.engine, D.ENGINE_VERSION);
  } finally { if (!hadLS) delete globalThis.localStorage; GX.current()?.close(); }
});
test('a saved run from the old rules can\'t be continued: the screen says so, and ending it sends it to be paid', async () => {
  const mem = new Map(), hadLS = 'localStorage' in globalThis;
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  try {
    const f = fakeApp();
    // an old save: a run in progress with no engine version (the engine before possessions)
    const run = D.newRun({ seed: 31, player: D.rollStarters(31)[0] });
    D.enterNode(run, D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match'));
    delete run.engine;
    GX.saveRun(f.app, run, { runId: 'cd'.repeat(16), seed: 31, started: 1, log: [['node', run.at]] });
    let shown = '';
    const g = await GX.render(f.app, null, { resume: true });
    assert.equal(g.view.name, 'setup', 'not resumed');
    g.html = h => { shown = h; };
    g.setup(GX.loadSaved(f.app).run);
    assert.match(shown, /data-notice="old-rules"[^]*can't be continued[^]*data-gx="end-old"/); assert.doesNotMatch(shown, /data-gx="resume"/);
    g.action('resume'); assert.equal(g.view.name, 'setup', 'Resume does nothing for it');
    g.action('end-old');
    for (let k = 0; k < 50 && !g.meta?.fin; k++) await new Promise(r => setTimeout(r, 0));
    const fin = f.sent.find(x => x[0].endsWith('/finish'))[1];
    assert.equal(fin.run_id, 'cd'.repeat(16)); assert.equal(fin.summary.completed, false); assert.equal(fin.choices, undefined, 'sent without choices');
    assert.equal(GX.loadSaved(f.app), null, 'ended: the save is cleared');
    assert.equal(g.view.name, 'summary');
  } finally { if (!hadLS) delete globalThis.localStorage; GX.current()?.close(); }
});
