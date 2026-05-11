/**
 * sdf.js — Menger Sponge, raw WGSL for the WebGPU pipeline.
 *
 * No Three.js constraints — all helper functions can live in one string.
 * The vertex shader generates a fullscreen triangle from the vertex index.
 * The fragment shader calls shaderMain() which does the raymarching.
 */

export const WGSL_SHADER = /* wgsl */`

// ─── Uniforms ─────────────────────────────────────────────────────────────────

struct Uniforms {
  time       : f32,
  _pad       : f32,
  resolution : vec2<f32>,
  mouse      : vec2<f32>,
}
@group(0) @binding(0) var<uniform> u : Uniforms;

// ─── Vertex shader — GPU-generated fullscreen triangle ────────────────────────

@vertex
fn vs( @builtin(vertex_index) vi : u32 ) -> @builtin(position) vec4<f32> {
  // Three vertices that cover the entire clip space
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[vi], 0.0, 1.0);
}

// ─── SDF primitives ───────────────────────────────────────────────────────────

fn sdBox( p: vec3<f32>, b: vec3<f32> ) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdCross( p: vec3<f32>, r: f32 ) -> f32 {
  let da = max(abs(p.x), abs(p.y));
  let db = max(abs(p.y), abs(p.z));
  let dc = max(abs(p.x), abs(p.z));
  return min(da, min(db, dc)) - r;
}

// ─── Menger sponge (3 iterations) ────────────────────────────────────────────

fn sdMenger( pin: vec3<f32> ) -> f32 {
  var p = pin;
  var d = sdBox(p, vec3<f32>(1.0));
  var s = 1.0;
  for (var i = 0; i < 3; i++) {
    s  *= 3.0;
    let a = (p * s) % 2.0 - 1.0;   // fold into [-1,1] cell
    let c = sdCross(a, 1.0) / s;
    d = max(d, -c);
  }
  return d;
}

// ─── Rotation matrices ────────────────────────────────────────────────────────

fn rotX( a: f32 ) -> mat3x3<f32> {
  let s = sin(a); let c = cos(a);
  return mat3x3<f32>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0,   c,   s),
    vec3<f32>(0.0,  -s,   c),
  );
}

fn rotY( a: f32 ) -> mat3x3<f32> {
  let s = sin(a); let c = cos(a);
  return mat3x3<f32>(
    vec3<f32>(  c, 0.0,  -s),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(  s, 0.0,   c),
  );
}

// ─── Gradient normal ──────────────────────────────────────────────────────────

fn calcNormal( p: vec3<f32> ) -> vec3<f32> {
  let e = vec2<f32>(0.001, 0.0);
  return normalize(vec3<f32>(
    sdMenger(p + e.xyy) - sdMenger(p - e.xyy),
    sdMenger(p + e.yxy) - sdMenger(p - e.yxy),
    sdMenger(p + e.yyx) - sdMenger(p - e.yyx),
  ));
}

// ─── Ambient occlusion ────────────────────────────────────────────────────────

fn calcAO( p: vec3<f32>, n: vec3<f32> ) -> f32 {
  var occ = 0.0;
  var sca  = 1.0;
  for (var i = 0; i < 5; i++) {
    let h  = 0.01 + 0.12 * f32(i) / 4.0;
    let d  = sdMenger(p + h * n);
    occ   += (h - d) * sca;
    sca   *= 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

// ─── Sphere tracer ────────────────────────────────────────────────────────────

fn raymarch( ro: vec3<f32>, rd: vec3<f32> ) -> f32 {
  var t = 0.0;
  for (var i = 0; i < 128; i++) {
    let h = sdMenger(ro + rd * t);
    if (h < 0.0005 * t || t > 20.0) { break; }
    t += h;
  }
  return t;
}

// ─── Shade ────────────────────────────────────────────────────────────────────

fn shaderMain( uv: vec2<f32>, time: f32, resolution: vec2<f32>, mouse: vec2<f32> ) -> vec4<f32> {

  let aspect = resolution.x / max(resolution.y, 1.0);
  let ndc    = (uv * 2.0 - 1.0) * vec2<f32>(aspect, -1.0); // flip Y: WebGPU origin is top-left

  // Camera orbit — mouse steers, else auto-spin
  let mn    = mouse / max(resolution, vec2<f32>(1.0));
  let yaw   = select(time * 0.25, (mn.x * 2.0 - 1.0) * 3.14159, mouse.x > 0.0);
  let pitch = select(-0.45,       (mn.y * 2.0 - 1.0) * 1.2,     mouse.x > 0.0);

  let ro      = rotY(yaw) * rotX(pitch) * vec3<f32>(0.0, 0.0, 3.2);
  let forward = normalize(-ro);
  let right   = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), forward));
  let up      = cross(forward, right);
  let rd      = normalize(ndc.x * right + ndc.y * up + 1.8 * forward);

  let t   = raymarch(ro, rd);
  let hit = t < 19.9;

  let bg = mix(
    vec3<f32>(0.02, 0.03, 0.07),
    vec3<f32>(0.05, 0.07, 0.15),
    clamp(ndc.y * 0.5 + 0.5, 0.0, 1.0)
  );

  if (!hit) { return vec4<f32>(bg, 1.0); }

  let pos  = ro + rd * t;
  let nor  = calcNormal(pos);
  let ao   = calcAO(pos, nor);

  let L1    = normalize(vec3<f32>( 1.4,  2.0,  1.2));
  let L2    = normalize(vec3<f32>(-1.0,  0.5, -0.5));
  let diff1 = max(dot(nor, L1), 0.0);
  let diff2 = max(dot(nor, L2), 0.0) * 0.35;
  let spec  = pow(max(dot(reflect(rd, nor), L1), 0.0), 64.0) * 0.6;

  let base = vec3<f32>(0.82, 0.78, 0.72);
  var col  = base * (diff1 + diff2) * ao
           + vec3<f32>(1.0, 0.95, 0.85) * spec
           + base * 0.04;

  // Reinhard + gamma
  col = col / (col + vec3<f32>(1.0));
  col = pow(col, vec3<f32>(1.0 / 2.2));
  col = mix(bg, col, exp(-t * 0.06));

  return vec4<f32>(col, 1.0);
}

// ─── Fragment entry point ─────────────────────────────────────────────────────

@fragment
fn fs( @builtin(position) fragCoord: vec4<f32> ) -> @location(0) vec4<f32> {
  let uv = fragCoord.xy / u.resolution;
  return shaderMain(uv, u.time, u.resolution, u.mouse);
}
`;
