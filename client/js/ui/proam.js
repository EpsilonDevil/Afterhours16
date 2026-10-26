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
import { teamProgress } from '../world/proamhubs.js'; // (qp8: the team's own rank and its next building)
import { JERSEYS, logoURL, drawKit } from '../world/proamkit.js'; // (qp14: the logo and the kit as the game draws them)

// the twelve home courts (world/proamparks.js PROAM_PARKS; the server's proam.PARKS)
export const PARKS = [['overpass', 'Under the Overpass'], ['longbeach', 'Long Beach'], ['aau', 'AAU Gym'], ['rooftop', 'Rooftop'], ['projects', 'Projects'],
  ['riverside', 'Riverside'], ['warehouse', 'Old Warehouse'], ['schoolyard', 'Schoolyard'], ['cage', 'The Cage'], ['rec', 'Suburban Rec Center'],
  ['desert', 'Desert Dusk'], ['market', 'Night Market']];
export const parkName = id => (PARKS.find(p => p[0] === id) || [null, 'A different park every home game'])[1];
export const venueName = v => parkName(String(v || '').replace(/^proam_/, ''));
export { JERSEYS }; // (qp14: world/proamkit.js keeps the list with the kits it names)
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
// (qp14: the team's real logo, drawn the way its court and banners draw it; the colored tile with its letters where no
// canvas can draw it)
const logoTag = t => { const u = logoURL(t, 96); return u ? `<span class="pa-logo pic"><img src="${u}" alt="${esc(t.abbr || '')}"></span>` : `<span class="pa-logo" style="--c1:${esc(t.primary || '#2457c5')};--c2:${esc(t.secondary || '#f2c14e')}">${esc(t.abbr || '')}</span>`; };
const logoName = l => (l === 'circle' ? 'Roundel' : l === 'hex' ? 'Hexagon' : l[0].toUpperCase() + l.slice(1));
const logoChip = (l, v, on, attr = 'data-val') => { const u = logoURL({ ...v, logo: l }, 48); return `<button class="chip pa-logo-chip ${on ? 'on' : ''}" ${attr}="${l}">${u ? `<img src="${u}" alt="">` : ''}${esc(logoName(l))}</button>`; };
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
  let st = await app.api.get('/api/proam');
  if (paRemote(app)) {
    // (qp6 online: the team, its season and your requests are the online service's; your builds, their ranks and the
    // rewards stay your own service's. Your card goes with it, for the team's roster)
    const Online = await import('./online.js');
    const hub = await Online.paCall(app, 'status', { card: paCard(app, st) });
    st = { ...st, ...hub, local: { me: st.me, season: st.season } };
    if (hub.settle?.length) st = await paSettle(app, st, hub.settle);
  }
  app.proam = st;
  if (st.given?.length) toast(`Pro-Am rewards: ${st.given.map(i => app.catalog[i]?.name || i).join(', ')}`);
  awayNote(st);
  return st;
}

