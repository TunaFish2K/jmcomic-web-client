import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createLocalClient, createNodeWasmLoader } from '../dist/adapters/node.js';
import { createServer } from '../dist/server.js';
import { createRemoteClient } from '../dist/remote.js';
import { decodeEnvelope, decrypt, md5, sliceCount } from '../dist/protocol.js';
import { Flights, MemoryCache, Gate } from '../dist/runtime.js';
import { createImageProcessor } from '../dist/image.js';
import { mockUpstream } from './mock.js';
import type { Fetch } from '../dist/types.js';

const fixture = new Uint8Array(await readFile(new URL('./fixtures/17x103-10.png', import.meta.url)));
const local = (fetch = mockUpstream(fixture), other = {}) => createLocalClient({ domains: ['api.test'], retries: 0, fetch, ...other });
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code: string }).code, expected); return true; };
function encrypt(value: string, key: string) {
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(key), null);
  return Buffer.concat([cipher.update(value), cipher.final()]).toString('base64');
}

test('encrypted payloads, JSON-string envelopes and malformed values', () => {
  const stamp = 1720000000;
  const data = { name: '中文', total: '1' };
  const key = createHash('md5').update(`${stamp}185Hcomic3PAPP7R`).digest('hex');
  const payload = JSON.stringify({ code: 200, data: encrypt(JSON.stringify(data), key) });
  assert.deepEqual(decodeEnvelope(payload, stamp), data);
  assert.deepEqual(decodeEnvelope(JSON.stringify(payload), stamp), data);
  assert.deepEqual(decodeEnvelope(JSON.stringify({ data: JSON.stringify(data) }), stamp), data);
  for (const invalid of ['<html>error</html>', '[]', '{"data":12}', '{"data":"broken"}', '{"data":null}'])
    assert.throws(() => decodeEnvelope(invalid, stamp), code('INVALID_RESPONSE'));
  const secret = md5('diosfjckwpqpdfjkvnqQjsik');
  assert.equal(decrypt(encrypt('{"Server":["api.test"]}', secret), secret), '{"Server":["api.test"]}');
});

test('slice count boundaries and GIF passthrough', () => {
  assert.equal(sliceCount(100, 99, 'x.jpg'), 0); assert.equal(sliceCount(1, 200000, 'x.jpg'), 10);
  assert.equal(sliceCount(1, 500000, 'x.GIF'), 0);
  for (const id of [268850, 421925, 421926, 500000]) {
    const hash = createHash('md5').update(`${id}00001`).digest('hex');
    assert.equal(sliceCount(1, id, '00001.jpg'), (hash.charCodeAt(31) % (id < 421926 ? 10 : 8)) * 2 + 2);
  }
});

test('local/server/remote return identical data, binary images and typed errors', async () => {
  const client = local(), server = createServer(client, { token: 'test-token', allowedOrigins: ['https://app.test'] });
  const remote = createRemoteClient({ baseUrl: 'https://sdk.test', token: 'test-token', fetch: (async (url, init) => server.fetch(new Request(url, init))) as Fetch });
  try {
    assert.deepEqual(await remote.search('sample'), await client.search('sample'));
    assert.deepEqual(await remote.getAlbum('123'), await client.getAlbum('123'));
    assert.deepEqual(await remote.getChapter('123'), await client.getChapter('123'));
    assert.deepEqual(await remote.getImage('123', 0, { format: 'png' }), await client.getImage('123', 0, { format: 'png' }));
    await assert.rejects(remote.getAlbum('404'), (error: any) => { assert.equal(error.code, 'NOT_FOUND'); assert.ok(error.requestId); return true; });
    await assert.rejects(remote.search('x', { page: 0 }), code('INVALID_ARGUMENT'));
    await assert.rejects(client.getImage('123', 1), code('NOT_FOUND'));
    const unauthorized = await server.fetch(new Request('https://sdk.test/v1/info'));
    assert.equal(unauthorized.status, 401);
    const mismatch = await server.fetch(new Request('https://sdk.test/v1/info', { headers: { authorization: 'Bearer test-token', 'x-jm-protocol': '2' } }));
    assert.equal(mismatch.status, 409);
    const preflight = await server.fetch(new Request('https://sdk.test/v1/search', { method: 'OPTIONS', headers: { origin: 'https://app.test' } }));
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.test');
    const denied = await server.fetch(new Request('https://sdk.test/v1/info', { headers: { origin: 'https://evil.test' } }));
    assert.equal(denied.status, 401);
  } finally { remote.dispose(); client.dispose(); }
});

