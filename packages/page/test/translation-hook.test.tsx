import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, test, vi } from 'vitest';
import type { PageTranslationRecord, TranslationSettingsV6, TranslationStage } from '../src/translation/types';

const state = vi.hoisted(() => ({
  settings: {
    version: 6,
    apiProtocol: 'chat-completions',
    baseUrl: 'https://api.example.test/v1',
    model: 'comic-model',
    apiKey: 'key',
    useWorkerProxy: false,
    autoTranslate: false,
    pretranslateRange: 1,
    translationConcurrency: 2,
    reasoningMode: 'off',
    reasoningEffort: 'medium',
    smartSkipSoundEffects: true,
    translationStylePrompt: 'style',
    contentHandlingPrompt: 'content',
  } as TranslationSettingsV6,
  cached: vi.fn(),
  translate: vi.fn(),
  clear: vi.fn(),
  progressCallback: null as null | ((value: unknown) => void),
}));

vi.mock('../src/translation/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/translation/settings')>()),
  loadTranslationSettings: () => state.settings,
  saveTranslationSettings: (_storage: Storage, next: TranslationSettingsV6) => next,
}));

vi.mock('../src/translation/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/translation/cache')>()),
  clearTranslationCache: state.clear,
}));

vi.mock('../src/translation/service', () => ({
  getCachedPageTranslation: state.cached,
  translatePage: state.translate,
}));

vi.mock('../src/translation/ocr-models', () => ({
  getOcrInitializationProgress: () => ({ phase: 'idle', loadedBytes: 0, totalBytes: null }),
  subscribeOcrInitializationProgress: (callback: (value: unknown) => void) => {
    state.progressCallback = callback;
    return () => { state.progressCallback = null; };
  },
}));

import { useReaderTranslation } from '../src/translation/useReaderTranslation';

const baseSettings: TranslationSettingsV6 = {
  version: 6,
  apiProtocol: 'chat-completions',
  baseUrl: 'https://api.example.test/v1',
  model: 'comic-model',
  apiKey: 'key',
  useWorkerProxy: false,
  autoTranslate: false,
  pretranslateRange: 1,
  translationConcurrency: 2,
  reasoningMode: 'off',
  reasoningEffort: 'medium',
  smartSkipSoundEffects: true,
  translationStylePrompt: 'style',
  contentHandlingPrompt: 'content',
};

const pages = [
  { imageName: '0.jpg', imageUrl: 'https://cdn.test/0.jpg' },
  { imageName: '1.jpg', loadImageBlob: vi.fn(async () => new Blob(['image'])) },
  { imageName: '2.jpg', imageUrl: 'https://cdn.test/2.jpg' },
];

function makeRecord(overrides: Partial<PageTranslationRecord> = {}): PageTranslationRecord {
  return {
    key: 'record',
    ocrKey: 'ocr',
    pageKey: 'chapter:0.jpg',
    providerKey: 'provider',
    promptKey: 'prompt',
    promptVersion: 'v1',
    sourceWidth: 100,
    sourceHeight: 200,
    pageStatus: 'needs_translation',
    sourceRegionCount: 1,
    skippedRegionCount: 0,
    regions: [{
      id: 'r1', text: '日本語', translation: '中文', score: 0.9,
      polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    }],
    updatedAt: 1,
    lastAccessedAt: 1,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
  });
}

