// Forward HDR renderer: shadow map, planar floor reflection, MSAA, bloom, ACES, particles.
// Owns Material, Mesh, Camera, Scene and the Renderer itself (one per canvas: main.js makes it; every mode's controller
// hands it a Scene and a Camera each frame through render()). gl.js is the resource layer under it, shaders.js the GLSL.
// (QOL+perf: the per-frame passes reuse their matrices, vectors and uniform arrays instead of allocating them, skip GL
// state that's already set, and the particles are written straight into their buffers.)
import { GLContext } from './gl.js';
import { STD_VS, STD_FS, SHADOW_VS, SHADOW_FS, FS_VS, SKY_FS, DOWN_FS, UP_FS, COMPOSITE_FS, PART_VS, PART_FS } from './shaders.js';
import * as M from '../core/math.js';
import { hypot3 } from './fastmath.js'; // (qp3: Math.hypot, without its per-call allocation)

let materialIds = 0;
export class Material {
  constructor(o = {}) {
    this.id = ++materialIds;
    this.color = o.color || [0.8, 0.8, 0.8];
    if (typeof this.color === 'string') this.color = M.hexLinear(this.color);
    this.opacity = o.opacity ?? 1;
    this.roughness = o.roughness ?? 0.6;
    this.metalness = o.metalness ?? 0;
    this.specular = o.specular ?? 1;
    this.emissive = o.emissive || [0, 0, 0];
    this.sheen = o.sheen || [0, 0, 0];
    this.map = o.map || null;
    this.normalMap = o.normalMap || null;
    this.normalScale = o.normalScale ?? 1;
    this.roughMap = o.roughMap || null;
    this.emissiveMap = o.emissiveMap || null;
    this.detailMap = o.detailMap || null;      // tiling micro normal map
    this.detail = o.detail || [16, 16, 0.6];   // [u scale, v scale, strength]
    this.uvScale = o.uvScale || [1, 1];
    this.uvOffset = o.uvOffset || [0, 0]; // v0.4.5: scrolling UVs (water, conveyors, banners)
    this.alphaTest = o.alphaTest ?? 0;
    this.blend = o.blend || null; // 'alpha' | 'add' | 'multiply'
    this.doubleSided = !!o.doubleSided;
    this.viewBias = o.viewBias || 0; // v0.4.7.5: drawn this many metres toward the camera (see STD_VS)
    this.layer = o.layer || 0; // v0.4.4: a small depth bias so worn layers win near-coplanar ties (skin 0 < shorts 2 < top 3 < gear worn over
    // clothes 4 < shoes/chain 5). The garments themselves are built with real clearance; this only breaks ties.
    this.shading = o.shading || 'std'; // std | skin | cloth | unlit
    this.floor = o.floor || null; // {overlay, rect:[x0,z0,1/w,1/d]}
    this.reflective = !!o.reflective;
    this.reflectStrength = o.reflectStrength ?? 0.6;
    this.character = !!o.character;
    this.crowd = !!o.crowd;
    this.depthWrite = o.depthWrite ?? !this.blend;
    this.depthTest = o.depthTest ?? true;
    this.fog = o.fog ?? true;
    // v0.4.5 quick patch: procedural fire (shaders.js FLAME): [brightness, wall height m, cells/m, cells round]
    // and [time s, seed, density, 0]
    this.flame = o.flame || null;
    this.flameT = o.flameT || [0, 0, 0, 0];
    // v0.4.7.5 qp3: rain streaks (shaders.js RAIN): [fall height m, speed m/s, slant x, slant z]
    this.rain = o.rain || null;
  }
  defines(ldr) {
    return {
      HAS_MAP: !!this.map, HAS_NORMALMAP: !!this.normalMap, HAS_RMAP: !!this.roughMap, HAS_EMAP: !!this.emissiveMap, HAS_DETAIL: !!this.detailMap,
      ALPHA_MASK: this.alphaTest > 0, ALPHA_BLEND: !!this.blend, UNLIT: this.shading === 'unlit' || !!this.flame, FLAME: !!this.flame, RAIN: !!this.rain,
      SKIN: this.shading === 'skin', CLOTH: this.shading === 'cloth', FLOOR: !!this.floor,
      REFLECTIVE: this.reflective, CHARACTER: this.character, CROWD: this.crowd, LDR: ldr,
    };
  }
}

export class Mesh {
  constructor(geo, material, o = {}) {
    this.geo = geo;
    this.material = material;
    this.matrix = o.matrix || M.m4();
    this.visible = true;
    this.castShadow = o.castShadow ?? true;
    this.reflect = o.reflect ?? true;
    this.bones = o.bones || null; // Float32Array(16*n) world skin matrices
    this.order = o.order || 0;
    this.cull = o.cull ?? true;
    this.name = o.name || '';
    this.boundsOverride = o.bounds || null; // {center:[x,y,z], radius}
  }
  worldSphere(out) {
    if (this.boundsOverride) { out[0] = this.boundsOverride.center[0]; out[1] = this.boundsOverride.center[1]; out[2] = this.boundsOverride.center[2]; out[3] = this.boundsOverride.radius; return out; }
    const b = this.geo.bounds, m = this.matrix, c = b.center;
    out[0] = m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12];
    out[1] = m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13];
    out[2] = m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14];
    const s = Math.max(hypot3(m[0], m[1], m[2]), hypot3(m[4], m[5], m[6]), hypot3(m[8], m[9], m[10]));
    out[3] = b.radius * s;
    return out;
  }
}

