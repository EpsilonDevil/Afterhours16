// v0.4.8.9 quick patch 7, the Hub agent's part (scratchpad contract QP7_GAUNTLET.md): the freeze's regression test and
// its safety nets (§2), the hand max on the screen and the overdraw question (§1), no VC cap on the summary (§3).
// THE FREEZE (root cause): the controller's wasBusy flag (the court was busy at its last frame) outlived its court. A
// match that ended with plays still on the court, left with Continue, kept wasBusy true; the next match's new court read
// it on its first frame as "the plays just landed" and redrew the table, which took the pre-match screen (the tip-off,
// shown before nearly every match) off the screen while overlayOn stayed true, and play() / endTurn() return at once
// while overlayOn: every card and End Turn ignored, no way back but leaving the mode. Any redraw during the pre-match
// screen did the same (T, F, a target click).
import test from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../client/js/deck/index.js');
const V = await import('../client/js/ui/gauntletview.js');
const GX = await import('../client/js/ui/gauntlet.js');
const C = await import('../client/js/game/deckcine.js');

// a screen to draw into: just enough DOM for the controller (innerHTML, the overlay element, no buttons to bind)
class El {
  constructor(doc) { this.ownerDocument = doc; this.kids = []; this.h = ''; this.className = ''; this.isConnected = true; this.parent = null; this.classList = { add() {}, toggle() {}, remove() {} }; }
  set innerHTML(h) { this.h = h; this.kids = []; }
  get innerHTML() { return this.h + this.kids.map(k => k.h).join(''); }
  appendChild(c) { c.parent = this; this.kids.push(c); return c; }
  remove() { if (this.parent) this.parent.kids = this.parent.kids.filter(k => k !== this); }
  querySelector(sel) { return sel === '.gx-overlay' ? this.kids.find(k => k.className === 'gx-overlay') || null : null; }
  querySelectorAll() { return []; }
  closest() { return null; }
}
const doc = { createElement: () => new El(doc) };
function withStorage(fn) {
  return async () => {
    const mem = new Map(), had = 'localStorage' in globalThis;
    globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
    try { await fn(); } finally { GX.current()?.close(); if (!had) delete globalThis.localStorage; }
  };
}
function fakeApp() {
  const sent = [];
  const app = { profile: { account: { id: 'acc-qp7' } }, catalog: {}, ai: null, setBalance() {}, setController(c) { this.controller = c; }, input: { gp: { connected: false } }, modalOpen: () => false,
    api: { get: async () => ({ converted: [], world: null, unlocks: { completed: 0, next: null }, stats: {}, feed: [] }),
      mutate: async (path, body) => { sent.push([path, body]); return path.endsWith('/start') ? { run_id: 'ef'.repeat(16), seed: body.seed, player: body.player, world: D.emptyWorld(5), unlocks: null } : { vc: 9340, vc_parts: { matches: 4340, rivals: 1500, bosses: 2700, final: 0, raw: 9340 }, balance: 1, verified: true, world: null, feed: [] }; } } };
  return { app, sent };
}
async function screen(seed) {
  const f = fakeApp(), root = new El(doc);
  const g = await GX.render(f.app, root, { seed });
  g.toast = (t, k) => { (g.toasts || (g.toasts = [])).push([t, k]); };
  await g.start(0);
  return { g, root, f };
}
const overlayUp = root => !!root.querySelector('.gx-overlay');
const frames = (g, n) => { for (let i = 0; i < n; i++) g.court?.frame(1 / 60); };
// play the match on now to its final buzzer with whatever's playable (a waiting card refused), the court skipped
// between possessions, the last possession left playing on the court
function playToBuzzer(g) {
  for (let k = 0; k < 300 && !g.over; k++) {
    const m = g.run.match;
    if (m.pendingDraw) { g.resolveDraw({ refuse: true }); continue; }
    if (g.court?.busy) { g.court.skipAll(); frames(g, 1); }
    const i = D.handView(g.run).findIndex(h => h.playable);
    if (i >= 0) g.play(i); else g.endTurn();
  }
}

