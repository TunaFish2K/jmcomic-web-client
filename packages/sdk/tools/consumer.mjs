// Copied to a workspace-external consumer directory by package.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer as httpServer } from 'node:http';
import { createLocalClient, listen } from 'jmcomic-sdk-pwa/node';
import { createServer } from 'jmcomic-sdk-pwa/server';
import { createRemoteClient, JmError } from 'jmcomic-sdk-pwa';
import { mockUpstream } from './mock.mjs';

const fixture = new Uint8Array(await readFile('image.png'));
const local = createLocalClient({ domains: ['api.test'], fetch: mockUpstream(fixture, { waitMs: 10 }), retries: 0 });
const server = await listen(createServer(local, { token: 'consumer-token', allowedOrigins: ['http://localhost:5173'] }), { port: 0 });
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const remote = createRemoteClient({ baseUrl, token: 'consumer-token' });
const clients = [local, remote];
const code = expected => error => error instanceof JmError && error.code === expected;
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
try {
  const search = await remote.search('fixture');
  assert.equal(search.items[0].id, '123');
  assert.deepEqual(search, await local.search('fixture'));
  const album = await remote.getAlbum(search.items[0].id);
  assert.equal(album.views, 1234);
  assert.deepEqual(album, await local.getAlbum(album.id));
  const chapter = await remote.getChapter(album.chapters[0].id);
  assert.equal(chapter.images.length, 1);
  assert.deepEqual(chapter, await local.getChapter(chapter.id));
  const image = await remote.getImage(chapter.id, 0, { format: 'png' });
  assert.equal(image.width, 17); assert.equal(image.height, 103);
  assert.deepEqual(image, await local.getImage(chapter.id, 0, { format: 'png' }));
  for (const client of clients) {
    await assert.rejects(client.getAlbum('404'), code('NOT_FOUND'));
    await assert.rejects(client.getAlbum('invalid'), code('INVALID_ARGUMENT'));
    await assert.rejects(client.search('cancel', { signal: AbortSignal.abort() }), code('ABORTED'));
  }
  const wrongToken = createRemoteClient({ baseUrl, token: 'wrong' }); clients.push(wrongToken);
  await assert.rejects(wrongToken.search('fixture'), error => code('UNAUTHORIZED')(error) && !!error.requestId);
  const slow = createRemoteClient({ baseUrl, token: 'consumer-token', timeoutMs: 1 }); clients.push(slow);
  await assert.rejects(slow.search('uncached-timeout'), code('TIMEOUT'));
  const preflight = await fetch(`${baseUrl}/v1/search`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.throws(() => createRemoteClient({ baseUrl: 'bad-url' }), code('INVALID_ARGUMENT'));
} finally { clients.forEach(client => client.dispose()); await close(server); }

// Exercise the installed executable, with real HTTP to a loopback mock origin.
const mock = mockUpstream(fixture);
const upstream = httpServer(async (req, res) => {
  try {
    const response = await mock(`https://api.test${req.url}`);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end(); }
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const executable = 'node_modules/.bin/jmcomic-sdk-pwa';
const manifest = JSON.parse(await readFile('node_modules/jmcomic-sdk-pwa/package.json', 'utf8'));
const env = { ...process.env, JM_HOST: '127.0.0.1', JM_PORT: '0', JM_TOKEN: 'cli-secret', JM_ORIGINS: ' http://localhost:5173 ', JM_DOMAINS: `http://127.0.0.1:${upstream.address().port}`, JM_DEBUG: '1' };
const invoke = (args, extra = {}) => spawnSync(executable, args, { env: { ...env, ...extra }, encoding: 'utf8', timeout: 5000 });
try {
  const version = invoke(['--version']); assert.equal(version.status, 0); assert.equal(version.stdout.trim(), manifest.version);
  const help = invoke(['--help']); assert.equal(help.status, 0); assert.match(help.stdout, /JM_DEBUG/);
  for (const args of [['typo'], ['serve', '--typo'], ['--version', 'serve']]) {
    const result = invoke(args); assert.equal(result.status, 1); assert.doesNotMatch(result.stdout, /listening/);
  }
  for (const port of ['', '-1', '65536', '3.5', 'NaN']) {
    const result = invoke(['serve'], { JM_PORT: port }); assert.equal(result.status, 1); assert.match(result.stderr, /JM_PORT/);
  }
  for (const args of [[], ['serve']]) {
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let stderr = '', stdout = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    let timer;
    try {
      const url = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('CLI did not start')), 5000);
        child.once('error', reject);
        child.once('exit', () => reject(new Error(`CLI exited before listening: ${stderr}`)));
        child.stdout.on('data', chunk => {
          stdout += chunk;
          const match = stdout.match(/listening on (127\.0\.0\.1:\d+)/);
          if (match) resolve(`http://${match[1]}`);
        });
      });
      clearTimeout(timer);
      const client = createRemoteClient({ baseUrl: url, token: env.JM_TOKEN, timeoutMs: 5000 });
      try { assert.equal((await client.search('private-search')).items[0].id, '123'); }
      finally { client.dispose(); }
      const response = await fetch(`${url}/v1/info`, { headers: { authorization: `Bearer ${env.JM_TOKEN}`, origin: 'http://localhost:5173' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    } finally {
      clearTimeout(timer); child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { const [status] = await exited; assert.equal(status, 0); }
      finally { clearTimeout(kill); }
    }
    assert.match(stderr, /"event":"request"/);
    for (const secret of ['cli-secret', 'private-search', 'sid=mock']) assert.ok(!stderr.includes(secret));
  }
} finally { await close(upstream); }
console.log('Installed tarball: local / HTTP / remote flow, typed failures, CORS, CLI lifecycle and safe debug logs passed');
