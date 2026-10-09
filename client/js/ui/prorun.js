// v0.4.5 The Pro Run: a career in the Afterhours Pro League. Pick a college, play three games, get drafted by
// whoever holds the slot your play earned, then an 82-game season, the play-in, four playoff rounds and the
// Finals. Play your games in the arena or sim them; every other game is simulated (sim/league.js). Played games
// go through a server ticket like Pro-Am: VC and badge progress pay 1.5x the park rate, and there's no music.
import { $, $$, esc, money, toast, modal, closeModal, confirmBox, busy } from './common.js';
import * as L from '../sim/league.js';
import { Scene } from '../gfx/renderer.js';
import { buildVenue } from '../world/venues.js';
import { MatchSession } from '../game/session.js';
import { resolveLook } from '../sim/bots.js';
import { boostedBuild } from '../sim/ratings.js';
import { GRADES } from '../game/grade.js';
import { audio } from '../core/audio.js';
import { music } from '../core/music.js';
import { playOutro } from './outro.js';
import * as Rewards from './rewards.js';
import * as Screens from './screens.js';
import { leaveWorld, showResults, pauseMatch } from './modes.js';
import { badgeTiers } from '../game/park.js';
import { maxOvr, OVR_CAP, PRORUN_GAMES_PER_OVR } from '../sim/builds.js';

// ---------- load / save ----------
let saving = Promise.resolve();
export async function loadCareer(app) {
  const c = app.char();
  if (!c) return null;
  if (app.prorun?.charId === c.id) return app.prorun.career;
  const r = await app.api.get(`/api/prorun?character_id=${encodeURIComponent(c.id)}`);
  app.prorun = { charId: c.id, career: r.career };
  return r.career;
}
export function saveCareer(app, career) {
  const cid = app.char()?.id;
  app.prorun = { charId: cid, career };
  const snap = career ? JSON.parse(JSON.stringify(career)) : null;
  saving = saving.then(() => app.api.mutate('/api/prorun', { character_id: cid, career: snap })).catch(e => toast('Pro Run not saved: ' + e.message, 'error'));
  return saving;
}
// your current overall, position and name ride along with the career (they change as you upgrade)
function syncMe(app, career) { const c = app.char(); if (c && career) career.me = { name: c.name, pos: c.position, ovr: c.overall }; }

// ---------- little view helpers ----------
const team = t => L.TEAMS[t];
const chip = (t, full = true) => { const x = team(t); return `<span class="pr-team" style="--c1:${x.c1};--c2:${x.c2}"><i>${esc(x.abbr)}</i>${full ? esc(x.full) : esc(x.name)}</span>`; };
const colChip = (id, full = true) => { const x = L.collegeOf(id); return `<span class="pr-team" style="--c1:${x.c1};--c2:${x.c2}"><i>${esc(x.abbr)}</i>${full ? esc(x.full) : esc(x.name)}</span>`; };
const f1 = v => (v == null || Number.isNaN(v) ? '—' : v.toFixed(1));
const pctS = v => (v == null ? '—' : v.toFixed(3).replace(/^0/, ''));
const rec = r => `${r.w}-${r.l}`;
const pname = (career, id) => (id === 'me' ? career.me.name : L.playerById(career, id)?.n || id);

function settingsForm(st, locked = {}) {
  const sel = (k, opts, cur) => `<select data-set="${k}" ${locked[k] ? 'disabled' : ''}>${opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="pr-settings">
    <label>Quarter length (games you play)${sel('quarterLen', L.QUARTERS, st.quarterLen)}</label>
    <label>Difficulty${sel('difficulty', L.DIFFS, st.difficulty)}</label>
    <label>Your minutes when simmed${sel('minutes', [['auto', 'Auto (by rotation)'], ['starter', 'Starter (34)'], ['sixth', 'Sixth man (26)'], ['bench', 'Bench (16)']], st.minutes)}</label>
    <label>Playoff series${sel('playoffs', [['7777', 'Best of 7, every round'], ['5777', '5-7-7-7'], ['3577', '3-5-7-7'], ['1111', 'Single games']], st.playoffs)}</label>
    <label>Play-in tournament${sel('playIn', [['true', 'On (seeds 7-10)'], ['false', 'Off (top 8)']], st.playIn)}</label>
    <label>Upsets${sel('upsets', [['fewer', 'Fewer'], ['normal', 'Normal'], ['more', 'More']], st.upsets)}</label>
    <label>Home-court advantage${sel('homeCourt', [['true', 'On'], ['false', 'Off']], st.homeCourt)}</label>
  </div>`;
}
function bindSettings(root, st, onChange) {
  $$('[data-set]', root).forEach(el => el.onchange = () => {
    const k = el.dataset.set; let v = el.value;
    if (k === 'quarterLen' || k === 'difficulty') v = +v;
    if (k === 'playIn' || k === 'homeCourt') v = v === 'true';
    st[k] = v; onChange?.();
  });
}

