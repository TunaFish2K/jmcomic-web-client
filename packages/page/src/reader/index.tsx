import { useCallback, useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAlbum, getPhoto } from '../api';
import { DecryptedImage } from './DecryptedImage';
import { ReaderOverlay } from './ReaderOverlay';
import type { ReadingDirection } from './reader-store';
import {
  getReadingDirection,
  saveReadingDirection,
  getReadingProgress,
  saveReadingProgress,
  getLatestChapterProgress,
  getSeamlessScroll,
  saveSeamlessScroll,
  getAutoSnap,
  saveAutoSnap,
} from './reader-store';
import pLimit from 'p-limit';
import { getSliceCount, reverseImageBySlice } from '@tiny-client/shared';

function parseSeriesOrder(value: string | number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

type ChapterInfo = { id: string; name: string; order: number };

const PRELOAD_AHEAD = 10;
const PRELOAD_PARALLEL = 5;

function convertToJpeg(imageData: ArrayBuffer): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    try {
      const blob = new Blob([imageData]);
      createImageBitmap(blob).then((bitmap) => {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }).then((jpegBlob) => {
          jpegBlob.arrayBuffer().then(resolve);
        });
      }).catch(() => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

async function decryptImageWithRetry(
  url: string,
  photoId: string,
  scrambleId: number,
): Promise<ArrayBuffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const filename = url.split('/').pop() ?? '';
      const slices = getSliceCount(scrambleId, parseInt(photoId), filename);
      if (slices > 0) {
        const reversed = await reverseImageBySlice(buffer, slices);
        const jpeg = await convertToJpeg(reversed.data);
        if (jpeg) return jpeg;
        throw new Error('JPEG conversion failed');
      }
      const jpeg = await convertToJpeg(buffer);
      if (jpeg) return jpeg;
      throw new Error('JPEG conversion failed');
    } catch {
      await new Promise((r) => setTimeout(r, [400, 1000, 2000][attempt]));
    }
  }
  return null;
}

