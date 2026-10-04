import type { Album } from "@tiny-client/shared";
import { normalizeTerm, type Token } from "./query";

/**
 * Terms the user has met — tags, authors, characters and parodies from albums they opened,
 * plus their own searches. The upstream has no suggestion API, so this local list drives
 * search autocomplete. Stored in localStorage; every failure degrades to "no suggestions".
 */
export type TermKind = "tag" | "author" | "actor" | "work" | "history";
export type Term = { text: string; kind: TermKind; count: number; lastUsed: number };

export const VOCABULARY_KEY = "jm-search-vocab:v1";
const IMPORTED_KEY = "jm-search-vocab-imported:v1";
const ALBUM_CACHE_PREFIX = "reader-album-cache:";
export const VOCABULARY_LIMIT = 1500;

function storage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

function load(): Map<string, Term> {
    try {
        const raw = storage()?.getItem(VOCABULARY_KEY);
        const list = raw ? JSON.parse(raw) as Term[] : [];
        return new Map(Array.isArray(list)
            ? list.filter((term) => typeof term?.text === "string" && term.text).map((term) => [normalizeTerm(term.text), term])
            : []);
    } catch {
        return new Map();
    }
}

function save(terms: Map<string, Term>) {
    // Keep the most useful entries: recent first, then frequent.
    const list = [...terms.values()]
        .sort((a, b) => b.lastUsed - a.lastUsed || b.count - a.count)
        .slice(0, VOCABULARY_LIMIT);
    try {
        storage()?.setItem(VOCABULARY_KEY, JSON.stringify(list));
    } catch {
        // Suggestions are optional; a full or blocked storage is not an error.
    }
}

function add(terms: Map<string, Term>, text: string, kind: TermKind, now: number) {
    const clean = text.trim();
    if (!clean || clean.length > 60) return;
    const key = normalizeTerm(clean);
    const known = terms.get(key);
    // A search history entry never downgrades a known tag/author kind.
    const nextKind = known && kind === "history" ? known.kind : kind;
    terms.set(key, { text: known?.text ?? clean, kind: nextKind, count: (known?.count ?? 0) + 1, lastUsed: now });
}

type AlbumTerms = Pick<Album, "tags" | "author" | "actors" | "works">;

function addAlbum(terms: Map<string, Term>, album: Partial<AlbumTerms>, now: number) {
    for (const text of album.tags ?? []) add(terms, text, "tag", now);
    for (const text of album.author ?? []) add(terms, text, "author", now);
    for (const text of album.actors ?? []) add(terms, text, "actor", now);
    for (const text of album.works ?? []) add(terms, text, "work", now);
}

export function recordAlbum(album: Partial<AlbumTerms>, now = Date.now()) {
    const terms = load();
    addAlbum(terms, album, now);
    save(terms);
}

export function recordSearch(tokens: Token[], now = Date.now()) {
    const terms = load();
    for (const token of tokens) add(terms, token.text, "history", now);
    save(terms);
}

/** One-time import of albums the reader cached before this feature existed. */
export function importCachedAlbums(now = Date.now()) {
    const store = storage();
    if (!store) return;
    try {
        if (store.getItem(IMPORTED_KEY)) return;
        const terms = load();
        for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (!key?.startsWith(ALBUM_CACHE_PREFIX)) continue;
            try {
                const cached = JSON.parse(store.getItem(key) ?? "") as { album?: Partial<AlbumTerms>; updatedAt?: number };
                if (cached.album) addAlbum(terms, cached.album, cached.updatedAt ?? now);
            } catch {
                // Skip unreadable cache entries.
            }
        }
        save(terms);
        store.setItem(IMPORTED_KEY, "1");
    } catch {
        // Storage unavailable: nothing to import.
    }
}

/** Matches starting with the input come first, then other matches; both by use count and recency. */
export function suggest(input: string, skip: string[] = [], limit = 8): Term[] {
    const needle = normalizeTerm(input.trim().replace(/^[+-]+/, ""));
    if (!needle) return [];
    const skipped = new Set(skip.map(normalizeTerm));
    return [...load().entries()]
        .filter(([key]) => key.includes(needle) && !skipped.has(key))
        .map(([key, term]) => ({ term, prefix: key.startsWith(needle) }))
        .sort((a, b) => Number(b.prefix) - Number(a.prefix) || b.term.count - a.term.count || b.term.lastUsed - a.term.lastUsed)
        .slice(0, limit)
        .map(({ term }) => term);
}
