import { readFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import { createLocalClient as local } from '../local.js';
import type { LocalOptions } from '../local.js';
import type { WasmLoader } from '../image.js';
import type { JmServer } from '../server.js';
import { JmError } from '../errors.js';
export { createServer } from '../server.js';

export function createNodeWasmLoader(): WasmLoader {
  const names = { 'jpeg-dec': 'mozjpeg_dec.wasm', 'jpeg-enc': 'mozjpeg_enc.wasm', png: 'squoosh_png_bg.wasm', 'webp-dec': 'webp_dec.wasm' };
  return async name => WebAssembly.compile(await readFile(new URL(`../wasm/${names[name]}`, import.meta.url)));
}
export function createLocalClient(options: LocalOptions = {}) {
  return local({ ...options, image: { loadWasm: createNodeWasmLoader(), ...options.image } });
}
export interface ListenOptions { host?: string; port?: number; tokenConfigured?: boolean }
export async function listen(handler: JmServer, options: ListenOptions = {}) {
  const host = options.host ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !options.tokenConfigured)
    throw new JmError('INVALID_ARGUMENT', 'An access token is required for non-loopback listeners');
  const server = httpServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    outgoing.once('close', () => { if (!outgoing.writableFinished) controller.abort(); });
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const response = await handler.fetch(new Request(new URL(incoming.url ?? '/', 'http://localhost'), { method: incoming.method, headers, signal: controller.signal }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) { const { value, done } = await reader.read(); if (done) break;
            if (!outgoing.write(value)) await once(outgoing, 'drain', { signal: controller.signal }); }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      outgoing.end();
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end(); }
  });
  server.listen(options.port ?? 3000, host); await once(server, 'listening');
  return server;
}
