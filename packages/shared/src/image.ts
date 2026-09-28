import type { PhotoWithScrambleId } from './client';
import {
    generateImageCacheKey,
    getCachedImageEntry,
    setCachedImage,
    setCachedImageMetadata,
} from './cache';
import { getSliceCount } from './data';
import { processImage } from './image-bridge';

export interface ProcessedImage {
    data: ArrayBuffer;
    width: number;
    height: number;
    byteLength: number;
}

const RETRY_DELAYS_MS = [400, 1000, 2000];

export type ProcessPhotoImageOptions = {
    cacheWriteMode?: 'blocking' | 'background';
    fetchImpl?: typeof fetch;
};

export function shouldRetryImageStatus(status: number) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function getRetryAfterMs(response: Response) {
    const raw = response.headers.get('retry-after');
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 5000);
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) return null;
    return Math.min(Math.max(timestamp - Date.now(), 0), 5000);
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        throwIfAborted(signal);
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

async function readImageDimensions(data: ArrayBuffer, signal?: AbortSignal) {
    throwIfAborted(signal);
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
    try {
        throwIfAborted(signal);
        return { width: bitmap.width, height: bitmap.height };
    } finally {
        bitmap.close();
    }
}

export async function encodeScrambledImageAsJpeg(
    source: ArrayBuffer,
    sliceCount: number,
    signal?: AbortSignal,
): Promise<ProcessedImage> {
    throwIfAborted(signal);
    const result = await processImage(source, sliceCount, { format: 'jpeg', signal });
    throwIfAborted(signal);
    return { data: result.data.buffer as ArrayBuffer, width: result.width, height: result.height, byteLength: result.data.byteLength };
}

export async function getProcessedPhotoImage(
    photo: Pick<PhotoWithScrambleId, 'id' | 'scrambleId'>,
    image: { name: string; url: string },
    signal?: AbortSignal,
    options: ProcessPhotoImageOptions = {},
): Promise<ProcessedImage> {
    const cacheKey = generateImageCacheKey(photo.id, image.name);
    let storedKey = cacheKey;
    let cached = await getCachedImageEntry(storedKey);
    if (!cached) {
        storedKey = `${photo.id}/${image.name}`;
        cached = await getCachedImageEntry(storedKey);
    }
    throwIfAborted(signal);

    if (cached) {
        let width = cached.width;
        let height = cached.height;
        if (width === null || height === null) {
            const dimensions = await readImageDimensions(cached.data, signal);
            width = dimensions.width;
            height = dimensions.height;
            await setCachedImageMetadata(storedKey, width, height, cached.byteLength);
        }
        return {
            data: cached.data,
            width,
            height,
            byteLength: cached.byteLength,
        };
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    let source: ArrayBuffer | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        let retryAfterMs: number | null = null;
        try {
            throwIfAborted(signal);
            const response = await fetchImpl(image.url, { signal });
            if (!response.ok) {
                if (!shouldRetryImageStatus(response.status)) {
                    throw new DOMException(`HTTP ${response.status}`, 'NotRetryableError');
                }
                retryAfterMs = getRetryAfterMs(response);
                throw new Error(`HTTP ${response.status}`);
            }
            source = await response.arrayBuffer();
            break;
        } catch (error) {
            if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
            if (error instanceof DOMException && error.name === 'NotRetryableError') throw error;
            lastError = error;
            if (attempt < RETRY_DELAYS_MS.length) {
                await delay(retryAfterMs ?? RETRY_DELAYS_MS[attempt], signal);
            }
        }
    }
    if (!source) {
        throw lastError instanceof Error ? lastError : new Error(`下载图片 ${image.name} 失败`);
    }

    throwIfAborted(signal);
    const filename = image.url.split('/').pop() || image.name;
    const sliceCount = getSliceCount(photo.scrambleId, Number.parseInt(photo.id, 10), filename);
    const processed = await encodeScrambledImageAsJpeg(source, sliceCount, signal);
    const cacheWrite = setCachedImage(cacheKey, processed.data, {
        width: processed.width,
        height: processed.height,
    });
    if (options.cacheWriteMode === 'background') void cacheWrite.catch(() => {});
    else await cacheWrite;
    return processed;
}
