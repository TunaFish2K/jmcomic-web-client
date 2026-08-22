import { getNormalizedPolygon } from "./geometry";
import {
    clearOcrModelCache,
    prepareOcrModelAssets,
    setOcrInitializationPhase,
} from "./ocr-models";
import type { OcrResult } from "@paddleocr/paddleocr-js";
import {
    OCR_MODEL_VERSION,
    OCR_PREPROCESS_VERSION,
    type OcrPageResult,
    type TranslationStage,
} from "./types";

const MAX_OCR_SIDE = 1600;
const ORT_WASM_PATH =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

type OcrRunner = {
    predict(input: unknown): Promise<OcrResult[]>;
    dispose(): Promise<void>;
};

let runnerPromise: Promise<OcrRunner> | null = null;

async function createRunner(retryCachedModels = true): Promise<OcrRunner> {
    const assets = await prepareOcrModelAssets();
    try {
        setOcrInitializationPhase("initializing");
        const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
        const runner = await PaddleOCR.create({
            textDetectionModelName: "PP-OCRv5_mobile_det",
            textRecognitionModelName: "PP-OCRv5_mobile_rec",
            textDetectionModelAsset: { url: assets.detectionUrl },
            textRecognitionModelAsset: { url: assets.recognitionUrl },
            textRecognitionBatchSize: 6,
            worker: true,
            ortOptions: {
                backend: "wasm",
                wasmPaths: ORT_WASM_PATH,
                numThreads: 1,
                simd: true,
            },
        });
        setOcrInitializationPhase("ready");
        return runner;
    } catch (error) {
        if (retryCachedModels && assets.usedCache) {
            await clearOcrModelCache();
            return createRunner(false);
        }
        setOcrInitializationPhase("idle");
        throw error;
    } finally {
        assets.release();
    }
}

async function getRunner() {
    if (!runnerPromise) {
        runnerPromise = createRunner().catch((error) => {
            runnerPromise = null;
            throw error;
        });
    }
    return runnerPromise;
}

async function resizeForOcr(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= MAX_OCR_SIDE) return { blob, bitmap };

    const scale = MAX_OCR_SIDE / longestSide;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        throw new Error("无法创建 OCR 画布");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const resized = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: 0.9,
    });
    return { blob: resized, bitmap: null };
}

export async function recognizeMangaPage(
    image: Blob,
    onStage?: (stage: TranslationStage) => void,
    signal?: AbortSignal,
): Promise<OcrPageResult> {
    onStage?.("loading-model");
    const runner = await getRunner();
    if (signal?.aborted) {
        throw new DOMException("翻译已取消", "AbortError");
    }
    const prepared = await resizeForOcr(image);
    onStage?.("recognizing");
    try {
        const [result] = await runner.predict(prepared.blob);
        if (!result) throw new Error("OCR 没有返回结果");
        return {
            modelVersion: OCR_MODEL_VERSION,
            preprocessVersion: OCR_PREPROCESS_VERSION,
            sourceWidth: result.image.width,
            sourceHeight: result.image.height,
            regions: result.items
                .map((item, index) => ({
                    id: `r${index + 1}`,
                    text: item.text.trim(),
                    score: Number.isFinite(item.score) ? item.score : 0,
                    polygon: getNormalizedPolygon(
                        item.poly.map(([x, y]) => ({ x, y })),
                        result.image.width,
                        result.image.height,
                    ),
                }))
                .filter(
                    (item) => item.text.length > 0 && item.polygon.length >= 3,
                ),
        };
    } finally {
        prepared.bitmap?.close();
    }
}

export async function disposeOcrRuntime() {
    const active = runnerPromise;
    runnerPromise = null;
    if (!active) return;
    const runner = await active.catch(() => null);
    await runner?.dispose();
    setOcrInitializationPhase("idle");
}
