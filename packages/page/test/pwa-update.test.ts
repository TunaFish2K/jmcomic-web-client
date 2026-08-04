import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PWA_UPDATE_MIN_GAP_MS,
  startPwaUpdateChecks,
  type PwaUpdateEnvironment,
  type PwaUpdateRegistration,
} from '../src/pwa-update';

class FakeUpdateEnvironment implements PwaUpdateEnvironment {
  currentTime = 0;
  online = true;
  visible = true;
  fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  fetchImplementation: PwaUpdateEnvironment['fetch'] = async () => new Response(null, { status: 200 });
  intervals = new Map<number, () => void>();
  onlineListeners = new Set<() => void>();
  visibilityListeners = new Set<() => void>();
  private nextIntervalId = 1;

  fetch(input: RequestInfo | URL, init?: RequestInit) {
    this.fetchCalls.push({ input, init });
    return this.fetchImplementation(input, init);
  }

  now() {
    return this.currentTime;
  }

  isOnline() {
    return this.online;
  }

  isVisible() {
    return this.visible;
  }

  setInterval(callback: () => void) {
    const intervalId = this.nextIntervalId++;
    this.intervals.set(intervalId, callback);
    return intervalId;
  }

  clearInterval(intervalId: number) {
    this.intervals.delete(intervalId);
  }

  onOnline(callback: () => void) {
    this.onlineListeners.add(callback);
    return () => this.onlineListeners.delete(callback);
  }

  onVisibilityChange(callback: () => void) {
    this.visibilityListeners.add(callback);
    return () => this.visibilityListeners.delete(callback);
  }

  advance(milliseconds: number) {
    this.currentTime += milliseconds;
  }

  emitOnline() {
    for (const listener of this.onlineListeners) listener();
  }

  emitVisibilityChange() {
    for (const listener of this.visibilityListeners) listener();
  }

  emitInterval() {
    for (const callback of this.intervals.values()) callback();
  }
}

class FakeUpdateRegistration implements PwaUpdateRegistration {
  installing: ServiceWorker | null = null;
  waiting: ServiceWorker | null = null;
  updateCalls = 0;

  async update() {
    this.updateCalls++;
  }
}

function flushAsyncWork() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe('PWA update checks', () => {
  it('checks with a fresh request after the minimum gap', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    const controller = startPwaUpdateChecks({ swUrl: '/sw.js', registration, environment });

    await controller.checkForUpdate();
    assert.equal(environment.fetchCalls.length, 0);

    environment.advance(PWA_UPDATE_MIN_GAP_MS);
    await controller.checkForUpdate();

    assert.equal(environment.fetchCalls.length, 1);
    assert.equal(environment.fetchCalls[0].input, '/sw.js');
    assert.equal(environment.fetchCalls[0].init?.cache, 'no-store');
    assert.deepEqual(environment.fetchCalls[0].init?.headers, {
      cache: 'no-store',
      'cache-control': 'no-cache',
    });
    assert.equal(registration.updateCalls, 1);
  });

  it('checks when connectivity returns and when a visible app resumes', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    startPwaUpdateChecks({ swUrl: '/sw.js', registration, environment });

    environment.emitOnline();
    await flushAsyncWork();
    assert.equal(registration.updateCalls, 1);

    environment.advance(PWA_UPDATE_MIN_GAP_MS);
    environment.visible = false;
    environment.emitVisibilityChange();
    await flushAsyncWork();
    assert.equal(registration.updateCalls, 1);

    environment.visible = true;
    environment.emitVisibilityChange();
    await flushAsyncWork();
    assert.equal(registration.updateCalls, 2);
  });

  it('skips checks while offline, hidden, installing, or waiting', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    const controller = startPwaUpdateChecks({
      swUrl: '/sw.js',
      registration,
      environment,
      minGapMs: 0,
    });

    environment.online = false;
    await controller.checkForUpdate(true);

    environment.online = true;
    environment.visible = false;
    environment.emitInterval();

    registration.installing = {} as ServiceWorker;
    await controller.checkForUpdate(true);
    registration.installing = null;
    registration.waiting = {} as ServiceWorker;
    await controller.checkForUpdate(true);

    assert.equal(environment.fetchCalls.length, 0);
    assert.equal(registration.updateCalls, 0);
  });

  it('coalesces concurrent checks and reports recoverable errors', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    const errors: unknown[] = [];
    let resolveFetch: ((response: Response) => void) | undefined;
    environment.fetchImplementation = () => new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const controller = startPwaUpdateChecks({
      swUrl: '/sw.js',
      registration,
      environment,
      onError: (error) => errors.push(error),
    });

    const first = controller.checkForUpdate(true);
    const second = controller.checkForUpdate(true);
    assert.equal(environment.fetchCalls.length, 1);
    resolveFetch?.(new Response(null, { status: 200 }));
    await Promise.all([first, second]);
    assert.equal(registration.updateCalls, 1);

    environment.fetchImplementation = async () => {
      throw new Error('offline');
    };
    await controller.checkForUpdate(true);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /offline/);
  });

  it('stops timers and listeners when disposed', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    const controller = startPwaUpdateChecks({ swUrl: '/sw.js', registration, environment });

    controller.dispose();
    controller.dispose();
    environment.emitOnline();
    environment.emitVisibilityChange();
    environment.emitInterval();
    await controller.checkForUpdate(true);
    await flushAsyncWork();

    assert.equal(environment.intervals.size, 0);
    assert.equal(environment.onlineListeners.size, 0);
    assert.equal(environment.visibilityListeners.size, 0);
    assert.equal(environment.fetchCalls.length, 0);
  });
});
