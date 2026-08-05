export const PWA_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const PWA_UPDATE_MIN_GAP_MS = 5 * 60 * 1000;

export interface PwaUpdateRegistration {
  readonly installing: ServiceWorker | null;
  readonly waiting: ServiceWorker | null;
  update(): Promise<unknown>;
}

export interface PwaUpdateEnvironment {
  now(): number;
  isOnline(): boolean;
  isVisible(): boolean;
  setInterval(callback: () => void, delay: number): number;
  clearInterval(intervalId: number): void;
  onOnline(callback: () => void): () => void;
  onVisibilityChange(callback: () => void): () => void;
}

export interface PwaUpdateController {
  checkForUpdate(force?: boolean): Promise<void>;
  dispose(): void;
}

export interface StartPwaUpdateChecksOptions {
  registration: PwaUpdateRegistration;
  environment?: PwaUpdateEnvironment;
  intervalMs?: number;
  minGapMs?: number;
  onError?: (error: unknown) => void;
}

export function createBrowserPwaUpdateEnvironment(): PwaUpdateEnvironment {
  return {
    now: Date.now,
    isOnline: () => navigator.onLine,
    isVisible: () => document.visibilityState === 'visible',
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    onOnline: (callback) => {
      window.addEventListener('online', callback);
      return () => window.removeEventListener('online', callback);
    },
    onVisibilityChange: (callback) => {
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
  };
}

export function startPwaUpdateChecks({
  registration,
  environment = createBrowserPwaUpdateEnvironment(),
  intervalMs = PWA_UPDATE_INTERVAL_MS,
  minGapMs = PWA_UPDATE_MIN_GAP_MS,
  onError = (error) => console.error('PWA update check failed', error),
}: StartPwaUpdateChecksOptions): PwaUpdateController {
  let disposed = false;
  let currentCheck: Promise<void> | null = null;
  let lastAttemptAt = environment.now();

  const checkForUpdate = (force = false) => {
    if (disposed || !environment.isOnline()) {
      return Promise.resolve();
    }
    if (currentCheck) return currentCheck;
    if (registration.installing || registration.waiting)
      return Promise.resolve();
    if (!force && environment.now() - lastAttemptAt < minGapMs) {
      return Promise.resolve();
    }

    lastAttemptAt = environment.now();
    currentCheck = (async () => {
      try {
        await registration.update();
      } catch (error) {
        onError(error);
      } finally {
        currentCheck = null;
      }
    })();
    return currentCheck;
  };

  const removeOnlineListener = environment.onOnline(() => {
    void checkForUpdate(true);
  });
  const removeVisibilityListener = environment.onVisibilityChange(() => {
    if (environment.isVisible()) void checkForUpdate();
  });
  const intervalId = environment.setInterval(() => {
    if (environment.isVisible()) void checkForUpdate();
  }, intervalMs);

  return {
    checkForUpdate,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      environment.clearInterval(intervalId);
      removeOnlineListener();
      removeVisibilityListener();
    },
  };
}
