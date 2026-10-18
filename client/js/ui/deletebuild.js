// v0.4.8.5 qp8: deleting a build, the confirmation screen (MyPlayer → Players → Delete on a build's card). It shows the
// build and says plainly what goes with it and what the account keeps, then takes a 5-second hold to go through (ui/hold.js:
// ✕ / A, Enter or Space, or a mouse / touch press on the button; letting go early starts over, and a press already down
// when it opened doesn't count). ○ / B, Esc or Cancel back out. The server's delete is the real check
// (server/app.py delete_character): never while the build is in a game that can still finish.
import { esc, money, toast, modal, closeModal, heightStr, archHTML } from './common.js';
import { PAD, padGlyph } from '../core/input.js';
import { settings, saveSettings } from '../core/settings.js';
import { holdsIconSlot } from '../sim/builds.js';
import { HoldGate, HOLD_KEYS, HOLD_MS, holdPrompt } from './hold.js';
import * as Screens from './screens.js';

// the screen's content (no DOM: tested on its own)
export function deleteBuildHTML(app, c) {
  const p = c.progression || {}, games = p.games | 0, wins = p.wins | 0;
  const icon = holdsIconSlot(c), iconName = c.icon_badge && app.config?.icon_badges?.[c.icon_badge]?.name;
  const slots = app.profile?.build_slots;
  const lose = [
    `Its attributes (${c.overall} OVR)${c.cap_breakers_earned || c.cap_breakers?.earned ? ' and cap breakers' : ''}`,
    `Its badges${iconName ? `, and its Icon badge (${esc(iconName)})` : ''}`,
    `Its progress: ${games} game${games === 1 ? '' : 's'} (${wins}-${games - wins}), its win streaks and its Rep (${esc(c.rep?.label || 'Rookie')})`,
    `Its Pro-Am rank (${esc(c.proam_rank?.name || 'unranked')}${c.proam_rank ? `, ${money(c.proam_rank.rp)} RP` : ''})`,
    'Its Pro Run career, and its lifetime stats',
  ];
  const keep = [
    `Your VC (${money(app.profile?.balance)}): every build on your account shares the wallet`,
    'Your locker: every item you own stays yours',
    icon ? `Its build slot stays open: the slot this ICON build opened is your account's for good${slots ? ` (${slots.unlocked} of ${slots.max} open after this)` : ''}`
      : 'Its build slot, free for a new player',
  ];
  const pr = holdPrompt(app.input, padGlyph);
  return `<div class="del-build"><div class="eyebrow">DELETE BUILD</div><h2>Delete ${esc(c.name)}?</h2>
    <div class="player-card del-who"><b>${c.overall}</b><span>${esc(c.name)}<small>${esc(c.position)} · ${archHTML(c)} · ${heightStr(c.height)}</small></span></div>
    <div class="del-cols"><div class="del-lose"><h5>Gone for good</h5><ul>${lose.map(t => `<li>${t}</li>`).join('')}</ul></div>
      <div class="del-keep"><h5>Your account keeps</h5><ul>${keep.map(t => `<li>${t}</li>`).join('')}</ul></div></div>
    <p class="muted small">This can't be undone.</p>
    <button class="btn danger hold-btn" data-hold data-padhold><i class="hold-fill"></i><span class="hold-label">${pr.html}</span><b class="hold-count">${HOLD_MS / 1000}</b></button>
    <div class="row gap end"><span class="muted small hold-cancel">${pr.cancel}</span><button class="btn ghost" data-close>Cancel</button></div></div>`;
}

// after the server deleted it: the profile (builds and slots) from its answer, the next build picked the way switching
// builds picks one (or the creator when none are left), and online presence moved off it straight away
export function afterDelete(app, c, res, { go = Screens.go } = {}) {
  const p = app.profile;
  p.characters = Array.isArray(res?.characters) ? res.characters : p.characters.filter(x => x.id !== c.id);
  if (res?.build_slots) p.build_slots = res.build_slots;
  if (app.prorun?.charId === c.id) app.prorun = null; // (its Pro Run career went with it)
  const next = p.characters.find(x => x.id === app.selectedId) || p.characters[0] || null;
  app.selectedId = next ? next.id : null; settings.character = app.selectedId; saveSettings();
  toast(`Deleted ${c.name}.`);
  import('./online.js').then(O => O.touchWhere(app)).catch(() => {}); // (the 1-second presence update would follow anyway)
  if (next) go(app, 'myplayer', { tab: 'players' }); else go(app, 'create');
}

// (now, go: a clock and the screen change, for tests)
export function openDeleteBuild(app, c, { now, go } = {}) {
  const card = modal(deleteBuildHTML(app, c), { cls: 'delete-card' });
  const btn = card.querySelector('[data-hold]'), fill = btn.querySelector('.hold-fill'), label = btn.querySelector('.hold-label'), count = btn.querySelector('.hold-count');
  const inp = app.input, padDown = () => !!(inp?.gp?.connected && inp.gp.buttons?.[PAD.A]);
  // (whatever is already down as it opens, like the A or Enter that opened it, has to be let go first)
  const held = [...(padDown() ? ['pad'] : []), ...HOLD_KEYS.filter(k => inp?.down?.has(k)).map(k => 'key:' + k)];
  const gate = new HoldGate({ held, ...(now ? { now } : {}) });
  let busy = false, raf = 0, shown = '';
  // keyboard: Enter / Space are the hold here, never a click on whatever has focus (Esc is padnav's: Cancel). Not
  // stopped: the game's own key state (core/input.js) still sees them go down and up
  const onKey = e => {
    if (!card.isConnected) return cleanup(); // (closed: never holds up an Enter meant for the screen under it)
    if (!HOLD_KEYS.includes(e.code)) return;
    e.preventDefault();
    if (e.type === 'keyup') gate.release('key:' + e.code); else if (!e.repeat) gate.press('key:' + e.code);
  };
  window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
  // mouse and touch: press and hold on the button (a plain click, or padnav's A, does nothing)
  btn.addEventListener('pointerdown', e => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch { /* old browsers */ } gate.press('pointer'); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => gate.release('pointer'));
  btn.addEventListener('click', e => e.preventDefault());
  try { btn.focus({ preventScroll: true }); } catch { /* ignore */ }
  const cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true); };
  closeModal.onClose = cleanup; // (Cancel, ○ / B, Esc, a click outside: gone at once, not a frame later)
  const doDelete = async () => {
    busy = true; label.textContent = 'Deleting…';
    try {
      const res = await app.api.mutate(`/api/characters/${c.id}/delete`, {});
      cleanup(); closeModal(); afterDelete(app, c, res, go ? { go } : {});
    } catch (e) { toast(e.message, 'error'); gate.reset(); busy = false; shown = ''; }
  };
  const frame = () => {
    if (!card.isConnected) return cleanup(); // (closed: Cancel, ○ / B, Esc, or a click outside)
    if (!busy) {
      gate.set('pad', padDown());
      const pr = holdPrompt(inp, padGlyph); // (the glyph follows the device in use)
      if (pr.html !== shown) { shown = pr.html; label.innerHTML = pr.html; const cx = card.querySelector('.hold-cancel'); if (cx) cx.innerHTML = pr.cancel; }
      const holding = gate.holding(), pct = gate.progress() * 100;
      btn.classList.toggle('holding', holding);
      fill.style.width = `${pct}%`;
      count.textContent = holding ? gate.secondsLeft().toFixed(1) : String(HOLD_MS / 1000);
      if (gate.tick()) { fill.style.width = '100%'; doDelete(); }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { card, gate };
}
