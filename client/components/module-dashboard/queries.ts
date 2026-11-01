import { useApiClient } from '@nocobase/app-client';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';

type DashboardQuery = Record<string, string | number>;
type CountResponse = { meta?: { total?: number } };
type ListEnvelope<T> = { data: T[] | { data: T[] } };

/** Countable records behind a module dashboard, independent of the page that renders them. */
const keyFor = (module: string, ...parts: unknown[]) => [
  'moduleDashboard',
  module,
  ...parts,
];

/**
 * Count records through the module's own list endpoint. The endpoint applies
 * the signed-in account's data scope, so a dashboard never widens access.
 */
export function useDashboardCount(
  module: string,
  key: string,
  path: string,
  query: DashboardQuery = {},
  enabled = true,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: keyFor(module, 'count', key, path, query),
    queryFn: ({ signal }) =>
      api.request<CountResponse>({
        path,
        query: { ...query, page: 1, pageSize: 1 },
        signal,
      }),
    select: (payload) => payload.meta?.total ?? 0,
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Read the most recent records of one list. `nested` covers the production
 * endpoints whose body is `{ data: { data, meta } }`.
 */
export function useDashboardList<T>(
  module: string,
  key: string,
  path: string,
  query: DashboardQuery = {},
  enabled = true,
  shape: 'flat' | 'nested' = 'flat',
) {
  const api = useApiClient();
  return useQuery({
    queryKey: keyFor(module, 'list', key, path, query, shape),
    queryFn: async ({ signal }) => {
      const payload = await api.request<ListEnvelope<T>>({
        path,
        query: { ...query, page: 1, pageSize: 5 },
        signal,
      });
      return shape === 'nested'
        ? (payload.data as { data: T[] }).data
        : (payload.data as T[]);
    },
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Refresh every card of a dashboard in one pass. */
export function useDashboardRefresh() {
  const client = useQueryClient();
  const busy = useIsFetching({ queryKey: ['moduleDashboard'] }) > 0;
  return {
    busy,
    refresh: () =>
      void client.invalidateQueries({ queryKey: ['moduleDashboard'] }),
  };
}
