import assert from "node:assert/strict";
import test from "node:test";
import { resolveBackendUrl } from "../src/backend-url";
import {
    buildOcrCacheKey,
    buildTranslationCacheKey,
    getPromptKey,
    getProviderKey,
    getTranslationRequestKey,
} from "../src/translation/cache";
import {
    getContainedImageRect,
    getNormalizedPolygon,
    getPolygonBounds,
} from "../src/translation/geometry";
import {
    buildTranslationSystemPrompt,
    LLM_PROXY_TARGET_HEADER,
    parseTranslationResponse,
    translateOcrRegions,
} from "../src/translation/llm";
import { detectOcrPageStatus } from "../src/translation/language";
import {
    DEFAULT_CONTENT_HANDLING_PROMPT,
    DEFAULT_TRANSLATION_STYLE_PROMPT,
    getTranslationApiUrl,
    LEGACY_TRANSLATION_SETTINGS_STORAGE_KEY,
    loadTranslationSettings,
    normalizeTranslationSettings,
    PREVIOUS_TRANSLATION_SETTINGS_STORAGE_KEY,
    saveTranslationSettings,
    V2_TRANSLATION_SETTINGS_STORAGE_KEY,
    V3_TRANSLATION_SETTINGS_STORAGE_KEY,
    V4_TRANSLATION_SETTINGS_STORAGE_KEY,
    validateTranslationSettings,
} from "../src/translation/settings";
import {
    prepareOcrModelAssets,
    subscribeOcrInitializationProgress,
} from "../src/translation/ocr-models";
import {
    cancelPendingPageJobs,
    countActiveTranslationJobs,
    getTranslationWindow,
    partitionTranslationJobs,
    pauseAutoJobs,
    prioritizeManualJob,
    reconcileAutoJobs,
    runSerializedOcr,
    type ContextualTranslationJob,
    type SchedulableTranslationJob,
} from "../src/translation/scheduler";
import { loadTranslationImageBlob } from "../src/translation/service";
import type {
    OcrPageResult,
    ReasoningEffort,
    TranslationSettingsV6,
} from "../src/translation/types";

const settings: TranslationSettingsV6 = {
    version: 6,
    apiProtocol: "chat-completions",
    baseUrl: "https://llm.example.test/v1",
    model: "comic-translator",
    apiKey: "secret-key",
    useWorkerProxy: false,
    autoTranslate: false,
    pretranslateRange: 2,
    translationConcurrency: 1,
    reasoningMode: "off",
    reasoningEffort: "medium",
    smartSkipSoundEffects: true,
    translationStylePrompt: DEFAULT_TRANSLATION_STYLE_PROMPT,
    contentHandlingPrompt: DEFAULT_CONTENT_HANDLING_PROMPT,
};

const ocr: OcrPageResult = {
    modelVersion: "ppocr-v5-mobile-ja@1",
    preprocessVersion: "max-1600@1",
    sourceWidth: 1000,
    sourceHeight: 1500,
    regions: [
        {
            id: "r1",
            text: "こんにちは",
            score: 0.97,
            polygon: [
                { x: 0.1, y: 0.2 },
                { x: 0.3, y: 0.2 },
                { x: 0.3, y: 0.3 },
                { x: 0.1, y: 0.3 },
            ],
        },
    ],
};

function createMemoryCacheStorage() {
    const stores = new Map<string, Map<string, Response>>();
    const storage = {
        async open(name: string) {
            let store = stores.get(name);
            if (!store) {
                store = new Map();
                stores.set(name, store);
            }
            return {
                async match(input: RequestInfo | URL) {
                    const key =
                        input instanceof Request ? input.url : String(input);
                    return store.get(key)?.clone();
                },
                async put(input: RequestInfo | URL, response: Response) {
                    const key =
                        input instanceof Request ? input.url : String(input);
                    store.set(key, response.clone());
                },
                async delete(input: RequestInfo | URL) {
                    const key =
                        input instanceof Request ? input.url : String(input);
                    return store.delete(key);
                },
            } as Cache;
        },
        async keys() {
            return [...stores.keys()];
        },
        async delete(name: string) {
            return stores.delete(name);
        },
    } as CacheStorage;
    return storage;
}

