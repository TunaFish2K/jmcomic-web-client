import { getClientDataAndCreateClient, getDomainsFromDomainServer } from '@tiny-client/shared/client';
import { DOMAIN_SERVER_URL } from '@tiny-client/shared/constants';

const BATCH_PHOTO_MAX_IDS = 20;
const BATCH_ALBUM_MAX_IDS = 15;
const BATCH_PHOTO_UPSTREAM_CONCURRENCY = 4;
const BATCH_ALBUM_UPSTREAM_CONCURRENCY = 3;
const CLIENT_DOMAIN_RETRY_COUNT = 3;
const SEARCH_CLIENT_RACE_COUNT = 5;

// ─── In-memory album data cache ──────────────────────────────────
const ALBUM_CACHE_TTL_MS = 60_000;
const albumDataCache = new Map<string, { data: unknown; ts: number }>();

function cacheGet<T>(key: string): T | undefined {
	const entry = albumDataCache.get(key);
	if (!entry) return undefined;
	if (Date.now() - entry.ts > ALBUM_CACHE_TTL_MS) {
		albumDataCache.delete(key);
		return undefined;
	}
	return entry.data as T;
}

function cacheSet(key: string, data: unknown) {
	albumDataCache.set(key, { data, ts: Date.now() });
}

// ─── Search session domain stickiness ────────────────────────────
const SEARCH_DOMAIN_CACHE_TTL = 60_000;
const searchDomainCache = new Map<string, { domain: string; ts: number }>();

function getCachedSearchDomain(key: string): string | undefined {
	const entry = searchDomainCache.get(key);
	if (!entry) return undefined;
	if (Date.now() - entry.ts > SEARCH_DOMAIN_CACHE_TTL) {
		searchDomainCache.delete(key);
		return undefined;
	}
	return entry.domain;
}

function setCachedSearchDomain(key: string, domain: string) {
	searchDomainCache.set(key, { domain, ts: Date.now() });
}

// ─── KV-backed persistent cache (L2) ─────────────────────────────
const KV_CACHE_PREFIX = 'album:';
const KV_CACHE_TTL_SECONDS = 3600;

async function kvCacheGet<T>(kv: KVNamespace, key: string): Promise<T | undefined> {
	try {
		const val = await kv.get(`${KV_CACHE_PREFIX}${key}`, 'json');
		return val as T | undefined;
	} catch {
		return undefined;
	}
}

function kvCacheSet(kv: KVNamespace, key: string, data: unknown) {
	kv.put(`${KV_CACHE_PREFIX}${key}`, JSON.stringify(data), { expirationTtl: KV_CACHE_TTL_SECONDS }).catch(() => {});
}

type WorkerBatchErrorStage = 'client_init' | 'get_album' | 'get_photo' | 'get_scramble_id' | 'unknown';

type WorkerBatchError = {
	message: string;
	stage: WorkerBatchErrorStage;
	domain: string | null;
	reference: string | null;
	retryable: boolean;
};

type ClientContext = {
	client: Awaited<ReturnType<typeof getClientDataAndCreateClient>>;
	domain: string;
};

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
	'Access-Control-Allow-Headers': '*',
};

class UpstreamError extends Error {
	stage: WorkerBatchErrorStage;
	domain: string | null;
	reference: string | null;
	retryable: boolean;

	constructor(stage: WorkerBatchErrorStage, domain: string | null, error: unknown, retryable = true) {
		const message = error instanceof Error ? error.message : String(error);
		super(message);
		this.stage = stage;
		this.domain = domain;
		this.reference = message.match(/reference\s*=\s*([a-z0-9]+)/i)?.[1] ?? null;
		this.retryable = retryable;
	}
}

function shuffle<T>(items: T[]) {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

function toWorkerBatchError(error: unknown): WorkerBatchError {
	if (error instanceof UpstreamError) {
		return {
			message: error.message,
			stage: error.stage,
			domain: error.domain,
			reference: error.reference,
			retryable: error.retryable,
		};
	}

	const message = error instanceof Error ? error.message : String(error);
	return {
		message,
		stage: 'unknown',
		domain: null,
		reference: message.match(/reference\s*=\s*([a-z0-9]+)/i)?.[1] ?? null,
		retryable: false,
	};
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	mapper: (item: T) => Promise<R>,
) {
	const results = new Array<R>(items.length);
	let nextIndex = 0;

	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (nextIndex < items.length) {
				const currentIndex = nextIndex++;
				results[currentIndex] = await mapper(items[currentIndex]);
			}
		}),
	);

	return results;
}