// ---------------- v0.4.8.9 qp6: where the team lives ----------------
// Offline, your Pro-Am team is your own service's. Online, playing from your own copy through a friend's hosted game
// or the online server (net.hub), it's that service's: the one the people you play with share, so you find each
// other's teams, join, meet in the HUB and queue and play as one team. Every team call goes there over the online
// socket (Online.paCall; server/proam.py ProAm.online_call), as your account there; your builds, their rank and RP,
// VC and items stay in your own save. paReq is the one door for both.
export const paRemote = app => !!(app.net?.hub && !app.net.offline);
const PA_GETS = { '/api/proam': 'status', '/api/proam/search': 'search', '/api/proam/teams': 'team' };
export async function paReq(app, method, path, body = {}) {
  if (!paRemote(app)) return method === 'GET' ? app.api.get(path) : app.api.post(path, body);
  const Online = await import('./online.js');
  const [p, qs] = path.split('?'), q = new URLSearchParams(qs || '');
  if (method === 'GET') {
    const op = PA_GETS[p];
    if (op === 'status') return load(app);
    if (op === 'search') return Online.paCall(app, 'search', { q: q.get('q') || '' });
    if (op === 'team') return Online.paCall(app, 'team', { id: q.get('id') || '' });
    throw new Error(`Unknown Pro-Am request ${p}`);
  }
  return Online.paCall(app, p.replace(/^\/api\/proam\//, ''), body);
}
// you, as the team knows you: your account on the service the team is on
export const paMe = (app, st = app.proam) => st?.me ?? app.profile?.account?.id ?? null;
// the build you play, for the team's roster on the online service: its Pro-Am rank from your own save
function paCard(app, st) {
  const c = app.char?.();
  if (!c) return null;
  const pa = (st.builds || []).find(b => b.id === c.id)?.pa || null;
  return { character_id: c.id, name: c.name, position: c.position, overall: c.overall, div: pa?.index ?? 0, rp: pa?.rp ?? 0, record: pa?.record || [0, 0], series: pa?.series || [0, 0] };
}
// your online team's series that ended with you in them: your own service moves your build and pays the bonus, once
async function paSettle(app, st, items) {
  try {
    const r = await app.api.post('/api/proam/settle', { items });
    if (!r.settled?.length) return st;
    for (const m of r.settled) toast(m.outcome === 'won' ? `Series won${m.bonus ? `: +${m.bonus.toLocaleString()} VC` : ''}${m.promoted ? ' · promoted' : ''}.` : `Series lost${m.demoted ? ' · down a division' : ': back to 0 RP'}.`, m.outcome === 'won' ? 'good' : 'error');
    const again = await app.api.get('/api/proam');
    try { await app.refresh?.(); } catch { /* the profile comes back with the next screen */ }
    return { ...st, builds: again.builds, given: [...(st.given || []), ...(again.given || [])] };
  } catch (e) { console.warn('[pro-am] settle', e?.message || e); return st; }
}
// a series game's ticket on your own service: online, it carries the online service's game (the series is there)
// (force: a game set up for several players, some of whom may be online through the team's service: each one's own
// game keeps what its service needs, modes.js playProAmOnline)
export function paTicketGame(app, series, game, team, opp = null, force = false) {
  const base = { series: series.id, n: game.n };
  if (!force && !paRemote(app)) return base;
  const o = opp || game.opponent || {};
  return { ...base, online: { team: team?.id || series.team_id, div: series.div, opp_div: o.div ?? 0, opp: { kind: o.kind || 'ai', id: o.id, name: o.name, abbr: o.abbr, div: o.div ?? 0 }, venue: game.venue, home: !!game.home } };
}
// after a series game on your own service: online, its result goes to the team's service (the series, the team's
// record and division); alone: you were the team's only real player in it (a forfeit counts then)
export async function paReport(app, result, { alone = true } = {}) {
  const rep = result?.pa?.report || result?.pa_report;
  if (!rep || !paRemote(app)) return null;
  try {
    const Online = await import('./online.js');
    const out = await Online.paCall(app, 'report', { ...rep, alone });
    await load(app); // (your card with the RP this game left you, for the team's roster; a series that's over is settled now)
    return out;
  } catch (e) { toast(`The series result didn't reach the online game: ${e.message}`, 'error'); return null; }
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
      <button class="pa-big" data-go="join"><b>Join one</b><small>Search every team on this server</small></button></div>${invitesBlock(st)}${myRanks(st)}</section>`;
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
    if (create) bindPicks(root); // (qp14: the create form's logo and jersey picks never took: only the settings panel bound them)
    if (create) create.onclick = async () => {
      if (create.disabled) return; busy(create, true);
      try { await paReq(app, 'POST', '/api/proam/create', { team: readSettings(root) }); toast('Your Pro-Am team is official.'); view = 'team'; await reload(true); }
      catch (e) { toast(e.message, 'error'); busy(create, false); }
    };
    const qi = $('[data-q]', root), sb = $('[data-search]', root);
    if (sb) { sb.onclick = () => search(qi.value); qi.onkeydown = e => { if (e.key === 'Enter') search(qi.value); }; }
    $$('[data-join]', root).forEach(b => b.onclick = async () => {
      if (b.disabled) return; busy(b, true);
      try { const r = await paReq(app, 'POST', '/api/proam/join', { team_id: b.dataset.join }); toast(r.result === 'joined' ? 'You\'re on the team.' : 'Request sent: the founder will answer.'); if (r.result === 'joined') view = 'team'; await reload(true); }
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
      try { await paReq(app, 'POST', '/api/proam/leave', {}); toast('You left the team.'); view = 'start'; await reload(true); } catch (e) { toast(e.message, 'error'); }
    };
    // (qp12: the club: invite, the founder's remove of an AI member, the invites waiting for you)
    const ib = $('[data-invite]', root); if (ib) ib.onclick = () => openInviteDialog(app, st.team, { onChange: () => reload() });
    $$('[data-removeai]', root).forEach(b => b.onclick = async () => {
      if (!(await confirmBox('Remove him from the club?', 'Remove'))) return;
      try { await paReq(app, 'POST', '/api/proam/remove', { ai_id: b.dataset.removeai }); await reload(); } catch (e) { toast(e.message, 'error'); }
    });
    $$('[data-acceptinv], [data-declineinv]', root).forEach(b => b.onclick = async () => {
      if (b.disabled) return; busy(b, true);
      const yes = !!b.dataset.acceptinv;
      try { await answerInvite(app, yes ? b.dataset.acceptinv : b.dataset.declineinv, yes); if (yes) view = 'team'; await reload(true); } catch (e) { toast(e.message, 'error'); busy(b, false); }
    });
    $$('[data-answer]', root).forEach(b => b.onclick = async () => {
      if (b.disabled) return; busy(b, true);
      try { await paReq(app, 'POST', '/api/proam/answer', { account_id: b.dataset.answer, accept: b.dataset.yes === '1' }); await reload(); } catch (e) { toast(e.message, 'error'); busy(b, false); }
    });
    if (view === 'team') tickSeason(root, st);
  };
  const search = async text => {
    q = text || '';
    try { results = (await paReq(app, 'GET', `/api/proam/search?q=${encodeURIComponent(q)}`)).teams; } catch (e) { toast(e.message, 'error'); results = []; }
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
  const t = st.team, me = paMe(app, st), founder = t.founder === me;
  const sr = t.current;
  const members = (t.members || []).map(m => memberRow(m, founder)).join('');
  const reqs = founder && t.requests?.length ? `<h4>Asking to join</h4>${t.requests.map(r => `<div class="pa-row"><b>${esc(r.username)}</b><span class="grow"></span><button class="btn small" data-answer="${esc(r.account_id)}" data-yes="1">Accept</button><button class="btn ghost small" data-answer="${esc(r.account_id)}" data-yes="0">Decline</button></div>`).join('')}` : '';
  return `<section class="panel wide-panel pa-tab pa-team" style="--c1:${esc(t.primary)};--c2:${esc(t.secondary)}">
    <div class="pa-head">${logoTag(t)}<div><div class="eyebrow">PRO-AM TEAM · ${t.open ? 'OPEN' : 'INVITE-ONLY'}</div><h1>${esc(t.name)}</h1><div class="pa-season">${esc(seasonLine(st.season))}</div></div>
      <div class="pa-rank"><div class="eyebrow">TEAM RANK</div>${divChip(t.division, 30)}${rpBar(teamProgress(t)?.raw ?? t.rp)}<small>Games ${record(t.record)} · series ${record(t.series)}</small>${teamProgress(t) ? `<small class="pa-next">${esc(teamProgress(t).text)}</small>` : ''}</div>
      <button class="btn primary pa-hub-btn" data-hub>Go to the HUB</button></div>
    <div class="pa-cols"><div><h4>Roster · ${(t.members || []).length}/${st.rules.max_members}</h4><table class="pa-members"><thead><tr><th></th><th></th><th colspan="2" class="muted small">Their own rank</th></tr></thead><tbody>${members}</tbody></table>${reqs}
      <p class="muted small">Home court: ${esc(parkName(t.court))}.</p></div>
      <div><h4>The office</h4>
        <div class="pa-office">
          <button class="pa-big" data-office="whiteboard"><b>Whiteboard</b><small>${sr ? `${esc(sr.division.label)} series: ${sr.wins}-${sr.losses} (first to ${sr.need})` : 'No series on: queue a game to start one'}</small></button>
          <button class="pa-big" data-office="draft"><b>Draft clipboard</b><small>${sr ? `${sr.refreshes_left} refreshes left this series` : `${st.rules.refreshes} refreshes a series`}</small></button>
          ${founder ? '<button class="pa-big" data-office="settings"><b>Team settings</b><small>Name, colors, logo, jerseys, home court, open or closed</small></button>' : ''}
          <button class="pa-big" data-invite><b>Invite</b><small>AI friends join at once; players online get an invite (${(t.members || []).length}/${st.rules.max_members})</small></button>
          <button class="pa-big primary" data-queue><b>Queue for the next game</b><small>Ready check, then a team within 2 divisions (or the AI)</small></button>
        </div>
        ${invitesBlock(st)}${myRanks(st)}
        <div class="row gap"><button class="btn ghost small" data-go="join">Find teams</button><button class="btn ghost small" data-leave>Leave team</button></div></div></div></section>`;
}

// ---------------- v0.4.8.9 qp12: the club (docs/PROAM-OVERHAUL.md §11) ----------------
// A roster row: a real player (his own rank) or an AI member (an AI tag, online or offline by his schedule; the founder
// removes him here)
export function memberRow(m, founder = false) {
  if (m.kind === 'ai') return `<tr class="pa-ai"><td><b>${esc(m.name || m.ai_id)}</b> <em class="tag pa-ai-tag">AI</em></td><td>${m.build?.overall ? `${m.build.overall} ${esc(m.build.position || '')}` : ''}</td><td colspan="2"><span class="pa-on${m.online ? ' on' : ''}">${m.online ? 'Online' : 'Offline'}</span>${founder ? ` <button class="btn ghost small" data-removeai="${esc(m.ai_id)}">Remove</button>` : ''}</td></tr>`;
  return `<tr><td><b>${esc(m.username)}</b>${m.founder ? ' <em class="tag">FOUNDER</em>' : ''}</td><td>${m.build ? esc(m.build.name) : '<span class="muted">no build</span>'}</td><td>${m.build ? divChip(m.build.state) : ''}</td><td>${m.build ? rpBar(m.build.state.rp) : ''}</td></tr>`;
}
// the invites waiting for you (the Pro-Am tab: join or decline)
export function invitesBlock(st) {
  if (!st.invites?.length) return '';
  return `<div class="pa-invites"><h4>Club invites</h4>${st.invites.map(i => `<div class="pa-row">${logoTag(i.team)}<span class="pa-row-main"><b>${esc(i.team.name)}</b><small>${esc(i.from)} invited you · ${i.team.size}/${st.rules?.max_members || 10} · ${esc(i.team.division?.label || '')}${st.team ? ' · leave your team to join' : ''}</small></span><button class="btn small" data-acceptinv="${esc(i.team.id)}" ${st.team ? 'disabled' : ''}>Join</button><button class="btn ghost small" data-declineinv="${esc(i.team.id)}">Decline</button></div>`).join('')}</div>`;
}
export async function answerInvite(app, teamId, yes) {
  const r = await paReq(app, 'POST', yes ? '/api/proam/accept_invite' : '/api/proam/decline_invite', { team_id: teamId });
  toast(yes ? 'You\'re in the club.' : 'Invite declined.');
  return r;
}
// "while you were away": the club's games its AI members played since you last looked (server/proam.py club_simulate)
function awayNote(st) {
  const t = st.team, gs = t?.ai_games;
  if (!gs?.length) return;
  const k = `rimrift.pa.aiseen.${t.id}`;
  let seen = 0;
  try { seen = Number(localStorage.getItem(k)) || 0; } catch { /* private mode */ }
  const fresh = gs.filter(g => g.at > seen);
  if (!fresh.length) return;
  try { localStorage.setItem(k, String(Math.max(...gs.map(g => g.at)))); } catch { /* private mode */ }
  const w = fresh.filter(g => g.result === 'W').length, rp = fresh.reduce((n, g) => n + (g.rp || 0), 0), ends = fresh.filter(g => g.series_end).map(g => g.series_end);
  toast(`While you were away, your AI members played ${fresh.length} game${fresh.length === 1 ? '' : 's'} (${w}-${fresh.length - w}) · team RP ${rp >= 0 ? '+' : ''}${rp}${ends.length ? ` · series ${ends.join(', ')}` : ''}.`, w * 2 >= fresh.length ? 'good' : '');
}
// the AI squad mates who come along: online, the squad's AI mates of the real players in the game (as the park carries
// them); offline, your own squad
async function paSquadIds(app, members) {
  try {
    if (app.net?.connected) {
      const Online = await import('./online.js');
      const ids = [app.net.myId, ...(members || []).map(m => m.id).filter(id => id && id !== app.net.myId)];
      return [...new Set(Online.squadAIPlayers(app, ids).map(x => x.entry?.sq?.id).filter(Boolean))].slice(0, 4);
    }
    return (app.ai?.activeSquad?.() || []).slice(0, 4);
  } catch { return []; }
}
// the AI member as the invite sends him: his id in the team's AI world, and a snapshot for the roster
function aiInvitee(app, id) {
  const e = aiEntry(app, id);
  const b = e?.build || {};
  let look = e?.look || null;
  try { if (look && JSON.stringify(look).length > 6000) look = null; } catch { look = null; }
  return { kind: 'ai', ai_id: id, name: e?.name || id, build: { position: b.position, archetype: b.archetype, overall: b.overall, height: b.height, weight: b.weight, wingspan: b.wingspan }, look };
}

// The one invite dialog, the Pro-Am tab's and every HUB office's (game/proamhub.js calls it): AI friends (from your
// friends list, not on a team) join at once; players (online: your friends and the people here, or a username; offline:
// a username on this service) get an invite; and the ones the team has out. Any member invites. -> the dialog's card
export async function openInviteDialog(app, team = null, opts = {}) {
  let st = app.proam;
  try { st = await load(app); } catch (e) { if (!st) { toast(e.message, 'error'); return null; } }
  team = st.team || team;
  if (!team) { toast('You\'re not on a Pro-Am team.', 'error'); return null; }
  let tab = opts.tab || 'ai', busyNow = false;
  const card = modal('<div class="pa-invite-dlg" data-invdlg></div>', { wide: true, close: true, cls: 'pa-office-card' });
  const host = $('[data-invdlg]', card);
  const max = st.rules?.max_members || 10;
  const size = () => (team.members || []).length;
  const onTeam = () => new Set((team.members || []).map(m => m.ai_id || m.account_id));
  const friends = () => {
    const w = app.ai, on = onTeam();
    if (!w?.friends) return [];
    return w.friends.filter(id => !on.has(id)).map(id => ({ id, e: aiEntry(app, id), online: (() => { try { return !!w.online(id); } catch { return false; } })() })).filter(x => x.e);
  };
  const players = () => {
    const net = app.net, on = onTeam(), out = new Map();
    if (!net?.connected) return [];
    for (const f of net.friends || []) if (f.status === 'friends' && f.presence?.online && !on.has(f.id)) out.set(f.id, { id: f.id, username: f.username, why: 'friend, online' });
    for (const [id, p] of net.people || []) if (id !== net.myId && !on.has(id) && !out.has(id)) out.set(id, { id, username: p.username, why: 'here now' });
    return [...out.values()];
  };
  const paint = () => {
    const full = size() >= max;
    const tabs = [['ai', 'AI friends'], ['players', 'Players'], ['sent', `Sent${team.invites_sent?.length ? ` (${team.invites_sent.length})` : ''}`]];
    let body = '';
    if (tab === 'ai') {
      const fs = friends();
      body = fs.length ? fs.map(x => `<div class="pa-row"><b>${esc(x.e.name)}</b><small class="muted">${x.e.build?.overall ?? '?'} ${esc(x.e.build?.position || '')} · ${x.online ? 'online' : 'offline'}</small><span class="grow"></span><button class="btn small" data-invai="${esc(x.id)}" ${full ? 'disabled' : ''}>Add to the club</button></div>`).join('')
        : '<p class="muted">No AI friends who aren\'t in the club. Make friends at the park, then bring them in.</p>';
    } else if (tab === 'players') {
      const ps = players();
      body = `${ps.length ? ps.map(p => `<div class="pa-row"><b>${esc(p.username)}</b><small class="muted">${esc(p.why)}</small><span class="grow"></span><button class="btn small" data-invuser="${esc(p.username)}" ${full ? 'disabled' : ''}>Invite</button></div>`).join('') : `<p class="muted small">${app.net?.connected ? 'None of your friends are online right now.' : 'Offline: invite a player on this game by username.'}</p>`}
        <div class="row gap"><input class="text" data-invname maxlength="24" placeholder="Username"><button class="btn" data-invname-go ${full ? 'disabled' : ''}>Invite</button></div>`;
    } else {
      const sent = team.invites_sent || [];
      body = sent.length ? sent.map(i => `<div class="pa-row"><b>${esc(i.username)}</b><small class="muted">waiting</small><span class="grow"></span><button class="btn ghost small" data-uninv="${esc(i.account_id)}">Take back</button></div>`).join('') : '<p class="muted">No invites out.</p>';
    }
    host.innerHTML = `<div class="eyebrow">CLUB · ${esc(team.name)}</div><h2>Invite to the club</h2>
      <p class="muted small">${size()}/${max} members, real and AI. AI friends join at once; a player gets an invite he accepts from his Pro-Am menu.${full ? ' The club is full.' : ''}</p>
      <div class="chips pa-inv-tabs">${tabs.map(([k, n]) => `<button class="chip ${tab === k ? 'on' : ''}" data-invtab="${k}">${esc(n)}</button>`).join('')}</div>
      <div class="pa-inv-body">${body}</div>`;
    bind();
  };
  const refresh = async () => { try { st = await load(app); team = st.team || team; } catch { /* as it was */ } if (host.isConnected) keepScroll(host, paint); opts.onChange?.(); };
  const send = async (to, b) => {
    if (busyNow || b?.disabled) return; busyNow = true; busy(b, true);
    try { const r = await paReq(app, 'POST', '/api/proam/invite', { team_id: team.id, to }); toast(r.result === 'joined' ? `${to.name || 'He'} is in the club.` : `Invite sent to ${to.username}.`); await refresh(); }
    catch (e) { toast(e.message, 'error'); busy(b, false); } finally { busyNow = false; }
  };
  const bind = () => {
    $$('[data-invtab]', host).forEach(b => b.onclick = () => { tab = b.dataset.invtab; paint(); });
    $$('[data-invai]', host).forEach(b => b.onclick = () => send(aiInvitee(app, b.dataset.invai), b));
    $$('[data-invuser]', host).forEach(b => b.onclick = () => send({ kind: 'player', username: b.dataset.invuser }, b));
    const go = $('[data-invname-go]', host), nm = $('[data-invname]', host);
    if (go) { const f = () => { const u = nm.value.trim(); if (u) send({ kind: 'player', username: u }, go); }; go.onclick = f; nm.onkeydown = e => { if (e.key === 'Enter') f(); }; }
    $$('[data-uninv]', host).forEach(b => b.onclick = async () => { busy(b, true); try { await paReq(app, 'POST', '/api/proam/uninvite', { account_id: b.dataset.uninv }); await refresh(); } catch (e) { toast(e.message, 'error'); busy(b, false); } });
  };
  paint();
  return card;
}

// ---------------- team settings (create and the founder's panel) ----------------
const JERSEY_TIPS = { classic: 'Side panels and trim in your second color', stripe: 'A bold band of your second color round the waist; bands round the shorts', split: 'One side in each color, front and back', gradient: 'Your color fading into the second toward the hem' };
function settingsForm(st, t) {
  const logos = st.rules.logos, v = t || { name: '', abbr: '', primary: '#2457c5', secondary: '#f2c14e', logo: 'bolt', jersey: 'classic', court: null, open: true };
  return `<div class="pa-form">
    <label>Team name<input class="text" data-f="name" maxlength="22" value="${esc(v.name || '')}" placeholder="Night Shift"></label>
    <label>Abbreviation<input class="text abbr" data-f="abbr" maxlength="4" value="${esc(v.abbr || '')}" placeholder="NS"></label>
    <label>Main color<input type="color" data-f="primary" value="${esc(v.primary || '#2457c5')}"></label>
    <label>Second color<input type="color" data-f="secondary" value="${esc(v.secondary || '#f2c14e')}"></label>
    <div class="pa-preview" data-preview><img data-prev-logo alt=""><canvas data-prev-kit width="150" height="195"></canvas><small class="muted">How your team looks in the game</small></div>
    <span class="muted small">Logo</span><div class="chips" data-pick="logo">${logos.map(l => logoChip(l, v, v.logo === l)).join('')}</div>
    <span class="muted small">Jerseys</span><div class="chips" data-pick="jersey">${JERSEYS.map(([k, n]) => `<button class="chip ${(v.jersey || 'classic') === k ? 'on' : ''}" data-val="${k}" title="${esc(JERSEY_TIPS[k] || '')}">${n}</button>`).join('')}</div>
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
    <span class="muted small">Clubhouse logo (its court, logo wall, banners and rug)</span><div class="chips" data-pick="c-logo">${st.rules.logos.map(l => logoChip(l, { primary: cols[0], secondary: cols[1], abbr: t.abbr }, (cu.logo || t.logo || 'bolt') === l)).join('')}</div>
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
  $$('[data-pick]', root).forEach(g => $$('.chip', g).forEach(b => b.onclick = () => { $$('.chip', g).forEach(x => x.classList.toggle('on', x === b)); preview(root); }));
  // (qp14: the preview and the logo chips follow the name, colors and picks as you change them)
  for (const k of ['abbr', 'primary', 'secondary']) { const i = $(`[data-f="${k}"]`, root); if (i) i.addEventListener('input', () => preview(root, true)); }
  preview(root, true);
}
// the team as the game will draw it: its logo and its kit (world/proamkit.js), from what the form says now
function preview(root, recolor = false) {
  const box = $('[data-preview]', root);
  if (!box) return;
  let v;
  try { v = readSettings(root); } catch { return; }
  v.abbr = String(v.abbr || '').toUpperCase();
  const img = $('[data-prev-logo]', box), u = logoURL(v, 128);
  if (img && u) img.src = u;
  const cv = $('[data-prev-kit]', box), g = cv?.getContext?.('2d');
  if (g) drawKit(g, cv.width, cv.height, v, 23);
  if (recolor) $$('[data-pick="logo"] .chip', root).forEach(b => { const im = $('img', b), x = logoURL({ ...v, logo: b.dataset.val }, 48); if (im && x) im.src = x; });
}

// another team's page (search): its division, record, roster (an AI team's players by name and build)
async function showTeam(app, id) {
  let t;
  try { t = (await paReq(app, 'GET', `/api/proam/teams?id=${encodeURIComponent(id)}`)).team; } catch (e) { toast(e.message, 'error'); return; }
  const roster = t.ai ? (t.roster || []).map(i => `<div class="pa-row">${aiLine(app, i)}</div>`).join('') : (t.members || []).map(m => (m.kind === 'ai' ? `<div class="pa-row"><b>${esc(m.name)}</b> <em class="tag pa-ai-tag">AI</em></div>` : `<div class="pa-row"><b>${esc(m.username)}</b>${m.build ? divChip(m.build.state) : ''}</div>`)).join('');
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
    return `<tr class="${g?.result === 'W' ? 'won' : g?.result === 'L' ? 'lost' : ''}"><td>Game ${i + 1}</td><td>${g ? (g.home ? 'Home' : 'Away') : (i % 2 ? 'Away' : 'Home')}</td><td>${g ? `${esc(g.opponent.name)} ${g.opponent.kind === 'ai' ? '<small class="muted">AI</small>' : ''}` : '<span class="muted">to be matched</span>'}</td><td>${g ? esc(venueName(g.venue)) : ''}</td><td>${g?.result ? `<b>${g.result}</b> ${g.score ? g.score.join('-') : ''}${g.by === 'ai' ? ` <small class="muted" title="AI members played: ${esc((g.ai || []).join(', '))}">AI members</small>` : ''}` : g ? 'next' : ''}</td></tr>`;
  }).join('') : '';
  const [len, need] = sr ? [sr.length, sr.need] : seriesShape(team.division.index);
  return `<div class="pa-board"><div class="eyebrow">WHITEBOARD</div><h2>${esc(team.name)}</h2><div class="pa-season">${esc(seasonLine(st.season))}</div>
    <div class="pa-board-cols"><div><h4>${sr ? `${esc(sr.division.label)} series · ${sr.wins}-${sr.losses}` : 'Next series'} <small class="muted">${len} games, first to ${need}</small></h4>
      ${sr ? `<table class="pa-games"><tbody>${games}</tbody></table>` : '<p class="muted">Queue for a game to start the series.</p>'}
      <p class="small">Record this season: games ${record(team.record)}, series ${record(team.series)}</p></div>
    <div><h4>Ranks</h4><div class="pa-row"><b>Team</b>${divChip(team.division, 22)}<span class="grow"></span>${rpBar(teamProgress(team)?.raw ?? team.rp)}</div>${teamProgress(team) ? `<p class="muted small">${esc(teamProgress(team).text)}</p>` : ''}
      ${(team.members || []).map(m => (m.kind === 'ai' ? `<div class="pa-row"><b>${esc(m.name)}</b> <em class="tag pa-ai-tag">AI</em><span class="grow"></span><small class="muted">${m.online ? 'online' : 'offline'}</small></div>`
    : `<div class="pa-row"><b>${esc(m.username)}</b>${m.build ? divChip(m.build.state) : ''}<span class="grow"></span>${m.build ? rpBar(m.build.state.rp) : ''}</div>`)).join('')}</div></div></div>`;
}
function whiteboard(app, st, team) {
  modal(whiteboardHTML(st, team), { wide: true, cls: 'pa-office-card' });
}

