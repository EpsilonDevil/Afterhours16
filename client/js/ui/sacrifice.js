// v0.4.8.9 The Gauntlet: sacrifices and the account park cards (docs/GAUNTLET.md §12), the Server/UI side.
//  * MyPLAYER → Players: the "Account Park Cards" row (the cards the account has, and the next sacrifice's gate with how far
//    along it is), and Sacrifice on an ICON 99 build's card.
//  * The sacrifice screen: which builds can go, a plain warning that the build leaves the park for good (its slot freed),
//    the park card tier it brings and the attributes it can land on (the build's Icon badge stat list), then a 5-second
//    hold (ui/hold.js, the delete-build pattern: ui/deletebuild.js). The server is the real check (server/gauntlet.py:
//    ICON status, the account's next gate, at most three ever).
//  * After it: the park card revealed.
import { $, esc, toast, modal, closeModal, archHTML, heightStr } from './common.js';
import { PAD, padGlyph } from '../core/input.js';
import { settings, saveSettings } from '../core/settings.js';
import { ATTR_LABEL, ATTRS } from '../sim/ratings.js';
import { ICON_BADGES } from '../sim/badges.js';
import { iconStatus } from '../sim/builds.js';
import { HoldGate, HOLD_KEYS, HOLD_MS, holdPrompt } from './hold.js';
import * as Screens from './screens.js';

export const TIER_NAME = { common: 'Common', rare: 'Rare', legendary: 'Legendary' };
export const GATE_TIERS = [['common', 0.01], ['rare', 0.03], ['legendary', 0.05]]; // (server/gauntlet.py TIERS)
// the attributes a sacrificed build's park card can land on: its Icon badge's stat list (server/gauntlet.py
// ICON_CARD_STATS mirrors it): The General's "all" is any attribute; Sharp Eye (which widens the green window and
// boosts no attribute) Three Point or Mid-Range
export function parkCardStats(icon) {
  if (icon === 'sharp_eye') return ['three_point', 'mid_range'];
  const ic = ICON_BADGES[icon];
  if (!ic) return [];
  return ic.all ? [...ATTRS] : Object.keys(ic.stats || {});
}
export const attrName = a => ATTR_LABEL[a] || String(a).replace(/_/g, ' ');
export const pctText = p => `+${Math.round(p * 100)}%`;
const iconName = (app, id) => app.config?.icon_badges?.[id]?.name || ICON_BADGES[id]?.name || id;

// the account's state for the row and the screen (the profile's, refreshed from /api/gauntlet/profile)
export const unlocksOf = app => app.profile?.gauntlet_unlocks || { completed: 0, distinctCompleted: 0, sacrificesDone: 0, next: { n: 1, tier: 'common', pct: 0.01, needs: { completed: 1, distinct: 0 }, have: { completed: 0, distinct: 0 }, ready: false } };
export const cardsOf = app => (Array.isArray(app.profile?.park_cards) ? app.profile.park_cards : []);
// a build that can be sacrificed: an ICON (99 OVR with everything maxed: sim/builds.js iconStatus) with its Icon badge
export const canSacrifice = c => !!c && iconStatus(c) && !!c.icon_badge;
export function gateText(nx) {
  if (!nx) return 'All three sacrifices are done.';
  const g = nx.needs, h = nx.have || {};
  const runs = `${Math.min(h.completed | 0, g.completed)}/${g.completed} completed Gauntlet run${g.completed === 1 ? '' : 's'}`;
  return g.distinct ? `${runs} · ${Math.min(h.distinct | 0, g.distinct)}/${g.distinct} different players` : runs;
}
export function cardChip(k) {
  return `<span class="park-card t-${esc(k.tier)}" title="${esc(TIER_NAME[k.tier] || k.tier)} park card${k.name ? ` from ${esc(k.name)}` : ''}"><b>${pctText(k.pct)}</b><span>${esc(attrName(k.attr))}</span><small>${esc((TIER_NAME[k.tier] || k.tier).toUpperCase())}${k.name ? ` · ${esc(k.name)}` : ''}</small></span>`;
}

