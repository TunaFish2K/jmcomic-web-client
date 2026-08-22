export const TRANSLATION_SETTINGS_VERSION = 4 as const;
export const OCR_MODEL_VERSION = "ppocr-v5-mobile-ja@1";
export const OCR_PREPROCESS_VERSION = "max-1600@1";
export const TRANSLATION_PROMPT_VERSION = "ja-zh-cn@3";

export type TranslationStage = "loading-model" | "recognizing" | "translating";

export type OcrInitializationPhase =
    | "idle"
    | "checking-cache"
    | "downloading"
    | "initializing"
    | "ready";

export type OcrInitializationProgress = {
    phase: OcrInitializationPhase;
    loadedBytes: number;
    totalBytes: number | null;
};

export type ReasoningMode = "provider-default" | "off" | "on";
export type ReasoningEffort =
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";

export type TranslationSettingsV4 = {
    version: typeof TRANSLATION_SETTINGS_VERSION;
    baseUrl: string;
    model: string;
    apiKey: string;
    autoTranslate: boolean;
    pretranslateRange: number;
    translationConcurrency: number;
    reasoningMode: ReasoningMode;
    reasoningEffort: ReasoningEffort;
    smartSkipSoundEffects: boolean;
    translationStylePrompt: string;
    contentHandlingPrompt: string;
};

export type NormalizedPoint = {
    x: number;
    y: number;
};

export type OcrRegion = {
    id: string;
    text: string;
    score: number;
    polygon: NormalizedPoint[];
};

export type OcrPageResult = {
    modelVersion: string;
    preprocessVersion: string;
    sourceWidth: number;
    sourceHeight: number;
    regions: OcrRegion[];
};

export type TranslatedRegion = OcrRegion & {
    translation: string;
};

export type PageTranslationRecord = {
    key: string;
    ocrKey: string;
    pageKey: string;
    providerKey: string;
    promptKey: string;
    promptVersion: string;
    sourceWidth: number;
    sourceHeight: number;
    sourceRegionCount: number;
    skippedRegionCount: number;
    regions: TranslatedRegion[];
    updatedAt: number;
    lastAccessedAt: number;
};
