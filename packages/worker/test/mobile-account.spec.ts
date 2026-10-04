import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { createCipheriv, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { openSession, sealSession, SESSION_TTL_MS } from '../src/mobile-session';

const KEY = 'test-account-session-key';
const md5 = (value: string) => createHash('md5').update(value).digest('hex');
function encrypted(value: unknown, key: string) {
	const cipher = createCipheriv('aes-256-ecb', Buffer.from(key), Buffer.alloc(0));
	return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}
const jwt = (exp?: number) => `h.${Buffer.from(JSON.stringify(exp ? { exp } : {})).toString('base64url')}.s`;

interface Seen { url: URL; method: string; headers: Headers; form: Record<string, string> }
let seen: Seen[] = [];
let respond: (call: Seen) => unknown;
beforeEach(() => {
	seen = [];
	respond = () => ({ status: 'ok', msg: 'done' });
	vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('.txt')) return new Response(encrypted({ Server: ['api.test'] }, md5('diosfjckwpqpdfjkvnqQjsik')));
		const headers = new Headers(init?.headers);
		const stamp = headers.get('tokenparam')!.split(',')[0];
		const json = (value: unknown) => Response.json({ code: 200, data: encrypted(value, md5(`${stamp}185Hcomic3PAPP7R`)) });
		if (url.pathname === '/setting') return json({ version: '2.0.16', img_host: 'https://cdn.test' });
		const form = init?.body instanceof FormData ? Object.fromEntries([...init.body].map(([k, v]) => [k, String(v)])) : {};
		const call = { url, method: init?.method ?? 'GET', headers, form };
		seen.push(call);
		const value = respond(call);
		return value instanceof Response ? value : json(value);
	}));
});
afterEach(() => vi.unstubAllGlobals());

const bindings = { ...env, ACCOUNT_SESSION_KEY: KEY } as Env;
async function request(path: string, init: RequestInit & { json?: unknown; session?: string } = {}, scope: Env = bindings) {
	const headers = new Headers(init.headers);
	if (init.json !== undefined) headers.set('Content-Type', 'application/json');
	if (init.session) headers.set('Authorization', `Bearer ${init.session}`);
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`https://app.test/api/mobile/account${path}`, {
		method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'), headers,
		body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
	}), scope, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}
async function login(uid = '42') {
	respond = (call) => call.url.pathname === '/login'
		? { uid, username: `user${uid}`, email: 'u@example.test', jwttoken: jwt(), s: `avs-${uid}`, level_name: 'Lv1', coin: '3', password: 'never' }
		: { status: 'ok', msg: 'done' };
	const response = await request('/login', { json: { username: `user${uid}`, password: 'secret' } });
	expect(response.status).toBe(200);
	return response.json() as Promise<{ session: string; expiresAt: number; member: Record<string, unknown> }>;
}

