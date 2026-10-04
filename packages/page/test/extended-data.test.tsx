import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';

vi.mock('../src/backend-url', () => ({ getBackendUrl: () => 'https://backend.test' }));

import {
  DEFAULT_EXTENDED_PREFERENCES, EXTENDED_MODE_STORAGE_KEY, loadExtendedPreferences, parseExtendedPreferences,
  saveExtendedPreferences, useExtendedPreferences,
} from '../src/extended/preferences';
import { ACCOUNT_STORAGE_KEY, clearAccount, dismissAccountNotice, loadAccount, saveAccount, useAccount } from '../src/extended/session';
import { accountApi, describeError, MobileApiError, mobileApi } from '../src/extended/api';
import { htmlToText, todayIndex } from '../src/extended/text';

const member = { uid: '42', username: 'reader', email: 'r@example.test', level: 'Lv1', coin: 3 };
const account = (expiresAt = Date.now() + 60_000) => ({ session: 'v1.token', expiresAt, member });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearAccount();
});
afterEach(() => vi.unstubAllGlobals());

describe('extended mode preferences', () => {
  test('default off and tolerate missing, corrupt or unknown versions', () => {
    assert.deepEqual(parseExtendedPreferences(null), DEFAULT_EXTENDED_PREFERENCES);
    assert.deepEqual(parseExtendedPreferences('{'), DEFAULT_EXTENDED_PREFERENCES);
    assert.deepEqual(parseExtendedPreferences('{"version":2,"enabled":true}'), DEFAULT_EXTENDED_PREFERENCES);
    assert.deepEqual(parseExtendedPreferences('{"version":1,"enabled":true,"acknowledged":"yes"}'), { version: 1, enabled: true, acknowledged: false });
    assert.equal(loadExtendedPreferences().enabled, false);
  });

  test('persist, notify hooks and follow other tabs', () => {
    const { result } = renderHook(() => useExtendedPreferences());
    assert.equal(result.current.preferences.enabled, false);
    act(() => result.current.setEnabled(true));
    assert.deepEqual(result.current.preferences, { version: 1, enabled: true, acknowledged: true });
    assert.equal(JSON.parse(localStorage.getItem(EXTENDED_MODE_STORAGE_KEY)!).enabled, true);
    act(() => result.current.setEnabled(false));
    assert.deepEqual(result.current.preferences, { version: 1, enabled: false, acknowledged: true });

    act(() => {
      localStorage.setItem(EXTENDED_MODE_STORAGE_KEY, JSON.stringify({ version: 1, enabled: true, acknowledged: true }));
      window.dispatchEvent(new StorageEvent('storage', { key: EXTENDED_MODE_STORAGE_KEY }));
    });
    assert.equal(result.current.preferences.enabled, true);
  });

  test('still apply to this page when storage throws', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    saveExtendedPreferences({ version: 1, enabled: true, acknowledged: true });
    assert.equal(localStorage.getItem(EXTENDED_MODE_STORAGE_KEY), null);
    assert.equal(loadExtendedPreferences().enabled, true);
    setItem.mockRestore();
    saveExtendedPreferences(DEFAULT_EXTENDED_PREFERENCES);
    assert.equal(loadExtendedPreferences().enabled, false);
  });
});

describe('account session', () => {
  test('lives in sessionStorage and is dropped when expired', () => {
    const { result } = renderHook(() => useAccount());
    assert.equal(result.current.account, null);
    act(() => saveAccount(account()));
    assert.equal(result.current.account?.member.uid, '42');
    assert.ok(sessionStorage.getItem(ACCOUNT_STORAGE_KEY));
    assert.equal(localStorage.getItem(ACCOUNT_STORAGE_KEY), null);

    act(() => saveAccount(account(Date.now() - 1)));
    act(() => { assert.equal(loadAccount(), null); });
    assert.equal(result.current.account, null);
    assert.equal(result.current.notice, 'expired');
    act(() => dismissAccountNotice());
    assert.equal(result.current.notice, null);
  });

  test('expires on a timer and ignores malformed storage', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useAccount());
      act(() => saveAccount(account(Date.now() + 1000)));
      act(() => { vi.advanceTimersByTime(1001); });
      assert.equal(result.current.account, null);
      assert.equal(result.current.notice, 'expired');
    } finally { vi.useRealTimers(); }
    sessionStorage.setItem(ACCOUNT_STORAGE_KEY, '{"session":1}');
    assert.equal(loadAccount(), null);
    sessionStorage.setItem(ACCOUNT_STORAGE_KEY, 'not json');
    assert.equal(loadAccount(), null);
  });
});

