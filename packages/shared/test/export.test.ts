import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { unzipSync } from 'fflate';
import type { PhotoWithScrambleId } from '../src/client';

Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });

const jpegBytes = Uint8Array.from(Buffer.from(
    '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z',
    'base64',
));

class FakeOffscreenCanvas {
    width: number;
    height: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    getContext() {
        return { drawImage() {} };
    }

    async convertToBlob() {
        return new Blob([jpegBytes], { type: 'image/jpeg' });
    }
}

Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 1000, height: 1600, close() {} }),
});
Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: FakeOffscreenCanvas });
Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
});

class FakeFileHandle {
    chunks: Uint8Array[] = [];
    activeWrites = 0;
    maxActiveWrites = 0;
    aborted = false;

    constructor(private readonly writeError?: DOMException) {}

    async createWritable() {
        return {
            write: async (chunk: Uint8Array) => {
                if (this.writeError) throw this.writeError;
                this.activeWrites += 1;
                this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);
                await Promise.resolve();
                this.chunks.push(chunk.slice());
                this.activeWrites -= 1;
            },
            close: async () => {},
            abort: async () => {
                this.aborted = true;
                this.chunks = [];
            },
        };
    }

    async getFile() {
        return new File(this.chunks, 'temporary-export', { lastModified: Date.now() });
    }
}

class FakeDirectoryHandle {
    readonly files = new Map<string, FakeFileHandle>();
    readonly directories = new Map<string, FakeDirectoryHandle>();

    constructor(private readonly writeError?: DOMException) {}

    async getDirectoryHandle(name: string) {
        let directory = this.directories.get(name);
        if (!directory) {
            directory = new FakeDirectoryHandle(this.writeError);
            this.directories.set(name, directory);
        }
        return directory;
    }

    async getFileHandle(name: string) {
        let file = this.files.get(name);
        if (!file) {
            file = new FakeFileHandle(this.writeError);
            this.files.set(name, file);
        }
        return file;
    }

    async removeEntry(name: string) {
        this.files.delete(name);
        this.directories.delete(name);
    }

    async *entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]> {
        for (const entry of this.files) yield entry;
        for (const entry of this.directories) yield entry;
    }
}

function makePhoto(id: string, pageCount: number): PhotoWithScrambleId {
    return {
        id,
        scrambleId: Number.MAX_SAFE_INTEGER,
        images: Array.from({ length: pageCount }, (_, index) => ({
            name: `${index + 1}.jpg`,
            url: `https://example.test/${id}/${index + 1}.jpg`,
        })),
    } as PhotoWithScrambleId;
}

describe('disk-backed streaming export', () => {
    it('writes a 120-page ZIP sequentially and preserves entry order', async () => {
        const root = new FakeDirectoryHandle();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { storage: { getDirectory: async () => root } },
        });
        const { exportPhotosToTemporaryFile } = await import('../src/export');
        const progress: number[] = [];
        const controller = new AbortController();
        const download = await exportPhotosToTemporaryFile({
            filename: 'long.zip',
            format: 'zip',
            photos: [{ name: 'Long chapter', photo: makePhoto('zip-120', 120) }],
        }, (event) => {
            if (event.stage === 'processing') progress.push(event.completed);
        }, controller.signal);

        const entries = unzipSync(new Uint8Array(await download.file.arrayBuffer()));
        assert.equal(Object.keys(entries).length, 120);
        assert.equal(Object.keys(entries)[0], '000.jpg');
        assert.equal(Object.keys(entries)[119], '119.jpg');
        assert.deepEqual(progress, Array.from({ length: 120 }, (_, index) => index + 1));

        const exportDirectory = root.directories.get('jmcomic-exports')!;
        const handle = [...exportDirectory.files.values()][0];
        assert.equal(handle.maxActiveWrites, 1);
        await download.dispose();
        assert.equal(exportDirectory.files.size, 0);
    });

    it('aborts processing and removes the partial OPFS file', async () => {
        const root = new FakeDirectoryHandle();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { storage: { getDirectory: async () => root } },
        });
        const { exportPhotosToTemporaryFile } = await import('../src/export');
        const controller = new AbortController();

        await assert.rejects(exportPhotosToTemporaryFile({
            filename: 'cancelled.cbz',
            format: 'cbz',
            photos: [{ name: 'Cancelled chapter', photo: makePhoto('cancel-120', 120) }],
        }, (event) => {
            if (event.stage === 'processing' && event.completed === 5) controller.abort();
        }, controller.signal), { name: 'AbortError' });

        assert.equal(root.directories.get('jmcomic-exports')!.files.size, 0);
    });

    it('streams a 120-page PDF through the dynamically loaded writer', async () => {
        const root = new FakeDirectoryHandle();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { storage: { getDirectory: async () => root } },
        });
        const { exportPhotosToTemporaryFile } = await import('../src/export');
        const controller = new AbortController();
        const download = await exportPhotosToTemporaryFile({
            filename: 'long.pdf',
            format: 'pdf',
            photos: [{ name: 'Long PDF', photo: makePhoto('pdf-120', 120) }],
        }, undefined, controller.signal);

        const pdf = new Uint8Array(await download.file.arrayBuffer());
        assert.equal(new TextDecoder().decode(pdf.subarray(0, 5)), '%PDF-');
        const exportDirectory = root.directories.get('jmcomic-exports')!;
        const handle = [...exportDirectory.files.values()][0];
        assert.equal(handle.maxActiveWrites, 1);
        await download.dispose();
    });

    it('reports quota exhaustion clearly and removes the partial file', async () => {
        const root = new FakeDirectoryHandle(new DOMException('quota', 'QuotaExceededError'));
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { storage: { getDirectory: async () => root } },
        });
        const { exportPhotosToTemporaryFile } = await import('../src/export');

        await assert.rejects(exportPhotosToTemporaryFile({
            filename: 'no-space.zip',
            format: 'zip',
            photos: [{ name: 'No space', photo: makePhoto('quota', 1) }],
        }, undefined, new AbortController().signal), /设备存储空间不足/);
        assert.equal(root.directories.get('jmcomic-exports')!.files.size, 0);
    });
});
