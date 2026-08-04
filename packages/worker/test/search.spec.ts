import { describe, expect, it } from 'vitest';
import {
	type SearchResult,
	hasSameSearchResultIds,
} from '@tiny-client/shared/client';
import {
	DuplicateSearchPageError,
	assertDistinctSearchResult,
	selectFirstDistinctSearchResult,
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

	it('selects the first candidate that differs from the previous page', async () => {
		const selected = await selectFirstDistinctSearchResult(
			[
				async () => ({ result: createSearchResult(['1', '2']), value: 'duplicate' }),
				async () => ({ result: createSearchResult(['3', '4']), value: 'distinct' }),
			],
			['1', '2'],
		);

		expect(selected.value).toBe('distinct');
		expect(selected.result.content.map((item) => item.id)).toEqual(['3', '4']);
	});

	it('rejects when every candidate repeats the previous page', async () => {
		await expect(selectFirstDistinctSearchResult(
			[
				async () => ({ result: createSearchResult(['1', '2']), value: 'a' }),
				async () => ({ result: createSearchResult(['2', '1']), value: 'b' }),
			],
			['1', '2'],
		)).rejects.toBeInstanceOf(AggregateError);
	});
});
