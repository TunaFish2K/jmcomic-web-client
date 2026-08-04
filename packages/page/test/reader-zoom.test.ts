import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampZoomScale,
  clampZoomTransform,
  getPannedZoomTransform,
  getPinchZoomTransform,
  getPointDistance,
  getPointMidpoint,
  IDENTITY_ZOOM_TRANSFORM,
} from '../src/reader/zoom';

const viewport = { left: 0, top: 0, width: 400, height: 800 };
const fullWidthImage = { left: 0, top: 0, width: 400, height: 800 };

describe('reader zoom geometry', () => {
  it('measures two-touch distance and midpoint', () => {
    assert.equal(getPointDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
    assert.deepEqual(getPointMidpoint({ x: 10, y: 20 }, { x: 30, y: 60 }), { x: 20, y: 40 });
  });

  it('clamps scale to the supported range', () => {
    assert.equal(clampZoomScale(0.5), 1);
    assert.equal(clampZoomScale(2.5), 2.5);
    assert.equal(clampZoomScale(8), 4);
  });

  it('keeps the content under a stationary pinch midpoint', () => {
    const transform = getPinchZoomTransform({
      initialTransform: IDENTITY_ZOOM_TRANSFORM,
      imageRect: fullWidthImage,
      viewportRect: viewport,
      startMidpoint: { x: 100, y: 200 },
      currentMidpoint: { x: 100, y: 200 },
      startDistance: 100,
      currentDistance: 200,
    });

    assert.deepEqual(transform, { scale: 2, x: -100, y: -200 });
  });

  it('includes midpoint movement while pinching', () => {
    const transform = getPinchZoomTransform({
      initialTransform: IDENTITY_ZOOM_TRANSFORM,
      imageRect: fullWidthImage,
      viewportRect: viewport,
      startMidpoint: { x: 200, y: 400 },
      currentMidpoint: { x: 180, y: 370 },
      startDistance: 100,
      currentDistance: 200,
    });

    assert.deepEqual(transform, { scale: 2, x: -220, y: -430 });
  });

  it('clamps panning so a large image cannot leave the viewport', () => {
    const transform = getPannedZoomTransform({
      initialTransform: { scale: 2, x: -200, y: -400 },
      imageRect: fullWidthImage,
      viewportRect: viewport,
      startPoint: { x: 100, y: 100 },
      currentPoint: { x: 1000, y: 1000 },
    });

    assert.deepEqual(transform, { scale: 2, x: 0, y: 0 });
  });

  it('centers a scaled image axis that remains smaller than the viewport', () => {
    const transform = clampZoomTransform(
      { scale: 2, x: 100, y: 100 },
      { left: 100, top: 300, width: 200, height: 100 },
      viewport,
    );

    assert.deepEqual(transform, { scale: 2, x: -100, y: 0 });
  });

  it('returns the exact identity transform near 100 percent', () => {
    assert.equal(
      clampZoomTransform({ scale: 1.005, x: 20, y: -20 }, fullWidthImage, viewport),
      IDENTITY_ZOOM_TRANSFORM,
    );
  });
});
