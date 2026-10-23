// v0.4.8.9 The Gauntlet, the Hub agent's part (docs/GAUNTLET.md): the Gauntlet's screens, wired to the engine
// (deck/index.js) and the cinematic court (game/deckcine.js). One run at a time:
//   setup (pick a starter or a converted player) → the bracket → a match (the court over the card table) → the reward
//   → ... Coolers, Boost Shops, Mystery Stops, bosses → the Final → the summary (VC, who changed in the nemesis world).
// The run is plain JSON: it's saved to this computer after every step (localStorage, under the account, with its run_id)
// and picks up where it was. The server (server/gauntlet.py) issues the run and pays it:
//   GET  /api/gauntlet/profile → { converted, world, unlocks, stats, feed, parkCards, rules }
//   POST /api/gauntlet/start {key, seed, player: {id, name, converted}} → { run_id, seed, player, started_at, world,
//     unlocks } (a starter is one of the three the seed offers: deck/run.js rollStarters ids starter-<seed>-<i>)
//   POST /api/gauntlet/finish {run_id, summary: runOver(run), choices, world, feed} → { vc, vc_parts, cap, balance,
//     world, feed, unlocks, verified } (paid once per run_id: a retry gets the same answer)
// v0.4.8.9 qp1, the replay check: the run starts (newRun) from exactly the server's snapshot (its seed, world and
// unlocks; the player as the engine rolls him), and every engine call that changes the run goes through the engine's
// own logger, D.act(run, log, kind, ...args) (deck/replay.js: the call made, logged only if it worked). The log is saved
// with the run and sent whole at the finish as `choices`; the server replays it and pays what the replay earned
// (verified: true), or refuses a log that doesn't replay (409, shown on the summary). Nothing here changes a run any
// other way (matchOver, which only settles a finished match, and the views are free to call).
// The summary shows the server's VC and balance. Offline (no server, or a run it never issued) the run still plays and
// saves here, and the nemesis world moves on on this computer.
// Controls: mouse; keyboard 1-0 play a card, E end turn, Space skip the play, F fast-forward, T next target, D deck;
// controller: the focus ring like every menu (A plays the card under it), Y end turn, X skip, VIEW fast-forward.
import * as D from '../deck/index.js';
import * as V from './gauntletview.js';
import { DeckCourt } from '../game/deckcine.js';
import { resolveLook, makeBot } from '../sim/bots.js';
import { RNG, hashString } from '../core/rng.js';
import { PROAM_IDS } from '../world/proamparks.js';
import { PAD } from '../core/input.js';

// ---------------- saving (this computer) ----------------
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
export const saveKey = app => `rimrift.gauntlet.v1.${app?.profile?.account?.id || 'local'}`;
export const worldKey = app => `rimrift.gauntlet.world.v1.${app?.profile?.account?.id || 'local'}`;
export function loadSaved(app, s = store()) { try { const o = JSON.parse(s?.getItem(saveKey(app)) || 'null'); return o && o.v === 1 && o.run && typeof o.run === 'object' ? o : null; } catch { return null; } }
export function saveRun(app, run, meta, s = store()) { try { s?.setItem(saveKey(app), JSON.stringify({ v: 1, run, meta })); return true; } catch { return false; } }
export function clearSaved(app, s = store()) { try { s?.removeItem(saveKey(app)); } catch { /* private mode */ } }
function loadLocalWorld(app) { try { return JSON.parse(store()?.getItem(worldKey(app)) || 'null'); } catch { return null; } }
function saveLocalWorld(app, w) { try { store()?.setItem(worldKey(app), JSON.stringify(w)); } catch { /* private mode */ } }

