import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import {
  createReaderUiIdleController,
  READER_UI_IDLE_DELAY_MS,
} from '../src/reader/idle-ui';

describe('reader UI idle controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('hides after three seconds and restarts the timer on activity', () => {
    const onVisibilityChange = vi.fn();
    const controller = createReaderUiIdleController({ onVisibilityChange });
    controller.setEnabled(true);

    vi.advanceTimersByTime(READER_UI_IDLE_DELAY_MS - 1);
    assert.equal(onVisibilityChange.mock.calls.length, 0);
    controller.activity();
    vi.advanceTimersByTime(READER_UI_IDLE_DELAY_MS - 1);
    assert.equal(onVisibilityChange.mock.calls.length, 0);
    vi.advanceTimersByTime(1);
    assert.deepEqual(onVisibilityChange.mock.calls, [[false]]);

    controller.activity();
    assert.deepEqual(onVisibilityChange.mock.calls, [[false], [true]]);
    controller.dispose();
    vi.advanceTimersByTime(READER_UI_IDLE_DELAY_MS);
    assert.equal(onVisibilityChange.mock.calls.length, 2);
  });

  test('pauses for interaction and restores hidden UI when desktop mode ends', () => {
    const onVisibilityChange = vi.fn();
    const controller = createReaderUiIdleController({ onVisibilityChange });
    controller.setEnabled(true);
    controller.setPaused(true);
    vi.advanceTimersByTime(READER_UI_IDLE_DELAY_MS * 2);
    assert.equal(onVisibilityChange.mock.calls.length, 0);

    controller.setPaused(false);
    vi.advanceTimersByTime(READER_UI_IDLE_DELAY_MS);
    assert.deepEqual(onVisibilityChange.mock.calls, [[false]]);
    controller.setEnabled(false);
    assert.deepEqual(onVisibilityChange.mock.calls, [[false], [true]]);

    controller.activity();
    vi.advanceTimersByTime(READER_UI_IDLE_DELAY_MS);
    assert.equal(onVisibilityChange.mock.calls.length, 2);
    controller.dispose();
  });
});
