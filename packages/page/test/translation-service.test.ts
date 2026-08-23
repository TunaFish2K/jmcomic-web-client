import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import type { OcrPageResult, PageTranslationRecord, TranslationSettingsV6 } from '../src/translation/types';

const state = vi.hoisted(() => ({
  getOcr: vi.fn(),
  getTranslation: vi.fn(),
  setOcr: vi.fn(),
  setTranslation: vi.fn(),
  recognize: vi.fn(),
  translate: vi.fn(),
  serialized: vi.fn(),
}));

vi.mock('../src/translation/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/translation/cache')>()),
  getCachedOcrResult: state.getOcr,
  getCachedTranslation: state.getTranslation,
  setCachedOcrResult: state.setOcr,
  setCachedTranslation: state.setTranslation,
}));
vi.mock('../src/translation/ocr', () => ({ recognizeMangaPage: state.recognize }));
vi.mock('../src/translation/llm', () => ({ translateOcrRegions: state.translate }));
vi.mock('../src/translation/scheduler', () => ({ runSerializedOcr: state.serialized }));

import { getCachedPageTranslation, loadTranslationImageBlob, translatePage } from '../src/translation/service';

const settings: TranslationSettingsV6 = {
  version: 6,
  apiProtocol: 'chat-completions',
  baseUrl: 'https://api.test/v1',
  model: 'model',
  apiKey: 'key',
  useWorkerProxy: false,
  autoTranslate: false,
  pretranslateRange: 1,
  translationConcurrency: 1,
  reasoningMode: 'off',
  reasoningEffort: 'medium',
  smartSkipSoundEffects: true,
  translationStylePrompt: 'style',
  contentHandlingPrompt: 'content',
};
const ocr: OcrPageResult = {
  modelVersion: 'ppocr-v5-mobile-ja@1',
  preprocessVersion: 'max-1600@1',
  sourceWidth: 100,
  sourceHeight: 200,
  regions: [
    { id: 'r1', text: '日本語', score: 0.9, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    { id: 'r2', text: '音', score: 0.8, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
  ],
};
const cachedRecord = { key: 'cached' } as PageTranslationRecord;

describe('translation service', () => {
  beforeEach(() => {
    state.getOcr.mockReset().mockResolvedValue(ocr);
    state.getTranslation.mockReset().mockResolvedValue(null);
    state.setOcr.mockReset().mockResolvedValue(undefined);
    state.setTranslation.mockReset().mockResolvedValue(undefined);
    state.recognize.mockReset().mockResolvedValue(ocr);
    state.translate.mockReset().mockResolvedValue({
      pageStatus: 'mixed',
      decisions: new Map([
        ['r1', { action: 'translate', translation: '中文' }],
        ['r2', { action: 'skip', reason: 'sound_effect' }],
      ]),
    });
    state.serialized.mockReset().mockImplementation(async (callback: () => Promise<unknown>) => callback());
  });

  test('loads images from URL or callback and reports all error paths', async () => {
    const signal = new AbortController().signal;
    const blob = await loadTranslationImageBlob({
      imageUrl: 'https://cdn.test/page.jpg', signal,
      fetchImpl: vi.fn().mockResolvedValue(new Response(new Blob(['image']), { status: 200 })),
    });
    assert.ok(blob.size > 0);
    const callback = vi.fn().mockResolvedValue(new Blob(['callback']));
    assert.equal((await loadTranslationImageBlob({ loadImageBlob: callback, signal })).size, 8);
    await assert.rejects(loadTranslationImageBlob({
      imageUrl: 'bad', signal,
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    }), /HTTP 503/);
    await assert.rejects(loadTranslationImageBlob({ signal }), /图片仍在加载/);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(loadTranslationImageBlob({ signal: aborted.signal }), (error: unknown) => (error as { name?: string }).name === 'AbortError');
  });

  test('looks up cached page translations only after OCR exists', async () => {
    state.getOcr.mockResolvedValueOnce(null);
    assert.equal(await getCachedPageTranslation({ chapterId: 'c', imageName: 'p.jpg', settings }), null);
    state.getTranslation.mockResolvedValueOnce(cachedRecord);
    assert.equal(await getCachedPageTranslation({ chapterId: 'c', imageName: 'p.jpg', settings }), cachedRecord);
  });

  test('returns a cached translation and bypasses it for force translation', async () => {
    state.getTranslation.mockResolvedValueOnce(cachedRecord);
    assert.equal(await translatePage({ chapterId: 'c', imageName: 'p.jpg', settings }), cachedRecord);
    assert.equal(state.translate.mock.calls.length, 0);

    const stages: string[] = [];
    const result = await translatePage({
      chapterId: 'c', imageName: 'p.jpg', settings, forceTranslation: true,
      onStage: (stage) => stages.push(stage),
    });
    assert.deepEqual(stages, ['translating']);
    assert.equal(result.pageStatus, 'mixed');
    assert.equal(result.sourceRegionCount, 2);
    assert.equal(result.skippedRegionCount, 1);
    assert.deepEqual(result.regions.map((region) => region.translation), ['中文']);
    assert.equal(state.setTranslation.mock.calls[0][0], result);
  });

  test('serializes OCR, rechecks cache, recognizes once, and stores OCR', async () => {
    state.getOcr.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Blob(['image']), { status: 200 }));
    await translatePage({ chapterId: 'c', imageName: 'p.jpg', imageUrl: 'page', settings, fetchImpl });
    assert.equal(state.serialized.mock.calls.length, 1);
    assert.equal(state.recognize.mock.calls.length, 1);
    assert.equal(state.setOcr.mock.calls.length, 1);

    state.getOcr.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(ocr);
    await translatePage({ chapterId: 'c', imageName: 'other.jpg', imageUrl: 'other', settings, fetchImpl });
    assert.equal(state.recognize.mock.calls.length, 1);
  });

  test('honors abort signals before and after asynchronous work', async () => {
    const before = new AbortController();
    before.abort();
    await assert.rejects(translatePage({ chapterId: 'c', imageName: 'p.jpg', settings, signal: before.signal }), (error: unknown) => (error as { name?: string }).name === 'AbortError');

    const during = new AbortController();
    state.getTranslation.mockImplementationOnce(async () => {
      during.abort();
      return cachedRecord;
    });
    await assert.rejects(translatePage({ chapterId: 'c', imageName: 'p.jpg', settings, signal: during.signal }), (error: unknown) => (error as { name?: string }).name === 'AbortError');
  });
});
