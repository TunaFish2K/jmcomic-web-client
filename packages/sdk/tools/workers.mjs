import { build } from 'esbuild';
import { readFile, mkdir, cp } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createCipheriv, createHash } from 'node:crypto';
import { createRemoteClient } from '../dist/remote.js';
import { createImageProcessor } from '../dist/image.js';
import { createNodeWasmLoader } from '../dist/adapters/node.js';

const fixture = await readFile('test/fixtures/17x103-10.png');
const webp = await readFile('test/fixtures/17x103-10.webp');
const jpeg = await readFile('test/fixtures/17x103-10.jpg');
const fullSize = await readFile('test/fixtures/720x1016-2.webp');
// Use a real loopback HTTP origin so workerd validates RequestInit and performs
// network I/O itself. An injected fetch mock cannot catch unsupported options.
const digest = value => createHash('md5').update(value).digest('hex');
const encrypt = (value, key) => {
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(key), null);
  return Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64');
};
let redirected = 0, signed = 0, cookies = 0, authorized = 0;
const upstream = httpServer((request, response) => {
  const url = new URL(request.url, origin);
  if (url.pathname === '/should-not-follow') { redirected++; response.end('wrong destination'); return; }
  if (url.pathname === '/redirect/v1/search' || url.pathname === '/album' && url.searchParams.get('id') === '302') {
    response.writeHead(302, { location: '/should-not-follow' }); response.end(); return;
  }
  if (url.pathname === '/v1/search') {
    if (request.headers.authorization === 'Bearer transport-test') authorized++;
    response.writeHead(200, { 'x-jm-protocol': '1', 'content-type': 'application/json' });
    response.end(JSON.stringify({ query: 'x', total: 1, redirectId: null, items: [{ id: '123', name: 'Fixture', authors: [] }] })); return;
  }
  if (url.pathname === '/domains.txt') { response.end(encrypt({ Server: [origin] }, digest('diosfjckwpqpdfjkvnqQjsik'))); return; }
  if (url.pathname.startsWith('/media/')) { response.writeHead(200, { 'content-type': 'image/png' }); response.end(fixture); return; }
  const stamp = request.headers.tokenparam?.split(',')[0];
  const content = url.pathname === '/chapter_view_template';
  if (request.headers.token !== digest(`${stamp}${content ? '18comicAPPContent' : '18comicAPP'}`)) { response.writeHead(401); response.end(); return; }
  signed++;
  if (request.headers.cookie === 'sid=wire') cookies++;
  if (content) { response.end('var scramble_id = 1;'); return; }
  const data = url.pathname === '/setting' ? { version: '2.0.16', img_host: origin }
    : url.pathname === '/search' ? { total: '1', content: [{ id: 123, name: 'Fixture', author: [] }] }
    : url.pathname === '/chapter' ? { name: 'Chapter', images: ['00001.png'] }
    : { id: 123, name: 'Fixture', description: null, author: [], tags: [], series: [] };
  response.writeHead(200, { 'set-cookie': 'sid=wire; Path=/; HttpOnly', 'content-type': 'application/json' });
  response.end(JSON.stringify({ code: 200, data: encrypt(data, digest(`${stamp}185Hcomic3PAPP7R`)) }));
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
upstream.unref();
const origin = `http://127.0.0.1:${upstream.address().port}`;
await mkdir('.artifacts/worker', { recursive: true });
await cp('dist/wasm', '.artifacts/worker/wasm', { recursive: true });
await build({ stdin: { contents: `
import {createWorkersServer} from './dist/adapters/workers.js';
import {createUpstreamClient} from './dist/upstream.js';
import {createLocalClient} from './dist/local.js';
import {createRemoteClient} from './dist/remote.js';
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
  if(new URL(request.url).pathname==='/transport') {
    const core=createUpstreamClient({discoveryUrls:[${JSON.stringify(origin + '/domains.txt')}],retries:0});
    const local=createLocalClient({domains:[${JSON.stringify(origin)}],image:{loadWasm:async name=>wasm[name]},retries:0});
    const remote=createRemoteClient({baseUrl:${JSON.stringify(origin)},token:'transport-test'});
    const redirect=createRemoteClient({baseUrl:${JSON.stringify(origin + '/redirect/')},token:'transport-test'});
    try {
      const info=await core.initialize();
      const search=await core.request('/search',{search_query:'x'});
      const image=await local.getImage('123',0,{format:'png'});
      const result=await remote.search('x');
      let upstreamRedirect,remoteRedirect;
      try {await core.request('/album',{id:'302'})} catch(e) {upstreamRedirect=e.code}
      try {await redirect.search('x')} catch(e) {remoteRedirect=e.code}
      return Response.json({version:info.version,total:search.total,image:[image.width,image.height],remoteTotal:result.total,upstreamRedirect,remoteRedirect});
    } catch(e) {return Response.json({message:e.message,cause:String(e.cause)},{status:500})}
    finally {core.dispose();local.dispose();remote.dispose();redirect.dispose()}
  }
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
  const transportResponse = await mf.dispatchFetch('https://worker.test/transport');
  const transportResult = await transportResponse.json();
  assert.equal(transportResponse.status, 200, JSON.stringify(transportResult));
  assert.deepEqual(transportResult, { version: '2.0.16', total: '1', image: [17, 103], remoteTotal: 1, upstreamRedirect: 'UPSTREAM', remoteRedirect: 'UPSTREAM' });
  assert.equal(redirected, 0); assert.ok(signed > 0); assert.ok(cookies > 0); assert.equal(authorized, 1);
  console.log('workerd: native HTTP transport + encrypted discovery/metadata + signed headers/cookies + image download + remote mode + redirect rejection passed');
  assert.equal((await remote.search('x')).total, 1); assert.equal((await remote.getAlbum('123')).id, '123'); assert.equal((await remote.getChapter('123')).id, '123');
  const [first, second] = await Promise.all([remote.getImage('123', 0, { format: 'png' }), remote.getImage('123', 0, { format: 'png' })]);
  const expected = await createImageProcessor({ loadWasm: createNodeWasmLoader() }).process(fixture, 10, { format: 'png' });
  assert.deepEqual(first, expected); assert.deepEqual(second, expected);
  const response = await mf.dispatchFetch('https://worker.test/codecs'); const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(result.webp, [...expected.data]); assert.deepEqual(result.jpeg, [17, 103]);
  assert.deepEqual(result.full, [510, 720]); assert.equal(result.limit, 'IMAGE_LIMIT');
  console.log('workerd: request-scoped service + concurrent remote calls + static WASM PNG/WebP/JPEG + 720x1016 image + pixel limit passed');
} finally { remote.dispose(); await mf.dispose(); await new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); }); }
