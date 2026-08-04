import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_THEME_PREFERENCES,
  getAccentColor,
  getLegacyThemeMode,
  LEGACY_THEME_STORAGE_KEY,
  loadThemePreferences,
  normalizeHexColor,
  parseThemePreferences,
  resolveThemeMode,
  saveThemePreferences,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type ThemePreferences,
  type ThemePresetId,
} from './theme';
import { ThemeContext, type ThemeContextValue } from './theme-context';
import { applyThemeToRoot } from './theme-dom';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<ThemePreferences>(() => loadThemePreferences(window.localStorage));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  const commitPreferences = useCallback((next: ThemePreferences) => {
    saveThemePreferences(window.localStorage, next);
    applyThemeToRoot(next, systemPrefersDark());
    setPreferences(next);
  }, []);

  const setMode = useCallback((mode: ThemeMode) => {
    commitPreferences({ ...preferences, mode });
  }, [commitPreferences, preferences]);

  const setPreset = useCallback((id: ThemePresetId) => {
    commitPreferences({ ...preferences, accent: { kind: 'preset', id } });
  }, [commitPreferences, preferences]);

  const setCustomAccent = useCallback((value: string) => {
    const color = normalizeHexColor(value);
    if (!color) return false;
    commitPreferences({ ...preferences, accent: { kind: 'custom', value: color } });
    return true;
  }, [commitPreferences, preferences]);

  const resetTheme = useCallback(() => {
    commitPreferences(DEFAULT_THEME_PREFERENCES);
  }, [commitPreferences]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
      applyThemeToRoot(preferences, event.matches);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preferences]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== LEGACY_THEME_STORAGE_KEY) return;
      const next = event.key === THEME_STORAGE_KEY
        ? parseThemePreferences(event.newValue, window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY))
        : {
            ...loadThemePreferences(window.localStorage),
            mode: getLegacyThemeMode(event.newValue),
          };
      if (event.key === LEGACY_THEME_STORAGE_KEY) {
        saveThemePreferences(window.localStorage, next);
      }
      applyThemeToRoot(next, systemPrefersDark());
      setPreferences(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    preferences,
    resolvedMode: resolveThemeMode(preferences.mode, systemDark),
    accentColor: getAccentColor(preferences.accent),
    setMode,
    setPreset,
    setCustomAccent,
    resetTheme,
  }), [preferences, resetTheme, setCustomAccent, setMode, setPreset, systemDark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
