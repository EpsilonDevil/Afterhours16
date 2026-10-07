// UI helpers: escaping, formatting, toasts, modals, small widgets.
import { audio } from '../core/audio.js';

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