// ---------------- the server (guarded: the routes may not be there yet) ----------------
export async function apiProfile(app) { try { const r = await app.api.get('/api/gauntlet/profile'); return r && typeof r === 'object' ? r : null; } catch { return null; } }
// start: the run issued (null offline; {error} when the server refused it: the screen says why)
export async function apiStart(app, seed, player) {
  try { const r = await app.api.mutate('/api/gauntlet/start', { seed, engine: D.ENGINE_VERSION, player: { id: String(player.id), name: player.name, converted: !!player.converted } }); return r?.run_id ? r : null; }
  catch (e) { return e?.status >= 400 && e.status < 500 ? { error: e.message || 'The run couldn\'t start.' } : null; }
}
// finish: the server's answer; {error, refused} when it turned the run down (4xx), {error, retry} when it couldn't be
// reached (the run stays saved and Retry sends it again: the server pays a run_id once)
// (choices: the run's whole log, D.act's; a 409 is a log the server's replay refused: its reason is shown)
export async function apiFinish(app, runId, summary, choices, world = null, feed = null) {
  if (!runId) return null;
  const body = { run_id: runId, summary };
  if (Array.isArray(choices)) body.choices = choices;
  if (world) { body.world = world; body.feed = Array.isArray(feed) ? feed.slice(0, 12) : []; }
  try { return await app.api.mutate('/api/gauntlet/finish', body); }
  catch (e) {
    if (e?.status >= 400 && e.status < 500) return { error: e.message || 'The run was refused.', refused: true, ...(e.status === 409 ? { replay: e.data?.replay || {} } : {}) };
    return { error: e?.message || 'The server couldn\'t be reached.', retry: true };
  }
}
// a run's seed: what the server takes (1 .. 2^31-1) and the engine keeps as it is (seed >>> 0)
export const SEED_MAX = 2 ** 31 - 1;
export const newSeed = (r = Math.random()) => 1 + Math.floor(Math.max(0, Math.min(0.999999999, r)) * SEED_MAX);
// the engine's unlocks (a start ability, cards) from the server's (which also carries the sacrifice gates)
export const engineUnlocks = u => (u && (u.startAbility || Array.isArray(u.cards)) ? { startAbility: u.startAbility || undefined, cards: Array.isArray(u.cards) ? u.cards : [] } : null);
// the account's nemesis world when the server has none yet: an empty one on the account's AI world (its seed)
export const freshWorld = app => D.emptyWorld((app?.ai?.seed >>> 0) || ((hashString(String(app?.profile?.account?.id || 'local')) % 1e9) + 1));

// ---------------- who's on the court ----------------
const looksLikeBuild = l => l && typeof l === 'object' && (l.appearance || l.position || l.equipment);
const looksLikeLook = l => l && typeof l === 'object' && (l.top || l.skin || l.hair) && !l.appearance;
// your player: a converted ICON keeps his own look; a starter gets a face of his own from his id
export function playerEntry(app, player) {
  const bot = makeBot(new RNG(hashString(String(player?.id || player?.name || 'you'))), { level: 0.45 });
  const lk = player?.look;
  const build = { ...bot.build, ...(looksLikeBuild(lk) ? lk : {}), name: player?.name || bot.name };
  return { build, name: build.name, look: looksLikeLook(lk) ? lk : resolveLook(build, app?.catalog || {}) };
}
// an opponent: the AI world's own player when the game has him (the same name and look as at the park), else his look
export function oppEntry(app, o) {
  try { const e = o.charId && app?.ai?.gameEntry?.(o.charId); if (e?.build) return { ...e, name: o.name, look: e.look || resolveLook({ ...e.build, name: o.name }, app.catalog) }; } catch { /* not in this world */ }
  const bot = makeBot(new RNG(hashString(String(o.charId || o.name))), { level: 0.6 });
  const build = { ...bot.build, ...(looksLikeBuild(o.look) ? o.look : {}), name: o.name };
  return { build, name: o.name, look: resolveLook(build, app?.catalog || {}) };
}
// where a match is played: the parks for matches (by phase), a Pro-Am park for a boss (his own: bossInfo.court is a
// Pro-Am park id; an unknown one, from an older save, falls back to one picked from his id)
const PARKS = ['harbor', 'brick', 'foundry'];
export function venueFor(run) {
  const m = run.match;
  if (m?.boss) {
    const c = D.bossInfo(m.boss)?.court;
    const id = PROAM_IDS.includes(c) ? c : PROAM_IDS[hashString(String(m.boss)) % PROAM_IDS.length];
    return 'proam_' + id;
  }
  return PARKS[(Math.max(1, Math.min(4, run.phase)) - 1) % PARKS.length];
}

