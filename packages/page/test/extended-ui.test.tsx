import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';

// Assertions below compare booleans, never DOM nodes: a failing node:assert would run
// util.inspect over the whole jsdom graph, which exhausts memory inside waitFor retries.

vi.mock('../src/backend-url', () => ({ getBackendUrl: () => 'https://backend.test' }));
vi.mock('../src/home/useAlbumBatch', () => ({ useAlbumBatch: () => ({ albumCache: new Map(), getCardRef: () => () => {} }) }));
vi.mock('../src/home/AlbumCard', () => ({
  AlbumCard: ({ item, onClick }: { item: { id: string; name: string }; onClick: () => void }) => <button type="button" data-album-id={item.id} onClick={onClick}>{item.name}</button>,
}));
vi.mock('../src/theme/ThemeControls', () => ({ ThemePopover: () => <div data-testid="theme-popover" /> }));
vi.mock('../src/home', async () => {
  const { useSearchParams } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  function SearchPageStub({ embedded, renderAlbumExtras, idleContent }: { embedded?: boolean; renderAlbumExtras?: (id: string) => ReactNode; idleContent?: ReactNode }) {
    const query = useSearchParams()[0].get('q');
    return (
      <div data-testid="search-page" data-embedded={String(embedded)}>
        {renderAlbumExtras?.('77')}
        {idleContent && !query && <div data-testid="idle-content">{idleContent}</div>}
      </div>
    );
  }
  return { default: SearchPageStub };
});
vi.mock('../src/home/AlbumModal', () => ({
  AlbumModal: ({ albumId, onClose, extras }: { albumId: string; onClose: () => void; extras?: ReactNode }) => (
    <div role="dialog" aria-label={`album-${albumId}`}><button type="button" onClick={onClose}>close album</button>{extras}</div>
  ),
}));
vi.mock('../src/home/TaskPanel', () => ({ TaskPanel: ({ onClose }: { onClose: () => void }) => <button type="button" onClick={onClose}>task panel</button> }));

import ExtendedApp from '../src/extended';
import { Root } from '../src/root';
import { saveAccount, loadAccount, clearAccount } from '../src/extended/session';
import { saveExtendedPreferences, DEFAULT_EXTENDED_PREFERENCES } from '../src/extended/preferences';
import { ExtendedModeToggle } from '../src/extended/ExtendedModeToggle';

type Call = { path: string; method: string; query: URLSearchParams; body: Record<string, unknown>; auth: string | null };
const member = { uid: '42', username: 'reader', email: 'r@example.test', level: 'Lv1', coin: 3 };
const comic = (id: string, name = `Comic ${id}`) => ({ id, name, author: 'A', image: '', category: null, liked: null, favorite: null, updatedAt: null });
let calls: Call[] = [];
let overrides: Record<string, (call: Call) => unknown> = {};

