import { useCallback, useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAlbum, getPhoto } from '../api';
import { getCachedAlbum, setCachedAlbum } from '../album-cache';
import { DecryptedImage } from './DecryptedImage';
import { ReaderOverlay } from './ReaderOverlay';
import type { ReadingDirection } from './reader-store';
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
  saveReadingProgress,
  getAlbumMeta,
  saveAlbumMeta,
} from './reader-store';
import pLimit from 'p-limit';
import { getSliceCount, reverseImageBySlice, getCachedImage, setCachedImage, generateImageCacheKey, type PhotoWithScrambleId } from '@tiny-client/shared';
import {
  accumulateBoundaryGesture,
  getBoundaryDirection,
  getChapterLandingPage,
  getDominantWheelDelta,
  isCurrentChapterLoad,
  isLikelyTrackpadWheel,
  isMatchingChapterTransition,
  isScrollTargetReached,
  MOUSE_WHEEL_BOUNDARY_CONTRIBUTION,
  type ChapterDirection,
} from './navigation';

function parseSeriesOrder(value: string | number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

type ChapterInfo = { id: string; name: string; order: number };
type PendingNavigation = {
  chapterId: string;
  requestedPage: number | 'last' | null;
  resolvedPage: number | null;
  transitionId: number | null;
};
type LandingAnchor = { chapterId: string; page: number };

const PRELOAD_AHEAD = 10;
const PRELOAD_PARALLEL = 5;
const BOUNDARY_RESET_DELAY_MS = 2000;
const CHAPTER_SWITCH_UNLOCK_DELAY_MS = 5000;
const LANDING_ANCHOR_DELAY_MS = 5000;
const PROGRAMMATIC_PAGE_TARGET_TIMEOUT_MS = 1500;
const TRACKPAD_GESTURE_END_DELAY_MS = 140;
async function decryptImageWithRetry(url: string, photoId: string, scrambleId: number): Promise<ArrayBuffer | null> {
  const filename = url.split('/').pop() ?? '';
  const cacheKey = generateImageCacheKey(photoId, filename);

  // Try IndexedDB cache first
  const cached = await getCachedImage(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const slices = getSliceCount(scrambleId, parseInt(photoId), filename);
      if (slices > 0) {
        const reversed = await reverseImageBySlice(buffer, slices);
        const jpeg = await convertToJpeg(reversed.data);
        if (jpeg) { setCachedImage(cacheKey, jpeg); return jpeg; }
        throw new Error('JPEG conversion failed');
      }
      const jpeg = await convertToJpeg(buffer);
      if (jpeg) { setCachedImage(cacheKey, jpeg); return jpeg; }
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
  const initialAlbumRef = useRef(location.state?.album ?? (albumId ? getAlbumMeta(albumId) : null));
  const initialPhotoRef = useRef(location.state?.photo ?? null);

  const isSeries = location.state?.isSeries === true;
  const seriesItems = (location.state?.seriesItems as ChapterInfo[] | undefined) ?? [];

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
    initialData: initialAlbumRef.current,
  });

  useEffect(() => {
    initialAlbumRef.current = location.state?.album ?? (albumId ? getAlbumMeta(albumId) : null);
  }, [albumId, location.state]);

  useEffect(() => {
    initialPhotoRef.current = location.state?.photo ?? null;
  }, [location.state]);

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

  const [currentChapterId, setCurrentChapterId] = useState(albumId!);
  const [direction, setDirection] = useState<ReadingDirection>(getReadingDirection);
  const [autoSnap, setAutoSnap] = useState(getAutoSnap);
  const [seamlessMode, setSeamlessMode] = useState(getSeamlessMode);
  const [lazyRenderRange, setLazyRenderRange] = useState(getLazyRenderRange);
  const [barSide] = useState(getBarSide);
  const [barVisible, setBarVisible] = useState(true);
  const [showUI, setShowUI] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [blobMap, setBlobMap] = useState<Map<number, string>>(new Map());

  // ── boundary chapter-swap hint (pull past first/last page) ──
  const [hint, setHint] = useState<{ dir: 'prev' | 'next'; progress: number; chapterName: string } | null>(null);
  const [boundaryToast, setBoundaryToast] = useState<'prev' | 'next' | null>(null);
  const boundaryAccumRef = useRef(0);
  const boundaryDirectionRef = useRef<ChapterDirection | null>(null);
  const boundaryTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const touchTrackingRef = useRef<{ boundaryDir: 'prev' | 'next'; startX: number; startY: number; startScroll: number; distance: number } | null>(null);

  // ── chapter-transition snapshot (keeps last page visible while switching) ──
  const [snapshot, setSnapshot] = useState<{ url: string; w: number; h: number } | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const isRTL = direction === 'left-right';
  const currentChapterIndex = sortedChapters.findIndex((c) => c.id === currentChapterId);

  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const landingAnchorRef = useRef<LandingAnchor | null>(null);
  const landingAnchorTimerRef = useRef<number | null>(null);
  const transitionSequenceRef = useRef(0);
  const activeTransitionIdRef = useRef<number | null>(null);
  const transitionUnlockTimerRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const switchingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedSetRef = useRef(new Set<number>());
  const inflightRef = useRef(new Set<number>());
  const wheelPagingLockRef = useRef(false);
  const wheelPagingTimerRef = useRef<number | null>(null);
  const programmaticPageTargetRef = useRef<number | null>(null);
  const programmaticPageTargetTimerRef = useRef<number | null>(null);
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
  const seriesRootRef = useRef<string>(albumId ?? '');
  const mountAlbumIdRef = useRef<string | undefined>(albumId);
  // Stable canonical series id for progress keys: prefer album.seriesID once known.
  useEffect(() => {
    const root = album?.seriesID;
    if (root && root !== seriesRootRef.current) seriesRootRef.current = root;
  }, [album]);
  const chapterIdRef = useRef(currentChapterId);
  chapterIdRef.current = currentChapterId;
  const chapterIndexRef = useRef(currentChapterIndex);
  chapterIndexRef.current = currentChapterIndex;
  const imagesCountRef = useRef(0);
  const hasPrevChapterRef = useRef(false);
  hasPrevChapterRef.current = currentChapterIndex > 0;
  const hasNextChapterRef = useRef(false);
  hasNextChapterRef.current = currentChapterIndex < sortedChapters.length - 1;
  const prevChapterNameRef = useRef('');
  prevChapterNameRef.current = sortedChapters[currentChapterIndex - 1]?.name ?? '';
  const nextChapterNameRef = useRef('');
  nextChapterNameRef.current = sortedChapters[currentChapterIndex + 1]?.name ?? '';
  const sortedChaptersRef = useRef(sortedChapters);
  sortedChaptersRef.current = sortedChapters;

  // Per-chapter reading progress for the chapter drawer.
  const chapterProgress = useMemo(() => {
    const root = seriesRootRef.current || albumIdRef.current || albumId || '';
    const map: Record<string, { page: number; totalPages: number } | undefined> = {};
    for (const ch of sortedChapters) {
      const p = getReadingProgress(root, ch.id);
      if (p) map[ch.id] = { page: p.page, totalPages: p.totalPages };
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedChapters, currentPage, currentChapterId]);

  const { data: photo } = useQuery({
    queryKey: ['photo', currentChapterId],
    queryFn: async () => {
      const cached = await getCachedAlbum(currentChapterId);
      if (cached?.photo) return cached.photo;
      const fetched = await getPhoto(currentChapterId);
      if (fetched && album) {
        // Persist photo in IndexedDB under the chapter id so re-entry is instant.
        setCachedAlbum(currentChapterId, album, fetched);
      }
      return fetched;
    },
    enabled: !!currentChapterId,
    initialData: currentChapterId === mountAlbumIdRef.current ? initialPhotoRef.current : undefined,
  });

  const images: PhotoWithScrambleId['images'] = photo?.images ?? [];
  const imagesRef = useRef(images);
  imagesRef.current = images;
  imagesCountRef.current = images.length;
  const photoRef = useRef(photo);
  photoRef.current = photo;

  // ─── navigation ──────────────────────────────────────────────────────────────

  const setReaderPage = useCallback((page: number) => {
    currentPageRef.current = page;
    setCurrentPage(page);
  }, []);

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

  const getScrollMetrics = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    if (isRTLRef.current) {
      const lastPage = el.children[imagesCountRef.current - 1] as HTMLElement | undefined;
      return {
        position: el.scrollLeft,
        maxPosition: lastPage?.offsetLeft ?? Math.max(el.scrollWidth - el.clientWidth, 0),
      };
    }
    return {
      position: el.scrollTop,
      maxPosition: Math.max(el.scrollHeight - el.clientHeight, 0),
    };
  }, []);

  const releaseLandingAnchor = useCallback(() => {
    landingAnchorRef.current = null;
    if (landingAnchorTimerRef.current !== null) {
      window.clearTimeout(landingAnchorTimerRef.current);
      landingAnchorTimerRef.current = null;
    }
  }, []);

  const setLandingAnchor = useCallback((chapterId: string, page: number) => {
    releaseLandingAnchor();
    landingAnchorRef.current = { chapterId, page };
    landingAnchorTimerRef.current = window.setTimeout(releaseLandingAnchor, LANDING_ANCHOR_DELAY_MS);
  }, [releaseLandingAnchor]);

  const clearProgrammaticPageTarget = useCallback(() => {
    programmaticPageTargetRef.current = null;
    if (programmaticPageTargetTimerRef.current !== null) {
      window.clearTimeout(programmaticPageTargetTimerRef.current);
      programmaticPageTargetTimerRef.current = null;
    }
  }, []);

  const setProgrammaticPageTarget = useCallback((page: number) => {
    clearProgrammaticPageTarget();
    programmaticPageTargetRef.current = page;
    programmaticPageTargetTimerRef.current = window.setTimeout(
      clearProgrammaticPageTarget,
      PROGRAMMATIC_PAGE_TARGET_TIMEOUT_MS,
    );
  }, [clearProgrammaticPageTarget]);

  const completeChapterTransition = useCallback((transitionId: number | null, chapterId: string) => {
    if (!isMatchingChapterTransition({
      activeTransitionId: activeTransitionIdRef.current,
      currentChapterId: chapterIdRef.current,
      transitionId,
      chapterId,
    })) return false;
    if (transitionId !== null) activeTransitionIdRef.current = null;
    if (transitionUnlockTimerRef.current !== null) {
      window.clearTimeout(transitionUnlockTimerRef.current);
      transitionUnlockTimerRef.current = null;
    }
    switchingRef.current = false;
    setTransitioning(false);
    return true;
  }, []);

  const seekPage = useCallback((page: number) => {
    releaseLandingAnchor();
    clearProgrammaticPageTarget();
    const total = imagesCountRef.current;
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(total - 1, page));
    setReaderPage(clamped);
    scrollToPage(clamped, 'instant');
  }, [clearProgrammaticPageTarget, releaseLandingAnchor, scrollToPage, setReaderPage]);

  const showBoundaryToast = useCallback((dir: ChapterDirection) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setBoundaryToast(dir);
    toastTimerRef.current = window.setTimeout(() => {
      setBoundaryToast(null);
      toastTimerRef.current = null;
    }, 1500);
  }, []);

  const cancelBoundaryHint = useCallback(() => {
    boundaryAccumRef.current = 0;
    boundaryDirectionRef.current = null;
    if (boundaryTimerRef.current !== null) {
      window.clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    setHint(null);
  }, []);

  const resetReader = useCallback((newChapterId: string, page?: number | 'last') => {
    if (switchingRef.current || newChapterId === chapterIdRef.current) return false;

    const transitionId = ++transitionSequenceRef.current;
    activeTransitionIdRef.current = transitionId;
    switchingRef.current = true;
    if (transitionUnlockTimerRef.current !== null) window.clearTimeout(transitionUnlockTimerRef.current);
    transitionUnlockTimerRef.current = window.setTimeout(() => {
      if (activeTransitionIdRef.current === transitionId) switchingRef.current = false;
    }, CHAPTER_SWITCH_UNLOCK_DELAY_MS);

    const el = containerRef.current;
    if (el) {
      const pageEl = el.children[currentPageRef.current] as HTMLElement | undefined;
      const img = pageEl?.querySelector('img') as HTMLImageElement | null;
      if (img && img.src) {
        setSnapshot({ url: img.src, w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1 });
      }
    }

    setTransitioning(true);
    cancelBoundaryHint();
    releaseLandingAnchor();
    clearProgrammaticPageTarget();
    setBlobMap(new Map());
    loadGenerationRef.current += 1;
    pendingNavigationRef.current = {
      chapterId: newChapterId,
      requestedPage: page ?? null,
      resolvedPage: null,
      transitionId,
    };
    chapterIdRef.current = newChapterId;
    setCurrentChapterId(newChapterId);
    setReaderPage(typeof page === 'number' ? page : 0);
    loadedSetRef.current = new Set();
    inflightRef.current = new Set();

    const chaptersToCarry = sortedChaptersRef.current;
    navigate(`/reader/${newChapterId}`, {
      replace: true,
      state: { isSeries: chaptersToCarry.length > 1 || isSeries, seriesItems: chaptersToCarry, album },
    });
    return true;
  }, [album, cancelBoundaryHint, clearProgrammaticPageTarget, isSeries, navigate, releaseLandingAnchor, setReaderPage]);

  const switchAdjacentChapter = useCallback((dir: ChapterDirection) => {
    const offset = dir === 'next' ? 1 : -1;
    const target = sortedChaptersRef.current[chapterIndexRef.current + offset];
    if (!target) return false;
    return resetReader(target.id, getChapterLandingPage(dir));
  }, [resetReader]);

  const handleImageLoad = useCallback((chapterId: string, pageIndex: number) => {
    if (chapterIdRef.current !== chapterId) return;

    const anchor = landingAnchorRef.current;
    if (anchor?.chapterId === chapterId) {
      window.requestAnimationFrame(() => {
        if (landingAnchorRef.current === anchor) scrollToPage(anchor.page, 'instant');
      });
    }

    const pending = pendingNavigationRef.current;
    if (pending?.chapterId === chapterId && pending.resolvedPage === pageIndex) {
      scrollToPage(pageIndex, 'instant');
      pendingNavigationRef.current = null;
      completeChapterTransition(pending.transitionId, chapterId);
    }
  }, [completeChapterTransition, scrollToPage]);

  const scrollByInputStep = useCallback((step: number) => {
    const el = containerRef.current;
    if (!el || switchingRef.current || pendingNavigationRef.current !== null) return;
    releaseLandingAnchor();

    if (isRTLRef.current && programmaticPageTargetRef.current !== null) {
      const nextPage = currentPageRef.current + step;
      if (nextPage < 0 || nextPage >= imagesCountRef.current) {
        clearProgrammaticPageTarget();
        const direction = step > 0 ? 'next' : 'prev';
        if (!switchAdjacentChapter(direction)) showBoundaryToast(direction);
        return;
      }
      setProgrammaticPageTarget(nextPage);
      setReaderPage(nextPage);
      scrollToPage(nextPage, 'smooth');
      return;
    }

    const metrics = getScrollMetrics();
    const boundary = metrics ? getBoundaryDirection({ ...metrics, step }) : null;
    if (boundary) {
      clearProgrammaticPageTarget();
      if (!switchAdjacentChapter(boundary)) showBoundaryToast(boundary);
      return;
    }
    if (boundaryDirectionRef.current !== null) cancelBoundaryHint();

    if (isRTLRef.current) {
      const target = Math.max(0, Math.min(imagesCountRef.current - 1, currentPageRef.current + step));
      if (target !== currentPageRef.current) {
        setProgrammaticPageTarget(target);
        setReaderPage(target);
        scrollToPage(target, 'smooth');
      }
      return;
    }

    const distance = Math.max(el.clientHeight * 0.9, 1) * step;
    el.scrollBy({ top: distance, behavior: 'smooth' });
  }, [cancelBoundaryHint, clearProgrammaticPageTarget, getScrollMetrics, releaseLandingAnchor, scrollToPage, setProgrammaticPageTarget, setReaderPage, showBoundaryToast, switchAdjacentChapter]);

  const goNextPage = useCallback(() => scrollByInputStep(1), [scrollByInputStep]);
  const goPrevPage = useCallback(() => scrollByInputStep(-1), [scrollByInputStep]);
  const goNextChapter = useCallback(() => { switchAdjacentChapter('next'); }, [switchAdjacentChapter]);
  const goPrevChapter = useCallback(() => { switchAdjacentChapter('prev'); }, [switchAdjacentChapter]);

  const goToChapter = useCallback((chapterId: string) => {
    resetReader(chapterId);
  }, [resetReader]);

  const triggerChapterSwitch = useCallback((dir: ChapterDirection) => {
    switchAdjacentChapter(dir);
  }, [switchAdjacentChapter]);

  const onBoundaryDismiss = useCallback(() => {
    cancelBoundaryHint();
    if (toastTimerRef.current !== null) { window.clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
    setBoundaryToast(null);
  }, [cancelBoundaryHint]);

  useEffect(() => () => {
    loadGenerationRef.current += 1;
    pendingNavigationRef.current = null;
    activeTransitionIdRef.current = null;
    switchingRef.current = false;
    if (transitionUnlockTimerRef.current !== null) window.clearTimeout(transitionUnlockTimerRef.current);
    if (boundaryTimerRef.current !== null) window.clearTimeout(boundaryTimerRef.current);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    if (trackpadGestureTimerRef.current !== null) window.clearTimeout(trackpadGestureTimerRef.current);
    if (wheelPagingTimerRef.current !== null) window.clearTimeout(wheelPagingTimerRef.current);
    trackpadGestureLockRef.current = false;
    trackpadDeltaAccumRef.current = 0;
    wheelPagingLockRef.current = false;
    clearProgrammaticPageTarget();
    releaseLandingAnchor();
  }, [clearProgrammaticPageTarget, releaseLandingAnchor]);

  const toggleDirection = useCallback(() => {
    releaseLandingAnchor();
    clearProgrammaticPageTarget();
    cancelBoundaryHint();
    setDirection((prev) => {
      const next: ReadingDirection = prev === 'left-right' ? 'top-down' : 'left-right';
      saveReadingDirection(next);
      return next;
    });
  }, [cancelBoundaryHint, clearProgrammaticPageTarget, releaseLandingAnchor]);

  const toggleAutoSnap = useCallback(() => {
    setAutoSnap((prev) => {
      saveAutoSnap(!prev);
      return !prev;
    });
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
    const generation = loadGenerationRef.current;
    const chapterId = p.id;

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
        try {
          const img = imgs[idx];
          const data = await decryptImageWithRetry(img.url, p.id, p.scrambleId);
          if (!data) return;

          const blobUrl = URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
          if (!isCurrentChapterLoad({
            generation,
            currentGeneration: loadGenerationRef.current,
            chapterId,
            currentChapterId: chapterIdRef.current,
          })) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          setBlobMap((prev) => {
            if (!isCurrentChapterLoad({
              generation,
              currentGeneration: loadGenerationRef.current,
              chapterId,
              currentChapterId: chapterIdRef.current,
            })) {
              URL.revokeObjectURL(blobUrl);
              return prev;
            }
            if (prev.has(idx)) {
              URL.revokeObjectURL(blobUrl);
              return prev;
            }
            const next = new Map(prev);
            next.set(idx, blobUrl);
            return next;
          });
          loadedSetRef.current.add(idx);
        } finally {
          if (generation === loadGenerationRef.current) inflightRef.current.delete(idx);
        }
      });
    }
  }, []);

  // ── photo-ready: resolve the chapter-scoped target, then scroll and unlock ──
  useEffect(() => {
    if (!photo || photo.id !== currentChapterId || images.length === 0) return;

    let pending = pendingNavigationRef.current;
    if (pending && pending.chapterId !== currentChapterId) return;
    if (!pending) {
      pending = {
        chapterId: currentChapterId,
        requestedPage: null,
        resolvedPage: null,
        transitionId: null,
      };
      pendingNavigationRef.current = pending;
    }

    let targetPage: number;
    if (pending.requestedPage !== null) {
      targetPage = pending.requestedPage === 'last'
        ? images.length - 1
        : Math.max(0, Math.min(images.length - 1, pending.requestedPage));
    } else {
      const root = seriesRootRef.current || albumIdRef.current!;
      const stored = getReadingProgress(root, currentChapterId);
      const latest = getLatestChapterProgress(root, sortedChapters.map((c) => c.id));
      targetPage = latest?.chapterId === currentChapterId
        ? latest.page
        : (stored?.page ?? 0);
      targetPage = Math.max(0, Math.min(images.length - 1, targetPage));
    }

    pending.resolvedPage = targetPage;
    setReaderPage(targetPage);
    setLandingAnchor(currentChapterId, targetPage);
    preloadRange(targetPage);

    const el = containerRef.current;
    if (!el) {
      pendingNavigationRef.current = null;
      completeChapterTransition(pending.transitionId, currentChapterId);
      return;
    }

    const finish = () => {
      if (pendingNavigationRef.current !== pending || chapterIdRef.current !== currentChapterId) return;
      scrollToPage(targetPage, 'instant');
      pendingNavigationRef.current = null;
      completeChapterTransition(pending.transitionId, currentChapterId);
    };

    const pageEl = el.children[targetPage] as HTMLElement | undefined;
    const img = pageEl?.querySelector('img') as HTMLImageElement | null;

    if (img && img.complete && img.naturalHeight > 0) {
      finish();
      return;
    }

    if (img) {
      let done = false;
      img.decode().then(() => {
        if (!done) finish();
      }).catch(() => {});
      const tid = window.setTimeout(() => {
        done = true;
        finish();
      }, CHAPTER_SWITCH_UNLOCK_DELAY_MS);
      return () => window.clearTimeout(tid);
    }

    const tid = window.setTimeout(finish, CHAPTER_SWITCH_UNLOCK_DELAY_MS);
    return () => window.clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, currentChapterId, images.length]);

  useEffect(() => {
    if (images.length === 0) return;
    preloadRange(currentPage);
  }, [currentPage, preloadRange, images.length]);

  // ─── one-shot: restore last-read chapter within the series ─────────────────
  const initialChapterRestoreDoneRef = useRef(false);
  useEffect(() => {
    if (initialChapterRestoreDoneRef.current) return;
    // Wait for the real (multi-chapter) list; a single placeholder appears before the album loads.
    if (sortedChapters.length <= 1) return;
    const root = seriesRootRef.current || albumIdRef.current;
    if (!root) return;
    initialChapterRestoreDoneRef.current = true;
    const latest = getLatestChapterProgress(root, sortedChapters.map((c) => c.id));
    if (latest && latest.chapterId !== chapterIdRef.current && sortedChapters.some((c) => c.id === latest.chapterId)) {
      resetReader(latest.chapterId, latest.page);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedChapters]);

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
        if (pendingNavigationRef.current !== null) return;
        const programmaticTarget = programmaticPageTargetRef.current;
        if (programmaticTarget !== null) {
          const target = children[programmaticTarget] as HTMLElement | undefined;
          if (target && !isScrollTargetReached({
            position: el.scrollLeft,
            targetPosition: target.offsetLeft,
          })) return;
          clearProgrammaticPageTarget();
        }
        const center = el.scrollLeft + el.clientWidth / 2;
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          const mid = child.offsetLeft + child.offsetWidth / 2;
          const dist = Math.abs(center - mid);
          if (dist < bestDist) { bestDist = dist; best = i; }
        }
        if (best !== currentPageRef.current) setReaderPage(best);
        if (shouldSettleHorizontal) {
          clearHorizontalSnapTimer();
          horizontalSnapTimerRef.current = window.setTimeout(settleHorizontalPage, 120);
        }
      } else {
        if (pendingNavigationRef.current !== null) return;
        const center = el.scrollTop + el.clientHeight / 2;
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          const mid = child.offsetTop + child.offsetHeight / 2;
          const dist = Math.abs(center - mid);
          if (dist < bestDist) { bestDist = dist; best = i; }
        }
        if (best !== currentPageRef.current) setReaderPage(best);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      clearHorizontalSnapTimer();
      el.removeEventListener('scroll', onScroll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, direction, albumId, currentChapterId, currentChapterIndex, images.length, autoSnap, seamlessMode]);

  useEffect(() => {
    if (!currentChapterId || images.length === 0) return;
    const root = seriesRootRef.current || albumIdRef.current!;
    saveReadingProgress({
      albumId: root,
      chapterId: currentChapterId,
      chapterIndex: Math.max(currentChapterIndex, 0),
      page: currentPage,
      totalPages: images.length,
      updatedAt: Date.now(),
    });
  }, [currentChapterId, currentChapterIndex, currentPage, images.length]);

  // ─── wheel / touchpad scrolling ────────────────────────────────────────────

  useEffect(() => {
    if (!photo) return;
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
      const dominantDelta = getDominantWheelDelta(e.deltaX, e.deltaY);
      const inputDelta = isRTLRef.current ? dominantDelta : e.deltaY;
      if (Math.abs(inputDelta) < 4) return;
      const isTrackpad = isLikelyTrackpadWheel(e.deltaMode, e.deltaX, e.deltaY);

      if (isTrackpad) {
        if (trackpadGestureTimerRef.current !== null) window.clearTimeout(trackpadGestureTimerRef.current);
        trackpadGestureTimerRef.current = window.setTimeout(resetTrackpadGesture, TRACKPAD_GESTURE_END_DELAY_MS);
      }

      if (switchingRef.current || pendingNavigationRef.current !== null) {
        e.preventDefault();
        return;
      }
      if ((isTrackpad && trackpadGestureLockRef.current) || (!isTrackpad && wheelPagingLockRef.current)) {
        e.preventDefault();
        return;
      }

      const step = inputDelta > 0 ? 1 : -1;
      const metrics = getScrollMetrics();
      const boundary = metrics ? getBoundaryDirection({ ...metrics, step }) : null;
      if (boundary) {
        e.preventDefault();
        releaseLandingAnchor();
        const dir = boundary;
        const hasChapter = dir === 'next' ? hasNextChapterRef.current : hasPrevChapterRef.current;
        if (!hasChapter) {
          cancelBoundaryHint();
          showBoundaryToast(dir);
          return;
        }

        if (boundaryTimerRef.current !== null) window.clearTimeout(boundaryTimerRef.current);
        const accumulated = accumulateBoundaryGesture({
          currentDirection: boundaryDirectionRef.current,
          currentAmount: boundaryAccumRef.current,
          direction: dir,
          contribution: isTrackpad ? inputDelta : MOUSE_WHEEL_BOUNDARY_CONTRIBUTION,
        });
        boundaryDirectionRef.current = accumulated.direction;
        boundaryAccumRef.current = accumulated.amount;
        setHint({
          dir,
          progress: accumulated.progress,
          chapterName: dir === 'next' ? nextChapterNameRef.current : prevChapterNameRef.current,
        });
        if (accumulated.shouldSwitch) {
          if (isTrackpad) {
            trackpadGestureLockRef.current = true;
          } else {
            wheelPagingLockRef.current = true;
            if (wheelPagingTimerRef.current !== null) window.clearTimeout(wheelPagingTimerRef.current);
            wheelPagingTimerRef.current = window.setTimeout(() => {
              wheelPagingLockRef.current = false;
              wheelPagingTimerRef.current = null;
            }, 260);
          }
          cancelBoundaryHint();
          triggerChapterSwitch(dir);
          return;
        }
        boundaryTimerRef.current = window.setTimeout(cancelBoundaryHint, BOUNDARY_RESET_DELAY_MS);
        return;
      }

      if (boundaryDirectionRef.current !== null) cancelBoundaryHint();
      releaseLandingAnchor();

      // Vertical reading keeps native scrolling until it reaches a real boundary.
      if (!isRTLRef.current) return;

      e.preventDefault();

      if (isTrackpad) {
        trackpadDeltaAccumRef.current += inputDelta;
        if (Math.abs(trackpadDeltaAccumRef.current) < 60) return;

        trackpadGestureLockRef.current = true;
        scrollByInputStep(trackpadDeltaAccumRef.current > 0 ? 1 : -1);
        return;
      }

      if (wheelPagingLockRef.current) return;
      wheelPagingLockRef.current = true;

      scrollByInputStep(inputDelta > 0 ? 1 : -1);

      if (wheelPagingTimerRef.current !== null) window.clearTimeout(wheelPagingTimerRef.current);
      wheelPagingTimerRef.current = window.setTimeout(() => {
        wheelPagingLockRef.current = false;
        wheelPagingTimerRef.current = null;
      }, 260);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [isRTL, photo, getScrollMetrics, releaseLandingAnchor, scrollByInputStep, showBoundaryToast, cancelBoundaryHint, triggerChapterSwitch]);

  // ── touch boundary-pull detection (both directions use native scroll) ──

  useEffect(() => {
    if (!photo) return;
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      clearProgrammaticPageTarget();
      if (switchingRef.current || pendingNavigationRef.current !== null) return;
      const t = e.touches[0];
      const metrics = getScrollMetrics();
      if (!metrics) return;
      const atPrev = getBoundaryDirection({ ...metrics, step: -1 }) === 'prev';
      const atNext = getBoundaryDirection({ ...metrics, step: 1 }) === 'next';
      if (!atPrev && !atNext) return;
      releaseLandingAnchor();
      touchTrackingRef.current = {
        boundaryDir: atPrev ? 'prev' : 'next',
        startX: t.clientX,
        startY: t.clientY,
        startScroll: metrics.position,
        distance: 0,
      };
      boundaryAccumRef.current = 0;
      boundaryDirectionRef.current = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      const tr = touchTrackingRef.current;
      if (!tr) return;
      // still pinned at the boundary? if the page can scroll further (not truly at edge), abort.
      const metrics = getScrollMetrics();
      const stillAtBoundary = metrics
        ? getBoundaryDirection({ ...metrics, step: tr.boundaryDir === 'next' ? 1 : -1 }) === tr.boundaryDir
        : false;
      if (!stillAtBoundary) { touchTrackingRef.current = null; cancelBoundaryHint(); return; }

      const t = e.touches[0];
      let raw: number;
      if (isRTLRef.current) {
        raw = tr.boundaryDir === 'prev' ? t.clientX - tr.startX : tr.startX - t.clientX;
      } else {
        raw = tr.boundaryDir === 'prev' ? t.clientY - tr.startY : tr.startY - t.clientY;
      }
      const distance = Math.max(0, raw);
      tr.distance = distance;
      const progress = Math.min(1, distance / 60);
      const hasChapter = tr.boundaryDir === 'next' ? hasNextChapterRef.current : hasPrevChapterRef.current;
      if (!hasChapter) {
        // no chapter: don't show progress hint, just a toast (already shown on threshold pass)
        if (progress >= 0.6) showBoundaryToast(tr.boundaryDir);
        return;
      }
      setHint({ dir: tr.boundaryDir, progress, chapterName: tr.boundaryDir === 'next' ? nextChapterNameRef.current : prevChapterNameRef.current });
    };

    const onTouchEnd = () => {
      const tr = touchTrackingRef.current;
      touchTrackingRef.current = null;
      if (!tr) return;
      const progress = Math.min(1, tr.distance / 60);
      if (progress >= 1) {
        const hasChapter = tr.boundaryDir === 'next' ? hasNextChapterRef.current : hasPrevChapterRef.current;
        if (hasChapter) {
          cancelBoundaryHint();
          triggerChapterSwitch(tr.boundaryDir);
        } else {
          showBoundaryToast(tr.boundaryDir);
          cancelBoundaryHint();
        }
      } else {
        cancelBoundaryHint();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [photo, clearProgrammaticPageTarget, getScrollMetrics, releaseLandingAnchor, showBoundaryToast, cancelBoundaryHint, triggerChapterSwitch]);

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

  // First mount with no photo yet and nothing to show → full-screen loading.
  // During a chapter switch we keep the previous page visible via the snapshot overlay instead.
  if (!photo && !snapshot) {
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
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
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
    ? 'w-full h-auto max-h-full object-contain'
    : 'h-auto w-full object-contain';

  const lazyRenderStart = Math.max(0, currentPage - lazyRenderRange);
  const lazyRenderEnd = Math.min(images.length - 1, currentPage + lazyRenderRange);

  return (
    <div className="fixed inset-0 bg-black select-none overflow-hidden">
      <style>{`::-webkit-scrollbar { display: none; }`}</style>
      <div ref={containerRef} className="h-full w-full" style={scrollDivStyle}>
        {images.map((img, i) => {
          const url = blobMap.get(i);
          const shouldRenderImage = i >= lazyRenderStart && i <= lazyRenderEnd;
          return (
            <div key={img.name} className="shrink-0" style={pageStyle}>
              {url ? (
                <img src={url} alt="" draggable={false} className={imgCls} onLoad={() => handleImageLoad(photo.id, i)} />
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
                    if (chapterIdRef.current !== photo.id) return;
                    loadedSetRef.current.add(i);
                    inflightRef.current.delete(i);
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

      {/* chapter-switch transition overlay — keeps the last page visible until the new chapter is ready */}
      {snapshot && (
        <div
          className={`absolute inset-0 z-30 bg-black flex items-center justify-center transition-opacity duration-700 ${transitioning ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <img
            src={snapshot.url}
            alt=""
            className="max-w-full max-h-full object-contain"
            style={{ width: snapshot.w ? 'auto' : undefined, maxHeight: '100%' }}
            draggable={false}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <div className="w-9 h-9 border-2 border-brand-500/70 border-t-white rounded-full animate-spin" />
            </div>
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
        chapterProgress={chapterProgress}
        direction={direction}
        hasPrevChapter={currentChapterIndex > 0}
        hasNextChapter={currentChapterIndex < sortedChapters.length - 1}
        hint={hint}
        boundaryToast={boundaryToast}
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
        onToggleBarVisible={() => setBarVisible(v => !v)}
        onScrollByInputStep={scrollByInputStep}
        onSeekPage={seekPage}
        onBoundaryDismiss={onBoundaryDismiss}
      />
    </div>
  );
}
