import { registerSW } from 'virtual:pwa-register';
import { startPwaUpdateChecks } from './pwa-update';

registerSW({
  immediate: true,
  onRegisteredSW: (swUrl, registration) => {
    if (!registration) return;
    startPwaUpdateChecks({ swUrl, registration });
  },
  onRegisterError: (error) => {
    console.error('PWA service worker registration failed', error);
  },
});
