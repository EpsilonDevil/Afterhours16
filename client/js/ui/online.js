// v0.4.7.5 qp3: playing online with friends. The social phone's Online tab (real players on this game service: friend
// requests by username, who's on and where), invites, the room (the host sets the game up: a park court or the Pro-Am
// arena, together against the AI or against each other) and the start of the game on everyone's screen.
// The connection itself is core/netplay.js; the game runs in lockstep (game/session.js frameOnline).
import { $, $$, esc, toast, closeModal } from './common.js';
import { Net } from '../core/netplay.js';
import { THEMES } from '../world/themes.js';
import { PARK_NAMES } from '../sim/world.js';
import { resolveLook } from '../sim/bots.js';
import { GAME_SPEED } from '../sim/game.js';
import { settings } from '../core/settings.js';
import { badgeTiers } from '../game/park.js';
import { boostedBuild } from '../sim/ratings.js';

export const MAX_ROOM = 6;
const parkName = id => PARK_NAMES[id] || THEMES[id]?.name || 'a park';
const hubOf = app => (app.world && app.world.parkList && app.world.themeId ? app.world : null);

// ---------------- the connection, presence ----------------
// Which game you go online through: the friend's hosted game your own copy is linked to (your save stays yours), or
// this page's own service when it's the hosted one (the host himself, or a friend who came in with join.cmd)
export async function initOnline(app) {
  if (app.net) { if (app.net.hub || app.config?.online?.hosting) app.net.start(); return app.net; }
  const net = app.net = new Net();
  net.entryFn = () => myEntry(app);
  net.on('invite', m => showInvite(app, m));
  net.on('note', m => toast(m.text));
  net.on('error', m => toast(m.text, 'error'));
  net.on('start', s => startOnline(app, s).catch(e => { console.error(e); toast('Could not start the online game: ' + e.message, 'error'); net.send({ t: 'leave' }); }));
  net.on('pos', m => hubOf(app)?.onFriendPos?.(m, net));
  net.on('room', () => { if (!net.room || net.room.members.length < 2) hubOf(app)?.clearFriends?.(); });
  net.on('state', () => { if (!net.connected) hubOf(app)?.clearFriends?.(); });
  // signed in on the host's game from your own copy: keep the token for next time (in your own save)
  net.on('autherror', m => toast(m.text, 'error'));
  net.on('authed', m => { if (net.hub) toast(`Signed in on ${net.hub} as ${m.you?.username || ''}.`); });
  net.on('authed', m => { if (net.hub) app.api.post('/api/online-link', { hub: net.hub, username: m.you?.username || null, token: m.token }).catch(() => {}); });
  let link = null;
  try { link = (await app.api.get('/api/online-link')).link; } catch { link = null; }
  net.link = link;
  net.configure({ hub: link?.hub || null, token: link?.token || null, build: app.config?.build || null });
  if (link || app.config?.online?.hosting) net.start();
  // (just linked: the page reloaded so it may reach the host; back to the Online tab)
  try { if (sessionStorage.getItem('ah16.openOnline')) { sessionStorage.removeItem('ah16.openOnline'); setTimeout(() => import('./phone.js').then(P => P.openPhone(app, { tab: 'online' })), 700); } } catch { /* private mode */ }
  let lastChar = null;
  setInterval(() => {
    if (!net.connected) return;
    const w = whereNow(app);
    net.where(w);
    // (another player picked, or a new look: the room gets your new entry)
    const c = app.char(), key = c ? `${c.id}|${c.overall}|${JSON.stringify(c.equipment || {})}` : null;
    if (key !== lastChar) { lastChar = key; if (net.room) net.sendEntry(); }
    // the host's park is the room's park
    if (net.isHost() && w.park && net.room.park !== w.park) net.send({ t: 'config', config: net.room.config || {}, park: w.park });
  }, 1000);
  // where you're walking in the park, for the rest of the room to see you there (5 times a second)
  setInterval(() => {
    const hub = hubOf(app);
    if (!net.connected || !net.room || net.room.members.length < 2 || !hub || hub.mode !== 'roam') return;
    const me = hub.me, r2 = v => Math.round(v * 100) / 100;
    net.send({ t: 'pos', x: r2(me.x), z: r2(me.z), f: r2(me.facing), m: r2(me.speed || 0), park: hub.themeId });
  }, 200);
  return net;
}

