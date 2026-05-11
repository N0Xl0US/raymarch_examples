/**
 * main.js — raw WebGPU fullscreen raymarcher — FPS camera
 *
 * Controls:
 *   Click canvas  → capture pointer (pointer-lock)
 *   Mouse move    → look (yaw / pitch)
 *   W / S         → forward / back
 *   A / D         → strafe left / right
 *   Space         → move up
 *   Shift         → move down
 *   Escape        → release pointer lock
 */

import { createRenderer }                            from './renderer.js';
import { createPipeline, uploadUniforms, drawFrame } from './pipeline.js';

// ─── FPS Camera state ─────────────────────────────────────────────────────────

const cam = {
  x: 0, y: 0, z: 4,   // start a few units back, sponge at origin
  yaw:   0,
  pitch: 0,
};

const MOVE_SPEED  = 2.0;    // units / second
const LOOK_SENSE  = 0.0018; // radians / raw pixel
const PITCH_LIMIT = 1.553;  // ~89°

const keys = {};
window.addEventListener( 'keydown', e => {
  keys[ e.code ] = true;
  // Prevent Space from scrolling the page
  if ( e.code === 'Space' ) e.preventDefault();
} );
window.addEventListener( 'keyup', e => { keys[ e.code ] = false; } );

// ─── Pointer-lock ─────────────────────────────────────────────────────────────

let pointerLocked = false;

function installPointerLock( canvas, status ) {
  // Request lock on any click anywhere on the document
  document.addEventListener( 'click', () => {
    if ( !pointerLocked ) {
      canvas.requestPointerLock();
    }
  } );

  document.addEventListener( 'pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if ( status ) {
      status.textContent = pointerLocked
        ? 'WebGPU · Menger Sponge  [Esc to release mouse]'
        : 'WebGPU · Menger Sponge  [Click to capture mouse]';
    }
  } );

  document.addEventListener( 'mousemove', e => {
    if ( !pointerLocked ) return;
    cam.yaw   += e.movementX * LOOK_SENSE;
    cam.pitch -= e.movementY * LOOK_SENSE;
    cam.pitch  = Math.max( -PITCH_LIMIT, Math.min( PITCH_LIMIT, cam.pitch ) );
  } );
}

// ─── Per-frame movement ───────────────────────────────────────────────────────

function updateCamera( dt ) {
  const sinY = Math.sin( cam.yaw );
  const cosY = Math.cos( cam.yaw );
  const cosP = Math.cos( cam.pitch );
  const sinP = Math.sin( cam.pitch );

  // World-space forward (pitch + yaw)
  const fwdX =  cosP * sinY;
  const fwdY =  sinP;
  const fwdZ =  cosP * (-cosY);

  // Horizontal right (yaw only — strafe stays level)
  const rgtX =  cosY;
  const rgtZ =  sinY;

  const spd = MOVE_SPEED * dt;
  let mx = 0, my = 0, mz = 0;

  if ( keys['KeyW'] || keys['ArrowUp']    ) { mx += fwdX; my += fwdY; mz += fwdZ; }
  if ( keys['KeyS'] || keys['ArrowDown']  ) { mx -= fwdX; my -= fwdY; mz -= fwdZ; }
  if ( keys['KeyD'] || keys['ArrowRight'] ) { mx += rgtX;              mz += rgtZ; }
  if ( keys['KeyA'] || keys['ArrowLeft']  ) { mx -= rgtX;              mz -= rgtZ; }

  if ( keys['Space']      ) { my += 1; }   // Space  → up
  if ( keys['ShiftLeft']  ) { my -= 1; }   // Shift  → down
  if ( keys['ShiftRight'] ) { my -= 1; }

  const len = Math.sqrt( mx * mx + my * my + mz * mz );
  if ( len > 0 ) {
    cam.x += ( mx / len ) * spd;
    cam.y += ( my / len ) * spd;
    cam.z += ( mz / len ) * spd;
  }
}

// ─── Shader loader ────────────────────────────────────────────────────────────

async function fetchShader( path ) {
  const res = await fetch( path );
  if ( !res.ok ) throw new Error( `Shader "${ path }" failed: ${ res.status }` );
  return res.text();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const canvas = document.getElementById( 'canvas' );
  const status = document.getElementById( 'status' );

  const { device, context, format } = await createRenderer( canvas );

  installPointerLock( canvas, status );

  const wgsl = await fetchShader( './shaders/menger.wgsl' );
  const { pipeline, uniformBuffer, bindGroup, uniformData }
    = createPipeline( device, format, wgsl );

  if ( status ) status.textContent = 'WebGPU · Menger Sponge  [Click to capture mouse]';

  function onResize() {
    canvas.width  = window.innerWidth  * devicePixelRatio | 0;
    canvas.height = window.innerHeight * devicePixelRatio | 0;
  }
  window.addEventListener( 'resize', onResize );

  const start = performance.now();
  let lastTime = start;

  // Rolling FPS window
  const FPS_WINDOW   = 60;
  const frameTimes   = new Float64Array( FPS_WINDOW );
  let   frameIndex   = 0;
  let   framesFilled = 0;
  let   lastFpsUpdate = 0;

  function frame( now ) {
    const dt = Math.min( ( now - lastTime ) / 1000, 0.1 );
    lastTime = now;

    // FPS
    frameTimes[ frameIndex % FPS_WINDOW ] = now;
    frameIndex++;
    if ( framesFilled < FPS_WINDOW ) framesFilled++;

    if ( pointerLocked && status && now - lastFpsUpdate > 1000 ) {
      lastFpsUpdate = now;
      if ( framesFilled >= 2 ) {
        const oldest  = frameTimes[ frameIndex % FPS_WINDOW ] ?? frameTimes[0];
        const fps     = Math.round( ( framesFilled - 1 ) / ( now - oldest ) * 1000 );
        status.textContent = `WebGPU · Menger Sponge · ${ fps } fps  [Esc to release]`;
      }
    }

    const time = ( now - start ) / 1000;

    if ( pointerLocked ) {
      updateCamera( dt );
    } else {
      // Idle animation: orbit and zoom
      const spd = time * 0.3;
      const radius = 3.5 + 2.0 * Math.sin(spd); // Zoom in/out once per cycle
      cam.x = Math.sin(spd) * radius;
      cam.z = Math.cos(spd) * radius;
      cam.y = Math.sin(spd * 0.5) * 1.2;        // Slight vertical bob
      
      // Look at origin
      cam.pitch = Math.asin( -cam.y / Math.hypot(cam.x, cam.y, cam.z) );
      cam.yaw   = Math.atan2( -cam.x, cam.z );
    }

    uploadUniforms( device, uniformBuffer, uniformData,
                    time, canvas.width, canvas.height, 0, 0, cam );
    drawFrame( device, context, pipeline, bindGroup );

    requestAnimationFrame( frame );
  }

  requestAnimationFrame( frame );
}

init().catch( err => {
  console.error( 'Init failed:', err );
  document.body.innerHTML =
    `<div style="color:#f88;font-family:monospace;padding:24px">
       <h2>Init Error</h2><pre>${ err.message }</pre>
     </div>`;
} );
