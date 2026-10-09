// MyPlayer: attribute upgrades (VC), badges, appearance, animations, player management.
import { $, $$, esc, money, toast, modal, closeModal, bar, TIER, TIER_CLS, title, heightStr, confirmBox, ratingColor } from './common.js';
import { ATTR_GROUPS, ATTR_LABEL, ATTRS, overall } from '../sim/ratings.js';
import { upgradeCost, badgeCaps, hofCapacity, iconNeed, heightBand, BAND_LABEL, ARCHETYPES, maxOvr, BASE_OVR_CAP, OVR_CAP, PRORUN_GAMES_PER_OVR, prorunCompleted } from '../sim/builds.js';
import { badgeSVG, iconBadgeSVG } from './badgeart.js';
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
  if (tab === 'attributes') attributes(app, body, c, params.view || 'upgrades');
  if (tab === 'badges') badges(app, body, c);
  if (tab === 'animations') animations(app, body, c);
  if (tab === 'appearance') appearanceEditor(app, body, c);
  if (tab === 'players') players(app, body);
}

// v0.4.7.5 max OVR: VC takes a new build to 80; every 3 Pro Run games played add +1, up to 90
function maxOvrLine(app, c) {
  const max = maxOvr(c), done = c.prorun_completed ?? prorunCompleted(c), per = app.config.badge_rules?.prorun_games_per_ovr ?? PRORUN_GAMES_PER_OVR;
  const left = c.prorun_to_next ?? (max >= OVR_CAP ? 0 : per - done % per);
  const pct = Math.round((max - BASE_OVR_CAP) / (OVR_CAP - BASE_OVR_CAP) * 100);
  return `<div class="max-ovr"><div class="mo-num"><small>MAX OVR</small><b>${max}</b><span>/ ${OVR_CAP}</span></div>
    <div class="mo-track"><span class="bar"><i style="width:${pct}%"></i></span><div class="mo-ticks">${Array.from({ length: OVR_CAP - BASE_OVR_CAP + 1 }, (_, i) => `<i class="${BASE_OVR_CAP + i <= max ? 'on' : ''}">${BASE_OVR_CAP + i}</i>`).join('')}</div></div>
    <div class="mo-next">${max >= OVR_CAP ? '<b>Fully unlocked</b><small>Cap breakers are open</small>' : `<b>${left} Pro Run game${left === 1 ? '' : 's'}</b><small>to +1 max OVR · ${[0, 1, 2].map(k => `<i class="dot ${k < per - left ? 'on' : ''}"></i>`).join('')}</small>`}</div></div>`;
}

// v0.4.7.5 quick patch, Icon Legend: with the Icon badge, every 2 Pro Run games played (not simmed) are +1 OVR up to
// 99, placed by the build system. Shown under the max OVR line once the build has its Icon badge (a teaser before).
function legendLine(app, c) {
  const L = c.legend_info || {}, per = L.per ?? app.config.badge_rules?.legend_games_per_ovr ?? 2, cap = L.cap ?? app.config.badge_rules?.legend_ovr_cap ?? 99;
  if (!L.active) return `<div class="legend-line off"><div class="ll-num"><small>ICON LEGEND</small><b>🔒</b></div><div class="ll-text"><b>Earn your Icon badge to keep climbing</b><small>After it, every ${per} Pro Run games you play take your overall up by 1, all the way to ${cap}.</small></div></div>`;
  const left = L.to_next ?? per, done = per - left;
  return `<div class="legend-line"><div class="ll-num"><small>ICON LEGEND</small><b>${c.overall}</b><span>/ ${cap}</span></div>
    <div class="ll-text">${L.maxed ? `<b>Fully grinded: ${cap} OVR</b><small>${L.upgrades || 0} Legend upgrades placed</small>` : `<b>${left} Pro Run game${left === 1 ? '' : 's'} to +1 OVR</b><small>${Array.from({ length: per }, (_, k) => `<i class="dot ${k < done ? 'on' : ''}"></i>`).join('')} Placed for you, on the attributes your build leans on · simmed games don't count</small>`}</div></div>`;
}

function attributes(app, root, c, view = 'upgrades') {
  const cbN = c.cap_breakers_available || 0;
  root.innerHTML = `<div class="seg attr-seg"><button class="${view === 'upgrades' ? 'on' : ''}" data-view="upgrades">Upgrades</button><button class="${view === 'capbreakers' ? 'on' : ''}" data-view="capbreakers">Cap Breakers${cbN ? ` <span class="seg-n">${cbN}</span>` : ''}</button></div>
    ${maxOvrLine(app, c)}${maxOvr(c) >= OVR_CAP ? legendLine(app, c) : ''}<div id="attr-view"></div>`;
  $$('[data-view]', root).forEach(b => b.onclick = () => attributes(app, root, app.char(), b.dataset.view));
  const box = $('#attr-view', root);
  if (view === 'capbreakers') return capBreakerPanel(app, box, c, { inline: true, done: () => Screens.go(app, 'myplayer', { tab: 'attributes', view: 'capbreakers' }) });
  upgrades(app, box, c);
}

