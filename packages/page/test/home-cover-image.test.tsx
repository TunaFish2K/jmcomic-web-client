import assert from 'node:assert/strict';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';

const sharedMocks = vi.hoisted(() => ({
  getSliceCount: vi.fn(),
  reverseImageBySlice: vi.fn(),
  shouldRetryImageStatus: vi.fn(),
}));
const cacheMocks = vi.hoisted(() => ({
  generateCoverCacheKey: vi.fn(),
  getCachedImageEntry: vi.fn(),
  setCachedImage: vi.fn(),
}));

vi.mock('@tiny-client/shared', () => sharedMocks);
vi.mock('@tiny-client/shared/cache', () => cacheMocks);

import { CoverImage } from '../src/home/CoverImage';

describe('CoverImage', () => {
  const createObjectURL = vi.fn(() => 'blob:cover');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    cacheMocks.generateCoverCacheKey.mockImplementation((id, url) => `${id}:${url}`);
    cacheMocks.getCachedImageEntry.mockResolvedValue(null);
    cacheMocks.setCachedImage.mockResolvedValue(undefined);
    sharedMocks.getSliceCount.mockReturnValue(0);
    sharedMocks.reverseImageBySlice.mockResolvedValue({ data: new Uint8Array([9]).buffer });
    sharedMocks.shouldRetryImageStatus.mockImplementation((status) => status >= 500 || status === 429);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('renders a cached cover and revokes its URL on cleanup', async () => {
    const data = new Uint8Array([1, 2]).buffer;
    cacheMocks.getCachedImageEntry.mockResolvedValue({ data, width: 1, height: 2, byteLength: 2 });
    const view = render(<CoverImage coverUrl="https://cdn.test/a.jpg" scrambleId={0} albumId="1" className="cover" />);

    await waitFor(() => assert.equal(view.container.querySelector('img')?.src, 'blob:cover'));
    assert.equal(view.container.querySelector('img')?.className, 'object-cover cover');
    assert.equal(createObjectURL.mock.calls.length, 1);
    view.unmount();
    assert.deepEqual(revokeObjectURL.mock.calls[0], ['blob:cover']);
  });

  test('downloads and caches a plain cover, then handles an image element error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([3, 4]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    cacheMocks.setCachedImage.mockRejectedValue(new Error('quota'));
    const view = render(<CoverImage coverUrl="https://cdn.test/plain.jpg" scrambleId={0} albumId="2" />);

    await waitFor(() => assert.ok(view.container.querySelector('img')));
    assert.equal(sharedMocks.reverseImageBySlice.mock.calls.length, 0);
    assert.equal(cacheMocks.setCachedImage.mock.calls.length, 1);
    fireEvent.error(view.container.querySelector('img')!);
    assert.equal(view.container.querySelector('img'), null);
    assert.match(view.container.firstElementChild?.className ?? '', /animate-pulse/);
  });

  test('reverses a scrambled cover before rendering', async () => {
    sharedMocks.getSliceCount.mockReturnValue(8);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([5]), { status: 200 })));
    const view = render(<CoverImage coverUrl="https://cdn.test/scrambled.jpg" scrambleId={1} albumId="3" />);

    await waitFor(() => assert.ok(view.container.querySelector('img')));
    assert.equal(sharedMocks.reverseImageBySlice.mock.calls[0][1], 8);
    assert.deepEqual(new Uint8Array(cacheMocks.setCachedImage.mock.calls[0][1]), new Uint8Array([9]));
  });

  test('does not retry a permanent HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CoverImage coverUrl="https://cdn.test/missing.jpg" scrambleId={0} albumId="4" />);

    await waitFor(() => assert.equal(fetchMock.mock.calls.length, 1));
    assert.equal(view.container.querySelector('img'), null);
    await vi.advanceTimersByTimeAsync(5000);
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  test('retries transient failures and shows a placeholder after exhaustion', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CoverImage coverUrl="https://cdn.test/offline.jpg" scrambleId={0} albumId="5" />);

    await vi.advanceTimersByTimeAsync(400 + 1000 + 2000 + 10);
    await waitFor(() => assert.equal(fetchMock.mock.calls.length, 4));
    assert.equal(view.container.querySelector('img'), null);
  });

  test('recovers after a retryable HTTP response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 500 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([6]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CoverImage coverUrl="https://cdn.test/recovered.jpg" scrambleId={0} albumId="8" />);

    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => assert.ok(view.container.querySelector('img')));
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  test('aborts a retry delay and ignores a late cache result on unmount', async () => {
    let resolveCache!: (value: null) => void;
    cacheMocks.getCachedImageEntry.mockReturnValue(new Promise((resolve) => { resolveCache = resolve; }));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CoverImage coverUrl="https://cdn.test/late.jpg" scrambleId={0} albumId="6" />);
    view.unmount();
    resolveCache(null);
    await vi.runAllTimersAsync();
    assert.equal(fetchMock.mock.calls.length, 0);
    assert.equal(createObjectURL.mock.calls.length, 0);
  });

  test('aborts while waiting to retry a failed fetch', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CoverImage coverUrl="https://cdn.test/retry.jpg" scrambleId={0} albumId="7" />);
    await vi.advanceTimersByTimeAsync(1);
    view.unmount();
    await vi.runAllTimersAsync();
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  test('does not publish a successful fetch that finishes after unmount', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; })));
    const view = render(<CoverImage coverUrl="https://cdn.test/late-fetch.jpg" scrambleId={0} albumId="9" />);
    await vi.advanceTimersByTimeAsync(1);
    view.unmount();
    resolveFetch(new Response(new Uint8Array([1]), { status: 200 }));
    await vi.runAllTimersAsync();
    assert.equal(createObjectURL.mock.calls.length, 1);
    assert.equal(revokeObjectURL.mock.calls.length, 1);
  });
});
