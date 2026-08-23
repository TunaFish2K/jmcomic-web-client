import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const drawCalls: unknown[][] = [];
let bitmapCloseCount = 0;

before(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
    Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
    Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: async () => ({
            width: 8,
            height: 12,
            close: () => { bitmapCloseCount += 1; },
        }),
    });
    class TestOffscreenCanvas {
        width: number;
        height: number;

        constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
        }

        getContext() {
            return { drawImage: (...args: unknown[]) => drawCalls.push(args) };
        }

        async convertToBlob() {
            return new Blob([new Uint8Array([7, 8, 9])], { type: 'image/jpeg' });
        }
    }
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: TestOffscreenCanvas });
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
            return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        };
        const photo = { id: '1002', scrambleId: 999999 };
        const image = { name: 'page.jpg', url: 'https://example.test/page.jpg' };
        const result = await getProcessedPhotoImage(photo, image, undefined, { fetchImpl });
        assert.equal(calls, 2);
        assert.deepEqual({ width: result.width, height: result.height, byteLength: result.byteLength }, {
            width: 8,
            height: 12,
            byteLength: 3,
        });
        assert.ok(drawCalls.length > 0);
        assert.ok(bitmapCloseCount > 0);

        const cached = await getProcessedPhotoImage(photo, image, undefined, {
            fetchImpl: async () => { throw new Error('cache was not used'); },
        });
        assert.deepEqual([...new Uint8Array(cached.data)], [7, 8, 9]);
        assert.equal(cached.width, 8);
        assert.equal(cached.height, 12);
    });

    it('returns before a background cache write is required by the caller', async () => {
        const { getProcessedPhotoImage } = await import('../src/image');
        const result = await getProcessedPhotoImage(
            { id: '1003', scrambleId: 999999 },
            { name: 'background.jpg', url: 'https://example.test/background.jpg' },
            undefined,
            {
                cacheWriteMode: 'background',
                fetchImpl: async () => new Response(new Uint8Array([1]), { status: 200 }),
            },
        );
        assert.equal(result.byteLength, 3);
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