async function draftPanel(app, st, team, captain, opts) {
  let d;
  try { d = (await paReq(app, 'POST', '/api/proam/draft', { action: 'view' })).draft; } catch (e) { toast(e.message, 'error'); return; }
  const humans = Math.max(1, opts.humans || 1), open = Math.max(0, 5 - Math.min(5, humans));
  // (the captain's game shows five with a spread of positions out of the server's pool, and tells the server)
  const posOf = id => aiEntry(app, id)?.build?.position || null;
  const want = spreadPick(d.pool, posOf);
  if (captain && want.join() !== d.list.join()) { try { d = (await paReq(app, 'POST', '/api/proam/draft', { action: 'list', ids: want })).draft; } catch { /* keeps the server's */ } }
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
        d = (await paReq(app, 'POST', '/api/proam/draft', { humans, ...body })).draft;
        if (body.action === 'refresh') { const w = spreadPick(d.pool, posOf); try { d = (await paReq(app, 'POST', '/api/proam/draft', { action: 'list', ids: w })).draft; } catch { /* as it is */ } }
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
  if (team.founder !== paMe(app, st)) { toast('The team\'s founder owns its settings.', 'error'); return; }
  const card = modal(`<div class="pa-settings"><div class="eyebrow">TEAM SETTINGS</div><h2>${esc(team.name)}</h2>${settingsForm(st, team)}${customForm(st, team)}
    <h4>Players</h4>${(team.members || []).filter(m => !m.founder).map(m => `<div class="pa-row"><b>${esc(m.username)}</b><span class="grow"></span><button class="btn ghost small" data-handon="${esc(m.account_id)}">Make founder</button><button class="btn ghost small" data-kick="${esc(m.account_id)}">Remove</button></div>`).join('') || '<p class="muted small">Nobody else yet.</p>'}
    <div class="row gap end"><button class="btn primary" data-save>Save</button></div></div>`, { wide: true, cls: 'pa-office-card' });
  bindPicks(card);
  const save = $('[data-save]', card);
  save.onclick = async () => {
    if (save.disabled) return; busy(save, true);
    try { await paReq(app, 'POST', '/api/proam/update', { team: { ...readSettings(card), ...readCustom(card) } }); toast('Team saved.'); closeModal(); opts.onChange?.(); }
    catch (e) { toast(e.message, 'error'); busy(save, false); }
  };
  const act = (path, id, msg) => async () => { if (!(await confirmBox(msg))) return; try { await paReq(app, 'POST', path, { account_id: id }); closeModal(); opts.onChange?.(); } catch (e) { toast(e.message, 'error'); } };
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
  closeModal.onClose = () => { stopped = true; if (app.net?.connected) app.net.send({ t: 'pa-ready', op: 'cancel' }); paReq(app, 'POST', '/api/proam/queue', { action: 'leave' }).catch(() => {}); };
  const say = (h, small = '') => { if (host.isConnected) host.innerHTML = `<div class="eyebrow">PRO-AM · ${esc(team.name)}</div><h2>${h}</h2><p class="muted small">${small}</p>`; };
  // the ready check: every team member connected (the hub's own, opts.ready, when it's there); 20 s, then it goes with
  // those who are ready
  let members = opts.members || null;
  const others = Math.max(0, (team.members || []).filter(m => m.kind !== 'ai').length - 1); // (qp12: the real ones: AI members don't ready up)
  if (app.net?.connected && others) {
    say('Ready check', `Your team: ready up. ${READY_SECS} s, then it goes with those who are.`);
    const Online = await import('./online.js');
    const r = await (opts.ready ? new Promise(res => opts.ready(res, READY_SECS)) : Online.paReadyCheck(app, READY_SECS, others));
    if (stopped) return;
    humans = r?.humans || 1; members = r?.members || members;
  }
  // the matchmaker
  let q;
  try { q = await paReq(app, 'POST', '/api/proam/queue', { action: 'join' }); } catch (e) { toast(e.message, 'error'); closeModal(); return; }
  const t0 = Date.now();
  while (q.state === 'waiting' && !stopped) {
    const left = q.left != null ? Math.ceil(q.left) : Math.max(0, Math.ceil(st.rules.queue_wait - (Date.now() - t0) / 1000));
    say('Finding a game…', `A real team within 2 divisions first${left > 0 ? `: the AI's nearest team in ${left} s if none turns up` : ''}.`);
    await new Promise(r => setTimeout(r, 2000));
    if (stopped) return;
    try { q = await paReq(app, 'POST', '/api/proam/queue', { action: 'poll' }); } catch (e) { toast(e.message, 'error'); closeModal(); return; }
  }
  if (stopped || q.state !== 'matched') return;
  const g = q.game;
  say(`Game ${g.n}: ${esc(g.opponent.name)}`, `${g.home ? 'Home' : 'Away'} · ${esc(venueName(g.venue))} · ${g.opponent.kind === 'ai' ? 'an AI team' : 'a real team'}`);
  // (qp12: who plays: the real players ready, then the AI members here, then the AI squad mates who came, then the draft;
  // opts.aiMembers / opts.squad: the ones the HUB shows; else the server takes the AI members on by their schedule)
  let lineup = [];
  try {
    const squad = opts.squad || await paSquadIds(app, members);
    const lu = await paReq(app, 'POST', '/api/proam/lineup', { humans, squad, ...(opts.aiMembers ? { ai_members: opts.aiMembers } : {}) });
    lineup = lu.ai; app.paLineup = lu;
    const nm = id => aiEntry(app, id)?.name || id;
    if (lu.members?.length || lu.squad?.length) say(`Game ${g.n}: ${esc(g.opponent.name)}`, `With ${[...(lu.members || []).map(i => `${esc(nm(i))} (club)`), ...(lu.squad || []).map(i => `${esc(nm(i))} (squad)`)].join(', ')}${lu.draft?.length ? ` and ${lu.draft.length} from the draft` : ''}.`);
  } catch (e) { toast(e.message, 'error'); }
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
    let r = await paReq(app, 'POST', '/api/proam/queue', { action: 'side', match: g.match, side: { online: true, humans, lineup: ctx.lineup || [] } });
    const t0 = Date.now();
    while (!r.other && !stopped() && !started && Date.now() - t0 < VS_WAIT * 1000) {
      say(`Game ${g.n}: ${esc(g.opponent.name)}`, `Waiting for ${esc(g.opponent.name)}'s Captain…`);
      await new Promise(res => setTimeout(res, 1500));
      r = await paReq(app, 'POST', '/api/proam/queue', { action: 'side', match: g.match });
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
