// Search result cache keyed by query + options + page. Stores the final
// (post duplicate-guard) result so repeated pagination round-trips don't
// hammer upstream. Short TTL: search results change often.
export const SEARCH_RESULT_CACHE_TTL_MS = 30_000;

type CacheEntry<T> = { data: T; ts: number };

export class SearchResultCache<T = unknown> {
	private entries = new Map<string, CacheEntry<T>>();

	constructor(private ttlMs: number = SEARCH_RESULT_CACHE_TTL_MS) {}

	get(key: string): T | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (Date.now() - entry.ts > this.ttlMs) {
			this.entries.delete(key);
			return undefined;
		}
		return entry.data;
	}

	set(key: string, data: T) {
		this.entries.set(key, { data, ts: Date.now() });
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}
}
