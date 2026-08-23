import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  accumulateBoundaryGesture,
  classifyBoundaryPull,
  getBoundaryDirection,
  getChapterLandingPage,
  getDominantWheelDelta,
  isCurrentChapterLoad,
  isLikelyTrackpadWheel,
  isMatchingChapterTransition,
  isScrollTargetReached,
  MOUSE_WHEEL_BOUNDARY_CONTRIBUTION,
  TOUCH_BOUNDARY_DIRECTION_LOCK_PX,
} from '../src/reader/navigation';

describe('reader navigation', () => {
  it('detects only outward movement at the real scroll boundaries', () => {
    assert.equal(getBoundaryDirection({ position: 0, maxPosition: 800, step: -1 }), 'prev');
    assert.equal(getBoundaryDirection({ position: 800, maxPosition: 800, step: 1 }), 'next');
    assert.equal(getBoundaryDirection({ position: 300, maxPosition: 800, step: 1 }), null);
    assert.equal(getBoundaryDirection({ position: 0, maxPosition: 800, step: 1 }), null);
    assert.equal(getBoundaryDirection({ position: 800, maxPosition: 800, step: -1 }), null);
  });

  it('honors the edge tolerance for fractional scroll positions', () => {
    assert.equal(getBoundaryDirection({ position: 1.5, maxPosition: 800, step: -1 }), 'prev');
    assert.equal(getBoundaryDirection({ position: 798.5, maxPosition: 800, step: 1 }), 'next');
    assert.equal(getBoundaryDirection({ position: 3, maxPosition: 800, step: -1 }), null);
  });

  it('keeps inward horizontal swipes available for normal page turns', () => {
    assert.deepEqual(classifyBoundaryPull({ direction: 'prev', axisDelta: -30 }), {
      intent: 'inward',
      distance: 0,
    });
    assert.deepEqual(classifyBoundaryPull({ direction: 'next', axisDelta: 30 }), {
      intent: 'inward',
      distance: 0,
    });
  });

  it('locks only outward pulls for adjacent chapter navigation', () => {
    assert.deepEqual(classifyBoundaryPull({ direction: 'prev', axisDelta: 30 }), {
      intent: 'outward',
      distance: 30,
    });
    assert.deepEqual(classifyBoundaryPull({ direction: 'next', axisDelta: -30 }), {
      intent: 'outward',
      distance: 30,
    });
  });

  it('ignores boundary pull jitter before the direction lock threshold', () => {
    assert.deepEqual(classifyBoundaryPull({
      direction: 'prev',
      axisDelta: TOUCH_BOUNDARY_DIRECTION_LOCK_PX - 1,
    }), {
      intent: 'pending',
      distance: TOUCH_BOUNDARY_DIRECTION_LOCK_PX - 1,
    });
    assert.deepEqual(classifyBoundaryPull({
      direction: 'next',
      axisDelta: -(TOUCH_BOUNDARY_DIRECTION_LOCK_PX - 1),
    }), {
      intent: 'pending',
      distance: TOUCH_BOUNDARY_DIRECTION_LOCK_PX - 1,
    });
  });

  it('keeps a programmatic page target until the smooth scroll reaches it', () => {
    assert.equal(isScrollTargetReached({ position: 400, targetPosition: 800 }), false);
    assert.equal(isScrollTargetReached({ position: 798.5, targetPosition: 800 }), true);
  });

  it('accumulates one direction and resets when the direction changes', () => {
    const first = accumulateBoundaryGesture({
      currentDirection: null,
      currentAmount: 0,
      direction: 'next',
      contribution: 30,
    });
    assert.deepEqual(first, { direction: 'next', amount: 30, progress: 0.5, shouldSwitch: false });

    const second = accumulateBoundaryGesture({
      currentDirection: first.direction,
      currentAmount: first.amount,
      direction: 'next',
      contribution: 30,
    });
    assert.equal(second.shouldSwitch, true);
    assert.equal(second.progress, 1);

    const reversed = accumulateBoundaryGesture({
      currentDirection: second.direction,
      currentAmount: second.amount,
      direction: 'prev',
      contribution: 10,
    });
    assert.deepEqual(reversed, { direction: 'prev', amount: 10, progress: 1 / 6, shouldSwitch: false });
  });

  it('uses continuous reading positions for adjacent chapters', () => {
    assert.equal(getChapterLandingPage('next'), 0);
    assert.equal(getChapterLandingPage('prev'), 'last');
  });

  it('treats one mouse-wheel page turn as one chapter-boundary page turn', () => {
    const result = accumulateBoundaryGesture({
      currentDirection: null,
      currentAmount: 0,
      direction: 'next',
      contribution: MOUSE_WHEEL_BOUNDARY_CONTRIBUTION,
    });
    assert.equal(result.shouldSwitch, true);
    assert.equal(result.progress, 1);
  });

  it('normalizes wheel input without treating a large pixel wheel delta as a trackpad', () => {
    assert.equal(getDominantWheelDelta(80, 20), 80);
    assert.equal(getDominantWheelDelta(0, -100), -100);
    assert.equal(isLikelyTrackpadWheel(0, 12, 4), true);
    assert.equal(isLikelyTrackpadWheel(0, 0, 100), false);
    assert.equal(isLikelyTrackpadWheel(1, 0, 3), false);
  });

  it('rejects callbacks from an old chapter transition', () => {
    assert.equal(isMatchingChapterTransition({
      activeTransitionId: 4,
      currentChapterId: 'chapter-b',
      transitionId: 4,
      chapterId: 'chapter-b',
    }), true);
    assert.equal(isMatchingChapterTransition({
      activeTransitionId: 5,
      currentChapterId: 'chapter-b',
      transitionId: 4,
      chapterId: 'chapter-b',
    }), false);
    assert.equal(isMatchingChapterTransition({
      activeTransitionId: 4,
      currentChapterId: 'chapter-c',
      transitionId: 4,
      chapterId: 'chapter-b',
    }), false);
  });

  it('rejects image loads from an old chapter generation', () => {
    assert.equal(isCurrentChapterLoad({
      generation: 3,
      currentGeneration: 3,
      chapterId: 'chapter-b',
      currentChapterId: 'chapter-b',
    }), true);
    assert.equal(isCurrentChapterLoad({
      generation: 2,
      currentGeneration: 3,
      chapterId: 'chapter-b',
      currentChapterId: 'chapter-b',
    }), false);
    assert.equal(isCurrentChapterLoad({
      generation: 3,
      currentGeneration: 3,
      chapterId: 'chapter-a',
      currentChapterId: 'chapter-b',
    }), false);
  });
});
