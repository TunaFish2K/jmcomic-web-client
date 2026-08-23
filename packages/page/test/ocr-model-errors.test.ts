// @vitest-environment node

import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, test, vi } from 'vitest';
import {
  clearOcrModelCache,
  getOcrInitializationProgress,
  prepareOcrModelAssets,
  setOcrInitializationPhase,
  subscribeOcrInitializationProgress,
} from '../src/translation/ocr-models';
import { ORT_WASM_GZIP_ASSET_PATH } from '../src/translation/ort-assets';

const minimalWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
const compressedWasm = gzipSync(minimalWasm);

afterEach(() => vi.unstubAllGlobals());

describe('OCR model error handling', () => {
  test('publishes explicit phases and clears both cache namespaces', async () => {
    const observed: string[] = [];
    const unsubscribe = subscribeOcrInitializationProgress((progress) => observed.push(progress.phase));
    setOcrInitializationPhase('initializing');
    assert.equal(getOcrInitializationProgress().phase, 'initializing');
    assert.equal(observed.at(-1), 'initializing');
    unsubscribe();

    await clearOcrModelCache(null);
    const deleteCache = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('locked'));
    await clearOcrModelCache({ delete: deleteCache } as unknown as CacheStorage);
    assert.equal(deleteCache.mock.calls.length, 2);
  });

  test('reports unsupported decompression and resets initialization progress', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    await assert.rejects(prepareOcrModelAssets({
      fetchImpl: async (input) => new Response(
        String(input).endsWith(ORT_WASM_GZIP_ASSET_PATH) ? compressedWasm : new Uint8Array([1, 2]),
      ),
      createObjectURL: () => 'blob:model',
      revokeObjectURL: vi.fn(),
    }), /不支持 OCR Runtime 解压/);
    assert.equal(getOcrInitializationProgress().phase, 'idle');
  });

  test('revokes partial object URLs when URL creation fails', async () => {
    const revoked: string[] = [];
    let count = 0;
    await assert.rejects(prepareOcrModelAssets({
      cacheStorage: null,
      fetchImpl: async (input) => new Response(
        String(input).endsWith(ORT_WASM_GZIP_ASSET_PATH) ? compressedWasm : new Uint8Array([1, 2]),
      ),
      createObjectURL: () => {
        count += 1;
        if (count === 2) throw new Error('URL quota');
        return `blob:${count}`;
      },
      revokeObjectURL: (url) => revoked.push(url),
    }), /URL quota/);
    assert.deepEqual(revoked, ['blob:1']);
  });
});
