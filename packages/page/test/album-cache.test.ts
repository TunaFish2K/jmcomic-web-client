import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const indexedDB = new IDBFactory();
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDB });

async function seedBrokenVersionOneDatabase(): Promise<void> {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('jm-album-cache', 1);
    request.onsuccess = () => {
      request.result.close();
      resolve(undefined);
    };
    request.onerror = () => reject(request.error);
  });
}

async function inspectDatabase(): Promise<{
  version: number;
  stores: string[];
  indexes: string[];
}> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('jm-album-cache');
    request.onsuccess = () => {
      const database = request.result;
      const store = database.transaction('albums', 'readonly').objectStore('albums');
      resolve({
        version: database.version,
        stores: Array.from(database.objectStoreNames),
        indexes: Array.from(store.indexNames),
      });
      database.close();
    };
    request.onerror = () => reject(request.error);
  });
}

describe('album cache schema', () => {
  it('repairs a v1 database that is missing the albums store', async () => {
    await seedBrokenVersionOneDatabase();
    const cache = await import('../src/album-cache');

    assert.equal(await cache.getCachedAlbum('missing'), null);
    assert.deepEqual(await inspectDatabase(), {
      version: 2,
      stores: ['albums'],
      indexes: ['updatedAt'],
    });
  });

  it('stores, reads, batches, and expires album entries', async () => {
    const cache = await import('../src/album-cache');
    const album = { id: '1', name: 'Album one' } as never;
    const photo = { id: '1', name: 'Photo one', scrambleId: 0, images: [] } as never;
    await cache.setCachedAlbum('1', album, photo);
    await cache.setCachedAlbum('2', { id: '2', name: 'Album two' } as never);
    assert.deepEqual(await cache.getCachedAlbum('1'), { album, photo });
    assert.equal((await cache.getCachedAlbum('2'))?.photo, null);
    assert.equal(await cache.getCachedAlbum('missing'), null);
    const batch = await cache.getCachedAlbums(['1', 'missing', '2']);
    assert.deepEqual([...batch.keys()], ['1', '2']);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jm-album-cache', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('albums', 'readwrite');
      transaction.objectStore('albums').put({ albumId: 'expired', album, photo: null, updatedAt: 0 });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    assert.equal(await cache.getCachedAlbum('expired'), null);
    database.close();
  });

  it('stores batches and prunes entries past the bounded cache size', async () => {
    const cache = await import('../src/album-cache');
    await cache.setCachedAlbums([
      { albumId: 'batch-a', album: { id: 'batch-a', name: 'A' } as never, photo: null },
      { albumId: 'batch-b', album: { id: 'batch-b', name: 'B' } as never, photo: null },
    ]);
    assert.equal((await cache.getCachedAlbum('batch-a'))?.album.name, 'A');

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jm-album-cache', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('albums', 'readwrite');
      const store = transaction.objectStore('albums');
      for (let index = 0; index < 202; index++) {
        store.put({
          albumId: `seed-${index}`,
          album: { id: `seed-${index}`, name: `Seed ${index}` },
          photo: null,
          updatedAt: index + 1,
        });
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    await cache.setCachedAlbum('newest', { id: 'newest', name: 'Newest' } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(await cache.getCachedAlbum('seed-0'), null);
    assert.equal((await cache.getCachedAlbum('newest'))?.album.name, 'Newest');
    database.close();
  });
});
