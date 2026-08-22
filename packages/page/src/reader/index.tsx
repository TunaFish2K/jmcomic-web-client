import { useCallback, useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ReaderOverlay } from './ReaderOverlay';
import {
  getReaderAnchorRatio,
  getReaderAnchorScrollPosition,
  getReaderInteractionPolicy,
} from './layout';
import { TranslationSettingsDialog } from '../translation/TranslationSettingsDialog';
import { useReaderTranslation, type TranslationTask } from '../translation/useReaderTranslation';
import { X } from 'lucide-react';
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
} from './reader-store';
import pLimit from 'p-limit';
import { getProcessedPhotoImage } from '@tiny-client/shared';
import {
  accumulateBoundaryGesture,
  BOUNDARY_SWITCH_THRESHOLD,
  classifyBoundaryPull,
  getBoundaryDirection,
  getChapterLandingPage,
  getDominantWheelDelta,
  isLikelyTrackpadWheel,
  isMatchingChapterTransition,
  isScrollTargetReached,
  MOUSE_WHEEL_BOUNDARY_CONTRIBUTION,
  type ChapterDirection,
} from './navigation';
import {
  evictResidentPageUrls,
  estimateResidentImageBytes,
  selectResidentPages,
} from './residency';
import {
  getPannedZoomTransform,
  getPinchZoomTransform,
  getPointDistance,
  getPointMidpoint,
  getTargetZoomTransform,
  getUnionRect,
  getVisibleRectIndexes,
  IDENTITY_ZOOM_TRANSFORM,
  ZOOM_RESET_EPSILON,
  type ZoomPoint,
  type ZoomTransform,
} from './zoom';
import { PageOffsetCache, computeVisiblePageIndexes, findCenterPage, findPageAtCenter } from './page-geometry';
import {
  BOUNDARY_RESET_DELAY_MS,
  CHAPTER_SWITCH_UNLOCK_DELAY_MS,
  IMAGE_LOAD_PARALLEL,
  LANDING_ANCHOR_DELAY_MS,
  PROGRAMMATIC_PAGE_TARGET_TIMEOUT_MS,
  restoreZoomElementStyle,
  saveZoomElementStyle,
  toZoomRect,
  TRACKPAD_GESTURE_END_DELAY_MS,
  type ActiveImageZoom,
  type BoundaryTouchTracking,
  type LandingAnchor,
  type PanGesture,
  type PendingNavigation,
  type PinchGesture,
  type ReaderLayoutAnchor,
} from './reader-types';
import { useReaderData } from './useReaderData';
import { ReaderLoadingView } from './ReaderLoadingView';
import { ReaderPageCanvas } from './ReaderPageCanvas';
import { ChapterTransitionOverlay } from './ChapterTransitionOverlay';

function formatModelBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

function getTranslationTaskLabel(task: TranslationTask) {
  if (task.stage === 'recognizing') return '正在识别本页文字';
  if (task.stage === 'translating') return '正在翻译本页';
  switch (task.ocrInitialization?.phase) {
    case 'checking-cache':
      return '正在检查 OCR 模型';
    case 'downloading': {
      const { loadedBytes, totalBytes } = task.ocrInitialization;
      if (!totalBytes) return '首次使用，正在下载 OCR 模型';
      const percent = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
      return `首次使用，正在下载 OCR 模型 ${percent}%`;
    }
    case 'initializing':
      return '正在初始化 OCR';
    case 'ready':
      return '正在准备本页 OCR';
    default:
      return '正在加载本页 OCR';
  }
}

