/*
 * Shared jsdom globals for client-side logic tests.
 */
/**
 * jsdom in this toolchain does not implement Storage or matchMedia. Several
 * client modules touch them at import time (theme boot) or from components
 * (media queries), so a missing global surfaces as a red suite on any Node
 * version whose jsdom build omits them. Provide minimal, per-file instances.
 */
export function ensureDomGlobals(): void {
  if (typeof window === 'undefined') return;
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        get length() {
          return store.size;
        },
        key: (index: number) => [...store.keys()][index] ?? null,
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, String(value));
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      },
    });
  }
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
}

ensureDomGlobals();
