import assert from "node:assert/strict";
import test from "node:test";
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
    parseTranslationResponse,
    translateOcrRegions,
} from "../src/translation/llm";
import {
    DEFAULT_CONTENT_HANDLING_PROMPT,
    DEFAULT_TRANSLATION_STYLE_PROMPT,
    getChatCompletionsUrl,
    LEGACY_TRANSLATION_SETTINGS_STORAGE_KEY,
    loadTranslationSettings,
    normalizeTranslationSettings,
    PREVIOUS_TRANSLATION_SETTINGS_STORAGE_KEY,
    saveTranslationSettings,
    validateTranslationSettings,
} from "../src/translation/settings";
import {
    cancelPendingPageJobs,
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
    TranslationSettingsV3,
} from "../src/translation/types";

const settings: TranslationSettingsV3 = {
    version: 3,
    baseUrl: "https://llm.example.test/v1",
    model: "comic-translator",
    apiKey: "secret-key",
    autoTranslate: false,
    pretranslateRange: 2,
    translationConcurrency: 1,
    reasoningMode: "off",
    reasoningEffort: "medium",
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
    assert.equal(
        getChatCompletionsUrl(normalized),
        "https://llm.example.test/v1/chat/completions",
    );
    assert.equal(validateTranslationSettings(normalized), null);
    saveTranslationSettings(storage, normalized);
    assert.deepEqual(loadTranslationSettings(storage), normalized);
    assert.match(values.values().next().value ?? "", /key-a/);
    assert.ok(validateTranslationSettings({ ...normalized, apiKey: "" }));
    assert.equal(normalized.autoTranslate, false);
    assert.equal(normalized.pretranslateRange, 2);
    assert.equal(normalized.translationConcurrency, 1);
    assert.equal(normalized.reasoningMode, "off");
    assert.equal(normalized.reasoningEffort, "medium");
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
        version: 3,
        baseUrl: "https://legacy.example/v1",
        model: "legacy-model",
        apiKey: "legacy-key",
        autoTranslate: false,
        pretranslateRange: 2,
        translationConcurrency: 1,
        reasoningMode: "off",
        reasoningEffort: "medium",
        translationStylePrompt: DEFAULT_TRANSLATION_STYLE_PROMPT,
        contentHandlingPrompt: DEFAULT_CONTENT_HANDLING_PROMPT,
    });
    saveTranslationSettings(storage, migrated);
    assert.equal(values.has(LEGACY_TRANSLATION_SETTINGS_STORAGE_KEY), false);
});

test("migrates V2 settings and preserves intentionally empty prompts", () => {
    const values = new Map<string, string>([
        [
            PREVIOUS_TRANSLATION_SETTINGS_STORAGE_KEY,
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
    assert.equal(migrated.version, 3);
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
    assert.equal(values.has(PREVIOUS_TRANSLATION_SETTINGS_STORAGE_KEY), false);
    assert.deepEqual(loadTranslationSettings(storage), empty);
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
            translationStylePrompt: "another style",
        }),
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
});

test("strictly parses complete translation JSON", () => {
    const result = parseTranslationResponse(
        '```json\n{"translations":[{"id":"r1","translation":"你好"}]}\n```',
        ["r1"],
    );
    assert.equal(result.get("r1"), "你好");
    assert.throws(
        () => parseTranslationResponse('{"translations":[]}', ["r1"]),
        /全部文本框/,
    );
    assert.throws(
        () =>
            parseTranslationResponse(
                '{"translations":[{"id":"r2","translation":"你好"}]}',
                ["r1"],
            ),
        /未知或重复/,
    );
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
                                '{"translations":[{"id":"r1","translation":"你好"}]}',
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
    assert.equal(output.get("r1"), "你好");
    assert.match(JSON.stringify(body), /こんにちは/);
    assert.doesNotMatch(JSON.stringify(body), /data:image|blob:/);
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
                                '{"translations":[{"id":"r1","translation":"你好"}]}',
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