test("resolves the shared Worker URL for local network development", () => {
    assert.equal(
        resolveBackendUrl({
            rawUrl: "http://localhost:8787",
            development: true,
            hostname: "192.168.1.20",
        }),
        "http://192.168.1.20:8787",
    );
    assert.equal(
        resolveBackendUrl({
            rawUrl: "https://worker.example.com",
            development: false,
            hostname: "ignored.example.com",
        }),
        "https://worker.example.com",
    );
});

test("streams OCR model downloads and reuses the persistent cache", async () => {
    const cacheStorage = createMemoryCacheStorage();
    const progress: Array<{
        phase: string;
        loadedBytes: number;
        totalBytes: number | null;
    }> = [];
    const unsubscribe = subscribeOcrInitializationProgress((value) => {
        progress.push(value);
    });
    let fetchCount = 0;
    let objectUrlCount = 0;
    const fetchImpl: typeof fetch = async () => {
        fetchCount += 1;
        const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
        return new Response(
            new ReadableStream({
                pull(controller) {
                    const chunk = chunks.shift();
                    if (chunk) controller.enqueue(chunk);
                    else controller.close();
                },
            }),
            { headers: { "Content-Length": "4" } },
        );
    };
    const options = {
        cacheStorage,
        fetchImpl,
        createObjectURL: (blob: Blob) =>
            `blob:model-${blob.size}-${++objectUrlCount}`,
        revokeObjectURL: () => {},
    };

    const first = await prepareOcrModelAssets(options);
    assert.equal(fetchCount, 2);
    assert.equal(first.usedCache, false);
    assert.match(first.detectionUrl, /^blob:model-4-/);
    assert.equal(
        progress.some(
            (value) =>
                value.phase === "downloading" &&
                value.loadedBytes === 8 &&
                value.totalBytes === 8,
        ),
        true,
    );
    first.release();

    const second = await prepareOcrModelAssets(options);
    assert.equal(fetchCount, 2);
    assert.equal(second.usedCache, true);
    second.release();
    unsubscribe();
});

test("reports indeterminate OCR progress without Content-Length", async () => {
    const observedTotals: Array<number | null> = [];
    const unsubscribe = subscribeOcrInitializationProgress((value) => {
        if (value.phase === "downloading") {
            observedTotals.push(value.totalBytes);
        }
    });
    const prepared = await prepareOcrModelAssets({
        cacheStorage: null,
        fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])),
        createObjectURL: () => "blob:model",
        revokeObjectURL: () => {},
    });
    assert.equal(observedTotals.includes(null), true);
    prepared.release();
    unsubscribe();
});

test("loads a non-resident page directly for OCR without fetching a blob URL", async () => {
    const controller = new AbortController();
    let loaderSignal: AbortSignal | null = null;
    const blob = await loadTranslationImageBlob({
        loadImageBlob: async (signal) => {
            loaderSignal = signal;
            return new Blob(["processed-page"], { type: "image/jpeg" });
        },
        fetchImpl: (() => {
            throw new Error("blob URL fetch should not run");
        }) as typeof fetch,
        signal: controller.signal,
    });

    assert.equal(loaderSignal, controller.signal);
    assert.equal(await blob.text(), "processed-page");
});

