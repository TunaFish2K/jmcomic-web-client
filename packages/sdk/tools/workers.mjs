import { build } from 'esbuild';
import { readFile, mkdir, cp } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
import { createRemoteClient } from '../dist/remote.js';
import { createImageProcessor } from '../dist/image.js';
import { createNodeWasmLoader } from '../dist/adapters/node.js';

const fixture = await readFile('test/fixtures/17x103-10.png');
const webp = await readFile('test/fixtures/17x103-10.webp');
const jpeg = await readFile('test/fixtures/17x103-10.jpg');
const fullSize = await readFile('test/fixtures/720x1016-2.webp');
await mkdir('.artifacts/worker', { recursive: true });
await cp('dist/wasm', '.artifacts/worker/wasm', { recursive: true });
await build({ stdin: { contents: `
import {createWorkersServer} from './dist/adapters/workers.js';
import {createImageProcessor} from './dist/image.js';
import {mockUpstream} from './test/mock.ts';
import jpegDec from './wasm/mozjpeg_dec.wasm';
import jpegEnc from './wasm/mozjpeg_enc.wasm';
import png from './wasm/squoosh_png_bg.wasm';
import webpDec from './wasm/webp_dec.wasm';
const wasm={'jpeg-dec':jpegDec,'jpeg-enc':jpegEnc,png,'webp-dec':webpDec};
const fixture=Uint8Array.from(${JSON.stringify([...fixture])});
const server=createWorkersServer({wasm,domains:['api.test'],fetch:mockUpstream(fixture),token:'worker-test'});
const processor=createImageProcessor({loadWasm:async name=>wasm[name],maxPixels:1500000});
export default {async fetch(request) {
  if(new URL(request.url).pathname==='/codecs') {
    try {
      const webp=await processor.process(Uint8Array.from(${JSON.stringify([...webp])}),10,{format:'png'});
      const jpeg=await processor.process(Uint8Array.from(${JSON.stringify([...jpeg])}),10);
      const full=await processor.process(Uint8Array.from(${JSON.stringify([...fullSize])}),2,{maxSide:720});
      let limit;
      const header=Uint8Array.from(${JSON.stringify([...fixture.subarray(0, 40)])});
      new DataView(header.buffer).setUint32(16,2000);new DataView(header.buffer).setUint32(20,2000);
      try {await processor.process(header,0);} catch(e) {limit=e.code;}
      return Response.json({webp:Array.from(webp.data),jpeg:[jpeg.width,jpeg.height],full:[full.width,full.height],limit});
    } catch(e) { return Response.json({message:e.message,cause:String(e.cause),stack:e.stack},{status:500}); }
  }
  return server.fetch(request);
}};`, resolveDir: process.cwd() }, outfile: '.artifacts/worker/index.mjs', bundle: true, format: 'esm', platform: 'browser', external: ['./wasm/*.wasm'], logLevel: 'warning' });
const mf = new Miniflare({ modules: true, scriptPath: '.artifacts/worker/index.mjs', compatibilityDate: '2026-07-30', modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }] });
const remote = createRemoteClient({ baseUrl: 'https://worker.test', token: 'worker-test', fetch: (url, init) => mf.dispatchFetch(String(url), init) });
try {
  assert.equal((await remote.search('x')).total, 1); assert.equal((await remote.getAlbum('123')).id, '123'); assert.equal((await remote.getChapter('123')).id, '123');
  const [first, second] = await Promise.all([remote.getImage('123', 0, { format: 'png' }), remote.getImage('123', 0, { format: 'png' })]);
  const expected = await createImageProcessor({ loadWasm: createNodeWasmLoader() }).process(fixture, 10, { format: 'png' });
  assert.deepEqual(first, expected); assert.deepEqual(second, expected);
  const response = await mf.dispatchFetch('https://worker.test/codecs'); const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(result.webp, [...expected.data]); assert.deepEqual(result.jpeg, [17, 103]);
  assert.deepEqual(result.full, [510, 720]); assert.equal(result.limit, 'IMAGE_LIMIT');
  console.log('workerd: request-scoped service + concurrent remote calls + static WASM PNG/WebP/JPEG + 720x1016 image + pixel limit passed');
} finally { remote.dispose(); await mf.dispose(); }