export class Camera {
  constructor() {
    this.pos = M.v3(0, 5, 10); this.target = M.v3(0, 1, 0); this.up = M.v3(0, 1, 0);
    this.fov = 45 * M.DEG; this.near = 0.1; this.far = 400;
    this.view = M.m4(); this.proj = M.m4(); this.viewProj = M.m4(); this.invViewProj = M.m4();
    this.aspect = 1;
  }
  update(aspect) {
    this.aspect = aspect;
    M.m4lookAt(this.view, this.pos, this.target, this.up);
    M.m4perspective(this.proj, this.fov, aspect, this.near, this.far);
    M.m4mul(this.viewProj, this.proj, this.view);
    M.m4invert(this.invViewProj, this.viewProj);
  }
}

export class Scene {
  constructor() {
    this.meshes = [];
    this.lights = []; // {pos:[x,y,z], range, color:[r,g,b], intensity, dir:[x,y,z]|null, cos}
    this.sun = { dir: [-0.4, 0.8, 0.3], color: [1, 0.95, 0.85], intensity: 3 };
    this.sky = { top: [0.1, 0.25, 0.6], horizon: [0.6, 0.7, 0.85], ground: [0.2, 0.2, 0.2], stars: 0 };
    this.ambient = { sky: [0.25, 0.3, 0.4], ground: [0.12, 0.1, 0.09] };
    this.env = null; this.envIntensity = 1;
    this.fog = { color: [0.5, 0.6, 0.7], density: 0.004 };
    this.shadowFocus = { center: [0, 0, 0], radius: 20 };
    this.reflectionPlane = false;
    this.exposure = 1;
    this.bloom = { strength: 0.06, threshold: 1.2, radius: 1 };
    this.grade = { saturation: 1.05, contrast: 1.04, vignette: 0.6 };
    this.hype = 0;
  }
  add(mesh) { this.meshes.push(mesh); return mesh; }
  remove(mesh) { const i = this.meshes.indexOf(mesh); if (i >= 0) this.meshes.splice(i, 1); }
}

// lod (v0.4.7.5 qp3 perf): past this many metres from the camera, people are drawn with their far model (a third of
// the triangles or less; see AthleteView). Side by side at 8-10 m nobody could tell them apart; the players in your
// own game switch half as far again out
export const QUALITY = {
  low: { scale: 0.75, dpr: 1, msaa: 0, shadow: 1024, bloom: false, reflections: false, fxaa: true, lod: 10, label: 'Performance' },
  medium: { scale: 1, dpr: 1, msaa: 4, shadow: 2048, bloom: true, reflections: false, fxaa: false, lod: 14, label: 'Balanced' },
  high: { scale: 1, dpr: 1.5, msaa: 4, shadow: 2048, bloom: true, reflections: true, fxaa: false, lod: 18, label: 'High' },
  ultra: { scale: 1, dpr: 2, msaa: 4, shadow: 4096, bloom: true, reflections: true, fxaa: false, lod: 26, label: 'Ultra' },
};

