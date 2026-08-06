import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const indexedDB = new IDBFactory();
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });

async function seedVersionOneCache() {
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('jm-image-cache', 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore('images', { keyPath: 'key' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.put({
                key: 'legacy/001.jpg',
                data: new Uint8Array([1, 2, 3]).buffer,
                timestamp: Date.now(),
                size: 3,
            });
        };
        request.onsuccess = () => {
            request.result.close();
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

describe('image cache v2 metadata', () => {
    it('upgrades v1 entries and fills lightweight metadata lazily', async () => {
        await seedVersionOneCache();
        const cache = await import('../src/cache');

        const legacy = await cache.getCachedImageEntry('legacy/001.jpg');
        assert.ok(legacy);
        assert.deepEqual([...new Uint8Array(legacy.data)], [1, 2, 3]);
        assert.equal(legacy.width, null);
        assert.equal(legacy.height, null);

        await cache.setCachedImageMetadata('legacy/001.jpg', 1200, 1800, legacy.byteLength);
        assert.deepEqual(await cache.getCachedImageMetadata('legacy/001.jpg'), {
            key: 'legacy/001.jpg',
            width: 1200,
            height: 1800,
            byteLength: 3,
            timestamp: (await cache.getCachedImageMetadata('legacy/001.jpg'))!.timestamp,
        });

        const data = new Uint8Array([4, 5, 6, 7]).buffer;
        await cache.setCachedImage('new/002.jpg', data, { width: 800, height: 1600 });
        const current = await cache.getCachedImageEntry('new/002.jpg');
        assert.ok(current);
        assert.equal(current.width, 800);
        assert.equal(current.height, 1600);
        assert.equal(current.byteLength, 4);

        await cache.clearAllCache();
        assert.deepEqual(await cache.getCacheStats(), { count: 0, totalSize: 0 });
    });

    it('generates distinct cover cache keys per album and file', async () => {
        const cache = await import('../src/cache');
        const a = cache.generateCoverCacheKey('123', 'https://cdn.example/path/cover.jpg');
        const b = cache.generateCoverCacheKey('123', 'https://cdn.example/path/cover_thumb.jpg');
        const c = cache.generateCoverCacheKey('456', 'https://cdn.example/path/cover.jpg');
        assert.equal(a, 'cover/123/cover.jpg');
        assert.notEqual(a, b);
        assert.notEqual(a, c);
    });
});
