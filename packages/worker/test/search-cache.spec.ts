import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchResultCache, SEARCH_RESULT_CACHE_TTL_MS } from '../src/search-cache';

describe('SearchResultCache', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns undefined for a missing key', () => {
		const cache = new SearchResultCache();
		expect(cache.get('missing')).toBeUndefined();
		expect(cache.has('missing')).toBe(false);
	});

	it('returns cached data within the TTL', () => {
		const cache = new SearchResultCache();
		cache.set('key', { ids: [1, 2] });

		expect(cache.get('key')).toEqual({ ids: [1, 2] });
		expect(cache.has('key')).toBe(true);
	});

	it('evicts entries once the TTL elapses', () => {
		const cache = new SearchResultCache();
		cache.set('key', { ids: [1, 2] });

		vi.advanceTimersByTime(SEARCH_RESULT_CACHE_TTL_MS + 1);
		expect(cache.get('key')).toBeUndefined();
		expect(cache.has('key')).toBe(false);
	});

	it('overwrites an existing key with newer data', () => {
		const cache = new SearchResultCache();
		cache.set('key', { ids: [1] });
		cache.set('key', { ids: [2] });

		expect(cache.get('key')).toEqual({ ids: [2] });
	});

	it('preserves the original timestamp when promoting another cache layer', () => {
		const cache = new SearchResultCache();
		cache.set('key', { ids: [1] }, 0);

		vi.advanceTimersByTime(SEARCH_RESULT_CACHE_TTL_MS + 1);
		expect(cache.get('key')).toBeUndefined();
	});

	it('bounds entries and retains a recently read key', () => {
		const cache = new SearchResultCache(SEARCH_RESULT_CACHE_TTL_MS, 2);
		cache.set('first', 1);
		cache.set('second', 2);
		expect(cache.get('first')).toBe(1);
		cache.set('third', 3);
		expect(cache.get('second')).toBeUndefined();
		expect(cache.get('first')).toBe(1);
		expect(cache.get('third')).toBe(3);
	});
});
