import { useCallback, useEffect, useRef, useState } from "react";
import { getBatchAlbumWithMeta } from "../api";
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
    const wakeQueueRef = useRef<(() => void) | null>(null);
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
                wakeQueueRef.current?.();
            },
            { threshold: 0, rootMargin: "1000px 0px" },
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
    // Retries transient failures with a capped exponential backoff.
    useEffect(() => {
        if (!resultIdsKey) return;
        if (!data || !('content' in data)) return;

        let cancelled = false;
        const controller = new AbortController();
        const CHUNK = 15;    // Leave headroom: 2 fixed + 3 per ID, avoid sitting on the 50-request ceiling
        const CONCURRENCY = 2; // max simultaneous chunk requests
        const RETRY_DELAYS = [1500, 3000, 6000, 12000];
        const retryCounts = new Map<string, number>();
        const forceRefreshIds = new Set<string>();

        const waitForIdle = () => new Promise<void>((resolve) => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => resolve(), { timeout: 1000 });
            } else {
                setTimeout(resolve, 0);
            }
        });

        const waitForWakeOrDelay = (delay: number) => new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                wakeQueueRef.current = null;
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(finish, delay);
            wakeQueueRef.current = finish;
        });

        const canIdlePrefetch = () => {
            const connection = (navigator as Navigator & {
                connection?: { saveData?: boolean; effectiveType?: string };
            }).connection;
            return connection?.saveData !== true
                && connection?.effectiveType !== 'slow-2g'
                && connection?.effectiveType !== '2g';
        };

        // Send one chunk; returns IDs that came back with an error field
        const fetchChunk = async (ids: string[]): Promise<string[]> => {
            try {
                const forceRefresh = ids.some(id => forceRefreshIds.has(id));
                const response = await getBatchAlbumWithMeta(ids, {
                    signal: controller.signal,
                    refresh: forceRefresh,
                });
                const results = response.data;
                if (cancelled) return [];
                setAlbumCache(prev => {
                    const next = new Map(prev);
                    for (const item of results) next.set(item.albumId, item);
                    return next;
                });
                const cachedItems = results.filter(
                    (result): result is SuccessfulBatchAlbumItem => result.album !== null,
                ).map((result) => ({
                    ...result,
                    albumFetchedAt: response.cacheMeta[`album:${result.albumId}`]?.fetchedAt,
                    photoFetchedAt: response.cacheMeta[`photo:${result.albumId}`]?.fetchedAt,
                }));
                if (cachedItems.length > 0) setCachedAlbums(cachedItems).catch(() => {});
                return results.filter((result) => {
                    if (result.error) return result.error.retryable;
                    const albumMeta = response.cacheMeta[`album:${result.albumId}`];
                    const photoMeta = response.cacheMeta[`photo:${result.albumId}`];
                    return forceRefresh && (albumMeta?.freshness === 'stale' || photoMeta?.freshness === 'stale');
                }).map(result => result.albumId);
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
                    for (const [id, entry] of cachedMap) {
                        if (entry.albumFreshness !== 'expired') {
                            next.set(id, { albumId: id, album: entry.album, photo: entry.photo ?? null });
                        }
                    }
                    return next;
                });
                for (const [id, entry] of cachedMap) {
                    const albumNeedsRefresh = entry.albumFreshness !== undefined && entry.albumFreshness !== 'fresh';
                    const photoNeedsRefresh = entry.photo !== null
                        && entry.photoFreshness !== undefined
                        && entry.photoFreshness !== 'fresh';
                    if (albumNeedsRefresh || photoNeedsRefresh) {
                        forceRefreshIds.add(id);
                    } else {
                        pending.delete(id);
                    }
                }
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
                let ordered: string[];
                let concurrency: number;
                if (visible.length > 0) {
                    ordered = [...visible, ...rest].slice(0, CHUNK * CONCURRENCY);
                    concurrency = CONCURRENCY;
                } else {
                    if (!canIdlePrefetch()) {
                        await waitForWakeOrDelay(1000);
                        continue;
                    }
                    await waitForIdle();
                    if (cancelled) break;
                    ordered = rest.slice(0, CHUNK);
                    concurrency = 1;
                }

                // Split into chunks and dispatch up to CONCURRENCY at a time
                const chunks: string[][] = [];
                for (let i = 0; i < ordered.length; i += CHUNK) {
                    chunks.push(ordered.slice(i, i + CHUNK));
                }

                // Process chunks with limited concurrency
                const failed: string[] = [];
                for (let i = 0; i < chunks.length; i += concurrency) {
                    if (cancelled) break;
                    const batch = chunks.slice(i, i + concurrency);
                    const results = await Promise.all(batch.map(fetchChunk));
                    for (const ids of results) failed.push(...ids);
                }

                if (cancelled) break;

                // Update pending: remove successes, keep failures
                for (const id of ordered) pending.delete(id);
                let nextRetryDelay = 0;
                for (const id of failed) {
                    const retryCount = (retryCounts.get(id) ?? 0) + 1;
                    retryCounts.set(id, retryCount);
                    if (retryCount <= RETRY_DELAYS.length) {
                        pending.add(id);
                        const base = RETRY_DELAYS[retryCount - 1];
                        nextRetryDelay = Math.max(nextRetryDelay, Math.round(base * (0.8 + Math.random() * 0.4)));
                    }
                }

                if (nextRetryDelay > 0) {
                    await waitForWakeOrDelay(nextRetryDelay);
                }
            }
        };

        run();
        return () => {
            cancelled = true;
            controller.abort();
            wakeQueueRef.current?.();
            wakeQueueRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resultIdsKey]);

    return { albumCache, getCardRef };
}
