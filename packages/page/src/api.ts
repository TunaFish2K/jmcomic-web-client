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

async function fetchPhotoJsonWithRetry<T>(
    url: URL,
    allowNotFound = false,
    signal?: AbortSignal,
): Promise<T | null> {
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
            if (allowNotFound && res.status === 404) return null;

            const errorMessage = await res.text();
            if (attempt < PHOTO_RETRY_DELAYS_MS.length && shouldRetryPhotoRequest(res.status)) {
                await sleep(PHOTO_RETRY_DELAYS_MS[attempt], signal);
                continue;
            }

            throw new Error(
                `${res.status} ${res.statusText}, message: ${errorMessage}`,
            );
        }

        return (await res.json()) as T;
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
    const res = await fetch(url);
    if (!res.ok) {
        const errorMessage = await res.text();
        throw new Error(
            `${res.status} ${res.statusText}, message: ${errorMessage}`,
        );
    }
    return normalizeSearchResult((await res.json()) as SearchResult);
}

export async function getAlbum(id: string) {
    const url = new URL(`/album/${id}`, BACKEND_URL);
    const res = await fetch(url);
    if (!res.ok) {
        if (res.status === 404) return null;
        const errorMessage = await res.text();
        throw new Error(
            `${res.status} ${res.statusText}, message: ${errorMessage}`,
        );
    }
    return (await res.json()) as Album;
}

export async function getPhoto(id: string, signal?: AbortSignal) {
    const url = new URL(`/photo/${id}`, BACKEND_URL);
    return await fetchPhotoJsonWithRetry<PhotoWithScrambleId>(url, true, signal);
}

export type BatchPhotoItem =
    | { photoId: string; photo: PhotoWithScrambleId; error?: never }
    | { photoId: string; photo: null; error: BatchError };

export async function getBatchPhoto(ids: string[], signal?: AbortSignal): Promise<BatchPhotoItem[]> {
    if (ids.length === 0) return [];
    const url = new URL('/batch-photo', BACKEND_URL);
    url.searchParams.set('ids', ids.join(','));
    return (await fetchPhotoJsonWithRetry<BatchPhotoItem[]>(url, false, signal)) ?? [];
}

export type BatchAlbumItem =
    | { albumId: string; album: Album; photo: PhotoWithScrambleId | null; error?: never }
    | { albumId: string; album: null; photo: null; error: BatchError };

export async function getBatchAlbum(ids: string[]): Promise<BatchAlbumItem[]> {
    if (ids.length === 0) return [];
    const url = new URL('/batch-album', BACKEND_URL);
    url.searchParams.set('ids', ids.join(','));
    const res = await fetch(url);
    if (!res.ok) {
        const errorMessage = await res.text();
        throw new Error(
            `${res.status} ${res.statusText}, message: ${errorMessage}`,
        );
    }
    return (await res.json()) as BatchAlbumItem[];
}
