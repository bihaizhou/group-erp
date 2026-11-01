import { Link, Outlet, useLocation, useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { Button } from '#components/ui/button';
import { LongTextPreview } from '#components/long-text';
import { StatusBadge } from '#components/status-badge';
import { Loading, ErrorNotice, RefreshButton } from '../requests/controls.js';
import { purposeUi as pui, usePurposeCan, usePurpose } from './model.js';
export default function PurposeDetail() {
  const { t, i18n } = useTranslation(),
    { purposeId } = useParams(),
    location = useLocation(),
    result = usePurpose(purposeId),
    row = result.data?.data;
  const update = usePurposeCan('update'),
    activate = usePurposeCan('activate'),
    deactivate = usePurposeCan('deactivate');
  return (
    <RouteDrawer
      title={row?.name ?? t(pui('detail'))}
      footer={
        row && !result.error ? (
          <div className='flex flex-wrap gap-2'>
            {update.can && (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'edit', search: location.search }} />
                }
              >
                {t(pui('edit'))}
              </Button>
            )}
            {(row.status === 'active' ? deactivate.can : activate.can) && (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link
                    to={{
                      pathname: `actions/${row.status === 'active' ? 'deactivate' : 'activate'}`,
                      search: location.search,
                    }}
                  />
                }
              >
                {t(pui(row.status === 'active' ? 'deactivate' : 'activate'))}
              </Button>
            )}
            <RefreshButton
              busy={result.isFetching}
              onClick={() => void result.refetch()}
            />
          </div>
        ) : undefined
      }
    >
      {result.error ? (
        <ErrorNotice error={result.error} retry={() => void result.refetch()} />
      ) : !row ? (
        <Loading kind='detail' />
      ) : (
        <dl className='flex flex-col gap-4'>
          {[
            [pui('company'), row.company?.name ?? '—'],
            [pui('code'), row.code],
            [pui('name'), row.name],
            [pui('notes'), row.description],
            [
              pui('updatedAt'),
              new Date(row.updatedAt).toLocaleString(i18n.language),
            ],
          ].map(([key, value]) => (
            <div
              key={key}
              className='grid min-w-0 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]'
            >
              <dt className='text-sm text-muted-foreground'>{t(key)}</dt>
              <dd className='min-w-0 text-sm break-words'>
                {value ? (
                  <LongTextPreview label={t(key)}>{value}</LongTextPreview>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          ))}
          <div className='grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]'>
            <dt className='text-sm text-muted-foreground'>
              {t(pui('status'))}
            </dt>
            <dd>
              <StatusBadge
                tone={row.status === 'active' ? 'success' : 'neutral'}
              >
                {t(pui(row.status))}
              </StatusBadge>
            </dd>
          </div>
        </dl>
      )}
      <Outlet />
    </RouteDrawer>
  );
}
