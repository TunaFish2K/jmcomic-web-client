import {
    type SearchResult,
    type Album,
    type PhotoWithScrambleId,
    normalizeSearchResult,
} from "@tiny-client/shared";
import { getBackendUrl } from "./backend-url";

export type BatchError = {
    message: string;
    stage: 'client_init' | 'get_album' | 'get_photo' | 'get_scramble_id' | 'unknown';
    domain: string | null;
    reference: string | null;
    retryable: boolean;
};

export type CacheMetaEntry = {
    fetchedAt: number;
    freshness: 'fresh' | 'stale';
    source: 'l1' | 'edge' | 'kv' | 'upstream';
};

export type CacheAware<T> = {
    data: T;
    cacheMeta: Record<string, CacheMetaEntry>;
};

type CacheRequestOptions = {
    signal?: AbortSignal;
    refresh?: boolean;
};

const BACKEND_URL = getBackendUrl();

const PHOTO_RETRY_DELAYS_MS = [500, 1500, 3000];

function shouldRetryPhotoRequest(status: number) {
    return status === 429 || status >= 500;
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

function parseCacheMeta(response: Response): Record<string, CacheMetaEntry> {
    const encoded = response.headers.get('X-Cache-Meta');
    if (!encoded) return {};
    try {
        const parsed = JSON.parse(decodeURIComponent(encoded)) as Record<string, CacheMetaEntry>;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

async function fetchPhotoJsonWithRetry<T>(
    url: URL,
    allowNotFound = false,
    signal?: AbortSignal,
): Promise<CacheAware<T | null>> {
    for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
            res = await fetch(url, { signal });
        } catch (error) {
            if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
            if (attempt >= PHOTO_RETRY_DELAYS_MS.length) throw error;
            await sleep(PHOTO_RETRY_DELAYS_MS[attempt], signal);
            continue;
        }

        if (!res.ok) {
            if (allowNotFound && res.status === 404) {
                return { data: null, cacheMeta: parseCacheMeta(res) };
            }

            const errorMessage = await res.text();
            if (attempt < PHOTO_RETRY_DELAYS_MS.length && shouldRetryPhotoRequest(res.status)) {
                await sleep(PHOTO_RETRY_DELAYS_MS[attempt], signal);
                continue;
            }

            throw new Error(
                `${res.status} ${res.statusText}, message: ${errorMessage}`,
            );
        }

        return { data: (await res.json()) as T, cacheMeta: parseCacheMeta(res) };
    }
}

export async function search(
    query: string,
    options?: {
        page?: number;
        orderBy?: "mr" | "mv" | "mp" | "tf";
        time?: "a" | "t" | "w" | "m";
        mainTag?: 0 | 2 | 1 | 3 | 4;
        previousIds?: string[];
    },
    signal?: AbortSignal,
) {
    options = options ?? {};
    if (!options.page) options.page = 1;
    if (!options.orderBy) options.orderBy = "mr";
    if (!options.time) options.time = "a";
    if (!options.mainTag) options.mainTag = 0;

    const url = new URL("/search", BACKEND_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("page", options.page.toString());
    url.searchParams.set("orderBy", options.orderBy);
    url.searchParams.set("time", options.time);
    url.searchParams.set("mainTag", options.mainTag.toString());
    url.searchParams.set("warmup", "1");
    if (options.page > 1 && options.previousIds?.length) {
        url.searchParams.set("previousIds", options.previousIds.join(","));
    }
    const res = await fetch(url, { signal });
    if (!res.ok) {
        const errorMessage = await res.text();
        throw new Error(
            `${res.status} ${res.statusText}, message: ${errorMessage}`,
        );
    }
    return normalizeSearchResult((await res.json()) as SearchResult);
}

export async function getAlbumWithMeta(
    id: string,
    options: CacheRequestOptions = {},
): Promise<CacheAware<Album | null>> {
    const url = new URL(`/album/${id}`, BACKEND_URL);
    if (options.refresh) url.searchParams.set('refresh', '1');
    const res = await fetch(url, { signal: options.signal });
    if (!res.ok) {
        if (res.status === 404) return { data: null, cacheMeta: parseCacheMeta(res) };
        const errorMessage = await res.text();
        throw new Error(
            `${res.status} ${res.statusText}, message: ${errorMessage}`,
        );
    }
    return { data: (await res.json()) as Album, cacheMeta: parseCacheMeta(res) };
}

export async function getAlbum(id: string, signal?: AbortSignal) {
    return (await getAlbumWithMeta(id, { signal })).data;
}

export async function getPhotoWithMeta(
    id: string,
    options: CacheRequestOptions = {},
): Promise<CacheAware<PhotoWithScrambleId | null>> {
    const url = new URL(`/photo/${id}`, BACKEND_URL);
    if (options.refresh) url.searchParams.set('refresh', '1');
    return await fetchPhotoJsonWithRetry<PhotoWithScrambleId>(url, true, options.signal);
}

export async function getPhoto(id: string, signal?: AbortSignal) {
    return (await getPhotoWithMeta(id, { signal })).data;
}

export type BatchPhotoItem =
    | { photoId: string; photo: PhotoWithScrambleId; error?: never }
    | { photoId: string; photo: null; error: BatchError };

export async function getBatchPhoto(ids: string[], signal?: AbortSignal): Promise<BatchPhotoItem[]> {
    if (ids.length === 0) return [];
    const url = new URL('/batch-photo', BACKEND_URL);
    url.searchParams.set('ids', ids.join(','));
    return (await fetchPhotoJsonWithRetry<BatchPhotoItem[]>(url, false, signal)).data ?? [];
}

export type BatchAlbumItem =
    | { albumId: string; album: Album; photo: PhotoWithScrambleId | null; error?: never }
    | { albumId: string; album: null; photo: null; error: BatchError };

export async function getBatchAlbumWithMeta(
    ids: string[],
    options: CacheRequestOptions = {},
): Promise<CacheAware<BatchAlbumItem[]>> {
    if (ids.length === 0) return { data: [], cacheMeta: {} };
    const url = new URL('/batch-album', BACKEND_URL);
    url.searchParams.set('ids', ids.join(','));
    if (options.refresh) url.searchParams.set('refresh', '1');
    const res = await fetch(url, { signal: options.signal });
    if (!res.ok) {
        const errorMessage = await res.text();
        throw new Error(
            `${res.status} ${res.statusText}, message: ${errorMessage}`,
        );
    }
    return {
        data: (await res.json()) as BatchAlbumItem[],
        cacheMeta: parseCacheMeta(res),
    };
}

export async function getBatchAlbum(ids: string[], signal?: AbortSignal): Promise<BatchAlbumItem[]> {
    return (await getBatchAlbumWithMeta(ids, { signal })).data;
}
