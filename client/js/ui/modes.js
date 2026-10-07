// Mode screens: Park entry + hub overlay, Pro-Am team & games, Practice gym, results.
import { $, $$, esc, money, toast, modal, closeModal, title, TIER, confirmBox } from './common.js';
import { AFFILIATIONS, THEMES } from '../world/themes.js';
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
import { boostedBuild } from '../sim/ratings.js';
import { padGlyph } from '../core/input.js';

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
    <div class="row gap"><label class="muted small">Games to <select data-target>${[11, 15, 21].map(t => `<option ${settings.parkTarget === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <div class="row gap end"><button class="btn primary big" data-park="${c.affiliation}">Enter ${esc(home.park)}</button></div></section>`;
  $('[data-target]', root).onchange = e => { settings.parkTarget = +e.target.value; saveSettings(); };
  $$('[data-park]', root).forEach(b => b.onclick = () => enterPark(app, b.dataset.park));
}

export function enterPark(app, themeId) {
  leaveWorld(app);
  const ui = new ParkUI(app);
  $('#ui').innerHTML = ''; $('#ui').className = 'layer';
  ui.mount();
  toast('Loading the park…');
  setTimeout(() => {
    try {
      const hub = new ParkHub(app, themeId, ui);
      app.world = hub;
      app.mode = 'park';
      app.setController(hub, hub.scene);
      ui.intro(hub);
    } catch (e) { console.error(e); toast(e.message, 'error'); Screens.go(app, 'home'); }
  }, 30);
}

class ParkUI {
  constructor(app) { this.app = app; this.lastPrompt = null; }
  mount() {
    $('#ui').innerHTML = `<div class="park-top" id="park-top"></div>`;
  }
  intro(hub) {
    const c = this.app.char();
    $('#park-top').innerHTML = `<div class="park-badge" style="--c:${hub.aff.color}"><b>${esc(hub.venue.theme.name)}</b><small>${esc(hub.aff.name)}</small></div>
      <div class="park-rep"><span>${esc(c.rep.label)}</span><span class="bar rep-bar"><i style="width:${c.rep.next ? Math.round((c.rep.points - c.rep.floor) / (c.rep.next - c.rep.floor) * 100) : 100}%"></i></span></div>
      <div class="park-keys muted small" id="park-keys"></div>`;
    this.keysFor = null;
    this.toast(`Welcome to ${hub.venue.theme.name}. Find a Got Next circle by a court.`);
  }
  toast(t, k) { toast(t, k); }
  update(hub) {
    const inp = this.app.input, pad = inp.usingPad;
    if (this.keysFor !== pad) {
      this.keysFor = pad;
      const k = $('#park-keys');
      if (k) k.innerHTML = pad
        ? `${padGlyph(inp.gp.family, 'LS')} move · ${padGlyph(inp.gp.family, 'RT')} sprint · ${padGlyph(inp.gp.family, 'RS')} look · ${padGlyph(inp.gp.family, 'LB')}+${padGlyph(inp.gp.family, 'RB')} social · ${padGlyph(inp.gp.family, 'MENU')} menu`
        : '<kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · right-drag look · <kbd>O</kbd> social · <kbd>Esc</kbd> menu';
    }
    const p = hub.mode === 'roam' ? hub.prompt : '';
    if (p !== this.lastPrompt) { this.lastPrompt = p; $('#prompt').innerHTML = p ? `<div class="prompt">${p}</div>` : ''; }
    const top = $('#park-top'); if (top) top.hidden = hub.mode !== 'roam';
  }
  pause(hub) {
    const card = modal(`<h2>${esc(hub.venue.theme.name)}</h2><div class="col gap">
      <button class="btn primary" data-close>Resume</button>
      <button class="btn" data-store>VC Store</button>
      <button class="btn" data-boosts>Boosts</button>
      <button class="btn" data-mp>MyPlayer</button>
      <button class="btn" data-phone>Social (${this.app.input?.usingPad ? 'LB + RB' : 'O'})</button>
      <button class="btn" data-stats>Lifetime stats</button>
      <button class="btn" data-settings>Settings & controls</button>
      <button class="btn ghost" data-leave>Leave the park</button>
      ${Screens.LAUNCHED ? '<button class="btn ghost" data-exit>Quit to desktop</button>' : ''}</div>`);
    card.querySelector('[data-leave]').onclick = () => { closeModal(); Screens.go(this.app, 'home'); };
    const ex = card.querySelector('[data-exit]'); if (ex) ex.onclick = () => { closeModal(); Screens.confirmQuit(); };
    card.querySelector('[data-store]').onclick = () => { closeModal(); this.openStore(hub); };
    card.querySelector('[data-boosts]').onclick = () => { closeModal(); this.openBoosts(hub); };
    card.querySelector('[data-mp]').onclick = () => { closeModal(); Screens.go(this.app, 'myplayer'); };
    card.querySelector('[data-stats]').onclick = () => { closeModal(); Stats.openStatsModal(this.app); };
    card.querySelector('[data-phone]').onclick = () => { closeModal(); Phone.openPhone(this.app); };
    card.querySelector('[data-settings]').onclick = () => { closeModal(); Screens.openSettings(this.app); };
  }
  pauseGame(hub) {
    const s = hub.mySession; if (!s) return;
    s.paused = true;
    const card = modal(`<h2>Paused</h2><div class="col gap"><button class="btn primary" data-close>Resume</button><button class="btn" data-phone>Social</button><button class="btn" data-stats>Lifetime stats</button><button class="btn" data-controls>Controls</button><button class="btn ghost" data-quit>Leave the game (forfeit)</button></div>`);
    closeModal.onClose = () => { s.paused = false; };
    card.querySelector('[data-stats]').onclick = () => { s.paused = true; Stats.openStatsModal(this.app); closeModal.onClose = () => { s.paused = false; }; };
    card.querySelector('[data-phone]').onclick = () => { closeModal.onClose = null; Phone.openPhone(this.app, { onClose: () => { s.paused = false; } }); };
    card.querySelector('[data-controls]').onclick = () => { s.paused = true; modal(`<h2>Controls</h2>${Screens.controlsTable(this.app)}`, { wide: true }); closeModal.onClose = () => { s.paused = false; }; };
    card.querySelector('[data-quit]').onclick = () => { closeModal.onClose = null; closeModal(); hub.forfeitMyGame(); };
  }
  openStore(hub) { Screens.go(this.app, 'store', { returnPark: hub.themeId }); }
  openBoosts(hub) { Rewards.openBoosts(this.app); }
  openWheel(hub) { this.app.affColor = hub.aff.color; Rewards.openWheel(this.app, seg => hub.venue.wheel?.obj?.spinTo(seg)); }
  matchStarted(hub) { $('#prompt').innerHTML = ''; this.app.hud.show(true); }
  backToRoam(hub) { audio.setCrowd(0.1); music.duck(false); }
  results(hub, summary, result, won, actions) { showResults(this.app, summary, result, won, { park: true, ...actions }); }
}

// ---------------- Results ----------------
export function showResults(app, summary, result, won, opts = {}) {
  const me = summary.me.stats;
  const r = result;
  const pct = (a, b) => b ? `${a}/${b}` : '0/0';
  const repBefore = r?.rep_before, repAfter = r?.rep_after;
  const repPct = repAfter && repAfter.next ? Math.round((repAfter.points - repAfter.floor) / (repAfter.next - repAfter.floor) * 100) : 100;
  const lg = opts.grade || app.lastGrade; app.lastGrade = null;
  const card = modal(`
    <div class="results ${won ? 'win' : 'loss'}">
      <div class="eyebrow">${summary.mode === 'park' ? 'PARK GAME' : summary.mode === 'proam' ? 'PRO-AM' : 'GAME'} · FINAL</div>
      <h1>${won ? 'Victory' : 'Defeat'} <span class="score">${summary.score[summary.me.team]}–${summary.score[1 - summary.me.team]}</span></h1>
      ${lg ? `<div class="lg-final" data-tier="${lg.tier}"><small>LOCKED-IN GRADE</small><b>${esc(lg.letter)}</b><span class="muted small">${lg.good} smart plays · ${lg.bad} costly ones</span></div>` : ''}
      <div class="stat-strip">${[['PTS', me.pts], ['REB', me.reb], ['AST', me.ast], ['STL', me.stl], ['BLK', me.blk], ['FG', pct(me.fgm, me.fga)], ['3PT', pct(me.tpm, me.tpa)], ['TO', me.tov]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div>
      ${r ? `<div class="reward-row"><div class="reward"><b>+${money(r.vc)}</b><small>VC EARNED</small></div><div class="reward"><b>+${money(r.rep)}</b><small>REP</small></div>${summary.mode === 'park' ? `<div class="reward"><b>${r.streak}</b><small>WIN STREAK</small></div>` : ''}${summary.mode === 'park' && r.streak_mult > 1 ? `<div class="reward"><b>×${r.streak_mult.toFixed(2)}</b><small>STREAK BONUS</small></div>` : ''}${r.proam_team ? `<div class="reward"><b>${r.proam_team.wins}-${r.proam_team.losses}</b><small>TEAM RECORD</small></div>` : ''}</div>
        <div class="rep-line"><span>${esc(repAfter.label)}</span>${repBefore.level !== repAfter.level ? '<span class="tag hot">RANK UP!</span>' : ''}<span class="muted">${money(repAfter.points)} REP</span></div><span class="bar rep-bar"><i style="width:${repPct}%"></i></span>
        ${r.badges_upgraded.length ? `<div class="badge-ups">${r.badges_upgraded.map(b => `<span class="tag ${['', 'bronze', 'silver', 'gold', 'hof'][b.tier]}">${esc(b.name)} · ${TIER[b.tier]}</span>`).join('')}</div>` : ''}
        ${Object.keys(r.badge_progress || {}).length ? `<div class="muted small">Badge progress: ${Object.entries(r.badge_progress).slice(0, 6).map(([k, v]) => `${esc(app.config.badges[k]?.name || k)} +${v}`).join(' · ')}</div>` : ''}` : '<p class="muted">This result was not recorded (see message).</p>'}
      ${peopleRow(app, opts.players)}
      <div class="row gap end">${opts.park ? (won ? '<button class="btn ghost" data-leave>Leave court</button><button class="btn primary" data-stay>Run it back (stay on)</button>' : '<button class="btn primary" data-leave>Back to the park</button>') : `<button class="btn ghost" data-menu>${opts.menuLabel || 'Main menu'}</button>${opts.again ? '<button class="btn primary" data-again>Play again</button>' : ''}`}</div>
    </div>`, { close: false, cls: 'results-card' });
  const on = (sel, f) => { const b = card.querySelector(sel); if (b) b.onclick = () => { closeModal(); f(); }; };
  on('[data-stay]', () => opts.stay && opts.stay());
  on('[data-leave]', () => opts.leave && opts.leave());
  on('[data-menu]', () => opts.menu ? opts.menu() : Screens.go(app, 'home'));
  on('[data-again]', () => opts.again && opts.again());
  card.querySelectorAll('[data-addf]').forEach(b => b.onclick = () => { const id = b.dataset.addf; if (app.ai.addFriend(id)) { b.classList.add('on'); b.disabled = true; b.innerHTML = `★ ${esc(app.ai.entry(id).name)}`; toast(`${app.ai.entry(id).name} added to your friends.`); } });
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
      const saving = app.api.mutate(`/api/matches/${ticket.id}/complete`, { summary }).catch(e => { toast('Result not saved: ' + e.message, 'error'); return null; });
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
  music.setSuppressed(true); // v0.4.4: the soundtrack sits out Pro-Am
  audio.surface = 'wood';
  app.setController(world, scene);
}

export function pauseMatch(app, world) {
  world.session.paused = true;
  const card = modal(`<h2>Paused</h2><div class="col gap"><button class="btn primary" data-close>Resume</button><button class="btn" data-stats>Lifetime stats</button><button class="btn" data-controls>Controls</button><button class="btn ghost" data-quit>Forfeit & leave</button></div>`);
  closeModal.onClose = () => { world.session.paused = false; };
  card.querySelector('[data-stats]').onclick = () => { world.session.paused = true; Stats.openStatsModal(app); closeModal.onClose = () => { world.session.paused = false; }; };
  card.querySelector('[data-controls]').onclick = () => { world.session.paused = true; modal(`<h2>Controls</h2>${Screens.controlsTable(app)}`, { wide: true }); closeModal.onClose = () => { world.session.paused = false; }; };
  card.querySelector('[data-quit]').onclick = async () => {
    closeModal.onClose = null; closeModal();
    if (world.ticket) { try { await app.api.post(`/api/matches/${world.ticket.id}/cancel`, {}); } catch { /* ignore */ } }
    Screens.go(app, world.ticket?.mode === 'proam' ? 'proam' : 'home');
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
  audio.surface = 'wood';
  app.setController(world, scene);
  toast('Shootaround: hold Space, release at the top. Esc to leave.');
}
