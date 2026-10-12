// v0.4.7.5 qp3: playing online with friends, in the base game itself. The real people on the hosted game are where you
// are: at the same park (or Crew HQ) you see them walk around, their Got Next claims and the games they play (you can
// watch them from the sideline). Friends make squads (up to five, they go everywhere together: Got Next, Pro-Am, the
// Crew HQ), challenge each other's squads to Pro-Am, and play in each other's online crews.
// This file: the connection's listeners (core/netplay.js is the socket), your presence, the invites that pop up, the
// social phone's Online tab, the helpers every online game setup uses, and the start of an online game on each screen.
// The games run in lockstep (game/session.js frameOnline); park games are set up in game/park.js, Pro-Am in
// ui/modes.js, crew runs in game/crewhq.js.
import { $$, esc, toast, closeModal } from './common.js';
import { Net } from '../core/netplay.js';
import { THEMES } from '../world/themes.js';
import { PARK_NAMES } from '../sim/world.js';
import { resolveLook } from '../sim/bots.js';
import { GAME_SPEED } from '../sim/game.js';
import { settings } from '../core/settings.js';
import { badgeTiers } from '../game/park.js';
import { boostedBuild } from '../sim/ratings.js';

export const MAX_SQUAD = 5;
export const parkName = id => !id ? 'somewhere' : String(id).startsWith('hq:') ? 'a Crew HQ' : PARK_NAMES[id] || THEMES[id]?.name || 'a park';
const hubOf = app => (app.world && app.world.parkList && app.world.themeId ? app.world : null);
// the park or Crew HQ you're in, when it shows the people there (game/park.js, game/crewhq.js)
const placeOf = app => (app.world && app.world.placeKey ? app.world : null);

// ---------------- the connection, presence ----------------
// Which game you go online through: the friend's hosted game your own copy is linked to (your save stays yours), or
// this page's own service when it's the hosted one (the host himself, or a friend who came in with join.cmd)
export async function initOnline(app) {
  if (app.net) { if (app.net.hub || app.config?.online?.hosting) app.net.start(); return app.net; }
  const net = app.net = new Net();
  net.entryFn = () => myEntry(app);
  net.on('note', m => toast(m.text));
  net.on('error', m => { toast(m.text, 'error'); placeOf(app)?.onError?.(m); });
  net.on('crew-error', m => toast(m.text, 'error'));
  net.on('sqinvite', m => popInvite(app, 'sq', {
    eyebrow: 'SQUAD INVITE', title: m.name || m.username, text: `${m.username} wants you in his squad${m.size > 1 ? ` (${m.size} of them)` : ''}${m.park ? ` · ${parkName(m.park)}` : ''}`,
    yes: 'Join', onYes: () => net.send({ t: 'sq-accept', from: m.from }), onNo: () => net.send({ t: 'sq-decline', from: m.from }),
  }));
  net.on('challenge', m => popInvite(app, 'ch', {
    eyebrow: 'PRO-AM CHALLENGE', title: m.name || m.username, text: `${m.username}${m.size > 1 ? `'s squad of ${m.size}` : ''} wants to run Pro-Am against ${net.squad ? 'your squad' : 'you'} in the arena`,
    yes: 'Accept', onYes: () => net.send({ t: 'challenge-reply', from: m.from, ok: true }), onNo: () => net.send({ t: 'challenge-reply', from: m.from, ok: false }),
  }));
  net.on('challenge-go', m => import('./modes.js').then(Modes => Modes.startProAmOnline(app, m.opp)).catch(e => { console.error(e); toast(e.message, 'error'); }));
  net.on('crewinvite', m => popInvite(app, 'crew', {
    eyebrow: 'CREW INVITE', title: `${m.crew?.name || 'A crew'} [${m.crew?.tag || ''}]`, text: `${m.from} wants you in his crew (level ${m.crew?.level || 1}). Your games add crew XP to it.`,
    yes: 'Join the crew', onYes: () => net.send({ t: 'crew-accept', crew: m.crew?.id }),
  }));
  net.on('crew-pending', m => collectCrewXP(app, m.xp));
  net.on('crew', () => { crewSync(app); placeOf(app)?.onCrew?.(); });
  net.on('claimed', m => hubOf(app)?.onClaimed?.(m));
  net.on('start', s => startOnline(app, s).catch(e => { console.error(e); toast('Could not start the online game: ' + e.message, 'error'); net.send({ t: 'quit' }); }));
  net.on('watch', s => { const w = placeOf(app); if (w && s.where && s.where === w.placeKey()) w.watchGame?.(s); });
  net.on('watchend', m => placeOf(app)?.endWatch?.(m.g));
  net.on('pos', m => placeOf(app)?.onPeerPos?.(m));
  net.on('people', m => placeOf(app)?.onPeople?.(m));
  net.on('courts', () => placeOf(app)?.onCourts?.());
  net.on('state', () => { if (!net.connected) placeOf(app)?.clearPeers?.(); });
  net.on('squad', () => followSquad(app));
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
  let lastChar = null, lastAI = null;
  setInterval(() => {
    if (!net.connected) { lastChar = null; lastAI = null; return; }
    net.where(whereNow(app));
    // (another player picked, or a new look: the people where you are see you with it)
    const c = app.char(), key = c ? `${c.id}|${c.overall}|${JSON.stringify(c.equipment || {})}|${JSON.stringify(c.boosts || {})}` : null;
    if (key !== lastChar) { lastChar = key; net.sendEntry(); }
    // (your AI squad mates: they walk with you on everyone's screen and run in your online squad)
    const ai = myAISquad(app), aiKey = ai.map(a => `${a.id}:${a.entry.build.overall}`).join(',');
    if (aiKey !== lastAI) { lastAI = aiKey; net.send({ t: 'aisquad', members: ai }); }
  }, 1000);
  // where you're walking, for the others at the same park or HQ to see you there (5 times a second)
  setInterval(() => {
    const w = placeOf(app);
    if (!net.connected || !w || w.mode !== 'roam' || !net.people.size || net.place !== w.placeKey()) return;
    const me = w.me, r2 = v => Math.round(v * 100) / 100;
    net.send({ t: 'pos', x: r2(me.x), z: r2(me.z), f: r2(me.facing), m: r2(me.speed || 0) });
  }, 200);
  return net;
}

