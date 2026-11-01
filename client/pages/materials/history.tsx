import { useSourceReason } from '#hooks/use-source-reason';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Button } from '#components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { LongText } from '#components/long-text';
import { useUrlSearch } from '#hooks/use-url-search';
import { kinds, text, type Kind } from './model.js';
import type { MaterialAudit } from './hooks.js';
import { MaterialAuditChanges } from './record-history.js';
import { ErrorNotice, Loading, Refresh, MaterialSelect } from './controls.js';
export default function MaterialHistory() {
  const { t, i18n } = useTranslation(),
    sourceReason = useSourceReason(),
    api = useApiClient(),
    search = useUrlSearch({ resetParams: ['page'] }),
    params = search.searchParams;
  const data = useQuery({
    retry: false,
    queryKey: ['material-history', params.toString()],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.request<{
        data: MaterialAudit[];
        meta: { total: number; page: number };
      }>({
        path: 'materials/history',
        query: Object.fromEntries(
          [...params].filter(([key]) =>
            ['kind', 'recordId', 'q', 'page', 'orderBy'].includes(key),
          ),
        ),
        signal,
      }),
  });
  const page = data.data?.meta.page ?? 1,
    total = data.data?.meta.total ?? 0;
  const update = (key: string, value: string) =>
    search.updateParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      if (key !== 'page') p.delete('page');
    });
  return (
    <PageContainer>
      <PageHeader
        title={t('materials.history')}
        description={t('materials.historyDescription')}
        actions={
          <Refresh busy={data.isFetching} onClick={() => void data.refetch()} />
        }
      />
      <div className='flex flex-wrap items-center gap-3'>
        <div className='w-full sm:max-w-xs'>
          <Label className='sr-only' htmlFor='material-history-search'>
            {t('materials.historySearch')}
          </Label>
          <Input
            id='material-history-search'
            placeholder={t('materials.historySearch')}
            {...search.inputProps}
          />
        </div>

        <div className='w-full sm:w-48'>
          <MaterialSelect
            label={t('materials.kind')}
            value={params.get('kind') ?? ''}
            onChange={(v) => update('kind', v)}
            items={[
              { value: '', label: t('materials.allKinds') },
              ...kinds.map((value) => ({
                value,
                label: t(`materials.kinds.${value}`),
              })),
            ]}
          />
        </div>
        <div className='w-full sm:w-40'>
          <MaterialSelect
            label={t('materials.historyOrder')}
            value={params.get('orderBy') ?? '-createdAt'}
            onChange={(value) => update('orderBy', value)}
            items={[
              { value: '-createdAt', label: t('materials.newest') },
              { value: 'createdAt', label: t('materials.oldest') },
            ]}
          />
        </div>
        {params.get('recordId') ? (
          <span className='text-sm text-muted-foreground'>
            {t('materials.recordFilter')}
          </span>
        ) : null}
        {search.search || params.get('kind') || params.get('recordId') ? (
          <Button
            variant='ghost'
            onClick={() =>
              search.clear((p) => {
                p.delete('kind');
                p.delete('recordId');
                p.delete('page');
              })
            }
          >
            {t('materials.clear')}
          </Button>
        ) : null}
        <span className='text-sm text-muted-foreground'>
          {t('materials.total', { count: total })}
        </span>
      </div>
      {data.isError ? (
        <ErrorNotice error={data.error} retry={() => void data.refetch()} />
      ) : !data.data ? (
        <Loading variant='history' />
      ) : total === 0 ? (
        <Empty className='min-h-48 border border-dashed'>
          <EmptyHeader>
            <EmptyTitle>{t('materials.noHistory')}</EmptyTitle>
            <EmptyDescription>
              {t('materials.noHistoryDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='flex flex-col gap-4'>
          {data.data.data.map((row) => {
            const kindText = text(row.kind);
            const kind = kinds.includes(kindText as Kind)
              ? (kindText as Kind)
              : undefined;
            return (
              <Card key={row.id}>
                <CardHeader>
                  <CardTitle>
                    {text(row.recordName)} ·{' '}
                    {t(`materials.transitions.${text(row.operation)}`)}
                  </CardTitle>
                  <CardDescription>
                    {t(
                      kind
                        ? `materials.kinds.${kindText}`
                        : 'materials.historicalRecords',
                    )}{' '}
                    · {text(row.actorName)} ·{' '}
                    {new Date(text(row.createdAt)).toLocaleString(
                      i18n.language,
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {row.operation === 'create' &&
                  row.reason === 'create' ? null : (
                    <LongText>
                      {row.reason === 'categoryMigration'
                        ? t('materials.categoryMigration')
                        : sourceReason(row.reason)}
                    </LongText>
                  )}
                  <details className='mt-3'>
                    <summary className='cursor-pointer text-sm text-primary'>
                      {t('materials.changeDetails')}
                    </summary>
                    <div className='mt-3'>
                      <MaterialAuditChanges
                        kind={kind}
                        before={row.beforeValue}
                        after={row.afterValue}
                      />
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {total > 20 ? (
        <div className='flex flex-wrap justify-end gap-2'>
          <Button
            variant='outline'
            disabled={page <= 1 || data.isFetching}
            onClick={() => update('page', String(page - 1))}
          >
            {t('materials.previous')}
          </Button>
          <span className='self-center text-sm'>
            {t('materials.page', { page, pages: Math.ceil(total / 20) })}
          </span>
          <Button
            variant='outline'
            disabled={page * 20 >= total || data.isFetching}
            onClick={() => update('page', String(page + 1))}
          >
            {t('materials.next')}
          </Button>
        </div>
      ) : null}
    </PageContainer>
  );
}