export function whereNow(app) {
  const c = app.char(), hub = hubOf(app);
  let status = 'menu', park = null;
  if (hub) { park = hub.themeId; status = hub.mode === 'roam' ? 'park' : hub.mode === 'match' ? 'game' : 'busy'; }
  else if (app.mode === 'match') status = 'game';
  else if (app.world) status = 'busy';
  return { name: c?.name || null, park, status, char: c ? `${c.overall} ${c.position}` : null };
}

// your player as he goes into an online game: the same entry on every screen (so it plays the same everywhere)
export function myEntry(app) {
  const c = app.char();
  if (!c) return null;
  // (your active boosts play, as in any game: the game's ticket uses one game of each up)
  const boosts = Object.keys(c.boosts || {}).filter(k => (c.boosts[k] | 0) > 0).sort();
  return { build: boostedBuild(c, boosts), name: c.name, look: app.look(c), badges: badgeTiers(c), human: true, username: app.net?.you?.username || '', meterOff: settings.shotMeter === false };
}

const statusText = p => !p || !p.online ? 'Offline' : p.playing ? 'In a game' : p.status === 'game' ? 'In a game' : p.park ? `At ${parkName(p.park)}${p.status === 'busy' ? ' · busy' : ''}` : 'In the menus';

// ---------------- invites ----------------
function showInvite(app, m) {
  document.getElementById('ol-invite')?.remove();
  const el = document.createElement('div');
  el.id = 'ol-invite'; el.className = 'ol-invite';
  el.innerHTML = `<div class="eyebrow">ONLINE INVITE</div><b>${esc(m.name || m.username)}</b><small>${esc(m.username)} wants you in his room${m.park ? ` · at ${esc(parkName(m.park))}` : ''}</small>
    <div class="row gap"><button class="btn small ghost" data-no>Not now</button><button class="btn small primary" data-yes>Join</button></div>`;
  document.body.appendChild(el);
  const done = () => { el.remove(); clearTimeout(t); };
  const t = setTimeout(done, 60000);
  el.querySelector('[data-no]').onclick = done;
  el.querySelector('[data-yes]').onclick = () => { done(); joinRoom(app, m.room, m.park); };
}

export function joinRoom(app, roomId, park) {
  const net = app.net;
  if (app.mode === 'match' || hubOf(app)?.mode === 'match') { toast('Finish your game first, then join.', 'error'); return; }
  net.send({ t: 'join', room: roomId });
  // a park game is played at the host's park: go there (the room panel has the way too)
  if (park && hubOf(app)?.themeId !== park) travel(app, park);
}

async function travel(app, park) {
  const Modes = await import('./modes.js');
  closeModal();
  Modes.enterPark(app, park);
}

// the host's own screen: did the router open the port (server/upnp.py), and the address to give friends
const PUBLIC_NET = ip => !/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip || '');
function hostNote(app) {
  const net = app.net;
  if (!app.config?.online?.hosting) return '';
  if (!net.hostAt || Date.now() - net.hostAt > 10000) {
    net.hostAt = Date.now();
    app.api.get('/api/online').then(r => { const k = JSON.stringify(r.port || null); if (k !== JSON.stringify(net.hostInfo || null)) { net.hostInfo = r.port || null; net.emit('state'); } }).catch(() => {});
  }
  const p = net.hostInfo;
  if (!p) return '';
  const url = p.external_ip && PUBLIC_NET(p.external_ip) ? `http://${p.external_ip}:${p.port}/` : null;
  const cls = p.state === 'open' && url ? 'ok' : p.state === 'working' ? '' : 'warn';
  return `<div class="ol-host ${cls}">${url && p.state === 'open' ? `Friends join at <b>${esc(url)}</b><br>` : ''}${esc(p.message || '')}${p.state === 'failed' && p.internal_ip ? `<br>Forward TCP ${p.port} to ${esc(p.internal_ip)} on your router (README: Play online with friends).` : ''}</div>`;
}

