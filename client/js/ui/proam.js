// v0.4.8.8 The Pro-Am Overhaul: the Pro-Am tab and the team office (docs/PROAM-OVERHAUL.md §4, §5, §8). The server keeps
// it all (server/proam.py: seasons, teams, series, the draft, the queue); this shows it and asks it.
//  * The tab: the first time, create a Pro-Am team or join one (search every team on the server, real and AI); then
//    your team's page: its division, record and members, the season and its countdown, and the office.
//  * The office panels, openOffice(app, team, panel): the whiteboard (the series game by game, the record, everyone's
//    rank and RP), the draft clipboard (5 AI players for the open spots, 3 refreshes a series) and the team settings
//    (the founder's). The hub's interactables call it; the tab's buttons are the same panels until the hub is in.
//  * queue(app, team): the ready check (every team member in the hub; everyone ready, or 20 s with those who are),
//    then the matchmaker (a real team within 2 divisions for 45 s, else the nearest AI team), then the game
//    (modes.js proamGame).
import { $, $$, esc, toast, modal, closeModal, keepScroll, busy, confirmBox } from './common.js';
import { rankEmblemSVG } from './badgeart.js';
import { divInfo, RP_MAX, seriesShape } from '../sim/ranks.js';

// the twelve home courts (world/proamparks.js PROAM_PARKS; the server's proam.PARKS)
export const PARKS = [['overpass', 'Under the Overpass'], ['longbeach', 'Long Beach'], ['aau', 'AAU Gym'], ['rooftop', 'Rooftop'], ['projects', 'Projects'],
  ['riverside', 'Riverside'], ['warehouse', 'Old Warehouse'], ['schoolyard', 'Schoolyard'], ['cage', 'The Cage'], ['rec', 'Suburban Rec Center'],
  ['desert', 'Desert Dusk'], ['market', 'Night Market']];
export const parkName = id => (PARKS.find(p => p[0] === id) || [null, 'A different park every home game'])[1];
export const venueName = v => parkName(String(v || '').replace(/^proam_/, ''));
export const JERSEYS = [['classic', 'Classic'], ['stripe', 'Stripe'], ['split', 'Split'], ['gradient', 'Fade']];
export const READY_SECS = 20;

