// VC Store: browse by category, try on with the 3D player, buy (server-priced) and equip.
import { $, $$, esc, money, toast, confirmBox, title } from './common.js';
import * as Screens from './screens.js';
import { enterPark } from './modes.js';

const CATS = [
  ['top', 'Tops', 'upper'], ['bottom', 'Bottoms', 'full'], ['shoes', 'Shoes', 'shoes'],
  ['accessory', 'Accessories', 'full'], ['jumpshot', 'Jumpshots', 'wide'], ['dunk', 'Dunks', 'wide'], ['layup', 'Layups', 'wide'], ['sizeup', 'Size-Ups', 'wide'], ['celebration', 'Celebrations', 'upper'],
];
const ACC_SLOTS = new Set(['socks', 'headband', 'sleeve', 'leg_sleeve', 'wristband', 'knee_pad', 'chain']);
const inCat = (i, cat) => cat === 'accessory' ? ACC_SLOTS.has(i.slot) : cat === 'jumpshot' ? (i.slot === 'jumpshot' || i.slot === 'release') : i.slot === cat;

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
      <div class="row between"><div><div class="eyebrow">VC STORE</div><h1>Gear up</h1></div>${params.returnPark ? '<button class="btn primary" data-back-park>Back to the park</button>' : ''}</div>
      <div class="subtabs">${CATS.map(([k, l]) => `<button class="${cat === k ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>
      <div class="seg small">${['all', 'owned', 'new'].map(f => `<button class="${filter === f ? 'on' : ''}" data-filter="${f}">${title(f)}</button>`).join('')}</div>
      <div class="item-grid">${items.map(i => card(app, c, i, inv, sel)).join('') || '<div class="muted">Nothing here yet.</div>'}</div>
    </section>
    ${item ? detail(app, c, item, inv) : ''}`;
    $$('[data-cat]', root).forEach(b => b.onclick = () => { cat = b.dataset.cat; sel = null; draw(); });
    $$('[data-filter]', root).forEach(b => b.onclick = () => { filter = b.dataset.filter; draw(); });
    $$('[data-item]', root).forEach(b => b.onclick = () => { sel = b.dataset.item; draw(); });
    const bp = $('[data-back-park]', root); if (bp) bp.onclick = () => enterPark(app, params.returnPark);
    const buy = $('[data-buy]', root); if (buy) buy.onclick = () => purchase(app, c, item, draw);
    const eq = $('[data-equip]', root); if (eq) eq.onclick = () => equip(app, c, item, draw);
    const un = $('[data-unequip]', root); if (un) un.onclick = () => equip(app, c, item, draw, true);
    tryOn(app, c, item, cat);
  };
  draw();
}

function swatch(i) {
  if (i.category === 'animation') return `<div class="sw-anim">${i.slot === 'dunk' ? 'DNK' : i.slot === 'layup' ? 'LAY' : i.slot === 'celebration' ? 'CEL' : i.slot === 'sizeup' ? 'HND' : i.slot === 'release' ? 'REL' : 'JS'}</div>`;
  const a = i.color || '#888', b = i.trim || i.accent || i.secondary || '#fff';
  return `<div class="sw-item" style="--a:${a};--b:${b}"><i></i></div>`;
}

function lockReason(app, c, i) {
  if ((i.min_overall || 0) > c.overall) return `${i.min_overall} OVR`;
  if ((i.rep_required || 0) > c.rep.level) { const tiers = app.config.rep_tiers; const lvl = i.rep_required; return lvl >= 20 ? 'Legend' : `${tiers[Math.floor(lvl / 5)]} ${lvl % 5 + 1}`; }
  for (const [k, v] of Object.entries(i.min_attr || {})) if ((c.attributes[k] || 0) < v) return `${v} ${title(k)}`;
  return null;
}

function card(app, c, i, inv, sel) {
  const owned = inv.has(i.id), equipped = c.equipment[i.slot] === i.id, lock = lockReason(app, c, i);
  return `<button class="item ${sel === i.id ? 'on' : ''} ${owned ? 'owned' : ''}" data-item="${i.id}">${swatch(i)}
    <b>${esc(i.name)}</b><small>${equipped ? 'EQUIPPED' : owned ? 'OWNED' : i.exclusive ? '★ DAILY SPIN' : lock ? '🔒 ' + esc(lock) : i.price ? money(i.price) + ' VC' : 'FREE'}</small></button>`;
}

function detail(app, c, i, inv) {
  const owned = inv.has(i.id), equipped = c.equipment[i.slot] === i.id, lock = lockReason(app, c, i);
  const optional = !['top', 'bottom', 'shoes', 'release', 'jumpshot', 'dunk', 'sizeup', 'layup'].includes(i.slot);
  const extra = i.release_seconds ? `Release speed ${i.release_seconds < 0.66 ? 'Quick' : i.release_seconds > 0.8 ? 'Slow' : 'Normal'} · arc ${i.arc}°` : i.set_height ? `Set point ${i.set_height > 1.08 ? 'High' : i.set_height < 1 ? 'Low' : 'Medium'}` : i.styles ? `Styles: ${i.styles.map(title).join(', ')}` : i.move_speed ? `Move speed ×${i.move_speed}` : i.cut ? `${title(i.cut)}-top` : '';
  return `<aside class="panel store-detail">
    <div class="eyebrow">${esc(title(i.slot))}</div><h2>${esc(i.name)}</h2>
    <p class="muted">${esc(i.description || '')}</p>${extra ? `<p class="small">${esc(extra)}</p>` : ''}
    ${lock && !owned ? `<p class="lock">🔒 Requires ${esc(lock)}</p>` : ''}
    <div class="price">${i.exclusive === 'cup' ? '★ King Tut Cup exclusive' : i.exclusive ? '★ Daily Spin exclusive' : i.price ? money(i.price) + ' VC' : 'FREE'}</div>
    <div class="row gap">${owned ? (equipped ? (optional ? '<button class="btn ghost" data-unequip>Unequip</button>' : '<button class="btn ghost" disabled>Equipped</button>') : '<button class="btn primary" data-equip>Equip</button>') : i.exclusive === 'cup' ? '<button class="btn ghost" disabled>Win it in the King Tut Cup</button>' : i.exclusive ? '<button class="btn ghost" disabled>Win it on the Daily Spin wheel</button>' : `<button class="btn primary" data-buy ${lock ? 'disabled' : ''}>Buy</button>`}</div>
  </aside>`;
}

function tryOn(app, c, item, cat) {
  const focus = (CATS.find(x => x[0] === cat) || [])[2] || 'full';
  if (!item) { app.showroom.setCharacter(c, app.look(c)); return; }
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
  else app.showroom.setPreview('idle');
}

async function purchase(app, c, item, redraw) {
  if (!(await confirmBox(`Buy ${item.name} for ${money(item.price)} VC?`, 'Buy'))) return;
  try {
    const res = await app.api.mutate('/api/store/purchase', { item_id: item.id, character_id: c.id });
    app.profile.inventory.push(item.id);
    app.setBalance(res.balance);
    app.audio.ui('buy');
    toast(`Purchased ${item.name}.`);
    await equip(app, c, item, redraw);
  } catch (e) { toast(e.message, 'error'); }
}

async function equip(app, c, item, redraw, remove = false) {
  try {
    const res = await app.api.mutate(`/api/characters/${c.id}/equip`, { slot: item.slot, item_id: remove ? null : item.id });
    app.replaceChar(res.character);
    Object.assign(c, res.character);
    redraw();
  } catch (e) { toast(e.message, 'error'); }
}