// ---------------- the screen ----------------
let CUR = null;
export const current = () => CUR; // (the screen that's up: the browser checks drive it)
export async function render(app, root, params = {}) {
  ensureCss();
  CUR?.close();
  CUR = new Gauntlet(app, root, params);
  await CUR.open();
  return CUR;
}
export function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('gx-css')) return;
  const l = document.createElement('link'); l.id = 'gx-css'; l.rel = 'stylesheet'; l.href = 'css/gauntlet.css'; document.head.appendChild(l);
}

export class Gauntlet {
  constructor(app, root, params = {}) {
    this.app = app; this.root = root; this.params = params;
    this.run = null; this.meta = null; this.court = null; this.view = {}; this.sel = {}; this.target = 0; this.log = [];
    this.onKey = e => this.key(e);
  }
  async open() {
    const app = this.app;
    this.profile = await apiProfile(app);
    this.offline = !this.profile;
    this.world = this.profile ? (this.profile.world || freshWorld(app)) : (loadLocalWorld(app) || freshWorld(app));
    this.feed = this.profile?.feed || this.world?.feed || [];
    globalThis.addEventListener?.('keydown', this.onKey);
    const saved = loadSaved(app);
    // (a run that ended while the server couldn't be reached: its finish is sent again)
    if (saved?.run.over && saved.meta?.runId && !saved.meta.fin) { this.resume(saved); return; }
    if (saved && !saved.run.over && this.params.resume && !this.oldRules(saved)) { this.resume(saved); return; }
    this.setup(saved && !saved.run.over ? saved.run : null);
  }
  close() { globalThis.removeEventListener?.('keydown', this.onKey); this.dropCourt(); }
  live() { return this.root?.isConnected !== false && CUR === this; }
  html(h, full = false) {
    if (!this.root) return;
    this.root.innerHTML = h;
    const ui = this.root.closest?.('#ui');
    if (ui) ui.classList.toggle('gx-full', !!full);
    this.root.classList?.add('gx-root');
    this.bind();
  }
  save() { if (this.run) saveRun(this.app, this.run, this.meta); }
  // every engine call that changes the run: made and logged by the engine (D.act: logged only if it worked)
  act(kind, ...args) { return D.act(this.run, this.meta.log, kind, ...args); }

