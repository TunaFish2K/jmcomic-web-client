export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

export const THEME_STORAGE_KEY = 'theme-preferences:v1';
export const LEGACY_THEME_STORAGE_KEY = 'theme';

export const THEME_PRESETS = [
  { id: 'jade', label: '翠绿', color: '#00DD99' },
  { id: 'coral', label: '珊瑚', color: '#E85D75' },
  { id: 'amber', label: '琥珀', color: '#D68A00' },
  { id: 'cyan', label: '青蓝', color: '#0EA5B7' },
  { id: 'indigo', label: '靛青', color: '#5B6EE1' },
] as const;

export type ThemePresetId = (typeof THEME_PRESETS)[number]['id'];
export type AccentChoice =
  | { kind: 'preset'; id: ThemePresetId }
  | { kind: 'custom'; value: string };

export type ThemePreferences = {
  version: 1;
  mode: ThemeMode;
  accent: AccentChoice;
};

export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  version: 1,
  mode: 'system',
  accent: { kind: 'preset', id: 'jade' },
};

const THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'system']);
const THEME_PRESET_IDS = new Set<string>(THEME_PRESETS.map((preset) => preset.id));

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  const short = normalized.match(/^#?([0-9A-F]{3})$/);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const full = normalized.match(/^#?([0-9A-F]{6})$/);
  return full ? `#${full[1]}` : null;
}

export function getLegacyThemeMode(value: string | null): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function parseAccentChoice(value: unknown): AccentChoice | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AccentChoice> & { id?: unknown; value?: unknown };
  if (candidate.kind === 'preset' && typeof candidate.id === 'string' && THEME_PRESET_IDS.has(candidate.id)) {
    return { kind: 'preset', id: candidate.id as ThemePresetId };
  }
  if (candidate.kind === 'custom' && typeof candidate.value === 'string') {
    const color = normalizeHexColor(candidate.value);
    if (color) return { kind: 'custom', value: color };
  }
  return null;
}

export function parseThemePreferences(raw: string | null, legacyTheme: string | null = null): ThemePreferences {
  const fallbackMode = getLegacyThemeMode(legacyTheme);
  if (!raw) return { ...DEFAULT_THEME_PREFERENCES, mode: fallbackMode };

  try {
    const parsed = JSON.parse(raw) as Partial<ThemePreferences>;
    if (parsed.version !== 1) {
      return { ...DEFAULT_THEME_PREFERENCES, mode: fallbackMode };
    }
    const mode = typeof parsed.mode === 'string' && THEME_MODES.has(parsed.mode as ThemeMode)
      ? parsed.mode as ThemeMode
      : fallbackMode;
    const accent = parseAccentChoice(parsed.accent) ?? DEFAULT_THEME_PREFERENCES.accent;
    return { version: 1, mode, accent };
  } catch {
    return { ...DEFAULT_THEME_PREFERENCES, mode: fallbackMode };
  }
}

export function loadThemePreferences(storage: ThemeStorage): ThemePreferences {
  try {
    return parseThemePreferences(
      storage.getItem(THEME_STORAGE_KEY),
      storage.getItem(LEGACY_THEME_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function saveThemePreferences(storage: ThemeStorage, preferences: ThemePreferences) {
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify(preferences));
    if (preferences.mode === 'system') {
      storage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } else {
      storage.setItem(LEGACY_THEME_STORAGE_KEY, preferences.mode);
    }
  } catch {
    // The active theme still works when browser storage is unavailable.
  }
}

export function migrateThemePreferences(storage: ThemeStorage): ThemePreferences {
  const preferences = loadThemePreferences(storage);
  try {
    if (storage.getItem(THEME_STORAGE_KEY) === null) {
      saveThemePreferences(storage, preferences);
    }
  } catch {
    // Reading the active theme must not depend on storage availability.
  }
  return preferences;
}

export function getAccentColor(accent: AccentChoice): string {
  if (accent.kind === 'custom') {
    return normalizeHexColor(accent.value) ?? THEME_PRESETS[0].color;
  }
  return THEME_PRESETS.find((preset) => preset.id === accent.id)?.color ?? THEME_PRESETS[0].color;
}

export function resolveThemeMode(mode: ThemeMode, systemDark: boolean): ResolvedThemeMode {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}

function toLinearChannel(channel: number) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function getRelativeLuminance(hexColor: string) {
  const color = normalizeHexColor(hexColor) ?? '#000000';
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return 0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b);
}

export function getContrastRatio(first: string, second: string) {
  const lighter = Math.max(getRelativeLuminance(first), getRelativeLuminance(second));
  const darker = Math.min(getRelativeLuminance(first), getRelativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function getAccentForeground(accentColor: string): '#000000' | '#FFFFFF' {
  return getContrastRatio(accentColor, '#000000') >= getContrastRatio(accentColor, '#FFFFFF')
    ? '#000000'
    : '#FFFFFF';
}
