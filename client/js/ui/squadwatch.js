// v0.4.8.6 qp: the ICON Squad park event, the menus' side. Every 12 hours and a bit, for an hour, a squad of three 99 OVR
// ICONs from your AI world turns up at one of the three parks (sim/iconsquad.js and sim/world.js decide who, where and
// when; app.ai.iconSquad(t) → {k, park, start, end, ids, leader, outfit, roles} or null). There's no countdown to it: the
// game only says so once it's there.
//  * the Park screen: the park they're at wears an "ICON SQUAD HERE · 42 min left" tag, their names under it, kept
//    current every minute and gone when the hour's up (mountSquadTags)
//  * a toast when they show up, wherever you are in the menus or at another park, once a squad (watchSquads, a light
//    ticker; it doesn't look at all during a game, and at their park the park itself shows them arriving)
//  * the phone: a member's row has a small purple ICON SQUAD chip (ui/phone.js, squadChip)
import { esc } from './common.js';
import { PARK_NAMES } from '../sim/world.js';

// the squad on now (never throws: no AI world yet, or a world without the event)
export function squadNow(app, t = Date.now()) {
  try { return app?.ai?.iconSquad?.(t) || null; } catch { return null; }
}
export const minutesLeft = (sq, t = Date.now()) => Math.max(1, Math.ceil((sq.end - t) / 60000));
export const squadNames = (app, sq) => (sq?.ids || []).map(id => app?.ai?.entry?.(id)?.name || id);
export const parkName = park => PARK_NAMES[park] || park;
// is this hooper in the squad that's on (the phone's chip)
export function inSquadNow(app, id, t = Date.now()) {
  try { return !!(app?.ai?.squadOf ? app.ai.squadOf(id, t) : squadNow(app, t)?.ids?.includes(id)); } catch { return false; }
}

// the phone's chip on a member's row (and his profile), in the ICON purple
export const SQUAD_CHIP = '<i class="ph-chip squad" title="Running with this hour\'s ICON squad">ICON SQUAD</i>';

// ---- the Park screen ----
export function squadTagHTML(app, sq, t = Date.now()) {
  const names = squadNames(app, sq).map(esc).join(' · ');
  return `<span class="squad-tag" data-squad-tag title="${names}">ICON SQUAD HERE · ${minutesLeft(sq, t)} min left</span><small class="squad-names">${names}</small>`;
}
// draws the tag on the card of the park they're at (the cards are the Park screen's .aff[data-park]), again every minute;
// stops by itself once the screen is gone. Returns stop()
export function mountSquadTags(app, root, { every = 60000, now = () => Date.now(), setI = setInterval, clearI = clearInterval } = {}) {
  const draw = () => {
    for (const el of root.querySelectorAll('[data-squad-wrap]')) el.remove();
    for (const c of root.querySelectorAll('.aff.has-squad')) c.classList.remove('has-squad');
    const sq = squadNow(app, now());
    if (!sq) return null;
    const card = root.querySelector(`.aff[data-park="${sq.park}"]`);
    if (card) { card.classList.add('has-squad'); card.insertAdjacentHTML('beforeend', `<span class="squad-wrap" data-squad-wrap>${squadTagHTML(app, sq, now())}</span>`); }
    return sq;
  };
  draw();
  const id = setI(() => { if (!root.isConnected) { clearI(id); return; } draw(); }, every);
  return () => clearI(id);
}

// ---- the toast ----
const SEEN_KEY = 'ah16.iconsquad.seen';
const loadSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
const saveSeen = seen => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-8))); } catch { /* private mode */ } };
// "just showed up" in its first few minutes; after that (you opened the game mid-hour) it says how long they're on for
export function arrivalText(sq, t = Date.now()) {
  return t - sq.start < 5 * 60000 ? `An ICON squad just showed up at ${parkName(sq.park)}` : `An ICON squad is running at ${parkName(sq.park)} · on for ${minutesLeft(sq, t)} more min`;
}
// in a game: nothing is looked at or said until it's over (the ticker costs the frame loop nothing)
export const inGame = app => app?.mode === 'match' || (app?.mode === 'park' && !!app.world && app.world.mode !== 'roam');
// at their park already: it shows them arriving itself
export const atPark = (app, park) => app?.mode === 'park' && app.world?.themeId === park;

export function watchSquads(app, { every = 25000, now = () => Date.now(), say, setI = setInterval, clearI = clearInterval } = {}) {
  const seen = loadSeen();
  const check = () => {
    if (!app?.ai || !app.profile || inGame(app)) return null;
    const t = now(), sq = squadNow(app, t);
    if (!sq || seen.has(sq.k)) return null;
    seen.add(sq.k); saveSeen(seen);
    if (atPark(app, sq.park)) return null;
    const text = arrivalText(sq, t);
    say?.(text, sq);
    return text;
  };
  const id = setI(check, every);
  return { check, stop: () => clearI(id), seen };
}
