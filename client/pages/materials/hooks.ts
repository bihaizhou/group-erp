import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useDebouncedValue } from '#hooks/use-debounced-value';
import type { Kind, Options, Row } from './model.js';

export type MaterialAudit = {
  id: string;
  kind: string;
  recordId: string;
  recordName: string;
  operation: string;
  actorId: string;
  actorName: string;
  reason: string;
  createdAt: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
};

export type SimilarMaterialName = {
  id: string;
  code: string;
  name: string;
  status: string;
  score: number;
  reason: 'same' | 'contains' | 'similar';
};
export type SimilarMaterialNames = {
  rows: SimilarMaterialName[];
  total: number;
  truncated: boolean;
};

export function useMaterialCan(
  kind: Kind | 'catalog' | 'history',
  action = 'update',
) {
  return useCan({
    resource: { type: 'composite', id: `materials.${kind}` },
    action,
  });
}
export function useMaterialOptions(
  kind: Kind | 'catalog',
  q = '',
  ids: string[] = [],
  enabled = true,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['material-options', kind, q, ids.join(',')],
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      api.request<{ data: Options }>({
        path: 'materials/options',
        query: { kind, q, selectedId: ids },
        signal,
      }),
  });
}
/**
 * Existing standard names that resemble `name`, for the non-blocking duplicate
 * hint on the form. Typing is debounced, and the previous matches stay visible
 * while the next request runs.
 */
export function useSimilarMaterialNames(name: string, excludeId?: string) {
  const api = useApiClient();
  const term = useDebouncedValue(name.trim());
  return useQuery({
    queryKey: ['material-similar-names', term, excludeId ?? ''],
    enabled: term.length >= 2,
    retry: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.request<{ data: SimilarMaterialNames }>({
        path: 'materials/names/similar',
        query: { name: term, excludeId },
        signal,
      }),
  });
}
/**
 * A unique uppercase abbreviation for a new standard name, derived from the
 * name's initials. Typing is debounced and the request only runs while the
 * form is creating a name.
 */
export function useMaterialNameCode(name: string, enabled: boolean) {
  const api = useApiClient();
  const term = useDebouncedValue(name.trim());
  return useQuery({
    queryKey: ['material-name-code', term],
    enabled: enabled && term.length >= 2,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api.request<{ data: { code: string } }>({
        path: 'materials/names/code-suggestion',
        query: { name: term },
        signal,
      }),
  });
}
export function useMaterialRecord(kind: Kind, id?: string, catalog = false) {
  const api = useApiClient(),
    cache = useQueryClient();
  return useQuery({
    queryKey: ['material-record', catalog ? 'catalog' : kind, id],
    enabled: Boolean(id),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      try {
        return await api.request<{ data: Row }>({
          path: `materials/${catalog ? 'catalog' : kind}/${id}`,
          signal,
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404)
          void cache.invalidateQueries({ queryKey: ['material-list'] });
        throw error;
      }
    },
  });
}
export function useMaterialRefresh() {
  const cache = useQueryClient();
  return async (row?: Row, kind?: Kind) => {
    if (row && kind) {
      cache.setQueryData(['material-record', kind, row.id], { data: row });
      await cache.invalidateQueries({
        queryKey: ['material-record', kind, row.id],
        refetchType: 'active',
      });
    }
    await Promise.all(
      [
        'material-list',
        'material-options',
        'material-history',
        'material-record',
        'material-source',
      ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    );
  };
}
export function useMaterialError() {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (error instanceof ApiClientError) {
      if (error.reason?.startsWith('SUPPLY_SOURCE_'))
        return t(`materialSources.errors.${error.reason}`, {
          defaultValue: t('materialSources.failed'),
        });
      if (error.reason?.startsWith('SUPPLY_FILE_'))
        return t(`demandAttachments.errors.${error.reason}`, {
          defaultValue: t('demandAttachments.failed'),
        });
      if (
        error.reason &&
        t(`materials.errors.${error.reason}`, { defaultValue: '' })
      )
        return t(`materials.errors.${error.reason}`);
      if ([401, 403, 404, 409].includes(error.status))
        return t(`materials.http${error.status}`);
    }
    return t('materials.failed');
  };
}

export function useMaterialRecordHistory(
  recordId: string | undefined,
  enabled = true,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['material-record-history', recordId],
    enabled: Boolean(recordId) && enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      api.request<{
        data: MaterialAudit[];
        meta: { page: number; total: number };
      }>({
        path: 'materials/history',
        query: {
          recordId,
          page: 1,
          orderBy: '-createdAt',
        },
        signal,
      }),
  });
}
