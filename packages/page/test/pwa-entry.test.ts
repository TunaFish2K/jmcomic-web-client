import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { createBrowserPwaUpdateEnvironment } from '../src/pwa-update';

const state = vi.hoisted(() => ({
  startChecks: vi.fn(),
  checkForUpdate: vi.fn(),
}));

vi.mock('../src/pwa-update', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/pwa-update')>()),
  startPwaUpdateChecks: state.startChecks,
}));

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PWA entry', () => {
  beforeEach(() => {
    vi.resetModules();
    state.checkForUpdate.mockReset().mockResolvedValue(undefined);
    state.startChecks.mockReset().mockReturnValue({ checkForUpdate: state.checkForUpdate, dispose: vi.fn() });
    window.sessionStorage.clear();
  });

  test('cleans legacy caches, registers the worker, and starts a forced update check', async () => {
    const cacheDelete = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'caches', { configurable: true, value: { delete: cacheDelete } });
    let controllerChange: (() => void) | null = null;
    const registration = { update: vi.fn(), installing: null, waiting: null };
    const register = vi.fn().mockResolvedValue(registration);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register,
        addEventListener: (_type: string, callback: () => void) => { controllerChange = callback; },
      },
    });

    const pwa = await import('../src/pwa');
    await flush();
    assert.deepEqual(cacheDelete.mock.calls[0], ['cover-images']);
    assert.deepEqual(register.mock.calls[0], ['/sw.js', { scope: '/', updateViaCache: 'none' }]);
    assert.deepEqual(state.startChecks.mock.calls[0], [{ registration }]);
    assert.deepEqual(state.checkForUpdate.mock.calls[0], [true]);
    assert.ok(controllerChange);

    window.sessionStorage.setItem('jm:preload-recovery:test', '1');
    const preloadError = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(preloadError);
    assert.equal(preloadError.defaultPrevented, true);
    assert.equal(window.sessionStorage.getItem('jm:preload-recovery:test'), '1');

    window.sessionStorage.removeItem('jm:preload-recovery:test');
    const reload = vi.fn();
    pwa.reloadPageOnce('jm:preload-recovery:test', reload);
    pwa.reloadPageOnce('jm:preload-recovery:test', reload);
    assert.equal(reload.mock.calls.length, 1);
  });

  test('reports registration and legacy cache failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { delete: vi.fn().mockRejectedValue(new Error('cache failed')) },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn().mockRejectedValue(new Error('register failed')),
        addEventListener: vi.fn(),
      },
    });
    await import('../src/pwa');
    await flush();
    assert.ok(error.mock.calls.some((call) => String(call[0]).includes('legacy cache')));
    assert.ok(error.mock.calls.some((call) => String(call[0]).includes('registration failed')));
  });

  test('stays inert when service workers and CacheStorage are unavailable', async () => {
    Reflect.deleteProperty(window, 'caches');
    Reflect.deleteProperty(navigator, 'serviceWorker');
    await import('../src/pwa');
    await flush();
    assert.equal(state.startChecks.mock.calls.length, 0);
  });
});

describe('browser PWA update environment', () => {
  test('adapts browser state, timers, and event subscriptions', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const environment = createBrowserPwaUpdateEnvironment();
    assert.equal(environment.isOnline(), false);
    assert.equal(environment.isVisible(), false);
    assert.equal(typeof environment.now(), 'number');

    const online = vi.fn();
    const visibility = vi.fn();
    const removeOnline = environment.onOnline(online);
    const removeVisibility = environment.onVisibilityChange(visibility);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(online.mock.calls.length, 1);
    assert.equal(visibility.mock.calls.length, 1);
    removeOnline();
    removeVisibility();

    const interval = environment.setInterval(vi.fn(), 1000);
    environment.clearInterval(interval);
  });

  test('uses the default error reporter', async () => {
    const { startPwaUpdateChecks } = await vi.importActual<typeof import('../src/pwa-update')>('../src/pwa-update');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registration = {
      installing: null,
      waiting: null,
      update: vi.fn().mockRejectedValue(new Error('update failed')),
    };
    const subscriptions: Array<() => void> = [];
    const environment = {
      now: () => 100,
      isOnline: () => true,
      isVisible: () => true,
      setInterval: () => 1,
      clearInterval: vi.fn(),
      onOnline: () => { const remove = vi.fn(); subscriptions.push(remove); return remove; },
      onVisibilityChange: () => { const remove = vi.fn(); subscriptions.push(remove); return remove; },
    };
    const controller = startPwaUpdateChecks({ registration, environment, minGapMs: 0 });
    await controller.checkForUpdate(true);
    assert.ok(error.mock.calls.some((call) => String(call[0]).includes('PWA update check failed')));
    controller.dispose();
    assert.equal(subscriptions.every((remove) => (remove as ReturnType<typeof vi.fn>).mock.calls.length === 1), true);
  });
});
