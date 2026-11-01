import { displayValue } from './formatting.js';
import { useOptions, useRecord } from './hooks.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { Link, Outlet, useParams, useLocation } from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDrawer } from '#components/route-drawer';
import { BackButton } from '#components/back-button';
import { LongText } from '#components/long-text';
import { Button } from '#components/ui/button';
import { fields, isSmall, sectionForField } from './model.js';
import { useOrgKind } from './context.js';
import { ErrorNotice, Loading, OrgStatus } from './shared.js';
import { OrganizationRecordHistory } from './record-history.js';

export default function OrganizationDetailPage() {
  const { t, i18n } = useTranslation();
  const kind = useOrgKind();
  const { recordId } = useParams();
  const location = useLocation();
  const record = useRecord(kind, recordId);
  const options = useOptions();
  const canWrite = useCan({
    resource: { type: 'settings', id: 'organization' },
    action: 'update',
  }).can;
  const data = record.data?.data;
  const title = data?.name ?? t(`org.${kind}`);
  const edit =
    canWrite && data && !record.isError && !record.isFetching ? (
      <Button
        nativeButton={false}
        render={<Link to={{ pathname: 'edit', search: location.search }} />}
      >
        {t('org.edit')}
      </Button>
    ) : null;
  const body = record.isError ? (
    <ErrorNotice error={record.error} retry={() => void record.refetch()} />
  ) : !data ? (
    <Loading />
  ) : (
    <div className='flex flex-col gap-6'>
      <div className='flex items-center gap-2'>
        <OrgStatus status={data.status} />
        <span className='text-sm text-muted-foreground'>{data.code}</span>
      </div>
      <dl className='grid gap-4 sm:grid-cols-2'>
        {fields[kind].map((field, index) => (
          <div key={field.key} className='contents'>
            {!isSmall(kind) &&
            (index === 0 ||
              sectionForField(field) !==
                sectionForField(fields[kind][index - 1])) ? (
              <h2 className='text-base font-semibold sm:col-span-2'>
                {t(`org.${sectionForField(field)}`)}
              </h2>
            ) : null}
            <div
              key={field.key}
              className={
                field.type === 'textarea' ? 'sm:col-span-2' : undefined
              }
            >
              <dt className='text-sm text-muted-foreground'>
                {t(`org.fields.${field.key}`)}
              </dt>
              <dd className='mt-1 text-sm break-words'>
                {field.type === 'textarea' ? (
                  <LongText>{String(data[field.key] ?? '—')}</LongText>
                ) : (
                  displayValue(
                    field.key,
                    data[field.key],
                    options.data?.data,
                    (key) => t(key),
                    i18n.language,
                  )
                )}
              </dd>
            </div>
          </div>
        ))}
      </dl>
      <p className='text-xs text-muted-foreground'>
        {t('org.fields.updatedAt')} ·{' '}
        {new Date(data.updatedAt).toLocaleString(i18n.language)}
      </p>
      <OrganizationRecordHistory
        recordId={data.id}
        options={options.data?.data}
      />
    </div>
  );
  return isSmall(kind) ? (
    <RouteDrawer title={title} footer={edit}>
      {body}
      <Outlet />
    </RouteDrawer>
  ) : (
    <RouteChildPage>
      <PageContainer className='max-w-4xl'>
        <BackButton />
        <PageHeader
          title={title}
          description={t(`org.${kind}`)}
          actions={edit}
        />
        {body}
        <Outlet />
      </PageContainer>
    </RouteChildPage>
  );
}
