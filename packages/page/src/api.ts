import {
    type SearchResult,
    type Album,
    type PhotoWithScrambleId,
} from "@tiny-client/shared";

const rawBackendUrl = import.meta.env.VITE_BACKEND_URL as string;
// 开发环境：将 localhost 替换为当前访问的 hostname（支持内网访问）
// 生产环境：直接使用配置的 URL
const BACKEND_URL = import.meta.env.DEV && rawBackendUrl?.includes("localhost")
    ? rawBackendUrl.replace("localhost", window.location.hostname)
    : rawBackendUrl;

export async function search(
    query: string,
    options?: {
        page?: number;
        orderBy?: "mr" | "mv" | "mp" | "tf";
        time?: "a" | "t" | "w" | "m";
        mainTag?: 0 | 2 | 1 | 3 | 4;
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
    const res = await fetch(url);
    if (!res.ok) {
        const errorMessage = await res.text();
        throw new Error(
            `${res.status} ${res.statusText}, message: ${errorMessage}`,
        );
    }
    return (await res.json()) as SearchResult;
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

export async function getPhoto(id: string) {
    const url = new URL(`/photo/${id}`, BACKEND_URL);
    const res = await fetch(url);
    if (!res.ok) {
        if (res.status === 404) return null;
        const errorMessage = await res.text();
        throw new Error(
            `${res.status} ${res.statusText}, message: ${errorMessage}`,
        );
    }
    return (await res.json()) as PhotoWithScrambleId;
}
