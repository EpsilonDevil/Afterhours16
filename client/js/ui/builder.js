// MyPlayer builder (create) and appearance editor with live 3D preview and cap preview.
import { $, $$, esc, toast, heightStr, title, bar, money } from './common.js';
import { POSITIONS, ARCHETYPES, caps, startingAttributes, upgradeCost } from '../sim/builds.js';
import { ATTR_GROUPS, ATTR_LABEL, overall } from '../sim/ratings.js';
import { settings, saveSettings } from '../core/settings.js';
import * as Screens from './screens.js';

const DEFAULT = { name: 'Rookie', position: 'SG', archetype: 'sharpshooter', height: 77, weight: 205, wingspan: 81, hand: 'R', appearance: { skin: '#a56945', hair: 'fade', hair_color: '#201b19', face: 'oval', beard: 'stubble', eyes: '#3a2418', number: 16 } };

export function create(app, root, params = {}) {
  const d = structuredClone(params.draft || DEFAULT);
  let previewTimer;
  const render = () => {
    const [lo, hi] = POSITIONS[d.position];
    d.height = Math.max(lo, Math.min(hi, d.height));
    d.wingspan = Math.max(d.height - 1, Math.min(d.height + 8, d.wingspan));
    const c = caps(d), start = startingAttributes(d);
    const ovr0 = overall(start, d.position), ovr1 = overall(c, d.position);
    let cost = 0; for (const k in c) cost += upgradeCost(start[k], c[k]);
    const cfg = app.config;
    root.innerHTML = `
    <section class="panel builder">
      <div class="eyebrow">MYPLAYER BUILDER</div>
      <h1>Create your player</h1>
      <div class="step"><h4>Position</h4><div class="chips">${Object.keys(POSITIONS).map(p => `<button class="chip ${d.position === p ? 'on' : ''}" data-pos="${p}">${p}</button>`).join('')}</div></div>
      <div class="step"><h4>Archetype</h4><div class="arch-grid">${Object.entries(ARCHETYPES).map(([k, v]) => `<button class="arch ${d.archetype === k ? 'on' : ''}" data-arch="${k}"><b>${v.label}</b><small>${v.blurb}</small></button>`).join('')}</div></div>
      <div class="step"><h4>Body</h4>
        <label class="slider">Height <b>${heightStr(d.height)}</b><input type="range" min="${lo}" max="${hi}" value="${d.height}" data-num="height"></label>
        <label class="slider">Weight <b>${d.weight} lb</b><input type="range" min="150" max="300" value="${d.weight}" data-num="weight"></label>
        <label class="slider">Wingspan <b>${heightStr(d.wingspan)}</b><input type="range" min="${d.height - 1}" max="${d.height + 8}" value="${d.wingspan}" data-num="wingspan"></label>
        <div class="chips"><span class="muted small">Shooting hand</span><button class="chip ${d.hand === 'R' ? 'on' : ''}" data-hand="R">Right</button><button class="chip ${d.hand === 'L' ? 'on' : ''}" data-hand="L">Left</button></div>
      </div>
      <div class="step"><h4>Look</h4>${lookPickers(cfg, d.appearance)}</div>
      <div class="step"><h4>Name & number</h4>
        <div class="row gap"><input class="text" maxlength="24" value="${esc(d.name)}" data-name placeholder="Player name"><input class="text num" type="number" min="0" max="99" value="${d.appearance.number}" data-number></div>
      </div>
      <div class="row gap end sticky-actions">${app.profile.characters.length ? '<button class="btn ghost" data-cancel>Cancel</button>' : ''}<button class="btn primary" data-create>Create player</button></div>
    </section>
    <aside class="panel builder-side">
      <div class="ovr-row"><div class="ovr"><b>${ovr0}</b><small>START</small></div><div class="ovr dim"><b>${ovr1}</b><small>MAX</small></div></div>
      <div class="muted small">Max out every attribute for ${money(cost)} VC.</div>
      ${Object.entries(ATTR_GROUPS).map(([g, keys]) => `<div class="attr-group"><h5>${g}</h5>${keys.map(k => `<div class="attr-row"><span>${ATTR_LABEL[k]}</span>${bar(start[k], 99, c[k])}<b>${c[k]}</b></div>`).join('')}</div>`).join('')}
    </aside>`;
    bind();
  };
  const preview = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const b = { ...d, attributes: startingAttributes(d), equipment: { ...app.config.default_equipment } };
      app.showroom.setCharacter(b, app.look(b));
    }, 120);
  };
  const bind = () => {
    $$('[data-pos]', root).forEach(b => b.onclick = () => { d.position = b.dataset.pos; const fit = { PG: 'playmaker', SG: 'sharpshooter', SF: 'two_way', PF: 'stretch_big', C: 'glass_cleaner' }; if (!['PG', 'SG'].includes(d.position) && ['playmaker'].includes(d.archetype)) d.archetype = fit[d.position]; render(); preview(); });
    $$('[data-arch]', root).forEach(b => b.onclick = () => { d.archetype = b.dataset.arch; render(); });
    $$('[data-num]', root).forEach(i => i.oninput = () => { d[i.dataset.num] = +i.value; render(); preview(); });
    $$('[data-hand]', root).forEach(b => b.onclick = () => { d.hand = b.dataset.hand; render(); });
    bindLook(root, d.appearance, () => { render(); preview(); app.showroom.setFocus('face'); });
    $('[data-name]', root).oninput = e => { d.name = e.target.value; };
    $('[data-number]', root).oninput = e => { d.appearance.number = Math.max(0, Math.min(99, +e.target.value | 0)); };
    const cancel = $('[data-cancel]', root); if (cancel) cancel.onclick = () => Screens.go(app, 'myplayer');
    $('[data-create]', root).onclick = async ev => {
      const btn = ev.currentTarget; btn.disabled = true;
      try {
        const res = await app.api.mutate('/api/characters', { build: { name: d.name, position: d.position, archetype: d.archetype, height: d.height, weight: d.weight, wingspan: d.wingspan, hand: d.hand, appearance: d.appearance } });
        app.replaceChar(res.character);
        app.selectedId = res.character.id; settings.character = res.character.id; saveSettings();
        toast(`${res.character.name} is ready. Spend VC on attributes in MyPlayer.`);
        Screens.go(app, 'home');
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    };
  };
  render(); preview();
  app.showroom.setFocus('left');
}

