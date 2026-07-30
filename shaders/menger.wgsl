/*
 * shaders/menger.wgsl — Menger Sponge, balanced quality/performance
 *
 * sdMenger  : IQ formula, 5 iterations  — fine sub-cell detail.
 * calcNormal: 4-sample tetrahedron — same quality as 6-sample, 33% fewer evals.
 * raymarch  : 96 steps, epsilon = max(0.0002, 0.0001*t) — absolute floor
 *             prevents micro-stepping when the camera is very close.
 * softShadow: 20 steps — smooth penumbras at half the old cost.
 * calcAO    : 4 samples — one fewer SDF call vs 5-sample version.
 * FAR       : 30  — allows wide camera pull-back without pop-in.
 */

struct Uniforms {
  time       : f32,
  _pad       : f32,
  resolution : vec2<f32>,
  mouse      : vec2<f32>,
  camPos     : vec3<f32>,
  _pad3      : f32,
  yaw        : f32,
  pitch      : f32,
}
@group(0) @binding(0) var<uniform> u : Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[vi], 0.0, 1.0);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FAR : f32 = 30.0;

// ── SDF ───────────────────────────────────────────────────────────────────────

fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Menger sponge — IQ formula (https://www.shadertoy.com/view/4sX3Rn)
// fract(p*s*0.5)*2.0 - 1.0  ≡  mod(p*s, 2.0) - 1.0  but works for negative p
fn sdMenger(p: vec3<f32>) -> f32 {
  var d = sdBox(p, vec3<f32>(1.0));
  var s = 1.0;
  for (var i = 0; i < 5; i++) {
    let a  = fract(p * s * 0.5) * 2.0 - vec3<f32>(1.0);
    s     *= 3.0;
    let r  = abs(vec3<f32>(1.0) - 3.0 * abs(a));
    let da = max(r.x, r.y);
    let db = max(r.y, r.z);
    let dc = max(r.z, r.x);
    let c  = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}

// ── Colour helpers ───────────────────────────────────────────────────────────

// Blue-purple two-tone colour.
// Smoothly blends between deep blue and vivid purple based on surface
// position — no discontinuities, no sharp edges.
fn psychedelicColor(p: vec3<f32>, nor: vec3<f32>) -> vec3<f32> {
  // A smooth 0→1 mixer driven by position + a slow time drift
  let phase = dot(p, vec3<f32>(0.53, 0.47, 0.41)) * 2.3 + u.time * 0.12;
  let t     = 0.5 + 0.5 * sin(phase);   // smooth, no discontinuities

  // Deep blue  (0.10, 0.18, 0.80)  ↔  vivid purple (0.55, 0.10, 0.90)
  let blue   = vec3<f32>(0.10, 0.18, 0.80);
  let purple = vec3<f32>(0.55, 0.10, 0.90);

  // Extra shimmer on grazing surfaces via the normal
  let shimmer = sin(dot(nor, p * 5.0) + u.time * 0.5) * 0.07;
  return clamp(mix(blue, purple, t) + shimmer, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Schlick Fresnel approximation
fn fresnel(cosTheta: f32, F0: f32) -> f32 {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Environment colour: blue-purple shimmer matching the surface palette
fn envColor(r: vec3<f32>, p: vec3<f32>) -> vec3<f32> {
  let envT   = 0.5 + 0.5 * sin(dot(r, vec3<f32>(0.71, 0.61, 0.53)) * 3.1 + u.time * 0.18);
  let eBlue  = vec3<f32>(0.15, 0.25, 1.00);
  let ePurp  = vec3<f32>(0.70, 0.15, 1.00);
  return mix(eBlue, ePurp, envT);
}

// ── Lighting helpers ──────────────────────────────────────────────────────────

// 4-sample tetrahedron normal — same quality as 6-sample, 33% fewer SDF calls
fn calcNormal(p: vec3<f32>) -> vec3<f32> {
  let e = 0.001;
  let k = vec2<f32>(1.0, -1.0);
  return normalize(
    k.xyy * sdMenger(p + e * k.xyy) +
    k.yyx * sdMenger(p + e * k.yyx) +
    k.yxy * sdMenger(p + e * k.yxy) +
    k.xxx * sdMenger(p + e * k.xxx)
  );
}

fn calcAO(p: vec3<f32>, n: vec3<f32>) -> f32 {
  var occ = 0.0; var sca = 1.0;
  for (var i = 0; i < 4; i++) {  // 4 samples: one fewer SDF call vs 5-sample
    let h  = 0.01 + 0.12 * f32(i) / 3.0;
    occ   += (h - sdMenger(p + h * n)) * sca;
    sca   *= 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

fn softShadow(ro: vec3<f32>, rd: vec3<f32>, mint: f32, k: f32) -> f32 {
  var res = 1.0; var t = mint;
  for (var i = 0; i < 20; i++) {  // 20 steps: half the old cost, still smooth
    if (t >= FAR) { break; }
    let h = sdMenger(ro + rd * t);
    if (h < 0.0001) { return 0.0; }
    res = min(res, k * h / t);
    t  += h;
  }
  return res;
}

// ── Sphere tracer ─────────────────────────────────────────────────────────────

fn raymarch(ro: vec3<f32>, rd: vec3<f32>) -> f32 {
  var t = 0.01;
  for (var i = 0; i < 96; i++) {  // 96 steps: tighter budget, rarely saturates
    let h = sdMenger(ro + rd * t);
    // Absolute epsilon floor: prevents micro-stepping when camera is very close.
    // Pure relative 0.00015*t approaches 0 when t is tiny, causing stalls.
    if (h < max(0.0002, 0.0001 * t)) { break; }
    if (t > FAR)                      { break; }
    t += h;
  }
  return t;
}

// ── Fragment ──────────────────────────────────────────────────────────────────

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {

  let res    = u.resolution;
  let aspect = res.x / max(res.y, 1.0);

  // Flip Y (WebGPU origin top-left → +Y up)
  let uv  = vec2<f32>(fragCoord.x, res.y - fragCoord.y) / res;
  let ndc = (uv * 2.0 - 1.0) * vec2<f32>(aspect, 1.0);

  // ── FPS camera — driven by camPos / yaw / pitch uniforms ────────────────
  let sinY = sin(u.yaw);   let cosY = cos(u.yaw);
  let sinP = sin(u.pitch); let cosP = cos(u.pitch);

  // World-space forward from yaw + pitch
  let fwd = normalize(vec3<f32>(cosP * sinY, sinP, cosP * (-cosY)));
  // Right is yaw-only (no pitch tilt)
  let rgt = normalize(vec3<f32>(cosY, 0.0, sinY));
  let up  = cross(rgt, fwd);

  let cam_o = u.camPos;
  let rd    = normalize(ndc.x * rgt + ndc.y * up + 1.8 * fwd);

  // Background
  let bg = mix(
    vec3<f32>(0.02, 0.03, 0.08),
    vec3<f32>(0.06, 0.08, 0.18),
    clamp(ndc.y * 0.5 + 0.5, 0.0, 1.0)
  );

  let t   = raymarch(cam_o, rd);
  let hit = t < FAR * 0.99;
  if (!hit) { return vec4<f32>(bg, 1.0); }

  let pos  = cam_o + rd * t;
  let nor  = calcNormal(pos);
  let ao   = calcAO(pos, nor);

  // Two lights
  let L1   = normalize(vec3<f32>( 1.5, 2.0,  1.0));
  let L2   = normalize(vec3<f32>(-1.0, 0.5, -0.8));
  let sh   = softShadow(pos + nor * 0.002, L1, 0.01, 16.0);
  let dif1 = max(dot(nor, L1), 0.0) * sh;
  let dif2 = max(dot(nor, L2), 0.0) * 0.3;
  // Metallic multi-lobe specular: sharp peak (nickel-like) + wide gloss
  let refl     = reflect(rd, nor);
  let specSharp = pow(max(dot(refl, L1), 0.0), 128.0) * sh;  // tight highlight
  let specWide  = pow(max(dot(refl, L1), 0.0),  24.0) * sh;  // broad sheen

  // Fresnel: grazing angles get strong metallic reflection
  let cosV   = max(dot(-rd, nor), 0.0);
  let fres   = fresnel(cosV, 0.08);  // F0=0.08 ≈ typical dielectric/metal blend

  // Environment reflection — sampled from the reflection direction
  let envCol = envColor(refl, pos);

  let base = psychedelicColor(pos, nor);

  // Tint the specular/env with the base hue so it still looks psychedelic
  let metalTint = mix(vec3<f32>(1.0), base, 0.5);  // 50% tinted, 50% white

  var col  = base * (dif1 * 0.85 + dif2 * 0.35) * ao  // diffuse
           + metalTint * (specSharp * 1.2 + specWide * 0.3) * sh  // specular lobes
           + envCol * fres * 0.6 * ao                              // env reflection
           + base * 0.06;                                          // ambient

  // Reinhard on luminance only (preserves hue, prevents blow-out)
  let lum = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  col = col / (1.0 + lum);
  col = pow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
  col = mix(bg, col, exp(-t * 0.04));

  return vec4<f32>(col, 1.0);
}