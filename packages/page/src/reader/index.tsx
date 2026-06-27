import { useCallback, useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAlbum, getPhoto } from '../api';
import { getCachedAlbum } from '../album-cache';
import { DecryptedImage } from './DecryptedImage';
import { ReaderOverlay } from './ReaderOverlay';
import type { ReadingDirection, BarSide } from './reader-store';
import {
  getReadingDirection,
  saveReadingDirection,
  getReadingProgress,
  getLatestChapterProgress,
  getAutoSnap,
  saveAutoSnap,
  getSeamlessMode,
  saveSeamlessMode,
  getLazyRenderRange,
  saveLazyRenderRange,
  getBarSide,
  saveBarSide,
  saveReadingProgress,
  getAlbumCache,
  saveAlbumCache,
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
async function decryptImageWithRetry(url: string, photoId: string, scrambleId: number): Promise<ArrayBuffer | null> {
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

export default function ReaderPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const initialAlbumRef = useRef(location.state?.album ?? (albumId ? getAlbumCache(albumId) : null));
  const initialPhotoRef = useRef(location.state?.photo ?? null);

  const isSeries = location.state?.isSeries === true;
  const seriesItems = (location.state?.seriesItems as ChapterInfo[] | undefined) ?? [];

  const { data: album } = useQuery({
    queryKey: ['album', albumId],
    queryFn: async () => {
      const cached = await getCachedAlbum(albumId!);
      if (cached?.album) {
        saveAlbumCache(albumId!, cached.album);
        return cached.album;
      }
      const fetched = await getAlbum(albumId!);
      if (fetched) saveAlbumCache(albumId!, fetched);
      return fetched;
    },
    enabled: !!albumId,
    initialData: initialAlbumRef.current,
  });

  useEffect(() => {
    initialAlbumRef.current = location.state?.album ?? (albumId ? getAlbumCache(albumId) : null);
  }, [albumId, location.state]);

  useEffect(() => {
    initialPhotoRef.current = location.state?.photo ?? null;
  }, [location.state]);

  useEffect(() => {
    if (albumId && album) saveAlbumCache(albumId, album);
  }, [albumId, album]);

  const sortedChapters: ChapterInfo[] = useMemo(() =>
    isSeries && seriesItems.length > 0
    ? seriesItems
    : album?.series?.map((s) => ({ id: s.id, name: s.name, order: parseSeriesOrder(s.sort) }))
        .sort((a, b) => a.order - b.order) ?? [{ id: albumId!, name: album?.name ?? '', order: 0 }],
    [isSeries, seriesItems, album, albumId]);

  const [currentChapterId, setCurrentChapterId] = useState(albumId!);
  const [direction, setDirection] = useState<ReadingDirection>(getReadingDirection);
  const [autoSnap, setAutoSnap] = useState(getAutoSnap);
  const [seamlessMode, setSeamlessMode] = useState(getSeamlessMode);
  const [lazyRenderRange, setLazyRenderRange] = useState(getLazyRenderRange);
  const [barSide, setBarSide] = useState(getBarSide);
  const [barVisible, setBarVisible] = useState(true);
  const [showUI, setShowUI] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [scrollProgressPct, setScrollProgressPct] = useState(0);
  const [blobMap, setBlobMap] = useState<Map<number, string>>(new Map());

  const isRTL = direction === 'left-right';
  const currentChapterIndex = sortedChapters.findIndex((c) => c.id === currentChapterId);

  const initialPageRef = useRef(0);
  const restoreDoneRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedSetRef = useRef(new Set<number>());
  const inflightRef = useRef(new Set<number>());
  const wheelPagingLockRef = useRef(false);
  const trackpadGestureLockRef = useRef(false);
  const trackpadDeltaAccumRef = useRef(0);
  const trackpadGestureTimerRef = useRef<number | null>(null);
  const horizontalSnapTimerRef = useRef<number | null>(null);

  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const isRTLRef = useRef(isRTL);
  isRTLRef.current = isRTL;
  const albumIdRef = useRef(albumId);
  albumIdRef.current = albumId;
  const chapterIdRef = useRef(currentChapterId);
  chapterIdRef.current = currentChapterId;
  const chapterIndexRef = useRef(currentChapterIndex);
  chapterIndexRef.current = currentChapterIndex;
  const imagesCountRef = useRef(0);

  const { data: photo } = useQuery({
    queryKey: ['photo', currentChapterId],
    queryFn: async () => {
      const cached = await getCachedAlbum(currentChapterId);
      if (cached?.photo) return cached.photo;
      return getPhoto(currentChapterId);
    },
    enabled: !!currentChapterId,
    initialData: currentChapterId === albumId ? initialPhotoRef.current : undefined,
  });

  const images = photo?.images ?? [];
  const imagesRef = useRef(images);
  imagesRef.current = images;
  imagesCountRef.current = images.length;
  const photoRef = useRef(photo);
  photoRef.current = photo;

  // ─── navigation ──────────────────────────────────────────────────────────────

  const scrollToPage = useCallback((index: number, behavior: ScrollBehavior = 'instant') => {
    const el = containerRef.current;
    if (!el) return;
    const child = el.children[index] as HTMLElement | undefined;
    if (!child) return;
    if (isRTLRef.current) {
      el.scrollTo({ left: child.offsetLeft, behavior });
    } else {
      el.scrollTo({ top: child.offsetTop, behavior });
    }
  }, []);

  const seekPage = useCallback((page: number) => {
    const total = imagesCountRef.current;
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(total - 1, page));
    setCurrentPage(clamped);
    scrollToPage(clamped, 'instant');
  }, [scrollToPage]);

  const scrollByInputStep = useCallback((step: number) => {
    const el = containerRef.current;
    if (!el) return;

    if (isRTLRef.current) {
      const target = Math.max(0, Math.min(imagesCountRef.current - 1, currentPageRef.current + step));
      if (target !== currentPageRef.current) {
        setCurrentPage(target);
        scrollToPage(target, 'smooth');
      }
      return;
    }

    const distance = Math.max(el.clientHeight * 0.9, 1) * step;
    el.scrollBy({ top: distance, behavior: 'smooth' });
  }, [scrollToPage]);

  const goNextPage = useCallback(() => {
    const page = currentPageRef.current;
    if (page < imagesCountRef.current - 1) {
      setCurrentPage(page + 1);
      scrollToPage(page + 1, 'smooth');
    }
  }, [scrollToPage]);

  const goPrevPage = useCallback(() => {
    const page = currentPageRef.current;
    if (page > 0) {
      setCurrentPage(page - 1);
      scrollToPage(page - 1, 'smooth');
    }
  }, [scrollToPage]);

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

  const toggleAutoSnap = useCallback(() => {
    setAutoSnap((prev) => {
      saveAutoSnap(!prev);
      return !prev;
    });
  }, []);

  const changeBarSide = useCallback((side: BarSide) => {
    setBarSide(side);
    saveBarSide(side);
  }, []);

  const toggleSeamlessMode = useCallback(() => {
    setSeamlessMode((prev) => {
      const next = !prev;
      saveSeamlessMode(next);
      return next;
    });
  }, []);

  const changeLazyRenderRange = useCallback((value: number) => {
    const next = Math.max(1, Math.min(12, Math.round(value)));
    setLazyRenderRange(next);
    saveLazyRenderRange(next);
  }, []);

  // ─── preloader ───────────────────────────────────────────────────────────────

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

  // ─── scroll observer (page detection only, no snap) ────────────────────────

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !photo || images.length === 0) return;

    const isHorizontal = isRTL;
    const snapEnabled = autoSnap && !seamlessMode;
    const shouldSettleHorizontal = isHorizontal && snapEnabled && window.matchMedia('(pointer: fine)').matches;

    const clearHorizontalSnapTimer = () => {
      if (horizontalSnapTimerRef.current !== null) {
        window.clearTimeout(horizontalSnapTimerRef.current);
        horizontalSnapTimerRef.current = null;
      }
    };

    const settleHorizontalPage = () => {
      clearHorizontalSnapTimer();
      const page = currentPageRef.current;
      const child = el.children[page] as HTMLElement | undefined;
      if (!child) return;
      const delta = Math.abs(el.scrollLeft - child.offsetLeft);
      if (delta > 1) scrollToPage(page, 'smooth');
    };

    const onScroll = () => {
      const children = el.children;
      if (children.length === 0) return;
      if (isHorizontal) {
        const max = Math.max(el.scrollWidth - el.clientWidth, 0);
        setScrollProgressPct(max === 0 ? 0 : Math.round((el.scrollLeft / max) * 100));
        const center = el.scrollLeft + el.clientWidth / 2;
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          const mid = child.offsetLeft + child.offsetWidth / 2;
          const dist = Math.abs(center - mid);
          if (dist < bestDist) { bestDist = dist; best = i; }
        }
        if (best !== currentPageRef.current) setCurrentPage(best);
        if (shouldSettleHorizontal) {
          clearHorizontalSnapTimer();
          horizontalSnapTimerRef.current = window.setTimeout(settleHorizontalPage, 120);
        }
      } else {
        const max = Math.max(el.scrollHeight - el.clientHeight, 0);
        setScrollProgressPct(max === 0 ? 0 : Math.round((el.scrollTop / max) * 100));
        const center = el.scrollTop + el.clientHeight / 2;
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          const mid = child.offsetTop + child.offsetHeight / 2;
          const dist = Math.abs(center - mid);
          if (dist < bestDist) { bestDist = dist; best = i; }
        }
        if (best !== currentPageRef.current) setCurrentPage(best);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });

    const progress = getLatestChapterProgress(albumIdRef.current!, sortedChapters.map((c) => c.id));
    if (progress && progress.chapterId !== chapterIdRef.current) {
      setCurrentChapterId(progress.chapterId);
      return () => { el.removeEventListener('scroll', onScroll); };
    }
    const stored = getReadingProgress(albumIdRef.current!, chapterIdRef.current);
    const startPage = stored?.page ?? 0;
    initialPageRef.current = startPage;
    if (!restoreDoneRef.current) {
      restoreDoneRef.current = true;
      preloadRange(startPage);
    }
    const tid = setTimeout(() => scrollToPage(startPage), 0);
    requestAnimationFrame(onScroll);

    return () => {
      clearTimeout(tid);
      clearHorizontalSnapTimer();
      el.removeEventListener('scroll', onScroll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, direction, albumId, currentChapterId, currentChapterIndex, images.length, autoSnap, seamlessMode]);

  useEffect(() => {
    if (!albumId || !currentChapterId || images.length === 0) return;

    saveReadingProgress({
      albumId,
      chapterId: currentChapterId,
      chapterIndex: Math.max(currentChapterIndex, 0),
      page: currentPage,
      totalPages: images.length,
      updatedAt: Date.now(),
    });
  }, [albumId, currentChapterId, currentChapterIndex, currentPage, images.length]);

  // ─── wheel / touchpad scrolling ────────────────────────────────────────────

  useEffect(() => {
    if (!isRTL || !photo) return;
    const el = containerRef.current;
    if (!el) return;

    const resetTrackpadGesture = () => {
      trackpadGestureLockRef.current = false;
      trackpadDeltaAccumRef.current = 0;
      if (trackpadGestureTimerRef.current !== null) {
        window.clearTimeout(trackpadGestureTimerRef.current);
        trackpadGestureTimerRef.current = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      const dominantDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(dominantDelta) < 4) return;

      e.preventDefault();

      const isTrackpad = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 40);

      if (isTrackpad) {
        trackpadDeltaAccumRef.current += dominantDelta;
        if (trackpadGestureTimerRef.current !== null) {
          window.clearTimeout(trackpadGestureTimerRef.current);
        }
        trackpadGestureTimerRef.current = window.setTimeout(resetTrackpadGesture, 140);

        if (trackpadGestureLockRef.current || Math.abs(trackpadDeltaAccumRef.current) < 60) {
          return;
        }

        trackpadGestureLockRef.current = true;
        scrollByInputStep(trackpadDeltaAccumRef.current > 0 ? 1 : -1);
        return;
      }

      if (wheelPagingLockRef.current) return;
      wheelPagingLockRef.current = true;

      scrollByInputStep(dominantDelta > 0 ? 1 : -1);

      window.setTimeout(() => {
        wheelPagingLockRef.current = false;
      }, 260);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      resetTrackpadGesture();
    };
  }, [isRTL, photo, scrollByInputStep]);

  // ── click-to-flip overlay (click left/right edges for RTL, top/bottom for vertical) ──

  const handleFlipClick = useCallback((e: React.MouseEvent) => {
    if (showUI) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (isRTL) {
      const relX = (e.clientX - rect.left) / rect.width;
      if (relX < 0.33) goPrevPage();
      else if (relX > 0.67) goNextPage();
      else setShowUI(true);
    } else {
      const relY = (e.clientY - rect.top) / rect.height;
      if (relY < 0.33) scrollByInputStep(-1);
      else if (relY > 0.67) scrollByInputStep(1);
      else setShowUI(true);
    }
  }, [showUI, isRTL, goPrevPage, goNextPage, scrollByInputStep]);

  // ─── render ──────────────────────────────────────────────────────────────────

  const title = album?.name ?? currentChapterId;

  if (!photo) {
    return (
      <div className="fixed inset-0 bg-black select-none">
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
            <span className="text-gray-400 text-sm">加载中...</span>
          </div>
        </div>
      </div>
    );
  }

  const barPad = barVisible ? {
    paddingBottom: barSide === 'bottom' ? 40 : 0,
    paddingLeft: barSide === 'left' ? 40 : 0,
    paddingRight: barSide === 'right' ? 40 : 0,
  } : {};

  const scrollDivStyle: React.CSSProperties = {
    position: 'relative',
    overflowX: isRTL ? 'auto' : 'hidden',
    overflowY: isRTL ? 'hidden' : 'auto',
    display: 'flex',
    flexDirection: isRTL ? 'row' : 'column',
    gap: 0,
    scrollSnapType: autoSnap && !seamlessMode ? (isRTL ? 'x mandatory' : 'y mandatory') : 'none',
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain',
    touchAction: isRTL ? 'pan-x' : 'pan-y',
    ...barPad,
  };

  const pageStyle: React.CSSProperties = isRTL
    ? {
        flex: '0 0 100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        scrollSnapAlign: autoSnap && !seamlessMode ? 'start' : undefined,
        scrollSnapStop: autoSnap && !seamlessMode ? 'always' : undefined,
      }
    : {
        height: 'auto',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        scrollSnapAlign: autoSnap && !seamlessMode ? 'start' : undefined,
        scrollSnapStop: autoSnap && !seamlessMode ? 'always' : undefined,
      };

  const imgCls = isRTL
    ? 'max-h-full max-w-full h-auto w-auto object-contain'
    : 'h-auto w-full object-contain';

  const lazyRenderStart = Math.max(0, currentPage - lazyRenderRange);
  const lazyRenderEnd = Math.min(images.length - 1, currentPage + lazyRenderRange);

  return (
    <div className="fixed inset-0 bg-black select-none overflow-hidden">
      <div ref={containerRef} className="h-full w-full" style={scrollDivStyle}>
        {images.map((img, i) => {
          const url = blobMap.get(i);
          const shouldRenderImage = i >= lazyRenderStart && i <= lazyRenderEnd;
          return (
            <div key={img.name} className="shrink-0" style={pageStyle}>
              {url ? (
                <img src={url} alt="" draggable={false} className={imgCls} />
              ) : !shouldRenderImage ? (
                <div className={`relative overflow-hidden bg-gray-900/60 ${imgCls}`}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-500/70 border-t-white" />
                    </div>
                  </div>
                </div>
              ) : (
                <DecryptedImage
                  image={img}
                  photo={photo}
                  className={imgCls}
                  onLoad={(blobUrl) => {
                    loadedSetRef.current.add(i);
                    inflightRef.current.add(i);
                    setBlobMap((prev) => { const next = new Map(prev); if (!next.has(i)) next.set(i, blobUrl); return next; });
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* click-to-flip zone — only active when UI hidden */}
      {!showUI && (
        <div className="absolute inset-0 z-10" onClick={handleFlipClick} />
      )}

      <ReaderOverlay
        visible={showUI}
        title={title}
        currentPage={currentPage}
        totalPages={images.length}
        scrollProgressPct={scrollProgressPct}
        chapterName={sortedChapters[currentChapterIndex]?.name ?? ''}
        chapters={sortedChapters}
        currentChapterId={currentChapterId}
        direction={direction}
        hasPrevChapter={currentChapterIndex > 0}
        hasNextChapter={currentChapterIndex < sortedChapters.length - 1}
        autoSnap={autoSnap}
        seamlessMode={seamlessMode}
        lazyRenderRange={lazyRenderRange}
        barSide={barSide}
        barVisible={barVisible}
        onToggleVisibility={() => setShowUI((v) => !v)}
        onClose={() => navigate(-1)}
        onPrevPage={goPrevPage}
        onNextPage={goNextPage}
        onPrevChapter={goPrevChapter}
        onNextChapter={goNextChapter}
        onGoToChapter={goToChapter}
        onToggleDirection={toggleDirection}
        onToggleAutoSnap={toggleAutoSnap}
        onToggleSeamlessMode={toggleSeamlessMode}
        onChangeLazyRenderRange={changeLazyRenderRange}
        onChangeBarSide={changeBarSide}
        onToggleBarVisible={() => setBarVisible(v => !v)}
        onScrollByInputStep={scrollByInputStep}
        onSeekPage={seekPage}
      />
    </div>
  );
}