test('the freeze (regression): Continue while the last plays run, then a match with a pre-match screen: the table still takes input', withStorage(async () => {
  const { g, root } = await screen(4242);
  const ruled = id => ['match', 'rival'].includes(D.nodeOf(g.run, id).kind) && D.nodeOf(g.run, id).rules.length;
  const first = D.availableNodes(g.run).find(id => ruled(id) && D.nodeOf(g.run, id).next.some(ruled));
  g.enter(first);
  assert.equal(g.view.name, 'match'); assert.ok(g.court, 'a court');
  assert.ok(overlayUp(root) && g.overlayOn, 'the pre-match screen (its rules) is up');
  g.tipoff();
  playToBuzzer(g);
  assert.ok(g.over?.won, 'match 1 won');
  // the final buzzer with the possession still on the court: a frame sees it busy (wasBusy), then Continue at once
  assert.ok(g.court.busy, 'the last possession is still playing');
  frames(g, 1);
  assert.equal(g.wasBusy, true);
  g.continue();
  assert.equal(g.view.name, 'reward');
  g.takeReward(null);
  const next = D.availableNodes(g.run).find(ruled);
  assert.ok(next, 'a match with rules next');
  g.enter(next);
  assert.ok(overlayUp(root), 'match 2 opens on its pre-match screen');
  // the new court's first frames: the pre-match screen must still be there (it was redrawn away: the freeze)
  frames(g, 3);
  assert.ok(overlayUp(root) && g.overlayOn, 'still up after the court\'s first frames');
  // any redraw while it's up (T, F, a target click) keeps it up
  g.key({ code: 'KeyT', preventDefault() {} }); g.key({ code: 'KeyF', preventDefault() {} }); g.drawMatch();
  assert.ok(overlayUp(root) && g.overlayOn, 'still up after redraws');
  // and the table takes input once it's dismissed
  const before = g.meta.log.length;
  g.key({ code: 'Enter', preventDefault() {} });
  assert.equal(g.overlayOn, false); assert.equal(overlayUp(root), false);
  const i = D.handView(g.run).findIndex(h => h.playable);
  if (i >= 0) g.play(i); else g.endTurn();
  if (g.court?.busy) g.court.skipAll();
  g.endTurn();
  assert.ok(g.meta.log.length > before, `the inputs registered (${before} → ${g.meta.log.length})`);
}));

test('the overlay never outlives its match, and an overlay up means one is on the screen', withStorage(async () => {
  const { g, root } = await screen(11);
  g.enter(D.availableNodes(g.run).find(id => D.nodeOf(g.run, id).kind === 'match'));
  assert.ok(g.overlayOn && overlayUp(root));
  // another screen (the menus' Back to the bracket draws the bracket for a run on the map...) drops it
  g.view = { name: 'map' }; g.html('<div class="gx-map"></div>');
  assert.equal(g.overlayOn, false, 'gone with its screen');
  assert.equal(overlayUp(root), false);
}));

