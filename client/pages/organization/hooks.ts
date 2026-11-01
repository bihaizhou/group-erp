import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrgOptions, OrgRecord } from './model.js';

export function useOptions() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['org-options'],
    queryFn: () =>
      api.request<{ data: OrgOptions }>({ path: 'organization/options' }),
  });
}
export function useRecord(kind: string, id: string | undefined) {
  const api = useApiClient();
  const cache = useQueryClient();
  return useQuery({
    queryKey: ['org', kind, id],
    enabled: Boolean(id),
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        return await api.request<{ data: OrgRecord }>({
          path: `organization/${kind}/${encodeURIComponent(id!)}`,
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404)
          void cache.invalidateQueries({ queryKey: ['org-list'] });
        throw error;
      }
    },
  });
}
export function useOrgError() {
  const { t } = useTranslation();
  return (error: unknown): string => {
    if (
      error instanceof ApiClientError &&
      error.reason &&
      t(`org.errors.${error.reason}`, { defaultValue: '' })
    )
      return t(`org.errors.${error.reason}`);
    return t(
      error instanceof ApiClientError && error.status === 403
        ? 'org.forbidden'
        : error instanceof ApiClientError && error.status === 401
          ? 'org.sessionEnded'
          : 'org.saveFailed',
    );
  };
}

export type OrgAudit = {
  id: string;
  kind: string;
  recordId: string;
  recordName: string;
  operation: string;
  actorName: string;
  reason: string;
  createdAt: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
};

export function useRecordHistory(recordId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['org-record-history', recordId],
    enabled: Boolean(recordId),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      api.request<{
        data: OrgAudit[];
        meta: { page: number; pageSize: number; total: number };
      }>({
        path: 'organization/history',
        query: {
          recordId,
          pageSize: 100,
          orderBy: '-createdAt',
        },
        signal,
      }),
  });
}