test("normalizes and persists BYOK settings, including the API key", () => {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
    const normalized = normalizeTranslationSettings({
        baseUrl: " https://llm.example.test/v1/chat/completions/ ",
        model: " model-a ",
        apiKey: " key-a ",
    });
    assert.equal(normalized.baseUrl, "https://llm.example.test/v1");
    assert.equal(normalized.apiProtocol, "chat-completions");
    assert.equal(
        getTranslationApiUrl(normalized),
        "https://llm.example.test/v1/chat/completions",
    );
    const responses = normalizeTranslationSettings({
        ...normalized,
        apiProtocol: "responses",
        baseUrl: "https://llm.example.test/v1/responses/",
    });
    assert.equal(responses.baseUrl, "https://llm.example.test/v1");
    assert.equal(
        getTranslationApiUrl(responses),
        "https://llm.example.test/v1/responses",
    );
    assert.equal(validateTranslationSettings(normalized), null);
    saveTranslationSettings(storage, normalized);
    assert.deepEqual(loadTranslationSettings(storage), normalized);
    assert.match(values.values().next().value ?? "", /key-a/);
    assert.ok(validateTranslationSettings({ ...normalized, apiKey: "" }));
    assert.match(
        validateTranslationSettings({
            ...normalized,
            baseUrl: "http://llm.example.test/v1",
            useWorkerProxy: true,
        }) ?? "",
        /HTTPS/,
    );
    assert.equal(normalized.autoTranslate, false);
    assert.equal(normalized.pretranslateRange, 2);
    assert.equal(normalized.translationConcurrency, 1);
    assert.equal(normalized.useWorkerProxy, false);
    assert.equal(normalized.reasoningMode, "off");
    assert.equal(normalized.reasoningEffort, "medium");
    assert.equal(normalized.smartSkipSoundEffects, true);
    assert.equal(
        normalized.translationStylePrompt,
        DEFAULT_TRANSLATION_STYLE_PROMPT,
    );
    assert.equal(
        normalized.contentHandlingPrompt,
        DEFAULT_CONTENT_HANDLING_PROMPT,
    );
    assert.equal(
        normalizeTranslationSettings({ baseUrl: "javascript:alert(1)" })
            .baseUrl,
        "",
    );
});

test("migrates V1 settings without losing credentials", () => {
    const values = new Map<string, string>([
        [
            LEGACY_TRANSLATION_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                version: 1,
                baseUrl: "https://legacy.example/v1",
                model: "legacy-model",
                apiKey: "legacy-key",
            }),
        ],
    ]);
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
    const migrated = loadTranslationSettings(storage);
    assert.deepEqual(migrated, {
        version: 6,
        apiProtocol: "chat-completions",
        baseUrl: "https://legacy.example/v1",
        model: "legacy-model",
        apiKey: "legacy-key",
        useWorkerProxy: false,
        autoTranslate: false,
        pretranslateRange: 2,
        translationConcurrency: 1,
        reasoningMode: "off",
        reasoningEffort: "medium",
        smartSkipSoundEffects: true,
        translationStylePrompt: DEFAULT_TRANSLATION_STYLE_PROMPT,
        contentHandlingPrompt: DEFAULT_CONTENT_HANDLING_PROMPT,
    });
    saveTranslationSettings(storage, migrated);
    assert.equal(values.has(LEGACY_TRANSLATION_SETTINGS_STORAGE_KEY), false);
});

test("migrates V2 settings and preserves intentionally empty prompts", () => {
    const values = new Map<string, string>([
        [
            V2_TRANSLATION_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                version: 2,
                baseUrl: "https://v2.example/v1",
                model: "v2-model",
                apiKey: "v2-key",
                autoTranslate: true,
                pretranslateRange: 3,
                translationConcurrency: 4,
                reasoningMode: "on",
                reasoningEffort: "high",
            }),
        ],
    ]);
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
    const migrated = loadTranslationSettings(storage);
    assert.equal(migrated.version, 6);
    assert.equal(migrated.apiProtocol, "chat-completions");
    assert.equal(migrated.translationConcurrency, 4);
    assert.equal(
        migrated.translationStylePrompt,
        DEFAULT_TRANSLATION_STYLE_PROMPT,
    );
    assert.equal(
        migrated.contentHandlingPrompt,
        DEFAULT_CONTENT_HANDLING_PROMPT,
    );

    const empty = normalizeTranslationSettings({
        ...migrated,
        translationStylePrompt: "  ",
        contentHandlingPrompt: "",
    });
    assert.equal(empty.translationStylePrompt, "");
    assert.equal(empty.contentHandlingPrompt, "");
    saveTranslationSettings(storage, empty);
    assert.equal(values.has(V2_TRANSLATION_SETTINGS_STORAGE_KEY), false);
    assert.deepEqual(loadTranslationSettings(storage), empty);
});

