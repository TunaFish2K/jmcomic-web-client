import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { createLocalClient, createServer, listen } from '../dist/adapters/node.js';
import { createRemoteClient } from '../dist/remote.js';
import { sliceCount } from '../dist/image.js';

const agent = process.env.JM_TEST_PROXY ? new ProxyAgent(`http://${process.env.JM_TEST_PROXY}`) : undefined;
const events = [];
const client = createLocalClient({
  fetch: agent ? (input, init) => undiciFetch(input, { ...init, dispatcher: agent }) : undefined,
  logger: event => { events.push(event); console.log(JSON.stringify(event)); },
});
const server = await listen(createServer(client, { token: 'local-real-test' }), { port: 0 });
const remote = createRemoteClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'local-real-test' });
const start = Date.now();
try {
  const search = await client.search(process.env.JM_TEST_QUERY ?? '291535');
  assert.ok(search.redirectId || search.items.length);
  const albumId = search.redirectId ?? search.items[0].id;
  const album = await client.getAlbum(albumId);
  assert.ok(album.name);
  assert.deepEqual(await remote.getAlbum(albumId), album);
  const chapterId = album.chapters[0]?.id ?? album.id;
  const chapter = await client.getChapter(chapterId);
  assert.ok(chapter.images.length);
  assert.deepEqual(await remote.getChapter(chapterId), chapter);
  const variants = await Promise.all([480, 720, 1080].map(maxSide => client.getImage(chapterId, 0, { maxSide })));
  assert.deepEqual(await remote.getImage(chapterId, 0, { maxSide: 720 }), variants[1]);
  const report = { timestamp: new Date().toISOString(), elapsedMs: Date.now() - start,
    search: { total: search.total, redirect: !!search.redirectId }, albumId, chapterId, pageCount: chapter.images.length,
    images: variants.map(image => ({ width: image.width, height: image.height, mime: image.mime,
      bytes: image.data.length, sha256: createHash('sha256').update(image.data).digest('hex') })),
    slices: sliceCount(chapter.scrambleId, Number(chapterId), chapter.images[0].name),
    imageDownloads: events.filter(e => e.operation === 'image' && e.event === 'request').length,
    checks: ['discovery', 'signed settings', 'search', 'album', 'chapter and scramble', 'real image restore', 'three sizes reuse original', 'HTTP remote equality'],
  };
  assert.equal(report.imageDownloads, 1);
  assert.ok(report.slices > 0, 'The real fixture must exercise image restoration');
  await mkdir('.artifacts', { recursive: true });
  await writeFile('.artifacts/real-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  remote.dispose(); client.dispose();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await agent?.close();
}
