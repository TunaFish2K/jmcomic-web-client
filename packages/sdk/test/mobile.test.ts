import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash } from 'node:crypto';
import { createMobileClient } from '../dist/mobile.js';
import type { Fetch } from '../src/types.js';

const md5 = (text: string) => createHash('md5').update(text).digest('hex');
const encrypt = (data: unknown, stamp: string) => {
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(md5(`${stamp}185Hcomic3PAPP7R`)), null);
  return Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]).toString('base64');
};
interface Seen { url: URL; method: string; headers: Headers; body: string }
/** Mock upstream: /setting answers like the real server, other paths are handled by `route`. */
function upstream(route: (seen: Seen) => Response | Promise<Response>, seen: Seen[] = []): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    let body = '';
    if (init?.body instanceof FormData) body = new URLSearchParams([...init.body].map(([k, v]) => [k, String(v)])).toString();
    else if (typeof init?.body === 'string') body = init.body;
    if (url.pathname === '/setting') return new Response(JSON.stringify({ code: 200, data: JSON.stringify({ version: '2.0.16', img_host: 'https://images.test' }) }), { headers: { 'set-cookie': 'ipcountry=TW; Path=/' } });
    const entry = { url, method: init?.method ?? 'GET', headers, body };
    seen.push(entry);
    return route(entry);
  }) as Fetch;
}
const ok = (data: unknown, stamp?: string) => Response.json({ code: 200, data: stamp ? encrypt(data, stamp) : JSON.stringify(data) });
const stampOf = (seen: Seen) => seen.headers.get('tokenparam')!.split(',')[0]!;
const loginData = { uid: '42', username: 'reader', email: 'r@example.test', jwttoken: 'jwt-token', s: 'avs-cookie', level_name: 'Lv1', coin: '7' };

test('discovery calls are signed like APK 2.1.9 and decode encrypted lists', async () => {
  const seen: Seen[] = [];
  const client = createMobileClient({ domains: ['api.test'], retries: 0, fetch: upstream(entry =>
    ok([{ id: '1', name: 'Album', author: 'A', image: '', category: { id: '2', title: '單本' }, liked: false, is_favorite: true, update_at: 1 }], stampOf(entry)), seen) });
  try {
    const items = await client.latest(0);
    assert.deepEqual(items, [{ id: '1', name: 'Album', author: 'A', image: '', category: { id: '2', title: '單本' }, liked: false, favorite: true, updatedAt: 1 }]);
    const [call] = seen;
    const stamp = stampOf(call!);
    assert.equal(call!.headers.get('token'), md5(`${stamp}185Hcomic3PAPP7R`));
    assert.equal(call!.headers.get('tokenparam'), `${stamp},2.1.9`);
    assert.equal(call!.url.searchParams.get('lang'), 'TW');
    assert.equal(call!.headers.get('authorization'), null);
  } finally { client.dispose(); }
});

test('login keeps the account on the instance and sends JWT and AVS on account calls', async () => {
  const seen: Seen[] = [];
  const client = createMobileClient({ domains: ['api.test'], retries: 0, fetch: upstream(entry => {
    if (entry.url.pathname === '/login') return ok(loginData);
    return ok({ list: [], total: '0', folder_list: [] });
  }, seen) });
  try {
    await assert.rejects(client.favorites({ page: 1 }), { code: 'UNAUTHORIZED' });
    assert.equal(seen.length, 0);
    const result = await client.login('reader', 'secret');
    assert.deepEqual(result.account, { uid: '42', jwt: 'jwt-token', avs: 'avs-cookie' });
    assert.equal(result.member.username, 'reader');
    assert.equal(seen[0]!.method, 'POST');
    assert.equal(seen[0]!.body, 'username=reader&password=secret');
    await client.favorites({ page: 1 });
    assert.equal(seen[1]!.headers.get('authorization'), 'Bearer jwt-token');
    assert.match(seen[1]!.headers.get('cookie')!, /AVS=avs-cookie/);
    await client.daily();
    assert.equal(seen[2]!.url.searchParams.get('user_id'), '42');
    const other = createMobileClient({ domains: ['api.test'], retries: 0, fetch: upstream(() => ok([]), seen) });
    try { await other.hotTags(); assert.equal(seen.at(-1)!.headers.get('authorization'), null); }
    finally { other.dispose(); }
  } finally { client.dispose(); }
});

test('writes are sent once and report an unknown result instead of retrying', async () => {
  const seen: Seen[] = [];
  const client = createMobileClient({ domains: ['a.test', 'b.test'], retries: 2, account: { uid: '42', jwt: 'j', avs: 'a' },
    fetch: upstream(() => new Response('busy', { status: 503 }), seen) });
  try {
    await assert.rejects(client.toggleFavorite('123'), (error: any) => {
      assert.equal(error.code, 'WRITE_UNCERTAIN'); assert.equal(error.operation, 'toggle-favorite'); return true;
    });
    assert.equal(seen.length, 1);
  } finally { client.dispose(); }
});

