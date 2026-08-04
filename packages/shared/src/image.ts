import type { PhotoWithScrambleId } from './client';
import {
    generateImageCacheKey,
    getCachedImageEntry,
    setCachedImage,
    setCachedImageMetadata,
} from './cache';
import { getSliceCount } from './data';

export interface ProcessedImage {
    data: ArrayBuffer;
    width: number;
    height: number;
    byteLength: number;
}

const RETRY_DELAYS_MS = [400, 1000, 2000];

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
    const bitmap = await createImageBitmap(new Blob([source]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    try {
        throwIfAborted(signal);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建图片画布');

        if (sliceCount <= 0) {
            context.drawImage(bitmap, 0, 0);
        } else {
            const remainder = bitmap.height % sliceCount;
            const sliceHeightBase = Math.floor(bitmap.height / sliceCount);
            for (let index = 0; index < sliceCount; index++) {
                const sourceY = bitmap.height - sliceHeightBase * (index + 1) - remainder;
                const destinationY = sliceHeightBase * index + (index === 0 ? 0 : remainder);
                const sliceHeight = sliceHeightBase + (index === 0 ? remainder : 0);
                context.drawImage(
                    bitmap,
                    0,
                    sourceY,
                    bitmap.width,
                    sliceHeight,
                    0,
                    destinationY,
                    bitmap.width,
                    sliceHeight,
                );
            }
        }

        throwIfAborted(signal);
        const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        const data = await jpeg.arrayBuffer();
        throwIfAborted(signal);
        return {
            data,
            width: bitmap.width,
            height: bitmap.height,
            byteLength: data.byteLength,
        };
    } finally {
        bitmap.close();
        canvas.width = 1;
        canvas.height = 1;
    }
}

export async function getProcessedPhotoImage(
    photo: Pick<PhotoWithScrambleId, 'id' | 'scrambleId'>,
    image: { name: string; url: string },
    signal?: AbortSignal,
): Promise<ProcessedImage> {
    const cacheKey = generateImageCacheKey(photo.id, image.name);
    const cached = await getCachedImageEntry(cacheKey);
    throwIfAborted(signal);

    if (cached) {
        let width = cached.width;
        let height = cached.height;
        if (width === null || height === null) {
            const dimensions = await readImageDimensions(cached.data, signal);
            width = dimensions.width;
            height = dimensions.height;
            await setCachedImageMetadata(cacheKey, width, height, cached.byteLength);
        }
        return {
            data: cached.data,
            width,
            height,
            byteLength: cached.byteLength,
        };
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
            throwIfAborted(signal);
            const response = await fetch(image.url, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const source = await response.arrayBuffer();
            throwIfAborted(signal);
            const filename = image.url.split('/').pop() || image.name;
            const sliceCount = getSliceCount(photo.scrambleId, Number.parseInt(photo.id, 10), filename);
            const processed = await encodeScrambledImageAsJpeg(source, sliceCount, signal);
            await setCachedImage(cacheKey, processed.data, {
                width: processed.width,
                height: processed.height,
            });
            return processed;
        } catch (error) {
            if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
            lastError = error;
            if (attempt < RETRY_DELAYS_MS.length) await delay(RETRY_DELAYS_MS[attempt], signal);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(`处理图片 ${image.name} 失败`);
}
