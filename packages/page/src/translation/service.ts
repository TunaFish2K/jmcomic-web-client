import {
    buildOcrCacheKey,
    buildPageKey,
    buildTranslationCacheKey,
    getCachedOcrResult,
    getCachedTranslation,
    getProviderKey,
    getPromptKey,
    setCachedOcrResult,
    setCachedTranslation,
} from "./cache";
import { translateOcrRegions } from "./llm";
import { recognizeMangaPage } from "./ocr";
import { runSerializedOcr } from "./scheduler";
import {
    OCR_MODEL_VERSION,
    OCR_PREPROCESS_VERSION,
    TRANSLATION_PROMPT_VERSION,
    type OcrPageResult,
    type PageTranslationRecord,
    type TranslationSettingsV4,
    type TranslationStage,
} from "./types";

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DOMException("翻译已取消", "AbortError");
    }
}

function getOcrKey(pageKey: string) {
    return buildOcrCacheKey(pageKey, {
        modelVersion: OCR_MODEL_VERSION,
        preprocessVersion: OCR_PREPROCESS_VERSION,
        sourceWidth: 0,
        sourceHeight: 0,
        regions: [],
    });
}

export type LoadTranslationImageBlob = (signal: AbortSignal) => Promise<Blob>;

export async function loadTranslationImageBlob({
    imageUrl,
    loadImageBlob,
    fetchImpl = fetch,
    signal,
}: {
    imageUrl?: string;
    loadImageBlob?: LoadTranslationImageBlob;
    fetchImpl?: typeof fetch;
    signal: AbortSignal;
}) {
    throwIfAborted(signal);
    if (imageUrl) {
        const imageResponse = await fetchImpl(imageUrl, { signal });
        if (!imageResponse.ok) {
            throw new Error(
                `读取当前页图片失败（HTTP ${imageResponse.status}）`,
            );
        }
        return imageResponse.blob();
    }
    if (loadImageBlob) return loadImageBlob(signal);
    throw new Error("当前页图片仍在加载，请稍后重试");
}

export async function getCachedPageTranslation({
    chapterId,
    imageName,
    settings,
}: {
    chapterId: string;
    imageName: string;
    settings: TranslationSettingsV4;
}) {
    const pageKey = buildPageKey(chapterId, imageName);
    const ocrKey = getOcrKey(pageKey);
    const ocr = await getCachedOcrResult(ocrKey);
    if (!ocr) return null;
    return getCachedTranslation(
        buildTranslationCacheKey(ocrKey, ocr, settings),
    );
}

export async function translatePage({
    chapterId,
    imageName,
    imageUrl,
    loadImageBlob,
    settings,
    forceTranslation = false,
    onStage,
    fetchImpl = fetch,
    signal,
}: {
    chapterId: string;
    imageName: string;
    imageUrl?: string;
    loadImageBlob?: LoadTranslationImageBlob;
    settings: TranslationSettingsV4;
    forceTranslation?: boolean;
    onStage?: (stage: TranslationStage) => void;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<PageTranslationRecord> {
    const pageKey = buildPageKey(chapterId, imageName);
    const ocrKey = getOcrKey(pageKey);
    let ocr: OcrPageResult | null = await getCachedOcrResult(ocrKey);
    throwIfAborted(signal);

    if (!ocr) {
        ocr = await runSerializedOcr(async () => {
            throwIfAborted(signal);
            const cached = await getCachedOcrResult(ocrKey);
            if (cached) return cached;

            const recognized = await recognizeMangaPage(
                await loadTranslationImageBlob({
                    imageUrl,
                    loadImageBlob,
                    fetchImpl,
                    signal: signal ?? new AbortController().signal,
                }),
                onStage,
                signal,
            );
            await setCachedOcrResult(ocrKey, pageKey, recognized);
            return recognized;
        });
    }
    throwIfAborted(signal);

    const translationKey = buildTranslationCacheKey(ocrKey, ocr, settings);
    if (!forceTranslation) {
        const cached = await getCachedTranslation(translationKey);
        throwIfAborted(signal);
        if (cached) return cached;
    }

    onStage?.("translating");
    const translated = await translateOcrRegions({
        settings,
        regions: ocr.regions,
        fetchImpl,
        signal,
    });
    throwIfAborted(signal);
    const now = Date.now();
    const record: PageTranslationRecord = {
        key: translationKey,
        ocrKey,
        pageKey,
        providerKey: getProviderKey(settings),
        promptKey: getPromptKey(settings),
        promptVersion: TRANSLATION_PROMPT_VERSION,
        sourceWidth: ocr.sourceWidth,
        sourceHeight: ocr.sourceHeight,
        sourceRegionCount: ocr.regions.length,
        skippedRegionCount: [...translated.values()].filter(
            (decision) => decision.action === "skip",
        ).length,
        regions: ocr.regions.flatMap((region) => {
            const decision = translated.get(region.id);
            return decision?.action === "translate"
                ? [{ ...region, translation: decision.translation }]
                : [];
        }),
        updatedAt: now,
        lastAccessedAt: now,
    };
    await setCachedTranslation(record);
    return record;
}
