import { Link, Outlet, useLocation } from 'react-router';
import { usePartnerTranslation as useTranslation } from './partner-domain.js';
import { Truck } from 'lucide-react';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { useUrlSearch } from '#hooks/use-url-search';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import { useSupplierCan, useSupplierQuery, useCapabilities } from './hooks.js';
import { SupplierError, SupplierLoading, Pagination } from './controls.js';
import { pageNumber, type Identity, type Page } from './model.js';
export default function SupplierDirectory() {
  const { t } = useTranslation(),
    search = useUrlSearch({
      param: 'directoryQ',
      resetParams: ['directoryPage'],
    });
  const scope = useSupplierCan('configureApplicability'),
    identity = useSupplierCan('updateIdentity');
  const page = pageNumber(search.searchParams.get('directoryPage'));
  const records = useSupplierQuery<Page<Identity>>(
    scope.can ? 'supplierScopeIdentities' : 'supplierIdentities',
    { q: search.search, page, pageSize: 20 },
    scope.can || identity.can,
  );
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <PageHeader
            title={t('procurement.directory')}
            description={t('procurement.directoryHint')}
          />
          <Input
            aria-label={t('procurement.search')}
            placeholder={t('procurement.search')}
            maxLength={200}
            {...search.inputProps}
          />
          {search.search && Boolean(records.data?.data.length) && (
            <Button
              variant='ghost'
              onClick={() => search.clear((p) => p.delete('directoryPage'))}
            >
              {t('procurement.clear')}
            </Button>
          )}
          {records.error ? (
            <SupplierError
              error={records.error}
              retry={() => void records.refetch()}
            />
          ) : records.isPending ? (
            scope.can || identity.can ? (
              <SupplierLoading />
            ) : (
              <p>{t('procurement.http403')}</p>
            )
          ) : (
            <>
              <div className='grid gap-4 lg:grid-cols-2'>
                {records.data?.data.map((row) => (
                  <DirectoryCard key={row.id} row={row} />
                ))}
              </div>
              {!records.data?.data.length && (
                <Empty className='min-h-48 border border-dashed'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <Truck />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t(
                        search.search || page > 1
                          ? 'procurement.noResults'
                          : 'procurement.empty',
                      )}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t(
                        search.search || page > 1
                          ? 'procurement.noResultsHint'
                          : 'procurement.directoryEmptyHint',
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                  {(search.search || page > 1) && (
                    <EmptyContent>
                      <Button
                        variant='outline'
                        onClick={() =>
                          search.clear((p) => p.delete('directoryPage'))
                        }
                      >
                        {t('procurement.clear')}
                      </Button>
                    </EmptyContent>
                  )}
                </Empty>
              )}
              <Pagination
                page={page}
                total={records.data?.meta.total ?? 0}
                onPage={(v) =>
                  search.updateParams((p) => p.set('directoryPage', String(v)))
                }
                busy={records.isFetching}
              />
            </>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
function DirectoryCard({ row }: { row: Identity }) {
  const { t } = useTranslation(),
    location = useLocation(),
    capabilities = useCapabilities(row.id),
    can = capabilities.data?.data;
  const link = (path: string) => ({
    pathname: `${row.id}/${path}`,
    search: location.search,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className='break-words'>{row.name}</CardTitle>
        <CardDescription className='break-all'>
          {row.code} · {row.registrationCode || '—'}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        {can?.updateIdentity && (
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to={link('identity')} />}
          >
            {t('procurement.editIdentity')}
          </Button>
        )}
        {can?.configureApplicability && (
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to={link('scope')} />}
          >
            {t('procurement.editScope')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
