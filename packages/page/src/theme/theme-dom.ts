import {
  getAccentColor,
  getAccentForeground,
  getThemeStorage,
  migrateThemePreferences,
  resolveThemeMode,
  type ThemePreferences,
} from './theme';
import { updateFavicon } from './favicon';

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
  root.style.colorScheme = resolvedMode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content', resolvedMode === 'dark' ? '#0c0a09' : '#f5f5f4',
  );
  root.dataset.accent = preferences.accent.kind === 'preset' ? preferences.accent.id : 'custom';
  root.style.setProperty('--theme-accent', accentColor);
  root.style.setProperty('--theme-accent-foreground', getAccentForeground(accentColor));
  updateFavicon(document, accentColor, resolvedMode);
  return resolvedMode;
}

export function initializeTheme() {
  const preferences = migrateThemePreferences(getThemeStorage());
  applyThemeToRoot(preferences);
  return preferences;
}
