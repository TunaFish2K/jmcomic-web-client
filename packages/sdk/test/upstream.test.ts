import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpstreamClient } from '../dist/upstream.js';
import { mockUpstream } from './mock.js';

test('low-level metadata access preserves raw fields and never masks a forced refresh with a cache', async () => {
  const normal = mockUpstream(new Uint8Array()); let calls = 0;
  const client = createUpstreamClient({ domains: ['api.test'], retries: 0, fetch: async (url, init) => {
    if (new URL(String(url)).pathname === '/album') return Response.json({ data: { name: 'Album', description: null, total_views: String(++calls), extra_field: true } });
    return normal(url, init);
  } });
  try {
    assert.deepEqual(await client.initialize(), { baseUrl: 'https://api.test', imageBaseUrl: 'https://images.test', version: '2.0.16' });
    assert.deepEqual(await client.request('/album', { id: '123' }), { name: 'Album', description: null, total_views: '1', extra_field: true });
    assert.equal((await client.request('/album', { id: '123' })).total_views, '2');
    assert.match(await client.getChapterTemplate('123'), /scramble_id/);
  } finally { client.dispose(); }
});

test('low-level failures identify the operation without leaking credentials', async () => {
  const normal = mockUpstream(new Uint8Array());
  const client = createUpstreamClient({ domains: ['api.test'], retries: 0, fetch: (url, init) =>
    new URL(String(url)).pathname === '/chapter_view_template' ? Promise.resolve(new Response('missing', { status: 404 })) : normal(url, init) });
  try {
    await assert.rejects(client.getChapterTemplate('123'), (error: any) => {
      assert.equal(error.code, 'NOT_FOUND'); assert.equal(error.operation, 'chapter-template');
      assert.doesNotMatch(JSON.stringify(error), /sid=|mock|cookie/); return true;
    });
  } finally { client.dispose(); }
});
