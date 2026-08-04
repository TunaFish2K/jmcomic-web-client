export const READER_RESIDENT_BUDGET_BYTES = 192 * 1024 * 1024;
export const UNKNOWN_PAGE_COST_BYTES = 48 * 1024 * 1024;

export interface ResidentPageSelection {
  pages: number[];
  estimatedBytes: number;
}

export function estimateResidentImageBytes(width: number, height: number, jpegBytes: number) {
  return jpegBytes + width * height * 8;
}

export function evictResidentPageUrls(
  residentUrls: Map<number, string>,
  desiredPages: ReadonlySet<number>,
  revoke: (url: string) => void,
) {
  let updated: Map<number, string> | null = null;
  for (const [pageIndex, url] of residentUrls) {
    if (desiredPages.has(pageIndex)) continue;
    if (!updated) updated = new Map(residentUrls);
    updated.delete(pageIndex);
    revoke(url);
  }
  return updated ?? residentUrls;
}

export function selectResidentPages({
  pageCount,
  currentPage,
  visiblePages,
  pinnedPages,
  prefetchRange,
  costs,
  budgetBytes = READER_RESIDENT_BUDGET_BYTES,
  unknownPageCostBytes = UNKNOWN_PAGE_COST_BYTES,
}: {
  pageCount: number;
  currentPage: number;
  visiblePages: Iterable<number>;
  pinnedPages: Iterable<number>;
  prefetchRange: number;
  costs: ReadonlyMap<number, number>;
  budgetBytes?: number;
  unknownPageCostBytes?: number;
}): ResidentPageSelection {
  if (pageCount <= 0) return { pages: [], estimatedBytes: 0 };

  const clampedCurrent = Math.max(0, Math.min(pageCount - 1, currentPage));
  const selected = new Set<number>();
  let estimatedBytes = 0;
  const add = (page: number) => {
    if (page < 0 || page >= pageCount || selected.has(page)) return;
    selected.add(page);
    estimatedBytes += costs.get(page) ?? unknownPageCostBytes;
  };

  add(clampedCurrent);
  for (const page of visiblePages) add(page);
  for (const page of pinnedPages) add(page);

  for (let distance = 1; distance <= prefetchRange; distance++) {
    for (const page of [clampedCurrent + distance, clampedCurrent - distance]) {
      if (page < 0 || page >= pageCount || selected.has(page)) continue;
      const cost = costs.get(page) ?? unknownPageCostBytes;
      if (estimatedBytes + cost > budgetBytes) continue;
      add(page);
    }
  }

  return { pages: [...selected], estimatedBytes };
}