export default function ReaderPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const [currentChapterId, setCurrentChapterId] = useState(albumId!);
  const mountAlbumIdRef = useRef<string | undefined>(albumId);

  const {
    album,
    isSeries,
    sortedChapters,
    currentChapterIndex,
    photo,
    images,
  } = useReaderData({
    albumId,
    locationState: location.state,
    currentChapterId,
    mountAlbumId: mountAlbumIdRef.current,
  });

  const [direction, setDirection] = useState<ReadingDirection>(getReadingDirection);
  const [autoSnap, setAutoSnap] = useState(getAutoSnap);
  const [seamlessMode, setSeamlessMode] = useState(getSeamlessMode);
  const [lazyRenderRange, setLazyRenderRange] = useState(getLazyRenderRange);
  const [barSide] = useState(getBarSide);
  const [barVisible, setBarVisible] = useState(true);
  const [showUI, setShowUI] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [blobMap, setBlobMap] = useState<Map<number, string>>(new Map());
  const [pageAspectRatios, setPageAspectRatios] = useState<Map<number, number>>(new Map());
  const [isZoomed, setIsZoomed] = useState(false);
  const [residencyRevision, setResidencyRevision] = useState(0);
  const [failedPages, setFailedPages] = useState<Set<number>>(new Set());

  // ── boundary chapter-swap hint (pull past first/last page) ──
  const [hint, setHint] = useState<{ dir: 'prev' | 'next'; progress: number; chapterName: string } | null>(null);
  const [boundaryToast, setBoundaryToast] = useState<'prev' | 'next' | null>(null);
  const boundaryAccumRef = useRef(0);
  const boundaryDirectionRef = useRef<ChapterDirection | null>(null);
  const boundaryTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const touchTrackingRef = useRef<BoundaryTouchTracking | null>(null);

  // ── chapter-transition snapshot (keeps last page visible while switching) ──
  const [snapshot, setSnapshot] = useState<{ url: string; w: number; h: number } | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const isRTL = direction === 'left-right';

  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const landingAnchorRef = useRef<LandingAnchor | null>(null);
  const landingAnchorTimerRef = useRef<number | null>(null);
  const transitionSequenceRef = useRef(0);
  const activeTransitionIdRef = useRef<number | null>(null);
  const transitionUnlockTimerRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const switchingRef = useRef(false);
  const readerRootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageOffsetCacheRef = useRef(new PageOffsetCache());
  const blobMapRef = useRef(blobMap);
  const pageCostsRef = useRef(new Map<number, number>());
  const desiredPagesRef = useRef(new Set<number>());
  const visiblePagesRef = useRef(new Set<number>([0]));
  const inflightRef = useRef(new Map<number, AbortController>());
  const imageLoadLimitRef = useRef<ReturnType<typeof pLimit> | null>(null);
  if (!imageLoadLimitRef.current) imageLoadLimitRef.current = pLimit(IMAGE_LOAD_PARALLEL);
  const wheelPagingLockRef = useRef(false);
  const wheelPagingTimerRef = useRef<number | null>(null);
  const programmaticPageTargetRef = useRef<number | null>(null);
  const programmaticPageTargetTimerRef = useRef<number | null>(null);
  const trackpadGestureLockRef = useRef(false);
  const trackpadDeltaAccumRef = useRef(0);
  const trackpadGestureTimerRef = useRef<number | null>(null);
  const horizontalSnapTimerRef = useRef<number | null>(null);
  const zoomRef = useRef<ActiveImageZoom | null>(null);
  const zoomedRef = useRef(false);
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const pendingZoomTransformRef = useRef<ZoomTransform | null>(null);
  const pendingLayoutAnchorRef = useRef<ReaderLayoutAnchor | null>(null);
  const pendingAspectRatiosRef = useRef(new Map<number, number>());
  const pageAspectRatiosRef = useRef(pageAspectRatios);
  const zoomGestureMovedRef = useRef(false);
  const lastZoomTapRef = useRef<{ time: number; point: ZoomPoint } | null>(null);
  const suppressReaderClickUntilRef = useRef(0);
  const snapshotUrlRef = useRef<string | null>(null);
  const deferredSnapshotUrlsRef = useRef(new Set<string>());

  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  blobMapRef.current = blobMap;
  pageAspectRatiosRef.current = pageAspectRatios;
  const isRTLRef = useRef(isRTL);
  isRTLRef.current = isRTL;
  const autoSnapRef = useRef(autoSnap);
  autoSnapRef.current = autoSnap;
  const seamlessModeRef = useRef(seamlessMode);
  seamlessModeRef.current = seamlessMode;
  const albumIdRef = useRef(albumId);
  albumIdRef.current = albumId;
  const seriesRootRef = useRef<string>(albumId ?? '');
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

  imagesCountRef.current = images.length;

  const commitBlobMap = useCallback((next: Map<number, string>) => {
    blobMapRef.current = next;
    setBlobMap(next);
  }, []);

  const revokeBlobUrl = useCallback((url: string) => {
    if (snapshotUrlRef.current === url) {
      deferredSnapshotUrlsRef.current.add(url);
      return;
    }
    URL.revokeObjectURL(url);
  }, []);

  const clearResidentImages = useCallback(() => {
    for (const url of blobMapRef.current.values()) revokeBlobUrl(url);
    commitBlobMap(new Map());
    pageCostsRef.current.clear();
    desiredPagesRef.current.clear();
    for (const controller of inflightRef.current.values()) controller.abort();
    inflightRef.current.clear();
  }, [commitBlobMap, revokeBlobUrl]);

  const translationPages = useMemo(
    () => images.map((image, index) => ({
      imageName: image.name,
      imageUrl: blobMap.get(index),
      loadImageBlob: photo
        ? async (signal: AbortSignal) => {
            const processed = await getProcessedPhotoImage(photo, image, signal);
            return new Blob([processed.data], { type: 'image/jpeg' });
          }
        : undefined,
    })),
    [blobMap, images, photo],
  );
  const translation = useReaderTranslation({
    chapterId: photo?.id,
    pages: translationPages,
    currentPage,
  });

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
      return {
        position: el.scrollLeft,
        maxPosition: Math.max(el.scrollWidth - el.clientWidth, 0),
      };
    }
    return {
      position: el.scrollTop,
      maxPosition: Math.max(el.scrollHeight - el.clientHeight, 0),
    };
  }, []);

  const captureLayoutAnchor = useCallback((snapToStart = autoSnapRef.current): ReaderLayoutAnchor | null => {
    const el = containerRef.current;
    if (!el || imagesCountRef.current === 0) return null;
    const pages = Array.from(el.children).slice(0, imagesCountRef.current) as HTMLElement[];
    if (pages.length === 0) return null;

    if (snapToStart) {
      return {
        pageIndex: Math.max(0, Math.min(pages.length - 1, currentPageRef.current)),
        offsetRatio: 0,
        snapToStart: true,
      };
    }

    const center = isRTLRef.current
      ? el.scrollLeft + el.clientWidth / 2
      : el.scrollTop + el.clientHeight / 2;
    const horizontal = isRTLRef.current;
    const cache = pageOffsetCacheRef.current;
    const pageIndex = findPageAtCenter(pages.length, center, (index) => cache.get(index, pages[index], horizontal)) ?? 0;

    const page = pages[pageIndex];
    const start = horizontal ? page.offsetLeft : page.offsetTop;
    const size = Math.max(horizontal ? page.offsetWidth : page.offsetHeight, 1);
    return {
      pageIndex,
      offsetRatio: getReaderAnchorRatio(center, start, size),
      snapToStart: false,
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

  useEffect(() => {
    if (!snapshot || transitioning) return;
    const snapshotUrl = snapshot.url;
    const timer = window.setTimeout(() => {
      setSnapshot((current) => current?.url === snapshotUrl ? null : current);
      if (snapshotUrlRef.current === snapshotUrl) snapshotUrlRef.current = null;
      if (deferredSnapshotUrlsRef.current.delete(snapshotUrl)) URL.revokeObjectURL(snapshotUrl);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [snapshot, transitioning]);

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

  const applyZoomTransform = useCallback((transform: ZoomTransform) => {
    const active = zoomRef.current;
    if (!active) return;

    active.transform = transform;
    pendingZoomTransformRef.current = transform;
    if (!zoomedRef.current && transform.scale > 1 + ZOOM_RESET_EPSILON) {
      zoomedRef.current = true;
      setIsZoomed(true);
    }

    if (zoomFrameRef.current !== null) return;
    zoomFrameRef.current = window.requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      const current = zoomRef.current;
      const pending = pendingZoomTransformRef.current;
      pendingZoomTransformRef.current = null;
      if (!current || !pending || current.targets.some((target) => !target.element.isConnected)) return;
      for (const target of current.targets) {
        const local = getTargetZoomTransform(pending, current.contentRect, target.rect);
        target.element.style.transform = `translate3d(${local.x}px, ${local.y}px, 0) scale(${local.scale})`;
      }
    });
  }, []);

  const resetZoom = useCallback(() => {
    if (zoomFrameRef.current !== null) {
      window.cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
    }
    pendingZoomTransformRef.current = null;
    pinchGestureRef.current = null;
    panGestureRef.current = null;
    lastZoomTapRef.current = null;

    const active = zoomRef.current;
    zoomRef.current = null;
    if (active) {
      if (pendingAspectRatiosRef.current.size > 0 && seamlessModeRef.current) {
        pendingLayoutAnchorRef.current = captureLayoutAnchor(autoSnapRef.current);
      }
      for (const target of active.targets) restoreZoomElementStyle(target.element, target.style);
      for (const layer of active.layers) {
        layer.element.style.position = layer.position;
        layer.element.style.zIndex = layer.zIndex;
      }

      const container = containerRef.current;
      if (container) {
        container.scrollTo({ left: active.scrollLeft, top: active.scrollTop, behavior: 'instant' });
      }
    }

    if (pendingAspectRatiosRef.current.size > 0) {
      const next = new Map(pageAspectRatiosRef.current);
      for (const [pageIndex, ratio] of pendingAspectRatiosRef.current) next.set(pageIndex, ratio);
      pendingAspectRatiosRef.current.clear();
      pageAspectRatiosRef.current = next;
      setPageAspectRatios(next);
    }

    if (zoomedRef.current) {
      zoomedRef.current = false;
      setIsZoomed(false);
    }
    if (active) setResidencyRevision((value) => value + 1);
  }, [captureLayoutAnchor]);

  const getOrCreateActiveZoom = useCallback((midpoint: ZoomPoint) => {
    if (zoomRef.current) return zoomRef.current;
    const container = containerRef.current;
    if (!container) return null;

    const pages = Array.from(container.children).slice(0, imagesCountRef.current) as HTMLElement[];
    const viewportRect = toZoomRect(container.getBoundingClientRect());
    if (getReaderInteractionPolicy({
      autoSnap: autoSnapRef.current,
      seamlessMode: seamlessModeRef.current,
      isZoomed: false,
    }).zoomTarget === 'visible-pages') {
      const pageRects = pages.map((page) => toZoomRect(page.getBoundingClientRect()));
      const pageIndexes = getVisibleRectIndexes(pageRects, viewportRect)
        .filter((pageIndex) => pageRects[pageIndex].width > 0 && pageRects[pageIndex].height > 0);
      const targetRects = pageIndexes.map((pageIndex) => pageRects[pageIndex]);
      const contentRect = getUnionRect(targetRects);
      if (contentRect && pageIndexes.length > 0) {
        const targets = pageIndexes.map((pageIndex) => {
          const element = pages[pageIndex];
          const rect = pageRects[pageIndex];
          const target = { element, rect, style: saveZoomElementStyle(element) };
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.minWidth = `${rect.width}px`;
          element.style.minHeight = `${rect.height}px`;
          element.style.maxWidth = `${rect.width}px`;
          element.style.maxHeight = `${rect.height}px`;
          element.style.flex = `0 0 ${isRTLRef.current ? rect.width : rect.height}px`;
          element.style.flexBasis = `${isRTLRef.current ? rect.width : rect.height}px`;
          element.style.aspectRatio = 'auto';
          element.style.transformOrigin = '0 0';
          element.style.willChange = 'transform';
          element.style.position = 'relative';
          element.style.zIndex = '2';
          return target;
        });
        const active: ActiveImageZoom = {
          targets,
          layers: [],
          contentRect,
          viewportRect,
          transform: IDENTITY_ZOOM_TRANSFORM,
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop,
          grouped: true,
          pageIndexes,
        };
        zoomRef.current = active;
        setResidencyRevision((value) => value + 1);
        return active;
      }
    }

    let selected: { image: HTMLImageElement; page: HTMLElement; pageIndex: number } | null = null;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const image = page.querySelector('img');
      if (!image) continue;
      const rect = image.getBoundingClientRect();
      if (midpoint.x >= rect.left && midpoint.x <= rect.right && midpoint.y >= rect.top && midpoint.y <= rect.bottom) {
        selected = { image, page, pageIndex };
        break;
      }
    }

    if (!selected) {
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const rect = page.getBoundingClientRect();
        if (midpoint.x < rect.left || midpoint.x > rect.right || midpoint.y < rect.top || midpoint.y > rect.bottom) continue;
        const image = page.querySelector('img');
        if (image) selected = { image, page, pageIndex };
        break;
      }
    }

    if (!selected) return null;
    const imageBounds = selected.image.getBoundingClientRect();
    if (imageBounds.width <= 0 || imageBounds.height <= 0) return null;
    const imageRect = toZoomRect(imageBounds);
    const target: ZoomTarget = {
      element: selected.image,
      rect: imageRect,
      style: saveZoomElementStyle(selected.image),
    };
    const active: ActiveImageZoom = {
      targets: [target],
      layers: [{
        element: selected.page,
        position: selected.page.style.position,
        zIndex: selected.page.style.zIndex,
      }],
      contentRect: imageRect,
      viewportRect,
      transform: IDENTITY_ZOOM_TRANSFORM,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      grouped: false,
      pageIndexes: [selected.pageIndex],
    };

    selected.image.style.transformOrigin = '0 0';
    selected.image.style.willChange = 'transform';
    selected.image.style.position = 'relative';
    selected.image.style.zIndex = '2';
    selected.page.style.position = 'relative';
    selected.page.style.zIndex = '2';
    zoomRef.current = active;
    setResidencyRevision((value) => value + 1);
    return active;
  }, []);

  const recordPageDimensions = useCallback((chapterId: string, pageIndex: number, width: number, height: number) => {
    if (chapterIdRef.current !== chapterId || width <= 0 || height <= 0) return;
    const ratio = width / height;
    const existing = pendingAspectRatiosRef.current.get(pageIndex) ?? pageAspectRatiosRef.current.get(pageIndex);
    if (existing !== undefined && Math.abs(existing - ratio) < 0.0001) return;

    if (zoomRef.current?.grouped) {
      pendingAspectRatiosRef.current.set(pageIndex, ratio);
      return;
    }

    if (seamlessModeRef.current) {
      pendingLayoutAnchorRef.current = captureLayoutAnchor(autoSnapRef.current);
    }
    const next = new Map(pageAspectRatiosRef.current);
    next.set(pageIndex, ratio);
    pageAspectRatiosRef.current = next;
    setPageAspectRatios(next);
  }, [captureLayoutAnchor]);

  useLayoutEffect(() => {
    const anchor = pendingLayoutAnchorRef.current;
    if (!anchor) return;
    pendingLayoutAnchorRef.current = null;
    const el = containerRef.current;
    const page = el?.children[anchor.pageIndex] as HTMLElement | undefined;
    if (!el || !page) return;

    setReaderPage(anchor.pageIndex);
    if (anchor.snapToStart) {
      scrollToPage(anchor.pageIndex, 'instant');
      return;
    }

    if (isRTLRef.current) {
      const left = getReaderAnchorScrollPosition({
        pageStart: page.offsetLeft,
        pageSize: page.offsetWidth,
        offsetRatio: anchor.offsetRatio,
        viewportSize: el.clientWidth,
        maxScroll: el.scrollWidth - el.clientWidth,
      });
      el.scrollTo({ left, behavior: 'instant' });
    } else {
      const top = getReaderAnchorScrollPosition({
        pageStart: page.offsetTop,
        pageSize: page.offsetHeight,
        offsetRatio: anchor.offsetRatio,
        viewportSize: el.clientHeight,
        maxScroll: el.scrollHeight - el.clientHeight,
      });
      el.scrollTo({ top, behavior: 'instant' });
    }
  }, [pageAspectRatios, seamlessMode, scrollToPage, setReaderPage]);

  useEffect(() => {
    if (!photo) return;
    const touchTarget = readerRootRef.current;
    if (!touchTarget) return;

    const pointFromTouch = (touch: Touch): ZoomPoint => ({ x: touch.clientX, y: touch.clientY });
    const isZoomControlTarget = (target: EventTarget | null) => (
      target instanceof Element
      && !!target.closest('button, input, select, textarea, a, [role="button"], [role="dialog"]')
    );
    const startPinch = (touches: TouchList) => {
      const first = pointFromTouch(touches[0]);
      const second = pointFromTouch(touches[1]);
      const midpoint = getPointMidpoint(first, second);
      const active = getOrCreateActiveZoom(midpoint);
      if (!active) return false;
      pinchGestureRef.current = {
        startDistance: getPointDistance(first, second),
        startMidpoint: midpoint,
        initialTransform: active.transform,
      };
      panGestureRef.current = null;
      return true;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (switchingRef.current || pendingNavigationRef.current !== null) return;
      if (isZoomControlTarget(event.target)) return;
      if (event.touches.length >= 2) {
        if (!startPinch(event.touches)) return;
        event.preventDefault();
        clearProgrammaticPageTarget();
        releaseLandingAnchor();
        touchTrackingRef.current = null;
        cancelBoundaryHint();
        zoomGestureMovedRef.current = false;
        suppressReaderClickUntilRef.current = Date.now() + 500;
        return;
      }

      const active = zoomRef.current;
      if (event.touches.length === 1 && active && active.transform.scale > 1 + ZOOM_RESET_EPSILON) {
        panGestureRef.current = {
          startPoint: pointFromTouch(event.touches[0]),
          initialTransform: active.transform,
        };
        zoomGestureMovedRef.current = false;
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (isZoomControlTarget(event.target)) return;
      if (event.touches.length >= 2) {
        if (!pinchGestureRef.current && !startPinch(event.touches)) return;
        const active = zoomRef.current;
        const gesture = pinchGestureRef.current;
        if (!active || !gesture) return;
        event.preventDefault();
        const first = pointFromTouch(event.touches[0]);
        const second = pointFromTouch(event.touches[1]);
        const midpoint = getPointMidpoint(first, second);
        const transform = getPinchZoomTransform({
          initialTransform: gesture.initialTransform,
          imageRect: active.contentRect,
          viewportRect: active.viewportRect,
          startMidpoint: gesture.startMidpoint,
          currentMidpoint: midpoint,
          startDistance: gesture.startDistance,
          currentDistance: getPointDistance(first, second),
        });
        zoomGestureMovedRef.current = true;
        suppressReaderClickUntilRef.current = Date.now() + 500;
        applyZoomTransform(transform);
        return;
      }

      const active = zoomRef.current;
      const panGesture = panGestureRef.current;
      if (event.touches.length !== 1 || !active || !panGesture || active.transform.scale <= 1 + ZOOM_RESET_EPSILON) return;
      event.preventDefault();
      const currentPoint = pointFromTouch(event.touches[0]);
      if (getPointDistance(panGesture.startPoint, currentPoint) > 3) zoomGestureMovedRef.current = true;
      suppressReaderClickUntilRef.current = Date.now() + 500;
      applyZoomTransform(getPannedZoomTransform({
        initialTransform: panGesture.initialTransform,
        imageRect: active.contentRect,
        viewportRect: active.viewportRect,
        startPoint: panGesture.startPoint,
        currentPoint,
      }));
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (isZoomControlTarget(event.target)) return;
      if (event.touches.length >= 2) {
        startPinch(event.touches);
        return;
      }
      const active = zoomRef.current;
      if (event.touches.length === 1 && active && active.transform.scale > 1 + ZOOM_RESET_EPSILON) {
        pinchGestureRef.current = null;
        panGestureRef.current = {
          startPoint: pointFromTouch(event.touches[0]),
          initialTransform: active.transform,
        };
        return;
      }

      pinchGestureRef.current = null;
      panGestureRef.current = null;
      if (!active) return;
      if (active.transform.scale <= 1 + ZOOM_RESET_EPSILON) {
        resetZoom();
        return;
      }

      const changedTouch = event.changedTouches[0];
      if (!zoomGestureMovedRef.current && changedTouch) {
        const point = pointFromTouch(changedTouch);
        const now = Date.now();
        const previous = lastZoomTapRef.current;
        if (previous && now - previous.time <= 300 && getPointDistance(previous.point, point) <= 32) {
          suppressReaderClickUntilRef.current = now + 500;
          resetZoom();
          return;
        }
        lastZoomTapRef.current = { time: now, point };
      } else {
        lastZoomTapRef.current = null;
      }
    };

    const onTouchCancel = () => {
      pinchGestureRef.current = null;
      panGestureRef.current = null;
      if (zoomRef.current?.transform.scale === 1) resetZoom();
    };

    touchTarget.addEventListener('touchstart', onTouchStart, { passive: false });
    touchTarget.addEventListener('touchmove', onTouchMove, { passive: false });
    touchTarget.addEventListener('touchend', onTouchEnd, { passive: false });
    touchTarget.addEventListener('touchcancel', onTouchCancel, { passive: false });
    return () => {
      touchTarget.removeEventListener('touchstart', onTouchStart);
      touchTarget.removeEventListener('touchmove', onTouchMove);
      touchTarget.removeEventListener('touchend', onTouchEnd);
      touchTarget.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [applyZoomTransform, cancelBoundaryHint, clearProgrammaticPageTarget, getOrCreateActiveZoom, photo, releaseLandingAnchor, resetZoom]);

  const seekPage = useCallback((page: number) => {
    resetZoom();
    releaseLandingAnchor();
    clearProgrammaticPageTarget();
    const total = imagesCountRef.current;
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(total - 1, page));
    setReaderPage(clamped);
    scrollToPage(clamped, 'instant');
  }, [clearProgrammaticPageTarget, releaseLandingAnchor, resetZoom, scrollToPage, setReaderPage]);

  const resetReader = useCallback((newChapterId: string, page?: number | 'last') => {
    if (switchingRef.current || newChapterId === chapterIdRef.current) return false;
    resetZoom();

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
      const nextSnapshotUrl = img?.src || null;
      const previousSnapshotUrl = snapshotUrlRef.current;
      if (previousSnapshotUrl && previousSnapshotUrl !== nextSnapshotUrl) {
        if (deferredSnapshotUrlsRef.current.delete(previousSnapshotUrl)) {
          URL.revokeObjectURL(previousSnapshotUrl);
        }
      }
      if (img && img.src) {
        snapshotUrlRef.current = img.src;
        setSnapshot({ url: img.src, w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1 });
      } else {
        snapshotUrlRef.current = null;
        setSnapshot(null);
      }
    }

    setTransitioning(true);
    cancelBoundaryHint();
    releaseLandingAnchor();
    clearProgrammaticPageTarget();
    clearResidentImages();
    const emptyAspectRatios = new Map<number, number>();
    pageAspectRatiosRef.current = emptyAspectRatios;
    pendingAspectRatiosRef.current.clear();
    pendingLayoutAnchorRef.current = null;
    setPageAspectRatios(emptyAspectRatios);
    setFailedPages(new Set());
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
    visiblePagesRef.current = new Set(typeof page === 'number' ? [page] : [0]);

    const chaptersToCarry = sortedChaptersRef.current;
    navigate(`/reader/${newChapterId}`, {
      replace: true,
      state: { isSeries: chaptersToCarry.length > 1 || isSeries, seriesItems: chaptersToCarry, album },
    });
    return true;
  }, [album, cancelBoundaryHint, clearProgrammaticPageTarget, clearResidentImages, isSeries, navigate, releaseLandingAnchor, resetZoom, setReaderPage]);

  const switchAdjacentChapter = useCallback((dir: ChapterDirection) => {
    const offset = dir === 'next' ? 1 : -1;
    const target = sortedChaptersRef.current[chapterIndexRef.current + offset];
    if (!target) return false;
    return resetReader(target.id, getChapterLandingPage(dir));
  }, [resetReader]);

  const handleImageLoad = useCallback((chapterId: string, pageIndex: number, image: HTMLImageElement) => {
    if (chapterIdRef.current !== chapterId) return;
    recordPageDimensions(chapterId, pageIndex, image.naturalWidth, image.naturalHeight);

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
  }, [completeChapterTransition, recordPageDimensions, scrollToPage]);

  const scrollByInputStep = useCallback((step: number) => {
    const el = containerRef.current;
    if (!el || switchingRef.current || pendingNavigationRef.current !== null) return;
    resetZoom();
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
  }, [cancelBoundaryHint, clearProgrammaticPageTarget, getScrollMetrics, releaseLandingAnchor, resetZoom, scrollToPage, setProgrammaticPageTarget, setReaderPage, showBoundaryToast, switchAdjacentChapter]);

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
    resetZoom();
    clearResidentImages();
    snapshotUrlRef.current = null;
    for (const url of deferredSnapshotUrlsRef.current) URL.revokeObjectURL(url);
    deferredSnapshotUrlsRef.current.clear();
    clearProgrammaticPageTarget();
    releaseLandingAnchor();
  }, [clearProgrammaticPageTarget, clearResidentImages, releaseLandingAnchor, resetZoom]);

  const toggleDirection = useCallback(() => {
    resetZoom();
    releaseLandingAnchor();
    clearProgrammaticPageTarget();
    cancelBoundaryHint();
    setDirection((prev) => {
      const next: ReadingDirection = prev === 'left-right' ? 'top-down' : 'left-right';
      saveReadingDirection(next);
      return next;
    });
  }, [cancelBoundaryHint, clearProgrammaticPageTarget, releaseLandingAnchor, resetZoom]);

  const toggleAutoSnap = useCallback(() => {
    resetZoom();
    setAutoSnap((prev) => {
      saveAutoSnap(!prev);
      return !prev;
    });
  }, [resetZoom]);

  const toggleSeamlessMode = useCallback(() => {
    resetZoom();
    pendingLayoutAnchorRef.current = captureLayoutAnchor(autoSnapRef.current);
    setSeamlessMode((prev) => {
      const next = !prev;
      saveSeamlessMode(next);
      return next;
    });
  }, [captureLayoutAnchor, resetZoom]);

  const changeLazyRenderRange = useCallback((value: number) => {
    const next = Math.max(1, Math.min(12, Math.round(value)));
    setLazyRenderRange(next);
    saveLazyRenderRange(next);
  }, []);

  // ─── bounded resident image window ───────────────────────────────────────────

  useEffect(() => {
    if (!photo || photo.id !== currentChapterId || images.length === 0) return;

    const generation = loadGenerationRef.current;
    const chapterId = photo.id;
    const selection = selectResidentPages({
      pageCount: images.length,
      currentPage,
      visiblePages: visiblePagesRef.current,
      pinnedPages: zoomRef.current?.pageIndexes ?? [],
      prefetchRange: lazyRenderRange,
      costs: pageCostsRef.current,
    });
    const desired = new Set(selection.pages);
    desiredPagesRef.current = desired;

    const nextMap = evictResidentPageUrls(blobMapRef.current, desired, revokeBlobUrl);
    if (nextMap !== blobMapRef.current) commitBlobMap(nextMap);

    for (const [pageIndex, controller] of inflightRef.current) {
      if (!desired.has(pageIndex)) controller.abort();
    }

    for (const pageIndex of selection.pages) {
      if (blobMapRef.current.has(pageIndex) || inflightRef.current.has(pageIndex) || failedPages.has(pageIndex)) continue;
      const image = images[pageIndex];
      if (!image) continue;

      const controller = new AbortController();
      inflightRef.current.set(pageIndex, controller);
      void imageLoadLimitRef.current!(async () => {
        try {
          if (controller.signal.aborted) return;
          const processed = await getProcessedPhotoImage(photo, image, controller.signal);
          if (
            controller.signal.aborted
            || generation !== loadGenerationRef.current
            || chapterId !== chapterIdRef.current
            || !desiredPagesRef.current.has(pageIndex)
          ) return;

          const blobUrl = URL.createObjectURL(new Blob([processed.data], { type: 'image/jpeg' }));
          if (
            controller.signal.aborted
            || generation !== loadGenerationRef.current
            || chapterId !== chapterIdRef.current
            || !desiredPagesRef.current.has(pageIndex)
          ) {
            URL.revokeObjectURL(blobUrl);
            return;
          }

          pageCostsRef.current.set(
            pageIndex,
            estimateResidentImageBytes(processed.width, processed.height, processed.byteLength),
          );
          recordPageDimensions(chapterId, pageIndex, processed.width, processed.height);

          if (blobMapRef.current.has(pageIndex)) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          const updated = new Map(blobMapRef.current);
          updated.set(pageIndex, blobUrl);
          commitBlobMap(updated);
        } catch (error) {
          if (!controller.signal.aborted && generation === loadGenerationRef.current) {
            console.error(`加载第 ${pageIndex + 1} 页失败:`, error);
            setFailedPages((current) => {
              const updated = new Set(current);
              updated.add(pageIndex);
              return updated;
            });
          }
        } finally {
          if (inflightRef.current.get(pageIndex) === controller) {
            inflightRef.current.delete(pageIndex);
            if (generation === loadGenerationRef.current) {
              setResidencyRevision((value) => value + 1);
            }
          }
        }
      });
    }
  }, [commitBlobMap, currentChapterId, currentPage, failedPages, images, lazyRenderRange, photo, recordPageDimensions, residencyRevision, revokeBlobUrl]);

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
    visiblePagesRef.current = new Set([targetPage]);
    setReaderPage(targetPage);
    setLandingAnchor(currentChapterId, targetPage);

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

  const updateVisiblePages = useCallback((container: HTMLDivElement) => {
    const horizontal = isRTLRef.current;
    const viewportStart = horizontal ? container.scrollLeft : container.scrollTop;
    const viewportEnd = viewportStart + (horizontal ? container.clientWidth : container.clientHeight);
    const count = Math.min(imagesCountRef.current, container.children.length);
    const cache = pageOffsetCacheRef.current;
    const getOffset = (pageIndex: number) => cache.get(pageIndex, container.children[pageIndex] as HTMLElement, horizontal);
    const next = computeVisiblePageIndexes(count, viewportStart, viewportEnd, getOffset);
    if (next.size === 0 && count > 0) next.add(Math.max(0, Math.min(count - 1, currentPageRef.current)));

    const previous = visiblePagesRef.current;
    if (previous.size === next.size && [...next].every((page) => previous.has(page))) return;
    visiblePagesRef.current = next;
    setResidencyRevision((value) => value + 1);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    pageOffsetCacheRef.current.invalidate();
    if (container) updateVisiblePages(container);
  }, [direction, pageAspectRatios, seamlessMode, updateVisiblePages]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !photo || images.length === 0) return;

    const isHorizontal = isRTL;
    const snapEnabled = getReaderInteractionPolicy({ autoSnap, seamlessMode, isZoomed: false }).snapEnabled;
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
      updateVisiblePages(el);
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
        const cache = pageOffsetCacheRef.current;
        const getOffset = (i: number) => cache.get(i, children[i] as HTMLElement, true);
        const best = findCenterPage(children.length, center, getOffset) ?? currentPageRef.current;
        if (best !== currentPageRef.current) setReaderPage(best);
        if (shouldSettleHorizontal) {
          clearHorizontalSnapTimer();
          horizontalSnapTimerRef.current = window.setTimeout(settleHorizontalPage, 120);
        }
      } else {
        if (pendingNavigationRef.current !== null) return;
        const center = el.scrollTop + el.clientHeight / 2;
        const cache = pageOffsetCacheRef.current;
        const getOffset = (i: number) => cache.get(i, children[i] as HTMLElement, false);
        const best = findCenterPage(children.length, center, getOffset) ?? currentPageRef.current;
        if (best !== currentPageRef.current) setReaderPage(best);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    pageOffsetCacheRef.current.invalidate();
    updateVisiblePages(el);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          pageOffsetCacheRef.current.invalidate();
          updateVisiblePages(el);
        });
    resizeObserver?.observe(el);

    return () => {
      clearHorizontalSnapTimer();
      resizeObserver?.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, direction, albumId, currentChapterId, currentChapterIndex, images.length, autoSnap, seamlessMode, updateVisiblePages]);

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
      if (zoomedRef.current) {
        e.preventDefault();
        return;
      }
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

    const cancelTouchTracking = () => {
      touchTrackingRef.current = null;
      cancelBoundaryHint();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || zoomRef.current) {
        cancelTouchTracking();
        return;
      }
      clearProgrammaticPageTarget();
      if (switchingRef.current || pendingNavigationRef.current !== null) return;
      const t = e.touches[0];
      const metrics = getScrollMetrics();
      if (!metrics) return;
      const atPrev = getBoundaryDirection({ ...metrics, step: -1 }) === 'prev';
      const atNext = getBoundaryDirection({ ...metrics, step: 1 }) === 'next';
      if (!atPrev && !atNext) {
        touchTrackingRef.current = null;
        return;
      }
      cancelBoundaryHint();
      releaseLandingAnchor();
      touchTrackingRef.current = {
        boundaryDir: atPrev ? 'prev' : 'next',
        startX: t.clientX,
        startY: t.clientY,
        distance: 0,
        lockedOutward: false,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || zoomRef.current) {
        cancelTouchTracking();
        return;
      }
      const tr = touchTrackingRef.current;
      if (!tr) return;
      // still pinned at the boundary? if the page can scroll further (not truly at edge), abort.
      const metrics = getScrollMetrics();
      const stillAtBoundary = metrics
        ? getBoundaryDirection({ ...metrics, step: tr.boundaryDir === 'next' ? 1 : -1 }) === tr.boundaryDir
        : false;
      if (!stillAtBoundary) {
        cancelTouchTracking();
        return;
      }

      const t = e.touches[0];
      const axisDelta = isRTLRef.current ? t.clientX - tr.startX : t.clientY - tr.startY;
      const pull = classifyBoundaryPull({ direction: tr.boundaryDir, axisDelta });
      if (!tr.lockedOutward) {
        if (pull.intent === 'pending') return;
        suppressReaderClickUntilRef.current = Date.now() + 500;
        if (pull.intent === 'inward') {
          cancelTouchTracking();
          return;
        }
        tr.lockedOutward = true;
      }
      if (pull.intent === 'inward') {
        cancelTouchTracking();
        return;
      }

      tr.distance = pull.distance;
      const progress = Math.min(1, pull.distance / BOUNDARY_SWITCH_THRESHOLD);
      const hasChapter = tr.boundaryDir === 'next' ? hasNextChapterRef.current : hasPrevChapterRef.current;
      if (!hasChapter) {
        // no chapter: don't show progress hint, just a toast (already shown on threshold pass)
        if (progress >= 0.6) showBoundaryToast(tr.boundaryDir);
        return;
      }
      setHint({ dir: tr.boundaryDir, progress, chapterName: tr.boundaryDir === 'next' ? nextChapterNameRef.current : prevChapterNameRef.current });
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0 || zoomRef.current) {
        cancelTouchTracking();
        return;
      }
      const tr = touchTrackingRef.current;
      touchTrackingRef.current = null;
      if (!tr?.lockedOutward) {
        cancelBoundaryHint();
        return;
      }
      const progress = Math.min(1, tr.distance / BOUNDARY_SWITCH_THRESHOLD);
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

    const onTouchCancel = () => cancelTouchTracking();

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [photo, clearProgrammaticPageTarget, getScrollMetrics, releaseLandingAnchor, showBoundaryToast, cancelBoundaryHint, triggerChapterSwitch]);

  // ── click-to-flip handling (touch scrolling stays on the reader container) ──

  const handleFlipClick = useCallback((e: React.MouseEvent) => {
    if (Date.now() < suppressReaderClickUntilRef.current) return;
    if (zoomedRef.current) {
      if (!showUI) setShowUI(true);
      return;
    }
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
    return <ReaderLoadingView />;
  }

  const barPad = barVisible ? {
    paddingBottom: barSide === 'bottom' ? 40 : 0,
    paddingLeft: barSide === 'left' ? 40 : 0,
    paddingRight: barSide === 'right' ? 40 : 0,
  } : {};
  const readerPolicy = getReaderInteractionPolicy({ autoSnap, seamlessMode, isZoomed });

  const scrollDivStyle: React.CSSProperties = {
    position: 'relative',
    overflowX: isZoomed ? 'hidden' : (isRTL ? 'auto' : 'hidden'),
    overflowY: isZoomed ? 'hidden' : (isRTL ? 'hidden' : 'auto'),
    display: 'flex',
    flexDirection: isRTL ? 'row' : 'column',
    gap: 0,
    scrollSnapType: readerPolicy.snapEnabled ? (isRTL ? 'x mandatory' : 'y mandatory') : 'none',
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain',
    touchAction: isZoomed ? 'none' : (isRTL ? 'pan-x' : 'pan-y'),
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    ...barPad,
  };

  const imgCls = seamlessMode
    ? 'block h-full w-full object-contain'
    : isRTL
      ? 'block w-full h-auto max-h-full object-contain'
      : 'block h-auto w-full object-contain';

  const loadingPages = new Set(selectResidentPages({
    pageCount: images.length,
    currentPage,
    visiblePages: visiblePagesRef.current,
    pinnedPages: zoomRef.current?.pageIndexes ?? [],
    prefetchRange: lazyRenderRange,
    costs: pageCostsRef.current,
  }).pages);

  return (
    <div
      ref={readerRootRef}
      className="fixed inset-0 bg-black select-none overflow-hidden"
      style={{ touchAction: isZoomed ? 'none' : (isRTL ? 'pan-x' : 'pan-y') }}
    >
      <style>{`::-webkit-scrollbar { display: none; }`}</style>
      <ReaderPageCanvas
        containerRef={containerRef}
        images={images}
        blobMap={blobMap}
        loadingPages={loadingPages}
        failedPages={failedPages}
        pageAspectRatios={pageAspectRatios}
        direction={direction}
        seamlessMode={seamlessMode}
        snapEnabled={readerPolicy.snapEnabled}
        imgCls={imgCls}
        chapterId={photo.id}
        scrollDivStyle={scrollDivStyle}
        currentPage={currentPage}
        translationRecord={translation.currentRecord}
        translationVisible={translation.visible}
        onClick={handleFlipClick}
        onImageLoad={handleImageLoad}
      />

      {/* chapter-switch transition overlay — keeps the last page visible until the new chapter is ready */}
      <ChapterTransitionOverlay snapshot={snapshot} transitioning={transitioning} />

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
        isZoomed={isZoomed}
        externalDialogOpen={translation.dialogOpen}
        translationConfigured={translation.configured}
        translationBusy={translation.currentPageBusy}
        translationProcessed={translation.currentRecord !== null}
        translationHasResult={(translation.currentRecord?.regions.length ?? 0) > 0}
        translationVisible={translation.visible}
        onToggleVisibility={() => setShowUI((v) => !v)}
        onClose={() => navigate(-1)}
        onPrevChapter={goPrevChapter}
        onNextChapter={goNextChapter}
        onGoToChapter={goToChapter}
        onToggleDirection={toggleDirection}
        onToggleAutoSnap={toggleAutoSnap}
        onToggleSeamlessMode={toggleSeamlessMode}
        onChangeLazyRenderRange={changeLazyRenderRange}
        onToggleBarVisible={() => setBarVisible(v => !v)}
        onResetZoom={resetZoom}
        onTranslationAction={() => {
          void translation.translateCurrent();
        }}
        onToggleTranslation={translation.toggleVisible}
        onOpenTranslationSettings={translation.openDialog}
        onScrollByInputStep={scrollByInputStep}
        onSeekPage={seekPage}
      />

      {(translation.task || translation.notice) && !translation.dialogOpen && (
        <div className="absolute bottom-14 left-1/2 z-[60] w-[22rem] max-w-[calc(100vw-24px)] -translate-x-1/2">
          <div
            className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-xl backdrop-blur-md ${
              !translation.task && translation.notice?.kind === 'error'
                ? 'border-red-500/40 bg-red-950/90 text-red-100'
                : 'border-white/10 bg-gray-900/90 text-gray-100'
            }`}
          >
            {translation.task && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-gray-500 border-t-white" />}
            <div className="min-w-0 flex-1">
              <span className="wrap-break-word">
                {translation.task
                  ? getTranslationTaskLabel(translation.task)
                  : translation.notice?.message}
              </span>
              {translation.task?.stage === 'loading-model' &&
                translation.task.ocrInitialization?.phase === 'downloading' && (
                  <div className="mt-1.5">
                    <div
                      role="progressbar"
                      aria-label="OCR 模型下载进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={
                        translation.task.ocrInitialization.totalBytes
                          ? Math.min(
                              100,
                              Math.round(
                                (translation.task.ocrInitialization.loadedBytes /
                                  translation.task.ocrInitialization.totalBytes) * 100,
                              ),
                            )
                          : undefined
                      }
                      className="h-1.5 overflow-hidden rounded-full bg-gray-700"
                    >
                      <div
                        className={`h-full rounded-full bg-brand-400 transition-[width] duration-150 ${
                          translation.task.ocrInitialization.totalBytes
                            ? ''
                            : 'w-1/3 animate-pulse'
                        }`}
                        style={
                          translation.task.ocrInitialization.totalBytes
                            ? {
                                width: `${Math.min(
                                  100,
                                  (translation.task.ocrInitialization.loadedBytes /
                                    translation.task.ocrInitialization.totalBytes) * 100,
                                )}%`,
                              }
                            : undefined
                        }
                      />
                    </div>
                    <div className="mt-1 text-[10px] tabular-nums text-gray-400">
                      {formatModelBytes(translation.task.ocrInitialization.loadedBytes)}
                      {translation.task.ocrInitialization.totalBytes
                        ? ` / ${formatModelBytes(translation.task.ocrInitialization.totalBytes)}`
                        : ''}
                    </div>
                  </div>
                )}
            </div>
            <button
              type="button"
              onClick={translation.task ? translation.cancelCurrentTranslation : translation.dismissNotice}
              className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center text-current opacity-70 hover:opacity-100"
              title={translation.task ? '取消当前页翻译' : '关闭'}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <TranslationSettingsDialog
        open={translation.dialogOpen}
        settings={translation.settings}
        busy={translation.busy}
        canRetranslate={translation.currentRecord !== null}
        onSave={translation.saveSettings}
        onClearCache={translation.clearCache}
        onRetranslate={() => {
          void translation.retranslateCurrent();
        }}
        onClose={translation.closeDialog}
      />
    </div>
  );
}
