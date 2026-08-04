import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
});
