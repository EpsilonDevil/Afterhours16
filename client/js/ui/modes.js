// Mode screens: Park entry + hub overlay, Pro-Am team & games, Practice gym, results.
import { $, $$, esc, money, toast, modal, closeModal, title, TIER, confirmBox } from './common.js';
import { AFFILIATIONS, THEMES, EVENTS } from '../world/themes.js';
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
import { badgeSVG, iconBadgeSVG } from './badgeart.js';
import { reportBug } from './bugreport.js';
import * as Crew from './crew.js';
import { CrewHQ, RUN_MIN } from '../game/crewhq.js';

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
  root.innerHTML = `<section class="panel wide-panel"><div class="eyebrow">THE PARK · ${esc(home.name.toUpperCase())}</div><h1>${esc(home.park)}</h1>
    <p class="muted">Walk the park, stand on a <b>Got Next</b> circle to claim the next game, and hold the court as long as you can. Winners stay on.</p>
    <div class="stat-strip"><div><b>${pk.wins || 0}-${(pk.games || 0) - (pk.wins || 0)}</b><small>PARK RECORD</small></div><div><b>${pk.streak || 0}</b><small>CURRENT STREAK</small></div><div><b>${pk.best_streak || 0}</b><small>BEST STREAK</small></div><div><b>${esc(c.rep.label)}</b><small>REP</small></div></div>
    <div class="aff-grid small">${Object.values(AFFILIATIONS).map(a => `<button class="aff ${a.id === c.affiliation ? 'home' : ''}" data-park="${a.id}" style="--c:${a.color};--d:${a.accent}"><span class="aff-k">${a.id === c.affiliation ? 'HOME PARK' : 'VISIT'}</span><b>${esc(a.park)}</b><small>${esc(a.name)}</small></button>`).join('')}</div>
    <div class="event-card" data-cup><div class="ev-k">PARK EVENT · LIVE</div><b>THE KING TUT CUP</b><small>${esc(EVENTS.kingtut.blurb)} Every game is an ante-up; the most VC won in 48 hours takes the glow-in-the-dark mo-cap suit.</small>
      <div class="ev-row"><span class="ev-stat" data-cup-left>…</span><span class="ev-stat" data-cup-rank></span><button class="btn ghost small" data-cup-board>Leaderboard</button><button class="btn primary small" data-park="kingtut">Enter the Cup</button></div></div>
    <div class="row gap"><label class="muted small">Games to <select data-target>${[11, 15, 21].map(t => `<option ${settings.parkTarget === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <div class="row gap end"><button class="btn primary big" data-park="${c.affiliation}">Enter ${esc(home.park)}</button></div></section>`;
  $('[data-target]', root).onchange = e => { settings.parkTarget = +e.target.value; saveSettings(); };
  $$('[data-park]', root).forEach(b => b.onclick = () => enterPark(app, b.dataset.park));
  $('[data-cup-board]', root).onclick = () => openCupBoard(app);
  // v0.4.5: time left and your place in the running Cup (and a nudge when last Cup's prizes are waiting)
  app.api.get('/api/cup').then(st => {
    const left = $('[data-cup-left]', root), rank = $('[data-cup-rank]', root);
    if (left) left.textContent = `Ends in ${cupTimeLeft(st)}`;
    if (rank) rank.textContent = st.me.rank ? `You: #${st.me.rank} of ${st.field} · ${money(st.me.net)} VC` : `${st.field} hoopers entered`;
    if (st.previous && !st.previous.claimed && st.previous.prize) {
      const card = $('[data-cup]', root);
      card?.insertAdjacentHTML('beforeend', `<div class="ev-claim">Last Cup: you finished #${st.previous.rank}. <button class="btn primary small" data-cup-claim>Claim ${esc(st.previous.prize.label)} prizes</button></div>`);
      $('[data-cup-claim]', root).onclick = () => openCupBoard(app);
    }
  }).catch(() => {});
}

