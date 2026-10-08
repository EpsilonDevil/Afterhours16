// v0.4.3 post-game outro (park and Pro-Am): the full box score for every player, then a Rep XP bar along
// the bottom that fills in real time from your Rep before the game to after it (with rank-ups), before the
// results / run-it-back screen.
import { modal, closeModal, esc, money } from './common.js';
import { audio } from '../core/audio.js';

const COLS = [['PTS', s => s.pts], ['REB', s => s.reb], ['AST', s => s.ast], ['STL', s => s.stl], ['BLK', s => s.blk], ['FG', s => `${s.fgm}/${s.fga}`], ['3PT', s => `${s.tpm}/${s.tpa}`], ['TO', s => s.tov]];
const gameScore = s => s.pts + s.reb * 1.1 + s.ast * 1.4 + (s.stl + s.blk) * 1.8 - s.tov * 1.4 - (s.fga - s.fgm) * 0.7;

// level / progress for a Rep total, from the server's thresholds
export function repAt(points, cfg) {
  const th = cfg.rep_thresholds || [0], tiers = cfg.rep_tiers || ['Rookie', 'Pro', 'All-Star', 'Superstar', 'Legend'];
  let lvl = 0;
  for (let i = 0; i < th.length; i++) if (points >= th[i]) lvl = i;
  const floor = th[lvl], next = th[lvl + 1];
  const label = lvl >= th.length - 1 ? tiers[tiers.length - 1] : `${tiers[Math.floor(lvl / 5)]} ${lvl % 5 + 1}`;
  return { level: lvl, label, floor, next, frac: next ? (points - floor) / (next - floor) : 1 };
}

