import { startPwaUpdateChecks } from './pwa-update';

const SERVICE_WORKER_URL = '/sw.js';

function registerPwaServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const reloadOnControllerChange = navigator.serviceWorker.controller !== null;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadOnControllerChange || reloading) return;
    reloading = true;
    window.location.reload();
  });

  void navigator.serviceWorker
    .register(SERVICE_WORKER_URL, {
      scope: '/',
      updateViaCache: 'none',
    })
    .then((registration) => {
      const updateController = startPwaUpdateChecks({
        swUrl: SERVICE_WORKER_URL,
        registration,
      });
      void updateController.checkForUpdate(true);
    })
    .catch((error) => {
      console.error('PWA service worker registration failed', error);
    });
}

registerPwaServiceWorker();