test('five concurrent variants download one source, caller mutations cannot corrupt cache', async () => {
  let downloads = 0;
  const client = local(mockUpstream(fixture, { waitMs: 5, onRequest: url => { if (url.pathname.startsWith('/media/')) downloads++; } }));
  try {
    const images = await Promise.all([101, 90, 80, 70, 60].map(maxSide => client.getImage('123', 0, { maxSide })));
    assert.equal(downloads, 1); assert.deepEqual(images.map(x => x.height), [101, 90, 80, 70, 60]);
    const expected = images[0]!.data.slice(); images[0]!.data.fill(0);
    assert.deepEqual((await client.getImage('123', 0, { maxSide: 101 })).data, expected);
    const album = await client.getAlbum('123'); album.tags.push('mutated');
    assert.deepEqual((await client.getAlbum('123')).tags, ['tag']);
  } finally { client.dispose(); }
});

test('one subscriber cancellation preserves shared request; all cancellation aborts transport', async () => {
  let searches = 0;
  const client = local(mockUpstream(fixture, { waitMs: 15, onRequest: url => { if (url.pathname === '/search') searches++; } }));
  try {
    const controller = new AbortController();
    const cancelled = client.search('x', { signal: controller.signal });
    const surviving = client.search('x'); controller.abort();
    await assert.rejects(cancelled, code('ABORTED')); assert.equal((await surviving).items.length, 1); assert.equal(searches, 1);
    const flights = new Flights(); let aborted = false;
    const ctrl = new AbortController();
    const pending = flights.run('work', ctrl.signal, async signal => {
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }));
    });
    await Promise.resolve(); ctrl.abort(); await assert.rejects(pending, code('ABORTED')); assert.ok(aborted);
  } finally { client.dispose(); }
});

test('valid settings selection, signed requests, cookies, endpoint failure triggers failover', async () => {
  const normal = mockUpstream(fixture); let failed = false; const hosts: string[] = [];
  const transport: Fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/setting' && url.host === 'bad.test') return new Response('<html>blocked</html>');
    if (url.pathname === '/search') {
      hosts.push(url.host);
      const h = new Headers(init?.headers); const stamp = h.get('tokenparam')!.split(',')[0];
      assert.equal(h.get('token'), createHash('md5').update(`${stamp}18comicAPP`).digest('hex'));
      assert.equal(h.get('cookie'), 'sid=mock');
      if (url.host === 'first.test' && !failed) { failed = true; return new Response('error', { status: 503 }); }
    }
    if (url.host === 'second.test' && !failed) await new Promise(r => setTimeout(r, 20));
    return normal(input, init);
  };
  const client = local(transport, { domains: ['bad.test', 'first.test', 'second.test'] });
  try { assert.equal((await client.search('x')).total, 1); assert.deepEqual(hosts, ['first.test', 'second.test']); }
  finally { client.dispose(); }
});

test('discovery decrypts domains and rejects malformed sources', async () => {
  const normal = mockUpstream(fixture); let discoveries = 0;
  const client = createLocalClient({ discoveryUrls: ['https://discovery.test/a', 'https://discovery.test/b'], retries: 0, fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.host === 'discovery.test') {
      discoveries++; return new Response(url.pathname === '/a' ? 'invalid' : encrypt(JSON.stringify({ Server: ['api.test'] }), md5('diosfjckwpqpdfjkvnqQjsik')));
    }
    return normal(input, init);
  } });
  try { assert.equal((await client.search('x')).total, 1); assert.equal(discoveries, 2); } finally { client.dispose(); }
});

test('rate-limit retries, timeout covers response body, disposal rejects new work', async () => {
  const normal = mockUpstream(fixture); let calls = 0;
  const client = local(async (input, init) => {
    if (new URL(String(input)).pathname === '/search' && calls++ === 0)
      return new Response('retry', { status: 429, headers: { 'retry-after': '0.001' } });
    return normal(input, init);
  }, { retries: 1 });
  assert.equal((await client.search('x')).total, 1); assert.equal(calls, 2); client.dispose();
  await assert.rejects(client.search('x'), code('DISPOSED'));
  const remote = createRemoteClient({ baseUrl: 'https://sdk.test', timeoutMs: 10, fetch: (async (_, init) => new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener('abort', () => controller.error(new DOMException('abort', 'AbortError')));
  } }), { headers: { 'x-jm-protocol': '1' } })) as Fetch });
  try { await assert.rejects(remote.search('x'), code('TIMEOUT')); } finally { remote.dispose(); }
});

