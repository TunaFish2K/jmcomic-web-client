import { useMemo } from "react";
import type { SearchResult } from "@tiny-client/shared";
import { AlbumCard } from "../home/AlbumCard";
import { useAlbumBatch } from "../home/useAlbumBatch";
import { useExtendedShell } from "./shell";
import type { MobileComic } from "./types";

/**
 * Cards for a list of comics. Covers and details come from the existing batch-album
 * pipeline, so the list only needs IDs, names and authors.
 */
export function ComicGrid({ items, layout = "grid", renderAction }: {
    items: MobileComic[];
    layout?: "grid" | "row";
    renderAction?: (item: MobileComic) => React.ReactNode;
}) {
    const { openAlbum } = useExtendedShell();
    const result = useMemo<SearchResult>(() => ({
        search_query: "",
        total: String(items.length),
        content: items.map(({ id, name, author }) => ({ id, name, author })),
    }) as SearchResult, [items]);
    const { albumCache, getCardRef } = useAlbumBatch(result);
    const className = layout === "row"
        ? "flex gap-2 overflow-x-auto pb-1 [&>*]:w-28 [&>*]:shrink-0"
        : "grid grid-cols-3 gap-2 sm:grid-cols-4";
    return (
        <div className={className}>
            {items.map((item) => (
                <div key={item.id} className="flex flex-col gap-1">
                    <AlbumCard
                        item={item}
                        cachedData={albumCache.get(item.id)}
                        onClick={() => openAlbum(item.id, albumCache.get(item.id))}
                        cardRef={getCardRef(item.id)}
                    />
                    {renderAction?.(item)}
                </div>
            ))}
        </div>
    );
}