function defaults(call: Call): unknown {
  switch (call.path) {
    case '/config': return { accountEnabled: true };
    case '/promote': return [
      { id: '26', title: '热门推荐', type: 'promote', filterValue: '26', items: [comic('1', 'Promoted')] },
      { id: '1001', title: 'Library', type: 'library', filterValue: '', items: [comic('9')] },
    ];
    case '/latest': return call.query.get('page') === '0' ? [comic('2', 'Latest one')] : [];
    case '/promote-list': return { total: 40, items: [comic('3', 'Section item')] };
    case '/categories': return { categories: [{ id: '0', name: '最新A漫', slug: '', total: 0 }, { id: '1', name: '同人', slug: 'doujin', total: 9 }], blocks: [] };
    case '/categories/filter': return { total: 100, items: [comic(`c-${call.query.get('c')}-${call.query.get('o') ?? ''}-${call.query.get('page')}`)] };
    case '/serialization': return { total: 1, items: [comic(`s-${call.query.get('date')}`)] };
    case '/week': return { periods: [{ id: '260', title: '', time: '第259期' }, { id: '259', title: '', time: '第258期' }], types: [{ id: 'manga', title: '日漫' }, { id: 'hanman', title: '韩漫' }] };
    case '/week/filter': return { total: 1, items: [comic(`w-${call.query.get('id')}-${call.query.get('type')}`)] };
    case '/hot-tags': return ['黑肉', '无修正'];
    case '/random': return [comic(`r-${calls.filter((item) => item.path === '/random').length}`)];
    case '/comments': return { total: 2, items: [
      { id: '10', parentId: null, albumId: '77', userId: '42', username: 'reader', content: '<b>Mine</b>', likes: 0, createdAt: 'now', spoiler: false },
      { id: '11', parentId: '10', albumId: '77', userId: '5', username: 'other', content: 'Reply', likes: 0, createdAt: 'now', spoiler: true },
    ] };
    case '/account/login': return { session: 'v1.sealed', expiresAt: Date.now() + 3_600_000, remember: call.body.remember === true, member };
    case '/account/favorites': return { total: 1, folders: [{ id: '5', name: 'Later' }], items: [comic('f1', 'Favorite one')] };
    case '/account/daily': return { dailyId: '7', eventName: '十月签到', progress: '40%', record: [[{ date: '1', signed: true, bonus: false }, { date: '2', signed: false, bonus: true }]], rewards: { threeDaysCoin: 1, sevenDaysCoin: 2, threeDaysExp: 3, sevenDaysExp: 4 } };
    case '/account/profile': return { username: 'reader', email: 'r@example.test', city: 'Taipei' };
    case '/account/history': return { total: 1, items: [comic('h1', 'Seen one')] };
    case '/account/favorite': return { ok: true, message: '', type: 'add' };
    default: return { ok: true, message: '' };
  }
}

