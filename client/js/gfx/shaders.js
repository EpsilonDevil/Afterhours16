// GLSL ES 3.00 sources. Variants are selected with #defines from the material.
export const STD_VS = /* glsl */`
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aColor;
#ifdef SKINNED
layout(location=4) in vec4 aJoints;
layout(location=5) in vec4 aWeights;
uniform mat4 uBones[MAX_BONES];
#endif
#ifdef INSTANCED
layout(location=6) in vec4 aI0;
layout(location=7) in vec4 aI1;
layout(location=8) in vec4 aI2;
layout(location=9) in vec4 aI3;
layout(location=10) in vec4 aIColor;
#endif
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat4 uShadowMat;
uniform vec2 uUVScale;
uniform float uTime;
uniform float uHype;
uniform vec4 uCrowd; // v0.4.3 crowd: x = wave strength, y = clap, z = wave speed, w = standing ovation
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec4 vColor;
out vec4 vShadow;
void main() {
  vec4 pos = vec4(aPos, 1.0);
  vec3 nrm = aNormal;
#ifdef SKINNED
  mat4 skin = aWeights.x * uBones[int(aJoints.x)] + aWeights.y * uBones[int(aJoints.y)] + aWeights.z * uBones[int(aJoints.z)] + aWeights.w * uBones[int(aJoints.w)];
  pos = skin * pos;
  nrm = mat3(skin) * nrm;
#endif
  mat4 model = uModel;
  vColor = aColor;
#ifdef INSTANCED
  model = model * mat4(aI0, aI1, aI2, aI3);
  vColor *= aIColor;
#ifdef CROWD
  // v0.4.3: livelier fans. Each instance has its own temperament (aIColor.a): on big plays the excitable ones
  // stand and throw their arms up, during dead balls some clap, a stadium wave rolls round the bowl now and
  // then, and everyone keeps a little idle sway and head turn.
  float r = aIColor.a, ph = r * 6.2831;
  float ang = atan(aI3.x, aI3.z);
  float wave = uCrowd.x * smoothstep(0.55, 1.0, sin(ang * 1.0 - uTime * uCrowd.z));
  float stand = max(clamp((uHype - r * 0.75) * 2.2, 0.0, 1.0), max(wave, uCrowd.w * step(r, 0.85)));
  float arms = max(stand * step(r, 0.7 + uHype * 0.3), wave);
  float bob = max(0.0, sin(uTime * (2.0 + r * 3.0) + ph));
  bool isArm = abs(aPos.x) > 0.155 && aPos.y < 0.53;
  if (isArm) {
    // swing the arm up about the shoulder; clapping brings the hands together in front
    float sh = 0.52, up = arms;
    pos.y = mix(aPos.y, sh + (sh - aPos.y) + 0.04, up);
    pos.x = aPos.x * (1.0 - 0.15 * up);
    float clap = uCrowd.y * step(0.35, r) * (1.0 - up);
    float cl = 0.5 + 0.5 * sin(uTime * 13.0 + ph);
    pos.z += clap * (0.12 + (sh - aPos.y) * 0.5);
    pos.y = mix(pos.y, sh - 0.05 + (pos.y - sh) * 0.3, clap);
    pos.x = mix(pos.x, sign(aPos.x) * (0.03 + 0.07 * cl), clap);
  }
  pos.y += bob * (0.012 + uHype * 0.14) + stand * 0.24;
  pos.x += sin(uTime * 0.7 + ph) * 0.02;
  if (aPos.y > 0.62) pos.x += sin(uTime * 0.4 + ph * 3.0) * 0.025; // heads turn and bob
  vColor.a = 1.0;
#endif
#endif
  vec4 world = model * pos;
  vWorld = world.xyz;
  vNormal = normalize(mat3(model) * nrm);
  vUV = aUV * uUVScale;
  vShadow = uShadowMat * world;
  gl_Position = uViewProj * world;
}`;

