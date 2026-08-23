import assert from 'node:assert/strict';
import type { ChangeEventHandler, FormEventHandler, ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  downloads: {} as Record<string, unknown>,
  albumCache: new Map<string, unknown>(),
  modalProps: null as null | Record<string, unknown>,
  taskProps: null as null | Record<string, unknown>,
}));

vi.mock('@heroui/react', () => {
  const Button = ({ children, onPress, isDisabled, ...props }: { children: ReactNode; onPress?: () => void; isDisabled?: boolean }) => (
    <button type={(props as { type?: 'button' | 'submit' }).type ?? 'button'} disabled={isDisabled} onClick={onPress} {...props}>{children}</button>
  );
  const InputGroup = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  InputGroup.Prefix = ({ children }: { children: ReactNode }) => <>{children}</>;
  InputGroup.Input = (props: { name?: string; value?: string; onChange?: ChangeEventHandler<HTMLInputElement>; placeholder?: string }) => <input {...props} />;
  const options: Record<string, Array<[string, string]>> = {
    '搜索类别': [['0', '全部'], ['1', '作品名称'], ['2', '作者'], ['3', '标签'], ['4', '角色']],
    '排序方式': [['mr', '最新发布'], ['mv', '最多浏览'], ['mp', '最多图片'], ['tf', '最多喜欢']],
    '时间范围': [['a', '全部时间'], ['t', '今天'], ['w', '本周'], ['m', '本月']],
  };
  const Select = ({ 'aria-label': label, value, onChange }: { 'aria-label': string; value: string; onChange: (value: string | null) => void }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {(options[label] ?? []).map(([id, text]) => <option key={id} value={id}>{text}</option>)}
    </select>
  );
  Select.Trigger = ({ children }: { children: ReactNode }) => <>{children}</>;
  Select.Value = () => null;
  Select.Indicator = () => null;
  Select.Popover = ({ children }: { children: ReactNode }) => <>{children}</>;
  const ListBox = ({ children }: { children: ReactNode }) => <>{children}</>;
  ListBox.Item = () => null;
  return { Button, InputGroup, Select, ListBox };
});

vi.mock('../src/home/useSearchState', () => ({ useSearchState: () => state.search }));
vi.mock('../src/home/useDownloads', () => ({ useDownloads: () => state.downloads }));
vi.mock('../src/home/useAlbumBatch', () => ({ useAlbumBatch: () => ({ albumCache: state.albumCache, getCardRef: () => vi.fn() }) }));
vi.mock('../src/home/TaskPanel', () => ({ TaskPanel: (props: Record<string, unknown>) => { state.taskProps = props; return <div data-testid="task-panel" />; } }));
vi.mock('../src/home/AlbumModal', () => ({ AlbumModal: (props: Record<string, unknown>) => { state.modalProps = props; return <div data-testid="album-modal">{String(props.albumId)}</div>; } }));
vi.mock('../src/home/AlbumCard', () => ({ AlbumCard: ({ item, onClick }: { item: { id: string; name: string }; onClick: () => void }) => <button type="button" onClick={onClick}>{item.name}</button> }));
vi.mock('../src/home/CoverImage', () => ({ CoverImage: ({ albumId }: { albumId: string }) => <img alt={`cover-${albumId}`} /> }));
vi.mock('../src/theme/ThemeControls', () => ({ ThemePopover: () => <div data-testid="theme-popover" /> }));

import Home from '../src/home';

function makeSearch(overrides: Record<string, unknown> = {}) {
  return {
    urlQuery: 'query', urlPage: 2,
    query: 'query', category: '0', setCategory: vi.fn(), orderBy: 'mr', setOrderBy: vi.fn(), timeFilter: 'a', setTimeFilter: vi.fn(),
    queryError: null,
    data: { search_query: 'query', total: '2', content: [{ id: '1', name: 'One', author: 'A' }, { id: '2', name: 'Two', author: 'B' }] },
    isSearchError: false, searchPending: false, refetchSearch: vi.fn(), fallbackSearch: null,
    totalCount: 2, totalPages: 3, hasNextPage: true, hasPrevPage: true,
    redirectAid: undefined, hasResults: true,
    pushSearch: vi.fn(), handleQueryChange: vi.fn(),
    handleSubmit: vi.fn(((event: SubmitEvent) => event.preventDefault()) as unknown as FormEventHandler),
    handlePageChange: vi.fn(), listRef: { current: null },
    ...overrides,
  };
}

