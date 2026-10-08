// MyPlayer: attribute upgrades (VC), badges, appearance, animations, player management.
import { $, $$, esc, money, toast, modal, closeModal, bar, TIER, TIER_CLS, title, heightStr, confirmBox, ratingColor } from './common.js';
import { ATTR_GROUPS, ATTR_LABEL, ATTRS, overall } from '../sim/ratings.js';
import { upgradeCost } from '../sim/builds.js';
import { appearanceEditor } from './builder.js';
import { settings, saveSettings } from '../core/settings.js';
import * as Screens from './screens.js';

const TABS = [['attributes', 'Attributes'], ['badges', 'Badges'], ['animations', 'Animations'], ['appearance', 'Appearance'], ['players', 'Players']];

export function render(app, root, params = {}) {
  const c = app.char();
  if (!c) return Screens.go(app, 'create');
  const tab = params.tab || 'attributes';
  root.innerHTML = `<section class="panel mp">
    <div class="mp-head"><div><div class="eyebrow">${esc(c.position)} · ${title(c.archetype)} · ${heightStr(c.height)}</div><h1>${esc(c.name)}</h1></div>
      <div class="ovr"><b>${c.overall}</b><small>OVR</small></div></div>
    <div class="subtabs">${TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="mp-body"></div></section>`;
  $$('[data-tab]', root).forEach(b => b.onclick = () => render(app, root, { tab: b.dataset.tab }));
  const body = $('#mp-body', root);
  if (tab === 'attributes') attributes(app, body, c);
  if (tab === 'badges') badges(app, body, c);
  if (tab === 'animations') animations(app, body, c);
  if (tab === 'appearance') appearanceEditor(app, body, c);
  if (tab === 'players') players(app, body);
}

function attributes(app, root, c) {
  const pending = {};
  const draw = () => {
    let cost = 0;
    for (const [k, v] of Object.entries(pending)) cost += upgradeCost(c.attributes[k], v);
    const projected = { ...c.attributes, ...pending };
    const ovr = overall(projected, c.position);
    root.innerHTML = `
      <div class="row between"><div class="muted">Upgrade with VC up to each cap. Every build tops out at ${app.config.badge_rules?.ovr_cap ?? 90} OVR; Hall of Fame badges bring cap breakers that push maxed attributes past it.</div>
        <div class="row gap">${c.cap_breakers_available ? `<button class="btn" data-cb>Cap breakers · ${c.cap_breakers_available}</button>` : ''}<button class="btn ghost" data-max>Max all · ${money(c.max_upgrade_cost)} VC</button></div></div>
      <div class="attr-cols">${Object.entries(ATTR_GROUPS).map(([g, keys]) => `<div class="attr-group"><h5>${g}</h5>${keys.map(k => {
        const cur = c.attributes[k], nv = pending[k] ?? cur, cap = c.caps[k];
        return `<div class="attr-row up"><span>${ATTR_LABEL[k]}</span>${bar(nv, 99, cap, nv > cur ? 'pending' : '')}<b style="color:${ratingColor(nv)}">${nv}</b>
          <span class="steppers"><button data-dec="${k}" ${nv <= cur ? 'disabled' : ''}>−</button><button data-inc="${k}" ${nv >= cap ? 'disabled' : ''}>+</button><button data-inc5="${k}" ${nv >= cap ? 'disabled' : ''}>+5</button></span></div>`;
      }).join('')}</div>`).join('')}</div>
      <div class="row between sticky-actions"><div>Projected OVR <b class="big">${ovr}</b> · Cost <b class="big">${money(cost)}</b> VC</div>
        <div class="row gap"><button class="btn ghost" data-reset ${!cost ? 'disabled' : ''}>Reset</button><button class="btn primary" data-apply ${!cost ? 'disabled' : ''}>Apply upgrades</button></div></div>`;
    $$('[data-inc]', root).forEach(b => b.onclick = () => { const k = b.dataset.inc; pending[k] = Math.min(c.caps[k], (pending[k] ?? c.attributes[k]) + 1); draw(); });
    $$('[data-inc5]', root).forEach(b => b.onclick = () => { const k = b.dataset.inc5; pending[k] = Math.min(c.caps[k], (pending[k] ?? c.attributes[k]) + 5); draw(); });
    $$('[data-dec]', root).forEach(b => b.onclick = () => { const k = b.dataset.dec; pending[k] = Math.max(c.attributes[k], (pending[k] ?? c.attributes[k]) - 1); if (pending[k] === c.attributes[k]) delete pending[k]; draw(); });
    $('[data-reset]', root).onclick = () => { for (const k in pending) delete pending[k]; draw(); };
    const cbb = $('[data-cb]', root); if (cbb) cbb.onclick = () => openCapBreakers(app, () => Screens.go(app, 'myplayer', { tab: 'attributes' }));
    $('[data-apply]', root).onclick = async ev => {
      ev.currentTarget.disabled = true;
      try { const res = await app.api.mutate(`/api/characters/${c.id}/upgrade`, { targets: pending }); app.replaceChar(res.character); app.setBalance(res.balance); app.audio.ui('buy'); toast(`Upgraded for ${money(res.cost)} VC.`); Screens.go(app, 'myplayer', { tab: 'attributes' }); }
      catch (e) { toast(e.message, 'error'); ev.currentTarget.disabled = false; }
    };
    $('[data-max]', root).onclick = async ev => {
      if (!c.max_upgrade_cost) return toast('Already maxed out.');
      if (!(await confirmBox(`Max every attribute for ${money(c.max_upgrade_cost)} VC?`, 'Max out'))) return;
      try { const res = await app.api.mutate(`/api/characters/${c.id}/upgrade`, { max: true }); app.replaceChar(res.character); app.setBalance(res.balance); app.audio.ui('buy'); toast(`Maxed out for ${money(res.cost)} VC.`); Screens.go(app, 'myplayer', { tab: 'attributes' }); }
      catch (e) { toast(e.message, 'error'); }
    };
  };
  draw();
}

