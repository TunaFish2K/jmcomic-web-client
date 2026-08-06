import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker routes', () => {
	it('returns 400 when /search misses query', async () => {
		const request = new IncomingRequest('http://example.com/search');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Missing query 'query'");
	});

	it('returns 400 when /search receives too many previous IDs', async () => {
		const previousIds = Array.from({ length: 81 }, (_, index) => String(index + 1)).join(',');
		const response = await SELF.fetch(`https://example.com/search?query=test&page=2&previousIds=${previousIds}`);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Too many previousIds, max 80');
	});

	it('returns 400 when /batch-album misses ids', async () => {
		const response = await SELF.fetch('https://example.com/batch-album');

		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Missing query 'ids'");
	});

	it('returns 400 when /batch-photo misses ids', async () => {
		const response = await SELF.fetch('https://example.com/batch-photo');

		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Missing query 'ids'");
	});

	it('returns 400 when /batch-photo exceeds safe chunk size', async () => {
		const ids = Array.from({ length: 21 }, (_, index) => String(index + 1)).join(',');
		const response = await SELF.fetch(`https://example.com/batch-photo?ids=${ids}`);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Too many ids, max 20');
	});

	it('returns 400 when /batch-photo ids are empty after trimming', async () => {
		const response = await SELF.fetch('https://example.com/batch-photo?ids=%20,%20');

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Empty ids');
	});

	it('returns 404 for unknown routes', async () => {
		const response = await SELF.fetch('https://example.com/not-found');

		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not found');
	});

	it('serves /batch-album from the KV L2 cache when the entry exists', async () => {
		const albumId = 'l2-cached-album';
		const cachedItem = {
			albumId,
			album: { id: albumId, name: 'cached-album' },
			photo: null,
		};

		await env.ALBUM_CACHE_KV.put(`album:${albumId}`, JSON.stringify(cachedItem));

		const response = await SELF.fetch(`https://example.com/batch-album?ids=${albumId}`);
		expect(response.status).toBe(200);

		const body = (await response.json()) as Array<{ albumId: string; album: { name: string } | null }>;
		expect(body).toHaveLength(1);
		expect(body[0].albumId).toBe(albumId);
		expect(body[0].album?.name).toBe('cached-album');
	});
});