// ---------- the screen ----------
export async function render(app, root, params = {}) {
  root.innerHTML = '<section class="panel wide-panel pr"><div class="eyebrow">THE PRO RUN</div><h1>Loading…</h1></section>';
  let career;
  try { career = await loadCareer(app); } catch (e) { root.innerHTML = `<section class="panel wide-panel pr"><h1>The Pro Run</h1><p class="muted">${esc(e.message)}</p></section>`; return; }
  if (!document.body.contains(root)) return;
  syncMe(app, career);
  const state = { tab: params.tab || 'overview' };
  const draw = () => {
    if (!career) drawNew(app, root, c => { career = c; draw(); });
    else if (career.phase === 'college') drawCollege(app, root, career, draw);
    else if (career.phase === 'draft') drawDraft(app, root, career, draw);
    else drawSeason(app, root, career, state, draw);
    maxOvrStrip(app, root);
  };
  draw();
}

// v0.4.7.5: games played here raise your max OVR (+1 every 3, from 80 up to 90)
function maxOvrStrip(app, root) {
  const c = app.char(); if (!c) return;
  const max = maxOvr(c), left = c.prorun_to_next ?? 0, per = PRORUN_GAMES_PER_OVR;
  const el = root.querySelector('.pr > .eyebrow'); if (!el || root.querySelector('.pr-maxovr')) return;
  // (v0.4.7.5 quick patch: with the Icon badge, the Icon Legend climb: +1 OVR every 2 games played here, to 99)
  const L = c.legend_info;
  const chip = L?.active && max >= OVR_CAP
    ? `<div class="pr-maxovr legend"><b>ICON LEGEND ${c.overall}</b>${L.maxed ? `<span>fully grinded · ${L.cap} OVR</span>` : `<span>${L.to_next} game${L.to_next === 1 ? '' : 's'} played here to +1 OVR</span>${Array.from({ length: L.per }, (_, k) => `<i class="${k < L.per - L.to_next ? 'on' : ''}"></i>`).join('')}`}</div>`
    : `<div class="pr-maxovr"><b>MAX OVR ${max}</b>${max >= OVR_CAP ? '<span>fully unlocked · cap breakers open</span>' : `<span>${left} game${left === 1 ? '' : 's'} played here to +1</span>${[0, 1, 2].map(k => `<i class="${k < per - left ? 'on' : ''}"></i>`).join('')}`}</div>`;
  el.insertAdjacentHTML('afterend', chip);
}

function drawNew(app, root, done) {
  const st = { ...L.DEFAULT_SETTINGS };
  let pick = L.COLLEGES[0].id;
  root.innerHTML = `<section class="panel wide-panel pr">
    <div class="eyebrow">THE PRO RUN · ${esc(L.LEAGUE.name.toUpperCase())}</div><h1>Make it to the league</h1>
    <p class="muted">Pick a college and play three games. How you play — your line, your wins and your Locked-In grade — sets your draft slot, and the team holding it takes you. Then it's an 82-game season against 31 other teams, a play-in, four playoff rounds and the Finals. Play your games in the arena or sim them. Games you play pay VC and badge progress at <b>1.5x</b> the park rate. No music, like Pro-Am.</p>
    <h4>Pick your college</h4>
    <div class="pr-colleges">${L.COLLEGES.map(x => `<button class="pr-col ${x.id === pick ? 'on' : ''}" data-col="${x.id}" style="--c1:${x.c1};--c2:${x.c2}"><i>${esc(x.abbr)}</i><b>${esc(x.school)}</b><small>${esc(x.name)}</small></button>`).join('')}</div>
    <h4>Sim settings <span class="muted small">(you can change them any time)</span></h4>
    ${settingsForm(st)}
    <div class="row gap end"><button class="btn primary big" data-start>Start the Pro Run</button></div></section>`;
  $$('[data-col]', root).forEach(b => b.onclick = () => { pick = b.dataset.col; $$('[data-col]', root).forEach(x => x.classList.toggle('on', x === b)); });
  bindSettings(root, st);
  $('[data-start]', root).onclick = async ev => {
    busy(ev.target, true);
    const c = app.char();
    const career = L.newCareer({ seed: (Math.random() * 2147483646 | 0) + 1, college: pick, settings: st, me: c });
    await saveCareer(app, career);
    toast(`Welcome to ${L.collegeOf(pick).full}. Three games to make your case.`);
    done(career);
  };
}

