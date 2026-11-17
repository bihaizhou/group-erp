import { useApiClient, type ApiClient } from '@nocobase/app-client';
import type { AuthorizationOptionsResponse } from '@nocobase/app-plugin-authorization/client';
import { useQuery, type QueryClient } from '@tanstack/react-query';

/**
 * The authorization workspace catalogue is derived from the app's route and
 * collection registry, so it only changes when the app is rebuilt or restarted.
 * The response is large (~1.5 MB) and the server rebuilds it on every request,
 * which makes a cold role-editor visit wait for it. Keep it in the query cache
 * and in session storage so reloads and in-app navigation reuse the response
 * while a background refresh happens once it goes stale.
 */
export const authorizationOptionsKey = ['authorization-options'] as const;
const optionsStaleTime = 5 * 60_000;
const storageKey = 'authorization-options:v1';
const maxCacheAge = 24 * 60 * 60_000;

type OptionsPayload = { data: AuthorizationOptionsResponse };
type CachedOptions = { data: OptionsPayload; savedAt: number };

let cached: CachedOptions | undefined;
let cacheRead = false;

function readCache(): CachedOptions | undefined {
  if (cacheRead) return cached;
  cacheRead = true;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CachedOptions;
    if (Date.now() - entry.savedAt > maxCacheAge) return undefined;
    cached = entry;
  } catch {
    cached = undefined;
  }
  return cached;
}

function writeCache(data: OptionsPayload): void {
  const entry = { data, savedAt: Date.now() };
  cached = entry;
  cacheRead = true;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entry));
  } catch {
    // Quota or privacy mode: the in-memory cache still covers this session.
  }
}

export function authorizationOptionsQuery(api: ApiClient) {
  const stored = readCache();
  return {
    queryKey: authorizationOptionsKey,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const data = await api.request<OptionsPayload>({
        path: 'authorization/permissionSets/options',
        signal,
      });
      writeCache(data);
      return data;
    },
    initialData: stored?.data,
    initialDataUpdatedAt: stored?.savedAt,
    staleTime: optionsStaleTime,
    gcTime: 30 * 60_000,
    retry: false,
  };
}

export function useAuthorizationOptions() {
  const api = useApiClient();
  return useQuery(authorizationOptionsQuery(api));
}

/** Warm the catalogue while the roles list is visible so opening a role is instant. */
export function prefetchAuthorizationOptions(
  queryClient: QueryClient,
  api: ApiClient,
) {
  void queryClient.prefetchQuery(authorizationOptionsQuery(api));
}