export default function ReaderPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const isSeries = location.state?.isSeries === true;
  const seriesItems = (location.state?.seriesItems as ChapterInfo[] | undefined) ?? [];

  const { data: album } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => getAlbum(albumId!),
    enabled: !!albumId,
  });

  const sortedChapters: ChapterInfo[] = useMemo(() =>
    isSeries && seriesItems.length > 0
    ? seriesItems
    : album?.series?.map((s) => ({ id: s.id, name: s.name, order: parseSeriesOrder(s.sort) }))
        .sort((a, b) => a.order - b.order) ?? [{ id: albumId!, name: album?.name ?? '', order: 0 }],
    [isSeries, seriesItems, album, albumId]);

  const [currentChapterId, setCurrentChapterId] = useState(albumId!);
  const [direction, setDirection] = useState<ReadingDirection>(getReadingDirection);
  const [seamless, setSeamless] = useState(getSeamlessScroll);
  const [autoSnap, setAutoSnap] = useState(getAutoSnap);
  const [showUI, setShowUI] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [blobMap, setBlobMap] = useState<Map<number, string>>(new Map());
  const initialPageRef = useRef(0);
  const restoreDoneRef = useRef(false);

  const currentChapterIndex = sortedChapters.findIndex((c) => c.id === currentChapterId);

  const { data: photo } = useQuery({
    queryKey: ['photo', currentChapterId],
    queryFn: () => getPhoto(currentChapterId),
    enabled: !!currentChapterId,
  });

  const images = photo?.images ?? [];
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedSetRef = useRef(new Set<number>());
  const inflightRef = useRef(new Set<number>());
  const photoRef = useRef(photo);
  photoRef.current = photo;

  // ─── navigation ──────────────────────────────────────────────────────────────

  const scrollToPage = useCallback((index: number) => {
    const el = containerRef.current;
    if (!el) return;
    const child = el.children[index] as HTMLElement | undefined;
    if (!child) return;
    setCurrentPage(index);
    if (direction === 'left-right') {
      el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: 'instant' });
    } else {
      el.scrollTo({ top: child.offsetTop - el.offsetTop, behavior: 'instant' });
    }
  }, [direction]);

  const goNextPage = useCallback(() => {
    if (currentPage < images.length - 1) scrollToPage(currentPage + 1);
  }, [currentPage, images.length, scrollToPage]);

  const goPrevPage = useCallback(() => {
    if (currentPage > 0) scrollToPage(currentPage - 1);
  }, [currentPage, scrollToPage]);

  const resetReader = useCallback((newChapterId: string, page?: number) => {
    setCurrentChapterId(newChapterId);
    setCurrentPage(page ?? 0);
    setBlobMap(new Map());
    loadedSetRef.current = new Set();
    inflightRef.current = new Set();
    restoreDoneRef.current = false;
  }, []);

  const goNextChapter = useCallback(() => {
    if (currentChapterIndex < sortedChapters.length - 1) {
      resetReader(sortedChapters[currentChapterIndex + 1].id);
    }
  }, [currentChapterIndex, sortedChapters, resetReader]);

  const goPrevChapter = useCallback(() => {
    if (currentChapterIndex > 0) {
      resetReader(sortedChapters[currentChapterIndex - 1].id);
    }
  }, [currentChapterIndex, sortedChapters, resetReader]);

  const goToChapter = useCallback((chapterId: string) => {
    resetReader(chapterId);
  }, [resetReader]);

  const toggleDirection = useCallback(() => {
    setDirection((prev) => {
      const next: ReadingDirection = prev === 'left-right' ? 'top-down' : 'left-right';
      saveReadingDirection(next);
      return next;
    });
  }, []);

  const toggleSeamless = useCallback(() => {
    setSeamless((prev) => {
      saveSeamlessScroll(!prev);
      return !prev;
    });
  }, []);

  const toggleAutoSnap = useCallback(() => {
    setAutoSnap((prev) => {
      saveAutoSnap(!prev);
      return !prev;
    });
  }, []);

  // ─── scroll observer ─────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !photo || images.length === 0) return;

    const updatePageFromScroll = () => {
      const children = el.children;
      if (children.length === 0) return;
      if (direction === 'left-right') {
        const centerX = el.scrollLeft + el.clientWidth / 2;
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          const midX = child.offsetLeft + child.offsetWidth / 2;
          const dist = Math.abs(centerX - midX);
          if (dist < bestDist) { bestDist = dist; best = i; }
        }
        if (best !== currentPage) {
          setCurrentPage(best);
          saveReadingProgress({
            albumId: albumId!,
            chapterId: currentChapterId,
            chapterIndex: currentChapterIndex,
            page: best,
            totalPages: images.length,
            updatedAt: Date.now(),
          });
        }
      } else {
        const centerY = el.scrollTop + el.clientHeight / 2;
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          const midY = child.offsetTop + child.offsetHeight / 2;
          const dist = Math.abs(centerY - midY);
          if (dist < bestDist) { bestDist = dist; best = i; }
        }
        if (best !== currentPage) {
          setCurrentPage(best);
          saveReadingProgress({
            albumId: albumId!,
            chapterId: currentChapterId,
            chapterIndex: currentChapterIndex,
            page: best,
            totalPages: images.length,
            updatedAt: Date.now(),
          });
        }
      }
    };

    const onScrollEnd = () => updatePageFromScroll();
    el.addEventListener('scrollend', onScrollEnd);
    el.addEventListener('scroll', updatePageFromScroll, { passive: true });

    const progress = getLatestChapterProgress(albumId!, sortedChapters.map((c) => c.id));
    if (progress && progress.chapterId !== currentChapterId) {
      setCurrentChapterId(progress.chapterId);
      return () => {};
    }
    const stored = getReadingProgress(albumId!, currentChapterId);
    const startPage = stored?.page ?? 0;
    initialPageRef.current = startPage;
    if (!restoreDoneRef.current) {
      restoreDoneRef.current = true;
      preloadRange(startPage);
    }
    const tid = setTimeout(() => scrollToPage(startPage), 0);

    return () => {
      clearTimeout(tid);
      el.removeEventListener('scrollend', onScrollEnd);
      el.removeEventListener('scroll', updatePageFromScroll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, direction, albumId, currentChapterId, currentChapterIndex, images.length]);

  // ─── preloader — simple window around currentPage ─────────────────────────────

  const preloadRange = useCallback((start: number) => {
    const imgs = imagesRef.current;
    if (imgs.length === 0) return;
    const p = photoRef.current;
    if (!p) return;

    const end = Math.min(start + PRELOAD_AHEAD, imgs.length);
    const toLoad: number[] = [];
    for (let i = start; i < end; i++) {
      if (!loadedSetRef.current.has(i) && !inflightRef.current.has(i)) {
        toLoad.push(i);
      }
    }
    if (toLoad.length === 0) return;

    for (const idx of toLoad) inflightRef.current.add(idx);

    const limit = pLimit(PRELOAD_PARALLEL);
    for (const idx of toLoad) {
      limit(async () => {
        const img = imgs[idx];
        const data = await decryptImageWithRetry(img.url, p.id, p.scrambleId);
        if (data) {
          const blob = new Blob([data], { type: 'image/jpeg' });
          const blobUrl = URL.createObjectURL(blob);
          setBlobMap((prev) => {
            const next = new Map(prev);
            next.set(idx, blobUrl);
            return next;
          });
          loadedSetRef.current.add(idx);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!photo || images.length === 0) return;
    if (restoreDoneRef.current) return;
    restoreDoneRef.current = true;
    const stored = getLatestChapterProgress(albumId!, sortedChapters.map((c) => c.id));
    const startPage = stored?.chapterId === currentChapterId ? stored.page : getReadingProgress(albumId!, currentChapterId)?.page ?? 0;
    preloadRange(startPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, images.length]);

  useEffect(() => {
    if (images.length === 0) return;
    preloadRange(currentPage);
  }, [currentPage, preloadRange, images.length]);

  // ─── render ──────────────────────────────────────────────────────────────────

  const isRTL = direction === 'left-right';
  const title = album?.name ?? currentChapterId;

  return (
    <div className="fixed inset-0 bg-black select-none overflow-hidden">
      {photo ? (
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{
            overflowX: isRTL ? 'auto' : 'hidden',
            overflowY: isRTL ? 'hidden' : 'auto',
            scrollSnapType: seamless
              ? (autoSnap ? `${isRTL ? 'x' : 'y'} proximity` : 'none')
              : `${isRTL ? 'x' : 'y'} mandatory`,
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            flexDirection: isRTL ? 'row' : 'column',
          }}
        >
          {images.map((img, i) => {
            const url = blobMap.get(i);
            return (
              <div
                key={img.name}
                className="shrink-0 flex items-center justify-center"
                style={{
                  scrollSnapAlign: seamless && !autoSnap ? undefined : 'start',
                  width: isRTL ? '100%' : '100%',
                  height: isRTL ? '100%' : '100%',
                  flex: '0 0 100%',
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    draggable={false}
                    className={
                      isRTL
                        ? 'max-h-full max-w-full h-auto w-auto object-contain px-4'
                        : 'max-h-full max-w-full h-auto w-auto object-contain py-4'
                    }
                  />
                ) : (
                  <DecryptedImage
                    image={img}
                    photo={photo}
                    className={
                      isRTL
                        ? 'max-h-full max-w-full h-auto w-auto object-contain px-4'
                        : 'max-h-full max-w-full h-auto w-auto object-contain py-4'
                    }
                    onLoad={(blobUrl) => {
                      loadedSetRef.current.add(i);
                      inflightRef.current.add(i);
                      setBlobMap((prev) => {
                        const next = new Map(prev);
                        if (!next.has(i)) next.set(i, blobUrl);
                        return next;
                      });
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
            <span className="text-gray-400 text-sm">加载中...</span>
          </div>
        </div>
      )}

      <ReaderOverlay
        visible={showUI}
        title={title}
        currentPage={currentPage}
        totalPages={images.length}
        chapterName={sortedChapters[currentChapterIndex]?.name ?? ''}
        chapters={sortedChapters}
        currentChapterId={currentChapterId}
        direction={direction}
        hasPrevChapter={currentChapterIndex > 0}
        hasNextChapter={currentChapterIndex < sortedChapters.length - 1}
        seamless={seamless}
        autoSnap={autoSnap}
        onToggleVisibility={() => setShowUI((v) => !v)}
        onClose={() => navigate(-1)}
        onPrevPage={goPrevPage}
        onNextPage={goNextPage}
        onPrevChapter={goPrevChapter}
        onNextChapter={goNextChapter}
        onGoToChapter={goToChapter}
        onToggleDirection={toggleDirection}
        onToggleSeamless={toggleSeamless}
        onToggleAutoSnap={toggleAutoSnap}
      />
    </div>
  );
}
