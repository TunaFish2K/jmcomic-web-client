import { JmError } from 'jmcomic-sdk-pwa';
import { createMobileClient, type FavoriteFolderEdit, type MobileClient, type MobileWriteResult } from 'jmcomic-sdk-pwa/mobile';
import { mobileError } from './mobile';
import { requireSession, sealSession, SessionError, type AccountSession } from './mobile-session';

type Input = Record<string, unknown>;
interface AccountRoute {
	method: 'GET' | 'POST';
	/** Public account routes (login, register, forgot) need the deployment key but no session. */
	auth: boolean;
	run(client: MobileClient, input: Input, context: { session?: AccountSession; secret: string; signal: AbortSignal }): Promise<unknown>;
}
export interface AccountContext {
	env: Env;
	corsHeaders: Record<string, string>;
	domains(): Promise<string[]>;
	methodNotAllowed(allow: string, corsHeaders: Record<string, string>): Response;
}

const MAX_BODY_BYTES = 16 * 1024;
/** Profile fields the official app's edit form submits; anything else is ignored. */
const PROFILE_FIELDS = ['username', 'email', 'password', 'password_confirm', 'birthday', 'relations', 'sexuality', 'website', 'city', 'country'];

function text(input: Input, name: string, max = 200, optional = false): string {
	const value = input[name];
	if (value === undefined && optional) return '';
	if (typeof value !== 'string' || !value.trim() || value.length > max) throw new JmError('INVALID_ARGUMENT', `Invalid '${name}'`);
	return value;
}
function digits(input: Input, name: string, optional = false): string {
	const value = input[name];
	if ((value === undefined || value === '') && optional) return '';
	const string = typeof value === 'number' ? String(value) : value;
	if (typeof string !== 'string' || !/^\d{1,16}$/.test(string)) throw new JmError('INVALID_ARGUMENT', `Invalid '${name}'`);
	return string;
}
function pageNumber(input: Input): number {
	const value = Number(input.page ?? 1);
	if (!Number.isSafeInteger(value) || value < 1 || value > 10000) throw new JmError('INVALID_ARGUMENT', "Invalid 'page'");
	return value;
}
/** Write results expose the upstream message and the favorite `type` only; raw data stays in the Worker. */
function result(write: MobileWriteResult) {
	return { ok: write.ok, message: write.message, ...(typeof write.data.type === 'string' ? { type: write.data.type } : {}) };
}
const scalar = (value: unknown): value is string | number | boolean =>
	typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
function profileView(raw: Record<string, unknown>): Record<string, string> {
	return Object.fromEntries(Object.entries(raw).filter(([key, value]) => scalar(value) && !/password|token|^s$/i.test(key)).map(([key, value]) => [key, String(value)]));
}

