/**
 * pipeline.js
 * Creates and manages the raw WebGPU render pipeline for the fullscreen raymarcher.
 *
 * Uniform buffer layout (48 bytes, 12 × f32):
 *   offset  0 — time         : f32
 *   offset  4 — _pad         : f32
 *   offset  8 — resolution   : vec2<f32>
 *   offset 16 — mouse        : vec2<f32>
 *   offset 24 — _pad2[2]     : f32 × 2   (pad to 32 — align vec3 to 16)
 *   offset 32 — camPos       : vec3<f32>
 *   offset 44 — _pad3        : f32
 *   offset 48 — yaw          : f32
 *   offset 52 — pitch        : f32
 *   offset 56 — _pad4[2]     : f32 × 2   (pad to 64)
 */

const UNIFORM_BYTES = 64; // 16 × f32

/**
 * Compiles the WGSL shader and creates the render pipeline + uniform resources.
 */
export function createPipeline( device, format, wgsl ) {

  const shaderModule = device.createShaderModule( {
    label: 'raymarcher',
    code:  wgsl,
  } );

  const pipeline = device.createRenderPipeline( {
    label:  'raymarcher-pipeline',
    layout: 'auto',
    vertex: {
      module:     shaderModule,
      entryPoint: 'vs',
    },
    fragment: {
      module:     shaderModule,
      entryPoint: 'fs',
      targets:    [ { format } ],
    },
    primitive: { topology: 'triangle-list' },
  } );

  const uniformBuffer = device.createBuffer( {
    label: 'uniforms',
    size:  UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  } );

  const bindGroup = device.createBindGroup( {
    label:  'raymarcher-bg',
    layout: pipeline.getBindGroupLayout( 0 ),
    entries: [ {
      binding:  0,
      resource: { buffer: uniformBuffer },
    } ],
  } );

  const uniformData = new Float32Array( UNIFORM_BYTES / 4 );

  return { pipeline, uniformBuffer, bindGroup, uniformData };
}

/**
 * Uploads current uniform values to the GPU.
 * @param {Float32Array} uniformData  — reusable scratch buffer
 * @param {object}       cam          — { x, y, z, yaw, pitch }
 */
export function uploadUniforms( device, uniformBuffer, uniformData,
                                 time, width, height, mouseX, mouseY, cam ) {
  uniformData[  0 ] = time;
  uniformData[  1 ] = 0;          // _pad
  uniformData[  2 ] = width;
  uniformData[  3 ] = height;
  uniformData[  4 ] = mouseX;
  uniformData[  5 ] = mouseY;
  uniformData[  6 ] = 0;          // _pad2[0]
  uniformData[  7 ] = 0;          // _pad2[1]
  // vec3 camPos  — must start at offset 32 bytes = index 8
  uniformData[  8 ] = cam.x;
  uniformData[  9 ] = cam.y;
  uniformData[ 10 ] = cam.z;
  uniformData[ 11 ] = 0;          // _pad3
  uniformData[ 12 ] = cam.yaw;
  uniformData[ 13 ] = cam.pitch;
  uniformData[ 14 ] = 0;          // _pad4[0]
  uniformData[ 15 ] = 0;          // _pad4[1]

  device.queue.writeBuffer( uniformBuffer, 0, uniformData );
}

/**
 * Encodes and submits one fullscreen draw call.
 */
export function drawFrame( device, context, pipeline, bindGroup ) {
  const encoder = device.createCommandEncoder();

  const pass = encoder.beginRenderPass( {
    colorAttachments: [ {
      view:       context.getCurrentTexture().createView(),
      clearValue: { r: 0.02, g: 0.03, b: 0.07, a: 1 },
      loadOp:     'clear',
      storeOp:    'store',
    } ],
  } );

  pass.setPipeline( pipeline );
  pass.setBindGroup( 0, bindGroup );
  pass.draw( 3 );
  pass.end();

  device.queue.submit( [ encoder.finish() ] );
}
