import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Building2, Check } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu';
import { COMPANY_QUERY_PARAM } from '#lib/company-scope';
import { useCompanyScopeEndpoint } from '../../company/company-route-scope.js';

type Company = { id: string; code?: string; name?: string };

/**
 * The header shows the company the current page works in. Its list is the
 * page's own authorised endpoint, so switching never offers a company the
 * module cannot access; the URL stays the source of truth.
 */
export function CompanySwitcher() {
  const location = useLocation(),
    endpoint = useCompanyScopeEndpoint(location.pathname);
  if (!endpoint) return null;
  return <CompanySwitcherMenu endpoint={endpoint} />;
}

function CompanySwitcherMenu({ endpoint }: { endpoint: string }) {
  const { t } = useTranslation(),
    [params, setParams] = useSearchParams(),
    api = useApiClient(),
    subjectId =
      params.get(COMPANY_QUERY_PARAM) ?? params.get('reviewSubjectId') ?? '',
    reviewSubjectId = params.get('reviewSubjectId') ?? '',
    companies = useQuery({
      queryKey: ['companyGate', endpoint],
      queryFn: ({ signal }) =>
        api.request<{ data: Company[]; meta: { total: number } }>({
          path: endpoint,
          query: { page: 1, pageSize: 100, q: '' },
          signal,
        }),
      staleTime: 30_000,
    });
  if (companies.isPending || companies.error) return null;
  const items = companies.data?.data ?? [],
    current = items.find((item) => item.id === subjectId),
    label = current
      ? [current.code, current.name].filter(Boolean).join(' · ')
      : t('companyScope.chooseReference');
  const select = (id: string) =>
    setParams(
      () => {
        // A company switch starts a fresh view; filters from the old company
        // (warehouse, sku, search, page) must not leak into the new one.
        const next = new URLSearchParams();
        next.set(COMPANY_QUERY_PARAM, id);
        if (reviewSubjectId) next.set('reviewSubjectId', id);
        if (params.has('tab')) next.set('tab', params.get('tab')!);
        return next;
      },
      { replace: true },
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            className='max-w-56 gap-2'
            aria-label={t('companyScope.switchCompany')}
          >
            <Building2 />
            <span className='truncate'>{label}</span>
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='w-64'>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={() => select(item.id)}
            className='justify-between gap-3'
          >
            <span className='truncate'>
              {[item.code, item.name].filter(Boolean).join(' · ')}
            </span>
            {item.id === subjectId && <Check />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
