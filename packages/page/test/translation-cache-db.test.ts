import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { beforeEach, describe, test } from 'vitest';
import {
  clearTranslationCache,
  deleteCachedTranslation,
  getCachedOcrResult,
  getCachedTranslation,
  getTranslationCacheStats,
  setCachedOcrResult,
  setCachedTranslation,
} from '../src/translation/cache';
import type { OcrPageResult, PageTranslationRecord } from '../src/translation/types';

const ocr: OcrPageResult = {
  modelVersion: 'model',
  preprocessVersion: 'preprocess',
  sourceWidth: 100,
  sourceHeight: 200,
  regions: [],
};

function record(key: string): PageTranslationRecord {
  return {
    key,
    ocrKey: 'ocr-key',
    pageKey: 'chapter/page.jpg',
    providerKey: 'provider',
    promptKey: 'prompt',
    promptVersion: 'v1',
    sourceWidth: 100,
    sourceHeight: 200,
    pageStatus: 'needs_translation',
    sourceRegionCount: 0,
    skippedRegionCount: 0,
    regions: [],
    updatedAt: 1,
    lastAccessedAt: 1,
  };
}

describe('translation IndexedDB cache', () => {
  beforeEach(async () => {
    await clearTranslationCache();
  });

  test('stores, reads, counts, deletes, and clears OCR and translations', async () => {
    assert.equal(await getCachedOcrResult('missing'), null);
    assert.equal(await getCachedTranslation('missing'), null);
    await setCachedOcrResult('ocr-key', 'chapter/page.jpg', ocr);
    await setCachedTranslation(record('translation-key'));
    assert.deepEqual(await getCachedOcrResult('ocr-key'), ocr);
    const cached = await getCachedTranslation('translation-key');
    assert.equal(cached?.key, 'translation-key');
    assert.ok((cached?.lastAccessedAt ?? 0) > 1);
    assert.deepEqual(await getTranslationCacheStats(), { ocrPages: 1, translatedPages: 1 });

    await deleteCachedTranslation('translation-key');
    assert.equal(await getCachedTranslation('translation-key'), null);
    await setCachedTranslation(record('second'));
    await clearTranslationCache();
    assert.deepEqual(await getTranslationCacheStats(), { ocrPages: 0, translatedPages: 0 });
  });

  test('prunes the oldest translation records beyond the cache limit', async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jm-translation-cache', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('translations', 'readwrite');
      const store = transaction.objectStore('translations');
      for (let index = 0; index < 501; index++) {
        store.put({ ...record(`seed-${index}`), lastAccessedAt: index });
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    await setCachedTranslation(record('trigger'));
    const stats = await getTranslationCacheStats();
    assert.ok(stats.translatedPages <= 500);
    assert.equal(await getCachedTranslation('seed-0'), null);
    assert.equal((await getCachedTranslation('trigger'))?.key, 'trigger');
    database.close();
  });
});
