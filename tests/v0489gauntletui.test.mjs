// v0.4.8.9 The Gauntlet, the Hub agent's part (docs/GAUNTLET.md §1-§11): the screens and the cinematic court. Every
// screen renders straight from the engine's states (ui/gauntletview.js on deck/index.js); every animation tag the engine
// gives an event plays a court play (game/deckcine.js), a make goes in and a miss doesn't; the play queue keeps rapid
// card play readable and can be skipped or fast-forwarded; the run saves and resumes; the server routes are guarded.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fake2d = new Proxy({}, { get: (o, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'getImageData' || k === 'createImageData' ? (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fake2d; } };

const D = await import('../client/js/deck/index.js');
const V = await import('../client/js/ui/gauntletview.js');
const C = await import('../client/js/game/deckcine.js');
const GX = await import('../client/js/ui/gauntlet.js');
const { PROAM_IDS } = await import('../client/js/world/proamparks.js');

const src = f => fs.readFileSync(new URL('../client/js/' + f, import.meta.url), 'utf8');
const count = (h, re) => (h.match(re) || []).length;
const SEED = 4242;
const newRun = (seed = SEED, i = 0) => D.newRun({ seed, player: D.rollStarters(seed)[i] });
// a policy that plays a match out: the first playable Shot, else any playable card, else end the turn
function playOut(run, limit = 300) {
  for (let k = 0; k < limit && !D.matchOver(run); k++) {
    const hv = D.handView(run), i = hv.findIndex(h => h.playable && D.cardInfo(h.ref).type === 'shot'), j = i >= 0 ? i : hv.findIndex(h => h.playable);
    if (j >= 0) D.playCard(run, j, 0); else D.endTurn(run);
  }
  return D.matchOver(run);
}
// put the run next to a node of a kind (a harness move: the screens don't care how it got there) and step in
function enterKind(run, kind) {
  const ph = run.map.phases[run.phase - 1];
  for (const id of Object.keys(ph.nodes).filter(x => ph.nodes[x].kind === kind)) {
    const pred = Object.values(ph.nodes).find(n => n.next.includes(id));
    if (!pred && ph.nodes[id].round !== 0) continue;
    run.at = pred ? pred.id : null; run.stage = 'map'; run.match = null; run.reward = null;
    const r = D.enterNode(run, id);
    if (r.kind) return id;
  }
  return null;
}

// ---------------- the court ----------------
test('every animation tag the engine uses plays a court play, with a role (offense, defense, alone)', () => {
  assert.ok(Array.isArray(D.ANIMS) && D.ANIMS.length >= 19);
  for (const a of D.ANIMS) {
    assert.ok(C.PLAYS[a], `no play for ${a}`);
    assert.ok(C.SCRIPTED.includes(a), `no script for ${a}`);
    assert.ok(['offense', 'defense', 'solo'].includes(C.PLAYS[a].role), a);
    const p = C.playFor({ actor: 'you', anim: a, made: true, points: 4, type: 'shot', target: 0 });
    assert.ok(p && p.dur >= 1 && p.dur <= 2.4, `${a}: about 1-2 s (${p?.dur})`);
  }
  // the brief's list: every one of them
  for (const a of ['jumper', 'three', 'layup', 'dunk', 'floater', 'post', 'crossover', 'spin', 'stepback', 'pass', 'lob', 'closeout', 'contest', 'block', 'steal', 'rebound', 'celebrate', 'gassed', 'foul']) assert.ok(C.PLAYS[a], a);
  // no tag, nothing to play (text only)
  assert.equal(C.playFor({ actor: 'you', anim: null, text: 'Turn 2.' }), null);
  assert.equal(C.playFor({ actor: 'you', anim: 'moonwalk' }), null);
});

test('who does what: the actor and his man; a shot the Stops ate is a miss on the court', () => {
  const mine = C.playFor({ actor: 'you', anim: 'three', made: true, points: 9, stops: 0, type: 'shot', target: 1 }, { opps: 2 });
  assert.deepEqual([mine.actor, mine.versus, mine.made, mine.scoring, mine.points, mine.big], ['you', 1, true, true, 9, true]);
  const theirs = C.playFor({ actor: 0, anim: 'jumper', made: true, points: 1, stops: 7, type: 'shot' });
  assert.deepEqual([theirs.actor, theirs.versus, theirs.made], [0, 'you', true]);
  const eaten = C.playFor({ actor: 0, anim: 'jumper', made: false, points: 0, stops: 8, type: 'shot' });
  assert.equal(eaten.made, false); assert.equal(eaten.scoring, true);
  const close = C.playFor({ actor: 'you', anim: 'closeout', type: 'card' });
  assert.equal(close.role, 'defense'); assert.equal(close.scoring, false);
  assert.equal(C.playFor({ actor: 0, anim: 'block' }).big, true);
  assert.equal(C.playFor({ actor: 'you', anim: 'three', made: false, type: 'shot', points: 0, stops: 4 }).big, false, 'only a made three is a camera cut');
});

