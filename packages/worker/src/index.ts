import { getClientDataAndCreateClient, getDomainsFromDomainServer } from '@tiny-client/shared/client';
import { DOMAIN_SERVER_URL, SEARCH_PAGE_SIZE } from '@tiny-client/shared/constants';
import { assertDistinctSearchResult, selectFirstDistinctSearchResult } from './search';
import { SearchResultCache, SEARCH_RESULT_CACHE_TTL_MS } from './search-cache';
import { handleLlmProxyRequest, LLM_PROXY_TARGET_HEADER } from './llm-proxy';
import {
	type CachedResource,
	type ResourceDescriptor,
	getResourceCacheKey,
	readResources,
	resolveResource,
} from './resource-cache';

const BATCH_PHOTO_MAX_IDS = 20;
const BATCH_ALBUM_MAX_IDS = 15;
const BATCH_PHOTO_UPSTREAM_CONCURRENCY = 4;
const BATCH_ALBUM_UPSTREAM_CONCURRENCY = 3;
const CLIENT_DOMAIN_RETRY_COUNT = 3;
const SEARCH_CLIENT_RACE_COUNT = 5;
const CLIENT_CONTEXT_CACHE_TTL_MS = 5 * 60_000;
const DOMAIN_LIST_CACHE_TTL_MS = 5 * 60_000;

// ─── Search session client stickiness ────────────────────────────
const SEARCH_CLIENT_CACHE_TTL = 60_000;
const SEARCH_CLIENT_CACHE_MAX_ENTRIES = 128;
const searchClientCache = new Map<string, { context: ClientContext; ts: number }>();

function getCachedSearchClient(key: string): ClientContext | undefined {
	const entry = searchClientCache.get(key);
	if (!entry) return undefined;
	if (Date.now() - entry.ts > SEARCH_CLIENT_CACHE_TTL) {
		searchClientCache.delete(key);
		return undefined;
	}
	return entry.context;
}

function setCachedSearchClient(key: string, context: ClientContext) {
	searchClientCache.delete(key);
	searchClientCache.set(key, { context, ts: Date.now() });
	while (searchClientCache.size > SEARCH_CLIENT_CACHE_MAX_ENTRIES) {
		const oldest = searchClientCache.keys().next().value as string | undefined;
		if (!oldest) break;
		searchClientCache.delete(oldest);
	}
}

// ─── Search result cache ─────────────────────────────────────────
// Caches the final search result (post duplicate-guard) per query+page so
// repeated pagination round-trips don't hammer upstream. Short TTL: search
// results change often. Warmup still runs on the first (miss) request.
const searchResultCache = new SearchResultCache<unknown>();
const searchFlights = new Map<string, Promise<unknown>>();

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

type BatchAlbumItem = {
	albumId: string;
	album: unknown;
	photo: unknown;
	error?: WorkerBatchError;
};

type BatchPhotoItem = {
	photoId: string;
	photo: unknown;
	error?: WorkerBatchError;
};

let preferredClient: { context: ClientContext; ts: number } | null = null;
let preferredClientFlight: Promise<ClientContext> | null = null;
let domainListCache: { domains: string[]; ts: number } | null = null;
let domainListFlight: Promise<string[]> | null = null;

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
	'Access-Control-Allow-Headers': `Authorization, Content-Type, ${LLM_PROXY_TARGET_HEADER}`,
	'Access-Control-Expose-Headers': 'Server-Timing, X-Cache, X-Cache-Meta',
	'Access-Control-Max-Age': '86400',
	'Timing-Allow-Origin': '*',
};

// Add a short browser-side Cache-Control TTL to responses whose payload is
// already cached server-side (in-memory / KV). Static resources are excluded
// on purpose: the PWA recovery strategy requires no-cache for those.
function withCacheHeaders(
	ttlSeconds: number,
	resources: CachedResource[] = [],
	startedAt?: number,
): Record<string, string> {
	const headers: Record<string, string> = {
		...corsHeaders,
		'Cache-Control': `public, max-age=${ttlSeconds}`,
	};
	if (startedAt !== undefined) {
		headers['Server-Timing'] = `worker;dur=${Math.max(0, performance.now() - startedAt).toFixed(1)}`;
	}
	if (resources.length > 0) {
		const sources = new Set(resources.map((resource) => resource.source));
		const hasStale = resources.some((resource) => resource.freshness === 'stale');
		headers['X-Cache'] = hasStale ? 'stale' : sources.size === 1 ? resources[0].source : 'mixed';
		const metadata = Object.fromEntries(resources.map((resource) => [
			getResourceCacheKey(resource.descriptor),
			{
				fetchedAt: resource.fetchedAt,
				freshness: resource.freshness,
				source: resource.source,
			},
		]));
		headers['X-Cache-Meta'] = encodeURIComponent(JSON.stringify(metadata));
	}
	return headers;
}

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

