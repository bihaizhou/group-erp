import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DemandDomain, Source } from './model.js';
export const sourceUi = (key: string) => `materialSources.${key}`;
export const demandPrefix = (domain: DemandDomain) =>
  domain === 'procurement' ? 'purchase' : 'issue';
export function useDemandQuery<T>(
  domain: DemandDomain,
  path: string,
  enabled = true,
  query: Record<string, string | number> = {},
  observeOnly = false,
) {
  const api = useApiClient(),
    cache = useQueryClient();
  const result = useQuery({
    queryKey: [demandPrefix(domain), path, query],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: observeOnly ? false : 'always',
    queryFn: ({ signal }) =>
      api.request<T>({ path: `${domain}/${path}`, query, signal }),
  });
  const terminal =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  useEffect(() => {
    if (
      !(result.error instanceof ApiClientError) ||
      result.error.status !== 404 ||
      !path.startsWith('requests/')
    )
      return;
    const prefix = demandPrefix(domain),
      parent = path.split('/').slice(0, 2).join('/');
    void cache.invalidateQueries({
      queryKey: [prefix, 'requests'],
      refetchType: 'active',
    });
    if (path !== parent)
      void cache.invalidateQueries({
        queryKey: [prefix, parent, {}],
        refetchType: 'active',
      });
  }, [cache, domain, path, result.error, result.errorUpdatedAt]);
  return { ...result, data: terminal ? undefined : result.data };
}
export const useSources = (
  domain: DemandDomain,
  id: string,
  observeOnly = false,
) =>
  useDemandQuery<{ data: Source[] }>(
    domain,
    `requests/${id}/sources`,
    !!id,
    {},
    observeOnly,
  );
export function useSourceError() {
  const { t } = useTranslation();
  return (cause: unknown) => {
    if (cause instanceof ApiClientError) {
      const reason = cause.reason
        ? t(sourceUi(`errors.${cause.reason}`), { defaultValue: '' })
        : '';
      if (reason) return reason;
      if ([401, 403, 404, 409].includes(cause.status))
        return t(sourceUi(`http${cause.status}`));
    }
    return t(sourceUi('failed'));
  };
}
