import type {
    OcrPageResult,
    PageTranslationRecord,
    TranslationSettingsV3,
} from "./types";
import { TRANSLATION_PROMPT_VERSION } from "./types";
import { getReasoningEffortForRequest } from "./settings";

const DB_NAME = "jm-translation-cache";
const DB_VERSION = 1;
const OCR_STORE = "ocr-pages";
const TRANSLATION_STORE = "translations";
const MAX_PAGE_RECORDS = 500;

type CachedOcrRecord = {
    key: string;
    pageKey: string;
    result: OcrPageResult;
    updatedAt: number;
    lastAccessedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
            const database = request.result;
            for (const storeName of [OCR_STORE, TRANSLATION_STORE]) {
                if (database.objectStoreNames.contains(storeName)) continue;
                const store = database.createObjectStore(storeName, {
                    keyPath: "key",
                });
                store.createIndex("lastAccessedAt", "lastAccessedAt");
            }
        };
        request.onsuccess = () => {
            request.result.onversionchange = () => {
                request.result.close();
                dbPromise = null;
            };
            resolve(request.result);
        };
    });
    return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>) {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getRecord<T extends { lastAccessedAt: number }>(
    storeName: string,
    key: string,
) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const record = await requestResult<T | undefined>(store.get(key));
    if (record) {
        record.lastAccessedAt = Date.now();
        store.put(record);
    }
    return record ?? null;
}

async function pruneStore(storeName: string) {
    const database = await openDatabase();
    const countTransaction = database.transaction(storeName, "readonly");
    const count = await requestResult(
        countTransaction.objectStore(storeName).count(),
    );
    let remaining = count - MAX_PAGE_RECORDS;
    if (remaining <= 0) return;

    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        const cursorRequest = store.index("lastAccessedAt").openKeyCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor || remaining <= 0) return;
            store.delete(cursor.primaryKey);
            remaining -= 1;
            cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function putRecord(storeName: string, record: unknown) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    await requestResult(transaction.objectStore(storeName).put(record));
    await pruneStore(storeName);
}

export function stableHash(value: string) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

export function buildPageKey(chapterId: string, imageName: string) {
    return `${chapterId}/${imageName}`;
}

export function buildOcrCacheKey(pageKey: string, result?: OcrPageResult) {
    const modelVersion = result?.modelVersion ?? "ppocr-v5-mobile-ja@1";
    const preprocessVersion = result?.preprocessVersion ?? "max-1600@1";
    return `${pageKey}:${modelVersion}:${preprocessVersion}`;
}

export function getProviderKey(settings: TranslationSettingsV3) {
    const reasoningEffort =
        getReasoningEffortForRequest(settings) ?? "provider-default";
    return stableHash(
        `${settings.baseUrl}\n${settings.model}\n${reasoningEffort}`,
    );
}

export function getPromptKey(settings: TranslationSettingsV3) {
    return stableHash(
        `${settings.translationStylePrompt}\n\0${settings.contentHandlingPrompt}`,
    );
}

export function getTranslationRequestKey(settings: TranslationSettingsV3) {
    const reasoningEffort =
        getReasoningEffortForRequest(settings) ?? "provider-default";
    return stableHash(
        `${settings.baseUrl}\n${settings.model}\n${settings.apiKey}\n${reasoningEffort}\n${getPromptKey(settings)}`,
    );
}

function getOcrDigest(result: OcrPageResult) {
    return stableHash(
        JSON.stringify(
            result.regions.map((region) => ({
                id: region.id,
                text: region.text,
                score: region.score,
                polygon: region.polygon,
            })),
        ),
    );
}

export function buildTranslationCacheKey(
    ocrKey: string,
    result: OcrPageResult,
    settings: TranslationSettingsV3,
) {
    return `${ocrKey}:${getOcrDigest(result)}:${getProviderKey(settings)}:${getPromptKey(settings)}:${TRANSLATION_PROMPT_VERSION}`;
}

export async function getCachedOcrResult(key: string) {
    const record = await getRecord<CachedOcrRecord>(OCR_STORE, key);
    return record?.result ?? null;
}

export async function setCachedOcrResult(
    key: string,
    pageKey: string,
    result: OcrPageResult,
) {
    const now = Date.now();
    await putRecord(OCR_STORE, {
        key,
        pageKey,
        result,
        updatedAt: now,
        lastAccessedAt: now,
    } satisfies CachedOcrRecord);
}

export async function getCachedTranslation(key: string) {
    return getRecord<PageTranslationRecord>(TRANSLATION_STORE, key);
}

export async function setCachedTranslation(record: PageTranslationRecord) {
    await putRecord(TRANSLATION_STORE, record);
}

export async function deleteCachedTranslation(key: string) {
    const database = await openDatabase();
    const transaction = database.transaction(TRANSLATION_STORE, "readwrite");
    await requestResult(transaction.objectStore(TRANSLATION_STORE).delete(key));
}

export async function clearTranslationCache() {
    const database = await openDatabase();
    const transaction = database.transaction(
        [OCR_STORE, TRANSLATION_STORE],
        "readwrite",
    );
    await Promise.all([
        requestResult(transaction.objectStore(OCR_STORE).clear()),
        requestResult(transaction.objectStore(TRANSLATION_STORE).clear()),
    ]);
}

export async function getTranslationCacheStats() {
    const database = await openDatabase();
    const transaction = database.transaction(
        [OCR_STORE, TRANSLATION_STORE],
        "readonly",
    );
    const [ocrPages, translatedPages] = await Promise.all([
        requestResult(transaction.objectStore(OCR_STORE).count()),
        requestResult(transaction.objectStore(TRANSLATION_STORE).count()),
    ]);
    return { ocrPages, translatedPages };
}
