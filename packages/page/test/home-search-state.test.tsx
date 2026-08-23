import assert from 'node:assert/strict';
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, test, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../src/api', () => apiMocks);

import { useSearchState } from '../src/home/useSearchState';

function createWrapper(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

describe('useSearchState', () => {
  beforeEach(() => {
    apiMocks.search.mockReset();
  });

  test('keeps an empty URL idle and validates submit input', () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useSearchState(onNavigate), {
      wrapper: createWrapper('/'),
    });

    assert.equal(result.current.urlQuery, '');
    assert.equal(result.current.urlCategory, '0');
    assert.equal(result.current.urlOrderBy, 'mr');
    assert.equal(result.current.urlTime, 'a');
    assert.equal(result.current.urlPage, 1);
    assert.equal(result.current.totalCount, 0);
    assert.equal(result.current.totalPages, 0);
    assert.equal(result.current.hasNextPage, false);
    assert.equal(result.current.hasPrevPage, false);
    assert.equal(result.current.redirectAid, null);
    assert.equal(result.current.hasResults, undefined);
    assert.equal(apiMocks.search.mock.calls.length, 0);

    act(() => result.current.performSearch());
    assert.equal(onNavigate.mock.calls.length, 0);
    const preventDefault = vi.fn();
    act(() => result.current.handleSubmit({ preventDefault } as unknown as React.FormEvent));
    assert.equal(preventDefault.mock.calls.length, 1);
    assert.equal(result.current.queryError, '请填写搜索内容');

    act(() => result.current.handleQueryChange({ target: { value: 'new' } } as React.ChangeEvent<HTMLInputElement>));
    assert.equal(result.current.query, 'new');
    assert.equal(result.current.queryError, null);
  });

  test('loads results, resets list position, and warms the next page with previous IDs', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    apiMocks.search
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        search_query: 'cats',
        total: '200',
        content: [{ id: '3', author: 'c', name: 'third' }],
      });
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useSearchState(onNavigate), {
      wrapper: createWrapper('/?q=cats&cat=2&order=mv&time=w&page=1'),
    });
    const scrollTo = vi.fn();
    Object.defineProperty(result.current.listRef, 'current', {
      configurable: true,
      value: { scrollTo },
      writable: true,
    });

    await act(async () => {
      resolveFirst({
        search_query: 'cats',
        total: '200',
        content: [
          { id: '1', author: 'a', name: 'first' },
          { id: '2', author: 'b', name: 'second' },
        ],
      });
      await first;
    });
    await waitFor(() => assert.equal(result.current.data?.total, '200'));
    assert.equal(result.current.totalPages, 3);
    assert.equal(result.current.hasNextPage, true);
    assert.equal(result.current.hasPrevPage, false);
    assert.equal(result.current.hasResults, true);
    assert.deepEqual(scrollTo.mock.calls[0], [{ top: 0, behavior: 'auto' }]);

    act(() => result.current.handlePageChange(2));
    await waitFor(() => assert.equal(apiMocks.search.mock.calls.length, 2));
    assert.equal(onNavigate.mock.calls.length, 1);
    assert.equal(result.current.urlPage, 2);
    assert.deepEqual(apiMocks.search.mock.calls[1][1].previousIds, ['1', '2']);
    assert.ok(apiMocks.search.mock.calls[1][2] instanceof AbortSignal);
    await waitFor(() => assert.equal(result.current.data?.content[0]?.id, '3'));
    assert.equal(result.current.hasPrevPage, true);
  });

  test('submits local filters and recognizes a direct album redirect', async () => {
    apiMocks.search.mockResolvedValue({
      search_query: 'direct',
      total: '1',
      redirect_aid: '99',
      content: [],
    });
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useSearchState(onNavigate), {
      wrapper: createWrapper('/?q=direct&cat=4&order=tf&time=m&page=bad'),
    });

    await waitFor(() => assert.equal(result.current.redirectAid, '99'));
    assert.equal(result.current.urlPage, 1);
    assert.equal(result.current.hasResults, false);
    act(() => {
      result.current.setQuery('other');
      result.current.setCategory('3');
      result.current.setOrderBy('mp');
      result.current.setTimeFilter('t');
    });
    act(() => result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent));
    await waitFor(() => assert.equal(result.current.urlQuery, 'other'));
    assert.equal(result.current.urlCategory, '3');
    assert.equal(result.current.urlOrderBy, 'mp');
    assert.equal(result.current.urlTime, 't');
    assert.equal(onNavigate.mock.calls.length, 1);
  });

  test('exposes search failure and allows refetch', async () => {
    apiMocks.search.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSearchState(vi.fn()), {
      wrapper: createWrapper('/?q=broken&page=1'),
    });

    await waitFor(() => assert.equal(result.current.isSearchError, true), { timeout: 3000 });
    assert.equal(result.current.data, undefined);
    await act(async () => { await result.current.refetchSearch(); });
    assert.ok(apiMocks.search.mock.calls.length >= 2);
  });
});