// (v0.4.8.6 RIMRIFT: the game's new name; the log kept before the rename is read until the new one is saved)
const PROGRAM_LOG = 'rimrift.programs.v1', OLD_PROGRAM_LOG = 'afterhours16.programs.v1';
const OPAQUE_ORDER = (a, b) => (a.order - b.order) || (a.material.alphaTest - b.material.alphaTest) || (a.material.id - b.material.id);
const CASTS_SHADOW = m => m.castShadow;
const REFLECTS = m => m.reflect && !m.material.floor;

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.ctx = new GLContext(canvas);
    this.gl = this.ctx.gl;
    this.canvas = canvas;
    this.ldr = !this.ctx.floatRT;
    this.time = 0;
    this.frame = 0;
    this.flash = 0; this.flashColor = [1, 1, 1]; this.desat = 0;
    this.shadowMat = M.m4();
    this.tmpSphere = new Float32Array(4);
    this.planes = new Float32Array(24);
    this.lightPos = new Float32Array(32); this.lightColor = new Float32Array(32); this.lightDir = new Float32Array(32);
    // per-frame scratch (frameUniforms, shadowPass, reflectionPass, post)
    this._sunColor = new Float32Array(3); this._shadowTexel = new Float32Array(2); this._viewport = new Float32Array(2);
    this._texel = new Float32Array(2);
    this._sdir = M.v3(); this._scenter = M.v3(); this._seye = M.v3(); this._sview = M.m4(); this._sproj = M.m4(); this.lightViewProj = M.m4();
    this._rR = M.m4(); this._rview = M.m4(); this.reflViewProj = M.m4(); this.reflCamPos = M.v3();
    this.emptyVAO = this.gl.createVertexArray();
    this.particles = new Particles(this.ctx);
    // 1x1 fallback env
    this.defaultEnv = this.ctx.texture({ width: 1, height: 1, data: new Uint8Array([90, 100, 120, 255]) }, { mipmaps: false });
    this.blackTex = this.ctx.texture({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }, { mipmaps: false });
    this.setQuality(quality);
    // v0.4.5 stage 7: remember every shader variant the game has needed, and start compiling them all in the
    // background at the next launch, so they're ready long before they first show up on screen
    this.known = new Map();
    try { for (const e of JSON.parse(localStorage.getItem(PROGRAM_LOG) ?? localStorage.getItem(OLD_PROGRAM_LOG) ?? '[]')) this.known.set(GLContext.key(e.n, e.d), e); } catch { /* private mode */ }
    this.ctx.onNewProgram = (name, defines, key) => {
      if ((name !== 'std' && name !== 'shadow') || this.known.has(key)) return;
      this.known.set(key, { n: name, d: defines });
      clearTimeout(this.knownSave);
      this.knownSave = setTimeout(() => { try { localStorage.setItem(PROGRAM_LOG, JSON.stringify([...this.known.values()].slice(-400))); } catch { /* ignore */ } }, 2000);
    };
    if (this.ctx.parallel) for (const e of this.known.values()) { try { this.ctx.program(e.n, e.n === 'std' ? STD_VS : SHADOW_VS, e.n === 'std' ? STD_FS : SHADOW_FS, e.d, { async: true }); } catch { /* stale entry */ } }
  }

  // v0.4.5 stage 7: start compiling every shader a scene will need (while its loading message is up), instead
  // of on the frame each mesh first comes into view
  prewarm(scene) {
    for (const mesh of scene.meshes) {
      try {
        this.programFor(mesh, 'main');
        if (mesh.castShadow) this.programFor(mesh, 'shadow');
        if (mesh.reflect && !mesh.material.floor) this.programFor(mesh, 'reflect');
      } catch (e) { console.warn('prewarm', e.message); }
    }
  }

  setQuality(name) {
    this.qualityName = QUALITY[name] ? name : 'high';
    this.q = { ...QUALITY[this.qualityName] };
    if (this.ldr) { this.q.bloom = false; this.q.msaa = 0; this.q.reflections = false; this.q.fxaa = false; }
    this.q.msaa = Math.min(this.q.msaa, this.ctx.maxSamples);
    this.ctx.disposeTarget(this.shadowRT);
    this.shadowRT = this.ctx.target(this.q.shadow, this.q.shadow, { color: false, depth: 'shadow' });
    if (!this.shadowRT.complete) { this.ctx.disposeTarget(this.shadowRT); this.shadowRT = null; }
    this.w = 0; // force resize
  }

  // ---- v0.4.7.5 qp3 perf: an online game keeps its frame rate ----
  // In lockstep everyone waits on the slowest screen, so a PC whose frames run slow (the slowest one in ten over a
  // second past 22 ms) draws a little lighter, a step a second: the far models first (lodScale), then the picture at a
  // lower resolution, down to 60% of the preset's. Once its frames are quick again for four seconds it goes back up
  // the same way, and every game starts from the preset (resetGovern). Returns true on the first step down.
  govern(dt) {
    const g = this.gov || (this.gov = { f: [], fast: 0, level: 0, told: false });
    g.f.push(dt * 1000);
    if (g.f.length < 60) return false;
    const s = g.f.sort((a, b) => a - b), p90 = s[Math.floor(s.length * 0.9)];
    g.f = [];
    if (p90 > 22 && g.level < 5) { g.level++; g.fast = 0; this.applyGovern(); if (!g.told) { g.told = true; return true; } }
    else if (p90 < 15 && g.level > 0) { if (++g.fast >= 4) { g.level--; g.fast = 0; this.applyGovern(); } }
    else g.fast = 0;
    return false;
  }
  applyGovern() {
    const L = this.gov?.level || 0;
    this.lodScale = L >= 1 ? 0.6 : 1;
    const sc = [1, 1, 0.85, 0.75, 0.66, 0.6][L];
    if (sc !== (this.dynScale || 1)) { this.dynScale = sc; this.w = 0; } // (the targets are made again at the new size)
  }
  resetGovern() { this.gov = null; this.applyGovern(); }

  // Can half-float textures generate mipmaps here? (some drivers refuse)
  floatMips() {
    if (this._floatMips != null) return this._floatMips;
    const gl = this.gl;
    // mip generation needs a colour-renderable format; without the extension skip the probe (it only logs a warning)
    if (!gl.getExtension('EXT_color_buffer_float')) return (this._floatMips = false);
    while (gl.getError()) { /* clear */ }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 3, gl.RGBA16F, 4, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._floatMips = gl.getError() === 0;
    gl.deleteTexture(t);
    this.ctx.forgetTextures();
    return this._floatMips;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    const cw = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), ch = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (cw === this.w && ch === this.h) return;
    this.w = cw; this.h = ch;
    this.canvas.width = cw; this.canvas.height = ch;
    const sc = this.q.scale * (this.dynScale || 1); // (qp3 perf: govern() lowers it in an online game running slow)
    const iw = Math.max(1, Math.floor(cw * sc)), ih = Math.max(1, Math.floor(ch * sc));
    this.iw = iw; this.ih = ih;
    const c = this.ctx;
    for (const rt of [this.mainRT, this.msaaRT, this.reflRT, ...(this.bloomRTs || [])]) c.disposeTarget(rt);
    this.mainRT = this.msaaRT = this.reflRT = null; this.bloomRTs = [];
    if (this.ldr) return;
    this.mainRT = c.target(iw, ih, { float: true, depth: 'rb' });
    if (this.q.msaa > 0) {
      this.msaaRT = c.target(iw, ih, { float: true, samples: this.q.msaa });
      if (!this.msaaRT.complete) { c.disposeTarget(this.msaaRT); this.msaaRT = null; }
    }
    if (this.q.reflections) this.reflRT = c.target(Math.floor(iw / 2), Math.floor(ih / 2), { float: this.floatMips(), depth: 'rb', mipmaps: true });
    if (this.q.bloom) {
      let w = Math.floor(iw / 2), h = Math.floor(ih / 2);
      for (let i = 0; i < 6 && w > 4 && h > 4; i++) { this.bloomRTs.push(c.target(w, h, { float: true })); w = Math.floor(w / 2); h = Math.floor(h / 2); }
    }
  }

  // v0.4.5 stage 7: the program for each pass is cached on the mesh (building the define set and the program
  // key for every mesh, every pass, every frame made a lot of garbage, and the collector pauses showed up as
  // hitches). Programs compile asynchronously where the browser allows it: null means "not ready, skip it".
  programFor(mesh, pass) {
    const m = mesh.material;
    let pc = mesh._pc;
    if (!pc || pc.mat !== m || pc.ldr !== this.ldr || m._defsDirty || pc.geo !== mesh.geo || pc.skinned !== !!mesh.bones) {
      pc = mesh._pc = { mat: m, ldr: this.ldr, geo: mesh.geo, skinned: !!mesh.bones, main: null, reflect: null, shadow: null };
    }
    const hit = pc[pass];
    if (hit) return hit;
    const p = this.buildProgram(mesh, pass);
    if (p) pc[pass] = p;
    return p;
  }
  buildProgram(mesh, pass) {
    const m = mesh.material;
    const skinned = !!mesh.bones, inst = mesh.geo.instanceCount > 0;
    if (pass === 'shadow') {
      return this.ctx.program('shadow', SHADOW_VS, SHADOW_FS, { SKINNED: skinned, MAX_BONES: skinned ? 24 : false, INSTANCED: inst, ALPHA_MASK: m.alphaTest > 0 && !!m.map }, { async: true });
    }
    if (!m._defs || m._defsDirty) { m._defs = m.defines(this.ldr); m._defsDirty = false; }
    const defs = Object.assign({}, m._defs, { SKINNED: skinned, MAX_BONES: skinned ? 24 : false, INSTANCED: inst });
    if (pass === 'reflect') defs.REFLECTIVE = false;
    return this.ctx.program('std', STD_VS, STD_FS, defs, { async: true });
  }

  // Texture units are shared between programs, so frame textures are re-bound on every program switch.
  frameTextures(p, scene, pass) {
    if (pass === 'shadow') return;
    const c = this.ctx;
    c.set(p, 'uEnvMap', scene.env || this.defaultEnv);
    c.set(p, 'uShadowMap', this.shadowRT ? this.shadowRT.depth : null);
    if (p.uniforms.uReflection) c.set(p, 'uReflection', this.reflRT && scene.reflectionPlane && pass === 'main' ? this.reflRT.color : this.blackTex);
  }

  frameUniforms(p, scene, cam, pass) {
    this.frameTextures(p, scene, pass);
    if (p.frame === this.passStamp) return;
    p.frame = this.passStamp;
    const c = this.ctx;
    c.set(p, 'uViewProj', pass === 'reflect' ? this.reflViewProj : pass === 'shadow' ? this.lightViewProj : cam.viewProj);
    if (pass === 'shadow') return;
    c.set(p, 'uCamPos', pass === 'reflect' ? this.reflCamPos : cam.pos);
    const s = scene.sun, sc = this._sunColor;
    c.set(p, 'uSunDir', s.dir);
    sc[0] = s.color[0] * s.intensity; sc[1] = s.color[1] * s.intensity; sc[2] = s.color[2] * s.intensity;
    c.set(p, 'uSunColor', sc);
    c.set(p, 'uSkyColor', scene.ambient.sky);
    c.set(p, 'uGroundColor', scene.ambient.ground);
    c.set(p, 'uEnvIntensity', scene.envIntensity);
    c.set(p, 'uShadowOn', this.shadowRT && this.shadowReady ? 1 : 0);
    c.set(p, 'uShadowMat', this.shadowMat);
    this._shadowTexel[0] = this._shadowTexel[1] = 1 / this.q.shadow;
    c.set(p, 'uShadowTexel', this._shadowTexel);
    c.set(p, 'uLightPos', this.lightPos);
    c.set(p, 'uLightColor', this.lightColor);
    c.set(p, 'uLightDir', this.lightDir);
    c.set(p, 'uLightCount', this.lightCount);
    c.set(p, 'uFogColor', scene.fog.color);
    c.set(p, 'uExposure', scene.exposure);
    c.set(p, 'uTime', this.time);
    c.set(p, 'uHype', scene.hype || 0);
    c.set(p, 'uCrowd', scene.crowdFx || NO_CROWD);
    c.set(p, 'uClipY', pass === 'reflect' ? -0.001 : -1e9);
    this._viewport[0] = this.iw; this._viewport[1] = this.ih;
    c.set(p, 'uViewport', this._viewport);
  }

  materialUniforms(p, m, pass) {
    const c = this.ctx;
    if (pass === 'shadow') {
      c.set(p, 'uViewBias', 0);
      if (m.alphaTest > 0 && m.map) { c.set(p, 'uMap', m.map); c.set(p, 'uAlphaTest', m.alphaTest); c.set(p, 'uUVScale', m.uvScale); c.set(p, 'uUVOffset', m.uvOffset); }
      return;
    }
    c.set(p, 'uViewBias', m.viewBias || 0);
    c.set(p, 'uBaseColor', m.color);
    c.set(p, 'uOpacity', m.opacity);
    c.set(p, 'uRoughness', m.roughness);
    c.set(p, 'uMetalness', m.metalness);
    c.set(p, 'uSpecular', m.specular);
    c.set(p, 'uEmissive', m.emissive);
    c.set(p, 'uSheen', m.sheen);
    c.set(p, 'uUVScale', m.uvScale);
    c.set(p, 'uUVOffset', m.uvOffset);
    c.set(p, 'uAlphaTest', m.alphaTest);
    if (m.map) c.set(p, 'uMap', m.map);
    if (m.normalMap) { c.set(p, 'uNormalMap', m.normalMap); c.set(p, 'uNormalScale', m.normalScale); }
    if (m.roughMap) c.set(p, 'uRoughMap', m.roughMap);
    if (m.emissiveMap) c.set(p, 'uEmissiveMap', m.emissiveMap);
    if (m.detailMap) { c.set(p, 'uDetailMap', m.detailMap); c.set(p, 'uDetail', m.detail); }
    if (m.floor) { c.set(p, 'uOverlay', m.floor.overlay); c.set(p, 'uOverlayRect', m.floor.rect); c.set(p, 'uFloorTile', m.floor.tile || ONE_TILE); c.set(p, 'uFloorSwap', m.floor.swap ? 1 : 0); }
    if (m.reflective) c.set(p, 'uReflectStrength', this.reflRT && this.reflOn ? m.reflectStrength : 0);
    c.set(p, 'uFogDensity', m.fog ? this.fogDensity : 0);
    if (m.flame) { c.set(p, 'uFlame', m.flame); c.set(p, 'uFlameT', m.flameT); }
    if (m.rain) c.set(p, 'uRain', m.rain);
  }

  // (the blend mode, depth mask and depth test are set only when a material changes them: null is "not set yet in
  // this list", so the first material always sets all three)
  drawList(list, scene, cam, pass) {
    const gl = this.gl, c = this.ctx;
    let lastMat = null, lastProg = null, cullState = null, layerState = 0, blendState = null, maskState = null, testState = null;
    for (const mesh of list) {
      const m = mesh.material;
      const p = this.programFor(mesh, pass);
      if (!p) continue; // still compiling: it shows up in a frame or two instead of stalling this one
      c.use(p);
      if (p !== lastProg) { this.frameUniforms(p, scene, cam, pass); lastProg = p; lastMat = null; }
      if (m !== lastMat) {
        this.materialUniforms(p, m, pass);
        if (pass !== 'shadow') {
          const bm = m.blend || 'none';
          if (bm !== blendState) {
            if (bm === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
            else if (bm === 'multiply') { gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO); }
            else if (bm !== 'none') { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
            else gl.disable(gl.BLEND);
            blendState = bm;
          }
          if (m.depthWrite !== maskState) { gl.depthMask(m.depthWrite); maskState = m.depthWrite; }
          if (m.depthTest !== testState) { if (m.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST); testState = m.depthTest; }
        }
        const wantCull = !m.doubleSided;
        if (wantCull !== cullState) { wantCull ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE); cullState = wantCull; }
        if (pass !== 'shadow') {
          const layer = m.layer || 0;
          if (layer !== layerState) { if (layer) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-0.2 * layer, -1.5 * layer); } else gl.disable(gl.POLYGON_OFFSET_FILL); layerState = layer; }
        }
        lastMat = m;
      }
      // (v0.4.8.9 qp15 perf: a program keeps its uniforms, so the model matrix and the bone palette go up only when this
      // program last had different ones this frame. A person is a dozen meshes on one skeleton: his 24-bone palette
      // used to go up once a mesh, every pass, 300 kB a frame in a park; now once a skeleton per program and frame.
      // Nothing writes a palette or a matrix while a frame is drawn: the scene's updates all run before render)
      const st = this.renderStamp, model = mesh.bones ? IDENTITY : mesh.matrix, um = p.uniforms.uModel;
      if (um && (um.lastRef !== model || um.lastStamp !== st)) { c.set(p, 'uModel', model); um.lastRef = model; um.lastStamp = st; }
      if (mesh.bones) { const ub = p.uniforms.uBones; if (ub && (ub.lastRef !== mesh.bones || ub.lastStamp !== st)) { c.set(p, 'uBones', mesh.bones); ub.lastRef = mesh.bones; ub.lastStamp = st; } }
      c.draw(mesh.geo);
    }
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    if (layerState && pass !== 'shadow') gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  // v0.4.5 stage 7: one reusable pair of lists per pass (no fresh arrays every pass, every frame)
  collect(scene, viewProj, filter, slot = 'main') {
    M.frustumPlanes(this.planes, viewProj);
    const lists = (this._lists || (this._lists = {}))[slot] || (this._lists[slot] = { opaque: [], blend: [] });
    const opaque = lists.opaque, blend = lists.blend;
    opaque.length = 0; blend.length = 0;
    const s = this.tmpSphere;
    // (qp3 perf: a mesh with lod 1 is the near model, lod 2 the far one, by the distance from the camera: every pass
    // picks the same one)
    const eye = this.lodEye, far = (this.q.lod || 25) * (this.lodScale || 1), far2 = far * far;
    for (const mesh of scene.meshes) {
      if (!mesh.visible || mesh.culled || (filter && !filter(mesh))) continue; // (culled: out of the camera's view, not posed)
      if (mesh.lod && eye) {
        const c = mesh.boundsOverride ? mesh.boundsOverride.center : null;
        if (c) { const dx = c[0] - eye[0], dy = c[1] - eye[1], dz = c[2] - eye[2]; if ((dx * dx + dy * dy + dz * dz > far2 * (mesh.lodK || 1)) === (mesh.lod === 1)) continue; }
      }
      if (mesh.cull) { mesh.worldSphere(s); if (!M.sphereInFrustum(this.planes, s[0], s[1], s[2], s[3])) continue; }
      (mesh.material.blend ? blend : opaque).push(mesh);
    }
    opaque.sort(OPAQUE_ORDER);
    return lists;
  }

  sortBlend(list, cam) {
    const s = this.tmpSphere;
    for (const m of list) { m.worldSphere(s); m._dist = (s[0] - cam.pos[0]) ** 2 + (s[1] - cam.pos[1]) ** 2 + (s[2] - cam.pos[2]) ** 2; }
    list.sort((a, b) => (a.order - b.order) || (b._dist - a._dist));
  }

  shadowPass(scene) {
    this.shadowReady = false;
    if (!this.shadowRT) return;
    const gl = this.gl, f = scene.shadowFocus, d = M.v3norm(this._sdir, scene.sun.dir);
    const r = f.radius;
    const center = this._scenter; center[0] = f.center[0]; center[1] = f.center[1]; center[2] = f.center[2];
    const eye = this._seye; eye[0] = center[0] + d[0] * 60; eye[1] = center[1] + d[1] * 60; eye[2] = center[2] + d[2] * 60;
    const view = M.m4lookAt(this._sview, eye, center, Math.abs(d[1]) > 0.99 ? UP_Z : UP_Y);
    // Texel snapping to avoid shimmering
    const texel = (2 * r) / this.q.shadow;
    view[12] = Math.round(view[12] / texel) * texel;
    view[13] = Math.round(view[13] / texel) * texel;
    const proj = M.m4ortho(this._sproj, -r, r, -r, r, 1, 140);
    M.m4mul(this.lightViewProj, proj, view);
    M.m4copy(this.shadowMat, this.lightViewProj);
    this.ctx.bindTarget(this.shadowRT);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 2.0);
    const { opaque } = this.collect(scene, this.lightViewProj, CASTS_SHADOW, 'shadow');
    this.passStamp = ++this.frame * 4 + 1;
    this.drawList(opaque, scene, null, 'shadow');
    gl.disable(gl.POLYGON_OFFSET_FILL);
    this.shadowReady = true;
  }

  reflectionPass(scene, cam) {
    if (!this.reflRT || !scene.reflectionPlane) return;
    const gl = this.gl;
    const R = this._rR; R[5] = -1; // (the identity with y mirrored: set in the constructor's m4(), only [5] changes)
    const view = M.m4mul(this._rview, cam.view, R);
    M.m4mul(this.reflViewProj, cam.proj, view);
    const rc = this.reflCamPos; rc[0] = cam.pos[0]; rc[1] = -cam.pos[1]; rc[2] = cam.pos[2];
    this.ctx.bindTarget(this.reflRT);
    gl.clearColor(scene.fog.color[0] * 0.5, scene.fog.color[1] * 0.5, scene.fog.color[2] * 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.frontFace(gl.CW);
    const { opaque, blend } = this.collect(scene, this.reflViewProj, REFLECTS, 'reflect');
    this.passStamp = this.frame * 4 + 2;
    this.drawList(opaque, scene, cam, 'reflect');
    this.sortBlend(blend, cam);
    this.drawList(blend, scene, cam, 'reflect');
    gl.frontFace(gl.CCW);
    this.ctx.bindTex(0, this.reflRT.color);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  drawSky(scene, cam) {
    const gl = this.gl, c = this.ctx;
    const p = c.program('sky', FS_VS, SKY_FS);
    c.use(p);
    c.set(p, 'uInvViewProj', cam.invViewProj);
    c.set(p, 'uCamPos', cam.pos);
    c.set(p, 'uSkyTop', scene.sky.top); c.set(p, 'uSkyHorizon', scene.sky.horizon); c.set(p, 'uSkyGround', scene.sky.ground);
    c.set(p, 'uSunDir', scene.sun.dir); c.set(p, 'uSunColor', scene.sun.color);
    c.set(p, 'uStars', scene.sky.stars || 0); c.set(p, 'uTime', this.time);
    c.set(p, 'uExposure', scene.exposure); c.set(p, 'uLDR', this.ldr ? 1 : 0);
    gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
  }

  render(scene, cam, dt = 1 / 60) {
    const gl = this.gl, c = this.ctx;
    if (c.lost) return;
    this.renderStamp = (this.renderStamp || 0) + 1; // (qp15: drawList's uniform reuse is good for this frame only)
    this.resize();
    this.time += dt;
    c.stats.draws = 0; c.stats.tris = 0;
    cam.update(this.w / this.h);
    this.lodEye = cam.pos;
    // lights
    this.fogDensity = scene.fog.density;
    this.lightCount = Math.min(8, scene.lights.length);
    const lp = this.lightPos, lc = this.lightColor, ld = this.lightDir;
    for (let i = 0; i < this.lightCount; i++) {
      const L = scene.lights[i], o = i * 4;
      lp[o] = L.pos[0]; lp[o + 1] = L.pos[1]; lp[o + 2] = L.pos[2]; lp[o + 3] = L.range;
      lc[o] = L.color[0]; lc[o + 1] = L.color[1]; lc[o + 2] = L.color[2]; lc[o + 3] = L.intensity;
      if (L.dir) { ld[o] = L.dir[0]; ld[o + 1] = L.dir[1]; ld[o + 2] = L.dir[2]; ld[o + 3] = L.cos ?? 0.5; }
      else { ld[o] = 0; ld[o + 1] = -1; ld[o + 2] = 0; ld[o + 3] = -2; }
    }
    this.reflOn = !!scene.reflectionPlane;
    this.shadowPass(scene);
    this.frame++;
    if (!this.ldr) this.reflectionPass(scene, cam);
    const target = this.ldr ? null : (this.msaaRT || this.mainRT);
    if (target) c.bindTarget(target); else c.bindTarget(null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawSky(scene, cam);
    const { opaque, blend } = this.collect(scene, cam.viewProj);
    this.passStamp = this.frame * 4 + 3;
    this.drawList(opaque, scene, cam, 'main');
    this.sortBlend(blend, cam);
    this.drawList(blend, scene, cam, 'main');
    this.particles.draw(cam, dt);
    if (this.ldr) return;
    if (this.msaaRT) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaRT.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.mainRT.fb);
      gl.blitFramebuffer(0, 0, this.iw, this.ih, 0, 0, this.iw, this.ih, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    this.post(scene);
  }

  post(scene) {
    const gl = this.gl, c = this.ctx;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.bindVertexArray(this.emptyVAO);
    const bl = this.bloomRTs;
    if (this.q.bloom && bl.length) {
      const pd = c.program('down', FS_VS, DOWN_FS);
      c.use(pd);
      let src = this.mainRT;
      for (let i = 0; i < bl.length; i++) {
        c.bindTarget(bl[i]);
        c.set(pd, 'uSrc', src.color);
        c.set(pd, 'uTexel', texelOf(src));
        c.set(pd, 'uPrefilter', i === 0 ? 1 : 0);
        c.set(pd, 'uThreshold', scene.bloom.threshold);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = bl[i];
      }
      const pu = c.program('up', FS_VS, UP_FS);
      c.use(pu);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = bl.length - 1; i > 0; i--) {
        c.bindTarget(bl[i - 1]);
        c.set(pu, 'uSrc', bl[i].color);
        c.set(pu, 'uTexel', texelOf(bl[i]));
        c.set(pu, 'uRadius', scene.bloom.radius);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }
    c.bindTarget(null);
    const pc = c.program('composite', FS_VS, COMPOSITE_FS);
    c.use(pc);
    c.set(pc, 'uScene', this.mainRT.color);
    c.set(pc, 'uBloom', bl.length ? bl[0].color : this.mainRT.color);
    c.set(pc, 'uBloomStrength', this.q.bloom && bl.length ? scene.bloom.strength : 0);
    c.set(pc, 'uExposure', scene.exposure);
    c.set(pc, 'uVignette', scene.grade.vignette);
    c.set(pc, 'uSaturation', scene.grade.saturation);
    c.set(pc, 'uContrast', scene.grade.contrast);
    c.set(pc, 'uTime', this.time % 100);
    c.set(pc, 'uFlash', this.flash);
    c.set(pc, 'uFlashColor', this.flashColor);
    c.set(pc, 'uDesat', this.desat);
    this._texel[0] = 1 / this.iw; this._texel[1] = 1 / this.ih;
    c.set(pc, 'uTexel', this._texel);
    c.set(pc, 'uFXAA', this.q.fxaa ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    // unbind post textures so no render target stays attached to a sampler (feedback loops)
    for (let i = 0; i < 4; i++) c.bindTex(i, null);
  }

  // World → CSS pixel coordinates of the canvas
  project(cam, p, out = {}) {
    const m = cam.viewProj, x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    out.visible = w > 0.05;
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    out.x = (nx * 0.5 + 0.5) * this.canvas.clientWidth;
    out.y = (1 - (ny * 0.5 + 0.5)) * this.canvas.clientHeight;
    out.depth = w;
    return out;
  }
}
const IDENTITY = M.m4();
const NO_CROWD = new Float32Array([0, 0, 1.6, 0]), ONE_TILE = new Float32Array([1, 1]);
const UP_Y = [0, 1, 0], UP_Z = [0, 0, 1];
// a render target's texel size, kept on it (its size never changes: resize() makes new targets)
const texelOf = rt => rt._texel || (rt._texel = new Float32Array([1 / rt.w, 1 / rt.h]));

// Simple CPU particle system rendered as additive billboards (two triangles a particle, corners in the normal's xy)
const CORNER_X = [-1, 1, 1, -1, 1, -1], CORNER_Y = [-1, -1, 1, -1, 1, 1];
class Particles {
  constructor(ctx) {
    this.ctx = ctx;
    this.max = 3000; // (v0.4.7.5: green release effects)
    // the live particles are list[start ..], oldest first (qp3: at the cap the oldest is dropped by moving `start` on,
    // not by shifting the whole array; draw() packs the list back to start at 0 every frame)
    this.list = [];
    this.start = 0;
    this.pos = new Float32Array(this.max * 18);
    this.nrm = new Float32Array(this.max * 18);
    this.col = new Float32Array(this.max * 24);
    this.geo = null;
  }
  emit(o) {
    // (v0.4.7.5: grow scales the size over the life, -1 shrinks to nothing; flick twinkles it at that rate)
    // hold: full brightness until the last fifth of its life (a shape an effect moves around itself)
    return this.add(o.x, o.y, o.z, o.vx || 0, o.vy || 0, o.vz || 0, o.life || 1, o.size || 0.05, o.color || [1, 1, 1], o.gravity ?? 0, o.drag ?? 0.5, o.fade ?? 1, o.grow || 0, o.flick || 0, !!o.hold);
  }
  add(x, y, z, vx, vy, vz, life, size, color, g, drag, fade, grow, flick, hold) {
    if (this.list.length - this.start >= this.max) this.list[this.start++] = null; // (full: the oldest goes)
    const q = { x, y, z, vx, vy, vz, life, age: 0, size, color, g, drag, fade, grow, flick, ph: Math.random() * 6.3, hold };
    this.list.push(q);
    return q;
  }
  burst(x, y, z, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI, sp = (o.speed || 2) * (0.4 + Math.random() * 0.8);
      // (straight to add(): the same particle emit() would make from these, without the options object in between)
      this.add(x, y, z, Math.cos(a) * Math.cos(e) * sp || 0, Math.sin(e) * sp + (o.up || 0) || 0, Math.sin(a) * Math.cos(e) * sp || 0, (o.life || 0.8) * (0.6 + Math.random() * 0.6) || 1, (o.size || 0.04) * (0.6 + Math.random() * 0.8) || 0.05, o.color || [1, 1, 1], o.gravity ?? -4, o.drag ?? 1.2, 1, 0, 0, false);
    }
  }
  draw(cam, dt) {
    if (this.preDraw) this.preDraw(dt); // (v0.4.7.5: the green release effects schedule their particles here)
    if (this.list.length === this.start) { if (this.start) { this.list.length = 0; this.start = 0; } return; }
    const gl = this.ctx.gl, c = this.ctx;
    const list = this.list, pos = this.pos, nrm = this.nrm, col = this.col, start = this.start;
    let n = 0, dead = 0;
    // (newest first, as always; the expired ones are dropped in one pass afterwards, keeping the order of the rest)
    for (let i = list.length - 1; i >= start; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) { dead++; continue; }
      p.vy += p.g * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.age / p.life, a = (p.hold ? Math.min(1, (1 - t) * 5, p.age * 20) : 1 - t) * p.fade * (p.flick ? 0.55 + 0.45 * Math.sin(p.age * p.flick * 6.283 + p.ph) : 1);
      const size = p.size * Math.max(0, 1 + p.grow * t);
      const pc = p.color;
      for (let j = 0; j < 6; j++) {
        const v3 = (n * 6 + j) * 3, v4 = (n * 6 + j) * 4;
        pos[v3] = p.x; pos[v3 + 1] = p.y; pos[v3 + 2] = p.z;
        nrm[v3] = CORNER_X[j]; nrm[v3 + 1] = CORNER_Y[j]; nrm[v3 + 2] = size;
        col[v4] = pc[0]; col[v4 + 1] = pc[1]; col[v4 + 2] = pc[2]; col[v4 + 3] = a;
      }
      n++;
    }
    if (dead || start) { let w = 0; for (let i = start; i < list.length; i++) { const p = list[i]; if (p.age < p.life) list[w++] = p; } list.length = w; this.start = 0; }
    if (!n) return;
    if (!this.geo) {
      this.geo = c.geometry({ position: this.pos, normal: this.nrm, color: this.col }, true);
    } else {
      c.updateAttribute(this.geo, 'position', this.pos.subarray(0, n * 18));
      c.updateAttribute(this.geo, 'normal', this.nrm.subarray(0, n * 18));
      c.updateAttribute(this.geo, 'color', this.col.subarray(0, n * 24));
    }
    this.geo.count = n * 6;
    const p = c.program('particles', PART_VS, PART_FS);
    c.use(p);
    const v = cam.view, cr = this._right || (this._right = new Float32Array(3)), cu = this._up || (this._up = new Float32Array(3));
    cr[0] = v[0]; cr[1] = v[4]; cr[2] = v[8]; cu[0] = v[1]; cu[1] = v[5]; cu[2] = v[9];
    c.set(p, 'uViewProj', cam.viewProj);
    c.set(p, 'uCamRight', cr);
    c.set(p, 'uCamUp', cu);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    c.draw(this.geo);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }
}