  // ---------- setup ----------
  setup(saved = null) {
    this.dropCourt();
    this.run = null;
    // (params.seed: a given seed, for the browser checks; the menus never pass one. The server takes any seed in range
    // and pays from the run's counts, so a chosen seed is no advantage)
    const ps = Math.floor(+this.params.seed || 0);
    this.seed = ps >= 1 && ps <= SEED_MAX ? ps : newSeed();
    const starters = D.rollStarters(this.seed, 3).map(p => ({ player: p, kind: 'starter' }));
    const conv = (Array.isArray(this.profile?.converted) ? this.profile.converted : []).filter(c => c && c.id).map(c => ({ player: D.rollConverted(this.seed, c), kind: 'converted', entry: c }));
    this.players = [...conv, ...starters];
    this.view = { name: 'setup' };
    this.html(V.setupHTML({ players: this.players, profile: this.profile, saved, feed: this.feed, offline: this.offline, notice: this.notice, engine: D.ENGINE_VERSION }));
  }
  // (qp4) a saved run from before the Gauntlet played in possessions can't go on under the new rules: it's ended where
  // it stands and sent; the server pays what it won by its counts (unverified)
  oldRules(saved) { return !!saved?.run && (saved.run.engine ?? 1) !== D.ENGINE_VERSION; }
  endOldRun() {
    const saved = loadSaved(this.app);
    if (!saved || !this.oldRules(saved)) return;
    this.run = { ...saved.run, over: saved.run.over || { completed: false, ended: 'old rules' }, stage: 'over' };
    // (no choices: the old engine's log can't be replayed by this one; the server pays the run by its counts)
    this.meta = { ...(saved.meta || { runId: null, seed: saved.run.seed, started: Date.now() }), partial: true };
    if (!Array.isArray(this.meta.log)) this.meta.log = [];
    this.summary();
  }
  async start(i) {
    const pick = this.players[i]; if (!pick || this.starting) return;
    this.starting = true;
    const st = await apiStart(this.app, this.seed, pick.player);
    this.starting = false;
    if (!this.live()) return;
    if (st?.error) {
      // (qp4: a server on another engine version: "Update the game to play the Gauntlet." stays on the screen)
      if (/update the game/i.test(st.error)) { this.notice = { kind: 'update', text: st.error }; this.setup(null); return; }
      this.toast(st.error, 'error'); return;
    }
    // the run's start, exactly the server's snapshot (the seed it kept, its world and unlocks), so its replay starts the
    // same: a starter as the seed rolls him (his id is the seed's own), a converted player rolled from his profile entry
    // as it is (deck/replay.js canonicalPlayer rolls the same). Offline: this computer's world.
    const seed = (st?.seed >>> 0) || this.seed;
    const player = pick.kind === 'converted' && pick.entry ? D.rollConverted(seed, pick.entry) : pick.player;
    const start = st
      ? { engine: D.ENGINE_VERSION, seed, player: pick.kind === 'converted' && pick.entry ? pick.entry : player, world: 'world' in st ? st.world : this.world, unlocks: 'unlocks' in st ? st.unlocks : null }
      : { engine: D.ENGINE_VERSION, seed, player, world: this.world, unlocks: engineUnlocks(this.profile?.unlocks) };
    this.run = D.newRun({ seed, player, world: start.world, unlocks: start.unlocks, ai: this.app.ai || null, now: Date.now() });
    this.meta = { v: 2, runId: st?.run_id || null, seed, started: Date.now(), log: [], start, offline: !st, replay: !!st?.replay };
    this.save();
    this.toast(`${pick.player.name} enters the Gauntlet.`);
    this.go();
  }
  resume(saved) {
    this.run = saved.run;
    this.meta = saved.meta || { runId: null, seed: saved.run.seed, started: Date.now() };
    // (a run saved before the choice log: it plays on, and its finish goes without one, paid by its counts)
    if (!Array.isArray(this.meta.log)) { this.meta.log = []; this.meta.partial = true; }
    this.go();
  }

  // ---------- where the run is ----------
  go() {
    const r = this.run;
    if (!r) return this.setup();
    if (r.over || r.stage === 'over') return this.summary();
    if (r.stage === 'match') return this.match();
    if (r.stage === 'reward') return this.reward();
    if (r.stage === 'cooler') return this.cooler();
    if (r.stage === 'shop') return this.shop();
    if (r.stage === 'event') return this.event();
    return this.map();
  }
  map(focus = null) {
    this.dropCourt();
    this.view = { name: 'map' };
    this.html(V.mapHTML(this.run, { focus }));
    const here = this.root?.querySelector?.('.gx-node.open');
    here?.scrollIntoView?.({ block: 'center' });
  }
  enter(id) {
    const r = this.act('node', id);
    if (!r.ok) { this.toast('You can\'t go there.', 'error'); return; }
    this.save();
    this.go();
  }