// ---------------- the Online tab on the phone ----------------
export function phoneTab(app) {
  const net = app.net;
  if (!net) return '<p class="ph-empty">Online play starts when you sign in.</p>';
  // your own copy, not linked to anyone's hosted game yet (and not hosting): where to connect
  if (!net.hub && !app.config?.online?.hosting) return linkForm();
  if (net.hub && !net.connected) return signInForm(net);
  const conn = net.connected;
  const head = (conn
    ? `<div class="ph-note">Signed in online as <b>${esc(net.you?.username || '')}</b>. Your friends add you by that username. ${net.hub ? `You're playing through <b>${esc(net.hub)}</b>: your players, VC and progress stay in your own game. <button class="linkish" data-ounlink>Disconnect</button>` : app.config?.online?.hosting ? 'This game is hosted for your friends.' : ''}</div>`
    : `<div class="ph-note">Connecting to the game service… ${net.state === 'off' ? 'retrying' : ''}</div>`) + hostNote(app);
  const fr = net.friends || [];
  const mine = fr.filter(f => f.status === 'friends'), inc = fr.filter(f => f.status === 'incoming'), out = fr.filter(f => f.status === 'requested');
  const room = net.room ? roomHTML(app) : '';
  const inRoom = new Set((net.room?.members || []).map(m => m.id));
  const friendRow = f => {
    const p = f.presence || {};
    const canInvite = conn && p.online && !inRoom.has(f.id) && !p.playing && (net.room?.members.length || 1) < MAX_ROOM;
    const joinable = conn && p.online && p.room && p.host && !p.playing && !inRoom.has(f.id) && net.room?.id !== p.room;
    return `<div class="ph-row"><div class="ph-main"><span class="ol-av">${esc((p.name || f.username).slice(0, 1).toUpperCase())}</span><span class="ph-who"><b>${esc(p.name || f.username)}</b><small>${esc(f.username)}${p.online && p.char ? ' · ' + esc(p.char) : ''}</small><em>${esc(statusText(p))}${inRoom.has(f.id) ? ' · in your room' : ''}</em></span><i class="ph-dot ${p.online ? 'on' : ''}"></i></div>
      ${joinable ? `<button class="ph-act inv" data-join="${esc(p.room)}" data-park="${esc(p.park || '')}">Join</button>` : canInvite ? `<button class="ph-act inv" data-oinv="${esc(f.id)}">Invite</button>` : ''}
      <button class="ph-act" data-ofr="remove" data-u="${esc(f.username)}" title="Remove friend">✕</button></div>`;
  };
  return `${head}${room}
    ${inc.length ? `<div class="ph-sec">Friend requests</div>${inc.map(f => `<div class="ph-row"><div class="ph-main"><span class="ol-av">${esc(f.username.slice(0, 1).toUpperCase())}</span><span class="ph-who"><b>${esc(f.username)}</b><small>wants to be friends</small></span></div><button class="ph-act add" data-ofr="accept" data-u="${esc(f.username)}">Accept</button><button class="ph-act" data-ofr="decline" data-u="${esc(f.username)}">✕</button></div>`).join('')}` : ''}
    <div class="ph-sec">Friends · ${mine.filter(f => f.presence?.online).length} of ${mine.length} online</div>
    ${mine.length ? mine.sort((a, b) => (b.presence?.online ? 1 : 0) - (a.presence?.online ? 1 : 0)).map(friendRow).join('') : '<p class="ph-empty">No friends yet. Add your friends by their username below.</p>'}
    ${out.length ? `<div class="ph-sec">Sent</div>${out.map(f => `<div class="ph-row"><div class="ph-main"><span class="ol-av">${esc(f.username.slice(0, 1).toUpperCase())}</span><span class="ph-who"><b>${esc(f.username)}</b><small>request sent</small></span></div><button class="ph-act" data-ofr="remove" data-u="${esc(f.username)}">Cancel</button></div>`).join('')}` : ''}
    <form class="ol-add" data-oadd><input class="text" name="u" maxlength="24" placeholder="Friend's username" autocomplete="off"><button class="btn small primary" type="submit">Add friend</button></form>
    ${!net.room && conn ? '<div class="ph-acts"><button class="btn small" data-ocreate>Start a room</button></div>' : ''}`;
}