test('reads fail over to another domain and keep the account', async () => {
  const seen: Seen[] = [];
  const client = createMobileClient({ domains: ['a.test', 'b.test'], retries: 0, account: { uid: '42', jwt: 'j', avs: 'a' },
    fetch: upstream(entry => seen.length === 1 ? new Response('busy', { status: 503 }) : ok({ list: [], total: 0 }), seen) });
  try {
    await client.history(1);
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0]!.url.host, seen[1]!.url.host);
    assert.equal(seen[1]!.headers.get('authorization'), 'Bearer j');
  } finally { client.dispose(); }
});

test('business errors carry the upstream message and are not retried', async () => {
  const seen: Seen[] = [];
  const client = createMobileClient({ domains: ['api.test'], retries: 2, fetch: upstream(() =>
    Response.json({ code: 400, errorMsg: '帳號或密碼錯誤' }, { status: 400 }), seen) });
  try {
    await assert.rejects(client.login('reader', 'wrong'), (error: any) => {
      assert.equal(error.code, 'UPSTREAM'); assert.match(error.message, /帳號或密碼錯誤/);
      assert.doesNotMatch(JSON.stringify(error), /wrong/); return true;
    });
    assert.equal(seen.length, 1);
  } finally { client.dispose(); }
});

test('write results distinguish refusal from success and logout clears the account', async () => {
  const client = createMobileClient({ domains: ['api.test'], retries: 0, account: { uid: '42', jwt: 'j', avs: 'a' }, fetch: upstream(entry => {
    if (entry.url.pathname === '/favorite') return ok({ status: 'ok', msg: '已加入收藏', type: 'add' });
    if (entry.url.pathname === '/watch_list') return ok({ status: 0, msg: '刪除失敗' });
    if (entry.url.pathname === '/favorite_folder') return ok({ status: 'ok', msg: 'moved' });
    return ok({});
  }) });
  try {
    assert.deepEqual(await client.toggleFavorite('123'), { ok: true, message: '已加入收藏', data: { status: 'ok', msg: '已加入收藏', type: 'add' } });
    assert.equal((await client.removeHistory('123')).ok, false);
    assert.equal((await client.editFavoriteFolder({ type: 'move', folderId: '9', albumId: '123' })).ok, true);
    await assert.rejects(client.editFavoriteFolder({ type: 'add', name: ' ' }), { code: 'INVALID_ARGUMENT' });
    await client.logout();
    assert.equal(client.account, undefined);
    await assert.rejects(client.profile(), { code: 'UNAUTHORIZED' });
  } finally { client.dispose(); }
});

test('comments keep reply links from the flat upstream list', async () => {
  const client = createMobileClient({ domains: ['api.test'], retries: 0, fetch: upstream(() => ok({ total: '2', list: [
    { CID: '10', AID: '123', UID: '1', username: 'u1', nickname: 'Nick', content: 'Hello', likes: '3', addtime: 'today', parent_CID: '0', spoiler: '0' },
    { CID: '11', AID: '123', UID: '2', username: 'u2', nickname: '', content: 'Reply', likes: '0', addtime: 'today', parent_CID: '10', spoiler: '1' },
  ] })) });
  try {
    const result = await client.comments({ albumId: '123', page: 1 });
    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map(item => [item.id, item.parentId, item.username, item.spoiler]), [['10', null, 'Nick', false], ['11', '10', 'u2', true]]);
  } finally { client.dispose(); }
});

test('favorites, history and daily responses are normalized', async () => {
  const client = createMobileClient({ domains: ['api.test'], retries: 0, account: { uid: '42', jwt: 'j', avs: 'a' }, fetch: upstream(entry => {
    if (entry.url.pathname === '/favorite') return ok({ total: '21', count: 20, folder_list: [{ FID: '5', name: 'Later', UID: '42' }], list: [{ id: '7', name: 'Fav', author: 'A', image: '', category: { id: '1', title: 'x' } }] });
    if (entry.url.pathname === '/watch_list') return ok({ total: 1, list: [{ id: '8', name: 'Seen', author: 'B' }] });
    return ok({ daily_id: '3', event_name: 'Event', currentProgress: '40%', three_days_coin: '5', record: [[{ date: '1', signed: true, bonus: false }, { date: '2', signed: false, bonus: true }]] });
  }) });
  try {
    const favorites = await client.favorites({ page: 1, folderId: '5', order: 'mp' });
    assert.deepEqual([favorites.total, favorites.folders, favorites.items.map(item => item.id)], [21, [{ id: '5', name: 'Later' }], ['7']]);
    await assert.rejects(client.favorites({ page: 1, order: 'drop' }), { code: 'INVALID_ARGUMENT' });
    assert.deepEqual((await client.history(1)).items.map(item => item.name), ['Seen']);
    const daily = await client.daily();
    assert.equal(daily.dailyId, '3');
    assert.deepEqual(daily.record, [[{ date: '1', signed: true, bonus: false }, { date: '2', signed: false, bonus: true }]]);
    assert.equal(daily.rewards.threeDaysCoin, 5);
  } finally { client.dispose(); }
});
