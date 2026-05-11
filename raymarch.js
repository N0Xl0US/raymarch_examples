/**
 * raymarch.js
 * Generic fullscreen shader surface for three/webgpu + wgslFn.
 *
 * Accepts an optional `helpers` array of WGSL source strings.
 * Each helper is wrapped in its own wgslFn() and passed as
 * includes to the main shader function — this is required because
 * wgslFn() only accepts ONE fn per string.
 */

import * as THREE from 'three/webgpu';
import { wgslFn, uv } from 'three/tsl';

function buildMaterial( source, helpers, uniforms ) {
  // Build include nodes from helper strings (one wgslFn per fn)
  const includeFns = ( helpers ?? [] ).map( src => wgslFn( src ) );

  const shaderFn  = wgslFn( source, includeFns );
  const colorNode = shaderFn( {
    uv:         uv(),
    time:       uniforms.uTime,
    resolution: uniforms.uResolution,
    mouse:      uniforms.uMouse,
  } );

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = colorNode;
  material.depthWrite = false;
  material.depthTest  = false;
  return material;
}

export function createFullscreenShaderMesh( { source, helpers, uniforms } ) {
  const geometry = new THREE.PlaneGeometry( 2, 2 );
  const material = buildMaterial( source, helpers, uniforms );
  const mesh     = new THREE.Mesh( geometry, material );

  function setShaderSource( nextSource, nextHelpers ) {
    const nextMaterial = buildMaterial( nextSource, nextHelpers ?? helpers, uniforms );
    const prevMaterial = mesh.material;
    mesh.material = nextMaterial;
    prevMaterial.dispose();
  }

  return { mesh, setShaderSource };
}
