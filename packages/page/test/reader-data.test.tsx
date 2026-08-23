import assert from 'node:assert/strict';
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, test, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ getAlbumWithMeta: vi.fn(), getPhotoWithMeta: vi.fn() }));
const cacheMocks = vi.hoisted(() => ({ getCachedAlbum: vi.fn(), setCachedAlbum: vi.fn() }));
const storeMocks = vi.hoisted(() => ({ getAlbumMeta: vi.fn(), saveAlbumMeta: vi.fn() }));
const networkMocks = vi.hoisted(() => ({
  canPrefetchAdjacentChapter: vi.fn(),
  getBrowserReaderNetworkCapabilities: vi.fn(),
}));

vi.mock('../src/api', () => apiMocks);
vi.mock('../src/album-cache', () => cacheMocks);
vi.mock('../src/reader/reader-store', () => storeMocks);
vi.mock('../src/reader/network', () => networkMocks);

import { PHOTO_QUERY_STALE_TIME_MS, useReaderData } from '../src/reader/useReaderData';

const album = {
  id: 'root',
  name: 'Series',
  series: [
    { id: '2', name: '', sort: '20' },
    { id: '1', name: 'First', sort: 1 },
    { id: '3', name: 'Unknown', sort: undefined },
  ],
} as never;
const photo1 = { id: '1', name: 'First', scrambleId: 0, images: [{ name: '1.jpg', url: 'one' }] } as never;
const photo2 = { id: '2', name: 'Second', scrambleId: 0, images: [{ name: '2.jpg', url: 'two' }] } as never;

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useReaderData', () => {
  beforeEach(() => {
    apiMocks.getAlbumWithMeta.mockReset().mockResolvedValue({ data: null, cacheMeta: {} });
    apiMocks.getPhotoWithMeta.mockReset().mockResolvedValue({ data: null, cacheMeta: {} });
    cacheMocks.getCachedAlbum.mockReset().mockResolvedValue(null);
    cacheMocks.setCachedAlbum.mockReset().mockResolvedValue(undefined);
    storeMocks.getAlbumMeta.mockReset().mockReturnValue(null);
    storeMocks.saveAlbumMeta.mockReset();
    networkMocks.getBrowserReaderNetworkCapabilities.mockReset().mockReturnValue({ effectiveType: '4g' });
    networkMocks.canPrefetchAdjacentChapter.mockReset().mockReturnValue(false);
  });

  test('uses navigation state immediately for a known series and mounted photo', async () => {
    cacheMocks.getCachedAlbum.mockImplementation(async (id: string) => (
      id === 'root' ? { album, photo: null } : { album, photo: photo1 }
    ));
    const navState = {
      album,
      photo: photo1,
      isSeries: true,
      seriesItems: [
        { id: '1', name: 'One', order: 1 },
        { id: '2', name: 'Two', order: 2 },
      ],
    };
    const { result, rerender } = renderHook(({ state }) => useReaderData({
      albumId: 'root',
      locationState: state,
      currentChapterId: '1',
      mountAlbumId: '1',
    }), {
      initialProps: { state: navState as unknown },
      wrapper: createWrapper(),
    });

    assert.equal(result.current.album, album);
    assert.equal(result.current.photo, photo1);
    assert.equal(result.current.images.length, 1);
    assert.equal(result.current.isSeries, true);
    assert.deepEqual(result.current.sortedChapters, navState.seriesItems);
    assert.equal(result.current.currentChapterIndex, 0);
    rerender({ state: { ...navState, photo: null } });
    await waitFor(() => assert.ok(storeMocks.saveAlbumMeta.mock.calls.length > 0));
  });

  test('uses album metadata and IndexedDB before network requests', async () => {
    storeMocks.getAlbumMeta.mockReturnValue(album);
    cacheMocks.getCachedAlbum.mockImplementation(async (id: string) => (
      id === 'root' ? { album, photo: null } : { album, photo: photo1 }
    ));
    const { result } = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: null,
      currentChapterId: '1',
      mountAlbumId: 'root',
    }), { wrapper: createWrapper() });

    await waitFor(() => assert.equal(result.current.photo, photo1));
    assert.deepEqual(result.current.sortedChapters.map((chapter) => chapter.id), ['1', '2', '3']);
    assert.equal(result.current.sortedChapters[1].name, '第2章');
    assert.equal(result.current.sortedChapters[2].order, Number.MAX_SAFE_INTEGER);
    assert.equal(apiMocks.getAlbumWithMeta.mock.calls.length, 0);
    assert.equal(apiMocks.getPhotoWithMeta.mock.calls.length, 0);
    assert.ok(storeMocks.saveAlbumMeta.mock.calls.length > 0);
  });

  test('falls back to network and persists fetched album and photo data', async () => {
    apiMocks.getAlbumWithMeta.mockResolvedValue({ data: album, cacheMeta: {} });
    apiMocks.getPhotoWithMeta.mockResolvedValue({ data: photo1, cacheMeta: {} });
    const { result } = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: null,
      currentChapterId: '1',
      mountAlbumId: 'root',
    }), { wrapper: createWrapper() });

    await waitFor(() => assert.equal(result.current.photo, photo1));
    assert.equal(result.current.album, album);
    assert.ok(apiMocks.getAlbumWithMeta.mock.calls[0][1].signal instanceof AbortSignal);
    assert.ok(apiMocks.getPhotoWithMeta.mock.calls[0][1].signal instanceof AbortSignal);
    await waitFor(() => assert.ok(cacheMocks.setCachedAlbum.mock.calls.length >= 1));
    assert.ok(cacheMocks.setCachedAlbum.mock.calls.some((call) => call[0] === '1' && call[1] === album && call[2] === photo1));
  });

  test('renders stale reader data and replaces it after forced background refreshes', async () => {
    const refreshedAlbum = { ...album, name: 'Refreshed series' } as never;
    const refreshedPhoto = { ...photo1, name: 'Refreshed chapter' } as never;
    cacheMocks.getCachedAlbum.mockImplementation(async (id: string) => (
      id === 'root'
        ? {
            album,
            photo: null,
            albumFreshness: 'stale',
            photoFreshness: 'expired',
            albumFetchedAt: 100,
            photoFetchedAt: null,
          }
        : {
            album,
            photo: photo1,
            albumFreshness: 'fresh',
            photoFreshness: 'stale',
            albumFetchedAt: 100,
            photoFetchedAt: 101,
          }
    ));
    apiMocks.getAlbumWithMeta.mockResolvedValue({
      data: refreshedAlbum,
      cacheMeta: {},
    });
    apiMocks.getPhotoWithMeta.mockResolvedValue({
      data: refreshedPhoto,
      cacheMeta: { 'photo:1': { fetchedAt: 201, freshness: 'fresh', source: 'upstream' } },
    });

    const { result } = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: null,
      currentChapterId: '1',
      mountAlbumId: 'root',
    }), { wrapper: createWrapper() });

    await waitFor(() => assert.equal(result.current.album?.name, 'Refreshed series'));
    await waitFor(() => assert.equal(result.current.photo?.name, 'Refreshed chapter'));
    assert.equal(apiMocks.getAlbumWithMeta.mock.calls[0][1].refresh, true);
    assert.equal(apiMocks.getPhotoWithMeta.mock.calls[0][1].refresh, true);
    assert.ok(cacheMocks.setCachedAlbum.mock.calls.some((call) => call[0] === 'root' && call[3].albumFetchedAt > 0));
    assert.ok(cacheMocks.setCachedAlbum.mock.calls.some((call) => call[0] === '1' && call[3].photoFetchedAt === 201));
  });

  test('keeps stale reader data when forced refresh fails', async () => {
    cacheMocks.getCachedAlbum.mockImplementation(async (id: string) => ({
      album,
      photo: id === '1' ? photo1 : null,
      albumFreshness: id === 'root' ? 'stale' : 'fresh',
      photoFreshness: id === '1' ? 'stale' : 'expired',
      albumFetchedAt: 100,
      photoFetchedAt: id === '1' ? 101 : null,
    }));
    apiMocks.getAlbumWithMeta.mockRejectedValue(new Error('album refresh failed'));
    apiMocks.getPhotoWithMeta.mockRejectedValue(new Error('photo refresh failed'));
    const { result } = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: null,
      currentChapterId: '1',
      mountAlbumId: 'root',
    }), { wrapper: createWrapper() });
    await waitFor(() => assert.equal(result.current.photo, photo1));
    await waitFor(() => assert.ok(apiMocks.getAlbumWithMeta.mock.calls.length > 0));
    await waitFor(() => assert.ok(apiMocks.getPhotoWithMeta.mock.calls.length > 0));
    assert.equal(result.current.album, album);
  });

  test('refreshes a stale photo without album context and tolerates missing cache metadata', async () => {
    cacheMocks.getCachedAlbum.mockResolvedValue({
      album,
      photo: photo1,
      albumFreshness: 'fresh',
      photoFreshness: 'stale',
      albumFetchedAt: 100,
      photoFetchedAt: null,
    });
    apiMocks.getPhotoWithMeta.mockResolvedValue({ data: photo2, cacheMeta: {} });
    const { result } = renderHook(() => useReaderData({
      albumId: undefined,
      locationState: null,
      currentChapterId: '1',
      mountAlbumId: undefined,
    }), { wrapper: createWrapper() });
    await waitFor(() => assert.equal(result.current.photo?.name, photo2.name));
    assert.equal(cacheMocks.setCachedAlbum.mock.calls.length, 0);
  });

  test('loads an uncached photo without album context', async () => {
    cacheMocks.getCachedAlbum.mockResolvedValue(null);
    apiMocks.getPhotoWithMeta.mockResolvedValue({ data: photo1, cacheMeta: {} });
    const { result } = renderHook(() => useReaderData({
      albumId: undefined,
      locationState: null,
      currentChapterId: '1',
      mountAlbumId: undefined,
    }), { wrapper: createWrapper() });
    await waitFor(() => assert.equal(result.current.photo, photo1));
    assert.equal(cacheMocks.setCachedAlbum.mock.calls.length, 0);
  });

  test('stores a refreshed photo with navigation album data before an album timestamp exists', async () => {
    cacheMocks.getCachedAlbum.mockResolvedValue({
      album,
      photo: photo1,
      albumFreshness: 'fresh',
      photoFreshness: 'stale',
      albumFetchedAt: 100,
      photoFetchedAt: 101,
    });
    apiMocks.getPhotoWithMeta.mockResolvedValue({ data: photo2, cacheMeta: {} });
    const { result } = renderHook(() => useReaderData({
      albumId: undefined,
      locationState: { album },
      currentChapterId: '1',
      mountAlbumId: undefined,
    }), { wrapper: createWrapper() });
    await waitFor(() => assert.equal(result.current.photo?.name, photo2.name));
    assert.ok(cacheMocks.setCachedAlbum.mock.calls.some((call) => (
      call[0] === '1' && call[3].albumFetchedAt > 0
    )));
  });

  test('returns stale values when background refresh finds no replacement', async () => {
    cacheMocks.getCachedAlbum.mockImplementation(async (id: string) => ({
      album,
      photo: id === '1' ? photo1 : null,
      albumFreshness: id === 'root' ? 'stale' : 'fresh',
      photoFreshness: id === '1' ? 'stale' : 'expired',
      albumFetchedAt: 100,
      photoFetchedAt: id === '1' ? 101 : null,
    }));
    const { result } = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: null,
      currentChapterId: '1',
      mountAlbumId: 'root',
    }), { wrapper: createWrapper() });
    await waitFor(() => assert.equal(result.current.photo, photo1));
    await waitFor(() => assert.ok(apiMocks.getAlbumWithMeta.mock.calls.length > 0));
    await waitFor(() => assert.ok(apiMocks.getPhotoWithMeta.mock.calls.length > 0));
  });

  test('returns a single fallback chapter for a standalone album', async () => {
    const standalone = { id: 'solo', name: 'Solo', series: [] } as never;
    cacheMocks.getCachedAlbum.mockResolvedValue({ album: standalone, photo: null });
    const { result } = renderHook(() => useReaderData({
      albumId: 'solo',
      locationState: { album: standalone, isSeries: false },
      currentChapterId: 'solo',
      mountAlbumId: 'solo',
    }), { wrapper: createWrapper() });

    assert.deepEqual(result.current.sortedChapters, [{ id: 'solo', name: 'Solo', order: 0 }]);
    assert.equal(result.current.currentChapterIndex, 0);
    assert.equal(result.current.photo, undefined);
  });

  test('keeps disabled queries inert without identifiers', () => {
    const { result } = renderHook(() => useReaderData({
      albumId: undefined,
      locationState: null,
      currentChapterId: '',
      mountAlbumId: undefined,
    }), { wrapper: createWrapper() });
    assert.equal(result.current.album, undefined);
    assert.equal(result.current.photo, undefined);
    assert.deepEqual(result.current.images, []);
    assert.equal(apiMocks.getAlbumWithMeta.mock.calls.length, 0);
    assert.equal(apiMocks.getPhotoWithMeta.mock.calls.length, 0);
  });

  test('blocks prefetch without a next chapter or on a constrained connection', async () => {
    cacheMocks.getCachedAlbum.mockResolvedValue({ album, photo: photo1 });
    const noNext = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: { album, isSeries: true, seriesItems: [{ id: '1', name: 'One', order: 1 }] },
      currentChapterId: '1',
      mountAlbumId: '1',
    }), { wrapper: createWrapper() });
    assert.equal(await noNext.result.current.prefetchNextChapter(), undefined);
    noNext.unmount();

    const constrained = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: {
        album,
        photo: photo1,
        isSeries: true,
        seriesItems: [{ id: '1', name: 'One', order: 1 }, { id: '2', name: 'Two', order: 2 }],
      },
      currentChapterId: '1',
      mountAlbumId: '1',
    }), { wrapper: createWrapper() });
    assert.equal(await constrained.result.current.prefetchNextChapter(), undefined);
    assert.equal(apiMocks.getPhotoWithMeta.mock.calls.length, 0);
  });

  test('prefetches the next photo once and respects caller cancellation', async () => {
    networkMocks.canPrefetchAdjacentChapter.mockReturnValue(true);
    cacheMocks.getCachedAlbum.mockImplementation(async (id: string) => {
      if (id === 'root') return { album, photo: null };
      if (id === '1') return { album, photo: photo1 };
      return null;
    });
    apiMocks.getPhotoWithMeta.mockImplementation(async (id: string) => ({
      data: id === '2' ? photo2 : photo1,
      cacheMeta: {},
    }));
    const { result, unmount } = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: {
        album,
        photo: photo1,
        isSeries: true,
        seriesItems: [{ id: '1', name: 'One', order: 1 }, { id: '2', name: 'Two', order: 2 }],
      },
      currentChapterId: '1',
      mountAlbumId: '1',
    }), { wrapper: createWrapper() });

    await waitFor(() => assert.ok(apiMocks.getPhotoWithMeta.mock.calls.some((call) => call[0] === '2')));
    assert.equal(await result.current.prefetchNextChapter(), photo2);
    const controller = new AbortController();
    controller.abort();
    assert.equal(await result.current.prefetchNextChapter(controller.signal), undefined);
    assert.equal(PHOTO_QUERY_STALE_TIME_MS, 30 * 60 * 1000);
    unmount();
  });

  test('swallows automatic adjacent prefetch failures', async () => {
    networkMocks.canPrefetchAdjacentChapter.mockReturnValue(true);
    cacheMocks.getCachedAlbum.mockImplementation(async (id: string) => (
      id === '2' ? null : { album, photo: photo1 }
    ));
    apiMocks.getPhotoWithMeta.mockRejectedValue(new Error('prefetch failed'));
    const { unmount } = renderHook(() => useReaderData({
      albumId: 'root',
      locationState: {
        album,
        photo: photo1,
        isSeries: true,
        seriesItems: [{ id: '1', name: 'One', order: 1 }, { id: '2', name: 'Two', order: 2 }],
      },
      currentChapterId: '1',
      mountAlbumId: '1',
    }), { wrapper: createWrapper() });
    await waitFor(() => assert.ok(apiMocks.getPhotoWithMeta.mock.calls.length > 0));
    await act(async () => { await Promise.resolve(); });
    unmount();
  });
});
