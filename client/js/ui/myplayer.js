// MyPlayer: attribute upgrades (VC), badges, appearance, animations, player management.
import { $, $$, esc, money, toast, modal, closeModal, bar, TIER, TIER_CLS, title, heightStr, confirmBox, ratingColor, archHTML, keepScroll, busy } from './common.js';
import { ATTR_GROUPS, ATTR_LABEL, ATTRS, overall } from '../sim/ratings.js';
import { upgradeCost, badgeCaps, hofCapacity, iconNeed, heightBand, BAND_LABEL, ARCHETYPES, maxOvr, BASE_OVR_CAP, OVR_CAP, PRORUN_GAMES_PER_OVR, prorunCompleted, forBuild, iconStatusInfo, winStreak, iconAuraLevel, ICON_AURA_STEP, buildSlots, MAX_BUILD_SLOTS } from '../sim/builds.js';
import { badgeSVG, iconBadgeSVG } from './badgeart.js';
import { ICON_BADGES } from '../sim/badges.js';
import { OA_BASIC } from '../sim/snags.js';
import { CLAMP_BASIC } from '../sim/clamp.js';
import { appearanceEditor } from './builder.js';
import { openDeleteBuild } from './deletebuild.js';
import { settings, saveSettings } from '../core/settings.js';
import * as Screens from './screens.js';

const TABS = [['attributes', 'Attributes'], ['badges', 'Badges'], ['animations', 'Animations'], ['appearance', 'Appearance'], ['players', 'Players']];