export const STD_FS = /* glsl */`
precision highp float;
precision highp sampler2DShadow;
#define PI 3.14159265
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in vec4 vColor;
in vec4 vShadow;
out vec4 fragColor;

uniform vec3 uBaseColor;
uniform float uOpacity;
uniform float uRoughness;
uniform float uMetalness;
uniform vec3 uEmissive;
uniform float uSpecular;
uniform vec3 uSheen;
#ifdef HAS_MAP
uniform sampler2D uMap;
#endif
#ifdef HAS_NORMALMAP
uniform sampler2D uNormalMap;
uniform float uNormalScale;
#endif
#ifdef HAS_RMAP
uniform sampler2D uRoughMap;
#endif
#ifdef HAS_EMAP
uniform sampler2D uEmissiveMap;
#endif
#ifdef HAS_DETAIL
uniform sampler2D uDetailMap;
uniform vec3 uDetail; // u scale, v scale, strength
#endif
#ifdef FLOOR
uniform sampler2D uOverlay;
uniform vec4 uOverlayRect;
uniform vec2 uFloorTile;
uniform float uFloorSwap;
#endif
#ifdef REFLECTIVE
uniform sampler2D uReflection;
uniform float uReflectStrength;
#endif
uniform vec2 uViewport;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uEnvIntensity;
uniform sampler2D uEnvMap;
uniform sampler2DShadow uShadowMap;
uniform float uShadowOn;
uniform vec2 uShadowTexel;
uniform vec4 uLightPos[8];
uniform vec4 uLightColor[8];
uniform vec4 uLightDir[8];
uniform int uLightCount;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uExposure;
uniform float uAlphaTest;
uniform float uClipY;

vec3 F_Schlick(vec3 f0, float u) { float f = pow(1.0 - u, 5.0); return f0 + (1.0 - f0) * f; }
float D_GGX(float NoH, float a) { float a2 = a * a; float d = (NoH * a2 - NoH) * NoH + 1.0; return a2 / (PI * d * d + 1e-7); }
float V_Smith(float NoV, float NoL, float a) { float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / (gv + gl + 1e-5); }
vec3 envBRDF(vec3 f0, float r, float NoV) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 q = r * c0 + c1;
  float a004 = min(q.x * q.x, exp2(-9.28 * NoV)) * q.x + q.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + q.zw;
  return f0 * AB.x + AB.y;
}
vec2 equirect(vec3 d) { return vec2(atan(d.x, -d.z) * 0.15915 + 0.5, acos(clamp(d.y, -1.0, 1.0)) * 0.31831); }

float shadowAt(vec3 nrm, vec3 L) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float bias = 0.0007 + 0.0018 * (1.0 - clamp(dot(nrm, L), 0.0, 1.0));
  float z = p.z - bias;
  float s = 0.0;
  vec2 t = uShadowTexel * 1.25;
  s += texture(uShadowMap, vec3(p.xy + vec2(-1.0, -1.0) * t, z));
  s += texture(uShadowMap, vec3(p.xy + vec2(1.0, -1.0) * t, z));
  s += texture(uShadowMap, vec3(p.xy + vec2(-1.0, 1.0) * t, z));
  s += texture(uShadowMap, vec3(p.xy + vec2(1.0, 1.0) * t, z));
  s += texture(uShadowMap, vec3(p.xy, z)) * 2.0;
  s += texture(uShadowMap, vec3(p.xy + vec2(0.0, 1.6) * t, z));
  s += texture(uShadowMap, vec3(p.xy + vec2(0.0, -1.6) * t, z));
  s += texture(uShadowMap, vec3(p.xy + vec2(1.6, 0.0) * t, z));
  s += texture(uShadowMap, vec3(p.xy + vec2(-1.6, 0.0) * t, z));
  return s / 10.0;
}

vec3 aces(vec3 x) {
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}

void main() {
  if (vWorld.y < uClipY) discard;
  vec4 base = vec4(uBaseColor, uOpacity) * vColor;
  vec2 uvMain = vUV;
#ifdef FLOOR
  uvMain = mix(vUV, vUV.yx, uFloorSwap) * uFloorTile;
#endif
#ifdef HAS_MAP
  vec4 tex = texture(uMap, uvMain);
  base *= tex;
#endif
  float rough = uRoughness;
  float metal = uMetalness;
#ifdef HAS_RMAP
  vec4 rm = texture(uRoughMap, uvMain);
  rough *= rm.g * 2.0;
#endif
  vec3 N = normalize(vNormal);
#ifndef DOUBLE_SIDED_OFF
  if (!gl_FrontFacing) N = -N;
#endif
#ifdef FLOOR
  vec2 ouv = (vUV - uOverlayRect.xy) * uOverlayRect.zw;
  vec4 ov = vec4(0.0);
  if (ouv.x >= 0.0 && ouv.x <= 1.0 && ouv.y >= 0.0 && ouv.y <= 1.0) ov = texture(uOverlay, ouv);
  base.rgb = mix(base.rgb, ov.rgb, ov.a);
  rough = mix(rough, rough * 0.8, ov.a);
#endif
#ifdef ALPHA_MASK
  if (base.a < uAlphaTest) discard;
#endif
#ifdef HAS_NORMALMAP
  vec3 nm = texture(uNormalMap, uvMain).xyz * 2.0 - 1.0;
  nm.xy *= uNormalScale;
  vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld);
  vec2 duv1 = dFdx(uvMain), duv2 = dFdy(uvMain);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12);
  N = normalize(mat3(T * invmax, B * invmax, N) * nm);
#endif
#ifdef HAS_DETAIL
  {
    // tiling micro-detail (skin pores, fabric weave) on top of the surface normal
    vec2 duv = vUV * uDetail.xy;
    vec3 dn = texture(uDetailMap, duv).xyz * 2.0 - 1.0;
    dn.xy *= uDetail.z;
    vec3 q1 = dFdx(vWorld), q2 = dFdy(vWorld);
    vec2 e1 = dFdx(duv), e2 = dFdy(duv);
    vec3 r2 = cross(q2, N), r1 = cross(N, q1);
    vec3 Td = r2 * e1.x + r1 * e2.x, Bd = r2 * e1.y + r1 * e2.y;
    float im = inversesqrt(max(dot(Td, Td), dot(Bd, Bd)) + 1e-12);
    N = normalize(mat3(Td * im, Bd * im, N) * normalize(dn));
  }
#endif

#ifdef UNLIT
  vec3 color = base.rgb + uEmissive;
#else
  vec3 V = normalize(uCamPos - vWorld);
  float NoV = clamp(dot(N, V), 1e-3, 1.0);
  rough = clamp(rough, 0.04, 1.0);
  float a = rough * rough;
  vec3 diffuseColor = base.rgb * (1.0 - metal);
  vec3 f0 = mix(vec3(0.04 * uSpecular), base.rgb, metal);
  vec3 color = vec3(0.0);

  // Sun / key light
  vec3 L = normalize(uSunDir);
  float NoLraw = dot(N, L);
  float sh = shadowAt(N, L);
#ifdef SKIN
  float wrap = 0.3;
  float NoLd = clamp((NoLraw + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 scatter = vec3(0.9, 0.3, 0.2) * (NoLd - clamp(NoLraw, 0.0, 1.0)) * 0.45;
  vec3 diffLight = (vec3(NoLd) + scatter);
#else
  vec3 diffLight = vec3(clamp(NoLraw, 0.0, 1.0));
#endif
  float NoL = clamp(NoLraw, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float NoH = clamp(dot(N, H), 0.0, 1.0);
  float VoH = clamp(dot(V, H), 0.0, 1.0);
  vec3 F = F_Schlick(f0, VoH);
  vec3 spec = D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * F;
#ifdef SKIN
  // two-lobe skin specular: broad lobe + a tight oily sheen
  float a2s = max(0.03, a * 0.38);
  spec = spec * 0.7 + D_GGX(NoH, a2s) * V_Smith(NoV, NoL, a2s) * F * 0.3;
#endif
  color += (diffuseColor / PI * diffLight + spec * NoL) * uSunColor * sh;

  // Local lights (floodlights, arena banks)
  for (int i = 0; i < 8; i++) {
    if (i >= uLightCount) break;
    vec3 lp = uLightPos[i].xyz - vWorld;
    float d = length(lp);
    float range = uLightPos[i].w;
    if (d > range) continue;
    vec3 l = lp / d;
    float att = pow(clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0), 2.0) / (d * d * 0.02 + 1.0);
    float cosO = uLightDir[i].w;
    if (cosO > -1.0) { float cd = dot(-l, normalize(uLightDir[i].xyz)); att *= smoothstep(cosO, cosO + 0.12, cd); }
    float nl = clamp(dot(N, l), 0.0, 1.0);
    vec3 h = normalize(l + V);
    vec3 sp = D_GGX(clamp(dot(N, h), 0.0, 1.0), a) * V_Smith(NoV, nl, a) * F_Schlick(f0, clamp(dot(V, h), 0.0, 1.0));
    color += (diffuseColor / PI + sp) * nl * uLightColor[i].rgb * uLightColor[i].a * att;
  }

  // Ambient: hemisphere irradiance + environment specular
  float hemi = N.y * 0.5 + 0.5;
  vec3 irr = mix(uGroundColor, uSkyColor, hemi);
  float ao = vColor.a < 0.999 ? vColor.a : 1.0;
#ifdef CHARACTER
  ao *= mix(0.55, 1.0, smoothstep(0.0, 0.55, vWorld.y));
#endif
#ifdef SKIN
  irr *= vec3(1.03, 0.98, 0.96); // light bleeding through skin warms the fill
#endif
  color += diffuseColor * irr * ao;
  vec3 R = reflect(-V, N);
  vec3 env = textureLod(uEnvMap, equirect(R), rough * 6.0).rgb * uEnvIntensity;
  vec3 specAmb = envBRDF(f0, rough, NoV);
#ifdef REFLECTIVE
  vec2 suv = gl_FragCoord.xy / uViewport;
  suv.x += N.x * 0.03; suv.y += N.z * 0.03;
  vec3 refl = textureLod(uReflection, suv, rough * 4.0).rgb;
  float fres = specAmb.r + (1.0 - specAmb.r) * pow(1.0 - NoV, 4.0);
  env = mix(env, refl, clamp(uReflectStrength * (1.0 - rough * 1.2), 0.0, 1.0));
#endif
  color += env * specAmb * ao;
#ifdef CLOTH
  color += uSheen * pow(1.0 - NoV, 3.0) * (irr + uSunColor * NoL * sh * 0.3) * 0.5;
#endif
#ifdef HAS_EMAP
  color += uEmissive * texture(uEmissiveMap, uvMain).rgb;
#else
  color += uEmissive;
#endif
  // Fog
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));
#endif

#ifdef LDR
  color = pow(aces(color * uExposure), vec3(1.0 / 2.2));
#endif
#ifdef ALPHA_BLEND
  fragColor = vec4(color, base.a);
#else
  fragColor = vec4(color, 1.0);
#endif
}`;

