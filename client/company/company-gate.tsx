import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { CompanyEmpty, type CompanyChoice } from '#components/company-scope';
import { Button } from '#components/ui/button';
import { useDefaultCompany } from '#hooks/use-default-company';
import { COMPANY_QUERY_PARAM } from '#lib/company-scope';
import { useAccountCompanyId } from './use-account-company.js';
import { CompanyScopeContext } from './use-company-scope.js';

const PAGE_SIZE = 100;

/**
 * The route-level company gate. A page below a company-scoped path cannot
 * mount before a company is chosen, so pages no longer need their own picker.
 * The URL stays the source of truth; the header switcher edits the same value.
 */
export function CompanyGate({
  endpoint,
  children,
}: {
  readonly endpoint: string;
  readonly children: ReactNode;
}) {
  const { t } = useTranslation(),
    ui = (key: string) => `companyScope.${key}`,
    api = useApiClient(),
    [params, setParams] = useSearchParams(),
    subjectId =
      params.get(COMPANY_QUERY_PARAM) ?? params.get('reviewSubjectId') ?? '';

  const query = useQuery({
    queryKey: ['companyGate', endpoint],
    queryFn: ({ signal }) =>
      api.request<{ data: CompanyChoice[]; meta: { total: number } }>({
        path: endpoint,
        query: { page: 1, pageSize: PAGE_SIZE, q: '' },
        signal,
      }),
    staleTime: 30_000,
  });
  const companies = useMemo(() => query.data?.data ?? [], [query.data]);
  const total = query.data?.meta.total ?? 0;
  const exhaustive = total <= companies.length;

  const selectCompany = useCallback(
    (id: string) =>
      setParams(
        (previous) => {
          if (!id) {
            const next = new URLSearchParams(previous);
            next.delete(COMPANY_QUERY_PARAM);
            next.delete('reviewSubjectId');
            next.delete('page');
            return next;
          }
          // A company switch starts a fresh view; filters from the old company
          // (warehouse, sku, search, page) must not leak into the new one.
          const next = new URLSearchParams();
          next.set(COMPANY_QUERY_PARAM, id);
          if (previous.has('reviewSubjectId')) next.set('reviewSubjectId', id);
          if (previous.has('tab')) next.set('tab', previous.get('tab')!);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const invalid =
    Boolean(subjectId) &&
    Boolean(query.data) &&
    exhaustive &&
    !companies.some((item) => item.id === subjectId);

  // The account's home company is a default, never an authorisation: only use
  // it when the module's own list contains it. Wait for it before choosing the
  // first company, so a signed-in employee does not briefly land elsewhere.
  const needsDefault = !subjectId || invalid;
  const account = useAccountCompanyId(needsDefault);

  useDefaultCompany({
    subjectId,
    ready: Boolean(query.data) && !(needsDefault && account.isPending),
    companies,
    preferredId: account.companyId,
    exhaustive,
    onChange: selectCompany,
  });

  if (query.isPending) {
    return (
      <div className='px-6 py-8'>
        <CompanyEmpty type='loading' />
      </div>
    );
  }

  if (query.error) {
    return (
      <div className='mx-auto max-w-xl space-y-3 px-6 py-8' role='alert'>
        <p className='text-sm text-destructive'>{t(ui('loadFailed'))}</p>
        <Button variant='outline' onClick={() => void query.refetch()}>
          {t(ui('retry'))}
        </Button>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className='px-6 py-8'>
        <CompanyEmpty
          type='noCompany'
          createCompany={
            <Button
              variant='outline'
              nativeButton={false}
              render={<Link to='/organization/subjects' />}
            >
              {t(ui('createCompany'))}
            </Button>
          }
        />
      </div>
    );
  }

  if (!subjectId || invalid || (needsDefault && account.isPending)) {
    return (
      <div className='px-6 py-8'>
        <CompanyEmpty type='loading' />
      </div>
    );
  }

  const current = companies.find((company) => company.id === subjectId);
  return (
    <CompanyScopeContext.Provider
      value={{
        id: subjectId,
        code: current?.code,
        name: current?.name,
      }}
    >
      {children}
    </CompanyScopeContext.Provider>
  );
}
