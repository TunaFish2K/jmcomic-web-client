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
import {
  APP_ICON_PATH,
  createFaviconDataUrl,
  createFaviconSvg,
  ensureFaviconContrast,
  getFaviconPalette,
  updateFavicon,
} from '../src/theme/favicon';

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
    assert.equal(getAccentColor({ kind: 'preset', id: 'azure' }), '#018EEE');
    assert.equal(getAccentColor({ kind: 'custom', value: '#abc' }), '#AABBCC');
  });

  it('loads the azure preset from version 1 preferences', () => {
    assert.deepEqual(parseThemePreferences(JSON.stringify({
      version: 1,
      mode: 'system',
      accent: { kind: 'preset', id: 'azure' },
    })), {
      version: 1,
      mode: 'system',
      accent: { kind: 'preset', id: 'azure' },
    });
  });

  it('chooses an accessible foreground for presets and extreme custom colors', () => {
    const colors = [...THEME_PRESETS.map((preset) => preset.color), '#000000', '#FFFFFF', '#FFFF00'];
    for (const color of colors) {
      const foreground = getAccentForeground(color);
      assert.ok(getContrastRatio(color, foreground) >= 4.5, `${color} should contrast with ${foreground}`);
    }
  });

  it('uses the resolved theme as the favicon background', () => {
    assert.equal(getFaviconPalette('#00DD99', 'light').backgroundColor, '#FFFFFF');
    assert.equal(getFaviconPalette('#00DD99', 'dark').backgroundColor, '#000000');
  });

  it('keeps contrasting favicon accents and adjusts only when needed', () => {
    assert.equal(ensureFaviconContrast('#00DD99', '#000000'), '#00DD99');

    const lightMark = ensureFaviconContrast('#00DD99', '#FFFFFF');
    const darkMark = ensureFaviconContrast('#001122', '#000000');
    assert.notEqual(lightMark, '#00DD99');
    assert.notEqual(darkMark, '#001122');
    assert.ok(getContrastRatio(lightMark, '#FFFFFF') >= 4.5);
    assert.ok(getContrastRatio(darkMark, '#000000') >= 4.5);
  });

  it('creates a data URL with the fixed geometric mark', () => {
    const svg = createFaviconSvg('#E85D75', 'dark');
    assert.match(svg, new RegExp(APP_ICON_PATH));
    assert.match(svg, /fill="#000000"/);
    assert.ok(createFaviconDataUrl('#E85D75', 'dark').startsWith('data:image/svg+xml,'));
  });

  it('updates the favicon link when the active theme changes', () => {
    let href = '';
    const documentNode = {
      getElementById: () => ({
        setAttribute: (name: string, value: string) => {
          if (name === 'href') href = value;
        },
      }),
    } as unknown as Document;

    updateFavicon(documentNode, '#00DD99', 'light');
    assert.match(decodeURIComponent(href), /fill="#FFFFFF"/);
    assert.match(decodeURIComponent(href), /fill="#00(?:[0-9A-F]{4})"/);
  });
});
