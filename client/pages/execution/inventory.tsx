import { DatePicker } from '#components/date-picker';
import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { SupplyChainTable } from '#components/supply-chain-table';
import { StatusBadge } from '#components/status-badge';
import { formatStockQuantity } from '#lib/stock-quantity';
import { useUrlSearch } from '#hooks/use-url-search';
import { useExecutionCan, useExecutionQuery, ui } from './hooks.js';
import {
  EmptyState,
  ErrorNotice,
  Loading,
  Pagination,
  ReferencePicker,
  RefreshButton,
  StaticSelect,
} from './controls.js';
import type { Choice, Page } from './model.js';
export interface InventoryRow {
  id: string;
  subjectId: string;
  warehouseId: string | null;
  transferId: string | null;
  skuId: string;
  baseUnitId: string;
  quality: string;
  quantity: string;
  reservedQuantity?: string;
  available?: string;
  deltaQuantity?: string;
  remainingQuantity?: string;
  consumedQuantity?: string;
  releasedQuantity?: string;
  revision: number;
  createdAt?: string;
  material?: {
    code?: string;
    name?: string;
    specification?: string;
    baseUnitName?: string;
  };
  warehouse?: Choice | null;
  transfer?: Choice | null;
  source?: { id: string; code: string; kind?: string } | null;
  sourceKind?: 'issue' | 'sales';
  sourceRestricted?: boolean;
  consistent?: boolean;
  ledgerQuantity?: string;
  reservationQuantity?: string;
}
export default function InventoryPage() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    {
      searchParams: params,
      search,
      inputProps,
      updateParams,
      clear,
    } = useUrlSearch({ resetParams: ['page'] }),
    read = useExecutionCan('warehouse.inventory', 'read'),
    qualityAction = useExecutionCan('warehouse.documents', 'quality'),
    documentCreate = useExecutionCan('warehouse.documents', 'create'),
    reserve = useExecutionCan('warehouse.inventory', 'reserve'),
    release = useExecutionCan('warehouse.inventory', 'release'),
    reconcile = useExecutionCan('warehouse.inventory', 'reconcile'),
    view =
      ['balances', 'movements', 'reservations', 'reconcile'].find(
        (value) => value === params.get('view'),
      ) ?? 'balances',
    subjectId = params.get('subjectId') ?? '',
    warehouseId = params.get('warehouseId') ?? '',
    quality =
      ['qualified', 'inspection', 'frozen'].find(
        (value) => value === params.get('quality'),
      ) ?? '',
    page = Math.max(1, Math.trunc(Number(params.get('page'))) || 1),
    pageSize = 20,
    allowedSort =
      view === 'movements'
        ? ['occurredAt', '-occurredAt', 'deltaQuantity', '-deltaQuantity']
        : view === 'reservations'
          ? [
              'createdAt',
              '-createdAt',
              'remainingQuantity',
              '-remainingQuantity',
            ]
          : [
              'code',
              '-code',
              'quantity',
              '-quantity',
              'reservedQuantity',
              '-reservedQuantity',
              'available',
              '-available',
            ],
    orderBy = allowedSort.includes(params.get('orderBy') ?? '')
      ? params.get('orderBy')!
      : view === 'movements'
        ? '-occurredAt'
        : view === 'reservations'
          ? '-createdAt'
          : 'code',
    query = {
      subjectId,
      q: search,
      page,
      pageSize,
      orderBy,
      ...(warehouseId ? { warehouseId } : {}),
      ...(quality ? { quality } : {}),
      ...(params.get('transferId')
        ? { transferId: params.get('transferId')! }
        : {}),
      ...(view === 'movements'
        ? Object.fromEntries(
            ['from', 'to']
              .filter((key) =>
                /^\d{4}-\d{2}-\d{2}$/u.test(params.get(key) ?? ''),
              )
              .map((key) => [key, params.get(key)!]),
          )
        : {}),
      ...(params.get('skuId') ? { skuId: params.get('skuId')! } : {}),
    },
    path = `warehouse/inventory${view === 'balances' ? '' : `/${view}`}`,
    enabled = read.can && (view !== 'reconcile' || reconcile.can),
    result = useExecutionQuery<Page<InventoryRow>>(
      path,
      query,
      enabled && !!subjectId,
      true,
    ),
    warehouse = useExecutionQuery<{ data: Choice }>(
      `warehouse/inventory/warehouses/${warehouseId}`,
      { subjectId },
      read.can && !!subjectId && !!warehouseId,
    ),
    terminal =
      result.error instanceof ApiClientError &&
      [401, 403, 404].includes(result.error.status),
    rows = terminal ? [] : (result.data?.data ?? []),
    total = result.data?.meta.total ?? 0,
    change = (key: string, value: string) =>
      updateParams((next) => {
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
      }),
    facts = (row: InventoryRow, kind: string) => {
      const q = new URLSearchParams(location.search);
      q.set('subjectId', row.subjectId);
      return { pathname: `${row.id}/${kind}`, search: q.toString() };
    };
  useEffect(() => {
    if (
      result.data &&
      !result.isPlaceholderData &&
      page > Math.max(1, Math.ceil(total / pageSize))
    )
      change('page', String(Math.max(1, Math.ceil(total / pageSize))));
  });
  const quantity = (field: keyof InventoryRow, row: InventoryRow) => {
      const value = row[field];
      return (
        <span className='whitespace-nowrap tabular-nums'>
          {typeof value === 'string'
            ? formatStockQuantity(value, i18n.language)
            : '—'}{' '}
          {row.material?.baseUnitName ?? ''}
        </span>
      );
    },
    columns: ColumnDef<InventoryRow>[] = [
      {
        id: 'code',
        accessorFn: (row) => row.material?.code,
        header: t(ui('material')),
        enableSorting: view === 'balances' || view === 'reconcile',
        cell: ({ row }) => (
          <div className='max-w-xs'>
            <p className='font-medium'>{row.original.material?.name ?? '—'}</p>
            <p className='mt-1 text-xs text-muted-foreground'>
              {row.original.material?.code ?? '—'} ·{' '}
              {row.original.material?.specification ?? ''}
            </p>
          </div>
        ),
      },
      {
        id: 'dimension',
        header: t(ui('warehouse')),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.transfer ? (
            <div>
              <p className='text-sm'>{t(ui('transit'))}</p>
              <p className='text-xs text-muted-foreground'>
                {row.original.transfer.code}
              </p>
            </div>
          ) : (
            (row.original.warehouse?.name ?? warehouse.data?.data.name ?? '—')
          ),
      },
      {
        id: 'quality',
        header: t(ui('quality')),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            tone={
              row.original.quality === 'qualified'
                ? 'success'
                : row.original.quality === 'inspection'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {t(ui(`qualities.${row.original.quality}`))}
          </StatusBadge>
        ),
      },
      ...(view === 'movements'
        ? [
            {
              accessorKey: 'deltaQuantity',
              header: t(ui('quantity')),
              enableSorting: true,
              cell: ({ row }: { row: { original: InventoryRow } }) =>
                quantity('deltaQuantity', row.original),
            },
            {
              accessorKey: 'occurredAt',
              header: t(ui('occurredOn')),
              enableSorting: true,
              cell: ({ row }: { row: { original: InventoryRow } }) =>
                row.original.createdAt
                  ? new Date(row.original.createdAt).toLocaleString(
                      i18n.language,
                    )
                  : '—',
            },
          ]
        : view === 'reservations'
          ? [
              {
                accessorKey: 'quantity',
                header: t(ui('originalReservation')),
                enableSorting: false,
                cell: ({ row }: { row: { original: InventoryRow } }) =>
                  quantity('quantity', row.original),
              },
              {
                accessorKey: 'remainingQuantity',
                header: t(ui('reservedQuantity')),
                enableSorting: true,
                cell: ({ row }: { row: { original: InventoryRow } }) =>
                  quantity('remainingQuantity', row.original),
              },
              {
                accessorKey: 'createdAt',
                header: t(ui('createdAt')),
                enableSorting: true,
                cell: ({ row }: { row: { original: InventoryRow } }) =>
                  row.original.createdAt
                    ? new Date(row.original.createdAt).toLocaleString(
                        i18n.language,
                      )
                    : '—',
              },
            ]
          : [
              {
                accessorKey: 'quantity',
                header: t(ui('onHand')),
                enableSorting: true,
                cell: ({ row }: { row: { original: InventoryRow } }) =>
                  quantity('quantity', row.original),
              },
              {
                accessorKey: 'reservedQuantity',
                header: t(ui('reservedQuantity')),
                enableSorting: true,
                cell: ({ row }: { row: { original: InventoryRow } }) =>
                  quantity('reservedQuantity', row.original),
              },
              {
                accessorKey: 'available',
                header: t(ui('available')),
                enableSorting: true,
                cell: ({ row }: { row: { original: InventoryRow } }) =>
                  quantity('available', row.original),
              },
            ]),
      ...(view === 'reconcile'
        ? [
            {
              id: 'consistent',
              header: t(ui('reconcile')),
              enableSorting: false,
              cell: ({ row }: { row: { original: InventoryRow } }) => (
                <StatusBadge
                  tone={row.original.consistent ? 'success' : 'warning'}
                >
                  {t(
                    ui(row.original.consistent ? 'consistent' : 'inconsistent'),
                  )}
                </StatusBadge>
              ),
            },
          ]
        : view === 'movements' || view === 'reservations'
          ? [
              {
                id: 'source',
                header: t(ui('source')),
                enableSorting: false,
                cell: ({ row }: { row: { original: InventoryRow } }) =>
                  row.original.source?.code ??
                  (row.original.sourceRestricted ? t(ui('restricted')) : '—'),
              },
            ]
          : []),
      {
        id: 'actions',
        header: t(ui('view')),
        enableSorting: false,
        cell: ({ row }) =>
          view === 'balances' || view === 'reconcile' ? (
            <div className='flex gap-2'>
              <Button
                variant='ghost'
                size='sm'
                nativeButton={false}
                render={<Link to={facts(row.original, 'movements')} />}
              >
                {t(ui('movements'))}
              </Button>
              {!row.original.transferId &&
                qualityAction.can &&
                documentCreate.can && (
                  <Button
                    variant='ghost'
                    size='sm'
                    nativeButton={false}
                    render={
                      <Link
                        to={{
                          pathname: '/functions/warehouse/inbounds/new',
                          search: new URLSearchParams({
                            subjectId: row.original.subjectId,
                            warehouseId: row.original.warehouseId ?? '',
                            kind: 'qualityTransfer',
                          }).toString(),
                        }}
                      />
                    }
                  >
                    {t(ui('actions.quality'))}
                  </Button>
                )}
              {!row.original.transferId && (
                <Button
                  variant='ghost'
                  size='sm'
                  nativeButton={false}
                  render={<Link to={facts(row.original, 'reservations')} />}
                >
                  {t(ui('reservations'))}
                </Button>
              )}
            </div>
          ) : view === 'reservations' &&
            release.can &&
            row.original.remainingQuantity !== '0' ? (
            <Button
              variant='outline'
              size='sm'
              disabled={result.isPlaceholderData}
              nativeButton={false}
              render={
                <Link
                  to={{
                    pathname: `${row.original.id}/release`,
                    search: location.search,
                  }}
                />
              }
            >
              {t(ui('release'))}
            </Button>
          ) : null,
      },
    ];
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t(ui('inventory'))}
          description={t(ui('inventoryHint'))}
          actions={
            <>
              <RefreshButton
                busy={result.isFetching}
                onClick={() => void result.refetch()}
              />
              {reserve.can && (
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      to={{ pathname: 'reserve', search: location.search }}
                    />
                  }
                >
                  <Plus />
                  {t(ui('reserve'))}
                </Button>
              )}
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
                      queryPath='warehouse/inventory/warehouses'
                      query={{ subjectId }}
                      value={warehouseId}
                      selected={warehouse.data?.data}
                      onChange={(value) => change('warehouseId', value)}
                    />
                  </div>
                  <div className='min-w-48 flex-1'>
                    <ReferencePicker<Choice>
                      label={t(ui('transfer'))}
                      queryPath='warehouse/inventory/transferOptions'
                      query={{ subjectId }}
                      value={params.get('transferId') ?? ''}
                      selectedLabel={(value) => value.code}
                      onChange={(value) => change('transferId', value)}
                    />
                  </div>
                  {view === 'movements' &&
                    ['from', 'to'].map((key) => (
                      <div key={key} className='min-w-40 flex-1'>
                        <DatePicker
                          label={t(ui(key))}
                          value={params.get(key) ?? ''}
                          onChange={(value) => change(key, value)}
                        />
                      </div>
                    ))}
                  <div className='min-w-48 flex-1'>
                    <Input
                      {...inputProps}
                      aria-label={t(ui('searchMaterials'))}
                      placeholder={t(ui('searchMaterials'))}
                      maxLength={200}
                    />
                  </div>
                  <div className='min-w-40 flex-1'>
                    <StaticSelect
                      label={t(ui('quality'))}
                      value={quality}
                      items={[
                        { value: '', label: t(ui('allQualities')) },
                        ...['qualified', 'inspection', 'frozen'].map(
                          (value) => ({
                            value,
                            label: t(ui(`qualities.${value}`)),
                          }),
                        ),
                      ]}
                      onChange={(value) => change('quality', value)}
                    />
                  </div>
                  {(search ||
                    warehouseId ||
                    quality ||
                    params.get('transferId') ||
                    params.get('from') ||
                    params.get('to')) && (
                    <Button
                      variant='ghost'
                      onClick={() =>
                        clear((next) => {
                          for (const key of [
                            'warehouseId',
                            'quality',
                            'skuId',
                            'transferId',
                            'from',
                            'to',
                            'page',
                          ])
                            next.delete(key);
                        })
                      }
                    >
                      {t(ui('clearFilters'))}
                    </Button>
                  )}
                </>
              )}
            </div>
            <nav
              className='flex flex-wrap gap-1 border-b pb-2'
              aria-label={t(ui('inventoryViews'))}
            >
              {[
                'balances',
                'movements',
                'reservations',
                ...(reconcile.can ? ['reconcile'] : []),
              ].map((value) => (
                <Button
                  key={value}
                  variant={view === value ? 'secondary' : 'ghost'}
                  aria-current={view === value ? 'page' : undefined}
                  onClick={() =>
                    updateParams((next) => {
                      next.set('view', value);
                      next.delete('page');
                      next.delete('orderBy');
                    })
                  }
                >
                  {t(ui(value === 'balances' ? 'inventory' : value))}
                </Button>
              ))}
            </nav>
            {!enabled ? (
              <EmptyState type='restricted' />
            ) : (
              <>
                {result.error && (
                  <ErrorNotice
                    error={result.error}
                    retry={() => void result.refetch()}
                  />
                )}{' '}
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
                              : allowedSort[0],
                          );
                        }}
                        busy={result.isFetching}
                        empty={
                          <EmptyState
                            type={
                              search || quality || warehouseId
                                ? 'noMatches'
                                : 'empty'
                            }
                          />
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
            )}
          </>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
