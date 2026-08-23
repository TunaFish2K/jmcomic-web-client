import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';
import {
  cleanupAlbumCache,
  getAutoSnap,
  getAlbumMeta,
  getBarSide,
  getLatestChapterProgress,
  getLazyRenderRange,
  getReadingDirection,
  getReadingProgress,
  getSeamlessMode,
  saveAlbumMeta,
  saveAutoSnap,
  saveBarSide,
  saveLazyRenderRange,
  saveReadingDirection,
  saveReadingProgress,
  saveSeamlessMode,
} from '../src/reader/reader-store';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

describe('reader setting storage', () => {
  beforeEach(() => localStorage.clear());

  it('does not change auto snap when seamless mode is disabled', () => {
    saveAutoSnap(true);
    saveSeamlessMode(true);
    saveSeamlessMode(false);

    assert.equal(getAutoSnap(), true);
    assert.equal(getSeamlessMode(), false);
  });

  it('does not change seamless mode when auto snap is toggled', () => {
    saveSeamlessMode(true);
    saveAutoSnap(false);

    assert.equal(getSeamlessMode(), true);
    assert.equal(getAutoSnap(), false);
  });

  it('uses defaults and persists every reader display setting', () => {
    assert.equal(getReadingDirection(), 'left-right');
    assert.equal(getAutoSnap(), true);
    assert.equal(getSeamlessMode(), false);
    assert.equal(getLazyRenderRange(), 4);
    assert.equal(getBarSide(), 'bottom');

    for (const direction of ['left-right', 'top-down'] as const) {
      saveReadingDirection(direction);
      assert.equal(getReadingDirection(), direction);
    }
    localStorage.setItem('reading-direction', 'diagonal');
    assert.equal(getReadingDirection(), 'left-right');

    saveAutoSnap(true);
    assert.equal(getAutoSnap(), true);
    saveSeamlessMode(true);
    assert.equal(getSeamlessMode(), true);

    saveLazyRenderRange(-20);
    assert.equal(getLazyRenderRange(), 1);
    saveLazyRenderRange(99);
    assert.equal(getLazyRenderRange(), 12);
    saveLazyRenderRange(5.6);
    assert.equal(getLazyRenderRange(), 6);
    localStorage.setItem('reading-lazy-render-range', '0');
    assert.equal(getLazyRenderRange(), 1);
    localStorage.setItem('reading-lazy-render-range', '99');
    assert.equal(getLazyRenderRange(), 12);

    for (const side of ['left', 'right', 'bottom'] as const) {
      saveBarSide(side);
      assert.equal(getBarSide(), side);
    }
    localStorage.setItem('reading-bar-side', 'top');
    assert.equal(getBarSide(), 'bottom');
  });

  it('stores progress and selects the most recently updated chapter', () => {
    const first = { albumId: 'series', chapterId: '1', chapterIndex: 0, page: 4, totalPages: 10, updatedAt: 10 };
    const second = { albumId: 'series', chapterId: '2', chapterIndex: 1, page: 2, totalPages: 8, updatedAt: 20 };
    saveReadingProgress(first);
    saveReadingProgress(second);
    assert.deepEqual(getReadingProgress('series', '1'), first);
    assert.equal(getReadingProgress('series', 'missing'), null);
    assert.deepEqual(getLatestChapterProgress('series', ['missing', '1', '2']), second);
    assert.equal(getLatestChapterProgress('other', ['1']), null);
    localStorage.setItem('reading-progress:series:broken', '{bad');
    assert.equal(getReadingProgress('series', 'broken'), null);
  });

  it('stores valid album metadata and removes malformed or expired entries', () => {
    const now = 1_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      const album = { id: '1', name: 'One' } as never;
      saveAlbumMeta('1', album);
      assert.deepEqual(getAlbumMeta('1'), album);
      assert.equal(getAlbumMeta('missing'), null);

      localStorage.setItem('reader-album-cache:bad-json', '{bad');
      localStorage.setItem('reader-album-cache:no-album', JSON.stringify({ updatedAt: now }));
      localStorage.setItem('reader-album-cache:no-time', JSON.stringify({ album }));
      localStorage.setItem('reader-album-cache:expired', JSON.stringify({ album, updatedAt: now - 7 * 60 * 60 * 1000 }));
      localStorage.setItem('unrelated', 'keep');
      cleanupAlbumCache();
      assert.equal(localStorage.getItem('reader-album-cache:bad-json'), null);
      assert.equal(localStorage.getItem('reader-album-cache:no-album'), null);
      assert.equal(localStorage.getItem('reader-album-cache:no-time'), null);
      assert.equal(localStorage.getItem('reader-album-cache:expired'), null);
      assert.equal(localStorage.getItem('unrelated'), 'keep');

      localStorage.setItem('reader-album-cache:invalid-meta', JSON.stringify({ album: null, updatedAt: now }));
      assert.equal(getAlbumMeta('invalid-meta'), null);
      localStorage.setItem('reader-album-cache:invalid-time', JSON.stringify({ album, updatedAt: 'now' }));
      assert.equal(getAlbumMeta('invalid-time'), null);
      localStorage.setItem('reader-album-cache:invalid-json', '{');
      assert.equal(getAlbumMeta('invalid-json'), null);
    } finally {
      Date.now = originalNow;
    }
  });

  it('keeps only the newest one hundred album metadata entries', () => {
    const now = 2_000_000_000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      for (let index = 0; index < 102; index++) {
        localStorage.setItem(`reader-album-cache:${index}`, JSON.stringify({
          album: { id: String(index), name: String(index) },
          updatedAt: now - 102 + index,
        }));
      }
      cleanupAlbumCache();
      assert.equal(localStorage.getItem('reader-album-cache:0'), null);
      assert.equal(localStorage.getItem('reader-album-cache:1'), null);
      assert.notEqual(localStorage.getItem('reader-album-cache:2'), null);
      assert.equal([...Array(localStorage.length).keys()]
        .map((index) => localStorage.key(index))
        .filter((key) => key?.startsWith('reader-album-cache:')).length, 100);
    } finally {
      Date.now = originalNow;
    }
  });
});
