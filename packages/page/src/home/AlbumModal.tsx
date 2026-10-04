import { useEffect, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { AppDialog } from "../ui/AppDialog";
import { LoadingState } from "../ui/feedback";
import { TermMenu } from "../search/TermMenu";
import { importCachedAlbums, recordAlbum } from "../search/vocabulary";
import { BookOpen, RefreshCw } from "lucide-react";
import { getBatchAlbum } from "../api";
import type { BatchAlbumItem } from "../api";
import { getCachedAlbum, setCachedAlbum } from "../album-cache";
import { saveAlbumMeta, getLatestChapterProgress } from "../reader/reader-store";
import { formatBatchError, parseSeriesOrder } from "./download-utils";
import { CoverImage } from "./CoverImage";
import { SeriesDownloadManager } from "./SeriesDownloadManager";
import { DownloadButtons, previewFullActionButtonClass } from "./DownloadButtons";

export function AlbumModal({ albumId, cachedData, onClose, extras }: {
    albumId: string;
    cachedData: BatchAlbumItem | undefined;
    onClose: () => void;
    /** Extended-mode actions (favorite, like, comments) shown under the album details. */
    extras?: ReactNode;
}) {
    const navigate = useNavigate();
    const detailQuery = useQuery<BatchAlbumItem>({
        queryKey: ['album-detail', albumId],
        queryFn: async ({ signal }) => {
            const persisted = await getCachedAlbum(albumId);
            if (persisted) {
                return { albumId, album: persisted.album, photo: persisted.photo };
            }

            const detail = (await getBatchAlbum([albumId], signal)).find((item) => item.albumId === albumId);
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
        if (!album) return;
        saveAlbumMeta(albumId, album);
        importCachedAlbums();
        recordAlbum(album);
    }, [album, albumId]);

    const header = (
        <div className="flex min-w-0 gap-3">
            {photo && photo.images[0] && (
                <CoverImage
                    coverUrl={photo.images[0].url}
                    scrambleId={photo.scrambleId}
                    albumId={albumId}
                    className="h-22 w-16 shrink-0 rounded"
                />
            )}
            <div className="min-w-0">
                <h2 className="line-clamp-3 break-words text-sm font-semibold leading-snug" title={album?.name}>
                    {album?.name ?? `#${albumId}`}
                </h2>
                <div className="mt-1 text-xs text-muted">#{albumId}</div>
            </div>
        </div>
    );

    return (
        <AppDialog title={album?.name ?? `#${albumId}`} header={header} onClose={onClose}>
            {!detailData && detailQuery.isPending ? (
                <LoadingState />
            ) : detailData?.error || detailQuery.isError ? (
                <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center text-danger">
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
                    <div className="flex gap-4 text-xs text-muted">
                        <span>浏览 {album!.totalViews}</span>
                        <span>点赞 {album!.likes}</span>
                        <span>{statsLabel}</span>
                    </div>

                    {album!.author.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs text-muted">作者</div>
                            <div className="flex flex-wrap gap-1">
                                {album!.author.map(a => (
                                    <TermMenu key={a} text={a} kind="author" onSearch={onClose} className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded text-xs" />
                                ))}
                            </div>
                        </div>
                    )}

                    {album!.tags.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs text-muted">标签</div>
                            <div className="flex flex-wrap gap-1">
                                {album!.tags.map(t => (
                                    <TermMenu key={t} text={t} kind="tag" onSearch={onClose} className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs" />
                                ))}
                            </div>
                        </div>
                    )}

                    {album!.works.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs text-muted">原作</div>
                            <div className="flex flex-wrap gap-1">
                                {album!.works.map(w => (
                                    <TermMenu key={w} text={w} kind="work" onSearch={onClose} className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-xs" />
                                ))}
                            </div>
                        </div>
                    )}

                    {album!.actors.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs text-muted">角色</div>
                            <div className="flex flex-wrap gap-1">
                                {album!.actors.map(a => (
                                    <TermMenu key={a} text={a} kind="actor" onSearch={onClose} className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-xs" />
                                ))}
                            </div>
                        </div>
                    )}

                    {extras}

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
                                <div className="mb-2 text-xs text-muted">章节</div>
                                <div className="space-y-3">
                                    {sortedSeries.map((seriesItem) => (
                                        <div
                                            key={seriesItem.id}
                                            className="rounded-lg border border-border p-3"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium leading-snug break-words">
                                                        {seriesItem.name}
                                                    </div>
                                                    <div className="mt-1 text-xs text-muted">#{seriesItem.id}</div>
                                                </div>
                                                <div className="shrink-0 text-xs text-muted">
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
        </AppDialog>
    );
}
