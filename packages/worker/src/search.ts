import {
	type SearchResult,
	hasSameSearchResultIds,
} from '@tiny-client/shared/client';

export class DuplicateSearchPageError extends Error {
	constructor() {
		super('Upstream returned the previous search page');
		this.name = 'DuplicateSearchPageError';
	}
}

export function assertDistinctSearchResult(
	result: SearchResult,
	previousIds: string[],
) {
	if (hasSameSearchResultIds(result, previousIds)) {
		throw new DuplicateSearchPageError();
	}
	return result;
}

export async function selectFirstDistinctSearchResult<T>(
	candidates: Array<() => Promise<{ result: SearchResult; value: T }>>,
	previousIds: string[],
) {
	return Promise.any(
		candidates.map(async (candidate) => {
			const selected = await candidate();
			assertDistinctSearchResult(selected.result, previousIds);
			return selected;
		}),
	);
}