describe('session tokens', () => {
	it('round-trips, expires after an hour and never outlives the upstream JWT', async () => {
		const now = 1_000_000_000_000;
		const sealed = await sealSession(KEY, { uid: '42', jwt: jwt(), avs: 'a' }, now);
		expect(sealed.expiresAt).toBe(now + SESSION_TTL_MS);
		expect(await openSession(KEY, sealed.token, now + 1000)).toMatchObject({ uid: '42', jwt: jwt(), avs: 'a' });
		await expect(openSession(KEY, sealed.token, now + SESSION_TTL_MS)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
		const short = await sealSession(KEY, { uid: '42', jwt: jwt(now / 1000 + 60), avs: 'a' }, now);
		expect(short.expiresAt).toBe(now + 60_000);
	});

	it('rejects tampered tokens and tokens sealed with another key', async () => {
		const { token } = await sealSession(KEY, { uid: '42', jwt: 'plaintext-jwt-marker', avs: 'a' });
		const flipped = token.slice(0, -2) + (token.at(-2) === 'A' ? 'B' : 'A') + token.at(-1);
		await expect(openSession(KEY, flipped)).rejects.toMatchObject({ code: 'SESSION_INVALID' });
		await expect(openSession('other-key', token)).rejects.toMatchObject({ code: 'SESSION_INVALID' });
		await expect(openSession(KEY, 'v1.')).rejects.toMatchObject({ code: 'SESSION_INVALID' });
		expect(Buffer.from(token.slice(3), 'base64url').toString('latin1')).not.toContain('plaintext-jwt-marker');
	});
});

describe('account routes', () => {
	it('logs in once, returns a sealed session and never exposes upstream credentials', async () => {
		const body = await login();
		expect(body.member).toEqual({ uid: '42', username: 'user42', email: 'u@example.test', level: 'Lv1', coin: 3 });
		expect(JSON.stringify(body)).not.toMatch(/avs-42|never|jwttoken/);
		expect(seen.filter((call) => call.url.pathname === '/login')).toHaveLength(1);
		expect(seen[0]!.form).toEqual({ username: 'user42', password: 'secret' });
		const check = await request('/session', { session: body.session });
		expect(await check.json()).toEqual({ uid: '42', expiresAt: body.expiresAt });
		expect(check.headers.get('Cache-Control')).toBe('no-store');
	});

	it('binds account calls to the session user and ignores user IDs from the request', async () => {
		const { session } = await login('42');
		respond = () => ({ daily_id: '7', event_name: 'Event', currentProgress: '50%', record: [[{ date: '1', signed: true, bonus: false }]] });
		const daily = await request('/daily?user_id=99&uid=99', { session });
		expect(await daily.json()).toMatchObject({ dailyId: '7', record: [[{ date: '1', signed: true, bonus: false }]] });
		const call = seen.at(-1)!;
		expect(call.url.searchParams.get('user_id')).toBe('42');
		expect(call.headers.get('authorization')).toBe(`Bearer ${jwt()}`);
		expect(call.headers.get('cookie')).toContain('AVS=avs-42');

		respond = () => ({ status: 'ok', msg: 'checked' });
		await request('/daily/check', { session, json: { dailyId: '7', user_id: '99' } });
		expect(seen.at(-1)!.form).toEqual({ user_id: '42', daily_id: '7' });
	});

	it('keeps concurrent users isolated', async () => {
		const [a, b] = [await login('1'), await login('2')];
		respond = (call) => ({ total: 0, folder_list: [], list: [], echo: call.headers.get('cookie') });
		await Promise.all([request('/favorites', { session: a.session }), request('/favorites', { session: b.session })]);
		const cookies = seen.filter((call) => call.url.pathname === '/favorite').map((call) => call.headers.get('cookie'));
		expect(cookies.sort()).toEqual([expect.stringContaining('AVS=avs-1'), expect.stringContaining('AVS=avs-2')]);
	});

	it('sends writes once, maps folder edits and reports refusals', async () => {
		const { session } = await login();
		respond = () => ({ status: 'ok', msg: '已加入收藏', type: 'add' });
		const toggled = await request('/favorite', { session, json: { aid: '123' } });
		expect(await toggled.json()).toEqual({ ok: true, message: '已加入收藏', type: 'add' });
		await request('/favorite-folder', { session, json: { type: 'move', folderId: '5', aid: '123' } });
		expect(seen.at(-1)!.form).toEqual({ type: 'move', folder_id: '5', aid: '123' });
		respond = () => ({ status: 'fail', msg: '名稱重複' });
		expect(await (await request('/favorite-folder', { session, json: { type: 'add', name: 'Dup' } })).json()).toEqual({ ok: false, message: '名稱重複' });

		respond = () => new Response('busy', { status: 503 });
		const before = seen.length;
		const uncertain = await request('/comment', { session, json: { aid: '123', content: 'Hi', replyTo: '9' } });
		expect(uncertain.status).toBe(502);
		expect(await uncertain.json()).toMatchObject({ error: { code: 'WRITE_UNCERTAIN' } });
		expect(seen.length - before).toBe(1);
		expect(seen.at(-1)!.form).toEqual({ aid: '123', comment: 'Hi', comment_id: '9' });
	});

	it('shows wrong passwords as a business refusal', async () => {
		respond = () => Response.json({ code: 400, errorMsg: '帳號或密碼錯誤' }, { status: 400 });
		const response = await request('/login', { json: { username: 'user', password: 'wrong' } });
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ error: { code: 'UPSTREAM_REJECTED', message: 'Upstream rejected the request: 帳號或密碼錯誤' } });
	});

	it('resends the loaded profile with only allowed edits', async () => {
		const { session } = await login();
		respond = (call) => call.method === 'GET'
			? { username: 'user42', email: 'old@example.test', city: 'Taipei', jwttoken: 'x', nested: { a: 1 } }
			: { status: 'ok', msg: 'saved' };
		const response = await request('/profile/update', { session, json: { fields: { email: 'new@example.test', admin: '1' } } });
		expect(await response.json()).toEqual({ ok: true, message: 'saved' });
		const post = seen.at(-1)!;
		expect(post.url.pathname).toBe('/useredit/42');
		expect(post.form).toEqual({ username: 'user42', email: 'new@example.test', city: 'Taipei' });
	});

	it('rejects missing, expired, tampered and foreign sessions before calling upstream', async () => {
		const expired = await sealSession(KEY, { uid: '42', jwt: 'j', avs: 'a' }, Date.now() - SESSION_TTL_MS - 1);
		const foreign = await sealSession('other-key', { uid: '42', jwt: 'j', avs: 'a' });
		for (const [session, code] of [[undefined, 'SESSION_INVALID'], [expired.token, 'SESSION_EXPIRED'], [foreign.token, 'SESSION_INVALID']] as const) {
			const response = await request('/favorites', { session });
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ error: { code } });
		}
		expect(seen).toHaveLength(0);
	});

	it('is disabled without a deployment key and validates methods and bodies', async () => {
		const disabled = await request('/login', { json: { username: 'u', password: 'p' } }, env);
		expect(disabled.status).toBe(503);
		expect(await disabled.json()).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } });
		expect((await request('/login')).status).toBe(405);
		const notJson = await request('/login', { method: 'POST', body: 'username=u' } as RequestInit);
		expect(notJson.status).toBe(400);
		expect((await request('/favorite-folder', { session: (await login()).session, json: { type: 'drop' } })).status).toBe(400);
		expect((await request('/unknown')).status).toBe(404);
	});
});
