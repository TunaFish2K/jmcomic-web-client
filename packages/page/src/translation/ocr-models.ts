import {
    OCR_MODEL_VERSION,
    type OcrInitializationPhase,
    type OcrInitializationProgress,
} from "./types";

const MODEL_CACHE_PREFIX = "jm-ocr-models:";
const MODEL_CACHE_NAME = `${MODEL_CACHE_PREFIX}${OCR_MODEL_VERSION}`;

const OCR_MODELS = [
    {
        slot: "detection",
        url: "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar",
    },
    {
        slot: "recognition",
        url: "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx_infer.tar",
    },
] as const;

type ModelSlot = (typeof OCR_MODELS)[number]["slot"];
type DownloadState = {
    loadedBytes: number;
    totalBytes: number | null;
};

export type PreparedOcrModelAssets = {
    detectionUrl: string;
    recognitionUrl: string;
    usedCache: boolean;
    release(): void;
};

type PrepareOcrModelAssetsOptions = {
    fetchImpl?: typeof fetch;
    cacheStorage?: CacheStorage | null;
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
};

let initializationProgress: OcrInitializationProgress = {
    phase: "idle",
    loadedBytes: 0,
    totalBytes: null,
};
let lastDownloadUpdate = 0;
const progressListeners = new Set<
    (progress: OcrInitializationProgress) => void
>();

function publishProgress(progress: OcrInitializationProgress) {
    initializationProgress = progress;
    for (const listener of progressListeners) listener(progress);
}

export function getOcrInitializationProgress() {
    return initializationProgress;
}

export function subscribeOcrInitializationProgress(
    listener: (progress: OcrInitializationProgress) => void,
) {
    progressListeners.add(listener);
    listener(initializationProgress);
    return () => progressListeners.delete(listener);
}

export function setOcrInitializationPhase(phase: OcrInitializationPhase) {
    publishProgress({ ...initializationProgress, phase });
}

function getDefaultCacheStorage() {
    return typeof caches === "undefined" ? null : caches;
}

async function openModelCache(cacheStorage: CacheStorage | null) {
    if (!cacheStorage) return null;
    try {
        return await cacheStorage.open(MODEL_CACHE_NAME);
    } catch {
        return null;
    }
}

async function readCachedModel(cache: Cache, url: string) {
    try {
        const response = await cache.match(url);
        if (!response) return null;
        const blob = await response.blob();
        if (blob.size > 0) return blob;
        await cache.delete(url);
    } catch {
        await cache.delete(url).catch(() => false);
    }
    return null;
}

function getAggregateProgress(states: Map<ModelSlot, DownloadState>) {
    const values = [...states.values()];
    const totalKnown = values.every((state) => state.totalBytes !== null);
    return {
        loadedBytes: values.reduce((sum, state) => sum + state.loadedBytes, 0),
        totalBytes: totalKnown
            ? values.reduce((sum, state) => sum + (state.totalBytes ?? 0), 0)
            : null,
    };
}

function publishDownloadProgress(
    states: Map<ModelSlot, DownloadState>,
    force = false,
) {
    const now = Date.now();
    if (!force && now - lastDownloadUpdate < 80) return;
    lastDownloadUpdate = now;
    publishProgress({ phase: "downloading", ...getAggregateProgress(states) });
}

async function downloadModel(
    model: (typeof OCR_MODELS)[number],
    states: Map<ModelSlot, DownloadState>,
    fetchImpl: typeof fetch,
) {
    const response = await fetchImpl(model.url);
    if (!response.ok) {
        throw new Error(`OCR 模型下载失败（HTTP ${response.status}）`);
    }

    const contentLength = Number.parseInt(
        response.headers.get("Content-Length") ?? "",
        10,
    );
    const state = states.get(model.slot)!;
    state.totalBytes =
        Number.isFinite(contentLength) && contentLength > 0
            ? contentLength
            : null;
    publishDownloadProgress(states, true);

    const contentType =
        response.headers.get("Content-Type") ?? "application/x-tar";
    if (!response.body) {
        const blob = await response.blob();
        state.loadedBytes = blob.size;
        state.totalBytes = blob.size;
        publishDownloadProgress(states, true);
        return blob;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        state.loadedBytes += value.byteLength;
        publishDownloadProgress(states);
    }
    const blob = new Blob(chunks, { type: contentType });
    state.loadedBytes = blob.size;
    state.totalBytes = blob.size;
    publishDownloadProgress(states, true);
    return blob;
}

