import { useOptions } from './hooks.js';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { History, ArrowDownUpIcon } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { LongTextPreview } from '#components/long-text';
import { useUrlSearch } from '#hooks/use-url-search';
import { ErrorNotice, Loading } from './shared.js';
import { displayValue } from './formatting.js';
type Audit = {
  id: string;
  kind: string;
  recordName: string;
  operation: string;
  actorName: string;
  reason: string;
  createdAt: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
};
export default function OrganizationHistory() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const search = useUrlSearch({ resetParams: ['page'] });
  const options = useOptions();
  const params = search.searchParams;
  const result = useQuery({
    queryKey: ['org-history', params.toString()],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.request<{
        data: Audit[];
        meta: { page: number; pageSize: number; total: number };
      }>({
        path: 'organization/history',
        query: {
          q: search.search,
          page: Number(params.get('page') ?? 1),
          orderBy: params.get('orderBy') ?? '-createdAt',
        },
        signal,
      }),
  });
  const data = result.data;
  return (
    <PageContainer>
      <PageHeader title={t('org.history')} description={t('org.reasonHint')} />
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='sm:max-w-xs'
          placeholder={t('org.searchHistory')}
          aria-label={t('org.searchHistory')}
          {...search.inputProps}
        />
        {search.search ? (
          <Button variant='ghost' onClick={() => search.clear()}>
            {t('org.clear')}
          </Button>
        ) : null}
      </div>
      {result.isError ? (
        <ErrorNotice error={result.error} retry={() => void result.refetch()} />
      ) : !data ? (
        <Loading />
      ) : !data.data.length ? (
        <Empty className='min-h-48 border border-dashed'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <History />
            </EmptyMedia>
            <EmptyTitle>
              {t(search.search ? 'org.noResults' : 'org.empty', {
                kind: t('org.history'),
              })}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                search.search
                  ? 'org.noResultsDescription'
                  : 'org.emptyDescription',
              )}
            </EmptyDescription>
          </EmptyHeader>
          {search.search ? (
            <Button variant='outline' onClick={() => search.clear()}>
              {t('org.clear')}
            </Button>
          ) : null}
        </Empty>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                {['recordName', 'kind', 'operation', 'actorName', 'reason'].map(
                  (key) => (
                    <TableHead key={key}>{t(`org.fields.${key}`)}</TableHead>
                  ),
                )}
                <TableHead>
                  <Button
                    size='sm'
                    variant='ghost'
                    aria-label={t('org.sortCreated')}
                    onClick={() =>
                      search.updateParams((p) => {
                        p.set(
                          'orderBy',
                          p.get('orderBy') === 'createdAt'
                            ? '-createdAt'
                            : 'createdAt',
                        );
                        p.delete('page');
                      })
                    }
                  >
                    <ArrowDownUpIcon />
                    {t('org.fields.createdAt')}
                    {params.get('orderBy') === 'createdAt' ? ' ↑' : ' ↓'}
                  </Button>
                </TableHead>
                <TableHead>{t('org.changed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className='font-medium'>
                    {row.recordName}
                  </TableCell>
                  <TableCell>{t(`org.${row.kind}`)}</TableCell>
                  <TableCell>{t(`org.operations.${row.operation}`)}</TableCell>
                  <TableCell>{row.actorName}</TableCell>
                  <TableCell className='min-w-40 max-w-64'>
                    <LongTextPreview label={t('org.fields.reason')} lines={1}>
                      {row.reason === 'Initial creation'
                        ? t('org.operations.create')
                        : row.reason}
                    </LongTextPreview>
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    {new Date(row.createdAt).toLocaleString(i18n.language)}
                  </TableCell>
                  <TableCell>
                    <details>
                      <summary className='cursor-pointer text-primary'>
                        {t('org.snapshot')}
                      </summary>
                      <dl className='mt-3 flex flex-col gap-3'>
                        {Object.entries(row.afterValue)
                          .filter(
                            ([key, value]) =>
                              ![
                                'id',
                                'createdAt',
                                'updatedAt',
                                'version',
                              ].includes(key) &&
                              JSON.stringify(value) !==
                                JSON.stringify(row.beforeValue?.[key]),
                          )
                          .map(([key, value]) => (
                            <div key={key}>
                              <dt className='text-xs text-muted-foreground'>
                                {t(`org.fields.${key}`)}
                              </dt>
                              <dd className='text-sm break-words'>
                                {displayValue(
                                  key,
                                  row.beforeValue?.[key],
                                  options.data?.data,
                                  (k) => t(k),
                                  i18n.language,
                                )}{' '}
                                →{' '}
                                {displayValue(
                                  key,
                                  value,
                                  options.data?.data,
                                  (k) => t(k),
                                  i18n.language,
                                )}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data && data.meta.total > 0 ? (
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <span className='text-sm text-muted-foreground'>
            {t('org.page', {
              page: data.meta.page,
              pages: Math.max(1, Math.ceil(data.meta.total / 20)),
              total: data.meta.total,
            })}
          </span>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              disabled={data.meta.page <= 1 || result.isFetching}
              onClick={() =>
                search.updateParams((p) =>
                  p.set('page', String(data.meta.page - 1)),
                )
              }
            >
              {t('org.previous')}
            </Button>
            <Button
              variant='outline'
              disabled={
                data.meta.page * 20 >= data.meta.total || result.isFetching
              }
              onClick={() =>
                search.updateParams((p) =>
                  p.set('page', String(data.meta.page + 1)),
                )
              }
            >
              {t('org.next')}
            </Button>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