describe('Home page', () => {
  beforeEach(() => {
    state.search = makeSearch();
    state.downloads = {
      showTaskPanel: false,
      setShowTaskPanel: vi.fn(),
      taskContextValue: { tasks: [], addTask: vi.fn(), updateTask: vi.fn(), removeTask: vi.fn(), clearCompleted: vi.fn() },
      clearCompleted: vi.fn(),
    };
    state.albumCache = new Map();
    state.modalProps = null;
    state.taskProps = null;
  });

  test('runs search controls, pagination, opens and closes an album', () => {
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText('搜索内容...'), { target: { value: 'next' } });
    assert.equal((state.search.handleQueryChange as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    fireEvent.submit(screen.getByPlaceholderText('搜索内容...').closest('form')!);
    assert.equal((state.search.handleSubmit as ReturnType<typeof vi.fn>).mock.calls.length, 1);

    fireEvent.change(screen.getByLabelText('搜索类别'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'mv' } });
    fireEvent.change(screen.getByLabelText('时间范围'), { target: { value: 'w' } });
    assert.deepEqual((state.search.pushSearch as ReturnType<typeof vi.fn>).mock.calls, [
      ['query', '2', 'mr', 'a', 1],
      ['query', '0', 'mv', 'a', 1],
      ['query', '0', 'mr', 'w', 1],
    ]);

    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    fireEvent.click(screen.getByRole('button', { name: '上页' }));
    fireEvent.click(screen.getByRole('button', { name: '下页' }));
    fireEvent.click(screen.getByRole('button', { name: '尾页' }));
    assert.deepEqual((state.search.handlePageChange as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]), [1, 1, 3, 3]);
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    assert.ok(screen.getByTestId('album-modal'));
    assert.equal(state.modalProps?.albumId, '1');
    (state.modalProps?.onClose as () => void)();
  });

  test('renders validation, loading, background progress, empty and error states', () => {
    state.search = makeSearch({
      queryError: '请输入搜索内容', isSearchError: true, searchPending: true,
      fallbackSearch: { content: [] }, hasResults: false,
    });
    const view = render(<Home />);
    assert.ok(screen.getByRole('alert'));
    assert.ok(screen.getByText('仍显示上一次成功加载的结果。'));
    assert.ok(screen.getByRole('progressbar', { name: '正在更新搜索结果' }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    assert.equal((state.search.refetchSearch as ReturnType<typeof vi.fn>).mock.calls.length, 1);

    state.search = makeSearch({ data: undefined, searchPending: true, hasResults: false, totalCount: 0 });
    view.rerender(<Home />);
    assert.ok(screen.getByText('正在搜索...'));
    assert.equal(screen.getByRole('button', { name: '正在搜索' }).getAttribute('aria-busy'), 'true');

    state.search = makeSearch({ data: { content: [] }, hasResults: false, totalCount: 0, urlPage: 1, isSearchError: true, fallbackSearch: null });
    view.rerender(<Home />);
    assert.ok(screen.getByText('没有找到相关结果'));
    assert.ok(screen.getByText('请检查网络或稍后重试。'));
  });

  test('renders a direct result with cached cover and task-panel close behavior', () => {
    const cached = { album: { name: 'Direct album' }, photo: { scrambleId: 0, images: [{ url: 'cover' }] } };
    state.albumCache.set('99', cached);
    state.search = makeSearch({ redirectAid: '99', hasResults: false, data: { content: [] }, totalCount: 0 });
    state.downloads = { ...state.downloads, showTaskPanel: true };
    render(<Home />);
    assert.ok(screen.getByText('Direct album'));
    assert.ok(screen.getByAltText('cover-99'));
    assert.ok(screen.getByTestId('task-panel'));
    fireEvent.click(screen.getByText('点击查看详情'));
    assert.equal(state.modalProps?.albumId, '99');
    (state.taskProps?.onClose as () => void)();
    assert.equal((state.downloads.setShowTaskPanel as ReturnType<typeof vi.fn>).mock.calls[0][0], false);
    assert.equal((state.downloads.clearCompleted as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  });
});
