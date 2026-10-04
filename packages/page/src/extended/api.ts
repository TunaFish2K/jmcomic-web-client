import { getBackendUrl } from "../backend-url";
import { clearAccount, loadAccount } from "./session";
import type {
    Categories, ComicPage, Daily, Favorites, FolderEdit, LoginResponse, MobileComic,
    MobileComment, MobileSection, Week, WriteResult,
} from "./types";

export class MobileApiError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status: number, message: string) {
        super(message);
        this.name = "MobileApiError";
        this.code = code;
        this.status = status;
    }
}

type Query = Record<string, string | number | undefined>;
type RequestOptions = { method?: "GET" | "POST"; query?: Query; body?: unknown; auth?: boolean; signal?: AbortSignal };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`/api/mobile${path}`, getBackendUrl());
    for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const headers = new Headers();
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.auth) {
        const account = loadAccount();
        if (!account) throw new MobileApiError("LOGIN_REQUIRED", 401, "Login required");
        headers.set("Authorization", `Bearer ${account.session}`);
    }
    const response = await fetch(url, {
        method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
    });
    if (!response.ok) {
        let code = "HTTP_ERROR";
        let message = `${response.status} ${response.statusText}`;
        try {
            const body = (await response.json()) as { error?: { code?: string; message?: string } };
            code = body.error?.code ?? code;
            message = body.error?.message ?? message;
        } catch {
            // Non-JSON failure (proxy or network edge); keep the HTTP status.
        }
        if (options.auth && (code === "SESSION_EXPIRED" || code === "SESSION_INVALID" || code === "UNAUTHORIZED")) clearAccount("expired");
        throw new MobileApiError(code, response.status, message);
    }
    return (await response.json()) as T;
}

const UPSTREAM_PREFIX = "Upstream rejected the request: ";

/** Turns an API failure into a short message for the UI. */
export function describeError(error: unknown): string {
    if (!(error instanceof MobileApiError)) return error instanceof Error ? `请求失败：${error.message}` : "请求失败";
    switch (error.code) {
        case "SESSION_EXPIRED": case "SESSION_INVALID": case "UNAUTHORIZED": return "登录已过期，请重新登录";
        case "LOGIN_REQUIRED": return "请先登录";
        case "ACCOUNT_DISABLED": return "此部署未启用账号功能";
        case "WRITE_UNCERTAIN": return "操作结果未知，请刷新确认后再试";
        case "UPSTREAM_REJECTED": return error.message.startsWith(UPSTREAM_PREFIX) ? error.message.slice(UPSTREAM_PREFIX.length) : error.message;
        case "TIMEOUT": return "请求超时，请稍后重试";
        case "INVALID_ARGUMENT": return "输入内容无效";
        default: return `请求失败：${error.message}`;
    }
}

export const mobileApi = {
    config: (signal?: AbortSignal) => request<{ accountEnabled: boolean }>("/config", { signal }),
    promote: (signal?: AbortSignal) => request<MobileSection[]>("/promote", { signal }),
    promoteList: (id: string, page: number, signal?: AbortSignal) => request<ComicPage>("/promote-list", { query: { id, page }, signal }),
    latest: (page: number, signal?: AbortSignal) => request<MobileComic[]>("/latest", { query: { page }, signal }),
    serialization: (date: number, page: number, signal?: AbortSignal) => request<ComicPage>("/serialization", { query: { date, page }, signal }),
    categories: (signal?: AbortSignal) => request<Categories>("/categories", { signal }),
    categoryFilter: (category: string, order: string, page: number, signal?: AbortSignal) =>
        request<ComicPage>("/categories/filter", { query: { c: category, o: order, page }, signal }),
    week: (signal?: AbortSignal) => request<Week>("/week", { signal }),
    weekFilter: (id: string, type: string, signal?: AbortSignal) => request<ComicPage>("/week/filter", { query: { id, type }, signal }),
    hotTags: (signal?: AbortSignal) => request<string[]>("/hot-tags", { signal }),
    random: (signal?: AbortSignal) => request<MobileComic[]>("/random", { signal }),
    comments: (aid: string, page: number, signal?: AbortSignal) =>
        request<{ total: number; items: MobileComment[] }>("/comments", { query: { aid, page }, signal }),
};

const post = <T = WriteResult>(path: string, body: unknown = {}) => request<T>(`/account${path}`, { body, auth: true });
const get = <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(`/account${path}`, { query, auth: true, signal });

export const accountApi = {
    login: (username: string, password: string) => request<LoginResponse>("/account/login", { body: { username, password } }),
    register: (input: { username: string; password: string; passwordConfirm: string; email: string; gender: string }) =>
        request<WriteResult>("/account/register", { body: input }),
    forgot: (email: string) => request<WriteResult>("/account/forgot", { body: { email } }),
    logout: () => post("/logout"),
    profile: (signal?: AbortSignal) => get<Record<string, string>>("/profile", undefined, signal),
    updateProfile: (fields: Record<string, string>) => post("/profile/update", { fields }),
    favorites: (page: number, folder: string, order: string, signal?: AbortSignal) => get<Favorites>("/favorites", { page, folder, order }, signal),
    toggleFavorite: (aid: string) => post("/favorite", { aid }),
    editFolder: (edit: FolderEdit) => post("/favorite-folder", edit),
    like: (aid: string) => post("/like", { aid }),
    comment: (aid: string, content: string, replyTo?: string) => post("/comment", { aid, content, replyTo }),
    deleteComment: (commentId: string, aid: string) => post("/comment/delete", { commentId, aid }),
    daily: (signal?: AbortSignal) => get<Daily>("/daily", undefined, signal),
    dailyCheck: (dailyId: string) => post("/daily/check", { dailyId }),
    history: (page: number, signal?: AbortSignal) => get<ComicPage>("/history", { page }, signal),
    deleteHistory: (aid: string) => post("/history/delete", { aid }),
};
