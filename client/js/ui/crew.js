// v0.4.5 Crews: start a crew, pick its members from your friends (up to 39 + you), watch it level from 1 to
// 40. Opened from the social phone (Crew tab), from the board in the Crew HQ, and from the HQ door in any park.
// The server keeps the crew and its XP (your games, and your AI members' play while you're away).
import { $, $$, esc, modal, closeModal, toast, money } from './common.js';
import { PARK_NAMES } from '../sim/world.js';

// readable text on a crew color (dark ink on the light ones)
export function inkFor(hex) {
  const v = [1, 3, 5].map(i => parseInt(String(hex || '#000000').slice(i, i + 2), 16) / 255);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] > 0.6 ? '#15171b' : '#ffffff';
}
export const crewVars = cr => `--c:${cr.color};--ink:${inkFor(cr.color)}`;
export const CREW_COLORS = ['#c8322f', '#e8590c', '#f2c14e', '#1f7a4d', '#0d8a8f', '#2457c5', '#3b5873', '#7a2bd1', '#d63384', '#111111', '#f4f2ec', '#8a5a2b'];

export async function fetchCrew(app) {
  const st = await app.api.get('/api/crew');
  app.crew = st.crew;
  app.crewInfo = st;
  return st;
}

// what a member is up to right now, from the AI world (online at a park, in a game, or when he's next on)
export function memberStatus(app, id) {
  const w = app.ai, t = Date.now();
  const s = w.status(id, t);
  if (s) return { online: true, park: s.park, text: `Online · ${PARK_NAMES[s.park] || 'a park'}${s.park !== 'kingtut' && w.playingElsewhere(id, t) ? ' · in a game' : ''}` };
  const nx = w.nextOnline(id, t);
  if (!nx) return { online: false, text: 'Offline' };
  const h = (nx.start - t) / 3600000;
  return { online: false, text: `Offline · on in ${h < 1 ? Math.max(5, Math.round(h * 12) * 5) + ' min' : Math.round(h) + ' hr'}` };
}
export function onlineMembers(app, crew = app.crew) {
  return (crew?.members || []).map(m => m.id).filter(id => app.ai.status(id));
}

const kxp = n => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
const levelBar = lv => {
  const pct = lv.next ? Math.round((lv.xp - lv.floor) / (lv.next - lv.floor) * 100) : 100;
  return `<div class="crew-lvl"><b>LEVEL ${lv.level}</b><small>of 40</small><span class="bar"><i style="width:${pct}%"></i></span><span class="muted small">${money(lv.xp)} XP${lv.next ? ` · ${money(lv.next - lv.xp)} to level ${lv.level + 1}` : ' · max level'}</span></div>`;
};

