import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAlbum, getPhoto } from '../api';
import { getCachedAlbum, setCachedAlbum } from '../album-cache';
import type { Album, PhotoWithScrambleId } from '@tiny-client/shared';
import { getAlbumMeta, saveAlbumMeta } from './reader-store';
import type { ChapterInfo } from './reader-types';
import { parseSeriesOrder } from './reader-types';
import {
  canPrefetchAdjacentChapter,
  getBrowserReaderNetworkCapabilities,
} from './network';

export const PHOTO_QUERY_STALE_TIME_MS = 30 * 60 * 1000;

export type ReaderNavState = {
  album?: Album | null;
  photo?: PhotoWithScrambleId | null;
  isSeries?: boolean;
  seriesItems?: ChapterInfo[];
};

export type ReaderData = {
  album: Album | undefined;
  isSeries: boolean;
  seriesItems: ChapterInfo[];
  sortedChapters: ChapterInfo[];
  currentChapterIndex: number;
  photo: PhotoWithScrambleId | undefined;
  images: PhotoWithScrambleId['images'];
  prefetchNextChapter: (signal?: AbortSignal) => Promise<PhotoWithScrambleId | undefined>;
};

export function useReaderData(options: {
  albumId: string | undefined;
  locationState: unknown;
  currentChapterId: string;
  mountAlbumId: string | undefined;
}): ReaderData {
  const { albumId, locationState, currentChapterId, mountAlbumId } = options;
  const queryClient = useQueryClient();
  const navState = locationState as ReaderNavState | null;

  const initialAlbumRef = useRef(navState?.album ?? (albumId ? getAlbumMeta(albumId) : null));
  const initialPhotoRef = useRef(navState?.photo ?? null);

  const isSeries = navState?.isSeries === true;
  const seriesItems = useMemo(() => navState?.seriesItems ?? [], [navState?.seriesItems]);

  const { data: album } = useQuery({
    queryKey: ['album', albumId],
    queryFn: async ({ signal }) => {
      const cached = await getCachedAlbum(albumId!);
      if (cached?.album) {
        saveAlbumMeta(albumId!, cached.album);
        return cached.album;
      }
      const fetched = await getAlbum(albumId!, signal);
      if (fetched) saveAlbumMeta(albumId!, fetched);
      return fetched;
    },
    enabled: !!albumId,
    // eslint-disable-next-line react-hooks/refs -- 首次渲染读缓存元数据作为 query initialData
    initialData: initialAlbumRef.current,
  });

  useEffect(() => {
    initialAlbumRef.current = navState?.album ?? (albumId ? getAlbumMeta(albumId) : null);
  }, [albumId, navState?.album]);

  useEffect(() => {
    initialPhotoRef.current = navState?.photo ?? null;
  }, [navState?.photo]);

  useEffect(() => {
    if (albumId && album) saveAlbumMeta(albumId, album);
  }, [albumId, album]);

  const sortedChapters: ChapterInfo[] = useMemo(() => {
    if (isSeries && seriesItems.length > 0) return seriesItems;
    if (album?.series?.length) {
      return [...album.series]
        .sort((a, b) => parseSeriesOrder(a.sort) - parseSeriesOrder(b.sort))
        .map((s, i) => ({ id: s.id, name: s.name || `第${i + 1}章`, order: parseSeriesOrder(s.sort) }));
    }
    return [{ id: albumId!, name: album?.name ?? '', order: 0 }];
  }, [isSeries, seriesItems, album, albumId]);

  const currentChapterIndex = sortedChapters.findIndex((c) => c.id === currentChapterId);

  const loadChapterPhoto = useCallback(async (chapterId: string, signal?: AbortSignal) => {
    const cached = await getCachedAlbum(chapterId);
    if (cached?.photo) return cached.photo;
    const fetched = await getPhoto(chapterId, signal);
    if (fetched && album) void setCachedAlbum(chapterId, album, fetched);
    return fetched ?? undefined;
  }, [album]);

  const { data: photo } = useQuery({
    queryKey: ['photo', currentChapterId],
    queryFn: async ({ signal }) => {
      return loadChapterPhoto(currentChapterId, signal);
    },
    enabled: !!currentChapterId,
    // eslint-disable-next-line react-hooks/refs -- 首次渲染读缓存图片元数据作为 query initialData
    initialData: currentChapterId === mountAlbumId ? initialPhotoRef.current : undefined,
    staleTime: PHOTO_QUERY_STALE_TIME_MS,
  });

  useEffect(() => {
    if (album && photo) void setCachedAlbum(currentChapterId, album, photo);
  }, [album, currentChapterId, photo]);

  const images: PhotoWithScrambleId['images'] = useMemo(() => photo?.images ?? [], [photo]);

  const nextChapterId = sortedChapters[currentChapterIndex + 1]?.id;
  const prefetchNextChapter = useCallback(async (signal?: AbortSignal) => {
    if (!nextChapterId || !canPrefetchAdjacentChapter(getBrowserReaderNetworkCapabilities())) return undefined;
    const queryKey = ['photo', nextChapterId] as const;
    const prefetched = await queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal: querySignal }) => loadChapterPhoto(nextChapterId, querySignal),
      staleTime: PHOTO_QUERY_STALE_TIME_MS,
    });
    return signal?.aborted ? undefined : prefetched;
  }, [loadChapterPhoto, nextChapterId, queryClient]);

  useEffect(() => {
    if (!photo || !nextChapterId) return;
    const controller = new AbortController();
    void prefetchNextChapter(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [nextChapterId, photo, prefetchNextChapter]);

  return { album: album ?? undefined, isSeries, seriesItems, sortedChapters, currentChapterIndex, photo: photo ?? undefined, images, prefetchNextChapter };
}