// Depth-only shadow pass.
export const SHADOW_VS = /* glsl */`
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUV;
#ifdef SKINNED
layout(location=4) in vec4 aJoints;
layout(location=5) in vec4 aWeights;
uniform mat4 uBones[MAX_BONES];
#endif
#ifdef INSTANCED
layout(location=6) in vec4 aI0;
layout(location=7) in vec4 aI1;
layout(location=8) in vec4 aI2;
layout(location=9) in vec4 aI3;
#endif
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec2 uUVScale;
out vec2 vUV;
void main() {
  vec4 pos = vec4(aPos, 1.0);
#ifdef SKINNED
  mat4 skin = aWeights.x * uBones[int(aJoints.x)] + aWeights.y * uBones[int(aJoints.y)] + aWeights.z * uBones[int(aJoints.z)] + aWeights.w * uBones[int(aJoints.w)];
  pos = skin * pos;
#endif
  mat4 model = uModel;
#ifdef INSTANCED
  model = model * mat4(aI0, aI1, aI2, aI3);
#endif
  vUV = aUV * uUVScale;
  gl_Position = uViewProj * model * pos;
}`;
export const SHADOW_FS = /* glsl */`
precision highp float;
in vec2 vUV;
#ifdef ALPHA_MASK
uniform sampler2D uMap;
uniform float uAlphaTest;
#endif
out vec4 fragColor;
void main() {
#ifdef ALPHA_MASK
  if (texture(uMap, vUV).a < uAlphaTest) discard;
#endif
  fragColor = vec4(1.0);
}`;

