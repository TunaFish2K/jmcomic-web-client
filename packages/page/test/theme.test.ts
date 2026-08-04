import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_THEME_PREFERENCES,
  getAccentColor,
  getAccentForeground,
  getContrastRatio,
  getLegacyThemeMode,
  LEGACY_THEME_STORAGE_KEY,
  loadThemePreferences,
  migrateThemePreferences,
  normalizeHexColor,
  parseThemePreferences,
  resolveThemeMode,
  saveThemePreferences,
  THEME_PRESETS,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from '../src/theme/theme';

class MemoryStorage implements ThemeStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('theme preferences', () => {
  it('normalizes supported hexadecimal colors', () => {
    assert.equal(normalizeHexColor('#0a9'), '#00AA99');
    assert.equal(normalizeHexColor('e85d75'), '#E85D75');
    assert.equal(normalizeHexColor('#xyzxyz'), null);
  });

  it('migrates the legacy light and dark preference', () => {
    assert.deepEqual(parseThemePreferences(null, 'dark'), {
      ...DEFAULT_THEME_PREFERENCES,
      mode: 'dark',
    });
    assert.equal(parseThemePreferences(null, 'unknown').mode, 'system');

    const storage = new MemoryStorage();
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark');
    assert.equal(migrateThemePreferences(storage).mode, 'dark');
    assert.ok(storage.getItem(THEME_STORAGE_KEY));
  });

  it('keeps valid fields and falls back for damaged fields', () => {
    const preferences = parseThemePreferences(JSON.stringify({
      version: 1,
      mode: 'light',
      accent: { kind: 'custom', value: '#abc' },
    }));
    assert.deepEqual(preferences, {
      version: 1,
      mode: 'light',
      accent: { kind: 'custom', value: '#AABBCC' },
    });

    const damaged = parseThemePreferences('{broken', 'dark');
    assert.equal(damaged.mode, 'dark');
    assert.deepEqual(damaged.accent, DEFAULT_THEME_PREFERENCES.accent);
  });

  it('rejects unknown storage versions and parses legacy changes', () => {
    const future = parseThemePreferences(JSON.stringify({
      version: 2,
      mode: 'light',
      accent: { kind: 'custom', value: '#123456' },
    }), 'dark');
    assert.deepEqual(future, {
      ...DEFAULT_THEME_PREFERENCES,
      mode: 'dark',
    });
    assert.equal(getLegacyThemeMode('light'), 'light');
    assert.equal(getLegacyThemeMode(null), 'system');
  });

  it('persists the versioned preference and mirrors the legacy mode', () => {
    const storage = new MemoryStorage();
    const dark = { ...DEFAULT_THEME_PREFERENCES, mode: 'dark' as const };
    saveThemePreferences(storage, dark);
    assert.equal(storage.getItem(LEGACY_THEME_STORAGE_KEY), 'dark');
    assert.deepEqual(loadThemePreferences(storage), dark);

    saveThemePreferences(storage, DEFAULT_THEME_PREFERENCES);
    assert.equal(storage.getItem(LEGACY_THEME_STORAGE_KEY), null);
    assert.ok(storage.getItem(THEME_STORAGE_KEY));
  });

  it('resolves system mode without changing explicit modes', () => {
    assert.equal(resolveThemeMode('system', true), 'dark');
    assert.equal(resolveThemeMode('system', false), 'light');
    assert.equal(resolveThemeMode('light', true), 'light');
  });

  it('resolves preset and custom accent colors', () => {
    assert.equal(getAccentColor({ kind: 'preset', id: 'jade' }), '#00DD99');
    assert.equal(getAccentColor({ kind: 'custom', value: '#abc' }), '#AABBCC');
  });

  it('chooses an accessible foreground for presets and extreme custom colors', () => {
    const colors = [...THEME_PRESETS.map((preset) => preset.color), '#000000', '#FFFFFF', '#FFFF00'];
    for (const color of colors) {
      const foreground = getAccentForeground(color);
      assert.ok(getContrastRatio(color, foreground) >= 4.5, `${color} should contrast with ${foreground}`);
    }
  });
});
