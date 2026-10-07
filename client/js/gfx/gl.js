// Thin WebGL2 resource layer: programs (with define variants), geometry VAOs, textures, render targets.
export const ATTR = { position: 0, normal: 1, uv: 2, color: 3, joints: 4, weights: 5, i0: 6, i1: 7, i2: 8, i3: 9, icolor: 10 };

export class GLContext {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is required. Enable hardware acceleration in your browser settings.');
    this.gl = gl;
    this.canvas = canvas;
    this.floatRT = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.maxAniso = this.aniso ? gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
    this.programs = new Map();
    this.stats = { draws: 0, tris: 0 };
    this.lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
  }

  compile(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      console.error(log + '\n' + lines);
      throw new Error('Shader compile failed: ' + log);
    }
    return s;
  }

  program(name, vs, fs, defines = {}) {
    const key = name + '|' + Object.entries(defines).filter(([, v]) => v !== false && v != null).map(([k, v]) => k + '=' + v).sort().join(',');
    let p = this.programs.get(key);
    if (p) return p;
    const head = '#version 300 es\n' + Object.entries(defines).filter(([, v]) => v !== false && v != null).map(([k, v]) => `#define ${k} ${v === true ? 1 : v}`).join('\n') + '\n';
    const gl = this.gl, prog = gl.createProgram();
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, head + vs));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, head + fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(prog));
    const uniforms = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      const nm = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(prog, info.name);
      const sampler = [gl.SAMPLER_2D, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE, gl.SAMPLER_3D].includes(info.type);
      uniforms[nm] = { loc, type: info.type, size: info.size, unit: sampler ? unit++ : -1 };
    }
    gl.useProgram(prog);
    for (const u of Object.values(uniforms)) if (u.unit >= 0) gl.uniform1i(u.loc, u.unit);
    this.current = null;
    p = { key, prog, uniforms, frame: -1, id: this.programs.size };
    this.programs.set(key, p);
    return p;
  }

  use(p) { if (this.current !== p) { this.gl.useProgram(p.prog); this.current = p; } return p; }

  // Set a uniform by name if the program uses it. Values: number, array, Float32Array, texture object.
  set(p, name, v) {
    const u = p.uniforms[name];
    if (!u) return;
    const gl = this.gl, t = u.type;
    if (u.unit >= 0) {
      gl.activeTexture(gl.TEXTURE0 + u.unit);
      gl.bindTexture(gl.TEXTURE_2D, v ? (v.tex || v) : null);
      gl.uniform1i(u.loc, u.unit);
      return;
    }
    switch (t) {
      case gl.FLOAT: if (u.size > 1) gl.uniform1fv(u.loc, v); else gl.uniform1f(u.loc, v); break;
      case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      default: break;
    }
  }

  // geometry: {position, normal, uv, color, joints, weights, index}
  geometry(g, dynamic = false) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers = {};
    const add = (name, data, size, type = gl.FLOAT) => {
      if (!data) return;
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, dynamic && (name === 'position' || name === 'normal') ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      gl.enableVertexAttribArray(ATTR[name]);
      gl.vertexAttribPointer(ATTR[name], size, type, false, 0, 0);
      buffers[name] = b;
    };
    add('position', g.position, 3);
    add('normal', g.normal, 3);
    add('uv', g.uv, 2);
    add('color', g.color, 4);
    add('joints', g.joints, 4);
    add('weights', g.weights, 4);
    if (!g.color) { gl.disableVertexAttribArray(ATTR.color); gl.vertexAttrib4f(ATTR.color, 1, 1, 1, 1); }
    let indexType = 0, count = g.position.length / 3;
    if (g.index) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
      const idx = g.index instanceof Uint32Array || g.index instanceof Uint16Array ? g.index : (count > 65535 ? new Uint32Array(g.index) : new Uint16Array(g.index));
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      indexType = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      count = idx.length;
      buffers.index = b;
    }
    gl.bindVertexArray(null);
    return { vao, buffers, count, indexType, hasColor: !!g.color, skinned: !!g.joints, bounds: g.bounds || computeBounds(g.position), instanceBuffer: null, instanceCount: 0 };
  }

  updateAttribute(geo, name, data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.buffers[name]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  // Instance data: Float32Array of 20 floats per instance (mat4 + color)
  setInstances(geo, data, count) {
    const gl = this.gl;
    gl.bindVertexArray(geo.vao);
    if (!geo.instanceBuffer) {
      geo.instanceBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, geo.instanceBuffer);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(ATTR.i0 + i);
        gl.vertexAttribPointer(ATTR.i0 + i, 4, gl.FLOAT, false, 80, i * 16);
        gl.vertexAttribDivisor(ATTR.i0 + i, 1);
      }
      gl.enableVertexAttribArray(ATTR.icolor);
      gl.vertexAttribPointer(ATTR.icolor, 4, gl.FLOAT, false, 80, 64);
      gl.vertexAttribDivisor(ATTR.icolor, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    geo.instanceCount = count;
  }

  texture(source, opts = {}) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const srgb = opts.srgb !== false;
    const internal = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
    if (source && source.data && source.width) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    const wrap = opts.wrap === 'clamp' ? gl.CLAMP_TO_EDGE : opts.wrap === 'mirror' ? gl.MIRRORED_REPEAT : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS === 'clamp' ? gl.CLAMP_TO_EDGE : wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrapT === 'clamp' ? gl.CLAMP_TO_EDGE : wrap);
    const mips = opts.mipmaps !== false;
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.nearest ? gl.NEAREST : gl.LINEAR);
    if (this.aniso && mips) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(this.maxAniso, opts.aniso ?? 8));
    const w = source.width, h = source.height;
    return { tex, width: w, height: h, srgb };
  }

  updateTexture(t, source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, t.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // Render target. opts: {float, depth: 'tex'|'rb'|false, samples, mipmaps, linear}
  target(w, h, opts = {}) {
    const gl = this.gl;
    const rt = { w, h, opts, fb: gl.createFramebuffer() };
    const float = opts.float && this.floatRT;
    const fmt = float ? gl.RGBA16F : gl.RGBA8, type = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    if (opts.samples > 0) {
      rt.colorRB = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rt.colorRB);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, opts.samples, fmt, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rt.colorRB);
      rt.depthRB = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rt.depthRB);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, opts.samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rt.depthRB);
    } else {
      if (opts.color !== false) {
        rt.color = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, rt.color);
        const levels = opts.mipmaps ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
        gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt.color, 0);
      } else {
        gl.drawBuffers([gl.NONE]);
        gl.readBuffer(gl.NONE);
      }
      if (opts.depth === 'tex' || opts.depth === 'shadow') {
        rt.depth = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, rt.depth);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (opts.depth === 'shadow') {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
        }
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, rt.depth, 0);
      } else if (opts.depth) {
        rt.depthRB = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rt.depthRB);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rt.depthRB);
      }
    }
    rt.complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return rt;
  }

  disposeTarget(rt) {
    if (!rt) return;
    const gl = this.gl;
    gl.deleteFramebuffer(rt.fb);
    if (rt.color) gl.deleteTexture(rt.color);
    if (rt.depth) gl.deleteTexture(rt.depth);
    if (rt.colorRB) gl.deleteRenderbuffer(rt.colorRB);
    if (rt.depthRB) gl.deleteRenderbuffer(rt.depthRB);
  }

  disposeGeometry(g) {
    if (!g) return;
    const gl = this.gl;
    gl.deleteVertexArray(g.vao);
    for (const b of Object.values(g.buffers)) gl.deleteBuffer(b);
    if (g.instanceBuffer) gl.deleteBuffer(g.instanceBuffer);
  }

  disposeTexture(t) { if (t && t.tex) this.gl.deleteTexture(t.tex); }

  bindTarget(rt) {
    const gl = this.gl;
    if (rt) { gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb); gl.viewport(0, 0, rt.w, rt.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
  }

  draw(geo) {
    const gl = this.gl;
    gl.bindVertexArray(geo.vao);
    if (geo.instanceCount > 0) {
      if (geo.indexType) gl.drawElementsInstanced(gl.TRIANGLES, geo.count, geo.indexType, 0, geo.instanceCount);
      else gl.drawArraysInstanced(gl.TRIANGLES, 0, geo.count, geo.instanceCount);
      this.stats.tris += geo.count / 3 * geo.instanceCount;
    } else {
      if (geo.indexType) gl.drawElements(gl.TRIANGLES, geo.count, geo.indexType, 0);
      else gl.drawArrays(gl.TRIANGLES, 0, geo.count);
      this.stats.tris += geo.count / 3;
    }
    this.stats.draws++;
  }
}

export function computeBounds(pos) {
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
    if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
  }
  const c = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
  let r = 0;
  for (let i = 0; i < pos.length; i += 3) r = Math.max(r, Math.hypot(pos[i] - c[0], pos[i + 1] - c[1], pos[i + 2] - c[2]));
  return { center: c, radius: r, min: [minx, miny, minz], max: [maxx, maxy, maxz] };
}
