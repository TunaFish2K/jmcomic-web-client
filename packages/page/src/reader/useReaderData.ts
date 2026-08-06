import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAlbum, getPhoto } from '../api';
import { getCachedAlbum, setCachedAlbum } from '../album-cache';
import type { Album, PhotoWithScrambleId } from '@tiny-client/shared';
import { getAlbumMeta, saveAlbumMeta } from './reader-store';
import type { ChapterInfo } from './reader-types';
import { parseSeriesOrder } from './reader-types';

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
};

export function useReaderData(options: {
  albumId: string | undefined;
  locationState: unknown;
  currentChapterId: string;
  mountAlbumId: string | undefined;
}): ReaderData {
  const { albumId, locationState, currentChapterId, mountAlbumId } = options;
  const navState = locationState as ReaderNavState | null;

  const initialAlbumRef = useRef(navState?.album ?? (albumId ? getAlbumMeta(albumId) : null));
  const initialPhotoRef = useRef(navState?.photo ?? null);

  const isSeries = navState?.isSeries === true;
  const seriesItems = useMemo(() => navState?.seriesItems ?? [], [navState?.seriesItems]);

  const { data: album } = useQuery({
    queryKey: ['album', albumId],
    queryFn: async () => {
      const cached = await getCachedAlbum(albumId!);
      if (cached?.album) {
        saveAlbumMeta(albumId!, cached.album);
        return cached.album;
      }
      const fetched = await getAlbum(albumId!);
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

  const { data: photo } = useQuery({
    queryKey: ['photo', currentChapterId],
    queryFn: async ({ signal }) => {
      const cached = await getCachedAlbum(currentChapterId);
      if (cached?.photo) return cached.photo;
      const fetched = await getPhoto(currentChapterId, signal);
      if (fetched && album) {
        // Persist photo in IndexedDB under the chapter id so re-entry is instant.
        setCachedAlbum(currentChapterId, album, fetched);
      }
      return fetched;
    },
    enabled: !!currentChapterId,
    // eslint-disable-next-line react-hooks/refs -- 首次渲染读缓存图片元数据作为 query initialData
    initialData: currentChapterId === mountAlbumId ? initialPhotoRef.current : undefined,
  });

  const images: PhotoWithScrambleId['images'] = useMemo(() => photo?.images ?? [], [photo]);

  return { album, isSeries, seriesItems, sortedChapters, currentChapterIndex, photo, images };
}
