import { useEffect, useSyncExternalStore } from 'react';

/**
 * The route owns the company endpoint and whether the company is locked; the
 * shell only reads the declaration of the page currently mounted. A small
 * store avoids a second path table and keeps the header usable outside a data
 * router.
 */
type Snapshot = { path: string; endpoint: string | null; locked: boolean };

let snapshot: Snapshot = { path: '', endpoint: null, locked: false };
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function declareCompanyScope(
  path: string,
  endpoint: string,
  locked: boolean,
): void {
  if (
    snapshot.path === path &&
    snapshot.endpoint === endpoint &&
    snapshot.locked === locked
  )
    return;
  publish({ path, endpoint, locked });
}

export function useDeclareCompanyScope(
  path: string,
  endpoint: string | undefined,
  locked: boolean,
): void {
  useEffect(() => {
    if (endpoint) declareCompanyScope(path, endpoint, locked);
  }, [endpoint, locked, path]);
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

export function useCompanyLock(path: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot.path === path && snapshot.locked,
    () => false,
  );
}