export function whereNow(app) {
  const c = app.char(), w = placeOf(app), net = app.net;
  let status = 'menu', park = null;
  if (w) { park = w.placeKey(); status = w.mode === 'roam' ? 'park' : w.mode === 'match' || w.mode === 'starting' ? 'game' : 'busy'; }
  else if (app.mode === 'match') status = 'game';
  else if (app.world) status = 'busy';
  // (the round trip in 25 ms steps: online games pick their input delay from everyone's)
  return { name: c?.name || null, park, status, char: c ? `${c.overall} ${c.position}` : null, rtt: net?.rtt != null ? Math.min(2000, Math.round(net.rtt / 25) * 25) : null };
}
// (straight away, when you arrive somewhere: the others see you, and you them, without waiting for the next second)
export function touchWhere(app) { const net = app.net; if (net?.connected) net.where(whereNow(app)); }

// your player as he goes into an online game: the same entry on every screen (so it plays the same everywhere)
export function myEntry(app) {
  const c = app.char();
  if (!c) return null;
  // (your active boosts play, as in any game: the game's ticket uses one game of each up)
  const boosts = Object.keys(c.boosts || {}).filter(k => (c.boosts[k] | 0) > 0).sort();
  return { build: boostedBuild(c, boosts), name: c.name, look: app.look(c), badges: badgeTiers(c), human: true, username: app.net?.you?.username || '', meterOff: settings.shotMeter === false };
}

const statusText = p => !p || !p.online ? 'Offline' : p.playing || p.status === 'game' ? 'In a game' : p.park ? `At ${parkName(p.park)}${p.status === 'busy' ? ' · busy' : ''}` : 'In the menus';