test("migrates V3 settings with smart skipping enabled by default", () => {
    const values = new Map<string, string>([
        [
            V3_TRANSLATION_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settings,
                version: 3,
                apiProtocol: undefined,
                apiKey: "v3-key",
                smartSkipSoundEffects: undefined,
            }),
        ],
    ]);
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
    const migrated = loadTranslationSettings(storage);
    assert.equal(migrated.version, 6);
    assert.equal(migrated.apiProtocol, "chat-completions");
    assert.equal(migrated.apiKey, "v3-key");
    assert.equal(migrated.smartSkipSoundEffects, true);
    saveTranslationSettings(storage, migrated);
    assert.equal(values.has(V3_TRANSLATION_SETTINGS_STORAGE_KEY), false);
});

test("migrates V4 settings to Chat Completions", () => {
    const values = new Map<string, string>([
        [
            V4_TRANSLATION_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settings,
                version: 4,
                apiProtocol: undefined,
                apiKey: "v4-key",
            }),
        ],
    ]);
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
    const migrated = loadTranslationSettings(storage);
    assert.equal(migrated.version, 6);
    assert.equal(migrated.apiProtocol, "chat-completions");
    assert.equal(migrated.apiKey, "v4-key");
    saveTranslationSettings(storage, migrated);
    assert.equal(values.has(V4_TRANSLATION_SETTINGS_STORAGE_KEY), false);
});

test("migrates V5 settings with the Worker proxy disabled", () => {
    const values = new Map<string, string>([
        [
            PREVIOUS_TRANSLATION_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settings,
                version: 5,
                apiProtocol: "responses",
                useWorkerProxy: undefined,
            }),
        ],
    ]);
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
    const migrated = loadTranslationSettings(storage);
    assert.equal(migrated.version, 6);
    assert.equal(migrated.apiProtocol, "responses");
    assert.equal(migrated.useWorkerProxy, false);
    saveTranslationSettings(storage, migrated);
    assert.equal(values.has(PREVIOUS_TRANSLATION_SETTINGS_STORAGE_KEY), false);
});

test("clamps automatic translation settings and validates reasoning values", () => {
    assert.equal(
        normalizeTranslationSettings({ pretranslateRange: 99 })
            .pretranslateRange,
        5,
    );
    assert.equal(
        normalizeTranslationSettings({ pretranslateRange: -4 })
            .pretranslateRange,
        0,
    );
    assert.equal(
        normalizeTranslationSettings({ translationConcurrency: 99 })
            .translationConcurrency,
        6,
    );
    assert.equal(
        normalizeTranslationSettings({ translationConcurrency: 0 })
            .translationConcurrency,
        1,
    );
    assert.equal(
        normalizeTranslationSettings({
            reasoningMode: "invalid" as never,
            reasoningEffort: "extreme" as never,
        }).reasoningMode,
        "off",
    );
});

test("runs OCR tasks serially even when pages are scheduled concurrently", async () => {
    let active = 0;
    let maximumActive = 0;
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });

    const first = runSerializedOcr(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push("first:start");
        await firstGate;
        order.push("first:end");
        active -= 1;
        return 1;
    });
    const second = runSerializedOcr(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push("second:start");
        active -= 1;
        return 2;
    });

    await Promise.resolve();
    assert.deepEqual(order, ["first:start"]);
    releaseFirst?.();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.equal(maximumActive, 1);
    assert.deepEqual(order, ["first:start", "first:end", "second:start"]);
});

test("normalizes OCR geometry and object-contain placement", () => {
    const polygon = getNormalizedPolygon(
        [
            { x: -10, y: 50 },
            { x: 210, y: 150 },
        ],
        200,
        100,
    );
    assert.deepEqual(polygon, [
        { x: 0, y: 0.5 },
        { x: 1, y: 1 },
    ]);
    assert.deepEqual(getPolygonBounds(polygon), {
        left: 0,
        top: 0.5,
        width: 1,
        height: 0.5,
    });
    assert.deepEqual(
        getContainedImageRect({
            elementWidth: 1000,
            elementHeight: 1000,
            naturalWidth: 1000,
            naturalHeight: 2000,
        }),
        { left: 250, top: 0, width: 500, height: 1000 },
    );
});

