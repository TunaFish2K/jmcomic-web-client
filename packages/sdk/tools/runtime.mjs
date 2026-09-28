import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createLocalClient, createNodeWasmLoader, listen } from '../dist/adapters/node.js';
import { createImageProcessor } from '../dist/image.js';
import { createServer } from '../dist/server.js';
import { createRemoteClient } from '../dist/remote.js';
// The orchestration script builds this without requiring TS loaders in each runtime.
const { mockUpstream } = await import('../.artifacts/mock.mjs');
const fixture = new Uint8Array(await readFile('test/fixtures/17x103-10.png'));
const client = createLocalClient({ domains: ['api.test'], fetch: mockUpstream(fixture), retries: 0 });
const handler = createServer(client, { token: 'contract-test' });
const runtime = globalThis.Deno ? 'Deno' : globalThis.Bun ? 'Bun' : 'Node';
let port, close;
if (globalThis.Deno) {
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, handler.fetch);
  port = server.addr.port; close = () => server.shutdown();
} else if (globalThis.Bun) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler.fetch });
  port = server.port; close = () => server.stop(true);
} else {
  const server = await listen(handler, { port: 0 });
  port = server.address().port; close = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
const remote = createRemoteClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'contract-test' });
try {
  assert.deepEqual(await remote.search('x'), await client.search('x'));
  assert.deepEqual(await remote.getAlbum('123'), await client.getAlbum('123'));
  assert.deepEqual(await remote.getChapter('123'), await client.getChapter('123'));
  assert.deepEqual(await remote.getImage('123', 0, { format: 'png' }), await client.getImage('123', 0, { format: 'png' }));
  const processor = createImageProcessor({ loadWasm: createNodeWasmLoader() });
  const png = await processor.process(fixture, 10, { format: 'png' });
  const webp = await processor.process(new Uint8Array(await readFile('test/fixtures/17x103-10.webp')), 10, { format: 'png' });
  assert.deepEqual(webp, png);
  const jpg = await processor.process(new Uint8Array(await readFile('test/fixtures/17x103-10.jpg')), 10);
  assert.equal(jpg.width, 17); assert.equal(jpg.height, 103);
  console.log(`${runtime}: local + real HTTP server + remote + PNG/WebP/JPEG WASM passed; png=${createHash('sha256').update(png.data).digest('hex')}`);
} finally { remote.dispose(); client.dispose(); await close(); }