describe('useReaderTranslation', () => {
  beforeEach(() => {
    state.settings = { ...baseSettings };
    state.cached.mockReset().mockResolvedValue(null);
    state.translate.mockReset().mockImplementation(async ({ onStage }: { onStage: (stage: TranslationStage) => void }) => {
      onStage('recognizing');
      onStage('translating');
      return makeRecord();
    });
    state.clear.mockReset().mockResolvedValue(undefined);
    state.progressCallback = null;
  });

  test('loads cache and exposes dialog, visibility, settings, cache, and missing-page controls', async () => {
    const cached = makeRecord();
    state.cached.mockResolvedValue(cached);
    const hook = renderHook((props: { chapterId?: string; currentPage: number }) => useReaderTranslation({
      chapterId: props.chapterId,
      currentPage: props.currentPage,
      pages,
    }), { initialProps: { chapterId: 'chapter', currentPage: 0 } });
    await waitFor(() => assert.equal(hook.result.current.currentRecord, cached));
    act(() => hook.result.current.toggleVisible());
    assert.equal(hook.result.current.visible, false);
    act(() => hook.result.current.openDialog());
    assert.equal(hook.result.current.dialogOpen, true);
    act(() => hook.result.current.closeDialog());
    act(() => hook.result.current.dismissNotice());

    const enabled = { ...state.settings, autoTranslate: true };
    act(() => hook.result.current.saveSettings(enabled));
    assert.equal(hook.result.current.settings.autoTranslate, true);
    assert.equal(hook.result.current.autoActive, true);
    await act(async () => hook.result.current.clearCache());
    assert.equal(hook.result.current.notice?.message, '翻译缓存已清除');
    assert.equal(hook.result.current.currentRecord, null);

    hook.rerender({ chapterId: undefined, currentPage: 0 });
    act(() => hook.result.current.translateCurrent());
    assert.equal(hook.result.current.notice?.message, '当前页图片仍在加载，请稍后重试');
    hook.unmount();
    assert.equal(state.progressCallback, null);
  });

  test('opens configuration when missing credentials and ignores auto toggle when disabled', () => {
    state.settings = { ...state.settings, baseUrl: '', model: '', apiKey: '', autoTranslate: false };
    const hook = renderHook(() => useReaderTranslation({ chapterId: 'chapter', currentPage: 0, pages }));
    assert.equal(hook.result.current.configured, false);
    act(() => hook.result.current.toggleAutoTranslation());
    assert.equal(hook.result.current.autoActive, false);
    act(() => hook.result.current.translateCurrent());
    assert.equal(hook.result.current.dialogOpen, true);
  });

  test('runs manual translation, publishes stages, and reports empty and Chinese pages', async () => {
    const outputs = [
      makeRecord({ regions: [], skippedRegionCount: 0 }),
      makeRecord({ regions: [], skippedRegionCount: 2 }),
      makeRecord({ pageStatus: 'already_chinese', regions: [] }),
    ];
    state.translate.mockImplementation(async ({ onStage }: { onStage: (stage: TranslationStage) => void }) => {
      onStage('recognizing');
      state.progressCallback?.({ phase: 'downloading', loadedBytes: 5, totalBytes: 10 });
      onStage('translating');
      return outputs.shift()!;
    });
    const hook = renderHook(() => useReaderTranslation({ chapterId: 'chapter', currentPage: 0, pages }));

    act(() => hook.result.current.translateCurrent());
    await flush();
    assert.equal(hook.result.current.notice?.message, '本页未识别到日文文本');
    act(() => hook.result.current.retranslateCurrent());
    await flush();
    assert.equal(hook.result.current.notice?.message, '本页没有需要覆盖的文本');
    act(() => hook.result.current.retranslateCurrent());
    await flush();
    assert.equal(hook.result.current.notice?.message, '本页主要为中文，已跳过');
    assert.equal(hook.result.current.visible, true);
    assert.equal(state.translate.mock.calls.at(-1)?.[0].forceTranslation, true);
  });

  test('reports Error and unknown failures and allows retry', async () => {
    state.translate.mockRejectedValueOnce(new Error('provider failed')).mockRejectedValueOnce('bad');
    const hook = renderHook(() => useReaderTranslation({ chapterId: 'chapter', currentPage: 0, pages }));
    act(() => hook.result.current.translateCurrent());
    await flush();
    assert.equal(hook.result.current.notice?.message, 'provider failed');
    act(() => hook.result.current.translateCurrent());
    await flush();
    assert.equal(hook.result.current.notice?.message, '翻译失败，请重试');
  });

  test('runs an automatic window, cancels the current job, pauses and resumes the session', async () => {
    state.settings = { ...state.settings, autoTranslate: true, pretranslateRange: 1, translationConcurrency: 2 };
    const resolvers: Array<(record: PageTranslationRecord) => void> = [];
    state.translate.mockImplementation(({ onStage, signal }: { onStage: (stage: TranslationStage) => void; signal: AbortSignal }) => {
      onStage('loading-model');
      return new Promise<PageTranslationRecord>((resolve, reject) => {
        resolvers.push(resolve);
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    });
    const hook = renderHook((currentPage: number) => useReaderTranslation({ chapterId: 'chapter', currentPage, pages }), { initialProps: 1 });
    await waitFor(() => assert.equal(hook.result.current.busy, true));
    assert.equal(state.translate.mock.calls.length, 2);
    assert.equal(hook.result.current.currentPageBusy, true);
    state.progressCallback?.({ phase: 'downloading', loadedBytes: 10, totalBytes: 20 });
    await flush();
    assert.equal(hook.result.current.task?.ocrInitialization?.loadedBytes, 10);

    act(() => hook.result.current.cancelCurrentTranslation());
    await flush();
    act(() => hook.result.current.toggleAutoTranslation());
    assert.equal(hook.result.current.autoActive, false);
    act(() => hook.result.current.toggleAutoTranslation());
    assert.equal(hook.result.current.autoActive, true);
    hook.rerender(2);
    await flush();
    for (const resolve of resolvers) resolve(makeRecord());
    await flush();
    hook.unmount();
  });

  test('prioritizes a manual request when automatic concurrency is full', async () => {
    state.settings = { ...state.settings, autoTranslate: true, pretranslateRange: 1, translationConcurrency: 1 };
    state.translate.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise<PageTranslationRecord>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const hook = renderHook(() => useReaderTranslation({ chapterId: 'chapter', currentPage: 1, pages }));
    await waitFor(() => assert.equal(state.translate.mock.calls.length, 1));
    act(() => hook.result.current.retranslateCurrent());
    await flush();
    assert.ok(state.translate.mock.calls.length >= 2);
    hook.unmount();
  });
});