test("translation cache keys ignore API keys and include OCR/provider versions", () => {
    const ocrKey = buildOcrCacheKey("chapter/page.jpg", ocr);
    const first = buildTranslationCacheKey(ocrKey, ocr, settings);
    assert.equal(
        getProviderKey(settings),
        getProviderKey({ ...settings, apiKey: "rotated-key" }),
    );
    assert.equal(
        first,
        buildTranslationCacheKey(ocrKey, ocr, {
            ...settings,
            apiKey: "rotated-key",
        }),
    );
    assert.notEqual(
        first,
        buildTranslationCacheKey(ocrKey, ocr, {
            ...settings,
            model: "model-b",
        }),
    );
    assert.notEqual(
        first,
        buildTranslationCacheKey(ocrKey, ocr, {
            ...settings,
            apiProtocol: "responses",
        }),
    );
    assert.equal(
        getProviderKey(settings),
        getProviderKey({
            ...settings,
            translationStylePrompt: "another style",
        }),
    );
    assert.notEqual(
        getPromptKey(settings),
        getPromptKey({
            ...settings,
            translationStylePrompt: "another style",
        }),
    );
    assert.notEqual(
        getPromptKey(settings),
        getPromptKey({ ...settings, smartSkipSoundEffects: false }),
    );
    assert.notEqual(
        first,
        buildTranslationCacheKey(ocrKey, ocr, {
            ...settings,
            contentHandlingPrompt: "another content policy",
        }),
    );
    assert.notEqual(
        first,
        buildTranslationCacheKey(
            ocrKey,
            {
                ...ocr,
                regions: [{ ...ocr.regions[0]!, text: "こんばんは" }],
            },
            settings,
        ),
    );
    assert.notEqual(
        first,
        buildTranslationCacheKey(ocrKey, ocr, {
            ...settings,
            reasoningMode: "on",
            reasoningEffort: "high",
        }),
    );
});

test("request identity includes credentials but ignores scheduler settings", () => {
    const requestKey = getTranslationRequestKey(settings);
    assert.notEqual(
        requestKey,
        getTranslationRequestKey({ ...settings, apiKey: "rotated-key" }),
    );
    assert.notEqual(
        requestKey,
        getTranslationRequestKey({ ...settings, model: "model-b" }),
    );
    assert.notEqual(
        requestKey,
        getTranslationRequestKey({
            ...settings,
            apiProtocol: "responses",
        }),
    );
    assert.notEqual(
        requestKey,
        getTranslationRequestKey({
            ...settings,
            translationStylePrompt: "another style",
        }),
    );
    assert.notEqual(
        requestKey,
        getTranslationRequestKey({
            ...settings,
            smartSkipSoundEffects: false,
        }),
    );
    assert.notEqual(
        requestKey,
        getTranslationRequestKey({ ...settings, useWorkerProxy: true }),
    );
    assert.equal(
        getProviderKey(settings),
        getProviderKey({ ...settings, useWorkerProxy: true }),
    );
    assert.equal(
        requestKey,
        getTranslationRequestKey({
            ...settings,
            autoTranslate: true,
            pretranslateRange: 5,
            translationConcurrency: 6,
        }),
    );
});

test("builds a symmetric, forward-prioritized translation window", () => {
    assert.deepEqual(getTranslationWindow(5, 12, 2), [5, 6, 4, 7, 3]);
    assert.deepEqual(getTranslationWindow(0, 4, 3), [0, 1, 2, 3]);
    assert.deepEqual(getTranslationWindow(3, 4, 3), [3, 2, 1, 0]);
    assert.deepEqual(getTranslationWindow(0, 0, 2), []);
});

test("reconciles auto jobs, prioritizes manual work, and pauses auto work", () => {
    const job = (
        pageKey: string,
        source: "manual" | "auto",
    ): SchedulableTranslationJob => ({
        pageKey,
        completionKey: `${pageKey}:provider`,
        source,
    });
    const pending = [job("manual", "manual"), job("old-auto", "auto")];
    const reconciled = reconcileAutoJobs(
        pending,
        [job("next", "auto"), job("next", "auto"), job("active", "auto")],
        new Set(["active:provider"]),
    );
    assert.deepEqual(
        reconciled.map((item) => item.pageKey),
        ["manual", "next"],
    );
    const prioritized = prioritizeManualJob(
        [...reconciled, job("current", "auto")],
        job("current", "manual"),
    );
    assert.deepEqual(
        prioritized.map((item) => `${item.source}:${item.pageKey}`),
        ["manual:current", "manual:manual", "auto:next"],
    );
    assert.deepEqual(
        pauseAutoJobs(prioritized).map((item) => item.pageKey),
        ["current", "manual"],
    );
    const cancelled = cancelPendingPageJobs(prioritized, "current");
    assert.deepEqual(
        cancelled.cancelled.map((item) => item.pageKey),
        ["current"],
    );
    assert.deepEqual(
        cancelled.remaining.map((item) => item.pageKey),
        ["manual", "next"],
    );
    assert.equal(
        countActiveTranslationJobs(
            [{ id: "cancelled" }, { id: "retry" }],
            new Set(["cancelled"]),
        ),
        1,
    );
});

