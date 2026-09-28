import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createLocalClient, listen } from '../dist/adapters/node.js';
import { createServer } from '../dist/server.js';
await build({ entryPoints: ['test/mock.ts'], outfile: '.artifacts/mock.mjs', platform: 'neutral', format: 'esm' });
const { mockUpstream } = await import('../.artifacts/mock.mjs');

await build({ stdin: { contents: `export {createRemoteClient} from './dist/remote.js'; export {createImageProcessor,createUrlWasmLoader} from './dist/image.js';`, resolveDir: process.cwd() }, outfile: '.artifacts/browser/sdk.js', bundle: true, format: 'esm', platform: 'browser' });
const isolated = await build({ entryPoints: ['dist/remote.js'], bundle: true, format: 'esm', platform: 'browser', write: false, metafile: true });
assert.ok(!Object.keys(isolated.metafile.inputs).some(x => /jsquash|image\.js|server\.js|crypto-js|adapters/.test(x)), 'Remote bundle imports local-only dependencies');
const fixtures = {};
for (const extension of ['png', 'webp', 'jpg']) fixtures[extension] = await readFile(`test/fixtures/17x103-10.${extension}`);
const staticServer = httpServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>SDK contract test</title>'); return; }
    const path = req.url === '/sdk.js' ? '.artifacts/browser/sdk.js' : req.url.startsWith('/wasm/') ? `dist${req.url}` : undefined;
    if (!path || path.includes('..')) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', path.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${staticServer.address().port}`;
const client = createLocalClient({ domains: ['api.test'], fetch: mockUpstream(fixtures.png) });
const api = await listen(createServer(client, { token: 'browser-test', allowedOrigins: [origin] }), { port: 0 });
try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage(); await page.goto(origin);
      const result = await page.evaluate(async ({ baseUrl, fixtures }) => {
        const { createRemoteClient, createImageProcessor, createUrlWasmLoader } = await import('/sdk.js');
        const client = createRemoteClient({ baseUrl, token: 'browser-test' });
        const processor = createImageProcessor({ loadWasm: createUrlWasmLoader(new URL('/wasm/', location.href)) });
        const search = await client.search('x'); const album = await client.getAlbum('123'); const chapter = await client.getChapter('123');
        const remote = await client.getImage('123', 0, { format: 'png' });
        const png = await processor.process(Uint8Array.from(fixtures.png), 10, { format: 'png' });
        const webp = await processor.process(Uint8Array.from(fixtures.webp), 10, { format: 'png' });
        const jpeg = await processor.process(Uint8Array.from(fixtures.jpg), 10);
        const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
        client.dispose();
        return { total: search.total, album: album.id, chapter: chapter.id, same: equal(remote.data, png.data) && equal(webp.data, png.data), jpeg: [jpeg.width, jpeg.height] };
      }, { baseUrl: `http://127.0.0.1:${api.address().port}`, fixtures: Object.fromEntries(Object.entries(fixtures).map(([k, v]) => [k, Array.from(v)])) });
      assert.deepEqual(result, { total: 1, album: '123', chapter: '123', same: true, jpeg: [17, 103] });
      console.log(`${engine.name()}: real CORS remote + PNG/WebP/JPEG WASM passed; remote bundle=${isolated.outputFiles[0].contents.length} bytes`);
    } finally { await browser.close(); }
  }
} finally { client.dispose(); await Promise.all([new Promise(r => { api.close(r); api.closeAllConnections(); }), new Promise(r => { staticServer.close(r); staticServer.closeAllConnections(); })]); }
