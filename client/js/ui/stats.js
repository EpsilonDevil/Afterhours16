// v0.4.4 lifetime stats: a Stats tab in the menus and a pause-menu modal in game. Standard box-score
// averages and shooting splits per build, split by mode, plus a side-by-side table of all your builds and the
// auto-play profile those numbers produce.
import { $$, esc, modal } from './common.js';
import { ARCHETYPES } from '../sim/builds.js';
import { careerSplit, careerLine, fmtPct, statProfile, STAT_LABELS } from '../sim/profile.js';

const MODES = [['all', 'All games'], ['park', 'Park'], ['proam', 'Pro-Am']];
const f1 = v => (v == null ? '—' : v.toFixed(1));
const tendLabel = v => (v >= 0.8 ? 'Very high' : v >= 0.62 ? 'High' : v >= 0.4 ? 'Average' : v >= 0.22 ? 'Low' : 'Very low');

function detail(char, mode) {
  const L = careerLine(careerSplit(char, mode));
  const t = L.totals;
  const tiles = [['GP', L.gp], ['W-L', `${L.wins}-${L.losses}`], ['PPG', f1(L.ppg)], ['RPG', f1(L.rpg)], ['APG', f1(L.apg)], ['SPG', f1(L.spg)], ['BPG', f1(L.bpg)], ['TOV', f1(L.tpg)],
    ['FG%', fmtPct(L.fg)], ['3P%', fmtPct(L.tp)], ['FT%', fmtPct(L.ft)], ['eFG%', fmtPct(L.efg)], ['TS%', fmtPct(L.ts)], ['MIN', L.min == null ? '—' : f1(L.min)]];
  const tot = ['pts', 'reb', 'oreb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'pf'];
  const extra = ['dunks', 'greens', 'contested_makes', 'ankles', 'posters', 'putbacks', 'chasedowns', 'alleyoops'];
  return `
    <div class="st-tiles">${tiles.map(([k, v]) => `<div><b>${esc(v)}</b><small>${k}</small></div>`).join('')}</div>
    <div class="st-cols">
      <div><h4>Totals</h4><table class="st-tot">${tot.map(k => `<tr><td>${STAT_LABELS[k]}</td><td>${t[k] || 0}</td></tr>`).join('')}</table></div>
      <div><h4>Highlights</h4><table class="st-tot">${extra.map(k => `<tr><td>${STAT_LABELS[k]}</td><td>${t[k] || 0}</td></tr>`).join('')}</table></div>
    </div>`;
}

function profileBox(char, mode) {
  const pr = statProfile(char, mode === 'all' ? 'park' : mode);
  const rows = [['Shot volume', pr.tend.shoot], ['Threes (share of shots)', pr.tend.spot], ['Attacks the rim', pr.tend.drive], ['Passing', pr.tend.pass], ['Ball pressure / steals', pr.tend.press], ['Crashes the boards', pr.tend.crash], ['Help / shot blocking', pr.tend.help]];
  return `<div class="st-profile"><h4>Auto-play profile <span class="muted small">${pr.gp ? `${pr.gp} game${pr.gp > 1 ? 's' : ''} · ${Math.round(pr.w * 100)}% from your numbers, the rest from your build` : 'no games yet: plays like your build'}</span></h4>
    <p class="muted small">With auto-play on (H), the AI plays this player from these numbers. It shoots 2s about ${fmtPct(pr.fg2)}, 3s about ${fmtPct(pr.tp)} and free throws about ${fmtPct(pr.ft)}.</p>
    <div class="st-bars">${rows.map(([k, v]) => `<div><span>${k}</span><i><em style="width:${Math.round(v * 100)}%"></em></i><small>${tendLabel(v)}</small></div>`).join('')}</div></div>`;
}

function compare(app, mode, selId) {
  const chars = app.profile?.characters || [];
  return `<table class="st-compare"><thead><tr><th>Build</th><th>OVR</th><th>GP</th><th>PPG</th><th>RPG</th><th>APG</th><th>SPG</th><th>BPG</th><th>FG%</th><th>3P%</th><th>FT%</th></tr></thead><tbody>
    ${chars.map(c => { const L = careerLine(careerSplit(c, mode)); return `<tr class="${c.id === selId ? 'on' : ''}" data-char="${esc(c.id)}"><td><b>${esc(c.name)}</b><small>${esc(c.position)} · ${esc(ARCHETYPES[c.archetype]?.label || c.archetype || '')}</small></td><td>${c.overall}</td><td>${L.gp}</td><td>${f1(L.ppg)}</td><td>${f1(L.rpg)}</td><td>${f1(L.apg)}</td><td>${f1(L.spg)}</td><td>${f1(L.bpg)}</td><td>${fmtPct(L.fg)}</td><td>${fmtPct(L.tp)}</td><td>${fmtPct(L.ft)}</td></tr>`; }).join('')}
    </tbody></table>`;
}

function body(app, mode, selId) {
  const c = (app.profile?.characters || []).find(x => x.id === selId) || app.char();
  if (!c) return '<p class="muted">Create a player first.</p>';
  return `
    <div class="chips st-modes">${MODES.map(([m, l]) => `<button class="chip ${m === mode ? 'on' : ''}" data-mode="${m}">${l}</button>`).join('')}</div>
    <div class="st-head"><b>${esc(c.name)}</b><span class="muted">${esc(c.position)} · ${esc(ARCHETYPES[c.archetype]?.label || '')} · ${c.overall} OVR · ${esc(c.rep?.label || '')}</span></div>
    ${detail(c, mode)}
    ${profileBox(c, mode)}
    <h4>All your builds</h4>${compare(app, mode, c.id)}`;
}

function wire(app, el, state, redraw) {
  $$('[data-mode]', el).forEach(b => b.onclick = () => { state.mode = b.dataset.mode; redraw(); });
  $$('[data-char]', el).forEach(r => r.onclick = () => { state.sel = r.dataset.char; redraw(); });
}

export function render(app, root) {
  const state = { mode: 'all', sel: app.char()?.id };
  const draw = () => {
    root.innerHTML = `<section class="panel wide-panel stats-panel"><div class="eyebrow">LIFETIME STATS</div><h1>Career numbers</h1>${body(app, state.mode, state.sel)}</section>`;
    wire(app, root, state, draw);
  };
  draw();
}

// in-game (pause menus): redraws in place so a modal onClose hook set by the caller survives filter changes
export function openStatsModal(app) {
  const state = { mode: 'all', sel: app.char()?.id };
  const card = modal(`<div class="stats-panel" data-st></div>`, { wide: true, cls: 'stats-card' });
  const host = card.querySelector('[data-st]');
  const draw = () => { host.innerHTML = `<div class="eyebrow">LIFETIME STATS</div><h2>Career numbers</h2>${body(app, state.mode, state.sel)}`; wire(app, host, state, draw); };
  draw();
}
