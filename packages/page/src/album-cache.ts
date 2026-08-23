import type { Album, PhotoWithScrambleId } from "@tiny-client/shared";

const DB_NAME = "jm-album-cache";
const DB_VERSION = 3;
const STORE_NAME = "albums";
const UPDATED_AT_INDEX_NAME = "updatedAt";
const MAX_ENTRIES = 200;

export const ALBUM_CACHE_TTLS = {
  seriesFreshMs: 60 * 1000,
  seriesStaleMs: 15 * 60 * 1000,
  stableFreshMs: 60 * 60 * 1000,
  stableStaleMs: 24 * 60 * 60 * 1000,
} as const;

export type AlbumCacheFreshness = "fresh" | "stale" | "expired";

type CachedAlbumEntry = {
  albumId: string;
  album: Album;
  photo: PhotoWithScrambleId | null;
  updatedAt: number;
  albumFetchedAt?: number;
  photoFetchedAt?: number | null;
};

export type CachedAlbumResult = {
  album: Album;
  photo: PhotoWithScrambleId | null;
  albumFetchedAt: number;
  photoFetchedAt: number | null;
  albumFreshness: AlbumCacheFreshness;
  photoFreshness: AlbumCacheFreshness;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "albumId" });
      if (!store.indexNames.contains(UPDATED_AT_INDEX_NAME)) {
        store.createIndex(UPDATED_AT_INDEX_NAME, "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (abandoned) {
        database.close();
        return;
      }
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.close();
        dbPromise = null;
        reject(new Error(`Album cache is missing the ${STORE_NAME} object store`));
        return;
      }
      database.onversionchange = () => {
        database.close();
        dbPromise = null;
      };
      resolve(database);
    };
    request.onblocked = () => {
      abandoned = true;
      dbPromise = null;
      reject(new Error("Album cache database upgrade is blocked"));
    };
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

function getFreshness(fetchedAt: number | null, freshMs: number, staleMs: number): AlbumCacheFreshness {
  if (fetchedAt === null) return "expired";
  const age = Math.max(0, Date.now() - fetchedAt);
  if (age < freshMs) return "fresh";
  if (age < staleMs) return "stale";
  return "expired";
}

function toCachedAlbumResult(entry: CachedAlbumEntry): CachedAlbumResult {
  const albumFetchedAt = entry.albumFetchedAt ?? entry.updatedAt;
  const photoFetchedAt = entry.photoFetchedAt === undefined
    ? entry.photo ? entry.updatedAt : null
    : entry.photoFetchedAt;
  const isSeries = Array.isArray(entry.album.series) && entry.album.series.length > 0;
  const albumFreshMs = isSeries ? ALBUM_CACHE_TTLS.seriesFreshMs : ALBUM_CACHE_TTLS.stableFreshMs;
  const albumStaleMs = isSeries ? ALBUM_CACHE_TTLS.seriesStaleMs : ALBUM_CACHE_TTLS.stableStaleMs;
  return {
    album: entry.album,
    photo: entry.photo,
    albumFetchedAt,
    photoFetchedAt,
    albumFreshness: getFreshness(albumFetchedAt, albumFreshMs, albumStaleMs),
    photoFreshness: getFreshness(
      photoFetchedAt,
      ALBUM_CACHE_TTLS.stableFreshMs,
      ALBUM_CACHE_TTLS.stableStaleMs,
    ),
  };
}

export async function getCachedAlbum(albumId: string): Promise<CachedAlbumResult | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(albumId);
      request.onsuccess = () => {
        const entry = request.result as CachedAlbumEntry | undefined;
        if (!entry) return resolve(null);
        const result = toCachedAlbumResult(entry);
        if (result.albumFreshness === "expired" && result.photoFreshness === "expired") {
          const delTx = db.transaction(STORE_NAME, "readwrite");
          delTx.objectStore(STORE_NAME).delete(albumId);
          return resolve(null);
        }
        resolve(result);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getCachedAlbums(
  albumIds: string[],
): Promise<Map<string, CachedAlbumResult>> {
  const result = new Map<string, CachedAlbumResult>();
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
  timestamps?: { albumFetchedAt?: number; photoFetchedAt?: number | null },
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const write = (existing?: CachedAlbumEntry) => {
        const now = Date.now();
        const resolvedPhoto = photo === undefined ? existing?.photo ?? null : photo;
        const entry: CachedAlbumEntry = {
          albumId,
          album,
          photo: resolvedPhoto,
          updatedAt: now,
          albumFetchedAt: timestamps?.albumFetchedAt ?? now,
          photoFetchedAt: photo === undefined
            ? existing?.photoFetchedAt ?? (existing?.photo ? existing.updatedAt : null)
            : resolvedPhoto
              ? timestamps?.photoFetchedAt ?? now
              : null,
        };
        const putRequest = store.put(entry);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };

      if (photo === undefined) {
        const getRequest = store.get(albumId);
        getRequest.onsuccess = () => write(getRequest.result as CachedAlbumEntry | undefined);
        getRequest.onerror = () => reject(getRequest.error);
      } else {
        write();
      }
    });
    await enforceMaxEntries(db);
  } catch {
    // silent fail
  }
}

export async function setCachedAlbums(
  items: Array<{
    albumId: string;
    album: Album;
    photo: PhotoWithScrambleId | null;
    albumFetchedAt?: number;
    photoFetchedAt?: number | null;
  }>,
): Promise<void> {
  await Promise.all(items.map((item) => setCachedAlbum(item.albumId, item.album, item.photo, {
    albumFetchedAt: item.albumFetchedAt,
    photoFetchedAt: item.photoFetchedAt,
  })));
}
