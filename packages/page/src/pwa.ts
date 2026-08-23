import { startPwaUpdateChecks } from './pwa-update';

declare const __APP_RELEASE_ID__: string;

const SERVICE_WORKER_URL = '/sw.js';
const LEGACY_WORKER_CACHE_NAMES = ['cover-images'];
const PRELOAD_RECOVERY_KEY = `jm:preload-recovery:${__APP_RELEASE_ID__}`;
let reloadStarted = false;

export function reloadPageOnce(
  recoveryKey?: string,
  reload = window.location.reload.bind(window.location),
) {
  if (reloadStarted) return;

  if (recoveryKey) {
    try {
      if (window.sessionStorage.getItem(recoveryKey) === '1') return;
      window.sessionStorage.setItem(recoveryKey, '1');
    } catch {
      // The current-document guard still coalesces competing recovery events.
    }
  }

  reloadStarted = true;
  reload();
}

async function deleteLegacyWorkerCaches() {
  if (!('caches' in window)) return;

  await Promise.all(
    LEGACY_WORKER_CACHE_NAMES.map(async (cacheName) => {
      try {
        await window.caches.delete(cacheName);
      } catch (error) {
        console.error(`Failed to delete legacy cache ${cacheName}`, error);
      }
    }),
  );
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadPageOnce(PRELOAD_RECOVERY_KEY);
});

void deleteLegacyWorkerCaches();

function registerPwaServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reloadPageOnce();
  });

  void navigator.serviceWorker
    .register(SERVICE_WORKER_URL, {
      scope: '/',
      updateViaCache: 'none',
    })
    .then((registration) => {
      const updateController = startPwaUpdateChecks({ registration });
      void updateController.checkForUpdate(true);
    })
    .catch((error) => {
      console.error('PWA service worker registration failed', error);
    });
}

registerPwaServiceWorker();
