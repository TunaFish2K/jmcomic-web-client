import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getReaderAnchorRatio,
  getReaderAnchorScrollPosition,
  getReaderInteractionPolicy,
  getReaderPageStyle,
} from '../src/reader/layout';

describe('reader layout modes', () => {
  it('keeps seamless mode and auto snap independent in all four combinations', () => {
    assert.deepEqual(
      getReaderInteractionPolicy({ autoSnap: false, seamlessMode: false, isZoomed: false }),
      { snapEnabled: false, zoomTarget: 'single-image' },
    );
    assert.deepEqual(
      getReaderInteractionPolicy({ autoSnap: true, seamlessMode: false, isZoomed: false }),
      { snapEnabled: true, zoomTarget: 'single-image' },
    );
    assert.deepEqual(
      getReaderInteractionPolicy({ autoSnap: false, seamlessMode: true, isZoomed: false }),
      { snapEnabled: false, zoomTarget: 'visible-pages' },
    );
    assert.deepEqual(
      getReaderInteractionPolicy({ autoSnap: true, seamlessMode: true, isZoomed: false }),
      { snapEnabled: true, zoomTarget: 'single-image' },
    );
  });

  it('temporarily disables snapping while content is zoomed', () => {
    assert.equal(
      getReaderInteractionPolicy({ autoSnap: true, seamlessMode: true, isZoomed: true }).snapEnabled,
      false,
    );
  });

  it('fits horizontal seamless pages to the reader height', () => {
    const style = getReaderPageStyle({
      direction: 'left-right',
      seamlessMode: true,
      aspectRatio: 0.75,
      snapEnabled: false,
    });

    assert.equal(style.height, '100%');
    assert.equal(style.width, 'auto');
    assert.equal(style.aspectRatio, 0.75);
    assert.equal(style.flex, '0 0 auto');
  });

  it('fits vertical seamless pages to the reader width', () => {
    const style = getReaderPageStyle({
      direction: 'top-down',
      seamlessMode: true,
      aspectRatio: 0.75,
      snapEnabled: true,
    });

    assert.equal(style.width, '100%');
    assert.equal(style.height, 'auto');
    assert.equal(style.aspectRatio, 0.75);
    assert.equal(style.scrollSnapAlign, 'start');
  });

  it('uses a one-viewport fallback until a page ratio is known', () => {
    assert.equal(getReaderPageStyle({
      direction: 'left-right',
      seamlessMode: true,
      snapEnabled: false,
    }).flex, '0 0 100%');
    assert.equal(getReaderPageStyle({
      direction: 'top-down',
      seamlessMode: true,
      snapEnabled: false,
    }).flex, '0 0 100%');
  });

  it('preserves the same page content point when a page is resized', () => {
    const offsetRatio = getReaderAnchorRatio(700, 400, 600);
    const scrollPosition = getReaderAnchorScrollPosition({
      pageStart: 300,
      pageSize: 900,
      offsetRatio,
      viewportSize: 400,
      maxScroll: 2000,
    });

    assert.equal(offsetRatio, 0.5);
    assert.equal(scrollPosition, 550);
  });
});