beforeEach(() => {
  calls = [];
  overrides = {};
  localStorage.clear();
  sessionStorage.clear();
  clearAccount();
  saveExtendedPreferences({ version: 1, enabled: true, acknowledged: true });
  vi.stubGlobal('fetch', vi.fn(async (input: URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: Call = {
      path: url.pathname.replace('/api/mobile', ''), method: init.method ?? 'GET', query: url.searchParams,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : {}, auth: new Headers(init.headers).get('Authorization'),
    };
    calls.push(call);
    const value = (overrides[call.path] ?? defaults)(call);
    return value instanceof Response ? value : new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  saveExtendedPreferences(DEFAULT_EXTENDED_PREFERENCES);
  vi.unstubAllGlobals();
});

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}
function renderApp(path = '/', element: ReactNode = <ExtendedApp />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {['/', '/discover', '/favorites', '/me', '/reader/:id'].map((route) => <Route key={route} path={route} element={element} />)}
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const signIn = () => saveAccount({ session: 'v1.sealed', expiresAt: Date.now() + 3_600_000, member });
const last = (path: string) => [...calls].reverse().find((call) => call.path === path)!;
/** HeroUI selects: the trigger carries the field label as aria-label; options open in a popover. */
const selectTrigger = (label: string) => screen.getAllByRole('button').find((button) => button.getAttribute('aria-label') === label)!;
async function choose(label: string, option: string) {
  await waitFor(() => assert.ok(selectTrigger(label)));
  fireEvent.click(selectTrigger(label));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
const location = () => screen.getByTestId('location').textContent;

describe('extended shell', () => {
  test('home keeps the original search page and lists comic sections and latest items under it', async () => {
    renderApp('/');
    const search = await screen.findByTestId('search-page');
    assert.equal(search.dataset.embedded, 'true');
    assert.ok(within(search).getByRole('button', { name: /收藏/ }));
    assert.ok(await within(screen.getByTestId('idle-content')).findByText('Promoted'));
    assert.ok(screen.getByText('热门推荐'));
    assert.ok(screen.queryByText('Library') === null);
    assert.ok(await screen.findByText('Latest one'));
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => assert.equal(last('/latest').query.get('page'), '1'));
    await waitFor(() => assert.ok(screen.queryByRole('button', { name: '加载更多' }) === null));

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    assert.equal(location(), '/discover?tab=section&id=26&title=%E7%83%AD%E9%97%A8%E6%8E%A8%E8%8D%90');
    fireEvent.click(screen.getByRole('link', { name: '首页' }));
    assert.ok(await screen.findByTestId('idle-content'));
  });

  test('opens album details with account actions and closes them', async () => {
    renderApp('/');
    fireEvent.click(await screen.findByText('Promoted'));
    const dialog = screen.getByRole('dialog', { name: 'album-1' });
    assert.ok(within(dialog).getByRole('button', { name: '查看评论' }));
    fireEvent.click(within(dialog).getByText('close album'));
    assert.ok(screen.queryByRole('dialog', { name: 'album-1' }) === null);
  });

  test('shows an error with retry when discovery fails', async () => {
    overrides['/promote'] = () => new Response(JSON.stringify({ error: { code: 'UPSTREAM', message: 'down' } }), { status: 502 });
    renderApp('/');
    assert.match((await screen.findAllByRole('alert'))[0]!.textContent!, /down/);
    overrides['/promote'] = defaults;
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[0]!);
    assert.ok(await screen.findByText('Promoted'));
  });

  test('requires login before favoriting, then resumes the action', async () => {
    renderApp('/?q=x');
    fireEvent.click(await screen.findByRole('button', { name: /收藏/ }));
    const dialog = await screen.findByRole('dialog', { name: '登录账号' });
    fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: 'reader' } });
    fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: 'secret' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /记住我/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: '登录' }));
    await waitFor(() => assert.ok(screen.queryByRole('dialog', { name: '登录账号' }) === null));
    assert.deepEqual(last('/account/login').body, { username: 'reader', password: 'secret', remember: true });
    await waitFor(() => assert.deepEqual(last('/account/favorite').body, { aid: '77' }));
    assert.equal(last('/account/favorite').auth, 'Bearer v1.sealed');
    assert.ok(await screen.findByText('已加入收藏'));
    assert.equal(loadAccount()?.member.uid, '42');
  });

  test('closing the login dialog drops the pending action', async () => {
    renderApp('/?q=x');
    fireEvent.click(await screen.findByRole('button', { name: '点赞' }));
    const dialog = await screen.findByRole('dialog', { name: '登录账号' });
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    assert.ok(screen.queryByRole('dialog', { name: '登录账号' }) === null);
    assert.equal(calls.some((call) => call.path === '/account/like'), false);
  });

  test('hides account actions when the deployment has no session key', async () => {
    overrides['/config'] = () => ({ accountEnabled: false });
    renderApp('/me');
    assert.ok(await screen.findByText(/此部署未启用账号功能/));
    fireEvent.click(screen.getByRole('link', { name: '首页' }));
    fireEvent.click(await screen.findByText('Promoted'));
    assert.ok(within(screen.getByRole('dialog', { name: 'album-1' })).queryByRole('button', { name: '点赞' }) === null);
  });
});