// ---------------- helpers for every online game's setup ----------------
// the input delay (ticks) for a game: long enough for an input to go from the slowest player through the service
// to the next slowest (half of each one's round trip) with a little to spare; 3 ticks (~45 ms) at the least
export function inputDelay(rtts) {
  const r = [...rtts].map(v => (typeof v === 'number' && v >= 0 ? v : 80)).sort((a, b) => b - a);
  const oneWay = ((r[0] || 0) + (r[1] || 0)) / 2;
  const tickMs = 1000 / (60 * GAME_SPEED);
  return Math.max(3, Math.min(15, Math.ceil((oneWay + 30) / tickMs)));
}
export const newSeed = () => (Math.random() * 2147483646 | 0) + 1;
// a real player in a setup: {id, username, entry} (you, or anyone the service told you about)
export function personOf(app, id) {
  const net = app.net;
  if (id === net.myId) return { id, username: net.you.username, entry: myEntry(app), rtt: net.rtt };
  const p = net.people.get(id), m = net.squad?.members.find(x => x.id === id);
  const entry = net.entryOf(id);
  return entry ? { id, username: p?.username || m?.username || net.usernameOf(id), entry, rtt: p?.rtt ?? m?.rtt ?? null } : null;
}
// a roster entry as it goes into a setup: his look resolved (the same on every screen), human or not
export function setupEntry(app, e, human, username = null) {
  const out = { build: e.build, name: e.name, look: e.look || resolveLook({ ...e.build, name: e.name }, app.catalog), badges: e.badges || {}, human: !!human };
  // (an AI player plays with his own basketball IQ, jersey number and Icon badge, the same as in his owner's games)
  for (const k of ['iq', 'number', 'icon']) if (e[k] != null) out[k] = e[k];
  if (e.sq) out.sq = e.sq; // (an AI squad mate: whose, and who he is in his owner's game)
  if (human) { out.username = username || e.username || ''; out.meterOff = !!e.meterOff; }
  return out;
}
// slots, names and shot-meter settings of a setup's people: rosters are team 0 then team 1; people: [{id, username}]
// by roster entry (the entry objects themselves)
export function seatPeople(rosters, people) {
  const slots = {}, names = {}, meter = {};
  let i = 0;
  for (const ro of rosters) for (const e of ro) {
    const p = people.get(e);
    if (p) { slots[p.id] = i; names[i] = p.username; meter[i] = !!e.meterOff; }
    i++;
  }
  return { slots, names, meter };
}
// squad mates who can play with you now (not in a game); here: only the ones at the same place
export function freeSquad(app, here = false) {
  const net = app.net;
  return (net.squad?.members || []).filter(m => m.id !== net.myId && !m.inGame && m.status !== 'game' && (!here || (m.park && m.park === net.place)));
}
export const netOn = app => !!app.net?.connected;

// Your AI squad mates (the friends from your own game's world who run with you): in the online squad they're your
// squad's too, so they go to the hosted game with you: [{id, name, entry}] (entry without your world's ids)
export function myAISquad(app) {
  const w = app.ai;
  if (!w?.activeSquad) return [];
  return w.activeSquad().slice(0, 4).map(id => {
    const e = w.gameEntry(id);
    const entry = { build: e.build, name: e.name, badges: e.badges || {} };
    for (const k of ['iq', 'number', 'icon']) if (e[k] != null) entry[k] = e[k];
    return { id, name: e.name, entry };
  });
}
// AI squad mates as setup players ({entry} tagged with whose they are): yours from your own world, the others' as the
// hosted game has them
export function squadAIPlayers(app, ownerIds) {
  const net = app.net, out = [];
  for (const owner of ownerIds) {
    const list = owner === net.myId ? myAISquad(app) : net.aiOf(owner);
    for (const a of list) out.push({ entry: { ...a.entry, sq: { owner, id: a.id } } });
  }
  return out;
}

// ---------------- popups: squad / Pro-Am / crew invites ----------------
function popInvite(app, kind, o) {
  const id = `ol-invite-${kind}`;
  document.getElementById(id)?.remove();
  const el = document.createElement('div');
  el.id = id; el.className = 'ol-invite';
  el.style.top = `${74 + 150 * ['sq', 'ch', 'crew'].indexOf(kind)}px`;
  el.innerHTML = `<div class="eyebrow">${esc(o.eyebrow)}</div><b>${esc(o.title)}</b><small>${esc(o.text)}</small>
    <div class="row gap"><button class="btn small ghost" data-no>Not now</button><button class="btn small primary" data-yes>${esc(o.yes)}</button></div>`;
  document.body.appendChild(el);
  const done = () => { el.remove(); clearTimeout(t); };
  const t = setTimeout(done, 60000);
  el.querySelector('[data-no]').onclick = () => { done(); o.onNo?.(); };
  el.querySelector('[data-yes]').onclick = () => { done(); o.onYes?.(); };
}
const clearInvites = () => document.querySelectorAll('.ol-invite').forEach(el => el.remove());