// ---------------- v0.4.5 The King Tut Cup ----------------
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
  const prev = st.previous;
  const card = modal(`<div class="cup-board">
    <div class="eyebrow">THE KING TUT CUP · 48-HOUR LEADERBOARD</div>
    <h2>Most VC won <span class="muted small">· ends in ${cupTimeLeft(st)} · ${st.field} on the board</span></h2>
    ${prev ? `<div class="cup-prev ${prev.claimed ? '' : 'ready'}"><b>Last Cup:</b> you finished #${prev.rank} of ${prev.field} with ${money(prev.net)} VC. ${prev.winner ? `Won by ${esc(cupName(app, prev.winner.id))} (${money(prev.winner.net)} VC). ` : ''}
      ${prev.prize ? (prev.claimed ? '<span class="muted">Prizes claimed.</span>' : `<button class="btn primary small" data-claim="${prev.window}">Claim: ${esc(prev.prize.label)} · ${money(prev.prize.vc)} VC${prev.prize.items.length ? ' + ' + items(prev.prize.items) : ''}</button>`) : ''}</div>` : ''}
    <div class="cup-me">${st.me.rank ? `You: <b>#${st.me.rank}</b> · ${money(st.me.net)} VC · ${st.me.games} games · ${st.me.wins} wins · best streak ${st.me.best_streak}` : 'You haven\'t played this Cup yet. Every game is an ante-up: win and you take the other side\'s stake (boosted by your Cup streak); lose and your stake is gone.'}</div>
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
      toast(`Cup prizes claimed: ${money(r.prize.vc)} VC${r.items.length ? ' + ' + items(r.items) : ''}.`);
      closeModal(); openCupBoard(app);
    } catch (e) { toast(e.message, 'error'); cb.disabled = false; }
  };
}

// pick the stake for a Cup game (cb(null) if you back out)
export function pickAnte(app, hub, cb) {
  const bal = app.profile?.balance || 0, streak = hub.myStreak(), mult = Math.round((1 + 0.3 * Math.min(10, streak)) * 100) / 100;
  const antes = hub.cupState?.antes || [500, 1000, 2500, 5000, 10000];
  let done = false;
  const card = modal(`<div class="ante-pick"><div class="eyebrow">THE KING TUT CUP · ANTE-UP</div><h2>Put VC on the line</h2>
    <p class="muted">Your stake comes out when the game starts. Win and you get it back plus the other side's stake${streak ? `, boosted ×${mult.toFixed(2)} by your ${streak}-game Cup streak` : ''} — on top of the normal game VC. Lose (or leave) and the stake is gone. Run it back keeps the same ante.</p>
    <div class="ante-grid">${antes.map(a => `<button class="btn ${a === hub.ante ? 'primary' : ''}" data-ante="${a}" ${a > bal ? 'disabled' : ''}><b>${money(a)}</b><small>win +${money(Math.round(a * mult))}</small></button>`).join('')}</div>
    <p class="muted small">Balance: ${money(bal)} VC</p></div>`);
  const prevClose = closeModal.onClose;
  closeModal.onClose = () => { if (prevClose) prevClose(); if (!done) { done = true; cb(null); } };
  card.querySelectorAll('[data-ante]').forEach(b => b.onclick = () => { done = true; closeModal(); cb(+b.dataset.ante); });
}

export function enterPark(app, themeId, opts = {}) {
  leaveWorld(app);
  const ui = new ParkUI(app);
  $('#ui').innerHTML = ''; $('#ui').className = 'layer';
  ui.mount();
  toast(opts.at === 'hq' ? 'Back to the park…' : 'Loading the park…');
  Crew.fetchCrew(app).catch(() => {}); // v0.4.5: the HQ door knows whether you have a crew
  setTimeout(() => {
    try {
      const hub = new ParkHub(app, themeId, ui);
      app.world = hub;
      app.mode = 'park';
      app.setController(hub, hub.scene);
      // v0.4.5: coming out of the Crew HQ, you step out of its door onto the plaza
      if (opts.at === 'hq' && hub.venue.hq) { hub.me.setPos(hub.venue.hq.x, hub.venue.hq.z + 0.3, 0); hub.rig.roamYaw = 0; hub.rig.snap(); hub.syncSquad(true); }
      ui.intro(hub, opts);
    } catch (e) { console.error(e); toast(e.message, 'error'); Screens.go(app, 'home'); }
  }, 30);
}

