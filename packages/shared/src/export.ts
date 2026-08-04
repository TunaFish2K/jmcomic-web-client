import { Zip, ZipPassThrough } from 'fflate';
import type { PhotoWithScrambleId } from './client';
import { getProcessedPhotoImage, type ProcessedImage } from './image';

const EXPORT_DIRECTORY = 'jmcomic-exports';
const STALE_EXPORT_AGE_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_LIFETIME_MS = 10 * 60 * 1000;

export type ExportFormat = 'pdf' | 'zip' | 'cbz';
export type ExportProgressStage = 'processing' | 'finalizing' | 'completed';

export interface NamedExportPhoto {
    name: string;
    photo: PhotoWithScrambleId;
}

export interface ExportRequest {
    filename: string;
    format: ExportFormat;
    photos: NamedExportPhoto[];
    archiveLayout?: 'folders' | 'flat';
}

export interface ExportProgress {
    stage: ExportProgressStage;
    completed: number;
    total: number;
}

export interface TemporaryDownload {
    file: File;
    dispose: () => Promise<void>;
}

interface ByteSink {
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
}

interface TemporarySink {
    sink: ByteSink;
    finish(): Promise<TemporaryDownload>;
    discard(reason?: unknown): Promise<void>;
}

interface PDFDocumentLike {
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    on(event: 'end' | 'error', listener: (error?: unknown) => void): this;
    addPage(options: { size: [number, number]; margin: number }): this;
    image(source: ArrayBuffer, x: number, y: number, options: { width: number; height: number }): this;
    end(): void;
}

type PDFDocumentConstructor = new (options: { autoFirstPage: boolean; compress: boolean }) => PDFDocumentLike;

let cleanupStarted = false;

function throwIfAborted(signal: AbortSignal) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function sanitizeFileSegment(value: string) {
    return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'untitled';
}

function toExportError(error: unknown): Error {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        return new Error('设备存储空间不足，无法完成导出。请释放空间后重试。');
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
}

async function getExportDirectory() {
    if (
        typeof navigator === 'undefined'
        || !navigator.storage
        || typeof navigator.storage.getDirectory !== 'function'
    ) {
        throw new Error('当前浏览器不支持磁盘流式导出（OPFS）。请使用最新版 Chrome、Edge、Firefox 或 Safari。');
    }
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(EXPORT_DIRECTORY, { create: true });
}

export async function cleanupTemporaryExports(maxAgeMs: number = STALE_EXPORT_AGE_MS) {
    const directory = await getExportDirectory();
    const cutoff = Date.now() - maxAgeMs;
    for await (const [name, handle] of directory.entries()) {
        if (handle.kind !== 'file') continue;
        try {
            const file = await handle.getFile();
            if (file.lastModified < cutoff) await directory.removeEntry(name);
        } catch {
            // Another tab may already have removed the file.
        }
    }
}

async function createTemporarySink(filename: string): Promise<TemporarySink> {
    const directory = await getExportDirectory();
    if (!cleanupStarted) {
        cleanupStarted = true;
        void cleanupTemporaryExports().catch(() => {});
    }

    const safeName = sanitizeFileSegment(filename);
    const temporaryName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const handle = await directory.getFileHandle(temporaryName, { create: true });
    const writable = await handle.createWritable();
    let settled = false;

    const discard = async (reason?: unknown) => {
        if (!settled) {
            settled = true;
            try {
                await writable.abort(reason);
            } catch {
                // The stream may already be closed after a write error.
            }
        }
        try {
            await directory.removeEntry(temporaryName);
        } catch {
            // Cleanup is idempotent.
        }
    };

    return {
        sink: {
            async write(data) {
                await writable.write(data);
            },
            async close() {
                if (settled) return;
                settled = true;
                await writable.close();
            },
            abort: discard,
        },
        async finish() {
            if (!settled) {
                settled = true;
                await writable.close();
            }
            const file = await handle.getFile();
            let disposed = false;
            return {
                file,
                async dispose() {
                    if (disposed) return;
                    disposed = true;
                    try {
                        await directory.removeEntry(temporaryName);
                    } catch {
                        // Cleanup is idempotent.
                    }
                },
            };
        },
        discard,
    };
}

class SequentialSinkWriter {
    private pending: Promise<void> = Promise.resolve();

    constructor(private readonly sink: ByteSink) {}

    enqueue(chunk: Uint8Array) {
        const ownedChunk = chunk.slice();
        this.pending = this.pending.then(() => this.sink.write(ownedChunk));
        void this.pending.catch(() => {});
    }

    async drain() {
        await this.pending;
    }
}

function getTotalImages(photos: NamedExportPhoto[]) {
    return photos.reduce((total, item) => total + item.photo.images.length, 0);
}

async function forEachProcessedImage(
    photos: NamedExportPhoto[],
    signal: AbortSignal,
    onImage: (
        image: ProcessedImage,
        context: { photoIndex: number; imageIndex: number; namedPhoto: NamedExportPhoto },
    ) => Promise<void>,
    onProgress?: (progress: ExportProgress) => void,
) {
    const total = getTotalImages(photos);
    let completed = 0;
    for (let photoIndex = 0; photoIndex < photos.length; photoIndex++) {
        const namedPhoto = photos[photoIndex];
        for (let imageIndex = 0; imageIndex < namedPhoto.photo.images.length; imageIndex++) {
            throwIfAborted(signal);
            const image = await getProcessedPhotoImage(
                namedPhoto.photo,
                namedPhoto.photo.images[imageIndex],
                signal,
            );
            throwIfAborted(signal);
            await onImage(image, { photoIndex, imageIndex, namedPhoto });
            completed += 1;
            onProgress?.({ stage: 'processing', completed, total });
        }
    }
}

