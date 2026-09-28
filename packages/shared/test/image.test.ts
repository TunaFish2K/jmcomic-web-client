import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { readFile } from 'node:fs/promises';
import { createImageProcessor } from 'jmcomic-sdk/image';
import { createNodeWasmLoader } from 'jmcomic-sdk/node';
import { configureImageProcessing } from '../src/image-bridge';

const source = new Uint8Array(await readFile(new URL('../../sdk/test/fixtures/17x103-10-upright.png', import.meta.url)));
const processor = createImageProcessor({ loadWasm: createNodeWasmLoader() });
const expected = await processor.process(source, 0);
before(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
    Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
    configureImageProcessing((data, slices, options) => processor.process(new Uint8Array(data), slices, options));
});

describe('processed image network policy', () => {
    it('classifies retryable response statuses', async () => {
        const { shouldRetryImageStatus } = await import('../src/image');
        for (const status of [408, 425, 429, 500, 503]) assert.equal(shouldRetryImageStatus(status), true);
        for (const status of [200, 400, 401, 404, 499]) assert.equal(shouldRetryImageStatus(status), false);
    });

    it('does not retry permanent client failures', async () => {
        const { getProcessedPhotoImage } = await import('../src/image');
        let calls = 0;
        const fetchImpl: typeof fetch = async () => {
            calls += 1;
            return new Response('missing', { status: 404 });
        };
        await assert.rejects(
            getProcessedPhotoImage(
                { id: '1001', scrambleId: 999999 },
                { name: 'missing.jpg', url: 'https://example.test/missing.jpg' },
                undefined,
                { fetchImpl },
            ),
            (error: unknown) => error instanceof DOMException && error.name === 'NotRetryableError',
        );
        assert.equal(calls, 1);
    });

    it('retries transient responses and caches the decoded result', async () => {
        const { getProcessedPhotoImage } = await import('../src/image');
        let calls = 0;
        const fetchImpl: typeof fetch = async () => {
            calls += 1;
            if (calls === 1) return new Response('busy', { status: 429, headers: { 'retry-after': '0' } });
            return new Response(source.slice(), { status: 200 });
        };
        const photo = { id: '1002', scrambleId: 999999 };
        const image = { name: 'page.jpg', url: 'https://example.test/page.jpg' };
        const result = await getProcessedPhotoImage(photo, image, undefined, { fetchImpl });
        assert.equal(calls, 2);
        assert.deepEqual({ width: result.width, height: result.height, byteLength: result.byteLength }, {
            width: 17,
            height: 103,
            byteLength: expected.data.byteLength,
        });
        assert.deepEqual(new Uint8Array(result.data), expected.data);

        const cached = await getProcessedPhotoImage(photo, image, undefined, {
            fetchImpl: async () => { throw new Error('cache was not used'); },
        });
        assert.deepEqual(new Uint8Array(cached.data), expected.data);
        assert.equal(cached.width, 17);
        assert.equal(cached.height, 103);
    });

    it('returns before a background cache write is required by the caller', async () => {
        const { getProcessedPhotoImage } = await import('../src/image');
        const result = await getProcessedPhotoImage(
            { id: '1003', scrambleId: 999999 },
            { name: 'background.jpg', url: 'https://example.test/background.jpg' },
            undefined,
            {
                cacheWriteMode: 'background',
                fetchImpl: async () => new Response(source.slice(), { status: 200 }),
            },
        );
        assert.equal(result.byteLength, expected.data.byteLength);
    });

    it('stops retrying as soon as its signal is aborted', async () => {
        const { getProcessedPhotoImage } = await import('../src/image');
        const controller = new AbortController();
        controller.abort(new DOMException('stopped', 'AbortError'));
        let calls = 0;
        await assert.rejects(
            getProcessedPhotoImage(
                { id: '1004', scrambleId: 999999 },
                { name: 'aborted.jpg', url: 'https://example.test/aborted.jpg' },
                controller.signal,
                { fetchImpl: async () => { calls += 1; return new Response(); } },
            ),
            (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
        );
        assert.equal(calls, 0);
    });
});