// ---------------- v0.4.5 Crew HQ ----------------
export function enterHQ(app, from) {
  leaveWorld(app);
  const ui = new HQUI(app);
  $('#ui').innerHTML = ''; $('#ui').className = 'layer';
  ui.mount();
  toast('Loading the Crew HQ…');
  Crew.fetchCrew(app).catch(() => null).then(() => {
    if (!app.crew) { toast('Start a crew first.', 'error'); enterPark(app, from); return; }
    try {
      const hq = new CrewHQ(app, ui, from);
      app.world = hq;
      app.mode = 'park';
      app.setController(hq, hq.scene);
      ui.intro(hq);
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
      <div class="gn-ticker" id="gn-ticker" hidden></div>`;
    this.tagEls = new Map(); this.tagKey = new Map(); this.tickKey = null;
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
      if (!roam || (!ov && !info.bounty)) { el.hidden = true; continue; }
      const p = r.project(cam, [c.origin[0], ov ? 0.4 : 4.8, c.origin[2] + (c.full ? 0 : 6.5)], this.tmpP);
      if (!p.visible || (!ov && p.depth > 95)) { el.hidden = true; continue; }
      if (!ov) p.y = Math.max(96, p.y); // (a court in front of you keeps its seal on screen)
      else { const W = r.canvas.clientWidth; p.x = Math.min(W - 96, Math.max(96, p.x)); p.y = Math.max(150, p.y); } // (cards stay on screen)
      const key = (ov ? 'o' : 'r') + JSON.stringify(info);
      if (this.tagKey.get(c) !== key) {
        this.tagKey.set(c, key);
        el.className = `court-tag ${ov ? 'ov' : 'roam'}${info.bounty ? ' has-bounty' : ''}${info.next ? ' mine' : ''}`;
        el.innerHTML = ov ? overviewCard(info) : `<div class="ct-seal">${BOUNTY_SVG}<div><b>BOUNTY +${money(info.bounty)} VC</b><small>${FLAME_SVG}${info.streak} straight · break it to collect</small></div></div>`;
      }
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      el.hidden = false;
    }
  }
  // v0.4.7.5: the score of the game on the court you've got next on, bottom right
  ticker(hub) {
    const t = $('#gn-ticker'); if (!t || !hub.courtInfo) return;
    const my = hub.mode === 'roam' && !hub.overview ? hub.myLine() : null;
    const info = my ? hub.courtInfo(my.c) : null;
    if (!info) { if (!t.hidden) { t.hidden = true; this.tickKey = null; } return; }
    const s = my.c.session, cols = s ? [s.teams?.[0]?.color || '#ffd84a', s.teams?.[1]?.color || '#ff5a36'] : ['#555', '#555'];
    const key = JSON.stringify([info, cols]);
    if (key === this.tickKey) return;
    this.tickKey = key;
    const names = s ? [s.teams?.[0]?.name || 'Kings', s.teams?.[1]?.name || 'Challengers'] : ['', ''];
    const lead = info.score ? (info.score[0] > info.score[1] ? 0 : info.score[1] > info.score[0] ? 1 : -1) : -1;
    t.innerHTML = `<div class="gt-head"><div><span>YOU'VE GOT NEXT ON</span><b>${esc(info.name.toUpperCase())}</b></div>${info.target ? `<em>GAME TO ${info.target}</em>` : ''}</div>
      ${info.score ? [0, 1].map(i => `<div class="gt-row ${lead === i ? 'lead' : ''}"><i style="--c:${cols[i]}"></i><span>${esc(names[i])}</span>${i === 0 && info.streak ? `<small>${FLAME_SVG}${info.streak}</small>` : ''}<b>${info.score[i]}</b></div>`).join('') : '<div class="gt-empty">Court\'s open · you\'re on as soon as your squad is set</div>'}
      <div class="gt-foot ${info.next === 'next' ? 'go' : ''}"><span>${info.next === 'next' ? 'YOU RUN NEXT' : info.next === 'after' ? 'UP AFTER THE OTHER SQUAD' : 'FILL UP FIRST TO RUN NEXT'}</span>${info.bounty ? `<span class="gt-bounty">${BOUNTY_SVG}+${money(info.bounty)} VC</span>` : ''}</div>`;
    t.hidden = false;
  }
  // v0.4.5 the HQ building on the plaza: go in, or start a crew first
  openHQ(hub) {
    const app = this.app;
    if (app.crew) { enterHQ(app, hub.themeId); return; }
    Crew.openCrew(app, { onChange: c => { if (c) toast(`Walk through the Crew HQ door to go in.`); } });
  }
  intro(hub, opts = {}) {
    const c = this.app.char();
    $('#park-top').innerHTML = `<div class="park-badge" style="--c:${hub.aff.color}"><b>${esc(hub.venue.theme.name)}</b><small>${esc(hub.aff.name)}</small></div>
      <div class="park-rep"><span>${esc(c.rep.label)}</span><span class="bar rep-bar"><i style="width:${c.rep.next ? Math.round((c.rep.points - c.rep.floor) / (c.rep.next - c.rep.floor) * 100) : 100}%"></i></span></div>
      ${hub.cup ? '<div class="cup-chip" id="cup-chip">King Tut Cup</div>' : ''}
      <div class="park-keys muted small" id="park-keys"></div>`;
    this.keysFor = null;
    if (opts.at !== 'hq') this.toast(hub.cup ? 'Welcome to the King Tut Cup. Every game is an ante-up — claim a GOT NEXT spot and name your stake.' : `Welcome to ${hub.venue.theme.name}. Find a Got Next circle by a court.`);
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
  }
  pause(hub) {
    const card = modal(`<h2>${esc(hub.venue.theme.name)}</h2><div class="col gap">
      <button class="btn primary" data-close>Resume</button>
      <button class="btn" data-store>VC Store</button>
      <button class="btn" data-inv>Inventory</button>
      <button class="btn" data-boosts>Boosts</button>
      <button class="btn" data-mp>MyPlayer</button>
      ${hub.cup ? '<button class="btn" data-cupboard>Cup leaderboard</button>' : ''}
      <button class="btn" data-phone>Social (${this.app.input?.usingPad ? 'LB + RB' : 'O'})</button>
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

function overviewCard(i) {
  const score = i.score ? `<div class="ct-score"><span>${esc(i.teams[0])}</span><b>${i.score[0]}</b><i>–</i><b>${i.score[1]}</b><span>${esc(i.teams[1])}</span></div>` : `<div class="ct-open">${i.waiting ? 'NEXT GAME SOON' : 'OPEN COURT'}</div>`;
  const meta = [i.target ? `to ${i.target}` : '', i.over ? 'final' : '', i.waiting ? `${i.waiting} squad${i.waiting > 1 ? 's' : ''} on Got Next` : ''].filter(Boolean).join(' · ');
  return `<div class="ct-name">${esc(i.name.toUpperCase())}${i.live ? '<span class="live-dot"></span>' : ''}</div>${score}${meta ? `<div class="ct-meta">${meta}</div>` : ''}
    ${i.streak ? `<div class="ct-streak">${FLAME_SVG}${i.myStreak ? 'YOU: ' : ''}${i.streak} STRAIGHT</div>` : ''}
    ${i.bounty ? `<div class="ct-bounty">${BOUNTY_SVG}BOUNTY +${money(i.bounty)} VC</div>` : ''}
    ${i.next ? `<div class="ct-you">${i.next === 'next' ? 'YOU RUN NEXT' : i.next === 'after' ? 'YOU\'RE UP AFTER' : 'YOUR GOT NEXT SPOT'}</div>` : ''}`;
}

// v0.4.5 the Crew HQ's overlay: the park's prompt and top bar, its own pause menu and the crew-run results
class HQUI extends ParkUI {
  intro(hq) {
    const cr = hq.crew, on = hq.onlineIds().length;
    $('#park-top').innerHTML = `<div class="park-badge crew-badge" style="${Crew.crewVars(cr)}"><b>${esc(cr.name)} <span class="crew-tag sm">${esc(cr.tag)}</span></b><small>Crew HQ · level ${cr.level.level} · ${on} member${on === 1 ? '' : 's'} on</small></div>
      <div class="park-keys muted small" id="park-keys"></div>`;
    this.keysFor = null;
    this.toast(on >= RUN_MIN ? `Welcome to the HQ. ${on} of your crew are here — run 5-on-5 from the scorer's table.` : `Welcome to the HQ. ${on ? `${on} of your crew ${on === 1 ? 'is' : 'are'} here.` : 'Nobody from the crew is on right now.'} 5-on-5 opens up when ${RUN_MIN} members are on.`);
  }
  pause(hq) {
    const card = modal(`<h2>${esc(hq.crew.name)} · Crew HQ</h2><div class="col gap">
      <button class="btn primary" data-close>Resume</button>
      <button class="btn" data-crew>Crew menu</button>
      <button class="btn" data-phone>Social (${this.app.input?.usingPad ? 'LB + RB' : 'O'})</button>
      <button class="btn" data-stats>Lifetime stats</button>
      <button class="btn" data-settings>Settings & controls</button>
      <button class="btn" data-park>Back to the park</button>
      <button class="btn ghost" data-leave>Main menu</button>
      ${Screens.LAUNCHED ? '<button class="btn ghost" data-exit>Quit to desktop</button>' : ''}</div>${Screens.volumeSliders()}`);
    Screens.bindVolume(card);
    card.querySelector('[data-crew]').onclick = () => { closeModal(); this.openCrewMenu(hq); };
    card.querySelector('[data-phone]').onclick = () => { closeModal(); Phone.openPhone(this.app); };
    card.querySelector('[data-stats]').onclick = () => { closeModal(); Stats.openStatsModal(this.app); };
    card.querySelector('[data-settings]').onclick = () => { closeModal(); Screens.openSettings(this.app); };
    card.querySelector('[data-park]').onclick = () => { closeModal(); this.exit(hq); };
    card.querySelector('[data-leave]').onclick = () => { closeModal(); Screens.go(this.app, 'home'); };
    const ex = card.querySelector('[data-exit]'); if (ex) ex.onclick = () => { closeModal(); Screens.confirmQuit(); };
  }
  exit(hq) { enterPark(this.app, hq.from || this.app.char()?.affiliation || 'harbor', { at: 'hq' }); }
  openCrewMenu(hq) {
    Crew.openCrew(this.app, { onChange: c => { if (!c) return; hq.crew = c; hq.syncT = 0.5; hq.refreshBoards(); } });
  }
  backToRoam() { audio.setCrowd(0); music.duck(false); }
  async runResults(hq, summary, session, won) {
    const app = this.app, me = summary.me.stats;
    await playOutro(app, { summary, session, result: null, practice: true });
    const pct = (a, b) => `${a}/${b}`;
    const on = hq.onlineIds().length;
    const card = modal(`<div class="results ${won ? 'win' : 'loss'}">
      <div class="eyebrow">CREW HQ · 5-ON-5 · FINAL</div>
      <h1>${won ? 'Victory' : 'Defeat'} <span class="score">${summary.score[summary.me.team]}–${summary.score[1 - summary.me.team]}</span></h1>
      <div class="stat-strip">${[['PTS', me.pts], ['REB', me.reb], ['AST', me.ast], ['STL', me.stl], ['BLK', me.blk], ['FG', pct(me.fgm, me.fga)], ['3PT', pct(me.tpm, me.tpa)], ['TO', me.tov]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div>
      <p class="muted">Crew runs in the HQ are practice: they don't pay VC, Rep or crew XP. Your crew levels up from the games you play in the park, the Cup and Pro-Am, and from your members' games.</p>
      <div class="row gap end"><button class="btn ghost" data-back>Back to the HQ</button><button class="btn primary" data-again ${on >= RUN_MIN ? '' : 'disabled'}>${on >= RUN_MIN ? 'Run it back' : `Run it back (needs ${RUN_MIN} on)`}</button></div>
    </div>`, { close: false, cls: 'results-card' });
    card.querySelector('[data-back]').onclick = () => { closeModal(); hq.endRun(false); };
    card.querySelector('[data-again]').onclick = () => { closeModal(); hq.endRun(true); };
    if (won) audio.ui('buy');
  }
}

// ---------------- Results ----------------
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
  card.querySelector('[data-ok]').onclick = () => { closeModal(); next(); };
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
  card.querySelector('[data-ok]').onclick = () => { closeModal(); next(); };
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
      <div class="eyebrow">${r?.cup ? 'KING TUT CUP · ANTE-UP' : summary.mode === 'park' ? 'PARK GAME' : summary.mode === 'proam' ? 'PRO-AM' : pro ? 'THE PRO RUN' : 'GAME'} · FINAL</div>
      <h1>${won ? 'Victory' : 'Defeat'} <span class="score">${summary.score[summary.me.team]}–${summary.score[1 - summary.me.team]}</span></h1>
      ${lg ? `<div class="lg-final" data-tier="${lg.tier}"><small>LOCKED-IN GRADE</small><b>${esc(lg.letter)}</b><span class="muted small">${lg.good} smart plays · ${lg.bad} costly ones</span></div>` : ''}
      <div class="stat-strip">${[['PTS', me.pts], ['REB', me.reb], ['AST', me.ast], ['STL', me.stl], ['BLK', me.blk], ['FG', pct(me.fgm, me.fga)], ['3PT', pct(me.tpm, me.tpa)], ['TO', me.tov]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div>
      ${r?.cup ? `<div class="cup-result ${won ? 'win' : 'loss'}">${won ? `<b>POT +${money(r.cup.pot)} VC</b><small>your ${money(r.cup.ante)} stake back + theirs${r.streak_mult > 1 ? ` ×${r.streak_mult.toFixed(2)}` : ''}</small>` : `<b>ANTE LOST −${money(r.cup.ante)} VC</b><small>the stake goes to the other side</small>`}<span>King Tut Cup: <b>#${r.cup.rank}</b> of ${r.cup.field} · ${r.cup.net < 0 ? '−' : ''}${money(Math.abs(r.cup.net))} VC this Cup</span></div>` : ''}
      ${r?.bounty ? `<div class="bounty-result">${BOUNTY_SVG}<div><b>BOUNTY CLAIMED +${money(r.bounty)} VC</b><small>You broke the kings' streak (included in VC earned)</small></div></div>` : ''}
      ${r ? `<div class="reward-row"><div class="reward"><b>+${money(r.vc)}</b><small>VC EARNED</small></div>${pro ? '<div class="reward"><b>×1.5</b><small>VC & BADGE PROGRESS</small></div>' : `<div class="reward"><b>+${money(r.rep)}</b><small>REP</small></div>`}${summary.mode === 'park' ? `<div class="reward"><b>${r.streak}</b><small>WIN STREAK</small></div>` : ''}${summary.mode === 'park' && r.streak_mult > 1 ? `<div class="reward"><b>×${r.streak_mult.toFixed(2)}</b><small>STREAK BONUS</small></div>` : ''}${r.proam_team ? `<div class="reward"><b>${r.proam_team.wins}-${r.proam_team.losses}</b><small>TEAM RECORD</small></div>` : ''}</div>
        ${pro ? '' : `<div class="rep-line"><span>${esc(repAfter.label)}</span>${repBefore.level !== repAfter.level ? '<span class="tag hot">RANK UP!</span>' : ''}<span class="muted">${money(repAfter.points)} REP</span></div><span class="bar rep-bar"><i style="width:${repPct}%"></i></span>`}
        ${r.crew ? `<div class="crew-xp" style="${Crew.crewVars({ color: app.crew?.color || '#ffd84a' })}"><span class="crew-tag sm">${esc(r.crew.tag)}</span><b>+${money(r.crew.xp)} CREW XP</b>${r.crew.with_crew ? '<span class="tag hot">×2 WITH CREW</span>' : ''}<span class="muted small">${esc(r.crew.name)} · Level ${r.crew.level_after}${r.crew.next ? ` · ${money(r.crew.next - r.crew.total)} to level ${r.crew.level_after + 1}` : ''}</span>${r.crew.level_after > r.crew.level_before ? '<span class="tag hot">CREW LEVEL UP!</span>' : ''}</div>` : ''}
        ${r.badges_upgraded.length ? `<div class="badge-ups">${r.badges_upgraded.map(b => `<span class="tag badge-up ${['', 'bronze', 'silver', 'gold', 'hof'][b.tier]}">${badgeSVG(b.id, b.tier, 22)}${esc(b.name)} · ${TIER[b.tier]}</span>`).join('')}</div>` : ''}
        ${Object.keys(r.badge_progress || {}).length ? `<div class="muted small">Badge progress: ${Object.entries(r.badge_progress).slice(0, 6).map(([k, v]) => `${esc(app.config.badges[k]?.name || k)} +${v}`).join(' · ')}</div>` : ''}` : '<p class="muted">This result was not recorded (see message).</p>'}
      ${peopleRow(app, opts.players)}
      <div class="row gap end">${opts.park ? (won ? '<button class="btn ghost" data-leave>Leave court</button><button class="btn primary" data-stay>Run it back (stay on)</button>' : '<button class="btn primary" data-leave>Back to the park</button>') : `${r?.max_ovr_unlocked ? '<button class="btn ghost" data-upgrade>Upgrade attributes</button>' : ''}<button class="btn ghost" data-menu>${opts.menuLabel || 'Main menu'}</button>${opts.again ? '<button class="btn primary" data-again>Play again</button>' : ''}`}</div>
    </div>`, { close: false, cls: 'results-card' });
  // v0.4.5: a new Hall of Fame badge opens the cap breaker menu before moving on (v0.4.7.5: only once cap breakers
  // are unlocked at 90 max OVR; until then they're banked in MyPlayer → Attributes → Cap Breakers)
  const hof = r && (r.cap_breakers_awarded > 0 || r.icon_unlocked);
  const cbOpen = !!(r?.character?.cap_breakers_unlocked);
  // qp3: the items an Icon badge brings (the Hash-Slinging dunk package) are in the inventory and equipped already
  if (r?.icon_items?.length && app.profile?.inventory) for (const id of r.icon_items) if (!app.profile.inventory.includes(id)) app.profile.inventory.push(id);
  const iconItems = (r?.icon_items || []).map(id => app.catalog?.[id]?.name).filter(Boolean);
  if (hof) card.querySelector('.results .row.end')?.insertAdjacentHTML('beforebegin', `<div class="hof-note">${r.icon_unlocked ? `<div class="icon-unlock">${iconBadgeSVG(r.icon_unlocked, 56)}<b>Icon badge unlocked: ${esc(app.config.icon_badges?.[r.icon_unlocked]?.name || r.icon_unlocked)}</b>${iconItems.length ? `<span class="muted small">${esc(iconItems.join(', '))} — yours, and equipped</span>` : ''}</div>` : ''}${r.cap_breakers_awarded ? `<b>+${r.cap_breakers_awarded} cap breakers</b> for a new Hall of Fame badge${cbOpen ? '' : ` · banked until your max OVR reaches ${app.config.badge_rules?.ovr_cap ?? 90}`}` : ''}</div>`);
  let countdown = null;
  const stopCountdown = () => { if (countdown) { clearInterval(countdown); countdown = null; } };
  const on = (sel, f) => { const b = card.querySelector(sel); if (b) b.onclick = () => { stopCountdown(); closeModal(); if (hof && r.cap_breakers_awarded && cbOpen && MyPlayer.openCapBreakers) MyPlayer.openCapBreakers(app, f); else f(); }; };
  on('[data-upgrade]', () => Screens.go(app, 'myplayer', { tab: 'attributes' }));
  on('[data-stay]', () => opts.stay && opts.stay());
  on('[data-leave]', () => opts.leave && opts.leave());
  on('[data-menu]', () => opts.menu ? opts.menu() : Screens.go(app, 'home'));
  on('[data-again]', () => opts.again && opts.again());
  // v0.4.5: in the park the screen moves on by itself after 10 seconds (run it back after a win, back to the
  // park after a loss), unless you're placing new cap breakers or adding someone as a friend
  const auto = opts.park && !hof ? card.querySelector(won ? '[data-stay]' : '[data-leave]') : null;
  if (auto) {
    let left = 10; const label = auto.textContent;
    const tick = () => { if (!auto.isConnected) return stopCountdown(); auto.textContent = `${label} · ${left}`; if (left-- <= 0) { stopCountdown(); auto.click(); } };
    tick(); countdown = setInterval(tick, 1000);
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
      <div class="eyebrow">PRO-AM · 5V5 · AFTERHOURS ARENA</div><h1>${esc(t.name || 'Your team')}</h1>
      <div class="proam-cols">
        <div><h4>Team identity</h4>
          <div class="row gap"><input class="text" maxlength="22" value="${esc(t.name)}" data-f="name" placeholder="Team name"><input class="text abbr" maxlength="4" value="${esc(t.abbr)}" data-f="abbr" placeholder="ABBR"></div>
          <span class="muted small">Primary</span><div class="swatches">${COLORS.map(v => `<button class="sw ${t.primary === v ? 'on' : ''}" style="--v:${v}" data-c="primary" data-val="${v}"></button>`).join('')}</div>
          <span class="muted small">Secondary</span><div class="swatches">${COLORS.map(v => `<button class="sw ${t.secondary === v ? 'on' : ''}" style="--v:${v}" data-c="secondary" data-val="${v}"></button>`).join('')}</div>
          <span class="muted small">Logo</span><div class="chips">${app.config.logos.map(l => `<button class="chip ${t.logo === l ? 'on' : ''}" data-logo="${l}">${title(l)}</button>`).join('')}</div>
          <span class="muted small">Home floor</span><div class="chips">${app.config.woods.map(w => `<button class="chip ${t.wood === w ? 'on' : ''}" data-wood="${w}">${title(w)}</button>`).join('')}</div>
          <div class="row gap"><button class="btn" data-save>Save team</button><span class="muted small">Record ${t.wins || 0}-${t.losses || 0}</span></div>
        </div>
        <div><h4>Roster</h4><div class="roster">${roster.map((e, i) => `<div class="roster-row ${i === 0 ? 'me' : ''}"><b>${e.build.overall ?? c.overall}</b><span>${esc(e.name)}${e.aiId && app.ai.inSquad(e.aiId) ? ' <em class="tag sq">SQUAD</em>' : e.aiId && app.ai.isFriend(e.aiId) ? ' <em class="tag fr">FRIEND</em>' : ''}<small>${e.build.position} · ${title(e.build.archetype)}${e.tierLabel ? ' · ' + esc(e.tierLabel) : ''}</small></span></div>`).join('')}</div>
          <p class="muted small">Your squad suits up with you; open spots go to regulars who fit the position.</p>
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
    $('[data-play]', root).onclick = async () => { if (await saveTeam(app, t)) playProAm(app); };
  };
  draw();
  app.showroom.setAccent(t.primary);
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
  let ticket;
  try { ticket = await app.api.mutate('/api/matches', { character_id: c.id, mode: 'proam', venue: 'arena', format: 5, quarter_len: settings.quarterLen, difficulty: settings.difficulty }); }
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
  const level = Math.min(0.95, 0.55 + ((t.wins || 0) - (t.losses || 0) * 0.5) * 0.02 + settings.difficulty * 0.1);
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
      showResults(app, summary, result, won, { players: [...roster.slice(1), ...opp], menuLabel: 'Pro-Am menu', menu: () => Screens.go(app, 'proam'), again: () => playProAm(app) });
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
  music.setSuppressed(true); // v0.4.4: the soundtrack sits out Pro-Am
  audio.surface = 'wood';
  app.setController(world, scene);
}

export function pauseMatch(app, world) {
  world.session.paused = true;
  const card = modal(`<h2>Paused</h2><div class="col gap"><button class="btn primary" data-close>Resume</button><button class="btn" data-stats>Lifetime stats</button><button class="btn" data-controls>Controls</button><button class="btn ghost" data-quit>Forfeit & leave</button></div>${Screens.volumeSliders()}`);
  Screens.bindVolume(card);
  closeModal.onClose = () => { world.session.paused = false; };
  card.querySelector('[data-stats]').onclick = () => { world.session.paused = true; Stats.openStatsModal(app); closeModal.onClose = () => { world.session.paused = false; }; };
  card.querySelector('[data-controls]').onclick = () => { world.session.paused = true; modal(`<h2>Controls</h2>${Screens.controlsTable(app)}`, { wide: true }); closeModal.onClose = () => { world.session.paused = false; }; };
  card.querySelector('[data-quit]').onclick = async () => {
    closeModal.onClose = null; closeModal();
    if (world.ticket) { try { await app.api.post(`/api/matches/${world.ticket.id}/cancel`, {}); } catch { /* ignore */ } }
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
  const session = new MatchSession(app, { mode: 'practice', scene, venue, court: venue.courts[0], rosters: [[me], opp], teams: [{ name: 'You', abbr: 'YOU', color: '#ffd84a' }, { name: '', abbr: '', color: '#888' }], seed: 3 });
  const world = { session, scene, frame: dt => { if (app.input.wasPressed('pause')) { Screens.go(app, 'practice'); return; } session.frame(dt); }, dispose: () => session.dispose() };
  app.world = world;
  app.mode = 'match';
  app.renderer.prewarm(scene);
  audio.surface = 'wood';
  app.setController(world, scene);
  toast('Shootaround: hold Space, release at the top. Esc to leave.');
}