// ---------------- your squad goes where its leader goes ----------------
// A squad member who's walking around a park (or the HQ) follows the leader to the park he went to; one in the menus
// is told where the squad is
function followSquad(app) {
  const net = app.net, sq = net.squad;
  if (!sq || net.isLeader()) { net.following = null; return; }
  const lead = sq.members.find(m => m.id === sq.leader), target = lead?.park || null;
  const w = placeOf(app), here = w ? w.placeKey() : null;
  if (!target || target === here) { net.following = null; return; }
  if (net.following === target) return;
  const hq = target.startsWith('hq:');
  if (hq && net.crew?.id !== target.slice(3)) return; // (a crew's HQ is for its members)
  if (hq ? false : THEMES[target]?.event && app.config?.event?.id !== target) return;
  net.following = target;
  if (w && w.mode === 'roam' && !app.modalOpen()) {
    toast(`Following ${lead.name || lead.username} to ${hq ? 'the Crew HQ' : parkName(target)}…`);
    import('./modes.js').then(Modes => { if (hq) Modes.enterHQ(app, hubOf(app)?.themeId || app.char()?.affiliation || 'harbor', { online: true }); else Modes.enterPark(app, target); });
  } else toast(`Your squad is at ${hq ? 'the Crew HQ' : parkName(target)}. ${w ? 'Finish up here, then head over.' : 'Head over when you\'re ready.'}`);
}

export async function travel(app, park) {
  const Modes = await import('./modes.js');
  closeModal();
  Modes.enterPark(app, park);
}

// ---------------- online crews ----------------
// The founder's own crew (the one in his save) goes online when he brings it online; friends he invites play in it.
// Their games' crew XP waits on the hosted game until his game collects it into his save.
export function crewSync(app, force = false) {
  const net = app.net, cr = app.crew;
  if (!net?.connected || !cr) return;
  if (!force && net.crew?.founder !== net.myId) return;
  const want = { name: cr.name, tag: cr.tag, color: cr.color, level: cr.level?.level || 1, xp: cr.level?.xp || 0 };
  const have = net.crew;
  if (!force && have && have.name === want.name && have.tag === want.tag && have.color === want.color && have.level === want.level && have.xp === want.xp) return;
  net.send({ t: 'crew-sync', crew: want });
}
async function collectCrewXP(app, xp) {
  const net = app.net;
  if (!(xp > 0) || net.collecting) return;
  net.collecting = true;
  try {
    const r = await app.api.mutate('/api/crew', { action: 'online_xp', xp });
    app.crew = r.crew;
    net.send({ t: 'crew-ack', xp });
    toast(`+${xp.toLocaleString()} crew XP from your crew's online games.`);
    crewSync(app);
  } catch (e) { console.warn('crew XP not collected', e); }
  finally { net.collecting = false; }
}
// the crew mates (real ones, in your online crew) on your side of a game you just played: ids of the people on it
export function crewMatesIn(app, aids) {
  const net = app.net, mem = new Set((net?.crew?.members || []).map(m => m.id));
  return aids.filter(a => a !== net?.myId && mem.has(a)).length;
}
// after a game: a member of a friend's online crew sends its crew XP (the same share of the Rep as a crew of your own)
const CREW_SHARE = 0.3, MODE_WEIGHT = { park: 1.1, proam: 1.3, event: 1.5 };
export function reportCrewXP(app, result, { mode, venue, mates = 0 } = {}) {
  const net = app.net;
  if (!net?.connected || !net.crew || net.crew.founder === net.myId || !result?.rep) return 0;
  const w = THEMES[venue]?.event ? MODE_WEIGHT.event : MODE_WEIGHT[mode] || 0;
  const xp = Math.round(Math.max(0, result.rep) * CREW_SHARE * w * (mates > 0 ? 2 : 1));
  if (xp > 0) net.send({ t: 'crewxp', xp: Math.min(5000, xp) });
  return xp;
}

