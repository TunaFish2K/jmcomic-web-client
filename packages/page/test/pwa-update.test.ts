import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
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
  intervals = new Map<number, () => void>();
  onlineListeners = new Set<() => void>();
  visibilityListeners = new Set<() => void>();
  private nextIntervalId = 1;

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
  updateImplementation: () => Promise<unknown> = async () => undefined;

  async update() {
    this.updateCalls++;
    return this.updateImplementation();
  }
}

function flushAsyncWork() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe('PWA update checks', () => {
  it('checks the registration after the minimum gap', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    const controller = startPwaUpdateChecks({ registration, environment });

    await controller.checkForUpdate();
    assert.equal(registration.updateCalls, 0);

    environment.advance(PWA_UPDATE_MIN_GAP_MS);
    await controller.checkForUpdate();

    assert.equal(registration.updateCalls, 1);
  });

  it('checks when connectivity returns and when a visible app resumes', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    startPwaUpdateChecks({ registration, environment });

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

    assert.equal(registration.updateCalls, 0);
  });

  it('coalesces concurrent checks and reports recoverable errors', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    const errors: unknown[] = [];
    let resolveUpdate: (() => void) | undefined;
    registration.updateImplementation = () => new Promise((resolve) => {
      resolveUpdate = resolve;
    });
    const controller = startPwaUpdateChecks({
      registration,
      environment,
      onError: (error) => errors.push(error),
    });

    const first = controller.checkForUpdate(true);
    const second = controller.checkForUpdate(true);
    assert.equal(registration.updateCalls, 1);
    resolveUpdate?.();
    await Promise.all([first, second]);
    assert.equal(registration.updateCalls, 1);

    registration.updateImplementation = async () => {
      throw new Error('offline');
    };
    await controller.checkForUpdate(true);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /offline/);
  });

  it('stops timers and listeners when disposed', async () => {
    const environment = new FakeUpdateEnvironment();
    const registration = new FakeUpdateRegistration();
    const controller = startPwaUpdateChecks({ registration, environment });

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
    assert.equal(registration.updateCalls, 0);
  });
});
