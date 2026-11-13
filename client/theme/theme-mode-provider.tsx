import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ThemeModeContext,
  applyResolved,
  colorSchemeQuery,
  readStoredMode,
  THEME_MODES,
  type ResolvedThemeMode,
  type ThemeMode,
  type ThemeModeContextValue,
} from './theme-mode';

interface ThemeModeProviderProps {
  children?: ReactNode;
  storageKey: string;
  defaultTheme?: ThemeMode;
  enableSystem?: boolean;
  forcedTheme?: ThemeMode;
}

/**
 * Minimal replacement for next-themes: the same `{theme, setTheme}` API
 * without rendering a `<script>` element inside the React tree (React never
 * executes it, and React 19 logs an error for it on every render).
 * Applies the resolved mode to the `<html>` class attribute and keeps the
 * state in sync with the system preference and other tabs.
 */
export function ThemeModeProvider({
  children,
  storageKey,
  defaultTheme = 'system',
  enableSystem = true,
  forcedTheme,
}: ThemeModeProviderProps): ReactElement {
  const [themeState, setThemeState] = useState<ThemeMode>(
    () => forcedTheme ?? readStoredMode(storageKey) ?? defaultTheme,
  );
  const [systemDark, setSystemDark] = useState<boolean>(
    () => enableSystem && colorSchemeQuery().matches,
  );

  useEffect(() => {
    if (!enableSystem) return;
    const query = colorSchemeQuery();
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [enableSystem]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setThemeState(
        forcedTheme ?? (isMode(event.newValue) ? event.newValue : defaultTheme),
      );
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey, defaultTheme, forcedTheme]);

  const mode = forcedTheme ?? themeState;
  const resolvedTheme: ResolvedThemeMode =
    mode === 'system'
      ? enableSystem
        ? systemDark
          ? 'dark'
          : 'light'
        : defaultTheme === 'dark'
          ? 'dark'
          : 'light'
      : mode;

  useEffect(() => {
    applyResolved(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: ThemeMode) => {
      if (forcedTheme) return;
      setThemeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* Keep the in-memory selection. */
      }
      applyResolved(
        next === 'system'
          ? enableSystem
            ? colorSchemeQuery().matches
              ? 'dark'
              : 'light'
            : defaultTheme === 'dark'
              ? 'dark'
              : 'light'
          : next,
      );
    },
    [forcedTheme, storageKey, enableSystem, defaultTheme],
  );

  const value = useMemo<ThemeModeContextValue>(
    () => ({
      theme: mode,
      setTheme,
      resolvedTheme,
      systemTheme: systemDark ? 'dark' : 'light',
      themes: THEME_MODES,
    }),
    [mode, setTheme, resolvedTheme, systemDark],
  );

  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
}

function isMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as string[]).includes(value);
}
