// v0.4.4 social phone (LB + RB / L1 + R1 on a controller, O on the keyboard). Everyone at your park with
// their overall and position, your friends and when they're on, your squad, and the people you've run with
// lately. Add the ones you liked playing with and invite them to your squad whenever they're online.
import { $, $$, esc, modal, closeModal, toast, heightStr, title, TIER_CLS, money } from './common.js';
import { ARCHETYPES, capBadges } from '../sim/builds.js';
import { badgeChip } from './badgeart.js';
import { PARK_NAMES } from '../sim/world.js';
import * as Crew from './crew.js';

const TABS = [['park', 'Park'], ['friends', 'Friends'], ['squad', 'Squad'], ['crew', 'Crew'], ['recent', 'Recent']];
const ago = t => { const m = (Date.now() - t) / 60000; return m < 2 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`; };
const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

let open = null; // the phone currently on screen

export function phoneOpen() { return !!open && !!document.querySelector('.phone-card'); }
export function togglePhone(app, opts = {}) { if (phoneOpen()) { closeModal(); return; } openPhone(app, opts); }

export function openPhone(app, opts = {}) {
  const w = app.ai;
  if (!w) return;
  const hub = app.mode === 'park' && app.world?.parkList ? app.world : null;
  const st = { tab: opts.tab || 'park', who: null };
  const card = modal('<div class="phone" data-phone></div>', { cls: 'phone-card' });
  const host = card.querySelector('[data-phone]');
  open = { app, st };
  const prevClose = closeModal.onClose;
  closeModal.onClose = () => { open = null; if (prevClose) prevClose(); if (opts.onClose) opts.onClose(); };
  const off = w.onChange(() => { if (phoneOpen()) draw(); else off(); });

  // presence: someone physically at this park counts as online, and we can say what he's doing
  let where = new Map();
  const statusOf = id => {
    if (where.has(id)) return { online: true, park: hub.themeId, text: where.get(id) === 'On the sidelines' ? 'Online at this park' : where.get(id) };
    const s = w.statusText(id, Date.now(), hub?.themeId);
    // v0.4.5: say when he's busy in a game at another park (he can't join your squad until it's over)
    if (s.online && s.park !== hub?.themeId && w.playingElsewhere(id)) return { ...s, playing: true, text: s.text.replace(/^Online /, 'In a game ') };
    return s;
  };
  const busy = id => { const s = statusOf(id); return s.playing || (hub && where.has(id) && hub.isPlaying(id)); };
  const circle = (e, big = false) => `<span class="ph-ovr ${big ? 'big' : ''} t-${e.tier || 'regular'}" title="${esc(e.tierLabel || '')}"><b>${e.build.overall}</b><small>${esc(e.build.position)}</small></span>`;
  const sub = e => `${esc(ARCHETYPES[e.build.archetype]?.label || title(e.build.archetype))} · ${heightStr(e.build.height)} · ${esc(e.rep?.label || '')}`;
  const action = id => {
    if (w.inSquad(id)) return `<button class="ph-act sq" data-kick="${id}" title="Remove from squad">In squad</button>`;
    if (w.isFriend(id)) return statusOf(id).online && w.squad.length < 4 && !busy(id) ? `<button class="ph-act inv" data-invite="${id}">Invite</button>` : `<button class="ph-act fr" data-who="${id}">${busy(id) ? 'In a game' : 'Friend'}</button>`;
    return `<button class="ph-act add" data-add="${id}">+ Add</button>`;
  };
  const row = (id, line, dot = null) => {
    const e = w.entry(id);
    const on = dot ?? statusOf(id).online;
    return `<div class="ph-row"><button class="ph-main" data-who="${id}">${circle(e)}<span class="ph-who"><b>${esc(e.name)}${w.isFriend(id) ? ' <i class="ph-star">★</i>' : ''}</b><small>${sub(e)}</small><em>${esc(line)}</em></span><i class="ph-dot ${on ? 'on' : ''}"></i></button>${action(id)}</div>`;
  };

  function listPark() {
    if (hub) {
      const list = hub.parkList();
      const name = PARK_NAMES[hub.themeId] || hub.venue?.theme?.name || 'the park';
      const busy = list.filter(x => !/sidelines/.test(x.where)).length;
      return `<div class="ph-sec">${esc(name)} · ${list.length} online here · ${busy} on the courts and around</div>${list.length ? list.map(x => row(x.id, x.where, true)).join('') : '<p class="ph-empty">Nobody else is here right now. It gets busier in the evenings.</p>'}`;
    }
    // not at a park: who's on, park by park
    const t = Date.now();
    return Object.keys(PARK_NAMES).map(pk => {
      const ids = w.onlineAt(pk, t);
      const top = ids.map(id => [id, w.account(id)]).sort((a, b) => (w.isFriend(b[0]) - w.isFriend(a[0])) || b[1].level - a[1].level).slice(0, 12);
      return `<div class="ph-sec">${esc(PARK_NAMES[pk])} · ${ids.length} online</div>${top.map(([id]) => row(id, w.statusText(id, t).text)).join('') || '<p class="ph-empty">Quiet right now.</p>'}`;
    }).join('');
  }
  function listFriends() {
    if (!w.friends.length) return '<p class="ph-empty">No friends yet. Find someone you liked playing with in the Park or Recent tabs and add him.</p>';
    const rows = w.friends.map(id => [id, statusOf(id)]).sort((a, b) => b[1].online - a[1].online);
    const on = rows.filter(r => r[1].online).length;
    return `<div class="ph-sec">${on} of ${rows.length} online</div>${rows.map(([id, s]) => row(id, s.text, s.online)).join('')}`;
  }
  function listSquad() {
    const sq = w.activeSquad();
    const busy = sq.filter(id => /^Playing on/.test(where.get(id) || ''));
    const inv = w.friends.filter(id => !w.inSquad(id) && statusOf(id).online);
    // v0.4.7.5: closing the game leaves your squad; some of the old squad keep running together
    const party = w.aiParty ? w.aiParty() : [], ex = w.exSquad && Date.now() - w.exSquad.at < 6 * 3600000 ? w.exSquad.ids : [];
    const exNote = !sq.length && ex.length ? `<p class="ph-note">Your squad broke up when you closed the game.${party.length > 1 ? ` ${party.map(id => esc(w.entry(id).name)).join(' and ')} are still running together at the park.` : ''} Invite them back any time they're online.</p>` : '';
    return `${exNote}<p class="ph-note">Your squad follows you around the park, steps onto your Got Next spot first, and suits up with you in Pro-Am. Up to four friends; they have to be online. Closing the game leaves the squad.</p>
      <div class="ph-sec">Squad · ${sq.length}/4</div>${sq.length ? sq.map(id => row(id, statusOf(id).text)).join('') : '<p class="ph-empty">Just you for now.</p>'}
      ${busy.length ? `<p class="ph-note">${busy.map(id => esc(w.entry(id).name)).join(', ')} ${busy.length > 1 ? 'are' : 'is'} finishing a game and will come find you after it.</p>` : ''}
      <div class="ph-sec">Friends online to invite</div>${inv.length ? inv.map(id => row(id, statusOf(id).text)).join('') : '<p class="ph-empty">No friends online right now.</p>'}`;
  }
  function listRecent() {
    const rec = w.recent(40);
    if (!rec.length) return '<p class="ph-empty">Play a park or Pro-Am game and everyone you ran with or against shows up here.</p>';
    return `<div class="ph-sec">Played with lately</div>${rec.map(m => row(m.id, `${m.games} game${m.games > 1 ? 's' : ''} · ${m.with ? `${m.with} with (${m.wins}-${m.with - m.wins})` : ''}${m.with && m.vs ? ', ' : ''}${m.vs ? `${m.vs} against` : ''} · ${ago(m.last)}`)).join('')}`;
  }
  // v0.4.5 Crews: your crew at a glance (level, who's on), and the way into the crew menu
  function listCrew() {
    const cr = app.crew;
    if (cr === undefined) {
      if (!st.crewLoading) { st.crewLoading = true; Crew.fetchCrew(app).catch(() => { app.crew = app.crew ?? null; }).finally(() => { st.crewLoading = false; if (phoneOpen() && st.tab === 'crew') draw(); }); }
      return '<p class="ph-empty">Loading your crew…</p>';
    }
    if (!cr) return `<p class="ph-note">Start a crew with up to 39 of your friends. Every game you play earns crew XP, your members earn it whenever they play (even while you're away), and the crew levels from 1 to 40. Walk into the Crew HQ from any park to shoot around or run 5-on-5 with whoever's on.</p>
      <div class="ph-acts"><button class="btn primary" data-crewmenu>Start a crew</button></div>`;
    const lv = cr.level, pct = lv.next ? Math.round((lv.xp - lv.floor) / (lv.next - lv.floor) * 100) : 100;
    const xp = Object.fromEntries(cr.members.map(m => [m.id, m.xp]));
    const rows = cr.members.map(m => [m.id, statusOf(m.id)]).sort((a, b) => (b[1].online - a[1].online) || xp[b[0]] - xp[a[0]]);
    const on = rows.filter(r => r[1].online).length;
    return `<div class="ph-crew" style="${Crew.crewVars(cr)}"><span class="crew-tag">${esc(cr.tag)}</span><span class="ph-crew-main"><b>${esc(cr.name)}</b><small>Level ${lv.level} of 40 · ${money(lv.xp)} XP${lv.next ? ` · ${money(lv.next - lv.xp)} to go` : ''}</small><span class="bar"><i style="width:${pct}%"></i></span></span></div>
      <div class="ph-acts"><button class="btn small" data-crewmenu>Manage crew</button></div>
      <div class="ph-sec">Members · ${on} of ${rows.length} online${on >= 4 ? ' · enough for 5-on-5 at the HQ' : ''}</div>
      ${rows.length ? rows.map(([id, s]) => row(id, `${s.text} · ${money(xp[id])} crew XP`, s.online)).join('') : '<p class="ph-empty">No members yet. Add your friends from Manage crew.</p>'}`;
  }
  function profile(id) {
    const e = w.entry(id), a = w.account(id), s = statusOf(id), m = w.met[id];
    const badges = Object.entries(capBadges(e.badges || {}, e.build)).sort((x, y) => y[1] - x[1]);
    const cfg = app.config?.badges || {};
    return `<button class="ph-back" data-back>‹ Back</button>
      <div class="ph-prof">${circle(e, true)}<h3>${esc(e.name)}${w.isFriend(id) ? ' <i class="ph-star">★</i>' : ''}</h3><div class="ph-tier t-${e.tier}">${esc(e.tierLabel)} · ${esc(e.rep.label)}</div>
        <div class="ph-facts">
          <div><span>Build</span><b>${esc(ARCHETYPES[e.build.archetype]?.label || '')} ${esc(e.build.position)} · ${heightStr(e.build.height)} · ${e.build.weight} lbs</b></div>
          <div><span>Status</span><b class="${s.online ? 'ok' : ''}">${esc(s.text)}</b></div>
          <div><span>Plays</span><b>${esc(w.habitText(id))}</b></div>
          <div><span>Home park</span><b>${esc(a.home ? PARK_NAMES[a.home] : 'Gets around')}</b></div>
          <div><span>With you</span><b>${m?.with ? `${m.with} game${m.with > 1 ? 's' : ''} (${m.wins}-${m.with - m.wins})` : '—'}</b></div>
          <div><span>Against you</span><b>${m?.vs ? `${m.vs} game${m.vs > 1 ? 's' : ''}` : '—'}</b></div>
          <div><span>Overall</span><b>${e.build.overall ?? '—'} OVR${e.gk ? ` <span class="ok">↑ improving (${e.games || 0} games tracked)</span>` : ''}</b></div>
        </div>
        <div class="ph-badges">${badges.length ? badges.map(([k, t]) => badgeChip(k, t, cfg[k]?.name || title(k))).join('') : '<span class="ib none">No badges</span>'}</div>
        <div class="ph-acts">
          ${w.isFriend(id) ? `<button class="btn ghost" data-unfriend="${id}">Remove friend</button>` : `<button class="btn primary" data-add="${id}">Add friend</button>`}
          ${w.inSquad(id) ? `<button class="btn" data-kick="${id}">Remove from squad</button>` : w.isFriend(id) ? `<button class="btn ${s.online ? 'primary' : ''}" data-invite="${id}" ${s.online && w.squad.length < 4 && !busy(id) ? '' : 'disabled'}>${busy(id) ? 'In a game' : 'Invite to squad'}</button>` : ''}
        </div></div>`;
  }

  function draw() {
    where = hub ? new Map(hub.parkList().map(x => [x.id, x.where])) : new Map();
    const online = w.onlineCount();
    const body = st.who ? profile(st.who) : st.tab === 'park' ? listPark() : st.tab === 'friends' ? listFriends() : st.tab === 'squad' ? listSquad() : st.tab === 'crew' ? listCrew() : listRecent();
    const scroll = host.querySelector('.ph-body')?.scrollTop || 0;
    host.innerHTML = `<div class="ph-status"><span>${clock()}</span><b>AH16</b><span><i class="ph-dot on"></i> ${online} online</span></div>
      <div class="ph-head"><b>Social</b><small>${hub ? esc(PARK_NAMES[hub.themeId] || '') : 'Not at a park'} · ${w.friends.length} friends · squad ${w.squad.length}/4</small></div>
      ${st.who ? '' : `<nav class="tabs-inner ph-tabs">${TABS.map(([k, l]) => `<button class="${st.tab === k ? 'on' : ''}" data-tab="${k}">${l === 'Park' && !hub ? 'Online' : l}</button>`).join('')}</nav>`}
      <div class="ph-body">${body}</div>
      <div class="ph-foot muted small">${app.input?.usingPad ? 'LB + RB to put the phone away' : 'O or Esc to put the phone away'}</div>`;
    const b = host.querySelector('.ph-body'); if (b) b.scrollTop = st.whoScroll != null && !st.who ? st.whoScroll : scroll;
    $$('[data-tab]', host).forEach(x => x.onclick = () => { st.tab = x.dataset.tab; st.whoScroll = 0; draw(); });
    $$('[data-who]', host).forEach(x => x.onclick = () => { st.whoScroll = host.querySelector('.ph-body')?.scrollTop || 0; st.who = x.dataset.who; draw(); });
    $$('[data-back]', host).forEach(x => x.onclick = () => { st.who = null; draw(); });
    $$('[data-add]', host).forEach(x => x.onclick = ev => { ev.stopPropagation(); if (w.addFriend(x.dataset.add)) toast(`${w.entry(x.dataset.add).name} added to your friends.`); else toast('Friends list is full (200).', 'error'); });
    $$('[data-unfriend]', host).forEach(x => x.onclick = () => { w.removeFriend(x.dataset.unfriend); hub?.syncSquad(); });
    $$('[data-invite]', host).forEach(x => x.onclick = ev => {
      ev.stopPropagation();
      const id = x.dataset.invite;
      const r = w.invite(id, Date.now(), hub ? hub.isPlaying(id) : null);
      toast(r.msg, r.ok ? '' : 'error');
      if (r.ok) { app.audio?.ui?.('buy'); hub?.syncSquad(); }
    });
    $$('[data-kick]', host).forEach(x => x.onclick = ev => { ev.stopPropagation(); w.kick(x.dataset.kick); hub?.syncSquad(); });
    $$('[data-crewmenu]', host).forEach(x => x.onclick = () => { closeModal(); Crew.openCrew(app, { onChange: c => { if (app.world?.crew && c) { app.world.crew = c; app.world.refreshBoards?.(); } } }); });
  }
  draw();
  // keep statuses and the clock fresh while it's open
  const tick = setInterval(() => { if (!phoneOpen()) { clearInterval(tick); off(); return; } if (!st.who && st.tab === 'park') draw(); }, 5000);
}
