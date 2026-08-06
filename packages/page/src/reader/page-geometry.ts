// Page geometry measurement for the reader scroll container.
//
// Reading offsetTop/offsetLeft/offsetWidth/offsetHeight on every scroll event
// forces synchronous layout. The cache below measures each rendered child once
// and reuses the value across scroll frames. Callers invalidate the cache when
// page sizes can change (image load, direction switch, seamless mode toggle,
// container resize) and lazily re-measure on miss.

export interface PageOffset {
  start: number;
  size: number;
}

export function measurePageOffset(page: HTMLElement, horizontal: boolean): PageOffset {
  return horizontal
    ? { start: page.offsetLeft, size: page.offsetWidth }
    : { start: page.offsetTop, size: page.offsetHeight };
}

// Lazily caches measured offsets per page index.
export class PageOffsetCache {
  private offsets = new Map<number, { element: HTMLElement; offset: PageOffset }>();
  private generation = 0;

  // Reads the cached offset or measures + caches it on miss. Re-measures when
  // the element at an index changed (lazy render swaps children in place).
  get(index: number, page: HTMLElement, horizontal: boolean): PageOffset {
    const cached = this.offsets.get(index);
    if (cached && cached.element === page) return cached.offset;
    const offset = measurePageOffset(page, horizontal);
    this.offsets.set(index, { element: page, offset });
    return offset;
  }

  // Drops all cached offsets; the next read re-measures. Bumps the generation
  // so callers can detect staleness cheaply.
  invalidate() {
    this.offsets.clear();
    this.generation += 1;
  }

  getGeneration(): number {
    return this.generation;
  }

  get count(): number {
    return this.offsets.size;
  }
}

// Returns the indexes of pages that intersect [viewportStart, viewportEnd].
// Unmeasured pages are skipped; callers handle the empty-result fallback.
export function computeVisiblePageIndexes(
  count: number,
  viewportStart: number,
  viewportEnd: number,
  getOffset: (index: number) => PageOffset,
): Set<number> {
  const next = new Set<number>();
  for (let pageIndex = 0; pageIndex < count; pageIndex++) {
    const offset = getOffset(pageIndex);
    const pageEnd = offset.start + offset.size;
    if (pageEnd > viewportStart && offset.start < viewportEnd) next.add(pageIndex);
  }
  return next;
}

// Finds the page whose center is closest to `center`. Returns null when no
// page could be measured yet.
export function findCenterPage(
  count: number,
  center: number,
  getOffset: (index: number) => PageOffset,
): number | null {
  let best = 0;
  let bestDistance = Infinity;
  for (let pageIndex = 0; pageIndex < count; pageIndex++) {
    const offset = getOffset(pageIndex);
    const mid = offset.start + offset.size / 2;
    const distance = Math.abs(center - mid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = pageIndex;
    }
  }
  return bestDistance === Infinity ? null : best;
}

// Finds the page overlapping `center`, falling back to the nearest page start
// or end. Returns null when no page could be measured yet.
export function findPageAtCenter(
  count: number,
  center: number,
  getOffset: (index: number) => PageOffset,
): number | null {
  let best = 0;
  let bestDistance = Infinity;
  for (let pageIndex = 0; pageIndex < count; pageIndex++) {
    const offset = getOffset(pageIndex);
    const start = offset.start;
    const end = offset.start + offset.size;
    const distance = center < start ? start - center : center > end ? center - end : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = pageIndex;
    }
  }
  return bestDistance === Infinity ? null : best;
}
