import type { CSSProperties } from 'react';
import type { ReadingDirection } from './reader-store';

export function getReaderAnchorRatio(viewportCenter: number, pageStart: number, pageSize: number) {
  return Math.max(0, Math.min(1, (viewportCenter - pageStart) / Math.max(pageSize, 1)));
}

export function getReaderAnchorScrollPosition({
  pageStart,
  pageSize,
  offsetRatio,
  viewportSize,
  maxScroll,
}: {
  pageStart: number;
  pageSize: number;
  offsetRatio: number;
  viewportSize: number;
  maxScroll: number;
}) {
  const position = pageStart + pageSize * offsetRatio - viewportSize / 2;
  return Math.max(0, Math.min(maxScroll, position));
}

export function getReaderInteractionPolicy({
  autoSnap,
  seamlessMode,
  isZoomed,
}: {
  autoSnap: boolean;
  seamlessMode: boolean;
  isZoomed: boolean;
}) {
  return {
    snapEnabled: autoSnap && !isZoomed,
    zoomTarget: seamlessMode && !autoSnap ? 'visible-pages' : 'single-image',
  } as const;
}

export function getReaderPageStyle({
  direction,
  seamlessMode,
  aspectRatio,
  snapEnabled,
}: {
  direction: ReadingDirection;
  seamlessMode: boolean;
  aspectRatio?: number;
  snapEnabled: boolean;
}): CSSProperties {
  const snapStyle: CSSProperties = {
    scrollSnapAlign: snapEnabled ? 'start' : undefined,
    scrollSnapStop: snapEnabled ? 'always' : undefined,
  };

  if (direction === 'left-right') {
    if (seamlessMode) {
      return {
        flex: aspectRatio ? '0 0 auto' : '0 0 100%',
        width: aspectRatio ? 'auto' : '100%',
        height: '100%',
        aspectRatio,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...snapStyle,
      };
    }
    return {
      flex: '0 0 100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...snapStyle,
    };
  }

  if (seamlessMode) {
    return {
      flex: aspectRatio ? '0 0 auto' : '0 0 100%',
      width: '100%',
      height: aspectRatio ? 'auto' : '100%',
      aspectRatio,
      display: 'block',
      ...snapStyle,
    };
  }
  return {
    flex: aspectRatio ? '0 0 auto' : '0 0 100%',
    width: '100%',
    height: aspectRatio ? 'auto' : '100%',
    aspectRatio,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...snapStyle,
  };
}
