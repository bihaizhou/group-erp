import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@nocobase/app-client';

export type FieldAccess = 'hidden' | 'visible' | 'readonly' | 'write';

interface FieldPoliciesResponse {
  data: {
    policies: { resource: string; field: string; access: FieldAccess }[];
  };
}

const defaultAccess = (): FieldAccess => 'write';

/**
 * The signed-in account's field policies, loaded once per page. Fields without
 * a policy stay writable; pages opt in by asking for the ones they render.
 */
export function useFieldAccess() {
  const api = useApiClient();
  const query = useQuery({
    retry: false,
    staleTime: 60_000,
    queryKey: ['field-policies'],
    queryFn: ({ signal }) =>
      api.request<FieldPoliciesResponse>({
        path: 'field-policies/effective',
        signal,
      }),
  });
  const policies = query.data?.data.policies;
  return {
    isLoading: query.isPending,
    access(resource: string, field: string): FieldAccess {
      const row = policies?.find(
        (policy) => policy.resource === resource && policy.field === field,
      );
      return row?.access ?? defaultAccess();
    },
  };
}
