// VC Store: browse by category, try on with the 3D player, and buy (server-priced). v0.4.7.5: equipping moved to its
// own screen, the Inventory (ui/inventory.js), so the store is just the store; jumpshot bases and releases are their
// own categories in both.
import { hsName } from '../sim/hashsling.js';
import { $, $$, esc, money, toast, modal, closeModal, title } from './common.js';
import * as Screens from './screens.js';
import { enterPark } from './modes.js';
import { playGreenSound } from '../core/greensound.js';

// [category, label, camera focus, group]
export const CATS = [
  ['top', 'Tops', 'upper', 'Apparel'], ['bottom', 'Bottoms', 'full', 'Apparel'], ['shoes', 'Shoes', 'shoes', 'Apparel'], ['accessory', 'Accessories', 'full', 'Apparel'],
  ['jumpshot', 'Jumpshot Bases', 'wide', 'Animations'], ['release', 'Releases', 'wide', 'Animations'], ['dunk', 'Dunks', 'wide', 'Animations'], ['layup', 'Layups', 'wide', 'Animations'],
  ['sizeup', 'Size-Ups', 'wide', 'Animations'], ['celebration', 'Celebrations', 'upper', 'Animations'], ['movement', 'Movement', 'wide', 'Animations'],
  // v0.4.7.5 green releases: the sound and the effect when your green goes in
  ['greensound', 'Green Sounds', 'green', 'Green Releases'], ['greenfx', 'Green FX', 'green', 'Green Releases'],
];
export const GROUPS = ['Apparel', 'Animations', 'Green Releases'];
const ACC_SLOTS = new Set(['socks', 'headband', 'sleeve', 'leg_sleeve', 'wristband', 'knee_pad', 'chain']);
export const inCat = (i, cat) => cat === 'accessory' ? ACC_SLOTS.has(i.slot) : i.slot === cat;
export const catOf = i => (ACC_SLOTS.has(i.slot) ? 'accessory' : i.slot);
// the slots you can leave empty (everything else always has something on)
export const optionalSlot = i => !['top', 'bottom', 'shoes', 'release', 'jumpshot', 'dunk', 'sizeup', 'layup'].includes(i.slot) && !(i.category === 'green' && i.price === 0 && !i.exclusive);

// category tabs grouped (Apparel | Animations | Green Releases), with a count when `count` is given
export function catTabs(cat, count = null) {
  return `<div class="cat-groups">${GROUPS.map(g => `<div class="cat-group"><span>${g}</span><div class="subtabs">${CATS.filter(c => c[3] === g).map(([k, l]) => `<button class="${cat === k ? 'on' : ''}" data-cat="${k}">${l}${count ? `<em>${count(k)}</em>` : ''}</button>`).join('')}</div></div>`).join('')}</div>`;
}

export function render(app, root, params = {}) {
  const c = app.char();
  if (!c) return Screens.go(app, 'create');
  let cat = params.cat || 'top', filter = params.filter || 'all', sel = params.sel || null;
  const draw = () => {
    const inv = new Set(app.profile.inventory);
    const items = Object.values(app.catalog).filter(i => inCat(i, cat)).filter(i => filter === 'all' || (filter === 'owned' ? inv.has(i.id) : !inv.has(i.id))).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    if (!sel || !items.find(i => i.id === sel)) sel = items[0]?.id || null;
    const item = sel ? app.catalog[sel] : null;
    root.innerHTML = `<section class="panel store">
      <div class="row between"><div><div class="eyebrow">VC STORE</div><h1>Gear up</h1></div><div class="row gap"><button class="btn ghost" data-inventory>Inventory</button>${params.returnPark ? '<button class="btn primary" data-back-park>Back to the park</button>' : ''}</div></div>
      ${catTabs(cat)}
      <div class="seg small">${['all', 'owned', 'new'].map(f => `<button class="${filter === f ? 'on' : ''}" data-filter="${f}">${title(f)}</button>`).join('')}</div>
      <div class="item-grid">${items.map(i => card(app, c, i, inv, sel)).join('') || '<div class="muted">Nothing here yet.</div>'}</div>
    </section>
    ${item ? detail(app, c, item, inv) : ''}`;
    $$('[data-cat]', root).forEach(b => b.onclick = () => { cat = b.dataset.cat; sel = null; draw(); });
    $$('[data-filter]', root).forEach(b => b.onclick = () => { filter = b.dataset.filter; draw(); });
    $$('[data-item]', root).forEach(b => b.onclick = () => { sel = b.dataset.item; draw(); });
    const bp = $('[data-back-park]', root); if (bp) bp.onclick = () => enterPark(app, params.returnPark);
    const buy = $('[data-buy]', root); if (buy) buy.onclick = () => purchase(app, c, item, draw);
    const goInv = () => Screens.go(app, 'inventory', { cat, sel: item?.id, returnPark: params.returnPark });
    $$('[data-inventory]', root).forEach(b => b.onclick = goInv);
    const hear = $('[data-hear]', root); if (hear) hear.onclick = () => playGreenSound(app.audio, item.id, {});
    tryOn(app, c, item, cat);
  };
  draw();
}

