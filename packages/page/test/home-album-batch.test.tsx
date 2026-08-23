import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ getBatchAlbum: vi.fn() }));
const cacheMocks = vi.hoisted(() => ({ getCachedAlbums: vi.fn(), setCachedAlbums: vi.fn() }));
vi.mock('../src/api', () => apiMocks);
vi.mock('../src/album-cache', () => cacheMocks);

import { useAlbumBatch } from '../src/home/useAlbumBatch';

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const observers: ObserverRecord[] = [];

function result(ids: string[], redirectAid?: string) {
  return {
    search_query: 'query',
    total: String(ids.length),
    content: ids.map((id) => ({ id, author: 'author', name: `album-${id}` })),
    ...(redirectAid ? { redirect_aid: redirectAid } : {}),
  } as never;
}

function success(albumId: string) {
  return {
    albumId,
    album: { id: albumId, name: `album-${albumId}` },
    photo: null,
  } as never;
}

describe('useAlbumBatch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    observers.length = 0;
    class TestIntersectionObserver {
      callback: IntersectionObserverCallback;
      observe = vi.fn();
      disconnect = vi.fn();

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    apiMocks.getBatchAlbum.mockReset();
    cacheMocks.getCachedAlbums.mockReset();
    cacheMocks.setCachedAlbums.mockReset();
    cacheMocks.getCachedAlbums.mockResolvedValue(new Map());
    cacheMocks.setCachedAlbums.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('stays idle without a result key and handles card registration', async () => {
    const { result: hook, rerender } = renderHook(({ data }) => useAlbumBatch(data), {
      initialProps: { data: undefined as never },
    });
    const card = document.createElement('div');
    act(() => hook.current.getCardRef('1')(card));
    act(() => hook.current.getCardRef('1')(null));
    rerender({ data: result([]) });
    await vi.advanceTimersByTimeAsync(100);
    assert.equal(observers.length, 0);
    assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 0);
  });

  test('loads L2 cache first, prioritizes visible cards, and chunks remaining IDs', async () => {
    const ids = Array.from({ length: 31 }, (_, index) => String(index + 1));
    cacheMocks.getCachedAlbums.mockResolvedValue(new Map([
      ['2', { album: { id: '2', name: 'cached' }, photo: undefined }],
    ]));
    apiMocks.getBatchAlbum.mockImplementation(async (batch: string[]) => batch.map(success));
    cacheMocks.setCachedAlbums.mockRejectedValue(new Error('quota'));
    const { result: hook, unmount } = renderHook(() => useAlbumBatch(result(ids, '99')));

    const visibleCard = document.createElement('div');
    visibleCard.dataset.albumId = '31';
    const hiddenCard = document.createElement('div');
    hiddenCard.dataset.albumId = '1';
    const noIdCard = document.createElement('div');
    act(() => {
      hook.current.getCardRef('31')(visibleCard);
      hook.current.getCardRef('1')(hiddenCard);
      hook.current.getCardRef('none')(noIdCard);
    });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(observers.length, 1);
    observers[0].callback([
      { target: noIdCard, isIntersecting: true },
      { target: visibleCard, isIntersecting: true },
      { target: hiddenCard, isIntersecting: false },
    ] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.size, 32));

    assert.deepEqual(cacheMocks.getCachedAlbums.mock.calls[0][0], [...ids, '99']);
    assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 3);
    assert.equal(apiMocks.getBatchAlbum.mock.calls[0][0][0], '31');
    assert.equal(apiMocks.getBatchAlbum.mock.calls[0][0].length, 15);
    assert.equal(apiMocks.getBatchAlbum.mock.calls[1][0].length, 15);
    assert.equal(apiMocks.getBatchAlbum.mock.calls[2][0].length, 1);
    assert.ok(apiMocks.getBatchAlbum.mock.calls[0][1] instanceof AbortSignal);
    assert.equal(hook.current.albumCache.get('2')?.album?.name, 'cached');
    assert.ok(cacheMocks.setCachedAlbums.mock.calls.length > 0);

    unmount();
    assert.equal(observers[0].disconnect.mock.calls.length, 1);
  });

  test('requeues item-level errors and recovers on the next attempt', async () => {
    apiMocks.getBatchAlbum
      .mockResolvedValueOnce([{
        albumId: '1',
        album: null,
        photo: null,
        error: { message: 'busy', stage: 'get_album', domain: null, reference: null, retryable: true },
      }])
      .mockResolvedValueOnce([success('1')]);
    const { result: hook } = renderHook(() => useAlbumBatch(result(['1'])));

    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 1));
    assert.ok(hook.current.albumCache.get('1')?.error);
    await vi.advanceTimersByTimeAsync(1500);
    await waitFor(() => assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 2));
    await waitFor(() => assert.equal(hook.current.albumCache.get('1')?.album?.id, '1'));
  });

  test('refetches an errored in-memory item when the result key changes', async () => {
    apiMocks.getBatchAlbum
      .mockResolvedValueOnce([{
        albumId: '1',
        album: null,
        photo: null,
        error: { message: 'busy', stage: 'get_album', domain: null, reference: null, retryable: true },
      }])
      .mockResolvedValueOnce([success('1'), success('2')]);
    const { result: hook, rerender } = renderHook(({ data }) => useAlbumBatch(data), {
      initialProps: { data: result(['1']) },
    });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.ok(hook.current.albumCache.get('1')?.error));

    rerender({ data: result(['1', '2']) });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.get('1')?.album?.id, '1'));
  });

  test('retries a whole chunk after a network failure', async () => {
    apiMocks.getBatchAlbum
      .mockRejectedValueOnce(new Error('gateway'))
      .mockResolvedValueOnce([success('7')]);
    const { result: hook } = renderHook(() => useAlbumBatch(result(['7'])));

    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 1));
    await vi.advanceTimersByTimeAsync(1500);
    await waitFor(() => assert.equal(hook.current.albumCache.get('7')?.album?.id, '7'));
  });

  test('uses a complete L2 hit without a network call', async () => {
    cacheMocks.getCachedAlbums.mockResolvedValue(new Map([
      ['8', { album: { id: '8', name: 'cached' }, photo: null }],
    ]));
    const { result: hook } = renderHook(() => useAlbumBatch(result(['8'])));
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.get('8')?.album?.id, '8'));
    assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 0);
  });

  test('uses a complete in-memory hit when a duplicate result changes the key', async () => {
    apiMocks.getBatchAlbum.mockResolvedValue([success('8')]);
    const { result: hook, rerender } = renderHook(({ data }) => useAlbumBatch(data), {
      initialProps: { data: result(['8']) },
    });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.get('8')?.album?.id, '8'));
    assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 1);

    rerender({ data: result(['8', '8']) });
    await vi.advanceTimersByTimeAsync(50);
    assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 1);
  });

  test('evicts albums outside the new result set', async () => {
    apiMocks.getBatchAlbum.mockImplementation(async (batch: string[]) => batch.map(success));
    const { result: hook, rerender } = renderHook(({ data }) => useAlbumBatch(data), {
      initialProps: { data: result(['1', '2']) },
    });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.size, 2));

    rerender({ data: result(['2']) });
    await waitFor(() => assert.equal(hook.current.albumCache.has('1'), false));
    assert.equal(hook.current.albumCache.has('2'), true);
  });

  test('aborts an in-flight chunk on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    apiMocks.getBatchAlbum.mockImplementation((_ids: string[], signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const { unmount } = renderHook(() => useAlbumBatch(result(['9'])));
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.ok(capturedSignal));
    unmount();
    assert.equal(capturedSignal?.aborted, true);
    await vi.runAllTimersAsync();
  });

  test('ignores a successful batch that arrives after unmount', async () => {
    let resolveBatch!: (items: never[]) => void;
    apiMocks.getBatchAlbum.mockReturnValue(new Promise((resolve) => { resolveBatch = resolve; }));
    const { unmount } = renderHook(() => useAlbumBatch(result(['11'])));
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 1));
    unmount();
    resolveBatch([success('11')]);
    await vi.runAllTimersAsync();
    assert.equal(cacheMocks.setCachedAlbums.mock.calls.length, 0);
  });

  test('cancels before the visibility grace period expires', async () => {
    const { unmount } = renderHook(() => useAlbumBatch(result(['10'])));
    unmount();
    await vi.advanceTimersByTimeAsync(100);
    assert.equal(cacheMocks.getCachedAlbums.mock.calls.length, 0);
    assert.equal(apiMocks.getBatchAlbum.mock.calls.length, 0);
  });
});