test("keeps only jobs relevant to the current chapter and translation context", () => {
    const job = ({
        pageKey,
        source,
        chapterId = "chapter-a",
        requestKey = "request-current",
    }: {
        pageKey: string;
        source: "manual" | "auto";
        chapterId?: string;
        requestKey?: string;
    }): ContextualTranslationJob => ({
        pageKey,
        completionKey: `${pageKey}:provider`,
        source,
        chapterId,
        requestKey,
    });
    const jobs = [
        job({ pageKey: "chapter-a/page-5", source: "manual" }),
        job({ pageKey: "chapter-a/page-4", source: "manual" }),
        job({ pageKey: "chapter-a/page-6", source: "auto" }),
        job({ pageKey: "chapter-a/page-9", source: "auto" }),
        job({
            pageKey: "chapter-b/page-6",
            source: "auto",
            chapterId: "chapter-b",
        }),
        job({
            pageKey: "chapter-a/page-5",
            source: "auto",
            requestKey: "request-old",
        }),
    ];
    const context = {
        chapterId: "chapter-a",
        requestKey: "request-current",
        currentPageKey: "chapter-a/page-5",
        autoEnabled: true,
        autoPageKeys: new Set(["chapter-a/page-5", "chapter-a/page-6"]),
    };
    const active = partitionTranslationJobs(jobs, context);
    assert.deepEqual(
        active.kept.map((item) => `${item.source}:${item.pageKey}`),
        ["manual:chapter-a/page-5", "auto:chapter-a/page-6"],
    );
    assert.equal(active.stale.length, 4);

    const autoDisabled = partitionTranslationJobs(jobs, {
        ...context,
        autoEnabled: false,
    });
    assert.deepEqual(
        autoDisabled.kept.map((item) => `${item.source}:${item.pageKey}`),
        ["manual:chapter-a/page-5"],
    );
    assert.equal(
        partitionTranslationJobs(jobs, {
            ...context,
            chapterId: null,
            requestKey: null,
        }).kept.length,
        0,
    );
});

test("composes editable prompts before the immutable JSON protocol", () => {
    const prompt = buildTranslationSystemPrompt({
        ...settings,
        translationStylePrompt: "STYLE_MARKER",
        contentHandlingPrompt: "CONTENT_MARKER",
    });
    assert.ok(
        prompt.indexOf("STYLE_MARKER") < prompt.indexOf("CONTENT_MARKER"),
    );
    assert.ok(
        prompt.indexOf("CONTENT_MARKER") < prompt.indexOf("Output protocol"),
    );
    assert.match(prompt, /Return JSON only/);

    const emptyPrompt = buildTranslationSystemPrompt({
        ...settings,
        translationStylePrompt: "",
        contentHandlingPrompt: "",
    });
    assert.doesNotMatch(
        emptyPrompt,
        /\[Translation style\]|\[Content handling\]/,
    );
    assert.match(emptyPrompt, /Output protocol/);
    assert.match(
        buildTranslationSystemPrompt({
            ...settings,
            smartSkipSoundEffects: false,
        }),
        /Do not use the sound_effect skip reason/,
    );
});