test('bounded cache evicts LRU and expired entries; queued image work cancels', async () => {
  const cache = new MemoryCache(4);
  await cache.set('a', new Uint8Array([1, 2]), 1000); await cache.set('b', new Uint8Array([3, 4]), 1000);
  await cache.get('a'); await cache.set('c', new Uint8Array([5, 6]), 1000); assert.equal(await cache.get('b'), undefined);
  await cache.set('expired', new Uint8Array([7]), -1); assert.equal(await cache.get('expired'), undefined);
  const gate = new Gate(1); let finish!: () => void;
  const running = gate.run(undefined, () => new Promise<void>(resolve => finish = resolve));
  const ctrl = new AbortController(); const waiting = gate.run(ctrl.signal, async () => assert.fail('Cancelled work ran'));
  ctrl.abort(); await assert.rejects(waiting, code('ABORTED')); finish(); await running;
});

test('image limits, unsupported inputs and original format are explicit', async () => {
  const processor = createImageProcessor({ loadWasm: createNodeWasmLoader(), maxPixels: 100 });
  await assert.rejects(processor.process(fixture, 10), code('IMAGE_LIMIT'));
  const normal = createImageProcessor({ loadWasm: createNodeWasmLoader() });
  await assert.rejects(normal.process(new Uint8Array([1, 2, 3]), 0), code('UNSUPPORTED_IMAGE'));
  await assert.rejects(normal.process(fixture, 10, { format: 'original' }), code('INVALID_ARGUMENT'));
  assert.deepEqual((await normal.process(fixture, 0, { format: 'original' })).data, fixture);
  await assert.rejects(normal.process(fixture.subarray(0, 40), 10), code('INVALID_RESPONSE'));
});

test('failed decoding evicts raw cache so the next attempt can recover', async () => {
  const normal = mockUpstream(fixture); let downloads = 0;
  const client = local(async (input, init) => {
    if (new URL(String(input)).pathname.startsWith('/media/') && downloads++ === 0)
      return new Response(fixture.slice(0, 40).buffer);
    return normal(input, init);
  });
  try {
    await assert.rejects(client.getImage('123', 0), code('INVALID_RESPONSE'));
    assert.equal((await client.getImage('123', 0)).height, 103); assert.equal(downloads, 2);
  } finally { client.dispose(); }
});

test('GIF returns original bytes, excess input rejects before WASM loading', async () => {
  const gif = new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  let loaded = false;
  const processor = createImageProcessor({ loadWasm: async () => { loaded = true; throw new Error('Unexpected WASM load'); }, maxInputBytes: 100 });
  assert.deepEqual((await processor.process(gif, 0)).data, gif);
  await assert.rejects(processor.process(new Uint8Array(101), 0), code('IMAGE_LIMIT'));
  assert.equal(loaded, false);
});

test('cache expires entries and concurrent replacement keeps byte accounting correct', async () => {
  const cache = new MemoryCache(4);
  await Promise.all([cache.set('a', new Uint8Array(2), 1), cache.set('a', new Uint8Array(2), 1)]);
  await cache.set('b', new Uint8Array(2), 1000);
  assert.ok(await cache.get('a')); assert.ok(await cache.get('b'));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await cache.get('a'), undefined); assert.ok(await cache.get('b'));
});

test('immediate cancellation does not start transport work', async () => {
  const flights = new Flights(), ctrl = new AbortController();
  let started = false;
  const pending = flights.run('x', ctrl.signal, async () => { started = true; });
  ctrl.abort(); await assert.rejects(pending, code('ABORTED'));
  await Promise.resolve(); assert.equal(started, false);
});

test('remote rejects malformed typed responses and invalid calls use promise rejection in both modes', async () => {
  const remote = createRemoteClient({ baseUrl: 'https://sdk.test', fetch: (async () => new Response('{}', { headers: { 'x-jm-protocol': '1' } })) as Fetch });
  const client = local();
  try {
    await assert.rejects(remote.search('x'), code('INVALID_RESPONSE'));
    await assert.rejects(remote.getAlbum('123'), code('INVALID_RESPONSE'));
    await assert.rejects(remote.getChapter('123'), code('INVALID_RESPONSE'));
    for (const api of [client, remote]) {
      const result = api.getAlbum('not-an-id'); assert.ok(result instanceof Promise);
      await assert.rejects(result, code('INVALID_ARGUMENT'));
    }
  } finally { remote.dispose(); client.dispose(); }
});
