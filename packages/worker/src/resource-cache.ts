export type ResourceKind = 'album' | 'photo';

export type CacheFreshness = 'fresh' | 'stale';
export type CacheSource = 'l1' | 'edge' | 'kv' | 'upstream';

export type ResourceDescriptor = {
	kind: ResourceKind;
	id: string;
};

export type CacheEnvelope<T = unknown> = {
	version: 2;
	kind: ResourceKind;
	id: string;
	value: T | null;
	fetchedAt: number;
};

export type CachedResource<T = unknown> = {
	descriptor: ResourceDescriptor;
	value: T | null;
	fetchedAt: number;
	freshness: CacheFreshness;
	source: CacheSource;
};

type CachePolicy = {
	freshMs: number;
	staleMs: number;
};

const CACHE_VERSION = 2;
const CACHE_KEY_PREFIX = `resource:v${CACHE_VERSION}:`;
const L1_MAX_ENTRIES = 512;
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;
const SERIES_FRESH_MS = 60 * 1000;
const SERIES_STALE_MS = 15 * 60 * 1000;
const STABLE_FRESH_MS = 60 * 60 * 1000;
const STABLE_STALE_MS = 24 * 60 * 60 * 1000;

const memoryCache = new Map<string, CacheEnvelope>();
const upstreamFlights = new Map<string, Promise<CacheEnvelope>>();

function descriptorKey({ kind, id }: ResourceDescriptor) {
	return `${kind}:${id}`;
}

function storageKey(descriptor: ResourceDescriptor) {
	return `${CACHE_KEY_PREFIX}${descriptorKey(descriptor)}`;
}

function edgeKey(requestUrl: string, descriptor: ResourceDescriptor) {
	const url = new URL(requestUrl);
	url.pathname = `/__resource-cache/v${CACHE_VERSION}/${descriptor.kind}/${encodeURIComponent(descriptor.id)}`;
	url.search = '';
	return new Request(url.toString(), { method: 'GET' });
}

function getPolicy(envelope: CacheEnvelope): CachePolicy {
	if (envelope.value === null) {
		return { freshMs: NEGATIVE_CACHE_MS, staleMs: NEGATIVE_CACHE_MS };
	}
	if (
		envelope.kind === 'album'
		&& Array.isArray((envelope.value as { series?: unknown[] }).series)
		&& (envelope.value as { series: unknown[] }).series.length > 0
	) {
		return { freshMs: SERIES_FRESH_MS, staleMs: SERIES_STALE_MS };
	}
	return { freshMs: STABLE_FRESH_MS, staleMs: STABLE_STALE_MS };
}

function inspectEnvelope(
	envelope: CacheEnvelope | null | undefined,
	descriptor: ResourceDescriptor,
	source: CacheSource,
): CachedResource | undefined {
	if (
		!envelope
		|| envelope.version !== CACHE_VERSION
		|| envelope.kind !== descriptor.kind
		|| envelope.id !== descriptor.id
	) {
		return undefined;
	}
	const age = Math.max(0, Date.now() - envelope.fetchedAt);
	const policy = getPolicy(envelope);
	if (age >= policy.staleMs) return undefined;
	return {
		descriptor,
		value: envelope.value,
		fetchedAt: envelope.fetchedAt,
		freshness: age < policy.freshMs ? 'fresh' : 'stale',
		source,
	};
}

function setMemory(descriptor: ResourceDescriptor, envelope: CacheEnvelope) {
	const key = descriptorKey(descriptor);
	memoryCache.delete(key);
	memoryCache.set(key, envelope);
	while (memoryCache.size > L1_MAX_ENTRIES) {
		const oldestKey = memoryCache.keys().next().value as string | undefined;
		if (!oldestKey) break;
		memoryCache.delete(oldestKey);
	}
}

function remainingStaleSeconds(envelope: CacheEnvelope) {
	const { staleMs } = getPolicy(envelope);
	return Math.max(60, Math.ceil((staleMs - (Date.now() - envelope.fetchedAt)) / 1000));
}

function isCacheEnvelope(value: unknown): value is CacheEnvelope {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<CacheEnvelope>;
	return candidate.version === CACHE_VERSION
		&& (candidate.kind === 'album' || candidate.kind === 'photo')
		&& typeof candidate.id === 'string'
		&& typeof candidate.fetchedAt === 'number'
		&& Object.prototype.hasOwnProperty.call(candidate, 'value');
}