// MyPLAYER → Players: the "Account Park Cards" row
export function parkCardsRowHTML(app) {
  const cards = cardsOf(app), u = unlocksOf(app), nx = u.next;
  const next = nx ? `<div class="park-next ${nx.ready ? 'ready' : ''}"><small>NEXT SACRIFICE · ${esc((TIER_NAME[nx.tier] || '').toUpperCase())} ${pctText(nx.pct)}</small><span>${esc(gateText(nx))}</span>${nx.ready ? '<em>Ready: Sacrifice on an ICON build\'s card</em>' : ''}</div>` : '<div class="park-next done"><small>SACRIFICES</small><span>All three done</span></div>';
  return `<div class="park-cards-row" data-parkcards><div class="eyebrow">ACCOUNT PARK CARDS</div>
    <div class="park-cards">${cards.length ? cards.map(cardChip).join('') : '<span class="muted small">None yet: sacrifice an ICON 99 build into the Gauntlet to earn one. Park cards boost every build on your account in park games.</span>'}${next}</div></div>`;
}

// the sacrifice screen's content (no DOM: tested on its own)
export function sacrificeHTML(app, c) {
  const u = unlocksOf(app), nx = u.next, ok = canSacrifice(c);
  const tier = nx ? nx.tier : null, pct = nx ? nx.pct : 0;
  const stats = parkCardStats(c.icon_badge), many = stats.length > 6;
  const why = !ok ? `${esc(c.name)} isn't an ICON 99 build: only ICONs can be sacrificed.` : !nx ? 'All three sacrifices are done: there are no more park cards to earn.' : !nx.ready ? `Not yet: the next sacrifice needs ${esc(gateText(nx))}.` : '';
  const others = (app.profile?.characters || []).filter(x => x.id !== c.id && canSacrifice(x)).map(x => esc(x.name));
  const pr = holdPrompt(app.input, padGlyph, 'sacrifice');
  return `<div class="sac-build"><div class="eyebrow">SACRIFICE TO THE GAUNTLET</div><h2>Sacrifice ${esc(c.name)}?</h2>
    <div class="player-card del-who"><b>${c.overall}</b><span>${esc(c.name)}<small>${esc(c.position)} · ${archHTML(c)} · ${heightStr(c.height)}${c.icon_badge ? ` · ${esc(iconName(app, c.icon_badge))} Icon` : ''}</small></span></div>
    <div class="sac-warn"><b>${esc(c.name)} leaves the park for good.</b> The build is gone from your players and its slot is freed. It can't be played in the park, Pro-Am or the Pro Run again. It lives on as a Gauntlet player with its name, look and Icon, offered at the start of every run.</div>
    ${nx ? `<div class="sac-brings"><small>IT BRINGS</small><span class="park-card t-${tier}"><b>${pctText(pct)}</b><span>${many ? 'any attribute' : stats.map(attrName).map(esc).join(' or ')}</span><small>${esc((TIER_NAME[tier] || '').toUpperCase())} PARK CARD</small></span>
      <p class="muted small">One attribute drawn from ${esc(iconName(app, c.icon_badge))}'s stat list${many ? ' (every attribute)' : ''}. A park card boosts every build on your account in park games (event parks too), never in Pro-Am, the Pro Run or crew runs.</p></div>` : ''}
    ${why ? `<p class="lock">${why}</p>` : ''}
    ${others.length ? `<p class="muted small">Your other builds that can go: ${others.join(', ')}.</p>` : ''}
    <p class="muted small">This can't be undone. Sacrifices: ${u.sacrificesDone | 0} of 3.</p>
    ${!why ? `<button class="btn danger hold-btn" data-hold data-padhold><i class="hold-fill"></i><span class="hold-label">${pr.html}</span><b class="hold-count">${HOLD_MS / 1000}</b></button>` : ''}
    <div class="row gap end"><span class="muted small hold-cancel">${pr.cancel}</span><button class="btn ghost" data-close>${why ? 'Close' : 'Cancel'}</button></div></div>`;
}

// the new park card, revealed
export function revealHTML(card, name) {
  return `<div class="card-reveal t-${esc(card.tier)}"><div class="eyebrow">NEW PARK CARD</div><h2>${esc(TIER_NAME[card.tier] || card.tier)}</h2>
    <div class="reveal-card"><b>${pctText(card.pct)}</b><span>${esc(attrName(card.attr))}</span><small>${esc(name || '')}</small></div>
    <p class="muted">Every build on your account plays with ${pctText(card.pct)} ${esc(attrName(card.attr))} in park games. ${esc(name || 'Your ICON')} is waiting in the Gauntlet.</p>
    <div class="row gap end"><button class="btn primary" data-close>Got it</button></div></div>`;
}

// after the server took it: the profile from its answer, the next build picked (or the creator when none are left)
export function afterSacrifice(app, c, res, { go = Screens.go } = {}) {
  const p = app.profile;
  p.characters = Array.isArray(res?.characters) ? res.characters : p.characters.filter(x => x.id !== c.id);
  if (res?.build_slots) p.build_slots = res.build_slots;
  if (res?.unlocks) p.gauntlet_unlocks = res.unlocks;
  if (res?.card) p.park_cards = [...cardsOf(app).filter(k => k.n !== res.card.n), res.card];
  if (app.prorun?.charId === c.id) app.prorun = null;
  const next = p.characters.find(x => x.id === app.selectedId) || p.characters[0] || null;
  app.selectedId = next ? next.id : null; settings.character = app.selectedId; saveSettings();
  import('./online.js').then(O => O.touchWhere(app)).catch(() => {});
  if (next) go(app, 'myplayer', { tab: 'players' }); else go(app, 'create');
  if (res?.card) modal(revealHTML(res.card, c.name), { cls: 'reveal-card-modal' });
}

// the screen, with its 5-second hold (now, go: a clock and the screen change, for tests)
export function openSacrifice(app, c, { now, go } = {}) {
  const card = modal(sacrificeHTML(app, c), { cls: 'delete-card sacrifice-card' });
  const btn = card.querySelector('[data-hold]');
  if (!btn) return { card, gate: null };
  const fill = btn.querySelector('.hold-fill'), label = btn.querySelector('.hold-label'), count = btn.querySelector('.hold-count');
  const inp = app.input, padDown = () => !!(inp?.gp?.connected && inp.gp.buttons?.[PAD.A]);
  const held = [...(padDown() ? ['pad'] : []), ...HOLD_KEYS.filter(k => inp?.down?.has(k)).map(k => 'key:' + k)];
  const gate = new HoldGate({ held, ...(now ? { now } : {}) });
  let busy = false, raf = 0, shown = '';
  const onKey = e => {
    if (!card.isConnected) return cleanup();
    if (!HOLD_KEYS.includes(e.code)) return;
    e.preventDefault();
    if (e.type === 'keyup') gate.release('key:' + e.code); else if (!e.repeat) gate.press('key:' + e.code);
  };
  window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
  btn.addEventListener('pointerdown', e => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch { /* old browsers */ } gate.press('pointer'); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => gate.release('pointer'));
  btn.addEventListener('click', e => e.preventDefault());
  try { btn.focus({ preventScroll: true }); } catch { /* ignore */ }
  const cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true); };
  closeModal.onClose = cleanup;
  const go_ = async () => {
    busy = true; label.textContent = 'Sacrificing…';
    try {
      const res = await app.api.mutate('/api/gauntlet/sacrifice', { character_id: c.id });
      cleanup(); closeModal(); afterSacrifice(app, c, res, go ? { go } : {});
    } catch (e) { toast(e.message, 'error'); gate.reset(); busy = false; shown = ''; }
  };
  const frame = () => {
    if (!card.isConnected) return cleanup();
    if (!busy) {
      gate.set('pad', padDown());
      const pr = holdPrompt(inp, padGlyph, 'sacrifice');
      if (pr.html !== shown) { shown = pr.html; label.innerHTML = pr.html; const cx = card.querySelector('.hold-cancel'); if (cx) cx.innerHTML = pr.cancel; }
      const holding = gate.holding(), pct = gate.progress() * 100;
      btn.classList.toggle('holding', holding);
      fill.style.width = `${pct}%`;
      count.textContent = holding ? gate.secondsLeft().toFixed(1) : String(HOLD_MS / 1000);
      if (gate.tick()) { fill.style.width = '100%'; go_(); }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { card, gate };
}

// the row's state fresh from the server (a run finished in the Gauntlet since the profile loaded): redraws it in place
export async function refreshParkCards(app, root) {
  try {
    const g = await app.api.get('/api/gauntlet/profile');
    app.profile.gauntlet_unlocks = g.unlocks; app.profile.park_cards = g.parkCards;
    const el = root && $('[data-parkcards]', root);
    if (el && el.isConnected) el.outerHTML = parkCardsRowHTML(app);
  } catch { /* offline: the profile's copy stays */ }
}
