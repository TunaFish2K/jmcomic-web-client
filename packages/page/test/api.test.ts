import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';

vi.mock('../src/backend-url', () => ({ getBackendUrl: () => 'https://backend.test' }));

import { getAlbum, getBatchAlbum, getBatchPhoto, getPhoto, search } from '../src/api';

const searchResult = {
  search_query: 'cats',
  total: '1',
  content: [{ id: '42', author: 'a', name: 'n' }],
} as const;

describe('frontend backend API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('builds default and paged search requests and forwards cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(searchResult), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(searchResult), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    assert.deepEqual(await search('cats', undefined, controller.signal), {
      ...searchResult,
      redirect_aid: undefined,
    });
    await search('cats', {
      page: 2,
      orderBy: 'mv',
      time: 'w',
      mainTag: 3,
      previousIds: ['1', '2'],
    }, controller.signal);

    const firstUrl = fetchMock.mock.calls[0][0] as URL;
    assert.equal(firstUrl.search, '?query=cats&page=1&orderBy=mr&time=a&mainTag=0&warmup=1');
    const secondUrl = fetchMock.mock.calls[1][0] as URL;
    assert.equal(secondUrl.searchParams.get('previousIds'), '1,2');
    assert.equal(secondUrl.searchParams.get('orderBy'), 'mv');
    assert.equal(fetchMock.mock.calls[1][1]?.signal, controller.signal);
  });

  test('reports a failed search response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', {
      status: 400,
      statusText: 'Bad Request',
    })));
    await assert.rejects(search('bad'), /400 Bad Request, message: nope/);
  });

  test('loads albums and treats only 404 as absent', async () => {
    const album = { id: '1', name: 'Album' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(album), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('offline', { status: 503, statusText: 'Unavailable' }));
    vi.stubGlobal('fetch', fetchMock);

    assert.deepEqual(await getAlbum('1'), album);
    assert.equal(await getAlbum('missing'), null);
    await assert.rejects(getAlbum('broken'), /503 Unavailable, message: offline/);
  });

  test('loads photos, returns null for 404, and retries retryable status codes', async () => {
    const photo = { id: '10', name: 'Chapter', scrambleId: 0, images: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(photo), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    assert.equal(await getPhoto('missing'), null);
    const pending = getPhoto('10');
    await vi.advanceTimersByTimeAsync(500);
    assert.deepEqual(await pending, photo);
    assert.equal(fetchMock.mock.calls.length, 3);
  });

  test('retries network failures and eventually exposes the last failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const pending = getPhoto('10');
    const assertion = assert.rejects(pending, /network down/);
    await vi.advanceTimersByTimeAsync(500 + 1500 + 3000);
    await assertion;
    assert.equal(fetchMock.mock.calls.length, 4);
  });

  test('does not retry permanent photo failures or an aborted request', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('forbidden', { status: 403, statusText: 'Forbidden' }))
      .mockImplementationOnce(async () => {
        controller.abort(abortError);
        throw new TypeError('fetch aborted');
      });
    vi.stubGlobal('fetch', fetchMock);

    await assert.rejects(getPhoto('forbidden'), /403 Forbidden, message: forbidden/);
    await assert.rejects(getPhoto('cancelled', controller.signal), (error: unknown) => error === abortError);
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  test('cancels before and during a retry delay', async () => {
    const beforeDelay = new AbortController();
    beforeDelay.abort(new DOMException('already cancelled', 'AbortError'));
    const duringDelay = new AbortController();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 500 }))
      .mockResolvedValueOnce(new Response('busy', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await assert.rejects(
      getPhoto('cancel-before-delay', beforeDelay.signal),
      /already cancelled/,
    );

    const pending = getPhoto('cancel-during-delay', duringDelay.signal);
    await vi.advanceTimersByTimeAsync(1);
    duringDelay.abort(new DOMException('cancelled in delay', 'AbortError'));
    await assert.rejects(pending, /cancelled in delay/);
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  test('creates a standard abort error when a legacy signal has no reason', async () => {
    const legacySignal = {
      aborted: true,
      reason: undefined,
      addEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 500 }))
      .mockRejectedValueOnce(new TypeError('aborted'));
    vi.stubGlobal('fetch', fetchMock);

    await assert.rejects(
      getPhoto('legacy-delay', legacySignal),
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    );
    await assert.rejects(
      getPhoto('legacy-fetch', legacySignal),
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    );
  });

  test('loads batch photos, including retry, and skips empty batches', async () => {
    const result = [{ photoId: '1', photo: { id: '1' } }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    assert.deepEqual(await getBatchPhoto([]), []);
    const pending = getBatchPhoto(['1', '2']);
    await vi.advanceTimersByTimeAsync(500);
    assert.deepEqual(await pending, result);
    assert.equal((fetchMock.mock.calls[0][0] as URL).searchParams.get('ids'), '1,2');
  });

  test('loads album batches and reports backend failures', async () => {
    const result = [{ albumId: '1', album: { id: '1' }, photo: null }];
    const controller = new AbortController();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))
      .mockResolvedValueOnce(new Response('failed', { status: 502, statusText: 'Gateway' }));
    vi.stubGlobal('fetch', fetchMock);

    assert.deepEqual(await getBatchAlbum([]), []);
    assert.deepEqual(await getBatchAlbum(['1'], controller.signal), result);
    assert.equal(fetchMock.mock.calls[0][1]?.signal, controller.signal);
    await assert.rejects(getBatchAlbum(['2']), /502 Gateway, message: failed/);
  });
});