describe('album account actions', () => {
  test('like, move to a folder and report refusals and uncertain writes', async () => {
    signIn();
    renderApp('/?q=x');
    fireEvent.click(await screen.findByRole('button', { name: '点赞' }));
    assert.ok(await screen.findByText('已点赞'));

    await choose('目标收藏夹', 'Later');
    overrides['/account/favorite-folder'] = () => ({ ok: false, message: '已在此收藏夹' });
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    assert.ok(await screen.findByText('已在此收藏夹'));
    assert.deepEqual(last('/account/favorite-folder').body, { type: 'move', folderId: '5', aid: '77' });

    overrides['/account/favorite'] = () => new Response(JSON.stringify({ error: { code: 'WRITE_UNCERTAIN', message: 'unknown' } }), { status: 502 });
    fireEvent.click(screen.getByRole('button', { name: /收藏 \/ 取消收藏/ }));
    assert.ok(await screen.findByText('操作结果未知，请刷新确认后再试'));
    overrides['/account/favorite'] = () => ({ ok: true, message: '', type: 'del' });
    fireEvent.click(screen.getByRole('button', { name: /收藏 \/ 取消收藏/ }));
    assert.ok(await screen.findByText('已取消收藏'));
  });

  test('comments: plain text, threaded replies, posting, replying and deleting own comments', async () => {
    signIn();
    renderApp('/?q=x');
    fireEvent.click(await screen.findByRole('button', { name: '查看评论' }));
    assert.ok(await screen.findByText('Mine'));
    assert.ok(document.querySelector('b') === null);
    assert.ok(screen.getByText('Reply').className.includes('blur-sm'));
    assert.match(screen.getByText(/共 2 条/).textContent!, /共 2 条/);
    assert.equal(screen.getAllByRole('button', { name: '删除' }).length, 1);

    fireEvent.click(screen.getAllByRole('button', { name: '回复' })[0]!);
    assert.ok(screen.getByText('回复 reader'));
    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: ' hello ' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => assert.deepEqual(last('/account/comment').body, { aid: '77', content: 'hello', replyTo: '10' }));
    assert.ok(await screen.findByText('评论已提交，列表可能稍后更新'));
    assert.equal((screen.getByLabelText('评论内容') as HTMLInputElement).value, '');
    assert.ok(screen.queryByText('回复 reader') === null);

    fireEvent.click(screen.getAllByRole('button', { name: '回复' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '取消回复' }));
    assert.ok(screen.queryByText('回复 reader') === null);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => assert.deepEqual(last('/account/comment/delete').body, { commentId: '10', aid: '77' }));
    assert.ok(await screen.findByText('已删除，列表可能稍后更新'));
  });

  test('comment list states and paging', async () => {
    overrides['/comments'] = (call) => call.query.get('page') === '1'
      ? { total: 3, items: [{ id: '1', parentId: '99', albumId: '77', userId: '5', username: 'orphan', content: 'Orphan reply', likes: 0, createdAt: '', spoiler: false }] }
      : { total: 3, items: [] };
    renderApp('/?q=x');
    fireEvent.click(await screen.findByRole('button', { name: '查看评论' }));
    assert.ok(await screen.findByText('Orphan reply'));
    assert.equal((screen.getByLabelText('评论内容') as HTMLInputElement).placeholder, '登录后发表评论');
    fireEvent.click(screen.getByRole('button', { name: '下页' }));
    assert.ok(await screen.findByText('暂无评论'));

    fireEvent.click(screen.getByRole('button', { name: '上页' }));
    assert.ok(await screen.findByText('Orphan reply'));
  });

  test('comment load failures are shown', async () => {
    overrides['/comments'] = () => new Response('{}', { status: 500 });
    renderApp('/?q=x');
    fireEvent.click(await screen.findByRole('button', { name: '查看评论' }));
    assert.ok(await screen.findByText(/请求失败/));
  });
});

describe('discover', () => {
  test('categories and rankings keep their filters in the URL', async () => {
    renderApp('/discover');
    assert.ok(await screen.findByText('Comic c-0--1'));
    fireEvent.click(await screen.findByRole('tab', { name: '同人' }));
    assert.ok(await screen.findByText('Comic c-doujin--1'));
    await choose('排序', '月排行');
    assert.ok(await screen.findByText('Comic c-doujin-mv_m-1'));
    fireEvent.click(screen.getByRole('button', { name: '下页' }));
    assert.ok(await screen.findByText('Comic c-doujin-mv_m-2'));
    assert.match(location()!, /c=doujin/);
    fireEvent.click(screen.getByRole('tab', { name: '最新A漫' }));
    assert.ok(await screen.findByText('Comic c-0-mv_m-1'));
  });

  test('serialization by weekday, weekly picks, hot tags and random picks', async () => {
    renderApp('/discover');
    fireEvent.click(screen.getByRole('tab', { name: '连载' }));
    fireEvent.click(await screen.findByRole('tab', { name: '周三' }));
    assert.ok(await screen.findByText('Comic s-3'));

    fireEvent.click(screen.getByRole('tab', { name: '每周必看' }));
    assert.ok(await screen.findByText('Comic w-260-manga'));
    fireEvent.click(screen.getByRole('tab', { name: '韩漫' }));
    assert.ok(await screen.findByText('Comic w-260-hanman'));
    await choose('期数', '第258期');
    assert.ok(await screen.findByText('Comic w-259-hanman'));

    fireEvent.click(screen.getByRole('tab', { name: '热门标签' }));
    fireEvent.click(await screen.findByRole('button', { name: '黑肉' }));
    assert.equal(location(), '/?q=%E9%BB%91%E8%82%89&cat=3');
  });

  test('random picks refresh on demand', async () => {
    renderApp('/discover?tab=random');
    assert.ok(await screen.findByText('Comic r-1'));
    fireEvent.click(screen.getByRole('button', { name: '换一批' }));
    assert.ok(await screen.findByText('Comic r-2'));
  });

  test('promote sections page from zero upstream', async () => {
    renderApp('/discover?tab=section&id=26&title=Hot');
    assert.ok(await screen.findByText('Section item'));
    assert.ok(screen.getByText('Hot'));
    assert.equal(last('/promote-list').query.get('page'), '0');
    fireEvent.click(screen.getByRole('button', { name: '下页' }));
    await waitFor(() => assert.equal(last('/promote-list').query.get('page'), '1'));
    fireEvent.click(screen.getByRole('button', { name: '返回发现' }));
    assert.equal(location(), '/discover?tab=categories');
  });

  test('empty lists say so', async () => {
    overrides['/categories/filter'] = () => ({ total: 0, items: [] });
    renderApp('/discover');
    assert.ok(await screen.findByText('暂无内容'));
  });
});