export function swatch(i) {
  if (i.category === 'green') return `<div class="sw-green ${i.exclusive ? 'gold' : ''}"><i>${i.slot === 'greensound' ? '♪' : '✦'}</i></div>`;
  if (i.category === 'animation') return `<div class="sw-anim">${i.slot === 'dunk' ? 'DNK' : i.slot === 'layup' ? 'LAY' : i.slot === 'celebration' ? 'CEL' : i.slot === 'sizeup' ? 'HND' : i.slot === 'release' ? 'REL' : i.slot === 'movement' ? 'MOV' : 'JS'}</div>`;
  const a = i.color || '#888', b = i.trim || i.accent || i.secondary || '#fff';
  return `<div class="sw-item" style="--a:${a};--b:${b}"><i></i></div>`;
}

export function lockReason(app, c, i) {
  if ((i.min_overall || 0) > c.overall) return `${i.min_overall} OVR`;
  if ((i.rep_required || 0) > c.rep.level) { const tiers = app.config.rep_tiers; const lvl = i.rep_required; return lvl >= 20 ? 'Legend' : `${tiers[Math.floor(lvl / 5)]} ${lvl % 5 + 1}`; }
  for (const [k, v] of Object.entries(i.min_attr || {})) if ((c.attributes[k] || 0) < v) return `${v} ${title(k)}`;
  return null;
}

function card(app, c, i, inv, sel) {
  const owned = inv.has(i.id), equipped = c.equipment[i.slot] === i.id, lock = lockReason(app, c, i);
  return `<button class="item ${sel === i.id ? 'on' : ''} ${owned ? 'owned' : ''}" data-item="${i.id}">${swatch(i)}
    <b>${esc(i.name)}</b><small>${equipped ? 'EQUIPPED' : owned ? 'OWNED' : i.exclusive === 'cup' ? '★ KING TUT CUP' : i.exclusive === 'icon' ? '★ ICON BADGE' : i.exclusive ? '★ DAILY SPIN' : lock ? '🔒 ' + esc(lock) : i.price ? money(i.price) + ' VC' : 'FREE'}</small></button>`;
}

export function itemExtra(i) {
  return i.release_seconds ? `Release speed ${i.release_seconds < 0.66 ? 'Quick' : i.release_seconds > 0.8 ? 'Slow' : 'Normal'} · arc ${i.arc}°` : i.set_height ? `Set point ${i.set_height > 1.08 ? 'High' : i.set_height < 1 ? 'Low' : 'Medium'}` : i.styles ? `Styles: ${i.styles.map(st => hsName(st) || title(st)).join(', ')}` : i.move_speed ? `Move speed ×${i.move_speed}` : i.cut ? `${title(i.cut)}-top` : '';
}

function detail(app, c, i, inv) {
  const owned = inv.has(i.id), equipped = c.equipment[i.slot] === i.id, lock = lockReason(app, c, i);
  const extra = itemExtra(i);
  return `<aside class="panel store-detail">
    <div class="eyebrow">${esc((CATS.find(x => x[0] === catOf(i)) || [, title(i.slot)])[1])}</div><h2>${esc(i.name)}</h2>
    <p class="muted">${esc(i.description || '')}</p>${extra ? `<p class="small">${esc(extra)}</p>` : ''}
    ${lock && !owned ? `<p class="lock">🔒 Requires ${esc(lock)}</p>` : ''}
    <div class="price">${i.exclusive === 'cup' ? '★ King Tut Cup exclusive' : i.exclusive === 'icon' ? '★ Icon badge exclusive' : i.exclusive ? '★ Daily Spin exclusive' : i.price ? money(i.price) + ' VC' : 'FREE'}</div>
    ${i.slot === 'greensound' ? '<button class="btn ghost small" data-hear>▶ Hear it</button>' : ''}
    <div class="row gap">${owned ? `<span class="owned-tag">${equipped ? '✓ Equipped' : '✓ Owned'}</span><button class="btn" data-inventory>${equipped ? 'In your Inventory' : 'Equip in Inventory'} →</button>` : i.exclusive === 'cup' ? '<button class="btn ghost" disabled>Win it in the King Tut Cup</button>' : i.exclusive === 'icon' ? `<button class="btn ghost" disabled>Comes with the ${esc(app.config.icon_badges?.[i.icon]?.name || 'Icon')} Icon badge</button>` : i.exclusive ? '<button class="btn ghost" disabled>Win it on the Daily Spin wheel</button>' : `<button class="btn primary" data-buy ${lock ? 'disabled' : ''}>Buy · ${money(i.price)} VC</button>`}</div>
  </aside>`;
}

