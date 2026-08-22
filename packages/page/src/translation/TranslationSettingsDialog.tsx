import { useEffect, useRef, useState } from "react";
import {
    Eye,
    EyeOff,
    Languages,
    RefreshCw,
    RotateCcw,
    Trash2,
    X,
} from "lucide-react";
import { getTranslationCacheStats } from "./cache";
import {
    DEFAULT_CONTENT_HANDLING_PROMPT,
    DEFAULT_TRANSLATION_STYLE_PROMPT,
    MAX_PRETRANSLATE_RANGE,
    MAX_TRANSLATION_CONCURRENCY,
    MIN_PRETRANSLATE_RANGE,
    MIN_TRANSLATION_CONCURRENCY,
    normalizeTranslationSettings,
    validateTranslationSettings,
} from "./settings";
import type {
    ReasoningEffort,
    ReasoningMode,
    TranslationSettingsV3,
} from "./types";

const REASONING_MODES: Array<{ value: ReasoningMode; label: string }> = [
    { value: "provider-default", label: "跟随服务" },
    { value: "off", label: "关闭" },
    { value: "on", label: "开启" },
];

const REASONING_EFFORTS: Array<{
    value: ReasoningEffort;
    label: string;
}> = [
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "XHigh" },
    { value: "max", label: "Max" },
];

