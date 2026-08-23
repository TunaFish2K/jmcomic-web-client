import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  prepare: vi.fn(),
  clear: vi.fn(),
  phase: vi.fn(),
  createRunner: vi.fn(),
  predict: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../src/translation/ocr-models', () => ({
  prepareOcrModelAssets: state.prepare,
  clearOcrModelCache: state.clear,
  setOcrInitializationPhase: state.phase,
}));
vi.mock('@paddleocr/paddleocr-js', () => ({
  PaddleOCR: { create: state.createRunner },
}));

function assets(usedCache = false) {
  return {
    detectionUrl: 'blob:detection', recognitionUrl: 'blob:recognition',
    ortWasmUrl: 'blob:wasm', ortMjsUrl: '/ort.mjs', usedCache, release: vi.fn(),
  };
}

function ocrResult() {
  return {
    image: { width: 100, height: 200 },
    items: [
      { text: ' 日本語 ', score: 0.9, poly: [[0, 0], [100, 0], [100, 100], [0, 100]] },
      { text: ' ', score: Number.NaN, poly: [[0, 0], [1, 1]] },
    ],
  };
}

describe('OCR runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    state.prepare.mockReset().mockResolvedValue(assets());
    state.clear.mockReset().mockResolvedValue(undefined);
    state.phase.mockReset();
    state.predict.mockReset().mockResolvedValue([ocrResult()]);
    state.dispose.mockReset().mockResolvedValue(undefined);
    state.createRunner.mockReset().mockResolvedValue({ predict: state.predict, dispose: state.dispose });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 200, close: vi.fn() }));
  });

  test('initializes once, recognizes normalized regions, and disposes resources', async () => {
    const ocr = await import('../src/translation/ocr');
    const stages: string[] = [];
    const first = await ocr.recognizeMangaPage(new Blob(['image']), (stage) => stages.push(stage));
    const second = await ocr.recognizeMangaPage(new Blob(['image']));
    assert.deepEqual(stages, ['loading-model', 'recognizing']);
    assert.equal(first.regions.length, 1);
    assert.equal(first.regions[0].text, '日本語');
    assert.deepEqual(first.regions[0].polygon[2], { x: 1, y: 0.5 });
    assert.equal(second.sourceWidth, 100);
    assert.equal(state.createRunner.mock.calls.length, 1);
    await ocr.disposeOcrRuntime();
    assert.equal(state.dispose.mock.calls.length, 1);
    assert.ok(state.phase.mock.calls.some((call) => call[0] === 'idle'));
    await ocr.disposeOcrRuntime();
  });

  test('resizes large images with OffscreenCanvas and closes the original bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3200, height: 1600, close }));
    const drawImage = vi.fn();
    const resized = new Blob(['resized'], { type: 'image/jpeg' });
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage }; }
      async convertToBlob() { return resized; }
    });
    const ocr = await import('../src/translation/ocr');
    await ocr.recognizeMangaPage(new Blob(['large']));
    assert.deepEqual([state.predict.mock.calls[0][0], close.mock.calls.length], [resized, 1]);
    assert.deepEqual(drawImage.mock.calls[0].slice(1), [0, 0, 1600, 800]);
  });

  test('fails cleanly for missing canvas context, missing OCR result, and abort', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3200, height: 1600, close: vi.fn() }));
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
    let ocr = await import('../src/translation/ocr');
    await assert.rejects(ocr.recognizeMangaPage(new Blob(['large'])), /无法创建 OCR 画布/);

    vi.resetModules();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }));
    state.predict.mockResolvedValueOnce([]);
    ocr = await import('../src/translation/ocr');
    await assert.rejects(ocr.recognizeMangaPage(new Blob(['image'])), /没有返回结果/);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(ocr.recognizeMangaPage(new Blob(['image']), undefined, controller.signal), (error: unknown) => (error as { name?: string }).name === 'AbortError');
  });

  test('invalidates cached model assets after runner initialization failure', async () => {
    state.prepare.mockReset().mockResolvedValueOnce(assets(true)).mockResolvedValueOnce(assets(false));
    state.createRunner.mockRejectedValueOnce(new Error('corrupt cache')).mockResolvedValueOnce({ predict: state.predict, dispose: state.dispose });
    const ocr = await import('../src/translation/ocr');
    await ocr.recognizeMangaPage(new Blob(['image']));
    assert.equal(state.clear.mock.calls.length, 1);
    assert.equal(state.createRunner.mock.calls.length, 2);
  });

  test('resets failed runner initialization so a later call can retry', async () => {
    state.createRunner.mockRejectedValueOnce(new Error('startup failed')).mockResolvedValueOnce({ predict: state.predict, dispose: state.dispose });
    const ocr = await import('../src/translation/ocr');
    await assert.rejects(ocr.recognizeMangaPage(new Blob(['image'])), /startup failed/);
    await ocr.recognizeMangaPage(new Blob(['image']));
    assert.equal(state.createRunner.mock.calls.length, 2);
  });
});
