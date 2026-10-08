// Forward HDR renderer: shadow map, planar floor reflection, MSAA, bloom, ACES, particles.
import { GLContext } from './gl.js';
import { STD_VS, STD_FS, SHADOW_VS, SHADOW_FS, FS_VS, SKY_FS, DOWN_FS, UP_FS, COMPOSITE_FS, PART_VS, PART_FS } from './shaders.js';
import * as M from '../core/math.js';

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
  }
  defines(ldr) {
    return {
      HAS_MAP: !!this.map, HAS_NORMALMAP: !!this.normalMap, HAS_RMAP: !!this.roughMap, HAS_EMAP: !!this.emissiveMap, HAS_DETAIL: !!this.detailMap,
      ALPHA_MASK: this.alphaTest > 0, ALPHA_BLEND: !!this.blend, UNLIT: this.shading === 'unlit',
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
    const s = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
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

export const QUALITY = {
  low: { scale: 0.75, dpr: 1, msaa: 0, shadow: 1024, bloom: false, reflections: false, fxaa: true, label: 'Performance' },
  medium: { scale: 1, dpr: 1, msaa: 4, shadow: 2048, bloom: true, reflections: false, fxaa: false, label: 'Balanced' },
  high: { scale: 1, dpr: 1.5, msaa: 4, shadow: 2048, bloom: true, reflections: true, fxaa: false, label: 'High' },
  ultra: { scale: 1, dpr: 2, msaa: 4, shadow: 4096, bloom: true, reflections: true, fxaa: false, label: 'Ultra' },
};

const PROGRAM_LOG = 'afterhours16.programs.v1';
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
    this.emptyVAO = this.gl.createVertexArray();
    this.particles = new Particles(this.ctx);
    // 1x1 fallback env
    this.defaultEnv = this.ctx.texture({ width: 1, height: 1, data: new Uint8Array([90, 100, 120, 255]) }, { mipmaps: false });
    this.blackTex = this.ctx.texture({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }, { mipmaps: false });
    this.setQuality(quality);
    // v0.4.5 stage 7: remember every shader variant the game has needed, and start compiling them all in the
    // background at the next launch, so they're ready long before they first show up on screen
    this.known = new Map();
    try { for (const e of JSON.parse(localStorage.getItem(PROGRAM_LOG) || '[]')) this.known.set(GLContext.key(e.n, e.d), e); } catch { /* private mode */ }
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
    return this._floatMips;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    const cw = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), ch = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (cw === this.w && ch === this.h) return;
    this.w = cw; this.h = ch;
    this.canvas.width = cw; this.canvas.height = ch;
    const iw = Math.max(1, Math.floor(cw * this.q.scale)), ih = Math.max(1, Math.floor(ch * this.q.scale));
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
    const s = scene.sun;
    c.set(p, 'uSunDir', s.dir);
    c.set(p, 'uSunColor', [s.color[0] * s.intensity, s.color[1] * s.intensity, s.color[2] * s.intensity]);
    c.set(p, 'uSkyColor', scene.ambient.sky);
    c.set(p, 'uGroundColor', scene.ambient.ground);
    c.set(p, 'uEnvIntensity', scene.envIntensity);
    c.set(p, 'uShadowOn', this.shadowRT && this.shadowReady ? 1 : 0);
    c.set(p, 'uShadowMat', this.shadowMat);
    c.set(p, 'uShadowTexel', [1 / this.q.shadow, 1 / this.q.shadow]);
    c.set(p, 'uLightPos', this.lightPos);
    c.set(p, 'uLightColor', this.lightColor);
    c.set(p, 'uLightDir', this.lightDir);
    c.set(p, 'uLightCount', this.lightCount);
    c.set(p, 'uFogColor', scene.fog.color);
    c.set(p, 'uExposure', scene.exposure);
    c.set(p, 'uTime', this.time);
    c.set(p, 'uHype', scene.hype || 0);
    c.set(p, 'uCrowd', scene.crowdFx || [0, 0, 1.6, 0]);
    c.set(p, 'uClipY', pass === 'reflect' ? -0.001 : -1e9);
    c.set(p, 'uViewport', [this.iw, this.ih]);
  }

  materialUniforms(p, m, pass) {
    const c = this.ctx;
    if (pass === 'shadow') {
      if (m.alphaTest > 0 && m.map) { c.set(p, 'uMap', m.map); c.set(p, 'uAlphaTest', m.alphaTest); c.set(p, 'uUVScale', m.uvScale); c.set(p, 'uUVOffset', m.uvOffset); }
      return;
    }
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
    if (m.floor) { c.set(p, 'uOverlay', m.floor.overlay); c.set(p, 'uOverlayRect', m.floor.rect); c.set(p, 'uFloorTile', m.floor.tile || [1, 1]); c.set(p, 'uFloorSwap', m.floor.swap ? 1 : 0); }
    if (m.reflective) c.set(p, 'uReflectStrength', this.reflRT && this.reflOn ? m.reflectStrength : 0);
    c.set(p, 'uFogDensity', m.fog ? this.fogDensity : 0);
  }

  drawList(list, scene, cam, pass) {
    const gl = this.gl, c = this.ctx;
    let lastMat = null, lastProg = null, cullState = null, layerState = 0;
    for (const mesh of list) {
      const m = mesh.material;
      const p = this.programFor(mesh, pass);
      if (!p) continue; // still compiling: it shows up in a frame or two instead of stalling this one
      c.use(p);
      if (p !== lastProg) { this.frameUniforms(p, scene, cam, pass); lastProg = p; lastMat = null; }
      if (m !== lastMat) {
        this.materialUniforms(p, m, pass);
        if (pass !== 'shadow') {
          if (m.blend === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
          else if (m.blend === 'multiply') { gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO); }
          else if (m.blend) { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
          else gl.disable(gl.BLEND);
          gl.depthMask(m.depthWrite);
          if (m.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        }
        const wantCull = !m.doubleSided;
        if (wantCull !== cullState) { wantCull ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE); cullState = wantCull; }
        if (pass !== 'shadow') {
          const layer = m.layer || 0;
          if (layer !== layerState) { if (layer) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-0.2 * layer, -1.5 * layer); } else gl.disable(gl.POLYGON_OFFSET_FILL); layerState = layer; }
        }
        lastMat = m;
      }
      c.set(p, 'uModel', mesh.bones ? IDENTITY : mesh.matrix);
      if (mesh.bones) c.set(p, 'uBones', mesh.bones);
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
    for (const mesh of scene.meshes) {
      if (!mesh.visible || (filter && !filter(mesh))) continue;
      if (mesh.cull) { mesh.worldSphere(s); if (!M.sphereInFrustum(this.planes, s[0], s[1], s[2], s[3])) continue; mesh._depth = s; }
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
    const gl = this.gl, f = scene.shadowFocus, d = M.v3norm(M.v3(), scene.sun.dir);
    const r = f.radius;
    const center = M.v3(f.center[0], f.center[1], f.center[2]);
    const eye = M.v3(center[0] + d[0] * 60, center[1] + d[1] * 60, center[2] + d[2] * 60);
    const view = M.m4lookAt(M.m4(), eye, center, Math.abs(d[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    // Texel snapping to avoid shimmering
    const texel = (2 * r) / this.q.shadow;
    view[12] = Math.round(view[12] / texel) * texel;
    view[13] = Math.round(view[13] / texel) * texel;
    const proj = M.m4ortho(M.m4(), -r, r, -r, r, 1, 140);
    this.lightViewProj = M.m4mul(M.m4(), proj, view);
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
    const R = M.m4(); R[5] = -1;
    const view = M.m4mul(M.m4(), cam.view, R);
    this.reflViewProj = M.m4mul(M.m4(), cam.proj, view);
    this.reflCamPos = M.v3(cam.pos[0], -cam.pos[1], cam.pos[2]);
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
    gl.bindTexture(gl.TEXTURE_2D, this.reflRT.color);
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
    this.resize();
    this.time += dt;
    c.stats.draws = 0; c.stats.tris = 0;
    cam.update(this.w / this.h);
    // lights
    this.fogDensity = scene.fog.density;
    this.lightCount = Math.min(8, scene.lights.length);
    for (let i = 0; i < this.lightCount; i++) {
      const L = scene.lights[i];
      this.lightPos.set([L.pos[0], L.pos[1], L.pos[2], L.range], i * 4);
      this.lightColor.set([L.color[0], L.color[1], L.color[2], L.intensity], i * 4);
      this.lightDir.set(L.dir ? [L.dir[0], L.dir[1], L.dir[2], L.cos ?? 0.5] : [0, -1, 0, -2], i * 4);
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
        c.set(pd, 'uTexel', [1 / src.w, 1 / src.h]);
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
        c.set(pu, 'uTexel', [1 / bl[i].w, 1 / bl[i].h]);
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
    c.set(pc, 'uTexel', [1 / this.iw, 1 / this.ih]);
    c.set(pc, 'uFXAA', this.q.fxaa ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    // unbind post textures so no render target stays attached to a sampler (feedback loops)
    for (let i = 0; i < 4; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
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

// Simple CPU particle system rendered as additive billboards
class Particles {
  constructor(ctx) {
    this.ctx = ctx;
    this.max = 1500;
    this.list = [];
    this.pos = new Float32Array(this.max * 18);
    this.nrm = new Float32Array(this.max * 18);
    this.col = new Float32Array(this.max * 24);
    this.geo = null;
  }
  emit(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 1, age: 0, size: o.size || 0.05, color: o.color || [1, 1, 1], g: o.gravity ?? 0, drag: o.drag ?? 0.5, fade: o.fade ?? 1 });
  }
  burst(x, y, z, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI, sp = (o.speed || 2) * (0.4 + Math.random() * 0.8);
      this.emit({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + (o.up || 0), vz: Math.sin(a) * Math.cos(e) * sp, life: (o.life || 0.8) * (0.6 + Math.random() * 0.6), size: (o.size || 0.04) * (0.6 + Math.random() * 0.8), color: o.color, gravity: o.gravity ?? -4, drag: o.drag ?? 1.2 });
    }
  }
  draw(cam, dt) {
    if (!this.list.length) return;
    const gl = this.ctx.gl, c = this.ctx;
    let n = 0;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      p.vy += p.g * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.age / p.life, a = (1 - t) * p.fade;
      for (let j = 0; j < 6; j++) {
        this.pos.set([p.x, p.y, p.z], (n * 6 + j) * 3);
        this.nrm.set([corners[j][0], corners[j][1], p.size], (n * 6 + j) * 3);
        this.col.set([p.color[0], p.color[1], p.color[2], a], (n * 6 + j) * 4);
      }
      n++;
    }
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
    const v = cam.view;
    c.set(p, 'uViewProj', cam.viewProj);
    c.set(p, 'uCamRight', [v[0], v[4], v[8]]);
    c.set(p, 'uCamUp', [v[1], v[5], v[9]]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    c.draw(this.geo);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }
}