describe('favorites', () => {
  test('asks to sign in, then manages folders and favorites', async () => {
    renderApp('/favorites');
    assert.ok(await screen.findByRole('form', { name: '登录' }));
    act(() => signIn());
    assert.ok(await screen.findByText('Favorite one'));
    assert.equal(last('/account/favorites').auth, 'Bearer v1.sealed');
    assert.ok(screen.getByText('第 1 页 · 共 1 本'));

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }));
    fireEvent.change(screen.getByLabelText('收藏夹名称'), { target: { value: 'Next' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => assert.deepEqual(last('/account/favorite-folder').body, { type: 'add', name: 'Next' }));
    assert.ok(await screen.findByText('已保存'));

    await choose('收藏夹', 'Later');
    await waitFor(() => assert.equal(last('/account/favorites').query.get('folder'), '5'));
    fireEvent.click(await screen.findByRole('button', { name: '重命名' }));
    assert.equal((screen.getByLabelText('收藏夹名称') as HTMLInputElement).value, 'Later');
    fireEvent.change(screen.getByLabelText('收藏夹名称'), { target: { value: 'Soon' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => assert.deepEqual(last('/account/favorite-folder').body, { type: 'edit', folderId: '5', name: 'Soon' }));

    fireEvent.click(await screen.findByRole('button', { name: '删除收藏夹' }));
    assert.ok(screen.getByText('删除收藏夹“Later”？'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '删除收藏夹' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => assert.deepEqual(last('/account/favorite-folder').body, { type: 'del', folderId: '5' }));
    await waitFor(() => assert.equal(selectTrigger('收藏夹').textContent, '全部收藏'));

    await choose('排序', '更新时间');
    await waitFor(() => assert.equal(last('/account/favorites').query.get('order'), 'mp'));
    fireEvent.click(await screen.findByRole('button', { name: '取消收藏' }));
    await waitFor(() => assert.deepEqual(last('/account/favorite').body, { aid: 'f1' }));
  });

  test('reports folder refusals and failures', async () => {
    signIn();
    overrides['/account/favorite-folder'] = () => ({ ok: false, message: '名称重复' });
    renderApp('/favorites');
    fireEvent.click(await screen.findByRole('button', { name: '新建收藏夹' }));
    fireEvent.change(screen.getByLabelText('收藏夹名称'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    assert.ok(await screen.findByText('名称重复'));
    assert.ok(screen.getByLabelText('收藏夹名称'));

    overrides['/account/favorite-folder'] = () => new Response('{}', { status: 500 });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    assert.ok(await screen.findByText(/请求失败/));
    overrides['/account/favorite'] = () => new Response(JSON.stringify({ error: { code: 'TIMEOUT', message: 't' } }), { status: 504 });
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }));
    assert.ok(await screen.findByText('请求超时，请稍后重试'));
  });

  test('an expired session asks the user to sign in again', async () => {
    signIn();
    overrides['/account/favorites'] = () => new Response(JSON.stringify({ error: { code: 'SESSION_EXPIRED', message: 'x' } }), { status: 401 });
    renderApp('/favorites');
    assert.ok(await screen.findByText(/登录已过期，请重新登录。/));
    assert.equal(loadAccount(), null);
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    assert.ok(screen.queryByText(/登录已过期，请重新登录。/) === null);
  });
});

describe('me', () => {
  test('daily sign-in, profile edits, cloud history and logout', async () => {
    signIn();
    renderApp('/me');
    assert.ok(await screen.findByText('十月签到'));
    assert.ok(screen.getByText('reader'));
    assert.ok(screen.getByText(/仅当前标签页 · 有效期至/));
    fireEvent.click(screen.getByRole('button', { name: '签到' }));
    await waitFor(() => assert.deepEqual(last('/account/daily/check').body, { dailyId: '7' }));
    assert.ok(await screen.findByText('签到成功'));

    fireEvent.click(screen.getByRole('button', { name: '编辑资料' }));
    const form = await screen.findByRole('form', { name: '编辑资料' });
    await waitFor(() => assert.equal((within(form).getByLabelText('城市') as HTMLInputElement).value, 'Taipei'));
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    assert.ok(await screen.findByText('没有修改'));
    fireEvent.change(within(form).getByLabelText('城市'), { target: { value: 'Tainan' } });
    fireEvent.change(within(form).getByLabelText('新密码（不修改请留空）'), { target: { value: 'new' } });
    fireEvent.change(within(form).getByLabelText('确认新密码'), { target: { value: 'other' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    assert.ok(await screen.findByText('两次输入的密码不一致'));
    fireEvent.change(within(form).getByLabelText('确认新密码'), { target: { value: 'new' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => assert.deepEqual(last('/account/profile/update').body, { fields: { city: 'Tainan', password: 'new', password_confirm: 'new' } }));
    assert.ok(await screen.findByText('资料已保存'));
    fireEvent.click(within(form).getByRole('button', { name: '收起' }));

    assert.ok(await screen.findByText('Seen one'));
    overrides['/account/history/delete'] = () => ({ ok: false, message: '删除失败' });
    fireEvent.click(screen.getByRole('button', { name: '删除记录' }));
    assert.ok(await screen.findByText('删除失败'));

    overrides['/account/logout'] = () => new Response('{}', { status: 502 });
    fireEvent.click(screen.getByRole('button', { name: /退出登录/ }));
    assert.ok(await screen.findByRole('form', { name: '登录' }));
    assert.equal(loadAccount(), null);
  });

  test('reports write failures on the me page', async () => {
    signIn();
    overrides['/account/daily/check'] = () => new Response(JSON.stringify({ error: { code: 'UPSTREAM_REJECTED', message: 'Upstream rejected the request: 今日已签到' } }), { status: 422 });
    overrides['/account/profile/update'] = () => new Response('{}', { status: 500 });
    overrides['/account/history/delete'] = () => new Response('{}', { status: 500 });
    overrides['/account/history'] = (call) => ({ total: 30, items: [comic(`h-${call.query.get('page')}`)] });
    renderApp('/me');
    fireEvent.click(await screen.findByRole('button', { name: '签到' }));
    assert.ok(await screen.findByText('今日已签到'));
    fireEvent.click(screen.getByRole('button', { name: '编辑资料' }));
    const form = await screen.findByRole('form', { name: '编辑资料' });
    await waitFor(() => assert.equal((within(form).getByLabelText('城市') as HTMLInputElement).value, 'Taipei'));
    fireEvent.change(within(form).getByLabelText('邮箱'), { target: { value: 'n@example.test' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    assert.ok(await within(form).findByText(/请求失败/));
    fireEvent.click(await screen.findByRole('button', { name: '删除记录' }));
    await waitFor(() => assert.ok(screen.getAllByText(/请求失败/).length >= 2));
    fireEvent.click(screen.getByRole('button', { name: '下页' }));
    assert.ok(await screen.findByText('Comic h-2'));
  });
});

describe('account forms', () => {
  test('register validates passwords and returns to login on success', async () => {
    renderApp('/me');
    fireEvent.click(await screen.findByRole('tab', { name: '注册' }));
    const form = screen.getByRole('form', { name: '注册' });
    fireEvent.change(within(form).getByLabelText('用户名'), { target: { value: 'new' } });
    fireEvent.change(within(form).getByLabelText('邮箱'), { target: { value: 'n@example.test' } });
    fireEvent.change(within(form).getByLabelText('密码'), { target: { value: 'a' } });
    fireEvent.change(within(form).getByLabelText('确认密码'), { target: { value: 'b' } });
    fireEvent.submit(form);
    assert.ok(await screen.findByText('两次输入的密码不一致'));
    fireEvent.change(within(form).getByLabelText('确认密码'), { target: { value: 'a' } });
    fireEvent.click(within(form).getByLabelText('女'));
    overrides['/account/register'] = () => ({ ok: false, message: '用户名已存在' });
    fireEvent.submit(form);
    assert.ok(await screen.findByText('用户名已存在'));
    overrides['/account/register'] = () => ({ ok: true, message: '' });
    fireEvent.submit(form);
    assert.ok(await screen.findByText('注册成功，请登录'));
    assert.ok(screen.getByRole('form', { name: '登录' }));
    assert.deepEqual(last('/account/register').body, { username: 'new', password: 'a', passwordConfirm: 'a', email: 'n@example.test', gender: 'Female' });
  });

  test('forgot password and wrong passwords', async () => {
    renderApp('/me');
    fireEvent.click(await screen.findByRole('tab', { name: '找回密码' }));
    const forgot = screen.getByRole('form', { name: '找回密码' });
    fireEvent.change(within(forgot).getByLabelText('注册邮箱'), { target: { value: 'r@example.test' } });
    fireEvent.submit(forgot);
    assert.ok(await screen.findByText('已发送重设密码邮件'));
    overrides['/account/forgot'] = () => ({ ok: false, message: '' });
    fireEvent.submit(forgot);
    assert.ok(await screen.findByText('提交失败'));

    fireEvent.click(screen.getByRole('tab', { name: '登录' }));
    overrides['/account/login'] = () => new Response(JSON.stringify({ error: { code: 'UPSTREAM_REJECTED', message: 'Upstream rejected the request: 帳號或密碼錯誤' } }), { status: 422 });
    const login = screen.getByRole('form', { name: '登录' });
    fireEvent.change(within(login).getByLabelText('用户名'), { target: { value: 'reader' } });
    fireEvent.change(within(login).getByLabelText('密码'), { target: { value: 'wrong' } });
    fireEvent.submit(login);
    assert.ok(await screen.findByText('帳號或密碼錯誤'));
    assert.equal(loadAccount(), null);
  });
});

describe('extended mode switch', () => {
  test('root shows the default search page when off and redirects extended routes', async () => {
    saveExtendedPreferences(DEFAULT_EXTENDED_PREFERENCES);
    renderApp('/favorites', <Root />);
    assert.ok(await screen.findByTestId('search-page'));
    assert.equal(location(), '/');
    assert.equal(calls.length, 0);
  });

  test('root loads the extended shell when on', async () => {
    renderApp('/discover', <Root />);
    assert.ok(await screen.findByRole('navigation', { name: '主导航' }));
  });

  test('first enable asks for confirmation; later toggles do not', () => {
    saveExtendedPreferences(DEFAULT_EXTENDED_PREFERENCES);
    render(<ExtendedModeToggle />);
    const toggle = screen.getByRole('switch', { name: '扩展模式' }) as HTMLInputElement;
    fireEvent.click(toggle);
    assert.ok(screen.getByRole('alertdialog', { name: '开启扩展模式' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    assert.equal(toggle.checked, false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '我已了解，开启' }));
    assert.equal(toggle.checked, true);
    fireEvent.click(toggle);
    assert.equal(toggle.checked, false);
    fireEvent.click(toggle);
    assert.ok(screen.queryByRole('alertdialog') === null);
    assert.equal(toggle.checked, true);
  });
});
