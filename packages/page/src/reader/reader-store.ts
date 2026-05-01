export type ReadingDirection = 'left-right' | 'top-down';
export type BarSide = 'left' | 'right' | 'bottom';

const PROGRESS_PREFIX = 'reading-progress:';
const DIRECTION_KEY = 'reading-direction';
const AUTO_SNAP_KEY = 'reading-auto-snap';
const BAR_SIDE_KEY = 'reading-bar-side';

export type ChapterProgress = {
  albumId: string;
  chapterId: string;
  chapterIndex: number;
  page: number;
  totalPages: number;
  updatedAt: number;
};

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

export function saveBarSide(side: BarSide) {
  localStorage.setItem(BAR_SIDE_KEY, side);
}

export function getBarSide(): BarSide {
  const raw = localStorage.getItem(BAR_SIDE_KEY);
  if (raw === 'left' || raw === 'right' || raw === 'bottom') return raw;
  return 'bottom';
}