async function getDomains(forceRefresh = false): Promise<string[]> {
	if (!forceRefresh && domainListCache && Date.now() - domainListCache.ts < DOMAIN_LIST_CACHE_TTL_MS) {
		return domainListCache.domains;
	}
	if (!forceRefresh && domainListFlight) return domainListFlight;
	const domainServerURL = DOMAIN_SERVER_URL[Math.floor(Math.random() * DOMAIN_SERVER_URL.length)];
	const promise = getDomainsFromDomainServer(domainServerURL)
		.then((domains) => {
			domainListCache = { domains, ts: Date.now() };
			return domains;
		})
		.finally(() => {
			if (domainListFlight === promise) domainListFlight = null;
		});
	domainListFlight = promise;
	return promise;
}

function rememberPreferredClient(context: ClientContext) {
	preferredClient = { context, ts: Date.now() };
}

function invalidateClient(domain: string | null) {
	if (!domain || preferredClient?.context.domain === domain) preferredClient = null;
}

async function createClient(excludedDomains: string[] = []): Promise<ClientContext> {
	const allDomains = shuffle(await getDomains());
	const domains = allDomains.filter((domain) => !excludedDomains.includes(domain));
	const candidateDomains = domains.length > 0 ? domains : allDomains;
	let lastError: unknown;

	for (const domain of candidateDomains.slice(0, CLIENT_DOMAIN_RETRY_COUNT)) {
		try {
			const client = await getClientDataAndCreateClient(`https://${domain}`);
			console.log('Client created.', domain);
			const context = { client, domain };
			rememberPreferredClient(context);
			return context;
		} catch (error) {
			lastError = new UpstreamError('client_init', domain, error);
			console.warn('Client creation failed for domain', domain, error);
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function getClient(excludedDomains: string[] = []): Promise<ClientContext> {
	if (
		excludedDomains.length === 0
		&& preferredClient
		&& Date.now() - preferredClient.ts < CLIENT_CONTEXT_CACHE_TTL_MS
	) {
		return preferredClient.context;
	}
	if (excludedDomains.length > 0) return createClient(excludedDomains);
	if (preferredClientFlight) return preferredClientFlight;
	const promise = createClient().finally(() => {
		if (preferredClientFlight === promise) preferredClientFlight = null;
	});
	preferredClientFlight = promise;
	return promise;
}

export async function fetchPhotoWithScrambleId(clientContext: ClientContext, photoId: string) {
	const { client, domain } = clientContext;
	const [photoResult, scrambleResult] = await Promise.allSettled([
		client.getPhoto(photoId),
		client.getScrambleId(photoId),
	]);
	if (photoResult.status === 'rejected') {
		throw new UpstreamError('get_photo', domain, photoResult.reason);
	}
	if (photoResult.value === null) return null;
	if (scrambleResult.status === 'rejected') {
		throw new UpstreamError('get_scramble_id', domain, scrambleResult.reason);
	}

	return {
		...photoResult.value,
		scrambleId: scrambleResult.value,
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
		invalidateClient(firstError.domain);
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
		try {
			return await client.getAlbum(albumId);
		} catch (error) {
			throw new UpstreamError('get_album', domain, error);
		}
	};

	try {
		return await fetchAlbum(await getPrimaryClient());
	} catch (error) {
		const firstError = toWorkerBatchError(error);
		if (!firstError.retryable) throw error;
		invalidateClient(firstError.domain);
		return await fetchAlbum(await getRetryClient(firstError.domain));
	}
}

function createRequestClients() {
	let primaryPromise: ReturnType<typeof getClient> | null = null;
	let retryPromise: ReturnType<typeof getClient> | null = null;
	return {
		primary: () => {
			if (!primaryPromise) primaryPromise = getClient();
			return primaryPromise;
		},
		retry: (excludedDomain: string | null) => {
			if (!retryPromise) retryPromise = getClient(excludedDomain ? [excludedDomain] : []);
			return retryPromise;
		},
	};
}

function descriptor(kind: ResourceDescriptor['kind'], id: string): ResourceDescriptor {
	return { kind, id };
}

function cachedFor(cache: Map<string, CachedResource>, resource: ResourceDescriptor) {
	return cache.get(getResourceCacheKey(resource));
}

function parseIds(url: URL) {
	return (url.searchParams.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
}

function notFoundError(stage: 'get_album' | 'get_photo'): WorkerBatchError {
	return { message: 'not found', stage, domain: null, reference: null, retryable: false };
}

type SearchEdgeEnvelope = {
	version: 3;
	result: unknown;
	fetchedAt: number;
};

function isSearchEdgeEnvelope(value: unknown): value is SearchEdgeEnvelope {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<SearchEdgeEnvelope>;
	return candidate.version === 3
		&& typeof candidate.fetchedAt === 'number'
		&& Object.prototype.hasOwnProperty.call(candidate, 'result');
}

function searchEdgeKey(url: URL) {
	const key = new URL(url);
	key.pathname = '/__search-cache/v3';
	key.searchParams.delete('warmup');
	const previousIds = key.searchParams.get('previousIds');
	if (previousIds) {
		key.searchParams.set('previousIds', previousIds.split(',').filter(Boolean).sort().join(','));
	}
	key.searchParams.sort();
	return new Request(key.toString(), { method: 'GET' });
}

function scheduleSearchWarmup(result: any, url: URL, ctx: ExecutionContext) {
	if (url.searchParams.get('warmup') !== '1') return;
	const orderedIds = [
		...(result.redirect_aid ? [String(result.redirect_aid)] : []),
		...(Array.isArray(result.content) ? result.content.map((item: any) => String(item.id)) : []),
	];
	const warmupIds = [...new Set(orderedIds)].slice(0, BATCH_ALBUM_MAX_IDS);
	if (warmupIds.length === 0) return;
	const batchUrl = new URL('/batch-album', url);
	batchUrl.searchParams.set('ids', warmupIds.join(','));
	ctx.waitUntil(fetch(batchUrl.toString()).then(async (response) => {
		if (!response.ok) console.warn('Warmup batch-album failed', response.status, await response.text());
	}).catch((error) => console.warn('Warmup batch-album failed', error)));
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const startedAt = performance.now();
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

		try {
			if (url.pathname === '/llm-proxy') return handleLlmProxyRequest(request, corsHeaders);

			if (url.pathname === '/search') {
				const query = url.searchParams.get('query');
				if (!query) return new Response("Missing query 'query'", { status: 400, headers: corsHeaders });
				const previousIds = (url.searchParams.get('previousIds') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
				if (previousIds.length > SEARCH_PAGE_SIZE) {
					return new Response(`Too many previousIds, max ${SEARCH_PAGE_SIZE}`, { status: 400, headers: corsHeaders });
				}
				const searchOptions = {
					page: Number(url.searchParams.get('page')) || 1,
					orderBy: (url.searchParams.get('orderBy') as any) || 'mr',
					time: (url.searchParams.get('time') as any) || 'a',
					mainTag: (Number(url.searchParams.get('mainTag')) as any) || 0,
				};
				const duplicateGuardIds = searchOptions.page > 1 ? previousIds : [];
				const guardKey = [...duplicateGuardIds].sort().join(',');
				const resultCacheKey = `search:${query}:${searchOptions.mainTag}:${searchOptions.orderBy}:${searchOptions.time}:${searchOptions.page}:${guardKey}`;

				let cachedResult = searchResultCache.get(resultCacheKey);
				let searchCacheSource = 'l1';
				if (cachedResult === undefined) {
					try {
						const edgeResponse = await caches.default.match(searchEdgeKey(url));
						if (edgeResponse) {
							const envelope = await edgeResponse.json();
							if (
								isSearchEdgeEnvelope(envelope)
								&& Date.now() - envelope.fetchedAt < SEARCH_RESULT_CACHE_TTL_MS
							) {
								cachedResult = envelope.result;
								searchResultCache.set(resultCacheKey, cachedResult, envelope.fetchedAt);
								searchCacheSource = 'edge';
							}
						}
					} catch {
						// Search edge cache is best effort.
					}
				}
				if (cachedResult !== undefined) {
					scheduleSearchWarmup(cachedResult, url, ctx);
					return Response.json(cachedResult, {
						headers: { ...withCacheHeaders(30, [], startedAt), 'X-Cache': searchCacheSource },
					});
				}

					let result: any;
					try {
						const existingFlight = searchFlights.get(resultCacheKey);
						if (existingFlight) {
							result = await existingFlight;
						} else {
							const promise = (async () => {
								const sessionKey = `search:${query}:${searchOptions.mainTag}:${searchOptions.orderBy}:${searchOptions.time}`;
								const reusablePreferred = preferredClient && Date.now() - preferredClient.ts < CLIENT_CONTEXT_CACHE_TTL_MS
									? preferredClient.context
									: undefined;
								const cachedContext = getCachedSearchClient(sessionKey) ?? reusablePreferred;
								let upstreamResult: any;
								if (cachedContext) {
									try {
										upstreamResult = assertDistinctSearchResult(
											await cachedContext.client.search(query, searchOptions),
											duplicateGuardIds,
										);
										setCachedSearchClient(sessionKey, cachedContext);
									} catch (error) {
										console.warn('Cached search client failed, falling back to race', cachedContext.domain, error);
										searchClientCache.delete(sessionKey);
										invalidateClient(cachedContext.domain);
									}
								}
								if (upstreamResult) return upstreamResult;

								const candidateDomains = shuffle(await getDomains())
									.filter((domain) => domain !== cachedContext?.domain)
									.slice(0, SEARCH_CLIENT_RACE_COUNT);
								const winner = await selectFirstDistinctSearchResult(
									candidateDomains.map((domain) => async () => {
										const client = await getClientDataAndCreateClient(`https://${domain}`);
										return { result: await client.search(query, searchOptions), value: { client, domain } };
									}),
									duplicateGuardIds,
								);
								setCachedSearchClient(sessionKey, winner.value);
								rememberPreferredClient(winner.value);
								return winner.result;
							})().finally(() => {
								if (searchFlights.get(resultCacheKey) === promise) searchFlights.delete(resultCacheKey);
							});
							searchFlights.set(resultCacheKey, promise);
							result = await promise;
						}
					} catch (error) {
						for (const cause of (error as AggregateError).errors ?? []) console.warn('Search failed on a domain', cause);
						return new Response('All upstream domains failed or returned duplicate search results', { status: 502, headers: corsHeaders });
					}

				const fetchedAt = Date.now();
				searchResultCache.set(resultCacheKey, result, fetchedAt);
				ctx.waitUntil(caches.default.put(
					searchEdgeKey(url),
					Response.json(
						{ version: 3, result, fetchedAt } satisfies SearchEdgeEnvelope,
						{ headers: { 'Cache-Control': 'public, max-age=30' } },
					),
				).catch(() => undefined));
				scheduleSearchWarmup(result, url, ctx);
				return Response.json(result, {
					headers: { ...withCacheHeaders(30, [], startedAt), 'X-Cache': 'upstream' },
				});
			}

			const forceRefresh = url.searchParams.get('refresh') === '1';

			if (url.pathname.startsWith('/album/')) {
				const id = url.pathname.split('/').pop();
				if (!id) return new Response('Missing album id', { status: 400, headers: corsHeaders });
				const resource = descriptor('album', id);
				const cached = await readResources([resource], request.url, env.ALBUM_CACHE_KV);
				const clients = createRequestClients();
				const resolved = await resolveResource({
					descriptor: resource,
					cached: cachedFor(cached, resource),
					forceRefresh,
					requestUrl: request.url,
					kv: env.ALBUM_CACHE_KV,
					ctx,
					fetcher: () => fetchAlbumWithRetry(id, clients.primary, clients.retry),
				});
				const headers = withCacheHeaders(60, [resolved], startedAt);
				if (resolved.value === null) return new Response('album not found', { status: 404, headers });
				return Response.json(resolved.value, { headers });
			}

			if (url.pathname.startsWith('/photo/')) {
				const id = url.pathname.split('/').pop();
				if (!id) return new Response('Missing photo id', { status: 400, headers: corsHeaders });
				const resource = descriptor('photo', id);
				const cached = await readResources([resource], request.url, env.ALBUM_CACHE_KV);
				const clients = createRequestClients();
				const resolved = await resolveResource({
					descriptor: resource,
					cached: cachedFor(cached, resource),
					forceRefresh,
					requestUrl: request.url,
					kv: env.ALBUM_CACHE_KV,
					ctx,
					fetcher: () => fetchBatchPhotoWithRetry(id, clients.primary, clients.retry),
				});
				const headers = withCacheHeaders(3600, [resolved], startedAt);
				if (resolved.value === null) return new Response('photo not found', { status: 404, headers });
				return Response.json(resolved.value, { headers });
			}

			if (url.pathname === '/batch-photo') {
				if (!url.searchParams.has('ids')) return new Response("Missing query 'ids'", { status: 400, headers: corsHeaders });
				const ids = parseIds(url);
				if (ids.length === 0) return new Response('Empty ids', { status: 400, headers: corsHeaders });
				if (ids.length > BATCH_PHOTO_MAX_IDS) {
					return new Response(`Too many ids, max ${BATCH_PHOTO_MAX_IDS}`, { status: 400, headers: corsHeaders });
				}
				const descriptors = ids.map((id) => descriptor('photo', id));
				const cached = await readResources(descriptors, request.url, env.ALBUM_CACHE_KV);
				const clients = createRequestClients();
				const resources: CachedResource[] = [];
				const results = await mapWithConcurrency(ids, BATCH_PHOTO_UPSTREAM_CONCURRENCY, async (photoId): Promise<BatchPhotoItem> => {
					const resource = descriptor('photo', photoId);
					try {
						const resolved = await resolveResource({
							descriptor: resource,
							cached: cachedFor(cached, resource),
							forceRefresh,
							requestUrl: request.url,
							kv: env.ALBUM_CACHE_KV,
							ctx,
							fetcher: () => fetchBatchPhotoWithRetry(photoId, clients.primary, clients.retry),
						});
						resources.push(resolved);
						return resolved.value === null
							? { photoId, photo: null, error: notFoundError('get_photo') }
							: { photoId, photo: resolved.value };
					} catch (error) {
						return { photoId, photo: null, error: toWorkerBatchError(error) };
					}
				});
				const headers = withCacheHeaders(60, resources, startedAt);
				if (results.some((item) => item.error)) headers['Cache-Control'] = 'no-store';
				return Response.json(results, { headers });
			}

			if (url.pathname === '/batch-album') {
				if (!url.searchParams.has('ids')) return new Response("Missing query 'ids'", { status: 400, headers: corsHeaders });
				const ids = parseIds(url);
				if (ids.length === 0) return new Response('Empty ids', { status: 400, headers: corsHeaders });
				if (ids.length > BATCH_ALBUM_MAX_IDS) {
					return new Response(`Too many ids, max ${BATCH_ALBUM_MAX_IDS}`, { status: 400, headers: corsHeaders });
				}
				const descriptors = ids.flatMap((id) => [descriptor('album', id), descriptor('photo', id)]);
				const cached = await readResources(descriptors, request.url, env.ALBUM_CACHE_KV);
				const clients = createRequestClients();
				const resources: CachedResource[] = [];
				const results = await mapWithConcurrency(ids, BATCH_ALBUM_UPSTREAM_CONCURRENCY, async (albumId): Promise<BatchAlbumItem> => {
					const albumResource = descriptor('album', albumId);
					const photoResource = descriptor('photo', albumId);
					try {
						const [album, photo] = await Promise.all([
							resolveResource({
								descriptor: albumResource,
								cached: cachedFor(cached, albumResource),
								forceRefresh,
								requestUrl: request.url,
								kv: env.ALBUM_CACHE_KV,
								ctx,
								fetcher: () => fetchAlbumWithRetry(albumId, clients.primary, clients.retry),
							}),
							resolveResource({
								descriptor: photoResource,
								cached: cachedFor(cached, photoResource),
								forceRefresh,
								requestUrl: request.url,
								kv: env.ALBUM_CACHE_KV,
								ctx,
								fetcher: () => fetchBatchPhotoWithRetry(albumId, clients.primary, clients.retry),
							}),
						]);
						resources.push(album, photo);
						return album.value === null
							? { albumId, album: null, photo: null, error: notFoundError('get_album') }
							: { albumId, album: album.value, photo: photo.value };
					} catch (error) {
						return { albumId, album: null, photo: null, error: toWorkerBatchError(error) };
					}
				});
				const headers = withCacheHeaders(60, resources, startedAt);
				if (results.some((item) => item.error)) headers['Cache-Control'] = 'no-store';
				return Response.json(results, { headers });
			}

			return new Response('Not found', { status: 404, headers: corsHeaders });
		} catch (error) {
			const failure = error as Error;
			console.error('WORKER ERROR:', failure);
			console.error('STACK:', failure.stack);
			return new Response(JSON.stringify({ error: failure.message || 'Internal Error', stack: failure.stack }), {
				status: 500,
				headers: corsHeaders,
			});
		}
	},
} satisfies ExportedHandler<Env>;
