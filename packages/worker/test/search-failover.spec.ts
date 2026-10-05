import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { createCipheriv, createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';

const md5 = (value: string) => createHash('md5').update(value).digest('hex');
function encrypted(value: unknown, key: string) {
	const cipher = createCipheriv('aes-256-ecb', Buffer.from(key), Buffer.alloc(0));
	return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function search(query: string) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`https://app.test/search?query=${query}`), env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

it('fails over from a resetting domain one at a time and avoids it on the next request', async () => {
	// Keep the shuffled domain order as discovered: bad.test first.
	vi.spyOn(Math, 'random').mockReturnValue(0.999);
	const hits: string[] = [];
	vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('.txt')) return new Response(encrypted({ Server: ['bad.test', 'good.test'] }, md5('diosfjckwpqpdfjkvnqQjsik')));
		hits.push(`${url.host}${url.pathname}`);
		if (url.host === 'bad.test') throw new TypeError('connection reset');
		const stamp = new Headers(init?.headers).get('tokenparam')!.split(',')[0];
		const json = (value: unknown) => Response.json({ code: 200, data: encrypted(value, md5(`${stamp}185Hcomic3PAPP7R`)) });
		if (url.pathname === '/setting') return json({ version: '2.0.16', img_host: 'https://cdn.test' });
		if (url.pathname === '/search') {
			const q = url.searchParams.get('search_query');
			return json({ search_query: q, total: '1', content: [{ id: q === 'first' ? '1' : '2', name: 'Album', author: 'A' }] });
		}
		throw new Error(`Unexpected ${url.pathname}`);
	}));

	const first = await search('first');
	expect(first.status).toBe(200);
	// bad.test got one attempt plus the client's single retry, then good.test answered.
	expect(hits.filter((hit) => hit.startsWith('bad.test'))).toEqual(['bad.test/setting', 'bad.test/setting']);
	expect(hits.filter((hit) => hit === 'good.test/search')).toHaveLength(1);

	hits.length = 0;
	const second = await search('second');
	expect(second.status).toBe(200);
	expect(hits.some((hit) => hit.startsWith('bad.test'))).toBe(false);
});
