// v0.4.7.5 Inventory: everything you own, by category, where you equip it (away from the store). Jumpshot bases and
// releases are separate, like in the store. The 3D player tries each item on as you go through.
import { $, $$, esc, money, keepScroll, busy } from './common.js';
import * as Screens from './screens.js';
import { enterPark } from './modes.js';
import { playGreenSound } from '../core/greensound.js';
import { CATS, catTabs, catShown, inCat, swatch, tryOn, equip, itemExtra, optionalSlot, catOf, forBuild, lockReason } from './store.js';

export function render(app, root, params = {}) {
  const c = app.char();
  if (!c) return Screens.go(app, 'create');
  let cat = params.cat || (params.sel && app.catalog[params.sel] ? catOf(app.catalog[params.sel]) : 'top'), sel = params.sel || null;
  if (!catShown(cat, c)) cat = 'top'; // (v0.4.8.5: the Rebounds are there only for the build that holds Open Arms)
  // (v0.4.8.7 qp7: picking an item or equipping it redraws the locker where you were scrolled; a new category starts at
  // the top of its list)
  const draw = (fresh = false) => (fresh ? paint() : keepScroll(root, paint));
  const paint = () => {
    const inv = new Set(app.profile.inventory);
    const owned = Object.values(app.catalog).filter(i => inv.has(i.id) && forBuild(i, c));
    const count = k => owned.filter(i => inCat(i, k)).length;
    // equipped first, then what this build can wear, then what it can't yet (v0.4.8.5), each by name
    const lock = new Map(owned.map(i => [i.id, c.equipment[i.slot] === i.id ? null : lockReason(app, c, i)]));
    const items = owned.filter(i => inCat(i, cat)).sort((a, b) => (c.equipment[b.slot] === b.id) - (c.equipment[a.slot] === a.id) || !!lock.get(a.id) - !!lock.get(b.id) || a.name.localeCompare(b.name));
    if (!sel || !items.find(i => i.id === sel)) sel = items.find(i => c.equipment[i.slot] === i.id)?.id || items[0]?.id || null;
    const item = sel ? app.catalog[sel] : null;
    const total = owned.length, worth = owned.reduce((s, i) => s + (i.price || 0), 0);
    root.innerHTML = `<section class="panel store inventory">
      <div class="row between"><div><div class="eyebrow">INVENTORY · ${total} ITEMS · ${money(worth)} VC OF GEAR</div><h1>Your locker</h1></div><div class="row gap"><button class="btn ghost" data-store>VC Store</button>${params.returnPark ? '<button class="btn primary" data-back-park>Back to the park</button>' : ''}</div></div>
      ${catTabs(cat, count, c)}
      <div class="item-grid">${items.map(i => card(c, i, sel, lock.get(i.id))).join('') || `<div class="inv-empty muted">Nothing in ${esc((CATS.find(x => x[0] === cat) || [])[1] || 'here')} yet. ${(CATS.find(x => x[0] === cat) || [])[4] ? 'It comes with your Icon badge.' : '<button class="btn small" data-store>Shop for some</button>'}</div>`}</div>
    </section>
    ${item ? detail(c, item, lock.get(item.id)) : ''}`;
    $$('[data-cat]', root).forEach(b => b.onclick = () => { if (cat === b.dataset.cat) return; cat = b.dataset.cat; sel = null; draw(true); });
    $$('[data-item]', root).forEach(b => b.onclick = () => { sel = b.dataset.item; draw(); });
    $$('[data-store]', root).forEach(b => b.onclick = () => Screens.go(app, 'store', { cat, returnPark: params.returnPark }));
    const bp = $('[data-back-park]', root); if (bp) bp.onclick = () => enterPark(app, params.returnPark);
    // (qp7: the button waits for the server: a second click while the first is on its way does nothing)
    const eq = $('[data-equip]', root); if (eq) eq.onclick = async () => { if (lock.get(item.id) || eq.disabled) return; app.audio.ui('buy'); busy(eq, true); if (!(await equip(app, c, item, () => draw()))) busy(eq, false); };
    const un = $('[data-unequip]', root); if (un) un.onclick = async () => { if (un.disabled) return; busy(un, true); if (!(await equip(app, c, item, () => draw(), true))) busy(un, false); };
    const hear = $('[data-hear]', root); if (hear) hear.onclick = () => playGreenSound(app.audio, item.id, {});
    tryOn(app, c, item, cat);
  };
  draw(true);
}

// v0.4.8.5: the locker is the account's, but each build wears only what it qualifies for. An item this build doesn't
// meet the requirements for (OVR, Rep, an attribute, an Icon badge) shows the lock and what it needs, and can't be put on
function card(c, i, sel, lock) {
  const equipped = c.equipment[i.slot] === i.id;
  return `<button class="item ${sel === i.id ? 'on' : ''} ${equipped ? 'equipped' : ''} ${lock ? 'locked' : ''}" data-item="${i.id}">${swatch(i)}
    <b>${esc(i.name)}</b><small>${equipped ? '✓ EQUIPPED' : lock ? '🔒 ' + esc(lock) : i.exclusive === 'cup' ? '★ KING TUT CUP' : i.exclusive === 'jungle' ? '★ JUNGLE BALLERS' : i.exclusive === 'beat' ? '★ BEAT GOES ON' : i.exclusive === 'monster' ? '★ MONSTER MASH' : i.exclusive === 'favela' ? '★ THE FAVELAS' : i.exclusive === 'icon' ? '★ ICON BADGE' : i.exclusive ? '★ DAILY SPIN' : 'OWNED'}</small></button>`;
}

function detail(c, i, lock) {
  const equipped = c.equipment[i.slot] === i.id, extra = itemExtra(i);
  return `<aside class="panel store-detail">
    <div class="eyebrow">${esc((CATS.find(x => x[0] === catOf(i)) || [, i.slot])[1])}</div><h2>${esc(i.name)}</h2>
    <p class="muted">${esc(i.description || '')}</p>${extra ? `<p class="small">${esc(extra)}</p>` : ''}
    ${lock ? `<p class="lock">🔒 This build can't equip it yet: requires ${esc(lock)}</p>` : ''}
    ${i.slot === 'greensound' ? '<button class="btn ghost small" data-hear>▶ Hear it</button>' : ''}
    <div class="row gap">${equipped ? (optionalSlot(i) ? '<span class="owned-tag">✓ Equipped</span><button class="btn ghost" data-unequip>Take off</button>' : '<span class="owned-tag">✓ Equipped</span>') : lock ? `<button class="btn ghost" data-equip disabled>🔒 Requires ${esc(lock)}</button>` : '<button class="btn primary" data-equip>Equip</button>'}</div>
  </aside>`;
}
