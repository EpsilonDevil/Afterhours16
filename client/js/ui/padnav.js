// Controller navigation for every menu (Steam/console style): D-pad or left stick moves a focus ring
// between controls, A selects, B goes back, LB/RB switch tabs, LT/RT page, right stick scrolls or
// turns the player in the showroom, Menu opens settings. Runs before gameplay each frame and consumes
// the buttons it uses, so a press never does two things.
import { PAD } from '../core/input.js';
import { $, closeModal } from './common.js';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea, [data-item], [data-pick], [tabindex]:not([tabindex="-1"])';

export const modalOpen = () => { const m = $('#modal'); return !!m && !m.hidden; };

function visible(el) {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) return false;
  for (let p = el; p; p = p.parentElement) if (p.hidden) return false;
  return true;
}
const sig = el => el.tagName + '|' + Object.entries(el.dataset || {}).map(([k, v]) => k + '=' + v).join(',') + '|' + (el.textContent || '').trim().slice(0, 24);

export class PadNav {
  constructor(app) {
    this.app = app;
    this.cur = null; this.curSig = null; this.curRect = null;
    this.rep = { dir: null, t: 0 };
    this.on = false;
    window.addEventListener('mousemove', e => { if (this.on && Math.abs(e.movementX) + Math.abs(e.movementY) > 3) this.hide(); });
    // keyboard: Esc closes dialogs that allow it
    window.addEventListener('keydown', e => {
      if (e.code !== 'Escape' || !modalOpen() || app.input.capturing) return;
      const x = $('#modal [data-close]');
      if (x) { e.preventDefault(); e.stopPropagation(); x.click(); app.input.pressed.delete('Escape'); }
    }, true);
  }

  scope() {
    if (modalOpen()) return $('#modal');
    if (this.app.mode === 'menu') return $('#ui');
    return null;
  }

  update(dt) {
    const inp = this.app.input, g = inp.gp;
    const root = this.scope();
    if (!g.connected || !root) { this.hide(); return; }
    if (inp.capturing) return;
    // anything to do this frame?
    const dir = this.readDir(dt);
    const anyEdge = [PAD.A, PAD.B, PAD.LB, PAD.RB, PAD.LT, PAD.RT, PAD.MENU].some(i => inp.gpEdge(i)) || inp.gpUp(PAD.LB) || inp.gpUp(PAD.RB);
    const rs = inp.stick(2, 3, 0.2);
    if (!dir && !anyEdge && rs.m === 0 && !this.on) return;
    this.on = true;
    document.body.classList.add('pad-mode');
    this.ensure(root);
    if (dir) this.move(root, dir);
    if (inp.gpEdge(PAD.A)) { this.activate(); inp.gp.prev[PAD.A] = true; }
    if (inp.gpEdge(PAD.B)) { this.back(); inp.gp.prev[PAD.B] = true; }
    // v0.4.4: bumpers switch tabs on release, so LB + RB together can open the social phone instead
    if (g.buttons[PAD.LB] && g.buttons[PAD.RB]) this.bumperCombo = true;
    if (inp.gpUp(PAD.LB)) { if (!this.bumperCombo) this.tab(root, -1); if (!g.buttons[PAD.RB]) this.bumperCombo = false; }
    if (inp.gpUp(PAD.RB)) { if (!this.bumperCombo) this.tab(root, 1); if (!g.buttons[PAD.LB]) this.bumperCombo = false; }
    if (inp.gpEdge(PAD.LT)) { this.page(-1); inp.gp.prev[PAD.LT] = true; }
    if (inp.gpEdge(PAD.RT)) { this.page(1); inp.gp.prev[PAD.RT] = true; }
    if (inp.gpEdge(PAD.MENU)) {
      inp.gp.prev[PAD.MENU] = true;
      if (modalOpen()) this.back();
      else if (this.app.mode === 'menu') import('./screens.js').then(S => S.openSettings(this.app));
    }
    // right stick: turn the player in the showroom, or scroll the panel under focus
    if (rs.m > 0) {
      if (this.app.mode === 'menu' && !modalOpen() && Math.abs(rs.x) > Math.abs(rs.y) && this.app.showroom?.spin) this.app.showroom.spin(rs.x * dt * 3.2);
      else { const sc = this.scroller(this.cur) || root; sc.scrollBy(0, rs.y * dt * 900); }
    }
  }

  readDir(dt) {
    const inp = this.app.input, g = inp.gp;
    let d = null;
    if (g.buttons[PAD.UP]) d = 'up'; else if (g.buttons[PAD.DOWN]) d = 'down'; else if (g.buttons[PAD.LEFT]) d = 'left'; else if (g.buttons[PAD.RIGHT]) d = 'right';
    if (!d) {
      const s = inp.stick(0, 1, 0.5);
      if (s.m > 0) d = Math.abs(s.x) > Math.abs(s.y) ? (s.x > 0 ? 'right' : 'left') : (s.y > 0 ? 'down' : 'up');
    }
    const r = this.rep;
    if (!d) { r.dir = null; return null; }
    if (d !== r.dir) { r.dir = d; r.t = 0.38; return d; }
    r.t -= dt;
    if (r.t <= 0) { r.t = 0.11; return d; }
    return null;
  }

  candidates(root) { return [...root.querySelectorAll(FOCUSABLE)].filter(visible); }

