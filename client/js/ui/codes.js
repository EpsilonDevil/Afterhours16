// v0.4.4 Locker Codes tab: type a code, the server checks it and pays out (each code has a per-account limit).
import { $, esc, money, toast } from './common.js';

export function render(app, root) {
  const draw = () => {
    const used = app.profile?.locker_codes || [];
    root.innerHTML = `<section class="panel wide-panel codes-panel">
      <div class="eyebrow">LOCKER CODES</div><h1>Open your locker</h1>
      <p class="muted">Got a code? Enter it here. Codes aren't case sensitive, and each one can only be used a limited number of times per account.</p>
      <form class="code-form" data-form>
        <input class="text code-input" data-code maxlength="40" placeholder="XXXX-X-XXXX-XX" autocomplete="off" spellcheck="false">
        <button class="btn primary big" data-redeem type="submit">Redeem</button>
      </form>
      <div class="code-result" data-result></div>
      <h4>Redeemed</h4>
      ${used.length ? `<table class="code-list">${used.map(c => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.label)}</td><td class="muted">${c.used} / ${c.max} used</td></tr>`).join('')}</table>` : '<p class="muted small">Nothing redeemed yet.</p>'}
    </section>`;
    const input = $('[data-code]', root), btn = $('[data-redeem]', root);
    input.focus();
    $('[data-form]', root).onsubmit = async ev => {
      ev.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      btn.disabled = true;
      try {
        const r = await app.api.mutate('/api/locker-codes/redeem', { code });
        app.setBalance(r.balance);
        const list = app.profile.locker_codes = (app.profile.locker_codes || []).filter(x => x.code !== r.code);
        list.unshift({ code: r.code, used: r.used, max: r.max, label: r.label });
        app.audio?.ui?.('buy');
        draw();
        $('[data-result]', root).innerHTML = `<div class="code-win"><div class="eyebrow">UNLOCKED</div><b>+${money(r.vc)} VC</b><small>${esc(r.code)} · ${r.max - r.used} use${r.max - r.used === 1 ? '' : 's'} left on this account</small></div>`;
      } catch (e) {
        btn.disabled = false;
        $('[data-result]', root).innerHTML = `<div class="code-err">${esc(e.message)}</div>`;
        toast(e.message, 'error');
      }
    };
  };
  draw();
}
