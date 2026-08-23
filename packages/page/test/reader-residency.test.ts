import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  evictResidentPageUrls,
  estimateResidentImageBytes,
  selectResidentPages,
} from '../src/reader/residency';

const MiB = 1024 * 1024;

describe('reader resident image budget', () => {
  it('keeps a 300-page unknown chapter within the 192 MiB budget', () => {
    const selection = selectResidentPages({
      pageCount: 300,
      currentPage: 150,
      visiblePages: [150],
      pinnedPages: [],
      prefetchRange: 12,
      costs: new Map(),
    });

    assert.deepEqual(selection.pages, [150, 151, 149, 152]);
    assert.equal(selection.estimatedBytes, 192 * MiB);
  });

  it('uses known decoded costs and preserves next-page priority', () => {
    const costs = new Map(Array.from({ length: 300 }, (_, index) => [index, 20 * MiB]));
    const selection = selectResidentPages({
      pageCount: 300,
      currentPage: 100,
      visiblePages: [],
      pinnedPages: [],
      prefetchRange: 12,
      costs,
    });

    assert.deepEqual(selection.pages, [100, 101, 99, 102, 98, 103, 97, 104, 96]);
    assert.equal(selection.estimatedBytes, 180 * MiB);
  });

  it('never evicts visible or zoom-pinned pages when required pages exceed budget', () => {
    const selection = selectResidentPages({
      pageCount: 180,
      currentPage: 80,
      visiblePages: [79, 80, 81],
      pinnedPages: [40, 120],
      prefetchRange: 12,
      costs: new Map(),
      budgetBytes: 96 * MiB,
    });

    assert.deepEqual(selection.pages, [80, 79, 81, 40, 120]);
    assert.equal(selection.estimatedBytes, 240 * MiB);
  });

  it('rebuilds the window around a large page jump', () => {
    const selection = selectResidentPages({
      pageCount: 250,
      currentPage: 230,
      visiblePages: [230],
      pinnedPages: [],
      prefetchRange: 2,
      costs: new Map([[230, 10 * MiB], [231, 10 * MiB], [229, 10 * MiB], [232, 10 * MiB], [228, 10 * MiB]]),
    });

    assert.deepEqual(selection.pages, [230, 231, 229, 232, 228]);
  });

  it('accounts for the JPEG, decoded RGBA surface, and likely GPU copy', () => {
    assert.equal(estimateResidentImageBytes(1000, 2000, 3 * MiB), 3 * MiB + 16_000_000);
  });

  it('revokes an evicted Blob URL exactly once', () => {
    const revoked: string[] = [];
    const first = evictResidentPageUrls(
      new Map([[10, 'blob:10'], [11, 'blob:11']]),
      new Set([11]),
      (url) => revoked.push(url),
    );
    const second = evictResidentPageUrls(first, new Set([11]), (url) => revoked.push(url));

    assert.deepEqual([...second], [[11, 'blob:11']]);
    assert.deepEqual(revoked, ['blob:10']);
  });
});
