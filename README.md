# WebGPU Menger Sponge Raymarcher

An interactive, real-time [Menger sponge](https://en.wikipedia.org/wiki/Menger_sponge) renderer built entirely on the [WebGPU](https://gpuweb.github.io/gpuweb/) API. Everything runs on the GPU. The scene is raymarched every frame directly in a WGSL compute/fragment shader.

![Screenshot](https://raw.githubusercontent.com/N0Xl0US/menger_sponge_raymarch/main/preview.png)

---

## Features

- **Pure WebGPU** — uses the modern `GPUDevice` / `GPURenderPipeline` API with zero graphics-framework dependencies.
- **Sphere-traced SDF** — 128-step sphere marcher against an analytic Menger-sponge SDF (IQ formula, 5 iterations).
- **FPS camera** — pointer-lock mouse-look with WASD / arrow-key movement, Space to rise, Shift to descend.
- **Idle orbit** — when the mouse is released the camera smoothly orbits and zooms around the sponge automatically.
- **Psychedelic shading** — blue-purple two-tone colour driven by surface position + slow time drift.
- **Metallic PBR-lite lighting** — two directional lights, multi-lobe specular (tight + wide), Schlick Fresnel, environment reflection and ambient occlusion.
- **Soft shadows** — 40-step penumbra march against the primary light.
- **4-sample tetrahedron normals** — same quality as the standard 6-sample central-difference approach with 33% fewer SDF evaluations.
- **Rolling FPS counter** — averaged over the last 60 frames, displayed in the top-left overlay.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Bun](https://bun.sh) | ≥ 1.0 | Used as the dev server runtime |
| A WebGPU-capable browser | Chrome ≥ 113 / Edge ≥ 113 / Firefox Nightly | `about:flags` → enable WebGPU if needed |

> **Note** — WebGPU is not available in Node.js or Safari stable at the time of writing.

---

## Getting Started

```bash
# 1. Install dependencies (only imgui, used for future UI overlays)
bun install

# 2. Start the dev server
bun run dev
```

Then open **http://localhost:8000** in a WebGPU-enabled browser.

---

## Controls

| Input | Action |
|-------|--------|
| **Click** canvas | Capture mouse (pointer-lock) |
| **Mouse move** | Look (yaw / pitch) |
| **W / ↑** | Move forward |
| **S / ↓** | Move backward |
| **A / ←** | Strafe left |
| **D / →** | Strafe right |
| **Space** | Move up |
| **Left Shift / Right Shift** | Move down |
| **Escape** | Release mouse |

When the mouse is **not** captured the camera orbits and bobs around the sponge automatically.

---

## Project Structure

```
.
├── index.html          # Single-page shell; canvas + status overlay
├── main.js             # Entry point: FPS camera state, pointer-lock, render loop
├── renderer.js         # WebGPU device/context/swap-chain initialisation
├── pipeline.js         # Render pipeline, uniform buffer creation & upload helpers
├── raymarch.js         # (legacy) inline WGSL string — superseded by the file shader
├── sdf.js              # (legacy) alternate WGSL shader string
├── server.js           # Bun static file server (serves WGSL with correct MIME type)
├── shaders/
│   └── menger.wgsl     # Primary WGSL shader: SDF, raymarcher, lighting, tonemapping
└── package.json
```

### Key modules

#### `shaders/menger.wgsl`
The heart of the renderer. Contains:
- `sdBox` / `sdMenger` — analytic signed-distance functions
- `raymarch` — sphere-tracing loop (128 steps, FAR = 30 units)
- `softShadow` — 40-step penumbra estimation
- `calcNormal` — 4-tap tetrahedron finite-difference normal
- `calcAO` — 5-tap ambient occlusion
- `psychedelicColor` — position-driven blue-purple palette
- `fresnel` / `envColor` — Schlick Fresnel + environment colour
- Full fragment shader entry point `fs`

#### `pipeline.js`
Creates the `GPURenderPipeline` from the fetched WGSL source, allocates the uniform buffer, and provides `uploadUniforms` (writes camera + time data every frame) and `drawFrame`.

#### `main.js`
Manages the JavaScript side:
- Camera struct (`x, y, z, yaw, pitch`) updated per frame
- Pointer-lock install/teardown
- Idle orbit animation when mouse is released
- Rolling 60-frame FPS window

---

## How It Works

1. **Fullscreen triangle** — the vertex shader generates a single oversized triangle from the vertex index (no VBO needed).
2. **Ray construction** — each fragment computes a world-space ray from the camera position + yaw/pitch uniforms.
3. **Sphere marching** — the ray steps forward by the SDF value each iteration until it either hits the surface (`h < ε·t`) or exceeds `FAR`.
4. **Shading** — on a hit: normal via tetrahedron finite-differences → AO → soft shadow → diffuse + specular + Fresnel env-reflection → Reinhard luminance tone-map → gamma correction → depth fog.

---

## Performance Notes

- **5-iteration Menger SDF** gives fine sub-cell detail without the cost of a full octree traversal.
- **FAR = 30** units prevents wasted marching steps for distant misses.
- The shader is intentionally single-pass (no G-buffer, no compute pass) to maximise compatibility with current WebGPU implementations.

---

## License

MIT — do whatever you like with it. Attribution appreciated but not required.
