import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  getAutoSnap,
  getSeamlessMode,
  saveAutoSnap,
  saveSeamlessMode,
} from '../src/reader/reader-store';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

describe('reader setting storage', () => {
  beforeEach(() => localStorage.clear());

  it('does not change auto snap when seamless mode is disabled', () => {
    saveAutoSnap(true);
    saveSeamlessMode(true);
    saveSeamlessMode(false);

    assert.equal(getAutoSnap(), true);
    assert.equal(getSeamlessMode(), false);
  });

  it('does not change seamless mode when auto snap is toggled', () => {
    saveSeamlessMode(true);
    saveAutoSnap(false);

    assert.equal(getSeamlessMode(), true);
    assert.equal(getAutoSnap(), false);
  });
});