export function render(app, root, params = {}) {
  const c = app.char();
  if (!c) return Screens.go(app, 'create');
  const tab = params.tab || 'attributes';
  root.innerHTML = `<section class="panel mp">
    <div class="mp-head"><div><div class="eyebrow">${esc(c.position)} · ${archHTML(c)} · ${heightStr(c.height)}</div><h1>${esc(c.name)}</h1></div>
      <div class="ovr"><b>${c.overall}</b><small>OVR</small></div></div>
    <div class="subtabs">${TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="mp-body"></div></section>`;
  // (v0.4.8.7 qp7: another tab starts at its top; the screen notes which tab it's on, so a refresh after an action keeps
  // the place: Screens.go sameView)
  $$('[data-tab]', root).forEach(b => b.onclick = () => { app.screenParams = { tab: b.dataset.tab }; render(app, root, { tab: b.dataset.tab }); });
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

// v0.4.8.5: the attributes an Icon badge boosts carry its share next to the rating (Open Arms: +3% on every shooting and
// defense attribute). The rating shown is the build's; in games it plays that much higher, and can pass 99 there
export function iconBoostPct(c, k) {
  const ic = c?.icon_badge && ICON_BADGES[c.icon_badge];
  return ic ? (ic.all || 0) + (ic.stats?.[k] || 0) : 0;
}
function iconBoostTag(c, k, v) {
  const pct = iconBoostPct(c, k);
  if (!pct) return '';
  const name = ICON_BADGES[c.icon_badge].name, p = +(pct * 100).toFixed(1);
  return ` <em class="cb-used" title="${esc(`${name} Icon badge: +${p}% in games, and it can pass 99 (${v} plays as ${+(v * (1 + pct)).toFixed(1)} before badge effects)`)}">+${p}%</em>`;
}

function attributes(app, root, c, view = 'upgrades') {
  const cbN = c.cap_breakers_available || 0;
  root.innerHTML = `<div class="seg attr-seg"><button class="${view === 'upgrades' ? 'on' : ''}" data-view="upgrades">Upgrades</button><button class="${view === 'capbreakers' ? 'on' : ''}" data-view="capbreakers">Cap Breakers${cbN ? ` <span class="seg-n">${cbN}</span>` : ''}</button></div>
    ${maxOvrLine(app, c)}${maxOvr(c) >= OVR_CAP ? legendLine(app, c) : ''}<div id="attr-view"></div>`;
  $$('[data-view]', root).forEach(b => b.onclick = () => { app.screenParams = { tab: 'attributes', ...(b.dataset.view === 'capbreakers' ? { view: 'capbreakers' } : {}) }; attributes(app, root, app.char(), b.dataset.view); });
  const box = $('#attr-view', root);
  if (view === 'capbreakers') return capBreakerPanel(app, box, c, { inline: true, done: () => Screens.go(app, 'myplayer', { tab: 'attributes', view: 'capbreakers' }) });
  upgrades(app, box, c);
}

function upgrades(app, root, c) {
  const pending = {};
  const draw = () => keepScroll(root, paint); // (qp7: every + and − redraws in place)
  const paint = () => {
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
        return `<div class="attr-row up"><span>${ATTR_LABEL[k]}${iconBoostTag(c, k, nv)}</span>${bar(nv, 99, cap, nv > cur ? 'pending' : '')}<b style="color:${ratingColor(nv)}">${nv}</b>
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
      const btn = ev.currentTarget;
      if (!c.max_upgrade_cost) return toast('Already maxed out.');
      if (btn.disabled || !(await confirmBox(`Max every attribute for ${money(c.max_upgrade_cost)} VC?`, 'Max out'))) return;
      busy(btn, true); // (qp7: one purchase, however many clicks)
      try { const res = await app.api.mutate(`/api/characters/${c.id}/upgrade`, { max: true }); app.replaceChar(res.character); app.setBalance(res.balance); app.audio.ui('buy'); toast(`Maxed out for ${money(res.cost)} VC.`); Screens.go(app, 'myplayer', { tab: 'attributes' }); }
      catch (e) { toast(e.message, 'error'); busy(btn, false); }
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

export const CB_RESPEC_VC = 250000; // (server/builds.py CB_RESPEC_VC)
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
  // v0.4.8.7: an ICON build can take back its cap breakers and place them again: the first respec is free, then 250,000 VC
  const rs = c.cb_respec || {}, placed = Object.values(applied).reduce((a, b) => a + b, 0);
  let confirmRespec = false;
  const respecBar = () => !rs.eligible ? `<p class="muted cb-respec-note">Cap breaker respecs open once this build reaches ICON status.</p>`
    : `<div class="row between cb-respec"><div><b>Respec cap breakers</b><small class="muted"> Take back all ${placed} placed and place them again. ${rs.free ? 'Your first respec is free.' : `Costs ${CB_RESPEC_VC.toLocaleString()} VC.`} Your OVR drops until you place them again.</small></div>
      <button class="btn ${confirmRespec ? 'primary' : 'ghost'}" data-respec ${placed ? '' : 'disabled'}>${confirmRespec ? `Confirm respec · ${rs.free ? 'Free' : `${CB_RESPEC_VC.toLocaleString()} VC`}` : `Respec · ${rs.free ? 'Free' : `${CB_RESPEC_VC.toLocaleString()} VC`}`}</button></div>`;
  const draw = () => keepScroll(body, paint); // (qp7: placing one redraws in place, in the panel or the modal)
  const paint = () => {
    const ovr = overall(Object.fromEntries(ATTRS.map(k => [k, c.attributes[k] + (plan[k] || 0)])), c.position);
    body.innerHTML = `${respecBar()}<p class="muted">Each cap breaker adds +1 to an attribute that's maxed out on your build (at its cap, below 99), past the ${OVR_CAP} OVR cap. Upgrade an attribute to its cap with VC first to make it eligible. Unused ones stay banked here.</p>
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
    const respec = body.querySelector('[data-respec]');
    if (respec) respec.onclick = async ev => {
      if (!confirmRespec) { confirmRespec = true; draw(); return; }
      ev.currentTarget.disabled = true;
      try {
        const res = await app.api.mutate(`/api/characters/${c.id}/cbrespec`, {});
        app.replaceChar(res.character);
        if (res.balance != null && app.setBalance) app.setBalance(res.balance);
        app.audio.ui('buy'); toast(res.cost ? `Cap breakers taken back for ${res.cost.toLocaleString()} VC. Place them again.` : 'Cap breakers taken back (free respec). Place them again.');
        done();
      } catch (e) { toast(e.message, 'error'); confirmRespec = false; draw(); }
    };
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
  root.innerHTML = `<div class="muted">Badges level up from what you do in games: Bronze → Silver → Gold → Hall of Fame. Every earned badge is active, and each tier is a big step up from the last. A stat with none of its badges plays 10% weaker. Your archetype and height decide how far each badge can go. Every badge that can reach Hall of Fame on your build can get there: the first 5 Hall of Fame badges bring 5 cap breakers each, and the ${need === rules.hof_limit ? `${rules.hof_limit}th` : `${need}th (every one your build can reach)`} unlocks your archetype's Icon badge. ICON status needs every badge at its max.</div>
    <div class="badge-build"><span>${archHTML(c)} · ${esc(BAND_LABEL[heightBand(c.height)] || '')}</span><b>${capacity}</b><small>badges can reach Hall of Fame on this build</small><b>${hof}/${capacity}</b><small>Hall of Fame now</small></div>
    <div class="icon-badge ${icon ? 'on' : ''}"><div class="icon-art-wrap">${iconBadgeSVG(iconId, 76, { locked: !icon })}</div><div><b>${esc(icon ? icon.name : mineIcon ? mineIcon[1].name : 'Icon badge')}</b>
      <small>${icon ? 'UNLOCKED · ' : `Locked · ${hof}/${need} Hall of Fame · `}${esc((icon || mineIcon?.[1])?.desc || '')}</small></div></div>
    ${iconStatusCard(c)}
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

// [slot, label, preview, icon]. icon (v0.4.8.5): a row only the build holding that Icon badge has (the Open Arms Rebound
// Package; its "Basic Rip" chip takes the package off and leaves the badge's basic snag, the Open Arms Rip)
// v0.4.8.5 quick patch 3: the ICON status, the endgame, and how far this build is from it (qp7: and that every ICON opens
// a build slot on the account)
function iconStatusCard(c) {
  const st = iconStatusInfo(c), streak = winStreak(c), lvl = iconAuraLevel(streak);
  const row = (done, label, note) => `<li class="${done ? 'done' : ''}"><i>${done ? '✓' : '·'}</i><span>${label}</span><em>${note}</em></li>`;
  const aura = !st.active ? '' : lvl ? `Aura level ${lvl} of 4 · ${streak}-game win streak${lvl < 4 ? ` · ${ICON_AURA_STEP * (lvl + 1) - streak} more win${ICON_AURA_STEP * (lvl + 1) - streak === 1 ? '' : 's'} to level ${lvl + 1}` : ' · ultimate'}` : `Aura shows at a 3-game win streak · ${streak} now`;
  return `<div class="icon-status-card ${st.active ? 'on' : ''}"><div><b>${st.active ? '<span class="icon-status">ICON</span> status' : 'ICON status'}</b>
    <small>${st.active ? 'This build is an ICON: ICON before its archetype everywhere, its Icon badge under it in every mode, and a dark aura that grows with every 3 straight wins.' : 'The endgame: unlock every cap breaker, max every badge as far as this build can take it, and reach 99 OVR.'} Every ICON build opens one more build slot on your account (up to ${MAX_BUILD_SLOTS}), for good.</small>
    ${st.active ? `<small class="aura">${aura}</small>` : `<ul>${row(st.cap_breakers, 'All cap breakers unlocked', `${Math.min(st.cap_breakers_earned, st.cap_breakers_max)}/${st.cap_breakers_max}${maxOvr(c) < OVR_CAP ? ` · open at ${OVR_CAP} max OVR` : ''}`)}${row(st.badges, 'Every badge maxed', st.badges ? 'done' : `${st.badges_left} to go`)}${row(st.ovr >= st.ovr_need, '99 overall', `${st.ovr}/${st.ovr_need}`)}</ul>`}</div></div>`;
}

const ANIM_SLOTS = [['jumpshot', 'Jumpshot base', 'jumpshot'], ['release', 'Jumpshot release', 'jumpshot'], ['dunk', 'Dunk package', 'dunk'], ['layup', 'Layup package', 'layup'], ['sizeup', 'Size-up package', 'moves'], ['post', 'Post-move package', 'post'], ['block', 'Block package', 'block'], ['rebound', 'Rebound package', 'rebound', 'open_arms'], ['steal', 'Steal package', 'steal', 'the_clamp'], ['pass', 'Pass package', null, 'oprah'], ['celebration', 'Celebration', 'celebrate'], ['movement', 'Movement style', 'gait']]; // (v0.4.8.7 qp7: Oprah's Pass Package: no preview of its own yet)
function animations(app, root, c) {
  const inv = new Set(app.profile.inventory);
  root.innerHTML = `<div class="muted">Equip animations you own. Buy more in the VC Store. Click Preview to see them on your player.</div>
    ${ANIM_SLOTS.filter(([, , , icon]) => !icon || c.icon_badge === icon).map(([slot, label, preview, icon]) => {
      const owned = Object.values(app.catalog).filter(i => i.slot === slot && inv.has(i.id) && forBuild(i, c));
      const cur = c.equipment[slot];
      const basic = icon === 'open_arms' ? `<button class="chip ${!cur ? 'on' : ''}" data-equip="${slot}" data-id="" title="No package: the Open Arms badge's own basic snag">Basic Rip</button>`
        : icon === 'the_clamp' ? `<button class="chip ${!cur ? 'on' : ''}" data-equip="${slot}" data-id="" title="No package: The Clamp badge's own basic steal, The Vise">Basic Vise</button>` : ''; // (qp6)
      return `<div class="anim-slot"><h5>${label}</h5><div class="chips">${basic}${owned.map(i => `<button class="chip ${cur === i.id ? 'on' : ''}" data-equip="${slot}" data-id="${i.id}">${esc(i.name.split(': ').pop())}</button>`).join('') || (basic ? '' : '<span class="muted small">None owned</span>')}
        ${preview ? `<button class="chip ghost" data-preview="${preview}" data-slot="${slot}">Preview ▶</button>` : ''}</div></div>`;
    }).join('')}`;
  // (qp7: equipping one redraws the tab where you were scrolled, and waits for the server: no double equips)
  $$('[data-equip]', root).forEach(b => b.onclick = async () => {
    if (b.disabled || b.classList.contains('on')) return;
    busy(b, true);
    try { const res = await app.api.mutate(`/api/characters/${c.id}/equip`, { slot: b.dataset.equip, item_id: b.dataset.id || null }); app.replaceChar(res.character); const scr = root.parentElement.parentElement; keepScroll(scr, () => render(app, scr, { tab: 'animations' })); }
    catch (e) { toast(e.message, 'error'); busy(b, false); }
  });
  $$('[data-preview]', root).forEach(b => b.onclick = () => {
    const ch = app.char();
    app.showroom.setCharacter(ch, app.look(ch));
    const kind = b.dataset.preview;
    const dk = app.catalog[ch.equipment.dunk];
    const cel = app.catalog[ch.equipment.celebration];
    // v0.4.5: preview the equipped layup and size-up packages with their own style too
    const lay = app.catalog[ch.equipment.layup], su = app.catalog[ch.equipment.sizeup], bk = app.catalog[ch.equipment.block]; // (qp3: and the Block Package)
    const style = kind === 'layup' ? (lay?.style || 'basic') : kind === 'moves' ? (su?.style || 'basic') : dk?.styles?.[0];
    const po = app.catalog[ch.equipment.post], rb = app.catalog[ch.equipment.rebound]; // (v0.4.8.5: the Rebound Package's snags, or the basic Open Arms Rip)
    const stl = app.catalog[ch.equipment.steal]; // (qp6: the Steal Package's ten, or the basic Clamp Vise)
    app.showroom.setPreview(kind, { style, styles: kind === 'dunk' ? dk?.styles : kind === 'block' ? bk?.styles : kind === 'rebound' ? (rb?.styles || [OA_BASIC]) : kind === 'steal' ? (stl?.styles || [CLAMP_BASIC]) : undefined, lvl: su?.lvl, speed: su?.move_speed, kind: cel?.anim || 'flex', pkg: po?.id, sig: po?.sig });
    app.showroom.setFocus(kind === 'celebrate' ? 'upper' : 'wide');
  });
}

// v0.4.8.5 qp7: ICON build slots. An account starts with 4, and every ICON build on it opens one more, up to 8
// (app.profile.build_slots, the server's word; main.js app.replaceChar keeps it current)
export function accountSlots(app) {
  const chars = app.profile?.characters || [];
  return { ...buildSlots(chars), ...(app.profile?.build_slots || {}), used: chars.length };
}
export function slotsLine(s) {
  const extra = s.unlocked - s.base;
  const from = !extra ? '' : s.icons > extra ? ` + ${extra} from your ${s.icons} ICON builds` : ` + ${extra} ICON${extra === 1 ? '' : 's'}`;
  // (qp8: a deleted ICON build's slot stays open, and says where it came from)
  const kept = extra && s.kept ? ` (${s.kept} kept from ${s.kept === 1 ? 'a deleted ICON build' : 'deleted ICON builds'})` : '';
  return `Build slots: ${s.unlocked} of ${s.max} open — ${s.base} base${from}${kept}. ${s.unlocked >= s.max ? 'That\'s the most an account can have.' : `Every ICON build opens one more, up to ${s.max}.`}`;
}

// v0.4.8.5 qp8: each build's card picks it (a click, or A on a controller) and has a small Delete next to the name, its own
// control (it never picks the card; padnav reaches it with right from the card), which opens the 5-second hold screen
// (ui/deletebuild.js). The card is a div so the button can sit inside it (a button can't hold another)
function players(app, root) {
  const chars = app.profile.characters, slots = accountSlots(app);
  // (under 8, the next slot shows locked, saying how to open it)
  const next = slots.unlocked < slots.max ? `<div class="player-card locked" title="${esc(slotsLine(slots))}"><b>🔒</b><span>Slot ${slots.unlocked + 1} · locked<small>Make ${slots.icons ? 'another' : 'a'} build an ICON (every cap breaker, every badge maxed, 99 OVR) to open it</small></span></div>` : '';
  const cards = chars.length + (chars.length < slots.unlocked ? 1 : 0) + (next ? 1 : 0); // (past 5, two across)
  root.innerHTML = `<p class="muted small build-slots">${esc(slotsLine(slots))}</p>
    <div class="player-list ${cards > 5 ? 'many' : ''}">${chars.map(ch => `<div class="player-card ${ch.id === app.selectedId ? 'on' : ''}" data-pick="${ch.id}" role="button" tabindex="0"><b>${ch.overall}</b><span><span class="pc-name">${esc(ch.name)}<button class="pc-del" data-del="${ch.id}" title="Delete ${esc(ch.name)}" aria-label="Delete ${esc(ch.name)}">Delete</button></span><small>${ch.position} · ${archHTML(ch)} · ${esc(ch.rep.label)}</small></span></div>`).join('')}
    ${chars.length < slots.unlocked ? '<button class="player-card new" data-new>+ Create new player</button>' : ''}${next}</div>
    <p class="muted small">Your players share one VC wallet and locker.</p>`;
  $$('[data-pick]', root).forEach(b => {
    b.onclick = e => { if (e.target.closest('[data-del]')) return; app.selectedId = b.dataset.pick; settings.character = app.selectedId; saveSettings(); Screens.go(app, 'myplayer', { tab: 'players' }); };
    b.onkeydown = e => { if ((e.code === 'Enter' || e.code === 'Space') && e.target === b) { e.preventDefault(); b.click(); } };
  });
  $$('[data-del]', root).forEach(b => b.onclick = e => { e.stopPropagation(); const ch = chars.find(x => x.id === b.dataset.del); if (ch) openDeleteBuild(app, ch); });
  const nb = $('[data-new]', root); if (nb) nb.onclick = () => Screens.go(app, 'create');
}

export function switcher(app) {
  const card = modal(`<h2>Your players</h2><div class="player-list">${app.profile.characters.map(ch => `<button class="player-card ${ch.id === app.selectedId ? 'on' : ''}" data-pick="${ch.id}"><b>${ch.overall}</b><span>${esc(ch.name)}<small>${ch.position} · ${archHTML(ch)}</small></span></button>`).join('')}</div>`);
  card.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { app.selectedId = b.dataset.pick; settings.character = app.selectedId; saveSettings(); closeModal(); Screens.go(app, app.screen === 'create' ? 'home' : app.screen); });
}
