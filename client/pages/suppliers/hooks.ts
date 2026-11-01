import { usePartnerConfig } from './partner-domain.js';
import { usePartnerApi as useApiClient } from './partner-domain.js';
import { ApiClientError } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { usePartnerTranslation as useTranslation } from './partner-domain.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Availability,
  Applicability,
  Capabilities,
  Identity,
  Relationship,
  SupplierSaved,
  Page,
} from './model.js';
export function useSupplierCan(action: string) {
  const config = usePartnerConfig();
  return useCan({
    resource: { type: 'composite', id: config.resource },
    action,
  });
}
export function useSupplierQuery<T>(
  path: string,
  query: Record<string, string | number | string[]> = {},
  enabled = true,
) {
  const api = useApiClient(),
    config = usePartnerConfig();
  const cache = useQueryClient();
  return useQuery({
    queryKey: [config.cache, path, query],
    enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      try {
        return await api.request<T>({
          path: `procurement/${path}`,
          query,
          signal,
        });
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.status === 404 &&
          (path.startsWith('supplierAvailability/') ||
            path.startsWith('supplierIdentities/'))
        )
          void cache.invalidateQueries({
            queryKey: [config.cache, 'supplierAvailability'],
            refetchType: 'active',
          });
        throw error;
      }
    },
  });
}
export const useAvailability = (id?: string, subjectId?: string) =>
  useSupplierQuery<{ data: Availability }>(
    `supplierAvailability/${id}`,
    { subjectId: subjectId ?? '' },
    Boolean(id && subjectId),
  );
export const useApplicability = (id?: string, enabled = true) =>
  useSupplierQuery<{ data: Applicability }>(
    `supplierIdentities/${id}/applicability`,
    {},
    Boolean(id && enabled),
  );
export const useIdentity = (id?: string, enabled = true) =>
  useSupplierQuery<{ data: Identity }>(
    `supplierIdentities/${id}`,
    {},
    Boolean(id && enabled),
  );
export const useCapabilities = (id?: string, subjectId?: string) =>
  useSupplierQuery<{ data: Capabilities }>(
    `supplierCapabilities/${id}`,
    subjectId ? { subjectId } : {},
    Boolean(id),
  );
export function useSupplierRefresh() {
  const cache = useQueryClient(),
    config = usePartnerConfig();
  return (saved?: SupplierSaved, created = false) => {
    if (saved) {
      const identity =
        'scopeMode' in saved
          ? undefined
          : 'identity' in saved
            ? saved.identity
            : saved;
      const relationship: Relationship | undefined =
        'identity' in saved ? saved : undefined;
      const policy = 'scopeMode' in saved ? saved : undefined;
      const partnerId = identity?.id ?? policy?.partnerId;
      const update = (row: Availability): Availability => {
        if (row.partnerId !== partnerId) return row;
        const next = {
          ...row,
          ...(identity ? { identity } : {}),
          ...(policy ? { supplierStatus: policy.status } : {}),
          ...(relationship?.subjectId === row.subjectId
            ? {
                settingId: relationship.id,
                notes: relationship.notes,
                revision: relationship.revision,
                companyStatus: relationship.status,
                updatedAt: relationship.updatedAt,
              }
            : {}),
        };
        return {
          ...next,
          effectiveStatus:
            next.identity.status === 'active' &&
            next.supplierStatus === 'active' &&
            next.companyStatus === 'active'
              ? 'active'
              : 'inactive',
        };
      };
      // Apply the server's committed result before closing. Refetching is an
      // independent freshness step; its latency cannot hold the saved form open.
      for (const query of cache
        .getQueryCache()
        .findAll({ queryKey: [config.cache] })) {
        const path = query.queryKey[1];
        if (typeof path !== 'string') continue;
        if (path === 'supplierAvailability') {
          const old = query.state.data as Page<Availability> | undefined;
          if (!old) continue;
          const params = query.queryKey[2] as Record<string, string | number>;
          let data = old.data.map(update),
            total = old.meta.total;
          if (
            created &&
            relationship &&
            params.subjectId === relationship.subjectId &&
            !data.some((v) => v.partnerId === partnerId)
          ) {
            const q = String(params.q ?? '')
              .normalize('NFKC')
              .toLowerCase();
            const matches =
              !q ||
              [
                relationship.identity.code,
                relationship.identity.name,
                relationship.identity.registrationCode ?? '',
              ].some((v) => v.normalize('NFKC').toLowerCase().includes(q));
            if (matches && params.status !== 'inactive') {
              total++;
              if (old.meta.page === 1) {
                data = [
                  ...data,
                  {
                    partnerId: relationship.partnerId,
                    subjectId: relationship.subjectId,
                    identity: relationship.identity,
                    scopeMatch: 'company',
                    supplierStatus: 'active',
                    companyStatus: relationship.status,
                    effectiveStatus: 'active',
                    settingId: relationship.id,
                    revision: relationship.revision,
                    notes: relationship.notes,
                    updatedAt: relationship.updatedAt,
                  },
                ];
                data.sort(
                  (a, b) =>
                    (params.orderBy === '-updatedAt'
                      ? b.updatedAt.localeCompare(a.updatedAt)
                      : params.orderBy === 'updatedAt'
                        ? a.updatedAt.localeCompare(b.updatedAt)
                        : params.orderBy === 'name'
                          ? a.identity.name.localeCompare(b.identity.name)
                          : params.orderBy === '-name'
                            ? b.identity.name.localeCompare(a.identity.name)
                            : params.orderBy === '-code'
                              ? b.identity.code.localeCompare(a.identity.code)
                              : a.identity.code.localeCompare(
                                  b.identity.code,
                                )) || a.partnerId.localeCompare(b.partnerId),
                );
                data = data.slice(0, old.meta.pageSize);
              }
            }
          }
          cache.setQueryData(query.queryKey, {
            ...old,
            data,
            meta: { ...old.meta, total },
          });
        } else if (path.startsWith('supplierAvailability/')) {
          cache.setQueryData<{ data: Availability }>(query.queryKey, (old) =>
            old ? { data: update(old.data) } : old,
          );
        } else if (
          policy &&
          path === `supplierIdentities/${partnerId}/applicability`
        ) {
          cache.setQueryData(query.queryKey, { data: policy });
        } else if (
          identity &&
          [
            'supplierIdentities',
            'supplierScopeIdentities',
            `supplierIdentities/${identity.id}`,
            `supplierScopeIdentities/${identity.id}`,
          ].includes(path)
        ) {
          cache.setQueryData<{ data: Identity | Identity[] }>(
            query.queryKey,
            (old) =>
              old
                ? {
                    ...old,
                    data: Array.isArray(old.data)
                      ? old.data.map((v) =>
                          v.id === identity.id ? identity : v,
                        )
                      : identity,
                  }
                : old,
          );
        }
      }
    }
    return Promise.all([
      cache.invalidateQueries({
        queryKey: [config.cache],
        refetchType: 'active',
      }),
      cache.invalidateQueries({
        queryKey: ['execution'],
        refetchType: 'active',
      }),
    ]);
  };
}
export function useSupplierError() {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (error instanceof ApiClientError) {
      if (
        error.reason &&
        t(`procurement.errors.${error.reason}`, { defaultValue: '' })
      )
        return t(`procurement.errors.${error.reason}`);
      if ([401, 403, 404].includes(error.status))
        return t(`procurement.http${error.status}`);
    }
    return t('procurement.failed');
  };
}
