// IndexedDB 图片缓存
const DB_NAME = 'jm-image-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';

interface CacheEntry {
    key: string;
    data: ArrayBuffer;
    timestamp: number;
    size: number;
}

let db: IDBDatabase | null = null;

// 启动时清理过期缓存（保留最近7天）
cleanupOldCache().catch(() => {});

async function openDB(): Promise<IDBDatabase> {
    if (db) return db;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        
        request.onupgradeneeded = (event) => {
            const database = (event.target as IDBOpenDBRequest).result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                console.log('创建 object store:', STORE_NAME);
            }
        };
        
        request.onsuccess = () => {
            const database = request.result;
            
            // 检查 store 是否存在，不存在则删除数据库重建
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                console.error('Store 不存在，删除数据库重建');
                database.close();
                const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
                deleteRequest.onsuccess = () => {
                    // 递归重新打开
                    db = null;
                    openDB().then(resolve).catch(reject);
                };
                deleteRequest.onerror = () => reject(deleteRequest.error);
                return;
            }
            
            db = database;
            resolve(db);
        };
    });
}

export async function getCachedImage(key: string): Promise<ArrayBuffer | null> {
    try {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);
            
            request.onsuccess = () => {
                const result: CacheEntry | undefined = request.result;
                resolve(result?.data || null);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('读取缓存失败:', error);
        return null;
    }
}

export async function setCachedImage(key: string, data: ArrayBuffer): Promise<void> {
    try {
        const database = await openDB();
        const entry: CacheEntry = {
            key,
            data,
            timestamp: Date.now(),
            size: data.byteLength,
        };
        
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(entry);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('写入缓存失败:', error);
    }
}

// 清理旧缓存（保留最近7天的）
export async function cleanupOldCache(maxAgeDays: number = 7): Promise<void> {
    try {
        const database = await openDB();
        const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
        
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('timestamp');
            const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
            
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('清理缓存失败:', error);
    }
}

// 获取缓存统计
export async function getCacheStats(): Promise<{ count: number; totalSize: number }> {
    try {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.openCursor();
            
            let count = 0;
            let totalSize = 0;
            
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    const entry: CacheEntry = cursor.value;
                    count++;
                    totalSize += entry.size;
                    cursor.continue();
                } else {
                    resolve({ count, totalSize });
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('获取缓存统计失败:', error);
        return { count: 0, totalSize: 0 };
    }
}

// 生成缓存键
export function generateImageCacheKey(photoId: string, imageName: string): string {
    return `${photoId}/${imageName}`;
}

// 清除所有缓存
export async function clearAllCache(): Promise<void> {
    try {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('清除缓存失败:', error);
    }
}

// 删除整个数据库（更彻底的清除）
export function deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
        // 先关闭数据库连接
        if (db) {
            db.close();
            db = null;
        }
        
        const request = indexedDB.deleteDatabase(DB_NAME);
        
        request.onsuccess = () => {
            console.log('数据库删除成功');
            resolve();
        };
        request.onerror = () => {
            console.error('数据库删除失败:', request.error);
            reject(request.error);
        };
        request.onblocked = () => {
            console.warn('数据库删除被阻塞，请关闭其他标签页');
        };
    });
}
