import { useEffect, useState } from "react";
import { getSliceCount, reverseImageBySlice } from "@tiny-client/shared";
import { generateCoverCacheKey, getCachedImageEntry, setCachedImage } from "@tiny-client/shared/cache";
import pLimit from "p-limit";

// Global concurrency limiter for cover image fetches (shared across all CoverImage instances)
const coverLimit = pLimit(6);

export function CoverImage({ coverUrl, scrambleId, albumId, className }: {
    coverUrl: string;
    scrambleId: number;
    albumId: string;
    className?: string;
}) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let created: string | null = null;
        setObjectUrl(null);
        setFailed(false);
        const cacheKey = generateCoverCacheKey(albumId, coverUrl);

        const render = (data: ArrayBuffer) => {
            const blob = new Blob([data], { type: 'image/jpeg' });
            created = URL.createObjectURL(blob);
            if (!cancelled) {
                setObjectUrl(created);
                setFailed(false);
            }
        };

        coverLimit(async () => {
            const cached = await getCachedImageEntry(cacheKey);
            if (cancelled) return;
            if (cached) {
                render(cached.data);
                return;
            }

            const RETRY_DELAYS = [400, 1000, 2000];
            for (let attempt = 0; attempt <= RETRY_DELAYS.length && !cancelled; attempt++) {
                try {
                    const res = await fetch(coverUrl);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const buffer = await res.arrayBuffer();
                    const filename = coverUrl.split('/').pop() ?? '';
                    const slices = getSliceCount(scrambleId, parseInt(albumId), filename);
                    const { data } = slices > 0
                        ? await reverseImageBySlice(buffer, slices)
                        : { data: buffer };
                    setCachedImage(cacheKey, data).catch(() => {});
                    render(data);
                    return;
                } catch {
                    if (cancelled) return;
                    if (attempt === RETRY_DELAYS.length) {
                        setFailed(true);
                        return;
                    }
                    await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
                }
            }
        });
        return () => {
            cancelled = true;
            if (created) URL.revokeObjectURL(created);
        };
    }, [coverUrl, scrambleId, albumId]);

    if (!objectUrl || failed) return (
        <div className={`bg-gray-100 dark:bg-gray-800 animate-pulse ${className ?? ''}`} />
    );
    return (
        <img
            src={objectUrl}
            alt=""
            className={`object-cover ${className ?? ''}`}
            onError={() => setFailed(true)}
        />
    );
}