export function bindPhoneTab(app, host, redraw) {
  const net = app.net;
  if (!net) return;
  bindLink(app, host, redraw);
  // (friend requests go over the socket: from your own copy there's no sign-in cookie for the host's service)
  $$('[data-ofr]', host).forEach(b => b.onclick = () => { if (!net.send({ t: 'friend', username: b.dataset.u, action: b.dataset.ofr })) toast('Not connected right now.', 'error'); });
  const add = host.querySelector('[data-oadd]');
  if (add) add.onsubmit = e => {
    e.preventDefault();
    const u = new FormData(add).get('u')?.toString().trim();
    if (!u) return;
    if (net.send({ t: 'friend', username: u, action: 'add' })) add.reset(); else toast('Not connected right now.', 'error');
  };
  $$('[data-oinv]', host).forEach(b => b.onclick = () => { net.send({ t: 'invite', to: b.dataset.oinv }); b.disabled = true; b.textContent = 'Sent'; });
  $$('[data-join]', host).forEach(b => b.onclick = () => { joinRoom(app, b.dataset.join, b.dataset.park || null); });
  const cr = host.querySelector('[data-ocreate]'); if (cr) cr.onclick = () => net.send({ t: 'create' });
  bindRoom(app, host, redraw);
}

// ---------------- your own copy, linked to a friend's hosted game ----------------
function linkForm() {
  return `<div class="ph-sec">Play online with your friends</div>
    <p class="ph-note">Play from this game: your players, VC and progress stay in your own save, and the friend who hosts
      (he runs <b>host.cmd</b>) just connects everyone. Type the address he gives you. You need the same version of the game as him.</p>
    <form class="ol-add" data-olink><input class="text" name="hub" maxlength="80" placeholder="Host's address, e.g. 203.0.113.7" autocomplete="off"><button class="btn small primary" type="submit">Connect</button></form>
    <p class="ph-note">Hosting yourself? Quit the game and run <b>host.cmd</b>.</p>`;
}
function signInForm(net) {
  const e = net.authError;
  const version = e?.code === 'version';
  const waiting = !net.signingIn && !version;
  return `<div class="ph-sec">Online through ${esc(net.hub)}</div>
    ${e ? `<div class="ol-host warn">${esc(e.text)}</div>` : ''}
    ${version ? '<p class="ph-note">Update this copy of the game to the host\'s (the same files he has), restart it, and open this tab again.</p>'
      : waiting ? `<p class="ph-note">Connecting to ${esc(net.hub)}… (is your friend's game running, and his port open?)</p>`
      : `<p class="ph-note">Sign in with your online account on your friend's game, or make one: he gives you the join code. Your players stay in your own game either way.</p>
      <form class="ol-signin" data-osignin>
        <input class="text" name="u" maxlength="24" placeholder="Online username" autocomplete="username">
        <input class="text" name="p" type="password" maxlength="128" placeholder="Password (8+)" autocomplete="current-password">
        <input class="text" name="c" maxlength="64" placeholder="Join code (new accounts)" autocomplete="off">
        <div class="ph-acts"><button class="btn small primary" data-omode="login" type="submit">Sign in</button><button class="btn small" data-omode="register" type="submit">Create account</button></div>
      </form>`}
    <div class="ph-acts"><button class="btn small ghost" data-ounlink>Change host</button></div>`;
}
function bindLink(app, host, redraw) {
  const net = app.net;
  const lf = host.querySelector('[data-olink]');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault();
    const hub = new FormData(lf).get('hub')?.toString().trim();
    if (!hub) return;
    try {
      await app.api.post('/api/online-link', { hub });
      // (the page reloads so it's allowed to reach the host's game, and comes back to this tab)
      try { sessionStorage.setItem('ah16.openOnline', '1'); } catch { /* private mode */ }
      toast('Connecting…'); setTimeout(() => location.reload(), 300);
    } catch (err) { toast(err.message, 'error'); }
  };
  const sf = host.querySelector('[data-osignin]');
  if (sf) sf.onsubmit = e => {
    e.preventDefault();
    const f = new FormData(sf), mode = e.submitter?.dataset.omode || 'login';
    const u = f.get('u')?.toString().trim(), p = f.get('p')?.toString() || '', c = f.get('c')?.toString().trim() || '';
    if (!u || !p) { toast('Username and password, please.', 'error'); return; }
    if (mode === 'register' && !c) { toast('A new account needs the host\'s join code.', 'error'); return; }
    const ok = mode === 'register' ? net.register(u, p, c) : net.login(u, p);
    if (!ok) toast('Not connected to the host yet.', 'error');
  };
  $$('[data-ounlink]', host).forEach(b => b.onclick = async () => {
    try { await app.api.post('/api/online-link', { clear: true }); } catch { /* ignore */ }
    try { sessionStorage.setItem('ah16.openOnline', '1'); } catch { /* private mode */ }
    net.stop(); setTimeout(() => location.reload(), 200);
  });
}

// ---------------- the room ----------------
function defaults(app) {
  const hub = hubOf(app);
  const n = app.net.room?.members.length || 1;
  const court = hub ? Math.max(0, hub.courts.findIndex(c => c.format >= Math.min(3, n))) : 0;
  return { mode: hub ? 'park' : 'proam', court, sides: 'together', target: settings.parkTarget || 21, ql: 180, ante: hub?.cup ? (hub.cupState?.antes?.[0] || 500) : null };
}
const cfgOf = app => ({ ...defaults(app), ...(app.net.room?.config || {}) });

// can the host start? {ok, why}
export function startCheck(app) {
  const net = app.net, r = net.room, cfg = cfgOf(app), hub = hubOf(app);
  if (!r) return { ok: false, why: '' };
  const ms = r.members;
  if (ms.some(m => !m.ready)) return { ok: false, why: 'Waiting for everyone\'s player…' };
  if (cfg.mode === 'park') {
    if (!hub) return { ok: false, why: 'Go to a park to set up a park game.' };
    const c = hub.courts[cfg.court];
    if (!c) return { ok: false, why: 'Pick a court.' };
    const away = ms.filter(m => m.park !== hub.themeId);
    if (away.length) return { ok: false, why: `${away.map(m => m.username).join(', ')} ${away.length > 1 ? 'aren\'t' : 'isn\'t'} at ${parkName(hub.themeId)} yet.` };
    const busy = ms.filter(m => m.status !== 'park');
    if (busy.length) return { ok: false, why: `${busy.map(m => m.username).join(', ')} ${busy.length > 1 ? 'are' : 'is'} busy (a game, the shootaround, a menu).` };
    if (cfg.sides === 'versus' && ms.length < 2) return { ok: false, why: 'Against each other needs two of you.' };
    const per = cfg.sides === 'versus' ? Math.ceil(ms.length / 2) : ms.length;
    if (per > c.format) return { ok: false, why: `${c.name} is ${c.format}v${c.format}: too many of you for one side. Pick a bigger court${cfg.sides === 'together' ? ' or play against each other' : ''}.` };
  } else {
    const busy = ms.filter(m => m.status === 'game' || m.status === 'busy');
    if (busy.length) return { ok: false, why: `${busy.map(m => m.username).join(', ')} ${busy.length > 1 ? 'are' : 'is'} busy.` };
    if (cfg.sides === 'versus' && ms.length < 2) return { ok: false, why: 'Against each other needs two of you.' };
    if (cfg.sides === 'together' && ms.length > 5) return { ok: false, why: 'Five a side: play against each other with six.' };
  }
  return { ok: true, why: '' };
}

function roomHTML(app) {
  const net = app.net, r = net.room, host = net.isHost(), cfg = cfgOf(app), hub = hubOf(app);
  const hostM = r.members.find(m => m.id === r.host);
  const rows = r.members.map(m => `<div class="ol-mem"><span class="ol-av ${m.id === r.host ? 'host' : ''}">${esc((m.name || m.username).slice(0, 1).toUpperCase())}</span><span class="ph-who"><b>${esc(m.name || m.username)}${m.id === r.host ? ' <i class="ph-star">HOST</i>' : ''}</b><small>${esc(m.username)}${m.char ? ' · ' + esc(m.char) : ''}${m.rtt != null ? ` · ${Math.round(m.rtt)} ms` : ''}</small><em>${esc(m.status === 'game' ? 'In a game' : m.park ? `At ${parkName(m.park)}` : 'In the menus')}${m.ready ? '' : ' · getting ready'}</em></span></div>`).join('');
  const chip = (k, v, label, on) => `<button class="chip ${on ? 'on' : ''}" data-ocfg="${k}" data-v="${esc(String(v))}">${esc(label)}</button>`;
  let conf;
  if (host) {
    const courts = hub ? hub.courts.map((c, i) => chip('court', i, `${c.name}${/\dv\d/.test(c.name) ? '' : ` · ${c.format}v${c.format}`}${c.full && !/full/i.test(c.name) ? ' full court' : ''}`, cfg.court === i)).join('') : '';
    const chk = startCheck(app);
    conf = `<div class="ol-cfg">
      <div class="chips">${chip('mode', 'park', 'Park game', cfg.mode === 'park')}${chip('mode', 'proam', 'Pro-Am 5v5', cfg.mode === 'proam')}</div>
      ${cfg.mode === 'park' ? (hub ? `<small class="muted">Court at ${esc(parkName(hub.themeId))}</small><div class="chips">${courts}</div>` : '<p class="ph-note">Go to a park to pick a court.</p>') : ''}
      <div class="chips">${chip('sides', 'together', 'Together vs the AI', cfg.sides === 'together')}${chip('sides', 'versus', 'Against each other', cfg.sides === 'versus')}</div>
      ${cfg.mode === 'park' ? `<div class="chips">${[11, 15, 21].map(t => chip('target', t, `To ${t}`, cfg.target === t)).join('')}</div>` : `<div class="chips">${[[120, '2 min'], [180, '3 min'], [300, '5 min']].map(([v, l]) => chip('ql', v, `${l} quarters`, cfg.ql === v)).join('')}</div>`}
      ${cfg.mode === 'park' && hub?.cup ? `<small class="muted">Ante (everyone puts it up)</small><div class="chips">${(hub.cupState?.antes || [500, 1000, 2500, 5000, 10000]).map(a => chip('ante', a, a.toLocaleString() + ' VC', cfg.ante === a)).join('')}</div>` : ''}
      <div class="ph-acts"><button class="btn primary" data-ostart ${chk.ok ? '' : 'disabled'}>Start the game</button></div>
      ${chk.why ? `<p class="ph-note">${esc(chk.why)}</p>` : ''}</div>`;
  } else {
    const where = r.park ? parkName(r.park) : null;
    const travelBtn = cfg.mode === 'park' && r.park && hub?.themeId !== r.park ? `<button class="btn small primary" data-otravel="${esc(r.park)}">Go to ${esc(where)}</button>` : '';
    conf = `<p class="ph-note">${esc(hostM?.username || 'The host')} sets the game up: ${cfg.mode === 'proam' ? 'Pro-Am 5v5 in the arena' : `a park game${where ? ` at ${esc(where)}` : ''}`}, ${cfg.sides === 'versus' ? 'against each other' : 'together against the AI'}. You're in as soon as he starts it.</p>${travelBtn ? `<div class="ph-acts">${travelBtn}</div>` : ''}`;
  }
  return `<div class="ol-room"><div class="ph-sec">Your room · ${r.members.length}/${MAX_ROOM}${r.status === 'playing' ? ' · playing' : ''}</div>${rows}${conf}
    <div class="ph-acts"><button class="btn small ghost" data-oleave>Leave room</button></div></div>`;
}

