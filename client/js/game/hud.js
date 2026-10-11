// In-game DOM HUD: score bug, shot meter, release feedback, player tags, feed, big callouts.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { badgeSVG, iconBadgeSVG } from '../ui/badgeart.js';

// badge activation banner timing (ms up, then the fade) and the Icon badge's version of it: ICON_POP_K times as long
// (2x), the window 20% bigger (CSS .badge-pop.icon) with the badge's full-size art at ICON_POP_ART px
export const BADGE_POP_MS = 1700, BADGE_POP_GAP = 1.9, ICON_POP_K = 2, ICON_POP_ART = 77;

// the shot meter's track runs from the start of the shot (0) to 30% past the ideal release (1)
export const METER_SCALE = 1.3;
export const METER_COLORS = { core: '#1fe07a', boost: '#7fe25e', edge: '#ffc23a', line: 'rgba(4, 26, 12, .6)' };
const METER_PX = 128; // .hud-meter height in app.css
// v0.4.7.5 quick patch: the box score line shown beside the Locked-In grade
const LINE = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO']];
// The window's fill, bottom to top: yellow at the outer edges of the boosts, through lime, to the solid green core
// (the natural window), with a hairline at the core's edges when there's room for it.
export function meterGradient(lo, span, nat, half) {
  const C = METER_COLORS;
  if (nat >= half - 1e-6) return C.core;
  const a = +(((1 - nat - lo) / span) * 100).toFixed(3), b = +(((1 + nat - lo) / span) * 100).toFixed(3);
  const corePx = (nat * 2 / METER_SCALE) * METER_PX;
  if (corePx < 6) return `linear-gradient(0deg, ${C.edge} 0%, ${C.boost} ${a}%, ${C.core} ${a}%, ${C.core} ${b}%, ${C.boost} ${b}%, ${C.edge} 100%)`;
  return `linear-gradient(0deg, ${C.edge} 0%, ${C.boost} ${a}%, ${C.line} ${a}%, ${C.line} calc(${a}% + 1px), ${C.core} calc(${a}% + 1px), ${C.core} calc(${b}% - 1px), ${C.line} calc(${b}% - 1px), ${C.line} ${b}%, ${C.boost} ${b}%, ${C.edge} 100%)`;
}

