// v0.4.7.5 Report a bug (F8, Settings, the pause menus): a short form that the local server writes to
// Afterhours16_Bug_Reports.txt next to Afterhours16.exe, with where you were, what the game was doing, recent errors
// and game events, and your system and settings attached automatically.
import { $, esc, toast, modal, closeModal } from './common.js';
import { settings } from '../core/settings.js';

const ERRORS = [], EVENTS = [];
const t0 = Date.now();
const stamp = () => { const s = (Date.now() - t0) / 1000; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const push = (list, max, v) => { list.push(v); if (list.length > max) list.shift(); };

// catch errors as they happen (the last 25 go with the next report)
export function installErrorCapture() {
  if (typeof window === 'undefined' || window.__bugCapture) return;
  window.__bugCapture = true;
  window.addEventListener('error', e => push(ERRORS, 25, `[${stamp()}] ${e.message || e.type}${e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno}:${e.colno})` : ''}`));
  window.addEventListener('unhandledrejection', e => push(ERRORS, 25, `[${stamp()}] unhandled: ${e.reason?.message || e.reason}`));
  const ce = console.error.bind(console);
  console.error = (...a) => { try { push(ERRORS, 25, `[${stamp()}] ${a.map(x => x instanceof Error ? `${x.message} @ ${(x.stack || '').split('\n')[1]?.trim() || ''}` : typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 400)}`); } catch { /* ignore */ } ce(...a); };
}
// game events worth knowing about (MatchSession calls this for its events)
const KEEP = new Set(['release', 'score', 'block', 'steal', 'turnover', 'foul', 'ankle', 'slam', 'rebound', 'boxout', 'violation', 'takeover', 'hot', 'cold', 'gameover', 'check', 'oob']);
export function logGameEvent(e, g) {
  if (!KEEP.has(e.type)) return;
  const p = e.player != null && g?.players ? g.players[e.player] : null;
  const bits = [`${(g?.time ?? 0).toFixed(1)}s`, e.type, p ? p.name : '', e.grade || '', e.kind || '', e.made != null ? (e.made ? 'made' : 'missed') : '', e.pts ? `+${e.pts}` : '', g?.score ? `score ${g.score[0]}-${g.score[1]}` : ''];
  push(EVENTS, 40, bits.filter(Boolean).join(' '));
}
export const recentErrors = () => ERRORS.slice();

function gpuName(app) {
  try { const gl = app.renderer.gl, x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'unknown GPU'; } catch { return 'unknown GPU'; }
}
// where you are and what the game is doing, in a line and in detail
export function bugContext(app) {
  const w = app.world, c = app.char?.();
  const sess = w?.mySession || w?.session || w?.practice || null, g = sess?.game;
  let where = { menu: 'Menus', park: 'The Park', match: 'In a game' }[app.mode] || app.mode || 'Menus';
  if (app.mode === 'menu') where = `Menus · ${app.screen || 'home'}`;
  if (w?.themeId) where = `${w.venue?.theme?.name || w.themeId} · ${w.mode || ''}${w.myCourt ? ` · ${w.myCourt.name}` : ''}`;
  if (g) where += ` · ${g.mode} game · score ${g.score?.join('-')} · ${g.phase}${g.time != null ? ` · ${Math.floor(g.time / 60)}:${String(Math.floor(g.time % 60)).padStart(2, '0')} in` : ''}`;
  const me = g?.human;
  const game = g ? {
    mode: g.mode, phase: g.phase, score: g.score, time: +(g.time || 0).toFixed(2), possession: g.possession, half: g.half, target: g.target,
    ball: g.ball ? { mode: g.ball.mode, holder: g.ball.holder, x: +g.ball.x.toFixed(2), y: +g.ball.y.toFixed(2), z: +g.ball.z.toFixed(2) } : null,
    me: me ? { x: +me.x.toFixed(2), z: +me.z.toFixed(2), stance: me.stance, action: me.action ? { type: me.action.type, t: +me.action.t.toFixed(2), style: me.action.style || me.action.move || me.action.kind || null } : null, stamina: +(me.stamina || 0).toFixed(2), hot: me.hot } : null,
    players: g.players?.map(p => `${p.name} (${p.team}) ${p.action?.type || p.stance || ''}`),
  } : null;
  const system = `${navigator.platform || ''} · ${navigator.userAgent.match(/(Chrome|Edg|Firefox|Safari)\/[\d.]+/g)?.join(' ') || 'browser'} · ${gpuName(app)} · ${innerWidth}x${innerHeight} @${devicePixelRatio}x · quality ${settings.quality} · ${app.fps || '?'} fps`;
  return {
    where, system, version: app.config?.version, screen: app.screen, mode: app.mode,
    player: c ? { name: c.name, position: c.position, archetype: c.archetype, height: c.height, overall: c.overall, equipment: c.equipment } : null,
    game, settings: { quality: settings.quality, camera: settings.camera, difficulty: settings.difficulty, shotMeter: settings.shotMeter, greens: settings.greens, prompts: settings.prompts, deadzone: settings.deadzone },
    input: app.input ? { pad: !!app.input.gp?.connected, family: app.input.gp?.family || null, usingPad: !!app.input.usingPad } : null,
    errors: ERRORS.slice(), events: EVENTS.slice(),
  };
}

const CATS = [['gameplay', 'Gameplay'], ['animation', 'Animation / visuals'], ['controls', 'Controls'], ['ai', 'AI teammates / opponents'], ['ui', 'Menus / HUD'], ['audio', 'Audio / music'], ['progress', 'VC / Rep / progression'], ['crash', 'Crash / freeze / error'], ['performance', 'Performance'], ['other', 'Other']];

export function openBugReport(app, opts = {}) {
  if ($('.bug-report')) return;
  const ctx = bugContext(app); // (captured now: what you were doing when you opened it)
  const card = modal(`<div class="bug-report"><div class="eyebrow">REPORT A BUG</div><h2>What went wrong?</h2>
    <p class="muted small">It's saved to <b>Afterhours16_Bug_Reports.txt</b> in your Afterhours16 folder (next to Afterhours16.exe), with where you were and what the game was doing attached. Send that file along to get it fixed.</p>
    <label>Kind of bug<select data-cat>${CATS.map(([k, l]) => `<option value="${k}" ${k === (opts.category || (ctx.errors.length ? 'crash' : 'gameplay')) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>What happened<textarea data-what rows="4" maxlength="4000" placeholder="e.g. My player's arm went through his chest on a step-back jumper on Court 2."></textarea></label>
    <label>What should have happened <small>(optional)</small><textarea data-expected rows="2" maxlength="4000"></textarea></label>
    <label>How to make it happen again <small>(optional)</small><textarea data-steps rows="2" maxlength="4000" placeholder="1. … 2. …"></textarea></label>
    <div class="bug-ctx muted small">Attached: ${esc(ctx.where)}${ctx.errors.length ? ` · ${ctx.errors.length} recent error${ctx.errors.length > 1 ? 's' : ''}` : ''}${ctx.events.length ? ` · last ${ctx.events.length} game events` : ''}</div>
    <div class="row gap end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-send>Save report</button></div></div>`, { cls: 'bug-card' });
  const ta = card.querySelector('[data-what]');
  setTimeout(() => ta?.focus(), 30);
  card.querySelector('[data-send]').onclick = async () => {
    const what = ta.value.trim();
    if (what.length < 3) { toast('Say what happened (a few words is fine).', 'error'); ta.focus(); return; }
    const btn = card.querySelector('[data-send]'); btn.disabled = true;
    try {
      const r = await app.api.mutate('/api/bug-report', { category: card.querySelector('[data-cat]').value, what, expected: card.querySelector('[data-expected]').value, steps: card.querySelector('[data-steps]').value, context: ctx });
      closeModal();
      toast(`Bug report #${r.number} saved to ${r.file} in your Afterhours16 folder. Thanks!`);
      opts.onDone?.();
    } catch (e) { btn.disabled = false; toast(`Couldn't save the report: ${e.message}`, 'error'); }
  };
}

// F8 / the menus: a live game holds while you write it up
export function reportBug(app, opts = {}) {
  const w = app.world, s = w?.mySession || (app.mode === 'match' ? w?.session : null);
  if (s && !s.paused && !s.ended) { s.paused = true; closeModal.onClose = () => { s.paused = false; }; }
  openBugReport(app, opts);
}