describe('mobile API client', () => {
  test('builds discovery requests without credentials', async () => {
    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchMock);
    await mobileApi.categoryFilter('doujin', 'mv_m', 2);
    await mobileApi.promoteList('26', 0);
    await mobileApi.serialization(3, 1);
    await mobileApi.weekFilter('260', 'manga');
    await mobileApi.comments('123', 1);
    await Promise.all([mobileApi.config(), mobileApi.promote(), mobileApi.latest(0), mobileApi.categories(), mobileApi.week(), mobileApi.hotTags(), mobileApi.random()]);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    assert.equal(urls[0], 'https://backend.test/api/mobile/categories/filter?c=doujin&o=mv_m&page=2');
    assert.equal(urls[1], 'https://backend.test/api/mobile/promote-list?id=26&page=0');
    assert.ok(urls.includes('https://backend.test/api/mobile/latest?page=0'));
    for (const [, init] of fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>) {
      assert.equal(new Headers(init.headers).get('Authorization'), null);
    }
  });

  test('sends the sealed session on account calls and refuses without one', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true, message: '' }));
    vi.stubGlobal('fetch', fetchMock);
    await assert.rejects(accountApi.toggleFavorite('1'), (error: MobileApiError) => error.code === 'LOGIN_REQUIRED');
    assert.equal(fetchMock.mock.calls.length, 0);

    saveAccount(account());
    await accountApi.toggleFavorite('123');
    await accountApi.editFolder({ type: 'move', folderId: '5', aid: '123' });
    await accountApi.comment('123', 'hi', '9');
    await accountApi.favorites(2, '5', 'mp');
    await Promise.all([accountApi.like('1'), accountApi.deleteComment('9', '1'), accountApi.dailyCheck('7'), accountApi.deleteHistory('1'),
      accountApi.updateProfile({ city: 'x' }), accountApi.logout(), accountApi.profile(), accountApi.daily(), accountApi.history(1)]);
    const calls = fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>;
    const [url, init] = calls[0]!;
    assert.equal(String(url), 'https://backend.test/api/mobile/account/favorite');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer v1.token');
    assert.equal(init.body, JSON.stringify({ aid: '123' }));
    assert.equal(calls[2]![1].body, JSON.stringify({ aid: '123', content: 'hi', replyTo: '9' }));
    assert.equal(String(calls[3]![0]), 'https://backend.test/api/mobile/account/favorites?page=2&folder=5&order=mp');
    assert.ok(calls.every(([, request]) => new Headers(request.headers).get('Authorization') === 'Bearer v1.token'));
  });

  test('login, register and forgot are public; session errors log the user out', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ session: 's', expiresAt: 1, member }))
      .mockResolvedValueOnce(json({ ok: true, message: 'ok' }))
      .mockResolvedValueOnce(json({ ok: true, message: 'sent' }))
      .mockResolvedValueOnce(json({ error: { code: 'SESSION_EXPIRED', message: 'Session expired' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await accountApi.login('u', 'p');
    await accountApi.register({ username: 'u', password: 'p', passwordConfirm: 'p', email: 'e', gender: 'Male' });
    await accountApi.forgot('e');
    for (const [, init] of fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>) assert.equal(new Headers(init.headers).get('Authorization'), null);

    saveAccount(account());
    await assert.rejects(accountApi.daily(), (error: MobileApiError) => error.code === 'SESSION_EXPIRED' && error.status === 401);
    assert.equal(loadAccount(), null);
  });

  test('keeps the HTTP status when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' })));
    await assert.rejects(mobileApi.promote(), (error: MobileApiError) => error.code === 'HTTP_ERROR' && error.message === '502 Bad Gateway');
  });

  test('describes errors for people', () => {
    const error = (code: string, message = 'm') => new MobileApiError(code, 400, message);
    assert.equal(describeError(error('SESSION_EXPIRED')), '登录已过期，请重新登录');
    assert.equal(describeError(error('LOGIN_REQUIRED')), '请先登录');
    assert.equal(describeError(error('ACCOUNT_DISABLED')), '此部署未启用账号功能');
    assert.equal(describeError(error('WRITE_UNCERTAIN')), '操作结果未知，请刷新确认后再试');
    assert.equal(describeError(error('UPSTREAM_REJECTED', 'Upstream rejected the request: 密碼錯誤')), '密碼錯誤');
    assert.equal(describeError(error('UPSTREAM_REJECTED', 'plain')), 'plain');
    assert.equal(describeError(error('TIMEOUT')), '请求超时，请稍后重试');
    assert.equal(describeError(error('INVALID_ARGUMENT')), '输入内容无效');
    assert.equal(describeError(error('UPSTREAM', 'down')), '请求失败：down');
    assert.equal(describeError(new Error('boom')), '请求失败：boom');
    assert.equal(describeError('x'), '请求失败');
  });
});

describe('helpers', () => {
  test('show comment HTML as text only', () => {
    assert.equal(htmlToText('<div style="x">Hello <b>world</b><script>alert(1)</script></div>'), 'Hello worldalert(1)');
    assert.equal(htmlToText('<img src=x onerror=alert(1)>'), '');
  });

  test('number serialization days from Monday', () => {
    assert.equal(todayIndex(new Date('2026-10-05T12:00:00')), 1);
    assert.equal(todayIndex(new Date('2026-10-04T12:00:00')), 7);
    assert.equal(todayIndex(), todayIndex(new Date()));
  });
});
