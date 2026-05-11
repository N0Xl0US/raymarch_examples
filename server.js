/**
 * server.js — Bun static file server for the WebGPU raymarcher.
 * Run with:  bun run dev
 */

import { extname } from 'path';

const PORT = 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

Bun.serve( {
  port: PORT,

  async fetch( req ) {
    const url      = new URL( req.url );
    let   pathname = url.pathname === '/' ? '/index.html' : url.pathname;

    // Serve file relative to project root
    const filePath = '.' + pathname;
    const file     = Bun.file( filePath );

    const exists = await file.exists();
    if ( !exists ) {
      return new Response( '404 Not Found', { status: 404 } );
    }

    const ext         = extname( filePath );
    const contentType = MIME[ ext ] ?? 'application/octet-stream';

    return new Response( file, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      },
    } );
  },
} );

console.log( `\n  🚀  WebGPU Raymarcher running at http://localhost:${ PORT }\n` );
