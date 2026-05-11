/**
 * renderer.js
 * Raw WebGPU initialisation — no framework.
 */

export async function createRenderer( canvas ) {

  if ( !navigator.gpu ) {
    throw new Error( 'WebGPU is not supported in this browser.' );
  }

  const adapter = await navigator.gpu.requestAdapter( { powerPreference: 'high-performance' } );
  if ( !adapter ) throw new Error( 'No WebGPU adapter found.' );

  const device = await adapter.requestDevice();

  // Surface canvas size to actual pixels
  canvas.width  = window.innerWidth  * devicePixelRatio | 0;
  canvas.height = window.innerHeight * devicePixelRatio | 0;

  const context = canvas.getContext( 'webgpu' );
  const format  = navigator.gpu.getPreferredCanvasFormat();

  context.configure( { device, format, alphaMode: 'opaque' } );

  // Log any uncaptured GPU errors to the console
  device.addEventListener( 'uncapturederror', ( e ) => {
    console.error( '[WebGPU uncaptured error]', e.error );
  } );

  return { device, context, format };
}
