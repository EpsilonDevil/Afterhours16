// v0.4.7.5 Inventory: everything you own, by category, where you equip it (away from the store). Jumpshot bases and
// releases are separate, like in the store. The 3D player tries each item on as you go through.
import { $, $$, esc, money } from './common.js';
import * as Screens from './screens.js';
import { enterPark } from './modes.js';
import { playGreenSound } from '../core/greensound.js';
import { CATS, catTabs, inCat, swatch, tryOn, equip, itemExtra, optionalSlot, catOf } from './store.js';

export function render(app, root, params = {}) {
  const c = app.char();
  if (!c) return Screens.go(app, 'create');
  let cat = params.cat || (params.sel && app.catalog[params.sel] ? catOf(app.catalog[params.sel]) : 'top'), sel = params.sel || null;
  const draw = () => {
    const inv = new Set(app.profile.inventory);
    const owned = Object.values(app.catalog).filter(i => inv.has(i.id));
    const count = k => owned.filter(i => inCat(i, k)).length;
    // equipped first, then the rest by name
    const items = owned.filter(i => inCat(i, cat)).sort((a, b) => (c.equipment[b.slot] === b.id) - (c.equipment[a.slot] === a.id) || a.name.localeCompare(b.name));
    if (!sel || !items.find(i => i.id === sel)) sel = items.find(i => c.equipment[i.slot] === i.id)?.id || items[0]?.id || null;
    const item = sel ? app.catalog[sel] : null;
    const total = owned.length, worth = owned.reduce((s, i) => s + (i.price || 0), 0);
    root.innerHTML = `<section class="panel store inventory">
      <div class="row between"><div><div class="eyebrow">INVENTORY · ${total} ITEMS · ${money(worth)} VC OF GEAR</div><h1>Your locker</h1></div><div class="row gap"><button class="btn ghost" data-store>VC Store</button>${params.returnPark ? '<button class="btn primary" data-back-park>Back to the park</button>' : ''}</div></div>
      ${catTabs(cat, count)}
      <div class="item-grid">${items.map(i => card(c, i, sel)).join('') || `<div class="inv-empty muted">Nothing in ${esc((CATS.find(x => x[0] === cat) || [])[1] || 'here')} yet. <button class="btn small" data-store>Shop for some</button></div>`}</div>
    </section>
    ${item ? detail(c, item) : ''}`;
    $$('[data-cat]', root).forEach(b => b.onclick = () => { cat = b.dataset.cat; sel = null; draw(); });
    $$('[data-item]', root).forEach(b => b.onclick = () => { sel = b.dataset.item; draw(); });
    $$('[data-store]', root).forEach(b => b.onclick = () => Screens.go(app, 'store', { cat, returnPark: params.returnPark }));
    const bp = $('[data-back-park]', root); if (bp) bp.onclick = () => enterPark(app, params.returnPark);
    const eq = $('[data-equip]', root); if (eq) eq.onclick = () => { app.audio.ui('buy'); equip(app, c, item, draw); };
    const un = $('[data-unequip]', root); if (un) un.onclick = () => equip(app, c, item, draw, true);
    const hear = $('[data-hear]', root); if (hear) hear.onclick = () => playGreenSound(app.audio, item.id, {});
    tryOn(app, c, item, cat);
  };
  draw();
}

function card(c, i, sel) {
  const equipped = c.equipment[i.slot] === i.id;
  return `<button class="item ${sel === i.id ? 'on' : ''} ${equipped ? 'equipped' : ''}" data-item="${i.id}">${swatch(i)}
    <b>${esc(i.name)}</b><small>${equipped ? '✓ EQUIPPED' : i.exclusive === 'cup' ? '★ KING TUT CUP' : i.exclusive === 'icon' ? '★ ICON BADGE' : i.exclusive ? '★ DAILY SPIN' : 'OWNED'}</small></button>`;
}

function detail(c, i) {
  const equipped = c.equipment[i.slot] === i.id, extra = itemExtra(i);
  return `<aside class="panel store-detail">
    <div class="eyebrow">${esc((CATS.find(x => x[0] === catOf(i)) || [, i.slot])[1])}</div><h2>${esc(i.name)}</h2>
    <p class="muted">${esc(i.description || '')}</p>${extra ? `<p class="small">${esc(extra)}</p>` : ''}
    ${i.slot === 'greensound' ? '<button class="btn ghost small" data-hear>▶ Hear it</button>' : ''}
    <div class="row gap">${equipped ? (optionalSlot(i) ? '<span class="owned-tag">✓ Equipped</span><button class="btn ghost" data-unequip>Take off</button>' : '<span class="owned-tag">✓ Equipped</span>') : '<button class="btn primary" data-equip>Equip</button>'}</div>
  </aside>`;
}
