import { JmError } from 'jmcomic-sdk-pwa';
import { createMobileClient, type MobileClient } from 'jmcomic-sdk-pwa/mobile';

/** Public discovery routes. Each entry validates its own query and declares a browser/edge TTL (0 = no-store). */
interface MobileRoute {
	ttl: number;
	run(client: MobileClient, query: URLSearchParams, signal: AbortSignal): Promise<unknown>;
}

export const MOBILE_PREFIX = '/api/mobile';
const CACHE_ORIGIN = 'https://mobile-cache.invalid/v1';
const ID = /^\d{1,16}$/;
const SLUG = /^[\w-]{1,40}$/;
const CATEGORY_ORDER = /^(?:|mr|mv|mp|tf|mv_[mwt]|mp_[mwt])$/;

function param(query: URLSearchParams, name: string, pattern: RegExp, fallback?: string): string {
	const value = query.get(name) ?? fallback;
	if (value === undefined || !pattern.test(value)) throw new JmError('INVALID_ARGUMENT', `Invalid '${name}'`);
	return value;
}
function page(query: URLSearchParams, min: number): number {
	const value = Number(query.get('page') ?? String(min));
	if (!Number.isSafeInteger(value) || value < min || value > 10000) throw new JmError('INVALID_ARGUMENT', "Invalid 'page'");
	return value;
}

const routes: Record<string, MobileRoute> = {
	'/promote': { ttl: 300, run: (client, _, signal) => client.promote({ signal }) },
	'/promote-list': {
		ttl: 300,
		run: (client, query, signal) => client.promoteList(param(query, 'id', ID), page(query, 0), { signal }),
	},
	'/latest': { ttl: 120, run: (client, query, signal) => client.latest(page(query, 0), { signal }) },
	'/serialization': {
		ttl: 300,
		run: (client, query, signal) => client.serialization(
			{ type: param(query, 'type', SLUG, 'all'), date: param(query, 'date', /^[1-7]$/), page: page(query, 1) },
			{ signal },
		),
	},
	'/categories': { ttl: 3600, run: (client, _, signal) => client.categories({ signal }) },
	'/categories/filter': {
		ttl: 300,
		run: (client, query, signal) => client.categoryFilter(
			{ category: param(query, 'c', SLUG, '0'), order: param(query, 'o', CATEGORY_ORDER, ''), page: page(query, 1) },
			{ signal },
		),
	},
	'/week': { ttl: 3600, run: (client, _, signal) => client.week({ signal }) },
	'/week/filter': {
		ttl: 600,
		run: (client, query, signal) => client.weekFilter(
			{ id: param(query, 'id', ID), type: param(query, 'type', SLUG), page: page(query, 1) },
			{ signal },
		),
	},
	'/hot-tags': { ttl: 3600, run: (client, _, signal) => client.hotTags({ signal }) },
	'/random': { ttl: 0, run: (client, _, signal) => client.randomRecommend({ signal }) },
	'/comments': {
		ttl: 60,
		run: (client, query, signal) => client.comments({ albumId: param(query, 'aid', ID), page: page(query, 1) }, { signal }),
	},
};

const STATUS: Record<string, number> = {
	INVALID_ARGUMENT: 400, UNAUTHORIZED: 401, NOT_FOUND: 404, TIMEOUT: 504,
	UPSTREAM: 502, INVALID_RESPONSE: 502, WRITE_UNCERTAIN: 502, ABORTED: 499,
};

export function mobileError(error: unknown, corsHeaders: Record<string, string>): Response {
	const known = error instanceof JmError;
	const code = known ? error.code : 'INTERNAL';
	if (!known) console.error('Mobile route failed', error);
	return Response.json(
		{ error: { code, message: known ? error.message : 'Internal error' } },
		{ status: STATUS[code] ?? 500, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } },
	);
}

/** Normalizes the query so equivalent requests share one edge cache entry. */
function cacheKey(path: string, query: URLSearchParams): Request {
	const sorted = new URLSearchParams([...query].sort(([a], [b]) => a.localeCompare(b)));
	return new Request(`${CACHE_ORIGIN}${path}?${sorted}`);
}

export interface MobileContext {
	env: Env;
	ctx: ExecutionContext;
	corsHeaders: Record<string, string>;
	/** Shares the Worker's cached domain discovery with the mobile client. */
	getDomains(): Promise<string[]>;
}

/** Handles `/api/mobile/*`, or returns null for other paths. */
export async function handleMobileRequest(request: Request, url: URL, context: MobileContext): Promise<Response | null> {
	if (url.pathname !== MOBILE_PREFIX && !url.pathname.startsWith(`${MOBILE_PREFIX}/`)) return null;
	const { env, ctx, corsHeaders } = context;
	const path = url.pathname.slice(MOBILE_PREFIX.length) || '/';
	if (request.method !== 'GET') {
		return Response.json(
			{ error: { code: 'INVALID_ARGUMENT', message: 'Method not allowed' } },
			{ status: 405, headers: { ...corsHeaders, 'Cache-Control': 'no-store', Allow: 'GET' } },
		);
	}

	if (path === '/config') {
		return Response.json(
			{ accountEnabled: Boolean(env.ACCOUNT_SESSION_KEY) },
			{ headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=60' } },
		);
	}
	const route = routes[path];
	if (!route) return mobileError(new JmError('NOT_FOUND', 'Unknown mobile route'), corsHeaders);

	const key = cacheKey(path, url.searchParams);
	const edge = route.ttl > 0 ? caches.default : null;
	const hit = await edge?.match(key);
	if (hit) {
		const response = new Response(hit.body, hit);
		response.headers.set('X-Cache', 'edge');
		return response;
	}

	let client: MobileClient | undefined;
	try {
		client = createMobileClient({ domains: await context.getDomains(), retries: 1 });
		const data = await route.run(client, url.searchParams, request.signal);
		const headers = {
			...corsHeaders,
			'Cache-Control': edge ? `public, max-age=${route.ttl}` : 'no-store',
			'X-Cache': edge ? 'miss' : 'bypass',
		};
		const response = Response.json(data, { headers });
		if (edge) ctx.waitUntil(edge.put(key, response.clone()));
		return response;
	} catch (error) {
		return mobileError(error, corsHeaders);
	} finally {
		client?.dispose();
	}
}
