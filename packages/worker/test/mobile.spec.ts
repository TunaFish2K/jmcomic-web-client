import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { createCipheriv, createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { clearResourceCacheForTest } from '../src/resource-cache';

const md5 = (value: string) => createHash('md5').update(value).digest('hex');
function encrypted(value: unknown, key: string) {
	const cipher = createCipheriv('aes-256-ecb', Buffer.from(key), Buffer.alloc(0));
	return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}
const comic = (id: string) => ({ id, author: 'Author', name: `Album ${id}`, image: '', category: { id: '2', title: '單本' }, liked: false, is_favorite: false, update_at: 1 });

let calls: URL[] = [];
beforeEach(() => {
	calls = [];
	vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('.txt')) return new Response(encrypted({ Server: ['api.test'] }, md5('diosfjckwpqpdfjkvnqQjsik')));
		const headers = new Headers(init?.headers);
		const stamp = headers.get('tokenparam')!.split(',')[0];
		const json = (value: unknown) => Response.json({ code: 200, data: encrypted(value, md5(`${stamp}185Hcomic3PAPP7R`)) });
		if (url.pathname === '/setting') return json({ version: '2.0.16', img_host: 'https://cdn.test' });
		calls.push(url);
		expect(headers.get('token')).toBe(md5(`${stamp}185Hcomic3PAPP7R`));
		expect(headers.get('tokenparam')).toBe(`${stamp},2.1.9`);
		expect(headers.get('authorization')).toBeNull();
		if (url.pathname === '/promote') return json([{ id: '26', title: 'Hot', slug: '', type: 'promote', filter_val: '26', content: [comic('1')] }]);
		if (url.pathname === '/latest') return json([comic(`latest-${url.searchParams.get('page')}`)].map((item, index) => ({ ...item, id: String(100 + index) })));
		if (url.pathname === '/categories/filter') return json({ search_query: '', total: 1, content: [comic('2')], tags: [] });
		if (url.pathname === '/hot_tags') return json(['tag-a', 'tag-b']);
		if (url.pathname === '/random_recommend') return json([comic('3')]);
		if (url.pathname === '/forum') return json({ total: '1', list: [{ CID: '9', AID: url.searchParams.get('aid'), UID: '1', username: 'u', nickname: 'Nick', content: 'Hi', likes: '0', addtime: 'now', parent_CID: '0', spoiler: '0' }] });
		if (url.pathname === '/week') return Response.json({ code: 500, errorMsg: 'maintenance' }, { status: 200 });
		throw new Error(`Unexpected upstream path ${url.pathname}`);
	}));
});
afterEach(() => { vi.unstubAllGlobals(); clearResourceCacheForTest(); });

async function request(path: string, init?: RequestInit, bindings: Env = env) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`https://app.test${path}`, init), bindings, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

it('serves discovery data with APK signing, public caching and an edge cache hit', async () => {
	const first = await request('/api/mobile/promote');
	expect(first.status).toBe(200);
	expect(first.headers.get('Cache-Control')).toBe('public, max-age=300');
	expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');
	expect(first.headers.get('X-Cache')).toBe('miss');
	expect(await first.json()).toEqual([{ id: '26', title: 'Hot', type: 'promote', filterValue: '26', items: [{ id: '1', name: 'Album 1', author: 'Author', image: '', category: { id: '2', title: '單本' }, liked: false, favorite: false, updatedAt: 1 }] }]);
	const second = await request('/api/mobile/promote');
	expect(second.headers.get('X-Cache')).toBe('edge');
	expect(await second.json()).toHaveLength(1);
	expect(calls.filter(url => url.pathname === '/promote')).toHaveLength(1);
});

it('validates and forwards query parameters', async () => {
	const filtered = await request('/api/mobile/categories/filter?c=doujin&o=mv_m&page=2');
	expect(await filtered.json()).toMatchObject({ total: 1, items: [{ id: '2' }] });
	const upstream = calls.find(url => url.pathname === '/categories/filter')!;
	expect(Object.fromEntries(upstream.searchParams)).toEqual({ c: 'doujin', o: 'mv_m', page: '2', lang: 'TW' });
	expect((await request('/api/mobile/latest?page=0')).status).toBe(200);
	expect(calls.at(-1)!.searchParams.get('page')).toBe('0');
	const comments: any = await (await request('/api/mobile/comments?aid=123')).json();
	expect(comments.items[0]).toMatchObject({ id: '9', albumId: '123', username: 'Nick', parentId: null });

	for (const path of ['/api/mobile/categories/filter?o=drop', '/api/mobile/comments?aid=abc', '/api/mobile/latest?page=-1', '/api/mobile/week/filter?id=1']) {
		const response = await request(path);
		expect(response.status).toBe(400);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
	}
});

it('never caches random recommendations and reports upstream refusals as JSON errors', async () => {
	const random = await request('/api/mobile/random');
	expect(random.headers.get('Cache-Control')).toBe('no-store');
	await request('/api/mobile/random');
	expect(calls.filter(url => url.pathname === '/random_recommend')).toHaveLength(2);

	const refused = await request('/api/mobile/week');
	expect(refused.status).toBe(422);
	expect(await refused.json()).toEqual({ error: { code: 'UPSTREAM_REJECTED', message: 'Upstream rejected the request: maintenance' } });
});

it('reports account availability, rejects unknown routes and non-GET methods', async () => {
	expect(await (await request('/api/mobile/config')).json()).toEqual({ accountEnabled: false });
	expect(await (await request('/api/mobile/config', undefined, { ...env, ACCOUNT_SESSION_KEY: 'k' })).json()).toEqual({ accountEnabled: true });
	const unknown = await request('/api/mobile/anything');
	expect(unknown.status).toBe(404);
	expect(await unknown.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
	const post = await request('/api/mobile/promote', { method: 'POST' });
	expect(post.status).toBe(405);
	expect(calls).toHaveLength(0);
});
