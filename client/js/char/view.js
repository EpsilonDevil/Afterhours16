// Runtime athlete: GPU meshes + materials + rig. Placed in world by (x, y, z, yaw).
import { AthleteModel } from './athlete.js';
import { Rig } from './rig.js';
import { paintFace, paintBodySkin, paintHair, paintTop, paintShorts, paintShoe, paintChain, paintPendant, detailNormal, paintMocap } from './looks.js';
import { Material, Mesh } from '../gfx/renderer.js';
import * as M from '../core/math.js';

// textures shared by every athlete on a GL context (detail normals, body skin per tone)
const shared = new WeakMap();
function sharedTex(ctx, key, make, opts) {
  let m = shared.get(ctx);
  if (!m) { m = new Map(); shared.set(ctx, m); }
  if (!m.has(key)) m.set(key, ctx.texture(make(), opts));
  return m.get(key);
}

// v0.4.5 stage 7: an athlete can be built in steps (a few milliseconds each) spread over several frames, so a
// park full of people arriving and games rotating never freezes the frame. new AthleteView(...) still builds
// everything at once; AthleteView.staged(...) returns the view and a generator that builds it step by step.
export const STAGED = Symbol('staged');
export class AthleteView {
  constructor(renderer, build, look, opts = {}) {
    if (renderer === STAGED) return;
    for (const _ of this.init(renderer, build, look, opts)) { /* build it all now */ }
  }
  static staged(renderer, build, look, opts = {}) {
    const v = new AthleteView(STAGED);
    return { view: v, steps: v.init(renderer, build, look, opts) };
  }