function drawCollege(app, root, career, redraw) {
  const col = L.collegeOf(career.college.team), games = career.college.games;
  const n = games.filter(g => g.result).length, stock = L.draftStock(games), [lo, hi] = L.projectedRange(stock);
  const line = s => `${s.pts} PTS · ${s.reb} REB · ${s.ast} AST · ${s.fgm}/${s.fga} FG`;
  root.innerHTML = `<section class="panel wide-panel pr">
    <div class="eyebrow">THE PRO RUN · COLLEGE · GAME ${Math.min(3, n + 1)} OF 3</div>
    <div class="pr-head" style="--c1:${col.c1};--c2:${col.c2}"><i>${esc(col.abbr)}</i><div><h1>${esc(col.full)}</h1><small>${esc(career.me.name)} · ${esc(career.me.pos)} · ${career.me.ovr} OVR</small></div>
      <div class="pr-stock"><small>DRAFT STOCK</small><b>${n ? `#${lo}–${hi}` : '—'}</b><span class="muted small">${n ? `projected pick · stock ${f1(stock)}` : 'play your first game'}</span></div></div>
    <div class="pr-cgames">${games.map((g, i) => `<div class="pr-cgame ${g.result ? (g.result.won ? 'w' : 'l') : i === n ? 'next' : ''}">
      <small>GAME ${i + 1} · ${g.home ? 'HOME' : 'AWAY'}</small>${colChip(g.opp)}
      ${g.result ? `<b>${g.result.won ? 'W' : 'L'} ${g.result.score[0]}–${g.result.score[1]}</b><span class="muted small">${line(g.result.stats)}${g.result.grade != null ? ` · ${GRADES[g.result.grade]}` : ''}</span>` : i === n ? '<b>Next up</b>' : '<span class="muted small">Upcoming</span>'}</div>`).join('')}</div>
    <p class="muted small">Scouts watch your line (scaled to a full game), your wins and your Locked-In grade. Stock 32 or better goes first overall; every point below that is about two picks later, down to #64.</p>
    <div class="row gap end"><button class="btn ghost" data-simset>Sim settings</button><button class="btn ghost" data-restart>Start over</button><button class="btn primary big" data-play>Play game ${n + 1}</button></div></section>`;
  $('[data-play]', root).onclick = () => playCollegeGame(app, career, n);
  $('[data-simset]', root).onclick = () => openSettings(app, career, redraw);
  $('[data-restart]', root).onclick = () => restart(app);
}

function drawDraft(app, root, career, redraw) {
  const d = career.draft, me = d.board.find(b => b.id === 'me'), t = team(d.team);
  const row = b => { const p = b.id === 'me' ? null : L.playerById(career, b.id); return `<div class="pr-pick ${b.id === 'me' ? 'me' : ''}"><b>${b.pick}</b>${chip(b.t, false)}<span>${b.id === 'me' ? `<b>${esc(career.me.name)}</b> · ${esc(career.me.pos)} · ${esc(L.collegeOf(career.college.team).school)}` : `${esc(p.n)} · ${esc(p.p)} · ${p.o} OVR`}</span></div>`; };
  root.innerHTML = `<section class="panel wide-panel pr">
    <div class="eyebrow">THE PRO RUN · DRAFT NIGHT</div>
    <div class="pr-head" style="--c1:${t.c1};--c2:${t.c2}"><i>${esc(t.abbr)}</i><div><h1>Pick #${me.pick}: the ${esc(t.full)}</h1><small>Round ${d.round} · draft stock ${f1(d.stock)} · you join a 15-man roster</small></div></div>
    <div class="pr-draft"><div><div class="ph-sec">Round 1</div>${d.board.slice(0, 32).map(row).join('')}</div><div><div class="ph-sec">Round 2</div>${d.board.slice(32).map(row).join('')}</div></div>
    <div class="row gap end"><button class="btn primary big" data-rookie>Start your rookie season</button></div></section>`;
  root.querySelector('.pr-pick.me')?.scrollIntoView({ block: 'center' });
  $('[data-rookie]', root).onclick = async () => { L.startSeason(career); await saveCareer(app, career); redraw(); };
}

const TABS = [['overview', 'Overview'], ['schedule', 'Schedule'], ['standings', 'Standings'], ['roster', 'Roster'], ['leaders', 'Leaders'], ['settings', 'Sim settings']];
function drawSeason(app, root, career, state, redraw) {
  syncMe(app, career);
  const t = team(career.myTeam), st = L.standings(career), conf = t.conf, mine = st[conf].find(r => r.t === career.myTeam);
  const me = L.perGame(career.phase === 'playoffs' && career.pstats.me ? career.pstats : career.stats, 'me');
  const phaseLabel = career.phase === 'season' ? `REGULAR SEASON · YEAR ${career.year}` : career.phase === 'playoffs' ? `PLAYOFFS · ${L.ROUND_NAMES[career.po.round].toUpperCase()}` : `SEASON ${career.year} · OVER`;
  root.innerHTML = `<section class="panel wide-panel pr">
    <div class="eyebrow">THE PRO RUN · ${esc(L.LEAGUE.abbr)} · ${phaseLabel}</div>
    <div class="pr-head" style="--c1:${t.c1};--c2:${t.c2}"><i>${esc(t.abbr)}</i><div><h1>${esc(t.full)}</h1><small>${esc(career.me.name)} · ${esc(career.me.pos)} · ${career.me.ovr} OVR · ${rec(mine)} · ${mine.seed}${['st', 'nd', 'rd'][mine.seed - 1] || 'th'} in the ${conf}</small></div>
      <div class="pr-mine">${[['PPG', me?.ppg], ['RPG', me?.rpg], ['APG', me?.apg], ['MPG', me?.mpg]].map(([k, v]) => `<div><b>${f1(v)}</b><small>${k}</small></div>`).join('')}</div></div>
    <nav class="tabs-inner pr-tabs">${TABS.map(([k, l]) => `<button class="${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <div class="pr-body">${state.tab === 'schedule' ? tabSchedule(career) : state.tab === 'standings' ? tabStandings(career, st) : state.tab === 'roster' ? tabRoster(career) : state.tab === 'leaders' ? tabLeaders(career) : state.tab === 'settings' ? `${settingsForm(career.settings, { playoffs: !!career.po })}<p class="muted small">Quarter length and difficulty apply to games you play. The rest shapes simulated games.</p><div class="row gap end"><button class="btn ghost" data-restart>Start over (new career)</button></div>` : tabOverview(career, st)}</div></section>`;
  $$('[data-tab]', root).forEach(b => b.onclick = () => { state.tab = b.dataset.tab; redraw(); });
  bindSettings(root, career.settings, () => saveCareer(app, career));
  const on = (sel, f) => { const b = $(sel, root); if (b) b.onclick = ev => { busy(ev.target, true); setTimeout(() => f(ev), 20); }; };
  on('[data-play]', () => playLeagueGame(app, career));
  on('[data-sim]', async () => { simMyNext(career); await saveCareer(app, career); redraw(); });
  on('[data-simweek]', async () => { L.simThrough(career, L.currentDay(career) + 6); await saveCareer(app, career); redraw(); });
  on('[data-simall]', async () => { if (!(await confirmBox('Sim the rest of the regular season, your games included?', 'Sim to the end'))) return redraw(); L.simThrough(career, 1e9); await saveCareer(app, career); redraw(); });
  on('[data-playoffs]', async () => { L.startPlayoffs(career); await saveCareer(app, career); toast(career.settings.playIn ? 'The play-in is on: seeds 7 to 10 fight for the last two spots.' : 'The playoffs are set.'); redraw(); });
  on('[data-poday]', async () => { L.simPlayoffDay(career, true); await saveCareer(app, career); redraw(); });
  on('[data-poall]', async () => { let g = 0; while (career.po.champ == null && g++ < 400) L.simPlayoffDay(career, true); await saveCareer(app, career); redraw(); });
  on('[data-next]', async () => { L.nextSeason(career); await saveCareer(app, career); toast(`Season ${career.year} is on.`); redraw(); });
  const rs = $('[data-restart]', root); if (rs) rs.onclick = () => restart(app);
}

// sim your next game (and everything before it)
function simMyNext(career) {
  if (career.phase === 'season') {
    const gi = L.nextMyGame(career);
    if (gi < 0) return;
    L.simBefore(career, gi);
    L.simGame(career, gi);
  } else if (career.phase === 'playoffs') {
    const gi = L.prepareMyPlayoffGame(career);
    if (gi < 0) return;
    L.simGame(career, gi, career.pstats, career.po.games, career.po.res);
    L.afterPlayoffGame(career, gi);
  }
}

function nextCard(career) {
  let gi, games, label;
  if (career.phase === 'season') { gi = L.nextMyGame(career); games = career.sched; label = gi >= 0 ? `Game ${L.myGames(career).indexOf(gi) + 1} of 82 · day ${games[gi][0] + 1}` : ''; }
  else { const s = L.mySeries(career); if (!s) return ''; gi = s.games.find(g => !career.po.res[g]); games = career.po.games; label = `${L.ROUND_NAMES[s.round]} · game ${s.games.filter(g => career.po.res[g]).length + 1}${s.bestOf > 1 ? ` · series ${s.hi === career.myTeam ? s.w[0] : s.w[1]}-${s.hi === career.myTeam ? s.w[1] : s.w[0]}` : ''}`; }
  let opp, home;
  if (gi != null && gi >= 0) { const [, h, a] = games[gi]; home = h === career.myTeam; opp = home ? a : h; }
  else { const s = L.mySeries(career); opp = s.hi === career.myTeam ? s.lo : s.hi; home = null; }
  const r = L.records(career)[opp];
  return `<div class="pr-next"><small>NEXT GAME · ${esc(label)}</small><div>${home === false ? '@ ' : home ? 'vs ' : ''}${chip(opp)} <span class="muted small">${rec(r)} · ${f1(L.teamRating(career, opp))} team rating</span></div>
    <div class="row gap"><button class="btn primary" data-play>Play game</button><button class="btn" data-sim>Sim game</button></div></div>`;
}

function tabOverview(career, st) {
  const log = career.log.slice(-6).reverse();
  const recent = log.length ? `<table class="pr-table"><tbody>${log.map(g => `<tr><td>${g.po ? 'PO' : ''}</td><td>${g.home ? 'vs' : '@'} ${chip(g.opp, false)}</td><td class="${g.w ? 'w' : 'l'}">${g.w ? 'W' : 'L'} ${g.us}-${g.them}</td><td class="muted small">${g.played ? 'played' : 'simmed'}</td><td>${g.line ? `${g.line[2]} pts · ${g.line[3]} reb · ${g.line[4]} ast` : 'DNP'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No games yet.</p>';
  let main = '';
  if (career.phase === 'season') {
    main = L.nextMyGame(career) >= 0
      ? `${nextCard(career)}<div class="row gap"><button class="btn ghost small" data-simweek>Sim a week</button><button class="btn ghost small" data-simall>Sim to the end of the regular season</button></div>`
      : L.seasonDone(career) ? `<div class="pr-next"><small>REGULAR SEASON OVER</small><div>${chip(career.myTeam)} finished ${rec(st[team(career.myTeam).conf].find(r => r.t === career.myTeam))}</div><div class="row gap"><button class="btn primary" data-playoffs>Start the playoffs</button></div></div>`
        : `<div class="pr-next"><small>YOUR REGULAR SEASON IS DONE</small><div class="muted">The rest of the league is still playing.</div><div class="row gap"><button class="btn primary" data-simall>Sim to the end of the regular season</button></div></div>`;
  } else if (career.phase === 'playoffs') {
    const ps = L.myPlayoffStatus(career);
    main = `${ps?.alive && L.mySeries(career) ? nextCard(career) : `<div class="pr-next"><small>PLAYOFFS</small><div>${esc(ps?.text || (ps?.alive ? `Through to the next round — waiting for the other series` : ''))}</div><div class="row gap"><button class="btn" data-poday>Sim a day</button><button class="btn primary" data-poall>Sim to the end of the playoffs</button></div></div>`}${bracket(career)}`;
  } else if (career.phase === 'offseason') {
    const a = career.awards || {}, ps = L.myPlayoffStatus(career);
    const aw = [['League champion', a.champ != null ? chip(a.champ) : '—'], ['Most Valuable Player', a.mvp], ['Finals MVP', a.fmvp], ['Rookie of the Year', a.roy], ['Defensive Player of the Year', a.dpoy], ['Scoring title', a.scoring]];
    main = `<div class="pr-next champ"><small>SEASON ${career.year} · THE FINALS</small><div>${a.champ != null ? `${chip(a.champ)} are the champions` : ''}</div><div class="muted">${esc(ps?.text || '')}</div></div>
      <table class="pr-table"><tbody>${aw.map(([k, v]) => `<tr><td>${k}</td><td>${v == null ? '—' : typeof v === 'string' && !v.startsWith('<') ? `<b class="${v === 'me' ? 'me' : ''}">${esc(pname(career, v))}</b> ${chip(L.playerById(career, v)?.t ?? career.myTeam, false)}` : v}</td></tr>`).join('')}</tbody></table>
      <div class="row gap end"><button class="btn primary big" data-next>Start season ${career.year + 1}</button></div>`;
  }
  const top = st[team(career.myTeam).conf].slice(0, 10);
  return `<div class="pr-cols"><div>${main}<h4>Recent games</h4>${recent}</div>
    <div><h4>${esc(team(career.myTeam).conf)} standings</h4><table class="pr-table"><tbody>${top.map(r => `<tr class="${r.t === career.myTeam ? 'me' : ''}"><td>${r.seed}</td><td>${chip(r.t, false)}</td><td>${rec(r)}</td><td class="muted">${r.gb ? f1(r.gb) : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function bracket(career) {
  const po = career.po; if (!po) return '';
  const rows = po.series.map(s => {
    const hiW = s.w[0], loW = s.w[1];
    return `<div class="pr-series ${s.hi === career.myTeam || s.lo === career.myTeam ? 'me' : ''} ${s.winner != null ? 'done' : ''}"><small>${s.conf === 'Finals' ? 'The Finals' : `${s.conf} · ${L.ROUND_NAMES[s.round]}${s.tag ? ` ${s.tag === 'A' ? '7v8' : s.tag === 'B' ? '9v10' : 'for the 8 seed'}` : ''}`}</small>
      <div class="${s.winner === s.hi ? 'won' : ''}">${chip(s.hi, false)}<b>${hiW}</b></div><div class="${s.winner === s.lo ? 'won' : ''}">${chip(s.lo, false)}<b>${loW}</b></div></div>`;
  });
  return `<h4>Bracket</h4><div class="pr-bracket">${rows.join('')}</div>`;
}

function tabSchedule(career) {
  const games = L.myGames(career), byGi = new Map(career.log.filter(g => !g.po).map(g => [g.gi, g]));
  return `<table class="pr-table sched"><thead><tr><th>#</th><th>Day</th><th>Opponent</th><th>Result</th><th></th><th>Your line</th></tr></thead><tbody>${games.map((gi, i) => {
    const [day, h, a] = career.sched[gi], home = h === career.myTeam, r = career.res[gi], g = byGi.get(gi);
    const us = r ? (home ? r[0] : r[1]) : null, them = r ? (home ? r[1] : r[0]) : null;
    return `<tr><td>${i + 1}</td><td class="muted">${day + 1}</td><td>${home ? 'vs' : '@'} ${chip(home ? a : h, false)}</td><td class="${r ? (us > them ? 'w' : 'l') : ''}">${r ? `${us > them ? 'W' : 'L'} ${us}-${them}` : '—'}</td><td class="muted small">${r ? (r[2] ? 'played' : 'simmed') : ''}</td><td>${g?.line ? `${g.line[2]} / ${g.line[3]} / ${g.line[4]}` : r ? 'DNP' : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function tabStandings(career, st) {
  const cut = career.settings.playIn ? [6, 10] : [8, 8];
  return `<div class="pr-cols stand">${L.CONFS.map(cf => `<div><h4>${cf}</h4><table class="pr-table"><thead><tr><th></th><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>CONF</th><th>L10</th><th>STRK</th></tr></thead><tbody>
    ${st[cf].map(r => `<tr class="${r.t === career.myTeam ? 'me' : ''} ${r.seed === cut[0] ? 'cut' : ''} ${r.seed === cut[1] && cut[1] !== cut[0] ? 'cut2' : ''}"><td>${r.seed}</td><td>${chip(r.t, false)}</td><td>${r.w}</td><td>${r.l}</td><td>${pctS(r.pct)}</td><td>${r.gb ? f1(r.gb) : '—'}</td><td>${r.cw}-${r.cl}</td><td>${r.l10}-${Math.min(10, r.w + r.l) - r.l10}</td><td>${r.streak}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>
    <p class="muted small">${career.settings.playIn ? 'Seeds 1-6 go straight to the playoffs; 7-10 play in for the last two spots.' : 'The top 8 in each conference make the playoffs.'}</p>`;
}

function tabRoster(career) {
  const rot = L.rotation(career, career.myTeam);
  return `<table class="pr-table"><thead><tr><th>Player</th><th>POS</th><th>OVR</th><th>Age</th><th>Sim MIN</th><th>GP</th><th>PPG</th><th>RPG</th><th>APG</th><th>FG%</th></tr></thead><tbody>
    ${rot.map(({ p, min }) => { const s = L.perGame(career.stats, p.id); return `<tr class="${p.me ? 'me' : ''}"><td><b>${esc(p.me ? career.me.name : p.n)}</b>${p.rookie ? ' <em class="tag sq">R</em>' : ''}</td><td>${esc(p.p)}</td><td>${p.o}</td><td>${p.age || (p.me ? '—' : '')}</td><td>${Math.round(min)}</td><td>${s?.gp || 0}</td><td>${f1(s?.ppg)}</td><td>${f1(s?.rpg)}</td><td>${f1(s?.apg)}</td><td>${s ? (s.fgp * 100).toFixed(1) : '—'}</td></tr>`; }).join('')}</tbody></table>
    <p class="muted small">In games you play, you start with the best player at each other position. In simulated games the rotation goes by overall (see Sim settings for your minutes).</p>`;
}

function tabLeaders(career) {
  const book = career.phase === 'playoffs' && Object.keys(career.pstats || {}).length ? career.pstats : career.stats;
  const cats = [['ppg', 'Points'], ['rpg', 'Rebounds'], ['apg', 'Assists'], ['spg', 'Steals'], ['bpg', 'Blocks']];
  return `<div class="pr-leaders">${cats.map(([k, l]) => `<div><h4>${l}</h4><table class="pr-table"><tbody>${L.leaders(career, k, 10, book).map((x, i) => `<tr class="${x.id === 'me' ? 'me' : ''}"><td>${i + 1}</td><td>${esc(pname(career, x.id))}</td><td>${chip(L.playerById(career, x.id)?.t ?? 0, false)}</td><td><b>${f1(x.s[k])}</b></td></tr>`).join('')}</tbody></table></div>`).join('')}</div>
    <p class="muted small">${book === career.pstats ? 'Playoff' : 'Regular-season'} per-game averages (at least half of the games played).</p>`;
}

function openSettings(app, career, redraw) {
  const card = modal(`<h2>Sim settings</h2>${settingsForm(career.settings, { playoffs: !!career.po })}<div class="row gap end"><button class="btn primary" data-close>Done</button></div>`, { wide: true });
  bindSettings(card, career.settings, () => saveCareer(app, career));
  closeModal.onClose = () => redraw?.();
}

async function restart(app) {
  if (!(await confirmBox('Start over? Your Pro Run career (college, draft and seasons) will be gone. Your player, VC and badges stay.', 'Start over'))) return;
  await saveCareer(app, null);
  Screens.go(app, 'prorun');
}

// ---------- playing a game ----------
const WOOD = [0.82, 0.6, 0.38];
const uniform = (color, trim, abbr) => ({ top: { family: 'jersey', color, trim, secondary: trim, pattern: 'panel', lettering: abbr, tucked: true }, bottom: { family: 'shorts', color, trim, stripe: trim } });

function playCollegeGame(app, career, n) {
  const g = career.college.games[n];
  const mine = L.collegeOf(career.college.team), opp = L.collegeOf(g.opp);
  const mates = L.collegeRoster(career, mine.id, 4, career.me.pos), them = L.collegeRoster(career, opp.id, 5);
  startGame(app, career, {
    kind: 'college', label: 'COLLEGE', home: g.home, my: mine, opp, mates, them,
    record: (summary, ids) => {
      const won = summary.winner === summary.me.team;
      g.result = { won, score: [summary.score[0], summary.score[1]], stats: summary.me.stats, grade: app.lastGradeIdx ?? null, quarterLen: summary.quarterLen };
      if (n === 2) {
        const pick = L.pickForStock(L.draftStock(career.college.games));
        L.runDraft(career, pick);
      }
    },
  });
}

function playLeagueGame(app, career) {
  let gi, playoffs = career.phase === 'playoffs';
  if (playoffs) gi = L.prepareMyPlayoffGame(career);
  else { gi = L.nextMyGame(career); if (gi >= 0) L.simBefore(career, gi); }
  if (gi < 0) { toast('No game to play right now.', 'error'); return; }
  saveCareer(app, career); // the games before yours are in the books even if you quit this one
  const [, h, a] = (playoffs ? career.po.games : career.sched)[gi];
  const home = h === career.myTeam, oppT = home ? a : h;
  const mine = L.startingFive(career, career.myTeam, true), them = L.startingFive(career, oppT, false);
  startGame(app, career, {
    kind: playoffs ? 'playoffs' : 'season', label: L.LEAGUE.abbr, home, my: team(career.myTeam), opp: team(oppT),
    mates: mine.filter(p => !p.me), them,
    record: (summary, ids) => {
      L.recordPlayed(career, gi, summary, ids, playoffs);
      if (playoffs) L.afterPlayoffGame(career, gi);
    },
  });
}

async function startGame(app, career, spec) {
  const c = app.char();
  let ticket;
  try { ticket = await app.api.mutate('/api/matches', { character_id: c.id, mode: 'prorun', venue: 'arena', format: 5, quarter_len: career.settings.quarterLen, difficulty: career.settings.difficulty }); }
  catch (e) { toast(e.message, 'error'); Screens.go(app, 'prorun'); return; }
  leaveWorld(app);
  $('#ui').innerHTML = ''; $('#ui').className = 'layer';
  const host = spec.home ? spec.my : spec.opp;
  const scene = new Scene();
  const venue = buildVenue(app.renderer, scene, 'arena', { team: { name: host.full, abbr: host.abbr, primary: host.c1, secondary: host.c2, logo: host.logo, wood: WOOD }, label: spec.label });
  // home team in white with their color trim, the visitors in their color
  const homeU = t => uniform('#f4f2ec', t.c1, t.abbr), awayU = t => uniform(t.c1, t.c2, t.abbr);
  const myU = spec.home ? homeU(spec.my) : awayU(spec.my), opU = spec.home ? awayU(spec.opp) : homeU(spec.opp);
  const meE = { build: boostedBuild(c, ticket.meta.boosts), name: c.name, human: true, badges: badgeTiers(c) };
  Rewards.consumeBoostsLocal(app, ticket);
  const mine = [meE, ...spec.mates.map(p => ({ ...L.playerEntry(p, app.catalog), human: false }))];
  const them = spec.them.map(p => ({ ...L.playerEntry(p, app.catalog), human: false }));
  mine.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, app.catalog, { ...myU, number: e.build.appearance?.number ?? (i * 7 + 3) % 50, name: e.name }); });
  them.forEach((e, i) => { e.look = resolveLook({ ...e.build, name: e.name }, app.catalog, { ...opU, number: e.build.appearance?.number ?? (i * 9 + 11) % 50, name: e.name }); });
  const ids = ['me', ...spec.mates.map(p => p.id), ...spec.them.map(p => p.id)];
  const teams = [{ name: spec.my.full, abbr: spec.my.abbr, color: spec.home ? '#f4f2ec' : spec.my.c1 }, { name: spec.opp.full, abbr: spec.opp.abbr, color: spec.home ? spec.opp.c1 : '#f4f2ec' }];
  if (teams[0].color === teams[1].color) teams[1].color = spec.opp.c2;
  const session = new MatchSession(app, {
    mode: 'proam', scene, venue, court: venue.courts[0], rosters: [mine, them], teams, seed: ticket.seed, quarterLen: ticket.meta.quarter_len, quarters: 4, difficulty: ticket.meta.difficulty, jumboTitle: spec.kind === 'college' ? 'COLLEGE' : L.LEAGUE.abbr,
    onEnd: async (summary, sess) => {
      const sub = { ...summary, mode: 'prorun' };
      const grade = app.lastGrade;
      app.lastGradeIdx = grade ? GRADES.indexOf(grade.letter) : null;
      const saving = app.api.mutate(`/api/matches/${ticket.id}/complete`, { summary: sub }).catch(e => { toast('Result not saved: ' + e.message, 'error'); return null; });
      await playOutro(app, { summary: sub, session: sess, result: saving });
      const result = await saving;
      if (result) { app.replaceChar(result.character); app.setBalance(result.balance); }
      // the result goes into the career either way (the season can't stall on a failed reward)
      syncMe(app, career);
      spec.record({ ...summary, quarterLen: ticket.meta.quarter_len }, ids);
      await saveCareer(app, career);
      const won = summary.winner === summary.me.team;
      showResults(app, sub, result, won, { grade, menuLabel: 'Back to the Pro Run', menu: () => Screens.go(app, 'prorun') });
    },
  });
  const world = {
    session, scene, ticket, backTo: 'prorun',
    frame: dt => { if (app.input.wasPressed('pause') && !session.paused && !session.ended && !app.modalOpen()) pauseMatch(app, world); session.frame(dt); },
    onFocusLost: () => { if (!session.paused && !session.ended && !app.modalOpen()) pauseMatch(app, world); },
    dispose: () => session.dispose(),
  };
  app.world = world;
  app.mode = 'match';
  app.renderer.prewarm(scene);
  music.setSuppressed(true); // like Pro-Am: no music in the Pro Run's games
  audio.surface = 'wood';
  app.setController(world, scene);
}
