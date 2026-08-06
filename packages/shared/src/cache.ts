const DB_NAME = 'jm-image-cache';
const DB_VERSION = 2;
const IMAGE_STORE_NAME = 'images';
const METADATA_STORE_NAME = 'image-metadata';

interface CacheEntry {
    key: string;
    data: ArrayBuffer;
    timestamp: number;
    size: number;
    width?: number;
    height?: number;
}

export interface CachedImageMetadata {
    key: string;
    width: number;
    height: number;
    byteLength: number;
    timestamp: number;
}

export interface CachedImageEntry {
    data: ArrayBuffer;
    width: number | null;
    height: number | null;
    byteLength: number;
}

let db: IDBDatabase | null = null;

if (typeof indexedDB !== 'undefined') cleanupOldCache().catch(() => {});

async function openDB(): Promise<IDBDatabase> {
    if (db) return db;

    if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB is unavailable');
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Image cache database is blocked'));

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
                const store = database.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'key' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!database.objectStoreNames.contains(METADATA_STORE_NAME)) {
                const store = database.createObjectStore(METADATA_STORE_NAME, { keyPath: 'key' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };

        request.onsuccess = () => {
            db = request.result;
            db.onversionchange = () => {
                db?.close();
                db = null;
            };
            resolve(db);
        };
    });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Cache transaction aborted'));
    });
}

export async function getCachedImageEntry(key: string): Promise<CachedImageEntry | null> {
    try {
        const database = await openDB();
        const transaction = database.transaction([IMAGE_STORE_NAME, METADATA_STORE_NAME], 'readonly');
        const imageRequest = transaction.objectStore(IMAGE_STORE_NAME).get(key) as IDBRequest<CacheEntry | undefined>;
        const metadataRequest = transaction.objectStore(METADATA_STORE_NAME).get(key) as IDBRequest<CachedImageMetadata | undefined>;
        const [image, metadata] = await Promise.all([
            requestValue(imageRequest),
            requestValue(metadataRequest),
        ]);
        if (!image) return null;
        return {
            data: image.data,
            width: metadata?.width ?? image.width ?? null,
            height: metadata?.height ?? image.height ?? null,
            byteLength: metadata?.byteLength ?? image.size ?? image.data.byteLength,
        };
    } catch (error) {
        console.error('读取图片缓存失败:', error);
        return null;
    }
}

export async function getCachedImageMetadata(key: string): Promise<CachedImageMetadata | null> {
    try {
        const database = await openDB();
        const transaction = database.transaction(METADATA_STORE_NAME, 'readonly');
        const request = transaction.objectStore(METADATA_STORE_NAME).get(key) as IDBRequest<CachedImageMetadata | undefined>;
        return (await requestValue(request)) ?? null;
    } catch (error) {
        console.error('读取图片缓存元数据失败:', error);
        return null;
    }
}

export async function getCachedImage(key: string): Promise<ArrayBuffer | null> {
    return (await getCachedImageEntry(key))?.data ?? null;
}

export async function setCachedImageMetadata(
    key: string,
    width: number,
    height: number,
    byteLength: number,
): Promise<void> {
    try {
        const database = await openDB();
        const transaction = database.transaction(METADATA_STORE_NAME, 'readwrite');
        transaction.objectStore(METADATA_STORE_NAME).put({
            key,
            width,
            height,
            byteLength,
            timestamp: Date.now(),
        } satisfies CachedImageMetadata);
        await transactionDone(transaction);
    } catch (error) {
        console.error('写入图片缓存元数据失败:', error);
    }
}

export async function setCachedImage(
    key: string,
    data: ArrayBuffer,
    metadata?: { width: number; height: number },
): Promise<void> {
    try {
        const database = await openDB();
        const stores = metadata
            ? [IMAGE_STORE_NAME, METADATA_STORE_NAME]
            : [IMAGE_STORE_NAME];
        const transaction = database.transaction(stores, 'readwrite');
        const timestamp = Date.now();
        transaction.objectStore(IMAGE_STORE_NAME).put({
            key,
            data,
            timestamp,
            size: data.byteLength,
            width: metadata?.width,
            height: metadata?.height,
        } satisfies CacheEntry);
        if (metadata) {
            transaction.objectStore(METADATA_STORE_NAME).put({
                key,
                width: metadata.width,
                height: metadata.height,
                byteLength: data.byteLength,
                timestamp,
            } satisfies CachedImageMetadata);
        }
        await transactionDone(transaction);
    } catch (error) {
        console.error('写入图片缓存失败:', error);
    }
}

async function deleteEntriesBefore(
    database: IDBDatabase,
    storeName: string,
    cutoff: number,
): Promise<void> {
    const transaction = database.transaction(storeName, 'readwrite');
    const request = transaction.objectStore(storeName).index('timestamp').openCursor(IDBKeyRange.upperBound(cutoff));
    await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            cursor.delete();
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
}

export async function cleanupOldCache(maxAgeDays: number = 7): Promise<void> {
    try {
        const database = await openDB();
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
        await Promise.all([
            deleteEntriesBefore(database, IMAGE_STORE_NAME, cutoff),
            deleteEntriesBefore(database, METADATA_STORE_NAME, cutoff),
        ]);
    } catch (error) {
        console.error('清理图片缓存失败:', error);
    }
}

export async function getCacheStats(): Promise<{ count: number; totalSize: number }> {
    try {
        const database = await openDB();
        const transaction = database.transaction(IMAGE_STORE_NAME, 'readonly');
        const request = transaction.objectStore(IMAGE_STORE_NAME).openCursor();
        return await new Promise((resolve, reject) => {
            let count = 0;
            let totalSize = 0;
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve({ count, totalSize });
                    return;
                }
                const entry = cursor.value as CacheEntry;
                count += 1;
                totalSize += entry.size ?? entry.data.byteLength;
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('获取图片缓存统计失败:', error);
        return { count: 0, totalSize: 0 };
    }
}

export function generateImageCacheKey(photoId: string, imageName: string): string {
    return `${photoId}/${imageName}`;
}

// Cover images are stored separately from reader photos: the stored bytes are
// the *unscrambled* JPEG so a cache hit skips both the fetch and the
// reverse-by-slice work. Keyed by albumId + filename to keep re-uploaded
// covers distinct.
export function generateCoverCacheKey(albumId: string, coverUrl: string): string {
    const filename = coverUrl.split('/').pop() ?? 'cover';
    return `cover/${albumId}/${filename}`;
}

export async function clearAllCache(): Promise<void> {
    try {
        const database = await openDB();
        const transaction = database.transaction([IMAGE_STORE_NAME, METADATA_STORE_NAME], 'readwrite');
        transaction.objectStore(IMAGE_STORE_NAME).clear();
        transaction.objectStore(METADATA_STORE_NAME).clear();
        await transactionDone(transaction);
    } catch (error) {
        console.error('清除图片缓存失败:', error);
    }
}

export function deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close();
            db = null;
        }
        if (typeof indexedDB === 'undefined') {
            resolve();
            return;
        }
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Image cache database is blocked'));
    });
}
