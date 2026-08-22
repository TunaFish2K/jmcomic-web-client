import {
    OCR_MODEL_VERSION,
    type OcrInitializationPhase,
    type OcrInitializationProgress,
} from "./types";
import {
    ORT_MJS_ASSET_PATH,
    ORT_RUNTIME_VERSION,
    ORT_WASM_GZIP_ASSET_PATH,
} from "./ort-assets";

const MODEL_CACHE_PREFIX = "jm-ocr-models:";
const MODEL_CACHE_NAME = `${MODEL_CACHE_PREFIX}${OCR_MODEL_VERSION}`;
const RUNTIME_CACHE_PREFIX = "jm-ocr-runtime:";
const RUNTIME_CACHE_NAME = `${RUNTIME_CACHE_PREFIX}${ORT_RUNTIME_VERSION}-jsep-gzip`;

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

type AssetSlot = (typeof OCR_MODELS)[number]["slot"] | "runtime";
type DownloadAsset = {
    slot: AssetSlot;
    url: string;
    contentType: string;
    errorLabel: string;
    cache: Cache | null;
    cacheVersionHeader: [string, string];
};
type DownloadState = {
    loadedBytes: number;
    totalBytes: number | null;
};

export type PreparedOcrModelAssets = {
    detectionUrl: string;
    recognitionUrl: string;
    ortWasmUrl: string;
    ortMjsUrl: string;
    usedCache: boolean;
    release(): void;
};

type PrepareOcrModelAssetsOptions = {
    fetchImpl?: typeof fetch;
    cacheStorage?: CacheStorage | null;
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
    runtimeWasmGzipUrl?: string;
    runtimeMjsUrl?: string;
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
    return () => {
        progressListeners.delete(listener);
    };
}

export function setOcrInitializationPhase(phase: OcrInitializationPhase) {
    publishProgress({ ...initializationProgress, phase });
}

function getDefaultCacheStorage() {
    return typeof caches === "undefined" ? null : caches;
}

async function openCache(cacheStorage: CacheStorage | null, name: string) {
    if (!cacheStorage) return null;
    try {
        return await cacheStorage.open(name);
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

function getAggregateProgress(states: Map<AssetSlot, DownloadState>) {
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
    states: Map<AssetSlot, DownloadState>,
    force = false,
) {
    const now = Date.now();
    if (!force && now - lastDownloadUpdate < 80) return;
    lastDownloadUpdate = now;
    publishProgress({ phase: "downloading", ...getAggregateProgress(states) });
}

async function downloadAsset(
    asset: DownloadAsset,
    states: Map<AssetSlot, DownloadState>,
    fetchImpl: typeof fetch,
) {
    const response = await fetchImpl(asset.url);
    if (!response.ok) {
        throw new Error(`${asset.errorLabel}下载失败（HTTP ${response.status}）`);
    }

    const contentLength = Number.parseInt(
        response.headers.get("Content-Length") ?? "",
        10,
    );
    const state = states.get(asset.slot)!;
    state.totalBytes =
        Number.isFinite(contentLength) && contentLength > 0
            ? contentLength
            : null;
    publishDownloadProgress(states, true);

    const contentType = response.headers.get("Content-Type") ?? asset.contentType;
    if (!response.body) {
        const blob = await response.blob();
        state.loadedBytes = blob.size;
        state.totalBytes = blob.size;
        publishDownloadProgress(states, true);
        return blob;
    }

    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Uint8Array.from(value).buffer);
        state.loadedBytes += value.byteLength;
        publishDownloadProgress(states);
    }
    const blob = new Blob(chunks, { type: contentType });
    state.loadedBytes = blob.size;
    state.totalBytes = blob.size;
    publishDownloadProgress(states, true);
    return blob;
}

