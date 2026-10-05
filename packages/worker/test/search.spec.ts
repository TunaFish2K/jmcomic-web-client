import { describe, expect, it } from 'vitest';
import {
	type SearchResult,
	hasSameSearchResultIds,
} from '@tiny-client/shared/client';
import {
	DomainHealth,
	DuplicateSearchPageError,
	assertDistinctSearchResult,
	searchDomainsInTurn,
} from '../src/search';

function createSearchResult(ids: string[]): SearchResult {
	return {
		search_query: 'test',
		total: String(ids.length),
		redirect_aid: undefined as never,
		content: ids.map((id) => ({ id, author: `author-${id}`, name: `name-${id}` })),
	};
}

describe('search result duplicate detection', () => {
	it('treats identical IDs as the same page regardless of order', () => {
		expect(hasSameSearchResultIds(createSearchResult(['1', '2']), ['1', '2'])).toBe(true);
		expect(hasSameSearchResultIds(createSearchResult(['2', '1']), ['1', '2'])).toBe(true);
	});

	it('accepts changed or empty result sets', () => {
		expect(hasSameSearchResultIds(createSearchResult(['1', '3']), ['1', '2'])).toBe(false);
		expect(hasSameSearchResultIds(createSearchResult([]), [])).toBe(false);
	});

	it('throws for a duplicate candidate', () => {
		expect(() => assertDistinctSearchResult(createSearchResult(['1', '2']), ['1', '2']))
			.toThrow(DuplicateSearchPageError);
	});
});

const reset = () => Object.assign(new Error('Upstream transport failed'), { retryable: true });
const rejected = () => Object.assign(new Error('Upstream rejected the request'), { retryable: false });

describe('domain health', () => {
	it('puts preferred domains first and recently failed ones last until they cool down', () => {
		let now = 0;
		const health = new DomainHealth(60_000, () => now);
		expect(health.order(['a', 'b', 'c'], ['c', 'x', null])).toEqual(['c', 'a', 'b']);
		health.fail('c');
		now = 10;
		health.fail('a');
		expect(health.order(['a', 'b', 'c'], ['c'])).toEqual(['b', 'c', 'a']);
		now = 60_005;
		expect(health.order(['a', 'b', 'c'])).toEqual(['b', 'c', 'a']);
		now = 60_011;
		expect(health.order(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
		health.fail('b');
		health.succeed('b');
		expect(health.order(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
	});
});

describe('searchDomainsInTurn', () => {
	it('tries domains one at a time and remembers transport failures for the next request', async () => {
		const health = new DomainHealth();
		const tried: string[] = [];
		const winner = await searchDomainsInTurn({
			domains: ['a', 'b', 'c'],
			health,
			previousIds: [],
			attempt: async (domain) => {
				tried.push(domain);
				if (domain === 'a') throw reset();
				return { result: createSearchResult([domain]), value: domain };
			},
		});
		expect(winner.domain).toBe('b');
		expect(tried).toEqual(['a', 'b']);
		expect(health.order(['a', 'b', 'c'])).toEqual(['b', 'c', 'a']);
	});

	it('skips duplicate pages without marking the domain unhealthy', async () => {
		const health = new DomainHealth();
		const winner = await searchDomainsInTurn({
			domains: ['a', 'b'],
			health,
			previousIds: ['1', '2'],
			attempt: async (domain) => ({ result: createSearchResult(domain === 'a' ? ['2', '1'] : ['3', '4']), value: domain }),
		});
		expect(winner.value).toBe('b');
		expect(health.order(['a', 'b'])).toEqual(['a', 'b']);
	});

	it('does not mark business refusals as unhealthy and fails with every cause', async () => {
		const health = new DomainHealth();
		const failure = searchDomainsInTurn({
			domains: ['a', 'b'],
			health,
			previousIds: [],
			attempt: async (domain) => { throw domain === 'a' ? rejected() : reset(); },
		});
		await expect(failure).rejects.toBeInstanceOf(AggregateError);
		await failure.catch((error: AggregateError) => expect(error.errors).toHaveLength(2));
		// 'a' refused the query (not a transport failure) and stays first; 'b' reset and moves last.
		expect(health.order(['b', 'a'])).toEqual(['a', 'b']);
	});

	it('stops starting new domains after the deadline', async () => {
		let now = 0;
		const tried: string[] = [];
		await expect(searchDomainsInTurn({
			domains: ['a', 'b', 'c'],
			health: new DomainHealth(),
			previousIds: [],
			now: () => now,
			deadlineMs: 1000,
			attempt: async (domain) => {
				tried.push(domain);
				now += 1500;
				throw new TypeError('fetch failed');
			},
		})).rejects.toBeInstanceOf(AggregateError);
		expect(tried).toEqual(['a']);
	});
});
