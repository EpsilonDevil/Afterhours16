// In-game DOM HUD: score bug, shot meter, release feedback, player tags, feed, big callouts.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-score" id="hud-score"></div>
      <div class="hud-meter" id="hud-meter"><div class="hud-meter-fill"></div><div class="hud-meter-green"></div></div>
      <div class="hud-feedback" id="hud-feedback"></div>
      <div class="hud-tags" id="hud-tags"></div>
      <div class="hud-feed" id="hud-feed"></div>
      <div class="hud-center" id="hud-center"></div>
      <div class="hud-stamina" id="hud-stamina"><i></i></div>
      <div class="hud-status" id="hud-status" hidden></div>
      <div class="hud-cam" id="hud-cam"></div>
      <div class="hud-hint" id="hud-hint"></div>
      <div class="hud-badges" id="hud-badges"></div>
      <div class="hud-intro" id="hud-intro" hidden></div>
      <div class="hud-grade" id="hud-grade" hidden><div class="lg-k">LOCKED-IN</div><div class="lg-letter"></div><div class="lg-bar"><i></i></div><div class="lg-pop"></div></div>`;
    this.el = id => root.querySelector('#' + id);
    this.score = this.el('hud-score');
    this.meter = this.el('hud-meter');
    this.meterFill = this.meter.querySelector('.hud-meter-fill');
    this.meterGreen = this.meter.querySelector('.hud-meter-green');
    this.feedback = this.el('hud-feedback');
    this.tags = this.el('hud-tags');
    this.feed = this.el('hud-feed');
    this.center = this.el('hud-center');
    this.stamina = this.el('hud-stamina');
    this.statusBox = this.el('hud-status'); this.statusKey = '';
    this.camLabel = this.el('hud-cam');
    this.hint = this.el('hud-hint');
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

  // meter: {x,y, fill 0..1.3, greenAt (0..1), greenW, state: 'charging'|'released', grade}
  setMeter(m) {
    if (!m) { this.meter.classList.remove('on'); return; }
    this.meter.classList.add('on');
    this.meter.style.transform = `translate(${m.x + 34}px, ${m.y - 70}px)`;
    const f = Math.min(1.25, m.fill);
    this.meterFill.style.height = `${Math.min(100, f / 1.25 * 100)}%`;
    this.meterGreen.style.bottom = `${(m.greenAt / 1.25) * 100 - m.greenW / 1.25 * 50}%`;
    this.meterGreen.style.height = `${m.greenW / 1.25 * 100}%`;
    this.meter.dataset.grade = m.grade || '';
    this.meter.classList.toggle('smothered', !!m.smothered);
  }

  release(x, y, text, color, sub) {
    this.feedback.innerHTML = `<b style="color:${color}">${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    this.feedback.style.transform = `translate(${x - 120}px, ${y - 130}px)`;
    this.feedback.classList.add('on');
    this.fbT = 1.6;
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
    const GLYPH = { Shooting: '◎', Finishing: '▲', Playmaking: '◆', Defense: '⛨', Rebounding: '⬈' };
    const d = document.createElement('div');
    d.className = `badge-pop tier${b.tier}`;
    d.innerHTML = `<span class="bp-icon"><i>${GLYPH[b.group] || '★'}</i></span><span class="bp-text"><small>BADGE ACTIVATED · ${esc(TIER[b.tier] || '')}</small><b>${esc(b.name)}</b></span>`;
    this.badgeBox.appendChild(d);
    requestAnimationFrame(() => d.classList.add('on'));
    setTimeout(() => { d.classList.remove('on'); d.classList.add('off'); }, 1700);
    setTimeout(() => d.remove(), 2300);
    this.badgeT = 1.9;
  }

  // v0.4.1 Locked-In grade (null hides it)
  setGrade(gr) {
    if (!gr) { this.grade.hidden = true; this.gradeVer = -1; return; }
    this.grade.hidden = false;
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

  showCam(label) { this.camLabel.textContent = label; this.camLabel.classList.add('on'); this.camT = 1.4; }
  setHint(text) { this.hint.innerHTML = text || ''; this.hint.hidden = !text; }

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
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) this.center.classList.remove('pop'); }
    if (this.camT > 0) { this.camT -= dt; if (this.camT <= 0) this.camLabel.classList.remove('on'); }
    if (this.badgeT > 0) this.badgeT -= dt;
    if (this.badgeT <= 0 && this.badgeQ.length) this.showNextBadge();
  }
  clear() { this.setStatus(null); this.setIntro(null); this.tags.innerHTML = ''; this.tagPool.clear(); this.feed.innerHTML = ''; this.setMeter(null); this.setHint(''); this.setGrade(null); this.badgeQ = []; this.badgeT = 0; if (this.badgeBox) this.badgeBox.innerHTML = ''; }
}
