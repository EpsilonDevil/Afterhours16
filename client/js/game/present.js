// v0.4.3 game presentation: pre-game team intros (park and Pro-Am).
// The intro lines each team up on the floor in turn, facing a sideline camera, while a lower-third card
// shows every player's overall and build plus their badges (park: top 3; Pro-Am 5v5: the #1 most-used one).
// The simulation doesn't run during the intro; positions are restored exactly when it ends.
import { ARCHETYPES } from '../sim/builds.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TIER_CLS = ['none', 'bronze', 'silver', 'gold', 'hof'];
export const ftIn = inches => inches ? `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"` : '';

// badges ranked by tier, then by how much they've been used (badge progress)
export function rankedBadges(entry) {
  const out = [];
  const charB = entry.build && entry.build.badges && typeof entry.build.badges === 'object' ? entry.build.badges : null;
  const tiers = entry.badges || {};
  const keys = new Set([...Object.keys(tiers), ...(charB ? Object.keys(charB) : [])]);
  for (const k of keys) {
    // (your own badges: the character's record is the truth, so a fresh upgrade always shows its new tier)
    const tier = charB && charB[k] ? (charB[k].tier || 0) : (tiers[k] || 0);
    const use = (charB && charB[k]?.progress) || (entry.badgeUse && entry.badgeUse[k]) || 0;
    if (tier > 0 || use > 0) out.push({ key: k, tier, use });
  }
  return out;
}
export function topBadges(entry, n) { return rankedBadges(entry).filter(b => b.tier > 0).sort((a, b) => b.tier - a.tier || b.use - a.use).slice(0, n); }
export function mostUsedBadge(entry) { return rankedBadges(entry).filter(b => b.tier > 0).sort((a, b) => b.use - a.use || b.tier - a.tier)[0] || null; }

export function introCards(session) {
  const g = session.game, cfg = session.app.config?.badges || {};
  const fiveV5 = g.mode === 'proam';
  const w = session.app.ai;
  return [0, 1].map(t => {
    const team = session.teams[t] || {};
    const players = g.teams[t].map(p => {
      const e = p.entry, b = e.build || {};
      const badges = fiveV5 ? [mostUsedBadge(e)].filter(Boolean) : topBadges(e, 3);
      return {
        name: p.name, human: p.human, pos: b.position || p.position, ovr: b.overall ?? '', height: ftIn(b.height), rep: b.rep?.label || '',
        tag: e.aiId && w ? (w.inSquad(e.aiId) ? 'SQUAD' : w.isFriend(e.aiId) ? 'FRIEND' : '') : '',
        arch: ARCHETYPES[b.archetype]?.label || '', badges: badges.map(x => ({ ...x, name: cfg[x.key]?.name || x.key.replace(/_/g, ' ') })),
      };
    });
    return { team, players, fiveV5 };
  });
}

export function introHTML(card, idx, total) {
  const { team, players, fiveV5 } = card;
  const sub = fiveV5 ? 'TOP BADGE' : 'TOP 3 BADGES';
  return `<div class="intro-card ${fiveV5 ? 'five' : ''}" style="--tc:${esc(team.color || '#ffd84a')}">
    <div class="intro-team"><span class="intro-k">${idx === 0 ? 'STARTING FOR' : 'AND THEIR OPPONENTS'}</span><b>${esc(team.name || 'Team')}</b><span class="intro-step">${idx + 1}/${total}</span></div>
    <div class="intro-players">${players.map((p, i) => `
      <div class="intro-p ${p.human ? 'me' : ''}" style="--d:${i * 0.12}s">
        <div class="intro-ovr"><b>${esc(p.ovr)}</b><small>OVR</small></div>
        <div class="intro-who"><b>${esc(p.name)}${p.human ? ' <em>YOU</em>' : p.tag ? ` <em class="${p.tag === 'SQUAD' ? 'sq' : 'fr'}">${p.tag}</em>` : ''}</b><small>${esc(p.pos)} · ${esc(p.height)} · ${esc(p.arch)}${p.rep ? ' · ' + esc(p.rep) : ''}</small>
          <div class="intro-badges" title="${sub}">${p.badges.length ? p.badges.map(b => `<span class="ib ${TIER_CLS[b.tier] || 'none'}">${esc(b.name)}</span>`).join('') : '<span class="ib none">No badges yet</span>'}</div>
        </div>
      </div>`).join('')}</div>
  </div>`;
}

