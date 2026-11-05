import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useSearchParams } from 'react-router';
import { Handshake, Truck, Users } from 'lucide-react';
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

export default function SalesOverviewPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const subjectId = params.get('subjectId') ?? '';
  const { refresh, busy } = useDashboardRefresh();
  const orders = useCan({
    resource: { type: 'composite', id: 'sales.orders' },
    action: 'read',
  });
  const customers = useCan({
    resource: { type: 'composite', id: 'sales.customers' },
    action: 'read',
  });
  const documents = useCan({
    resource: { type: 'composite', id: 'warehouse.documents' },
    action: 'read',
  });
  const enabled = Boolean(subjectId);

  const orderCount = useDashboardCount(
    'sales',
    'orders',
    'sales/orders',
    { subjectId },
    enabled && orders.can,
  );
  const pendingOrders = useDashboardCount(
    'sales',
    'pendingOrders',
    'sales/orders',
    { subjectId, status: 'pending' },
    enabled && orders.can,
  );
  const approvedOrders = useDashboardCount(
    'sales',
    'approvedOrders',
    'sales/orders',
    { subjectId, status: 'approved' },
    enabled && orders.can,
  );
  const customerCount = useDashboardCount(
    'sales',
    'customers',
    'sales/customers',
    { subjectId },
    enabled && customers.can,
  );
  const recentOrders = useDashboardList<OrderRow>(
    'sales',
    'recentOrders',
    'sales/orders',
    { subjectId },
    enabled && orders.can,
  );

  const withCompany = (path: string) =>
    `${path}${path.includes('?') ? '&' : '?'}subjectId=${subjectId}`;

  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.sales.title')}
        description={t('dashboard.sales.description')}
        actions={<DashboardRefresh busy={busy} onClick={refresh} />}
      />
      <DashboardMetricGrid>
        {orders.can ? (
          <DashboardMetric
            label={t('dashboard.sales.metrics.orders')}
            value={orderCount.data}
            isLoading={orderCount.isPending}
            icon={Handshake}
            to={withCompany('/functions/sales/orders')}
          />
        ) : null}
        {orders.can ? (
          <DashboardMetric
            label={t('dashboard.sales.metrics.pendingOrders')}
            value={pendingOrders.data}
            isLoading={pendingOrders.isPending}
            icon={Handshake}
            to={withCompany('/functions/sales/orders?status=pending')}
          />
        ) : null}
        {orders.can ? (
          <DashboardMetric
            label={t('dashboard.sales.metrics.approvedOrders')}
            value={approvedOrders.data}
            isLoading={approvedOrders.isPending}
            icon={Handshake}
            to={withCompany('/functions/sales/orders?status=approved')}
          />
        ) : null}
        {customers.can ? (
          <DashboardMetric
            label={t('dashboard.sales.metrics.customers')}
            value={customerCount.data}
            isLoading={customerCount.isPending}
            icon={Users}
            to={withCompany('/functions/sales/customers')}
          />
        ) : null}
      </DashboardMetricGrid>
      {orders.can ? (
        <DashboardTableCard
          title={t('dashboard.sales.recentOrders')}
          description={t('dashboard.sales.recentOrdersDescription')}
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
            <DashboardViewAll to={withCompany('/functions/sales/orders')}>
              {t('dashboard.viewAll')}
            </DashboardViewAll>
          }
        >
          {recentOrders.data?.map((row) => (
            <TableRow key={row.id}>
              <TableCell className='font-medium'></TableCell>
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
      <DashboardTodoCard
        title={t('dashboard.sales.todos')}
        description={t('dashboard.sales.todosDescription')}
        items={[
          ...(orders.can
            ? [
                {
                  label: t('dashboard.sales.todo.order'),
                  to: withCompany('/functions/sales/orders/new'),
                  icon: Handshake,
                  count: pendingOrders.data,
                },
              ]
            : []),
          ...(customers.can
            ? [
                {
                  label: t('dashboard.sales.todo.customers'),
                  to: withCompany('/functions/sales/customers'),
                  icon: Users,
                  count: customerCount.data,
                },
              ]
            : []),
          ...(documents.can
            ? [
                {
                  label: t('dashboard.sales.todo.shipments'),
                  to: withCompany('/functions/warehouse/outbounds/new'),
                  icon: Truck,
                },
              ]
            : []),
        ]}
      />
    </PageContainer>
  );
}
