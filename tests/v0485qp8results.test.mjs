// v0.4.8.5 quick patch 8: the results screen moves on by itself in every mode. The regular screen after 10 seconds, as
// before; one with news to read (a build slot opened, a new Hall of Fame or Icon badge) after 30, and the cards for an
// OVR increase (the Pro Run's max OVR +1, an Icon Legend +1 OVR) after 30 too. Those used to wait for a press forever.
// When the screen moves on by itself, new cap breakers stay banked (their menu doesn't open over the next game).
// Run: node --test tests/
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// (just enough of a browser for the UI modules; the modal is a stub that knows which buttons the card's HTML has)
const toastEl = { textContent: '', className: '', hidden: true };
let html = '', buttons = {};
const btn = (sel) => {
  const attr = sel.slice(1, -1), m = html.match(new RegExp(`${attr}[^>]*>([^<]*)<`));
  return buttons[sel] ||= { textContent: m ? m[1] : '', isConnected: true, onclick: null, click() { this.onclick?.(); } };
};
const card = { querySelector: s => (/^\[data-[a-z]+\]$/.test(s) && html.includes(s.slice(1, -1)) ? btn(s) : s === '.results .row.end' ? { insertAdjacentHTML: (w, h) => { html += h; } } : null), querySelectorAll: () => [] };
const modalEl = { hidden: true, onclick: null, get innerHTML() { return html; }, set innerHTML(v) { if (!v) { for (const b of Object.values(buttons)) b.isConnected = false; } html = v; buttons = {}; }, get firstElementChild() { return card; } };
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: s => (s === '#toast' ? toastEl : s === '#modal' ? modalEl : null), getElementById: () => null, addEventListener() {}, documentElement: {}, body: {}, createElement: () => ({ getContext: () => null, style: {} }) };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.matchMedia = () => ({ matches: false });

const M = await import('../client/js/ui/modes.js');
const src = fs.readFileSync(new URL('../client/js/ui/modes.js', import.meta.url), 'utf8');

const app = { config: { badges: {}, badge_rules: { ovr_cap: 90, prorun_games_per_ovr: 3, legend_games_per_ovr: 2, legend_ovr_cap: 99 }, icon_badges: {} }, profile: { inventory: [], characters: [] }, catalog: {}, ai: null };
const stats = { pts: 11, reb: 3, ast: 2, stl: 0, blk: 0, fgm: 4, fga: 9, tpm: 3, tpa: 5, tov: 0 };
const summary = (mode = 'proam') => ({ mode, score: [21, 15], me: { team: 0, stats } });
const rep = { label: 'Rookie 1', level: 0, points: 100, floor: 0, next: 1000 };
const result = (over = {}) => ({ vc: 500, rep: 100, rep_before: rep, rep_after: rep, badges_upgraded: [], badge_progress: {}, streak: 1, streak_mult: 1, character: {}, ...over });

function run(t, res, opts = {}, mode = 'proam') {
  const fired = [];
  M.showResults(app, summary(mode), res, true, { autoNext: true, again: () => fired.push('again'), menu: () => fired.push('menu'), stay: () => fired.push('stay'), leave: () => fired.push('leave'), ...opts });
  return fired;
}
const at = (t, s) => t.mock.timers.tick(s * 1000);

test('the regular results screen: 10 seconds, every mode (Pro-Am, the Pro Run, the park)', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  assert.equal(M.RESULTS_AUTO_SECS, 10);
  let f = run(t, result());
  assert.match(buttons['[data-again]'].textContent, / · 10$/);
  at(t, 9); assert.deepEqual(f, [], 'not at 9 s');
  at(t, 1); assert.deepEqual(f, ['again'], 'the next game starts at 10 s');
  f = run(t, result(), { park: true, autoNext: false }, 'park');
  at(t, 11); assert.deepEqual(f, ['stay'], 'the park: run it back after a win');
});

test('a screen that opened a build slot, or brought a Hall of Fame or Icon badge: 30 seconds', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  assert.equal(M.RESULTS_NEWS_SECS, 30);
  for (const extra of [{ build_slot_unlocked: { slot: 5, max: 8, opened: 1 } }, { icon_unlocked: 'open_arms', icon_items: [] }, { cap_breakers_awarded: 5 }]) {
    const f = run(t, result(extra));
    assert.match(buttons['[data-again]'].textContent, / · 30$/, JSON.stringify(extra));
    at(t, 11); assert.deepEqual(f, [], 'still up after 10 s');
    at(t, 20); assert.deepEqual(f, ['again'], `moves on after 30 s (${Object.keys(extra)[0]})`);
  }
  // in the park too
  const f = run(t, result({ build_slot_unlocked: { slot: 6, max: 8, opened: 1 } }), { park: true, autoNext: false }, 'park');
  at(t, 29); assert.deepEqual(f, []); at(t, 2); assert.deepEqual(f, ['stay']);
});

test('moving on by itself leaves new cap breakers banked (a press still opens their menu)', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  // (MyPlayer.openCapBreakers is a module export and can't be swapped out: the toast and the next game say it didn't open)
  const f = run(t, result({ cap_breakers_awarded: 5, character: { cap_breakers_unlocked: true } }));
  at(t, 31);
  assert.deepEqual(f, ['again'], 'the next game, not the cap breaker menu');
  assert.match(toastEl.textContent, /\+5 cap breakers banked: place them in MyPlayer → Attributes → Cap Breakers\./);
  assert.ok(src.includes('if (hof && r.cap_breakers_awarded && cbOpen && MyPlayer.openCapBreakers && !autoFired) MyPlayer.openCapBreakers(app, f);'), 'a press still opens it');
});

test('the OVR increase cards (max OVR +1, Icon Legend +1 OVR): Continue by itself after 30 s, then the results', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const extra of [{ max_ovr_unlocked: { from: 84, to: 85 } }, { legend_ovr: { from: 93, to: 94, games: 2, changes: { three_point: 1 } } }]) {
    const f = run(t, result(extra), {}, 'prorun');
    assert.match(html, /ovr-unlock/, 'the card first');
    assert.match(buttons['[data-ok]'].textContent, /^Continue · 30$/);
    at(t, 29); assert.match(html, /ovr-unlock/, 'still up at 29 s');
    at(t, 2);
    assert.match(html, /class="results /, 'then the results');
    assert.match(buttons['[data-again]'].textContent, / · 10$/, 'whose own countdown is the regular 10 s');
    at(t, 11); assert.deepEqual(f, ['again']);
  }
  // a press on the card goes straight on, and its countdown stops
  run(t, result({ max_ovr_unlocked: { from: 84, to: 85 } }), {}, 'prorun');
  buttons['[data-ok]'].click();
  assert.match(html, /class="results /);
});

test('wired in: one countdown helper, no screen left waiting forever', () => {
  assert.ok(src.includes('export const RESULTS_AUTO_SECS = 10, RESULTS_NEWS_SECS = 30;'));
  assert.ok(src.includes('stopCountdown = autoPress(auto, news ? RESULTS_NEWS_SECS : RESULTS_AUTO_SECS'));
  assert.ok(!src.includes('const auto = hof || slotUp ? null :'), 'the news screens no longer opt out');
  assert.equal(src.split('autoCard(card, next);').length - 1, 2, 'both OVR cards');
  assert.ok(!src.includes("card.querySelector('[data-ok]').onclick = () => { closeModal(); next(); };"));
});
