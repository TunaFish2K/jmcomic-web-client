import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { createCipheriv, createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { clearResourceCacheForTest } from '../src/resource-cache';
import { createUpstreamClient, discoverDomains } from 'jmcomic-sdk/upstream';

afterEach(() => { vi.unstubAllGlobals(); clearResourceCacheForTest(); });
function encrypted(value: unknown, key: string) {
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(key), Buffer.alloc(0));
  return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}
const md5 = (value: string) => createHash('md5').update(value).digest('hex');
it('retains PWA JSON, refresh, batching and concurrent request isolation using the actual SDK', async () => {
  let albumCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('.txt')) return new Response(encrypted({ Server: ['api.test'] }, md5('diosfjckwpqpdfjkvnqQjsik')));
    const headers = new Headers(init?.headers);
    const stamp = headers.get('tokenparam')!.split(',')[0];
    expect(headers.get('token')).toBe(md5(`${stamp}${url.pathname === '/chapter_view_template' ? '18comicAPPContent' : '18comicAPP'}`));
    const json = (value: unknown) => Response.json({ code: 200, data: encrypted(value, md5(`${stamp}185Hcomic3PAPP7R`)) });
    if (url.pathname === '/setting') return json({ version: '2.0.16', img_host: 'https://cdn.test' });
    if (url.pathname === '/search') return json({ search_query: url.searchParams.get('search_query'), total: '1', content: [{ id: '123', name: 'Album', author: 'Author' }] });
    if (url.pathname === '/album') {
      albumCalls++;
      return json({ name: url.searchParams.get('id') === '404' ? null : 'Album', images: ['001.png'], description: null, total_views: String(albumCalls), likes: '2', series: [], series_id: '', author: ['Author'], tags: ['Tag'], works: [], actors: [] });
    }
    if (url.pathname === '/chapter') return json({ name: 'Chapter', images: ['001.png'] });
    if (url.pathname === '/chapter_view_template') return new Response('var scramble_id = 1;');
    throw new Error(`Unexpected upstream path ${url.pathname}`);
  }));
  expect(await discoverDomains({ discoveryUrls: ['https://discovery.test/domains.txt'], retries: 0 })).toEqual(['https://api.test']);
  const probe = createUpstreamClient({ domains: ['https://api.test'], retries: 0 });
  try { expect((await probe.initialize()).version).toBe('2.0.16'); } finally { probe.dispose(); }
  async function request(path: string) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(`https://app.test${path}`), env, ctx);
    await waitOnExecutionContext(ctx); return response;
  }
  const search = await request('/search?query=sdk-migration');
  expect(await search.json()).toEqual({ search_query: 'sdk-migration', total: '1', content: [{ id: '123', name: 'Album', author: 'Author' }] });
  const first = await request('/album/123');
  const initial: any = await first.json();
  expect(initial).toMatchObject({ id: '123', images: ['001.png'], description: null, totalViews: '1', likes: '2', seriesID: '', author: ['Author'] });
  expect(first.headers.get('X-Cache-Meta')).toBeTruthy();
  expect((await (await request('/album/123')).json() as any).totalViews).toBe('1');
  expect(albumCalls).toBe(1);
  expect((await (await request('/album/123?refresh=1')).json() as any).totalViews).toBe('2');
  const photos = await Promise.all([request('/photo/123?refresh=1'), request('/photo/123?refresh=1')]);
  for (const response of photos) expect(await response.json()).toEqual({ id: '123', name: 'Chapter', images: [{ name: '001.png', url: 'https://cdn.test/media/photos/123/001.png' }], scrambleId: 1 });
  const batch: any = await (await request('/batch-album?ids=123,404')).json();
  expect(batch[0].album.name).toBe('Album'); expect(batch[1].album).toBeNull(); expect(batch[1].error.stage).toBe('get_album');
  expect((await request('/album/404')).status).toBe(404);
});
