// UI helpers: escaping, formatting, toasts, modals, small widgets.
import { audio } from '../core/audio.js';
import { ARCHETYPES, iconStatus } from '../sim/builds.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = x => Number(x || 0).toLocaleString('en-US');
export const heightStr = x => `${Math.floor(x / 12)}'${x % 12}"`;
export const title = s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

let toastTimer;
export function toast(text, kind = '') {
  const el = $('#toast');
  clearTimeout(toastTimer);
  el.textContent = text;
  el.className = 'toast ' + kind;
  el.hidden = false;
  if (kind === 'error') audio.ui('error');
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 3800);
}

export function modal(html, opts = {}) {
  const el = $('#modal');
  el.innerHTML = `<div class="modal-card ${opts.wide ? 'wide' : ''} ${opts.cls || ''}">${opts.close !== false ? '<button class="modal-x" data-close aria-label="Close">✕</button>' : ''}${html}</div>`;
  el.hidden = false;
  el.onclick = e => {
    if (e.target === el && opts.close !== false) closeModal();
    if (e.target.closest('[data-close]')) closeModal();
  };
  return el.firstElementChild;
}
export function closeModal() { const el = $('#modal'); el.hidden = true; el.innerHTML = ''; if (closeModal.onClose) { const f = closeModal.onClose; closeModal.onClose = null; f(); } }

// v0.4.8.6 quick patch 7: a menu that redraws itself (a timer tick, a purchase, equipping, a tab inside a panel) keeps
// every list where you had scrolled it, instead of jumping back to the top. keepScroll(root, draw) notes the scroll of
// root, its ancestors and every scrolled box inside it, runs draw (sync or async) and puts them back. A box is matched
// by its tag and classes (state classes like on/sel/pad-focus ignored) and its place among boxes with the same ones.
const SCROLL_STATE = /\b(on|sel|selected|active|busy|pad-focus|open|hover|pending|locked|new)\b/g;
const scrollKey = el => el.tagName + '.' + (typeof el.className === 'string' ? el.className.replace(SCROLL_STATE, '').replace(/\s+/g, ' ').trim() : '') + (el.id ? '#' + el.id : '');
function scrollBoxes(root) {
  const ups = []; for (let p = root.parentElement; p && p !== document.documentElement; p = p.parentElement) ups.push(p);
  const seen = new Map(), out = [];
  for (const el of [document.scrollingElement || document.documentElement, ...ups.reverse(), root, ...root.querySelectorAll('*')]) {
    const k = scrollKey(el), n = (seen.get(k) || 0) + 1; seen.set(k, n);
    out.push([k + ':' + n, el]);
  }
  return out;
}
export function keepScroll(root, draw) {
  if (!root || !root.isConnected) return draw();
  const before = scrollBoxes(root).filter(([, el]) => el.scrollTop > 0 || el.scrollLeft > 0).map(([k, el]) => [k, el.scrollTop, el.scrollLeft]);
  if (!before.length) return draw();
  const put = (late) => {
    if (!root.isConnected) return;
    const now = new Map(scrollBoxes(root));
    for (const [k, t, l] of before) {
      const el = now.get(k); if (!el) continue;
      // (the late pass, after images and fonts lay out, only lifts a box the redraw clamped; never fights your own scroll)
      if (late && el.scrollTop > 1) continue;
      el.scrollTop = t; el.scrollLeft = l;
    }
  };
  const done = v => { put(false); requestAnimationFrame(() => put(true)); return v; };
  const r = draw();
  return r && typeof r.then === 'function' ? r.then(done) : done(r);
}

export function confirmBox(text, okLabel = 'Confirm') {
  return new Promise(resolve => {
    const card = modal(`<h3>${esc(text)}</h3><div class="row gap end"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" data-yes>${esc(okLabel)}</button></div>`, { close: false });
    card.querySelector('[data-yes]').onclick = () => { closeModal(); resolve(true); };
    card.querySelector('[data-no]').onclick = () => { closeModal(); resolve(false); };
  });
}

export function bar(value, max = 99, cap = null, cls = '') {
  const pct = Math.round(value / max * 100), cp = cap != null ? Math.round(cap / max * 100) : null;
  return `<span class="bar ${cls}"><i style="width:${pct}%"></i>${cp != null ? `<em style="left:${cp}%"></em>` : ''}</span>`;
}

export const TIER = ['', 'Bronze', 'Silver', 'Gold', 'Hall of Fame'];
export const TIER_CLS = ['none', 'bronze', 'silver', 'gold', 'hof'];

export function busy(btn, on) { if (!btn) return; btn.disabled = on; btn.classList.toggle('busy', on); }

export function ratingColor(v) { return v >= 90 ? '#36e07a' : v >= 80 ? '#9be15d' : v >= 70 ? '#f7c948' : v >= 60 ? '#ff9f43' : '#ff6b57'; }

// v0.4.8.5 quick patch 3: a build's archetype as shown anywhere in the game. An ICON build (sim/builds.js iconStatus)
// carries ICON in front of it, in the Icon badges' animated spectrum (.icon-status).
export const archLabel = b => ARCHETYPES[b?.archetype]?.label || title(b?.archetype || '');
export const ICON_TAG = '<span class="icon-status">ICON</span>';
export const archHTML = b => (iconStatus(b) ? ICON_TAG + ' ' : '') + esc(archLabel(b));