const routes: Record<string, AccountRoute> = {
	'/login': {
		method: 'POST', auth: false,
		async run(client, input, { secret, signal }) {
			const { account, member } = await client.login(text(input, 'username', 100), text(input, 'password', 200), { signal });
			const { token, expiresAt } = await sealSession(secret, account);
			return { session: token, expiresAt, member: { uid: member.uid, username: member.username, email: member.email, level: member.level, coin: member.coin } };
		},
	},
	'/register': {
		method: 'POST', auth: false,
		run: async (client, input, { signal }) => result(await client.register({
			username: text(input, 'username', 100), password: text(input, 'password', 200),
			passwordConfirm: text(input, 'passwordConfirm', 200), email: text(input, 'email', 200),
			gender: text(input, 'gender', 20),
		}, { signal })),
	},
	'/forgot': {
		method: 'POST', auth: false,
		run: async (client, input, { signal }) => result(await client.forgot(text(input, 'email', 200), { signal })),
	},
	'/session': {
		method: 'GET', auth: true,
		run: async (_, __, { session }) => ({ uid: session!.uid, expiresAt: session!.exp }),
	},
	'/logout': { method: 'POST', auth: true, run: async (client, _, { signal }) => result(await client.logout({ signal })) },
	'/profile': { method: 'GET', auth: true, run: async (client, _, { signal }) => profileView(await client.profile({ signal })) },
	'/profile/update': {
		method: 'POST', auth: true,
		async run(client, input, { signal }) {
			const edits = input.fields !== null && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields as Input : {};
			const changes = Object.fromEntries(PROFILE_FIELDS.filter((key) => key in edits).map((key) => [key, text(edits, key, 200, true)]));
			if (!Object.keys(changes).length) throw new JmError('INVALID_ARGUMENT', 'No profile fields to update');
			// The official form resubmits every field it loaded, so unchanged values are sent back as they are.
			const current = profileView(await client.profile({ signal }));
			return result(await client.updateProfile({ ...current, ...changes }, { signal }));
		},
	},
	'/favorites': {
		method: 'GET', auth: true,
		run: (client, input, { signal }) => client.favorites({
			page: pageNumber(input), folderId: digits(input, 'folder', true) || '0',
			order: input.order === 'mp' ? 'mp' : 'mr',
		}, { signal }),
	},
	'/favorite': { method: 'POST', auth: true, run: async (client, input, { signal }) => result(await client.toggleFavorite(digits(input, 'aid'), { signal })) },
	'/favorite-folder': {
		method: 'POST', auth: true,
		async run(client, input, { signal }) {
			let edit: FavoriteFolderEdit;
			switch (input.type) {
				case 'add': edit = { type: 'add', name: text(input, 'name', 40) }; break;
				case 'edit': edit = { type: 'edit', folderId: digits(input, 'folderId'), name: text(input, 'name', 40) }; break;
				case 'del': edit = { type: 'del', folderId: digits(input, 'folderId') }; break;
				case 'move': edit = { type: 'move', folderId: digits(input, 'folderId'), albumId: digits(input, 'aid') }; break;
				default: throw new JmError('INVALID_ARGUMENT', "Invalid 'type'");
			}
			return result(await client.editFavoriteFolder(edit, { signal }));
		},
	},
	'/like': { method: 'POST', auth: true, run: async (client, input, { signal }) => result(await client.like(digits(input, 'aid'), { signal })) },
	'/comment': {
		method: 'POST', auth: true,
		run: async (client, input, { signal }) => result(await client.comment({
			albumId: digits(input, 'aid'), content: text(input, 'content', 2000), replyTo: digits(input, 'replyTo', true) || undefined,
		}, { signal })),
	},
	'/comment/delete': {
		method: 'POST', auth: true,
		run: async (client, input, { signal }) => result(await client.deleteComment({ commentId: digits(input, 'commentId'), albumId: digits(input, 'aid') }, { signal })),
	},
	'/daily': { method: 'GET', auth: true, run: (client, _, { signal }) => client.daily({ signal }) },
	'/daily/check': { method: 'POST', auth: true, run: async (client, input, { signal }) => result(await client.dailyCheck(digits(input, 'dailyId'), { signal })) },
	'/daily/list': { method: 'GET', auth: true, run: (client, _, { signal }) => client.dailyList({ signal }) },
	'/daily/month': {
		method: 'GET', auth: true,
		run: (client, input, { signal }) => {
			const month = typeof input.month === 'string' && /^[\w-]{1,20}$/.test(input.month) ? input.month : '';
			if (!month) throw new JmError('INVALID_ARGUMENT', "Invalid 'month'");
			return client.dailyFilter(month, { signal });
		},
	},
	'/history': { method: 'GET', auth: true, run: (client, input, { signal }) => client.history(pageNumber(input), { signal }) },
	'/history/delete': { method: 'POST', auth: true, run: async (client, input, { signal }) => result(await client.removeHistory(digits(input, 'aid'), { signal })) },
};

async function readJson(request: Request): Promise<Input> {
	if (!/^application\/json\b/i.test(request.headers.get('Content-Type') ?? '')) throw new JmError('INVALID_ARGUMENT', 'Expected a JSON body');
	const body = await request.arrayBuffer();
	if (body.byteLength > MAX_BODY_BYTES) throw new JmError('INVALID_ARGUMENT', 'Request body is too large');
	let value: unknown;
	try { value = body.byteLength ? JSON.parse(new TextDecoder().decode(body)) : {}; }
	catch { throw new JmError('INVALID_ARGUMENT', 'Invalid JSON body'); }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new JmError('INVALID_ARGUMENT', 'Expected a JSON object');
	return value as Input;
}

/**
 * `/api/mobile/account/*`: every response is no-store and nothing passes through a cache.
 * The user ID always comes from the sealed session, never from the request.
 */
export async function handleAccountRequest(request: Request, url: URL, path: string, context: AccountContext): Promise<Response> {
	const { env, corsHeaders } = context;
	const route = routes[path];
	if (!route) return mobileError(new JmError('NOT_FOUND', 'Unknown account route'), corsHeaders);
	if (request.method !== route.method) return context.methodNotAllowed(route.method, corsHeaders);

	let client: MobileClient | undefined;
	try {
		const secret = env.ACCOUNT_SESSION_KEY;
		if (!secret) throw new SessionError('ACCOUNT_DISABLED', 'Account features are not configured on this deployment');
		const session = route.auth ? await requireSession(request, secret) : undefined;
		const input = route.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(request);
		client = createMobileClient({ domains: await context.domains(), retries: 1, account: session });
		const data = await route.run(client, input, { session, secret, signal: request.signal });
		return Response.json(data, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
	} catch (error) {
		return mobileError(error, corsHeaders);
	} finally {
		client?.dispose();
	}
}
