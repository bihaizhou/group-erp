import { textValue } from './model.js';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useRef } from 'react';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { useUrlSearch } from '#hooks/use-url-search';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Input } from '#components/ui/input';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { LongText } from '#components/long-text';
import { PeopleLoading, PeopleErrorNotice, PeopleRefresh } from './controls.js';
import { ChangeList } from './change-list.js';
import { fieldChanges } from './field-changes.js';
import type { AuditRow, Kind } from './model.js';

export default function PeopleHistoryPage() {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    search = useUrlSearch({ resetParams: ['page'] });
  const data = useQuery({
    retry: false,
    queryKey: ['people-history', search.searchParams.toString()],
    queryFn: ({ signal }) =>
      api.request<{
        data: AuditRow[];
        meta: { total: number; page: number; pageSize: number };
      }>({
        path: 'people/history',
        query: Object.fromEntries(search.searchParams),
        signal,
      }),
  });
  const page = Number(search.searchParams.get('page') ?? 1);
  const searchRef = useRef<HTMLInputElement>(null);
  const clear = () => {
    search.clear((p) => p.delete('page'));
    searchRef.current?.focus();
  };
  return (
    <PageContainer>
      <PageHeader
        title={t('people.history')}
        description={t('people.historyDescription')}
        actions={
          <PeopleRefresh
            busy={data.isFetching}
            onClick={() => void data.refetch()}
          />
        }
      />
      <Input
        ref={searchRef}
        className='sm:max-w-xs'
        aria-label={t('people.search')}
        placeholder={t('people.search')}
        {...search.inputProps}
      />
      {data.isError ? (
        <PeopleErrorNotice
          error={data.error}
          retry={() => void data.refetch()}
        />
      ) : !data.data ? (
        <PeopleLoading />
      ) : (
        <>
          <div className='flex flex-col gap-4'>
            {data.data.data.map((row) => {
              const kind = textValue(row.kind) as Kind,
                changes = row.beforeValue
                  ? fieldChanges(kind, row.beforeValue, row.afterValue)
                  : [],
                reason = textValue(row.reason).trim(),
                showReason =
                  reason.length > 0 &&
                  !['create', 'save', 'update'].includes(reason.toLowerCase());
              return (
                <Card key={textValue(row.id)}>
                  <CardHeader>
                    <CardTitle>{textValue(row.recordName)}</CardTitle>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-3'>
                    <p className='text-sm text-muted-foreground'>
                      {t(`people.${textValue(row.kind)}`)} ·{' '}
                      {new Date(textValue(row.createdAt)).toLocaleString(
                        i18n.language,
                      )}{' '}
                      · {textValue(row.actorName)}
                    </p>
                    {showReason ? <LongText>{reason}</LongText> : null}
                    {changes.length ? (
                      <ChangeList
                        kind={kind}
                        before={row.beforeValue}
                        after={row.afterValue}
                      />
                    ) : (
                      <p className='text-sm text-muted-foreground'>
                        {row.beforeValue
                          ? t('people.audit.noFieldChanges')
                          : t('people.audit.created')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {!data.data.data.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <History />
                </EmptyMedia>
                <EmptyTitle>
                  {search.search
                    ? t('people.noResults')
                    : t('people.historyEmpty')}
                </EmptyTitle>
                <EmptyDescription>
                  {search.search
                    ? t('people.noResultsDescription')
                    : t('people.historyEmptyDescription')}
                </EmptyDescription>
              </EmptyHeader>
              {search.search ? (
                <EmptyContent>
                  <Button variant='outline' onClick={clear}>
                    {t('people.clearFilters')}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : null}
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline'
              disabled={page === 1}
              onClick={() =>
                search.updateParams((p) => p.set('page', textValue(page - 1)))
              }
            >
              {t('people.previous')}
            </Button>
            <Button
              variant='outline'
              disabled={page * 20 >= data.data.meta.total}
              onClick={() =>
                search.updateParams((p) => p.set('page', textValue(page + 1)))
              }
            >
              {t('people.next')}
            </Button>
          </div>
        </>
      )}
    </PageContainer>
  );
}