function getArchiveEntryName(
    photos: NamedExportPhoto[],
    layout: 'folders' | 'flat',
    photoIndex: number,
    imageIndex: number,
) {
    const namedPhoto = photos[photoIndex];
    const imageDigits = String(Math.max(namedPhoto.photo.images.length, 1)).length;
    if (photos.length === 1) {
        return `${String(imageIndex).padStart(imageDigits, '0')}.jpg`;
    }

    const chapterDigits = String(Math.max(photos.length, 1)).length;
    const chapterPrefix = `${String(photoIndex + 1).padStart(chapterDigits, '0')}-${sanitizeFileSegment(namedPhoto.name)}`;
    const imageName = `${String(imageIndex + 1).padStart(imageDigits, '0')}.jpg`;
    return layout === 'folders' ? `${chapterPrefix}/${imageName}` : `${chapterPrefix}-${imageName}`;
}

async function writeZip(
    request: ExportRequest,
    sink: ByteSink,
    signal: AbortSignal,
    onProgress?: (progress: ExportProgress) => void,
) {
    const writer = new SequentialSinkWriter(sink);
    let finalResolve: (() => void) | null = null;
    let finalReject: ((error: unknown) => void) | null = null;
    const finalOutput = new Promise<void>((resolve, reject) => {
        finalResolve = resolve;
        finalReject = reject;
    });
    const zip = new Zip((error, data, final) => {
        if (error) {
            finalReject?.(error);
            return;
        }
        writer.enqueue(data);
        if (final) finalResolve?.();
    });
    const layout = request.archiveLayout ?? (request.format === 'cbz' ? 'flat' : 'folders');

    await forEachProcessedImage(
        request.photos,
        signal,
        async (image, context) => {
            const entry = new ZipPassThrough(getArchiveEntryName(
                request.photos,
                layout,
                context.photoIndex,
                context.imageIndex,
            ));
            zip.add(entry);
            entry.push(new Uint8Array(image.data), true);
            await writer.drain();
            throwIfAborted(signal);
        },
        onProgress,
    );

    onProgress?.({ stage: 'finalizing', completed: getTotalImages(request.photos), total: getTotalImages(request.photos) });
    zip.end();
    await finalOutput;
    await writer.drain();
}

async function writePdf(
    request: ExportRequest,
    sink: ByteSink,
    signal: AbortSignal,
    onProgress?: (progress: ExportProgress) => void,
) {
    throwIfAborted(signal);
    const pdfModule = await import('pdfkit/js/pdfkit.standalone');
    throwIfAborted(signal);
    const PDFDocument = pdfModule.default as unknown as PDFDocumentConstructor;
    const document = new PDFDocument({ autoFirstPage: false, compress: false });
    const writer = new SequentialSinkWriter(sink);
    const finished = new Promise<void>((resolve, reject) => {
        document.on('data', (chunk) => writer.enqueue(chunk));
        document.on('end', () => resolve());
        document.on('error', (error) => reject(error));
    });
    let hasPage = false;

    await forEachProcessedImage(
        request.photos,
        signal,
        async (image) => {
            document.addPage({ size: [image.width, image.height], margin: 0 });
            if (hasPage) await writer.drain();
            throwIfAborted(signal);
            document.image(image.data, 0, 0, { width: image.width, height: image.height });
            hasPage = true;
        },
        onProgress,
    );

    onProgress?.({ stage: 'finalizing', completed: getTotalImages(request.photos), total: getTotalImages(request.photos) });
    document.end();
    await finished;
    await writer.drain();
}

export async function exportPhotosToTemporaryFile(
    request: ExportRequest,
    onProgress: ((progress: ExportProgress) => void) | undefined,
    signal: AbortSignal,
): Promise<TemporaryDownload> {
    throwIfAborted(signal);
    if (request.photos.length === 0) throw new Error('没有可导出的图片');

    const temporary = await createTemporarySink(request.filename);
    try {
        if (request.format === 'pdf') {
            await writePdf(request, temporary.sink, signal, onProgress);
        } else {
            await writeZip(request, temporary.sink, signal, onProgress);
        }
        throwIfAborted(signal);
        await temporary.sink.close();
        const download = await temporary.finish();
        onProgress?.({
            stage: 'completed',
            completed: getTotalImages(request.photos),
            total: getTotalImages(request.photos),
        });
        return download;
    } catch (error) {
        await temporary.discard(error);
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        throw toExportError(error);
    }
}

export function startTemporaryDownload(filename: string, download: TemporaryDownload) {
    const url = URL.createObjectURL(download.file);
    const link = document.createElement('a');
    link.href = url;
    link.download = sanitizeFileSegment(filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
        URL.revokeObjectURL(url);
        void download.dispose();
    }, DOWNLOAD_LIFETIME_MS);
}
