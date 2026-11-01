import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@nocobase/app-client';

interface AccountContext {
  readonly employeeId: string | null;
  readonly defaultCompanyId: string | null;
}

/**
 * The company on the signed-in account's employee record, if any. This is a
 * convenience default only: the route gate still checks it against the
 * companies the current module actually authorises.
 */
export function useAccountCompanyId(enabled: boolean) {
  const api = useApiClient();
  const query = useQuery({
    queryKey: ['accountContext'],
    enabled,
    queryFn: ({ signal }) =>
      api.request<{ data: AccountContext }>({
        path: 'account/context',
        signal,
      }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return {
    companyId: query.data?.data?.defaultCompanyId ?? null,
    isPending: query.isPending,
  };
}