export async function readResources(
	descriptors: ResourceDescriptor[],
	requestUrl: string,
	kv?: KVNamespace,
): Promise<Map<string, CachedResource>> {
	const result = new Map<string, CachedResource>();
	let remaining = descriptors.filter((descriptor) => {
		const key = descriptorKey(descriptor);
		const hit = inspectEnvelope(memoryCache.get(key), descriptor, 'l1');
		if (!hit) return true;
		result.set(key, hit);
		return false;
	});

	if (remaining.length > 0) {
		const edgeResults = await Promise.all(remaining.map(async (descriptor) => {
			try {
				const response = await caches.default.match(edgeKey(requestUrl, descriptor));
				if (!response) return { descriptor };
				const value = await response.json();
				return { descriptor, envelope: isCacheEnvelope(value) ? value : undefined };
			} catch {
				return { descriptor };
			}
		}));
		const edgeMisses: ResourceDescriptor[] = [];
		for (const { descriptor, envelope } of edgeResults) {
			const hit = inspectEnvelope(envelope, descriptor, 'edge');
			if (!hit || !envelope) {
				edgeMisses.push(descriptor);
				continue;
			}
			setMemory(descriptor, envelope);
			result.set(descriptorKey(descriptor), hit);
		}
		remaining = edgeMisses;
	}

	if (remaining.length > 0 && kv) {
		try {
			const keys = remaining.map(storageKey);
			const values = await kv.get<CacheEnvelope>(keys, { type: 'json', cacheTtl: 30 });
			const kvMisses: ResourceDescriptor[] = [];
			for (const descriptor of remaining) {
				const envelope = values.get(storageKey(descriptor));
				const hit = inspectEnvelope(envelope, descriptor, 'kv');
				if (!hit || !envelope) {
					kvMisses.push(descriptor);
					continue;
				}
				setMemory(descriptor, envelope);
				result.set(descriptorKey(descriptor), hit);
			}
			remaining = kvMisses;
		} catch {
			// Cache failures are misses; the upstream path remains available.
		}
	}

	return result;
}

function persistResource(
	envelope: CacheEnvelope,
	requestUrl: string,
	kv: KVNamespace | undefined,
	ctx: ExecutionContext,
) {
	const descriptor = { kind: envelope.kind, id: envelope.id } satisfies ResourceDescriptor;
	setMemory(descriptor, envelope);
	const ttlSeconds = remainingStaleSeconds(envelope);
	const writes: Promise<unknown>[] = [];
	try {
		const response = Response.json(envelope, {
			headers: { 'Cache-Control': `public, max-age=${ttlSeconds}` },
		});
		writes.push(caches.default.put(edgeKey(requestUrl, descriptor), response));
	} catch {
		// Cache API is best effort.
	}
	if (kv) {
		writes.push(kv.put(storageKey(descriptor), JSON.stringify(envelope), { expirationTtl: ttlSeconds }));
	}
	if (writes.length > 0) {
		ctx.waitUntil(Promise.allSettled(writes).then(() => undefined));
	}
}

export async function resolveResource<T>(options: {
	descriptor: ResourceDescriptor;
	cached?: CachedResource;
	forceRefresh: boolean;
	requestUrl: string;
	kv?: KVNamespace;
	ctx: ExecutionContext;
	fetcher: () => Promise<T | null>;
}): Promise<CachedResource<T>> {
	const { descriptor, cached, forceRefresh, requestUrl, kv, ctx, fetcher } = options;
	if (cached?.freshness === 'fresh') return cached as CachedResource<T>;

	const key = descriptorKey(descriptor);
	const refresh = () => {
		const existing = upstreamFlights.get(key);
		if (existing) return existing;
		const promise = fetcher()
			.then((value) => {
				const envelope: CacheEnvelope<T> = {
					version: CACHE_VERSION,
					kind: descriptor.kind,
					id: descriptor.id,
					value,
					fetchedAt: Date.now(),
				};
				persistResource(envelope, requestUrl, kv, ctx);
				return envelope as CacheEnvelope;
			})
			.finally(() => {
				if (upstreamFlights.get(key) === promise) upstreamFlights.delete(key);
			});
		upstreamFlights.set(key, promise);
		return promise;
	};

	if (cached?.freshness === 'stale' && !forceRefresh) {
		ctx.waitUntil(refresh().then(() => undefined).catch(() => undefined));
		return cached as CachedResource<T>;
	}

	try {
		const envelope = await refresh();
		return {
			descriptor,
			value: envelope.value as T | null,
			fetchedAt: envelope.fetchedAt,
			freshness: 'fresh',
			source: 'upstream',
		};
	} catch (error) {
		if (cached) return cached as CachedResource<T>;
		throw error;
	}
}

export function getResourceCacheKey(descriptor: ResourceDescriptor) {
	return descriptorKey(descriptor);
}

export function clearResourceCacheForTest() {
	memoryCache.clear();
	upstreamFlights.clear();
}

export const RESOURCE_CACHE_TTLS = {
	negativeMs: NEGATIVE_CACHE_MS,
	seriesFreshMs: SERIES_FRESH_MS,
	seriesStaleMs: SERIES_STALE_MS,
	stableFreshMs: STABLE_FRESH_MS,
	stableStaleMs: STABLE_STALE_MS,
} as const;
