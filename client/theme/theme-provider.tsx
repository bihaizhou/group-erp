import { PresetContext } from './theme-context';
import { resolveAppBase } from '@nocobase/app-client';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { ThemeModeProvider } from './theme-mode-provider';
import type { ThemeMode } from './theme-mode';
import {
  readThemeDefaults,
  readThemePreference,
  themeStorageKeys,
} from './theme-preferences';
import { themePresets, type ThemePresetId } from './theme-presets';

const validPreset = (
  value: string | null,
  fallback: ThemePresetId,
): ThemePresetId =>
  themePresets.find((item) => item.id === value)?.id ?? fallback;

function ModeStorageSync({
  storageKey,
  defaultTheme,
}: {
  storageKey: string;
  defaultTheme: string;
}): null {
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (
        event.key === null ||
        (event.key === storageKey &&
          event.newValue !== defaultTheme &&
          !['light', 'dark', 'system'].includes(event.newValue ?? ''))
      ) {
        // Consume invalid mode events before the mode provider persists its fallback.
        // Re-dispatch a valid value for its state-only synchronization path.
        // Let clear events through so the preset listener also resets.
        if (event.key === storageKey) event.stopImmediatePropagation();
        queueMicrotask(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: storageKey,
              newValue: defaultTheme,
            }),
          );
        });
      }
    };
    window.addEventListener('storage', sync, true);
    return () => window.removeEventListener('storage', sync, true);
  }, [defaultTheme, storageKey]);
  return null;
}

interface AppThemeProviderProps {
  children?: ReactNode;
  defaultTheme?: ThemeMode;
  enableSystem?: boolean;
  forcedTheme?: ThemeMode;
  storageKey?: string;
}

export function AppThemeProvider({
  children,
  defaultTheme,
  enableSystem = true,
  forcedTheme,
  storageKey = themeStorageKeys(resolveAppBase()).mode,
}: AppThemeProviderProps): ReactElement {
  const [defaults] = useState(() =>
    readThemeDefaults(themePresets.map(({ id }) => id)),
  );
  const mode = defaultTheme ?? (defaults.mode as ThemeMode);
  const fallbackPreset = defaults.preset as ThemePresetId;
  const presetKey = themeStorageKeys(resolveAppBase()).preset;
  const [preset, setPreset] = useState(() =>
    validPreset(readThemePreference(presetKey), fallbackPreset),
  );
  const selectPreset = (value: ThemePresetId) => {
    setPreset(value);
    try {
      localStorage.setItem(presetKey, value);
    } catch {
      /* Keep the in-memory selection. */
    }
  };
  useEffect(() => {
    document.documentElement.dataset.theme = preset;
  }, [preset]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === presetKey || event.key === null)
        setPreset(validPreset(event.newValue, fallbackPreset));
    };
    window.addEventListener('storage', sync, true);
    return () => window.removeEventListener('storage', sync, true);
  }, [presetKey, fallbackPreset]);
  return (
    <ThemeModeProvider
      defaultTheme={mode}
      enableSystem={enableSystem}
      forcedTheme={forcedTheme}
      storageKey={storageKey}
    >
      <ModeStorageSync storageKey={storageKey} defaultTheme={mode} />
      <PresetContext.Provider value={{ preset, setPreset: selectPreset }}>
        {children}
      </PresetContext.Provider>
    </ThemeModeProvider>
  );
}