// Full-screen triangle
export const FS_VS = /* glsl */`
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SKY_FS = /* glsl */`
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uStars;
uniform float uTime;
uniform float uExposure;
uniform float uLDR;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec4 p = uInvViewProj * vec4(vUV * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w - uCamPos);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uSkyHorizon, uSkyTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uSkyHorizon, uSkyGround, clamp(-h * 4.0, 0.0, 1.0));
  vec3 L = normalize(uSunDir);
  float sd = max(dot(d, L), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 24.0) * 0.12) * step(0.0, h + 0.02);
  // high thin clouds
  float c = noise(vec3(d.xz / max(h, 0.05) * 1.8, uTime * 0.01)) * noise(vec3(d.xz / max(h, 0.05) * 4.2, 3.0));
  col = mix(col, mix(uSkyHorizon * 1.2, vec3(1.0), 0.25 * (1.0 - uStars)) , smoothstep(0.25, 0.7, c) * 0.35 * smoothstep(0.0, 0.25, h));
  if (uStars > 0.0 && h > 0.0) {
    vec3 sp = d * 220.0;
    float s = step(0.9965, hash(floor(sp)));
    col += vec3(s) * uStars * 0.9 * smoothstep(0.05, 0.4, h);
  }
  if (uLDR > 0.5) col = pow(aces(col * uExposure), vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}`;

// Bloom: prefilter + 13-tap downsample
export const DOWN_FS = /* glsl */`
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
vec3 pre(vec3 c) { float b = max(c.r, max(c.g, c.b)); float k = max(b - uThreshold, 0.0) / max(b, 1e-4); return c * k; }
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUV + t * vec2(-2, -2)).rgb, b = texture(uSrc, vUV + t * vec2(0, -2)).rgb, c = texture(uSrc, vUV + t * vec2(2, -2)).rgb;
  vec3 d = texture(uSrc, vUV + t * vec2(-2, 0)).rgb, e = texture(uSrc, vUV).rgb, f = texture(uSrc, vUV + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, vUV + t * vec2(-2, 2)).rgb, h = texture(uSrc, vUV + t * vec2(0, 2)).rgb, i = texture(uSrc, vUV + t * vec2(2, 2)).rgb;
  vec3 j = texture(uSrc, vUV + t * vec2(-1, -1)).rgb, k = texture(uSrc, vUV + t * vec2(1, -1)).rgb;
  vec3 l = texture(uSrc, vUV + t * vec2(-1, 1)).rgb, m = texture(uSrc, vUV + t * vec2(1, 1)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uPrefilter > 0.5) col = pre(min(col, vec3(40.0)));
  fragColor = vec4(col, 1.0);
}`;
export const UP_FS = /* glsl */`
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture(uSrc, vUV + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUV + vec2(0, -t.y)).rgb * 2.0 + texture(uSrc, vUV + vec2(t.x, -t.y)).rgb
         + texture(uSrc, vUV + vec2(-t.x, 0)).rgb * 2.0 + texture(uSrc, vUV).rgb * 4.0 + texture(uSrc, vUV + vec2(t.x, 0)).rgb * 2.0
         + texture(uSrc, vUV + vec2(-t.x, t.y)).rgb + texture(uSrc, vUV + vec2(0, t.y)).rgb * 2.0 + texture(uSrc, vUV + vec2(t.x, t.y)).rgb;
  fragColor = vec4(c / 16.0, 1.0);
}`;
export const COMPOSITE_FS = /* glsl */`
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDesat;
uniform vec2 uTexel;
uniform float uFXAA;
vec3 aces(vec3 x) {
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 fetch(vec2 uv) { return texture(uScene, uv).rgb; }
void main() {
  vec3 hdr = fetch(vUV);
  if (uFXAA > 0.5) {
    // Lightweight FXAA on HDR luma
    vec3 nw = fetch(vUV + uTexel * vec2(-1, -1)), ne = fetch(vUV + uTexel * vec2(1, -1)), sw = fetch(vUV + uTexel * vec2(-1, 1)), se = fetch(vUV + uTexel * vec2(1, 1));
    float lnw = luma(aces(nw)), lne = luma(aces(ne)), lsw = luma(aces(sw)), lse = luma(aces(se)), lm = luma(aces(hdr));
    float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
    vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
    float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
    dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;
    vec3 a = 0.5 * (fetch(vUV + dir * (1.0 / 3.0 - 0.5)) + fetch(vUV + dir * (2.0 / 3.0 - 0.5)));
    vec3 b = a * 0.5 + 0.25 * (fetch(vUV + dir * -0.5) + fetch(vUV + dir * 0.5));
    float lb = luma(aces(b));
    hdr = (lb < lmin || lb > lmax) ? a : b;
  }
  hdr += texture(uBloom, vUV).rgb * uBloomStrength;
  vec3 c = aces(hdr * uExposure);
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation * (1.0 - uDesat));
  c = (c - 0.5) * uContrast + 0.5;
  vec2 q = vUV - 0.5;
  c *= 1.0 - dot(q, q) * uVignette;
  c = mix(c, uFlashColor, uFlash);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  float n = fract(sin(dot(vUV * 1000.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  fragColor = vec4(c, 1.0);
}`;

// Additive billboard particles (sparks, dust, confetti)
export const PART_VS = /* glsl */`
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal; // x,y = corner, z = size
layout(location=3) in vec4 aColor;
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
out vec4 vColor;
out vec2 vC;
void main() {
  vec3 p = aPos + (uCamRight * aNormal.x + uCamUp * aNormal.y) * aNormal.z;
  vColor = aColor;
  vC = aNormal.xy;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;
export const PART_FS = /* glsl */`
precision highp float;
in vec4 vColor;
in vec2 vC;
out vec4 fragColor;
void main() {
  float d = 1.0 - smoothstep(0.2, 1.0, length(vC));
  fragColor = vec4(vColor.rgb * d * vColor.a, 0.0);
}`;