test("strictly parses complete translation JSON", () => {
    const result = parseTranslationResponse(
        '```json\n{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"translate","translation":"你好"}]}\n```',
        ["r1"],
        true,
    );
    assert.equal(result.pageStatus, "needs_translation");
    assert.deepEqual(result.decisions.get("r1"), {
        action: "translate",
        translation: "你好",
    });
    const chinese = parseTranslationResponse(
        '{"pageStatus":"already_chinese","translations":[{"id":"r1","action":"skip","reason":"already_chinese"}]}',
        ["r1"],
        false,
    );
    assert.equal(chinese.pageStatus, "already_chinese");
    assert.deepEqual(chinese.decisions.get("r1"), {
        action: "skip",
        reason: "already_chinese",
    });
    assert.deepEqual(
        parseTranslationResponse(
            '{"pageStatus":"mixed","translations":[{"id":"r1","action":"skip","reason":"ocr_noise"}]}',
            ["r1"],
            false,
        ).decisions.get("r1"),
        { action: "skip", reason: "ocr_noise" },
    );
    assert.throws(
        () =>
            parseTranslationResponse(
                '{"pageStatus":"needs_translation","translations":[]}',
                ["r1"],
                true,
            ),
        /全部文本框/,
    );
    assert.throws(
        () =>
            parseTranslationResponse(
                '{"pageStatus":"unknown","translations":[{"id":"r1","action":"translate","translation":"你好"}]}',
                ["r1"],
                true,
            ),
        /页面语言状态/,
    );
    assert.throws(
        () =>
            parseTranslationResponse(
                '{"pageStatus":"needs_translation","translations":[{"id":"r2","action":"translate","translation":"你好"}]}',
                ["r1"],
                true,
            ),
        /未知或重复/,
    );
    assert.throws(
        () =>
            parseTranslationResponse(
                '{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"skip","reason":"sound_effect"}]}',
                ["r1"],
                false,
            ),
        /关闭智能跳过/,
    );
});

test("detects predominantly Chinese OCR locally before calling the LLM", async () => {
    const chineseRegions = [
        {
            ...ocr.regions[0]!,
            text: "这是已经翻译完成的中文漫画页面，不需要再次翻译。",
        },
    ];
    assert.equal(detectOcrPageStatus(chineseRegions), "already_chinese");
    assert.equal(
        detectOcrPageStatus([{ ...ocr.regions[0]!, text: "中文短句" }]),
        null,
    );
    assert.equal(
        detectOcrPageStatus([
            {
                ...ocr.regions[0]!,
                text: "今日は漫画を読んで、楽しい時間を過ごしましょう。",
            },
        ]),
        null,
    );

    let requested = false;
    const result = await translateOcrRegions({
        settings,
        regions: chineseRegions,
        fetchImpl: async () => {
            requested = true;
            throw new Error("Chinese pages must not call the LLM");
        },
    });
    assert.equal(requested, false);
    assert.equal(result.pageStatus, "already_chinese");
    assert.deepEqual(result.decisions.get("r1"), {
        action: "skip",
        reason: "already_chinese",
    });
});

test("sends only OCR text and geometry to the OpenAI-compatible endpoint", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            content:
                                '{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"translate","translation":"你好"}]}',
                        },
                    },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };
    const output = await translateOcrRegions({
        settings,
        regions: ocr.regions,
        fetchImpl,
    });
    const body = JSON.parse(String(requestInit?.body));
    assert.equal(requestUrl, "https://llm.example.test/v1/chat/completions");
    assert.equal(
        (requestInit?.headers as Record<string, string>).Authorization,
        "Bearer secret-key",
    );
    assert.equal(output.pageStatus, "needs_translation");
    assert.deepEqual(output.decisions.get("r1"), {
        action: "translate",
        translation: "你好",
    });
    assert.match(JSON.stringify(body), /こんにちは/);
    assert.doesNotMatch(JSON.stringify(body), /data:image|blob:/);
    assert.deepEqual(body.messages[1].content.includes('"polygon"'), true);
    assert.deepEqual(body.messages[1].content.includes('"position"'), false);
    assert.equal(body.reasoning_effort, "none");
    assert.equal("temperature" in body, false);
    const systemPrompt = body.messages[0].content as string;
    assert.match(systemPrompt, /成人向漫画/);
    assert.match(systemPrompt, /敏感内容按原意翻译/);
    assert.ok(
        systemPrompt.lastIndexOf("Output protocol") >
            systemPrompt.indexOf("成人向漫画"),
    );
});