// what the meter's colors mean (the Tab overlay shows it under the controls)
export function meterLegendHTML() {
  return `<h3>Shot meter</h3><div class="meter-legend">
    <span><i class="ml-core"></i>Solid green: the green window your ratings give you on their own</span>
    <span><i class="ml-boost"></i>Fading out to yellow: what boosts add (badges, Icon badge, takeover, animations). Still a green release</span>
    <span><i class="ml-ring"></i>Outlined: perfect timing, but not an automatic make (layups, shots from past 35 ft)</span>
    <span>Let go anywhere inside the window for an Excellent release; outside it, the shot almost never goes in. No window: smothered, or past half court.</span></div>`;
}

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-score" id="hud-score"></div>
      <div class="hud-meter" id="hud-meter"><div class="hm-track"><div class="hm-fill"></div></div><div class="hm-win"></div><div class="hm-edge"></div><div class="hm-cursor"></div></div>
      <div class="hud-feedback" id="hud-feedback"></div>
      <div class="hud-feedback other" id="hud-fb1"></div><div class="hud-feedback other" id="hud-fb2"></div><div class="hud-feedback other" id="hud-fb3"></div>
      <div class="hud-tags" id="hud-tags"></div>
      <div class="hud-feed" id="hud-feed"></div>
      <div class="hud-center" id="hud-center"></div>
      <div class="hud-stamina" id="hud-stamina"><i></i></div>
      <div class="hud-status" id="hud-status" hidden></div>
      <div class="hud-cam" id="hud-cam"></div>
      <div class="hud-hint" id="hud-hint"></div>
      <div class="hud-oop" id="hud-oop"><div class="ho-ring"><i></i></div><div class="ho-btn"></div><div class="ho-k">ALLEY-OOP</div></div>
      <div class="hud-badges" id="hud-badges"></div>
      <div class="hud-intro" id="hud-intro" hidden></div>
      <div class="hud-grade" id="hud-grade" hidden><div class="lg-k">LOCKED-IN</div><div class="lg-letter"></div><div class="lg-bar"><i></i></div><div class="lg-pop"></div><div class="lg-stats" hidden>${LINE.map(([k, l]) => `<div class="lg-st" data-k="${k}"><b></b><span>${l}</span></div>`).join('')}</div></div>`;
    this.el = id => root.querySelector('#' + id);
    this.score = this.el('hud-score');
    this.meter = this.el('hud-meter');
    this.meterFill = this.meter.querySelector('.hm-fill');
    this.meterWin = this.meter.querySelector('.hm-win');
    this.meterEdge = this.meter.querySelector('.hm-edge');
    this.meterCursor = this.meter.querySelector('.hm-cursor');
    this.meterKey = '';
    this.feedback = this.el('hud-feedback');
    this.fbOthers = [1, 2, 3].map(i => ({ el: this.el('hud-fb' + i), t: 0 })); // (qp3: everyone else's shot feedback)
    this.tags = this.el('hud-tags');
    this.feed = this.el('hud-feed');
    this.center = this.el('hud-center');
    this.stamina = this.el('hud-stamina');
    this.statusBox = this.el('hud-status'); this.statusKey = '';
    this.camLabel = this.el('hud-cam');
    this.hint = this.el('hud-hint');
    this.oop = this.el('hud-oop'); this.oopBtn = this.oop.querySelector('.ho-btn'); this.oopRing = this.oop.querySelector('.ho-ring i'); this.oopKey = '';
    this.grade = this.el('hud-grade');
    this.badgeBox = this.el('hud-badges');
    this.introBox = this.el('hud-intro');
    this.badgeQ = []; this.badgeT = 0; this.badgeShown = 0;
    this.gradeVer = -1;
    this.tagPool = new Map();
    this.fbT = 0; this.centerT = 0; this.camT = 0;
    this.lastScoreKey = '';
  }
  show(v) { this.root.hidden = !v; }
  // v0.4.3 pre-game team intro (lower third); null hides it
  setIntro(html) {
    const el = this.introBox;
    if (!html) { el.hidden = true; el.innerHTML = ''; this.root.classList.remove('intro-on'); return; }
    el.innerHTML = html; el.hidden = false; this.root.classList.add('intro-on');
  }

  setScore(info) {
    const key = JSON.stringify(info);
    if (key === this.lastScoreKey) return;
    this.lastScoreKey = key;
    const t = info.teams;
    this.score.innerHTML = `
      <div class="sb-team" style="--c:${t[0].color}"><span class="sb-abbr">${esc(t[0].abbr)}</span><b>${info.score[0]}</b>${info.poss === 0 ? '<i class="sb-poss"></i>' : ''}</div>
      <div class="sb-mid"><div class="sb-clock">${esc(info.clock)}</div><div class="sb-sub">${esc(info.sub)}</div></div>
      <div class="sb-team right" style="--c:${t[1].color}">${info.poss === 1 ? '<i class="sb-poss"></i>' : ''}<b>${info.score[1]}</b><span class="sb-abbr">${esc(t[1].abbr)}</span></div>
      <div class="sb-shot ${info.shot <= 5 ? 'low' : ''}">${info.shot != null ? Math.ceil(info.shot) : ''}</div>`;
  }

  // v0.4.5 quick patch shot meter. m: {x, y, fill (1 = the ideal release), half (the green window's half-width, same
  // units: you get an Excellent anywhere in 1 ± half), nat (the half-width the build's own ratings give, without any
  // badge, Icon badge, takeover or animation bonus), sure (an Excellent there is an automatic make), smothered, grade}.
  // Everything is drawn to scale on one track, so the window on screen is exactly the window that's graded:
  //   solid green core   - the build's natural window (ratings only)
  //   gradient to yellow - the part added by boosts
  //   outlined window    - perfect timing, but not an automatic make (layups, past 35 ft)
  setMeter(m) {
    if (!m) { this.meter.classList.remove('on'); this.meterKey = ''; return; }
    this.meter.classList.add('on');
    this.meter.style.transform = `translate(${m.x + 34}px, ${m.y - 78}px)`;
    const pct = v => `${(v / METER_SCALE) * 100}%`;
    const f = Math.max(0, Math.min(METER_SCALE, m.fill));
    this.meterFill.style.height = pct(f);
    this.meterCursor.style.bottom = pct(f);
    this.meter.dataset.grade = m.grade || '';
    this.meter.classList.toggle('smothered', !!m.smothered);
    this.meter.classList.toggle('luck', !m.sure);
    const half = Math.max(0, m.half || 0), nat = Math.min(half, Math.max(0, m.nat ?? half));
    const key = `${half.toFixed(5)}|${nat.toFixed(5)}`;
    if (key === this.meterKey) return;
    this.meterKey = key;
    const win = this.meterWin, edge = this.meterEdge;
    if (half <= 0) { win.hidden = edge.hidden = true; return; }
    win.hidden = edge.hidden = false;
    const lo = Math.max(0, 1 - half), hi = Math.min(METER_SCALE, 1 + half), span = hi - lo;
    for (const el of [win, edge]) { el.style.bottom = pct(lo); el.style.height = pct(span); }
    win.style.background = edge.style.background = meterGradient(lo, span, nat, half);
  }

  release(x, y, text, color, sub) {
    this.feedback.innerHTML = `<b style="color:${color}">${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    this.feedback.style.transform = `translate(${x - 120}px, ${y - 130}px)`;
    this.feedback.classList.add('on');
    this.fbT = 1.6;
  }

  // v0.4.7.5 qp3: shot feedback over another player's release (Settings → Shot feedback → Everyone). Smaller than
  // yours, three at a time, oldest replaced
  releaseOther(x, y, text, color, sub) {
    const slot = this.fbOthers.reduce((a, b) => (b.t < a.t ? b : a));
    slot.el.innerHTML = `<b style="color:${color}">${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    slot.el.style.transform = `translate(${x - 120}px, ${y - 110}px)`;
    slot.el.classList.add('on');
    slot.t = 1.4;
  }
  callout(text, kind = '') {
    this.center.innerHTML = `<span class="${kind}">${esc(text)}</span>`;
    this.center.classList.remove('pop'); void this.center.offsetWidth; this.center.classList.add('pop');
    this.centerT = 1.8;
  }

  pushFeed(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'feed-item ' + cls;
    d.textContent = text;
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 3800);
    setTimeout(() => d.remove(), 4600);
  }

  // v0.4.2 badge activation banner: shown one at a time at the top of the screen, in activation order
  // (info.icon: an Icon badge's activation, see showNextBadge)
  badge(info) {
    if (this.badgeQ.length > 6) return;
    const last = this.badgeQ[this.badgeQ.length - 1];
    if (last && last.key === info.key && last.tier === info.tier) return; // same badge firing twice in one play
    this.badgeQ.push(info);
  }
  showNextBadge() {
    const b = this.badgeQ.shift();
    if (!b) return;
    const TIER = ['', 'Bronze', 'Silver', 'Gold', 'Hall of Fame'];
    // v0.4.7.5: the badge's own art (Hall of Fame keeps its full vibrance here too)
    // qp3: an Icon badge's activation (Hash-Slinging, after every dunk) is 20% bigger, carries the badge's full-size art
    // with its animation running (ICON_POP_ART px, against the 42 px miniature), and stays up twice as long
    const d = document.createElement('div');
    const k = b.icon ? ICON_POP_K : 1;
    d.className = b.icon ? 'badge-pop icon' : `badge-pop tier${b.tier}`;
    d.innerHTML = b.icon
      ? `<span class="bp-art">${iconBadgeSVG(b.key, ICON_POP_ART)}</span><span class="bp-text"><small>ICON BADGE ACTIVATED</small><b>${esc(b.name)}</b></span>`
      : `<span class="bp-art">${badgeSVG(b.key, b.tier, 42)}</span><span class="bp-text"><small>BADGE ACTIVATED · ${esc(TIER[b.tier] || '')}</small><b>${esc(b.name)}</b></span>`;
    this.badgeBox.appendChild(d);
    requestAnimationFrame(() => d.classList.add('on'));
    setTimeout(() => { d.classList.remove('on'); d.classList.add('off'); }, BADGE_POP_MS * k);
    setTimeout(() => d.remove(), (BADGE_POP_MS + 600) * k);
    this.badgeT = BADGE_POP_GAP * k;
  }

  // v0.4.1 Locked-In grade (null hides it)
  // v0.4.7.5 quick patch: line: your box score so far ({pts, reb, ast, stl, blk, tov}), shown attached to the right
  setGrade(gr, line = null) {
    if (!gr) { this.grade.hidden = true; this.gradeVer = -1; return; }
    this.grade.hidden = false;
    this.setLine(line);
    if (gr.version === this.gradeVer) return;
    this.gradeVer = gr.version;
    const L = this.grade.querySelector('.lg-letter');
    if (L.textContent !== gr.letter) { L.textContent = gr.letter; this.grade.classList.remove('bump'); void this.grade.offsetWidth; this.grade.classList.add('bump'); }
    this.grade.dataset.tier = gr.tier;
    this.grade.querySelector('.lg-bar i').style.width = `${Math.round(gr.progress * 100)}%`;
    const pop = this.grade.querySelector('.lg-pop');
    if (gr.pop) { pop.textContent = gr.pop.text; pop.className = 'lg-pop on ' + (gr.pop.good ? 'good' : 'bad'); }
    else pop.className = 'lg-pop';
  }

  // your line on the grade: PTS REB AST / STL BLK TO (a number that just went up pulses once)
  setLine(line) {
    const box = this.lineBox || (this.lineBox = this.grade.querySelector('.lg-stats'));
    if (box.hidden === !!line) { box.hidden = !line; this.grade.classList.toggle('with-stats', !!line); this.lineKey = null; }
    if (!line) return;
    const key = LINE.map(([k]) => line[k] || 0).join('|');
    if (key === this.lineKey) return;
    const first = this.lineKey == null;
    this.lineKey = key;
    for (const el of box.children) {
      const b = el.firstChild, v = String(line[el.dataset.k] || 0);
      if (b.textContent === v) continue;
      b.textContent = v;
      if (!first) { el.classList.remove('up'); void el.offsetWidth; el.classList.add('up'); }
    }
  }

  showCam(label) { this.camLabel.textContent = label; this.camLabel.classList.add('on'); this.camT = 1.4; }
  setHint(text) { this.hint.innerHTML = text || ''; this.hint.hidden = !text; }
  // v0.4.7.5 qp3: the alley-oop press. o: {x, y, html (the button glyph, or the result text), frac (time left,
  // 1 → 0), state: wait | open | hit | miss}; null hides it
  setOop(o) {
    if (!o) { if (this.oop.classList.contains('on')) { this.oop.classList.remove('on'); this.oop.dataset.state = ''; this.oopKey = ''; } return; }
    this.oop.classList.add('on');
    this.oop.style.transform = `translate(${o.x - 44}px, ${o.y - 150}px)`;
    this.oop.dataset.state = o.state;
    this.oopRing.style.setProperty('--f', o.frac);
    if (o.html !== this.oopKey) { this.oopKey = o.html; this.oopBtn.innerHTML = o.html; }
  }

  // tags: [{id, x, y, text, cls, visible}]
  setTags(list) {
    const seen = new Set();
    for (const t of list) {
      seen.add(t.id);
      let el = this.tagPool.get(t.id);
      if (!el) { el = document.createElement('div'); el.className = 'ptag'; this.tags.appendChild(el); this.tagPool.set(t.id, el); }
      if (el._text !== t.text || el._cls !== t.cls) { el.innerHTML = t.text; el.className = 'ptag ' + (t.cls || ''); el._text = t.text; el._cls = t.cls; }
      el.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -100%)`;
      el.hidden = !t.visible;
    }
    for (const [id, el] of this.tagPool) if (!seen.has(id)) { el.remove(); this.tagPool.delete(id); }
  }

  // v0.4.5: the user's takeover meter (progress or time left) and Hot / Cold state, bottom-left above the feed
  setStatus(st) {
    const key = st ? JSON.stringify(st) : '';
    if (key === this.statusKey) return;
    this.statusKey = key;
    if (!st || (!st.takeover && !st.hot && !st.cold)) { this.statusBox.hidden = true; return; }
    const parts = [];
    if (st.hot) parts.push('<span class="st-hot">🔥 ON FIRE</span>');
    if (st.cold) parts.push('<span class="st-cold">❄ COLD</span>');
    if (st.takeover) {
      const t = st.takeover;
      parts.push(t.active ? `<span class="st-to on">${esc(t.label)} · ${t.left}s</span>` : `<span class="st-to"><small>${esc(t.label)}</small><i style="--p:${Math.round(t.prog / t.need * 100)}%"></i>${t.prog}/${t.need}</span>`);
    }
    this.statusBox.innerHTML = parts.join('');
    this.statusBox.hidden = false;
  }

  setStamina(x, y, v, show) {
    this.stamina.hidden = !show;
    if (!show) return;
    this.stamina.style.transform = `translate(${x - 26}px, ${y + 8}px)`;
    this.stamina.firstChild.style.width = `${Math.round(v * 100)}%`;
    this.stamina.classList.toggle('low', v < 0.25);
  }

  update(dt) {
    if (this.fbT > 0) { this.fbT -= dt; if (this.fbT <= 0) this.feedback.classList.remove('on'); }
    for (const f of this.fbOthers) if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.el.classList.remove('on'); }
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) this.center.classList.remove('pop'); }
    if (this.camT > 0) { this.camT -= dt; if (this.camT <= 0) this.camLabel.classList.remove('on'); }
    if (this.badgeT > 0) this.badgeT -= dt;
    if (this.badgeT <= 0 && this.badgeQ.length) this.showNextBadge();
  }
  clear() { for (const f of this.fbOthers) { f.t = 0; f.el.classList.remove('on'); } this.setOop(null); this.setStatus(null); this.setIntro(null); this.tags.innerHTML = ''; this.tagPool.clear(); this.feed.innerHTML = ''; this.setMeter(null); this.setHint(''); this.setGrade(null); this.badgeQ = []; this.badgeT = 0; if (this.badgeBox) this.badgeBox.innerHTML = ''; }
}
