import type { ChapterDirection } from './navigation';
import type { ZoomPoint, ZoomRect, ZoomTransform } from './zoom';

export type ChapterInfo = { id: string; name: string; order: number };
export type PendingNavigation = {
  chapterId: string;
  requestedPage: number | 'last' | null;
  resolvedPage: number | null;
  transitionId: number | null;
};
export type LandingAnchor = { chapterId: string; page: number };
export type ReaderLayoutAnchor = {
  pageIndex: number;
  offsetRatio: number;
  snapToStart: boolean;
};
export type SavedZoomElementStyle = {
  transform: string;
  transformOrigin: string;
  willChange: string;
  position: string;
  zIndex: string;
  width: string;
  height: string;
  minWidth: string;
  minHeight: string;
  maxWidth: string;
  maxHeight: string;
  flex: string;
  flexBasis: string;
  aspectRatio: string;
};
export type ZoomTarget = {
  element: HTMLElement;
  rect: ZoomRect;
  style: SavedZoomElementStyle;
};
export type ZoomLayer = {
  element: HTMLElement;
  position: string;
  zIndex: string;
};
export type ActiveImageZoom = {
  targets: ZoomTarget[];
  layers: ZoomLayer[];
  contentRect: ZoomRect;
  viewportRect: ZoomRect;
  transform: ZoomTransform;
  scrollLeft: number;
  scrollTop: number;
  grouped: boolean;
  pageIndexes: number[];
};
export type PinchGesture = {
  startDistance: number;
  startMidpoint: ZoomPoint;
  initialTransform: ZoomTransform;
};
export type PanGesture = {
  startPoint: ZoomPoint;
  initialTransform: ZoomTransform;
};
export type BoundaryTouchTracking = {
  boundaryDir: ChapterDirection;
  startX: number;
  startY: number;
  distance: number;
  lockedOutward: boolean;
};

export const IMAGE_LOAD_PARALLEL = 2;
export const BOUNDARY_RESET_DELAY_MS = 2000;
export const CHAPTER_SWITCH_UNLOCK_DELAY_MS = 5000;
export const LANDING_ANCHOR_DELAY_MS = 5000;
export const PROGRAMMATIC_PAGE_TARGET_TIMEOUT_MS = 1500;
export const TRACKPAD_GESTURE_END_DELAY_MS = 140;

export function parseSeriesOrder(value: string | number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function toZoomRect(rect: DOMRect): ZoomRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function saveZoomElementStyle(element: HTMLElement): SavedZoomElementStyle {
  return {
    transform: element.style.transform,
    transformOrigin: element.style.transformOrigin,
    willChange: element.style.willChange,
    position: element.style.position,
    zIndex: element.style.zIndex,
    width: element.style.width,
    height: element.style.height,
    minWidth: element.style.minWidth,
    minHeight: element.style.minHeight,
    maxWidth: element.style.maxWidth,
    maxHeight: element.style.maxHeight,
    flex: element.style.flex,
    flexBasis: element.style.flexBasis,
    aspectRatio: element.style.aspectRatio,
  };
}

export function restoreZoomElementStyle(element: HTMLElement, style: SavedZoomElementStyle) {
  element.style.transform = style.transform;
  element.style.transformOrigin = style.transformOrigin;
  element.style.willChange = style.willChange;
  element.style.position = style.position;
  element.style.zIndex = style.zIndex;
  element.style.width = style.width;
  element.style.height = style.height;
  element.style.minWidth = style.minWidth;
  element.style.minHeight = style.minHeight;
  element.style.maxWidth = style.maxWidth;
  element.style.maxHeight = style.maxHeight;
  element.style.flex = style.flex;
  element.style.flexBasis = style.flexBasis;
  element.style.aspectRatio = style.aspectRatio;
}