export function tryOn(app, c, item, cat) {
  const focus = (CATS.find(x => x[0] === cat) || [])[2] || 'full';
  if (!item) { app.showroom.setCharacter(c, app.look(c)); return; }
  if (item.category === 'green') {
    // v0.4.7.5: a green release shows on a made jumper: this sound with your effect, or this effect with your sound
    app.showroom.setCharacter(c, app.look(c));
    app.showroom.setFocus(focus);
    const green = { sound: item.slot === 'greensound' ? item.id : c.equipment.greensound || 'gsnd_basic', fx: item.slot === 'greenfx' ? item.id : c.equipment.greenfx || 'gfx_basic' };
    app.showroom.setPreview('jumpshot', { green });
    return;
  }
  const eq = { ...c.equipment };
  if (item.category !== 'animation') eq[item.slot] = item.id;
  const b = { ...c, equipment: eq };
  app.showroom.setCharacter(b, app.look(b));
  app.showroom.setFocus(focus);
  if (item.slot === 'jumpshot' || item.slot === 'release') { b.equipment[item.slot] = item.id; app.showroom.setCharacter(b, app.look(b)); app.showroom.setPreview('jumpshot'); }
  else if (item.slot === 'dunk') app.showroom.setPreview('dunk', { style: item.signature || item.styles?.[0] || 'power', styles: item.styles });
  else if (item.slot === 'layup') app.showroom.setPreview('layup', { style: item.style || 'basic' });
  else if (item.slot === 'sizeup') app.showroom.setPreview('moves', { style: item.style || 'basic', lvl: item.lvl ?? 0, speed: item.move_speed });
  else if (item.slot === 'celebration') app.showroom.setPreview('celebrate', { kind: item.anim });
  else if (item.slot === 'movement') { b.equipment.movement = item.id; app.showroom.setCharacter(b, app.look(b)); app.showroom.setPreview('gait'); }
  else app.showroom.setPreview('idle');
}

async function purchase(app, c, item, redraw) {
  const card = modal(`<h2>Buy ${esc(item.name)}?</h2><p class="muted">${money(item.price)} VC · you have ${money(app.profile.balance)} VC</p>
    <div class="row gap end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-yes>Buy</button></div>`);
  card.querySelector('[data-yes]').onclick = async () => {
    closeModal();
    try {
      const res = await app.api.mutate('/api/store/purchase', { item_id: item.id, character_id: c.id });
      app.profile.inventory.push(item.id);
      app.setBalance(res.balance);
      app.audio.ui('buy');
      redraw();
      // v0.4.7.5: equip it right away, or keep shopping (everything you own is in the Inventory)
      const done = modal(`<div class="eyebrow">PURCHASED</div><h2>${esc(item.name)}</h2><p class="muted">It's in your Inventory.</p>
        <div class="row gap end"><button class="btn ghost" data-close>Keep shopping</button><button class="btn primary" data-eq>Equip now</button></div>`);
      done.querySelector('[data-eq]').onclick = async () => { closeModal(); await equip(app, c, item, redraw); toast(`Equipped ${item.name}.`); };
    } catch (e) { toast(e.message, 'error'); }
  };
}

export async function equip(app, c, item, redraw, remove = false) {
  try {
    const res = await app.api.mutate(`/api/characters/${c.id}/equip`, { slot: item.slot, item_id: remove ? null : item.id });
    app.replaceChar(res.character);
    Object.assign(c, res.character);
    redraw();
    return true;
  } catch (e) { toast(e.message, 'error'); return false; }
}