async function cacheAsset(asset: DownloadAsset, blob: Blob) {
    if (!asset.cache) return;
    try {
        await asset.cache.put(
            asset.url,
            new Response(blob, {
                headers: {
                    "Content-Type": blob.type || asset.contentType,
                    "Content-Length": String(blob.size),
                    [asset.cacheVersionHeader[0]]:
                        asset.cacheVersionHeader[1],
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
                        (key.startsWith(MODEL_CACHE_PREFIX) &&
                            key !== MODEL_CACHE_NAME) ||
                        (key.startsWith(RUNTIME_CACHE_PREFIX) &&
                            key !== RUNTIME_CACHE_NAME),
                )
                .map((key) => cacheStorage.delete(key)),
        );
    } catch {
        // Cache cleanup must not block OCR initialization.
    }
}

function resolveRuntimeAssetUrl(path: string) {
    if (typeof location === "undefined") return path;
    return new URL(path, location.href).href;
}

async function decompressRuntimeWasm(compressed: Blob) {
    if (typeof DecompressionStream !== "function") {
        throw new Error(
            "当前浏览器不支持 OCR Runtime 解压，请升级浏览器后重试",
        );
    }
    try {
        const decompressed = await new Response(
            compressed.stream().pipeThrough(new DecompressionStream("gzip")),
        ).blob();
        const magic = new Uint8Array(
            await decompressed.slice(0, 4).arrayBuffer(),
        );
        if (
            magic.length !== 4 ||
            magic[0] !== 0x00 ||
            magic[1] !== 0x61 ||
            magic[2] !== 0x73 ||
            magic[3] !== 0x6d
        ) {
            throw new Error("invalid WebAssembly header");
        }
        return new Blob([decompressed], { type: "application/wasm" });
    } catch (error) {
        if (
            error instanceof Error &&
            error.message.startsWith("当前浏览器不支持")
        ) {
            throw error;
        }
        throw new Error("OCR Runtime 解压失败，请重试");
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
    const runtimeWasmGzipUrl =
        options.runtimeWasmGzipUrl ??
        resolveRuntimeAssetUrl(ORT_WASM_GZIP_ASSET_PATH);
    const runtimeMjsUrl =
        options.runtimeMjsUrl ?? resolveRuntimeAssetUrl(ORT_MJS_ASSET_PATH);

    publishProgress({
        phase: "checking-cache",
        loadedBytes: 0,
        totalBytes: null,
    });
    const [modelCache, runtimeCache] = await Promise.all([
        openCache(cacheStorage, MODEL_CACHE_NAME),
        openCache(cacheStorage, RUNTIME_CACHE_NAME),
    ]);
    const assets: DownloadAsset[] = [
        ...OCR_MODELS.map((model) => ({
            ...model,
            contentType: "application/x-tar",
            errorLabel: "OCR 模型",
            cache: modelCache,
            cacheVersionHeader: [
                "X-JM-OCR-Model-Version",
                OCR_MODEL_VERSION,
            ] as [string, string],
        })),
        {
            slot: "runtime",
            url: runtimeWasmGzipUrl,
            contentType: "application/gzip",
            errorLabel: "OCR Runtime",
            cache: runtimeCache,
            cacheVersionHeader: [
                "X-JM-OCR-Runtime-Version",
                ORT_RUNTIME_VERSION,
            ],
        },
    ];
    const cachedBlobs = new Map<AssetSlot, Blob | null>(
        await Promise.all(
            assets.map(async (asset) => [
                asset.slot,
                asset.cache
                    ? await readCachedModel(asset.cache, asset.url)
                    : null,
            ] as const),
        ),
    );
    const states = new Map<AssetSlot, DownloadState>(
        assets.map((asset) => {
            const size = cachedBlobs.get(asset.slot)?.size;
            return [
                asset.slot,
                {
                    loadedBytes: size ?? 0,
                    totalBytes: size ?? null,
                },
            ];
        }),
    );
    const usedCache = [...cachedBlobs.values()].some(Boolean);

    try {
        const blobs = new Map<AssetSlot, Blob>(
            await Promise.all(
                assets.map(async (asset) => {
                    const cached = cachedBlobs.get(asset.slot);
                    if (cached) return [asset.slot, cached] as const;
                    const downloaded = await downloadAsset(
                        asset,
                        states,
                        fetchImpl,
                    );
                    await cacheAsset(asset, downloaded);
                    return [asset.slot, downloaded] as const;
                }),
            ),
        );
        if ([...cachedBlobs.values()].some((blob) => !blob)) {
            publishDownloadProgress(states, true);
        }
        await deleteOldModelCaches(cacheStorage);

        let runtimeWasm: Blob;
        try {
            runtimeWasm = await decompressRuntimeWasm(blobs.get("runtime")!);
        } catch (error) {
            if (!cachedBlobs.get("runtime")) throw error;
            const runtimeAsset = assets.find(
                (asset) => asset.slot === "runtime",
            )!;
            await runtimeAsset.cache?.delete(runtimeAsset.url).catch(() => false);
            states.set("runtime", { loadedBytes: 0, totalBytes: null });
            const downloaded = await downloadAsset(
                runtimeAsset,
                states,
                fetchImpl,
            );
            await cacheAsset(runtimeAsset, downloaded);
            runtimeWasm = await decompressRuntimeWasm(downloaded);
        }

        const urls: string[] = [];
        try {
            urls.push(createObjectURL(blobs.get("detection")!));
            urls.push(createObjectURL(blobs.get("recognition")!));
            urls.push(createObjectURL(runtimeWasm));
        } catch (error) {
            for (const url of urls) revokeObjectURL(url);
            throw error;
        }
        return {
            detectionUrl: urls[0]!,
            recognitionUrl: urls[1]!,
            ortWasmUrl: urls[2]!,
            ortMjsUrl: runtimeMjsUrl,
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
    await Promise.all([
        cacheStorage.delete(MODEL_CACHE_NAME).catch(() => false),
        cacheStorage.delete(RUNTIME_CACHE_NAME).catch(() => false),
    ]);
}