async function getClient(excludedDomains: string[] = []): Promise<ClientContext> {
	const domainServerURL = DOMAIN_SERVER_URL[Math.floor(Math.random() * DOMAIN_SERVER_URL.length)];
	const allDomains = shuffle(await getDomainsFromDomainServer(domainServerURL));
	const domains = allDomains.filter((domain) => !excludedDomains.includes(domain));
	const candidateDomains = domains.length > 0 ? domains : allDomains;
	let lastError: unknown;

	for (const domain of candidateDomains.slice(0, CLIENT_DOMAIN_RETRY_COUNT)) {
		try {
			const client = await getClientDataAndCreateClient(`https://${domain}`);
			console.log('Client created.', domain);
			return { client, domain };
		} catch (error) {
			lastError = new UpstreamError('client_init', domain, error);
			console.warn('Client creation failed for domain', domain, error);
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchPhotoWithScrambleId(clientContext: ClientContext, photoId: string) {
	const { client, domain } = clientContext;

	let photo: Awaited<ReturnType<typeof client.getPhoto>>;
	try {
		photo = await client.getPhoto(photoId);
	} catch (error) {
		throw new UpstreamError('get_photo', domain, error);
	}

	if (photo === null) return null;

	let scrambleId: number;
	try {
		scrambleId = await client.getScrambleId(photoId);
	} catch (error) {
		throw new UpstreamError('get_scramble_id', domain, error);
	}

	return {
		...photo,
		scrambleId,
	};
}

async function fetchBatchPhotoWithRetry(
	photoId: string,
	getPrimaryClient: () => Promise<ClientContext>,
	getRetryClient: (excludedDomain: string | null) => Promise<ClientContext>,
) {
	try {
		return await fetchPhotoWithScrambleId(await getPrimaryClient(), photoId);
	} catch (error) {
		const firstError = toWorkerBatchError(error);
		if (!firstError.retryable) throw error;
		return await fetchPhotoWithScrambleId(await getRetryClient(firstError.domain), photoId);
	}
}

async function fetchAlbumWithRetry(
	albumId: string,
	getPrimaryClient: () => Promise<ClientContext>,
	getRetryClient: (excludedDomain: string | null) => Promise<ClientContext>,
) {
	const fetchAlbum = async (clientContext: ClientContext) => {
		const { client, domain } = clientContext;
		const [album, photo] = await Promise.all([
			(async () => {
				try {
					return await client.getAlbum(albumId);
				} catch (error) {
					throw new UpstreamError('get_album', domain, error);
				}
			})(),
			fetchPhotoWithScrambleId(clientContext, albumId),
		]);

		return { album, photo };
	};

	try {
		return await fetchAlbum(await getPrimaryClient());
	} catch (error) {
		const firstError = toWorkerBatchError(error);
		if (!firstError.retryable) throw error;
		return await fetchAlbum(await getRetryClient(firstError.domain));
	}
}

// Simple router
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			// API Routes
			if (url.pathname === '/search') {
				const query = url.searchParams.get('query');
				if (!query) return new Response("Missing query 'query'", { status: 400, headers: corsHeaders });

				const searchOptions = {
					page: Number(url.searchParams.get('page')) || 1,
					orderBy: (url.searchParams.get('orderBy') as any) || 'mr',
					time: (url.searchParams.get('time') as any) || 'a',
					mainTag: (Number(url.searchParams.get('mainTag')) as any) || 0,
				};

				// Try cached domain first for session stickiness (翻页一致性)
				const sessionKey = `search:${query}:${searchOptions.mainTag}:${searchOptions.orderBy}:${searchOptions.time}`;
				const cachedDomain = getCachedSearchDomain(sessionKey);

				let result: any;
				if (cachedDomain) {
					try {
						const client = await getClientDataAndCreateClient(`https://${cachedDomain}`);
						result = await client.search(query, searchOptions);
					} catch (e) {
						console.warn('Cached search domain failed, falling back to race', cachedDomain, e);
						searchDomainCache.delete(sessionKey);
					}
				}

				if (!result) {
					// Race search across SEARCH_CLIENT_RACE_COUNT upstream domains
					const domainServerURL = DOMAIN_SERVER_URL[Math.floor(Math.random() * DOMAIN_SERVER_URL.length)];
					const allDomains = shuffle(await getDomainsFromDomainServer(domainServerURL));
					const candidateDomains = allDomains.slice(0, SEARCH_CLIENT_RACE_COUNT);

					try {
						const winner = await Promise.any(
							candidateDomains.map(async (domain) => {
								const client = await getClientDataAndCreateClient(`https://${domain}`);
								const res = await client.search(query, searchOptions);
								return { result: res, domain };
							}),
						);
						result = winner.result;
						setCachedSearchDomain(sessionKey, winner.domain);
					} catch (e) {
						for (const err of (e as AggregateError).errors ?? []) {
							console.warn('Search failed on a domain', err);
						}
						return new Response('All upstream domains failed for search', { status: 502, headers: corsHeaders });
					}
				}

				// ── Warmup: prefetch album data in background ──────
				if (url.searchParams.get('warmup') === '1') {
					const sr = result as any;
					const warmupIds: string[] = [];
					if (sr.content?.length > 0) warmupIds.push(...sr.content.map((item: any) => item.id));
					if (sr.redirect_aid) warmupIds.push(sr.redirect_aid);

					if (warmupIds.length > 0) {
						const uncachedIds = warmupIds.filter(
							(id: string) => !albumDataCache.has(id) || Date.now() - albumDataCache.get(id)!.ts > ALBUM_CACHE_TTL_MS,
						);

						if (uncachedIds.length > 0) {
							const chunks: string[][] = [];
							for (let i = 0; i < uncachedIds.length; i += BATCH_ALBUM_MAX_IDS) {
								chunks.push(uncachedIds.slice(i, i + BATCH_ALBUM_MAX_IDS));
							}

							const selfBaseUrl = `${url.protocol}//${url.host}`;

							ctx.waitUntil(
								(async () => {
									try {
										await mapWithConcurrency(chunks, BATCH_ALBUM_UPSTREAM_CONCURRENCY, async (chunk) => {
											const batchUrl = new URL('/batch-album', selfBaseUrl);
											batchUrl.searchParams.set('ids', chunk.join(','));
											const res = await fetch(batchUrl.toString());
											if (!res.ok) console.warn('Warmup batch-album failed', res.status, await res.text());
										});
									} catch (err) {
										console.error('Warmup error:', err);
									}
								})(),
							);
						}
					}
				}

				return Response.json(result, { headers: corsHeaders });
			}

			if (url.pathname.startsWith('/album/')) {
				const id = url.pathname.split('/').pop();
				if (!id) return new Response('Missing album id', { status: 400, headers: corsHeaders });

				const { client } = await getClient();

				const result = await client.getAlbum(id);
				if (result === null) return new Response('album not found', { status: 404, headers: corsHeaders });
				return Response.json(result, { headers: corsHeaders });
			}

			if (url.pathname.startsWith('/photo/')) {
				const id = url.pathname.split('/').pop();
				if (!id) return new Response('Missing photo id', { status: 400, headers: corsHeaders });

				const { client } = await getClient();

				const result = await fetchPhotoWithScrambleId({ client, domain: new URL(client.baseURL).hostname }, id);
				if (result === null) return new Response('photo not found', { status: 404, headers: corsHeaders });
				return Response.json(result, { headers: corsHeaders });
			}

			if (url.pathname === '/batch-photo') {
				const idsParam = url.searchParams.get('ids');
				if (!idsParam) return new Response("Missing query 'ids'", { status: 400, headers: corsHeaders });

				const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
				if (ids.length === 0) return new Response('Empty ids', { status: 400, headers: corsHeaders });
				// One worker invocation can only make 50 subrequests. Keep headroom instead of
				// sitting exactly on the limit: 2 fixed (domain server + /setting) + 2 per ID.
				if (ids.length > BATCH_PHOTO_MAX_IDS) {
					return new Response(`Too many ids, max ${BATCH_PHOTO_MAX_IDS}`, { status: 400, headers: corsHeaders });
				}

				let clientPromise: ReturnType<typeof getClient> | null = null;
				let retryClientPromise: ReturnType<typeof getClient> | null = null;
				const getSharedClient = () => {
					if (!clientPromise) clientPromise = getClient();
					return clientPromise;
				};
				const getRetryClient = (excludedDomain: string | null) => {
					if (!retryClientPromise) retryClientPromise = getClient(excludedDomain ? [excludedDomain] : []);
					return retryClientPromise;
				};

				const results = await mapWithConcurrency(
					ids,
					BATCH_PHOTO_UPSTREAM_CONCURRENCY,
					async (photoId) => {
						try {
							const photo = await fetchBatchPhotoWithRetry(photoId, getSharedClient, getRetryClient);
							if (photo === null) {
								return { photoId, photo: null, error: { message: 'not found', stage: 'get_photo', domain: null, reference: null, retryable: false } };
							}
							return { photoId, photo };
						} catch (e) {
							return { photoId, photo: null, error: toWorkerBatchError(e) };
						}
					},
				);

				return Response.json(results, { headers: corsHeaders });
			}

		if (url.pathname === '/batch-album') {
			const idsParam = url.searchParams.get('ids');
			if (!idsParam) return new Response("Missing query 'ids'", { status: 400, headers: corsHeaders });

			const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
			if (ids.length === 0) return new Response('Empty ids', { status: 400, headers: corsHeaders });
			if (ids.length > BATCH_ALBUM_MAX_IDS) {
				return new Response(`Too many ids, max ${BATCH_ALBUM_MAX_IDS}`, { status: 400, headers: corsHeaders });
			}

			// ── Check L1 (memory) + L2 (KV) cache ────────────────
			type BatchAlbumItem = { albumId: string; album: unknown; photo: unknown; error?: WorkerBatchError };
			const cached: BatchAlbumItem[] = [];
			const remainingIds: string[] = [];
			for (const id of ids) {
				const entry = cacheGet<BatchAlbumItem>(id);
				if (entry) { cached.push(entry); continue; }
				remainingIds.push(id);
			}

			if (remainingIds.length > 0 && env.ALBUM_CACHE_KV) {
				const kvResults = await Promise.all(
					remainingIds.map(async (id) => {
						const val = await kvCacheGet<BatchAlbumItem>(env.ALBUM_CACHE_KV, id);
						return { id, val };
					}),
				);
				for (const { id, val } of kvResults) {
					if (val) {
						cacheSet(id, val);
						cached.push(val);
						remainingIds.splice(remainingIds.indexOf(id), 1);
					}
				}
			}

			if (remainingIds.length === 0) {
				return Response.json(cached, { headers: corsHeaders });
			}

			// getClient() is called once but its failure is caught per-item so one bad
			// upstream domain never turns the whole batch into a 500.
			let clientPromise: ReturnType<typeof getClient> | null = null;
			let retryClientPromise: ReturnType<typeof getClient> | null = null;
			const getSharedClient = () => {
				if (!clientPromise) clientPromise = getClient();
				return clientPromise;
			};
			const getRetryClient = (excludedDomain: string | null) => {
				if (!retryClientPromise) retryClientPromise = getClient(excludedDomain ? [excludedDomain] : []);
				return retryClientPromise;
			};

			const freshResults = await mapWithConcurrency(
				remainingIds,
				BATCH_ALBUM_UPSTREAM_CONCURRENCY,
				async (albumId) => {
					try {
						const { album, photo } = await fetchAlbumWithRetry(albumId, getSharedClient, getRetryClient);
						if (album === null) {
							return { albumId, album: null, photo: null, error: { message: 'not found', stage: 'get_album', domain: null, reference: null, retryable: false } };
						}
						return { albumId, album, photo };
					} catch (e) {
						return { albumId, album: null, photo: null, error: toWorkerBatchError(e) };
					}
				},
			);

			// ── Write results to L1 + L2 cache ──────────────────
			for (const item of freshResults) {
				if (!item.error && item.album !== null) {
					cacheSet(item.albumId, item);
					if (env.ALBUM_CACHE_KV) kvCacheSet(env.ALBUM_CACHE_KV, item.albumId, item);
				}
			}

			return Response.json([...cached, ...freshResults], { headers: corsHeaders });
		}

			return new Response('Not found', { status: 404, headers: corsHeaders });
		} catch (e) {
			const shouldBeError = e as Error;
			console.error('WORKER ERROR:', shouldBeError);
			console.error('STACK:', shouldBeError.stack);
			return new Response(JSON.stringify({ error: shouldBeError.message || 'Internal Error', stack: shouldBeError.stack }), {
				status: 500,
				headers: corsHeaders,
			});
		}
	},
} satisfies ExportedHandler<Env>;
