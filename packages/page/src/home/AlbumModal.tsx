import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { BookOpen, RefreshCw, X } from "lucide-react";
import { getBatchAlbum } from "../api";
import type { BatchAlbumItem } from "../api";
import { getCachedAlbum, setCachedAlbum } from "../album-cache";
import { saveAlbumMeta, getLatestChapterProgress } from "../reader/reader-store";
import { formatBatchError, parseSeriesOrder } from "./download-utils";
import { CoverImage } from "./CoverImage";
import { SeriesDownloadManager } from "./SeriesDownloadManager";
import { DownloadButtons, previewFullActionButtonClass } from "./DownloadButtons";

export function AlbumModal({ albumId, cachedData, onClose }: {
    albumId: string;
    cachedData: BatchAlbumItem | undefined;
    onClose: () => void;
}) {
    const navigate = useNavigate();
    const detailQuery = useQuery<BatchAlbumItem>({
        queryKey: ['album-detail', albumId],
        queryFn: async () => {
            const persisted = await getCachedAlbum(albumId);
            if (persisted) {
                return { albumId, album: persisted.album, photo: persisted.photo };
            }

            const detail = (await getBatchAlbum([albumId])).find((item) => item.albumId === albumId);
            if (!detail) throw new Error('详情接口未返回该本子');
            if (!detail.error) {
                await setCachedAlbum(detail.albumId, detail.album, detail.photo);
            }
            return detail;
        },
        initialData: cachedData && !cachedData.error ? cachedData : undefined,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
    const detailData = detailQuery.data;
    const album = detailData?.album ?? null;
    const photo = detailData?.photo ?? null;
    const isSeriesAlbum = !!album?.series?.length;
    const sortedSeries = useMemo(
        () => isSeriesAlbum
            ? [...album!.series].sort((a, b) => parseSeriesOrder(a.sort) - parseSeriesOrder(b.sort))
            : [],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [album],
    );
    const statsLabel = isSeriesAlbum
        ? `${sortedSeries.length} 话`
        : photo
            ? `${photo.images.length} 页`
            : '章节数据待加载';

    // Last-read chapter for the "继续阅读" entry button on series albums.
    const rootKey = album?.seriesID || albumId;
    const latest = useMemo(
        () => isSeriesAlbum ? getLatestChapterProgress(rootKey, sortedSeries.map((s) => s.id)) : null,
        [rootKey, sortedSeries, isSeriesAlbum],
    );
    const lastChapter = latest ? sortedSeries.find((s) => s.id === latest.chapterId) : null;
    const lastChapterIndex = lastChapter ? sortedSeries.indexOf(lastChapter) : -1;

    useEffect(() => {
        if (album) saveAlbumMeta(albumId, album);
    }, [album, albumId]);

    return (
        /* backdrop */
        <div
            className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* header */}
                <div className="flex items-start justify-between p-4 border-b dark:border-gray-700 gap-3">
                    <div className="flex gap-3 min-w-0">
                        {photo && photo.images[0] && (
                            <CoverImage
                                coverUrl={photo.images[0].url}
                                scrambleId={photo.scrambleId}
                                albumId={albumId}
                                className="w-16 h-22 rounded shrink-0"
                            />
                        )}
                        <div className="min-w-0">
                            <div className="font-semibold text-sm leading-snug break-words">
                                {album?.name ?? `#${albumId}`}
                            </div>
                        <div className="text-xs text-gray-400 mt-1">#{albumId}</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 mt-0.5">
                        <X size={18} />
                    </button>
                </div>

                {/* body */}
                <div className="overflow-y-auto flex-1 p-4 text-sm space-y-3">
                    {!detailData && detailQuery.isPending ? (
                        <div className="text-gray-400 text-center py-8">加载中...</div>
                    ) : detailData?.error || detailQuery.isError ? (
                        <div className="flex flex-col items-center gap-3 py-8 text-center text-red-500">
                            <span>
                                {detailData?.error
                                    ? formatBatchError(detailData.error)
                                    : detailQuery.error instanceof Error
                                        ? detailQuery.error.message
                                        : '详情加载失败'}
                            </span>
                            <Button
                                size="sm"
                                variant="secondary"
                                onPress={() => { void detailQuery.refetch(); }}
                            >
                                <RefreshCw size={14} className="mr-1" />重试
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                                <span>浏览 {album!.totalViews}</span>
                                <span>点赞 {album!.likes}</span>
                                <span>{statsLabel}</span>
                            </div>

                            {album!.author.length > 0 && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">作者</div>
                                    <div className="flex flex-wrap gap-1">
                                        {album!.author.map(a => (
                                            <span key={a} className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded text-xs">{a}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {album!.tags.length > 0 && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">标签</div>
                                    <div className="flex flex-wrap gap-1">
                                        {album!.tags.map(t => (
                                            <span key={t} className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {album!.works.length > 0 && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">作品</div>
                                    <div className="flex flex-wrap gap-1">
                                        {album!.works.map(w => (
                                            <span key={w} className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-xs">{w}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {album!.actors.length > 0 && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">角色</div>
                                    <div className="flex flex-wrap gap-1">
                                        {album!.actors.map(a => (
                                            <span key={a} className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-xs">{a}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {isSeriesAlbum ? (
                                <div className="space-y-3">
                                    {latest && lastChapter && (
                                        <Button
                                            size="sm"
                                            className="w-full justify-start bg-brand-500 text-brand-foreground hover:bg-brand-600"
                                            onPress={() => navigate(`/reader/${latest.chapterId}`, { state: { isSeries: true, album, seriesItems: sortedSeries.map((s, i) => ({ id: s.id, name: s.name || `第${i + 1}章`, order: parseSeriesOrder(s.sort) })) } })}
                                        >
                                            <BookOpen size={14} className="mr-1 shrink-0" />
                                            <span className="truncate">继续阅读：{lastChapterIndex >= 0 && !lastChapter.name ? `第${lastChapterIndex + 1}章` : lastChapter.name} · 第 {latest.page + 1} 页</span>
                                        </Button>
                                    )}
                                    <SeriesDownloadManager
                                        key={`${albumId}:${sortedSeries.length}`}
                                        albumName={album!.name}
                                        items={sortedSeries
                                            .map((seriesItem) => ({
                                                id: seriesItem.id,
                                                name: `${album!.name} - ${seriesItem.name}`,
                                                order: parseSeriesOrder(seriesItem.sort),
                                            }))}
                                    />
                                    <div>
                                        <div className="text-xs text-gray-400 mb-2">章节</div>
                                        <div className="space-y-3">
                                            {sortedSeries.map((seriesItem) => (
                                                <div
                                                    key={seriesItem.id}
                                                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-medium leading-snug break-words">
                                                                {seriesItem.name}
                                                            </div>
                                                            <div className="text-xs text-gray-400 mt-1">#{seriesItem.id}</div>
                                                        </div>
                                                        <div className="text-xs text-gray-400 shrink-0">
                                                            {seriesItem.sort ? `第 ${seriesItem.sort} 话` : '章节'}
                                                        </div>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        className={previewFullActionButtonClass}
                                                        onPress={() => navigate(`/reader/${seriesItem.id}`, { state: { isSeries: true, album, seriesItems: sortedSeries.map((s) => ({ id: s.id, name: `${album!.name} - ${s.name}`, order: parseSeriesOrder(s.sort) })) } })}
                                                    >
                                                        <BookOpen size={14} className="mr-1" />在线观看
                                                    </Button>
                                                    <DownloadButtons
                                                        items={[{
                                                            id: seriesItem.id,
                                                            name: `${album!.name} - ${seriesItem.name}`,
                                                            order: parseSeriesOrder(seriesItem.sort),
                                                        }]}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        className={previewFullActionButtonClass}
                                        onPress={() => navigate(`/reader/${albumId}`, { state: { album, photo } })}
                                    >
                                        <BookOpen size={14} className="mr-1" />在线观看
                                    </Button>
                                    <DownloadButtons items={[{ id: albumId, name: album!.name, order: 1 }]} />
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
