import { createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = 'light' | 'dark';

export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

const isMode = (value: unknown): value is ThemeMode =>
  typeof value === 'string' && (THEME_MODES as string[]).includes(value);

export const colorSchemeQuery = () =>
  window.matchMedia('(prefers-color-scheme: dark)');

export const readStoredMode = (storageKey: string): ThemeMode | null => {
  try {
    const value = localStorage.getItem(storageKey);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
};

export const applyResolved = (resolved: ResolvedThemeMode): void => {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
};

export interface ThemeModeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  resolvedTheme: ResolvedThemeMode;
  systemTheme: ResolvedThemeMode;
  themes: ThemeMode[];
}

export const ThemeModeContext = createContext<ThemeModeContextValue | null>(
  null,
);

export function useTheme(): ThemeModeContextValue {
  const value = useContext(ThemeModeContext);
  if (!value) throw new Error('useTheme requires ThemeModeProvider');
  return value;
}