async function cacheModel(cache: Cache | null, url: string, blob: Blob) {
    if (!cache) return;
    try {
        await cache.put(
            url,
            new Response(blob, {
                headers: {
                    "Content-Type": blob.type || "application/x-tar",
                    "Content-Length": String(blob.size),
                    "X-JM-OCR-Model-Version": OCR_MODEL_VERSION,
                },
            }),
        );
    } catch {
        // The downloaded Blob remains usable when persistent storage is unavailable.
    }
}

async function deleteOldModelCaches(cacheStorage: CacheStorage | null) {
    if (!cacheStorage) return;
    try {
        const keys = await cacheStorage.keys();
        await Promise.all(
            keys
                .filter(
                    (key) =>
                        key.startsWith(MODEL_CACHE_PREFIX) &&
                        key !== MODEL_CACHE_NAME,
                )
                .map((key) => cacheStorage.delete(key)),
        );
    } catch {
        // Cache cleanup must not block OCR initialization.
    }
}

export async function prepareOcrModelAssets(
    options: PrepareOcrModelAssetsOptions = {},
): Promise<PreparedOcrModelAssets> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const cacheStorage =
        options.cacheStorage === undefined
            ? getDefaultCacheStorage()
            : options.cacheStorage;
    const createObjectURL =
        options.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
    const revokeObjectURL =
        options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));

    publishProgress({
        phase: "checking-cache",
        loadedBytes: 0,
        totalBytes: null,
    });
    const cache = await openModelCache(cacheStorage);
    const cachedBlobs = await Promise.all(
        OCR_MODELS.map((model) =>
            cache ? readCachedModel(cache, model.url) : Promise.resolve(null),
        ),
    );
    const states = new Map<ModelSlot, DownloadState>(
        OCR_MODELS.map((model, index) => {
            const size = cachedBlobs[index]?.size;
            return [
                model.slot,
                {
                    loadedBytes: size ?? 0,
                    totalBytes: size ?? null,
                },
            ];
        }),
    );
    const usedCache = cachedBlobs.some(Boolean);

    try {
        const blobs = await Promise.all(
            OCR_MODELS.map(async (model, index) => {
                const cached = cachedBlobs[index];
                if (cached) return cached;
                const downloaded = await downloadModel(
                    model,
                    states,
                    fetchImpl,
                );
                await cacheModel(cache, model.url, downloaded);
                return downloaded;
            }),
        );
        if (cachedBlobs.some((blob) => !blob)) {
            publishDownloadProgress(states, true);
        }
        await deleteOldModelCaches(cacheStorage);

        const urls: string[] = [];
        try {
            urls.push(createObjectURL(blobs[0]!));
            urls.push(createObjectURL(blobs[1]!));
        } catch (error) {
            for (const url of urls) revokeObjectURL(url);
            throw error;
        }
        return {
            detectionUrl: urls[0]!,
            recognitionUrl: urls[1]!,
            usedCache,
            release: () => {
                for (const url of urls) revokeObjectURL(url);
            },
        };
    } catch (error) {
        publishProgress({ phase: "idle", loadedBytes: 0, totalBytes: null });
        throw error;
    }
}

export async function clearOcrModelCache(
    cacheStorage: CacheStorage | null = getDefaultCacheStorage(),
) {
    if (!cacheStorage) return;
    await cacheStorage.delete(MODEL_CACHE_NAME).catch(() => false);
}
