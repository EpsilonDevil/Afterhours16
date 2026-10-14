// Runtime athlete: GPU meshes + materials + rig. Placed in world by (x, y, z, yaw).
import { AthleteModel } from './athlete.js';
import { Rig } from './rig.js';
import { paintFace, paintBodySkin, paintHair, paintTop, paintShorts, paintShoe, paintChain, paintPendant, detailNormal, paintMocap, paintGorilla, paintShell, paintBones, paintBoneGlove, paintLantern, paintShoeGlow } from './looks.js';
import { Material, Mesh } from '../gfx/renderer.js';
import * as M from '../core/math.js';

// v0.4.8 the Sharp Eye backflip: the whole body turned head over heels (angle about his own left-right axis; negative
// is backwards) round a point py up from his feet, then placed and turned to face where he faces
const _qy = [0, 0, 0, 1], _qx = [0, 0, 0, 1], _q = [0, 0, 0, 1], _p = [0, 0, 0];
export function placeFlipped(o, x, y, z, yaw, angle, py) {
  M.qaxis(_qy, 0, 1, 0, yaw); M.qaxis(_qx, 1, 0, 0, angle); M.qmul(_q, _qy, _qx);
  // (the pivot stays put: what the turn moves it by, taken back off, in the world)
  const dy = py * (1 - Math.cos(angle)), dz = -py * Math.sin(angle);
  _p[0] = x + dz * Math.sin(yaw); _p[1] = y + dy; _p[2] = z + dz * Math.cos(yaw);
  return M.m4compose(o, _p, _q);
}

// textures shared by every athlete on a GL context (detail normals, body skin per tone)
const shared = new WeakMap();
function sharedTex(ctx, key, make, opts) {
  let m = shared.get(ctx);
  if (!m) { m = new Map(); shared.set(ctx, m); }
  if (!m.has(key)) m.set(key, ctx.texture(make(), opts));
  return m.get(key);
}