function bindRoom(app, host, redraw) {
  const net = app.net;
  $$('[data-ocfg]', host).forEach(b => b.onclick = () => {
    const cfg = cfgOf(app), k = b.dataset.ocfg, v = b.dataset.v;
    cfg[k] = k === 'mode' || k === 'sides' ? v : +v;
    net.send({ t: 'config', config: cfg, park: hubOf(app)?.themeId || null });
    if (net.room) net.room.config = cfg;
    redraw();
  });
  const lv = host.querySelector('[data-oleave]'); if (lv) lv.onclick = () => { net.send({ t: 'leave' }); };
  const tr = host.querySelector('[data-otravel]'); if (tr) tr.onclick = () => travel(app, tr.dataset.otravel);
  const st = host.querySelector('[data-ostart]'); if (st) st.onclick = () => {
    const chk = startCheck(app);
    if (!chk.ok) { toast(chk.why, 'error'); return; }
    try { net.send({ t: 'start', setup: buildSetup(app) }); st.disabled = true; st.textContent = 'Starting…'; }
    catch (e) { console.error(e); toast(e.message, 'error'); }
  };
}

// ---------------- the host sets the game up ----------------
// the input delay (ticks) for this room: long enough for an input to go from the slowest player through the service
// to the next slowest (half of each one's round trip) with a little to spare; 3 ticks (~45 ms) at the least
export function inputDelay(rtts) {
  const r = [...rtts].map(v => (typeof v === 'number' && v >= 0 ? v : 80)).sort((a, b) => b - a);
  const oneWay = ((r[0] || 0) + (r[1] || 0)) / 2;
  const tickMs = 1000 / (60 * GAME_SPEED);
  return Math.max(3, Math.min(15, Math.ceil((oneWay + 30) / tickMs)));
}

const ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];
export function buildSetup(app) {
  const net = app.net, r = net.room, cfg = cfgOf(app), hub = hubOf(app), cat = app.catalog;
  const members = r.members.filter(m => net.entries[m.id]);
  const human = m => { const e = structuredClone(net.entries[m.id]); e.human = true; e.look = e.look || resolveLook({ ...e.build, name: e.name }, cat); e.username = m.username; return e; };
  const sides = [[], []];
  members.forEach((m, i) => sides[cfg.sides === 'versus' ? i % 2 : 0].push({ m, e: human(m) }));
  const seed = (Math.random() * 2147483646 | 0) + 1;
  let fmt, rosters, teams, extra = {};
  if (cfg.mode === 'park') {
    const c = hub.courts[cfg.court];
    fmt = c.format;
    const need = 2 * fmt - members.length;
    const ai = (need > 0 ? hub.takeEntries(need, { topUp: true, level: 0.62 }) : []) || [];
    if (ai.length < need) throw new Error('Not enough people at the park to fill the teams. Try a smaller court.');
    rosters = sides.map(s => s.map(x => x.e));
    for (const e of ai) { const t = rosters[0].length < fmt ? 0 : 1; rosters[t].push({ ...e, human: false, look: e.look || resolveLook(e.build, cat) }); }
    const nm = s => (s[0] ? `${s[0].m.username}'s squad` : 'Court Kings');
    teams = cfg.sides === 'versus'
      ? [{ name: nm(sides[0]), abbr: sides[0][0].m.username.slice(0, 3).toUpperCase(), color: '#ffd84a' }, { name: nm(sides[1]), abbr: sides[1][0].m.username.slice(0, 3).toUpperCase(), color: '#4ac8ff' }]
      : [{ name: nm(sides[0]), abbr: 'SQD', color: hub.aff?.color || '#ffd84a' }, { name: 'Court Kings', abbr: 'KNG', color: '#e8e3d8' }];
    extra = { park: hub.themeId, court: cfg.court, full: !!c.full, target: cfg.target, ante: hub.cup ? cfg.ante : null };
  } else {
    fmt = 5;
    const w = app.ai, used = new Set();
    const fill = (list, level, key) => {
      const open = ORDER.filter(p => !list.some(x => x.build.position === p));
      while (list.length < 5) { const position = open.shift() || ORDER[list.length % 5]; const id = w.pick({ position, level, exclude: used, key: key + list.length }); used.add(id); list.push({ ...w.gameEntry(id), human: false }); }
      return list;
    };
    rosters = sides.map((s, t) => fill(s.map(x => x.e), 0.62 + (t ? 0.02 : 0), `ol${seed}-${t}-`));
    const t0 = app.profile?.proam_team;
    const brand = { name: t0?.name || `${members[0].username}'s team`, abbr: t0?.abbr || members[0].username.slice(0, 3).toUpperCase(), primary: t0?.primary || '#2457c5', secondary: t0?.secondary || '#f2c14e', logo: t0?.logo || 'bolt', wood: t0?.wood || 'natural' };
    const opp = cfg.sides === 'versus'
      ? { name: `${sides[1][0].m.username}'s team`, abbr: sides[1][0].m.username.slice(0, 3).toUpperCase(), primary: '#c8322f', secondary: '#111111' }
      : { name: 'Night Owls', abbr: 'NOW', primary: '#c8322f', secondary: '#111111' };
    if (opp.primary === brand.primary) { opp.primary = '#1f7a4d'; opp.secondary = '#f4f2ec'; }
    const uni = (b, n) => ({ top: { family: 'jersey', color: b.primary, trim: b.secondary, secondary: b.secondary, pattern: 'panel', lettering: b.abbr, tucked: true }, bottom: { family: 'shorts', color: b.primary, trim: b.secondary, stripe: b.secondary }, number: n });
    rosters.forEach((ro, t) => ro.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, cat, { ...uni(t ? opp : brand, e.build.appearance?.number ?? (i * 7 + 3) % 50), name: e.name }); }));
    teams = [{ name: brand.name, abbr: brand.abbr, color: brand.primary }, { name: opp.name, abbr: opp.abbr, color: opp.primary }];
    extra = { branding: brand, quarterLen: cfg.ql };
  }
  // who plays whom: player index = team 0 in order, then team 1
  const slots = {}, names = {}, meter = {};
  let i = 0;
  rosters.forEach(ro => ro.forEach(e => {
    if (e.human) { const m = members.find(x => x.username === e.username); if (m) { slots[m.id] = i; names[i] = m.username; meter[i] = !!e.meterOff; } }
    i++;
  }));
  return { mode: cfg.mode, format: fmt, sides: cfg.sides, seed, rosters, teams, slots, names, meter, delay: inputDelay(r.members.map(m => m.rtt)), difficulty: settings.difficulty ?? 0.6, host: net.you.id, ...extra };
}

// ---------------- the start, on every screen ----------------
export async function startOnline(app, setup) {
  const net = app.net, local = setup.slots?.[net.you?.id];
  if (local == null) return; // (not in this one: joined after it started)
  document.getElementById('ol-invite')?.remove();
  if (setup.mode === 'park') {
    let hub = hubOf(app);
    if (!hub || hub.themeId !== setup.park) { toast(`The game is at ${parkName(setup.park)}: you have to be there to play. The AI takes your spot.`, 'error'); net.send({ t: 'leave' }); return; }
    // (still on the last game's results: off the court first)
    if (hub.mySession && hub.mySession.ended && hub.onlineGame) { closeModal(); hub.leaveOnlineCourt(hub.mySession); }
    if (hub.mode === 'practice') hub.endPractice();
    if (hub.mode !== 'roam') { toast('You were busy: the AI takes your spot in this one.', 'error'); net.send({ t: 'leave' }); return; }
    closeModal();
    await hub.startOnlineGame(setup, local);
  } else {
    const Modes = await import('./modes.js');
    closeModal();
    await Modes.playProAmOnline(app, setup, local);
  }
}
