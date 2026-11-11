import { ApiClientError } from '@nocobase/app-client';
import { AccessDenied } from '#components/access-denied';
import { useEffect } from 'react';
import { Link, Outlet, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ClipboardList,
  Plus,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { DateRangePicker } from '#components/date-picker';
import { useUrlSearch } from '#hooks/use-url-search';
import {
  ui,
  useIssueCan,
  useIssueQuery,
  useIssueReturnFocus,
} from './hooks.js';
import {
  Loading,
  ErrorNotice,
  IssueSelect,
  IssueStatus,
  Identification,
  Pagination,
  RefreshButton,
} from './controls.js';
import { OverflowText } from '../../materials/controls.js';
import { ServerTable } from './server-table.js';
import type { Choice, Page, IssueRequest } from './model.js';
export default function RequestsPage() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    read = useIssueCan('read'),
    create = useIssueCan('create'),
    edit = useIssueCan('update');
  useIssueReturnFocus(useResolvedPath('.').pathname, 'issue-search');
  const {
    searchParams: params,
    search,
    inputProps,
    updateParams,
    clear,
  } = useUrlSearch({ resetParams: ['page'] });
  const subjectId = params.get('subjectId') ?? '',
    page = Math.max(1, Math.trunc(Number(params.get('page'))) || 1),
    pageSize =
      [20, 50, 100].find((v) => String(v) === params.get('pageSize')) ?? 20;
  const orderBy = ['updatedAt', '-updatedAt', 'neededOn', '-neededOn'].includes(
    params.get('orderBy') ?? '',
  )
    ? params.get('orderBy')!
    : '-updatedAt';
  const status = ['draft', 'pending', 'approved', 'cancelled'].includes(
      params.get('status') ?? '',
    )
      ? params.get('status')!
      : '',
    identification = ['identified', 'unidentified'].includes(
      params.get('identification') ?? '',
    )
      ? params.get('identification')!
      : '';
  const date = (name: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(params.get(name) ?? '') ? params.get(name)! : '';
  const query = {
    subjectId,
    q: search,
    page,
    pageSize,
    orderBy,
    ...(status ? { status } : {}),
    ...(identification ? { identification } : {}),
    mine: params.get('mine') === 'true' ? 'true' : 'false',
    ...(date('neededFrom') ? { neededFrom: date('neededFrom') } : {}),
    ...(date('neededTo') ? { neededTo: date('neededTo') } : {}),
  };
  const result = useIssueQuery<Page<IssueRequest>>(
      'requests',
      query,
      !!subjectId && read.can,
      true,
    ),
    companies = useIssueQuery<Page<Choice>>(
      'requestCompanies',
      { page: 1, pageSize: 1 },
      read.can,
    );
  const change = (name: string, value: string) =>
    updateParams((p) => {
      if (value) p.set(name, value);
      else p.delete(name);
      p.delete('page');
    });
  const hasFilters = !!(
    search ||
    status ||
    identification ||
    params.get('mine') === 'true' ||
    date('neededFrom') ||
    date('neededTo')
  );
  const clearFilters = () =>
    clear((p) => {
      for (const name of [
        'status',
        'identification',
        'mine',
        'neededFrom',
        'neededTo',
        'page',
      ])
        p.delete(name);
    });
  const unavailable =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  const total = result.data?.meta.total ?? 0,
    rows = unavailable ? undefined : result.data?.data;
  useEffect(() => {
    if (result.data && page > Math.max(1, Math.ceil(total / pageSize)))
      updateParams((p) =>
        p.set('page', String(Math.max(1, Math.ceil(total / pageSize)))),
      );
  }, [result.data, total, page, pageSize, updateParams]);
  const newButton = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <Plus />
      {t(ui('create'))}
    </Button>
  );
  const columns: ColumnDef<IssueRequest>[] = (() => {
    const truncate = (value: string) => (
      <OverflowText text={value || '—'} className='block max-w-xs truncate' />
    );
    const sort = (field: string, label: string) => (
      <Button
        size='sm'
        variant='ghost'
        onClick={() =>
          change('orderBy', orderBy === field ? `-${field}` : field)
        }
        aria-label={`${t(ui(label))} · ${t(ui(orderBy === field ? 'sortDescending' : 'sortAscending'))}`}
      >
        {t(ui(label))}
        {orderBy.replace('-', '') === field ? (
          orderBy.startsWith('-') ? (
            <ArrowDown />
          ) : (
            <ArrowUp />
          )
        ) : null}
      </Button>
    );
    return [
      {
        id: 'code',
        header: t(ui('code')),
        cell: ({ row }) => (
          <Link
            className='font-medium text-primary underline-offset-4 hover:underline'
            to={{ pathname: row.original.id, search: location.search }}
          >
            <OverflowText
              text={row.original.code}
              className='block max-w-64 truncate'
            />
          </Link>
        ),
      },
      {
        id: 'requester',
        header: t(ui('requester')),
        cell: ({ row }) => truncate(row.original.display.requester?.name ?? ''),
      },
      {
        id: 'recipient',
        header: t(ui('recipient')),
        cell: ({ row }) => truncate(row.original.display.recipient?.name ?? ''),
      },
      {
        id: 'purpose',
        header: t(ui('purpose')),
        cell: ({ row }) =>
          truncate(
            (row.original.purposeSnapshot as { name?: string } | null)?.name ??
              '',
          ),
      },
      {
        id: 'unit',
        header: t(ui('unit')),
        cell: ({ row }) => truncate(row.original.display.unit?.name ?? ''),
      },
      {
        id: 'usage',
        header: t(ui('usage')),
        cell: ({ row }) => truncate(row.original.usage),
      },
      {
        id: 'neededOn',
        header: () => sort('neededOn', 'neededOn'),
        cell: ({ row }) =>
          row.original.neededOn
            ? new Date(`${row.original.neededOn}T12:00:00`).toLocaleDateString(
                i18n.language,
              )
            : '—',
      },
      {
        id: 'status',
        header: t(ui('reviewState')),
        cell: ({ row }) => <IssueStatus state={row.original.status} />,
      },
      {
        id: 'fulfillment',
        header: t(ui('fulfillment')),
        cell: ({ row }) => (
          <span className='text-sm'>
            {t(
              ui(
                row.original.fulfillmentStatus === 'open'
                  ? 'fulfillmentOpen'
                  : row.original.fulfillmentStatus === 'partial'
                    ? 'fulfillmentPartial'
                    : row.original.fulfillmentStatus === 'issued'
                      ? 'fulfillmentIssued'
                      : 'fulfillmentReceived',
              ),
            )}
          </span>
        ),
      },
      {
        id: 'identification',
        header: t(ui('identificationState')),
        cell: ({ row }) => (
          <Identification value={row.original.identificationStatus} />
        ),
      },
      {
        id: 'updatedAt',
        header: () => sort('updatedAt', 'updatedAt'),
        cell: ({ row }) =>
          new Date(row.original.updatedAt).toLocaleString(i18n.language),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t(ui('actionsFor'), { code: row.original.code })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent className='w-auto min-w-40'>
              <DropdownMenuItem
                render={
                  <Link
                    to={{ pathname: row.original.id, search: location.search }}
                  />
                }
              >
                {t(ui('view'))}
              </DropdownMenuItem>
              {edit.can && row.original.status === 'draft' && (
                <DropdownMenuItem
                  render={
                    <Link
                      to={{
                        pathname: `edit/${row.original.id}`,
                        search: location.search,
                      }}
                    />
                  }
                >
                  {t(ui('edit'))}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
  })();
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t(ui('title'))}
          description={t(ui('description'))}
          actions={
            <>
              {create.can && rows && (total > 0 || hasFilters)
                ? newButton
                : null}
              <RefreshButton
                busy={result.isFetching || companies.isFetching}
                onClick={() => {
                  if (subjectId && read.can) void result.refetch();
                  void companies.refetch();
                }}
              />
            </>
          }
        />
        <ReadOnlyNotice canManage={edit.can} />
        {read.isPending ? (
          <Loading kind='table' />
        ) : !read.can ? (
          <AccessDenied title={t(ui('forbidden'))} />
        ) : (
          <div className='flex flex-col gap-4'>
            <div className='flex flex-wrap items-end gap-3'>
              <Input
                {...inputProps}
                id='issue-search'
                aria-label={t(ui('search'))}
                placeholder={t(ui('search'))}
                maxLength={200}
                className='w-full sm:max-w-sm'
              />
              <div className='w-full sm:w-auto'>
                <IssueSelect
                  label={t(ui('reviewState'))}
                  value={status || 'all'}
                  items={[
                    'all',
                    'draft',
                    'pending',
                    'approved',
                    'cancelled',
                  ].map((value) => ({
                    value,
                    label: t(ui(value === 'all' ? 'allStatuses' : value)),
                  }))}
                  onChange={(v) => change('status', v === 'all' ? '' : v)}
                />
              </div>
              <div className='w-full sm:w-auto'>
                <IssueSelect
                  label={t(ui('identificationState'))}
                  value={identification || 'all'}
                  items={['all', 'identified', 'unidentified'].map((value) => ({
                    value,
                    label: t(ui(value === 'all' ? 'allIdentification' : value)),
                  }))}
                  onChange={(v) =>
                    change('identification', v === 'all' ? '' : v)
                  }
                />
              </div>
              <div className='w-full sm:w-auto'>
                <IssueSelect
                  label={t(ui('allRequests'))}
                  value={query.mine}
                  items={[
                    { value: 'false', label: t(ui('allRequests')) },
                    { value: 'true', label: t(ui('myRequests')) },
                  ]}
                  onChange={(v) => change('mine', v)}
                />
              </div>
              <DateRangePicker
                from={date('neededFrom')}
                to={date('neededTo')}
                businessDate={companies.data?.meta.businessDate}
                onChange={(from, to) =>
                  updateParams((p) => {
                    for (const [k, v] of [
                      ['neededFrom', from],
                      ['neededTo', to],
                    ]) {
                      if (v) p.set(k, v);
                      else p.delete(k);
                    }
                    p.delete('page');
                  })
                }
              />
              {hasFilters && (
                <Button variant='outline' onClick={clearFilters}>
                  {t(ui('clearFilters'))}
                </Button>
              )}
            </div>
            {result.error && (
              <ErrorNotice
                error={result.error}
                description={rows ? t(ui('refreshFailed')) : undefined}
                retry={() => void result.refetch()}
              />
            )}{' '}
            {unavailable ? null : !rows ? (
              result.error ? null : (
                <Loading kind='table' />
              )
            ) : total === 0 && !hasFilters ? (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <ClipboardList />
                  </EmptyMedia>
                  <EmptyTitle>{t(ui('emptyTitle'))}</EmptyTitle>
                  <EmptyDescription>
                    {t(ui(create.can ? 'emptyHint' : 'emptyReadOnly'))}
                  </EmptyDescription>
                </EmptyHeader>
                {create.can && <EmptyContent>{newButton}</EmptyContent>}
              </Empty>
            ) : (
              <div
                aria-busy={result.isFetching}
                className='flex flex-col gap-4'
              >
                <ServerTable
                  rows={rows}
                  columns={columns}
                  total={total}
                  page={page}
                  pageSize={pageSize}
                  sorting={[
                    {
                      id: orderBy.replace('-', ''),
                      desc: orderBy.startsWith('-'),
                    },
                  ]}
                  empty={
                    <div className='flex flex-col items-center gap-2'>
                      <span>{t(ui('noResults'))}</span>
                      <Button variant='link' onClick={clearFilters}>
                        {t(ui('clearFilters'))}
                      </Button>
                    </div>
                  }
                />
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <IssueSelect
                    label={t(ui('perPage'), { size: pageSize })}
                    value={String(pageSize)}
                    items={[20, 50, 100].map((n) => ({
                      value: String(n),
                      label: t(ui('perPage'), { size: n }),
                    }))}
                    onChange={(v) => change('pageSize', v)}
                  />
                  <Pagination
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    busy={result.isFetching}
                    onPage={(p) =>
                      updateParams((next) => next.set('page', String(p)))
                    }
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