test('guarded: an exception in the engine or a handler puts the run back to its last save, says so, and play goes on', withStorage(async () => {
  const { g } = await screen(31);
  g.enter(D.availableNodes(g.run).find(id => D.nodeOf(g.run, id).kind === 'match'));
  g.tipoff();
  const saved = JSON.stringify(GX.loadSaved(g.app).run), logLen = g.meta.log.length;
  // an engine call that throws after it changed the run (the log refuses the push): the run must come back as saved
  g.meta.log = null;
  const i = D.handView(g.run).findIndex(h => h.playable);
  const r = g.act('play', i, 0);
  assert.equal(r.ok, false); assert.equal(r.fault, true);
  assert.equal(JSON.stringify(g.run), saved, 'the run as it was last saved');
  assert.equal(g.meta.log.length, logLen, 'its log too');
  assert.match(g.toasts.at(-1)[0], /went wrong in the engine \(play\)/); assert.equal(g.toasts.at(-1)[1], 'error');
  assert.equal(g.view.name, 'match', 'back on the match');
  // a handler that throws (a key, a click): the same
  const hand = g.run.match.hand; g.run.match.hand = null;
  g.onKey({ code: 'Digit1', preventDefault() {} });
  assert.ok(Array.isArray(g.run.match.hand), 'restored'); assert.notEqual(g.run.match.hand, hand, 'from the save');
  assert.equal(g.view.name, 'match');
  // and it goes on: a card plays
  const j = D.handView(g.run).findIndex(h => h.playable), n = g.meta.log.length;
  if (j >= 0) { g.play(j); assert.equal(g.meta.log.length, n + 1); }
  // faults over and over: a screen that can't fail, with Back to the bracket and Leave the Gauntlet
  g.faults = [Date.now(), Date.now()];
  g.run.match.hand = null; g.onKey({ code: 'Digit1', preventDefault() {} });
  assert.equal(g.view.name, 'safe');
  assert.match(g.root.innerHTML, /data-gx="bracket"/); assert.match(g.root.innerHTML, /data-gx="leave-gx"/);
  g.faults = []; g.action('bracket');
  assert.equal(g.view.name, 'match', 'Back to the bracket: the saved run, where it stands');
}));

test('the court watchdog: a play past its length, a court with no frames, a disposed court, a play with no length', withStorage(async () => {
  // the queue: a NaN or zero length can't hold the court forever
  const q = new C.PlayQueue({ now: () => 0 }); q.push({ anim: 'x', dur: NaN }, { anim: 'y', dur: 0 });
  assert.ok(q.items.every(p => p.dur > 0));
  let t = 0; const q2 = new C.PlayQueue({ now: () => t }); q2.push({ anim: 'a', dur: 2 }); q2.update(0.01);
  t = 5000; assert.equal(q2.stuck(4000, t), null); t = 6100; assert.equal(q2.stuck(4000, t)?.anim, 'a');
  const { g } = await screen(5);
  g.enter(D.availableNodes(g.run).find(id => D.nodeOf(g.run, id).kind === 'match'));
  g.tipoff();
  const c = g.court;
  assert.ok(c.busy, 'the tip-off is playing');
  frames(g, 1);
  // a window in the background: no frames by design, nothing forced
  const now = performance.now();
  assert.equal(c.watchdog(false, 4000, now + 60000), null);
  // frames stopped while the page is visible: the plays land, the table is drawn
  c.lastFrameAt = performance.now() - 10000;
  g.watch();
  assert.equal(c.busy, false, 'landed'); assert.equal(g.wdLog.at(-1).why, 'no frames');
  // a play past its length + margin
  g.endTurn(); frames(g, 1); assert.ok(c.busy);
  c.queue.wall = performance.now() - 60000; g.watch();
  assert.equal(c.busy, false); assert.equal(g.wdLog.at(-1).why, 'overrun');
  // a court disposed under the match (QP3: it would never play again): a new one, the plays it had landed
  g.endTurn(); assert.ok(c.busy);
  c.dispose(); g.watch();
  assert.notEqual(g.court, c, 'a new court'); assert.equal(g.court.disposed, undefined); assert.equal(g.wdLog.at(-1).why, 'disposed');
  // and the table still takes input
  const n = g.meta.log.length; g.endTurn(); if (g.court.busy) { g.court.skipAll(); g.endTurn(); }
  assert.ok(g.meta.log.length > n);
}));

