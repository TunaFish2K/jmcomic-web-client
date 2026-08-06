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
            className="border dark:border-gray-700 rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-shadow bg-white dark:bg-gray-900 flex flex-col"
            onClick={onClick}
        >
            {/* cover */}
            <div className="w-full aspect-[3/4] bg-gray-100 shrink-0">
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
                <div className="text-xs text-gray-400 truncate">{item.author}</div>
                <div className="text-xs text-gray-300 dark:text-gray-600">#{item.id}</div>
            </div>
        </div>
    );
}