export async function openCrew(app, opts = {}) {
  let st;
  try { st = await fetchCrew(app); } catch (e) { toast(e.message, 'error'); return; }
  const w = app.ai, cr = st.crew;
  const ent = id => w.entry(id);
  if (!cr) {
    let color = CREW_COLORS[0];
    const card = modal(`<div class="crew-card"><div class="eyebrow">CREWS</div><h2>Start a crew</h2>
      <p class="muted">A crew is you and up to ${st.max_members} of your friends. Every game you play earns crew XP (about 30% of the Rep it pays; ×1.1 in the park, ×1.3 in Pro-Am, ×1.5 in park events, and doubled when a crew member runs with you), and your AI members keep earning it whenever they play, even while you're away. Crews level from 1 to 40. Walk into the Crew HQ from any park to shoot around or run 5-on-5 with whoever's on.</p>
      <div class="crew-form"><label>Name<input data-name maxlength="24" placeholder="Night Shift"></label><label>Tag<input data-tag maxlength="4" placeholder="NS"></label></div>
      <div class="crew-colors">${CREW_COLORS.map((c, i) => `<button class="swatch ${i ? '' : 'on'}" data-color="${c}" style="--c:${c}"></button>`).join('')}</div>
      <div class="row gap end"><button class="btn primary" data-create>Start the crew</button></div></div>`, { wide: true });
    $$('[data-color]', card).forEach(b => b.onclick = () => { color = b.dataset.color; $$('[data-color]', card).forEach(x => x.classList.toggle('on', x === b)); });
    $('[data-create]', card).onclick = async () => {
      try {
        const r = await app.api.mutate('/api/crew', { action: 'create', name: $('[data-name]', card).value, tag: $('[data-tag]', card).value, color });
        app.crew = r.crew; toast(`${r.crew.name} [${r.crew.tag}] is official. Add members from your friends.`);
        closeModal(); openCrew(app, opts); opts.onChange?.(r.crew);
      } catch (e) { toast(e.message, 'error'); }
    };
    return;
  }
  const ids = new Set(cr.members.map(m => m.id));
  const members = cr.members.map(m => ({ ...m, e: ent(m.id), s: memberStatus(app, m.id) })).sort((a, b) => (b.s.online - a.s.online) || b.xp - a.xp);
  const addable = w.friends.filter(id => !ids.has(id));
  const full = cr.members.length >= st.max_members;
  const on = members.filter(m => m.s.online).length;
  const row = m => `<tr><td><b>${esc(m.e.name)}</b><small>${esc(m.e.tierLabel || '')} · ${m.e.build.overall} ${esc(m.e.build.position)}</small></td><td class="${m.s.online ? 'on' : 'muted'}">${esc(m.s.text)}</td><td class="num">${money(m.xp)}</td><td><button class="btn ghost small" data-remove="${m.id}">Remove</button></td></tr>`;
  const card = modal(`<div class="crew-card" style="${crewVars(cr)}">
    <div class="crew-head"><span class="crew-tag">${esc(cr.tag)}</span><div><div class="eyebrow">CREW</div><h2>${esc(cr.name)}</h2></div>${levelBar(cr.level)}</div>
    <div class="crew-cols">
      <div><div class="ph-sec">Members · ${cr.members.length}/${st.max_members} · ${on} on now</div>
        ${members.length ? `<table class="crew-table"><thead><tr><th>Player</th><th>Status</th><th class="num">Crew XP</th><th></th></tr></thead><tbody>${members.map(row).join('')}</tbody></table>` : '<p class="muted">No members yet. Add friends from the list.</p>'}
        <p class="muted small">Your games: ${money(cr.user_xp)} XP from ${cr.games} games (${cr.crew_games} with crew members).${cr.former_xp ? ` Former members: ${money(cr.former_xp)} XP.` : ''}</p></div>
      <div><div class="ph-sec">Add from your friends${full ? ' · crew is full' : ''}</div>
        ${addable.length ? `<div class="crew-add">${addable.map(id => { const e = ent(id), s = memberStatus(app, id); return `<div><span><b>${esc(e.name)}</b><small>${e.build.overall} ${esc(e.build.position)} · ${esc(s.text)}</small></span><button class="btn small" data-add="${id}" ${full ? 'disabled' : ''}>Add</button></div>`; }).join('')}</div>` : '<p class="muted small">Every friend is already in. Add more friends from the social phone.</p>'}
        <div class="ph-sec">Crew levels</div>
        <div class="crew-levels">${st.levels.map(l => `<div class="${l.level <= cr.level.level ? 'got' : ''}"><b>${l.level}</b><small>${l.level === 1 ? 'start' : kxp(l.xp)}</small><em>${esc(l.reward)}</em></div>`).join('')}</div>
        <p class="muted small">Level rewards and Crew HQ interior customization are coming soon.</p>
        <div class="ph-sec">Name, tag and color</div>
        <div class="crew-form"><input data-name maxlength="24" value="${esc(cr.name)}"><input data-tag maxlength="4" value="${esc(cr.tag)}"></div>
        <div class="crew-colors">${CREW_COLORS.map(c => `<button class="swatch ${c === cr.color ? 'on' : ''}" data-color="${c}" style="--c:${c}"></button>`).join('')}</div>
        <div class="row gap end"><button class="btn small" data-save>Save</button></div></div>
    </div></div>`, { wide: true });
  let color = cr.color;
  const redo = async (body, msg) => {
    try { const r = await app.api.mutate('/api/crew', body); app.crew = r.crew; if (msg) toast(msg(r.crew)); closeModal(); openCrew(app, opts); opts.onChange?.(r.crew); }
    catch (e) { toast(e.message, 'error'); }
  };
  $$('[data-add]', card).forEach(b => b.onclick = () => redo({ action: 'add', member: b.dataset.add }, () => `${ent(b.dataset.add).name} joined ${cr.name}.`));
  $$('[data-remove]', card).forEach(b => b.onclick = () => redo({ action: 'remove', member: b.dataset.remove }, () => `${ent(b.dataset.remove).name} left the crew. His XP stays.`));
  $$('[data-color]', card).forEach(b => b.onclick = () => { color = b.dataset.color; $$('[data-color]', card).forEach(x => x.classList.toggle('on', x === b)); });
  $('[data-save]', card).onclick = () => redo({ action: 'update', name: $('[data-name]', card).value, tag: $('[data-tag]', card).value, color }, c => `Saved: ${c.name} [${c.tag}].`);
}