test("routes LLM requests through the Worker proxy when enabled", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            content:
                                '{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"translate","translation":"你好"}]}',
                        },
                    },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    const output = await translateOcrRegions({
        settings: { ...settings, useWorkerProxy: true },
        regions: ocr.regions,
        fetchImpl,
        workerBaseUrl: "https://worker.example.test/base/",
    });

    const headers = requestInit?.headers as Record<string, string>;
    assert.equal(requestUrl, "https://worker.example.test/llm-proxy");
    assert.equal(
        headers[LLM_PROXY_TARGET_HEADER],
        "https://llm.example.test/v1/chat/completions",
    );
    assert.equal(headers.Authorization, "Bearer secret-key");
    assert.match(String(requestInit?.body), /こんにちは/);
    assert.deepEqual(output.decisions.get("r1"), {
        action: "translate",
        translation: "你好",
    });
});

test("reports a missing Worker URL before starting a proxied request", async () => {
    await assert.rejects(
        translateOcrRegions({
            settings: { ...settings, useWorkerProxy: true },
            regions: ocr.regions,
            fetchImpl: async () => {
                throw new Error("request should not start");
            },
            workerBaseUrl: "",
        }),
        (error: unknown) =>
            error instanceof Error &&
            error.message === "Worker 代理不可用，请检查 VITE_BACKEND_URL",
    );
});

test("uses the OpenAI Responses API request and output shapes", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(
            JSON.stringify({
                output: [
                    { type: "reasoning", summary: [] },
                    {
                        type: "message",
                        content: [
                            {
                                type: "output_text",
                                text: '{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"translate","translation":"你好"}]}',
                            },
                        ],
                    },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };
    const output = await translateOcrRegions({
        settings: {
            ...settings,
            apiProtocol: "responses",
            reasoningMode: "on",
            reasoningEffort: "high",
        },
        regions: ocr.regions,
        fetchImpl,
    });
    const body = JSON.parse(String(requestInit?.body));
    assert.equal(requestUrl, "https://llm.example.test/v1/responses");
    assert.equal(
        (requestInit?.headers as Record<string, string>).Authorization,
        "Bearer secret-key",
    );
    assert.equal(body.model, "comic-translator");
    assert.deepEqual(body.reasoning, { effort: "high" });
    assert.equal(body.store, false);
    assert.match(body.instructions, /Output protocol/);
    assert.match(body.input, /こんにちは/);
    assert.match(body.input, /polygon/);
    assert.equal("messages" in body, false);
    assert.equal("reasoning_effort" in body, false);
    assert.equal("temperature" in body, false);
    assert.deepEqual(output.decisions.get("r1"), {
        action: "translate",
        translation: "你好",
    });
});

test("distinguishes an explicit LLM cancellation from a timeout", async () => {
    const controller = new AbortController();
    controller.abort("user-cancel");
    const fetchImpl: typeof fetch = async (_input, init) => {
        assert.equal(init?.signal?.aborted, true);
        throw new DOMException("aborted", "AbortError");
    };
    await assert.rejects(
        translateOcrRegions({
            settings,
            regions: ocr.regions,
            fetchImpl,
            signal: controller.signal,
        }),
        (error: unknown) =>
            error instanceof Error &&
            error.message === "翻译已取消" &&
            "code" in error &&
            error.code === "cancelled",
    );
});

test("supports provider-default and every configured reasoning effort", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            content:
                                '{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"translate","translation":"你好"}]}',
                        },
                    },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    await translateOcrRegions({
        settings: { ...settings, reasoningMode: "provider-default" },
        regions: ocr.regions,
        fetchImpl,
    });
    assert.equal("reasoning_effort" in requestBodies.at(-1)!, false);

    const efforts: ReasoningEffort[] = [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    ];
    for (const reasoningEffort of efforts) {
        await translateOcrRegions({
            settings: {
                ...settings,
                reasoningMode: "on",
                reasoningEffort,
            },
            regions: ocr.regions,
            fetchImpl,
        });
        const body = requestBodies.at(-1)!;
        assert.equal(body.reasoning_effort, reasoningEffort);
        assert.equal("temperature" in body, false);
    }
});