test('the queue: one play after another, faster when it backs up, fast-forward, skip lands the outcome', () => {
  const started = [], ended = [];
  const q = new C.PlayQueue({ onStart: p => started.push(p.n), onEnd: p => ended.push(p.n) });
  q.push({ n: 1, dur: 1 }, { n: 2, dur: 1 }, { n: 3, dur: 1 });
  assert.equal(q.pending, 3); assert.ok(q.busy);
  assert.equal(q.speed(), 1.5, 'three waiting: a little quicker');
  q.update(0.01); assert.deepEqual(started, [1]);
  assert.equal(q.speed(), 1, 'two left waiting: normal speed');
  q.update(1.0); assert.deepEqual(ended, [1]);
  q.fast = true; assert.ok(q.speed() >= 3);
  q.update(0.01); q.update(0.4); assert.deepEqual(ended, [1, 2], 'fast-forward');
  q.fast = false;
  q.update(0.01); q.skip(); assert.deepEqual(ended, [1, 2, 3]); assert.ok(!q.busy);
  for (let i = 0; i < 8; i++) q.push({ n: 10 + i, dur: 1.5 });
  assert.equal(q.speed(), 2.2, 'a long backlog plays at 2.2x');
  q.skipAll(); assert.ok(!q.busy); assert.equal(ended.length, 11);
  assert.deepEqual(started.slice(3), ended.slice(3));
});

test('the court plays every tag, made and missed, for you and for him: makes score, misses don\'t, nothing breaks', () => {
  const landed = [];
  const dc = new C.DeckCourt({ catalog: {} }, { seed: 9, onLand: (p, s) => landed.push({ p, s: s.slice() }) });
  let expect = [0, 0];
  for (const anim of D.ANIMS) for (const actor of ['you', 0]) for (const made of [true, false]) {
    const ev = { type: C.PLAYS[anim].shot ? 'shot' : 'card', actor, anim, made, points: made ? 5 : 0, stops: made ? 0 : 3, target: 0 };
    const pl = dc.enqueue([ev])[0];
    if (pl.scoring && pl.made) expect[actor === 'you' ? 0 : 1] += 5;
  }
  const n = dc.queue.pending;
  let t = 0;
  while (dc.busy && t < 300) { dc.frame(1 / 30); t += 1 / 30; assert.ok([dc.ball.x, dc.ball.y, dc.ball.z].every(Number.isFinite), 'the ball'); }
  assert.ok(!dc.busy, 'the queue played out');
  assert.equal(landed.length, n);
  assert.deepEqual(dc.score, expect);
  for (const a of dc.actors) assert.ok([a.p.x, a.p.z, a.p.y, a.p.facing].every(Number.isFinite), 'the players');
});