  // ---------- the match ----------
  match() {
    const run = this.run, m = run.match, app = this.app;
    this.over = null; this.log = []; this.target = Math.max(0, m.opps.findIndex(o => o.heart > 0));
    if (!this.court || this.court.matchId !== m.id + ':' + run.matchCount) {
      this.dropCourt();
      const boss = m.boss ? D.bossInfo(m.boss) : null;
      try {
        this.court = new DeckCourt(app, {
          venue: venueFor(run), seed: (run.seed ^ hashString(m.id)) >>> 0,
          home: { name: boss ? boss.title : 'The Gauntlet', abbr: 'GNT', primary: boss ? '#7a1f1c' : '#ff4d24', secondary: '#f3eee4', logo: boss ? 'crown' : 'bolt' },
          you: playerEntry(app, run.player), opps: m.opps.map(o => oppEntry(app, o)),
          onStart: pl => this.caption(pl.text), onLand: (pl, score) => this.scoreLanded(score), onFrame: () => this.pad(),
        });
        this.court.matchId = m.id + ':' + run.matchCount;
        this.court.score = m.score.slice();
        app.setController?.(this.court, this.court.scene);
      } catch (e) { console.error('[gauntlet] court', e); this.court = null; }
    }
    this.view = { name: 'match' };
    this.drawMatch();
    // before the tip: the boss, the rules, and whoever has history with you says so
    if (m.turn <= 1 && !m.tipped && this.meta?.tipped !== this.matchKey()) {
      const lines = this.nemesisLines();
      if (lines.length || m.boss || m.rules.length) { this.overlay(V.preMatchHTML(run, lines) + (m.boss ? '' : '')); return; }
      this.tipoff();
    }
  }
  nemesisLines() {
    const m = this.run.match, w = this.world;
    return m.opps.filter(o => o.charId && (w?.chars?.[o.charId] || this.run.wc?.[o.charId])).map(o => ({ name: o.name, text: D.charLine(w, o.charId, 'intro', this.run.seed ^ hashString(m.id)) })).filter(l => l.text);
  }
  // (which match the tip-off was shown for: kept with the save, never on the run, which only the engine changes)
  matchKey() { const r = this.run; return r?.match ? `${r.match.id}:${r.matchCount}` : null; }
  tipoff() {
    const m = this.run.match;
    if (this.meta) this.meta.tipped = this.matchKey();
    this.overlay(null);
    if (m.intro?.length) this.feedEvents(m.intro);
    this.save();
  }
  feedEvents(evs) {
    for (const e of evs || []) if (e.text && e.type !== 'card') this.log.push(e.text);
    this.court?.enqueue(evs, { target: this.target });
  }
  play(i) {
    const run = this.run, m = run.match;
    if (!m || this.over || this.overlayOn) return;
    const h = D.handView(run)[i];
    if (!h) return;
    if (!h.playable) { this.toast(h.why || 'You can\'t play that now.', 'error'); return; }
    const r = this.act('play', i, this.target);
    if (!r.ok) { this.toast(r.result?.[0]?.text || 'You can\'t play that now.', 'error'); return; }
    this.after(r.result);
  }
  endTurn() {
    const run = this.run, m = run.match;
    if (!m || this.over || this.overlayOn) return;
    // (qp4: the last possession still playing on the court: End Turn finishes it first, so the next set is seen before
    // anything is committed to it)
    if (this.court?.busy) { this.court.skipAll(); this.drawMatch(); return; }
    const r = this.act('end');
    if (r.ok) this.after(r.result);
  }
  after(evs) {
    const m = this.run.match;
    // (qp4: the possession's clash, shown on the table while it plays on the court)
    const cl = (evs || []).find(e => e.type === 'clash');
    if (cl) { const youOff = cl.actor === 'you'; this.lastClash = { youOff, you: youOff ? cl.o : cl.d, them: youOff ? cl.d : cl.o, text: cl.winner === 'offense' ? (youOff ? 'You scored' : 'They scored') : youOff ? 'Stopped' : 'You stopped them' }; }
    this.feedEvents(evs);
    if (m.opps[this.target]?.heart <= 0) this.target = Math.max(0, m.opps.findIndex(o => o.heart > 0));
    const res = D.matchOver(this.run);
    if (res) this.over = res;
    this.save();
    this.drawMatch();
  }
  // after the final buzzer: the plays still on the court land, then the reward (or the end)
  continue() { this.court?.skipAll(); this.over = null; this.go(); }
  drawMatch() {
    if (!this.run?.match) return;
    const busy = !!this.court?.busy;
    const score = busy ? this.court.score : this.run.match.score;
    this.html(V.matchHTML(this.run, { target: this.target, busy, score, last: this.log, over: this.over, fast: !!this.court?.queue.fast, caption: this.captionText, lastClash: this.lastClash }), true);
  }
  caption(t) { this.captionText = t; const el = this.root?.querySelector?.('[data-caption]'); if (el) el.textContent = t || ''; }
  scoreLanded(score) {
    for (const [i, el] of [...(this.root?.querySelectorAll?.('[data-score]') || [])].entries()) { el.textContent = score[i]; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
  // the controller's shortcuts (the focus ring has A and B)
  pad() {
    // (the last play landed: the table's score is the engine's again)
    const busy = !!this.court?.busy;
    // (qp4: and the table shows the next possession: its banner, their set, the live clash)
    if (this.wasBusy && !busy && this.run?.match) { this.court.score = this.run.match.score.slice(); this.caption(''); this.drawMatch(); this.scoreLanded(this.court.score); }
    this.wasBusy = busy;
    const inp = this.app.input; if (!inp?.gp?.connected || this.view.name !== 'match' || this.app.modalOpen?.()) return;
    if (inp.gpEdge(PAD.Y)) { inp.gp.prev[PAD.Y] = true; this.endTurn(); }
    if (inp.gpEdge(PAD.X)) { inp.gp.prev[PAD.X] = true; this.court?.skip(); }
    if (inp.gpEdge(PAD.VIEW)) { inp.gp.prev[PAD.VIEW] = true; this.fast(); }
  }
  fast() { if (!this.court) return; this.court.setFast(!this.court.queue.fast); this.drawMatch(); }
  key(e) {
    if (!this.live()) { this.close(); return; }
    if (this.app.modalOpen?.() || e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    if (this.view.name !== 'match') { if (e.code === 'KeyD' && this.run) this.deck(); return; }
    const k = e.code;
    if (/^Digit[0-9]$/.test(k)) { const n = (+k.slice(5) + 9) % 10; e.preventDefault(); this.play(n); }
    else if (k === 'KeyE') { e.preventDefault(); this.endTurn(); }
    else if (k === 'Space') { e.preventDefault(); this.court?.skip(); }
    else if (k === 'KeyF') { e.preventDefault(); this.fast(); }
    else if (k === 'KeyT') { const m = this.run.match, n = m.opps.length; for (let s = 1; s <= n; s++) { const j = (this.target + s) % n; if (m.opps[j].heart > 0) { this.target = j; break; } } this.drawMatch(); }
    else if (k === 'KeyD') this.deck();
  }
  dropCourt() {
    if (!this.court) return;
    const c = this.court; this.court = null;
    if (this.app.controller === c && this.app.showroom) this.app.setController(this.app.showroom, this.app.showroom.scene);
    c.dispose();
  }

  // ---------- the stops ----------
  reward() { this.dropCourt(); this.view = { name: 'reward' }; this.sel = { card: null, ability: 0 }; this.html(V.rewardHTML(this.run)); }
  takeReward(card) {
    const rw = this.run.reward; if (!rw) return;
    const ability = rw.abilities?.length ? (this.sel.ability ?? 0) : !!rw.ability;
    const r = this.act('reward', card ?? null, ability);
    if (!r.ok) { this.toast('You can\'t take that.', 'error'); return; }
    const out = r.result;
    if (out?.card) this.toast(`${D.cardInfo(out.card).name} joins your deck.`);
    this.save(); this.go();
  }
  cooler(pick = null) { this.dropCourt(); this.view = { name: 'cooler', pick }; this.html(V.coolerHTML(this.run, pick)); }
  coolerDo(id, idx) {
    if ((id === 'upgrade' || id === 'remove') && idx == null) { this.cooler(id); return; }
    const r = this.act('cooler', id, idx ?? undefined);
    if (!r.ok) { this.toast(String(r.error || '').replace(/^Cooler: /, '') || 'You can\'t do that.', 'error'); return; }
    this.toast(r.result.text); this.save(); this.go();
  }
  shop(pick = null) { this.dropCourt(); this.view = { name: 'shop', pick }; this.html(V.shopHTML(this.run, pick)); }
  buy(kind, i) { const r = this.act('shopBuy', kind, i); this.toast(r.ok ? r.result.text : String(r.error || '').replace(/^Shop: /, ''), r.ok ? '' : 'error'); if (r.ok) this.save(); this.shop(); }
  cut(i) { const r = this.act('shopRemove', i); this.toast(r.ok ? r.result.text : String(r.error || '').replace(/^Shop: /, ''), r.ok ? '' : 'error'); if (r.ok) this.save(); this.shop(); }
  leave() { this.act('leave'); this.save(); this.go(); }
  event(outcome = null) { this.dropCourt(); this.view = { name: 'event', outcome }; this.html(V.eventHTML(this.run, outcome)); }
  choose(i) {
    const r = this.act('event', i);
    if (!r.ok) { this.toast('You can\'t do that.', 'error'); return; }
    const res = r.result;
    this.save();
    this.eventDone = res;
    this.event(res);
  }

  // ---------- the end ----------
  // the run's end: the nemesis world moves on (the engine's worldAfterRun), then the server pays the run and keeps the
  // world; the summary shows what it paid and the new balance. A finish that couldn't reach the server stays saved
  // (Retry); one the server refused, or a run it never issued, keeps the world here and pays nothing.
  async summary() {
    this.dropCourt();
    const run = this.run, over = D.runOver(run);
    this.view = { name: 'summary' };
    if (this.meta?.fin) { this.html(V.summaryHTML(run, over, this.meta.fin)); return; }
    this.html(V.summaryHTML(run, over, null, { sending: !!this.meta?.runId }));
    if (this.finishing) return;
    this.finishing = true;
    if (!this.meta) this.meta = { runId: null, seed: run.seed, started: Date.now(), log: [], partial: true };
    // (worked out once and kept with the save, so a retry sends the same world: the world the run started from, moved on)
    if (!this.meta.after) { const w = D.worldAfterRun(this.meta.start?.world || this.world, over, run.seed); this.meta.after = { world: w.world, feed: w.feed }; this.save(); }
    const after = this.meta.after;
    const fin = await apiFinish(this.app, this.meta.runId, over, this.meta.partial ? null : this.meta.log, after.world, after.feed);
    this.finishing = false;
    if (fin?.retry) {
      this.save();
      if (this.live()) this.html(V.summaryHTML(run, over, { error: fin.error, retry: true }));
      return;
    }
    let shown;
    if (fin && !fin.error) {
      this.world = fin.world || after.world; this.feed = fin.feed || after.feed;
      if (fin.balance != null) this.app.setBalance?.(fin.balance);
      const p = this.app.profile;
      if (p && fin.unlocks) p.gauntlet_unlocks = fin.unlocks;
      if (this.profile) { this.profile.unlocks = fin.unlocks || this.profile.unlocks; this.profile.world = this.world; this.profile.feed = this.feed; }
      shown = { ...fin, feed: fin.feed || after.feed || [] };
    } else {
      // (offline, or refused: the world moves on here, so the people you met remember it next run)
      this.world = after.world; this.feed = after.feed; saveLocalWorld(this.app, after.world);
      shown = { error: fin?.error || null, offline: !fin, feed: after.feed || [] };
    }
    this.meta.fin = shown;
    clearSaved(this.app);
    if (this.live()) this.html(V.summaryHTML(run, over, shown));
  }

  // ---------- the pieces every screen has ----------
  deck() { this.modal(V.deckHTML(this.run), true); }
  pile(which) { const m = this.run.match; const refs = which === 'draw' ? m.drawPile.slice().sort() : which === 'discard' ? m.discard : m.burned; this.modal(V.pileHTML(which === 'draw' ? 'Draw pile (in no order)' : which === 'discard' ? 'Discard pile' : 'Burned', refs), true); }
  overlay(h) {
    this.overlayOn = !!h;
    const old = this.root?.querySelector?.('.gx-overlay'); old?.remove();
    if (!h || !this.root) return;
    const d = this.root.ownerDocument.createElement('div'); d.className = 'gx-overlay'; d.innerHTML = h; this.root.appendChild(d);
    this.bind(d);
    d.querySelector('button')?.focus?.();
  }
  modal(h, wide) { import('./common.js').then(C => C.modal(h, { wide })).catch(() => {}); }
  toast(t, k) { if (!t) return; import('./common.js').then(C => C.toast(t, k)).catch(() => {}); }
  bind(scope = this.root) {
    if (!scope?.querySelectorAll) return;
    const on = (sel, f) => scope.querySelectorAll(sel).forEach(b => { b.onclick = ev => { ev.preventDefault?.(); f(b); }; });
    on('[data-pick-player]', b => this.start(+b.dataset.pickPlayer));
    on('[data-node]', b => { if (b.classList.contains('open')) this.enter(b.dataset.node); });
    scope.querySelectorAll('[data-node]').forEach(b => { const pv = () => { const nd = D.mapView(this.run)?.rows.flat().find(x => x.id === b.dataset.node); const box = this.root.querySelector('[data-preview]'); if (nd && box) box.innerHTML = V.previewHTML(nd, this.run); }; b.onmouseenter = pv; b.onfocus = pv; });
    on('[data-card]', b => this.play(+b.dataset.card));
    on('[data-target]', b => { this.target = +b.dataset.target; this.drawMatch(); });
    on('[data-pile]', b => this.pile(b.dataset.pile));
    on('[data-reward-card]', b => { this.sel.card = +b.dataset.rewardCard; scope.querySelectorAll('[data-reward-card]').forEach(x => x.classList.toggle('sel', x === b)); const t = scope.querySelector('[data-gx="take"]'); if (t) t.disabled = false; });
    on('[data-reward-ability]', b => { this.sel.ability = +b.dataset.rewardAbility; scope.querySelectorAll('[data-reward-ability]').forEach(x => x.classList.toggle('sel', x === b)); });
    const firstAb = scope.querySelector('[data-reward-ability]'); if (firstAb && this.view.name === 'reward') firstAb.classList.add('sel');
    on('[data-cooler]', b => this.coolerDo(b.dataset.cooler));
    on('[data-pick-card]', b => { const i = +b.dataset.pickCard; if (this.view.name === 'cooler') this.coolerDo(this.view.pick, i); else this.cut(i); });
    on('[data-buy-card]', b => this.buy('card', +b.dataset.buyCard));
    on('[data-buy-ability]', b => this.buy('ability', +b.dataset.buyAbility));
    on('[data-choice]', b => this.choose(+b.dataset.choice));
    on('[data-gx]', b => this.action(b.dataset.gx, b));
  }
  action(a) {
    switch (a) {
      case 'resume': { const s = loadSaved(this.app); if (s && !this.oldRules(s)) this.resume(s); return; }
      case 'end-old': return this.endOldRun();
      case 'dismiss': this.notice = null; return this.setup(null);
      case 'abandon': clearSaved(this.app); this.setup(null); return;
      case 'deck': return this.deck();
      case 'end': return this.endTurn();
      case 'skip': return this.court?.skip();
      case 'fast': return this.fast();
      case 'continue': return this.continue();
      case 'tipoff': return this.tipoff();
      case 'take': return this.takeReward(this.sel.card);
      case 'skip-card': return this.takeReward(null);
      case 'pick-back': return this.view.name === 'cooler' ? this.cooler(null) : this.shop(null);
      case 'remove': return this.shop('remove');
      case 'leave': return this.leave();
      case 'event-done': { const r = this.eventDone; this.eventDone = null; if (r?.fight) this.match(); else this.go(); return; }
      case 'menu': return import('./screens.js').then(S => S.go(this.app, 'home'));
      case 'again': return this.setup(null);
      case 'retry-finish': return this.summary();
      default: return null;
    }
  }
}
