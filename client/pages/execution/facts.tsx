import { useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { SupplyChainTable } from '#components/supply-chain-table';
import { formatStockQuantity } from '#lib/stock-quantity';
import { useExecutionQuery, ui } from './hooks.js';
import { Loading, ErrorNotice, Pagination, EmptyState } from './controls.js';
import type { Page } from './model.js';
import type { InventoryRow } from './inventory.js';
export default function InventoryFacts() {
  const { balanceId, factKind } = useParams(),
    { t, i18n } = useTranslation(),
    [page, setPage] = useState(1),
    kind = factKind === 'reservations' ? 'reservations' : 'movements',
    balance = useExecutionQuery<{ data: InventoryRow }>(
      `warehouse/inventory/balances/${balanceId}`,
      {},
      !!balanceId,
    ),
    dimension = balance.data?.data;
  const rows = useExecutionQuery<Page<InventoryRow>>(
      `warehouse/inventory/${kind}`,
      {
        subjectId: dimension?.subjectId ?? '',
        balanceId: balanceId ?? '',
        page,
        pageSize: 20,
        ...(dimension?.warehouseId
          ? { warehouseId: dimension.warehouseId }
          : { transferId: dimension?.transferId ?? '' }),
      },
      !!dimension,
      true,
    ),
    quantity = (value?: string) =>
      value === undefined
        ? '—'
        : `${formatStockQuantity(value, i18n.language)} ${dimension?.material?.baseUnitName ?? ''}`;
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton />
        <PageHeader
          title={t(ui(kind))}
          description={
            dimension
              ? `${dimension.material?.code ?? ''} · ${dimension.material?.name ?? ''} · ${dimension.warehouse?.name ?? dimension.transfer?.code ?? ''} · ${t(ui(`qualities.${dimension.quality}`))}`
              : t(ui('loading'))
          }
        />
        {balance.error ? (
          <ErrorNotice
            error={balance.error}
            retry={() => void balance.refetch()}
          />
        ) : balance.isPending ? (
          <Loading kind='detail' />
        ) : (
          <>
            {rows.error && (
              <ErrorNotice
                error={rows.error}
                retry={() => void rows.refetch()}
              />
            )}
            <SupplyChainTable
              rows={rows.data?.data ?? []}
              sorting={[]}
              empty={<EmptyState />}
              total={rows.data?.meta.total ?? 0}
              page={page}
              pageSize={20}
              busy={rows.isFetching}
              columns={[
                {
                  id: 'source',
                  header: t(ui('source')),
                  cell: ({ row }) =>
                    row.original.source?.code ?? t(ui('restricted')),
                },
                {
                  id: 'quantity',
                  header: t(
                    ui(kind === 'movements' ? 'quantity' : 'reservedQuantity'),
                  ),
                  cell: ({ row }) =>
                    quantity(
                      kind === 'movements'
                        ? row.original.deltaQuantity
                        : row.original.remainingQuantity,
                    ),
                },
                {
                  id: 'createdAt',
                  header: t(ui('createdAt')),
                  cell: ({ row }) =>
                    row.original.createdAt
                      ? new Date(row.original.createdAt).toLocaleString(
                          i18n.language,
                        )
                      : '—',
                },
              ]}
            />
            <Pagination
              page={page}
              pageSize={20}
              total={rows.data?.meta.total ?? 0}
              onPage={setPage}
              busy={rows.isFetching}
            />
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