test('a make goes through the hoop on its own flight; a miss comes off the rim; a skip still lands it', () => {
  for (const anim of ['jumper', 'three', 'layup', 'floater', 'post', 'dunk']) {
    for (const made of [true, false]) {
      let landT = null, t = 0, closest = 9;
      const dc = new C.DeckCourt({ catalog: {} }, { seed: 31, onLand: () => { landT = t; } });
      dc.enqueue([{ type: 'shot', actor: 'you', anim, made, points: made ? 6 : 0, stops: made ? 0 : 4, target: 0 }]);
      const dur = dc.queue.items[0].dur;
      while (dc.busy && t < 6) { dc.frame(1 / 60); t += 1 / 60; if (dc.ball.mode === 'flight') closest = Math.min(closest, Math.hypot(dc.ball.x, dc.ball.y - 3.05, dc.ball.z - 12.725)); }
      assert.ok(closest < 0.5, `${anim} ${made}: the ball gets to the rim (${closest.toFixed(2)})`);
      if (made) { assert.ok(landT < dur - 0.05, `${anim}: the make drops before the play ends (${landT?.toFixed(2)} of ${dur})`); assert.equal(dc.score[0], 6); }
      else assert.equal(dc.score[0], 0, `${anim}: a miss doesn't score`);
    }
  }
  const dc = new C.DeckCourt({ catalog: {} }, { seed: 3 });
  dc.enqueue([{ type: 'shot', actor: 'you', anim: 'three', made: true, points: 9, target: 0 }, { type: 'shot', actor: 0, anim: 'dunk', made: true, points: 7 }]);
  dc.frame(1 / 60); dc.skip();
  assert.equal(dc.score[0], 9, 'skipped: the points still go up');
  dc.skipAll(); assert.deepEqual(dc.score, [9, 7]); assert.ok(!dc.busy);
  // the engine's own events from a real turn queue up and play
  const run = newRun(); D.enterNode(run, D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match'));
  const dc2 = new C.DeckCourt({ catalog: {} }, { seed: 5, opps: [] });
  const evs = [...run.match.intro, ...D.playCard(run, D.handView(run).findIndex(h => h.playable)), ...D.endTurn(run)];
  const plays = dc2.enqueue(evs);
  assert.ok(plays.length >= 1 && plays.every(p => C.PLAYS[p.anim]));
  dc2.skipAll();
});

// ---------------- the screens, from engine states ----------------
test('run setup: three rolled starters and the converted players, four 1-10 bars each, the word on the street', () => {
  const starters = D.rollStarters(SEED).map(p => ({ player: p, kind: 'starter' }));
  const conv = { player: D.rollConverted(SEED, { id: 'c1', name: 'Icon Ike', base: { stamina: 92, shooting: 99, defense: 70, health: 85 } }), kind: 'converted' };
  const h = V.setupHTML({ players: [conv, ...starters], feed: ['Zeke Gaines is telling everyone he owns you.'], profile: { stats: { runs: 3, completed: 1, players: 1 } } });
  assert.equal(count(h, /data-pick-player=/g), 4);
  assert.equal(count(h, /class="gx-stat s-/g), 16, 'four stats each');
  assert.match(h, /CONVERTED ICON/); assert.match(h, /Icon Ike/);
  assert.match(h, /Word on the street/); assert.match(h, /owns you/);
  assert.match(h, /3 runs · 1 completed/);
  for (const s of starters) for (const k of V.STAT_KEYS) assert.ok(s.player.stats[k] >= 1 && s.player.stats[k] <= 5);
  // a bar lights as many as the stat; 6+ lit in the converted colour
  const one = V.statBars({ stamina: 7, shooting: 3, defense: 1, health: 10 });
  assert.equal(count(one, /class="on /g) + count(one, /class="on"/g), 21);
  // with a run on this computer: resume or abandon
  assert.match(V.setupHTML({ players: starters, saved: newRun() }), /data-gx="resume"/);
});

test('the bracket: every node of the phase, the kinds, the ones you can pick, rules and opponents, the path taken', () => {
  const run = newRun();
  const h = V.mapHTML(run), mv = D.mapView(run), all = mv.rows.flat();
  assert.equal(count(h, /class="gx-node /g), all.length);
  assert.equal(count(h, /gx-node [^"]*open"/g), D.availableNodes(run).length);
  for (const k of ['match', 'cooler', 'boss']) assert.match(h, new RegExp(`gx-node k-${k}`), k);
  assert.match(h, /BOSS|Boss/);
  const withRule = all.find(n => n.rules.length);
  if (withRule) assert.match(V.previewHTML(withRule, run), new RegExp(withRule.rules[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const boss = all.find(n => n.kind === 'boss');
  assert.ok(V.previewHTML(boss, run).includes(V.esc(boss.boss.title)));
  // after a node, the path shows it
  const first = D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match');
  D.enterNode(run, first); playOut(run); D.takeReward(run, { card: 0 });
  const h2 = V.mapHTML(run);
  assert.match(h2, new RegExp(`gx-node k-match (here|done)" [^>]*data-node="${first}"`));
  assert.ok(count(h2, /class="taken"/g) >= 0);
  assert.match(V.runBarHTML(run), new RegExp(`Deck · ${run.deck.length}`));
});

// (qp4: an opponent's intent gave way to the possession: the turn banner, his committed set (foeSet) and the clash bar)
test('the match table: the hand with costs and text, energy, the four stats, Stops, Heart, the possession (banner, his set, the clash), score, rules, piles, End Turn', () => {
  const run = newRun();
  D.enterNode(run, D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match'));
  const m = run.match, h = V.matchHTML(run, { target: 0 });
  assert.equal(count(h, /data-card="/g), m.hand.length);
  for (const ref of m.hand) assert.match(h, new RegExp(D.cardInfo(ref).name));
  assert.match(h, /class="gx-cost">\d/);
  assert.match(h, new RegExp(`<b>${m.energy}</b><small>/${m.maxEnergy}`));
  assert.equal(count(h, /class="gx-stat s-/g), 4);
  assert.match(h, /Stops/);
  assert.match(h, new RegExp(m.opps[0].name)); assert.doesNotMatch(h, /gx-intent/);
  assert.match(h, /data-turn/); assert.match(h, new RegExp(m.turnLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(h, /data-foeset/); assert.match(h, m.foeSet.side === 'offense' ? /THEIR PLAY/ : /THEIR DEFENSE/);
  assert.match(h, /data-clash/);
  // while the possession plays on the court: that clash, not the next one's set
  const busy = V.matchHTML(run, { target: 0, busy: true, lastClash: { youOff: true, you: 9, them: 4, text: 'You scored' } });
  assert.doesNotMatch(busy, /data-foeset/); assert.match(busy, /You scored/); assert.match(busy, /data-gx="end" disabled/);
  // a card for the other side of the ball is held, with why
  const held = D.handView(run).map((x, i) => (i === 0 ? { ...x, playable: false, offPhase: true, why: 'Shots can\'t be played on defense.' } : x));
  assert.match(V.matchHTML(run, { hand: held }), /gx-card [^"]*held[^]*HELD[^]*Shots can&#39;t be played on defense/);
  assert.match(h, /data-pile="draw"/); assert.match(h, /data-pile="discard"/); assert.match(h, /data-pile="burned"/);
  assert.match(h, /data-gx="end"/);
  for (const r of m.rules) assert.match(h, new RegExp(r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(h, /data-gx="skip"/); assert.match(h, /data-gx="fast"/);
  // a card that can't be played shows it; a combo lights
  const hv = D.handView(run).map(x => ({ ...x, playable: false, why: 'Not enough energy.' }));
  assert.match(V.matchHTML(run, { hand: hv }), /gx-card [^"]*off/);
  const hv0 = D.handView(run), live = Math.max(0, hv0.findIndex(x => !x.offPhase)), lit = hv0.map((x, i) => ({ ...x, combo: i === live }));
  assert.match(V.matchHTML(run, { hand: lit }), /COMBO/);
  // the piles open
  assert.match(V.pileHTML('Draw pile', m.drawPile), new RegExp(`${m.drawPile.length} cards`));
  // the end of the match
  playOut(run);
  assert.match(V.matchHTML(run, { over: D.matchOver(run) }), /data-gx="continue"/);
});

test('before the tip: the nemesis lines (charLine) and, for a boss, his intro', () => {
  const run = newRun(77);
  enterKind(run, 'boss');
  assert.equal(run.stage, 'match'); assert.ok(run.match.boss);
  const b = D.bossInfo(run.match.boss);
  const line = D.charLine(D.emptyWorld(1), run.match.opps[0].charId, 'intro', 3);
  assert.ok(typeof line === 'string' && line.length > 3);
  const h = V.preMatchHTML(run, [{ name: run.match.opps[0].name, text: line }]);
  assert.ok(h.includes(V.esc(b.title))); assert.match(h, /gx-bossintro/); assert.match(h, /blockquote/); assert.match(h, /data-gx="tipoff"/);
  assert.match(GX.venueFor(run), /^proam_/);
  assert.ok(PROAM_IDS.includes(GX.venueFor(run).slice(6)));
  const r2 = newRun(); D.enterNode(r2, D.availableNodes(r2)[0]);
  if (r2.stage === 'match') assert.ok(['harbor', 'brick', 'foundry'].includes(GX.venueFor(r2)), 'a match is at a park');
});

test('the stops: the reward pick, the Cooler with its card picker, the Boost Shop, a Mystery Stop and its outcome', () => {
  const run = newRun();
  D.enterNode(run, D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match'));
  assert.equal(playOut(run)?.won, true, 'the starter wins his first match');
  const rh = V.rewardHTML(run);
  assert.equal(count(rh, /data-reward-card="/g), run.reward.cards.length);
  assert.match(rh, /data-gx="skip-card"/); assert.match(rh, new RegExp(`\\+${run.reward.coins} COINS`));
  D.takeReward(run, { card: 0 });
  enterKind(run, 'cooler');
  const ch = V.coolerHTML(run);
  assert.match(ch, /data-cooler="heal"/); assert.match(ch, /data-cooler="upgrade"/);
  const up = V.coolerHTML(run, 'upgrade');
  assert.equal(count(up, /data-pick-card="/g), run.deck.length);
  assert.match(up, /Jumper\+/, 'shows what a card becomes');
  enterKind(run, 'shop');
  const sv = D.shopView(run), sh = V.shopHTML(run);
  assert.equal(count(sh, /data-buy-card="/g), sv.cards.length);
  assert.equal(count(sh, /data-buy-ability="/g), sv.abilities.length);
  assert.match(sh, new RegExp(`Cut a card · ${sv.removePrice} coins`)); assert.match(sh, /data-gx="leave"/);
  assert.equal(count(V.shopHTML(run, 'remove'), /data-pick-card="/g), run.deck.length);
  D.leaveNode(run);
  enterKind(run, 'event');
  const ev = D.eventView(run), eh = V.eventHTML(run);
  assert.match(eh, new RegExp(ev.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(count(eh, /data-choice="/g), ev.choices.length);
  const i = ev.choices.findIndex(c => c.enabled !== false);
  const res = D.eventChoose(run, i);
  const oh = V.eventHTML(run, res);
  assert.match(oh, /data-gx="event-done"/); assert.doesNotMatch(oh, /\[object Object\]|undefined/);
  for (const f of res.effects || []) assert.ok(V.effectText(f, run).length > 0);
});

test('the summary: how far, the VC (a number), who will remember the run', () => {
  const run = newRun();
  D.enterNode(run, D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match'));
  playOut(run); D.takeReward(run, { card: null });
  enterKind(run, 'boss');
  for (let k = 0; k < 200 && !D.matchOver(run); k++) { run.match.you.hp = 1; run.match.you.stops = 0; D.endTurn(run); }
  assert.equal(D.matchOver(run).won, false);
  const over = D.runOver(run);
  const h = V.summaryHTML(run, over, null, { sending: true });
  assert.doesNotMatch(h, /NaN/);
  assert.match(h, /Sending the result/);
  assert.match(h, /Who'll remember this run/);
  // the server's VC and balance, never the engine's estimate; the parts, and the cap when it bit
  const est = Number(over.summary.vc.total ?? over.summary.vc);
  const paid = V.summaryHTML(run, over, { vc: 1234, vc_parts: { matches: 980, rivals: 300, bosses: 0, final: 0, raw: 1280 }, cap: 1234, balance: 50120, feed: ['Zeke is a Contender now.'], unlocks: { completed: 0, next: { n: 1, tier: 'common', needs: { completed: 1, distinct: 0 }, have: { completed: 0 }, ready: false } } });
  assert.match(paid, /\+1,234/); assert.match(paid, /Balance 50,120 VC/); assert.match(paid, /Capped by the run's time/); assert.match(paid, /0\/1 completed run/);
  if (est !== 1234) assert.doesNotMatch(paid, new RegExp(`\\+${est.toLocaleString('en-US')}<`));
  assert.match(V.summaryHTML(run, over, { vc: 8000, vc_parts: { raw: 9100, final: 2000 }, cap: 8000, balance: 1 }), /Capped per run/);
  // not sent (Retry, paid once), refused, offline
  assert.match(V.summaryHTML(run, over, { error: 'timeout', retry: true }), /data-gx="retry-finish"/);
  assert.match(V.summaryHTML(run, over, { error: 'That run finished faster than it can be played.' }), /didn't pay this run: That run finished faster/);
  assert.match(V.summaryHTML(run, over, { offline: true, feed: [] }), /played offline, so it pays no VC/);
});

// ---------------- saving, the server ----------------
test('the run saves to this computer after every step and resumes exactly where it was', () => {
  const mem = new Map(), s = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const app = { profile: { account: { id: 'acc-9' } } };
  const run = newRun();
  D.enterNode(run, D.availableNodes(run).find(id => D.nodeOf(run, id).kind === 'match'));
  D.playCard(run, 0);
  assert.equal(GX.saveRun(app, run, { runId: 'r1', choices: [['play', 0, 0]] }, s), true);
  assert.equal(GX.saveKey(app), 'rimrift.gauntlet.v1.acc-9');
  const back = GX.loadSaved(app, s);
  assert.equal(back.meta.runId, 'r1');
  const a = run, b = back.run;
  playOut(a); playOut(b);
  assert.equal(D.stateHash(a), D.stateHash(b), 'the same run from the save');
  GX.clearSaved(app, s); assert.equal(GX.loadSaved(app, s), null);
  // junk in storage, or storage that throws, is no run
  mem.set(GX.saveKey(app), '{nope'); assert.equal(GX.loadSaved(app, s), null);
  assert.equal(GX.loadSaved(app, { getItem() { throw new Error('denied'); } }), null);
  assert.equal(GX.saveRun(app, run, {}, { setItem() { throw new Error('full'); } }), false);
});

test('the server routes: start and finish as the server takes them, guarded when it isn\'t there or says no', async () => {
  const calls = [];
  const fail = status => { const e = new Error(status ? 'Nope.' : 'offline'); e.status = status; throw e; };
  const down = { api: { get: async p => { calls.push(p); fail(404); }, mutate: async (p, b) => { calls.push([p, b]); fail(0); } } };
  assert.equal(await GX.apiProfile(down), null);
  assert.equal(await GX.apiStart(down, 5, { id: 'starter-5-0', name: 'Rook', stats: { stamina: 3, shooting: 3, defense: 3, health: 3 } }), null, 'offline: the run plays here');
  assert.deepEqual(await GX.apiFinish(down, 'r1', {}, []), { error: 'offline', retry: true }, 'unreachable: kept for a retry');
  assert.equal(await GX.apiFinish(down, null, {}, []), null, 'no run id: nothing sent');
  assert.deepEqual(calls.map(c => (Array.isArray(c) ? c[0] : c)), ['/api/gauntlet/profile', '/api/gauntlet/start', '/api/gauntlet/finish']);
  assert.deepEqual(calls[1][1], { seed: 5, engine: D.ENGINE_VERSION, player: { id: 'starter-5-0', name: 'Rook', converted: false } }, 'the server\'s keys: id, name, converted (qp4: and the engine version)');
  const no = { api: { mutate: async () => fail(400) } };
  assert.deepEqual(await GX.apiStart(no, 5, { id: 'x' }), { error: 'Nope.' });
  assert.deepEqual(await GX.apiFinish(no, 'R', {}, []), { error: 'Nope.', refused: true });
  const sent = [];
  const up = { api: { get: async () => ({ converted: [], world: null, stats: {} }), mutate: async (p, b) => { sent.push(b); return p.endsWith('start') ? { run_id: 'R', seed: b.seed } : { vc: 900, balance: 1 }; } } };
  assert.deepEqual(await GX.apiStart(up, 7, { id: 'starter-7-1', name: 'X', stats: {} }), { run_id: 'R', seed: 7 });
  const w = D.emptyWorld(33);
  assert.deepEqual(await GX.apiFinish(up, 'R', { completed: false }, [['end']], w, ['a', 'b']), { vc: 900, balance: 1 });
  assert.deepEqual(sent[1], { run_id: 'R', summary: { completed: false }, choices: [['end']], world: w, feed: ['a', 'b'] }, 'the world and its feed go with the finish');
  // a seed the server takes (1 .. 2^31-1) and the starters' ids are the seed's own
  for (const r of [0, 0.5, 0.9999999999, 1]) { const sd = GX.newSeed(r); assert.ok(sd >= 1 && sd <= GX.SEED_MAX, String(sd)); assert.equal(D.rollStarters(sd)[2].id, `starter-${sd}-2`); }
  // the engine's unlocks aren't the server's sacrifice gates
  assert.equal(GX.engineUnlocks({ completed: 1, next: null }), null);
  assert.deepEqual(GX.engineUnlocks({ startAbility: 'x', cards: ['a'] }), { startAbility: 'x', cards: ['a'] });
  // no world on the server yet: an empty one on the account's AI world
  assert.equal(GX.freshWorld({ ai: { seed: 98765 } }).aiSeed, 98765);
  // a converted player from the server's profile: 6-10 stats and his own look (his build)
  const cv = { id: 'cv-abc', character_id: 'abc', name: 'Dex Ward', converted: true, stats: { stamina: 99, shooting: 95, defense: 72, health: 88 }, overall: 99, position: 'PG',
    build: { name: 'Dex Ward', position: 'PG', height: 75, appearance: { skin: 3, hair: 'fade' }, equipment: {} } };
  const rc = D.rollConverted(1234, cv);
  for (const k of V.STAT_KEYS) assert.ok(rc.stats[k] >= 6 && rc.stats[k] <= 10, `${k} ${rc.stats[k]}`);
  const ce = GX.playerEntry({ catalog: {} }, D.newRun({ seed: 1234, player: rc }).player);
  assert.equal(ce.name, 'Dex Ward'); assert.equal(ce.build.height, 75); assert.deepEqual(ce.build.appearance, { skin: 3, hair: 'fade' });
  // the people on the court: a starter gets a face of his own; an opponent his AI world's look
  const pe = GX.playerEntry({ catalog: {} }, { id: 'starter-1', name: 'Rook', look: null });
  assert.equal(pe.name, 'Rook'); assert.ok(pe.build && pe.look);
  const oe = GX.oppEntry({ catalog: {}, ai: { gameEntry: id => ({ build: { position: 'C', name: 'x' }, name: 'x', look: { top: {} } }) } }, { charId: 'ai-5', name: 'Tariq Sims' });
  assert.equal(oe.name, 'Tariq Sims'); assert.equal(oe.build.position, 'C');
});

// ---------------- v0.4.8.9 qp1: the choice log ----------------
// a run played through the screen's own code (ui/gauntlet.js's controller: enter, play, endTurn, takeReward, the
// Cooler's picker, the Shop, a Mystery Stop), saved and resumed halfway, finished: the log it sends replays
// (deck/replay.js replay) to the same outcome and counts, from exactly the start the server handed it
test('qp1: a run played through the screen logs every engine call; the log replays to the same outcome across a save and resume', async () => {
  const mem = new Map();
  const hadLS = 'localStorage' in globalThis;
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  try {
    const sent = [], RID = 'ab'.repeat(16);
    const world0 = D.emptyWorld(777); // (the server's snapshot: not this computer's world, whose aiSeed would differ)
    const app = {
      profile: { account: { id: 'acc-qp1' } }, catalog: {}, ai: null, setBalance() {},
      api: {
        get: async () => ({ converted: [], world: null, unlocks: { completed: 0, next: null }, stats: {}, feed: [] }),
        mutate: async (path, body) => {
          sent.push([path, JSON.parse(JSON.stringify(body))]);
          if (path.endsWith('/start')) return { run_id: RID, seed: body.seed, player: body.player, started_at: 1, world: world0, unlocks: null, replay: true };
          return { run_id: RID, vc: 420, vc_parts: { matches: 420, raw: 420 }, cap: 8000, balance: 1420, verified: true, world: null, feed: [], unlocks: null };
        },
      },
    };
    let g = await GX.render(app, null, { seed: 4242 });
    assert.equal(g.view.name, 'setup');
    await g.start(0);
    const run0 = g.run;
    assert.equal(run0.player.id, 'starter-4242-0');
    assert.deepEqual(g.meta.start, { engine: D.ENGINE_VERSION, seed: 4242, player: D.rollStarters(4242)[0], world: world0, unlocks: null }, 'the start is the server\'s snapshot (qp4: on this engine)');
    assert.equal(run0.seed, 4242);
    // a refused call isn't logged
    const pref = ['event', 'shop', 'cooler', 'match', 'rival', 'boss'];
    const step = gx => {
      const run = gx.run;
      if (gx.view.name === 'match' && gx.over) { gx.continue(); return; }
      if (run.over) { if (gx.view.name !== 'summary') gx.go(); return 'over'; }
      switch (run.stage) {
        case 'match': {
          if (gx.overlayOn) { gx.tipoff(); return; }
          const hv = D.handView(run), i = hv.findIndex(h => h.playable && D.cardInfo(h.ref).type === 'shot'), j = i >= 0 ? i : hv.findIndex(h => h.playable);
          if (j >= 0) gx.play(j); else gx.endTurn();
          return;
        }
        case 'reward': gx.sel = { card: 0, ability: 0 }; gx.takeReward(run.reward.cards.length ? 0 : null); return;
        case 'cooler': {
          const up = run.deck.findIndex(r => D.canUpgrade(r));
          if (up >= 0 && D.coolerView(run).options.find(o => o.id === 'upgrade')?.enabled) { gx.coolerDo('upgrade'); assert.equal(gx.view.pick, 'upgrade'); gx.coolerDo('upgrade', up); return; }
          gx.coolerDo(D.coolerView(run).options.find(o => o.enabled).id); return;
        }
        case 'shop': {
          const v = D.shopView(run), ci = v.cards.findIndex(c => !c.sold && c.price <= run.coins);
          if (ci >= 0) gx.buy('card', ci);
          else if (!v.removeUsed && run.coins >= v.removePrice) gx.cut(run.deck.length - 1);
          gx.leave(); return;
        }
        case 'event': { const ev = D.eventView(run); gx.choose(Math.max(0, ev.choices.findIndex(c => c.enabled !== false))); gx.action('event-done'); return; }
        default: {
          const av = D.availableNodes(run);
          gx.enter(av.slice().sort((a, b) => pref.indexOf(D.nodeOf(run, a).kind) - pref.indexOf(D.nodeOf(run, b).kind))[0]);
        }
      }
    };
    let tipCheck = false, entered = 0;
    for (let k = 0; k < 4000 && entered < 6; k++) {
      if (!tipCheck && g.run.stage === 'match' && !g.overlayOn && !g.over) {
        const n0 = g.meta.log.length, hv = D.handView(g.run), bad = hv.findIndex(h => !h.playable);
        g.act('node', 'nowhere'); g.act('cooler', 'heal'); if (bad >= 0) g.play(bad); g.play(99);
        assert.equal(g.meta.log.length, n0, 'refused calls aren\'t logged');
        tipCheck = true;
      }
      const st0 = g.run.stage;
      step(g);
      if (st0 === 'map' && g.run.stage !== 'map') entered++;
    }
    // save and resume (the screen reopened, as after a reload)
    const saved = GX.loadSaved(app);
    assert.ok(saved.meta.log.length > 10, 'the log is saved with the run');
    assert.deepEqual(saved.meta.log, g.meta.log);
    const hashBefore = D.stateHash(g.run);
    g.close();
    g = await GX.render(app, null, { resume: true });
    assert.equal(D.stateHash(g.run), hashBefore, 'resumed exactly');
    assert.equal(g.meta.runId, RID);
    for (let k = 0; k < 20000 && step(g) !== 'over'; k++);
    assert.ok(g.run.over, 'the run ended');
    for (let k = 0; k < 50 && !g.meta.fin; k++) await new Promise(r => setTimeout(r, 0));
    assert.equal(g.meta.fin?.verified, true, 'the server\'s answer kept');
    const fin = sent.find(s => s[0].endsWith('/finish'))[1];
    assert.equal(fin.run_id, RID);
    assert.deepEqual(fin.choices, g.meta.log, 'the whole log goes with the finish');
    for (const c of fin.choices) assert.equal(D.choiceShapeError(c), null, JSON.stringify(c));
    const kinds = new Set(fin.choices.map(c => c[0]));
    for (const k of ['node', 'play', 'end']) assert.ok(kinds.has(k), k);
    assert.ok(kinds.size >= 5, `kinds: ${[...kinds]}`);
    // the replay, from the start alone, comes out as the run did
    const rp = D.replay(g.meta.start, fin.choices);
    assert.equal(rp.ok, true, rp.error);
    assert.equal(rp.hash, D.outcomeHash(g.run), 'the same outcome');
    assert.deepEqual(rp.counts, D.runCounts(g.run), 'the same counts');
    for (const k of ['completed', 'phaseReached', 'matchesWon', 'rivals', 'bosses']) assert.equal(rp.over[k], fin.summary[k], k);
    assert.equal(fin.summary.matchesWon, rp.counts.matchesWon);
    assert.ok(fin.summary.matchesWon >= 1, 'a match or more won on the way');
    // the summary: the Verified tick when the server replayed it; nothing when it didn't; a 409's reason
    assert.match(V.summaryHTML(g.run, D.runOver(g.run), g.meta.fin), /data-verified/);
    assert.doesNotMatch(V.summaryHTML(g.run, D.runOver(g.run), { ...g.meta.fin, verified: false }), /Verified/);
    const refused = await GX.apiFinish({ api: { mutate: async () => { const e = new Error('That run\'s log doesn\'t replay: card 3 not in hand (choice 41).'); e.status = 409; e.data = { replay: { error: 'card 3 not in hand', at: 41 } }; throw e; } } }, RID, {}, []);
    assert.deepEqual(refused.replay, { error: 'card 3 not in hand', at: 41 });
    assert.match(V.summaryHTML(g.run, D.runOver(g.run), refused), /data-replay-refused[^]*doesn&#39;t replay: card 3 not in hand/);
    // a converted player's start is his profile entry as the server has it: the replay rolls him exactly as the screen did
    const entry = { id: 'cv-xyz', character_id: 'xyz', name: 'Dex Ward', converted: true, stats: { stamina: 99, shooting: 91, defense: 74, health: 88 }, icon: 'the_clamp', overall: 99, build: { name: 'Dex Ward', position: 'PG', appearance: { skin: 2 } } };
    const rc = D.rollConverted(9001, entry), rr = D.replay({ engine: D.ENGINE_VERSION, seed: 9001, player: entry, world: world0, unlocks: null }, []);
    assert.equal(rr.ok, true, rr.error); assert.deepEqual(rr.run.player.stats, rc.stats);
    assert.equal(rr.hash, D.outcomeHash(D.newRun({ seed: 9001, player: rc, world: world0, unlocks: null })));
    // a run saved before the log (v0.4.8.9) plays on and finishes without one (paid by its counts)
    const old = newRun(77);
    GX.saveRun(app, old, { runId: RID, seed: 77, started: 1, choices: [['node', 'x']] });
    g.close(); sent.length = 0;
    g = await GX.render(app, null, { resume: true });
    assert.equal(g.meta.partial, true);
  } finally {
    if (!hadLS) delete globalThis.localStorage;
    GX.current()?.close();
  }
});

test('the way in, the controls, no real names', () => {
  const s = src('ui/screens.js');
  assert.match(s, /case 'gauntlet': return import\('\.\/gauntlet\.js'\)\.then\(G => G\.render\(app, root, params\)\)/);
  assert.match(s, /class="tile t-gauntlet" data-go="gauntlet"/);
  const g = src('ui/gauntlet.js');
  for (const k of ['KeyE', 'Space', 'KeyF', 'KeyT', 'Digit', 'PAD.Y', 'PAD.X']) assert.ok(g.includes(k), k);
  assert.match(g, /\/api\/gauntlet\/start/); assert.match(g, /\/api\/gauntlet\/finish/); assert.match(g, /\/api\/gauntlet\/profile/);
  assert.ok(fs.existsSync(new URL('../client/css/gauntlet.css', import.meta.url)));
  for (const f of ['ui/gauntlet.js', 'ui/gauntletview.js', 'game/deckcine.js']) assert.doesNotMatch(src(f), /\b(NBA|2K|Nike|Adidas|Jordan|Spalding|Slay the Spire)\b/, f);
});
