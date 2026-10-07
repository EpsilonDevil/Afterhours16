// v0.4.2 park rewards: the Daily Spin wheel and the Boosts kiosk.
import { $, esc, money, toast, modal, closeModal, title } from './common.js';
import { drawWheel, SEG_LABEL, angleFor } from '../world/wheelart.js';
import { ATTR_LABEL } from '../sim/ratings.js';

const fmtLeft = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${h}h ${String(m).padStart(2, '0')}m ${String(x).padStart(2, '0')}s`; };
const KIND_NAME = { vc500: '500 VC', vc2500: '2,500 VC', vc10000: '10,000 VC', vc50000: '50,000 VC', vc250000: '250,000 VC (jackpot)', gear: 'Exclusive gear', anim: 'Exclusive animation' };

// ---------------- Daily Spin ----------------
export function openWheel(app, onSpin) {
  const cfg = app.config.wheel || {};
  const segs = cfg.segments || [];
  const odds = cfg.odds || {};
  const status = () => app.profile.daily_spin || { next_at: 0 };
  const card = modal(`
    <div class="wheel-wrap">
      <div class="wheel-stage"><canvas class="wheel-canvas" width="520" height="520"></canvas><i class="wheel-pointer"></i></div>
      <div class="wheel-side">
        <div class="eyebrow">DAILY SPIN</div><h2>One free spin every 24 hours</h2>
        <p class="muted small">Win VC in five tiers, or a Daily Spin exclusive you can't buy in the store.</p>
        <div class="wheel-status" data-status></div>
        <button class="btn primary big" data-spin>Spin</button>
        <div class="wheel-prize" data-prize></div>
        <table class="odds">${Object.keys(KIND_NAME).map(k => `<tr><td>${KIND_NAME[k]}</td><td>${odds[k] != null ? (odds[k] >= 1 ? odds[k].toFixed(0) : odds[k].toFixed(1)) + '%' : ''}</td></tr>`).join('')}</table>
      </div>
    </div>`, { wide: true, cls: 'wheel-card' });
  const cv = card.querySelector('canvas'), g = cv.getContext('2d');
  const face = document.createElement('canvas'); face.width = face.height = 520;
  drawWheel(face.getContext('2d'), 520, segs, app.affColor || '#ffd84a');
  let ang = 0, spinning = false, timer = 0;
  const paint = () => { g.clearRect(0, 0, 520, 520); g.save(); g.translate(260, 260); g.rotate(ang); g.drawImage(face, -260, -260); g.restore(); };
  paint();
  const btn = card.querySelector('[data-spin]'), st = card.querySelector('[data-status]');
  const tick = () => {
    if (!card.isConnected) { clearInterval(timer); return; }
    if (spinning) return;
    const left = (status().next_at || 0) - Date.now() / 1000;
    btn.disabled = left > 0;
    st.innerHTML = left > 0 ? `Next spin in <b>${fmtLeft(left)}</b>` : '<b class="good">Your spin is ready!</b>';
  };
  tick(); timer = setInterval(tick, 1000);
  btn.onclick = async () => {
    if (spinning) return;
    spinning = true; btn.disabled = true; st.textContent = 'Spinning…';
    let res;
    try { res = await app.api.mutate('/api/daily-spin', {}); }
    catch (e) { spinning = false; toast(e.message, 'error'); tick(); return; }
    if (onSpin) onSpin(res.segment);
    app.audio?.ui?.('tick');
    const from = ang % (Math.PI * 2), to = angleFor(res.segment, segs.length, 6), dur = 4200, t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3.2);
      ang = from + (to - from) * e; paint();
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
    const done = () => {
      spinning = false;
      app.profile.daily_spin = { ...(app.profile.daily_spin || {}), next_at: res.next_at, last_prize: res };
      if (res.balance != null) app.setBalance(res.balance);
      const prize = card.querySelector('[data-prize]');
      if (res.item) {
        if (!app.profile.inventory.includes(res.item)) app.profile.inventory.push(res.item);
        const it = app.catalog[res.item];
        prize.innerHTML = `<div class="eyebrow">YOU WON</div><b>${esc(it?.name || res.item)}</b><small>${esc(title(it?.slot || ''))} · Daily Spin exclusive · find it in the VC Store to equip</small>`;
      } else prize.innerHTML = `<div class="eyebrow">YOU WON</div><b class="${res.kind === 'vc250000' ? 'jackpot' : ''}">${money(res.vc)} VC</b>${res.kind === 'vc250000' ? '<small>JACKPOT!</small>' : ''}`;
      app.audio?.ui?.('buy');
      tick();
    };
  };
}

// ---------------- Boosts ----------------
export function openBoosts(app) {
  const cfg = app.config.boosts || { categories: {}, packs: {}, amount: 5, max_games: 10 };
  const draw = () => {
    const c = app.char(), have = c.boosts || {};
    const card = modal(`
      <div class="eyebrow">BOOSTS</div><h2>Boost your next games</h2>
      <p class="muted small">Each boost adds <b>+${cfg.amount}</b> to every attribute in its category (up to 99) for the number of games you buy. A game is used up when a park or Pro-Am game tips off. You can stock up to ${cfg.max_games} games per category.</p>
      <div class="boost-grid">${Object.entries(cfg.categories).map(([k, b]) => `
        <div class="boost ${have[k] ? 'on' : ''}">
          <div class="row between"><b>${esc(b.name)}</b><span class="tag ${have[k] ? 'hot' : ''}">${have[k] ? `${have[k]} game${have[k] > 1 ? 's' : ''} left` : 'inactive'}</span></div>
          <small class="muted">${b.attrs.map(a => esc(ATTR_LABEL[a] || a)).join(' · ')}</small>
          <div class="row gap">${Object.entries(cfg.packs).map(([g, p]) => `<button class="btn small" data-buy="${k}:${g}" ${(have[k] || 0) + +g > cfg.max_games ? 'disabled' : ''}>${g} game${g > 1 ? 's' : ''} · ${money(p)} VC</button>`).join('')}</div>
        </div>`).join('')}</div>
      <div class="row end"><button class="btn primary" data-close>Done</button></div>`, { wide: true });
    card.querySelectorAll('[data-buy]').forEach(b => b.onclick = async () => {
      const [cat, games] = b.dataset.buy.split(':');
      b.disabled = true;
      try {
        const res = await app.api.mutate('/api/boosts/purchase', { character_id: app.char().id, category: cat, games: +games });
        app.replaceChar(res.character); app.setBalance(res.balance);
        app.audio?.ui?.('buy');
        toast(`${cfg.categories[cat].name} boost: +${games} game${games > 1 ? 's' : ''}`);
        draw();
      } catch (e) { toast(e.message, 'error'); b.disabled = false; }
    });
  };
  draw();
}

// keep the local copy in step with the server after a game ticket used up boosts
export function consumeBoostsLocal(app, ticket) {
  const c = app.char();
  if (!c || !ticket?.meta?.boosts?.length) return;
  c.boosts = { ...(c.boosts || {}) };
  for (const k of ticket.meta.boosts) { c.boosts[k] = (c.boosts[k] || 0) - 1; if (c.boosts[k] <= 0) delete c.boosts[k]; }
}