// ---------------- the host's own screen: did the router open the port (server/upnp.py) ----------------
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
const av = (s, cls = '') => `<span class="ol-av ${cls}">${esc(String(s || '?').slice(0, 1).toUpperCase())}</span>`;
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
  const inSquad = new Set((net.squad?.members || []).map(m => m.id));
  const crewIds = new Set((net.crew?.members || []).map(m => m.id));
  const lead = net.isLeader(), founder = net.crew?.founder === net.myId;
  const herePlace = placeOf(app)?.placeKey() || null;
  const friendRow = f => {
    const p = f.presence || {}, on = conn && p.online, free = on && !p.playing && p.status !== 'game';
    const acts = [];
    if (on && lead && !inSquad.has(f.id) && (net.squad?.members.length || 1) < MAX_SQUAD) acts.push(`<button class="ph-act inv" data-osq="${esc(f.id)}" title="Invite to your squad">Squad</button>`);
    if (free && lead && !inSquad.has(f.id)) acts.push(`<button class="ph-act inv" data-och="${esc(f.id)}" title="Challenge to Pro-Am">Pro-Am</button>`);
    if (on && founder && !crewIds.has(f.id)) acts.push(`<button class="ph-act inv" data-ocrew="${esc(f.id)}" title="Invite to your crew">Crew</button>`);
    if (on && p.park && !p.park.startsWith('hq:') && p.park !== herePlace) acts.push(`<button class="ph-act" data-ogo="${esc(p.park)}" title="Go to his park">Go</button>`);
    return `<div class="ph-row"><div class="ph-main">${av(p.name || f.username)}<span class="ph-who"><b>${esc(p.name || f.username)}</b><small>${esc(f.username)}${on && p.char ? ' · ' + esc(p.char) : ''}</small><em>${esc(statusText(p))}${inSquad.has(f.id) ? ' · your squad' : p.squad && p.squad.size > 1 ? ` · squad of ${p.squad.size}` : ''}</em></span><i class="ph-dot ${on ? 'on' : ''}"></i></div>
      ${acts.join('')}<button class="ph-act" data-ofr="remove" data-u="${esc(f.username)}" title="Remove friend">✕</button></div>`;
  };
  return `${head}${conn ? squadHTML(app) + crewHTML(app) : ''}
    ${inc.length ? `<div class="ph-sec">Friend requests</div>${inc.map(f => `<div class="ph-row"><div class="ph-main">${av(f.username)}<span class="ph-who"><b>${esc(f.username)}</b><small>wants to be friends</small></span></div><button class="ph-act add" data-ofr="accept" data-u="${esc(f.username)}">Accept</button><button class="ph-act" data-ofr="decline" data-u="${esc(f.username)}">✕</button></div>`).join('')}` : ''}
    <div class="ph-sec">Friends · ${mine.filter(f => f.presence?.online).length} of ${mine.length} online</div>
    ${mine.length ? mine.sort((a, b) => (b.presence?.online ? 1 : 0) - (a.presence?.online ? 1 : 0)).map(friendRow).join('') : '<p class="ph-empty">No friends yet. Add your friends by their username below.</p>'}
    ${out.length ? `<div class="ph-sec">Sent</div>${out.map(f => `<div class="ph-row"><div class="ph-main">${av(f.username)}<span class="ph-who"><b>${esc(f.username)}</b><small>request sent</small></span></div><button class="ph-act" data-ofr="remove" data-u="${esc(f.username)}">Cancel</button></div>`).join('')}` : ''}
    <form class="ol-add" data-oadd><input class="text" name="u" maxlength="24" placeholder="Friend's username" autocomplete="off"><button class="btn small primary" type="submit">Add friend</button></form>`;
}