export function TranslationSettingsDialog({
    open,
    settings,
    busy,
    canRetranslate,
    onSave,
    onClearCache,
    onRetranslate,
    onClose,
}: {
    open: boolean;
    settings: TranslationSettingsV3;
    busy: boolean;
    canRetranslate: boolean;
    onSave: (settings: TranslationSettingsV3) => void;
    onClearCache: () => Promise<void>;
    onRetranslate: () => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState(settings);
    const [showKey, setShowKey] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [clearing, setClearing] = useState(false);
    const [cacheStats, setCacheStats] = useState({
        ocrPages: 0,
        translatedPages: 0,
    });
    const baseUrlRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setDraft(settings);
        setError(null);
        getTranslationCacheStats()
            .then(setCacheStats)
            .catch(() => {});
        window.setTimeout(() => baseUrlRef.current?.focus(), 0);
    }, [open, settings]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose, open]);

    if (!open) return null;

    const handleSave = () => {
        const normalized = normalizeTranslationSettings(draft);
        const nextError = validateTranslationSettings(normalized);
        if (nextError) {
            setError(nextError);
            return;
        }
        onSave(normalized);
    };

    const handleClear = async () => {
        setClearing(true);
        try {
            await onClearCache();
            setCacheStats({ ocrPages: 0, translatedPages: 0 });
        } finally {
            setClearing(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="translation-settings-title"
                className="flex max-h-[calc(100dvh-24px)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 text-white shadow-2xl"
            >
                <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
                    <h2
                        id="translation-settings-title"
                        className="flex items-center gap-2 text-sm font-semibold"
                    >
                        <Languages size={17} />
                        漫画翻译
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-white"
                        title="关闭"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="overflow-y-auto p-4">
                    <div className="space-y-4">
                        <label className="block">
                            <span className="mb-1.5 block text-xs text-gray-300">
                                OpenAI 兼容 Base URL
                            </span>
                            <input
                                ref={baseUrlRef}
                                value={draft.baseUrl}
                                onChange={(event) =>
                                    setDraft((value) => ({
                                        ...value,
                                        baseUrl: event.target.value,
                                    }))
                                }
                                spellCheck={false}
                                autoComplete="url"
                                placeholder="https://api.openai.com/v1"
                                className="h-10 w-full rounded-md border border-gray-600 bg-gray-950 px-3 text-sm outline-none transition-colors focus:border-brand-500"
                            />
                        </label>

                        <label className="block">
                            <span className="mb-1.5 block text-xs text-gray-300">
                                模型
                            </span>
                            <input
                                value={draft.model}
                                onChange={(event) =>
                                    setDraft((value) => ({
                                        ...value,
                                        model: event.target.value,
                                    }))
                                }
                                spellCheck={false}
                                autoComplete="off"
                                placeholder="gpt-4.1-mini"
                                className="h-10 w-full rounded-md border border-gray-600 bg-gray-950 px-3 text-sm outline-none transition-colors focus:border-brand-500"
                            />
                        </label>

                        <label className="block">
                            <span className="mb-1.5 block text-xs text-gray-300">
                                API Key
                            </span>
                            <div className="relative">
                                <input
                                    type={showKey ? "text" : "password"}
                                    value={draft.apiKey}
                                    onChange={(event) =>
                                        setDraft((value) => ({
                                            ...value,
                                            apiKey: event.target.value,
                                        }))
                                    }
                                    spellCheck={false}
                                    autoComplete="off"
                                    placeholder="sk-..."
                                    className="h-10 w-full rounded-md border border-gray-600 bg-gray-950 px-3 pr-10 text-sm outline-none transition-colors focus:border-brand-500"
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowKey((value) => !value)
                                    }
                                    className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center text-gray-400 hover:text-white"
                                    title={
                                        showKey
                                            ? "隐藏 API Key"
                                            : "显示 API Key"
                                    }
                                >
                                    {showKey ? (
                                        <EyeOff size={16} />
                                    ) : (
                                        <Eye size={16} />
                                    )}
                                </button>
                            </div>
                        </label>

                        <div className="border-t border-gray-700 pt-4">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-xs text-gray-300">
                                    自动翻译
                                </span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={draft.autoTranslate}
                                    onClick={() =>
                                        setDraft((value) => ({
                                            ...value,
                                            autoTranslate: !value.autoTranslate,
                                        }))
                                    }
                                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                                        draft.autoTranslate
                                            ? "bg-brand-500"
                                            : "bg-gray-600"
                                    }`}
                                >
                                    <span
                                        className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                                            draft.autoTranslate
                                                ? "translate-x-4"
                                                : "translate-x-0.5"
                                        }`}
                                    />
                                </button>
                            </div>

                            <div
                                className={`mt-4 ${
                                    draft.autoTranslate
                                        ? ""
                                        : "pointer-events-none opacity-45"
                                }`}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <label
                                        htmlFor="pretranslate-range"
                                        className="text-xs text-gray-300"
                                    >
                                        预翻译范围
                                    </label>
                                    <span className="text-xs tabular-nums text-gray-400">
                                        前后各 {draft.pretranslateRange} 页
                                    </span>
                                </div>
                                <input
                                    id="pretranslate-range"
                                    type="range"
                                    min={MIN_PRETRANSLATE_RANGE}
                                    max={MAX_PRETRANSLATE_RANGE}
                                    step={1}
                                    disabled={!draft.autoTranslate}
                                    value={draft.pretranslateRange}
                                    onChange={(event) =>
                                        setDraft((value) => ({
                                            ...value,
                                            pretranslateRange: Number.parseInt(
                                                event.target.value,
                                                10,
                                            ),
                                        }))
                                    }
                                    className="mt-2 h-1.5 w-full cursor-pointer accent-brand-500"
                                />

                                <div className="mt-4 flex items-center justify-between gap-3">
                                    <label
                                        htmlFor="translation-concurrency"
                                        className="text-xs text-gray-300"
                                    >
                                        LLM 并发
                                    </label>
                                    <span className="text-xs tabular-nums text-gray-400">
                                        {draft.translationConcurrency}
                                    </span>
                                </div>
                                <input
                                    id="translation-concurrency"
                                    type="range"
                                    min={MIN_TRANSLATION_CONCURRENCY}
                                    max={MAX_TRANSLATION_CONCURRENCY}
                                    step={1}
                                    disabled={!draft.autoTranslate}
                                    value={draft.translationConcurrency}
                                    onChange={(event) =>
                                        setDraft((value) => ({
                                            ...value,
                                            translationConcurrency:
                                                Number.parseInt(
                                                    event.target.value,
                                                    10,
                                                ),
                                        }))
                                    }
                                    className="mt-2 h-1.5 w-full cursor-pointer accent-brand-500"
                                />
                            </div>
                        </div>

                        <div className="border-t border-gray-700 pt-4">
                            <span className="mb-2 block text-xs text-gray-300">
                                思考
                            </span>
                            <div className="grid grid-cols-3 overflow-hidden rounded-md border border-gray-600">
                                {REASONING_MODES.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() =>
                                            setDraft((value) => ({
                                                ...value,
                                                reasoningMode: option.value,
                                            }))
                                        }
                                        className={`h-9 border-r border-gray-600 px-2 text-xs transition-colors last:border-r-0 ${
                                            draft.reasoningMode === option.value
                                                ? "bg-brand-500 text-brand-foreground"
                                                : "bg-gray-950 text-gray-300 hover:bg-gray-800"
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>

                            <label className="mt-3 block">
                                <span className="mb-1.5 block text-xs text-gray-300">
                                    思考等级
                                </span>
                                <select
                                    disabled={draft.reasoningMode !== "on"}
                                    value={draft.reasoningEffort}
                                    onChange={(event) =>
                                        setDraft((value) => ({
                                            ...value,
                                            reasoningEffort: event.target
                                                .value as ReasoningEffort,
                                        }))
                                    }
                                    className="h-10 w-full rounded-md border border-gray-600 bg-gray-950 px-3 text-sm outline-none transition-colors focus:border-brand-500 disabled:cursor-default disabled:opacity-45"
                                >
                                    {REASONING_EFFORTS.map((option) => (
                                        <option
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <div className="border-t border-gray-700 pt-4">
                            <div className="mb-1.5 flex items-center justify-between gap-3">
                                <label
                                    htmlFor="translation-style-prompt"
                                    className="text-xs text-gray-300"
                                >
                                    翻译风格提示词
                                </label>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setDraft((value) => ({
                                            ...value,
                                            translationStylePrompt:
                                                DEFAULT_TRANSLATION_STYLE_PROMPT,
                                        }))
                                    }
                                    className="flex h-7 w-7 items-center justify-center text-gray-400 hover:text-white"
                                    title="恢复默认翻译风格"
                                >
                                    <RotateCcw size={14} />
                                </button>
                            </div>
                            <textarea
                                id="translation-style-prompt"
                                value={draft.translationStylePrompt}
                                onChange={(event) =>
                                    setDraft((value) => ({
                                        ...value,
                                        translationStylePrompt:
                                            event.target.value,
                                    }))
                                }
                                rows={9}
                                spellCheck={false}
                                className="w-full resize-y rounded-md border border-gray-600 bg-gray-950 px-3 py-2 text-xs leading-5 outline-none transition-colors focus:border-brand-500"
                            />

                            <div className="mb-1.5 mt-4 flex items-center justify-between gap-3">
                                <label
                                    htmlFor="content-handling-prompt"
                                    className="text-xs text-gray-300"
                                >
                                    内容处理（破限）提示词
                                </label>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setDraft((value) => ({
                                            ...value,
                                            contentHandlingPrompt:
                                                DEFAULT_CONTENT_HANDLING_PROMPT,
                                        }))
                                    }
                                    className="flex h-7 w-7 items-center justify-center text-gray-400 hover:text-white"
                                    title="恢复默认内容处理提示词"
                                >
                                    <RotateCcw size={14} />
                                </button>
                            </div>
                            <textarea
                                id="content-handling-prompt"
                                value={draft.contentHandlingPrompt}
                                onChange={(event) =>
                                    setDraft((value) => ({
                                        ...value,
                                        contentHandlingPrompt:
                                            event.target.value,
                                    }))
                                }
                                rows={8}
                                spellCheck={false}
                                className="w-full resize-y rounded-md border border-gray-600 bg-gray-950 px-3 py-2 text-xs leading-5 outline-none transition-colors focus:border-brand-500"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="mt-3 text-xs text-red-400">{error}</div>
                    )}

                    <div className="mt-5 flex gap-2">
                        <button
                            type="button"
                            onClick={handleSave}
                            className="h-10 flex-1 rounded-md bg-brand-500 px-4 text-sm font-medium text-brand-foreground hover:bg-brand-600"
                        >
                            保存
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-10 rounded-md bg-gray-800 px-4 text-sm text-gray-200 hover:bg-gray-700"
                        >
                            取消
                        </button>
                    </div>

                    <div className="mt-6 border-t border-gray-700 pt-4">
                        <div className="mb-3 flex items-center justify-between text-xs text-gray-400">
                            <span>本地结果</span>
                            <span>
                                {cacheStats.translatedPages} 页译文 /{" "}
                                {cacheStats.ocrPages} 页 OCR
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={!canRetranslate || busy}
                                onClick={() => {
                                    onClose();
                                    onRetranslate();
                                }}
                                className="flex h-9 items-center gap-1.5 rounded-md bg-gray-800 px-3 text-xs text-gray-200 hover:bg-gray-700 disabled:cursor-default disabled:opacity-40"
                            >
                                <RefreshCw size={14} />
                                重新翻译当前页
                            </button>
                            <button
                                type="button"
                                disabled={
                                    clearing ||
                                    busy ||
                                    (cacheStats.ocrPages === 0 &&
                                        cacheStats.translatedPages === 0)
                                }
                                onClick={() => {
                                    void handleClear();
                                }}
                                className="flex h-9 items-center gap-1.5 rounded-md bg-gray-800 px-3 text-xs text-gray-300 hover:bg-red-900/50 hover:text-red-300 disabled:cursor-default disabled:opacity-40"
                            >
                                <Trash2 size={14} />
                                {clearing ? "清除中" : "清除翻译缓存"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