export function lookPickers(cfg, a) {
  const sw = (key, list) => `<div class="swatches">${list.map(v => `<button class="sw ${a[key] === v ? 'on' : ''}" style="--v:${v}" data-look="${key}" data-val="${v}" aria-label="${v}"></button>`).join('')}</div>`;
  const ch = (key, list) => `<div class="chips">${list.map(v => `<button class="chip ${a[key] === v ? 'on' : ''}" data-look="${key}" data-val="${v}">${title(v)}</button>`).join('')}</div>`;
  return `<div class="look"><span class="muted small">Skin</span>${sw('skin', cfg.skin)}<span class="muted small">Face</span>${ch('face', cfg.faces)}<span class="muted small">Hair</span>${ch('hair', cfg.hair)}<span class="muted small">Hair color</span>${sw('hair_color', cfg.hair_colors)}<span class="muted small">Facial hair</span>${ch('beard', cfg.beards)}<span class="muted small">Eyes</span>${sw('eyes', cfg.eyes)}</div>`;
}
export function bindLook(root, a, onChange) {
  $$('[data-look]', root).forEach(b => b.onclick = () => { a[b.dataset.look] = b.dataset.val; onChange(); });
}

export function appearanceEditor(app, root, char) {
  const a = structuredClone(char.appearance);
  const render = () => {
    root.innerHTML = `<div class="step"><h4>Appearance (free)</h4>${lookPickers(app.config, a)}
      <div class="row gap"><label class="muted small">Jersey number <input class="text num" type="number" min="0" max="99" value="${a.number}" data-number></label></div></div>
      <div class="row gap end"><button class="btn primary" data-save>Save look</button></div>`;
    bindLook(root, a, () => { render(); const b = { ...char, appearance: a }; app.showroom.setCharacter(b, app.look(b)); app.showroom.setFocus('face'); });
    $('[data-number]', root).oninput = e => { a.number = Math.max(0, Math.min(99, +e.target.value | 0)); };
    $('[data-save]', root).onclick = async ev => {
      ev.currentTarget.disabled = true;
      try { const res = await app.api.mutate(`/api/characters/${char.id}/appearance`, { appearance: a }); app.replaceChar(res.character); toast('Look saved.'); }
      catch (e) { toast(e.message, 'error'); }
      ev.currentTarget.disabled = false;
    };
  };
  render();
}