// your squad: who's in it, where they are; the leader calls next, sets up Pro-Am and invites
export function squadHTML(app) {
  const net = app.net, sq = net.squad;
  if (!sq) return `<div class="ol-room"><div class="ph-sec">Squad</div><p class="ph-note">Invite friends to your squad (Squad on a friend below). A squad of up to ${MAX_SQUAD} goes everywhere together: it calls Got Next as one, runs Pro-Am as one team, and follows its leader from park to park.</p></div>`;
  const lead = net.isLeader();
  // (each member's AI squad mates from his own game run in the squad too)
  const aiRows = m => (m.ai || []).map(a => `<div class="ol-mem ol-ai"><span class="ol-av ai">${esc(String(a.name || '?').slice(0, 1))}</span><span class="ph-who"><b>${esc(a.name)}</b><small>AI · ${a.ovr ?? ''} ${esc(a.pos || '')} · with ${esc(m.name || m.username)}</small></span></div>`).join('');
  const rows = sq.members.map(m => `<div class="ol-mem">${av(m.name || m.username, m.id === sq.leader ? 'host' : '')}<span class="ph-who"><b>${esc(m.name || m.username)}${m.id === sq.leader ? ' <i class="ph-star">LEADER</i>' : ''}${m.id === net.myId ? ' <small>(you)</small>' : ''}</b><small>${esc(m.username)}${m.char ? ' · ' + esc(m.char) : ''}${m.rtt != null ? ` · ${m.rtt} ms` : ''}</small><em>${esc(m.inGame || m.status === 'game' ? 'In a game' : m.park ? `At ${parkName(m.park)}` : 'In the menus')}</em></span>${lead && m.id !== net.myId ? `<button class="ph-act" data-okick="${esc(m.id)}" title="Out of the squad">✕</button>` : ''}</div>${aiRows(m)}`).join('');
  const nAI = sq.members.reduce((s, m) => s + (m.ai?.length || 0), 0);
  return `<div class="ol-room"><div class="ph-sec">Your squad · ${sq.members.length}/${MAX_SQUAD}${nAI ? ` · ${nAI} AI` : ''}</div>${rows}
    <p class="ph-note">${lead ? 'You lead: you call Got Next for the squad, and Pro-Am games start when you start one.' : `${esc(sq.members.find(m => m.id === sq.leader)?.name || 'Your leader')} leads: you go where he goes, and play when he starts a game.`}</p>
    <div class="ph-acts"><button class="btn small ghost" data-osqleave>Leave squad</button></div></div>`;
}

function crewHTML(app) {
  const net = app.net, cr = net.crew, local = app.crew;
  if (!cr) {
    if (!local) return '';
    return `<div class="ol-room"><div class="ph-sec">Crew online</div><p class="ph-note">Bring <b>${esc(local.name)}</b> [${esc(local.tag)}] online and your friends can join it: their games add crew XP to it, and you run together in the Crew HQ.</p>
      <div class="ph-acts"><button class="btn small primary" data-ocrewon>Bring the crew online</button></div></div>`;
  }
  const founder = cr.founder === net.myId;
  const rows = cr.members.map(m => `<div class="ol-mem">${av(m.username, m.id === cr.founder ? 'host' : '')}<span class="ph-who"><b>${esc(m.name || m.username)}${m.id === cr.founder ? ' <i class="ph-star">FOUNDER</i>' : ''}</b><small>${esc(m.username)}</small><em>${esc(statusText(m))}</em></span>${founder && m.id !== net.myId ? `<button class="ph-act" data-ocrewkick="${esc(m.id)}" title="Out of the crew">✕</button>` : ''}</div>`).join('');
  return `<div class="ol-room crew-online" style="--c:${esc(cr.color)}"><div class="ph-sec">${esc(cr.name)} [${esc(cr.tag)}] · level ${cr.level} · online crew</div>${rows}
    <p class="ph-note">${founder ? 'Your crew: invite friends with Crew on a friend below. Their games add crew XP to it (your game collects it). Run together in the Crew HQ.' : 'Your games add crew XP to this crew. The Crew HQ door in any park takes you to its HQ.'}</p>
    <div class="ph-acts"><button class="btn small ghost" data-ocrewleave>${founder ? 'Take the crew offline' : 'Leave the crew'}</button></div></div>`;
}

export function bindPhoneTab(app, host, redraw) {
  const net = app.net;
  if (!net) return;
  bindLink(app, host, redraw);
  const send = (m, okText) => { if (!net.send(m)) toast('Not connected right now.', 'error'); else if (okText) toast(okText); };
  // (friend requests go over the socket: from your own copy there's no sign-in cookie for the host's service)
  $$('[data-ofr]', host).forEach(b => b.onclick = () => send({ t: 'friend', username: b.dataset.u, action: b.dataset.ofr }));
  const add = host.querySelector('[data-oadd]');
  if (add) add.onsubmit = e => {
    e.preventDefault();
    const u = new FormData(add).get('u')?.toString().trim();
    if (!u) return;
    if (net.send({ t: 'friend', username: u, action: 'add' })) add.reset(); else toast('Not connected right now.', 'error');
  };
  const once = (b, label) => { b.disabled = true; b.textContent = label; };
  $$('[data-osq]', host).forEach(b => b.onclick = () => { send({ t: 'sq-invite', to: b.dataset.osq }); once(b, 'Sent'); });
  $$('[data-och]', host).forEach(b => b.onclick = () => { send({ t: 'challenge', to: b.dataset.och }); once(b, 'Sent'); });
  $$('[data-ocrew]', host).forEach(b => b.onclick = () => { send({ t: 'crew-invite', to: b.dataset.ocrew }); once(b, 'Sent'); });
  $$('[data-ogo]', host).forEach(b => b.onclick = () => {
    if (app.world?.mySession || app.mode === 'match') { toast('Finish your game first.', 'error'); return; }
    travel(app, b.dataset.ogo);
  });
  $$('[data-okick]', host).forEach(b => b.onclick = () => send({ t: 'sq-kick', id: b.dataset.okick }));
  const sl = host.querySelector('[data-osqleave]'); if (sl) sl.onclick = () => send({ t: 'sq-leave' });
  const con = host.querySelector('[data-ocrewon]'); if (con) con.onclick = () => { crewSync(app, true); once(con, 'Bringing it online…'); };
  $$('[data-ocrewkick]', host).forEach(b => b.onclick = () => send({ t: 'crew-kick', id: b.dataset.ocrewkick }));
  const cl = host.querySelector('[data-ocrewleave]'); if (cl) cl.onclick = () => send({ t: 'crew-leave' });
}