// v0.4.5 cap breakers: +1 per breaker to an attribute that's at its cap and below 99. Opens after a game in
// which a Hall of Fame badge brought new ones, and from the Attributes tab.
export function openCapBreakers(app, done = () => {}) {
  const c = app.char();
  if (!c) return done();
  const avail = c.cap_breakers_available || 0;
  const plan = {};
  const left = () => avail - Object.values(plan).reduce((a, b) => a + b, 0);
  const card = modal(`<h2>Cap breakers</h2><div id="cb-body"></div>`, { wide: true, close: false });
  const body = card.querySelector('#cb-body');
  const draw = () => {
    const ovr = overall(Object.fromEntries(ATTRS.map(k => [k, c.attributes[k] + (plan[k] || 0)])), c.position);
    body.innerHTML = `<p class="muted">Each cap breaker adds +1 to an attribute that's maxed out on your build (at its cap, below 99), past the ${app.config.badge_rules?.ovr_cap ?? 90} OVR cap. Upgrade an attribute to its cap with VC first to make it eligible.</p>
      <div class="row between"><div>Left to place <b class="big">${left()}</b> of ${avail}</div><div>OVR <b class="big">${ovr}</b></div></div>
      <div class="attr-cols">${Object.entries(ATTR_GROUPS).map(([g, keys]) => `<div class="attr-group"><h5>${g}</h5>${keys.map(k => {
        const cur = c.attributes[k], cap = c.caps[k], n = plan[k] || 0, ok = cur >= cap && cap < 99;
        return `<div class="attr-row up ${ok ? '' : 'muted'}"><span>${ATTR_LABEL[k]}</span>${bar(cur + n, 99, cap + n, n ? 'pending' : '')}<b style="color:${ratingColor(cur + n)}">${cur + n}</b>
          <span class="steppers"><button data-cbd="${k}" ${n ? '' : 'disabled'}>−</button><button data-cbi="${k}" ${ok && left() > 0 && cur + n < 99 ? '' : 'disabled'}>+</button></span></div>`;
      }).join('')}</div>`).join('')}</div>
      <div class="row gap end"><button class="btn ghost" data-later>${left() === avail ? 'Save for later' : 'Cancel'}</button><button class="btn primary" data-ok ${left() === avail ? 'disabled' : ''}>Use cap breakers</button></div>`;
    body.querySelectorAll('[data-cbi]').forEach(b => b.onclick = () => { const k = b.dataset.cbi; plan[k] = (plan[k] || 0) + 1; draw(); });
    body.querySelectorAll('[data-cbd]').forEach(b => b.onclick = () => { const k = b.dataset.cbd; plan[k] = Math.max(0, (plan[k] || 0) - 1); if (!plan[k]) delete plan[k]; draw(); });
    body.querySelector('[data-later]').onclick = () => { closeModal(); done(); };
    body.querySelector('[data-ok]').onclick = async ev => {
      ev.currentTarget.disabled = true;
      try {
        let res = null;
        for (const [k, n] of Object.entries(plan)) res = await app.api.mutate(`/api/characters/${c.id}/capbreakers`, { attribute: k, count: n });
        if (res) app.replaceChar(res.character);
        app.audio.ui('buy'); toast('Cap breakers applied.');
        closeModal(); done();
      } catch (e) { toast(e.message, 'error'); ev.currentTarget.disabled = false; }
    };
  };
  draw();
}

