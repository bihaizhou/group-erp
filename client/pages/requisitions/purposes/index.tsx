import { ApiClientError } from '@nocobase/app-client';
import { AccessDenied } from '#components/access-denied';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Plus, Tags } from 'lucide-react';
import { useUrlSearch } from '#hooks/use-url-search';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { OverflowText } from '../../materials/controls.js';
import { StatusBadge } from '#components/status-badge';
import {
  Loading,
  ErrorNotice,
  Pagination,
  RefreshButton,
  IssueSelect,
} from '../requests/controls.js';
import { ui, useIssueQuery } from '../requests/hooks.js';
import type { Page } from '../requests/model.js';
import { purposeUi as pui, usePurposeCan, type Purpose } from './model.js';

export default function PurposesPage() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    create = usePurposeCan('create'),
    read = usePurposeCan('read');
  const {
    searchParams: params,
    search,
    inputProps,
    updateParams,
    clear,
  } = useUrlSearch({ resetParams: ['page'] });
  const subjectId = params.get('subjectId') ?? '',
    page = Math.max(1, Math.trunc(Number(params.get('page'))) || 1);
  const status = ['active', 'inactive'].includes(params.get('status') ?? '')
    ? params.get('status')!
    : '';
  const order = ['updatedAt', '-updatedAt', 'code', '-code'].includes(
    params.get('orderBy') ?? '',
  )
    ? params.get('orderBy')!
    : '-updatedAt';
  const result = useIssueQuery<Page<Purpose>>(
    'purposes',
    {
      subjectId,
      q: search,
      page,
      pageSize: 20,
      orderBy: order,
      ...(status ? { status } : {}),
    },
    !!subjectId && read.can,
    true,
  );
  const terminal =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  if (read.isPending || !read.can)
    return (
      <PageContainer>
        <PageHeader
          title={t(pui('title'))}
          description={t(pui('description'))}
        />
        {read.isPending ? (
          <Loading kind='table' />
        ) : (
          <AccessDenied title={t(ui('forbidden'))} />
        )}
      </PageContainer>
    );
  const filtered = !!search || !!status,
    rows = result.data?.data ?? [];
  const newButton = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <Plus />
      {t(pui('create'))}
    </Button>
  );
  const set = (changes: Record<string, string | null>) =>
    updateParams((p) => {
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) p.delete(key);
        else p.set(key, value);
      }
    });
  const resetFilters = () =>
    clear((p) => {
      p.delete('status');
      p.delete('page');
    });
  const sort = (field: string, key: string) => (
    <Button
      variant='ghost'
      size='sm'
      onClick={() =>
        set({ orderBy: order === field ? `-${field}` : field, page: null })
      }
    >
      {t(pui(key))}
      {order.replace('-', '') === field
        ? order.startsWith('-')
          ? ' ↓'
          : ' ↑'
        : ''}
    </Button>
  );
  return (
    <PageContainer>
      <PageHeader
        title={t(pui('title'))}
        description={t(pui('description'))}
        actions={
          <>
            {subjectId &&
              result.data &&
              (rows.length > 0 || filtered) &&
              create.can &&
              newButton}
            {subjectId && (
              <RefreshButton
                busy={result.isFetching}
                onClick={() => void result.refetch()}
              />
            )}
          </>
        }
      />
      {subjectId && (
        <div className='flex flex-wrap gap-2'>
          <Input
            id='issue-purpose-search'
            className='w-full sm:max-w-xs'
            {...inputProps}
            placeholder={t(pui('search'))}
            aria-label={t(pui('search'))}
            maxLength={200}
          />
          <div className='w-full sm:w-40'>
            <IssueSelect
              value={status || 'all'}
              items={['all', 'active', 'inactive'].map((value) => ({
                value,
                label: t(pui(value === 'all' ? 'anyStatus' : value)),
              }))}
              label={t(pui('status'))}
              onChange={(v) =>
                set({ status: v === 'all' ? null : v, page: null })
              }
            />
          </div>
          {filtered && (
            <Button variant='outline' onClick={() => resetFilters()}>
              {t(pui('clear'))}
            </Button>
          )}
        </div>
      )}
      {Boolean(subjectId && result.error && result.data && !terminal) && (
        <ErrorNotice error={result.error} retry={() => void result.refetch()} />
      )}
      {result.isStaleFallback && (
        <p className='text-sm text-muted-foreground'>
          {t(ui('previousResults'))}
        </p>
      )}
      {result.error && (!result.data || terminal) ? (
        <ErrorNotice error={result.error} retry={() => void result.refetch()} />
      ) : result.isPending ? (
        <Loading kind='table' />
      ) : !rows.length ? (
        <Empty className='min-h-48 border border-dashed'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Tags />
            </EmptyMedia>
            <EmptyTitle>{t(pui(filtered ? 'noResults' : 'empty'))}</EmptyTitle>
            <EmptyDescription>
              {t(
                filtered
                  ? ui('noResultsHint')
                  : pui(create.can ? 'emptyHint' : 'emptyReadOnly'),
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button variant='outline' onClick={() => resetFilters()}>
                {t(pui('clear'))}
              </Button>
            ) : (
              create.can && newButton
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div
            aria-busy={result.isFetching}
            className='overflow-hidden rounded-lg border'
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{sort('code', 'code')}</TableHead>
                  <TableHead>{t(pui('name'))}</TableHead>
                  <TableHead>{t(pui('status'))}</TableHead>
                  <TableHead>{sort('updatedAt', 'updatedAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        className='font-medium text-primary underline underline-offset-4'
                        to={{ pathname: row.id, search: location.search }}
                      >
                        {row.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <OverflowText
                        text={row.name}
                        className='block max-w-sm truncate'
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={row.status === 'active' ? 'success' : 'neutral'}
                      >
                        {t(pui(row.status))}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {new Date(row.updatedAt).toLocaleString(i18n.language)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            total={result.data?.meta.total ?? 0}
            onPage={(value) => set({ page: String(value) })}
            busy={result.isFetching}
          />
        </>
      )}
      <Outlet />
    </PageContainer>
  );
}
