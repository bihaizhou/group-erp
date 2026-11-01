import { useApiClient, ApiClientError } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Career, Kind, Options, Row } from './model.js';

export function usePeopleCan(kind: Kind, action = 'update') {
  return useCan({
    resource: { type: 'composite', id: `people.${kind}` },
    action,
  }).can;
}
export function usePeopleOptions(kind: Kind) {
  const api = useApiClient();
  return useQuery({
    retry: false,
    queryKey: ['people-options', kind],
    queryFn: ({ signal }) =>
      api.request<{
        data: Options;
        meta?: { businessDate: string; timeZone: string };
      }>({
        path: 'people/options',
        query: { kind },
        signal,
      }),
  });
}
export function usePeopleRecord(kind: Kind, id: string | undefined) {
  const api = useApiClient(),
    cache = useQueryClient();
  return useQuery({
    retry: false,
    queryKey: ['people-record', kind, id],
    enabled: Boolean(id),
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      try {
        return await api.request<{ data: Row }>({
          path: `people/${kind}/${id}`,
          signal,
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404)
          void cache.invalidateQueries({ queryKey: ['people-list', kind] });
        throw error;
      }
    },
  });
}
export function usePeopleCareer(personId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    retry: false,
    queryKey: ['people-career', personId],
    enabled: Boolean(personId),
    queryFn: ({ signal }) =>
      api.request<{ data: Career }>({
        path: `people/employees/${personId}/career`,
        signal,
      }),
  });
}
export function usePeopleError() {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (error instanceof ApiClientError) {
      if (
        error.reason &&
        t(`people.errors.${error.reason}`, { defaultValue: '' })
      )
        return t(`people.errors.${error.reason}`);
      if (error.status === 401) return t('people.sessionEnded');
      if (error.status === 403) return t('people.forbidden');
      if (error.status === 404) return t('people.notFound');
      if (error.status === 409) return t('people.conflict');
    }
    return t('people.requestFailed');
  };
}
export function usePeopleRefresh() {
  const cache = useQueryClient();
  return async (row?: Row, kind?: Kind) => {
    if (row && kind) {
      cache.setQueryData(['people-record', kind, row.id], { data: row });
      // Mutation responses are compact rows. Reload workflow actions/history and derived staffing before returning.
      await cache.invalidateQueries({
        queryKey: ['people-record', kind, row.id],
        refetchType: 'all',
      });
    }
    await Promise.all(
      [
        'people-list',
        'people-options',
        'people-overview',
        'people-talent',
        'people-history',
        'people-career',
      ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    );
  };
}
