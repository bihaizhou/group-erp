import { type ReactNode } from 'react';
import { CompanyEmpty } from '#components/company-scope';
import { ApiClientError } from '@nocobase/app-client';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router';
import { usePartnerTranslation as useTranslation } from './partner-domain.js';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { LongText } from '#components/long-text';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { useAvailability, useCapabilities, useSupplierQuery } from './hooks.js';
import { SupplierError, SupplierLoading, SupplierStatus } from './controls.js';
import type { Choice } from './model.js';
import { SupplierTimeline } from './history.js';
export function Values({ values }: { values: [string, ReactNode][] }) {
  const { t } = useTranslation();
  return (
    <dl className='grid min-w-0 gap-4'>
      {values.map(([key, value]) => (
        <div
          key={key}
          className='grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-4'
        >
          <dt className='text-sm text-muted-foreground'>
            {t(`procurement.${key}`)}
          </dt>
          <dd className='min-w-0 break-words'>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
export default function SupplierDetail() {
  const { t } = useTranslation(),
    { partnerId } = useParams(),
    [params] = useSearchParams(),
    location = useLocation();
  const subjectId = params.get('subjectId') ?? '',
    record = useAvailability(partnerId, subjectId),
    row = record.data?.data;
  const company = useSupplierQuery<{ data: Choice }>(
    `supplierCompanies/${subjectId}`,
    {},
    Boolean(subjectId),
  );
  const capability = useCapabilities(partnerId, subjectId),
    can = capability.data?.data;
  const link = (pathname: string) => ({ pathname, search: location.search });
  const button = (path: string, key: string) => (
    <Button
      variant='outline'
      nativeButton={false}
      render={<Link to={link(path)} />}
    >
      {t(`procurement.${key}`)}
    </Button>
  );
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <PageHeader
            title={row?.identity.name ?? t('procurement.suppliers')}
            description={
              company.data
                ? `${company.data.data.code} · ${company.data.data.name}`
                : t('procurement.companyHint')
            }
          />
          {!subjectId ? (
            <CompanyEmpty type='chooseCompany' />
          ) : record.error &&
            (!row ||
              (record.error instanceof ApiClientError &&
                [401, 403, 404].includes(record.error.status))) ? (
            <SupplierError
              error={record.error}
              retry={() => void record.refetch()}
            />
          ) : !row ? (
            <SupplierLoading />
          ) : (
            <>
              {Boolean(record.error) && (
                <SupplierError
                  error={record.error}
                  retry={() => void record.refetch()}
                />
              )}
              <Card>
                <CardHeader>
                  <CardTitle>{t('procurement.identity')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-5'>
                  <Values
                    values={[
                      ['code', row.identity.code],
                      ['name', row.identity.name],
                      ['registrationCode', row.identity.registrationCode],
                      [
                        'identityStatus',
                        <SupplierStatus
                          key='identity-status'
                          value={row.identity.status}
                        />,
                      ],
                    ]}
                  />
                  {can?.updateIdentity && button('identity', 'editIdentity')}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('procurement.scope')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-5'>
                  <Values
                    values={[
                      ['scopeMatch', t(`procurement.match.${row.scopeMatch}`)],
                      [
                        'supplierStatus',
                        <SupplierStatus
                          key='supplier-status'
                          value={row.supplierStatus}
                        />,
                      ],
                      [
                        'effectiveStatus',
                        <SupplierStatus
                          key='effective-status'
                          value={row.effectiveStatus}
                        />,
                      ],
                    ]}
                  />
                  {can?.configureApplicability && (
                    <div className='flex flex-wrap gap-2'>
                      {button('scope', 'editScope')}
                      {button(
                        `global/${row.supplierStatus === 'active' ? 'deactivate' : 'reactivate'}`,
                        row.supplierStatus === 'active'
                          ? 'stopGlobal'
                          : 'restoreGlobal',
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('procurement.companySettings')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-5'>
                  <Values
                    values={[
                      [
                        'companyStatus',
                        <SupplierStatus
                          key='company-status'
                          value={row.companyStatus}
                        />,
                      ],
                      [
                        'notes',
                        <LongText key='notes'>{row.notes || '—'}</LongText>,
                      ],
                    ]}
                  />
                  {!row.settingId && (
                    <p className='text-sm text-muted-foreground'>
                      {t('procurement.inherited')}
                    </p>
                  )}
                  {can?.updateRelationship && (
                    <div className='flex flex-wrap gap-2'>
                      {button('edit', 'editCompany')}
                      {row.companyStatus === 'active' ? (
                        button('company/deactivate', 'stopCompany')
                      ) : row.supplierStatus === 'active' &&
                        row.identity.status === 'active' ? (
                        button('company/reactivate', 'restoreCompany')
                      ) : (
                        <div className='flex flex-col gap-2'>
                          <Button variant='outline' disabled>
                            {t('procurement.restoreCompany')}
                          </Button>
                          <p className='text-sm text-muted-foreground'>
                            {t('procurement.blockedRestore')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              <SupplierTimeline
                settingPath={
                  row.settingId
                    ? `suppliers/${row.settingId}/history`
                    : undefined
                }
                identityPath={
                  can?.updateIdentity
                    ? `supplierIdentities/${partnerId}/history`
                    : undefined
                }
                scopePath={
                  can?.configureApplicability
                    ? `supplierIdentities/${partnerId}/applicability/history`
                    : undefined
                }
              />
            </>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