function badges(app, root, c) {
  const defs = app.config.badges;
  const groups = {};
  for (const g of ['Shooting', 'Finishing', 'Playmaking', 'Defense', 'Rebounding']) groups[g] = [];
  for (const [id, b] of Object.entries(defs)) (groups[b.group] = groups[b.group] || []).push([id, b]);
  for (const g in groups) if (!groups[g].length) delete groups[g];
  const rules = app.config.badge_rules || { hof_limit: 7 };
  const icon = c.icon_badge && app.config.icon_badges?.[c.icon_badge];
  const mineIcon = Object.entries(app.config.icon_badges || {}).find(([, v]) => v.archetype === c.archetype);
  root.innerHTML = `<div class="muted">Badges level up from what you do in games: Bronze → Silver → Gold → Hall of Fame. Every earned badge is active, and each tier is a big step up from the last. A stat with none of its badges plays 10% weaker. A build holds up to ${rules.hof_limit} Hall of Fame badges: the first 5 bring 5 cap breakers each, and the ${rules.hof_limit}th unlocks your archetype's Icon badge.</div>
    <div class="icon-badge ${icon ? 'on' : ''}"><div class="badge-icon">★</div><div><b>${esc(icon ? icon.name : mineIcon ? mineIcon[1].name : 'Icon badge')}</b>
      <small>${icon ? 'UNLOCKED · ' : `Locked · ${c.hof_count || 0}/${rules.hof_limit} Hall of Fame · `}${esc((icon || mineIcon?.[1])?.desc || '')}</small></div></div>
    ${Object.entries(groups).map(([g, list]) => `<h5 class="group-h">${g}</h5><div class="badge-grid">${list.map(([id, b]) => {
      const st = c.badges?.[id] || { progress: 0, tier: 0 };
      const next = b.tiers[st.tier] ?? null, prev = st.tier ? b.tiers[st.tier - 1] : 0;
      const pct = next ? Math.round((st.progress - prev) / (next - prev) * 100) : 100;
      return `<div class="badge ${TIER_CLS[st.tier]}"><div class="badge-icon">${esc(b.name.split(' ').map(w => w[0]).join('').slice(0, 2))}</div>
        <div class="badge-info"><b>${esc(b.name)}</b><small>${st.tier ? TIER[st.tier] : 'Locked'} · ${esc(b.desc)}</small>
        <span class="bar small"><i style="width:${pct}%"></i></span><small class="muted">${next ? `${st.progress}/${next} ${b.stat.replace('_', ' ')}` : 'Maxed'}</small></div></div>`;
    }).join('')}</div>`).join('')}`;
}

