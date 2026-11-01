import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useSearchParams } from 'react-router';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Boxes,
} from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  DashboardMetric,
  DashboardMetricGrid,
  DashboardRefresh,
  DashboardStatus,
  DashboardTableCard,
  DashboardTodoCard,
  DashboardViewAll,
  formatDashboardDate,
  useDashboardCount,
  useDashboardList,
  useDashboardRefresh,
} from '#components/module-dashboard/index';
import { TableCell, TableRow } from '#components/ui/table';

type DocumentRow = {
  id: string;
  code: string;
  kind: string;
  status: string;
  occurredOn: string;
};

export default function WarehouseOverviewPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const subjectId = params.get('subjectId') ?? '';
  const { refresh, busy } = useDashboardRefresh();
  const documents = useCan({
    resource: { type: 'composite', id: 'warehouse.documents' },
    action: 'read',
  });
  const inventory = useCan({
    resource: { type: 'composite', id: 'warehouse.inventory' },
    action: 'read',
  });
  const transfers = useCan({
    resource: { type: 'composite', id: 'warehouse.transfers' },
    action: 'read',
  });
  const enabled = Boolean(subjectId);

  const inboundCount = useDashboardCount(
    'warehouse',
    'inboundDocuments',
    'warehouse/documents',
    { subjectId, direction: 'inbound' },
    enabled && documents.can,
  );
  const outboundCount = useDashboardCount(
    'warehouse',
    'outboundDocuments',
    'warehouse/documents',
    { subjectId, direction: 'outbound' },
    enabled && documents.can,
  );
  const inventoryCount = useDashboardCount(
    'warehouse',
    'inventoryItems',
    'warehouse/inventory',
    { subjectId },
    enabled && inventory.can,
  );
  const pendingTransfers = useDashboardCount(
    'warehouse',
    'pendingTransfers',
    'warehouse/transfers',
    { subjectId, status: 'pending' },
    enabled && transfers.can,
  );
  const recentInbounds = useDashboardList<DocumentRow>(
    'warehouse',
    'recentInbounds',
    'warehouse/documents',
    { subjectId, direction: 'inbound' },
    enabled && documents.can,
  );
  const recentOutbounds = useDashboardList<DocumentRow>(
    'warehouse',
    'recentOutbounds',
    'warehouse/documents',
    { subjectId, direction: 'outbound' },
    enabled && documents.can,
  );

  const withCompany = (path: string) =>
    `${path}${path.includes('?') ? '&' : '?'}subjectId=${subjectId}`;

  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.warehouse.title')}
        description={t('dashboard.warehouse.description')}
        actions={<DashboardRefresh busy={busy} onClick={refresh} />}
      />
      <DashboardMetricGrid>
        {documents.can ? (
          <DashboardMetric
            label={t('dashboard.warehouse.metrics.inboundDocuments')}
            value={inboundCount.data}
            isLoading={inboundCount.isPending}
            icon={ArrowDownToLine}
            to={withCompany('/functions/warehouse/inbounds')}
          />
        ) : null}
        {documents.can ? (
          <DashboardMetric
            label={t('dashboard.warehouse.metrics.outboundDocuments')}
            value={outboundCount.data}
            isLoading={outboundCount.isPending}
            icon={ArrowUpFromLine}
            to={withCompany('/functions/warehouse/outbounds')}
          />
        ) : null}
        {inventory.can ? (
          <DashboardMetric
            label={t('dashboard.warehouse.metrics.inventoryItems')}
            value={inventoryCount.data}
            isLoading={inventoryCount.isPending}
            icon={Boxes}
            to={withCompany('/functions/warehouse/inventory')}
          />
        ) : null}
        {transfers.can ? (
          <DashboardMetric
            label={t('dashboard.warehouse.metrics.pendingTransfers')}
            value={pendingTransfers.data}
            isLoading={pendingTransfers.isPending}
            icon={ArrowLeftRight}
            to={withCompany('/functions/warehouse/transfers?status=pending')}
          />
        ) : null}
      </DashboardMetricGrid>
      <div className='grid gap-4 2xl:grid-cols-2'>
        {documents.can ? (
          <DashboardTableCard
            title={t('dashboard.warehouse.recentInbounds')}
            description={t('dashboard.warehouse.recentInboundsDescription')}
            columns={[
              t('dashboard.common.code'),
              t('dashboard.common.type'),
              t('dashboard.common.status'),
              t('dashboard.common.date'),
            ]}
            isLoading={recentInbounds.isPending}
            isError={recentInbounds.isError}
            onRetry={() => void recentInbounds.refetch()}
            isEmpty={recentInbounds.data?.length === 0}
            footer={
              <DashboardViewAll
                to={withCompany('/functions/warehouse/inbounds')}
              >
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentInbounds.data?.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>{row.code}</TableCell>
                <TableCell>{t(`execution.kinds.${row.kind}`)}</TableCell>
                <TableCell>
                  <DashboardStatus status={row.status} />
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {formatDashboardDate(row.occurredOn, i18n.language)}
                </TableCell>
              </TableRow>
            ))}
          </DashboardTableCard>
        ) : null}
        {documents.can ? (
          <DashboardTableCard
            title={t('dashboard.warehouse.recentOutbounds')}
            description={t('dashboard.warehouse.recentOutboundsDescription')}
            columns={[
              t('dashboard.common.code'),
              t('dashboard.common.type'),
              t('dashboard.common.status'),
              t('dashboard.common.date'),
            ]}
            isLoading={recentOutbounds.isPending}
            isError={recentOutbounds.isError}
            onRetry={() => void recentOutbounds.refetch()}
            isEmpty={recentOutbounds.data?.length === 0}
            footer={
              <DashboardViewAll
                to={withCompany('/functions/warehouse/outbounds')}
              >
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentOutbounds.data?.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>{row.code}</TableCell>
                <TableCell>{t(`execution.kinds.${row.kind}`)}</TableCell>
                <TableCell>
                  <DashboardStatus status={row.status} />
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {formatDashboardDate(row.occurredOn, i18n.language)}
                </TableCell>
              </TableRow>
            ))}
          </DashboardTableCard>
        ) : null}
      </div>
      <DashboardTodoCard
        title={t('dashboard.warehouse.todos')}
        description={t('dashboard.warehouse.todosDescription')}
        items={[
          ...(documents.can
            ? [
                {
                  label: t('dashboard.warehouse.todo.inbound'),
                  to: withCompany('/functions/warehouse/inbounds/new'),
                  icon: ArrowDownToLine,
                },
                {
                  label: t('dashboard.warehouse.todo.outbound'),
                  to: withCompany('/functions/warehouse/outbounds/new'),
                  icon: ArrowUpFromLine,
                },
              ]
            : []),
          ...(inventory.can
            ? [
                {
                  label: t('dashboard.warehouse.todo.inventory'),
                  to: withCompany('/functions/warehouse/inventory'),
                  icon: Boxes,
                  count: inventoryCount.data,
                },
              ]
            : []),
          ...(transfers.can
            ? [
                {
                  label: t('dashboard.warehouse.todo.transfers'),
                  to: withCompany('/functions/warehouse/transfers'),
                  icon: ArrowLeftRight,
                  count: pendingTransfers.data,
                },
              ]
            : []),
        ]}
      />
    </PageContainer>
  );
}
