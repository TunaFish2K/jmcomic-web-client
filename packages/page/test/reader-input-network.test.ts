import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import {
  canTrackpadSwitchAtBoundary,
  getAnimatedScrollBehavior,
  getReaderWheelMode,
  getSeekPageFromKey,
} from '../src/reader/input';
import {
  canPrefetchAdjacentChapter,
  getBrowserReaderNetworkCapabilities,
  getReaderImageConcurrency,
  subscribeToReaderNetworkChanges,
} from '../src/reader/network';

describe('reader input policy', () => {
  test('keeps vertical wheels native and horizontal trackpads continuous without snap', () => {
    assert.equal(getReaderWheelMode({ horizontal: false, autoSnap: true, trackpad: false }), 'native');
    assert.equal(getReaderWheelMode({ horizontal: true, autoSnap: false, trackpad: true }), 'continuous');
    assert.equal(getReaderWheelMode({ horizontal: true, autoSnap: true, trackpad: true }), 'paged');
    assert.equal(getReaderWheelMode({ horizontal: true, autoSnap: false, trackpad: false }), 'paged');
  });

  test('only permits a trackpad chapter switch when the gesture began at that boundary', () => {
    assert.equal(canTrackpadSwitchAtBoundary('next', 'next'), true);
    assert.equal(canTrackpadSwitchAtBoundary('prev', 'next'), false);
    assert.equal(canTrackpadSwitchAtBoundary(null, 'prev'), false);
  });

  test('uses instant movement for reduced motion', () => {
    assert.equal(getAnimatedScrollBehavior(true), 'instant');
    assert.equal(getAnimatedScrollBehavior(false), 'smooth');
  });

  test('maps slider keys and clamps every target into the chapter', () => {
    assert.equal(getSeekPageFromKey({ key: 'ArrowLeft', currentPage: 0, totalPages: 12 }), 0);
    assert.equal(getSeekPageFromKey({ key: 'ArrowUp', currentPage: 6, totalPages: 12 }), 5);
    assert.equal(getSeekPageFromKey({ key: 'ArrowRight', currentPage: 6, totalPages: 12 }), 7);
    assert.equal(getSeekPageFromKey({ key: 'ArrowDown', currentPage: 11, totalPages: 12 }), 11);
    assert.equal(getSeekPageFromKey({ key: 'Home', currentPage: 6, totalPages: 12 }), 0);
    assert.equal(getSeekPageFromKey({ key: 'End', currentPage: 6, totalPages: 12 }), 11);
    assert.equal(getSeekPageFromKey({ key: 'PageUp', currentPage: 6, totalPages: 12 }), 0);
    assert.equal(getSeekPageFromKey({ key: 'PageDown', currentPage: 6, totalPages: 12 }), 11);
    assert.equal(getSeekPageFromKey({ key: 'PageDown', currentPage: 1, totalPages: 20, pageStep: 3 }), 4);
    assert.equal(getSeekPageFromKey({ key: 'Escape', currentPage: 1, totalPages: 0 }), null);
  });
});

describe('reader network policy', () => {
  test('adapts image concurrency to constrained and capable devices', () => {
    assert.equal(getReaderImageConcurrency({ saveData: true }), 1);
    assert.equal(getReaderImageConcurrency({ effectiveType: 'slow-2g' }), 1);
    assert.equal(getReaderImageConcurrency({ effectiveType: '2g' }), 1);
    assert.equal(getReaderImageConcurrency({ effectiveType: '3g' }), 2);
    assert.equal(getReaderImageConcurrency({ deviceMemory: 4 }), 2);
    assert.equal(getReaderImageConcurrency({ hardwareConcurrency: 4 }), 2);
    assert.equal(getReaderImageConcurrency({
      effectiveType: '4g',
      deviceMemory: 8,
      hardwareConcurrency: 8,
    }), 4);
    assert.equal(getReaderImageConcurrency({ effectiveType: '4g', deviceMemory: 8 }), 3);
    assert.equal(getReaderImageConcurrency({}), 3);
  });

  test('avoids adjacent prefetch on data-saving and 2g connections', () => {
    assert.equal(canPrefetchAdjacentChapter({ saveData: true, effectiveType: '4g' }), false);
    assert.equal(canPrefetchAdjacentChapter({ effectiveType: 'slow-2g' }), false);
    assert.equal(canPrefetchAdjacentChapter({ effectiveType: '2g' }), false);
    assert.equal(canPrefetchAdjacentChapter({ effectiveType: '3g' }), true);
    assert.equal(canPrefetchAdjacentChapter({}), true);
  });

  test('reads capabilities and tracks connection changes', () => {
    const connection = new EventTarget() as EventTarget & { saveData: boolean; effectiveType: string };
    connection.saveData = false;
    connection.effectiveType = '4g';
    const navigatorValue = {
      connection,
      deviceMemory: 16,
      hardwareConcurrency: 12,
    } as unknown as Navigator;

    assert.deepEqual(getBrowserReaderNetworkCapabilities(navigatorValue), {
      saveData: false,
      effectiveType: '4g',
      deviceMemory: 16,
      hardwareConcurrency: 12,
    });

    let latest = {};
    const unsubscribe = subscribeToReaderNetworkChanges((value) => { latest = value; }, navigatorValue);
    connection.effectiveType = '3g';
    connection.dispatchEvent(new Event('change'));
    assert.deepEqual(latest, {
      saveData: false,
      effectiveType: '3g',
      deviceMemory: 16,
      hardwareConcurrency: 12,
    });
    unsubscribe();
    latest = {};
    connection.dispatchEvent(new Event('change'));
    assert.deepEqual(latest, {});
  });

  test('returns a harmless unsubscribe function without a connection API', () => {
    let called = false;
    const unsubscribe = subscribeToReaderNetworkChanges(() => { called = true; }, {} as Navigator);
    unsubscribe();
    assert.equal(called, false);
  });
});
