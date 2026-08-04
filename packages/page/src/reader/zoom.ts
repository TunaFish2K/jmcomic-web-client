export type ZoomPoint = {
  x: number;
  y: number;
};

export type ZoomRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ZoomTransform = {
  scale: number;
  x: number;
  y: number;
};

export const MIN_ZOOM_SCALE = 1;
export const MAX_ZOOM_SCALE = 4;
export const ZOOM_RESET_EPSILON = 0.01;

export const IDENTITY_ZOOM_TRANSFORM: ZoomTransform = {
  scale: MIN_ZOOM_SCALE,
  x: 0,
  y: 0,
};

export function getPointDistance(first: ZoomPoint, second: ZoomPoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function getPointMidpoint(first: ZoomPoint, second: ZoomPoint): ZoomPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

export function clampZoomScale(scale: number) {
  return Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, scale));
}

function clampAxis(
  baseStart: number,
  baseSize: number,
  viewportStart: number,
  viewportSize: number,
  scale: number,
  offset: number,
) {
  const scaledSize = baseSize * scale;
  if (scaledSize <= viewportSize) {
    return viewportStart + (viewportSize - scaledSize) / 2 - baseStart;
  }

  const minimum = viewportStart + viewportSize - baseStart - scaledSize;
  const maximum = viewportStart - baseStart;
  return Math.max(minimum, Math.min(maximum, offset));
}

export function clampZoomTransform(
  transform: ZoomTransform,
  imageRect: ZoomRect,
  viewportRect: ZoomRect,
): ZoomTransform {
  const scale = clampZoomScale(transform.scale);
  if (scale <= MIN_ZOOM_SCALE + ZOOM_RESET_EPSILON) {
    return IDENTITY_ZOOM_TRANSFORM;
  }

  return {
    scale,
    x: clampAxis(
      imageRect.left,
      imageRect.width,
      viewportRect.left,
      viewportRect.width,
      scale,
      transform.x,
    ),
    y: clampAxis(
      imageRect.top,
      imageRect.height,
      viewportRect.top,
      viewportRect.height,
      scale,
      transform.y,
    ),
  };
}

export function getPinchZoomTransform({
  initialTransform,
  imageRect,
  viewportRect,
  startMidpoint,
  currentMidpoint,
  startDistance,
  currentDistance,
}: {
  initialTransform: ZoomTransform;
  imageRect: ZoomRect;
  viewportRect: ZoomRect;
  startMidpoint: ZoomPoint;
  currentMidpoint: ZoomPoint;
  startDistance: number;
  currentDistance: number;
}): ZoomTransform {
  if (startDistance <= 0) return initialTransform;

  const scale = clampZoomScale(initialTransform.scale * (currentDistance / startDistance));
  const imagePoint = {
    x: (startMidpoint.x - imageRect.left - initialTransform.x) / initialTransform.scale,
    y: (startMidpoint.y - imageRect.top - initialTransform.y) / initialTransform.scale,
  };

  return clampZoomTransform({
    scale,
    x: currentMidpoint.x - imageRect.left - imagePoint.x * scale,
    y: currentMidpoint.y - imageRect.top - imagePoint.y * scale,
  }, imageRect, viewportRect);
}

export function getPannedZoomTransform({
  initialTransform,
  imageRect,
  viewportRect,
  startPoint,
  currentPoint,
}: {
  initialTransform: ZoomTransform;
  imageRect: ZoomRect;
  viewportRect: ZoomRect;
  startPoint: ZoomPoint;
  currentPoint: ZoomPoint;
}): ZoomTransform {
  return clampZoomTransform({
    scale: initialTransform.scale,
    x: initialTransform.x + currentPoint.x - startPoint.x,
    y: initialTransform.y + currentPoint.y - startPoint.y,
  }, imageRect, viewportRect);
}