test('the pause menu: Resume, Back to the bracket (from the saved run), Leave the Gauntlet; Esc, the Menu button and B open it', withStorage(async () => {
  const h = V.pauseHTML({ hasRun: true, inMatch: true });
  assert.match(h, /data-gxp="resume"/); assert.match(h, /data-gxp="bracket"[^]*Back to the bracket/); assert.match(h, /data-gxp="leave"[^]*Leave the Gauntlet/);
  assert.match(V.pauseHTML({ hasRun: false }), /data-gxp="leave"/); assert.doesNotMatch(V.pauseHTML({ hasRun: false }), /data-gxp="bracket"/);
  const { g } = await screen(8);
  g.enter(D.availableNodes(g.run).find(id => D.nodeOf(g.run, id).kind === 'match'));
  g.tipoff();
  // the Menu button on the table carries data-cancel: a controller's B (padnav's back) clicks it
  const html = V.matchHTML(g.run, { hand: D.handView(g.run) });
  assert.match(html, /data-gx="pause" data-cancel/);
  let opened = 0; g.pauseMenu = () => { opened++; };
  g.key({ code: 'Escape', preventDefault() {} }); assert.equal(opened, 1, 'Esc');
  g.action('pause'); assert.equal(opened, 2, 'the Menu button');
  // Back to the bracket mid-match: the run from its save, a fresh court and table, the overlay and flags dropped
  const saved = GX.loadSaved(g.app);
  g.run.match.energy = 99; g.overlayHTML = '<p>stuck</p>'; g.overlayKey = 'nope'; g.over = { won: true };
  const old = g.court;
  g.backToBracket();
  assert.equal(g.run.match.energy, saved.run.match.energy, 'the saved run'); assert.equal(g.over, null); assert.equal(g.overlayOn, false);
  assert.notEqual(g.court, old); assert.equal(g.view.name, 'match');
}));