  ensure(root) {
    // a different screen or dialog starts from its primary action, not from where focus used to be
    const key = modalOpen() ? 'modal:' + (($('#modal h1, #modal h2, #modal h3') || {}).textContent || '') : 'screen:' + this.app.screen + ':' + this.app.mode;
    if (key !== this.scopeKey) { this.scopeKey = key; this.curSig = null; this.curRect = null; if (this.cur) this.cur.classList.remove('pad-focus'); this.cur = null; }
    if (this.cur && this.cur.isConnected && root.contains(this.cur) && visible(this.cur)) return;
    const list = this.candidates(root);
    if (!list.length) { this.set(null); return; }
    // same control re-rendered? otherwise the closest one to where focus was, otherwise the primary action
    let pick = this.curSig ? list.find(el => sig(el) === this.curSig) : null;
    if (!pick && this.curRect) {
      const cx = this.curRect.x + this.curRect.width / 2, cy = this.curRect.y + this.curRect.height / 2;
      let best = 1e9;
      for (const el of list) { const r = el.getBoundingClientRect(); const dd = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy); if (dd < best) { best = dd; pick = el; } }
    }
    if (!pick) pick = list.find(el => el.matches('.btn.primary') && !el.closest('.topbar')) || list.find(el => !el.closest('.topbar')) || list[0];
    this.set(pick && visible(pick) ? pick : list[0]);
  }

  set(el) {
    if (this.cur) this.cur.classList.remove('pad-focus');
    this.cur = el;
    if (!el) return;
    el.classList.add('pad-focus');
    this.curSig = sig(el);
    this.curRect = el.getBoundingClientRect();
    try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.app.audio?.ui?.('tick');
  }

  move(root, dir) {
    const el = this.cur;
    if (el && el.tagName === 'INPUT' && el.type === 'range' && (dir === 'left' || dir === 'right')) {
      const step = +el.step || 1;
      el.value = Math.min(+el.max, Math.max(+el.min, +el.value + (dir === 'right' ? step : -step)));
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (el && el.tagName === 'SELECT' && (dir === 'left' || dir === 'right')) {
      const n = el.options.length; el.selectedIndex = (el.selectedIndex + (dir === 'right' ? 1 : n - 1)) % n;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const list = this.candidates(root).filter(x => x !== el);
    if (!el) { this.set(list[0] || null); return; }
    const a = el.getBoundingClientRect();
    const ax = a.x + a.width / 2, ay = a.y + a.height / 2;
    let best = null, bs = Infinity;
    for (const c of list) {
      const b = c.getBoundingClientRect();
      const bx = b.x + b.width / 2, by = b.y + b.height / 2;
      let main, cross;
      if (dir === 'right') { main = b.left - a.right + (bx - ax) * 0.1; cross = by - ay; if (bx <= ax + 2) continue; }
      else if (dir === 'left') { main = a.left - b.right + (ax - bx) * 0.1; cross = by - ay; if (bx >= ax - 2) continue; }
      else if (dir === 'down') { main = b.top - a.bottom + (by - ay) * 0.1; cross = bx - ax; if (by <= ay + 2) continue; }
      else { main = a.top - b.bottom + (ay - by) * 0.1; cross = bx - ax; if (by >= ay - 2) continue; }
      const score = Math.max(-8, main) + Math.abs(cross) * 2.2;
      if (score < bs) { bs = score; best = c; }
    }
    if (best) this.set(best);
  }

  activate() {
    const el = this.cur;
    if (!el) return;
    if (el.tagName === 'SELECT') { const n = el.options.length; el.selectedIndex = (el.selectedIndex + 1) % n; el.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'password' || el.type === 'number')) { el.focus(); return; }
    el.click();
  }

  back() {
    if (modalOpen()) {
      const x = $('#modal [data-close]') || $('#modal [data-no]') || $('#modal .btn.ghost');
      if (x) x.click(); else if ($('#modal .modal-x')) closeModal();
      return;
    }
    const app = this.app;
    const back = $('#ui [data-cancel], #ui [data-back-park]');
    if (back) { back.click(); return; }
    if (app.mode === 'menu' && app.screen !== 'home' && app.char()) import('./screens.js').then(S => S.go(app, 'home'));
  }

  tab(root, step) {
    // in-screen tab strips first (MyPlayer tabs, store categories), else the top navigation
    const strips = [...root.querySelectorAll('.subtabs, .cats, .tabs-inner, nav.tabs')].filter(visible);
    const inScreen = strips.find(s => !s.closest('.topbar'));
    const strip = inScreen || strips[0];
    if (!strip) return;
    const btns = [...strip.querySelectorAll('button:not([disabled])')].filter(visible);
    if (!btns.length) return;
    let i = btns.findIndex(b => b.classList.contains('on'));
    if (i < 0) i = 0;
    const nb = btns[(i + step + btns.length) % btns.length];
    nb.click();
    requestAnimationFrame(() => this.ensure(this.scope() || root));
  }

  page(step) {
    const sc = this.scroller(this.cur) || this.scope();
    if (sc) sc.scrollBy({ top: step * sc.clientHeight * 0.8, behavior: 'smooth' });
  }

  scroller(el) {
    for (let p = el?.parentElement; p; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (/(auto|scroll)/.test(st.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return null;
  }

  hide() {
    if (!this.on) return;
    this.on = false;
    document.body.classList.remove('pad-mode');
    if (this.cur) this.cur.classList.remove('pad-focus');
  }
}
