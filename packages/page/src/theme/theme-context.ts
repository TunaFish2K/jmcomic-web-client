import { createContext, useContext } from 'react';
import type { ResolvedThemeMode, ThemeMode, ThemePreferences, ThemePresetId } from './theme';

export type ThemeContextValue = {
  preferences: ThemePreferences;
  resolvedMode: ResolvedThemeMode;
  accentColor: string;
  setMode: (mode: ThemeMode) => void;
  setPreset: (id: ThemePresetId) => void;
  setCustomAccent: (value: string) => boolean;
  resetTheme: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
