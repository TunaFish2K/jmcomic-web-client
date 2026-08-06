import { getBatchPhoto, getPhoto } from "../api";
import type { BatchError } from "../api";
import type { PhotoWithScrambleId } from "@tiny-client/shared";
import {
    exportPhotosToTemporaryFile,
    startTemporaryDownload,
    type ExportProgress,
} from "@tiny-client/shared";
import pLimit from "p-limit";
import type { DownloadFormat, DownloadTarget, DownloadTask } from "./types";

// Global concurrency limiter for download tasks (shared across all active downloads)
export const downloadLimit = pLimit(1);

export const BATCH_PHOTO_CHUNK_SIZE = 20;
export const BATCH_PHOTO_RETRY_DELAYS_MS = [1000, 2500];

export function sanitizeFilename(name: string) {
    return name.replace(/[<>:"/\\|?*]/g, '_');
}

export function parseSeriesOrder(value: string | number | undefined) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function formatBatchError(error: BatchError) {
    const details = [
        error.stage !== 'unknown' ? `阶段: ${error.stage}` : null,
        error.domain ? `域名: ${error.domain}` : null,
        error.reference ? `引用: ${error.reference}` : null,
    ].filter(Boolean).join(' | ');

    return details ? `${error.message} (${details})` : error.message;
}

export function throwIfDownloadAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export function waitForRetry(delay: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        throwIfDownloadAborted(signal);
        const timer = window.setTimeout(resolve, delay);
        signal?.addEventListener('abort', () => {
            window.clearTimeout(timer);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

export async function getPhotosInChunks(
    targets: DownloadTarget[],
    chunkSize: number = BATCH_PHOTO_CHUNK_SIZE,
    signal?: AbortSignal,
) {
    const photoMap = new Map<string, PhotoWithScrambleId>();
    let pendingTargets = [...targets];

    for (let attempt = 0; attempt <= BATCH_PHOTO_RETRY_DELAYS_MS.length && pendingTargets.length > 0; attempt++) {
        throwIfDownloadAborted(signal);
        const chunks: DownloadTarget[][] = [];
        for (let i = 0; i < pendingTargets.length; i += chunkSize) {
            chunks.push(pendingTargets.slice(i, i + chunkSize));
        }

        const failedIds = new Set<string>();
        for (const chunk of chunks) {
            throwIfDownloadAborted(signal);
            const batch = await getBatchPhoto(chunk.map((target) => target.id), signal);
            throwIfDownloadAborted(signal);
            for (const item of batch) {
                if (item.photo) photoMap.set(item.photoId, item.photo);
                else failedIds.add(item.photoId);
            }
        }

        pendingTargets = pendingTargets.filter((target) => !photoMap.has(target.id));
        if (pendingTargets.length === 0) break;
        if (attempt === BATCH_PHOTO_RETRY_DELAYS_MS.length) break;

        // Only retry chapters that still failed in this round.
        pendingTargets = pendingTargets.filter((target) => failedIds.has(target.id));
        await waitForRetry(BATCH_PHOTO_RETRY_DELAYS_MS[attempt], signal);
    }

    return targets.map((target) => {
        const photo = photoMap.get(target.id);
        if (!photo) {
            throw new Error(`无法获取章节 ${target.name} 的图片数据`);
        }
        return {
            name: target.name,
            photo,
        };
    });
}

export async function buildSingleDownload(
    target: DownloadTarget,
    format: DownloadFormat,
    updateTask: (updates: Partial<DownloadTask>) => void,
    signal: AbortSignal,
) {
    const photo = await getPhoto(target.id, signal);
    throwIfDownloadAborted(signal);
    if (!photo) throw new Error('无法获取图片数据');

    const safeName = sanitizeFilename(target.name);
    const totalImages = photo.images.length;
    const filename = `${safeName}.${format}`;
    updateTask({ total: totalImages, progress: 0, stage: 'processing' });
    const temporary = await exportPhotosToTemporaryFile({
        filename,
        format,
        photos: [{ name: target.name, photo }],
    }, (progress: ExportProgress) => updateTask({
        progress: progress.completed,
        total: progress.total,
        stage: progress.stage,
    }), signal);
    throwIfDownloadAborted(signal);
    startTemporaryDownload(filename, temporary);
}

export async function buildCombinedDownload(
    targets: DownloadTarget[],
    format: DownloadFormat,
    archiveName: string,
    updateTask: (updates: Partial<DownloadTask>) => void,
    signal: AbortSignal,
) {
    const photos = await getPhotosInChunks(targets, BATCH_PHOTO_CHUNK_SIZE, signal);
    throwIfDownloadAborted(signal);

    const totalImages = photos.reduce((sum, item) => sum + item.photo.images.length, 0);
    const safeName = sanitizeFilename(archiveName);
    const filename = `${safeName}.${format}`;
    updateTask({ total: totalImages, progress: 0, stage: 'processing' });
    const temporary = await exportPhotosToTemporaryFile({
        filename,
        format,
        photos,
        archiveLayout: format === 'cbz' ? 'flat' : 'folders',
    }, (progress: ExportProgress) => updateTask({
        progress: progress.completed,
        total: progress.total,
        stage: progress.stage,
    }), signal);
    throwIfDownloadAborted(signal);
    startTemporaryDownload(filename, temporary);
}