const ANIM_SLOTS = [['jumpshot', 'Jumpshot base', 'jumpshot'], ['release', 'Jumpshot release', 'jumpshot'], ['dunk', 'Dunk package', 'dunk'], ['layup', 'Layup package', 'layup'], ['sizeup', 'Size-up package', 'moves'], ['celebration', 'Celebration', 'celebrate']];
function animations(app, root, c) {
  const inv = new Set(app.profile.inventory);
  root.innerHTML = `<div class="muted">Equip animations you own. Buy more in the VC Store. Click Preview to see them on your player.</div>
    ${ANIM_SLOTS.map(([slot, label, preview]) => {
      const owned = Object.values(app.catalog).filter(i => i.slot === slot && inv.has(i.id));
      const cur = c.equipment[slot];
      return `<div class="anim-slot"><h5>${label}</h5><div class="chips">${owned.map(i => `<button class="chip ${cur === i.id ? 'on' : ''}" data-equip="${slot}" data-id="${i.id}">${esc(i.name.split(': ').pop())}</button>`).join('') || '<span class="muted small">None owned</span>'}
        <button class="chip ghost" data-preview="${preview}" data-slot="${slot}">Preview ▶</button></div></div>`;
    }).join('')}`;
  $$('[data-equip]', root).forEach(b => b.onclick = async () => {
    try { const res = await app.api.mutate(`/api/characters/${c.id}/equip`, { slot: b.dataset.equip, item_id: b.dataset.id }); app.replaceChar(res.character); render(app, root.parentElement.parentElement, { tab: 'animations' }); }
    catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-preview]', root).forEach(b => b.onclick = () => {
    const ch = app.char();
    app.showroom.setCharacter(ch, app.look(ch));
    const kind = b.dataset.preview;
    const dk = app.catalog[ch.equipment.dunk];
    const cel = app.catalog[ch.equipment.celebration];
    // v0.4.5: preview the equipped layup and size-up packages with their own style too
    const lay = app.catalog[ch.equipment.layup], su = app.catalog[ch.equipment.sizeup];
    const style = kind === 'layup' ? (lay?.style || 'basic') : kind === 'moves' ? (su?.style || 'basic') : dk?.styles?.[0];
    app.showroom.setPreview(kind, { style, styles: kind === 'dunk' ? dk?.styles : undefined, lvl: su?.lvl, speed: su?.move_speed, kind: cel?.anim || 'flex' });
    app.showroom.setFocus(kind === 'celebrate' ? 'upper' : 'wide');
  });
}

function players(app, root) {
  const chars = app.profile.characters;
  root.innerHTML = `<div class="player-list">${chars.map(ch => `<button class="player-card ${ch.id === app.selectedId ? 'on' : ''}" data-pick="${ch.id}"><b>${ch.overall}</b><span>${esc(ch.name)}<small>${ch.position} · ${title(ch.archetype)} · ${esc(ch.rep.label)}</small></span></button>`).join('')}
    ${chars.length < 4 ? '<button class="player-card new" data-new>+ Create new player</button>' : ''}</div>
    <p class="muted small">Up to four players share your VC wallet and locker.</p>`;
  $$('[data-pick]', root).forEach(b => b.onclick = () => { app.selectedId = b.dataset.pick; settings.character = app.selectedId; saveSettings(); Screens.go(app, 'myplayer', { tab: 'players' }); });
  const nb = $('[data-new]', root); if (nb) nb.onclick = () => Screens.go(app, 'create');
}

export function switcher(app) {
  const card = modal(`<h2>Your players</h2><div class="player-list">${app.profile.characters.map(ch => `<button class="player-card ${ch.id === app.selectedId ? 'on' : ''}" data-pick="${ch.id}"><b>${ch.overall}</b><span>${esc(ch.name)}<small>${ch.position} · ${title(ch.archetype)}</small></span></button>`).join('')}</div>`);
  card.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { app.selectedId = b.dataset.pick; settings.character = app.selectedId; saveSettings(); closeModal(); Screens.go(app, app.screen === 'create' ? 'home' : app.screen); });
}
