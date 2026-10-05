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

/**
 * Remembers upstream domains that recently failed at the transport level so the next
 * request (including a user's "retry") tries healthy domains first. Shared by the isolate.
 */
export class DomainHealth {
	private failedAt = new Map<string, number>();

	constructor(private cooldownMs = 60_000, private now = () => Date.now()) {}

	/** Healthy domains keep their given order (preferred ones first); recently failed ones go last, oldest failure first. */
	order(domains: string[], preferred: Array<string | null | undefined> = []): string[] {
		const unique = [...new Set([...preferred.filter((domain): domain is string => !!domain && domains.includes(domain)), ...domains])];
		const now = this.now();
		const cooling = (domain: string) => {
			const at = this.failedAt.get(domain);
			return at !== undefined && now - at < this.cooldownMs;
		};
		const healthy = unique.filter((domain) => !cooling(domain));
		const failed = unique.filter(cooling).sort((a, b) => this.failedAt.get(a)! - this.failedAt.get(b)!);
		return [...healthy, ...failed];
	}

	fail(domain: string) {
		this.failedAt.set(domain, this.now());
	}

	succeed(domain: string) {
		this.failedAt.delete(domain);
	}
}

/** Duplicate pages and transport failures move on to the next domain; only transport failures mark a domain unhealthy. */
function isTransportFailure(error: unknown) {
	if (error instanceof DuplicateSearchPageError) return false;
	if (error && typeof error === 'object' && 'retryable' in error) return (error as { retryable: unknown }).retryable === true;
	return true;
}

/**
 * Tries domains one at a time instead of racing them: losing racers kept decrypting full
 * result pages and spent the free plan's CPU budget. Each attempt's client already retries a
 * reset connection once, so a single pass over the domains is enough.
 */
export async function searchDomainsInTurn<T>(options: {
	domains: string[];
	attempt: (domain: string) => Promise<{ result: SearchResult; value: T }>;
	previousIds: string[];
	health: DomainHealth;
	deadlineMs?: number;
	now?: () => number;
}): Promise<{ result: SearchResult; value: T; domain: string }> {
	const now = options.now ?? (() => Date.now());
	const deadline = now() + (options.deadlineMs ?? 20_000);
	const errors: unknown[] = [];
	for (const domain of options.domains) {
		if (errors.length && now() >= deadline) break;
		try {
			const selected = await options.attempt(domain);
			assertDistinctSearchResult(selected.result, options.previousIds);
			options.health.succeed(domain);
			return { ...selected, domain };
		} catch (error) {
			errors.push(error);
			if (isTransportFailure(error)) options.health.fail(domain);
		}
	}
	throw new AggregateError(errors, 'All upstream domains failed or returned duplicate search results');
}
