import { useEffect, useSyncExternalStore } from 'react';

/**
 * The route owns the company endpoint; the shell only reads the declaration of
 * the page currently mounted. A small store avoids a second path table and
 * keeps the header usable outside a data router.
 */
type Snapshot = { path: string; endpoint: string | null };

let snapshot: Snapshot = { path: '', endpoint: null };
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function declareCompanyScope(path: string, endpoint: string): void {
  if (snapshot.path === path && snapshot.endpoint === endpoint) return;
  publish({ path, endpoint });
}

export function useDeclareCompanyScope(
  path: string,
  endpoint: string | undefined,
): void {
  useEffect(() => {
    if (endpoint) declareCompanyScope(path, endpoint);
  }, [endpoint, path]);
}

export function useCompanyScopeEndpoint(path: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (snapshot.path === path ? snapshot.endpoint : null),
    () => null,
  );
}