// ---------------- your own copy, linked to a friend's hosted game ----------------
function linkForm() {
  return `<div class="ph-sec">Play online with your friends</div>
    <p class="ph-note">Play from this game: your players, VC and progress stay in your own save, and the online server (or the
      friend who hosts with <b>host.cmd</b>) just connects everyone. Type the address you were given. You need the same version of the game as the server.</p>
    <form class="ol-add" data-olink><input class="text" name="hub" maxlength="80" placeholder="Address, e.g. https://203-0-113-7.sslip.io" autocomplete="off"><button class="btn small primary" type="submit">Connect</button></form>
    <p class="ph-note">Hosting on your own PC instead? Quit the game and run <b>host.cmd</b>. (Your own online server: README, <i>Host on a server</i>.)</p>`;
}
function signInForm(net) {
  const e = net.authError;
  const version = e?.code === 'version';
  const waiting = !net.signingIn && !version;
  return `<div class="ph-sec">Online through ${esc(net.hub)}</div>
    ${e ? `<div class="ol-host warn">${esc(e.text)}</div>` : ''}
    ${version ? '<p class="ph-note">Update this copy of the game to the host\'s (the same files he has), restart it, and open this tab again.</p>'
      : waiting ? `<p class="ph-note">Connecting to ${esc(net.hub)}… ${/^https:/i.test(net.hub) ? '(is the server up? Its status: README, <i>Host on a server</i>)' : '(is your friend\'s game running, and his port open?)'}</p>`
      : `<p class="ph-note">Sign in with your online account on your friend's game, or make one: he gives you the join code. Your players stay in your own game either way.</p>
      <form class="ol-signin" data-osignin>
        <input class="text" name="u" maxlength="24" placeholder="Online username" autocomplete="username">
        <input class="text" name="p" type="password" maxlength="128" placeholder="Password (8+)" autocomplete="current-password">
        <input class="text" name="c" maxlength="64" placeholder="Join code (new accounts)" autocomplete="off">
        <div class="ph-acts"><button class="btn small primary" data-omode="login" type="submit">Sign in</button><button class="btn small" data-omode="register" type="submit">Create account</button></div>
      </form>`}
    <div class="ph-acts"><button class="btn small ghost" data-ounlink>Change server</button></div>`;
}
function bindLink(app, host) {
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

// ---------------- the start, on every screen ----------------
// A park game (on a court where you are), a crew run (in the HQ) or Pro-Am (in the arena: the squad goes there)
export async function startOnline(app, setup) {
  const net = app.net, local = setup.slots?.[net.myId];
  if (local == null) return; // (not in this one)
  clearInvites();
  const kind = setup.kind || 'park';
  if (kind === 'park' || kind === 'hq') {
    const w = placeOf(app);
    if (!w || w.placeKey() !== setup.where) { toast(`That game is at ${parkName(setup.where)}: you weren't there. The AI takes your spot.`, 'error'); net.send({ t: 'quit' }); return; }
    if (!w.readyForOnline?.()) { toast('You were busy: the AI takes your spot in this one.', 'error'); net.send({ t: 'quit' }); return; }
    closeModal();
    await w.startOnlineGame(setup, local);
  } else {
    const Modes = await import('./modes.js');
    closeModal();
    await Modes.playProAmOnline(app, setup, local);
  }
}