function upgrades(app, root, c) {
  const pending = {};
  const draw = () => {
    let cost = 0;
    for (const [k, v] of Object.entries(pending)) cost += upgradeCost(c.attributes[k], v);
    const projected = { ...c.attributes, ...pending };
    const ovr = overall(projected, c.position);
    const max = maxOvr(c);
    root.innerHTML = `
      <div class="row between"><div class="muted">Upgrade with VC up to each cap. Your build reaches ${max} OVR right now${max < OVR_CAP ? `; play The Pro Run to raise it to ${OVR_CAP}` : ''}. Hall of Fame badges bring cap breakers, which open at ${OVR_CAP} max OVR.</div>
        <div class="row gap"><button class="btn ghost" data-max>Max all · ${money(c.max_upgrade_cost)} VC</button></div></div>
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

// v0.4.5 cap breakers: +1 per breaker to an attribute that's at its cap and below 99. v0.4.7.5: they have their own
// menu in the Attributes tab, they bank until the build's max OVR reaches 90, and they can be placed any time after.
export function openCapBreakers(app, done = () => {}) {
  const c = app.char();
  if (!c) return done();
  const card = modal(`<h2>Cap breakers</h2><div id="cb-body"></div>`, { wide: true, close: false });
  capBreakerPanel(app, card.querySelector('#cb-body'), c, { done: () => { closeModal(); done(); } });
}

function capBreakerPanel(app, body, c, { inline = false, done = () => {} } = {}) {
  const avail = c.cap_breakers_available || 0, earned = c.cap_breakers_earned ?? avail;
  const unlocked = c.cap_breakers_unlocked ?? maxOvr(c) >= OVR_CAP;
  const plan = {};
  const left = () => avail - Object.values(plan).reduce((a, b) => a + b, 0);
  const applied = c.cap_breakers?.applied || {};
  if (!unlocked) {
    body.innerHTML = `<div class="cb-locked"><div class="cb-count"><b>${avail}</b><small>BANKED</small></div>
      <div><b>Cap breakers open at ${OVR_CAP} max OVR</b><p class="muted">You've earned ${earned} from Hall of Fame badges (5 each for your first 5). They stay banked here until your max OVR reaches ${OVR_CAP}: play The Pro Run to raise it, +1 every ${PRORUN_GAMES_PER_OVR} games. Then place them any time, on any attribute that's maxed out.</p></div></div>
      ${inline ? '' : '<div class="row gap end"><button class="btn primary" data-later>Continue</button></div>'}`;
    const l = body.querySelector('[data-later]'); if (l) l.onclick = () => done();
    return;
  }
  const draw = () => {
    const ovr = overall(Object.fromEntries(ATTRS.map(k => [k, c.attributes[k] + (plan[k] || 0)])), c.position);
    body.innerHTML = `<p class="muted">Each cap breaker adds +1 to an attribute that's maxed out on your build (at its cap, below 99), past the ${OVR_CAP} OVR cap. Upgrade an attribute to its cap with VC first to make it eligible. Unused ones stay banked here.</p>
      <div class="row between"><div>Left to place <b class="big">${left()}</b> of ${avail} · ${earned} earned · ${Object.values(applied).reduce((a, b) => a + b, 0)} placed</div><div>OVR <b class="big">${ovr}</b></div></div>
      <div class="attr-cols">${Object.entries(ATTR_GROUPS).map(([g, keys]) => `<div class="attr-group"><h5>${g}</h5>${keys.map(k => {
        const cur = c.attributes[k], cap = c.caps[k], n = plan[k] || 0, ok = cur >= cap && cap < 99;
        return `<div class="attr-row up ${ok ? '' : 'muted'}"><span>${ATTR_LABEL[k]}${applied[k] ? ` <em class="cb-used">+${applied[k]}</em>` : ''}</span>${bar(cur + n, 99, cap + n, n ? 'pending' : '')}<b style="color:${ratingColor(cur + n)}">${cur + n}</b>
          <span class="steppers"><button data-cbd="${k}" ${n ? '' : 'disabled'}>−</button><button data-cbi="${k}" ${ok && left() > 0 && cur + n < 99 ? '' : 'disabled'}>+</button></span></div>`;
      }).join('')}</div>`).join('')}</div>
      <div class="row gap end ${inline ? 'sticky-actions' : ''}">${inline ? `<button class="btn ghost" data-reset ${left() === avail ? 'disabled' : ''}>Reset</button>` : `<button class="btn ghost" data-later>${left() === avail ? 'Save for later' : 'Cancel'}</button>`}<button class="btn primary" data-ok ${left() === avail ? 'disabled' : ''}>Use cap breakers</button></div>`;
    body.querySelectorAll('[data-cbi]').forEach(b => b.onclick = () => { const k = b.dataset.cbi; plan[k] = (plan[k] || 0) + 1; draw(); });
    body.querySelectorAll('[data-cbd]').forEach(b => b.onclick = () => { const k = b.dataset.cbd; plan[k] = Math.max(0, (plan[k] || 0) - 1); if (!plan[k]) delete plan[k]; draw(); });
    const later = body.querySelector('[data-later]'); if (later) later.onclick = () => done();
    const reset = body.querySelector('[data-reset]'); if (reset) reset.onclick = () => { for (const k in plan) delete plan[k]; draw(); };
    body.querySelector('[data-ok]').onclick = async ev => {
      ev.currentTarget.disabled = true;
      try {
        let res = null;
        for (const [k, n] of Object.entries(plan)) res = await app.api.mutate(`/api/characters/${c.id}/capbreakers`, { attribute: k, count: n });
        if (res) app.replaceChar(res.character);
        app.audio.ui('buy'); toast('Cap breakers applied.');
        done();
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
  // v0.4.7.5 restrictions: the highest tier each badge reaches on this build (archetype and height)
  const caps = c.badge_caps || badgeCaps(c), capacity = c.hof_capacity ?? hofCapacity(c), need = c.icon_need ?? iconNeed(c);
  const hof = c.hof_count || 0, iconId = c.icon_badge || mineIcon?.[0];
  const pips = (tier, cap) => [1, 2, 3, 4].map(t => `<i class="pip p${t} ${t <= tier ? 'on' : ''} ${t > cap ? 'locked' : ''}" title="${TIER[t]}${t > cap ? ' (locked on this build)' : ''}"></i>`).join('');
  root.innerHTML = `<div class="muted">Badges level up from what you do in games: Bronze → Silver → Gold → Hall of Fame. Every earned badge is active, and each tier is a big step up from the last. A stat with none of its badges plays 10% weaker. Your archetype and height decide how far each badge can go. A build holds up to ${rules.hof_limit} Hall of Fame badges: the first 5 bring 5 cap breakers each, and the ${need === rules.hof_limit ? `${rules.hof_limit}th` : `${need}th (every one your build can reach)`} unlocks your archetype's Icon badge.</div>
    <div class="badge-build"><span>${esc(ARCHETYPES[c.archetype]?.label || title(c.archetype || ''))} · ${esc(BAND_LABEL[heightBand(c.height)] || '')}</span><b>${capacity}</b><small>badges can reach Hall of Fame on this build</small><b>${hof}/${Math.min(rules.hof_limit, capacity)}</b><small>Hall of Fame now</small></div>
    <div class="icon-badge ${icon ? 'on' : ''}"><div class="icon-art-wrap">${iconBadgeSVG(iconId, 76, { locked: !icon })}</div><div><b>${esc(icon ? icon.name : mineIcon ? mineIcon[1].name : 'Icon badge')}</b>
      <small>${icon ? 'UNLOCKED · ' : `Locked · ${hof}/${need} Hall of Fame · `}${esc((icon || mineIcon?.[1])?.desc || '')}</small></div></div>
    ${Object.entries(groups).map(([g, list]) => `<h5 class="group-h">${g}</h5><div class="badge-grid">${list.map(([id, b]) => {
      const st = c.badges?.[id] || { progress: 0, tier: 0 };
      const cap = caps[id] ?? 4, tier = Math.min(st.tier, cap);
      const next = tier < cap ? b.tiers[tier] ?? null : null, prev = tier ? b.tiers[tier - 1] : 0;
      const pct = next ? Math.max(0, Math.min(100, Math.round((st.progress - prev) / (next - prev) * 100))) : 100;
      const over = st.tier > cap ? ` · plays at ${TIER[cap]} on this build` : '';
      return `<div class="badge ${TIER_CLS[tier]} ${cap < 4 ? 'capped' : ''}"><div class="badge-art">${badgeSVG(id, tier, 58, { cap })}</div>
        <div class="badge-info"><b>${esc(b.name)}</b><small>${tier ? TIER[tier] : 'Not earned'}${over} · ${esc(b.desc)}</small>
        <div class="pips">${pips(tier, cap)}${cap < 4 ? `<em>Max ${TIER[cap]}</em>` : ''}</div>
        <span class="bar small"><i style="width:${pct}%"></i></span><small class="muted">${next ? `${st.progress}/${next} ${b.stat.replace('_', ' ')}` : tier >= cap && cap < 4 ? 'Maxed for this build' : 'Maxed'}</small></div></div>`;
    }).join('')}</div>`).join('')}`;
}

const ANIM_SLOTS = [['jumpshot', 'Jumpshot base', 'jumpshot'], ['release', 'Jumpshot release', 'jumpshot'], ['dunk', 'Dunk package', 'dunk'], ['layup', 'Layup package', 'layup'], ['sizeup', 'Size-up package', 'moves'], ['celebration', 'Celebration', 'celebrate'], ['movement', 'Movement style', 'gait']];
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