  *init(renderer, build, look, opts = {}) {
    this.r = renderer;
    const ctx = renderer.ctx;
    this.ctx = ctx;
    this.build = build;
    this.look = look;
    const detail = opts.detail ?? 1;
    this.model = new AthleteModel(build, look, detail);
    this.rig = new Rig(this.model);
    this.H = this.model.d.H;
    this.world = M.m4();
    const geo = {};
    yield* this.model.buildSteps(geo);
    const textures = this.textures = [];
    const own = (src, o) => { const t = ctx.texture(src, o); textures.push(t); return t; };
    const skinDetail = sharedTex(ctx, 'detail:skin', () => detailNormal('skin'), { srgb: false, aniso: 4 });
    const meshDetail = sharedTex(ctx, 'detail:mesh', () => detailNormal('mesh'), { srgb: false, aniso: 4 });
    const knitDetail = sharedTex(ctx, 'detail:knit', () => detailNormal('knit'), { srgb: false, aniso: 4 });
    const skinHex = look.skin || '#a56945';
    const bodyTex = sharedTex(ctx, 'bodyskin:' + skinHex, () => paintBodySkin(skinHex), { aniso: 4 });
    // skin: slightly rougher/drier on the body, a touch of sheen on the face
    const bodyMat = new Material({ map: bodyTex, detailMap: skinDetail, detail: [9, 9, 0.55], color: [1, 1, 1], roughness: 0.64, specular: 0.36, shading: 'skin', character: true });
    // far-away people (walkers, background games) get a 256 face: it's 6x cheaper to paint and looks the same at
    // park distances
    const faceTex = own(paintFace(this.model, opts.faceRes || (detail >= 1 ? 1024 : detail >= 0.75 ? 384 : 256)), { aniso: 8 });
    yield;
    const headMat = new Material({ map: faceTex, detailMap: skinDetail, detail: [44, 22, 0.45], color: [1, 1, 1], roughness: 0.64, specular: 0.36, shading: 'skin', character: true });
    const eyeMat = new Material({ color: [1, 1, 1], roughness: 0.07, specular: 1.2, character: true });
    const top = look.top || { family: 'jersey' };
    const cut = this.model.topCut(top);
    // v0.4.5: the King Tut Cup mo-cap suit paints its own texture and glows (emissive map)
    const mocapTop = top.pattern === 'mocap';
    const topTex = own(mocapTop ? paintMocap(top, 'top') : paintTop({ ...top, number: look.number, name: look.name, keep: cut.keep, hem: cut.hem, neckTop: cut.neckTop, res: detail < 1 ? 256 : undefined }), { aniso: 8 });
    yield;
    const glowOf = (spec, k = 2.4) => (spec.glow ? M.hexLinear(spec.glow).map(v => v * k) : [0, 0, 0]);
    const jersey = top.family === 'jersey';
    const topMat = new Material({
      map: topTex, color: [0.86, 0.86, 0.86], roughness: jersey ? 0.6 : 0.86, shading: 'cloth', sheen: jersey ? [0.22, 0.22, 0.22] : [0.16, 0.16, 0.16],
      detailMap: jersey ? meshDetail : knitDetail, detail: jersey ? [34, 26, 0.45] : [60, 46, 0.35], character: true, doubleSided: true, layer: 3,
      emissiveMap: mocapTop ? own(paintMocap(top, 'top', true), {}) : null, emissive: mocapTop ? glowOf(top) : [0, 0, 0],
    });
    const bot = look.bottom || { family: 'shorts' };
    const mocapBot = bot.pattern === 'mocap';
    const botTex = own(mocapBot ? paintMocap(bot, 'bottom') : paintShorts(detail < 1 ? { ...bot, res: 256 } : bot), { aniso: 8 });
    yield;
    const botMat = new Material({ map: botTex, color: [0.86, 0.86, 0.86], roughness: 0.62, shading: 'cloth', sheen: [0.22, 0.22, 0.22], detailMap: bot.family === 'joggers' ? knitDetail : meshDetail, detail: [30, 30, 0.35], character: true, doubleSided: true, layer: 2,
      emissiveMap: mocapBot ? own(paintMocap(bot, 'bottom', true), {}) : null, emissive: mocapBot ? glowOf(bot) : [0, 0, 0] });
    const gearMat = new Material({ color: [0.84, 0.84, 0.84], roughness: 0.5, specular: 0.7, character: true, layer: 4 });
    this.meshes = [];
    const add = (g, mat, name) => {
      if (!g) return null;
      const m = new Mesh(ctx.geometry(g), mat, { bones: this.rig.skin, name });
      m.boundsOverride = { center: [0, 1, 0], radius: this.H * 0.75 };
      this.meshes.push(m);
      return m;
    };
    this.body = add(geo.body, bodyMat, 'body');
    this.head = add(geo.head, headMat, 'head');
    add(geo.eyes, eyeMat, 'eyes');
    if (geo.hair) {
      const hairTex = own(paintHair(look), { aniso: 4 });
      yield;
      const hairMat = new Material({ map: hairTex, color: [1, 1, 1], roughness: 0.62, specular: 0.7, shading: 'cloth', sheen: [0.1, 0.09, 0.08], alphaTest: 0.32, character: true });
      add(geo.hair, hairMat, 'hair');
    }
    add(geo.top, topMat, 'top');
    // v0.4.7.5: the straps and top edge always on top of the skin (a few centimetres toward the camera)
    if (geo.straps) add(geo.straps, new Material({ ...topMat, viewBias: 0.018 }), 'straps'); // (same options as the top)
    add(geo.bottom, botMat, 'bottom');
    add(geo.gear, gearMat, 'gear');
    if (geo.shoes) {
      // v0.4.3: textured sneakers (one texture per design, shared by everyone wearing it)
      const sh = look.gear?.shoes || {};
      const key = 'shoe:' + [sh.model, sh.color, sh.accent, sh.sole, sh.trim, sh.lace].join('|');
      const shoeTex = sharedTex(ctx, key, () => paintShoe(sh), { aniso: 8 });
      add(geo.shoes, new Material({ map: shoeTex, color: [0.95, 0.95, 0.95], roughness: 0.48, specular: 0.65, character: true, layer: 5 }), 'shoes');
    }
    if (geo.chain) {
      // v0.4.4: textured chains. Gold is polished metal; iced is white gold paved with stones that glint.
      const kind = geo.chain.iced ? 'ice' : 'gold';
      const tex = sharedTex(ctx, 'chain:' + kind, () => paintChain(kind).color, { aniso: 8 });
      const ptex = sharedTex(ctx, 'pendant:' + kind, () => paintPendant(kind).color, { aniso: 8 });
      const etex = kind === 'ice' ? sharedTex(ctx, 'chainE:' + kind, () => paintChain(kind).emissive, {}) : null;
      const petex = kind === 'ice' ? sharedTex(ctx, 'pendantE:' + kind, () => paintPendant(kind).emissive, {}) : null;
      const metal = (map, emap) => new Material({ map, color: [1, 1, 1], roughness: kind === 'ice' ? 0.16 : 0.24, metalness: 0.92, specular: 1.1, character: true, emissiveMap: emap, emissive: emap ? [2.4, 2.5, 2.7] : [0, 0, 0], layer: 5 });
      add(geo.chain.chain, metal(tex, etex), 'chain');
      add(geo.chain.pendant, Object.assign(metal(ptex, petex), { doubleSided: true }), 'pendant');
    }
    this.scene = null;
    this.visible = true;
  }

  addTo(scene) { this.scene = scene; for (const m of this.meshes) scene.add(m); return this; }
  removeFrom() { if (!this.scene) return; for (const m of this.meshes) this.scene.remove(m); this.scene = null; }
  setVisible(v) { this.visible = v; for (const m of this.meshes) m.visible = v; }
  setShadow(v) { for (const m of this.meshes) m.castShadow = v; }

  // Solve pose and place in world
  update(pose, x, y, z, yaw, opts) {
    this.rig.solve(pose, opts);
    M.m4fromYaw(this.world, x, y, z, yaw);
    this.rig.updateSkin(this.world);
    const c = [x, y + this.H * 0.5, z];
    for (const m of this.meshes) { m.boundsOverride.center = c; }
  }

  // world position of a bone
  joint(bone, out) { return this.rig.jointWorld(this.world, bone, out); }

  dispose() {
    this.removeFrom();
    // (a staged build can be thrown away half done: only what it made so far is freed)
    for (const m of this.meshes || []) this.ctx.disposeGeometry(m.geo);
    for (const t of this.textures || []) this.ctx.disposeTexture(t);
    this.meshes = []; this.textures = [];
  }
}
