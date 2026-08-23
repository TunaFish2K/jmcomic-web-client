import { useCallback, useEffect, useRef, useState } from "react";
import { getBatchAlbum } from "../api";
import type { BatchAlbumItem } from "../api";
import type { SearchResult } from "@tiny-client/shared";
import { getCachedAlbums, setCachedAlbums } from "../album-cache";

type SuccessfulBatchAlbumItem = Extract<
    BatchAlbumItem,
    { album: NonNullable<BatchAlbumItem['album']> }
>;

export function useAlbumBatch(data: SearchResult | undefined) {
    // ── in-memory album cache (survives page changes within same session) ────
    const [albumCache, setAlbumCache] = useState<Map<string, BatchAlbumItem>>(new Map());
    // Keep a ref so the batch effect always reads the latest cache without re-running
    const albumCacheRef = useRef<Map<string, BatchAlbumItem>>(albumCache);
    useEffect(() => { albumCacheRef.current = albumCache; }, [albumCache]);

    // Track which album IDs are currently visible in the viewport
    const visibleIdsRef = useRef<Set<string>>(new Set());
    // Ref to the card elements for IntersectionObserver
    const cardRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

    // Register / unregister a card element
    const getCardRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
        if (el) cardRefsMap.current.set(id, el);
        else cardRefsMap.current.delete(id);
    }, []);

    // Observe card visibility whenever `data` changes (new search results)
    useEffect(() => {
        if (!data || !('content' in data) || data.content.length === 0) return;
        const visibleIds = visibleIdsRef.current;

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const id = (entry.target as HTMLElement).dataset.albumId;
                    if (!id) continue;
                    if (entry.isIntersecting) visibleIds.add(id);
                    else visibleIds.delete(id);
                }
            },
            { threshold: 0.1 },
        );

        // Observe all current cards (give DOM a tick to render)
        const tid = setTimeout(() => {
            for (const el of cardRefsMap.current.values()) observer.observe(el);
        }, 0);

        return () => {
            clearTimeout(tid);
            observer.disconnect();
            visibleIds.clear();
        };
    }, [data]);

    // Stable key: content IDs + redirect_aid for the current result set.
    // Using this instead of `data` avoids re-running when TanStack Query
    // returns a new object reference for an identical result (e.g. background refetch).
    const resultIdsKey = data && 'content' in data
        ? [
            ...data.content.map(i => i.id),
            ...('redirect_aid' in data && data.redirect_aid ? [data.redirect_aid] : []),
          ].join(',')
        : '';

    // Evict stale entries when the result set changes (page nav, new search)
    // to prevent unbounded memory growth across many page turns.
    useEffect(() => {
        if (!resultIdsKey) return;
        const currentIds = new Set(resultIdsKey.split(',').filter(Boolean));
        setAlbumCache(prev => {
            let changed = false;
            const next = new Map(prev);
            for (const id of prev.keys()) {
                if (!currentIds.has(id)) { next.delete(id); changed = true; }
            }
            return changed ? next : prev;
        });
    }, [resultIdsKey]);

    // Fetch batch album data — visible cards first, then the rest.
    // Keeps retrying any IDs that returned an error until all succeed or cancelled.
    useEffect(() => {
        if (!resultIdsKey) return;
        if (!data || !('content' in data)) return;

        let cancelled = false;
        const controller = new AbortController();
        const CHUNK = 15;    // Leave headroom: 2 fixed + 3 per ID, avoid sitting on the 50-request ceiling
        const CONCURRENCY = 2; // max simultaneous chunk requests
        const RETRY_DELAY = 1500; // ms before re-queuing failed IDs

        // Send one chunk; returns IDs that came back with an error field
        const fetchChunk = async (ids: string[]): Promise<string[]> => {
            try {
                const results = await getBatchAlbum(ids, controller.signal);
                if (cancelled) return [];
                setAlbumCache(prev => {
                    const next = new Map(prev);
                    for (const item of results) next.set(item.albumId, item);
                    return next;
                });
                const cachedItems = results.filter(
                    (result): result is SuccessfulBatchAlbumItem => result.album !== null,
                );
                if (cachedItems.length > 0) setCachedAlbums(cachedItems).catch(() => {});
                // IDs whose worker-side fetch failed get re-queued
                return results.filter(r => r.error).map(r => r.albumId);
            } catch {
                if (controller.signal.aborted) return [];
                // Network / CF 520 — treat whole chunk as failed
                return ids;
            }
        };

        const run = async () => {
            // Give IntersectionObserver time to fire before we decide priority order
            await new Promise(r => setTimeout(r, 50));
            if (cancelled) return;

            // All IDs for this result: content + direct-match redirect
            const redirectAid = 'redirect_aid' in data && data.redirect_aid ? data.redirect_aid : null;
            const allIds = [
                ...data.content.map(item => item.id),
                ...(redirectAid ? [redirectAid] : []),
            ];

            // IDs still needing a successful fetch (not yet in cache, or errored)
            const pending = new Set(
                allIds.filter(id => {
                    const cached = albumCacheRef.current.get(id);
                    return !cached || !!cached.error;
                })
            );
            if (pending.size === 0) return;

            // Check IndexedDB cache for pending IDs (L2 cache)
            const cachedMap = await getCachedAlbums([...pending]);
            if (cachedMap.size > 0) {
                setAlbumCache(prev => {
                    const next = new Map(prev);
                    for (const [id, { album, photo }] of cachedMap) {
                        next.set(id, { albumId: id, album, photo: photo ?? null });
                    }
                    return next;
                });
                for (const id of cachedMap.keys()) pending.delete(id);
            }
            if (pending.size === 0) return;

            while (pending.size > 0 && !cancelled) {
                // Priority: visible first, then the rest
                const visible: string[] = [];
                const rest: string[] = [];
                for (const id of pending) {
                    if (visibleIdsRef.current.has(id)) visible.push(id);
                    else rest.push(id);
                }
                const ordered = [...visible, ...rest];

                // Split into chunks and dispatch up to CONCURRENCY at a time
                const chunks: string[][] = [];
                for (let i = 0; i < ordered.length; i += CHUNK) {
                    chunks.push(ordered.slice(i, i + CHUNK));
                }

                // Process chunks with limited concurrency
                const failed: string[] = [];
                for (let i = 0; i < chunks.length; i += CONCURRENCY) {
                    if (cancelled) break;
                    const batch = chunks.slice(i, i + CONCURRENCY);
                    const results = await Promise.all(batch.map(fetchChunk));
                    for (const ids of results) failed.push(...ids);
                }

                if (cancelled) break;

                // Update pending: remove successes, keep failures
                for (const id of ordered) pending.delete(id);
                for (const id of failed) pending.add(id);

                if (pending.size > 0) {
                    // Wait before retrying to avoid hammering CF on 520s
                    await new Promise(r => setTimeout(r, RETRY_DELAY));
                }
            }
        };

        run();
        return () => {
            cancelled = true;
            controller.abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resultIdsKey]);

    return { albumCache, getCardRef };
}
