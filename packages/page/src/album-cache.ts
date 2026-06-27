import type { Album, PhotoWithScrambleId } from "@tiny-client/shared";

const DB_NAME = "jm-album-cache";
const DB_VERSION = 1;
const STORE_NAME = "albums";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

type CachedAlbumEntry = {
  albumId: string;
  album: Album;
  photo: PhotoWithScrambleId | null;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "albumId" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function enforceMaxEntries(db: IDBDatabase): Promise<void> {
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index("updatedAt");

  const count = await new Promise<number>((resolve, reject) => {
    const req = index.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (count <= MAX_ENTRIES) return;

  const oldestCutoff = Date.now() + 1;
  const req = index.openCursor();
  let toDelete = count - MAX_ENTRIES;
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || toDelete <= 0) { resolve(); return; }
      const deleteTx = db.transaction(STORE_NAME, "readwrite");
      deleteTx.objectStore(STORE_NAME).delete(cursor.primaryKey);
      toDelete--;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedAlbum(
  albumId: string,
): Promise<{ album: Album; photo: PhotoWithScrambleId | null } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(albumId);
      request.onsuccess = () => {
        const entry = request.result as CachedAlbumEntry | undefined;
        if (!entry) return resolve(null);
        if (Date.now() - entry.updatedAt > CACHE_TTL_MS) {
          const delTx = db.transaction(STORE_NAME, "readwrite");
          delTx.objectStore(STORE_NAME).delete(albumId);
          return resolve(null);
        }
        resolve({ album: entry.album, photo: entry.photo });
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getCachedAlbums(
  albumIds: string[],
): Promise<Map<string, { album: Album; photo: PhotoWithScrambleId | null }>> {
  const result = new Map<string, { album: Album; photo: PhotoWithScrambleId | null }>();
  await Promise.all(
    albumIds.map(async (id) => {
      const entry = await getCachedAlbum(id);
      if (entry) result.set(id, entry);
    }),
  );
  return result;
}

export async function setCachedAlbum(
  albumId: string,
  album: Album,
  photo?: PhotoWithScrambleId | null,
): Promise<void> {
  try {
    const db = await openDB();
    const entry: CachedAlbumEntry = {
      albumId,
      album,
      photo: photo ?? null,
      updatedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    await enforceMaxEntries(db);
  } catch {
    // silent fail
  }
}

export async function setCachedAlbums(
  items: Array<{ albumId: string; album: Album; photo: PhotoWithScrambleId | null }>,
): Promise<void> {
  await Promise.all(items.map((item) => setCachedAlbum(item.albumId, item.album, item.photo)));
}
