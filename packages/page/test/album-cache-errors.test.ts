import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

function stubOpenWithDatabase(database: Record<string, unknown>) {
  const openRequest: Record<string, unknown> = { result: database };
  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => (openRequest.onsuccess as (() => void))());
      return openRequest;
    },
  });
}

function requestWith(event: 'onsuccess' | 'onerror', result?: unknown) {
  const request: Record<string, unknown> = { result, error: new Error('request failed') };
  queueMicrotask(() => (request[event] as (() => void))());
  return request;
}

test('falls back cleanly when opening the album database fails', async () => {
  vi.resetModules();
  const request: Record<string, unknown> = { error: new Error('open failed') };
  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => (request.onerror as (() => void))());
      return request;
    },
  });
  const cache = await import('../src/album-cache');
  assert.equal(await cache.getCachedAlbum('1'), null);
  await cache.setCachedAlbum('1', { id: '1' } as never);
});

test('abandons a blocked album database upgrade', async () => {
  vi.resetModules();
  const request: Record<string, unknown> = {};
  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => (request.onblocked as (() => void))());
      return request;
    },
  });
  const cache = await import('../src/album-cache');
  assert.equal(await cache.getCachedAlbum('1'), null);
});

test('keeps an existing store and index during a version upgrade', async () => {
  vi.resetModules();
  const createIndex = vi.fn();
  const store = { indexNames: { contains: () => true }, createIndex };
  const request: Record<string, unknown> = {
    result: { objectStoreNames: { contains: () => true } },
    transaction: { objectStore: () => store },
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => {
        (request.onupgradeneeded as (() => void))();
        (request.onblocked as (() => void))();
      });
      return request;
    },
  });
  const cache = await import('../src/album-cache');
  assert.equal(await cache.getCachedAlbum('1'), null);
  assert.equal(createIndex.mock.calls.length, 0);
});

test('closes a database that succeeds after a blocked upgrade', async () => {
  vi.resetModules();
  const close = vi.fn();
  const request: Record<string, unknown> = { result: { close } };
  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => {
        (request.onblocked as (() => void))();
        (request.onsuccess as (() => void))();
      });
      return request;
    },
  });
  const cache = await import('../src/album-cache');
  assert.equal(await cache.getCachedAlbum('1'), null);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(close.mock.calls.length, 1);
});

test('rejects a successfully opened database without the album store', async () => {
  vi.resetModules();
  const close = vi.fn();
  stubOpenWithDatabase({
    close,
    objectStoreNames: { contains: () => false },
  });
  const cache = await import('../src/album-cache');
  assert.equal(await cache.getCachedAlbum('1'), null);
  assert.equal(close.mock.calls.length, 1);
});

test('closes and forgets the database on a version change', async () => {
  vi.resetModules();
  const close = vi.fn();
  const database: Record<string, unknown> = {
    close,
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({ get: () => requestWith('onsuccess', undefined) }),
    }),
  };
  stubOpenWithDatabase(database);
  const cache = await import('../src/album-cache');
  assert.equal(await cache.getCachedAlbum('1'), null);
  (database.onversionchange as (() => void))();
  assert.equal(close.mock.calls.length, 1);
});

test('treats an IndexedDB get request error as a cache miss', async () => {
  vi.resetModules();
  stubOpenWithDatabase({
    close: vi.fn(),
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({ get: () => requestWith('onerror') }),
    }),
  });
  const cache = await import('../src/album-cache');
  assert.equal(await cache.getCachedAlbum('1'), null);
  await cache.setCachedAlbum('1', { id: '1' } as never);
});

test('silently handles put, count, and cursor request failures', async () => {
  for (const failure of ['put', 'count', 'cursor'] as const) {
    vi.resetModules();
    const store = {
      get: () => requestWith('onsuccess', undefined),
      put: () => requestWith(failure === 'put' ? 'onerror' : 'onsuccess'),
      index: () => ({
        count: () => requestWith(failure === 'count' ? 'onerror' : 'onsuccess', 201),
        openCursor: () => requestWith('onerror'),
      }),
    };
    stubOpenWithDatabase({
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
      transaction: () => ({ objectStore: () => store }),
    });
    const cache = await import('../src/album-cache');
    await cache.setCachedAlbum(`failure-${failure}`, { id: failure } as never);
  }
});