// v0.4.7.5 qp3 perf: the far model of the people around the park (see AthleteView.init)
export const LOD_DETAIL = 0.3;
// v0.4.8.5 quick patch 2 The Monster Mash: how bright the glow-in-the-dark things glow (their emissive maps carry their own
// colours): the Bone Suit's bones, the Coffin Hi's slime, the Jack-o'-Lantern band's candle (which flickers: update())
export const MONSTER_GLOW = { bones: 0.8, slime: 1.6, candle: 2.2 };

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
    const mocapTop = top.pattern === 'mocap', furTop = top.pattern === 'gorilla'; // (v0.4.7.5 qp3: the gorilla costume)
    const shellTop = top.pattern === 'shellsuit'; // (v0.4.8.5 quick patch: the Beat Goes On windbreaker, shiny nylon)
    // (v0.4.8.5 quick patch 2: the Monster Mash Bone Suit: its skeleton painted, and again alone as the glow map)
    const boneTop = top.pattern === 'bones', boneRes = detail < 1 ? 512 : 1024, boneGlow = [MONSTER_GLOW.bones, MONSTER_GLOW.bones, MONSTER_GLOW.bones];
    const topTex = own(mocapTop ? paintMocap(top, 'top') : furTop ? paintGorilla(top, 'top') : boneTop ? paintBones(top, 'top', false, boneRes) : shellTop ? paintShell(top, 'top', detail < 1 ? 256 : 512) : paintTop({ ...top, number: look.number, name: look.name, keep: cut.keep, hem: cut.hem, neckTop: cut.neckTop, res: detail < 1 ? 256 : undefined }), { aniso: 8 });
    yield;
    const glowOf = (spec, k = 2.4) => (spec.glow ? M.hexLinear(spec.glow).map(v => v * k) : [0, 0, 0]);
    const jersey = top.family === 'jersey';
    const topMat = new Material({
      map: topTex, color: [0.86, 0.86, 0.86], roughness: jersey ? 0.6 : furTop ? 0.95 : shellTop ? 0.36 : 0.86, specular: shellTop ? 1.25 : 1, shading: 'cloth', sheen: jersey ? [0.22, 0.22, 0.22] : furTop ? [0.3, 0.26, 0.22] : shellTop ? [0.3, 0.3, 0.32] : [0.16, 0.16, 0.16],
      detailMap: jersey ? meshDetail : knitDetail, detail: jersey ? [34, 26, 0.45] : furTop ? [40, 30, 0.7] : shellTop ? [60, 46, 0.12] : [60, 46, 0.35], character: true, doubleSided: true, layer: 3,
      emissiveMap: mocapTop ? own(paintMocap(top, 'top', true), {}) : boneTop ? own(paintBones(top, 'top', true, boneRes), {}) : null, emissive: mocapTop ? glowOf(top) : boneTop ? boneGlow : [0, 0, 0],
    });
    const bot = look.bottom || { family: 'shorts' };
    const mocapBot = bot.pattern === 'mocap', furBot = bot.pattern === 'gorilla', shellBot = bot.pattern === 'shellsuit', boneBot = bot.pattern === 'bones';
    const botTex = own(mocapBot ? paintMocap(bot, 'bottom') : furBot ? paintGorilla(bot, 'bottom') : boneBot ? paintBones(bot, 'bottom', false, boneRes) : shellBot ? paintShell(bot, 'bottom', detail < 1 ? 256 : 512) : paintShorts(detail < 1 ? { ...bot, res: 256 } : bot), { aniso: 8 });
    yield;
    const botMat = new Material({ map: botTex, color: [0.86, 0.86, 0.86], roughness: furBot ? 0.95 : shellBot ? 0.36 : 0.62, specular: shellBot ? 1.25 : 1, shading: 'cloth', sheen: furBot ? [0.3, 0.26, 0.22] : shellBot ? [0.3, 0.3, 0.32] : [0.22, 0.22, 0.22], detailMap: bot.family === 'joggers' ? knitDetail : meshDetail, detail: furBot ? [40, 30, 0.7] : shellBot ? [30, 30, 0.12] : [30, 30, 0.35], character: true, doubleSided: true, layer: 2,
      emissiveMap: mocapBot ? own(paintMocap(bot, 'bottom', true), {}) : boneBot ? own(paintBones(bot, 'bottom', true, boneRes), {}) : null, emissive: mocapBot ? glowOf(bot) : boneBot ? boneGlow : [0, 0, 0] });
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
    const eyes = add(geo.eyes, eyeMat, 'eyes');
    let hair = null;
    if (geo.hair) {
      const hairTex = own(paintHair(look), { aniso: 4 });
      yield;
      const hairMat = new Material({ map: hairTex, color: [1, 1, 1], roughness: 0.62, specular: 0.7, shading: 'cloth', sheen: [0.1, 0.09, 0.08], alphaTest: 0.32, character: true });
      hair = add(geo.hair, hairMat, 'hair');
    }
    const topM = add(geo.top, topMat, 'top');
    // v0.4.7.5: the straps and top edge always on top of the skin (a few centimetres toward the camera)
    const straps = geo.straps ? add(geo.straps, new Material({ ...topMat, viewBias: 0.018 }), 'straps') : null; // (same options as the top)
    const botM = add(geo.bottom, botMat, 'bottom');
    add(geo.gear, gearMat, 'gear');
    // v0.4.8.5 quick patch: a terry-cloth band (the Neon Terry) is towelling: matte, fuzzy at the edges, a knit grain
    if (geo.terry) add(geo.terry, new Material({ color: [1, 1, 1], roughness: 0.96, specular: 0.25, shading: 'cloth', sheen: [0.32, 0.3, 0.3], detailMap: knitDetail, detail: [1, 1, 0.9], character: true, layer: 4 }), 'terry');
    // v0.4.8.5 quick patch 2: the Bone Suit's gloves (the same knit as the suit, the hand's bones glowing like the rest) and
    // the Jack-o'-Lantern band (waxy pumpkin skin; the carved face lit from inside, the candle flickering: update())
    if (geo.gloves) {
      const gk = 'boneglove:' + [top.color, top.trim, top.glow].join('|');
      add(geo.gloves, new Material({ map: sharedTex(ctx, gk, () => paintBoneGlove(top), { aniso: 8 }), emissiveMap: sharedTex(ctx, gk + ':e', () => paintBoneGlove(top, true), {}), emissive: boneGlow,
        color: [0.86, 0.86, 0.86], roughness: 0.86, specular: 1, shading: 'cloth', sheen: [0.16, 0.16, 0.16], detailMap: knitDetail, detail: [12, 12, 0.3], character: true, layer: 4 }), 'gloves');
    }
    this.lanternMat = null;
    if (geo.lantern) {
      const hb = look.gear?.headband || {}, lk = 'lantern:' + [hb.color, hb.glow].join('|');
      this.lanternMat = new Material({ map: sharedTex(ctx, lk, () => paintLantern(hb), { aniso: 8 }), emissiveMap: sharedTex(ctx, lk + ':e', () => paintLantern(hb, true), {}), emissive: [MONSTER_GLOW.candle, MONSTER_GLOW.candle, MONSTER_GLOW.candle],
        color: [1, 1, 1], roughness: 0.5, specular: 0.8, character: true, layer: 4 });
      add(geo.lantern, this.lanternMat, 'lantern');
    }
    if (geo.shoes) {
      // v0.4.3: textured sneakers (one texture per design, shared by everyone wearing it)
      const sh = look.gear?.shoes || {};
      const key = 'shoe:' + [sh.model, sh.color, sh.accent, sh.sole, sh.trim, sh.lace].join('|');
      const shoeTex = sharedTex(ctx, key, () => paintShoe(sh), { aniso: 8 });
      // (v0.4.8.5 quick patch 2: a shoe that glows in the dark has a glow map too: the Coffin Hi's slime and its skull's eyes)
      const shoeE = sh.model === 'coffin' ? sharedTex(ctx, key + ':e', () => paintShoeGlow(sh), {}) : null;
      add(geo.shoes, new Material({ map: shoeTex, color: [0.95, 0.95, 0.95], roughness: 0.48, specular: 0.65, character: true, layer: 5, emissiveMap: shoeE, emissive: shoeE ? [MONSTER_GLOW.slime, MONSTER_GLOW.slime, MONSTER_GLOW.slime] : [0, 0, 0] }), 'shoes');
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
    // v0.4.7.5 qp3 perf: the people around the park (everyone built below full detail: walkers, the background games,
    // the games you watch, the crowd) get a far model too. A park is sixty-odd people at 40-50 thousand triangles each,
    // drawn again for the shadows; from a court or two away nobody can tell a third of that. The far model is the body,
    // head, hair and clothes again at LOD_DETAIL, on the same bones with the same textures and materials; the renderer
    // draws one or the other by the distance from the camera (QUALITY lod). Shoes, gear and chains are the same meshes
    // for both, and the eyes aren't drawn from that far.
    if (opts.lod ?? detail < 1) {
      const k2 = detail >= 1 ? 2.25 : 1; // (full-detail players switch 1.5x as far out: lodK is squared)
      const lm = new AthleteModel(build, look, LOD_DETAIL), lg = {};
      lg.body = lm.buildBody(); yield;
      lg.head = lm.buildHead(); lg.hair = hair ? lm.buildHair() : null; yield;
      lg.top = lm.buildTop(top); lg.straps = straps ? lm.strapGeo : null; yield;
      lg.bottom = lm.buildBottom(bot);
      const far = (g, near) => { if (!g || !near) return; near.lod = 1; near.lodK = k2; const m = add(g, near.material, near.name + ':far'); m.lod = 2; m.lodK = k2; };
      far(lg.body, this.body); far(lg.head, this.head); far(lg.hair, hair); far(lg.top, topM); far(lg.straps, straps); far(lg.bottom, botM);
      if (eyes) { eyes.lod = 1; eyes.lodK = k2; }
      this.lod = true;
    }
    this.scene = null;
    this.visible = true;
  }

  addTo(scene) { this.scene = scene; for (const m of this.meshes) scene.add(m); return this; }
  removeFrom() { if (!this.scene) return; for (const m of this.meshes) this.scene.remove(m); this.scene = null; }
  setVisible(v) { this.visible = v; for (const m of this.meshes) m.visible = v; }
  setShadow(v) { for (const m of this.meshes) m.castShadow = v; }
  // v0.4.7.5 qp3 perf: left out of every pass (shadows included) while he's out of view and not being posed, so a pose
  // or a place from before never shows
  setCulled(c) { for (const m of this.meshes) m.culled = c; }

  // Solve pose and place in world
  update(pose, x, y, z, yaw, opts) {
    this.rig.solve(pose, opts);
    if (this.lanternMat) { // (v0.4.8.5 quick patch 2: the candle in the Jack-o'-Lantern band flickers)
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000, f = 1 + 0.11 * Math.sin(t * 11.3) + 0.07 * Math.sin(t * 23.9 + 1.3) + 0.05 * Math.sin(t * 37.7 + 2.1);
      this.lanternMat.emissive[0] = this.lanternMat.emissive[1] = this.lanternMat.emissive[2] = MONSTER_GLOW.candle * f;
    }
    if (opts?.flip) placeFlipped(this.world, x, y, z, yaw, opts.flip, (opts.flipY ?? 0.5) * this.H);
    else M.m4fromYaw(this.world, x, y, z, yaw);
    this.rig.updateSkin(this.world);
    const c = [x, y + this.H * 0.5, z];
    for (const m of this.meshes) { m.boundsOverride.center = c; }
  }

  // v0.4.7.5 qp3 perf: move him without posing him again (the people far away are posed every other frame, moved
  // every frame)
  move(x, y, z, yaw) {
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
