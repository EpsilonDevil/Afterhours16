// Mode screens: Park entry + hub overlay, Pro-Am team & games, Practice gym, results.
import { $, $$, esc, money, toast, modal, closeModal, title, TIER, confirmBox, archHTML } from './common.js';
import { AFFILIATIONS, THEMES, EVENTS, travelLock } from '../world/themes.js';
import { Scene } from '../gfx/renderer.js';
import { buildVenue } from '../world/venues.js';
import { MatchSession } from '../game/session.js';
import { ParkHub, badgeTiers } from '../game/park.js';
import { makeTeam, resolveLook } from '../sim/bots.js';
import { RNG, hashString } from '../core/rng.js';
import { settings, saveSettings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { music } from '../core/music.js';
import * as Screens from './screens.js';
import * as Rewards from './rewards.js';
import { playOutro } from './outro.js';
import * as Phone from './phone.js';
import * as Stats from './stats.js';
import { boostedBuild, ATTR_LABEL } from '../sim/ratings.js';
import { padGlyph } from '../core/input.js';
import * as MyPlayer from './myplayer.js';
import { badgeSVG, iconBadgeSVG, rankEmblemSVG } from './badgeart.js';
import { RANKS, RANK_SPAN, FORFEIT_RP, rankOf, rpOf, levelRating, teamRating } from '../sim/ranks.js';
import { reportBug } from './bugreport.js';
import * as Crew from './crew.js';
import { CrewHQ, RUN_MIN } from '../game/crewhq.js';
import * as Online from './online.js';
import { endWinStreak } from '../game/iconfx.js';
import { syncEvent } from './events.js';
import { slotOpenedText } from '../sim/builds.js';

// Tear down whatever 3D world is running (park hub / standalone match)
export function leaveWorld(app) {
  if (app.world) { try { app.world.dispose(); } catch (e) { console.error(e); } app.world = null; }
  audio.setCrowd(0); // v0.4.3: no crowd bed in menus
  app.hud.show(false);
  $('#prompt').innerHTML = '';
  app.mode = 'menu';
}

// ---------------- Park ----------------
export function parkEntry(app, root) {
  const c = app.char();
  if (!c.affiliation) {
    root.innerHTML = `<section class="panel wide-panel"><div class="eyebrow">THE PARK</div><h1>Pick your affiliation</h1>
      <p class="muted">Your affiliation is your home park and your colors. It's chosen once per player.</p>
      <div class="aff-grid">${Object.values(AFFILIATIONS).map(a => `<button class="aff" data-aff="${a.id}" style="--c:${a.color};--d:${a.accent}"><span class="aff-k">${esc(a.park.toUpperCase())}</span><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></button>`).join('')}</div></section>`;
    $$('[data-aff]', root).forEach(b => b.onclick = async () => {
      if (!(await confirmBox(`Join ${AFFILIATIONS[b.dataset.aff].name}? This can't be changed for this player.`, 'Join'))) return;
      try { const res = await app.api.mutate(`/api/characters/${c.id}/affiliation`, { affiliation: b.dataset.aff }); app.replaceChar(res.character); Screens.go(app, 'park'); }
      catch (e) { toast(e.message, 'error'); }
    });
    return;
  }
  const home = AFFILIATIONS[c.affiliation];
  const pk = c.progression?.park || {};
  const ev = activeEvent(app); // v0.4.7.5 qp3: whichever park event the schedule has on (the Cup, the Jungle...)
  root.innerHTML = `<section class="panel wide-panel"><div class="eyebrow">THE PARK · ${esc(home.name.toUpperCase())}</div><h1>${esc(home.park)}</h1>
    <p class="muted">Walk the park, stand on a <b>Got Next</b> circle to claim the next game, and hold the court as long as you can. Winners stay on.</p>
    <div class="stat-strip"><div><b>${pk.wins || 0}-${(pk.games || 0) - (pk.wins || 0)}</b><small>PARK RECORD</small></div><div><b>${pk.streak || 0}</b><small>CURRENT STREAK</small></div><div><b>${pk.best_streak || 0}</b><small>BEST STREAK</small></div><div><b>${esc(c.rep.label)}</b><small>REP</small></div></div>
    <div class="aff-grid small">${Object.values(AFFILIATIONS).map(a => { const lock = travelLock(c, a.id); return `<button class="aff ${a.id === c.affiliation ? 'home' : ''} ${lock ? 'locked' : ''}" data-park="${a.id}" style="--c:${a.color};--d:${a.accent}" ${lock ? `title="${esc(lock)}"` : ''}><span class="aff-k">${a.id === c.affiliation ? 'HOME PARK' : lock ? '🔒 PRO 1' : 'VISIT'}</span><b>${esc(a.park)}</b><small>${esc(a.name)}</small></button>`; }).join('')}</div>
    ${Object.keys(AFFILIATIONS).some(id => travelLock(c, id)) ? `<p class="muted small">You play in your home park until you reach <b>Pro 1</b> (you're ${esc(c.rep.label)}); then every park is open to visit. Park events, the Crew HQ, Pro-Am, the Pro Run and practice are open now.</p>` : ''}
    ${ev ? `<div class="event-card" data-cup style="--c:${ev.color};--d:${ev.accent}"><div class="ev-k">PARK EVENT · LIVE</div><b>${esc(ev.park.toUpperCase())}</b><small>${esc(ev.blurb)} Every game is an ante-up; the most VC won in 48 hours takes ${esc(ev.prize)}.</small>
      <div class="ev-row"><span class="ev-stat" data-cup-left>…</span><span class="ev-stat" data-cup-rank></span><button class="btn ghost small" data-cup-board>Leaderboard</button><button class="btn primary small" data-park="${ev.id}">${esc(ev.enter)}</button></div></div>` : '<div class="event-card off" data-cup><div class="ev-k">PARK EVENT</div><b>NO EVENT RUNNING</b><small>The next park event will show up here.</small></div>'}
    <div class="row gap"><label class="muted small">Games to <select data-target>${[11, 15, 21].map(t => `<option ${settings.parkTarget === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <div class="row gap end"><button class="btn primary big" data-park="${c.affiliation}">Enter ${esc(home.park)}</button></div></section>`;
  $('[data-target]', root).onchange = e => { settings.parkTarget = +e.target.value; saveSettings(); };
  $$('[data-park]', root).forEach(b => b.onclick = () => enterPark(app, b.dataset.park));
  const bb = $('[data-cup-board]', root); if (bb) bb.onclick = () => openCupBoard(app);
  // v0.4.5: time left and your place in the running Cup (and a nudge when last Cup's prizes are waiting)
  app.api.get('/api/cup').then(st => {
    // v0.4.7.5 qp3: the schedule may have moved on since the config was loaded (the Cup ended, the Jungle began)
    if (syncEvent(app, st, { announce: false })) { parkEntry(app, root); return; } // (qp4: and the AI world's venue with it)
    const left = $('[data-cup-left]', root), rank = $('[data-cup-rank]', root);
    if (left) left.textContent = `Ends in ${cupTimeLeft(st)}`;
    if (rank) rank.textContent = st.me.rank ? `You: #${st.me.rank} of ${st.field} · ${money(st.me.net)} VC` : `${st.field} hoopers entered`;
    if (st.previous && !st.previous.claimed && st.previous.prize) {
      const card = $('[data-cup]', root);
      card?.insertAdjacentHTML('beforeend', `<div class="ev-claim">Last ${esc(eventName(st.previous.event))}: you finished #${st.previous.rank}. <button class="btn primary small" data-cup-claim>Claim ${esc(st.previous.prize.label)} prizes</button></div>`);
      $('[data-cup-claim]', root).onclick = () => openCupBoard(app);
    }
  }).catch(() => {});
}

// ---------------- v0.4.5 The King Tut Cup / v0.4.7.5 qp3 park events ----------------
// the event that is on, as the client knows it (the server's schedule through /api/config, refreshed by /api/cup)
export const activeEvent = app => (app.config?.event && EVENTS[app.config.event.id]) || null;
const eventName = e => (e && EVENTS[e.id || e]?.name) || 'King Tut Cup';
export function cupTimeLeft(st) {
  const s = Math.max(0, st.end - Date.now() / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h >= 1 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
const cupName = (app, id) => id === 'me' ? (app.char()?.name || 'You') : (app.ai?.entry(id)?.name || id);
const cupTier = (app, id) => id === 'me' ? 'You' : (app.ai?.entry(id)?.tierLabel || '');

export async function openCupBoard(app) {
  let st;
  try { st = await app.api.get('/api/cup'); } catch (e) { toast(e.message, 'error'); return; }
  const row = r => `<tr class="${r.id === 'me' ? 'me' : ''}"><td>${r.rank}</td><td>${esc(cupName(app, r.id))}<small>${esc(cupTier(app, r.id))}</small></td><td>${r.games}</td><td>${r.wins}</td><td>${r.best_streak}</td><td class="num">${r.net < 0 ? '−' : ''}${money(Math.abs(r.net))}</td></tr>`;
  const items = ids => ids.map(i => esc(app.catalog[i]?.name || i)).join(', ');
  const prev = st.previous, ev = (st.event && EVENTS[st.event.id]) || null, evName = ev ? ev.name : 'park event', prevName = prev ? eventName(prev.event) : evName;
  if (st.event) syncEvent(app, st, { announce: false });
  const card = modal(`<div class="cup-board">
    <div class="eyebrow">${ev ? esc(ev.park.toUpperCase()) : 'PARK EVENT'} · 48-HOUR LEADERBOARD</div>
    <h2>Most VC won <span class="muted small">· ends in ${cupTimeLeft(st)} · ${st.field} on the board</span></h2>
    ${prev ? `<div class="cup-prev ${prev.claimed ? '' : 'ready'}"><b>Last ${esc(prevName)}:</b> you finished #${prev.rank} of ${prev.field} with ${money(prev.net)} VC. ${prev.winner ? `Won by ${esc(cupName(app, prev.winner.id))} (${money(prev.winner.net)} VC). ` : ''}
      ${prev.prize ? (prev.claimed ? '<span class="muted">Prizes claimed.</span>' : `<button class="btn primary small" data-claim="${prev.window}">Claim: ${esc(prev.prize.label)} · ${money(prev.prize.vc)} VC${prev.prize.items.length ? ' + ' + items(prev.prize.items) : ''}</button>`) : ''}</div>` : ''}
    <div class="cup-me">${st.me.rank ? `You: <b>#${st.me.rank}</b> · ${money(st.me.net)} VC · ${st.me.games} games · ${st.me.wins} wins · best streak ${st.me.best_streak}` : 'You haven\'t played this ${esc(evName)} yet. Every game is an ante-up: win and you take the other side\'s stake (boosted by your event streak); lose and your stake is gone.'}</div>
    <table class="cup-table"><thead><tr><th>#</th><th>Hooper</th><th>GP</th><th>W</th><th>Best streak</th><th class="num">Net VC</th></tr></thead>
      <tbody>${st.board.map(row).join('')}${st.around?.length ? `<tr class="gap"><td colspan="6">…</td></tr>${st.around.map(row).join('')}` : ''}</tbody></table>
    <div class="cup-prizes"><b>Final-standings prizes</b>${st.prizes.map(p => `<div><span>${p.best ? (p.best === 1 ? '1st' : 'Top ' + p.best) : esc(p.label)}</span><span>${money(p.vc)} VC${p.items.length ? ' + ' + items(p.items) : ''}</span></div>`).join('')}</div>
  </div>`, { wide: true });
  const cb = card.querySelector('[data-claim]');
  if (cb) cb.onclick = async () => {
    cb.disabled = true;
    try {
      const r = await app.api.mutate('/api/cup/claim', { window: +cb.dataset.claim });
      app.setBalance(r.balance);
      for (const id of r.items) if (!app.profile.inventory.includes(id)) app.profile.inventory.push(id);
      audio.ui('buy');
      toast(`${prevName} prizes claimed: ${money(r.prize.vc)} VC${r.items.length ? ' + ' + items(r.items) : ''}.`);
      closeModal(); openCupBoard(app);
    } catch (e) { toast(e.message, 'error'); cb.disabled = false; }
  };
}

// pick the stake for a Cup game (cb(null) if you back out)
export function pickAnte(app, hub, cb) {
  const bal = app.profile?.balance || 0, streak = hub.myStreak(), mult = Math.round((1 + 0.3 * Math.min(10, streak)) * 100) / 100;
  const antes = hub.cupState?.antes || [500, 1000, 2500, 5000, 10000];
  let done = false;
  const card = modal(`<div class="ante-pick"><div class="eyebrow">${esc((hub.event?.park || 'PARK EVENT').toUpperCase())} · ANTE-UP</div><h2>Put VC on the line</h2>
    <p class="muted">Your stake comes out when the game starts. Win and you get it back plus the other side's stake${streak ? `, boosted ×${mult.toFixed(2)} by your ${streak}-game ${esc(hub.event?.name || 'event')} streak` : ''} — on top of the normal game VC. Lose (or leave) and the stake is gone. Run it back keeps the same ante.</p>
    <div class="ante-grid">${antes.map(a => `<button class="btn ${a === hub.ante ? 'primary' : ''}" data-ante="${a}" ${a > bal ? 'disabled' : ''}><b>${money(a)}</b><small>win +${money(Math.round(a * mult))}</small></button>`).join('')}</div>
    <p class="muted small">Balance: ${money(bal)} VC</p></div>`);
  const prevClose = closeModal.onClose;
  closeModal.onClose = () => { if (prevClose) prevClose(); if (!done) { done = true; cb(null); } };
  card.querySelectorAll('[data-ante]').forEach(b => b.onclick = () => { done = true; closeModal(); cb(+b.dataset.ante); });
}

export function enterPark(app, themeId, opts = {}) {
  // v0.4.7.5 qp3: an event park that isn't on the schedule is closed (its code is all still here for when it comes back)
  if (THEMES[themeId]?.event && activeEvent(app)?.id !== themeId) { toast(`${THEMES[themeId].name} isn't running right now.`, 'error'); return false; }
  // v0.4.8.5: until Pro 1 a build plays in its home park (events and the HQ are always open)
  const lock = travelLock(app.char(), themeId);
  if (lock) { toast(lock, 'error'); return false; }
  leaveWorld(app);
  const ui = new ParkUI(app);
  $('#ui').innerHTML = ''; $('#ui').className = 'layer';
  ui.mount();
  toast(opts.at === 'hq' ? 'Back to the park…' : opts.at === 'hall' ? `Heading to ${THEMES[themeId]?.name || 'the park'}…` : 'Loading the park…');
  Crew.fetchCrew(app).catch(() => {}); // v0.4.5: the HQ door knows whether you have a crew
  setTimeout(() => {
    try {
      const hub = new ParkHub(app, themeId, ui);
      app.world = hub;
      app.mode = 'park';
      app.setController(hub, hub.scene);
      // v0.4.5: coming out of the Crew HQ, you step out of its door onto the plaza
      if (opts.at === 'hq' && hub.venue.hq) { hub.me.setPos(hub.venue.hq.x, hub.venue.hq.z + 0.3, 0); hub.rig.roamYaw = 0; hub.rig.snap(); hub.syncSquad(true); }
      // qp3: through the Event Park / Home Park hall, you step out of the hall's door in the other park
      if (opts.at === 'hall' && hub.venue.hall) { hub.me.setPos(hub.venue.hall.x, hub.venue.hall.z + 0.3, 0); hub.rig.roamYaw = 0; hub.rig.snap(); hub.syncSquad(true); }
      ui.intro(hub, opts);
      Online.touchWhere(app); // (online: the people here see you arrive, and you them)
    } catch (e) { console.error(e); toast(e.message, 'error'); Screens.go(app, 'home'); }
  }, 30);
}

// ---------------- v0.4.5 Crew HQ ----------------
// opts.online: the HQ of a friend's crew you play in online (v0.4.7.5 qp3: its members meet and run there)
export function enterHQ(app, from, opts = {}) {
  leaveWorld(app);
  const ui = new HQUI(app);
  $('#ui').innerHTML = ''; $('#ui').className = 'layer';
  ui.mount();
  toast('Loading the Crew HQ…');
  Crew.fetchCrew(app).catch(() => null).then(() => {
    const net = app.net, oc = net?.connected ? net.crew : null;
    const online = opts.online && oc && oc.founder !== net.myId;
    if (!online && !app.crew) { toast(opts.online ? 'You\'re not in that crew any more.' : 'Start a crew first.', 'error'); enterPark(app, from); return; }
    try {
      const hq = new CrewHQ(app, ui, from, online ? { online: oc } : {});
      app.world = hq;
      app.mode = 'park';
      app.setController(hq, hq.scene);
      ui.intro(hq);
      Online.touchWhere(app);
    } catch (e) { console.error(e); toast(e.message, 'error'); enterPark(app, from); }
  });
}

// v0.4.7.5: a small flame for streaks and a bounty seal for streaks above 6 (court overview, court icons, ticker)
const FLAME_SVG = '<svg viewBox="0 0 16 20" class="ic-flame" aria-hidden="true"><path d="M8 1c1 3.2 5 5.6 5 10.2A5 5 0 0 1 3 11.4C3 8.6 4.6 7 5.4 5.6 5.7 7.4 6.6 8.2 7.4 8.6 7 6 7.2 3.6 8 1Z" fill="currentColor"/><path d="M8 19a3 3 0 0 1-3-3c0-1.9 1.4-2.8 2-4.1.4 1.3 1.1 1.9 1.7 2.3.2-.9.6-1.6 1-2.1.9 1.1 1.3 2.3 1.3 3.9a3 3 0 0 1-3 3Z" fill="#fff6c9" opacity=".85"/></svg>';
const BOUNTY_SVG = '<svg viewBox="0 0 24 24" class="ic-bounty" aria-hidden="true"><path d="M12 1.5 14.6 4l3.5-.6.9 3.4 3.2 1.6-1.2 3.3 1.2 3.3-3.2 1.6-.9 3.4-3.5-.6L12 22.5 9.4 20l-3.5.6-.9-3.4-3.2-1.6L3 12.3 1.8 9l3.2-1.6.9-3.4 3.5.6Z" fill="currentColor"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="#1a1204" stroke-width="1.4"/><path d="M12.9 8.4v-.9h-1.6v.9c-1.2.3-2 1.1-2 2.2 0 1.4 1.2 1.9 2.4 2.2 1 .2 1.4.4 1.4.9s-.5.8-1.2.8c-.8 0-1.4-.4-1.6-1l-1.3.5c.3 1 1.1 1.6 2.3 1.8v.9h1.6v-.9c1.3-.3 2.1-1.1 2.1-2.3 0-1.4-1.1-1.9-2.5-2.2-.9-.2-1.3-.4-1.3-.8s.4-.7 1-.7c.7 0 1.1.3 1.3.8l1.3-.5c-.3-.8-1-1.4-1.9-1.6Z" fill="#1a1204"/></svg>';

class ParkUI {
  constructor(app) { this.app = app; this.lastPrompt = null; this.tagEls = new Map(); this.tagKey = new Map(); this.tickKey = null; this.tmpP = {}; }
  mount() {
    $('#ui').innerHTML = `<div class="park-top" id="park-top"></div><div class="court-tags" id="court-tags"></div>
      <div class="ov-head" id="ov-head" hidden><b>COURT OVERVIEW</b><span class="live-dot"></span><small>LIVE</small><em id="ov-hint"></em></div>
      <div class="gn-ticker" id="gn-ticker" hidden></div><div class="friend-tags" id="friend-tags"></div>`;
    this.tagEls = new Map(); this.tagKey = new Map(); this.tickKey = null; this.fTag = new Map();
  }
  // v0.4.7.5 qp3 online: the username over each real player walking around here (your squad's in gold)
  friendTags(hub) {
    const box = $('#friend-tags'); if (!box) return;
    // (Settings → Name tags hides these too)
    const ws = hub.peers && hub.mode === 'roam' && !hub.overview && settings.tags !== false ? hub.peers.list() : [];
    for (const [id, el] of this.fTag) if (!ws.some(w => w.id === id)) { el.remove(); this.fTag.delete(id); }
    for (const w of ws) {
      let el = this.fTag.get(w.id);
      if (!el) { el = document.createElement('div'); el.className = `friend-tag${w.squad ? ' sq' : ''}`; el.textContent = w.username || w.entry.name; box.appendChild(el); this.fTag.set(w.id, el); }
      const p = hub.r.project(this.app.camera, [w.p.x, (w.visual.view?.H || 1.95) + 0.3, w.p.z], this.tmpP);
      el.hidden = !p.visible || p.depth > 70 || !!w.visual.pending;
      if (!el.hidden) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
  // v0.4.7.5 the court overview (hold View / Share): the header, and every court's card (courtTags)
  overview(hub, on) {
    const h = $('#ov-head'); if (h) h.hidden = !on;
    const inp = this.app.input, hint = $('#ov-hint');
    if (hint) hint.textContent = `Release ${inp.usingPad ? padGlyph(inp.gp.family, 'VIEW') : 'V'} to go back`;
    document.body.classList.toggle('overview-on', on);
  }
  // court cards in the overview; while roaming, just the bounty seal over a court whose kings are above 6 straight
  courtTags(hub) {
    const box = $('#court-tags'); if (!box || !hub.courtInfo) return;
    const roam = hub.mode === 'roam', ov = roam && !!hub.overview, cam = this.app.camera, r = hub.r;
    for (const c of hub.courts) {
      let el = this.tagEls.get(c);
      if (!el) { el = document.createElement('div'); el.className = 'court-tag'; el.hidden = true; box.appendChild(el); this.tagEls.set(c, el); }
      const info = hub.courtInfo(c);
      const real = info.kings || info.people || info.claims?.length; // (online: real people on it, holding it, or with next)
      if (!roam || (!ov && !info.bounty && !real)) { el.hidden = true; continue; }
      const p = r.project(cam, [c.origin[0], ov ? 0.4 : 4.8, c.origin[2] + (c.full ? 0 : 6.5)], this.tmpP);
      if (!p.visible || (!ov && p.depth > 95)) { el.hidden = true; continue; }
      if (!ov) p.y = Math.max(96, p.y); // (a court in front of you keeps its seal on screen)
      else { const W = r.canvas.clientWidth; p.x = Math.min(W - 96, Math.max(96, p.x)); p.y = Math.max(150, p.y); } // (cards stay on screen)
      const key = (ov ? 'o' : 'r') + JSON.stringify(info);
      if (this.tagKey.get(c) !== key) {
        this.tagKey.set(c, key);
        el.className = `court-tag ${ov ? 'ov' : 'roam'}${info.bounty ? ' has-bounty' : ''}${info.next ? ' mine' : ''}`;
        el.innerHTML = ov ? overviewCard(info) : `${info.bounty ? `<div class="ct-seal">${BOUNTY_SVG}<div><b>BOUNTY +${money(info.bounty)} VC</b><small>${FLAME_SVG}${info.streak} straight · break it to collect</small></div></div>` : ''}${real ? realLine(info) : ''}`;
      }
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      el.hidden = false;
    }
  }
  // v0.4.7.5: the score of the game on the court you've got next on, bottom right
  ticker(hub) {
    const t = $('#gn-ticker'); if (!t || !hub.courtInfo) return;
    const my = hub.mode === 'roam' && !hub.overview ? hub.myLine() || hub.squadLine?.() : null;
    const info = my ? hub.courtInfo(my.c) : null;
    if (!info) { if (!t.hidden) { t.hidden = true; this.tickKey = null; } return; }
    const s = my.c.live || my.c.session, cols = s ? [s.teams?.[0]?.color || '#ffd84a', s.teams?.[1]?.color || '#ff5a36'] : ['#555', '#555'];
    const key = JSON.stringify([info, cols]);
    if (key === this.tickKey) return;
    this.tickKey = key;
    const names = s ? [s.teams?.[0]?.name || 'Kings', s.teams?.[1]?.name || 'Challengers'] : ['', ''];
    const lead = info.score ? (info.score[0] > info.score[1] ? 0 : info.score[1] > info.score[0] ? 1 : -1) : -1;
    t.innerHTML = `<div class="gt-head"><div><span>YOU'VE GOT NEXT ON</span><b>${esc(info.name.toUpperCase())}</b></div>${info.target ? `<em>GAME TO ${info.target}</em>` : ''}</div>
      ${info.score ? [0, 1].map(i => `<div class="gt-row ${lead === i ? 'lead' : ''}"><i style="--c:${cols[i]}"></i><span>${esc(names[i])}</span>${i === 0 && info.streak ? `<small>${FLAME_SVG}${info.streak}</small>` : ''}<b>${info.score[i]}</b></div>`).join('') : '<div class="gt-empty">Court\'s open · you\'re on as soon as your squad is set</div>'}
      <div class="gt-foot ${info.next === 'next' ? 'go' : ''}"><span>${info.next === 'next' ? 'YOU RUN NEXT' : info.next === 'after' ? 'UP AFTER THE OTHER SQUAD' : info.next === 'squad' ? 'YOUR SQUAD HAS NEXT' : 'FILL UP FIRST TO RUN NEXT'}</span>${info.bounty ? `<span class="gt-bounty">${BOUNTY_SVG}+${money(info.bounty)} VC</span>` : ''}</div>`;
    t.hidden = false;
  }
  // v0.4.5 the HQ building on the plaza: go in, or start a crew first
  openHQ(hub) {
    const app = this.app, net = app.net, oc = net?.connected ? net.crew : null;
    // v0.4.7.5 qp3: in a friend's crew online, its HQ is where its members meet (your own crew's HQ is still yours)
    if (oc && oc.founder !== net.myId) {
      if (!app.crew) { enterHQ(app, hub.themeId, { online: true }); return; }
      const card = modal(`<h2>Crew HQ</h2><div class="col gap"><button class="btn primary" data-on>${esc(oc.name)} [${esc(oc.tag)}] · online crew</button><button class="btn" data-mine>${esc(app.crew.name)} [${esc(app.crew.tag)}] · your crew</button></div>`);
      card.querySelector('[data-on]').onclick = () => { closeModal(); enterHQ(app, hub.themeId, { online: true }); };
      card.querySelector('[data-mine]').onclick = () => { closeModal(); enterHQ(app, hub.themeId); };
      return;
    }
    if (app.crew) { enterHQ(app, hub.themeId); return; }
    Crew.openCrew(app, { onChange: c => { if (c) toast(`Walk through the Crew HQ door to go in.`); } });
  }
  // v0.4.7.5 qp3: the Event Park hall takes you to the running event; at an event park, the Home Park hall takes you home
  openHall(hub) {
    const app = this.app;
    if (hub.venue.hall?.home) { const home = app.char()?.affiliation; if (home) enterPark(app, home, { at: 'hall' }); else toast('Pick your affiliation on the Park screen first.', 'error'); return; }
    const ev = activeEvent(app);
    if (!ev) { toast('No park event is running right now. The next one will open here.', 'error'); return; }
    if (hub.mySession || hub.mode === 'starting') { toast('Finish your game first.', 'error'); return; }
    enterPark(app, ev.id, { at: 'hall' });
  }
  intro(hub, opts = {}) {
    const c = this.app.char();
    $('#park-top').innerHTML = `<div class="park-badge" style="--c:${hub.aff.color}"><b>${esc(hub.venue.theme.name)}</b><small>${esc(hub.aff.name)}</small></div>
      <div class="park-rep"><span>${esc(c.rep.label)}</span><span class="bar rep-bar"><i style="width:${c.rep.next ? Math.round((c.rep.points - c.rep.floor) / (c.rep.next - c.rep.floor) * 100) : 100}%"></i></span></div>
      ${hub.cup ? `<div class="cup-chip" id="cup-chip" style="--c:${hub.event?.color || '#39ff88'}">${esc(hub.event?.name || 'Park event')}</div>` : ''}
      <div class="park-keys muted small" id="park-keys"></div>`;
    this.keysFor = null;
    if (opts.at !== 'hq') this.toast(hub.cup ? `Welcome to ${hub.event?.park || hub.venue.theme.name}. Every game is an ante-up — claim a GOT NEXT spot and name your stake.` : `Welcome to ${hub.venue.theme.name}. Find a Got Next circle by a court.`);
  }
  cupInfo(hub, st) {
    const el = $('#cup-chip'); if (!el) return;
    el.innerHTML = `<b>${st.me.rank ? '#' + st.me.rank : '—'}</b><small>${st.me.rank ? money(st.me.net) + ' VC' : 'not on the board yet'} · ends in ${cupTimeLeft(st)}</small>`;
  }
  pickAnte(hub, cb) { pickAnte(this.app, hub, cb); }
  toast(t, k) { toast(t, k); }
  update(hub) {
    const inp = this.app.input, pad = inp.usingPad;
    if (this.keysFor !== pad) {
      this.keysFor = pad;
      const k = $('#park-keys');
      if (k) k.innerHTML = pad
        ? `${padGlyph(inp.gp.family, 'LS')} move · ${padGlyph(inp.gp.family, 'RT')} sprint · ${padGlyph(inp.gp.family, 'RS')} look · hold ${padGlyph(inp.gp.family, 'VIEW')} courts · ${padGlyph(inp.gp.family, 'LB')}+${padGlyph(inp.gp.family, 'RB')} social · ${padGlyph(inp.gp.family, 'MENU')} menu`
        : '<kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · right-drag look · hold <kbd>V</kbd> courts · <kbd>O</kbd> social · <kbd>Esc</kbd> menu';
    }
    const p = hub.mode === 'roam' ? hub.prompt : '';
    if (p !== this.lastPrompt) { this.lastPrompt = p; $('#prompt').innerHTML = p ? `<div class="prompt">${p}</div>` : ''; }
    const top = $('#park-top'); if (top) top.hidden = hub.mode !== 'roam' || !!hub.overview;
    this.courtTags(hub);
    this.ticker(hub);
    this.friendTags(hub);
  }
  pause(hub) {
    const card = modal(`<h2>${esc(hub.venue.theme.name)}</h2><div class="col gap">
      <button class="btn primary" data-close>Resume</button>
      <button class="btn" data-store>VC Store</button>
      <button class="btn" data-inv>Inventory</button>
      <button class="btn" data-boosts>Boosts</button>
      <button class="btn" data-mp>MyPlayer</button>
      ${hub.cup ? `<button class="btn" data-cupboard>${esc(hub.event?.name || 'Event')} leaderboard</button>` : ''}
      <button class="btn" data-phone>Social (${this.app.input?.usingPad ? 'LB + RB' : 'O'})</button>
      <button class="btn" data-online>Play online with friends</button>
      <button class="btn" data-crew>Crew</button>
      <button class="btn" data-stats>Lifetime stats</button>
      <button class="btn" data-settings>Settings & controls</button>
      <button class="btn" data-bug>Report a bug (F8)</button>
      <button class="btn ghost" data-leave>Leave the park</button>
      ${Screens.LAUNCHED ? '<button class="btn ghost" data-exit>Quit to desktop</button>' : ''}</div>${Screens.volumeSliders()}`);
    Screens.bindVolume(card);
    card.querySelector('[data-leave]').onclick = () => { closeModal(); Screens.go(this.app, 'home'); };
    const ex = card.querySelector('[data-exit]'); if (ex) ex.onclick = () => { closeModal(); Screens.confirmQuit(); };
    card.querySelector('[data-store]').onclick = () => { closeModal(); this.openStore(hub); };
    card.querySelector('[data-inv]').onclick = () => { closeModal(); Screens.go(this.app, 'inventory', { returnPark: hub.themeId }); };
    card.querySelector('[data-boosts]').onclick = () => { closeModal(); this.openBoosts(hub); };
    card.querySelector('[data-mp]').onclick = () => { closeModal(); Screens.go(this.app, 'myplayer'); };
    card.querySelector('[data-stats]').onclick = () => { closeModal(); Stats.openStatsModal(this.app); };
    card.querySelector('[data-phone]').onclick = () => { closeModal(); Phone.openPhone(this.app); };
    card.querySelector('[data-online]').onclick = () => { closeModal(); Phone.openPhone(this.app, { tab: 'online' }); };
    card.querySelector('[data-crew]').onclick = () => { closeModal(); Crew.openCrew(this.app); };
    card.querySelector('[data-settings]').onclick = () => { closeModal(); Screens.openSettings(this.app); };
    card.querySelector('[data-bug]').onclick = () => { closeModal(); reportBug(this.app); };
    const cupB = card.querySelector('[data-cupboard]'); if (cupB) cupB.onclick = () => { closeModal(); openCupBoard(this.app); };
  }
  pauseGame(hub) {
    const s = hub.mySession; if (!s) return;
    s.paused = true;
    const card = modal(`<h2>Paused</h2><div class="col gap"><button class="btn primary" data-close>Resume</button><button class="btn" data-phone>Social</button><button class="btn" data-stats>Lifetime stats</button><button class="btn" data-controls>Controls</button><button class="btn" data-bug>Report a bug (F8)</button><button class="btn ghost" data-quit>Leave the game (forfeit)</button></div>${Screens.volumeSliders()}`);
    Screens.bindVolume(card);
    closeModal.onClose = () => { s.paused = false; };
    card.querySelector('[data-stats]').onclick = () => { s.paused = true; Stats.openStatsModal(this.app); closeModal.onClose = () => { s.paused = false; }; };
    card.querySelector('[data-phone]').onclick = () => { closeModal.onClose = null; Phone.openPhone(this.app, { onClose: () => { s.paused = false; } }); };
    card.querySelector('[data-controls]').onclick = () => { s.paused = true; modal(`<h2>Controls</h2>${Screens.controlsTable(this.app)}`, { wide: true }); closeModal.onClose = () => { s.paused = false; }; };
    card.querySelector('[data-quit]').onclick = () => { closeModal.onClose = null; closeModal(); hub.forfeitMyGame(); };
    card.querySelector('[data-bug]').onclick = () => { closeModal.onClose = null; closeModal(); s.paused = true; reportBug(this.app); closeModal.onClose = () => { s.paused = false; }; };
  }
  openStore(hub) { Screens.go(this.app, 'store', { returnPark: hub.themeId }); }
  openBoosts(hub) { Rewards.openBoosts(this.app); }
  openWheel(hub) { this.app.affColor = hub.aff.color; Rewards.openWheel(this.app, seg => hub.venue.wheel?.obj?.spinTo(seg)); }
  matchStarted(hub) { $('#prompt').innerHTML = ''; this.app.hud.show(true); }
  backToRoam(hub) { audio.setCrowd(0.1); music.duck(false); }
  results(hub, summary, result, won, actions) { showResults(this.app, summary, result, won, { park: true, ...actions }); }
}

// v0.4.7.5 qp3 online: the real people on a court, holding it, and with next on it
function realLine(i) {
  return `<div class="ct-real">${i.people ? `<span><i class="live-dot"></i>${esc(i.people)}${i.score && !i.teams?.[0] ? ` · ${i.score[0]}–${i.score[1]}` : ''}</span>` : ''}${i.kings ? `<span><b>KINGS</b> ${esc(i.kings)}</span>` : ''}${(i.claims || []).map(n => `<span><b>NEXT</b> ${esc(n)}</span>`).join('')}</div>`;
}

function overviewCard(i) {
  const score = i.score ? `<div class="ct-score"><span>${esc(i.teams[0])}</span><b>${i.score[0]}</b><i>–</i><b>${i.score[1]}</b><span>${esc(i.teams[1])}</span></div>` : `<div class="ct-open">${i.waiting ? 'NEXT GAME SOON' : 'OPEN COURT'}</div>`;
  const meta = [i.target ? `to ${i.target}` : '', i.over ? 'final' : '', i.waiting ? `${i.waiting} squad${i.waiting > 1 ? 's' : ''} on Got Next` : ''].filter(Boolean).join(' · ');
  return `<div class="ct-name">${esc(i.name.toUpperCase())}${i.live ? '<span class="live-dot"></span>' : ''}</div>${score}${meta ? `<div class="ct-meta">${meta}</div>` : ''}
    ${i.streak ? `<div class="ct-streak">${FLAME_SVG}${i.myStreak ? 'YOU: ' : ''}${i.streak} STRAIGHT</div>` : ''}
    ${i.bounty ? `<div class="ct-bounty">${BOUNTY_SVG}BOUNTY +${money(i.bounty)} VC</div>` : ''}
    ${i.kings || i.people || i.claims?.length ? realLine(i) : ''}
    ${i.next ? `<div class="ct-you">${i.next === 'next' ? 'YOU RUN NEXT' : i.next === 'after' ? 'YOU\'RE UP AFTER' : i.next === 'squad' ? 'YOUR SQUAD HAS NEXT' : 'YOUR GOT NEXT SPOT'}</div>` : ''}`;
}

// v0.4.5 the Crew HQ's overlay: the park's prompt and top bar, its own pause menu and the crew-run results
class HQUI extends ParkUI {
  intro(hq) {
    const cr = hq.crew, on = hq.onlineIds().length;
    $('#park-top').innerHTML = `<div class="park-badge crew-badge" style="${Crew.crewVars(cr)}"><b>${esc(cr.name)} <span class="crew-tag sm">${esc(cr.tag)}</span></b><small>Crew HQ · level ${cr.level.level}${hq.onlineCrew ? ' · online crew' : ` · ${on} member${on === 1 ? '' : 's'} on`}</small></div>
      <div class="park-keys muted small" id="park-keys"></div>`;
    this.keysFor = null;
    // (v0.4.7.5 qp3 online: the crew's real members meet here and run 5-on-5 together from the scorer's table)
    if (hq.onlineCrew) { this.toast(`Welcome to the ${cr.name} HQ. The crew members here run 5-on-5 from the scorer's table.`); return; }
    this.toast(on >= RUN_MIN ? `Welcome to the HQ. ${on} of your crew are here — run 5-on-5 from the scorer's table.` : `Welcome to the HQ. ${on ? `${on} of your crew ${on === 1 ? 'is' : 'are'} here.` : 'Nobody from the crew is on right now.'} 5-on-5 opens up when ${RUN_MIN} members are on${hq.placeKey() ? ', or with your crew mates who are here online' : ''}.`);
  }
  // v0.4.7.5 qp3 online: a run with the real crew members here: all of you together, or against each other
  pickRun(hq) {
    const real = hq.realHere();
    const card = modal(`<h2>Crew run · 5-on-5</h2><p class="muted">${esc(real.map(p => p.username).join(', '))} ${real.length > 1 ? 'are' : 'is'} here. Open spots go to your crew members who are on, then regulars. Crew runs are practice: nothing is paid.</p>
      <div class="col gap"><button class="btn primary" data-tog>Run together · against the next ones on</button><button class="btn" data-split>Run against each other</button></div>`);
    card.querySelector('[data-tog]').onclick = () => { closeModal(); hq.startOnlineRun(false); };
    card.querySelector('[data-split]').onclick = () => { closeModal(); hq.startOnlineRun(true); };
  }
  pause(hq) {
    const card = modal(`<h2>${esc(hq.crew.name)} · Crew HQ</h2><div class="col gap">
      <button class="btn primary" data-close>Resume</button>
      <button class="btn" data-crew>Crew menu</button>
      <button class="btn" data-phone>Social (${this.app.input?.usingPad ? 'LB + RB' : 'O'})</button>
      <button class="btn" data-online>Play online with friends</button>
      <button class="btn" data-stats>Lifetime stats</button>
      <button class="btn" data-settings>Settings & controls</button>
      <button class="btn" data-park>Back to the park</button>
      <button class="btn ghost" data-leave>Main menu</button>
      ${Screens.LAUNCHED ? '<button class="btn ghost" data-exit>Quit to desktop</button>' : ''}</div>${Screens.volumeSliders()}`);
    Screens.bindVolume(card);
    card.querySelector('[data-crew]').onclick = () => { closeModal(); this.openCrewMenu(hq); };
    card.querySelector('[data-phone]').onclick = () => { closeModal(); Phone.openPhone(this.app); };
    card.querySelector('[data-online]').onclick = () => { closeModal(); Phone.openPhone(this.app, { tab: 'online' }); };
    card.querySelector('[data-stats]').onclick = () => { closeModal(); Stats.openStatsModal(this.app); };
    card.querySelector('[data-settings]').onclick = () => { closeModal(); Screens.openSettings(this.app); };
    card.querySelector('[data-park]').onclick = () => { closeModal(); this.exit(hq); };
    card.querySelector('[data-leave]').onclick = () => { closeModal(); Screens.go(this.app, 'home'); };
    const ex = card.querySelector('[data-exit]'); if (ex) ex.onclick = () => { closeModal(); Screens.confirmQuit(); };
  }
  exit(hq) { enterPark(this.app, hq.from || this.app.char()?.affiliation || 'harbor', { at: 'hq' }); }
  openCrewMenu(hq) {
    if (hq.onlineCrew) { Phone.openPhone(this.app, { tab: 'online' }); return; } // (a friend's crew: its members in the Online tab)
    Crew.openCrew(this.app, { onChange: c => { if (!c) return; hq.crew = c; hq.syncT = 0.5; hq.refreshBoards(); Online.crewSync(this.app); } });
  }
  backToRoam() { audio.setCrowd(0); music.duck(false); }
  async runResults(hq, summary, session, won, opts = {}) {
    const app = this.app, me = summary.me.stats;
    await playOutro(app, { summary, session, result: null, practice: true });
    const pct = (a, b) => `${a}/${b}`;
    const on = opts.online ? (opts.again ? RUN_MIN : 0) : hq.onlineIds().length;
    const card = modal(`<div class="results ${won ? 'win' : 'loss'}">
      <div class="eyebrow">CREW HQ · 5-ON-5 · FINAL</div>
      <h1>${won ? 'Victory' : 'Defeat'} <span class="score">${summary.score[summary.me.team]}–${summary.score[1 - summary.me.team]}</span></h1>
      <div class="stat-strip">${[['PTS', me.pts], ['REB', me.reb], ['AST', me.ast], ['STL', me.stl], ['BLK', me.blk], ['FG', pct(me.fgm, me.fga)], ['3PT', pct(me.tpm, me.tpa)], ['TO', me.tov]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div>
      <p class="muted">Crew runs in the HQ are practice: they don't pay VC, Rep or crew XP. Your crew levels up from the games you play in the park, the Cup and Pro-Am, and from your members' games.</p>
      <div class="row gap end"><button class="btn ghost" data-back>Back to the HQ</button><button class="btn primary" data-again ${on >= RUN_MIN ? '' : 'disabled'}>${on >= RUN_MIN ? 'Run it back' : opts.online ? 'Run it back (nobody else here)' : `Run it back (needs ${RUN_MIN} on)`}</button></div>
    </div>`, { close: false, cls: 'results-card' });
    card.querySelector('[data-back]').onclick = () => { closeModal(); hq.endRun(false); };
    card.querySelector('[data-again]').onclick = () => { closeModal(); hq.endRun(true); };
    if (won) audio.ui('buy');
  }
}

// ---------------- Results ----------------
// v0.4.8.5 qp8: how long a results screen waits before it moves on by itself, in every mode. The regular screen: 10
// seconds. One with news to read (a build slot opened, a new Hall of Fame badge or Icon badge, the cards for a max OVR
// or an Icon Legend OVR increase): 30 seconds. They used to wait for a press forever, so a player who'd stepped away
// came back to a game stuck on the results.
export const RESULTS_AUTO_SECS = 10, RESULTS_NEWS_SECS = 30;
// a countdown on a button ("Continue · 30"): clicks it when it runs out. Returns stop(); it stops by itself if the
// button leaves the page
export function autoPress(btn, secs, onFire = null) {
  if (!btn) return () => {};
  let left = secs, h = null;
  const label = btn.textContent;
  const stop = () => { if (h) { clearInterval(h); h = null; } };
  const tick = () => { if (!btn.isConnected) return stop(); btn.textContent = `${label} · ${left}`; if (left-- <= 0) { stop(); onFire?.(); btn.click(); } };
  tick(); h = setInterval(tick, 1000);
  return stop;
}
// (a card shown before the results: its Continue moves on by itself after RESULTS_NEWS_SECS)
function autoCard(card, next) {
  const btn = card.querySelector('[data-ok]');
  const stop = autoPress(btn, RESULTS_NEWS_SECS);
  btn.onclick = () => { stop(); closeModal(); next(); };
}

// v0.4.7.5: every third Pro Run game played raises the build's max OVR by 1 (80 -> 90). A small card says so
// right after the game, before the results.
function maxOvrUnlocked(app, u, character, next) {
  const per = app.config.badge_rules?.prorun_games_per_ovr ?? 3, top = app.config.badge_rules?.ovr_cap ?? 90;
  const card = modal(`<div class="ovr-unlock"><div class="eyebrow">THE PRO RUN · ${character?.prorun_completed ?? per * (u.to - 80)} GAMES PLAYED</div>
    <h2>+${u.to - u.from} MAX OVR Unlocked!</h2>
    <div class="ou-nums"><span>${u.from}</span><i>→</i><b>${u.to}</b></div>
    <p class="muted">You can now upgrade your player to ${u.to} OVR with VC. ${u.to >= top ? `That's the full ${top}: <b>cap breakers are unlocked</b>, and any you've banked are ready to place in MyPlayer → Attributes → Cap Breakers.` : `${per} more Pro Run games for the next +1 (up to ${top}).`}</p>
    <div class="row gap"><button class="btn primary" data-ok>Continue</button></div></div>`, { close: false, cls: 'ovr-unlock-card' });
  audio.ui('buy');
  autoCard(card, next); // (qp8: moves on by itself after 30 s)
}

// v0.4.7.5 quick patch, Icon Legend: with the Icon badge, every 2 Pro Run games are +1 OVR (to 99), placed for you
function legendUnlocked(app, u, character, next) {
  const per = app.config.badge_rules?.legend_games_per_ovr ?? 2, cap = app.config.badge_rules?.legend_ovr_cap ?? 99;
  const rows = Object.entries(u.changes || {}).sort((a, b) => b[1] - a[1]);
  const card = modal(`<div class="ovr-unlock legend"><div class="eyebrow">ICON LEGEND · ${u.games} PRO RUN GAME${u.games === 1 ? '' : 'S'} SINCE YOUR ICON BADGE</div>
    <h2>+${u.to - u.from} OVR!</h2>
    <div class="ou-nums"><span>${u.from}</span><i>→</i><b>${u.to}</b></div>
    <div class="lu-attrs">${rows.map(([k, n]) => `<span><b>+${n}</b> ${esc(ATTR_LABEL[k] || k)} <small>${character?.attributes?.[k] ?? ''}</small></span>`).join('')}</div>
    <p class="muted">Placed by your build on what it leans on${u.to >= cap ? `. That's ${cap}: <b>fully grinded</b>.` : `. ${per} more Pro Run games for the next +1 (up to ${cap}).`}</p>
    <div class="row gap"><button class="btn primary" data-ok>Continue</button></div></div>`, { close: false, cls: 'ovr-unlock-card' });
  audio.ui('buy');
  autoCard(card, next); // (qp8: moves on by itself after 30 s)
}

export function showResults(app, summary, result, won, opts = {}) {
  if (result?.max_ovr_unlocked && !opts.ovrShown) return maxOvrUnlocked(app, result.max_ovr_unlocked, result.character, () => showResults(app, summary, result, won, { ...opts, ovrShown: true }));
  if (result?.legend_ovr && !opts.legendShown) return legendUnlocked(app, result.legend_ovr, result.character, () => showResults(app, summary, result, won, { ...opts, legendShown: true }));
  const me = summary.me.stats;
  const r = result;
  const pct = (a, b) => b ? `${a}/${b}` : '0/0';
  const repBefore = r?.rep_before, repAfter = r?.rep_after;
  const repPct = repAfter && repAfter.next ? Math.round((repAfter.points - repAfter.floor) / (repAfter.next - repAfter.floor) * 100) : 100;
  const lg = opts.grade || app.lastGrade; app.lastGrade = null;
  const pro = summary.mode === 'prorun'; // v0.4.5 The Pro Run: 1.5x VC and badge progress, no Rep
  const card = modal(`
    <div class="results ${won ? 'win' : 'loss'}">
      <div class="eyebrow">${r?.cup ? esc(eventName(r.cup.event).toUpperCase()) + ' · ANTE-UP' : summary.mode === 'park' ? 'PARK GAME' : summary.mode === 'proam' ? 'PRO-AM' : pro ? 'THE PRO RUN' : 'GAME'} · FINAL</div>
      <h1>${won ? 'Victory' : 'Defeat'} <span class="score">${summary.score[summary.me.team]}–${summary.score[1 - summary.me.team]}</span></h1>
      ${lg ? `<div class="lg-final" data-tier="${lg.tier}"><small>LOCKED-IN GRADE</small><b>${esc(lg.letter)}</b><span class="muted small">${lg.good} smart plays · ${lg.bad} costly ones</span></div>` : ''}
      <div class="stat-strip">${[['PTS', me.pts], ['REB', me.reb], ['AST', me.ast], ['STL', me.stl], ['BLK', me.blk], ['FG', pct(me.fgm, me.fga)], ['3PT', pct(me.tpm, me.tpa)], ['TO', me.tov]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div>
      ${r?.cup ? `<div class="cup-result ${won ? 'win' : 'loss'}">${won ? `<b>POT +${money(r.cup.pot)} VC</b><small>your ${money(r.cup.ante)} stake back + theirs${r.streak_mult > 1 ? ` ×${r.streak_mult.toFixed(2)}` : ''}</small>` : `<b>ANTE LOST −${money(r.cup.ante)} VC</b><small>the stake goes to the other side</small>`}<span>${esc(eventName(r.cup.event))}: <b>#${r.cup.rank}</b> of ${r.cup.field} · ${r.cup.net < 0 ? '−' : ''}${money(Math.abs(r.cup.net))} VC this event</span></div>` : ''}
      ${r?.bounty ? `<div class="bounty-result">${BOUNTY_SVG}<div><b>BOUNTY CLAIMED +${money(r.bounty)} VC</b><small>You broke the kings' streak (included in VC earned)</small></div></div>` : ''}
      ${opts.online && opts.note ? `<div class="muted small">${esc(opts.note)}</div>` : ''}
      ${r ? `<div class="reward-row"><div class="reward"><b>+${money(r.vc)}</b><small>VC EARNED</small></div>${pro ? '<div class="reward"><b>×1.5</b><small>VC & BADGE PROGRESS</small></div>' : `<div class="reward"><b>+${money(r.rep)}</b><small>REP</small></div>`}${summary.mode === 'park' ? `<div class="reward"><b>${r.streak}</b><small>WIN STREAK</small></div>` : ''}${summary.mode === 'park' && r.streak_mult > 1 ? `<div class="reward"><b>×${r.streak_mult.toFixed(2)}</b><small>STREAK BONUS</small></div>` : ''}${r.proam_rank ? `<div class="reward rp ${r.proam_rank.delta < 0 ? 'neg' : ''}"><b>${signed(r.proam_rank.delta)}<i> RP</i></b><small>${esc(r.proam_rank.rank_after.name.toUpperCase())}</small></div>` : ''}${r.proam_team ? `<div class="reward"><b>${r.proam_team.wins}-${r.proam_team.losses}</b><small>TEAM RECORD</small></div>` : ''}</div>
        ${rankResult(r.proam_rank)}
        ${pro ? '' : `<div class="rep-line"><span>${esc(repAfter.label)}</span>${repBefore.level !== repAfter.level ? '<span class="tag hot">RANK UP!</span>' : ''}<span class="muted">${money(repAfter.points)} REP</span></div><span class="bar rep-bar"><i style="width:${repPct}%"></i></span>`}
        ${r.crew ? `<div class="crew-xp" style="${Crew.crewVars({ color: app.crew?.color || '#ff4d24' })}"><span class="crew-tag sm">${esc(r.crew.tag)}</span><b>+${money(r.crew.xp)} CREW XP</b>${r.crew.with_crew ? '<span class="tag hot">×2 WITH CREW</span>' : ''}<span class="muted small">${esc(r.crew.name)} · Level ${r.crew.level_after}${r.crew.next ? ` · ${money(r.crew.next - r.crew.total)} to level ${r.crew.level_after + 1}` : ''}</span>${r.crew.level_after > r.crew.level_before ? '<span class="tag hot">CREW LEVEL UP!</span>' : ''}</div>` : ''}
        ${r.badges_upgraded.length ? `<div class="badge-ups">${r.badges_upgraded.map(b => `<span class="tag badge-up ${['', 'bronze', 'silver', 'gold', 'hof'][b.tier]}">${badgeSVG(b.id, b.tier, 22)}${esc(b.name)} · ${TIER[b.tier]}</span>`).join('')}</div>` : ''}
        ${Object.keys(r.badge_progress || {}).length ? `<div class="muted small">Badge progress: ${Object.entries(r.badge_progress).slice(0, 6).map(([k, v]) => `${esc(app.config.badges[k]?.name || k)} +${v}`).join(' · ')}</div>` : ''}` : '<p class="muted">This result was not recorded (see message).</p>'}
      ${peopleRow(app, opts.players)}
      <div class="row gap end">${opts.online && opts.park ? (opts.stay ? '<button class="btn ghost" data-leave>Leave court</button><button class="btn primary" data-stay>Run it back (stay on)</button>' : opts.back ? '<button class="btn ghost" data-leave>Leave court</button><button class="btn primary" data-back>Stay with your squad</button>' : '<button class="btn primary" data-leave>Back to the park</button>') : opts.park ? (won ? '<button class="btn ghost" data-leave>Leave court</button><button class="btn primary" data-stay>Run it back (stay on)</button>' : '<button class="btn primary" data-leave>Back to the park</button>') : `${r?.max_ovr_unlocked ? '<button class="btn ghost" data-upgrade>Upgrade attributes</button>' : ''}<button class="btn ghost" data-menu>${opts.menuLabel || 'Main menu'}</button>${opts.again ? `<button class="btn primary" data-again>${esc(opts.againLabel || 'Play again')}</button>` : ''}`}</div>
    </div>`, { close: false, cls: 'results-card' });
  // v0.4.5: a new Hall of Fame badge opens the cap breaker menu before moving on (v0.4.7.5: only once cap breakers
  // are unlocked at 90 max OVR; until then they're banked in MyPlayer → Attributes → Cap Breakers)
  const hof = r && (r.cap_breakers_awarded > 0 || r.icon_unlocked);
  const cbOpen = !!(r?.character?.cap_breakers_unlocked);
  // qp3: the items an Icon badge brings (the Hash-Slinging dunk package) are in the inventory and equipped already
  if (r?.icon_items?.length && app.profile?.inventory) for (const id of r.icon_items) if (!app.profile.inventory.includes(id)) app.profile.inventory.push(id);
  const iconItems = (r?.icon_items || []).map(id => app.catalog?.[id]?.name).filter(Boolean);
  // v0.4.8.5 qp7: the game that made this build an ICON opened a build slot on the account (none past 8): said here too
  const slotUp = r?.build_slot_unlocked;
  const slotNote = slotUp ? `<div class="slot-unlock"><span class="icon-status">ICON</span><b>${esc(slotOpenedText(slotUp))}</b><span class="muted small">${slotUp.slot < slotUp.max ? `Make another build an ICON for the next one, up to ${slotUp.max}.` : 'That\'s every slot an account can have.'} Create the new player in MyPlayer → Players.</span></div>` : '';
  if (hof || slotUp) card.querySelector('.results .row.end')?.insertAdjacentHTML('beforebegin', `<div class="hof-note">${r.icon_unlocked ? `<div class="icon-unlock">${iconBadgeSVG(r.icon_unlocked, 56)}<b>Icon badge unlocked: ${esc(app.config.icon_badges?.[r.icon_unlocked]?.name || r.icon_unlocked)}</b>${iconItems.length ? `<span class="muted small">${esc(iconItems.join(', '))} — yours, and equipped</span>` : ''}</div>` : ''}${r.cap_breakers_awarded ? `<b>+${r.cap_breakers_awarded} cap breakers</b> for a new Hall of Fame badge${cbOpen ? '' : ` · banked until your max OVR reaches ${app.config.badge_rules?.ovr_cap ?? 90}`}` : ''}${slotNote}</div>`);
  let stopCountdown = () => {}, autoFired = false;
  // (qp8: when the screen moves on by itself, new cap breakers stay banked instead of opening their menu over the next
  // game; a toast says where they are)
  const on = (sel, f) => { const b = card.querySelector(sel); if (b) b.onclick = () => {
    stopCountdown(); closeModal();
    if (hof && r.cap_breakers_awarded && cbOpen && MyPlayer.openCapBreakers && !autoFired) MyPlayer.openCapBreakers(app, f);
    else { if (autoFired && hof && r.cap_breakers_awarded && cbOpen) toast(`+${r.cap_breakers_awarded} cap breakers banked: place them in MyPlayer → Attributes → Cap Breakers.`, 'good'); f(); }
  }; };
  on('[data-upgrade]', () => Screens.go(app, 'myplayer', { tab: 'attributes' }));
  on('[data-stay]', () => opts.stay && opts.stay());
  on('[data-back]', () => opts.back && opts.back());
  on('[data-leave]', () => opts.leave && opts.leave());
  on('[data-menu]', () => opts.menu ? opts.menu() : Screens.go(app, 'home'));
  on('[data-again]', () => opts.again && opts.again());
  // v0.4.5: in the park the screen moves on by itself after 10 seconds (run it back after a win, back to the
  // park after a loss), unless you're placing new cap breakers or adding someone as a friend
  // v0.4.8.5: Pro-Am and the Pro Run do the same: the next game starts by itself after 10 seconds (back to the menu
  // when there's no next game to play, like the draft after the third college game, or a squad mate's online game)
  // (qp7 kept a screen that opened a build slot, and qp3-on a new Hall of Fame or Icon badge, up until it was pressed.
  // qp8: every mode moves on by itself: 10 seconds for the regular screen, 30 when it has that news to read)
  const news = !!(hof || slotUp);
  const auto = opts.park ? card.querySelector(won && (!opts.online || opts.stay) ? '[data-stay]' : opts.back ? '[data-back]' : '[data-leave]')
    : opts.autoNext ? card.querySelector('[data-again]') || card.querySelector('[data-menu]') : null;
  if (auto) {
    stopCountdown = autoPress(auto, news ? RESULTS_NEWS_SECS : RESULTS_AUTO_SECS, () => { autoFired = true; });
    const prevClose = closeModal.onClose; closeModal.onClose = () => { stopCountdown(); if (prevClose) prevClose(); };
  }
  card.querySelectorAll('[data-addf]').forEach(b => b.onclick = () => {
    stopCountdown(); const id = b.dataset.addf; if (app.ai.addFriend(id)) { b.classList.add('on'); b.disabled = true; b.innerHTML = `★ ${esc(app.ai.entry(id).name)}`; toast(`${app.ai.entry(id).name} added to your friends.`); } });
  if (won) audio.ui('buy');
}

// v0.4.4: add the people you just played with (teammates first)
function peopleRow(app, players) {
  const w = app.ai, list = (players || []).filter(e => e?.aiId);
  if (!w || !list.length) return '';
  return `<div class="res-people"><div class="muted small">Liked playing with someone? Add him and invite him to your squad from the social phone.</div>
    <div class="chips">${list.map(e => w.isFriend(e.aiId) ? `<button class="chip on" disabled>★ ${esc(e.name)}</button>` : `<button class="chip" data-addf="${e.aiId}">+ ${esc(e.name)} <small>${e.build.overall} ${esc(e.build.position)}</small></button>`).join('')}</div></div>`;
}

// ---------------- Pro-Am ----------------
const COLORS = ['#2457c5', '#c8322f', '#1f7a4d', '#7a2bd1', '#f2c14e', '#e8590c', '#111111', '#f4f2ec', '#0d8a8f', '#d63384', '#3b5873', '#8a5a2b'];
export function proam(app, root) {
  const c = app.char();
  const t = structuredClone(app.profile.proam_team || { name: `${c.name.split(' ')[0]} Squad`, abbr: c.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'AHS', primary: '#2457c5', secondary: '#f2c14e', logo: 'bolt', wood: 'natural', roster_seed: (hashString(c.id) % 1e6) + 1, wins: 0, losses: 0 });
  const draw = () => {
    const roster = proamRoster(app, t);
    root.innerHTML = `<section class="panel wide-panel proam">
      <div class="eyebrow">PRO-AM · 5V5 · RIMRIFT ARENA</div><h1>${esc(t.name || 'Your team')}</h1>
      ${rankCard(c)}
      <div class="proam-cols">
        <div><h4>Team identity</h4>
          <div class="row gap"><input class="text" maxlength="22" value="${esc(t.name)}" data-f="name" placeholder="Team name"><input class="text abbr" maxlength="4" value="${esc(t.abbr)}" data-f="abbr" placeholder="ABBR"></div>
          <span class="muted small">Primary</span><div class="swatches">${COLORS.map(v => `<button class="sw ${t.primary === v ? 'on' : ''}" style="--v:${v}" data-c="primary" data-val="${v}"></button>`).join('')}</div>
          <span class="muted small">Secondary</span><div class="swatches">${COLORS.map(v => `<button class="sw ${t.secondary === v ? 'on' : ''}" style="--v:${v}" data-c="secondary" data-val="${v}"></button>`).join('')}</div>
          <span class="muted small">Logo</span><div class="chips">${app.config.logos.map(l => `<button class="chip ${t.logo === l ? 'on' : ''}" data-logo="${l}">${title(l)}</button>`).join('')}</div>
          <span class="muted small">Home floor</span><div class="chips">${app.config.woods.map(w => `<button class="chip ${t.wood === w ? 'on' : ''}" data-wood="${w}">${title(w)}</button>`).join('')}</div>
          <div class="row gap"><button class="btn" data-save>Save team</button><span class="muted small">Record ${t.wins || 0}-${t.losses || 0}</span></div>
        </div>
        <div><h4>Roster</h4><div class="roster">${roster.map((e, i) => `<div class="roster-row ${i === 0 ? 'me' : ''}"><b>${e.build.overall ?? c.overall}</b><span>${esc(e.name)}${e.aiId && app.ai.inSquad(e.aiId) ? ' <em class="tag sq">SQUAD</em>' : e.aiId && app.ai.isFriend(e.aiId) ? ' <em class="tag fr">FRIEND</em>' : ''}<small>${e.build.position} · ${archHTML(e.build)}${e.tierLabel ? ' · ' + esc(e.tierLabel) : ''}</small></span></div>`).join('')}</div>
          <p class="muted small">Your squad suits up with you; open spots go to regulars who fit the position.</p>
          ${onlineSquadNote(app)}
          <div class="row gap"><button class="btn ghost" data-resign>Sign new teammates</button><button class="btn ghost" data-phone>Squad & friends</button></div>
          <h4>Game settings</h4>
          <div class="row gap"><label class="muted small">Quarter length <select data-ql>${[[120, '2 min'], [180, '3 min'], [300, '5 min']].map(([v, l]) => `<option value="${v}" ${settings.quarterLen === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        </div>
      </div>
      <div class="row gap end"><button class="btn primary big" data-play>Play Pro-Am game</button></div></section>`;
    $$('[data-f]', root).forEach(i => i.oninput = () => { t[i.dataset.f] = i.value; });
    $$('[data-c]', root).forEach(b => b.onclick = () => { t[b.dataset.c] = b.dataset.val; draw(); });
    $$('[data-logo]', root).forEach(b => b.onclick = () => { t.logo = b.dataset.logo; draw(); });
    $$('[data-wood]', root).forEach(b => b.onclick = () => { t.wood = b.dataset.wood; draw(); });
    $('[data-ql]', root).onchange = e => { settings.quarterLen = +e.target.value; saveSettings(); };
    $('[data-resign]', root).onclick = () => { t.roster_seed = (Math.random() * 1e9 | 0) + 1; draw(); };
    $('[data-phone]', root).onclick = () => Phone.openPhone(app, { tab: 'squad', onClose: () => { if (document.body.contains(root)) draw(); } });
    $('[data-save]', root).onclick = () => saveTeam(app, t);
    $('[data-play]', root).onclick = async () => {
      // v0.4.7.5 qp3 online: with friends in your squad, the game is theirs too (the leader starts it)
      const net = app.net, mates = net?.connected ? Online.freeSquad(app) : [];
      if (mates.length && !net.isLeader()) { toast('Your squad leader starts Pro-Am games: you suit up when he does.', 'error'); return; }
      if (await saveTeam(app, t)) { if (mates.length) startProAmOnline(app); else playProAm(app); }
    };
    const ch = root.querySelector('[data-pachal]'); if (ch) ch.onclick = () => Phone.openPhone(app, { tab: 'online' });
  };
  draw();
  app.showroom.setAccent(t.primary);
}

// v0.4.8.5: the build's Pro-Am rank: its emblem, RP and the way to the next rank, the ladder, its own Pro-Am record,
// and the friends rule
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;
function rankCard(c) {
  const rk = rankOf(rpOf(c)), pa = c.progression?.proam || {}, g = pa.games || 0, w = pa.wins || 0, last = pa.last;
  const next = rk.next != null ? RANKS[rk.tier + 1] : null;
  const lo = RANKS[Math.max(0, rk.tier - RANK_SPAN)].name, hi = RANKS[Math.min(RANKS.length - 1, rk.tier + RANK_SPAN)].name;
  return `<div class="pa-rank r${rk.tier}" style="--rc:${rk.color};--rd:${rk.dark}">
      ${rankEmblemSVG(rk, 84)}
      <div class="pa-rank-main">
        <div class="pa-rank-k">PRO-AM RANK · THIS PLAYER</div>
        <div class="pa-rank-name"><b>${esc(rk.name)}</b><span>${money(rk.rp)} RP</span>${last?.delta ? `<em class="${last.delta > 0 ? 'up' : 'down'}">${signed(last.delta)} ${last.kind === 'game' ? 'last game' : 'forfeit'}</em>` : ''}</div>
        <span class="bar pa-rank-bar"><i style="width:${Math.round(rk.pct * 100)}%"></i></span>
        <div class="pa-rank-sub">${next ? `<span><b>${money(rk.toNext)}</b> RP to ${esc(next.name)}</span>` : '<span><b>Top rank</b></span>'}<span>Best <b>${money(Math.max(pa.best_rp || 0, rk.rp))}</b> RP</span><span>Pro-Am record <b>${w}-${g - w}</b></span></div>
      </div>
      <div class="pa-ladder">${RANKS.map((r, i) => `<span class="${i === rk.tier ? 'on' : i < rk.tier ? 'past' : ''}" title="${esc(r.name)} · ${money(r.floor)} RP">${rankEmblemSVG(i, 26)}</span>`).join('')}</div>
    </div>
    <p class="muted small pa-rank-rule">Every game moves your RP: the win or loss, how strong the other team was, and how you played. Friends run Pro-Am together within ${RANK_SPAN} ranks of each other: as ${esc(rk.name)}, with ${esc(lo)} through ${esc(hi)}.</p>`;
}
// the results screen's RP block: change, rank, breakdown, and a banner when the rank changed
function rankResult(pr) {
  if (!pr) return '';
  const ra = pr.rank_after, rk = rankOf(pr.rp_after), p = pr.parts || {};
  const parts = [['Result', p.result], ['Competition', p.competition], ['Performance', p.performance]];
  if (p.adjust) parts.push([pr.rp_after === 0 && pr.delta < 0 ? 'RP floor' : pr.delta > 0 ? 'Win minimum' : 'Loss limit', p.adjust]);
  const line = 'forfeit' in p ? `Forfeit ${signed(p.forfeit)}` : parts.map(([k, v]) => `${k} <b>${signed(v || 0)}</b>`).join(' · ');
  const banner = pr.promoted ? `<div class="rank-banner up">${rankEmblemSVG(ra, 34)}<b>PROMOTED TO ${esc(ra.name.toUpperCase())}</b></div>`
    : pr.demoted ? `<div class="rank-banner down">${rankEmblemSVG(ra, 34)}<b>DEMOTED TO ${esc(ra.name.toUpperCase())}</b></div>` : '';
  return `${banner}<div class="rp-line" style="--rc:${rk.color};--rd:${rk.dark}">${rankEmblemSVG(rk, 40)}<div class="rp-main"><div class="rp-top"><b>${esc(ra.name)}</b><span class="muted">${money(pr.rp_after)} RP${rk.next != null ? ` · ${money(rk.toNext)} to ${esc(RANKS[rk.tier + 1].name)}` : ''}</span></div>
    <span class="bar pa-rank-bar"><i style="width:${Math.round(rk.pct * 100)}%"></i></span><div class="rp-parts muted small">${line}</div></div></div>`;
}

async function saveTeam(app, t) {
  try {
    const res = await app.api.mutate('/api/proam/team', { team: { name: t.name, abbr: t.abbr, primary: t.primary, secondary: t.secondary, logo: t.logo, wood: t.wood, roster_seed: t.roster_seed } });
    app.profile.proam_team = res.team; toast('Team saved.'); return true;
  } catch (e) { toast(e.message, 'error'); return false; }
}

// v0.4.4: your squad suits up with you; open spots go to regulars from your AI world who fit the position
// (the same guys tend to come back for your team)
function proamRoster(app, t) {
  const c = app.char(), w = app.ai;
  const order = ['PG', 'SG', 'SF', 'PF', 'C'];
  const mine = { build: { ...c }, name: c.name, human: true, look: null, badges: badgeTiers(c) };
  const squad = w.activeSquad().slice(0, 4).map(id => w.gameEntry(id));
  const open = order.filter(p => p !== c.position);
  for (const e of squad) { const i = open.indexOf(e.build.position); open.splice(i >= 0 ? i : open.length - 1, 1); }
  const used = new Set(squad.map(e => e.aiId));
  const level = 0.62 + Math.min(0.25, (t.wins || 0) * 0.01);
  const fill = open.slice(0, 4 - squad.length).map(position => { const id = w.pick({ position, level, exclude: used, key: 'proam' + t.roster_seed }); used.add(id); return w.gameEntry(id); });
  return [mine, ...squad, ...fill];
}
function proamOpponents(app, level, seed) {
  const w = app.ai, used = new Set([...w.squad]);
  return ['PG', 'SG', 'SF', 'PF', 'C'].map(position => { const id = w.pick({ position, level, exclude: used, key: 'opp' + seed }); used.add(id); return w.gameEntry(id); });
}

const WOOD_TONES = { natural: [0.82, 0.6, 0.38], blonde: [0.9, 0.72, 0.5], dark: [0.55, 0.36, 0.22] };
export async function playProAm(app) {
  const c = app.char(), t = app.profile.proam_team;
  // (v0.4.8.5: the AI team's strength, on the RP scale, goes with the ticket: the server pays RP against it)
  const level = Math.min(0.95, 0.55 + ((t.wins || 0) - (t.losses || 0) * 0.5) * 0.02 + settings.difficulty * 0.1);
  let ticket;
  try { ticket = await app.api.mutate('/api/matches', { character_id: c.id, mode: 'proam', venue: 'arena', format: 5, quarter_len: settings.quarterLen, difficulty: settings.difficulty, opp_rating: levelRating(level) }); }
  catch (e) { toast(e.message, 'error'); return; }
  leaveWorld(app);
  $('#ui').innerHTML = ''; $('#ui').className = 'layer';
  const scene = new Scene();
  const venue = buildVenue(app.renderer, scene, 'arena', { team: { name: t.name, abbr: t.abbr, primary: t.primary, secondary: t.secondary, logo: t.logo, wood: WOOD_TONES[t.wood] } });
  const roster = proamRoster(app, t);
  roster[0].build = boostedBuild(roster[0].build, ticket.meta.boosts);
  Rewards.consumeBoostsLocal(app, ticket);
  const uniform = (primary, secondary, abbr) => ({ top: { family: 'jersey', color: primary, trim: secondary, secondary, pattern: 'panel', lettering: abbr, tucked: true }, bottom: { family: 'shorts', color: primary, trim: secondary, stripe: secondary } });
  const rng = new RNG(ticket.seed);
  const oppNames = ['Night Owls', 'Iron Lungs', 'Crosstown', 'Lakeside', 'Hi-Tops', 'Concrete', 'Skyline', 'Bridge City', 'Full Court', 'Old School'];
  const oppColors = [['#c8322f', '#111111'], ['#1f7a4d', '#f4f2ec'], ['#e8590c', '#1d1f24'], ['#3b5873', '#f2c14e'], ['#7a2bd1', '#f4f2ec']];
  // opponents wear colours that contrast with ours
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const cdist = (a, b) => { const A = rgb(a), B = rgb(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  const usable = oppColors.filter(([a]) => cdist(a, t.primary) > 150 && cdist(a, t.secondary || '#ffffff') > 90);
  const [op1, op2] = rng.pick(usable.length ? usable : oppColors.filter(([a]) => a !== t.primary));
  const oppName = rng.pick(oppNames);
  const caps = oppName.replace(/[^A-Z]/g, '');
  const oppAbbr = caps.length >= 2 ? caps.slice(0, 3) : oppName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  const opp = proamOpponents(app, level, ticket.seed);
  const myU = uniform(t.primary, t.secondary, t.abbr), opU = uniform(op1, op2, oppAbbr);
  roster.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, app.catalog, { ...myU, number: e.build.appearance?.number ?? (i * 7 + 3) % 50, name: e.name }); });
  opp.forEach((e, i) => { e.look = resolveLook(e.build, app.catalog, { ...opU, number: e.build.appearance?.number, name: e.name }); });
  const teams = [{ name: t.name, abbr: t.abbr, color: t.primary }, { name: oppName, abbr: oppAbbr, color: op1 }];
  const session = new MatchSession(app, {
    mode: 'proam', scene, venue, court: venue.courts[0], rosters: [roster, opp], teams, seed: ticket.seed, quarterLen: ticket.meta.quarter_len, quarters: 4, difficulty: ticket.meta.difficulty,
    onEnd: async (summary, sess) => {
      app.ai.recordGame(roster.map(e => e.aiId).filter(Boolean), opp.map(e => e.aiId).filter(Boolean), summary.winner === summary.me.team);
      // v0.4.5: teammates from your AI world go along (crew members on your team double the crew XP)
      const mates = roster.map(e => e.aiId).filter(Boolean).slice(0, 4);
      const saving = app.api.mutate(`/api/matches/${ticket.id}/complete`, { summary, mates }).catch(e => { toast('Result not saved: ' + e.message, 'error'); return null; });
      await playOutro(app, { summary, session: sess, result: saving });
      const result = await saving;
      if (result) { app.replaceChar(result.character); app.setBalance(result.balance); if (result.proam_team) app.profile.proam_team = result.proam_team; }
      const won = summary.winner === summary.me.team;
      showResults(app, summary, result, won, { players: [...roster.slice(1), ...opp], menuLabel: 'Pro-Am menu', menu: () => Screens.go(app, 'proam'), again: () => playProAm(app), againLabel: 'Next game', autoNext: true });
    },
  });
  const world = {
    session, scene, ticket,
    frame: dt => { if (app.input.wasPressed('pause') && !session.paused && !session.ended && !app.modalOpen()) pauseMatch(app, world); session.frame(dt); },
    onFocusLost: () => { if (!session.paused && !session.ended && !app.modalOpen()) pauseMatch(app, world); },
    dispose: () => session.dispose(),
  };
  app.world = world;
  app.mode = 'match';
  app.renderer.prewarm(scene);
  music.setPlaylist('main'); music.setSuppressed(true); // v0.4.4: the soundtrack sits out Pro-Am
  audio.surface = 'wood';
  app.setController(world, scene);
}

// ---------------- v0.4.7.5 qp3 online: Pro-Am with your real squad ----------------
// The squad leader starts it: you and your friends in the squad (wherever they are, as long as they aren't in a game)
// suit up together, regulars fill the open spots, against a team of regulars, or (a Pro-Am challenge another squad
// accepted) against that squad. It counts as a Pro-Am game for each of you, in your own save.
function onlineSquadNote(app) {
  const net = app.net;
  if (!net?.connected) return '';
  const sq = net.squad, mates = Online.freeSquad(app);
  if (!sq) return '<p class="muted small">Online: put a squad together with friends (social phone → Online) and run Pro-Am as one team, or challenge another squad. <button class="linkish" data-pachal>Online</button></p>';
  const ai = sq.members.flatMap(m => m.ai || []).map(a => esc(a.name));
  // (v0.4.8.5: each real player's Pro-Am rank: the squad plays Pro-Am within 2 ranks of each other)
  const rk = id => { const r = Online.memberRank(app, id); return r ? ` ${Online.rankChip(r, 13)}` : ''; };
  const bad = Online.squadRankProblem(app);
  return `<p class="muted small"><b>Online squad:</b> ${sq.members.filter(m => m.id !== net.myId).map(m => esc(m.name || m.username) + rk(m.id) + (mates.some(x => x.id === m.id) ? '' : ' (busy)')).join(', ')}${ai.length ? ` and the squad's AI (${ai.join(', ')})` : ''} suit up with you. ${net.isLeader() ? 'You lead: Play starts it for all of you.' : 'Your squad leader starts the game.'} <button class="linkish" data-pachal>Challenge a squad</button></p>
    ${bad ? `<p class="small rk-warn">${esc(bad)}</p>` : ''}`;
}

const ORDER5 = ['PG', 'SG', 'SF', 'PF', 'C'];
// opp (from a challenge the other squad accepted): {leader, members, entries, usernames, rtts}
export function proAmOnlineSetup(app, opp = null) {
  const net = app.net, w = app.ai, cat = app.catalog, c = app.char();
  const t = app.profile.proam_team || { name: `${net.you.username}'s team`, abbr: net.you.username.slice(0, 3).toUpperCase(), primary: '#2457c5', secondary: '#f2c14e', logo: 'bolt', wood: 'natural', wins: 0, losses: 0 };
  const seed = Online.newSeed(), people = new Map(), used = new Set();
  const mineP = [Online.personOf(app, net.myId), ...Online.freeSquad(app).map(m => Online.personOf(app, m.id))].filter(p => p?.entry).slice(0, 5);
  const theirsP = opp ? opp.members.map(id => ({ id, username: opp.usernames?.[id] || '?', entry: opp.entries?.[id], rtt: opp.rtts?.[id] ?? null })).filter(p => p.entry).slice(0, 5) : [];
  const human = p => { const e = Online.setupEntry(app, p.entry, true, p.username); people.set(e, p); return e; };
  // open spots: the squads' AI squad mates first (each player's own, from his game: yours from yours), then regulars who
  // fit the position
  const fill = (list, level, key, squadAI) => {
    for (const x of squadAI) { if (list.length >= 5) break; if (x.entry.sq?.owner === net.myId) used.add(x.entry.sq.id); list.push(Online.setupEntry(app, x.entry, false)); }
    const open = ORDER5.filter(p => !list.some(x => x.build.position === p));
    while (list.length < 5) { const position = open.shift() || ORDER5[list.length % 5]; const id = w.pick({ position, level, exclude: used, key: key + list.length }); used.add(id); list.push(Online.setupEntry(app, w.gameEntry(id), false)); }
    return list;
  };
  const level = Math.min(0.95, 0.55 + ((t.wins || 0) - (t.losses || 0) * 0.5) * 0.02 + (settings.difficulty ?? 0.6) * 0.1);
  const r0 = fill(mineP.map(human), 0.62, `pa${seed}-0-`, Online.squadAIPlayers(app, mineP.map(p => p.id)));
  const oppAI = opp ? theirsP.flatMap(p => (opp.ai?.[p.id] || []).map(a => ({ entry: { ...a.entry, sq: { owner: p.id, id: a.id } } }))) : [];
  const r1 = opp ? fill(theirsP.map(human), 0.64, `pa${seed}-1-`, oppAI) : proamOpponents(app, level, seed).map(e => Online.setupEntry(app, e, false));
  const levels = [0.62, opp ? 0.64 : level]; // (v0.4.8.5: each team's level for regulars: sim/ranks.js teamRating)
  const brand = { name: t.name || `${net.you.username}'s team`, abbr: t.abbr || net.you.username.slice(0, 3).toUpperCase(), primary: t.primary || '#2457c5', secondary: t.secondary || '#f2c14e', logo: t.logo || 'bolt', wood: t.wood || 'natural' };
  const oppUser = opp ? opp.usernames?.[opp.leader] || 'Rivals' : null;
  const other = opp ? { name: `${oppUser}'s team`, abbr: oppUser.slice(0, 3).toUpperCase(), primary: '#c8322f', secondary: '#111111' }
    : { name: 'Night Owls', abbr: 'NOW', primary: '#c8322f', secondary: '#111111' };
  if (other.primary === brand.primary) { other.primary = '#1f7a4d'; other.secondary = '#f4f2ec'; }
  const uni = (b, n) => ({ top: { family: 'jersey', color: b.primary, trim: b.secondary, secondary: b.secondary, pattern: 'panel', lettering: b.abbr, tucked: true }, bottom: { family: 'shorts', color: b.primary, trim: b.secondary, stripe: b.secondary }, number: n });
  const rosters = [r0, r1];
  rosters.forEach((ro, ti) => ro.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, cat, { ...uni(ti ? other : brand, e.build.appearance?.number ?? (i * 7 + 3) % 50), name: e.name }); }));
  const { slots, names, meter } = Online.seatPeople(rosters, people);
  return {
    kind: 'proam', where: null, court: null, format: 5, seed, rosters, slots, names, meter,
    teams: [{ name: brand.name, abbr: brand.abbr, color: brand.primary }, { name: other.name, abbr: other.abbr, color: other.primary }],
    delay: Online.inputDelay([...people.values()].map(p => p.rtt)), difficulty: settings.difficulty ?? 0.6, branding: brand, quarterLen: settings.quarterLen || 180,
    by: c?.name || '', levels,
  };
}
export function startProAmOnline(app, opp = null) {
  const net = app.net;
  if (!net?.connected) { toast('Not connected to the online game right now.', 'error'); return; }
  if (!net.isLeader()) { toast('Your squad leader starts Pro-Am games.', 'error'); return; }
  if (app.world?.mySession && !app.world.mySession.ended) { toast('Finish your game first.', 'error'); return; }
  // v0.4.8.5: the friends rule: your squad's real players within 2 Pro-Am ranks (the other squad isn't checked)
  const bad = Online.squadRankProblem(app);
  if (bad) { toast(bad, 'error'); return; }
  try { net.send({ t: 'start', setup: proAmOnlineSetup(app, opp) }); toast(opp ? 'Pro-Am challenge on: heading to the arena…' : 'Your squad is heading to the arena…'); }
  catch (e) { console.error(e); toast(e.message, 'error'); }
}

// the game itself, on each screen: everyone builds the same game from the setup; local is your player in it. It counts
// as a Pro-Am game for you (your own ticket)
export async function playProAmOnline(app, setup, local) {
  const c = app.char(), net = app.net;
  let ticket = null;
  // (no Pro-Am team of your own yet: one is made for you, so the game counts as your first Pro-Am game)
  if (!app.profile.proam_team) {
    try { const res = await app.api.mutate('/api/proam/team', { team: { name: `${c.name.split(' ')[0]} Squad`.slice(0, 22), abbr: c.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'AHS', primary: '#2457c5', secondary: '#f2c14e', logo: 'bolt', wood: 'natural', roster_seed: (hashString(c.id) % 1e6) + 1 } }); app.profile.proam_team = res.team; }
    catch (e) { console.warn('no Pro-Am team', e); }
  }
  // (v0.4.8.5: the team you face, rated: its real players by their RP, its regulars by their level)
  const myTeam = local < (setup.rosters[0]?.length || 5) ? 0 : 1;
  const oppRating = teamRating(setup.rosters[1 - myTeam], setup.levels?.[1 - myTeam] ?? 0.62);
  try { ticket = await app.api.mutate('/api/matches', { character_id: c.id, mode: 'proam', venue: 'arena', format: 5, quarter_len: setup.quarterLen, difficulty: setup.difficulty, opp_rating: oppRating }); }
  catch (e) { ticket = null; toast(`This one won't count for you (${e.message}). Playing it anyway.`, 'error'); }
  if (ticket) Rewards.consumeBoostsLocal(app, ticket);
  leaveWorld(app);
  $('#ui').innerHTML = ''; $('#ui').className = 'layer';
  const scene = new Scene();
  const b = setup.branding || {};
  const venue = buildVenue(app.renderer, scene, 'arena', { team: { name: b.name, abbr: b.abbr, primary: b.primary, secondary: b.secondary, logo: b.logo, wood: WOOD_TONES[b.wood] || WOOD_TONES.natural } });
  const rosters = structuredClone(setup.rosters);
  for (const r of rosters) for (const e of r) e.look = e.look || resolveLook({ ...e.build, name: e.name }, app.catalog);
  const backHome = () => { world.backTo = 'home'; Screens.go(app, 'home'); };
  const aids = Object.fromEntries(Object.entries(setup.slots).map(([a, s]) => [s, a]));
  const session = new MatchSession(app, {
    mode: 'proam', scene, venue, court: venue.courts[0], rosters, teams: setup.teams, seed: setup.seed, quarterLen: setup.quarterLen, quarters: 4, difficulty: setup.difficulty,
    online: { net, local, delay: setup.delay, game: setup.game, meter: setup.meter, names: setup.names, aids, onLost: async () => { if (ticket) { try { await app.api.post(`/api/matches/${ticket.id}/cancel`, {}); endWinStreak(app); } catch { /* ignore */ } } toast('Lost the connection to the game service: you left the game.', 'error'); backHome(); } },
    onEnd: async (summary, sess) => {
      const teamAids = Object.entries(setup.slots).filter(([, s]) => sess.game.players[s]?.team === summary.me.team).map(([a]) => a);
      const crewMates = Online.crewMatesIn(app, teamAids);
      // (your AI squad mates ran with you: remembered, and a crew member among them counts for crew XP)
      const mine = setup.rosters.flat().filter(e => e.sq?.owner === net.myId).map(e => e.sq.id).slice(0, 4);
      app.ai?.recordGame?.(mine, [], summary.winner === summary.me.team);
      const saving = ticket ? app.api.mutate(`/api/matches/${ticket.id}/complete`, { summary, mates: mine, crew_mates: Math.min(4, crewMates) }).catch(e => { toast('Result not saved: ' + e.message, 'error'); return null; }) : Promise.resolve(null);
      await playOutro(app, { summary, session: sess, result: saving });
      const result = await saving;
      if (result) { app.replaceChar(result.character); app.setBalance(result.balance); if (result.proam_team) app.profile.proam_team = result.proam_team; Online.reportCrewXP(app, result, { mode: 'proam', venue: 'arena', mates: crewMates }); }
      // (the squad leader runs it back with whoever's still free; the others are pulled in when he does)
      const lead = net.connected && net.squad && net.isLeader() && Online.freeSquad(app).length > 0;
      showResults(app, summary, result, summary.winner === summary.me.team, {
        online: true, players: [], note: net.squad ? (net.isLeader() ? 'Play again takes your squad back on the floor.' : 'Your squad leader starts the next one: you\'re in when he does.') : '',
        menuLabel: 'Pro-Am menu', menu: () => Screens.go(app, 'proam'), again: lead ? () => startProAmOnline(app) : null, againLabel: 'Next game', autoNext: true,
      });
    },
  });
  const world = {
    session, scene, ticket, backTo: 'proam',
    frame: dt => { if (app.input.wasPressed('pause') && !session.paused && !session.ended && !app.modalOpen()) pauseMatch(app, world); session.frame(dt); },
    onFocusLost: () => { if (!session.paused && !session.ended && !app.modalOpen()) pauseMatch(app, world); },
    dispose: () => session.dispose(),
    online: true, mySession: session,
  };
  app.world = world;
  app.mode = 'match';
  app.renderer.prewarm(scene);
  music.setPlaylist('main'); music.setSuppressed(true);
  audio.surface = 'wood';
  app.setController(world, scene);
  const others = Object.values(setup.names || {}).filter(n => n !== net.you?.username);
  app.hud.pushFeed(`Online Pro-Am${others.length ? ` · with ${others.join(', ')}` : ''}`, 'good');
}

export function pauseMatch(app, world) {
  world.session.paused = true;
  const pa = world.ticket?.mode === 'proam'; // (v0.4.8.5: a Pro-Am forfeit costs RP)
  const card = modal(`<h2>Paused</h2><div class="col gap"><button class="btn primary" data-close>Resume</button><button class="btn" data-stats>Lifetime stats</button><button class="btn" data-controls>Controls</button><button class="btn ghost" data-quit>Forfeit & leave${pa ? ` <small class="rk-cost">−${FORFEIT_RP} RP</small>` : ''}</button></div>${Screens.volumeSliders()}`);
  Screens.bindVolume(card);
  closeModal.onClose = () => { world.session.paused = false; };
  card.querySelector('[data-stats]').onclick = () => { world.session.paused = true; Stats.openStatsModal(app); closeModal.onClose = () => { world.session.paused = false; }; };
  card.querySelector('[data-controls]').onclick = () => { world.session.paused = true; modal(`<h2>Controls</h2>${Screens.controlsTable(app)}`, { wide: true }); closeModal.onClose = () => { world.session.paused = false; }; };
  card.querySelector('[data-quit]').onclick = async () => {
    closeModal.onClose = null; closeModal();
    if (world.online) app.net?.send({ t: 'quit' }); // (online: the AI plays your player for the rest)
    if (world.ticket) {
      try {
        const res = await app.api.post(`/api/matches/${world.ticket.id}/cancel`, pa ? { forfeit: true } : {});
        if (res?.character) app.replaceChar(res.character); else endWinStreak(app); // (qp3: leaving a game ends the win streak)
        if (res?.proam_rank) toast(`Forfeit: ${res.proam_rank.delta ? `−${-res.proam_rank.delta} RP` : 'no RP left to lose'} · ${res.proam_rank.rank_after.name}${res.proam_rank.demoted ? ' (demoted)' : ''}.`, 'error');
      } catch { /* ignore */ }
    }
    Screens.go(app, world.backTo || (world.ticket?.mode === 'proam' ? 'proam' : 'home'));
  };
}

// ---------------- Practice ----------------
export function practice(app, root) {
  root.innerHTML = `<section class="panel wide-panel"><div class="eyebrow">PRACTICE · UNION FIELDHOUSE</div><h1>Get your reps in</h1>
    <p class="muted">Shoot around on a full hardwood court with a rebounder feeding you, or go 1-on-1 against an AI defender. Practice doesn't pay VC or Rep — it's for timing your release.</p>
    <div class="tiles">
      <button class="tile" data-p="solo"><span class="tile-k">SHOOTAROUND</span><b>Solo with rebounder</b><small>Find your green window</small></button>
      <button class="tile" data-p="1v1"><span class="tile-k">1-ON-1</span><b>vs AI defender</b><small>Size-ups, step-backs, contests</small></button>
    </div></section>`;
  $$('[data-p]', root).forEach(b => b.onclick = () => startPractice(app, b.dataset.p === '1v1'));
}

function startPractice(app, defender) {
  leaveWorld(app);
  $('#ui').innerHTML = `<div class="park-top"><div class="park-badge" style="--c:#8a2b2b"><b>Union Fieldhouse</b><small>Practice · Esc to leave</small></div></div>`;
  $('#ui').className = 'layer';
  const scene = new Scene();
  const venue = buildVenue(app.renderer, scene, 'gym');
  const c = app.char();
  const me = { build: { ...c }, name: c.name, human: true, look: app.look(c), badges: badgeTiers(c) };
  const opp = defender ? makeTeam(new RNG(Date.now() & 0xffff), 1, { catalog: app.catalog, level: 0.7 }) : [];
  opp.forEach(e => { e.look = resolveLook(e.build, app.catalog); });
  const session = new MatchSession(app, { mode: 'practice', scene, venue, court: venue.courts[0], rosters: [[me], opp], teams: [{ name: 'You', abbr: 'YOU', color: '#ff4d24' }, { name: '', abbr: '', color: '#888' }], seed: 3 }); // (v0.4.8.6: YOU in Ember)
  const world = { session, scene, frame: dt => { if (app.input.wasPressed('pause')) { Screens.go(app, 'practice'); return; } session.frame(dt); }, dispose: () => session.dispose() };
  app.world = world;
  app.mode = 'match';
  app.renderer.prewarm(scene);
  audio.surface = 'wood';
  app.setController(world, scene);
  toast('Shootaround: hold Space, release at the top. Esc to leave.');
}