export class GameIntro {
  constructor(session, opts = {}) {
    this.s = session;
    this.stageDur = opts.stageDur ?? 3.9;
    this.cards = introCards(session);
    this.stage = -1; this.t = 0; this.done = false;
    const g = session.game;
    this.saved = g.players.map(p => ({ x: p.x, z: p.z, f: p.facing, action: p.action }));
    this.next();
  }

  // court-local lineup spot for slot i of n
  spot(i, n) {
    const g = this.s.game;
    const zc = g.half ? 6.6 : 0;
    const gap = n >= 5 ? 1.3 : 1.55;
    return { x: -2.0 + (i % 2) * 0.25, z: zc + (i - (n - 1) / 2) * gap };
  }

  next() {
    const s = this.s, g = s.game;
    this.stage++; this.t = 0;
    if (this.stage >= 2) { this.finish(); return; }
    const t = this.stage;
    g.players.forEach((p, i) => {
      const on = p.team === t, v = s.visuals[i];
      v.view.setVisible(on); v.blob.visible = on; if (v.ring) v.ring.visible = on;
      p.action = null;
      if (!on) return;
      const k = g.teams[t].indexOf(p), sp = this.spot(k, g.teams[t].length);
      p.setPos(sp.x, sp.z, -Math.PI / 2 + (k - (g.teams[t].length - 1) / 2) * 0.06);
      // a staggered pose-off: each player hits his celebration as the camera passes
      p._introCelly = 0.5 + k * 0.45;
    });
    s.rig.snap();
    s.hud.setIntro(introHTML(this.cards[t], t, 2));
  }

  skip() { this.next(); }

  update(dt) {
    if (this.done) return;
    const s = this.s, g = s.game;
    this.t += dt;
    for (const p of g.players) {
      if (p.team !== this.stage) continue;
      if (p._introCelly != null && this.t >= p._introCelly) { p._introCelly = null; p.startAction('celebrate', 1.6, { kind: s.celebrationKind(p) }); }
      if (p.action) { p.action.t += dt; if (p.action.t >= p.action.dur) p.action = null; }
    }
    if (this.t >= this.stageDur) this.next();
  }

  // slow sideline dolly along the line
  camera(dt) {
    const s = this.s, g = s.game, [ox, , oz] = s.origin;
    const n = g.teams[Math.max(0, this.stage)]?.length || 1;
    const a = this.spot(0, n), b = this.spot(n - 1, n);
    const k = Math.min(1, this.t / this.stageDur), e = k * k * (3 - 2 * k);
    const zc = (a.z + b.z) / 2, span = Math.abs(b.z - a.z);
    const z = zc + (e - 0.5) * span * 0.35 * (this.stage === 0 ? 1 : -1);
    const dist = 4.2 + span * 0.42 - e * 0.5;
    s.rig.apply(dt, [ox - 2 - dist, 1.55, oz + z], [ox - 2, 1.22, oz + zc + (z - zc) * 0.4], n >= 5 ? 44 : 40, 2.5);
  }

  finish() {
    const s = this.s, g = s.game;
    this.done = true;
    g.players.forEach((p, i) => {
      const sv = this.saved[i], v = s.visuals[i];
      p.setPos(sv.x, sv.z, sv.f); p.action = sv.action; p._introCelly = null;
      v.view.setVisible(true); v.blob.visible = true; if (v.ring) v.ring.visible = true;
    });
    s.hud.setIntro(null);
    s.rig.snap();
  }
}
