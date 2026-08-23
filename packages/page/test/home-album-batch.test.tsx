import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ getBatchAlbumWithMeta: vi.fn() }));
const cacheMocks = vi.hoisted(() => ({ getCachedAlbums: vi.fn(), setCachedAlbums: vi.fn() }));
vi.mock('../src/api', () => apiMocks);
vi.mock('../src/album-cache', () => cacheMocks);

import { useAlbumBatch } from '../src/home/useAlbumBatch';

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  options?: IntersectionObserverInit;
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

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback;
        observers.push({ ...this, options });
      }
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    apiMocks.getBatchAlbumWithMeta.mockReset();
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
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 0);
  });

  test('loads L2 cache first, prioritizes visible cards, and chunks remaining IDs', async () => {
    const ids = Array.from({ length: 31 }, (_, index) => String(index + 1));
    cacheMocks.getCachedAlbums.mockResolvedValue(new Map([
      ['2', { album: { id: '2', name: 'cached' }, photo: undefined }],
    ]));
    apiMocks.getBatchAlbumWithMeta.mockImplementation(async (batch: string[]) => ({ data: batch.map(success), cacheMeta: {} }));
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
    assert.equal(observers[0].options?.rootMargin, '1000px 0px');
    observers[0].callback([
      { target: noIdCard, isIntersecting: true },
      { target: visibleCard, isIntersecting: true },
      { target: hiddenCard, isIntersecting: false },
    ] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.size, 32));

    assert.deepEqual(cacheMocks.getCachedAlbums.mock.calls[0][0], [...ids, '99']);
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 3);
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls[0][0][0], '31');
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls[0][0].length, 15);
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls[1][0].length, 15);
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls[2][0].length, 1);
    assert.ok(apiMocks.getBatchAlbumWithMeta.mock.calls[0][1].signal instanceof AbortSignal);
    assert.equal(hook.current.albumCache.get('2')?.album?.name, 'cached');
    assert.ok(cacheMocks.setCachedAlbums.mock.calls.length > 0);

    unmount();
    assert.equal(observers[0].disconnect.mock.calls.length, 1);
  });

  test('requeues item-level errors and recovers on the next attempt', async () => {
    apiMocks.getBatchAlbumWithMeta
      .mockResolvedValueOnce({ data: [{
        albumId: '1',
        album: null,
        photo: null,
        error: { message: 'busy', stage: 'get_album', domain: null, reference: null, retryable: true },
      }], cacheMeta: {} })
      .mockResolvedValueOnce({ data: [success('1')], cacheMeta: {} });
    const { result: hook } = renderHook(() => useAlbumBatch(result(['1'])));

    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 1));
    assert.ok(hook.current.albumCache.get('1')?.error);
    await vi.advanceTimersByTimeAsync(1500);
    await waitFor(() => assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 2));
    await waitFor(() => assert.equal(hook.current.albumCache.get('1')?.album?.id, '1'));
  });

  test('refetches an errored in-memory item when the result key changes', async () => {
    apiMocks.getBatchAlbumWithMeta
      .mockResolvedValueOnce({ data: [{
        albumId: '1',
        album: null,
        photo: null,
        error: { message: 'busy', stage: 'get_album', domain: null, reference: null, retryable: true },
      }], cacheMeta: {} })
      .mockResolvedValueOnce({ data: [success('1'), success('2')], cacheMeta: {} });
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
    apiMocks.getBatchAlbumWithMeta
      .mockRejectedValueOnce(new Error('gateway'))
      .mockResolvedValueOnce({ data: [success('7')], cacheMeta: {} });
    const { result: hook } = renderHook(() => useAlbumBatch(result(['7'])));

    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 1));
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
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 0);
  });

  test('renders stale IndexedDB data immediately and forces a metadata-preserving refresh', async () => {
    cacheMocks.getCachedAlbums.mockResolvedValue(new Map([
      ['8', {
        album: { id: '8', name: 'stale' },
        photo: { id: '8', name: 'cached-photo', scrambleId: 0, images: [] },
        albumFreshness: 'stale',
        photoFreshness: 'fresh',
        albumFetchedAt: 100,
        photoFetchedAt: 101,
      }],
    ]));
    apiMocks.getBatchAlbumWithMeta.mockResolvedValue({
      data: [success('8')],
      cacheMeta: {
        'album:8': { fetchedAt: 200, freshness: 'fresh', source: 'upstream' },
        'photo:8': { fetchedAt: 201, freshness: 'fresh', source: 'upstream' },
      },
    });
    const { result: hook } = renderHook(() => useAlbumBatch(result(['8'])));
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.get('8')?.album?.name, 'album-8'));
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls[0][1].refresh, true);
    await waitFor(() => assert.ok(cacheMocks.setCachedAlbums.mock.calls.length > 0));
    assert.equal(cacheMocks.setCachedAlbums.mock.calls[0][0][0].albumFetchedAt, 200);
    assert.equal(cacheMocks.setCachedAlbums.mock.calls[0][0][0].photoFetchedAt, 201);
  });

  test('does not retry terminal item errors', async () => {
    apiMocks.getBatchAlbumWithMeta.mockResolvedValue({
      data: [{
        albumId: 'terminal',
        album: null,
        photo: null,
        error: { message: 'missing', stage: 'get_album', domain: null, reference: null, retryable: false },
      }],
      cacheMeta: {},
    });
    renderHook(() => useAlbumBatch(result(['terminal'])));
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 1);
  });

  test('caps repeated retryable failures at four retries', async () => {
    apiMocks.getBatchAlbumWithMeta.mockRejectedValue(new Error('offline'));
    renderHook(() => useAlbumBatch(result(['retry-cap'])));
    for (let index = 0; index < 6; index++) await vi.advanceTimersByTimeAsync(15_000);
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 5);
  });

  test('uses a complete in-memory hit when a duplicate result changes the key', async () => {
    apiMocks.getBatchAlbumWithMeta.mockResolvedValue({ data: [success('8')], cacheMeta: {} });
    const { result: hook, rerender } = renderHook(({ data }) => useAlbumBatch(data), {
      initialProps: { data: result(['8']) },
    });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.get('8')?.album?.id, '8'));
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 1);

    rerender({ data: result(['8', '8']) });
    await vi.advanceTimersByTimeAsync(50);
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 1);
  });

  test('evicts albums outside the new result set', async () => {
    apiMocks.getBatchAlbumWithMeta.mockImplementation(async (batch: string[]) => ({ data: batch.map(success), cacheMeta: {} }));
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
    apiMocks.getBatchAlbumWithMeta.mockImplementation((_ids: string[], options: { signal: AbortSignal }) => {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
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
    apiMocks.getBatchAlbumWithMeta.mockReturnValue(new Promise((resolve) => {
      resolveBatch = (items) => resolve({ data: items, cacheMeta: {} });
    }));
    const { unmount } = renderHook(() => useAlbumBatch(result(['11'])));
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 1));
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
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 0);
  });

  test('uses requestIdleCallback for offscreen prefetching', async () => {
    const idle = vi.fn((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 20 });
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', idle);
    apiMocks.getBatchAlbumWithMeta.mockResolvedValue({ data: [success('idle')], cacheMeta: {} });
    const { result: hook } = renderHook(() => useAlbumBatch(result(['idle'])));
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => assert.equal(hook.current.albumCache.get('idle')?.album?.id, 'idle'));
    assert.equal(idle.mock.calls.length, 1);
  });

  test('waits on constrained networks until an album approaches the viewport', async () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true, effectiveType: '2g' },
    });
    apiMocks.getBatchAlbumWithMeta.mockResolvedValue({ data: [success('near')], cacheMeta: {} });
    const { result: hook } = renderHook(() => useAlbumBatch(result(['near'])));
    const card = document.createElement('div');
    card.dataset.albumId = 'near';
    act(() => hook.current.getCardRef('near')(card));
    await vi.advanceTimersByTimeAsync(50);
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 0);
    observers[0].callback([
      { target: card, isIntersecting: true },
    ] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    observers[0].callback([
      { target: card, isIntersecting: true },
    ] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    await waitFor(() => assert.equal(hook.current.albumCache.get('near')?.album?.id, 'near'));
    Reflect.deleteProperty(navigator, 'connection');
  });

  test('does not start an idle batch after unmount', async () => {
    let idleCallback: IdleRequestCallback | undefined;
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
      idleCallback = callback;
      return 1;
    }));
    const { unmount } = renderHook(() => useAlbumBatch(result(['cancel-idle'])));
    await vi.advanceTimersByTimeAsync(50);
    assert.ok(idleCallback);
    unmount();
    idleCallback?.({ didTimeout: false, timeRemaining: () => 20 });
    await vi.runAllTimersAsync();
    assert.equal(apiMocks.getBatchAlbumWithMeta.mock.calls.length, 0);
  });
});
