import {
  getAccentColor,
  getAccentForeground,
  migrateThemePreferences,
  resolveThemeMode,
  type ThemePreferences,
} from './theme';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyThemeToRoot(preferences: ThemePreferences, systemDark = systemPrefersDark()) {
  const root = document.documentElement;
  const resolvedMode = resolveThemeMode(preferences.mode, systemDark);
  const accentColor = getAccentColor(preferences.accent);
  root.classList.toggle('dark', resolvedMode === 'dark');
  root.dataset.themeMode = preferences.mode;
  root.dataset.resolvedTheme = resolvedMode;
  root.dataset.accent = preferences.accent.kind === 'preset' ? preferences.accent.id : 'custom';
  root.style.setProperty('--theme-accent', accentColor);
  root.style.setProperty('--theme-accent-foreground', getAccentForeground(accentColor));
  return resolvedMode;
}

export function initializeTheme() {
  const preferences = migrateThemePreferences(window.localStorage);
  applyThemeToRoot(preferences);
  return preferences;
}
