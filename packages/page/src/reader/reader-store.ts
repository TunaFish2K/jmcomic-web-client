import type { Album } from '@tiny-client/shared';

export type ReadingDirection = 'left-right' | 'top-down';
export type BarSide = 'left' | 'right' | 'bottom';

const PROGRESS_PREFIX = 'reading-progress:';
const DIRECTION_KEY = 'reading-direction';
const AUTO_SNAP_KEY = 'reading-auto-snap';
const BAR_SIDE_KEY = 'reading-bar-side';
const SEAMLESS_MODE_KEY = 'reading-seamless-mode';
const LAZY_RENDER_RANGE_KEY = 'reading-lazy-render-range';
const ALBUM_CACHE_PREFIX = 'reader-album-cache:';
const ALBUM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ALBUM_CACHE_MAX_ENTRIES = 100;
const DEFAULT_LAZY_RENDER_RANGE = 4;

export type ChapterProgress = {
  albumId: string;
  chapterId: string;
  chapterIndex: number;
  page: number;
  totalPages: number;
  updatedAt: number;
};

type CachedAlbum = {
  album: Album;
  updatedAt: number;
};

function listAlbumCacheKeys() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(ALBUM_CACHE_PREFIX)) keys.push(key);
  }
  return keys;
}

export function cleanupAlbumCache() {
  const now = Date.now();
  const entries: Array<{ key: string; updatedAt: number }> = [];

  for (const key of listAlbumCacheKeys()) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as Partial<CachedAlbum>;
      if (!parsed.album || typeof parsed.updatedAt !== 'number' || now - parsed.updatedAt > ALBUM_CACHE_TTL_MS) {
        localStorage.removeItem(key);
        continue;
      }
      entries.push({ key, updatedAt: parsed.updatedAt });
    } catch {
      localStorage.removeItem(key);
    }
  }

  if (entries.length <= ALBUM_CACHE_MAX_ENTRIES) return;

  entries
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, entries.length - ALBUM_CACHE_MAX_ENTRIES)
    .forEach(({ key }) => localStorage.removeItem(key));
}

export function saveAlbumCache(albumId: string, album: Album) {
  cleanupAlbumCache();
  localStorage.setItem(
    `${ALBUM_CACHE_PREFIX}${albumId}`,
    JSON.stringify({ album, updatedAt: Date.now() } satisfies CachedAlbum),
  );
}

export function getAlbumCache(albumId: string): Album | null {
  cleanupAlbumCache();
  const raw = localStorage.getItem(`${ALBUM_CACHE_PREFIX}${albumId}`);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CachedAlbum>;
    if (!parsed.album || typeof parsed.updatedAt !== 'number') {
      localStorage.removeItem(`${ALBUM_CACHE_PREFIX}${albumId}`);
      return null;
    }
    return parsed.album;
  } catch {
    localStorage.removeItem(`${ALBUM_CACHE_PREFIX}${albumId}`);
    return null;
  }
}

export function saveReadingProgress(progress: ChapterProgress) {
  localStorage.setItem(
    `${PROGRESS_PREFIX}${progress.albumId}:${progress.chapterId}`,
    JSON.stringify(progress),
  );
}

export function getReadingProgress(albumId: string, chapterId: string): ChapterProgress | null {
  const raw = localStorage.getItem(`${PROGRESS_PREFIX}${albumId}:${chapterId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChapterProgress;
  } catch {
    return null;
  }
}

export function getLatestChapterProgress(albumId: string, chapterIds: string[]): ChapterProgress | null {
  let latest: ChapterProgress | null = null;
  for (const id of chapterIds) {
    const p = getReadingProgress(albumId, id);
    if (p && (!latest || p.updatedAt > latest.updatedAt)) {
      latest = p;
    }
  }
  return latest;
}

export function saveReadingDirection(direction: ReadingDirection) {
  localStorage.setItem(DIRECTION_KEY, direction);
}

export function getReadingDirection(): ReadingDirection {
  const raw = localStorage.getItem(DIRECTION_KEY);
  if (raw === 'left-right' || raw === 'top-down') return raw;
  return 'left-right';
}

export function saveAutoSnap(enabled: boolean) {
  localStorage.setItem(AUTO_SNAP_KEY, enabled ? '1' : '0');
}

export function getAutoSnap(): boolean {
  return localStorage.getItem(AUTO_SNAP_KEY) !== '0';
}

export function saveSeamlessMode(enabled: boolean) {
  localStorage.setItem(SEAMLESS_MODE_KEY, enabled ? '1' : '0');
}

export function getSeamlessMode(): boolean {
  return localStorage.getItem(SEAMLESS_MODE_KEY) === '1';
}

export function saveLazyRenderRange(value: number) {
  const normalized = Math.max(1, Math.min(12, Math.round(value)));
  localStorage.setItem(LAZY_RENDER_RANGE_KEY, String(normalized));
}

export function getLazyRenderRange(): number {
  const raw = Number.parseInt(localStorage.getItem(LAZY_RENDER_RANGE_KEY) ?? '', 10);
  if (Number.isFinite(raw)) return Math.max(1, Math.min(12, raw));
  return DEFAULT_LAZY_RENDER_RANGE;
}

export function saveBarSide(side: BarSide) {
  localStorage.setItem(BAR_SIDE_KEY, side);
}

export function getBarSide(): BarSide {
  const raw = localStorage.getItem(BAR_SIDE_KEY);
  if (raw === 'left' || raw === 'right' || raw === 'bottom') return raw;
  return 'bottom';
}
