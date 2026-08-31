export const READER_UI_IDLE_DELAY_MS = 3000;
export const READER_DESKTOP_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

type IdleScheduler = {
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (timer: TimerHandle) => void;
};

const defaultScheduler: IdleScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
};

export function createReaderUiIdleController({
  onVisibilityChange,
  delayMs = READER_UI_IDLE_DELAY_MS,
  scheduler = defaultScheduler,
}: {
  onVisibilityChange: (visible: boolean) => void;
  delayMs?: number;
  scheduler?: IdleScheduler;
}) {
  let enabled = false;
  let paused = false;
  let visible = true;
  let disposed = false;
  let timer: TimerHandle | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    scheduler.clearTimeout(timer);
    timer = null;
  };

  const armTimer = () => {
    clearTimer();
    if (disposed || !enabled || paused || !visible) return;
    timer = scheduler.setTimeout(() => {
      timer = null;
      visible = false;
      onVisibilityChange(false);
    }, delayMs);
  };

  return {
    setEnabled(nextEnabled: boolean) {
      if (disposed || enabled === nextEnabled) return;
      enabled = nextEnabled;
      if (!enabled) {
        clearTimer();
        if (!visible) {
          visible = true;
          onVisibilityChange(true);
        }
        return;
      }
      armTimer();
    },

    setPaused(nextPaused: boolean) {
      if (disposed || paused === nextPaused) return;
      paused = nextPaused;
      if (paused) clearTimer();
      else armTimer();
    },

    setVisible(nextVisible: boolean) {
      if (disposed) return;
      visible = nextVisible;
      if (visible) armTimer();
      else clearTimer();
    },

    activity() {
      if (disposed || !enabled) return;
      if (!visible) {
        visible = true;
        onVisibilityChange(true);
      }
      armTimer();
    },

    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}

export type ReaderUiIdleController = ReturnType<typeof createReaderUiIdleController>;
