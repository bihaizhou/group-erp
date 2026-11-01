import { useEffect } from 'react';
import { Link, Outlet, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError } from '@nocobase/app-client';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { SupplyChainTable } from '#components/supply-chain-table';
import { DateRangePicker } from '#components/date-picker';
import { useUrlSearch } from '#hooks/use-url-search';
import {
  ui,
  useExecutionCan,
  useExecutionQuery,
  useReturnFocus,
} from './hooks.js';
import {
  Loading,
  ErrorNotice,
  EmptyState,
  ReferencePicker,
  Pagination,
  RefreshButton,
  RecordStatus,
  StaticSelect,
  OverflowText,
} from './controls.js';
import {
  pageFor,
  isOrder,
  lineFacts,
  type ExecutionRecord,
  type Choice,
  type Page,
} from './model.js';

export default function ExecutionList() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    config = pageFor(useResolvedPath('.').pathname),
    read = useExecutionCan(config.resource, 'read'),
    create = useExecutionCan(config.resource, 'create'),
    edit = useExecutionCan(config.resource, 'update');
  const {
    searchParams: params,
    search,
    inputProps,
    updateParams,
    clear,
  } = useUrlSearch({ resetParams: ['page'] });
  useReturnFocus(useResolvedPath('.').pathname, `${config.page}-search`);
  const subjectId = params.get('subjectId') ?? '',
    warehouseId = params.get('warehouseId') ?? '',
    page = Math.max(1, Math.trunc(Number(params.get('page'))) || 1),
    pageSize =
      [20, 50, 100].find((size) => String(size) === params.get('pageSize')) ??
      20,
    allowedSort = [
      'code',
      '-code',
      'updatedAt',
      '-updatedAt',
      ...(isOrder(config)
        ? ['deliveryOn', '-deliveryOn']
        : config.kind === 'stockCounts'
          ? ['baselineAt', '-baselineAt']
          : ['occurredOn', '-occurredOn']),
    ],
    orderBy = allowedSort.includes(params.get('orderBy') ?? '')
      ? params.get('orderBy')!
      : '-updatedAt',
    status =
      ['draft', 'counting', 'pending', 'approved', 'posted', 'cancelled'].find(
        (value) => value === params.get('status'),
      ) ?? '',
    direction =
      config.kind === 'inbounds'
        ? 'inbound'
        : config.kind === 'outbounds'
          ? 'outbound'
          : undefined,
    date = (name: string) =>
      /^\d{4}-\d{2}-\d{2}$/u.test(params.get(name) ?? '')
        ? params.get(name)!
        : '',
    query = {
      subjectId,
      q: search,
      page,
      pageSize,
      orderBy,
      ...(warehouseId ? { warehouseId } : {}),
      ...(status ? { status } : {}),
      ...(direction ? { direction } : {}),
      ...(date('from') ? { from: date('from') } : {}),
      ...(date('to') ? { to: date('to') } : {}),
    };
  const result = useExecutionQuery<Page<ExecutionRecord>>(
      config.api,
      query,
      read.can && !!subjectId,
      true,
    ),
    selectedWarehouse = useExecutionQuery<{ data: Choice }>(
      `${config.api}/warehouses/${warehouseId}`,
      { subjectId },
      read.can && !!subjectId && !!warehouseId,
    ),
    terminal =
      result.error instanceof ApiClientError &&
      [401, 403, 404].includes(result.error.status),
    rows = terminal ? [] : (result.data?.data ?? []),
    total = terminal ? 0 : (result.data?.meta.total ?? 0);
  const change = (name: string, value: string) =>
    updateParams((next) => {
      if (value) next.set(name, value);
      else next.delete(name);
      if (name !== 'page') next.delete('page');
    });
  useEffect(() => {
    if (
      result.data &&
      !result.isPlaceholderData &&
      page > Math.max(1, Math.ceil(total / pageSize))
    )
      updateParams((next) =>
        next.set('page', String(Math.max(1, Math.ceil(total / pageSize)))),
      );
  }, [
    result.data,
    result.isPlaceholderData,
    page,
    total,
    pageSize,
    updateParams,
  ]);
  const hasFilters = !!(
      search ||
      status ||
      warehouseId ||
      date('from') ||
      date('to')
    ),
    reset = () =>
      clear((next) => {
        for (const name of ['warehouseId', 'status', 'from', 'to', 'page'])
          next.delete(name);
      }),
    newButton = (
      <Button
        nativeButton={false}
        render={<Link to={{ pathname: 'new', search: location.search }} />}
      >
        <Plus />
        {t(ui(`create.${config.kind}`))}
      </Button>
    );
  const columns: ColumnDef<ExecutionRecord>[] = [
    {
      accessorKey: 'code',
      header: t(ui('code')),
      enableSorting: true,
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
    ...(isOrder(config)
      ? [
          {
            id: 'partner',
            header: t(
              ui(config.kind === 'purchaseOrders' ? 'supplier' : 'customer'),
            ),
            enableSorting: false,
            cell: ({ row }: { row: { original: ExecutionRecord } }) => (
              <OverflowText
                text={row.original.display.partner?.name ?? '—'}
                className='block max-w-48 truncate'
              />
            ),
          },
        ]
      : config.kind === 'inbounds' || config.kind === 'outbounds'
        ? [
            {
              id: 'kind',
              header: t(ui('sourceType')),
              enableSorting: false,
              cell: ({ row }: { row: { original: ExecutionRecord } }) =>
                t(ui(`kinds.${row.original.kind}`)),
            },
          ]
        : []),
    {
      id: 'warehouse',
      header: t(ui('warehouse')),
      enableSorting: false,
      cell: ({ row }) => (
        <OverflowText
          text={row.original.display.warehouse?.name ?? '—'}
          className='block max-w-48 truncate'
        />
      ),
    },
    ...(config.kind === 'stockTransfers'
      ? [
          {
            id: 'destinationWarehouse',
            header: t(ui('destinationWarehouse')),
            enableSorting: false,
            cell: ({ row }: { row: { original: ExecutionRecord } }) => (
              <OverflowText
                text={row.original.display.destinationWarehouse?.name ?? '—'}
                className='block max-w-48 truncate'
              />
            ),
          },
        ]
      : []),
    {
      id: 'status',
      header: t(ui('status')),
      enableSorting: false,
      cell: ({ row }) => <RecordStatus status={row.original.status} />,
    },
    {
      id: 'progress',
      header: t(ui('lineProgress')),
      enableSorting: false,
      cell: ({ row }) => {
        const lines = row.original.lines ?? [],
          completed = lines.filter((line) =>
            config.kind === 'stockCounts'
              ? line.actualQuantity !== null &&
                line.actualQuantity !== undefined
              : row.original.status === 'posted' ||
                (lineFacts(line).remaining ??
                  lineFacts(line).transferRemaining) === '0',
          ).length;
        return row.original.linesRestricted
          ? t(ui('restricted'))
          : t(ui('completedLines'), { completed, total: lines.length });
      },
    },
    {
      accessorKey: isOrder(config)
        ? 'deliveryOn'
        : config.kind === 'stockCounts'
          ? 'baselineAt'
          : 'occurredOn',
      header: t(
        ui(
          isOrder(config)
            ? 'deliveryOn'
            : config.kind === 'stockCounts'
              ? 'baselineAt'
              : 'occurredOn',
        ),
      ),
      enableSorting: true,
      cell: ({ getValue }) => {
        const value = getValue<string | null>();
        return value
          ? new Date(
              value.includes('T') ? value : `${value}T12:00:00`,
            ).toLocaleDateString(i18n.language)
          : '—';
      },
    },
    {
      accessorKey: 'updatedAt',
      header: t(ui('updatedAt')),
      enableSorting: true,
      cell: ({ getValue }) => {
        const value = getValue<string>();
        return value ? new Date(value).toLocaleString(i18n.language) : '—';
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                size='icon'
                aria-label={t(ui('rowActions'), { name: row.original.code })}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-auto min-w-40'>
            <DropdownMenuItem
              render={
                <Link
                  to={{ pathname: row.original.id, search: location.search }}
                />
              }
            >
              {t(ui('view'))}
            </DropdownMenuItem>
            {edit.can &&
              ['draft', 'counting'].includes(row.original.status) && (
                <DropdownMenuItem
                  disabled={result.isPlaceholderData}
                  render={
                    <Link
                      to={{
                        pathname: `${row.original.id}/edit`,
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
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t(ui(`titles.${config.kind}`))}
          description={t(ui(`descriptions.${config.kind}`))}
          actions={
            <>
              <RefreshButton
                busy={result.isFetching}
                onClick={() => void result.refetch()}
              />
              {create.can && subjectId && newButton}
            </>
          }
        />
        {read.isPending ? (
          <Loading kind='table' />
        ) : !read.can ? (
          <EmptyState type='restricted' />
        ) : (
          <>
            <div className='flex flex-wrap items-end gap-3'>
              {subjectId && (
                <>
                  <div className='min-w-48 flex-1'>
                    <ReferencePicker<Choice>
                      label={t(ui('warehouse'))}
                      queryPath={`${config.api}/warehouses`}
                      query={{ subjectId }}
                      value={warehouseId}
                      selected={selectedWarehouse.data?.data}
                      onChange={(id) => change('warehouseId', id)}
                    />
                  </div>
                  <div className='min-w-48 flex-1'>
                    <Input
                      id={`${config.page}-search`}
                      {...inputProps}
                      aria-label={t(ui('searchRecords'))}
                      placeholder={t(ui('searchRecords'))}
                      maxLength={200}
                    />
                  </div>
                  <div className='min-w-48 flex-1'>
                    <StaticSelect
                      label={t(ui('status'))}
                      value={status}
                      items={[
                        { value: '', label: t(ui('allStates')) },
                        ...(config.kind === 'stockCounts'
                          ? [
                              'draft',
                              'counting',
                              'pending',
                              'posted',
                              'cancelled',
                            ]
                          : isOrder(config) || config.kind === 'stockTransfers'
                            ? ['draft', 'pending', 'approved', 'cancelled']
                            : [
                                'draft',
                                'pending',
                                'approved',
                                'posted',
                                'cancelled',
                              ]
                        ).map((value) => ({
                          value,
                          label: t(ui(`states.${value}`)),
                        })),
                      ]}
                      onChange={(value) => change('status', value)}
                    />
                  </div>
                  <DateRangePicker
                    from={date('from')}
                    to={date('to')}
                    businessDate={result.data?.meta.businessDate}
                    onChange={(from, to) =>
                      updateParams((next) => {
                        for (const [key, value] of Object.entries({
                          from,
                          to,
                        })) {
                          if (value) next.set(key, value);
                          else next.delete(key);
                        }
                        next.delete('page');
                      })
                    }
                  />
                  {hasFilters && (
                    <Button variant='ghost' onClick={reset}>
                      {t(ui('clearFilters'))}
                    </Button>
                  )}
                </>
              )}
            </div>
            <>
                {result.error && (
                  <ErrorNotice
                    error={result.error}
                    retry={() => void result.refetch()}
                  />
                )}
                {result.isStaleFallback && (
                  <p className='text-sm text-muted-foreground'>
                    {t(ui('previousResults'))}
                  </p>
                )}
                {result.isPending ? (
                  <Loading kind='table' />
                ) : (
                  !terminal && (
                    <>
                      <SupplyChainTable
                        rows={rows}
                        columns={columns}
                        total={total}
                        page={page}
                        pageSize={pageSize}
                        sorting={[
                          {
                            id: orderBy.replace(/^-/u, ''),
                            desc: orderBy.startsWith('-'),
                          },
                        ]}
                        onSorting={(sorting) => {
                          const current = sorting[0];
                          change(
                            'orderBy',
                            current
                              ? `${current.desc ? '-' : ''}${current.id}`
                              : '-updatedAt',
                          );
                        }}
                        busy={result.isFetching}
                        empty={
                          <EmptyState type={hasFilters ? 'noMatches' : 'empty'}>
                            {hasFilters ? (
                              <Button variant='outline' onClick={reset}>
                                {t(ui('clearFilters'))}
                              </Button>
                            ) : create.can ? (
                              newButton
                            ) : null}
                          </EmptyState>
                        }
                      />
                      <Pagination
                        page={page}
                        pageSize={pageSize}
                        total={total}
                        busy={result.isFetching}
                        onPage={(value) => change('page', String(value))}
                      />
                    </>
                  )
                )}
            </>
          </>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
