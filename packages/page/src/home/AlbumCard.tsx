import type { BatchAlbumItem } from "../api";
import { CoverImage } from "./CoverImage";

export function AlbumCard({ item, cachedData, onClick, cardRef }: {
    item: { id: string; name: string; author: string };
    cachedData: BatchAlbumItem | undefined;
    onClick: () => void;
    cardRef?: (el: HTMLDivElement | null) => void;
}) {
    const photo = cachedData?.photo ?? null;

    return (
        <div
            ref={cardRef}
            data-album-id={item.id}
            role="button"
            tabIndex={0}
            aria-label={item.name}
            className="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-surface transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onClick();
            }}
        >
            {/* cover */}
            <div className="aspect-[3/4] w-full shrink-0 overflow-hidden bg-surface-secondary">
                {photo?.images[0] ? (
                    <CoverImage
                        coverUrl={photo.images[0].url}
                        scrambleId={photo.scrambleId}
                        albumId={item.id}
                        className="w-full h-full"
                    />
                ) : (
                    <div className="w-full h-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
                )}
            </div>
            {/* info */}
            <div className="p-2 flex flex-col gap-0.5 flex-1 min-w-0">
                <div className="text-xs font-medium leading-snug line-clamp-2 break-words" title={item.name}>
                    {item.name}
                </div>
                <div className="truncate text-xs text-muted">{item.author}</div>
                <div className="text-xs text-muted">#{item.id}</div>
            </div>
        </div>
    );
}