test('the hand max on the table: 5/5, or the raised max', () => {
  const run = D.newRun({ seed: 13, player: D.rollStarters(13)[0] });
  D.enterNode(run, D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match'));
  const m = run.match;
  assert.equal(m.handMax, D.HAND_MAX); assert.equal(D.HAND_MAX, 5);
  let h = V.matchHTML(run, {});
  assert.match(h, new RegExp(`data-handmax[^>]*>Hand <b>${m.hand.length}/5</b>`)); assert.doesNotMatch(h, /gx-handcount raised/);
  m.handMax = 6;
  h = V.matchHTML(run, {});
  assert.match(h, /gx-handcount raised/); assert.match(h, new RegExp(`Hand <b>${m.hand.length}/6</b> <em>▲</em>`)); assert.match(h, /holds 6 cards this match/);
});

test('the overdraw question: discard a card for it or refuse it, by click, key or pad; logged; the run replays exactly', withStorage(async () => {
  // a natural overdraw: play what's playable until a draw goes past the hand max (seed 77's first match has one)
  let g = null, found = false;
  for (const seed of [77, 4242, 11, 999, 13, 31]) {
    ({ g } = await screen(seed));
    g.enter(D.availableNodes(g.run).find(id => D.nodeOf(g.run, id).kind === 'match' && D.nodeOf(g.run, id).rules.length));
    g.tipoff();
    for (let k = 0; k < 200 && !g.over && !g.run.match.pendingDraw; k++) {
      if (g.court?.busy) g.court.skipAll();
      const i = D.handView(g.run).findIndex(x => x.playable);
      if (i >= 0) g.play(i); else g.endTurn();
    }
    if (g.run.match?.pendingDraw) { found = true; break; }
  }
  assert.ok(found, 'an overdraw came up');
  const m = g.run.match, pd = m.pendingDraw;
  // the table: the question over the hand, the waiting card, Refuse; every hand card a discard; End Turn held
  g.court?.skipAll();
  let h = V.matchHTML(g.run, { hand: D.handView(g.run) });
  assert.match(h, new RegExp(`data-drawq[^]*Hand full \\(${m.hand.length}/${m.handMax}\\):</b> discard a card to take <em>${pd.cardInfo.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</em>, or refuse it`));
  assert.match(h, /data-gx="refuse-draw"/);
  assert.equal((h.match(/data-discard="/g) || []).length, m.hand.length, 'every hand card can be the discard');
  assert.doesNotMatch(h.split('data-hand')[1].split('gx-handcount')[0], /gx-card[^"]* off/, 'none shown unplayable');
  assert.match(h, /data-gx="end" disabled/);
  // End Turn and plays are held: a toast, nothing logged
  const n0 = g.meta.log.length;
  g.endTurn(); assert.equal(g.meta.log.length, n0); assert.match(g.toasts.at(-1)[0], /Hand full/);
  // a key: 2 discards the second card for it
  const second = m.hand[1], took = pd.ref;
  g.key({ code: 'Digit2', preventDefault() {} });
  assert.deepEqual(g.meta.log.at(-1), ['draw', 'discard', 1]);
  assert.ok(g.run.match.discard.includes(second)); assert.ok(g.run.match.hand.includes(took));
  // another overdraw, refused with R (or the Refuse button: the same action)
  for (let k = 0; k < 200 && !g.over && !g.run.match.pendingDraw; k++) {
    if (g.court?.busy) g.court.skipAll();
    const i = D.handView(g.run).findIndex(x => x.playable);
    if (i >= 0) g.play(i); else g.endTurn();
  }
  if (g.run.match?.pendingDraw) {
    const ref = g.run.match.pendingDraw.ref, len = g.run.match.hand.length;
    if (g.meta.log.length % 2) g.key({ code: 'KeyR', preventDefault() {} }); else g.action('refuse-draw');
    assert.deepEqual(g.meta.log.at(-1), ['draw', 'refuse']);
    assert.equal(g.run.match.hand.length, len, 'the hand as it was'); assert.equal(g.run.match.discard.at(-1), ref, 'the refused card is discarded');
  }
  // a click on a card is the same as the key (data-card on each); a pad's A clicks the card under the focus ring
  // the run, replayed from its start and the log the screen kept: exactly the same
  const rp = D.replay(g.meta.start, g.meta.log);
  assert.equal(rp.error, undefined, rp.error);
  assert.equal(D.outcomeHash(rp.run), D.outcomeHash(g.run), 'replays exactly');
}));

test('no VC cap per run on the summary: what was paid, no "Capped" line (qp7 §3)', () => {
  const run = D.newRun({ seed: 21, player: D.rollStarters(21)[0] });
  const over = D.runOver(run);
  const h = V.summaryHTML(run, over, { vc: 9340, vc_parts: { matches: 4340, rivals: 1500, bosses: 2700, final: 0, raw: 9340 }, balance: 20000, verified: true, feed: [] });
  assert.match(h, /9,340 VC/); assert.match(h, /\+9,340/); assert.match(h, /✓ Verified/);
  assert.doesNotMatch(h, /Capped|per run|8,000/i);
  // even an old server's answer that still says it capped shows no cap line
  assert.doesNotMatch(V.summaryHTML(run, over, { vc: 8000, vc_parts: { raw: 9100, final: 2000 }, cap: 8000, balance: 1 }), /Capped|per run/i);
});

test('no server call waits forever: a start the server never answers is an error to try again; a finish is Retry', withStorage(async () => {
  const keep = { ...GX.TIMEOUTS };
  try {
    GX.TIMEOUTS.start = 20; GX.TIMEOUTS.finish = 20; GX.TIMEOUTS.profile = 20;
    const never = new Promise(() => {});
    const app = { profile: { account: { id: 'acc-qp7t' } }, catalog: {}, ai: null, setBalance() {}, setController() {}, input: { gp: { connected: false } }, modalOpen: () => false, api: { get: () => never, mutate: () => never } };
    const g = await GX.render(app, new El(doc), { seed: 9 });
    assert.equal(g.view.name, 'setup', 'the screen came up (the profile given up on: offline)');
    g.toast = (t, k) => { g.last = [t, k]; };
    await g.start(0);
    assert.equal(g.run, null); assert.equal(g.starting, false, 'the players can be picked again');
    assert.match(g.last[0], /didn't answer in time/);
    const fin = await GX.apiFinish(app, 'ab'.repeat(16), {}, []);
    assert.equal(fin.retry, true); assert.match(fin.error, /didn't answer in time/);
  } finally { Object.assign(GX.TIMEOUTS, keep); }
}));
