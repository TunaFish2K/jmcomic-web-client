import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

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