// ---------------- small pieces ----------------
export const divChip = (d, size = 16) => (d ? `<span class="pa-div r${d.tier}">${rankEmblemSVG(d.tier, size)}<b>${esc(d.label)}</b></span>` : '');
export const rpBar = rp => `<span class="pa-rp" title="${rp}/${RP_MAX} RP"><i style="width:${Math.max(0, Math.min(100, rp))}%"></i></span><small>${rp} RP</small>`;
export function countdown(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
// "Season 1 · ends Dec 6 (45d 0h)"
export function seasonLine(s, now = Date.now() / 1000) {
  if (!s) return '';
  const end = new Date(s.end * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `Season ${s.n} · ends ${end} (${countdown(s.end - now)})`;
}
const logoTag = t => `<span class="pa-logo" style="--c1:${esc(t.primary || '#2457c5')};--c2:${esc(t.secondary || '#f2c14e')}">${esc(t.abbr || '')}</span>`;
const record = r => `${r?.[0] ?? 0}-${r?.[1] ?? 0}`;

// the AI players on offer, five with a spread of positions: one of each position in the pool's order first, then the
// rest in order (the server's pool; the game knows their positions: sim/world.js)
export function spreadPick(pool, posOf, n = 5) {
  const out = [], seen = new Set();
  for (const id of pool) { const p = posOf(id); if (out.length < n && p && !seen.has(p)) { seen.add(p); out.push(id); } }
  for (const id of pool) if (out.length < n && !out.includes(id)) out.push(id);
  return out;
}
const aiEntry = (app, id) => { try { return app.ai?.entry?.(id) || null; } catch { return null; } };
const aiLine = (app, id) => { const e = aiEntry(app, id); return e ? `<b>${esc(e.name)}</b><small>${e.build?.overall ?? '?'} ${esc(e.build?.position || '')}</small>` : `<b>${esc(id)}</b>`; };

export async function load(app) {
  const st = await app.api.get('/api/proam');
  app.proam = st;
  if (st.given?.length) toast(`Pro-Am rewards: ${st.given.map(i => app.catalog[i]?.name || i).join(', ')}`);
  return st;
}

// ---------------- the tab ----------------
export async function render(app, root, params = {}) {
  root.innerHTML = '<section class="panel wide-panel pa-tab"><div class="eyebrow">PRO-AM</div><h1>Loading…</h1></section>';
  let st;
  try { st = await load(app); } catch (e) { root.innerHTML = `<section class="panel wide-panel pa-tab"><div class="eyebrow">PRO-AM</div><h1>Pro-Am</h1><p class="muted">${esc(e.message)}</p></section>`; return; }
  let view = params.view || (st.team ? 'team' : 'start'), results = null, q = '';
  if (view === 'team' && !st.team) view = 'start'; // (the hub sends a player with no team here: view 'start')
  const draw = (fresh = false) => (fresh ? paint() : keepScroll(root, paint));
  const reload = async (fresh = false) => { st = await load(app); if (!st.team && view === 'team') view = 'start'; draw(fresh); };
  const paint = () => {
    const season = `<div class="pa-season">${esc(seasonLine(st.season))}</div>`;
    if (view === 'start') root.innerHTML = `<section class="panel wide-panel pa-tab"><div class="eyebrow">PRO-AM</div><h1>Pro-Am teams</h1>${season}
      <p class="muted">Pro-Am is played as a team: up to ${st.rules.max_members} players, five on the floor, series by series up the ranks. Create a team or join one.</p>
      <div class="pa-start"><button class="pa-big" data-go="create"><b>Create a Pro-Am team</b><small>Your name, colors, logo, jerseys and home court</small></button>
      <button class="pa-big" data-go="join"><b>Join one</b><small>Search every team on this server</small></button></div>${myRanks(st)}</section>`;
    else if (view === 'create') root.innerHTML = `<section class="panel wide-panel pa-tab"><div class="eyebrow">PRO-AM · NEW TEAM</div><h1>Create a Pro-Am team</h1>${season}
      ${settingsForm(st, null)}<div class="row gap end"><button class="btn ghost" data-go="start">Back</button><button class="btn primary" data-create>Create the team</button></div></section>`;
    else if (view === 'join') root.innerHTML = `<section class="panel wide-panel pa-tab"><div class="eyebrow">PRO-AM · JOIN</div><h1>Find a team</h1>${season}
      <div class="row gap"><input class="text" data-q maxlength="24" placeholder="Team name or abbreviation" value="${esc(q)}"><button class="btn" data-search>Search</button>${st.team ? '' : '<button class="btn ghost" data-go="start">Back</button>'}</div>
      <div class="pa-results">${results ? results.map(t => teamRow(t, st)).join('') || '<p class="muted">No team by that name.</p>' : '<p class="muted small">Every team on this server, real and AI.</p>'}</div>
      ${st.team ? '<div class="row gap end"><button class="btn ghost" data-go="team">Back to your team</button></div>' : ''}</section>`;
    else root.innerHTML = teamPage(app, st);
    bind();
  };
  const bind = () => {
    $$('[data-go]', root).forEach(b => b.onclick = () => { view = b.dataset.go; draw(true); if (view === 'join' && !results) search(''); });
    const create = $('[data-create]', root);
    if (create) create.onclick = async () => {
      if (create.disabled) return; busy(create, true);
      try { await app.api.post('/api/proam/create', { team: readSettings(root) }); toast('Your Pro-Am team is official.'); view = 'team'; await reload(true); }
      catch (e) { toast(e.message, 'error'); busy(create, false); }
    };
    const qi = $('[data-q]', root), sb = $('[data-search]', root);
    if (sb) { sb.onclick = () => search(qi.value); qi.onkeydown = e => { if (e.key === 'Enter') search(qi.value); }; }
    $$('[data-join]', root).forEach(b => b.onclick = async () => {
      if (b.disabled) return; busy(b, true);
      try { const r = await app.api.post('/api/proam/join', { team_id: b.dataset.join }); toast(r.result === 'joined' ? 'You\'re on the team.' : 'Request sent: the founder will answer.'); if (r.result === 'joined') view = 'team'; await reload(true); }
      catch (e) { toast(e.message, 'error'); busy(b, false); }
    });
    $$('[data-viewteam]', root).forEach(b => b.onclick = () => showTeam(app, b.dataset.viewteam));
    const office = panel => openOffice(app, st.team, panel, { onChange: () => reload() });
    $$('[data-office]', root).forEach(b => b.onclick = () => office(b.dataset.office));
    const qb = $('[data-queue]', root); if (qb) qb.onclick = () => queue(app, st.team);
    // (v0.4.8.8: the team's Pro-Am HUB, game/proamhub.js: the office, the gym, the walk-out to the home park)
    const hb = $('[data-hub]', root); if (hb) hb.onclick = () => { if (hb.disabled) return; busy(hb, true); import('../game/proamhub.js').then(m => m.enterHub(app, { from: 'menu' })).catch(e => toast(e.message, 'error')).finally(() => { if (hb.isConnected) busy(hb, false); }); };
    const lv = $('[data-leave]', root);
    if (lv) lv.onclick = async () => {
      if (!(await confirmBox('Leave the team? Your own rank and RP stay yours.', 'Leave'))) return;
      try { await app.api.post('/api/proam/leave', {}); toast('You left the team.'); view = 'start'; await reload(true); } catch (e) { toast(e.message, 'error'); }
    };
    $$('[data-answer]', root).forEach(b => b.onclick = async () => {
      if (b.disabled) return; busy(b, true);
      try { await app.api.post('/api/proam/answer', { account_id: b.dataset.answer, accept: b.dataset.yes === '1' }); await reload(); } catch (e) { toast(e.message, 'error'); busy(b, false); }
    });
    if (view === 'team') tickSeason(root, st);
  };
  const search = async text => {
    q = text || '';
    try { results = (await app.api.get(`/api/proam/search?q=${encodeURIComponent(q)}`)).teams; } catch (e) { toast(e.message, 'error'); results = []; }
    draw(true);
  };
  draw(true);
}

// the countdown, ticking (text only: never the buttons)
function tickSeason(root, st) {
  const el = $('.pa-season', root);
  if (!el || !st.season) return;
  const h = setInterval(() => { if (!el.isConnected) { clearInterval(h); return; } el.textContent = seasonLine(st.season); }, 30000);
}

function myRanks(st) {
  const bs = st.builds || [];
  if (!bs.length) return '';
  return `<h4>Your builds this season</h4><div class="pa-builds">${bs.map(b => `<div class="pa-build">${divChip(b.pa, 18)}<b>${esc(b.name)}</b>${rpBar(b.pa.rp)}<small class="muted">Series ${record(b.pa.series)} · games ${record(b.pa.record)}${b.history?.rank && b.history.games > 0 ? ` · before Season 1: ${esc(b.history.rank)}` : ''}</small></div>`).join('')}</div>`;
}

function teamRow(t, st) {
  const mine = st.team && st.team.id === t.id, asked = (st.requested || []).includes(t.id);
  const act = t.ai ? `<button class="btn ghost small" data-viewteam="${esc(t.id)}">View</button>`
    : mine ? '<span class="tag">Your team</span>'
      : st.team ? `<button class="btn ghost small" data-viewteam="${esc(t.id)}">View</button>`
        : asked ? '<span class="tag">Requested</span>'
          : t.size >= st.rules.max_members ? '<span class="muted small">Full</span>'
            : `<button class="btn small" data-join="${esc(t.id)}">${t.open ? 'Join' : 'Ask to join'}</button>`;
  return `<div class="pa-row">${logoTag(t)}<span class="pa-row-main"><b>${esc(t.name)}</b><small>${t.ai ? 'AI team' : `${t.size}/${st.rules.max_members} players${t.open ? '' : ' · invite-only'}`} · ${record(t.record)} · series ${record(t.series)}</small></span>${divChip(t.division)}${act}</div>`;
}

function teamPage(app, st) {
  const t = st.team, me = app.profile?.account?.id, founder = t.founder === me;
  const sr = t.current;
  const members = (t.members || []).map(m => `<tr><td><b>${esc(m.username)}</b>${m.founder ? ' <em class="tag">FOUNDER</em>' : ''}</td><td>${m.build ? esc(m.build.name) : '<span class="muted">no build</span>'}</td><td>${m.build ? divChip(m.build.state) : ''}</td><td>${m.build ? rpBar(m.build.state.rp) : ''}</td></tr>`).join('');
  const reqs = founder && t.requests?.length ? `<h4>Asking to join</h4>${t.requests.map(r => `<div class="pa-row"><b>${esc(r.username)}</b><span class="grow"></span><button class="btn small" data-answer="${esc(r.account_id)}" data-yes="1">Accept</button><button class="btn ghost small" data-answer="${esc(r.account_id)}" data-yes="0">Decline</button></div>`).join('')}` : '';
  return `<section class="panel wide-panel pa-tab pa-team" style="--c1:${esc(t.primary)};--c2:${esc(t.secondary)}">
    <div class="pa-head">${logoTag(t)}<div><div class="eyebrow">PRO-AM TEAM · ${t.open ? 'OPEN' : 'INVITE-ONLY'}</div><h1>${esc(t.name)}</h1><div class="pa-season">${esc(seasonLine(st.season))}</div></div>
      <div class="pa-rank">${divChip(t.division, 30)}${rpBar(t.rp)}<small>Games ${record(t.record)} · series ${record(t.series)}</small></div>
      <button class="btn primary pa-hub-btn" data-hub>Go to the HUB</button></div>
    <div class="pa-cols"><div><h4>Roster · ${(t.members || []).length}/${st.rules.max_members}</h4><table class="pa-members"><tbody>${members}</tbody></table>${reqs}
      <p class="muted small">Home court: ${esc(parkName(t.court))}.</p></div>
      <div><h4>The office</h4>
        <div class="pa-office">
          <button class="pa-big" data-office="whiteboard"><b>Whiteboard</b><small>${sr ? `${esc(sr.division.label)} series: ${sr.wins}-${sr.losses} (first to ${sr.need})` : 'No series on: queue a game to start one'}</small></button>
          <button class="pa-big" data-office="draft"><b>Draft clipboard</b><small>${sr ? `${sr.refreshes_left} refreshes left this series` : `${st.rules.refreshes} refreshes a series`}</small></button>
          ${founder ? '<button class="pa-big" data-office="settings"><b>Team settings</b><small>Name, colors, logo, jerseys, home court, open or closed</small></button>' : ''}
          <button class="pa-big primary" data-queue><b>Queue for the next game</b><small>Ready check, then a team within 2 divisions (or the AI)</small></button>
        </div>
        ${myRanks(st)}
        <div class="row gap"><button class="btn ghost small" data-go="join">Find teams</button><button class="btn ghost small" data-leave>Leave team</button></div></div></div></section>`;
}

// ---------------- team settings (create and the founder's panel) ----------------
function settingsForm(st, t) {
  const logos = st.rules.logos, v = t || { name: '', abbr: '', primary: '#2457c5', secondary: '#f2c14e', logo: 'bolt', jersey: 'classic', court: null, open: true };
  return `<div class="pa-form">
    <label>Team name<input class="text" data-f="name" maxlength="22" value="${esc(v.name || '')}" placeholder="Night Shift"></label>
    <label>Abbreviation<input class="text abbr" data-f="abbr" maxlength="4" value="${esc(v.abbr || '')}" placeholder="NS"></label>
    <label>Main color<input type="color" data-f="primary" value="${esc(v.primary || '#2457c5')}"></label>
    <label>Second color<input type="color" data-f="secondary" value="${esc(v.secondary || '#f2c14e')}"></label>
    <span class="muted small">Logo</span><div class="chips" data-pick="logo">${logos.map(l => `<button class="chip ${v.logo === l ? 'on' : ''}" data-val="${l}">${esc(l[0].toUpperCase() + l.slice(1))}</button>`).join('')}</div>
    <span class="muted small">Jerseys</span><div class="chips" data-pick="jersey">${JERSEYS.map(([k, n]) => `<button class="chip ${(v.jersey || 'classic') === k ? 'on' : ''}" data-val="${k}">${n}</button>`).join('')}</div>
    <label>Home court<select data-f="court"><option value="">A different park every home game</option>${PARKS.map(([k, n]) => `<option value="${k}" ${v.court === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label class="row gap"><input type="checkbox" data-f="open" ${v.open !== false ? 'checked' : ''}> Open to anyone (off: players ask, you accept)</label>
  </div>`;
}
export function readSettings(root) {
  const val = k => $(`[data-f="${k}"]`, root);
  const pick = k => $(`[data-pick="${k}"] .chip.on`, root)?.dataset.val;
  return { name: val('name').value, abbr: val('abbr').value, primary: val('primary').value, secondary: val('secondary').value, logo: pick('logo') || 'bolt', jersey: pick('jersey') || 'classic', court: val('court').value || null, open: val('open').checked };
}
// v0.4.8.8 §8 Gold extras: the clubhouse's look (team.custom: floor, walls, logo, colors), the founder's from Gold up;
// the hub repaints it (opts.onChange). Below Gold: what it opens, no form
export const CUSTOM_FLOORS = [['natural', 'Natural maple'], ['honey', 'Honey gloss'], ['ebony', 'Ebony'], ['whitewash', 'Whitewash'], ['slate', 'Slate']];
export const CUSTOM_WALLS = [['brick', 'Brick'], ['block', 'Painted block'], ['panel', 'Wood panel'], ['concrete', 'Concrete'], ['team', 'Team colors']];
export const canCustomize = t => (t?.division?.tier ?? 0) >= 2;
function customForm(st, t) {
  if (!canCustomize(t)) return '<h4>Clubhouse</h4><p class="muted small">At Gold your team moves into its own clubhouse: you pick its floor, walls, logo and colors here.</p>';
  const cu = t.custom || {}, cols = Array.isArray(cu.colors) ? cu.colors : [t.primary || '#2457c5', t.secondary || '#f2c14e'];
  const chips = (k, list, on) => `<div class="chips" data-pick="c-${k}">${list.map(([v, n]) => `<button class="chip ${on === v ? 'on' : ''}" data-val="${v}">${esc(n)}</button>`).join('')}</div>`;
  return `<h4>Clubhouse</h4><div class="pa-form pa-custom">
    <span class="muted small">Floor</span>${chips('floor', CUSTOM_FLOORS, cu.floor || 'natural')}
    <span class="muted small">Walls</span>${chips('walls', CUSTOM_WALLS, cu.walls || 'brick')}
    <span class="muted small">Logo wall</span>${chips('logo', st.rules.logos.map(l => [l, l[0].toUpperCase() + l.slice(1)]), cu.logo || t.logo || 'bolt')}
    <label>Clubhouse main color<input type="color" data-f="c-primary" value="${esc(cols[0])}"></label>
    <label>Clubhouse second color<input type="color" data-f="c-secondary" value="${esc(cols[1])}"></label>
  </div>`;
}
export function readCustom(root) {
  if (!$('.pa-custom', root)) return {};
  const pick = k => $(`[data-pick="c-${k}"] .chip.on`, root)?.dataset.val;
  return { custom: { floor: pick('floor') || 'natural', walls: pick('walls') || 'brick', logo: pick('logo') || 'bolt', colors: [$('[data-f="c-primary"]', root).value, $('[data-f="c-secondary"]', root).value] } };
}
function bindPicks(root) {
  $$('[data-pick]', root).forEach(g => $$('.chip', g).forEach(b => b.onclick = () => { $$('.chip', g).forEach(x => x.classList.toggle('on', x === b)); }));
}

// another team's page (search): its division, record, roster (an AI team's players by name and build)
async function showTeam(app, id) {
  let t;
  try { t = (await app.api.get(`/api/proam/teams?id=${encodeURIComponent(id)}`)).team; } catch (e) { toast(e.message, 'error'); return; }
  const roster = t.ai ? (t.roster || []).map(i => `<div class="pa-row">${aiLine(app, i)}</div>`).join('') : (t.members || []).map(m => `<div class="pa-row"><b>${esc(m.username)}</b>${m.build ? divChip(m.build.state) : ''}</div>`).join('');
  modal(`<div class="pa-card" style="--c1:${esc(t.primary)};--c2:${esc(t.secondary)}"><div class="pa-head">${logoTag(t)}<div><div class="eyebrow">${t.ai ? 'AI PRO-AM TEAM' : 'PRO-AM TEAM'}</div><h2>${esc(t.name)}</h2></div>${divChip(t.division, 26)}</div>
    <p class="muted small">Games ${record(t.record)} · series ${record(t.series)} · home court: ${esc(parkName(t.court))}</p><h4>Roster</h4>${roster || '<p class="muted">Nobody yet.</p>'}</div>`, { wide: true });
}

// ---------------- the office (the hub's interactables call these; the tab's buttons too) ----------------
// panel: 'whiteboard' | 'draft' | 'settings'. opts.captain: the session's Captain (the hub knows; on the tab it's you)
export async function openOffice(app, team, panel = 'whiteboard', opts = {}) {
  let st = app.proam;
  try { st = await load(app); } catch (e) { if (!st) { toast(e.message, 'error'); return; } }
  team = st.team || team;
  if (!team) { toast('You\'re not on a Pro-Am team.', 'error'); return; }
  const captain = opts.captain !== false;
  if (panel === 'settings') return settingsPanel(app, st, team, opts);
  if (panel === 'draft') return draftPanel(app, st, team, captain, opts);
  return whiteboard(app, st, team, opts);
}

export function whiteboardHTML(st, team) {
  const sr = team.current;
  const games = sr ? Array.from({ length: sr.length }, (_, i) => {
    const g = sr.games[i];
    return `<tr class="${g?.result === 'W' ? 'won' : g?.result === 'L' ? 'lost' : ''}"><td>Game ${i + 1}</td><td>${g ? (g.home ? 'Home' : 'Away') : (i % 2 ? 'Away' : 'Home')}</td><td>${g ? `${esc(g.opponent.name)} ${g.opponent.kind === 'ai' ? '<small class="muted">AI</small>' : ''}` : '<span class="muted">to be matched</span>'}</td><td>${g ? esc(venueName(g.venue)) : ''}</td><td>${g?.result ? `<b>${g.result}</b> ${g.score ? g.score.join('-') : ''}` : g ? 'next' : ''}</td></tr>`;
  }).join('') : '';
  const [len, need] = sr ? [sr.length, sr.need] : seriesShape(team.division.index);
  return `<div class="pa-board"><div class="eyebrow">WHITEBOARD</div><h2>${esc(team.name)}</h2><div class="pa-season">${esc(seasonLine(st.season))}</div>
    <div class="pa-board-cols"><div><h4>${sr ? `${esc(sr.division.label)} series · ${sr.wins}-${sr.losses}` : 'Next series'} <small class="muted">${len} games, first to ${need}</small></h4>
      ${sr ? `<table class="pa-games"><tbody>${games}</tbody></table>` : '<p class="muted">Queue for a game to start the series.</p>'}
      <p class="small">Record this season: games ${record(team.record)}, series ${record(team.series)}</p></div>
    <div><h4>Ranks</h4><div class="pa-row">${divChip(team.division, 22)}<span class="grow"></span>${rpBar(team.rp)}</div>
      ${(team.members || []).map(m => `<div class="pa-row"><b>${esc(m.username)}</b>${m.build ? divChip(m.build.state) : ''}<span class="grow"></span>${m.build ? rpBar(m.build.state.rp) : ''}</div>`).join('')}</div></div></div>`;
}
function whiteboard(app, st, team) {
  modal(whiteboardHTML(st, team), { wide: true, cls: 'pa-office-card' });
}

async function draftPanel(app, st, team, captain, opts) {
  let d;
  try { d = (await app.api.post('/api/proam/draft', { action: 'view' })).draft; } catch (e) { toast(e.message, 'error'); return; }
  const humans = Math.max(1, opts.humans || 1), open = Math.max(0, 5 - Math.min(5, humans));
  // (the captain's game shows five with a spread of positions out of the server's pool, and tells the server)
  const posOf = id => aiEntry(app, id)?.build?.position || null;
  const want = spreadPick(d.pool, posOf);
  if (captain && want.join() !== d.list.join()) { try { d = (await app.api.post('/api/proam/draft', { action: 'list', ids: want })).draft; } catch { /* keeps the server's */ } }
  const card = modal('<div class="pa-draft" data-draft></div>', { wide: true, cls: 'pa-office-card' });
  const host = $('[data-draft]', card);
  const paint = () => {
    const picked = Object.values(d.picks || {});
    host.innerHTML = `<div class="eyebrow">DRAFT CLIPBOARD</div><h2>Fill the open spots</h2>
      <p class="muted small">${open} open spot${open === 1 ? '' : 's'} on the floor. A pick plays for the whole series; spots still open at the ready check fill from this list in order. ${captain ? '' : 'Only the Captain picks.'}</p>
      <div class="pa-clip">${d.list.map((id, i) => `<div class="pa-row ${picked.includes(id) ? 'on' : ''}"><em>${i + 1}</em>${aiLine(app, id)}<span class="grow"></span>${captain ? (picked.includes(id) ? `<button class="btn ghost small" data-unpick="${esc(id)}">Drop</button>` : `<button class="btn small" data-pick="${esc(id)}" ${picked.length >= open ? 'disabled' : ''}>Pick</button>`) : ''}</div>`).join('')}</div>
      <div class="row gap end"><span class="muted small">${d.refreshes_left} refresh${d.refreshes_left === 1 ? '' : 'es'} left this series</span>${captain ? `<button class="btn" data-refresh ${d.refreshes_left > 0 ? '' : 'disabled'}>Refresh the list</button>` : ''}</div>`;
    const act = async (body, b) => {
      if (b?.disabled) return; busy(b, true);
      try {
        d = (await app.api.post('/api/proam/draft', { humans, ...body })).draft;
        if (body.action === 'refresh') { const w = spreadPick(d.pool, posOf); try { d = (await app.api.post('/api/proam/draft', { action: 'list', ids: w })).draft; } catch { /* as it is */ } }
        keepScroll(host, paint); opts.onChange?.();
      } catch (e) { toast(e.message, 'error'); busy(b, false); }
    };
    $$('[data-pick]', host).forEach(b => b.onclick = () => act({ action: 'pick', ai_id: b.dataset.pick }, b));
    $$('[data-unpick]', host).forEach(b => b.onclick = () => act({ action: 'unpick', ai_id: b.dataset.unpick }, b));
    const r = $('[data-refresh]', host); if (r) r.onclick = () => act({ action: 'refresh' }, r);
  };
  paint();
  return card;
}

function settingsPanel(app, st, team, opts) {
  if (team.founder !== app.profile?.account?.id) { toast('The team\'s founder owns its settings.', 'error'); return; }
  const card = modal(`<div class="pa-settings"><div class="eyebrow">TEAM SETTINGS</div><h2>${esc(team.name)}</h2>${settingsForm(st, team)}${customForm(st, team)}
    <h4>Players</h4>${(team.members || []).filter(m => !m.founder).map(m => `<div class="pa-row"><b>${esc(m.username)}</b><span class="grow"></span><button class="btn ghost small" data-handon="${esc(m.account_id)}">Make founder</button><button class="btn ghost small" data-kick="${esc(m.account_id)}">Remove</button></div>`).join('') || '<p class="muted small">Nobody else yet.</p>'}
    <div class="row gap end"><button class="btn primary" data-save>Save</button></div></div>`, { wide: true, cls: 'pa-office-card' });
  bindPicks(card);
  const save = $('[data-save]', card);
  save.onclick = async () => {
    if (save.disabled) return; busy(save, true);
    try { await app.api.post('/api/proam/update', { team: { ...readSettings(card), ...readCustom(card) } }); toast('Team saved.'); closeModal(); opts.onChange?.(); }
    catch (e) { toast(e.message, 'error'); busy(save, false); }
  };
  const act = (path, id, msg) => async () => { if (!(await confirmBox(msg))) return; try { await app.api.post(path, { account_id: id }); closeModal(); opts.onChange?.(); } catch (e) { toast(e.message, 'error'); } };
  $$('[data-kick]', card).forEach(b => b.onclick = act('/api/proam/kick', b.dataset.kick, 'Remove him from the team?'));
  $$('[data-handon]', card).forEach(b => b.onclick = act('/api/proam/handon', b.dataset.handon, 'Hand the team on? He owns its settings from now on.'));
  return card;
}

// ---------------- the ready check and the queue (§8, §3) ----------------
// opts.members: the team members in the hub ([{id, name}], the Captain first; online.js); opts.ready(onAll): the hub's
// ready check over the online service when it's there. Without them (the tab, or alone): you're ready at once.
export async function queue(app, team, opts = {}) {
  let st = app.proam;
  try { st = await load(app); } catch (e) { if (!st) { toast(e.message, 'error'); return; } }
  team = st.team || team;
  if (!team) { toast('You\'re not on a Pro-Am team.', 'error'); return; }
  const card = modal('<div class="pa-queue" data-q></div>', { close: true, cls: 'pa-office-card' });
  const host = $('[data-q]', card);
  let stopped = false, humans = 1;
  closeModal.onClose = () => { stopped = true; if (app.net?.connected) app.net.send({ t: 'pa-ready', op: 'cancel' }); app.api.post('/api/proam/queue', { action: 'leave' }).catch(() => {}); };
  const say = (h, small = '') => { if (host.isConnected) host.innerHTML = `<div class="eyebrow">PRO-AM · ${esc(team.name)}</div><h2>${h}</h2><p class="muted small">${small}</p>`; };
  // the ready check: every team member connected (the hub's own, opts.ready, when it's there); 20 s, then it goes with
  // those who are ready
  let members = opts.members || null;
  const others = Math.max(0, (team.members?.length || 1) - 1);
  if (app.net?.connected && others) {
    say('Ready check', `Your team: ready up. ${READY_SECS} s, then it goes with those who are.`);
    const Online = await import('./online.js');
    const r = await (opts.ready ? new Promise(res => opts.ready(res, READY_SECS)) : Online.paReadyCheck(app, READY_SECS, others));
    if (stopped) return;
    humans = r?.humans || 1; members = r?.members || members;
  }
  // the matchmaker
  let q;
  try { q = await app.api.post('/api/proam/queue', { action: 'join' }); } catch (e) { toast(e.message, 'error'); closeModal(); return; }
  const t0 = Date.now();
  while (q.state === 'waiting' && !stopped) {
    const left = q.left != null ? Math.ceil(q.left) : Math.max(0, Math.ceil(st.rules.queue_wait - (Date.now() - t0) / 1000));
    say('Finding a game…', `A real team within 2 divisions first${left > 0 ? `: the AI's nearest team in ${left} s if none turns up` : ''}.`);
    await new Promise(r => setTimeout(r, 2000));
    if (stopped) return;
    try { q = await app.api.post('/api/proam/queue', { action: 'poll' }); } catch (e) { toast(e.message, 'error'); closeModal(); return; }
  }
  if (stopped || q.state !== 'matched') return;
  const g = q.game;
  say(`Game ${g.n}: ${esc(g.opponent.name)}`, `${g.home ? 'Home' : 'Away'} · ${esc(venueName(g.venue))} · ${g.opponent.kind === 'ai' ? 'an AI team' : 'a real team'}`);
  let lineup = [];
  try { lineup = (await app.api.post('/api/proam/lineup', { humans })).ai; } catch (e) { toast(e.message, 'error'); }
  await new Promise(r => setTimeout(r, 900));
  if (stopped) return;
  const Modes = await import('./modes.js');
  const ctx = { team, opponent: g.opponent, venue: g.venue, home: g.home, series: q.series, game: g, lineup, members };
  // (v0.4.8.8: against a real team with both Captains online, one online game for both teams: realVsReal)
  if (g.opponent.kind === 'team' && g.match && app.net?.connected) {
    const how = await realVsReal(app, ctx, { say, stopped: () => stopped });
    if (stopped || how === 'started') return;
  }
  closeModal.onClose = null;
  closeModal();
  return Modes.proamGame(app, ctx);
}

// v0.4.8.8 a real team against a real team (server/proam.py side): each Captain says who's playing (his team members
// from the ready check and his draft), then the home team's Captain starts one online game with both teams in it
// (Modes.startProamVs) and the away team's is pulled in by the game's start. 'started', or 'local' when it can't be (the
// other Captain offline or gone, nobody's entry): then each team plays the game on its own screens, as against the AI.
export const VS_WAIT = 30;
export async function realVsReal(app, ctx, ui = {}) {
  const net = app.net, g = ctx.game, say = ui.say || (() => {}), stopped = ui.stopped || (() => false);
  const humans = [{ id: net.myId, username: net.you?.username || '' }, ...(ctx.members || []).filter(m => m.id !== net.myId).map(m => ({ id: m.id, username: m.name || '' }))];
  let started = false;
  const off = net.on('start', () => { started = true; });
  try {
    let r = await app.api.post('/api/proam/queue', { action: 'side', match: g.match, side: { online: true, humans, lineup: ctx.lineup || [] } });
    const t0 = Date.now();
    while (!r.other && !stopped() && !started && Date.now() - t0 < VS_WAIT * 1000) {
      say(`Game ${g.n}: ${esc(g.opponent.name)}`, `Waiting for ${esc(g.opponent.name)}'s Captain…`);
      await new Promise(res => setTimeout(res, 1500));
      r = await app.api.post('/api/proam/queue', { action: 'side', match: g.match });
    }
    if (started) return 'started';
    if (stopped() || !r.other?.online) return 'local';
    if (g.home) {
      say(`Game ${g.n}: ${esc(g.opponent.name)}`, 'Both teams are in: setting up the game…');
      const Online = await import('./online.js'), Modes = await import('./modes.js');
      const ids = [...humans.slice(1).map(h => h.id), ...r.other.humans.map(h => h.id)];
      const people = await Online.paEntries(app, ids);
      if (stopped()) return 'local';
      closeModal.onClose = null;
      closeModal();
      return (await Modes.startProamVs(app, ctx, r.other, people)) ? 'started' : 'local';
    }
    // the away team: the home Captain's game start pulls everyone in (online.js 'start')
    const t1 = Date.now();
    while (!started && !stopped() && Date.now() - t1 < VS_WAIT * 1000) {
      say(`Game ${g.n}: ${esc(g.opponent.name)}`, `${esc(g.opponent.name)} is at home: their Captain starts the game…`);
      await new Promise(res => setTimeout(res, 500));
    }
    if (started) { closeModal.onClose = null; closeModal(); return 'started'; }
    return 'local';
  } catch (e) { console.warn('[pro-am] real vs real', e?.message || e); return 'local'; } finally { off(); }
}