export function playOutro(app, { summary, session, result, auto = 4.5, practice = false }) {
  return new Promise(resolve => {
    const g = session?.game;
    const teams = session?.teams || [{ name: 'Home' }, { name: 'Away' }];
    const players = summary.players.map(p => ({ ...p, ovr: g?.players[p.id]?.entry?.build?.overall ?? '', pos: g?.players[p.id]?.position || '' }));
    const mvp = players.reduce((a, p) => (!a || gameScore(p.stats) > gameScore(a.stats) ? p : a), null);
    const myTeam = summary.me ? summary.me.team : 0;
    const won = summary.winner === myTeam;
    const pro = summary.mode === 'prorun';
    const table = t => `
      <div class="ob-team ${summary.winner === t ? 'won' : ''}" style="--tc:${esc(teams[t]?.color || '#ffd84a')}">
        <div class="ob-head"><b>${esc(teams[t]?.name || (t ? 'Away' : 'Home'))}</b><span>${summary.score[t]}</span>${summary.winner === t ? '<em>WIN</em>' : ''}</div>
        <table class="ob-table"><thead><tr><th>Player</th>${COLS.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>
        ${players.filter(p => p.team === t).map((p, i) => `<tr class="${p.human ? 'me' : ''}" style="--d:${0.15 + i * 0.07 + t * 0.3}s"><td><span class="ob-ovr">${esc(p.ovr)}</span>${esc(p.name)}${p.human ? ' <em class="ob-you">YOU</em>' : ''}${p === mvp ? ' <em class="ob-mvp" title="Player of the game">★ POG</em>' : ''}<small>${esc(p.pos)}</small></td>${COLS.map(c => `<td>${c[1](p.stats)}</td>`).join('')}</tr>`).join('')}
        </tbody></table>
      </div>`;
    const start = app.char()?.rep || { points: 0 };
    const card = modal(`
      <div class="outro ${won ? 'win' : 'loss'}">
        <div class="eyebrow">${practice ? 'CREW HQ · 5-ON-5' : summary.mode === 'proam' ? 'PRO-AM' : summary.mode === 'prorun' ? 'THE PRO RUN' : 'PARK'} · FINAL · BOX SCORE</div>
        <h1>${won ? 'Victory' : 'Defeat'} <span class="score">${summary.score[myTeam]}–${summary.score[1 - myTeam]}</span></h1>
        <div class="ob-grid">${table(myTeam)}${table(1 - myTeam)}</div>
        ${practice ? '<p class="muted small">Crew run (practice): no VC, Rep or crew XP.</p>' : ''}
        ${pro ? '<p class="ob-pro" data-pro>The Pro Run · VC and badge progress at 1.5x the park rate · saving result…</p>' : ''}
        <div class="ob-rep" ${practice || pro ? 'hidden' : ''}>
          <div class="ob-rep-top"><span class="ob-rep-k">REP</span><b data-rl>${esc(repAt(start.points, app.config).label)}</b><span class="ob-rankup" data-ru hidden>RANK UP!</span><span class="ob-gain" data-rg>Saving result…</span></div>
          <div class="ob-xp"><i data-rb style="width:${(repAt(start.points, app.config).frac * 100).toFixed(1)}%"></i><i class="gain" data-rgain></i></div>
          <div class="ob-rep-bot"><span data-rn>${money(start.points)} REP</span><span data-rnext></span><span class="ob-vc" data-vc></span></div>
        </div>
        <div class="row gap end"><span class="muted small" data-auto></span><button class="btn primary" data-go>Continue</button></div>
      </div>`, { close: false, wide: true, cls: 'outro-card' });
    let finished = false, timer = 0, raf = 0;
    const go = () => {
      if (finished) return; finished = true;
      cancelAnimationFrame(raf); clearInterval(timer); window.removeEventListener('keydown', onKey, true);
      closeModal(); resolve();
    };
    const onKey = e => { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') { e.preventDefault(); go(); } };
    window.addEventListener('keydown', onKey, true);
    card.querySelector('[data-go]').onclick = go;
    card.querySelector('[data-go]').focus?.();
    const $ = s => card.querySelector(s);
    const setBar = (pts, base) => {
      const r = repAt(pts, app.config);
      $('[data-rl]').textContent = r.label;
      const b0 = base != null && base.level === r.level ? repAt(base.points, app.config).frac : 0;
      $('[data-rb]').style.width = `${(b0 * 100).toFixed(2)}%`;
      $('[data-rgain]').style.left = `${(b0 * 100).toFixed(2)}%`;
      $('[data-rgain]').style.width = `${Math.max(0, (r.frac - b0) * 100).toFixed(2)}%`;
      $('[data-rn]').textContent = `${money(Math.round(pts))} REP`;
      $('[data-rnext]').textContent = r.next ? `${money(Math.max(0, r.next - Math.round(pts)))} to ${repAt(r.next, app.config).label}` : 'Max rank';
      return r;
    };
    const countdown = () => {
      let left = auto;
      $('[data-auto]').textContent = `Continuing in ${Math.ceil(left)}…`;
      timer = setInterval(() => { left -= 0.25; if (left <= 0) go(); else if (card.isConnected) $('[data-auto]').textContent = `Continuing in ${Math.ceil(left)}…`; }, 250);
    };
    if (practice) { countdown(); return; }
    if (pro) {
      Promise.resolve(result).then(res => { if (finished || !card.isConnected) return; $('[data-pro]').textContent = res ? `The Pro Run · +${money(res.vc)} VC · badge progress at 1.5x the park rate` : 'Result not recorded'; countdown(); });
      return;
    }
    Promise.resolve(result).then(res => {
      if (finished || !card.isConnected) return;
      if (!res || !res.rep_after) { $('[data-rg]').textContent = 'Result not recorded'; countdown(); return; }
      const before = res.rep_before, after = res.rep_after, gain = after.points - before.points;
      $('[data-rg]').textContent = `+${money(gain)} REP`;
      if (res.vc != null) $('[data-vc]').textContent = `+${money(res.vc)} VC`;
      setBar(before.points, before);
      // fill in real time; a level-up flashes and the bar restarts from the new rank's floor
      const dur = Math.min(3200, 1300 + gain * 6), t0 = performance.now();
      let lastLvl = before.level, gainShown = 0;
      const step = now => {
        if (finished || !card.isConnected) return;
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 2.4);
        const pts = before.points + gain * e;
        const r = setBar(pts, before);
        const shownNow = Math.round(gain * e);
        if (shownNow !== gainShown) { gainShown = shownNow; $('[data-rg]').textContent = `+${money(shownNow)} REP`; }
        if (r.level !== lastLvl) {
          lastLvl = r.level;
          const ru = $('[data-ru]'); ru.hidden = false; ru.classList.remove('pop'); void ru.offsetWidth; ru.classList.add('pop');
          card.querySelector('.ob-rep').classList.add('ranked');
          audio.ui?.('green');
        }
        if (k < 1) raf = requestAnimationFrame(step);
        else { audio.ui?.('buy'); countdown(); }
      };
      raf = requestAnimationFrame(step);
    });
  });
}
