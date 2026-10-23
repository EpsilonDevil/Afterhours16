// v0.4.8.8 The Pro-Am Overhaul (docs/PROAM-OVERHAUL.md §6, the Platinum reward): a player's Pro-Am record over his
// head in the park ("12–4"), when he has turned the toggle on and is Platinum or above. The entry each player brings
// carries it: entry.proam = {tier, div, record: [w, l], showRecord} (the Server/UI agent fills it in; best: the highest
// tier he has reached, since rank items keep working after a demotion). A tag is a small lit pill on a quad that turns
// to face the camera, one per player who shows his record, rebuilt only when the record changes.
import * as G from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import * as M from '../core/math.js';
import { Material, Mesh } from '../gfx/renderer.js';

export const PROAM_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster'];
export const PLATINUM = 3;
export const tierIndex = t => (typeof t === 'number' && Number.isFinite(t) ? Math.floor(t) : PROAM_TIERS.indexOf(String(t ?? '').toLowerCase().replace(/[\s_-]/g, '')));
// the tier the tag is drawn in (its colours): his current one, or Platinum if he's dropped below it since
export const tagTier = proam => PROAM_TIERS[Math.min(PROAM_TIERS.length - 1, Math.max(PLATINUM, tierIndex(proam?.tier)))];
// the text over his head, or null: the toggle on, Platinum or above (now or at his best), a record to show
export function recordText(proam) {
  if (!proam || typeof proam !== 'object' || !proam.showRecord) return null;
  if (Math.max(tierIndex(proam.tier), tierIndex(proam.best ?? proam.peak ?? -1)) < PLATINUM) return null;
  const r = proam.record;
  if (!Array.isArray(r) || r.length < 2) return null;
  const n = v => Math.max(0, Math.min(9999, Math.floor(+v || 0)));
  return `${n(r[0])}–${n(r[1])}`;
}

const TIER_COLOURS = { platinum: ['#e4ecf2', '#7fb2cc'], diamond: ['#eaf8ff', '#4fd2ff'], master: ['#f6e6ff', '#b46aff'], grandmaster: ['#fff2cc', '#ff6a3a'] };
export function recordCanvas(text, tier = 'platinum') {
  const [ink, edge] = TIER_COLOURS[tier] || TIER_COLOURS.platinum;
  const c = T.canvas(256, 96), g = c.getContext('2d');
  g.clearRect(0, 0, 256, 96);
  const r = 40, x0 = 8, y0 = 8, w = 240, h = 80;
  g.beginPath(); g.moveTo(x0 + r, y0); g.lineTo(x0 + w - r, y0); g.arc(x0 + w - r, y0 + r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(x0 + r, y0 + h); g.arc(x0 + r, y0 + r, r, Math.PI / 2, Math.PI * 1.5); g.closePath();
  g.fillStyle = 'rgba(12,14,18,0.82)'; g.fill();
  g.lineWidth = 6; g.strokeStyle = edge; g.stroke();
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 52px "Arial Black", Impact, sans-serif';
  g.fillText(text, 128, 50);
  return c;
}

// tags over the heads of the people in a scene. update(list, cam): list [{key, x, z, h?, proam}] (h: the top of his
// head, about 2 m), cam: the camera's position [x, y, z]
export class RecordTags {
  constructor(r, scene) { this.r = r; this.scene = scene; this.map = new Map(); this.geo = null; }
  quad() { return this.geo || (this.geo = this.r.ctx.geometry(G.quad(0.9, 0.34))); }
  update(list, cam) {
    const seen = new Set();
    for (const it of list) {
      const text = recordText(it?.proam);
      if (!text || it.key == null) continue;
      seen.add(it.key);
      let tg = this.map.get(it.key);
      if (!tg) {
        tg = { mesh: new Mesh(this.quad(), new Material({ color: [1.25, 1.25, 1.25], shading: 'unlit', blend: 'alpha', depthWrite: false, fog: false, doubleSided: true }), { castShadow: false, reflect: false }), k: null };
        tg.mesh.order = 8;
        this.scene.add(tg.mesh); this.map.set(it.key, tg);
      }
      const tier = tagTier(it.proam), k = `${text}|${tier}`;
      if (tg.k !== k) { tg.k = k; const old = tg.mesh.material.map; tg.mesh.material.map = this.r.ctx.texture(recordCanvas(text, tier), { wrap: 'clamp' }); if (old) this.r.ctx.disposeTexture?.(old); }
      const y = (it.h || 2.0) + 0.42, yaw = cam ? Math.atan2(cam[0] - it.x, cam[2] - it.z) : 0;
      M.m4fromYaw(tg.mesh.matrix, it.x, y, it.z, yaw);
      tg.mesh.visible = it.visible !== false;
    }
    for (const [key, tg] of this.map) if (!seen.has(key)) this.drop(key, tg);
    return seen.size;
  }
  drop(key, tg = this.map.get(key)) { if (!tg) return; this.scene.remove(tg.mesh); if (tg.mesh.material.map) this.r.ctx.disposeTexture?.(tg.mesh.material.map); this.map.delete(key); }
  dispose() { for (const [key, tg] of [...this.map]) this.drop(key, tg); if (this.geo) { this.r.ctx.disposeGeometry?.(this.geo); this.geo = null; } } // (QP3: and the quad they shared)
}
