import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useSearchParams } from 'react-router';
import { ClipboardList, FileText, Truck } from 'lucide-react';
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

type OrderRow = {
  id: string;
  code: string;
  status: string;
  occurredOn: string;
  display?: { partner?: { name?: string } | null };
};

type RequestRow = {
  id: string;
  code: string;
  status: string;
  neededOn: string;
  display?: { requester?: { name?: string } | null };
};

export default function ProcurementOverviewPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const subjectId = params.get('subjectId') ?? '';
  const { refresh, busy } = useDashboardRefresh();
  const requests = useCan({
    resource: { type: 'composite', id: 'procurement.requests' },
    action: 'read',
  });
  const orders = useCan({
    resource: { type: 'composite', id: 'procurement.orders' },
    action: 'read',
  });
  const suppliers = useCan({
    resource: { type: 'composite', id: 'procurement.suppliers' },
    action: 'read',
  });
  const enabled = Boolean(subjectId);

  const orderCount = useDashboardCount(
    'procurement',
    'orders',
    'procurement/orders',
    { subjectId },
    enabled && orders.can,
  );
  const pendingRequests = useDashboardCount(
    'procurement',
    'pendingRequests',
    'procurement/requests',
    { subjectId, status: 'pending' },
    enabled && requests.can,
  );
  const approvedRequests = useDashboardCount(
    'procurement',
    'approvedRequests',
    'procurement/requests',
    { subjectId, status: 'approved' },
    enabled && requests.can,
  );
  const supplierCount = useDashboardCount(
    'procurement',
    'suppliers',
    'procurement/suppliers',
    { subjectId },
    enabled && suppliers.can,
  );
  const recentOrders = useDashboardList<OrderRow>(
    'procurement',
    'recentOrders',
    'procurement/orders',
    { subjectId },
    enabled && orders.can,
  );
  const recentRequests = useDashboardList<RequestRow>(
    'procurement',
    'recentRequests',
    'procurement/requests',
    { subjectId },
    enabled && requests.can,
  );

  const withCompany = (path: string) =>
    `${path}${path.includes('?') ? '&' : '?'}subjectId=${subjectId}`;

  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.procurement.title')}
        description={t('dashboard.procurement.description')}
        actions={<DashboardRefresh busy={busy} onClick={refresh} />}
      />
      <DashboardMetricGrid>
        {orders.can ? (
          <DashboardMetric
            label={t('dashboard.procurement.metrics.orders')}
            value={orderCount.data}
            isLoading={orderCount.isPending}
            icon={FileText}
            to={withCompany('/functions/procurement/orders')}
          />
        ) : null}
        {requests.can ? (
          <DashboardMetric
            label={t('dashboard.procurement.metrics.pendingRequests')}
            value={pendingRequests.data}
            isLoading={pendingRequests.isPending}
            icon={ClipboardList}
            to={withCompany('/functions/procurement/requests?status=pending')}
          />
        ) : null}
        {requests.can ? (
          <DashboardMetric
            label={t('dashboard.procurement.metrics.approvedRequests')}
            value={approvedRequests.data}
            isLoading={approvedRequests.isPending}
            icon={ClipboardList}
            to={withCompany('/functions/procurement/requests?status=approved')}
          />
        ) : null}
        {suppliers.can ? (
          <DashboardMetric
            label={t('dashboard.procurement.metrics.suppliers')}
            value={supplierCount.data}
            isLoading={supplierCount.isPending}
            icon={Truck}
            to={withCompany('/functions/procurement/suppliers')}
          />
        ) : null}
      </DashboardMetricGrid>
      <div className='grid gap-4 2xl:grid-cols-2'>
        {orders.can ? (
          <DashboardTableCard
            title={t('dashboard.procurement.recentOrders')}
            description={t('dashboard.procurement.recentOrdersDescription')}
            columns={[
              t('dashboard.common.code'),
              t('dashboard.common.partner'),
              t('dashboard.common.status'),
              t('dashboard.common.date'),
            ]}
            isLoading={recentOrders.isPending}
            isError={recentOrders.isError}
            onRetry={() => void recentOrders.refetch()}
            isEmpty={recentOrders.data?.length === 0}
            footer={
              <DashboardViewAll
                to={withCompany('/functions/procurement/orders')}
              >
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentOrders.data?.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>{row.code}</TableCell>
                <TableCell>{row.display?.partner?.name ?? '—'}</TableCell>
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
        {requests.can ? (
          <DashboardTableCard
            title={t('dashboard.procurement.recentRequests')}
            description={t('dashboard.procurement.recentRequestsDescription')}
            columns={[
              t('dashboard.common.code'),
              t('dashboard.common.requester'),
              t('dashboard.common.status'),
              t('dashboard.common.neededOn'),
            ]}
            isLoading={recentRequests.isPending}
            isError={recentRequests.isError}
            onRetry={() => void recentRequests.refetch()}
            isEmpty={recentRequests.data?.length === 0}
            footer={
              <DashboardViewAll
                to={withCompany('/functions/procurement/requests')}
              >
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentRequests.data?.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>{row.code}</TableCell>
                <TableCell>{row.display?.requester?.name ?? '—'}</TableCell>
                <TableCell>
                  <DashboardStatus status={row.status} />
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {formatDashboardDate(row.neededOn, i18n.language)}
                </TableCell>
              </TableRow>
            ))}
          </DashboardTableCard>
        ) : null}
      </div>
      <DashboardTodoCard
        title={t('dashboard.procurement.todos')}
        description={t('dashboard.procurement.todosDescription')}
        items={[
          ...(requests.can
            ? [
                {
                  label: t('dashboard.procurement.todo.request'),
                  to: withCompany('/functions/procurement/requests/new'),
                  icon: ClipboardList,
                  count: pendingRequests.data,
                },
              ]
            : []),
          ...(orders.can
            ? [
                {
                  label: t('dashboard.procurement.todo.order'),
                  to: withCompany('/functions/procurement/orders/new'),
                  icon: FileText,
                },
              ]
            : []),
          ...(suppliers.can
            ? [
                {
                  label: t('dashboard.procurement.todo.suppliers'),
                  to: withCompany('/functions/procurement/suppliers'),
                  icon: Truck,
                  count: supplierCount.data,
                },
              ]
            : []),
        ]}
      />
    </PageContainer>
  );
}
